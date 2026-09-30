import { Complex } from 'complex-esm';
import {
  gamma,
  gammaErrorWeight,
  gaussLegendreRule,
  hurwitzZetaComplex,
  incompleteGammaUpperComplexWithError,
} from './numeric-complex.js';
import { hurwitzZeta } from './special-functions.js';

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
// reaches double precision in a few dozen. |z| ≥ 1 (off z = 1) needs
// analytic continuation past the disk of convergence, by the Hermite-type
// integral representation valid for Re(a) > 0 (`lerchContinuedComplex`).
// Where its terms cancel too far (Re(s) < 0 with a large |z|), a real a
// uses the expansion of Φ in the Fourier modes of the base point
// (`lerchModesComplex`) and a complex a a Taylor series in a around a real
// base point (`lerchTaylorComplex`).

const C_ZERO = new Complex(0, 0);

const C_ONE = new Complex(1, 0);
const C_NAN = new Complex(NaN, NaN);

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
      largest = Math.max(largest, term.abs());
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

/** Added to the error estimates of the continuation and of the modes route.
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
  const shifted = shiftBase(z, s, a, Number.MIN_VALUE);
  if (shifted === undefined) return undefined;
  const { head, zn, b } = shifted;
  const absZ = z.abs();
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
  const absS = s.abs();
  for (let k = 0; k <= maxN; k++) {
    const base = new Complex(b.re + k, b.im);
    const term = zn.mul(zk).mul(base.pow(negS));
    sum = sum.add(term);
    const size = term.abs();
    largest = Math.max(largest, size);
    const logBase = Math.hypot(
      Math.log(base.abs()),
      Math.atan2(b.im, b.re + k)
    );
    weighted += size * (k + absS * logBase + 4);
    const rho = Math.max(size / previous, absZ);
    const total = sum.add(head).abs();
    // A zero term (zᵏ underflowed) leaves nothing more to add.
    if (
      size === 0 ||
      (size < previous && rho < 1 && (size * rho) / (1 - rho) <= 1e-17 * total)
    ) {
      if (++settled === 3) {
        if (!((1e-16 * largest) / total <= MAX_LOSS)) return undefined;
        if (!((Number.EPSILON * weighted) / total <= MAX_LOSS))
          return undefined;
        return head.add(sum);
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
        if (!((1e-16 * shifted.largest) / out.abs() <= MAX_LOSS))
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

/** Where the Hermite integrand is below double precision: its decay is at
 * worst e^{−πt}. */
