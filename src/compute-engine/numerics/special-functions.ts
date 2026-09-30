import { Complex } from 'complex-esm';
import type { IComputeEngine as ComputeEngine } from '../global-types.js';
import type { BigNum } from './types.js';
import { BigDecimal } from '../../big-decimal/index.js';
import { checkDeadline } from '../../common/interruptible.js';
import {
  hurwitzZetaComplex,
  hypergeometric2F1Complex,
  polygammaComplex,
  POLYGAMMA_MAX_ORDER,
} from './numeric-complex.js';
import { bernoulliPolynomialRational } from './bernoulli.js';

const gammaG = 7;
const lanczos_7_c = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

// const gammaGLn = 607 / 128;
// const gammaPLn = [
//   0.999999999999997, 57.156235665862923, -59.59796035547549, 14.13609797474174,
//   -0.4919138160976202, 0.3399464998481188e-4, 0.4652362892704857e-4,
//   -0.9837447530487956e-4, 0.1580887032249125e-3, -0.21026444172410488e-3,
//   0.2174396181152126e-3, -0.16431810653676389e-3, 0.8441822398385274e-4,
//   -0.261908384015814e-4, 0.3689918265953162e-5,
// ];

export function gammaln(z: number): number {
  // Lanczos (g = 7, 9 coefficients — same table as `gamma()` below) taken in
  // log form:
  //   ln Γ(z) = ln(2π)/2 + (z − 1/2)·ln(t) − t + ln(A(z)),  t = z + g − 1/2
  // Accurate to ~1–2 ulp for all z > 0 (verified against mpmath.loggamma at
  // z ∈ {1.5, 10, 50, 100, 170, 300}). The previous implementation used a
  // 3-term Stirling series after a shift to z ≥ 10, which was only good for
  // ~10.5 digits (Gamma(10) came out as 362880.0000000015), degrading
  // machine gamma(z > 100) and beta for large arguments. (CORRECTNESS P2 #19)
  if (z < 0) return NaN;

  // Exact zeros of ln Γ: Γ(1) = Γ(2) = 1.
  if (z === 1 || z === 2) return 0;

  const zz = z - 1;
  let x = lanczos_7_c[0];
  for (let i = 1; i < gammaG + 2; i++) x += lanczos_7_c[i] / (zz + i);
  const t = zz + gammaG + 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x)
  );
}

/**
 * Rough estimate of the decimal digit count of `n!`, via `lgamma(n+1)`. A
 * non-finite or negative `n` estimates `Infinity` (there is no exact
 * factorial to size), so a caller that caps exact factorials by their digit
 * count must handle a negative operand before asking.
 */
export function estimatedFactorialDigits(n: number): number {
  if (!Number.isFinite(n) || n < 0) return Infinity;
  if (n < 2) return 1;
  const digits = gammaln(n + 1) / Math.LN10;
  return Number.isFinite(digits) ? digits : Infinity;
}

const GAMMA_OVERFLOW_THRESHOLD = 171.6243769563027;

function gammaLanczos(z: number): number {
  z -= 1;
  let x = lanczos_7_c[0];
  for (let i = 1; i < gammaG + 2; i++) x += lanczos_7_c[i] / (z + i);

  const t = z + gammaG + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

function gammaBalancedProduct(start: number, count: number): number {
  if (count <= 0) return 1;
  if (count === 1) return start;

  const leftCount = count >>> 1;
  return (
    gammaBalancedProduct(start, leftCount) *
    gammaBalancedProduct(start + leftCount, count - leftCount)
  );
}

export function gamma(z: number): number {
  // Γ has a pole at every non-positive integer, and the reflection formula
  // below cannot see it: `Math.sin(Math.PI * z)` is not exactly 0 there
  // (`sin(-2π)` computes as ≈2.4e-16), so Γ(−2) came back as the finite
  // 6413262697001887 instead of a pole. A pole has no real value, which the
  // real lane spells `NaN` — the same projection `_SYS.factorial` already
  // applies at a negative integer, and the same one the interpreter's `~oo`
  // takes when it reaches a real-emitting compile target.
  if (z <= 0 && Number.isInteger(z)) return NaN;
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  if (z > GAMMA_OVERFLOW_THRESHOLD) return Infinity;
  // Positive integer: Γ(z) = (z-1)!, exact as a product of doubles
  // (bit-exact through 18!, correctly rounded beyond) — the Lanczos factor
  // Γ(1) ≈ 1 - 3e-16 would otherwise poison it.
  if (Number.isInteger(z)) return gammaBalancedProduct(1, z - 1);
  if (z >= 2) {
    const shift = Math.floor(z) - 1;
    const residue = z - shift;
    return gammaLanczos(residue) * gammaBalancedProduct(residue, shift);
  }
  return gammaLanczos(z);
}

/**
 * Exponential integral E₁(z) = Γ(0, z) = ∫_z^∞ e^{−t}/t dt, for real z > 0.
 *
 * Power series (DLMF 6.6.2) for small z, Legendre continued fraction
 * (NR §6.3, the n = 1 case of Eₙ) for z ≳ 1.5. Returns NaN for z ≤ 0
 * (E₁ is complex on the negative real axis — the complex kernel handles it).
 */
function e1Real(z: number): number {
  if (z <= 0) return NaN;
  if (z < 1.5) {
    // E₁(z) = −γ − ln z − Σ_{k≥1} (−z)^k/(k·k!)
    let sum = 0;
    let term = 1; // (−z)^k/k!, updated in the loop
    for (let k = 1; k < 200; k++) {
      term *= -z / k;
      const add = -term / k;
      sum += add;
      if (Math.abs(add) < 1e-18) break;
    }
    return -EULER_GAMMA - Math.log(z) + sum;
  }
  // E₁(z) = e^{−z}·CF,  CF = 1/(z+1 − 1²/(z+3 − 2²/(z+5 − …)))  (Lentz)
  const tiny = 1e-300;
  let b = z + 1;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i++) {
    const a = -i * i;
    b += 2;
    d = a * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + a / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h * Math.exp(-z);
}

/** Lower incomplete gamma γ(s, z), real, z > 0, s NOT a non-positive integer.
 *  Tricomi series: γ(s,z) = z^s e^{−z} Σ_{k≥0} z^k / (s)_{k+1}. */
function lowerGammaSeriesReal(s: number, z: number): number {
  let term = 1 / s; // k = 0 term
  let sum = term;
  for (let k = 1; k < 1000; k++) {
    term *= z / (s + k);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-17) break;
  }
  return Math.exp(s * Math.log(z) - z) * sum;
}

/** Upper incomplete gamma Γ(s, z), real, via the Legendre continued
 *  fraction (NR §6.2 gcf); valid for z ≳ s and any real s. */
function upperGammaCFReal(s: number, z: number): number {
  const tiny = 1e-300;
  // Γ(s,z) = z^s e^{−z} / (z+1−s − 1·(1−s)/(z+3−s − 2·(2−s)/(…)))
  let b = z + 1 - s;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(s * Math.log(z) - z) * h;
}

/** Upper incomplete gamma Γ(s, z) for s a non-positive integer, real z > 0,
 *  via downward recurrence Γ(s−1,z) = (Γ(s,z) − z^{s−1} e^{−z})/(s−1) seeded
 *  by Γ(0, z) = E₁(z). The Γ(s) − γ(s,z) split is unusable here (Γ(s) is a
 *  pole), and the continued fraction converges slowly for small z. */
function upperGammaNegIntReal(s: number, z: number): number {
  let g = e1Real(z); // Γ(0, z)
  const emz = Math.exp(-z);
  for (let cur = 0; cur > s; cur--)
    g = (g - Math.pow(z, cur - 1) * emz) / (cur - 1);
  return g;
}

/**
 * Upper incomplete gamma function Γ(s, z) = ∫_z^∞ t^{s−1} e^{−t} dt, for
 * real s and real z ≥ 0. (This is Mathematica/Rubi's `Gamma[s, z]`.)
 *
 * Returns NaN for z < 0, where Γ(s, z) is generally complex (z^s with a
 * non-integer s) — the caller's complex kernel handles that branch.
 *
 * Regime split (NR §6.2), plus an E₁-seeded recurrence for the
 * non-positive-integer s where the Γ(s) − γ(s,z) decomposition is invalid:
 *   - s a non-positive integer → Legendre continued fraction for z ≥ 1,
 *     downward recurrence from Γ(0,z) = E₁(z) for z < 1
 *   - z < s + 1                → Γ(s,z) = Γ(s) − γ(s,z) (lower Tricomi series)
 *   - z ≥ s + 1                → Legendre continued fraction
 */
export function incompleteGammaUpper(s: number, z: number): number {
  if (Number.isNaN(s) || Number.isNaN(z)) return NaN;
  if (z < 0) return NaN; // complex result — defer to the complex kernel
  if (z === 0) return gamma(s); // Γ(s,0) = Γ(s) (∞ at non-positive integer s)

  // For a non-positive integer s, the downward recurrence from E₁(z)
  // subtracts two nearly equal numbers once z is more than a few units (at
  // s = −15, z = 60 the relative error was 3e-2). The continued fraction is
  // accurate there: measured against mpmath for s from 0 to −30 and
  // 1 ≤ z ≤ 200 (and at s = −100 for z = 1, 3, 50), the relative error is
  // below 4e-14. The recurrence stays
  // for z < 1, where it is accurate and the fraction converges slowly.
  if (Number.isInteger(s) && s <= 0)
    return z >= 1 ? upperGammaCFReal(s, z) : upperGammaNegIntReal(s, z);
  if (z < s + 1) return gamma(s) - lowerGammaSeriesReal(s, z);
  return upperGammaCFReal(s, z);
}

// ---------------------------------------------------------------------------
// Regularized incomplete gamma P(a,x)/Q(a,x) and beta I_x(a,b).
//
// Machine kernels follow Numerical Recipes (gammp/gammq/betacf): a power
// series for the lower function when x < a+1, a Lentz continued fraction for
// the upper function otherwise, sharing the exp(a·ln x − x − gammaln(a))
// prefactor. The regularized beta uses the betacf continued fraction plus the
// symmetry I_x(a,b) = 1 − I_{1−x}(b,a) so the CF is always evaluated in its
// fast-converging half. Per the project policy on wrong-digit kernels, inputs
// outside the validated domain return NaN rather than an inaccurate value.
// ---------------------------------------------------------------------------

/** Underflow floor for the machine Lentz continued fractions below. */
const GAMMA_FPMIN = 1e-300;

/** Lower regularized gamma P(a,x) via its power series (NR gser); valid for
 *  x < a+1, where the series converges fastest. Requires a > 0, x ≥ 0. */
function gammaPSeries(a: number, x: number): number {
  if (x === 0) return 0;
  let ap = a;
  let del = 1 / a;
  let sum = del;
  for (let n = 0; n < 1000; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
  }
  return sum * Math.exp(a * Math.log(x) - x - gammaln(a));
}

/** Upper regularized gamma Q(a,x) via the Legendre continued fraction (NR
 *  gcf), evaluated with Lentz's algorithm; valid for x ≥ a+1. a > 0, x > 0. */
function gammaQContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / GAMMA_FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < GAMMA_FPMIN) d = GAMMA_FPMIN;
    c = b + an / c;
    if (Math.abs(c) < GAMMA_FPMIN) c = GAMMA_FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(a * Math.log(x) - x - gammaln(a)) * h;
}

/**
 * Lower regularized incomplete gamma P(a,x) = γ(a,x)/Γ(a), for real a > 0 and
 * x ≥ 0. Returns NaN outside that domain.
 */
export function gammaP(a: number, x: number): number {
  if (Number.isNaN(a) || Number.isNaN(x)) return NaN;
  if (a <= 0 || x < 0) return NaN;
  if (x === 0) return 0;
  if (x < a + 1) return gammaPSeries(a, x);
  return 1 - gammaQContinuedFraction(a, x);
}

/**
 * Upper regularized incomplete gamma Q(a,x) = Γ(a,x)/Γ(a) = 1 − P(a,x), for
 * real a > 0 and x ≥ 0. Returns NaN outside that domain. The continued
 * fraction is used directly for x ≥ a+1 so the tail keeps full relative
 * precision instead of coming from 1 − P.
 */
export function gammaQ(a: number, x: number): number {
  if (Number.isNaN(a) || Number.isNaN(x)) return NaN;
  if (a <= 0 || x < 0) return NaN;
  if (x === 0) return 1;
  if (x < a + 1) return 1 - gammaPSeries(a, x);
  return gammaQContinuedFraction(a, x);
}

/** Continued fraction for the regularized incomplete beta (NR betacf),
 *  evaluated with Lentz's algorithm. Converges rapidly for x < (a+1)/(a+b+2);
 *  the caller applies the reflection symmetry otherwise. */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < GAMMA_FPMIN) d = GAMMA_FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < GAMMA_FPMIN) d = GAMMA_FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < GAMMA_FPMIN) c = GAMMA_FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < GAMMA_FPMIN) d = GAMMA_FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < GAMMA_FPMIN) c = GAMMA_FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h;
}

/**
 * Regularized incomplete beta I_x(a,b) (Mathematica's BetaRegularized[x,a,b]),
 * for real a > 0, b > 0 and 0 ≤ x ≤ 1. Returns NaN outside that domain, and
 * the exact endpoints 0 (x=0) and 1 (x=1).
 */
export function betaRegularized(x: number, a: number, b: number): number {
  if (Number.isNaN(x) || Number.isNaN(a) || Number.isNaN(b)) return NaN;
  if (a <= 0 || b <= 0 || x < 0 || x > 1) return NaN;
  if (x === 0) return 0;
  if (x === 1) return 1;
  const bt = Math.exp(
    gammaln(a + b) -
      gammaln(a) -
      gammaln(b) +
      a * Math.log(x) +
      b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2))
    return (bt * betaContinuedFraction(a, b, x)) / a;
  return 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
}

/**
 * Winitzki's approximation for the inverse error function, accurate to
 * ~2e-3 relative over (-1, 1). Used as the Newton seed for `erfInv()` and
 * `bigErfInv()`.
 */
function erfInvApprox(x: number): number {
  const a = 0.147;
  const ln1mx2 = Math.log(1 - x * x);
  const b = 2 / (Math.PI * a) + ln1mx2 / 2;
  return Math.sign(x) * Math.sqrt(Math.sqrt(b * b - ln1mx2 / a) - b);
}

/**
 * Inverse Error Function, accurate to full machine (double) precision.
 *
 * Winitzki's approximation (~3 correct digits) refined with Newton's
 * method on the full-precision `erf()`:
 *    y ← y − (erf(y) − x)·(√π/2)·e^{y²}
 * Each iteration doubles the number of correct digits, so 4 iterations
 * reach machine precision.
 *
 * (Previously used a 6-term truncated Maclaurin series, which was only
 * ~4-digit accurate at x = 0.5 and diverged badly for |x| → 1.)
 */
export function erfInv(x: number): number {
  if (Number.isNaN(x) || x < -1 || x > 1) return NaN;
  if (x === 0) return 0;
  if (x === 1) return Infinity;
  if (x === -1) return -Infinity;

  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);

  let y = erfInvApprox(ax);
  const c = Math.sqrt(Math.PI) / 2;

  // Newton on f(y) = erf(y) − ax, with step (erf(y) − ax)·(√π/2)·e^{y²}.
  // Near ax = 1, erf(y) ≈ 1 ≈ ax, so the residual erf(y) − ax cancels
  // catastrophically (only ~5 correct digits at ax = 1 − 1e-12). Rewrite it via
  // the complementary function, which has no cancellation for large y:
  //   erf(y) − ax = (1 − erfc(y)) − ax = (1 − ax) − erfc(y),
  // computing 1 − ax once (exact) and erfc(y) directly (its own continued
  // fraction). (NU-P1-9)
  const q = 1 - ax; // complementary input, exact
  const useComplement = ax > 0.9;
  for (let i = 0; i < 5; i++) {
    const residual = useComplement ? q - erfc(y) : erf(y) - ax;
    y -= residual * c * Math.exp(y * y);
  }

  return sign * y;
}

/**
 * Complementary error function, erfc(x) = 1 - erf(x), accurate to full
 * machine (double) precision.
 *
 * For |x| < 2 the value is computed as `1 - erf(x)` (no significant
 * cancellation). For larger |x|, `1 - erf(x)` would lose all precision
 * (erf(x) ≈ 1), so erfc is computed directly from a continued fraction
 * (DLMF 7.9.3) evaluated with the modified Lentz algorithm.
 *
 * References:
 * - NIST DLMF: https://dlmf.nist.gov/7.9
 */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (!Number.isFinite(x)) return x > 0 ? 0 : 2;
  if (x < 0) return 2 - erfc(-x);
  if (x < 2) return 1 - erf(x);

  // erfc(x) = e^{-x²} / (√π · g),  where
  //   g = x + (1/2)/(x + (2/2)/(x + (3/2)/(x + ...)))   (continued fraction)
  // evaluated with the modified Lentz algorithm.
  const tiny = 1e-300;
  let f = x === 0 ? tiny : x;
  let c = f;
  let d = 0;
  for (let k = 1; k <= 500; k++) {
    const a = k / 2;
    d = x + a * d;
    if (d === 0) d = tiny;
    d = 1 / d;
    c = x + a / c;
    if (c === 0) c = tiny;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-17) break;
  }
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * f);
}

/**
 * The Gauss error function, erf(x), accurate to full machine (double)
 * precision.
 *
 * Computed from the well-conditioned Maclaurin series (DLMF 7.6.2):
 *   erf(x) = (2/√π) e^{-x²} Σ_{n≥0} 2^n x^{2n+1} / (1·3·5···(2n+1))
 * All terms are positive, so there is no subtractive cancellation. For
 * |x| ≥ 6 the result rounds to ±1 (erfc(6) ≈ 2.15e-17, below machine eps).
 *
 * (Previously used the 5-term Abramowitz & Stegun rational approximation,
 * which was only ~7-digit accurate.)
 *
 * References:
 * - NIST DLMF: https://dlmf.nist.gov/7.6
 */
export function erf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return 0;
  if (!Number.isFinite(x)) return x > 0 ? 1 : -1;

  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  if (ax >= 6) return sign;

  const x2 = ax * ax;
  let term = ax; // n = 0 term: x
  let sum = ax;
  for (let n = 1; n < 200; n++) {
    // term_{n} = term_{n-1} · 2x² / (2n+1)
    term *= (2 * x2) / (2 * n + 1);
    sum += term;
    if (term < sum * 1e-18) break;
  }
  return sign * (2 / Math.sqrt(Math.PI)) * Math.exp(-x2) * sum;
}

/**
 * Run `fn` with the global `BigDecimal.precision` raised by `guard` extra
 * digits, then restore it. The returned value carries the extra correct
 * digits; the engine rounds to the active precision for display.
 *
 * Series/acceleration kernels below accumulate rounding error across many
 * operations (and, for ζ, work with intermediates far larger than the result).
 * Computing at exactly the requested precision therefore loses the last
 * several digits. Evaluating with guard digits and rounding once at the end
 * restores a fully-accurate result. (`BigDecimal.precision` is process-global,
 * so this must always restore it — hence the `try/finally`.)
 */
function withGuardDigits(guard: number, fn: () => BigNum): BigNum {
  const saved = BigDecimal.precision;
  BigDecimal.precision = saved + guard;
  try {
    // Compute with guard digits, then round the (correct) result back to the
    // requested precision so the kernel returns exactly `saved` good digits.
    return fn().toPrecision(saved);
  } finally {
    BigDecimal.precision = saved;
  }
}

/** Working-precision guard (extra digits) for the bignum Gamma/Zeta kernels. */
const SPECIAL_FN_GUARD = 24;

/**
 * Above this exact positive integer (or half-integer) argument, computing
 * n! via a counting loop of bigint multiplications is too slow — and the
 * result (an astronomically large exact integer) isn't any more useful than
 * the general Stirling-series float anyway. Fall through to the
 * precision-scaled, magnitude-independent general path instead of grinding.
 * (`checkDeadline` calls in the loops below are a backstop for whatever
 * slips under this threshold on a slow host.)
 * See WP-2.11 / EX-14: `Gamma(1e300).N()`, `GammaLn(1e300).N()`, and
 * `Gamma(1e7).N()` at high precision all hung in these loops.
 */
const MAX_EXACT_FACTORIAL_N = 20_000;

/**
 * Above this even, positive Zeta argument, the exact closed form (which
 * needs the Bernoulli number B_s — itself an O(k²)-ish computation in the
 * Bernoulli index k = s/2) is too slow. Beyond the cap, `zetaCore` falls
 * through to the general Cohen–Villegas–Zagier series (precision-scaled,
 * magnitude-independent). Also used as the magnitude cutoff for the
 * trivial-zero shortcut on huge negative even integers (see `zetaCore`).
 */
const MAX_EXACT_ZETA_EVEN_N = 500;

/**
 * Bignum log-Gamma via Stirling asymptotic series with runtime-computed
 * Bernoulli numbers.  Precision scales with BigDecimal.precision.
 *
 * Uses reflection for z < 0.5, exact formulas for positive integers and
 * half-integers, and for the general case shifts z upward so the asymptotic
 * series converges rapidly.
 */
export function bigGammaln(ce: ComputeEngine, z: BigNum): BigNum {
  if (!z.isFinite()) return BigDecimal.NAN;
  return withGuardDigits(SPECIAL_FN_GUARD, () => gammalnCore(ce, z));
}

function gammalnCore(ce: ComputeEngine, z: BigNum): BigNum {
  if (!z.isFinite()) return BigDecimal.NAN;

  // Reflection: ln(Gamma(z)) = ln(pi) - ln(|sin(pi*z)|) - ln(Gamma(1-z))
  if (z.lt(BigDecimal.HALF)) {
    const pi = BigDecimal.PI;
    const sinPiZ = pi.mul(z).sin().abs();
    if (sinPiZ.isZero()) return BigDecimal.NAN;
    return pi
      .ln()
      .sub(sinPiZ.ln())
      .sub(gammalnCore(ce, BigDecimal.ONE.sub(z)));
  }

  // Exact: positive integer z -> ln((z-1)!). Beyond MAX_EXACT_FACTORIAL_N,
  // skip the O(n) factorial loop and fall through to the general Stirling
  // path below (checkDeadline is a backstop under the threshold).
  if (z.isInteger() && z.isPositive()) {
    const n = z.toNumber();
    if (n <= 1) return BigDecimal.ZERO;
    if (n <= MAX_EXACT_FACTORIAL_N) {
      let fact = 1n;
      let steps = 0;
      for (let i = 2; i < n; i++) {
        if ((++steps & 0xfff) === 0) checkDeadline(ce._deadlineFrame);
        fact *= BigInt(i);
      }
      return new BigDecimal(fact.toString()).ln();
    }
  }

  // Exact: half-integer z = n + 1/2 -> ln((2n)! * sqrt(pi) / (4^n * n!))
  const zMinusHalf = z.sub(BigDecimal.HALF);
  if (zMinusHalf.isInteger() && !zMinusHalf.isNegative()) {
    const n = zMinusHalf.toNumber();
    if (n === 0) {
      // Gamma(1/2) = sqrt(pi), so ln(Gamma(1/2)) = ln(sqrt(pi)) = ln(pi)/2
      return BigDecimal.PI.ln().div(BigDecimal.TWO);
    }
    if (n <= MAX_EXACT_FACTORIAL_N) {
      let steps = 0;
      let fact2n = 1n;
      for (let i = 2; i <= 2 * n; i++) {
        if ((++steps & 0xfff) === 0) checkDeadline(ce._deadlineFrame);
        fact2n *= BigInt(i);
      }
      let factN = 1n;
      for (let i = 2; i <= n; i++) {
        if ((++steps & 0xfff) === 0) checkDeadline(ce._deadlineFrame);
        factN *= BigInt(i);
      }
      const fourN = 4n ** BigInt(n);
      return new BigDecimal(fact2n.toString())
        .ln()
        .add(BigDecimal.PI.ln().div(BigDecimal.TWO))
        .sub(new BigDecimal(fourN.toString()).ln())
        .sub(new BigDecimal(factN.toString()).ln());
    }
  }

  // General: Stirling series with upward shift.
  //
  // The Stirling asymptotic series for ln Γ(w) reaches its smallest term near
  // k ≈ π·w, of size ≈ e^{−2πw}. Shifting only to w ≈ 0.37·p puts that floor
  // right at the target tolerance, so the series never converges early and runs
  // its full ≈π·w terms — each an expensive division by a large Bernoulli
  // rational. Shifting to w ≈ p instead drops the floor far below tolerance, so
  // the tol break fires after only ≈0.4·p terms (a measured 3–5× fewer), at the
  // cost of more — but cheap — shift multiplications. (See ROADMAP B1.)
  const p = BigDecimal.precision;
  const guard = 10;
  const shiftTarget = Math.ceil(p);
  const zNum = z.toNumber();
  const m = Math.max(0, Math.ceil(shiftTarget - zNum));

  // ln Γ(z) = ln Γ(z+m) − ln∏_{i=0}^{m-1}(z+i). Accumulate the shift as a single
  // product and take ONE logarithm of it, rather than summing m separate (and
  // expensive) ln(z+i).
  // NB: `BigDecimal.mul` returns the *full* product (it does not round to the
  // working precision), so an accumulating product grows its significand by ~p
  // digits every step — making each successive multiply more expensive and the
  // whole loop O(m²·…). Rounding back to p digits after each step keeps every
  // operand at p digits (O(m) multiplies of bounded size). This single change is
  // the dominant high-precision speedup.
  let shiftProduct = BigDecimal.ONE;
  let w = z;
  for (let i = 0; i < m; i++) {
    shiftProduct = shiftProduct._mulToPrecision(w, p);
    w = w.add(BigDecimal.ONE);
  }
  const logProduct = m > 0 ? shiftProduct.ln() : BigDecimal.ZERO;

  // The series converges (tol break) in ≈0.4·p terms at this shift; bound the
  // Bernoulli table generously above that rather than at the old π·w (which,
  // with the larger shift, would needlessly compute ~8× more Bernoulli numbers).
  const maxTerms = Math.max(20, Math.ceil(0.6 * p) + 20);
  const bernoulliRationals = getBernoulliRationals(ce, maxTerms);

  // Stirling: (w - 1/2)*ln(w) - w + ln(2*pi)/2 + sum B_{2k}/(2k*(2k-1)*w^{2k-1})
  let result = w
    .sub(BigDecimal.HALF)
    .mul(w.ln())
    .sub(w)
    .add(BigDecimal.PI.mul(BigDecimal.TWO).ln().div(BigDecimal.TWO));

  // Evaluate Σ B_{2k}/(2k(2k-1)) · w^{-(2k-1)} forward, multiplying by a
  // precomputed u = 1/w² each step instead of dividing by the growing w^{2k-1}
  // (the Bernoulli coefficient's only division is then by its *small* integer
  // denominator). As above, round each running power/term back to p digits so
  // significands stay bounded.
  const inv = BigDecimal.ONE.div(w); // 1/w
  const u = inv._mulToPrecision(inv, p); // 1/w²
  let pw = inv; // w^{-(2k-1)}, starting at w^{-1}
  const tol = new BigDecimal(10).pow(-(p + guard));
  const nTerms = Math.min(maxTerms, bernoulliRationals.length);
  for (let k = 0; k < nTerms; k++) {
    const twoK = 2 * (k + 1);
    const [bNum, bDen] = bernoulliRationals[k];
    const denom = BigInt(twoK) * BigInt(twoK - 1);
    const coeff = new BigDecimal(bNum.toString()).div(
      new BigDecimal((bDen * denom).toString())
    );
    const term = coeff._mulToPrecision(pw, p);
    if (k > 0 && term.abs().lt(tol)) break;
    result = result.add(term);
    pw = pw._mulToPrecision(u, p);
  }

  return result.sub(logProduct);
}

/**
 * Bignum Gamma function.  Precision scales with BigDecimal.precision.
 *
 * Reflection for z < 0.5; general case delegates to exp(bigGammaln(z)).
 * Note: integer fast paths are in bigGammaln (returning exact ln(n!)).
 * bigGamma goes through exp(ln(...)) so the result is a full-precision float.
 */
export function bigGamma(ce: ComputeEngine, z: BigNum): BigNum {
  // Exact: positive integer → (z-1)! (precision-independent, skip the
  // guard). Beyond MAX_EXACT_FACTORIAL_N, fall through to the general path.
  if (z.isInteger() && z.isPositive()) {
    const n = z.toNumber();
    if (n <= MAX_EXACT_FACTORIAL_N) {
      let fact = 1n;
      let steps = 0;
      for (let i = 2; i < n; i++) {
        if ((++steps & 0xfff) === 0) checkDeadline(ce._deadlineFrame);
        fact *= BigInt(i);
      }
      return new BigDecimal(fact.toString());
    }
  }
  return withGuardDigits(SPECIAL_FN_GUARD, () => gammaCore(ce, z));
}

function gammaCore(ce: ComputeEngine, z: BigNum): BigNum {
  // Reflection for z < 0.5: Gamma(z) = pi / (sin(pi*z) * Gamma(1-z))
  if (z.lt(BigDecimal.HALF)) {
    const pi = BigDecimal.PI;
    const sinPiZ = pi.mul(z).sin();
    if (sinPiZ.isZero()) return BigDecimal.NAN;
    return pi.div(sinPiZ.mul(gammaCore(ce, BigDecimal.ONE.sub(z))));
  }

  // General case
  return gammalnCore(ce, z).exp();
}

