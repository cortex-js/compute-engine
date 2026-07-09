import type { BigNum } from './types.js';
import { BigDecimal } from '../../big-decimal/index.js';

export function gcd(a: BigNum, b: BigNum): BigNum {
  //@todo: https://github.com/Yaffle/bigint-gcd/blob/main/gcd.js
  console.assert(a.isInteger() && b.isInteger());
  while (!b.isZero()) [a, b] = [b, a.mod(b)];
  return a.abs();
}

export function lcm(a: BigNum, b: BigNum): BigNum {
  // The least common multiple is non-negative by convention.
  return a.mul(b).div(gcd(a, b)).abs();
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
 * If the BigDecimal can be *faithfully* (losslessly) represented as a machine
 * number, return true.
 *
 * This is used to decide whether a value can be serialized as a plain JSON
 * number without losing information. A ≤17-significant-digit heuristic is NOT
 * sufficient: only decimals with ≤15 significant digits are guaranteed to
 * round-trip through float64, and some 16–17 digit values silently change
 * (e.g. `0.12345678901234567` → `0.12345678901234566`). So we test the exact
 * round-trip condition: the value must equal the BigDecimal reconstructed from
 * its own `toNumber()` (via the shortest-string form a JSON number would emit).
 */
export function isInMachineRange(d: BigNum): boolean {
  if (!d.isFinite()) return true; // Infinity and NaN are in machine range
  if (d.isZero()) return true;

  // Count significant digits in the significand
  const absSig = d.significand < 0n ? -d.significand : d.significand;
  const sigStr = absSig.toString();
  const digits = sigStr.length;

  // A float64's shortest round-tripping decimal has at most 17 significant
  // digits, so anything longer cannot be exactly represented.
  if (digits > 17) return false;

  // Check the value is within float64 range (avoid overflow to Infinity and
  // subnormal precision loss).
  // value = sig × 10^exp, order of magnitude ≈ digits + exponent - 1
  const orderOfMagnitude = digits + d.exponent - 1;
  if (orderOfMagnitude >= 309 || orderOfMagnitude <= -308) return false;

  // Exact round-trip test: representable iff it survives float64 conversion.
  return d.eq(new BigDecimal(d.toNumber()));
}
