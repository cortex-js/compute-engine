import type { BoxedExpression, RuleStep } from '../global-types';

/**
 * Infinity simplification rules consolidated from simplify-rules.ts.
 * Handles ~20 patterns for simplifying expressions involving infinity.
 *
 * Groups rules by operation type:
 * - Multiply with infinity
 * - Divide with infinity
 * - Power with infinity
 * - Indeterminate forms
 *
 * IMPORTANT: Do not call .simplify() on results to avoid infinite recursion.
 */

export function simplifyInfinity(x: BoxedExpression): RuleStep | undefined {
  const op = x.operator;
  const ce = x.engine;

  // Handle Multiply with infinity
  if (op === 'Multiply' && x.ops && x.ops.length === 2) {
    const [a, b] = x.ops;

    // 0 * x -> 0 when x is finite
    if (a.is(0) && b.isFinite === true) {
      return { value: ce.Zero, because: '0 * finite -> 0' };
    }
    if (b.is(0) && a.isFinite === true) {
      return { value: ce.Zero, because: 'finite * 0 -> 0' };
    }

    // PositiveInfinity * x
    if (a.symbol === 'PositiveInfinity') {
      if (b.isPositive === true) {
        return { value: ce.PositiveInfinity, because: '+inf * positive -> +inf' };
      }
      if (b.isNegative === true) {
        return { value: ce.NegativeInfinity, because: '+inf * negative -> -inf' };
      }
    }

    // x * NegativeInfinity
    if (b.symbol === 'NegativeInfinity') {
      if (a.isPositive === true) {
        return { value: ce.NegativeInfinity, because: 'positive * -inf -> -inf' };
      }
      if (a.isNegative === true) {
        return { value: ce.PositiveInfinity, because: 'negative * -inf -> +inf' };
      }
    }

    // NegativeInfinity * x
    if (a.symbol === 'NegativeInfinity') {
      if (b.isPositive === true) {
        return { value: ce.NegativeInfinity, because: '-inf * positive -> -inf' };
      }
      if (b.isNegative === true) {
        return { value: ce.PositiveInfinity, because: '-inf * negative -> +inf' };
      }
    }

    // x * PositiveInfinity
    if (b.symbol === 'PositiveInfinity') {
      if (a.isPositive === true) {
        return { value: ce.PositiveInfinity, because: 'positive * +inf -> +inf' };
      }
      if (a.isNegative === true) {
        return { value: ce.NegativeInfinity, because: 'negative * +inf -> -inf' };
      }
    }
  }

  // Handle Divide with infinity
  if (op === 'Divide') {
    const num = x.op1;
    const denom = x.op2;

    if (num && denom) {
      // inf / inf -> NaN
      if (num.isInfinity === true && denom.isInfinity === true) {
        return { value: ce.NaN, because: 'inf / inf -> NaN' };
      }

      // PositiveInfinity / x
      if (num.symbol === 'PositiveInfinity') {
        if (denom.isPositive === true && denom.isFinite === true) {
          return { value: ce.PositiveInfinity, because: '+inf / positive -> +inf' };
        }
        if (denom.isNegative === true && denom.isFinite === true) {
          return { value: ce.NegativeInfinity, because: '+inf / negative -> -inf' };
        }
      }

      // NegativeInfinity / x
      if (num.symbol === 'NegativeInfinity') {
        if (denom.isPositive === true && denom.isFinite === true) {
          return { value: ce.NegativeInfinity, because: '-inf / positive -> -inf' };
        }
        if (denom.isNegative === true && denom.isFinite === true) {
          return { value: ce.PositiveInfinity, because: '-inf / negative -> +inf' };
        }
      }
    }
  }

  // Handle Power with infinity
  if (op === 'Power') {
    const base = x.op1;
    const exp = x.op2;

    if (base && exp) {
      // 1^x -> 1 when x is finite
      if (base.is(1) && exp.isFinite === true) {
        return { value: ce.One, because: '1^finite -> 1' };
      }

      // a^0 -> NaN when a is infinity
      if (exp.is(0) && base.isInfinity === true) {
        return { value: ce.NaN, because: 'inf^0 -> NaN' };
      }

      // x^0 -> 1 when x is not zero and finite
      if (exp.is(0) && base.is(0) === false && base.isFinite === true) {
        return { value: ce.One, because: 'x^0 -> 1' };
      }

      // a^PositiveInfinity patterns
      if (exp.symbol === 'PositiveInfinity') {
        // a^+inf -> +inf when a > 1
        if (base.isGreater(1) === true) {
          return { value: ce.PositiveInfinity, because: 'a^+inf -> +inf when a > 1' };
        }
        // a^+inf -> 0 when 0 < a < 1
        if (base.isPositive === true && base.isLess(1) === true) {
          return { value: ce.Zero, because: 'a^+inf -> 0 when 0 < a < 1' };
        }
      }

      // a^NegativeInfinity patterns
      if (exp.symbol === 'NegativeInfinity') {
        // a^-inf -> 0 when a > 1
        if (base.isGreater(1) === true) {
          return { value: ce.Zero, because: 'a^-inf -> 0 when a > 1' };
        }
        // a^-inf -> +inf when 0 < a < 1
        if (base.isPositive === true && base.isLess(1) === true) {
          return { value: ce.PositiveInfinity, because: 'a^-inf -> +inf when 0 < a < 1' };
        }
      }

      // PositiveInfinity^a patterns
      if (base.symbol === 'PositiveInfinity') {
        // +inf^a -> 0 when a < 0
        if (exp.isNegative === true) {
          return { value: ce.Zero, because: '+inf^negative -> 0' };
        }
        // Note: +inf^a -> +inf when a > 0 is already handled by evaluation
      }

      // NegativeInfinity^a patterns
      if (base.symbol === 'NegativeInfinity') {
        // -inf^a -> 0 when a < 0
        if (exp.isNegative === true) {
          return { value: ce.Zero, because: '-inf^negative -> 0' };
        }
      }
    }
  }

  return undefined;
}
