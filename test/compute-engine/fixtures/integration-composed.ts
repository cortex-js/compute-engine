import type { ExpressionInput } from '../../../src/compute-engine/global-types';

/** Small profiling grid. Family/domain coverage lives in the test suite. */
export const composedCases: [
  string,
  ExpressionInput,
  ExpressionInput,
  ExpressionInput,
  ExpressionInput,
][] = [
  [
    'power-exponential',
    ['Multiply', ['Power', 'x', 3], ['Exp', ['Power', 'x', 2]]],
    0,
    1,
    ['Rational', 1, 2],
  ],
  [
    'improper-power-exponential',
    ['Multiply', ['Power', 'x', 5], ['Exp', ['Negate', ['Power', 'x', 3]]]],
    0,
    'PositiveInfinity',
    ['Rational', 1, 3],
  ],
  [
    'mixed-radicals',
    ['Divide', ['Sqrt', 'x'], ['Subtract', ['Sqrt', 'x'], ['Root', 'x', 3]]],
    64,
    729,
    ['Add', ['Rational', 10747, 10], ['Multiply', 6, ['Ln', 2]]],
  ],
  [
    'negative-trig-powers',
    [
      'Divide',
      1,
      ['Multiply', ['Power', ['Sin', 'x'], 3], ['Power', ['Cos', 'x'], 5]],
    ],
    ['Divide', 'Pi', 4],
    ['Divide', 'Pi', 3],
    ['Add', ['Rational', 16, 3], ['Multiply', ['Rational', 3, 2], ['Ln', 3]]],
  ],
  [
    'hyperbolic-rational',
    ['Divide', 1, ['Add', 1, ['Cosh', 'x']]],
    0,
    ['Ln', 2],
    ['Rational', 1, 3],
  ],
  [
    'logarithmic-parts',
    ['Multiply', 'x', ['Power', ['Ln', 'x'], 2]],
    1,
    'ExponentialE',
    ['Divide', ['Subtract', ['Power', 'ExponentialE', 2], 1], 4],
  ],
  [
    'logarithmic-parameter-difference',
    ['Divide', ['Subtract', ['Power', 'x', 7], 1], ['Ln', 'x']],
    0,
    1,
    ['Multiply', 3, ['Ln', 2]],
  ],
  [
    'interacting-floor-ceiling',
    [
      'Subtract',
      ['Power', 'x', 2],
      ['Multiply', ['Floor', 'x'], ['Ceil', 'x']],
    ],
    0,
    2022,
    674,
  ],
  [
    'fractional-reciprocal-weight',
    ['Divide', ['Fract', 'x'], 'x'],
    1,
    2,
    ['Subtract', 1, ['Ln', 2]],
  ],
  [
    'linear-geometric-weight',
    [
      'Sum',
      ['Multiply', 'n', ['Power', 'x', 'n']],
      ['Limits', 'n', 0, 'PositiveInfinity'],
    ],
    0,
    ['Rational', 1, 2],
    ['Add', 1, ['Ln', ['Rational', 1, 2]]],
  ],
  [
    'quadratic-geometric-weight',
    [
      'Sum',
      ['Multiply', ['Power', 'n', 2], ['Power', 'x', 'n']],
      ['Limits', 'n', 0, 'PositiveInfinity'],
    ],
    0,
    ['Rational', 1, 2],
    ['Ln', 2],
  ],
  [
    'two-step-telescoping-product',
    [
      'Product',
      ['Divide', ['Add', 'x', 'n', 2], ['Add', 'x', 'n']],
      ['Limits', 'n', 1, 5],
    ],
    0,
    1,
    ['Add', 1, ['Multiply', -20, ['Ln', 3]], ['Multiply', 50, ['Ln', 2]]],
  ],
];