function gcdBigint(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function absBigint(x: bigint): bigint {
  return x < 0n ? -x : x;
}

/**
 * Compute even Bernoulli numbers B_2, B_4, ..., B_{2n} as exact rationals.
 * Returns [numerator, denominator] bigint pairs reduced to lowest terms.
 *
 * Uses the identity: sum_{k=0}^{m-1} C(m,k) * B_k = 0  (for m >= 2)
 * i.e. B_m = -1/(m+1) * sum_{k=0}^{m-1} C(m+1,k) * B_k
 *
 * Since all odd Bernoulli numbers except B_1 = -1/2 are zero, we compute
 * all B_k (k=0,1,2,...,2n) but only return the even ones.
 */
export function computeBernoulliEven(
  n: number,
  deadline?: number
): [bigint, bigint][] {
  // Store all Bernoulli numbers B_0..B_{2n} as [num, den] rationals
  const all: [bigint, bigint][] = [
    [1n, 1n], // B_0 = 1
    [-1n, 2n], // B_1 = -1/2
  ];

  for (let m = 2; m <= 2 * n; m++) {
    if ((m & 0xff) === 0) checkDeadline(deadline);
    // Odd m > 1: B_m = 0
    if (m % 2 === 1) {
      all.push([0n, 1n]);
      continue;
    }

    // B_m = -1/(m+1) * sum_{k=0}^{m-1} C(m+1,k) * B_k
    const mp1 = BigInt(m + 1);
    let sumNum = 0n;
    let sumDen = 1n;
    let binom = 1n; // C(m+1, 0) = 1

    for (let k = 0; k < m; k++) {
      if (k > 0) {
        // C(m+1, k) = C(m+1, k-1) * (m+1 - k + 1) / k = C(m+1, k-1) * (m+2-k) / k
        binom = (binom * (mp1 - BigInt(k) + 1n)) / BigInt(k);
      }
      const [bkNum, bkDen] = all[k];
      if (bkNum === 0n) continue; // skip zero Bernoulli numbers
      // sum += binom * B_k
      sumNum = sumNum * bkDen + binom * bkNum * sumDen;
      sumDen = sumDen * bkDen;
      // Periodically reduce to keep numbers manageable
      if (k % 8 === 7) {
        const g = gcdBigint(absBigint(sumNum), sumDen);
        sumNum /= g;
        sumDen /= g;
      }
    }

    // B_m = -sum / (m+1)
    let num = -sumNum;
    let den = mp1 * sumDen;
    const g = gcdBigint(absBigint(num), absBigint(den));
    num /= g;
    den /= g;
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    all.push([num, den]);
  }

  // Return only even-indexed: B_2, B_4, ..., B_{2n}
  const result: [bigint, bigint][] = [];
  for (let i = 1; i <= n; i++) {
    result.push(all[2 * i]);
  }
  return result;
}

/**
 * Engine-scoped, monotonically-growing cache of even Bernoulli rationals.
 *
 * This deliberately bypasses `ce._cache`/`EngineCacheStore`. That mechanism
 * only captures the `build`/`purge` callbacks passed on the *first* call that
 * ever constructs a given named entry (`EngineCacheStore.getOrBuild` returns
 * the cached value as-is on every later call, and `purgeValues()` — invoked
 * on every `ce.precision` change — re-invokes only that *original*, now-stale
 * closure). For a precision-driven size like this one, that means: build the
 * table once at a low precision, then raise precision, and every later call
 * silently keeps serving the too-short table forever (the per-call
 * `minTerms` closure is never seen again). Verified with a probe: precision
 * 20 → 300 followed by `Gamma(1.23456789)` produced digits that diverged from
 * a fresh precision-300 engine starting at digit ~170 of a 300-digit result —
 * a genuine correctness bug, not just a performance one. A `WeakMap` keyed on
 * the engine instance is read/checked/rebuilt inline on every call, so it
 * can never go stale; the entry is reclaimed automatically when the engine is
 * garbage-collected (mirrors `factIndexCache` in
 * `boxed-expression/constraint-subject.ts`).
 */
const bernoulliCache = new WeakMap<ComputeEngine, [bigint, bigint][]>();

function getBernoulliRationals(
  ce: ComputeEngine,
  minTerms: number
): [bigint, bigint][] {
  const existing = bernoulliCache.get(ce);
  if (existing && existing.length >= minTerms) return existing;

  // Round the build size up (not just to the immediate `minTerms`) so that
  // precision oscillation — e.g. alternating `ce.precision` between 50 and
  // 200 — doesn't force a fresh `computeBernoulliEven` rebuild on every
  // single call that needs marginally more terms than the last.
  //
  // The bonus is capped at a small ABSOLUTE amount (not a flat ×1.5, despite
  // that being the initial idea): `computeBernoulliEven`'s cost is steeply
  // superlinear in its term count (measured: 620 terms ≈ 0.56s, 900 ≈ 2.3s,
  // 953 ≈ 2.9s — worse than quadratic, likely from BigInt operand growth), so
  // a *proportional* 1.5× bonus is safe at the small term counts typical of
  // everyday precision (tens to low hundreds) but turns dangerous at the
  // term counts real high-precision requests already need on their own — a
  // 1.5× bonus on the ~635 terms that `ce.precision = 1000` requires for
  // Digamma/Gamma pushes the build to ~950 terms and ~2.9s, blowing the
  // default 2s per-operation deadline (verified: this exact scenario timed
  // out `Digamma`/`Trigamma`/`PolyGamma` tests at precision 1000). A capped
  // absolute bonus keeps the *relative* overhead high where it's cheap
  // (small term counts) and negligible where it's expensive (large term
  // counts), so it can never turn an already-affordable request into one
  // that blows the deadline.
  const buildTerms = minTerms + Math.min(64, Math.ceil(minTerms / 2));
  const table = computeBernoulliEven(buildTerms, ce._deadline);
  bernoulliCache.set(ce, table);

  // Return the full cached table (length ≥ minTerms), NOT a `minTerms` slice.
  // Every caller already clamps its own consumption — the four asymptotic
  // series (gammaln/digamma/trigamma/polygamma) iterate to
  // `Math.min(maxTerms, table.length)` and break at the tolerance well before
  // that, and `zetaCore` indexes a single fixed element `table[k-1]` — so no
  // caller ever over-sums past its requested `minTerms`. The asymptotic-series
  // divergence trap (extra terms make the sum worse) is therefore handled at
  // the caller's clamp, and the per-call `slice` copy is pure overhead. (The
  // clamp, not the table length, is what enforces the asymptotic cutoff.)
  return table;
}

/**
 * Bignum Digamma function ψ(z) = d/dz ln(Γ(z))
 * Same algorithm as machine `digamma`: reflection for negative z,
 * recurrence to shift z > 7, then asymptotic expansion with Bernoulli numbers.
 */
export function bigDigamma(ce: ComputeEngine, z: BigNum): BigNum {
  if (!z.isFinite()) return BigDecimal.NAN;
  return withGuardDigits(SPECIAL_FN_GUARD, () => digammaCore(ce, z));
}

function digammaCore(ce: ComputeEngine, z: BigNum): BigNum {
  // Reflection formula for negative values: ψ(1-z) = ψ(z) + π·cot(πz)
  if (z.isNegative()) {
    if (z.isInteger()) return BigDecimal.NAN; // poles at non-positive integers
    const pi = BigDecimal.PI;
    const piZ = pi.mul(z);
    const cotPiZ = piZ.cos().div(piZ.sin());
    return digammaCore(ce, BigDecimal.ONE.sub(z)).sub(pi.mul(cotPiZ));
  }

  if (z.isZero()) return BigDecimal.NAN; // pole

  const p = BigDecimal.precision;
  const guard = 10;
  // Shift to w ≈ p (not the old 0.37·p, which left the asymptotic series' floor
  // at the target tolerance, forcing it to run its full ≈π·w terms). The larger
  // shift converges the series in ≈0.4·p terms; see the note in `gammalnCore`.
  const shift = Math.max(7, Math.ceil(p));

  // Recurrence: ψ(z+1) = ψ(z) + 1/z — shift z up until z > shift
  let result = new BigDecimal(0);
  let w = z;
  while (w.lt(shift)) {
    result = result.sub(BigDecimal.ONE.div(w));
    w = w.add(BigDecimal.ONE);
  }

  const maxTerms = Math.max(20, Math.ceil(0.6 * p) + 20);
  const bernoulli = getBernoulliRationals(ce, maxTerms);

  // Asymptotic expansion: ψ(w) ~ ln(w) - 1/(2w) - Σ B_{2k}/(2k·w^{2k}).
  // Round the running power w^{2k} each step: `mul` keeps the full product, so an
  // un-rounded accumulator grows ~p digits per step and the loop becomes
  // quadratic (see `gammalnCore`).
  result = result.add(w.ln()).sub(BigDecimal.ONE.div(w.mul(2)));
  let w2k = w._mulToPrecision(w, p); // w^2
  const w2 = w2k;
  const tol = new BigDecimal(10).pow(-(p + guard));
  const nTerms = Math.min(maxTerms, bernoulli.length);
  for (let k = 0; k < nTerms; k++) {
    const [bNum, bDen] = bernoulli[k];
    const twoK = BigInt(2 * (k + 1));
    const term = new BigDecimal(bNum.toString()).div(
      new BigDecimal((bDen * twoK).toString()).mul(w2k)
    );
    if (k > 0 && term.abs().lt(tol)) break;
    result = result.sub(term);
    w2k = w2k._mulToPrecision(w2, p);
  }

  return result;
}

/**
 * Bignum Trigamma function ψ₁(z) = d/dz ψ(z) = d²/dz² ln(Γ(z))
 * Same recurrence/asymptotic structure as digamma but for the second derivative.
 */
export function bigTrigamma(ce: ComputeEngine, z: BigNum): BigNum {
  if (!z.isFinite()) return BigDecimal.NAN;
  return withGuardDigits(SPECIAL_FN_GUARD, () => trigammaCore(ce, z));
}

function trigammaCore(ce: ComputeEngine, z: BigNum): BigNum {
  // Reflection formula: ψ₁(1-z) + ψ₁(z) = π²/sin²(πz)
  if (z.isNegative()) {
    if (z.isInteger()) return BigDecimal.NAN;
    const pi = BigDecimal.PI;
    const s = pi.mul(z).sin();
    return pi
      .mul(pi)
      .div(s.mul(s))
      .sub(trigammaCore(ce, BigDecimal.ONE.sub(z)));
  }

  if (z.isZero()) return BigDecimal.NAN; // pole

  const p = BigDecimal.precision;
  const guard = 10;
  // Shift to w ≈ p so the asymptotic series converges in ≈0.4·p terms rather
  // than running its full ≈π·w (see `gammalnCore`).
  const shift = Math.max(7, Math.ceil(p));

  // Recurrence: ψ₁(z+1) = ψ₁(z) - 1/z²
  let result = new BigDecimal(0);
  let w = z;
  while (w.lt(shift)) {
    result = result.add(BigDecimal.ONE.div(w.mul(w)));
    w = w.add(BigDecimal.ONE);
  }

  const maxTerms = Math.max(20, Math.ceil(0.6 * p) + 20);
  const bernoulli = getBernoulliRationals(ce, maxTerms);

  // Asymptotic: ψ₁(w) ~ 1/w + 1/(2w²) + Σ B_{2k}/w^{2k+1}. Round the running
  // power each step (un-rounded `mul` grows the significand; see `gammalnCore`).
  result = result.add(BigDecimal.ONE.div(w));
  result = result.add(BigDecimal.ONE.div(w.mul(w).mul(2)));
  let w2kp1 = w.mul(w)._mulToPrecision(w, p); // w^3
  const w2 = w._mulToPrecision(w, p);
  const tol = new BigDecimal(10).pow(-(p + guard));
  const nTerms = Math.min(maxTerms, bernoulli.length);
  for (let k = 0; k < nTerms; k++) {
    const [bNum, bDen] = bernoulli[k];
    const term = new BigDecimal(bNum.toString()).div(
      new BigDecimal(bDen.toString()).mul(w2kp1)
    );
    if (k > 0 && term.abs().lt(tol)) break;
    result = result.add(term);
    w2kp1 = w2kp1._mulToPrecision(w2, p);
  }

  return result;
}

/**
 * Bignum Polygamma function ψₙ(z) = dⁿ/dzⁿ ψ(z)
 * Delegates to bigDigamma/bigTrigamma for n=0,1.
 * For n ≥ 2, uses recurrence + asymptotic expansion.
 *
 * An order above `POLYGAMMA_MAX_ORDER` answers NaN (the caller keeps the
 * expression symbolic): the cost grows with the order, and without a limit
 * an order of 10⁵ runs for minutes. The complex kernel `polygammaComplex`
 * uses the same limit.
 */
export function bigPolygamma(ce: ComputeEngine, n: BigNum, z: BigNum): BigNum {
  const nNum = n.toNumber();
  if (!Number.isInteger(nNum) || nNum < 0 || nNum > POLYGAMMA_MAX_ORDER)
    return BigDecimal.NAN;
  if (nNum === 0) return bigDigamma(ce, z); // already guarded
  if (nNum === 1) return bigTrigamma(ce, z); // already guarded
  if (!z.isFinite() || z.isZero()) return BigDecimal.NAN;
  return withGuardDigits(SPECIAL_FN_GUARD, () => polygammaCore(ce, nNum, z));
}

function polygammaCore(ce: ComputeEngine, nNum: number, z: BigNum): BigNum {
  const p = BigDecimal.precision;
  const guard = 10;

  // Bignum factorial helper. Rounded at each step: the exact m! has about
  // 35 000 digits for m = 10⁴, and arithmetic on it dominated the cost of a
  // high order.
  const bigFactorial = (m: number): BigNum => {
    let r: BigNum = BigDecimal.ONE;
    for (let i = 2; i <= m; i++) r = r.mul(i).toPrecision(p + guard);
    return r;
  };

  // Shift to w ≈ p so the asymptotic series converges in ≈0.4·p terms rather
  // than running its full ≈π·w (see `gammalnCore`). The ratio of two
  // consecutive terms of the series is about ((n + 2k)/(2πw))², so w must
  // also be at least n: for n = 1000 at w = 150 the terms grow from the
  // start, and the result was wrong by a factor 10⁶.
  const shift = Math.max(7, Math.ceil(p), nNum);

  // Poles at z = 0, −1, −2, …
  let w = z;
  let result = new BigDecimal(0);
  if (w.isNegative() && w.isInteger()) return BigDecimal.NAN;

  // Recurrence (from ψ(z+1) = ψ(z) + 1/z differentiated n times, DLMF 5.15.5):
  //   ψ⁽ⁿ⁾(z) = ψ⁽ⁿ⁾(z+1) + (−1)^{n+1} n!/z^{n+1}
  // The single shift loop also lifts negative non-integer z past the poles.
  const sign = nNum % 2 === 0 ? -1 : 1; // (−1)^{n+1}
  const bigFactN = bigFactorial(nNum);
  while (w.lt(shift)) {
    result = result.add(
      new BigDecimal(sign).mul(bigFactN).div(w.pow(nNum + 1))
    );
    w = w.add(BigDecimal.ONE);
  }

  const maxTerms = Math.max(20, Math.ceil(0.6 * p) + 20);
  const bernoulli = getBernoulliRationals(ce, maxTerms);

  // Asymptotic expansion (DLMF 5.15.9, extended to general n — obtained by
  // differentiating DLMF 5.11.2 n times):
  //   ψ⁽ⁿ⁾(w) ~ (−1)^{n−1} [ (n−1)!/wⁿ + n!/(2w^{n+1})
  //             + Σ_{k≥1} B₂ₖ·(2k+n−1)!/((2k)!·w^{2k+n}) ]
  const signA = nNum % 2 === 0 ? -1 : 1; // (−1)^{n−1}
  // (n−1)!, also used by the Bernoulli-term coefficients below
  const factNm1 = bigFactorial(nNum - 1);
  result = result.add(new BigDecimal(signA).mul(factNm1).div(w.pow(nNum)));
  result = result.add(
    new BigDecimal(signA).mul(bigFactN).div(w.pow(nNum + 1).mul(2))
  );

  // Higher-order terms using Bernoulli numbers. Round the running power each
  // step (un-rounded `mul` grows the significand; see `gammalnCore`).
  let wPow = w.pow(nNum + 2).toPrecision(p);
  const w2 = w._mulToPrecision(w, p);
  // The tolerance is relative to the result: an absolute one stopped the
  // series after one term when |ψ⁽ⁿ⁾| is small (ψ⁽²⁰⁰⁾(300) ≈ −2·10⁻¹²³ was
  // right to 4 digits only).
  const tol = result.abs().mul(new BigDecimal(10).pow(-(p + guard)));
  const nTerms = Math.min(maxTerms, bernoulli.length);
  for (let k = 0; k < nTerms; k++) {
    const m = 2 * (k + 1);
    const [bNum, bDen] = bernoulli[k];
    // Coefficient (2k+n−1)!/(2k)! built as (n−1)!·n(n+1)⋯(n+2k−1)/(2k)!.
    // (A previous version dropped the (n−1)! factor — wrong for n ≥ 3.)
    let coeff = factNm1;
    for (let j = 0; j < m; j++) coeff = coeff.mul(nNum + j);
    // (2k)! as bigint
    let factM = 1n;
    for (let j = 2; j <= m; j++) factM *= BigInt(j);
    // term = signA * B_{2k} * (2k+n−1)! / ((2k)! * w^{n+2k})
    const term = new BigDecimal((BigInt(signA) * bNum).toString())
      .mul(coeff)
      .div(new BigDecimal((bDen * factM).toString()).mul(wPow));
    if (k > 0 && term.abs().lt(tol)) break;
    result = result.add(term);
    wPow = wPow._mulToPrecision(w2, p);
  }

  return result;
}

/**
 * Bignum Beta function B(a, b) = Γ(a)Γ(b)/Γ(a+b)
 * Uses bigGamma directly.
 */
export function bigBeta(ce: ComputeEngine, a: BigNum, b: BigNum): BigNum {
  return withGuardDigits(SPECIAL_FN_GUARD, () =>
    gammaCore(ce, a)
      .mul(gammaCore(ce, b))
      .div(gammaCore(ce, a.add(b)))
  );
}

// ---------------------------------------------------------------------------
// Bignum regularized incomplete gamma P(a,x)/Q(a,x) and beta I_x(a,b). Same
// algorithms as the machine kernels above (series for the lower gamma when
// x < a+1, Lentz continued fractions otherwise, beta reflection symmetry),
// carried out in BigDecimal at the working precision plus SPECIAL_FN_GUARD
// guard digits. The prefactor uses `gammalnCore` (already inside the raised
// precision). Convergence loops are capped and `checkDeadline`-guarded; inputs
// outside the validated domain return a NaN BigNum rather than wrong digits.
// ---------------------------------------------------------------------------

/** Lower regularized gamma P(a,x) via the power series, in BigDecimal. Must be
 *  called inside the guard-digit context with a > 0, 0 < x < a+1. */
/** The power series Σ xⁿ / (a(a+1)…(a+n)) of the lower incomplete gamma,
 *  without its prefactor: γ(a, x) = xᵃ e⁻ˣ · (this sum). Converges for every
 *  real `a` that is not a non-positive integer and every x ≥ 0. */
function bigGammaPSeriesSum(ce: ComputeEngine, a: BigNum, x: BigNum): BigNum {
  const p = BigDecimal.precision;
  const tol = new BigDecimal(10).pow(-p);
  let ap = a;
  let del = BigDecimal.ONE.div(a);
  let sum = del;
  const maxTerms = 2000 + 20 * Math.ceil(Math.abs(x.toNumber())) + 20 * p;
  for (let n = 0; n < maxTerms; n++) {
    if ((n & 0xff) === 0) checkDeadline(ce._deadlineFrame);
    ap = ap.add(BigDecimal.ONE);
    del = del.mul(x).div(ap);
    sum = sum.add(del);
    if (del.abs().lt(sum.abs().mul(tol))) break;
  }
  return sum;
}

function bigGammaPSeries(ce: ComputeEngine, a: BigNum, x: BigNum): BigNum {
  const prefactor = a.mul(x.ln()).sub(x).sub(gammalnCore(ce, a)).exp();
  return bigGammaPSeriesSum(ce, a, x).mul(prefactor);
}

/** Upper regularized gamma Q(a,x) via the Legendre continued fraction (Lentz),
 *  in BigDecimal. Must be called inside the guard-digit context with a > 0,
 *  x ≥ a+1. */
function bigGammaQContinuedFraction(
  ce: ComputeEngine,
  a: BigNum,
  x: BigNum
): BigNum {
  const prefactor = a.mul(x.ln()).sub(x).sub(gammalnCore(ce, a)).exp();
  return prefactor.mul(bigGammaQContinuedFractionValue(ce, a, x));
}

/** The Legendre continued fraction of the upper incomplete gamma (Lentz),
 *  without its prefactor: Γ(a, x) = xᵃ e⁻ˣ · (this value). Converges for
 *  every real `a` and every x > 0. */
function bigGammaQContinuedFractionValue(
  ce: ComputeEngine,
  a: BigNum,
  x: BigNum
): BigNum {
  const p = BigDecimal.precision;
  const tol = new BigDecimal(10).pow(-p);
  const tiny = new BigDecimal(10).pow(-(2 * p));
  let b = x.add(BigDecimal.ONE).sub(a);
  let c = BigDecimal.ONE.div(tiny);
  let d = BigDecimal.ONE.div(b);
  let h = d;
  const maxTerms = 2000 + 20 * p;
  for (let i = 1; i < maxTerms; i++) {
    if ((i & 0xff) === 0) checkDeadline(ce._deadlineFrame);
    const an = new BigDecimal(i).sub(a).mul(-i); // −i·(i−a)
    b = b.add(BigDecimal.TWO);
    d = an.mul(d).add(b);
    if (d.abs().lt(tiny)) d = tiny;
    c = b.add(an.div(c));
    if (c.abs().lt(tiny)) c = tiny;
    d = BigDecimal.ONE.div(d);
    const del = d.mul(c);
    h = h.mul(del);
    if (del.sub(BigDecimal.ONE).abs().lt(tol)) break;
  }
  return h;
}

/**
 * Bignum upper regularized incomplete gamma Q(a, x) = Γ(a, x)/Γ(a) for a
 * NEGATIVE NON-INTEGER order `a` and x > 0, where Γ(a) is finite and of
 * either sign, so the prefactor is `xᵃ e⁻ˣ / Γ(a)` with Γ(a) itself rather
 * than `exp(−ln Γ(a))`. The series and the continued fraction are the same
 * loops as for a positive order: the series converges for every order that
 * is not a pole, the continued fraction for every x > 0. Below x = 2a + 2
 * (a band that exists only for a > −1) Q is 1 − P through the series;
 * elsewhere it is the continued fraction. Precision scales with
 * `BigDecimal.precision`. Returns NaN outside that domain.
 */
export function bigGammaQNegativeOrder(
  ce: ComputeEngine,
  a: BigNum,
  x: BigNum
): BigNum {
  if (a.isNaN() || x.isNaN()) return BigDecimal.NAN;
  if (!a.isFinite() || !x.isFinite()) return BigDecimal.NAN;
  if (!a.isNegative() || a.isInteger()) return BigDecimal.NAN;
  if (!x.isPositive()) return BigDecimal.NAN;
  return withGuardDigits(SPECIAL_FN_GUARD, () => {
    const prefactor = a.mul(x.ln()).sub(x).exp().div(bigGamma(ce, a));
    return x.lt(a.mul(2).add(BigDecimal.TWO))
      ? BigDecimal.ONE.sub(bigGammaPSeriesSum(ce, a, x).mul(prefactor))
      : bigGammaQContinuedFractionValue(ce, a, x).mul(prefactor);
  });
}

/**
 * Bignum lower regularized incomplete gamma P(a,x) = γ(a,x)/Γ(a), for a > 0
 * and x ≥ 0. Precision scales with `BigDecimal.precision`. Returns a NaN
 * BigNum outside the validated domain.
 */
export function bigGammaP(ce: ComputeEngine, a: BigNum, x: BigNum): BigNum {
  if (a.isNaN() || x.isNaN()) return BigDecimal.NAN;
  if (!a.isFinite() || !x.isFinite()) return BigDecimal.NAN;
  if (!a.isPositive()) return BigDecimal.NAN;
  if (x.isNegative()) return BigDecimal.NAN;
  if (x.isZero()) return BigDecimal.ZERO;
  // Series when x < 2a+2, continued fraction otherwise. The band just above
  // the machine boundary x = a+1 is where the continued fraction converges
  // slowest (linearly, ~x/digit near x = a+1) — at high precision the power
  // series, which needs only ≈(x−a)+O(p) terms there, is far cheaper, so this
  // boundary is pushed out well past NR's machine-precision x = a+1.
  return withGuardDigits(SPECIAL_FN_GUARD, () =>
    x.lt(a.mul(2).add(BigDecimal.TWO))
      ? bigGammaPSeries(ce, a, x)
      : BigDecimal.ONE.sub(bigGammaQContinuedFraction(ce, a, x))
  );
}

/**
 * Bignum upper regularized incomplete gamma Q(a,x) = Γ(a,x)/Γ(a) = 1 − P(a,x),
 * for a > 0 and x ≥ 0. Precision scales with `BigDecimal.precision`. The
 * continued fraction is used directly for x ≥ a+1 so the tail keeps full
 * relative precision. Returns a NaN BigNum outside the validated domain.
 */
export function bigGammaQ(ce: ComputeEngine, a: BigNum, x: BigNum): BigNum {
  if (a.isNaN() || x.isNaN()) return BigDecimal.NAN;
  if (!a.isFinite() || !x.isFinite()) return BigDecimal.NAN;
  if (!a.isPositive()) return BigDecimal.NAN;
  if (x.isNegative()) return BigDecimal.NAN;
  if (x.isZero()) return BigDecimal.ONE;
  // See bigGammaP for the x < 2a+2 series/continued-fraction boundary rationale.
  return withGuardDigits(SPECIAL_FN_GUARD, () =>
    x.lt(a.mul(2).add(BigDecimal.TWO))
      ? BigDecimal.ONE.sub(bigGammaPSeries(ce, a, x))
      : bigGammaQContinuedFraction(ce, a, x)
  );
}

/** Continued fraction for the regularized incomplete beta (NR betacf, Lentz),
 *  in BigDecimal. Must be called inside the guard-digit context with a,b > 0
 *  and x in the fast-converging half x < (a+1)/(a+b+2). */
function bigBetaContinuedFraction(
  ce: ComputeEngine,
  a: BigNum,
  b: BigNum,
  x: BigNum
): BigNum {
  const p = BigDecimal.precision;
  const tol = new BigDecimal(10).pow(-p);
  const tiny = new BigDecimal(10).pow(-(2 * p));
  const qab = a.add(b);
  const qap = a.add(BigDecimal.ONE);
  const qam = a.sub(BigDecimal.ONE);
  let c = BigDecimal.ONE;
  let d = BigDecimal.ONE.sub(qab.mul(x).div(qap));
  if (d.abs().lt(tiny)) d = tiny;
  d = BigDecimal.ONE.div(d);
  let h = d;
  const maxTerms = 1000 + 10 * p;
  for (let m = 1; m < maxTerms; m++) {
    if ((m & 0xff) === 0) checkDeadline(ce._deadlineFrame);
    const m2 = 2 * m;
    // m·(b−m)·x / ((a−1+2m)·(a+2m))
    let aa = b
      .sub(m)
      .mul(m)
      .mul(x)
      .div(qam.add(m2).mul(a.add(m2)));
    d = BigDecimal.ONE.add(aa.mul(d));
    if (d.abs().lt(tiny)) d = tiny;
    c = BigDecimal.ONE.add(aa.div(c));
    if (c.abs().lt(tiny)) c = tiny;
    d = BigDecimal.ONE.div(d);
    h = h.mul(d).mul(c);
    // −(a+m)·(a+b+m)·x / ((a+2m)·(a+1+2m))
    aa = a
      .add(m)
      .mul(qab.add(m))
      .mul(x)
      .neg()
      .div(a.add(m2).mul(qap.add(m2)));
    d = BigDecimal.ONE.add(aa.mul(d));
    if (d.abs().lt(tiny)) d = tiny;
    c = BigDecimal.ONE.add(aa.div(c));
    if (c.abs().lt(tiny)) c = tiny;
    d = BigDecimal.ONE.div(d);
    const del = d.mul(c);
    h = h.mul(del);
    if (del.sub(BigDecimal.ONE).abs().lt(tol)) break;
  }
  return h;
}

/**
 * Bignum regularized incomplete beta I_x(a,b) (Mathematica's
 * BetaRegularized[x,a,b]), for a > 0, b > 0 and 0 ≤ x ≤ 1. Precision scales
 * with `BigDecimal.precision`. Returns the exact endpoints 0/1, and a NaN
 * BigNum outside the validated domain.
 */
export function bigBetaRegularized(
  ce: ComputeEngine,
  x: BigNum,
  a: BigNum,
  b: BigNum
): BigNum {
  if (x.isNaN() || a.isNaN() || b.isNaN()) return BigDecimal.NAN;
  if (!x.isFinite() || !a.isFinite() || !b.isFinite()) return BigDecimal.NAN;
  if (!a.isPositive() || !b.isPositive()) return BigDecimal.NAN;
  if (x.isNegative() || x.gt(BigDecimal.ONE)) return BigDecimal.NAN;
  if (x.isZero()) return BigDecimal.ZERO;
  if (x.eq(BigDecimal.ONE)) return BigDecimal.ONE;
  return withGuardDigits(SPECIAL_FN_GUARD, () => {
    const bt = gammalnCore(ce, a.add(b))
      .sub(gammalnCore(ce, a))
      .sub(gammalnCore(ce, b))
      .add(a.mul(x.ln()))
      .add(b.mul(BigDecimal.ONE.sub(x).ln()))
      .exp();
    const boundary = a.add(BigDecimal.ONE).div(a.add(b).add(BigDecimal.TWO));
    if (x.lt(boundary))
      return bt.mul(bigBetaContinuedFraction(ce, a, b, x)).div(a);
    return BigDecimal.ONE.sub(
      bt.mul(bigBetaContinuedFraction(ce, b, a, BigDecimal.ONE.sub(x))).div(b)
    );
  });
}

/**
 * Bignum Riemann zeta function ζ(s).
 *
 * The general case uses the Cohen–Villegas–Zagier acceleration of the
 * alternating Dirichlet eta series (error ~(3+√8)^{−n}, so ~1.3 digits of
 * accuracy per term); the kernel runs with working-precision guard digits so
 * the result is accurate to the full requested precision.
 */
export function bigZeta(ce: ComputeEngine, s: BigNum): BigNum {
  if (!s.isFinite()) return BigDecimal.NAN;
  if (s.eq(1)) return new BigDecimal(Infinity); // pole
  return withGuardDigits(SPECIAL_FN_GUARD, () => zetaCore(ce, s));
}

function zetaCore(ce: ComputeEngine, s: BigNum): BigNum {
  const pi = BigDecimal.PI;

  // Special value: ζ(0) = -1/2
  if (s.isZero()) return BigDecimal.HALF.neg();

  // Special values for positive even integers: ζ(2k) = (-1)^{k+1} B_{2k} (2π)^{2k} / (2(2k)!)
  // Capped at MAX_EXACT_ZETA_EVEN_N: the Bernoulli-number computation is
  // O(k²)-ish in the Bernoulli index k = s/2, so this closed form is only
  // worth it for modest s — beyond the cap the general series below (which
  // is precision-scaled and magnitude-independent) computes the same value.
  if (s.isInteger() && s.isPositive()) {
    const sn = s.toNumber();
    if (sn % 2 === 0 && sn >= 2 && sn <= MAX_EXACT_ZETA_EVEN_N) {
      const k = sn / 2;
      const bernoulli = getBernoulliRationals(ce, k);
      const [bNum, bDen] = bernoulli[k - 1];
      const bernAbs = new BigDecimal(absBigint(bNum).toString()).div(
        new BigDecimal(bDen.toString())
      );
      const twoPi = pi.mul(2);
      let factVal: BigNum = BigDecimal.ONE;
      let steps = 0;
      for (let i = 2; i <= sn; i++) {
        if ((++steps & 0xfff) === 0) checkDeadline(ce._deadlineFrame);
        factVal = factVal.mul(i);
      }
      return bernAbs.mul(twoPi.pow(sn)).div(factVal.mul(2));
    }
  }

  // Trivial zeros: ζ(−2n) = 0 exactly for every negative even integer.
  // The functional equation below does NOT produce an exact zero: its
  // sin(πs/2) factor is computed from a rounded π, leaving a ~10^-(P+26)
  // residue (ζ(−2) returned ~2.7e-76 at precision 50). And for huge |s|
  // that near-zero meets an infinite Γ(1−s) (past MAX_EXACT_FACTORIAL_N —
  // see bigGamma) and the 0·∞ product rounds to NaN. Short-circuit
  // unconditionally, with an exact `.mod` parity check (not `.toNumber()`,
  // which loses precision at large magnitude). (CORRECTNESS P2 #18)
  if (s.isNegative() && s.isInteger() && s.mod(BigDecimal.TWO).isZero())
    return BigDecimal.ZERO;

  // Functional equation for s < 0:
  // ζ(s) = 2^s π^{s-1} sin(πs/2) Γ(1-s) ζ(1-s)
  if (s.isNegative()) {
    return new BigDecimal(2)
      .pow(s)
      .mul(pi.pow(s.sub(1)))
      .mul(pi.mul(s).div(2).sin())
      .mul(gammaCore(ce, BigDecimal.ONE.sub(s)))
      .mul(zetaCore(ce, BigDecimal.ONE.sub(s)));
  }

  const wp = BigDecimal.precision;

  // Huge s: ζ(s) − 1 = 2^{−s} + 3^{−s} + … < 10^{−(wp+10)}, so ζ(s) rounds
  // to exactly 1 at this precision. Guard BEFORE the acceleration loop: its
  // (k+1)^s powers are exact ~s-digit bigints, which for huge s (e.g. 1e9)
  // exhaust the BigInt size limit (RangeError) long before any deadline.
  if (s.gt((wp + 10) * 3.33)) return BigDecimal.ONE;

  // General case (Re(s) > 0, s ≠ 1): Cohen–Villegas–Zagier Algorithm 1.
  // Accelerates the Dirichlet eta series η(s) = Σ_{k≥0} (−1)^k/(k+1)^s with
  // error bounded by (3+√8)^{−n} ≈ 5.83^{−n} (≈0.766 digits/term), then
  // ζ(s) = η(s)/(1−2^{1−s}). The recurrence is numerically stable — partial
  // sums stay O(d) without catastrophic cancellation — so the caller's
  // working-precision guard alone secures the full requested precision.
  // (The earlier binomial-partial-sum form converged only as 2^{−n}, so the
  // 1.3·p term budget delivered only ~0.4·p correct digits.)
  const n = Math.max(22, Math.ceil(1.32 * wp) + 3);
  const alpha = new BigDecimal(3).add(new BigDecimal(8).sqrt()); // 3 + √8
  const alphaN = alpha.pow(n);
  const d = alphaN.add(BigDecimal.ONE.div(alphaN)).div(2); // ½((3+√8)ⁿ+(3−√8)ⁿ)
  let b = BigDecimal.NEGATIVE_ONE;
  let c = d.neg();
  let sum = BigDecimal.ZERO;
  for (let k = 0; k < n; k++) {
    if ((k & 0xff) === 0) checkDeadline(ce._deadlineFrame);
    c = b.sub(c);
    sum = sum.add(c.div(new BigDecimal(k + 1).pow(s)));
    // b_{k+1} = (k+n)(k−n) / ((k+½)(k+1)) · b_k
    b = b
      .mul(new BigDecimal(k + n).mul(k - n))
      .div(new BigDecimal(k).add(BigDecimal.HALF).mul(k + 1));
  }
  const eta = sum.div(d);
  return eta.div(
    BigDecimal.ONE.sub(new BigDecimal(2).pow(BigDecimal.ONE.sub(s)))
  );
}

//
// ---------------- Bignum Hurwitz / generalized zeta (real) --------------
//
// Euler-Maclaurin (DLMF 25.11.9), real s and a only — `evaluateHurwitzZeta`
// / `evaluateGeneralizedZeta` (library/arithmetic.ts) reach this kernel
// only on their real branch; a complex operand stays on the double
// `hurwitzZetaComplex` kernel (the complex special-function kernels run at
// machine precision at every engine precision).
//
//   ζ(s,a) = Σ_{k<N} (k+a)^{-s} + z^{1-s}/(s-1) + ½z^{-s}
//            + Σ_{j=1}^{M} B₂ⱼ/(2j)! (s)₂ⱼ₋₁ z^{-s-2j+1},   z = N + a.
//
// The planner sizes N and M for an ABSOLUTE error, but the caller wants
// RELATIVE precision: a result near 1e-200 needs 200 more absolute digits
// than a result near 1, and a result near 1e549 (far left, s ≪ 0) needs
// 549 fewer. So `bigHurwitzZetaEM` first estimates log10|ζ(s,a)| from
// doubles (`hurwitzLog10Estimate`), sizes the absolute target from that
// estimate, then reads the magnitude of the result it got and repeats with
// a corrected target until the result carries the requested significant
// digits, or declines after `HURWITZ_BIG_MAX_PASSES` passes.
//
// Left of Re(s) = 0 the direct terms grow like N^(−s) and cancel; Hurwitz's
// a ≠ 1 has no single reflection point the way ζ(s) = ζ(s,1) does (see
// `zetaCore` above), so instead the working precision is raised by the
// digits the cancellation costs (the planner's `largest`, relative to the
// absolute target).

/** Past this many working digits, the cancellation left of the strip costs
 * more than it is worth; the kernel declines. */
const HURWITZ_BIG_MAX_WORKING_DIGITS = 1200;

/** At most this many Bernoulli pairs: the exact Bernoulli numbers cost
 * more than quadratically in their count (about 0.6 s for the first 620,
 * 2.3 s for 900; see `getBernoulliRationals`), so past this count the
 * planner uses more direct terms instead, and a value that cannot do
 * without more pairs (s < −1279, where the remainder bound needs
 * s + 2M − 1 > 0) is declined. */
const HURWITZ_BIG_MAX_PAIRS = 640;

/** Euler-Maclaurin passes `bigHurwitzZetaEM` makes to reach the requested
 * relative precision before it declines. The first pass is sized from a
 * double estimate of the result's magnitude; each later pass is sized from
 * the magnitude the previous pass measured. */
const HURWITZ_BIG_MAX_PASSES = 4;

/** Past this many terms k + a < 0, `bigZetaFront` sums them as the
 * difference of two Hurwitz values instead of one by one, so its cost does
 * not grow with |a| (one by one, 10⁶ terms take about a second at 50 digits,
 * and 10⁸ terms would take minutes). */
const HURWITZ_BIG_DIRECT_FRONT = 10_000;

/**
 * A real operand of the bignum Hurwitz kernels: a BigDecimal, or an exact
 * rational `[numerator, denominator]` with a positive denominator. The
 * kernels convert a rational to a BigDecimal only after they raise the
 * working precision, so it carries every digit a pass needs. Converting it
 * at the engine's precision first (1/3 → 0.333…3 with `ce.precision`
 * digits) would put a rounding error in the last digit of the operand, and
 * that error reaches the last digit of the result.
 */
export type HurwitzOperand = BigNum | readonly [bigint, bigint];

function isRationalOperand(x: HurwitzOperand): x is readonly [bigint, bigint] {
  return Array.isArray(x);
}

/** The operand as a BigDecimal, at the current `BigDecimal.precision`. */
function hurwitzOperandBig(x: HurwitzOperand): BigNum {
  if (!isRationalOperand(x)) return x;
  return new BigDecimal(x[0]).div(new BigDecimal(x[1]));
}

/** The operand as an exact rational: a BigDecimal is sig·10^exp exactly. */
function hurwitzOperandRational(x: HurwitzOperand): [bigint, bigint] {
  if (isRationalOperand(x)) return [x[0], x[1]];
  return x.exponent >= 0
    ? [x.significand * 10n ** BigInt(x.exponent), 1n]
    : [x.significand, 10n ** BigInt(-x.exponent)];
}

/** The operand as a double (planning only). */
function hurwitzOperandNumber(x: HurwitzOperand): number {
  return hurwitzOperandBig(x).toNumber();
}

function hurwitzOperandIsInteger(x: HurwitzOperand): boolean {
  return isRationalOperand(x) ? x[0] % x[1] === 0n : x.isInteger();
}

function hurwitzOperandIsNegative(x: HurwitzOperand): boolean {
  return isRationalOperand(x) ? x[0] < 0n : x.isNegative();
}

/** x + k, exact. */
function hurwitzOperandAddInt(x: HurwitzOperand, k: bigint): HurwitzOperand {
  return isRationalOperand(x)
    ? [x[0] + k * x[1], x[1]]
    : x.add(new BigDecimal(k));
}

/** 1 − x, exact. */
function hurwitzOperandOneMinus(x: HurwitzOperand): HurwitzOperand {
  return isRationalOperand(x) ? [x[1] - x[0], x[1]] : BigDecimal.ONE.sub(x);
}

interface HurwitzEMPlan {
  /** Direct terms Σ_{k<N} (k+a)^{-s}. */
  terms: number;
  /** Euler-Maclaurin Bernoulli-pair corrections. */
  pairs: number;
  /** log10 of the largest single term — how many digits the sum cancels. */
  largest: number;
}

/** ln|(k+a)^{-s}| for real k+a, s. */
function lnAbsHurwitzTerm(w: number, s: number): number {
  return -s * Math.log(Math.abs(w));
}

/**
 * Choose N (direct terms) and M (Bernoulli pairs) so the Euler-Maclaurin
 * tail's first omitted term is below 10^(−digits), from doubles only —
 * this sizes the sum, it does not compute it. `sRe`/`aRe` are the real
 * s, a as doubles; the actual sum is taken in `BigNum` by `hurwitzZetaBigEM`.
 *
 * `digits` is an absolute target and is negative when the result is very
 * large. `relDigits` (the significant digits the caller wants) bounds how
 * many pairs the search may try in that case.
 *
 * `sDist` is |s − round(s)|, taken from the exact operand. The Pochhammer
 * factor (s + m) closest to zero is read from it, not from `sRe + m`: for
 * s = −2 + 10⁻³⁰, `sRe` rounds to −2 and `sRe + 2 = 0` would end the
 * correction series as if s were the integer −2, whose Pochhammer symbol
 * is zero from that factor on. Only an exact integer s has `sDist = 0`.
 */
function hurwitzZetaBigPlan(
  sRe: number,
  sDist: number,
  aRe: number,
  digits: number,
  relDigits: number
): HurwitzEMPlan | undefined {
  const LN_2PI = Math.log(2 * Math.PI);
  const target = -digits * Math.LN10 - Math.LN10;
  const n0 = Math.max(0, Math.ceil(1 - aRe)); // z = a + n ≥ 1
  // The remainder bound needs s + 2M − 1 > 0 (see below), so far left of
  // the strip the pairs start at (1 − s)/2.
  const minPairs = Math.max(0, Math.ceil((1 - sRe) / 2));
  if (minPairs > HURWITZ_BIG_MAX_PAIRS) return undefined;
  const maxPairs = Math.min(
    HURWITZ_BIG_MAX_PAIRS,
    4 * Math.max(digits, relDigits) + 50 + minPairs
  );
  const sNearest = Math.round(sRe);
  const absFactor = (m: number): number =>
    sNearest + m === 0 ? sDist : Math.abs(sRe + m); // |s + m|
  let best: HurwitzEMPlan | undefined;
  let bestCost = Infinity;
  let firstN = -1;
  for (
    let n = n0;
    firstN < 0 || n <= 2 * firstN + 8;
    n += Math.max(1, Math.ceil((n - n0) / 16))
  ) {
    if (n > n0 + 1e6) break;
    const z = aRe + n;
    const lnZ = Math.log(Math.abs(z));
    const lnZs = lnAbsHurwitzTerm(z, sRe); // ln |z^{-s}|
    let lnPoch = Math.log(absFactor(0)); // ln |(s)_1|
    let largest = lnZs + lnZ - Math.log(Math.abs(sRe - 1)); // z^{1-s}/(s-1)
    let prev = Infinity;
    let pairs = -1;
    for (let j = 1; j <= maxPairs; j++) {
      // |B₂ⱼ/(2j)!| ≈ 2/(2π)^{2j}; z^{-s-2j+1} = z^{-s}·z^{1-2j}
      const t = Math.LN2 - 2 * j * LN_2PI + lnPoch + lnZs - (2 * j - 1) * lnZ;
      // The first omitted term bounds the remainder only once s + 2j − 1 > 0:
      // before that, the Pochhammer factors are negative and the later terms
      // can grow far past a small one (s = −400.5 at z = 1.3: the j = 1 term
      // is near 10^43, the terms near j = 200 near 10^600). An exact
      // termination (a zero factor) ends the series anywhere.
      if (t === -Infinity || (t < target && sRe + 2 * j - 1 > 0)) {
        pairs = j - 1;
        break;
      }
      if (t > prev) break; // past the smallest term: this N can't get there
      largest = Math.max(largest, t);
      prev = t;
      lnPoch += Math.log(absFactor(2 * j - 1)) + Math.log(absFactor(2 * j));
    }
    if (pairs < 0) continue;
    if (firstN < 0) firstN = n;
    for (let k = 0; k < n; k++) {
      const w = aRe + k;
      if (w === 0) continue;
      largest = Math.max(largest, lnAbsHurwitzTerm(w, sRe));
    }
    const cost = n + pairs / 8;
    if (cost < bestCost) {
      bestCost = cost;
      best = { terms: n, pairs, largest: largest / Math.LN10 };
    }
  }
  return best;
}

/**
 * A cheap estimate of log10|ζ(s,a)| for real s ≠ 1 and a ≥ 0, from doubles.
 * It sizes the first Euler-Maclaurin pass only: `bigHurwitzZetaEM` measures
 * the magnitude of each result and repeats when the estimate was too high,
 * and an estimate that is too low only costs extra digits.
 *
 * - s > 1: every term is positive, so ζ(s,a) is at least its first term
 *   w^(−s) (w = a, or 1 when a = 0 because the k + a = 0 term is dropped)
 *   and at least ∫_w^∞ x^(−s) dx = w^(1−s)/(s − 1).
 * - s < 0: the larger of the value at a ≤ 1, whose size is about
 *   2·Γ(1 − s)/(2π)^(1 − s) (from Hurwitz's Fourier series for ζ(s,a)),
 *   and the leading term |a^(1−s)/(s − 1)| of the expansion for large a.
 * - 0 ≤ s < 1: the leading term for large a, and at least 1.
 */
function hurwitzLog10Estimate(sRe: number, aRe: number): number {
  const w = aRe > 0 ? aRe : 1;
  const leading = (1 - sRe) * Math.log10(w) - Math.log10(Math.abs(sRe - 1));
  if (sRe > 1) return Math.max(-sRe * Math.log10(w), leading);
  if (sRe < 0) {
    const reflected =
      (Math.LN2 + gammaln(1 - sRe) - (1 - sRe) * Math.log(2 * Math.PI)) /
      Math.LN10;
    return Math.max(reflected, leading);
  }
  return Math.max(0, leading);
}

/** B₂ⱼ/(2j)!, cached at the most digits any call has wanted so far and
 * downsampled to fewer when asked. */
let hurwitzEmCoeffCache: BigNum[] = [];
let hurwitzEmCoeffDigits = 0;
/** (2·index)!, advanced one step at a time: the coefficients are filled in
 * order j = 1, 2, 3, …, so each needs two more multiplications, not a
 * factorial from scratch. */
let hurwitzEmFactIndex = 0;
let hurwitzEmFact = 1n;
function hurwitzEmCoeff(
  bernoulli: [bigint, bigint][],
  j: number,
  digits: number
): BigNum {
  if (digits > hurwitzEmCoeffDigits) {
    hurwitzEmCoeffCache = [];
    hurwitzEmCoeffDigits = digits;
  }
  if (hurwitzEmCoeffCache[j] === undefined) {
    if (j < hurwitzEmFactIndex) {
      hurwitzEmFactIndex = 0;
      hurwitzEmFact = 1n;
    }
    while (hurwitzEmFactIndex < j) {
      hurwitzEmFactIndex += 1;
      hurwitzEmFact *=
        BigInt(2 * hurwitzEmFactIndex - 1) * BigInt(2 * hurwitzEmFactIndex);
    }
    const saved = BigDecimal.precision;
    BigDecimal.precision = hurwitzEmCoeffDigits;
    try {
      const [num, den] = bernoulli[j - 1]; // B₂ⱼ
      hurwitzEmCoeffCache[j] = new BigDecimal(num).div(
        new BigDecimal(den * hurwitzEmFact)
      );
    } finally {
      BigDecimal.precision = saved;
    }
  }
  return digits === hurwitzEmCoeffDigits
    ? hurwitzEmCoeffCache[j]
    : hurwitzEmCoeffCache[j].toPrecision(digits);
}

/**
 * Euler-Maclaurin sum for a `plan`, run with `BigDecimal.precision` already
 * set to `workDigits`. Every intermediate is rounded to `workDigits`: `add`
 * and `mul` are exact and unrounded (see `BigDecimal.mul`'s doc comment),
 * so an accumulating product (`poch`, `zPow`) left unrounded would grow its
 * significand every step.
 */
function hurwitzZetaBigEM(
  ce: ComputeEngine,
  s: BigNum,
  a: BigNum,
  plan: HurwitzEMPlan,
  workDigits: number
): BigNum {
  const rnd = (x: BigNum): BigNum => x.toPrecision(workDigits);
  const negS = s.neg();
  let sum = BigDecimal.ZERO;
  for (let k = 0; k < plan.terms; k++) {
    if ((k & 0xff) === 0) checkDeadline(ce._deadlineFrame);
    const w = a.add(k);
    if (w.isZero()) continue; // Wolfram's HurwitzZeta drops the (k+a) = 0 term
    sum = rnd(sum.add(rnd(w.pow(negS))));
  }
  const z = a.add(plan.terms);
  const zNegS = rnd(z.pow(negS));
  sum = rnd(sum.add(rnd(zNegS.mul(z).div(s.sub(1))))); // z^{1-s}/(s-1)
  sum = rnd(sum.add(rnd(zNegS.mul(BigDecimal.HALF)))); // ½z^{-s}
  if (plan.pairs === 0) return sum;
  const bernoulli = getBernoulliRationals(ce, plan.pairs);
  const zInv2 = rnd(BigDecimal.ONE.div(z.mul(z)));
  let zPow = rnd(zNegS.div(z)); // z^{-s-2j+1}, starting from j = 1
  let poch = s; // (s)_{2j-1}
  for (let j = 1; j <= plan.pairs; j++) {
    if ((j & 0xff) === 0) checkDeadline(ce._deadlineFrame);
    sum = rnd(
      sum.add(
        rnd(rnd(poch.mul(zPow)).mul(hurwitzEmCoeff(bernoulli, j, workDigits)))
      )
    );
    poch = rnd(rnd(poch.mul(s.add(2 * j - 1))).mul(s.add(2 * j)));
    zPow = rnd(zPow.mul(zInv2));
  }
  return sum;
}

/**
 * Bignum Hurwitz zeta ζ(s,a) for real s ≠ 1 and a ≥ 0, via Euler-Maclaurin,
 * with the requested number of significant digits (see the section comment
 * for how the passes are sized). Drops a (k+a) = 0 term. Returns
 * `undefined` when reaching the precision would need more than
 * `HURWITZ_BIG_MAX_WORKING_DIGITS` working digits or more than
 * `HURWITZ_BIG_MAX_PASSES` passes.
 */
function bigHurwitzZetaEM(
  ce: ComputeEngine,
  s: HurwitzOperand,
  a: HurwitzOperand
): BigNum | undefined {
  const requested = BigDecimal.precision;
  const sInteger = hurwitzOperandIsInteger(s);
  const sRe = hurwitzOperandNumber(s);
  const aRe = hurwitzOperandNumber(a);
  if (!Number.isFinite(sRe) || !Number.isFinite(aRe)) return undefined;
  if (sInteger && sRe === 1) return undefined; // pole; caller special-cases s = 1

  // s = −n, an integer ≤ 0: ζ(−n, a) = −Bₙ₊₁(a)/(n + 1), a polynomial in a,
  // taken exactly. The series below terminates there too, but its rounding
  // leaves a residue where the polynomial is zero (ζ(−2, 1/2) = 0), and the
  // relative-precision check can never accept a residue.
  if (sInteger && sRe <= 0 && sRe >= -100) {
    const n = -sRe;
    let x = hurwitzOperandRational(a);
    if (x[0] === 0n) x = [1n, 1n]; // the k + a = 0 term is dropped
    const [num, den] = bernoulliPolynomialRational(n + 1, x);
    if (num === 0n) return BigDecimal.ZERO;
    return new BigDecimal(-num).div(new BigDecimal(den * BigInt(n + 1)));
  }

  let sDist = 0;
  if (!sInteger) {
    const saved = BigDecimal.precision;
    BigDecimal.precision = requested + SPECIAL_FN_GUARD;
    try {
      const sBig = hurwitzOperandBig(s);
      sDist = sBig.sub(sBig.round()).abs().toNumber();
    } finally {
      BigDecimal.precision = saved;
    }
  }

  const relative = requested + SPECIAL_FN_GUARD;
  let absolute = relative - Math.floor(hurwitzLog10Estimate(sRe, aRe));
  for (let pass = 0; pass < HURWITZ_BIG_MAX_PASSES; pass++) {
    const plan = hurwitzZetaBigPlan(sRe, sDist, aRe, absolute, relative);
    if (plan === undefined) return undefined;
    // Rounding each intermediate (at most 10^plan.largest) to `working`
    // digits leaves an error near 10^(plan.largest − working): keep it 12
    // digits below the absolute target.
    const working = Math.max(relative, absolute + Math.ceil(plan.largest) + 12);
    if (working > HURWITZ_BIG_MAX_WORKING_DIGITS) return undefined;

    const saved = BigDecimal.precision;
    BigDecimal.precision = working;
    let r: BigNum;
    try {
      r = hurwitzZetaBigEM(
        ce,
        hurwitzOperandBig(s),
        hurwitzOperandBig(a),
        plan,
        working
      );
    } finally {
      BigDecimal.precision = saved;
    }
    if (!r.isFinite()) return undefined;

    // The error is about 10^(−absolute). Accept once the result is large
    // enough that this leaves `requested` digits plus half the guard; when
    // the result is not clearly above the error, its magnitude is unknown
    // and the target widens by a full `relative` step.
    const magnitude = r.isZero() ? -Infinity : Math.floor(bigLog10Abs(r));
    if (magnitude > 2 - absolute) {
      if (absolute + magnitude >= requested + SPECIAL_FN_GUARD / 2)
        return r.toPrecision(requested);
      absolute = relative - magnitude;
    } else absolute += relative;
  }
  return undefined;
}

/**
 * ζ(s,a) for real s and a < 0, as `sign`·F + ζ(s, a + m), where m is the
 * number of k ≥ 0 with k + a < 0 and F = Σ_{k<m} |k + a|^(−s) sums the
 * terms off the positive axis. A (k+a) = 0 term is dropped.
 *
 * The |k + a| are f, f + 1, …, f + m − 1 with f = 1 − (a + m), so for a
 * large m, F is taken as ζ(s, f) − ζ(s, f + m) and the cost does not grow
 * with |a|. The parts can cancel (odd `sign` terms against the tail, or
 * the two Hurwitz values near s = 1), so they are computed with guard
 * digits and the guard is raised once by the digits the sum lost.
 */
function bigZetaFront(
  ce: ComputeEngine,
  s: HurwitzOperand,
  a: HurwitzOperand,
  sign: 1 | -1
): BigNum | undefined {
  // m = ⌈−a⌉ ≥ 1, the number of k ≥ 0 with k + a < 0
  const m = isRationalOperand(a)
    ? (-a[0] + a[1] - 1n) / a[1]
    : a.neg().ceil().toBigInt();
  const rest = hurwitzOperandAddInt(a, m); // in [0, 1)
  const f = hurwitzOperandOneMinus(rest); // in (0, 1]
  const requested = BigDecimal.precision;
  let guard = SPECIAL_FN_GUARD;
  for (let attempt = 0; attempt < 2; attempt++) {
    BigDecimal.precision = requested + guard;
    try {
      const parts: BigNum[] = [];
      const tail = bigHurwitzZetaEM(ce, s, rest);
      if (tail === undefined) return undefined;
      parts.push(tail);
      if (m <= BigInt(HURWITZ_BIG_DIRECT_FRONT)) {
        const negS = hurwitzOperandBig(s).neg();
        const fBig = hurwitzOperandBig(f);
        const count = Number(m);
        let front = BigDecimal.ZERO;
        for (let j = 0; j < count; j++) {
          if ((j & 0xff) === 0) checkDeadline(ce._deadlineFrame);
          front = front
            .add(fBig.add(j).pow(negS))
            .toPrecision(BigDecimal.precision);
        }
        parts.push(sign < 0 ? front.neg() : front);
      } else {
        const head = bigHurwitzZetaEM(ce, s, f);
        if (head === undefined) return undefined;
        const shifted = bigHurwitzZetaEM(ce, s, hurwitzOperandAddInt(f, m));
        if (shifted === undefined) return undefined;
        parts.push(sign < 0 ? head.neg() : head);
        parts.push(sign < 0 ? shifted : shifted.neg());
      }
      let sum = BigDecimal.ZERO;
      for (const p of parts) sum = sum.add(p);
      let largest = -Infinity;
      for (const p of parts)
        if (!p.isZero()) largest = Math.max(largest, bigLog10Abs(p));
      if (largest === -Infinity) return BigDecimal.ZERO;
      const lost = sum.isZero() ? Infinity : largest - bigLog10Abs(sum);
      if (lost <= guard - 8) return sum.toPrecision(requested);
      if (!Number.isFinite(lost)) return undefined;
      guard = Math.ceil(lost) + SPECIAL_FN_GUARD;
    } finally {
      BigDecimal.precision = requested;
    }
  }
  return undefined;
}

/**
 * Bignum Hurwitz zeta ζ(s,a) for real s and a, with `ce.precision`
 * significant digits. Drops the (k+a) = 0 term (Wolfram's `HurwitzZeta`
 * convention, matching `hurwitzZetaComplex`) rather than diverging there —
 * the caller decides pole vs. finite for a non-positive integer `a` itself.
 * For a < 0 the value is real only for an integer s; the caller does not
 * reach this function otherwise, and it returns `undefined` there.
 *
 * Pass an exact rational operand as `[numerator, denominator]` (see
 * `HurwitzOperand`). Returns `undefined` when the kernel cannot reach the
 * requested precision within its working-digit and pass limits; the caller
 * then falls back to the double `hurwitzZetaComplex` kernel.
 *
 * Contributed in GitHub PR #360.
 */
export function bigHurwitzZeta(
  ce: ComputeEngine,
  s: HurwitzOperand,
  a: HurwitzOperand
): BigNum | undefined {
  if (!hurwitzOperandIsNegative(a)) return bigHurwitzZetaEM(ce, s, a);
  if (!hurwitzOperandIsInteger(s)) return undefined; // complex value
  // (k + a)^(−s) = (−1)^s·|k + a|^(−s) for k + a < 0 and integer s
  const odd = isRationalOperand(s)
    ? (s[0] / s[1]) % 2n !== 0n
    : !s.mod(BigDecimal.TWO).isZero();
  return bigZetaFront(ce, s, a, odd ? -1 : 1);
}

/**
 * Bignum generalized zeta Zeta(s,a) in Wolfram's convention (see
 * `zetaGeneralizedComplex`), for real s, a: the terms with k+a < 0 as
 * |k+a|^(-s) — always real, since |k+a| > 0 — then the Hurwitz ζ from
 * the first k with k+a ≥ 0, dropping a k+a = 0 there rather than treating
 * it as a pole.
 */
export function bigZetaGeneralized(
  ce: ComputeEngine,
  s: HurwitzOperand,
  a: HurwitzOperand
): BigNum | undefined {
  if (!hurwitzOperandIsNegative(a)) return bigHurwitzZetaEM(ce, s, a);
  return bigZetaFront(ce, s, a, 1);
}

// --- LerchPhi / PolyLog, arbitrary precision -------------------------------
// cortex-js/compute-engine#374: `LerchPhi` and `PolyLog` answer in doubles
// at any engine precision, unlike `HurwitzZeta` above. For real z, s, a
// inside the series' disk of convergence (|z| < 1), `bigLerchPhi` sums
// Φ(z,s,a) = Σ zᵏ(k+a)^(−s) directly on `BigNum`, to the requested digits.
// Outside that disk, or for a complex operand, the callers keep the
// existing double kernels (`lerchPhiComplex`, `polylogOrderComplex`) — the
// continuation those use (`lerch-phi-continuation.ts`) is a machine-only
// path this series does not need to widen.

/** Past this many terms, `bigLerchPhi` declines rather than keep summing:
 * at 50 requested digits and |z| = 0.99, the series needs about 17,000
 * terms ((digits + `SPECIAL_FN_GUARD`)·ln 10 / −ln|z|), so this leaves
 * headroom for a guard-digit retry pass without letting z closer to the
 * rim (`|z| = 0.9999` needs past 1.7 million) run unbounded. */
const LERCH_BIG_MAX_TERMS = 30_000;

/** `bigLerchPhi` accepts its analytic tail bound (see the function's doc
 * comment) only once it has held for this many consecutive terms: a
 * single term passing the bound is not proof the series has entered its
 * decreasing regime — a negative order makes earlier terms grow first. */
const LERCH_BIG_CONSECUTIVE = 3;

/**
 * Φ(z, s, a) = Σ_{k≥0} zᵏ(k+a)^(−s) at `BigDecimal.precision` significant
 * digits, for real z, s, a with |z| < 1 — the arbitrary-precision twin of
 * `numerics/lerch-phi.ts`'s double series (`lerchPhiComplex`), for the
 * same disk of convergence. `PolyLog` rides on it at a = 1, via
 * `bigPolyLog`: Liₛ(z) = z·Φ(z, s, 1).
 *
 * The ratio between consecutive terms is z·((k+a)/(k+1+a))^s. For s ≥ 0
 * it is at most |z|; for s < 0 it is bounded by |z|·e^{−s/(k+a)} (since
 * (k+1+a)/(k+a) = 1 + 1/(k+a) ≤ e^{1/(k+a)}), which still falls toward |z|
 * as k grows. Once that bound R is below 1, the tail after term k is at
 * most |term_k|·R/(1−R); `bigLerchPhi` sums until `LERCH_BIG_CONSECUTIVE`
 * consecutive terms clear that bound at the requested precision, or
 * declines after `LERCH_BIG_MAX_TERMS`.
 *
 * A (k+a) = 0 term is `w.pow(−s)`: 0^0 = 1 (only k = 0, a = 0), 0^positive
 * = 0 (s < 0), and 0^negative is a pole (s > 0) — `bigLerchPhi` declines
 * there, the same way `bigHurwitzZeta`'s caller decides pole vs. finite
 * for `HurwitzZeta` at a non-positive integer base point. A negative w (a
 * a negative integer; a non-integer a would need k + a ≥ 0 before k = 0)
 * needs an integer s to stay real — `BigDecimal.pow` answers NaN
 * otherwise, and `bigLerchPhi` declines there too.
 *
 * Pass an exact rational operand as `[numerator, denominator]` (see
 * `HurwitzOperand`) so it converts only once the working precision below
 * is raised — the same reason `hurwitzOperand` gives for `HurwitzZeta`.
 */
export function bigLerchPhi(
  ce: ComputeEngine,
  z: HurwitzOperand,
  s: HurwitzOperand,
  a: HurwitzOperand
): BigNum | undefined {
  const zd = hurwitzOperandNumber(z);
  const sd = hurwitzOperandNumber(s);
  const ad = hurwitzOperandNumber(a);
  if (!(Math.abs(zd) < 1) || !Number.isFinite(sd) || !Number.isFinite(ad))
    return undefined;

  const requested = BigDecimal.precision;
  let guard = SPECIAL_FN_GUARD;
  for (let attempt = 0; attempt < 2; attempt++) {
    BigDecimal.precision = requested + guard;
    let r: { readonly sum: BigNum; readonly largest: number } | undefined;
    try {
      r = lerchPhiSeries(
        ce,
        hurwitzOperandBig(z),
        hurwitzOperandBig(s),
        hurwitzOperandBig(a),
        zd,
        sd,
        ad
      );
    } finally {
      BigDecimal.precision = requested;
    }
    if (r === undefined) return undefined;
    if (r.sum.isZero()) return r.sum.toPrecision(requested);
    // Terms larger than the sum cancel (an alternating series, z < 0): if
    // that ate into the guard, redo with the digits it ate added.
    const lost = Math.ceil(r.largest - bigLog10Abs(r.sum));
    if (lost <= guard - 8) return r.sum.toPrecision(requested);
    if (!Number.isFinite(lost)) return undefined;
    guard = lost + SPECIAL_FN_GUARD;
  }
  return undefined;
}

/** The series at `BigDecimal.precision` (already raised by the caller),
 * with log10 of its largest term — how many digits the sum cancelled, if
 * it ended up much smaller. `zd`/`sd`/`ad` are the operands as doubles,
 * sizing the tail-bound estimate before paying for the exact `BigNum`
 * check (see `bigLerchPhi`'s doc comment). */
function lerchPhiSeries(
  ce: ComputeEngine,
  z: BigNum,
  s: BigNum,
  a: BigNum,
  zd: number,
  sd: number,
  ad: number
): { readonly sum: BigNum; readonly largest: number } | undefined {
  const working = BigDecimal.precision;
  const rnd = (x: BigNum): BigNum => x.toPrecision(working);
  const negS = s.neg();
  const growth = Math.max(0, -sd); // max(0, −s), the ratio bound's growth term
  let sum = BigDecimal.ZERO;
  let zPow = BigDecimal.ONE; // zᵏ
  let largest = -Infinity;
  let confirmed = 0; // consecutive terms that cleared the tail bound
  for (let k = 0; k < LERCH_BIG_MAX_TERMS; k++) {
    if ((k & 0xff) === 0) checkDeadline(ce._deadlineFrame);
    const w = a.add(k);
    const power = rnd(w.pow(negS));
    if (power.isNaN()) return undefined; // w < 0, non-integer s: complex
    if (!power.isFinite()) return undefined; // w = 0, s > 0: a pole
    const term = rnd(zPow.mul(power));
    sum = rnd(sum.add(term));
    if (!term.isZero()) largest = Math.max(largest, bigLog10Abs(term));

    const base = ad + k;
    const estimate = base > 0 ? zd * Math.exp(growth / base) : Infinity;
    const ratio = Math.abs(estimate);
    const termAbs = term.isZero() ? 0 : Math.abs(term.toNumber());
    if (ratio < 1 && termAbs > 0) {
      const tail = termAbs * (ratio / (1 - ratio));
      const sumAbs = sum.isZero() ? 0 : Math.abs(sum.toNumber());
      if (tail === 0 || Math.log10(tail) < Math.log10(sumAbs || 1) - working) {
        confirmed += 1;
        if (confirmed >= LERCH_BIG_CONSECUTIVE) return { sum, largest };
        zPow = rnd(zPow.mul(z));
        continue;
      }
    }
    confirmed = 0;
    zPow = rnd(zPow.mul(z));
  }
  return undefined;
}

/**
 * PolyLog's arbitrary-precision route: Liₛ(z) = z·Φ(z, s, 1) on
 * `bigLerchPhi`, at `BigDecimal.precision` significant digits — the same
 * identity the double kernel (`polylogOrderReal`/`polylogOrderComplex`)
 * uses, but exact for a rational z or s and answering the requested
 * digits above machine precision.
 */
export function bigPolyLog(
  ce: ComputeEngine,
  s: HurwitzOperand,
  z: HurwitzOperand
): BigNum | undefined {
  const phi = bigLerchPhi(ce, z, s, [1n, 1n]);
  if (phi === undefined) return undefined;
  return hurwitzOperandBig(z).mul(phi).toPrecision(BigDecimal.precision);
}

/** Halley refinement of a BigDecimal Lambert W estimate `w` toward the root of
 *  w·e^w = x (branch-independent), rounded to working precision. `tol` is the
 *  convergence tolerance. */
function bigLambertWHalley(w: BigNum, x: BigNum, tol: BigNum): BigNum {
  // Halley's method: converges cubically
  for (let i = 0; i < 100; i++) {
    const ew = w.exp();
    const wew = w.mul(ew);
    const f = wew.sub(x);
    const fp = ew.mul(w.add(1));
    const fpp = ew.mul(w.add(2));
    const delta = f.div(fp.sub(f.mul(fpp).div(fp.mul(2))));
    w = w.sub(delta);
    if (delta.abs().lt(tol.mul(w.abs().add(1)))) break;
  }

  // Round to working precision: `sub`/`mul` in the Halley loop don't round, so
  // `w` carries digits beyond BigDecimal.precision that are not converged.
  // (NU-P1-10)
  return w.toPrecision(BigDecimal.precision);
}

/**
 * Bignum Lambert W function W_k(x) satisfying W(x)·e^{W(x)} = x.
 *
 * `branch` selects the real branch (0 = principal W₀, defined for x ≥ −1/e;
 * −1 = the second real branch W₋₁, defined for −1/e ≤ x < 0). Any other (or
 * non-integer) branch index returns NaN — the complex branches are out of
 * scope for this real kernel. Uses Halley's method with adaptive precision.
 */
export function bigLambertW(ce: ComputeEngine, x: BigNum, branch = 0): BigNum {
  if (!x.isFinite()) return x; // ±Infinity, NaN

  const invE = BigDecimal.ONE.div(BigDecimal.ONE.exp()); // 1/e
  const negInvE = invE.neg();

  // The convergence tolerance is the *working* precision (BigDecimal.precision),
  // not `ce.precision`: everything else in this iteration rounds to
  // BigDecimal.precision, and reading a looser `ce.precision` here let Halley
  // stop early (or, when the working precision was higher, left a garbage tail
  // beyond the true precision). (NU-P1-10)
  const tol = new BigDecimal(10).pow(-BigDecimal.precision);
  const branchTol = new BigDecimal(10).pow(-15); // machine precision tolerance

  if (branch === 0) {
    if (x.isZero()) return new BigDecimal(0);

    // Branch point: W(-1/e) = -1. Use a tolerance that accounts for
    // machine-precision inputs.
    if (x.sub(negInvE).abs().lt(branchTol)) return BigDecimal.NEGATIVE_ONE;

    // W₀ is defined for x >= -1/e
    if (x.lt(negInvE)) return BigDecimal.NAN;

    // Initial guess using machine precision
    let w: BigNum;
    const xNum = x.toNumber();
    if (xNum < 0) {
      const p = Math.sqrt(2 * (Math.E * xNum + 1));
      w = new BigDecimal(-1 + p - (p * p) / 3 + (11 / 72) * p * p * p);
    } else if (xNum <= 1) {
      w = new BigDecimal(xNum * (1 - xNum * (1 - 1.5 * xNum)));
    } else if (xNum < 100) {
      const lnx = Math.log(xNum);
      w = new BigDecimal(lnx - Math.log(lnx));
    } else {
      const l1 = x.ln();
      const l2 = l1.ln();
      w = l1.sub(l2).add(l2.div(l1));
    }
    return bigLambertWHalley(w, x, tol);
  }

  if (branch === -1) {
    // Branch point: W₋₁(-1/e) = -1
    if (x.sub(negInvE).abs().lt(branchTol)) return BigDecimal.NEGATIVE_ONE;

    // W₋₁ is real only on -1/e <= x < 0
    if (x.lt(negInvE) || x.gte(0)) return BigDecimal.NAN;

    // Initial guess using machine precision (mirror of the W₀ series near the
    // branch point; log asymptotic near 0⁻).
    let w: BigNum;
    const xNum = x.toNumber();
    if (xNum < -0.27) {
      const p = Math.sqrt(2 * (Math.E * xNum + 1));
      w = new BigDecimal(-1 - p - (p * p) / 3 - (11 / 72) * p * p * p);
    } else {
      const l1 = Math.log(-xNum);
      w = new BigDecimal(l1 - Math.log(-l1));
    }
    return bigLambertWHalley(w, x, tol);
  }

  // Other (complex) branches are out of scope for the real kernel.
  return BigDecimal.NAN;
}

// Euler-Mascheroni constant
const EULER_MASCHERONI = 0.5772156649015329;

// Bernoulli numbers B_{2k} for k=1..10 (used in asymptotic expansions)
export const BERNOULLI_2K = [
  1 / 6, // B_2
  -1 / 30, // B_4
  1 / 42, // B_6
  -1 / 30, // B_8
  5 / 66, // B_10
  -691 / 2730, // B_12
  7 / 6, // B_14
  -3617 / 510, // B_16
  43867 / 798, // B_18
  -174611 / 330, // B_20
];

/**
 * Digamma function ψ(x) = d/dx ln(Γ(x)) = Γ'(x)/Γ(x)
 * Uses recurrence to shift x > 7 then asymptotic expansion.
 */
export function digamma(x: number): number {
  if (!isFinite(x)) return NaN;

  // Reflection formula for negative values: ψ(1-x) = ψ(x) + π·cot(πx)
  if (x < 0) {
    if (Number.isInteger(x)) return NaN; // poles at non-positive integers
    return digamma(1 - x) - Math.PI / Math.tan(Math.PI * x);
  }

  // Special value
  if (x === 0) return NaN; // pole

  // Recurrence: ψ(x+1) = ψ(x) + 1/x — shift x up until x > 7
  let result = 0;
  let z = x;
  while (z < 7) {
    result -= 1 / z;
    z += 1;
  }

  // Asymptotic expansion: ψ(z) ~ ln(z) - 1/(2z) - Σ B_{2k}/(2k·z^{2k})
  result += Math.log(z) - 1 / (2 * z);
  let z2k = z * z; // z^2
  for (let k = 0; k < BERNOULLI_2K.length; k++) {
    result -= BERNOULLI_2K[k] / (2 * (k + 1) * z2k);
    z2k *= z * z;
  }

  return result;
}

/**
 * Trigamma function ψ₁(x) = d/dx ψ(x) = d²/dx² ln(Γ(x))
 * Uses recurrence + asymptotic expansion.
 */
export function trigamma(x: number): number {
  if (!isFinite(x)) return NaN;

  // Reflection formula: ψ₁(1-x) + ψ₁(x) = π²/sin²(πx)
  if (x < 0) {
    if (Number.isInteger(x)) return NaN;
    const s = Math.sin(Math.PI * x);
    return (Math.PI * Math.PI) / (s * s) - trigamma(1 - x);
  }

  if (x === 0) return NaN; // pole

  // Recurrence: ψ₁(x+1) = ψ₁(x) - 1/x²
  let result = 0;
  let z = x;
  while (z < 7) {
    result += 1 / (z * z);
    z += 1;
  }

  // Asymptotic: ψ₁(z) ~ 1/z + 1/(2z²) + Σ B_{2k}/z^{2k+1}
  result += 1 / z + 1 / (2 * z * z);
  let z2kp1 = z * z * z; // z^3
  for (let k = 0; k < BERNOULLI_2K.length; k++) {
    result += BERNOULLI_2K[k] / z2kp1;
    z2kp1 *= z * z;
  }

  return result;
}

/**
 * Polygamma function ψₙ(x) = dⁿ/dxⁿ ψ(x)
 * PolyGamma(0, x) = Digamma(x), PolyGamma(1, x) = Trigamma(x)
 * For n ≥ 2, uses recurrence + asymptotic expansion.
 */
export function polygamma(n: number, x: number): number {
  // The same order limit as `polygammaComplex` and `bigPolygamma`.
  if (!Number.isInteger(n) || n < 0 || n > POLYGAMMA_MAX_ORDER) return NaN;
  if (n === 0) return digamma(x);
  if (n === 1) return trigamma(x);
  if (!isFinite(x) || x === 0) return NaN;

  // Poles at x = 0, −1, −2, … (x === 0 is rejected above)
  if (x < 0 && Number.isInteger(x)) return NaN;

  // Recurrence (from ψ(x+1) = ψ(x) + 1/x differentiated n times, DLMF 5.15.5):
  //   ψ⁽ⁿ⁾(x) = ψ⁽ⁿ⁾(x+1) + (−1)^{n+1} n!/x^{n+1}
  // Shift upward (this also lifts negative non-integer x past the poles)
  // until z ≥ n + 10, where the 10-term Bernoulli tail below reaches full
  // double precision: the first omitted term, |B₂₂|·(n+21)!/(22!·(n−1)!·z²²)
  // relative to the leading (n−1)!/zⁿ, is ≲ 1e−17 for z ≥ n + 10 (n ≲ 20).
  let result = 0;
  let z = x;
  const factN = factorial(n);
  const sign = n % 2 === 0 ? -1 : 1; // (−1)^{n+1}
  const zMin = n + 10;
  while (z < zMin) {
    result += (sign * factN) / Math.pow(z, n + 1);
    z += 1;
  }

  // Asymptotic expansion (DLMF 5.15.9, extended to general n — obtained by
  // differentiating DLMF 5.11.2 n times):
  //   ψ⁽ⁿ⁾(z) ~ (−1)^{n−1} [ (n−1)!/zⁿ + n!/(2z^{n+1})
  //             + Σ_{k≥1} B₂ₖ·(2k+n−1)!/((2k)!·z^{2k+n}) ]
  const signA = n % 2 === 0 ? -1 : 1; // (−1)^{n−1}
  result += (signA * factorial(n - 1)) / Math.pow(z, n);
  result += (signA * factN) / (2 * Math.pow(z, n + 1));

  // Bernoulli tail. The k-th factor fₖ = (2k+n−1)!/((2k)!·z^{2k+n}) is built
  // incrementally: f₁ = (n+1)!/(2!·z^{n+2}),
  //   f_{k+1} = fₖ·(2k+n)(2k+n+1)/((2k+1)(2k+2)·z²).
  // (A previous version used n(n+1)⋯(n+2k−1)/(2k)! — a factor (n−1)! too
  // small; only n ≤ 2 was unaffected since 1! = 0! = 1.)
  let f = (factN * (n + 1)) / (2 * Math.pow(z, n + 2));
  let prevAbs = Infinity;
  for (let k = 1; k <= BERNOULLI_2K.length; k++) {
    const term = BERNOULLI_2K[k - 1] * f;
    // The expansion is divergent: stop at the smallest term
    if (Math.abs(term) >= prevAbs) break;
    result += signA * term;
    prevAbs = Math.abs(term);
    const m = 2 * k;
    f *= ((m + n) * (m + n + 1)) / ((m + 1) * (m + 2) * z * z);
  }

  // A result that is not finite comes from an intermediate that overflows a
  // double (n! for n > 170, or a power of a small x), even when the value
  // itself is representable (ψ⁽²⁰⁰⁾(300) ≈ −2.03·10⁻¹²³). `polygammaComplex`
  // carries n! and the powers in scaled form: it gives the value, or NaN
  // when the value is outside the range of a double.
  if (!Number.isFinite(result)) return polygammaComplex(n, x).re;
  return result;
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/**
 * Beta function B(a, b) = Γ(a)Γ(b)/Γ(a+b)
 * Uses gamma directly for small args (more accurate) and gammaln for large.
 */
export function beta(a: number, b: number): number {
  // For large arguments, use gammaln to avoid overflow
  if (a > 100 || b > 100 || a + b > 100) {
    return Math.exp(gammaln(a) + gammaln(b) - gammaln(a + b));
  }
  // Direct computation: more accurate for small arguments
  return (gamma(a) * gamma(b)) / gamma(a + b);
}

/**
 * Riemann zeta function ζ(s) = Σ_{n=1}^∞ 1/n^s
 *
 * Uses the Cohen–Rodríguez Villegas–Zagier acceleration of the alternating
 * Dirichlet eta series (same algorithm as `bigZeta`), direct summation for
 * large s, and the functional equation for s < 0.
 */
export function zeta(s: number): number {
  if (!isFinite(s)) return NaN;
  if (s === 1) return Infinity; // pole

  // Special values for small positive even integers (DLMF 25.6.1)
  if (s === 0) return -0.5;
  if (s === 2) return (Math.PI * Math.PI) / 6;
  if (s === 4) return Math.PI ** 4 / 90;
  if (s === 6) return Math.PI ** 6 / 945;
  if (s === 8) return Math.PI ** 8 / 9450;

  // Negative integers (DLMF 25.6.3): ζ(−n) = −B_{n+1}/(n+1).
  // Even −n are the trivial zeros (odd Bernoulli numbers vanish); for odd −n
  // down to −19 the closed form is exact to ≤1 ulp, avoiding the Γ and π-power
  // roundings of the functional equation.
  if (s < 0 && Number.isInteger(s)) {
    if (s % 2 === 0) return 0;
    const np1 = 1 - s; // n + 1, even
    if (np1 / 2 <= BERNOULLI_2K.length) return -BERNOULLI_2K[np1 / 2 - 1] / np1;
  }

  // Functional equation for Re(s) < 0 (DLMF 25.4.2):
  // ζ(s) = 2^s π^{s-1} sin(πs/2) Γ(1-s) ζ(1-s)
  if (s < 0) {
    return (
      Math.pow(2, s) *
      Math.pow(Math.PI, s - 1) *
      Math.sin((Math.PI * s) / 2) *
      gamma(1 - s) *
      zeta(1 - s)
    );
  }

  // Large s: the Dirichlet series 1 + 2^{−s} + 3^{−s} + … converges to full
  // double precision in ≤ ~10^{18/s} terms (tail Σ_{m>M} m^{−s} < M^{1−s}/(s−1)).
  if (s >= 12) {
    let sum = 1;
    for (let m = 2; m <= 128; m++) {
      const t = Math.pow(m, -s);
      sum += t;
      if (t < sum * 1e-18) break;
    }
    return sum;
  }

  // 0 < s < 12, s ≠ 1: Borwein's alternating-series acceleration
  // (P. Borwein, "An efficient algorithm for the Riemann zeta function",
  // CMS Conf. Proc. 27 (2000), Proposition 1; equivalently Cohen–Rodríguez
  // Villegas–Zagier, Exp. Math. 9 (2000), Algorithm 1 — the same algorithm
  // `zetaCore` uses for the bignum lane):
  //   ζ(s) = [Σ_{k=0}^{n−1} (−1)^k (d_n − d_k)/(k+1)^s] / (d_n·(1 − 2^{1−s}))
  // with error ≤ 3·(3+√8)^{−n}·|1−2^{1−s}|^{−1}: n = 28 gives ≈ 1e−21, so
  // double rounding dominates. The weights d_n − d_k are exact integers,
  // precomputed by `zetaBorweinWeights` and correctly rounded to doubles, and
  // the sum is Kahan-compensated, leaving only the per-term Math.pow
  // rounding (≲2 ulp total). (A previous version used binomial partial sums
  // for d_k, which converge only as 2^{−n} ≈ 2.4e−7.)
  const [ek, dn] = zetaBorweinWeights();
  let sum = 0;
  let comp = 0; // Kahan compensation
  for (let k = 0; k < ZETA_BORWEIN_N; k++) {
    const t = (k % 2 === 0 ? ek[k] : -ek[k]) * Math.pow(k + 1, -s);
    const y = t - comp;
    const u = sum + y;
    comp = u - sum - y;
    sum = u;
  }
  // 1 − 2^{1−s} = −expm1((1−s)·ln 2), computed without cancellation near s = 1
  return sum / dn / -Math.expm1((1 - s) * Math.LN2);
}

/**
 * Real Hurwitz zeta ζ(s,a) = Σ (k+a)^(−s), for the compiled (JS) real-scalar
 * path. Re(s) ≪ 0 with a ≠ 1 needs the same Taylor-shift the complex kernel
 * uses to avoid cancellation (see there), so this delegates to
 * `hurwitzZetaComplex` rather than repeating a simpler, cancellation-prone
 * version.
 *
 * The values match the interpreter's `HurwitzZeta`: `+Infinity` (the float
 * encoding of the undirected infinity) at the pole s = 1 and at a
 * non-positive integer a with s > 0, where the (k + a) = 0 term diverges;
 * ζ(0, a) = 1/2 − a (the (k + a) = 0 term counts as 0⁰ = 1 there, which the
 * kernel drops). A term (k + a)^(−s) with k + a < 0 is complex for a
 * non-integer s, so the value is real only when a ≥ 0 or s is an integer;
 * elsewhere this returns NaN, never the real part alone.
 */
export function hurwitzZeta(s: number, a: number): number {
  if (Number.isNaN(s) || Number.isNaN(a)) return NaN;
  if (s === 1) return Infinity;
  if (s === Infinity && Number.isFinite(a) && a > 0)
    return a > 1 ? 0 : a === 1 ? 1 : Infinity;
  if (a === Infinity && Number.isFinite(s)) return s > 1 ? 0 : NaN;
  if (!Number.isFinite(s) || !Number.isFinite(a)) return NaN;
  if (a <= 0 && Number.isInteger(a) && s > 0) return Infinity;
  if (s === 0) return 0.5 - a;
  if (a < 0 && !Number.isInteger(s)) return NaN;
  return hurwitzZetaComplex(new Complex(s, 0), new Complex(a, 0)).re;
}

/**
 * Real generalized zeta `Zeta(s, a)` in Wolfram's convention, for the
 * compiled (JS) real-scalar path: the same as `hurwitzZeta` for a > 0; for
 * a ≤ 0 the terms with k + a < 0 are |k + a|^(−s) (always real), the
 * (k + a) = 0 term is dropped, and the rest is a Hurwitz ζ at a positive
 * base point. So Zeta(s, 0) = ζ(s), and the only pole is s = 1. This is the
 * real form of `zetaGeneralizedComplex` (`numeric-complex.ts`), which the
 * interpreter uses.
 */
export function zetaGeneralized(s: number, a: number): number {
  if (Number.isNaN(s) || Number.isNaN(a)) return NaN;
  if (s === 1) return Infinity;
  if (a > 0) return hurwitzZeta(s, a);
  if (a === 0) return zeta(s);
  if (!Number.isFinite(s) || !Number.isFinite(a)) return NaN;
  let sum = 0;
  let cur = a;
  while (cur < 0) {
    sum += Math.pow(-cur, -s);
    cur += 1;
  }
  return sum + hurwitzZeta(s, cur === 0 ? 1 : cur);
}

const ZETA_BORWEIN_N = 28;
let ZETA_BORWEIN_CACHE: [number[], number] | null = null;

/** Chebyshev weights for Borwein's ζ algorithm (Proposition 1):
 *    d_k = n·Σ_{i=0}^{k} (n+i−1)!·4^i / ((n−i)!·(2i)!),   n = ZETA_BORWEIN_N.
 *  Returns [e, d_n] with e[k] = d_n − d_k for k = 0..n−1.
 *
 *  The summands t_i = n·(n+i−1)!·4^i/((n−i)!·(2i)!) (t_0 = 1) satisfy
 *    t_{i+1} = t_i · 4(n+i)(n−i) / ((2i+1)(2i+2)),
 *  and are evaluated in 2^64-scaled bigint fixed point, so each weight is
 *  exact to ~64 bits (≫ the 53 the doubles keep). Computed once, cached. */
function zetaBorweinWeights(): [number[], number] {
  if (ZETA_BORWEIN_CACHE) return ZETA_BORWEIN_CACHE;
  const n = ZETA_BORWEIN_N;
  const SCALE = 1n << 64n;
  let t = SCALE; // t_0 = 1, scaled
  let d = SCALE; // d_0 = 1, scaled
  const dk: bigint[] = [d];
  for (let i = 0; i < n; i++) {
    t = (t * BigInt(4 * (n + i) * (n - i))) / BigInt((2 * i + 1) * (2 * i + 2));
    d += t;
    dk.push(d);
  }
  const dn = dk[n];
  const scale = Math.pow(2, 64);
  const e: number[] = [];
  for (let k = 0; k < n; k++) e.push(Number(dn - dk[k]) / scale);
  ZETA_BORWEIN_CACHE = [e, Number(dn) / scale];
  return ZETA_BORWEIN_CACHE;
}

/** Direct series Liₙ(z) = Σ_{k≥1} zᵏ/kⁿ for real z, |z| ≲ 1/2. */
function polylogSeriesReal(n: number, z: number): number {
  let sum = 0;
  let zk = 1;
  for (let k = 1; k < 500; k++) {
    zk *= z;
    const term = zk / Math.pow(k, n);
    sum += term;
    if (Math.abs(term) < 1e-17 * (1 + Math.abs(sum))) break;
  }
  return sum;
}

/** Crandall's ln-expansion about z = 1 for real z ∈ (1/2, 1) (all real):
 *  Liₙ(z) = L^{n−1}/(n−1)!·(H_{n−1} − ln(−L)) + Σ_{k≥0,k≠n−1} ζ(n−k) Lᵏ/k!,
 *  L = ln z < 0. Converges for |L| < 2π. */
function polylogLnExpReal(n: number, z: number): number {
  const L = Math.log(z);
  let H = 0;
  for (let j = 1; j < n; j++) H += 1 / j;
  const lnNegL = Math.log(-L); // −L > 0 for z < 1
  let sum = 0;
  let coef = 1; // Lᵏ/k!
  for (let k = 0; k < 200; k++) {
    const term = k === n - 1 ? coef * (H - lnNegL) : coef * zeta(n - k);
    sum += term;
    // ζ vanishes at the negative even integers (every other term is 0); break
    // only on a small *non-zero* term.
    const a = Math.abs(term);
    if (k > n && a !== 0 && a < 1e-16 * (1 + Math.abs(sum))) break;
    coef = (coef * L) / (k + 1);
  }
  return sum;
}

/**
 * Polylogarithm Liₙ(z) = Σ_{k≥1} zᵏ/kⁿ for integer order n ≥ 2 and real z.
 *
 * Returns a real value on the real-valued domain z ≤ 1 (fast paths for
 * z ∈ [−1/2, 1]); returns NaN for z > 1 (genuinely complex — on the branch
 * cut), for real z outside the fast-path range (z < −1/2, where ln z is
 * complex), and for non-integer/order < 2. In every NaN case the caller
 * (`applyN`) cascades to `polylogComplex`, which yields the correct value
 * (real, with a negligible imaginary part, for real z < 1).
 */
export function polylog(n: number, z: number): number {
  if (!Number.isInteger(n) || n < 2) return NaN;
  if (Number.isNaN(z)) return NaN;
  if (z === 0) return 0;
  if (z === 1) return zeta(n);
  if (z >= -0.5 && z <= 0.5) return polylogSeriesReal(n, z);
  if (z > 0.5 && z < 1) return polylogLnExpReal(n, z);
  return NaN; // |z| > 1 or z < −1/2 → complex kernel
}

/** Halley refinement of a Lambert W estimate `w` toward the root of
 *  w·e^w = x (branch-independent: the same equation on every branch). */
function lambertWHalley(w: number, x: number): number {
  // Halley's method: converges cubically
  for (let i = 0; i < 30; i++) {
    const ew = Math.exp(w);
    const wew = w * ew;
    const f = wew - x;
    const fp = ew * (w + 1);
    const fpp = ew * (w + 2);
    const delta = f / (fp - (f * fpp) / (2 * fp));
    w -= delta;
    if (Math.abs(delta) < 1e-15 * (1 + Math.abs(w))) break;
  }
  return w;
}

/**
 * Lambert W function W_k(x) satisfying W(x)·e^{W(x)} = x.
 *
 * `branch` selects the real branch:
 *   - 0 (default): principal branch W₀, defined for x ≥ −1/e.
 *   - −1: the second real branch W₋₁, defined for −1/e ≤ x < 0.
 * Any other (or non-integer) branch index returns NaN — the complex branches
 * are out of scope for this real kernel.
 *
 * Uses Halley's method with branch-appropriate initial guesses.
 */
export function lambertW(x: number, branch = 0): number {
  if (!isFinite(x)) return x; // ±Infinity, NaN

  const e1 = 1 / Math.E; // 1/e ≈ 0.3679

  if (branch === 0) {
    if (x === 0) return 0;

    // W₀ is defined for x >= -1/e
    if (x < -e1) return NaN;

    // Branch point: W(-1/e) = -1
    if (Math.abs(x + e1) < 1e-15) return -1;

    // Initial guess
    let w: number;
    if (x < 0) {
      // Near -1/e: use series expansion around branch point
      const p = Math.sqrt(2 * (Math.E * x + 1));
      w = -1 + p - (p * p) / 3 + (11 / 72) * p * p * p;
    } else if (x <= 1) {
      w = x * (1 - x * (1 - 1.5 * x)); // Padé-like initial guess for small x
    } else if (x < 100) {
      const lnx = Math.log(x);
      w = lnx - Math.log(lnx);
    } else {
      const l1 = Math.log(x);
      const l2 = Math.log(l1);
      w = l1 - l2 + l2 / l1;
    }
    return lambertWHalley(w, x);
  }

  if (branch === -1) {
    // W₋₁ is real only on -1/e <= x < 0
    if (x < -e1 || x >= 0) return NaN;

    // Branch point: W₋₁(-1/e) = -1
    if (Math.abs(x + e1) < 1e-15) return -1;

    // Initial guess. Near the branch point use the series around -1/e (the
    // mirror of the W₀ series: MINUS p); near 0⁻ use the log asymptotic
    // w ~ ln(-x) - ln(-ln(-x)).
    let w: number;
    if (x < -0.27) {
      const p = Math.sqrt(2 * (Math.E * x + 1));
      w = -1 - p - (p * p) / 3 - (11 / 72) * p * p * p;
    } else {
      const l1 = Math.log(-x);
      w = l1 - Math.log(-l1);
    }
    return lambertWHalley(w, x);
  }

  // Other (complex) branches are out of scope for the real kernel.
  return NaN;
}

/**
 * Bessel function of the first kind J_n(x) for integer order n.
 *
 * Uses power series for small |x|, asymptotic expansion for large |x|,
 * and Miller's backward recurrence for intermediate values.
 *
 * Reference: Abramowitz & Stegun, Ch. 9; NIST DLMF 10.2, 10.17
 */
export function besselJ(n: number, x: number): number {
  if (!isFinite(x) || !Number.isInteger(n)) return NaN;
  if (x === 0) return n === 0 ? 1 : 0;

  // J_{-n}(x) = (-1)^n J_n(x) for integer n
  if (n < 0) {
    n = -n;
    return n % 2 === 0 ? besselJ(n, x) : -besselJ(n, x);
  }

  // J_n(-x) = (-1)^n J_n(x)
  if (x < 0) return n % 2 === 0 ? besselJ(n, -x) : -besselJ(n, -x);

  // For large x, use asymptotic expansion
  if (x > 25 + (n * n) / 2) return besselJAsymptotic(n, x);

  // For small x relative to order, use power series
  if (x < 5 + n) return besselJSeries(n, x);

  // Intermediate: Miller's backward recurrence
  return besselJMiller(n, x);
}

/** Power series: J_n(x) = (x/2)^n Σ_{k=0}^∞ (-x²/4)^k / (k! (n+k)!) */
function besselJSeries(n: number, x: number): number {
  const halfX = x / 2;
  const negQuarter = -(x * x) / 4;
  let term = 1;
  // Compute 1/n! as initial denominator factor
  for (let i = 1; i <= n; i++) term /= i;

  let sum = term;
  for (let k = 1; k <= 60; k++) {
    term *= negQuarter / (k * (n + k));
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
  }
  return sum * Math.pow(halfX, n);
}

/** Hankel asymptotic expansion for large x.
 *  Computes the P and Q polynomials used by both J_n and Y_n asymptotics.
 *  P(n,x) = 1 - (μ-1)(μ-9)/(2!(8x)²) + ...
 *  Q(n,x) = (μ-1)/(1!(8x)) - (μ-1)(μ-9)(μ-25)/(3!(8x)³) + ...
 *  where μ = 4n²
 */
function hankelPQ(n: number, x: number): [number, number] {
  const mu = 4 * n * n;
  let P = 1;
  let Q = 0;

  // a_k = Π_{j=1}^{k} (μ - (2j-1)²)
  let ak = 1;
  const e8x = 8 * x;
  for (let k = 1; k <= 20; k++) {
    ak *= mu - (2 * k - 1) * (2 * k - 1);
    // Denominators: k! * (8x)^k
    const denom = factorial(k) * Math.pow(e8x, k);
    const contrib = ak / denom;
    if (k % 2 === 1) Q += (k % 4 === 1 ? 1 : -1) * contrib;
    else P += (k % 4 === 2 ? -1 : 1) * contrib;
    if (Math.abs(contrib) < 1e-15) break;
  }
  return [P, Q];
}

/** J_n(x) ~ sqrt(2/(πx)) [P cos(χ) - Q sin(χ)] where χ = x - nπ/2 - π/4 */
function besselJAsymptotic(n: number, x: number): number {
  const chi = x - (n / 2 + 0.25) * Math.PI;
  const [P, Q] = hankelPQ(n, x);
  return Math.sqrt(2 / (Math.PI * x)) * (P * Math.cos(chi) - Q * Math.sin(chi));
}

/** Miller's backward recurrence for J_n(x).
 *  Start from a large index M, recur downward using J_{k-1} = (2k/x)J_k - J_{k+1},
 *  then normalize using J_0 + 2J_2 + 2J_4 + ... = 1.
 */
function besselJMiller(n: number, x: number): number {
  const M = Math.max(n + 20, Math.ceil(x) + 30);
  let jp1 = 0; // J_{M+1}
  let jk = 1; // J_M (arbitrary nonzero start)
  const vals = new Array(M + 1);
  vals[M] = jk;

  for (let k = M; k >= 1; k--) {
    const jm1 = ((2 * k) / x) * jk - jp1;
    jp1 = jk;
    jk = jm1;
    vals[k - 1] = jk;
  }

  // Normalize: J_0 + 2(J_2 + J_4 + ...) = 1
  let norm = vals[0];
  for (let k = 2; k <= M; k += 2) norm += 2 * vals[k];
  const scale = 1 / norm;

  return vals[n] * scale;
}

/**
 * Bessel function of the second kind Y_n(x) for integer order n.
 *
 * Y_0 and Y_1 computed directly via series/integrals, higher orders via
 * forward recurrence: Y_{n+1}(x) = (2n/x)Y_n(x) - Y_{n-1}(x).
 *
 * Reference: NIST DLMF 10.8, 10.17
 */
export function besselY(n: number, x: number): number {
  if (!isFinite(x) || !Number.isInteger(n)) return NaN;
  if (x <= 0) return NaN; // Y_n is undefined for x <= 0 (real-valued)

  // Y_{-n}(x) = (-1)^n Y_n(x) for integer n
  if (n < 0) {
    n = -n;
    return n % 2 === 0 ? besselY(n, x) : -besselY(n, x);
  }

  // For large x, use asymptotic expansion.
  // The series for Y_n suffers from catastrophic cancellation at large x,
  // so we switch to asymptotic earlier than for J_n.
  if (x > 12 + (n * n) / 4) return besselYAsymptotic(n, x);

  // Compute Y_0 and Y_1 via series, then recur forward
  const y0 = besselY0(x);
  if (n === 0) return y0;
  const y1 = besselY1(x);
  if (n === 1) return y1;

  let ym1 = y0;
  let yk = y1;
  for (let k = 1; k < n; k++) {
    const yp1 = ((2 * k) / x) * yk - ym1;
    ym1 = yk;
    yk = yp1;
  }
  return yk;
}

/** Y_0(x) via Neumann series:
 *  Y_0(x) = (2/π)[J_0(x)(ln(x/2)+γ) + Σ_{k=1}^∞ (-1)^{k+1} H_k (x/2)^{2k} / (k!)²]
 *  where H_k = 1 + 1/2 + ... + 1/k
 */
function besselY0(x: number): number {
  const halfX = x / 2;
  const x2over4 = halfX * halfX;
  const j0 = besselJ(0, x);
  let sum = 0;
  let term = 1;
  let Hk = 0;
  for (let k = 1; k <= 60; k++) {
    Hk += 1 / k;
    term *= -x2over4 / (k * k);
    sum -= term * Hk; // (-1)^{k+1} = -(-1)^k
    if (Math.abs(term * Hk) < Math.abs(sum) * 1e-16) break;
  }
  return (2 / Math.PI) * (j0 * (Math.log(halfX) + EULER_MASCHERONI) + sum);
}

/** Y_1(x) via DLMF 10.8.3 for n=1:
 *  Y_1(x) = -2/(πx) + (2/π) ln(x/2) J_1(x)
 *           - (x/2)/π Σ_{k=0}^∞ (-1)^k [ψ(k+1)+ψ(k+2)] (x²/4)^k / (k!(k+1)!)
 *  where ψ(n) = -γ + H_{n-1}
 */
function besselY1(x: number): number {
  const halfX = x / 2;
  const x2over4 = halfX * halfX;
  const j1 = besselJ(1, x);

  let sum = 0;
  let x2k = 1; // (x²/4)^k
  let factK = 1; // k!
  for (let k = 0; k <= 60; k++) {
    if (k > 0) {
      factK *= k;
      x2k *= x2over4;
    }
    const factKp1 = factK * (k + 1);
    // ψ(k+1) = -γ + H_k, ψ(k+2) = -γ + H_{k+1}
    let Hk = 0;
    for (let j = 1; j <= k; j++) Hk += 1 / j;
    const Hkp1 = Hk + 1 / (k + 1);
    const psiKp1 = -EULER_MASCHERONI + Hk;
    const psiKp2 = -EULER_MASCHERONI + Hkp1;
    const sign = k % 2 === 0 ? 1 : -1;
    const termVal = (sign * (psiKp1 + psiKp2) * x2k) / (factK * factKp1);
    sum += termVal;
    if (k > 3 && Math.abs(termVal) < 1e-16 * Math.abs(sum)) break;
  }

  return (
    -2 / (Math.PI * x) +
    (2 / Math.PI) * Math.log(halfX) * j1 -
    (halfX / Math.PI) * sum
  );
}

/** Y_n(x) ~ sqrt(2/(πx)) [P sin(χ) + Q cos(χ)] where χ = x - nπ/2 - π/4 */
function besselYAsymptotic(n: number, x: number): number {
  const chi = x - (n / 2 + 0.25) * Math.PI;
  const [P, Q] = hankelPQ(n, x);
  return Math.sqrt(2 / (Math.PI * x)) * (P * Math.sin(chi) + Q * Math.cos(chi));
}

/**
 * Modified Bessel function of the first kind I_n(x) for integer order n.
 *
 * I_n(x) = i^{-n} J_n(ix) — uses power series for small |x|,
 * scaled Miller's recurrence for intermediate, asymptotic for large |x|.
 *
 * Reference: NIST DLMF 10.25, 10.40
 */
export function besselI(n: number, x: number): number {
  if (!isFinite(x) || !Number.isInteger(n)) return NaN;
  if (x === 0) return n === 0 ? 1 : 0;

  // I_{-n}(x) = I_n(x) for integer n
  if (n < 0) n = -n;

  // I_n(-x) = (-1)^n I_n(x)
  if (x < 0) return n % 2 === 0 ? besselI(n, -x) : -besselI(n, -x);

  // For large x (and order small enough that the expansion's early terms
  // aₖ(ν)/x^k decrease), use the asymptotic — its optimal-truncation error
  // ~e^{−2x} ≤ e^{−40} is far below double ε for x > 20. Otherwise the
  // all-positive power series is exact (no cancellation), just slower (its
  // term recurrence accumulates ~½ ulp per term, so shorter is better).
  if (x > 20 && x >= n * n) return besselIAsymptotic(n, x);

  // Power series: I_n(x) = (x/2)^n Σ_{k=0}^∞ (x²/4)^k / (k! (n+k)!)
  return besselISeries(n, x);
}

/** Power series (DLMF 10.25.2): I_n(x) = (x/2)^n Σ (x²/4)^k / (k!(n+k)!).
 *  All terms are positive — no cancellation at any x. Kahan-compensated:
 *  near x = 30 the ~60 accumulations otherwise cost ~5 ulp. */
function besselISeries(n: number, x: number): number {
  const halfX = x / 2;
  const quarter = (x * x) / 4;
  let term = 1;
  for (let i = 1; i <= n; i++) term /= i;

  let sum = term;
  let comp = 0; // Kahan compensation
  for (let k = 1; k <= 500; k++) {
    term *= quarter / (k * (n + k));
    const y = term - comp;
    const u = sum + y;
    comp = u - sum - y;
    sum = u;
    if (Math.abs(term) < Math.abs(sum) * 1e-17) break;
  }
  return sum * Math.pow(halfX, n);
}

/** Asymptotic expansion for large argument (DLMF 10.40.1):
 *    I_ν(z) ~ e^z/√(2πz) · Σ_{k≥0} (−1)^k aₖ(ν)/z^k,
 *    aₖ(ν) = (4ν²−1²)(4ν²−3²)⋯(4ν²−(2k−1)²)/(k!·8^k)
 *  Note the (−1)^k: the aₖ are the same as for K_ν (DLMF 10.40.2) but the
 *  I series alternates them. (A previous version reused the K signs — every
 *  odd term flipped, ~1/(4z) relative error.) The expansion is divergent:
 *  truncate at the smallest term (~e^{−2z} relative, ≪ ε for z > 20). */
function besselIAsymptotic(n: number, x: number): number {
  const mu = 4 * n * n;
  let term = 1;
  let sum = 1;
  let prevAbs = Infinity;
  for (let k = 1; k <= 40; k++) {
    const f = mu - (2 * k - 1) * (2 * k - 1);
    term *= -f / (k * 8 * x); // (−1)^k aₖ(ν)/z^k
    if (Math.abs(term) >= prevAbs) break; // divergent tail: stop at min term
    sum += term;
    prevAbs = Math.abs(term);
    if (Math.abs(term) < 1e-17 * Math.abs(sum)) break;
  }
  return (Math.exp(x) / Math.sqrt(2 * Math.PI * x)) * sum;
}

/**
 * Modified Bessel function of the second kind K_n(x) for integer order n.
 *
 * K_0 and K_1 computed via series, higher orders via forward recurrence:
 * K_{n+1}(x) = (2n/x)K_n(x) + K_{n-1}(x).
 *
 * Reference: NIST DLMF 10.31, 10.40
 */
export function besselK(n: number, x: number): number {
  if (!isFinite(x) || !Number.isInteger(n)) return NaN;
  if (x <= 0) return NaN; // K_n only defined for x > 0

  // K_{-n}(x) = K_n(x) for integer n
  if (n < 0) n = -n;

  // Compute K_0 and K_1, then recur upward (stable: K_n grows with n).
  // Three regimes for K_0/K_1:
  // - x < 1.5: ascending series (DLMF 10.31.2); its e^{2x}-scale cancellation
  //   is still benign here (< ~1 digit lost).
  // - 1.5 ≤ x < 20: Steed's continued fraction CF2 (relative accuracy ~ε; the
  //   series would lose ~0.87·x digits to cancellation in this range, and
  //   CF2 stops converging below x ≈ 1.2).
  // - x ≥ 20: asymptotic expansion (DLMF 10.40.2), optimal-truncation error
  //   ~e^{−2x} ≤ e^{−40}, far below double ε.
  let k0: number;
  let k1: number;
  if (x >= 20) {
    k0 = besselKAsymptotic(0, x);
    if (n === 0) return k0;
    k1 = besselKAsymptotic(1, x);
  } else if (x >= 1.5) {
    [k0, k1] = besselK01CF2(x);
    if (n === 0) return k0;
  } else {
    k0 = besselK0(x);
    if (n === 0) return k0;
    k1 = besselK1(x);
  }
  if (n === 1) return k1;

  // Forward recurrence (DLMF 10.29.1): K_{n+1} = (2n/x) K_n + K_{n-1}
  let km1 = k0;
  let kk = k1;
  for (let k = 1; k < n; k++) {
    const kp1 = ((2 * k) / x) * kk + km1;
    km1 = kk;
    kk = kp1;
  }
  return kk;
}

/**
 * K_0(x) and K_1(x) for x ≥ 1.5 via Steed's continued fraction CF2, evaluated
 * with the Thompson–Barnett recurrences (I.J. Thompson & A.R. Barnett,
 * J. Comput. Phys. 64 (1986) 490; this is the `bessik` algorithm of
 * Numerical Recipes §6.7, specialized to order μ = 0):
 *    K_μ(x) = √(π/(2x))·e^{−x} / S,     K_{μ+1}(x) = K_μ(x)·(μ + x + ½ − h)/x
 * where S and h are the CF2 sums, both accumulated with Kahan compensation
 * (near x = 2 the ~100 iterations otherwise accumulate ~5–7 ulp of rounding).
 * Converges for x ≳ 1.2 (~ε relative accuracy, no cancellation — unlike the
 * ascending series); the iteration count grows as x decreases.
 */
function besselK01CF2(x: number): [number, number] {
  const a1 = 0.25; // ¼ − μ² with μ = 0
  let b = 2 * (1 + x);
  let d = 1 / b;
  let h = d;
  let delh = d;
  let q1 = 0;
  let q2 = 1;
  let a = -a1;
  let c = a1;
  let q = a1;
  let s = 1 + q * delh;
  let compS = 0; // Kahan compensation for s
  let compH = 0; // Kahan compensation for h
  for (let i = 2; i <= 10000; i++) {
    a -= 2 * (i - 1);
    c = (-a * c) / i;
    const qnew = (q1 - b * q2) / a;
    q1 = q2;
    q2 = qnew;
    q += c * qnew;
    b += 2;
    d = 1 / (b + a * d);
    delh = (b * d - 1) * delh;
    let y = delh - compH;
    let u = h + y;
    compH = u - h - y;
    h = u;
    const dels = q * delh;
    y = dels - compS;
    u = s + y;
    compS = u - s - y;
    s = u;
    if (Math.abs(dels) < 1e-18 * Math.abs(s)) break;
  }
  h = a1 * h;
  const k0 = (Math.sqrt(Math.PI / (2 * x)) * Math.exp(-x)) / s;
  const k1 = (k0 * (x + 0.5 - h)) / x; // μ = 0
  return [k0, k1];
}

/** K_0(x) = -(ln(x/2) + γ) I_0(x) + Σ_{k=1}^∞ H_k (x/2)^{2k} / (k!)² */
function besselK0(x: number): number {
  const halfX = x / 2;
  const x2over4 = halfX * halfX;
  const i0 = besselI(0, x);
  let sum = 0;
  let term = 1;
  let Hk = 0;
  for (let k = 1; k <= 60; k++) {
    Hk += 1 / k;
    term *= x2over4 / (k * k);
    sum += term * Hk;
    if (Math.abs(term * Hk) < Math.abs(sum) * 1e-16 && k > 3) break;
  }
  return -(Math.log(halfX) + EULER_MASCHERONI) * i0 + sum;
}

/** K_1(x) via DLMF 10.31.2 for n=1:
 *  K_1(x) = 1/x + (ln(x/2)+γ) I_1(x) [with sign correction]
 *           + (x/2) Σ_{k=0}^∞ [ψ(k+1)+ψ(k+2)] (x²/4)^k / (2 k!(k+1)!)
 *  We use the Wronskian: I_0(x)K_1(x) + I_1(x)K_0(x) = 1/x
 *  => K_1(x) = (1/x - I_1(x)K_0(x)) / I_0(x)
 */
function besselK1(x: number): number {
  const i0 = besselI(0, x);
  const i1 = besselI(1, x);
  const k0 = besselK0(x);
  return (1 / x - i1 * k0) / i0;
}

/** Asymptotic expansion for large argument (DLMF 10.40.2):
 *    K_ν(z) ~ √(π/(2z))·e^{−z} · Σ_{k≥0} aₖ(ν)/z^k,
 *    aₖ(ν) = (4ν²−1²)(4ν²−3²)⋯(4ν²−(2k−1)²)/(k!·8^k)
 *  The expansion is divergent: truncate at the smallest term (~e^{−2z}
 *  relative, below double ε for z ≥ 20). */
function besselKAsymptotic(n: number, x: number): number {
  const mu = 4 * n * n;
  let term = 1;
  let sum = 1;
  let prevAbs = Infinity;
  for (let k = 1; k <= 40; k++) {
    const f = mu - (2 * k - 1) * (2 * k - 1);
    term *= f / (k * 8 * x);
    if (Math.abs(term) >= prevAbs) break; // divergent tail: stop at min term
    sum += term;
    prevAbs = Math.abs(term);
    if (Math.abs(term) < 1e-17 * Math.abs(sum)) break;
  }
  return Math.sqrt(Math.PI / (2 * x)) * Math.exp(-x) * sum;
}

// ────────────────────────────────────────────────────────────────
// Double-double helpers (compensated arithmetic)
//
// Error-free transformations after T.J. Dekker, Numer. Math. 18 (1971)
// 224–242, and J.R. Shewchuk, Discrete Comput. Geom. 18 (1997) 305–363.
// A value is an unevaluated sum hi + lo with |lo| ≤ ½ ulp(hi), carrying
// ~32 significant digits. Used below where a defining series suffers
// catastrophic cancellation (the Airy Maclaurin series) or where an
// exponent/phase needs absolute accuracy beyond one ulp (Airy asymptotics).
// ────────────────────────────────────────────────────────────────

type DD = [hi: number, lo: number];

const DD_SPLITTER = 134217729; // 2^27 + 1 (Dekker splitting constant)

/** Exact: a + b = s + e with s = fl(a+b) (Knuth two-sum) */
function twoSum(a: number, b: number): DD {
  const s = a + b;
  const bb = s - a;
  return [s, a - (s - bb) + (b - bb)];
}

/** Exact: a + b = s + e, assuming |a| ≥ |b| (fast two-sum) */
function quickTwoSum(a: number, b: number): DD {
  const s = a + b;
  return [s, b - (s - a)];
}

/** Exact: a·b = p + e (Dekker two-product) */
function twoProd(a: number, b: number): DD {
  const p = a * b;
  const ca = DD_SPLITTER * a;
  const ahi = ca - (ca - a);
  const alo = a - ahi;
  const cb = DD_SPLITTER * b;
  const bhi = cb - (cb - b);
  const blo = b - bhi;
  return [p, ahi * bhi - p + ahi * blo + alo * bhi + alo * blo];
}

function ddAdd(a: DD, b: DD): DD {
  const [s1, s2] = twoSum(a[0], b[0]);
  const [t1, t2] = twoSum(a[1], b[1]);
  const [hi, lo] = quickTwoSum(s1, s2 + t1);
  return quickTwoSum(hi, lo + t2);
}

function ddNeg(a: DD): DD {
  return [-a[0], -a[1]];
}

function ddMul(a: DD, b: DD): DD {
  const [p, e] = twoProd(a[0], b[0]);
  return quickTwoSum(p, e + a[0] * b[1] + a[1] * b[0]);
}

function ddMulD(a: DD, b: number): DD {
  const [p, e] = twoProd(a[0], b);
  return quickTwoSum(p, e + a[1] * b);
}

function ddDivD(a: DD, b: number): DD {
  const q1 = a[0] / b;
  const [p, e] = twoProd(q1, b);
  const r = ddAdd(a, [-p, -e]);
  return quickTwoSum(q1, (r[0] + r[1]) / b);
}

/** √x as a double-double: one Newton correction of Math.sqrt,
 *  √x ≈ s + (x − s²)/(2s) with x − s² computed exactly. */
function ddSqrtD(x: number): DD {
  const s = Math.sqrt(x);
  const [p, e] = twoProd(s, s);
  return quickTwoSum(s, (x - p - e) / (2 * s));
}

// ────────────────────────────────────────────────────────────────
// Airy functions
// ────────────────────────────────────────────────────────────────

// Ai(0) = 3^{−2/3}/Γ(2/3) and −Ai′(0) = 3^{−1/3}/Γ(1/3) (DLMF 9.2.3–9.2.6),
// √3 and π/4, all correctly rounded to double-double (via mpmath @ 60 digits)
const AIRY_C1: DD = [0.3550280538878172, 2.05233632436212e-17];
const AIRY_C2: DD = [0.2588194037928068, -2.522243111610832e-17];
const SQRT3_DD: DD = [1.7320508075688772, 1.0035084221806903e-16];
const PI_OVER_4_DD: DD = [0.7853981633974483, 3.061616997868383e-17];

/**
 * Maclaurin series for the Airy functions (DLMF 9.4.1/9.4.3):
 *   Ai(x) = c₁·f(x) − c₂·g(x),   Bi(x) = √3·(c₁·f(x) + c₂·g(x))
 * with termF_k = termF_{k−1}·x³/((3k−1)·3k) (f₀ = 1) and
 * termG_k = termG_{k−1}·x³/(3k·(3k+1)) (g₀ = x).
 *
 * Everything is accumulated in double-double: the combinations cancel
 * catastrophically — for x < 0 the partial sums reach ~e^{0.83ξ}·|result|
 * and for Ai(x > 0) ~e^{2ξ}·|result| (ξ = ⅔|x|^{3/2}), which at |x| = 9
 * (ξ = 18) costs up to ~16 of the 32 double-double digits, still leaving a
 * full double. (In plain doubles, Ai(−10) had only 1.6 correct digits and
 * Ai(5) only 8.9.)
 */
function airySeriesFG(x: number): [f: DD, g: DD] {
  // x³ in double-double (exact products of the input double)
  const x3 = ddMulD(twoProd(x, x), x);
  let f: DD = [1, 0];
  let g: DD = [x, 0];
  let termF: DD = [1, 0];
  let termG: DD = [x, 0];
  for (let k = 1; k <= 200; k++) {
    const k3 = 3 * k;
    termF = ddDivD(ddMul(termF, x3), (k3 - 1) * k3);
    termG = ddDivD(ddMul(termG, x3), k3 * (k3 + 1));
    f = ddAdd(f, termF);
    g = ddAdd(g, termG);
    if (
      Math.abs(termF[0]) + Math.abs(termG[0]) <
      1e-34 * (Math.abs(f[0]) + Math.abs(g[0]))
    )
      break;
  }
  return [f, g];
}

/** ξ = ⅔·x^{3/2} in double-double. The exponent/phase must carry an
 *  ABSOLUTE error ≲1e−17: a one-ulp relative error in ξ alone shifts
 *  e^{∓ξ} — and the oscillatory phase — by ~ξ·2⁻⁵³, i.e. ~20 ulp of the
 *  result at |x| = 10. */
function airyXi(x: number): DD {
  const x32 = ddMulD(ddSqrtD(x), x); // x^{3/2} = √x·x
  return ddDivD(ddMulD(x32, 2), 3);
}

/** One factor of the u_k recurrence (DLMF 9.7.2):
 *  u₀ = 1, u_k = u_{k−1}·(6k−5)(6k−3)(6k−1)/(216·k·(2k−1)) — so
 *  u_k/ξ^k = (u_{k−1}/ξ^{k−1})·uRatio(k)/ξ. */
function airyURatio(k: number): number {
  return ((6 * k - 5) * (6 * k - 3) * (6 * k - 1)) / (216 * k * (2 * k - 1));
}

/** P/Q phase sums shared by Ai(−x) and Bi(−x), x > 9 (DLMF 9.7.9/9.7.11):
 *    Ai(−x) = [cos(ξ−π/4)·P(ξ) + sin(ξ−π/4)·Q(ξ)] / (√π·x^{1/4})
 *    Bi(−x) = [−sin(ξ−π/4)·P(ξ) + cos(ξ−π/4)·Q(ξ)] / (√π·x^{1/4})
 *    P(ξ) = Σ (−1)^k u_{2k}/ξ^{2k},   Q(ξ) = Σ (−1)^k u_{2k+1}/ξ^{2k+1}
 *  The u_j/ξ^j sequence is truncated at its smallest term (the expansions
 *  are divergent; optimal truncation error ~e^{−2ξ} of the modulus, below
 *  double ε for ξ ≥ 18, i.e. x ≥ 9). The phase ξ−π/4 is computed in
 *  double-double, and cos/sin are corrected to first order in its low part.
 */
function airyNegParts(
  x: number
): [P: number, Q: number, cosA: number, sinA: number, pref: number] {
  const xi = airyXi(x);
  const xiHi = xi[0];
  const A = ddAdd(xi, ddNeg(PI_OVER_4_DD)); // ξ − π/4
  const c0 = Math.cos(A[0]);
  const s0 = Math.sin(A[0]);
  const cosA = c0 - s0 * A[1];
  const sinA = s0 + c0 * A[1];
  let P = 1; // j = 0 term
  let Q = 0;
  let t = 1; // u_j/ξ^j
  let prevAbs = Infinity;
  for (let j = 1; j <= 60; j++) {
    t *= airyURatio(j) / xiHi;
    const at = Math.abs(t);
    if (at >= prevAbs) break; // divergent tail: stop at smallest term
    prevAbs = at;
    // sign (−1)^k for u_{2k} in P and u_{2k+1} in Q → +,+,−,− over j mod 4
    const st = j % 4 === 0 || j % 4 === 1 ? t : -t;
    if (j % 2 === 0) P += st;
    else Q += st;
    if (at < 1e-18) break;
  }
  const pref = 1 / (Math.sqrt(Math.PI) * Math.pow(x, 0.25));
  return [P, Q, cosA, sinA, pref];
}

/**
 * Airy function of the first kind Ai(x).
 *
 * - x > 9: asymptotic expansion (DLMF 9.7.5)
 * - x < −9: oscillatory asymptotic P/Q form (DLMF 9.7.9)
 * - |x| ≤ 9: Maclaurin series in double-double (DLMF 9.4.1)
 *
 * Reference: NIST DLMF 9.2, 9.4, 9.7
 */
export function airyAi(x: number): number {
  if (!isFinite(x)) return NaN;

  if (x > 9) {
    // Ai(x) ~ e^{−ξ}/(2√π·x^{1/4}) Σ (−1)^k u_k/ξ^k  (DLMF 9.7.5)
    const xi = airyXi(x);
    const xiHi = xi[0];
    if (!Number.isFinite(xiHi)) return 0; // e^{−ξ} underflows long before
    let sum = 1;
    let t = 1;
    let prevAbs = Infinity;
    for (let k = 1; k <= 60; k++) {
      t *= airyURatio(k) / xiHi;
      if (t >= prevAbs) break; // divergent tail: stop at smallest term
      sum += k % 2 === 0 ? t : -t;
      prevAbs = t;
      if (t < 1e-18 * sum) break;
    }
    // e^{−ξ} = e^{−hi}·e^{−lo} ≈ e^{−hi}·(1 − lo)
    const expNegXi = Math.exp(-xiHi) * (1 - xi[1]);
    return (expNegXi / (2 * Math.sqrt(Math.PI) * Math.pow(x, 0.25))) * sum;
  }

  if (x < -9) {
    const [P, Q, cosA, sinA, pref] = airyNegParts(-x);
    return pref * (cosA * P + sinA * Q); // DLMF 9.7.9
  }

  const [f, g] = airySeriesFG(x);
  return ddAdd(ddMul(AIRY_C1, f), ddNeg(ddMul(AIRY_C2, g)))[0];
}

/**
 * Airy function of the second kind Bi(x).
 *
 * - x > 9: asymptotic expansion (DLMF 9.7.7)
 * - x < −9: oscillatory asymptotic P/Q form (DLMF 9.7.11)
 * - |x| ≤ 9: Maclaurin series in double-double (DLMF 9.4.3)
 *
 * Reference: NIST DLMF 9.2, 9.4, 9.7
 */
export function airyBi(x: number): number {
  if (!isFinite(x)) return NaN;

  if (x > 9) {
    // Bi(x) ~ e^{ξ}/(√π·x^{1/4}) Σ u_k/ξ^k  (DLMF 9.7.7; all terms positive)
    const xi = airyXi(x);
    const xiHi = xi[0];
    if (!Number.isFinite(xiHi)) return Infinity; // e^{ξ} overflows first
    let sum = 1;
    let t = 1;
    let prevAbs = Infinity;
    for (let k = 1; k <= 60; k++) {
      t *= airyURatio(k) / xiHi;
      if (t >= prevAbs) break; // divergent tail: stop at smallest term
      sum += t;
      prevAbs = t;
      if (t < 1e-18 * sum) break;
    }
    // e^{ξ} = e^{hi}·e^{lo} ≈ e^{hi}·(1 + lo)
    const expXi = Math.exp(xiHi) * (1 + xi[1]);
    return (expXi / (Math.sqrt(Math.PI) * Math.pow(x, 0.25))) * sum;
  }

  if (x < -9) {
    const [P, Q, cosA, sinA, pref] = airyNegParts(-x);
    return pref * (-sinA * P + cosA * Q); // DLMF 9.7.11
  }

  const [f, g] = airySeriesFG(x);
  return ddMul(SQRT3_DD, ddAdd(ddMul(AIRY_C1, f), ddMul(AIRY_C2, g)))[0];
}

/**
 * Termwise derivatives of the DLMF 9.4.1 series (companion to
 * `airySeriesFG`): returns f′(x) and g′(x), where
 *   f(x) = Σ_{k≥0} a_k x^{3k},  a_0 = 1, a_k = a_{k−1}/((3k−1)·3k)
 *   g(x) = Σ_{k≥0} b_k x^{3k+1}, b_0 = 1, b_k = b_{k−1}/(3k·(3k+1))
 * so, differentiating each monomial,
 *   f′(x) = Σ_{k≥1} 3k·a_k x^{3k−1}   (first term = x²/2)
 *   g′(x) = Σ_{k≥0} (3k+1)·b_k x^{3k} (constant term = 1)
 * The term ratios collapse to
 *   dtermF_{k+1}/dtermF_k = x³/(3k·(3k+2)),
 *   dtermG_k/dtermG_{k−1} = x³/((3k−2)·3k),
 * accumulated in double-double with the same convergence idiom.
 */
function airySeriesFGPrime(x: number): [fp: DD, gp: DD] {
  const x2 = twoProd(x, x); // x²
  const x3 = ddMulD(x2, x); // x³
  let dtermF: DD = ddDivD(x2, 2); // f′ term at k = 1: 3·a_1·x² = x²/2
  let dtermG: DD = [1, 0]; // g′ term at k = 0: (3·0+1)·b_0 = 1
  let fp: DD = dtermF;
  let gp: DD = dtermG;
  for (let k = 1; k <= 200; k++) {
    const k3 = 3 * k;
    // advance f′ term from index k to k+1, g′ term from index k−1 to k
    dtermF = ddDivD(ddMul(dtermF, x3), k3 * (k3 + 2));
    dtermG = ddDivD(ddMul(dtermG, x3), (k3 - 2) * k3);
    fp = ddAdd(fp, dtermF);
    gp = ddAdd(gp, dtermG);
    if (
      Math.abs(dtermF[0]) + Math.abs(dtermG[0]) <
      1e-34 * (Math.abs(fp[0]) + Math.abs(gp[0]))
    )
      break;
  }
  return [fp, gp];
}

/** P/Q phase sums for Ai′(−x) and Bi′(−x), x > 9 (DLMF 9.7.10/9.7.12),
 *  built from the v-coefficients v_k = u_k·(6k+1)/(1−6k):
 *    Ai′(−x) = (x^{1/4}/√π)·[ sin(ξ−π/4)·P(ξ) − cos(ξ−π/4)·Q(ξ)]
 *    Bi′(−x) = (x^{1/4}/√π)·[ cos(ξ−π/4)·P(ξ) + sin(ξ−π/4)·Q(ξ)]
 *    P(ξ) = Σ (−1)^k v_{2k}/ξ^{2k},   Q(ξ) = Σ (−1)^k v_{2k+1}/ξ^{2k+1}
 *  Same optimal-truncation and phase machinery as `airyNegParts`; the u_j/ξ^j
 *  running term is converted to v_j/ξ^j by the (6j+1)/(1−6j) factor. */
function airyNegPartsPrime(
  x: number
): [P: number, Q: number, cosA: number, sinA: number, pref: number] {
  const xi = airyXi(x);
  const xiHi = xi[0];
  const A = ddAdd(xi, ddNeg(PI_OVER_4_DD)); // ξ − π/4
  const c0 = Math.cos(A[0]);
  const s0 = Math.sin(A[0]);
  const cosA = c0 - s0 * A[1];
  const sinA = s0 + c0 * A[1];
  let P = 1; // j = 0 term: v_0 = 1
  let Q = 0;
  let t = 1; // u_j/ξ^j
  let prevAbs = Infinity;
  for (let j = 1; j <= 60; j++) {
    t *= airyURatio(j) / xiHi;
    const v = (t * (6 * j + 1)) / (1 - 6 * j); // v_j/ξ^j
    const av = Math.abs(v);
    if (av >= prevAbs) break; // divergent tail: stop at smallest term
    prevAbs = av;
    // sign (−1)^k for v_{2k} in P and v_{2k+1} in Q → +,+,−,− over j mod 4
    const sv = j % 4 === 0 || j % 4 === 1 ? v : -v;
    if (j % 2 === 0) P += sv;
    else Q += sv;
    if (av < 1e-18) break;
  }
  const pref = Math.pow(x, 0.25) / Math.sqrt(Math.PI);
  return [P, Q, cosA, sinA, pref];
}

/**
 * Derivative of the Airy function of the first kind, Ai′(x).
 *
 * - x > 9: asymptotic expansion (DLMF 9.7.6)
 * - x < −9: oscillatory asymptotic P/Q form (DLMF 9.7.10)
 * - |x| ≤ 9: termwise-differentiated Maclaurin series (DLMF 9.4.2)
 *
 * Reference: NIST DLMF 9.2, 9.4, 9.7
 */
export function airyAiPrime(x: number): number {
  if (!isFinite(x)) return NaN;

  if (x > 9) {
    // Ai′(x) ~ −x^{1/4} e^{−ξ}/(2√π) Σ (−1)^k v_k/ξ^k  (DLMF 9.7.6)
    const xi = airyXi(x);
    const xiHi = xi[0];
    if (!Number.isFinite(xiHi)) return 0; // e^{−ξ} underflows long before
    let sum = 1;
    let t = 1; // u_k/ξ^k
    let prevAbs = Infinity;
    for (let k = 1; k <= 60; k++) {
      t *= airyURatio(k) / xiHi;
      const v = (t * (6 * k + 1)) / (1 - 6 * k); // v_k/ξ^k
      const av = Math.abs(v);
      if (av >= prevAbs) break; // divergent tail: stop at smallest term
      sum += k % 2 === 0 ? v : -v;
      prevAbs = av;
      if (av < 1e-18 * Math.abs(sum)) break;
    }
    // e^{−ξ} = e^{−hi}·e^{−lo} ≈ e^{−hi}·(1 − lo)
    const expNegXi = Math.exp(-xiHi) * (1 - xi[1]);
    return (-(expNegXi * Math.pow(x, 0.25)) / (2 * Math.sqrt(Math.PI))) * sum;
  }

  if (x < -9) {
    const [P, Q, cosA, sinA, pref] = airyNegPartsPrime(-x);
    return pref * (sinA * P - cosA * Q); // DLMF 9.7.10
  }

  const [fp, gp] = airySeriesFGPrime(x);
  return ddAdd(ddMul(AIRY_C1, fp), ddNeg(ddMul(AIRY_C2, gp)))[0];
}

/**
 * Derivative of the Airy function of the second kind, Bi′(x).
 *
 * - x > 9: asymptotic expansion (DLMF 9.7.8)
 * - x < −9: oscillatory asymptotic P/Q form (DLMF 9.7.12)
 * - |x| ≤ 9: termwise-differentiated Maclaurin series (DLMF 9.4.4)
 *
 * Reference: NIST DLMF 9.2, 9.4, 9.7
 */
export function airyBiPrime(x: number): number {
  if (!isFinite(x)) return NaN;

  if (x > 9) {
    // Bi′(x) ~ x^{1/4} e^{ξ}/√π Σ v_k/ξ^k  (DLMF 9.7.8)
    const xi = airyXi(x);
    const xiHi = xi[0];
    if (!Number.isFinite(xiHi)) return Infinity; // e^{ξ} overflows first
    let sum = 1;
    let t = 1; // u_k/ξ^k
    let prevAbs = Infinity;
    for (let k = 1; k <= 60; k++) {
      t *= airyURatio(k) / xiHi;
      const v = (t * (6 * k + 1)) / (1 - 6 * k); // v_k/ξ^k
      const av = Math.abs(v);
      if (av >= prevAbs) break; // divergent tail: stop at smallest term
      sum += v;
      prevAbs = av;
      if (av < 1e-18 * Math.abs(sum)) break;
    }
    // e^{ξ} = e^{hi}·e^{lo} ≈ e^{hi}·(1 + lo)
    const expXi = Math.exp(xiHi) * (1 + xi[1]);
    return ((expXi * Math.pow(x, 0.25)) / Math.sqrt(Math.PI)) * sum;
  }

  if (x < -9) {
    const [P, Q, cosA, sinA, pref] = airyNegPartsPrime(-x);
    return pref * (cosA * P + sinA * Q); // DLMF 9.7.12
  }

  const [fp, gp] = airySeriesFGPrime(x);
  return ddMul(SQRT3_DD, ddAdd(ddMul(AIRY_C1, fp), ddMul(AIRY_C2, gp)))[0];
}

// ──────────────────────────────────────────────────────────────────
// Fresnel integrals
//
// S(x) = ∫₀ˣ sin(π t²/2) dt
// C(x) = ∫₀ˣ cos(π t²/2) dt
//
// Rational Chebyshev approximation from Cephes / scipy.
// Three regions: |x|<1.6, 1.6≤|x|<36, |x|≥36.
// ──────────────────────────────────────────────────────────────────

// Region 1 (|x| < 1.6): S(x) = x³ P(x⁴)/Q(x⁴)
// Coefficients from Cephes (π/2 factor is baked into the coefficients)
const SN = [
  -2.99181919401019853726e3, 7.08840045257738576863e5,
  -6.29741486205862506537e7, 2.54890880573376359104e9,
  -4.42979518059697779103e10, 3.18016297876567817986e11,
];
const SD = [
  1.0, 2.81376268889994315696e2, 4.55847810806532581675e4,
  5.1734388877009640073e6, 4.19320245898111231129e8, 2.2441179564534092094e10,
  6.07366389490084914091e11,
];

// Region 1 (|x| < 1.6): C(x) = x P(x⁴)/Q(x⁴)
const CN = [
  -4.98843114573573548651e-8, 9.50428062829859605134e-6,
  -6.45191435683965050962e-4, 1.88843319396703850064e-2,
  -2.05525900955013891793e-1, 9.99999999999999998822e-1,
];
const CD = [
  3.99982968972495980367e-12, 9.15439215774657478799e-10,
  1.25001862479598821474e-7, 1.22262789024179030997e-5,
  8.68029542941784300606e-4, 4.12142090722199792936e-2, 1.00000000000000000118,
];

// Region 2 (1.6 ≤ |x| < 36): auxiliary f(x), g(x) as rational approx of u=1/(π²x⁴)
const FN = [
  4.21543555043677546506e-1, 1.43407919780758885261e-1,
  1.15220955073585758835e-2, 3.450179397825740279e-4, 4.63613749287867322088e-6,
  3.05568983790257605827e-8, 1.02304514164907233465e-10,
  1.72010743268161828879e-13, 1.34283276233062758925e-16,
  3.76329711269987889006e-20,
];
const FD = [
  1.0, 7.51586398353378947175e-1, 1.16888925859191382142e-1,
  6.44051526508858611005e-3, 1.55934409164153020873e-4,
  1.8462756734893054587e-6, 1.12699224763999035261e-8,
  3.60140029589371370404e-11, 5.8875453362157841001e-14,
  4.52001434074129701496e-17, 1.25443237090011264384e-20,
];

// Region 2: auxiliary g(x)
const GN = [
  5.04442073643383265887e-1, 1.97102833525523411709e-1,
  1.87648584092575249293e-2, 6.84079380915393090172e-4,
  1.15138826111884280931e-5, 9.82852443688422223854e-8,
  4.45344415861750144738e-10, 1.08268041139020870318e-12,
  1.37555460633261799868e-15, 8.36354435630677421531e-19,
  1.86958710162783235106e-22,
];
const GD = [
  1.0, 1.47495759925128324529, 3.37748989120019970451e-1,
  2.53603741420338795122e-2, 8.14679107184306179049e-4,
  1.27545075667729118702e-5, 1.04314589657571990585e-7,
  4.60680728515232032307e-10, 1.10273215066240270757e-12,
  1.38796531259578871258e-15, 8.39158816283118707363e-19,
  1.86958710162783236342e-22,
];

/** Horner form polynomial evaluation (highest degree coefficient first) */
function polevl(x: number, coef: number[]): number {
  let ans = coef[0];
  for (let i = 1; i < coef.length; i++) ans = ans * x + coef[i];
  return ans;
}

// Asymptotic cutoff for the Fresnel integrals: beyond this the oscillating
// correction |f·cos + g·sin|/(πx) ≤ 1/(πx) < 5.3e-17 is below half an ulp of
// 0.5, so S, C round to exactly ±1/2. (The previous Cephes-inherited cutoff
// of 36974 — where the *naive* phase πx²/2 exhausts a double — was ~2000×
// too early, an 8.6e-6 error cliff. The phase is now reduced exactly, see
// `fresnelPhase`, so the asymptotic expansion stays usable to the cutoff
// below. Also, 6e15 < 2^53, keeping the Dekker split exact.)
// (CORRECTNESS P2 #19)
const FRESNEL_ASYMPTOTIC_CUTOFF = 6e15;

/**
 * The Fresnel phase πx²/2 reduced mod 2π, computed as (π/2)·(x² mod 4).
 *
 * `x² mod 4` is computed exactly: x is Dekker-split into xh + xl so the
 * partial products xh², xh·xl, xl² are each exactly representable, and the
 * JS `%` operator on doubles is exact. A naive `(Math.PI / 2) * x * x`
 * loses the phase progressively for x ≳ 1e5 (cos of it was 0.99999999 at
 * x = 1e6, 0.88 at x = 7.5e7).
 *
 * Requires |x| < 2^53 (guaranteed by FRESNEL_ASYMPTOTIC_CUTOFF).
 */
function fresnelPhase(x: number): number {
  const split = 134217729; // 2^27 + 1 (Veltkamp)
  const t = split * x;
  const xh = t - (t - x);
  const xl = x - xh;
  // x² = xh² + 2·xh·xl + xl², each product exact (Dekker).
  // 2·(xh·xl) mod 4 = 2·((xh·xl) mod 2), keeping the doubled term exact too.
  let r = ((xh * xh) % 4) + 2 * ((xh * xl) % 2) + ((xl * xl) % 4);
  r %= 4;
  if (r < 0) r += 4;
  return (Math.PI / 2) * r;
}

/**
 * Fresnel sine integral: S(x) = ∫₀ˣ sin(π t²/2) dt
 *
 * S is odd, S(∞) → 1/2.
 */
export function fresnelS(x: number): number {
  if (!isFinite(x)) {
    if (x !== x) return NaN; // NaN
    return x > 0 ? 0.5 : -0.5; // ±Infinity
  }
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  if (x < 1.6) {
    const x2 = x * x;
    const t = x2 * x2; // x⁴
    return (sign * x * x2 * polevl(t, SN)) / polevl(t, SD);
  }

  if (x < FRESNEL_ASYMPTOTIC_CUTOFF) {
    const x2 = x * x;
    const t = Math.PI * x2; // πx²
    const u = 1 / (t * t); // 1/(π²x⁴)
    const f = 1 - (u * polevl(u, FN)) / polevl(u, FD);
    const g = ((1 / t) * polevl(u, GN)) / polevl(u, GD);
    const z = fresnelPhase(x); // πx²/2 mod 2π, exactly reduced
    const c = Math.cos(z);
    const s = Math.sin(z);
    return sign * (0.5 - (f * c + g * s) / (Math.PI * x));
  }

  // Beyond the cutoff the oscillation is below half an ulp of 1/2.
  return sign * 0.5;
}

/**
 * Fresnel cosine integral: C(x) = ∫₀ˣ cos(π t²/2) dt
 *
 * C is odd, C(∞) → 1/2.
 */
export function fresnelC(x: number): number {
  if (!isFinite(x)) {
    if (x !== x) return NaN; // NaN
    return x > 0 ? 0.5 : -0.5; // ±Infinity
  }
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  if (x < 1.6) {
    const x2 = x * x;
    const t = x2 * x2; // x⁴
    return (sign * x * polevl(t, CN)) / polevl(t, CD);
  }

  if (x < FRESNEL_ASYMPTOTIC_CUTOFF) {
    const x2 = x * x;
    const t = Math.PI * x2; // πx²
    const u = 1 / (t * t); // 1/(π²x⁴)
    const f = 1 - (u * polevl(u, FN)) / polevl(u, FD);
    const g = ((1 / t) * polevl(u, GN)) / polevl(u, GD);
    const z = fresnelPhase(x); // πx²/2 mod 2π, exactly reduced
    const c = Math.cos(z);
    const s = Math.sin(z);
    return sign * (0.5 + (f * s - g * c) / (Math.PI * x));
  }

  // Beyond the cutoff the oscillation is below half an ulp of 1/2.
  return sign * 0.5;
}

/** Unnormalized cardinal sine: sinc(x) = sin(x)/x, sinc(0) = 1. */
export function sinc(x: number): number {
  return x === 0 ? 1 : Math.sin(x) / x;
}

//
// ---------------- Bignum kernels (REVIEW.md B23) ----------------
//
// Precision policy: like the other bignum kernels in this file (bigGammaln,
// bigDigamma, ...), convergence tolerances use `BigDecimal.precision` plus
// ~10 guard digits. Unlike those kernels, the series below can suffer
// subtractive cancellation (1 − erf for erfc, the alternating Fresnel
// Taylor series), so the working precision itself is temporarily raised by
// the cancellation budget and the result is rounded back to the caller's
// precision.
//
// BigDecimal exp/ln regimes (REVIEW.md D6): the kernels below only call
// `exp` with arguments of magnitude ≲ 2.3·(precision + guard) (from the
// e^{−x²} factors — the series/asymptotic switchovers naturally bound the
// argument), well inside the verified range. `sin`/`cos` argument reduction
// uses the engine's 1100-digit π, so the Fresnel phase πx²/2 is reduced
// accurately for |x²| up to ~10^(1000−precision).
//

const LOG10E = Math.LOG10E; // log10(e) ≈ 0.4343

/**
 * Run `fn` with `BigDecimal.precision` temporarily raised by `extra`
 * digits (BigDecimal precision is a module-global, so save/restore).
 */
function withExtraPrecision(extra: number, fn: () => BigNum): BigNum {
  const saved = BigDecimal.precision;
  BigDecimal.precision = saved + Math.max(0, Math.ceil(extra));
  try {
    return fn();
  } finally {
    BigDecimal.precision = saved;
  }
}

/**
 * Maclaurin series for erf (DLMF 7.6.2):
 *    erf(x) = (2/√π) e^{−x²} Σ_{n≥0} (2x²)ⁿ x / (1·3·5···(2n+1))
 * All terms are positive, so there is no subtractive cancellation: the
 * relative error tracks the working precision. Must be called with x > 0.
 *
 * `tolDigits` is the relative truncation tolerance (10^−tolDigits).
 */
function bigErfSeries(x: BigNum, tolDigits: number): BigNum {
  const x2 = x.mul(x);
  const twoX2 = x2.mul(2);
  let term = x;
  let sum = x;
  const tol = new BigDecimal(10).pow(-tolDigits);
  // Terms decay once 2n+1 > 2x²; generous cap (the loop breaks on tol)
  const maxTerms = 1000 + 10 * Math.ceil(x2.toNumber()) + 10 * tolDigits;
  for (let n = 1; n <= maxTerms; n++) {
    term = term.mul(twoX2).div(2 * n + 1);
    sum = sum.add(term);
    if (term.lt(sum.mul(tol))) break;
  }
  return sum.mul(2).mul(x2.neg().exp()).div(BigDecimal.PI.sqrt());
}

/**
 * Asymptotic series for erfc (DLMF 7.12.1):
 *    erfc(x) = e^{−x²}/(x√π) · Σ_{m≥0} (−1)^m (2m−1)!! / (2x²)^m
 * The minimum term is ~e^{−x²} relative, so the series can deliver about
 * x²·log10(e) digits — callers must only use it when that exceeds the
 * requested tolerance. Must be called with x > 0.
 */
function bigErfcAsymptotic(x: BigNum, tolDigits: number): BigNum {
  const twoX2 = x.mul(x).mul(2);
  let term: BigNum = BigDecimal.ONE;
  let sum: BigNum = BigDecimal.ONE;
  let prev = term.abs();
  const tol = new BigDecimal(10).pow(-tolDigits);
  for (let m = 1; m <= 100000; m++) {
    term = term
      .mul(2 * m - 1)
      .div(twoX2)
      .neg();
    const tAbs = term.abs();
    // Divergence guard: stop at the smallest term of the asymptotic series
    if (tAbs.gt(prev)) break;
    prev = tAbs;
    sum = sum.add(term);
    if (tAbs.lt(tol)) break;
  }
  return x.mul(x).neg().exp().div(x.mul(BigDecimal.PI.sqrt())).mul(sum);
}

/**
 * Bignum error function. Precision scales with `BigDecimal.precision`.
 *
 * - |x| ≤ √((p+10)·ln 10): Maclaurin series (DLMF 7.6.2), no cancellation.
 * - beyond: erf(x) rounds to ±1 at the working precision
 *   (erfc(x) < e^{−x²} ≤ 10^{−(p+10)}).
 */
export function bigErf(ce: ComputeEngine, x: BigNum): BigNum {
  if (x.isNaN()) return BigDecimal.NAN;
  if (!x.isFinite())
    return x.isNegative() ? BigDecimal.NEGATIVE_ONE : BigDecimal.ONE;
  if (x.isZero()) return BigDecimal.ZERO;
  if (x.isNegative()) return bigErf(ce, x.neg()).neg();

  const p = BigDecimal.precision;
  const guard = 10;

  const xN = x.toNumber();
  if (xN * xN * LOG10E >= p + guard) return BigDecimal.ONE;

  return withExtraPrecision(guard, () =>
    bigErfSeries(x, p + guard)
  ).toPrecision(p);
}

/**
 * Imaginary error function erfi(x) = −i·erf(i·x) = (2/√π)∫₀ˣ e^{t²} dt.
 *
 * Maclaurin series (all-positive, no subtractive cancellation):
 *    erfi(x) = (2/√π) Σ_{n≥0} x^{2n+1} / (n!·(2n+1))
 * with the term recurrence tₙ = tₙ₋₁ · x²·(2n−1) / (n·(2n+1)).
 * Odd function. Grows like e^{x²}, so it overflows to ±∞ for large |x|.
 */
export function erfi(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return 0;
  if (!Number.isFinite(x)) return x > 0 ? Infinity : -Infinity;

  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const x2 = ax * ax;
  let term = ax; // n = 0 term: x
  let sum = ax;
  for (let n = 1; n < 1000; n++) {
    term *= (x2 * (2 * n - 1)) / (n * (2 * n + 1));
    sum += term;
    if (term < sum * 1e-18) break;
  }
  return sign * (2 / Math.sqrt(Math.PI)) * sum;
}

/**
 * Bignum imaginary error function. The Maclaurin series above has only
 * positive terms (no cancellation), so the relative error tracks the working
 * precision. Precision scales with `BigDecimal.precision`.
 */
function bigErfiSeries(x: BigNum, tolDigits: number): BigNum {
  const x2 = x.mul(x);
  let term = x; // n = 0
  let sum = x;
  const tol = new BigDecimal(10).pow(-tolDigits);
  const maxTerms = 1000 + 10 * Math.ceil(x2.toNumber()) + 10 * tolDigits;
  for (let n = 1; n <= maxTerms; n++) {
    // tₙ = tₙ₋₁ · x²·(2n−1) / (n·(2n+1))
    term = term
      .mul(x2)
      .mul(2 * n - 1)
      .div(n * (2 * n + 1));
    sum = sum.add(term);
    if (term.lt(sum.mul(tol))) break;
  }
  return sum.mul(2).div(BigDecimal.PI.sqrt());
}

export function bigErfi(ce: ComputeEngine, x: BigNum): BigNum {
  if (x.isNaN()) return BigDecimal.NAN;
  if (!x.isFinite())
    return x.isNegative()
      ? BigDecimal.NEGATIVE_INFINITY
      : BigDecimal.POSITIVE_INFINITY;
  if (x.isZero()) return BigDecimal.ZERO;
  if (x.isNegative()) return bigErfi(ce, x.neg()).neg();

  const p = BigDecimal.precision;
  const guard = 10;
  return withExtraPrecision(guard, () =>
    bigErfiSeries(x, p + guard)
  ).toPrecision(p);
}

const EULER_GAMMA = 0.5772156649015328606; // Euler–Mascheroni constant γ

/**
 * Sine and cosine integrals computed together:
 *   Si(x) = ∫₀ˣ sin t / t dt          (odd, Si(±∞) = ±π/2)
 *   Ci(x) = γ + ln x + ∫₀ˣ (cos t − 1)/t dt   (Ci(0⁺) = −∞, Ci(∞) = 0)
 *
 * Method (Numerical Recipes §6.8 `cisi`): the Maclaurin series for |x| ≤ 2
 * (negligible cancellation), and Lentz's modified continued fraction for the
 * complex exponential integral E₁(ix) for |x| > 2 — evaluated here with
 * explicit real/imaginary parts so no Complex type is needed. Full double
 * precision across the whole range.
 *
 * Ci(x) for x < 0 is complex; this returns its real part, Ci(|x|).
 */
function cisi(x: number): { si: number; ci: number } {
  const EPS = 1e-16;
  const TMIN = 2.0;
  const BIG = 1e30;
  const t = Math.abs(x);

  if (t === 0) return { si: 0, ci: -Infinity };
  if (!Number.isFinite(t))
    return { si: x > 0 ? Math.PI / 2 : -Math.PI / 2, ci: 0 };

  let si: number;
  let ci: number;

  if (t > TMIN) {
    // Continued fraction for ∫_t^∞ e^{iu}/u du via Lentz's algorithm.
    // b = 1 + i·t; c = BIG; d = h = 1/b.
    let br = 1;
    const bi = t; // imaginary part of b is constant
    let cr = BIG;
    let cim = 0;
    let denom = br * br + bi * bi;
    let dr = br / denom;
    let di = -bi / denom;
    let hr = dr;
    let hi = di;
    for (let i = 1; i < 100; i++) {
      const a = -i * i;
      br += 2; // b += 2
      // d = 1/(a·d + b)
      let tr = a * dr + br;
      let ti = a * di + bi;
      denom = tr * tr + ti * ti;
      dr = tr / denom;
      di = -ti / denom;
      // c = b + a/c
      denom = cr * cr + cim * cim;
      cr = br + (a * cr) / denom;
      cim = bi - (a * cim) / denom;
      // del = c·d
      const delr = cr * dr - cim * di;
      const deli = cr * di + cim * dr;
      // h = h·del
      tr = hr * delr - hi * deli;
      ti = hr * deli + hi * delr;
      hr = tr;
      hi = ti;
      if (Math.abs(delr - 1) + Math.abs(deli) <= EPS) break;
    }
    // h = (cos t − i·sin t)·h ; then ci = −Re(h), si = π/2 + Im(h)
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const reH = ct * hr + st * hi;
    const imH = ct * hi - st * hr;
    ci = -reH;
    si = Math.PI / 2 + imH;
  } else {
    // Maclaurin series, accumulating the odd-power (Si) and even-power (Ci)
    // partial sums in lockstep.
    let sum = 0;
    let sums = 0;
    let sumc = 0;
    let sign = 1;
    let fact = 1;
    let odd = true;
    for (let k = 1; k <= 100; k++) {
      fact *= t / k;
      const term = fact / k;
      sum += sign * term;
      const err = term / Math.abs(sum);
      if (odd) {
        sign = -sign;
        sums = sum;
        sum = sumc;
      } else {
        sumc = sum;
        sum = sums;
      }
      if (err < EPS) break;
      odd = !odd;
    }
    si = sums;
    ci = sumc + Math.log(t) + EULER_GAMMA;
  }

  if (x < 0) si = -si; // Si is odd
  return { si, ci };
}

/** Sine integral Si(x) = ∫₀ˣ sin t / t dt. */
export function sinIntegral(x: number): number {
  if (Number.isNaN(x)) return NaN;
  return cisi(x).si;
}

/** Cosine integral Ci(x) = γ + ln x + ∫₀ˣ (cos t − 1)/t dt (real part). */
export function cosIntegral(x: number): number {
  if (Number.isNaN(x)) return NaN;
  return cisi(x).ci;
}

/**
 * Hyperbolic sine integral Shi(x) = ∫₀ˣ sinh(t)/t dt. Odd and entire, so it is
 * real for every real x. Built on Ei: Shi(x) = (Ei(x) − Ei(−x))/2.
 */
export function sinhIntegral(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return 0;
  return (expIntegralEi(x) - expIntegralEi(-x)) / 2;
}

/**
 * Hyperbolic cosine integral Chi(x) = γ + ln|x| + ∫₀ˣ (cosh t − 1)/t dt.
 * For real x < 0 the function is complex (Chi(−|x|) = Chi(|x|) + iπ); like the
 * cosine-integral kernel, this returns the real part Chi(|x|). Built on Ei:
 * Chi(|x|) = (Ei(|x|) + Ei(−|x|))/2.
 */
export function coshIntegral(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const a = Math.abs(x);
  return (expIntegralEi(a) + expIntegralEi(-a)) / 2;
}

/**
 * E₁(x) = ∫ₓ^∞ e^{−t}/t dt for x > 0 (Numerical Recipes §6.3 `expint`,
 * specialised to n = 1): the power series for x ≤ 1, Lentz's continued
 * fraction for x > 1. Used to extend Ei to negative arguments via
 * Ei(−x) = −E₁(x).
 */
function expInt1(x: number): number {
  const EPS = 1e-16;
  const MAXIT = 200;
  if (x <= 0) return NaN;
  if (x <= 1) {
    // E₁(x) = −γ − ln x − Σ_{n≥1} (−x)ⁿ/(n·n!)
    let sum = -Math.log(x) - EULER_GAMMA;
    let fact = 1;
    for (let n = 1; n <= MAXIT; n++) {
      fact *= -x / n;
      const del = -fact / n;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * EPS) break;
    }
    return sum;
  }
  // Lentz continued fraction: E₁(x) = e^{−x}·(1/(x+1−) 1²/(x+3−) 2²/(x+5−) …)
  const BIG = 1e30;
  let b = x + 1;
  let c = BIG;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= MAXIT; i++) {
    const a = -i * i;
    b += 2;
    d = 1 / (a * d + b);
    c = b + a / c;
    const del = c * d;
    h *= del;
    if (Math.abs(del - 1) <= EPS) break;
  }
  return h * Math.exp(-x);
}

