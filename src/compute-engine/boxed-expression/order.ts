import Complex from 'complex.js';
import { lex, maxDegree, revlex, totalDegree } from '../symbolic/polynomials';
import { BoxedExpression, SemiBoxedExpression } from './public';
import { asFloat } from './numerics';
import { isRational } from '../numerics/rationals';
import { isTrigonometricFunction } from '../library/trigonometry';

export type Order = 'lex' | 'dexlex' | 'grevlex' | 'elim';

export const DEFAULT_COMPLEXITY = 100000;

const ADD_RANKS = [
  'power',
  'symbol',

  'multiply',
  'divide',
  'add',
  'trig',
  'fn',

  'complex',
  'constant',

  'number',
  'rational',
  'sqrt',

  'string',
  'dict',
  'other',
] as const;

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
export function sortAdd(
  ops: ReadonlyArray<BoxedExpression>
): ReadonlyArray<BoxedExpression> {
  return [...ops].sort((a, b) => {
    if (a.toString() === 'b' && b.toString() === '7') debugger;
    if (b.toString() === 'b' && a.toString() === '7') debugger;
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
  });
}

// export function isSorted(expr: BoxedExpression): BoxedExpression {

// }

// The "kind" of subexpressions. The order here indicates the
// order in which the expressions should be sorted
const RANKS = [
  'number',
  'rational',
  'sqrt',
  'complex',
  'constant',
  'symbol',
  'multiply',
  'divide',
  'add',
  'trig',
  'fn',
  'power',
  'string',
  'dict',
  'other',
] as const;
export type Rank = (typeof RANKS)[number];

/**
 * Return the "rank", the order in which the expression should be
 * sorted.
 */
function rank(expr: BoxedExpression): Rank {
  if (expr.numericValue && isRational(expr.numericValue)) return 'rational';

  // Complex numbers
  if (expr.numericValue instanceof Complex || expr.symbol === 'ImaginaryUnit')
    return 'complex';

  // Other real numbers
  if (expr.numericValue !== null) return 'number';

  // Square root of a number
  if (expr.operator === 'Sqrt' && expr.op1.numericValue) {
    const n = asFloat(expr.op1);
    if (n !== null && Number.isInteger(n)) return 'sqrt';
  }

  // Constant symbols
  if (expr.symbol && expr.isConstant) return 'constant';

  // Other symbols
  if (expr.symbol) return 'symbol';

  if (isTrigonometricFunction(expr.operator)) return 'trig';

  if (expr.operator === 'Add') return 'add';

  if (expr.operator === 'Power') return 'power';

  if (expr.operator === 'Multiply' || expr.operator === 'Negate')
    return 'multiply';

  if (expr.operator === 'Divide') return 'divide';

  if (expr.ops) return 'fn';

  if (expr.string) return 'string';

  if (expr.keys) return 'dict';

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
 * 2/ Literal complex numbers, ordered by their real parts. In case of a tie,
 * ordered by the absolute value of their imaginary parts. In case of a tie,
 * ordered by the value of their imaginary parts.
 *
 * 3/ Symbols, ordered by their name as strings
 *
 * 4/ Addition, ordered as a polynom, with higher degree terms first
 *
 * 5/ Other functions, ordered by their `complexity` property. In case
 * of a tie, ordered by the operator of the expression as a string. In case of a
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
 * See https://reference.wolfram.com/language/ref/Sort.html for a
 * description of the ordering of expressions in Mathematica.
 *
 */
export function order(a: BoxedExpression, b: BoxedExpression): number {
  if (a === b) return 0;

  const rankA = rank(a);
  const rankB = rank(b);
  if (rankA !== rankB) return RANKS.indexOf(rankA) - RANKS.indexOf(rankB);

  if (rankA === 'number' || rankA === 'rational') {
    const af = asFloat(a);
    const bf = asFloat(b);
    if (af !== null && bf !== null) return af - bf;
    return -1; // Literals before non-literals
  }

  if (rankA === 'complex') {
    const zA =
      a.symbol === 'ImaginaryUnit'
        ? a.engine.complex(0, 1)
        : (a.numericValue as Complex);

    const zB =
      b.symbol === 'ImaginaryUnit'
        ? b.engine.complex(0, 1)
        : (b.numericValue as Complex);

    if (zA.im === zB.im) return zA.re - zB.re;
    return zA.im - zB.im;
  }

  if (rankA === 'sqrt') return order(a.op1, b.op1);

  if (rankA === 'constant' || rankA === 'symbol') {
    if (a.symbol === b.symbol) return 0;
    return a.symbol! > b.symbol! ? 1 : -1;
  }

  if (rankA === 'add') {
    const aOps = a.ops!;
    const bOps = b.ops!;
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
    return order(a.op1, b.op1);
  }

  if (rankA === 'multiply') {
    const totalDegreeA = totalDegree(a);
    const totalDegreeB = totalDegree(b);
    if (totalDegreeA !== totalDegreeB) return totalDegreeB - totalDegreeA;
    const maxDegreeA = maxDegree(a);
    const maxDegreeB = maxDegree(b);
    if (maxDegreeA !== maxDegreeB) return maxDegreeA - maxDegreeB;

    const aOps = a.ops!;
    const bOps = b.ops!;

    if (aOps.length !== bOps.length) return bOps.length - aOps.length;
    for (let i = 0; i < aOps.length; i++) {
      const cmp = order(aOps[i], bOps[i]);
      if (cmp !== 0) return cmp;
    }
    return 0;
  }

  if (rankA === 'divide') {
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
    if (a.operator == b.operator && a.nops === 1 && b.nops === 1) {
      return order(a.op1, b.op1);
    }
    const aComplexity = a.functionDefinition?.complexity ?? DEFAULT_COMPLEXITY;
    const bComplexity = b.functionDefinition?.complexity ?? DEFAULT_COMPLEXITY;
    if (aComplexity === bComplexity) {
      if (typeof a.operator === 'string' && typeof b.operator === 'string') {
        if (a.operator === b.operator) return getLeafCount(a) - getLeafCount(b);

        if (a.operator < b.operator) return +1;
        return -1;
      }
      return getLeafCount(a) - getLeafCount(b);
    }
    return aComplexity - bComplexity;
  }

  if (rankA === 'string') {
    if (a.string === b.string) return 0;
    if (b.string! < a.string!) return -1;
    return +1;
  }

  if (rankA === 'dict') {
    if (a.keysCount !== b.keysCount) return b.keysCount - a.keysCount;
    let bComplexity = 0;
    let aComplexity = 0;
    for (const key of b.keys!)
      bComplexity += b.getKey(key)!.complexity ?? DEFAULT_COMPLEXITY;
    for (const key of a.keys!)
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
  // If the expression is already in canonical form, return it as is
  if (expr.isCanonical || !expr.ops) return expr;

  let ops = expr.ops;
  if (recursive) ops = ops.map((x) => canonicalOrder(x, { recursive }));

  const ce = expr.engine;
  if (expr.operator === 'Add') ops = sortAdd(ops);
  else {
    const isCommutative =
      expr.operator === 'Multiply' ||
      (ce.lookupFunction(expr.operator)?.commutative ?? false);
    if (isCommutative) ops = [...ops].sort(order);
  }
  return ce._fn(expr.operator, ops, { canonical: false });
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
    (typeof expr.operator === 'string' ? 1 : getLeafCount(expr.operator)) +
    [...expr.ops].reduce((acc, x) => acc + getLeafCount(x), 0)
  );
}
