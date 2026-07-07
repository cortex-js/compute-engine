import type { BigDecimal } from '../../big-decimal';
import type { DisplayDigits } from '../types-kernel-serialization';

/**
 * Round a value to `n` significant figures, returning a value of the same kind
 * (used by the number-display `{ significant: n }` control).
 *
 * Truncation only — no trailing-zero padding. For machine numbers, the value
 * is round-tripped through `parseFloat(x.toPrecision(n))` so that the caller
 * can serialize it through the normal string path; this avoids the exponential
 * notation that `Number.prototype.toPrecision` injects for large/small
 * magnitudes (e.g. `(1500).toPrecision(2)` → `"1.5e+3"` would otherwise leak
 * into fixed-notation output).
 */
export function roundToSignificant(value: number, n: number): number;
export function roundToSignificant(value: BigDecimal, n: number): BigDecimal;
export function roundToSignificant(
  value: number | BigDecimal,
  n: number
): number | BigDecimal;
export function roundToSignificant(
  value: number | BigDecimal,
  n: number
): number | BigDecimal {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    return parseFloat(value.toPrecision(n));
  }
  return value.toPrecision(n);
}

/**
 * Round a value to `k` digits after the decimal point (`toFixed` semantics),
 * returning the fixed-point string (used by the number-display
 * `{ fractional: k }` control). May include trailing zeros (e.g. `2` → `2.00`).
 */
export function roundToDecimalPlace(
  value: number | BigDecimal,
  k: number
): string {
  return value.toFixed(k);
}

/**
 * Error-aware display rounding for a Measurement `value ± error`, honoring the
 * `digits` serialization control ({@link DisplayDigits}). Returns the two
 * formatted decimal strings.
 *
 * - `'auto'` (the default): round the error to **2** significant figures, then
 *   round the nominal to the error's least-significant displayed decimal place
 *   (value and uncertainty share a decimal place, per physics convention).
 * - `{ significant: n }`: round the error to `n` significant figures, nominal
 *   to that error's least-significant displayed place. (`'auto'` is `n = 2`.)
 * - `{ fractional: k }`: round **both** the nominal and the error to `k`
 *   decimal places (`toFixed(k)`).
 * - `'max'`: no rounding — nominal and error at full precision.
 *
 * Trailing zeros produced by the shared-place alignment are significant and
 * kept (e.g. `5.10`, `8.00`).
 *
 * Only ever called with `error > 0` (a zero error canonicalizes the Measurement
 * back to the bare value, so `Measurement(v, e)` always has `e > 0`).
 *
 * Examples (`'auto'`): `(8, 0.2236)` → `{ value: '8.00', error: '0.22' }`;
 * `(1234.5, 12)` → `{ value: '1235', error: '12' }`. `{ significant: 1 }`:
 * `(5.134, 0.021)` → `{ value: '5.13', error: '0.02' }`.
 */
export function roundMeasurementForDisplay(
  value: number,
  error: number,
  digits: DisplayDigits = 'auto'
): { value: string; error: string } {
  // No rounding.
  if (digits === 'max') return { value: String(value), error: String(error) };

  // Fixed number of decimal places for both nominal and error.
  if (typeof digits === 'object' && 'fractional' in digits) {
    const k = digits.fractional;
    return {
      value: roundToDecimalPlace(value, k),
      error: roundToDecimalPlace(error, k),
    };
  }

  // `'auto'` (2 significant figures) or `{ significant: n }`.
  const n =
    digits === 'auto' ? 2 : (digits as { significant: number }).significant;
  // Round the error to `n` significant figures.
  const er = roundToSignificant(error, n);
  // Decimal exponent of the rounded error's *leading* significant digit. Read
  // it from the exponential form to avoid log10 rounding artifacts at powers of
  // ten (e.g. `Math.log10(0.1)` is not exactly −1).
  const exp = parseInt(er.toExponential().split('e')[1], 10);
  // Least-significant displayed decimal place of the `n`-significant-figure
  // error: `p = n - 1 - floor(log10(er))`. Both the nominal and the error are
  // rounded to this shared place so they carry the same precision.
  const p = n - 1 - exp;
  if (p > 0) {
    return {
      value: roundToDecimalPlace(value, p),
      error: roundToDecimalPlace(er, p),
    };
  }
  // p <= 0: the error's last significant digit is at the 10^(-p) place (units,
  // tens, …); round both to that place rather than using `toFixed` with a
  // negative argument.
  const place = Math.pow(10, -p);
  return {
    value: String(Math.round(value / place) * place),
    error: String(Math.round(er / place) * place),
  };
}

