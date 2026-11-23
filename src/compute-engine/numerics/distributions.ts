import { checkDeadline } from '../../common/interruptible.js';
import {
  betaRegularized,
  erfInv,
  gammaP,
  gammaQ,
} from './special-functions.js';
import type { Rational } from './types.js';

//
// Distribution-specific numeric glue. The continuous distributions have
// closed-form quantiles (Normal via `erfInv`, Uniform/Exponential elementary),
// so only the discrete distributions need a numeric search here.
//
// A discrete `Quantile(p)` is the least integer `k` on the support with
// `CDF(k) ≥ p`. The CDF is monotone increasing, so we bracket with the normal
// approximation (`mean ± z·stddev`) and step to the exact integer — O(1) in
// practice. The result is an exact integer, so a machine-precision CDF is
// sufficient to identify it even under a high-precision `.N()`.
//

/**
 * Least integer `k ∈ [kMin, kMax]` with `cdf(k) ≥ prob`, found by a monotone
 * search seeded from the normal approximation. `kMax` may be `+∞` (Poisson).
 */
export function discreteQuantile(
  cdf: (k: number) => number,
  prob: number,
  mean: number,
  stddev: number,
  kMin: number,
  kMax: number,
  deadline?: number
): number {
  if (prob <= 0) return kMin;
  if (prob >= 1) return kMax;

  // A tiny tolerance makes the `CDF(k) ≥ p` boundary inclusive against
  // round-off: when `p` is itself a CDF value (the `Quantile(CDF(k)) = k`
  // identity) it may be recomputed a few ulps above the machine CDF used in
  // this search, which would otherwise overshoot by one.
  const target = prob - 1e-12;

  // Seed from the normal-approximation inverse-CDF, then correct.
  let k = Math.round(mean + Math.SQRT2 * erfInv(2 * prob - 1) * stddev);
  if (!Number.isFinite(k)) k = Math.round(mean);
  k = Math.max(k, kMin);
  if (Number.isFinite(kMax)) k = Math.min(k, kMax);

  let guard = 0;
  // Step up while the CDF is still below the target probability.
  while (k < kMax && cdf(k) < target) {
    k++;
    if ((++guard & 0x3ff) === 0) checkDeadline(deadline);
  }
  // Step down while the previous integer already reaches the target.
  while (k > kMin && cdf(k - 1) >= target) {
    k--;
    if ((++guard & 0x3ff) === 0) checkDeadline(deadline);
  }
  return k;
}

/** Quantile of Binomial(n, p) at probability `prob` (an integer in [0, n]). */
export function binomialQuantile(
  n: number,
  p: number,
  prob: number,
  deadline?: number
): number {
  const mean = n * p;
  const stddev = Math.sqrt(n * p * (1 - p));
  // CDF(k) = P(X ≤ k) = I_{1−p}(n−k, k+1); the kernel is undefined at a=0,
  // so the k ≥ n endpoint (CDF = 1) is handled explicitly.
  const cdf = (k: number): number =>
    k >= n ? 1 : k < 0 ? 0 : betaRegularized(1 - p, n - k, k + 1);
  return discreteQuantile(cdf, prob, mean, stddev, 0, n, deadline);
}

/** Quantile of Poisson(λ) at probability `prob` (a non-negative integer). */
export function poissonQuantile(
  lambda: number,
  prob: number,
  deadline?: number
): number {
  const mean = lambda;
  const stddev = Math.sqrt(lambda);
  // CDF(k) = P(X ≤ k) = Q(k+1, λ).
  const cdf = (k: number): number => (k < 0 ? 0 : gammaQ(k + 1, lambda));
  return discreteQuantile(cdf, prob, mean, stddev, 0, Infinity, deadline);
}

//
// Exact discrete quantiles. The float search above compares a machine CDF
// against `p` with a tolerance, so it can miss by one support point when an
// exact `p` is within that tolerance of a CDF jump. The two functions below
// decide each test `CDF(k) ≥ p` exactly, with bigint rationals, and use the
// float search only to choose the first `k` to test. Every input is a
// rational `[numerator, denominator]` with a positive denominator, and
// `0 < p < 1` (the caller answers `p = 0` and `p = 1`).
//

/** `r` with bigint numerator and denominator, for the two functions below. */
export function bigRational(r: Rational): [bigint, bigint] {
  return [BigInt(r[0]), BigInt(r[1])];
}