const T_MAX = 40;
const PANELS = 80;

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
 * `quadrature` is an estimate of the absolute error of the 20-point rule:
 * the sum over the panels of |S₂₀ − S₁₀|, where S₁₀ is the 10-point sum on
 * the same panel. The integrand has branch points at t = ±i·a, which come
 * near the real axis when Re(a) is small, and then the rule converges
 * slowly on the panels next to them. The difference is the error of the
 * 10-point sum, which is larger than that of the 20-point one, so the
 * estimate is pessimistic. It costs 800 evaluations of the integrand in
 * addition to the 1600 of the 20-point sum, and it runs only for Re(a) < 1
 * (`checkQuadrature`); for a larger Re(a) the estimate is 0.
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
    const denom = base.pow(halfS).mul(Math.expm1(2 * Math.PI * t));
    return { value: phase.sin().div(denom), phase, base };
  };
  let sum = C_ZERO;
  let rounding = 0;
  let quadrature = 0;
  // The 10-point check runs only when the branch points are close to the
  // real axis: with Re(a) ≥ 1/2 no panel showed a quadrature error above
  // 1e−13 of the integrand size on 2400 points, and the callers move a to
  // Re(a) ≥ 1 first, so the check costs the common case nothing.
  const checkQuadrature = a.re < 1;
  const halfSAbs = halfS.abs();
  const h = T_MAX / PANELS;
  for (let p = 0; p < PANELS; p++) {
    let panel = C_ZERO;
    for (let i = 0; i < GAUSS.x.length; i++) {
      const t = h * (p + 0.5 + 0.5 * GAUSS.x[i]);
      const { value, phase, base } = integrand(t);
      const term = value.mul(0.5 * h * GAUSS.w[i]);
      panel = panel.add(term);
      // |log(a²+t²)| ≤ |ln|a²+t²|| + π.
      rounding +=
        term.abs() *
        (phase.abs() +
          halfSAbs * (Math.abs(Math.log(base.abs())) + Math.PI) +
          6);
    }
    sum = sum.add(panel);
    if (checkQuadrature) {
      let check = C_ZERO;
      for (let i = 0; i < GAUSS_CHECK.x.length; i++) {
        const t = h * (p + 0.5 + 0.5 * GAUSS_CHECK.x[i]);
        check = check.add(integrand(t).value.mul(0.5 * h * GAUSS_CHECK.w[i]));
      }
      quadrature += panel.sub(check).abs();
    }
  }
  return {
    value: sum.mul(-2),
    rounding: 2 * Number.EPSILON * rounding,
    quadrature: 2 * quadrature,
  };
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
    (Math.PI * s.abs() * Math.cosh(Math.PI * s.im)) / sine.abs();
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
 * quadrature error of the tail integral (`hermiteTail`'s `quadrature`). */
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
    correctionError = (r.weight + Math.PI * sigma.abs() + 6) * correction.abs();
  }
  const prefactor = negLogZ
    .mul(b)
    .exp()
    .mul(negLogZ.pow(s.sub(new Complex(1, 0))));
  const closed = prefactor.mul(rotated.add(correction));
  // The size the closed term is computed from: its two parts can cancel.
  const closedSize =
    prefactor.abs() * Math.max(rotated.abs(), correction.abs());
  const tail = hermiteTail(logZ, s, b);
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
    zk.abs() * Math.max(...terms.map((t) => t.abs()), closedSize)
  );
  const rounding = (1e-15 * size) / out.abs();
  const gammaLoss =
    (zk.abs() *
      prefactor.abs() *
      (incompleteGammaError(upperError) * rotated.abs() +
        Number.EPSILON * correctionError)) /
    out.abs();
  // The closed term has errors of its own beyond a few roundings: e^x and
  // (−log z)^(s−1) are exponentials of rounded arguments, with errors of
  // about ε·|x| and ε·|(s − 1)·log(−log z)| relative to the term, and x
  // itself is rounded, which moves Γ(1 − s, x) by about
  // ε·|x|·|x^(−s)·e^{−x}| (its derivative is −x^(−s)·e^{−x}), so the term
  // by ε·|x|·|(−log z)^(s−1)·x^(−s)| (times |e^{2πimσ}| on another sheet).
  const sm1 = s.sub(new Complex(1, 0));
  const closedLoss =
    (Number.EPSILON *
      zk.abs() *
      ((x.abs() + sm1.abs() * negLogZ.log().abs() + 4) * closedSize +
        x.abs() *
          Math.exp(
            sm1.mul(negLogZ.log()).re -
              s.mul(x.log()).re -
              2 * Math.PI * m * sigma.im
          ))) /
    out.abs();
  // The tail integral's own rounding (see `hermiteTail`): its integrand can
  // be far larger than the integral for Re(s) < 0.
  const tailLoss = (zk.abs() * tail.rounding) / out.abs();
  // The quadrature error of the tail integral (see `hermiteTail`).
  const quadratureLoss = (zk.abs() * tail.quadrature) / out.abs();
  if (!out.isFinite() || !(rounding + tailLoss <= MAX_LOSS)) return undefined;
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
 * The error of `hurwitzZetaComplex(o, b)`, in units of ε, relative to the
 * larger of |ζ| and its envelope 2|Γ(σ)|(2π)^(−Re σ)cosh(π·Im σ/2)
 * (σ = 1 − o), for the orders the modes route asks for (real part from −7
 * to 1/2, 0 < b ≤ 1); `undefined` where the kernel is not accurate enough
 * to use. Measured against mpmath on 2500 orders with real part from −8 to
 * 0.5, |Im| ≤ 7 and 0.001 ≤ b ≤ 1, the largest errors were:
 *   - |Im o| < 4: 57ε;
 *   - 4 ≤ |Im o| < 7: 306ε to 13000ε for Re(o) ≥ 0 (a relative error up to
 *     4.6e−13, with b below 0.07; not used), 468ε for −2 ≤ Re(o) < 0 and
 *     74ε below;
 *   - |Im o| ≥ 8: a relative error up to 2.4e−11 (not used).
 */
