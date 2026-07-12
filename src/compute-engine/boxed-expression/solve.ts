import { matchAnyRules, matchAnyRulesWithSteps } from './rules.js';
import { expand } from './expand.js';
import type {
  Expression,
  BoxedSubstitution,
  IComputeEngine as ComputeEngine,
  Rule,
  RuleSteps,
} from '../global-types.js';
import { isNumber, isFunction, isSymbol, numericValue } from './type-guards.js';
import { conditionalValue } from './conditional-value.js';
import {
  polynomialDegree,
  getPolynomialCoefficients,
  fromCoefficients,
} from './polynomials.js';
import { asSmallInteger } from './numerics.js';
import { realPolynomialRoots } from '../numerics/polynomial-roots.js';

function numericApproximation(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined || typeof value !== 'object')
    return undefined;

  if (
    'decimal' in value &&
    value.decimal !== null &&
    value.decimal !== undefined &&
    typeof value.decimal === 'object' &&
    'toNumber' in value.decimal &&
    typeof value.decimal.toNumber === 'function'
  ) {
    return value.decimal.toNumber();
  }

  if ('re' in value && typeof value.re === 'number') return value.re;

  return undefined;
}

//
// Solve Rules
//

// https://en.wikipedia.org/wiki/Equation_solving

//
// A collection of rules that find the roots of various expressions.
//
// `x` is the variable we are solving for.
// It is assumed that none of the matching wildcards contain `x`.
//
// @todo: MOAR RULES
// \sin x..., n \cos x + a
// a \sqrt{x} + b
// a \ln x + b
// polynomials...

function filter(sub: BoxedSubstitution): boolean {
  for (const [k, v] of Object.entries(sub)) {
    if (k !== 'x' && k !== '_x' && v.has('_x')) return false;
  }
  return true;
}

/**
 * The real machine value of `−b/a` (or `−b` when `a` is omitted) for a
 * rule-condition domain check, or `undefined` when the ratio is symbolic or
 * non-real. Rule conditions bind exact operands as `NumericValue` instances
 * (e.g. `ExactNumericValue` for `−2`), which a bare `typeof === 'number'`
 * check misses — that hole let out-of-domain ratios (`sin x = 2`) through,
 * silently relying on the roots later failing to numericize. Inverse
 * trig/hyperbolic functions now evaluate to complex values off their real
 * domain, so the emission-site guard must do the real work.
 */
function negatedRealRatio(b: Expression, a?: Expression): number | undefined {
  const ratio = a ? b.canonical.div(a.canonical).neg() : b.canonical.neg();
  const val = numericValue(ratio);
  if (val === undefined) return undefined;
  if (typeof val === 'number') return val;
  if (val.im !== 0) return undefined;
  return val.re;
}

/**
 * Producer-side chokepoint for a validity-guarded root (conditional-values
 * design, decision 7). Resolves a *decidable* guard against evaluation + the
 * assumption store:
 *   - guard evaluates to `True`  → the bare `root` (guard discharged);
 *   - guard evaluates to `False` → `null` (the caller drops the root — the
 *     solution-set pruning contract, decision 8);
 *   - otherwise (undecidable)    → `When(root, guard)`, retained until the
 *     guard becomes decidable.
 *
 * Numeric ratios therefore keep today's behavior exactly: the trig rules'
 * conditions already refuse to fire on a decidable-False ratio, so a numeric
 * ratio reaching here has a `True` guard and collapses to the bare root.
 *
 * Thin alias over the shared `conditionalValue` chokepoint
 * (`boxed-expression/conditional-value.ts`), which Sum/Integrate now also use.
 */
function conditionalRoot(
  ce: ComputeEngine,
  root: Expression,
  guard: Expression
): Expression | null {
  return conditionalValue(ce, root, guard);
}

//
// ── Solve trace ─────────────────────────────────────────────────────
//
// `expr.explain('solve')` threads an optional `RuleSteps` accumulator
// through `findUnivariateRoots` and its helpers. The trace is a pure
// observation channel: every recording is guarded on the accumulator being
// present, and recording never affects control flow or results — the plain
// `solve()` path passes no accumulator and allocates nothing.
//
// Step values are *equations*: the state of the equation after the step
// (`Equal(f, 0)` while solving, `Equal(x, root)` for candidate roots), so a
// student reads `2x+1=5` → `2x-4=0` → `x=2`.
//

/** Record one narrative step. `value` is the equation state after the step. */
function traceStep(
  trace: RuleSteps | undefined,
  because: string,
  value: Expression
): void {
  trace?.push({ value, because });
}

/** The equation `f = 0`, with any internal `_x` unknown displayed as `x`. */
function asEquation(f: Expression, x: string): Expression {
  const ce = f.engine;
  if (f.has('_x')) f = f.subs({ _x: ce.symbol(x) });
  return ce.function('Equal', [f, ce.Zero]);
}

/** The candidate roots as equations: `x = r` for a single root, a `List` of
 * `x = rᵢ` equations otherwise.
 * @internal exported for `expr.explain('solve')` (explain.ts) */
export function rootsAsEquations(
  ce: ComputeEngine,
  x: string,
  roots: ReadonlyArray<Expression>
): Expression {
  const eqs = roots.map((r) =>
    ce.function('Equal', [
      ce.symbol(x),
      r.has('_x') ? r.subs({ _x: ce.symbol(x) }) : r,
    ])
  );
  return eqs.length === 1 ? eqs[0] : ce.function('List', eqs);
}