/** The largest `n·log₂(b)` of a binomial `Binomial(n, a/b)` that the
 * exact search accepts: it is about the size in bits of the bigints of a
 * test (about 80 ms at `n = 25000`, `b = 2`, `k = n/2`). */
const EXACT_BINOMIAL_MAX_BITS = 50_000;

/** The largest `λ` of a Poisson that the exact search accepts: a test
 * computes `b^m·m!` with `m > λ` (about 10 ms at `λ = 1000`, 1 s at
 * `λ = 9000`). */
const EXACT_POISSON_MAX_LAMBDA = 1_000;

/** The largest size in bits of the denominator `b` of a Poisson `λ = a/b`
 * that the exact search accepts: a test computes `b^m` with `m > λ + 32`,
 * before it can check the deadline. */
const EXACT_POISSON_MAX_DENOMINATOR_BITS = 64;

/** `n/d` as a double, for `d > 0`, also when `n` or `d` is beyond the
 * double range: both are first shifted to about 64 bits. Only the seed of a
 * search uses it. */
function ratio(n: bigint, d: bigint): number {
  const shift = Math.max(n.toString(2).length, d.toString(2).length) - 64;
  if (shift <= 0) return Number(n) / Number(d);
  const s = BigInt(shift);
  return Number(n >> s) / Number(d >> s);
}

/** Number of `k ± 1` steps from the float candidate before the exact search
 * gives up: the float search is never that far off. */
const EXACT_QUANTILE_MAX_STEPS = 64;

/**
 * The least `k` in `[0, kMax]` with `atLeast(k)` true, by steps from
 * `start`, given that `atLeast` is monotone and `atLeast(kMax)` is true.
 * `undefined` when `atLeast` gives `undefined` or the steps run out.
 */
function stepToQuantile(
  atLeast: (k: number) => boolean | undefined,
  start: number,
  kMax: number,
  deadline?: number
): number | undefined {
  if (!Number.isFinite(start)) return undefined;
  let k = Math.min(Math.max(start, 0), kMax);
  const first = atLeast(k);
  if (first === undefined) return undefined;
  for (let i = 0; i < EXACT_QUANTILE_MAX_STEPS; i++) {
    checkDeadline(deadline);
    if (first) {
      // Step down while the previous integer reaches `p` too.
      if (k === 0) return 0;
      const below = atLeast(k - 1);
      if (below === undefined) return undefined;
      if (!below) return k;
      k -= 1;
    } else {
      // Step up until the CDF reaches `p`.
      if (k >= kMax) return kMax;
      k += 1;
      const here = atLeast(k);
      if (here === undefined) return undefined;
      if (here) return k;
    }
  }
  return undefined;
}

/**
 * Exact quantile of `Binomial(n, a/b)` at `p = c/d`: the least integer `k`
 * with `CDF(k) ≥ p`. `b^n·CDF(k) = Σ_{i≤k} C(n, i)·a^i·(b − a)^(n−i)`, so
 * the test is `d·Σ ≥ c·b^n`, in integers. `undefined` when `n·log₂(b)` is
 * above `EXACT_BINOMIAL_MAX_BITS` or the search does not end in a few steps.
 */
export function binomialQuantileExact(
  n: number,
  [a, b]: [bigint, bigint],
  [c, d]: [bigint, bigint],
  deadline?: number
): number | undefined {
  if (!Number.isInteger(n) || n < 0) return undefined;
  if (b <= 0n || a < 0n || a > b || d <= 0n || c <= 0n || c >= d)
    return undefined;
  if (n * b.toString(2).length > EXACT_BINOMIAL_MAX_BITS) return undefined;
  const N = BigInt(n);
  const bn = b ** N;
  const q = b - a;
  // Σ_{i≤j} C(n, i)·x^i·y^(n−i) = y^(n−j)·Σ_{i≤j} C(n, i)·x^i·y^(j−i), the
  // second sum by Horner's rule.
  const head = (j: number, x: bigint, y: bigint): bigint => {
    let binom = 1n;
    let xPow = 1n;
    let sum = 0n;
    for (let i = 0; i <= j; i++) {
      if (i > 0) {
        binom = (binom * (N - BigInt(i - 1))) / BigInt(i);
        xPow *= x;
      }
      sum = sum * y + binom * xPow;
      if ((i & 0xff) === 0xff) checkDeadline(deadline);
    }
    return sum * y ** BigInt(n - j);
  };
  const atLeast = (k: number): boolean => {
    if (k >= n) return true;
    // The shorter of the two sums: the CDF itself, or the upper tail
    // `Σ_{i>k} = Σ_{j<n−k} C(n, j)·q^j·a^(n−j)`, with `CDF(k) ≥ p` exactly
    // when `d·tail ≤ (d − c)·b^n`.
    if (k <= n - k - 1) return d * head(k, a, q) >= c * bn;
    return d * head(n - k - 1, q, a) <= (d - c) * bn;
  };
  const start = binomialQuantile(n, ratio(a, b), ratio(c, d), deadline);
  return stepToQuantile(atLeast, start, n, deadline);
}

