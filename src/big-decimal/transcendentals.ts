/**
 * Transcendental / irrational operations for BigDecimal.
 *
 * This module attaches `sqrt()` and `cbrt()` to BigDecimal.prototype
 * via declaration merging. It is imported for side effects in index.ts.
 */

import { BigDecimal, fromRaw } from './big-decimal';
import {
  bigintAbs,
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
  }

  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace BigDecimal {
    function sqrt(x: BigDecimal): BigDecimal;
    function cbrt(x: BigDecimal): BigDecimal;
    function exp(x: BigDecimal): BigDecimal;
    function ln(x: BigDecimal): BigDecimal;
    function log10(x: BigDecimal): BigDecimal;
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
  }
}

// ---------- Helpers: BigDecimal <-> fixed-point ----------

/**
 * Convert a BigDecimal to a fixed-point bigint at the given precision.
 *
 * Returns [fp, scale] where fp/scale represents the same value.
 * `precision` is the number of significant decimal digits in the
 * fixed-point representation.
 */
function toFixedPoint(x: BigDecimal, precision: number): [bigint, bigint] {
  const scale = pow10(precision);
  // value = significand * 10^exponent
  // fixed-point = value * scale = significand * 10^(exponent + precision)
  const exp = x.exponent + precision;
  if (exp >= 0) {
    return [x.significand * pow10(exp), scale];
  }
  // exp < 0: shift right (loses digits beyond the precision window)
  return [x.significand / pow10(-exp), scale];
}

/**
 * Convert a fixed-point bigint back to a BigDecimal, rounding to
 * `targetPrecision` significant digits.
 *
 * `fp / scale` is the value; we express it as a BigDecimal.
 */
function fromFixedPoint(
  fp: bigint,
  scale: bigint,
  targetPrecision: number
): BigDecimal {
  if (fp === 0n) return BigDecimal.ZERO;

  const negative = fp < 0n;
  let absFp = negative ? -fp : fp;

  // Determine how many digits absFp has
  const fpDigits = bigintDigits(absFp);

  // We want targetPrecision significant digits.
  // The value is absFp / scale = absFp * 10^(-scaleDigits + 1)
  // where scaleDigits is the number of digits of scale.
  //
  // Strategy: round absFp to targetPrecision significant digits,
  // then compute the exponent.

  if (fpDigits > targetPrecision) {
    // Need to round: remove (fpDigits - targetPrecision) trailing digits
    const drop = fpDigits - targetPrecision;
    const divisor = pow10(drop);
    const half = divisor / 2n;
    const remainder = absFp % divisor;
    absFp = absFp / divisor;
    if (remainder >= half) absFp += 1n;

    // The value is now absFp * 10^drop / scale
    // = absFp * 10^(drop - scaleExp)
    // where scale = 10^scaleExp
    const scaleExp = bigintDigits(scale) - 1; // 10^N has N+1 digits, so exponent = N
    const resultExp = drop - scaleExp;

    const sig = negative ? -absFp : absFp;
    return fromRaw(sig, resultExp);
  }

  // fpDigits <= targetPrecision: no rounding needed
  const scaleExp = bigintDigits(scale) - 1;
  const resultExp = -scaleExp;

  const sig = negative ? -absFp : absFp;
  return fromRaw(sig, resultExp);
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

  const [fp, scale] = toFixedPoint(this, workingPrec);

  // Compute fixed-point sqrt
  const sqrtFp = fpsqrt(fp, scale);

  return fromFixedPoint(sqrtFp, scale, targetPrec);
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

  const [fp, scale] = toFixedPoint(this, workingPrec);

  // Newton iteration for cube root in fixed-point:
  // We want cbrt(v) where v = fp / scale.
  // Let y = cbrt(v) * scale (the fixed-point result).
  // Then y^3 = v^3 * scale^3 = (fp/scale)^3 * scale^3 = fp^3 * scale^0... no.
  //
  // Better approach: work with the recurrence directly.
  // x_{n+1} = (2 * x + fp * scale^2 / x^2) / 3
  //
  // where x represents cbrt(fp/scale) * scale.
  // Derivation:
  //   We want y such that y/scale = cbrt(fp/scale)
  //   i.e., y^3 = fp * scale^2  (since (y/scale)^3 = fp/scale → y^3 = fp * scale^2)
  //
  //   Newton on f(y) = y^3 - fp*scale^2:
  //   y_{n+1} = y - f(y)/f'(y) = y - (y^3 - C) / (3*y^2)
  //           = (2*y + C / y^2) / 3
  //   where C = fp * scale^2

  const C = fp * scale * scale;

  // Seed from floating-point approximation
  let x: bigint;
  const numVal = this.toNumber();
  const scaleNum = Number(scale);
  if (Number.isFinite(numVal) && numVal > 0 && Number.isFinite(scaleNum)) {
    const approx = Math.cbrt(numVal);
    if (Number.isFinite(approx) && approx > 0) {
      // Convert to fixed-point
      x = BigInt(Math.floor(approx * scaleNum));
      if (x === 0n) x = 1n;
    } else {
      x = cbrtSeed(fp, scale);
    }
  } else {
    x = cbrtSeed(fp, scale);
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

  return fromFixedPoint(x, scale, targetPrec);
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

  // Working precision with guard digits
  const targetPrec = BigDecimal.precision;
  const workingPrec = targetPrec + 15;

  const [fp, scale] = toFixedPoint(this, workingPrec);

  // Compute fixed-point exp
  const expFp = fpexp(fp, scale);

  return fromFixedPoint(expFp, scale, targetPrec);
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

  // Working precision with guard digits
  const targetPrec = BigDecimal.precision;
  const workingPrec = targetPrec + 15;

  const [fp, scale] = toFixedPoint(this, workingPrec);

  // Compute fixed-point ln
  const lnFp = fpln(fp, scale);

  return fromFixedPoint(lnFp, scale, targetPrec);
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

// ---------- sin ----------

BigDecimal.prototype.sin = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;
  if (!this.isFinite()) return BigDecimal.NAN; // sin(±Inf) = NaN
  if (this.isZero()) return BigDecimal.ZERO;

  const targetPrec = BigDecimal.precision;
  const workingPrec = targetPrec + 15;

  const [fp, scale] = toFixedPoint(this, workingPrec);
  const [sinFp] = fpsincos(fp, scale);
  return fromFixedPoint(sinFp, scale, targetPrec);
};

// ---------- cos ----------

BigDecimal.prototype.cos = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;
  if (!this.isFinite()) return BigDecimal.NAN; // cos(±Inf) = NaN
  if (this.isZero()) return BigDecimal.ONE;

  const targetPrec = BigDecimal.precision;
  const workingPrec = targetPrec + 15;

  const [fp, scale] = toFixedPoint(this, workingPrec);
  const [, cosFp] = fpsincos(fp, scale);
  return fromFixedPoint(cosFp, scale, targetPrec);
};

