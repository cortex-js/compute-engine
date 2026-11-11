import { CancellationError, ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { engine as ce } from '../utils';
import type { MathJsonExpression } from '../../src/math-json/types';

// Algebraic numbers: PolynomialRoot (Wolfram's Root), MinimalPolynomial, AlgebraicIntegerQ,
// AlgebraicNumberNorm, AlgebraicNumberTrace, NumberFieldDiscriminant,
// NumberFieldIntegralBasis and NumberFieldSignature. The expected values were checked against
// Mathematica; the kernel is checked against Sage in `number-field-sage.test.ts`.

type Case = [
  head: string,
  id: string,
  input: MathJsonExpression,
  expected: MathJsonExpression,
];

// A decline is a case too: its expected value is its input.
const cases: Case[] = [
  [
    'PolynomialRoot',
    'root-of-x2-x-1-is-a-cube-root-of-unity',
    ['PolynomialRoot', ['Add', ['Power', 'x', 2], 'x', 1], 'x', 1],
    [
      'Multiply',
      ['Rational', 1, 2],
      ['Add', -1, ['Complex', 0, ['Negate', ['Sqrt', 3]]]],
    ],
  ],
  [
    'PolynomialRoot',
    'smaller-root-first',
    ['PolynomialRoot', ['Add', ['Power', 'x', 2], -2], 'x', 1],
    ['Negate', ['Sqrt', 2]],
  ],
  [
    'PolynomialRoot',
    'dedekind-cubic-stays-a-root',
    [
      'PolynomialRoot',
      [
        'Add',
        ['Power', 'x', 3],
        ['Negate', ['Power', 'x', 2]],
        ['Multiply', -2, 'x'],
        -8,
      ],
      'x',
      1,
    ],
    [
      'PolynomialRoot',
      [
        'Add',
        ['Power', 'x', 3],
        ['Negate', ['Power', 'x', 2]],
        ['Multiply', -2, 'x'],
        -8,
      ],
      'x',
      1,
    ],
  ],
  [
    'PolynomialRoot',
    'cube-root-of-2-as-a-number',
    ['N', ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 1]],
    { num: '1.2599210498948731648' },
  ],
  [
    'PolynomialRoot',
    'complex-roots-follow-the-real-one',
    ['N', ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 2]],
    [
      'Complex',
      { num: '-0.62996052494743658238' },
      { num: '-1.0911236359717214036' },
    ],
  ],
  [
    'PolynomialRoot',
    'complex-roots-follow-the-real-one-conjugate',
    ['N', ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 3]],
    [
      'Complex',
      { num: '-0.62996052494743658238' },
      { num: '1.0911236359717214036' },
    ],
  ],
  [
    'PolynomialRoot',
    'three-real-roots-smallest-first',
    [
      'N',
      [
        'PolynomialRoot',
        ['Add', ['Power', 'x', 3], ['Multiply', -3, 'x'], 1],
        'x',
        1,
      ],
    ],
    { num: '-1.8793852415718167' },
  ],
  [
    'PolynomialRoot',
    'three-real-roots-middle',
    [
      'N',
      [
        'PolynomialRoot',
        ['Add', ['Power', 'x', 3], ['Multiply', -3, 'x'], 1],
        'x',
        2,
      ],
    ],
    { num: '0.34729635533386063' },
  ],
  [
    'PolynomialRoot',
    'three-real-roots-largest',
    [
      'N',
      [
        'PolynomialRoot',
        ['Add', ['Power', 'x', 3], ['Multiply', -3, 'x'], 1],
        'x',
        3,
      ],
    ],
    { num: '1.5320888862379562' },
  ],
  [
    'PolynomialRoot',
    'quartic-roots-by-real-then-imaginary-part',
    ['N', ['PolynomialRoot', ['Add', ['Power', 'x', 4], 1], 'x', 3]],
    [
      'Complex',
      { num: '0.70710678118654752440' },
      { num: '-0.70710678118654752440' },
    ],
  ],
  [
    'PolynomialRoot',
    'quartic-complex-roots-first',
    ['N', ['PolynomialRoot', ['Add', ['Power', 'x', 4], 1], 'x', 1]],
    [
      'Complex',
      { num: '-0.70710678118654752440' },
      { num: '-0.70710678118654752440' },
    ],
  ],
  [
    'PolynomialRoot',
    'reducible-cubic-root-as-a-number',
    ['N', ['PolynomialRoot', ['Add', ['Power', 'x', 3], -1], 'x', 1]],
    { num: '1.0' },
  ],
  [
    'PolynomialRoot',
    'quadratic-root-as-a-number',
    ['N', ['PolynomialRoot', ['Add', ['Power', 'x', 2], -2], 'x', 2]],
    { num: '1.4142135623730950488' },
  ],
  [
    'PolynomialRoot',
    'index-past-the-degree-stays-unevaluated',
    ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 7],
    ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 7],
  ],
  [
    'PolynomialRoot',
    'index-zero-stays-unevaluated',
    ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 0],
    ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 0],
  ],
  [
    'PolynomialRoot',
    'variable-is-bound-under-replacement',
    [
      'ReplaceAll',
      ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 1],
      ['Rule', 'x', 3],
    ],
    ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 1],
  ],
  [
    'PolynomialRoot',
    'variable-is-bound-under-assignment',
    [
      'Block',
      ['Assign', 'x', 3],
      ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 1],
    ],
    ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 1],
  ],
  [
    'MinimalPolynomial',
    'one-plus-cube-root-of-2',
    ['MinimalPolynomial', ['Add', 1, ['Root', 2, 3]], 'x'],
    [
      'Add',
      ['Power', 'x', 3],
      ['Multiply', -3, ['Power', 'x', 2]],
      ['Multiply', 3, 'x'],
      -3,
    ],
  ],
  [
    'MinimalPolynomial',
    'golden-ratio',
    ['MinimalPolynomial', 'GoldenRatio', 'x'],
    ['Add', ['Power', 'x', 2], ['Negate', 'x'], -1],
  ],
  [
    'MinimalPolynomial',
    'half-of-cube-root-of-4-is-not-an-integer',
    ['MinimalPolynomial', ['Divide', ['Power', 2, ['Rational', 2, 3]], 2], 'x'],
    ['Add', ['Multiply', 2, ['Power', 'x', 3]], -1],
  ],
  [
    'MinimalPolynomial',
    'eisenstein-unit',
    ['MinimalPolynomial', ['Divide', ['Add', 1, ['Sqrt', -3]], 2], 'x'],
    ['Add', ['Power', 'x', 2], ['Negate', 'x'], 1],
  ],
  [
    'MinimalPolynomial',
    'real-cube-root-of-a-negative-number',
    ['MinimalPolynomial', ['Root', -2, 3], 'x'],
    ['Add', ['Power', 'x', 3], 2],
  ],
  [
    'MinimalPolynomial',
    'sixth-root-and-real-cube-root-stay-unevaluated',
    ['MinimalPolynomial', ['Add', ['Root', -2, 6], ['Root', -2, 3]], 'x'],
    ['MinimalPolynomial', ['Add', ['Root', -2, 6], ['Root', -2, 3]], 'x'],
  ],
  [
    'MinimalPolynomial',
    'another-root-of-the-same-cubic',
    [
      'MinimalPolynomial',
      ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 2],
      'x',
    ],
    ['Add', ['Power', 'x', 3], -2],
  ],
  [
    'MinimalPolynomial',
    'minus-i-is-not-i',
    [
      'MinimalPolynomial',
      ['Add', ['Power', -1, ['Rational', 3, 2]], 'ImaginaryUnit'],
      'x',
    ],
    'x',
  ],
  [
    'MinimalPolynomial',
    'an-exact-answer-under-n',
    ['N', ['MinimalPolynomial', ['Root', -2, 3], 'x']],
    ['Add', ['Power', 'x', 3], 2],
  ],
  [
    'MinimalPolynomial',
    'radical-index-past-the-cap-declines-at-once',
    ['MinimalPolynomial', ['Root', ['Rational', 1, 2], 1000000000000], 'x'],
    ['MinimalPolynomial', ['Root', ['Rational', 1, 2], 1000000000000], 'x'],
  ],
  [
    'MinimalPolynomial',
    'a-rational',
    ['MinimalPolynomial', 3, 'x'],
    ['Add', 'x', -3],
  ],
  [
    'NumberFieldDiscriminant',
    'dedekind-cubic',
    [
      'NumberFieldDiscriminant',
      [
        'PolynomialRoot',
        [
          'Add',
          ['Power', 'x', 3],
          ['Negate', ['Power', 'x', 2]],
          ['Multiply', -2, 'x'],
          -8,
        ],
        'x',
        1,
      ],
    ],
    -503,
  ],
  [
    'NumberFieldDiscriminant',
    'cube-root-of-19',
    ['NumberFieldDiscriminant', ['Root', 19, 3]],
    -1083,
  ],
  ['NumberFieldDiscriminant', 'rationals', ['NumberFieldDiscriminant', 3], 1],
  [
    'NumberFieldDiscriminant',
    'subfield-generated-by-a-square',
    [
      'NumberFieldDiscriminant',
      ['Power', ['PolynomialRoot', ['Add', ['Power', 'x', 4], -2], 'x', 1], 2],
    ],
    8,
  ],
  [
    'NumberFieldDiscriminant',
    'eighth-root-of-7',
    ['NumberFieldDiscriminant', ['Root', 7, 8]],
    -13816758796288,
  ],
  [
    'NumberFieldDiscriminant',
    'twelfth-root-of-3',
    ['NumberFieldDiscriminant', ['Root', 3, 12]],
    { num: '-1579460446107205632' },
  ],
  [
    'NumberFieldDiscriminant',
    'past-the-degree-cap-stays-unevaluated',
    [
      'NumberFieldDiscriminant',
      ['PolynomialRoot', ['Add', ['Power', 'x', 13], -2], 'x', 1],
    ],
    [
      'NumberFieldDiscriminant',
      ['PolynomialRoot', ['Add', ['Power', 'x', 13], -2], 'x', 1],
    ],
  ],
  [
    'NumberFieldDiscriminant',
    'index-past-the-degree-stays-unevaluated',
    [
      'NumberFieldDiscriminant',
      ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 7],
    ],
    [
      'NumberFieldDiscriminant',
      ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 7],
    ],
  ],
  [
    'NumberFieldIntegralBasis',
    'dedekind-cubic-basis',
    [
      'NumberFieldIntegralBasis',
      [
        'PolynomialRoot',
        [
          'Add',
          ['Power', 'x', 3],
          ['Negate', ['Power', 'x', 2]],
          ['Multiply', -2, 'x'],
          -8,
        ],
        'x',
        1,
      ],
    ],
    [
      'List',
      1,
      [
        'PolynomialRoot',
        [
          'Add',
          ['Power', 'x', 3],
          ['Negate', ['Power', 'x', 2]],
          ['Multiply', -2, 'x'],
          -8,
        ],
        'x',
        1,
      ],
      [
        'Add',
        [
          'Multiply',
          ['Rational', 1, 2],
          [
            'PolynomialRoot',
            [
              'Add',
              ['Power', 'x', 3],
              ['Negate', ['Power', 'x', 2]],
              ['Multiply', -2, 'x'],
              -8,
            ],
            'x',
            1,
          ],
        ],
        [
          'Multiply',
          ['Rational', 1, 2],
          [
            'Power',
            [
              'PolynomialRoot',
              [
                'Add',
                ['Power', 'x', 3],
                ['Negate', ['Power', 'x', 2]],
                ['Multiply', -2, 'x'],
                -8,
              ],
              'x',
              1,
            ],
            2,
          ],
        ],
      ],
    ],
  ],
  [
    'NumberFieldIntegralBasis',
    'cube-root-of-19',
    ['NumberFieldIntegralBasis', ['Root', 19, 3]],
    [
      'List',
      1,
      ['Root', 19, 3],
      [
        'Add',
        ['Rational', 1, 3],
        ['Multiply', ['Rational', 1, 3], ['Root', 19, 3]],
        ['Multiply', ['Rational', 1, 3], ['Power', 19, ['Rational', 2, 3]]],
      ],
    ],
  ],
  [
    'NumberFieldIntegralBasis',
    'eisenstein',
    ['NumberFieldIntegralBasis', ['Sqrt', -3]],
    [
      'List',
      1,
      [
        'Add',
        ['Rational', 1, 2],
        ['Multiply', ['Rational', 1, 2], ['Sqrt', -3]],
      ],
    ],
  ],
  [
    'NumberFieldIntegralBasis',
    'second-root-keeps-its-index',
    [
      'NumberFieldIntegralBasis',
      ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 2],
    ],
    [
      'List',
      1,
      ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 2],
      ['Power', ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 2], 2],
    ],
  ],
  [
    'NumberFieldIntegralBasis',
    'a-rational-generates-the-rationals',
    ['NumberFieldIntegralBasis', 3],
    ['List', 1],
  ],
  [
    'NumberFieldIntegralBasis',
    'square-of-a-fourth-root-generates-a-subfield',
    [
      'NumberFieldIntegralBasis',
      ['Power', ['PolynomialRoot', ['Add', ['Power', 'x', 4], -2], 'x', 1], 2],
    ],
    [
      'List',
      1,
      ['Power', ['PolynomialRoot', ['Add', ['Power', 'x', 4], -2], 'x', 1], 2],
    ],
  ],
  [
    'NumberFieldIntegralBasis',
    'index-past-the-degree-stays-unevaluated',
    [
      'NumberFieldIntegralBasis',
      ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 7],
    ],
    [
      'NumberFieldIntegralBasis',
      ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 7],
    ],
  ],
  [
    'NumberFieldSignature',
    'cube-root-of-2',
    ['NumberFieldSignature', ['Root', 2, 3]],
    ['List', 1, 1],
  ],
  [
    'NumberFieldSignature',
    'totally-real-quintic',
    [
      'NumberFieldSignature',
      [
        'PolynomialRoot',
        [
          'Add',
          ['Power', 'x', 5],
          ['Multiply', -5, ['Power', 'x', 3]],
          ['Multiply', 4, 'x'],
          -1,
        ],
        'x',
        1,
      ],
    ],
    ['List', 5, 0],
  ],
  [
    'NumberFieldSignature',
    'subfield-generated-by-a-square',
    [
      'NumberFieldSignature',
      ['Power', ['PolynomialRoot', ['Add', ['Power', 'x', 4], -2], 'x', 1], 2],
    ],
    ['List', 2, 0],
  ],
  [
    'NumberFieldSignature',
    'a-rational',
    ['NumberFieldSignature', 3],
    ['List', 1, 0],
  ],
  [
    'NumberFieldSignature',
    'numberfieldsignature-sqrt-2',
    ['NumberFieldSignature', ['Sqrt', 2]],
    ['List', 2, 0],
  ],
  [
    'NumberFieldSignature',
    'numberfieldsignature-i',
    ['NumberFieldSignature', ['Complex', 0, 1]],
    ['List', 0, 1],
  ],
  [
    'NumberFieldSignature',
    'numberfieldsignature-root-3-3',
    ['NumberFieldSignature', ['Root', 3, 3]],
    ['List', 1, 1],
  ],
  [
    'AlgebraicNumberNorm',
    'fundamental-unit-of-q-sqrt-2',
    ['AlgebraicNumberNorm', ['Add', 1, ['Sqrt', 2]]],
    -1,
  ],
  [
    'AlgebraicNumberNorm',
    'cube-root-of-2',
    ['AlgebraicNumberNorm', ['Root', 2, 3]],
    2,
  ],
  [
    'AlgebraicNumberNorm',
    'a-rational-is-its-own-norm',
    ['AlgebraicNumberNorm', 3],
    3,
  ],
  [
    'AlgebraicNumberNorm',
    'real-cube-root-of-minus-2',
    ['AlgebraicNumberNorm', ['Root', -2, 3]],
    -2,
  ],
  [
    'AlgebraicIntegerQ',
    'eisenstein-half-is-integral',
    ['AlgebraicIntegerQ', ['Divide', ['Add', 1, ['Sqrt', -3]], 2]],
    'True',
  ],
  [
    'AlgebraicIntegerQ',
    'half-of-one-plus-sqrt-minus-5-is-not',
    ['AlgebraicIntegerQ', ['Divide', ['Add', 1, ['Sqrt', -5]], 2]],
    'False',
  ],
  [
    'AlgebraicIntegerQ',
    'a-third-of-the-cube-root-trace',
    [
      'AlgebraicIntegerQ',
      [
        'Divide',
        ['Add', 1, ['Root', 19, 3], ['Power', 19, ['Rational', 2, 3]]],
        3,
      ],
    ],
    'True',
  ],
  [
    'AlgebraicNumberTrace',
    'one-plus-sqrt-2',
    ['AlgebraicNumberTrace', ['Add', 1, ['Sqrt', 2]]],
    2,
  ],
  [
    'AlgebraicNumberTrace',
    'cube-root-of-2-has-trace-0',
    ['AlgebraicNumberTrace', ['Root', 2, 3]],
    0,
  ],
  [
    'AlgebraicNumberTrace',
    'algebraicnumbertrace-5-plus-sqrt-2',
    ['AlgebraicNumberTrace', ['Add', 5, ['Sqrt', 2]]],
    10,
  ],
  [
    'AlgebraicNumberTrace',
    'algebraicnumbertrace-2',
    ['AlgebraicNumberTrace', 2],
    2,
  ],
  [
    'AlgebraicNumberTrace',
    'algebraicnumbertrace-neg-2-over-3',
    ['AlgebraicNumberTrace', ['Rational', -2, 3]],
    ['Rational', -2, 3],
  ],
  [
    'AlgebraicNumberTrace',
    'algebraicnumbertrace-1-over-2-times-1-plus-sqrt',
    [
      'AlgebraicNumberTrace',
      ['Multiply', ['Rational', 1, 2], ['Add', 1, ['Sqrt', 2]]],
    ],
    1,
  ],
];

