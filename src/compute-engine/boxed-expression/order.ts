import Complex from 'complex.js';
import { lex, maxDegree, totalDegree } from '../symbolic/polynomials';
import { BoxedExpression, SemiBoxedExpression } from './public';
import { asFloat } from './numerics';

export type Order = 'lex' | 'dexlex' | 'grevlex' | 'elim';

export const DEFAULT_COMPLEXITY = 100000;

/**
 * Sort by higher total degree (sum of degree), if tied, sort by max degree,
 * if tied,
 */
export function sortAdd(
  ops: ReadonlyArray<BoxedExpression>
): ReadonlyArray<BoxedExpression> {
  return [...ops].sort((a, b) => {
    const aLex = lex(a);
    const bLex = lex(b);
    if (!aLex && !bLex) return order(a, b);
    if (!aLex) return +1;
    if (!bLex) return -1;
    if (aLex < bLex) return -1;
    if (aLex > bLex) return +1;
    const aTotalDeg = totalDegree(a);
    const bTotalDeg = totalDegree(b);
    if (aTotalDeg !== bTotalDeg) return bTotalDeg - aTotalDeg;
    const aMaxDeg = maxDegree(a);
    const bMaxDeg = maxDegree(b);
    if (aMaxDeg !== bMaxDeg) return aMaxDeg - bMaxDeg;
    return order(a, b);
  });
}

// export function isSorted(expr: BoxedExpression): BoxedExpression {

// }

/**
 * Given two expressions `a` and `b`, return:
 * - `-1` if `a` should be ordered before `b`
 * - `+1` if `b` should be ordered before `a`
 * - `0` if they have the same order (they are structurally equal)
 *
 * The default order is as follow:
 *
 * 1/ Literal numeric values (rational,  machine numbers and Decimal numbers),
 *  ordered by they numeric value (smaller numbers before larger numbers)
 *
 * 2/ Literal complex numbers, ordered by their real parts. In case of a tie,
 * ordered by the absolute value of their imaginary parts. In case of a tie,
 * ordered by the value of their imaginary parts.
 *
 * 3/ Symbols, ordered by their name as strings
 *
 * 4/ Addition, ordered as a polynom, with higher degree terms first
 *
 * 5/ Other functions, ordered by their `complexity` property. In case
 * of a tie, ordered by the head of the expression as a string. In case of a
 * tie, by the leaf count of each expression. In case of a tie, by the order
 * of each argument, left to right.
 *
 * 6/ Strings, ordered by comparing their Unicode code point values. While this
 * sort order is quick to calculate, it can produce unexpected results, for
 * example "E" < "e" < "È" and "11" < "2". This ordering is not suitable to
 * collate natural language strings.
 *
 * 7/ Dictionaries, ordered by the number of keys. If there is a tie, by the
 * sum of the complexities of the values of the dictionary
 *
 *
 */
