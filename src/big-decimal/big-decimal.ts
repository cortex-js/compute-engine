/**
 * BigDecimal: an arbitrary-precision decimal type.
 *
 * Value = significand * 10^exponent
 *
 * The representation is always normalized: trailing zeros in the significand
 * are stripped and the exponent adjusted accordingly.
 *
 * Special values:
 *  - NaN:       { significand: 0n, exponent: NaN }
 *  - +Infinity: { significand: 1n, exponent: Infinity }
 *  - -Infinity: { significand: -1n, exponent: Infinity }
 */
export class BigDecimal {
  readonly significand: bigint;
  readonly exponent: number;

  constructor(value: string | number | bigint | BigDecimal) {
    if (value instanceof BigDecimal) {
      this.significand = value.significand;
      this.exponent = value.exponent;
      return;
    }

    if (typeof value === 'bigint') {
      [this.significand, this.exponent] = normalize(value, 0);
      return;
    }

    if (typeof value === 'number') {
      [this.significand, this.exponent] = fromNumber(value);
      return;
    }

    // string
    [this.significand, this.exponent] = fromString(value);
  }

  // ---------- State checks ----------

  /** True when this value represents NaN. */
  isNaN(): boolean {
    return Number.isNaN(this.exponent);
  }

  /** True when significand is 0 and the value is not NaN. */
  isZero(): boolean {
    return this.significand === 0n && !this.isNaN();
  }

  /** True when the exponent is finite (not NaN, not +/-Infinity). */
  isFinite(): boolean {
    return Number.isFinite(this.exponent);
  }

  /** True when the value represents a mathematical integer (exponent >= 0) and is finite. */
  isInteger(): boolean {
    return this.isFinite() && this.exponent >= 0;
  }

  /** True when significand > 0 and the value is finite. */
  isPositive(): boolean {
    return this.isFinite() && this.significand > 0n;
  }

  /** True when significand < 0 and the value is finite. */
  isNegative(): boolean {
    return this.isFinite() && this.significand < 0n;
  }

  // ---------- Comparison methods ----------

  /**
   * Compare this value with another.
   * Returns -1 if this < other, 0 if equal, 1 if this > other.
   * NaN compared to anything returns 0 (but eq returns false for NaN).
   */
  cmp(other: BigDecimal): -1 | 0 | 1 {
    // NaN compared to anything → 0
    if (this.isNaN() || other.isNaN()) return 0;

    // Handle infinities
    const thisInf = !this.isFinite();
    const otherInf = !other.isFinite();

    if (thisInf || otherInf) {
      if (thisInf && otherInf) {
        // Both infinite: compare signs
        if (this.significand === other.significand) return 0;
        return this.significand > other.significand ? 1 : -1;
      }
      if (thisInf) return this.significand > 0n ? 1 : -1;
      // otherInf
      return other.significand > 0n ? -1 : 1;
    }

    // Handle zeros
    const thisZero = this.isZero();
    const otherZero = other.isZero();
    if (thisZero && otherZero) return 0;
    if (thisZero) return other.significand > 0n ? -1 : 1;
    if (otherZero) return this.significand > 0n ? 1 : -1;

    // Different signs: quick check
    if (this.significand > 0n && other.significand < 0n) return 1;
    if (this.significand < 0n && other.significand > 0n) return -1;

    // Same sign: align exponents and compare significands
    let aSig = this.significand;
    let bSig = other.significand;

    if (this.exponent < other.exponent) {
      // Scale other's significand up
      bSig = bSig * 10n ** BigInt(other.exponent - this.exponent);
    } else if (this.exponent > other.exponent) {
      // Scale this significand up
      aSig = aSig * 10n ** BigInt(this.exponent - other.exponent);
    }

    if (aSig < bSig) return -1;
    if (aSig > bSig) return 1;
    return 0;
  }

  /**
   * Returns true if this value equals other.
   * NaN === NaN → false (standard NaN semantics).
   */
  eq(other: BigDecimal | number): boolean {
    const o = other instanceof BigDecimal ? other : new BigDecimal(other);
    // NaN !== NaN
    if (this.isNaN() || o.isNaN()) return false;
    return this.cmp(o) === 0;
  }

  /** Returns true if this value is strictly less than other. */
  lt(other: BigDecimal | number): boolean {
    const o = other instanceof BigDecimal ? other : new BigDecimal(other);
    if (this.isNaN() || o.isNaN()) return false;
    return this.cmp(o) === -1;
  }

