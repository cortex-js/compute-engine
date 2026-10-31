// Lanes (real, complex, wide) of operands and user calls: guards, lane
// mismatches, and the per-element lane of collection operands.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { boundNamesAddedBy } from './javascript-value-facts.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import { leafwardElementType } from '../collection-utils.js';
import {
  finitePartOfType,
  isNonRealNumber,
  stripMissingFromType,
  unfoldAliasOnDescent,
  type AliasDescent,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import { isRelationalOperator } from '../latex-syntax/utils.js';
import {
  isSymbol,
  isNumber,
  isString,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import type {
  CompileMode,
  CompileTarget,
  CompiledFunction,
  TargetSource,
} from './types.js';
import { CompileDeclineError, LaneMismatchError } from './diagnostics.js';
import { CompilerState } from './compiler-state.js';
import { core } from './compiler-core-hooks.js';
import {
  _codeOverrides,
  runtimeRealGuards,
  wideIsComplex,
  wideNumericType,
} from './compiler-mode.js';
import { tempVar } from './compiler-naming.js';
import {
  compileValueOperand,
  isUserDefinedFunction,
} from './compile-statements.js';
import {
  _enterUnrolledIndexBinder,
  _exitUnrolledIndexBinder,
  collectionFoldsReal,
  complexDiscipline,
  foldsCollectionElements,
} from './compile-declarations.js';
import {
  mayBeCollectionValued,
  removeDefinitionsAddedSince,
  setUserFunctionLane,
  userFunctionLanes,
} from './compile-definitions.js';
import {
  complexCoordinateArgumentAt,
  inlinedUserFunctionCall,
  pointArgumentAtUntypedParameter,
} from './compile-user-calls.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';
import { _invalidateComplexMemo } from './compile-folding.js';
import { LOGICAL_BROADCAST_HEADS } from './compiler-tables.js';
import type { ElementLane } from './compiler-types.js';
import {
  compilationType,
  isBoundPossiblyCollectionTyped,
} from './compiler-type-facts.js';

/**
 * The lane a `Sum`/`Product` takes once its clause is UNROLLED and each term
 * binds the index to a literal integer, installed by `javascript-target.ts`
 * at module load (`installUnrolledBigOpLane`). It lives there because the
 * unroll conditions — the constant-bound reading, the term-count limit, the
 * iteration budget — are that emitter's, and analysis and emission must read
 * them from ONE place or they disagree about the value shape. Importing the
 * target here would close a cycle, which the module graph forbids.
 *
 * The hook answers `false` only when the index-masked analysis calls the body
 * complex while every unrolled term is real under its own index value, or a
 * loop's lower bound proves the body real. It answers `undefined` otherwise — so it can only ever move a verdict from complex to
 * real. Until it is installed, and for every target that installs none, the
 * ordinary masked analysis stands.
 */
export let unrolledBigOpLaneHook:
  ((expr: Expression) => boolean | undefined) | undefined;

/** See {@link unrolledBigOpLaneHook}. */
export function installUnrolledBigOpLane(
  hook: (expr: Expression) => boolean | undefined
): void {
  unrolledBigOpLaneHook = hook;
}

/**
 * Is `expr` STATICALLY a non-real number — a value that certainly has a
 * non-zero imaginary part? `ImaginaryUnit`, a number literal with a
 * non-zero imaginary part, a symbol typed `imaginary`, or a symbol whose
 * assigned value is one of those. A `complex`-TYPED symbol is NOT
 * statically non-real (a real IS a complex; `z: complex` may hold `2`), nor
 * is a promoted radical or a wide binding — those take the D2 runtime rule.
 */
export function isProvablyNonReal(expr: Expression): boolean {
  if (isNumber(expr)) return expr.isComplex && expr.isNumberLiteral === true;
  if (isSymbol(expr)) {
    if (expr.symbol === 'ImaginaryUnit') return true;
    const t = expr.type;
    if (t !== undefined && isSubtype(t.type, 'imaginary')) return true;
    if (
      CompilerState._boundVarsCtx?.has(expr.symbol) ||
      CompilerState._binderShield.some((f) => f.has(expr.symbol))
    )
      return false;
    const v = expr.engine._getSymbolValue(expr.symbol);
    return v !== undefined && isProvablyNonReal(v);
  }
  if (isFunction(expr)) {
    // A list literal EVERY visible element of which is statically non-real
    // (`[1+i, 2+i]`, `[i, 2i]`) has no real value at any position: a
    // real-only head over it is certainly NaN throughout (a reducer's
    // value, a broadcast's every element), so it takes the same
    // compile-time decline as the scalar `i`. A list with SOME real or
    // maybe-real element (`[1+i, 2]`, `[√x, 1]`) is not statically
    // non-real: the element-wise runtime rule answers per position.
    if (expr.operator === 'List')
      return expr.ops.length > 0 && expr.ops.every((e) => isProvablyNonReal(e));
    // Arithmetic that keeps a non-zero imaginary part: a sum or difference
    // of ONE statically non-real term and real terms (`x + i` over a real
    // `x`: its imaginary part is the imaginary part of that term), the
    // negation of a statically non-real value, and the product of one
    // statically non-real factor with real factors of known sign (`2x·i`
    // over a positive `x`; a real factor that may be zero may cancel the
    // imaginary part). Without these, `Erf(x + i)` took the run-time rule
    // and was NaN at every point, where it has no compiled value at all on
    // a target whose `Erf` is real-only. The type cannot answer: `x + i`
    // types `complex`, which admits real values.
    const realOperand = (e: Expression): boolean =>
      !core.isComplexValued(e) && e.type.matches('real');
    if (expr.operator === 'Negate' && expr.ops.length === 1)
      return isProvablyNonReal(expr.ops[0]);
    if (
      expr.operator === 'Add' ||
      expr.operator === 'Subtract' ||
      expr.operator === 'Multiply'
    ) {
      const nonReal = expr.ops.filter((e) => isProvablyNonReal(e));
      if (nonReal.length !== 1) return false;
      const others = expr.ops.filter((e) => e !== nonReal[0]);
      if (expr.operator === 'Multiply')
        return others.every(
          (e) =>
            realOperand(e) && (e.isPositive === true || e.isNegative === true)
        );
      return others.every(realOperand);
    }
    const t = expr.type;
    return t !== undefined && isSubtype(t.type, 'imaginary');
  }
  return false;
}

/**
 * The lowering of the real-only head `h` for complex operands that the
 * target gives (`CompileTarget.complexLowering`), in the modes that apply
 * the run-time realness rule (`runtimeRealGuards`: `auto` and `complex`).
 * In the `strict` mode a complex operand of a real-only head declines, as
 * before.
 */
export function complexLoweringOf(
  target: CompileTarget<Expression>,
  h: string
):
  | {
      lowering: Exclude<CompiledFunction<Expression>, string>;
      complexResult: boolean;
    }
  | undefined {
  if (!runtimeRealGuards()) return undefined;
  if (target.complexLowering === undefined) return undefined;
  if (callerOverrides(target, h)) return undefined;
  return target.complexLowering(h);
}

/**
 * Whether the real-only head of `expr` is emitted with the target's
 * lowering for complex operands (`complexLoweringOf`), because an operand
 * may be complex, and that lowering has a complex value. The emission
 * gates of `compileExpr` make the same choice from the same predicates.
 */
export function takesComplexResultLowering(expr: Expression): boolean {
  const target = CompilerState._callSiteTarget;
  if (target === undefined || !isFunction(expr)) return false;
  const complex = complexLoweringOf(target, expr.operator);
  if (complex === undefined || !complex.complexResult) return false;
  return realOnlyGuardOperands(expr.operator, expr.ops).some((a) =>
    realGuardCandidate(a, expr.engine, target)
  );
}

/**
 * Whether operand `a` of a real-only head takes the D2/D6 runtime rule
 * (`realOperandGuard`): it is not already projected (`_codeOverrides`), and
 * it may hold a complex value at run time — as a SCALAR (`isComplexValued`:
 * a `complex`-typed symbol, a wide binding under the complex discipline, a
 * promoted radical) or as an ARRAY some element of which may be complex
 * (`operandElementLane` answers `true` or `'mixed'`: `√L`, a
 * `list<complex>` symbol, a list literal with a complex element). An array
 * operand whose lane is UNDECIDED (`undefined`: a `broadcastable<complex>`
 * parameter, a top-typed call with complex evidence) is not a candidate —
 * that shape keeps its compile-time decline, for the reason given in
 * `_operandElementLane`.
 */
export function realGuardCandidate(
  a: Expression,
  engine: ComputeEngine,
  target: CompileTarget<Expression>
): boolean {
  if (_codeOverrides.has(a)) return false;
  const lane = core.operandElementLane(a, engine, target);
  return lane === true || lane === 'mixed';
}

/**
 * The D2 runtime rule for a CHAINED ordering (`Less(a, b, c, …)` — `a < b <
 * c`): each operand is bound ONCE, at the FIRST edge that reads it, and the
 * edges are conjoined left to right, so a later operand is not evaluated
 * (and an impure one not drawn) once an earlier edge has failed — the
 * interpreter's short-circuit order. Each edge compares the real projections
 * under the guard that its operands are real; otherwise it is `false`.
 *
 * Emitted as nested `bindExpr` scopes: `((t0) => guard0 ? ((t1) => guard1 ?
 * (t0 < t1) && ((t2) => …)(c) : false)(b) : false)(a)`. Operands that are
 * NOT maybe-complex are still bound (they must be evaluated exactly once,
 * and the temporaries keep the edges uniform); their guard is omitted. The
 * comparison is the raw operator over real projections: a chain reaches
 * here only when some operand may be complex, i.e. every operand is
 * numeric. Same preconditions and `undefined` contract as
 * `realOperandGuard`.
 */
export function realOperandChain(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  if (!runtimeRealGuards()) return undefined;
  const isMaybe = (a: Expression): boolean =>
    core.isComplexValued(a) && !_codeOverrides.has(a);
  if (!args.some(isMaybe)) return undefined;
  const nonReal = args.find((a) => isMaybe(a) && isProvablyNonReal(a));
  if (nonReal !== undefined)
    throw new CompileDeclineError({
      code: 'non-real-operand',
      kind: 'capability',
      message:
        `Could not compile \`${h}\`: the operand \`${nonReal.toString()}\` is ` +
        `certainly not a real number, and this target's ` +
        `lowering of the head is real-only.`,
    });
  const bind = target.bindExpr;
  const isReal = target.complexIsReal;
  const real = target.complexReal;
  const guard = target.realGuard;
  if (
    !bind ||
    !isReal ||
    !real ||
    !guard ||
    args.some((a) => a.type.matches('collection<any>'))
  )
    return undefined;
  const op = { Less: '<', LessEqual: '<=', Greater: '>', GreaterEqual: '>=' }[
    h
  ];
  if (op === undefined) return undefined;
  const temps = args.map(() => tempVar(target));
  const codes = args.map((a) => compileValueOperand(a, target));
  const guardOf = (i: number): string[] =>
    isMaybe(args[i]) ? [isReal(temps[i])] : [];
  const valueOf = (i: number): string =>
    isMaybe(args[i]) ? real(temps[i]) : temps[i];
  // Scope i binds operand i (guarded), then — for i ≥ 1 — compares it with
  // operand i−1 (bound by the enclosing scope) and continues the chain.
  const scope = (i: number): string => {
    const cmp = i === 0 ? '' : `(${valueOf(i - 1)} ${op} ${valueOf(i)})`;
    const rest = i + 1 < args.length ? scope(i + 1) : '';
    const body = cmp === '' ? rest : rest === '' ? cmp : `${cmp} && ${rest}`;
    return bind([[temps[i], codes[i]]], guard(guardOf(i), body, 'boolean'));
  };
  return scope(0);
}

/**
 * COMPLEX discipline, the LIFT AT USE (design §2): the emitted reference
 * `code` of a symbol whose analysis says complex ONLY because its type is
 * wide is wrapped in the target's idempotent `complexLift` (`_SYS.cplx`) —
 * the binding may hold a plain number at run time (a caller's `vars`, a
 * real argument to a wide parameter, a real first assignment to a local),
 * and every consumer that reads it as complex must find `{re, im}`. A
 * symbol complex by TYPE (`z: complex`, coerced at every entry) or by
 * frame (a lane parameter, a local bound to a complex value) is left as
 * emitted. Outside the complex discipline, or on a target without the
 * hook, the reference is unchanged.
 */
export function liftWideReference(
  sym: Expression,
  code: TargetSource,
  target: CompileTarget<Expression>
): TargetSource {
  if (!complexDiscipline() || !target.complexLift) return code;
  if (!isSymbol(sym) || sym.symbol === 'ImaginaryUnit') return code;
  if (!core.isComplexValued(sym)) return code;
  const t = sym.type?.type;
  if (t !== undefined && isNonRealNumber(t)) return code;
  return target.complexLift(code);
}

/**
 * Throw the strict-mode `LaneMismatch` decline for a complex-shaped `value`
 * reaching the real-shaped binding `binding` at the §3 boundary `boundary`.
 * `binding` must be USER-LEGIBLE (an authored identifier or an honest
 * description — never an emitted temporary), per the `LaneMismatchError`
 * contract; `value` is rendered as LaTeX when the engine can serialize it.
 */
export function laneMismatch(
  boundary: string,
  binding: string,
  value: Expression
): never {
  let rendered: string;
  try {
    rendered = value.latex;
  } catch {
    rendered = value.toString();
  }
  throw new LaneMismatchError({ boundary, binding, value: rendered });
}

/**
 * A user-legible name for parameter `i` of user function `h` whose literal
 * is `literal`: the authored identifier when the parameter has one, else an
 * honest positional description.
 */
export function userParamBinding(
  h: string,
  literal: (Expression & FunctionInterface) | undefined,
  i: number
): string {
  const p = literal?.ops[i + 1];
  const name = p !== undefined ? functionLiteralParameterName(p) : undefined;
  return name
    ? `the parameter \`${name}\` of \`${h}\``
    : `parameter ${i + 1} of \`${h}\` (unnamed)`;
}

/**
 * The effective compile mode for `target`: its requested `mode` when set
 * and offered by its `supportedModes` (default `['strict']`), else the
 * target's default — `'auto'` when offered, otherwise `'strict'`.
 *
 * A REQUESTED mode the target does not offer throws a `CompileDeclineError`
 * (`code: 'unsupported-mode'`, `kind: 'capability'`): the caller asked for
 * a discipline this target cannot deliver, and silently compiling in
 * another would hand back code whose value shape the caller did not ask
 * for.
 */
export function resolveCompileMode(
  target: CompileTarget<Expression>
): CompileMode {
  const supported: readonly CompileMode[] = target.supportedModes ?? ['strict'];
  const requested = target.mode;
  if (requested === undefined)
    return supported.includes('auto') ? 'auto' : 'strict';
  if (!supported.includes(requested))
    throw new CompileDeclineError({
      code: 'unsupported-mode',
      kind: 'capability',
      message: `Could not compile: the mode '${requested}' is not offered by the '${
        target.language ?? 'custom'
      }' compilation target (offered: ${supported
        .map((m) => `'${m}'`)
        .join(', ')}).`,
    });
  return requested;
}

/**
 * The lane of the value that a call to a USER-defined function returns:
 * `true` for a complex scalar (a `{re, im}` object, a shader `vec2`),
 * `false` for a real scalar. `undefined` when `expr` is not such a call,
 * when no compilation that emits user functions is running, or when the
 * value is not a scalar: `isComplexValued` then gives its type-based
 * answer.
 *
 * The TYPE of the call cannot give this answer. The result type of a
 * function with no declared codomain is inferred, and the complex body of
 * `h(s) := s + i` infers `number`, while the emitted `_fn_h` returns a
 * complex value. Only the definition that the call uses knows the lane. So
 * the lane is RECORDED when the definition is emitted
 * (`recordUserFunctionLane`), and read here.
 *
 * A parent lowering asks for the lane of an operand BEFORE it compiles the
 * operand, so the definition is often not emitted yet. It is emitted here,
 * through the same route that the call takes (`userCallDefinition`). A
 * definition that the compiled code does not reference in the end (the
 * call was folded, for example) is removed from the preamble
 * (`pruneUnreferencedVariantBases`).
 *
 * An INLINED call has no definition: its value is the substituted body,
 * compiled at the call site, so its lane is the lane of that expression.
 *
 * A RECURSIVE call, reached while its own definition is compiling, has no
 * record yet. Its lane is read from its type, and the definition records
 * that assumption: when the body then returns a complex value, the
 * definition fails closed (`recordUserFunctionLane`).
 *
 * A definition that has no record (a target lowering that records
 * nothing), called with a type that does not decide the lane (`number`,
 * `unknown`), fails closed with a diagnostic that asks for a declared
 * signature. The compiler does not guess the lane.
 */
export function userCallLane(
  expr: Expression & { ops: ReadonlyArray<Expression> }
): boolean | undefined {
  const h = expr.operator;
  if (typeof h !== 'string') return undefined;
  const target = CompilerState._callSiteTarget;
  const registry = target?.userFunctions;
  if (
    target === undefined ||
    registry === undefined ||
    !LANE_RECORD_LANGUAGES.has(target.language ?? '')
  )
    return undefined;
  const lanes = userFunctionLanes(registry);
  // A call whose definition is known answers from its record at once. The
  // route of a call is found once: finding it analyzes the arguments, and
  // with nested calls (`F(F(F(a, c), c), c)`) each level would analyze
  // the levels below it again.
  let name = lanes.byNode.get(expr);
  // A definition removed since the route was found
  // (`removeDefinitionsAddedSince`) is emitted again by a new route. A
  // definition that is compiling again (the route was found while an
  // earlier emission of it was in the preamble) is a recursive call: the
  // route is found again, so that the recursive-call assumption below
  // answers, not the lane-question diagnostic.
  if (
    name !== undefined &&
    (!registry.defs.has(name) || registry.compiling.has(name))
  )
    name = undefined;
  if (name === undefined) {
    const engine = expr.engine;
    if (!isUserDefinedFunction(engine, h)) return undefined;
    const route = userCallDefinition(engine, h, expr.ops, target);
    // No definition and no inlining: the call itself fails to compile,
    // with its own diagnostic.
    if (route === undefined) return undefined;
    if ('inlined' in route) {
      if (mayBeCollectionValued(route.inlined)) return undefined;
      // The lane of an inlined call is the lane of the inlined body, whose
      // own calls are asked the same question. A call of `h` inside the
      // inlined body of `h` (a mutually recursive pair whose definitions
      // cannot be emitted) would be inlined again without end: the guard
      // is the one the code-generation route uses (`registry.inlining`),
      // and a call met while its own body is being inlined has no known
      // lane.
      const inlining = (registry.inlining ??= new Set<string>());
      if (inlining.has(h)) return undefined;
      inlining.add(h);
      try {
        return core.isComplexValued(route.inlined);
      } finally {
        inlining.delete(h);
      }
    }
    name = route.name;
    if (registry.compiling.has(name)) {
      // A value that is a collection by its type has no scalar lane to
      // assume. A `broadcastable<T>` (the type of a recursive call of a
      // function with an untyped parameter, applied element by element at
      // the call sites) is read as its scalar `T`: the definition being
      // compiled computes one scalar per call, and `setUserFunctionLane`
      // reads the lane of that scalar (see `recordUserFunctionLane`).
      // Answering "no lane" here let the body add `1` to the `{re, im}`
      // object of the recursive call as a string.
      const callType = expr.type.type;
      if (expr.type.matches('collection<any>')) return undefined;
      const scalarType =
        typeof callType !== 'string' && callType.kind === 'broadcastable'
          ? callType.elements
          : callType;
      if (scalarType !== callType ? false : mayBeCollectionValued(expr))
        return undefined;
      // The assumption follows the lane discipline in force: a complex
      // type, or a wide type (`number`) under `mode: 'complex'`, which
      // reads every wide value as complex. A definition that the first
      // compilation proved complex is compiled again with the complex
      // assumption (`assumedComplex`). Otherwise the call is assumed real,
      // and `setUserFunctionLane` checks that assumption against the lane
      // of the body.
      const t = finitePartOfType(scalarType);
      if (
        lanes.assumedComplex.has(name) ||
        isNonRealNumber(t) ||
        wideIsComplex(t)
      )
        return true;
      lanes.assumedReal.add(name);
      return false;
    }
    lanes.byNode.set(expr, name);
  }
  if (lanes.byName.has(name)) return lanes.byName.get(name);
  if (wideNumericType(finitePartOfType(expr.type.type)))
    throw new Error(
      `Could not compile a call of \`${h}\`: its type is ` +
        `\`${expr.type.toString()}\`, which does not say whether the call ` +
        `returns a real or a complex value, and the definition of \`${h}\` ` +
        `on target '${target.language}' does not say either. Declare the ` +
        `signature of \`${h}\`, for example \`${h}: (real) -> complex\` or ` +
        `\`${h}: (real) -> real\`.`
    );
  return undefined;
}

/**
 * The target languages whose user-function definitions record the lane of
 * their value (`recordUserFunctionLane`). On another target a user-function
 * call keeps the type-based answer of `isComplexValued`.
 */
export const LANE_RECORD_LANGUAGES: ReadonlySet<string> = new Set([
  'javascript',
  'glsl',
  'wgsl',
]);

/**
 * The definition that the call `h(args)` compiled on `target` uses,
 * emitted if it is not emitted yet: `{ name }` for an emitted definition,
 * `{ inlined }` for a call that is compiled as its substituted body, and
 * `undefined` when the call has neither (its compilation then fails).
 *
 * The routes are tested in the order of `tryCompileUserFunction`, so the
 * answer is the definition that the call itself uses: a point argument
 * with a complex coordinate is inlined (JavaScript), a call-shape
 * specialization comes next, then the inlining of a point at an untyped
 * parameter, then the ordinary definition, and the inlining of a call whose
 * definition cannot be emitted. An invariant-prefix variant has the body
 * of the ordinary definition, so the ordinary definition answers for it.
 *
 * The emission is done with the caller's bindings hidden
 * (`withCallerBindingsHidden`): it can start inside an analysis of the
 * caller (a `Sum` whose index is shielded, a `Block` local frame), and an
 * emitted definition is a module-level function that sees none of these.
 * The definitions that this emission adds to the preamble are noted, so
 * that the ones the compiled code does not reference can be removed.
 */
export function userCallDefinition(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): { name: string } | { inlined: Expression } | undefined {
  const registry = target.userFunctions;
  if (registry === undefined) return undefined;
  const inline = (): { inlined: Expression } | undefined => {
    const inlined = inlinedUserFunctionCall(engine, h, args, target);
    return inlined === undefined ? undefined : { inlined };
  };
  // `name` is `undefined` when the route has no definition, and the result
  // is `undefined` when the emission threw.
  const emit = (
    fn: () => string | undefined
  ): { name: string | undefined } | undefined => {
    const before = new Set(registry.defs.keys());
    try {
      return { name: core.withCallerBindingsHidden(fn) };
    } catch (e) {
      if (e instanceof Error && e.name === 'CancellationError') throw e;
      // The emission failed. A definition emitted during the failed
      // emission can call the one that failed (a mutually recursive `h`
      // emitted while `g` compiled), and that name is never defined:
      // remove them.
      removeDefinitionsAddedSince(registry, before);
      // Inside the compilation of another definition, the failure is the
      // enclosing definition's failure too: its body would keep a call of
      // a name that is never emitted (`_fn_h` calling `_fn_g` after `g`
      // failed). The error reaches the call site of the enclosing
      // definition, which inlines it or fails closed. At the top level the
      // call is inlined or fails.
      if (registry.compiling.size > 0) throw e;
      return undefined;
    } finally {
      const lanes = userFunctionLanes(registry);
      for (const name of registry.defs.keys())
        if (!before.has(name)) lanes.onAsk.add(name);
    }
  };
  const literal = userFunctionLiteral(engine, h);
  if (
    literal !== undefined &&
    !registry.lowering &&
    complexCoordinateArgumentAt(engine, args, target) >= 0
  )
    return inline();
  if (literal !== undefined) {
    const specialized = emit(
      () =>
        core.ensureSpecializedUserCallEmitted(engine, h, literal, args, target)
          ?.name
    );
    if (specialized === undefined) return undefined;
    if (specialized.name !== undefined) return { name: specialized.name };
  }
  if (pointArgumentAtUntypedParameter(engine, h, args) >= 0) return inline();
  const ordinary = emit(() =>
    core.ensureUserFunctionEmitted(engine, h, target)
  );
  if (ordinary === undefined) return inline();
  return ordinary.name === undefined ? undefined : { name: ordinary.name };
}

/**
 * Run `emitBody`, the compilation of the body of the definition `name`,
 * and compile it a second time when the first compilation read a recursive
 * call of the definition as real and the body then returned a complex
 * value (`setUserFunctionLane` throws `RecursiveLaneRetry`).
 *
 * The lane of a recursive call is not known while its own definition
 * compiles, so it is assumed: complex for a complex type, or for a wide
 * type (`number`) under `mode: 'complex'`, real otherwise
 * (`userCallLane`). With `f: (integer) -> number` and
 * `f := n ↦ (i if n = 0, n·f(n − 1) otherwise)`, the real assumption
 * compiles `n·f(n − 1)` as a real product, but the body returns a complex
 * value. The second compilation reads the recursive calls as complex
 * (`assumedComplex`), and its body is complex too, so the lanes agree. At
 * most two compilations run for one definition.
 *
 * The same holds for the ENTRIES of a collection body. With
 * `f: (integer) -> matrix<number>` and
 * `f := n ↦ ([[i, 0], [0, 1]] if n = 0, f(n − 1)² otherwise)`, the type
 * `matrix<number>` of the recursive call does not say whether its entries
 * are complex, so the first compilation squares it with the real matrix
 * helper, which answers NaN entries for a complex entry. The body returns
 * complex entries, so the second compilation reads the entries of the
 * recursive calls as complex (`assumedComplexElements`).
 *
 * Before the second compilation, the definitions that the first one
 * emitted are removed. They were compiled with the wrong lane of this
 * definition (a mutually recursive `g` called by `f`), and are emitted
 * again when the second compilation reaches them.
 */
export function emitWithRecursiveLaneRetry<T>(
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  name: string,
  emitBody: () => T
): T {
  const lanes = userFunctionLanes(registry);
  const before = new Set(registry.defs.keys());
  const complexShapedBefore = new Set(registry.complexShaped ?? []);
  let elements = false;
  try {
    return emitBody();
  } catch (e) {
    if (
      !(e instanceof Error) ||
      e.name !== 'RecursiveLaneRetry' ||
      (e as Error & { definition?: string }).definition !== name
    )
      throw e;
    elements = (e as Error & { elements?: boolean }).elements === true;
  }
  removeDefinitionsAddedSince(registry, before);
  if (registry.complexShaped !== undefined)
    registry.complexShaped = complexShapedBefore;
  if (elements) {
    lanes.assumedRealElements.delete(name);
    lanes.assumedComplexElements.add(name);
  } else {
    lanes.assumedReal.delete(name);
    lanes.assumedComplex.add(name);
  }
  _invalidateComplexMemo();
  return emitBody();
}

/**
 * Record the lane of the value that the definition `name` of the user
 * function `id` returns, read from `body`, the expression the definition
 * returns: complex, real, or not a scalar. Read by `userCallLane`.
 *
 * Must be called inside the shape frames that the body was compiled under,
 * with the target that compiled it, so that the analysis reads the
 * parameters as the body does: the parameters are the bound names of that
 * target (`boundVars`), and a parameter named `i` is then not the
 * imaginary unit. The JavaScript definition route calls it, and a target
 * with its own definition lowering calls it from its `define` hook (the
 * shader targets).
 *
 * When a recursive call in the body was read as real while the
 * definition was compiling (`userCallLane`), and the body returns a complex
 * value, the body was compiled with a wrong lane. That fails closed, with a
 * diagnostic that asks for a declared signature.
 */
export function recordUserFunctionLane(
  target: CompileTarget<Expression>,
  id: string,
  name: string,
  body: Expression
): void {
  const registry = target.userFunctions;
  if (registry === undefined) return;
  // A body that MAY be a collection without being one by its type
  // (`broadcastable<number>`: the body of a function with an untyped
  // parameter, which the call sites apply element by element) has no lane
  // for the whole call, but the definition itself computes one scalar, and
  // the recursion check reads the lane of that scalar.
  const scalarComplex = body.type.matches('collection<any>')
    ? false
    : withBoundVarsOf(target, () => core.isComplexValued(body));
  setUserFunctionLane(
    registry,
    id,
    name,
    mayBeCollectionValued(body) ? undefined : scalarComplex,
    scalarComplex
  );
  // The lane of the entries of a collection body, read by a
  // linear-algebra head over a call of the definition. The declared
  // result type of the function cannot give it: `(real) -> matrix<number>`
  // says nothing about the entries of `[[t, i], [2, 3]]`.
  //
  // A recursive call read while the definition was compiling had no
  // record, and the lane of its entries was taken from its type
  // (`userCallElementLane`). When the body returns complex entries, that
  // reading may be wrong: the definition is compiled again with the
  // entries of the recursive calls read as complex
  // (`emitWithRecursiveLaneRetry`).
  if (body.type.matches('collection<any>')) {
    const lanes = userFunctionLanes(registry);
    const elementLane = withBoundVarsOf(target, () =>
      core.linearAlgebraOperandLane(body)
    );
    if (
      elementLane === 'complex' &&
      lanes.assumedRealElements.has(name) &&
      !lanes.assumedComplexElements.has(name)
    ) {
      const retry = new Error(
        `${id}: recompile with complex entries of the recursive calls`
      );
      retry.name = 'RecursiveLaneRetry';
      (retry as Error & { definition?: string }).definition = name;
      (retry as Error & { elements?: boolean }).elements = true;
      throw retry;
    }
    lanes.elementByName.set(name, elementLane);
  }
}

/**
 * Run `fn`, an analysis, with the bound names of `target` in force, as
 * `compile()` puts them in force for the compilation of a node with that
 * target: the same `_boundVarsCtx`, and the same unrolled index values
 * masked.
 */
export function withBoundVarsOf<T>(
  target: CompileTarget<Expression>,
  fn: () => T
): T {
  const prev = CompilerState._boundVarsCtx;
  const next = target.boundVars ?? prev;
  if (next === prev) return fn();
  CompilerState._boundVarsCtx = next;
  _invalidateComplexMemo();
  const rebound = _enterUnrolledIndexBinder(boundNamesAddedBy(next));
  try {
    return fn();
  } finally {
    CompilerState._boundVarsCtx = prev;
    _invalidateComplexMemo();
    _exitUnrolledIndexBinder(rebound);
  }
}

export function hasAnyComplexElement(collection: Expression): boolean {
  return core.elementComplexness(collection)?.some((e) => e) ?? false;
}

/**
 * Whether an application of `h` over one or more array operands lowers, on
 * this target, to ONE scalar closure mapped over its arrays by
 * `tryCompileBroadcast` — a built-in `broadcastable` head with a JavaScript
 * codegen, no broadcast exemption that method does not itself reproduce,
 * and no user `operators` override that takes the list operands over. The
 * elements of such an emission all share the closure's value shape, which
 * is what {@link operandElementLane} relies on.
 */
export function isElementwiseBroadcastHead(
  engine: ComputeEngine,
  h: string,
  target: CompileTarget<Expression>
): boolean {
  const def = engine.lookupDefinition(h);
  if (!isOperatorDef(def) || def.operator.broadcastable !== true) return false;
  if (
    def.operator.broadcastExemptions.length > 0 &&
    !['Add', 'Multiply', 'Negate', 'Subtract', 'Divide'].includes(h)
  )
    return false;
  if (h === 'Equal' || h === 'NotEqual' || isRelationalOperator(h))
    return false;
  if (LOGICAL_BROADCAST_HEADS.has(h)) return false;
  const opMap = target.operators?.(h);
  if (opMap !== undefined && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(opMap[0]))
    return false;
  return target.functions?.(h) !== undefined;
}

/** The array arm of {@link operandElementLane}; the memo lives above. */
export function _operandElementLane(
  a: Expression,
  engine: ComputeEngine,
  target: CompileTarget<Expression>
): ElementLane {
  const elements = core.elementComplexness(a);
  if (elements !== undefined && elements.length > 0)
    return elements.every((e) => e === elements[0]) ? elements[0] : 'mixed';
  const t = compilationType(a);
  const isRank2 =
    typeof t !== 'string' &&
    t.kind === 'list' &&
    (t.dimensions?.length ?? 0) > 1;
  if (
    !isRank2 &&
    isFunction(a) &&
    isElementwiseBroadcastHead(engine, a.operator, target)
  ) {
    const lanes = a.ops.map((op) =>
      core.operandElementLane(op, engine, target)
    );
    if (lanes.some((l) => l === undefined)) return undefined;
    if (lanes.some((l) => l === 'mixed')) return 'mixed';
    return core.isComplexValued(a);
  }
  // A `Reduce` or `Scan` with `Add` or `Multiply` emits the same
  // shape-agnostic combiner as `Sum` and `Product` (`_SYS.sadd`/
  // `_SYS.smul`), so its entries are numbers or `{re, im}` objects as the
  // elements are, wherever `Sum` of the same collection is read as
  // complex-shaped (`isComplexValued`): elements of unknown type
  // (`list<unknown>`), or rows whose cells are not provably real. With the
  // real lane, the parent read a complex entry with `+`:
  // `Reduce(L, Add, 0) + 1` over `[[1, 2], [i, 3]]` gave
  // `["[object Object]1", 6]`, while `Sum(L) + 1` gave `[1 + i, 7]`. Rows
  // of real numbers (`list<list<real>>`) keep the real lane, so a
  // real-only parent (`Floor`) still compiles.
  if (
    isFunction(a) &&
    (a.operator === 'Reduce' || a.operator === 'Scan') &&
    a.nops >= 2 &&
    (isSymbol(a.ops[1], 'Add') || isSymbol(a.ops[1], 'Multiply')) &&
    (foldsCollectionElements(a.ops[0])
      ? linearAlgebraLane([a.ops[0]]) !== 'real'
      : !collectionFoldsReal(a.ops[0]))
  )
    return 'mixed';
  const complexEvidence =
    typeHasComplexLeaf(t, undefined, complexDiscipline()) ||
    hasAnyComplexElement(a) ||
    core.isComplexValued(a);
  if (!complexEvidence) return false;
  // A possibly-collection operand (`bc: broadcastable<complex>`, a
  // top-typed call) is a SCALAR at run time as often as an array, and a
  // scalar binding of a complex-typed parameter is refused at the
  // compiled function's entry (the parameter analysis reads such a type
  // as real). Compiling the array case behind that refusal would trade
  // an honest decline for a run-time throw, so this shape keeps
  // declining (pinned in `broadcastable-compile.test.ts`).
  //
  // A FOLD over a collection is not such a binding: its value is
  // computed by the compiled code, not passed by the host, so no entry
  // check refuses it. Its value is a number, a `{re, im}` object, or an
  // array whose entries are either: the shape-agnostic combiner
  // (`_SYS.sadd`/`_SYS.smul`) gives a complex entry only where an
  // element was complex. `'mixed'` is the lane that reads each of these
  // shapes. Before this rule, `Sum(L) + 1` with `L: list<unknown>` did
  // not compile, although `L` holds only real numbers in most programs.
  //
  // The `complex` mode (`complexDiscipline`) is not such a binding either:
  // there the scalar binding of a wide type (`broadcastable<number>`,
  // `number | list<number>`) is complex too, so the entry accepts a
  // `{re, im}` scalar, and the scalar and the cells take their lane from
  // the same evidence. `'mixed'` lowers through the dispatching helpers,
  // which read the shape of the value when the code runs: a number, a
  // `{re, im}` object, or an array of either. (ROADMAP CE-215.2.)
  if (isBoundPossiblyCollectionTyped(a))
    return isCollectionFold(a) || complexDiscipline() ? 'mixed' : undefined;
  return 'mixed';
}

/** Whether `a` folds a collection into one value with a builtin or a
 * custom combiner: `Sum(L)` and `Product(L)` (one operand, no index),
 * `Reduce(L, f, …)` and `Scan(L, f, …)`. */
export function isCollectionFold(a: Expression): boolean {
  if (!isFunction(a)) return false;
  if (a.operator === 'Sum' || a.operator === 'Product') return a.nops === 1;
  return (a.operator === 'Reduce' || a.operator === 'Scan') && a.nops >= 2;
}

/**
 * Whether a collection type has a complex-typed LEAF anywhere in its
 * element structure — a `list<complex>`, a point list whose declared
 * column type is complex (`list<tuple<number, complex>>`), a nested
 * `list<list<complex>>`. The broadcast closure is applied at the leaves,
 * so a complex leaf is what makes an element lane undecidable from the
 * type alone.
 *
 * The walk descends through tuple components, union arms and collection
 * elements, so a self-referential transparent alias
 * (`type alias json = integer | list<json>`) is met again at every level;
 * the descent guard (`unfoldAliasOnDescent`) stops the recursion when the
 * alias reaches itself, and that occurrence contributes no leaf.
 *
 * With `wide` set, a leaf of a WIDE numeric type (`wideNumericType`:
 * `number`, `unknown`, `any`) counts as a complex leaf too: such a leaf
 * admits a complex value, which the `complex` mode reads as complex.
 */
export function typeHasComplexLeaf(
  t: Type,
  seen?: AliasDescent,
  wide = false
): boolean {
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  const r = unfolded.type;
  seen = unfolded.seen;
  if (isNonRealNumber(r)) return true;
  if (wide && wideNumericType(r)) return true;
  // A collection written by its bare name (`list`, `set`) has `any`
  // elements, which `leafwardElementType` returns: the walk continues
  // to them below. A bare `list` in the complex mode is then read as a
  // `list<any>`, as the type system reads it, and not as a list of real
  // numbers.
  if (typeof r === 'string') {
    const elt = leafwardElementType(r);
    return elt !== undefined && typeHasComplexLeaf(elt, seen, wide);
  }
  if (r.kind === 'tuple')
    return r.elements.some((e) => typeHasComplexLeaf(e.type, seen, wide));
  if (r.kind === 'union')
    return r.types.some((m) => typeHasComplexLeaf(m, seen, wide));
  // Toward the cells (`leafwardElementType`): the element of a tensor of
  // unknown rank contains the tensor itself, which would send the walk
  // round for ever.
  const elt = leafwardElementType(r);
  if (elt === undefined) return false;
  return typeHasComplexLeaf(elt, seen, wide);
}

/**
 * Whether every leaf entry of the static type `t` is WIDE
 * (`wideNumericType`: `number`, `unknown`, a non-real type), descending
 * through collections, tuples and unions like `typeHasComplexLeaf`.
 */
export function wideEntriesType(t: Type, seen?: AliasDescent): boolean {
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  const r = unfolded.type;
  seen = unfolded.seen;
  if (typeof r !== 'string' && r.kind === 'tuple')
    return r.elements.every((e) => wideEntriesType(e.type, seen));
  if (typeof r !== 'string' && r.kind === 'union')
    return r.types.every((m) => wideEntriesType(m, seen));
  // Toward the cells (`leafwardElementType`), as in `typeHasComplexLeaf`.
  const elt = leafwardElementType(r);
  if (elt !== undefined) return wideEntriesType(elt, seen);
  return wideNumericType(r);
}

/** The ascribed type of the `Typed` node `typed`, as its second operand
 * `type` spells it. */
export function ascriptionText(type: Expression, typed: Expression): string {
  return isString(type)
    ? type.string
    : isSymbol(type)
      ? type.symbol
      : typed.type.toString();
}

/**
 * The decline of a real ascription (`Typed(value, type)`, the `Typed`
 * node `typed`) over a value that the analysis reads as complex.
 */
export function realAscriptionError(
  value: Expression,
  type: Expression,
  typed: Expression
): Error {
  const ascribed = ascriptionText(type, typed);
  return new Error(
    `Could not compile \`Typed\`: the value \`${value.toString()}\` is complex, but its ` +
      `ascribed type \`${ascribed}\` says it is real. The compiled ` +
      `code would read the complex value as a real number. When the ` +
      `ascription comes from a declared signature, declare a result ` +
      `type that admits a complex value, for example ` +
      `\`(unknown) -> complex\` instead of \`(unknown) -> real\`.`
  );
}

/**
 * Whether the `Typed` node `typed` ascribes a real scalar type: its type,
 * without the `NaN` and infinity members of a union, is `real` or a subtype
 * of it (`real`, `finite_real`, `nan | real`, `integer`), and the analysis
 * reads the node on the real lane. Such an ascription selects the real lane
 * for its value (see the `Typed` lowering in `compileExpr`). A type that
 * admits a complex value (`number`, `complex`) is not a real ascription.
 */
export function isRealScalarAscription(typed: Expression): boolean {
  const t = typed.type.type;
  if (t === 'never' || !isSubtype(finitePartOfType(t), 'real')) return false;
  return !core.isComplexValued(typed);
}

/**
 * Whether the static type `t` proves that every entry of the value is a
 * real number (`matrix<real>`, `list<integer>`, `tuple<real, real>`). A
 * `number` or `unknown` entry is not proved real: a symbol declared
 * `matrix<number>` can receive `{re, im}` entries when the code runs.
 */
export function realEntriesType(t: Type, seen?: AliasDescent): boolean {
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  // A signed infinity is a real value on every target (`Infinity` in
  // JavaScript), so the infinite members of a union entry type
  // (`integer | signed_infinity`, the type of `Floor(x)`) do not make the
  // entry wide. They are removed before the union is split, as the leaf
  // test below removes them.
  const r = finitePartOfType(unfolded.type);
  seen = unfolded.seen;
  if (typeof r !== 'string' && r.kind === 'tuple')
    return r.elements.every((e) => realEntriesType(e.type, seen));
  if (typeof r !== 'string' && r.kind === 'union')
    return r.types.every((m) => realEntriesType(m, seen));
  // Toward the cells (`leafwardElementType`), as in `typeHasComplexLeaf`.
  const elt = leafwardElementType(r);
  if (elt !== undefined) return realEntriesType(elt, seen);
  return isSubtype(finitePartOfType(stripMissingFromType(r)), 'real');
}

/**
 * The lane of the entries of the collection that the call `a` of a
 * USER-defined function returns, as the definition that the call uses
 * emits it (`recordUserFunctionLane`), or `undefined` when `a` is not
 * such a call, the definition is not emitted, or its body is not a
 * collection. An inlined call has the lane of the substituted body. The
 * definition is found, and emitted when needed, by the route of
 * `userCallLane`.
 */
export function userCallElementLane(
  a: Expression
): 'real' | 'complex' | 'wide' | undefined {
  if (!isFunction(a)) return undefined;
  const h = a.operator;
  const target = CompilerState._callSiteTarget;
  const registry = target?.userFunctions;
  if (
    target === undefined ||
    registry === undefined ||
    !LANE_RECORD_LANGUAGES.has(target.language ?? '')
  )
    return undefined;
  const lanes = userFunctionLanes(registry);
  let name = lanes.byNode.get(a);
  if (name === undefined) {
    const engine = a.engine;
    if (!isUserDefinedFunction(engine, h)) return undefined;
    const route = userCallDefinition(engine, h, a.ops, target);
    if (route === undefined) return undefined;
    if ('inlined' in route)
      return route.inlined.type.matches('collection<any>')
        ? core.linearAlgebraOperandLane(route.inlined)
        : undefined;
    name = route.name;
    // A recursive call, reached while its own definition is compiling, has
    // no record yet. The lane of its entries is read from its type, and
    // the definition records that assumption: when the body then returns
    // complex entries, the definition is compiled again with the entries
    // of the recursive calls read as complex (`recordUserFunctionLane`).
    if (registry.compiling.has(name)) {
      if (lanes.assumedComplexElements.has(name)) return 'complex';
      lanes.assumedRealElements.add(name);
      return undefined;
    }
    lanes.byNode.set(a, name);
  }
  return lanes.elementByName.get(name);
}

/**
 * The lane of the collection operand `a` read from its STRUCTURE, when its
 * type does not give it, or `undefined`. The result type of several heads
 * loses the element type: `MatrixPower(A, 2)` types `matrix` and
 * `Cross(u, u)` types `vector` for a `matrix<real>` `A` and a
 * `vector<real>` `u`, so their lane read from the type is wide, although
 * the value has real entries.
 *
 * - A linear-algebra head (`linearAlgebraLaneOperands`) has the lane of its
 *   own collection operands (`linearAlgebraLane`): the helper that the
 *   target emits for it is chosen with that lane, and it returns real
 *   entries for a real lane.
 * - A head that only moves the entries of its first operand (`Transpose`,
 *   `Reverse`, `Flatten`, `Reshape`) has the lane of that operand.
 *   `ConjugateTranspose` also conjugates the entries, which keeps a real
 *   entry real and a complex entry complex.
 *
 * `Map(x ↦ body, c)` needs no structural answer: its type handler gives
 * the element type of the result (`vector<real>` for a real body over a
 * `vector<real>`).
 */
export function structuralOperandLane(
  a: Expression
): 'real' | 'complex' | 'wide' | undefined {
  if (!isFunction(a)) return undefined;
  const h = a.operator;
  const laneOperands = linearAlgebraLaneOperands(h, a.ops);
  if (laneOperands !== undefined) return linearAlgebraLane(laneOperands);
  if (
    (h === 'Transpose' ||
      h === 'ConjugateTranspose' ||
      h === 'Reverse' ||
      h === 'Flatten' ||
      h === 'Reshape') &&
    a.ops.length >= 1
  )
    return core.linearAlgebraOperandLane(a.ops[0]);
  return undefined;
}

/**
 * The lane of a linear-algebra head over the collection operands
 * `operands`: `'complex'` when one operand is complex (the complex helper
 * lifts the real entries of the others), `'wide'` when no operand is
 * complex and one is wide, and `'real'` otherwise. See
 * {@link linearAlgebraOperandLane}.
 */
export function linearAlgebraLane(
  operands: ReadonlyArray<Expression>
): 'real' | 'complex' | 'wide' {
  const lanes = operands.map((a) => core.linearAlgebraOperandLane(a));
  if (lanes.includes('complex')) return 'complex';
  if (lanes.includes('wide')) return 'wide';
  return 'real';
}

/**
 * The collection operands of the linear-algebra head `h` whose lane
 * ({@link linearAlgebraLane}) decides the value of the head, or `undefined`
 * when `h` is not such a head. `Distance` is not listed: its value is a
 * real number for real and complex coordinates alike. `RowReduce` is not
 * listed: it has no complex value, and a complex operand fails closed.
 */
export function linearAlgebraLaneOperands(
  h: string,
  ops: ReadonlyArray<Expression>
): ReadonlyArray<Expression> | undefined {
  switch (h) {
    case 'Determinant':
    case 'Inverse':
    case 'Trace':
    case 'MatrixPower':
      return ops.slice(0, 1);
    case 'Dot':
    case 'MatrixMultiply':
    case 'Cross':
      return ops.slice(0, 2);
    default:
      return undefined;
  }
}

/**
 * The operands the real-only gate scans and binds for head `h`: the args
 * themselves, except `ColorFromColorspace`, whose maybe-complex scalars
 * live INSIDE its literal components tuple/list — the elements are
 * returned so `realOperandGuard` binds each one (its `_codeOverrides`
 * substitution reaches them when the components literal re-compiles
 * inside the guarded body). A non-literal components operand keeps the
 * default, and with it the compile-time fail-closed decline.
 */
export function realOnlyGuardOperands(
  h: string,
  args: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  if (h !== 'ColorFromColorspace' || args.length === 0) return args;
  const comps = args[0];
  if (!isFunction(comps, 'Tuple') && !isFunction(comps, 'List')) return args;
  return [...comps.ops, ...args.slice(1)];
}

/**
 * Whether the caller of the compilation supplied its own lowering of the
 * head `h` (a `functions` or `operators` entry). The built-in dispatches
 * of this compiler that replace a head's lowering (the matrix power of
 * `compileRuntimeMatrixPower`, the complex statistics of
 * `complexLoweringOf`) stand aside for it. The compilation records the
 * caller's names on its common-subexpression session, also when that
 * pass is off; a compilation that recorded nothing (a direct custom
 * target, whose lowerings are all the caller's) counts as overriding.
 */
export function callerOverrides(
  target: CompileTarget<Expression>,
  h: string
): boolean {
  const provenance = target.cse?.harvestOptions;
  return (
    provenance === undefined || provenance.isOverriddenOperator?.(h) === true
  );
}
