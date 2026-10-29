import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { engine as ce } from '../utils';
import type { MathJsonExpression } from '../../src/math-json';
import {
  coordinates,
  element,
  isIrreducible,
  maximalOrder,
  norm,
  orderDiscriminant,
  orderIndex,
  realRootCount,
  trace,
} from '../../src/compute-engine/numerics/number-field';

// Issue #395, algebraic numbers: PolynomialRoot (Wolfram's Root), MinimalPolynomial,
// AlgebraicIntegerQ, AlgebraicNumberNorm, AlgebraicNumberTrace,
// NumberFieldDiscriminant, NumberFieldIntegralBasis and NumberFieldSignature.
// Expected values were checked against Mathematica; the kernel is checked against
// Sage (fixtures/number-fields.sage.json) and by independent identities below.

const dedekind: MathJsonExpression = [
  'PolynomialRoot',
  [
    'Add',
    ['Power', 'x', 3],
    ['Negate', ['Power', 'x', 2]],
    ['Multiply', -2, 'x'],
    -8,
  ],
  1,
];

const reference: [MathJsonExpression, MathJsonExpression][] = [
  // PolynomialRoot: real roots first in increasing order, then complex roots.
  [
    ['PolynomialRoot', ['Add', ['Power', 'x', 2], 'x', 1], 1],
    [
      'Multiply',
      ['Rational', 1, 2],
      ['Add', -1, ['Complex', 0, ['Negate', ['Sqrt', 3]]]],
    ],
  ],
  [
    ['PolynomialRoot', ['Add', ['Power', 'x', 2], -2], 1],
    ['Negate', ['Sqrt', 2]],
  ],
  [
    ['PolynomialRoot', ['Add', ['Power', 'x', 2], -2], 2],
    ['Sqrt', 2],
  ],
  [['PolynomialRoot', ['Add', ['Multiply', 3, 'x'], -6], 1], 2],
  // A cubic's root is its own name.
  [dedekind, dedekind],
  // MinimalPolynomial
  [
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
    ['MinimalPolynomial', 'GoldenRatio', 'x'],
    ['Add', ['Power', 'x', 2], ['Negate', 'x'], -1],
  ],
  [
    ['MinimalPolynomial', ['Divide', ['Power', 2, ['Rational', 2, 3]], 2], 'x'],
    ['Add', ['Multiply', 2, ['Power', 'x', 3]], -1],
  ],
  [
    ['MinimalPolynomial', ['Divide', ['Add', 1, ['Sqrt', -3]], 2], 'x'],
    ['Add', ['Power', 'x', 2], ['Negate', 'x'], 1],
  ],
  [
    ['MinimalPolynomial', ['Multiply', 'ImaginaryUnit', ['Sqrt', 3]], 'x'],
    ['Add', ['Power', 'x', 2], 3],
  ],
  // AlgebraicIntegerQ
  [['AlgebraicIntegerQ', ['Divide', ['Add', 1, ['Sqrt', -3]], 2]], 'True'],
  [['AlgebraicIntegerQ', ['Divide', ['Add', 1, ['Sqrt', -5]], 2]], 'False'],
  [
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
  // AlgebraicNumberNorm and AlgebraicNumberTrace
  [['AlgebraicNumberNorm', ['Add', 1, ['Sqrt', 2]]], -1],
  [['AlgebraicNumberNorm', ['Root', 2, 3]], 2],
  [['AlgebraicNumberNorm', 3], 3],
  [['AlgebraicNumberNorm', ['Add', 1, ['Root', 2, 3]]], 3],
  [['AlgebraicNumberTrace', ['Add', 1, ['Sqrt', 2]]], 2],
  [['AlgebraicNumberTrace', ['Root', 2, 3]], 0],
  [['AlgebraicNumberTrace', ['Add', 5, ['Sqrt', 2]]], 10],
  [['AlgebraicNumberTrace', 2], 2],
  [
    ['AlgebraicNumberTrace', ['Rational', -2, 3]],
    ['Rational', -2, 3],
  ],
  [
    [
      'AlgebraicNumberTrace',
      ['Multiply', ['Rational', 1, 2], ['Add', 1, ['Sqrt', 2]]],
    ],
    1,
  ],
  [['AlgebraicNumberTrace', ['Add', 1, ['Root', 2, 3]]], 3],
  // NumberFieldDiscriminant
  [['NumberFieldDiscriminant', dedekind], -503],
  [['NumberFieldDiscriminant', ['Root', 19, 3]], -1083],
  [['NumberFieldDiscriminant', 3], 1],
  [['NumberFieldDiscriminant', 'GoldenRatio'], 5],
  // compute-engine writes (−4)^(1/4) as 1 + i, so its field is ℚ(i).
  [['NumberFieldDiscriminant', ['Power', -4, ['Rational', 1, 4]]], -4],
  // NumberFieldIntegralBasis
  [
    ['NumberFieldIntegralBasis', dedekind],
    [
      'List',
      1,
      dedekind,
      [
        'Add',
        ['Multiply', ['Rational', 1, 2], dedekind],
        ['Multiply', ['Rational', 1, 2], ['Power', dedekind, 2]],
      ],
    ],
  ],
  [
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
  // NumberFieldSignature
  [
    ['NumberFieldSignature', ['Root', 2, 3]],
    ['List', 1, 1],
  ],
  [
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
        1,
      ],
    ],
    ['List', 5, 0],
  ],
  [
    ['NumberFieldSignature', ['Sqrt', 2]],
    ['List', 2, 0],
  ],
  [
    ['NumberFieldSignature', ['Complex', 0, 1]],
    ['List', 0, 1],
  ],
  [
    ['NumberFieldSignature', ['Root', 3, 3]],
    ['List', 1, 1],
  ],
  [
    ['NumberFieldSignature', ['Root', 2, 5]],
    ['List', 1, 2],
  ],
];