  /** Returns true if this value is less than or equal to other. */
  lte(other: BigDecimal | number): boolean {
    const o = other instanceof BigDecimal ? other : new BigDecimal(other);
    if (this.isNaN() || o.isNaN()) return false;
    const c = this.cmp(o);
    return c === -1 || c === 0;
  }

  /** Returns true if this value is strictly greater than other. */
  gt(other: BigDecimal | number): boolean {
    const o = other instanceof BigDecimal ? other : new BigDecimal(other);
    if (this.isNaN() || o.isNaN()) return false;
    return this.cmp(o) === 1;
  }

  /** Returns true if this value is greater than or equal to other. */
  gte(other: BigDecimal | number): boolean {
    const o = other instanceof BigDecimal ? other : new BigDecimal(other);
    if (this.isNaN() || o.isNaN()) return false;
    const c = this.cmp(o);
    return c === 1 || c === 0;
  }

  // ---------- Arithmetic methods ----------

  /**
   * Add this value to another. Exact — no precision loss.
   * Aligns exponents, adds significands.
   */
  add(other: BigDecimal): BigDecimal {
    // NaN propagation
    if (this.isNaN() || other.isNaN()) return new BigDecimal(NaN);

    // Infinity cases
    const thisInf = !this.isFinite();
    const otherInf = !other.isFinite();

    if (thisInf && otherInf) {
      // Inf + (-Inf) → NaN
      if (this.significand !== other.significand) return new BigDecimal(NaN);
      // Same sign infinity
      return new BigDecimal(this.significand > 0n ? Infinity : -Infinity);
    }
    if (thisInf) return new BigDecimal(this.significand > 0n ? Infinity : -Infinity);
    if (otherInf) return new BigDecimal(other.significand > 0n ? Infinity : -Infinity);

    // Align exponents: use the smaller exponent
    const minExp = Math.min(this.exponent, other.exponent);
    const aSig = this.significand * 10n ** BigInt(this.exponent - minExp);
    const bSig = other.significand * 10n ** BigInt(other.exponent - minExp);

    return fromRaw(aSig + bSig, minExp);
  }

  /**
   * Subtract other from this. Exact — no precision loss.
   */
  sub(other: BigDecimal): BigDecimal {
    return this.add(other.neg());
  }

  /**
   * Multiply this value by another. Exact — no precision loss.
   * Multiplies significands, adds exponents.
   */
  mul(other: BigDecimal): BigDecimal {
    // NaN propagation
    if (this.isNaN() || other.isNaN()) return new BigDecimal(NaN);

    // Infinity * 0 → NaN, 0 * Infinity → NaN
    const thisInf = !this.isFinite();
    const otherInf = !other.isFinite();

    if (thisInf || otherInf) {
      // Check for Infinity * 0 or 0 * Infinity
      if (thisInf && other.isZero()) return new BigDecimal(NaN);
      if (otherInf && this.isZero()) return new BigDecimal(NaN);

      // Infinity * Infinity or Infinity * finite (non-zero)
      const signA = this.significand > 0n ? 1n : -1n;
      const signB = other.significand > 0n ? 1n : -1n;
      return new BigDecimal(signA * signB > 0n ? Infinity : -Infinity);
    }

    return fromRaw(this.significand * other.significand, this.exponent + other.exponent);
  }

  /**
   * Negate this value. Zero.neg() → Zero.
   */
  neg(): BigDecimal {
    if (this.isNaN()) return new BigDecimal(NaN);
    if (!this.isFinite())
      return new BigDecimal(this.significand > 0n ? -Infinity : Infinity);
    if (this.isZero()) return new BigDecimal(0);
    return fromRaw(-this.significand, this.exponent);
  }

  /**
   * Absolute value. If already non-negative, returns this.
   */
  abs(): BigDecimal {
    if (this.isNaN()) return new BigDecimal(NaN);
    if (!this.isFinite()) return new BigDecimal(Infinity);
    if (this.significand >= 0n) return this;
    return fromRaw(-this.significand, this.exponent);
  }

  // ---------- Conversion methods ----------

  /** Convert to a JavaScript number. May lose precision for large values. */
  toNumber(): number {
    if (this.isNaN()) return NaN;
    if (!this.isFinite())
      return this.significand > 0n ? Infinity : -Infinity;
    if (this.isZero()) return 0;

    // For exponent === 0, just convert significand directly
    if (this.exponent === 0) return Number(this.significand);

    // Use Number() on the significand and multiply by 10**exponent.
    // This handles the full range including subnormals and overflow to Infinity.
    return Number(this.significand) * 10 ** this.exponent;
  }

