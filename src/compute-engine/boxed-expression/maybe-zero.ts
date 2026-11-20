import type { Expression } from '../global-types.js';
import { isNumber, isSymbol } from './type-guards.js';
import { sgn } from './sgn.js';
import { hasAssignedVariable } from './utils.js';

/**
 * Whether the numerator `x` of a quotient by zero is provably not zero, so
 * that `x/0` is a pole and folds to `ComplexInfinity`. A numerator that may be
 * zero keeps the quotient: `x/0` is `0/0`, the indeterminate form, when `x`
 * is 0. With `x: real` and no value, `x/0` stays `x/0` until `x` has a value.
 *
 * A number literal other than 0 is not zero (the caller handles the literal
 * 0 and `NaN` first). Any other numerator is not zero when its sign, known
 * from its type and the assumptions, excludes 0: `positive` (`π`,
 * `x^2 + 1` with `x: real`, `e^x`), `negative`, or `not-zero` (a symbol
 * declared `real & !0`, or one with the assumption `d ≠ 0`).
 * A numerator that reads a variable with an assigned value keeps the
 * quotient, because its sign comes from the value that the variable holds
 * now, and a canonical form must not depend on that value: `a/0` folded to
 * `ComplexInfinity` while `a := 5` would be wrong after `a := 0`.
 */
export function isProvablyNonZeroNumerator(x: Expression): boolean {
  if (isNumber(x)) return !x.isNaN && !x.isSame(0);
  const s = sgn(x);
  if (s !== 'positive' && s !== 'negative' && s !== 'not-zero') return false;
  return !hasAssignedVariable(x);
}

/**
 * Whether `x` is a constant symbol whose value may be zero. The rules that
 * are correct only for a nonzero operand do not apply to it: with `z` a
 * constant of value 0, `z/z` and `0/z` are `0/0` and `z^0` is `0^0`, which
 * have no value, so they are not `1`, `0` and `1`.
 * The value of a constant does not change, so the canonical form may read it.
 * A constant with no value is not read: `c/c` is `1`, as `x/x` is for a free
 * variable. A value that is not a number and has no known sign (a sum with a
 * free variable, a list) may be zero too: the rules keep the quotient or the
 * power of such a constant, and `evaluate()` reads the value.
 */
export function isConstantThatMayBeZero(x: Expression): boolean {
  if (!isSymbol(x) || !x.isConstant) return false;
  const value = x.value;
  return value !== undefined && !isProvablyNonZeroNumerator(value);
}

/** Whether `x` is a constant symbol whose value is the number 0 (exact or
 * float). */
export function isConstantZero(x: Expression): boolean {
  if (!isSymbol(x) || !x.isConstant) return false;
  const value = x.value;
  return value !== undefined && isNumber(value) && value.isSame(0);
}
