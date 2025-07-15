import { isInequalityOperator } from '../latex-syntax/utils';
import { matchAnyRules } from './rules';
import { expand } from './expand';
import type { BoxedExpression, BoxedSubstitution, Rule } from '../global-types';

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

  // ax + c\sqrt{dx + f} + g = 0
  // plus
  {
    match: 'ax + \\mathrm{__b} \\sqrt{cx + \\mathrm{__d}} + \\mathrm{__g}',
    replace:
      '\\frac{-(2 a g - \\mathrm{__b}^2 c) + \\sqrt{(2 a \\mathrm{__g} - \\mathrm{__b}^2 c)^2 - 4 a^2(g^2 - b^2 \\mathrm{__d})}}{2 a^2}',
    useVariations: true,
    condition: filter,
  },
  // minus
  {
    match: 'ax + \\mathrm{__b} \\sqrt{cx + \\mathrm{__d}} + \\mathrm{__g}',
    replace:
      '\\frac{-(2 a g - \\mathrm{__b}^2 c) - \\sqrt{(2 a \\mathrm{__g} - \\mathrm{__b}^2 c)^2 - 4 a^2(g^2 - b^2 \\mathrm{__d})}}{2 a^2}',
    useVariations: true,
    condition: filter,
  },
];

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

  // Validate the roots
  return validateRoots(
    expr,
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
  return roots.filter((root) => {
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
}
