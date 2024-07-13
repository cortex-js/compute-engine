import Decimal from 'decimal.js';
import Complex from 'complex.js';

import {
  Rational,
  inverse,
  isBigRational,
  isMachineRational,
  isRational,
  rationalize,
} from '../numerics/rationals';
import { BoxedExpression } from './public';
import { SMALL_INTEGER, chop } from '../numerics/numeric';
import { bigint } from '../numerics/numeric-bigint';

export function asRational(expr: BoxedExpression): Rational | undefined {
  const num = expr.numericValue;
  if (Array.isArray(num)) return num;
  if (num === null) return undefined;
  if (typeof num === 'number' && Number.isInteger(num)) {
    if (num > 1e9 || num < -1e9) return [BigInt(num), BigInt(1)];
    return [num, 1];
  }
  if (num instanceof Decimal && num.isInteger())
    return [bigint(num), BigInt(1)];
  return undefined;
}

export function asApproximateRational(
  expr: BoxedExpression
): Rational | undefined {
  let result: number | Rational | undefined = asRational(expr);
  if (result) return result;
  const f = asFloat(expr);
  if (f === null) return undefined;
  result = rationalize(f);
  if (isRational(result)) return result;
  return undefined;
}

export function div(lhs: Rational, rhs: Rational): Rational {
  return mul(lhs, inverse(rhs));
}

/**
 * Add a literal numeric value to a rational.
 * If the rational is a bigint, this is a hint to do the calculation in bigint
 * (no need to check `bignumPreferred()`).
 * @param lhs
 * @param rhs
 * @returns
 */
export function add(lhs: Rational, rhs: BoxedExpression | Rational): Rational {
  console.assert(
    Array.isArray(rhs) ||
      (rhs.numericValue !== null && !(rhs.numericValue instanceof Complex))
  );
  // If the lhs is infinity (or NaN) return as is
  // (note that bigint cannot be infinite)
  if (typeof lhs[0] === 'number' && !Number.isFinite(lhs[0])) return lhs;

  const rhsNum = Array.isArray(rhs) ? rhs : rhs.numericValue;

  if (rhsNum === null) return lhs;

  if (Array.isArray(rhsNum)) {
    if (isBigRational(rhsNum)) {
      lhs = [BigInt(lhs[0]), BigInt(lhs[1])];
      return [rhsNum[1] * lhs[0] + rhsNum[0] * lhs[1], rhsNum[1] * lhs[1]];
    }
    if (!Number.isFinite(rhsNum[0])) return rhsNum;
    if (isBigRational(lhs)) {
      const bigRhs = [BigInt(rhsNum[0]), BigInt(rhsNum[1])];
      return [bigRhs[1] * lhs[0] + bigRhs[0] * lhs[1], bigRhs[1] * lhs[1]];
    }
    return [rhsNum[1] * lhs[0] + rhsNum[0] * lhs[1], rhsNum[1] * lhs[1]];
  }

  if (rhsNum instanceof Decimal) {
    if (rhsNum.isNaN()) return [Number.NaN, 1];
    if (!rhsNum.isFinite())
      return [rhsNum.isNegative() ? -Infinity : Infinity, 1];

    console.assert(rhsNum.isInteger());

    if (isMachineRational(lhs)) lhs = [BigInt(lhs[0]), BigInt(lhs[1])];
    // Decimal and Rational return a bigRational
    return [lhs[0] + lhs[1] * bigint(rhsNum.toString()), lhs[1]];
  }

  // Can't add a complex to a rational
  if (rhsNum instanceof Complex) return [Number.NaN, 1];

  console.assert(!Number.isFinite(rhsNum) || Number.isInteger(rhsNum));

  if (!Number.isFinite(rhsNum)) return [rhsNum, 1];

  if (isMachineRational(lhs)) return [lhs[0] + lhs[1] * rhsNum, lhs[1]];

  // By this point, lhs is a bigRational, rhsNum is a number
  return [lhs[0] + lhs[1] * bigint(rhsNum), lhs[1]];
}

export function mul(lhs: Rational, rhs: BoxedExpression | Rational): Rational {
  console.assert(
    Array.isArray(rhs) ||
      (rhs.numericValue !== null && !(rhs instanceof Complex))
  );

  if (Array.isArray(rhs)) {
    if (isMachineRational(lhs) && isMachineRational(rhs))
      return [lhs[0] * rhs[0], lhs[1] * rhs[1]];
    if (isMachineRational(lhs)) lhs = [BigInt(lhs[0]), BigInt(lhs[1])];
    if (isMachineRational(rhs)) rhs = [BigInt(rhs[0]), BigInt(rhs[1])];
    return [lhs[0] * rhs[0], lhs[1] * rhs[1]];
  }

  const rhsNum = rhs.numericValue;
  if (rhsNum !== null && typeof rhsNum === 'number') {
    console.assert(Number.isInteger(rhsNum));
    if (isMachineRational(lhs)) return [lhs[0] * rhsNum, lhs[1]];
    return [lhs[0] * bigint(rhsNum), lhs[1]];
  }

  if (rhsNum instanceof Decimal) {
    console.assert(rhsNum.isInteger());
    if (isMachineRational(lhs))
      return [bigint(rhsNum.toString()) * bigint(lhs[0]), bigint(lhs[1])];
    return [bigint(rhsNum.toString()) * lhs[0], lhs[1]];
  }

  if (Array.isArray(rhsNum)) {
    if (isBigRational(rhsNum))
      return [rhsNum[0] * bigint(lhs[0]), rhsNum[1] * bigint(lhs[1])];
    else if (isMachineRational(lhs))
      return [lhs[0] * rhsNum[0], lhs[1] * rhsNum[1]];

    return [lhs[0] * bigint(rhsNum[0]), lhs[1] * bigint(rhsNum[1])];
  }

  // If we've reached this point, rhsNum is a Complex
  debugger;
  return lhs;
}

