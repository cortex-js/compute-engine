import { Complex } from 'complex.js';
import {
  gamma,
  gammaErrorWeight,
  gammaln,
  gaussLegendreRule,
  hurwitzZetaComplexWithError,
  incompleteGammaUpperComplexWithError,
} from './numeric-complex.js';
import { hurwitzZeta, zeta } from './special-functions.js';

// Lerch transcendent Φ(z,s,a) = Σ_{k≥0} zᵏ(k+a)^(−s), in machine floats.
// Measured over random points against mpmath, the values returned are
// within about 1e−11 relative (most within 1e−14); where a method cannot
// vouch for that, it declines (returns `undefined`) instead. For a real a
// the reference is mpmath's `lerchphi`. For a complex a past the unit circle
// it is not: `lerchphi` takes the wrong sheet of the incomplete gamma
// function in part of the a plane (see `closedTermSheet`), so the reference
// there is the Hermite formula of `lerchContinuedComplex` with the sheet
// corrected, evaluated by mpmath at 40 digits and checked against the
// integral (1/Γ(s))·∫₀^∞ t^(s−1)e^(−at)/(1 − z·e^(−t)) dt for Re(s) > 0 and
// against the rule Φ(z,s,a) = Σ_{k<m} zᵏ(a+k)^(−s) + zᵐ·Φ(z,s,a+m).
// Generalizes the Hurwitz zeta (Φ(1,s,a) = ζ(s,a), delegated to
// `hurwitzZetaComplex`) and the polylogarithm (Liₛ(z) = z·Φ(z,s,1), not
// wired up here — a separate widening of `PolyLog`).
//
// |z| < 1: the zᵏ factor gives geometric convergence, so direct summation
// (`lerchSeriesComplex`) reaches double precision unless its terms cancel.
// Real z < 0 with Re(s) > 0 uses the van Wijngaarden Euler transform instead
// (`lerchEulerComplex`): the series
// still converges there, but only conditionally, and stalls on the |z| = 1
// rim — Φ(−1,1,1) = ln 2 needs on the order of 10^17 terms for direct
// summation to reach even single-digit accuracy, where the transform
// reaches double precision in a few dozen. Past the disk, for Re(s) > 0
// and z off the cut, the first terms of the series can give the value with
// a proven bound of the rest (`lerchSeriesOutsideDisk`, at a large order).
// Otherwise |z| ≥ 1 (off z = 1) needs
// analytic continuation past the disk of convergence, by the Hermite-type
// integral representation valid for Re(a) > 0 (`lerchContinuedComplex`).
// Where its terms cancel too far (mostly a large |z|), a real a uses the
// expansion of Φ in the Fourier modes of the base point
// (`lerchModesComplex`); then, for Re(s) > 0, the integral above along a
// path around its pole (`lerchIntegralComplex`); then Lerch's
// transformation formula, which carries the modes by two Lerch
// transcendents of order 1 − s and also applies to a complex a
// (`lerchFunctionalComplex`).

const C_ZERO = new Complex(0, 0);

const C_ONE = new Complex(1, 0);
const C_NAN = new Complex(NaN, NaN);

/**
 * |z|, also for a modulus below 1e−154 or above 1e154. `Complex.abs()`
 * squares the parts when both are below 3000, so it returns 0 for
 * |z| < 1.5e−154: at a large order the terms of Φ and their factors are
 * that small (Γ(−149, x) = 3.2e−260 − 7.5e−260i at z = 7e7 − 7e7i, s = 150,
 * a = 10), and the error estimates then dropped them.
 */
function modulus(z: Complex): number {
  return Math.hypot(z.re, z.im);
}

/**
 * The principal logarithm of z, accurate relative to its own size when z is
 * close to 1. `Complex.log()` takes ln|z| from the modulus, which rounds to
 * a double next to 1: the real part then has an absolute error of about
 * 1e−16, so for |z − 1| = 1e−8 the logarithm has only 8 correct digits, and
 * the continuation raises it to the power s − 1. Here the real part is
 * ½·log1p(|z|² − 1), with |z|² − 1 formed as (x − 1)(x + 1) + y², where
 * x − 1 is exact for x between 1/2 and 2.
 */
function logAccurate(z: Complex): Complex {
  if (!(Math.abs(z.re - 1) + Math.abs(z.im) < 0.5)) return z.log();
  return new Complex(
    0.5 * Math.log1p((z.re - 1) * (z.re + 1) + z.im * z.im),
    Math.atan2(z.im, z.re)
  );
}

/**
 * The largest number of terms the kernels sum one at a time to move a base
 * point a with a negative real part to the right half-plane. Each unit of
 * −Re(a) costs one term, so a base point further left (for example
 * a = −1e20, where adding 1 does not change the double at all) declines
 * instead of looping for that long. The GPU zeta helpers
 * (`_gpu_hurwitz_zeta`, `compilation/gpu-target.ts`) use the same budget.
 */
const MAX_BASE_SHIFT = 1_000_000;

/**
 * The terms zᵏ(k+a)^(−s) for k < n, where n is the smallest count that
 * makes Re(a + n) ≥ `minRe`: Φ(z,s,a) = head + zⁿ·Φ(z,s,a+n). The
 * (k+a) = 0 term (a a non-positive integer) is dropped rather than
 * diverging — the same convention `hurwitzZetaComplex` uses; callers decide
 * pole vs. finite from Re(s) and z (see `evaluateLerchPhi`,
 * `library/arithmetic.ts`). `largest` is the largest term modulus, for the
 * callers' cancellation checks. Returns `undefined` when n exceeds
 * `MAX_BASE_SHIFT`.
 */
function shiftBase(
  z: Complex,
  s: Complex,
  a: Complex,
  minRe: number
): { head: Complex; zn: Complex; b: Complex; largest: number } | undefined {
  const n = Math.max(0, Math.ceil(minRe - a.re));
  if (!(n <= MAX_BASE_SHIFT)) return undefined;
  const negS = s.neg();
  let head = C_ZERO;
  let zn = new Complex(1, 0);
  let largest = 0;
  for (let k = 0; k < n; k++) {
    const b = new Complex(a.re + k, a.im);
    if (!(b.re === 0 && b.im === 0)) {
      const term = zn.mul(b.pow(negS));
      head = head.add(term);
      largest = Math.max(largest, modulus(term));
    }
    zn = zn.mul(z);
  }
  const b = new Complex(a.re + n, a.im);
  // Re(a + n) must reach `minRe`: when a is so large that adding n does not
  // change the double, the shift made no progress.
  if (!(b.re >= minRe)) return undefined;
  return { head, zn, b, largest };
}

/**
 * The relative error a sum can carry when its largest term has modulus
 * `largest`: every term is rounded to about 1e−16 of its size, so a sum much
 * smaller than its terms has lost that many digits. Past `MAX_LOSS` the
 * kernels decline rather than return a value with too few correct digits.
 */
const MAX_LOSS = 1e-12;

/** The relative accuracy every value returned here is within (see the
 * comment at the top of this file). */
const ACCURACY = 1e-11;

/** Added to the error estimates of the continuation, of the modes route
 * and of the series past the disk (`lerchSeriesOutsideDisk`).
 * Their models count the large roundings; below about 1e−14 the many small
 * ones they leave out dominate: on the extended sweeps the actual error was
 * up to 1.7e−14 where the model gave 1.2e−15. */
const ESTIMATE_FLOOR = 128 * Number.EPSILON;

/**
 * Σ_{k≥0} zᵏ(k+a)^(−s) for |z| < 1, by direct summation, capped at 2 million
 * terms. The terms with Re(k+a) ≤ 0 are summed first, unconditionally
 * (`shiftBase`): they need not decrease, so no convergence test applies to
 * them.
 *
 * The rest converges geometrically, but the terms can first grow: for
 * Re(s) < 0 the factor (k+a)^(−s) grows like k^(−Re s) until |z|ᵏ wins. So
 * the sum stops only when three consecutive terms each (1) are smaller than
 * the term before them and (2) bound the tail below 1e−17 of the sum. The
 * tail bound is |term|·ρ/(1−ρ), where ρ is the larger of the current term
 * ratio and |z|: for Re(s) ≤ 0 the ratio decreases toward |z|, and for
 * Re(s) > 0 it increases toward |z|, so ρ bounds every later ratio.
 *
 * Returns `undefined` (the caller falls back to the continuation or keeps
 * the expression symbolic) when:
 * - the cap runs out before the sum converges: |z| close enough to 1 needs
 *   more terms than the cap allows (e.g. |z| = 1 − 1e−10 needs on the order
 *   of 10^11), and summing only part of the series would silently drop the
 *   tail;
 * - the sum is much smaller than its largest term (`MAX_LOSS`), for example
 *   Φ(−0.3, −30, 1), whose terms reach 1e29 and cancel to −7.7e16;
 * - the estimated rounding error of the sum is above `MAX_LOSS` of the
 *   value. The k-th term carries about k + |s|·|log(k + b)| + 4 roundings
 *   of ε: k from the repeated product zᵏ, and |s·log(k + b)| from the
 *   power (k + b)^(−s), whose exponent is rounded. For a large −Re(s) the
 *   largest terms come late (near k = −Re(s)/(−log|z|)), and counting each
 *   term as rounded to 1e−16 only is not enough: Φ(0.969 + 0.129i,
 *   −5.84 − 1.36i, 6.23 + 0.79i) has terms up to about 4e11 around k = 260
 *   and a value of about 8e7, and the sum was off by 2.5e−10 relative.
 */
function lerchSeriesComplex(
  z: Complex,
  s: Complex,
  a: Complex
): Complex | undefined {
  return lerchSeriesWithError(z, s, a)?.value;
}

/** `lerchSeriesComplex` with the estimated relative error of its value: the
 * two rounding estimates it checks against `MAX_LOSS`, added. */
function lerchSeriesWithError(
  z: Complex,
  s: Complex,
  a: Complex
): { value: Complex; error: number } | undefined {
  const shifted = shiftBase(z, s, a, Number.MIN_VALUE);
  if (shifted === undefined) return undefined;
  const { head, zn, b } = shifted;
  const absZ = modulus(z);
  const logAbsZ = Math.log(absZ);
  // The terms decay like |z|ᵏ, after the growth of (k+b)^(−Re s) peaks near
  // k = −Re(s)/(−log|z|) for Re(s) < 0.
  const peak = Math.max(0, -s.re) / -logAbsZ;
  // Twice the count at which |z|ᵏ reaches 1e−17 also covers the ρ/(1−ρ)
  // factor of the tail bound, since 1 − |z| ≥ 1e−17 for any double |z| < 1.
  const maxN = Math.ceil(3 * peak + (2 * Math.log(1e-17)) / logAbsZ) + 64;
  if (!(maxN <= 2_000_000)) return undefined; // more terms than the cap
  const negS = s.neg();
  let sum = C_ZERO;
  let zk = new Complex(1, 0);
  let largest = shifted.largest;
  let previous = Infinity;
  let settled = 0;
  let weighted = 0; // Σ |term|·(number of roundings in the term)
  const absS = modulus(s);
  for (let k = 0; k <= maxN; k++) {
    const base = new Complex(b.re + k, b.im);
    const term = zn.mul(zk).mul(base.pow(negS));
    sum = sum.add(term);
    const size = modulus(term);
    largest = Math.max(largest, size);
    const logBase = Math.hypot(
      Math.log(modulus(base)),
      Math.atan2(b.im, b.re + k)
    );
    weighted += size * (k + absS * logBase + 4);
    const rho = Math.max(size / previous, absZ);
    const total = modulus(sum.add(head));
    // A zero term (zᵏ underflowed) leaves nothing more to add.
    if (
      size === 0 ||
      (size < previous && rho < 1 && (size * rho) / (1 - rho) <= 1e-17 * total)
    ) {
      if (++settled === 3) {
        if (!((1e-16 * largest) / total <= MAX_LOSS)) return undefined;
        if (!((Number.EPSILON * weighted) / total <= MAX_LOSS))
          return undefined;
        return {
          value: head.add(sum),
          error: (1e-16 * largest + Number.EPSILON * weighted) / total,
        };
      }
    } else settled = 0;
    previous = size;
    zk = zk.mul(z);
  }
  return undefined; // never converged — the cap ran out
}

