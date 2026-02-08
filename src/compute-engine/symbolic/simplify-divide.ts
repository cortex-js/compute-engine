import type { BoxedExpression, RuleStep } from '../global-types';
import {
  isBoxedFunction,
  isBoxedNumber,
} from '../boxed-expression/type-guards';

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

  return undefined;
}
