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

/** cos(πx) and sin(πx) with the argument reduced exactly before the
 *  multiplication by π. `Math.sin(Math.PI * x)` loses relative accuracy
 *  near every integer x (Math.PI·x is rounded, and sin is steep there
 *  relative to its value), and `Math.cos(Math.PI / 2)` is 6e-17, not 0.
 *  Here x is reduced to x = t + q/2 with |t| ≤ 1/4 (both steps are exact in
 *  floating point), so the values are exact at multiples of 1/2 and
 *  accurate to a few ulps elsewhere. */
function cosSinPi(x: number): [number, number] {
  const r = x - 2 * Math.round(x / 2); // r ∈ [−1, 1], same angle
  const q = Math.round(2 * r); // −2 … 2
  const t = r - q / 2; // |t| ≤ 1/4
  const c = Math.cos(Math.PI * t);
  const s = t === 0 ? 0 : Math.sin(Math.PI * t);
  switch ((q + 4) % 4) {
    case 0:
      return [c, s];
    case 1:
      return [-s, c];
    case 2:
      return [-c, -s];
    default:
      return [s, -c];
  }
}

/** sin(πz) for complex z, with the real part of the argument reduced by
 *  `cosSinPi`: sin(π(x+iy)) = sin(πx)·cosh(πy) + i·cos(πx)·sinh(πy). */
function sinPiComplex(z: Complex): Complex {
  const [c, s] = cosSinPi(z.re);
  const y = Math.PI * z.im;
  // An exact zero from `cosSinPi` stays zero when cosh or sinh overflows
  // (π|Im z| > 710): 0·∞ would be NaN.
  return new Complex(
    s === 0 ? 0 : s * Math.cosh(y),
    c === 0 ? 0 : c * Math.sinh(y)
  );
}

/** log sin(πz) for complex z, without overflow. For |Im z| ≤ 7 it is the
 *  principal logarithm of `sinPiComplex(z)`. For a larger |Im z| it comes
 *  from the exponential form: for Im z > 0,
 *    sin(πz) = (i/2)·e^{−iπz}·(1 − e^{2iπz}),
 *  and for Im z < 0,
 *    sin(πz) = (−i/2)·e^{iπz}·(1 − e^{−2iπz}),
 *  where the last factor is within e^{−14} of 1. The imaginary part of that
 *  form is not reduced to (−π, π]: it is a logarithm, not necessarily the
 *  principal one. */
function logSinPi(z: Complex): Complex {
  if (!(Math.abs(z.im) > 7)) return sinPiComplex(z).log();
  const x = z.re - 2 * Math.round(z.re / 2); // same e^{iπx}, exact
  const [c2, s2] = cosSinPi(2 * x);
  if (z.im > 0) {
    const w = new Complex(c2, s2).mul(Math.exp(-2 * Math.PI * z.im));
    return new Complex(
      Math.PI * z.im - Math.LN2,
      Math.PI / 2 - Math.PI * x
    ).add(C_ONE.sub(w).log());
  }
  const w = new Complex(c2, -s2).mul(Math.exp(2 * Math.PI * z.im));
  return new Complex(-Math.PI * z.im - Math.LN2, Math.PI * x - Math.PI / 2).add(
    C_ONE.sub(w).log()
  );
}

/** True when `v` is a finite, non-zero complex number whose modulus is in
 *  the normal range of doubles (not an underflowed value). */
function isNormalComplex(v: Complex): boolean {
  const a = v.abs();
  return Number.isFinite(a) && a >= 1e-300;
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
    const sinPiZ = sinPiComplex(c);
    const g = new Complex(Math.PI, 0).div(
      sinPiZ.mul(gamma(new Complex(1, 0).sub(c)))
    );
    if (isNormalComplex(g) || isNonPositiveIntegerC(c)) return g;
    // sin(πz) overflows for a large |Im z| (for example z = −2 + 300i), and
    // Γ(1 − z) overflows for a large −Re z (z = −170.5), although Γ(z) can
    // be representable. Then use the same formula in logarithmic form. It
    // underflows or overflows only when Γ(z) does.
    const l = new Complex(Math.log(Math.PI), 0)
      .sub(logSinPi(c))
      .sub(gammaln(new Complex(1, 0).sub(c)));
    const e = l.exp();
    return Number.isFinite(e.re) && Number.isFinite(e.im) ? e : g;
  }

  const z = c.sub(1);
  let x = new Complex(LANCZOS_P[0], 0);
  for (let i = 1; i < LANCZOS_G + 2; i++)
    x = x.add(new Complex(LANCZOS_P[i], 0).div(z.add(i)));

  const t = z.add(LANCZOS_G + 0.5);

  // √(2π) · t^(z + 0.5) · e^(−t) · x
  const g = new Complex(SQRT_2PI, 0)
    .mul(t.pow(z.add(0.5)))
    .mul(t.neg().exp())
    .mul(x);
  if (Number.isFinite(g.re) && Number.isFinite(g.im)) return g;
  // t^(z + 0.5) overflows for Re z > 142 although Γ(z) is representable up
  // to Re z ≈ 171 (Γ(150) ≈ 3.8e260): combine the power and e^(−t) into one
  // exponential, which overflows only when Γ(z) does.
  const e = z.add(0.5).mul(t.log()).sub(t).exp().mul(x).mul(SQRT_2PI);
  return Number.isFinite(e.re) && Number.isFinite(e.im) ? e : g;
}

/**
 * Natural logarithm of the Gamma function for a complex argument (principal
 * branch), via the Lanczos approximation.
 */
