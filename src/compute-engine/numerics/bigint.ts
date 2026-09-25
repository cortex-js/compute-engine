import { BigDecimal } from '../../big-decimal/index.js';

export function bigint(
  a: BigDecimal | number | bigint | string
): bigint | null {
  if (typeof a === 'bigint') return a;

  if (typeof a === 'number') {
    if (!Number.isInteger(a)) return null;
    // `BigInt(a)` is exact for any integer-valued double, including those
    // beyond MAX_SAFE_INTEGER (it returns the exact integer the double stores).
    // The previous guard `a >= MAX && a <= MAX` was only true at exactly MAX,
    // so every other integer fell through to `bigint(a.toString())` — which
    // fails for large values, since `(2.46e100).toString()` is `"2.46e+100"`
    // (a decimal mantissa the string parser rejects) → `null`.
    return BigInt(a);
  }

  // Recognize a BigDecimal — including one constructed in a *different* bundle,
  // whose class object differs from ours so `instanceof` returns false. The
  // opt-in `integration-rules` plugin re-bundles `big-decimal`, so a BigDecimal
  // carried by a host-engine expression is a genuine BigDecimal that would fail
  // the `instanceof` check and then crash on `.toLowerCase` below. Duck-type it.
  if (
    a instanceof BigDecimal ||
    (typeof a === 'object' &&
      a !== null &&
      typeof (a as any).isInteger === 'function' &&
      typeof (a as any).toFixed === 'function')
  ) {
    const bd = a as BigDecimal;
    if (!bd.isInteger()) return null;
    // Use toFixed(0) to get the full integer representation without
    // scientific notation (which would have a decimal point like "3.14e+10")
    return BigInt(bd.toFixed(0));
  }

  // Anything that is not a string here (e.g. a foreign object we don't
  // recognize) has no exact-integer reading — don't crash on `.toLowerCase`.
  if (typeof a !== 'string') return null;

  let s = a.toLowerCase();

  // BigInt constructor does not deal well with e.g. `1e30`
  // Only convert to bigint if there's NO decimal point - a decimal point
  // indicates an approximate value, not an exact integer
  const m = s.match(/^([+-]?[0-9]+)e([+-]?[0-9]+)$/);
  if (m) {
    // Group 1 is the integer part (no decimal point)
    // Group 2 is the exponent
    const exp = parseInt(m[2]);
    if (exp < 0) return null;
    // Materializing the integer appends `exp` zero digits. Guard against
    // exponents so large the digit string cannot be allocated (`'0'.repeat`
    // throws `RangeError: Invalid string length`). A 1M-digit integer still
    // works today and stays supported; anything larger has no exact reading
    // here, so bail like the `exp < 0` case (the caller falls back to a float).
    if (exp > 1_000_000) return null;
    s = m[1] + '0'.repeat(exp);
  }

  // Do we have a decimal point?
  const i = s.indexOf('.');
  if (i >= 0) return null;

  // Does this look like a number?
  if (!/^[+-]?[0-9]+$/.test(s)) return null;

  try {
    return BigInt(s);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** The number of bits of a non-negative bigint (0 for 0). */
function bitLength(v: bigint): number {
  return v === 0n ? 0 : v.toString(2).length;
}

/**
 * Exact integer n-th root of a non-negative bigint: the integer `r` with
 * `r^n = v`, or `null` when `v` is not a perfect n-th power.
 *
 * The computation is all-integer (Newton's method on the floor of the
 * root, seeded above the root from the bit length), so a radicand of any
 * size is decided exactly: `10^60` has the cube root `10^20`, while
 * `10^60 + 1` has none.
 */
export function bigintNthRoot(v: bigint, n: number): bigint | null {
  if (!Number.isInteger(n) || n < 1 || v < 0n) return null;
  if (n === 1 || v < 2n) return v;
  const bits = bitLength(v);
  // A perfect n-th power with a base ≥ 2 has at least n bits.
  if (n >= bits) return null;
  const bn = BigInt(n);
  const bn1 = bn - 1n;
  // 2^ceil(bits/n) is strictly greater than the root, so the Newton
  // iteration below decreases monotonically toward the floor of the root.
  let x = 1n << BigInt(Math.ceil(bits / n));
  for (;;) {
    const y = (bn1 * x + v / x ** bn1) / bn;
    if (y >= x) break;
    x = y;
  }
  return x ** bn === v ? x : null;
}

/**
 * Write the integer `v > 1` as `base^exponent` with the largest possible
 * `exponent ≥ 2`, or return `undefined` when `v` is not a perfect power.
 *
 * The largest exponent is the product of the prime exponents that can be
 * extracted in turn: `v` is a perfect k-th power exactly when it is a
 * perfect p-th power for every prime power p dividing k. Each prime `p`
 * is tried only while `p` is below the bit length of the remaining base.
 *
 * A radicand longer than `maxBits` bits is not decomposed (returns
 * `undefined`). The search computes one integer root per prime below the
 * bit length, so its cost grows faster than the square of the bit length:
 * about 30 ms at 4096 bits, but more than a minute at 63,000 bits.
 */
export function bigintMaximalPerfectPower(
  v: bigint,
  maxBits = 4096
): { base: bigint; exponent: number } | undefined {
  if (v <= 1n) return undefined;
  if (bitLength(v) > maxBits) return undefined;
  let base = v;
  let exponent = 1;
  for (let p = 2; p < bitLength(base); p++) {
    if (!isSmallPrime(p)) continue;
    for (;;) {
      const r = bigintNthRoot(base, p);
      if (r === null) break;
      base = r;
      exponent *= p;
    }
  }
  return exponent > 1 ? { base, exponent } : undefined;
}

function isSmallPrime(p: number): boolean {
  if (p < 2) return false;
  for (let d = 2; d * d <= p; d++) if (p % d === 0) return false;
  return true;
}