/**
 * Exponential integral Ei(x) = PV ∫_{−∞}^x e^t/t dt, for real x ≠ 0.
 *   Ei(0) = −∞, Ei(+∞) = +∞, Ei(−∞) = 0.
 * For x > 0: power series Ei(x) = γ + ln x + Σ_{n≥1} xⁿ/(n·n!) for moderate x,
 * the asymptotic series e^x/x·(1 + 1/x + 2!/x² + …) for large x (Numerical
 * Recipes §6.3 `ei`). For x < 0: Ei(x) = −E₁(−x).
 */
export function expIntegralEi(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return -Infinity;
  if (!Number.isFinite(x)) return x > 0 ? Infinity : 0;
  if (x < 0) return -expInt1(-x);

  const EPS = 1e-16;
  const MAXIT = 200;
  const SWITCH = -Math.log(EPS); // ≈ 36.8 — series below, asymptotic above
  if (x <= SWITCH) {
    // Power series (all terms positive for x > 0 — no cancellation).
    let sum = 0;
    let fact = 1;
    for (let k = 1; k <= MAXIT; k++) {
      fact *= x / k;
      const term = fact / k;
      sum += term;
      if (term < EPS * sum) break;
    }
    return sum + Math.log(x) + EULER_GAMMA;
  }
  // Asymptotic series (divergent — stop once terms start growing).
  let sum = 0;
  let term = 1;
  for (let k = 1; k <= MAXIT; k++) {
    const prev = term;
    term *= k / x;
    if (term < EPS) break;
    if (term < prev) sum += term;
    else {
      sum -= prev; // last reliable term, then halt
      break;
    }
  }
  return (Math.exp(x) * (1 + sum)) / x;
}