export function gammaln(c: Complex): Complex {
  if (c.re < 0.5) {
    // log Γ(z) = log(π / sin(πz)) − log Γ(1 − z)
    const sinPiZ = sinPiComplex(c);
    const q = new Complex(Math.PI, 0).div(sinPiZ);
    if (!isNormalComplex(q) && !isNonPositiveIntegerC(c)) {
      // sin(πz) overflows (or π/sin(πz) underflows) for a large |Im z|: use
      // log π − log sin(πz), with its imaginary part reduced to (−π, π]
      // so that it is the principal logarithm of π/sin(πz), as above.
      const l = new Complex(Math.log(Math.PI), 0).sub(logSinPi(c));
      return new Complex(l.re, Math.atan2(Math.sin(l.im), Math.cos(l.im))).sub(
        gammaln(new Complex(1, 0).sub(c))
      );
    }
    return q.log().sub(gammaln(new Complex(1, 0).sub(c)));
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
// plane (principal branch of z^s). The machine-real kernel in
// numerics/special-functions.ts returns NaN for z < 0 (a complex result), and
// applyN cascades here.
//

/** z^s on the principal branch. On the negative real axis with a real s the
 *  phase is ±πs exactly (+ for a `+0` imaginary part, − for a `−0` one, the
 *  signed-zero convention of the complex logarithm), computed with
 *  `cosSinPi` so that, e.g., (−20)^{1/2} has a real part of exactly 0. */
function powPrincipal(z: Complex, s: Complex): Complex {
  if (z.im === 0 && z.re < 0 && s.im === 0) {
    const m = Math.pow(-z.re, s.re);
    const [c, sn] = cosSinPi(Object.is(z.im, -0) ? -s.re : s.re);
    return new Complex(m * c, m * sn);
  }
  return z.pow(s);
}

/** log|z^s| and the phase e^{i·arg(z^s)} of z^s, on the principal branch
 *  with the same conventions as `powPrincipal`. */
function logPowPrincipal(z: Complex, s: Complex): [number, Complex] {
  if (z.im === 0 && z.re < 0 && s.im === 0) {
    const [c, sn] = cosSinPi(Object.is(z.im, -0) ? -s.re : s.re);
    return [s.re * Math.log(-z.re), new Complex(c, sn)];
  }
  // As `Complex.pow` computes it: exp(s·log z), log z = ln|z| + i·arg z.
  const l = z.log();
  const phase = s.im * l.re + s.re * l.im;
  return [
    s.re * l.re - s.im * l.im,
    new Complex(Math.cos(phase), Math.sin(phase)),
  ];
}

/** z^s·e^{w}·x, principal branch of z^s (as `powPrincipal`), computed as
 *  one exponential exp(Re(s·log z) + Re w + ln|x|). The product
 *  underflows or overflows only when the result does, while z^s and e^{w}
 *  separately can be outside the range of doubles (for s = −170 and
 *  z = −100, z^s ≈ 1e−340 underflows to 0 but z^s·x ≈ 1e−299 when |x| is
 *  about 1e41). */
function powExpMul(z: Complex, s: Complex, w: Complex, x: Complex): Complex {
  const ax = x.abs();
  if (!(ax > 0 && Number.isFinite(ax)))
    return powPrincipal(z, s).mul(w.exp()).mul(x);
  const [logAbs, phase] = logPowPrincipal(z, s);
  const rot =
    w.im === 0 ? phase : phase.mul(new Complex(Math.cos(w.im), Math.sin(w.im)));
  return rot.mul(x.div(ax)).mul(Math.exp(logAbs + w.re + Math.log(ax)));
}

/** |z^s·e^{w}|·a for a ≥ 0, without intermediate underflow or overflow. */
function powExpAbs(z: Complex, s: Complex, w: Complex, a: number): number {
  if (!(a > 0)) return 0;
  return Math.exp(logPowPrincipal(z, s)[0] + w.re + Math.log(a));
}

/** A bound on the relative error of `gamma(s)`, in units of ε
 *  (`Number.EPSILON`). Measured against mpmath at 9000 points (random with
 *  |Re s| ≤ 150 and |Im s| ≤ 800, and 1500 points within 0.1 of a pole):
 *  the error is at most about 5ε for |s| < 1 and 11ε for |s| < 2, and it
 *  grows with |s| (Lanczos formula and reflection formula) to about 130ε at
 *  |s| = 5, 500ε at |s| = 13, 940ε at |s| = 60 and 5300ε at |s| = 790.
 *  The bound is above every measured value, by a factor of at least 1.35. */
function gammaErrorWeight(s: Complex): number {
  const a = s.abs();
  return Math.min(12 + 5 * a * a, 1016) + 8 * a;
}

/**
 * Γ(s, z) = Γ(s) − γ(s, z) with the lower function summed as the direct
 * power series γ(s, z) = z^s Σ_{k≥0} (−z)^k / (k!·(s + k)).
 *
 * For s = −n (n = 0, 1, 2, …) Γ(s) has a pole that cancels the pole of the
 * k = n term, and the limit is
 *   Γ(−n, z) = (−1)^n/n!·(ψ(n+1) − ln z) − z^{−n} Σ_{k≠n} (−z)^k/(k!·(k − n)),
 * with ψ(n+1) = −γ_Euler + H_n. For n = 0 this is the E₁ series.
 *
 * The terms have magnitude up to about e^{|z|} and the sum about e^{−Re z}
 * (times powers of |z|), so the relative cancellation is about
 * e^{|z| + Re z}: none near the negative real axis, e^{2|z|} on the positive
 * one. The branch cut comes from z^s and ln z only, so a `−0` imaginary part
 * on the negative real axis selects the lower lip.
 *
 * Returns the value and `scale`, the sum of the magnitudes of the parts
 * that were added, each multiplied by the number of roundings it went
 * through: `ε·scale/|value|` estimates the relative rounding error (see
 * `seriesError`).
 */
function upperGammaDirectSeriesComplex(
  s: Complex,
  z: Complex
): { value: Complex; scale: number } {
  const az = z.abs();
  const n = isNonPositiveIntegerC(s) ? -s.re : -1;
  const mz = z.neg();
  let term = C_ONE; // (−z)^k/k!
  let sum = C_ZERO;
  let absSum = 0;
  let weightedSum = 0;
  for (let k = 0; k < 3000; k++) {
    if (k > 0) term = term.mul(mz).div(k);
    if (k === n) continue;
    const t = term.div(s.add(k));
    sum = sum.add(t);
    const at = t.abs();
    absSum += at;
    // The k-th term is the result of about k + 2 complex multiplications
    // and divisions, each with a rounding error of a few ε.
    weightedSum += (k + 2) * at;
    // The terms grow until k ≈ |z|, so only stop past the peak. Also not
    // before k = −Re s: for s near −n the k = n term has the factor
    // 1/(s + n) and can be large after small terms (at s = −8 + 2.5e−9i,
    // z = −0.0004 − 0.0084i it contributes 2e−12 of the value).
    if (k > az && k > -s.re && at < 1e-17 * sum.abs()) break;
  }
  const power = n >= 0 ? new Complex(-n, 0) : s;
  // z^s·sum is one exponential exp(s·log z + log sum) (see `powExpMul`):
  // z^s alone underflows for s = −170, z = −100 although the product is
  // about 1e−299. The exponential has a rounding error of about
  // ε·|s·log z| relative to the product.
  const tail = powExpMul(z, power, C_ZERO, sum);
  const tailScale =
    powExpAbs(z, power, C_ZERO, weightedSum) +
    powExpAbs(z, power, C_ZERO, absSum) * power.abs() * z.log().abs();
  if (n >= 0) {
    let harmonic = 0;
    let factorial = 1;
    let logFactorial = 0;
    for (let j = 1; j <= n; j++) {
      harmonic += 1 / j;
      factorial *= j;
      logFactorial += Math.log(j);
    }
    const base = new Complex(-EULER_GAMMA + harmonic, 0).sub(z.log());
    const sign = n % 2 === 0 ? 1 : -1;
    // n! overflows for n ≥ 171: then divide by it in logarithmic form.
    const lead = Number.isFinite(factorial)
      ? base.div(sign * factorial)
      : base.mul(
          (sign * Math.exp(Math.log(base.abs()) - logFactorial)) / base.abs()
        );
    return { value: lead.sub(tail), scale: 4 * lead.abs() + tailScale };
  }
  const g = gamma(s);
  return {
    value: g.sub(tail),
    scale: g.abs() * gammaErrorWeight(s) + tailScale,
  };
}

/** Γ(s, z) = Γ(s) − γ(s, z) with the lower function summed in the Kummer
 *  form γ(s, z) = z^s e^{−z} Σ_{k≥0} z^k/((s)(s+1)…(s+k)), s not a
 *  non-positive integer. The terms decrease from the start when |z| < |s|,
 *  where this form is accurate. Returns the value and the `scale` used for
 *  the rounding-error estimate, as `upperGammaDirectSeriesComplex` does. */
function upperGammaKummerComplex(
  s: Complex,
  z: Complex
): { value: Complex; scale: number } {
  const az = z.abs();
  let term = C_ONE.div(s); // k = 0 term
  let sum = term;
  let absSum = term.abs();
  let weightedSum = 2 * absSum;
  for (let k = 1; k < 2000; k++) {
    term = term.mul(z).div(s.add(k));
    sum = sum.add(term);
    absSum += term.abs();
    weightedSum += (k + 2) * term.abs();
    // Past k = −Re s the denominators only grow. Before that a small term
    // can precede a large one: for s near −n, the k = n term has the
    // factor 1/(s + n).
    if (k > -s.re && term.abs() < 1e-17 * sum.abs()) break;
  }
  // z^s·e^{−z}·sum as one exponential (see `powExpMul`), with a rounding
  // error of about ε·(|s·log z| + |z|) relative to the product, and the
  // same error model as `upperGammaDirectSeriesComplex` otherwise.
  const tail = powExpMul(z, s, z.neg(), sum);
  const g = gamma(s);
  return {
    value: g.sub(tail),
    scale:
      g.abs() * gammaErrorWeight(s) +
      powExpAbs(z, s, z.neg(), weightedSum) +
      powExpAbs(z, s, z.neg(), absSum) * (s.abs() * z.log().abs() + az),
  };
}

/** Upper incomplete gamma Γ(s, z), complex, via the divergent asymptotic
 *  series Γ(s,z) ~ z^{s−1} e^{−z} Σ_{k≥0} (s−1)(s−2)…(s−k)/z^k. It is used
 *  only for |z| > 700 near the negative real axis, where the direct series
 *  would overflow. Returns NaN when the result is not accurate:
 *   - when the terms start to grow before one of them is below 1e−17 of
 *     the sum (|z| is not large enough next to |s|: for s = 100 + 600i
 *     and z = −600 the first term is already larger than 1);
 *   - when the part that the series omits is not negligible. Across the
 *     cut, Γ(s, z e^{2πi}) − e^{2πis}·Γ(s, z) = Γ(s)(1 − e^{2πis}), while
 *     the series takes the same factor e^{2πis}: so the series misses a
 *     term of size about |Γ(s)(1 − e^{±2πis})| = 2π·|e^{±iπs}|/|Γ(1 − s)|,
 *     at most 2π·e^{π|Im s|}/|Γ(1 − s)|, which must be below 1e−16 of the
 *     value.
 *  The prefactor z^{s−1}e^{−z} is one exponential (see `powExpMul`): e^{−z}
 *  alone overflows for Re z < −709 when the value does not (Γ(−5, −712)
 *  ≈ 1.28e292). */
function upperGammaAsymptoticComplex(s: Complex, z: Complex): Complex {
  let term = C_ONE; // k = 0
  let sum = C_ONE;
  let converged = false;
  for (let k = 1; k < 1000; k++) {
    const next = term.mul(s.sub(k)).div(z); // term_k = term_{k−1}·(s−k)/z
    if (next.abs() > term.abs()) break; // the terms start to grow
    term = next;
    sum = sum.add(term);
    if (term.abs() < 1e-17 * sum.abs()) {
      converged = true;
      break;
    }
  }
  if (!converged) return C_NAN;
  const sm1 = s.sub(1);
  const logValue = logPowPrincipal(z, sm1)[0] - z.re + Math.log(sum.abs());
  const logOmitted =
    Math.log(2 * Math.PI) + Math.PI * Math.abs(s.im) - gammaln(C_ONE.sub(s)).re;
  if (!(logOmitted - logValue < Math.log(1e-16))) return C_NAN;
  const v = powExpMul(z, sm1, z.neg(), sum);
  return Number.isFinite(v.re) && Number.isFinite(v.im) ? v : C_NAN;
}

/** Upper incomplete gamma Γ(s, z), complex, Legendre continued fraction
 *  (modified Lentz). The fraction converges in the plane cut along the
 *  negative real axis, for every s. Returns NaN when it has not converged
 *  after 2000 steps. */
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
    // z^s·e^{−z}·h as one exponential (see `powExpMul`). NaN when it
    // overflows: the value is then not representable.
    if (del.sub(C_ONE).abs() < 1e-16) {
      const v = powExpMul(z, s, z.neg(), h);
      return Number.isFinite(v.re) && Number.isFinite(v.im) ? v : C_NAN;
    }
  }
  return C_NAN;
}

/** A series result is used without a fallback when its estimated relative
 *  rounding error (`seriesError`) is at most this (or at most twice the
 *  error bound of Γ(s), see `limitForOrder`). Measured against mpmath on
 *  about 7500 points (random s and z, s next to a pole of Γ, |Im s| up to
 *  700): wherever the estimate is between 1e−14 and 2e−12 (the range in
 *  which this limit and `SERIES_DECLINE_LIMIT` decide), the actual error of
 *  the direct series was at most 0.87 times the estimate and that of the
 *  Kummer form at most 0.98 times. For a larger estimate (1e−7, next to a
 *  pole) the actual error reached 1.2 times the estimate. */
const SERIES_ERROR_LIMIT = 3e-13;

/** A direct-series result whose estimated rounding error, relative to the
 *  larger of |value| and |z^{s−1}e^{−z}|, is above this is not returned:
 *  the kernel declines (NaN) rather than give fewer than about 12 correct
 *  digits. */
const SERIES_DECLINE_LIMIT = 1e-12;

/** Estimated relative rounding error of a series result: ε·scale/|value|,
 *  plus 8ε for the rounding of the final subtraction and of the result. */
function seriesError(r: { value: Complex; scale: number }): number {
  return Number.EPSILON * (r.scale / r.value.abs() + 8);
}

/** The limit `limit` on a relative error, raised to twice the error bound
 *  of `gamma(s)` (`gammaErrorWeight`) when that is larger: a value that is
 *  mostly Γ(s) cannot be more accurate than Γ(s). The bound reaches 3e−13
 *  at |s| ≈ 11 and 1e−12 at |s| ≈ 155. */
function limitForOrder(limit: number, s: Complex): number {
  return Math.max(limit, 2 * Number.EPSILON * gammaErrorWeight(s));
}

function seriesIfAccurate(
  r: { value: Complex; scale: number },
  s: Complex
): Complex {
  return seriesError(r) <= limitForOrder(SERIES_ERROR_LIMIT, s)
    ? r.value
    : C_NAN;
}

/**
 * Upper incomplete gamma Γ(s, z) for complex s and z (z ≠ 0), principal
 * branch. On the negative real axis a `+0` imaginary part (or a plain real
 * z) selects the upper lip of the cut and a `−0` imaginary part the lower
 * lip. NaN means "no accurate answer": the library then keeps the
 * expression symbolic.
 *
 * The series forms return an estimate of their rounding error
 * (`seriesError`), which counts the error of Γ(s) (`gammaErrorWeight`), of
 * each term (about k + 2 roundings for the k-th term) and of the power
 * z^s. A series result is used when that estimate is at most 3e−13, or at
 * most twice the error bound of Γ(s) when that is larger (`limitForOrder`).
 *
 * Region split:
 *   1. |z| + Re z ≤ 3: the direct series Γ(s) − z^s Σ (−z)^k/(k!(s+k)). Its
 *      cancellation factor is about e^{|z| + Re z}, so this region is where
 *      it is accurate: a parabola-shaped band around the negative real axis
 *      that includes the disk |z| ≤ 1.5. For |z| > 700 the terms would
 *      overflow, and the asymptotic series is used instead (it declines
 *      when its error cannot be made small; see
 *      `upperGammaAsymptoticComplex`). When the estimate is too large (s
 *      close to a non-positive integer, where Γ(s) and one term of the
 *      series are both large and cancel), the kernel tries the Kummer form
 *      with the same check if |Im s| > 10, or else the continued fraction
 *      (not on the cut, where it does not converge, and not for |z| < 0.1).
 *      Last, it accepts the direct series if its estimated error is at most
 *      1e−12 relative to the value (or to the derivative, next to a zero of
 *      Γ(s, ·)), and otherwise declines. Next to a pole the decline depends
 *      on z as well as on the distance to the pole: on 3000 points with s
 *      within 1e−9 to 1e−2 of −n (n = 0 … 8) and z in this band, the kernel
 *      answered 2328 (from 60% at a distance of 1e−9 to 98% at 1e−3), all
 *      with an error of at most 4.5e−13.
 *   2. |Im s| > 10, |z| < 3|s|, and either Re z < 0 or (Re s < 0 and
 *      |z| < |s| + 1): the continued fraction loses up to all its digits
 *      here, although it converges (at s = −0.41 − 23.9i, z = 0.088 − 4.0i
 *      its error was 2e−8). The direct series or the Kummer form is used when
 *      its estimate passes the check; otherwise the kernel declines.
 *   3. |z| ≥ |s| + 1 or Re s < 0: the Legendre continued fraction. It
 *      converges in the whole cut plane; at the edge of region 1 it needs
 *      about 60 steps.
 *   4. Otherwise (|z| < |s| + 1 with Re s ≥ 0): Γ(s) − γ(s, z) with the
 *      Kummer form of γ, whose terms decrease when |z| < |s|.
 * The power z^s and the factor e^{−z} are combined into one exponential
 * (`powExpMul`), so that a result is outside the range of doubles only when
 * the value is; a value above that range is NaN.
 *
 * Measured against mpmath (`gammainc`, 30 to 60 digits):
 *   - for s in {−9, −5, −2, −1, 0, 1, 3, ±1/2, −0.7, −1.5, −2.2, −3.1, 0.3,
 *     2.5, 4.7, −2+i, 1.5−0.5i, 0.5+2i} and |z| from 1 to 150 in every
 *     direction (including both lips of the negative real axis): no decline,
 *     and a relative error below 5e−14 (below 3e−14 for |z| > 5);
 *   - on 2500 random points with |Re s| ≤ 30, |Im s| ≤ 30 and
 *     0.01 ≤ |z| ≤ 600: 87 declines (86 in region 2), and an error below
 *     1.7e−13 wherever the kernel answers;
 *   - on 1400 points with |Im s| from 3 to 30 and |Re z| ≤ 4 (both
 *     half-planes): 55 declines, error below 3.7e−13;
 *   - on 433 points with |s| up to 700 and |z| up to 800, and 344 points
 *     with 700 ≤ |z| ≤ 1200 near the negative real axis: error below
 *     1.2e−12, which is the accuracy of Γ(s) at |s| ≈ 700.
 * On all of these, the error was at most 0.66 times the bound that
 * `incompleteGammaUpperComplexErrorBound` states.
 */