const isN = (input: MathJsonExpression) =>
  Array.isArray(input) && input[0] === 'N';

/** A MathJSON number, `{ num }` or `Complex`, as [re, im]. */
const partsOf = (j: any): [number, number] =>
  Array.isArray(j) && j[0] === 'Complex'
    ? [partsOf(j[1])[0], partsOf(j[2])[0]]
    : [Number(typeof j === 'object' ? j.num : j), 0];

const isNumeric = (j: any): boolean =>
  typeof j === 'number' ||
  (typeof j === 'object' && j !== null && !Array.isArray(j) && 'num' in j) ||
  (Array.isArray(j) && j[0] === 'Complex');

describe('reference examples', () => {
  test.each(cases)('%s: %s', (_head, _id, input, expected) => {
    const result = ce.expr(input).evaluate();
    if (isN(input) && isNumeric(expected)) {
      // A number under N, to the digits of the reference.
      const [re, im] = partsOf(result.json);
      const [wantRe, wantIm] = partsOf(expected);
      expect(re).toBeCloseTo(wantRe, 12);
      expect(im).toBeCloseTo(wantIm, 12);
    } else {
      expect(result.json).toEqual(ce.expr(expected).json);
    }
  });

  // An exact answer is not made a float by N, and N reads the argument as written.
  test.each(
    cases.filter(
      ([head, , input, expected]) =>
        head !== 'PolynomialRoot' &&
        !isN(input) &&
        JSON.stringify(input) !== JSON.stringify(expected)
    )
  )('%s under N: %s', (_head, _id, input, expected) => {
    expect(ce.expr(input).N().json).toEqual(ce.expr(expected).json);
  });
});

