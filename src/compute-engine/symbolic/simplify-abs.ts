import type { BoxedExpression, RuleStep } from '../global-types';

/**
 * Abs simplification rules consolidated from simplify-rules.ts.
 * Handles ~30 patterns for simplifying Abs expressions.
 *
 * Performance optimizations:
 * - Uses Set lookups for odd/even function classification (O(1))
 * - Quick bailout if operator is not Abs
 * - Checks cheapest conditions first
 *
 * IMPORTANT: Do not call .simplify() on results to avoid infinite recursion.
 */

// Odd trig functions: f(-x) = -f(x), so |f(x)| = f(|x|)
const ODD_TRIG = new Set([
  'Sin',
  'Tan',
  'Cot',
  'Csc',
  'Arcsin',
  'Arctan',
  'Arccot',
  'Arccsc',
]);

// Odd hyperbolic functions: f(-x) = -f(x), so |f(x)| = f(|x|)
const ODD_HYPER = new Set([
  'Sinh',
  'Tanh',
  'Coth',
  'Csch',
  'Arsinh',
  'Artanh',
  'Arcoth',
  'Arcsch',
]);

// Even functions: f(-x) = f(x), so f(|x|) = f(x)
const EVEN_FUNCS = new Set(['Cos', 'Sec', 'Cosh', 'Sech']);

export function simplifyAbs(x: BoxedExpression): RuleStep | undefined {
  if (x.operator !== 'Abs') return undefined;

  const op = x.op1;
  if (!op) return undefined;

  const ce = x.engine;

  // |x| -> x when x is non-negative
  if (op.isNonNegative === true) return { value: op, because: '|x| -> x' };

  // |x| -> -x when x is non-positive (includes x < 0 and x = 0)
  // Note: -0 = 0, so this is mathematically correct
  if (op.isNonPositive === true) return { value: op.neg(), because: '|x| -> -x' };

  const opOperator = op.operator;

  // |-x| -> |x|
  if (opOperator === 'Negate') {
    return { value: ce._fn('Abs', [op.op1]), because: '|-x| -> |x|' };
  }

  // |x * y| patterns
  if (opOperator === 'Multiply' && op.ops) {
    const ops = op.ops;

    // Find if any factor has known sign
    for (let i = 0; i < ops.length; i++) {
      const factor = ops[i];

      if (factor.isNonNegative === true) {
        // |x * y| -> x * |y| when x is non-negative
        const otherFactors = ops.filter((_, idx) => idx !== i);
        const remaining =
          otherFactors.length === 1
            ? otherFactors[0]
            : ce._fn('Multiply', otherFactors);
        return {
          value: factor.mul(ce._fn('Abs', [remaining])),
          because: '|xy| -> x|y| when x >= 0',
        };
      }

      if (factor.isNonPositive === true) {
        // |x * y| -> (-x) * |y| when x is non-positive
        const otherFactors = ops.filter((_, idx) => idx !== i);
        const remaining =
          otherFactors.length === 1
            ? otherFactors[0]
            : ce._fn('Multiply', otherFactors);
        return {
          value: factor.neg().mul(ce._fn('Abs', [remaining])),
          because: '|xy| -> -x|y| when x <= 0',
        };
      }
    }

    // General case: |xy| -> |x||y|
    if (ops.length === 2) {
      return {
        value: ce._fn('Abs', [ops[0]]).mul(ce._fn('Abs', [ops[1]])),
        because: '|xy| -> |x||y|',
      };
    }
  }

  // |x / y| patterns
  if (opOperator === 'Divide') {
    const num = op.op1;
    const denom = op.op2;

    if (num && denom) {
      // |x/y| -> x/|y| when x is non-negative
      if (num.isNonNegative === true) {
        return {
          value: num.div(ce._fn('Abs', [denom])),
          because: '|x/y| -> x/|y| when x >= 0',
        };
      }

      // |x/y| -> -x/|y| when x is non-positive
      if (num.isNonPositive === true) {
        return {
          value: num.neg().div(ce._fn('Abs', [denom])),
          because: '|x/y| -> -x/|y| when x <= 0',
        };
      }

      // |x/y| -> |x|/y when y is non-negative
      if (denom.isNonNegative === true) {
        return {
          value: ce._fn('Abs', [num]).div(denom),
          because: '|x/y| -> |x|/y when y >= 0',
        };
      }

      // |x/y| -> -|x|/y when y is non-positive
      if (denom.isNonPositive === true) {
        return {
          value: ce._fn('Abs', [num]).neg().div(denom),
          because: '|x/y| -> -|x|/y when y <= 0',
        };
      }

      // General case: |x/y| -> |x|/|y|
      return {
        value: ce._fn('Abs', [num]).div(ce._fn('Abs', [denom])),
        because: '|x/y| -> |x|/|y|',
      };
    }
  }

  // |x^n| patterns
  if (opOperator === 'Power') {
    const base = op.op1;
    const exp = op.op2;

    if (base && exp) {
      // |x^n| -> |x|^n when n is odd or irrational
      if (exp.isOdd === true || exp.isRational === false) {
        return {
          value: ce._fn('Abs', [base]).pow(exp),
          because: '|x^n| -> |x|^n when n is odd/irrational',
        };
      }

      // |x^(n/m)| patterns
      if (exp.operator === 'Divide') {
        const n = exp.op1;
        const m = exp.op2;
        if (n && m) {
          // |x^(n/m)| -> |x|^(n/m) when n is odd or m is integer
          if (n.isOdd === true || m.isInteger === true) {
            return {
              value: ce._fn('Abs', [base]).pow(exp),
              because: '|x^(n/m)| -> |x|^(n/m)',
            };
          }
        }
      }
    }
  }

  // |x|^n -> x^n when n is even
  // This catches patterns like Power(Abs(_x), _n)
  // Note: This is handled separately since x here is actually Abs(something)

  // Odd trig/hyperbolic functions: |f(x)| -> f(|x|)
  if (ODD_TRIG.has(opOperator) || ODD_HYPER.has(opOperator)) {
    const innerArg = op.op1;
    if (innerArg) {
      return {
        value: ce._fn(opOperator, [ce._fn('Abs', [innerArg])]),
        because: `|${opOperator}(x)| -> ${opOperator}(|x|) (odd function)`,
      };
    }
  }

  return undefined;
}

