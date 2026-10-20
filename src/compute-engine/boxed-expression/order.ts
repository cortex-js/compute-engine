import type { Expression } from '../global-types.js';

import { maxDegree, revlex, totalDegree } from './polynomial-degree.js';
import { asRadical } from './arithmetic-power.js';
import { isOperatorDef } from './utils.js';
import { mayHaveOrderedArithmetic } from './arithmetic-order-override.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import {
  isNumber,
  isFunction,
  isSymbol,
  isString,
  isObject,
  numericValue,
} from './type-guards.js';

export type Order = 'lex' | 'dexlex' | 'grevlex' | 'elim';

import { DEFAULT_COMPLEXITY } from './constants.js';
export { DEFAULT_COMPLEXITY };

/**
 * Is this operand a matrix/vector (concrete tensor, `Matrix(…)` literal, or a
 * symbol *declared* matrix/vector)? Products of two or more such operands are
 * NOT commutative, so they must never be reordered by the canonical sort
 * (`M·P ≠ P·M`; reordering made `M·P − P·M` collapse to 0 — see
 * CORRECTNESS_FINDINGS P0-26). The check is type-based: concrete tensors and
 * `Matrix` literals have matrix/vector types too, and scalar-typed or
 * unknown symbols do not match, so ordinary products like `x·y` still sort.
 */
export function isTensorProductOperand(x: Expression): boolean {
  if (isFunction(x, 'Matrix')) return true;
  const facts = x.type.facts;
  return facts.matrix || facts.vector;
}

/**
 * Can this operand be a matrix, although its type does not say so? This is
 * `true` when the type of the operand is not known to exclude a collection:
 * the type is `unknown` or `any` (the call `g(x)` of a function that was not
 * declared), a union such as `number | matrix`, or a collection that is not
 * known to be a matrix or a vector (`g(A)` with `A` a matrix has the type
 * `list<unknown^(2x2)>`). A tuple is not a matrix. An operand of a scalar
 * type (`number`, `real`, `integer`) is `false`.
 *
 * A symbol of type `unknown` (a symbol with no declaration and no value) is
 * `false`: a symbol used in a product is a number. `ce.box(['Multiply', 'A',
 * 'x'])` infers the type `number` for `x`, but `ce.parse('A x')` leaves it
 * `unknown`, and the two must give the same product. A symbol declared with
 * the type `any` is not inferred to be a number, so it is `true`.
 *
 * In a product with a matrix, such an operand must not move past a matrix
 * or past another operand of this kind: if it is a matrix, the two factors
 * do not commute.
 *
 * Limit: a product with no matrix is sorted when it is made canonical, so a
 * product nested in a product with a matrix can lose the order of its
 * factors before the outer product sees the matrix.
 * `['Multiply', 'A', ['Multiply', ['g', 'x'], ['k', 'x'], ['g', 'x']]]`
 * becomes `A·k(x)·g(x)·g(x)`, because the inner product has no matrix and
 * is sorted first. To keep that order, a product with no matrix must not be
 * sorted, and this changes the order of a scalar product such as
 * `g(x)·k(x)`.
 */
export function mayBeTensorProductOperand(x: Expression): boolean {
  const facts = x.type.facts;
  if (facts.collection === false || facts.tupleShaped) return false;
  return !(isSymbol(x) && x.type.type === 'unknown');
}

/**
 * Is the type of this operand a collection (a list, a matrix, a set) that
 * is not a tuple? This gives the same answer as `isCollectionShaped()` in
 * `collection-utils.ts`, but it reads the facts that the type keeps in a
 * cache, and does not match the type again at each call.
 */
export function hasCollectionShape(x: Expression): boolean {
  const facts = x.type.facts;
  return facts.collection === true && !facts.tupleShaped;
}

