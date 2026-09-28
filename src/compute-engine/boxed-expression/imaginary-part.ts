import type { BigDecimal } from '../../big-decimal/index.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import type { NumericValue } from '../numeric-value/types.js';
import { isInteger, isOne, isZero } from '../numerics/rationals.js';

/**
 * Tests on the imaginary part of a number that must not read the double
 * `im`.
 *
 * `im` is the double nearest the imaginary part. It is `0` for an imaginary
 * part too small for a double (the exact `10^{-800}·i`) and `±Infinity` for
 * one too large (the exact `10^{800}·i`). So `Number.isFinite(x.im)`,
 * `Number.isNaN(x.im)` and `Number.isInteger(x.im)` give a wrong answer for
 * those values. The functions below read the exact fields of an
 * `ExactNumericValue` (without rounding, and without the cost of building a
 * big decimal), then the big-decimal imaginary part when the value has one,
 * and read the double `im` only when the double IS the imaginary part (a
 * machine value, or a value that is not a number at all, whose `im` is
 * `NaN`).
 *
 * The receiver is a `NumericValue` or an expression. An expression that is
 * not a number literal keeps the result that the test on `im` gives today.
 *
 * Design note: `docs/plans/2026-09-27-big-decimal-imaginary-part.md` §3.
 */
type ImaginaryPartReceiver = {
  readonly im: number;
  readonly bignumIm?: BigDecimal | undefined;
  readonly numericValue?: unknown;
};

function exactValueOf(x: ImaginaryPartReceiver): ExactNumericValue | undefined {
  if (x instanceof ExactNumericValue) return x;
  const nv = x.numericValue;
  return nv instanceof ExactNumericValue ? nv : undefined;
}

/** True if the imaginary part of `x` is finite (not `±∞` and not `NaN`). */
export function isImaginaryPartFinite(x: ImaginaryPartReceiver): boolean {
  const exact = exactValueOf(x);
  if (exact !== undefined) {
    const [n, d] = exact.imRational;
    return (
      (typeof n !== 'number' || Number.isFinite(n)) &&
      (typeof d !== 'number' || Number.isFinite(d))
    );
  }
  const big = x.bignumIm;
  if (big !== undefined) return big.isFinite();
  return Number.isFinite(x.im);
}

/** True if the imaginary part of `x` is `NaN`. */
export function isImaginaryPartNaN(x: ImaginaryPartReceiver): boolean {
  const exact = exactValueOf(x);
  if (exact !== undefined) {
    const [n, d] = exact.imRational;
    return (
      (typeof n === 'number' && Number.isNaN(n)) ||
      (typeof d === 'number' && Number.isNaN(d))
    );
  }
  const big = x.bignumIm;
  if (big !== undefined) return big.isNaN();
  return Number.isNaN(x.im);
}

/** True if the imaginary part of `x` is an integer (zero included). For an
 * exact value this is read from the exact rational and radical, so an
 * imaginary part such as `10^{-800}`, whose double is `0`, is not an
 * integer. */
export function isImaginaryPartInteger(x: ImaginaryPartReceiver): boolean {
  const exact = exactValueOf(x);
  if (exact !== undefined)
    return exact.imRadical === 1 && isInteger(exact.imRational);
  const big = x.bignumIm;
  if (big !== undefined) return big.isInteger();
  return Number.isInteger(x.im);
}

/** True if the imaginary part of `x` is an integer AND its double `im` is a
 * safe integer, so that `im` can be used as that integer in a computation
 * (for example to build an exact Gaussian integer from it). */
export function isImaginaryPartSafeInteger(x: ImaginaryPartReceiver): boolean {
  return isImaginaryPartInteger(x) && Number.isSafeInteger(x.im);
}

/** True if `nv` is exactly the imaginary unit `i`.
 *
 * For an exact value this is read from the exact fields: the real part is
 * zero and the imaginary part is `1` with no radical. The doubles `re` and
 * `im` are not enough: the exact `10^{-800} + i` has `re === 0` and
 * `im === 1`, but it is not `i`. A big-decimal value reads its big-decimal
 * imaginary part (`1 + 10^{-30}` projects to the double `1`); a machine value
 * is its doubles. */
