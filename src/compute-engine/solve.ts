import { BoxedExpression, Rule, SemiBoxedExpression } from './public';
import { boxRules, matchRules } from './rules';
import { expand } from './symbolic/expand';

// https://en.wikipedia.org/wiki/Equation_solving

//
// UNIVARIATE_ROOTS is a collection of rules that find the roots for
// various expressions.
//
// The lhs pattern is a function of (x, a, b)
//
// @todo: MOAR RULES
// x^2, x^2 + a,  a x^2 + b
// \sin(x)...
// polynomials...
// a \sqrt{x} + b
// a \ln x + b
// a e^x + b
//
// cos x, acos x, n cos x + a

// Set of rules to find the root(s) for `x`
export const UNIVARIATE_ROOTS: Rule[] = [
  // ax = 0
  [['Multiply', '_x', '_a'], 0],
  // x + a = 0
  [
    ['Add', '_a', '_x'],
    ['Negate', '_a'],
  ],
  [['Add', ['Negate', '_x'], '_a'], '_a'],
  // ax + b = 0
  [
    ['Add', ['Multiply', '_x', '_a'], '_b'],
    ['Divide', ['Negate', '_b'], '_a'],
  ],

  // Quadratic formula (real)
  // ax^2 + bx + c = 0
  [
    [
      'Add',
      ['Multiply', ['Power', '_x', 2], '_a'],
      ['Multiply', '_x', '_b'],
      '_c',
    ],
    [
      'Divide',
      [
        'Add',
        ['Negate', '_b'],
        ['Sqrt', ['Subtract', ['Square', '_b'], ['Multiply', 4, '_a', '_c']]],
      ],
      ['Multiply', 2, '_a'],
    ],
    // (_ce, vars): boolean => vars.x.isReal === true,
  ],

  [
    [
      'Add',
      ['Multiply', ['Power', '_x', 2], '_a'],
      ['Multiply', '_x', '_b'],
      '_c',
    ],
    [
      'Divide',
      [
        'Subtract',
        ['Negate', '_b'],
        ['Sqrt', ['Subtract', ['Square', '_b'], ['Multiply', 4, '_a', '_c']]],
      ],
      ['Multiply', 2, '_a'],
    ],
    // (_ce, vars): boolean => vars.x.isReal === true,
  ],

  // ax^2 + bx = 0
  [
    ['Add', ['Multiply', ['Power', '_x', 2], '_a'], ['Multiply', '_x', '_b']],
    0,
    // (_ce, vars): boolean => vars.x.isReal === true,
  ],
  [
    ['Add', ['Multiply', ['Power', '_x', 2], '_a'], ['Multiply', '_x', '_b']],
    ['Divide', ['Negate', '_b'], '_a'],
    // (_ce, vars): boolean => vars.x.isReal === true,
  ],

  // ax^2 + b = 0
  [
    ['Add', ['Multiply', ['Power', '_x', 2], '_a'], '_b'],
    ['Sqrt', ['Divide', ['Negate', '_b'], '_a']],
    // (_ce, vars): boolean => vars.x.isReal === true,
  ],
  [
    ['Add', ['Multiply', ['Power', '_x', 2], '_a'], '_b'],
    ['Negate', ['Sqrt', ['Divide', ['Negate', '_b'], '_a']]],
    // (_ce, vars): boolean => vars.x.isReal === true,
  ],

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
  console.log('findUnivariateRoots', expr.toString(), x);
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

  return result.map((x) => x.canonical.evaluate());
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
  console.log('univariateSolve', expr.toString(), x);
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