/**
 * Σ_{k≥0} zᵏ(k+a)^(−s) for real z in [−1, 0) and Re(s) > 0, by the van
 * Wijngaarden Euler transform (Numerical Recipes' `eulsum`), carried
 * through the complex terms. The terms with Re(k+a) ≤ 0 are summed first
 * (`shiftBase`), so the transform only sees the base points b + k with
 * Re(b) > 0. Its signed, alternating terms are fed in one at a time; the
 * repeated-averaging table it builds reaches double precision in a few
 * dozen terms where direct summation on the |z| = 1 rim does not converge
 * in any practical number of terms.
 *
 * The transform is valid when the term moduli |z|ᵏ|k+b|^(−s) decrease
 * smoothly, which Re(s) > 0 and Re(b) > 0 ensure. For Re(s) ≤ 0 the terms
 * grow and the transform returns wrong values (Φ(−0.999, −6, 1) gave 0.278
 * for 0.00106), so `lerchPhiComplex` does not call it there.
 *
 * The sum stops when three consecutive increments are below 1e−16 of the
 * sum; when the 512-term cap runs out first, it returns `undefined`.
 */
function lerchEulerComplex(
  zRe: number,
  s: Complex,
  a: Complex
): Complex | undefined {
  const z = new Complex(zRe, 0);
  const shifted = shiftBase(z, s, a, Number.MIN_VALUE);
  if (shifted === undefined) return undefined;
  const { head, zn } = shifted;
  a = shifted.b;
  const negS = s.neg();
  const wr: number[] = [];
  const wi: number[] = [];
  let nterm = 0;
  let sumR = 0;
  let sumI = 0;
  let settled = 0;
  let zPow = 1; // zᵏ (signed: z < 0 makes the terms alternate)
  for (let k = 0; k < 512; k++, zPow *= zRe) {
    const t = new Complex(a.re + k, a.im).pow(negS);
    const curR = zPow * t.re;
    const curI = zPow * t.im;
    let incR: number;
    let incI: number;
    if (k === 0) {
      nterm = 1;
      wr[1] = curR;
      wi[1] = curI;
      incR = 0.5 * curR;
      incI = 0.5 * curI;
    } else {
      let tmpR = wr[1];
      let tmpI = wi[1];
      wr[1] = curR;
      wi[1] = curI;
      for (let j = 1; j <= nterm - 1; j++) {
        const dumR = wr[j + 1];
        const dumI = wi[j + 1];
        wr[j + 1] = 0.5 * (wr[j] + tmpR);
        wi[j + 1] = 0.5 * (wi[j] + tmpI);
        tmpR = dumR;
        tmpI = dumI;
      }
      wr[nterm + 1] = 0.5 * (wr[nterm] + tmpR);
      wi[nterm + 1] = 0.5 * (wi[nterm] + tmpI);
      if (
        Math.hypot(wr[nterm + 1], wi[nterm + 1]) <=
        Math.hypot(wr[nterm], wi[nterm])
      ) {
        nterm++;
        incR = 0.5 * wr[nterm];
        incI = 0.5 * wi[nterm];
      } else {
        incR = wr[nterm + 1];
        incI = wi[nterm + 1];
      }
    }
    sumR += incR;
    sumI += incI;
    if (k > 4 && Math.hypot(incR, incI) <= 1e-16 * Math.hypot(sumR, sumI)) {
      if (++settled === 3) {
        const out = head.add(zn.mul(new Complex(sumR, sumI)));
        if (!((1e-16 * shifted.largest) / modulus(out) <= MAX_LOSS))
          return undefined;
        return out;
      }
    } else settled = 0;
  }
  return undefined; // never converged — the cap ran out
}

/** 20-point Gauss-Legendre nodes and weights on [−1, 1], for `hermiteTail`'s
 * integral, which has no closed form. */
const GAUSS = gaussLegendreRule(20);

/** 10-point Gauss-Legendre nodes and weights on [−1, 1]: `hermiteTail`
 * compares its sum on each panel with the 20-point one to estimate the
 * quadrature error. */
const GAUSS_CHECK = gaussLegendreRule(10);

/** The end of the Hermite integral's range: the integrand decays at least
 * like e^{−πt}. The integral usually stops much earlier, where a bound of
 * the remaining part is negligible (see `hermiteTail`). */
const T_MAX = 40;
const PANELS = 80;

/** The largest change, in radians, that the logarithm of the Hermite
 * integrand is allowed to have across one panel of the 20-point rule
 * (`hermiteTail` subdivides a panel until this holds). For e^{iωt} on a
 * panel with ω·width = 12, the 20-point rule is in error by about 1e−29 of
 * the integrand size; at 26 the error is 1e−16 and at 32 it is 1e−13. The
 * margin covers the change of the frequency inside the panel. */
const PANEL_PHASE = 12;

/** The most panels of the 20-point rule that `hermiteTail` uses (20
 * evaluations of the integrand each). The largest |z| of a double needs
 * 840 at z = −1.7e308, where the integrand decays slowest, and 420 at
 * z = 1.7e308; more come only from a large |s|/Re(a) in addition. An
 * integral that needs more is not computed, and the continuation
 * declines. */
const MAX_TAIL_PANELS = 1000;

/**
 * −2∫₀^∞ sin(t·log z − s·arctan(t/a)) / ((a²+t²)^(s/2)(e^{2πt} − 1)) dt —
 * the part of the Hermite integral representation with no closed form (see
 * `lerchContinuedComplex`) — and an estimate of the absolute rounding error
 * of the sum. For Re(s) < 0 the factor (a²+t²)^(−s/2) grows like t^(−Re s)
 * before e^{−2πt} wins, and the sine grows like e^{|Im log z|·t}: the
 * integrand is then far larger than the integral (1e12 times at
 * s = −19.5, z = −942, a = 1), and each node carries a rounding error of
 * about ε·(|phase| + |s·log(a²+t²)|/2 + 6) of its size (the sine and the
 * power have rounded arguments). The estimate is the sum of these over the
 * nodes.
 *
 * The integrand oscillates: it is the difference of z^{it}·(a + it)^(−s)
 * and z^{−it}·(a − it)^(−s), divided by 2i(e^{2πt} − 1), so the derivative
 * of its logarithm has a modulus of at most ω = |log z| + |s|/|a ± it| + 2π.
 * At a large |z| or a large |s|/Re(a), ω is large: at z = 1e100 (|log z| =
 * 230) a panel of width 1/2 holds 18 periods, and the 20-point rule, which
 * follows a polynomial of degree 39, gave −0.665 for the integral
 * −0.4952 (s = 20.25, a = 1). Each panel of width 1/2 is therefore cut into
 * equal parts so that ω times the width of a part is at most `PANEL_PHASE`,
 * with ω bounded on the panel by the smallest |a ± it| there. More than
 * `MAX_TAIL_PANELS` parts in total make the function return NaN with an
 * infinite error estimate.
 *
 * The integral stops at the start t of a panel when the part from t to ∞ is
 * bounded below 1e−20 of the sum of the node sizes so far (that sum also
 * sets the rounding estimate, which is at least 2.6e−15 of it, so the
 * dropped part is not significant). The bound: |sin w| ≤ e^{|Im w|}, so the
 * integrand is at most E(t) = e^{|Im phase|}·|(a²+t²)^(−s/2)|/(e^{2πt} − 1).
 * The derivative of ln E is at most r(t) = |Im log z| − 2π + (the growth
 * rate of the phase's imaginary part and of the power), see `tailRate`. When
 * r(t) < 0 and r does not increase after t, the integral from t to ∞ is at
 * most E(t)/(−r(t)). This bound is added to `quadrature`. At t = 40 the
 * bound is added too; where it does not exist there (r ≥ 0), `quadrature`
 * is infinite.
 *
 * `quadrature` is also an estimate of the absolute error of the 20-point
 * rule where the integrand has singularities close to the real axis: the
 * sum over the panels of |S₂₀ − S₁₀|, where S₁₀ is the 10-point sum on the
 * same panel. The integrand has branch points at t = ±i·a, which come
 * near the real axis when Re(a) is small, and then the rule converges
 * slowly on the panels next to them. The difference is the error of the
 * 10-point sum, which is larger than that of the 20-point one, so the
 * estimate is pessimistic. It costs 10 more evaluations per panel, and it
 * runs only for Re(a) < 1 (`checkQuadrature`).
 */
function hermiteTail(
  logZ: Complex,
  s: Complex,
  a: Complex
): { value: Complex; rounding: number; quadrature: number } {
  const halfS = s.mul(0.5);
  const a2 = a.mul(a);
  const integrand = (t: number) => {
    const phase = logZ.mul(t).sub(s.mul(new Complex(t, 0).div(a).atan()));
    const base = a2.add(new Complex(t * t, 0));
    const power = base.pow(halfS);
    const denom = power.mul(Math.expm1(2 * Math.PI * t));
    return { value: phase.sin().div(denom), phase, base, power };
  };
  // E(t) / (−r(t)), the bound of the integral from t to ∞ (see above), or
  // Infinity where it does not apply.
  const remainder = (t: number): number => {
    const rate = tailRate(logZ, s, a, t);
    if (!(rate < 0)) return Infinity;
    const { phase, power } = integrand(t);
    const envelope =
      Math.exp(Math.abs(phase.im)) /
      (modulus(power) * Math.expm1(2 * Math.PI * t));
    return envelope / -rate;
  };
  let sum = C_ZERO;
  let rounding = 0;
  let quadrature = 0;
  let magnitude = 0; // the sum of the node sizes |term|
  let parts = 0;
  // The 10-point check runs only when the branch points are close to the
  // real axis: with Re(a) ≥ 1/2 no panel showed a quadrature error above
  // 1e−13 of the integrand size on 2400 points, and the callers move a to
  // Re(a) ≥ 1 first, so the check costs the common case nothing.
  const checkQuadrature = a.re < 1;
  const halfSAbs = modulus(halfS);
  const logZAbs = modulus(logZ);
  const sAbs = modulus(s);
  const aImAbs = Math.abs(a.im);
  const h = T_MAX / PANELS;
  let truncated = false;
  for (let p = 0; p < PANELS; p++) {
    const t0 = h * p;
    if (p > 0) {
      const rest = remainder(t0);
      if (rest <= 1e-20 * magnitude) {
        quadrature += rest;
        truncated = true;
        break;
      }
    }
    // |a ± it|² = Re(a)² + (Im(a) ± t)², smallest on the panel where
    // |t − |Im a|| is smallest.
    const gap = Math.max(0, t0 - aImAbs, aImAbs - t0 - h);
    const omega = logZAbs + sAbs / Math.hypot(a.re, gap) + 2 * Math.PI;
    const k = Math.max(1, Math.ceil((omega * h) / PANEL_PHASE));
    parts += k;
    if (!(parts <= MAX_TAIL_PANELS))
      return { value: C_NAN, rounding: Infinity, quadrature: Infinity };
    const w = h / k;
    for (let j = 0; j < k; j++) {
      const start = t0 + j * w;
      let panel = C_ZERO;
      for (let i = 0; i < GAUSS.x.length; i++) {
        const t = start + w * (0.5 + 0.5 * GAUSS.x[i]);
        const { value, phase, base } = integrand(t);
        const term = value.mul(0.5 * w * GAUSS.w[i]);
        panel = panel.add(term);
        const size = modulus(term);
        magnitude += size;
        // |log(a²+t²)| ≤ |ln|a²+t²|| + π.
        rounding +=
          size *
          (modulus(phase) +
            halfSAbs * (Math.abs(Math.log(modulus(base))) + Math.PI) +
            6);
      }
      sum = sum.add(panel);
      if (checkQuadrature) {
        let check = C_ZERO;
        for (let i = 0; i < GAUSS_CHECK.x.length; i++) {
          const t = start + w * (0.5 + 0.5 * GAUSS_CHECK.x[i]);
          check = check.add(integrand(t).value.mul(0.5 * w * GAUSS_CHECK.w[i]));
        }
        quadrature += modulus(panel.sub(check));
      }
    }
  }
  if (!truncated) quadrature += remainder(T_MAX);
  return {
    value: sum.mul(-2),
    rounding: 2 * Number.EPSILON * rounding,
    quadrature: 2 * quadrature,
  };
}

