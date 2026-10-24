import type { Expression } from '../global-types.js';
import { isFunction, isNumber } from './type-guards.js';

/**
 * If `arg` is the negation of a value `a`, return `{ inner: a, literal }`,
 * else `undefined`.
 * The odd and even function rules use it to move the sign out of the
 * argument: f(-a) = -f(a) or f(-a) = f(a).
 *
 * Four forms are a negation:
 * - `Negate(a)`, the canonical form of `-a` for a non-numeric `a`.
 * - A finite negative real number literal `-c`. Then `a` is `c`. This form
 *   is necessary to cancel `f(1) - f(-1)` to `2f(1)`.
 * - A pure imaginary literal with a negative imaginary part (`-i`), so that
 *   `sin(-i) + sin(i)` cancels.
 * - A finite constant with a negative value that is not one literal
 *   (`−3 + 2√2`, `−1/(3 + 2√2)`): an expression with no unknowns whose sign
 *   is known. Then `a` is its negation.
 *
 * `literal` is true for the two constant forms. Its rewrite `f(-c) -> -f(c)` can
 * make the cost larger by one (`sin(-1/2)` has a smaller cost than
 * `-sin(1/2)`), so the caller marks that step `purpose: 'transform'`: a
 * positive argument is the normal form, also when it does not make the cost
 * smaller.
 */
export function negatedArgument(
  arg: Expression
): { inner: Expression; literal: boolean } | undefined {
  if (isFunction(arg, 'Negate')) return { inner: arg.op1, literal: false };
  if (isNumber(arg) && arg.isNegative === true && arg.isFinite === true)
    return { inner: arg.neg(), literal: true };
  // A pure imaginary literal with a negative imaginary part (`-i`, `-2i`) is
  // the negation of the positive one. It has no sign (`isNegative` is
  // undefined for a complex number), so it is read from its parts.
  if (isNumber(arg) && arg.isFinite === true && arg.re === 0 && arg.im < 0)
    return { inner: arg.neg(), literal: true };
  // A constant with a negative value that is not one number literal:
  // `−3 + 2√2` or `−1/(3 + 2√2)`. Its terms cannot fold into one literal,
  // but its sign is known.
  if (
    isFunction(arg) &&
    arg.unknowns.length === 0 &&
    arg.isPure === true &&
    arg.isFinite === true &&
    arg.isNegative === true
  )
    return { inner: arg.neg(), literal: true };
  return undefined;
}
