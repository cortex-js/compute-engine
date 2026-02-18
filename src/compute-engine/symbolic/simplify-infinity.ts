import type { Expression, RuleStep } from '../global-types';
import { isFunction, isSymbol } from '../boxed-expression/type-guards';

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

export function simplifyInfinity(x: Expression): RuleStep | undefined {
  const op = x.operator;
  const ce = x.engine;

  // Handle Multiply with infinity
  if (op === 'Multiply' && isFunction(x) && x.ops.length === 2) {
    const [a, b] = x.ops;

    // Use isInfinity property to detect infinity values
    const aIsInf = a.isInfinity === true;
    const bIsInf = b.isInfinity === true;
    const aIsPosInf = aIsInf && a.isPositive === true;
    const aIsNegInf = aIsInf && a.isNegative === true;
    const bIsPosInf = bIsInf && b.isPositive === true;
    const bIsNegInf = bIsInf && b.isNegative === true;

    // 0 * infinity -> NaN (indeterminate form)
    if (a.isSame(0) && bIsInf) {
      return { value: ce.NaN, because: '0 * infinity -> NaN' };
    }
    if (b.isSame(0) && aIsInf) {
      return { value: ce.NaN, because: 'infinity * 0 -> NaN' };
    }

    // 0 * x -> 0 when x is finite
    if (a.isSame(0) && b.isFinite === true) {
      return { value: ce.Zero, because: '0 * finite -> 0' };
    }
    if (b.isSame(0) && a.isFinite === true) {
      return { value: ce.Zero, because: 'finite * 0 -> 0' };
    }

    // PositiveInfinity * x
    if (aIsPosInf) {
      if (b.isPositive === true) {
        return {
          value: ce.PositiveInfinity,
          because: '+inf * positive -> +inf',
        };
      }
      if (b.isNegative === true) {
        return {
          value: ce.NegativeInfinity,
          because: '+inf * negative -> -inf',
        };
      }
    }

    // x * NegativeInfinity
    if (bIsNegInf) {
      if (a.isPositive === true) {
        return {
          value: ce.NegativeInfinity,
          because: 'positive * -inf -> -inf',
        };
      }
      if (a.isNegative === true) {
        return {
          value: ce.PositiveInfinity,
          because: 'negative * -inf -> +inf',
        };
      }
    }

    // NegativeInfinity * x
    if (aIsNegInf) {
      if (b.isPositive === true) {
        return {
          value: ce.NegativeInfinity,
          because: '-inf * positive -> -inf',
        };
      }
      if (b.isNegative === true) {
        return {
          value: ce.PositiveInfinity,
          because: '-inf * negative -> +inf',
        };
      }
    }

    // x * PositiveInfinity
    if (bIsPosInf) {
      if (a.isPositive === true) {
        return {
          value: ce.PositiveInfinity,
          because: 'positive * +inf -> +inf',
        };
      }
      if (a.isNegative === true) {
        return {
          value: ce.NegativeInfinity,
          because: 'negative * +inf -> -inf',
        };
      }
    }
  }

  // Handle Divide with infinity
  if (op === 'Divide' && isFunction(x)) {
    const num = x.op1;
    const denom = x.op2;

    if (num && denom) {
      // Use isInfinity property to detect infinity values
      const numIsInf = num.isInfinity === true;
      const denomIsInf = denom.isInfinity === true;
      const numIsPosInf = numIsInf && num.isPositive === true;
      const numIsNegInf = numIsInf && num.isNegative === true;

      // inf / inf -> NaN (indeterminate form)
      if (numIsInf && denomIsInf) {
        return { value: ce.NaN, because: 'inf / inf -> NaN' };
      }

      // PositiveInfinity / x
      if (numIsPosInf) {
        if (denom.isPositive === true && denom.isFinite === true) {
          return {
            value: ce.PositiveInfinity,
            because: '+inf / positive -> +inf',
          };
        }
        if (denom.isNegative === true && denom.isFinite === true) {
          return {
            value: ce.NegativeInfinity,
            because: '+inf / negative -> -inf',
          };
        }
      }

      // NegativeInfinity / x
      if (numIsNegInf) {
        if (denom.isPositive === true && denom.isFinite === true) {
          return {
            value: ce.NegativeInfinity,
            because: '-inf / positive -> -inf',
          };
        }
        if (denom.isNegative === true && denom.isFinite === true) {
          return {
            value: ce.PositiveInfinity,
            because: '-inf / negative -> +inf',
          };
        }
      }
    }
  }

  // Handle Exp function with infinity
  if (op === 'Exp' && isFunction(x)) {
    const arg = x.op1;
    if (arg) {
      // exp(+inf) -> +inf
      if (isSymbol(arg, 'PositiveInfinity')) {
        return { value: ce.PositiveInfinity, because: 'exp(+inf) -> +inf' };
      }
      // exp(-inf) -> 0
      if (isSymbol(arg, 'NegativeInfinity')) {
        return { value: ce.Zero, because: 'exp(-inf) -> 0' };
      }
    }
  }

  // Handle Power with infinity
  if (op === 'Power' && isFunction(x)) {
    const base = x.op1;
    const exp = x.op2;

    if (base && exp) {
      // Use isInfinity property to detect infinity values
      const baseIsInf = base.isInfinity === true;
      const expIsInf = exp.isInfinity === true;
      const baseIsPosInf = baseIsInf && base.isPositive === true;
      const baseIsNegInf = baseIsInf && base.isNegative === true;
      const expIsPosInf = expIsInf && exp.isPositive === true;
      const expIsNegInf = expIsInf && exp.isNegative === true;

      // e^(+inf) -> +inf (handle exponential base explicitly)
      if (isSymbol(base, 'ExponentialE') && expIsPosInf) {
        return { value: ce.PositiveInfinity, because: 'e^(+inf) -> +inf' };
      }
      // e^(-inf) -> 0
      if (isSymbol(base, 'ExponentialE') && expIsNegInf) {
        return { value: ce.Zero, because: 'e^(-inf) -> 0' };
      }

      // 1^x -> 1 when x is finite
      if (base.isSame(1) && exp.isFinite === true) {
        return { value: ce.One, because: '1^finite -> 1' };
      }

      // a^0 -> NaN when a is infinity
      if (exp.isSame(0) && baseIsInf) {
        return { value: ce.NaN, because: 'inf^0 -> NaN' };
      }

      // x^0 -> 1 when x is not zero and finite
      if (exp.isSame(0) && base.isSame(0) === false && base.isFinite === true) {
        return { value: ce.One, because: 'x^0 -> 1' };
      }

      // a^PositiveInfinity patterns
      if (expIsPosInf) {
        // a^+inf -> +inf when a > 1
        if (base.isGreater(1) === true) {
          return {
            value: ce.PositiveInfinity,
            because: 'a^+inf -> +inf when a > 1',
          };
        }
        // a^+inf -> 0 when 0 < a < 1
        if (base.isPositive === true && base.isLess(1) === true) {
          return { value: ce.Zero, because: 'a^+inf -> 0 when 0 < a < 1' };
        }
      }

      // a^NegativeInfinity patterns
      if (expIsNegInf) {
        // a^-inf -> 0 when a > 1
        if (base.isGreater(1) === true) {
          return { value: ce.Zero, because: 'a^-inf -> 0 when a > 1' };
        }
        // a^-inf -> +inf when 0 < a < 1
        if (base.isPositive === true && base.isLess(1) === true) {
          return {
            value: ce.PositiveInfinity,
            because: 'a^-inf -> +inf when 0 < a < 1',
          };
        }
      }

      // PositiveInfinity^a patterns
      if (baseIsPosInf) {
        // +inf^a -> 0 when a < 0
        if (exp.isNegative === true) {
          return { value: ce.Zero, because: '+inf^negative -> 0' };
        }
        // Note: +inf^a -> +inf when a > 0 is already handled by evaluation
      }

      // NegativeInfinity^a patterns
      if (baseIsNegInf) {
        // -inf^a -> 0 when a < 0
        if (exp.isNegative === true) {
          return { value: ce.Zero, because: '-inf^negative -> 0' };
        }

        // (-inf)^n -> +inf when n is even integer
        if (exp.isInteger === true && exp.isEven === true) {
          return {
            value: ce.PositiveInfinity,
            because: '(-inf)^(even integer) -> +inf',
          };
        }

        // (-inf)^n -> -inf when n is odd integer
        if (exp.isInteger === true && exp.isOdd === true) {
          return {
            value: ce.NegativeInfinity,
            because: '(-inf)^(odd integer) -> -inf',
          };
        }

        // (-inf)^(n/m) -> +inf when n is even and m is odd
        // This handles cases like (-inf)^(2/3), (-inf)^(4/5)
        if (exp.isRational === true) {
          const [numExpr, denomExpr] = exp.numeratorDenominator;
          const num = numExpr.re;
          const denom = denomExpr.re;

          if (
            typeof num === 'number' &&
            typeof denom === 'number' &&
            Number.isInteger(num) &&
            Number.isInteger(denom)
          ) {
            const numIsEven = num % 2 === 0;
            const numIsOdd = num % 2 !== 0;
            const denomIsOdd = denom % 2 !== 0;

            // n even, m odd -> +inf
            if (numIsEven && denomIsOdd) {
              return {
                value: ce.PositiveInfinity,
                because: '(-inf)^(even/odd) -> +inf',
              };
            }

            // n odd, m odd -> -inf (real interpretation)
            // Note: This is the real branch of the multivalued function
            // The principal complex value would be different
            if (numIsOdd && denomIsOdd) {
              return {
                value: ce.NegativeInfinity,
                because: '(-inf)^(odd/odd) -> -inf (real)',
              };
            }
          }
        }
      }
    }
  }

  return undefined;
}