/**
 * An upper bound, valid for every u ≥ t, of the derivative of ln E(u),
 * where E(u) = e^{|Im φ(u)|}·|(a²+u²)^(−s/2)|/(e^{2πu} − 1) bounds the
 * Hermite integrand and φ(u) = u·log z − s·arctan(u/a) (see
 * `hermiteTail`). The three parts:
 * - d/du of −ln(e^{2πu} − 1) is at most −2π;
 * - d/du of |Im φ| is at most |Im log z| + |Im(s·a/(a²+u²))|;
 * - d/du of ln|(a²+u²)^(−s/2)| is −Re(s·u/(a²+u²)).
 * For a real a, the last two are at most |Im s|·a/(a²+u²) and
 * max(0, −Re s)·u/(a²+u²); both decrease for u ≥ t once t ≥ a, and
 * u/(a²+u²) is at most 1/(2a) everywhere. For a complex a, both together
 * are at most |s|·(|a| + u)/|a²+u²|, where |a²+u²| = |a + iu|·|a − iu|.
 * One of the two factors is at least |Im a| + u and the other at least
 * Re(a), so the quotient is at most |s|·(|a| + u)/((|Im a| + u)·Re(a)),
 * which decreases in u. For v = u − |Im a| ≥ 0 the factors are also at
 * least √(Re(a)² + v²) each, so the quotient is at most
 * |s|·(2|a| + v)/(Re(a)² + v²), which decreases for v ≥ Re(a). The
 * smaller of the two bounds is used.
 */
function tailRate(logZ: Complex, s: Complex, a: Complex, t: number): number {
  const base = Math.abs(logZ.im) - 2 * Math.PI;
  if (a.im === 0) {
    const sq = a.re * a.re + t * t;
    const growth = t >= a.re ? t / sq : 1 / (2 * a.re);
    return base + (Math.abs(s.im) * a.re) / sq + Math.max(0, -s.re) * growth;
  }
  const sAbs = modulus(s);
  const aAbs = modulus(a);
  const aImAbs = Math.abs(a.im);
  let growth = (sAbs * (aAbs + t)) / ((aImAbs + t) * a.re);
  const v = t - aImAbs;
  if (v >= a.re)
    growth = Math.min(growth, (sAbs * (2 * aAbs + v)) / (a.re * a.re + v * v));
  return base + growth;
}

/** The relative error to count for a value of the incomplete gamma kernel:
 * 1.5 times the kernel's estimate for that point
 * (`incompleteGammaUpperComplexWithError`). The estimate is that of the
 * series or of the continued fraction the kernel used, or its worst-case
 * bound (3e−13 for |σ| up to about 11, growing with |σ| as the error of Γ(σ)
 * does) where it has no estimate. On 17400 points the actual error was at
 * most 1.11 times the estimate (0.95 times for |Im σ| ≤ 10), and the
 * estimate itself is usually well above the actual error (35 times at the
 * point below), so the factor 1.5 is a margin. A value whose closed term is
 * hundreds of times larger than Φ needs this estimate: the bound times the
 * term would exceed `ACCURACY` although the actual error is far smaller
 * (Φ(−2, −3.5, 1.5): the closed term is 390 times the value, the kernel's
 * estimate 9.9e−15, its bound 3e−13, and the error of Φ 6.9e−13). */
function incompleteGammaError(estimate: number): number {
  return 1.5 * estimate;
}

/**
 * The sheet of Γ(σ, ·) that the closed term of `lerchContinuedComplex`
 * takes at x = (−log z)·b. The term comes from ∫₀^∞ zᵗ(b+t)^(−s) dt, which
 * is analytic in b for Re(b) > 0; it equals z^(−b)·(−log z)^(s−1)·Γ(σ, x)
 * with Γ(σ, ·) continued along the path of x as b turns from a real value.
 * So the argument of x is θ = arg(−log z) + arg(b), with arg(−log z) in
 * (−π, π] (π for a real z > 1, the side below the cut) and arg(b) in
 * (−π/2, π/2); θ ranges over (−3π/2, 3π/2). When θ is outside (−π, π], the
 * principal value Γ(σ, x) is on the wrong sheet, and the right one is
 * Γ(σ, x·e^{2πim}) with m = ±1. Returns m, the number of turns between θ
 * and the argument of x as the double x carries it (its signed zero on the
 * negative real axis selects the lip the kernel uses), so that a point with
 * x on the negative real axis is continuous with its neighbours on the side
 * that θ prescribes. A real z > 1 with a real b keeps m = 0, the upper lip.
 *
 * Without this, a complex a past the unit circle got a wrong value in part
 * of the a plane (mpmath's `lerchphi` takes the same wrong sheet): at
 * z = 14.7 + 1.16i, s = 2.5, a = 1.38 − 0.86i the value is
 * −0.30682033481323 − 0.3213449667627i (the integral
 * (1/Γ(s))·∫₀^∞ t^(s−1)e^(−at)/(1 − z·e^(−t)) dt), where the principal
 * sheet gives −0.0567043432649653 + 0.256281182506831i.
 */
function closedTermSheet(negLogZ: Complex, b: Complex, x: Complex): number {
  const theta = Math.atan2(negLogZ.im, negLogZ.re) + Math.atan2(b.im, b.re);
  return Math.round((theta - Math.atan2(x.im, x.re)) / (2 * Math.PI));
}

/** The relative error of `gamma(x)` in units of ε, for the Γ(1 − s)
 * factor of the modes and functional routes and the Γ(s) of the integral.
 * `gammaErrorWeight` bounds the
 * error for every complex argument; for a real argument from 1/2 to 140 the
 * error is much smaller, and this returns 2·(8 + x·ln(x + 8)) there (1254ε
 * against 232ε at x = 29.8). Measured against mpmath on 8340 real arguments
 * from 1/2 to 170: the error was at most 1.04 times 8 + x·ln(x + 8) up to
 * x = 140, and up to 1.9 times above, where `gamma` switches to its
 * logarithmic form (1390ε at x = 145), so larger arguments keep
 * `gammaErrorWeight`. */
function gammaWeight(x: Complex): number {
  if (x.im === 0 && x.re >= 0.5 && x.re <= 140)
    return 2 * (8 + x.re * Math.log(x.re + 8));
  return gammaErrorWeight(x);
}

/** 1/Γ(s) for a complex s, and its relative error in units of ε: 1/Γ(s)
 * for Re(s) ≥ 1/2, and sin(πs)·Γ(1 − s)/π (the reflection formula) below,
 * which is finite at the poles of Γ(s) and vanishes there. The sine has an
 * argument rounded to about ε·π|s|, an absolute error of about
 * ε·π|s|·cosh(π·Im s) that the weight counts relative to the result. */
function reciprocalGammaWithError(s: Complex): {
  value: Complex;
  weight: number;
} {
  if (s.re >= 0.5) {
    return {
      value: new Complex(1, 0).div(gamma(s)),
      weight: gammaErrorWeight(s) + 2,
    };
  }
  const oneMinusS = new Complex(1, 0).sub(s);
  const sine = s.mul(Math.PI).sin();
  const value = sine.mul(gamma(oneMinusS)).div(Math.PI);
  const sineError =
    (Math.PI * modulus(s) * Math.cosh(Math.PI * s.im)) / modulus(sine);
  return {
    value,
    weight:
      gammaErrorWeight(oneMinusS) +
      4 +
      (Number.isFinite(sineError) ? sineError : 1e300),
  };
}

/**
 * Φ(z,s,a) past |z| = 1 (and on the rim itself, where direct summation is
 * only conditionally convergent), by the Hermite-type integral
 * representation valid for Re(a) > 0 (the one the mpmath documentation
 * gives; mpmath's `lerchphi` evaluates its closed term on the principal
 * sheet, which is wrong for a complex a in part of the plane, see
 * `closedTermSheet`):
 *
 *   Φ(z,s,a) = 1/(2aˢ) + ∫₀^∞ zᵗ(a+t)^(−s) dt
 *              − 2∫₀^∞ sin(t·log z − s·arctan(t/a)) / ((a²+t²)^(s/2)(e^{2πt} − 1)) dt.
 *
 * The first integral is closed: z^(−a)(−log z)^(s−1)Γ(1−s,−a·log z), the
 * upper incomplete gamma's continuation carrying Φ past the unit circle,
 * with Γ(1−s, ·) on the sheet that makes it analytic in a
 * (`closedTermSheet`). The tail integral and 1/(2aˢ) are analytic in a for
 * Re(a) > 0 as they stand.
 * The second converges for every z off the cut, since |sin(t·log z)| grows
 * at most like e^{πt} against e^{2πt}. Other a are brought to Re(a) ≥ 1 by
 * Φ(z,s,a) = a^(−s) + z·Φ(z,s,a+1), dropping a (a+k) = 0 term as the series
 * does (`shiftBase`).
 *
 * Declines (returns `undefined`) when −Re(a) is too large for the shift
 * (`MAX_BASE_SHIFT`), when `incompleteGammaUpperComplex` declines (returns
 * NaN: for the σ = 1 − s used here, mostly when |Im s| > 10), or when the
 * terms cancel so far that their rounding errors, or the incomplete gamma's
 * estimated error (`incompleteGammaError`) times the size of the closed
 * term, exceed what the value can carry — never a wrong number.
 */
function lerchContinuedComplex(
  z: Complex,
  s: Complex,
  a: Complex,
  minRe = 1
): Complex | undefined {
  const r = lerchContinuedWithError(z, s, a, minRe);
  return r !== undefined && r.error <= ACCURACY ? r.value : undefined;
}

/** `lerchContinuedComplex` with the estimated relative error of its value.
 * `undefined` where it declines whatever the accuracy asked for: the
 * incomplete gamma kernel declines, the shift of a is too long, the value
 * is not finite, or the rounding errors of the terms exceed `MAX_LOSS`.
 * Measured on 12975 points past the unit circle (Re(s) from −30 to 8,
 * |z| up to 1e7, real and complex a, references from mpmath at 60 to 250
 * digits and, for a complex a, with the right sheet), the actual error was
 * at most 0.37 times this estimate, and none of the 12949 points whose
 * estimate passes is off by more than 9.1e−13. Before the rounding of the
 * tail integral was counted (see `hermiteTail`), values off by up to 4.2e−5
 * passed (Re(s) below −14, |z| above 90). The estimate also counts the
 * quadrature error of the tail integral (`hermiteTail`'s `quadrature`).
 * Those points did not include a large order or a very large |z|: there
 * the tail integral oscillates faster than its panels followed, and parts
 * of the closed term are outside the range of a double, and values with no
 * correct digit passed (Φ(1e100, 20.25, 1) was −0.170 for −1.29e−71). Measured
 * again after the fixes (see `hermiteTail` and the closed term below), on
 * 10920 points past the unit circle with orders from −20 to 200 (complex
 * ones with |Im s| ≤ 1.5 included), a ∈ {1/2, 1, 5/2, 10} and |z| up to
 * 1e300 (references: the integral that `lerchSeriesOutsideDisk` bounds,
 * continued to Re(s) ≤ 0 by integration by parts, evaluated by mpmath at
 * 25 to 100 digits), the 6213 points whose estimate passes are within
 * 8.8e−13, and the actual error is at most 0.42 times the estimate. */
