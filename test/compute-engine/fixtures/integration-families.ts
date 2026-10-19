import type { ExpressionInput } from '../../../src/compute-engine/global-types';

type Case = [
  string,
  ExpressionInput,
  ExpressionInput,
  ExpressionInput,
  ExpressionInput,
];
export const cases: Case[] = [];
export const polynomialCases: Case[] = [];
export const reciprocalCases: Case[] = [];
// (1+x^-2)/(1+x^n) and its reciprocal Jacobian sum to 1+x^-2.
for (const n of [1, 2, 7, 64, 2020, 8190])
  for (const b of [2, 5, 2022])
    reciprocalCases.push([
      `reciprocal rational degree ${n + 2}, bound ${b}`,
      [
        'Divide',
        ['Add', 1, ['Power', 'x', 2]],
        ['Add', ['Power', 'x', 2], ['Power', 'x', n + 2]],
      ],
      ['Rational', 1, b],
      b,
      ['Rational', b * b - 1, b],
    ]);
for (const n of [1, 9, 2020])
  reciprocalCases.push([
    `reciprocal logarithmic moment ${n}`,
    ['Divide', 1, ['Add', 'x', ['Power', 'x', n + 1]]],
    ['Rational', 1, 3],
    3,
    ['Ln', 3],
  ]);
for (const a of [1, 3])
  for (const b of [7, 2023])
    polynomialCases.push([
      `sparse polynomial powers ${a}, ${b}`,
      [
        'Multiply',
        ['Add', 1, ['Power', 'x', a]],
        ['Add', 1, ['Power', 'x', b]],
      ],
      -1,
      1,
      ['Add', 2, ['Rational', 2, a + b + 1]],
    ]);
for (const n of [7, 63, 2023])
  polynomialCases.push([
    `affine polynomial power ${n}`,
    ['Power', ['Add', 1, 'x'], n],
    0,
    1,
    ['Divide', ['Subtract', ['Power', 2, n + 1], 1], n + 1],
  ]);
for (const a of [2, 3, 5])
  for (const b of [-1, 1]) {
    cases.push([
      `rational trig a=${a}, b=${b}`,
      ['Divide', 1, ['Add', a, ['Multiply', b, ['Cos', 'x']]]],
      0,
      'Pi',
      ['Divide', 'Pi', ['Sqrt', a * a - b * b]],
    ]);
  }
for (const m of [1, 2, 3])
  for (const r of [1, 2, 3]) {
    cases.push([
      `zeta moments m=${m}, r=${r}`,
      [
        'Divide',
        ['Multiply', ['Power', 'x', r - 1], ['Power', ['Ln', 'x'], m]],
        ['Subtract', 1, ['Power', 'x', r]],
      ],
      0,
      1,
      [
        'Divide',
        ['Multiply', (-1) ** m, ['Factorial', m], ['Zeta', m + 1]],
        ['Power', r, m + 1],
      ],
    ]);
  }
for (const m of [1, 2, 4])
  for (const kind of ['Floor', 'Ceil', 'Fract']) {
    const s = m + 1,
      floor: ExpressionInput = ['Divide', ['Zeta', s], s];
    const expected: ExpressionInput =
      kind === 'Floor'
        ? floor
        : kind === 'Ceil'
          ? ['Add', floor, ['Rational', 1, s]]
          : ['Subtract', ['Rational', 1, m], floor];
    cases.push([
      `accumulating jumps ${kind} weight=${m}`,
      ['Multiply', ['Power', 'x', m], [kind, ['Divide', 1, 'x']]],
      0,
      1,
      expected,
    ]);
  }
for (const k of [1, 2, 3]) {
  cases.push([
    `positive series k=${k}`,
    [
      'Sum',
      ['Divide', ['Power', 'x', 'n'], ['Power', ['Add', 'n', 1], k]],
      ['Limits', 'n', 0, 'PositiveInfinity'],
    ],
    0,
    1,
    ['Zeta', k + 1],
  ]);
}
for (const n of [1, 2, 3])
  for (const p of [1, 2]) {
    cases.push([
      `infinite product start=${n}, power=${p}`,
      [
        'Product',
        [
          'Divide',
          ['Add', 1, ['Divide', 'x', ['Power', ['Add', 'k', 1], p]]],
          ['Add', 1, ['Divide', 'x', ['Power', 'k', p]]],
        ],
        ['Limits', 'k', n, 'PositiveInfinity'],
      ],
      0,
      1,
      ['Multiply', n ** p, ['Ln', ['Rational', n ** p + 1, n ** p]]],
    ]);
  }
