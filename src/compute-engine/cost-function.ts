import type { BoxedExpression } from './global-types';
import type { NumericValue } from './numeric-value/types.js';

/**
 * The Cost Function is used to select the simplest between two expressions:
 * the one with the lowest cost function.
 *
 * It is based on the Mathematica cost function.
 *
 *
 * From https://reference.wolfram.com/language/ref/ComplexityFunction.html
 *
 * ```
 * SimplifyCount[p_] :=
 *  Which[
 *
 *   Head[p] === Symbol, 1,
 *
 *   IntegerQ[p],
 *   If[
 *      p == 0, 1,
 *      Floor[N[Log[2, Abs[p]]/Log[2, 10]]] + If[p > 0, 1, 2]
 *   ],
 *
 *   Head[p] === Rational,
 *   SimplifyCount[Numerator[p]] + SimplifyCount[Denominator[p]] + 1,
 *
 *   Head[p] === Complex,
 *   SimplifyCount[Re[p]] + SimplifyCount[Im[p]] + 1,
 *
 *   NumberQ[p], 2,
 *
 *   True, SimplifyCount[Head[p]] +
 *    If[
 *      Length[p] == 0, 0,
 *      Plus @@ (SimplifyCount /@ (List @@ p))]
 *    ]
 * ```
 */

function numericCostFunction(n: NumericValue | number): number {
  if (typeof n === 'number') {
    if (n === 0) return 1;
    if (Number.isInteger(n))
      return (
        Math.floor(Math.log2(Math.abs(n)) / Math.log2(10)) + (n > 0 ? 1 : 2)
      );
    return 2;
  }

  if (n.isZero) return 1;

  if (n.im !== 0)
    return numericCostFunction(n.re) + numericCostFunction(n.im) + 1;

  return numericCostFunction(n.re);
}

/**
 * The default cost function, used to determine if a new expression is simpler
 * than the old one.
 *
 * To change the cost function used by the engine, set the
 * `ce.costFunction` property of the engine or pass a custom cost function
 * to the `simplify` function.
 *
 */
export function costFunction(expr: BoxedExpression): number {
  //
  // 1/ Symbols
  //

  if (expr.symbol) return 1;

  //
  // 2/ Literal Numeric Values
  //

  if (expr.isNumberLiteral) return numericCostFunction(expr.numericValue!);

  const name = expr.operator;
  let nameCost = 2;
  if (['Add'].includes(name)) nameCost = 3;
  else if (['Subtract', 'Negate'].includes(name)) nameCost = 4;
  else if (['Square', 'Sqrt'].includes(name)) nameCost = 5;
  else if (['Power', 'Root'].includes(name))
    // We want 2q^2 to be less expensive than 2qq, so we ignore the exponent
    return costFunction(expr.ops![1]);
  else if (['Multiply'].includes(name)) {
    // We want 2x to be less expensive than x + x, so if the first operand
    // is a small number coefficient, treat it as cheaper
    const ops = expr.ops ?? [];
    if (ops.length === 2 && ops[0].isNumberLiteral) {
      const coef = ops[0].numericValue;
      // Check if it's a small integer or rational (handles both number and NumericValue types)
      let isSmallCoef = false;
      if (typeof coef === 'number') {
        isSmallCoef = Number.isInteger(coef) && Math.abs(coef) <= 10;
      } else if (coef) {
        // Accept small integers or any finite rational as coefficient
        const type = coef.type;
        if (type === 'finite_integer' && Math.abs(coef.re) <= 10) {
          isSmallCoef = true;
        } else if (type === 'finite_rational') {
          isSmallCoef = true;
        }
      }
      if (isSmallCoef) {
        // Treat coefficient multiplication as equivalent to Add
        // Special case: n*ln(x) or n*log(x) should be very cheap (preferred form)
        const secondOp = ops[1].operator;
        if (['Ln', 'Log', 'Lb'].includes(secondOp)) {
          // n*ln(x) is the standard form for log(x^n), make it cheaper
          return 2 + costFunction(ops[1]);
        }
        return 3 + costFunction(ops[1]);
      }
    }
    nameCost = 7;
  }
  else if (['Divide'].includes(name)) nameCost = 8;
  else if (['Ln', 'Exp', 'Log', 'Lb'].includes(name)) nameCost = 9;
  else if (['Cos', 'Sin', 'Tan'].includes(name)) nameCost = 10;
  else nameCost = 11;

  return (
    nameCost + (expr.ops?.reduce((acc, x) => acc + costFunction(x), 0) ?? 0)
  );
}

export function leafCount(expr: BoxedExpression): number {
  if (expr.symbol) return 1;
  if (expr.isNumberLiteral) return numericCostFunction(expr.numericValue!);
  return 1 + (expr.ops?.reduce((acc, x) => acc + leafCount(x), 0) ?? 0);
}

export const DEFAULT_COST_FUNCTION = costFunction;
