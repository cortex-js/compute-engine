import { ExactNumericValue } from './exact-numeric-value.js';
import { NumericValue } from './types.js';

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
export function exactIntegerValue(num: NumericValue): bigint | null {
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

/**
 * The double that holds the value of a `NumericValue` with NO rounding, or
 * `undefined` when no double does. Only an exact value qualifies: a rational
 * whose reduced denominator is a power of two (an integer, `1/2`, `3/4`, …)
 * and whose numerator fits the 53-bit significand at that scale. `1/3`, a
 * radical, a complex value and an integer past the significand (`2^53 + 1`)
 * have no such double, where `2^70` and `2^53 + 2` do.
 *
 * The double is computed from the exact integers, never from `re`: `re`
 * converts the numerator and the denominator to doubles separately and
 * divides, and `rational` may not be reduced, so two large factors can each
 * round and the quotient land one double away from the exact value.
 */
export function exactDoubleValue(num: NumericValue): number | undefined {
  if (num.im !== 0) return undefined;
  const exact = num.asExact;
  if (!(exact instanceof ExactNumericValue)) return undefined;
  if (exact.radical !== 1) return undefined;
  const [n0, d0] = exact.rational;
  let n = typeof n0 === 'bigint' ? n0 : BigInt(n0);
  let d = typeof d0 === 'bigint' ? d0 : BigInt(d0);
  if (d === 0n) return undefined;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = bigintGcd(n < 0n ? -n : n, d);
  if (g > 1n) {
    n /= g;
    d /= g;
  }
  if (d === 1n) {
    // `Number(bigint)` is one correctly rounded conversion; the value is a
    // machine number when that conversion loses nothing.
    const x = Number(n);
    return Number.isFinite(x) && BigInt(x) === n ? x : undefined;
  }
  // A reduced denominator that is not a power of two has no finite binary
  // expansion.
  if ((d & (d - 1n)) !== 0n) return undefined;
  // The numerator is odd here, so it must fit the significand as it is.
  const numerator = Number(n);
  if (BigInt(numerator) !== n) return undefined;
  // Dividing by a power of two is exact unless the result underflows into
  // the subnormal range and loses bits; scaling back detects that. The
  // scale is applied in two steps because a power of two past `2^1023` is
  // not a finite double, although the quotient can be (`2^-1030` is a
  // subnormal a double holds exactly).
  const k = d.toString(2).length - 1;
  const high = Math.min(k, 1023);
  const low = k - high;
  const x = numerator / 2 ** high / 2 ** low;
  return x * 2 ** low * 2 ** high === numerator ? x : undefined;
}

function bigintGcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