/**
 * Sort the operands of a product: with two or more matrix/vector operands,
 * keep the tensors in their written order and sort only the (commutative)
 * scalar factors, placed before them. With 0 or 1 tensor the product is
 * order-independent and the normal canonical sort applies.
 *
 * An operand that can be a matrix (see `mayBeTensorProductOperand()`) is
 * kept in its written order with the tensors when the product has at least
 * one tensor: with `A` a matrix and `g` a function that was not declared,
 * `A·g(A)·A` stays as it is, because `g(A)` can be a matrix that does not
 * commute with `A`. A product with no tensor is sorted as before, so `x·g(x)`
 * is still sorted.
 *
 * When `matrixContext` is `true`, `xs` are a part of a larger product that
 * has a tensor, and the operands that can be a matrix keep their order even
 * if no operand of `xs` is a tensor.
 */
export function sortProductOperands(
  xs: ReadonlyArray<Expression>,
  matrixContext = false
): Expression[] {
  // The tensor predicate does type-matching work: evaluate it once per
  // operand, not once per filter pass.
  const isTensor = xs.map(isTensorProductOperand);
  if (matrixContext || isTensor.some(Boolean)) {
    for (let i = 0; i < xs.length; i++)
      if (!isTensor[i]) isTensor[i] = mayBeTensorProductOperand(xs[i]);
  }
  if (isTensor.filter(Boolean).length >= 2) {
    const scalars = xs.filter((_, i) => !isTensor[i]).sort(order);
    const tensors = xs.filter((_, i) => isTensor[i]);
    return [...orderExactRadicalLiterals(scalars), ...tensors];
  }
  return orderExactRadicalLiterals([...xs].sort(order));
}

/**
 * The radicand `r` of an exact real number literal `q·√r` (`1` for a
 * rational) or of the square root `Sqrt(r)` of a positive integer literal
 * that has no exact value (`√1022117`, whose square-free part is above
 * 10⁶). Return `undefined` for any other operand.
 */
function exactRealRadicand(x: Expression): number | undefined {
  if (isFunction(x, 'Sqrt')) {
    const r = x.op1;
    if (isNumber(r) && r.isExact && r.isInteger && r.isPositive === true)
      return r.re;
    return undefined;
  }
  if (!isNumber(x) || !x.isExact || x.isFinite !== true) return undefined;
  const v = x.numericValue;
  if (typeof v === 'number') return 1;
  if (!(v instanceof ExactNumericValue) || v.isComplex) return undefined;
  return v.radical;
}

/**
 * A canonical product has more than one exact number literal when the
 * product of the literals is not an exact value: `2√1009·√1013`, because the
 * radicand 1022117 of `√1009·√1013` is above 10⁶ and has no square factor.
 * `order()` sorts number literals by value, which puts `√1013` (about 31.8)
 * before `2√1009` (about 63.5), and the product serializes as
 * `\sqrt{1013}\times2\sqrt{1009}`. This function sorts these literals by
 * their radicand, smallest first, and by `order()` for the same radicand.
 * The coefficient, which the canonical `Multiply` gives to the factor with
 * the smallest radicand, then comes first: `2\sqrt{1009}\sqrt{1013}`. A
 * square root with no exact value is sorted with them: `order()` puts
 * `√1022117` before the literal `2√2`, and this function puts it after.
 *
 * The literals keep the positions that `order()` gave to the group, so the
 * order of the other operands does not change. A product with fewer than
 * two exact literals, or with rational literals only, does not change.
 */
function orderExactRadicalLiterals(xs: Expression[]): Expression[] {
  const slots: number[] = [];
  const radicands: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const r = exactRealRadicand(xs[i]);
    if (r === undefined) continue;
    slots.push(i);
    radicands.push(r);
  }
  if (slots.length < 2 || radicands.every((r) => r === 1)) return xs;
  const literals = slots
    .map((slot, i) => ({ x: xs[slot], r: radicands[i] }))
    .sort((a, b) => (a.r !== b.r ? a.r - b.r : order(a.x, b.x)));
  const result = [...xs];
  slots.forEach((slot, i) => (result[slot] = literals[i].x));
  return result;
}

