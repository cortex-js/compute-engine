import type { BoxedExpression } from './public.ts';
import type { NumericValue } from './numeric-value/public.ts';

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
  else if (['Multiply'].includes(name)) nameCost = 7;
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
