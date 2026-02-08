import type { BoxedExpression } from '../global-types';
import { asSmallInteger } from './numerics';
import { isBoxedSymbol, isBoxedFunction, isBoxedNumber } from './type-guards';

/**
 * The total degree of an expression is the sum of the
 * positive integer degrees of the factors in the expression:
 *
 * `3√2x^5y^3` -> 5 + 3 = 8
 */
export function totalDegree(expr: BoxedExpression): number {
  // e.g. "x"
  if (isBoxedSymbol(expr) && !expr.isConstant) return 1;

  if (!isBoxedFunction(expr)) return 0;

  if (expr.operator === 'Power' && isBoxedNumber(expr.op2)) {
    // If the base has no unknowns, the degree is 0, e.g. 2^3
    if (totalDegree(expr.op1) === 0) return 0;
    const deg = asSmallInteger(expr.op2);
    if (deg !== null && deg > 0) return deg;
    return 0;
  }

  if (expr.operator === 'Multiply') {
    let deg = 0;
    for (const arg of expr.ops) {
      const t = totalDegree(arg);
      deg = deg + t;
    }
    return deg;
  }

  if (expr.operator === 'Add' || expr.operator === 'Subtract') {
    let deg = 0;
    for (const arg of expr.ops) deg = Math.max(deg, totalDegree(arg));
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
  if (isBoxedSymbol(expr) && !expr.isConstant) return 1;

  if (!isBoxedFunction(expr)) return 0;

  if (expr.operator === 'Power' && isBoxedNumber(expr.op2)) {
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
    for (const arg of expr.ops) deg = Math.max(deg, totalDegree(arg));
    return deg;
  }

  if (expr.operator === 'Negate') return maxDegree(expr.op1);

  if (expr.operator === 'Divide') return maxDegree(expr.op1);

  return 0;
}

export function lex(expr: BoxedExpression): string {
  // Consider symbols, but ignore constants such as "Pi" or "ExponentialE"
  if (isBoxedSymbol(expr) && !expr.isConstant) return expr.symbol;
  if (!isBoxedFunction(expr)) return '';
  return expr.ops
    .map((x) => lex(x))
    .join(' ')
    .trim();
}

export function revlex(expr: BoxedExpression): string {
  return lex(expr).split(' ').reverse().join(' ').trim();
}
