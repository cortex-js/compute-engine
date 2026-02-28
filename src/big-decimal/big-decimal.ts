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

import { bigintDigits, pow10, PI_DIGITS } from './utils';

export { PI_DIGITS };

// NaN typed as a cmp result. NaN fails all === checks, so callers that do
// cmp(x) === 0, === -1, === 1 naturally get false without special handling.
const NAN_CMP = NaN as unknown as -1 | 0 | 1;

export class BigDecimal {
  /** Working precision (significant digits) for inexact operations like division. */
  static precision: number = 50;

  // ---------- Static constants ----------

  static readonly ZERO: BigDecimal = Object.freeze(
    Object.assign(Object.create(BigDecimal.prototype), {
      significand: 0n,
      exponent: 0,
    })
  );
  static readonly ONE: BigDecimal = Object.freeze(
    Object.assign(Object.create(BigDecimal.prototype), {
      significand: 1n,
      exponent: 0,
    })
  );
  static readonly TWO: BigDecimal = Object.freeze(
    Object.assign(Object.create(BigDecimal.prototype), {
      significand: 2n,
      exponent: 0,
    })
  );
  static readonly NEGATIVE_ONE: BigDecimal = Object.freeze(
    Object.assign(Object.create(BigDecimal.prototype), {
      significand: -1n,
      exponent: 0,
    })
  );
  static readonly HALF: BigDecimal = Object.freeze(
    Object.assign(Object.create(BigDecimal.prototype), {
      significand: 5n,
      exponent: -1,
    })
  );
  static readonly NAN: BigDecimal = Object.freeze(
    Object.assign(Object.create(BigDecimal.prototype), {
      significand: 0n,
      exponent: NaN,
    })
  );
  static readonly POSITIVE_INFINITY: BigDecimal = Object.freeze(
    Object.assign(Object.create(BigDecimal.prototype), {
      significand: 1n,
      exponent: Infinity,
    })
  );
  static readonly NEGATIVE_INFINITY: BigDecimal = Object.freeze(
    Object.assign(Object.create(BigDecimal.prototype), {
      significand: -1n,
      exponent: Infinity,
    })
  );

  /** Full-precision PI (1100+ digits) */
  private static _piFullPrecision: BigDecimal | null = null;
  /** PI rounded to working precision */
  private static _piCache: BigDecimal | null = null;
  private static _piCachePrecision: number = 0;

