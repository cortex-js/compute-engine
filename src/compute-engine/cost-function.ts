import Complex from 'complex.js';
import { isMachineRational, isRational } from './numerics/rationals';
import { BoxedExpression } from './public';
import { asFloat } from './boxed-expression/numerics';

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
  if (Number.isInteger(n) && n !== 0) {
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
  const num = expr.numericValue;
  if (num !== null) {
    if (expr.isZero) return 1;
    if (expr.isInteger) return numericCostFunction(asFloat(expr)!);

    if (isRational(num)) {
      if (isMachineRational(num))
        return numericCostFunction(num[0]) + numericCostFunction(num[1]) + 1;
      else
        return (
          numericCostFunction(Number(num[0])) +
          numericCostFunction(Number(num[1])) +
          1
        );
    }

    if (num instanceof Complex)
      return numericCostFunction(num.re) + numericCostFunction(num.im) + 1;

    if (expr.isNumber) return 2;
  }

  const head = expr.head;
  let headCost = 2;
  if (typeof head === 'string') {
    if (['Add', 'Divide'].includes(head)) headCost = 3;
    else if (['Subtract', 'Negate'].includes(head)) headCost = 4;
    else if (['Square', 'Sqrt', 'Multiply', 'Root'].includes(head))
      headCost = 5;
    else if (['Power'].includes(head)) headCost = 6;
    else if (['Ln', 'Exp', 'Log'].includes(head)) headCost = 7;
    else if (
      [
        'Arcsin',
        'Arccos',
        'Arctan',
        'Arcsec',
        ' Arccsc',
        'Arsinh',
        'Arcosh',
        'Artanh',
        'Arcsech',
        'Arcsch',
        'Cosh',
        'Cos',
        'Csc',
        'Csch',
        // '??': 'Cot',
        // '??': 'Coth',
        'Sec',
        'Sech',
        'Sin',
        'Sinh',
        'Tan',
        'Tanh',
      ].includes(head)
    )
      headCost = 9;
    else headCost = 10;
  } else headCost = costFunction(head);
  return (
    headCost + (expr.ops?.reduce((acc, x) => acc + costFunction(x), 0) ?? 0)
  );
}

export const DEFAULT_COST_FUNCTION = costFunction;
