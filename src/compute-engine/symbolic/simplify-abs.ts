import type { Expression, RuleStep } from '../global-types';
import { isFunction } from '../boxed-expression/type-guards';
import { isEligibleRealRewrite } from '../function-properties';

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

// Odd trig functions for which |f(x)| = f(|x|) actually holds.
//
// Being odd (f(-x) = -f(x)) is necessary but NOT sufficient: the identity
// also requires f to be sign-fixed on the positive axis (i.e. f(x) >= 0 for
// x >= 0). Sin, Tan, Cot, and Csc are periodic and odd, but they oscillate
// in sign on the positive axis (e.g. sin(4) < 0), so |sin(x)| != sin(|x|)
// in general (counter-example: |sin(4)| = 0.757 but sin(|4|) = -0.757).
// Arccot is odd, but under this engine's (0, pi) range convention it is NOT
// sign-fixed on the positive axis for negative inputs reflected through
// Abs (e.g. |Arccot(-2)| = 2.678 but Arccot(|-2|) = 0.464).
//
// Arcsin, Arctan, and Arccsc remain valid: they are odd AND non-negative for
// non-negative arguments (within their principal branches), so |f(x)| = f(|x|)
// holds.
const ODD_TRIG = new Set(['Arcsin', 'Arctan', 'Arccsc']);

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

// Abs identity rewrites (|xy| -> |x||y|, |x^n| -> ..., |x/y| -> ...) normalize
// structure and are mathematically preferred even when structurally larger, so
// the cost gate in `simplify.ts` exempts them. That exemption previously matched
// the `because` label prefix `'|'` in the cost gate; it now travels with the
// step as `purpose: 'transform'`, preserving exactly the same set (labels that
// start with `'|'`). Even-function rewrites (`cos(|x|) -> cos(x)`,
// simplifyEvenFunctionAbs) were never exempt and stay untagged.
function stampAbsTransform(r: RuleStep | undefined): RuleStep | undefined {
  if (r === undefined) return r;
  if (r.because?.startsWith('|')) return { ...r, purpose: 'transform' };
  return r;
}

export function simplifyAbs(x: Expression): RuleStep | undefined {
  return stampAbsTransform(simplifyAbsCore(x));
}

function simplifyAbsCore(x: Expression): RuleStep | undefined {
  if (!isFunction(x, 'Abs')) return undefined;

  const op = x.op1;
  if (!op) return undefined;

  const ce = x.engine;

  // |x| -> x when x is non-negative
  if (op.isNonNegative === true) return { value: op, because: '|x| -> x' };

  // |x| -> -x when x is non-positive (includes x < 0 and x = 0)
  // Note: -0 = 0, so this is mathematically correct
  if (op.isNonPositive === true)
    return { value: op.neg(), because: '|x| -> -x' };

  const opOperator = op.operator;

  // |-x| -> |x|
  if (opOperator === 'Negate' && isFunction(op)) {
    return { value: ce._fn('Abs', [op.op1]), because: '|-x| -> |x|' };
  }

  // |x * y| patterns
  if (opOperator === 'Multiply' && isFunction(op)) {
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
  if (opOperator === 'Divide' && isFunction(op)) {
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
  if (opOperator === 'Power' && isFunction(op)) {
    const base = op.op1;
    const exp = op.op2;

    if (base && exp) {
      // |x^n| -> x^n when n is even integer (x^n is non-negative for real x).
      // Dropping the Abs is valid only on the reals (|i²| = 1 ≠ i² = -1), so
      // bail on a declared-complex / provably-non-real base (SYM P0-4 / D4).
      if (exp.isEven === true && isEligibleRealRewrite(base)) {
        return {
          value: base.pow(exp),
          because: '|x^n| -> x^n when n is even',
        };
      }

      // |x^n| -> |x|^n when n is odd integer
      if (exp.isOdd === true) {
        return {
          value: ce._fn('Abs', [base]).pow(exp),
          because: '|x^n| -> |x|^n when n is odd',
        };
      }

      // |x^n| -> |x|^n when n is irrational
      if (exp.isRational === false) {
        return {
          value: ce._fn('Abs', [base]).pow(exp),
          because: '|x^n| -> |x|^n when n is irrational',
        };
      }

      // Handle rational (non-integer) exponents via numerator/denominator
      // |x^(p/q)| -> x^(p/q) when p is even (x^p is non-negative)
      // |x^(p/q)| -> |x|^(p/q) when p is odd
      if (exp.isRational === true && exp.isInteger === false) {
        const num = exp.numerator;
        if (num) {
          // Dropping the Abs (p even) is valid only on the reals (D4).
          if (num.isEven === true && isEligibleRealRewrite(base)) {
            return {
              value: base.pow(exp),
              because: '|x^(p/q)| -> x^(p/q) when p is even',
            };
          }
          if (num.isOdd === true) {
            return {
              value: ce._fn('Abs', [base]).pow(exp),
              because: '|x^(p/q)| -> |x|^(p/q) when p is odd',
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
  if (
    (ODD_TRIG.has(opOperator) || ODD_HYPER.has(opOperator)) &&
    isFunction(op)
  ) {
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
export function simplifyAbsPower(x: Expression): RuleStep | undefined {
  return stampAbsTransform(simplifyAbsPowerCore(x));
}

function simplifyAbsPowerCore(x: Expression): RuleStep | undefined {
  if (!isFunction(x, 'Power')) return undefined;

  const base = x.op1;
  const exp = x.op2;

  if (!exp || !isFunction(base, 'Abs')) return undefined;

  const innerBase = base.op1;
  if (!innerBase) return undefined;

  // |x|^n -> x^n drops the Abs, which is valid only on the reals: |i|² = 1 but
  // i² = -1. Bail on a declared-complex / provably-non-real base (SYM P0-4 / D4);
  // unconstrained bases keep the generic-real convention.
  if (!isEligibleRealRewrite(innerBase)) return undefined;

  // |x|^n -> x^n when n is even
  if (exp.isEven === true) {
    return {
      value: innerBase.pow(exp),
      because: '|x|^n -> x^n when n is even',
    };
  }

  // |x|^(n/m) -> x^(n/m) when n is even and m is odd
  if (isFunction(exp, 'Divide')) {
    const n = exp.op1;
    const m = exp.op2;
    if (n && m && n.isEven === true && m.isOdd === true) {
      return {
        value: innerBase.pow(exp),
        because: '|x|^(n/m) -> x^(n/m) when n even, m odd',
      };
    }
  }

  // |x|^(p/q) -> x^(p/q) when p is even (Rational form)
  if (exp.isRational === true && exp.isInteger === false) {
    const num = exp.numerator;
    if (num && num.isEven === true) {
      return {
        value: innerBase.pow(exp),
        because: '|x|^(p/q) -> x^(p/q) when p is even',
      };
    }
  }

  return undefined;
}

/**
 * Even functions: f(|x|) -> f(x)
 * This rule handles Cos, Sec, Cosh, Sech with Abs argument
 */
export function simplifyEvenFunctionAbs(x: Expression): RuleStep | undefined {
  const op = x.operator;
  if (!EVEN_FUNCS.has(op) || !isFunction(x)) return undefined;

  const arg = x.op1;
  if (!isFunction(arg, 'Abs')) return undefined;

  const innerArg = arg.op1;
  if (!innerArg) return undefined;

  return {
    value: x.engine._fn(op, [innerArg]),
    because: `${op}(|x|) -> ${op}(x) (even function)`,
  };
}
