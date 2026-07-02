/**
 * Transcendental / irrational operations for BigDecimal.
 *
 * This module attaches `sqrt()` and `cbrt()` to BigDecimal.prototype
 * via declaration merging. It is imported for side effects in index.ts.
 */

import { BigDecimal, fromRaw } from './big-decimal';
import {
  bigintAbs,
  bitLength,
  fpmul,
  fpdiv,
  fpsqrt,
  fpexp,
  fpln,
  fpsincos,
  fpatan,
  bigintDigits,
  pow10,
} from './utils';

// ---------- Declaration merging ----------

declare module './big-decimal' {
  interface BigDecimal {
    /** Square root. Returns NaN for negative values. */
    sqrt(): BigDecimal;
    /** Cube root. Supports negative values. */
    cbrt(): BigDecimal;
    /** Exponential: e^this. */
    exp(): BigDecimal;
    /** Natural logarithm. Returns NaN for negative values, -Infinity for zero. */
    ln(): BigDecimal;
    /** Logarithm with specified base. */
    log(base: BigDecimal | number): BigDecimal;
    /** Sine. Returns NaN for NaN/Infinity inputs. */
    sin(): BigDecimal;
    /** Cosine. Returns NaN for NaN/Infinity inputs. */
    cos(): BigDecimal;
    /** Tangent. Returns NaN for NaN/Infinity inputs. */
    tan(): BigDecimal;
    /** Inverse sine (arcsine). Returns NaN for |x| > 1. */
    asin(): BigDecimal;
    /** Inverse cosine (arccosine). Returns NaN for |x| > 1. */
    acos(): BigDecimal;
    /** Inverse tangent (arctangent). */
    atan(): BigDecimal;
    /** Hyperbolic sine. */
    sinh(): BigDecimal;
    /** Hyperbolic cosine. */
    cosh(): BigDecimal;
    /** Hyperbolic tangent. */
    tanh(): BigDecimal;
    /** Inverse hyperbolic sine. */
    asinh(): BigDecimal;
    /** Inverse hyperbolic cosine. Returns NaN for values < 1. */
    acosh(): BigDecimal;
    /** Inverse hyperbolic tangent. Returns NaN for |x| > 1, ±Infinity at ±1. */
    atanh(): BigDecimal;
    /** exp(this) − 1, accurate for small arguments. */
    expm1(): BigDecimal;
    /** ln(1 + this), accurate for small arguments. */
    log1p(): BigDecimal;
    /** nth root. Supports negative values for odd n. */
    nthRoot(n: number): BigDecimal;
  }

  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace BigDecimal {
    function sqrt(x: BigDecimal): BigDecimal;
    function cbrt(x: BigDecimal): BigDecimal;
    function exp(x: BigDecimal): BigDecimal;
    function ln(x: BigDecimal): BigDecimal;
    function log10(x: BigDecimal): BigDecimal;
    function log2(x: BigDecimal): BigDecimal;
    function sin(x: BigDecimal): BigDecimal;
    function cos(x: BigDecimal): BigDecimal;
    function tan(x: BigDecimal): BigDecimal;
    function asin(x: BigDecimal): BigDecimal;
    function acos(x: BigDecimal): BigDecimal;
    function atan(x: BigDecimal): BigDecimal;
    function atan2(y: BigDecimal | number, x: BigDecimal): BigDecimal;
    function sinh(x: BigDecimal): BigDecimal;
    function cosh(x: BigDecimal): BigDecimal;
    function tanh(x: BigDecimal): BigDecimal;
    function asinh(x: BigDecimal): BigDecimal;
    function acosh(x: BigDecimal): BigDecimal;
    function atanh(x: BigDecimal): BigDecimal;
    function expm1(x: BigDecimal): BigDecimal;
    function log1p(x: BigDecimal): BigDecimal;
    function nthRoot(x: BigDecimal, n: number): BigDecimal;
  }
}

// ---------- Helpers: BigDecimal <-> fixed-point ----------

// The internal fixed-point kernel works on a *binary* grid (scale = 2^bits)
// because rescaling by the radix is then a bit-shift rather than a division —
// 2–4× faster than a base-10 grid at identical accuracy (see
// `utils.ts` header and ROADMAP item 17.1). The decimal<->binary conversion
// is paid once here, at the boundary; the cost is dominated by the kernel's
// inner-loop savings (validated end-to-end in the kernel benchmark).
const LOG2_10 = Math.log2(10); // ≈ 3.321928
const LOG10_2 = Math.log10(2); // ≈ 0.30103
/** Extra binary guard beyond the requested decimal working precision. */
const GUARD_BITS = 16;

/**
 * Safety cap on the number of π digits the trig mod-2π reduction will compute
 * on demand (via Chudnovsky in `fppi`). The hardcoded table is ~2370 digits;
 * beyond that π is computed on the fly, so the only limit is this cap, which
 * exists to keep an absurd argument (e.g. sin(1e2000000)) from triggering an
 * unbounded computation. Returns NaN past it.
 */
const MAX_PI_DIGITS = 1_000_000;

/**
 * Convert a BigDecimal to a base-2 fixed-point bigint.
 *
 * Returns [fp, bits] where fp / 2^bits represents the same value.
 * `precision` is the requested number of significant *decimal* digits; the
 * binary grid is sized to hold them with a small guard.
 */
function toFixedPoint(x: BigDecimal, precision: number): [bigint, number] {
  const bits = Math.ceil(precision * LOG2_10) + GUARD_BITS;
  const B = BigInt(bits);
  // value · 2^bits = significand · 10^exponent · 2^bits
  if (x.exponent >= 0) return [(x.significand * pow10(x.exponent)) << B, bits];
  // exponent < 0: divide by 10^(-exponent) after shifting in the binary scale
  // (loses digits below the precision window, as before).
  return [(x.significand << B) / pow10(-x.exponent), bits];
}

