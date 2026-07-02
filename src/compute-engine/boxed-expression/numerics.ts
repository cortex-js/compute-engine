import { Complex } from 'complex-esm';
import { BigDecimal } from '../../big-decimal';

import type { Rational } from '../numerics/types';

import type { Expression, ExpressionInput } from '../global-types';
import { isExpression } from './utils';

import { SMALL_INTEGER } from '../numerics/numeric';
import { bigint } from '../numerics/bigint';

import { ExactNumericValue } from '../numeric-value/exact-numeric-value';
import { NumericValue } from '../numeric-value/types';
import { bigintValue } from '../numerics/expression';
import { MathJsonExpression } from '../types';
import { isNumber } from './type-guards';

export function asRational(expr: Expression): Rational | undefined {
  if (!isNumber(expr)) return undefined;
  const num = expr.numericValue;
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
  if (bignumRe !== undefined && bignumRe.isInteger())
    return [bigint(bignumRe)!, BigInt(1)];

  const re = num.re;
  if (Number.isInteger(re)) return [re, 1];

  return undefined;
}

/**
 * Extract the exact integer value of a `NumericValue`, or `null` if it does
 * not represent an exact integer.
 *
 * This reads the exact underlying representation directly — the integer
 * numerator of an `ExactNumericValue`, or the integer-valued `BigDecimal` of a
 * `BigNumericValue` (via its exact significand) — and never round-trips through
 * `bignumRe`, which is rendered at the engine's working precision and would
 * silently round any integer with more digits than `ce.precision` (corrupting
 * large-integer number theory: `IsPrime`, `FactorInteger`, `Mod`, …).
 */
function exactIntegerValue(num: NumericValue): bigint | null {
  if (num.im !== 0) return null;
  const exact = num.asExact;
  if (!(exact instanceof ExactNumericValue)) return null;
  // A value of the form a/b·√c is an integer only when c = 1 (no radical).
  if (exact.radical !== 1) return null;
  const [n, d] = exact.rational;
  const bn = typeof n === 'bigint' ? n : BigInt(n);
  const bd = typeof d === 'bigint' ? d : BigInt(d);
  if (bd === BigInt(0)) return null;
  if (bn % bd !== BigInt(0)) return null; // a non-integer rational
  return bn / bd;
}

export function asBigint(
  x: Complex | BigDecimal | ExpressionInput | undefined
): bigint | null {
  if (x === undefined || x === null) return null;

  if (typeof x === 'bigint') return x;
  if (typeof x === 'number' && Number.isInteger(x)) return BigInt(x);

  if (isExpression(x)) {
    if (!isNumber(x)) return null;
    const num = x.numericValue;

    if (typeof num === 'number') {
      if (Number.isInteger(num)) return BigInt(num);
      return null;
    }

    // Extract the exact integer without a precision-limited round-trip.
    const exact = exactIntegerValue(num);
    if (exact !== null) return exact;

    if (num.im !== 0) return null;

    // Not an exact integer: only accept a genuine integer-valued float.
    if (!Number.isInteger(num.re)) return null;

    return BigInt(num.re);
  }

  if (x instanceof BigDecimal || typeof x === 'string') return bigint(x);

  if (x instanceof Complex) {
    if (x.im === 0) return bigint(x.re);
    return null;
  }

  return bigintValue(x as MathJsonExpression);
}

export function asBignum(expr: Expression | undefined): BigDecimal | null {
  if (expr === undefined || expr === null) return null;
  if (!isNumber(expr)) return null;
  const num = typeof expr === 'number' ? expr : expr.numericValue;

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
  expr: number | Expression | undefined
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
  if (!isNumber(expr)) return null;
  const num = expr.numericValue;

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
 * Convert a boxed expression to a machine integer.
 * Returns null if the expression cannot be converted to an integer.
 * If the expression is a complex number, only the real part is considered.
 * If the real part is not an integer, it is rounded to the nearest integer.
 *
 * Unlike `asSmallInteger()`, this function does not restrict the result to
 * [-SMALL_INTEGER, SMALL_INTEGER], and it rounds a non-integer real part to
 * the nearest integer.
 *
 * Returns null when the result is not finite or exceeds the safe-integer range
 * (|n| > 2^53): a machine `number` cannot represent such an integer exactly, so
 * returning a rounded value would silently lose precision. Callers that need
 * the exact value of a large integer must use `toBigint()`/`asBigint()`
 * instead. (This is what makes `toInteger` unsuitable for value-semantic uses
 * such as primality testing — see `isPrime` in predicates.ts.)
 */
export function toInteger(expr: Expression | undefined): number | null {
  if (!isNumber(expr)) return null;
  const num = expr.numericValue;
  const re = typeof num === 'number' ? num : num.re;
  if (!Number.isFinite(re)) return null;
  const n = Math.round(re);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

/** Convert a boxed expression to a bigint.
 * Returns null if the expression cannot be converted to a bigint.
 * If the expression is a complex number, only the real part is considered.
 * If the real part is not an integer, it is rounded to the nearest integer.
 */
export function toBigint(expr: Expression | undefined): bigint | null {
  if (expr === undefined || expr === null) return null;
  if (!isNumber(expr)) return null;
  const num = expr.numericValue;

  // A non-finite value (±∞, NaN) has no bigint: return null per the
  // documented contract — `BigInt(Infinity)` throws a RangeError that would
  // escape `evaluate()` (EX-15: Fibonacci(+∞) & the integer-domain family).
  if (typeof num === 'number')
    return Number.isFinite(num) ? BigInt(Math.round(num)) : null;

  // Prefer an exact extraction for exact integers to avoid the
  // precision-limited `bignumRe` round-trip (see `asBigint`).
  const exact = exactIntegerValue(num);
  if (exact !== null) return exact;

  const n = num.bignumRe ?? num.re;
  if (typeof n === 'number')
    return Number.isFinite(n) ? BigInt(Math.round(n)) : null;

  return bigint(n.round());
}