function lerchContinuedWithError(
  z: Complex,
  s: Complex,
  a: Complex,
  minRe = 1
): { value: Complex; error: number } | undefined {
  // Shift a to Re(a) ≥ minRe: Φ(a) = Σ_{k<m} zᵏ(a+k)^(−s) + zᵐΦ(a+m).
  const shifted = shiftBase(z, s, a, minRe);
  if (shifted === undefined) return undefined;
  const { head, zn: zk, b } = shifted;
  const logZ = logAccurate(z);
  // On the cut (real z > 1) Φ takes the side below it, z − i0, as mpmath
  // and Wolfram do: −log z must sit on the upper lip (+0i), where
  // `incompleteGammaUpperComplex`'s branch has its x < 0. Negating a real
  // log would give −0i and put the power on the other side of its cut.
  const negLogZ =
    z.im === 0 && z.re > 1 ? new Complex(-logZ.re, 0) : logZ.mul(-1);
  const x = negLogZ.mul(b);
  const sigma = new Complex(1, 0).sub(s);
  const { value: upper, error: upperError } =
    incompleteGammaUpperComplexWithError(sigma, x);
  // NaN: the kernel cannot vouch for about 12 digits here, so neither can Φ.
  if (upper.isNaN() || !upper.isFinite()) return undefined;
  // The closed term must be the analytic continuation in b of its value at
  // a real b: see `closedTermSheet`. On another sheet,
  //   Γ(σ, x·e^{2πim}) = e^{2πimσ}·Γ(σ, x) + (1 − e^{2πimσ})·Γ(σ),
  // and (1 − e^{2πimσ})·Γ(σ) = −2πi·m·e^{iπmσ}/Γ(s) (reflection formula),
  // which is entire in s.
  const m = closedTermSheet(negLogZ, b, x);
  let rotated = upper; // e^{2πimσ}·Γ(σ, x)
  let correction = C_ZERO; // (1 − e^{2πimσ})·Γ(σ)
  let correctionError = 0; // its absolute error, in units of ε
  if (m !== 0) {
    rotated = sigma
      .mul(new Complex(0, 2 * Math.PI * m))
      .exp()
      .mul(upper);
    const r = reciprocalGammaWithError(s);
    const turn = sigma.mul(new Complex(0, Math.PI * m)).exp();
    correction = new Complex(0, -2 * Math.PI * m).mul(turn).mul(r.value);
    // The exponential has an argument rounded to about ε·π|σ|.
    correctionError =
      (r.weight + Math.PI * modulus(sigma) + 6) * modulus(correction);
  }
  // The prefactor e^x·(−log z)^(s−1), as one exponential divided by 2^k.
  // Each factor, and the prefactor itself, can be outside the range of a
  // double where the closed term is not: at z = 1.0001, s = 85.5, a = 10,
  // (−log z)^(s−1) is 1e−338, which is 0 as a double, and Γ(σ, x) is
  // 1e253, so the closed term was 0 instead of 3.7e−87 and the value was
  // 12% off. `unscale` multiplies by 2^k in two steps, so that a
  // product that fits in a double is not lost to an overflow of 2^k.
  // Subtracting k·ln 2 adds a rounding of about ε·|Re(log of the
  // prefactor)|, which `closedLoss` below counts already.
  const sm1 = s.sub(new Complex(1, 0));
  const logPrefactor = x.add(negLogZ.log().mul(sm1));
  const k = Math.round(logPrefactor.re / Math.LN2);
  const prefactorScaled = logPrefactor.sub(new Complex(k * Math.LN2, 0)).exp();
  const kHalf = Math.trunc(k / 2);
  const unscale = (v: number) => v * 2 ** kHalf * 2 ** (k - kHalf);
  const prefactorAbs = (factor: number) =>
    unscale(modulus(prefactorScaled) * factor);
  const closedScaled = prefactorScaled.mul(rotated.add(correction));
  const closed = new Complex(
    unscale(closedScaled.re),
    unscale(closedScaled.im)
  );
  // The size the closed term is computed from: its two parts can cancel.
  const closedSize = prefactorAbs(
    Math.max(modulus(rotated), modulus(correction))
  );
  const tail = hermiteTail(logZ, s, b);
  // No bound of the tail integral's error (too many panels, or no bound of
  // the part past t = 40): decline.
  if (!Number.isFinite(tail.quadrature)) return undefined;
  const terms = [new Complex(0.5, 0).div(b.pow(s)), closed, tail.value];
  const phi = terms.reduce((acc, t) => acc.add(t), C_ZERO);
  const out = head.add(zk.mul(phi));
  // The terms can cancel far below their size (Φ(−0.999,−6,1) ≈ 1e−3 from
  // terms of order 0.5, and the closed one also of order 0.3): each carries a rounding error of about 1e−15 of
  // its size (ten times the double precision, as a margin), and when that
  // relative error of the value exceeds `MAX_LOSS`, decline. The closed
  // term also carries the incomplete gamma's own error, whose estimate
  // (`incompleteGammaError`) already has its own margin, and the errors of
  // its prefactor (below), so those parts are checked, together with the
  // rounding error, against the stated accuracy `ACCURACY` instead.
  // The terms added to move a count by the largest of them, as in the
  // series routes, not by their sum, which can be much smaller when they
  // cancel.
  const size = Math.max(
    shifted.largest,
    modulus(zk) * Math.max(...terms.map((t) => modulus(t)), closedSize)
  );
  const rounding = (1e-15 * size) / modulus(out);
  // Γ(σ, x) and 1/Γ(s) can be below the smallest normal double, 2^−1022
  // (Γ(−199, −46.1 − 7.85i) = −3.3e−315 + 2.1e−315i at z = −1e8,
  // s = 200, a = 2.5): they then have fewer significant digits than the
  // kernels' estimates assume, and the value was 2e−11 off. The incomplete
  // gamma kernel forms its result from one exponential and a few products,
  // so a result below 2^−1022 is in error by a few units of the smallest
  // double, 2^−1074; this counts 2^−1068 (64 units). 1/Γ(s) is 0 when Γ(s)
  // overflows, an absolute error of up to 2^−1022. Both are multiplied by
  // the factors that multiply them in the closed term: Γ(σ, x) by
  // |e^{2πimσ}| = e^{−2πm·Im σ}, and 1/Γ(s) by |−2πi·m·e^{iπmσ}| =
  // 2π|m|·e^{−πm·Im σ}. These factors can overflow (to Infinity, or NaN
  // after the prefactor scale), and the function then declines below.
  const underflow =
    2 ** -1068 * Math.exp(-2 * Math.PI * m * sigma.im) +
    (m !== 0
      ? 2 ** -1022 *
        2 *
        Math.PI *
        Math.abs(m) *
        Math.exp(-Math.PI * m * sigma.im)
      : 0);
  const gammaLoss =
    (modulus(zk) *
      prefactorAbs(
        incompleteGammaError(upperError) * modulus(rotated) +
          Number.EPSILON * correctionError +
          underflow
      )) /
    modulus(out);
  // The closed term has errors of its own beyond a few roundings: e^x and
  // (−log z)^(s−1) are exponentials of rounded arguments, with errors of
  // about ε·|x| and ε·|(s − 1)·log(−log z)| relative to the term, and x
  // itself is rounded, which moves Γ(1 − s, x) by about
  // ε·|x|·|x^(−s)·e^{−x}| (its derivative is −x^(−s)·e^{−x}), so the term
  // by ε·|x|·|(−log z)^(s−1)·x^(−s)| (times |e^{2πimσ}| on another sheet).
  const closedLoss =
    (Number.EPSILON *
      modulus(zk) *
      ((modulus(x) + modulus(sm1) * modulus(negLogZ.log()) + 4) * closedSize +
        modulus(x) *
          Math.exp(
            sm1.mul(negLogZ.log()).re -
              s.mul(x.log()).re -
              2 * Math.PI * m * sigma.im
          ))) /
    modulus(out);
  // The tail integral's own rounding (see `hermiteTail`): its integrand can
  // be far larger than the integral for Re(s) < 0.
  const tailLoss = (modulus(zk) * tail.rounding) / modulus(out);
  // The quadrature error of the tail integral (see `hermiteTail`).
  const quadratureLoss = (modulus(zk) * tail.quadrature) / modulus(out);
  if (!out.isFinite() || !(rounding + tailLoss <= MAX_LOSS)) return undefined;
  // An error that is not a finite number cannot be compared with another
  // estimate (callers keep the smaller one): decline.
  if (!Number.isFinite(gammaLoss)) return undefined;
  return {
    value: out,
    error:
      rounding +
      tailLoss +
      quadratureLoss +
      closedLoss +
      gammaLoss +
      ESTIMATE_FLOOR,
  };
}

/** The modes n with |n| ≤ N are summed one by one in `lerchModesComplex`,
 * with N chosen so that |log z|/(2π(N + 1)) ≤ this ratio: the series in
 * powers of log z that carries the other modes then converges like 4^(−k). */
const MODES_RATIO = 0.25;

/** At most this many explicit modes on each side: |log z| up to about 100
 * (|z| up to about e^100). Past that the tails of the other modes cost too
 * many terms, and `lerchModesComplex` declines. */
const MODES_MAX = 64;

/** For σ = 1 − s + k with Re σ at least this, the part of ζ(1 − σ, b)
 * that the explicit modes leave out is summed directly (its terms fall like
 * n^(−σ)); below it, it is `hurwitzZetaComplex` minus the explicit modes.
 * On 1000 points with 30 ≤ |z| ≤ 1000, the thresholds 6, 8 and 10 let the
 * route answer 901, 897 and 866 of them (4: 902); 8 needs at most about
 * 180(N + 1) terms per power of log z. */
const MODES_DIRECT_ORDER = 8;

/**
 * The error of `hurwitzZetaComplexWithError(o, b)`, in units of ε, relative
 * to the larger of |ζ| and its envelope 2|Γ(σ)|(2π)^(−Re σ)cosh(π·Im σ/2)
 * (σ = 1 − o), for the orders the modes route asks for (0 < b ≤ 1);
 * `undefined` above |Im o| = 20, where it is not measured. Measured against
 * mpmath on 18 500 orders with real part from −8 to 13, |Im o| up to 20
 * and 0.001 ≤ b ≤ 1 (b log-uniform on half of the points), with the kernel
 * of 2026-09-30 (the routes for |Im o| ≥ 2 chosen by an error estimate):
 * at most 52ε for |Im o| < 7 and 88ε from 7 to 20, and at most 0.43 times
 * this weight. The kernel's own estimate is relative to |ζ| and is not a
 * bound for a real order (up to 28 times too small where |ζ| is far below
 * the envelope), so the modes route counts both. The kernel before that
 * change was up to 4e6ε off for 0 ≤ Re(o) < 1/2 and |Im o| ≥ 5, which
 * this weight then excluded.
 */
function hurwitzKernelWeight(o: Complex): number | undefined {
  const im = Math.abs(o.im);
  if (im > 20) return undefined;
  return 100 + 20 * Math.abs(o.re) + 5 * im;
}

/**
 * Φ(z,s,a) for a real a, from the expansion of Φ in the Fourier modes of
 * the base point (the Hurwitz formula of the Hurwitz zeta function, carried
 * over to Φ): for 0 < b ≤ 1 and Re(s) < 0,
 *
 *   Φ(z,s,b) = Γ(1−s)·z^(−b)·Σ_{n∈ℤ} e^{2πinb}·(2πin − log z)^(s−1).
 *
 * The modes with |n| ≤ N are summed one by one. Expanding each of the others
 * in powers of log z and summing over n gives, with σ = 1 − s + k,
 *
 *   Σ_{|n|>N} … = Σ_{k≥0} (log z)^k/k! · ζ_N(s − k, b),
 *   ζ_N(1 − σ, b) = 2Γ(σ)(2π)^(−σ) Σ_{n>N} cos(πσ/2 − 2πnb)·n^(−σ),
 *
 * the Hurwitz zeta function ζ(1 − σ, b) without its first N Fourier modes.
 * With N = 0 this is Erdélyi's expansion of Φ in powers of log z; with more
 * modes it converges for every z, like (|log z|/(2π(N + 1)))^k, and it
 * holds for every s that is not a positive integer by analytic
 * continuation: the sum over n alone converges only for Re(s) < 0 (its
 * terms fall like |n|^(Re(s)−1)), but the ζ_N of the other modes are
 * continued in s by `hurwitzZetaComplex`, so for Re(s) ≥ 0 only the finite
 * sum of the explicit modes is summed directly. Next to a positive integer
 * s, Γ(1 − s) and one ζ_N are large and cancel, and the estimate counts
 * it. Other real a are brought to (0, 1] by
 * Φ(z,s,a) = a^(−s) + z·Φ(z,s,a+1) (a (a+k) = 0 term dropped, as
 * `shiftBase` does) or by Φ(z,s,a) = z^(−1)·(Φ(z,s,a−1) − (a−1)^(−s)).
 * On the cut (real z > 1) the n = 0 mode takes (−log z + 0i)^(s−1), the side
 * below the cut, as `lerchContinuedComplex` does.
 *
 * This route has none of the cancellation of the continuation for Re(s) < 0
 * and a large |z|, where the three terms of the continuation are up to 1e5
 * times the value, or for Re(s) ≥ 1/2 and |z| above about 1000, where the
 * tail integral of the continuation cancels. It is used where the
 * continuation declines. For a large Re(s) and a very large |z| (Re(s) ≳ 5,
 * |z| ≳ 1e4) the explicit modes and the other modes cancel to up to 1e−5 of
 * themselves, and it declines; the integral (`lerchIntegralComplex`) takes
 * those. It does not apply to a complex a: e^{2πinb} then grows in one
 * direction of n and the sum of the modes diverges
 * (`lerchFunctionalComplex` takes that case).
 *
 * Declines (returns `undefined`) when it needs more than `MODES_MAX`
 * explicit modes, or when its estimated error, which counts the error of
 * Γ(1 − s) (`gammaWeight`), the roundings of each mode and each term,
 * the error of `hurwitzZetaComplex` (see `hurwitzKernelWeight`) and the terms
 * added to move a, is above
 * `ACCURACY` (the largest term added to move a also against `MAX_LOSS`).
 * Measured on 9058 points past the unit circle with a real a and
 * Re(s) < 1/2 (Re(s) down to −30, |z| up to 1e7, a from −8 to 30;
 * references from mpmath at up to 250 digits, since `lerchphi` at 60 digits
 * is wrong for |z| near 1e6), whether or not the continuation answers there:
 * the actual error was at most 0.26 times this estimate, and the 9056
 * points whose estimate passes are all within 6.3e−13. With Re(s) ≥ 1/2
 * (added 2026-09-30), on the 16 point sets of `lerchFunctionalComplex`
 * (among them 3000 points with Re(s) from 1/2 to 12, |z| up to 1e7 and a
 * from −8 to 30, references from mpmath `lerchphi` at 60 and 150 digits,
 * which agree): no answered value off by more than 7.2e−13, and the actual
 * error at most 0.44 times the estimate (at |Im s| = 7.3, where the careful
 * pass answers; below 0.31 elsewhere).
 */