const TRIGONOMETRIC_OPERATORS: { [key: string]: boolean } = {
  Sin: true,
  Cos: true,
  Tan: true,
  Cot: true,
  Sec: true,
  Csc: true,
  Sinh: true,
  Cosh: true,
  Tanh: true,
  Coth: true,
  Sech: true,
  Csch: true,
  Arcsin: true,
  Arccos: true,
  Arctan: true,
  Arccot: true,
  Arcsec: true,
  Arccsc: true,
  Arsinh: true,
  Arcosh: true,
  Artanh: true,
  Arcoth: true,
  Arcsch: true,
  Arsech: true,
};

function isTrigonometricFunction(operator: unknown): boolean {
  if (!operator || typeof operator !== 'string') return false;
  return operator in TRIGONOMETRIC_OPERATORS;
}

/**
 * The sorting order of arguments of the Add function uses a modified degrevlex:
 * - Sort by total degree (sum of degree)
 * - Sort by max degree.
 * - Sort reverse lexicographically
 * - Sort by rank
 *
 *
 * E.g.
 * - 2x^2 + 3x + 1
 * - 2x^2y^3 + 5x^3y
 */

export function addOrder(a: Expression, b: Expression): number {
  const aTotalDeg = totalDegree(a);
  const bTotalDeg = totalDegree(b);
  if (aTotalDeg !== bTotalDeg) return bTotalDeg - aTotalDeg;

  const aMaxDeg = maxDegree(a);
  const bMaxDeg = maxDegree(b);
  if (aMaxDeg !== bMaxDeg) return bMaxDeg - aMaxDeg;

  // Get a lexicographic key of the expression
  // i.e. `xy^2` -> `x y`
  const aLex = revlex(a);
  const bLex = revlex(b);
  if (aLex || bLex) {
    if (!aLex) return +1;
    if (!bLex) return -1;
    if (aLex < bLex) return -1;
    if (aLex > bLex) return +1;
  }
  return order(a, b);
}

/**
 * Sort terms of a sum with `addOrder` semantics, computing each term's
 * degree/lexicographic keys once instead of on every comparison (`addOrder`
 * re-walks both expressions per comparison — O(n log n) walks per sort).
 * The comparator chain below returns exactly the values `addOrder` would,
 * and `Array.sort` is stable, so the result order is identical.
 */
export function sortAddTerms(
  xs: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  if (xs.length <= 1) return [...xs];
  const keyed = xs.map((x) => ({
    x,
    total: totalDegree(x),
    max: maxDegree(x),
    lex: revlex(x),
  }));
  keyed.sort((a, b) => {
    if (a.total !== b.total) return b.total - a.total;
    if (a.max !== b.max) return b.max - a.max;
    if (a.lex || b.lex) {
      if (!a.lex) return +1;
      if (!b.lex) return -1;
      if (a.lex < b.lex) return -1;
      if (a.lex > b.lex) return +1;
    }
    return order(a.x, b.x);
  });
  return keyed.map((k) => k.x);
}

export function equalOrder(a: Expression, b: Expression): number {
  // Rank 1: symbols
  // Ranks 2: expression
  // Rank 3: numbers
  const eqRank = (x: Expression): number => {
    if (isSymbol(x)) return 1;
    if (isNumber(x)) return 3;
    return 2;
  };
  const aRank = eqRank(a);
  const bRank = eqRank(b);
  if (aRank < bRank) return -1;
  if (bRank < aRank) return +1;
  if (aRank === 1) {
    const aSym = isSymbol(a) ? a.symbol : '';
    const bSym = isSymbol(b) ? b.symbol : '';
    if (aSym === bSym) return 0;
    return aSym > bSym ? 1 : -1;
  }
  if (aRank === 3 && isNumber(a) && isNumber(b)) {
    const aN = a.numericValue;
    const bN = b.numericValue;
    const af = typeof aN === 'number' ? aN : aN.re;
    const bf = typeof bN === 'number' ? bN : bN.re;
    // Total order: `af - bf` yields `NaN` for NaN operands, making the
    // comparator non-total. `compareFloat` sorts NaN deterministically last.
    return compareFloat(af, bf);
  }
  return order(a, b);
}