function hurwitzKernelWeight(o: Complex): number | undefined {
  const im = Math.abs(o.im);
  if (im < 4) return 80 + 20 * Math.abs(o.re);
  if (im > 7 || o.re >= 0) return undefined;
  if (o.re >= -2) return 1000;
  return 150 + 20 * Math.abs(o.re);
}

/**
 * Φ(z,s,a) for a real a and Re(s) < 1/2, from the expansion of Φ in the
 * Fourier modes of the base point (the Hurwitz formula of the Hurwitz zeta
 * function, carried over to Φ): for 0 < b ≤ 1 and Re(s) < 0,
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
 * continuation. Other real a are brought to (0, 1] by
 * Φ(z,s,a) = a^(−s) + z·Φ(z,s,a+1) (a (a+k) = 0 term dropped, as
 * `shiftBase` does) or by Φ(z,s,a) = z^(−1)·(Φ(z,s,a−1) − (a−1)^(−s)).
 * On the cut (real z > 1) the n = 0 mode takes (−log z + 0i)^(s−1), the side
 * below the cut, as `lerchContinuedComplex` does.
 *
 * This route has none of the cancellation of the continuation for Re(s) < 0
 * and a large |z|, where the three terms of the continuation are up to 1e5
 * times the value. It is used where the continuation declines. It does not
 * apply to a complex a: e^{2πinb} then grows in one direction of n and the
 * sum of the modes diverges.
 *
 * Declines (returns `undefined`) when it needs more than `MODES_MAX`
 * explicit modes, or when its estimated error, which counts the error of
 * Γ(1 − s) (`gammaErrorWeight`), the roundings of each mode and each term,
 * the error of `hurwitzZetaComplex` (see `hurwitzKernelWeight`) and the terms
 * added to move a, is above
 * `ACCURACY` (the terms added to move a also against `MAX_LOSS`, as in the
 * continuation). Measured on 9058 points past the unit circle with a real a
 * and Re(s) < 1/2 (Re(s) down to −30, |z| up to 1e7, a from −8 to 30;
 * references from mpmath at up to 250 digits, since `lerchphi` at 60 digits
 * is wrong for |z| near 1e6), whether or not the continuation answers there:
 * the actual error was at most 0.26 times this estimate, and the 9056
 * points whose estimate passes are all within 6.3e−13.
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
 * a, Re(s) ≥ 1/2, too many modes, a value that is not finite, or terms
 * added to move a that cancel beyond `MAX_LOSS`). It first takes the terms
 * with a small σ from `hurwitzZetaComplex` minus the explicit modes, and
 * where that is not accurate enough, from the Lerch transcendent on the unit
 * circle (`modesTailOnCircle`), which costs two continuations per term. */
function lerchModesWithError(
  z: Complex,
  s: Complex,
  a: Complex
): { value: Complex; error: number } | undefined {
  const quick = lerchModesWith(z, s, a, false);
  if (quick === undefined || quick.error <= ACCURACY) return quick;
  const careful = lerchModesWith(z, s, a, true);
  if (careful === undefined) return quick;
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
    const zeta = hurwitzZetaComplex(sigma, base);
    const cos = halfTurn.add(C_ONE.div(halfTurn)).mul(0.5);
    const value = cos.mul(zeta);
    return { value, error: 64 * Number.EPSILON * cos.abs() * zeta.abs() };
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
    (first.abs() * (down.error + 8 * Number.EPSILON) +
      second.abs() * (up.error + 8 * Number.EPSILON));
  return { value, error };
}