  /**
   * Reconstruct a decimal string from significand and exponent.
   *
   * For normal-range exponents, produces a clean decimal string.
   * For very large (> 20) or very small (< -6) adjusted exponents,
   * uses scientific notation like `'1.5e+25'`.
   */
  toString(): string {
    if (this.isNaN()) return 'NaN';
    if (!this.isFinite())
      return this.significand > 0n ? 'Infinity' : '-Infinity';
    if (this.isZero()) return '0';

    const negative = this.significand < 0n;
    const absStr = (negative ? -this.significand : this.significand).toString();
    const numDigits = absStr.length;

    // adjustedExp: exponent of the leading digit in scientific notation
    // value = 0.absStr * 10^(numDigits + exponent)
    // leading digit position: numDigits + exponent - 1
    const adjustedExp = numDigits + this.exponent - 1;
    const sign = negative ? '-' : '';

    // Use scientific notation for very large or very small adjusted exponents
    if (adjustedExp > 20 || adjustedExp < -6) {
      // Scientific notation: d.ddd...e+/-N
      const sciStr =
        numDigits === 1
          ? absStr
          : absStr[0] + '.' + absStr.slice(1);
      const expSign = adjustedExp >= 0 ? '+' : '';
      return `${sign}${sciStr}e${expSign}${adjustedExp}`;
    }

    // Plain decimal string
    if (this.exponent >= 0) {
      // Integer: significand followed by exponent zeros
      return sign + absStr + '0'.repeat(this.exponent);
    }

    // exponent < 0: we need to place a decimal point
    const decimalDigits = -this.exponent; // number of digits after the point

    if (decimalDigits < numDigits) {
      // Decimal point falls within the digit string
      const intPart = absStr.slice(0, numDigits - decimalDigits);
      const fracPart = absStr.slice(numDigits - decimalDigits);
      return `${sign}${intPart}.${fracPart}`;
    }

    // decimalDigits >= numDigits: need leading zeros after "0."
    const leadingZeros = decimalDigits - numDigits;
    return `${sign}0.${'0'.repeat(leadingZeros)}${absStr}`;
  }

  /**
   * Format with a fixed number of decimal places.
   *
   * Rounds to the specified number of digits after the decimal point
   * using round-half-to-even (banker's rounding) for the tie-breaking case.
   * If `digits` is undefined, behaves like toFixed(0).
   */
  toFixed(digits?: number): string {
    const d = digits ?? 0;
    if (this.isNaN()) return 'NaN';
    if (!this.isFinite())
      return this.significand > 0n ? 'Infinity' : '-Infinity';

    const negative = this.significand < 0n;
    const absSig = negative ? -this.significand : this.significand;

    // We need to round so that there are exactly `d` fractional digits.
    // The value is absSig * 10^exponent.
    // We want: roundedInt = round(absSig * 10^(exponent + d))
    // Then the result is roundedInt with `d` decimal places.

    const shift = this.exponent + d;
    let rounded: bigint;
    if (shift >= 0) {
      // No rounding needed — we have enough (or more than enough) precision
      rounded = absSig * 10n ** BigInt(shift);
    } else {
      // Need to divide (and potentially round)
      const divisor = 10n ** BigInt(-shift);
      const quotient = absSig / divisor;
      const remainder = absSig % divisor;

      // Round half-to-even
      const half = divisor / 2n;
      if (remainder > half) {
        rounded = quotient + 1n;
      } else if (remainder < half) {
        rounded = quotient;
      } else {
        // Exact half: round to even
        if (divisor % 2n !== 0n) {
          // Odd divisor: remainder can't exactly equal half, but handle defensively
          rounded = quotient;
        } else if (quotient % 2n === 0n) {
          rounded = quotient;
        } else {
          rounded = quotient + 1n;
        }
      }
    }

    const sign = negative && rounded !== 0n ? '-' : '';
    const roundedStr = rounded.toString();

    if (d === 0) {
      return `${sign}${roundedStr}`;
    }

    // Insert decimal point: roundedStr should have `d` fractional digits
    if (roundedStr.length <= d) {
      // Need leading zeros in fractional part
      const padded = roundedStr.padStart(d, '0');
      return `${sign}0.${padded}`;
    }

    const intPart = roundedStr.slice(0, roundedStr.length - d);
    const fracPart = roundedStr.slice(roundedStr.length - d);
    return `${sign}${intPart}.${fracPart}`;
  }

