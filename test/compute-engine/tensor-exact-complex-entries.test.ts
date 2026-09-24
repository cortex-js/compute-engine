import type { MathJsonExpression } from '../../src/math-json/types';
import type { Expression } from '../../src/compute-engine/global-types';
import { ComputeEngine } from '../../src/compute-engine';
import { packTensor } from '../../src/compute-engine/boxed-expression/tensor-view';

// An exact complex entry of a matrix (`i`, `1 + 2i`) must stay exact when an
// operator reads it through the packed tensor. Before, the packer stored it
// as a machine complex, which boxes as an INEXACT number, so exact complex
// matrices got machine answers: `Norm([[1, 1+2i], [0, 1]], 1)` was
// `3.236…`, not `1 + √5`. An inexact complex entry (`0.5i`) still packs as
// a machine complex.
//
// Each exact answer below is also checked against an independent float
// computation, so that a wrong closed form cannot pass.

const ce = new ComputeEngine();

const I: MathJsonExpression = ['Complex', 0, 1];
const A: MathJsonExpression = ['List', ['List', 1, I], ['List', 0, 1]];
const B: MathJsonExpression = [
  'List',
  ['List', 1, ['Complex', 1, 2]],
  ['List', 0, 1],
];
// `1 + √2 i` is an exact entry that is not a number literal.
const R: MathJsonExpression = [
  'List',
  ['List', 1, ['Add', 1, ['Multiply', ['Sqrt', 2], 'ImaginaryUnit']]],
  ['List', 0, 1],
];
const INEXACT: MathJsonExpression = [
  'List',
  ['List', 1.5, ['Complex', 0, 0.5]],
  ['List', 0, 1],
];

function evaluate(expr: MathJsonExpression): Expression {
  return ce.box(expr).evaluate();
}

/** Every leaf of `e` that is a number literal is exact. */
function allLeavesExact(e: Expression): boolean {
  if (e.operator === 'List') return e.ops!.every(allLeavesExact);
  return !(e.isNumberLiteral && e.isExact === false);
}

/** The numeric value of `e`, as `[re, im]`. */
function numeric(e: Expression): [number, number] {
  const v = e.N();
  return [v.re, v.im];
}

/** `e` is exact and its numeric value is `re + im·i`. */
function expectExactScalar(e: Expression, re: number, im = 0) {
  expect(allLeavesExact(e)).toBe(true);
  const [vr, vi] = numeric(e);
  expect(vr).toBeCloseTo(re, 12);
  expect(vi).toBeCloseTo(im, 12);
}

/** `e` is the exact list `expected`, and its numeric values agree. */
function expectExactList(
  e: Expression,
  expected: MathJsonExpression,
  values: [number, number][][]
) {
  expect(e.isSame(ce.box(expected))).toBe(true);
  expect(allLeavesExact(e)).toBe(true);
  for (let i = 0; i < values.length; i++)
    for (let j = 0; j < values[i].length; j++) {
      const [vr, vi] = numeric(e.ops![i].ops![j]);
      expect(vr).toBeCloseTo(values[i][j][0], 12);
      expect(vi).toBeCloseTo(values[i][j][1], 12);
    }
}

describe('PACKED TENSOR: EXACT COMPLEX ENTRIES', () => {
  test('an exact complex entry reads back as an exact expression', () => {
    for (const m of [A, B, R]) {
      const packed = packTensor(ce, ce.box(m))!;
      expect(packed.dtype).toBe('expression');
      const entry = packed.at(1, 2) as Expression;
      expect(entry.isExact === false).toBe(false);
    }
    const entry = packTensor(ce, ce.box(A))!.at(1, 2) as Expression;
    expect(entry.isSame(ce.box(I))).toBe(true);
    expect(entry.isExact).toBe(true);
  });

  test('under .N() an exact complex entry packs as a machine complex', () => {
    expect(packTensor(ce, ce.box(A), { numeric: true })!.dtype).toBe(
      'complex128'
    );
    expect(packTensor(ce, ce.box(B), { numeric: true })!.dtype).toBe(
      'complex128'
    );
  });

  test('an inexact complex entry still packs as a machine complex', () => {
    expect(packTensor(ce, ce.box(INEXACT))!.dtype).toBe('complex128');
    expect(packTensor(ce, ce.box(INEXACT), { numeric: true })!.dtype).toBe(
      'complex128'
    );
  });
});