function lerchModesWith(
  z: Complex,
  s: Complex,
  a: Complex,
  onCircle: boolean
): { value: Complex; error: number } | undefined {
  if (a.im !== 0 || !(s.re < 0.5)) return undefined;
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
  const absS = s.abs();
  let scale = one;
  let steps = 0;
  while (b <= 0) {
    if (b !== 0) {
      const t = scale.mul(new Complex(b, 0).pow(negS));
      head = head.add(t);
      headLargest = Math.max(headLargest, t.abs());
      headError +=
        t.abs() * (absS * (Math.abs(Math.log(-b)) + Math.PI) + steps + 4);
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
    headLargest = Math.max(headLargest, t.abs());
    headError += t.abs() * (absS * Math.abs(Math.log(b)) + steps + 4);
    if (++steps > MAX_BASE_SHIFT) return undefined;
  }

  const logZ = logAccurate(z);
  const negLogZ =
    z.im === 0 && z.re > 1 ? new Complex(-logZ.re, 0) : logZ.mul(-1);
  const absLog = logZ.abs();
  const N = Math.max(1, Math.ceil(absLog / (2 * Math.PI * MODES_RATIO)) - 1);
  if (N > MODES_MAX) return undefined;
  const sm1 = s.sub(one);
  const g = gamma(one.sub(s));
  const gw = gammaErrorWeight(one.sub(s));

  // The explicit modes |n| ≤ N (without the factor Γ(1 − s)).
  let modes = negLogZ.pow(sm1);
  let modesAbs = modes.abs();
  for (let n = 1; n <= N; n++) {
    const phase = 2 * Math.PI * ((n * b) % 1);
    const e = new Complex(Math.cos(phase), Math.sin(phase));
    const up = new Complex(-logZ.re, 2 * Math.PI * n - logZ.im).pow(sm1).mul(e);
    const down = new Complex(-logZ.re, -2 * Math.PI * n - logZ.im)
      .pow(sm1)
      .mul(e.conjugate());
    modes = modes.add(up).add(down);
    modesAbs += up.abs() + down.abs();
  }
  const explicit = g.mul(modes);
  // Each mode is a power with an exponent rounded to about ε·|s − 1|·|log u|.
  let error =
    eps *
    (gw * explicit.abs() +
      (8 + sm1.abs() * (Math.log(2 * Math.PI * (N + 1) + absLog) + Math.PI)) *
        g.abs() *
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
    const rounding = gw + 4 * k + 10 + 2 * sigma.abs() * (1 + Math.log(N + 1));
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
        sumAbs += t.abs();
      }
      zetaN = R.mul(sum).mul(2);
      error += eps * rounding * 2 * R.abs() * sumAbs * power.abs();
    } else if (onCircle && (tailOnCircle = modesTailOnCircle(sigma, b, N))) {
      zetaN = R.mul(tailOnCircle.value).mul(2);
      error +=
        (2 * R.abs() * tailOnCircle.error + eps * rounding * zetaN.abs()) *
        power.abs();
    } else {
      // The Hurwitz zeta kernel is used only where its error is measured.
      const kernelWeight = hurwitzKernelWeight(s.sub(new Complex(k, 0)));
      if (kernelWeight === undefined) return undefined;
      const full = hurwitzZetaComplex(
        s.sub(new Complex(k, 0)),
        new Complex(b, 0)
      );
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
        2 * R.abs() * Math.cosh((Math.PI * Math.abs(sigma.im)) / 2);
      error +=
        eps *
        (kernelWeight * Math.max(full.abs(), envelope) +
          rounding * first.abs()) *
        power.abs();
    }
    const t = zetaN.mul(power);
    tail = tail.add(t);
    error += 4 * eps * t.abs();
    // The terms fall like k^(−Re s)·4^(−k) once k is past −Re(s).
    if (k > 2 - s.re && t.abs() < 1e-17 * explicit.add(tail).abs()) {
      if (++small === 2) break;
    } else small = 0;
  }
  const inner = explicit.add(tail);
  const main = scale.mul(logZ.mul(-b).exp()).mul(inner);
  const out = head.add(main);
  // z^(−b): an exponential with an argument rounded to about ε·b·|log z|.
  const relative =
    (error / inner.abs() + eps * (b * absLog + 4)) * (main.abs() / out.abs());
  const headLoss =
    Math.max(1e-15 * headLargest, Number.EPSILON * headError) / out.abs();
  if (!out.isFinite() || !(headLoss <= MAX_LOSS)) return undefined;
  return { value: out, error: relative + headLoss + ESTIMATE_FLOOR };
}

