import { isInequalityOperator } from '../latex-syntax/utils';
import { matchAnyRules } from './rules';
import { expand } from './expand';
import type {
  BoxedExpression,
  BoxedSubstitution,
  ComputeEngine,
  Rule,
} from '../global-types';

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
    condition: (sub) => filter(sub) && !sub._n.is(0),
  },

  {
    match: ['Add', ['Multiply', '_a', ['Power', '_x', '_n']], '__b'],
    replace: [
      'Negate',
      ['Power', ['Divide', ['Negate', '__b'], '_a'], ['Divide', 1, '_n']],
    ],

    useVariations: true,
    condition: (sub: { _n }) =>
      filter(sub) && !sub._n.is(0) && (sub._n.isEven ?? false),
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
      ((!sub.__a.is(0) && sub.__c.div(sub.__a).isNegative) ?? false),
  },

  // a * e^(x) + c = 0
  {
    match: ['Add', ['Multiply', '__a', ['Exp', '_x']], '__c'],
    replace: ['Ln', ['Negate', ['Divide', '__c', '__a']]],
    useVariations: true,
    condition: (sub) =>
      filter(sub) &&
      ((!sub.__a.is(0) && sub.__c.div(sub.__a).isNegative) ?? false) &&
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
      (filter(sub) && !sub.__a.is(0) && sub.__b.isPositive) ?? false,
  },

  // a * log_b(x) = 0
  {
    match: ['Multiply', '__a', ['Log', '_x', '__b']],
    replace: ['Power', '__b', ['Negate', ['Divide', '__c', '__a']]],
    useVariations: true,
    condition: (sub) =>
      (filter(sub) && !sub.__a.is(0) && sub.__b.isPositive) ?? false,
  },

  // |ax + b| + c = 0
  {
    match: ['Add', ['Abs', ['Add', ['Multiply', '__a', '_x'], '__b']], '__c'],
    replace: ['Divide', ['Subtract', '__b', '__c'], '__a'],
    condition: filter,
  },
  {
    match: ['Add', ['Abs', ['Add', ['Multiply', '__a', '_x'], '__b']], '__c'],
    replace: ['Divide', ['Negate', ['Add', '__b', '__c'], '__a']],
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
      if (!a || a.is(0)) return false;
      const ratio = b.div(a).neg();
      const val = ratio.numericValue;
      if (val === null) return true; // Allow symbolic ratios
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
      if (!a || a.is(0)) return false;
      const ratio = b.div(a).neg();
      const val = ratio.numericValue;
      if (val === null) return true;
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
      const val = b.numericValue;
      if (val === null) return true;
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
      const val = b.numericValue;
      if (val === null) return true;
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
      if (!a || a.is(0)) return false;
      const ratio = b.div(a).neg();
      const val = ratio.numericValue;
      if (val === null) return true;
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
      if (!a || a.is(0)) return false;
      const ratio = b.div(a).neg();
      const val = ratio.numericValue;
      if (val === null) return true;
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
      const val = b.numericValue;
      if (val === null) return true;
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
      const val = b.numericValue;
      if (val === null) return true;
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
      return !sub.__a.is(0);
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
      return !sub.__a.is(0);
    },
  },

  // cot(x) + b = 0  =>  x = arccot(-b)
  {
    match: ['Add', ['Cot', '_x'], '__b'],
    replace: ['Arccot', ['Negate', '__b']],
    useVariations: true,
    condition: filter,
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
function clearDenominators(
  expr: BoxedExpression,
  variable?: string
): BoxedExpression {
  if (expr.operator !== 'Add') return expr;

  const ops = expr.ops;
  if (!ops || ops.length === 0) return expr;

  // Collect all non-trivial denominators
  const denominators = ops.map((op) => op.denominator).filter((d) => !d.is(1));

  if (denominators.length === 0) return expr;

  // Build LCM by collecting unique denominator factors
  // This avoids multiplying by the same factor twice
  const lcmFactors: BoxedExpression[] = [];

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
      if (denom.symbol && existing.symbol && denom.symbol === existing.symbol) {
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
  expr: BoxedExpression,
  variable: string
): BoxedExpression {
  if (expr.operator !== 'Add') return expr;

  const ce = expr.engine;
  const ops = expr.ops;
  if (!ops || ops.length === 0) return expr;

  // Find the sqrt term(s) in the expression
  let sqrtTerm: BoxedExpression | null = null;
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
    if (op.operator === 'Multiply' && op.ops) {
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
  const sqrtArg = sqrtTerm.op1;
  if (!sqrtArg) return expr;

  // Check if the sqrt argument contains the variable
  if (!sqrtArg.has(variable)) return expr;

  // Collect all non-sqrt terms: these form g(x) where √f(x) + g(x) = 0
  // So √f(x) = -g(x), and we square to get f(x) = g(x)²
  const nonSqrtTerms = ops.filter((_, i) => i !== sqrtIndex);

  if (nonSqrtTerms.length === 0) return expr;

  // g(x) = -(sum of non-sqrt terms), since √f(x) + g(x) = 0 means √f(x) = -g(x)
  let gExpr: BoxedExpression;
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
  expr: BoxedExpression,
  variable: string
): BoxedExpression[] | null {
  if (expr.operator !== 'Add') return null;

  const ce = expr.engine;
  const ops = expr.ops;
  if (!ops || ops.length < 2) return null;

  // Find all sqrt terms in the expression
  const sqrtTerms: {
    term: BoxedExpression;
    arg: BoxedExpression;
    index: number;
  }[] = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];

    // Check for Sqrt(...)
    if (op.operator === 'Sqrt' && op.op1) {
      sqrtTerms.push({ term: op, arg: op.op1, index: i });
      continue;
    }

    // Check for Negate(Sqrt(...))
    if (op.operator === 'Negate' && op.op1?.operator === 'Sqrt' && op.op1.op1) {
      sqrtTerms.push({ term: op, arg: op.op1.op1, index: i });
      continue;
    }

    // Check for coefficient * Sqrt(...)
    if (op.operator === 'Multiply' && op.ops) {
      for (const factor of op.ops) {
        if (factor.operator === 'Sqrt' && factor.op1) {
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
  let eExpr: BoxedExpression;
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
  if (sqrtTerms[0].term.operator === 'Multiply') {
    // Check if coefficient is negative
    const coef = sqrtTerms[0].term.ops?.find((o) => o.operator !== 'Sqrt');
    if (coef?.isNegative) fSign = -1;
    // For now, only handle coefficient ±1
    const absCoef = coef?.abs().N().numericValue;
    if (absCoef !== 1 && absCoef !== null) return null;
  }

  if (sqrtTerms[1].term.operator === 'Negate') gSign = -1;
  if (sqrtTerms[1].term.operator === 'Multiply') {
    const coef = sqrtTerms[1].term.ops?.find((o) => o.operator !== 'Sqrt');
    if (coef?.isNegative) gSign = -1;
    const absCoef = coef?.abs().N().numericValue;
    if (absCoef !== 1 && absCoef !== null) return null;
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
  fExpr: BoxedExpression,
  gExpr: BoxedExpression,
  eExpr: BoxedExpression,
  gSign: number,
  variable: string
): BoxedExpression[] | null {
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

  const validSolutions: BoxedExpression[] = [];

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
    const diffNum = diff.numericValue;
    let diffReal = 0;
    if (typeof diffNum === 'number') {
      diffReal = diffNum;
    } else if (diffNum && typeof diffNum === 'object' && 'decimal' in diffNum) {
      diffReal = (diffNum as any).decimal?.toNumber?.() ?? 0;
    }

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
  expr: BoxedExpression,
  variable: string
): BoxedExpression[] | null {
  if (expr.operator !== 'Add') return null;

  const ce = expr.engine;
  const ops = expr.ops;
  if (!ops || ops.length === 0) return null;

  // Find the outer sqrt term
  let outerSqrt: BoxedExpression | null = null;
  let sqrtIndex = -1;

  for (let i = 0; i < ops.length; i++) {
    if (ops[i].operator === 'Sqrt') {
      outerSqrt = ops[i];
      sqrtIndex = i;
      break;
    }
  }

  if (!outerSqrt || sqrtIndex < 0) return null;

  // Get the argument of the outer sqrt
  const outerArg = outerSqrt.op1;
  if (!outerArg) return null;

  // Check if the outer sqrt argument contains an inner √x (Sqrt of just the variable)
  // Pattern: √(... + √x + ...) or √(... + a*√x + ...)
  let hasInnerSqrtX = false;
  let innerSqrtCoeff: BoxedExpression | null = null;

  if (outerArg.operator === 'Add' && outerArg.ops) {
    for (const term of outerArg.ops) {
      // Check for √x directly
      if (term.operator === 'Sqrt' && term.op1?.symbol === variable) {
        hasInnerSqrtX = true;
        innerSqrtCoeff = ce.One;
        break;
      }
      // Check for Negate(Sqrt(x))
      if (
        term.operator === 'Negate' &&
        term.op1?.operator === 'Sqrt' &&
        term.op1?.op1?.symbol === variable
      ) {
        hasInnerSqrtX = true;
        innerSqrtCoeff = ce.NegativeOne;
        break;
      }
      // Check for coefficient * √x
      if (term.operator === 'Multiply' && term.ops) {
        for (const factor of term.ops) {
          if (factor.operator === 'Sqrt' && factor.op1?.symbol === variable) {
            hasInnerSqrtX = true;
            // Get coefficient (product of other factors)
            const otherFactors = term.ops.filter((f) => f !== factor);
            innerSqrtCoeff =
              otherFactors.length === 1
                ? otherFactors[0]
                : ce.function('Multiply', otherFactors);
            break;
          }
        }
        if (hasInnerSqrtX) break;
      }
    }
  }

  if (!hasInnerSqrtX) return null;

  // We have √(f(x, √x)) = a pattern
  // Collect the constant terms (non-sqrt parts of the Add expression)
  const nonSqrtTerms = ops.filter((_, i) => i !== sqrtIndex);
  if (nonSqrtTerms.length === 0) return null;

  // a = -(sum of non-sqrt terms)
  let aExpr: BoxedExpression;
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
    [variable]: ce.box(['Power', uSymbolName, 2]),
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

  const uSolutions = findUnivariateRoots(uEquation, uSymbolName);

  ce.popScope();

  if (uSolutions.length === 0) return null;

  // Convert u solutions back to x = u²
  // Only keep solutions where u ≥ 0 (since u = √x ≥ 0)
  const xSolutions: BoxedExpression[] = [];

  for (const uVal of uSolutions) {
    // Check if u is real and non-negative (since u = √x ≥ 0)
    const uNumeric = uVal.N();

    // Use the expression's isNegative property for reliable checking
    if (uNumeric.isNegative) continue; // Skip negative u values

    // Also check numericValue for cases where isNegative might not be set
    const uNum = uNumeric.numericValue;
    if (uNum !== null) {
      let uReal: number | null = null;
      if (typeof uNum === 'number') {
        uReal = uNum;
      } else if (typeof uNum === 'object' && 'decimal' in uNum) {
        // BigNumericValue object - extract numeric value from decimal
        const decimal = (uNum as any).decimal;
        if (decimal && typeof decimal.toNumber === 'function') {
          uReal = decimal.toNumber();
        }
      } else if (typeof uNum === 'object' && 're' in uNum) {
        // Complex number object
        uReal = (uNum as any).re;
      }
      if (uReal !== null && uReal < -1e-10) continue; // Skip negative u values
    }

    // x = u²
    const xVal = uVal.mul(uVal).simplify();
    xSolutions.push(xVal);
  }

  return xSolutions.length > 0 ? xSolutions : null;
}

/**
 * Expression is a function of a single variable (`x`) or an Equality
 *
 * Return the roots of that variable
 *
 */
export function findUnivariateRoots(
  expr: BoxedExpression,
  x: string
): ReadonlyArray<BoxedExpression> {
  const ce = expr.engine;

  if (expr.operator === 'Equal')
    expr = expr.op1.expand().sub(expr.op2.expand()).simplify();
  else expr = expr.expand().simplify();

  // Save the expression BEFORE clearing denominators and other transformations.
  // This is crucial for validating roots: clearing denominators and harmonization
  // can introduce extraneous roots that satisfy the transformed equation but not
  // the original. For example, sqrt equations using quadratic substitution
  // (u = √x → au² + bu + c = 0 → x = u²) may produce extraneous roots.
  const originalExpr = expr;

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
  let exprs = [expr.subs({ [x]: '_x' }, { canonical: false })];

  // Create a lexical scope for the unknown
  ce.pushScope();

  // Assume that the unknown is a number
  ce.declare('_x', 'number');

  let result = exprs.flatMap((expr) =>
    matchAnyRules(
      expr,
      rules,
      { _x: ce.symbol('_x') },
      { useVariations: true, canonical: true }
    )
  );

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

  if (result.length === 0) {
    exprs = exprs.flatMap((expr) => harmonize(expr));
    result = exprs.flatMap((expr) =>
      matchAnyRules(
        expr,
        rules,
        { _x: ce.symbol(x) },
        { useVariations: true, canonical: true }
      )
    );
  }

  if (result.length === 0) {
    exprs = exprs
      .flatMap((expr) => expand(expr.canonical))
      .filter((x) => x !== null) as BoxedExpression[];
    exprs = exprs.flatMap((expr) => harmonize(expr));
    result = exprs.flatMap((expr) =>
      matchAnyRules(
        expr,
        rules,
        { _x: ce.symbol(x) },
        { useVariations: true, canonical: true }
      )
    );
  }

  ce.popScope(); // End lexical scope for the unknown

  // Validate the roots against the ORIGINAL expression (before clearing
  // denominators and harmonization). This filters out extraneous roots that
  // may have been introduced by algebraic transformations.
  return validateRoots(
    originalExpr,
    x,
    result.map((x) => x.evaluate().simplify())
  );
}

/** Expr is an equation with an operator of
 * - `Equal`, `Less`, `Greater`, `LessEqual`, `GreaterEqual`
 *
 * Return an expression with the same operator, but with the first argument
 * a variable, if possible:
 * `2x < 4` => `x < 2`
 */
export function univariateSolve(
  expr: BoxedExpression,
  x: string
): ReadonlyArray<BoxedExpression> | null {
  const ce = expr.engine;
  const name = expr.operator;
  if (name === 'Tuple') {
    // @todo: System of equations
    return null;
  }

  if (
    name === null ||
    !(expr.operator === 'Equal' || isInequalityOperator(expr.operator))
  )
    return null;

  let lhs: BoxedExpression = expr.op1;
  const rhs = expr.op2;
  if (!rhs.is(0)) lhs = ce.box(['Subtract', lhs, rhs]);

  const roots = findUnivariateRoots(lhs, x);

  if (roots.length === 0) return null;
  return roots;
}

/** Harmonization rules transform an expr into one or more equivalent
 * expressions that are easier to solve */
export const HARMONIZATION_RULES: Rule[] = [
  // |ax + b| + c -> ax+b+c, -ax-b+c
  {
    match: ['Add', ['Abs', ['Add', ['Multiply', '__a', '_x'], '__b']], '__c'],
    replace: ['Add', ['Multiply', '__a', '_x'], '__b', '__c'],
  },
  {
    match: ['Add', ['Abs', ['Add', ['Multiply', '__a', '_x'], '__b']], '__c'],
    replace: [
      'Add',
      ['Negate', ['Multiply', '__a', '_x']],
      ['Negate', '__b'],
      '__c',
    ],
  },
  // a(b^n) -> a
  {
    match: ['Multiply', '__a', ['Power', '_b', '_n']],
    replace: '_b',
    condition: ({ __a, _b, _n }) =>
      !__a.has('_x') && _b.has('_x') && !_n.is(0) && !_n.has('_x'),
  },
  // a√b(x)  -> a^2 b(x)
  {
    match: ['Multiply', '__a', ['Sqrt', '_b']],
    replace: ['Multiply', ['Square', '_a'], '__b'],
    condition: ({ _b }) => _b.has('_x'),
  },
  // a(x)/b -> a(x)
  {
    match: ['Divide', '_a', '_b'],
    replace: '_a',
    // @todo: check _b after the substitution
    condition: ({ _a, _b }) => _a.has('_x') && !_b.is(0),
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
    match: ['Add', ['Ln', '_a'], ['Ln', '_b'], '__c'],
    replace: ['Add', ['Ln', ['Multiply', '_a', '_b']], '__c'],
  },
  // e^a * e^b -> e^(a+b)
  {
    match: ['Multiply', ['Exp', '__a'], ['Exp', '__b'], '__c'],
    replace: ['Multiply', ['Exp', ['Add', '_a', '_b']], '__c'],
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
  // tan(f(x)) -> f(x) - π/4
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

/** Transform expr into one or more equivalent expressions that
 * are easier to solve
 */
function harmonize(expr: BoxedExpression): BoxedExpression[] {
  const ce = expr.engine;
  const rules = ce.getRuleSet('harmonization')!;
  return matchAnyRules(expr, rules, { _x: ce.symbol('_x') });
}

function validateRoots(
  expr: BoxedExpression,
  x: string,
  roots: ReadonlyArray<BoxedExpression>
): BoxedExpression[] {
  const validRoots = roots.filter((root) => {
    // Evaluate the expression at the root
    const value = expr.subs({ [x]: root }).canonical.evaluate();
    if (value === null) return false;
    if (!value.isValid) return false;
    if (value.isNaN) return false;
    if (value.has(x)) return false;

    // Important: we want to use `isEqual()`, not `is(0)` here
    // The former accounts for tolerance, the latter does not
    return value.isEqual(0);
  });

  // Deduplicate roots (e.g., arccos(1) and -arccos(1) both equal 0)
  const uniqueRoots: BoxedExpression[] = [];
  for (const root of validRoots) {
    const isDuplicate = uniqueRoots.some(
      (existing) => existing.isSame(root) || existing.isEqual(root)
    );
    if (!isDuplicate) uniqueRoots.push(root);
  }

  return uniqueRoots;
}
