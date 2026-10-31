// Real-number analysis for lowering: radicals, pi multiples, exponents,
// constant poles and fixed log bases.

import { isShadowedSymbol, shadowsLibraryName } from '../library-shadowing.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { getImaginaryFactor } from '../boxed-expression/utils.js';
import { isNonRealNumber } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import {
  isSymbol,
  isNumber,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { asRational } from '../boxed-expression/numerics.js';
import { realPowerBranchTerms } from '../boxed-expression/arithmetic-power.js';
import type { CompileTarget, TargetSource } from './types.js';
import {
  couldBeCollectionParticipant,
  isBoundPossiblyCollectionTyped,
  isGatedIndexedCollection,
  isProvablyStringOperand,
} from './compiler-type-facts.js';
import { NON_NEGATIVE_REAL_TYPE } from './compiler-naming.js';
import { CompilerState } from './compiler-state.js';
import { core } from './compiler-core-hooks.js';
import { isCompileBoundName, reachesExcludedName } from './compiler-names.js';
import {
  foldValueBlocked,
  foldValueImpure,
  recordJumpFoldReads,
} from './compile-folding.js';
import { unrolledIndexValueFold } from './compiler-mode.js';

/**
 * Whether operand `a` lowers to a positional array at run time — a
 * concrete collection, a list- or indexed-collection-typed binding, a
 * gated collection such as a restricted point (`isGatedIndexedCollection`:
 * an array or the absent value at run time), or a
 * binding that may be a collection (`isBoundPossiblyCollectionTyped`). A
 * string is an indexed collection in the type lattice but lowers to a
 * scalar string, so it is excluded. The shared operand test of the
 * broadcast closure (`tryCompileBroadcast`), the element-lane analysis
 * (`operandElementLane`) and the element-wise runtime rule
 * (`realOperandGuard`): the three must agree on which operands are seen
 * element-wise.
 *
 * `target` narrows the last disjunct to a value the JavaScript emission
 * proves scalar by construction — see {@link isBoundPossiblyCollectionTyped}
 * for which callers pass it and why the others need not.
 */
export function isArrayOperand(
  a: Expression,
  target?: CompileTarget<Expression>
): boolean {
  return (
    !isProvablyStringOperand(a) &&
    (a.isCollection ||
      a.type.matches('list<any>') ||
      a.type.matches('indexed_collection<any>') ||
      isGatedIndexedCollection(a) ||
      isBoundPossiblyCollectionTyped(a, target))
  );
}

/** `t` without its `nan` member when it is a union with one (`nan | real`
 * → `real`); any other type unchanged. */
export function withoutNaNMember(t: Type | undefined): Type | undefined {
  if (t === undefined || typeof t !== 'object' || t.kind !== 'union') return t;
  if (!t.types.includes('nan')) return t;
  const rest = t.types.filter((m) => m !== 'nan');
  if (rest.length === 0) return 'nan';
  if (rest.length === 1) return rest[0];
  return { kind: 'union', types: rest };
}

/**
 * Is `expr` PROVABLY non-negative under the premise the strict-shaped
 * analysis already makes — that a WIDE-typed value is REAL? The engine's
 * own `isNonNegative` answers `undefined` for `x²` when `x` is wide,
 * because a complex `x` has a negative square; but the compiler treats
 * that `x` as real, so `√(x² + y²)` — the distance and norm shape, the
 * commonest radical in a plot — must keep the real kernel rather than
 * promote (Tycho item 144: `√(⌈x⌉² + ⌈y⌉²)` stays on the fast path).
 *
 * Sound because the premise IS the compiled contract: under strict/auto a
 * wide binding holds a real (the D3 entry check refuses an object), and
 * under complex mode a wide operand is complex-valued and takes the complex
 * kernel before this predicate is consulted. A value TYPED non-real is not
 * real-assumed and answers `false` (unless the engine proves it).
 *
 * Recognized: a non-negative literal; the engine's own proof; a type
 * that is a non-negative real range (`real<0..>` or narrower); `Abs`,
 * `Exp`, `Square`, an even integer `Power` of a real-assumed operand; a
 * sum, product or quotient of recognized operands; a `Sqrt` of one.
 */
export function assumedRealNonNegative(expr: Expression): boolean {
  if (expr.isNonNegative === true) return true;
  if (isNumber(expr)) return !expr.isComplex && expr.re >= 0;
  // A type that is a non-negative real range is a proof too. The engine's
  // `isNonNegative` does not read ranged types, so without this a radicand
  // typed `real<0.02..1>` (`1 − ((k − 0.5)/40)²` over an index typed
  // `integer<1..40>`) had an unknown sign here: the `Sqrt` promoted to the
  // complex lane while its type, and so the parent's lane verdict, stayed
  // `real`. The parent then emitted real arithmetic around a `{re, im}`
  // object, which evaluates to NaN.
  // The type is read WITHOUT its `nan` member: a `nan | real<0..>` operand
  // (the element read `L[i]` types `nan | real`, since the index may be out
  // of range, and `Max(0, L[i])` then types `nan | real<0..>`) is at run
  // time either a non-negative double or NaN, and both keep the real kernel
  // — `Math.sqrt(NaN)` is the NaN the interpreter answers for √NaN. The
  // engine's own sign is undecided for such an operand (NaN is unsigned),
  // so without this the radical promoted to the complex kernel, and in a
  // compiled program every quantity built on `2√max(0, k₁k₂ + …)` became a
  // complex object where the interpreted program kept a real (Tycho item
  // 332).
  const exprType = withoutNaNMember(expr.type?.type);
  if (exprType !== undefined && isSubtype(exprType, NON_NEGATIVE_REAL_TYPE))
    return true;
  // An unrolled `Sum`/`Product` term binds its index to a literal integer,
  // so a subtree whose sign is unknown while the index is free can still be
  // a closed constant in the term being emitted. Consult the term's index
  // values before the syntactic rules below, which cannot see them.
  if (unrolledIndexValuesProveNonNegative(expr)) return true;
  if (isSymbol(expr)) {
    for (let i = CompilerState._unrolledIndexValues.length - 1; i >= 0; i--) {
      const frame = CompilerState._unrolledIndexValues[i];
      if (frame.masked.has(expr.symbol)) break;
      const lower = frame.lowerBounds?.get(expr.symbol);
      if (lower !== undefined) return lower >= 0;
      if (frame.values.has(expr.symbol)) break;
    }
  }
  if (!isFunction(expr)) return false;
  const t = expr.type?.type;
  if (t !== undefined && isNonRealNumber(t)) return false;
  const realAssumed = (e: Expression): boolean => {
    const et = e.type?.type;
    return et === undefined || !isNonRealNumber(et);
  };
  const h = expr.operator;
  const ops = expr.ops;
  if (h === 'Abs' || h === 'Exp')
    return ops.length === 1 && realAssumed(ops[0]);
  if (h === 'Square') return ops.length === 1 && realAssumed(ops[0]);
  if (h === 'Power' && ops.length === 2) {
    const e = ops[1];
    return (
      isNumber(e) &&
      !e.isComplex &&
      Number.isInteger(e.re) &&
      e.re % 2 === 0 &&
      realAssumed(ops[0])
    );
  }
  if (h === 'Sqrt' && ops.length === 1) return assumedRealNonNegative(ops[0]);
  if (h === 'Add' || h === 'Multiply' || h === 'Divide')
    return ops.every((o) => assumedRealNonNegative(o));
  // The largest of real-assumed operands is at least each of them, so ONE
  // recognized operand is enough: `Max(0, x)`, the usual guard of a
  // radicand, is non-negative whatever `x` is. The smallest needs every
  // operand recognized. A list operand is not admitted: the extremum of an
  // empty list is NaN, and its elements are not the operands tested here.
  if ((h === 'Max' || h === 'Min') && ops.length > 0) {
    if (!ops.every((o) => realAssumed(o) && o.isCollection !== true))
      return false;
    return h === 'Max'
      ? ops.some((o) => assumedRealNonNegative(o))
      : ops.every((o) => assumedRealNonNegative(o));
  }
  return false;
}

/**
 * The base of a `Log` call when it is one the targets spell with a
 * DEDICATED kernel: `10` for the one-argument form and for a literal base
 * `10`, `2` for a literal base `2`, `undefined` for every other base. The
 * dedicated kernels (`Math.log10`/`Math.log2`, `np.log10`/`np.log2`, the
 * shader `log2`, `_IA.log10`/`_IA.log2`) are what the interpreter's
 * constant fold uses, so a runtime `Log` spelled through them agrees with
 * a folded one to the last bit; spelled as `ln(x) / ln(b)` it was one ulp
 * off at the powers of the base (Tycho item 240).
 */
export function fixedLogBase(
  args: ReadonlyArray<Expression>
): 10 | 2 | undefined {
  if (args.length === 1) return 10;
  const b = args[1];
  if (b === undefined || !isNumber(b)) return undefined;
  if (b.isSame(10)) return 10;
  if (b.isSame(2)) return 2;
  return undefined;
}

/**
 * The real root of a NEGATIVE base under a FLOAT exponent. The
 * interpreter recovers the rational `p/q` that a float exponent came from
 * (`realPowerBranchTerms()`), and when `q` is odd the value is the real
 * root `±|x|^e`, negative when `p` is odd: `(−8)^{0.4}` is `2.297` and
 * `(−8)^{0.3333333333333333}` is `−2` at machine precision and
 * `−1.99999999999999986137` at 21 digits. The power of a target
 * (`Math.pow`, `**`, the shader `pow`) gives `NaN` or the principal complex
 * value there. Returns:
 * - `undefined` when the rule does not apply: the base is provably
 *   non-negative, the exponent is provably an integer or is an exact
 *   number (`realPowerExponent` lowers an exact rational), or the exponent
 *   is a float constant whose recovered denominator is even or absent (the
 *   principal value, which the power of the target gives);
 * - `{ value, oddNumerator, terms }` for a float constant exponent with an
 *   odd recovered denominator, decided now, in the shape `realPowerExponent`
 *   returns, with the recovered `[p, q]` as `terms` (the interval target
 *   gives them to `_IA.powRational`);
 * - `'runtime'` for an exponent with an unknown: the rule needs its value.
 */
export function negativeBaseFloatPower(
  args: ReadonlyArray<Expression>
):
  | { value: number; oddNumerator: boolean; terms: [p: number, q: number] }
  | 'runtime'
  | undefined {
  if (args.length !== 2) return undefined;
  const [base, exponent] = args;
  if (base.isNonNegative === true) return undefined;
  if (exponent.isInteger === true) return undefined;
  // A constant exponent that is not a number literal (`π`, `√2`) is read
  // as its numeric value, as the interpreter reads it under `.N()`. An
  // exponent that is not pure (`Random()`) is not evaluated now: it would
  // draw when the code is generated, and the draw would be frozen into the
  // code. It is decided at run time.
  const literal =
    isNumber(exponent) ||
    exponent.unknowns.length > 0 ||
    exponent.isPure !== true
      ? exponent
      : exponent.N();
  if (isNumber(literal)) {
    if (literal === exponent && literal.isExact) return undefined;
    if (literal.isComplex) return undefined;
    const value = literal.re;
    if (!Number.isFinite(value) || Number.isInteger(value)) return undefined;
    const terms = realPowerBranchTerms(undefined, value);
    if (terms === undefined || terms[1] % 2 === 0) return undefined;
    return { value, oddNumerator: terms[0] % 2 !== 0, terms };
  }
  return exponent.unknowns.length > 0 || exponent.isPure !== true
    ? 'runtime'
    : undefined;
}

/**
 * The exponent of `e` split as `a + iπu`, with `u` real (`piMultiple`)
 * and `a` the sum of the other terms, real, or `undefined` when there is
 * none. The targets lower `e^{a + iπu}` as `e^a·(cos πu + i·sin πu)` with
 * the angle in half-turns, so `e^{x + iπ}` is `−e^x` with no imaginary
 * part. Returns `undefined` for any other exponent.
 *
 * A term `iπu` is read as the hyperbolic lowerings read it
 * (`imaginaryPiMultiple`): a factor of `u` with no declared type, such as
 * an undeclared `x`, is real, because it compiles to a real value. So
 * `e^{iπx}` and `sinh(iπx)` get the same exact lowering with an undeclared
 * `x`. The other shapes of `getImaginaryFactor` (`Negate(iπx)`, …) are
 * read as before, and they require real factors.
 */
export function eulerPiSplit(
  exponent: Expression
): { a: Expression | undefined; u: Expression } | undefined {
  const terms = isFunction(exponent, 'Add') ? exponent.ops : [exponent];
  let u: Expression | undefined = undefined;
  const real: Expression[] = [];
  for (const term of terms) {
    let v = imaginaryPiMultiple(term);
    if (v === undefined) {
      const theta = getImaginaryFactor(term);
      if (theta !== undefined) v = piMultiple(theta);
    }
    if (v !== undefined && u === undefined) u = v;
    else if (core.isComplexValued(term)) return undefined;
    else real.push(term);
  }
  if (u === undefined) return undefined;
  const ce = exponent.engine;
  const a =
    real.length === 0
      ? undefined
      : real.length === 1
        ? real[0]
        : ce.function('Add', real);
  return { a, u };
}

/**
 * `u` when the real-valued expression `x` is `π·u`: the symbol `Pi` as one
 * factor of a product whose other factors have no `Pi` and are real
 * (`Pi` itself is `π·1`). The targets lower `sin(π·u)`, `cos(π·u)`,
 * `tan(π·u)` and `e^{iπ·u}` with the angle in half-turns, `u`, reduced
 * exactly (`cosSinPi()`, `numerics/numeric-complex.ts`), so that the value
 * at an integer or a half-integer `u` has an exact zero part: `sin(πx)` at
 * `x = 2` is `0`, where `Math.sin(Math.PI * 2)` is `−2.4·10⁻¹⁶`, and
 * `e^{iπx}` at `x = 1` is `−1`, as in the interpreter for the exact `x`.
 * A quotient `π·u / d` whose denominator has no `Pi` and is real is
 * `π·(u / d)`: `sin(2πs/P)` at `s = 2`, `P = −2` is `0`, where
 * `Math.sin(2π·2 / −2)` is `2.4·10⁻¹⁶`, which made a test `sin(…) > 0`
 * true in the compiled code and false in the interpreter (Tycho's
 * `exoplanet-transit` document, 2026-10-26).
 * Returns `undefined` for any other expression.
 */
export function piMultiple(x: Expression): Expression | undefined {
  const ce = x.engine;
  // `−π·u` is `π·(−u)`. A product with the factor `−1` canonicalizes to a
  // `Negate`, so `e^{−iπx}` reaches this function as `Negate(π·x)`.
  if (isFunction(x, 'Negate')) return piMultiple(x.op1)?.neg();
  if (isFunction(x, 'Divide')) {
    const d = x.op2;
    if (d.symbols.includes('Pi') || core.isComplexValued(d)) return undefined;
    const u = piMultiple(x.op1);
    return u === undefined ? undefined : ce.function('Divide', [u, d]);
  }
  if (isSymbol(x, 'Pi')) return isLibraryPi(x) ? ce.One : undefined;
  if (!isFunction(x, 'Multiply')) return undefined;
  const index = x.ops.findIndex((op) => isSymbol(op, 'Pi'));
  if (index < 0 || !isLibraryPi(x.ops[index])) return undefined;
  const rest = x.ops.filter((_, i) => i !== index);
  if (rest.some((op) => op.symbols.includes('Pi'))) return undefined;
  const u = rest.length === 1 ? rest[0] : ce.function('Multiply', rest);
  if (core.isComplexValued(u)) return undefined;
  return u;
}

/**
 * `u` when `x` is `i·π·u` with a real `u`: a product of the imaginary unit
 * (the symbol `ImaginaryUnit`, or an imaginary literal `b·i`), the library
 * constant π, and factors that compile to real values (`piMultiple` of the
 * product of the other factors). The targets lower `sinh`, `cosh`, `tanh`,
 * `csch`, `sech` and `coth` of `i·π·u` with the angle `u` in half-turns,
 * reduced exactly (`cosSinPi()`), since `sinh(iθ) = i·sin θ` and
 * `cosh(iθ) = cos θ`. So `csch(iπx)` at `x = 1` is the pole `~oo`, as in
 * the interpreter, where the complex kernel computes `1/(i·sin(π))` with
 * `sin(π)` as the double `1.2·10⁻¹⁶`, and a zero, such as `sinh(iπx)` at
 * `x = 1`, is exact. Returns `undefined` for any other expression.
 */
export function imaginaryPiMultiple(x: Expression): Expression | undefined {
  const ce = x.engine;
  // A quotient `i·π·u / d` with a real denominator that has no `Pi` is
  // `i·π·(u / d)`, as in `piMultiple`.
  if (isFunction(x, 'Divide')) {
    const d = x.op2;
    if (d.symbols.includes('Pi') || core.isComplexValued(d)) return undefined;
    const u = imaginaryPiMultiple(x.op1);
    return u === undefined ? undefined : ce.function('Divide', [u, d]);
  }
  if (!isFunction(x, 'Multiply')) return undefined;
  let scale: Expression | undefined = undefined;
  const rest: Expression[] = [];
  for (const op of x.ops) {
    const im = isSymbol(op, 'ImaginaryUnit')
      ? ce.One
      : isNumber(op) && op.isComplex && op.re === 0 && op.im !== 0
        ? ce.number(op.im)
        : undefined;
    if (im !== undefined) {
      if (scale !== undefined) return undefined;
      scale = im;
    } else if (core.isComplexValued(op)) return undefined;
    else rest.push(op);
  }
  if (scale === undefined) return undefined;
  if (!scale.isSame(1)) rest.push(scale);
  if (rest.length === 0) return undefined;
  return piMultiple(
    rest.length === 1 ? rest[0] : ce.function('Multiply', rest)
  );
}

/**
 * Whether the symbol `pi` (named `Pi`) compiles to the library constant π
 * at the current compile site. It does not when a user binding of the
 * name gives it another value (`isShadowedSymbol`: a declaration, or a
 * parameter of the function literal whose body is compiled), when the
 * compilation binds the name (`isCompileBoundName`: a lambda parameter, a
 * loop index), or when the caller maps it to a run-time input (the `vars`
 * option of `compile()`). The half-turn shortcut of `piMultiple` reads
 * `π·u` as the angle `u` in half-turns, which is only right for π itself.
 */
export function isLibraryPi(pi: Expression): boolean {
  if (!isSymbol(pi, 'Pi') || isShadowedSymbol(pi)) return false;
  if (isCompileBoundName('Pi')) return false;
  const target = CompilerState._callSiteTarget;
  if (target === undefined) return true;
  if (target.varsKeys?.has('Pi') === true) return false;
  // A target that does not record the `vars` keys still resolves a mapped
  // name through `var`, ahead of its constants. The question is asked
  // without emitting anything, so a vars-object reference that the hook
  // records is rolled back, as the symbol branch of `compile` does. A
  // symbol bound to the library constant inside a scope that declares
  // `Pi` is π, although the hook answers otherwise
  // (`libraryBoundConstantHidden`).
  const constant = target.constant?.('Pi');
  if (constant === undefined) return true;
  const hadVarsRef = target.varsObjectRefs?.has('Pi') === true;
  const resolved = target.var('Pi');
  if (!hadVarsRef) target.varsObjectRefs?.delete('Pi');
  return resolved === constant || libraryBoundConstantHidden(pi, 'Pi', target);
}

/**
 * True when the symbol `expr`, named `s`, is bound to the definition of a
 * library constant of `target` (`Pi`, `ExponentialE`, …), but a scope at
 * the compile site declares the name (`shadowsLibraryName()`). The `var`
 * hook of the JavaScript and interval targets reads only the name, so it
 * then skips the constant, while the interpreter reads the bound
 * definition and computes with the constant. A name that the compilation
 * binds (a lambda parameter, a loop index) or that the caller maps with
 * `vars` is never the constant.
 */
export function libraryBoundConstantHidden(
  expr: Expression,
  s: string,
  target: CompileTarget<Expression>
): boolean {
  if (target.constant?.(s) === undefined) return false;
  if (target.boundVars?.has(s) === true || target.varsKeys?.has(s) === true)
    return false;
  if (!isSymbol(expr) || isShadowedSymbol(expr)) return false;
  return shadowsLibraryName(expr.engine, s, { customLibrary: false });
}

/**
 * The `Power` node `expr` with its exponent replaced by the exponent's
 * value, when the exponent is not a number literal but every symbol in it
 * is a constant or a symbol with an assigned value, and that value is a
 * finite real number that is not an integer. Returns `undefined` in every
 * other case.
 *
 * The lane rules of `Power` read a number literal exponent only: the
 * complex promotion of an unknown-sign base (`promotesRadicalToComplex`)
 * and the real root of an odd denominator (`realPowerExponent`). The
 * emitted code bakes the value of an assigned symbol anyway
 * (`tryFoldKnownSymbol`), so without this replacement `y^{k/2 − 1}` with
 * `k = 1` compiled to the real `pow(y, -0.5)`, `NaN` for a negative `y`,
 * where the interpreter and the compiled `y^{−1/2}` give the principal
 * complex value. The compiler analyzes and emits the returned node in
 * place of `expr`, so the parent and the node agree on the lane.
 *
 * A symbol that the compilation binds (a parameter, a `Block` local, a
 * binder index, a `vars` input) is not replaced: its value is not the
 * value of the engine symbol of the same name. A free symbol without a
 * value keeps the exponent as it is, and so keeps the real lane. An
 * integer value is not replaced either: no lane rule reads it, and the
 * literal lowerings of an integer exponent (`x^0` is `1`) do not give the
 * `NaN` of `0^0` that the interpreter computes for `x^{k − 1}` at `x = 0`.
 * Under a `symbolDeps` capture, the symbols that the value reads are
 * recorded; when they cannot all be found, the exponent is not replaced.
 * (User decision 2026-10-23, ROADMAP CE-213.)
 */
export function knownExponentPower(
  expr: Expression & { ops: ReadonlyArray<Expression> }
): Expression | undefined {
  if (expr.operator !== 'Power' || expr.ops.length !== 2) return undefined;
  const [base, exponent] = expr.ops;
  if (!isFunction(exponent) && !isSymbol(exponent)) return undefined;
  const engine = expr.engine;
  const target = CompilerState._callSiteTarget;
  // Every symbol of the exponent is a constant or a free symbol with an
  // assigned value, and at least one is the latter.
  let assigned = false;
  const visit = (node: Expression): boolean => {
    if (isNumber(node)) return true;
    if (isSymbol(node)) {
      const s = node.symbol;
      if (isNameBoundByCompilation(s, target)) return false;
      if (node.isConstant) return true;
      if (engine._getSymbolValue(s) === undefined) return false;
      assigned = true;
      return true;
    }
    if (isFunction(node)) return node.ops.every(visit);
    return false;
  };
  if (!visit(exponent) || !assigned) return undefined;
  if (!exponent.isPure || foldValueBlocked(exponent)) return undefined;
  // The engine evaluation of the exponent applies the engine definition of
  // every function that the exponent calls. When the caller replaces one
  // of these functions (`options.functions`), or the exponent reaches a
  // `vars` input, the compiled code must call the caller's function or
  // read the input at run time, so the exponent is not replaced.
  if (target !== undefined && reachesExcludedName(exponent, target))
    return undefined;
  let value = CompilerState._knownExponentMemo.get(exponent);
  if (value === undefined) {
    const v = exponent.evaluate();
    value =
      isNumber(v) &&
      !v.isComplex &&
      Number.isFinite(v.re) &&
      !Number.isInteger(v.re)
        ? v
        : null;
    CompilerState._knownExponentMemo.set(exponent, value);
  }
  if (value === null) return undefined;
  if (
    target?.symbolDeps !== undefined &&
    !recordJumpFoldReads(exponent, target.symbolDeps)
  )
    return undefined;
  return engine.function('Power', [base, value], { form: 'structural' });
}

/**
 * The code of an ordering comparison (`Less`, `LessEqual`, `Greater`,
 * `GreaterEqual`, two operands or a chain) that has a constant pole
 * operand: the target's `False`. Returns `undefined` when no operand is a
 * constant pole, or when the code would not give the interpreter's value:
 * - another operand may be a list at run time: the interpreter compares
 *   each element, and the value is a list;
 * - another operand is not pure: its effect must still happen.
 *
 * A constant pole is the symbol `ComplexInfinity`, or a closed operand
 * (every symbol in it a constant or a free symbol with an assigned value,
 * none bound by the compilation) whose exact value is `~oo`. Under a
 * `symbolDeps` capture, the symbols that the value reads are recorded;
 * when they cannot all be found, the operand is not read as a pole.
 */
export function constantPoleOrdering(
  engine: ComputeEngine,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  if (args.length < 2) return undefined;
  const poles = args.map((a) => isConstantPole(a, target));
  if (!poles.some((p) => p)) return undefined;
  for (let i = 0; i < args.length; i++) {
    if (poles[i]) continue;
    const a = args[i];
    if (
      isArrayOperand(a, target) ||
      couldBeCollectionParticipant(a) ||
      foldValueImpure(a)
    )
      return undefined;
  }
  return core.compile(engine.False, target);
}

/** See `constantPoleOrdering`. */
export function isConstantPole(
  a: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (isSymbol(a, 'ComplexInfinity') && !isShadowedSymbol(a)) return true;
  if (isNumber(a)) return a.isInfinity === true && a.isComplex;
  if (!isFunction(a) && !isSymbol(a)) return false;
  const visit = (node: Expression): boolean => {
    if (isNumber(node)) return true;
    if (isSymbol(node)) {
      if (isNameBoundByCompilation(node.symbol, target)) return false;
      return (
        node.isConstant ||
        node.engine._getSymbolValue(node.symbol) !== undefined
      );
    }
    if (isFunction(node)) return node.ops.every(visit);
    return false;
  };
  if (!visit(a)) return false;
  if (!a.isPure || foldValueBlocked(a)) return false;
  const memo = CompilerState._constantPoleMemo;
  let pole = memo.get(a);
  if (pole === undefined) {
    const v = a.evaluate();
    pole = isNumber(v) && v.isInfinity === true && v.isComplex;
    memo.set(a, pole);
  }
  if (!pole) return false;
  if (
    target.symbolDeps !== undefined &&
    !recordJumpFoldReads(a, target.symbolDeps)
  )
    return false;
  return true;
}

/**
 * Does the compilation in progress bind the name `s` (a parameter, a
 * `Block` local, a binder index, a `vars` input), so that `s` does not
 * denote the engine symbol of that name and its engine value must not be
 * read?
 */
export function isNameBoundByCompilation(
  s: string,
  target: CompileTarget<Expression> | undefined
): boolean {
  if (target?.boundVars?.has(s) === true) return true;
  if (target?.varsKeys?.has(s) === true) return true;
  if (CompilerState._boundVarsCtx?.has(s) === true) return true;
  for (const frame of CompilerState._localComplex)
    if (frame.has(s)) return true;
  for (const frame of CompilerState._binderShield)
    if (frame.has(s)) return true;
  for (const frame of CompilerState._unrolledIndexValues)
    if (frame.values.has(s) || frame.masked.has(s)) return true;
  return false;
}

/**
 * A noninteger exponent number literal whose reduced denominator permits a
 * real root of a negative base: an exact rational `p/q` with an odd `q`,
 * or a float literal that the interpreter reads as such a rational.
 *
 * The interpreter reads a float exponent as the nearest small rational
 * (`realPowerBranchTerms()`) and takes the real root when its denominator
 * is odd: `x^{1/2.2}` is `x^{0.4545…}`, read as `x^{5/11}`, which is `−1`
 * at `x = −1`. A float literal is decided by `negativeBaseFloatPower`, so
 * every target, and the complex-lane analysis that reads this function,
 * uses the same reading. Without it, a negative base compiles to no real
 * value (`NaN`, an empty interval) or to the complex lane.
 */
export function realPowerExponent(
  args: ReadonlyArray<Expression>
): { value: number; oddNumerator: boolean } | undefined {
  // Broadcast callbacks replace a literal exponent with a parameter. Keep
  // the original fraction's branch decision when compiling that callback.
  for (let i = _broadcastRadicalVerdict.length - 1; i >= 0; i--) {
    const frame = _broadcastRadicalVerdict[i];
    if (
      frame.head === 'Power' &&
      args.length === 2 &&
      args.every((a) => isSymbol(a) && frame.params.has(a.symbol))
    )
      return frame.realPower;
  }
  const exponent = args[1];
  if (isNumber(exponent) && !exponent.isExact) {
    const float = negativeBaseFloatPower(args);
    return typeof float === 'object' ? float : undefined;
  }
  if (
    !isNumber(exponent) ||
    exponent.isComplex ||
    !Number.isFinite(exponent.re) ||
    Number.isInteger(exponent.re)
  )
    return undefined;
  const rational = asRational(exponent);
  if (rational === undefined) return undefined;
  const p = BigInt(rational[0]);
  const q = BigInt(rational[1]);
  if (q <= 1n || q % 2n === 0n) return undefined;
  return { value: exponent.re, oddNumerator: p % 2n !== 0n };
}

/**
 * The reduced terms `[p, q]` of the exponent `1/n` of `Root(x, n)`, when
 * the degree `n` is a noninteger number literal and a negative radicand
 * has a real root, with the parity of `p`. Returns `undefined` otherwise;
 * an integer degree is not decided here (each target lowers an odd
 * integer degree on its own).
 *
 * The interpreter evaluates a negative radicand under a noninteger degree
 * as the power `x^(1/n)` (`root()` in `arithmetic-power.ts`), and reads
 * the exponent as `Power` reads a float exponent (`realPowerBranchTerms()`).
 * The degree is read here as a rational `a/b` with the same recognizer, so
 * `\sqrt[2.2]{x}` is read as `x^{5/11}`, as `x^{1/2.2}` is. The exponent
 * `1/n` is `b/a`. The value of a negative radicand is real when its
 * denominator `a` is odd. Its sign is then given by the numerator `b`:
 *
 * - `b` odd (`oddNumerator`): the value is negative, `−|x|^(1/n)`
 *   (`\sqrt[2.2]{x}` is `−2.573` at `x = −8`);
 * - `b` even: the value is positive, `|x|^(1/n)` (`\sqrt[2.5]{x}`, read as
 *   `x^{2/5}`, is `+2.297` at `x = −8`).
 *
 * When `a` is even (`\sqrt[2.4]{x}`, read as `x^{5/12}`), the value of a
 * negative radicand is complex, and the targets keep their power lowering.
 */
export function realRootDegreeTerms(
  degree: Expression | null | undefined
): { terms: [p: number, q: number]; oddNumerator: boolean } | undefined {
  if (degree === null || degree === undefined) return undefined;
  if (!isNumber(degree) || degree.isComplex) return undefined;
  const d = degree.re;
  if (!Number.isFinite(d) || Number.isInteger(d)) return undefined;
  const exact = degree.isExact ? asRational(degree) : undefined;
  if (degree.isExact && exact === undefined) return undefined;
  const terms = realPowerBranchTerms(exact, d);
  if (terms === undefined) return undefined;
  const [a, b] = terms;
  if (a % 2 === 0) return undefined;
  // The exponent `1/n` is `b/a`, with the sign on its numerator.
  return {
    terms: a < 0 ? [-b, -a] : [b, a],
    oddNumerator: b % 2 !== 0,
  };
}

/**
 * Whether applying `head` to `args` takes the COMPLEX lane purely because
 * the compile mode promotes (`auto`, `complex`).
 *
 * The rule is deliberately NOT "the node's type admits complex". That test
 * is too weak in both directions and misses the case promotion exists for:
 * `√(t−1)` types the wide `number` — not a non-real type — whenever
 * `t` is an undeclared symbol or an `unknown` parameter, which is exactly
 * the shape a user function's body has. Keying off the type there would
 * leave the option inert on its own witness.
 *
 * So the rule is the mathematical one: the real kernel is safe only when the
 * operand is PROVABLY non-negative, and anything else may promote at run
 * time, which is what the interpreter does. `isNonNegative` is three-valued
 * and answers `undefined` for most symbolic operands; only an explicit
 * `true` keeps the real kernel.
 *
 * Both `isComplexValued` and every target emitter for these heads route
 * through this one predicate, so parent and child always agree on the value
 * SHAPE — the invariant compiled correctness rests on.
 */
/** Whether `e` is a `List` literal, at any depth up to 8, with a real
 * number literal cell that is not an integer (`[2, 0.5]`,
 * `[[1, 2], [0.5, 3]]`). */
export function hasNonIntegerRealCell(e: Expression, depth = 0): boolean {
  if (isNumber(e)) return !e.isComplex && !Number.isInteger(e.re);
  return (
    depth < 8 &&
    isFunction(e, 'List') &&
    e.ops.some((x) => hasNonIntegerRealCell(x, depth + 1))
  );
}

/**
 * Is `expr` a non-negative real number under the index values of the
 * unrolled `Sum`/`Product` term being emitted? See
 * {@link unrolledIndexValueFold} for when the question can be answered at
 * all; `false` means "not decided here", never "negative".
 */
export function unrolledIndexValuesProveNonNegative(expr: Expression): boolean {
  const v = unrolledIndexValueFold(expr);
  return v !== undefined && isNumber(v) && !v.isComplex && v.re >= 0;
}

/**
 * Promotion verdicts recorded for broadcast closures currently being
 * emitted (`tryCompileBroadcast`): for a promotable radical/`Power` head,
 * the verdict is decided ONCE on the node-level operands — which carry the
 * sign/type evidence — and consulted by `promotesRadicalToComplex` when
 * the head's scalar codegen re-asks with the closure's synthetic element
 * temps, which carry none. Managed as a stack with symmetric try/finally
 * push/pop, always strictly inside the closure's `_pushLocalComplex`
 * frame, so `isComplexValued` answers memoized under a recorded verdict
 * stay in that frame's memo layer and cannot leak past it.
 */
export const _broadcastRadicalVerdict: Array<{
  head: string;
  params: Set<string>;
  promotes: boolean;
  realPower?: { value: number; oddNumerator: boolean };
}> = [];
