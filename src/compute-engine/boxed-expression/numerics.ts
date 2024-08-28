import Decimal from 'decimal.js';

import type { Rational } from '../numerics/rationals';

import type { BoxedExpression } from './public';

import { SMALL_INTEGER, chop } from '../numerics/numeric';
import { bigint } from '../numerics/bigint';

import { ExactNumericValue } from '../numeric-value/exact-numeric-value';
import { NumericValue } from '../numeric-value/public';

export function asRational(expr: BoxedExpression): Rational | undefined {
  const num = expr.numericValue;
  if (num === null) return undefined;
  if (typeof num === 'number' && !Number.isFinite(num)) return undefined;
  if (
    num instanceof NumericValue &&
    (num.isNaN || num.isPositiveInfinity || num.isNegativeInfinity)
  )
    return undefined;

  if (typeof num === 'number') {
    if (!Number.isInteger(num)) return undefined;
    return [num, 1];
  }

  const type = num.type;
  if (type !== 'integer' && type !== 'rational') return undefined;

  if (num.im !== 0) return undefined;

  if (num instanceof ExactNumericValue) {
    if (num.radical !== 1) return undefined;
    return num.rational;
  }

  const bignumRe = num.bignumRe;
  if (bignumRe !== undefined && Number.isInteger(bignumRe))
    return [bigint(bignumRe)!, BigInt(1)];

  const re = num.re;
  if (Number.isInteger(re)) return [re, 1];

  return undefined;
}

export function asBigint(expr: BoxedExpression | undefined): bigint | null {
  if (expr === undefined || expr === null) return null;
  const num = expr.numericValue;
  if (num === null) return null;

  if (typeof num === 'number') {
    if (Number.isInteger(num)) return BigInt(num);
    return null;
  }

  if (num.im !== 0) return null;

  const n = num.bignumRe;
  if (n?.isInteger()) return bigint(n);

  if (num.re === undefined || !Number.isInteger(num.re)) return null;

  return BigInt(num.re);
}

export function asBignum(expr: BoxedExpression | undefined): Decimal | null {
  if (expr === undefined || expr === null) return null;
  const num = typeof expr === 'number' ? expr : expr.numericValue;
  if (num === null) return null;

  if (typeof num === 'number') return expr.engine.bignum(num);

  if (num.im !== 0) return null;

  const re = num.bignumRe ?? num.re;
  if (re === undefined) return null;
  return expr.engine.bignum(re);
}

export function asSmallInteger(
  expr: number | BoxedExpression | undefined
): number | null {
  if (expr === undefined || expr === null) return null;
  if (typeof expr === 'number') {
    if (
      Number.isInteger(expr) &&
      expr >= -SMALL_INTEGER &&
      expr <= SMALL_INTEGER
    )
      return expr;
    return null;
  }
  const num = expr.numericValue;
  if (num === null) return null;

  if (typeof num === 'number') {
    if (Number.isInteger(num) && num >= -SMALL_INTEGER && num <= SMALL_INTEGER)
      return num;
    return null;
  }

  if (num.im !== 0) return null;

  const n = num.re;
  if (Number.isInteger(n) && n >= -SMALL_INTEGER && n <= SMALL_INTEGER)
    return Number(n);
  return null;
}

/**
 *
 * @param lhs
 * @param rhs
 * @returns the sign (-1, 0, 1) of the difference between `lhs` and `rhs`
 */
export function signDiff(
  lhs: BoxedExpression,
  rhs: BoxedExpression,
  tolerance?: number
): -1 | 0 | 1 | undefined {
  // Identity?
  if (lhs === rhs) return 0;

  const lhsN = lhs.N();
  const rhsN = rhs.N();

  // Structural equality?
  if (lhsN.isSame(rhsN)) return 0;

  if (lhs.isNumberLiteral && lhs.im !== 0) return undefined;
  if (rhs.isNumberLiteral && rhs.im !== 0) return undefined;

  const lhsNum = lhsN.numericValue;
  const rhsNum = rhsN.numericValue;

  // In general, it is impossible to always prove equality
  // (Richardson's theorem) but this works often...
  if (lhsNum === null || rhsNum === null) {
    const s = lhs.sub(rhs).N().sgn;
    if (s === 'zero') return 0;
    if (s === 'positive') return 1;
    if (s === 'negative') return -1;
    return undefined;
  }

  tolerance ??= lhs.engine.tolerance;

  // At this point, lhsNum and rhsNum are numeric values

  if (typeof lhsNum === 'number' && typeof rhsNum === 'number') {
    if (chop(rhsNum - lhsNum, tolerance) === 0) return 0;
    return lhsNum < rhsNum ? -1 : 1;
  }
  const ce = lhs.engine;
  const lhsV = ce._numericValue(lhsNum);
  const rhsV = ce._numericValue(rhsNum);

  const delta = lhsV.sub(rhsV);

  if (delta.isZeroWithTolerance(tolerance)) return 0;
  return delta.sgn();
}
