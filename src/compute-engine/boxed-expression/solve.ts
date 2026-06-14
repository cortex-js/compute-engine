import { matchAnyRules } from './rules';
import { expand } from './expand';
import type {
  Expression,
  BoxedSubstitution,
  IComputeEngine as ComputeEngine,
  Rule,
} from '../global-types';
import { isNumber, isFunction, isSymbol, numericValue } from './type-guards';
import { polynomialDegree, getPolynomialCoefficients } from './polynomials';
import { asSmallInteger } from './numerics';
import { realPolynomialRoots } from '../numerics/polynomial-roots';

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

export const UNIVARIATE_ROOTS: Rule[] = [
  // ax = 0
  {
    match: ['Multiply', '_x', '__a'],
    replace: 0,
    id: 'ax',
    condition: filter,
  },

  // a/x + b = 0
  {
    match: ['Add', ['Divide', '_a', '_x'], '__b'],
    replace: Infinity,
    useVariations: true, // Handle a/x = 0
    condition: filter,
  },

  // ax + b = 0
  {
    match: ['Add', ['Multiply', '_x', '__a'], '__b'],
    replace: ['Divide', ['Negate', '__b'], '__a'],
    useVariations: true, // Handle ax = 0
    condition: filter,
  },

  // -ax + b = 0  =>  x = b/a
  // This handles cases where the coefficient is negative and represented as Negate(Multiply(...))
  {
    match: ['Add', ['Negate', ['Multiply', '_x', '__a']], '__b'],
    replace: ['Divide', '__b', '__a'],
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

    useVariations: true,
    condition: (sub) => filter(sub) && !sub._n.isSame(0),
  },

  {
    match: ['Add', ['Multiply', '_a', ['Power', '_x', '_n']], '__b'],
    replace: [
      'Negate',
      ['Power', ['Divide', ['Negate', '__b'], '_a'], ['Divide', 1, '_n']],
    ],

    useVariations: true,
    condition: (sub: { _n }) =>
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
    useVariations: true,
    condition: filter,
  },

  // a^x + b = 0
  {
    id: 'a^x + b = 0',
    match: ['Add', ['Power', '_a', '_x'], '__b'],
    replace: ['Ln', ['Negate', '__b'], '_a'],
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
    useVariations: true,
    condition: (sub) =>
      filter(sub) &&
      ((!sub.__a.isSame(0) && sub.__c.div(sub.__a).isNegative) ?? false),
  },

  // a * e^(x) + c = 0
  {
    match: ['Add', ['Multiply', '__a', ['Exp', '_x']], '__c'],
    replace: ['Ln', ['Negate', ['Divide', '__c', '__a']]],
    useVariations: true,
    condition: (sub) =>
      filter(sub) &&
      ((!sub.__a.isSame(0) && sub.__c.div(sub.__a).isNegative) ?? false) &&
      !sub.__a.has('_x') &&
      !sub.__c.has('_x'),
  },

  // e^(x) + c = 0
  {
    match: ['Add', ['Exp', '_x'], '__c'],
    replace: ['Ln', ['Negate', '__c']],
    useVariations: true,
    condition: (sub) => filter(sub) && (sub.__c.isNegative ?? false),
  },

  // e^(bx) + c = 0
  {
    match: ['Add', ['Exp', ['Multiply', '__b', '_x']], '__c'],
    replace: ['Divide', ['Ln', ['Negate', '__c']], '__b'],
    useVariations: true,
    condition: (sub) => filter(sub) && (sub.__c.isNegative ?? false),
  },

  // a * log_b(x) + c = 0
  {
    match: ['Add', ['Multiply', '__a', ['Log', '_x', '__b']], '__c'],
    replace: ['Power', '__b', ['Negate', ['Divide', '__c', '__a']]],
    useVariations: true,
    condition: (sub) =>
      (filter(sub) && !sub.__a.isSame(0) && sub.__b.isPositive) ?? false,
  },

  // a * log_b(x) = 0
  {
    match: ['Multiply', '__a', ['Log', '_x', '__b']],
    replace: ['Power', '__b', ['Negate', ['Divide', '__c', '__a']]],
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
    condition: filter,
  },
  {
    match: ['Add', ['Abs', ['Add', ['Multiply', '__a', '_x'], '__b']], '__c'],
    replace: ['Divide', ['Negate', ['Add', '__b', '__c']], '__a'],
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
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      // Check that -b/a >= 0 for the solution to be valid
      const a = sub.__a;
      const b = sub.__b;
      if (!a || !b) return false;
      const ratio = b.div(a);
      return ratio.isNonPositive ?? true; // Allow if we can't determine sign
    },
  },

  // a·ln(x) + b = 0  =>  x = e^(-b/a)
  {
    match: ['Add', ['Multiply', '__a', ['Ln', '_x']], '__b'],
    replace: ['Exp', ['Divide', ['Negate', '__b'], '__a']],
    useVariations: true,
    condition: filter,
  },

  // ln(x) + b = 0  =>  x = e^(-b)
  {
    match: ['Add', ['Ln', '_x'], '__b'],
    replace: ['Exp', ['Negate', '__b']],
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
    replace: ['Arcsin', ['Divide', ['Negate', '__b'], '__a']],
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      // Check that -b/a is in [-1, 1] for real solutions
      const a = sub.__a;
      const b = sub.__b;
      if (!a || a.isSame(0)) return false;
      const ratio = b.div(a).neg();
      const val = numericValue(ratio);
      if (val === undefined) return true; // Allow symbolic ratios
      if (typeof val === 'number') return Math.abs(val) <= 1;
      return true;
    },
  },

  // Second solution for sin: x = π - arcsin(-b/a)
  {
    match: ['Add', ['Multiply', '__a', ['Sin', '_x']], '__b'],
    replace: [
      'Subtract',
      'Pi',
      ['Arcsin', ['Divide', ['Negate', '__b'], '__a']],
    ],
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const a = sub.__a;
      const b = sub.__b;
      if (!a || a.isSame(0)) return false;
      const ratio = b.div(a).neg();
      const val = numericValue(ratio);
      if (val === undefined) return true;
      if (typeof val === 'number') return Math.abs(val) <= 1;
      return true;
    },
  },

  // sin(x) + b = 0  =>  x = arcsin(-b)  (when a = 1)
  {
    match: ['Add', ['Sin', '_x'], '__b'],
    replace: ['Arcsin', ['Negate', '__b']],
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const b = sub.__b;
      const val = numericValue(b);
      if (val === undefined) return true;
      if (typeof val === 'number') return Math.abs(val) <= 1;
      return true;
    },
  },

  // Second solution for sin(x) + b = 0: x = π - arcsin(-b)
  {
    match: ['Add', ['Sin', '_x'], '__b'],
    replace: ['Subtract', 'Pi', ['Arcsin', ['Negate', '__b']]],
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const b = sub.__b;
      const val = numericValue(b);
      if (val === undefined) return true;
      if (typeof val === 'number') return Math.abs(val) <= 1;
      return true;
    },
  },

  // a·cos(x) + b = 0  =>  x = arccos(-b/a)
  // Valid when -1 ≤ -b/a ≤ 1
  {
    match: ['Add', ['Multiply', '__a', ['Cos', '_x']], '__b'],
    replace: ['Arccos', ['Divide', ['Negate', '__b'], '__a']],
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const a = sub.__a;
      const b = sub.__b;
      if (!a || a.isSame(0)) return false;
      const ratio = b.div(a).neg();
      const val = numericValue(ratio);
      if (val === undefined) return true;
      if (typeof val === 'number') return Math.abs(val) <= 1;
      return true;
    },
  },

  // Second solution for cos: x = -arccos(-b/a)  (since cos(-x) = cos(x))
  {
    match: ['Add', ['Multiply', '__a', ['Cos', '_x']], '__b'],
    replace: ['Negate', ['Arccos', ['Divide', ['Negate', '__b'], '__a']]],
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const a = sub.__a;
      const b = sub.__b;
      if (!a || a.isSame(0)) return false;
      const ratio = b.div(a).neg();
      const val = numericValue(ratio);
      if (val === undefined) return true;
      if (typeof val === 'number') return Math.abs(val) <= 1;
      return true;
    },
  },

  // cos(x) + b = 0  =>  x = arccos(-b)  (when a = 1)
  {
    match: ['Add', ['Cos', '_x'], '__b'],
    replace: ['Arccos', ['Negate', '__b']],
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const b = sub.__b;
      const val = numericValue(b);
      if (val === undefined) return true;
      if (typeof val === 'number') return Math.abs(val) <= 1;
      return true;
    },
  },

  // Second solution for cos(x) + b = 0: x = -arccos(-b)
  {
    match: ['Add', ['Cos', '_x'], '__b'],
    replace: ['Negate', ['Arccos', ['Negate', '__b']]],
    useVariations: true,
    condition: (sub) => {
      if (!filter(sub)) return false;
      const b = sub.__b;
      const val = numericValue(b);
      if (val === undefined) return true;
      if (typeof val === 'number') return Math.abs(val) <= 1;
      return true;
    },
  },

  // a·tan(x) + b = 0  =>  x = arctan(-b/a)
  // Tan has no domain restriction for the ratio
  {
    match: ['Add', ['Multiply', '__a', ['Tan', '_x']], '__b'],
    replace: ['Arctan', ['Divide', ['Negate', '__b'], '__a']],
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
    useVariations: true,
    condition: filter,
  },

  // a·cot(x) + b = 0  =>  x = arccot(-b/a)
  {
    match: ['Add', ['Multiply', '__a', ['Cot', '_x']], '__b'],
    replace: ['Arccot', ['Divide', ['Negate', '__b'], '__a']],
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
    useVariations: true,
    condition: filter,
  },

  // a·sin(x) + b·cos(x) = 0  =>  tan(x) = -b/a  =>  x = arctan(-b/a)
  // Handles e.g. sin(x) = cos(x) (a = 1, b = -1 → arctan(1) = π/4). The two
  // standalone sin/cos rules above don't fire here because their constant term
  // `__b` would capture the other trig term, which contains `_x` (rejected by
  // `filter`).
  {
    match: ['Add', ['Multiply', '__a', ['Sin', '_x']], ['Multiply', '__b', ['Cos', '_x']]],
    replace: ['Arctan', ['Divide', ['Negate', '__b'], '__a']],
    useVariations: true,
    condition: (sub) => filter(sub) && !sub.__a.isSame(0),
  },
];

