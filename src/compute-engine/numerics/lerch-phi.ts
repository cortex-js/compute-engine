import { Complex } from 'complex-esm';
import {
  gamma,
  hurwitzZetaComplex,
  incompleteGammaUpperComplex,
} from './numeric-complex.js';
import { hurwitzZeta } from './special-functions.js';

// Lerch transcendent Φ(z,s,a) = Σ_{k≥0} zᵏ(k+a)^(−s), in machine floats.
// Measured against mpmath's `lerchphi` over random points, the values
// returned are within about 1e−11 relative (most within 1e−14); where a
// method cannot vouch for that, it declines (returns `undefined`) instead.
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

const C_ZERO = new Complex(0, 0);
const C_NAN = new Complex(NaN, NaN);

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
 *   Φ(−0.3, −30, 1), whose terms reach 1e29 and cancel to −7.7e16.
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
  for (let k = 0; k <= maxN; k++) {
    const term = zn.mul(zk).mul(new Complex(b.re + k, b.im).pow(negS));
    sum = sum.add(term);
    const size = term.abs();
    largest = Math.max(largest, size);
    const rho = Math.max(size / previous, absZ);
    const total = sum.add(head).abs();
    // A zero term (zᵏ underflowed) leaves nothing more to add.
    if (
      size === 0 ||
      (size < previous && rho < 1 && (size * rho) / (1 - rho) <= 1e-17 * total)
    ) {
      if (++settled === 3) {
        if (!((1e-16 * largest) / total <= MAX_LOSS)) return undefined;
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

/** 20-point Gauss-Legendre nodes and weights on [−1, 1], by Newton on P₂₀
 * — for `hermiteTail`'s integral, which has no closed form. */
const GAUSS: { x: number[]; w: number[] } = (() => {
  const n = 20;
  const x: number[] = [];
  const w: number[] = [];
  for (let i = 1; i <= n; i++) {
    let t = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let dp = 0;
    for (let iter = 0; iter < 100; iter++) {
      let p0 = 1;
      let p1 = t;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * t * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      dp = (n * (t * p1 - p0)) / (t * t - 1);
      const step = p1 / dp;
      t -= step;
      if (Math.abs(step) < 1e-16) break;
    }
    x.push(t);
    w.push(2 / ((1 - t * t) * dp * dp));
  }
  return { x, w };
})();

/** Where the Hermite integrand is below double precision: its decay is at
 * worst e^{−πt}. */
const T_MAX = 40;
const PANELS = 80;

/**
 * −2∫₀^∞ sin(t·log z − s·arctan(t/a)) / ((a²+t²)^(s/2)(e^{2πt} − 1)) dt —
 * the part of the Hermite integral representation with no closed form (see
 * `lerchContinuedComplex`).
 */
function hermiteTail(logZ: Complex, s: Complex, a: Complex): Complex {
  const halfS = s.mul(0.5);
  const a2 = a.mul(a);
  let sum = C_ZERO;
  const h = T_MAX / PANELS;
  for (let p = 0; p < PANELS; p++) {
    for (let i = 0; i < GAUSS.x.length; i++) {
      const t = h * (p + 0.5 + 0.5 * GAUSS.x[i]);
      const phase = logZ.mul(t).sub(s.mul(new Complex(t, 0).div(a).atan()));
      const denom = a2
        .add(new Complex(t * t, 0))
        .pow(halfS)
        .mul(Math.expm1(2 * Math.PI * t));
      sum = sum.add(
        phase
          .sin()
          .div(denom)
          .mul(0.5 * h * GAUSS.w[i])
      );
    }
  }
  return sum.mul(-2);
}

/**
 * `incompleteGammaUpperComplex(σ, x)` is accurate only in part of the plane
 * (cortex-js/compute-engine#353). Measured against mpmath's `gammainc` for
 * the σ = 1 − s used here (|σ| ≤ 13), by the method the kernel selects:
 *
 * - Re(x) ≤ 0 and |x| > 2.5: digits lost (1e−9 and worse by |x| = 3).
 * - |x| > |σ| + 14 and |x| > 12, the asymptotic series: its error is the
 *   size of the smallest term, where the series is truncated. That term is
 *   still 1e−3 of the sum at |x| − |σ| = 15 and falls below 1e−14 only past
 *   about |x| − |σ| = 50.
 * - An integer σ ≤ 0 otherwise, the downward recurrence from E₁(x): within
 *   1e−13 for |x| ≤ 2.5, but past that E₁'s power series cancels, with
 *   errors of 1e−5 at |x| = 10 and of order 1 by |x| = 15.
 * - Re(x) > 0 and |x| ≥ |σ| + 1, the continued fraction: within 1e−14.
 * - Otherwise Γ(σ) − γ(σ,x), with γ by its power series: this cancels when
 *   Γ(σ,x) is small next to Γ(σ) or next to the largest series term, even
 *   for a small |x| when σ is close to a negative integer (7.7e−11 at
 *   σ = −3.003, x = 0.41 + 1.58i).
 *
 * This estimate follows that dispatch and returns a bound on the relative
 * error of `value` = Γ(σ,x): the smallest asymptotic term, a cancellation
 * estimate for Γ(σ) − γ(σ,x), 1e−14 for the continued fraction and for the
 * recurrence at |x| ≤ 2.5, and `Infinity` where the kernel is unreliable. The estimate
 * stays valid (it only becomes too cautious) when the kernel is improved.
 */
const INCOMPLETE_GAMMA_SMALL_RADIUS = 2.5;

function incompleteGammaRelativeError(
  sigma: Complex,
  x: Complex,
  value: Complex
): number {
  const ax = x.abs();
  if (!(x.re > 0) && ax > INCOMPLETE_GAMMA_SMALL_RADIUS) return Infinity;
  const sAbs = sigma.abs();
  if (ax > sAbs + 14 && ax > 12) {
    // The asymptotic series Σ_k (σ−1)(σ−2)…(σ−k)/xᵏ, truncated at its
    // smallest term, as `upperGammaAsymptoticComplex` does.
    let term = 1;
    let sum = new Complex(1, 0);
    let t = new Complex(1, 0);
    for (let k = 1; k < 1000; k++) {
      const next = t.mul(sigma.sub(k)).div(x);
      if (next.abs() > term) break;
      t = next;
      term = next.abs();
      sum = sum.add(next);
      if (term < 1e-17 * sum.abs()) break;
    }
    return term / sum.abs() + 1e-15;
  }
  if (sigma.im === 0 && Number.isInteger(sigma.re) && sigma.re <= 0)
    return ax <= INCOMPLETE_GAMMA_SMALL_RADIUS ? 1e-14 : Infinity;
  if (x.re > 0 && ax >= sAbs + 1) return 1e-14;
  // γ(σ,x) = x^σ·e^(−x)·Σ_k xᵏ/(σ(σ+1)…(σ+k)): each term is rounded to
  // about 1e−16 of its size, and Γ(σ) has an error of the same order. The
  // factor 1e−14 (not 1e−16) is a safety margin: against mpmath, the actual
  // error reached 30 times the 1e−16 estimate (σ = −8.063, where Γ(σ) comes
  // from the reflection formula).
  let term = 1 / sigma.abs();
  let sizes = term;
  for (let k = 1; k < 2000; k++) {
    term = (term * ax) / sigma.add(k).abs();
    sizes += term;
    if (term < 1e-17 * sizes) break;
  }
  const scale = x.pow(sigma).mul(x.neg().exp()).abs();
  return (1e-14 * (gamma(sigma).abs() + scale * sizes)) / value.abs();
}

/**
 * Φ(z,s,a) past |z| = 1 (and on the rim itself, where direct summation is
 * only conditionally convergent), by the Hermite-type integral
 * representation valid for Re(a) > 0 (the one mpmath documents):
 *
 *   Φ(z,s,a) = 1/(2aˢ) + ∫₀^∞ zᵗ(a+t)^(−s) dt
 *              − 2∫₀^∞ sin(t·log z − s·arctan(t/a)) / ((a²+t²)^(s/2)(e^{2πt} − 1)) dt.
 *
 * The first integral is closed: z^(−a)(−log z)^(s−1)Γ(1−s,−a·log z), the
 * upper incomplete gamma's continuation carrying Φ past the unit circle.
 * The second converges for every z off the cut, since |sin(t·log z)| grows
 * at most like e^{πt} against e^{2πt}. Other a are brought to Re(a) ≥ 1 by
 * Φ(z,s,a) = a^(−s) + z·Φ(z,s,a+1), dropping a (a+k) = 0 term as the series
 * does (`shiftBase`).
 *
 * Declines (returns `undefined`) when −Re(a) is too large for the shift
 * (`MAX_BASE_SHIFT`), when `incompleteGammaUpperComplex`'s
 * argument is outside its calibrated-reliable region
 * (`incompleteGammaRelativeError`) or when the head/tail split has
 * cancelled below what the cancellation estimate below can vouch for —
 * never a wrong number.
 */
function lerchContinuedComplex(
  z: Complex,
  s: Complex,
  a: Complex
): Complex | undefined {
  // Shift a to Re(a) ≥ 1: Φ(a) = Σ_{k<m} zᵏ(a+k)^(−s) + zᵐΦ(a+m).
  const shifted = shiftBase(z, s, a, 1);
  if (shifted === undefined) return undefined;
  const { head, zn: zk, b } = shifted;
  const logZ = z.log();
  // On the cut (real z > 1) Φ takes the side below it, z − i0, as mpmath
  // and Wolfram do: −log z must sit on the upper lip (+0i), where
  // `incompleteGammaUpperComplex`'s branch has its x < 0. Negating a real
  // log would give −0i and put the power on the other side of its cut.
  const negLogZ =
    z.im === 0 && z.re > 1 ? new Complex(-logZ.re, 0) : logZ.mul(-1);
  const x = negLogZ.mul(b);
  const sigma = new Complex(1, 0).sub(s);
  const upper = incompleteGammaUpperComplex(sigma, x);
  if (upper.isNaN() || !upper.isFinite()) return undefined;
  const upperError = incompleteGammaRelativeError(sigma, x, upper);
  if (!(upperError <= 1e-12)) return undefined;
  const closed = negLogZ
    .mul(b)
    .exp()
    .mul(negLogZ.pow(s.sub(new Complex(1, 0))))
    .mul(upper);
  const terms = [
    new Complex(0.5, 0).div(b.pow(s)),
    closed,
    hermiteTail(logZ, s, b),
  ];
  const phi = terms.reduce((acc, t) => acc.add(t), C_ZERO);
  const out = head.add(zk.mul(phi));
  // The terms can cancel far below double precision (Φ(10,10,10) ≈ 4e−11
  // from terms of order 1): each carries a rounding error of about 1e−15 of
  // its size, and the closed term also the incomplete gamma's own error.
  // When the resulting relative error of the value exceeds `MAX_LOSS`,
  // decline rather than ship a wrong number.
  const size = Math.max(
    head.abs(),
    zk.abs() * Math.max(...terms.map((t) => t.abs()))
  );
  const lost =
    (1e-15 * size + upperError * zk.abs() * closed.abs()) / out.abs();
  if (!out.isFinite() || !(lost <= MAX_LOSS)) return undefined;
  return out;
}

/**
 * The Lerch transcendent Φ(z,s,a) = Σ_{k≥0} zᵏ(k+a)^(−s), within about
 * 1e−11 relative. Returns `undefined` where no method can vouch for that
 * accuracy (see `lerchSeriesComplex`, `lerchEulerComplex` and
 * `lerchContinuedComplex`) — the caller keeps the expression symbolic
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
  // Past the unit disk and on its rim, `incompleteGammaUpperComplex`'s
  // argument can land where that kernel is inaccurate (for example next to
  // its negative real axis, for any real z < −1) — `lerchContinuedComplex`
  // declines there itself, on the calibrated `incompleteGammaRelativeError`
  // estimate, so this dispatcher does not need to special-case z.
  if (absZ > 1 || onRim) return lerchContinuedComplex(z, s, a);
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
  // by analytic continuation. The difference can cancel, so it is checked
  // like the sums above.
  if (z.im === 0 && z.re === -1 && a.im === 0) {
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
