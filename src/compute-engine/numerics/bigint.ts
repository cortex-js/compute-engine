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
    return bigint(a.toString());
  }

  let s = a.toLowerCase();

  // BigInt constructor does not deal well with e.g. `1e30` or `1.2e5`
  const m = s.match(/([+-]?[0-9]*)(?:\.([0-9]+))?e([+-]?[0-9]+)$/);
  // If we have a match, we need to add zeros to the fractional part
  if (m) {
    // Group 1 is the integer part
    // Group 2 is the fractional part
    // Group 3 is the exponent
    const exp = parseInt(m[3]);
    const pad = exp - (m[2] ? m[2].length : 0);
    if (pad < 0) return null;
    // m[2] is the fractional part
    s = (m[1] ?? '') + (m[2] ?? '') + '0'.repeat(pad);
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
