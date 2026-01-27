import type { BoxedExpression, BoxedSubstitution, Rule } from '../global-types';

import { mul } from '../boxed-expression/arithmetic-mul-div';
import { add } from '../boxed-expression/arithmetic-add';
import { matchAnyRules } from '../boxed-expression/rules';
import { expandAll } from '../boxed-expression/expand';

//  @todo: implement using Risch Algorithm

function filter(sub: BoxedSubstitution): boolean {
  for (const [k, v] of Object.entries(sub)) {
    if (k !== 'x' && k !== '_x' && v.has('_x')) return false;
  }
  return true;
}

const INTEGRATION_RULES: Rule[] = [
  // (ax+b)^n -> \frac{(ax + b)^{n + 1}}{a(n + 1)}
  {
    match: ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], '_n'],
    replace: [
      'Divide',
      ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], ['Add', '_n', 1]],
      ['Multiply', '_a', ['Add', '_n', 1]],
    ],
    condition: (sub) => filter(sub) && !sub._n.is(-1),
  },

  // \sqrt{ax + b} -> \frac{2}{3a} (ax + b)^{3/2}
  {
    match: ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 1 / 2],
    replace: [
      'Divide',
      ['Multiply', 2, ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 3]],
      ['Multiply', 3, '_a'],
    ],
    condition: (sub) => filter(sub) && sub._a.isNumberLiteral,
  },

  // \sqrt[3]{ax + b} -> \frac{3}{4a} (ax + b)^{4/3}
  {
    match: ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 1 / 3],
    replace: [
      'Divide',
      ['Multiply', 3, ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 4]],
      ['Multiply', 4, '_a'],
    ],
    condition: (sub) => filter(sub) && sub._a.isNumberLiteral,
  },

  // a^x -> \frac{a^x}{\ln(a)}
  {
    match: ['Power', '__a', '_x'],
    replace: ['Divide', ['Power', '__a', '_x'], ['Ln', ['Abs', '__a']]],
    condition: (sub) => filter(sub) && sub._x.isNumberLiteral,
  },

  // (ax+b)^{-1} -> \ln(ax + b) / a
  {
    match: ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], -1],
    replace: [
      'Divide',
      ['Ln', ['Abs', ['Add', ['Multiply', '_a', '_x'], '__b']]],
      '_a',
    ],
    condition: filter,
  },

  // 1/(ax + b) -> \ln(ax + b) / a
  {
    match: ['Divide', 1, ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Ln', ['Abs', ['Add', ['Multiply', '_a', '_x'], '__b']]],
      '_a',
    ],
    condition: filter,
  },

  // \ln(ax + b) -> (ax + b) \ln(ax + b) - ax - b
  {
    match: ['Ln', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Subtract',
      ['Multiply', ['Add', ['Multiply', '_a', '_x'], '__b'], ['Ln', '_x']],
      ['Subtract', ['Multiply', '_a', '_x'], '__b'],
    ],
    condition: filter,
  },
  // \exp(ax + b) -> \frac{1}{a} \exp(ax + b)
  {
    match: ['Exp', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Exp', ['Add', ['Multiply', '_a', '_x'], '__b']],
      '_a',
    ],
    condition: filter,
  },

  // \sech^2(ax + b) -> \tanh(ax + b) / a
  {
    match: ['Power', ['Sech', ['Add', ['Multiply', '_a', '_x'], '__b']], 2],
    replace: [
      'Divide',
      ['Tanh', ['Add', ['Multiply', '_a', '_x'], '__b']],
      '_a',
    ],
    condition: filter,
  },
  // \sin^2(ax + b) -> \frac{1}{2} \left( x - \frac{\sin(2(ax + b))}{2a} \right)
  {
    match: ['Power', ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']], 2],
    replace: [
      'Divide',
      ['Add', '_x', ['Divide', ['Sin', ['Multiply', 2, '_a', '_x']], 2]],
      2,
    ],
    condition: filter,
  },
  // \cos^2(ax + b) -> \frac{1}{2} \left( x + \frac{\sin(2(ax + b))}{2a} \right)
  {
    match: ['Power', ['Cos', ['Add', ['Multiply', '_a', '_x'], '__b']], 2],
    replace: [
      'Divide',
      ['Add', '_x', ['Divide', ['Sin', ['Multiply', 2, '_a', '_x']], 2]],
      2,
    ],
    condition: filter,
  },
  // \sin(ax + b) -> -\cos(ax + b) / a
  {
    match: ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Negate', ['Cos', ['Add', ['Multiply', '_a', '_x'], '__b']]],
      '_a',
    ],
    condition: filter,
  },
  // \cos(ax + b) -> \sin(ax + b) / a
  {
    match: ['Cos', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']],
      '_a',
    ],
    condition: filter,
  },
  // \tan(ax + b) -> \ln(\sec(ax + b)) / a
  {
    match: ['Tan', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Ln', ['Abs', ['Sec', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      '_a',
    ],
    condition: filter,
  },
  // \sec(ax + b) -> \ln(\sec(ax + b) + \tan(ax + b)) / a
  {
    match: ['Sec', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Ln',
        [
          'Abs',
          [
            'Add',
            ['Sec', ['Add', ['Multiply', '_a', '_x'], '__b']],
            ['Tan', ['Add', ['Multiply', '_a', '_x'], '__b']],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \csc(ax + b) -> -\ln(\csc(ax + b) + \cot(ax + b)) / a
  {
    match: ['Csc', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        [
          'Ln',
          [
            'Abs',
            [
              'Add',
              ['Csc', ['Add', ['Multiply', '_a', '_x'], '__b']],
              ['Cot', ['Add', ['Multiply', '_a', '_x'], '__b']],
            ],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \cot(ax + b) -> -\ln(\sin(ax + b)) / a
  {
    match: ['Cot', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        ['Ln', ['Abs', ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \sinh(ax + b) -> \frac{1}{a} \ln(\cosh(ax + b))
  {
    match: ['Sinh', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Ln', ['Abs', ['Cosh', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      '_a',
    ],
    condition: filter,
  },
  // \cosh(ax + b) -> \frac{1}{a} \ln(\sinh(ax + b))
  {
    match: ['Cosh', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Ln', ['Abs', ['Sinh', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      '_a',
    ],
    condition: filter,
  },
  // \tanh(ax + b) -> \frac{1}{a} \ln(\sech(ax + b))
  {
    match: ['Tanh', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Ln', ['Abs', ['Sech', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      '_a',
    ],
    condition: filter,
  },
  // \sech(ax + b) -> \frac{1}{a} \ln(\tanh(ax + b))
  {
    match: ['Sech', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Ln', ['Abs', ['Tanh', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      '_a',
    ],
    condition: filter,
  },
  // \csch(ax + b) -> -\frac{1}{a} \ln(\coth(ax + b))
  {
    match: ['Csch', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        ['Ln', ['Abs', ['Coth', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \coth(ax + b) -> -\frac{1}{a} \ln(\csch(ax + b))
  {
    match: ['Coth', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        ['Ln', ['Abs', ['Csch', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arcsinh(ax + b) -> \frac{1}{a} \ln(ax + b + \sqrt{(ax + b)^2 + 1})
  {
    match: ['Arcsinh', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Ln',
        [
          'Add',
          ['Add', ['Multiply', '_a', '_x'], '__b'],
          [
            'Sqrt',
            ['Add', ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2], 1],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arccosh(ax + b) -> \frac{1}{a} \ln(ax + b + \sqrt{(ax + b)^2 - 1})
  {
    match: ['Arccosh', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Ln',
        [
          'Add',
          ['Add', ['Multiply', '_a', '_x'], '__b'],
          [
            'Sqrt',
            [
              'Subtract',
              ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
              1,
            ],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arctanh(ax + b) -> \frac{1}{2a} \ln(\frac{1 + ax + b}{1 - ax - b})
  {
    match: ['Arctanh', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Ln',
        [
          'Divide',
          ['Add', 1, ['Add', ['Multiply', '_a', '_x'], '__b']],
          ['Subtract', 1, ['Add', ['Multiply', '_a', '_x'], '__b']],
        ],
      ],
      ['Multiply', 2, '_a'],
    ],
    condition: filter,
  },
  // \arcsech(ax + b) -> -\frac{1}{a} \ln(ax + b + \sqrt{(ax + b)^2 - 1})
  {
    match: ['Arcsech', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        [
          'Ln',
          [
            'Add',
            ['Add', ['Multiply', '_a', '_x'], '__b'],
            [
              'Sqrt',
              [
                'Subtract',
                ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
                1,
              ],
            ],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arccsch(ax + b) -> -\frac{1}{a} \ln(ax + b + \sqrt{(ax + b)^2 + 1})
  {
    match: ['Arccsch', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        [
          'Ln',
          [
            'Add',
            ['Add', ['Multiply', '_a', '_x'], '__b'],
            [
              'Sqrt',
              [
                'Add',
                ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
                1,
              ],
            ],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arccoth(ax + b) -> \frac{1}{2a} \ln(\frac{ax + b + 1}{ax + b - 1})
  {
    match: ['Arccoth', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Ln',
        [
          'Divide',
          ['Add', ['Add', ['Multiply', '_a', '_x'], '__b'], 1],
          ['Subtract', ['Add', ['Multiply', '_a', '_x'], '__b'], 1],
        ],
      ],
      ['Multiply', 2, '_a'],
    ],
    condition: filter,
  },
  // \arccsch(ax + b) -> -\frac{1}{a} \ln(ax + b + \sqrt{(ax + b)^2 + 1})
  {
    match: ['Arccsch', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        [
          'Ln',
          [
            'Add',
            ['Add', ['Multiply', '_a', '_x'], '__b'],
            [
              'Sqrt',
              [
                'Add',
                ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
                1,
              ],
            ],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arccoth(ax + b) -> -\frac{1}{a} \ln(ax + b + \sqrt{(ax + b)^2 - 1})
  {
    match: ['Arccoth', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        [
          'Ln',
          [
            'Add',
            ['Add', ['Multiply', '_a', '_x'], '__b'],
            [
              'Sqrt',
              [
                'Subtract',
                ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
                1,
              ],
            ],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arctan(ax + b) -> \frac{1}{a} \ln(\sec(ax + b) + \tan(ax + b))
  {
    match: ['Arctan', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Ln',
        [
          'Add',
          ['Sec', ['Add', ['Multiply', '_a', '_x'], '__b']],
          ['Tan', ['Add', ['Multiply', '_a', '_x'], '__b']],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arccos(ax + b) -> \frac{1}{a} \ln(ax + b + \sqrt{(ax + b)^2 - 1})
  {
    match: ['Arccos', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Ln',
        [
          'Add',
          ['Add', ['Multiply', '_a', '_x'], '__b'],
          [
            'Sqrt',
            [
              'Subtract',
              ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
              1,
            ],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arcsin(ax + b) -> \frac{1}{a} \ln(ax + b + \sqrt{1 - (ax + b)^2})
  {
    match: ['Arcsin', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Ln',
        [
          'Add',
          ['Add', ['Multiply', '_a', '_x'], '__b'],
          [
            'Sqrt',
            [
              'Subtract',
              1,
              ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
            ],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
];

function lnRule(expr: BoxedExpression, variable: string): BoxedExpression {
  const ce = expr.engine;
  if (expr.op1.symbol !== variable) return integrate(expr, variable);
  return ce.box([
    'Subtract',
    ['Multiply', variable, ['Ln', variable]],
    variable,
  ]);
}

function powerRule(expr: BoxedExpression, variable: string): BoxedExpression {
  const ce = expr.engine;
  if (expr.op1.symbol !== variable) return integrate(expr, variable);
  const exponent = expr.op2;
  if (exponent.isNumberLiteral) {
    if (exponent.is(-1)) return ce.box(['Ln', ['Abs', variable]]);

    return ce.box([
      'Divide',
      ['Power', variable, ['Add', exponent, 1]],
      ['Add', exponent, 1],
    ]);
  }
  return integrate(expr, variable);
}

function sinRule(expr: BoxedExpression, variable: string): BoxedExpression {
  const ce = expr.engine;
  if (expr.op1.symbol !== variable) return integrate(expr, variable);
  return ce.box(['Negate', ['Cos', variable]]);
}
function cosRule(expr: BoxedExpression, variable: string): BoxedExpression {
  const ce = expr.engine;
  if (expr.op1.symbol !== variable) return integrate(expr, variable);
  return ce.box(['Sin', variable]);
}
function expRule(expr: BoxedExpression, variable: string): BoxedExpression {
  const ce = expr.engine;
  if (expr.op1.symbol !== variable) return integrate(expr, variable);
  return ce.box(['Exp', variable]);
}
function tanRule(expr: BoxedExpression, variable: string): BoxedExpression {
  const ce = expr.engine;
  if (expr.op1.symbol !== variable) return integrate(expr, variable);
  return ce.box(['Negate', ['Ln', ['Abs', ['Cos', variable]]]]);
}

function secRule(expr: BoxedExpression, variable: string): BoxedExpression {
  const ce = expr.engine;
  if (expr.op1.symbol !== variable) return integrate(expr, variable);
  return ce.box(['Ln', ['Abs', ['Add', ['Sec', variable], ['Tan', variable]]]]);
}

function cscRule(expr: BoxedExpression, variable: string): BoxedExpression {
  const ce = expr.engine;
  if (expr.op1.symbol !== variable) return integrate(expr, variable);
  return ce.box([
    'Negate',
    ['Ln', ['Abs', ['Add', ['Csc', variable], ['Cot', variable]]]],
  ]);
}

/** Calculate the antiderivative of fn, as an expression (not a function) */
export function antiderivative(
  fn: BoxedExpression,
  index: string
): BoxedExpression {
  if (fn.operator === 'Function') return antiderivative(fn.op1, index);
  if (fn.operator === 'Block') return antiderivative(fn.op1, index);
  if (fn.operator === 'Delimiter') return antiderivative(fn.op1, index);

  const ce = fn.engine;

  // Is it the index?
  if (fn.symbol === index) return ce.box(['Divide', ['Power', fn, 2], 2]);

  // Is it a constant?
  if (!fn.has(index)) return ce.box(['Multiply', fn, ce.symbol(index)]);

  // Apply the chain rule
  if (fn.operator === 'Add') {
    const terms = fn.ops!.map((op) => antiderivative(op, index));
    return add(...(terms as BoxedExpression[])).evaluate();
  }

  if (fn.operator === 'Negate') return antiderivative(fn.op1, index).neg();

  if (fn.operator === 'Multiply') {
    const terms = fn.ops!.map((op, i) => {
      const otherTerms = fn.ops!.slice();
      otherTerms.splice(i, 1);
      const otherProduct = mul(...otherTerms);
      const gPrime = antiderivative(op, index);
      return gPrime.mul(otherProduct);
    });
    return add(...(terms as BoxedExpression[])).evaluate();
  }

  if (fn.operator === 'Divide') {
    if (!fn.op2.has(index)) {
      const antideriv = antiderivative(fn.op1, index);
      return fn.engine.box(['Divide', antideriv, fn.op2]);
    }
    return integrate(fn, index);
  }

  // Handle basic functions: e^x, sin(x), cos(x), ln(x), x^n
  if (fn.operator === 'Exp' && fn.op1.symbol === index) {
    // ∫e^x dx = e^x
    return fn;
  }

  if (fn.operator === 'Sin' && fn.op1.symbol === index) {
    // ∫sin(x) dx = -cos(x)
    return ce.box(['Negate', ['Cos', index]]);
  }

  if (fn.operator === 'Cos' && fn.op1.symbol === index) {
    // ∫cos(x) dx = sin(x)
    return ce.box(['Sin', index]);
  }

  if (fn.operator === 'Ln' && fn.op1.symbol === index) {
    // ∫ln(x) dx = x*ln(x) - x
    return ce.box(['Subtract', ['Multiply', index, ['Ln', index]], index]);
  }

  if (fn.operator === 'Power') {
    // ∫e^x dx = e^x (e^x is parsed as ['Power', 'ExponentialE', 'x'])
    if (fn.op1.symbol === 'ExponentialE' && fn.op2.symbol === index) {
      return fn;
    }

    // ∫x^n dx
    if (fn.op1.symbol === index) {
      const exponent = fn.op2;
      if (exponent.isNumberLiteral) {
        if (exponent.is(-1)) {
          // ∫1/x dx = ln|x|
          return ce.box(['Ln', ['Abs', index]]);
        }
        // ∫x^n dx = x^(n+1)/(n+1)
        return ce.box([
          'Divide',
          ['Power', index, ['Add', exponent, 1]],
          ['Add', exponent, 1],
        ]);
      }
    }
  }

  // Apply a pattern matching rule...
  const rules = ce.rules(INTEGRATION_RULES);
  const xfn = (expandAll(fn) ?? fn).subs(
    { [index]: '_x' },
    { canonical: true }
  );
  const result = matchAnyRules(
    xfn,
    rules,
    { _x: ce.symbol('_x') },
    { useVariations: true, canonical: true }
  );

  if (result && result[0]) return result[0].subs({ _x: index });

  return integrate(fn, index);
}

function integrate(expr: BoxedExpression, variable: string): BoxedExpression {
  const ce = expr.engine;
  return ce.function('Integrate', [
    expr,
    ce.symbol(variable, { canonical: false }),
  ]);
}
