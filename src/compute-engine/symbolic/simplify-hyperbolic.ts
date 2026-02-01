import type { BoxedExpression, RuleStep } from '../global-types';

/**
 * Hyperbolic trig simplification rules consolidated from simplify-rules.ts.
 * Handles ~35 patterns for simplifying hyperbolic trig expressions.
 *
 * Categories:
 * - Hyperbolic with infinity
 * - Odd/even function properties with negation
 * - Exponential conversions (sinh, cosh -> exp)
 * - Inverse hyperbolic with infinity
 * - Inverse hyperbolic to logarithm conversions
 *
 * IMPORTANT: Do not call .simplify() on results to avoid infinite recursion.
 */

// Hyperbolic trig functions
const HYPERBOLIC_FUNCS = new Set([
  'Sinh',
  'Cosh',
  'Tanh',
  'Coth',
  'Sech',
  'Csch',
]);

// Odd hyperbolic functions: f(-x) = -f(x)
const ODD_HYPERBOLIC = new Set(['Sinh', 'Tanh', 'Coth', 'Csch']);

// Even hyperbolic functions: f(-x) = f(x)
const EVEN_HYPERBOLIC = new Set(['Cosh', 'Sech']);

// Inverse hyperbolic functions
const INVERSE_HYPERBOLIC = new Set([
  'Arsinh',
  'Arcosh',
  'Artanh',
  'Arcoth',
  'Arsech',
  'Arcsch',
]);

export function simplifyHyperbolic(x: BoxedExpression): RuleStep | undefined {
  const op = x.operator;
  const ce = x.engine;

  // Handle basic hyperbolic functions
  if (HYPERBOLIC_FUNCS.has(op)) {
    const arg = x.op1;
    if (!arg) return undefined;

    // Hyperbolic with infinity
    if (arg.symbol === 'PositiveInfinity') {
      switch (op) {
        case 'Sinh':
          return { value: ce.PositiveInfinity, because: 'sinh(+inf) -> +inf' };
        case 'Cosh':
          return { value: ce.PositiveInfinity, because: 'cosh(+inf) -> +inf' };
        case 'Tanh':
          return { value: ce.One, because: 'tanh(+inf) -> 1' };
        case 'Coth':
          return { value: ce.One, because: 'coth(+inf) -> 1' };
        case 'Sech':
          return { value: ce.Zero, because: 'sech(+inf) -> 0' };
        case 'Csch':
          return { value: ce.Zero, because: 'csch(+inf) -> 0' };
      }
    }

    if (arg.symbol === 'NegativeInfinity') {
      switch (op) {
        case 'Sinh':
          return { value: ce.NegativeInfinity, because: 'sinh(-inf) -> -inf' };
        case 'Cosh':
          return { value: ce.PositiveInfinity, because: 'cosh(-inf) -> +inf' };
        case 'Tanh':
          return { value: ce.NegativeOne, because: 'tanh(-inf) -> -1' };
        case 'Coth':
          return { value: ce.NegativeOne, because: 'coth(-inf) -> -1' };
        case 'Sech':
          return { value: ce.Zero, because: 'sech(-inf) -> 0' };
        case 'Csch':
          return { value: ce.Zero, because: 'csch(-inf) -> 0' };
      }
    }

    // General infinity check for functions that return NaN
    if (arg.isInfinity === true) {
      // Already handled specific cases above for the main hyperbolic functions
      // This catches any edge cases
    }

    // Odd/even function properties with negation
    if (arg.operator === 'Negate') {
      const innerArg = arg.op1;
      if (innerArg) {
        // Odd functions: f(-x) = -f(x)
        if (ODD_HYPERBOLIC.has(op)) {
          return {
            value: ce._fn(op, [innerArg]).neg(),
            because: `${op}(-x) -> -${op}(x)`,
          };
        }
        // Even functions: f(-x) = f(x)
        if (EVEN_HYPERBOLIC.has(op)) {
          return {
            value: ce._fn(op, [innerArg]),
            because: `${op}(-x) -> ${op}(x)`,
          };
        }
      }
    }

    // Exponential conversions
    // sinh(x) -> (e^x - e^{-x})/2
    if (op === 'Sinh') {
      return {
        value: ce
          ._fn('Exp', [arg])
          .sub(ce._fn('Exp', [arg.neg()]))
          .div(2),
        because: 'sinh(x) -> (e^x - e^{-x})/2',
      };
    }

    // cosh(x) -> (e^x + e^{-x})/2
    if (op === 'Cosh') {
      return {
        value: ce
          ._fn('Exp', [arg])
          .add(ce._fn('Exp', [arg.neg()]))
          .div(2),
        because: 'cosh(x) -> (e^x + e^{-x})/2',
      };
    }
  }

  // Handle inverse hyperbolic functions
  if (INVERSE_HYPERBOLIC.has(op)) {
    const arg = x.op1;
    if (!arg) return undefined;

    // Inverse hyperbolic with infinity
    if (op === 'Arsinh') {
      if (arg.symbol === 'PositiveInfinity') {
        return { value: ce.PositiveInfinity, because: 'arsinh(+inf) -> +inf' };
      }
      if (arg.symbol === 'NegativeInfinity') {
        return { value: ce.NegativeInfinity, because: 'arsinh(-inf) -> -inf' };
      }

      // arsinh(x) -> ln(x + sqrt(x^2 + 1))
      return {
        value: ce._fn('Ln', [
          arg.add(ce._fn('Sqrt', [arg.pow(2).add(ce.One)])),
        ]),
        because: 'arsinh(x) -> ln(x + sqrt(x^2 + 1))',
      };
    }

    if (op === 'Arcosh') {
      if (arg.symbol === 'PositiveInfinity') {
        return { value: ce.PositiveInfinity, because: 'arcosh(+inf) -> +inf' };
      }
      if (arg.symbol === 'NegativeInfinity') {
        return { value: ce.NaN, because: 'arcosh(-inf) -> NaN' };
      }

      // arcosh(x) -> ln(x + sqrt(x^2 - 1)) when x > 1
      if (arg.isGreater(1) === true) {
        return {
          value: ce._fn('Ln', [
            arg.add(ce._fn('Sqrt', [arg.pow(2).sub(ce.One)])),
          ]),
          because: 'arcosh(x) -> ln(x + sqrt(x^2 - 1))',
        };
      }
    }

    if (op === 'Artanh') {
      // artanh(±inf) -> NaN
      if (arg.isInfinity === true) {
        return { value: ce.NaN, because: 'artanh(±inf) -> NaN' };
      }

      // artanh(x) -> (1/2) * ln((1 + x)/(1 - x))
      return {
        value: ce.Half.mul(
          ce._fn('Ln', [ce.One.add(arg).div(ce.One.sub(arg))])
        ),
        because: 'artanh(x) -> (1/2)*ln((1+x)/(1-x))',
      };
    }

    if (op === 'Arcoth') {
      // arcoth(±inf) -> NaN
      if (arg.isInfinity === true) {
        return { value: ce.NaN, because: 'arcoth(±inf) -> NaN' };
      }
    }

    if (op === 'Arsech') {
      // arsech(±inf) -> NaN
      if (arg.isInfinity === true) {
        return { value: ce.NaN, because: 'arsech(±inf) -> NaN' };
      }
    }

    if (op === 'Arcsch') {
      // arcsch(±inf) -> 0
      if (arg.isInfinity === true) {
        return { value: ce.Zero, because: 'arcsch(±inf) -> 0' };
      }
    }
  }

  return undefined;
}