/**
 * Logarithmic integral li(x) = PV ∫₀ˣ dt/ln t, for x > 0, x ≠ 1.
 * Equivalent to Ei(ln x). li(0) = 0, li(1) = −∞.
 */
export function logIntegral(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return 0;
  if (x === 1) return -Infinity;
  if (x < 0) return NaN; // li is real only for x ≥ 0
  return expIntegralEi(Math.log(x));
}

/**
 * Bignum complementary error function.
 * Precision scales with `BigDecimal.precision`.
 *
 * - x² log10(e) ≤ p+10: computed as 1 − erf(x) with the working precision
 *   raised by the x²·log10(e) digits lost to cancellation.
 * - beyond: the asymptotic series (DLMF 7.12.1), which by construction of
 *   the switchover delivers ≥ p+10 digits there.
 */
export function bigErfc(ce: ComputeEngine, x: BigNum): BigNum {
  if (x.isNaN()) return BigDecimal.NAN;
  if (!x.isFinite()) return x.isNegative() ? BigDecimal.TWO : BigDecimal.ZERO;
  if (x.isZero()) return BigDecimal.ONE;
  if (x.isNegative()) return BigDecimal.TWO.sub(bigErfc(ce, x.neg()));

  const p = BigDecimal.precision;
  const guard = 10;

  const xN = x.toNumber();
  const cancellation = xN * xN * LOG10E; // digits lost in 1 − erf(x)

  if (cancellation <= p + guard) {
    return withExtraPrecision(cancellation + guard, () =>
      BigDecimal.ONE.sub(bigErfSeries(x, p + Math.ceil(cancellation) + guard))
    ).toPrecision(p);
  }

  return withExtraPrecision(guard, () =>
    bigErfcAsymptotic(x, p + guard)
  ).toPrecision(p);
}