function lerchModesComplex(
  z: Complex,
  s: Complex,
  a: Complex
): Complex | undefined {
  const r = lerchModesWithError(z, s, a);
  return r !== undefined && r.error <= ACCURACY ? r.value : undefined;
}

/** `lerchModesComplex` with the estimated relative error of its value;
 * `undefined` where it declines whatever the accuracy asked for (a complex
 * a, too many modes, a value that is not finite, or terms added to move a
 * that cancel beyond `MAX_LOSS`). It first takes the terms
 * with a small σ from `hurwitzZetaComplex` minus the explicit modes, and
 * where that is not accurate enough, from the Lerch transcendent on the unit
 * circle (`modesTailOnCircle`), which costs two continuations per term. */
function lerchModesWithError(
  z: Complex,
  s: Complex,
  a: Complex
): { value: Complex; error: number } | undefined {
  const quick = lerchModesWith(z, s, a, false);
  if (quick !== undefined && quick.error <= ACCURACY) return quick;
  // The quick pass also declines where the Hurwitz zeta kernel is not
  // accurate enough (`hurwitzKernelWeight`): the careful pass does not use
  // the kernel for those terms.
  const careful = lerchModesWith(z, s, a, true);
  if (careful === undefined) return quick;
  if (quick === undefined) return careful;
  return careful.error < quick.error ? careful : quick;
}

/**
 * Σ_{n>N} cos(πσ/2 − 2πnb)·n^(−σ) for real 0 < b ≤ 1, from two values of
 * the Lerch transcendent on the unit circle, w = e^{2πib}:
 *
 *   ½·(e^{iπσ/2}·w^(−(N+1))·Φ(w̄, σ, N+1) + e^{−iπσ/2}·w^(N+1)·Φ(w, σ, N+1)),
 *
 * each from the continuation (`lerchContinuedWithError`, with its error
 * estimate). Where w is within 1e−3 of 1 the continuation loses digits next
 * to its branch point, and `undefined` is returned; at w = 1 the value is
 * cos(πσ/2)·ζ(σ, N + 1). Returns the sum and an estimate of its absolute
 * error.
 */
function modesTailOnCircle(
  sigma: Complex,
  b: number,
  N: number
): { value: Complex; error: number } | undefined {
  const base = new Complex(N + 1, 0);
  const halfTurn = sigma.mul(new Complex(0, Math.PI / 2)).exp(); // e^{iπσ/2}
  if (b === 1) {
    // `hurwitzZetaComplexWithError` declines (`undefined`) where it cannot
    // vouch for its value; so does this.
    const zeta = hurwitzZetaComplexWithError(sigma, base);
    if (zeta === undefined || zeta.value.isNaN()) return undefined;
    const cos = halfTurn.add(C_ONE.div(halfTurn)).mul(0.5);
    const value = cos.mul(zeta.value);
    return {
      value,
      error:
        modulus(cos) * (64 * Number.EPSILON * modulus(zeta.value) + zeta.error),
    };
  }
  const phase = 2 * Math.PI * b;
  if (Math.hypot(Math.cos(phase) - 1, Math.sin(phase)) < 1e-3) return undefined;
  const w = new Complex(Math.cos(phase), Math.sin(phase));
  const up = lerchContinuedWithError(w, sigma, base);
  const down = lerchContinuedWithError(w.conjugate(), sigma, base);
  if (up === undefined || down === undefined) return undefined;
  const turn = 2 * Math.PI * (((N + 1) * b) % 1);
  const wN = new Complex(Math.cos(turn), Math.sin(turn)); // w^(N+1)
  const first = halfTurn.mul(wN.conjugate()).mul(down.value);
  const second = wN.mul(up.value).div(halfTurn);
  const value = first.add(second).mul(0.5);
  const error =
    0.5 *
    (modulus(first) * (down.error + 8 * Number.EPSILON) +
      modulus(second) * (up.error + 8 * Number.EPSILON));
  return { value, error };
}

function lerchModesWith(
  z: Complex,
  s: Complex,
  a: Complex,
  onCircle: boolean
): { value: Complex; error: number } | undefined {
  if (a.im !== 0) return undefined;
  const eps = Number.EPSILON;
  const one = new Complex(1, 0);
  const negS = s.neg();
  // Move a to 0 < b ≤ 1: Φ(z,s,a) = head + scale·Φ(z,s,b).
  let b = a.re;
  let head = C_ZERO;
  let headLargest = 0;
  // Each term added to move a is a power with a rounded exponent, about
  // ε·|s|·|log b| of its size, times a power of z (one rounding per step).
  let headError = 0;
  const absS = modulus(s);
  let scale = one;
  let steps = 0;
  while (b <= 0) {
    if (b !== 0) {
      const t = scale.mul(new Complex(b, 0).pow(negS));
      head = head.add(t);
      headLargest = Math.max(headLargest, modulus(t));
      headError +=
        modulus(t) * (absS * (Math.abs(Math.log(-b)) + Math.PI) + steps + 4);
    }
    scale = scale.mul(z);
    b += 1;
    if (++steps > MAX_BASE_SHIFT) return undefined;
  }
  while (b > 1) {
    b -= 1;
    scale = scale.div(z);
    const t = scale.mul(new Complex(b, 0).pow(negS)).neg();
    head = head.add(t);
    headLargest = Math.max(headLargest, modulus(t));
    headError += modulus(t) * (absS * Math.abs(Math.log(b)) + steps + 4);
    if (++steps > MAX_BASE_SHIFT) return undefined;
  }

  const logZ = logAccurate(z);
  const negLogZ =
    z.im === 0 && z.re > 1 ? new Complex(-logZ.re, 0) : logZ.mul(-1);
  const absLog = modulus(logZ);
  const N = Math.max(1, Math.ceil(absLog / (2 * Math.PI * MODES_RATIO)) - 1);
  if (N > MODES_MAX) return undefined;
  const sm1 = s.sub(one);
  const g = gamma(one.sub(s));
  // At a large order Γ(1 − s) is below the smallest normal double, 2^−1022
  // (|Γ(−174.25)| is about 1e−317), and has fewer significant digits than
  // `gammaWeight` counts: Φ(−1.485 − 0.212i, 175.25, 1) was 8e−9 off with
  // an estimate of 9e−12. Decline there (2^−1000 leaves a margin).
  if (!(modulus(g) >= 2 ** -1000)) return undefined;
  const gw = gammaWeight(one.sub(s));

  // The explicit modes |n| ≤ N (without the factor Γ(1 − s)).
  let modes = negLogZ.pow(sm1);
  let modesAbs = modulus(modes);
  for (let n = 1; n <= N; n++) {
    const phase = 2 * Math.PI * ((n * b) % 1);
    const e = new Complex(Math.cos(phase), Math.sin(phase));
    const up = new Complex(-logZ.re, 2 * Math.PI * n - logZ.im).pow(sm1).mul(e);
    const down = new Complex(-logZ.re, -2 * Math.PI * n - logZ.im)
      .pow(sm1)
      .mul(e.conjugate());
    modes = modes.add(up).add(down);
    modesAbs += modulus(up) + modulus(down);
  }
  const explicit = g.mul(modes);
  // Each mode is a power with an exponent rounded to about ε·|s − 1|·|log u|.
  let error =
    eps *
    (gw * modulus(explicit) +
      (8 +
        modulus(sm1) * (Math.log(2 * Math.PI * (N + 1) + absLog) + Math.PI)) *
        modulus(g) *
        modesAbs);

  // The other modes: Σ_k (log z)^k/k!·ζ_N(s − k, b). R = Γ(σ)(2π)^(−σ),
  // σ = 1 − s + k, is carried from one k to the next.
  let tail = C_ZERO;
  let power = one; // (log z)^k/k!
  let R = g.mul(new Complex(2 * Math.PI, 0).pow(sm1));
  let small = 0;
  for (let k = 0; k < 500; k++) {
    if (k > 0) {
      power = power.mul(logZ).div(k);
      R = R.mul(new Complex(k, 0).sub(s)).div(2 * Math.PI);
    }
    const sigma = new Complex(1 + k, 0).sub(s);
    const quarter = sigma.mul(Math.PI / 2);
    const rounding =
      gw + 4 * k + 10 + 2 * modulus(sigma) * (1 + Math.log(N + 1));
    let zetaN: Complex;
    let tailOnCircle: { value: Complex; error: number } | undefined;
    if (sigma.re >= MODES_DIRECT_ORDER) {
      // Σ_{n>N} cos(πσ/2 − 2πnb)·n^(−σ), to 1e−18 of its first term.
      let sum = C_ZERO;
      let sumAbs = 0;
      const last = (N + 1) * Math.pow(10, 18 / sigma.re);
      for (let n = N + 1; n <= last; n++) {
        const t = quarter
          .sub(new Complex(2 * Math.PI * ((n * b) % 1), 0))
          .cos()
          .mul(new Complex(n, 0).pow(sigma.neg()));
        sum = sum.add(t);
        sumAbs += modulus(t);
      }
      zetaN = R.mul(sum).mul(2);
      error += eps * rounding * 2 * modulus(R) * sumAbs * modulus(power);
    } else if (onCircle && (tailOnCircle = modesTailOnCircle(sigma, b, N))) {
      zetaN = R.mul(tailOnCircle.value).mul(2);
      error +=
        (2 * modulus(R) * tailOnCircle.error +
          eps * rounding * modulus(zetaN)) *
        modulus(power);
    } else {
      // The Hurwitz zeta kernel is used only where its error is measured.
      const kernelWeight = hurwitzKernelWeight(s.sub(new Complex(k, 0)));
      if (kernelWeight === undefined) return undefined;
      // The kernel declines (`undefined`, or NaN) where its own estimate
      // is above 1e−12 of its value; the route then declines too.
      const kernel = hurwitzZetaComplexWithError(
        s.sub(new Complex(k, 0)),
        new Complex(b, 0)
      );
      if (kernel === undefined || kernel.value.isNaN()) return undefined;
      const full = kernel.value;
      let first = C_ZERO;
      for (let n = 1; n <= N; n++)
        first = first.add(
          quarter
            .sub(new Complex(2 * Math.PI * ((n * b) % 1), 0))
            .cos()
            .mul(new Complex(n, 0).pow(sigma.neg()))
        );
      first = R.mul(first).mul(2);
      zetaN = full.sub(first);
      const envelope =
        2 * modulus(R) * Math.cosh((Math.PI * Math.abs(sigma.im)) / 2);
      // The measured weight (relative to the envelope) and the kernel's own
      // estimate, which is relative to the value and is not a bound for a
      // real order (up to 28 times too small there), are both counted.
      error +=
        (eps *
          (kernelWeight * Math.max(modulus(full), envelope) +
            rounding * modulus(first)) +
          kernel.error) *
        modulus(power);
    }
    const t = zetaN.mul(power);
    tail = tail.add(t);
    error += 4 * eps * modulus(t);
    // The terms fall like k^(−Re s)·4^(−k) once k is past −Re(s).
    if (k > 2 - s.re && modulus(t) < 1e-17 * modulus(explicit.add(tail))) {
      if (++small === 2) break;
    } else small = 0;
  }
  const inner = explicit.add(tail);
  const main = scale.mul(logZ.mul(-b).exp()).mul(inner);
  const out = head.add(main);
  // z^(−b): an exponential with an argument rounded to about ε·b·|log z|.
  const relative =
    (error / modulus(inner) + eps * (b * absLog + 4)) *
    (modulus(main) / modulus(out));
  const headLoss =
    Math.max(1e-15 * headLargest, Number.EPSILON * headError) / modulus(out);
  // Only the largest term is checked against `MAX_LOSS`; the rounding
  // model of the terms (`headError`) is counted in the estimate, which is
  // checked against `ACCURACY`. A very negative s makes the exponents of the
  // powers large, and the model then exceeded `MAX_LOSS` where the values
  // were within 6e−13: 5 points with Re(s) < −9 and |z| ≥ 1000 of the
  // extended real sweep declined only for that.
  if (!out.isFinite() || !((1e-15 * headLargest) / modulus(out) <= MAX_LOSS))
    return undefined;
  return { value: out, error: relative + headLoss + ESTIMATE_FLOOR };
}