describe('the parse route', () => {
  const parsed: [string, MathJsonExpression][] = [
    ['\\operatorname{AlgebraicNumberNorm}(1+\\sqrt{2})', -1],
    ['\\operatorname{AlgebraicNumberTrace}(\\sqrt[3]{2})', 0],
    ['\\operatorname{NumberFieldDiscriminant}(\\sqrt[3]{19})', -1083],
    ['\\operatorname{NumberFieldSignature}(\\sqrt[3]{2})', ['List', 1, 1]],
    ['\\operatorname{AlgebraicIntegerQ}(\\frac{1+\\sqrt{-3}}{2})', 'True'],
  ];
  test.each(parsed)('%s', (latex, expected) =>
    expect(ce.parse(latex).evaluate().json).toEqual(ce.expr(expected).json)
  );
});

describe('compound operands', () => {
  const compound: [MathJsonExpression, MathJsonExpression][] = [
    [['AlgebraicNumberNorm', ['Power', ['Add', 1, ['Sqrt', 2]], 2]], 1],
    [['AlgebraicNumberNorm', ['Square', ['Sqrt', 2]]], 2],
    [
      [
        'AlgebraicNumberTrace',
        ['Subtract', ['Add', 1, ['Sqrt', 2]], ['Sqrt', 2]],
      ],
      1,
    ],
    [['NumberFieldDiscriminant', ['Multiply', 3, ['Add', ['Sqrt', 5], 1]]], 5],
    [
      [
        'MinimalPolynomial',
        ['Add', ['Sqrt', 2], ['Negate', ['Sqrt', 2]], 3],
        'x',
      ],
      ['Add', 'x', -3],
    ],
    [['NumberFieldDiscriminant', 'GoldenRatio'], 5],
    // compute-engine writes (-4)^(1/4) as 1 + i, so its field is Q(i).
    [['NumberFieldDiscriminant', ['Power', -4, ['Rational', 1, 4]]], -4],
    [
      ['MinimalPolynomial', ['Multiply', 'ImaginaryUnit', ['Sqrt', 3]], 'x'],
      ['Add', ['Power', 'x', 2], 3],
    ],
    [
      ['NumberFieldSignature', ['Root', 2, 5]],
      ['List', 1, 2],
    ],
    [
      ['NumberFieldSignature', ['Complex', 0, 1]],
      ['List', 0, 1],
    ],
  ];
  test.each(compound)('%j', (input, expected) =>
    expect(ce.expr(input).evaluate().json).toEqual(ce.expr(expected).json)
  );
});