/**
 * Exact quantile of `Poisson(a/b)` at `p = c/d`: the least integer `k` with
 * `CDF(k) ≥ p`.
 *
 * With the terms `t_j = λ^j / j!`, `T_k = Σ_{j≤k} t_j` and the tail
 * `R_k = Σ_{j>k} t_j`, `CDF(k) = T_k / (T_k + R_k)`, so the test is
 * `(1 − p)·T_k ≥ p·R_k`. `R_k` has no closed form, so it is bracketed: it is
 * at least `Σ_{k<j≤m} t_j`, and at most that plus
 * `t_{m+1}·(m+2) / (m+2−λ)` (a geometric bound, valid when `m + 2 > λ`).
 * The bracket is made narrower until it decides the test. The test is never
 * an equality, since `CDF(k) = p` would make `e^λ` rational.
 *
 * All terms are integers over the common denominator `b^m·m!`:
 * `w_j = a^j·b^(m−j)·m!/j!`, with `w_0 = b^m·m!` and
 * `w_{j+1} = w_j·a / (b·(j+1))` (an exact division).
 */
export function poissonQuantileExact(
  [a, b]: [bigint, bigint],
  [c, d]: [bigint, bigint],
  deadline?: number
): number | undefined {
  if (b <= 0n || a <= 0n || d <= 0n || c <= 0n || c >= d) return undefined;
  if (b.toString(2).length > EXACT_POISSON_MAX_DENOMINATOR_BITS)
    return undefined;
  const lambda = ratio(a, b);
  if (!(lambda <= EXACT_POISSON_MAX_LAMBDA)) return undefined;
  const atLeast = (k: number): boolean | undefined => {
    // `extra` terms past `k` and past `λ`, doubled while undecided.
    for (let extra = 32; extra <= 4096; extra *= 2) {
      const m = Math.max(k, Math.ceil(lambda)) + extra;
      const M = BigInt(m);
      let w = b ** M;
      for (let j = 2n; j <= M; j++) w *= j;
      let tk = 0n;
      let rlo = 0n;
      for (let j = 0; j <= m; j++) {
        if (j > 0) w = (w * a) / (b * BigInt(j));
        if (j <= k) tk += w;
        else rlo += w;
        if ((j & 0xff) === 0xff) checkDeadline(deadline);
      }
      // Here `w` is `w_m`.
      const lhs = (d - c) * tk;
      if (lhs < c * rlo) return false;
      // The upper bound of R: rlo + w_m·a·(m+2) / ((m+1)·((m+2)·b − a)).
      const e = (M + 1n) * ((M + 2n) * b - a);
      if (e <= 0n) continue;
      if (lhs * e >= c * (rlo * e + w * a * (M + 2n))) return true;
    }
    return undefined;
  };
  // A `p` below 1 that rounds to the double 1 gives the float seed `+∞`:
  // start the steps from a point in the far tail instead.
  let start = poissonQuantile(lambda, ratio(c, d), deadline);
  if (!Number.isFinite(start))
    start = Math.ceil(lambda + 10 * Math.sqrt(lambda) + 40);
  return stepToQuantile(atLeast, start, Infinity, deadline);
}

//
// Quantiles of the distributions with no closed-form quantile (CE-1590).
//

/**
 * The `x` in `(0, upper)` (`upper` is `+∞` or `1`) with `f(x) = target`,
 * for a monotone `f` (increasing, a CDF, or decreasing, an upper tail
 * `1 − CDF`), by bisection to adjacent doubles. `NaN` when `target` is not in
 * `(0, 1)`, when `f` gives `NaN` or when no bracket is found.
 *
 * A caller passes the upper tail for a probability above `½`, so that the
 * target keeps its relative precision where the CDF is close to 1.
 *
 * Bisection rather than Newton: it needs no density and cannot leave the
 * bracket, and each step costs one kernel call (at most about 2,200 steps,
 * for a root in the subnormal range). The bisection is geometric while the
 * bracket spans more than a factor of 4, so a root far from 1 (`10^−100`)
 * is found in a few hundred steps.
 */
