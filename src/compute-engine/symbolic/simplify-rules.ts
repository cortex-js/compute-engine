import {
  constructibleValues,
  isConstructible,
  processInverseFunction,
} from '../boxed-expression/trigonometry';
import { mul } from '../boxed-expression/arithmetic-mul-div';
import { simplifyLogicFunction } from '../library/logic';
import type {
  BoxedExpression,
  Rule,
  RuleStep,
  ComputeEngine,
} from '../global-types';
import { expand } from '../boxed-expression/expand';
import { factor } from '../boxed-expression/factor';
import { add } from '../boxed-expression/arithmetic-add';
import { SMALL_INTEGER } from '../numerics/numeric';
import { NumericValue } from '../numeric-value/types';
import {
  isEquationOperator,
  isInequalityOperator,
  isRelationalOperator,
} from '../latex-syntax/utils';
import { cancelCommonFactors } from '../boxed-expression/polynomials';
import { simplifySum } from './simplify-sum';
import { simplifyProduct } from './simplify-product';

/**
 * # Performance Optimization Notes for Simplification Rules
 *
 * This file contains rules that are applied repeatedly during simplification.
 * Performance is critical here. Keep these guidelines in mind when writing
 * or optimizing rules:
 *
 * ## 1. Use `_fn()` instead of `function()` when operands are already canonical
 *
 * When creating expressions in rule replacements, the operands (from pattern
 * matching like `ids._x`) are already canonical. Using `_fn()` bypasses
 * re-canonicalization and avoids potential recursion issues:
 *
 * ```typescript
 * // Slower - re-canonicalizes operands:
 * replace: (expr, ids) => expr.engine.function('Sin', [ids._x])
 *
 * // Faster - operands already canonical:
 * replace: (expr, ids) => expr.engine._fn('Sin', [ids._x])
 * ```
 *
 * Note: For n-ary operators like Add/Multiply that need flattening or sorting,
 * `function()` may still be necessary.
 *
 * ## 2. Avoid LaTeX strings - prefer MathJSON patterns
 *
 * LaTeX strings require parsing which is costly. Use MathJSON arrays instead:
 *
 * ```typescript
 * // Slower - requires LaTeX parsing:
 * '\\sin(x) -> \\cos(x)'
 *
 * // Faster - direct MathJSON:
 * { match: ['Sin', '_x'], replace: (expr, ids) => expr.engine._fn('Cos', [ids._x]) }
 * ```
 *
 * The `match -> replace` string syntax is convenient for prototyping but should
 * be converted to MathJSON for production rules.
 *
 * ## 3. Use functional rules for quick applicability checks
 *
 * Pattern matching has overhead. For rules that only apply to specific operators,
 * use the functional form to do a quick check first:
 *
 * ```typescript
 * // Pattern matching approach - always attempts match:
 * { match: ['Abs', ['Negate', '_x']], replace: ... }
 *
 * // Functional approach - quick bailout if not applicable:
 * (x): RuleStep | undefined => {
 *   if (x.operator !== 'Abs') return undefined;
 *   if (x.op1.operator !== 'Negate') return undefined;
 *   return { value: x.engine._fn('Abs', [x.op1.op1]), because: 'abs-negate' };
 * }
 * ```
 *
 * ## 4. Use helper functions for common replacements
 *
 * The helper functions below (toNaN, toZero, etc.) avoid creating new
 * expressions and improve performance for common constant replacements.
 */

// Helper functions for common rule replacements
// These avoid parsing LaTeX strings and improve initialization performance
const toNaN = (expr: BoxedExpression) => expr.engine.NaN;
const toZero = (expr: BoxedExpression) => expr.engine.Zero;
const toOne = (expr: BoxedExpression) => expr.engine.One;
const toNegativeOne = (expr: BoxedExpression) => expr.engine.NegativeOne;
const toInfinity = (expr: BoxedExpression) => expr.engine.PositiveInfinity;
const toNegativeInfinity = (expr: BoxedExpression) =>
  expr.engine.NegativeInfinity;

/**
 * Reduce trigonometric functions by their periodicity.
 *
 * For sin/cos/sec/csc (period 2π): reduce coefficient of π modulo 2
 * For tan/cot (period π): reduce coefficient of π modulo 1 (just remove integer multiples)
 *
 * Example: cos(5π + k) → -cos(k) because 5 mod 2 = 1, and cos(π + x) = -cos(x)
 */
function reduceTrigPeriodicity(
  fn: 'Sin' | 'Cos' | 'Tan' | 'Cot' | 'Sec' | 'Csc',
  arg: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression | null {
  // Only handle Add expressions
  if (arg.operator !== 'Add' || !arg.ops) return null;

  const terms = arg.ops;

  // Find a term that is a multiple of π
  let piCoeff: number | null = null;
  let piTermIndex = -1;

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];

    // Check for plain Pi
    if (term.symbol === 'Pi') {
      piCoeff = 1;
      piTermIndex = i;
      break;
    }

    // Check for n * Pi or Pi * n
    if (term.operator === 'Multiply' && term.ops) {
      const termOps = term.ops;
      // Look for Pi among the factors
      const piIndex = termOps.findIndex((op) => op.symbol === 'Pi');
      if (piIndex >= 0) {
        // Get the coefficient (product of all other factors)
        const otherFactors = termOps.filter((_, idx) => idx !== piIndex);
        if (otherFactors.length === 1) {
          const n = otherFactors[0].numericValue;
          if (typeof n === 'number' && Number.isInteger(n)) {
            piCoeff = n;
            piTermIndex = i;
            break;
          }
        } else if (otherFactors.length === 0) {
          // Just Pi in a Multiply (shouldn't happen but handle it)
          piCoeff = 1;
          piTermIndex = i;
          break;
        }
      }
    }

    // Check for Negate(Pi) = -Pi
    if (term.operator === 'Negate' && term.op1?.symbol === 'Pi') {
      piCoeff = -1;
      piTermIndex = i;
      break;
    }
  }

  // No multiple of π found
  if (piCoeff === null || piTermIndex < 0) return null;

  // Determine the period and calculate the reduced coefficient
  const period = fn === 'Tan' || fn === 'Cot' ? 1 : 2;

  // Reduce coefficient modulo period
  // JavaScript % can give negative results, so we normalize
  let reduced = piCoeff % period;
  if (reduced < 0) reduced += period;

  // If reduced is 0, the multiple of π has no effect - just remove the π term
  // If reduced is 1 (for period 2), we have a half-period shift

  // Build the remaining argument (without the π term)
  const remainingTerms = terms.filter((_, idx) => idx !== piTermIndex);

  // Add back the reduced π coefficient if non-zero
  if (reduced !== 0) {
    if (reduced === 1) {
      remainingTerms.push(ce.Pi);
    } else {
      remainingTerms.push(ce.box(['Multiply', reduced, 'Pi']));
    }
  }

  // If nothing changed (same coefficient), return null to avoid infinite loop
  if (reduced === piCoeff % period && reduced === piCoeff) return null;

  // Build the new argument
  let newArg: BoxedExpression;
  if (remainingTerms.length === 0) {
    newArg = ce.Zero;
  } else if (remainingTerms.length === 1) {
    newArg = remainingTerms[0];
  } else {
    newArg = add(...remainingTerms);
  }

  // For period 2 functions (sin, cos, sec, csc):
  // - If we removed an even multiple of π (reduced from n to 0), no sign change
  // - We've now reduced to having at most π in the argument
  // The existing rules for sin(π + x) -> -sin(x) etc. will handle the final step

  // For period 1 functions (tan, cot):
  // - Any integer multiple of π is removed, no sign change needed

  return ce.box([fn, newArg]);
}

/**
 * @todo: a set to "tidy" an expression. Different from a canonical form, but
 * inline with the user's expectations.
 *
 * Example:
 *
 * - a^n * a^m -> a^(n+m)
 * - a / √b -> (a * √b) / b
 *
 */

/**
 * A set of simplification rules.
 *
 * The rules are expressed as
 *
 *    `[lhs, rhs, condition]`
 *
 * where `lhs` is rewritten as `rhs` if `condition` is true.
 *
 * `lhs` and `rhs` can be either an Expression or a LaTeX string.
 *
 * If using an Expression, the expression is *not* canonicalized before being
 * used. Therefore in some cases using Expression, while more verbose,
 * may be necessary as the expression could be simplified by the canonicalization.
 */
