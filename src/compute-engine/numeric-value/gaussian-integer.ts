import type { NumericValue } from './types.js';

/**
 * True if both parts of `nv` are integers that a double holds exactly: the
 * double projections `re` and `im` are safe integers, and each part that has
 * a big-decimal form (`bignumRe`, `bignumIm`) is an integer too.
 *
 * Such a value can be rebuilt as an exact Gaussian integer from its doubles
 * (`ExactNumericValue` lifts it with `rational: [re, 1]` and
 * `imRational: [im, 1]`).
 *
 * The doubles alone are not enough to decide this. A part too small for a
 * double (`10^{-800}`) has the projection `0`, which is a safe integer, and
 * treating the value as a Gaussian integer would change that part to an
 * exact zero. A part with no big-decimal form is a double, and the double is
 * then the part itself.
 */
export function isGaussianInteger(nv: NumericValue): boolean {
  if (!Number.isSafeInteger(nv.re) || !Number.isSafeInteger(nv.im))
    return false;
  const bigRe = nv.bignumRe;
  if (bigRe !== undefined && !bigRe.isInteger()) return false;
  const bigIm = nv.bignumIm;
  return bigIm === undefined || bigIm.isInteger();
}