function fromRoman(roman: string): [result: number, rest: string] {
  if (roman === 'N') return [0, ''];

  const romanMap: Record<string, number | undefined> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };

  let total = 0;
  let prevValue = 0;

  roman = roman.toUpperCase();

  for (let i = roman.length - 1; i >= 0; i--) {
    const currentValue = romanMap[roman[i]];
    if (currentValue === undefined) return [total, roman.slice(i)];

    if (currentValue < prevValue) total -= currentValue;
    else total += currentValue;

    prevValue = currentValue;
  }

  return [total, ''];
}

export function fromDigits(
  s: string,
  baseInput?: string | number
): [result: number, rest: string] {
  s = s.trim();
  if (s.length === 0) return [NaN, ''];
  if (s.startsWith('+')) return fromDigits(s.slice(1), baseInput);
  if (s.startsWith('-')) {
    const [v, r] = fromDigits(s.slice(1), baseInput);
    return [-v, r];
  }
  let base = 10;
  if (typeof baseInput === 'string') baseInput = baseInput.toLowerCase();
  if (s.startsWith('0x')) {
    base = 16;
    s = s.slice(2);
  } else if (s.startsWith('0b')) {
    base = 2;
    s = s.slice(2);
  } else if (baseInput === 'roman') {
    return fromRoman(s);
  } else if (baseInput === 'base64' || baseInput === 'base-64') {
    try {
      return [parseInt(btoa(s)), ''];
    } catch {
      return [NaN, ''];
    }
  } else if (typeof baseInput === 'number') {
    base = baseInput;
  } else if (typeof baseInput === 'string') {
    base = parseInt(baseInput);
  }

  let value = 0;
  for (let i = 0; i < s.length; i++) {
    const k = {
      ' ': -1,
      '\u00a0': -1, // NBS
      '\u2000': -1, // EN QUAD
      '\u2001': -1, // EM QUAD
      '\u2002': -1, // EN SPACE
      '\u2003': -1, // EM SPACE
      '\u2004': -1, // THREE-PER-EM SPACE
      '\u2005': -1, // FOUR-PER-EM SPACE
      '\u2006': -1, // SIX-PER-EM SPACE
      '\u2007': -1, // FIGURE SPACE
      '\u2008': -1, // PUNCTUATION SPACE
      '\u2009': -1, // THIN SPACE
      '\u200a': -1, // HAIR SPACE
      '\u200b': -1, // ZWS
      '\u202f': -1, // NARROW NBS
      '\u205f': -1, // MEDIUM MATHEMATICAL SPACE
      '_': -1,
      ',': -1,
      '0': 0,
      '1': 1,
      '2': 2,
      '3': 3,
      '4': 4,
      '5': 5,
      '6': 6,
      '7': 7,
      '8': 8,
      '9': 9,
      'a': 10,
      'b': 11,
      'c': 12,
      'd': 13,
      'e': 14,
      'f': 15,
      'g': 16,
      'h': 17,
      'i': 18,
      'j': 19,
      'k': 20,
      'l': 21,
      'm': 22,
      'n': 23,
      'o': 24,
      'p': 25,
      'q': 26,
      'r': 27,
      's': 28,
      't': 29,
      'u': 30,
      'v': 31,
      'w': 32,
      'x': 33,
      'y': 34,
      'z': 35,
    }[s[i]];
    if (k !== -1) {
      if (k === undefined) return [value, s.substring(i)];
      if (k >= base) return [value, s.substring(i)];
      value = value * base + k;
    }
  }

  return [value, ''];
}

export function numberToString(
  num: number | bigint,
  fractionalDigits?: number | string
): string {
  if (typeof fractionalDigits === 'number' && typeof num === 'number')
    return num.toFixed(fractionalDigits);

  // Use scientific notation if the exponent is too large or too small
  // Convert the number to a string
  const numStr = num.toString();

  // Check if the number is in scientific notation
  if (
    typeof num === 'number' &&
    Number.isInteger(num) &&
    numStr.includes('e')
  ) {
    // Convert the number to a fixed notation string with no decimal places
    // (note that Number.toFixed() will use scientific notations for large numbers)
    const fixedStr = BigInt(num).toString();

    // Check the number of trailing zeros
    const trailingZeros = fixedStr.match(/0+$/);
    const trailingZerosCount = trailingZeros ? trailingZeros[0].length : 0;

    // If there are 5 or fewer trailing zeros, return the fixed notation string
    if (trailingZerosCount <= 5) return fixedStr;
  } else if (typeof num === 'bigint') {
    const trailingZeros = numStr.match(/0+$/);
    const trailingZerosCount = trailingZeros ? trailingZeros[0].length : 0;
    // Add an 'e' exponent
    if (trailingZerosCount > 5)
      return `${numStr.slice(0, -trailingZerosCount)}e+${trailingZerosCount}`;
  }

  // If the number is not in scientific notation or doesn't meet the criteria, return the original string
  return numStr;
}
