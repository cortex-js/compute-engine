import { BigDecimal } from '../../big-decimal/index.js';
import type { IComputeEngine as ComputeEngine } from '../global-types.js';
import { checkDeadlineEvery } from '../../common/interruptible.js';
import {
  bigWithCancellation,
  sumByRatio,
  type Scaled,
} from './bignum-cancellation.js';

/**
 * Arbitrary-precision exponential integral Ei(x) and logarithmic integral
 * li(x) = Ei(ln x) for a real argument, at `BigDecimal.precision` digits.
 *
 * - The power series (DLMF 6.6.1 and 6.2.8, the principal value)
 *   `Ei(x) = γ + ln|x| + Σ_{k≥1} x^k/(k·k!)`. The ratio of two terms,
 *   `x·k/(k+1)²`, decreases for k ≥ 1, so `sumByRatio` ends it with a tail
 *   bound. For x > 0 the terms are positive; for x < 0 they alternate and
 *   the sum loses about 0.87·|x| digits, which `bigWithCancellation`
 *   measures, and Ei(x) = −E₁(|x|) comes from the continued fraction past
 *   `EI_BIG_FRACTION_FROM`.
 * - The continued fraction (DLMF 6.9.1, in its even form)
 *   `E₁(y) = e^{−y}/(y+1−1²/(y+3−2²/(y+5−…)))`, by the modified Lentz
 *   method, ended when `EI_BIG_CONSECUTIVE` factors in a row are within the
 *   working precision of 1; it converges for every y > 0 and fast for large y.
 *
 * Declines (`undefined`) at x = 0 (a pole, the caller's), for x > the cap
 * (the series would run past the terms it can sum and the value is larger
 * than any use for it), or at a cancellation past `CANCELLATION_MAX_EXTRA_DIGITS`.
 */

/** Ei(x) for x above this declines: the series needs about 3x terms. */
export const EI_BIG_MAX_ARGUMENT = 1000;

/** For x below −this the continued fraction replaces the alternating series. */
const EI_BIG_FRACTION_FROM = 40;

/** Terms of the series, and iterations of the fraction, before the kernel declines. */
const EI_BIG_MAX_TERMS = 20000;

/** Consecutive Lentz factors within the tolerance of 1 that end the fraction. */
const EI_BIG_CONSECUTIVE = 3;

/** γ + ln|x| + Σ x^k/(k·k!) with the largest part. */
function eiSeries(ce: ComputeEngine, x: BigDecimal): Scaled | undefined {
  const lead = BigDecimal.EULER_GAMMA.add(x.abs().ln());
  // term_k = x^k/(k·k!), ratio term_{k+1}/term_k = x·k/(k+1)²
  const series = sumByRatio(
    x,
    1,
    (k) => x.mul(k).div((k + 1) * (k + 1)),
    EI_BIG_MAX_TERMS,
    () => checkDeadlineEvery(ce._deadlineFrame, 0x3f)
  );
  if (series === undefined) return undefined;
  let peak = series.peak;
  for (const part of [lead, BigDecimal.EULER_GAMMA])
    if (part.abs().gt(peak)) peak = part.abs();
  return { value: lead.add(series.value), peak };
}

/** E₁(y) for y > 0 by the continued fraction, or `undefined` at the iteration cap. */
function e1Fraction(ce: ComputeEngine, y: BigDecimal): BigDecimal | undefined {
  const tol = new BigDecimal(`1e-${BigDecimal.precision}`);
  const tiny = new BigDecimal(`1e-${2 * BigDecimal.precision}`);
  let b = y.add(1);
  let c = BigDecimal.ONE.div(tiny);
  let d = BigDecimal.ONE.div(b);
  let h = d;
  let settled = 0;
  for (let i = 1; i <= EI_BIG_MAX_TERMS; i++) {
    checkDeadlineEvery(ce._deadlineFrame, 0x3f);
    const a = -i * i;
    b = b.add(2);
    d = b.add(d.mul(a));
    if (d.isZero()) d = tiny;
    d = BigDecimal.ONE.div(d);
    c = b.add(c.inv().mul(a));
    if (c.isZero()) c = tiny;
    const delta = c.mul(d);
    h = h.mul(delta);
    settled = delta.sub(1).abs().lte(tol) ? settled + 1 : 0;
    if (settled >= EI_BIG_CONSECUTIVE) return h.mul(y.neg().exp());
  }
  return undefined;
}

/**
 * Ei(y) for the argument `y()` (read at the precision of each run, so that
 * li(x) = Ei(ln x) takes its logarithm there), which is near the double
 * `approximate`.
 */
function eiOf(
  ce: ComputeEngine,
  y: () => BigDecimal,
  approximate: BigDecimal
): BigDecimal | undefined {
  if (!approximate.isFinite() || approximate.isZero()) return undefined;
  if (approximate.gt(EI_BIG_MAX_ARGUMENT)) return undefined;
  if (approximate.isNegative() && approximate.neg().gte(EI_BIG_FRACTION_FROM)) {
    const digits = BigDecimal.precision;
    BigDecimal.precision = digits + 20;
    try {
      const e1 = e1Fraction(ce, y().neg());
      return e1 === undefined ? undefined : e1.neg().toPrecision(digits);
    } finally {
      BigDecimal.precision = digits;
    }
  }
  return bigWithCancellation(() => eiSeries(ce, y()));
}

/** Ei(x) for a real x ≠ 0 at `BigDecimal.precision` digits, or `undefined` where the kernel declines. */
export function bigExpIntegralEi(
  ce: ComputeEngine,
  x: BigDecimal
): BigDecimal | undefined {
  return eiOf(ce, () => x, x);
}

/** li(x) = Ei(ln x) for a real x > 0, x ≠ 1, or `undefined` where the kernel declines. */
export function bigLogIntegral(
  ce: ComputeEngine,
  x: BigDecimal
): BigDecimal | undefined {
  if (!x.isFinite() || !x.isPositive() || x.eq(1)) return undefined;
  return eiOf(ce, () => x.ln(), x.ln());
}