// export function isSorted(expr: Expression): Expression {

// }

// The "kind" of subexpressions. The order here indicates the
// order in which the expressions should be sorted
const RANKS = [
  'integer',
  'rational',
  'radical', // Square root of a rational literal
  'real',
  'complex',
  'nan', // NaN: after all numbers, so it has a deterministic sort position
  'constant',
  'symbol',
  'multiply',
  'divide',
  'add',
  'trig',
  'fn',
  'power',
  'string',
  'object',
  'other',
] as const;
export type Rank = (typeof RANKS)[number];

/**
 * Total three-way comparison of two floats suitable for a comparator.
 *
 * Unlike `af - bf`, this is a *total* order: it never returns `NaN`. Any
 * `NaN` operand sorts after all real numbers (and two `NaN`s compare equal),
 * so canonical ordering stays deterministic and permutation-invariant even
 * when `NaN` is present.
 */
function compareFloat(a: number, b: number): number {
  const aNaN = Number.isNaN(a);
  const bNaN = Number.isNaN(b);
  if (aNaN || bNaN) {
    if (aNaN && bNaN) return 0;
    return aNaN ? +1 : -1;
  }
  if (a < b) return -1;
  if (a > b) return +1;
  return 0;
}

/**
 * Return the "rank", the order in which the expression should be
 * sorted.
 */
function rank(expr: Expression): Rank {
  if (isNumber(expr)) {
    if (typeof expr.numericValue === 'number') {
      if (Number.isNaN(expr.numericValue)) return 'nan';
      return Number.isInteger(expr.numericValue) ? 'integer' : 'real';
    }
    if (expr.numericValue.isNaN) return 'nan';
    const type = expr.numericValue.type;
    if (type === 'integer') return 'integer';
    if (type === 'rational') return 'rational';
    if (type === 'real') return 'real';
    if (type === 'complex' || type === 'imaginary') return 'complex';
    // Every infinite value sorts as a constant, whatever its direction: the
    // signed pair, the unsigned `~oo` and a mixed value such as `∞ + i` all
    // report `infinity` or its `+oo | -oo` subtype now, where `~oo`
    // and the mixed values used to report `number` and bare `complex`.
    if (type === 'infinity') return 'constant';
    // A value whose type is `nan` sorts with NaN. Reached only for a complex
    // value with a NaN component: a plain NaN was answered by the `isNaN`
    // test above.
    if (type === 'nan') return 'nan';
    if (type === 'number') return 'real';
    return 'other';
  }

  // Complex numbers
  if (isSymbol(expr, 'ImaginaryUnit')) return 'complex';

  // Square root of a number
  if (asRadical(expr)) return 'radical';

  // Constant symbols (π, e, etc.)
  if (isSymbol(expr) && expr.isConstant) return 'constant';

  // Other symbols
  if (isSymbol(expr)) return 'symbol';

  if (isTrigonometricFunction(expr.operator)) return 'trig';

  if (expr.operator === 'Add') return 'add';

  if (expr.operator === 'Power' || expr.operator === 'Root') return 'power';

  if (expr.operator === 'Multiply' || expr.operator === 'Negate')
    return 'multiply';

  if (expr.operator === 'Divide') return 'divide';

  if (expr.operator === 'Rational') return 'rational';

  if (expr.operator === 'Complex') return expr.im !== 0 ? 'complex' : 'real';

  if (isFunction(expr, 'Sqrt')) {
    if (isNumber(expr.op1) && (expr.op1.isInteger || expr.op1.isRational))
      return 'radical';
    return 'power';
  }

  if (isFunction(expr)) return 'fn';

  if (isString(expr)) return 'string';

  // Objects rank beside the other opaque values, after strings. They are
  // unordered as a matter of semantics (`cmp()` answers `undefined` for
  // them), so the rank exists only to give a sort a deterministic, total
  // comparator — see the `'object'` arm of `order()`.
  if (isObject(expr)) return 'object';

  return 'other';
}