export function order(a: BoxedExpression, b: BoxedExpression): number {
  // console.assert(a.isCanonical && b.isCanonical);

  if (a === b) return 0;
  if (a.numericValue !== null && a.numericValue === b.numericValue) return 0;

  //
  //  1/ Literal numeric values
  //
  const af = asFloat(a);
  if (af !== null) {
    const bf = asFloat(b);
    if (bf !== null) return af - bf;

    return -1;
  }

  //
  // 2/ Complex numbers
  //
  if (a.numericValue instanceof Complex) {
    if (b.numericValue instanceof Complex) {
      if (a.numericValue.re === b.numericValue.re) {
        if (Math.abs(a.numericValue.im) === Math.abs(b.numericValue.im)) {
          return a.numericValue.im - b.numericValue.im;
        }
        return Math.abs(a.numericValue.im) - Math.abs(b.numericValue.im);
      }
      return a.numericValue.re - b.numericValue.re;
    }
    if (b.numericValue !== null) return +1;
    return -1;
  }

  if (a.numericValue) {
    if (b.numericValue) {
      return +1;
    }
    return -1;
  }

  if (a.head === 'Sqrt' && a.op1.numericValue) {
    if (b.head === 'Sqrt' && b.op1.numericValue) return order(a.op1, b.op1);
    return -1;
  }

  //
  // 3/ Symbols
  //
  if (a.symbol) {
    if (b.symbol) {
      if (a.symbol === b.symbol) return 0;
      return a.symbol > b.symbol ? 1 : -1;
    }
    if (b.numericValue !== null) return +1;
    return -1;
  }

  //
  // 4/ Functions
  //
  if (a.ops) {
    if (b.ops) {
      // Note: we may not have a function definition if it's
      // an "anonymous" function, i.e. `f` in `f(x)`
      const aComplexity =
        a.functionDefinition?.complexity ?? DEFAULT_COMPLEXITY;
      const bComplexity =
        b.functionDefinition?.complexity ?? DEFAULT_COMPLEXITY;
      if (aComplexity === bComplexity) {
        if (typeof a.head === 'string' && typeof b.head === 'string') {
          if (a.head === b.head) {
            return getLeafCount(a) - getLeafCount(b);
          }
          if (a.head < b.head) return +1;
          return -1;
        }
        return getLeafCount(a) - getLeafCount(b);
      }
      return aComplexity - bComplexity;
    }
    if (b.numericValue !== null || b.symbol) return +1;
    return -1;
  }

  //
  // 5/ Strings
  //
  if (a.string) {
    if (b.string) {
      // Order strings by their length, then by their lexicographic order
      if (a.string.length !== b.string.length)
        return b.string.length - a.string.length;
      if (b.string < a.string) return -1;
      if (a.string > b.string) return +1;
      return 0;
    }
    if (b.keys) return -1;
    return +1;
  }

  //
  // 7/ Dictionaries
  //
  if (a.keys && b.keys) {
    if (a.keysCount !== b.keysCount) return b.keysCount - a.keysCount;
    let bComplexity = 0;
    let aComplexity = 0;
    for (const key of b.keys)
      bComplexity += b.getKey(key)!.complexity ?? DEFAULT_COMPLEXITY;
    for (const key of a.keys)
      aComplexity += a.getKey(key)!.complexity ?? DEFAULT_COMPLEXITY;
    return aComplexity - bComplexity;
  }

  return (
    (a.complexity ?? DEFAULT_COMPLEXITY) - (b.complexity ?? DEFAULT_COMPLEXITY)
  );
}

/** Return a version of the expression with its arguments sorted in
 * canonical order
 */
export function canonicalOrder(
  expr: BoxedExpression,
  { recursive = false }: { recursive?: boolean }
): BoxedExpression {
  if (expr.ops) {
    let ops = expr.ops;
    if (recursive) ops = ops.map((x) => canonicalOrder(x, { recursive }));

    const ce = expr.engine;
    if (expr.head === 'Add') ops = sortAdd(ops);
    else {
      const isCommutative =
        expr.head === 'Multiply' ||
        (ce.lookupFunction(expr.head)?.commutative ?? false);
      if (isCommutative) ops = [...ops].sort(order);
    }
    return ce._fn(expr.head, ops, { canonical: expr.isCanonical });
  }
  return expr;
}

/**
 * Sort the terms of a polynomial expression (`Add` expression) according
 * to the deglex polynomial ordering
 *
 */
export function polynomialOrder(expr: BoxedExpression): SemiBoxedExpression {
  // Empirically, the Total Degree Reverse Lexicographic Order (grevlex)
  // is often the fastest to calculate Gröbner basis. We use it as the
  // default ordering for polynomials.
  return degreeReverseLexicographicOrder(expr, expr.unknowns);
}

export function lexicographicOrder(
  expr: BoxedExpression,
  vars?: ReadonlyArray<string>
): SemiBoxedExpression {
  // @todo
  vars = vars ?? expr.unknowns;
  return expr;
}

export function degreeLexicographicOrder(
  expr: BoxedExpression,
  vars?: ReadonlyArray<string>
): SemiBoxedExpression {
  // @todo
  vars = vars ?? expr.unknowns;
  return expr;
}

export function degreeReverseLexicographicOrder(
  expr: BoxedExpression,
  vars?: ReadonlyArray<string>
): SemiBoxedExpression {
  // @todo
  vars = vars ?? expr.unknowns;
  return expr;
}

export function eliminationOrder(
  expr: BoxedExpression,
  vars?: ReadonlyArray<string>
): SemiBoxedExpression {
  // @todo
  vars = vars ?? expr.unknowns;
  return expr;
}

/** Get the number of atomic elements in the expression */
function getLeafCount(expr: BoxedExpression): number {
  if (expr.keys !== null) return 1 + expr.keysCount;
  if (!expr.ops) return 1;
  return (
    (typeof expr.head === 'string' ? 1 : getLeafCount(expr.head)) +
    [...expr.ops].reduce((acc, x) => acc + getLeafCount(x), 0)
  );
}