/**
 * Bignum inverse error function: y such that erf(y) = x, for x ∈ [−1, 1].
 * Precision scales with `BigDecimal.precision`.
 *
 * Newton iteration on `bigErf`:
 *    y ← y − (erf(y) − x)·(√π/2)·e^{y²}
 * seeded from the machine-precision Winitzki estimate (~3 digits; each
 * iteration doubles the digits). Note that erfInv is intrinsically
 * ill-conditioned as |x| → 1 (|dy/dx| = (√π/2)e^{y²}): the result is the
 * best possible for the given input, but tiny perturbations of x near ±1
 * produce large changes in y.
 */
export function bigErfInv(ce: ComputeEngine, x: BigNum): BigNum {
  if (x.isNaN()) return BigDecimal.NAN;
  if (x.abs().gt(BigDecimal.ONE)) return BigDecimal.NAN;
  if (x.isZero()) return BigDecimal.ZERO;
  if (x.eq(BigDecimal.ONE)) return new BigDecimal(Infinity);
  if (x.eq(BigDecimal.NEGATIVE_ONE)) return new BigDecimal(-Infinity);
  if (x.isNegative()) return bigErfInv(ce, x.neg()).neg();

  const p = BigDecimal.precision;
  const guard = 15;

  return withExtraPrecision(guard, () => {
    // Seed: machine Winitzki estimate; if 1−x² underflows in double
    // (x within ~1e−17 of 1), use the leading asymptotic √(−ln(1−x²))
    let y: BigNum;
    const xN = x.toNumber();
    if (1 - xN * xN > 0) y = new BigDecimal(erfInvApprox(xN));
    else y = BigDecimal.ONE.sub(x.mul(x)).ln().neg().sqrt();

    const halfSqrtPi = BigDecimal.PI.sqrt().div(2);
    const tol = new BigDecimal(10).pow(-(p + 5));
    for (let i = 0; i < 100; i++) {
      const delta = bigErf(ce, y).sub(x).mul(halfSqrtPi).mul(y.mul(y).exp());
      y = y.sub(delta);
      if (delta.abs().lt(y.abs().mul(tol))) break;
    }
    return y;
  }).toPrecision(p);
}