/**
 * Given two expressions `a` and `b`, return:
 * - `-1` if `a` should be ordered before `b`
 * - `+1` if `b` should be ordered before `a`
 * - `0` if they have the same order (they are structurally equal)
 *
 * The default order is as follow:
 *
 * 1/ Literal numeric values (rational,  machine numbers and Decimal numbers),
 *  ordered by their numeric value (smaller numbers before larger numbers)
 *
 * 2/ Literal complex numbers, ordered by their imaginary parts. In case of a
 * tie, ordered by their real parts. (An arbitrary but established total
 * order — canonical operand order in existing expressions and snapshots
 * depends on it, so it is documented as implemented rather than changed;
 * CORRECTNESS P3-7.)
 *
 * 3/ Symbols, ordered by their name as strings
 *
 * 4/ Addition, ordered as a polynom, with higher degree terms first
 *
 * 5/ Other functions, ordered by their `complexity` property. In case
 * of a tie, ordered by the operator of the expression as a string, in
 * DESCENDING order (unlike the ascending order of symbols in 3/): `Tanh`
 * before `Sech`, `Sin` before `Cos`. This gives the textbook form of
 * products, for example `d/dx sech x` is `-(tanh x · sech x)` and not
 * `-(sech x · tanh x)`, and the canonical form of existing expressions and
 * snapshots depends on it. In case of a tie, by the leaf count of each
 * expression. In case of a tie, by the order of each argument, left to right.
 *
 * 6/ Strings, ordered by comparing their Unicode code point values, in
 * DESCENDING order, like the operators in 5/: `"b"` before `"a"`. The
 * canonical form of existing expressions depends on this order. While this
 * comparison is quick to calculate, it can produce unexpected results, for
 * example "E" < "e" < "È" and "11" < "2". This ordering is not suitable to
 * collate natural language strings.
 *
 * See https://reference.wolfram.com/language/ref/Sort.html for a
 * description of the ordering of expressions in Mathematica.
 *
 */