/**
 * Convert a base-2 fixed-point bigint (value = fp / 2^bits) back to a
 * BigDecimal, rounding to `targetPrecision` significant decimal digits.
 */
function fromFixedPoint(
  fp: bigint,
  bits: number,
  targetPrecision: number
): BigDecimal {
  if (fp === 0n) return BigDecimal.ZERO;

  const negative = fp < 0n;
  const absFp = negative ? -fp : fp;
  const B = BigInt(bits);

  // Step 1: render value = absFp / 2^bits as an integer N ≈ value · 10^P,
  // carrying a few more than targetPrecision significant digits. The decimal
  // exponent is estimated from the bit length (±1 is absorbed by the
  // significant-digit rounding in step 2, which has ≥4 guard digits).
  const valueBits = bitLength(absFp) - bits; // ≈ log2(value)
  const decExp = Math.floor(valueBits * LOG10_2); // ≈ floor(log10 value)
  const P = targetPrecision + 4 - decExp; // decimal places to keep

  let N: bigint;
  let valueExp: number; // value ≈ N · 10^valueExp
  if (P >= 0) {
    const num = absFp * pow10(P);
    N = (num + (1n << (B - 1n))) >> B; // round(num / 2^bits)
    valueExp = -P;
  } else {
    const denom = pow10(-P) << B; // 2^bits · 10^(-P)
    N = (absFp + denom / 2n) / denom; // round(absFp / denom)
    valueExp = -P;
  }
  if (N === 0n) return BigDecimal.ZERO;

  // Step 2: round N to targetPrecision significant digits.
  const nDigits = bigintDigits(N);
  if (nDigits > targetPrecision) {
    const drop = nDigits - targetPrecision;
    const divisor = pow10(drop);
    const half = divisor / 2n;
    const remainder = N % divisor;
    N = N / divisor;
    if (remainder >= half) N += 1n;
    valueExp += drop;
  }

  return fromRaw(negative ? -N : N, valueExp);
}

// ---------- Range-reduction helpers ----------

/**
 * Decimal exponent of a finite, non-zero value: |x| ∈ [10^e, 10^(e+1)).
 *
 * The fixed-point bridge (`toFixedPoint`) is an *absolute*-precision grid:
 * values below 10^-workingPrec truncate to 0n and values far from 1 lose
 * leading digits. Every transcendental that wants full *relative* precision
 * factors this decimal exponent out of its argument (or compensates for it
 * in the working precision) before crossing the bridge.
 */
function decimalExponent(x: BigDecimal): number {
  return x.exponent + x.digitCount() - 1;
}

/**
 * The exponent of a BigDecimal is a JS number, so the largest decimal
 * exponent that is exactly representable is Number.MAX_SAFE_INTEGER.
 * Results whose exponent would exceed it saturate to ±Infinity / 0.
 */
const MAX_SAFE_EXPONENT = BigInt(Number.MAX_SAFE_INTEGER);

// ---------- Range-reduction constant: ln(10) in fixed-point ----------

// `exp`/`ln` factor the decimal exponent out of their argument using ln(10).
// Cache its fixed-point value, keyed by the scale (working precision), so the
// Newton iteration in `fpln` runs at most once per precision change.
let _ln10Cache: { bits: number; value: bigint } | null = null;
function ln10Fixed(bits: number): bigint {
  // "Compute high, downshift for lower." ln() and exp() reduce at slightly
  // different working precisions (targetPrec + 20 + eDigits vs + magnitude), so
  // a cache keyed by exact bits would thrash when both run (e.g. inside pow =
  // ln then exp), recomputing this full ln each call. Caching the highest bits
  // seen and right-shifting for any lower request avoids that.
  if (_ln10Cache !== null) {
    if (_ln10Cache.bits === bits) return _ln10Cache.value;
    if (_ln10Cache.bits > bits)
      return _ln10Cache.value >> BigInt(_ln10Cache.bits - bits);
  }
  // ln(10) · 2^bits, computed from the fixed-point value 10·2^bits = 10 << bits.
  // 10 is O(1), so this is well-conditioned and never hits the underflow path
  // it exists to fix.
  const value = fpln(10n << BigInt(bits), bits);
  _ln10Cache = { bits, value };
  return value;
}

// ---------- sqrt ----------

BigDecimal.prototype.sqrt = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;
  if (this.isZero()) return BigDecimal.ZERO;

  if (!this.isFinite()) {
    // sqrt(+Inf) = +Inf, sqrt(-Inf) = NaN
    if (this.significand > 0n) return BigDecimal.POSITIVE_INFINITY;
    return BigDecimal.NAN;
  }

  // sqrt of negative → NaN
  if (this.significand < 0n) return BigDecimal.NAN;

  // Working precision with guard digits
  const targetPrec = BigDecimal.precision;
  const workingPrec = targetPrec + 10;

  // Range reduction: write x = m·10^(2k) with m ∈ [1, 100), so
  // sqrt(x) = sqrt(m)·10^k. The fixed-point kernel only ever sees m, an
  // O(1) value — a tiny x (e.g. 1e-100) no longer underflows the
  // absolute-precision fixed-point grid to 0, and the bridge keeps full
  // relative precision for any decimal exponent.
  const e = decimalExponent(this);
  const k = Math.floor(e / 2);
  const m = fromRaw(this.significand, this.exponent - 2 * k); // m ∈ [1, 100)

  const [fp, bits] = toFixedPoint(m, workingPrec);

  // Compute fixed-point sqrt
  const sqrtFp = fpsqrt(fp, bits);

  // Reattach the decimal exponent: sqrt(m)·10^k.
  const root = fromFixedPoint(sqrtFp, bits, targetPrec);
  return fromRaw(root.significand, root.exponent + k);
};

// ---------- cbrt ----------

