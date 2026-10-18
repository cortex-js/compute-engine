import type { EvaluateHandlerOptions, Expression } from '../global-types.js';
import { isFunction, isNumber } from './type-guards.js';

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

/**
 * `result` with every exact number literal in it made a float when one of
 * `ops` is a float ({@link hasFloatOperand}); `result` otherwise.
 *
 * As {@link floatIfFloatOperand}, but a `List` or a `Tuple` result is
 * rebuilt with each of its elements made a float, at every depth. For an
 * integer function whose result is a list or a tuple of integers: every
 * number computed from a float argument is a float, so `Divisors(12.0)` is
 * `[1.0, 2.0, 3.0, 4.0, 6.0, 12.0]` and `FactorInteger(12.0)` is
 * `[(2.0, 2.0), (3.0, 1.0)]` (user decision 2026-10-18). An element that is
 * not a number literal (a symbol, a string) is kept as it is.
 */
export function floatNumbersIfFloatOperand(
  ops: ReadonlyArray<Expression | undefined>,
  result: Expression | undefined
): Expression | undefined {
  if (result === undefined || !hasFloatOperand(ops)) return result;
  return asFloatNumbers(result);
}

function asFloatNumbers(x: Expression): Expression {
  if (isFunction(x) && (x.operator === 'List' || x.operator === 'Tuple'))
    return x.engine.function(x.operator, x.ops.map(asFloatNumbers));
  return asFloat(x);
}

/**
 * The `evaluate` handler `evaluate`, changed so that its result is a float
 * when one of its operands is a float ({@link floatIfFloatOperand}).
 *
 * For a function that is defined only on integers (`Fibonacci`, `Totient`,
 * `NthPrime`, `BernoulliB`, ...). Its signature accepts a float with an
 * integer value, such as `5.0`, because the type of that value is
 * `integer`, and its exact algorithm computes the result from that value. A
 * float operand makes the result a float, as for all the numeric functions
 * of the engine: `Fibonacci(5.0)` is the float `5`, not the exact integer
 * `5`, and `BernoulliB(4.0)` is the float `-0.0333…`. A list or a tuple
 * result has each of its numbers made a float
 * ({@link floatNumbersIfFloatOperand}): `Divisors(12.0)` is
 * `[1.0, 2.0, 3.0, 4.0, 6.0, 12.0]`. Another result that is not an exact
 * number literal (a boolean, a symbolic expression, an error) is returned
 * as it is.
 *
 * Only the operands themselves are read: a float inside a list operand does
 * not count, so a handler that reads the elements of a list calls
 * {@link floatIfFloatOperand} with those elements itself.
 *
 * Do not use it for a `lazy` operator. On the synchronous route its handler
 * gets the operands as they are written, not evaluated, so a symbol whose
 * value is a float is not seen as a float here (`PowerMod(a, 10, 1000)` with
 * `a := 2.0`). Such a handler calls {@link floatNumbersIfFloatOperand} with
 * the operands it has evaluated.
 */
export function floatResultIfFloatOperand(
  evaluate: (
    ops: ReadonlyArray<Expression>,
    options: EvaluateHandlerOptions
  ) => Expression | undefined
): (
  ops: ReadonlyArray<Expression>,
  options: EvaluateHandlerOptions
) => Expression | undefined {
  return (ops, options) =>
    floatNumbersIfFloatOperand(ops, evaluate(ops, options));
}
