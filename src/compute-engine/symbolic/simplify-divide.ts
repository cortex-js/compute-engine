import type { BoxedExpression, RuleStep } from '../global-types';

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
  if (x.operator !== 'Divide') return undefined;

  const num = x.op1;
  const denom = x.op2;

  if (!num || !denom) return undefined;

  const ce = x.engine;

  // 0/a -> 0 when a ≠ 0
  if (num.is(0) && denom.is(0) === false) {
    return { value: ce.Zero, because: '0/a -> 0' };
  }

  // a/a -> 1 when a ≠ 0 and a is finite (∞/∞ is indeterminate)
  if (num.isSame(denom) && num.is(0) === false && num.isInfinity !== true) {
    return { value: ce.One, because: 'a/a -> 1' };
  }

  // ∞/∞ -> NaN (indeterminate form)
  if (num.isInfinity && denom.isInfinity) {
    return { value: ce.NaN, because: 'inf/inf -> NaN' };
  }

  // Check if denominator is a Divide expression
  if (denom.operator === 'Divide') {
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