describe('Algebraic numbers (#395): reference values', () => {
  for (const [input, expected] of reference) {
    const want = ce.expr(expected);
    const label = `${ce.expr(input).toString()} = ${want.toString()}`;
    test(`${label} (evaluate)`, () =>
      expect(ce.expr(input).evaluate().json).toEqual(want.json));
    // An exact answer is not made a float by `.N()`.
    test(`${label} (N)`, () =>
      expect(ce.expr(input).N().json).toEqual(want.json));
  }
});

// The same heads reached from LaTeX.
const parsed: [string, MathJsonExpression][] = [
  ['\\operatorname{AlgebraicNumberNorm}(1+\\sqrt{2})', -1],
  ['\\operatorname{AlgebraicNumberTrace}(\\sqrt[3]{2})', 0],
  ['\\operatorname{NumberFieldDiscriminant}(\\sqrt[3]{19})', -1083],
  ['\\operatorname{NumberFieldSignature}(\\sqrt[3]{2})', ['List', 1, 1]],
  ['\\operatorname{AlgebraicIntegerQ}(\\frac{1+\\sqrt{-3}}{2})', 'True'],
];

describe('Algebraic numbers (#395): parse route', () => {
  for (const [latex, expected] of parsed) {
    const want = ce.expr(expected);
    test(`${latex} = ${want.toString()}`, () =>
      expect(ce.parse(latex).evaluate().json).toEqual(want.json));
  }
});

// An operand that reduces to the literal takes the same route.
const compound: [MathJsonExpression, MathJsonExpression][] = [
  [
    [
      'AlgebraicNumberTrace',
      ['Subtract', ['Add', 1, ['Sqrt', 2]], ['Sqrt', 2]],
    ],
    1,
  ],
  [['NumberFieldDiscriminant', ['Multiply', 3, ['Add', ['Sqrt', 5], 1]]], 5],
  [['AlgebraicNumberNorm', ['Power', ['Add', 1, ['Sqrt', 2]], 2]], 1],
  [['AlgebraicNumberNorm', ['Square', ['Sqrt', 2]]], 2],
  [
    [
      'MinimalPolynomial',
      ['Add', ['Sqrt', 2], ['Negate', ['Sqrt', 2]], 3],
      'x',
    ],
    ['Add', 'x', -3],
  ],
];

describe('Algebraic numbers (#395): compound operands', () => {
  for (const [input, expected] of compound) {
    const want = ce.expr(expected);
    test(`${ce.expr(input).toString()} = ${want.toString()}`, () =>
      expect(ce.expr(input).evaluate().json).toEqual(want.json));
  }
});

// What is not one generator's, or not algebraic, stays unevaluated.
const unevaluated: MathJsonExpression[] = [
  ['NumberFieldDiscriminant', ['Add', ['Sqrt', 2], ['Sqrt', 3]]],
  ['AlgebraicIntegerQ', 'y'],
  ['MinimalPolynomial', 'Pi', 'x'],
  ['AlgebraicNumberNorm', 1.5],
  // x^4 + 1 splits mod every prime, so its irreducibility is not certified.
  [
    'NumberFieldSignature',
    ['PolynomialRoot', ['Add', ['Power', 'x', 4], 1], 1],
  ],
  // The k-th root of a polynomial of degree d needs 1 <= k <= d.
  ['PolynomialRoot', ['Add', ['Power', 'x', 2], -2], 3],
  ['PolynomialRoot', ['Add', ['Power', 'x', 2], -2], 0],
  ['PolynomialRoot', ['Add', ['Power', 'x', 3], -2], 1],
];