/**
 * Bignum unnormalized cardinal sine: sinc(x) = sin(x)/x, sinc(0) = 1.
 * Precision scales with `BigDecimal.precision` (sin uses the engine's
 * 1100-digit π for argument reduction).
 */
export function bigSinc(x: BigNum): BigNum {
  if (x.isNaN()) return BigDecimal.NAN;
  if (!x.isFinite()) return BigDecimal.ZERO; // lim sinc(±∞) = 0
  if (x.isZero()) return BigDecimal.ONE;
  return x.sin().div(x);
}

/**
 * Taylor series for the Fresnel integrals:
 *    S(x) = Σ (−1)ⁿ (π/2)^{2n+1} x^{4n+3} / ((2n+1)!·(4n+3))
 *    C(x) = Σ (−1)ⁿ (π/2)^{2n}   x^{4n+1} / ((2n)!·(4n+1))
 * Alternating with largest term ~e^{πx²/2}: the caller must raise the
 * working precision by the (πx²/2)·log10(e) digits lost to cancellation.
 * Must be called with x > 0. `tolDigits` is an absolute tolerance.
 */
function bigFresnelTaylor(
  x: BigNum,
  kind: 's' | 'c',
  tolDigits: number
): BigNum {
  const h = BigDecimal.PI.div(2);
  const h2 = h.mul(h);
  const x4 = x.mul(x).mul(x).mul(x);
  const h2x4 = h2.mul(x4);

  // c_n = (π/2)^{2n+1} x^{4n+3}/(2n+1)!  (S)  or  (π/2)^{2n} x^{4n+1}/(2n)!  (C)
  let c: BigNum;
  let sum: BigNum;
  if (kind === 's') {
    c = h.mul(x).mul(x).mul(x);
    sum = c.div(3);
  } else {
    c = x;
    sum = x;
  }

  const tol = new BigDecimal(10).pow(-tolDigits);
  const uN = (Math.PI / 2) * x.toNumber() ** 2;
  // Terms decay once 2n > πx²/2; generous cap (the loop breaks on tol)
  const maxTerms = 100 + 2 * Math.ceil(uN) + 2 * tolDigits;
  for (let n = 1; n <= maxTerms; n++) {
    const d = kind === 's' ? 2 * n * (2 * n + 1) : (2 * n - 1) * (2 * n);
    c = c.mul(h2x4).div(d).neg();
    const t = c.div(kind === 's' ? 4 * n + 3 : 4 * n + 1);
    sum = sum.add(t);
    if (t.abs().lt(tol)) break;
  }
  return sum;
}

