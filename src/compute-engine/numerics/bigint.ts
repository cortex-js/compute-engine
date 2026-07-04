import { BigDecimal } from '../../big-decimal';

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
