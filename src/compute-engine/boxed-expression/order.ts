import type { Expression } from '../global-types.js';

import { maxDegree, revlex, totalDegree } from './polynomial-degree.js';
import { asRadical } from './arithmetic-power.js';
import { isOperatorDef } from './utils.js';
import {
  isNumber,
  isFunction,
  isSymbol,
  isString,
  numericValue,
} from './type-guards.js';

export type Order = 'lex' | 'dexlex' | 'grevlex' | 'elim';

import { DEFAULT_COMPLEXITY } from './constants.js';
export { DEFAULT_COMPLEXITY };

import { BoxedType } from '../../common/type/boxed-type.js';

const MATRIX_TYPE = new BoxedType('matrix');
const VECTOR_TYPE = new BoxedType('vector');

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
  return (
    isFunction(x, 'Matrix') ||
    x.type.matches(MATRIX_TYPE) ||
    x.type.matches(VECTOR_TYPE)
  );
}

/**
 * Sort the operands of a product: with two or more matrix/vector operands,
 * keep the tensors in their written order and sort only the (commutative)
 * scalar factors, placed before them. With 0 or 1 tensor the product is
 * order-independent and the normal canonical sort applies.
 */
export function sortProductOperands(
  xs: ReadonlyArray<Expression>
): Expression[] {
  if (xs.filter(isTensorProductOperand).length >= 2) {
    const scalars = xs.filter((y) => !isTensorProductOperand(y)).sort(order);
    const tensors = xs.filter(isTensorProductOperand);
    return [...scalars, ...tensors];
  }
  return [...xs].sort(order);
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
  if (operator === 'Add') return [...xs].sort(addOrder);
  // Products with ≥2 matrix/vector operands are non-commutative: preserve
  // the tensors' written order (CORRECTNESS_FINDINGS P0-26).
  if (operator === 'Multiply') return sortProductOperands(xs);

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
  // @todo
  const _vars = vars ?? expr.unknowns;
  return expr;
}

export function degreeLexicographicOrder(
  expr: Expression,
  vars?: ReadonlyArray<string>
): Expression {
  // @todo
  const _vars = vars ?? expr.unknowns;
  return expr;
}

export function degreeReverseLexicographicOrder(
  expr: Expression,
  vars?: ReadonlyArray<string>
): Expression {
  // @todo
  const _vars = vars ?? expr.unknowns;
  return expr;
}

export function eliminationOrder(
  expr: Expression,
  vars?: ReadonlyArray<string>
): Expression {
  // @todo
  const _vars = vars ?? expr.unknowns;
  return expr;
}

/** Get the number of atomic elements in the expression */
function getLeafCount(expr: Expression): number {
  if (!isFunction(expr)) return 1;
  return 1 + [...expr.ops].reduce((acc, x) => acc + getLeafCount(x), 0);
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