/**
 * Clear denominators from an Add expression by multiplying through by the LCM
 * of all denominators. For example, `F - 3x/h` becomes `F*h - 3x`.
 *
 * This transformation preserves the roots of the equation (assuming denominators
 * are non-zero) and allows the solve rules to match expressions that would
 * otherwise have nested Divide operators.
 *
 * Also handles the case where the variable is in the denominator (e.g., `a/x - b`
 * becomes `a - bx` after multiplying by x).
 */
function clearDenominators(expr: Expression, _variable?: string): Expression {
  if (!isFunction(expr, 'Add')) return expr;

  const ops = expr.ops;
  if (ops.length === 0) return expr;

  // Collect all non-trivial denominators. A denominator of the form `1^a`
  // is trivially 1 (e.g. `.denominator` of `e^x` is `1^x`): multiplying
  // through by it would needlessly mangle the expression (e.g. `e^x - 5`
  // would become `1^x e^x - 5·1^x`, which no root template matches).
  const denominators = ops
    .map((op) => op.denominator)
    .filter(
      (d) => !d.isSame(1) && !(isFunction(d, 'Power') && d.op1.isSame(1))
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

  // Multiply the entire expression by the LCM and simplify
  return expr.mul(lcm).simplify();
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
  variable: string
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

  const substitute = (node: Expression): Expression => {
    if (node.isSame(sqrtTerm)) return t;
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
    if (2 * k + 1 < coeffs.length)
      a = a.add(coeffs[2 * k + 1].mul(rPow));
    rPow = rPow.mul(radicand);
  }

  // A·√R + B = 0  ⟹  A²·R = B²  ⟹  A²·R − B² = 0
  const squared = a.mul(a).mul(radicand).sub(b.mul(b));
  if (squared.has(tName)) return null; // safety: substitution incomplete
  if (squared.has(variable) === false) return null;
  // Solve the sqrt-free polynomial; extraneous roots from squaring are removed
  // by the caller's validation against the original equation.
  return findUnivariateRoots(squared.simplify(), variable);
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
  variable: string
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
      return solveTwoSqrtEquationCore(ce, gExpr, fExpr, eExpr, fSign, variable);
    }
    // Both negative: -√f - √g = e, i.e., √f + √g = -e
    // This only has solutions if -e ≥ 0 and both sqrts can equal parts of it
    return null;
  }

  return solveTwoSqrtEquationCore(ce, fExpr, gExpr, eExpr, gSign, variable);
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
  variable: string
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

  // Solve the polynomial equation
  const solutions = findUnivariateRoots(finalEquation, variable);

  if (solutions.length === 0) return null;

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
  variable: string
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
  x: string
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

  const uRoots = findUnivariateRoots(rewrite(expr), uName);
  if (uRoots.length === 0) return null;

  // Back-substitute x = uᵈ; extraneous roots are dropped by the caller's
  // validation against the original equation.
  return uRoots.map((ur) => ur.pow(d));
}