/** `lerchIntegralWithError` where its estimate is within `ACCURACY`. */
function lerchIntegralComplex(
  z: Complex,
  s: Complex,
  a: Complex
): Complex | undefined {
  const r = lerchIntegralWithError(z, s, a);
  return r !== undefined && r.error <= ACCURACY ? r.value : undefined;
}

/** The most panels `lerchIntegralWithError` integrates over. */
const INTEGRAL_MAX_PANELS = 600;

/**
 * Φ(z,s,a) for Re(s) > 0 and |z| ≥ e from the integral
 *
 *   Φ(z,s,a) = (1/Γ(s))·∫₀^∞ t^(s−1)·e^(−at)/(1 − z·e^(−t)) dt,
 *
 * valid for Re(a) > 0 and z off the cut [1, ∞); a is first moved to
 * Re(a) ≥ 1/2 as `shiftBase` does. The integrand has poles at
 * t = log z + 2πik. The one with k = 0 is at a distance |arg z| from the
 * real axis, so the path of integration leaves the real axis around
 * t = ln|z|, on the side away from that pole, by 1 (or less when ln|z| is
 * small): t = x + i·H·(1 − u²)² with u = (x − ln|z|)/R, |u| < 1. On the cut
 * (a real z > 1) Φ takes the side below it, the limit of a pole below the
 * real axis, so the path goes above it. The other poles are at least
 * 2π − |arg z| ≥ π from the real axis and stay on their side of the path.
 * From 0 to t₁ = min(1, ln|z|/4) the integrand is t^(s−1) times the power
 * series of e^(−at)/(1 − z·e^(−t)), whose radius |log z| is at least 4·t₁,
 * integrated term by term; beyond t₁, 20-point Gauss–Legendre on panels.
 *
 * Its terms are of the size of the value: where |z| is large, the
 * integrand is about −t^(s−1)·e^((1−a)t)/z up to t = ln|z|, with none of
 * the 1/(2aˢ) term of the continuation, which cancels to about 1/|z| of
 * itself there. The dispatcher uses it where the continuation and the
 * modes decline, and `lerchFunctionalComplex` for its inner values of
 * order 1 − s at a large |v|.
 *
 * The estimated error counts, for each node, ε times the size of its
 * contribution times the size of the rounded exponents
 * (|s − 1|·|log t| + |a·t| + |t| + 8) and the cancellation in
 * 1 − z·e^(−t) next to the pole; the quadrature error of each panel as the
 * difference of its 20-point and 10-point sums; the rounding of the
 * recurrence for the power series coefficients, propagated linearly; and
 * the error of Γ(s) (`gammaWeight`). Declines (returns `undefined`) when
 * the panels run out before the integrand is negligible, or when the value
 * is not finite. Measured on the 16 point sets of `lerchFunctionalComplex`
 * (calling this route directly): 6669 answered, none off by more than
 * 4.4e−13, and the actual error at most 0.31 times the estimate. It is
 * the route that answers a real a with Re(s) from about 5 to 12 and |z|
 * from 1e4 to 1e7, where the modes cancel: on 1000 points with Re(s) from
 * 1/2 to 12 and |z| from 1000 to 1e7 it answers 996.
 */
function lerchIntegralWithError(
  z: Complex,
  s: Complex,
  a: Complex
): { value: Complex; error: number } | undefined {
  if (!(s.re > 0)) return undefined;
  const logZ = logAccurate(z);
  const x0 = logZ.re;
  if (!(x0 >= 1)) return undefined;
  const shifted = shiftBase(z, s, a, 0.5);
  if (shifted === undefined) return undefined;
  const { head, zn, b } = shifted;
  const eps = Number.EPSILON;
  const one = C_ONE;
  const sm1 = s.sub(one);
  const absSm1 = modulus(sm1);
  const absB = modulus(b);

  // [0, t₁]: Σ_k g_k·t₁^(s+k)/(s+k), with g = e^(−bt)/(1 − z·e^(−t)) =
  // Σ g_k t^k from g·h = e, h = 1 − z·e^(−t), e = e^(−bt).
  // |b|·t₁ ≤ 2 keeps the series of e^(−bt) from growing to e^(|b|·t₁)
  // before it cancels.
  const t1 = Math.min(1, x0 / 4, 2 / absB);
  const h0 = one.sub(z);
  const absH0 = modulus(h0);
  const g: Complex[] = [];
  const gError: number[] = []; // absolute error of each g_k
  let eK = one; // (−b)^k/k!
  let zK = z.neg(); // the coefficient of t^k in −z·e^(−t): −z·(−1)^k/k!
  const hK: Complex[] = [];
  let series = C_ZERO;
  let seriesError = 0;
  const logT1 = Math.log(t1);
  for (let k = 0; k < 80; k++) {
    if (k > 0) {
      eK = eK.mul(b.neg()).div(k);
      zK = zK.neg().div(k);
      hK[k] = zK; // h_k for k ≥ 1
    }
    let num = eK;
    let size = modulus(eK);
    let propagated = 0;
    for (let j = 1; j <= k; j++) {
      const p = hK[j].mul(g[k - j]);
      num = num.sub(p);
      size += modulus(p);
      propagated += modulus(hK[j]) * gError[k - j];
    }
    const gk = num.div(h0);
    g.push(gk);
    gError.push((eps * (k + 4) * size + propagated) / absH0);
    // t₁^(s+k)/(s+k)
    const sk = s.add(new Complex(k, 0));
    const w = sk.mul(logT1).exp().div(sk);
    const term = gk.mul(w);
    series = series.add(term);
    seriesError +=
      modulus(w) * gError[k] +
      eps * modulus(term) * (modulus(sk) * Math.abs(logT1) + 4);
    if (k > 4 && modulus(term) < 1e-18 * modulus(series)) break;
    if (k === 79) return undefined;
  }

  // [t₁, ∞): panels along the path.
  const onCut = z.im === 0 && z.re > 1;
  const deform = onCut || Math.abs(logZ.im) < 1;
  const R = Math.min(1.5, 0.9 * (x0 - t1));
  const H = !deform ? 0 : (onCut ? 1 : -Math.sign(logZ.im)) * Math.min(1, R);
  const integrand = (x: number) => {
    const u = (x - x0) / R;
    const inBump = H !== 0 && Math.abs(u) < 1;
    const bump = inBump ? (1 - u * u) * (1 - u * u) : 0;
    const t = new Complex(x, H * bump);
    const dt = inBump ? new Complex(1, (H * -4 * u * (1 - u * u)) / R) : one;
    const numerator = sm1.mul(t.log()).sub(b.mul(t)).exp();
    const ze = z.mul(t.neg().exp());
    const denominator = one.sub(ze);
    const value = numerator.div(denominator).mul(dt);
    const weight =
      absSm1 * Math.abs(modulus(t.log())) +
      absB * modulus(t) +
      modulus(t) +
      8 +
      ((modulus(t) + 2) * modulus(ze)) / modulus(denominator);
    return { value, weight };
  };
  // Panel widths: 1/4 around the pole, else up to 2, and short enough for
  // the oscillation of e^(−i·Im(b)·t) and t^(i·Im(s)).
  const oscillation = Math.abs(b.im) + Math.abs(s.im) + 1;
  const peak = Math.max(0, sm1.re) / Math.max(b.re, 0.5);
  let x = t1;
  let quadrature = C_ZERO;
  let rounding = 0;
  let quadratureError = 0;
  let absSum = 0;
  let small = 0;
  for (let p = 0; ; p++) {
    if (p >= INTEGRAL_MAX_PANELS) return undefined;
    // Around the pole, 12 panels across the bump; elsewhere up to 2, short
    // enough for the oscillation, and ending where the bump starts.
    const inside = x >= x0 - R - 1e-12 && x < x0 + R - 1e-12;
    let width = inside
      ? R / 6
      : Math.min(2, Math.max(0.5, x / 8), 8 / oscillation);
    if (x < x0 - R - 1e-12) width = Math.min(width, x0 - R - x);
    // Next to t = 0, where t^(s−1) is not smooth, no wider than the
    // distance to 0.
    if (!inside) width = Math.min(width, x);
    let panel = C_ZERO;
    let panelAbs = 0;
    for (let i = 0; i < GAUSS.x.length; i++) {
      const xi = x + 0.5 * width * (1 + GAUSS.x[i]);
      const { value, weight } = integrand(xi);
      const term = value.mul(0.5 * width * GAUSS.w[i]);
      panel = panel.add(term);
      panelAbs += modulus(term);
      rounding += modulus(term) * weight;
    }
    let check = C_ZERO;
    for (let i = 0; i < GAUSS_CHECK.x.length; i++) {
      const xi = x + 0.5 * width * (1 + GAUSS_CHECK.x[i]);
      check = check.add(
        integrand(xi).value.mul(0.5 * width * GAUSS_CHECK.w[i])
      );
    }
    quadratureError += modulus(panel.sub(check));
    quadrature = quadrature.add(panel);
    absSum += panelAbs;
    x += width;
    // Past the pole and the peak of t^(s−1)·e^(−bt), the integrand
    // decreases: stop when three panels in a row are below 1e−18 of the sum.
    if (x > x0 + R && x > peak && panelAbs < 1e-18 * absSum) {
      if (++small === 3) break;
    } else small = 0;
  }
  const integral = series.add(quadrature);
  const absIntegral = modulus(integral);
  const gammaS = gamma(s);
  const phiB = integral.div(gammaS);
  const out = head.add(zn.mul(phiB));
  const relativeIntegral =
    (seriesError + eps * rounding + quadratureError) / absIntegral +
    eps * gammaWeight(s);
  const headLoss = (1e-15 * shifted.largest) / modulus(out);
  if (!out.isFinite() || !(headLoss <= MAX_LOSS)) return undefined;
  return {
    value: out,
    error:
      (relativeIntegral * modulus(zn.mul(phiB))) / modulus(out) +
      headLoss +
      ESTIMATE_FLOOR,
  };
}

/**
 * Φ(z,s,a) past the unit circle from Lerch's transformation formula, for a
 * real or complex a. It is the expansion of `lerchModesComplex` with every
 * mode other than n = 0 carried by two Lerch transcendents of order 1 − s:
 * with L = log z, μ = L/(2πi), v = e^{2πib} and b = a moved to
 * 0 ≤ Re(b) ≤ 1 (see below),
 *
 *   Φ(z,s,b) = Γ(1−s)·z^(−b)·[(−L)^(s−1)
 *     + (2π)^(s−1)·(e^{iπ(s−1)/2}·v·Φ(v, 1−s, 1−μ)
 *                   + e^{−iπ(s−1)/2}·v^(−1)·Φ(v^(−1), 1−s, 1+μ))].
 *
 * The two sums Σ_{n≥1} e^{±2πinb}(±2πin − L)^(s−1) of the modes route are
 * these Lerch transcendents: ±2πin − L = ±2πi(n ∓ μ), and for |z| > 1 the
 * powers split into principal powers because n ∓ μ is in the right
 * half-plane with Im(n ∓ μ) of the sign that keeps the argument of
 * ±i(n ∓ μ) inside (−π, π]. For a real b both v and v^(−1) are on the unit
 * circle. For b = y·i + Re(b) with y ≠ 0 one of them is outside it, where
 * the modes route diverges; this formula takes that one by analytic
 * continuation, which is analytic in b as long as v and v^(−1) stay off the
 * cut [1, ∞) of Φ, that is, for 0 < Re(b) < 1. At Re(b) = 0 or 1 the value
 * is the limit from inside the strip: for y > 0, b is taken with
 * 0 ≤ Re(b) < 1, so that v^(−1) is on the lower lip of the cut, and for
 * y < 0 with 0 < Re(b) ≤ 1, so that v is on the lower lip, the side the
 * continuation takes for a real argument above 1. Checked with mpmath at 40
 * digits against the Hermite formula with the corrected sheet (see the
 * comment at the top of this file) on 12 random points with Re(s) from −30
 * to 0.4 and |Im b| up to 4: all agree to 5e−33 or better.
 *
 * The three parts are close to the value in size: in those checks the
 * largest part was at most 6 times the value (for a real b, up to about 3
 * times), so the formula has none of the cancellation of the continuation
 * where Re(s) < 0 and |z| is large (for a real b next to 0 or 1 the two
 * Lerch terms can cancel far, and the estimate declines). Φ at order 1 − s
 * is taken by the direct series inside the unit circle and outside it by
 * the continuation, the integral or the continuation with the base moved
 * further right, whichever estimates best (see `inner` below). Where the
 * argument is far outside the circle (|v| = e^{2π|Im b|}), the terms of the
 * continuation are about |v| times the value, and the integral is then the
 * accurate one.
 *
 * Measured on 16 point sets with 21 703 points past the unit circle (real
 * and complex a and s, Re(s) from −30 to 12, |z| up to 1e7; the references
 * as in the comment at the top of this file, and for a real a mpmath
 * `lerchphi` at up to 250 digits), calling this route directly: 14 662
 * answered, none off by more than 1.1e−12, and the actual error at most
 * 0.44 times the estimate (at |Im s| = 7.3; below 0.33 elsewhere).
 *
 * Other a are brought to that strip by Φ(z,s,a) = a^(−s) + z·Φ(z,s,a+1)
 * or Φ(z,s,a) = z^(−1)·(Φ(z,s,a−1) − (a−1)^(−s)), as `lerchModesComplex`
 * does. Declines (returns `undefined`) at a positive integer s (a pole of
 * Γ(1 − s) that cancels in the sum), when v or v^(−1) is within 1e−3 of the
 * branch point 1 (a real a next to an integer, or a small |Im a| with Re(a)
 * next to an integer), when an inner value declines, when the terms added to
 * move a cancel beyond `MAX_LOSS`, or when the value is not finite. The
 * estimated error counts the errors of the inner values, the roundings of
 * the powers and exponentials (with exponents rounded to about ε times their
 * size), the error of Γ(1 − s) (`gammaWeight`), and the change of each
 * inner value when its argument v is rounded: ∂Φ(w,σ,c)/∂log w is
 * Φ(w,σ−1,c) − c·Φ(w,σ,c), which this counts as (|c| + |σ| + 2) times |Φ|,
 * plus (|σ − 1| + 1)/|log w| times |Φ| for the growth of Φ next to w = 1.
 * Like the modes route, it checks only the largest term added to move a
 * against `MAX_LOSS`, and counts their rounding in the estimate.
 */
