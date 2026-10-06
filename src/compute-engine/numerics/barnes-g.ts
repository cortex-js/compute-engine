import { Complex } from 'complex.js';
import { BigDecimal } from '../../big-decimal/index.js';
import type { IComputeEngine as ComputeEngine } from '../global-types.js';
import { bernoulliRational } from './bernoulli.js';
import { logGammaComplex, HALF_LN_2PI } from './log-gamma.js';
import { bigGamma, getBernoulliRationals } from './special-functions.js';
import { checkDeadline } from '../../common/interruptible.js';

/**
 * The Barnes G-function: G(z+1) = Γ(z)·G(z), G(1) = 1. G(n) is the
 * superfactorial Π_{k<n−1} k! at positive integers and G is entire with
 * zeros at 0, −1, −2, ….
 */

/** G(n) = Π_{k=0}^{n−2} k!, exact, for a positive integer n. */
export function superfactorial(n: number): bigint {
  let g = 1n;
  let f = 1n;
  for (let k = 1; k <= n - 2; k++) {
    f *= BigInt(k);
    g *= f;
  }
  return g;
}

//
// ---------------- Complex z, at double precision ----------------
//

/** Asymptotic coefficients B₂ₖ₊₂ / (4k(k+1)). */
const COEFF: number[] = (() => {
  const c = [0];
  for (let k = 1; k <= 12; k++) {
    const [num, den] = bernoulliRational(2 * k + 2);
    c[k] = Number(num) / Number(den) / (4 * k * (k + 1));
  }
  return c;
})();

/** ζ′(−1) = 1/12 − ln A, A Glaisher's constant. */
const ZETA_PRIME_MINUS_1 = -0.16542114370045094;

/** Re z from which the 12-term asymptotic series is good to a double. */
const ASYMPTOTIC_FROM = 20;

/**
 * Steps of ln G(z) = ln G(z+n) − Σ lnΓ(z+k) allowed below `ASYMPTOTIC_FROM`.
 * The sum's terms grow like n² ln n while ln G(z) stays smaller, so the
 * relative error of G = exp(ln G) grows with n (about 1e-12 at n = 100,
 * measured against mpmath); past the cap the kernel declines.
 */
const MAX_SHIFT = 100;

/**
 * ln G(z+1) ~ (z²/2 − 1/12) ln z − 3z²/4 + (z/2) ln 2π + ζ′(−1)
 *   + Σ_{k≥1} B₂ₖ₊₂ / (4k(k+1) z^{2k}),
 * for Re z ≥ `ASYMPTOTIC_FROM` (Adamchik, "Contributions to the theory of the
 * Barnes function", eq. 22).
 */
function asymptotic(z: Complex): Complex {
  const lz = z.log();
  const z2 = z.mul(z);
  let r = z2
    .mul(0.5)
    .sub(1 / 12)
    .mul(lz);
  r = r.sub(z2.mul(0.75)).add(z.mul(HALF_LN_2PI)).add(ZETA_PRIME_MINUS_1);
  const inv2 = new Complex(1, 0).div(z2);
  let p = inv2;
  for (let k = 1; k < COEFF.length; k++) {
    r = r.add(p.mul(COEFF[k]));
    p = p.mul(inv2);
  }
  return r;
}

/**
 * ln G(z) with the `LogGamma` continuation (the branch Wolfram's `LogBarnesG`
 * takes: its imaginary part jumps by 2πk on the negative axis). NaN at the
 * zeros of G, for a non-finite z, and where the shift would pass `MAX_SHIFT`.
 */
export function logBarnesGComplex(z: Complex): Complex {
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im))
    return new Complex(NaN, NaN);
  if (z.im === 0 && z.re <= 0 && Number.isInteger(z.re))
    return new Complex(NaN, NaN);
  const n = Math.max(0, Math.ceil(ASYMPTOTIC_FROM - z.re));
  if (n > MAX_SHIFT) return new Complex(NaN, NaN);
  let shift = new Complex(0, 0);
  for (let k = 0; k < n; k++)
    shift = shift.add(logGammaComplex(new Complex(z.re + k, z.im)));
  // ln G((z+n−1) + 1)
  return asymptotic(new Complex(z.re + n - 1, z.im)).sub(shift);
}

/** G(z) = exp(ln G(z)); exactly 0 at the non-positive integers, NaN where it overflows a double. */
export function barnesGComplex(z: Complex): Complex {
  if (z.im === 0 && z.re <= 0 && Number.isInteger(z.re))
    return new Complex(0, 0);
  const v = logBarnesGComplex(z).exp();
  return Number.isFinite(v.re) && Number.isFinite(v.im)
    ? v
    : new Complex(NaN, NaN);
}

//
// ---------------- Real x, at the engine's precision ----------------
//

