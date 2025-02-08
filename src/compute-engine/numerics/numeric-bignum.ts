import type { BigNum, IBigNum } from './types';

export function gcd(a: BigNum, b: BigNum): BigNum {
  //@todo: https://github.com/Yaffle/bigint-gcd/blob/main/gcd.js
  console.assert(a.isInteger() && b.isInteger());
  while (!b.isZero()) [a, b] = [b, a.modulo(b)];
  return a.abs();
}

export function lcm(a: BigNum, b: BigNum): BigNum {
  return a.mul(b).div(gcd(a, b));
}

export function factorial2(ce: IBigNum, n: BigNum): BigNum {
  if (!n.isInteger() || n.isNegative()) return ce._BIGNUM_NAN;
  if (n.lessThan(1)) return ce._BIGNUM_ONE;

  let result = n;
  while (n.greaterThan(2)) {
    n = n.minus(2);
    result = result.mul(n);
  }

  return result;
}

/**
 * If the exponent of the bignum is in the range of the exponents
 * for machine numbers,return true.
 */
export function isInMachineRange(d: BigNum): boolean {
  if (!d.isFinite()) return true; // Infinity and NaN are in machine range

  // Are there too many significant digits?
  // Maximum Safe Integer is 9007199254740991
  // Digits in Decimal are stored by blocks of 7.
  // Three blocks, with the first block = 90 is close to the maximum
  if (d.d.length > 3 || (d.d.length === 3 && d.d[0] >= 90)) return false;

  console.assert(d.precision() <= 16);

  // Is the exponent within range?
  // With a binary 64 IEEE 754 number:
  // significant bits: 53 -> 15 digits
  // exponent bits: 11. emax = 307, emin = -306)
  return d.e < 308 && d.e > -306;
}

// export function asMachineNumber(d: Decimal): number | null {
//   if (d.precision() < 15 && d.e < 308 && d.e > -306) return d.toNumber();
//   return null;
// }