BigDecimal.prototype.cbrt = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;
  if (this.isZero()) return BigDecimal.ZERO;

  if (!this.isFinite()) {
    // cbrt(+Inf) = +Inf, cbrt(-Inf) = -Inf
    if (this.significand > 0n) return BigDecimal.POSITIVE_INFINITY;
    return BigDecimal.NEGATIVE_INFINITY;
  }

  // cbrt of negative: negate, compute cbrt, negate result
  if (this.significand < 0n) {
    return this.neg().cbrt().neg();
  }

  // Working precision with guard digits
  const targetPrec = BigDecimal.precision;
  const workingPrec = targetPrec + 10;

  // Range reduction: write x = m·10^(3k) with m ∈ [1, 1000), so
  // cbrt(x) = cbrt(m)·10^k. As for sqrt, the fixed-point kernel only sees
  // the O(1) mantissa m, so tiny/huge decimal exponents neither underflow
  // the absolute-precision grid nor inflate the working bigints.
  const e = decimalExponent(this);
  const k = Math.floor(e / 3);
  const m = fromRaw(this.significand, this.exponent - 3 * k); // m ∈ [1, 1000)

  const [fp, bits] = toFixedPoint(m, workingPrec);

  // Newton iteration for cube root in fixed-point:
  // We want cbrt(v) where v = fp / scale (scale = 2^bits).
  //
  // Work with the recurrence directly:
  // x_{n+1} = (2 * x + C / x^2) / 3
  //
  // where x represents cbrt(fp/scale) * scale.
  // Derivation:
  //   We want y such that y/scale = cbrt(fp/scale)
  //   i.e., y^3 = fp * scale^2  (since (y/scale)^3 = fp/scale → y^3 = fp * scale^2)
  //
  //   Newton on f(y) = y^3 - fp*scale^2:
  //   y_{n+1} = y - f(y)/f'(y) = y - (y^3 - C) / (3*y^2)
  //           = (2*y + C / y^2) / 3
  //   where C = fp * scale^2 = fp << (2·bits)

  const C = fp << BigInt(2 * bits);

  // Seed from floating-point approximation (m ∈ [1, 1000) is always finite).
  // Number(2^bits) overflows beyond ~1023 bits, so use the bit-based seed there.
  let x: bigint;
  const numVal = m.toNumber();
  if (bits <= 1000 && Number.isFinite(numVal) && numVal > 0) {
    const scaleNum = Number(1n << BigInt(bits));
    const approx = Math.cbrt(numVal);
    if (Number.isFinite(approx) && approx > 0) {
      // Convert to fixed-point
      x = BigInt(Math.floor(approx * scaleNum));
      if (x === 0n) x = 1n;
    } else {
      x = cbrtSeed(C);
    }
  } else {
    x = cbrtSeed(C);
  }

  // Newton iteration: x_{n+1} = (2*x + C / x^2) / 3
  let prev: bigint;
  do {
    prev = x;
    const x2 = x * x;
    if (x2 === 0n) {
      x = 1n;
      break;
    }
    x = (2n * x + C / x2) / 3n;
  } while (bigintAbs(x - prev) > 1n);

  // One more iteration to refine
  {
    const next = (2n * x + C / (x * x)) / 3n;
    // Pick the value whose cube is closest to C
    const diffX = bigintAbs(x * x * x - C);
    const diffNext = bigintAbs(next * next * next - C);
    if (diffNext < diffX) x = next;
  }

  // Reattach the decimal exponent: cbrt(m)·10^k.
  const root = fromFixedPoint(x, bits, targetPrec);
  return fromRaw(root.significand, root.exponent + k);
};

// ---------- Static methods ----------

(BigDecimal as unknown as { sqrt: (x: BigDecimal) => BigDecimal }).sqrt =
  function (x: BigDecimal): BigDecimal {
    return x.sqrt();
  };

(BigDecimal as unknown as { cbrt: (x: BigDecimal) => BigDecimal }).cbrt =
  function (x: BigDecimal): BigDecimal {
    return x.cbrt();
  };

// ---------- exp ----------

BigDecimal.prototype.exp = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;

  if (!this.isFinite()) {
    // exp(+Inf) = +Inf, exp(-Inf) = 0
    if (this.significand > 0n) return BigDecimal.POSITIVE_INFINITY;
    return BigDecimal.ZERO;
  }

  // exp(0) = 1
  if (this.isZero()) return BigDecimal.ONE;

  // Fast saturation for astronomically large arguments: |x| ≥ 1e17 implies
  // |x / ln 10| > Number.MAX_SAFE_INTEGER (≈ 9.0e15), so the decimal
  // exponent of the result is not representable (see MAX_SAFE_EXPONENT).
  // Checking early avoids sizing the working precision by the magnitude.
  if (decimalExponent(this) >= 17)
    return this.significand > 0n
      ? BigDecimal.POSITIVE_INFINITY
      : BigDecimal.ZERO;

  const targetPrec = BigDecimal.precision;

  // Range reduction: exp(x) = exp(r) · 10^k with x = k·ln(10) + r and
  // r ∈ [0, ln(10)). This keeps the value handed to the fixed-point kernel
  // O(1), so the *result* never underflows the absolute-precision grid —
  // exp(-200) ≈ 1.38e-87 is recovered as exp(0.32)·10⁻⁸⁷ instead of rounding
  // to 0. The reduction is done in exact bigint fixed-point (no cancellation).
  const magnitude = Math.max(0, this.exponent + this.digitCount());
  const workingPrec = targetPrec + 20 + magnitude;

  const [xFp, bits] = toFixedPoint(this, workingPrec);
  const l10 = ln10Fixed(bits);

  // k = floor(x / ln(10)); r = x − k·ln(10) ∈ [0, ln(10)).
  let k = xFp / l10;
  let rFp = xFp - k * l10;
  if (rFp < 0n) {
    k -= 1n;
    rFp += l10;
  }

  // Saturation policy: the decimal exponent of the result is k (plus an
  // O(1) correction), and the class stores exponents as JS numbers, which
  // are exact only up to Number.MAX_SAFE_INTEGER. Beyond that bound the
  // result is not representable: saturate to +Infinity (k > 0) or 0 (k < 0),
  // consistent with the exp(±Infinity) limits.
  if (k > MAX_SAFE_EXPONENT || k < -MAX_SAFE_EXPONENT)
    return k > 0n ? BigDecimal.POSITIVE_INFINITY : BigDecimal.ZERO;

  const expR = fromFixedPoint(fpexp(rFp, bits), bits, targetPrec);

  // Multiply by 10^k by shifting the decimal exponent.
  const newExp = expR.exponent + Number(k);
  if (!Number.isSafeInteger(newExp))
    return k > 0n ? BigDecimal.POSITIVE_INFINITY : BigDecimal.ZERO;
  return fromRaw(expR.significand, newExp);
};

