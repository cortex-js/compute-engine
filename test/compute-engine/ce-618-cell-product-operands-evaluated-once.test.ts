import { ComputeEngine } from '../../src/compute-engine';

// ROADMAP CE-618: the product of a scalar and a list, or of two lists
// (`mulTensors`, arithmetic-mul-div.ts), finishes each cell product with
// `.evaluate()`. The `Multiply` handler evaluates its operands, so each cell,
// which is already a value of the evaluated list, was evaluated a second
// time. A cell that is an unevaluated integral tried its antiderivatives
// again. The handler now uses such a cell as its own value
// (`evaluateCellProduct()`); all the other steps of the evaluation of the
// cell product still run, so the values and the errors of string cells and
// absence markers are the same as before.
//
// `Held` is a lazy operator whose handler counts its calls and leaves the
// expression unevaluated. A lazy operator has no evaluation memo, so each
// evaluation of a `Held` node runs the handler, as for `Integrate`.

function countingEngine(): { ce: ComputeEngine; calls: () => number } {
  const ce = new ComputeEngine();
  let calls = 0;
  ce.declare('Held', {
    signature: '(number) -> number',
    lazy: true,
    evaluate: () => {
      calls += 1;
      return undefined;
    },
  });
  return { ce, calls: () => calls };
}

// An integral that `evaluate()` leaves unevaluated.
const I = [
  'Integrate',
  ['Function', ['Power', 'x', 'x'], 'x'],
  ['Limits', 'x', 0, 1],
];
// Its canonical form.
const canonicalI = [
  'Integrate',
  ['Function', ['Block', ['Power', 'x', 'x']], 'x'],
  ['Limits', 'x', 0, 1],
];
const typeError = (s: string) => [
  'Error',
  ['ErrorCode', "'incompatible-type'", "'number'", "'string'"],
  `'${s}'`,
];