describe('Algebraic numbers (#395): declined inputs', () => {
  for (const input of unevaluated) {
    const expr = ce.expr(input);
    test(`${expr.toString()} stays unevaluated`, () => {
      expect(expr.evaluate().operator).toBe(expr.operator);
      expect(expr.N().operator).toBe(expr.operator);
    });
  }
});

// Independent identities: the norm and trace are the minimal polynomial's constant and
// second coefficients, and the discriminant of Q(a) is a field invariant.
describe('Algebraic numbers (#395): identities', () => {
  const radicals: MathJsonExpression[] = [
    ['Sqrt', 2],
    ['Sqrt', -7],
    ['Root', 2, 3],
    ['Root', 5, 4],
    ['Add', 1, ['Root', 7, 3]],
    ['Multiply', 3, ['Sqrt', 5]],
    ['Power', 2, ['Rational', 2, 3]],
  ];
  for (const a of radicals) {
    test(`${ce.expr(a).toString()}: norm and trace from the minimal polynomial`, () => {
      const m = ce.expr(['MinimalPolynomial', a, 'x']).evaluate();
      const coefficients = ce
        .expr(['CoefficientList', m.json, 'x'])
        .evaluate()
        .ops!.map((c) => c.re)
        .reverse();
      const d = coefficients.length - 1;
      const sign = d % 2 === 0 ? 1 : -1;
      expect(ce.expr(['AlgebraicNumberNorm', a]).evaluate().re).toBeCloseTo(
        (sign * coefficients[0]!) / coefficients[d]!,
        12
      );
      expect(ce.expr(['AlgebraicNumberTrace', a]).evaluate().re).toBeCloseTo(
        -coefficients[d - 1]! / coefficients[d]!,
        12
      );
    });
  }

  // Q(sqrt(d)) has the discriminant d (d = 1 mod 4) or 4d, for squarefree d.
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
  for (const [d, disc] of quadratic) {
    test(`Q(sqrt(${d})) has discriminant ${disc}`, () =>
      expect(
        ce.expr(['NumberFieldDiscriminant', ['Sqrt', d]]).evaluate().re
      ).toBe(disc));
  }
});

// The kernel against Sage: each field's discriminant, index, signature and integral basis.
interface SageField {
  f: string[];
  discriminant: string;
  index: string;
  signature: [number, number];
  basis: string[][];
}

const sage: SageField[] = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'number-fields.sage.json'), 'utf8')
);

const gcdOf = (a: bigint, b: bigint): bigint =>
  b === 0n ? (a < 0n ? -a : a) : gcdOf(b, a % b);

describe('Algebraic numbers (#395): number-field kernel against Sage', () => {
  for (const field of sage) {
    const f = field.f.map(BigInt);
    const n = f.length - 1;
    test(`Q[x]/(${field.f.join(' ')}): discriminant, index, signature and basis`, () => {
      const o = maximalOrder(f)!;
      expect(isIrreducible(f)).toBe(true);
      expect(o).toBeDefined();
      expect(orderDiscriminant(o).toString()).toBe(field.discriminant);
      expect(orderIndex(o).toString()).toBe(field.index);
      const r1 = realRootCount(f);
      expect([r1, (n - r1) / 2]).toEqual(field.signature);
      // Sage's basis lies in our ring of integers.
      for (const b of field.basis) {
        const cs = b.map((t) => {
          const [num, den = '1'] = t.split('/');
          return { num: BigInt(num!), den: BigInt(den) };
        });
        const den = cs.reduce((l, c) => (l * c.den) / gcdOf(l, c.den), 1n);
        const x = element(
          cs.map((c) => (c.num * den) / c.den),
          den
        );
        expect(coordinates(o, x)).toBeDefined();
      }
    });
  }

  test('a polynomial no prime certifies is left undecided, and a reducible one is reducible', () => {
    // x^4 + 1 splits mod every prime; x^4 - 10x^2 + 1 (sqrt 2 + sqrt 3) too.
    expect(isIrreducible([1n, 0n, 0n, 0n, 1n])).toBeUndefined();
    expect(isIrreducible([1n, 0n, -10n, 0n, 1n])).toBeUndefined();
    expect(isIrreducible([-6n, 1n, 1n])).toBe(false);
    expect(maximalOrder([-6n, 1n, 1n])).toBeDefined();
  });

  test('norm and trace of theta + 1 in Q(cbrt 2)', () => {
    const f = [-2n, 0n, 0n, 1n];
    const x = element([1n, 1n, 0n]);
    expect(norm(f, x)).toEqual({ num: 3n, den: 1n });
    expect(trace(f, x)).toEqual({ num: 3n, den: 1n });
  });
});