// ---------- ln ----------

BigDecimal.prototype.ln = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;

  if (!this.isFinite()) {
    // ln(+Inf) = +Inf, ln(-Inf) = NaN
    if (this.significand > 0n) return BigDecimal.POSITIVE_INFINITY;
    return BigDecimal.NAN;
  }

  // ln(0) = -Infinity
  if (this.isZero()) return BigDecimal.NEGATIVE_INFINITY;

  // ln(negative) = NaN
  if (this.significand < 0n) return BigDecimal.NAN;

  // ln(1) = 0
  if (this.eq(1)) return BigDecimal.ZERO;

  const targetPrec = BigDecimal.precision;

  // Range reduction: write x = m · 10^e with m ∈ [1, 10) and
  // ln(x) = ln(m) + e·ln(10). The fixed-point kernel only ever sees m, an
  // O(1) value, so a tiny x (e.g. 1e-100) no longer underflows its
  // fixed-point input to 0 — which used to return −∞ (and previously hung in
  // the sqrt-reduction loop, `fpsqrt(0) = 0`).
  const sig = this.significand; // positive and finite here
  const digits = this.digitCount();
  const e = this.exponent + digits - 1;
  const m = fromRaw(sig, -(digits - 1)); // m ∈ [1, 10)

  const eDigits = Math.abs(e).toString().length;
  const workingPrec = targetPrec + 20 + eDigits;

  const [mFp, bits] = toFixedPoint(m, workingPrec);
  const l10 = ln10Fixed(bits);

  // ln(x)·scale = ln(m)·scale + e·ln(10)·scale (exact bigint arithmetic).
  const resultFp = fpln(mFp, bits) + BigInt(e) * l10;
  return fromFixedPoint(resultFp, bits, targetPrec);
};

// ---------- log(base) ----------

BigDecimal.prototype.log = function (base: BigDecimal | number): BigDecimal {
  // log_b(x) = ln(x) / ln(b)
  const b = base instanceof BigDecimal ? base : new BigDecimal(base);
  return this.ln().div(b.ln());
};

// ---------- Static methods: exp, ln, log10 ----------

(BigDecimal as unknown as { exp: (x: BigDecimal) => BigDecimal }).exp =
  function (x: BigDecimal): BigDecimal {
    return x.exp();
  };

(BigDecimal as unknown as { ln: (x: BigDecimal) => BigDecimal }).ln = function (
  x: BigDecimal
): BigDecimal {
  return x.ln();
};

(BigDecimal as unknown as { log10: (x: BigDecimal) => BigDecimal }).log10 =
  function (x: BigDecimal): BigDecimal {
    return x.log(10);
  };

(BigDecimal as unknown as { log2: (x: BigDecimal) => BigDecimal }).log2 =
  function (x: BigDecimal): BigDecimal {
    return x.log(2);
  };

// ---------- sin ----------

BigDecimal.prototype.sin = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;
  if (!this.isFinite()) return BigDecimal.NAN; // sin(±Inf) = NaN
  if (this.isZero()) return BigDecimal.ZERO;

  const targetPrec = BigDecimal.precision;
  const e = decimalExponent(this);

  // sin(x) = x·(1 − x²/6 + …): for tiny x the relative correction
  // (< x² < 10^(2e+2)) is below the precision target — the answer *is* x.
  // Without this, the absolute-precision bridge would underflow tiny x to
  // an exact (and wrong) 0.
  if (e < 0 && -2 * e >= targetPrec + 4) return this.toPrecision(targetPrec);

  // Small (but not tiny) arguments lose −e leading digits crossing the
  // absolute-precision bridge: compensate in the working precision.
  const workingPrec = targetPrec + 15 + (e < 0 ? -e : 0);

  // Huge arguments are reduced mod 2π inside fpsincos at extended precision,
  // which needs ~e extra digits of π. π is computed on demand (Chudnovsky)
  // beyond the stored table, so this only caps truly absurd magnitudes.
  if (e + workingPrec + 30 > MAX_PI_DIGITS) return BigDecimal.NAN;

  const [fp, bits] = toFixedPoint(this, workingPrec);
  const [sinFp] = fpsincos(fp, bits);
  return fromFixedPoint(sinFp, bits, targetPrec);
};

// ---------- cos ----------

BigDecimal.prototype.cos = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;
  if (!this.isFinite()) return BigDecimal.NAN; // cos(±Inf) = NaN
  if (this.isZero()) return BigDecimal.ONE;

  const targetPrec = BigDecimal.precision;
  const workingPrec = targetPrec + 15;

  // π-digit budget for the mod-2π reduction of huge arguments (see sin).
  // (Tiny arguments are fine here: the result is O(1), and a fixed-point
  // input that truncates to 0 yields cos = 1, the correctly rounded value.)
  const e = decimalExponent(this);
  if (e + workingPrec + 30 > MAX_PI_DIGITS) return BigDecimal.NAN;

  const [fp, bits] = toFixedPoint(this, workingPrec);
  const [, cosFp] = fpsincos(fp, bits);
  return fromFixedPoint(cosFp, bits, targetPrec);
};

// ---------- tan ----------