// What is not one generator's, or not algebraic, stays unevaluated, whole and as written.
describe('declined inputs', () => {
  const declined: MathJsonExpression[] = [
    ['NumberFieldDiscriminant', ['Add', ['Sqrt', 2], ['Sqrt', 3]]],
    ['AlgebraicIntegerQ', 'y'],
    ['MinimalPolynomial', 'Pi', 'x'],
    ['AlgebraicNumberNorm', 1.5],
    ['PolynomialRoot', ['Add', ['Power', 'x', 2], -2], 'x', 3],
    ['PolynomialRoot', ['Add', ['Power', 'x', 3], 'y'], 'x', 1],
    ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], ['Add', 'x', 1], 1],
    // A reducible polynomial is no one generator's.
    [
      'NumberFieldDiscriminant',
      ['PolynomialRoot', ['Add', ['Power', 'x', 3], -1], 'x', 1],
    ],
  ];
  test.each(declined.map((j) => [j]))('%j', (input) => {
    const expr = ce.expr(input);
    expect(expr.evaluate().json).toEqual(expr.json);
    expect(expr.N().json).toEqual(expr.json);
  });

  // The argument of a declined head is held: N does not turn it into a float.
  test('N leaves the argument of a declined head as written', () => {
    const call: MathJsonExpression = [
      'AlgebraicIntegerQ',
      ['Add', 'Pi', ['Sqrt', 2]],
    ];
    expect(ce.expr(call).N().json).toEqual(ce.expr(call).json);
  });
});