/**
 * Simplify expressions where Abs appears as the base of a power.
 * |x|^n -> x^n when n is even
 */
export function simplifyAbsPower(x: BoxedExpression): RuleStep | undefined {
  if (x.operator !== 'Power') return undefined;

  const base = x.op1;
  const exp = x.op2;

  if (!base || !exp || base.operator !== 'Abs') return undefined;

  const innerBase = base.op1;
  if (!innerBase) return undefined;

  // |x|^n -> x^n when n is even
  if (exp.isEven === true) {
    return {
      value: innerBase.pow(exp),
      because: '|x|^n -> x^n when n is even',
    };
  }

  // |x|^(n/m) -> x^(n/m) when n is even and m is odd
  if (exp.operator === 'Divide') {
    const n = exp.op1;
    const m = exp.op2;
    if (n && m && n.isEven === true && m.isOdd === true) {
      return {
        value: innerBase.pow(exp),
        because: '|x|^(n/m) -> x^(n/m) when n even, m odd',
      };
    }
  }

  return undefined;
}

/**
 * Even functions: f(|x|) -> f(x)
 * This rule handles Cos, Sec, Cosh, Sech with Abs argument
 */
export function simplifyEvenFunctionAbs(
  x: BoxedExpression
): RuleStep | undefined {
  const op = x.operator;
  if (!EVEN_FUNCS.has(op)) return undefined;

  const arg = x.op1;
  if (!arg || arg.operator !== 'Abs') return undefined;

  const innerArg = arg.op1;
  if (!innerArg) return undefined;

  return {
    value: x.engine._fn(op, [innerArg]),
    because: `${op}(|x|) -> ${op}(x) (even function)`,
  };
}