export function incompleteGammaUpperComplex(s: Complex, z: Complex): Complex {
  if (s.isNaN() || z.isNaN()) return C_NAN;
  if (z.isZero()) return gamma(s);

  const az = z.abs();
  const sAbs = s.abs();

  const cfApplies = az >= sAbs + 1 || s.re < 0;

  // Region 1: near the negative real axis, or small |z|.
  if (az + z.re <= 3) {
    if (az > 700) return upperGammaAsymptoticComplex(s, z);
    const direct = upperGammaDirectSeriesComplex(s, z);
    if (seriesError(direct) <= limitForOrder(SERIES_ERROR_LIMIT, s))
      return direct.value;
    const onCut = z.im === 0 && z.re < 0;
    if (Math.abs(s.im) > 10) {
      // The continued fraction loses up to all its digits here, as in
      // region 2.
      const kummer = seriesIfAccurate(upperGammaKummerComplex(s, z), s);
      if (!kummer.isNaN()) return kummer;
    } else if ((cfApplies || sAbs < 1) && !onCut && az >= 0.1) {
      // Not for |z| < 0.1: next to a pole of Γ(s) the fraction then has
      // errors up to 3.5e−12 (s = −4 + 2e−8, z = 0.032 + 0.0006i), while for
      // 0.1 ≤ |z| its error stayed below 4e−13 on 1500 points with s within
      // 1e−2 of a pole. The fraction has no error estimate of its own.
      const cf = upperGammaCFComplex(s, z);
      if (!cf.isNaN()) return cf;
    }
    // Near a zero of Γ(s, ·) no method has a small relative error, so the
    // decline test measures the absolute error against |z^{s−1}e^{−z}|, the
    // modulus of the derivative ∂Γ(s, z)/∂z, times min(|z|, 1): an answer
    // passes when it is the exact value at a point within about
    // 1e−12·min(|z|, 1) of z. The factor min(|z|, 1) keeps this test from
    // passing a large relative error for a small |z| next to a pole of Γ(s)
    // (at s = −2 + 3e−8, z = 0.0044 − 0.0096i the derivative is 250 times
    // the value, and the error estimate 1e−10 would have passed without it).
    // When s is close to a non-positive integer the error scales with |Γ(s)|
    // instead, and fails.
    const slope = powExpAbs(z, s.sub(1), z.neg(), Math.min(az, 1));
    return Number.EPSILON * direct.scale <=
      limitForOrder(SERIES_DECLINE_LIMIT, s) *
        Math.max(direct.value.abs(), slope)
      ? direct.value
      : C_NAN;
  }

  // Region 2: large imaginary part of s, |z| < 3|s|, and either Re z < 0
  // or (Re s < 0 and |z| < |s| + 1).
  if (
    Math.abs(s.im) > 10 &&
    az < 3 * sAbs &&
    (z.re < 0 || (s.re < 0 && az < sAbs + 1))
  ) {
    const direct = seriesIfAccurate(upperGammaDirectSeriesComplex(s, z), s);
    if (!direct.isNaN()) return direct;
    return seriesIfAccurate(upperGammaKummerComplex(s, z), s);
  }

  // Region 3.
  if (cfApplies) return upperGammaCFComplex(s, z);

  // Region 4.
  return upperGammaKummerComplex(s, z).value;
}

/**
 * A bound on the relative error of a value that
 * `incompleteGammaUpperComplex(s, z)` returns (it does not apply to a NaN,
 * which means that the kernel declined). Away from a zero of Γ(s, ·) (where
 * no method has a small relative error) the bound is:
 *   - 3e−13, raised to twice the error bound of Γ(s) (`limitForOrder`)
 *     when that is larger: 4.3e−13 at |s| = 13, 5.2e−13 at |s| = 20 and
 *     2.9e−12 at |s| = 700;
 *   - where |z| + Re z ≤ 3 and s is next to a pole of Γ(s) at
 *     s = −n (n = 0, 1, 2, …), 4e−15/|s + n|, capped at the decline limit
 *     1e−12 (raised in the same way for a large |s|). There the direct
 *     series cancels and the kernel answers up to that limit.
 * Measured against mpmath's `gammainc` (40 and 60 digits): on 3000 points
 * next to the poles (n from 0 to 8, |s + n| from 1e−9 to 1e−2, z in that
 * band) the error was at most 4.5e−13 and the error times |s + n| at most
 * 9e−16; on all the sweeps (14800 answered points with |Re s| ≤ 150,
 * |Im s| ≤ 700 and 0.01 ≤ |z| ≤ 1200) the error was at most 0.66 times
 * this bound.
 */
export function incompleteGammaUpperComplexErrorBound(
  s: Complex,
  z: Complex
): number {
  const base = limitForOrder(3e-13, s);
  if (z.abs() + z.re > 3) return base;
  const n = Math.min(0, Math.round(s.re));
  const distance = Math.hypot(s.re - n, s.im);
  if (distance === 0) return base;
  return Math.max(
    base,
    Math.min(limitForOrder(SERIES_DECLINE_LIMIT, s), 4e-15 / distance)
  );
}

//
// ---------------- Exponential / trigonometric integrals (complex) ----------------
//
// Ei, Si and Ci for complex arguments, all built on E₁(z) = Γ(0, z) via
// `incompleteGammaUpperComplex(C_ZERO, ·)` so they inherit its region split
// and its accuracy.
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
// Accuracy tracks the incomplete-Γ kernel: measured against mpmath off the
// real axis for |z| up to 60, the relative error is below 1e-14.
//

/** E₁(z) = Γ(0, z), routed through the incomplete-gamma dispatcher, which
 *  picks a method without catastrophic cancellation for each z.
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
// mpmath (erf/erfi) for |z| up to 25 in every direction: the relative error is
// below 2e-13.
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
  const n = Math.max(8, Math.ceil(emEdge(s) - a.re));
  const negS = s.neg();
  let sum = C_ZERO;
  for (let k = 0; k < n; k++) {
    const b = new Complex(a.re + k, a.im);
    if (b.re === 0 && b.im === 0) continue;
    sum = sum.add(b.pow(negS));
  }
  const z = new Complex(a.re + n, a.im);
  const zNegS = z.pow(negS);
  sum = sum.add(z.pow(C_ONE.sub(s)).div(s.sub(1))).add(zNegS.mul(0.5));

  // Σ_{k≥1} cₖ·(s)_{2k-1}·z^{-(s+2k-1)}, rolling the Pochhammer and z-power.
  let zPow = zNegS.div(z);
  const zInv2 = z.pow(-2);
  let poch = s;
  for (let k = 1; k <= EM_PAIRS; k++) {
    sum = sum.add(poch.mul(zPow).mul(EM_COEFF[k]));
    const m = 2 * k;
    poch = poch.mul(s.add(m - 1)).mul(s.add(m));
    zPow = zPow.mul(zInv2);
  }
  return sum;
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
 * cot(πz) for Im(z) >= 0, from q = e^(2πiz): cot(πz) = −i·(1 + q)/(1 − q).
 * The real part of z is first reduced modulo 1 to x, |x| <= 1/2 (cot(πz)
 * has period 1, and the reduction of a double is exact), so a large Re(z)
 * costs nothing and loses no digits. For a large Im(z), q is tiny and the
 * quotient is close to −i without the overflow of sin/cos at a large
 * imaginary argument.
 *
 * With a = 2π·Im(z) and e = e^(−a), the parts of 1 ± q are formed from
 * sin(πx) and cos(πx) as sums of non-negative terms:
 * 1 + q = (1 − e) + 2e·cos²(πx) + 2i·e·sin(πx)·cos(πx), and
 * 1 − q = (1 − e) + 2e·sin²(πx) − 2i·e·sin(πx)·cos(πx).
 * So neither cancels when q is close to 1 (z close to an integer) or to −1
 * (z close to a half-integer), where Im(z) small makes 1 − e small too.
 * cos(πx) is computed as sin(π·(1/2 − |x|)), which is exactly 0 at a
 * half-integer.
 */
function cotPiUpperHalfPlane(z: Complex): Complex {
  const x = z.re - Math.round(z.re);
  const e = Math.exp(-2 * Math.PI * z.im);
  const oneMinusE = -Math.expm1(-2 * Math.PI * z.im);
  const sx = Math.sin(Math.PI * x);
  const cx = Math.sin(Math.PI * (0.5 - Math.abs(x)));
  const im = 2 * e * sx * cx;
  const onePlusQ = new Complex(oneMinusE + 2 * e * cx * cx, im);
  const oneMinusQ = new Complex(oneMinusE + 2 * e * sx * sx, -im);
  const r = complexDivide(onePlusQ, oneMinusQ);
  return new Complex(r.im, -r.re); // −i·r
}

/**
 * The principal logarithm ln|z| + i·arg(z). `Complex.log()` squares the parts
 * of z (halved) to form ln|z|, which overflows to `∞` once a part is above
 * about 1e154. Here the parts are scaled by a power of two first.
 */
function complexLog(z: Complex): Complex {
  const k = pairExponent(z.re, z.im);
  const abs = Math.hypot(
    scaleByPowerOfTwo(z.re, -k),
    scaleByPowerOfTwo(z.im, -k)
  );
  return new Complex(Math.log(abs) + k * Math.LN2, Math.atan2(z.im, z.re));
}

/**
 * ψ(z) for Re(z) >= 1/2: the derivative of `gammaln`'s Stirling series,
 * ψ(w) ~ ln w − 1/(2w) − Σ_{k>=1} B₂ₖ/(2k) w^(−2k) for a large w, reached by
 * the recurrence ψ(z) = ψ(z+n) − Σ_{k<n} 1/(z+k) with at most
 * `DIGAMMA_SHIFT` steps. The tail is built from powers of 1/w², so a huge w
 * makes its terms underflow to 0 (where they are negligible) instead of
 * overflowing the powers of w.
 */
