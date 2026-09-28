import { Complex } from 'complex-esm';
import {
  hurwitzZetaComplex,
  incompleteGammaUpperComplex,
} from './numeric-complex.js';

// Lerch transcendent Φ(z,s,a) = Σ_{k≥0} zᵏ(k+a)^(−s), machine precision.
// Generalizes the Hurwitz zeta (Φ(1,s,a) = ζ(s,a), delegated to
// `hurwitzZetaComplex`) and the polylogarithm (Liₛ(z) = z·Φ(z,s,1), not
// wired up here — a separate widening of `PolyLog`).
//
// |z| < 1: the zᵏ factor gives geometric convergence, so direct summation
// (`lerchSeriesComplex`) reaches full double precision. Real z < 0 uses the
// van Wijngaarden Euler transform instead (`lerchEulerComplex`): the series
// still converges there, but only conditionally, and stalls on the |z| = 1
// rim — Φ(−1,1,1) = ln 2 needs on the order of 10^17 terms for direct
// summation to reach even single-digit accuracy, where the transform
// reaches double precision in a few dozen. |z| ≥ 1 (off z = 1) needs
// analytic continuation past the disk of convergence, by the Hermite-type
// integral representation valid for Re(a) > 0 (`lerchContinuedComplex`).

const C_ZERO = new Complex(0, 0);
const C_NAN = new Complex(NaN, NaN);

/**
 * Σ_{k≥0} zᵏ(k+a)^(−s) for |z| < 1, by direct summation, capped at 2 million
 * terms. The (k+a) = 0 term (a a non-positive integer) is dropped rather
 * than diverging — the same convention `hurwitzZetaComplex` uses; callers
 * decide pole vs. finite from Re(s) and z (see `evaluateLerchPhi`,
 * `library/arithmetic.ts`).
 *
 * Returns `undefined` when the term size never reaches the break tolerance
 * within the cap: |z| close enough to 1 needs more terms than the cap
 * allows (e.g. |z| = 1 − 1e−10 needs on the order of 10^11), and summing
 * only part of the series would silently drop the tail. `lerchPhiComplex`
 * falls back to `lerchContinuedComplex` there — the Hermite integral
 * representation holds on the whole plane off the z = 1 branch point, not
 * only past |z| = 1.
 */
function lerchSeriesComplex(
  z: Complex,
  s: Complex,
  a: Complex
): Complex | undefined {
  const absZ = z.abs();
  // term ~ |z|ᵏ, so log|z| sets how many terms reach machine precision.
  const maxN = Math.min(
    2_000_000,
    Math.ceil(Math.log(1e-17) / Math.log(absZ)) + 64
  );
  const negS = s.neg();
  let sum = C_ZERO;
  let zk = new Complex(1, 0);
  for (let k = 0; k <= maxN; k++) {
    const b = new Complex(a.re + k, a.im);
    if (!(b.re === 0 && b.im === 0)) {
      const term = zk.mul(b.pow(negS));
      sum = sum.add(term);
      if (k > 8 && term.abs() < 1e-16 * (sum.abs() + 1e-16)) return sum;
    }
    zk = zk.mul(z);
  }
  return undefined; // never reached the break tolerance — the cap ran out
}

/**
 * Σ_{k≥0} zᵏ(k+a)^(−s) for real z in [−1, 0), by the van Wijngaarden Euler
 * transform (Numerical Recipes' `eulsum`), carried through the complex
 * terms. The signed, alternating terms are fed in one at a time; the
 * repeated-averaging table it builds reaches double precision in a few
 * dozen terms where direct summation on the |z| = 1 rim does not converge
 * in any practical number of terms.
 */