  /** PI to current working precision. */
  static get PI(): BigDecimal {
    if (BigDecimal._piFullPrecision === null) {
      BigDecimal._piFullPrecision = new BigDecimal(
        PI_DIGITS[0] + '.' + PI_DIGITS.slice(1)
      );
    }
    // Return PI with guard digits for intermediate computation accuracy
    const prec = BigDecimal.precision;
    if (BigDecimal._piCache === null || BigDecimal._piCachePrecision !== prec) {
      BigDecimal._piCache = BigDecimal._piFullPrecision.toPrecision(prec + 4);
      BigDecimal._piCachePrecision = prec;
    }
    return BigDecimal._piCache;
  }

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
    // Normalized zero is always {0n, 0}. NaN has sig=0n but exp=NaN,
    // so checking exp===0 excludes NaN without a separate isNaN() call.
    return this.exponent === 0 && this.significand === 0n;
  }

  /** True when the exponent is finite (not NaN, not +/-Infinity). */
  isFinite(): boolean {
    return Number.isFinite(this.exponent);
  }

  /** True when the value represents a mathematical integer (exponent >= 0) and is finite. */
  isInteger(): boolean {
    return this.isFinite() && this.exponent >= 0;
  }

  /** True when significand > 0 (including positive infinity). */
  isPositive(): boolean {
    return this.significand > 0n;
  }

  /** True when significand < 0 (including negative infinity). */
  isNegative(): boolean {
    return this.significand < 0n;
  }

  // ---------- Comparison methods ----------

  /**
   * Compare this value with another.
   * Returns -1 if this < other, 0 if equal, 1 if this > other, NaN if either is NaN.
   */
  cmp(other: BigDecimal | number): -1 | 0 | 1 {
    if (typeof other === 'number') {
      if (Number.isNaN(other)) return NAN_CMP;
      const thisExp = this.exponent;
      if (Number.isNaN(thisExp)) return NAN_CMP;
      if (other === 0) {
        if (this.significand === 0n) return 0;
        return this.significand > 0n ? 1 : -1;
      }
      if (!Number.isFinite(thisExp)) {
        if (other === Infinity) return this.significand > 0n ? 0 : -1;
        if (other === -Infinity) return this.significand < 0n ? 0 : 1;
        return this.significand > 0n ? 1 : -1;
      }
      if (this.significand === 0n) return other > 0 ? -1 : 1;
      // Fast-path: other is ±Infinity, this is finite and non-zero
      if (other === Infinity) return -1;
      if (other === -Infinity) return 1;
      // Different signs
      if (this.significand > 0n !== other > 0)
        return this.significand > 0n ? 1 : -1;
      // Small safe integer with non-negative exponent: compare directly
      if (Number.isInteger(other) && thisExp >= 0 && thisExp <= 15) {
        const thisVal = this.significand * pow10(thisExp);
        const otherVal = BigInt(other);
        if (thisVal < otherVal) return -1;
        if (thisVal > otherVal) return 1;
        return 0;
      }
      other = new BigDecimal(other);
    }

    // Fast path: both finite, non-NaN, non-zero (the overwhelmingly common case)
    const thisExp = this.exponent;
    const otherExp = other.exponent;
    const thisSig = this.significand;
    const otherSig = other.significand;

    // NaN check — exponent is NaN only for NaN values
    if (thisExp !== thisExp || otherExp !== otherExp) return NAN_CMP;

    // Finite check (handles both Infinity and NaN exponents)
    if (!Number.isFinite(thisExp) || !Number.isFinite(otherExp)) {
      if (!Number.isFinite(thisExp) && !Number.isFinite(otherExp)) {
        if (thisSig === otherSig) return 0;
        return thisSig > otherSig ? 1 : -1;
      }
      if (!Number.isFinite(thisExp)) return thisSig > 0n ? 1 : -1;
      return otherSig > 0n ? -1 : 1;
    }

    // Zero checks
    if (thisSig === 0n) {
      if (otherSig === 0n) return 0;
      return otherSig > 0n ? -1 : 1;
    }
    if (otherSig === 0n) return thisSig > 0n ? 1 : -1;

    // Different signs
    if (thisSig > 0n && otherSig < 0n) return 1;
    if (thisSig < 0n && otherSig > 0n) return -1;

    // Same exponent: direct significand comparison (avoids bigintDigits)
    if (thisExp === otherExp) {
      if (thisSig < otherSig) return -1;
      if (thisSig > otherSig) return 1;
      return 0;
    }

    // Same sign, different exponent: compare by order of magnitude
    const thisDigits = bigintDigits(thisSig);
    const otherDigits = bigintDigits(otherSig);

    const thisMag = thisDigits + thisExp;
    const otherMag = otherDigits + otherExp;

    if (thisMag !== otherMag) {
      const sign = thisSig > 0n ? 1 : -1;
      return (thisMag > otherMag ? sign : -sign) as -1 | 0 | 1;
    }

    // Same order of magnitude: align exponents and compare significands
    let aSig = thisSig;
    let bSig = otherSig;
    const diff = Math.abs(thisExp - otherExp);

    if (diff > 1000) {
      const aDigits = thisDigits; // already computed above
      const bDigits = otherDigits;
      const target = Math.max(aDigits, bDigits) + 1;
      if (aDigits < target) aSig = aSig * pow10(target - aDigits);
      if (bDigits < target) bSig = bSig * pow10(target - bDigits);
    } else if (thisExp < otherExp) {
      bSig = bSig * pow10(diff);
    } else {
      aSig = aSig * pow10(diff);
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
    if (typeof other === 'number') {
      // The 0/1/-1 fast paths use exponent===0 which excludes NaN (exp=NaN).
      if (other === 0) return this.significand === 0n && this.exponent === 0;
      if (other === 1) return this.significand === 1n && this.exponent === 0;
      if (other === -1) return this.significand === -1n && this.exponent === 0;
      // Integer fast path: compare directly when possible
      if (
        Number.isInteger(other) &&
        Number.isFinite(this.exponent) &&
        this.exponent >= 0 &&
        this.exponent <= 15
      ) {
        return this.significand * pow10(this.exponent) === BigInt(other);
      }
      // cmp returns NaN for NaN inputs, so NaN === 0 → false (correct)
      return this.cmp(other) === 0;
    }
    // Both normalized → equal values have identical (significand, exponent)
    // NaN: exponent is NaN, and NaN !== NaN, so the === check returns false
    return (
      this.significand === other.significand && this.exponent === other.exponent
    );
  }

  /** Returns true if this value is strictly less than other. */
  lt(other: BigDecimal | number): boolean {
    return this.cmp(other) === -1;
  }

  /** Returns true if this value is less than or equal to other. */
  lte(other: BigDecimal | number): boolean {
    // cmp returns NaN for NaN inputs; NaN !== -1 and NaN !== 0, so result is false
    const c = this.cmp(other);
    return c === -1 || c === 0;
  }

  /** Returns true if this value is strictly greater than other. */
  gt(other: BigDecimal | number): boolean {
    return this.cmp(other) === 1;
  }

  /** Returns true if this value is greater than or equal to other. */
  gte(other: BigDecimal | number): boolean {
    // cmp returns NaN for NaN inputs; NaN !== 1 and NaN !== 0, so result is false
    const c = this.cmp(other);
    return c === 1 || c === 0;
  }

  // ---------- Arithmetic methods ----------

  /**
   * Add this value to another.
   * Aligns exponents, adds significands. The result is exact.
   */
  add(other: BigDecimal | number): BigDecimal {
    if (typeof other === 'number') other = new BigDecimal(other);

    const thisExp = this.exponent;
    const otherExp = other.exponent;

    // NaN/Infinity: exponents are NaN or ±Infinity; finite exponents go to fast path
    if (Number.isFinite(thisExp) && Number.isFinite(otherExp)) {
      if (thisExp === otherExp)
        return fromRaw(this.significand + other.significand, thisExp);

      const diff = thisExp - otherExp;
      if (diff > 0)
        return fromRaw(
          this.significand * pow10(diff) + other.significand,
          otherExp
        );
      return fromRaw(
        this.significand + other.significand * pow10(-diff),
        thisExp
      );
    }

    // Slow path: handle NaN, Infinity
    if (thisExp !== thisExp || otherExp !== otherExp) return BigDecimal.NAN;

    const thisInf = !Number.isFinite(thisExp);
    const otherInf = !Number.isFinite(otherExp);
    if (thisInf && otherInf) {
      if (this.significand !== other.significand) return BigDecimal.NAN;
      return this.significand > 0n
        ? BigDecimal.POSITIVE_INFINITY
        : BigDecimal.NEGATIVE_INFINITY;
    }
    if (thisInf)
      return this.significand > 0n
        ? BigDecimal.POSITIVE_INFINITY
        : BigDecimal.NEGATIVE_INFINITY;
    return other.significand > 0n
      ? BigDecimal.POSITIVE_INFINITY
      : BigDecimal.NEGATIVE_INFINITY;
  }

  /**
   * Subtract other from this.
   * Aligns exponents, subtracts significands. The result is exact.
   */
  sub(other: BigDecimal | number): BigDecimal {
    if (typeof other === 'number') other = new BigDecimal(other);

    const thisExp = this.exponent;
    const otherExp = other.exponent;

    if (Number.isFinite(thisExp) && Number.isFinite(otherExp)) {
      if (thisExp === otherExp)
        return fromRaw(this.significand - other.significand, thisExp);

      const diff = thisExp - otherExp;
      if (diff > 0)
        return fromRaw(
          this.significand * pow10(diff) - other.significand,
          otherExp
        );
      return fromRaw(
        this.significand - other.significand * pow10(-diff),
        thisExp
      );
    }

    // Slow path: handle NaN, Infinity
    if (thisExp !== thisExp || otherExp !== otherExp) return BigDecimal.NAN;

    const thisInf = !Number.isFinite(thisExp);
    const otherInf = !Number.isFinite(otherExp);
    if (thisInf && otherInf) {
      if (this.significand === other.significand) return BigDecimal.NAN;
      return this.significand > 0n
        ? BigDecimal.POSITIVE_INFINITY
        : BigDecimal.NEGATIVE_INFINITY;
    }
    if (thisInf)
      return this.significand > 0n
        ? BigDecimal.POSITIVE_INFINITY
        : BigDecimal.NEGATIVE_INFINITY;
    return other.significand > 0n
      ? BigDecimal.NEGATIVE_INFINITY
      : BigDecimal.POSITIVE_INFINITY;
  }

  /**
   * Multiply this value by another.
   * Multiplies significands, adds exponents. The result is exact.
   */
  mul(other: BigDecimal | number): BigDecimal {
    if (typeof other === 'number') other = new BigDecimal(other);

    const thisExp = this.exponent;
    const otherExp = other.exponent;

    // Fast path: both finite (excludes NaN and Infinity in one check)
    if (Number.isFinite(thisExp) && Number.isFinite(otherExp))
      return fromRaw(this.significand * other.significand, thisExp + otherExp);

    // Slow path: NaN or Infinity
    if (thisExp !== thisExp || otherExp !== otherExp) return BigDecimal.NAN;

    // At least one is Infinity
    // Infinity * 0 → NaN, 0 * Infinity → NaN
    if (this.significand === 0n || other.significand === 0n)
      return BigDecimal.NAN;

    // Infinity * Infinity or Infinity * finite (non-zero)
    const signA = this.significand > 0n ? 1n : -1n;
    const signB = other.significand > 0n ? 1n : -1n;
    return signA * signB > 0n
      ? BigDecimal.POSITIVE_INFINITY
      : BigDecimal.NEGATIVE_INFINITY;
  }

  /**
   * Negate this value. Zero.neg() → Zero.
   */
  neg(): BigDecimal {
    const sig = this.significand;
    if (sig === 0n) return this; // covers both zero ({0n,0}) and NaN ({0n,NaN})
    if (Number.isFinite(this.exponent)) return fromRaw(-sig, this.exponent);
    // Infinity
    return sig > 0n
      ? BigDecimal.NEGATIVE_INFINITY
      : BigDecimal.POSITIVE_INFINITY;
  }

  /**
   * Absolute value. If already non-negative, returns this.
   */
  abs(): BigDecimal {
    // NaN has sig=0n (>=0n), so `return this` handles it correctly.
    // +Infinity has sig=1n (>0n), so `return this` handles it too.
    if (this.significand >= 0n) return this;
    // -Infinity
    if (!Number.isFinite(this.exponent)) return BigDecimal.POSITIVE_INFINITY;
    return fromRaw(-this.significand, this.exponent);
  }

  /**
   * Round toward -Infinity.
   * `3.7` → `3`, `-3.7` → `-4`.
   * For integers returns this. NaN/Infinity → return this.
   */
  floor(): BigDecimal {
    const exp = this.exponent;
    if (exp >= 0) return this; // integer (also handles zero since exp=0)
    // exp < 0 and finite → has fractional part
    if (Number.isFinite(exp)) {
      const t = this.trunc();
      if (this.significand < 0n) return t.sub(fromRaw(1n, 0));
      return t;
    }
    // NaN or Infinity — return as-is (NaN→NaN, ±Inf→±Inf)
    return this;
  }

  /**
   * Round toward +Infinity.
   * `3.2` → `4`, `-3.2` → `-3`.
   * For integers returns this. NaN/Infinity → return this.
   */
  ceil(): BigDecimal {
    const exp = this.exponent;
    if (exp >= 0) return this; // integer (also handles zero since exp=0)
    // exp < 0 and finite → has fractional part
    if (Number.isFinite(exp)) {
      const t = this.trunc();
      if (this.significand > 0n) return t.add(fromRaw(1n, 0));
      return t;
    }
    // NaN or Infinity — return as-is
    return this;
  }

  /**
   * Round half away from zero (standard math rounding).
   * `3.5` → `4`, `-3.5` → `-4`, `3.4` → `3`, `3.6` → `4`.
   * For integers returns this. NaN/Infinity → return this.
   */
  round(): BigDecimal {
    const exp = this.exponent;
    if (exp >= 0) return this; // integer (also handles zero since exp=0)
    // exp < 0 and finite → has fractional part
    if (Number.isFinite(exp)) {
      const half = fromRaw(5n, -1); // 0.5
      if (this.significand > 0n) return this.add(half).trunc();
      return this.sub(half).trunc();
    }
    // NaN or Infinity — return as-is
    return this;
  }

  /**
   * Truncate toward zero, removing the fractional part.
   * For integers (exponent >= 0) returns this.
   * NaN → NaN, +/-Infinity → +/-Infinity.
   */
  trunc(): BigDecimal {
    const exp = this.exponent;
    if (exp >= 0) return this; // integer (also handles zero since exp=0)
    // exp < 0 and finite → truncate fractional digits
    if (Number.isFinite(exp)) {
      // BigInt division truncates toward zero, which is exactly what trunc() needs
      const truncSig = this.significand / pow10(-exp);
      if (truncSig === 0n) return fromRaw(0n, 0);
      return fromRaw(truncSig, 0);
    }
    // NaN or Infinity — return as-is
    return this;
  }

  /**
   * Divide this value by another.
   * Uses `BigDecimal.precision` to determine significant digits for inexact results.
   *
   * Special cases:
   *  - NaN / x → NaN, x / NaN → NaN
   *  - nonzero / 0 → +/-Infinity (matching Decimal.js behavior)
   *  - 0 / 0 → NaN
   *  - Inf / finite → Inf (correct sign)
   *  - finite / Inf → 0
   *  - Inf / Inf → NaN
   */
  div(other: BigDecimal | number): BigDecimal {
    if (typeof other === 'number') other = new BigDecimal(other);

    const thisExp = this.exponent;
    const otherExp = other.exponent;
    const thisSig = this.significand;
    const otherSig = other.significand;

    // Fast path: both finite
    if (Number.isFinite(thisExp) && Number.isFinite(otherExp)) {
      // Division by zero
      if (otherSig === 0n) {
        if (thisSig === 0n) return BigDecimal.NAN; // 0/0 → NaN
        return thisSig > 0n
          ? BigDecimal.POSITIVE_INFINITY
          : BigDecimal.NEGATIVE_INFINITY;
      }
      // 0 / nonzero → 0
      if (thisSig === 0n) return fromRaw(0n, 0);

      // General case
      const prec = BigDecimal.precision;
      const guard = 10;
      const absDividend = thisSig < 0n ? -thisSig : thisSig;
      const absDivisor = otherSig < 0n ? -otherSig : otherSig;
      const dividendDigits = bigintDigits(absDividend);
      const divisorDigits = bigintDigits(absDivisor);
      const totalScale =
        prec + guard + Math.max(0, divisorDigits - dividendDigits);
      const scale = pow10(totalScale);
      const quotient = (thisSig * scale) / otherSig;
      const resultExp = thisExp - otherExp - totalScale;
      return fromRaw(quotient, resultExp).toPrecision(prec);
    }

    // Slow path: NaN or Infinity
    if (thisExp !== thisExp || otherExp !== otherExp) return BigDecimal.NAN;

    const thisInf = !Number.isFinite(thisExp);
    const otherInf = !Number.isFinite(otherExp);
    if (thisInf && otherInf) return BigDecimal.NAN;
    if (thisInf) {
      const signA = thisSig > 0n ? 1n : -1n;
      const signB = otherSig > 0n ? 1n : otherSig < 0n ? -1n : 1n;
      return signA * signB > 0n
        ? BigDecimal.POSITIVE_INFINITY
        : BigDecimal.NEGATIVE_INFINITY;
    }
    // finite / Inf → 0
    return fromRaw(0n, 0);
  }

  /**
   * Multiplicative inverse: 1 / this.
   * Uses `BigDecimal.precision` for the division.
   */
  inv(): BigDecimal {
    return fromRaw(1n, 0).div(this);
  }

  /**
   * Modulo (remainder after truncating division).
   * Defined as: this - trunc(this / other) * other
   *
   * The sign of the result matches the sign of the dividend (this),
   * consistent with JavaScript's % operator and Decimal.js.
   */
  mod(other: BigDecimal | number): BigDecimal {
    if (typeof other === 'number') other = new BigDecimal(other);

    const thisExp = this.exponent;
    const otherExp = other.exponent;

    // Fast path: both finite
    if (Number.isFinite(thisExp) && Number.isFinite(otherExp)) {
      if (other.significand === 0n) return BigDecimal.NAN; // x mod 0 → NaN
      if (this.significand === 0n) return fromRaw(0n, 0); // 0 mod x → 0
      return this.sub(this.div(other).trunc().mul(other)).toPrecision(
        BigDecimal.precision
      );
    }

    // Slow path: NaN or Infinity
    if (thisExp !== thisExp || otherExp !== otherExp) return BigDecimal.NAN;
    if (!Number.isFinite(thisExp)) return BigDecimal.NAN; // Inf mod x → NaN
    // finite mod Inf → this
    return new BigDecimal(this);
  }

  /**
   * Raise to a power.
   *
   * - Integer exponent: exact result via repeated squaring
   * - Zero exponent: 1 (for any non-NaN base)
   * - Negative integer exponent: pow(abs(n)).inv() (uses precision)
   * - Non-integer exponent on positive base: exp(n * ln(this))
   * - Non-integer exponent on negative base: NaN (real-valued result doesn't exist)
   *
   * Special cases:
   *  - NaN base or exponent → NaN
   *  - Infinite exponent → NaN
   *  - 0^0 → 1 (mathematical convention)
   *  - 0^positive → 0
   *  - 0^negative → Infinity
   */
  pow(n: BigDecimal | number): BigDecimal {
    if (typeof n === 'number') n = new BigDecimal(n);
    // NaN propagation
    if (this.isNaN() || n.isNaN()) return BigDecimal.NAN;

    // Infinite exponent → NaN
    if (!n.isFinite()) return BigDecimal.NAN;

    // Integer exponent path (exact via repeated squaring)
    if (n.isInteger()) {
      const expValue = n.toBigInt();

      // x^0 → 1
      if (expValue === 0n) return fromRaw(1n, 0);

      // Handle infinity base
      if (!this.isFinite()) {
        if (expValue > 0n) {
          // Inf^positive: sign depends on parity
          if (this.significand < 0n && expValue % 2n !== 0n)
            return BigDecimal.NEGATIVE_INFINITY;
          return BigDecimal.POSITIVE_INFINITY;
        }
        // Inf^negative → 0
        return fromRaw(0n, 0);
      }

      // 0^n
      if (this.isZero()) {
        if (expValue > 0n) return fromRaw(0n, 0); // 0^positive → 0
        // 0^negative → Infinity (like Decimal.js: 1/0^|n| = 1/0 = Infinity)
        return BigDecimal.POSITIVE_INFINITY;
      }

      // Negative exponent: compute positive power then invert
      if (expValue < 0n) {
        return this.pow(n.neg()).inv();
      }

      // Check if the result would overflow (exponent magnitude > 9e15)
      // Estimate: log10(result) ≈ expValue * log10(|this|)
      const absSig =
        this.significand < 0n ? -this.significand : this.significand;
      const thisLog10 = bigintDigits(absSig) + this.exponent;
      // Use Number for the estimate — safe since we only need a rough magnitude
      const resultLog10 = Number(expValue) * thisLog10;
      if (resultLog10 > 9e15) {
        // Result is too large to represent
        return this.significand < 0n && expValue % 2n !== 0n
          ? BigDecimal.NEGATIVE_INFINITY
          : BigDecimal.POSITIVE_INFINITY;
      }
      if (resultLog10 < -9e15) {
        return fromRaw(0n, 0);
      }

      // Positive integer exponent: repeated squaring, truncated to working
      // precision after each multiply to prevent exponential significand growth.
      const prec = BigDecimal.precision;
      let result: BigDecimal = fromRaw(1n, 0);
      let base: BigDecimal = this;
      let exp = expValue;

      while (exp > 0n) {
        if (exp & 1n) {
          result = result.mul(base).toPrecision(prec);
        }
        exp >>= 1n;
        if (exp > 0n) {
          base = base.mul(base).toPrecision(prec);
        }
      }

      return result;
    }

    // Non-integer exponent path: use exp(n * ln(base))

    // Handle infinity base with non-integer exponent
    if (!this.isFinite()) {
      // +Inf ^ positive non-integer → +Inf
      // +Inf ^ negative non-integer → 0
      // -Inf ^ non-integer → NaN (not well-defined in reals)
      if (this.significand < 0n) return BigDecimal.NAN;
      if (n.significand > 0n) return BigDecimal.POSITIVE_INFINITY;
      return BigDecimal.ZERO;
    }

    // 0 ^ non-integer positive → 0, 0 ^ non-integer negative → Infinity
    if (this.isZero()) {
      if (n.significand > 0n) return BigDecimal.ZERO;
      return BigDecimal.POSITIVE_INFINITY;
    }

    // Negative base with non-integer exponent → NaN (not real-valued)
    if (this.significand < 0n) return BigDecimal.NAN;

    // Positive base, non-integer exponent: exp(n * ln(this))
    return n.mul(this.ln()).exp();
  }

  // ---------- Conversion methods ----------

  /** Convert to a JavaScript number. May lose precision for large values. */
  toNumber(): number {
    if (!Number.isFinite(this.exponent)) {
      // NaN (exp=NaN) or ±Infinity (exp=Infinity)
      if (this.exponent !== this.exponent) return NaN;
      return this.significand > 0n ? Infinity : -Infinity;
    }
    if (this.significand === 0n) return 0;

    // For exponent === 0, just convert significand directly
    if (this.exponent === 0) return Number(this.significand);

    // For non-zero exponents, parse the string representation to avoid
    // double-rounding errors from `Number(sig) * 10**exp`
    // (e.g., 184 * 0.1 = 18.400000000000002, not 18.4)
    return Number(this.toString());
  }

  /**
   * Reconstruct a decimal string from significand and exponent.
   *
   * For normal-range exponents, produces a clean decimal string.
   * For very large (> 20) or very small (< -6) adjusted exponents,
   * uses scientific notation like `'1.5e+25'`.
   */
  toString(): string {
    if (!Number.isFinite(this.exponent)) {
      if (this.exponent !== this.exponent) return 'NaN';
      return this.significand > 0n ? 'Infinity' : '-Infinity';
    }
    if (this.significand === 0n) return '0';

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
        numDigits === 1 ? absStr : absStr[0] + '.' + absStr.slice(1);
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
    if (!Number.isFinite(this.exponent)) {
      if (this.exponent !== this.exponent) return 'NaN';
      return this.significand > 0n ? 'Infinity' : '-Infinity';
    }

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
      rounded = absSig * pow10(shift);
    } else {
      // Need to divide (and potentially round)
      const divisor = pow10(-shift);
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
   * Round to n significant digits, returning a new BigDecimal.
   * Uses round-half-to-even for tie-breaking.
   * If the value already has n or fewer significant digits, returns this.
   */
  toPrecision(n: number): BigDecimal {
    // NaN ({0n,NaN}), zero ({0n,0}), ±Inf all return as-is
    if (this.significand === 0n || !Number.isFinite(this.exponent)) return this;

    const absSig = this.significand < 0n ? -this.significand : this.significand;
    const digits = bigintDigits(absSig);

    if (digits <= n) return this; // already within precision

    const shift = digits - n;
    const divisor = pow10(shift);
    let rounded = absSig / divisor;
    const remainder = absSig % divisor;

    // Round half-to-even
    const half = divisor / 2n;
    if (remainder > half || (remainder === half && rounded % 2n !== 0n)) {
      rounded += 1n;
    }

    const sig = this.significand < 0n ? -rounded : rounded;
    return fromRaw(sig, this.exponent + shift);
  }

  /**
   * Truncate fractional part and return a bigint.
   * Throws if the value is NaN or Infinity.
   */
  toBigInt(): bigint {
    if (!Number.isFinite(this.exponent)) {
      if (this.exponent !== this.exponent)
        throw new RangeError('Cannot convert NaN to BigInt');
      throw new RangeError('Cannot convert Infinity to BigInt');
    }

    if (this.exponent >= 0) {
      // Integer or scaled integer
      return this.significand * pow10(this.exponent);
    }

    // exponent < 0: truncate fractional digits
    const divisor = pow10(-this.exponent);
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
export function fromRaw(sig: bigint, exp: number): BigDecimal {
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
const _1e9 = 1000000000n;
const _1e3 = 1000n;

function normalize(sig: bigint, exp: number): [bigint, number] {
  if (sig === 0n) return [0n, 0];

  while (sig % _1e9 === 0n) {
    sig /= _1e9;
    exp += 9;
  }
  while (sig % _1e3 === 0n) {
    sig /= _1e3;
    exp += 3;
  }
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