for (const r of [1, 2, 3]) {
  cases.push([
    `parameter normalization r=${r}`,
    ['Divide', ['Ln', ['Add', 1, ['Power', 'x', r]]], 'x'],
    0,
    1,
    ['Divide', ['Power', 'Pi', 2], 12 * r],
  ]);
}
cases.push(
  [
    'nonlinear floor partition',
    ['Floor', ['Power', 'x', 2]],
    0,
    2,
    ['Subtract', 5, ['Sqrt', 2], ['Sqrt', 3]],
  ],
  [
    'mixed parameter derivatives order three',
    ['Multiply', ['Power', ['Ln', 'x'], 2], ['Ln', ['Subtract', 1, 'x']]],
    0,
    1,
    [
      'Add',
      -6,
      ['Divide', ['Power', 'Pi', 2], 3],
      ['Multiply', 2, ['Zeta', 3]],
    ],
  ],
  [
    'nested logarithmic substitutions',
    [
      'Divide',
      [
        'Multiply',
        ['Ln', ['Ln', 'x']],
        ['Power', ['Subtract', 1, ['Ln', ['Ln', 'x']]], 2],
      ],
      ['Multiply', 'x', ['Ln', 'x']],
    ],
    'ExponentialE',
    ['Power', 'ExponentialE', 'ExponentialE'],
    ['Rational', 1, 12],
  ],
  [
    'logarithmic endpoint at parameter boundary',
    ['Divide', ['Ln', ['Subtract', 1, ['Power', 'x', 3]]], 'x'],
    0,
    1,
    ['Negate', ['Divide', ['Power', 'Pi', 2], 18]],
  ],
  [
    'half-angle chart split',
    ['Divide', 1, ['Add', 3, ['Cos', 'x']]],
    ['Divide', 'Pi', 2],
    ['Divide', ['Multiply', 3, 'Pi'], 2],
    [
      'Subtract',
      ['Divide', 'Pi', ['Sqrt', 2]],
      ['Multiply', ['Sqrt', 2], ['Arctan', ['Divide', 1, ['Sqrt', 2]]]],
    ],
  ],
  [
    'periodic quadratic weight',
    ['Multiply', ['Power', 'x', 2], ['Power', ['Fract', 'x'], 2]],
    0,
    2,
    ['Rational', 37, 30],
  ],
  [
    'negative periodic cells',
    ['Multiply', ['Power', 'x', 2], ['Power', ['Fract', 'x'], 2]],
    -1,
    0,
    ['Rational', 1, 30],
  ],
  ['floor square', ['Power', ['Floor', 'x'], 2], -2, 3, 10],
  ['ceil square', ['Power', ['Ceil', 'x'], 2], -2, 3, 15],
  [
    'alternating logarithm moment',
    ['Divide', ['Ln', 'x'], ['Add', 1, 'x']],
    0,
    1,
    ['Negate', ['Divide', ['Power', 'Pi', 2], 12]],
  ],
  [
    'telescoping product',
    [
      'Product',
      ['Divide', ['Add', 'x', 'n', 1], ['Add', 'x', 'n']],
      ['Limits', 'n', 1, 1000],
    ],
    0,
    1,
    ['Add', 1, ['Multiply', 1000, ['Ln', 2]]],
  ]
);

for (const r of [1, 2, 3, 5])
  for (const q of [1, 2, 5]) {
    cases.push([
      `generalized Beta r=${r}, q=${q}`,
      [
        'Multiply',
        ['Power', 'x', r - 1],
        ['Power', ['Subtract', 1, ['Power', 'x', r]], q],
      ],
      0,
      1,
      ['Rational', 1, r * (q + 1)],
    ]);
  }
for (const a of [1, 2, 4])
  for (const b of [1, 3, 5]) {
    cases.push([
      `Beta prime a=${a}, b=${b}`,
      ['Divide', ['Power', 'x', a - 1], ['Power', ['Add', 1, 'x'], a + b]],
      0,
      'PositiveInfinity',
      ['Beta', a, b],
    ]);
  }
for (const a of [1, 2, 3])
  for (const m of [1, 2, 3, 4]) {
    cases.push([
      `log moments a=${a}, order=${m}`,
      ['Multiply', ['Power', 'x', a - 1], ['Power', ['Ln', 'x'], m]],
      0,
      1,
      [
        'Divide',
        ['Multiply', (-1) ** m, ['Factorial', m]],
        ['Power', a, m + 1],
      ],
    ]);
  }
cases.push(
  [
    'mixed logarithms',
    ['Multiply', ['Ln', 'x'], ['Ln', ['Subtract', 1, 'x']]],
    0,
    1,
    ['Subtract', 2, ['Divide', ['Power', 'Pi', 2], 6]],
  ],
  [
    'logarithmic substitution',
    [
      'Divide',
      ['Multiply', ['Ln', 'x'], ['Power', ['Subtract', 1, ['Ln', 'x']], 2]],
      'x',
    ],
    1,
    'ExponentialE',
    ['Rational', 1, 12],
  ],
  [
    'fractional power substitution',
    ['Power', ['Subtract', 1, ['Power', 'x', ['Rational', 1, 2024]]], 2024],
    0,
    1,
    ['Multiply', 2024, ['Beta', 2024, 2025]],
  ],
  [
    'scaled Beta prime',
    ['Divide', 'x', ['Power', ['Add', 2, ['Multiply', 3, 'x']], 4]],
    0,
    'PositiveInfinity',
    ['Rational', 1, 216],
  ]
);