export function isImaginaryUnitValue(
  nv: number | NumericValue | undefined
): boolean {
  if (nv === undefined || typeof nv === 'number') return false;
  if (nv instanceof ExactNumericValue)
    return (
      isZero(nv.rational) &&
      nv.radical === 1 &&
      isOne(nv.imRational) &&
      nv.imRadical === 1
    );
  if (!isRealPartZero(nv)) return false;
  const bigIm = nv.bignumIm;
  return bigIm !== undefined ? bigIm.eq(1) : nv.im === 1;
}

/** True if the real part of `nv` is zero.
 *
 * The double `re` is `0` for a real part too small for a double (the exact
 * `10^{-800} + 2i` has `re === 0`), so it cannot decide whether a value is
 * pure imaginary. For an exact value this reads the exact rational. For a
 * value with a big-decimal real part it reads that big decimal. Otherwise
 * the double is the real part itself and is read directly. */
export function isRealPartZero(nv: number | NumericValue | undefined): boolean {
  if (nv === undefined) return false;
  if (typeof nv === 'number') return nv === 0;
  if (nv instanceof ExactNumericValue) return isZero(nv.rational);
  const big = nv.bignumRe;
  if (big !== undefined) return big.isZero();
  return nv.re === 0;
}

/** The value of the real number literal `x` as a double, for use as an
 * exponent or a root index, or `undefined` when that double would give a
 * wrong answer to "is the exponent an integer?".
 *
 * The double `re` of an exact rational that is not an integer can be an
 * integer: `(10^{400} + 1)/10^{400}` projects to `1`. A caller that tests
 * `Number.isInteger(x.re)` (or `x.re === 1`, `x.re === 2`) would then fold
 * `2^{(10^{400}+1)/10^{400}}` to `2`. So for an exact value that is not an
 * integer, this returns `undefined` when its double is an integer, and the
 * double otherwise (a non-integer double is never taken for an integer).
 * A machine or big-decimal value is a float, and its double is used as it
 * is used for any float exponent (`2^{2.0}` is `4`).
 *
 * Returns `undefined` for a complex value. */
export function realExponentValue(x: {
  readonly re: number;
  readonly isComplex: boolean;
  readonly numericValue: number | NumericValue;
}): number | undefined {
  if (x.isComplex) return undefined;
  const nv = x.numericValue;
  if (typeof nv === 'number') return nv;
  const re = x.re;
  if (
    nv instanceof ExactNumericValue &&
    !(nv.radical === 1 && isInteger(nv.rational)) &&
    Number.isInteger(re)
  )
    return undefined;
  return re;
}

/** True if `nv` is a Gaussian integer: both its real and its imaginary part
 * are integers.
 *
 * Neither double decides this alone: the real part of a big-decimal value
 * `10^{-800} + 2i` projects to the double `0`, and the exact
 * `(10^{400}+1)/10^{400}` projects to `1`. So an exact value is read from
 * its exact fields, a part held as a big decimal is read from that big
 * decimal, and a double is read only when it is the part itself. A
 * JavaScript number is a Gaussian integer when it is an integer.
 *
 * This does not require the doubles to be SAFE integers. A caller that
 * rebuilds the value as an exact Gaussian integer from its doubles needs
 * that too, and uses `isGaussianInteger()`
 * (`numeric-value/gaussian-integer.ts`) instead. */
export function isGaussianIntegerValue(nv: number | NumericValue): boolean {
  if (typeof nv === 'number') return Number.isInteger(nv);
  if (nv instanceof ExactNumericValue)
    return (
      nv.radical === 1 &&
      isInteger(nv.rational) &&
      nv.imRadical === 1 &&
      isInteger(nv.imRational)
    );
  const bigRe = nv.bignumRe;
  const bigIm = nv.bignumIm;
  return (
    (bigRe !== undefined ? bigRe.isInteger() : Number.isInteger(nv.re)) &&
    (bigIm !== undefined ? bigIm.isInteger() : Number.isInteger(nv.im))
  );
}