// Independent identities: the norm and trace are the minimal polynomial's constant and second
// coefficients, and Q(sqrt d) has the discriminant d (d = 1 mod 4) or 4d.
describe('identities', () => {
  const radicals: MathJsonExpression[] = [
    ['Sqrt', 2],
    ['Sqrt', -7],
    ['Root', 2, 3],
    ['Root', 5, 4],
    ['Add', 1, ['Root', 7, 3]],
    ['Multiply', 3, ['Sqrt', 5]],
    ['Power', 2, ['Rational', 2, 3]],
  ];
  test.each(radicals.map((j) => [j]))(
    'norm and trace of %j from its minimal polynomial',
    (a) => {
      const m = ce.expr(['MinimalPolynomial', a, 'x']).evaluate();
      const cs = ce
        .expr(['CoefficientList', m.json, 'x'])
        .evaluate()
        .ops!.map((c) => c.re)
        .reverse();
      const d = cs.length - 1;
      const sign = d % 2 === 0 ? 1 : -1;
      expect(ce.expr(['AlgebraicNumberNorm', a]).evaluate().re).toBeCloseTo(
        (sign * cs[0]!) / cs[d]!,
        12
      );
      expect(ce.expr(['AlgebraicNumberTrace', a]).evaluate().re).toBeCloseTo(
        -cs[d - 1]! / cs[d]!,
        12
      );
    }
  );

  const quadratic: [number, number][] = [
    [2, 8],
    [3, 12],
    [5, 5],
    [-1, -4],
    [-3, -3],
    [-5, -20],
    [-7, -7],
    [13, 13],
    [-15, -15],
    [17, 17],
    [-23, -23],
    [29, 29],
  ];
  test.each(quadratic)('Q(sqrt(%d)) has discriminant %d', (d, disc) =>
    expect(
      ce.expr(['NumberFieldDiscriminant', ['Sqrt', d]]).evaluate().re
    ).toBe(disc)
  );
});

