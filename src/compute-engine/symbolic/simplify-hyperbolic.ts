import type { Expression, RuleStep } from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';

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

export function simplifyHyperbolic(x: Expression): RuleStep | undefined {
  const op = x.operator;
  const ce = x.engine;

  // Handle basic hyperbolic functions
  if (HYPERBOLIC_FUNCS.has(op) && isFunction(x)) {
    const arg = x.op1;
    if (!arg) return undefined;

    // Hyperbolic with infinity
    if (arg.isInfinity === true && arg.isPositive === true) {
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

    if (arg.isInfinity === true && arg.isNegative === true) {
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

    // Odd/even function properties with negation
    if (isFunction(arg, 'Negate')) {
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

    // Note: sinh/cosh -> exponential conversions are expansions, not
    // simplifications. They are intentionally NOT included here to preserve
    // function identity for rules like |sinh(x)| -> sinh(|x|) and
    // cosh(|x|) -> cosh(x).
  }

  // Handle inverse hyperbolic functions
  if (INVERSE_HYPERBOLIC.has(op) && isFunction(x)) {
    const arg = x.op1;
    if (!arg) return undefined;

    // Inverse hyperbolic with infinity
    if (op === 'Arsinh') {
      if (arg.isInfinity === true && arg.isPositive === true) {
        return { value: ce.PositiveInfinity, because: 'arsinh(+inf) -> +inf' };
      }
      if (arg.isInfinity === true && arg.isNegative === true) {
        return { value: ce.NegativeInfinity, because: 'arsinh(-inf) -> -inf' };
      }
      // Note: arsinh(x) -> ln(...) conversion is an expansion, not included
      // here to preserve function identity for |arsinh(x)| -> arsinh(|x|).
    }

    if (op === 'Arcosh') {
      if (arg.isInfinity === true && arg.isPositive === true) {
        return { value: ce.PositiveInfinity, because: 'arcosh(+inf) -> +inf' };
      }
      // No arm for −∞ on purpose: `arcosh(−∞) = ∞ + iπ` — an infinite
      // real part with a finite imaginary offset, which no exact number
      // spells — so the expression stays symbolic here as under
      // `evaluate()`, and only `.N()` numericizes (the `Ln(−∞)`
      // treatment). The old `-> NaN` rewrite contradicted that value.

      // Note: arcosh(x) -> ln(...) conversion is an expansion, not included
      // here to preserve function identity for even function abs rules.
    }

    if (op === 'Artanh') {
      // artanh(±∞) = ∓(π/2)i — the imaginary asymptotes of the
      // principal branch, the same values the evaluate route folds. A
      // `~oo` argument (isPositive/isNegative both undefined) falls
      // through: the two signs disagree, so artanh has no value there
      // and the evaluate route reports the incompatible-type error.
      if (arg.isInfinity === true && arg.isPositive === true) {
        return {
          value: ce.I.mul(ce.Pi).div(-2),
          because: 'artanh(+inf) -> -iπ/2',
        };
      }
      if (arg.isInfinity === true && arg.isNegative === true) {
        return {
          value: ce.I.mul(ce.Pi).div(2),
          because: 'artanh(-inf) -> iπ/2',
        };
      }

      // Note: artanh(x) -> ln(...) conversion is an expansion, not included
      // here to preserve function identity for |artanh(x)| -> artanh(|x|).
    }

    if (op === 'Arcoth') {
      // arcoth(±inf) -> 0 (lim_{x→±∞} arccoth(x) = 0)
      if (arg.isInfinity === true) {
        return { value: ce.Zero, because: 'arcoth(±inf) -> 0' };
      }
    }

    if (op === 'Arsech') {
      // arsech(±∞) = (π/2)i — both real approaches give arcosh(0), the
      // same value the evaluate route folds. A `~oo` argument falls
      // through (arcosh's branch cut passes through 0, so the complex
      // directions disagree; the evaluate route reports the
      // incompatible-type error).
      if (
        arg.isInfinity === true &&
        (arg.isPositive === true || arg.isNegative === true)
      ) {
        return {
          value: ce.I.mul(ce.Pi).div(2),
          because: 'arsech(±inf) -> iπ/2',
        };
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
