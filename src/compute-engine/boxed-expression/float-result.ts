import type { Expression } from '../global-types.js';
import { isNumber } from './type-guards.js';

/**
 * Is one of `ops` a float: a number literal that is not exact, such as the
 * literal `2.0` or the result of a float computation?
 *
 * Whether a number is exact depends on how it is written, not on its value,
 * and a float operand makes the result of a numeric operation a float, even
 * when the value of that result is an integer (user decision 2026-09-27):
 * `\ln(1.0)` is the float `0`, `2.0!` is the float `2`. A handler that has an
 * exact shortcut for a special value (`ln 1 = 0`, `sinh 0 = 0`,
 * `log_b(b^k) = k`) applies it only when no operand is a float, or boxes its
 * result with {@link asFloat} when one is.
 *
 * A symbol, a function expression or a missing operand is not a float.
 */
export function hasFloatOperand(
  ops: ReadonlyArray<Expression | undefined>
): boolean {
  return ops.some((x) => x !== undefined && isNumber(x) && !x.isExact);
}

/**
 * The value of the number literal `x` as a float, at the precision of the
 * engine: the float `2` for the exact integer `2`, the float `0.333…` for
 * the exact rational `1/3`. A float, a non-finite value (`NaN`, an
 * infinity) and an expression that is not a number literal are returned as
 * they are.
 */
export function asFloat(x: Expression): Expression {
  if (!isNumber(x) || !x.isExact) return x;
  const ce = x.engine;
  const nv = x.numericValue;
  if (typeof nv === 'number')
    return Number.isFinite(nv) ? ce.number(ce._inexactNumericValue(nv)) : x;
  if (nv.isNaN || nv.isPositiveInfinity || nv.isNegativeInfinity) return x;
  if (nv.isComplexInfinity) return x;
  // `N()` gives a float for a rational or a radical, and keeps an integer
  // exact, so its parts are read and rebuilt with the inexact factory.
  const value = nv.N();
  return ce.number(
    ce._inexactNumericValue({
      re: value.bignumRe ?? value.re,
      im: value.bignumIm ?? value.im,
    })
  );
}

/**
 * `result` as a float when one of `ops` is a float ({@link hasFloatOperand})
 * and `result` is an exact number literal; `result` otherwise. For a handler
 * whose exact algorithm also accepts a float with an integer value
 * (`Binomial(5.0, 2)` is computed as `Binomial(5, 2)`), so that the result
 * follows the float operand: the float `10`.
 */
export function floatIfFloatOperand(
  ops: ReadonlyArray<Expression | undefined>,
  result: Expression | undefined
): Expression | undefined {
  if (result === undefined || !hasFloatOperand(ops)) return result;
  return asFloat(result);
}
