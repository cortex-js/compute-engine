/**
 * Exact Bernoulli numbers and exact values of the Riemann zeta function at
 * integers, computed with bigint rationals.
 *
 * Used by the exact (non-numericApproximation) evaluation path of `Zeta`
 * in `library/arithmetic.ts`:
 *
 * - ζ(2k)  = (−1)^{k+1} · B₂ₖ · (2π)^{2k} / (2·(2k)!)  →  rational · π^{2k}
 * - ζ(−n)  = −Bₙ₊₁/(n+1)                               →  exact rational
 *
 * (The numeric approximation path uses the BigDecimal Bernoulli rationals in
 * `numerics/special-functions.ts`; this module is self-contained so that the
 * exact path has no dependency on the BigDecimal machinery.)
 */

function gcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function reduce(num: bigint, den: bigint): [bigint, bigint] {
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return g === 0n ? [0n, 1n] : [num / g, den / g];
}

function factorial(n: number): bigint {
  let f = 1n;
  for (let i = 2; i <= n; i++) f *= BigInt(i);
  return f;
}

// Memoized Bernoulli numbers B_0, B_1, B_2, … as reduced [num, den]
// rationals (B_1 = −1/2 convention). Grown on demand.
const BERNOULLI: [bigint, bigint][] = [
  [1n, 1n], // B_0 = 1
  [-1n, 2n], // B_1 = −1/2
];

/**
 * Bernoulli number Bₙ (B₁ = −1/2 convention) as a reduced bigint rational
 * `[numerator, denominator]`.
 *
 * Uses the defining recurrence Bₘ = −1/(m+1) · Σ_{k=0}^{m−1} C(m+1, k)·Bₖ
 * with exact bigint rational arithmetic. Suitable for moderate n (the Zeta
 * exact path caps |argument| at 100, i.e. at most B₁₀₁).
 */
export function bernoulliRational(n: number): [bigint, bigint] {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(`bernoulliRational: invalid index ${n}`);

  for (let m = BERNOULLI.length; m <= n; m++) {
    // Odd m > 1: B_m = 0
    if (m % 2 === 1) {
      BERNOULLI.push([0n, 1n]);
      continue;
    }

    // B_m = -1/(m+1) * sum_{k=0}^{m-1} C(m+1, k) * B_k
    const mp1 = BigInt(m + 1);
    let sumNum = 0n;
    let sumDen = 1n;
    let binom = 1n; // C(m+1, 0) = 1
    for (let k = 0; k < m; k++) {
      if (k > 0) binom = (binom * (mp1 - BigInt(k) + 1n)) / BigInt(k);
      const [bkNum, bkDen] = BERNOULLI[k];
      if (bkNum === 0n) continue;
      sumNum = sumNum * bkDen + binom * bkNum * sumDen;
      sumDen = sumDen * bkDen;
    }
    BERNOULLI.push(reduce(-sumNum, mp1 * sumDen));
  }

  return BERNOULLI[n];
}

/**
 * The exact rational c such that ζ(2k) = c·π^{2k}, for integer k ≥ 1.
 *
 * From ζ(2k) = (−1)^{k+1}·B₂ₖ·(2π)^{2k} / (2·(2k)!) and the sign alternation
 * of B₂ₖ, the coefficient is |B₂ₖ|·2^{2k−1}/(2k)! (always positive).
 *
 * ζ(2) = π²/6, ζ(4) = π⁴/90, ζ(6) = π⁶/945, ζ(8) = π⁸/9450, …
 */
export function zetaEvenCoefficient(k: number): [bigint, bigint] {
  if (!Number.isInteger(k) || k < 1)
    throw new RangeError(`zetaEvenCoefficient: invalid index ${k}`);
  const [bernoulliNumerator, den] = bernoulliRational(2 * k);
  const num =
    bernoulliNumerator < 0n ? -bernoulliNumerator : bernoulliNumerator;
  return reduce(num * 2n ** BigInt(2 * k - 1), den * factorial(2 * k));
}

/**
 * ζ(−n) for integer n ≥ 1 as an exact reduced rational: ζ(−n) = −Bₙ₊₁/(n+1).
 *
 * ζ(−1) = −1/12, ζ(−3) = 1/120, and ζ(−2k) = 0 (the trivial zeros, since
 * the odd Bernoulli numbers B₃, B₅, … vanish).
 */
export function zetaNegativeInteger(n: number): [bigint, bigint] {
  if (!Number.isInteger(n) || n < 1)
    throw new RangeError(`zetaNegativeInteger: invalid index ${n}`);
  const [num, den] = bernoulliRational(n + 1);
  return reduce(-num, den * BigInt(n + 1));
}
