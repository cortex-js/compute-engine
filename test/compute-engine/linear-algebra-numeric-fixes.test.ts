import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { singularValues } from '../../src/compute-engine/numerics/linear-algebra';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

const ce = new ComputeEngine();

type C = [number, number];

/**
 * The singular values of a complex matrix, in descending order, computed
 * independently of the engine: power iteration on the Hermitian matrix
 * `G = Aᴴ A`, with deflation (`G ← G − λ v vᴴ`) after each eigenvalue. The
 * singular values are the square roots of the eigenvalues of `G`. Used to
 * check the values the engine answers.
 */
function powerIterationSingularValues(a: C[][]): number[] {
  const m = a.length;
  const n = a[0].length;
  const mul = (x: C, y: C): C => [
    x[0] * y[0] - x[1] * y[1],
    x[0] * y[1] + x[1] * y[0],
  ];
  const conj = (x: C): C => [x[0], -x[1]];
  const G: C[][] = [];
  for (let j = 0; j < n; j++) {
    G.push([]);
    for (let k = 0; k < n; k++) {
      let s: C = [0, 0];
      for (let i = 0; i < m; i++) {
        const t = mul(conj(a[i][j]), a[i][k]);
        s = [s[0] + t[0], s[1] + t[1]];
      }
      G[j].push(s);
    }
  }
  const result: number[] = [];
  for (let r = 0; r < Math.min(m, n); r++) {
    let v: C[] = Array.from({ length: n }, (_, i) => [1 + i / 7, 0.3 * i]);
    let lambda = 0;
    for (let it = 0; it < 5000; it++) {
      const w: C[] = G.map((row) =>
        row.reduce<C>(
          (s, g, k) => {
            const t = mul(g, v[k]);
            return [s[0] + t[0], s[1] + t[1]];
          },
          [0, 0]
        )
      );
      const norm = Math.sqrt(w.reduce((s, x) => s + x[0] ** 2 + x[1] ** 2, 0));
      if (norm === 0) {
        lambda = 0;
        break;
      }
      v = w.map((x) => [x[0] / norm, x[1] / norm]);
      lambda = norm;
    }
    result.push(Math.sqrt(Math.max(0, lambda)));
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++) {
        const t = mul(v[j], conj(v[k]));
        G[j][k] = [G[j][k][0] - lambda * t[0], G[j][k][1] - lambda * t[1]];
      }
  }
  return result.sort((x, y) => y - x);
}

/** The value of a number literal as a big decimal. */
function big(x: Expression): BigDecimal {
  if (!isNumber(x)) throw new Error(`not a number: ${x.toString()}`);
  return x.bignumRe ?? new BigDecimal(x.re);
}

/** `|x / expected − 1|` as a machine number. */
function relativeError(x: Expression, expected: BigDecimal): number {
  return Math.abs(big(x).div(expected).toNumber() - 1);
}

const P = (e: number) => ['Power', 10, e];