export const UNIVARIATE_ROOTS: Rule[] = [
  // ax = 0
  {
    match: ['Multiply', '_x', '__a'],
    replace: 0,
    id: 'solve.linear-monomial',
    condition: filter,
  },

  // a/x + b = 0
  {
    match: ['Add', ['Divide', '_a', '_x'], '__b'],
    replace: Infinity,
    id: 'solve.reciprocal',
    useVariations: true, // Handle a/x = 0
    condition: filter,
  },

  // ax + b = 0
  {
    match: ['Add', ['Multiply', '_x', '__a'], '__b'],
    replace: ['Divide', ['Negate', '__b'], '__a'],
    id: 'solve.linear',
    useVariations: true, // Handle ax = 0
    condition: filter,
  },

  // -ax + b = 0  =>  x = b/a
  // This handles cases where the coefficient is negative and represented as Negate(Multiply(...))
  {
    match: ['Add', ['Negate', ['Multiply', '_x', '__a']], '__b'],
    replace: ['Divide', '__b', '__a'],
    id: 'solve.linear-negated',
    useVariations: true,
    condition: filter,
  },

  // ax^n + b = 0
  {
    match: ['Add', ['Multiply', '_a', ['Power', '_x', '_n']], '__b'],
    replace: [
      'Power',
      ['Divide', ['Negate', '__b'], '_a'],
      ['Divide', 1, '_n'],
    ],
    id: 'solve.power',
    useVariations: true,
    condition: (sub) => filter(sub) && !sub._n.isSame(0),
  },

  {
    match: ['Add', ['Multiply', '_a', ['Power', '_x', '_n']], '__b'],
    replace: [
      'Negate',
      ['Power', ['Divide', ['Negate', '__b'], '_a'], ['Divide', 1, '_n']],
    ],
    id: 'solve.power-negative-root',
    useVariations: true,
    condition: (sub: BoxedSubstitution) =>
      filter(sub) && !sub._n.isSame(0) && (sub._n.isEven ?? false),
  },

  //
  // Quadratic without constant: ax^2 + bx = 0
  // Factor: x(ax + b) = 0 → x = 0 or x = -b/a
  //
  {
    match: [
      'Add',
      ['Multiply', '__a', ['Power', '_x', 2]],
      ['Multiply', '__b', '_x'],
    ],
    replace: 0,
    id: 'solve.quadratic-no-constant-zero',
    useVariations: true,
    condition: filter,
  },
  {
    match: [
      'Add',
      ['Multiply', '__a', ['Power', '_x', 2]],
      ['Multiply', '__b', '_x'],
    ],
    replace: ['Divide', ['Negate', '__b'], '__a'],
    id: 'solve.quadratic-no-constant',
    useVariations: true,
    condition: filter,
  },

  //
  // Quadratic formula
  // ax^2 + bx + c = 0
  //

  {
    match: [
      'Add',
      ['Multiply', '__a', ['Power', '_x', 2]],
      ['Multiply', '__b', '_x'],
      '__c',
    ],
    replace: [
      'Divide',
      [
        'Add',
        ['Negate', '__b'],
        [
          'Sqrt',
          ['Subtract', ['Square', '__b'], ['Multiply', 4, '__a', '__c']],
        ],
      ],
      ['Multiply', 2, '__a'],
    ],
    id: 'solve.quadratic-formula-positive',
    useVariations: true,
    condition: filter,
  },

  {
    match: [
      'Add',
      ['Multiply', '__a', ['Power', '_x', 2]],
      ['Multiply', '__b', '_x'],
      '__c',
    ],
    replace: [
      'Divide',
      [
        'Subtract',
        ['Negate', '__b'],
        [
          'Sqrt',
          ['Subtract', ['Square', '__b'], ['Multiply', 4, '__a', '__c']],
        ],
      ],
      ['Multiply', 2, '__a'],
    ],
    id: 'solve.quadratic-formula-negative',
    useVariations: true,
    condition: filter,
  },

  // a^x + b = 0
  {
    match: ['Add', ['Power', '_a', '_x'], '__b'],
    replace: ['Ln', ['Negate', '__b'], '_a'],
    id: 'solve.exponential',
    useVariations: true,
    onBeforeMatch: () => {
      // debugger;
    },
    condition: (sub) =>
      filter(sub) &&
      (sub._a.isPositive ?? false) &&
      (sub.__b.isNegative ?? false),
  },

  // a * e^(bx) + c = 0
  {
    match: [
      'Add',
      ['Multiply', '__a', ['Exp', ['Multiply', '__b', '_x']]],
      '__c',
    ],
    replace: ['Divide', ['Ln', ['Negate', ['Divide', '__c', '__a']]], '__b'],
    id: 'solve.exponential-natural',
    useVariations: true,
    condition: (sub) =>
      filter(sub) &&
      // Captures of multiple operands are raw (unbound): canonicalize
      // before arithmetic, which asserts on non-canonical expressions
      ((!sub.__a.isSame(0) &&
        sub.__c.canonical.div(sub.__a.canonical).isNegative) ??
        false),
  },

  // a * e^(x) + c = 0
  {
    match: ['Add', ['Multiply', '__a', ['Exp', '_x']], '__c'],
    replace: ['Ln', ['Negate', ['Divide', '__c', '__a']]],
    id: 'solve.exponential-natural-unit-exponent',
    useVariations: true,
    condition: (sub) =>
      filter(sub) &&
      ((!sub.__a.isSame(0) &&
        sub.__c.canonical.div(sub.__a.canonical).isNegative) ??
        false) &&
      !sub.__a.has('_x') &&
      !sub.__c.has('_x'),
  },

  // e^(x) + c = 0
  {
    match: ['Add', ['Exp', '_x'], '__c'],
    replace: ['Ln', ['Negate', '__c']],
    id: 'solve.exponential-natural-simple',
    useVariations: true,
    condition: (sub) => filter(sub) && (sub.__c.isNegative ?? false),
  },

  // e^(bx) + c = 0
  {
    match: ['Add', ['Exp', ['Multiply', '__b', '_x']], '__c'],
    replace: ['Divide', ['Ln', ['Negate', '__c']], '__b'],
    id: 'solve.exponential-natural-unit-coefficient',
    useVariations: true,
    condition: (sub) => filter(sub) && (sub.__c.isNegative ?? false),
  },

  // a * log_b(x) + c = 0
  {
    match: ['Add', ['Multiply', '__a', ['Log', '_x', '__b']], '__c'],
    replace: ['Power', '__b', ['Negate', ['Divide', '__c', '__a']]],
    id: 'solve.logarithm-base',
    useVariations: true,
    condition: (sub) =>
      (filter(sub) && !sub.__a.isSame(0) && sub.__b.isPositive) ?? false,
  },

  // a * log_b(x) = 0
  {
    match: ['Multiply', '__a', ['Log', '_x', '__b']],
    replace: ['Power', '__b', ['Negate', ['Divide', '__c', '__a']]],
    id: 'solve.logarithm-base-no-constant',
    useVariations: true,
    condition: (sub) =>
      (filter(sub) && !sub.__a.isSame(0) && sub.__b.isPositive) ?? false,
  },

  // |ax + b| + c = 0  ⟹  |ax+b| = -c  ⟹  ax+b = c  or  ax+b = -c
  // ⟹  x = (c-b)/a  or  x = -(b+c)/a   (validateRoots drops the spurious
  // branch when -c < 0 and |ax+b| = -c has no solution).
  {
    match: ['Add', ['Abs', ['Add', ['Multiply', '__a', '_x'], '__b']], '__c'],
    replace: ['Divide', ['Subtract', '__c', '__b'], '__a'],
    id: 'solve.absolute-value-positive',
    condition: filter,
  },
  {
    match: ['Add', ['Abs', ['Add', ['Multiply', '__a', '_x'], '__b']], '__c'],
    replace: ['Divide', ['Negate', ['Add', '__b', '__c']], '__a'],
    id: 'solve.absolute-value-negative',
    condition: filter,
  },

  //
  // Square root equations: ax + b√x + c = 0
  // Using substitution u = √x, this becomes au² + bu + c = 0
  // Solving: u = (-b ± √(b² - 4ac)) / 2a
  // Then x = u² = ((-b ± √(b² - 4ac)) / 2a)²
  //

  // ax + b√x + c = 0 (plus root)
  {
    match: [
      'Add',
      ['Multiply', '_x', '__a'],
      ['Multiply', '__b', ['Sqrt', '_x']],
      '___c',
    ],
    replace: [
      'Power',
      [
        'Divide',
        [
          'Add',
          ['Negate', '__b'],
          [
            'Sqrt',
            ['Subtract', ['Square', '__b'], ['Multiply', 4, '__a', '___c']],
          ],
        ],
        ['Multiply', 2, '__a'],
      ],
      2,
    ],
    id: 'solve.quadratic-in-sqrt-positive',
    useVariations: true,
    condition: filter,
  },

  // ax + b√x + c = 0 (minus root)
  {
    match: [
      'Add',
      ['Multiply', '_x', '__a'],
      ['Multiply', '__b', ['Sqrt', '_x']],
      '___c',
    ],
    replace: [
      'Power',
      [
        'Divide',
        [
          'Subtract',
          ['Negate', '__b'],
          [
            'Sqrt',
            ['Subtract', ['Square', '__b'], ['Multiply', 4, '__a', '___c']],
          ],
        ],
        ['Multiply', 2, '__a'],
      ],
      2,
    ],
    id: 'solve.quadratic-in-sqrt-negative',
    useVariations: true,
    condition: filter,
  },

  // Handle negated coefficient: ax - b√x + c = 0
  // This handles the Negate(Multiply(...)) pattern
  {
    match: [
      'Add',
      ['Multiply', '_x', '__a'],
      ['Negate', ['Multiply', '__b', ['Sqrt', '_x']]],
      '___c',
    ],
    replace: [
      'Power',
      [
        'Divide',
        [
          'Add',
          '__b',
          ['Sqrt', ['Add', ['Square', '__b'], ['Multiply', 4, '__a', '___c']]],
        ],
        ['Multiply', 2, '__a'],
      ],
      2,
    ],
    id: 'solve.quadratic-in-sqrt-negated-positive',
    useVariations: true,
    condition: filter,
  },

  // ax - b√x + c = 0 (minus root)
  {
    match: [
      'Add',
      ['Multiply', '_x', '__a'],
      ['Negate', ['Multiply', '__b', ['Sqrt', '_x']]],
      '___c',
    ],
    replace: [
      'Power',
      [
        'Divide',
        [
          'Subtract',
          '__b',
          ['Sqrt', ['Add', ['Square', '__b'], ['Multiply', 4, '__a', '___c']]],
        ],
        ['Multiply', 2, '__a'],
      ],
      2,
    ],
    id: 'solve.quadratic-in-sqrt-negated-negative',
    useVariations: true,
    condition: filter,
  },

  //
  // Additional solve rules
  //

  // a√x + b = 0  =>  x = (b/a)² (only valid when -b/a ≥ 0)
  {
    match: ['Add', ['Multiply', '__a', ['Sqrt', '_x']], '__b'],
    replace: ['Square', ['Divide', ['Negate', '__b'], '__a']],
    id: 'solve.radical',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      // Check that -b/a >= 0 for the solution to be valid
      const a = sub.__a;
      const b = sub.__b;
      if (!a || !b) return false;
      const ratio = b.canonical.div(a.canonical);
      return ratio.isNonPositive ?? true; // Allow if we can't determine sign
    },
  },

  // a·ln(x) + b = 0  =>  x = e^(-b/a)
  {
    match: ['Add', ['Multiply', '__a', ['Ln', '_x']], '__b'],
    replace: ['Exp', ['Divide', ['Negate', '__b'], '__a']],
    id: 'solve.logarithm-natural-scaled',
    useVariations: true,
    condition: filter,
  },

  // ln(x) + b = 0  =>  x = e^(-b)
  {
    match: ['Add', ['Ln', '_x'], '__b'],
    replace: ['Exp', ['Negate', '__b']],
    id: 'solve.logarithm-natural',
    useVariations: true,
    condition: filter,
  },

  //
  // Trigonometric equations
  //
  // Note: These return principal values only. For general solutions,
  // add 2πn for sin/cos or πn for tan (where n ∈ ℤ).
  //

  // a·sin(x) + b = 0  =>  x = arcsin(-b/a)
  // Valid when -1 ≤ -b/a ≤ 1
  {
    match: ['Add', ['Multiply', '__a', ['Sin', '_x']], '__b'],
    replace: [
      'When',
      ['Arcsin', ['Divide', ['Negate', '__b'], '__a']],
      ['LessEqual', ['Abs', ['Divide', ['Negate', '__b'], '__a']], 1],
    ],
    id: 'solve.sine',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      // Check that -b/a is in [-1, 1] for real solutions
      const a = sub.__a;
      const b = sub.__b;
      if (!a || a.isSame(0)) return false;
      const v = negatedRealRatio(b, a);
      if (v === undefined) return true; // Allow symbolic ratios
      return Math.abs(v) <= 1;
    },
  },

  // Second solution for sin: x = π - arcsin(-b/a)
  {
    match: ['Add', ['Multiply', '__a', ['Sin', '_x']], '__b'],
    replace: [
      'When',
      ['Subtract', 'Pi', ['Arcsin', ['Divide', ['Negate', '__b'], '__a']]],
      ['LessEqual', ['Abs', ['Divide', ['Negate', '__b'], '__a']], 1],
    ],
    id: 'solve.sine-second-branch',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const a = sub.__a;
      const b = sub.__b;
      if (!a || a.isSame(0)) return false;
      const v = negatedRealRatio(b, a);
      if (v === undefined) return true; // Allow symbolic ratios
      return Math.abs(v) <= 1;
    },
  },

  // sin(x) + b = 0  =>  x = arcsin(-b)  (when a = 1)
  {
    match: ['Add', ['Sin', '_x'], '__b'],
    replace: [
      'When',
      ['Arcsin', ['Negate', '__b']],
      ['LessEqual', ['Abs', ['Negate', '__b']], 1],
    ],
    id: 'solve.sine-unit',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const b = sub.__b;
      const v = negatedRealRatio(b);
      if (v === undefined) return true; // Allow symbolic ratios
      return Math.abs(v) <= 1;
    },
  },

  // Second solution for sin(x) + b = 0: x = π - arcsin(-b)
  {
    match: ['Add', ['Sin', '_x'], '__b'],
    replace: [
      'When',
      ['Subtract', 'Pi', ['Arcsin', ['Negate', '__b']]],
      ['LessEqual', ['Abs', ['Negate', '__b']], 1],
    ],
    id: 'solve.sine-unit-second-branch',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const b = sub.__b;
      const v = negatedRealRatio(b);
      if (v === undefined) return true; // Allow symbolic ratios
      return Math.abs(v) <= 1;
    },
  },

  // a·cos(x) + b = 0  =>  x = arccos(-b/a)
  // Valid when -1 ≤ -b/a ≤ 1
  {
    match: ['Add', ['Multiply', '__a', ['Cos', '_x']], '__b'],
    replace: [
      'When',
      ['Arccos', ['Divide', ['Negate', '__b'], '__a']],
      ['LessEqual', ['Abs', ['Divide', ['Negate', '__b'], '__a']], 1],
    ],
    id: 'solve.cosine',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const a = sub.__a;
      const b = sub.__b;
      if (!a || a.isSame(0)) return false;
      const v = negatedRealRatio(b, a);
      if (v === undefined) return true; // Allow symbolic ratios
      return Math.abs(v) <= 1;
    },
  },

  // Second solution for cos: x = -arccos(-b/a)  (since cos(-x) = cos(x))
  {
    match: ['Add', ['Multiply', '__a', ['Cos', '_x']], '__b'],
    replace: [
      'When',
      ['Negate', ['Arccos', ['Divide', ['Negate', '__b'], '__a']]],
      ['LessEqual', ['Abs', ['Divide', ['Negate', '__b'], '__a']], 1],
    ],
    id: 'solve.cosine-negative-branch',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const a = sub.__a;
      const b = sub.__b;
      if (!a || a.isSame(0)) return false;
      const v = negatedRealRatio(b, a);
      if (v === undefined) return true; // Allow symbolic ratios
      return Math.abs(v) <= 1;
    },
  },

  // cos(x) + b = 0  =>  x = arccos(-b)  (when a = 1)
  {
    match: ['Add', ['Cos', '_x'], '__b'],
    replace: [
      'When',
      ['Arccos', ['Negate', '__b']],
      ['LessEqual', ['Abs', ['Negate', '__b']], 1],
    ],
    id: 'solve.cosine-unit',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const b = sub.__b;
      const v = negatedRealRatio(b);
      if (v === undefined) return true; // Allow symbolic ratios
      return Math.abs(v) <= 1;
    },
  },

  // Second solution for cos(x) + b = 0: x = -arccos(-b)
  {
    match: ['Add', ['Cos', '_x'], '__b'],
    replace: [
      'When',
      ['Negate', ['Arccos', ['Negate', '__b']]],
      ['LessEqual', ['Abs', ['Negate', '__b']], 1],
    ],
    id: 'solve.cosine-unit-negative-branch',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const b = sub.__b;
      const v = negatedRealRatio(b);
      if (v === undefined) return true; // Allow symbolic ratios
      return Math.abs(v) <= 1;
    },
  },

  // a·tan(x) + b = 0  =>  x = arctan(-b/a)
  // Tan has no domain restriction for the ratio
  {
    match: ['Add', ['Multiply', '__a', ['Tan', '_x']], '__b'],
    replace: ['Arctan', ['Divide', ['Negate', '__b'], '__a']],
    id: 'solve.tangent',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      return !sub.__a.isSame(0);
    },
  },

  // tan(x) + b = 0  =>  x = arctan(-b)  (when a = 1)
  {
    match: ['Add', ['Tan', '_x'], '__b'],
    replace: ['Arctan', ['Negate', '__b']],
    id: 'solve.tangent-unit',
    useVariations: true,
    condition: filter,
  },

  // a·cot(x) + b = 0  =>  x = arccot(-b/a)
  {
    match: ['Add', ['Multiply', '__a', ['Cot', '_x']], '__b'],
    replace: ['Arccot', ['Divide', ['Negate', '__b'], '__a']],
    id: 'solve.cotangent',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      return !sub.__a.isSame(0);
    },
  },

  // cot(x) + b = 0  =>  x = arccot(-b)
  {
    match: ['Add', ['Cot', '_x'], '__b'],
    replace: ['Arccot', ['Negate', '__b']],
    id: 'solve.cotangent-unit',
    useVariations: true,
    condition: filter,
  },

  //
  // Inverse trigonometric equations
  //
  // arcsin, arccos and arctan are injective on their domains, so there is a
  // single solution branch (no π-companion). Any candidate outside the target
  // function's range is dropped by `validateRoots` against the original
  // equation. The scaled shapes are needed because `clearDenominators` rewrites
  // e.g. `arcsin x − 1/3 = 0` into `3·arcsin x − 1 = 0` before matching.
  //

  // a·arcsin(x) + b = 0  =>  x = sin(-b/a)
  {
    match: ['Add', ['Multiply', '__a', ['Arcsin', '_x']], '__b'],
    replace: ['Sin', ['Divide', ['Negate', '__b'], '__a']],
    id: 'solve.arcsine',
    useVariations: true,
    condition: (sub) => filter(sub) && !sub.__a.isSame(0),
  },

  // arcsin(x) + b = 0  =>  x = sin(-b)
  {
    match: ['Add', ['Arcsin', '_x'], '__b'],
    replace: ['Sin', ['Negate', '__b']],
    id: 'solve.arcsine-unit',
    useVariations: true,
    condition: filter,
  },

  // a·arccos(x) + b = 0  =>  x = cos(-b/a)
  {
    match: ['Add', ['Multiply', '__a', ['Arccos', '_x']], '__b'],
    replace: ['Cos', ['Divide', ['Negate', '__b'], '__a']],
    id: 'solve.arccosine',
    useVariations: true,
    condition: (sub) => filter(sub) && !sub.__a.isSame(0),
  },

  // arccos(x) + b = 0  =>  x = cos(-b)
  {
    match: ['Add', ['Arccos', '_x'], '__b'],
    replace: ['Cos', ['Negate', '__b']],
    id: 'solve.arccosine-unit',
    useVariations: true,
    condition: filter,
  },

  // a·arctan(x) + b = 0  =>  x = tan(-b/a)
  {
    match: ['Add', ['Multiply', '__a', ['Arctan', '_x']], '__b'],
    replace: ['Tan', ['Divide', ['Negate', '__b'], '__a']],
    id: 'solve.arctangent',
    useVariations: true,
    condition: (sub) => filter(sub) && !sub.__a.isSame(0),
  },

  // arctan(x) + b = 0  =>  x = tan(-b)
  {
    match: ['Add', ['Arctan', '_x'], '__b'],
    replace: ['Tan', ['Negate', '__b']],
    id: 'solve.arctangent-unit',
    useVariations: true,
    condition: filter,
  },

  //
  // Hyperbolic equations
  //
  // sinh and tanh are bijective (tanh onto (−1, 1); out-of-range candidates
  // are dropped by `validateRoots`), so a single branch each. cosh is even, so
  // it needs both ±arcosh branches for a complete finite solution set.
  //

  // a·sinh(x) + b = 0  =>  x = arsinh(-b/a)
  {
    match: ['Add', ['Multiply', '__a', ['Sinh', '_x']], '__b'],
    replace: ['Arsinh', ['Divide', ['Negate', '__b'], '__a']],
    id: 'solve.hyperbolic-sine',
    useVariations: true,
    condition: (sub) => filter(sub) && !sub.__a.isSame(0),
  },

  // sinh(x) + b = 0  =>  x = arsinh(-b)
  {
    match: ['Add', ['Sinh', '_x'], '__b'],
    replace: ['Arsinh', ['Negate', '__b']],
    id: 'solve.hyperbolic-sine-unit',
    useVariations: true,
    condition: filter,
  },

  // a·cosh(x) + b = 0  =>  x = arcosh(-b/a)  (positive branch)
  // Valid when -b/a ≥ 1 (the range of cosh over the reals)
  {
    match: ['Add', ['Multiply', '__a', ['Cosh', '_x']], '__b'],
    replace: [
      'When',
      ['Arcosh', ['Divide', ['Negate', '__b'], '__a']],
      ['GreaterEqual', ['Divide', ['Negate', '__b'], '__a'], 1],
    ],
    id: 'solve.hyperbolic-cosine',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub) || sub.__a.isSame(0)) return false;
      const v = negatedRealRatio(sub.__b, sub.__a);
      if (v === undefined) return true; // Allow symbolic ratios
      return v >= 1;
    },
  },

  // Second solution for cosh: x = -arcosh(-b/a)  (since cosh(-x) = cosh(x))
  {
    match: ['Add', ['Multiply', '__a', ['Cosh', '_x']], '__b'],
    replace: [
      'When',
      ['Negate', ['Arcosh', ['Divide', ['Negate', '__b'], '__a']]],
      ['GreaterEqual', ['Divide', ['Negate', '__b'], '__a'], 1],
    ],
    id: 'solve.hyperbolic-cosine-negative-branch',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub) || sub.__a.isSame(0)) return false;
      const v = negatedRealRatio(sub.__b, sub.__a);
      if (v === undefined) return true; // Allow symbolic ratios
      return v >= 1;
    },
  },

  // cosh(x) + b = 0  =>  x = arcosh(-b)  (positive branch)
  // Valid when -b ≥ 1 (the range of cosh over the reals)
  {
    match: ['Add', ['Cosh', '_x'], '__b'],
    replace: [
      'When',
      ['Arcosh', ['Negate', '__b']],
      ['GreaterEqual', ['Negate', '__b'], 1],
    ],
    id: 'solve.hyperbolic-cosine-unit',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const v = negatedRealRatio(sub.__b);
      if (v === undefined) return true; // Allow symbolic ratios
      return v >= 1;
    },
  },

  // Second solution for cosh(x) + b = 0: x = -arcosh(-b)
  {
    match: ['Add', ['Cosh', '_x'], '__b'],
    replace: [
      'When',
      ['Negate', ['Arcosh', ['Negate', '__b']]],
      ['GreaterEqual', ['Negate', '__b'], 1],
    ],
    id: 'solve.hyperbolic-cosine-unit-negative-branch',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const v = negatedRealRatio(sub.__b);
      if (v === undefined) return true; // Allow symbolic ratios
      return v >= 1;
    },
  },

  // a·tanh(x) + b = 0  =>  x = artanh(-b/a)
  // Valid when -1 < -b/a < 1 (the range of tanh over the reals; at ±1 the
  // "root" would be the ±∞ pole, not a solution)
  {
    match: ['Add', ['Multiply', '__a', ['Tanh', '_x']], '__b'],
    replace: [
      'When',
      ['Artanh', ['Divide', ['Negate', '__b'], '__a']],
      ['Less', ['Abs', ['Divide', ['Negate', '__b'], '__a']], 1],
    ],
    id: 'solve.hyperbolic-tangent',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub) || sub.__a.isSame(0)) return false;
      const v = negatedRealRatio(sub.__b, sub.__a);
      if (v === undefined) return true; // Allow symbolic ratios
      return Math.abs(v) < 1;
    },
  },

  // tanh(x) + b = 0  =>  x = artanh(-b)
  {
    match: ['Add', ['Tanh', '_x'], '__b'],
    replace: [
      'When',
      ['Artanh', ['Negate', '__b']],
      ['Less', ['Abs', ['Negate', '__b']], 1],
    ],
    id: 'solve.hyperbolic-tangent-unit',
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const v = negatedRealRatio(sub.__b);
      if (v === undefined) return true; // Allow symbolic ratios
      return Math.abs(v) < 1;
    },
  },

  // a·sin(x) + b·cos(x) = 0  =>  tan(x) = -b/a  =>  x = arctan(-b/a)
  // Handles e.g. sin(x) = cos(x) (a = 1, b = -1 → arctan(1) = π/4). The two
  // standalone sin/cos rules above don't fire here because their constant term
  // `__b` would capture the other trig term, which contains `_x` (rejected by
  // `filter`).
  {
    match: [
      'Add',
      ['Multiply', '__a', ['Sin', '_x']],
      ['Multiply', '__b', ['Cos', '_x']],
    ],
    replace: ['Arctan', ['Divide', ['Negate', '__b'], '__a']],
    id: 'solve.sine-cosine-linear-combination',
    useVariations: true,
    condition: (sub) => filter(sub) && !sub.__a.isSame(0),
  },
];