BigDecimal.prototype.tan = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;
  if (!this.isFinite()) return BigDecimal.NAN; // tan(±Inf) = NaN
  if (this.isZero()) return BigDecimal.ZERO;

  const targetPrec = BigDecimal.precision;
  const e = decimalExponent(this);

  // tan(x) = x·(1 + x²/3 + …): tiny x rounds to x (see sin).
  if (e < 0 && -2 * e >= targetPrec + 4) return this.toPrecision(targetPrec);

  // Compensate small arguments; cap huge ones by the π-digit budget (see sin).
  const workingPrec = targetPrec + 15 + (e < 0 ? -e : 0);
  if (e + workingPrec + 30 > MAX_PI_DIGITS) return BigDecimal.NAN;

  const [fp, bits] = toFixedPoint(this, workingPrec);
  const [sinFp, cosFp] = fpsincos(fp, bits);

  // tan = sin / cos
  if (cosFp === 0n) {
    // cos = 0 means we're at π/2 + nπ → tan is ±Infinity
    return sinFp > 0n
      ? BigDecimal.POSITIVE_INFINITY
      : BigDecimal.NEGATIVE_INFINITY;
  }

  // Fixed-point division: (sinFp << bits) / cosFp
  const tanFp = (sinFp << BigInt(bits)) / cosFp;
  return fromFixedPoint(tanFp, bits, targetPrec);
};

// ---------- atan ----------

BigDecimal.prototype.atan = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;
  if (this.isZero()) return BigDecimal.ZERO;

  if (!this.isFinite()) {
    // atan(+Inf) = π/2, atan(-Inf) = -π/2
    const piHalf = BigDecimal.PI.div(BigDecimal.TWO);
    if (this.significand > 0n) return piHalf;
    return piHalf.neg();
  }

  const targetPrec = BigDecimal.precision;
  const e = decimalExponent(this);

  // atan(x) = x·(1 − x²/3 + …): tiny x rounds to x (see sin).
  if (e < 0 && -2 * e >= targetPrec + 4) return this.toPrecision(targetPrec);

  // Compensate small arguments crossing the absolute-precision bridge.
  // (Huge arguments are fine: fpatan reduces via atan(x) = π/2 − atan(1/x).)
  const workingPrec = targetPrec + 15 + (e < 0 ? -e : 0);

  const [fp, bits] = toFixedPoint(this, workingPrec);
  const atanFp = fpatan(fp, bits);
  return fromFixedPoint(atanFp, bits, targetPrec);
};

// ---------- asin ----------

BigDecimal.prototype.asin = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;
  if (!this.isFinite()) return BigDecimal.NAN; // asin(±Inf) = NaN
  if (this.isZero()) return BigDecimal.ZERO;

  // Check |x| > 1 → NaN
  const absThis = this.abs();
  const one = BigDecimal.ONE;
  if (absThis.gt(one)) return BigDecimal.NAN;

  // asin(1) = π/2, asin(-1) = -π/2
  if (absThis.eq(one)) {
    const piHalf = BigDecimal.PI.div(BigDecimal.TWO);
    return this.significand > 0n ? piHalf : piHalf.neg();
  }

  const targetPrec = BigDecimal.precision;
  const e = decimalExponent(this);

  // asin(x) = x·(1 + x²/6 + …): tiny x rounds to x (see sin).
  if (e < 0 && -2 * e >= targetPrec + 4) return this.toPrecision(targetPrec);

  // asin(x) = atan(x / sqrt(1 - x²))
  // Compute entirely in fixed-point to avoid precision loss from chaining
  // BigDecimal operations at user-visible precision. Small arguments lose
  // −e leading digits crossing the bridge: compensate.
  const workingPrec = targetPrec + 20 + (e < 0 ? -e : 0);

  const [xFp, bits] = toFixedPoint(this, workingPrec);
  const scale = 1n << BigInt(bits); // 1.0 on the binary grid

  // x² in fixed-point
  const x2 = fpmul(xFp, xFp, bits);

  // 1 - x² in fixed-point
  const oneMinusX2 = scale - x2;

  // sqrt(1 - x²) in fixed-point
  const sqrtVal = fpsqrt(oneMinusX2, bits);

  // x / sqrt(1 - x²) in fixed-point
  const ratio = fpdiv(xFp, sqrtVal, bits);

  // atan(ratio) in fixed-point
  const result = fpatan(ratio, bits);

  return fromFixedPoint(result, bits, targetPrec);
};

// ---------- acos ----------

BigDecimal.prototype.acos = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;
  if (!this.isFinite()) return BigDecimal.NAN; // acos(±Inf) = NaN

  // Check |x| > 1 → NaN
  const absThis = this.abs();
  if (absThis.gt(BigDecimal.ONE)) return BigDecimal.NAN;

  // acos(1) = 0
  if (this.eq(1)) return BigDecimal.ZERO;

  // acos(-1) = π
  if (this.eq(-1)) return BigDecimal.PI;

  // acos(x) = π/2 - asin(x)
  // Both asin and the subtraction are done at user precision,
  // but asin already uses working precision internally.
  const piHalf = BigDecimal.PI.div(BigDecimal.TWO);
  return piHalf.sub(this.asin());
};

// ---------- Static methods: sin, cos, tan, asin, acos, atan, atan2 ----------

(BigDecimal as unknown as { sin: (x: BigDecimal) => BigDecimal }).sin =
  function (x: BigDecimal): BigDecimal {
    return x.sin();
  };

(BigDecimal as unknown as { cos: (x: BigDecimal) => BigDecimal }).cos =
  function (x: BigDecimal): BigDecimal {
    return x.cos();
  };

(BigDecimal as unknown as { tan: (x: BigDecimal) => BigDecimal }).tan =
  function (x: BigDecimal): BigDecimal {
    return x.tan();
  };

(BigDecimal as unknown as { asin: (x: BigDecimal) => BigDecimal }).asin =
  function (x: BigDecimal): BigDecimal {
    return x.asin();
  };

(BigDecimal as unknown as { acos: (x: BigDecimal) => BigDecimal }).acos =
  function (x: BigDecimal): BigDecimal {
    return x.acos();
  };

