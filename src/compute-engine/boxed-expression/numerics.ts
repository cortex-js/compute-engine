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
  if (type !== 'finite_integer' && type !== 'finite_rational') return undefined;

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
