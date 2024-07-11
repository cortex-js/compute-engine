import {
  BoxedExpression,
  SemiBoxedExpression,
} from './boxed-expression/public';
import { isInequality } from './boxed-expression/utils';
import { Rule } from './public';
import { matchRules } from './rules';
import { expand } from './symbolic/expand';

// https://en.wikipedia.org/wiki/Equation_solving

//
// UNIVARIATE_ROOTS is a collection of rules that find the roots for
// various expressions.
//
//
// @todo: MOAR RULES
// \sin(x)...
// polynomials...
// a \sqrt{x} + b
// a \ln x + b
//
// cos x, acos x, n cos x + a

// Set of rules to find the root(s) for `x`
export const UNIVARIATE_ROOTS: Rule[] = [
  // ax = 0
  {
    match: ['Multiply', '_x', '__a'],
    replace: 0,
    id: 'ax',
    exact: false,
    condition: ({ __a }) => !__a.has('_x'),
  },

  // a/x + b = 0
  {
    match: ['Add', ['Divide', '_a', '_x'], '__b'],
    replace: Infinity,
    exact: false,
    condition: ({ _a, __b }) => !_a.has('_x') && !__b.has('_x'),
  },

  // ax + b = 0
  {
    match: ['Add', ['Multiply', '_x', '__a'], '__b'],
    replace: ['Divide', ['Negate', '__b'], '__a'],
    exact: false,
    condition: ({ __a, __b }) => !__a.has('_x') && !__b.has('_x'),
  },

  // ax^n + b = 0
  {
    match: ['Add', ['Multiply', '_a', ['Power', '_x', '_n']], '__b'],
    replace: [
      'Power',
      ['Divide', ['Negate', '__b'], '_a'],
      ['Divide', 1, '_n'],
    ],

    exact: false,
    condition: ({ _a, __b, _n }) =>
      !_a.has('_x') && !__b.has('_x') && !_n.isZero,
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
    exact: false,
    condition: ({ __a, __b, __c }) =>
      !__a.has('_x') && !__b.has('_x') && !__c.has('_x'),
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
    exact: false,
    condition: ({ __a, __b, __c }) =>
      !__a.has('_x') && !__b.has('_x') && !__c.has('_x'),
  },

  // a * e^(bx) + c = 0
  {
    match: [
      'Add',
      ['Multiply', '__a', ['Exp', ['Multiply', '__b', '_x']]],
      '__c',
    ],
    replace: ['Divide', ['Ln', ['Negate', ['Divide', '__c', '__a']]], '__b'],
    exact: false,
    condition: ({ __a, __c }, ce) =>
      ((!__a.isZero && ce.div(__c, __a).isNegative) ?? false) &&
      !__a.has('_x') &&
      !__c.has('_x'),
  },

  // a * e^(x) + c = 0
  {
    match: ['Add', ['Multiply', '__a', ['Exp', '_x']], '__c'],
    replace: ['Ln', ['Negate', ['Divide', '__c', '__a']]],
    exact: false,
    condition: ({ __a, __c }, ce) =>
      ((!__a.isZero && ce.div(__c, __a).isNegative) ?? false) &&
      !__a.has('_x') &&
      !__c.has('_x'),
  },

  // // e^(x) + c = 0
  // {
  //   match: ['Add', ['Exp', '_x'], '__c'],
  //   replace: ['Ln', ['Negate', '__c']],
  //   exact: false,
  //  condition: ({ __c }) => __c.isNegative ?? false,
  // },

  // // e^(bx) + c = 0
  // {
  //   match: ['Add', ['Exp', ['Multiply', '__b', '_x']], '__c'],
  //   replace: ['Divide', ['Ln', ['Negate', '__c']], '__b'],
  //   exact: false,
  //  condition: ({ __c }) => __c.isNegative ?? false,
  // },

  // // a * log_b(x) + c = 0
  // {
  //   match: ['Add', ['Multiply', '__a', ['Log', '_x', '__b']], '__c'],
  //   replace: ['Power', '__b', ['Negate', ['Divide', '__c', '__a']]],
  //   exact: false,
  //  condition: ({ __a, __b }) => (!__a.isZero && __b.isPositive) ?? false,
  // },

  // // a * log_b(x) = 0
  // {
  //   match: ['Multiply', '__a', ['Log', '_x', '__b']],
  //   replace: ['Power', '__b', ['Negate', ['Divide', '__c', '__a']]],
  //   exact: false,
  //  condition: ({ __a, __b }) => (!__a.isZero && __b.isPositive) ?? false,
  // },

  // // |ax + b| + c = 0
  // {
  //   match: ['Add', ['Abs', ['Add', ['Multiply', '__a', '_x'], '__b']], '__c'],
  //   replace: ['Divide', ['Subtract', '__b', '__c'], '__a'],
  // },
  // {
  //   match: ['Add', ['Abs', ['Add', ['Multiply', '__a', '_x'], '__b']], '__c'],
  //   replace: ['Divide', ['Negate', ['Add', '__b', '__c'], '__a']],
  // },
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

  if (expr.head === 'Equal') {
    expr = ce
      .function('Add', [
        expr.op1.canonical,
        ce.function('Negate', [expr.op2.canonical]),
      ])
      .simplify();
  }

  const rules = ce.getRuleSet('solve-univariate')!;

  // Make the unknown '_x' so that we can match against it
  let exprs = [expr.subs({ [x]: '_x' }, { canonical: false })];

  let result = exprs.flatMap((expr) =>
    matchRules(expr, rules, { _x: ce.symbol('_x') })
  );

  // If we didn't find a solution yet, try modifying the expression
  //
  // Note: @todo we can try different heuristics here:
  // Collection: reduce the numbers of occurrences of the unknown
  // Attraction: bring the occurences of the unknonw closer together
  // Function Swapping: replacing function with ones easier to solve
  //    - square roots: square both sides
  //    - logs: exponentiate both sides
  //    - trig functions: use inverse trig functions
  // Homogenization: replace a function of the unknown by a new variable,
  // e.g. exp(x) -> y, then solve for y

  if (result.length === 0) {
    exprs = exprs.flatMap((expr) => harmonize(expr));
    result = exprs.flatMap((expr) =>
      matchRules(expr, rules, { _x: ce.symbol(x) })
    );
  }

  if (result.length === 0) {
    exprs = exprs
      .flatMap((expr) => expand(expr.canonical))
      .filter((x) => x !== null) as BoxedExpression[];
    exprs = exprs.flatMap((expr) => harmonize(expr));
    result = exprs.flatMap((expr) =>
      matchRules(expr, rules, { _x: ce.symbol(x) })
    );
  }

  return result.map((x) => x.evaluate().simplify());
}

/** Expr is an equation with a head of
 * - `Equal`, `Less`, `Greater`, `LessEqual`, `GreaterEqual`
 *
 * Return an expression with the same head, but with the first argument
 * a variable, if possible:
 * `2x < 4` => `x < 2`
 */
export function univariateSolve(
  expr: BoxedExpression,
  x: string
): ReadonlyArray<SemiBoxedExpression> | null {
  const ce = expr.engine;
  const name = expr.head;
  if (name === 'Tuple') {
    // @todo: System of equations
    return null;
  }

  if (name === null || !isInequality(expr)) return null;

  let lhs: SemiBoxedExpression = expr.op1;
  const rhs = expr.op2;
  if (rhs.isNotZero === true) lhs = ['Subtract', lhs, rhs];

  const roots = findUnivariateRoots(ce.box(lhs), x);
  if (roots.length === 0) return null;
  return roots;
}

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
      !__a.has('_x') && _b.has('_x') && !_n.isZero && !_n.has('_x'),
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
    condition: ({ _a, _b }) => _a.has('_x') && !_b.isZero,
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
  const result = matchRules(expr, rules, { _x: ce.symbol('_x') });

  return result;
}
