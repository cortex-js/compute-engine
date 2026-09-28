import { Complex } from 'complex-esm';
import './complex-esm-augment.js'; // adds the 1-arg `Complex.equals` overload
import { bernoulliRational } from './bernoulli.js';

// Lanczos approximation coefficients (g = 7, n = 9), accurate to ~15 digits
// for the principal branch. See Numerical Recipes / mathjs gamma().
const LANCZOS_G = 7;
const LANCZOS_P = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/**
 * `x · 2^k` for an integer `k` of any size. The factor is applied in steps,
 * because `2^k` is a double only for `-1074 <= k <= 1023`. Each step is
 * exact while the result stays in the normal range of a double.
 */
function scaleByPowerOfTwo(x: number, k: number): number {
  while (k > 1023) {
    x *= 2 ** 1023;
    k -= 1023;
  }
  while (k < -1022) {
    x *= 2 ** -1022;
    k += 1022;
  }
  return x * 2 ** k;
}

/**
 * The binary exponent of the larger magnitude of `x` and `y`, approximately:
 * `max(|x|, |y|)` divided by `2^k` is near 1. It is `0` when both are zero,
 * or when one is not finite, so that no scaling occurs.
 */
function pairExponent(x: number, y: number): number {
  const m = Math.max(Math.abs(x), Math.abs(y));
  if (m === 0 || !Number.isFinite(m)) return 0;
  return Math.floor(Math.log2(m));
}

/**
 * The quotient `(ar + ai·i) / (br + bi·i)` for a divisor that is not zero,
 * computed so that no intermediate value overflows or underflows when the
 * quotient itself is in the range of a double.
 *
 * The usual formulas fail at the ends of the double range. The textbook
 * formula `(a·conj(b)) / |b|²` squares the parts of the divisor, so
 * `1 / (1e308 + 1e308·i)` gives `0` (the square overflows to `∞`) and
 * `1 / (1e-200 + 1e-200·i)` gives `∞` (the square underflows to `0`).
 * Smith's formula divides by the larger part of the divisor first and forms
 * no square, but it still forms `d·(d/c) + c` and `a + b·(d/c)` without
 * scaling, which overflow for `(1e308 + 1e308·i) / (1 + i)`.
 *
 * The algorithm (Smith's formula with power-of-two scaling, in the manner of
 * Baudin and Smith, "A Robust Complex Division in Scilab", 2012): the
 * dividend is divided by `2^ka` and the divisor by `2^kb`, where `ka` and
 * `kb` are the binary exponents of their larger parts, so that the parts of
 * both are near 1 or smaller. Smith's formula then divides the scaled values,
 * and the quotient is multiplied by `2^(ka − kb)` at the end, so it
 * overflows only when the true quotient is outside the range of a double.
 *
 * A multiplication by a power of two is exact in the normal range, so when
 * Smith's formula on the unscaled operands keeps all its values in the
 * normal range, the result is the same, bit for bit, as the unscaled Smith
 * formula (the one `Complex.div()` of `complex-esm` uses). A part of the
 * quotient that is exactly zero stays zero, also when the other part
 * overflows.
 *
 * A dividend with an infinite part is not scaled; the result then has the
 * infinite and NaN parts that Smith's formula gives.
 *
 * Known limit, shared with the unscaled `Complex.div()`: the two parts of an
 * operand are scaled by ONE exponent (the larger one), so a part that is more
 * than about 1000 binades smaller than its partner underflows in the scaling
 * and its contribution to the quotient is lost. `(2^1000·i) / (2^100 + 2^-1000·i)`
 * has the representable real part `2^-200` and answers `0` for it, as
 * `Complex.div()` does; recovering it needs exponent-aware products. The callers handle a
 * zero, infinite or NaN operand themselves, with their own conventions.
 *
 * The compiled JavaScript target uses this function too (`_SYS.cdivedge` and
 * the complex matrix kernels in `compilation/javascript-target.ts`), so that
 * the interpreter and the compiled code give the same quotient.
 */
export function scaledComplexDivide(
  ar: number,
  ai: number,
  br: number,
  bi: number
): { re: number; im: number } {
  // A divisor with one zero part divides each part of the dividend on its
  // own: `(ar + ai·i) / br` is `ar/br + (ai/br)·i`, and
  // `(ar + ai·i) / (bi·i)` is `ai/bi − (ar/bi)·i`. No intermediate value is
  // formed, so a dividend whose parts differ by more than the double range
  // keeps both of them: `(2^700 + 2^-700·i) / i` is `2^-700 − 2^700·i`. The
  // scaling below would divide both parts by `2^700` and lose the small one
  // to underflow (found by the review of 2026-09-27).
  if (bi === 0) return { re: ar / br, im: ai / br };
  if (br === 0) return { re: ai / bi, im: -ar / bi };
  const ka = pairExponent(ar, ai);
  const kb = pairExponent(br, bi);
  const xr = scaleByPowerOfTwo(ar, -ka);
  const xi = scaleByPowerOfTwo(ai, -ka);
  const yr = scaleByPowerOfTwo(br, -kb);
  const yi = scaleByPowerOfTwo(bi, -kb);
  let re: number;
  let im: number;
  if (Math.abs(yr) >= Math.abs(yi)) {
    const r = yi / yr;
    const den = yr + yi * r;
    re = (xr + xi * r) / den;
    im = (xi - xr * r) / den;
  } else {
    const r = yr / yi;
    const den = yr * r + yi;
    re = (xr * r + xi) / den;
    im = (xi * r - xr) / den;
  }
  return {
    re: scaleByPowerOfTwo(re, ka - kb),
    im: scaleByPowerOfTwo(im, ka - kb),
  };
}

/** The smallest positive normal double, `2^-1022`. */
const MIN_NORMAL_DOUBLE = 2.2250738585072014e-308;

/**
 * The quotient `(ar + ai·i) / (br + bi·i)` of FINITE parts, for a divisor
 * that is not zero, with the textbook formula `(a·conj(b)) / |b|²` when all
 * its intermediate values are normal doubles, and with
 * `scaledComplexDivide()` otherwise.
 *
 * The textbook formula is kept where it is accurate so that the quotient of
 * ordinary values does not change, bit for bit, from the formula that the
 * numeric values used before (it can differ from Smith's formula in the last
 * bit). The compiled JavaScript `Divide` (`compilation/javascript-target.ts`)
 * emits the same test, so the interpreter and the compiled code take the same
 * branch for the same operands: the textbook formula unless `|b|²` is not a
 * normal double, a numerator part is not finite, or a numerator part is
 * subnormal (not zero), because a subnormal product has lost digits.
 */
export function complexQuotient(
  ar: number,
  ai: number,
  br: number,
  bi: number
): { re: number; im: number } {
  const d = br * br + bi * bi;
  const nr = ar * br + ai * bi;
  const ni = ai * br - ar * bi;
  if (textbookQuotientIsAccurate(ar, ai, br, bi, d, nr, ni))
    return { re: nr / d, im: ni / d };
  return scaledComplexDivide(ar, ai, br, bi);
}

/**
 * True when the textbook quotient `(nr + ni·i) / d`, with `d = |b|²`,
 * `nr = Re(a·conj(b))` and `ni = Im(a·conj(b))`, has all its intermediate
 * values in the normal double range, so that neither the denominator nor a
 * numerator part has overflowed, underflowed or lost digits to the subnormal
 * range. When it is true, Smith's unscaled formula is accurate as well (its
 * intermediate values are bounded by the same operands), so a caller that
 * must keep its previous Smith result bit for bit can use it in this case.
 */
function textbookQuotientIsAccurate(
  ar: number,
  ai: number,
  br: number,
  bi: number,
  d: number,
  nr: number,
  ni: number
) {
  return (
    d >= MIN_NORMAL_DOUBLE &&
    d < Infinity &&
    Number.isFinite(nr) &&
    Number.isFinite(ni) &&
    (nr === 0 || Math.abs(nr) >= MIN_NORMAL_DOUBLE) &&
    (ni === 0 || Math.abs(ni) >= MIN_NORMAL_DOUBLE) &&
    productIsAccurate(ar, br) &&
    productIsAccurate(ai, bi) &&
    productIsAccurate(ai, br) &&
    productIsAccurate(ar, bi)
  );
}

/**
 * True when the product `x·y` of two finite doubles is either an exact zero
 * (a factor is zero) or a normal double. A product of two non-zero factors
 * that underflows to zero or to the subnormal range has lost its digits, and
 * a numerator part built from such products can read as an exact `0` although
 * the quotient is representable: `(2^-1000) / (2^-100 + 2^-100·i)` is
 * `2^-901 − 2^-901·i`, but `2^-1000 · 2^-100` rounds to `0`, so the sum
 * `nr = ar·br + ai·bi` is `0` and the test on `nr` alone accepted the
 * textbook formula (found by the review of 2026-09-27).
 */
function productIsAccurate(x: number, y: number): boolean {
  if (x === 0 || y === 0) return true;
  const p = Math.abs(x * y);
  return p >= MIN_NORMAL_DOUBLE && p < Infinity;
}

/**
 * `a / b` for `complex-esm` values, a drop-in replacement for `a.div(b)`
 * that does not overflow or underflow when the quotient is in the range of a
 * double. An ordinary quotient is `a.div(z)` itself, and only an out-of-range
 * one pays for the scaling (see `scaledComplexDivide()`).
 *
 * A zero, infinite or NaN operand, and a real divisor (whose quotient
 * `a.div()` computes part by part, without an intermediate value), are left
 * to `a.div(b)`, so their results do not change: `x / 0` is the unsigned
 * infinity `Complex.INFINITY`, `0 / 0` is `NaN`, `x / ∞` is `0`.
 */
export function complexDivide(a: Complex, b: Complex | number): Complex {
  const z = typeof b === 'number' ? new Complex(b, 0) : b;
  if (
    z.im === 0 ||
    z.isZero() ||
    a.isZero() ||
    !Number.isFinite(a.re) ||
    !Number.isFinite(a.im) ||
    !Number.isFinite(z.re) ||
    !Number.isFinite(z.im)
  )
    return a.div(z);
  // The ordinary case keeps `a.div(z)`, Smith's unscaled formula, so that the
  // call sites that used it before (the complex matrix field, the polynomial
  // root finder, `Rational`) get the same quotient bit for bit; only an
  // operand pair whose textbook intermediates leave the normal range takes
  // the scaled route.
  const d = z.re * z.re + z.im * z.im;
  const nr = a.re * z.re + a.im * z.im;
  const ni = a.im * z.re - a.re * z.im;
  if (textbookQuotientIsAccurate(a.re, a.im, z.re, z.im, d, nr, ni))
    return a.div(z);
  const q = scaledComplexDivide(a.re, a.im, z.re, z.im);
  return new Complex(q.re, q.im);
}

/**
 * `1 / z` for a `complex-esm` value, a drop-in replacement for
 * `z.inverse()`. `z.inverse()` computes `conj(z) / |z|²`, whose `|z|²`
 * overflows for `z = 1e308 + 1e308·i` (the result is `0` instead of
 * `5e-309 − 5e-309·i`) and underflows for `z = 1e-200 + 1e-200·i` (the
 * result is infinite instead of `5e199 − 5e199·i`). This function uses
 * `complexQuotient()`. A zero, infinite or NaN value is left to
 * `z.inverse()`, so its result does not change.
 */
