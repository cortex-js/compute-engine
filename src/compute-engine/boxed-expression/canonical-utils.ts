import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types.js';
import type { Rational } from '../numerics/types.js';
import { isZero } from '../numerics/rationals.js';
import { SMALL_INTEGER } from '../numerics/numeric.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { isFunction, isNumber, isSymbol } from './type-guards.js';
import {
  isFunctionLiteralCapture,
  isFunctionLiteralParameter,
} from './function-literal.js';

/**
 * Ensure all expressions in the array are in canonical form
 */
export function canonical(
  ce: ComputeEngine,
  xs: ReadonlyArray<Expression>,
  scope?: Scope
): ReadonlyArray<Expression> {
  // Avoid memory allocation if possible
  if (xs.every((x) => x.isCanonical)) return xs;

  return xs.map((x) => ce.expr(x, { scope }));
}

/**
 * The exact real component (`rational · √radical`) of a boxed expression that
 * is an exact real number literal, or `null` for anything else (an inexact
 * float, a complex value, NaN, an infinity, a non-number). Used to build exact
 * complex literals from their components.
 */
export function exactRealComponent(
  op: Expression
): { rational: Rational; radical: number } | null {
  if (!isNumber(op)) return null;
  const nv = op.numericValue;
  if (typeof nv === 'number') {
    if (!Number.isInteger(nv)) return null;
    return { rational: [nv, 1], radical: 1 };
  }
  if (nv.isComplex) return null;
  const exact = nv.asExact;
  if (!(exact instanceof ExactNumericValue)) return null;
  if (exact.isNaN || exact.isPositiveInfinity || exact.isNegativeInfinity)
    return null;
  return { rational: exact.rational, radical: exact.radical };
}

/** The two exact real components of `re + im·i`, when both operands are exact
 * real literals and the imaginary part is not zero; `null` otherwise. */
export function exactComplexParts(
  reOp: Expression,
  imOp: Expression
): {
  re: { rational: Rational; radical: number };
  im: { rational: Rational; radical: number };
} | null {
  const re = exactRealComponent(reOp);
  if (re === null) return null;
  const im = exactRealComponent(imOp);
  if (im === null || isZero(im.rational)) return null;
  return { re, im };
}

/**
 * The EXACT complex literal `re + im·i` built from two exact components, or
 * `null` when one exact literal cannot hold the pair. One literal holds a
 * pure-imaginary value, or two components with the same radical (`√2 + √2·i`);
 * two different radicals (`√2 + √3·i`) do not fit, and a radical past
 * `SMALL_INTEGER` is not reduced. This is what makes
 * `ExactNumericValue.toJSON()` lossless: `['Complex', ['Rational', 1, 2], 3]`
 * re-boxes to the exact `1/2 + 3i`, not a machine float.
 */
export function exactComplexLiteral(
  ce: ComputeEngine,
  parts: NonNullable<ReturnType<typeof exactComplexParts>>,
  options?: Parameters<ComputeEngine['number']>[1]
): Expression | null {
  const { re, im } = parts;
  if (!(isZero(re.rational) || re.radical === im.radical)) return null;
  if (im.radical > SMALL_INTEGER || re.radical > SMALL_INTEGER) return null;
  return ce.number(
    ce._numericValue({
      rational: re.rational,
      radical: re.radical,
      imRational: im.rational,
      imRadical: im.radical,
    }),
    options
  );
}

/**
 * The number literal `coefficient · i` (a pure imaginary number) for a
 * number-literal coefficient.
 *
 * An exact coefficient (an integer of any size, a rational, a radical) gives
 * the EXACT pure-imaginary literal, the same value that `["Complex", 0, c]`
 * boxes to and that `i · c` multiplies to, so that `√(4i)` is `√2(1 + i)` and
 * `(4i)²` is computed exactly. An inexact coefficient (`1.5i`) gives an
 * INEXACT (floating-point) value, with the precision of the coefficient. A
 * zero coefficient is the real zero.
 */