/**
 * Clear *symbolic* denominators from an Add expression by multiplying through
 * by the LCM of those denominators. For example, `F - 3x/h` becomes `F*h - 3x`.
 *
 * This transformation preserves the roots of the equation (assuming denominators
 * are non-zero) and allows the solve rules to match expressions that would
 * otherwise have nested Divide operators.
 *
 * Also handles the case where the variable is in the denominator (e.g., `a/x - b`
 * becomes `a - bx` after multiplying by x).
 *
 * Exact **numeric-literal** denominators (integer/rational constants, e.g. the
 * `10` in `1/10`) are deliberately NOT cleared: rational coefficients are
 * already handled natively by the solve templates (leading-coefficient
 * wildcards + `useVariations`) and the polynomial machinery, so rescaling by a
 * pure number buys nothing — and it would flatten the product-inner LambertW
 * shape `Add(Multiply(_x, Exp(_x)), __b)` (scaling `x·eˣ + 1/10` to
 * `10·x·eˣ + 1` collapses the two products into one commutative Multiply the
 * matcher can't invert). Symbolic denominators (`h`, `x+2`, `x`, …) keep the
 * original behavior exactly.
 */
function clearDenominators(expr: Expression, _variable?: string): Expression {
  if (!isFunction(expr, 'Add')) return expr;

  const ops = expr.ops;
  if (ops.length === 0) return expr;

  // Collect all non-trivial denominators. A denominator of the form `1^a`
  // is trivially 1 (e.g. `.denominator` of `e^x` is `1^x`): multiplying
  // through by it would needlessly mangle the expression (e.g. `e^x - 5`
  // would become `1^x e^x - 5·1^x`, which no root template matches).
  // Exact numeric-literal denominators are skipped (see the doc comment).
  const denominators = ops
    .map((op) => op.denominator)
    .filter(
      (d) =>
        !d.isSame(1) &&
        !(isFunction(d, 'Power') && d.op1.isSame(1)) &&
        !(isNumber(d) && d.isExact)
    );

  if (denominators.length === 0) return expr;

  // Build LCM by collecting unique denominator factors
  // This avoids multiplying by the same factor twice
  const lcmFactors: Expression[] = [];

  for (const denom of denominators) {
    // Check if this denominator (or an equivalent) is already in our factors
    let isDuplicate = false;
    for (const existing of lcmFactors) {
      // Check if they're the same expression
      if (denom.isSame(existing)) {
        isDuplicate = true;
        break;
      }
      // Check if one is a symbol and the other contains it (partial match)
      // This handles cases like h and h appearing multiple times
      if (
        isSymbol(denom) &&
        isSymbol(existing) &&
        denom.symbol === existing.symbol
      ) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      lcmFactors.push(denom);
    }
  }

  // Compute the LCM as the product of unique factors
  let lcm = lcmFactors[0];
  for (let i = 1; i < lcmFactors.length; i++) {
    lcm = lcm.mul(lcmFactors[i]);
  }

  // Multiply each term by the LCM individually and simplify. Multiplying the
  // whole Add at once distributes the LCM into each term and expands the
  // numerator (e.g. `2x·(x+2)` → `2x²+4x`), which then fails to cancel against
  // the denominator during simplify. Per-term multiplication lets each
  // `p(x)/q(x) · lcm` cancel cleanly (e.g. `2x/(x+2) − 1` → `x − 2`).
  const clearedOps = ops.map((op) => op.mul(lcm).simplify());
  return expr.engine.function('Add', clearedOps).simplify();
}

/**
 * Transform sqrt equations of the form √(f(x)) = g(x) into polynomial form.
 *
 * Pattern 2: √(ax+b) = cx+d
 * - Squaring both sides: ax+b = (cx+d)²
 * - Expanding: ax+b = c²x² + 2cdx + d²
 * - Rearranging: c²x² + (2cd-a)x + (d²-b) = 0
 *
 * This handles equations like:
 * - √(x+1) = x        → x² - x - 1 = 0
 * - √(2x+3) = x - 1   → x² - 4x - 2 = 0
 * - √x = x - 2        → x² - 5x + 4 = 0
 *
 * Returns the transformed expression if a sqrt-linear pattern is found,
 * otherwise returns the original expression unchanged.
 *
 * Note: Squaring can introduce extraneous roots. The caller should validate
 * roots against the original equation using validateRoots().
 */
function transformSqrtLinearEquation(
  expr: Expression,
  variable: string
): Expression {
  if (!isFunction(expr, 'Add')) return expr;

  const ce = expr.engine;
  const ops = expr.ops;
  if (ops.length === 0) return expr;

  // Find the sqrt term(s) in the expression
  let sqrtTerm: Expression | null = null;
  let sqrtIndex = -1;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    // Check for Sqrt(...)
    if (op.operator === 'Sqrt') {
      sqrtTerm = op;
      sqrtIndex = i;
      break;
    }
    // Check for coefficient * Sqrt(...) like 2*sqrt(x)
    if (isFunction(op, 'Multiply')) {
      for (const factor of op.ops) {
        if (factor.operator === 'Sqrt') {
          // This is a more complex case (a*√f(x) + g(x) = 0)
          // For now, only handle the simple case √f(x) + g(x) = 0
          // The coefficient case is already handled by existing rules
          break;
        }
      }
    }
  }

  // No sqrt term found
  if (!sqrtTerm || sqrtIndex < 0) return expr;

  // Get the argument inside the sqrt
  if (!isFunction(sqrtTerm)) return expr;
  const sqrtArg = sqrtTerm.op1;
  if (!sqrtArg) return expr;

  // Check if the sqrt argument contains the variable
  if (!sqrtArg.has(variable)) return expr;

  // Collect all non-sqrt terms: these form g(x) where √f(x) + g(x) = 0
  // So √f(x) = -g(x), and we square to get f(x) = g(x)²
  const nonSqrtTerms = ops.filter((_, i) => i !== sqrtIndex);

  if (nonSqrtTerms.length === 0) return expr;

  // g(x) = -(sum of non-sqrt terms), since √f(x) + g(x) = 0 means √f(x) = -g(x)
  let gExpr: Expression;
  if (nonSqrtTerms.length === 1) {
    gExpr = nonSqrtTerms[0].neg();
  } else {
    gExpr = ce.function('Add', nonSqrtTerms).neg();
  }

  // Check that g(x) is linear or polynomial in the variable
  // (We want to avoid cases where g(x) itself contains sqrt terms)
  if (gExpr.has('Sqrt')) return expr;

  // Transform: √f(x) = -g(x) becomes f(x) = g(x)²
  // So the new equation is: f(x) - g(x)² = 0
  const gSquared = gExpr.mul(gExpr);
  const transformed = sqrtArg.sub(gSquared).simplify();

  return transformed;
}

/**
 * Eliminate a single square root with an arbitrary (possibly non-constant)
 * coefficient. Writes the equation `expr = 0` as `A(x)·√R(x) + B(x) = 0` — where
 * `√R` is the unique x-dependent square root — and squares the isolated radical
 * to the sqrt-free equation `A(x)²·R(x) − B(x)² = 0`.
 *
 * This generalizes `transformSqrtLinearEquation` (which only handles a bare
 * `√f + g`) to forms like `x·√(x²+1) − 1 = 0 → x²(x²+1) − 1 = 0`. Squaring can
 * introduce extraneous roots; those are removed by `validateRoots()` against the
 * original equation.
 *
 * Returns the roots of the resulting sqrt-free equation (to be validated by the
 * caller against the original), or `null` when `expr` does not contain exactly
 * one distinct x-dependent square root, contains another radical of x, or is not
 * a polynomial in that root.
 */
function solveSingleSqrtEquation(
  expr: Expression,
  variable: string,
  trace?: RuleSteps
): ReadonlyArray<Expression> | null {
  const ce = expr.engine;

  // Collect the distinct x-dependent radicals. Bail on anything other than a
  // single `Sqrt` (a second sqrt is the two-sqrt case; `Root` is unhandled).
  const sqrtKeys = new Set<string>();
  let sqrtTerm: Expression | undefined;
  let radicand: Expression | undefined;
  let otherRadical = false;
  const scan = (node: Expression): void => {
    if (!node.has(variable)) return;
    if (isFunction(node, 'Sqrt')) {
      const key = node.toString();
      if (!sqrtKeys.has(key)) {
        sqrtKeys.add(key);
        sqrtTerm = node;
        radicand = node.op1;
      }
      return; // the radicand's inner variable is fine — don't recurse
    }
    if (isFunction(node, 'Root')) {
      otherRadical = true;
      return;
    }
    if (isFunction(node)) for (const op of node.ops!) scan(op);
  };
  scan(expr);
  if (
    otherRadical ||
    sqrtKeys.size !== 1 ||
    sqrtTerm === undefined ||
    radicand === undefined
  )
    return null;

  // Substitute a fresh symbol t for √R, then read off the polynomial in t.
  const tName = ['t', 'u', 'w', 's', 'v', 'y', 'z'].find(
    (n) => n !== variable && !expr.unknowns.includes(n)
  );
  if (tName === undefined) return null;
  const t = ce.symbol(tName);

  const sqrtTermNode: Expression = sqrtTerm;
  const substitute = (node: Expression): Expression => {
    if (node.isSame(sqrtTermNode)) return t;
    if (isFunction(node))
      return ce.function(node.operator, node.ops!.map(substitute));
    return node;
  };
  const exprT = substitute(expr);
  const coeffs = getPolynomialCoefficients(exprT, tName);
  if (coeffs === null) return null;

  // Split into the part multiplying √R (odd powers of t) and the rest (even
  // powers), reducing t² → R: A = Σ c_{2k+1}·Rᵏ, B = Σ c_{2k}·Rᵏ.
  let a: Expression = ce.Zero;
  let b: Expression = ce.Zero;
  let rPow: Expression = ce.One; // Rᵏ
  for (let k = 0; 2 * k < coeffs.length; k++) {
    b = b.add(coeffs[2 * k].mul(rPow));
    if (2 * k + 1 < coeffs.length) a = a.add(coeffs[2 * k + 1].mul(rPow));
    rPow = rPow.mul(radicand);
  }

  // A·√R + B = 0  ⟹  A²·R = B²  ⟹  A²·R − B² = 0
  const squared = a.mul(a).mul(radicand).sub(b.mul(b));
  if (squared.has(tName)) return null; // safety: substitution incomplete
  if (squared.has(variable) === false) return null;
  // Solve the sqrt-free polynomial; extraneous roots from squaring are removed
  // by the caller's validation against the original equation.
  const sqrtFree = squared.simplify();
  traceStep(trace, 'solve.square-both-sides', asEquation(sqrtFree, variable));
  return findUnivariateRoots(sqrtFree, variable);
}

/**
 * Detect and solve equations with two sqrt terms: √(f(x)) + √(g(x)) = e
 *
 * Pattern 3: √(ax + b) + √(cx + d) = e
 * Algorithm (double squaring):
 * 1. Isolate one sqrt: √(f(x)) = e - √(g(x))
 * 2. Square: f(x) = e² - 2e√(g(x)) + g(x)
 * 3. Isolate remaining sqrt: f(x) - e² - g(x) = -2e√(g(x))
 * 4. Square again: (f(x) - e² - g(x))² = 4e²·g(x)
 * 5. Expand: polynomial equation in x
 * 6. Solve and validate roots against original equation
 *
 * Returns solutions for x, or null if pattern not detected.
 */