(BigDecimal as unknown as { atan: (x: BigDecimal) => BigDecimal }).atan =
  function (x: BigDecimal): BigDecimal {
    return x.atan();
  };

(
  BigDecimal as unknown as {
    atan2: (y: BigDecimal | number, x: BigDecimal) => BigDecimal;
  }
).atan2 = function (y: BigDecimal | number, x: BigDecimal): BigDecimal {
  const yBd = y instanceof BigDecimal ? y : new BigDecimal(y);

  // NaN propagation
  if (yBd.isNaN() || x.isNaN()) return BigDecimal.NAN;

  const pi = BigDecimal.PI;
  const piHalf = pi.div(BigDecimal.TWO);

  // x = 0 cases
  if (x.isZero()) {
    if (yBd.isZero()) return BigDecimal.ZERO; // atan2(0, 0) = 0 (convention)
    if (yBd.significand > 0n) return piHalf; // atan2(+, 0) = π/2
    return piHalf.neg(); // atan2(-, 0) = -π/2
  }

  const ratio = yBd.div(x);

  if (x.significand > 0n) {
    // x > 0 (including +Infinity): atan(y/x)
    return ratio.atan();
  }

  // x < 0
  if (yBd.significand >= 0n) {
    // y >= 0: atan(y/x) + π
    return ratio.atan().add(pi);
  }

  // y < 0: atan(y/x) - π
  return ratio.atan().sub(pi);
};

// ---------- sinh ----------

BigDecimal.prototype.sinh = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;
  if (this.isZero()) return BigDecimal.ZERO;

  if (!this.isFinite()) {
    // sinh(+Inf) = +Inf, sinh(-Inf) = -Inf
    if (this.significand > 0n) return BigDecimal.POSITIVE_INFINITY;
    return BigDecimal.NEGATIVE_INFINITY;
  }

  const targetPrec = BigDecimal.precision;
  const e = decimalExponent(this);

  if (e < 0) {
    // sinh(x) = x·(1 + x²/6 + …): tiny x rounds to x (see sin).
    if (-2 * e >= targetPrec + 4) return this.toPrecision(targetPrec);

    // Small x: exp(x) − exp(−x) cancels the leading 1, losing ~−e digits.
    // Temporarily raise the precision to compensate, then round back.
    const saved = BigDecimal.precision;
    BigDecimal.precision = targetPrec - e + 5;
    try {
      const expX = this.exp();
      return expX.sub(expX.inv()).div(BigDecimal.TWO).toPrecision(targetPrec);
    } finally {
      BigDecimal.precision = saved;
    }
  }

  // Large |x|: exp(−x) is below the rounding grid once 2|x| > (p+3)·ln 10,
  // so sinh(x) = ±exp(|x|)/2 correctly rounded. Short-circuit — subtracting
  // exp(−x) from exp(x) would align exponents ~2|x|/ln 10 apart and build
  // astronomically large significands (sinh(1e9) would attempt a
  // ~10⁹-digit bigint subtraction).
  if (Math.abs(this.toNumber()) > 1.16 * (targetPrec + 3)) {
    const h = this.abs().exp().div(BigDecimal.TWO);
    return this.significand > 0n ? h : h.neg();
  }

  // sinh(x) = (exp(x) - 1/exp(x)) / 2
  // Use inv() instead of exp(-x) — a single division vs a full Taylor+squaring
  const expX = this.exp();
  const expNegX = expX.inv();
  return expX.sub(expNegX).div(BigDecimal.TWO);
};

// ---------- cosh ----------

BigDecimal.prototype.cosh = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;
  if (this.isZero()) return BigDecimal.ONE;

  if (!this.isFinite()) {
    // cosh(+Inf) = +Inf, cosh(-Inf) = +Inf (even function)
    return BigDecimal.POSITIVE_INFINITY;
  }

  // Large |x|: cosh(x) = exp(|x|)/2 correctly rounded (see sinh — avoids
  // aligning exponents ~2|x|/ln 10 apart in the addition below).
  const targetPrec = BigDecimal.precision;
  if (Math.abs(this.toNumber()) > 1.16 * (targetPrec + 3))
    return this.abs().exp().div(BigDecimal.TWO);

  // cosh(x) = (exp(x) + 1/exp(x)) / 2
  // Use inv() instead of exp(-x) — a single division vs a full Taylor+squaring
  const expX = this.exp();
  const expNegX = expX.inv();
  return expX.add(expNegX).div(BigDecimal.TWO);
};

// ---------- tanh ----------

BigDecimal.prototype.tanh = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;
  if (this.isZero()) return BigDecimal.ZERO;

  if (!this.isFinite()) {
    // tanh(+Inf) = 1, tanh(-Inf) = -1
    if (this.significand > 0n) return BigDecimal.ONE;
    return BigDecimal.NEGATIVE_ONE;
  }

  const targetPrec = BigDecimal.precision;
  const e = decimalExponent(this);

  if (e < 0) {
    // tanh(x) = x·(1 − x²/3 + …): tiny x rounds to x (see sin).
    if (-2 * e >= targetPrec + 4) return this.toPrecision(targetPrec);

    // Small x: exp(2x) − 1 cancels the leading 1, losing ~−e digits.
    // Temporarily raise the precision to compensate, then round back.
    const saved = BigDecimal.precision;
    BigDecimal.precision = targetPrec - e + 5;
    try {
      const exp2x = this.mul(BigDecimal.TWO).exp();
      return exp2x
        .sub(BigDecimal.ONE)
        .div(exp2x.add(BigDecimal.ONE))
        .toPrecision(targetPrec);
    } finally {
      BigDecimal.precision = saved;
    }
  }

  // Large |x|: 1 − |tanh(x)| = 2e^(−2|x|)(1 + …) is below the rounding grid
  // once 2|x| > (p+3)·ln 10, so the result rounds to ±1. Short-circuit —
  // exp(2x) ∓ 1 would align exponents ~2|x|/ln 10 apart and build
  // astronomically large significands (tanh(1e9) would attempt a
  // ~10⁹-digit bigint subtraction).
  if (Math.abs(this.toNumber()) > 1.16 * (targetPrec + 3))
    return this.significand > 0n ? BigDecimal.ONE : BigDecimal.NEGATIVE_ONE;

  // Use (exp(2x) - 1) / (exp(2x) + 1) for better numerical stability with large x
  const exp2x = this.mul(BigDecimal.TWO).exp();
  return exp2x.sub(BigDecimal.ONE).div(exp2x.add(BigDecimal.ONE));
};