/**
 * Write x = m + 1 + w with m an integer and |w| ≤ ½, and pick an integer
 * M ≥ m large enough for the asymptotic series of `asymptotic` above (its
 * terms reach about e^{−2πM} before they turn). Then
 *
 *   G(M + 1 + w) = G(M + 1) · exp(A(M + w) − A(M)),
 *
 * where A(z) is the asymptotic series of ln G(z + 1) without its constant
 * ζ′(−1), which cancels in the difference, and G(M + 1) = 1!·2!⋯(M−1)! is a
 * product of integers. The recurrence G(u + 1) = Γ(u)·G(u) then walks
 * M + 1 + w down to x:
 *
 *   G(x) = G(M + 1 + w) / Π_{j=m+1}^{M} Γ(j + w),
 *
 * with Γ(1 + w) from `bigGamma` and the other Γ(j + w) by Γ(u + 1) = u·Γ(u),
 * up or down from it (so no Γ is evaluated next to a pole). Every product is
 * rounded to the working precision as it goes, so the cost is linear in M.
 */

/** Digits carried past the ones asked for, against rounding in the products and the series. */
const GUARD_DIGITS = 10;

/** Steps of the recurrence allowed from x to 1; farther from 1 the value stays unevaluated. */
const MAX_BIG_SHIFT = 1000;

/**
 * The asymptotic series is summed at z ≥ this many times the working digits:
 * its terms then fall by more than a digit each until the target, so about
 * 0.27·digits Bernoulli numbers are needed (at 1000 digits, 270).
 */
const ASYMPTOTIC_PER_DIGIT = 2;

/**
 * G(x) to the working precision (`BigDecimal.precision`), undefined at the
 * zeros of G and where x is more than `MAX_BIG_SHIFT` from 1.
 */
export function bigBarnesG(
  ce: ComputeEngine,
  x: BigDecimal
): BigDecimal | undefined {
  if (!x.isFinite()) return undefined;
  if (x.isInteger() && !x.isPositive()) return undefined;
  const m = Math.round(x.toNumber() - 1);
  if (Math.abs(m) > MAX_BIG_SHIFT) return undefined;
  const digits = BigDecimal.precision;
  const M = Math.max(m, ASYMPTOTIC_PER_DIGIT * digits + 20);
  // A(M + w) and A(M) are about M² ln M and cancel to their difference; the
  // 2M rounded products each add a unit in the last place.
  const lost = Math.ceil(
    Math.log10(M * M * Math.log(M) + 1) + Math.log10(4 * M)
  );
  BigDecimal.precision = digits + GUARD_DIGITS + lost;
  try {
    return walk(ce, x.sub(m + 1), m, M)?.toPrecision(digits);
  } finally {
    BigDecimal.precision = digits;
  }
}

/** Passes `bigLogBarnesG` makes, each with more digits, before it declines. */
const LOG_PASSES = 3;

/**
 * ln G(x) for a real x > 0 to the working precision (`BigDecimal.precision`),
 * undefined where x is more than `MAX_BIG_SHIFT` from 1.
 *
 * The walk of `bigBarnesG` is kept in the log domain: ln G(x) is
 * ln(G(M + 1) / Π Γ(j + w)) + A(M + w) − A(M), formed at the working
 * precision and rounded only at the end. So it is good to about
 * 10^−(digits + `GUARD_DIGITS`) in absolute terms, not relative to G(x),
 * and ln G is 0 at x = 1 and x = 2: there the relative digits run out
 * (ln G(1 + 10⁻¹⁰) ≈ 4.2·10⁻¹¹). When the result is below 1, the next pass
 * adds the digits its size calls for; when it is below what a pass can
 * resolve, the next pass adds `digits` more.
 */
export function bigLogBarnesG(
  ce: ComputeEngine,
  x: BigDecimal
): BigDecimal | undefined {
  if (!x.isFinite() || !x.isPositive()) return undefined;
  if (x.eq(1) || x.eq(2)) return BigDecimal.ZERO; // G(1) = G(2) = 1
  const m = Math.round(x.toNumber() - 1);
  if (Math.abs(m) > MAX_BIG_SHIFT) return undefined;
  const digits = BigDecimal.precision;
  const M = Math.max(m, ASYMPTOTIC_PER_DIGIT * digits + 20);
  // As in `bigBarnesG`: A(M + w), A(M) and the logarithm of the products are
  // about M² ln M, and the 2M rounded products each add a unit in the last place.
  const lost = Math.ceil(
    Math.log10(M * M * Math.log(M) + 1) + Math.log10(4 * M)
  );
  let extra = 0;
  for (let pass = 0; pass < LOG_PASSES; pass++) {
    const resolved = digits + GUARD_DIGITS + extra; // absolute digits of the pass
    BigDecimal.precision = resolved + lost;
    let r: BigDecimal | undefined;
    try {
      r = walk(ce, x.sub(m + 1), m, M, true);
    } finally {
      BigDecimal.precision = digits;
    }
    if (r === undefined) return undefined;
    const size = r.isZero() ? -Infinity : log10Abs(r);
    if (size >= -extra) return r.toPrecision(digits);
    extra = size > 2 - resolved ? Math.ceil(-size) + 1 : extra + digits;
  }
  return undefined;
}