describe('CE-618: each cell of a product with a list is evaluated once', () => {
  test('a scalar times a matrix of held cells', () => {
    const { ce, calls } = countingEngine();
    const value = ce
      .box([
        'Multiply',
        'y',
        [
          'List',
          ['List', ['Held', 1], ['Held', 2]],
          ['List', ['Held', 3], ['Held', 4]],
        ],
      ])
      .evaluate();
    expect(value.json).toEqual([
      'List',
      ['List', ['Multiply', 'y', ['Held', 1]], ['Multiply', 'y', ['Held', 2]]],
      ['List', ['Multiply', 'y', ['Held', 3]], ['Multiply', 'y', ['Held', 4]]],
    ]);
    // It was 8.
    expect(calls()).toBe(4);
  });

  test('the element-wise product of two lists of held cells', () => {
    const { ce, calls } = countingEngine();
    const value = ce
      .box([
        'Multiply',
        ['List', ['Held', 1], 'y'],
        ['List', 2, ['Held', 2]],
      ])
      .evaluate();
    expect(value.json).toEqual([
      'List',
      ['Multiply', 2, ['Held', 1]],
      ['Multiply', 'y', ['Held', 2]],
    ]);
    // It was 4.
    expect(calls()).toBe(2);
  });

  test('a held cell times a unit scalar is evaluated once', () => {
    // The scalar `k` evaluates to `1`, and the product of `1` and a cell is
    // the cell itself, not a `Multiply` node.
    const { ce, calls } = countingEngine();
    ce.assign('k', 1);
    const value = ce
      .box(['Multiply', 'k', ['List', ['Held', 1], ['Held', 2]]])
      .evaluate();
    expect(value.json).toEqual(['List', ['Held', 1], ['Held', 2]]);
    expect(calls()).toBe(2);
  });

  test('a held cell times a unit cell in an element-wise product', () => {
    // `multiply(Held(1), 1)` is the cell itself, not a `Multiply` node.
    const { ce, calls } = countingEngine();
    const value = ce
      .box([
        'Multiply',
        ['List', ['Held', 1], 'y'],
        ['List', 1, ['Held', 2]],
      ])
      .evaluate();
    expect(value.json).toEqual([
      'List',
      ['Held', 1],
      ['Multiply', 'y', ['Held', 2]],
    ]);
    // It was 3.
    expect(calls()).toBe(2);
  });

  test('a held scalar times a list is evaluated once', () => {
    // The scalar is an operand of the product, so it is a value: neither
    // `Held(1)·1`, which is the scalar itself, nor `2·Held(1)` evaluates it
    // again.
    const { ce, calls } = countingEngine();
    const value = ce
      .box(['Multiply', ['Held', 1], ['List', 1, 2]])
      .evaluate();
    expect(value.json).toEqual([
      'List',
      ['Held', 1],
      ['Multiply', 2, ['Held', 1]],
    ]);
    // It was 3.
    expect(calls()).toBe(1);
  });

  test('a held scalar times a list that reads an assigned variable', () => {
    // The cell `w` stays a product with the scalar (CE-121).
    const { ce, calls } = countingEngine();
    ce.assign('w', 4);
    const value = ce
      .box(['Multiply', ['Held', 1], ['List', 'w', 2]])
      .evaluate();
    expect(value.json).toEqual([
      'List',
      ['Multiply', 4, ['Held', 1]],
      ['Multiply', 2, ['Held', 1]],
    ]);
    // It was 3.
    expect(calls()).toBe(1);
  });

  test('a factor that the product builds from a cell is still evaluated', () => {
    // The cell `2w` keeps the symbol `w` (CE-121); the cell product
    // `3·(2w)` is `6w`, whose operands are not the cell, so `w` is read.
    const ce = new ComputeEngine();
    ce.assign('w', 4);
    const value = ce
      .box(['Multiply', 3, ['List', ['Multiply', 2, 'w'], I]])
      .evaluate();
    expect(value.json).toEqual([
      'List',
      24,
      ['Multiply', 3, canonicalI],
    ]);
  });

  test('an exact constant cell still becomes a float beside a float factor', () => {
    const ce = new ComputeEngine();
    const value = ce.box(['Multiply', 0.5, ['List', I, 'Pi']]).evaluate();
    expect(value.ops![0].json).toEqual(['Multiply', 0.5, canonicalI]);
    expect(value.ops![1].isExact).toBe(false);
    expect(value.ops![1].re).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('CE-618: the values and errors of a list of integrals times a scalar', () => {
  const cases: [string, unknown, unknown][] = [
    [
      'a string cell',
      ['Multiply', 'y', ['List', I, "'a'"]],
      ['List', ['Multiply', 'y', canonicalI], typeError('a')],
    ],
    [
      'a string cell beside a number',
      ['Multiply', 'y', ['List', "'a'", 1]],
      ['List', typeError('a'), 'y'],
    ],
    [
      'a string scalar',
      ['Multiply', "'s'", ['List', I, 1]],
      [...typeError('s'), ['ErrorTrace', ['ErrorFrame', "'Multiply'", 1]]],
    ],
    [
      'an error scalar',
      ['Multiply', ['Error', "'oops'"], ['List', I, 1]],
      ['Error', "'oops'", ['ErrorTrace', ['ErrorFrame', "'Multiply'", 1]]],
    ],
    [
      'a string cell in an element-wise product',
      ['Multiply', ['List', I, "'b'"], ['List', 2, 3]],
      ['List', ['Multiply', 2, canonicalI], typeError('b')],
    ],
    [
      'a Missing cell',
      ['Multiply', 2, ['List', 'Missing', I]],
      ['List', 'NaN', ['Multiply', 2, canonicalI]],
    ],
    [
      'an Undefined cell',
      ['Multiply', 'y', ['List', 'Undefined', I]],
      ['List', 'NaN', ['Multiply', 'y', canonicalI]],
    ],
    [
      'a Missing scalar',
      ['Multiply', 'Missing', ['List', I, 1]],
      ['List', 'NaN', 'NaN'],
    ],
    [
      'a Missing cell in an element-wise product',
      ['Multiply', ['List', I, 'Missing'], ['List', 2, 3]],
      ['List', ['Multiply', 2, canonicalI], 'NaN'],
    ],
    [
      'a Missing cell in a matrix',
      ['Multiply', 'y', ['List', ['List', I, 1], ['List', 2, 'Missing']]],
      [
        'List',
        ['List', ['Multiply', 'y', canonicalI], 'y'],
        ['List', ['Multiply', 2, 'y'], 'NaN'],
      ],
    ],
    [
      'an infinite scalar',
      ['Multiply', 'PositiveInfinity', ['List', I, 0]],
      ['List', ['Multiply', 'PositiveInfinity', canonicalI], 'Indeterminate'],
    ],
  ];
  test.each(cases)('%s', (_name, input, expected) => {
    const ce = new ComputeEngine();
    expect(ce.box(input as never).evaluate().json).toEqual(expected);
  });
});