// ---------- Static methods: sinh, cosh, tanh ----------

(BigDecimal as unknown as { sinh: (x: BigDecimal) => BigDecimal }).sinh =
  function (x: BigDecimal): BigDecimal {
    return x.sinh();
  };

(BigDecimal as unknown as { cosh: (x: BigDecimal) => BigDecimal }).cosh =
  function (x: BigDecimal): BigDecimal {
    return x.cosh();
  };

(BigDecimal as unknown as { tanh: (x: BigDecimal) => BigDecimal }).tanh =
  function (x: BigDecimal): BigDecimal {
    return x.tanh();
  };

// ---------- expm1 ----------

BigDecimal.prototype.expm1 = function (): BigDecimal {
  // exp(this) − 1, accurate for small arguments (where exp(x) − 1 would lose
  // the leading digits to cancellation with 1).
  if (this.isNaN()) return BigDecimal.NAN;
  if (!this.isFinite())
    return this.significand > 0n
      ? BigDecimal.POSITIVE_INFINITY
      : BigDecimal.NEGATIVE_ONE; // expm1(−∞) = −1
  if (this.isZero()) return BigDecimal.ZERO;

  const targetPrec = BigDecimal.precision;
  const e = decimalExponent(this);

  // expm1(x) = x + x²/2 + …: tiny x rounds to x (relative error ~x/2 ~ 10^e).
  if (e < 0 && -e >= targetPrec + 2) return this.toPrecision(targetPrec);

  if (e < 0) {
    // Small x: exp(x) ≈ 1 + x, so exp(x) − 1 cancels ~−e leading digits.
    // Raise the precision to compensate, then round back.
    const saved = BigDecimal.precision;
    BigDecimal.precision = targetPrec - e + 5;
    try {
      return this.exp().sub(BigDecimal.ONE).toPrecision(targetPrec);
    } finally {
      BigDecimal.precision = saved;
    }
  }

  // |x| ≳ 1: the result is O(1) or larger, no cancellation.
  return this.exp().sub(BigDecimal.ONE);
};

// ---------- log1p ----------

BigDecimal.prototype.log1p = function (): BigDecimal {
  // ln(1 + this), accurate for small arguments (where 1 + x ≈ 1).
  if (this.isNaN()) return BigDecimal.NAN;
  if (!this.isFinite())
    return this.significand > 0n
      ? BigDecimal.POSITIVE_INFINITY
      : BigDecimal.NAN;
  if (this.isZero()) return BigDecimal.ZERO;

  // 1 + x ≤ 0 → outside the domain.
  const onePlus = BigDecimal.ONE.add(this);
  if (onePlus.isZero()) return BigDecimal.NEGATIVE_INFINITY; // x = −1
  if (onePlus.significand < 0n) return BigDecimal.NAN; // x < −1

  const targetPrec = BigDecimal.precision;
  const e = decimalExponent(this);

  // log1p(x) = x − x²/2 + …: tiny x rounds to x.
  if (e < 0 && -e >= targetPrec + 2) return this.toPrecision(targetPrec);

  if (e < 0) {
    // Small x: ln(1 + x) ≈ x but 1 + x ≈ 1, so ln loses ~−e leading digits.
    // (Forming 1 + x is exact; the loss is in resolving ln near 1.) Compensate.
    const saved = BigDecimal.precision;
    BigDecimal.precision = targetPrec - e + 5;
    try {
      return BigDecimal.ONE.add(this).ln().toPrecision(targetPrec);
    } finally {
      BigDecimal.precision = saved;
    }
  }

  return BigDecimal.ONE.add(this).ln();
};

// ---------- asinh ----------

BigDecimal.prototype.asinh = function (): BigDecimal {
  // asinh(x) = sign(x) · ln(|x| + sqrt(x² + 1)). Odd function; |x| keeps the
  // logarithm's argument ≥ 1 so the sum never cancels.
  if (this.isNaN()) return BigDecimal.NAN;
  if (this.isZero()) return BigDecimal.ZERO;
  if (!this.isFinite())
    return this.significand > 0n
      ? BigDecimal.POSITIVE_INFINITY
      : BigDecimal.NEGATIVE_INFINITY;

  const negative = this.significand < 0n;
  const t = this.abs();
  const targetPrec = BigDecimal.precision;
  const e = decimalExponent(this);

  // asinh(x) = x − x³/6 + …: tiny x rounds to x.
  if (e < 0 && -2 * e >= targetPrec + 4) return this.toPrecision(targetPrec);

  const compute = (): BigDecimal =>
    t.add(t.mul(t).add(BigDecimal.ONE).sqrt()).ln();

  let result: BigDecimal;
  if (e < 0) {
    // Small x: ln(|x| + sqrt(x²+1)) = ln(1 + x + …) ≈ x near 1 — compensate.
    const saved = BigDecimal.precision;
    BigDecimal.precision = targetPrec - e + 5;
    try {
      result = compute().toPrecision(targetPrec);
    } finally {
      BigDecimal.precision = saved;
    }
  } else {
    result = compute();
  }
  return negative ? result.neg() : result;
};

// ---------- acosh ----------