export function asFloat(expr: BoxedExpression | undefined): number | null {
  if (expr === undefined || expr === null) return null;
  const num = expr.numericValue;
  if (num === null) return null;

  if (typeof num === 'number') return num;

  if (num instanceof Decimal) return num.toNumber();

  if (Array.isArray(num)) {
    const [n, d] = num;
    if (typeof n === 'number' && typeof d === 'number') return n / d;
    return Number(n as bigint) / Number(d as bigint);
  }

  console.assert(!(num instanceof Complex) || num.im !== 0);

  return null;
}

export function asBignum(expr: BoxedExpression | undefined): Decimal | null {
  if (expr === undefined || expr === null) return null;
  const num = expr.numericValue;
  if (num === null) return null;

  if (num instanceof Decimal) return num;

  if (typeof num === 'number') return expr.engine.bignum(num);

  if (Array.isArray(num)) {
    const [n, d] = num;
    if (typeof n === 'number' && typeof d === 'number')
      return expr.engine.bignum(n / d);
    return expr.engine.bignum(n).div(d.toString());
  }

  console.assert(!(num instanceof Complex) || num.im !== 0);

  return null;
}

export function asMachineInteger(
  expr: BoxedExpression | undefined
): number | null {
  if (expr === undefined || expr === null) return null;
  const num = expr.numericValue;
  if (num === null) return null;

  if (typeof num === 'number') {
    if (Number.isInteger(num) && num >= -SMALL_INTEGER && num <= SMALL_INTEGER)
      return num;
    return null;
  }

  if (num instanceof Decimal) {
    if (num.isInteger()) {
      const n = num.toNumber();
      if (n >= -SMALL_INTEGER && n <= SMALL_INTEGER) return n;
    }
    return null;
  }

  // If we're canonical, a rational is never a small integer
  if (expr.isCanonical) return null;

  // We're not canonical, a rational could be a small integer, i.e. 4/2
  const r = num;
  if (Array.isArray(r)) {
    const [n, d] = r;
    let v: number;
    if (typeof n === 'number' && typeof d === 'number') v = n / d;
    else v = Number(n) / Number(d);

    if (Number.isInteger(v) && v >= -SMALL_INTEGER && v <= SMALL_INTEGER)
      return v;
    return null;
  }

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
  if (lhs === rhs) return 0;

  const lhsN = lhs.N();
  const rhsN = rhs.N();

  if (lhsN.isSame(rhsN)) return 0;

  const lhsNum = lhsN.numericValue;
  const rhsNum = rhsN.numericValue;

  if (lhsNum === null || rhsNum === null) {
    const ce = lhs.engine;
    const diff = ce.add(lhsN, rhsN.neg());
    if (diff.isZero) return 0;
    // @fixme: use diff.numericValue & chop
    const s = diff.sgn;
    if (s !== null) return s;
    return undefined;
  }

  tolerance ??= lhs.engine.tolerance;

  if (lhsNum instanceof Complex && rhsNum instanceof Complex)
    return chop(lhsNum.re - rhsNum.re, tolerance) === 0 &&
      chop(lhsNum.im - rhsNum.im, tolerance) === 0
      ? 0
      : undefined;

  if (lhsNum instanceof Complex || rhsNum instanceof Complex) return undefined;

  // In general, it is impossible to always prove equality
  // (Richardson's theorem) but this works often...

  // At this point, lhsNum and rhsNum are either number or Decimal
  // (it can't be a rational, because lhs.N() simplifies rationals to number or Decimal)
  console.assert(!isRational(lhsNum) && !isRational(rhsNum));

  if (typeof lhsNum === 'number' && typeof rhsNum === 'number') {
    if (chop(rhsNum - lhsNum, tolerance) === 0) return 0;
    return lhsNum < rhsNum ? -1 : 1;
  }
  const ce = lhs.engine;
  const delta = ce
    .bignum(rhsNum as number | Decimal)
    .sub(ce.bignum(lhsNum as number | Decimal));

  if (chop(delta, tolerance) === 0) return 0;
  return delta.isPos() ? 1 : -1;
}