function lerchFunctionalComplex(
  z: Complex,
  s: Complex,
  a: Complex
): Complex | undefined {
  const r = lerchFunctionalWithError(z, s, a);
  return r !== undefined && r.error <= ACCURACY ? r.value : undefined;
}

/** `lerchFunctionalComplex` with the estimated relative error of its value
 * (see there); `undefined` where it declines whatever the accuracy asked
 * for. */
function lerchFunctionalWithError(
  z: Complex,
  s: Complex,
  a: Complex
): { value: Complex; error: number } | undefined {
  if (!(modulus(z) > 1)) return undefined;
  if (s.im === 0 && s.re > 0 && Number.isInteger(s.re)) return undefined;
  const eps = Number.EPSILON;
  const one = C_ONE;
  const negS = s.neg();
  const absS = modulus(s);
  // Move a into the strip: Φ(z,s,a) = head + scale·Φ(z,s,b).
  const upper = a.im > 0; // 0 ≤ Re(b) < 1; otherwise 0 < Re(b) ≤ 1
  const below = (re: number) => (upper ? re < 0 : re <= 0);
  const above = (re: number) => (upper ? re >= 1 : re > 1);
  let b = a;
  let head = C_ZERO;
  let headLargest = 0;
  // Each term is a power with an exponent rounded to about ε·|s|·|log b|,
  // times a power of z (one rounding per step).
  let headError = 0;
  let scale = one;
  let steps = 0;
  while (below(b.re)) {
    if (!(b.re === 0 && b.im === 0)) {
      const t = scale.mul(b.pow(negS));
      head = head.add(t);
      headLargest = Math.max(headLargest, modulus(t));
      headError +=
        modulus(t) *
        (absS * (Math.abs(Math.log(modulus(b))) + Math.PI) + steps + 4);
    }
    scale = scale.mul(z);
    b = new Complex(b.re + 1, b.im);
    if (++steps > MAX_BASE_SHIFT) return undefined;
  }
  while (above(b.re)) {
    b = new Complex(b.re - 1, b.im);
    scale = scale.div(z);
    const t = scale.mul(b.pow(negS)).neg();
    head = head.add(t);
    headLargest = Math.max(headLargest, modulus(t));
    headError +=
      modulus(t) *
      (absS * (Math.abs(Math.log(modulus(b))) + Math.PI) + steps + 4);
    if (++steps > MAX_BASE_SHIFT) return undefined;
  }
  // The shift made no progress: a is so large that adding 1 does not
  // change it.
  if (below(b.re) || above(b.re)) return undefined;

  // v = e^{2πib} and v^(−1). At Re(b) = 1 the phase is taken as 0, not as
  // the rounded 2π, so that the argument on the cut is real and the
  // continuation takes its lower lip (see above).
  const phase = b.re === 1 ? 0 : 2 * Math.PI * b.re;
  const cos = Math.cos(phase);
  const sin = Math.sin(phase);
  const grow = Math.exp(2 * Math.PI * b.im);
  const v = new Complex(cos / grow, sin / grow);
  const vInv = new Complex(cos * grow, -sin * grow);
  if (!(modulus(v.sub(one)) >= 1e-3) || !(modulus(vInv.sub(one)) >= 1e-3))
    return undefined;

  const logZ = logAccurate(z);
  // On the cut (real z > 1) Φ takes the side below it: see
  // `lerchContinuedComplex`.
  const negLogZ =
    z.im === 0 && z.re > 1 ? new Complex(-logZ.re, 0) : logZ.mul(-1);
  const mu = new Complex(logZ.im / (2 * Math.PI), -logZ.re / (2 * Math.PI));
  const order = one.sub(s);
  // Each inner value: the direct series inside the unit circle; outside it
  // the continuation, then where that is not accurate enough the integral
  // (`lerchIntegralWithError`, for a positive real part of the order),
  // then the continuation with c moved to Re(c) ≥ 1 + |Im c|, which keeps
  // the branch points t = ±i·c of its tail integral away from the real
  // axis. The best estimate wins.
  const inner = (w: Complex, c: Complex) => {
    const series =
      modulus(w) < 0.9 ? lerchSeriesWithError(w, order, c) : undefined;
    if (series !== undefined) return series;
    let best = lerchContinuedWithError(w, order, c);
    const better = (r: { value: Complex; error: number } | undefined) => {
      if (r !== undefined && (best === undefined || r.error < best.error))
        best = r;
    };
    if (best !== undefined && best.error <= 1e-13) return best;
    better(lerchIntegralWithError(w, order, c));
    if (best !== undefined && best.error <= 1e-13) return best;
    better(lerchContinuedWithError(w, order, c, 1 + Math.abs(c.im)));
    return best;
  };
  const cPlus = one.sub(mu);
  const cMinus = one.add(mu);
  const plus = inner(v, cPlus);
  if (plus === undefined) return undefined;
  const minus = inner(vInv, cMinus);
  if (minus === undefined) return undefined;

  const sm1 = s.sub(one);
  const rotation = sm1.mul(new Complex(0, Math.PI / 2)).exp(); // e^{iπ(s−1)/2}
  const twoPi = new Complex(2 * Math.PI, 0).pow(sm1);
  const tPlus = twoPi.mul(rotation).mul(v).mul(plus.value);
  const tMinus = twoPi.div(rotation).mul(vInv).mul(minus.value);
  const n0 = negLogZ.pow(sm1);
  const modes = n0.add(tPlus).add(tMinus);

  // The rounding of v moves Φ(v, …) by about |∂Φ/∂log w| times the
  // absolute error of log v, ε·(2π|b| + 2). Next to w = 1, Φ(w,σ,c) grows
  // like Γ(1−σ)·(−log w)^(σ−1), whose logarithmic derivative is
  // (σ − 1)/log w.
  const vError = eps * (2 * Math.PI * modulus(b) + 2);
  const logV = modulus(v.log());
  const sensitivity = (c: Complex) =>
    modulus(c) + modulus(order) + 2 + (modulus(order.sub(one)) + 1) / logV;
  // e^{iπ(s−1)/2} and (2π)^(s−1) are exponentials of rounded arguments.
  const factorError = eps * (modulus(sm1) * (Math.PI / 2 + 1.84) + 8);
  const error =
    eps *
      (modulus(sm1) * (Math.abs(Math.log(modulus(negLogZ))) + Math.PI) + 8) *
      modulus(n0) +
    modulus(tPlus) * (plus.error + factorError + vError * sensitivity(cPlus)) +
    modulus(tMinus) *
      (minus.error + factorError + vError * sensitivity(cMinus)) +
    4 * eps * (modulus(n0) + modulus(tPlus) + modulus(tMinus));

  const g = gamma(order);
  // Γ(1 − s) below the smallest normal double has fewer significant digits
  // than `gammaWeight` counts: decline, as `lerchModesWith` does.
  if (!(modulus(g) >= 2 ** -1000)) return undefined;
  const main = scale.mul(g).mul(logZ.mul(b.neg()).exp()).mul(modes);
  const out = head.add(main);
  // Γ(1 − s), and z^(−b): an exponential with an argument rounded to about
  // ε·|b|·|log z|.
  const relative =
    (error / modulus(modes) +
      eps * (gammaWeight(order) + modulus(b) * modulus(logZ) + 4)) *
    (modulus(main) / modulus(out));
  const headLoss =
    Math.max(1e-15 * headLargest, eps * headError) / modulus(out);
  // As in `lerchModesWith`, only the largest term moving a is checked
  // against `MAX_LOSS`; the rounding model is in the estimate.
  if (!out.isFinite() || !((1e-15 * headLargest) / modulus(out) <= MAX_LOSS))
    return undefined;
  return { value: out, error: relative + headLoss + ESTIMATE_FLOOR };
}

/** The most terms `lerchSeriesOutsideDisk` sums before it declines. */
const SERIES_OUTSIDE_DISK_MAX_TERMS = 200;

/**
 * Φ(z,s,a) for |z| > 1, Re(s) > 0 and z off the cut [1, ∞), from the first
 * terms of the series Σ zⁿ(n+a)^(−s), or `undefined` when these terms do
 * not give the value. The series diverges for |z| > 1, but at a large
 * order its first terms can fall fast: Φ(−1e8, 200, 2.5) = 2.58e−80 is its
 * first term 2.5^(−200) to 21 digits.
 *
 * The bound of the remainder: Φ(z,s,a) = Σ_{n<N} zⁿ(n+a)^(−s) +
 * z^N·Φ(z,s,a+N), and for Re(c) > 0 (DLMF 25.14.5)
 *
 *   Φ(z,s,c) = (1/Γ(s))·∫₀^∞ t^(s−1)·e^(−ct) / (1 − z·e^(−t)) dt,
 *
 * where |1 − z·e^(−t)| is at least δ, the distance from 1 to the segment
 * [0, z], because e^(−t) is in (0, 1]. So
 *
 *   |Φ(z,s,c)| ≤ Γ(Re s) / (|Γ(s)|·Re(c)^(Re s)·δ),
 *
 * and the remainder after N terms is at most |z|^N times this at
 * c = a + N. (Checked against mpmath on points with |z| from 2 to 1e8,
 * orders 2.5 to 200, complex orders included: the remainder was below the
 * bound at each N.) The sum stops when the bound is below 2⁻⁶⁰ of the sum.
 * The bound is convex in N, so once it grows it grows for every later N:
 * the function then declines, as it does after
 * `SERIES_OUTSIDE_DISK_MAX_TERMS` terms.
 *
 * Each term is one exponential of n·log z − s·log(n + a), with an error of
 * about ε·(n·|log z| + |s|·|log(n + a)|) relative to the term, from the
 * rounded argument, plus a few roundings. The estimate counts twice that
 * argument error plus 4ε per term, and adds the bound: on the 10920 points
 * past the unit circle of the sweep described at `lerchContinuedWithError`
 * the actual error reached 0.76 times the single count at s = 80,
 * a = 10, where Φ is its first term 10^(−80). With the double count the 2307
 * points that answer are within 6e−14, and the actual error is at most
 * 0.29 times the estimate.
 */
