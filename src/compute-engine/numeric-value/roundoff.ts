import { BigDecimal } from '../../big-decimal/index.js';
import { ROUNDOFF_TOLERANCE } from '../numerics/numeric.js';

/**
 * Remove the roundoff dust from the parts of a complex result computed by a
 * polar-form kernel (`|z|·(cos θ + i·sin θ)`), such as a complex power, root
 * or exponential.
 *
 * The error of such a kernel is relative to the magnitude of the result: each
 * part carries an error of about `ROUNDOFF_TOLERANCE · |z|`. Thus a part is
 * dust only when it is not larger than `ROUNDOFF_TOLERANCE · |z|`. For
 * example, `i^2` computes `-1 + 1.2e-16i` and the imaginary part is dust.
 *
 * The test is relative, not absolute: `(10^{-10}i)^2` is `-10^{-20}` and
 * `(10^{-6}i)^3` is `-10^{-18}i`. These values are small, but they are the
 * result. An absolute test (`|part| ≤ 1e-14`) changes them to 0. A relative
 * test cannot change both parts to 0, because the larger part is always
 * larger than `ROUNDOFF_TOLERANCE · |z|`.
 *
 * A part that is not larger than `ROUNDOFF_TOLERANCE · |z|` is lost even when
 * it is correct (`(1 + 10^{-20}i)^2` becomes `1`). A double keeps only about
 * 16 digits of `|z|`, so this is the accepted cost of removing the dust.
 *
 * When `|z|` is not finite, no part is changed.
 */
export function chopComplexDust(
  re: number,
  im: number
): { re: number; im: number } {
  const magnitude = Math.hypot(re, im);
  if (!Number.isFinite(magnitude) || magnitude === 0) return { re, im };
  const scale = ROUNDOFF_TOLERANCE * magnitude;
  return {
    re: Math.abs(re) <= scale ? 0 : re,
    im: Math.abs(im) <= scale ? 0 : im,
  };
}

/**
 * The big-decimal version of the test in `chopComplexDust()`: whether `part`
 * is not larger than `ROUNDOFF_TOLERANCE · magnitude`, where `magnitude` is
 * the modulus of the complex result.
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
  return p.abs().lte(magnitude.abs().mul(ROUNDOFF_TOLERANCE));
}
