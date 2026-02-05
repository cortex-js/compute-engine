import type { BoxedExpression } from '../global-types';

import { maxDegree, revlex, totalDegree } from './polynomials';
import { asRadical } from './arithmetic-power';
import { isOperatorDef } from './utils';

export type Order = 'lex' | 'dexlex' | 'grevlex' | 'elim';

export const DEFAULT_COMPLEXITY = 100000;

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

function isTrigonometricFunction(operator: any): boolean {
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

export function addOrder(a: BoxedExpression, b: BoxedExpression): number {
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

export function equalOrder(a: BoxedExpression, b: BoxedExpression): number {
  // Rank 1: symbols
  // Ranks 2: expression
  // Rank 3: numbers
  const rank = (x: BoxedExpression): number => {
    if (x.symbol !== null) return 1;
    if (x.isNumberLiteral) return 3;
    return 2;
  };
  const aRank = rank(a);
  const bRank = rank(b);
  if (aRank < bRank) return -1;
  if (bRank < aRank) return +1;
  if (aRank === 1) {
    if (a.symbol === b.symbol) return 0;
    return a.symbol! > b.symbol! ? 1 : -1;
  }
  if (aRank === 3) {
    const aN = a.numericValue;
    const bN = b.numericValue;
    const af = typeof aN === 'number' ? aN : aN!.re;
    const bf = typeof bN === 'number' ? bN : bN!.re;
    return af - bf;
  }
  return order(a, b);
}

// export function isSorted(expr: BoxedExpression): BoxedExpression {

// }

// The "kind" of subexpressions. The order here indicates the
// order in which the expressions should be sorted
const RANKS = [
  'integer',
  'rational',
  'radical', // Square root of a rational literal
  'real',
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
  'other',
] as const;
export type Rank = (typeof RANKS)[number];

/**
 * Return the "rank", the order in which the expression should be
 * sorted.
 */
function rank(expr: BoxedExpression): Rank {
  if (typeof expr.numericValue === 'number') {
    return Number.isInteger(expr.numericValue) ? 'integer' : 'real';
  }
  if (expr.numericValue) {
    const type = expr.numericValue.type;
    if (type === 'integer' || type === 'finite_integer') return 'integer';
    if (type === 'rational' || type === 'finite_rational') return 'rational';
    if (type === 'real' || type === 'finite_real') return 'real';
    if (type === 'complex' || type === 'finite_complex') return 'complex';
    if (type === 'imaginary') return 'complex';
    if (type === 'finite_number') return 'complex';
    if (type === 'non_finite_number') return 'constant';
    if (type === 'number') return 'real';
    return 'other';
  }

  // Complex numbers
  if (expr.symbol === 'ImaginaryUnit') return 'complex';

  // Square root of a number
  if (asRadical(expr)) return 'radical';

  // Constant symbols (π, e, etc.)
  if (expr.symbol && expr.isConstant) return 'constant';

  // Other symbols
  if (expr.symbol) return 'symbol';

  if (isTrigonometricFunction(expr.operator)) return 'trig';

  if (expr.operator === 'Add') return 'add';

  if (expr.operator === 'Power' || expr.operator === 'Root') return 'power';

  if (expr.operator === 'Multiply' || expr.operator === 'Negate')
    return 'multiply';

  if (expr.operator === 'Divide') return 'divide';

  if (expr.operator === 'Rational') return 'rational';

  if (expr.operator === 'Complex') return expr.im !== 0 ? 'complex' : 'real';

  if (expr.operator === 'Sqrt') {
    if (expr.op1.isNumberLiteral && (expr.op1.isInteger || expr.op1.isRational))
      return 'radical';
    return 'power';
  }

  if (expr.ops) return 'fn';

  if (expr.string) return 'string';

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
 * See https://reference.wolfram.com/language/ref/Sort.html for a
 * description of the ordering of expressions in Mathematica.
 *
 */
export function order(a: BoxedExpression, b: BoxedExpression): number {
  if (a === b) return 0;

  const rankA = rank(a);
  const rankB = rank(b);
  if (rankA !== rankB) return RANKS.indexOf(rankA) - RANKS.indexOf(rankB);

  if (rankA === 'complex') {
    // If the rank is complex, the numericValues can't be a number
    const [reA, imA] = getComplex(a);
    const [reB, imB] = getComplex(b);

    if (imA !== imB) return imA - imB;

    return reA - reB;
  }

  if (rankA === 'integer' || rankA === 'rational' || rankA === 'real') {
    let aN = a.numericValue;
    let bN = b.numericValue;

    if (aN === null && a.operator === 'Rational') aN = a.op1.re / a.op2.re!;
    if (bN === null && b.operator === 'Rational') bN = b.op1.re / b.op2.re!;

    const af = typeof aN === 'number' ? aN : aN!.re;
    const bf = typeof bN === 'number' ? bN : bN!.re;

    return af - bf;
  }

  if (rankA === 'radical') return order(a.op1, b.op1);

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
    const aComplexity = a.operatorDefinition?.complexity ?? DEFAULT_COMPLEXITY;
    const bComplexity = b.operatorDefinition?.complexity ?? DEFAULT_COMPLEXITY;
    if (aComplexity === bComplexity) {
      if (a.operator === b.operator) return getLeafCount(a) - getLeafCount(b);

      if (a.operator < b.operator) return +1;
      return -1;
    }
    return aComplexity - bComplexity;
  }

  if (rankA === 'string') {
    if (a.string === b.string) return 0;
    if (b.string! < a.string!) return -1;
    return +1;
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
  if (expr.isCanonical || expr.isStructural || !expr.ops) return expr;

  let ops = expr.ops;
  if (recursive) ops = ops.map((x) => canonicalOrder(x, { recursive }));

  ops = sortOperands(expr.operator, ops);

  return expr.engine._fn(expr.operator, ops, { canonical: false });
}

export function sortOperands(
  operator: string,
  xs: ReadonlyArray<BoxedExpression>
): ReadonlyArray<BoxedExpression> {
  if (xs.length === 0) return xs;
  const ce = xs[0].engine;

  // @fastpath
  if (operator === 'Add') return [...xs].sort(addOrder);
  if (operator === 'Multiply') return [...xs].sort(order);

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
export function polynomialOrder(expr: BoxedExpression): BoxedExpression {
  // Empirically, the Total Degree Reverse Lexicographic Order (grevlex)
  // is often the fastest to calculate Gröbner basis. We use it as the
  // default ordering for polynomials.
  return degreeReverseLexicographicOrder(expr, expr.unknowns);
}

export function lexicographicOrder(
  expr: BoxedExpression,
  vars?: ReadonlyArray<string>
): BoxedExpression {
  // @todo
  vars = vars ?? expr.unknowns;
  return expr;
}

export function degreeLexicographicOrder(
  expr: BoxedExpression,
  vars?: ReadonlyArray<string>
): BoxedExpression {
  // @todo
  vars = vars ?? expr.unknowns;
  return expr;
}

export function degreeReverseLexicographicOrder(
  expr: BoxedExpression,
  vars?: ReadonlyArray<string>
): BoxedExpression {
  // @todo
  vars = vars ?? expr.unknowns;
  return expr;
}

export function eliminationOrder(
  expr: BoxedExpression,
  vars?: ReadonlyArray<string>
): BoxedExpression {
  // @todo
  vars = vars ?? expr.unknowns;
  return expr;
}

/** Get the number of atomic elements in the expression */
function getLeafCount(expr: BoxedExpression): number {
  if (!expr.ops) return 1;
  return 1 + [...expr.ops].reduce((acc, x) => acc + getLeafCount(x), 0);
}

function getComplex(a: BoxedExpression): [number, number] {
  if (a.symbol === 'ImaginaryUnit') return [0, 1];
  if (a.numericValue) {
    if (typeof a.numericValue === 'number') return [a.numericValue, 0];
    const v = a.numericValue;
    return [v.re, v.im];
  }
  if (a.operator === 'Complex') {
    const op1 = a.op1.numericValue;
    if (op1 === null) return [0, 0];
    const re = typeof op1 === 'number' ? op1 : op1!.re;
    const op2 = a.op2.numericValue;
    if (op2 === null) return [0, 0];
    const im = typeof op2 === 'number' ? op2 : op2!.re;
    return [re, im];
  }

  return [0, 0];
}