function lerchSeriesOutsideDisk(
  z: Complex,
  s: Complex,
  a: Complex
): { value: Complex; error: number } | undefined {
  if (!(s.re > 0) || !Number.isFinite(s.re) || !Number.isFinite(s.im))
    return undefined;
  if (z.im === 0 && z.re >= 1) return undefined;
  const absZ = modulus(z);
  if (!(absZ > 1) || !Number.isFinite(absZ)) return undefined;
  // The point of the segment [0, z] nearest to 1 is u·z, with u the
  // projection of 1 on the line through 0 and z, clamped to [0, 1]:
  // u = Re z/|z|². Because |z| > 1, u < 1, so the projection is inside the
  // segment exactly when Re z > 0, and then the distance from 1 to the line
  // is |Im z|/|z|. Otherwise the nearest point is 0, at distance 1. This
  // form does not compute |z|², which overflows above |z| ≈ 1.3e154 (u was
  // then 0 and δ was 1 at z = 1e200 + 1e184·i, where δ is 1e−16, so the
  // bound was 16 orders too small).
  const delta = z.re > 0 ? Math.abs(z.im) / absZ : 1;
  // δ is 0 only on the cut, which returned above. A δ below the smallest
  // normal double has lost digits: decline.
  if (!(delta >= 2 ** -1022)) return undefined;
  // The principal logarithm from |z| as `Math.hypot` gives it:
  // `Complex.log()` forms |z|² when both parts of z are not zero, and its
  // real part is Infinity above |z| ≈ 1.3e154 (z = 1e200 + 1e184·i).
  const lnAbsZ = Math.log(absZ);
  const logZ = new Complex(lnAbsZ, Math.atan2(z.im, z.re));
  const logZAbs = modulus(logZ);
  // ln(Γ(Re s)/|Γ(s)|): 0 for a real s. For a complex s, ln 2 more covers
  // the rounding of the two log-gamma values.
  const lnRatio =
    s.im === 0
      ? 0
      : gammaln(new Complex(s.re, 0)).re - gammaln(s).re + Math.LN2;
  const lnDelta = Math.log(delta);
  const negS = s.neg();
  const absS = modulus(s);
  let sum = C_ZERO;
  let largest = 0;
  let weighted = 0; // Σ |term|·(the rounding of the term, in units of ε)
  let previous = Infinity;
  for (let n = 0; n < SERIES_OUTSIDE_DISK_MAX_TERMS; n++) {
    const c = new Complex(a.re + n, a.im);
    // The (n + a) = 0 term is dropped, as in `shiftBase`.
    if (!(c.re === 0 && c.im === 0)) {
      const logC = c.log();
      const term = logZ.mul(n).add(logC.mul(negS)).exp();
      if (!term.isFinite()) return undefined;
      sum = sum.add(term);
      const size = modulus(term);
      largest = Math.max(largest, size);
      weighted += size * (2 * (n * logZAbs + absS * modulus(logC)) + 4);
    }
    // The bound after N = n + 1 terms needs Re(a + N) > 0.
    const next = a.re + n + 1;
    if (!(next > 0)) continue;
    const lnBound =
      (n + 1) * lnAbsZ + lnRatio - s.re * Math.log(next) - lnDelta;
    const total = modulus(sum);
    if (lnBound <= Math.log(2 ** -60 * total)) {
      if (!((1e-16 * largest) / total <= MAX_LOSS)) return undefined;
      return {
        value: sum,
        error:
          (Number.EPSILON * weighted + Math.exp(lnBound)) / total +
          ESTIMATE_FLOOR,
      };
    }
    if (lnBound > previous) return undefined;
    previous = lnBound;
  }
  return undefined;
}

/**
 * The Lerch transcendent Φ(z,s,a) = Σ_{k≥0} zᵏ(k+a)^(−s), within about
 * 1e−11 relative. Returns `undefined` where no method can vouch for that
 * accuracy (see `lerchSeriesComplex`, `lerchEulerComplex`,
 * `lerchSeriesOutsideDisk`, `lerchContinuedComplex`, `lerchModesComplex`,
 * `lerchIntegralComplex` and `lerchFunctionalComplex`) —
 * the caller keeps the expression symbolic
 * rather than ship an unverified number.
 */
export function lerchPhiComplex(
  z: Complex,
  s: Complex,
  a: Complex
): Complex | undefined {
  if (z.isNaN() || s.isNaN() || a.isNaN()) return C_NAN;
  // Φ(1,s,a) = ζ(s,a). A decline of the kernel (`undefined`) is a decline
  // here; its NaN at the pole s = 1 is kept.
  if (z.im === 0 && z.re === 1) return hurwitzZetaComplexWithError(s, a)?.value;
  if (z.isZero()) return a.pow(s.neg()); // Φ(0,s,a) = a^(−s): only k = 0 survives
  if (s.im === 0 && s.re === 0)
    return new Complex(1, 0).div(new Complex(1, 0).sub(z)); // Φ(z,0,a) = 1/(1−z)
  const absZ = modulus(z);
  const onRim = z.im !== 0 && Math.abs(absZ - 1) < 1e-9;
  // Past the unit disk and on its rim: the continuation. It declines by
  // itself where `incompleteGammaUpperComplex` declines or where its terms
  // cancel too far (see `lerchContinuedComplex`), so this dispatcher does
  // not need to special-case z. Where it declines (mostly a large |z|), the
  // modes route for a real a, then the integral for Re(s) > 0, then Lerch's
  // transformation formula for any a. The Taylor series in a around a real
  // base point, which came last until 2026-09-30, answered no point of the
  // complex-a sweeps (9700 points) that these do not, at up to 0.5 s per
  // declined call, and was removed. A complex a first tries the
  // continuation again with a moved only to Re(a) ≥ 1/2: on the 245
  // complex-a points with 30 ≤ |z| ≤ 1000 of the sweeps, the target 1
  // alone answers 151 and the target 1/2 alone 166, every one of the 151
  // among them, none wrong. A target of 1/4 once answered a point 9.9e−11
  // off, when the error
  // estimate did not count the quadrature error of the tail integral. The
  // estimate now counts it (see `hermiteTail`), but it is pessimistic for a
  // small Re(a): on 2400 points past the unit circle with a moved only to
  // Re(a) ≥ 1/4, it declined 54 more, all with Re(a) < 0.56 and none off
  // by more than 1.7e−14. So 1/2 stays the lowest target used.
  if (absZ > 1 || onRim) {
    // First the leading terms of the series with their proven remainder
    // bound, which answer at a large order (see `lerchSeriesOutsideDisk`).
    const series = onRim ? undefined : lerchSeriesOutsideDisk(z, s, a);
    if (series !== undefined && series.error <= ACCURACY) return series.value;
    return (
      lerchContinuedComplex(z, s, a) ??
      (a.im !== 0 ? lerchContinuedComplex(z, s, a, 0.5) : undefined) ??
      lerchModesComplex(z, s, a) ??
      lerchIntegralComplex(z, s, a) ??
      lerchFunctionalComplex(z, s, a)
    );
  }
  // Real z in [−1, 0) with Re(s) > 0: the Euler transform. For Re(s) ≤ 0
  // its terms grow and the transform is not valid (see `lerchEulerComplex`):
  // those points, and any the transform declines, go to the direct series
  // and then the continuation below. At z = −1 the direct series does not
  // converge, so they reach the continuation, whose incomplete gamma
  // argument −a·log z = iπa is then within its reliable region.
  if (z.im === 0 && z.re < 0 && s.re > 0) {
    const euler = lerchEulerComplex(z.re, s, a);
    if (euler !== undefined) return euler;
  }
  // z = −1 and Re(s) ≤ 0 (or a point the transform declined): the even
  // and odd terms are two Hurwitz zeta values,
  // Φ(−1,s,a) = 2^(−s)·(ζ(s,a/2) − ζ(s,(a+1)/2)), which holds for every s
  // by analytic continuation, and for a complex a with principal powers
  // (arg(2w) = arg(w)). The difference can cancel, so it is checked like the
  // sums above. Φ(−1,s,a) with a complex a, measured against mpmath (4000
  // random points, Re(s) from −30 to 3, |Im s| ≤ 5, Re(a) from 0.05 to 30,
  // |Im a| ≤ 40): every point answers, the worst within 9.4e−13 relative.
  if (z.im === 0 && z.re === -1) {
    const half = new Complex(0.5, 0);
    // Either kernel value can decline (`undefined`); the direct series and
    // the continuation below then take the point. The rounding of the
    // difference is checked against `MAX_LOSS`, as before; the kernel's
    // own error estimates, added to it, against `ACCURACY`. (Checking the
    // sum against `MAX_LOSS` declined Φ(−1, −4.2, 0.1 − 0.00025i), whose
    // odd term has a condition number of 1400 and whose value is within
    // 1e−11; `zeta-values.test.ts` pins it.)
    const even = hurwitzZetaComplexWithError(s, a.mul(half));
    const odd = hurwitzZetaComplexWithError(
      s,
      a.add(new Complex(1, 0)).mul(half)
    );
    if (even !== undefined && odd !== undefined) {
      const scale = new Complex(2, 0).pow(s.neg());
      const out = even.value.sub(odd.value).mul(scale);
      const lost =
        (1e-16 *
          Math.max(modulus(even.value), modulus(odd.value)) *
          modulus(scale)) /
        modulus(out);
      const kernelLoss =
        ((even.error + odd.error) * modulus(scale)) / modulus(out);
      if (out.isFinite() && lost <= MAX_LOSS && lost + kernelLoss <= ACCURACY)
        return out;
    }
  }
  // |z| close enough to 1 that the direct series can't reach machine
  // precision within its term cap (see `lerchSeriesComplex`) falls back to
  // the same continuation used past |z| = 1 — valid there too, off the
  // z = 1 branch point.
  return lerchSeriesComplex(z, s, a) ?? lerchContinuedComplex(z, s, a);
}

/**
 * Real-valued Φ(z,s,a) for real z, s, a — for the compiled JavaScript
 * real-scalar lane (`_SYS.lerchPhi`). It takes the special cases in the
 * same order as the interpreter's `evaluateLerchPhi`
 * (`library/arithmetic.ts`), because the kernel alone drops the (k+a) = 0
 * term instead of answering the pole:
 *
 * - z = 1: the real Hurwitz zeta `hurwitzZeta(s, a)`, with its poles.
 * - z = 0: a^(−s), `+Infinity` at a = 0 with s > 0.
 * - s = 0: 1/(1 − z).
 * - a a non-positive integer with s > 0 (and z ≠ 0): the pole, `+Infinity`
 *   (the float encoding of the undirected infinity).
 *
 * `NaN` for a genuinely complex value: a real z > 1 is on the branch cut
 * (unless s is a non-positive integer, where Φ is a rational function of z
 * and has no cut), and a < 0 with a non-integer s has complex terms. `NaN`
 * also where the kernel declines. Past those checks the value is real, so
 * any imaginary part the kernel returns is rounding noise and is dropped.
 */
export function lerchPhiReal(z: number, s: number, a: number): number {
  if (Number.isNaN(z) || Number.isNaN(s) || Number.isNaN(a)) return NaN;
  if (z === 1) return hurwitzZeta(s, a);
  if (z === 0) return Math.pow(a, -s);
  if (s === 0) return 1 / (1 - z);
  if (a <= 0 && Number.isInteger(a) && s > 0) return Infinity;
  if (!Number.isFinite(z) || !Number.isFinite(s) || !Number.isFinite(a))
    return NaN;
  if (z > 1 && !(Number.isInteger(s) && s <= 0)) return NaN;
  if (a < 0 && !Number.isInteger(s)) return NaN;
  const result = lerchPhiComplex(
    new Complex(z, 0),
    new Complex(s, 0),
    new Complex(a, 0)
  );
  return result === undefined ? NaN : result.re;
}

/** Within this distance of s = 1 the Dirichlet η and β sum their alternating series, with no pole to cancel. */
export const DIRICHLET_NEAR_POLE = 0.25;

/**
 * Dirichlet η(s) = (1 − 2^{1−s}) ζ(s) for real s in machine floats; η(1) = ln 2.
 * Near s = 1, where the product cancels ζ's pole, it is Φ(−1, s, 1).
 */
export function dirichletEtaReal(s: number): number {
  if (Number.isNaN(s)) return NaN;
  if (s === 1) return Math.LN2;
  if (Math.abs(s - 1) < DIRICHLET_NEAR_POLE) return lerchPhiReal(-1, s, 1);
  return (1 - Math.pow(2, 1 - s)) * zeta(s);
}

/**
 * Dirichlet β(s) = 4^{−s} (ζ(s, ¼) − ζ(s, ¾)) for real s in machine floats;
 * β(1) = π/4. Near s = 1 it is 2^{−s} Φ(−1, s, ½).
 */
export function dirichletBetaReal(s: number): number {
  if (Number.isNaN(s)) return NaN;
  if (s === 1) return Math.PI / 4;
  if (Math.abs(s - 1) < DIRICHLET_NEAR_POLE)
    return Math.pow(2, -s) * lerchPhiReal(-1, s, 0.5);
  return Math.pow(4, -s) * (hurwitzZeta(s, 0.25) - hurwitzZeta(s, 0.75));
}
