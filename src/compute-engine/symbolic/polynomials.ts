import Decimal from 'decimal.js';
import { BoxedExpression, SemiBoxedExpression } from '../public';
import { asMachineInteger } from '../boxed-expression/numerics';

/**
 * Coefficient of a univariate (single variable) polynomial.
 *
 * The first element is a constant.
 * The second element is the coefficient of the variable.
 * The third element is the coefficient of the variable squared.
 * ...etc
 *
 * `3x^3 + 5x + √5 + 2` -> ['√5 + 2', 5, null, 3]
 *
 * If a coefficient does not apply (there are no corresponding term), it is `null`.
 *
 */
export type UnivariateCoefficients = (null | BoxedExpression)[];
export type MultivariateCoefficients = (null | (null | BoxedExpression)[])[];

/** Given `term` */
function coefficientDegree(
  term: BoxedExpression,
  vars: string[]
): [coef: BoxedExpression, degrees: number[]] {
  if (term.head === 'Negate') {
  } else if (term.head === 'Multiply') {
  } else if (term.head === 'Power') {
  } else {
    // if (term.symbol in vars)...
    // Sqrt, Ln, trig, constants, numbers
  }
  return [term, [1, 0, 0]];
}

/**
 * Return a list of coefficient of powers of `vars` in `poly`,
 * starting with power 0.
 *
 * If `poly`  is not a polynomial, return `null`.
 */
export function coefficients(
  poly: BoxedExpression,
  vars: string
): UnivariateCoefficients | null;
export function coefficients(
  poly: BoxedExpression,
  vars: string[]
): MultivariateCoefficients | null;
export function coefficients(
  poly: BoxedExpression,
  vars: string | string[]
): UnivariateCoefficients | MultivariateCoefficients | null {
  return univariateCoefficients([[]]) ?? [[]];
}

/**
 * Return a polynomial expression of `vars` with coefficient
 * of powers `coefs`.
 *
 * `poly === polynomial(coefficients(poly), getVars(poly))`
 *
 */
export function polynomial(
  coefs: UnivariateCoefficients,
  vars: string
): SemiBoxedExpression;
export function polynomial(
  coefs: MultivariateCoefficients,
  vars: string[]
): SemiBoxedExpression;
export function polynomial(
  coefs: UnivariateCoefficients | MultivariateCoefficients,
  vars: string | string[]
): SemiBoxedExpression {
  if (typeof vars === 'string') vars = [vars];
  const terms: SemiBoxedExpression[] = [];

  let degree = 0;
  for (const coef of coefs) {
    if (coef === null) continue;
    if (degree === 0) {
      // Constant term
      terms.push(coef[0]);
    } else if (degree === 1) {
      const term: BoxedExpression[] = [];
      for (const [i, v] of vars) {
        if (coef[i]) {
        }
      }
    } else {
    }
    degree += 1;
  }

  if (terms.length === 0) return 0;
  if (terms.length === 1) return terms[0];
  return ['Add', ...terms];
}

/** If possible, attempt to return a UnivariateCoefficient.
 * If the coefficients really are multivariate, return `null` */
function univariateCoefficients(
  coefs: UnivariateCoefficients | MultivariateCoefficients
): UnivariateCoefficients | null {
  const result: UnivariateCoefficients = [];

  return null;
}

/**
 * Return the sum of positive integer exponents for an expression.
 */
function getDegree(expr: BoxedExpression | undefined): number {
  if (expr === undefined) return 0;

  if (expr.symbol) {
    return expr.symbolDefinition?.constant ?? false ? 0 : 1;
  }

  if (expr.ops) {
    const head = expr.head;
    if (head === 'Power') {
      const exponent = expr.op2.numericValue;
      if (typeof exponent === 'number')
        return Number.isInteger(exponent) ? exponent : 0;
      if (exponent instanceof Decimal)
        return exponent.isInteger() ? exponent.toNumber() : 0;
      return 0;
    }
    if (head === 'Multiply') {
      return [...expr.ops].reduce((acc, x) => acc + getDegree(x), 0);
    }
    if (head === 'Add' || head === 'Subtract') {
      return Math.max(...expr.ops.map((x) => getDegree(x)));
    }
    if (head === 'Negate') return getDegree(expr.op1);
  }
  return 0;
}

/**
 * The total degree of an expression is the sum of the
 * of the positive integer degrees of the factors in the expression:
 *
 * `3√2x^5y^3` -> 8 (5 + 3)
 */
export function totalDegree(expr: BoxedExpression): number {
  if (expr.head === 'Power' && expr.op2.numericValue !== null) {
    const deg = asMachineInteger(expr.op2);
    if (deg !== null && deg > 0) return deg;
    return 1;
  }

  if (expr.head === 'Multiply') {
    let deg = 1;
    for (const arg of expr.ops!) {
      const t = totalDegree(arg);
      if (t > 1) deg = deg + t;
    }
    return deg;
  }

  return 1;
}

/**
 * The max degree of an expression is the largest positive integer degree
 * in the factors of the expression
 *
 * `3√2x^5y^3` -> 5
 *
 */
export function maxDegree(expr: BoxedExpression): number {
  if (expr.head === 'Power' && expr.op2.numericValue !== null) {
    const deg = asMachineInteger(expr.op2);
    if (deg !== null && deg > 0) return deg;
    return 1;
  }

  if (expr.head === 'Multiply') {
    let deg = 1;
    for (const arg of expr.ops!) deg = Math.max(deg, totalDegree(arg));
    return deg;
  }

  return 1;
}

/**
 * Return a lexicographic key of the expression
 */
export function lex(expr: BoxedExpression): string {
  if (expr.symbol) return expr.symbol;
  if (expr.ops) {
    const h = typeof expr.head === 'string' ? expr.head : lex(expr.head);
    return (
      h +
      '"' +
      expr.ops
        .map((x) => lex(x))
        .filter((x) => x.length > 0)
        .join('"')
    );
  }
  return '';
}
