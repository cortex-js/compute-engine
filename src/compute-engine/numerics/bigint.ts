import { Decimal } from 'decimal.js';

export function bigint(a: Decimal | number | bigint | string): bigint | null {
  if (typeof a === 'bigint') return a;

  if (typeof a === 'number') {
    if (!Number.isInteger(a)) return null;

    // The BigInt constructor does not deal well with large numbers in scientific notation
    // For example `BigInt(2.46e+100)` returns `24600000000000001673372590169075170759012447570827870602850579566471767405735327837277964400645373952n`
    if (a >= Number.MAX_SAFE_INTEGER && a <= Number.MAX_SAFE_INTEGER)
      return BigInt(a);
    // Convert to string and try again...
    return bigint(a.toString());
  }

  if (a instanceof Decimal) {
    if (!a.isInteger()) return null;
    // Use toFixed(0) to get the full integer representation without
    // scientific notation (which would have a decimal point like "3.14e+10")
    return BigInt(a.toFixed(0));
  }

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
    console.error(e.message);
    return null;
  }
}
