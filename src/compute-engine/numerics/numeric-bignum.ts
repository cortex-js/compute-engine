import type { BigNum } from './types';
import { BigDecimal } from '../../big-decimal';

export function gcd(a: BigNum, b: BigNum): BigNum {
  //@todo: https://github.com/Yaffle/bigint-gcd/blob/main/gcd.js
  console.assert(a.isInteger() && b.isInteger());
  while (!b.isZero()) [a, b] = [b, a.mod(b)];
  return a.abs();
}

export function lcm(a: BigNum, b: BigNum): BigNum {
  return a.mul(b).div(gcd(a, b));
}

export function* factorial2(n: BigNum): Generator<BigNum, BigNum> {
  if (!n.isInteger() || n.isNegative()) return BigDecimal.NAN;
  if (n.lt(1)) return BigDecimal.ONE;

  let result = n;
  while (n.gt(2)) {
    n = n.sub(2);
    result = result.mul(n);
    yield result;
  }

  return result;
}

/**
 * If the BigDecimal can be faithfully represented as a machine number,
 * return true.
 */
export function isInMachineRange(d: BigNum): boolean {
  if (!d.isFinite()) return true; // Infinity and NaN are in machine range
  if (d.isZero()) return true;

  // Count significant digits in the significand
  const absSig = d.significand < 0n ? -d.significand : d.significand;
  const sigStr = absSig.toString();
  const digits = sigStr.length;

  // Float64 has ~15.95 decimal digits of precision, but can represent
  // up to 17 significant digits for some values
  if (digits > 17) return false;

  // Check the value is within float64 range
  // value = sig × 10^exp, order of magnitude ≈ digits + exponent - 1
  const orderOfMagnitude = digits + d.exponent - 1;
  // Stay above subnormal range (-308) to avoid precision loss
  return orderOfMagnitude < 309 && orderOfMagnitude > -308;
}
