import type { Expression, RuleStep } from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import { isMergeable } from '../boxed-expression/effects-of.js';
import {
  imaginaryArgumentValue,
  inverseCompositionValue,
} from '../boxed-expression/trigonometry.js';
import { negatedArgument, oddEvenStep } from './simplify-trig.js';

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

// Odd inverse hyperbolic functions: f(-x) = -f(x). This is true on the
// principal branches for every complex x, also on the branch cuts of Artanh,
// Arcoth and Arcsch.
const ODD_INVERSE_HYPERBOLIC = new Set([
  'Arsinh',
  'Artanh',
  'Arcoth',
  'Arcsch',
]);

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

  // sinh(u)/cosh(u) -> tanh(u) and cosh(u)/sinh(u) -> coth(u). At a zero of
  // the denominator both sides are `~oo`.
  if (op === 'Divide' && isFunction(x)) {
    const num = x.op1;
    const den = x.op2;
    if (isFunction(num) && isFunction(den) && num.op1 && den.op1) {
      const to =
        num.operator === 'Sinh' && den.operator === 'Cosh'
          ? 'Tanh'
          : num.operator === 'Cosh' && den.operator === 'Sinh'
            ? 'Coth'
            : undefined;
      if (to && num.op1.isSame(den.op1) && isMergeable(num.op1))
        return {
          value: ce._fn(to, [num.op1]),
          because: `${num.operator.toLowerCase()}(x)/${den.operator.toLowerCase()}(x) -> ${to.toLowerCase()}(x)`,
        };
    }
  }

  // cosh²(u) - sinh²(u) -> 1 (DLMF 4.37.2), also inside a larger sum.
  if (op === 'Add' && isFunction(x) && x.ops.length >= 2) {
    const squared = (term: Expression, fn: string): Expression | undefined =>
      isFunction(term, 'Power') &&
      term.op2.isSame(2) &&
      isFunction(term.op1, fn) &&
      term.op1.op1
        ? term.op1.op1
        : undefined;
    for (let i = 0; i < x.ops.length; i++) {
      const cosh = squared(x.ops[i], 'Cosh');
      if (!cosh || !isMergeable(cosh)) continue;
      for (let j = 0; j < x.ops.length; j++) {
        const negated = x.ops[j];
        const sinh = isFunction(negated, 'Negate')
          ? squared(negated.op1, 'Sinh')
          : undefined;
        if (!sinh || !sinh.isSame(cosh)) continue;
        const rest = x.ops.filter((_, k) => k !== i && k !== j);
        return {
          value: rest.length === 0 ? ce.One : ce._fn('Add', [ce.One, ...rest]),
          because: 'cosh²(x) - sinh²(x) -> 1',
        };
      }
    }
  }

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

    // Odd/even function properties with negation: f(-x) = -f(x) for an odd
    // function, f(-x) = f(x) for an even function. The argument is
    // `Negate(x)` or a finite negative constant (`negatedArgument()`).
    const negated = negatedArgument(arg);
    if (negated) {
      if (ODD_HYPERBOLIC.has(op)) return oddEvenStep(op, negated, true, ce);
      if (EVEN_HYPERBOLIC.has(op)) return oddEvenStep(op, negated, false, ce);
    }

    // f(f⁻¹(x)) = x, and the imaginary argument (`Cosh(i·t) = Cos(t)`).
    const composed = inverseCompositionValue(op, arg);
    if (composed)
      return { value: composed, because: `${op}(${arg.operator}(x)) -> x` };
    const imaginary = imaginaryArgumentValue(op, arg);
    if (imaginary)
      return {
        value: imaginary,
        because: `${op}(i·t) -> circular`,
        purpose: 'transform',
      };

    // Note: sinh/cosh -> exponential conversions are expansions, not
    // simplifications. They are intentionally NOT included here to preserve
    // function identity for rules like |sinh(x)| -> sinh(|x|) and
    // cosh(|x|) -> cosh(x).
  }

  // Handle inverse hyperbolic functions
  if (INVERSE_HYPERBOLIC.has(op) && isFunction(x)) {
    const arg = x.op1;
    if (!arg) return undefined;

    // arsinh(-x) = -arsinh(x), artanh(-x) = -artanh(x), arcoth(-x) = -arcoth(x),
    // arcsch(-x) = -arcsch(x)
    if (ODD_INVERSE_HYPERBOLIC.has(op)) {
      const negated = negatedArgument(arg);
      if (negated) return oddEvenStep(op, negated, true, ce);
    }

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