/**
 * Asymptotic expansion for the Fresnel integrals (DLMF 7.5.3–4, 7.12.2–3),
 * with u = πx²/2:
 *    f(x) ~ (1/πx) Σ (−1)^m (1/2)_{2m}   / u^{2m}
 *    g(x) ~ (1/πx) Σ (−1)^m (1/2)_{2m+1} / u^{2m+1}
 *    S(x) = 1/2 − f·cos u − g·sin u,   C(x) = 1/2 + f·sin u − g·cos u
 * Minimum term ~e^{−u} relative, so usable only when u·log10(e) exceeds
 * the requested digits (guaranteed by the switchover in bigFresnel).
 * Must be called with x > 0.
 */
function bigFresnelAsymptotic(
  x: BigNum,
  kind: 's' | 'c',
  tolDigits: number
): BigNum {
  const pi = BigDecimal.PI;
  const u = pi.mul(x).mul(x).div(2);
  const fourU2 = u.mul(u).mul(4);
  const piX = pi.mul(x);

  // Pochhammer ratios: (1/2)_{2m}/(1/2)_{2m−2} = (4m−3)(4m−1)/4
  //                    (1/2)_{2m+1}/(1/2)_{2m−1} = (4m−1)(4m+1)/4
  let fTerm: BigNum = BigDecimal.ONE;
  let gTerm: BigNum = BigDecimal.HALF.div(u);
  let fSum = fTerm;
  let gSum = gTerm;
  let prev = fTerm.abs();
  const tol = new BigDecimal(10).pow(-tolDigits);
  for (let m = 1; m <= 100000; m++) {
    fTerm = fTerm
      .mul((4 * m - 3) * (4 * m - 1))
      .div(fourU2)
      .neg();
    gTerm = gTerm
      .mul((4 * m - 1) * (4 * m + 1))
      .div(fourU2)
      .neg();
    const fAbs = fTerm.abs();
    // Divergence guard: stop at the smallest term of the asymptotic series
    if (fAbs.gt(prev)) break;
    prev = fAbs;
    fSum = fSum.add(fTerm);
    gSum = gSum.add(gTerm);
    if (fAbs.lt(tol) && gTerm.abs().lt(tol)) break;
  }
  const f = fSum.div(piX);
  const g = gSum.div(piX);
  const sinU = u.sin();
  const cosU = u.cos();

  if (kind === 's') return BigDecimal.HALF.sub(f.mul(cosU)).sub(g.mul(sinU));
  return BigDecimal.HALF.add(f.mul(sinU)).sub(g.mul(cosU));
}

/**
 * log10|x| for any non-zero finite BigDecimal, read off its own representation
 * (`|x| = |significand|·10^exponent`, so log10|x| = exponent + log10|significand|).
 * Going through `toNumber()` instead saturates to +Infinity for every finite
 * value past the double range (|x| ≳ 1.8e308), which would make magnitude tests
 * on such arguments answer "infinitely large" regardless of the actual value.
 * Must be called with a finite, non-zero x.
 */
function bigLog10Abs(x: BigNum): number {
  const sig = x.significand < 0n ? -x.significand : x.significand;
  const digits = sig.toString().length;
  // Keep the leading 15 digits (a double carries ~15.95 of them): the bigint
  // division by 10^(digits−15) is exact and its quotient converts without
  // overflowing, so log10|significand| = shift + log10(leading digits).
  const shift = Math.max(0, digits - 15);
  const lead = Number(shift > 0 ? sig / 10n ** BigInt(shift) : sig);
  return x.exponent + shift + Math.log10(lead);
}

function bigFresnel(x: BigNum, kind: 's' | 'c'): BigNum {
  if (x.isNaN()) return BigDecimal.NAN;
  if (!x.isFinite())
    return x.isNegative() ? BigDecimal.HALF.neg() : BigDecimal.HALF;
  if (x.isZero()) return BigDecimal.ZERO;
  if (x.isNegative()) return bigFresnel(x.neg(), kind).neg(); // odd

  const p = BigDecimal.precision;
  const guard = 10;

  const xN = x.toNumber();
  const uN = (Math.PI / 2) * xN * xN; // phase πx²/2
  const cancellation = uN * LOG10E; // digits lost in the Taylor series
  // Magnitude of x on a log10 scale. Derived from the BigDecimal's own
  // (significand, exponent) pair rather than `toNumber()`, which saturates at
  // +Infinity for a finite x past the double range: that made the 1/2 shortcut
  // below fire at every working precision for such an argument (discarding a
  // correction that IS representable at high precision — at 500 digits
  // S(10^400) − 1/2 ≈ −1/(π·10^400)) and left the `log10U` derivation that
  // follows unreachable for them.
  const log10X = bigLog10Abs(x);

  if (cancellation <= p + 2 * guard) {
    return withExtraPrecision(cancellation + guard, () =>
      bigFresnelTaylor(x, kind, p + guard)
    ).toPrecision(p);
  }

  // Both S(x) and C(x) approach 1/2 with an oscillating correction that is
  // O(1/(πx)). Once that correction sits below the working tolerance
  // 10^−(p+guard) the answer IS 1/2 in every digit we carry, so return it
  // without running the series. (x is positive here: the negative branch
  // above recursed on |x| and negated the result.)
  if (log10X > p + guard) return BigDecimal.HALF;

  // Asymptotic regime: truncation error ~e^{−u} < 10^{−(p+20)} here.
  // Extra digits also cover the absolute phase accuracy of sin/cos(πx²/2).
  // log10(πx²/2) is derived from log10(x) when the phase itself overflows
  // the double: `Math.log10(Infinity)` made `extra` — and hence the
  // process-global `BigDecimal.precision` set by `withExtraPrecision` —
  // Infinity, which sent the Chudnovsky π binary splitting into unbounded
  // recursion ("Maximum call stack size exceeded"). The 1/2 shortcut above
  // does not cover this on its own: at a working precision above ~150 digits
  // an x whose phase overflows still needs the series.
  const log10U = Number.isFinite(uN)
    ? Math.log10(uN)
    : 2 * log10X + Math.log10(Math.PI / 2);
  const extra = guard + Math.ceil(Math.max(0, log10U));
  return withExtraPrecision(extra, () =>
    bigFresnelAsymptotic(x, kind, p + guard)
  ).toPrecision(p);
}

/**
 * Bignum Fresnel sine integral S(x). Precision scales with
 * `BigDecimal.precision`: Taylor series for πx²/2·log10(e) ≤ p+20 (with
 * raised working precision to absorb the alternating-series cancellation),
 * asymptotic expansion beyond (where it delivers ≥ p+10 digits).
 */
export function bigFresnelS(x: BigNum): BigNum {
  return bigFresnel(x, 's');
}

/**
 * Bignum Fresnel cosine integral C(x). Same switchover as `bigFresnelS`.
 */
export function bigFresnelC(x: BigNum): BigNum {
  return bigFresnel(x, 'c');
}

//
// ---------------- Arithmetic-geometric mean ----------------
//

/**
 * Arithmetic-geometric mean of two non-negative reals.
 * Quadratic convergence: ~6 iterations at machine precision.
 */
export function agm(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  if (a < 0 || b < 0) return NaN;
  if (a === 0 || b === 0) return 0;
  if (!isFinite(a) || !isFinite(b)) return Infinity;
  for (let i = 0; i < 64 && Math.abs(a - b) > 1e-17 * Math.abs(a); i++) {
    const an = 0.5 * (a + b);
    b = Math.sqrt(a * b);
    a = an;
  }
  return 0.5 * (a + b);
}

/**
 * Bignum arithmetic-geometric mean of two non-negative reals, at the
 * current `BigDecimal.precision` (callers should raise precision around
 * this for guard digits).
 */
export function bigAgm(a: BigNum, b: BigNum): BigNum {
  if (a.isNaN() || b.isNaN() || a.isNegative() || b.isNegative())
    return BigDecimal.NAN;
  if (a.isZero() || b.isZero()) return BigDecimal.ZERO;
  const tol = new BigDecimal(10).pow(-(BigDecimal.precision - 2));
  for (let i = 0; i < 200 && a.sub(b).abs().gt(tol.mul(a.abs())); i++) {
    const an = a.add(b).div(BigDecimal.TWO);
    b = a.mul(b).sqrt();
    a = an;
  }
  return a.add(b).div(BigDecimal.TWO);
}

//
// ---------------- Complete elliptic integrals (parameter m = k²) ----------------
//
// Convention: K(m) = ∫₀^{π/2} dθ/√(1 − m·sin²θ) (Legendre/Fungrim parameter
// convention, m = k², matching `EllipticK(m)` in the Fungrim corpus).
//

/**
 * Complete elliptic integral of the first kind K(m), parameter convention.
 * Valid for m ≤ 1 (K(1) = ∞; for m > 1 the value is complex — handled by
 * the complex kernel).
 */
export function ellipticK(m: number): number {
  if (Number.isNaN(m)) return NaN;
  if (m === 1) return Infinity;
  if (m > 1) return NaN; // complex value: route to the complex kernel
  // K(m) = π / (2·agm(1, √(1−m)))  [Fungrim e15f43]
  return Math.PI / (2 * agm(1, Math.sqrt(1 - m)));
}

/**
 * Complete elliptic integral of the second kind E(m), parameter convention.
 * Valid for m ≤ 1 (for m > 1 the value is complex — handled by the complex
 * kernel). Uses the AGM with the cₙ-sum (Abramowitz & Stegun 17.6.3/17.6.4):
 * E = K·(1 − Σₙ 2^{n−1}·cₙ²) with c₀² = m, cₙ = (aₙ₋₁ − bₙ₋₁)/2.
 */
export function ellipticE(m: number): number {
  if (Number.isNaN(m)) return NaN;
  if (m === 1) return 1;
  if (m > 1) return NaN; // complex value: route to the complex kernel
  let a = 1;
  let b = Math.sqrt(1 - m);
  let sum = 0.5 * m; // 2^{−1}·c₀²
  let pow2 = 0.5;
  for (let i = 0; i < 64 && Math.abs(a - b) > 1e-17 * a; i++) {
    const c = 0.5 * (a - b);
    const an = 0.5 * (a + b);
    b = Math.sqrt(a * b);
    a = an;
    pow2 *= 2;
    sum += pow2 * c * c;
  }
  const K = Math.PI / (2 * a);
  return K * (1 - sum);
}

/** Bignum K(m) for m < 1 (parameter convention). */
export function bigEllipticK(ce: ComputeEngine, m: BigNum): BigNum {
  if (m.isNaN() || m.gte(BigDecimal.ONE)) return BigDecimal.NAN;
  const p = BigDecimal.precision;
  const guard = 10;
  return withExtraPrecision(guard, () =>
    BigDecimal.PI.div(
      BigDecimal.TWO.mul(bigAgm(BigDecimal.ONE, BigDecimal.ONE.sub(m).sqrt()))
    )
  ).toPrecision(p);
}

/** Bignum E(m) for m < 1 (parameter convention). */
export function bigEllipticE(ce: ComputeEngine, m: BigNum): BigNum {
  if (m.isNaN() || m.gt(BigDecimal.ONE)) return BigDecimal.NAN;
  if (m.eq(BigDecimal.ONE)) return BigDecimal.ONE;
  const p = BigDecimal.precision;
  const guard = 10;
  return withExtraPrecision(guard, () => {
    const tol = new BigDecimal(10).pow(-(BigDecimal.precision - 2));
    let a = BigDecimal.ONE;
    let b = BigDecimal.ONE.sub(m).sqrt();
    let sum = m.div(BigDecimal.TWO); // 2^{−1}·c₀²
    let pow2 = BigDecimal.HALF;
    for (let i = 0; i < 200 && a.sub(b).abs().gt(tol.mul(a)); i++) {
      const c = a.sub(b).div(BigDecimal.TWO);
      const an = a.add(b).div(BigDecimal.TWO);
      b = a.mul(b).sqrt();
      a = an;
      pow2 = pow2.mul(BigDecimal.TWO);
      sum = sum.add(pow2.mul(c).mul(c));
    }
    const K = BigDecimal.PI.div(BigDecimal.TWO.mul(a));
    return K.mul(BigDecimal.ONE.sub(sum));
  }).toPrecision(p);
}

//
// ---------------- Carlson symmetric elliptic integrals (machine real) ----------------
//
// Duplication-theorem algorithms (Carlson 1995; same series tails as
// mpmath's elliprf/elliprc/elliprj). Real domains:
//   RF(x,y,z): x,y,z ≥ 0, at most one zero
//   RC(x,y):   x ≥ 0; y < 0 returns the Cauchy principal value
//   RJ(x,y,z,p): x,y,z ≥ 0, at most one zero; p ≠ 0 (p < 0 returns the
//                Cauchy principal value via DLMF 19.20.14)
//   RD(x,y,z) = RJ(x,y,z,z)
// Outside these domains the kernels return NaN so `applyN` cascades to the
// complex implementations.
//

// Relative error target for the duplication loops. The series tail is
// O(r): pushing well below double epsilon makes the truncation error
// negligible against roundoff (each factor-of-10⁶ here costs one extra
// duplication step).
const CARLSON_TOL = 1e-24;

/** Carlson R_C(x, y) = R_F(x, y, y), machine real, PV for y < 0. */
export function carlsonRC(x: number, y: number): number {
  if (Number.isNaN(x) || Number.isNaN(y) || x < 0) return NaN;
  if (y === 0) return Infinity;
  if (x === 0) return Math.PI / (2 * Math.sqrt(y));
  // Cauchy principal value for y < 0 (DLMF 19.2.20)
  if (y < 0) return Math.sqrt(x / (x - y)) * carlsonRC(x - y, -y);
  if (x === y) return 1 / Math.sqrt(x);
  // Near-degenerate y ≈ x: the acos/acosh forms below lose half the
  // digits (the inverse functions are evaluated at arguments → 1, where
  // they are infinitely steep; mpmath compensates with extra working
  // precision). Use RC(x, x(1+e)) = x^{−1/2}·Σₖ (−e)ᵏ/(2k+1) instead —
  // this path is hot in R_J, whose duplication sum evaluates RC(1, 1+em)
  // with em → 0.
  const e = (y - x) / x;
  if (Math.abs(e) < 0.01) {
    let sum = 0;
    let term = 1;
    for (let k = 0; k < 10; k++) {
      sum += term / (2 * k + 1);
      term *= -e;
    }
    return sum / Math.sqrt(x);
  }
  const a = Math.sqrt(x / y);
  return x < y
    ? Math.acos(a) / Math.sqrt(y - x)
    : Math.acosh(a) / Math.sqrt(x - y);
}

/** Carlson R_F(x, y, z), machine real. */
export function carlsonRF(x: number, y: number, z: number): number {
  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return NaN;
  if (x < 0 || y < 0 || z < 0) return NaN;
  if ((x === 0 ? 1 : 0) + (y === 0 ? 1 : 0) + (z === 0 ? 1 : 0) > 1)
    return Infinity;
  // Degenerate cases reduce to R_C
  if (y === z) return carlsonRC(x, y);
  if (x === z) return carlsonRC(y, x);
  if (x === y) return carlsonRC(z, x);

  const A0 = (x + y + z) / 3;
  const Q =
    Math.pow(3 * CARLSON_TOL, -1 / 6) *
    Math.max(Math.abs(A0 - x), Math.abs(A0 - y), Math.abs(A0 - z));
  // The correction terms use the ORIGINAL x,y,z — iterate on copies
  let [xm, ym, zm] = [x, y, z];
  let A = A0;
  let pow4 = 1;
  for (let i = 0; i < 64 && pow4 * Q >= Math.abs(A); i++) {
    const sx = Math.sqrt(xm);
    const sy = Math.sqrt(ym);
    const sz = Math.sqrt(zm);
    const lm = sx * sy + sx * sz + sy * sz;
    A = (A + lm) / 4;
    xm = (xm + lm) / 4;
    ym = (ym + lm) / 4;
    zm = (zm + lm) / 4;
    pow4 /= 4;
  }
  // Series correction terms: X = (A0 − x)·4^{−m}/Aₘ (mpmath RF_calc)
  const t = pow4 / A;
  const Xc = (A0 - x) * t;
  const Yc = (A0 - y) * t;
  const Zc = -Xc - Yc;
  const E2 = Xc * Yc - Zc * Zc;
  const E3 = Xc * Yc * Zc;
  return (
    (Math.pow(A, -0.5) *
      (9240 - 924 * E2 + 385 * E2 * E2 + 660 * E3 - 630 * E2 * E3)) /
    9240
  );
}

/**
 * Carlson R_J(x, y, z, p), machine real. For p < 0 returns the Cauchy
 * principal value (DLMF 19.20.14, as in Boost's ellint_rj).
 */