// Exact entries outside the float64 range (`10^400`, `10^-400`): their
// machine value is infinite or 0. Under `.N()` the numeric kernels receive
// the entries divided by a power of ten, and the norm is a big decimal.
describe('MATRIX NORMS OF ENTRIES OUTSIDE THE FLOAT64 RANGE', () => {
  test('spectral norm under N() with an entry of 10^400', () => {
    // Was NaN. The other entries are 1, so the norm is 10^400 (1 + ε) with
    // ε ≈ 5·10^-801, which is 10^400 at the working precision.
    const r = ce
      .box([
        'Norm',
        ['List', ['List', P(400), 1, 0], ['List', 0, 1, 0], ['List', 0, 0, 1]],
        2,
      ])
      .N();
    expect(r.toString()).toBe('1e+400');
  });

  test('spectral norm of a 3 × 3 matrix of 10^-400 (rank 1)', () => {
    // The matrix has rank 1, so its norm is its Frobenius norm √(9·10^-800).
    const row = ['List', P(-400), P(-400), P(-400)];
    const A = ['List', row, row, row];
    expect(ce.box(['Norm', A, 2]).evaluate().toString()).toBe('3/1e+400');
    // Was 0.
    expect(ce.box(['Norm', A, 2]).N().toString()).toBe('3e-400');
  });

  test('spectral norm under N() of a scaled 3 × 3 matrix', () => {
    // 10^400 times [[3, 1, 0], [0, 2, 1], [1, 0, 1]], whose spectral norm is
    // 3.424789294659917434931 (mpmath at 60 digits).
    const s = (k: number) => ['Multiply', k, P(400)];
    const A = [
      'List',
      ['List', s(3), s(1), 0],
      ['List', 0, s(2), s(1)],
      ['List', s(1), 0, s(1)],
    ];
    const [expected] = powerIterationSingularValues([
      [
        [3, 0],
        [1, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [2, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [0, 0],
        [1, 0],
      ],
    ]);
    expect(expected).toBeCloseTo(3.424789294659917, 12);
    const r = ce.box(['Norm', A, 2]).N();
    expect(
      relativeError(r, new BigDecimal(expected).mul(new BigDecimal('1e400')))
    ).toBeLessThan(1e-13);
  });

  test('order-1 and order-∞ norms under N()', () => {
    // Was +oo.
    const D = ['List', ['List', P(400), 0], ['List', 0, P(400)]];
    expect(ce.box(['Norm', D, 1]).N().toString()).toBe('1e+400');
    expect(ce.box(['Norm', D, 'Infinity']).N().toString()).toBe('1e+400');
    // Was 0.
    const E = ['List', ['List', P(-400), 0], ['List', 0, 0]];
    expect(ce.box(['Norm', E, 1]).N().toString()).toBe('1e-400');
    // The sums are added at working precision: 10^400 + 2·10^400.
    const F = [
      'List',
      ['List', P(400), 1],
      ['List', ['Multiply', 2, P(400)], 1],
    ];
    expect(ce.box(['Norm', F, 1]).N().toString()).toBe('3e+400');
  });

  test('the machine route is unchanged for entries a float64 holds', () => {
    const A = ['List', ['List', 1.5, 2], ['List', 3, 4.25]];
    expect(ce.box(['Norm', A, 1]).N().re).toBe(6.25);
    // A 3 × 3 matrix of ones has rank 1: its norm is exactly 3 (the Jacobi
    // iteration gives 3.0000000000000004).
    const ones = [
      'List',
      ['List', 1, 1, 1],
      ['List', 1, 1, 1],
      ['List', 1, 1, 1],
    ];
    expect(ce.box(['Norm', ones, 2]).evaluate().toString()).toBe('3');
    expect(ce.box(['Norm', ones, 2]).N().toString()).toBe('3');
  });
});

describe('SINGULAR VALUES OF AN EXACT MATRIX WITH LARGE ENTRIES', () => {
  // 10^200 · [[1, 1], [1, 2]]: the Gram matrix is 10^400 · [[2, 3], [3, 5]],
  // whose eigenvalues are 10^400 · (7 ± 3√5) / 2, so the singular values
  // are 10^200 · (3 ± √5) / 2.
  const A = [
    'List',
    ['List', P(200), P(200)],
    ['List', P(200), ['Multiply', 2, P(200)]],
  ];
  const sqrt5 = new BigDecimal(5).sqrt();
  const expected = [
    new BigDecimal(3).add(sqrt5).div(2).mul(new BigDecimal('1e200')),
    new BigDecimal(3).sub(sqrt5).div(2).mul(new BigDecimal('1e200')),
  ];

  test('evaluate() is exact, and its N() is the value', () => {
    const r = ce.box(['SingularValues', A]).evaluate();
    expect(r.operator).toBe('List');
    // No operand is a number rounded through a float (it was
    // `sqrt(6.85410196624968454462e+400)`).
    expect(r.toString()).not.toMatch(/\d\.\d{8,}/);
    const values = r.N();
    expect(relativeError(values.ops![0], expected[0])).toBeLessThan(1e-19);
    expect(relativeError(values.ops![1], expected[1])).toBeLessThan(1e-19);
  });

  test('N() gives the values at working precision', () => {
    const r = ce.box(['SingularValues', A]).N();
    expect(relativeError(r.ops![0], expected[0])).toBeLessThan(1e-19);
    expect(relativeError(r.ops![1], expected[1])).toBeLessThan(1e-19);
  });

  test('a Gram matrix that cannot be scaled to small integers', () => {
    // [[10^200, 10^200], [10^200, 10^200 + 1]]: the singular values are
    // 2·10^200 (to 25 digits) and 1/2 (mpmath at 600 digits). The smaller
    // one is det / σ₁, not a difference of two nearly equal numbers.
    const B = [
      'List',
      ['List', P(200), P(200)],
      ['List', P(200), ['Add', P(200), 1]],
    ];
    const r = ce.box(['SingularValues', B]).evaluate();
    expect(r.toString()).not.toMatch(/\d\.\d{8,}/);
    const values = r.N();
    expect(relativeError(values.ops![0], new BigDecimal('2e200'))).toBeLessThan(
      1e-19
    );
    expect(relativeError(values.ops![1], new BigDecimal('0.5'))).toBeLessThan(
      1e-19
    );
  });
});

describe('SVD OF ENTRIES NEAR THE FLOAT64 LIMITS', () => {
  test('SVD of a diagonal matrix of 1e200', () => {
    // Was NaN: AᵀA overflowed.
    const r = ce
      .box(['SVD', ['List', ['List', 1e200, 0], ['List', 0, 1e200]]])
      .N();
    expect(r.toString()).toBe(
      '([[1,0],[0,1]], [[1e+200,0],[0,1e+200]], [[1,0],[0,1]])'
    );
  });

  for (const scale of [1e200, 1e-200]) {
    test(`SingularValues of a real 3 × 3 matrix scaled by ${scale}`, () => {
      const M = [
        [1, 2, 0],
        [0, 3, 1],
        [1, 0, 2],
      ];
      const expected = powerIterationSingularValues(
        M.map((row) => row.map((x): C => [x, 0]))
      );
      // mpmath: 3.810193085157426, 2.122155457269326, 0.9893861071394491.
      expect(expected[0]).toBeCloseTo(3.810193085157426, 12);
      const r = ce
        .box([
          'SingularValues',
          ['List', ...M.map((row) => ['List', ...row.map((x) => x * scale)])],
        ])
        .N();
      const values = r.ops!.map((x) => x.re / scale);
      for (let k = 0; k < 3; k++)
        expect(values[k] / expected[k]).toBeCloseTo(1, 8);
    });
  }
});

describe('SINGULAR VALUES OF A COMPLEX MATRIX', () => {
  test('3 × 3 under N()', () => {
    const r = ce
      .box([
        'SingularValues',
        [
          'List',
          ['List', 1, 'ImaginaryUnit', 0],
          ['List', 0, 2, 0],
          ['List', 0, 0, 3],
        ],
      ])
      .N();
    const expected = powerIterationSingularValues([
      [
        [1, 0],
        [0, 1],
        [0, 0],
      ],
      [
        [0, 0],
        [2, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [0, 0],
        [3, 0],
      ],
    ]);
    // mpmath: 3, 2.2882456112707371904, 0.8740320488976421415986.
    expect(expected[1]).toBeCloseTo(2.28824561127073719, 12);
    expect(expected[2]).toBeCloseTo(0.874032048897642141, 12);
    const values = r.ops!.map((x) => x.re);
    expect(values.length).toBe(3);
    for (let k = 0; k < 3; k++) expect(values[k]).toBeCloseTo(expected[k], 13);
  });

  test('3 × 3 of exact entries stays unevaluated under evaluate()', () => {
    const r = ce
      .box([
        'SingularValues',
        [
          'List',
          ['List', 1, 'ImaginaryUnit', 0],
          ['List', 0, 2, 0],
          ['List', 0, 0, 3],
        ],
      ])
      .evaluate();
    expect(r.operator).toBe('SingularValues');
  });

  test('3 × 3 with an inexact entry under evaluate()', () => {
    const r = ce
      .box([
        'SingularValues',
        [
          'List',
          ['List', 1.5, 'ImaginaryUnit', 0],
          ['List', 2, 2, ['Complex', 1, -1]],
          ['List', 0, 'ImaginaryUnit', 3],
        ],
      ])
      .evaluate();
    const expected = powerIterationSingularValues([
      [
        [1.5, 0],
        [0, 1],
        [0, 0],
      ],
      [
        [2, 0],
        [2, 0],
        [1, -1],
      ],
      [
        [0, 0],
        [0, 1],
        [3, 0],
      ],
    ]);
    // mpmath: 4.076286107817164, 2.318195181384083, 1.122436041930413.
    expect(expected[0]).toBeCloseTo(4.076286107817164, 12);
    const values = r.ops!.map((x) => x.re);
    for (let k = 0; k < 3; k++) expect(values[k]).toBeCloseTo(expected[k], 13);
  });

  test('singularValues() in numerics: 2 × 3 complex', () => {
    const re = [
      [1, 0, 2],
      [0, 3, 1],
    ];
    const im = [
      [0, 1, 0],
      [-1, 0, 0.5],
    ];
    const expected = powerIterationSingularValues(
      re.map((row, i) => row.map((x, j): C => [x, im[i][j]]))
    );
    const values = singularValues(re, im);
    expect(values.length).toBe(2);
    for (let k = 0; k < 2; k++) expect(values[k]).toBeCloseTo(expected[k], 12);
  });
});

describe('SPECTRAL NORM OF A 2 × 2 MATRIX WITH A SYMBOLIC ENTRY', () => {
  test('the closed form, checked at x = 3 and x = -1/2', () => {
    const r = ce
      .box(['Norm', ['List', ['List', 'x', 1], ['List', 0, 1]], 2])
      .evaluate();
    expect(r.operator).toBe('Sqrt');
    for (const x of [3, -0.5]) {
      const [expected] = powerIterationSingularValues([
        [
          [x, 0],
          [1, 0],
        ],
        [
          [0, 0],
          [1, 0],
        ],
      ]);
      expect(r.subs({ x }).N().re).toBeCloseTo(expected, 13);
      expect(
        ce.box(['Norm', ['List', ['List', x, 1], ['List', 0, 1]], 2]).N().re
      ).toBeCloseTo(expected, 13);
    }
    // mpmath at x = 3: 3.179586801558725123115.
    expect(r.subs({ x: 3 }).N().re).toBeCloseTo(3.179586801558725, 14);
  });

  test('a diagonal matrix with a symbolic entry', () => {
    // The moduli |x| and 1 cannot be ordered, so the closed form answers:
    // it is max(|x|, 1).
    const r = ce
      .box(['Norm', ['List', ['List', 'x', 0], ['List', 0, 1]], 2])
      .evaluate();
    expect(r.operator).toBe('Sqrt');
    expect(r.subs({ x: 3 }).N().re).toBeCloseTo(3, 14);
    expect(r.subs({ x: 0.5 }).N().re).toBeCloseTo(1, 14);
  });
});

// The double kernels have an absolute error of about ε·σ_max, and an entry
// much smaller than the largest one underflows to 0 once the matrix is
// scaled and its Gram matrix is formed. The small singular values of such a
// matrix came back as 0. The numeric routes of `SingularValues` and `SVD`
// now decline a matrix whose nonzero entry magnitudes span more than
// 10^150; the spectral norm, which needs only the largest singular value,
// still answers.
describe('SINGULAR VALUES OF A MATRIX WITH A WIDE RANGE OF ENTRIES', () => {
  const wide = [
    'List',
    ['List', P(400), 1, 0],
    ['List', 0, 1, 0],
    ['List', 0, 0, 1],
  ];
  const diagonal = ['List', ['List', 1e200, 0], ['List', 0, 1e-200]];

  test('SingularValues under N() with entries 10^400 and 1 declines', () => {
    // True values: 10^400, 1, 1. Was [1e+400, 0, 0].
    const r = ce.box(['SingularValues', wide]).N();
    expect(r.operator).toBe('SingularValues');
  });

  test('SingularValues of [[1e200, 0], [0, 1e-200]] declines', () => {
    // True values: 1e200, 1e-200. Was [1e+200, 0].
    const r = ce.box(['SingularValues', diagonal]).evaluate();
    expect(r.operator).toBe('SingularValues');
  });

  test('SVD of [[1e200, 0], [0, 1e-200]] declines', () => {
    // Was U = [[1, 0], [0, 0]], S = [[1e+200, 0], [0, 0]], V = [[1, 0],
    // [0, 0]]: U and V were not orthogonal.
    const r = ce.box(['SVD', diagonal]).evaluate();
    expect(r.operator).toBe('SVD');
  });

  test('the exact route still answers for exact entries', () => {
    const r = ce
      .box([
        'SingularValues',
        ['List', ['List', P(200), 0], ['List', 0, P(-200)]],
      ])
      .evaluate();
    expect(r.operator).toBe('List');
    expect(r.ops!.every((x) => !x.isNumberLiteral || x.isExact)).toBe(true);
    const [s1, s2] = r.N().ops!;
    expect(relativeError(s1, new BigDecimal('1e200'))).toBeLessThan(1e-14);
    expect(relativeError(s2, new BigDecimal('1e-200'))).toBeLessThan(1e-14);
  });

  test('a matrix with a narrow range still answers', () => {
    const r = ce
      .box(['SingularValues', ['List', ['List', 3, 0], ['List', 0, 4]]])
      .N();
    expect(r.toString()).toBe('[4,3]');

    const svd = ce
      .box(['SVD', ['List', ['List', 1e200, 0], ['List', 0, 2e200]]])
      .evaluate();
    expect(svd.operator).toBe('Tuple');
    const [U, S, V] = svd.ops!;
    expect(S.toString()).toBe('[[1e+200,0],[0,2e+200]]');
    // U and V are orthogonal: each column has norm 1, and the columns are
    // orthogonal.
    for (const Q of [U, V]) {
      const q = Q.ops!.map((row) => row.ops!.map((x) => x.re));
      expect(q[0][0] ** 2 + q[1][0] ** 2).toBeCloseTo(1, 14);
      expect(q[0][1] ** 2 + q[1][1] ** 2).toBeCloseTo(1, 14);
      expect(q[0][0] * q[0][1] + q[1][0] * q[1][1]).toBeCloseTo(0, 14);
    }
  });

  test('the spectral norm still answers', () => {
    expect(ce.box(['Norm', wide, 2]).N().toString()).toBe('1e+400');
  });

  test('a complex 3 × 3 matrix is unchanged', () => {
    const r = ce
      .box([
        'SingularValues',
        [
          'List',
          ['List', 1, 'ImaginaryUnit', 0],
          ['List', 0, 2, 0],
          ['List', 0, 0, 3],
        ],
      ])
      .N();
    const expected = powerIterationSingularValues([
      [
        [1, 0],
        [0, 1],
        [0, 0],
      ],
      [
        [0, 0],
        [2, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [0, 0],
        [3, 0],
      ],
    ]);
    expect(r.ops!.length).toBe(3);
    r.ops!.forEach((x, k) => expect(x.re).toBeCloseTo(expected[k], 12));
    expect(r.ops![1].re).toBeCloseTo(2.288245611270737, 14);
    expect(r.ops![2].re).toBeCloseTo(0.8740320488976421, 14);
  });
});