export function order(a: Expression, b: Expression): number {
  if (a === b) return 0;

  const rankA = rank(a);
  const rankB = rank(b);
  if (rankA !== rankB) return RANKS.indexOf(rankA) - RANKS.indexOf(rankB);

  // All NaN operands are equivalent for ordering purposes. Returning a fixed
  // value (0) keeps the comparator total and deterministic — an `af - bf`
  // subtraction would yield `NaN`, corrupting `Array.sort`.
  if (rankA === 'nan') return 0;

  if (rankA === 'complex') {
    // If the rank is complex, the numericValues can't be a number
    const [reA, imA] = getComplex(a);
    const [reB, imB] = getComplex(b);

    const imCmp = compareFloat(imA, imB);
    if (imCmp !== 0) return imCmp;

    return compareFloat(reA, reB);
  }

  if (rankA === 'integer' || rankA === 'rational' || rankA === 'real') {
    let aN = numericValue(a);
    let bN = numericValue(b);

    if (aN === undefined && isFunction(a, 'Rational'))
      aN = a.op1.re / a.op2.re!;
    if (bN === undefined && isFunction(b, 'Rational'))
      bN = b.op1.re / b.op2.re!;

    const af = typeof aN === 'number' ? aN : aN!.re;
    const bf = typeof bN === 'number' ? bN : bN!.re;

    return compareFloat(af, bf);
  }

  if (rankA === 'radical') {
    if (isFunction(a) && isFunction(b)) return order(a.op1, b.op1);
    return 0;
  }

  if (rankA === 'constant' || rankA === 'symbol') {
    const aSym = isSymbol(a) ? a.symbol : '';
    const bSym = isSymbol(b) ? b.symbol : '';
    if (aSym === bSym) return 0;
    return aSym > bSym ? 1 : -1;
  }

  if (rankA === 'add') {
    if (!isFunction(a) || !isFunction(b)) return 0;
    const aOps = a.ops;
    const bOps = b.ops;
    if (aOps.length !== bOps.length) return bOps.length - aOps.length;
    for (let i = 0; i < aOps.length; i++) {
      const cmp = order(aOps[i], bOps[i]);
      if (cmp !== 0) return cmp;
    }
    return 0;
  }

  if (rankA === 'power') {
    // console.log('power', a.toString(), b.toString());
    const totalDegreeA = totalDegree(a);
    const totalDegreeB = totalDegree(b);
    if (totalDegreeA !== totalDegreeB) {
      // console.log('totalDegree diff = ', totalDegreeB - totalDegreeA);
      return totalDegreeB - totalDegreeA;
    }
    const maxDegreeA = maxDegree(a);
    const maxDegreeB = maxDegree(b);
    if (maxDegreeA !== maxDegreeB) {
      // console.log('maxDegree diff = ', totalDegreeB - totalDegreeA);
      return maxDegreeA - maxDegreeB;
    }

    // console.log('same degree ', order(a.op1, b.op1));
    if (isFunction(a) && isFunction(b)) return order(a.op1, b.op1);
    return 0;
  }

  if (rankA === 'multiply') {
    const totalDegreeA = totalDegree(a);
    const totalDegreeB = totalDegree(b);
    if (totalDegreeA !== totalDegreeB) return totalDegreeB - totalDegreeA;
    const maxDegreeA = maxDegree(a);
    const maxDegreeB = maxDegree(b);
    if (maxDegreeA !== maxDegreeB) return maxDegreeA - maxDegreeB;

    if (!isFunction(a) || !isFunction(b)) return 0;
    const aOps = a.ops;
    const bOps = b.ops;

    if (aOps.length !== bOps.length) return bOps.length - aOps.length;
    for (let i = 0; i < aOps.length; i++) {
      const cmp = order(aOps[i], bOps[i]);
      if (cmp !== 0) return cmp;
    }
    return 0;
  }

  if (rankA === 'divide') {
    if (!isFunction(a) || !isFunction(b)) return 0;
    const totalDegreeA = totalDegree(a.op1);
    const totalDegreeB = totalDegree(b.op1);
    if (totalDegreeA !== totalDegreeB) return totalDegreeB - totalDegreeA;
    const maxDegreeA = maxDegree(a.op1);
    const maxDegreeB = maxDegree(b.op1);
    if (maxDegreeA !== maxDegreeB) return maxDegreeA - maxDegreeB;

    const numOrder = order(a.op1, b.op1);
    if (numOrder !== 0) return numOrder;
    return order(a.op2, b.op2);
  }

  if (rankA === 'fn' || rankA === 'trig') {
    if (
      isFunction(a) &&
      isFunction(b) &&
      a.operator == b.operator &&
      a.nops === 1 &&
      b.nops === 1
    ) {
      return order(a.op1, b.op1);
    }
    const aComplexity = a.operatorDefinition?.complexity ?? DEFAULT_COMPLEXITY;
    const bComplexity = b.operatorDefinition?.complexity ?? DEFAULT_COMPLEXITY;
    if (aComplexity === bComplexity) {
      if (a.operator === b.operator) return getLeafCount(a) - getLeafCount(b);

      if (a.operator < b.operator) return +1;
      return -1;
    }
    return aComplexity - bComplexity;
  }

  // Two objects are ordered by CONSTRUCTION order (their per-engine serial),
  // which is the only property of an object that is both total and stable:
  // contents change under a store, so any content-derived order would make a
  // sorted array unsort itself. Distinct objects never compare `0`, so a sort
  // of a list of objects is deterministic; `a === b` was answered at the top.
  if (rankA === 'object') {
    if (isObject(a) && isObject(b)) return a._serial - b._serial;
    return 0;
  }

  if (rankA === 'string') {
    if (isString(a) && isString(b)) {
      if (a.string === b.string) return 0;
      if (b.string < a.string) return -1;
      return +1;
    }
    return 0;
  }

  return (
    (a.complexity ?? DEFAULT_COMPLEXITY) - (b.complexity ?? DEFAULT_COMPLEXITY)
  );
}

