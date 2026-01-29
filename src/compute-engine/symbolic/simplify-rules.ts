import {
  constructibleValues,
  isConstructible,
  processInverseFunction,
} from '../boxed-expression/trigonometry';
import { mul } from '../boxed-expression/arithmetic-mul-div';
import { simplifyLogicFunction } from '../library/logic';
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
import type { ComputeEngine } from '../global-types';

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
  '\\varphi -> \\frac{1+\\sqrt{5}}{2}',

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
    // The Add function has a 'lazy' property, so we have to simplify
    // the operands first
    return {
      value: add(...x.ops!.map((x) => x.canonical.simplify())),
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

    // The Multiply function has a 'lazy' property, so we have to simplify
    // the operands first
    return {
      value: mul(...x.ops!.map((x) => x.canonical.simplify())),
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
        value: ce.function('Derivative', [f.simplify(), degree]),
        because: 'derivative',
      };
    if (x.nops === 1) {
      return {
        value: ce.function('Derivative', [f.simplify()]),
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

  '\\arcsinh(x) -> \\ln(x+\\sqrt{x^2+1})',
  '\\arccosh(x) -> \\ln(x+\\sqrt{x^2-1})',
  '\\arctanh(x) -> \\frac{1}{2}\\ln(\\frac{1+x}{1-x})',
  '\\arccoth(x) -> \\frac{1}{2}\\ln(\\frac{x+1}{x-1})',
  '\\arcsech(x) -> \\ln(\\frac{1+\\sqrt{1-x^2}}{x})',
  '\\arccsch(x) -> \\ln(\\frac{1}{x} + \\sqrt{\\frac{1}{x^2}+1})',

  //
  // Logic
  //
  simplifyLogicFunction,

  //
  // Trig and Infinity
  //
  {
    match: '\\sin(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\cos(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\tan(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\cot(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\sec(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\csc(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },

  //
  // Hyperbolic Trig and Infinity
  //
  {
    match: '\\sinh(x)',
    replace: '\\infty',
    condition: (id) => id._x.isInfinity === true && id._x.isPositive === true,
  },
  {
    match: '\\sinh(x)',
    replace: '-\\infty',
    condition: (id) => id._x.isInfinity === true && id._x.isNegative === true,
  },
  {
    match: '\\cosh(x)',
    replace: '\\infty',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\tanh(x)',
    replace: '1',
    condition: (id) => id._x.isInfinity === true && id._x.isPositive === true,
  },
  {
    match: '\\tanh(x)',
    replace: '-1',
    condition: (id) => id._x.isInfinity === true && id._x.isNegative === true,
  },
  {
    match: '\\coth(x)',
    replace: '1',
    condition: (id) => id._x.isInfinity === true && id._x.isPositive === true,
  },
  {
    match: '\\coth(x)',
    replace: '-1',
    condition: (id) => id._x.isInfinity === true && id._x.isNegative === true,
  },
  {
    match: '\\sech(x)',
    replace: '0',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\csch(x)',
    replace: '0',
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
      return { value: x.engine.function('Abs', [base]), because: 'root(x^n, n) where n even' };
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
      ids._x.isPositive === true || ids._x.isNegative === true,
  },
  // x^n * x -> x^{n+1} (special case when second power is implicit 1)
  {
    match: ['Multiply', ['Power', '_x', '_n'], '_x'],
    replace: ['Power', '_x', ['Add', '_n', 1]],
    condition: (ids) =>
      ids._x.isPositive === true || ids._x.isNegative === true,
  },

  //
  // Logarithm Power Rules
  //
  // ln(x^n) -> n*ln(x) when x is non-negative or n is odd
  {
    match: '\\ln(x^n)',
    replace: 'n*\\ln(x)',
    condition: (ids) =>
      ids._x.isNonNegative === true ||
      ids._n.isOdd === true ||
      ids._n.isRational === false,
  },
  // ln(x^n) -> n*ln(|x|) when n is even
  {
    match: '\\ln(x^n)',
    replace: 'n*\\ln(|x|)',
    condition: (ids) => ids._n.isEven === true,
  },
  // log_c(x^n) -> n*log_c(x) when x is non-negative or n is odd
  {
    match: '\\log_c(x^n)',
    replace: 'n*\\log_c(x)',
    condition: (ids) =>
      ids._x.isNonNegative === true ||
      ids._n.isOdd === true ||
      ids._n.isRational === false,
  },
  // log_c(x^n) -> n*log_c(|x|) when n is even
  {
    match: '\\log_c(x^n)',
    replace: 'n*\\log_c(|x|)',
    condition: (ids) => ids._n.isEven === true,
  },
  // log_c(x^{n/k}) -> n*log_c(x)/k when x is non-negative or n is odd
  {
    match: '\\log_c(x^{n/k})',
    replace: '(n/k)*\\log_c(x)',
    condition: (ids) =>
      ids._x.isNonNegative === true || ids._n.isOdd === true,
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
  'x/0 -> \\operatorname{NaN}',
  {
    match: '0^x',
    replace: '\\operatorname{NaN}',
    condition: (ids) => ids._x.isNonPositive === true,
  },

  //Currently gives 0
  {
    match: '0*x',
    replace: '\\operatorname{NaN}',
    condition: (_x) => _x._x.isInfinity === true,
  },

  //Ln
  // '\\log(x) -> \\ln(x)',
  '\\ln(x)+\\ln(y) -> \\ln(x*y)', //assumes negative arguments are allowed
  '\\ln(x)-\\ln(y) -> \\ln(x/y)',
  'e^{\\ln(x)+y} -> x*e^y',
  'e^{\\ln(x)-y} -> x/e^y',
  'e^{\\ln(x)*y} -> x^y',
  'e^{\\ln(x)/y} -> x^{1/y}',
  'e^\\ln(x) -> x',
  '\\ln(e^x*y) -> x+\\ln(y)',
  '\\ln(e^x/y) -> x-\\ln(y)',
  '\\ln(y/e^x) -> \\ln(y)-x',
  '\\ln(0) -> \\operatorname{NaN}',

  //Log base c
  {
    match: '\\log_c(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._c.isZero === true || id._c.isOne === true,
  },
  '\\log_c(x)+\\log_c(y) -> \\log_c(x*y)', //assumes negative arguments are allowed
  '\\log_c(x)-\\log_c(y) -> \\log_c(x/y)',
  '\\log_c(c^x) -> x',
  '\\log_c(c) -> 1',
  '\\log_c(0) -> \\operatorname{NaN}',
  'c^{\\log_c(x)} -> x',
  'c^{\\log_c(x)*y} -> x^y',
  'c^{\\log_c(x)/y} -> x^{1/y}',
  '\\log_c(c^x*y) -> x+\\log_c(y)',
  '\\log_c(c^x/y) -> x-\\log_c(y)',
  '\\log_c(y/c^x) -> \\log_c(y)-x',
  'c^{\\log_c(x)+y} -> x*c^y',
  'c^{\\log_c(x)-y} -> x/c^y',

  //Change of Base
  '\\log_{1/c}(a) -> -\\log_c(a)',
  '\\log_c(a)*\\ln(a) -> \\ln(c)',
  '\\log_c(a)/\\log_c(b) -> \\ln(a)/\\ln(b)',
  '\\log_c(a)/\\ln(a) -> 1/\\ln(c)',
  '\\ln(a)/\\log_c(a) -> \\ln(c)',

  //Absolute Value
  '|-x| -> |x|',
  {
    match: '|x|',
    replace: 'x',
    condition: (ids) => ids._x.isNonNegative === true,
  },
  {
    match: '|x|',
    replace: '-x',
    condition: (ids) => ids._x.isNonPositive === true,
  },
  {
    match: '|xy|',
    replace: 'x|y|',
    condition: (ids) => ids._x.isNonNegative === true,
  },
  {
    match: '|xy|',
    replace: '-x|y|',
    condition: (ids) => ids._x.isNonPositive === true,
  },

  '|xy| -> |x||y|',
  '|\\frac{x}{y}| -> \\frac{|x|}{|y|}',
  { match: '|x|^n', replace: 'x^n', condition: (id) => id._n.isEven === true },
  {
    match: '|x|^{n/m}',
    replace: 'x^{n/m}',
    condition: (id) => id._n.isEven === true && id._m.isOdd === true,
  },
  {
    match: '|x^n|',
    replace: '|x|^n',
    condition: (id) => id._n.isOdd === true || id._n.isRational === false,
  },
  {
    match: '|x^{n/m}|',
    replace: '|x|^{n/m}',
    condition: (id) => id._n.isOdd === true || id._m.isInteger === true,
  },

  {
    match: '|\\frac{x}{y}|',
    replace: '\\frac{x}{|y|}',
    condition: (ids) => ids._x.isNonNegative === true,
  },
  {
    match: '|\\frac{x}{y}|',
    replace: '-\\frac{x}{|y|}',
    condition: (ids) => ids._x.isNonPositive === true,
  },
  {
    match: '|\\frac{x}{y}|',
    replace: '\\frac{|x|}{y}',
    condition: (ids) => ids._y.isNonNegative === true,
  },
  {
    match: '|\\frac{x}{y}|',
    replace: '-\\frac{|x|}{y}',
    condition: (ids) => ids._y.isNonPositive === true,
  },

  //Even functions
  '\\cos(|x|) -> \\cos(x)',
  '\\sec(|x|) -> \\sec(x)',
  '\\cosh(|x|) -> \\cosh(x)',
  '\\sech(|x|) -> \\sech(x)',

  //Odd Trig Functions
  '|\\sin(x)| -> \\sin(|x|)',
  '|\\tan(x)| -> \\tan(|x|)',
  '|\\cot(x)| -> \\cot(|x|)',
  '|\\csc(x)| -> \\csc(|x|)',
  '|\\arcsin(x)| -> \\arcsin(|x|)',
  '|\\arctan(x)| -> \\arctan(|x|)',
  '|\\arccot(x)| -> \\arccot(|x|)',
  '|\\arccsc(x)| -> \\arccsc(|x|)',
  //Odd Hyperbolic Trig Functions
  '|\\sinh(x)| -> \\sinh(|x|)',
  '|\\tanh(x)| -> \\tanh(|x|)',
  '|\\coth(x)| -> \\coth(|x|)',
  '|\\csch(x)| -> \\csch(|x|)',
  '|\\arcsinh(x)| -> \\arcsinh(|x|)',
  '|\\artanh(x)| -> \\artanh(|x|)',
  '|\\arccoth(x)| -> \\arccoth(|x|)',
  '|\\arccsch(x)| -> \\arccsch(|x|)',

  //Negative Exponents in Denominator
  {
    match: '\\frac{a}{b^{-n}}',
    replace: 'a*b^n',
    condition: ({ _b }) => _b.isNotZero === true,
  }, // doesn't work but {match:'\\frac{a}{b^n}',replace:'a*b^{-n}',condition:ids=>ids._n.isNotZero===true} works
  {
    match: '\\frac{a}{d*b^{-n}}',
    replace: '\\frac{a}{d}*b^n',
    condition: (ids) => ids._b.isNotZero === true,
  }, // doesn't work but {match:'\\frac{a}{d*b^n}',replace:'\\frac{a}{d}*b^{-n}',condition:ids=>ids._n.isNotZero===true} works

  //Indeterminate Forms Involving Infinity
  { match: '0*x', replace: '0', condition: (_x) => _x._x.isFinite === true },
  { match: '1^x', replace: '1', condition: (_x) => _x._x.isFinite === true },
  {
    match: 'a^0',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._a.isInfinity === true,
  },

  //Infinity and Multiplication
  {
    match: '\\infty *x',
    replace: '\\infty',
    condition: (_x) => _x._x.isPositive === true,
  },
  {
    match: 'x*(-\\infty)',
    replace: '-\\infty',
    condition: (_x) => _x._x.isPositive === true,
  },
  {
    match: '\\infty * x',
    replace: '-\\infty',
    condition: (_x) => _x._x.isNegative === true,
  },
  {
    match: 'x*(-\\infty)',
    replace: '\\infty',
    condition: (_x) => _x._x.isNegative === true,
  },

  //Infinity and Division
  {
    match: '\\infty/x',
    replace: '\\infty',
    condition: (_x) => _x._x.isPositive === true && _x._x.isFinite === true,
  },
  {
    match: '(-\\infty)/x',
    replace: '-\\infty',
    condition: (_x) => _x._x.isPositive === true && _x._x.isFinite === true,
  },
  {
    match: '\\infty/x',
    replace: '-\\infty',
    condition: (_x) => _x._x.isNegative === true && _x._x.isFinite === true,
  },
  {
    match: '(-\\infty)/x',
    replace: '\\infty',
    condition: (_x) => _x._x.isNegative === true && _x._x.isFinite === true,
  },
  {
    match: 'x/y',
    replace: '\\operatorname{NaN}',
    condition: (_x) => _x._x.isInfinity === true && _x._y.isInfinity === true,
  },

  //Infinity and Powers (doesn't work for a=\\pi)
  {
    match: 'a^\\infty',
    replace: '\\infty',
    condition: (id) => id._a.isGreater(1) === true,
  },
  {
    match: 'a^\\infty',
    replace: '0',
    condition: (id) => id._a.isPositive === true && id._a.isLess(1) === true,
  },
  {
    match: '\\infty^a',
    replace: '0',
    condition: (id) => id._a.isNegative === true,
  },
  {
    match: '(-\\infty)^a',
    replace: '0',
    condition: (id) => id._a.isNegative === true,
  },
  {
    match: 'a^{-\\infty}',
    replace: '0',
    condition: (id) => id._a.isGreater(1) === true,
  },
  {
    match: 'a^{-\\infty}',
    replace: '\\infty',
    condition: (id) => id._a.isPositive === true && id._a.isLess(1) === true,
  },
  //This one works for \\pi
  // {match:'\\infty^a',replace:'\\infty',condition:id=>id._a.isPositive===true},

  //Logs and Infinity
  '\\ln(\\infty) -> \\infty',
  {
    match: '\\log_c(\\infty)',
    replace: '\\infty',
    condition: (id) => id._c.isGreater(1) === true,
  },
  {
    match: '\\log_c(\\infty)',
    replace: '-\\infty',
    condition: (id) => id._c.isLess(1) === true && id._c.isPositive === true,
  },
  {
    match: '\\log_\\infty(c)',
    replace: '0',
    condition: (id) =>
      id._c.isPositive === true &&
      id._c.isOne === false &&
      id._c.isFinite === true,
  },

  //Trig and Infinity
  {
    match: '\\sin(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\cos(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\tan(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\cot(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\sec(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\csc(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },

  //Inverse Trig and Infinity
  '\\arcsin(\\infty) -> \\operatorname{NaN}',
  '\\arccos(\\infty) -> \\operatorname{NaN}',
  '\\arcsin(-\\infty) -> \\operatorname{NaN}',
  '\\arccos(-\\infty) -> \\operatorname{NaN}',
  '\\arctan(\\infty) -> \\frac{\\pi}{2}',
  '\\arctan(-\\infty) -> -\\frac{\\pi}{2}',
  '\\arccot(\\infty) -> 0',
  '\\arccot(-\\infty) -> \\pi',
  '\\arcsec(\\infty) -> \\frac{\\pi}{2}',
  '\\arcsec(-\\infty) -> \\frac{\\pi}{2}',
  '\\arccsc(\\infty) -> 0',
  '\\arccsc(-\\infty) -> 0',

  //Hyperbolic Trig and Infinity
  '\\sinh(\\infty) -> \\infty',
  '\\sinh(-\\infty) -> -\\infty',
  '\\cosh(\\infty) -> \\infty',
  '\\cosh(-\\infty) -> \\infty',
  '\\tanh(\\infty) -> 1',
  '\\tanh(-\\infty) -> -1',
  '\\coth(\\infty) -> 1',
  '\\coth(-\\infty) -> -1',
  '\\sech(\\infty) -> 0',
  '\\sech(-\\infty) -> 0',
  '\\csch(\\infty) -> 0',
  '\\csch(-\\infty) -> 0',

  //Inverse Hyperbolic Trig and Infinity
  '\\arcsinh(\\infty) -> \\infty',
  '\\arcsinh(-\\infty) -> -\\infty',
  '\\arccosh(\\infty) -> \\infty',
  '\\arccosh(-\\infty) -> \\operatorname{NaN}',

  {
    match: '\\artanh(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\arccoth(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\arsech(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\arccsch(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },

  //----------- DOMAIN ISSUES -----------

  //Division
  { match: 'a/a', replace: '1', condition: (ids) => ids._a.isNotZero === true },
  {
    match: '1/(1/a)',
    replace: 'a',
    condition: (ids) => ids._a.isNotZero === true,
  },
  {
    match: 'a/(1/b)',
    replace: 'a*b',
    condition: (ids) => ids._b.isNotZero === true,
  },
  {
    match: 'a/(b/c)',
    replace: '(a*c)/b',
    condition: (ids) => ids._c.isNotZero === true,
  },
  { match: '0/a', replace: '0', condition: ({ _a }) => _a.isNotZero === true },

  //Powers
  {
    match: 'x^0',
    replace: '1',
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
    match: 'a/(b/c)^d',
    replace: 'a*(c/b)^d',
    condition: (ids) => ids._c.isNotZero === true,
  },
  {
    match: '(b/c)^{-d}',
    replace: '(c/b)^d',
    condition: (ids) => ids._c.isNotZero === true,
  },
  {
    match: '(b/c)^{-1}',
    replace: 'c/b',
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
  '\\sin(-x) -> -\\sin(x)',
  '\\cos(-x) -> \\cos(x)',
  '\\tan(-x) -> -\\tan(x)',
  '\\cot(-x) -> -\\cot(x)',
  '\\sec(-x) -> \\sec(x)',
  '\\csc(-x) -> -\\csc(x)',
  '\\sin(\\pi - x) -> \\sin(x)',
  '\\cos(\\pi - x) -> -\\cos(x)',
  '\\tan(\\pi - x) -> -\\tan(x)',
  '\\cot(\\pi - x) -> -\\cot(x)',
  '\\sec(\\pi - x) -> -\\sec(x)',
  '\\csc(\\pi - x) -> \\csc(x)',
  '\\sin(\\pi + x) -> -\\sin(x)',
  '\\cos(\\pi + x) -> -\\cos(x)',
  '\\tan(\\pi + x) -> \\tan(x)',
  '\\cot(\\pi + x) -> -\\cot(x)',
  '\\sec(\\pi + x) -> -\\sec(x)',
  '\\csc(\\pi + x) -> \\csc(x)',

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

  '\\sin(\\frac{\\pi}{2} - x) -> \\cos(x)',
  '\\cos(\\frac{\\pi}{2} - x) -> \\sin(x)',
  '\\tan(\\frac{\\pi}{2} - x) -> \\cot(x)',
  '\\cot(\\frac{\\pi}{2} - x) -> \\tan(x)',
  '\\sec(\\frac{\\pi}{2} - x) -> \\csc(x)',
  '\\csc(\\frac{\\pi}{2} - x) -> \\sec(x)',
  '\\sin(x) * \\cos(x) -> \\frac{1}{2} \\sin(2x)',
  '\\sin(x) * \\sin(y) -> \\frac{1}{2} (\\cos(x-y) - \\cos(x+y))',
  '\\cos(x) * \\cos(y) -> \\frac{1}{2} (\\cos(x-y) + \\cos(x+y))',
  '\\tan(x) * \\cot(x) -> 1',

  // Pythagorean identities - basic forms
  '\\sin(x)^2 + \\cos(x)^2 -> 1',
  '1 - \\sin(x)^2 -> \\cos(x)^2',
  '1 - \\cos(x)^2 -> \\sin(x)^2',
  '\\tan(x)^2 + 1 -> \\sec(x)^2',
  '1 + \\cot(x)^2 -> \\csc(x)^2',
  '\\sec(x)^2 - 1 -> \\tan(x)^2',
  '\\csc(x)^2 - 1 -> \\cot(x)^2',
  // Pythagorean identities - reversed subtraction forms
  '\\sin(x)^2 - 1 -> -\\cos(x)^2',
  '\\cos(x)^2 - 1 -> -\\sin(x)^2',
  '-1 + \\tan(x)^2 -> -\\cot(x)^2',
  '-1 + \\sec(x)^2 -> \\tan(x)^2',
  '-1 + \\csc(x)^2 -> \\cot(x)^2',
  // Pythagorean identities - negated forms
  '-\\sin(x)^2 - \\cos(x)^2 -> -1',
  // Pythagorean identities with coefficient
  'a * \\sin(x)^2 + a * \\cos(x)^2 -> a',

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
  expr = ce.function(expr.operator, [op1, op2]);

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
        ce.function(expr.operator, [expr.op1.sub(expr.op2), ce.Zero])
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
