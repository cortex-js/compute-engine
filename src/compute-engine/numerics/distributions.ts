import { checkDeadline } from '../../common/interruptible.js';
import { betaRegularized, erfInv, gammaQ } from './special-functions.js';
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
