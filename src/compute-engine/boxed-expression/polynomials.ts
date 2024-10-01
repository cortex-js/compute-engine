import type { BoxedExpression } from '../public';
import { asSmallInteger } from './numerics';

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
  if (term.operator === 'Negate') {
  } else if (term.operator === 'Multiply') {
  } else if (term.operator === 'Power') {
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
// export function polynomial(
//   coefs: UnivariateCoefficients,
//   vars: string
// ): BoxedExpression;
// export function polynomial(
//   coefs: MultivariateCoefficients,
//   vars: string[]
// ): BoxedExpression;

// export function polynomial(
//   coefs: UnivariateCoefficients | MultivariateCoefficients,
//   vars: string | string[]
// ): BoxedExpression {
//   if (typeof vars === 'string') vars = [vars];
//   const terms: BoxedExpression[] = [];

//   let degree = 0;
//   for (const coef of coefs) {
//     if (coef === null) continue;
//     if (degree === 0) {
//       // Constant term
//       terms.push(coef[0]);
//     } else if (degree === 1) {
//       const term: BoxedExpression[] = [];
//       for (const [i, v] of vars) {
//         if (coef[i]) {
//         }
//       }
//     } else {
//     }
//     degree += 1;
//   }

//   if (terms.length === 0) return 0;
//   if (terms.length === 1) return terms[0];
//   return ['Add', ...terms];
// }

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
    return (expr.symbolDefinition?.constant ?? false) ? 0 : 1;
  }

  if (expr.ops) {
    const operator = expr.operator;
    if (operator === 'Power') return expr.op2.re;

    if (operator === 'Multiply') {
      return [...expr.ops].reduce((acc, x) => acc + getDegree(x), 0);
    }
    if (operator === 'Add' || operator === 'Subtract') {
      return Math.max(...expr.ops.map((x) => getDegree(x)));
    }
    if (operator === 'Negate') return getDegree(expr.op1);
  }
  return 0;
}

/**
 * The total degree of an expression is the sum of the
 * positive integer degrees of the factors in the expression:
 *
 * `3√2x^5y^3` -> 5 + 3 = 8
 */
export function totalDegree(expr: BoxedExpression): number {
  // e.g. "x"
  if (expr.symbol && !expr.isConstant) return 1;

  if (expr.operator === 'Power' && expr.op2.isNumberLiteral) {
    // If the base has no unknowns, the degree is 0, e.g. 2^3
    if (totalDegree(expr.op1) === 0) return 0;
    const deg = asSmallInteger(expr.op2);
    if (deg !== null && deg > 0) return deg;
    return 0;
  }

  if (expr.operator === 'Multiply') {
    let deg = 0;
    for (const arg of expr.ops!) {
      const t = totalDegree(arg);
      deg = deg + t;
    }
    return deg;
  }

  if (expr.operator === 'Add' || expr.operator === 'Subtract') {
    let deg = 0;
    for (const arg of expr.ops!) deg = Math.max(deg, totalDegree(arg));
    return deg;
  }

  if (expr.operator === 'Negate') return totalDegree(expr.op1);

  if (expr.operator === 'Divide') return totalDegree(expr.op1);

  return 0;
}

/**
 * The max degree of a polynomial is the largest positive integer degree
 * in the factors (monomials) of the expression
 *
 * `3√2x^5y^3` -> 5
 *
 */
export function maxDegree(expr: BoxedExpression): number {
  // e.g. "x"
  if (expr.symbol && !expr.isConstant) return 1;

  if (expr.operator === 'Power' && expr.op2.isNumberLiteral) {
    // If the base has no unknowns, the degree is 0, e.g. 2^3
    if (maxDegree(expr.op1) === 0) return 0;

    const deg = asSmallInteger(expr.op2);
    if (deg !== null && deg > 0) return deg;
    return 0;
  }

  if (
    expr.operator === 'Multiply' ||
    expr.operator === 'Add' ||
    expr.operator === 'Subtract'
  ) {
    let deg = 0;
    for (const arg of expr.ops!) deg = Math.max(deg, totalDegree(arg));
    return deg;
  }

  if (expr.operator === 'Negate') return maxDegree(expr.op1);

  if (expr.operator === 'Divide') return maxDegree(expr.op1);

  return 0;
}

/**
 * Return a lexicographic key of the expression, for example
 * `xy^2` -> `x y`
 * `x\frac{1}{y}` -> `x y`
 * `2xy + y^2` -> `x y y`
 *
 */
export function lex(expr: BoxedExpression): string {
  // Consider symbols, but ignore constants such as "Pi" or "ExponentialE"
  if (expr.symbol && !expr.isConstant) return expr.symbol;
  if (!expr.ops) return '';
  return expr.ops
    .map((x) => lex(x))
    .join(' ')
    .trim();
}

export function revlex(expr: BoxedExpression): string {
  return lex(expr).split(' ').reverse().join(' ').trim();
}
