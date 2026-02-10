import type { BoxedExpression, RuleStep } from '../global-types';
import {
  isBoxedFunction,
  isBoxedNumber,
} from '../boxed-expression/type-guards';
import { asRational } from '../boxed-expression/numerics';

/**
 * Division simplification rules consolidated from simplify-rules.ts.
 * Handles ~5 patterns for simplifying Divide expressions.
 *
 * Patterns:
 * - a/a -> 1 (when a ≠ 0)
 * - 1/(1/a) -> a (when a ≠ 0)
 * - a/(1/b) -> a*b (when b ≠ 0)
 * - a/(b/c) -> a*c/b (when c ≠ 0)
 * - 0/a -> 0 (when a ≠ 0)
 *
 * IMPORTANT: Do not call .simplify() on results to avoid infinite recursion.
 */

export function simplifyDivide(x: BoxedExpression): RuleStep | undefined {
  if (x.operator !== 'Divide' || !isBoxedFunction(x)) return undefined;

  const num = x.op1;
  const denom = x.op2;

  if (!num || !denom) return undefined;

  const ce = x.engine;

  // 0/0 -> NaN
  if (num.is(0) && denom.is(0)) {
    return { value: ce.NaN, because: '0/0 -> NaN' };
  }

  // 0/a -> 0 when a ≠ 0
  // Note: be conservative with constant (no-unknown) denominators, since they
  // may simplify/evaluate to 0 (e.g. 1-1) and we want to avoid 0/(1-1) -> 0.
  // Those cases can be handled by an explicit preliminary evaluation.
  if (
    num.is(0) &&
    denom.is(0) === false &&
    (isBoxedNumber(denom) || denom.symbols.length !== 0)
  ) {
    return { value: ce.Zero, because: '0/a -> 0' };
  }

  // a/a -> 1 when a ≠ 0 and a is finite (∞/∞ is indeterminate)
  if (
    num.isSame(denom) &&
    num.is(0) === false &&
    num.isInfinity !== true &&
    (isBoxedNumber(num) || num.symbols.length !== 0)
  ) {
    return { value: ce.One, because: 'a/a -> 1' };
  }

  // ∞/∞ -> NaN (indeterminate form)
  if (num.isInfinity && denom.isInfinity) {
    return { value: ce.NaN, because: 'inf/inf -> NaN' };
  }

  // Check if denominator is a Divide expression
  if (denom.operator === 'Divide' && isBoxedFunction(denom)) {
    const denomNum = denom.op1;
    const denomDenom = denom.op2;

    if (!denomNum || !denomDenom) return undefined;

    // 1/(1/a) -> a when a ≠ 0
    if (num.is(1) && denomNum.is(1) && denomDenom.is(0) === false) {
      return { value: denomDenom, because: '1/(1/a) -> a' };
    }

    // a/(1/b) -> a*b when b ≠ 0
    if (denomNum.is(1) && denomDenom.is(0) === false) {
      return { value: num.mul(denomDenom), because: 'a/(1/b) -> a*b' };
    }

    // a/(b/c) -> a*c/b when c ≠ 0
    if (denomDenom.is(0) === false) {
      return {
        value: num.mul(denomDenom).div(denomNum),
        because: 'a/(b/c) -> a*c/b',
      };
    }
  }

  // Power(base, a) / Power(base, b) -> Power(base, a - b)
  // This covers cases like x^{sqrt(2)} / x^3 -> x^{sqrt(2)-3}
  // where the exponents are not rational and can't be combined during
  // canonicalization
  {
    let numBase: BoxedExpression | undefined;
    let numExp: BoxedExpression | undefined;
    let denomBase: BoxedExpression | undefined;
    let denomExp: BoxedExpression | undefined;

    if (num.operator === 'Power' && isBoxedFunction(num)) {
      numBase = num.op1;
      numExp = num.op2;
    } else {
      numBase = num;
      numExp = ce.One;
    }
    if (denom.operator === 'Power' && isBoxedFunction(denom)) {
      denomBase = denom.op1;
      denomExp = denom.op2;
    } else {
      denomBase = denom;
      denomExp = ce.One;
    }

    if (numBase && denomBase && numBase.isSame(denomBase)) {
      // Only apply when at least one exponent is non-rational (symbolic)
      // Rational cases are already handled by canonicalization
      if (!asRational(numExp!) || !asRational(denomExp!)) {
        const diffExp = ce.function('Add', [numExp!, denomExp!.neg()]);
        if (diffExp.is(0)) return { value: ce.One, because: 'x^a/x^a -> 1' };
        if (diffExp.is(1))
          return { value: numBase, because: 'x^a/x^b -> x when a-b=1' };
        return {
          value: ce._fn('Power', [numBase, diffExp]),
          because: 'x^a/x^b -> x^(a-b)',
        };
      }
    }
  }

  return undefined;
}
