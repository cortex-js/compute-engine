import { checkDeadline } from '../../common/interruptible';
import { betaRegularized, erfInv, gammaQ } from './special-functions';

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
