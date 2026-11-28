import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// The inverse of a matrix of number literals that has an inexact entry and
// is not a matrix of machine numbers: an exact entry (a fraction, `i`, a
// radical) next to a decimal one. The elimination works at the precision of
// the engine, and a singular matrix leaves a rounding residue in place of a
// zero pivot (`AbstractTensor.inexactInverse()` of `tensor/tensors.ts`).

const ce = new ComputeEngine();

const third = ['Rational', 1, 3];
const fourThirds = ['Rational', 4, 3];
const list = (m: unknown[][]): any => [
  'List',
  ...m.map((row) => ['List', ...row]),
];

// In each matrix a row is a combination of the others.
const SINGULAR: Array<[string, unknown[][]]> = [
  [
    'a fraction next to decimals, row 3 = row 1 + row 2',
    [
      [third, 2.5, 1],
      [1, 1, 1],
      [fourThirds, 3.5, 2],
    ],
  ],
  [
    'i next to decimals, row 3 = row 1 + row 2',
    [
      [['Complex', 0, 1], 2.5, 1],
      [1, 1, 1],
      [['Complex', 1, 1], 3.5, 2],
    ],
  ],
  [
    'order 2, row 2 = 3 · row 1',
    [
      [third, 0.1],
      [1, 0.3],
    ],
  ],
  [
    // The residue of column 2 is the factor that clears row 3 from its row.
    // It writes a residue in column 3 of that row, where the entry was 0.
    'row 2 = 3 · row 1, with a column of zeros in these rows',
    [
      [['Rational', 3, 4], 0.1, 0],
      [['Rational', 9, 4], 0.3, 0],
      [0, 1, 1],
    ],
  ],
  [
    'order 4, row 4 = row 1 − row 2 + row 3',
    [
      [third, 2.5, 1, 0.7],
      [1, ['Rational', 2, 7], 1, 4],
      [0.25, 3, ['Rational', 5, 3], 1],
      [
        ['Rational', -5, 12],
        ['Rational', 73, 14],
        ['Rational', 5, 3],
        -2.3,
      ],
    ],
  ],
];

/** The cells of the matrix `m`, by row. */
const cells = (m: Expression): Expression[][] =>
  (m as any).ops.map((row: any) => row.ops);

/** The largest modulus of an entry of `a · b − I`. */
function identityDefect(a: Expression, b: Expression): number {
  const product = ce.box(['MatrixMultiply', a.json, b.json] as any).N();
  let defect = 0;
  cells(product).forEach((row, i) =>
    row.forEach((x, j) => {
      defect = Math.max(defect, Math.hypot(x.re - (i === j ? 1 : 0), x.im));
    })
  );
  return defect;
}

describe('Inverse of a matrix with exact and decimal entries', () => {
  for (const [name, m] of SINGULAR) {
    it(`a singular matrix stays unevaluated: ${name}`, () => {
      const inverse = ce.box(['Inverse', list(m)]);
      expect(inverse.evaluate().operator).toBe('Inverse');
      expect(inverse.N().operator).toBe('Inverse');
    });
  }

  it('PseudoInverse and MatrixPower of a singular matrix have no value', () => {
    const m = list(SINGULAR[0][1]);
    expect(ce.box(['PseudoInverse', m]).evaluate().operator).toBe(
      'PseudoInverse'
    );
    expect(ce.box(['MatrixPower', m, -1]).evaluate().operator).toBe('Inverse');
  });

  it('a singular matrix stays unevaluated at a precision of 50 digits', () => {
    const engine = new ComputeEngine();
    engine.precision = 50;
    const inverse = engine.box(['Inverse', list(SINGULAR[0][1])]);
    expect(inverse.evaluate().operator).toBe('Inverse');
    expect(inverse.N().operator).toBe('Inverse');
  });

  it('a regular matrix has an inverse at the precision of the engine', () => {
    const inverse = ce
      .box([
        'Inverse',
        list([
          [third, 2.5],
          [1, 1],
        ]),
      ])
      .evaluate();
    // The exact inverse is [[-6/13, 15/13], [6/13, -2/13]].
    const digits = (i: number, j: number) =>
      cells(inverse)[i][j].toString().slice(0, 20);
    expect(digits(0, 0)).toBe('-0.46153846153846153');
    expect(digits(0, 1)).toBe('1.153846153846153846');
    expect(digits(1, 0)).toBe('0.461538461538461538');
    expect(digits(1, 1)).toBe('-0.15384615384615384');
  });

  // Row 1 is the pivot of column 1. In column 2, the entry of row 2 is then
  // 2.5 − (1/3) · 7.5, a residue or 0, and the pivot is the entry of row 3.
  it('a residue is not a pivot when a row below has a pivot', () => {
    const m = ce.box(
      list([
        [1, 7.5, 2],
        [third, 2.5, 1],
        [0, 1, ['Rational', 1, 7]],
      ])
    );
    const inverse = ce.box(['Inverse', m.json] as any).evaluate();
    expect(inverse.operator).toBe('List');
    expect(identityDefect(m, inverse)).toBeLessThan(1e-12);
  });

  it('a regular matrix with a complex entry has an inverse', () => {
    const m = ce.box(
      list([
        [['Complex', 0, 1], 2.5, 1],
        [1, 1, 1],
        [['Complex', 1, 1], 3.5, 7],
      ])
    );
    const inverse = ce.box(['Inverse', m.json] as any).evaluate();
    expect(inverse.operator).toBe('List');
    expect(identityDefect(m, inverse)).toBeLessThan(1e-12);
  });

  // A matrix with no inexact entry keeps the exact elimination.
  it('a matrix of exact entries has an exact inverse', () => {
    const inverse = ce
      .box([
        'Inverse',
        list([
          [third, 2],
          [1, 1],
        ]),
      ])
      .evaluate();
    expect(inverse.json).toEqual([
      'List',
      ['List', ['Rational', -3, 5], ['Rational', 6, 5]],
      ['List', ['Rational', 3, 5], ['Rational', -1, 5]],
    ]);
  });

  // `1e-400` has no machine modulus, so the pivots of this matrix are
  // tested for an exact 0.
  it('a matrix with an entry outside the range of a double has an inverse', () => {
    const inverse = ce
      .box([
        'Inverse',
        list([
          [{ num: '1e-400' }, 2.5],
          [1, third],
        ]),
      ])
      .evaluate();
    expect(inverse.operator).toBe('List');
    expect(cells(inverse)[1][0].re).toBeCloseTo(0.4, 12);
  });

  // A matrix with an infinite entry has no inverse, on every path: a matrix
  // of machine numbers (`1.5`), of exact entries (the generic elimination),
  // and of complex entries (CE-1823).
  it.each([
    ['a machine number', 1.5, 'PositiveInfinity'],
    ['a machine number, -oo', 1.5, 'NegativeInfinity'],
    ['an integer', 1, 'PositiveInfinity'],
    ['an integer, ~oo', 1, 'ComplexInfinity'],
    ['a complex number', ['Complex', 1.5, 1], 'PositiveInfinity'],
    ['a fraction', third, 'PositiveInfinity'],
  ])(
    'a matrix with an infinite entry next to %s has no inverse',
    (_, a, inf) => {
      const m = list([
        [a, inf, 1],
        [1, 1, 1],
        [4, 3, 2],
      ]);
      expect(ce.box(['Inverse', m]).evaluate().operator).toBe('Inverse');
      expect(ce.box(['Inverse', m]).N().operator).toBe('Inverse');
    }
  );
});