export function carlsonRJ(x: number, y: number, z: number, p: number): number {
  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z) || Number.isNaN(p))
    return NaN;
  if (x < 0 || y < 0 || z < 0) return NaN;
  if (p === 0) return Infinity;
  if ((x === 0 ? 1 : 0) + (y === 0 ? 1 : 0) + (z === 0 ? 1 : 0) > 1)
    return Infinity;

  if (p < 0) {
    // Cauchy principal value, DLMF 19.20.14. Requires x ≤ y ≤ z.
    const [a, b, c] = [x, y, z].sort((u, v) => u - v);
    const q = -p;
    const pn = (c * (a + b + q) - a * b) / (c + q);
    let v = (pn - c) * carlsonRJ(a, b, c, pn);
    v -= 3 * carlsonRF(a, b, c);
    v +=
      3 *
      Math.sqrt((a * b * c) / (a * b + pn * q)) *
      carlsonRC(a * b + pn * q, pn * q);
    return v / (c + q);
  }

  const A0 = (x + y + z + 2 * p) / 5;
  const delta = (p - x) * (p - y) * (p - z);
  const Q =
    Math.pow(0.25 * CARLSON_TOL, -1 / 6) *
    Math.max(
      Math.abs(A0 - x),
      Math.abs(A0 - y),
      Math.abs(A0 - z),
      Math.abs(A0 - p)
    );
  // The correction terms use the ORIGINAL x,y,z — iterate on copies
  let [xm, ym, zm, pm] = [x, y, z, p];
  let A = A0;
  let pow4 = 1;
  let S = 0;
  for (let i = 0; i < 64; i++) {
    const sx = Math.sqrt(xm);
    const sy = Math.sqrt(ym);
    const sz = Math.sqrt(zm);
    const sp = Math.sqrt(pm);
    const lm = sx * sy + sx * sz + sy * sz;
    const A1 = (A + lm) / 4;
    xm = (xm + lm) / 4;
    ym = (ym + lm) / 4;
    zm = (zm + lm) / 4;
    pm = (pm + lm) / 4;
    const dm = (sp + sx) * (sp + sy) * (sp + sz);
    const em = (delta * pow4 * pow4 * pow4) / (dm * dm);
    if (pow4 * Q < Math.abs(A)) break;
    S += (carlsonRC(1, 1 + em) * pow4) / dm;
    pow4 /= 4;
    A = A1;
  }
  const t = pow4 / A;
  const X = (A0 - x) * t;
  const Y = (A0 - y) * t;
  const Z = (A0 - z) * t;
  const P = (-X - Y - Z) / 2;
  const E2 = X * Y + X * Z + Y * Z - 3 * P * P;
  const E3 = X * Y * Z + 2 * E2 * P + 4 * P * P * P;
  const E4 = (2 * X * Y * Z + E2 * P + 3 * P * P * P) * P;
  const E5 = X * Y * Z * P * P;
  const series =
    (24024 -
      5148 * E2 +
      2457 * E2 * E2 +
      4004 * E3 -
      4158 * E2 * E3 -
      3276 * E4 +
      2772 * E5) /
    24024;
  return pow4 * Math.pow(A, -1.5) * series + 6 * S;
}

/** Carlson R_D(x, y, z) = R_J(x, y, z, z), machine real. */
export function carlsonRD(x: number, y: number, z: number): number {
  return carlsonRJ(x, y, z, z);
}

//
// ---------------- Incomplete elliptic integrals (machine real) ----------------
//
// Legendre forms in the Mathematica/parameter convention (second argument
// is the PARAMETER m = k²):
//   F(φ|m) = ∫₀^φ dθ/√(1 − m sin²θ)
//   E(φ|m) = ∫₀^φ √(1 − m sin²θ) dθ
//   Π(n; φ|m) = ∫₀^φ dθ/((1 − n sin²θ)·√(1 − m sin²θ))
// computed through the Carlson forms (DLMF 19.25.5, 19.25.9, 19.25.14),
// with the quasi-periodic extension for |φ| > π/2. When 1 − m sin²φ < 0
// the value is complex: return NaN so `applyN` cascades to the complex
// kernel.
//

/** Incomplete elliptic integral of the first kind F(φ|m). */
export function ellipticF(phi: number, m: number): number {
  if (Number.isNaN(phi) || Number.isNaN(m)) return NaN;
  if (Math.abs(phi) > Math.PI / 2) {
    // F(φ + kπ|m) = F(φ|m) + 2k·K(m)
    const k = Math.round(phi / Math.PI);
    const K = ellipticK(m);
    if (!Number.isFinite(K)) return NaN;
    return 2 * k * K + ellipticF(phi - k * Math.PI, m);
  }
  const s = Math.sin(phi);
  const y = 1 - m * s * s;
  if (y < 0) return NaN; // complex value
  const c = Math.cos(phi);
  return s * carlsonRF(c * c, y, 1);
}

/** Incomplete elliptic integral of the second kind E(φ|m). */
export function ellipticEIncomplete(phi: number, m: number): number {
  if (Number.isNaN(phi) || Number.isNaN(m)) return NaN;
  if (Math.abs(phi) > Math.PI / 2) {
    // E(φ + kπ|m) = E(φ|m) + 2k·E(m)
    const k = Math.round(phi / Math.PI);
    const E = ellipticE(m);
    if (!Number.isFinite(E)) return NaN;
    return 2 * k * E + ellipticEIncomplete(phi - k * Math.PI, m);
  }
  const s = Math.sin(phi);
  const y = 1 - m * s * s;
  if (y < 0) return NaN; // complex value
  const c = Math.cos(phi);
  const s3 = s * s * s;
  return s * carlsonRF(c * c, y, 1) - (m / 3) * s3 * carlsonRD(c * c, y, 1);
}

/** Complete elliptic integral of the third kind Π(n|m). */
export function ellipticPiComplete(n: number, m: number): number {
  if (Number.isNaN(n) || Number.isNaN(m)) return NaN;
  if (n === 1 || m === 1) return Infinity;
  if (m > 1) return NaN; // complex value
  // Π(n|m) = R_F(0, 1−m, 1) + (n/3)·R_J(0, 1−m, 1, 1−n)
  return carlsonRF(0, 1 - m, 1) + (n / 3) * carlsonRJ(0, 1 - m, 1, 1 - n);
}

/** Incomplete elliptic integral of the third kind Π(n; φ|m). */
export function ellipticPiIncomplete(
  n: number,
  phi: number,
  m: number
): number {
  if (Number.isNaN(n) || Number.isNaN(phi) || Number.isNaN(m)) return NaN;
  if (Math.abs(phi) > Math.PI / 2) {
    // Π(n; φ + kπ|m) = Π(n; φ|m) + 2k·Π(n|m)
    const k = Math.round(phi / Math.PI);
    const P = ellipticPiComplete(n, m);
    if (!Number.isFinite(P)) return NaN;
    return 2 * k * P + ellipticPiIncomplete(n, phi - k * Math.PI, m);
  }
  const s = Math.sin(phi);
  const y = 1 - m * s * s;
  if (y < 0) return NaN; // complex value
  const c = Math.cos(phi);
  const s3 = s * s * s;
  // 1 − n sin²φ < 0 → R_J returns the Cauchy principal value; = 0 → pole
  const p = 1 - n * s * s;
  if (p === 0) return Infinity;
  return s * carlsonRF(c * c, y, 1) + (n / 3) * s3 * carlsonRJ(c * c, y, 1, p);
}

//
// ---------------- Hypergeometric functions ----------------
//

function isNonPositiveInteger(x: number): boolean {
  return Number.isInteger(x) && x <= 0;
}

/**
 * The Gauss series Σ (a)ₙ(b)ₙ/((c)ₙ n!)·zⁿ and `big`, the magnitude of its
 * largest term. The sum is NaN when the series has not converged within
 * `maxTerms` terms, unless `polynomial` (the last of `maxTerms` terms is
 * then the last term). A small term ends the sum only from the index
 * `gauss2F1SeriesStart` on, since before it the terms can grow again.
 */
function gauss2F1SeriesBig(
  a: number,
  b: number,
  c: number,
  z: number,
  maxTerms = 10_000,
  polynomial = false
): { sum: number; big: number } {
  const start = gauss2F1SeriesStart(a, b, c, z);
  let term = 1;
  let sum = 1;
  let big = 1;
  for (let n = 0; n < maxTerms; n++) {
    const ratio = ((a + n) * (b + n) * z) / ((c + n) * (n + 1));
    term *= ratio;
    // A term of exactly 0 ends a polynomial (a + n or b + n is 0); any
    // other 0 is an underflow, which ends the sum only from `start` on.
    if (term === 0) {
      const ends = a + n === 0 || b + n === 0 || n >= start;
      return { sum: ends ? sum : NaN, big };
    }
    big = Math.max(big, Math.abs(term));
    sum += term;
    // A small term ends the sum only while the terms decrease: just after
    // n = −c the terms can grow again from a very small value.
    if (
      n >= start &&
      Math.abs(ratio) < 1 &&
      Math.abs(term) <= Number.EPSILON * Math.abs(sum)
    )
      return { sum, big };
  }
  return { sum: polynomial ? sum : NaN, big };
}

// The largest ratio of the largest term to the result that the machine
// ₂F₁ kernel accepts: about 10 correct digits. A result with more
// cancellation is evaluated by `hypergeometric2F1Complex` instead, which
// tries other transformations and returns NaN when none is accurate.
const GAUSS_2F1_MAX_LOSS = 1e6;

// The largest ratio of a part of the connection formula at 1−z to the
// result that the machine ₂F₁ kernel accepts (see `hypergeometric2F1Real`).
const CONNECTION_2F1_MAX_LOSS = 1e3;

/** The Gauss series, or NaN when it did not converge or cancels too much. */
function gauss2F1Series(
  a: number,
  b: number,
  c: number,
  z: number,
  maxTerms = 10_000,
  polynomial = false
): number {
  const { sum, big } = gauss2F1SeriesBig(a, b, c, z, maxTerms, polynomial);
  const scale = sum === 0 ? 1 : Math.abs(sum);
  return big <= GAUSS_2F1_MAX_LOSS * scale ? sum : NaN;
}

/**
 * Gauss hypergeometric function ₂F₁(a, b; c; z) for real arguments and
 * z < 1 (plus the Gauss summation point z = 1 when it converges).
 *
 * - a or b a non-positive integer: terminating polynomial, any z.
 * - z < 0: Pfaff transformation z → z/(z−1).
 * - 0.5 < z < 1: linear connection at 1−z (generic case; for integer
 *   c−a−b falls back to the direct series, which converges for z < 1).
 * - z > 1: on/over the branch cut — complex value, returns NaN (the
 *   complex kernel handles it when applicable).
 */
export function hypergeometric2F1(
  a: number,
  b: number,
  c: number,
  z: number
): number {
  const r = hypergeometric2F1Real(a, b, c, z);
  if (!Number.isNaN(r) || [a, b, c, z].some(Number.isNaN) || z >= 1) return r;
  // The real formulas declined (no convergence, or too much cancellation):
  // the complex kernel tries the other transformations, and its value is
  // real for real parameters and z < 1.
  const v = hypergeometric2F1Complex(
    new Complex(a, 0),
    new Complex(b, 0),
    new Complex(c, 0),
    new Complex(z, 0)
  );
  return v.im === 0 ? v.re : NaN;
}

function hypergeometric2F1Real(
  a: number,
  b: number,
  c: number,
  z: number
): number {
  if ([a, b, c, z].some(Number.isNaN)) return NaN;

  // Terminating cases: a or b ∈ {0, −1, −2, …} → polynomial of degree −a/−b
  const aTerm = isNonPositiveInteger(a) ? -a : Infinity;
  const bTerm = isNonPositiveInteger(b) ? -b : Infinity;
  const nTerms = Math.min(aTerm, bTerm);
  if (isNonPositiveInteger(c)) {
    // Pole at c unless the series terminates before reaching it
    if (nTerms === Infinity || nTerms > -c) return NaN;
  }
  if (nTerms !== Infinity)
    return nTerms > 1_000_000 ? NaN : gauss2F1Series(a, b, c, z, nTerms, true);

  if (z === 0) return 1;
  if (z === 1) {
    // Gauss summation: Γ(c)Γ(c−a−b)/(Γ(c−a)Γ(c−b)), requires c−a−b > 0
    const s = c - a - b;
    if (s <= 0) return s === 0 ? Infinity : NaN;
    return (gamma(c) * gamma(s)) / (gamma(c - a) * gamma(c - b));
  }
  if (z > 1) return NaN; // complex value (branch cut [1, ∞))

  if (z < 0) {
    // Pfaff: ₂F₁(a,b;c;z) = (1−z)^{−a}·₂F₁(a, c−b; c; z/(z−1)), maps z<0 → (0,1)
    return (
      Math.pow(1 - z, -a) * hypergeometric2F1Real(a, c - b, c, z / (z - 1))
    );
  }

  if (z <= 0.5) return gauss2F1Series(a, b, c, z);

  // z ∈ (0.5, 1): connection formula at 1−z (DLMF 15.8.4), generic case
  const s = c - a - b;
  if (Number.isInteger(s)) {
    // Degenerate case (the connection formula needs a logarithmic limit): the
    // direct series still converges for z < 1 (radius of convergence 1), just
    // slowly near 1. The nth term decays ~zⁿ, so ⌈17 / −log10 z⌉ terms reach
    // machine precision; use the series whenever that count is within a bound
    // that keeps rounding accumulation acceptable, and stay symbolic (NaN)
    // beyond it rather than returning a low-precision answer. Extends the
    // former z ≤ 0.95 gate to ~0.999, closing the integer-(c−a−b) gap for
    // z ∈ (0.95, 1) and its Pfaff images z ≲ −19. (NU-P1-2)
    //
    // The count starts where the terms stop growing (`gauss2F1SeriesStart`,
    // about 900 for ₂F₁(102, 1; 2; 0.9)); from twice that index on, the
    // ratio of consecutive terms is at most about (1+z)/2. Counting from
    // n = 0 with the rate z instead stopped ₂F₁(102, 1; 2; 0.9) after
    // about 400 terms, at 1.15e87 instead of 1.10e99.
    if (z < 1) {
      const termsNeeded =
        Math.ceil(2 * gauss2F1SeriesStart(a, b, c, z)) +
        Math.ceil(17 / -Math.log10((1 + z) / 2));
      if (termsNeeded <= 400_000)
        return gauss2F1Series(a, b, c, z, termsNeeded + 10);
    }
    return NaN;
  }
  // The two parts can cancel: the result is NaN (and the complex kernel
  // is tried) when a part is more than CONNECTION_2F1_MAX_LOSS times the
  // result. A part is measured by the larger of its largest term and its
  // sum: when the terms have one sign, the sum is many times the largest
  // term, and the cancellation is between the two sums. The bound is
  // smaller than GAUSS_2F1_MAX_LOSS because the prefactors (Γ of large
  // arguments, (1−z)^s) have relative errors of up to about 100ε, and
  // the cancellation multiplies those errors too.
  const g1 = (gamma(c) * gamma(s)) / (gamma(c - a) * gamma(c - b));
  const g2 =
    ((gamma(c) * gamma(-s)) / (gamma(a) * gamma(b))) * Math.pow(1 - z, s);
  const s1 = gauss2F1SeriesBig(a, b, 1 - s, 1 - z);
  const s2 = gauss2F1SeriesBig(c - a, c - b, 1 + s, 1 - z);
  const value = g1 * s1.sum + g2 * s2.sum;
  const big = Math.max(
    Math.abs(g1) * Math.max(s1.big, Math.abs(s1.sum)),
    Math.abs(g2) * Math.max(s2.big, Math.abs(s2.sum))
  );
  return big <= CONNECTION_2F1_MAX_LOSS * Math.abs(value) ? value : NaN;
}

/** Direct Kummer series Σ (a)ₙ/((b)ₙ n!) zⁿ — converges for all z. */
function kummer1F1Series(
  a: number,
  b: number,
  z: number,
  maxTerms = 20_000
): number {
  let term = 1;
  let sum = 1;
  for (let n = 0; n < maxTerms; n++) {
    term *= ((a + n) * z) / ((b + n) * (n + 1));
    if (term === 0) return sum;
    sum += term;
    if (n > 2 && Math.abs(term) <= Number.EPSILON * Math.abs(sum)) return sum;
  }
  return sum;
}

/**
 * Kummer confluent hypergeometric function ₁F₁(a; b; z) for real arguments.
 * Entire in z; uses the Kummer transformation e^z·₁F₁(b−a; b; −z) for z < 0
 * to avoid catastrophic cancellation in the alternating series.
 */
export function hypergeometric1F1(a: number, b: number, z: number): number {
  if ([a, b, z].some(Number.isNaN)) return NaN;
  const aTerm = isNonPositiveInteger(a) ? -a : Infinity;
  if (isNonPositiveInteger(b)) {
    // Pole at b unless the series terminates before reaching it
    if (aTerm === Infinity || aTerm > -b) return NaN;
  }
  if (aTerm !== Infinity) return kummer1F1Series(a, b, z, aTerm + 1);
  if (z < 0) return Math.exp(z) * hypergeometric1F1(b - a, b, -z);
  return kummer1F1Series(a, b, z);
}

/**
 * Appell hypergeometric function F₁(a; b₁, b₂; c; x, y) by the double
 * Pochhammer series
 *
 *   F₁ = Σₘ Σₙ (a)ₘ₊ₙ (b₁)ₘ (b₂)ₙ / ((c)ₘ₊ₙ m! n!) xᵐ yⁿ
 *
 * Convergence domain |x| < 1 and |y| < 1, except a series that terminates
 * in an index (b₁ or b₂ a non-positive integer) converges for any value of
 * the corresponding variable. Outside the domain returns NaN (the
 * expression stays symbolic).
 */
export function appellF1(
  a: number,
  b1: number,
  b2: number,
  c: number,
  x: number,
  y: number
): number {
  if ([a, b1, b2, c, x, y].some(Number.isNaN)) return NaN;
  if (isNonPositiveInteger(c)) return NaN; // pole (ignoring the terminating nuance)

  const xConverges = Math.abs(x) < 1 || isNonPositiveInteger(b1);
  const yConverges = Math.abs(y) < 1 || isNonPositiveInteger(b2);
  if (!xConverges || !yConverges) return NaN;

  const MAX_ROWS = 10_000;
  const MAX_COLS = 10_000;
  let sum = 0;
  // rowLead = (a)ₘ (b₁)ₘ / ((c)ₘ m!) xᵐ — the n = 0 term of row m
  let rowLead = 1;
  let negligibleRows = 0;
  for (let m = 0; m < MAX_ROWS; m++) {
    // Inner sum over n with term ratio ((a+m+n)(b₂+n) / ((c+m+n)(n+1))) y
    let term = rowLead;
    let rowSum = term;
    for (let n = 0; n < MAX_COLS; n++) {
      term *= ((a + m + n) * (b2 + n) * y) / ((c + m + n) * (n + 1));
      if (term === 0) break; // terminated in n
      rowSum += term;
      if (Math.abs(term) <= Number.EPSILON * (1 + Math.abs(rowSum))) break;
    }
    sum += rowSum;
    if (Math.abs(rowSum) <= Number.EPSILON * (1 + Math.abs(sum))) {
      // Require a few consecutive negligible rows: with alternating signs
      // a single small row does not imply convergence
      if (++negligibleRows >= 3) return sum;
    } else negligibleRows = 0;

    rowLead *= ((a + m) * (b1 + m) * x) / ((c + m) * (m + 1));
    if (rowLead === 0) return sum; // terminated in m
  }
  return sum;
}

function bigIsNonPositiveInteger(x: BigNum): boolean {
  return x.isInteger() && !x.isPositive();
}

/**
 * The first index from which a small term of the Gauss series
 * Σ (a)ₙ(b)ₙ/((c)ₙ n!)·zⁿ (|z| < 1) can end the sum. Before it the terms can
 * shrink and then grow again: a negative c makes them grow near n = −c,
 * and the ratio of consecutive terms, about |z|·(1 + (a+b−c−1)/n) for a
 * large n, is above 1 until n is about |z|·|a+b−c−1|/(1−|z|). For
 * ₂F₁(102, 1; 2; 0.9) the terms grow until n ≈ 900.
 */
function gauss2F1SeriesStart(a: number, b: number, c: number, z: number) {
  const zAbs = Math.abs(z);
  if (!(zAbs < 1)) return Infinity;
  return Math.max(3, -c, (zAbs * Math.abs(a + b - c - 1)) / (1 - zAbs));
}

/**
 * Bignum Gauss series at the current precision; tolerance from precision.
 * Returns NaN when the series has not converged within `maxTerms` terms,
 * unless `polynomial` (the last of `maxTerms` terms is then the last term).
 * When the largest term exceeds the sum by more than 8 digits (the callers
 * add 10 guard digits), the sum is computed again with that many more
 * digits, so that the cancellation does not reach the result; beyond 1000
 * lost digits it is NaN.
 */
function bigGauss2F1Series(
  ce: ComputeEngine,
  a: BigNum,
  b: BigNum,
  c: BigNum,
  z: BigNum,
  maxTerms: number,
  polynomial = false,
  retried = false
): BigNum {
  const tol = new BigDecimal(10).pow(-(BigDecimal.precision + 2));
  const start = gauss2F1SeriesStart(
    a.toNumber(),
    b.toNumber(),
    c.toNumber(),
    z.toNumber()
  );
  let term: BigNum = BigDecimal.ONE;
  let sum: BigNum = BigDecimal.ONE;
  let big: BigNum = BigDecimal.ONE;
  let done = polynomial;
  for (let n = 0; n < maxTerms; n++) {
    if ((n & 0xff) === 0) checkDeadline(ce._deadlineFrame);
    const nn = new BigDecimal(n);
    const previous = term;
    term = term
      .mul(a.add(nn))
      .mul(b.add(nn))
      .mul(z)
      .div(c.add(nn).mul(new BigDecimal(n + 1)));
    if (term.isZero()) {
      done = true;
      break;
    }
    if (term.abs().gt(big)) big = term.abs();
    sum = sum.add(term);
    // A small term ends the sum only while the terms decrease: just after
    // n = −c the terms can grow again from a very small value.
    if (
      n >= start &&
      term.abs().lt(previous.abs()) &&
      term.abs().lt(tol.mul(sum.abs().add(BigDecimal.ONE)))
    ) {
      done = true;
      break;
    }
  }
  if (!done) return BigDecimal.NAN;
  if (!retried && !sum.isZero()) {
    const lost = Math.log10(big.div(sum.abs()).toNumber());
    // More than 1000 lost digits: the sum is not computed.
    if (!(lost <= 1000)) return BigDecimal.NAN;
    if (lost > 8)
      return withExtraPrecision(lost + 2, () =>
        bigGauss2F1Series(ce, a, b, c, z, maxTerms, polynomial, true)
      );
  }
  return sum;
}

/**
 * Bignum ₂F₁(a, b; c; z) for real arguments, z < 1. Same algorithm as the
 * machine kernel; the degenerate integer-c−a−b connection case returns NaN
 * (stays symbolic) rather than computing the logarithmic limit.
 */
export function bigHypergeometric2F1(
  ce: ComputeEngine,
  a: BigNum,
  b: BigNum,
  c: BigNum,
  z: BigNum
): BigNum {
  if (a.isNaN() || b.isNaN() || c.isNaN() || z.isNaN()) return BigDecimal.NAN;

  const p = BigDecimal.precision;
  const guard = 10;
  const maxTerms = Math.max(10_000, 40 * (p + guard));

  const aTerm = bigIsNonPositiveInteger(a) ? -a.toNumber() : Infinity;
  const bTerm = bigIsNonPositiveInteger(b) ? -b.toNumber() : Infinity;
  const nTerms = Math.min(aTerm, bTerm);
  if (bigIsNonPositiveInteger(c)) {
    if (nTerms === Infinity || nTerms > -c.toNumber()) return BigDecimal.NAN;
  }
  if (nTerms !== Infinity && nTerms < maxTerms) {
    return withExtraPrecision(guard, () =>
      bigGauss2F1Series(ce, a, b, c, z, nTerms, true)
    ).toPrecision(p);
  }

  if (z.isZero()) return BigDecimal.ONE;
  const one = BigDecimal.ONE;
  if (z.eq(one)) {
    const s = c.sub(a).sub(b);
    if (!s.isPositive()) return BigDecimal.NAN; // divergent (or pole at s = 0)
    return withExtraPrecision(guard, () =>
      bigGamma(ce, c)
        .mul(bigGamma(ce, s))
        .div(bigGamma(ce, c.sub(a)).mul(bigGamma(ce, c.sub(b))))
    ).toPrecision(p);
  }
  if (z.gt(one)) return BigDecimal.NAN; // complex value

  if (z.isNegative()) {
    // Pfaff: (1−z)^{−a}·₂F₁(a, c−b; c; z/(z−1))
    return withExtraPrecision(guard, () => {
      const oneMinusZ = one.sub(z);
      const factor = a.neg().mul(oneMinusZ.ln()).exp(); // (1−z)^{−a}
      return factor.mul(
        bigHypergeometric2F1(ce, a, c.sub(b), c, z.div(z.sub(one)))
      );
    }).toPrecision(p);
  }

  if (z.lte(BigDecimal.HALF)) {
    return withExtraPrecision(guard, () =>
      bigGauss2F1Series(ce, a, b, c, z, maxTerms)
    ).toPrecision(p);
  }

  // z ∈ (0.5, 1): connection formula at 1−z, generic case
  const s = c.sub(a).sub(b);
  if (s.isInteger()) {
    // Degenerate case (the connection formula needs a logarithmic limit): the
    // direct series still converges for z < 1 (radius 1), just slowly near 1.
    // ⌈(p+guard) / −log10 z⌉ terms reach the working precision; the `guard`
    // digits absorb the summation's rounding accumulation. Use the series when
    // that count is within a bound, else stay symbolic (NaN) rather than
    // return a low-precision answer. Extends the former z ≤ 0.95 gate,
    // closing the integer-(c−a−b) gap for z ∈ (0.95, 1) and its Pfaff images
    // z ≲ −19. (NU-P1-2)
    //
    // The count starts where the terms stop growing (`gauss2F1SeriesStart`,
    // about 900 for ₂F₁(102, 1; 2; 0.9)); from twice that index on, the
    // ratio of consecutive terms is at most about (1+z)/2, which sets the
    // number of further terms. Counting from n = 0 with the rate z instead
    // stopped ₂F₁(102, 1; 2; 0.9) after 1020 terms, at 2.05e98 instead of
    // 1.10e99.
    const zNum = z.toNumber();
    if (zNum < 1) {
      const start = gauss2F1SeriesStart(
        a.toNumber(),
        b.toNumber(),
        c.toNumber(),
        zNum
      );
      const slowMax =
        Math.ceil(2 * start) +
        Math.ceil((p + guard + 2) / -Math.log10((1 + zNum) / 2)) +
        100;
      if (slowMax <= 2_000_000)
        return withExtraPrecision(guard, () =>
          bigGauss2F1Series(ce, a, b, c, z, slowMax)
        ).toPrecision(p);
    }
    return BigDecimal.NAN; // too slow: stays symbolic
  }
  // The two parts t1 and t2 of the connection formula can cancel. The
  // number of digits lost is log10(max(|t1|, |t2|)/|t1 + t2|). When it is
  // more than the guard digits can absorb, the formula is evaluated again
  // with that many more digits; beyond 1000 lost digits the result is NaN.
  const connection = (extra: number): { value: BigNum; lost: number } => {
    let lost = Infinity;
    const value = withExtraPrecision(extra, () => {
      const oneMinusZ = one.sub(z);
      const t1 = bigGamma(ce, c)
        .mul(bigGamma(ce, s))
        .div(bigGamma(ce, c.sub(a)).mul(bigGamma(ce, c.sub(b))))
        .mul(bigGauss2F1Series(ce, a, b, one.sub(s), oneMinusZ, maxTerms));
      const t2 = bigGamma(ce, c)
        .mul(bigGamma(ce, s.neg()))
        .div(bigGamma(ce, a).mul(bigGamma(ce, b)))
        .mul(s.mul(oneMinusZ.ln()).exp()) // (1−z)^s
        .mul(
          bigGauss2F1Series(
            ce,
            c.sub(a),
            c.sub(b),
            one.add(s),
            oneMinusZ,
            maxTerms
          )
        );
      const sum = t1.add(t2);
      const big = t1.abs().gt(t2.abs()) ? t1.abs() : t2.abs();
      if (!sum.isZero()) lost = Math.log10(big.div(sum.abs()).toNumber());
      return sum;
    });
    return { value, lost };
  };
  let r = connection(guard);
  if (r.lost > guard - 2) {
    if (!(r.lost <= 1000)) return BigDecimal.NAN;
    r = connection(guard + r.lost + 2);
  }
  return r.value.toPrecision(p);
}

/** Bignum Kummer series at current precision. */
function bigKummer1F1Series(
  ce: ComputeEngine,
  a: BigNum,
  b: BigNum,
  z: BigNum,
  maxTerms: number
): BigNum {
  const tol = new BigDecimal(10).pow(-(BigDecimal.precision + 2));
  let term: BigNum = BigDecimal.ONE;
  let sum: BigNum = BigDecimal.ONE;
  for (let n = 0; n < maxTerms; n++) {
    if ((n & 0xff) === 0) checkDeadline(ce._deadlineFrame);
    const nn = new BigDecimal(n);
    term = term
      .mul(a.add(nn))
      .mul(z)
      .div(b.add(nn).mul(new BigDecimal(n + 1)));
    if (term.isZero()) return sum;
    sum = sum.add(term);
    if (n > 2 && term.abs().lt(tol.mul(sum.abs().add(BigDecimal.ONE))))
      return sum;
  }
  return sum;
}

/** Bignum ₁F₁(a; b; z) for real arguments. */
export function bigHypergeometric1F1(
  ce: ComputeEngine,
  a: BigNum,
  b: BigNum,
  z: BigNum
): BigNum {
  if (a.isNaN() || b.isNaN() || z.isNaN()) return BigDecimal.NAN;

  const p = BigDecimal.precision;
  const guard = 10;
  const maxTerms = Math.max(20_000, 40 * (p + guard));

  const aTerm = bigIsNonPositiveInteger(a) ? -a.toNumber() : Infinity;
  if (bigIsNonPositiveInteger(b)) {
    if (aTerm === Infinity || aTerm > -b.toNumber()) return BigDecimal.NAN;
  }
  if (aTerm !== Infinity && aTerm < maxTerms) {
    return withExtraPrecision(guard, () =>
      bigKummer1F1Series(ce, a, b, z, aTerm + 1)
    ).toPrecision(p);
  }
  if (z.isNegative()) {
    // Kummer transformation: e^z·₁F₁(b−a; b; −z) — all-positive series
    return withExtraPrecision(guard, () =>
      z.exp().mul(bigHypergeometric1F1(ce, b.sub(a), b, z.neg()))
    ).toPrecision(p);
  }
  return withExtraPrecision(guard, () =>
    bigKummer1F1Series(ce, a, b, z, maxTerms)
  ).toPrecision(p);
}