function solveTwoSqrtEquation(
  expr: Expression,
  variable: string,
  trace?: RuleSteps
): Expression[] | null {
  if (!isFunction(expr, 'Add')) return null;

  const ce = expr.engine;
  const ops = expr.ops;
  if (ops.length < 2) return null;

  // Find all sqrt terms in the expression
  const sqrtTerms: {
    term: Expression;
    arg: Expression;
    index: number;
  }[] = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];

    // Check for Sqrt(...)
    if (isFunction(op, 'Sqrt') && op.op1) {
      sqrtTerms.push({ term: op, arg: op.op1, index: i });
      continue;
    }

    // Check for Negate(Sqrt(...))
    if (
      isFunction(op, 'Negate') &&
      isFunction(op.op1) &&
      op.op1.operator === 'Sqrt' &&
      isFunction(op.op1) &&
      op.op1.op1
    ) {
      sqrtTerms.push({ term: op, arg: op.op1.op1, index: i });
      continue;
    }

    // Check for coefficient * Sqrt(...)
    if (isFunction(op, 'Multiply')) {
      for (const factor of op.ops) {
        if (isFunction(factor, 'Sqrt') && factor.op1) {
          sqrtTerms.push({ term: op, arg: factor.op1, index: i });
          break;
        }
      }
    }
  }

  // Need exactly 2 sqrt terms for this pattern
  if (sqrtTerms.length !== 2) return null;

  // Both sqrt args must contain the variable
  if (!sqrtTerms[0].arg.has(variable) || !sqrtTerms[1].arg.has(variable)) {
    return null;
  }

  // Collect non-sqrt terms (the constant e, possibly negated)
  const sqrtIndices = new Set(sqrtTerms.map((s) => s.index));
  const nonSqrtTerms = ops.filter((_, i) => !sqrtIndices.has(i));

  // The constant term e (from √f + √g + (-e) = 0, so e = -(non-sqrt terms))
  let eExpr: Expression;
  if (nonSqrtTerms.length === 0) {
    // √f + √g = 0 case - only works if both are 0
    return null;
  } else if (nonSqrtTerms.length === 1) {
    eExpr = nonSqrtTerms[0].neg();
  } else {
    eExpr = ce.function('Add', nonSqrtTerms).neg();
  }

  // e should be a constant (not contain the variable)
  if (eExpr.has(variable)) return null;

  // Get f(x) and g(x) from the sqrt arguments
  const fExpr = sqrtTerms[0].arg;
  const gExpr = sqrtTerms[1].arg;

  // Check that the sqrt terms are simple (coefficient 1 or -1)
  // For now, handle: √f + √g = e or √f - √g = e or -√f + √g = e
  let fSign = 1;
  let gSign = 1;

  if (sqrtTerms[0].term.operator === 'Negate') fSign = -1;
  if (isFunction(sqrtTerms[0].term, 'Multiply')) {
    // Check if coefficient is negative
    const coef = sqrtTerms[0].term.ops.find((o) => o.operator !== 'Sqrt');
    if (coef?.isNegative) fSign = -1;
    // For now, only handle coefficient ±1
    const absCoefExpr = coef?.abs().N();
    const absCoef = isNumber(absCoefExpr)
      ? absCoefExpr.numericValue
      : undefined;
    if (absCoef !== 1 && absCoef !== undefined) return null;
  }

  if (sqrtTerms[1].term.operator === 'Negate') gSign = -1;
  if (isFunction(sqrtTerms[1].term, 'Multiply')) {
    const coef = sqrtTerms[1].term.ops.find((o) => o.operator !== 'Sqrt');
    if (coef?.isNegative) gSign = -1;
    const absCoefExpr = coef?.abs().N();
    const absCoef = isNumber(absCoefExpr)
      ? absCoefExpr.numericValue
      : undefined;
    if (absCoef !== 1 && absCoef !== undefined) return null;
  }

  // We have: fSign·√f + gSign·√g = e
  // Rearrange to isolate one sqrt: fSign·√f = e - gSign·√g
  // For simplicity, assume fSign = 1: √f = e - gSign·√g

  if (fSign !== 1) {
    // Swap f and g to get the positive one on the left
    if (gSign === 1) {
      // Use g on the left: √g = e - fSign·√f
      // For now, just swap the variables
      return solveTwoSqrtEquationCore(
        ce,
        gExpr,
        fExpr,
        eExpr,
        fSign,
        variable,
        trace
      );
    }
    // Both negative: -√f - √g = e, i.e., √f + √g = -e
    // This only has solutions if -e ≥ 0 and both sqrts can equal parts of it
    return null;
  }

  return solveTwoSqrtEquationCore(
    ce,
    fExpr,
    gExpr,
    eExpr,
    gSign,
    variable,
    trace
  );
}

/**
 * Core solver for √f = e - sign·√g (after isolating one sqrt)
 */
function solveTwoSqrtEquationCore(
  ce: ComputeEngine,
  fExpr: Expression,
  gExpr: Expression,
  eExpr: Expression,
  gSign: number,
  variable: string,
  trace?: RuleSteps
): Expression[] | null {
  // We have: √f = e - gSign·√g
  // Square both sides: f = e² - 2·e·gSign·√g + g
  // Rearrange: f - e² - g = -2·e·gSign·√g
  // Square again: (f - e² - g)² = 4·e²·g

  const eSquared = eExpr.mul(eExpr);

  // Left side after first squaring and rearranging: f - e² - g
  const leftSide = fExpr.sub(eSquared).sub(gExpr).simplify();

  // Right side: 4·e²·g
  const four = ce.number(4);
  const rightSide = four.mul(eSquared).mul(gExpr).simplify();

  // Square the left side: (f - e² - g)²
  const leftSquared = leftSide.mul(leftSide).simplify();

  // Final equation: (f - e² - g)² - 4·e²·g = 0
  const finalEquation = leftSquared.sub(rightSide).simplify();
  traceStep(
    trace,
    'solve.square-both-sides',
    asEquation(finalEquation, variable)
  );

  // Solve the polynomial equation
  const solutions = findUnivariateRoots(finalEquation, variable);

  if (solutions.length === 0) return null;
  traceStep(
    trace,
    'solve.candidates',
    rootsAsEquations(ce, variable, solutions)
  );

  // Validate solutions against original constraints:
  // 1. f(x) ≥ 0 (for √f to be real)
  // 2. g(x) ≥ 0 (for √g to be real)
  // 3. e - gSign·√g ≥ 0 (for √f = e - gSign·√g, the RHS must be non-negative)
  // 4. The actual equation √f + gSign·√g = e holds

  const validSolutions: Expression[] = [];

  for (const sol of solutions) {
    // Substitute into f and g
    const fVal = fExpr.subs({ [variable]: sol }).N();
    const gVal = gExpr.subs({ [variable]: sol }).N();

    // Check f ≥ 0 and g ≥ 0
    if (fVal.isNegative || gVal.isNegative) continue;

    // Check the original equation: √f + gSign·√g = e
    const sqrtF = fVal.sqrt();
    const sqrtG = gVal.sqrt();
    const lhs = gSign === 1 ? sqrtF.add(sqrtG) : sqrtF.sub(sqrtG);
    const eVal = eExpr.N();

    // Check if lhs ≈ e
    const diff = lhs.sub(eVal).abs().N();
    const diffNum = numericValue(diff);
    const diffReal = numericApproximation(diffNum) ?? 0;

    if (diffReal < 1e-9) {
      validSolutions.push(sol);
    }
  }

  if (trace && validSolutions.length < solutions.length) {
    const rejected = solutions.filter(
      (s) => !validSolutions.some((v) => v.isSame(s))
    );
    traceStep(
      trace,
      'solve.validate-roots',
      rootsAsEquations(ce, variable, rejected)
    );
  }

  return validSolutions.length > 0 ? validSolutions : null;
}

/**
 * Detect and solve nested sqrt equations of the form √(f(x, √x)) = a.
 *
 * Pattern 4: √(x + √x) = a (or similar with √x inside outer sqrt)
 * - Use substitution u = √x, so x = u²
 * - √(u² + u) = a becomes u² + u = a² (after squaring)
 * - Solve quadratic for u, then x = u² for valid u ≥ 0
 *
 * Returns the solutions for x, or null if pattern not detected.
 */
function solveNestedSqrtEquation(
  expr: Expression,
  variable: string,
  trace?: RuleSteps
): Expression[] | null {
  if (!isFunction(expr, 'Add')) return null;

  const ce = expr.engine;
  const ops = expr.ops;
  if (ops.length === 0) return null;

  // Find the outer sqrt term
  let outerSqrt: Expression | null = null;
  let sqrtIndex = -1;

  for (let i = 0; i < ops.length; i++) {
    if (ops[i].operator === 'Sqrt') {
      outerSqrt = ops[i];
      sqrtIndex = i;
      break;
    }
  }

  if (!outerSqrt || sqrtIndex < 0 || !isFunction(outerSqrt)) return null;

  // Get the argument of the outer sqrt
  const outerArg = outerSqrt.op1;
  if (!outerArg) return null;

  // Check if the outer sqrt argument contains an inner √x (Sqrt of just the variable)
  // Pattern: √(... + √x + ...) or √(... + a*√x + ...)
  // Note: we only need to detect the presence of √x — the coefficient is handled
  // implicitly by the replace+subs substitution below.
  let hasInnerSqrtX = false;

  if (isFunction(outerArg, 'Add')) {
    for (const term of outerArg.ops) {
      // Check for √x directly
      if (isFunction(term, 'Sqrt') && isSymbol(term.op1, variable)) {
        hasInnerSqrtX = true;
        break;
      }
      // Check for Negate(Sqrt(x))
      if (
        isFunction(term, 'Negate') &&
        isFunction(term.op1, 'Sqrt') &&
        isSymbol(term.op1.op1, variable)
      ) {
        hasInnerSqrtX = true;
        break;
      }
      // Check for coefficient * √x
      if (isFunction(term, 'Multiply')) {
        if (
          term.ops.some(
            (f) => isFunction(f, 'Sqrt') && isSymbol(f.op1, variable)
          )
        ) {
          hasInnerSqrtX = true;
          break;
        }
      }
    }
  }

  if (!hasInnerSqrtX) return null;

  // We have √(f(x, √x)) = a pattern
  // Collect the constant terms (non-sqrt parts of the Add expression)
  const nonSqrtTerms = ops.filter((_, i) => i !== sqrtIndex);
  if (nonSqrtTerms.length === 0) return null;

  // a = -(sum of non-sqrt terms)
  let aExpr: Expression;
  if (nonSqrtTerms.length === 1) {
    aExpr = nonSqrtTerms[0].neg();
  } else {
    aExpr = ce.function('Add', nonSqrtTerms).neg();
  }

  // The constant should not contain the variable
  if (aExpr.has(variable)) return null;

  // Now we have: √(f(x, √x)) = a
  // Substitute u = √x, so x = u², √x = u
  // The outer arg f(x, √x) becomes f(u², u)

  // Create a unique internal symbol for u (avoiding wildcard prefix _)
  // Use __internalU to avoid collision with user symbols
  const uSymbolName = '__internalU';
  const uSymbol = ce.symbol(uSymbolName);

  // Substitute √x → u and x → u² in the outer sqrt argument
  // IMPORTANT: Must replace √x first, THEN x, otherwise √x becomes √(u²)
  const step1 = outerArg.replace(
    { match: ['Sqrt', variable], replace: uSymbol },
    { recursive: true }
  );
  const substitutedArg = step1?.subs({
    [variable]: ce.expr(['Power', uSymbolName, 2]),
  });

  if (!substitutedArg) return null;

  // Now we have √(g(u)) = a where g(u) = substitutedArg
  // Square both sides: g(u) = a²
  // So g(u) - a² = 0

  const aSquared = aExpr.mul(aExpr);
  const uEquation = substitutedArg.sub(aSquared).simplify();

  if (trace) {
    // Display the internal substitution symbol under a readable name
    const uDisplay = ['u', 't', 'w', 's', 'v'].find((n) => n !== variable)!;
    traceStep(
      trace,
      'solve.substitute',
      ce.function('Equal', [
        ce.symbol(uDisplay),
        ce.function('Sqrt', [ce.symbol(variable)]),
      ])
    );
    traceStep(
      trace,
      'solve.substituted-equation',
      asEquation(
        uEquation.subs({ [uSymbolName]: ce.symbol(uDisplay) }),
        uDisplay
      )
    );
  }

  // Solve for u
  ce.pushScope();
  ce.declare(uSymbolName, { type: 'real' });

  let uSolutions: ReadonlyArray<Expression>;
  try {
    uSolutions = findUnivariateRoots(uEquation, uSymbolName);
  } finally {
    ce.popScope();
  }

  if (uSolutions.length === 0) return null;

  // Convert u solutions back to x = u²
  // Only keep solutions where u ≥ 0 (since u = √x ≥ 0)
  const xSolutions: Expression[] = [];

  for (const uVal of uSolutions) {
    // Check if u is real and non-negative (since u = √x ≥ 0)
    const uNumeric = uVal.N();

    // Use the expression's isNegative property for reliable checking
    if (uNumeric.isNegative) continue; // Skip negative u values

    // Also check numericValue for cases where isNegative might not be set
    const uNum = numericValue(uNumeric);
    if (uNum !== undefined) {
      const uReal = numericApproximation(uNum);
      if (uReal !== undefined && uReal < -1e-10) continue; // Skip negative u values
    }

    // x = u²
    const xVal = uVal.mul(uVal).simplify();
    xSolutions.push(xVal);
  }

  if (xSolutions.length > 0)
    traceStep(
      trace,
      'solve.back-substitute',
      rootsAsEquations(ce, variable, xSolutions)
    );

  return xSolutions.length > 0 ? xSolutions : null;
}

/**
 * Unary operators that are injective (one-to-one) on their real domain.
 * For these, `f(u) = f(v) ⟺ u = v` (on the domain of `f`), so the wrapper
 * can be peeled from both sides of an equation, e.g. `ln(x) = ln(3) → x = 3`.
 * Candidates that fall outside the domain of `f` are extraneous and get
 * rejected by `validateRoots()` against the original equation.
 */
const INJECTIVE_UNARY_OPERATORS = new Set([
  'Ln',
  'Exp',
  'Sqrt',
  'Sinh',
  'Arsinh',
  'Tanh',
  'Artanh',
  'Arcsin',
  'Arccos',
  'Arctan',
]);

