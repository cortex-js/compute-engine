import type { Expression } from '../global-types.js';
import { isNumber } from './type-guards.js';

/**
 * Which infinite point a number literal is, or `undefined` for a finite
 * literal, a `NaN`, or a non-literal operand.
 *
 * - `'+oo'` and `'-oo'`: the two signed real infinities.
 * - `'~oo'`: the unsigned complex infinity (the point at infinity of the
 *   Riemann sphere, which has no direction).
 *
 * No other infinite number literal exists. Every boxed number is
 * normalized by `canonicalNumber()` (`boxed-number.ts`): a value with an
 * infinite imaginary part is `~oo` (the numeric-value constructors set
 * the real part to the infinite imaginary part), a value with an infinite
 * real part and a finite imaginary part (`∞ + i`) is `±∞`
 * (`infiniteRealPart()`), and a value with a NaN part is `NaN`. A finite
 * bignum beyond the double range (`10^1000`) is finite: the test reads
 * `isInfinity`, which asks the numeric value, never the machine
 * projections.
 *
 * The special-function heads (the Γ family, the polygammas, `Zeta`, the
 * Bessel and Airy functions, the trigonometric integrals, the elliptic
 * integrals, ...) consult this before numericizing, so that their values
 * at the infinite points are decided by their own arms on `evaluate()` and
 * `.N()` alike, instead of by whatever the numeric kernel happens to return
 * for an `Infinity` argument.
 */
export type InfinitePoint = '+oo' | '-oo' | '~oo';

export function infinitePoint(x: Expression): InfinitePoint | undefined {
  if (!isNumber(x)) return undefined;
  if (x.isInfinity !== true) return undefined;
  if (x.isPositive === true) return '+oo';
  if (x.isNegative === true) return '-oo';
  return '~oo';
}

/**
 * Whether the literal is a real number literal at one of the two real
 * infinities or at a finite point — that is, an operand with no imaginary
 * part. `~oo` is NOT real.
 */
export function isRealLiteral(x: Expression): boolean {
  if (!isNumber(x)) return false;
  if (infinitePoint(x) === '~oo') return false;
  return !x.isComplex;
}

/**
 * Whether `x` is a finite real number literal that is an integer and is
 * strictly negative (`−1`, `−2`, …) — a pole of `Γ(x + 1)`.
 */
export function isNegativeIntegerLiteral(x: Expression): boolean {
  return isRealLiteral(x) && x.isInteger === true && x.isNegative === true;
}

/**
 * Whether `x` is a finite real number literal that is an integer and is
 * non-positive (`0`, `−1`, `−2`, …) — a pole of `Γ(x)`.
 */
export function isNonPositiveIntegerLiteral(x: Expression): boolean {
  return isRealLiteral(x) && x.isInteger === true && x.isNonPositive === true;
}