export const SIMPLIFY_RULES: Rule[] = [
  // The Golden Ratio, a constant that can be simplified
  {
    match: { sym: 'GoldenRatio' },
    replace: ['Divide', ['Add', 1, ['Sqrt', 5]], 2],
  },
  simplifyRelationalOperator,

  simplifySystemOfEquations,

  //
  // Cancel common polynomial factors in Divide expressions
  // e.g., (x² - 1)/(x - 1) → x + 1
  // Must run before expand to preserve polynomial structure
  //
  // IMPORTANT: cancelCommonFactors must not call .simplify() on its result
  // to avoid infinite recursion (this rule would trigger again, creating
  // an infinite loop). See polynomials.ts for implementation details.
  //
  (x): RuleStep | undefined => {
    if (x.operator !== 'Divide') return undefined;

    // Get unknowns from the expression - only handle univariate case
    const unknowns = x.unknowns;
    if (unknowns.length !== 1) return undefined;

    const variable = unknowns[0];
    const result = cancelCommonFactors(x, variable);

    // Only return if cancellation actually changed something
    if (result.isSame(x)) return undefined;

    return { value: result, because: 'cancel common polynomial factors' };
  },

  // Try to expand the expression:
  // x*(y+z) -> x*y + x*z
  // { replace: (x) => expand(x) ?? undefined, id: 'expand' },
  (x) => {
    const result = expand(x);
    return result ? { value: result, because: 'expand' } : undefined;
  },

  //
  // Add, Negate
  //
  (x): RuleStep | undefined => {
    if (x.operator !== 'Add') return undefined;
    // The Add function has a 'lazy' property, so we need to ensure operands are canonical.
    // Also evaluate purely numeric operands (no unknowns) to simplify expressions like √(1+2) → √3.
    // IMPORTANT: Don't call .simplify() on operands to avoid infinite recursion.
    return {
      value: add(
        ...x.ops!.map((op) => {
          const canonical = op.canonical;
          // Evaluate purely numeric operands (no unknowns) to simplify them
          if (canonical.unknowns.length === 0 && canonical.ops) {
            const evaluated = canonical.evaluate();
            // Only use evaluated form if it's simpler (a number literal)
            if (evaluated.isNumberLiteral) return evaluated;
          }
          return canonical;
        })
      ),
      because: 'addition',
    };
  },

  (x): RuleStep | undefined => {
    if (x.operator !== 'Negate') return undefined;
    return { value: x.op1.neg(), because: 'negation' };
  },

  //
  // Multiply
  //
  (x): RuleStep | undefined => {
    if (x.operator !== 'Multiply') return undefined;

    // The Multiply function has a 'lazy' property, so we need to ensure operands are canonical.
    // Also evaluate purely numeric operands (no unknowns) to simplify expressions.
    // IMPORTANT: Don't call .simplify() on operands to avoid infinite recursion.
    return {
      value: mul(
        ...x.ops!.map((op) => {
          const canonical = op.canonical;
          // Evaluate purely numeric operands (no unknowns) to simplify them
          if (canonical.unknowns.length === 0 && canonical.ops) {
            const evaluated = canonical.evaluate();
            // Only use evaluated form if it's simpler (a number literal)
            if (evaluated.isNumberLiteral) return evaluated;
          }
          return canonical;
        })
      ),
      because: 'multiplication',
    };
  },

  //
  // Divide, Rational
  //
  (x): RuleStep | undefined => {
    if (x.operator === 'Divide')
      return { value: x.op1.div(x.op2), because: 'division' };
    if (x.operator === 'Rational' && x.nops === 2)
      return { value: x.op1.div(x.op2), because: 'rational' };
    return undefined;
  },

  //
  // Power, Root, Sqrt
  //
  (x): RuleStep | undefined => {
    if (!x.op1.isNumberLiteral) return undefined;

    if (x.operator === 'Sqrt') {
      // sqrt(-10) -> i*sqrt(10)
      if (x.op1.isNegative)
        return {
          value: x.engine
            .box(['Multiply', ['Sqrt', x.op1.neg()], 'ImaginaryUnit'])
            .simplify(),
          because: 'sqrt',
        };
      const val = x.op1.sqrt();
      if (isExact(val.numericValue)) return { value: val, because: 'sqrt' };
      return undefined;
    }

    const op1 = x.op1;
    const op2 = x.op2;

    // If not both operands are numbers, we can't simplify
    if (!op2.isNumberLiteral) return undefined;

    // If they're both small integers, we can simplify
    if (
      op1.isInteger &&
      op2.isInteger &&
      op1.re < SMALL_INTEGER &&
      op2.re < SMALL_INTEGER
    ) {
      if (x.operator === 'Power')
        return { value: x.op1.pow(x.op2), because: 'power' };
      if (x.operator === 'Root') {
        const val = x.op1.root(x.op2);
        if (isExact(val.numericValue))
          return { value: x.op1.root(x.op2), because: 'root' };
      }
    }
    return undefined;
  },

  //
  // Abs
  //
  (x): RuleStep | undefined => {
    if (x.operator !== 'Abs') return undefined;
    const op = x.op1;
    if (op.isNonNegative) return { value: op, because: '|x| -> x' };
    if (op.isNegative) return { value: op.neg(), because: '|x| -> -x' };
    return undefined;
  },

  //
  // Sign
  //
  (x): RuleStep | undefined => {
    if (x.operator !== 'Sign') return undefined;
    const s = x.sgn;
    const ce = x.engine;
    if (s === undefined) return undefined;
    if (s === 'positive') return { value: ce.One, because: 'sign positive' };
    if (s === 'negative')
      return { value: ce.NegativeOne, because: 'sign negative' };
    if (s === 'zero') return { value: ce.Zero, because: 'sign zero' };
    if (s === 'unsigned') return { value: ce.NaN, because: 'sign unsinged' };
    return undefined;
  },

  //
  // Ln, Log
  //
  (x): RuleStep | undefined => {
    if (x.operator === 'Ln')
      return { value: x.op1.ln(x.ops![1]), because: 'ln' };
    if (x.operator === 'Log')
      return { value: x.op1.ln(x.ops![1] ?? 10), because: 'log' };
    return undefined;
  },

  //
  // Min/Max/Supremum/Infimum
  //
  (x): RuleStep | undefined => {
    if (x.operator === 'Max') {
      if (x.nops === 0)
        return { value: x.engine.NegativeInfinity, because: 'max' };
      if (x.nops === 1) return { value: x.op1, because: 'max' };
    } else if (x.operator === 'Min') {
      if (x.nops === 0)
        return { value: x.engine.PositiveInfinity, because: 'min' };
      if (x.nops === 1) return { value: x.op1, because: 'min' };
    } else if (x.operator === 'Supremum') {
      if (x.nops === 0)
        return { value: x.engine.NegativeInfinity, because: 'sup' };
      if (x.nops === 1) return { value: x.op1, because: 'sup' };
    } else if (x.operator === 'Infimum') {
      if (x.nops === 0)
        return { value: x.engine.PositiveInfinity, because: 'inf' };
      if (x.nops === 1) return { value: x.op1, because: 'inf' };
    }
    return undefined;
  },

  //
  // Derivative
  //
  (x): RuleStep | undefined => {
    if (x.operator !== 'Derivative') return undefined;
    const ce = x.engine;
    const [f, degree] = x.ops!;
    // @todo: we could *actually* compute the derivative here. Not sure if this is expected.
    // const degree = Math.floor(degree?.N().re ?? 1);
    // return derivative(fn, degree);
    if (x.nops === 2)
      return {
        value: ce._fn('Derivative', [f.simplify(), degree]),
        because: 'derivative',
      };
    if (x.nops === 1) {
      return {
        value: ce._fn('Derivative', [f.simplify()]),
        because: 'derivative',
      };
    }
  },

  //
  // Hypot
  //
  (x): RuleStep | undefined => {
    if (x.operator !== 'Hypot') return undefined;
    const ce = x.engine;
    return {
      value: ce
        .box(['Sqrt', ['Add', ['Square', x.op1], ['Square', x.op2]]])
        .simplify(),
      because: 'hypot(x,y) -> sqrt(x^2+y^2)',
    };
  },

  //
  // Congruent
  //
  (x): RuleStep | undefined => {
    if (x.operator !== 'Congruent') return undefined;
    if (x.nops < 3) return undefined;
    const ce = x.engine;
    return {
      value: ce
        ._fn('Equal', [
          ce.function('Mod', [x.ops![0], x.ops![2]]).simplify(),
          ce.function('Mod', [x.ops![1], x.ops![2]]).simplify(),
        ])
        .simplify(),
      because: 'congruent',
    };
  },

  // Sum simplification (extracted to simplify-sum.ts)
  simplifySum,

  // Product simplification (extracted to simplify-product.ts)
  simplifyProduct,

  //
  // Constructible values of trig functions
  //
  (x): RuleStep | undefined => {
    if (!isConstructible(x)) return undefined;
    const value = constructibleValues(x.operator, x.op1);
    if (!value) return undefined;
    return { value, because: 'constructible value' };
  },

  //
  // Inverse Function (i.e. sin^{-1})
  //
  (x): RuleStep | undefined => {
    if (x.operator !== 'InverseFunction') return undefined;
    const value = processInverseFunction(x.engine, x.ops!);
    if (!value) return undefined;
    return { value, because: 'inverse function' };
  },

  //
  // Arctan2
  //
  (expr): RuleStep | undefined => {
    if (expr.operator !== 'Arctan2') return undefined;
    // See https://en.wikipedia.org/wiki/Argument_(complex_analysis)#Realizations_of_the_function_in_computer_languages
    const [y, x] = expr.ops!;
    const ce = expr.engine;
    if (y.isFinite === false && x.isFinite === false)
      return { value: ce.NaN, because: 'arctan2' };
    if (y.is(0) && x.is(0)) return { value: ce.Zero, because: 'arctan2' };
    if (x.isFinite === false)
      return { value: x.isPositive ? ce.Zero : ce.Pi, because: 'arctan2' };
    if (y.isFinite === false)
      return {
        value: y.isPositive ? ce.Pi.div(2) : ce.Pi.div(-2),
        because: 'arctan2',
      };
    if (y.is(0))
      return { value: x.isPositive ? ce.Zero : ce.Pi, because: 'arctan2' };
    return {
      value: ce.function('Arctan', [y.div(x)]).simplify(),
      because: 'arctan2',
    };
  },

  // Note: Inverse hyperbolic function conversions to logarithms are handled
  // later in the file to avoid duplicate definitions

  //
  // Logic
  //
  simplifyLogicFunction,

  //
  // Trig and Infinity
  //
  {
    match: ['Sin', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Cos', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Tan', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Cot', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Sec', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Csc', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },

  //
  // Hyperbolic Trig and Infinity
  //
  {
    match: ['Sinh', '_x'],
    replace: toInfinity,
    condition: (id) => id._x.isInfinity === true && id._x.isPositive === true,
  },
  {
    match: ['Sinh', '_x'],
    replace: toNegativeInfinity,
    condition: (id) => id._x.isInfinity === true && id._x.isNegative === true,
  },
  {
    match: ['Cosh', '_x'],
    replace: toInfinity,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Tanh', '_x'],
    replace: toOne,
    condition: (id) => id._x.isInfinity === true && id._x.isPositive === true,
  },
  {
    match: ['Tanh', '_x'],
    replace: toNegativeOne,
    condition: (id) => id._x.isInfinity === true && id._x.isNegative === true,
  },
  {
    match: ['Coth', '_x'],
    replace: toOne,
    condition: (id) => id._x.isInfinity === true && id._x.isPositive === true,
  },
  {
    match: ['Coth', '_x'],
    replace: toNegativeOne,
    condition: (id) => id._x.isInfinity === true && id._x.isNegative === true,
  },
  {
    match: ['Sech', '_x'],
    replace: toZero,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Csch', '_x'],
    replace: toZero,
    condition: (id) => id._x.isInfinity === true,
  },

  //
  // Root Simplification Rules
  //
  // sqrt(x^2) -> |x| (general case)
  {
    match: ['Sqrt', ['Power', '_x', 2]],
    replace: ['Abs', '_x'],
  },
  // sqrt(x^2) -> x when x is non-negative
  {
    match: ['Sqrt', ['Power', '_x', 2]],
    replace: '_x',
    condition: (ids) => ids._x.isNonNegative === true,
  },
  // sqrt(x^{2n}) -> |x|^n for positive integer n
  {
    match: ['Sqrt', ['Power', '_x', '_n']],
    replace: ['Power', ['Abs', '_x'], ['Divide', '_n', 2]],
    condition: (ids) => ids._n.isEven === true && ids._n.isPositive === true,
  },
  // Root(x^n, n) -> |x| when n is even (using function replacement)
  (x): RuleStep | undefined => {
    if (x.operator !== 'Root') return undefined;
    const arg = x.op1;
    const rootIndex = x.op2;
    if (arg?.operator !== 'Power') return undefined;
    const base = arg.op1;
    const exponent = arg.op2;
    // Check if exponent equals root index
    if (!exponent.is(rootIndex)) return undefined;
    // Even root: return |x|
    if (rootIndex.isEven === true) {
      return {
        value: x.engine._fn('Abs', [base]),
        because: 'root(x^n, n) where n even',
      };
    }
    // Odd root or x >= 0: return x
    if (rootIndex.isOdd === true || base.isNonNegative === true) {
      return { value: base, because: 'root(x^n, n) where n odd' };
    }
    return undefined;
  },

  //
  // Power Combination Rules
  //
  // Combine all terms with the same base in a Multiply (handles 3+ operands)
  (x): RuleStep | undefined => {
    if (x.operator !== 'Multiply' || !x.ops || x.ops.length < 3)
      return undefined;

    const ce = x.engine;

    // Group terms by base
    const baseGroups = new Map<string, {
      base: BoxedExpression;
      terms: Array<{ term: BoxedExpression; exp: BoxedExpression }>;
    }>();
    const otherTerms: BoxedExpression[] = [];

    for (const term of x.ops) {
      let base: BoxedExpression;
      let exp: BoxedExpression;

      if (term.operator === 'Power') {
        base = term.op1;
        exp = term.op2;
      } else {
        base = term;
        exp = ce.One;
      }

      // Only combine if base is positive, negative, or numeric
      const canCombine =
        base.isPositive === true ||
        base.isNegative === true ||
        base.isNumberLiteral === true;

      if (!canCombine) {
        otherTerms.push(term);
        continue;
      }

      const baseKey = JSON.stringify(base.json);
      let group = baseGroups.get(baseKey);
      if (!group) {
        group = { base, terms: [] };
        baseGroups.set(baseKey, group);
      }
      group.terms.push({ term, exp });
    }

    // Check if any base has multiple terms
    let hasCombinations = false;
    for (const group of baseGroups.values()) {
      if (group.terms.length > 1) {
        hasCombinations = true;
        break;
      }
    }

    if (!hasCombinations) return undefined;

    // Build result
    const resultTerms: BoxedExpression[] = [...otherTerms];

    for (const group of baseGroups.values()) {
      if (group.terms.length === 1) {
        // Single term, keep as-is
        resultTerms.push(group.terms[0].term);
      } else {
        // Multiple terms with same base - combine exponents
        const exponents = group.terms.map(t => t.exp);
        const summedExp = exponents.reduce((a, b) => a.add(b));

        if (summedExp.is(0)) {
          resultTerms.push(ce.One);
        } else if (summedExp.is(1)) {
          resultTerms.push(group.base);
        } else {
          resultTerms.push(ce._fn('Power', [group.base, summedExp]));
        }
      }
    }

    if (resultTerms.length === 0) return { value: ce.One, because: 'combined powers' };
    if (resultTerms.length === 1) return { value: resultTerms[0], because: 'combined powers' };
    return { value: ce._fn('Multiply', resultTerms), because: 'combined powers with same base' };
  },

  // x^n * x^m -> x^{n+m} (combine powers with same base)
  {
    match: ['Multiply', ['Power', '_x', '_n'], ['Power', '_x', '_m']],
    replace: ['Power', '_x', ['Add', '_n', '_m']],
    condition: (ids) =>
      // Base must be non-zero (positive or negative) or sum of exponents must be non-negative
      ids._x.isPositive === true ||
      ids._x.isNegative === true ||
      ids._n.add(ids._m).isNonNegative === true,
  },
  // x * x^n -> x^{n+1} (special case when first power is implicit 1)
  {
    match: ['Multiply', '_x', ['Power', '_x', '_n']],
    replace: ['Power', '_x', ['Add', '_n', 1]],
    condition: (ids) =>
      ids._x.isPositive === true ||
      ids._x.isNegative === true ||
      ids._x.isNumberLiteral === true,
  },
  // x^n * x -> x^{n+1} (special case when second power is implicit 1)
  {
    match: ['Multiply', ['Power', '_x', '_n'], '_x'],
    replace: ['Power', '_x', ['Add', '_n', 1]],
    condition: (ids) =>
      ids._x.isPositive === true ||
      ids._x.isNegative === true ||
      ids._x.isNumberLiteral === true,
  },

  //
  // Logarithm Power Rules
  //
  // ln(x^n) -> n*ln(x) when x is non-negative or n is odd
  {
    match: ['Ln', ['Power', '_x', '_n']],
    replace: (expr, ids) => ids._n.mul(expr.engine._fn('Ln', [ids._x])),
    condition: (ids) =>
      ids._x.isNonNegative === true ||
      ids._n.isOdd === true ||
      ids._n.isRational === false,
  },
  // ln(x^n) -> n*ln(|x|) when n is even
  {
    match: ['Ln', ['Power', '_x', '_n']],
    replace: (expr, ids) =>
      ids._n.mul(
        expr.engine._fn('Ln', [expr.engine._fn('Abs', [ids._x])])
      ),
    condition: (ids) => ids._n.isEven === true,
  },
  // log_c(x^n) -> n*log_c(x) when x is non-negative or n is odd
  {
    match: ['Log', ['Power', '_x', '_n'], '_c'],
    replace: (expr, ids) =>
      ids._n.mul(expr.engine._fn('Log', [ids._x, ids._c])),
    condition: (ids) =>
      ids._x.isNonNegative === true ||
      ids._n.isOdd === true ||
      ids._n.isRational === false,
  },
  // log_c(x^n) -> n*log_c(|x|) when n is even
  {
    match: ['Log', ['Power', '_x', '_n'], '_c'],
    replace: (expr, ids) =>
      ids._n.mul(
        expr.engine._fn('Log', [
          expr.engine._fn('Abs', [ids._x]),
          ids._c,
        ])
      ),
    condition: (ids) => ids._n.isEven === true,
  },
  // log_c(x^(n/k)) -> (n/k)*log_c(x) when x is non-negative or n is odd
  {
    match: ['Log', ['Power', '_x', ['Divide', '_n', '_k']], '_c'],
    replace: (expr, ids) =>
      ids._n.div(ids._k).mul(expr.engine._fn('Log', [ids._x, ids._c])),
    condition: (ids) => ids._x.isNonNegative === true || ids._n.isOdd === true,
  },

  /*
  //NEW (doesn't work b/c keeps - sign)
  {
    match: '(-x)^n',
    replace: 'x^n',
    condition: ({ _n }) => _n.isEven === true,
  },
  {
    match: '(-x)^{n/m}',
    replace: 'x^{n/m}',
    condition: ({ _n, _m }) => _n.isEven === true && _m.isOdd === true,
  },

  //NEW
  {
    match: '(-x)^n',
    replace: '-x^n',
    condition: ({ _n }) => _n.isOdd === true,
  },
  {
    match: '(-x)^{n/m}',
    replace: '-x^{n/m}',
    condition: (ids) => ids._n.isOdd === true && ids._m.isOdd === true,
  },

  //Situational and Not Being Run
  {
    match: 'a/b+c/d',
    replace: '(a*d+b*c)/(b*d)',
    condition: (ids) => ids._a.isNotZero === true,
  },

  //Not Being Run (gives infinity instead of NaN)
  {
    match: ['Divide', '_x', 0],
    replace: toNaN,
  },
  {
    match: ['Power', 0, '_x'],
    replace: toNaN,
    condition: (ids) => ids._x.isNonPositive === true,
  },

  //Currently gives 0
  {
    match: ['Multiply', 0, '_x'],
    replace: toNaN,
    condition: (_x) => _x._x.isInfinity === true,
  },

  //Ln
  // ln(x) + ln(y) -> ln(x*y) (assumes negative arguments are allowed)
  {
    match: ['Add', ['Ln', '_x'], ['Ln', '_y']],
    replace: (expr, ids) => expr.engine._fn('Ln', [ids._x.mul(ids._y)]),
  },
  // ln(x) - ln(y) -> ln(x/y)
  {
    match: ['Subtract', ['Ln', '_x'], ['Ln', '_y']],
    replace: (expr, ids) => expr.engine._fn('Ln', [ids._x.div(ids._y)]),
  },
  // e^(ln(x)+y) -> x*e^y
  {
    match: ['Power', 'ExponentialE', ['Add', ['Ln', '_x'], '_y']],
    replace: (expr, ids) =>
      ids._x.mul(expr.engine._fn('Exp', [ids._y])),
  },
  // e^(ln(x)-y) -> x/e^y
  {
    match: ['Power', 'ExponentialE', ['Subtract', ['Ln', '_x'], '_y']],
    replace: (expr, ids) =>
      ids._x.div(expr.engine._fn('Exp', [ids._y])),
  },
  // e^(ln(x)*y) -> x^y
  {
    match: ['Power', 'ExponentialE', ['Multiply', ['Ln', '_x'], '_y']],
    replace: (expr, ids) => ids._x.pow(ids._y),
  },
  // e^(ln(x)/y) -> x^(1/y)
  {
    match: ['Power', 'ExponentialE', ['Divide', ['Ln', '_x'], '_y']],
    replace: (expr, ids) => ids._x.pow(expr.engine.One.div(ids._y)),
  },
  // e^ln(x) -> x
  { match: ['Power', 'ExponentialE', ['Ln', '_x']], replace: '_x' },
  // ln(e^x*y) -> x+ln(y)
  {
    match: ['Ln', ['Multiply', ['Power', 'ExponentialE', '_x'], '_y']],
    replace: (expr, ids) =>
      ids._x.add(expr.engine._fn('Ln', [ids._y])),
  },
  // ln(e^x/y) -> x-ln(y)
  {
    match: ['Ln', ['Divide', ['Power', 'ExponentialE', '_x'], '_y']],
    replace: (expr, ids) =>
      ids._x.sub(expr.engine._fn('Ln', [ids._y])),
  },
  // ln(y/e^x) -> ln(y)-x
  {
    match: ['Ln', ['Divide', '_y', ['Power', 'ExponentialE', '_x']]],
    replace: (expr, ids) =>
      expr.engine._fn('Ln', [ids._y]).sub(ids._x),
  },
  {
    match: ['Ln', 0],
    replace: toNaN,
  },

  //Log base c
  {
    match: ['Log', '_x', '_c'],
    replace: toNaN,
    condition: (id) => id._c.isZero === true || id._c.isOne === true,
  },
  // log_c(x) + log_c(y) -> log_c(x*y) (assumes negative arguments are allowed)
  {
    match: ['Add', ['Log', '_x', '_c'], ['Log', '_y', '_c']],
    replace: (expr, ids) =>
      expr.engine._fn('Log', [ids._x.mul(ids._y), ids._c]),
  },
  // log_c(x) - log_c(y) -> log_c(x/y)
  {
    match: ['Subtract', ['Log', '_x', '_c'], ['Log', '_y', '_c']],
    replace: (expr, ids) =>
      expr.engine._fn('Log', [ids._x.div(ids._y), ids._c]),
  },
  // log_c(c^x) -> x
  { match: ['Log', ['Power', '_c', '_x'], '_c'], replace: '_x' },
  { match: ['Log', '_c', '_c'], replace: toOne },
  { match: ['Log', 0, '_c'], replace: toNaN },
  // c^log_c(x) -> x
  { match: ['Power', '_c', ['Log', '_x', '_c']], replace: '_x' },
  // c^(log_c(x)*y) -> x^y
  {
    match: ['Power', '_c', ['Multiply', ['Log', '_x', '_c'], '_y']],
    replace: (expr, ids) => ids._x.pow(ids._y),
  },
  // c^(log_c(x)/y) -> x^(1/y)
  {
    match: ['Power', '_c', ['Divide', ['Log', '_x', '_c'], '_y']],
    replace: (expr, ids) => ids._x.pow(expr.engine.One.div(ids._y)),
  },
  // log_c(c^x*y) -> x + log_c(y)
  {
    match: ['Log', ['Multiply', ['Power', '_c', '_x'], '_y'], '_c'],
    replace: (expr, ids) =>
      ids._x.add(expr.engine._fn('Log', [ids._y, ids._c])),
  },
  // log_c(c^x/y) -> x - log_c(y)
  {
    match: ['Log', ['Divide', ['Power', '_c', '_x'], '_y'], '_c'],
    replace: (expr, ids) =>
      ids._x.sub(expr.engine._fn('Log', [ids._y, ids._c])),
  },
  // log_c(y/c^x) -> log_c(y) - x
  {
    match: ['Log', ['Divide', '_y', ['Power', '_c', '_x']], '_c'],
    replace: (expr, ids) =>
      expr.engine._fn('Log', [ids._y, ids._c]).sub(ids._x),
  },
  // c^(log_c(x)+y) -> x*c^y
  {
    match: ['Power', '_c', ['Add', ['Log', '_x', '_c'], '_y']],
    replace: (expr, ids) => ids._x.mul(ids._c.pow(ids._y)),
  },
  // c^(log_c(x)-y) -> x/c^y
  {
    match: ['Power', '_c', ['Subtract', ['Log', '_x', '_c'], '_y']],
    replace: (expr, ids) => ids._x.div(ids._c.pow(ids._y)),
  },

  //Change of Base
  // log_{1/c}(a) -> -log_c(a)
  {
    match: ['Log', '_a', ['Divide', 1, '_c']],
    replace: (expr, ids) =>
      expr.engine._fn('Log', [ids._a, ids._c]).neg(),
  },
  // log_c(a) * ln(a) -> ln(c) - note: this seems mathematically incorrect, skipping
  // log_c(a) / log_c(b) -> ln(a) / ln(b)
  {
    match: ['Divide', ['Log', '_a', '_c'], ['Log', '_b', '_c']],
    replace: (expr, ids) =>
      expr.engine
        ._fn('Ln', [ids._a])
        .div(expr.engine._fn('Ln', [ids._b])),
  },
  // log_c(a) / ln(a) -> 1/ln(c)
  {
    match: ['Divide', ['Log', '_a', '_c'], ['Ln', '_a']],
    replace: (expr, ids) =>
      expr.engine.One.div(expr.engine._fn('Ln', [ids._c])),
  },
  // ln(a) / log_c(a) -> ln(c)
  { match: ['Divide', ['Ln', '_a'], ['Log', '_a', '_c']], replace: ['Ln', '_c'] },

  //Absolute Value
  // |-x| -> |x|
  { match: ['Abs', ['Negate', '_x']], replace: ['Abs', '_x'] },
  {
    match: ['Abs', '_x'],
    replace: '_x',
    condition: (ids) => ids._x.isNonNegative === true,
  },
  {
    match: ['Abs', '_x'],
    replace: ['Negate', '_x'],
    condition: (ids) => ids._x.isNonPositive === true,
  },
  {
    match: ['Abs', ['Multiply', '_x', '_y']],
    replace: (expr, ids) =>
      ids._x.mul(expr.engine._fn('Abs', [ids._y])),
    condition: (ids) => ids._x.isNonNegative === true,
  },
  {
    match: ['Abs', ['Multiply', '_x', '_y']],
    replace: (expr, ids) =>
      ids._x.neg().mul(expr.engine._fn('Abs', [ids._y])),
    condition: (ids) => ids._x.isNonPositive === true,
  },
  // |xy| -> |x||y|
  {
    match: ['Abs', ['Multiply', '_x', '_y']],
    replace: (expr, ids) =>
      expr.engine
        ._fn('Abs', [ids._x])
        .mul(expr.engine._fn('Abs', [ids._y])),
  },
  // |x/y| -> |x|/|y|
  {
    match: ['Abs', ['Divide', '_x', '_y']],
    replace: (expr, ids) =>
      expr.engine
        ._fn('Abs', [ids._x])
        .div(expr.engine._fn('Abs', [ids._y])),
  },
  // |x|^n -> x^n when n is even
  {
    match: ['Power', ['Abs', '_x'], '_n'],
    replace: (expr, ids) => ids._x.pow(ids._n),
    condition: (id) => id._n.isEven === true,
  },
  // |x|^(n/m) -> x^(n/m) when n is even and m is odd
  {
    match: ['Power', ['Abs', '_x'], ['Divide', '_n', '_m']],
    replace: (expr, ids) => ids._x.pow(ids._n.div(ids._m)),
    condition: (id) => id._n.isEven === true && id._m.isOdd === true,
  },
  // |x^n| -> |x|^n when n is odd or irrational
  {
    match: ['Abs', ['Power', '_x', '_n']],
    replace: (expr, ids) =>
      expr.engine._fn('Abs', [ids._x]).pow(ids._n),
    condition: (id) => id._n.isOdd === true || id._n.isRational === false,
  },
  // |x^(n/m)| -> |x|^(n/m) when n is odd or m is integer
  {
    match: ['Abs', ['Power', '_x', ['Divide', '_n', '_m']]],
    replace: (expr, ids) =>
      expr.engine._fn('Abs', [ids._x]).pow(ids._n.div(ids._m)),
    condition: (id) => id._n.isOdd === true || id._m.isInteger === true,
  },

  // |x/y| -> x/|y| when x is non-negative
  {
    match: ['Abs', ['Divide', '_x', '_y']],
    replace: (expr, ids) =>
      ids._x.div(expr.engine._fn('Abs', [ids._y])),
    condition: (ids) => ids._x.isNonNegative === true,
  },
  // |x/y| -> -x/|y| when x is non-positive
  {
    match: ['Abs', ['Divide', '_x', '_y']],
    replace: (expr, ids) =>
      ids._x.neg().div(expr.engine._fn('Abs', [ids._y])),
    condition: (ids) => ids._x.isNonPositive === true,
  },
  // |x/y| -> |x|/y when y is non-negative
  {
    match: ['Abs', ['Divide', '_x', '_y']],
    replace: (expr, ids) =>
      expr.engine._fn('Abs', [ids._x]).div(ids._y),
    condition: (ids) => ids._y.isNonNegative === true,
  },
  // |x/y| -> -|x|/y when y is non-positive
  {
    match: ['Abs', ['Divide', '_x', '_y']],
    replace: (expr, ids) =>
      expr.engine._fn('Abs', [ids._x]).neg().div(ids._y),
    condition: (ids) => ids._y.isNonPositive === true,
  },

  // Even functions: f(|x|) -> f(x)
  { match: ['Cos', ['Abs', '_x']], replace: ['Cos', '_x'] },
  { match: ['Sec', ['Abs', '_x']], replace: ['Sec', '_x'] },
  { match: ['Cosh', ['Abs', '_x']], replace: ['Cosh', '_x'] },
  { match: ['Sech', ['Abs', '_x']], replace: ['Sech', '_x'] },

  // Odd Trig Functions: |f(x)| -> f(|x|)
  { match: ['Abs', ['Sin', '_x']], replace: ['Sin', ['Abs', '_x']] },
  { match: ['Abs', ['Tan', '_x']], replace: ['Tan', ['Abs', '_x']] },
  { match: ['Abs', ['Cot', '_x']], replace: ['Cot', ['Abs', '_x']] },
  {
    match: ['Abs', ['Csc', '_x']],
    replace: (expr, ids) =>
      expr.engine._fn('Csc', [expr.engine._fn('Abs', [ids._x])]),
  },
  {
    match: ['Abs', ['Arcsin', '_x']],
    replace: (expr, ids) =>
      expr.engine._fn('Arcsin', [expr.engine._fn('Abs', [ids._x])]),
  },
  {
    match: ['Abs', ['Arctan', '_x']],
    replace: (expr, ids) =>
      expr.engine._fn('Arctan', [expr.engine._fn('Abs', [ids._x])]),
  },
  {
    match: ['Abs', ['Arccot', '_x']],
    replace: (expr, ids) =>
      expr.engine._fn('Arccot', [expr.engine._fn('Abs', [ids._x])]),
  },
  {
    match: ['Abs', ['Arccsc', '_x']],
    replace: (expr, ids) =>
      expr.engine._fn('Arccsc', [expr.engine._fn('Abs', [ids._x])]),
  },
  //Odd Hyperbolic Trig Functions
  {
    match: ['Abs', ['Sinh', '_x']],
    replace: (expr, ids) =>
      expr.engine._fn('Sinh', [expr.engine._fn('Abs', [ids._x])]),
  },
  {
    match: ['Abs', ['Tanh', '_x']],
    replace: (expr, ids) =>
      expr.engine._fn('Tanh', [expr.engine._fn('Abs', [ids._x])]),
  },
  {
    match: ['Abs', ['Coth', '_x']],
    replace: (expr, ids) =>
      expr.engine._fn('Coth', [expr.engine._fn('Abs', [ids._x])]),
  },
  {
    match: ['Abs', ['Csch', '_x']],
    replace: (expr, ids) =>
      expr.engine._fn('Csch', [expr.engine._fn('Abs', [ids._x])]),
  },
  {
    match: ['Abs', ['Arsinh', '_x']],
    replace: (expr, ids) =>
      expr.engine._fn('Arsinh', [expr.engine._fn('Abs', [ids._x])]),
  },
  {
    match: ['Abs', ['Artanh', '_x']],
    replace: (expr, ids) =>
      expr.engine._fn('Artanh', [expr.engine._fn('Abs', [ids._x])]),
  },
  {
    match: ['Abs', ['Arcoth', '_x']],
    replace: (expr, ids) =>
      expr.engine._fn('Arcoth', [expr.engine._fn('Abs', [ids._x])]),
  },
  {
    match: ['Abs', ['Arcsch', '_x']],
    replace: (expr, ids) =>
      expr.engine._fn('Arcsch', [expr.engine._fn('Abs', [ids._x])]),
  },

  //Negative Exponents in Denominator
  // a / b^(-n) -> a * b^n
  {
    match: ['Divide', '_a', ['Power', '_b', ['Negate', '_n']]],
    replace: (expr, ids) => ids._a.mul(ids._b.pow(ids._n)),
    condition: ({ _b }) => _b.isNotZero === true,
  },
  // a / (d * b^(-n)) -> (a/d) * b^n
  {
    match: ['Divide', '_a', ['Multiply', '_d', ['Power', '_b', ['Negate', '_n']]]],
    replace: (expr, ids) => ids._a.div(ids._d).mul(ids._b.pow(ids._n)),
    condition: (ids) => ids._b.isNotZero === true,
  },

  //Indeterminate Forms Involving Infinity
  { match: ['Multiply', 0, '_x'], replace: toZero, condition: (_x) => _x._x.isFinite === true },
  { match: ['Power', 1, '_x'], replace: toOne, condition: (_x) => _x._x.isFinite === true },
  {
    match: ['Power', '_a', 0],
    replace: toNaN,
    condition: (id) => id._a.isInfinity === true,
  },

  //Infinity and Multiplication
  {
    match: ['Multiply', 'PositiveInfinity', '_x'],
    replace: toInfinity,
    condition: (_x) => _x._x.isPositive === true,
  },
  {
    match: ['Multiply', '_x', 'NegativeInfinity'],
    replace: toNegativeInfinity,
    condition: (_x) => _x._x.isPositive === true,
  },
  {
    match: ['Multiply', 'PositiveInfinity', '_x'],
    replace: toNegativeInfinity,
    condition: (_x) => _x._x.isNegative === true,
  },
  {
    match: ['Multiply', '_x', 'NegativeInfinity'],
    replace: toInfinity,
    condition: (_x) => _x._x.isNegative === true,
  },

  //Infinity and Division
  {
    match: ['Divide', 'PositiveInfinity', '_x'],
    replace: toInfinity,
    condition: (_x) => _x._x.isPositive === true && _x._x.isFinite === true,
  },
  {
    match: ['Divide', 'NegativeInfinity', '_x'],
    replace: toNegativeInfinity,
    condition: (_x) => _x._x.isPositive === true && _x._x.isFinite === true,
  },
  {
    match: ['Divide', 'PositiveInfinity', '_x'],
    replace: toNegativeInfinity,
    condition: (_x) => _x._x.isNegative === true && _x._x.isFinite === true,
  },
  {
    match: ['Divide', 'NegativeInfinity', '_x'],
    replace: toInfinity,
    condition: (_x) => _x._x.isNegative === true && _x._x.isFinite === true,
  },
  {
    match: ['Divide', '_x', '_y'],
    replace: toNaN,
    condition: (_x) => _x._x.isInfinity === true && _x._y.isInfinity === true,
  },

  //Infinity and Powers (doesn't work for a=\\pi)
  {
    match: ['Power', '_a', 'PositiveInfinity'],
    replace: toInfinity,
    condition: (id) => id._a.isGreater(1) === true,
  },
  {
    match: ['Power', '_a', 'PositiveInfinity'],
    replace: toZero,
    condition: (id) => id._a.isPositive === true && id._a.isLess(1) === true,
  },
  {
    match: ['Power', 'PositiveInfinity', '_a'],
    replace: toZero,
    condition: (id) => id._a.isNegative === true,
  },
  {
    match: ['Power', 'NegativeInfinity', '_a'],
    replace: toZero,
    condition: (id) => id._a.isNegative === true,
  },
  {
    match: ['Power', '_a', 'NegativeInfinity'],
    replace: toZero,
    condition: (id) => id._a.isGreater(1) === true,
  },
  {
    match: ['Power', '_a', 'NegativeInfinity'],
    replace: toInfinity,
    condition: (id) => id._a.isPositive === true && id._a.isLess(1) === true,
  },
  //This one works for \\pi
  // {match:'\\infty^a',replace:'\\infty',condition:id=>id._a.isPositive===true},

  //Logs and Infinity
  {
    match: ['Ln', 'PositiveInfinity'],
    replace: toInfinity,
  },
  {
    match: ['Log', 'PositiveInfinity', '_c'],
    replace: toInfinity,
    condition: (id) => id._c.isGreater(1) === true,
  },
  {
    match: ['Log', 'PositiveInfinity', '_c'],
    replace: toNegativeInfinity,
    condition: (id) => id._c.isLess(1) === true && id._c.isPositive === true,
  },
  {
    match: ['Log', '_c', 'PositiveInfinity'],
    replace: toZero,
    condition: (id) =>
      id._c.isPositive === true &&
      id._c.isOne === false &&
      id._c.isFinite === true,
  },

  //Trig and Infinity (duplicate section - these are handled above)
  {
    match: ['Sin', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Cos', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Tan', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Cot', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Sec', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Csc', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },

  //Inverse Trig and Infinity
  { match: ['Arcsin', 'PositiveInfinity'], replace: toNaN },
  { match: ['Arccos', 'PositiveInfinity'], replace: toNaN },
  { match: ['Arcsin', 'NegativeInfinity'], replace: toNaN },
  { match: ['Arccos', 'NegativeInfinity'], replace: toNaN },
  { match: ['Arctan', 'PositiveInfinity'], replace: ['Divide', 'Pi', 2] },
  { match: ['Arctan', 'NegativeInfinity'], replace: ['Negate', ['Divide', 'Pi', 2]] },
  { match: ['Arccot', 'PositiveInfinity'], replace: toZero },
  { match: ['Arccot', 'NegativeInfinity'], replace: { sym: 'Pi' } },
  { match: ['Arcsec', 'PositiveInfinity'], replace: ['Divide', 'Pi', 2] },
  { match: ['Arcsec', 'NegativeInfinity'], replace: ['Divide', 'Pi', 2] },
  { match: ['Arccsc', 'PositiveInfinity'], replace: toZero },
  { match: ['Arccsc', 'NegativeInfinity'], replace: toZero },

  //Hyperbolic Trig and Infinity
  { match: ['Sinh', 'PositiveInfinity'], replace: toInfinity },
  { match: ['Sinh', 'NegativeInfinity'], replace: toNegativeInfinity },
  { match: ['Cosh', 'PositiveInfinity'], replace: toInfinity },
  { match: ['Cosh', 'NegativeInfinity'], replace: toInfinity },
  { match: ['Tanh', 'PositiveInfinity'], replace: toOne },
  { match: ['Tanh', 'NegativeInfinity'], replace: toNegativeOne },
  { match: ['Coth', 'PositiveInfinity'], replace: toOne },
  { match: ['Coth', 'NegativeInfinity'], replace: toNegativeOne },
  { match: ['Sech', 'PositiveInfinity'], replace: toZero },
  { match: ['Sech', 'NegativeInfinity'], replace: toZero },
  { match: ['Csch', 'PositiveInfinity'], replace: toZero },
  { match: ['Csch', 'NegativeInfinity'], replace: toZero },

  //Inverse Hyperbolic Trig and Infinity
  { match: ['Arsinh', 'PositiveInfinity'], replace: toInfinity },
  { match: ['Arsinh', 'NegativeInfinity'], replace: toNegativeInfinity },
  { match: ['Arcosh', 'PositiveInfinity'], replace: toInfinity },
  { match: ['Arcosh', 'NegativeInfinity'], replace: toNaN },

  {
    match: ['Artanh', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Arcoth', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Arsech', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: ['Arcsch', '_x'],
    replace: toNaN,
    condition: (id) => id._x.isInfinity === true,
  },

  //----------- DOMAIN ISSUES -----------

  //Division
  {
    match: ['Divide', '_a', '_a'],
    replace: toOne,
    condition: (ids) => ids._a.isNotZero === true,
  },
  {
    match: ['Divide', 1, ['Divide', 1, '_a']],
    replace: (expr, ids) => ids._a,
    condition: (ids) => ids._a.isNotZero === true,
  },
  {
    match: ['Divide', '_a', ['Divide', 1, '_b']],
    replace: (expr, ids) => ids._a.mul(ids._b),
    condition: (ids) => ids._b.isNotZero === true,
  },
  {
    match: ['Divide', '_a', ['Divide', '_b', '_c']],
    replace: (expr, ids) => ids._a.mul(ids._c).div(ids._b),
    condition: (ids) => ids._c.isNotZero === true,
  },
  {
    match: ['Divide', 0, '_a'],
    replace: toZero,
    condition: ({ _a }) => _a.isNotZero === true,
  },

  //Powers
  {
    match: ['Power', '_x', 0],
    replace: toOne,
    condition: (ids) => ids._x.isNotZero === true && ids._x.isFinite === true,
  },
  {
    match: 'x/x^n',
    replace: '1/x^{n-1}',
    condition: (ids) => ids._x.isNotZero || ids._n.isGreater(1) === true,
  },
  {
    match: 'x^n/x',
    replace: '1/x^{1-n}',
    condition: (ids) => ids._x.isNotZero || ids._n.isLess(1) === true,
  },
  {
    match: 'x^n*x',
    replace: 'x^{n+1}',
    condition: (ids) =>
      ids._x.isNotZero === true ||
      ids._n.isPositive === true ||
      ids._x.isLess(-1) === true,
  },
  {
    match: 'x^n*x^m',
    replace: 'x^{n+m}',
    condition: (ids) =>
      (ids._x.isNotZero === true ||
        ids._n.add(ids._m).isNegative === true ||
        ids._n.mul(ids._m).isPositive === true) &&
      (ids._n.isInteger === true ||
        ids._m.isInteger === true ||
        ids._n.add(ids._m).isRational === false ||
        ids._x.isNonNegative === true),
  }, //also check if at least one power is not an even root or sum is an even root
  {
    match: 'x^n/x^m',
    replace: 'x^{n+m}',
    condition: (ids) =>
      (ids._x.isNotZero === true || ids._n.add(ids._m).isNegative === true) &&
      (ids._n.isInteger === true ||
        ids._m.isInteger === true ||
        ids._n.sub(ids._m).isRational === false ||
        ids._x.isNonNegative === true),
  }, //also check if at least one power is not an even root or difference is an even root

  {
    match: ['Divide', '_a', ['Power', ['Divide', '_b', '_c'], '_d']],
    replace: (expr, ids) =>
      ids._a.mul(ids._c.div(ids._b).pow(ids._d)),
    condition: (ids) => ids._c.isNotZero === true,
  },
  {
    match: ['Power', ['Divide', '_b', '_c'], ['Negate', '_d']],
    replace: (expr, ids) => ids._c.div(ids._b).pow(ids._d),
    condition: (ids) => ids._c.isNotZero === true,
  },
  {
    match: ['Power', ['Divide', '_b', '_c'], -1],
    replace: (expr, ids) => ids._c.div(ids._b),
    condition: (ids) => ids._c.isNotZero === true,
  },
  {
    match: '(a^n)^m',
    replace: 'a^{m*n}',
    condition: (ids) =>
      ((ids._n.isInteger === true && ids._m.isInteger === true) ||
        ids._a.isNonNegative ||
        ids._n.mul(ids._m).isRational === false) &&
      (ids._n.isPositive === true || ids._m.isPositive === true),
  }, //also check if n*m not rational with even denominator
  // @fixme: this rule may not be correct: (a^n)^m -> a^{m*n} for every n,m

  //Logs and Powers
  {
    match: '\\ln(x^n)',
    replace: 'n*\\ln(x)',
    condition: (ids) =>
      ids._x.isNonNegative ||
      ids._n.isOdd === true ||
      ids._n.isRational === false,
  },
  {
    match: '\\ln(x^{n/k})',
    replace: 'n*\\ln(x)/k',
    condition: (ids) => ids._x.isNonNegative || ids._n.isOdd === true,
  },
  {
    match: '\\ln(x^{n/k})',
    replace: 'n*\\ln(|x|)/k',
    condition: (ids) => ids._n.isEven === true && ids._k.isOdd === true,
  },
  {
    match: '\\ln(x^n)',
    replace: 'n*\\ln(|x|)',
    condition: (ids) => ids._n.isEven === true,
  },

  {
    match: '\\log_c(x^n)',
    replace: 'n*\\log_c(x)',
    condition: (ids) =>
      ids._x.isNonNegative ||
      ids._n.isOdd === true ||
      ids._n.isRational === false,
  },
  {
    match: '\\log_c(x^{n/k})',
    replace: 'n*\\log_c(x)/k',
    condition: (ids) => ids._x.isNonNegative || ids._n.isOdd === true,
  },
  {
    match: '\\log_c(x^{n/k})',
    replace: 'n*\\log_c(|x|)/k',
    condition: (ids) => ids._n.isEven === true && ids._k.isOdd === true,
  },
  {
    match: '\\log_c(x^n)',
    replace: 'n*\\log_c(|x|)',
    condition: (ids) => ids._n.isEven === true,
  },
  */

  // -------- TRIGONOMETRIC --------
  // Odd/even function properties with negation
  { match: ['Sin', ['Negate', '_x']], replace: ['Negate', ['Sin', '_x']] },
  { match: ['Cos', ['Negate', '_x']], replace: ['Cos', '_x'] },
  { match: ['Tan', ['Negate', '_x']], replace: ['Negate', ['Tan', '_x']] },
  { match: ['Cot', ['Negate', '_x']], replace: ['Negate', ['Cot', '_x']] },
  { match: ['Sec', ['Negate', '_x']], replace: ['Sec', '_x'] },
  { match: ['Csc', ['Negate', '_x']], replace: ['Negate', ['Csc', '_x']] },
  // π - x transformations
  { match: ['Sin', ['Subtract', 'Pi', '_x']], replace: ['Sin', '_x'] },
  { match: ['Cos', ['Subtract', 'Pi', '_x']], replace: ['Negate', ['Cos', '_x']] },
  { match: ['Tan', ['Subtract', 'Pi', '_x']], replace: ['Negate', ['Tan', '_x']] },
  { match: ['Cot', ['Subtract', 'Pi', '_x']], replace: ['Negate', ['Cot', '_x']] },
  { match: ['Sec', ['Subtract', 'Pi', '_x']], replace: ['Negate', ['Sec', '_x']] },
  { match: ['Csc', ['Subtract', 'Pi', '_x']], replace: ['Csc', '_x'] },
  // π + x transformations
  { match: ['Sin', ['Add', 'Pi', '_x']], replace: ['Negate', ['Sin', '_x']] },
  { match: ['Cos', ['Add', 'Pi', '_x']], replace: ['Negate', ['Cos', '_x']] },
  { match: ['Tan', ['Add', 'Pi', '_x']], replace: ['Tan', '_x'] },
  { match: ['Cot', ['Add', 'Pi', '_x']], replace: ['Negate', ['Cot', '_x']] },
  { match: ['Sec', ['Add', 'Pi', '_x']], replace: ['Negate', ['Sec', '_x']] },
  { match: ['Csc', ['Add', 'Pi', '_x']], replace: ['Csc', '_x'] },

  // Trigonometric periodicity reduction for multiples of π
  // sin(nπ + x) and cos(nπ + x) where n is an integer
  {
    match: ['Sin', '_arg'],
    replace: (expr, wildcards) =>
      reduceTrigPeriodicity('Sin', wildcards._arg!, expr.engine),
  },
  {
    match: ['Cos', '_arg'],
    replace: (expr, wildcards) =>
      reduceTrigPeriodicity('Cos', wildcards._arg!, expr.engine),
  },
  {
    match: ['Tan', '_arg'],
    replace: (expr, wildcards) =>
      reduceTrigPeriodicity('Tan', wildcards._arg!, expr.engine),
  },
  {
    match: ['Cot', '_arg'],
    replace: (expr, wildcards) =>
      reduceTrigPeriodicity('Cot', wildcards._arg!, expr.engine),
  },
  {
    match: ['Sec', '_arg'],
    replace: (expr, wildcards) =>
      reduceTrigPeriodicity('Sec', wildcards._arg!, expr.engine),
  },
  {
    match: ['Csc', '_arg'],
    replace: (expr, wildcards) =>
      reduceTrigPeriodicity('Csc', wildcards._arg!, expr.engine),
  },

  // Co-function identities: π/2 - x
  {
    match: ['Sin', ['Subtract', 'Half', '_x']],
    replace: ['Cos', '_x'],
    condition: (ids, ce) => ids.Half?.isSame(ce.Pi.div(2)),
  },
  { match: ['Sin', ['Subtract', ['Divide', 'Pi', 2], '_x']], replace: ['Cos', '_x'] },
  { match: ['Cos', ['Subtract', ['Divide', 'Pi', 2], '_x']], replace: ['Sin', '_x'] },
  { match: ['Tan', ['Subtract', ['Divide', 'Pi', 2], '_x']], replace: ['Cot', '_x'] },
  { match: ['Cot', ['Subtract', ['Divide', 'Pi', 2], '_x']], replace: ['Tan', '_x'] },
  { match: ['Sec', ['Subtract', ['Divide', 'Pi', 2], '_x']], replace: ['Csc', '_x'] },
  { match: ['Csc', ['Subtract', ['Divide', 'Pi', 2], '_x']], replace: ['Sec', '_x'] },
  // Product-to-sum identities
  {
    match: ['Multiply', ['Sin', '_x'], ['Cos', '_x']],
    replace: (expr, ids) => expr.engine._fn('Sin', [ids._x.mul(2)]).div(2),
  },
  {
    match: ['Multiply', ['Sin', '_x'], ['Sin', '_y']],
    replace: (expr, ids) =>
      expr.engine
        ._fn('Cos', [ids._x.sub(ids._y)])
        .sub(expr.engine._fn('Cos', [ids._x.add(ids._y)]))
        .div(2),
  },
  {
    match: ['Multiply', ['Cos', '_x'], ['Cos', '_y']],
    replace: (expr, ids) =>
      expr.engine
        ._fn('Cos', [ids._x.sub(ids._y)])
        .add(expr.engine._fn('Cos', [ids._x.add(ids._y)]))
        .div(2),
  },
  {
    match: ['Multiply', ['Tan', '_x'], ['Cot', '_x']],
    replace: toOne,
  },

  // Pythagorean identities - basic forms
  {
    match: ['Add', ['Power', ['Sin', '_x'], 2], ['Power', ['Cos', '_x'], 2]],
    replace: toOne,
  },
  { match: ['Subtract', 1, ['Power', ['Sin', '_x'], 2]], replace: ['Power', ['Cos', '_x'], 2] },
  { match: ['Subtract', 1, ['Power', ['Cos', '_x'], 2]], replace: ['Power', ['Sin', '_x'], 2] },
  { match: ['Add', ['Power', ['Tan', '_x'], 2], 1], replace: ['Power', ['Sec', '_x'], 2] },
  { match: ['Add', 1, ['Power', ['Cot', '_x'], 2]], replace: ['Power', ['Csc', '_x'], 2] },
  { match: ['Subtract', ['Power', ['Sec', '_x'], 2], 1], replace: ['Power', ['Tan', '_x'], 2] },
  { match: ['Subtract', ['Power', ['Csc', '_x'], 2], 1], replace: ['Power', ['Cot', '_x'], 2] },
  // Pythagorean identities - reversed subtraction forms
  { match: ['Subtract', ['Power', ['Sin', '_x'], 2], 1], replace: ['Negate', ['Power', ['Cos', '_x'], 2]] },
  { match: ['Subtract', ['Power', ['Cos', '_x'], 2], 1], replace: ['Negate', ['Power', ['Sin', '_x'], 2]] },
  { match: ['Add', -1, ['Power', ['Tan', '_x'], 2]], replace: ['Negate', ['Power', ['Cot', '_x'], 2]] },
  { match: ['Add', -1, ['Power', ['Sec', '_x'], 2]], replace: ['Power', ['Tan', '_x'], 2] },
  { match: ['Add', -1, ['Power', ['Csc', '_x'], 2]], replace: ['Power', ['Cot', '_x'], 2] },
  // Pythagorean identities - negated forms
  {
    match: [
      'Add',
      ['Negate', ['Power', ['Sin', '_x'], 2]],
      ['Negate', ['Power', ['Cos', '_x'], 2]],
    ],
    replace: toNegativeOne,
  },
  // Pythagorean identities with coefficient
  {
    match: [
      'Add',
      ['Multiply', '_a', ['Power', ['Sin', '_x'], 2]],
      ['Multiply', '_a', ['Power', ['Cos', '_x'], 2]],
    ],
    replace: (expr, ids) => ids._a,
  },

  // Double-angle formulas for squares (commented out - often make expressions more complex)
  // '\\sin(x)^2 -> \\frac{1 - \\cos(2x)}{2}',
  // '\\cos(x)^2 -> \\frac{1 + \\cos(2x)}{2}',
  // Note: Unconditional tan/cot/sec/csc -> sin/cos conversions are disabled
  // because they often make expressions more complex (e.g., tan(x) -> sin(x)/cos(x)
  // increases cost from 11 to 30). This interferes with other simplifications
  // like periodicity reduction. If needed, use a dedicated rule set for conversion.
  // {
  //   match: ['Tan', '__x'],
  //   replace: ['Divide', ['Sin', '__x'], ['Cos', '__x']],
  // },
  // {
  //   match: ['Cot', '__x'],
  //   replace: ['Divide', ['Cos', '__x'], ['Sin', '__x']],
  // },
  // {
  //   match: ['Sec', '__x'],
  //   replace: ['Divide', 1, ['Cos', '__x']],
  // },
  // {
  //   match: ['Csc', '__x'],
  //   replace: ['Divide', 1, ['Sin', '__x']],
  // },
  // {
  //   match: ['Cos', '__x'],
  //   replace: ['Sin', ['Add', ['Divide', 'Pi', 2], '__x']],
  // },
  {
    match: ['Arcosh', '__x'],
    replace: [
      'Ln',
      ['Add', '__x', ['Sqrt', ['Subtract', ['Square', '__x'], 1]]],
    ],
    condition: (sub, ce) => sub.__x.isGreater(ce.One) ?? false,
  },
  {
    match: ['Arcsin', '__x'],
    replace: [
      'Multiply',
      2,
      [
        'Arctan2',
        '__x',
        ['Add', 1, ['Sqrt', ['Subtract', 1, ['Square', '__x']]]],
      ],
    ],
  },
  {
    match: ['Arsinh', '__x'],
    replace: [
      'Multiply',
      2,
      ['Ln', ['Add', '__x', ['Sqrt', ['Add', ['Square', '__x'], 1]]]],
    ],
  },
  {
    match: ['Artanh', '__x'],
    replace: [
      'Multiply',
      'Half',
      ['Ln', ['Divide', ['Add', 1, '__x'], ['Subtract', 1, '__x']]],
    ],
  },
  {
    match: ['Cosh', '__x'],
    replace: ['Divide', ['Add', ['Exp', '__x'], ['Exp', ['Negate', '__x']]], 2],
  },
  {
    match: ['Sinh', '__x'],
    replace: [
      'Divide',
      ['Subtract', ['Exp', '__x'], ['Exp', ['Negate', '__x']]],
      2,
    ],
  },

  // '\\frac{x}{x} -> 1', // Note this is not true for x = 0

  // '\\frac{x^n}{x^m} -> x^{n-m}', // Note this is not always true
  // 'x^n * x^m -> x^{n+m}',
  // 'x^a * x^b -> x^{a+b}',
  // 'x^n^m -> x^{n * m}',

  // // Exponential and logarithms
  // '\\log(xy) -> \\log(x) + \\log(y)',
  // '\\log(x^n) -> n \\log(x)',
  // '\\log(\\frac{x}{y}) -> \\log(x) - \\log(y)',
  // '\\log(\\exp(x) * y) -> x + \\log(y)',
  // '\\log(\\exp(x) / y) -> x - \\log(y)',
  // '\\log(\\exp(x)^y) -> y * x',
  // '\\log(\\exp(x)) -> x',

  // '\\exp(x) * \\exp(y) -> \\exp(x + y)',
  // '\\exp(x)^n -> \\exp(n x)',
  // '\\exp(\\log(x)) -> x',
  // '\\exp(\\log(x) + y) -> x * \\exp(y)',
  // '\\exp(\\log(x) - y) -> x / \\exp(y)',
  // '\\exp(\\log(x) * y) -> x^y',
  // '\\exp(\\log(x) / y) -> x^(1/y)',
  // '\\exp(\\log(x) * \\log(y)) -> x^\\log(y)',
  // '\\exp(\\log(x) / \\log(y)) -> x^{1/\\log(y)}',

  // // Trigonometric
  // '\\sin(-x) -> -\\sin(x)',
  // '\\cos(-x) -> \\cos(x)',
  // '\\tan(-x) -> -\\tan(x)',
  // '\\cot(-x) -> -\\cot(x)',
  // '\\sec(-x) -> \\sec(x)',
  // '\\csc(-x) -> -\\csc(x)',
  // '\\sin(\\pi - x) -> \\sin(x)',
  // '\\cos(\\pi - x) -> -\\cos(x)',
  // '\\tan(\\pi - x) -> -\\tan(x)',
  // '\\cot(\\pi - x) -> -\\cot(x)',
  // '\\sec(\\pi - x) -> -\\sec(x)',
  // '\\csc(\\pi - x) -> \\csc(x)',
  // '\\sin(\\pi + x) -> -\\sin(x)',
  // '\\cos(\\pi + x) -> -\\cos(x)',
  // '\\tan(\\pi + x) -> \\tan(x)',
  // '\\cot(\\pi + x) -> -\\cot(x)',
  // '\\sec(\\pi + x) -> -\\sec(x)',
  // '\\csc(\\pi + x) -> \\csc(x)',

  // '\\sin(\\frac{\\pi}{2} - x) -> \\cos(x)',
  // '\\cos(\\frac{\\pi}{2} - x) -> \\sin(x)',
  // '\\tan(\\frac{\\pi}{2} - x) -> \\cot(x)',
  // '\\cot(\\frac{\\pi}{2} - x) -> \\tan(x)',
  // '\\sec(\\frac{\\pi}{2} - x) -> \\csc(x)',
  // '\\csc(\\frac{\\pi}{2} - x) -> \\sec(x)',
  // '\\sin(x) * \\cos(x) -> \\frac{1}{2} \\sin(2x)',
  // '\\sin(x) * \\sin(y) -> \\frac{1}{2} (\\cos(x-y) - \\cos(x+y))',
  // '\\cos(x) * \\cos(y) -> \\frac{1}{2} (\\cos(x-y) + \\cos(x+y))',
  // '\\tan(x) * \\cot(x) -> 1',
  // // '\\sin(x)^2 + \\cos(x)^2 -> 1',
  // '\\sin(x)^2 -> \\frac{1 - \\cos(2x)}{2}',
  // '\\cos(x)^2 -> \\frac{1 + \\cos(2x)}{2}',
  // {
  //   match: ['Tan', '__x'],
  //   replace: ['Divide', ['Sin', '__x'], ['Cos', '__x']],
  // },
  // {
  //   match: ['Cot', '__x'],
  //   replace: ['Divide', ['Cos', '__x'], ['Sin', '__x']],
  // },
  // {
  //   match: ['Sec', '__x'],
  //   replace: ['Divide', 1, ['Cos', '__x']],
  // },
  // {
  //   match: ['Csc', '__x'],
  //   replace: ['Divide', 1, ['Sin', '__x']],
  // },
  // {
  //   match: ['Cos', '__x'],
  //   replace: ['Sin', ['Add', ['Divide', 'Pi', 2], '__x']],
  // },
  {
    match: ['Arcosh', '__x'],
    replace: [
      'Ln',
      ['Add', '__x', ['Sqrt', ['Subtract', ['Square', '__x'], 1]]],
    ],
    condition: ({ __x }) => __x.isGreater(1) ?? false,
  },
  {
    match: ['Arcsin', '__x'],
    replace: [
      'Multiply',
      2,
      [
        'Arctan2',
        '__x',
        ['Add', 1, ['Sqrt', ['Subtract', 1, ['Square', '__x']]]],
      ],
    ],
  },
  {
    match: ['Arsinh', '__x'],
    replace: [
      'Multiply',
      2,
      ['Ln', ['Add', '__x', ['Sqrt', ['Add', ['Square', '__x'], 1]]]],
    ],
  },
  {
    match: ['Artanh', '__x'],
    replace: [
      'Multiply',
      'Half',
      ['Ln', ['Divide', ['Add', 1, '__x'], ['Subtract', 1, '__x']]],
    ],
  },
  {
    match: ['Cosh', '__x'],
    replace: ['Divide', ['Add', ['Exp', '__x'], ['Exp', ['Negate', '__x']]], 2],
  },
  {
    match: ['Sinh', '__x'],
    replace: [
      'Divide',
      ['Subtract', ['Exp', '__x'], ['Exp', ['Negate', '__x']]],
      2,
    ],
  },
];
//  [
//   // `Subtract`
//   ['$\\_ - \\_$', 0],
//   [['Subtract', '\\_x', 0], 'x'],
//   [['Subtract', 0, '\\_x'], '$-x$'],

//   // `Add`
//   [['Add', '_x', ['Negate', '_x']], 0],

//   // `Multiply`
//   ['$\\_ \\times \\_ $', '$\\_^2$'],

//   // `Divide`
//   [['Divide', '_x', 1], { sym: '_x' }],
//   [['Divide', '_x', '_x'], 1, { condition: (sub) => sub.x.isNotZero ?? false }],
//   [
//     ['Divide', '_x', 0],
//     { num: '+Infinity' },
//     { condition: (sub) => sub.x.isPositive ?? false },
//   ],
//   [
//     ['Divide', '_x', 0],
//     { num: '-Infinity' },
//     { condition: (sub) => sub.x.isNegative ?? false },
//   ],
//   [['Divide', 0, 0], NaN],

//   // `Power`
//   [['Power', '_x', 'Half'], '$\\sqrt{x}$'],
//   [
//     ['Power', '_x', 2],
//     ['Square', '_x'],
//   ],

//   // Complex
//   [
//     ['Divide', ['Complex', '_re', '_im'], '_x'],
//     ['Add', ['Divide', ['Complex', 0, '_im'], '_x'], ['Divide', '_re', '_x']],
//     {
//       condition: (sub: Substitution): boolean =>
//         (sub.re.isNotZero ?? false) &&
//         (sub.re.isInteger ?? false) &&
//         (sub.im.isInteger ?? false),
//     },
//   ],

//   // `Abs`
//   [
//     ['Abs', '_x'],
//     { sym: '_x' },
//     {
//       condition: (sub: Substitution): boolean => sub.x.isNonNegative ?? false,
//     },
//   ],
//   [
//     ['Abs', '_x'],
//     ['Negate', '_x'],
//     {
//       condition: (sub: Substitution): boolean => sub.x.isNegative ?? false,
//     },
//   ],

//   //
//   // Boolean
//   //
//   [['Not', ['Not', '_x']], '_x'], // @todo Since Not is an involution, should not be needed
//   [['Not', 'True'], 'False'],
//   [['Not', 'False'], 'True'],
//   [['Not', 'OptArg'], 'OptArg'],

//   [['And'], 'True'],
//   [['And', '__x'], '__x'],
//   [['And', '__x', 'True'], '_x'],
//   [['And', '__', 'False'], 'False'],
//   [['And', '__', 'OptArg'], 'OptArg'],
//   [['And', '__x', ['Not', '__x']], 'False'],
//   [['And', ['Not', '__x'], '__x'], 'False'],

//   [['Or'], 'False'],
//   [['Or', '__x'], '__x'],
//   [['Or', '__', 'True'], 'True'],
//   [['Or', '__x', 'False'], '__x'],
//   [
//     ['Or', '__x', 'OptArg'],
//     ['Or', '__x'],
//   ],

//   [
//     ['NotEqual', '__x'],
//     ['Not', ['Equal', '__x']],
//   ],
//   [
//     ['NotElement', '__x'],
//     ['Not', ['Element', '__x']],
//   ],
//   [
//     ['NotLess', '__x'],
//     ['Not', ['Less', '__x']],
//   ],
//   [
//     ['NotLessNotEqual', '__x'],
//     ['Not', ['LessEqual', '__x']],
//   ],
//   [
//     ['NotTildeFullEqual', '__x'],
//     ['Not', ['TildeFullEqual', '__x']],
//   ],
//   [
//     ['NotApprox', '__x'],
//     ['Not', ['Approx', '__x']],
//   ],
//   [
//     ['NotApproxEqual', '__x'],
//     ['Not', ['ApproxEqual', '__x']],
//   ],
//   [
//     ['NotGreater', '__x'],
//     ['Not', ['Greater', '__x']],
//   ],
//   [
//     ['NotApproxNotEqual', '__x'],
//     ['Not', ['GreaterEqual', '__x']],
//   ],
//   [
//     ['NotPrecedes', '__x'],
//     ['Not', ['Precedes', '__x']],
//   ],
//   [
//     ['NotSucceeds', '__x'],
//     ['Not', ['Succeeds', '__x']],
//   ],
//   [
//     ['NotSubset', '__x'],
//     ['Not', ['Subset', '__x']],
//   ],
//   [
//     ['NotSuperset', '__x'],
//     ['Not', ['Superset', '__x']],
//   ],
//   [
//     ['NotSubsetNotEqual', '__x'],
//     ['Not', ['SubsetEqual', '__x']],
//   ],
//   [
//     ['NotSupersetEqual', '__x'],
//     ['Not', ['SupersetEqual', '__x']],
//   ],

//   // DeMorgan's Laws
//   [
//     ['Not', ['And', ['Not', '_a'], ['Not', '_b']]],
//     ['Or', '_a', '_b'],
//   ],
//   [
//     ['And', ['Not', '_a'], ['Not', '_b']],
//     ['Not', ['Or', '_a', '_b']],
//   ],
//   [
//     ['Not', ['Or', ['Not', '_a'], ['Not', '_b']]],
//     ['And', '_a', '_b'],
//   ],
//   [
//     ['Or', ['Not', '_a'], ['Not', '_b']],
//     ['Not', ['And', '_a', '_b']],
//   ],

//   // Implies

//   [['Implies', 'True', 'False'], 'False'],
//   [['Implies', '_', 'OptArg'], 'True'],
//   [['Implies', '_', 'True'], 'True'],
//   [['Implies', 'False', '_'], 'True'],
//   [
//     ['Or', ['Not', '_p'], '_q'],
//     ['Implies', '_p', '_q'],
//   ], // p => q := (not p) or q
//   // if           Q=F & P= T      F
//   // otherwise                    T

//   //  Equivalent

//   [
//     ['Or', ['And', '_p', '_q'], ['And', ['Not', '_p'], ['Not', '_q']]],
//     ['Equivalent', '_p', '_q'],
//   ], // p <=> q := (p and q) or (not p and not q), aka `iff`
//   //   if (q = p), T. Otherwise, F
//   [['Equivalent', 'True', 'True'], 'True'],
//   [['Equivalent', 'False', 'False'], 'True'],
//   [['Equivalent', 'OptArg', 'OptArg'], 'True'],
//   [['Equivalent', 'True', 'False'], 'False'],
//   [['Equivalent', 'False', 'True'], 'False'],
//   [['Equivalent', 'True', 'OptArg'], 'False'],
//   [['Equivalent', 'False', 'OptArg'], 'False'],
//   [['Equivalent', 'OptArg', 'True'], 'False'],
//   [['Equivalent', 'OptArg', 'False'], 'False'],
// ];

// export function internalSimplify(
//   ce: ComputeEngine,
//   expr: BoxedExpression | null,
//   simplifications?: Simplification[]
// ): BoxedExpression | null {
//   if (expr === null) return null;

//   //
//   // 1/ Apply simplification rules
//   //
//   simplifications = simplifications ?? ['simplify-all'];
//   if (simplifications.length === 1 && simplifications[0] === 'simplify-all') {
//     simplifications = [
//       'simplify-arithmetic',
//       // 'simplify-logarithmic',
//       // 'simplify-trigonometric',
//     ];
//   }
//   for (const simplification of simplifications) {
//     expr = ce.replace(
//       expr,
//       ce.cache<RuleSet>(
//         simplification,
//         (): RuleSet => compileRules(ce, SIMPLIFY_RULES[simplification])
//       )
//     );
//   }

//   //
//   // 2/ Numeric simplifications
//   //
//   // expr = simplifyNumber(ce, expr!) ?? expr;

//   //
//   // 3/ Simplify boolean expressions, using assumptions.
//   //
//   //
//   expr = simplifyBoolean(expr);

//   if (isAtomic(expr!)) return expr;

//   //
//   // 4/ Simplify Dictionary
//   //
//   // if (getDictionary(expr!) !== null) {
//   //   return applyRecursively(
//   //     expr!,
//   //     (x) => internalSimplify(ce, x, simplifications) ?? x
//   //   );
//   // }

//   //
//   // 5/ It's a function (not a dictionary and not atomic)
//   //

//   const head = internalSimplify(
//     ce,
//     getFunctionHead(expr) ?? 'Missing',
//     simplifications
//   );
//   if (typeof head === 'string') {
//     const def = ce.getFunctionDefinition(head);
//     if (def) {
//       // Simplify the arguments, except those affected by `hold`
//       const args: BoxedExpression[] = [];
//       const tail = getTail(expr);
//       for (let i = 0; i < tail.length; i++) {
//         const name = getFunctionName(tail[i]);
//         if (name === 'Evaluate') {
//           args.push(internalSimplify(ce, tail[i], simplifications) ?? tail[i]);
//         } else if (name === 'Hold') {
//           args.push(getArg(tail[i], 1) ?? 'Missing');
//         } else if (
//           (i === 0 && def.hold === 'first') ||
//           (i > 0 && def.hold === 'rest') ||
//           def.hold === 'all'
//         ) {
//           args.push(tail[i]);
//         } else {
//           args.push(internalSimplify(ce, tail[i], simplifications) ?? tail[i]);
//         }
//       }
//       const result =
//         typeof def.simplify === 'function'
//           ? def.simplify(ce, ...args) ?? expr
//           : [head, ...args];
//       return ce.cost(result) <= ce.cost(expr) ? result : expr;
//     }
//   }
//   if (head !== null) {
//     // If we can't identify the function, we don't know how to process
//     // the arguments (they may be Hold...), so don't attempt to process them.
//     return [head, ...getTail(expr)];
//   }
//   return expr;
// }

function simplifyRelationalOperator(
  expr: BoxedExpression
): RuleStep | undefined {
  const h = expr.operator;
  if (!isInequalityOperator(h) && !isEquationOperator(h)) return undefined;

  const originalExpr = expr;

  const ce = expr.engine;

  //
  // 1/ Simplify both sides of the relational operator
  //

  const op1 = expr.op1.simplify();
  const op2 = expr.op2.simplify();
  expr = ce._fn(expr.operator, [op1, op2]);

  //
  // 2/ Try to factor terms across the relational operator
  //   2x < 4t -> x < 2t
  //
  expr = factor(expr) ?? expr;
  console.assert(isRelationalOperator(expr.operator));
  if (expr.nops === 2) {
    // Try f(x) < g(x) -> f(x) - g(x) < 0
    if (!expr.op2.is(0)) {
      const alt = factor(
        ce._fn(expr.operator, [expr.op1.sub(expr.op2), ce.Zero])
      );
      // Pick the cheapest (simplest) of the two
      if (ce.costFunction(alt) < ce.costFunction(expr)) expr = alt;
    }
  }

  if (expr.isSame(originalExpr)) return undefined;

  return { value: expr, because: 'simplify-relational-operator' };
}

function simplifySystemOfEquations(
  expr: BoxedExpression
): RuleStep | undefined {
  if (expr.operator !== 'List') return undefined;

  // Check if every element is an equation or inequality
  if (
    !expr.ops!.every(
      (x) => isEquationOperator(x.operator) || isInequalityOperator(x.operator)
    )
  )
    return undefined;

  // The result is a list of simplified equations and inequalities
  // @todo: could also resolve it... See https://github.com/cortex-js/compute-engine/issues/189

  const ce = expr.engine;
  return {
    value: ce.function(
      'List',
      expr.ops!.map((x) => x.simplify())
    ),
    because: 'simplify-system-of-equations',
  };
}

function isExact(n: number | NumericValue | null): boolean {
  if (n === null) return false;
  if (typeof n === 'number') return Number.isInteger(n);
  return n.isExact;
}