describe('the index of a PolynomialRoot is part of the generator', () => {
  const cubic = ['Add', ['Power', 'x', 3], -2];
  const root = (k: number): MathJsonExpression => [
    'PolynomialRoot',
    cubic,
    'x',
    k,
  ];
  const run = (j: MathJsonExpression) => ce.expr(j).evaluate().json;
  const poly = (...j: MathJsonExpression[]) => ce.expr(['Add', ...j]).json;

  test('roots of one polynomial combine in its splitting field', () => {
    // root1 is the real cube root of 2, root2 that times a primitive cube root of unity: their
    // sum is a sixth root of -2 (not of 2: the root1 + root1 reading would say x^3 - 16).
    expect(run(['MinimalPolynomial', ['Add', root(1), root(2)], 'x'])).toEqual(
      poly(['Power', 'x', 3], 2)
    );
    expect(
      run(['MinimalPolynomial', ['Subtract', root(1), root(2)], 'x'])
    ).toEqual(poly(['Power', 'x', 6], 108));
    expect(run(['MinimalPolynomial', ['Add', root(3), root(2)], 'x'])).toEqual(
      poly(['Power', 'x', 3], 2)
    );
    expect(
      run(['MinimalPolynomial', ['Multiply', root(1), root(2)], 'x'])
    ).toEqual(poly(['Power', 'x', 3], -4));
    expect(run(['NumberFieldDiscriminant', ['Add', root(1), root(2)]])).toBe(
      -108
    );
    // A quartic with a dihedral splitting field.
    const quartic = ['Add', ['Power', 'x', 4], -2];
    expect(
      run([
        'MinimalPolynomial',
        [
          'Add',
          ['PolynomialRoot', quartic, 'x', 1],
          ['PolynomialRoot', quartic, 'x', 3],
        ],
        'x',
      ])
    ).toEqual(poly(['Power', 'x', 4], 8));
  });

  test('the answer is the minimal polynomial of the number N gives', () => {
    const sum = ce.expr(['Add', ['N', root(1)], ['N', root(2)]]).evaluate();
    const { re, im } = sum;
    const cube = {
      re: re ** 3 - 3 * re * im ** 2,
      im: 3 * re ** 2 * im - im ** 3,
    };
    expect(cube.re).toBeCloseTo(-2, 12);
    expect(cube.im).toBeCloseTo(0, 12);
  });

  test('a splitting field past the cap declines, and does not take long', () => {
    const s4 = ['Add', ['Power', 'x', 4], 'x', 1];
    const call: MathJsonExpression = [
      'MinimalPolynomial',
      ['Add', ['PolynomialRoot', s4, 'x', 1], ['PolynomialRoot', s4, 'x', 3]],
      'x',
    ];
    const start = Date.now();
    expect(run(call)).toEqual(ce.expr(call).json);
    expect(Date.now() - start).toBeLessThan(5000);
  });

  test('an integral basis is written on one generator, which several roots lack', () => {
    const call: MathJsonExpression = [
      'NumberFieldIntegralBasis',
      ['Add', root(1), root(2)],
    ];
    expect(run(call)).toEqual(ce.expr(call).json);
  });

  test('the name of the variable is not part of the generator', () => {
    const inY: MathJsonExpression = [
      'PolynomialRoot',
      ['Add', ['Power', 'y', 3], -2],
      'y',
      2,
    ];
    expect(run(['MinimalPolynomial', ['Add', root(1), inY], 'x'])).toEqual(
      poly(['Power', 'x', 3], 2)
    );
  });

  test('a root of another polynomial beside it declines', () => {
    const other: MathJsonExpression = [
      'PolynomialRoot',
      ['Add', ['Power', 'x', 3], -3],
      'x',
      1,
    ];
    const call: MathJsonExpression = [
      'MinimalPolynomial',
      ['Add', root(1), other],
      'x',
    ];
    expect(run(call)).toEqual(ce.expr(call).json);
  });
});

describe('an AlgebraicGenerator operand', () => {
  const g = (...c: number[]): MathJsonExpression => [
    'AlgebraicGenerator',
    ['List', ...c],
  ];
  const poly = (...j: MathJsonExpression[]) => ce.expr(['Add', ...j]).json;

  test('is read as the abstract root, with no embedding', () => {
    expect(
      ce.expr(['MinimalPolynomial', g(-2, 0, 0, 1), 'x']).evaluate().json
    ).toEqual(poly(['Power', 'x', 3], -2));
    expect(
      ce.expr(['NumberFieldDiscriminant', g(-2, 0, 0, 1)]).evaluate().json
    ).toBe(-108);
    expect(
      ce.expr(['NumberFieldSignature', g(-2, 0, 0, 1)]).evaluate().json
    ).toEqual(['List', 1, 1]);
    expect(
      ce.expr(['MinimalPolynomial', ['Add', 1, g(-2, 0, 0, 1)], 'x']).evaluate()
        .json
    ).toEqual(
      poly(
        ['Power', 'x', 3],
        ['Multiply', -3, ['Power', 'x', 2]],
        ['Multiply', 3, 'x'],
        -3
      )
    );
    expect(
      ce.expr(['NumberFieldDiscriminant', g(1, 0, 0, 0, 1)]).evaluate().json
    ).toBe(256);
    // A polynomial of degree 1 generates the rationals.
    expect(ce.expr(['NumberFieldDiscriminant', g(1, 1)]).evaluate().json).toBe(
      1
    );
  });

  test('is not the PolynomialRoot of its polynomial: the two do not mix', () => {
    const mixed: MathJsonExpression = [
      'MinimalPolynomial',
      [
        'Add',
        g(-2, 0, 0, 1),
        ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 'x', 1],
      ],
      'x',
    ];
    expect(ce.expr(mixed).evaluate().json).toEqual(ce.expr(mixed).json);
  });

  test('a reducible or too large polynomial declines', () => {
    for (const j of [
      g(-1, 0, 0, 1),
      g(-2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1),
    ]) {
      const call = ce.expr(['NumberFieldDiscriminant', j]);
      expect(call.evaluate().operator).toBe('NumberFieldDiscriminant');
    }
  });
});