/**
 * The elements of a canonical set literal, in the canonical order.
 *
 * The elements of a set are not ordered, but the operators that walk a set
 * (`ListFrom`, `Reduce`, `String`, serialization...) read its elements in the
 * order in which they are stored. So that two sets that are `isSame` give the
 * same result to every operator, a canonical set stores its elements in one
 * order that does not depend on the written order: `{2, 1}` and `{x, 1}` are
 * stored as `{1, 2}` and `{1, x}`.
 *
 * The order is `order()`, the order of the operands of the other commutative
 * operators. `order()` gives a tie (`0`) for some elements that are
 * different (`[1, 2]` and `[3, 4]`: two lists with the same leaf count), and
 * a stable sort would then keep their written order. Such a tie is broken
 * by `setElementTieOrder()`, so the order is total on elements whose
 * MathJSON is different.
 *
 * The caller removes the elements that are `isSame` as an earlier element
 * first: `isSame` elements (the rational `1/2` and the float `0.5`) can have
 * different digests, and they must not both be in the set.
 */
export function sortSetElements(
  xs: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  if (xs.length < 2) return xs;
  return [...xs].sort(setElementOrder);
}

/** `order()`, with its ties broken by `setElementTieOrder()`. */
function setElementOrder(a: Expression, b: Expression): number {
  return order(a, b) || setElementTieOrder(a, b);
}

/**
 * The order of two elements that `order()` ties. A function application
 * comes after any other element. Two applications compare by operator name,
 * then operand by operand (with `setElementOrder()`), then by operand count,
 * so `[1, 2]` comes before `[3, 4]`. Anything else compares by `digest`, a
 * key of the MathJSON tree. Each step is a total order, so their sequence is
 * a total order too: the result does not depend on the written order.
 */
function setElementTieOrder(a: Expression, b: Expression): number {
  const fa = isFunction(a);
  const fb = isFunction(b);
  if (fa !== fb) return fa ? 1 : -1;
  if (fa && fb) {
    if (a.operator !== b.operator) return a.operator < b.operator ? -1 : 1;
    const n = Math.min(a.nops, b.nops);
    for (let i = 0; i < n; i++) {
      const r = setElementOrder(a.ops[i], b.ops[i]);
      if (r !== 0) return r;
    }
    if (a.nops !== b.nops) return a.nops - b.nops;
  }
  const da = a.digest;
  const db = b.digest;
  return da < db ? -1 : da > db ? 1 : 0;
}

/** Return a version of the expression with its arguments sorted in
 * canonical order
 */
export function canonicalOrder(
  expr: Expression,
  { recursive = false }: { recursive?: boolean }
): Expression {
  // If the expression is already in canonical form, return it as is
  if (expr.isCanonical || expr.isStructural || !isFunction(expr)) return expr;

  let ops: ReadonlyArray<Expression> = expr.ops;
  if (recursive) ops = ops.map((x) => canonicalOrder(x, { recursive }));

  ops = sortOperands(expr.operator, ops);

  return expr.engine._fn(expr.operator, ops, { canonical: false });
}