function lerchEulerComplex(zRe: number, s: Complex, a: Complex): Complex {
  const negS = s.neg();
  const wr: number[] = [];
  const wi: number[] = [];
  let nterm = 0;
  let sumR = 0;
  let sumI = 0;
  let zPow = 1; // zᵏ (signed: z < 0 makes the terms alternate)
  for (let k = 0; k < 512; k++, zPow *= zRe) {
    const b = new Complex(a.re + k, a.im);
    let curR = 0;
    let curI = 0;
    if (!(b.re === 0 && b.im === 0)) {
      const t = b.pow(negS);
      curR = zPow * t.re;
      curI = zPow * t.im;
    }
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
    if (
      k > 4 &&
      Math.hypot(incR, incI) < 1e-17 * (Math.hypot(sumR, sumI) + 1e-17)
    )
      break;
  }
  return new Complex(sumR, sumI);
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
 * `incompleteGammaUpperComplex(σ, x)` loses digits for Re(x) < 0 well inside
 * the band its own comment describes (#353). Against mpmath, over Re(x) < 0
 * and the σ = 1 − s used here, it stays within 1e−13 only while |x| ≤ 2.75;
 * decline past 2.5.
 */
const INCOMPLETE_GAMMA_NEGATIVE_AXIS_RADIUS = 2.5;

function incompleteGammaArgumentReliable(x: Complex): boolean {
  return !(x.re < 0 && x.abs() > INCOMPLETE_GAMMA_NEGATIVE_AXIS_RADIUS);
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
 * does.
 *
 * Declines (returns `undefined`) when `incompleteGammaUpperComplex`'s
 * argument is outside its calibrated-reliable region
 * (`incompleteGammaArgumentReliable`) or when the head/tail split has
 * cancelled below what the cancellation estimate below can vouch for —
 * never a wrong number.
 */
function lerchContinuedComplex(
  z: Complex,
  s: Complex,
  a: Complex
): Complex | undefined {
  // Shift a to Re(a) ≥ 1: Φ(a) = Σ_{k<m} zᵏ(a+k)^(−s) + zᵏΦ(a+m).
  let head = C_ZERO;
  let zk = new Complex(1, 0);
  let b = a;
  const negS = s.neg();
  while (b.re < 1) {
    if (!(b.re === 0 && b.im === 0)) head = head.add(zk.mul(b.pow(negS)));
    zk = zk.mul(z);
    b = b.add(new Complex(1, 0));
  }
  const logZ = z.log();
  // On the cut (real z > 1) Φ takes the side below it, z − i0, as mpmath
  // and Wolfram do: −log z must sit on the upper lip (+0i), where
  // `incompleteGammaUpperComplex`'s branch has its x < 0. Negating a real
  // log would give −0i and put the power on the other side of its cut.
  const negLogZ =
    z.im === 0 && z.re > 1 ? new Complex(-logZ.re, 0) : logZ.mul(-1);
  const x = negLogZ.mul(b);
  if (!incompleteGammaArgumentReliable(x)) return undefined;
  const gamma = incompleteGammaUpperComplex(new Complex(1, 0).sub(s), x);
  if (gamma.isNaN() || !gamma.isFinite()) return undefined;
  const closed = negLogZ
    .mul(b)
    .exp()
    .mul(negLogZ.pow(s.sub(new Complex(1, 0))))
    .mul(gamma);
  const terms = [
    new Complex(0.5, 0).div(b.pow(s)),
    closed,
    hermiteTail(logZ, s, b),
  ];
  const phi = terms.reduce((acc, t) => acc.add(t), C_ZERO);
  const out = head.add(zk.mul(phi));
  // The terms can cancel far below double precision (Φ(10,10,10) ≈ 4e−11
  // from terms of order 1): when the digits lost exceed what this can
  // vouch for, decline rather than ship a wrong number.
  const size = Math.max(
    head.abs(),
    zk.abs() * Math.max(...terms.map((t) => t.abs()))
  );
  const lost = (1e-15 * size) / out.abs();
  if (!out.isFinite() || !(lost < 1e-10)) return undefined;
  return out;
}

/**
 * The Lerch transcendent Φ(z,s,a) = Σ_{k≥0} zᵏ(k+a)^(−s), machine
 * precision. Returns `undefined` where the continuation past |z| = 1
 * declines (see `lerchContinuedComplex`) — the caller keeps the expression
 * symbolic rather than ship an unverified number.
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
  // A negative real or complex z, or a positive real z far enough past 1,
  // can all put `incompleteGammaUpperComplex`'s argument next to its
  // negative real axis (any z with Re(log z) < 0, or real z > 1 once
  // a·log z is large enough) — `lerchContinuedComplex` declines there
  // itself, on the calibrated `incompleteGammaArgumentReliable` check, so
  // this dispatcher does not need to special-case z's sign.
  if (absZ > 1 || onRim) return lerchContinuedComplex(z, s, a);
  if (z.im === 0 && z.re < 0) return lerchEulerComplex(z.re, s, a);
  // |z| close enough to 1 that the direct series can't reach machine
  // precision within its term cap (see `lerchSeriesComplex`) falls back to
  // the same continuation used past |z| = 1 — valid there too, off the
  // z = 1 branch point.
  return lerchSeriesComplex(z, s, a) ?? lerchContinuedComplex(z, s, a);
}

/** Real-valued Φ(z,s,a) for real z, s, a — for the compiled (JS/GPU)
 * real-scalar path. `NaN` both for a genuinely complex value (e.g. a < 0
 * with a non-integer s) and for a declined continuation. */
export function lerchPhiReal(z: number, s: number, a: number): number {
  if (Number.isNaN(z) || Number.isNaN(s) || Number.isNaN(a)) return NaN;
  const result = lerchPhiComplex(
    new Complex(z, 0),
    new Complex(s, 0),
    new Complex(a, 0)
  );
  if (
    result === undefined ||
    Math.abs(result.im) > 1e-9 * (Math.abs(result.re) + 1)
  )
    return NaN;
  return result.re;
}