export function complexInverse(z: Complex): Complex {
  if (z.isZero() || !Number.isFinite(z.re) || !Number.isFinite(z.im))
    return z.inverse();
  const q = complexQuotient(1, 0, z.re, z.im);
  return new Complex(q.re, q.im);
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const HALF_LOG_2PI = 0.5 * Math.log(2 * Math.PI);

/**
 * Gamma function for a complex argument, via the Lanczos approximation.
 *
 * Uses the reflection formula Γ(z)·Γ(1−z) = π / sin(πz) for Re(z) < 0.5 so the
 * series converges on the whole complex plane (except at the non-positive
 * integer poles, where the result is a (signed) infinity / NaN).
 */
export function gamma(c: Complex): Complex {
  if (c.re < 0.5) {
    // Γ(z) = π / (sin(πz) · Γ(1 − z))
    const sinPiZ = c.mul(Math.PI).sin();
    return new Complex(Math.PI, 0).div(
      sinPiZ.mul(gamma(new Complex(1, 0).sub(c)))
    );
  }

  const z = c.sub(1);
  let x = new Complex(LANCZOS_P[0], 0);
  for (let i = 1; i < LANCZOS_G + 2; i++)
    x = x.add(new Complex(LANCZOS_P[i], 0).div(z.add(i)));

  const t = z.add(LANCZOS_G + 0.5);

  // √(2π) · t^(z + 0.5) · e^(−t) · x
  return new Complex(SQRT_2PI, 0)
    .mul(t.pow(z.add(0.5)))
    .mul(t.neg().exp())
    .mul(x);
}

/**
 * Natural logarithm of the Gamma function for a complex argument (principal
 * branch), via the Lanczos approximation.
 */
export function gammaln(c: Complex): Complex {
  if (c.re < 0.5) {
    // log Γ(z) = log(π / sin(πz)) − log Γ(1 − z)
    const sinPiZ = c.mul(Math.PI).sin();
    return new Complex(Math.PI, 0)
      .div(sinPiZ)
      .log()
      .sub(gammaln(new Complex(1, 0).sub(c)));
  }

  const z = c.sub(1);
  let x = new Complex(LANCZOS_P[0], 0);
  for (let i = 1; i < LANCZOS_G + 2; i++)
    x = x.add(new Complex(LANCZOS_P[i], 0).div(z.add(i)));

  const t = z.add(LANCZOS_G + 0.5);

  // 0.5·log(2π) + (z + 0.5)·log(t) − t + log(x)
  return new Complex(HALF_LOG_2PI, 0)
    .add(z.add(0.5).mul(t.log()))
    .sub(t)
    .add(x.log());
}

const C_NAN = new Complex(NaN, NaN);
const C_ONE = new Complex(1, 0);
const C_ZERO = new Complex(0, 0);

const EULER_GAMMA = 0.5772156649015329;

//
// ---------------- Upper incomplete gamma Γ(s, z) (complex) ----------------
//
// Γ(s, z) = ∫_z^∞ t^{s−1} e^{−t} dt, analytically continued over the complex
// plane (principal branch of z^s). Mirrors the machine-real kernels in
// numerics/special-functions.ts; this is the workhorse — the real kernel
// returns NaN for z < 0 (a complex result) and applyN cascades here.
//

/** E₁(z) = Γ(0, z) for complex z ≠ 0 (principal branch). Entire series
 *  (times −ln z) for modest |z|; Legendre continued fraction for large
 *  Re(z) > 0. */
function e1Complex(z: Complex): Complex {
  if (z.abs() < 20 || z.re <= 0) {
    // E₁(z) = −γ − ln z − Σ_{k≥1} (−z)^k/(k·k!)
    let sum = C_ZERO;
    let term = C_ONE; // (−z)^k/k!
    for (let k = 1; k < 500; k++) {
      term = term.mul(z.neg()).div(k);
      const add = term.div(-k);
      sum = sum.add(add);
      if (add.abs() < 1e-18 * (1 + sum.abs())) break;
    }
    return new Complex(-EULER_GAMMA, 0).sub(z.log()).add(sum);
  }
  // E₁(z) = e^{−z}·CF,  CF = 1/(z+1 − 1²/(z+3 − 2²/(z+5 − …)))  (Lentz)
  const tiny = new Complex(1e-300, 0);
  let b = z.add(1);
  let c = C_ONE.div(tiny);
  let d = C_ONE.div(b);
  let h = d;
  for (let i = 1; i < 500; i++) {
    const a = -i * i;
    b = b.add(2);
    d = d.mul(a).add(b);
    if (d.abs() < 1e-300) d = tiny;
    c = b.add(c.inverse().mul(a));
    if (c.abs() < 1e-300) c = tiny;
    d = d.inverse();
    const del = d.mul(c);
    h = h.mul(del);
    if (del.sub(C_ONE).abs() < 1e-16) break;
  }
  return h.mul(z.neg().exp());
}

/** Lower incomplete gamma γ(s, z), complex (Tricomi series, s not a
 *  non-positive integer). */
function lowerGammaSeriesComplex(s: Complex, z: Complex): Complex {
  let term = C_ONE.div(s); // k = 0 term
  let sum = term;
  for (let k = 1; k < 2000; k++) {
    term = term.mul(z).div(s.add(k));
    sum = sum.add(term);
    if (term.abs() < 1e-17 * sum.abs()) break;
  }
  return z.pow(s).mul(z.neg().exp()).mul(sum);
}

/** Upper incomplete gamma Γ(s, z), complex, via the divergent asymptotic
 *  series Γ(s,z) ~ z^{s−1} e^{−z} Σ_{k≥0} (s−1)(s−2)…(s−k)/z^k truncated at
 *  its smallest term. This is the only method that avoids catastrophic
 *  cancellation for large |z| with Re(z) < 0 (where the lower-series e^{−z}
 *  prefactor and the alternating sum each blow up); accuracy ≈ the smallest
 *  term, which falls with |z| relative to |s|. */
function upperGammaAsymptoticComplex(s: Complex, z: Complex): Complex {
  let term = C_ONE; // k = 0
  let sum = C_ONE;
  for (let k = 1; k < 1000; k++) {
    const next = term.mul(s.sub(k)).div(z); // term_k = term_{k−1}·(s−k)/z
    if (next.abs() > term.abs()) break; // smallest-term truncation
    term = next;
    sum = sum.add(term);
    if (term.abs() < 1e-17 * sum.abs()) break;
  }
  return z.pow(s.sub(1)).mul(z.neg().exp()).mul(sum);
}

/** Upper incomplete gamma Γ(s, z), complex, Legendre continued fraction. */
function upperGammaCFComplex(s: Complex, z: Complex): Complex {
  const tiny = new Complex(1e-300, 0);
  let b = z.add(1).sub(s); // z + 1 − s
  let c = C_ONE.div(tiny);
  let d = C_ONE.div(b);
  let h = d;
  for (let i = 1; i < 2000; i++) {
    const an = s.sub(i).mul(i); // −i·(i − s) = i·(s − i)
    b = b.add(2);
    d = an.mul(d).add(b);
    if (d.abs() < 1e-300) d = tiny;
    c = b.add(an.div(c));
    if (c.abs() < 1e-300) c = tiny;
    d = d.inverse();
    const del = d.mul(c);
    h = h.mul(del);
    if (del.sub(C_ONE).abs() < 1e-16) break;
  }
  return z.pow(s).mul(z.neg().exp()).mul(h);
}

/** Γ(s, z) for s a non-positive integer, complex z, via downward recurrence
 *  Γ(s−1,z) = (Γ(s,z) − z^{s−1} e^{−z})/(s−1) seeded by Γ(0,z) = E₁(z). */
function upperGammaNegIntComplex(sInt: number, z: Complex): Complex {
  let g = e1Complex(z); // Γ(0, z)
  const emz = z.neg().exp();
  for (let cur = 0; cur > sInt; cur--)
    g = g.sub(z.pow(cur - 1).mul(emz)).div(cur - 1);
  return g;
}

/**
 * Upper incomplete gamma Γ(s, z) for complex s and z (z ≠ 0). Region split:
 *   - |z| large            → divergent asymptotic series (any s, any arg)
 *   - s a non-positive integer → recurrence from Γ(0,z) = E₁(z)
 *   - Re(z) > 0 and |z| ≥ |s|+1 → continued fraction
 *   - otherwise                → Γ(s) − γ(s,z) (lower series, entire in z)
 *
 * Accurate to ~1e-10 across the plane EXCEPT a narrow band (Re(z) < 0, |z| ≈
 * 15–25, s a negative non-integer) where neither the cancelling lower series
 * nor the not-yet-converged asymptotic reaches full double precision — there
 * the worst case is ~2e-3 relative. Closing that band needs Temme's uniform
 * asymptotics or extended-precision summation (deferred — out of the Rubi-
 * verification regime, which mostly lands at smaller |z|).
 */
export function incompleteGammaUpperComplex(s: Complex, z: Complex): Complex {
  if (s.isNaN() || z.isNaN()) return C_NAN;
  if (z.isZero()) return gamma(s);

  const az = z.abs();
  const sAbs = s.abs();

  // Large |z| (any arg): the asymptotic series is the only cancellation-free
  // method, and it works for every s (incl. non-positive integers, where the
  // lower-series Γ(s) − γ split is invalid). The threshold keeps the smallest
  // term small relative to |s|.
  if (az > sAbs + 14 && az > 12) return upperGammaAsymptoticComplex(s, z);

  if (s.im === 0 && Number.isInteger(s.re) && s.re <= 0)
    return upperGammaNegIntComplex(s.re, z);

  // Right half-plane, moderate |z|: continued fraction (no cancellation).
  if (z.re > 0 && az >= sAbs + 1) return upperGammaCFComplex(s, z);

  // Small/moderate |z|: Γ(s) − γ(s,z) (lower Tricomi series, entire in z).
  return gamma(s).sub(lowerGammaSeriesComplex(s, z));
}

//
// ---------------- Exponential / trigonometric integrals (complex) ----------------
//
// Ei, Si and Ci for complex arguments, all built on E₁(z) = Γ(0, z) via
// `incompleteGammaUpperComplex(C_ZERO, ·)` so they inherit its region split
// (divergent asymptotic series for large |z|, E₁ series/CF otherwise). Do NOT
// call `e1Complex` directly here: its power-series branch runs for Re(z) ≤ 0 at
// any modulus and cancels catastrophically at machine precision for large |z|.
//
// Branch conventions (validated against mpmath at 25 digits, all four quadrants
// and both imaginary half-axes), with sign(0) = 0:
//   Ei(z) = −E₁(−z) + iπ·sign(Im z)                      (off the real axis)
//   Si(z) = (E₁(iz) − E₁(−iz))/(2i) + π/2, using Si(−z) = −Si(z) (odd, entire)
//           to reflect Re(z) < 0 (or Re(z) = 0, Im(z) < 0) into the right
//           half-plane.
//   Ci(z) = −(E₁(iz) + E₁(−iz))/2, plus a +iπ·sign(Im z) correction when
//           Re(z) < 0, or Re(z) = 0 and Im(z) < 0.
//
// Accuracy tracks the incomplete-Γ kernel: ≲1e-12 for small/moderate |z|,
// degrading toward ~1e-10 in the large-|z| asymptotic region.
//

/** E₁(z) = Γ(0, z), routed through the incomplete-gamma dispatcher so the
 *  large-|z| asymptotic branch is used (avoids `e1Complex`'s cancellation).
 *  On the negative real axis E₁ has a branch cut; for a real argument (which
 *  arises when z is purely imaginary) a spurious −0 imaginary part — from
 *  internal negations — would select the wrong side. Approach the cut from
 *  above (+0i), the branch that reproduces the validated Si/Ci axis values. */
function e1ViaGamma(z: Complex): Complex {
  const arg = z.im === 0 ? new Complex(z.re, 0) : z;
  return incompleteGammaUpperComplex(C_ZERO, arg);
}

/** sign of a real number, with sign(0) = 0. */
function signOf(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

/**
 * Exponential integral Ei(z) for complex z, off the real axis:
 * Ei(z) = −E₁(−z) + iπ·sign(Im z). (Real z is handled by the machine kernel
 * in numerics/special-functions.ts.)
 */
export function expIntegralEiComplex(z: Complex): Complex {
  if (z.isNaN()) return C_NAN;
  return e1ViaGamma(z.neg())
    .neg()
    .add(new Complex(0, Math.PI * signOf(z.im)));
}

/**
 * Sine integral Si(z) for complex z. Si is odd and entire, so complex
 * arguments give finite complex values.
 */
export function sinIntegralComplex(z: Complex): Complex {
  if (z.isNaN()) return C_NAN;
  // Reflect into the right half-plane (Si(−z) = −Si(z)).
  if (z.re < 0 || (z.re === 0 && z.im < 0))
    return sinIntegralComplex(z.neg()).neg();
  const iz = new Complex(-z.im, z.re); // i·z
  return e1ViaGamma(iz)
    .sub(e1ViaGamma(iz.neg()))
    .div(new Complex(0, 2)) // /(2i)
    .add(new Complex(Math.PI / 2, 0));
}

/**
 * Cosine integral Ci(z) for complex z: Ci(z) = −(E₁(iz) + E₁(−iz))/2, with a
 * +iπ·sign(Im z) correction in the left half-plane (and on the lower imaginary
 * axis). The real-argument convention (Ci(|x|) for x < 0) is handled by the
 * machine kernel; this kernel is only reached for Im(z) ≠ 0.
 */
export function cosIntegralComplex(z: Complex): Complex {
  if (z.isNaN()) return C_NAN;
  const iz = new Complex(-z.im, z.re); // i·z
  let val = e1ViaGamma(iz).add(e1ViaGamma(iz.neg())).mul(-0.5);
  if (z.re < 0 || (z.re === 0 && z.im < 0))
    val = val.add(new Complex(0, Math.PI * signOf(z.im)));
  return val;
}

/**
 * Hyperbolic sine integral Shi(z) for complex z, via Shi(z) = −i·Si(iz). Shi is
 * odd and entire, so complex arguments give finite complex values. (Real z is
 * handled by the machine kernel in numerics/special-functions.ts.)
 */
export function sinhIntegralComplex(z: Complex): Complex {
  if (z.isNaN()) return C_NAN;
  const iz = new Complex(-z.im, z.re); // i·z
  const si = sinIntegralComplex(iz);
  return new Complex(si.im, -si.re); // −i·si
}

/**
 * Hyperbolic cosine integral Chi(z) for complex z: Chi(z) = Ci(iz) − iπ/2 in
 * the right half-plane, reflected into the left half-plane with
 * Chi(z) = Chi(−z) + iπ·sign(Im z). (Real z is handled by the machine kernel,
 * which returns the real part Chi(|x|) for x < 0.)
 */
export function coshIntegralComplex(z: Complex): Complex {
  if (z.isNaN()) return C_NAN;
  if (z.re < 0 || (z.re === 0 && z.im < 0))
    return coshIntegralComplex(z.neg()).add(
      new Complex(0, Math.PI * signOf(z.im))
    );
  const iz = new Complex(-z.im, z.re); // i·z
  let ci = cosIntegralComplex(iz);
  // On the positive imaginary axis (z = i·b, b > 0), iz = −b is a negative
  // real, where cosIntegralComplex returns the real-part convention Ci(b);
  // restore the upper-branch +iπ that the Chi continuation requires.
  if (z.re === 0) ci = ci.add(new Complex(0, Math.PI));
  return ci.sub(new Complex(0, Math.PI / 2));
}

//
// ---------------- Error functions erf / erfi (complex) ----------------
//
// erf(z) = 1 − Γ(1/2, z²)/√π, built on the complex upper incomplete-gamma
// kernel `incompleteGammaUpperComplex`. The identity is valid in the right
// half-plane; erf is odd and entire, so Re(z) < 0 (and the lower imaginary
// axis) is reflected with erf(−z) = −erf(z). (Real z is handled by the
// machine kernel in numerics/special-functions.ts.)
//
// Signed-zero trap: on the imaginary axis z² lands exactly on the negative
// real axis, which is the branch cut of Γ(1/2, ·). Complex multiplication can
// give z² a −0 imaginary part there, selecting the wrong side of the cut (the
// wrong sign of erf). In the reflected right half-plane the correct approach
// is from above (+0i), so force Im(z²) = +0 when it is zero. Validated against
// mpmath (erf/erfi) to ≲1e-12 for small/moderate |z|, degrading toward ~1e-7
// in the large-|z| asymptotic region of the incomplete-gamma kernel.
//

//
// ---------------- Hurwitz / Riemann / generalized zeta (complex) --------
//
// Ported from enumeratio's hurwitz-zeta.ts (WTFPL; ported here under MIT).
// Euler-Maclaurin (DLMF 25.11.9) directly at Re(s) >= 0 or a far past its
// edge. Elsewhere a naive EM cancels heavily, so a is shifted to within 3/4
// of 1 and ζ(s, 1+h) expanded as Σ C(-s,k) hᵏ ζ(s+k), each ζ(s+k) reflected
// to Re >= 0 — nothing cancels.

/** cₖ = B₂ₖ/(2k)!, k = 1..EM_PAIRS — the Euler-Maclaurin tail coefficients. */
const EM_PAIRS = 12;
const EM_COEFF: number[] = (() => {
  const c: number[] = [0];
  let factorial = 1;
  for (let k = 1; k <= EM_PAIRS; k++) {
    factorial *= (2 * k - 1) * (2 * k);
    const [num, den] = bernoulliRational(2 * k);
    c[k] = Number(num) / Number(den) / factorial;
  }
  return c;
})();

/** Where the EM tail's direct terms have pushed a+N far enough right. */
function emEdge(s: Complex): number {
  return Math.max(12, Math.ceil(Math.abs(s.re) + Math.abs(s.im)) + 6);
}

/**
 * Raw Euler-Maclaurin for ζ(s,a): direct terms up to a base point, then the
 * tail's integral, half-term, and Bernoulli correction series. Drops the
 * (a+k) = 0 term (Wolfram's `HurwitzZeta` convention) rather than diverging
 * there — callers decide whether that term was actually a pole.
 */
function hurwitzEMComplex(s: Complex, a: Complex): Complex {
  return hurwitzEMComplexCore(s, a).value;
}

/**
 * `hurwitzEMComplex`, plus the largest term magnitude seen while summing.
 * When the terms are nowhere near the same size as the final sum, that sum
 * is a near-cancellation of larger values: double precision carries about
 * 16 significant digits per term, so a `largest` many orders above
 * `value.abs()` means most of those digits cancelled away, and the caller
 * cannot trust the low ones that are left. `polygammaComplex` is the one
 * caller that checks this (`ratio = largest / value.abs()`); every other
 * caller only wants `hurwitzEMComplex`'s plain result.
 */
function hurwitzEMComplexCore(
  s: Complex,
  a: Complex
): { value: Complex; largest: number } {
  const n = Math.max(8, Math.ceil(emEdge(s) - a.re));
  const negS = s.neg();
  let sum = C_ZERO;
  let largest = 0;
  for (let k = 0; k < n; k++) {
    const b = new Complex(a.re + k, a.im);
    if (b.re === 0 && b.im === 0) continue;
    const t = b.pow(negS);
    sum = sum.add(t);
    if (t.abs() > largest) largest = t.abs();
  }
  const z = new Complex(a.re + n, a.im);
  const zNegS = z.pow(negS);
  const t1 = z.pow(C_ONE.sub(s)).div(s.sub(1));
  const t2 = zNegS.mul(0.5);
  sum = sum.add(t1).add(t2);
  if (t1.abs() > largest) largest = t1.abs();
  if (t2.abs() > largest) largest = t2.abs();

  // Σ_{k≥1} cₖ·(s)_{2k-1}·z^{-(s+2k-1)}, rolling the Pochhammer and z-power.
  let zPow = zNegS.div(z);
  const zInv2 = z.pow(-2);
  let poch = s;
  for (let k = 1; k <= EM_PAIRS; k++) {
    const t = poch.mul(zPow).mul(EM_COEFF[k]);
    sum = sum.add(t);
    if (t.abs() > largest) largest = t.abs();
    const m = 2 * k;
    poch = poch.mul(s.add(m - 1)).mul(s.add(m));
    zPow = zPow.mul(zInv2);
  }
  return { value: sum, largest };
}

/** ζ(s): reflection left of Re(s) = 0, EM across the strip, the bare series far right. */
function riemannZetaComplex(s: Complex): Complex {
  // Trivial zero, exact: the reflection formula's sin(πs/2) factor is only
  // zero up to rounding, which callers relying on an exact 0 (e.g. the
  // polylog Crandall expansion's break condition) cannot use.
  if (s.im === 0 && s.re < 0 && Number.isInteger(s.re) && s.re % 2 === 0)
    return C_ZERO;
  if (s.re < 0) return reflectedZetaComplex(s);
  if (s.re < 16) return hurwitzEMComplex(s, C_ONE);
  const n = Math.ceil(10 ** (17 / s.re));
  let z = C_ONE;
  for (let k = 2; k <= n; k++) z = z.add(new Complex(k, 0).pow(s.neg()));
  return z;
}

/**
 * ζ(s) = 2ˢ π^(s-1) sin(πs/2) Γ(1-s) ζ(1-s), Re(s) < 0. Every factor but
 * ζ(1-s) is taken as a log and summed, so a huge Γ and sin never meet
 * outside exp.
 */
function reflectedZetaComplex(s: Complex): Complex {
  const r = new Complex(1 - s.re, -s.im);
  const log = s
    .mul(Math.LN2)
    .add(new Complex(s.re - 1, s.im).mul(Math.log(Math.PI)))
    .add(gammaln(r))
    .add(logSinComplex(s.mul(Math.PI / 2)));
  return log.exp().mul(hurwitzEMComplex(r, C_ONE));
}

/** ln sin(w), up to 2πi; stays finite for any |Im w| via e^(2iw) (|·| <= 1 above the axis). */
function logSinComplex(w: Complex): Complex {
  if (w.im < 0) {
    const c = logSinComplex(new Complex(w.re, -w.im));
    return new Complex(c.re, -c.im);
  }
  const u = new Complex(-2 * w.im, 2 * w.re).exp();
  const l = new Complex(1 - u.re, -u.im).log();
  return new Complex(w.im + l.re - Math.LN2, -w.re + l.im + Math.PI / 2);
}

/** ζ(s, 1+h) = Σₖ C(-s,k) hᵏ ζ(s+k), |h| < 1 — see `hurwitzZetaComplex`. */
function zetaNearOneComplex(s: Complex, h: Complex): Complex {
  let sum = riemannZetaComplex(s);
  let c = C_ONE;
  let hk = C_ONE;
  let largest = sum.abs();
  let small = 0;
  const cap = Math.ceil(Math.abs(s.re)) + 200;
  for (let k = 1; k < cap; k++) {
    hk = hk.mul(h);
    if (hk.re === 0 && hk.im === 0) break;
    const f = new Complex(-s.re - k + 1, -s.im);
    if (f.re === 0 && f.im === 0) {
      // s = 1-k, an integer: C(-s,k) -> 0 as ζ(s+k) -> ∞, product -> -C(-s,k-1)/k.
      // Every later term is 0 too (a Bernoulli polynomial) — the series ends here.
      return sum.add(c.mul(hk).mul(-1 / k));
    }
    c = c.mul(f).mul(1 / k);
    const t = c.mul(hk).mul(riemannZetaComplex(new Complex(s.re + k, s.im)));
    sum = sum.add(t);
    const size = t.abs();
    largest = Math.max(largest, size);
    // Two small terms in a row: ζ at a negative even integer vanishes every other term.
    if (size <= 1e-17 * largest) {
      if (++small === 2) break;
    } else small = 0;
  }
  return sum;
}

/** Past this many times `emEdge`, EM's own tail already costs no cancellation. */
const EM_BEYOND = 4;
/** How far from 1 (once shifted by an integer) a may sit for the Taylor series. */
const TAYLOR_RADIUS = 0.75;

/** Riemann zeta ζ(s) for complex s — `hurwitzZetaComplex(s, 1)`, direct (no shift needed at a = 1). */
export function zetaComplex(s: Complex): Complex {
  if (s.isNaN()) return C_NAN;
  if (s.re === 1 && s.im === 0) return C_NAN; // pole; caller special-cases it
  return riemannZetaComplex(s);
}

/**
 * Hurwitz zeta ζ(s,a) for complex s, a, matching Wolfram's `HurwitzZeta`
 * (drops the (a+k) = 0 term rather than diverging there). Callers decide
 * pole vs. finite for a non-positive integer a themselves — see
 * `library/arithmetic.ts`.
 */
export function hurwitzZetaComplex(s: Complex, a: Complex): Complex {
  if (s.isNaN() || a.isNaN()) return C_NAN;
  if (s.re === 1 && s.im === 0) return C_NAN; // pole; caller special-cases s = 1
  if (s.re >= 0 || a.re >= EM_BEYOND * emEdge(s)) return hurwitzEMComplex(s, a);
  const m = Math.floor(a.re - 0.5); // a - m has real part in [1/2, 3/2)
  const h = new Complex(a.re - m - 1, a.im);
  if (!(h.abs() <= TAYLOR_RADIUS)) return hurwitzEMComplex(s, a);
  // ζ(s,a) = ζ(s,a+1) + a^(-s): walk a to 1+h, carrying the passed-over terms.
  let z = zetaNearOneComplex(s, h);
  for (let j = 0; j < Math.abs(m); j++) {
    const br = m > 0 ? h.re + 1 + j : a.re + j;
    if (br === 0 && a.im === 0) continue;
    const t = new Complex(br, a.im).pow(s.neg());
    z = m > 0 ? z.sub(t) : z.add(t);
  }
  return z;
}

/**
 * Zeta(s,a) in Wolfram's generalized-zeta convention: identical to
 * HurwitzZeta for Re(a) > 0; for Re(a) <= 0 the finitely many terms off the
 * positive axis use ((k+a)²)^(-s/2) (real |k+a|^(-s) when k+a is real and
 * negative) instead, and the (k+a) = 0 slot is dropped without a pole — so
 * Zeta(s, a) is finite at a = 0, -1, -2, ..., unlike HurwitzZeta.
 */
export function zetaGeneralizedComplex(s: Complex, a: Complex): Complex {
  if (s.isNaN() || a.isNaN()) return C_NAN;
  const negHalfS = s.mul(-0.5);
  let acc = C_ZERO;
  let cur = new Complex(a.re, a.im);
  while (cur.re < 0) {
    acc = acc.add(cur.mul(cur).pow(negHalfS));
    cur = new Complex(cur.re + 1, cur.im);
  }
  if (cur.re === 0 && cur.im === 0) cur = C_ONE; // drop (k+a) = 0 — no pole here
  return acc.add(hurwitzZetaComplex(s, cur));
}

//
// ---------------- Digamma / polygamma (complex) --------------------------
//
// cortex-js/compute-engine#340: PolyGamma(m, z) at a complex z. The native
// `PolyGamma` already covers every real z at every integer order m >= 0
// (`special-functions.ts`); this widens it to a complex z, reusing
// `hurwitzZetaComplex` above for m >= 1 via DLMF 5.15.2,
// ψ⁽ᵐ⁾(z) = (−1)^(m+1) m! ζ(m+1, z). ζ(1, z) is itself the pole ψ(z) sits
// at, so m = 0 (the digamma) has no such form and gets its own asymptotic
// series below.

/** B₂ₖ/(2k), k = 1..14 — the digamma asymptotic tail coefficients. */
const DIGAMMA_COEFF: number[] = (() => {
  const c: number[] = [0];
  for (let k = 1; k <= 14; k++) {
    const [num, den] = bernoulliRational(2 * k);
    c[k] = Number(num) / Number(den) / (2 * k);
  }
  return c;
})();

/** Shift z into Re(z) >= this before the asymptotic series, where the
 * 14-term Bernoulli tail below reaches full double precision. */
const DIGAMMA_SHIFT = 18;

/**
 * ψ(z), analytically continued to complex z: the derivative of `gammaln`'s
 * Stirling series, ψ(w) ~ ln w − 1/(2w) − Σ_{k>=1} B₂ₖ/(2k) w^(−2k) for
 * Re(w) large, reached from any z by the recurrence
 * ψ(z) = ψ(z+n) − Σ_{k<n} 1/(z+k). Non-finite at the poles 0, −1, −2, ...
 */
function digammaComplex(z: Complex): Complex {
  if (z.isNaN()) return C_NAN;
  if (z.im === 0 && z.re <= 0 && Number.isInteger(z.re)) return C_NAN; // pole; caller decides finite vs. ~oo
  const n = Math.max(0, Math.ceil(DIGAMMA_SHIFT - z.re));
  let shift = C_ZERO;
  for (let k = 0; k < n; k++) shift = shift.add(C_ONE.div(z.add(k)));
  const w = z.add(n);
  let r = w.log().sub(C_ONE.div(w).mul(0.5)); // ln w − 1/(2w)
  const w2 = w.mul(w);
  let p = w2; // w^(2k)
  for (let k = 1; k < DIGAMMA_COEFF.length; k++) {
    r = r.sub(new Complex(DIGAMMA_COEFF[k], 0).div(p));
    p = p.mul(w2);
  }
  return r.sub(shift);
}

/** m! for a small integer m >= 0; non-finite past m ~ 170, same as the
 * native real `polygamma` kernel — the caller treats that the same way. */
function factorialSmall(m: number): number {
  let f = 1;
  for (let k = 2; k <= m; k++) f *= k;
  return f;
}

/**
 * ψ⁽ᵐ⁾(z) for a complex z and integer order m >= 0, matching mpmath's
 * `polygamma`/Wolfram's `PolyGamma` (poles at the non-positive integers).
 * Callers keep a real non-positive-integer z symbolic themselves — see
 * `polygammaValueAtExceptionalPoint` in `library/arithmetic.ts` — so this is
 * only reached off that axis, where `hurwitzZetaComplex`'s pole-dropping
 * convention never applies.
 */
/**
 * Past this ratio of the largest term the Euler-Maclaurin sum added to its
 * own result's magnitude, the result is not trusted (see `polygammaComplex`).
 * A random 800-point oracle grid (m in {0,1,2,3,5,8}, |z| up to 50) put the
 * lowest ratio on a wrong (> 1e-12 relative) answer at ~187 and the highest
 * ratio on a correct one at ~4787 — the two overlap, so no ratio threshold
 * separates them exactly. 100 sits under every observed failure with room
 * to spare, at the cost of declining some answers (ratio up to ~4787) that
 * were in fact accurate.
 */
const POLYGAMMA_CANCELLATION_LIMIT = 100;

export function polygammaComplex(m: number, z: Complex | number): Complex {
  const c = typeof z === 'number' ? new Complex(z, 0) : z;
  if (!Number.isInteger(m) || m < 0 || c.isNaN()) return C_NAN;
  if (m === 0) return digammaComplex(c);
  const sign = m % 2 === 0 ? -1 : 1; // (−1)^(m+1)
  // ψ⁽ᵐ⁾(z) = (−1)^(m+1) m! ζ(m+1, z) (DLMF 5.15.2), s = m+1 >= 1 always takes
  // the direct Euler-Maclaurin branch of `hurwitzZetaComplex` (its `s.re >= 0`
  // case) — call that branch directly so the cancellation ratio is available.
  const { value, largest } = hurwitzEMComplexCore(new Complex(m + 1, 0), c);
  const size = value.abs();
  if (size > 0 && largest / size > POLYGAMMA_CANCELLATION_LIMIT) return C_NAN;
  return value.mul(sign * factorialSmall(m));
}

const SQRT_PI = Math.sqrt(Math.PI);

/** Gauss error function erf(z) for complex z. */
export function erfComplex(z: Complex): Complex {
  if (z.isNaN()) return C_NAN;
  // Reflect into the right half-plane (erf is odd and entire).
  if (z.re < 0 || (z.re === 0 && z.im < 0)) return erfComplex(z.neg()).neg();
  let zsq = z.mul(z);
  // Approach the Γ(1/2, ·) branch cut on the negative real axis from above.
  if (zsq.im === 0) zsq = new Complex(zsq.re, 0);
  const g = incompleteGammaUpperComplex(new Complex(0.5, 0), zsq);
  return C_ONE.sub(g.div(new Complex(SQRT_PI, 0)));
}

/** Imaginary error function erfi(z) = −i·erf(i·z) for complex z. */
export function erfiComplex(z: Complex): Complex {
  if (z.isNaN()) return C_NAN;
  const iz = new Complex(-z.im, z.re); // i·z
  const e = erfComplex(iz);
  return new Complex(e.im, -e.re); // −i·e
}

//
// ---------------- Polylogarithm Liₙ(z), integer order n ≥ 2 (complex) ----
//
// Liₙ(z) = Σ_{k≥1} zᵏ/kⁿ, analytically continued over the whole plane with
// Liₙ(z) = Σ_{k≥1} zᵏ/kⁿ, analytically continued over the whole plane with
// the standard branch cut along z ∈ (1, ∞) (mpmath's convention: the value
// on the cut matches the limit from below, Im < 0). Three bands, mirroring
// mpmath's `polylog`:
//   - |z| ≤ 1/2                 → direct power series
//   - 1/2 < |z| ≤ 1             → ln-expansion about z = 1 (Crandall), valid
//                                 while |ln z| < 2π (always true on |z| ≤ 1)
//   - |z| > 1                   → inversion to Liₙ(1/z) with a Bernoulli-
//                                 polynomial term (below)
// Non-integer order and order < 2 are out of scope (return NaN → the caller
// keeps the expression symbolic).
//

/** kᵗʰ Bernoulli number Bₖ as a machine float (k small). */
function bernoulliFloat(k: number): number {
  const [num, den] = bernoulliRational(k);
  return Number(num) / Number(den);
}

/** Binomial coefficient C(n, k) for small non-negative integers. */
function binomialInt(n: number, k: number): number {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

/** Bernoulli polynomial Bₙ(x) = Σ_{k=0}^n C(n,k) Bₖ x^{n−k}, complex x. */
function bernoulliPolyComplex(n: number, x: Complex): Complex {
  let result = C_ZERO;
  for (let k = 0; k <= n; k++)
    result = result.add(
      x.pow(n - k).mul(binomialInt(n, k) * bernoulliFloat(k))
    );
  return result;
}

/** Direct series Liₙ(z) = Σ_{k≥1} zᵏ/kⁿ (|z| ≲ 1/2). */
function polylogSeriesComplex(n: number, z: Complex): Complex {
  let sum = C_ZERO;
  let zk: Complex = C_ONE;
  for (let k = 1; k < 500; k++) {
    zk = zk.mul(z);
    const term = zk.div(Math.pow(k, n));
    sum = sum.add(term);
    if (term.abs() < 1e-17 * (1 + sum.abs())) break;
  }
  return sum;
}

/**
 * Crandall's ln-expansion about z = 1 (DLMF 25.12.11, general s specialised
 * to integer n): with L = ln z,
 *   Liₙ(z) = L^{n−1}/(n−1)! · (H_{n−1} − ln(−L))
 *            + Σ_{k≥0, k≠n−1} ζ(n−k) Lᵏ/k!
 * Converges for |L| < 2π, i.e. everywhere on 1/2 < |z| ≤ 1.
 */
function polylogLnExpComplex(n: number, z: Complex): Complex {
  const L = z.log();
  // z = 1: L = 0. The singular term vanishes (L^{n−1} = 0 for n ≥ 2) and
  // only the k = 0 term survives → Liₙ(1) = ζ(n). Guard the ln(−L) = −∞.
  if (L.re === 0 && L.im === 0)
    return new Complex(riemannZetaComplex(new Complex(n, 0)).re, 0);

  // Harmonic number H_{n−1} = Σ_{j=1}^{n−1} 1/j.
  let H = 0;
  for (let j = 1; j < n; j++) H += 1 / j;
  const lnNegL = L.neg().log(); // ln(−ln z)

  let sum = C_ZERO;
  let coef: Complex = C_ONE; // Lᵏ/k!, starting at k = 0
  for (let k = 0; k < 200; k++) {
    let term: Complex;
    if (k === n - 1) term = coef.mul(new Complex(H, 0).sub(lnNegL));
    else term = coef.mul(riemannZetaComplex(new Complex(n - k, 0)).re);
    sum = sum.add(term);
    // ζ vanishes at the negative even integers, so every other term is exactly
    // 0; break only on a small *non-zero* term (the non-zero terms decay
    // geometrically, so the first tiny one is a safe stopping point).
    const a = term.abs();
    if (k > n && a !== 0 && a < 1e-16 * (1 + sum.abs())) break;
    coef = coef.mul(L).div(k + 1); // advance to k+1
  }
  return sum;
}

/** Interior evaluation for |z| ≤ 1 (dispatches series vs ln-expansion). */
function polylogInteriorComplex(n: number, z: Complex): Complex {
  if (z.abs() <= 0.5) return polylogSeriesComplex(n, z);
  return polylogLnExpComplex(n, z);
}

/**
 * Inversion formula for |z| > 1 (DLMF 25.12.4, integer n):
 *   Liₙ(z) = (−1)^{n−1} Liₙ(1/z) − (2πi)ⁿ/n! · Bₙ(1/2 + ln(−z)/(2πi))
 * with the principal branch of ln(−z) (reproduces mpmath's below-the-cut
 * value on z ∈ (1, ∞)).
 */
function polylogInversionComplex(n: number, z: Complex): Complex {
  const twoPiI = new Complex(0, 2 * Math.PI);
  // Principal ln(−z). Force +0 (not −0) imaginary for real z so that a
  // point on the cut z ∈ (1, ∞) takes arg(−z) = +π, matching mpmath's
  // below-the-cut (Im < 0) convention. (`z.neg()` yields −0 imaginary,
  // which would pick −π and hand back the conjugate.)
  const negZ = new Complex(-z.re, z.im === 0 ? 0 : -z.im);
  const arg = new Complex(0.5, 0).add(negZ.log().div(twoPiI));
  const bern = bernoulliPolyComplex(n, arg);
  const inner = polylogInteriorComplex(n, z.inverse());
  const sign = n % 2 === 0 ? -1 : 1; // (−1)^{n−1}
  let nFact = 1;
  for (let i = 2; i <= n; i++) nFact *= i;
  return inner.mul(sign).sub(twoPiI.pow(n).div(nFact).mul(bern));
}

/**
 * Polylogarithm Liₙ(z) for integer order n ≥ 2 and complex z (whole plane).
 * Returns NaN for non-integer order, order < 2, or NaN input — the caller
 * then keeps the expression symbolic. Accurate to ≈1e-12 or better across
 * the plane (see the validation notes at the call site); the branch cut is
 * z ∈ (1, ∞) with the below-the-cut (Im < 0) convention.
 */
export function polylogComplex(s: Complex, z: Complex): Complex {
  if (s.isNaN() || z.isNaN()) return C_NAN;
  if (s.im !== 0) return C_NAN;
  const n = Math.round(s.re);
  if (!Number.isInteger(s.re) || Math.abs(s.re - n) > 1e-12 || n < 2)
    return C_NAN;
  if (z.isZero()) return C_ZERO;
  if (z.abs() > 1) return polylogInversionComplex(n, z);
  return polylogInteriorComplex(n, z);
}

//
// ---------------- Arithmetic-geometric mean (complex) ----------------
//

/**
 * Complex arithmetic-geometric mean using the "optimal" branch choice:
 * at each step pick the square root with |aₙ₊₁ − bₙ₊₁| ≤ |aₙ₊₁ + bₙ₊₁|.
 */
export function agmComplex(a: Complex, b: Complex): Complex {
  if (a.isNaN() || b.isNaN()) return C_NAN;
  if (a.isZero() || b.isZero()) return new Complex(0, 0);
  for (let i = 0; i < 100; i++) {
    const an = a.add(b).mul(0.5);
    let bn = a.mul(b).sqrt();
    if (an.sub(bn).abs() > an.add(bn).abs()) bn = bn.neg();
    a = an;
    b = bn;
    if (a.sub(b).abs() <= 1e-17 * a.abs()) break;
  }
  return a.add(b).mul(0.5);
}

//
// ---------------- Complete elliptic integrals (complex, parameter m = k²) ----------------
//

/** Complex K(m) = π/(2·agm(1, √(1−m))), principal branch. */
export function ellipticKComplex(m: Complex): Complex {
  if (m.isNaN()) return C_NAN;
  if (m.equals(C_ONE)) return new Complex(Infinity, 0);
  return new Complex(Math.PI / 2, 0).div(
    agmComplex(C_ONE, C_ONE.sub(m).sqrt())
  );
}

/**
 * Complex E(m) via Carlson's symmetric integrals (DLMF 19.25.1):
 * E(m) = R_F(0, 1−m, 1) − (m/3)·R_D(0, 1−m, 1), as `ellipticEIncompleteComplex`
 * at φ = π/2. The AGM cₙ-sum it replaces (A&S 17.6.4, continued to complex
 * m) returned wrong values off the real axis in some regions, from the
 * third significant digit on: E(0.57 + 0.23i) came out as 1.3175 − 0.1205i
 * where the value is 1.3248 − 0.1197i.
 */
export function ellipticEComplex(m: Complex): Complex {
  if (m.isNaN()) return C_NAN;
  if (m.equals(C_ONE)) return C_ONE;
  const y = C_ONE.sub(m);
  return carlsonRFComplex(C_ZERO, y, C_ONE).sub(
    m.div(3).mul(carlsonRDComplex(C_ZERO, y, C_ONE))
  );
}

//
// ---------------- Carlson symmetric elliptic integrals (complex) ----------------
//
// Duplication-theorem algorithms (Carlson 1995, same series tails as the
// machine-real kernels in numerics/special-functions.ts and as mpmath).
// With principal-branch square roots the duplication theorem is valid for
// arguments in the cut plane C ∖ (−∞, 0); arguments ON the negative real
// axis are evaluated as their boundary value from above (Im → 0⁺), which
// matches the mpmath/Mathematica convention for the incomplete elliptic
// integrals built on them.
//

const CARLSON_TOL_C = 1e-24;

/** Carlson R_C(x, y), complex, principal value for y on (−∞, 0). */
export function carlsonRCComplex(x: Complex, y: Complex): Complex {
  if (x.isNaN() || y.isNaN()) return C_NAN;
  if (y.isZero()) return new Complex(Infinity, 0);
  if (x.isZero()) return new Complex(Math.PI / 2, 0).div(y.sqrt());
  // Cauchy principal value for real y < 0 (DLMF 19.2.20)
  if (y.im === 0 && y.re < 0)
    return x
      .div(x.sub(y))
      .sqrt()
      .mul(carlsonRCComplex(x.sub(y), y.neg()));
  if (x.equals(y)) return x.sqrt().inverse();
  // Near-degenerate y ≈ x: series Σₖ (−e)ᵏ/(2k+1) (same conditioning
  // issue as the real kernel: acos at arguments → 1)
  const e = y.sub(x).div(x);
  if (e.abs() < 0.01) {
    let sum = C_ZERO;
    let term = C_ONE;
    for (let k = 0; k < 10; k++) {
      sum = sum.add(term.div(2 * k + 1));
      term = term.mul(e).neg();
    }
    return sum.div(x.sqrt());
  }
  // v = acos(√x/√y) / (√(1 − x/y)·√y)
  const sx = x.sqrt();
  const sy = y.sqrt();
  return sx
    .div(sy)
    .acos()
    .div(C_ONE.sub(x.div(y)).sqrt().mul(sy));
}

/** Carlson R_F(x, y, z), complex (cut plane). */
export function carlsonRFComplex(x: Complex, y: Complex, z: Complex): Complex {
  if (x.isNaN() || y.isNaN() || z.isNaN()) return C_NAN;
  if (y.equals(z)) return carlsonRCComplex(x, y);
  if (x.equals(z)) return carlsonRCComplex(y, x);
  if (x.equals(y)) return carlsonRCComplex(z, x);
  if ((x.isZero() ? 1 : 0) + (y.isZero() ? 1 : 0) + (z.isZero() ? 1 : 0) > 1)
    return new Complex(Infinity, 0);

  const A0 = x.add(y).add(z).div(3);
  const Q =
    Math.pow(3 * CARLSON_TOL_C, -1 / 6) *
    Math.max(A0.sub(x).abs(), A0.sub(y).abs(), A0.sub(z).abs());
  let xm = x;
  let ym = y;
  let zm = z;
  let A = A0;
  let pow4 = 1;
  for (let i = 0; i < 64 && pow4 * Q >= A.abs(); i++) {
    const sx = xm.sqrt();
    const sy = ym.sqrt();
    const sz = zm.sqrt();
    const lm = sx.mul(sy).add(sx.mul(sz)).add(sy.mul(sz));
    A = A.add(lm).div(4);
    xm = xm.add(lm).div(4);
    ym = ym.add(lm).div(4);
    zm = zm.add(lm).div(4);
    pow4 /= 4;
  }
  const t = A.inverse().mul(pow4);
  const X = A0.sub(x).mul(t);
  const Y = A0.sub(y).mul(t);
  const Z = X.add(Y).neg();
  const E2 = X.mul(Y).sub(Z.mul(Z));
  const E3 = X.mul(Y).mul(Z);
  // (9240 − 924·E2 + 385·E2² + 660·E3 − 630·E2·E3)/9240 / √A
  const series = new Complex(9240, 0)
    .sub(E2.mul(924))
    .add(E2.mul(E2).mul(385))
    .add(E3.mul(660))
    .sub(E2.mul(E3).mul(630))
    .div(9240);
  return series.div(A.sqrt());
}

/**
 * Carlson R_J(x, y, z, p), complex, via the duplication theorem. Only the
 * argument configurations for which the duplication theorem is known to be
 * valid are evaluated (mpmath's criterion): Re x, Re y, Re z ≥ 0 with
 * Re p > 0; or p equal to one of x, y, z; or one argument nonnegative real
 * with the other two complex conjugates and p not on (−∞, 0]. Other
 * configurations return NaN (mpmath falls back to contour integration
 * there; we do not).
 */
export function carlsonRJComplex(
  x: Complex,
  y: Complex,
  z: Complex,
  p: Complex
): Complex {
  if (x.isNaN() || y.isNaN() || z.isNaN() || p.isNaN()) return C_NAN;
  if (p.isZero()) return new Complex(Infinity, 0);
  if ((x.isZero() ? 1 : 0) + (y.isZero() ? 1 : 0) + (z.isZero() ? 1 : 0) > 1)
    return new Complex(Infinity, 0);

  let ok = x.re >= 0 && y.re >= 0 && z.re >= 0 && p.re > 0;
  if (!ok && (x.equals(p) || y.equals(p) || z.equals(p))) ok = true;
  if (!ok && (p.im !== 0 || p.re >= 0)) {
    const conj = (a: Complex, b: Complex): boolean =>
      a.re === b.re && a.im === -b.im;
    if (x.im === 0 && x.re >= 0 && conj(y, z)) ok = true;
    else if (y.im === 0 && y.re >= 0 && conj(x, z)) ok = true;
    else if (z.im === 0 && z.re >= 0 && conj(x, y)) ok = true;
  }
  if (!ok) return C_NAN;

  // R_J is homogeneous of degree −3/2: R_J(λx, λy, λz, λp) = λ^{-3/2}·R_J(x,
  // y, z, p). Above about 1e100 the duplication loop overflows (the dₘ
  // product is of the order of |A|^{3/2}), so scale the arguments to unit
  // size first, with a real positive λ so no branch moves. E(m) at
  // |m| = 1e300 goes through R_D(0, 1 − m, 1) and needs this. The two
  // divisions at the end (by λ, then by √λ) keep the result in range.
  const big = Math.max(x.abs(), y.abs(), z.abs(), p.abs());
  if (big > 1e100) {
    const r = carlsonRJComplex(x.div(big), y.div(big), z.div(big), p.div(big));
    return r.div(big).div(Math.sqrt(big));
  }

  const A0 = x.add(y).add(z).add(p.mul(2)).div(5);
  const delta = p.sub(x).mul(p.sub(y)).mul(p.sub(z));
  const Q =
    Math.pow(0.25 * CARLSON_TOL_C, -1 / 6) *
    Math.max(
      A0.sub(x).abs(),
      A0.sub(y).abs(),
      A0.sub(z).abs(),
      A0.sub(p).abs()
    );
  let xm = x;
  let ym = y;
  let zm = z;
  let pm = p;
  let A = A0;
  let pow4 = 1;
  let S = C_ZERO;
  for (let i = 0; i < 64; i++) {
    const sx = xm.sqrt();
    const sy = ym.sqrt();
    const sz = zm.sqrt();
    const sp = pm.sqrt();
    const lm = sx.mul(sy).add(sx.mul(sz)).add(sy.mul(sz));
    const A1 = A.add(lm).div(4);
    xm = xm.add(lm).div(4);
    ym = ym.add(lm).div(4);
    zm = zm.add(lm).div(4);
    pm = pm.add(lm).div(4);
    const dm = sp.add(sx).mul(sp.add(sy)).mul(sp.add(sz));
    // When p equals one of x, y, z (the R_D case) δ is exactly 0 and so is
    // every eₘ; dividing would turn an underflowed dm² (|z| above about
    // 1e250 with x = 0) into 0/0 = NaN.
    const em = delta.isZero()
      ? C_ZERO
      : delta.mul(pow4 * pow4 * pow4).div(dm.mul(dm));
    if (pow4 * Q < A.abs()) break;
    S = S.add(carlsonRCComplex(C_ONE, C_ONE.add(em)).mul(pow4).div(dm));
    pow4 /= 4;
    A = A1;
  }
  const t = A.inverse().mul(pow4);
  const X = A0.sub(x).mul(t);
  const Y = A0.sub(y).mul(t);
  const Z = A0.sub(z).mul(t);
  const P = X.add(Y).add(Z).div(-2);
  const E2 = X.mul(Y).add(X.mul(Z)).add(Y.mul(Z)).sub(P.mul(P).mul(3));
  const E3 = X.mul(Y).mul(Z).add(E2.mul(P).mul(2)).add(P.mul(P).mul(P).mul(4));
  const E4 = X.mul(Y)
    .mul(Z)
    .mul(2)
    .add(E2.mul(P))
    .add(P.mul(P).mul(P).mul(3))
    .mul(P);
  const E5 = X.mul(Y).mul(Z).mul(P).mul(P);
  const series = new Complex(24024, 0)
    .sub(E2.mul(5148))
    .add(E2.mul(E2).mul(2457))
    .add(E3.mul(4004))
    .sub(E2.mul(E3).mul(4158))
    .sub(E4.mul(3276))
    .add(E5.mul(2772))
    .div(24024);
  // Divide by A and then by √A rather than by `A.pow(1.5)`: complex-esm's
  // `pow` goes through `log`/`exp` and returns NaN once |A| is above about
  // 1e154, and the product A·√A overflows to an infinite part above about
  // 1e205, which the complex division turns into NaN. The two divisions
  // stay finite over the whole double range (E(m) at |m| = 1e300 needs
  // this; the term only underflows to 0 there, where it is negligible).
  return series.mul(pow4).div(A).div(A.sqrt()).add(S.mul(6));
}

/** Carlson R_D(x, y, z) = R_J(x, y, z, z), complex. */
export function carlsonRDComplex(x: Complex, y: Complex, z: Complex): Complex {
  return carlsonRJComplex(x, y, z, z);
}

//
// ---------------- Incomplete elliptic integrals (complex) ----------------
//
// Same Legendre/parameter conventions as the machine-real kernels
// (numerics/special-functions.ts): the last argument is the PARAMETER
// m = k². Reductions: DLMF 19.25.5 / 19.25.9 / 19.25.14, with the
// quasi-periodic extension for |Re φ| > π/2.
//

/** Incomplete elliptic integral of the first kind F(φ|m), complex. */
export function ellipticFComplex(phi: Complex, m: Complex): Complex {
  if (phi.isNaN() || m.isNaN()) return C_NAN;
  if (Math.abs(phi.re) > Math.PI / 2) {
    // F(φ + kπ|m) = F(φ|m) + 2k·K(m)
    const k = Math.round(phi.re / Math.PI);
    const K = ellipticKComplex(m);
    if (K.isNaN() || !Number.isFinite(K.re)) return C_NAN;
    return K.mul(2 * k).add(ellipticFComplex(phi.sub(k * Math.PI), m));
  }
  const s = phi.sin();
  const c = phi.cos();
  const y = C_ONE.sub(m.mul(s).mul(s));
  return s.mul(carlsonRFComplex(c.mul(c), y, C_ONE));
}

/** Incomplete elliptic integral of the second kind E(φ|m), complex. */
export function ellipticEIncompleteComplex(phi: Complex, m: Complex): Complex {
  if (phi.isNaN() || m.isNaN()) return C_NAN;
  if (Math.abs(phi.re) > Math.PI / 2) {
    // E(φ + kπ|m) = E(φ|m) + 2k·E(m)
    const k = Math.round(phi.re / Math.PI);
    const E = ellipticEComplex(m);
    if (E.isNaN() || !Number.isFinite(E.re)) return C_NAN;
    return E.mul(2 * k).add(
      ellipticEIncompleteComplex(phi.sub(k * Math.PI), m)
    );
  }
  // A real φ = ±π/2 is the complete integral. Computed through the general
  // formula, cos²(π/2) is 3.7e-33 rather than 0, and for m near 1 the two
  // Carlson terms both grow like a logarithm and their difference loses
  // every digit (E(π/2 | 1 + 1e-20i) came out as 14.6 − 0.79i, not 1). The
  // complete kernel passes an exact 0 and has the m = 1 value.
  if (phi.im === 0 && Math.abs(Math.abs(phi.re) - Math.PI / 2) < 1e-15)
    return ellipticEComplex(m).mul(Math.sign(phi.re));
  const s = phi.sin();
  const c = phi.cos();
  const cc = c.mul(c);
  const y = C_ONE.sub(m.mul(s).mul(s));
  return s.mul(carlsonRFComplex(cc, y, C_ONE)).sub(
    m
      .div(3)
      .mul(s.pow(3))
      .mul(carlsonRDComplex(cc, y, C_ONE))
  );
}

/** Complete elliptic integral of the third kind Π(n|m), complex. */
export function ellipticPiCompleteComplex(n: Complex, m: Complex): Complex {
  if (n.isNaN() || m.isNaN()) return C_NAN;
  if (n.equals(C_ONE) || m.equals(C_ONE)) return new Complex(Infinity, 0);
  // Π(n|m) = R_F(0, 1−m, 1) + (n/3)·R_J(0, 1−m, 1, 1−n)
  return carlsonRFComplex(C_ZERO, C_ONE.sub(m), C_ONE).add(
    n.div(3).mul(carlsonRJComplex(C_ZERO, C_ONE.sub(m), C_ONE, C_ONE.sub(n)))
  );
}

/** Incomplete elliptic integral of the third kind Π(n; φ|m), complex. */
export function ellipticPiIncompleteComplex(
  n: Complex,
  phi: Complex,
  m: Complex
): Complex {
  if (n.isNaN() || phi.isNaN() || m.isNaN()) return C_NAN;
  if (Math.abs(phi.re) > Math.PI / 2) {
    // Π(n; φ + kπ|m) = Π(n; φ|m) + 2k·Π(n|m)
    const k = Math.round(phi.re / Math.PI);
    const P = ellipticPiCompleteComplex(n, m);
    if (P.isNaN() || !Number.isFinite(P.re)) return C_NAN;
    return P.mul(2 * k).add(
      ellipticPiIncompleteComplex(n, phi.sub(k * Math.PI), m)
    );
  }
  const s = phi.sin();
  const c = phi.cos();
  const cc = c.mul(c);
  const ss = s.mul(s);
  const y = C_ONE.sub(m.mul(ss));
  const p = C_ONE.sub(n.mul(ss));
  if (p.isZero()) return new Complex(Infinity, 0);
  return s.mul(carlsonRFComplex(cc, y, C_ONE)).add(
    n
      .div(3)
      .mul(s.pow(3))
      .mul(carlsonRJComplex(cc, y, C_ONE, p))
  );
}

//
// ---------------- Hypergeometric functions (complex) ----------------
//

function isNonPositiveIntegerC(x: Complex): boolean {
  return x.im === 0 && Number.isInteger(x.re) && x.re <= 0;
}

function gauss2F1SeriesC(
  a: Complex,
  b: Complex,
  c: Complex,
  z: Complex,
  maxTerms = 10_000
): Complex {
  let term: Complex = C_ONE;
  let sum: Complex = C_ONE;
  for (let n = 0; n < maxTerms; n++) {
    term = term
      .mul(a.add(n))
      .mul(b.add(n))
      .mul(z)
      .div(c.add(n).mul(n + 1));
    if (term.isZero()) return sum;
    sum = sum.add(term);
    if (n > 2 && term.abs() <= Number.EPSILON * sum.abs()) return sum;
  }
  return sum;
}

/** Distance from a complex number to the nearest (real) integer. */
function distToIntegerC(x: Complex): number {
  if (Number.isNaN(x.re) || Number.isNaN(x.im)) return NaN;
  return Math.hypot(x.re - Math.round(x.re), x.im);
}

/**
 * Product of Γ over `num` divided by the product of Γ over `den`, with
 * explicit pole handling: a Γ-pole (non-positive integer argument) in the
 * denominator makes the whole coefficient 0; a pole in the numerator means
 * the connection formula degenerates (callers gate on that — NaN here is
 * defensive).
 */
function gammaRatioC(
  num: ReadonlyArray<Complex>,
  den: ReadonlyArray<Complex>
): Complex {
  const numPole = num.some(isNonPositiveIntegerC);
  if (den.some(isNonPositiveIntegerC))
    return numPole ? C_NAN : new Complex(0, 0);
  if (numPole) return C_NAN;
  let r: Complex = C_ONE;
  for (const x of num) r = r.mul(gamma(x));
  for (const x of den) r = r.div(gamma(x));
  return r;
}

// Treat a parameter difference within this distance of an integer as
// degenerate: the two-term connection formulas have Γ-factors that blow up
// like 1/dist, so closer than this the cancellation destroys the result.
// Such cases are routed to another transformation, or evaluated by averaging
// two parameter-perturbed evaluations (±1e-6), accurate to ~1e-9.
const DEGENERATE_TOL = 1e-7;

// |w| bounds for the transformed series argument. Below W_PREFERRED the
// series converges in well under 10k terms; up to W_MAX it still converges
// (≈250k-term budget, |0.99|ⁿ needs ~3700 terms for 1e-16). The only region
// where no transformation reaches W_MAX is a thin sliver around the two
// points z = e^{±iπ/3} (where all six Kummer maps have |w| = 1).
const W_PREFERRED = 0.92;
const W_MAX = 0.99;

/**
 * Complex Gauss hypergeometric ₂F₁(a, b; c; z), analytic continuation over
 * (almost) the whole plane.
 *
 * Picks among the six Kummer transformations the one with the smallest
 * transformed argument |w| (A&S 15.3.4–15.3.9): direct series, Pfaff
 * z/(z−1), and the two-term Γ-connection formulas in 1−z, 1/z, 1/(1−z),
 * and 1−1/z. Degenerate parameter differences (a−b ∈ ℤ for the 1/z and
 * 1/(1−z) maps, c−a−b ∈ ℤ for the 1−z and 1−1/z maps) are routed to a
 * non-degenerate map when one converges, otherwise handled by symmetric
 * parameter perturbation (~9 significant digits).
 *
 * On the branch cut z ∈ (1, ∞) the principal branch is the limit from
 * below (the standard z − i0 convention).
 *
 * Returns NaN only near z = e^{±iπ/3} (all maps have |w| ≈ 1 there).
 */
export function hypergeometric2F1Complex(
  a: Complex,
  b: Complex,
  c: Complex,
  z: Complex,
  depth = 0
): Complex {
  if (a.isNaN() || b.isNaN() || c.isNaN() || z.isNaN()) return C_NAN;

  const aTerm = isNonPositiveIntegerC(a) ? -a.re : Infinity;
  const bTerm = isNonPositiveIntegerC(b) ? -b.re : Infinity;
  const nTerms = Math.min(aTerm, bTerm);
  if (isNonPositiveIntegerC(c)) {
    if (nTerms === Infinity || nTerms > -c.re) return C_NAN;
  }
  if (nTerms !== Infinity) return gauss2F1SeriesC(a, b, c, z, nTerms + 1);

  if (z.isZero()) return C_ONE;

  const one = C_ONE;
  const s = c.sub(a).sub(b); // c − a − b
  const d = b.sub(a); // b − a

  if (z.equals(one)) {
    // Gauss summation: Γ(c)Γ(c−a−b)/(Γ(c−a)Γ(c−b)), requires Re(c−a−b) > 0
    if (s.re <= 0) return C_NAN; // divergent (or log-divergent at s = 0)
    return gammaRatioC([c, s], [c.sub(a), c.sub(b)]);
  }

  // Principal branch on the cut [1, ∞): the z − i0 convention (limit from
  // below). Forcing im = −0 makes atan2 yield Arg(1−z) = Arg(−z) = +π for
  // real z > 1, which is exactly the z − i0 limit.
  if (z.im === 0) z = new Complex(z.re, -0);

  const sIsDegenerate = distToIntegerC(s) <= DEGENERATE_TOL;
  const dIsDegenerate = distToIntegerC(d) <= DEGENERATE_TOL;

  // The six Kummer maps, by transformed argument. `degenerate` marks maps
  // whose connection formula breaks down for the current parameters.
  const candidates: {
    kind:
      | 'direct'
      | 'pfaff'
      | 'one-minus-z'
      | 'inv-z'
      | 'inv-one-minus-z'
      | 'one-minus-inv-z';
    w: Complex;
    degenerate: boolean;
  }[] = [
    { kind: 'direct', w: z, degenerate: false },
    { kind: 'pfaff', w: z.div(z.sub(1)), degenerate: false },
    { kind: 'one-minus-z', w: one.sub(z), degenerate: sIsDegenerate },
    { kind: 'inv-z', w: one.div(z), degenerate: dIsDegenerate },
    {
      kind: 'inv-one-minus-z',
      w: one.div(one.sub(z)),
      degenerate: dIsDegenerate,
    },
    {
      kind: 'one-minus-inv-z',
      w: one.sub(one.div(z)),
      degenerate: sIsDegenerate,
    },
  ];
  candidates.sort((p, q) => p.w.abs() - q.w.abs());

  let sawDegenerateCandidate = false;
  for (const cand of candidates) {
    const { kind, w } = cand;
    if (w.abs() > W_MAX) break; // sorted: no further candidate fits
    if (cand.degenerate) {
      sawDegenerateCandidate = true;
      continue;
    }
    const maxTerms = w.abs() <= W_PREFERRED ? 10_000 : 250_000;

    switch (kind) {
      case 'direct':
        return gauss2F1SeriesC(a, b, c, z, maxTerms);

      case 'pfaff':
        // A&S 15.3.4: (1−z)^{−a}·₂F₁(a, c−b; c; z/(z−1))
        return one
          .sub(z)
          .pow(a.neg())
          .mul(gauss2F1SeriesC(a, c.sub(b), c, w, maxTerms));

      case 'one-minus-z': {
        // A&S 15.3.6, w = 1−z, s = c−a−b ∉ ℤ
        const t1 = gammaRatioC([c, s], [c.sub(a), c.sub(b)]).mul(
          gauss2F1SeriesC(a, b, one.sub(s), w, maxTerms)
        );
        const t2 = gammaRatioC([c, s.neg()], [a, b])
          .mul(w.pow(s))
          .mul(gauss2F1SeriesC(c.sub(a), c.sub(b), one.add(s), w, maxTerms));
        return t1.add(t2);
      }

      case 'inv-z': {
        // A&S 15.3.7, w = 1/z, b−a ∉ ℤ
        const t1 = gammaRatioC([c, d], [b, c.sub(a)])
          .mul(z.neg().pow(a.neg()))
          .mul(
            gauss2F1SeriesC(
              a,
              one.sub(c).add(a),
              one.sub(b).add(a),
              w,
              maxTerms
            )
          );
        const t2 = gammaRatioC([c, d.neg()], [a, c.sub(b)])
          .mul(z.neg().pow(b.neg()))
          .mul(
            gauss2F1SeriesC(
              b,
              one.sub(c).add(b),
              one.sub(a).add(b),
              w,
              maxTerms
            )
          );
        return t1.add(t2);
      }

      case 'inv-one-minus-z': {
        // A&S 15.3.8, w = 1/(1−z), b−a ∉ ℤ
        const oneMinusZ = one.sub(z);
        const t1 = gammaRatioC([c, d], [b, c.sub(a)])
          .mul(oneMinusZ.pow(a.neg()))
          .mul(gauss2F1SeriesC(a, c.sub(b), a.sub(b).add(1), w, maxTerms));
        const t2 = gammaRatioC([c, d.neg()], [a, c.sub(b)])
          .mul(oneMinusZ.pow(b.neg()))
          .mul(gauss2F1SeriesC(b, c.sub(a), b.sub(a).add(1), w, maxTerms));
        return t1.add(t2);
      }

      case 'one-minus-inv-z': {
        // A&S 15.3.9, w = 1 − 1/z, s = c−a−b ∉ ℤ
        const t1 = gammaRatioC([c, s], [c.sub(a), c.sub(b)])
          .mul(z.pow(a.neg()))
          .mul(
            gauss2F1SeriesC(
              a,
              a.sub(c).add(1),
              a.add(b).sub(c).add(1),
              w,
              maxTerms
            )
          );
        const t2 = gammaRatioC([c, s.neg()], [a, b])
          .mul(one.sub(z).pow(s))
          .mul(z.pow(a.sub(c)))
          .mul(gauss2F1SeriesC(c.sub(a), one.sub(a), s.add(1), w, maxTerms));
        return t1.add(t2);
      }
    }
  }

  // Only degenerate maps converge: evaluate at symmetrically perturbed
  // parameters and average. The perturbation (±ε on a, ±ε√2 on c) breaks
  // both a−b ∈ ℤ and c−a−b ∈ ℤ; averaging cancels the O(ε) error, leaving
  // O(ε²) + Γ-cancellation ≈ 1e-9 relative accuracy.
  if (depth === 0 && sawDegenerateCandidate) {
    const EPS = 1e-6;
    const f1 = hypergeometric2F1Complex(
      a.add(EPS),
      b,
      c.add(EPS * Math.SQRT2),
      z,
      1
    );
    const f2 = hypergeometric2F1Complex(
      a.sub(EPS),
      b,
      c.sub(EPS * Math.SQRT2),
      z,
      1
    );
    return f1.add(f2).mul(0.5);
  }

  return C_NAN; // near z = e^{±iπ/3}: no implemented map converges
}

function kummer1F1SeriesC(
  a: Complex,
  b: Complex,
  z: Complex,
  maxTerms = 20_000
): Complex {
  let term: Complex = C_ONE;
  let sum: Complex = C_ONE;
  for (let n = 0; n < maxTerms; n++) {
    term = term
      .mul(a.add(n))
      .mul(z)
      .div(b.add(n).mul(n + 1));
    if (term.isZero()) return sum;
    sum = sum.add(term);
    if (n > 2 && term.abs() <= Number.EPSILON * sum.abs()) return sum;
  }
  return sum;
}

/**
 * Complex Kummer confluent hypergeometric ₁F₁(a; b; z). Entire in z;
 * Kummer transformation for Re(z) < 0 to limit cancellation.
 */
export function hypergeometric1F1Complex(
  a: Complex,
  b: Complex,
  z: Complex
): Complex {
  if (a.isNaN() || b.isNaN() || z.isNaN()) return C_NAN;
  const aTerm = isNonPositiveIntegerC(a) ? -a.re : Infinity;
  if (isNonPositiveIntegerC(b)) {
    if (aTerm === Infinity || aTerm > -b.re) return C_NAN;
  }
  if (aTerm !== Infinity) return kummer1F1SeriesC(a, b, z, aTerm + 1);
  if (z.re < 0)
    return z.exp().mul(hypergeometric1F1Complex(b.sub(a), b, z.neg()));
  return kummer1F1SeriesC(a, b, z);
}

/**
 * Complex Appell F₁(a; b₁, b₂; c; x, y) by the double Pochhammer series.
 * Converges for |x| < 1 and |y| < 1 (or when the corresponding index
 * terminates); outside returns NaN (the expression stays symbolic).
 */
export function appellF1Complex(
  a: Complex,
  b1: Complex,
  b2: Complex,
  c: Complex,
  x: Complex,
  y: Complex
): Complex {
  if ([a, b1, b2, c, x, y].some((v) => v.isNaN())) return C_NAN;
  if (isNonPositiveIntegerC(c)) return C_NAN;

  const xConverges = x.abs() < 1 || isNonPositiveIntegerC(b1);
  const yConverges = y.abs() < 1 || isNonPositiveIntegerC(b2);
  if (!xConverges || !yConverges) return C_NAN;

  const MAX_ROWS = 10_000;
  const MAX_COLS = 10_000;
  let sum = new Complex(0, 0);
  let rowLead: Complex = C_ONE; // (a)ₘ(b₁)ₘ/((c)ₘ m!) xᵐ
  let negligibleRows = 0;
  for (let m = 0; m < MAX_ROWS; m++) {
    let term = rowLead;
    let rowSum = term;
    for (let n = 0; n < MAX_COLS; n++) {
      term = term
        .mul(a.add(m + n))
        .mul(b2.add(n))
        .mul(y)
        .div(c.add(m + n).mul(n + 1));
      if (term.isZero()) break;
      rowSum = rowSum.add(term);
      if (term.abs() <= Number.EPSILON * (1 + rowSum.abs())) break;
    }
    sum = sum.add(rowSum);
    if (rowSum.abs() <= Number.EPSILON * (1 + sum.abs())) {
      if (++negligibleRows >= 3) return sum;
    } else negligibleRows = 0;

    rowLead = rowLead
      .mul(a.add(m))
      .mul(b1.add(m))
      .mul(x)
      .div(c.add(m).mul(m + 1));
    if (rowLead.isZero()) return sum;
  }
  return sum;
}

//
// ---------------- Jacobi theta functions ----------------
//
// Fungrim convention (f96eac): θⱼ(z, τ) with nome q = e^{iπτ}, Im(τ) > 0,
// and trigonometric arguments in multiples of πz (period 1 in z):
//   θ₁(z,τ) = 2·Σₙ≥₀ (−1)ⁿ e^{iπτ(n+½)²} sin((2n+1)πz)
//   θ₂(z,τ) = 2·Σₙ≥₀ e^{iπτ(n+½)²} cos((2n+1)πz)
//   θ₃(z,τ) = 1 + 2·Σₙ≥₁ e^{iπτn²} cos(2nπz)
//   θ₄(z,τ) = 1 + 2·Σₙ≥₁ (−1)ⁿ e^{iπτn²} cos(2nπz)
//

/** e^{iπτ·s} for real s */
function nomePower(tau: Complex, s: number): Complex {
  return tau.mul(new Complex(0, Math.PI * s)).exp();
}

/**
 * Jacobi theta function θⱼ(z, τ), j ∈ {1,2,3,4}, Fungrim convention.
 * Requires Im(τ) > 0; returns NaN otherwise or if the series does not
 * converge within the iteration cap (extremely small Im(τ)).
 */
export function jacobiTheta(
  j: 1 | 2 | 3 | 4,
  z: Complex,
  tau: Complex
): Complex {
  if (z.isNaN() || tau.isNaN()) return C_NAN;
  if (tau.im <= 0) return C_NAN;

  const maxTerms = 4000;
  let sum = new Complex(0, 0);
  // Truncation criterion: bound term n by its envelope
  // e^{−π·Im(τ)·s(n)}·e^{w(n)·π·|Im z|} (nome decay × max trig growth),
  // NOT by the computed term itself — a trig factor can be accidentally
  // ~0 at some n (e.g. sin((2n+1)πz) with rational real z) without the
  // tail being negligible.
  const imTau = tau.im;
  const imZ = Math.abs(z.im);

  if (j === 1 || j === 2) {
    for (let n = 0; n < maxTerms; n++) {
      const qPow = nomePower(tau, (n + 0.5) * (n + 0.5));
      const trig = z.mul((2 * n + 1) * Math.PI);
      let term = qPow.mul(j === 1 ? trig.sin() : trig.cos());
      if (j === 1 && n % 2 === 1) term = term.neg();
      sum = sum.add(term);
      const env = Math.exp(
        -Math.PI * imTau * (n + 0.5) * (n + 0.5) + (2 * n + 1) * Math.PI * imZ
      );
      if (n > 1 && env <= 1e-18 * (1 + sum.abs())) break;
      if (n === maxTerms - 1) return C_NAN; // did not converge
    }
    return sum.mul(2);
  }

  // j === 3 || j === 4
  for (let n = 1; n < maxTerms; n++) {
    const qPow = nomePower(tau, n * n);
    let term = qPow.mul(z.mul(2 * n * Math.PI).cos());
    if (j === 4 && n % 2 === 1) term = term.neg();
    sum = sum.add(term);
    const env = Math.exp(-Math.PI * imTau * n * n + 2 * n * Math.PI * imZ);
    if (n > 1 && env <= 1e-18 * (1 + sum.abs())) break;
    if (n === maxTerms - 1) return C_NAN; // did not converge
  }
  return C_ONE.add(sum.mul(2));
}

//
// ---------------- Dedekind eta function ----------------
//

/**
 * Dedekind eta η(τ) = e^{iπτ/12}·∏ₖ≥₁ (1 − e^{2πikτ}), Im(τ) > 0
 * (Fungrim 1dc520).
 */
export function dedekindEta(tau: Complex): Complex {
  if (tau.isNaN()) return C_NAN;
  if (tau.im <= 0) return C_NAN;

  const q = tau.mul(new Complex(0, 2 * Math.PI)).exp(); // e^{2πiτ}
  const absQ = q.abs();
  if (absQ >= 1) return C_NAN;

  // ∏ (1 − qᵏ): stop when |q|ᵏ is below machine epsilon
  const kMax = Math.min(100_000, Math.ceil(-40 / Math.log10(absQ)) + 1);
  if (kMax >= 100_000) return C_NAN; // |q| too close to 1 to converge

  let prod: Complex = C_ONE;
  let qk: Complex = q;
  for (let k = 1; k <= kMax; k++) {
    prod = prod.mul(C_ONE.sub(qk));
    qk = qk.mul(q);
    if (qk.abs() < 1e-18) break;
  }
  return nomePower(tau, 1 / 12).mul(prod);
}

/**
 * Normalized Eisenstein series Eₛ(τ) of even weight `s ≥ 2`, for `Im(τ) > 0`.
 *
 *   Eₛ(τ) = 1 − (2s / Bₛ) · Σ_{m≥1} m^{s−1} · qᵐ/(1 − qᵐ),   q = e^{2πiτ}
 *
 * This is the Lambert-series form of `1 − (2s/Bₛ) Σ σ_{s−1}(n) qⁿ` (the
 * divisor-sum q-expansion, e.g. Fungrim 10cdf4/f8dfaf/e20db0). The coefficient
 * `2s/Bₛ` evaluates to the familiar 24, 240, 504, … for s = 2, 4, 6, …
 *
 * Returns NaN outside the upper half-plane, for non-even s, or when |q| is too
 * close to 1 to converge at machine precision.
 */
export function eisensteinE(s: number, tau: Complex): Complex {
  if (tau.isNaN()) return C_NAN;
  if (!Number.isInteger(s) || s < 2 || s % 2 !== 0) return C_NAN;
  if (tau.im <= 0) return C_NAN;

  const q = tau.mul(new Complex(0, 2 * Math.PI)).exp(); // e^{2πiτ}
  const absQ = q.abs();
  if (absQ >= 1) return C_NAN;

  // Coefficient 2s/Bₛ (an integer/rational; exact via the bigint Bernoulli).
  const [bNum, bDen] = bernoulliRational(s);
  if (bNum === 0n) return C_NAN;
  const coeff = (2 * s * Number(bDen)) / Number(bNum);
  if (!Number.isFinite(coeff)) return C_NAN; // weight too large for a float kernel

  // Σ m^{s−1} qᵐ/(1 − qᵐ): exponential decay in |q|ᵐ dominates the m^{s−1}
  // growth, so truncate once the (coefficient-amplified) term is negligible.
  const mMax = Math.min(100_000, Math.ceil(-40 / Math.log10(absQ)) + 1);
  if (mMax >= 100_000) return C_NAN; // |q| too close to 1

  let sum: Complex = C_ZERO;
  let qm: Complex = q; // qᵐ
  for (let m = 1; m <= mMax; m++) {
    const term = qm.div(C_ONE.sub(qm)).mul(new Complex(Math.pow(m, s - 1), 0));
    sum = sum.add(term);
    if (term.abs() * Math.abs(coeff) < 1e-18 && m > s) break;
    qm = qm.mul(q);
  }
  return C_ONE.sub(sum.mul(new Complex(coeff, 0)));
}
