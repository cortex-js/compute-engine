import type { Expression } from '../global-types.js';
import { isNumber } from './type-guards.js';
import { hasInfiniteComponent } from './logarithm.js';

/**
 * Which infinite point a number literal is, or `undefined` for a finite
 * literal, a `NaN`, or a non-literal operand.
 *
 * - `'+oo'` and `'-oo'`: the two signed real infinities.
 * - `'~oo'`: the unsigned complex infinity (the point at infinity of the
 *   Riemann sphere, which has no direction).
 * - `'anonymous'`: a complex literal with an infinite component that is not
 *   one of the three named infinities, such as `∞ + i`. These are members
 *   of the `infinity` TYPE that neither `isInfinity` nor `isFinite`
 *   reports; the test is asked of the numeric value, never of the machine
 *   projections, because a finite bignum beyond the double range (`10^1000`)
 *   projects `re` to `Infinity` (`hasInfiniteComponent`).
 *
 * The special-function heads (the Γ family, the polygammas, `Zeta`, the
 * Bessel and Airy functions, the trigonometric integrals, the elliptic
 * integrals, ...) consult this before numericizing, so that their values
 * at the infinite points are decided by their own arms on `evaluate()` and
 * `.N()` alike, instead of by whatever the numeric kernel happens to return
 * for an `Infinity` argument.
 */
export type InfinitePoint = '+oo' | '-oo' | '~oo' | 'anonymous';

export function infinitePoint(x: Expression): InfinitePoint | undefined {
  if (!isNumber(x)) return undefined;
  if (x.isInfinity === true) {
    if (x.isPositive === true) return '+oo';
    if (x.isNegative === true) return '-oo';
    return '~oo';
  }
  if (x.isNaN === true) return undefined;
  return hasInfiniteComponent(x.numericValue) ? 'anonymous' : undefined;
}

/**
 * Whether the literal is a real number literal at one of the two real
 * infinities or at a finite point — that is, an operand with no imaginary
 * part. `~oo` and the anonymous infinities are NOT real.
 */
export function isRealLiteral(x: Expression): boolean {
  if (!isNumber(x)) return false;
  const p = infinitePoint(x);
  if (p === '~oo' || p === 'anonymous') return false;
  return x.im === 0;
}