export function imaginaryNumber(
  ce: ComputeEngine,
  coefficient: Expression,
  options?: Parameters<ComputeEngine['number']>[1]
): Expression {
  const c = exactRealComponent(coefficient);
  if (c !== null) {
    if (isZero(c.rational)) return ce.Zero;
    if (c.radical <= SMALL_INTEGER)
      return ce.number(
        ce._numericValue({
          rational: [0, 1],
          imRational: c.rational,
          imRadical: c.radical,
        }),
        options
      );
  }
  // An inexact coefficient keeps its big decimal when it has one: the double
  // constructor `ce.complex()` would round `10^{-800}` to `0`.
  return ce.number(
    ce._numericValue({
      re: 0,
      im: coefficient.bignumRe ?? coefficient.re ?? NaN,
    }),
    options
  );
}

/**
 * The operators of an arithmetic cell of a literal list that the type of the
 * list reads as a number when its leaves are numbers and free symbols
 * (`isArithmeticOverFreeSymbols()`).
 */
export const FREE_SYMBOL_ARITHMETIC_OPERATORS: ReadonlySet<string> = new Set([
  'Negate',
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Power',
  'Sqrt',
  'Root',
]);

/**
 * True when `op` is a free symbol: a symbol with no value, which is not a
 * constant, not the `Undefined` symbol, not a pattern wildcard (a name that
 * starts with `_`), and which a scope of the current context binds, other
 * than the system scope. The type of the symbol is not tested.
 *
 * Some bindings are not free in this sense: a parameter of a function
 * literal can receive any value (with `g := x ↦ [x]`, the call
 * `g(Set(1, 2))` is `[Set(1, 2)]`), a `let` local of a block has a type
 * that is not known yet, the variable of a binder (a `Sum` index) is typed
 * by its binder, and a wildcard such as `_a` matches any expression in a
 * pattern. The type of such a symbol is not inferred from a literal list.
 * A symbol of a scope that `ce.pushScope()` added is free: it is inferred
 * as a symbol of the global scope is.
 *
 * The symbol node of an operand descriptor carries this fact (`free`, set
 * by `structureOfExpression()` in `operand-descriptor.ts`), and the type of
 * a literal list reads a symbol as a number cell only when the fact is
 * present. So the type of the list reads as numbers exactly the symbols
 * that `narrowFreeSymbolCells()` infers as numbers.
 */
export function isFreeSymbol(op: Expression): boolean {
  if (!isSymbol(op) || op.symbol === 'Undefined') return false;
  const def = op.valueDefinition;
  if (def === undefined || def._blockLocal === true) return false;
  if (def.value !== undefined || def.isConstant) return false;
  if (op.symbol.startsWith('_')) return false;
  if (isFunctionLiteralParameter(def)) return false;
  const ce = op.engine;
  const system = ce.contextStack[0]?.lexicalScope;
  // The scope of a context can be absent, and the root scope's `parent` can
  // be `undefined` at run time, not `null`: the loop stops on either.
  for (
    let s: Scope | null | undefined = ce.context?.lexicalScope;
    s;
    s = s.parent
  ) {
    const b = s.bindings.get(op.symbol);
    if (b === undefined) continue;
    // The first binding of the name is the one a lookup finds. When it is
    // not `def`, the symbol is not visible from the current context.
    if (typeof b !== 'object' || !('value' in b) || b.value !== def)
      return false;
    return s !== system && s.binderNames?.has(op.symbol) !== true;
  }
  return false;
}

/**
 * True when `op` is an occurrence of the body of a function literal that
 * reads a symbol from outside the literal (`isFunctionLiteralCapture()`),
 * and the symbol has no value now. When the body is evaluated, the
 * occurrence reads the value that the symbol has at that time: with
 * `f := t ↦ g(y)`, a later `y := [1, 2, 3]` is the value that `f(1)` reads.
 * The type of the symbol is not tested.
 *
 * The symbol node of an operand descriptor carries this fact (`captured`,
 * set by `structureOfExpression()` in `operand-descriptor.ts`).
 */
export function isCapturedValuelessSymbol(op: Expression): boolean {
  if (!isSymbol(op) || !isFunctionLiteralCapture(op)) return false;
  const def = op.valueDefinition;
  if (def === undefined) return true;
  return def.value === undefined && !def.isConstant;
}

