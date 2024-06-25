import Decimal from 'decimal.js';
import Complex from 'complex.js';

import {
  Rational,
  inverse,
  isBigRational,
  isMachineRational,
  isRational,
  isRationalOne,
  neg,
  pow,
  rationalize,
  sqrt,
} from '../numerics/rationals';
import { BoxedExpression } from './public';
import { SMALL_INTEGER, chop } from '../numerics/numeric';
import { bigint } from '../numerics/numeric-bigint';

/**
 * Attempt to factor a numeric coefficient `c` and a `rest` out of a
 * canonical expression `expr` such that `ce.mul(c, rest)` is equal to `expr`.
 *
 * Attempts to make `rest` a positive value (i.e. pulls out negative sign).
 *
 * The numeric coefficient could be an expression, for example:
 * ['Multiply', 2, ['Sqrt', 5], 'x']
 *    -> [['Multiply', 2, ['Sqrt', 5]], 'x']
 *
 * ['Multiply', 2, 'x', 3, 'a']
 *    -> [6, ['Multiply', 'x', 'a']]
 *
 * ['Divide', ['Multiply', 2, 'x'], ['Multiply', 3, 'y', 'a']]
 *    -> [['Rational', 2, 3], ['Divide', 'x', ['Multiply, 'y', 'a']]]
 */
export function asCoefficient(
  expr: BoxedExpression
): [coef: Rational, rest: BoxedExpression] {
  console.assert(expr.isCanonical);

  const ce = expr.engine;

  //
  // Multiply
  //
  if (expr.head === 'Multiply') {
    const rest: BoxedExpression[] = [];
    let coef: Rational = [1, 1];
    for (const arg of expr.ops!) {
      // const r = asApproximateRational(arg);
      const r = asRational(arg);
      if (r) coef = mul(coef, r);
      else rest.push(arg);
    }

    if (isRationalOne(coef)) return [coef, expr];
    return [coef, ce.mul(...rest)];
  }

  //
  // Divide
  //
  if (expr.head === 'Divide') {
    // eslint-disable-next-line prefer-const
    const [coef1, numer] = asCoefficient(expr.op1);
    const [coef2, denom] = asCoefficient(expr.op2);

    const coef = mul(coef1, inverse(coef2));

    if (denom.isOne) return [coef, numer];
    if (isRationalOne(coef)) return [coef, expr];
    return [coef, ce.div(numer, denom)];
  }

  //
  // Power
  //
  if (expr.head === 'Power') {
    // We can only extract a coef if the exponent is a literal
    if (expr.op2.numericValue === null) return [[1, 1], expr];

    // eslint-disable-next-line prefer-const
    let [coef, base] = asCoefficient(expr.op1);
    if (isRationalOne(coef)) return [coef, expr];

    const exponent = asFloat(expr.op2);
    if (typeof exponent === 'number' && Number.isInteger(exponent))
      return [pow(coef, exponent), ce.pow(base, expr.op2)];

    return [[1, 1], expr];
  }

  if (expr.head === 'Sqrt') {
    const [coef, rest] = asCoefficient(expr.op1);
    let sqrtCoef = sqrt(coef);
    return sqrtCoef ? [sqrtCoef, ce.sqrt(rest)] : [[1, 1], expr];
  }

  //
  // Add
  //
  if (expr.head === 'Add') {
    // @todo: use factor() to factor out common factors
  }

  //
  // Negate
  //
  if (expr.head === 'Negate') {
    const [coef, rest] = asCoefficient(expr.op1);
    return [neg(coef), rest];
  }

  // @todo:  could consider others.. `Ln`, `Abs`, trig functions

  //
  // Literal
  //

  // Make the part positive if the real part is negative
  const z = expr.numericValue;
  if (z instanceof Complex && z.re < 0)
    return [[-1, 1], ce.number(ce.complex(-z.re, -z.im))];

  const r = asRational(expr);
  return r ? [r, ce.One] : [[1, 1], expr];
}

export function asRational(expr: BoxedExpression): Rational | undefined {
  const num = expr.numericValue;
  if (Array.isArray(num)) return num;
  if (num === null) return undefined;
  if (typeof num === 'number' && Number.isInteger(num)) {
    if (num > 1e9 || num < -1e9) return [bigint(num), BigInt(1)];
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
    if (isMachineRational(lhs)) lhs = [bigint(lhs[0]), bigint(lhs[1])];
    if (isMachineRational(rhs)) rhs = [bigint(rhs[0]), bigint(rhs[1])];
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

export function asSmallInteger(
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

  const lhsNum = lhsN.numericValue;
  const rhsNum = rhsN.numericValue;

  if (lhsNum === null || rhsNum === null) {
    // Couldn't calculate numeric value, use the `sgn` property
    const lhsS = lhsN.sgn;
    const rhsS = rhsN.sgn;
    if (typeof lhsS !== 'number' || typeof rhsS !== 'number') return undefined;
    if (lhsS === 0 && rhsS === 0) return 0;
    if (lhsS < 0 && rhsS > 0) return -1;
    if (lhsS > 0 && rhsS < 0) return +1;
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