describe('radicals of a negative base are the numbers the engine means', () => {
  test('the real cube root, and the principal sixth root', () => {
    expect(
      ce.expr(['MinimalPolynomial', ['Root', -2, 3], 'x']).evaluate().json
    ).toEqual(ce.expr(['Add', ['Power', 'x', 3], 2]).json);
    const mixed: MathJsonExpression = [
      'MinimalPolynomial',
      ['Add', ['Root', -2, 6], ['Root', -2, 3]],
      'x',
    ];
    expect(ce.expr(mixed).evaluate().json).toEqual(ce.expr(mixed).json);
  });

  test('(-1)^(3/2) is -i, not i', () => {
    const sum = (e: MathJsonExpression) =>
      ce
        .expr(['MinimalPolynomial', ['Add', e, 'ImaginaryUnit'], 'x'])
        .evaluate().json;
    expect(sum(['Power', -1, ['Rational', 3, 2]])).toBe('x');
    // (-1)^(1/2) is i: the sum is 2i.
    expect(sum(['Power', -1, ['Rational', 1, 2]])).toEqual(
      ce.expr(['Add', ['Power', 'x', 2], 4]).json
    );
  });
});

describe('limits', () => {
  test('a huge radical index or a degree past the cap declines at once', () => {
    const start = Date.now();
    for (const j of [
      ['MinimalPolynomial', ['Root', ['Rational', 1, 2], 10 ** 12], 'x'],
      ['NumberFieldDiscriminant', ['Root', 2, 13]],
      [
        'NumberFieldDiscriminant',
        ['PolynomialRoot', ['Add', ['Power', 'x', 13], -2], 'x', 1],
      ],
    ] as MathJsonExpression[]) {
      expect(ce.expr(j).evaluate().operator).toBe((j as unknown[])[0]);
    }
    expect(Date.now() - start).toBeLessThan(2000);
  });

  test('a radicand past the doubles declines, it does not throw', () => {
    const big = { num: '1' + '0'.repeat(400) + '1' };
    const call = ce.expr(['MinimalPolynomial', ['Sqrt', big], 'x']);
    expect(call.evaluate().operator).toBe('MinimalPolynomial');
  });

  test('the ring of integers of x^8 - 7 and x^12 - 3 comes from Eisenstein and Round 2, not a search', () => {
    const start = Date.now();
    expect(
      ce.expr(['NumberFieldDiscriminant', ['Root', 7, 8]]).evaluate().json
    ).toBe(-13816758796288);
    expect(
      ce.expr(['NumberFieldDiscriminant', ['Root', 3, 12]]).evaluate().json
    ).toEqual({ num: '-1579460446107205632' });
    expect(Date.now() - start).toBeLessThan(5000);
  });

  test('a computation is cut off by the time limit', () => {
    const arg = [
      'NumberFieldDiscriminant',
      ['Root', 12, 12],
    ] as MathJsonExpression;
    const engine = new ComputeEngine();
    expect(() =>
      engine.withTimeLimit({ ms: 0, label: 'test:number-field' }, () =>
        engine.expr(arg).evaluate()
      )
    ).toThrow(CancellationError);
    // Without a limit it answers, and the engine is usable.
    expect(engine.expr(arg).evaluate().operator).not.toBe(
      'NumberFieldDiscriminant'
    );
  });
});

describe('a subfield', () => {
  const quartic = ['Add', ['Power', 'x', 4], -2];
  const square: MathJsonExpression = [
    'Power',
    ['PolynomialRoot', quartic, 'x', 1],
    2,
  ];

  test('gives its own invariants', () => {
    expect(ce.expr(['NumberFieldDiscriminant', square]).evaluate().json).toBe(
      8
    );
    expect(ce.expr(['NumberFieldSignature', square]).evaluate().json).toEqual([
      'List',
      2,
      0,
    ]);
    expect(ce.expr(['AlgebraicNumberNorm', square]).evaluate().json).toBe(-2);
  });
});