/** True when `op` is a free symbol (`isFreeSymbol()`) of type `unknown`. */
function isFreeSymbolCell(op: Expression): boolean {
  return isSymbol(op) && op.type.type === 'unknown' && isFreeSymbol(op);
}

/**
 * True when `op` is an application of type `unknown` of one of the
 * `FREE_SYMBOL_ARITHMETIC_OPERATORS`, and each of its operands is a number
 * literal, a free symbol (`isFreeSymbolCell()`), an expression of a numeric
 * type, or such an application. The free symbols are added to `symbols`.
 *
 * An application of this kind is typed `unknown` only because a free
 * symbol in it is `unknown`: `.neg()` and `.add()` build `Negate(t)` and
 * `Add(g, h)` without the inference that `ce.box()` makes on the operands.
 */
function isArithmeticOverFreeSymbols(
  op: Expression,
  symbols: Expression[]
): boolean {
  if (!isFunction(op) || !FREE_SYMBOL_ARITHMETIC_OPERATORS.has(op.operator))
    return false;
  if (op.type.type !== 'unknown') return false;
  for (const x of op.ops) {
    if (isNumber(x)) continue;
    if (isFreeSymbolCell(x)) {
      symbols.push(x);
      continue;
    }
    if (isArithmeticOverFreeSymbols(x, symbols)) continue;
    if (x.type.matches('number')) continue;
    return false;
  }
  return true;
}

/**
 * Infer the type `number` on each free symbol of the literal list `list`
 * that the type of the list reads as a number, and return `list`.
 *
 * The type of a literal list reads an element that is a free symbol (a
 * symbol of type `unknown` with no value, which is not a `let` local of a
 * block that did not run yet) as a `number` cell (`classifyCellD()`,
 * `library/collections.ts`): `[u, v]` is typed `vector<2>`. Before this
 * inference the symbol itself stayed `unknown`, so the value of `At(L, 1)`
 * with `L := [u, v]`, which is `u`, had a type that is not a subtype of the
 * static type `number`. The use in the literal now declares the symbol as a
 * number, as the use `u + 1` does. A symbol that already has a type (a
 * boolean `A`, a list `xs`) is not changed, and the type of the list does
 * not read it as a number.
 *
 * The type of the list also reads an arithmetic cell over free symbols as a
 * number (`isArithmeticOverFreeSymbols()`), and the free symbols of such a
 * cell are inferred as numbers too. Then the type of the cell is `number`:
 * the cells `-y` and `x / (x·w - y·z)` of `AdjugateMatrix` and
 * `PseudoInverse` of `[[x, y], [z, w]]` are typed as numbers, and the value
 * is a matrix.
 *
 * The inference applies only when the type of the list gives its cells a
 * known type: when another element blocks that reading (an application of
 * unknown result type), the element type of the list is `unknown` and the
 * symbols stay as they are.
 *
 * User decision 2026-10-25, option (a) of CE-39.4 and of CE-39.6 in
 * `ROADMAP.md`.
 */
export function narrowFreeSymbolCells(list: Expression): Expression {
  if (!isFunction(list)) return list;
  let candidates: Expression[] | undefined;
  for (const op of list.ops) {
    if (isFreeSymbolCell(op)) (candidates ??= []).push(op);
    else if (
      isFunction(op) &&
      FREE_SYMBOL_ARITHMETIC_OPERATORS.has(op.operator)
    ) {
      // The operator is tested first: reading the type of every element of
      // a large list here would compute the element types during the
      // canonical form, before any reader asks for them.
      const symbols: Expression[] = [];
      if (isArithmeticOverFreeSymbols(op, symbols) && symbols.length > 0)
        (candidates ??= []).push(...symbols);
    }
  }
  if (candidates === undefined) return list;
  const t = list.type.type;
  if (typeof t === 'string' || t.kind !== 'list') return list;
  const e = t.elements;
  if (
    e === 'unknown' ||
    (typeof e !== 'string' &&
      e.kind === 'union' &&
      e.types.some((x) => x === 'unknown'))
  )
    return list;
  for (const op of candidates) op._infer(() => 'number', 'narrow');
  return list;
}
