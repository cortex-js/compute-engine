import {
  constructibleValues,
  isConstructible,
  processInverseFunction,
} from '../boxed-expression/trigonometry';
import { mul } from '../boxed-expression/arithmetic-mul-div';
import { simplifyLogicFunction } from './simplify-logic';
import type { BoxedExpression, Rule, RuleStep } from '../global-types';
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
import {
  simplifyAbs,
  simplifyAbsPower,
  simplifyEvenFunctionAbs,
} from './simplify-abs';
import { simplifyInfinity } from './simplify-infinity';
import { simplifyLog } from './simplify-log';
import { simplifyPower } from './simplify-power';
import { simplifyTrig } from './simplify-trig';
import { simplifyHyperbolic } from './simplify-hyperbolic';
import { simplifyDivide } from './simplify-divide';

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
const toZero = (expr: BoxedExpression) => expr.engine.Zero;
const toOne = (expr: BoxedExpression) => expr.engine.One;
const toNegativeOne = (expr: BoxedExpression) => expr.engine.NegativeOne;

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
  (x) => {
    // Skip expand for Multiply expressions with same-base powers
    // Let simplifyPower handle e^x * e^2 -> e^{x+2} instead of evaluating e^2
    // Also handle bare symbols (a = a^1) as having an implicit power
    if (x.operator === 'Multiply' && x.ops) {
      const powerBases = new Map<string, number>();
      for (const op of x.ops) {
        // Get the base: for Power it's op1, for symbols it's the symbol itself
        let baseKey: string | null = null;
        if (op.operator === 'Power' && op.op1) {
          baseKey = JSON.stringify(op.op1.json);
        } else if (op.symbol) {
          baseKey = JSON.stringify(op.json);
        }
        if (baseKey) {
          powerBases.set(baseKey, (powerBases.get(baseKey) || 0) + 1);
        }
      }
      // If any base has multiple powers, skip expand
      for (const count of powerBases.values()) {
        if (count > 1) return undefined;
      }
    }
    const value = expand(x);
    return value ? { value, because: 'expand' } : undefined;
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

    // Check if there are same-base powers that should be combined by simplifyPower
    // e.g., e^x * e^2 should become e^{x+2}, not 7.389... * e^x
    // Also handle bare symbols (a = a^1) as having an implicit power
    const ops = x.ops!;
    const powerBases = new Map<string, BoxedExpression[]>();
    for (const op of ops) {
      // Get the base: for Power it's op1, for symbols it's the symbol itself
      let baseKey: string | null = null;
      let baseOp: BoxedExpression | null = null;
      if (op.operator === 'Power' && op.op1) {
        baseKey = JSON.stringify(op.op1.json);
        baseOp = op;
      } else if (op.symbol) {
        baseKey = JSON.stringify(op.json);
        baseOp = op;
      }
      if (baseKey && baseOp) {
        const group = powerBases.get(baseKey) || [];
        group.push(baseOp);
        powerBases.set(baseKey, group);
      }
    }
    // If any base has multiple powers, skip this rule and let simplifyPower handle it
    for (const group of powerBases.values()) {
      if (group.length > 1) return undefined;
    }

    // Check for trig power patterns that simplifyTrig should handle:
    // - n * sin²(x) or sin²(x) * n (power reduction identities)
    // - sin(x) * cos(x) (product-to-sum identities)
    // - tan(x) * cot(x) -> 1
    if (ops.length === 2) {
      const [a, b] = ops;
      // Check for coefficient * trig²(x) pattern (e.g., 2sin²(x) -> 1-cos(2x))
      const hasTrigSquared =
        (a.operator === 'Power' &&
          a.op2?.is(2) &&
          ['Sin', 'Cos'].includes(a.op1?.operator || '')) ||
        (b.operator === 'Power' &&
          b.op2?.is(2) &&
          ['Sin', 'Cos'].includes(b.op1?.operator || ''));
      const hasCoefficient = a.isNumberLiteral || b.isNumberLiteral;
      if (hasTrigSquared && hasCoefficient) return undefined;

      // Check for sin(x) * cos(x) pattern
      const hasSin = a.operator === 'Sin' || b.operator === 'Sin';
      const hasCos = a.operator === 'Cos' || b.operator === 'Cos';
      if (hasSin && hasCos) return undefined;

      // Check for tan(x) * cot(x) pattern
      const hasTan = a.operator === 'Tan' || b.operator === 'Tan';
      const hasCot = a.operator === 'Cot' || b.operator === 'Cot';
      if (hasTan && hasCot) return undefined;
    }

    // The Multiply function has a 'lazy' property, so we need to ensure operands are canonical.
    // Also evaluate purely numeric operands (no unknowns) to simplify expressions.
    // IMPORTANT: Don't call .simplify() on operands to avoid infinite recursion.
    return {
      value: mul(
        ...ops.map((op) => {
          const canonical = op.canonical;
          // Evaluate purely numeric operands (no unknowns) to simplify them
          // BUT skip Power expressions that should stay symbolic:
          // - e^n (for potential combination with e^x)
          // - n^{p/q} where result is irrational (e.g., 2^{3/5})
          if (canonical.unknowns.length === 0 && canonical.ops) {
            if (canonical.operator === 'Power') {
              // Skip evaluation for e^n to allow power combination rules to work
              if (canonical.op1?.symbol === 'ExponentialE') {
                return canonical;
              }
              // Skip evaluation for n^{p/q} with non-integer exponent
              // These produce irrational results that should stay symbolic
              // e.g., 2^{3/5} should stay as 2^{3/5}, not 1.5157...
              if (
                canonical.op2?.isRational === true &&
                canonical.op2?.isInteger === false
              ) {
                return canonical;
              }
            }
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
    if (x.operator === 'Divide') {
      // Be conservative about simplifying division when the denominator is a
      // constant expression (no unknowns) that is not already a number literal.
      // In particular, avoid turning 0/(1-1) into 0, or (1-1)/(1-1) into 1,
      // since (1-1) can simplify/evaluate to 0.
      // These cases can be handled by an explicit preliminary evaluation.
      const num = x.op1;
      const denom = x.op2;
      if (
        num &&
        denom &&
        denom.isNumberLiteral !== true &&
        denom.symbols.length === 0
      ) {
        if (num.is(0) || num.isSame(denom)) return undefined;
      }

      // Skip if both operands are powers with the same base (let simplifyPower handle it)
      // This preserves symbolic forms like e^x / e^2 -> e^{x-2}
      if (num.operator === 'Power' && denom.operator === 'Power') {
        if (num.op1?.isSame(denom.op1)) return undefined;
      }
      // Also skip if one is a power and the other is the same base
      // e.g., e^x / e -> e^{x-1}
      if (num.operator === 'Power' && num.op1?.isSame(denom)) return undefined;
      if (denom.operator === 'Power' && denom.op1?.isSame(num))
        return undefined;

      return { value: num.div(denom), because: 'division' };
    }
    if (x.operator === 'Rational' && x.nops === 2)
      return { value: x.op1.div(x.op2), because: 'rational' };
    return undefined;
  },

  //
  // Power, Root, Sqrt
  //
  (x): RuleStep | undefined => {
    if (!x.op1?.isNumberLiteral) return undefined;

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
    if (!op2?.isNumberLiteral) return undefined;

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
  // Ln, Log (basic evaluation)
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
    return undefined;
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

  //
  // Logic
  //
  simplifyLogicFunction,

  //
  // Consolidated functional rules for better performance
  //
  // These functional rules replace ~200+ pattern-matching rules,
  // providing O(1) operator lookup instead of pattern matching overhead.
  //

  // Absolute value simplification
  simplifyAbs,
  simplifyAbsPower,
  simplifyEvenFunctionAbs,

  // Infinity-related simplifications
  simplifyInfinity,

  // Logarithm simplifications (advanced rules)
  simplifyLog,

  // Power-related simplifications
  simplifyPower,

  // Trigonometric simplifications
  simplifyTrig,

  // Hyperbolic trig simplifications
  simplifyHyperbolic,

  // Division simplifications
  simplifyDivide,

  //
  // Power combination for 2+ operands in Multiply
  //
  (x): RuleStep | undefined => {
    if (x.operator !== 'Multiply' || !x.ops || x.ops.length < 2)
      return undefined;

    const ce = x.engine;

    // Group ALL terms by base (including unknown symbols)
    const baseGroups = new Map<
      string,
      {
        base: BoxedExpression;
        terms: Array<{ term: BoxedExpression; exp: BoxedExpression }>;
      }
    >();
    const otherTerms: BoxedExpression[] = [];

    for (const term of x.ops) {
      let base: BoxedExpression;
      let exp: BoxedExpression;

      if (term.operator === 'Power') {
        base = term.op1;
        exp = term.op2;
      } else if (term.symbol) {
        // Bare symbol treated as base^1
        base = term;
        exp = ce.One;
      } else {
        // Non-symbol, non-power terms (e.g., numbers) go to otherTerms
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

    // Check if any base has multiple terms that can be combined
    let hasCombinations = false;
    for (const group of baseGroups.values()) {
      if (group.terms.length > 1) {
        // Check if we can safely combine:
        // - base is known non-zero (positive, negative, or numeric), OR
        // - sum of exponents is positive (so 0^n = 0, not 0^(-k) = undefined)
        const base = group.base;
        const baseNonZero =
          base.isPositive === true ||
          base.isNegative === true ||
          base.isNumberLiteral === true;

        if (baseNonZero) {
          hasCombinations = true;
        } else {
          // Check if sum of exponents is positive (safe even if base might be 0)
          const exponents = group.terms.map((t) => t.exp);
          const summedExp = exponents.reduce((a, b) => a.add(b));
          if (summedExp.isPositive === true) {
            hasCombinations = true;
          } else {
            // Can't safely combine - push all terms to otherTerms
            for (const t of group.terms) {
              otherTerms.push(t.term);
            }
            group.terms.length = 0;
          }
        }
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
        const exponents = group.terms.map((t) => t.exp);
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

    if (resultTerms.length === 0)
      return { value: ce.One, because: 'combined powers' };
    if (resultTerms.length === 1)
      return { value: resultTerms[0], because: 'combined powers' };
    return {
      value: ce._fn('Multiply', resultTerms),
      because: 'combined powers with same base',
    };
  },
];

// Helper function to check if a value is exact
function isExact(n: number | NumericValue | null): boolean {
  if (n === null) return false;
  if (typeof n === 'number') return Number.isInteger(n);
  return n.isExact;
}

//
// Helper functions for relational operators and system of equations
//

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
