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
 * li(x) = Ei(ln x) for a real argument, at `prec` digits.
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
function eiSeries(
  ce: ComputeEngine,
  x: BigDecimal,
  prec: number
): Scaled | undefined {
  const gamma = BigDecimal.eulerGamma(prec);
  const lead = gamma.add(x.abs().ln(prec), prec);
  // term_k = x^k/(k·k!), ratio term_{k+1}/term_k = x·k/(k+1)²
  const series = sumByRatio(
    x,
    1,
    (k) => x.mul(k).div((k + 1) * (k + 1), prec),
    EI_BIG_MAX_TERMS,
    prec,
    () => checkDeadlineEvery(ce._deadlineFrame, 0x3f)
  );
  if (series === undefined) return undefined;
  let peak = series.peak;
  for (const part of [lead, gamma]) if (part.abs().gt(peak)) peak = part.abs();
  return { value: lead.add(series.value, prec), peak };
}

/** E₁(y) for y > 0 by the continued fraction, or `undefined` at the iteration cap. */
function e1Fraction(
  ce: ComputeEngine,
  y: BigDecimal,
  prec: number
): BigDecimal | undefined {
  const tol = new BigDecimal(`1e-${prec}`);
  const tiny = new BigDecimal(`1e-${2 * prec}`);
  let b = y.add(1, prec);
  let c = BigDecimal.ONE.div(tiny, prec);
  let d = BigDecimal.ONE.div(b, prec);
  let h = d;
  let settled = 0;
  for (let i = 1; i <= EI_BIG_MAX_TERMS; i++) {
    checkDeadlineEvery(ce._deadlineFrame, 0x3f);
    const a = -i * i;
    b = b.add(2, prec);
    d = b.add(d.mul(a), prec);
    if (d.isZero()) d = tiny;
    d = BigDecimal.ONE.div(d, prec);
    c = b.add(c.inv(prec).mul(a), prec);
    if (c.isZero()) c = tiny;
    const delta = c.mul(d);
    h = h.mul(delta);
    settled = delta.sub(1, prec).abs().lte(tol) ? settled + 1 : 0;
    if (settled >= EI_BIG_CONSECUTIVE) return h.mul(y.neg().exp(prec));
  }
  return undefined;
}

/**
 * Ei(y) for the argument `y(working)` (read at the precision of each run, so
 * that li(x) = Ei(ln x) takes its logarithm there), which is near the double
 * `approximate`, at `prec` digits.
 */
function eiOf(
  ce: ComputeEngine,
  y: (working: number) => BigDecimal,
  approximate: BigDecimal,
  prec: number
): BigDecimal | undefined {
  if (!approximate.isFinite() || approximate.isZero()) return undefined;
  if (approximate.gt(EI_BIG_MAX_ARGUMENT)) return undefined;
  if (approximate.isNegative() && approximate.neg().gte(EI_BIG_FRACTION_FROM)) {
    const working = prec + 20;
    const e1 = e1Fraction(ce, y(working).neg(), working);
    return e1 === undefined ? undefined : e1.neg().toPrecision(prec);
  }
  return bigWithCancellation(
    (working) => eiSeries(ce, y(working), working),
    prec
  );
}

/** Ei(x) for a real x ≠ 0 at `prec` digits, or `undefined` where the kernel declines. */
export function bigExpIntegralEi(
  ce: ComputeEngine,
  x: BigDecimal,
  prec: number
): BigDecimal | undefined {
  return eiOf(ce, () => x, x, prec);
}

/** li(x) = Ei(ln x) for a real x > 0, x ≠ 1, at `prec` digits, or `undefined` where the kernel declines. */
export function bigLogIntegral(
  ce: ComputeEngine,
  x: BigDecimal,
  prec: number
): BigDecimal | undefined {
  if (!x.isFinite() || !x.isPositive() || x.eq(1)) return undefined;
  return eiOf(ce, (working) => x.ln(working), x.ln(prec), prec);
}
