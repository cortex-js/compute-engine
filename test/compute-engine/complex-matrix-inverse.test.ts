import { Complex } from 'complex.js';
import { ComputeEngine } from '../../src/compute-engine';
import { complexMatrixInverse } from '../../src/compute-engine/numerics/linear-algebra-complex';

const ce = new ComputeEngine();

type C = [re: number, im: number];

const toJson = (m: C[][]): any => [
  'List',
  ...m.map((row) => ['List', ...row.map(([re, im]) => ['Complex', re, im])]),
];

const toComplex = (m: C[][]) =>
  m.map((row) => row.map(([re, im]) => new Complex(re, im)));

/** The largest modulus of an entry of `a · b − I`. */
function identityDefect(a: Complex[][], b: Complex[][]): number {
  const n = a.length;
  let defect = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      let s = new Complex(i === j ? -1 : 0, 0);
      for (let k = 0; k < n; k++) s = s.add(a[i][k].mul(b[k][j]));
      defect = Math.max(defect, s.abs());
    }
  return defect;
}

// Singular matrices whose elimination in doubles leaves a rounding residue
// in place of a zero pivot. In each one a row is a combination of the
// others.
const SINGULAR: Array<[string, C[][]]> = [
  [
    'row 3 = row 1 + row 2',
    [
      [
        [3, 1],
        [2, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [1, 0],
        [1, 0],
      ],
      [
        [4, 1],
        [3, 0],
        [2, 0],
      ],
    ],
  ],
  [
    'row 2 = (1 + 2i) · row 1 − i · row 3',
    [
      [
        [1, 1],
        [2, -1],
        [0, 3],
      ],
      [
        [-1, -1],
        [5, 6],
        [-3, 2],
      ],
      [
        [4, 0],
        [-3, 1],
        [1, 3],
      ],
    ],
  ],
  [
    'order 4, row 4 = row 1 + i · row 2 − row 3',
    [
      [
        [1, 2],
        [0, 1],
        [3, 0],
        [2, -1],
      ],
      [
        [2, 0],
        [1, 1],
        [0, -2],
        [1, 0],
      ],
      [
        [0, 1],
        [4, 0],
        [1, 1],
        [3, 2],
      ],
      [
        [1, 3],
        [-5, 2],
        [4, -1],
        [-1, -2],
      ],
    ],
  ],
];

// Regular matrices. The second one has a 0 at the place of the first pivot.
const REGULAR: Array<[string, C[][]]> = [
  [
    'order 2',
    [
      [
        [1.5, 1],
        [2, 0],
      ],
      [
        [3, 0],
        [0, 1],
      ],
    ],
  ],
  [
    'order 3, a zero first pivot',
    [
      [
        [0, 0],
        [2, 1],
        [1, 0],
      ],
      [
        [1, 0],
        [1, -2],
        [1, 0],
      ],
      [
        [4, 1],
        [3, 0],
        [5, 0.5],
      ],
    ],
  ],
  [
    'order 4',
    [
      [
        [1, 2],
        [0, 1],
        [3, 0],
        [2, -1],
      ],
      [
        [2, 0],
        [1, 1],
        [0, -2],
        [1, 0],
      ],
      [
        [0, 1],
        [4, 0],
        [1, 1],
        [3, 2],
      ],
      [
        [1, 0],
        [0, 0],
        [0, 2],
        [7, 0.25],
      ],
    ],
  ],
];

describe('INVERSE OF A MATRIX OF COMPLEX MACHINE NUMBERS', () => {
  for (const [name, m] of SINGULAR) {
    test(`a singular matrix stays unevaluated: ${name}`, () => {
      expect(complexMatrixInverse(toComplex(m))).toBeUndefined();

      const json = toJson(m);
      expect(ce.box(['Inverse', json]).N().operator).toBe('Inverse');
      expect(ce.box(['Inverse', json]).evaluate().operator).toBe('Inverse');
      expect(ce.box(['PseudoInverse', json]).N().operator).toBe(
        'PseudoInverse'
      );
      // `MatrixPower` with a negative exponent gives the `Inverse` that has
      // no value.
      expect(ce.box(['MatrixPower', json, -1]).N().operator).toBe('Inverse');
      expect(ce.box(['MatrixPower', json, -2]).N().operator).toBe('Inverse');

      // Entries such as `0.9 + 0.3i` are machine numbers: `evaluate()`
      // takes the numeric kernel too. The factor is not 0.5, which makes
      // exact entries such as `i`: a matrix with an exact entry that is not
      // real does not take this kernel (CE-1822).
      const scaled = m.map((row) =>
        row.map(([re, im]): C => [re * 0.3, im * 0.3])
      );
      expect(ce.box(['Inverse', toJson(scaled)]).evaluate().operator).toBe(
        'Inverse'
      );
    });
  }

  test('a singular matrix of order 2 with a rounding residue', () => {
    // Row 2 is 3 · row 1, and `0.1 · 3` is not `0.3` in doubles.
    const m: C[][] = [
      [
        [0.1, 0.3],
        [0.7, 0.1],
      ],
      [
        [0.1 * 3, 0.3 * 3],
        [0.7 * 3, 0.1 * 3],
      ],
    ];
    expect(complexMatrixInverse(toComplex(m))).toBeUndefined();
    expect(ce.box(['Inverse', toJson(m)]).N().operator).toBe('Inverse');
    expect(ce.box(['Inverse', toJson(m)]).evaluate().operator).toBe('Inverse');
  });

  for (const [name, m] of REGULAR) {
    test(`a regular matrix: ${name}`, () => {
      const a = toComplex(m);
      const kernel = complexMatrixInverse(a);
      expect(kernel).toBeDefined();
      expect(identityDefect(a, kernel!)).toBeLessThan(1e-14);

      const inverse: any = ce.box(['Inverse', toJson(m)]).N();
      expect(inverse.operator).toBe('List');
      const cells: Complex[][] = inverse.ops.map((row: any) =>
        row.ops.map((z: any) => new Complex(z.re, z.im))
      );
      expect(identityDefect(a, cells)).toBeLessThan(1e-14);
    });
  }

  test('an order of 1', () => {
    const inverse = complexMatrixInverse([[new Complex(1.5, 1)]])!;
    expect(inverse[0][0].mul(new Complex(1.5, 1)).sub(1).abs()).toBeLessThan(
      1e-15
    );
    expect(complexMatrixInverse([[new Complex(0, 0)]])).toBeUndefined();
  });

  test('a column of zeros', () => {
    const m: C[][] = [
      [
        [1.5, 1],
        [0, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [0, 0],
        [1, 0],
      ],
      [
        [4, 1],
        [0, 0],
        [2, 0],
      ],
    ];
    expect(complexMatrixInverse(toComplex(m))).toBeUndefined();
    expect(ce.box(['Inverse', toJson(m)]).N().operator).toBe('Inverse');
  });

  test('an infinite or NaN entry has no inverse', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      for (const n of [2, 3]) {
        const m = Array.from({ length: n }, (_, i) =>
          Array.from(
            { length: n },
            (_, j) => new Complex(i === j ? 2 : 1, i + j)
          )
        );
        m[0][1] = new Complex(bad, 0);
        expect(complexMatrixInverse(m)).toBeUndefined();
        m[0][1] = new Complex(1, bad);
        expect(complexMatrixInverse(m)).toBeUndefined();
      }
    }
    expect(
      ce
        .box([
          'Inverse',
          [
            'List',
            ['List', ['Complex', 1.5, 1], 'NaN', 1],
            ['List', 1, 1, 1],
            ['List', ['Complex', 4, 1], 3, 2],
          ],
        ])
        .N().operator
    ).toBe('Inverse');
  });

  test('an inverse out of the range of a double has no value', () => {
    // The inverse of `diag(1e-200, 1e-200, 1e200) · (1 + i)` is in range:
    // `1 / (x(1 + i))` is `(1 − i) / (2x)`. The inverse of a matrix with an
    // entry of `1e-320` is not.
    const diagonal = (d: number[]) =>
      d.map((x, i) => d.map((_, j) => new Complex(i === j ? x : 0, 0)));
    const scaled = diagonal([1e-200, 1e-200, 1e200]).map((row) =>
      row.map((z) => z.mul(new Complex(1, 1)))
    );
    const inRange = complexMatrixInverse(scaled)!;
    expect(inRange[0][0].re / 5e199).toBeCloseTo(1, 14);
    expect(inRange[0][0].im / -5e199).toBeCloseTo(1, 14);
    expect(inRange[2][2].re / 5e-201).toBeCloseTo(1, 14);
    expect(inRange[2][2].im / -5e-201).toBeCloseTo(1, 14);
    expect(complexMatrixInverse(diagonal([1e-320, 1, 1]))).toBeUndefined();
  });

  test('a small entry that is not a residue keeps its value', () => {
    // For `d = 2⁻⁴⁴`, the elimination of column 1 leaves `d` in rows 2 and
    // 3. In row 2 it is small against its bound (about 2), so it is not a
    // pivot. It is not 0 either: the matrix is regular, and the last row of
    // its inverse is `[1, −1, 1] / (1 + i)`. With a 0 in place of that `d`
    // the last row was `[−1, 1, 0] / (1 + i)`.
    const d = 2 ** -44;
    const m = [
      [1, 1, 0],
      [1, 1 + d, 1],
      [0, d, 2],
    ].map((row) => row.map((x) => new Complex(x, x)));
    const inverse = complexMatrixInverse(m)!;
    const expected = [1, -1, 1];
    for (let j = 0; j < 3; j++) {
      expect(inverse[2][j].re).toBeCloseTo(0.5 * expected[j], 10);
      expect(inverse[2][j].im).toBeCloseTo(-0.5 * expected[j], 10);
    }
  });

  test('order 2 with entries whose products underflow', () => {
    // `z²` is below the doubles for `z = 2e-162 + 1e-162i`, so the
    // determinant of `diag(z, z)` has no digits. `1 / z` is
    // `(2 − i) / 5 · 1e162`.
    const z = new Complex(2e-162, 1e-162);
    const zero = new Complex(0, 0);
    const inverse = complexMatrixInverse([
      [z, zero],
      [zero, z],
    ])!;
    for (const k of [0, 1]) {
      expect(inverse[k][k].re / 4e161).toBeCloseTo(1, 14);
      expect(inverse[k][k].im / -2e161).toBeCloseTo(1, 14);
      expect(inverse[k][1 - k].abs()).toBe(0);
    }
  });
});