export function solveMonotone(
  f: (x: number) => number,
  target: number,
  increasing: boolean,
  upper: number,
  deadline?: number
): number {
  if (!(target > 0 && target < 1)) return NaN;
  // `true` when the root is above `x`, `undefined` for a NaN kernel.
  const isBelow = (x: number): boolean | undefined => {
    const v = f(x);
    if (Number.isNaN(v)) return undefined;
    return increasing ? v < target : v > target;
  };
  let lo = 0;
  let hi = Number.isFinite(upper) ? upper : 1;
  if (!Number.isFinite(upper)) {
    // Double `hi` until the quantile is at or below it.
    for (;;) {
      const b = isBelow(hi);
      if (b === undefined) return NaN;
      if (!b) break;
      lo = hi;
      hi *= 2;
      if (!Number.isFinite(hi)) return NaN;
    }
  }
  if (lo === 0) {
    // Halve down from `hi` to a positive lower end, so that the bisection
    // below can be geometric.
    for (let x = hi / 2; x > 1e-300; x /= 2) {
      const b = isBelow(x);
      if (b === undefined) return NaN;
      if (b) {
        lo = x;
        break;
      }
      hi = x;
    }
  }
  for (let i = 0; i < 2200; i++) {
    const mid = lo > 0 && hi / lo > 4 ? Math.sqrt(lo * hi) : lo + (hi - lo) / 2;
    if (mid <= lo || mid >= hi) break;
    const b = isBelow(mid);
    if (b === undefined) return NaN;
    if (b) lo = mid;
    else hi = mid;
    if ((i & 0xff) === 0xff) checkDeadline(deadline);
  }
  return hi;
}

/**
 * The least integer `k` in `[kMin, kMax]` with `atLeast(k)` true, for a
 * monotone `atLeast` with `atLeast(kMax)` true (`kMax` may be `+∞`): a
 * doubling search from `seed` for a bracket, then a binary search. `NaN`
 * when no `k` below `2^53` is found.
 */
function leastIntegerWith(
  atLeast: (k: number) => boolean,
  seed: number,
  kMin: number,
  kMax: number,
  deadline?: number
): number {
  let k = Math.round(seed);
  if (!Number.isFinite(k)) k = kMin;
  k = Math.min(Math.max(k, kMin), kMax);
  // Above 2^53 the doubles are not consecutive integers, and the binary
  // search below could not advance.
  if (k > Number.MAX_SAFE_INTEGER) return NaN;
  let lo: number;
  let hi: number;
  if (atLeast(k)) {
    // Bracket below: `lo` fails, `hi` holds.
    hi = k;
    let step = 1;
    lo = k - step;
    while (lo >= kMin && atLeast(lo)) {
      hi = lo;
      step *= 2;
      lo = hi - step;
      checkDeadline(deadline);
    }
    if (lo < kMin) {
      if (atLeast(kMin)) return kMin;
      lo = kMin;
    }
  } else {
    lo = k;
    let step = 1;
    hi = k + step;
    while (hi < kMax && !atLeast(hi)) {
      lo = hi;
      step *= 2;
      hi = lo + step;
      if (hi > Number.MAX_SAFE_INTEGER) return NaN;
      checkDeadline(deadline);
    }
    if (hi >= kMax) hi = kMax;
  }
  // Invariant: `atLeast(lo)` is false and `atLeast(hi)` is true.
  while (hi - lo > 1) {
    const mid = Math.floor(lo + (hi - lo) / 2);
    if (mid <= lo || mid >= hi) return NaN;
    if (atLeast(mid)) hi = mid;
    else lo = mid;
    checkDeadline(deadline);
  }
  return hi;
}

/**
 * The RELATIVE tolerance of the float discrete searches below: a `p` that
 * is itself a CDF value can be recomputed a few ulps above the machine CDF,
 * which would otherwise overshoot by one. The target is `p·(1 − tolerance)`.
 * It is relative, not the absolute `1e-12` of `discreteQuantile`, because
 * with a small success probability the masses are small: Geometric(10^−15)
 * has masses of about 10^−15, and `p − 10^−12` is then a thousand support
 * points below the quantile. With `8ε` the shift there is a few points, as
 * near the resolution of a double CDF at 0.5 as a round trip allows.
 */
const DISCRETE_QUANTILE_TOLERANCE = 8 * Number.EPSILON;