// ---------- tan ----------

BigDecimal.prototype.tan = function (): BigDecimal {
  // Special cases
  if (this.isNaN()) return BigDecimal.NAN;
  if (!this.isFinite()) return BigDecimal.NAN; // tan(±Inf) = NaN
  if (this.isZero()) return BigDecimal.ZERO;

  const targetPrec = BigDecimal.precision;
  const workingPrec = targetPrec + 15;

  const [fp, scale] = toFixedPoint(this, workingPrec);
  const [sinFp, cosFp] = fpsincos(fp, scale);

  // tan = sin / cos
  if (cosFp === 0n) {
    // cos = 0 means we're at π/2 + nπ → tan is ±Infinity
    return sinFp > 0n
      ? BigDecimal.POSITIVE_INFINITY
      : BigDecimal.NEGATIVE_INFINITY;
  }

  // Fixed-point division: (sinFp * scale) / cosFp
  const tanFp = (sinFp * scale) / cosFp;
  return fromFixedPoint(tanFp, scale, targetPrec);
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
  const workingPrec = targetPrec + 15;

  const [fp, scale] = toFixedPoint(this, workingPrec);
  const atanFp = fpatan(fp, scale);
  return fromFixedPoint(atanFp, scale, targetPrec);
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

  // asin(x) = atan(x / sqrt(1 - x²))
  // Compute entirely in fixed-point to avoid precision loss from chaining
  // BigDecimal operations at user-visible precision.
  const targetPrec = BigDecimal.precision;
  const workingPrec = targetPrec + 20;

  const [xFp, scale] = toFixedPoint(this, workingPrec);

  // x² in fixed-point
  const x2 = fpmul(xFp, xFp, scale);

  // 1 - x² in fixed-point
  const oneMinusX2 = scale - x2;

  // sqrt(1 - x²) in fixed-point
  const sqrtVal = fpsqrt(oneMinusX2, scale);

  // x / sqrt(1 - x²) in fixed-point
  const ratio = fpdiv(xFp, sqrtVal, scale);

  // atan(ratio) in fixed-point
  const result = fpatan(ratio, scale);

  return fromFixedPoint(result, scale, targetPrec);
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

// ---------- Internal helpers ----------

/**
 * Digit-based seed for cbrt when Number(scale) overflows to Infinity.
 *
 * We want cbrt(fp/scale) * scale = cbrt(fp * scale²).
 * Extract ~15 leading digits from fp and scale, compute in float64,
 * then scale back to the correct magnitude.
 */
function cbrtSeed(fp: bigint, scale: bigint): bigint {
  const LEAD = 15;

  const digFp = bigintDigits(fp);
  const shiftFp = Math.max(0, digFp - LEAD);
  const leadFp = Number(shiftFp > 0 ? fp / pow10(shiftFp) : fp);

  const digS = bigintDigits(scale);
  const shiftS = Math.max(0, digS - LEAD);
  const leadS = Number(shiftS > 0 ? scale / pow10(shiftS) : scale);

  // cbrt(fp * scale²) ≈ cbrt(leadFp * leadS²) * 10^((shiftFp + 2·shiftS) / 3)
  const totalShift = shiftFp + 2 * shiftS;
  const thirdShift = Math.floor(totalShift / 3);
  const remainder = totalShift % 3;

  let floatSeed = Math.cbrt(leadFp * leadS * leadS);
  if (remainder === 1) floatSeed *= 2.154434690031882; // cbrt(10)
  if (remainder === 2) floatSeed *= 4.641588833612779; // cbrt(100)

  const seed = BigInt(Math.round(floatSeed)) * pow10(thirdShift);
  return seed > 0n ? seed : 1n;
}