function digammaRightHalfPlane(z: Complex): Complex {
  const n = Math.max(0, Math.ceil(DIGAMMA_SHIFT - z.re));
  let shift = C_ZERO;
  for (let k = 0; k < n; k++)
    shift = shift.add(complexInverse(new Complex(z.re + k, z.im)));
  const w = new Complex(z.re + n, z.im);
  const inv = complexInverse(w);
  const inv2 = inv.mul(inv);
  let r = complexLog(w).sub(inv.mul(0.5)); // ln w − 1/(2w)
  let p = inv2; // w^(−2k)
  for (let k = 1; k < DIGAMMA_COEFF.length; k++) {
    r = r.sub(p.mul(DIGAMMA_COEFF[k]));
    p = p.mul(inv2);
  }
  return r.sub(shift);
}

/**
 * ψ(z) for a complex z with Im(z) >= 0. Left of Re(z) = 1/2 it uses the
 * reflection formula ψ(z) = ψ(1 − z) − π·cot(πz) (DLMF 5.5.4), so the cost
 * does not grow with −Re(z) and the recurrence never sums across the left
 * half-plane.
 */
function digammaComplex(z: Complex): Complex {
  if (z.re < 0.5)
    return digammaRightHalfPlane(new Complex(1 - z.re, -z.im)).sub(
      cotPiUpperHalfPlane(z).mul(Math.PI)
    );
  return digammaRightHalfPlane(z);
}

/**
 * A complex value `m·2^e`, with `e` an integer. The polygamma of a high
 * order is `m!` times a Hurwitz zeta value: either factor alone can be far
 * outside the range of a double (100! ≈ 9e157, ζ(101, 10⁴) ≈ 1e−404) while
 * their product is not. The binary exponent is carried in `e` so that no
 * intermediate value overflows or underflows.
 */
interface ScaledComplex {
  m: Complex;
  e: number;
}

const SCALED_ZERO: ScaledComplex = { m: C_ZERO, e: 0 };

/** Move the binary exponent of the larger part of `x.m` into `x.e`. */
function scaledNormalize(x: ScaledComplex): ScaledComplex {
  const k = pairExponent(x.m.re, x.m.im);
  if (k === 0) return x;
  return {
    m: new Complex(
      scaleByPowerOfTwo(x.m.re, -k),
      scaleByPowerOfTwo(x.m.im, -k)
    ),
    e: x.e + k,
  };
}

function scaledMul(x: ScaledComplex, c: Complex | number): ScaledComplex {
  return scaledNormalize({ m: x.m.mul(c), e: x.e });
}

function scaledAdd(a: ScaledComplex, b: ScaledComplex): ScaledComplex {
  if (a.m.isZero()) return b;
  if (b.m.isZero()) return a;
  const e = Math.max(a.e, b.e);
  return scaledNormalize({
    m: new Complex(
      scaleByPowerOfTwo(a.m.re, a.e - e) + scaleByPowerOfTwo(b.m.re, b.e - e),
      scaleByPowerOfTwo(a.m.im, a.e - e) + scaleByPowerOfTwo(b.m.im, b.e - e)
    ),
    e,
  });
}

/** log₂ |x|, or −∞ when x is 0. */
function scaledLog2Abs(x: ScaledComplex): number {
  return x.e + Math.log2(Math.hypot(x.m.re, x.m.im));
}

/** b^p for a real exponent p, as `ScaledComplex`: |b|^p is formed as a power
 * of two, so it cannot overflow or underflow. */
function scaledPow(b: Complex, p: number): ScaledComplex {
  const lg = complexLog(b); // ln|b| + i·arg(b)
  const l2 = (p * lg.re) / Math.LN2;
  const e = Math.floor(l2);
  const mag = 2 ** (l2 - e);
  const phase = p * lg.im;
  return { m: new Complex(mag * Math.cos(phase), mag * Math.sin(phase)), e };
}

/**
 * ζ(s, a) for an integer s >= 2 and Re(a) >= 0, a ≠ 0, as `ScaledComplex`:
 * the same Euler-Maclaurin sum as `hurwitzEMComplex` (direct terms up to a
 * base point, then the integral, the half-term and the Bernoulli
 * corrections), with every term carried in scaled form.
 *
 * With Re(a) >= 0 every base a + k lies in the closed right half-plane, and
 * the sum does not cancel: ζ(s, a) is at least comparable to its largest
 * term. `largestLog2` is log₂ of the largest term magnitude, so that the
 * caller can check this (see `POLYGAMMA_CANCELLATION_LIMIT`).
 */
function hurwitzZetaScaled(
  s: number,
  a: Complex
): { value: ScaledComplex; largestLog2: number } {
  const n = Math.max(8, Math.ceil(emEdge(new Complex(s, 0)) - a.re));
  let sum = SCALED_ZERO;
  let largestLog2 = -Infinity;
  const add = (t: ScaledComplex) => {
    sum = scaledAdd(sum, t);
    largestLog2 = Math.max(largestLog2, scaledLog2Abs(t));
  };
  for (let k = 0; k < n; k++) {
    const b = new Complex(a.re + k, a.im);
    if (b.re === 0 && b.im === 0) continue;
    add(scaledPow(b, -s));
  }
  const z = new Complex(a.re + n, a.im);
  const zInv = complexInverse(z);
  const zNegS = scaledPow(z, -s);
  add(scaledMul(scaledPow(z, 1 - s), 1 / (s - 1)));
  add(scaledMul(zNegS, 0.5));
  // Σ_{k≥1} cₖ·(s)_{2k-1}·z^{-(s+2k-1)}, rolling the Pochhammer and z-power.
  let zPow = scaledMul(zNegS, zInv);
  const zInv2 = zInv.mul(zInv);
  let poch = s;
  for (let k = 1; k <= EM_PAIRS; k++) {
    add(scaledMul(zPow, poch * EM_COEFF[k]));
    poch *= (s + 2 * k - 1) * (s + 2 * k);
    zPow = scaledMul(zPow, zInv2);
  }
  return { value: sum, largestLog2 };
}

function scaledTimes(a: ScaledComplex, b: ScaledComplex): ScaledComplex {
  return scaledNormalize({ m: a.m.mul(b.m), e: a.e + b.e });
}

/**
 * −π·dᵐ/dzᵐ cot(πz) for m >= 1 and Im(z) >= 0, with log₂ of the largest
 * magnitude added to form it. `factorial` is m! in scaled form. Two series
 * give this value, and each one cancels in a different region, so the one
 * with the smaller largest term is used:
 *
 * - The partial-fraction series (DLMF 4.22.3, differentiated m times):
 *   −π·dᵐ/dzᵐ cot(πz) = (−1)^(m+1)·m!·Σ_{n∈ℤ} (z+n)^(−s), s = m + 1. It
 *   depends only on z modulo 1: with z' = z − ⌊Re z⌋, the sum is
 *   ζ(s, z') + (−1)^s·ζ(s, 1−z'). Its two halves cancel when Im(z) is large
 *   compared with m, because the value is then exponentially small.
 * - The Fourier series in q = e^(2πiz) (from cot(πz) = −i − 2i·Σ_{n>=1} qⁿ):
 *   −π·dᵐ/dzᵐ cot(πz) = (2πi)^s·Σ_{n>=1} nᵐ·qⁿ. Its terms are largest near
 *   n = m/(2π·Im z), so it cancels when Im(z) is small compared with m.
 * - For m <= `COT_POLYNOMIAL_MAX_ORDER`, a polynomial in c = cot(πz):
 *   dᵐ/dzᵐ cot(πz) = Pₘ(c), with P₀(c) = c and
 *   Pₖ₊₁(c) = −π·(1 + c²)·Pₖ′(c) (from d/dz cot(πz) = −π·(1 + c²)). Its
 *   terms cancel when c is close to ±i (a large Im z), but not when c is
 *   small. c is small near a half-integer z, where both series above
 *   cancel when Im(z) is also small: the two halves of the partial-fraction
 *   series are then near-conjugates, and the Fourier series has too many
 *   terms.
 */
function cotDerivativeTerm(
  m: number,
  z: Complex,
  factorial: ScaledComplex
): { value: ScaledComplex; largestLog2: number } {
  const s = m + 1;
  const sign = m % 2 === 0 ? -1 : 1; // (−1)^(m+1), which is also (−1)^s
  const zr = new Complex(z.re - Math.floor(z.re), z.im);
  const near = hurwitzZetaScaled(s, zr);
  const nearReflected = hurwitzZetaScaled(s, new Complex(1 - zr.re, -zr.im));
  const partialFractions = {
    value: scaledMul(
      scaledTimes(
        scaledAdd(near.value, scaledMul(nearReflected.value, sign)),
        factorial
      ),
      sign
    ),
    largestLog2:
      scaledLog2Abs(factorial) +
      Math.max(near.largestLog2, nearReflected.largestLog2),
  };
  const lossOf = (x: { value: ScaledComplex; largestLog2: number }) =>
    x.largestLog2 - scaledLog2Abs(x.value);
  if (lossOf(partialFractions) <= 4) return partialFractions;
  let best = partialFractions;
  for (const other of [cotFourierTerm(m, z), cotPolynomialTerm(m, z)])
    if (other !== undefined && lossOf(other) < lossOf(best)) best = other;
  return best;
}

/**
 * The Fourier series of `cotDerivativeTerm`, or `undefined` when Im(z) is 0
 * or so small that the series needs too many terms. Term n has log₂
 * magnitude (m·ln n − 2π·n·Im z)/ln 2 and phase 2π·n·x, where x is Re(z)
 * reduced modulo 1. The sum goes past the largest term until the terms are
 * 2⁻⁶⁴ of it.
 */
function cotFourierTerm(
  m: number,
  z: Complex
): { value: ScaledComplex; largestLog2: number } | undefined {
  if (z.im <= 0) return undefined;
  const s = m + 1;
  const x = z.re - Math.round(z.re);
  const peak = m / (2 * Math.PI * z.im);
  if (peak > 100_000) return undefined;
  let sum = SCALED_ZERO;
  let largest = -Infinity;
  for (let n = 1; ; n++) {
    if (n > 1_000_000) return undefined;
    const l2 = (m * Math.log(n) - 2 * Math.PI * n * z.im) / Math.LN2;
    if (n > peak && l2 < largest - 64) break;
    largest = Math.max(largest, l2);
    const e = Math.floor(l2);
    const mag = 2 ** (l2 - e);
    const phase = 2 * Math.PI * ((n * x) % 1);
    sum = scaledAdd(sum, {
      m: new Complex(mag * Math.cos(phase), mag * Math.sin(phase)),
      e,
    });
  }
  // (2πi)^s = (2π)^s·i^s
  const iPower = [
    C_ONE,
    new Complex(0, 1),
    new Complex(-1, 0),
    new Complex(0, -1),
  ][s % 4];
  const twoPiS = scaledPow(new Complex(2 * Math.PI, 0), s);
  return {
    value: scaledMul(scaledTimes(sum, twoPiS), iPower),
    largestLog2: largest + scaledLog2Abs(twoPiS),
  };
}

/** The highest order for which `cotPolynomialTerm` is tried. At order 100
 * the largest coefficient is about 2e217 and the sum of |aⱼ|·4ʲ about 2e269;
 * from order 120 on they overflow a double. */
const COT_POLYNOMIAL_MAX_ORDER = 100;

/**
 * −π·Pₘ(cot(πz)) = −π·dᵐ/dzᵐ cot(πz) for Im(z) >= 0, with log₂ of the largest
 * magnitude added by the Horner evaluation (the sum of |aⱼ|·|c|ʲ), or
 * `undefined` when m is above `COT_POLYNOMIAL_MAX_ORDER` or |c| > 4 (where
 * the partial-fraction series does not cancel). See `cotDerivativeTerm`.
 */
