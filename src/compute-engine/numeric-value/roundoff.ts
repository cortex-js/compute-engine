import { BigDecimal } from '../../big-decimal/index.js';

/**
 * The relative size of the rounding noise of a big-decimal complex kernel:
 * `10^(2−precision)`, where `precision` is the working precision
 * (`BigDecimal.precision`). A kernel that computes at the working precision
 * has a rounding error of about `10^{−precision}` times the modulus of its
 * result; the factor 100 is a margin for the error of the inputs and of the
 * few operations of the kernel.
 */
export function complexNoiseRatio(): BigDecimal {
  const precision = BigDecimal.precision;
  if (noiseRatioPrecision !== precision) {
    noiseRatio = new BigDecimal(`1e${2 - precision}`);
    noiseRatioPrecision = precision;
  }
  return noiseRatio;
}
let noiseRatio = new BigDecimal(1);
let noiseRatioPrecision = NaN;

/**
 * Whether `part`, a part of a complex result of a big-decimal kernel, is
 * roundoff noise: whether it is not larger than
 * `complexNoiseRatio() · magnitude`, where `magnitude` is the modulus of the
 * complex result. The ratio is relative to the working
 * precision, `10^(2−precision)`, because a big-decimal kernel computes at the
 * working precision, not at the precision of a double.
 *
 * The comparison is done with big decimals, so that it stays correct when
 * the values are outside the range of a double (a magnitude of `10^{-400}`
 * converts to the double 0, and a comparison of doubles would then remove
 * every part).
 *
 * When `magnitude` is not finite, the result is `false`.
 */
export function isComplexDust(
  part: BigDecimal | number,
  magnitude: BigDecimal
): boolean {
  if (!magnitude.isFinite()) return false;
  const p = typeof part === 'number' ? new BigDecimal(part) : part;
  if (!p.isFinite()) return false;
  return p.abs().lte(magnitude.abs().mul(complexNoiseRatio()));
}