/**
 * `P(X ≤ k) = 1 − (1 − p)^(k+1)` of Geometric(p), for an integer `k ≥ 0`,
 * written so that it keeps its relative precision for a small `p` or a
 * small `k`: the plain difference cancels there, and the incomplete-beta
 * form `I_p(1, k + 1)` loses about 10^−12 at `k + 1 ≈ 5·10^9`.
 */
export function geometricCDF(p: number, k: number): number {
  return -Math.expm1((k + 1) * Math.log1p(-p));
}

/**
 * Quantile of Geometric(p) (the number of failures before the first
 * success) at probability `prob`. `CDF(k) = 1 − (1 − p)^(k+1)`.
 */
export function geometricQuantile(
  p: number,
  prob: number,
  deadline?: number
): number {
  if (prob <= 0 || p >= 1) return 0;
  if (prob >= 1) return Infinity;
  const seed = Math.ceil(Math.log1p(-prob) / Math.log1p(-p)) - 1;
  return leastIntegerWith(
    discreteQuantileTest(
      prob,
      (k) => geometricCDF(p, k),
      // P(X > k) = (1 − p)^(k+1)
      (k) => Math.exp((k + 1) * Math.log1p(-p))
    ),
    seed,
    0,
    Infinity,
    deadline
  );
}

/**
 * The test `CDF(k) ≥ prob` of a float discrete quantile search, with the
 * tolerance `DISCRETE_QUANTILE_TOLERANCE` relative to the tail that holds
 * `prob`: for `prob > ½` it is `P(X > k) ≤ 1 − prob` on the upper tail
 * `sf`. A relative tolerance on `prob` itself is an absolute shift of about
 * `2·10^−15` near 1, where the masses can be smaller than that
 * (`Quantile(GeometricDistribution(0.3), 0.9999999999999991)` stopped 3
 * points short).
 */
function discreteQuantileTest(
  prob: number,
  cdf: (k: number) => number,
  sf: (k: number) => number
): (k: number) => boolean {
  if (prob <= 0.5) {
    const target = prob * (1 - DISCRETE_QUANTILE_TOLERANCE);
    return (k) => cdf(k) >= target;
  }
  const target = upperTailTarget(prob, DISCRETE_QUANTILE_TOLERANCE);
  return (k) => sf(k) <= target;
}

/**
 * The largest upper tail `P(X > k)` that still counts as reaching `prob`,
 * for `prob > ½`: `1 − prob` (exact, Sterbenz) with the relative
 * `tolerance`, and 2 ulps of `prob` more. A `prob` that is a CDF value is
 * that value rounded to a double, which moves `1 − prob` by up to half an
 * ulp; without the absolute term `Quantile(CDF(k))` gave `k + 1` near 1.
 */
function upperTailTarget(prob: number, tolerance: number): number {
  return (1 - prob) * (1 + tolerance) + Number.EPSILON;
}

/**
 * Quantile of NegativeBinomial(n, p) (the number of failures before the
 * `n`-th success) at probability `prob`. `CDF(k) = I_p(n, k + 1)`.
 */
export function negativeBinomialQuantile(
  n: number,
  p: number,
  prob: number,
  deadline?: number
): number {
  if (prob <= 0 || p >= 1) return 0;
  if (prob >= 1) return Infinity;
  const mean = (n * (1 - p)) / p;
  const stddev = Math.sqrt(n * (1 - p)) / p;
  const seed = mean + Math.SQRT2 * erfInv(2 * prob - 1) * stddev;
  return leastIntegerWith(
    discreteQuantileTest(
      prob,
      (k) => betaRegularized(p, n, k + 1),
      // P(X > k) from the kernel `CDF` evaluates, so that
      // `Quantile(CDF(k)) = k` holds: the mirrored kernel `I_{1−p}(k + 1, n)`
      // differs from it by up to 10^−12. The difference is exact (Sterbenz)
      // where it is used, for a CDF above ½.
      (k) => 1 - betaRegularized(p, n, k + 1)
    ),
    seed,
    0,
    Infinity,
    deadline
  );
}

/** The support `[lo, hi]` of Hypergeometric(n, K, N): `n` draws without
 * replacement from `N` items of which `K` are successes. */
export function hypergeometricSupport(
  n: number,
  K: number,
  N: number
): [number, number] {
  return [Math.max(0, n + K - N), Math.min(n, K)];
}