export function sortOperands(
  operator: string,
  xs: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  if (xs.length === 0) return xs;
  const ce = xs[0].engine;

  // @fastpath
  // `Add` and `Multiply` have their own orderings. They are not applied when
  // a host has removed the `commutative` flag of the operator
  // (`ce.declare('Add', { commutative: false }, { extend: true })`): then the
  // operand order is kept. Without a definition (a clean scope, as when rule
  // patterns are boxed), the orderings apply. The scope lookup is done only
  // in an engine where a non-commutative definition of `Add` or `Multiply`
  // was made (`mayHaveOrderedArithmetic()`), because this function runs on
  // every canonical sum and product.
  if (operator === 'Add' || operator === 'Multiply') {
    if (mayHaveOrderedArithmetic(ce)) {
      const def = ce.lookupDefinition(operator);
      if (def && isOperatorDef(def) && !def.operator.commutative) return xs;
    }
    if (operator === 'Add') return sortAddTerms(xs);
    // Products with ≥2 matrix/vector operands are non-commutative: preserve
    // the tensors' written order (CORRECTNESS_FINDINGS P0-26).
    return sortProductOperands(xs);
  }

  const def = ce.lookupDefinition(operator);
  if (!def || !isOperatorDef(def)) return xs;

  const isCommutative = def.operator.commutative;
  if (!isCommutative) return xs;

  if (def.operator.commutativeOrder)
    return [...xs].sort(def.operator.commutativeOrder);

  return [...xs].sort(order);
}

/**
 * Sort the terms of a polynomial expression (`Add` expression) according
 * to the deglex polynomial ordering
 *
 */
export function polynomialOrder(expr: Expression): Expression {
  // Empirically, the Total Degree Reverse Lexicographic Order (grevlex)
  // is often the fastest to calculate Gröbner basis. We use it as the
  // default ordering for polynomials.
  return degreeReverseLexicographicOrder(expr, expr.unknowns);
}

export function lexicographicOrder(
  expr: Expression,
  vars?: ReadonlyArray<string>
): Expression {
  // This ordering is not implemented yet; preserve the input expression.
  const _vars = vars ?? expr.unknowns;
  return expr;
}

export function degreeLexicographicOrder(
  expr: Expression,
  vars?: ReadonlyArray<string>
): Expression {
  // This ordering is not implemented yet; preserve the input expression.
  const _vars = vars ?? expr.unknowns;
  return expr;
}

export function degreeReverseLexicographicOrder(
  expr: Expression,
  vars?: ReadonlyArray<string>
): Expression {
  // This ordering is not implemented yet; preserve the input expression.
  const _vars = vars ?? expr.unknowns;
  return expr;
}

export function eliminationOrder(
  expr: Expression,
  vars?: ReadonlyArray<string>
): Expression {
  // This ordering is not implemented yet; preserve the input expression.
  const _vars = vars ?? expr.unknowns;
  return expr;
}

/** Get the number of atomic elements in the expression */
/** Per-node memo of `getLeafCount`. The count of a node never changes
 *  (expressions are immutable), and an expression that shares its operands
 *  would otherwise be unfolded — exponentially in its depth — on every
 *  comparison that reaches this tie-breaker. */
const LEAF_COUNT = new WeakMap<Expression, number>();

function getLeafCount(expr: Expression): number {
  if (!isFunction(expr)) return 1;
  const cached = LEAF_COUNT.get(expr);
  if (cached !== undefined) return cached;
  let count = 1;
  for (const op of expr.ops) count += getLeafCount(op);
  LEAF_COUNT.set(expr, count);
  return count;
}

function getComplex(a: Expression): [number, number] {
  if (isSymbol(a, 'ImaginaryUnit')) return [0, 1];
  if (isNumber(a)) {
    if (typeof a.numericValue === 'number') return [a.numericValue, 0];
    const v = a.numericValue;
    return [v.re, v.im];
  }
  if (isFunction(a, 'Complex')) {
    const aOp1 = a.op1;
    const aOp2 = a.op2;
    if (!isNumber(aOp1)) return [0, 0];
    const re =
      typeof aOp1.numericValue === 'number'
        ? aOp1.numericValue
        : aOp1.numericValue.re;
    if (!isNumber(aOp2)) return [0, 0];
    const im =
      typeof aOp2.numericValue === 'number'
        ? aOp2.numericValue
        : aOp2.numericValue.re;
    return [re, im];
  }

  return [0, 0];
}