BigDecimal.prototype.acosh = function (): BigDecimal {
  // acosh(x) = 2·asinh(sqrt((x−1)/2)) for x ≥ 1. This form is stable near x = 1
  // (the naive ln(x + sqrt(x²−1)) loses precision there); asinh supplies its
  // own small/large-argument handling.
  if (this.isNaN()) return BigDecimal.NAN;
  if (!this.isFinite())
    return this.significand > 0n
      ? BigDecimal.POSITIVE_INFINITY
      : BigDecimal.NAN;

  // Domain: x ≥ 1.
  if (this.lt(BigDecimal.ONE)) return BigDecimal.NAN;
  if (this.eq(1)) return BigDecimal.ZERO;

  const t = this.sub(BigDecimal.ONE).div(BigDecimal.TWO).sqrt();
  return BigDecimal.TWO.mul(t.asinh());
};

// ---------- atanh ----------

BigDecimal.prototype.atanh = function (): BigDecimal {
  // atanh(x) = ½·ln((1+x)/(1−x)) for |x| < 1.
  if (this.isNaN()) return BigDecimal.NAN;
  if (!this.isFinite()) return BigDecimal.NAN; // |±∞| > 1
  if (this.isZero()) return BigDecimal.ZERO;

  const abs = this.abs();
  if (abs.eq(1))
    return this.significand > 0n
      ? BigDecimal.POSITIVE_INFINITY
      : BigDecimal.NEGATIVE_INFINITY;
  if (abs.gt(BigDecimal.ONE)) return BigDecimal.NAN;

  const targetPrec = BigDecimal.precision;
  const e = decimalExponent(this); // < 0 since |x| < 1

  // atanh(x) = x + x³/3 + …: tiny x rounds to x.
  if (-2 * e >= targetPrec + 4) return this.toPrecision(targetPrec);

  // ln((1+x)/(1−x)) ≈ 2x near 1 for small x — compensate the cancellation.
  const saved = BigDecimal.precision;
  BigDecimal.precision = targetPrec - e + 5;
  try {
    const ratio = BigDecimal.ONE.add(this).div(BigDecimal.ONE.sub(this));
    return ratio.ln().div(BigDecimal.TWO).toPrecision(targetPrec);
  } finally {
    BigDecimal.precision = saved;
  }
};

// ---------- nthRoot ----------

BigDecimal.prototype.nthRoot = function (n: number): BigDecimal {
  // x^(1/n) for integer n. Negative x is allowed when n is odd.
  if (this.isNaN() || !Number.isInteger(n) || n === 0) return BigDecimal.NAN;
  if (n === 1) return this;
  if (n === 2) return this.sqrt();
  if (n === 3) return this.cbrt();
  if (n < 0) return this.nthRoot(-n).inv();

  // n ≥ 4 (positive integer)
  if (this.isZero()) return BigDecimal.ZERO;
  if (!this.isFinite()) {
    if (this.significand > 0n) return BigDecimal.POSITIVE_INFINITY;
    return n % 2 === 0 ? BigDecimal.NAN : BigDecimal.NEGATIVE_INFINITY;
  }
  if (this.significand < 0n) {
    if (n % 2 === 0) return BigDecimal.NAN; // even root of a negative
    return this.neg().nthRoot(n).neg();
  }

  // Positive base: x^(1/n) = exp(ln(x)/n), with a few guard digits.
  const targetPrec = BigDecimal.precision;
  const saved = BigDecimal.precision;
  BigDecimal.precision = targetPrec + 8;
  try {
    const r = BigDecimal.exp(this.ln().div(new BigDecimal(n)));
    return r.toPrecision(targetPrec);
  } finally {
    BigDecimal.precision = saved;
  }
};

// ---------- Static methods: asinh, acosh, atanh, expm1, log1p, nthRoot ----------

(BigDecimal as unknown as { asinh: (x: BigDecimal) => BigDecimal }).asinh =
  function (x: BigDecimal): BigDecimal {
    return x.asinh();
  };

(BigDecimal as unknown as { acosh: (x: BigDecimal) => BigDecimal }).acosh =
  function (x: BigDecimal): BigDecimal {
    return x.acosh();
  };

(BigDecimal as unknown as { atanh: (x: BigDecimal) => BigDecimal }).atanh =
  function (x: BigDecimal): BigDecimal {
    return x.atanh();
  };

(BigDecimal as unknown as { expm1: (x: BigDecimal) => BigDecimal }).expm1 =
  function (x: BigDecimal): BigDecimal {
    return x.expm1();
  };

(BigDecimal as unknown as { log1p: (x: BigDecimal) => BigDecimal }).log1p =
  function (x: BigDecimal): BigDecimal {
    return x.log1p();
  };

(
  BigDecimal as unknown as {
    nthRoot: (x: BigDecimal, n: number) => BigDecimal;
  }
).nthRoot = function (x: BigDecimal, n: number): BigDecimal {
  return x.nthRoot(n);
};

// ---------- Internal helpers ----------

/**
 * Bit-based seed for cbrt: approximate the integer cube root of `C`
 * (= fp · scale², the Newton target) when Number(C) overflows to Infinity.
 *
 * Extract the top ~51 bits of C, compute cbrt in float64, then scale the
 * result back by 2^(shift/3).
 */
function cbrtSeed(C: bigint): bigint {
  const bl = bitLength(C);
  if (bl <= 1023) {
    const s = Math.cbrt(Number(C));
    if (Number.isFinite(s) && s >= 1) return BigInt(Math.floor(s));
  }
  // C ≈ lead · 2^shift with lead ~51-bit. cbrt(C) ≈ cbrt(lead) · 2^(shift/3).
  const shift = bl - 51; // > 0 here
  const lead = Number(C >> BigInt(shift));
  let fs = Math.cbrt(lead);
  const third = Math.floor(shift / 3);
  const remainder = shift % 3;
  if (remainder === 1) fs *= 1.2599210498948732; // 2^(1/3)
  if (remainder === 2) fs *= 1.5874010519681994; // 2^(2/3)
  const seed = BigInt(Math.round(fs)) << BigInt(third);
  return seed > 0n ? seed : 1n;
}