/**
 * Quantile of Hypergeometric(n, K, N) at probability `prob`.
 *
 * The masses are built as weights relative to the mass at the mode,
 * `⌊(n + 1)(K + 1)/(N + 2)⌋`, which is set to 1, outward in both directions
 * by the ratio `P(i+1)/P(i) = (K − i)(n − i) / ((i + 1)(N − K − n + i + 1))`,
 * until a weight underflows to 0. The masses themselves can be far below
 * the double range (`P(0) = 1/C(4000, 2000)` for (2000, 2000, 4000)); their
 * ratios to the largest one are not, except in tails that hold no
 * representable probability.
 */
export function hypergeometricQuantile(
  n: number,
  K: number,
  N: number,
  prob: number,
  deadline?: number
): number {
  const [lo, hi] = hypergeometricSupport(n, K, N);
  if (prob <= 0 || lo === hi) return lo;
  if (prob >= 1) return hi;
  const ratio = (i: number): number =>
    ((K - i) * (n - i)) / ((i + 1) * (N - K - n + i + 1));
  const mode = Math.min(
    Math.max(Math.floor(((n + 1) * (K + 1)) / (N + 2)), lo),
    hi
  );
  // The weights below the mode, from the mode down, then those above it.
  const below: number[] = [];
  let w = 1;
  for (let i = mode; i > lo; i--) {
    w /= ratio(i - 1);
    if (!(w > 0) || !Number.isFinite(w)) break;
    below.push(w);
    if ((i & 0x3ff) === 0) checkDeadline(deadline);
  }
  const above: number[] = [];
  w = 1;
  for (let i = mode; i < hi; i++) {
    w *= ratio(i);
    if (!(w > 0) || !Number.isFinite(w)) break;
    above.push(w);
    if ((i & 0x3ff) === 0) checkDeadline(deadline);
  }
  // The weights in order, from `first` up; the ones outside underflowed.
  const weights = [...below.reverse(), 1, ...above];
  const first = mode - below.length;
  // Smallest weights first, so that the sum keeps them.
  let total = 0;
  for (let j = 0; j < below.length; j++) total += weights[j];
  for (let j = weights.length - 1; j >= below.length; j--) total += weights[j];
  // A weight `d` steps from the mode is a product of `d` ratios, each with
  // about 4 roundings: the tolerance grows with `d`.
  const tolerance = (i: number): number =>
    DISCRETE_QUANTILE_TOLERANCE + 4 * Number.EPSILON * Math.abs(i - mode);
  if (prob <= 0.5) {
    // The least `k` with `Σ_{i≤k} w_i ≥ prob·total`.
    let sum = 0;
    for (let j = 0; j < weights.length; j++) {
      sum += weights[j];
      if (sum >= prob * total * (1 - tolerance(first + j))) return first + j;
    }
    return first + weights.length - 1;
  }
  // The least `k` with `Σ_{i>k} w_i ≤ (1 − prob)·total`, summed from the
  // top, so that a `prob` close to 1 keeps its digits (`1 − prob` is exact
  // for `prob ≥ ½`).
  let tail = 0;
  let j = weights.length - 1;
  while (
    j > 0 &&
    tail + weights[j] <= total * upperTailTarget(prob, tolerance(first + j - 1))
  ) {
    tail += weights[j];
    j -= 1;
  }
  return first + j;
}

/**
 * Exact quantile of `Geometric(a/b)` at `p = c/d`: the least `k ≥ 0` with
 * `(1 − a/b)^(k+1) ≤ 1 − c/d`, that is `d·(b − a)^(k+1) ≤ (d − c)·b^(k+1)`.
 * `undefined` when the integers of a test would exceed
 * `EXACT_BINOMIAL_MAX_BITS` or the steps run out.
 */
export function geometricQuantileExact(
  [a, b]: [bigint, bigint],
  [c, d]: [bigint, bigint],
  deadline?: number
): number | undefined {
  if (b <= 0n || a <= 0n || a > b || d <= 0n || c <= 0n || c >= d)
    return undefined;
  if (a === b) return 0;
  const start = geometricQuantile(ratio(a, b), ratio(c, d), deadline);
  if (!Number.isFinite(start)) return undefined;
  const bits = b.toString(2).length;
  if ((start + 2) * bits > EXACT_BINOMIAL_MAX_BITS) return undefined;
  const atLeast = (k: number): boolean => {
    const e = BigInt(k + 1);
    return d * (b - a) ** e <= (d - c) * b ** e;
  };
  return stepToQuantile(atLeast, start, Infinity, deadline);
}