/**
 * MathJsonExpression is a function of a single variable (`x`) or an Equality
 *
 * Return the roots of that variable
 *
 */
export function findUnivariateRoots(
  expr: Expression,
  x: string
): ReadonlyArray<Expression> {
  const ce = expr.engine;

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
    }

    expr = expand(lhs).sub(expand(rhs)).simplify();

    // Validate against the ORIGINAL (unpeeled, unsimplified) equation:
    // simplification rules may assume principal domains (e.g.
    // `ln(a) + ln(b) → ln(ab)`), which would make extraneous roots
    // introduced by the transformations below appear valid.
    originalExpr = lhs0.sub(rhs0);
  } else {
    originalExpr = expr;
    expr = expand(expr).simplify();
  }

  // Clear denominators to enable matching of expressions like F - 3x/h = 0
  expr = clearDenominators(expr);

  // Try to solve equations with two sqrt terms: √(f(x)) + √(g(x)) = e
  // Pattern 3: Uses double squaring to eliminate both sqrts
  const twoSqrtSolutions = solveTwoSqrtEquation(expr, x);
  if (twoSqrtSolutions !== null) {
    // Solutions are already validated inside the function
    return twoSqrtSolutions;
  }

  // Try to solve nested sqrt equations: √(f(x, √x)) = a
  // This uses substitution u = √x, solves for u, then converts back to x = u²
  const nestedSqrtSolutions = solveNestedSqrtEquation(expr, x);
  if (nestedSqrtSolutions !== null) {
    // Validate and return the solutions
    return validateRoots(originalExpr, x, nestedSqrtSolutions);
  }

  // Transform sqrt-linear equations: √(f(x)) = g(x) → f(x) - g(x)² = 0
  // This handles Pattern 2: √(ax+b) = cx+d by squaring both sides.
  // Must be done before pattern matching so quadratic formula can match.
  // Note: This can introduce extraneous roots, which are filtered by validateRoots().
  expr = transformSqrtLinearEquation(expr, x);

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
    const matchRoots = (expr: Expression): Expression[] =>
      matchAnyRules(
        expr,
        rules,
        { _x: ce.symbol('_x') },
        { useVariations: true, form: 'canonical' }
      );

    result = exprs.flatMap(matchRoots);

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
      result = harmonized.flatMap(matchRoots);
    }

    if (result.length === 0) {
      // Expand the original and harmonized forms (harmonization may produce
      // factored forms like `x(x+2) - 1` whose roots only match once
      // expanded), then harmonize once more
      const expanded = [...exprs, ...harmonized]
        .map((expr) => expand(expr.canonical))
        .filter((expr) => expr !== null);
      result = [
        ...expanded,
        ...expanded.flatMap((expr) => harmonize(expr)),
      ].flatMap(matchRoots);
    }

    // Fallback: solve polynomials via coefficient extraction when the
    // rule-based matching above didn't fire.
    if (result.length === 0) {
      const deg = polynomialDegree(originalExpr, x);
      if (deg === 2) {
        // The quadratic rules match the surface form `Multiply(__b, _x)` for
        // the middle term, but a negated symbolic/unit coefficient
        // canonicalizes to `Negate(Multiply(b, x))` (or `Negate(x)`), which
        // that pattern misses — so e.g. `x^2 - a x + 1 = 0` found no roots.
        // Coefficient extraction handles every sign form uniformly (#300).
        const quadraticRoots = solveQuadraticByCoefficients(originalExpr, x);
        if (quadraticRoots.length > 0) result = quadraticRoots;
      } else if (deg >= 3) {
        // Exact rational roots first (rational-root theorem)…
        const rationalRoots = findRationalRoots(originalExpr, x, ce);
        result = [...rationalRoots];
        // …then a numeric Durand–Kerner fallback for the general case (a cubic
        // or quartic with irrational roots, e.g. `3x³−18x²+33x−19`, otherwise
        // returns nothing). Real roots not already found exactly are added as
        // numeric approximations; `validateRoots` discards any spurious ones.
        if (rationalRoots.length < deg) {
          for (const nr of numericRealRoots(originalExpr, x, ce)) {
            const v = nr.re;
            if (
              !result.some(
                (r) => Math.abs(r.N().re - v) <= 1e-7 * (1 + Math.abs(v))
              )
            )
              result.push(nr);
          }
        }
      }
    }

    // Single-sqrt elimination: A(x)·√R(x) + B(x) = 0 → A²R - B² = 0 (a √ term
    // with a non-constant coefficient, e.g. x·√(x²+1) = 1), which the
    // sqrt-linear transform above intentionally skips.
    if (result.length === 0) {
      const sqrtRoots = solveSingleSqrtEquation(expr, x);
      if (sqrtRoots) result = [...sqrtRoots];
    }

    // Homogenization: equations that are polynomials in a rational power of the
    // unknown (e.g. 2√x + 3·⁴√x = 2) — substitute u = x^{1/d}, solve, invert.
    if (result.length === 0) {
      const substRoots = solveByRationalPowerSubstitution(originalExpr, x);
      if (substRoots) result = [...substRoots];
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

  // Validate the roots against the ORIGINAL expression (before clearing
  // denominators and harmonization). This filters out extraneous roots that
  // may have been introduced by algebraic transformations.
  const validatedRoots = validateRoots(
    originalExpr,
    x,
    result.map((x) => x.evaluate().simplify())
  );

  // Filter solutions by the declared type of the variable
  return filterRootsByType(ce, x, validatedRoots);
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
  // a(b^n) -> a
  {
    match: ['Multiply', '__a', ['Power', '_b', '_n']],
    replace: '_b',
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
    replace: '_a',
    // @todo: check _b after the substitution
    condition: ({ _a, _b }) => _a.has('_x') && !_b.isSame(0),
  },
  // ab(x) -> b(x)
  // The solution for a product are the solutions for each term,
  {
    match: ['Multiply', '__a', '_b'],
    replace: '_b',
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
    replace: '_a',
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
    replace: '_a',
    condition: ({ _a }) => _a.has('_x'),
  },
  // sin(a) + cos(a) -> 1
  {
    match: ['Add', ['Sin', '_a'], ['Cos', '_a']],
    replace: 1,
    condition: ({ _a }) => _a.has('_x'),
  },
  // sin^2(a) - cos^2(a) -> sin(x) +/- √(2)/2
  {
    match: ['Subtract', ['Square', ['Sin', '_a']], ['Square', ['Cos', '_a']]],
    replace: ['PlusMinus', ['Sin', '_a'], ['Divide', ['Sqrt', 2], 2]],
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
  roots: ReadonlyArray<Expression>
): Expression[] {
  const validRoots = roots.filter((root) => {
    // Evaluate the expression at the root
    const value = expr.subs({ [x]: root }).canonical.evaluate();
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
  roots: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  const varTypeObj = ce.symbol(x).type;
  const vt = varTypeObj.type;
  // Only filter for specific numeric subtypes
  if (typeof vt !== 'string' || vt === 'number' || vt === 'unknown')
    return roots;

  return roots.filter((root) => {
    const val = root.evaluate();
    if (varTypeObj.matches('integer') || varTypeObj.matches('finite_integer'))
      return val.isInteger === true;
    if (varTypeObj.matches('rational') || varTypeObj.matches('finite_rational'))
      return val.isRational === true;
    if (varTypeObj.matches('real') || varTypeObj.matches('finite_real'))
      return val.isReal === true;
    return true;
  });
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

  // discriminant = b² - 4·a·c
  const discriminant = b.mul(b).sub(ce.number(4).mul(a).mul(c));
  const sqrtDiscriminant = discriminant.sqrt();
  const twoA = a.mul(2);
  const negB = b.neg();

  // x = (-b ± √(b² - 4ac)) / (2a)
  return [
    negB.add(sqrtDiscriminant).div(twoA),
    negB.sub(sqrtDiscriminant).div(twoA),
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
