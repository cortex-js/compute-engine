import { BoxedExpression, Rule, SemiBoxedExpression } from './public';
import { boxRules, matchRules } from './rules';
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
  // x = 0
  { match: '_x', replace: 0 },

  // ax = 0
  { match: ['Multiply', '_x', '__a'], replace: 0 },

  // x/a = 0
  { match: ['Divide', '_x', '_a'], replace: 0 },

  // x/a + b = 0
  {
    match: ['Add', ['Divide', '_x', '_a'], '__b'],
    replace: ['Multiply', ['Negate', '_a'], '__b'],
  },

  // a/x = 0
  { match: ['Divide', '_a', '_x'], replace: Infinity },

  // x + a = 0
  {
    match: ['Add', '_x', '__a'],
    replace: ['Negate', '__a'],
    id: 'x + a',
  },
  { match: ['Add', ['Negate', '_x'], '__a'], replace: '__a' },

  // ax + b = 0
  {
    match: ['Add', ['Multiply', '_x', '__a'], '__b'],
    replace: ['Divide', ['Negate', '__b'], '__a'],
  },

  // x^n = 0
  {
    match: ['Power', '_x', '_n'],
    replace: 0,
  },

  // x^n + c = 0
  {
    match: ['Add', ['Power', '_x', '_n'], '__c'],
    replace: ['Power', ['Negate', '__c'], ['Divide', 1, '_n']],
    id: 'x^n + c',
  },

  // ax^n + b = 0
  {
    match: ['Add', ['Multiply', '_a', ['Power', '_x', '_n']], '__b'],
    replace: [
      'Divide',
      ['Power', ['Negate', '__b'], ['Divide', 1, '_n']],
      '_a',
    ],
  },

  //
  // Quadratic formula (real)
  // ax^2 + bx + c = 0
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
    // (_ce, vars): boolean => vars.x.isReal === true,
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
    // (_ce, vars): boolean => vars.x.isReal === true,
  },

  // ax^2 + bx = 0
  {
    match: [
      'Add',
      ['Multiply', ['Power', '_x', 2], '__a'],
      ['Multiply', '_x', '__b'],
    ],
    replace: 0,
    // (_ce, vars): boolean => vars.x.isReal === true,
  },
  {
    match: [
      'Add',
      ['Multiply', ['Power', '_x', 2], '__a'],
      ['Multiply', '_x', '__b'],
    ],
    replace: ['Divide', ['Negate', '__b'], '__a'],
    // (_ce, vars): boolean => vars.x.isReal === true,
  },

  // // ax^2 + c = 0
  // {
  //   match: ['Add', ['Multiply', ['Power', '_x', 2], '__a'], '__c'],
  //   replace: ['Sqrt', ['Divide', ['Negate', '__c'], '__a']],
  //   // (_ce, vars): boolean => vars.x.isReal === true,
  // },
  // {
  //   match: ['Add', ['Multiply', ['Power', '_x', 2], '__a'], '__b'],
  //   replace: ['Negate', ['Sqrt', ['Divide', ['Negate', '__b'], '__a']]],
  //   // (_ce, vars): boolean => vars.x.isReal === true,
  // },

  // x^2 + bx + c = 0
  {
    match: ['Add', ['Power', '_x', 2], ['Multiply', '__b', '_x'], '__c'],
    replace: [
      'Divide',
      [
        'Add',
        ['Negate', '__b'],
        ['Sqrt', ['Subtract', ['Square', '__b'], ['Multiply', 4, '__c']]],
      ],
      2,
    ],
    // (_ce, vars): boolean => vars.x.isReal === true,
  },

  {
    match: ['Add', ['Power', '_x', 2], ['Multiply', '__b', '_x'], '__c'],
    replace: [
      'Divide',
      [
        'Subtract',
        ['Negate', '__b'],
        ['Sqrt', ['Subtract', ['Square', '__b'], ['Multiply', 4, '__c']]],
      ],
      2,
    ],
    // (_ce, vars): boolean => vars.x.isReal === true,
  },

  // x^2 + bx = 0
  {
    match: ['Add', ['Power', '_x', 2], ['Multiply', '__b', '_x']],
    replace: 0,
    // (_ce, vars): boolean => vars.x.isReal === true,
    id: 'x^2 + bx -> 0',
  },

  {
    match: ['Add', ['Power', '_x', 2], ['Multiply', '__b', '_x']],
    replace: ['Negate', '__b'],
    // (_ce, vars): boolean => vars.x.isReal === true,
    id: 'x^2 + bx -> -b',
  },

  // a * e^(bx) + c = 0
  {
    match: [
      'Add',
      ['Multiply', '__a', ['Exp', ['Multiply', '__b', '_x']]],
      '__c',
    ],
    replace: ['Divide', ['Ln', ['Negate', ['Divide', '__c', '__a']]], '__b'],
    condition: ({ __a, __c }, ce) =>
      (!__a.isZero && ce.div(__c, __a).isNegative) ?? false,
  },

  // a * e^(x) + c = 0
  {
    match: ['Add', ['Multiply', '__a', ['Exp', '_x']], '__c'],
    replace: ['Ln', ['Negate', ['Divide', '__c', '__a']]],
    condition: ({ __a, __c }, ce) =>
      (!__a.isZero && ce.div(__c, __a).isNegative) ?? false,
  },

  // e^(x) + c = 0
  {
    match: ['Add', ['Exp', '_x'], '__c'],
    replace: ['Ln', ['Negate', '__c']],
    condition: ({ __c }) => __c.isNegative ?? false,
  },

  // e^(bx) + c = 0
  {
    match: ['Add', ['Exp', ['Multiply', '__b', '_x']], '__c'],
    replace: ['Divide', ['Ln', ['Negate', '__c']], '__b'],
    condition: ({ __c }) => __c.isNegative ?? false,
  },

  // // a * log_b(x) + c = 0
  // {
  //   match: ['Add', ['Multiply', '__a', ['Log', '_x', '__b']], '__c'],
  //   replace: ['Power', '__b', ['Negate', ['Divide', '__c', '__a']]],
  //   condition: ({ __a, __b }) => (!__a.isZero && __b.isPositive) ?? false,
  // },

  // // a * log_b(x) = 0
  // {
  //   match: ['Multiply', '__a', ['Log', '_x', '__b']],
  //   replace: ['Power', '__b', ['Negate', ['Divide', '__c', '__a']]],
  //   condition: ({ __a, __b }) => (!__a.isZero && __b.isPositive) ?? false,
  // },

  // |ax + b| + c = 0
  {
    match: ['Add', ['Abs', ['Add', ['Multiply', '__a', '_x'], '__b']], '__c'],
    replace: ['Divide', ['Subtract', '__b', '__c'], '__a'],
  },
  {
    match: ['Add', ['Abs', ['Add', ['Multiply', '__a', '_x'], '__b']], '__c'],
    replace: ['Divide', ['Negate', ['Add', '__b', '__c'], '__a']],
  },

  // // x^2 + c = 0
  // {
  //   match: ['Add', ['Power', '_x', 2], '__c'],
  //   replace: ['Power', ['Negate', '__c'], 'Half'],
  //   // (_ce, vars): boolean => vars.x.isReal === true,
  // },

  // {
  //   match: ['Add', ['Power', '_x', 2], '__c'],
  //   replace: ['Negate', ['Power', ['Negate', '__c'], 'Half']],
  //   // (_ce, vars): boolean => vars.x.isReal === true,
  // },

  // Quadratic formula (complex)
  // [
  //   '$ax^2 + bx + c$',
  //   [
  //     '$-\\frac{b}{2a} - \\imaginaryI \\frac{\\sqrt{4ac - b^2}}{2a}$',
  //     '$-\\frac{b}{2a} + \\imaginaryI \\frac{\\sqrt{4ac - b^2}}{2a}$',
  //   ],
  //   (_ce, vars): boolean => vars.x.isImaginary === true,
  // ],
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
): BoxedExpression[] {
  const ce = expr.engine;

  if (expr.head === 'Equal') {
    expr = ce.add([expr.op1.canonical, ce.neg(expr.op2.canonical)]).simplify();
  }
  const rules = ce.cache('univariate-roots-rules', () =>
    boxRules(ce, UNIVARIATE_ROOTS)
  );
  let result = matchRules(
    expr.subs({ [x]: '_x' }, { canonical: false }),
    rules,
    { _x: ce.symbol('_x') }
  );

  if (result.length === 0) {
    const expandedExpr = expand(expr.canonical);
    if (expandedExpr === null) return [];
    result = matchRules(
      expandedExpr.subs({ [x]: '_x' }, { canonical: false }),
      rules,
      {
        _x: ce.symbol('_x'),
      }
    );
  }

  return result.map((x) => x.evaluate());
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
): SemiBoxedExpression[] | null {
  const ce = expr.engine;
  const name = expr.head;
  if (name === 'And') {
    // @todo: System of equations
  }

  if (
    name === null ||
    (typeof name === 'string' &&
      !['Equal', 'Less', 'LessEqual', 'Greater', 'GreaterEqual'].includes(name))
  ) {
    return null;
  }

  const rhs = expr.op2;
  let lhs: SemiBoxedExpression = expr.op1;
  if (rhs.isNotZero === true) lhs = ['Subtract', lhs, rhs];

  const roots = findUnivariateRoots(ce.box(lhs), x);
  if (roots.length === 0) return null;
  return roots;
}