/**
 * Exact quantile of `NegativeBinomial(n, a/b)` at `p = c/d`: the least
 * `k ≥ 0` with `CDF(k) ≥ p`. With `y = b − a`,
 * `b^(n+k)·CDF(k) = a^n·Σ_{i≤k} C(n − 1 + i, i)·y^i·b^(k−i)`, so the test is
 * `d·a^n·Σ ≥ c·b^(n+k)`, in integers.
 */
export function negativeBinomialQuantileExact(
  n: number,
  [a, b]: [bigint, bigint],
  [c, d]: [bigint, bigint],
  deadline?: number
): number | undefined {
  if (!Number.isInteger(n) || n < 1) return undefined;
  if (b <= 0n || a <= 0n || a > b || d <= 0n || c <= 0n || c >= d)
    return undefined;
  if (a === b) return 0;
  const start = negativeBinomialQuantile(n, ratio(a, b), ratio(c, d), deadline);
  if (!Number.isFinite(start)) return undefined;
  const bits = b.toString(2).length;
  if ((n + start + 64) * bits > EXACT_BINOMIAL_MAX_BITS) return undefined;
  const y = b - a;
  const an = a ** BigInt(n);
  const atLeast = (k: number): boolean => {
    let coef = 1n;
    let yPow = 1n;
    let sum = 0n;
    for (let i = 0; i <= k; i++) {
      if (i > 0) {
        coef = (coef * BigInt(n - 1 + i)) / BigInt(i);
        yPow *= y;
      }
      sum = sum * b + coef * yPow;
      if ((i & 0xff) === 0xff) checkDeadline(deadline);
    }
    return d * an * sum >= c * b ** BigInt(n + k);
  };
  return stepToQuantile(atLeast, start, Infinity, deadline);
}

/** The largest population `N` of a hypergeometric distribution that the
 * exact sums accept: a mass is a ratio of binomials of about `N` bits. */
const EXACT_HYPERGEOMETRIC_MAX_N = 20_000;

/**
 * `P(X ≤ k)` of Hypergeometric(n, K, N), exactly, as `[numerator,
 * denominator]`; `undefined` when `N` is above
 * `EXACT_HYPERGEOMETRIC_MAX_N`. `k` is an integer; below the support the
 * result is `0`, at or above its top `1`.
 */
export function hypergeometricCDFExact(
  n: number,
  K: number,
  N: number,
  k: number,
  deadline?: number
): [bigint, bigint] | undefined {
  if (N > EXACT_HYPERGEOMETRIC_MAX_N) return undefined;
  const [lo, hi] = hypergeometricSupport(n, K, N);
  if (k < lo) return [0n, 1n];
  if (k >= hi) return [1n, 1n];
  const sums = hypergeometricPartialSums(n, K, N, k, deadline);
  return [sums.sum, sums.total];
}

/** `Σ_{lo ≤ i ≤ k} C(K, i)·C(N − K, n − i)` and `C(N, n)`, for `k` in the
 * support. */
function hypergeometricPartialSums(
  n: number,
  K: number,
  N: number,
  k: number,
  deadline?: number
): { sum: bigint; total: bigint } {
  const [lo] = hypergeometricSupport(n, K, N);
  // C(K, i) and C(N − K, n − i) are carried from one `i` to the next.
  let cK = bigChoose(K, lo);
  let cR = bigChoose(N - K, n - lo);
  let sum = 0n;
  for (let i = lo; i <= k; i++) {
    if (i > lo) {
      cK = (cK * BigInt(K - i + 1)) / BigInt(i);
      // C(m, j − 1) = C(m, j)·j / (m − j + 1), with m = N − K, j = n − i + 1.
      cR = (cR * BigInt(n - i + 1)) / BigInt(N - K - n + i);
    }
    sum += cK * cR;
    if ((i & 0xff) === 0xff) checkDeadline(deadline);
  }
  return { sum, total: bigChoose(N, n) };
}

/** `C(m, j)` as a bigint, for integers `0 ≤ j ≤ m`. */
function bigChoose(m: number, j: number): bigint {
  if (j < 0 || j > m) return 0n;
  const t = Math.min(j, m - j);
  let r = 1n;
  for (let i = 1; i <= t; i++) r = (r * BigInt(m - t + i)) / BigInt(i);
  return r;
}

