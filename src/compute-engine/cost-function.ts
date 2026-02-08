import type { BoxedExpression } from './global-types';
import type { NumericValue } from './numeric-value/types.js';
import { isBoxedSymbol, isBoxedNumber, isBoxedFunction } from './boxed-expression/type-guards';

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
  // Special-case: Encourage the "exp/log separation" rewrite used by
  // `simplifyLog()` for base-10 logs:
  //
  //   exp(log(x) + y)  ->  x^(1/ln(10)) * e^y
  //
  // Without this tweak, the separated form can look more expensive than
  // `exp(log(x)+y)` because it introduces an explicit `1/ln(10)` exponent.
  //
  // This is intentionally narrow and only affects the specific separated form
  // we generate (a 2-factor Multiply). It exists to prevent a readability
  // rewrite from being rejected purely by the default cost heuristic.
  const expLogSepCost = (() => {
    if (expr.operator !== 'Multiply' || !isBoxedFunction(expr) || expr.ops.length !== 2)
      return null;

    const match = (
      xPow: BoxedExpression,
      ePow: BoxedExpression
    ): { xBase: BoxedExpression; eExp: BoxedExpression } | null => {
      if (!isBoxedFunction(ePow) || ePow.operator !== 'Power') return null;
      if (!isBoxedSymbol(ePow.op1) || ePow.op1.symbol !== 'ExponentialE') return null;

      if (!isBoxedFunction(xPow) || xPow.operator !== 'Power') return null;

      // Match exponent: 1/ln(10)
      const exponent = xPow.op2;
      if (!isBoxedFunction(exponent) || exponent.operator !== 'Divide') return null;
      if (exponent.op1?.is(1) !== true) return null;

      const denom = exponent.op2;
      if (!isBoxedFunction(denom) || denom.operator !== 'Ln') return null;
      if (denom.op1?.is(10) !== true) return null;

      return { xBase: xPow.op1, eExp: ePow.op2 };
    };

    const [a, b] = expr.ops;
    const m = match(a, b) ?? match(b, a);
    if (!m) return null;

    // Approximate the cost of exp(log(x)+y): Add(Log(x), y) ≈ 12 + cost(x) + cost(y)
    return 12 + costFunction(m.xBase) + costFunction(m.eExp);
  })();
  if (expLogSepCost !== null) return expLogSepCost;

  //
  // 1/ Symbols
  //

  if (isBoxedSymbol(expr)) return 1;

  //
  // 2/ Literal Numeric Values
  //

  if (isBoxedNumber(expr)) return numericCostFunction(expr.numericValue);

  const name = expr.operator;
  let nameCost = 2;
  if (['Add'].includes(name)) nameCost = 3;
  else if (['Subtract', 'Negate'].includes(name)) nameCost = 4;
  else if (name === 'Sqrt') {
    // Sqrt with perfect squares inside should be more expensive
    // because √(x²y) should simplify to |x|√y
    const fnExpr = isBoxedFunction(expr) ? expr : undefined;
    const arg = fnExpr?.ops[0];
    if (isBoxedFunction(arg) && arg.operator === 'Multiply') {
      // Check if any factor is a perfect square (Power with even exponent)
      for (const factor of arg.ops) {
        if (isBoxedFunction(factor) && factor.operator === 'Power' && factor.op2?.isEven === true) {
          // Add a penalty to encourage factoring out perfect squares
          return 5 + costFunction(arg) + 6;
        }
      }
    }
    // Also check if arg is directly a perfect square
    if (isBoxedFunction(arg) && arg.operator === 'Power' && arg.op2?.isEven === true) {
      return 5 + costFunction(arg) + 6;
    }
    // Sqrt(x^{odd}) where odd > 1 can be factored: sqrt(x^5) -> |x|^2 * sqrt(x)
    if (
      isBoxedFunction(arg) &&
      arg.operator === 'Power' &&
      arg.op2?.isOdd === true &&
      arg.op2?.isInteger === true
    ) {
      const exp = arg.op2;
      // exp > 1 means (exp - 1) / 2 > 0, i.e., we can factor out something
      const n = isBoxedNumber(exp) ? exp.numericValue : undefined;
      if (typeof n === 'number' && n > 1) {
        // Higher penalty (10) to ensure factored form |x|^n * sqrt(x) is preferred
        return 5 + costFunction(arg) + 10;
      }
    }
    nameCost = 5;
  } else if (['Square', 'Abs'].includes(name)) nameCost = 5;
  else if (name === 'Power') {
    // We want 2q^2 to be less expensive than 2qq, so we mostly ignore the base
    // when the base is simple. However:
    // - If the base is Negate, account for it since (-x)^n and -x^n have same cost
    // - If the base is Multiply, account for its complexity so (ab)^n isn't
    //   artificially cheaper than the distributed form a^n * b^n
    const fnExprPow = isBoxedFunction(expr) ? expr : undefined;
    if (fnExprPow) {
      const base = fnExprPow.ops[0];
      const exp = fnExprPow.ops[1];
      const expCost = costFunction(exp);
      if (base.operator === 'Negate') {
        // Add cost for the negate so (-x)^n isn't artificially cheaper than -x^n
        return expCost + 4; // 4 is the Negate nameCost
      }
      if (base.operator === 'Multiply' && isBoxedFunction(base)) {
        // Check if there's a negative coefficient and a fractional exponent
        // (negative)^{p/q} where q is odd should factor out the sign for correct real evaluation
        const hasNegativeCoef = base.ops.some(
          (f) => isBoxedNumber(f) && f.isNegative === true
        );
        if (hasNegativeCoef && exp.isRational === true && !exp.isInteger) {
          // Heavy penalty to encourage factoring out the negative sign
          // This is needed because (-a*x)^{p/q} gives complex results but
          // -(a*x)^{p/q} gives correct real results when p,q are both odd
          return expCost + costFunction(base) + 15;
        }
        // For (a*b*...)^n, include the base's complexity so power distribution
        // (a*b)^n -> a^n * b^n can be applied when appropriate
        return expCost + costFunction(base);
      }
      return expCost;
    }
  } else if (name === 'Root') {
    // Root(x^n, n) should have comparable cost to |x|
    // Use a base cost similar to Sqrt
    nameCost = 5;
  } else if (['Multiply'].includes(name)) {
    // We want 2x to be less expensive than x + x, so if the first operand
    // is a small number coefficient, treat it as cheaper
    const fnExprMul = isBoxedFunction(expr) ? expr : undefined;
    const ops = fnExprMul?.ops ?? [];
    if (ops.length === 2 && isBoxedNumber(ops[0])) {
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
  } else if (['Divide'].includes(name)) nameCost = 8;
  else if (['Ln', 'Exp', 'Log', 'Lb'].includes(name)) nameCost = 9;
  else if (['Cos', 'Sin', 'Tan'].includes(name)) nameCost = 10;
  else nameCost = 11;

  const fnExprFinal = isBoxedFunction(expr) ? expr : undefined;
  return (
    nameCost + (fnExprFinal?.ops.reduce((acc, x) => acc + costFunction(x), 0) ?? 0)
  );
}

export function leafCount(expr: BoxedExpression): number {
  if (isBoxedSymbol(expr)) return 1;
  if (isBoxedNumber(expr)) return numericCostFunction(expr.numericValue);
  const fnExpr = isBoxedFunction(expr) ? expr : undefined;
  return 1 + (fnExpr?.ops.reduce((acc, x) => acc + leafCount(x), 0) ?? 0);
}

export const DEFAULT_COST_FUNCTION = costFunction;
