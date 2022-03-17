import { BoxedExpression } from './public';

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

function numericCostFunction(n: number): number {
  if (Number.isInteger(n)) {
    return Math.floor(Math.log2(Math.abs(n)) / Math.log2(10)) + (n > 0 ? 1 : 2);
  }

  return 2;
}

export function costFunction(expr: BoxedExpression): number {
  //
  // 1/ Symbols
  //

  if (expr.symbol) return 1;

  //
  // 2/ Literal Numeric Values
  //
  if (expr.isLiteral) {
    if (expr.isZero) return 1;
    if (expr.isInteger && expr.asFloat !== null)
      return numericCostFunction(expr.asFloat);

    const [n, d] = expr.rationalValue;
    if (n !== null && d !== null)
      return numericCostFunction(n) + numericCostFunction(d) + 1;

    if (expr.complexValue) {
      const z = expr.complexValue;
      return numericCostFunction(z.re) + numericCostFunction(z.im) + 1;
    }

    if (expr.isNumber) return 2;
  }

  const head = expr.head;
  return (
    (typeof head === 'string' ? 1 : costFunction(head)) +
    (expr.ops?.reduce((acc, x) => acc + costFunction(x), 0) ?? 0)
  );
}

export const DEFAULT_COST_FUNCTION = costFunction;