/** The most terms `lerchTaylorComplex` sums; it declines when its series
 * would need more. */
const TAYLOR_MAX_TERMS = 200;

/** Φ(z,s,c) for a real base point c past the unit circle, with its
 * estimated relative error: the continuation, or the modes route where that
 * is more accurate. */
function lerchRealBaseWithError(
  z: Complex,
  s: Complex,
  c: Complex
): { value: Complex; error: number } | undefined {
  const continued = lerchContinuedWithError(z, s, c);
  if (continued !== undefined && continued.error <= 1e-14) return continued;
  const modes = lerchModesWithError(z, s, c);
  if (continued === undefined) return modes;
  if (modes === undefined) return continued;
  return modes.error < continued.error ? modes : continued;
}

/**
 * Φ(z,s,a) past the unit circle for a complex a, where the continuation
 * declines and the modes route does not apply: the Taylor series in a
 * around a real base point c,
 *
 *   Φ(z,s,a) = Σ_{j≥0} (s)_j/j! · (c − a)^j · Φ(z,s+j,c),
 *
 * from ∂Φ/∂a = −s·Φ(z,s+1,a). Φ is analytic in a away from 0, −1, −2, …,
 * so the series converges when |a − c| < c. First a is moved to
 * Re(a) ≥ 1/2 as `shiftBase` does; then c = |a|²/Re(a), which makes the
 * ratio of the series |a − c|/c = |Im a|/|a| as small as it can be. Each
 * Φ(z,s+j,c) comes with its own error estimate
 * (`lerchRealBaseWithError`).
 *
 * The terms can be much larger than the value, mostly for a large |z| and a
 * small or negative Re(a). Called on 2464 points with a complex a past the
 * unit circle (|z| up to 1e7, Re(s) from −30 to 8, Re(a) from −6 to 8,
 * |Im a| up to 4) and judged against the reference with the right sheet
 * (see the comment at the top of this file), its estimate passed on 2152,
 * all within 2.4e−13, and the actual error was at most 0.12 times the
 * estimate. It declines (returns
 * `undefined`) when an inner value declines, when the series needs more than
 * `TAYLOR_MAX_TERMS` terms, or when the estimated error — the inner errors
 * and a few roundings per term, times the size of each term, and the terms
 * added to move a — is above `ACCURACY`.
 */
function lerchTaylorComplex(
  z: Complex,
  s: Complex,
  a: Complex
): Complex | undefined {
  if (a.im === 0) return undefined;
  const shifted = shiftBase(z, s, a, 0.5);
  if (shifted === undefined) return undefined;
  const { head, zn, b } = shifted;
  const c = new Complex((b.re * b.re + b.im * b.im) / b.re, 0);
  const d = c.sub(b);
  // (|Im b|/|b|)^J·J^(|s|) reaching 1e−17 needs about this many terms.
  const ratio = d.abs() / c.re;
  if (!(ratio < 1)) return undefined;
  if (Math.log(1e-17) / Math.log(ratio) > TAYLOR_MAX_TERMS) return undefined;
  const eps = Number.EPSILON;
  let sum = C_ZERO;
  let error = 0;
  let coefficient = new Complex(1, 0); // (s)_j/j!·(c − a)^j
  for (let j = 0; j < TAYLOR_MAX_TERMS; j++) {
    if (j > 0)
      coefficient = coefficient
        .mul(s.add(new Complex(j - 1, 0)))
        .div(j)
        .mul(d);
    const inner = lerchRealBaseWithError(z, s.add(new Complex(j, 0)), c);
    if (inner === undefined) return undefined;
    const t = coefficient.mul(inner.value);
    sum = sum.add(t);
    error += t.abs() * (inner.error + eps * (3 * j + 8));
    if (j > 3 && t.abs() < 1e-17 * sum.abs()) {
      const out = head.add(zn.mul(sum));
      const headLoss = (1e-15 * shifted.largest) / out.abs();
      const relative =
        ((error / sum.abs()) * zn.mul(sum).abs()) / out.abs() + headLoss;
      if (!out.isFinite() || !(headLoss <= MAX_LOSS) || !(relative <= ACCURACY))
        return undefined;
      return out;
    }
  }
  return undefined;
}