/** log₁₀ |x| for a finite non-zero x, also past the range of a double. */
function log10Abs(x: BigDecimal): number {
  const sig = x.significand < 0n ? -x.significand : x.significand;
  const length = sig.toString().length;
  const lead = Number(sig / 10n ** BigInt(Math.max(0, length - 15)));
  return x.exponent + Math.max(0, length - 15) + Math.log10(lead);
}

/** A(z): ln G(z + 1) without the constant ζ′(−1), for real z ≥ `ASYMPTOTIC_PER_DIGIT`·digits. */
function asymptoticBig(
  ce: ComputeEngine,
  z: BigDecimal,
  lnTwoPi: BigDecimal
): BigDecimal | undefined {
  const working = BigDecimal.precision;
  const z2 = z.mul(z);
  let r = z2
    .div(2)
    .sub(BigDecimal.ONE.div(12))
    .mul(z.ln())
    .sub(z2.mul(3).div(4))
    .add(z.mul(lnTwoPi).div(2));
  const tolerance = new BigDecimal(`1e-${working}`);
  const inv2 = BigDecimal.ONE.div(z2);
  let p = inv2; // z^{−2k}
  // B₂ₖ₊₂ / (4k(k+1) z^{2k}) for k ≥ 1; table[k] is B₂ₖ₊₂. The Bernoulli
  // table costs more than quadratically in its length, so it is built only
  // to the term where |B₂ₖ₊₂| ≈ 2(2k+2)!/(2π)^{2k+2} brings the estimate
  // below the tolerance, plus a margin.
  const log10z = Math.log10(z.toNumber());
  let maxTerms = 1;
  let logFactorial = Math.log10(24); // log10 (2k+2)! at k = 1
  while (
    maxTerms < 4 * working &&
    Math.log10(2) +
      logFactorial -
      (2 * maxTerms + 2) * Math.log10(2 * Math.PI) -
      Math.log10(4 * maxTerms * (maxTerms + 1)) -
      2 * maxTerms * log10z >
      -working
  ) {
    maxTerms += 1;
    logFactorial += Math.log10((2 * maxTerms + 1) * (2 * maxTerms + 2));
  }
  maxTerms += 4;
  const table = getBernoulliRationals(ce, maxTerms + 1);
  let previous: BigDecimal | undefined;
  for (let k = 1; k <= maxTerms && k < table.length; k++) {
    if ((k & 0xff) === 0) checkDeadline(ce._deadlineFrame);
    const [num, den] = table[k];
    const term = new BigDecimal(num)
      .mul(p)
      .div(new BigDecimal(den * BigInt(4 * k * (k + 1))));
    const size = term.abs();
    if (previous !== undefined && size.gt(previous)) return undefined; // the series turned first
    r = r.add(term);
    if (size.lt(tolerance)) return r;
    previous = size;
    p = p.mul(inv2).toPrecision(working);
  }
  return undefined;
}

/**
 * G(m + 1 + w), as the block comment above describes; with `log`, ln G(m + 1 + w)
 * instead, from the same products without forming exp(A(M + w) − A(M)).
 */
function walk(
  ce: ComputeEngine,
  w: BigDecimal,
  m: number,
  M: number,
  log = false
): BigDecimal | undefined {
  const working = BigDecimal.precision;
  const round = (v: BigDecimal) => v.toPrecision(working);
  const lnTwoPi = BigDecimal.PI.mul(2).ln();

  const high = asymptoticBig(ce, w.add(M), lnTwoPi);
  const low = asymptoticBig(ce, new BigDecimal(M), lnTwoPi);
  if (high === undefined || low === undefined) return undefined;

  // G(M + 1) = Π_{k=1}^{M−1} k!
  let g = BigDecimal.ONE;
  let factorial = BigDecimal.ONE;
  for (let k = 1; k < M; k++) {
    if ((k & 0xff) === 0) checkDeadline(ce._deadlineFrame);
    factorial = round(factorial.mul(k));
    g = round(g.mul(factorial));
  }
  if (!log) g = round(g.mul(high.sub(low).exp())); // G(M + 1 + w)

  // Divide by Γ(j + w) for j = m + 1 … M.
  const gamma1 = bigGamma(ce, w.add(1)); // Γ(1 + w)
  let gamma = gamma1;
  for (let j = 1; j <= M; j++) {
    if ((j & 0xff) === 0) checkDeadline(ce._deadlineFrame);
    if (j >= m + 1) g = round(g.div(gamma));
    gamma = round(gamma.mul(w.add(j))); // Γ(j + 1 + w)
  }
  gamma = gamma1;
  for (let j = 0; j >= m + 1; j--) {
    if ((-j & 0xff) === 0) checkDeadline(ce._deadlineFrame);
    gamma = round(gamma.div(w.add(j))); // Γ(j + w) = Γ(j + 1 + w) / (j + w)
    g = round(g.div(gamma));
  }
  // With `log`, g is G(M + 1) / Π Γ(j + w), which is G(x)·exp(A(M) − A(M + w)).
  return log ? g.ln().add(high.sub(low)) : g;
}