/**
 * Exact quantile of Hypergeometric(n, K, N) at `p = c/d`: the least `k` with
 * `d·Σ_{i≤k} C(K, i)·C(N − K, n − i) ≥ c·C(N, n)`, by a walk up the support.
 * `undefined` when `N` is above `EXACT_HYPERGEOMETRIC_MAX_N`.
 */
export function hypergeometricQuantileExact(
  n: number,
  K: number,
  N: number,
  [c, d]: [bigint, bigint],
  deadline?: number
): number | undefined {
  if (N > EXACT_HYPERGEOMETRIC_MAX_N) return undefined;
  if (d <= 0n || c <= 0n || c >= d) return undefined;
  const [lo, hi] = hypergeometricSupport(n, K, N);
  const target = c * bigChoose(N, n);
  let cK = bigChoose(K, lo);
  let cR = bigChoose(N - K, n - lo);
  let sum = 0n;
  for (let i = lo; i <= hi; i++) {
    if (i > lo) {
      cK = (cK * BigInt(K - i + 1)) / BigInt(i);
      cR = (cR * BigInt(n - i + 1)) / BigInt(N - K - n + i);
    }
    sum += cK * cR;
    if (d * sum >= target) return i;
    if ((i & 0xff) === 0xff) checkDeadline(deadline);
  }
  return hi;
}

/**
 * The machine quantile of a continuous distribution with no closed-form
 * quantile, at a probability `prob` in `(0, 1)`: `operator` is the head of
 * the distribution and `params` its parameters. `NaN` when no value is
 * found, or for another head.
 *
 * Each distribution gives its lower tail (the CDF) and its upper tail
 * (`1 − CDF`) from the regularized kernels, each where it keeps its relative
 * precision; `solveMonotone` inverts the one of the tail that holds `prob`.
 * `upperProb` is `1 − prob`, given by the caller from the exact value, since
 * a `prob` close to 1 (`1 − 10^−30`) rounds to the double `1`.
 */
export function continuousQuantile(
  operator: string,
  params: readonly number[],
  prob: number,
  upperProb: number,
  deadline?: number
): number {
  const lower = prob <= 0.5;
  const target = lower ? prob : upperProb;
  if (!(target > 0 && target <= 0.5)) return NaN;
  const solve = (
    cdf: (x: number) => number,
    sf: (x: number) => number,
    upper: number
  ): number =>
    lower
      ? solveMonotone(cdf, target, true, upper, deadline)
      : solveMonotone(sf, target, false, upper, deadline);
  switch (operator) {
    case 'StudentTDistribution': {
      const [nu] = params;
      if (prob === 0.5) return 0;
      // The quantile below ½ is the opposite of the one above it.
      let t: number;
      if (target > 0.25) {
        // Near the median, P(|T| < t) = I_{t²/(ν+t²)}(½, ν/2) = |2p − 1|
        // (exact for ¼ ≤ p ≤ ¾). The tail form below loses a small `t`:
        // `ν + t²` rounds to `ν`, and the tail is ½ on a whole interval.
        const central = lower ? 1 - 2 * prob : 2 * prob - 1;
        t = solveMonotone(
          (t) => betaRegularized((t * t) / (nu + t * t), 0.5, nu / 2),
          central,
          true,
          Infinity,
          deadline
        );
      } else {
        // P(T > t) = ½·I_{ν/(ν+t²)}(ν/2, ½) for t ≥ 0.
        const tail = (t: number): number =>
          0.5 * betaRegularized(nu / (nu + t * t), nu / 2, 0.5);
        t = solveMonotone(tail, target, false, Infinity, deadline);
      }
      return lower ? -t : t;
    }
    case 'ChiSquareDistribution': {
      const [k] = params;
      return solve(
        (x) => gammaP(k / 2, x / 2),
        (x) => gammaQ(k / 2, x / 2),
        Infinity
      );
    }
    case 'GammaDistribution': {
      const [alpha, theta] = params;
      return solve(
        (x) => gammaP(alpha, x / theta),
        (x) => gammaQ(alpha, x / theta),
        Infinity
      );
    }
    case 'FRatioDistribution': {
      const [d1, d2] = params;
      return solve(
        (x) => betaRegularized((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2),
        (x) => betaRegularized(d2 / (d2 + d1 * x), d2 / 2, d1 / 2),
        Infinity
      );
    }
    case 'BetaDistribution': {
      const [a, b] = params;
      return solve(
        (x) => betaRegularized(x, a, b),
        (x) => betaRegularized(1 - x, b, a),
        1
      );
    }
  }
  return NaN;
}
