import { BigDecimal } from '../../big-decimal/index.js';
import type { IComputeEngine as ComputeEngine } from '../global-types.js';
import { checkDeadlineEvery } from '../../common/interruptible.js';
import {
  bigWithCancellation,
  sumByRatio,
  type Scaled,
} from './bignum-cancellation.js';

/**
 * Arbitrary-precision sine, cosine, hyperbolic sine and hyperbolic cosine
 * integrals for a real argument, at `prec` digits, from their power series
 * (DLMF 6.6.5, 6.6.6, 6.6.3, 6.6.4):
 *
 *   Si(x)  = Σ_{k≥0} (−1)^k x^{2k+1}/((2k+1)(2k+1)!)
 *   Shi(x) = Σ_{k≥0}       x^{2k+1}/((2k+1)(2k+1)!)
 *   Ci(x)  = γ + ln x + Σ_{k≥1} (−1)^k x^{2k}/(2k(2k)!)       x > 0
 *   Chi(x) = γ + ln x + Σ_{k≥1}        x^{2k}/(2k(2k)!)       x > 0
 *
 * The ratio of two terms decreases from the first term on, so `sumByRatio`
 * ends a series with a tail bound. Si and Ci alternate and lose about
 * |x|/ln 10 digits to the cancellation of the terms (the largest is near
 * e^|x|/|x|), and Ci loses more near its zeros; `bigWithCancellation`
 * measures the loss and adds the digits. Shi and Chi have terms of one sign.
 *
 * Declines (`undefined`) for |x| above `TRIG_INTEGRAL_BIG_MAX_ARGUMENT` (the
 * series would need about e·|x| terms, at a working precision of |x|/ln 10
 * more digits), at a cancellation past `CANCELLATION_MAX_EXTRA_DIGITS`, and
 * where the value is not finite (x = 0 for Ci and Chi, a pole the caller
 * answers).
 */

/** |x| above this declines. */
export const TRIG_INTEGRAL_BIG_MAX_ARGUMENT = 1000;

/** Terms of a series before the kernel declines. */
const TRIG_INTEGRAL_BIG_MAX_TERMS = 20000;

/** Σ_{k≥0} (±1)^k x^{2k+1}/((2k+1)(2k+1)!) with the largest term. */
function oddSeries(
  ce: ComputeEngine,
  x: BigDecimal,
  alternating: boolean,
  prec: number
): Scaled | undefined {
  const q = x.mulBounded(x, prec);
  // term_{k+1}/term_k = ±x²(2k+1)/((2k+3)²(2k+2))
  return sumByRatio(
    x,
    0,
    (k) => {
      const r = q
        .mul(2 * k + 1)
        .div((2 * k + 3) * (2 * k + 3) * (2 * k + 2), prec);
      return alternating ? r.neg() : r;
    },
    TRIG_INTEGRAL_BIG_MAX_TERMS,
    prec,
    () => checkDeadlineEvery(ce._deadlineFrame, 0x3f)
  );
}

/** γ + ln x + Σ_{k≥1} (±1)^k x^{2k}/(2k(2k)!) with the largest part. */
function evenSeries(
  ce: ComputeEngine,
  x: BigDecimal,
  alternating: boolean,
  prec: number
): Scaled | undefined {
  const gamma = BigDecimal.eulerGamma(prec);
  const lead = gamma.add(x.ln(prec), prec);
  const q = x.mulBounded(x, prec);
  const first = q.div(4, prec);
  // term_{k+1}/term_k = ±x²·2k/((2k+2)²(2k+1)), from term_1 = ±x²/4
  const series = sumByRatio(
    alternating ? first.neg() : first,
    1,
    (k) => {
      const r = q.mul(2 * k).div((2 * k + 2) * (2 * k + 2) * (2 * k + 1), prec);
      return alternating ? r.neg() : r;
    },
    TRIG_INTEGRAL_BIG_MAX_TERMS,
    prec,
    () => checkDeadlineEvery(ce._deadlineFrame, 0x3f)
  );
  if (series === undefined) return undefined;
  let peak = series.peak;
  for (const part of [lead, gamma]) if (part.abs().gt(peak)) peak = part.abs();
  return { value: lead.add(series.value, prec), peak };
}

/**
 * `bigWithCancellation(run, prec)` for the alternating series, with the
 * digits that its largest term (below e^|x|) takes from the sum carried from
 * the first run on. Started with a guard of 20 digits, a run that loses more
 * ends on rounding noise, which the loss measure reads as a smaller loss.
 */
function alternating(
  x: BigDecimal,
  run: (working: number) => Scaled | undefined,
  prec: number
): BigDecimal | undefined {
  const guard = Math.ceil(Math.abs(x.toNumber()) * Math.LOG10E) + 2;
  return bigWithCancellation(run, prec + guard)?.toPrecision(prec);
}

function inRange(x: BigDecimal): boolean {
  return x.isFinite() && x.abs().lte(TRIG_INTEGRAL_BIG_MAX_ARGUMENT);
}

/** Si(x) for a real x, or `undefined` where the kernel declines. */
export function bigSinIntegral(
  ce: ComputeEngine,
  x: BigDecimal,
  prec: number
): BigDecimal | undefined {
  if (!inRange(x)) return undefined;
  if (x.isZero()) return BigDecimal.ZERO;
  return alternating(x, (working) => oddSeries(ce, x, true, working), prec);
}

/** Shi(x) for a real x, or `undefined` where the kernel declines. */
export function bigSinhIntegral(
  ce: ComputeEngine,
  x: BigDecimal,
  prec: number
): BigDecimal | undefined {
  if (!inRange(x)) return undefined;
  if (x.isZero()) return BigDecimal.ZERO;
  return bigWithCancellation(
    (working) => oddSeries(ce, x, false, working),
    prec
  );
}

/** Ci(x) for a real x > 0, or `undefined` where the kernel declines. */
export function bigCosIntegral(
  ce: ComputeEngine,
  x: BigDecimal,
  prec: number
): BigDecimal | undefined {
  if (!inRange(x) || !x.isPositive()) return undefined;
  return alternating(x, (working) => evenSeries(ce, x, true, working), prec);
}

/** Chi(x) for a real x > 0, or `undefined` where the kernel declines. */
export function bigCoshIntegral(
  ce: ComputeEngine,
  x: BigDecimal,
  prec: number
): BigDecimal | undefined {
  if (!inRange(x) || !x.isPositive()) return undefined;
  return bigWithCancellation(
    (working) => evenSeries(ce, x, false, working),
    prec
  );
}
