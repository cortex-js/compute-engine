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
 * Remove the roundoff dust from the parts of a complex result computed by a
 * double kernel of compiled JavaScript (`toRI()` in
 * `compilation/javascript-target.ts`, and the constant folding of these
 * kernels in `compilation/constant-folding.ts`).
 *
 * A part is dust only when it is not larger than `ROUNDOFF_TOLERANCE` (1e-14)
 * AND not larger than `ROUNDOFF_TOLERANCE · |z|`. Each test alone removes a
 * correct part:
 * - The absolute test alone removes the whole of a small result:
 *   `arcoth(10²⁰)` is `10⁻²⁰`.
 * - The relative test alone removes a part that is small next to a large
 *   other part but much larger than the rounding error of that part:
 *   `exp(40 + 10⁻¹⁸i)` is `2.35·10¹⁷ + 0.235i`, and the imaginary part is
 *   computed as `|z|·sin(10⁻¹⁸)`, with a relative error of about 10⁻¹⁶ of
 *   its own size.
 * With both tests, a part is removed only when the absolute test, used
 * before, also removed it.
 *
 * When `|z|` is not finite, only the absolute test is used.
 */
export function chopKernelDust(
  re: number,
  im: number
): { re: number; im: number } {
  const magnitude = Math.hypot(re, im);
  const scale = Number.isFinite(magnitude)
    ? Math.min(ROUNDOFF_TOLERANCE, ROUNDOFF_TOLERANCE * magnitude)
    : ROUNDOFF_TOLERANCE;
  return {
    re: Math.abs(re) <= scale ? 0 : re,
    im: Math.abs(im) <= scale ? 0 : im,
  };
}

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
 * The big-decimal version of the test in `chopComplexDust()`: whether `part`
 * is not larger than `complexNoiseRatio() · magnitude`, where `magnitude` is
 * the modulus of the complex result. The ratio is relative to the working
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