function gcd2(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

function lcm2(a: number, b: number): number {
  return (a / gcd2(a, b)) * b;
}

/** If `e` is a rational constant, return it as `[numerator, denominator]`
 * (denominator > 0); otherwise `null`. */
function rationalExponent(e: Expression): [number, number] | null {
  const k = asSmallInteger(e);
  if (k !== null) return [k, 1];
  if (e.isNumber && e.isRational) {
    const p = asSmallInteger(e.numerator);
    const q = asSmallInteger(e.denominator);
    if (p !== null && q !== null && q > 0) return [p, q];
  }
  return null;
}

/**
 * Solve an equation that is a polynomial in `x^{1/d}` (d > 1) by the
 * substitution `u = x^{1/d}` — i.e. equations mixing several rational powers
 * (roots) of the unknown. For example `2√x + 3·⁴√x − 2 = 0` becomes
 * `2u² + 3u − 2 = 0` with `u = ⁴√x`; its roots `u = ½, −2` give `x = u⁴`, and
 * the extraneous `x = 16` (from `u = −2`, while `⁴√x ≥ 0`) is removed by the
 * caller's root validation against the original equation.
 *
 * This is the "homogenization" heuristic: replace a function of the unknown by
 * a new variable, solve, then invert. Returns `null` when `x` occurs outside a
 * rational power `x^{p/q}` (so it does not apply to `√(x²+1)`, `sin x`, …), or
 * when every power is already an integer (a plain polynomial, handled by the
 * polynomial fallback).
 */
function solveByRationalPowerSubstitution(
  expr: Expression,
  x: string,
  trace?: RuleSteps
): ReadonlyArray<Expression> | null {
  const ce = expr.engine;

  // First pass: collect the denominators of every rational exponent of x,
  // failing if x appears in any non-rational-power context.
  const dens = new Set<number>();
  const collect = (node: Expression): boolean => {
    if (isSymbol(node, x)) {
      dens.add(1);
      return true;
    }
    if (!node.has(x)) return true; // x-free subtree
    if (isFunction(node, 'Sqrt') && isSymbol(node.op1, x)) {
      dens.add(2);
      return true;
    }
    if (isFunction(node, 'Root') && isSymbol(node.op1, x)) {
      const n = asSmallInteger(node.op2);
      if (n === null || n <= 0) return false;
      dens.add(n);
      return true;
    }
    if (isFunction(node, 'Power') && isSymbol(node.op1, x)) {
      const r = rationalExponent(node.op2);
      if (r === null) return false;
      dens.add(r[1]);
      return true;
    }
    if (
      isFunction(node, 'Add') ||
      isFunction(node, 'Multiply') ||
      isFunction(node, 'Negate')
    )
      return node.ops!.every(collect);
    return false; // any other head containing x: not a rational-power polynomial
  };
  if (!collect(expr) || dens.size === 0) return null;

  let d = 1;
  for (const q of dens) d = lcm2(d, q);
  if (d <= 1) return null; // already a plain polynomial in x

  // Pick a fresh substitution variable not used in the expression.
  const uName = ['u', 't', 'w', 's', 'v', 'y', 'z'].find(
    (n) => n !== x && !expr.unknowns.includes(n)
  );
  if (uName === undefined) return null;
  const u = ce.symbol(uName);

  // Second pass: rewrite each x^{p/q} as u^{p·d/q} (an integer power of u, since
  // d is a multiple of every denominator).
  const rewrite = (node: Expression): Expression => {
    if (isSymbol(node, x)) return u.pow(d);
    if (!node.has(x)) return node;
    if (isFunction(node, 'Sqrt') && isSymbol(node.op1, x)) return u.pow(d / 2);
    if (isFunction(node, 'Root') && isSymbol(node.op1, x))
      return u.pow(d / asSmallInteger(node.op2)!);
    if (isFunction(node, 'Power') && isSymbol(node.op1, x)) {
      const [p, q] = rationalExponent(node.op2)!;
      return u.pow((p * d) / q);
    }
    if (isFunction(node, 'Negate')) return rewrite(node.op1).neg();
    if (isFunction(node, 'Add'))
      return ce.function('Add', node.ops!.map(rewrite));
    if (isFunction(node, 'Multiply'))
      return ce.function('Multiply', node.ops!.map(rewrite));
    return node;
  };

  const uExpr = rewrite(expr);
  if (trace) {
    traceStep(
      trace,
      'solve.substitute',
      ce.function('Equal', [
        u,
        ce.symbol(x).pow(ce.number(1).div(ce.number(d))),
      ])
    );
    traceStep(trace, 'solve.substituted-equation', asEquation(uExpr, uName));
  }
  const uRoots = findUnivariateRoots(uExpr, uName);
  if (uRoots.length === 0) return null;

  // Back-substitute x = uᵈ; extraneous roots are dropped by the caller's
  // validation against the original equation.
  const xRoots = uRoots.map((ur) => ur.pow(d));
  traceStep(trace, 'solve.back-substitute', rootsAsEquations(ce, x, xRoots));
  return xRoots;
}

/**
 * Exact reduction of a "sparse" polynomial whose x-exponents share a common
 * factor g > 1 — e.g. a biquadratic `x⁴ + bx² + c` (g = 2) — via the
 * substitution `u = xᵍ`. Solves the reduced polynomial (degree maxExp/g)
 * exactly, then takes the **real** g-th roots, yielding exact radical roots
 * where the numeric fallback only approximates: `x⁴ + x² − 1 → ±√((√5−1)/2)`.
 *
 * Only fires when the reduced degree is ≥ 2, so it never recurses on a pure
 * power `xᵍ − c` (already solved exactly by the `a·xⁿ + b` rule). Returns `null`
 * when `expr` is not a polynomial in x, or the exponent gcd is 1, or no real
 * root results.
 */
function solveByPowerGcdSubstitution(
  expr: Expression,
  x: string
): ReadonlyArray<Expression> | null {
  const ce = expr.engine;
  const coeffs = getPolynomialCoefficients(expr, x); // ascending [c₀, c₁, …]
  if (coeffs === null) return null;

  const nonzeroExps: number[] = [];
  for (let i = 1; i < coeffs.length; i++)
    if (!coeffs[i].isSame(0)) nonzeroExps.push(i);
  if (nonzeroExps.length === 0) return null;

  let g = nonzeroExps[0];
  for (const e of nonzeroExps) g = gcd2(g, e);
  if (g <= 1) return null;

  const maxExp = nonzeroExps[nonzeroExps.length - 1];
  if (maxExp / g < 2) return null; // reduced degree < 2 → pure power; skip

  // Reduced polynomial Q(u) with Q[k] = coeffs[k·g] (u = xᵍ).
  const uName = ['u', 't', 'w', 's', 'v', 'y', 'z'].find(
    (n) => n !== x && !expr.unknowns.includes(n)
  );
  if (uName === undefined) return null;
  const reduced: Expression[] = [];
  for (let k = 0; k * g < coeffs.length; k++) reduced.push(coeffs[k * g]);

  const uRoots = findUnivariateRoots(fromCoefficients(reduced, uName), uName);
  if (uRoots.length === 0) return null;

  const xRoots: Expression[] = [];
  for (const uRoot of uRoots) {
    // Solve xᵍ = uRoot, keeping only the real branches (matching the engine's
    // real-only convention for higher-degree polynomial roots).
    const branch = findUnivariateRoots(ce.symbol(x).pow(g).sub(uRoot), x);
    for (const r of branch) if (Math.abs(r.N().im ?? 0) < 1e-12) xRoots.push(r);
  }
  return xRoots.length > 0 ? xRoots : null;
}

/** Parse a term as ±cᵉ: returns `[sign, base, exp]` when the term is a power,
 * optionally negated or carrying a ±1 coefficient; otherwise `null`. */
function asSignedPower(
  term: Expression
): [number, Expression, Expression] | null {
  if (isFunction(term, 'Power')) return [1, term.op1, term.op2];
  if (isFunction(term, 'Negate')) {
    const inner = asSignedPower(term.op1);
    return inner ? [-inner[0], inner[1], inner[2]] : null;
  }
  if (isFunction(term, 'Multiply')) {
    let sign = 1;
    let base: Expression | undefined;
    let exp: Expression | undefined;
    for (const f of term.ops!) {
      if (isFunction(f, 'Power') && base === undefined) {
        base = f.op1;
        exp = f.op2;
      } else if (f.isSame(-1)) sign = -sign;
      else if (f.isSame(1)) {
        /* unit coefficient: ignore */
      } else return null; // a non-±1 coefficient or extra factor
    }
    return base !== undefined && exp !== undefined ? [sign, base, exp] : null;
  }
  return null;
}

/**
 * Reduce a same-base power difference `cᵃ − cᵇ = 0` to `a − b = 0`: the
 * exponents must be equal because `x ↦ cˣ` is injective for a positive constant
 * base `c ≠ 1`. This complements the `Equal`-form peeling for the `f = 0` input
 * form the `Solve` operator / audit path produces (e.g. `e^{2−x²} − e^{−x}`,
 * an `Add` rather than an `Equal`).
 *
 * Returns the reduced expression, or `null` if `expr` is not a two-term
 * difference of powers of the same valid base.
 */
function reduceSameBasePower(
  expr: Expression,
  variable: string
): Expression | null {
  if (!isFunction(expr, 'Add') || expr.nops !== 2) return null;
  const p0 = asSignedPower(expr.op1);
  const p1 = asSignedPower(expr.op2);
  if (p0 === null || p1 === null) return null;
  const [s0, c0, e0] = p0;
  const [s1, c1, e1] = p1;
  if (s0 === s1) return null; // need a genuine difference cᵃ − cᵇ
  if (!c0.isSame(c1)) return null;
  if (c0.has(variable) || c0.isPositive !== true || c0.isSame(1)) return null;
  const [plusExp, minusExp] = s0 > 0 ? [e0, e1] : [e1, e0];
  return plusExp.sub(minusExp);
}

/** Substitute the fresh symbol `u` for the generator `g` throughout `node`.
 *
 * Besides exact structural matches (`g → u`), an *exponential* generator
 * `g = bᵉ⁰` (constant base `b`) also absorbs every integer power sharing that
 * base: `bᵏ·ᵉ⁰ → uᵏ` (so `e^{2x}` becomes `u²` when `u = e^x`). This is done
 * directly — materializing `(eˣ)²` would be canonicalized straight back to
 * `e^{2x}`, undoing the substitution. */
function substituteGenerator(
  node: Expression,
  g: Expression,
  u: Expression
): Expression {
  const ce = node.engine;
  if (node.isSame(g)) return u;
  if (
    isFunction(g, 'Power') &&
    isFunction(node, 'Power') &&
    node.op1.isSame(g.op1)
  ) {
    const k = asSmallInteger(node.op2.div(g.op2).simplify());
    if (k !== null && k >= 1) return ce.function('Power', [u, ce.number(k)]);
  }
  if (isFunction(node))
    return ce.function(
      node.operator,
      node.ops!.map((o) => substituteGenerator(o, g, u))
    );
  return node;
}

/**
 * "PowerExpand" for logarithms, restricted to the solver: rewrite
 * `ln(fᶜ) → c·ln f` and `ln(√f) → ½·ln f` (likewise `log_b(fᶜ) → c·log_b f`),
 * so an equation mixing `ln f` and `ln(fᶜ)` becomes a polynomial in the single
 * generator `ln f` — e.g. `√(ln x) − ln√x` becomes `√(ln x) − ½·ln x`.
 *
 * Valid on the principal (positive) domain. Because every candidate root is
 * validated by `validateRoots()` against the *untransformed* equation, this
 * rewrite can only ever drop roots where `f ≤ 0` (already outside `ln`'s real
 * domain), never introduce spurious ones.
 */
function expandLogPowers(node: Expression): Expression {
  if (!isFunction(node)) return node;
  const ce = node.engine;
  const rebuilt = ce.function(node.operator, node.ops!.map(expandLogPowers));
  if (isFunction(rebuilt, 'Ln')) {
    const a = rebuilt.op1;
    if (isFunction(a, 'Power'))
      return ce.function('Multiply', [a.op2, ce.function('Ln', [a.op1])]);
    if (isFunction(a, 'Sqrt'))
      return ce.function('Multiply', [ce.Half, ce.function('Ln', [a.op1])]);
  }
  if (isFunction(rebuilt, 'Log') && rebuilt.nops === 2) {
    const a = rebuilt.op1;
    const b = rebuilt.op2;
    if (isFunction(a, 'Power'))
      return ce.function('Multiply', [a.op2, ce.function('Log', [a.op1, b])]);
    if (isFunction(a, 'Sqrt'))
      return ce.function('Multiply', [ce.Half, ce.function('Log', [a.op1, b])]);
  }
  return rebuilt;
}

/** Operators that, applied to the unknown, form a candidate "generator" `g(x)`
 * for substitution solving (a power `bˣ` with a constant base is also one). */
const GENERATOR_OPERATORS = new Set([
  'Ln',
  'Log',
  'Exp',
  'Sin',
  'Cos',
  'Tan',
  'Cot',
  'Sec',
  'Csc',
  'Sinh',
  'Cosh',
  'Tanh',
  'Coth',
  'Sech',
  'Csch',
  'Arcsin',
  'Arccos',
  'Arctan',
  'Arccot',
  'Arsinh',
  'Arcosh',
  'Artanh',
  'Sqrt',
]);

/** Collect the distinct candidate generators `g(x)` occurring in `expr`,
 * innermost (shortest) first — so `ln x` is tried before `√(ln x)`. */
function collectGenerators(expr: Expression, x: string): Expression[] {
  const found = new Map<string, Expression>();
  const walk = (node: Expression): void => {
    if (!isFunction(node) || !node.has(x)) return;
    const isGen =
      GENERATOR_OPERATORS.has(node.operator) ||
      (node.operator === 'Power' && !node.op1.has(x) && node.op2.has(x)); // bˣ
    if (isGen) found.set(node.toString(), node);
    for (const o of node.ops!) walk(o);
  };
  walk(expr);
  return [...found.values()].sort(
    (a, b) => a.toString().length - b.toString().length
  );
}

/**
 * Solve an equation that is a polynomial in a single nonlinear *generator*
 * `g(x)` — a logarithm, exponential, trig function, radical, or a nested
 * combination — by the substitution `u = g(x)`. After normalizing (so
 * `ln(√x)`/`e^{2x}`-style forms share a generator), each candidate generator
 * is replaced by a fresh `u`; if that removes every occurrence of `x`, the
 * equation in `u` is solved recursively, and each `u`-root is inverted by
 * solving `g(x) = u` for `x`. Extraneous roots from the substitution are
 * dropped by the caller's validation against the original equation.
 *
 * Examples: `(ln x)² − 4 → ln x = ±2 → {e², e⁻²}`,
 * `√(ln x) = ln√x → {1, e⁴}`, `e^{2x} − 3e^x + 2 → {0, ln 2}`.
 *
 * Returns `null` when no single generator captures every occurrence of `x`
 * (e.g. `sin x − tan x`, which has two independent generators), or when the
 * reduced equation has no roots.
 */
function solveByGeneratorSubstitution(
  expr: Expression,
  x: string,
  depth: number,
  trace?: RuleSteps
): ReadonlyArray<Expression> | null {
  if (depth >= 3) return null; // recursion backstop
  const ce = expr.engine;

  const normalized = expandLogPowers(expr);
  for (const g of collectGenerators(normalized, x)) {
    const uName = ['u', 't', 'w', 's', 'v', 'y', 'z'].find(
      (n) => n !== x && !normalized.unknowns.includes(n) && !g.has(n)
    );
    if (uName === undefined) continue;
    const u = ce.symbol(uName);

    // The generator must capture *every* occurrence of x for the substitution
    // to yield an equation purely in u.
    const exprU = substituteGenerator(normalized, g, u);
    if (exprU.has(x) || !exprU.has(uName) || exprU.isSame(u)) continue;

    ce.pushScope();
    let uRoots: ReadonlyArray<Expression> = [];
    try {
      ce.declare(uName, 'real');
      uRoots = findUnivariateRoots(exprU, uName, depth + 1);
    } finally {
      ce.popScope();
    }
    if (uRoots.length === 0) continue;

    // Invert: for each u-root, solve g(x) = u for x.
    const xRoots: Expression[] = [];
    for (const ur of uRoots)
      for (const r of findUnivariateRoots(g.sub(ur), x, depth + 1))
        xRoots.push(r);

    if (xRoots.length > 0) {
      if (trace) {
        traceStep(trace, 'solve.substitute', ce.function('Equal', [u, g]));
        traceStep(
          trace,
          'solve.substituted-equation',
          asEquation(exprU, uName)
        );
        traceStep(
          trace,
          'solve.back-substitute',
          rootsAsEquations(ce, x, xRoots)
        );
      }
      return xRoots;
    }
  }
  return null;
}

/**
 * Zero-product solving: the real roots of a product are the union of the roots
 * of its factors (a product is zero iff one factor is). Handles equations that
 * factor into several x-containing factors — e.g. `ln(x)·(x − 1) = 0` or the
 * already-factored `(x + 1)·(sin²x + 1)²·cos³(3x) = 0`. A factor `fⁿ` (n a
 * positive constant) contributes the roots of `f`; constant and x-free factors
 * contribute none.
 *
 * Operates on the product form directly — CE's polynomial `Factor` does not
 * factor transcendental products — so it complements the polynomial paths.
 * Returns `null` unless `expr` is a `Multiply` of at least two x-containing
 * factors.
 */
function solveByZeroProduct(
  expr: Expression,
  x: string,
  depth: number,
  trace?: RuleSteps
): ReadonlyArray<Expression> | null {
  if (depth >= 3) return null; // recursion backstop
  if (!isFunction(expr, 'Multiply')) return null;
  const factors = expr.ops!.filter((f) => f.has(x));
  if (factors.length < 2) return null;

  // The factor bases whose roots are collected (a factor `fⁿ`, n > 0,
  // contributes the roots of `f`; n ≤ 0 contributes none).
  const bases: Expression[] = [];
  for (const f of factors) {
    let base = f;
    if (isFunction(f, 'Power') && f.op1.has(x) && !f.op2.has(x)) {
      if (f.op2.isPositive !== true) continue; // fⁿ with n ≤ 0: no extra roots
      base = f.op1;
    }
    bases.push(base);
  }

  if (trace && bases.length > 0) {
    const ce = expr.engine;
    traceStep(
      trace,
      'solve.factor-zero-product',
      ce.function(
        'List',
        bases.map((b) => asEquation(b, x))
      )
    );
  }

  const roots: Expression[] = [];
  for (const base of bases)
    for (const r of findUnivariateRoots(base, x, depth + 1)) roots.push(r);
  return roots.length > 0 ? roots : null;
}

/**
 * `tan(f(arg))` as an algebraic expression in `arg`, for a real-principal-branch
 * inverse-trig function `f`; `null` for anything else. Used to clear two
 * *different* inverse-trig functions from an equation `g(x) = h(x)` by applying
 * `tan` to both sides (ROADMAP B9).
 */
function tanOfInverseTrig(op: string, arg: Expression): Expression | null {
  const ce = arg.engine;
  const sqrt1mSq = () => ce.function('Sqrt', [ce.One.sub(arg.pow(2))]);
  switch (op) {
    case 'Arctan':
      return arg; // tan(arctan x) = x
    case 'Arcsin':
      return arg.div(sqrt1mSq()); // tan(arcsin x) = x / √(1−x²)
    case 'Arccos':
      return sqrt1mSq().div(arg); // tan(arccos x) = √(1−x²) / x
    default:
      return null;
  }
}

/**
 * Solve `g(x) = h(x)` where `g` and `h` are two *different* inverse-trig
 * functions of the unknown (e.g. `arcsin x = arctan x`, `arccos x = arctan x`),
 * by applying `tan` to both sides to clear the inverse functions, then solving
 * the resulting algebraic equation. SymPy errors on these; CE returned nothing.
 *
 * `tan` is periodic, so this can introduce roots where the two angles differ by
 * a multiple of π — the caller validates every candidate against the original
 * equation, which removes them. Returns `null` when the pattern does not apply.
 */
function solveInverseTrigEquation(
  lhs: Expression,
  rhs: Expression,
  x: string,
  depth: number,
  trace?: RuleSteps
): Expression[] | null {
  if (depth >= 3) return null; // recursion backstop
  if (!isFunction(lhs) || !isFunction(rhs)) return null;
  if (lhs.nops !== 1 || rhs.nops !== 1) return null;
  // The same-function case `f(u) = f(v)` is already handled by the injective
  // peel; this strategy is for two *different* inverse-trig heads.
  if (lhs.operator === rhs.operator) return null;
  if (!lhs.op1.has(x) || !rhs.op1.has(x)) return null;

  const tanL = tanOfInverseTrig(lhs.operator, lhs.op1);
  const tanR = tanOfInverseTrig(rhs.operator, rhs.op1);
  if (tanL === null || tanR === null) return null;

  const ce = lhs.engine;
  traceStep(trace, 'solve.apply-tangent', ce.function('Equal', [tanL, tanR]));
  const roots = findUnivariateRoots(
    ce.function('Equal', [tanL, tanR]),
    x,
    depth + 1
  );
  return roots.length > 0 ? [...roots] : null;
}

/**
 * MathJsonExpression is a function of a single variable (`x`) or an Equality
 *
 * Return the roots of that variable
 *
 */
export function findUnivariateRoots(
  expr: Expression,
  x: string,
  depth = 0,
  trace?: RuleSteps
): ReadonlyArray<Expression> {
  const ce = expr.engine;

  // `BaseForm` is an inert display wrapper (`BaseForm(value, base)`); its value
  // slot may be a polynomial in the unknown (symbolic-base numerals such as
  // `161_b` → `BaseForm(b² + 6b + 1, b)`). Strip the wrappers so the underlying
  // polynomial equation is visible to the solver. This is a structural rewrite
  // — do not evaluate — so exact coefficients are preserved.
  if (expr.has('BaseForm')) {
    const stripBaseForm = (node: Expression): Expression => {
      if (isFunction(node, 'BaseForm')) return stripBaseForm(node.op1);
      if (isFunction(node) && node.ops)
        return ce.function(node.operator, node.ops.map(stripBaseForm));
      return node;
    };
    expr = stripBaseForm(expr);
  }

  // Save the expression to solve BEFORE peeling, clearing denominators and
  // other transformations. This is crucial for validating roots: those
  // transformations can introduce extraneous roots that satisfy the
  // transformed equation but not the original. For example, sqrt equations
  // using quadratic substitution (u = √x → au² + bu + c = 0 → x = u²) may
  // produce extraneous roots.
  let originalExpr: Expression;

  if (isFunction(expr, 'Equal')) {
    const lhs0 = expr.op1;
    const rhs0 = expr.op2;

    // Peel identical injective unary functions from both sides:
    // f(u) = f(v) ⟺ u = v. This preserves exactness, e.g.
    // `ln(x) = ln(3)` becomes `x = 3` instead of `x = e^{ln 3}` (which
    // simplification would otherwise degrade to a numeric approximation).
    let lhs = lhs0;
    let rhs = rhs0;
    while (
      isFunction(lhs) &&
      isFunction(rhs) &&
      lhs.operator === rhs.operator &&
      lhs.nops === 1 &&
      rhs.nops === 1 &&
      INJECTIVE_UNARY_OPERATORS.has(lhs.operator)
    ) {
      lhs = lhs.op1;
      rhs = rhs.op1;
      traceStep(trace, 'solve.apply-inverse', ce.function('Equal', [lhs, rhs]));
    }

    // Same-base power equality: cᵃ = cᵇ ⟺ a = b when x ↦ cˣ is injective,
    // i.e. the base c is a positive constant ≠ 1 not involving the unknown.
    // (`eᵃ` is represented as `Power(ExponentialE, a)`, so this also covers
    // `eᵃ = eᵇ`.)
    if (
      isFunction(lhs, 'Power') &&
      isFunction(rhs, 'Power') &&
      lhs.op1.isSame(rhs.op1) &&
      !lhs.op1.has(x) &&
      lhs.op1.isPositive === true &&
      !lhs.op1.isSame(1)
    ) {
      lhs = lhs.op2;
      rhs = rhs.op2;
      traceStep(
        trace,
        'solve.equate-exponents',
        ce.function('Equal', [lhs, rhs])
      );
    }

    // Two *different* inverse-trig functions of the unknown (e.g.
    // `arcsin x = arctan x`): clear them by applying `tan` to both sides, solve
    // the algebraic result, and validate against the original (B9).
    // Record this strategy's steps provisionally: they only join the trace
    // if the strategy actually produces the answer.
    const invTrigTrace: RuleSteps | undefined = trace ? [] : undefined;
    const invTrigRoots = solveInverseTrigEquation(
      lhs,
      rhs,
      x,
      depth,
      invTrigTrace
    );
    if (invTrigRoots !== null) {
      traceStep(
        invTrigTrace,
        'solve.candidates',
        rootsAsEquations(ce, x, invTrigRoots)
      );
      const validated = validateRoots(
        lhs0.sub(rhs0),
        x,
        invTrigRoots,
        invTrigTrace
      );
      if (validated.length > 0) {
        trace?.push(...invTrigTrace!);
        return validated;
      }
    }

    expr = expand(lhs).sub(expand(rhs)).simplify();

    // Validate against the ORIGINAL (unpeeled, unsimplified) equation:
    // simplification rules may assume principal domains (e.g.
    // `ln(a) + ln(b) → ln(ab)`), which would make extraneous roots
    // introduced by the transformations below appear valid.
    originalExpr = lhs0.sub(rhs0);
    traceStep(trace, 'solve.move-terms', asEquation(expr, x));
  } else {
    originalExpr = expr;
    expr = expand(expr).simplify();
    if (trace && !expr.isSame(originalExpr))
      traceStep(trace, 'solve.simplify', asEquation(expr, x));
  }

  // Same-base power difference cᵃ − cᵇ = 0 ⟹ a − b = 0 (handles the f = 0 input
  // form, complementing the Equal-form peeling above).
  {
    const reduced = reduceSameBasePower(expr, x);
    if (reduced !== null && reduced !== undefined) {
      expr = reduced;
      traceStep(trace, 'solve.equate-exponents', asEquation(expr, x));
    }
  }

  // Clear denominators to enable matching of expressions like F - 3x/h = 0
  {
    const cleared = clearDenominators(expr);
    if (trace && !cleared.isSame(expr))
      traceStep(trace, 'solve.clear-denominators', asEquation(cleared, x));
    expr = cleared;
  }

  // Try to solve equations with two sqrt terms: √(f(x)) + √(g(x)) = e
  // Pattern 3: Uses double squaring to eliminate both sqrts
  // (Strategy steps are recorded provisionally and only join the trace when
  // the strategy produces the answer.)
  const twoSqrtTrace: RuleSteps | undefined = trace ? [] : undefined;
  const twoSqrtSolutions = solveTwoSqrtEquation(expr, x, twoSqrtTrace);
  if (twoSqrtSolutions !== null) {
    // Solutions are already validated inside the function
    trace?.push(...twoSqrtTrace!);
    return twoSqrtSolutions;
  }

  // Try to solve nested sqrt equations: √(f(x, √x)) = a
  // This uses substitution u = √x, solves for u, then converts back to x = u²
  const nestedTrace: RuleSteps | undefined = trace ? [] : undefined;
  const nestedSqrtSolutions = solveNestedSqrtEquation(expr, x, nestedTrace);
  if (nestedSqrtSolutions !== null) {
    // Validate and return the solutions
    trace?.push(...nestedTrace!);
    return validateRoots(originalExpr, x, nestedSqrtSolutions, trace);
  }

  // Transform sqrt-linear equations: √(f(x)) = g(x) → f(x) - g(x)² = 0
  // This handles Pattern 2: √(ax+b) = cx+d by squaring both sides.
  // Must be done before pattern matching so quadratic formula can match.
  // Note: This can introduce extraneous roots, which are filtered by validateRoots().
  {
    const transformed = transformSqrtLinearEquation(expr, x);
    if (trace && !transformed.isSame(expr))
      traceStep(trace, 'solve.square-both-sides', asEquation(transformed, x));
    expr = transformed;
  }

  const rules = ce.getRuleSet('solve-univariate')!;

  // Make the unknown '_x' so that we can match against it
  const exprs = [expr.subs({ [x]: '_x' }, { canonical: false })];

  // Create a lexical scope for the unknown
  ce.pushScope();

  let result: Expression[] = [];
  try {
    // Use the declared type of the variable, if any, otherwise assume 'number'
    const varType = ce.symbol(x).type.type;
    ce.declare('_x', typeof varType === 'string' ? varType : 'number');

    // Match the root templates against an expression in which the unknown is
    // the literal `_x` symbol. The substitution pre-binds the `_x` wildcard
    // to that same symbol, in EVERY pass: the harmonized forms produced by
    // `harmonize()` also contain the literal `_x` symbol, so binding `_x` to
    // the original unknown post-harmonization would make every pattern rule
    // fail to match.
    const matchRootsSteps = (expr: Expression): RuleSteps =>
      matchAnyRulesWithSteps(
        expr,
        rules,
        { _x: ce.symbol('_x') },
        { useVariations: true, form: 'canonical' }
      );

    // Record the candidates produced by matched root templates, each under
    // its template's id (`solve.linear`, `solve.quadratic-formula-positive`,
    // …). `via`, when present, is a step recording the equivalent form
    // (harmonized/expanded) the templates matched against.
    const traceMatches = (
      matches: RuleSteps,
      via?: { because: string; form: Expression }
    ): void => {
      if (!trace || matches.length === 0) return;
      if (via) traceStep(trace, via.because, asEquation(via.form, x));
      for (const m of matches) {
        // A validity-guarded candidate `When(root, guard)` (Phase 2): resolve a
        // decidable guard for the narrative (a numeric ratio collapses to the
        // bare root, matching the pre-Phase-2 trace; a False guard drops the
        // step). An undecidable guard is displayed as the `When`.
        let value: Expression | null = m.value;
        if (isFunction(value, 'When'))
          value = conditionalRoot(ce, value.op1, value.op2);
        if (value === null) continue;
        traceStep(
          trace,
          m.because !== '' ? m.because : 'solve.template',
          rootsAsEquations(ce, x, [value])
        );
      }
    };

    // FAST PATH: a univariate polynomial of degree ≥ 2 is solved directly from
    // its coefficients (quadratic formula / rational-root + numeric), skipping
    // the commutative pattern-matcher whose operand-permutation search dominates
    // polynomial solving (P1-2). Non-polynomial shapes — and linear equations,
    // whose rule is already cheap — fall through to the rule templates below.
    // `originalExpr` is preferred (clean); when radical-clearing turned a
    // non-polynomial original into a sqrt-free polynomial (`√(1−x²) = x²` →
    // `1 − x² − x⁴`), the transformed `expr` is used and `validateRoots` drops
    // any roots the squaring introduced.
    const polyExpr =
      polynomialDegree(originalExpr, x) >= 0
        ? originalExpr
        : polynomialDegree(expr, x) >= 0
          ? expr
          : null;
    if (polyExpr !== null && polynomialDegree(polyExpr, x) >= 2)
      result = solvePolynomialByCoefficients(polyExpr, x, trace);

    if (result.length === 0) {
      for (const e of exprs) {
        const matches = matchRootsSteps(e);
        traceMatches(matches);
        result.push(...matches.map((s) => s.value));
      }
    }

    // If we didn't find a solution yet, try modifying the expression
    //expr.
    // Note: @todo we can try different heuristics here:
    // Collection: reduce the numbers of occurrences of the unknown
    // Attraction: bring the occurrences of the unknown closer together
    // Function Swapping: replacing function with ones easier to solve
    //    - square roots: square both sides
    //    - logs: exponentiate both sides
    //    - trig functions: use inverse trig functions
    // Homogenization: replace a function of the unknown by a new variable,
    // e.g. exp(x) -> y, then solve for y

    let harmonized: Expression[] = [];
    if (result.length === 0) {
      harmonized = exprs.flatMap((expr) => harmonize(expr));
      for (const h of harmonized) {
        const matches = matchRootsSteps(h);
        traceMatches(matches, { because: 'solve.harmonize', form: h });
        result.push(...matches.map((s) => s.value));
      }
    }

    if (result.length === 0) {
      // Expand the original and harmonized forms (harmonization may produce
      // factored forms like `x(x+2) - 1` whose roots only match once
      // expanded), then harmonize once more
      const expanded = [...exprs, ...harmonized]
        .map((expr) => expand(expr.canonical))
        .filter((expr) => expr !== null);
      const forms = [
        ...expanded,
        ...expanded.flatMap((expr) => harmonize(expr)),
      ];
      forms.forEach((form, i) => {
        const matches = matchRootsSteps(form);
        traceMatches(matches, {
          because: i < expanded.length ? 'solve.expand' : 'solve.harmonize',
          form,
        });
        result.push(...matches.map((s) => s.value));
      });
    }

    // (The polynomial coefficient solve that used to live here as a
    // post-matcher fallback now runs as a fast path *before* the matcher — see
    // `solvePolynomialByCoefficients` above.)

    // Single-sqrt elimination: A(x)·√R(x) + B(x) = 0 → A²R - B² = 0 (a √ term
    // with a non-constant coefficient, e.g. x·√(x²+1) = 1), which the
    // sqrt-linear transform above intentionally skips.
    if (result.length === 0) {
      const subTrace: RuleSteps | undefined = trace ? [] : undefined;
      const sqrtRoots = solveSingleSqrtEquation(expr, x, subTrace);
      if (sqrtRoots) {
        trace?.push(...subTrace!);
        result = [...sqrtRoots];
      }
    }

    // Homogenization: equations that are polynomials in a rational power of the
    // unknown (e.g. 2√x + 3·⁴√x = 2) — substitute u = x^{1/d}, solve, invert.
    if (result.length === 0) {
      const subTrace: RuleSteps | undefined = trace ? [] : undefined;
      const substRoots = solveByRationalPowerSubstitution(
        originalExpr,
        x,
        subTrace
      );
      if (substRoots) {
        trace?.push(...subTrace!);
        result = [...substRoots];
      }
    }

    // Zero-product: a product of x-containing factors is zero iff one factor is
    // (e.g. `ln(x)·(x − 1) = 0`, or an already-factored `(x+1)·cos³(3x) = 0`).
    if (result.length === 0) {
      const subTrace: RuleSteps | undefined = trace ? [] : undefined;
      const productRoots = solveByZeroProduct(originalExpr, x, depth, subTrace);
      if (productRoots) {
        trace?.push(...subTrace!);
        result = [...productRoots];
      }
    }

    // Generator substitution: an equation that is a polynomial in a single
    // nonlinear generator g(x) — `(ln x)² − 4`, `√(ln x) = ln√x`,
    // `e^{2x} − 3e^x + 2` — via u = g(x), solve, invert.
    if (result.length === 0) {
      const subTrace: RuleSteps | undefined = trace ? [] : undefined;
      const genRoots = solveByGeneratorSubstitution(
        originalExpr,
        x,
        depth,
        subTrace
      );
      if (genRoots) {
        trace?.push(...subTrace!);
        result = [...genRoots];
      }
    }

    // A root may reference the `_x` wildcard symbol (e.g. when produced by a
    // functional root rule): rewrite it in terms of the original unknown.
    // (Roots still containing the unknown are then rejected by
    // `validateRoots()`.)
    result = result.map((root) =>
      root.has('_x') ? root.subs({ _x: ce.symbol(x) }) : root
    );
  } finally {
    ce.popScope();
  }

  // Evaluate/simplify each candidate root, resolving any validity guard a
  // trig rule attached (`When(root, guard)`) through the single chokepoint:
  // a decidable-True guard collapses to the bare root (numeric ratios keep
  // today's behavior), a decidable-False guard drops the root (pruning
  // contract, decision 8), and an undecidable guard is retained as a `When`
  // whose *value* is verified below.
  const resolved: Expression[] = [];
  for (const r of result) {
    if (isFunction(r, 'When')) {
      const root = conditionalRoot(ce, r.op1.evaluate().simplify(), r.op2);
      if (root !== null) resolved.push(root);
    } else {
      resolved.push(r.evaluate().simplify());
    }
  }

  // Validate the roots against the ORIGINAL expression (before clearing
  // denominators and harmonization). This filters out extraneous roots that
  // may have been introduced by algebraic transformations.
  const validatedRoots = validateRoots(originalExpr, x, resolved, trace);

  // Filter solutions by the declared type of the variable
  return filterRootsByType(ce, x, validatedRoots, trace);
}

/**
 * Closed-form roots of a univariate polynomial (degree ≥ 2) from its
 * coefficients, bypassing the commutative pattern-matcher. Degree 2 uses the
 * quadratic formula (exact — radicals preserved via canonical `Add`/`Multiply`);
 * degree ≥ 3 uses the rational-root theorem, then an exact sparse-power
 * reduction (biquadratic via u = x²) or the numeric Durand–Kerner fallback for
 * the remaining real roots. Returns `[]` when no closed form is produced (the
 * caller then falls back to the rule templates). Extracted from the former
 * post-matcher fallback so it can run as a fast path *before* the matcher (P1-2).
 */
function solvePolynomialByCoefficients(
  polyExpr: Expression,
  x: string,
  trace?: RuleSteps
): Expression[] {
  const ce = polyExpr.engine;
  const deg = polynomialDegree(polyExpr, x);
  if (deg === 2) {
    // The quadratic rules match the surface form `Multiply(__b, _x)` for the
    // middle term, but a negated symbolic/unit coefficient canonicalizes to
    // `Negate(Multiply(b, x))` (or `Negate(x)`), which that pattern misses — so
    // e.g. `x^2 - a x + 1 = 0` found no roots. Coefficient extraction handles
    // every sign form uniformly (#300).
    const roots = [...solveQuadraticByCoefficients(polyExpr, x)];
    if (trace && roots.length > 0)
      traceStep(
        trace,
        'solve.quadratic-formula',
        rootsAsEquations(ce, x, roots)
      );
    return roots;
  }
  if (deg >= 3) {
    // Pure powers `x^n + c` (only the constant and leading coefficients are
    // nonzero) are expressed EXACTLY as `Root(k, n)` by the rule templates —
    // power-gcd declines them (reduced degree 1), so defer to the rules rather
    // than numericize. General (dense) cubics/quartics with no closed form fall
    // through to the numeric Durand–Kerner path below, matching prior behavior.
    const coeffs = getPolynomialCoefficients(polyExpr, x);
    if (coeffs !== null) {
      let isPurePower = true;
      for (let i = 1; i < coeffs.length - 1; i++)
        if (!coeffs[i].isSame(0)) {
          isPurePower = false;
          break;
        }
      if (isPurePower) return [];
    }

    // Exact rational roots first (rational-root theorem)…
    const rationalRoots = findRationalRoots(polyExpr, x, ce);
    if (trace && rationalRoots.length > 0)
      traceStep(
        trace,
        'solve.rational-roots',
        rootsAsEquations(ce, x, rationalRoots)
      );
    const result: Expression[] = [...rationalRoots];
    // For the remaining (irrational) roots, prefer an exact reduction of a
    // sparse polynomial (gcd of exponents > 1, e.g. a biquadratic via u = x²)
    // over the numeric Durand–Kerner fallback (a general cubic or quartic, e.g.
    // `3x³−18x²+33x−19`). Real roots not already found are added; `validateRoots`
    // discards any spurious ones.
    if (rationalRoots.length < deg) {
      const extra =
        solveByPowerGcdSubstitution(polyExpr, x) ??
        numericRealRoots(polyExpr, x, ce);
      const added: Expression[] = [];
      for (const nr of extra) {
        const v = nr.N().re;
        if (
          !result.some(
            (r) => Math.abs(r.N().re - v) <= 1e-7 * (1 + Math.abs(v))
          )
        ) {
          result.push(nr);
          added.push(nr);
        }
      }
      if (trace && added.length > 0)
        traceStep(
          trace,
          'solve.polynomial-roots',
          rootsAsEquations(ce, x, added)
        );
    }
    return result;
  }
  return [];
}

/** Harmonization rules transform an expr into one or more equivalent
 * expressions that are easier to solve */
export const HARMONIZATION_RULES: Rule[] = [
  // |f(x)| + c -> f(x)+c, -f(x)+c.  A case-split: a branch root that isn't a
  // genuine solution (|f| = -c when -c < 0) is dropped by `validateRoots`. The
  // single `_f` capture handles any inner form uniformly — bare `x` (`|x| = 2`),
  // unit coefficients (`|x-1| = 2`), and `|ax+b|` alike.
  {
    match: ['Add', ['Abs', '_f'], '__c'],
    replace: ['Add', '_f', '__c'],
    condition: ({ _f }) => _f.has('_x'),
  },
  {
    match: ['Add', ['Abs', '_f'], '__c'],
    replace: ['Add', ['Negate', '_f'], '__c'],
    condition: ({ _f }) => _f.has('_x'),
  },
  // |f(x)| = |g(x)|  (i.e. |f| - |g| = 0)  ->  f² - g² = 0.  Exact: |f| = |g|
  // iff f² = g², so squaring introduces no extraneous roots here.
  {
    match: ['Add', ['Abs', '_f'], ['Negate', ['Abs', '_g']]],
    replace: ['Subtract', ['Square', '_f'], ['Square', '_g']],
    condition: ({ _f, _g }) => (_f?.has('_x') && _g?.has('_x')) ?? false,
  },
  // a·|f(x)| + b·|g(x)| = 0  ->  a²f² - b²g² = 0.  Squaring a|f| = -b|g| gives
  // a²f² = b²g² — a *necessary* condition (candidate-generating, not an
  // equivalence: same-sign coefficients have no root unless f = g = 0), so
  // `validateRoots` against the original equation filters the extraneous
  // candidates. `useVariations` lets a bare `|g|` match as `1·|g|` and a
  // `Negate(|g|)` as `-1·|g|`, so `|x+3| − 2|x−3|` and `2|x| − |x−1|` both fire.
  {
    match: [
      'Add',
      ['Multiply', '__a', ['Abs', '_f']],
      ['Multiply', '__b', ['Abs', '_g']],
    ],
    replace: [
      'Subtract',
      ['Multiply', ['Square', '__a'], ['Square', '_f']],
      ['Multiply', ['Square', '__b'], ['Square', '_g']],
    ],
    useVariations: true,
    condition: ({ __a, __b, _f, _g }) =>
      !__a.has('_x') &&
      !__b.has('_x') &&
      (_f?.has('_x') ?? false) &&
      (_g?.has('_x') ?? false),
  },
  // a(b^n) -> a
  {
    match: ['Multiply', '__a', ['Power', '_b', '_n']],
    replace: (_x: Expression, sub: BoxedSubstitution) => sub._b,
    condition: ({ __a, _b, _n }) =>
      !__a.has('_x') && _b.has('_x') && !_n.isSame(0) && !_n.has('_x'),
  },
  // a√b(x)  -> a^2 b(x)
  {
    match: ['Multiply', '__a', ['Sqrt', '_b']],
    replace: ['Multiply', ['Square', '__a'], '_b'],
    condition: ({ _b }) => _b.has('_x'),
  },
  // a(x)/b -> a(x)
  {
    match: ['Divide', '_a', '_b'],
    replace: (_x: Expression, sub: BoxedSubstitution) => sub._a,
    // @todo: check _b after the substitution
    condition: ({ _a, _b }) => _a.has('_x') && !_b.isSame(0),
  },
  // ab(x) -> b(x)
  // The solution for a product are the solutions for each term,
  {
    match: ['Multiply', '__a', '_b'],
    replace: (_x: Expression, sub: BoxedSubstitution) => sub._b,
    condition: ({ __a, _b }) => !__a.has('_x') && _b.has('_x'),
  },
  // ln(a(x))+ln(b(x))+c -> ln(a(x)b(x)) + c
  {
    match: ['Add', ['Ln', '_a'], ['Ln', '_b'], '___c'],
    replace: ['Add', ['Ln', ['Multiply', '_a', '_b']], '___c'],
  },
  // e^a * e^b * c -> e^(a+b) * c
  {
    match: ['Multiply', ['Exp', '_a'], ['Exp', '_b'], '___c'],
    replace: ['Multiply', ['Exp', ['Add', '_a', '_b']], '___c'],
  },
  // e^f + e^-f (+ c) -> 2·cosh(f) (+ c). `e^{-f}` canonicalizes to
  // `Power(ExponentialE, Negate(f))`, so match that shape directly. The Cosh
  // solve template then produces both ±arcosh roots (e.g. `e^x + e^-x = 4`).
  {
    match: [
      'Add',
      ['Power', 'ExponentialE', '_f'],
      ['Power', 'ExponentialE', ['Negate', '_f']],
      '___c',
    ],
    replace: ['Add', ['Multiply', 2, ['Cosh', '_f']], '___c'],
    condition: ({ _f }) => _f.has('_x'),
  },
  // e^f - e^-f (+ c) -> 2·sinh(f) (+ c).
  {
    match: [
      'Add',
      ['Power', 'ExponentialE', '_f'],
      ['Negate', ['Power', 'ExponentialE', ['Negate', '_f']]],
      '___c',
    ],
    replace: ['Add', ['Multiply', 2, ['Sinh', '_f']], '___c'],
    condition: ({ _f }) => _f.has('_x'),
  },
  // ln(f(x)) -> f(x) - 1
  {
    match: ['Ln', '_a'],
    replace: ['Subtract', '_a', 1],
    // @todo: additional condition, f(x) > 0
    condition: ({ _a }) => _a.has('_x'),
  },
  // sin(f(x)) -> f(x)
  {
    match: ['Sin', '_a'],
    replace: (_x: Expression, sub: BoxedSubstitution) => sub._a,
    condition: ({ _a }) => _a.has('_x'),
  },
  // cos(f(x)) -> f(x) - π/2
  {
    match: ['Cos', '_a'],
    replace: ['Subtract', '_a', ['Divide', 'Pi', 2]],
    condition: ({ _a }) => _a.has('_x'),
  },
  // tan(f(x)) -> f(x)
  {
    match: ['Tan', '_a'],
    replace: (_x: Expression, sub: BoxedSubstitution) => sub._a,
    condition: ({ _a }) => _a.has('_x'),
  },
  // sin(a) + cos(a) -> 1
  {
    match: ['Add', ['Sin', '_a'], ['Cos', '_a']],
    replace: 1,
    condition: ({ _a }) => _a.has('_x'),
  },
  // sin^2(a) - cos^2(a) -> sin(x) +/- √(2)/2 (the two branch values)
  {
    match: ['Subtract', ['Square', ['Sin', '_a']], ['Square', ['Cos', '_a']]],
    replace: [
      'List',
      ['Subtract', ['Sin', '_a'], ['Divide', ['Sqrt', 2], 2]],
      ['Add', ['Sin', '_a'], ['Divide', ['Sqrt', 2], 2]],
    ],
    condition: ({ _a }) => _a.has('_x'),
  },
];

/** Maximum number of chained harmonization rewrites applied to a single
 * expression (a harmonization rule may apply to the result of another one,
 * e.g. `ln(a)+ln(b) → ln(ab)` then `ln(f(x)) → f(x) - 1`). */
const MAX_HARMONIZATION_DEPTH = 4;

/** Transform expr into one or more equivalent expressions (with the same
 * root set) that are easier to solve.
 *
 * The unknown in `expr` is the literal `_x` symbol; the substitution
 * pre-binds the `_x` wildcard to it so that the harmonization rule patterns
 * (which use `_x` for the unknown) match it, and so that other wildcards may
 * capture subexpressions containing the unknown (their rule conditions, e.g.
 * `_a.has('_x')`, decide whether the capture is acceptable).
 *
 * Rules are chained (breadth-first, up to `MAX_HARMONIZATION_DEPTH`): every
 * intermediate form is returned, least-rewritten first.
 */
function harmonize(expr: Expression): Expression[] {
  const ce = expr.engine;
  const rules = ce.getRuleSet('harmonization')!;
  const sub = { _x: ce.symbol('_x') };

  const results: Expression[] = [];
  let frontier: Expression[] = [expr];
  for (
    let depth = 0;
    depth < MAX_HARMONIZATION_DEPTH && frontier.length > 0;
    depth++
  ) {
    const next: Expression[] = [];
    for (const e of frontier) {
      for (const h of matchAnyRules(e, rules, sub)) {
        if (h.isSame(expr) || results.some((r) => r.isSame(h))) continue;
        results.push(h);
        next.push(h);
      }
    }
    frontier = next;
  }
  return results;
}

function validateRoots(
  expr: Expression,
  x: string,
  roots: ReadonlyArray<Expression>,
  trace?: RuleSteps
): Expression[] {
  const validRoots = roots.filter((root) => {
    // A validity-guarded root `When(v, guard)` is verified by its *value* `v`
    // (the guard already restricts the domain, decision 8): substituting the
    // `When` itself threads a guard-wrapped residual that never compares equal
    // to 0. The `When` (guard carried) is what stays in the solution list.
    const probe = isFunction(root, 'When') ? root.op1 : root;
    // Evaluate the expression at the root
    const value = expr.subs({ [x]: probe }).canonical.evaluate();
    if (value === null) return false;
    if (!value.isValid) return false;
    if (value.isNaN) return false;
    if (value.has(x)) return false;

    // Important: we want to use `isEqual()`, not `is(0)` here
    // The former accounts for tolerance, the latter does not.
    if (value.isEqual(0)) return true;

    // For a fully numeric value (no unknowns left), `isEqual(0)` is
    // definitive: do NOT fall back to symbolic simplification, which may
    // wrongly accept an extraneous root (e.g. simplification rules like
    // `ln(a) + ln(b) → ln(ab)` assume principal domains and can collapse a
    // non-zero constant to 0).
    if (value.unknowns.length === 0) return false;

    // A root with a symbolic (parametric) coefficient — e.g. the quadratic
    // formula for `x^2 - a x + 1 = 0` — substituted back into the equation
    // produces an expression that is zero, but only recognizably so after
    // symbolic simplification. An unsimplified `evaluate()` leaves it as a
    // non-zero-looking expression, so without this the valid root would be
    // discarded (issue #300).
    return value.simplify().isEqual(0);
  });

  // Record the extraneous candidates rejected by substitution into the
  // original equation (dropped duplicates below are not "rejected").
  if (trace && validRoots.length < roots.length) {
    const rejected = roots.filter((r) => !validRoots.some((v) => v.isSame(r)));
    traceStep(
      trace,
      'solve.validate-roots',
      rootsAsEquations(expr.engine, x, rejected)
    );
  }

  // Deduplicate roots (e.g., arccos(1) and -arccos(1) both equal 0)
  const uniqueRoots: Expression[] = [];
  for (const root of validRoots) {
    const isDuplicate = uniqueRoots.some(
      (existing) => existing.isSame(root) || existing.isEqual(root)
    );
    if (!isDuplicate) uniqueRoots.push(root);
  }

  return uniqueRoots;
}

/** Filter solutions by the declared type of the variable.
 * For example, if the variable is declared as integer, discard non-integer roots.
 */
function filterRootsByType(
  ce: ComputeEngine,
  x: string,
  roots: ReadonlyArray<Expression>,
  trace?: RuleSteps
): ReadonlyArray<Expression> {
  const varTypeObj = ce.symbol(x).type;
  const vt = varTypeObj.type;
  // Only filter for specific numeric subtypes
  if (typeof vt !== 'string' || vt === 'number' || vt === 'unknown')
    return roots;

  const filtered = roots.filter((root) => {
    const val = root.evaluate();
    if (varTypeObj.matches('integer') || varTypeObj.matches('finite_integer'))
      return val.isInteger === true;
    if (varTypeObj.matches('rational') || varTypeObj.matches('finite_rational'))
      return val.isRational === true;
    if (varTypeObj.matches('real') || varTypeObj.matches('finite_real'))
      return val.isReal === true;
    return true;
  });

  if (trace && filtered.length < roots.length) {
    const dropped = roots.filter((r) => !filtered.includes(r));
    traceStep(trace, 'solve.filter-domain', rootsAsEquations(ce, x, dropped));
  }

  return filtered;
}

/**
 * Solve a quadratic `a·x² + b·x + c = 0` by extracting its coefficients and
 * applying the quadratic formula.
 *
 * This is more robust than surface pattern matching: `getPolynomialCoefficients`
 * normalizes every sign and coefficient form (numeric, symbolic, negated), so a
 * negated middle term such as `Negate(Multiply(a, x))` — which the rule pattern
 * `Multiply(__b, _x)` does not match — is handled correctly.
 *
 * Returns the two roots (which may coincide), or `[]` if `expr` is not a degree-2
 * polynomial in `variable`. The caller is responsible for validating and
 * deduplicating the returned roots.
 */
function solveQuadraticByCoefficients(
  expr: Expression,
  variable: string
): Expression[] {
  const ce = expr.engine;
  const coeffs = getPolynomialCoefficients(expr, variable);
  // Coefficients are in ascending order: [c, b, a] for a·x² + b·x + c.
  if (!coeffs || coeffs.length !== 3) return [];
  const [c, b, a] = coeffs;
  if (a.isSame(0)) return [];

  // Pure quadratic (b = 0): x² = −c/a → x = ±√(−c/a), computed directly. The
  // general formula's discriminant is −4ac here, and √(−4ac) fails to factor out
  // its perfect-square 4 when c is itself a radical (e.g. √(2√5−2) arising from
  // the power-gcd substitution x² = u), numericizing the root — √(−c/a) stays
  // exact and matches the pure-power rule's output.
  if (b.isSame(0)) {
    const root = ce.function('Divide', [c.neg(), a]).sqrt();
    return [root, root.neg()];
  }

  // discriminant = b² − 4ac, built with canonical `Multiply`/`Subtract`
  // (`ce.function`), which fold exact operands EXACTLY; the `.mul()`/`.sub()`
  // methods fold two number literals to a float, numericizing irrational roots.
  const discriminant = ce.function('Subtract', [
    ce.function('Multiply', [b, b]),
    ce.function('Multiply', [ce.number(4), a, c]),
  ]);
  const sqrtDiscriminant = discriminant.sqrt();
  const twoA = ce.function('Multiply', [a, ce.number(2)]);
  const negB = b.neg();

  // x = (-b ± √(b² - 4ac)) / (2a). Build the numerator with a canonical `Add`
  // (`ce.function`), which folds exact operands EXACTLY (e.g. `-1 + √5`); the
  // `.add()`/`.sub()` methods instead fold two number literals to a float, which
  // would numericize every irrational root (a latent bug uncovered when the
  // polynomial fast path routed all quadratics through here — P1-2).
  return [
    ce.function('Add', [negB, sqrtDiscriminant]).div(twoA),
    ce.function('Subtract', [negB, sqrtDiscriminant]).div(twoA),
  ];
}

/**
 * Use the rational root theorem to find rational roots of a polynomial.
 *
 * Given polynomial a_n*x^n + ... + a_1*x + a_0, the possible rational roots
 * are +/- (divisors of a_0) / (divisors of a_n).
 *
 * Each candidate is validated by substitution into the original expression.
 */
function findRationalRoots(
  expr: Expression,
  variable: string,
  ce: ComputeEngine
): Expression[] {
  const coeffs = getPolynomialCoefficients(expr, variable);
  if (!coeffs) return [];

  const degree = coeffs.length - 1;
  if (degree < 1) return [];

  // coeffs are in ascending order: [a_0, a_1, ..., a_n]
  const constantInt = asSmallInteger(coeffs[0]);
  const leadingInt = asSmallInteger(coeffs[degree]);
  if (leadingInt === null || constantInt === null) return [];
  if (leadingInt === 0 || constantInt === 0) return [];

  const divisors = (n: number): number[] => {
    n = Math.abs(n);
    const result: number[] = [];
    for (let i = 1; i * i <= n; i++) {
      if (n % i === 0) {
        result.push(i);
        if (i !== n / i) result.push(n / i);
      }
    }
    return result;
  };

  const pDivisors = divisors(constantInt);
  const qDivisors = divisors(leadingInt);
  const candidates: number[] = [];
  const seen = new Set<number>();
  for (const p of pDivisors) {
    for (const q of qDivisors) {
      for (const sign of [1, -1]) {
        const val = (sign * p) / q;
        if (!seen.has(val)) {
          seen.add(val);
          candidates.push(val);
        }
      }
    }
  }

  // Safety limit: don't test too many candidates
  if (candidates.length > 100) return [];

  const roots: Expression[] = [];
  for (const candidate of candidates) {
    const root = ce.number(candidate);
    const value = expr.subs({ [variable]: root }).N();
    if (value.isSame(0)) roots.push(root);
  }
  return roots;
}

/**
 * Numeric **real** roots of a univariate polynomial with numeric coefficients,
 * via Durand–Kerner. Used as a last-resort fallback for general cubics/quartics
 * (and higher) that have no rational root, so `solve` returns approximate real
 * roots instead of nothing. Returns `[]` when the coefficients aren't all
 * numeric, the degree is impractically large, or the iteration fails to
 * converge — leaving the (exact) symbolic paths untouched.
 */
function numericRealRoots(
  expr: Expression,
  variable: string,
  ce: ComputeEngine
): Expression[] {
  const coeffs = getPolynomialCoefficients(expr, variable);
  if (!coeffs) return [];
  if (coeffs.length - 1 > 12) return []; // degree cap

  const nums: number[] = [];
  for (const c of coeffs) {
    const v = c.N().re;
    if (!Number.isFinite(v)) return []; // a symbolic/parametric coefficient
    nums.push(v);
  }

  const roots = realPolynomialRoots(nums, ce._deadline);
  if (roots === null) return [];
  return roots.map((r) => ce.number(r));
}