/**
 * The Lerch transcendent Φ(z,s,a) = Σ_{k≥0} zᵏ(k+a)^(−s), within about
 * 1e−11 relative. Returns `undefined` where no method can vouch for that
 * accuracy (see `lerchSeriesComplex`, `lerchEulerComplex`,
 * `lerchContinuedComplex`, `lerchModesComplex` and `lerchTaylorComplex`) —
 * the caller keeps the expression symbolic
 * rather than ship an unverified number.
 */
export function lerchPhiComplex(
  z: Complex,
  s: Complex,
  a: Complex
): Complex | undefined {
  if (z.isNaN() || s.isNaN() || a.isNaN()) return C_NAN;
  if (z.im === 0 && z.re === 1) return hurwitzZetaComplex(s, a); // Φ(1,s,a) = ζ(s,a)
  if (z.isZero()) return a.pow(s.neg()); // Φ(0,s,a) = a^(−s): only k = 0 survives
  if (s.im === 0 && s.re === 0)
    return new Complex(1, 0).div(new Complex(1, 0).sub(z)); // Φ(z,0,a) = 1/(1−z)
  const absZ = z.abs();
  const onRim = z.im !== 0 && Math.abs(absZ - 1) < 1e-9;
  // Past the unit disk and on its rim: the continuation. It declines by
  // itself where `incompleteGammaUpperComplex` declines or where its terms
  // cancel too far (see `lerchContinuedComplex`), so this dispatcher does
  // not need to special-case z. Where it declines (mostly Re(s) < 0 with a
  // large |z|), the modes route for a real a, then the Taylor series in a
  // for a complex a. A complex a first tries the continuation again with a
  // moved only to Re(a) ≥ 1/2: on the 245 complex-a points with
  // 30 ≤ |z| ≤ 1000 of the sweeps, the target 1 alone answers 151 and the
  // target 1/2 alone 166, every one of the 151 among them, none wrong. A
  // target of 1/4 once answered a point 9.9e−11 off, when the error
  // estimate did not count the quadrature error of the tail integral. The
  // estimate now counts it (see `hermiteTail`), but it is pessimistic for a
  // small Re(a): on 2400 points past the unit circle with a moved only to
  // Re(a) ≥ 1/4, it declined 54 more, all with Re(a) < 0.56 and none off
  // by more than 1.7e−14. So 1/2 stays the lowest target used.
  if (absZ > 1 || onRim)
    return (
      lerchContinuedComplex(z, s, a) ??
      (a.im !== 0 ? lerchContinuedComplex(z, s, a, 0.5) : undefined) ??
      lerchModesComplex(z, s, a) ??
      lerchTaylorComplex(z, s, a)
    );
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
    const even = hurwitzZetaComplex(s, a.mul(half));
    const odd = hurwitzZetaComplex(s, a.add(new Complex(1, 0)).mul(half));
    const scale = new Complex(2, 0).pow(s.neg());
    const out = even.sub(odd).mul(scale);
    const lost =
      (1e-16 * Math.max(even.abs(), odd.abs()) * scale.abs()) / out.abs();
    if (out.isFinite() && lost <= MAX_LOSS) return out;
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