  /**
   * Truncate fractional part and return a bigint.
   * Throws if the value is NaN or Infinity.
   */
  toBigInt(): bigint {
    if (this.isNaN()) throw new RangeError('Cannot convert NaN to BigInt');
    if (!this.isFinite())
      throw new RangeError('Cannot convert Infinity to BigInt');

    if (this.exponent >= 0) {
      // Integer or scaled integer
      return this.significand * 10n ** BigInt(this.exponent);
    }

    // exponent < 0: truncate fractional digits
    const divisor = 10n ** BigInt(-this.exponent);
    // BigInt division truncates toward zero (which is what we want)
    return this.significand / divisor;
  }
}

// ================================================================
// Internal helpers
// ================================================================

/**
 * Create a BigDecimal directly from significand + exponent, normalizing.
 * Avoids the constructor's string/number parsing overhead.
 */
function fromRaw(sig: bigint, exp: number): BigDecimal {
  const [normSig, normExp] = normalize(sig, exp);
  // Use Object.create to avoid re-parsing; set readonly fields directly
  const bd = Object.create(BigDecimal.prototype) as BigDecimal;
  (bd as { significand: bigint }).significand = normSig;
  (bd as { exponent: number }).exponent = normExp;
  return bd;
}

/**
 * Strip trailing zeros from the significand and adjust the exponent.
 * Zero always normalizes to { 0n, 0 }.
 */
function normalize(sig: bigint, exp: number): [bigint, number] {
  if (sig === 0n) return [0n, 0];

  while (sig % 10n === 0n) {
    sig /= 10n;
    exp += 1;
  }
  return [sig, exp];
}

/**
 * Construct (significand, exponent) from a JavaScript number.
 * Handles NaN, +/-Infinity, integers, and floats.
 */
function fromNumber(value: number): [bigint, number] {
  if (Number.isNaN(value)) return [0n, NaN];
  if (value === Infinity) return [1n, Infinity];
  if (value === -Infinity) return [-1n, Infinity];

  // Integer fast-path (avoids toString round-trip for safe integers)
  if (Number.isInteger(value)) return normalize(BigInt(value), 0);

  // General case: use the string representation produced by the engine.
  // This avoids hand-rolling binary-to-decimal conversion and gives us
  // exactly the digits that `Number.prototype.toString()` guarantees.
  return fromString(value.toString());
}

/**
 * Parse a decimal string into (significand, exponent).
 *
 * Accepted formats:
 *   "123", "-42", "0"                    — integers
 *   "123.456", "-0.001", ".5"            — decimal point
 *   "1.5e10", "1.5E-3", "-2.5e+4"       — scientific notation
 *   "00123.4500"                         — leading/trailing zeros
 */
function fromString(s: string): [bigint, number] {
  s = s.trim();
  if (s === '' || s === 'NaN') return [0n, NaN];
  if (s === 'Infinity' || s === '+Infinity') return [1n, Infinity];
  if (s === '-Infinity') return [-1n, Infinity];

  // Split off scientific-notation exponent if present
  let mantissa: string;
  let explicitExp = 0;

  const eIdx = s.search(/[eE]/);
  if (eIdx !== -1) {
    mantissa = s.slice(0, eIdx);
    explicitExp = Number(s.slice(eIdx + 1));
    if (!Number.isFinite(explicitExp)) return [0n, NaN]; // malformed exponent
  } else {
    mantissa = s;
  }

  // Determine sign
  let negative = false;
  if (mantissa.startsWith('-')) {
    negative = true;
    mantissa = mantissa.slice(1);
  } else if (mantissa.startsWith('+')) {
    mantissa = mantissa.slice(1);
  }

  // Split at decimal point
  const dotIdx = mantissa.indexOf('.');
  let intPart: string;
  let fracPart: string;

  if (dotIdx === -1) {
    intPart = mantissa;
    fracPart = '';
  } else {
    intPart = mantissa.slice(0, dotIdx);
    fracPart = mantissa.slice(dotIdx + 1);
  }

  // Remove leading zeros from intPart (but keep at least one digit)
  intPart = intPart.replace(/^0+/, '') || '0';

  // Combine into a single digit string (no decimal point)
  const digits = intPart + fracPart;

  if (digits.length === 0 || !/^\d+$/.test(digits)) return [0n, NaN];

  let sig = BigInt(digits);
  if (negative) sig = -sig;

  // The implicit exponent from the fractional digits
  const implicitExp = -fracPart.length;

  return normalize(sig, implicitExp + explicitExp);
}
