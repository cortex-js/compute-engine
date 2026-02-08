import { Complex } from 'complex-esm';
import { Decimal } from 'decimal.js';

import type { Rational } from '../numerics/types';

import type { BoxedExpression, SemiBoxedExpression } from '../global-types';
import { isBoxedExpression } from './utils';

import { SMALL_INTEGER } from '../numerics/numeric';
import { bigint } from '../numerics/bigint';

import { ExactNumericValue } from '../numeric-value/exact-numeric-value';
import { NumericValue } from '../numeric-value/types';
import { bigintValue } from '../numerics/expression';
import { Expression } from '../types';

export function asRational(expr: BoxedExpression): Rational | undefined {
  const num = expr.numericValue;
  if (num === undefined) return undefined;
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

export function asBigint(
  x: Complex | Decimal | SemiBoxedExpression | undefined
): bigint | null {
  if (x === undefined || x === null) return null;

  if (typeof x === 'bigint') return x;
  if (typeof x === 'number' && Number.isInteger(x)) return BigInt(x);

  if (isBoxedExpression(x)) {
    const num = x.numericValue;
    if (num === undefined) return null;

    if (typeof num === 'number') {
      if (Number.isInteger(num)) return BigInt(num);
      return null;
    }

    if (num.im !== 0) return null;

    const n = num.bignumRe;
    if (n?.isInteger()) return bigint(n);

    if (!Number.isInteger(num.re)) return null;

    return BigInt(num.re);
  }

  if (x instanceof Decimal || typeof x === 'string') return bigint(x);

  if (x instanceof Complex) {
    if (x.im === 0) return bigint(x.re);
    return null;
  }

  return bigintValue(x as Expression);
}

export function asBignum(expr: BoxedExpression | undefined): Decimal | null {
  if (expr === undefined || expr === null) return null;
  const num = typeof expr === 'number' ? expr : expr.numericValue;
  if (num === undefined) return null;

  if (typeof num === 'number') return expr.engine.bignum(num);

  if (num.im !== 0) return null;

  const re = num.bignumRe ?? num.re;
  if (typeof re === 'number' && isNaN(re)) return null;
  return expr.engine.bignum(re);
}

/**
 * Validate if the expression is a small integer.
 * A small integer is an integer between -SMALL_INTEGER and SMALL_INTEGER (inclusive).
 * Returns null if the expression is not a small integer.
 *
 * Unlike `toInteger()` this functions fails if the expression is not an
 * integer. `toInteger()` will round the value to the nearest integer.
 */
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
  if (num === undefined) return null;

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
 * Convert a boxed expression to an integer.
 * Returns null if the expression cannot be converted to an integer.
 * If the expression is a complex number, only the real part is considered.
 * If the real part is not an integer, it is rounded to the nearest integer.
 *
 * Unlike `asSmallInteger()`, this function does not check if the integer is
 * within the range of -SMALL_INTEGER to SMALL_INTEGER, and it rounds the
 * value to the nearest integer if it is a number.
 *
 */
export function toInteger(expr: BoxedExpression | undefined): number | null {
  const num = expr?.numericValue ?? undefined;
  if (num === undefined) return null;

  return Math.round(typeof num === 'number' ? num : num.re);
}

/** Convert a boxed expression to a bigint.
 * Returns null if the expression cannot be converted to a bigint.
 * If the expression is a complex number, only the real part is considered.
 * If the real part is not an integer, it is rounded to the nearest integer.
 */
export function toBigint(expr: BoxedExpression | undefined): bigint | null {
  if (expr === undefined || expr === null) return null;

  const num = expr.numericValue;
  if (num === undefined) return null;

  if (typeof num === 'number') return BigInt(Math.round(num));

  const n = num.bignumRe ?? num.re;
  if (typeof n === 'number') return BigInt(Math.round(n));

  return bigint(n.round());
}