describe('N of a PolynomialRoot', () => {
  const root = (c: MathJsonExpression, k: number): MathJsonExpression => [
    'PolynomialRoot',
    c,
    'x',
    k,
  ];
  const cubic = ['Add', ['Power', 'x', 3], -2];
  const n = (j: MathJsonExpression) => ce.expr(j).N();

  test('is a number in the documented order, for every degree', () => {
    expect(n(root(cubic, 1)).re).toBeCloseTo(2 ** (1 / 3), 14);
    expect([n(root(cubic, 2)).re, n(root(cubic, 2)).im]).toEqual([
      expect.closeTo(-(2 ** (1 / 3)) / 2, 14),
      expect.closeTo(-1.0911236359717214, 14),
    ]);
    expect(n(root(cubic, 3)).im).toBeGreaterThan(0);
    // Degree 5, with no radicals for its roots: one real, then the pair by imaginary part.
    const quintic = ['Add', ['Power', 'x', 5], 'x', -1];
    const values = [1, 2, 3, 4, 5].map((k) => n(root(quintic, k)));
    expect(values[0]!.im).toBe(0);
    expect(values[1]!.im).toBeLessThan(values[2]!.im);
    expect(values[1]!.re).toBeCloseTo(values[2]!.re, 12);
    expect(values[3]!.re).toBeGreaterThan(values[1]!.re);
    // And a quadratic's root is a number, not a radical.
    expect(n(root(['Add', ['Power', 'x', 2], -2], 2)).re).toBeCloseTo(
      Math.SQRT2,
      14
    );
  });

  test('evaluate keeps the name of a root of degree 3 or more; a quadratic’s root is a radical', () => {
    expect(ce.expr(root(cubic, 1)).evaluate().json).toEqual(
      ce.expr(root(cubic, 1)).json
    );
    expect(
      ce.expr(root(['Add', ['Power', 'x', 2], -2], 1)).evaluate().json
    ).toEqual(ce.expr(['Negate', ['Sqrt', 2]]).json);
  });
});

describe('PolynomialRoot takes its variable', () => {
  const engine = new ComputeEngine();
  const cubic = ['Add', ['Power', 'x', 3], -2];
  const call: MathJsonExpression = ['PolynomialRoot', cubic, 'x', 1];

  test('a substitution for x leaves the head alone', () => {
    expect(engine.expr(call).subs({ x: 3 }).json).toEqual(
      engine.expr(call).json
    );
  });

  test('a value assigned to x neither changes nor blocks it', () => {
    engine.assign('x', 3);
    try {
      expect(engine.expr(call).evaluate().json).toEqual(engine.expr(call).json);
      expect(
        engine.expr(['MinimalPolynomial', call, 'y']).evaluate().json
      ).toEqual(engine.expr(['Add', ['Power', 'y', 3], -2]).json);
      expect(engine.expr(call).N().re).toBeCloseTo(Math.cbrt(2), 14);
    } finally {
      engine.assign('x', engine.symbol('x'));
    }
  });

  test('the two-argument form is gone', () => {
    expect(engine.expr(['PolynomialRoot', cubic, 1]).evaluate().operator).toBe(
      'Error'
    );
  });

  test('a basis is written on the root, with its variable and index', () => {
    const root: MathJsonExpression = ['PolynomialRoot', cubic, 'x', 2];
    expect(
      engine.expr(['NumberFieldIntegralBasis', root]).evaluate().json
    ).toEqual(engine.expr(['List', 1, root, ['Power', root, 2]]).json);
  });
});

describe('compilation', () => {
  const engine = new ComputeEngine();
  const root = (k: number) =>
    engine.expr([
      'PolynomialRoot',
      ['Add', ['Power', 'x', 3], -2],
      'x',
      k,
    ] as MathJsonExpression);

  test('a real root compiles to its number, a complex one through the fallback', () => {
    const real = compile(root(1), { to: 'javascript' });
    expect(real.run?.()).toBeCloseTo(Math.cbrt(2), 12);
    const complex = compile(root(2), { to: 'javascript' });
    expect(complex.success).toBe(false);
    expect(complex.run?.()).toMatchObject({
      re: expect.closeTo(-Math.cbrt(2) / 2, 12),
      im: expect.closeTo(-1.0911236359717214, 12),
    });
  });
});

// The heads hold their operands in an operator that is not lazy, so they are not among the lazy
// operators `evaluate-async-evaluates-operands.test.ts` accounts for; the asynchronous route
// gives the synchronous answers.
describe('the asynchronous route', () => {
  const cubic = ['Add', ['Power', 'x', 3], -2];
  test.each([
    ['MinimalPolynomial', ['Add', 1, ['Root', 2, 3]], 'x'],
    ['NumberFieldDiscriminant', ['Root', 19, 3]],
    ['NumberFieldIntegralBasis', ['PolynomialRoot', cubic, 'x', 2]],
    ['PolynomialRoot', cubic, 'x', 2],
    ['PolynomialRoot', cubic, 'x', 7],
  ] as MathJsonExpression[][])('%j', async (...input) => {
    const expr = ce.expr(input as unknown as MathJsonExpression);
    expect((await expr.evaluateAsync()).json).toEqual(expr.evaluate().json);
    expect(
      (await expr.evaluateAsync({ numericApproximation: true })).json
    ).toEqual(expr.N().json);
  });
});