describe('MATRIX OPERATORS: EXACT COMPLEX ENTRIES', () => {
  // [[1, i], [0, 1]]
  test('Norm of [[1, i], [0, 1]]', () => {
    // Column sums and row sums of |entries|: 1 and 1 + |i| = 2.
    expectExactScalar(evaluate(['Norm', A, 1]), 2);
    expectExactScalar(evaluate(['Norm', A, 'PositiveInfinity']), 2);
    // Largest singular value: √((t + √(t² − 4d)) / 2) with t = 3, d = 1,
    // which is the golden ratio (1 + √5) / 2.
    expectExactScalar(evaluate(['Norm', A, 2]), (1 + Math.sqrt(5)) / 2);
    // Frobenius: √(1 + 1 + 0 + 1).
    expectExactScalar(evaluate(['Norm', A]), Math.sqrt(3));
  });

  test('Determinant, Trace of [[1, i], [0, 1]]', () => {
    expectExactScalar(evaluate(['Determinant', A]), 1);
    expectExactScalar(evaluate(['Trace', A]), 2);
  });

  test('Transpose, ConjugateTranspose of [[1, i], [0, 1]]', () => {
    expectExactList(
      evaluate(['Transpose', A]),
      ['List', ['List', 1, 0], ['List', I, 1]],
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [1, 0],
        ],
      ]
    );
    expectExactList(
      evaluate(['ConjugateTranspose', A]),
      ['List', ['List', 1, 0], ['List', ['Complex', 0, -1], 1]],
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, -1],
          [1, 0],
        ],
      ]
    );
  });

  test('MatrixMultiply, Inverse of [[1, i], [0, 1]]', () => {
    expectExactList(
      evaluate(['MatrixMultiply', A, A]),
      ['List', ['List', 1, ['Complex', 0, 2]], ['List', 0, 1]],
      [
        [
          [1, 0],
          [0, 2],
        ],
        [
          [0, 0],
          [1, 0],
        ],
      ]
    );
    expectExactList(
      evaluate(['Inverse', A]),
      ['List', ['List', 1, ['Complex', 0, -1]], ['List', 0, 1]],
      [
        [
          [1, 0],
          [0, -1],
        ],
        [
          [0, 0],
          [1, 0],
        ],
      ]
    );
  });

  // [[1, 1+2i], [0, 1]]
  test('Norm of [[1, 1+2i], [0, 1]]', () => {
    // Column 2 and row 1: 1 + |1 + 2i| = 1 + √5.
    const one = evaluate(['Norm', B, 1]);
    expect(one.isSame(ce.box(['Add', 1, ['Sqrt', 5]]))).toBe(true);
    expectExactScalar(one, 1 + Math.sqrt(5));
    const inf = evaluate(['Norm', B, 'PositiveInfinity']);
    expect(inf.isSame(ce.box(['Add', 1, ['Sqrt', 5]]))).toBe(true);
    expectExactScalar(inf, 1 + Math.sqrt(5));
    // Largest singular value with t = 1 + 5 + 1 = 7 and d = |det|² = 1:
    // √((7 + 3√5) / 2) = (3 + √5) / 2.
    expectExactScalar(evaluate(['Norm', B, 2]), (3 + Math.sqrt(5)) / 2);
    expectExactScalar(evaluate(['Norm', B]), Math.sqrt(7));
  });

  test('Determinant, Trace, Inverse, MatrixMultiply of [[1, 1+2i], [0, 1]]', () => {
    expectExactScalar(evaluate(['Determinant', B]), 1);
    expectExactScalar(evaluate(['Trace', B]), 2);
    expectExactList(
      evaluate(['Inverse', B]),
      ['List', ['List', 1, ['Complex', -1, -2]], ['List', 0, 1]],
      [
        [
          [1, 0],
          [-1, -2],
        ],
        [
          [0, 0],
          [1, 0],
        ],
      ]
    );
    expectExactList(
      evaluate(['MatrixMultiply', B, B]),
      ['List', ['List', 1, ['Complex', 2, 4]], ['List', 0, 1]],
      [
        [
          [1, 0],
          [2, 4],
        ],
        [
          [0, 0],
          [1, 0],
        ],
      ]
    );
    expectExactList(
      evaluate(['ConjugateTranspose', B]),
      ['List', ['List', 1, 0], ['List', ['Complex', 1, -2], 1]],
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [1, -2],
          [1, 0],
        ],
      ]
    );
  });

  test('Inverse of [[2, 1+i], [1-i, 3]]: exact, and a float under .N()', () => {
    // det = 6 − (1 + i)(1 − i) = 4, so the inverse is
    // [[3, −1 − i], [−1 + i, 2]] / 4.
    const M: MathJsonExpression = [
      'List',
      ['List', 2, ['Complex', 1, 1]],
      ['List', ['Complex', 1, -1], 3],
    ];
    const values: [number, number][][] = [
      [
        [0.75, 0],
        [-0.25, -0.25],
      ],
      [
        [-0.25, 0.25],
        [0.5, 0],
      ],
    ];
    const exact = evaluate(['Inverse', M]);
    expect(allLeavesExact(exact)).toBe(true);
    expect(exact.ops![0].ops![0].isSame(ce.box(['Rational', 3, 4]))).toBe(true);
    const approx = ce.box(['Inverse', M]).N();
    expect(approx.ops![0].ops![0].isExact).toBe(false);
    for (const e of [exact, approx])
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          const [vr, vi] = numeric(e.ops![i].ops![j]);
          expect(vr).toBeCloseTo(values[i][j][0], 12);
          expect(vi).toBeCloseTo(values[i][j][1], 12);
        }
    // The order-1 norm: column 2 is |1 + i| + 3 = 3 + √2.
    expectExactScalar(evaluate(['Norm', M, 1]), 3 + Math.SQRT2);
  });

  test('an entry that is not a number literal: 1 + √2 i', () => {
    // 1 + |1 + √2 i| = 1 + √3.
    expectExactScalar(evaluate(['Norm', R, 1]), 1 + Math.sqrt(3));
    const product = evaluate(['MatrixMultiply', R, R]);
    expect(allLeavesExact(product)).toBe(true);
    const [re, im] = numeric(product.ops![0].ops![1]);
    expect(re).toBeCloseTo(2, 12);
    expect(im).toBeCloseTo(2 * Math.SQRT2, 12);
  });

  test('a complex entry with a rational part: 1/2 + i', () => {
    const M: MathJsonExpression = [
      'List',
      ['List', 1, ['Complex', ['Rational', 1, 2], 1]],
      ['List', 0, 1],
    ];
    expect(packTensor(ce, ce.box(M))!.dtype).toBe('expression');
    // 1 + |1/2 + i| = 1 + √5 / 2.
    expectExactScalar(evaluate(['Norm', M, 1]), 1 + Math.sqrt(5) / 2);
    const transpose = evaluate(['Transpose', M]);
    expect(allLeavesExact(transpose)).toBe(true);
    const [re, im] = numeric(transpose.ops![1].ops![0]);
    expect(re).toBeCloseTo(0.5, 12);
    expect(im).toBeCloseTo(1, 12);
  });

  test('rational entries: the order-∞ norm is an exact sum', () => {
    // [[1/2, i], [0, 1]]: the row sums are 1/2 + 1 = 3/2 and 1.
    const M: MathJsonExpression = [
      'List',
      ['List', ['Rational', 1, 2], I],
      ['List', 0, 1],
    ];
    const inf = evaluate(['Norm', M, 'PositiveInfinity']);
    expect(inf.isSame(ce.box(['Rational', 3, 2]))).toBe(true);
    // [[π, 1], [0, 1]]: the column sums are π and 2. The norm was undecided
    // before, because the magnitude `π` is not a number literal.
    const P: MathJsonExpression = ['List', ['List', 'Pi', 1], ['List', 0, 1]];
    const one = evaluate(['Norm', P, 1]);
    expect(one.isSame(ce.box('Pi'))).toBe(true);
  });

  test('an inexact complex entry keeps machine answers', () => {
    const det = evaluate(['Determinant', INEXACT]);
    expect(det.isExact).toBe(false);
    expect(det.re).toBeCloseTo(1.5, 12);
    const inverse = evaluate(['Inverse', INEXACT]);
    const entry = inverse.ops![0].ops![1];
    expect(entry.isExact).toBe(false);
    // The inverse of [[a, b], [0, 1]] is [[1/a, −b/a], [0, 1]].
    expect(entry.re).toBeCloseTo(0, 12);
    expect(entry.im).toBeCloseTo(-0.5 / 1.5, 12);
    const one = evaluate(['Norm', INEXACT, 1]);
    expect(one.isExact).toBe(false);
    expect(one.re).toBeCloseTo(1.5, 12);
    const two = evaluate(['Norm', INEXACT, 2]);
    expect(two.isExact).toBe(false);
  });
});