function cotPolynomialTerm(
  m: number,
  z: Complex
): { value: ScaledComplex; largestLog2: number } | undefined {
  if (m > COT_POLYNOMIAL_MAX_ORDER) return undefined;
  const c = cotPiUpperHalfPlane(z);
  const cAbs = Math.hypot(c.re, c.im);
  if (!(cAbs <= 4)) return undefined;
  // Coefficients of Pₖ, lowest degree first. Pₖ has degree k + 1.
  let a = [0, 1];
  for (let k = 0; k < m; k++) {
    const next = new Array<number>(a.length + 1).fill(0);
    for (let j = 1; j < a.length; j++) {
      const b = -Math.PI * j * a[j]; // −π·(coefficient of c^(j−1) in Pₖ′)
      next[j - 1] += b;
      next[j + 1] += b;
    }
    a = next;
  }
  let value = C_ZERO;
  let bound = 0;
  for (let j = a.length - 1; j >= 0; j--) {
    value = value.mul(c).add(a[j]);
    bound = bound * cAbs + Math.abs(a[j]);
  }
  return {
    value: scaledNormalize({ m: value.mul(-Math.PI), e: 0 }),
    largestLog2: Math.log2(Math.PI * bound),
  };
}

/**
 * A safety net: the largest magnitude added to form the result of
 * `polygammaComplex` (m >= 1) may be at most this many times the magnitude of
 * the result. A larger ratio means that most of the digits cancelled, and
 * the result is not trusted (the polygamma stays symbolic). The sums of
 * `hurwitzZetaScaled` have Re(a) >= 0 and do not cancel, and
 * `cotDerivativeTerm` uses the series that cancels less, so this is expected
 * to trigger only close to a zero of ψ⁽ᵐ⁾. The direct sum across the left
 * half-plane, used before the reflection formula, tripped it often.
 */
const POLYGAMMA_CANCELLATION_LIMIT = 100;

/**
 * The highest order `polygammaComplex` computes. The cost of the
 * Euler-Maclaurin sum grows linearly with the order (about m + 6 direct
 * terms), so a higher order stays symbolic instead of running for a long
 * time. At such an order the value is representable as a double only in a
 * narrow band of |z| near m/e. The real kernels `polygamma` and
 * `bigPolygamma` (`numerics/special-functions.ts`) use the same limit.
 */
export const POLYGAMMA_MAX_ORDER = 10_000;

/**
 * ψ⁽ᵐ⁾(z) for a complex z and integer order m >= 0, matching mpmath's
 * `polygamma`/Wolfram's `PolyGamma` (poles at the non-positive integers).
 * Callers keep a real non-positive-integer z symbolic themselves — see
 * `polygammaValueAtExceptionalPoint` in `library/arithmetic.ts`.
 *
 * - ψ⁽ᵐ⁾ is real on the real axis, so ψ⁽ᵐ⁾(z̄) is the conjugate of ψ⁽ᵐ⁾(z),
 *   and the computation is done with Im(z) >= 0.
 * - m = 0: `digammaComplex`.
 * - m >= 1: ψ⁽ᵐ⁾(z) = (−1)^(m+1)·m!·ζ(m+1, z) (DLMF 5.15.2). For Re(z) >= 0
 *   ζ(s, z) is summed directly. For Re(z) < 0 the direct sum would take
 *   one term per unit of −Re(z), and its terms cancel. The reflection
 *   formula (DLMF 5.15.6) is used instead:
 *   ψ⁽ᵐ⁾(z) = −π·dᵐ/dzᵐ cot(πz) + (−1)^m·ψ⁽ᵐ⁾(1 − z)
 *           = −π·dᵐ/dzᵐ cot(πz) − m!·ζ(s, 1 − z), s = m + 1,
 *   with the derivative of cot from `cotDerivativeTerm`, which depends only
 *   on z modulo 1. Every sum then has Re(a) >= 0, so the cost does not
 *   depend on Re(z). (A closed form of the derivative as a polynomial in
 *   cot(πz) was not used: its coefficients grow like m!, and they cancel
 *   when cot(πz) is close to ±i, which is the case for a large |Im z|.)
 * - The factor m! and the zeta values are carried in scaled form. A result
 *   that is not finite, or whose magnitude is below the smallest normal
 *   double, is not representable to full precision: the answer is NaN (the
 *   caller keeps the expression symbolic) rather than ±∞ or 0.
 */
export function polygammaComplex(m: number, z: Complex | number): Complex {
  const c = typeof z === 'number' ? new Complex(z, 0) : z;
  if (!Number.isInteger(m) || m < 0 || m > POLYGAMMA_MAX_ORDER) return C_NAN;
  if (!Number.isFinite(c.re) || !Number.isFinite(c.im)) return C_NAN;
  if (c.im === 0 && c.re <= 0 && Number.isInteger(c.re)) return C_NAN; // pole
  if (c.im < 0) return polygammaComplex(m, c.conjugate()).conjugate();
  if (m === 0) return digammaComplex(c);

  const s = m + 1;
  const sign = m % 2 === 0 ? -1 : 1; // (−1)^(m+1), which is also (−1)^s
  let factorial: ScaledComplex = { m: C_ONE, e: 0 };
  for (let k = 2; k <= m; k++) factorial = scaledMul(factorial, k);
  const log2Factorial = scaledLog2Abs(factorial);

  // `largestLog2` is log₂ of the largest magnitude that was added to form
  // the result (see `POLYGAMMA_CANCELLATION_LIMIT`).
  let result: ScaledComplex;
  let largestLog2: number;
  if (c.re >= 0) {
    const direct = hurwitzZetaScaled(s, c);
    result = scaledMul(scaledTimes(direct.value, factorial), sign);
    largestLog2 = direct.largestLog2 + log2Factorial;
  } else {
    // ψ⁽ᵐ⁾(z) = −π·dᵐ/dzᵐ cot(πz) − m!·ζ(s, 1 − z)
    const far = hurwitzZetaScaled(s, new Complex(1 - c.re, -c.im));
    const cot = cotDerivativeTerm(m, c, factorial);
    result = scaledAdd(
      cot.value,
      scaledMul(scaledTimes(far.value, factorial), -1)
    );
    largestLog2 = Math.max(cot.largestLog2, far.largestLog2 + log2Factorial);
  }
  if (
    largestLog2 - scaledLog2Abs(result) >
    Math.log2(POLYGAMMA_CANCELLATION_LIMIT)
  )
    return C_NAN;

  const value = new Complex(
    scaleByPowerOfTwo(result.m.re, result.e),
    scaleByPowerOfTwo(result.m.im, result.e)
  );
  // `Math.hypot`, not `Complex.abs()`: the latter squares the parts, and
  // that underflows to 0 for a result near 1e−200.
  const size = Math.hypot(value.re, value.im);
  if (!Number.isFinite(size) || size < MIN_NORMAL_DOUBLE) return C_NAN;
  return value;
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

/**
 * The Gauss series Σₙ (a)ₙ(b)ₙ/((c)ₙ·n!)·zⁿ, with `big`, the magnitude of
 * its largest term. The ratio of `big` to the magnitude of the result
 * (after any prefactor) is the factor by which cancellation amplifies the
 * rounding errors of the terms. `converged` is false when the series
 * neither converged nor ended (a term exactly 0) within `maxTerms` terms.
 * A polynomial of degree N is summed with maxTerms = N: its last term is
 * then the N-th, and the result counts as complete.
 */
function gauss2F1SeriesC(
  a: Complex,
  b: Complex,
  c: Complex,
  z: Complex,
  maxTerms = 10_000
): { sum: Complex; big: number; converged: boolean } {
  // A small term ends the sum only from n = nMin on. Before, the terms
  // can shrink and then grow again: a negative c makes them grow near
  // n = −c, and the ratio of consecutive terms, about
  // |z|·(1 + (a+b−c−1)/n) for a large n, is above 1 until n is about
  // |z|·|a+b−c−1|/(1−|z|). With w = 1 − 1/(2.5 + i), ₂F₁(1, ½; −93.5; w)
  // has terms near 2e-37 at n = 50 and near 5e28 at n = 280.
  const zAbs = magC(z);
  const nMin = Math.max(
    3,
    -c.re,
    zAbs < 1 ? (zAbs * magC(a.add(b).sub(c).sub(1))) / (1 - zAbs) : Infinity
  );
  let term: Complex = C_ONE;
  let sum: Complex = C_ONE;
  let big = 1;
  for (let n = 0; n < maxTerms; n++) {
    const previous = magC(term);
    term = term
      .mul(a.add(n))
      .mul(b.add(n))
      .mul(z)
      .div(c.add(n).mul(n + 1));
    // A term of exactly 0 ends a polynomial (a + n or b + n is 0). Any
    // other 0 is an underflow, which ends the sum only from n = nMin on.
    if (term.isZero()) {
      const ends = a.add(n).isZero() || b.add(n).isZero() || n >= nMin;
      return { sum, big, converged: ends };
    }
    big = Math.max(big, magC(term));
    sum = sum.add(term);
    // A small term ends the sum only while the terms decrease: just after
    // n = −c the terms can grow again from a very small value.
    if (
      n >= nMin &&
      magC(term) < previous &&
      magC(term) <= Number.EPSILON * magC(sum)
    )
      return { sum, big, converged: true };
  }
  return { sum, big, converged: false };
}

/**
 * The value p₁·S₁ + p₂·S₂ of a connection formula (p₂ and S₂ may be
 * absent), and its loss: the larger of the largest term and the sum of
 * either series, times its prefactor, over the magnitude of the value.
 * The sum is included because, when the terms of a series have one sign,
 * its sum is many times its largest term, and the two parts p₁·S₁ and
 * p₂·S₂ can cancel each other. A zero prefactor (a pole of
 * Γ in its denominator) makes its series contribute nothing to either; a
 * series that did not converge makes the loss Infinity.
 * A loss that is not a finite number is Infinity, which rejects the value.
 */
function withLossC(
  p1: Complex,
  s1: { sum: Complex; big: number; converged: boolean },
  p2?: Complex,
  s2?: { sum: Complex; big: number; converged: boolean }
): { value: Complex; loss: number } {
  const part = (
    p: Complex,
    t: { sum: Complex; big: number; converged: boolean }
  ) =>
    p.isZero()
      ? 0
      : t.converged
        ? magC(p) * Math.max(t.big, magC(t.sum))
        : Infinity;
  let value = p1.isZero() ? C_ZERO : p1.mul(s1.sum);
  let big = part(p1, s1);
  if (p2 && s2) {
    if (!p2.isZero()) value = value.add(p2.mul(s2.sum));
    big = Math.max(big, part(p2, s2));
  }
  const loss = big / magC(value);
  return { value, loss: Number.isFinite(loss) ? loss : Infinity };
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

/**
 * Complex digamma ψ(z) = Γ′(z)/Γ(z): `polygammaComplex` of order 0. NaN at
 * the poles z = 0, −1, −2, …. It uses the reflection formula with a cot(πz)
 * that stays finite for a large |Im z|.
 */
function digammaC(z: Complex): Complex {
  return polygammaComplex(0, z);
}

/** |x|, without the underflow of `Complex.abs()` to 0 below about 1e-154. */
function magC(x: Complex): number {
  return Math.hypot(x.re, x.im);
}

/**
 * sign · exp(Σ logs) · ΠΓ(num) / ΠΓ(den). No argument may be a pole of Γ.
 *
 * When exp(Σ logs) and every Γ value are between 1e-80 and 1e80, the
 * product is formed directly. Otherwise it is formed as one exponential of
 * the sum of the logarithms (with `gammaln`), so that a quotient of very
 * large and very small factors, such as Γ(c)/(Γ(a+m)·Γ(b+m)) with m = 150
 * (about 1e260 in the numerator and in the denominator), does not overflow
 * or underflow before the factors cancel. The logarithmic form has a
 * relative error of about ε times the largest logarithm, which is why it is
 * used only when the direct form is out of range. A result too large for a
 * double is an infinity.
 */
function gammaProductC(
  logs: ReadonlyArray<Complex>,
  num: ReadonlyArray<Complex>,
  den: ReadonlyArray<Complex>,
  sign = 1
): Complex {
  let logSum: Complex = C_ZERO;
  for (const x of logs) logSum = logSum.add(x);
  const inRange = (x: Complex) => {
    const r = magC(x);
    return r > 1e-80 && r < 1e80;
  };
  if (Math.abs(logSum.re) < 180) {
    const gNum = num.map((x) => gamma(x));
    const gDen = den.map((x) => gamma(x));
    if (gNum.every(inRange) && gDen.every(inRange)) {
      let r = logSum.exp().mul(sign);
      for (const g of gNum) r = r.mul(g);
      for (const g of gDen) r = r.div(g);
      return r;
    }
  }
  let l = logSum;
  for (const x of num) l = l.add(gammaln(x));
  for (const x of den) l = l.sub(gammaln(x));
  return l.exp().mul(sign);
}

// The largest integer difference m evaluated with the logarithmic
// connection formulas. Measured against mpmath (2026-09-28) on five
// parameter families (both kinds of difference, |z| from 1.4 to 21): the
// relative error stays below 5e-13 up to m = 400, and grows to about 1e-12
// at m = 500 to 1000, because the logarithms of Γ that form the first term
// grow with m. A larger difference is treated as degenerate.
const LOG_CASE_MAX_M = 400;

// Every ₂F₁ map is a sum of terms that can cancel: a series whose terms
// alternate and grow before they decrease (a large parameter, or a
// negative third parameter), a connection formula whose two parts nearly
// cancel, or a logarithmic formula whose finite sum and series nearly
// cancel. The loss of a result is the ratio of its largest term to the
// result: the factor by which rounding errors are amplified. A result is
// accepted when its loss is at most HYP2F1_MAX_LOSS (12 to 13 correct
// digits); otherwise the next map is tried. If no map is accepted, the
// best rejected result is still returned when its loss is at most
// HYP2F1_FALLBACK_LOSS (about 11 digits). A polynomial is returned when
// its loss is at most HYP2F1_POLYNOMIAL_MAX_LOSS.
//
// Measured against mpmath (2026-09-28) on 700 points with an integer
// b − a or c − a − b (a, b ∈ [−25, 25], c ∈ [−25, 45], complex z with
// |z| from 0.2 to 4): a fallback bound of 1e6 answered 648 points, 34 of
// them with a relative error above 1e-12 (the largest 1.2e-10); the bound
// 1e4 answers 622 points, 9 above 1e-12 (the largest 7e-11). The
// prefactors (Γ of large arguments, powers) have relative errors of up to
// about 100ε, which the loss multiplies.
const HYP2F1_MAX_LOSS = 1e3;
const HYP2F1_FALLBACK_LOSS = 1e4;
const HYP2F1_POLYNOMIAL_MAX_LOSS = 1e6;

// The largest degree of a ₂F₁ polynomial (a or b a non-positive integer)
// that is summed: one million terms take about 0.3 s.
const HYP2F1_MAX_DEGREE = 1_000_000;

// The smallest |w| a logarithmic formula is ranked at when the maps are
// sorted (see `hypergeometric2F1Complex`). Measured against mpmath on
// degenerate parameters: 0.7 gave the smallest largest error (1.2e-14 on a
// grid of 540 points, against 3.2e-14 for 0.92 and 1.7e-14 for 0.8).
const LOG_CASE_MIN_RANK = 0.7;

/**
 * ₂F₁(a, b; c; z) through one of the four connection formulas of the
 * logarithmic (degenerate) case. These are the limits of the two-term
 * Γ-connection formulas when a parameter difference is an integer m ≥ 0;
 * each is a finite sum of m terms plus a series in the transformed argument
 * w that contains a logarithm and digamma values. All four give the
 * regularized function ₂F₁/Γ(c), and the result is multiplied by Γ(c).
 *
 * - `inv-z`, b = a + m, w = 1/z:
 *   ₂F₁/Γ(c) = (−z)^(−a)/Γ(a+m) · Σ_{k<m} (a)ₖ(m−k−1)!/(k!·Γ(c−a−k))·z^(−k)
 *     + (−z)^(−a)/Γ(a) · Σ_{k≥0} (a+m)ₖ/(k!(k+m)!·Γ(c−a−k−m))·(−1)ᵏz^(−k−m)
 *       · [ln(−z) + ψ(k+1) + ψ(k+m+1) − ψ(a+k+m) − ψ(c−a−k−m)]
 * - `inv-one-minus-z`, b = a + m, w = 1/(1−z):
 *   ₂F₁/Γ(c) = (1−z)^(−a)/(Γ(a+m)Γ(c−a))
 *       · Σ_{k<m} (a)ₖ(c−a−m)ₖ(m−k−1)!/k!·(z−1)^(−k)
 *     + (−1)^m·(1−z)^(−a−m)/(Γ(a)Γ(c−a−m)) · Σ_{k≥0} (a+m)ₖ(c−a)ₖ/(k!(k+m)!)
 *       ·(1−z)^(−k)·[ln(1−z) + ψ(k+1) + ψ(k+m+1) − ψ(a+k+m) − ψ(c−a+k)]
 * - `one-minus-z`, c = a + b + m, w = 1 − z:
 *   ₂F₁/Γ(c) = 1/(Γ(a+m)Γ(b+m)) · Σ_{k<m} (a)ₖ(b)ₖ(m−k−1)!/k!·(z−1)ᵏ
 *     − (z−1)^m/(Γ(a)Γ(b)) · Σ_{k≥0} (a+m)ₖ(b+m)ₖ/(k!(k+m)!)·(1−z)ᵏ
 *       · [ln(1−z) − ψ(k+1) − ψ(k+m+1) + ψ(a+k+m) + ψ(b+k+m)]
 * - `one-minus-inv-z`, c = a + b + m, w = 1 − 1/z:
 *   ₂F₁/Γ(c) = z^(−a)/Γ(a+m) · Σ_{k<m} (a)ₖ(m−k−1)!/(k!·Γ(b+m−k))·wᵏ
 *     − z^(−a)/Γ(a) · Σ_{k≥0} (a+m)ₖ/(k!(k+m)!·Γ(b−k))·(−1)ᵏw^(k+m)
 *       · [ln(1−z) − ln z − ψ(k+1) − ψ(k+m+1) + ψ(a+k+m) + ψ(b−k)]
 *
 * A digamma value at a pole of Γ appears only multiplied by a 1/Γ factor
 * with a zero at the same point. At such a pole x = −j (j = 0, 1, 2, …) the
 * limit of ψ(x)/Γ(x) is (−1)^(j+1)·j!, and the products are then carried
 * through recurrences that stay valid at the poles, so the cases c − a ∈ ℤ
 * (inv-z, inv-one-minus-z) and b ∈ ℤ (one-minus-inv-z) need no special
 * handling. The caller guarantees that a and b are not non-positive
 * integers (those are polynomials, evaluated directly).
 *
 * Every term carries its prefactor and the factor Γ(c): the first term of
 * each sum is formed by `gammaProductC` (in logarithms when the Γ values
 * are out of range) and the next terms by their ratio to the previous one.
 * The factors Γ(c), 1/Γ(a+m), (m−1)!, (a)ₖ and z^(−m) are each far outside
 * the range of a double for m near 150, but the terms they form are not.
 * A seed that is not finite (for example (−1)^(j+1)·j! with j > 170) gives
 * a NaN value, which the caller rejects.
 *
 * Provenance: DLMF 15.8.8, 15.8.9, 15.8.10 and 15.8.11 (A&S 15.3.10–15.3.14).
 */
function gauss2F1LogCaseC(
  kind: 'inv-z' | 'inv-one-minus-z' | 'one-minus-z' | 'one-minus-inv-z',
  a: Complex,
  b: Complex,
  c: Complex,
  m: number,
  z: Complex,
  maxTerms: number
): { value: Complex; loss: number } {
  const one = C_ONE;
  const mC = new Complex(m, 0); // Γ(m) = (m − 1)!
  const m1C = new Complex(m + 1, 0); // Γ(m + 1) = m!

  // ψ(k+1), ψ(k+m+1) and ψ(a+k+m), advanced by ψ(x+1) = ψ(x) + 1/x
  let psi1 = new Complex(-EULER_GAMMA, 0);
  let psiM = psi1;
  for (let i = 1; i <= m; i++) psiM = psiM.add(1 / i);
  let psiA = digammaC(a.add(m));

  // Finite sum Σ_{k<m} Uₖ, with U₀ given and U_{k+1} = Uₖ·ratio(k).
  // Returns the sum and its largest term magnitude.
  const finiteSum = (
    u0: Complex,
    ratio: (k: number) => Complex
  ): [Complex, number] => {
    let sum: Complex = C_ZERO;
    let big = 0;
    let u = u0;
    for (let k = 0; k < m; k++) {
      big = Math.max(big, magC(u));
      sum = sum.add(u);
      if (k + 1 < m) u = u.mul(ratio(k));
    }
    return [sum, big];
  };

  // A term that is not finite ends the series: the value is then NaN and
  // the caller rejects it.
  const done = (t: Complex, sum: Complex, k: number) =>
    !t.isFinite() || (k > 2 && magC(t) <= Number.EPSILON * magC(sum));

  // The value is finite + series, both already multiplied by Γ(c).
  let finite: Complex = C_ZERO;
  let finiteBig = 0;
  let series: Complex = C_ZERO;
  let seriesBig = 0;

  switch (kind) {
    case 'inv-z': {
      const mz = z.neg();
      const L = mz.log();
      const zInv = one.div(z);
      const ca = c.sub(a);
      const aLog = a.neg().mul(L); // ln of (−z)^(−a)
      // Uₖ = Γ(c)·(−z)^(−a)/Γ(a+m)·(a)ₖ(m−k−1)!/(k!·Γ(c−a−k))·z^(−k).
      // 1/Γ(c−a−k) is 0 from the first pole of Γ on: the ratio
      // 1/Γ(y−1) = (y−1)/Γ(y) keeps it 0, and when c − a itself is a pole
      // every term is 0.
      if (m > 0 && !isNonPositiveIntegerC(ca))
        [finite, finiteBig] = finiteSum(
          gammaProductC([aLog], [c, mC], [a.add(m), ca]),
          (k) =>
            a
              .add(k)
              .mul(ca.sub(k + 1))
              .mul(zInv)
              .div((m - k - 1) * (k + 1))
        );
      // Q = Γ(c)·(−z)^(−a)/Γ(a)·Pₖ/Γ(x−k) and S = Q·ψ(x−k), with
      // x = c−a−m and Pₖ = (a+m)ₖ(−1)ᵏz^(−k−m)/(k!(k+m)!). Since
      // 1/Γ(y−1) = (y−1)/Γ(y) and ψ(y−1) = ψ(y) − 1/(y−1), the next values
      // are Q' = r·(x−k−1)·Q and S' = r·((x−k−1)·S − Q), where
      // r = Pₖ₊₁/Pₖ. These recurrences also hold at the poles of Γ, where
      // S carries the finite limit.
      const x = ca.sub(m);
      const seriesLogs = [aLog, zInv.log().mul(m)];
      let Q: Complex;
      let S: Complex;
      if (isNonPositiveIntegerC(x)) {
        const j = -x.re;
        Q = C_ZERO;
        S = gammaProductC(
          seriesLogs,
          [c, new Complex(j + 1, 0)],
          [a, m1C],
          j % 2 === 0 ? -1 : 1
        );
      } else {
        Q = gammaProductC(seriesLogs, [c], [a, m1C, x]);
        S = Q.mul(digammaC(x));
      }
      for (let k = 0; k < maxTerms; k++) {
        const t = Q.mul(L.add(psi1).add(psiM).sub(psiA)).sub(S);
        seriesBig = Math.max(seriesBig, magC(t));
        series = series.add(t);
        if (done(t, series, k)) break;
        const r = a
          .add(m + k)
          .neg()
          .mul(zInv)
          .div((k + 1) * (k + m + 1));
        const xk = x.sub(k + 1);
        const nextQ = r.mul(xk).mul(Q);
        S = r.mul(xk.mul(S).sub(Q));
        Q = nextQ;
        psi1 = psi1.add(1 / (k + 1));
        psiM = psiM.add(1 / (k + m + 1));
        psiA = psiA.add(one.div(a.add(m + k)));
      }
      break;
    }

    case 'inv-one-minus-z': {
      const w1 = one.sub(z); // 1 − z
      const L = w1.log();
      const w1Inv = one.div(w1);
      const y = c.sub(a);
      // Uₖ = Γ(c)·(1−z)^(−a)/(Γ(a+m)Γ(c−a))·(a)ₖ(c−a−m)ₖ(m−k−1)!/k!
      //      ·(z−1)^(−k). Every term is 0 when c − a is a pole of Γ.
      if (m > 0 && !isNonPositiveIntegerC(y))
        [finite, finiteBig] = finiteSum(
          gammaProductC([a.neg().mul(L)], [c, mC], [a.add(m), y]),
          (k) =>
            a
              .add(k)
              .mul(y.sub(m - k))
              .mul(w1Inv.neg())
              .div((m - k - 1) * (k + 1))
        );
      // A = Γ(c)·(−1)^m(1−z)^(−a−m)/Γ(a)·Pₖ·(y)ₖ/Γ(y−m) and B = A·ψ(y+k),
      // with y = c − a and Pₖ = (a+m)ₖ(1−z)^(−k)/(k!(k+m)!). Since
      // ψ(y+k+1) = ψ(y+k) + 1/(y+k), the next values are A' = r·(y+k)·A and
      // B' = r·((y+k)·B + A), where r = Pₖ₊₁/Pₖ. B₀ contains the limit of
      // ψ(y)/Γ(y−m): when y is a non-positive integer it equals the limit
      // of ψ(y−m)/Γ(y−m); when y − m is a pole and y is not, it is 0.
      const ym = y.sub(m);
      const seriesLogs = [a.add(m).neg().mul(L)];
      const sign = m % 2 === 0 ? 1 : -1;
      let A: Complex = C_ZERO;
      let B: Complex = C_ZERO;
      if (!isNonPositiveIntegerC(ym)) {
        A = gammaProductC(seriesLogs, [c], [a, m1C, ym], sign);
        B = A.mul(digammaC(y));
      } else if (isNonPositiveIntegerC(y)) {
        const j = -ym.re;
        B = gammaProductC(
          seriesLogs,
          [c, new Complex(j + 1, 0)],
          [a, m1C],
          j % 2 === 0 ? -sign : sign
        );
      }
      for (let k = 0; k < maxTerms; k++) {
        const t = A.mul(L.add(psi1).add(psiM).sub(psiA)).sub(B);
        seriesBig = Math.max(seriesBig, magC(t));
        series = series.add(t);
        if (done(t, series, k)) break;
        const r = a
          .add(m + k)
          .mul(w1Inv)
          .div((k + 1) * (k + m + 1));
        const yk = y.add(k);
        const nextA = r.mul(yk).mul(A);
        B = r.mul(yk.mul(B).add(A));
        A = nextA;
        psi1 = psi1.add(1 / (k + 1));
        psiM = psiM.add(1 / (k + m + 1));
        psiA = psiA.add(one.div(a.add(m + k)));
      }
      break;
    }

    case 'one-minus-z': {
      const w = one.sub(z);
      const L = w.log();
      const zm1 = z.sub(1);
      // Uₖ = Γ(c)/(Γ(a+m)Γ(b+m))·(a)ₖ(b)ₖ(m−k−1)!/k!·(z−1)ᵏ
      if (m > 0)
        [finite, finiteBig] = finiteSum(
          gammaProductC([], [c, mC], [a.add(m), b.add(m)]),
          (k) =>
            a
              .add(k)
              .mul(b.add(k))
              .mul(zm1)
              .div((m - k - 1) * (k + 1))
        );
      // P = −Γ(c)·(z−1)^m/(Γ(a)Γ(b))·(a+m)ₖ(b+m)ₖ/(k!(k+m)!)·(1−z)ᵏ
      let psiB = digammaC(b.add(m));
      let P = gammaProductC([zm1.log().mul(m)], [c], [a, b, m1C], -1);
      for (let k = 0; k < maxTerms; k++) {
        const t = P.mul(L.sub(psi1).sub(psiM).add(psiA).add(psiB));
        seriesBig = Math.max(seriesBig, magC(t));
        series = series.add(t);
        if (done(t, series, k)) break;
        P = P.mul(a.add(m + k))
          .mul(b.add(m + k))
          .mul(w)
          .div((k + 1) * (k + m + 1));
        psi1 = psi1.add(1 / (k + 1));
        psiM = psiM.add(1 / (k + m + 1));
        psiA = psiA.add(one.div(a.add(m + k)));
        psiB = psiB.add(one.div(b.add(m + k)));
      }
      break;
    }

    case 'one-minus-inv-z': {
      const w = one.sub(one.div(z));
      // ln(1 − z) − ln z, not the principal ln((1 − z)/z): (1 − z)/z = −w
      // crosses the negative real axis inside |w| < 1, the difference of
      // the two logarithms does not.
      const L = one.sub(z).log().sub(z.log());
      const aLog = a.neg().mul(z.log()); // ln of z^(−a)
      // Uₖ = Γ(c)·z^(−a)/Γ(a+m)·(a)ₖ(m−k−1)!/(k!·Γ(b+m−k))·wᵏ, with
      // 1/Γ(b+m−k−1) = (b+m−k−1)/Γ(b+m−k).
      if (m > 0)
        [finite, finiteBig] = finiteSum(
          gammaProductC([aLog], [c, mC], [a.add(m), b.add(m)]),
          (k) =>
            a
              .add(k)
              .mul(b.add(m - k - 1))
              .mul(w)
              .div((m - k - 1) * (k + 1))
        );
      // Q = −Γ(c)·z^(−a)/Γ(a)·Pₖ/Γ(b−k) and S = Q·ψ(b−k), with
      // Pₖ = (a+m)ₖ(−1)ᵏw^(k+m)/(k!(k+m)!): the same recurrences as for
      // `inv-z`, with x = b. The caller guarantees b is not a pole.
      let Q = gammaProductC([aLog, w.log().mul(m)], [c], [a, m1C, b], -1);
      let S = Q.mul(digammaC(b));
      for (let k = 0; k < maxTerms; k++) {
        const t = Q.mul(L.sub(psi1).sub(psiM).add(psiA)).add(S);
        seriesBig = Math.max(seriesBig, magC(t));
        series = series.add(t);
        if (done(t, series, k)) break;
        const r = a
          .add(m + k)
          .neg()
          .mul(w)
          .div((k + 1) * (k + m + 1));
        const xk = b.sub(k + 1);
        const nextQ = r.mul(xk).mul(Q);
        S = r.mul(xk.mul(S).sub(Q));
        Q = nextQ;
        psi1 = psi1.add(1 / (k + 1));
        psiM = psiM.add(1 / (k + m + 1));
        psiA = psiA.add(one.div(a.add(m + k)));
      }
      break;
    }
  }

  const value = finite.add(series);
  // Ratio of the largest term to the result: the factor by which rounding
  // errors in the terms are amplified by cancellation. A ratio that is not
  // a finite number (a NaN or zero value) rejects the result.
  const loss = Math.max(finiteBig, seriesBig) / magC(value);
  return { value, loss: Number.isFinite(loss) ? loss : Infinity };
}

// Treat a parameter difference within this distance of an integer as
// degenerate: the two-term connection formulas have Γ-factors that blow up
// like 1/dist, so closer than this the cancellation destroys the result.
// A difference that is exactly an integer uses the logarithmic connection
// formulas (`gauss2F1LogCaseC`). A difference that is close to an integer
// but not equal to it is routed to another transformation or, for a
// difference close to 0 only, evaluated by averaging two
// parameter-perturbed evaluations (±1e-6); see the accuracy measured where
// that average is formed in `hypergeometric2F1Complex`.
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
 * and 1−1/z. When a parameter difference is an integer (a−b ∈ ℤ for the
 * 1/z and 1/(1−z) maps, c−a−b ∈ ℤ for the 1−z and 1−1/z maps), those maps
 * use the logarithmic connection formulas instead (`gauss2F1LogCaseC`), and
 * take part in the smallest-|w| choice like the others. A difference that is
 * within `DEGENERATE_TOL` of an integer without being one makes the map
 * unusable.
 *
 * Every result is checked for cancellation: the ratio of its largest term
 * to the result must be at most `HYP2F1_MAX_LOSS` (or `HYP2F1_FALLBACK_LOSS`
 * when no map meets that bound), otherwise the next map is tried. When no
 * map is accepted, the value is the average of two parameter-perturbed
 * evaluations if every integer parameter difference is 0 (accurate to
 * about 5e-10), and NaN otherwise.
 *
 * On the branch cut z ∈ (1, ∞) the principal branch is the limit from
 * below (the standard z − i0 convention).
 *
 * Returns NaN near z = e^{±iπ/3} (all maps have |w| ≈ 1 there), for a
 * polynomial of degree above `HYP2F1_MAX_DEGREE`, and when no map gives
 * about 10 correct digits.
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
  if (nTerms !== Infinity) {
    // A polynomial of degree nTerms. Above HYP2F1_MAX_DEGREE terms its sum
    // would take too long (a = −1e20 has 1e20 terms), and a result whose
    // terms cancel too much has no correct digits: both give NaN. A sum of
    // exactly 0 (₂F₁(−1, 1; 1; 1) = 1 − 1) is kept when its terms are at
    // most HYP2F1_POLYNOMIAL_MAX_LOSS, so that its absolute error is below
    // 1e-9.
    if (nTerms > HYP2F1_MAX_DEGREE) return C_NAN;
    const { sum, big } = gauss2F1SeriesC(a, b, c, z, nTerms);
    const limit = HYP2F1_POLYNOMIAL_MAX_LOSS * (sum.isZero() ? 1 : magC(sum));
    return big <= limit ? sum : C_NAN;
  }

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

  // An integer difference (up to LOG_CASE_MAX_M) uses the logarithmic
  // connection formulas; a difference that is only close to an integer
  // makes the map degenerate. A difference within a few rounding errors of
  // the parameters of an integer counts as that integer: 2.3 − 0.3 is
  // 1.9999999999999998 in doubles, and 2.6 − 0.3 − 2.3 is 4.4e-16.
  const intTol = 8 * Number.EPSILON * Math.max(1, a.abs(), b.abs(), c.abs());
  const isLogCase = (x: Complex) =>
    Math.abs(x.im) <= intTol &&
    Math.abs(x.re - Math.round(x.re)) <= intTol &&
    Math.abs(Math.round(x.re)) <= LOG_CASE_MAX_M;
  const sIsLogCase = isLogCase(s);
  const dIsLogCase = isLogCase(d);
  const sIsDegenerate = !sIsLogCase && distToIntegerC(s) <= DEGENERATE_TOL;
  const dIsDegenerate = !dIsLogCase && distToIntegerC(d) <= DEGENERATE_TOL;

  // The six Kummer maps, by transformed argument. `degenerate` marks maps
  // whose connection formula breaks down for the current parameters,
  // `logCase` those that use a logarithmic connection formula.
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
    logCase: boolean;
  }[] = [
    { kind: 'direct', w: z, degenerate: false, logCase: false },
    { kind: 'pfaff', w: z.div(z.sub(1)), degenerate: false, logCase: false },
    {
      kind: 'one-minus-z',
      w: one.sub(z),
      degenerate: sIsDegenerate,
      logCase: sIsLogCase,
    },
    {
      kind: 'inv-z',
      w: one.div(z),
      degenerate: dIsDegenerate,
      logCase: dIsLogCase,
    },
    {
      kind: 'inv-one-minus-z',
      w: one.div(one.sub(z)),
      degenerate: dIsDegenerate,
      logCase: dIsLogCase,
    },
    {
      kind: 'one-minus-inv-z',
      w: one.sub(one.div(z)),
      degenerate: sIsDegenerate,
      logCase: sIsLogCase,
    },
  ];
  // A logarithmic formula is ranked as if its |w| were at least
  // LOG_CASE_MIN_RANK: it loses one or two more digits than the two-term
  // formulas (its finite sum and its series partly cancel), so a map
  // without the logarithm is preferred while it converges quickly.
  const rank = (p: (typeof candidates)[number]) =>
    p.logCase ? Math.max(p.w.abs(), LOG_CASE_MIN_RANK) : p.w.abs();
  candidates.sort((p, q) => rank(p) - rank(q));

  let sawDegenerateCandidate = false;
  let best: { value: Complex; loss: number } | undefined;
  for (const cand of candidates) {
    const { kind, w } = cand;
    if (rank(cand) > W_MAX) break; // sorted: no further candidate fits
    if (cand.degenerate) {
      sawDegenerateCandidate = true;
      continue;
    }
    const maxTerms = w.abs() <= W_PREFERRED ? 10_000 : 250_000;

    if (
      cand.logCase &&
      (kind === 'inv-z' ||
        kind === 'inv-one-minus-z' ||
        kind === 'one-minus-z' ||
        kind === 'one-minus-inv-z')
    ) {
      const r = hypergeometric2F1LogCase(kind, a, b, c, z, maxTerms);
      if (r.value.isFinite() && Number.isFinite(r.loss)) {
        if (r.loss <= HYP2F1_MAX_LOSS) return r.value;
        if (!best || r.loss < best.loss) best = r;
      }
      sawDegenerateCandidate = true;
      continue;
    }

    const r = kummerMapC(kind, a, b, c, z, w, maxTerms);
    if (r.value.isFinite() && Number.isFinite(r.loss)) {
      if (r.loss <= HYP2F1_MAX_LOSS) return r.value;
      if (!best || r.loss < best.loss) best = r;
    }
  }

  if (best && best.loss <= HYP2F1_FALLBACK_LOSS) return best.value;

  // The largest integer (or nearly integer) difference that made a map
  // logarithmic or degenerate.
  const degenerateM = Math.max(
    sIsLogCase || sIsDegenerate ? Math.abs(Math.round(s.re)) : 0,
    dIsLogCase || dIsDegenerate ? Math.abs(Math.round(d.re)) : 0
  );

  // No map was accepted. When every integer (or nearly integer) parameter
  // difference is 0, the value is the average of two evaluations at
  // symmetrically perturbed parameters (±ε on a, ±ε√2 on c), which break
  // both a−b ∈ ℤ and c−a−b ∈ ℤ; averaging cancels the O(ε) error.
  // Measured against mpmath (2026-09-28) on a grid of 540 points
  // (a, b ∈ {−5/2, −1/2, 1/2, 3/2, 5/2}, c ∈ {1, 3/2, 9/4, 3}, nine z
  // outside the unit disk), each evaluated this way: the relative error is
  // at most 4.6e-10 when the integer differences are 0, but up to 2.4e-4
  // when one of them is 1 to 8 (above 1e-9 at 192 of those 432 points).
  // For a nonzero difference the function therefore returns NaN.
  if (depth === 0 && sawDegenerateCandidate && degenerateM === 0) {
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

/**
 * ₂F₁(a, b; c; z) through one of the Kummer maps that need no logarithm,
 * with the argument w of its series (A&S 15.3.4, 15.3.6–15.3.9), and the
 * loss of the result (see `withLossC`). The caller does not use a
 * connection formula when its parameter difference is an integer or close
 * to one.
 */
function kummerMapC(
  kind:
    | 'direct'
    | 'pfaff'
    | 'one-minus-z'
    | 'inv-z'
    | 'inv-one-minus-z'
    | 'one-minus-inv-z',
  a: Complex,
  b: Complex,
  c: Complex,
  z: Complex,
  w: Complex,
  maxTerms: number
): { value: Complex; loss: number } {
  const one = C_ONE;
  const s = c.sub(a).sub(b); // c − a − b
  const d = b.sub(a); // b − a
  switch (kind) {
    case 'direct':
      return withLossC(one, gauss2F1SeriesC(a, b, c, z, maxTerms));

    case 'pfaff':
      // A&S 15.3.4: (1−z)^{−a}·₂F₁(a, c−b; c; z/(z−1))
      return withLossC(
        one.sub(z).pow(a.neg()),
        gauss2F1SeriesC(a, c.sub(b), c, w, maxTerms)
      );

    case 'one-minus-z':
      // A&S 15.3.6, w = 1−z, s = c−a−b ∉ ℤ
      return withLossC(
        gammaRatioC([c, s], [c.sub(a), c.sub(b)]),
        gauss2F1SeriesC(a, b, one.sub(s), w, maxTerms),
        gammaRatioC([c, s.neg()], [a, b]).mul(w.pow(s)),
        gauss2F1SeriesC(c.sub(a), c.sub(b), one.add(s), w, maxTerms)
      );

    case 'inv-z':
      // A&S 15.3.7, w = 1/z, b−a ∉ ℤ
      return withLossC(
        gammaRatioC([c, d], [b, c.sub(a)]).mul(z.neg().pow(a.neg())),
        gauss2F1SeriesC(a, one.sub(c).add(a), one.sub(b).add(a), w, maxTerms),
        gammaRatioC([c, d.neg()], [a, c.sub(b)]).mul(z.neg().pow(b.neg())),
        gauss2F1SeriesC(b, one.sub(c).add(b), one.sub(a).add(b), w, maxTerms)
      );

    case 'inv-one-minus-z': {
      // A&S 15.3.8, w = 1/(1−z), b−a ∉ ℤ
      const oneMinusZ = one.sub(z);
      return withLossC(
        gammaRatioC([c, d], [b, c.sub(a)]).mul(oneMinusZ.pow(a.neg())),
        gauss2F1SeriesC(a, c.sub(b), a.sub(b).add(1), w, maxTerms),
        gammaRatioC([c, d.neg()], [a, c.sub(b)]).mul(oneMinusZ.pow(b.neg())),
        gauss2F1SeriesC(b, c.sub(a), b.sub(a).add(1), w, maxTerms)
      );
    }

    case 'one-minus-inv-z':
      // A&S 15.3.9, w = 1 − 1/z, s = c−a−b ∉ ℤ
      return withLossC(
        gammaRatioC([c, s], [c.sub(a), c.sub(b)]).mul(z.pow(a.neg())),
        gauss2F1SeriesC(
          a,
          a.sub(c).add(1),
          a.add(b).sub(c).add(1),
          w,
          maxTerms
        ),
        gammaRatioC([c, s.neg()], [a, b])
          .mul(one.sub(z).pow(s))
          .mul(z.pow(a.sub(c))),
        gauss2F1SeriesC(c.sub(a), one.sub(a), s.add(1), w, maxTerms)
      );
  }
}

/**
 * ₂F₁(a, b; c; z) through a logarithmic connection formula, for the map
 * `kind` whose parameter difference is an integer: b − a for the 1/z and
 * 1/(1−z) maps, c − a − b for the 1−z and 1−1/z maps.
 *
 * The formulas in `gauss2F1LogCaseC` need that difference to be m ≥ 0.
 * ₂F₁ is symmetric in a and b, so a negative b − a is handled by swapping
 * them. A negative c − a − b is handled by the Euler transformation
 * ₂F₁(a, b; c; z) = (1−z)^(c−a−b)·₂F₁(c−a, c−b; c; z), whose new parameter
 * difference c − (c−a) − (c−b) = a + b − c is positive. If c − a or c − b
 * is a non-positive integer, the transformed function is a polynomial and
 * is summed directly.
 */
function hypergeometric2F1LogCase(
  kind: 'inv-z' | 'inv-one-minus-z' | 'one-minus-z' | 'one-minus-inv-z',
  a: Complex,
  b: Complex,
  c: Complex,
  z: Complex,
  maxTerms: number
): { value: Complex; loss: number } {
  // The difference is within rounding of the integer m (see `isLogCase`).
  // If it is not exactly m, one parameter is moved by those few rounding
  // errors so that the formulas see an exact integer difference.
  if (kind === 'inv-z' || kind === 'inv-one-minus-z') {
    const d = b.sub(a);
    const m = Math.round(d.re);
    if (d.re !== m || d.im !== 0) b = a.add(m);
    return m >= 0
      ? gauss2F1LogCaseC(kind, a, b, c, m, z, maxTerms)
      : gauss2F1LogCaseC(kind, b, a, c, -m, z, maxTerms);
  }
  const s = c.sub(a).sub(b);
  const m = Math.round(s.re);
  if (s.re !== m || s.im !== 0) c = a.add(b).add(m);
  if (m >= 0) return gauss2F1LogCaseC(kind, a, b, c, m, z, maxTerms);
  const a1 = c.sub(a);
  const b1 = c.sub(b);
  const factor = C_ONE.sub(z).pow(new Complex(m, 0));
  const nTerms = Math.min(
    isNonPositiveIntegerC(a1) ? -a1.re : Infinity,
    isNonPositiveIntegerC(b1) ? -b1.re : Infinity
  );
  if (nTerms !== Infinity) {
    // The polynomial ₂F₁(c−a, c−b; c; z) of degree nTerms (at most −m,
    // since a and b are not non-positive integers). Its terms can
    // alternate and exceed the sum by many orders of magnitude: for
    // ₂F₁(−100, 1; 2; 0.9) they reach 1e24 for a sum of 0.011. The ratio
    // of the largest term to the sum is its loss, as for the other
    // logarithmic results, so a poorly conditioned polynomial is rejected
    // and another map is tried.
    let term: Complex = C_ONE;
    let sum: Complex = C_ONE;
    let big = 1;
    for (let n = 0; n < nTerms; n++) {
      term = term
        .mul(a1.add(n))
        .mul(b1.add(n))
        .mul(z)
        .div(c.add(n).mul(n + 1));
      big = Math.max(big, magC(term));
      sum = sum.add(term);
    }
    const loss = big / magC(sum);
    return {
      value: factor.mul(sum),
      loss: Number.isFinite(loss) ? loss : Infinity,
    };
  }
  const r = gauss2F1LogCaseC(kind, a1, b1, c, -m, z, maxTerms);
  return { value: factor.mul(r.value), loss: r.loss };
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
