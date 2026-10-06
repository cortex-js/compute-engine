import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import {
  pNormIsSafe,
  scaledPNorm,
  singularValues,
} from '../../src/compute-engine/numerics/linear-algebra';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
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

// An entry much smaller than the largest one underflows to 0 once the
// matrix is scaled so that its largest entry is about 1. The small singular
// values of such a matrix came back as 0. The numeric routes of
// `SingularValues` and `SVD` now decline a matrix whose nonzero entry
// magnitudes span more than 10^290; the spectral norm, which needs only the
// largest singular value, still answers.
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
    expect(S.toString()).toBe('[[2e+200,0],[0,1e+200]]');
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

// The double kernel of `SingularValues` and `SVD` formed the Gram matrix
// `AᵀA` (or `AAᵀ`), which squares the condition number, so a singular value
// below about ε·σ_max (ε ≈ 2.2e-16) came back as 0, also when the entries
// are well within the float64 range and determine it accurately. The kernel
// is now a one-sided Jacobi SVD with a QR preconditioner, which has a small
// relative error for such values. The expected values come from the exact
// closed form of the 2 × 2 Gram matrix (the same matrix with exact entries,
// under `N()`), or from the construction of the matrix.
describe('SMALL SINGULAR VALUES OF A MATRIX WITH GRADED ENTRIES', () => {
  const half = ['Rational', 1, 2];

  /** The singular values of an expression, as machine numbers. */
  const values = (expr: Expression) => {
    expect(expr.operator).toBe('List');
    return expr.ops!.map((x) => x.re);
  };

  /** The rows of a matrix expression, as machine numbers. */
  const rows = (expr: Expression) =>
    expr.ops!.map((row) => row.ops!.map((x) => x.re));

  const multiply = (a: number[][], b: number[][]) =>
    a.map((row) =>
      b[0].map((_, j) => row.reduce((s, x, k) => s + x * b[k][j], 0))
    );

  const transpose = (a: number[][]) => a[0].map((_, j) => a.map((r) => r[j]));

  /** `max |QᵀQ − I|` */
  const orthogonalityError = (q: number[][]) => {
    const g = multiply(transpose(q), q);
    return Math.max(
      ...g.flatMap((row, i) =>
        row.map((x, j) => Math.abs(x - (i === j ? 1 : 0)))
      )
    );
  };

  // Two rotations, so that the graded matrices below are dense.
  const rotation = (() => {
    const [c1, s1] = [Math.cos(0.3), Math.sin(0.3)];
    const [c2, s2] = [Math.cos(1.1), Math.sin(1.1)];
    return multiply(
      [
        [c1, -s1, 0],
        [s1, c1, 0],
        [0, 0, 1],
      ],
      [
        [1, 0, 0],
        [0, c2, -s2],
        [0, s2, c2],
      ]
    );
  })();
  const D = [
    [1e20, 0, 0],
    [0, 1, 0],
    [0, 0, 1e-5],
  ];
  const toList = (a: number[][]) => ['List', ...a.map((r) => ['List', ...r])];

  test('SingularValues of [[1e20, 0.5], [0.5, 2.5]]', () => {
    // Was [1e+20, 0]. The small value is |det| / σ_max ≈ 2.5 − 2.5e-21.
    const [s1, s2] = values(
      ce
        .box([
          'SingularValues',
          ['List', ['List', 1e20, 0.5], ['List', 0.5, 2.5]],
        ])
        .evaluate()
    );
    const [e1, e2] = values(
      ce
        .box([
          'SingularValues',
          ['List', ['List', P(20), half], ['List', half, ['Rational', 5, 2]]],
        ])
        .N()
    );
    expect(Math.abs(s1 / e1 - 1)).toBeLessThan(1e-15);
    expect(Math.abs(s2 / e2 - 1)).toBeLessThan(1e-15);
    expect(s2).toBeCloseTo(2.5, 14);
  });

  test('SingularValues of a 2 × 3 matrix with a large entry', () => {
    // Was [1e+20, 0].
    const [s1, s2] = values(
      ce
        .box([
          'SingularValues',
          ['List', ['List', 1e20, 0.5, 0], ['List', 0.5, 2.5, 1]],
        ])
        .evaluate()
    );
    const [e1, e2] = values(
      ce
        .box([
          'SingularValues',
          [
            'List',
            ['List', P(20), half, 0],
            ['List', half, ['Rational', 5, 2], 1],
          ],
        ])
        .N()
    );
    expect(Math.abs(s1 / e1 - 1)).toBeLessThan(1e-15);
    expect(Math.abs(s2 / e2 - 1)).toBeLessThan(1e-14);
  });

  test('SingularValues of a complex matrix with a large entry', () => {
    // A complex matrix goes to the complex kernel. Was [1e+20, 0].
    const [s1, s2] = values(
      ce
        .box([
          'SingularValues',
          ['List', ['List', 1e20, ['Complex', 0, 0.5]], ['List', 0.5, 2.5]],
        ])
        .evaluate()
    );
    const [e1, e2] = values(
      ce
        .box([
          'SingularValues',
          [
            'List',
            ['List', P(20), ['Multiply', half, 'ImaginaryUnit']],
            ['List', half, ['Rational', 5, 2]],
          ],
        ])
        .N()
    );
    expect(Math.abs(s1 / e1 - 1)).toBeLessThan(1e-15);
    expect(Math.abs(s2 / e2 - 1)).toBeLessThan(1e-14);
  });

  for (const [name, A] of [
    ['Q · diag(1e20, 1, 1e-5)', multiply(rotation, D)],
    ['diag(1e20, 1, 1e-5) · Q', multiply(D, rotation)],
  ] as const) {
    test(`SingularValues of ${name}, Q a rotation`, () => {
      // Was [1e+20, 0, 0].
      const s = values(ce.box(['SingularValues', toList(A)]).evaluate());
      [1e20, 1, 1e-5].forEach((e, k) =>
        expect(Math.abs(s[k] / e - 1)).toBeLessThan(1e-12)
      );
    });
  }

  test('SVD of [[1e20, 0.5], [0.5, 2.5]]', () => {
    // Was S = [[1e+20, 0], [0, 0]].
    const A = [
      [1e20, 0.5],
      [0.5, 2.5],
    ];
    const svd = ce.box(['SVD', toList(A)]).evaluate();
    expect(svd.operator).toBe('Tuple');
    const [U, S, V] = svd.ops!.map(rows);
    expect(S[0][0]).toBe(1e20);
    expect(S[1][1]).toBeCloseTo(2.5, 14);
    expect(orthogonalityError(U)).toBeLessThan(1e-15);
    expect(orthogonalityError(V)).toBeLessThan(1e-15);
    // U Σ Vᵀ = A, entry by entry, to a relative error of the entry.
    const B = multiply(multiply(U, S), transpose(V));
    A.forEach((row, i) =>
      row.forEach((x, j) =>
        expect(Math.abs(B[i][j] - x)).toBeLessThan(1e-15 * Math.abs(x))
      )
    );
  });

  test('SVD of a graded 3 × 3 matrix', () => {
    const A = multiply(D, rotation);
    const svd = ce.box(['SVD', toList(A)]).evaluate();
    expect(svd.operator).toBe('Tuple');
    const [U, S, V] = svd.ops!.map(rows);
    [1e20, 1, 1e-5].forEach((e, k) =>
      expect(Math.abs(S[k][k] / e - 1)).toBeLessThan(1e-12)
    );
    expect(orthogonalityError(U)).toBeLessThan(1e-14);
    expect(orthogonalityError(V)).toBeLessThan(1e-14);
    // Each row of U Σ Vᵀ matches the row of A to a relative error of the
    // row: the rows have magnitudes 1e20, 1 and 1e-5.
    const B = multiply(multiply(U, S), transpose(V));
    A.forEach((row, i) => {
      const scale = Math.max(...row.map(Math.abs));
      row.forEach((x, j) =>
        expect(Math.abs(B[i][j] - x)).toBeLessThan(1e-14 * scale)
      );
    });
  });

  test('SingularValues with an entry range of 10^285 answers', () => {
    // Was declined (unevaluated) for a range above 10^150, because the Gram
    // matrix squared the range. det = 1e115 − 6e-160 ≈ 1e115 and
    // σ₁ ≈ 1e200, so σ₂ = det / σ₁ ≈ 1e-85.
    const s = values(
      ce
        .box([
          'SingularValues',
          ['List', ['List', 1e200, 3e-80], ['List', 2e-80, 1e-85]],
        ])
        .evaluate()
    );
    expect(Math.abs(s[0] / 1e200 - 1)).toBeLessThan(1e-15);
    expect(Math.abs(s[1] / 1e-85 - 1)).toBeLessThan(1e-14);
  });
});

describe('MATRIX FUNCTIONS NEAR THE LIMITS OF MACHINE NUMBERS', () => {
  // Constructing an engine, and setting its precision, set the global
  // big-decimal precision, which the shared engine `ce` also reads. The tests
  // that make a machine engine restore it.
  test('the spectral norm of machine entries whose products underflow', () => {
    const savedPrecision = BigDecimal.precision;
    try {
      spectralNormAtMachinePrecision();
    } finally {
      BigDecimal.precision = savedPrecision;
    }
  });

  function spectralNormAtMachinePrecision() {
    // The products of the entries are below the smallest float64. The
    // matrix does not have rank 1: its norm is 2s, not 0.
    const me = new ComputeEngine();
    me.precision = 'machine';
    const s = 1e-200;
    const norm = (rows: number[][]) =>
      me
        .box(['Norm', ['List', ...rows.map((r) => ['List', ...r])], 2])
        .evaluate().re;
    expect(
      norm([
        [s, s, 0],
        [0, s, s],
        [s, 0, s],
      ]) / 2e-200
    ).toBeCloseTo(1, 14);
    // A matrix with rank 1: its squared entries underflow or overflow.
    expect(
      norm([
        [s, 0],
        [s, 0],
      ]) /
        (Math.SQRT2 * s)
    ).toBeCloseTo(1, 14);
    expect(
      norm([
        [1e200, 0],
        [1e200, 0],
      ]) /
        (Math.SQRT2 * 1e200)
    ).toBeCloseTo(1, 14);
  }

  test('the 1-norm keeps a line whose machine value underflows', () => {
    // r = 10^300 / (10^309 + 1) ≈ 10^-9. The machine values of its
    // numerator and denominator overflow, so its machine value is 0.
    const r = ['Divide', P(300), ['Add', P(309), 1]];
    const norm = ce
      .box([
        'Norm',
        ['List', ['List', r, 0], ['List', 0, ['Divide', 1, P(10)]]],
        1,
      ])
      .evaluate();
    expect(norm.isSame(ce.box(r).evaluate())).toBe(true);
  });

  test('the SVD kernel scales an entry near Number.MAX_VALUE', () => {
    const M = Number.MAX_VALUE;
    expect(singularValues([[M]], [[0]])).toEqual([M]);
    const s = singularValues(
      [
        [M, 1],
        [0, M / 2],
      ],
      [
        [0, 0],
        [0, 0],
      ]
    );
    expect(s[0] / M).toBeCloseTo(1, 14);
    expect(s[1] / (M / 2)).toBeCloseTo(1, 14);
  });

  test('SingularValues at machine precision does not overflow in the closed form', () => {
    // The singular values of [[a, 1], [0, a]] are a ± 1/2 + O(1/a).
    const savedPrecision = BigDecimal.precision;
    try {
      const me = new ComputeEngine();
      me.precision = 'machine';
      const sv = me
        .box([
          'SingularValues',
          ['List', ['List', 1e200, 1], ['List', 0, 1e200]],
        ])
        .N();
      expect(sv.ops!.map((x) => x.re / 1e200)).toEqual([
        expect.closeTo(1, 14),
        expect.closeTo(1, 14),
      ]);
    } finally {
      BigDecimal.precision = savedPrecision;
    }
  });

  test('Eigenvalues of a triangular-looking matrix with a tiny exact entry', () => {
    // [[0, 10^-400], [1, 0]] is not triangular: its eigenvalues are
    // ±10^-200.
    const ev = ce
      .box(['Eigenvalues', ['List', ['List', 0, P(-400)], ['List', 1, 0]]])
      .evaluate();
    expect(ev.ops!.map((x) => x.toString()).sort()).toEqual(
      ['-1/1e+200', '1/1e+200'].sort()
    );
  });

  test('Eigenvectors of a complex matrix with small exact entries', () => {
    // A scaled matrix has the eigenvectors of the unscaled one.
    const e = ['Divide', 'ImaginaryUnit', P(12)];
    const m = ['List', ['List', 0, e], ['List', ['Negate', e], 0]];
    const values = ce.box(['Eigenvalues', m]).evaluate();
    const vectors = ce.box(['Eigenvectors', m]).evaluate();
    expect(vectors.nops).toBe(2);
    vectors.ops!.forEach((v, k) => {
      // v is not zero, and M·v − λ·v is zero.
      expect(v.ops!.some((x) => !x.isSame(0))).toBe(true);
      const residual = ce
        .box([
          'Subtract',
          ['MatrixMultiply', m, v.json],
          ['Multiply', values.ops![k].json, v.json],
        ])
        .evaluate();
      expect(residual.ops!.every((x) => x.isSame(0))).toBe(true);
    });
  });

  test('a complex big decimal outside the float64 range packs exactly', () => {
    for (const re of ['1e400', '1e-400']) {
      const z = ce.number(ce._numericValue({ re: new BigDecimal(re), im: 1 }));
      const t = ce
        .function('Transpose', [
          ce.function('List', [ce.function('List', [z])]),
        ])
        .evaluate();
      expect(t.ops![0].ops![0].isSame(z)).toBe(true);
    }
  });

  test('Norm of a lazy collection that declines to enumerate', () => {
    // `Linspace(a, 1, 3)` has 3 elements, but no values while `a` has none.
    expect(
      ce
        .box(['Norm', ['Linspace', 'a', 1, 3]])
        .evaluate()
        .toString()
    ).toBe('||Linspace(a, 1, 3)||');
  });
});

describe('EIGENVECTORS OF A REPEATED EIGENVALUE', () => {
  const mat = (rows: any[][]) => ['List', ...rows.map((r) => ['List', ...r])];
  const vectors = (rows: any[][]) =>
    ce
      .box(['Eigenvectors', mat(rows)])
      .evaluate()
      .toString();

  test('a basis of the eigenspace on the exact, float and symbolic routes', () => {
    expect(
      vectors([
        [2, 0],
        [0, 2],
      ])
    ).toBe('[[1,0],[0,1]]');
    expect(
      vectors([
        [2.5, 0],
        [0, 2.5],
      ])
    ).toBe('[[1,0],[0,1]]');
    expect(
      vectors([
        ['ImaginaryUnit', 0],
        [0, 'ImaginaryUnit'],
      ])
    ).toBe('[[1,0],[0,1]]');
    expect(
      vectors([
        ['x', 0],
        [0, 'x'],
      ])
    ).toBe('[[1,0],[0,1]]');
    expect(
      vectors([
        [2, 0, 0],
        [0, 2, 0],
        [0, 0, 2],
      ])
    ).toBe('[[1,0,0],[0,1,0],[0,0,1]]');
    // The eigenvalue 2 has the eigenspace x + y + z = 0.
    expect(
      vectors([
        [3, 1, 1],
        [1, 3, 1],
        [1, 1, 3],
      ])
    ).toBe('[[1,1,1],[-1,1,0],[-1,0,1]]');
    const v = ce
      .box([
        'Eigenvectors',
        mat([
          [3.5, 1, 1],
          [1, 3.5, 1],
          [1, 1, 3.5],
        ]),
      ])
      .evaluate();
    expect(v.ops![2].ops!.map((x) => x.re)).toEqual([
      expect.closeTo(-Math.SQRT1_2, 14),
      0,
      expect.closeTo(Math.SQRT1_2, 14),
    ]);
  });

  test('a defective matrix repeats its one eigenvector', () => {
    expect(
      vectors([
        [2, 1],
        [0, 2],
      ])
    ).toBe('[[1,0],[1,0]]');
    expect(
      vectors([
        [2.5, 1],
        [0, 2.5],
      ])
    ).toBe('[[1,0],[1,0]]');
    expect(
      vectors([
        ['ImaginaryUnit', 1],
        [0, 'ImaginaryUnit'],
      ])
    ).toBe('[[1,0],[1,0]]');
    // Geometric multiplicity 2 for an eigenvalue of multiplicity 3.
    expect(
      vectors([
        [2, 1, 0],
        [0, 2, 0],
        [0, 0, 2],
      ])
    ).toBe('[[1,0,0],[0,0,1],[1,0,0]]');
  });

  test('distinct eigenvalues of a diagonal matrix keep their vectors', () => {
    // 10^-12 is not 0, so λ = 0 is the second diagonal entry only.
    expect(
      vectors([
        [['Power', 10, -12], 0],
        [0, 0],
      ])
    ).toBe('[[1,0],[0,1]]');
    expect(
      vectors([
        [0, 0],
        [0, ['Power', 10, -12]],
      ])
    ).toBe('[[1,0],[0,1]]');
    expect(
      vectors([
        ['x', 0],
        [0, 'y'],
      ])
    ).toBe('[[1,0],[0,1]]');
  });
});

describe('EUCLIDEAN NORMS OF VERY SMALL AND VERY LARGE MACHINE NUMBERS', () => {
  // At machine precision, `Norm` and `Hypot` add the squares (or the p-th
  // powers) of the components in machine floats. When the largest magnitude
  // is very small or very large, a square is below the normal doubles or
  // overflows, so the components are scaled by a power of 2 first. In the
  // normal range the plain formula is kept, bit for bit.
  //
  // Constructing an engine, and setting its precision, set the global
  // big-decimal precision, which the shared engine `ce` also reads, so it is
  // restored after these tests.
  let me: ComputeEngine;
  let savedPrecision: number;
  beforeAll(() => {
    savedPrecision = BigDecimal.precision;
    me = new ComputeEngine();
    me.precision = 'machine';
    me.declare('v', 'list<real>');
    me.declare('a', 'real');
    me.declare('b', 'real');
  });
  afterAll(() => {
    BigDecimal.precision = savedPrecision;
  });

  const value = (expr: unknown) => me.box(expr as any).evaluate().re;
  const valueN = (expr: unknown) => me.box(expr as any).N().re;
  const compiled = (expr: unknown) => {
    const result = compile(me.box(expr as any));
    expect(result?.success).toBe(true);
    return result!.run!({}) as number;
  };
  // The relative difference of `x` from `expected`.
  const relErr = (x: number, expected: number) =>
    Math.abs(x - expected) / expected;

  const cases: [string, unknown, number][] = [
    ['Norm of a tiny vector', ['Norm', ['List', 3e-200, 4e-200]], 5e-200],
    ['Hypot of tiny legs', ['Hypot', 3e-200, 4e-200], 5e-200],
    [
      'Norm of a tiny complex entry',
      ['Norm', ['List', ['Complex', 3e-200, 4e-200]]],
      5e-200,
    ],
    ['Norm of a huge vector', ['Norm', ['List', 3e200, 4e200]], 5e200],
    ['Hypot of huge legs', ['Hypot', 3e200, 4e200], 5e200],
    ['Norm of a huge point', ['Norm', ['Tuple', 3e200, 4e200]], 5e200],
    [
      'Norm of a huge complex entry',
      ['Norm', ['List', ['Complex', 3e200, 4e200]]],
      5e200,
    ],
    [
      'Frobenius norm of a huge matrix',
      ['Norm', ['List', ['List', 3e200, 4e200], ['List', 0, 0]]],
      5e200,
    ],
    [
      'Frobenius norm of a tiny matrix',
      ['Norm', ['List', ['List', 3e-200, 0], ['List', 0, 4e-200]]],
      5e-200,
    ],
    [
      'Frobenius norm of a huge rank-3 tensor',
      [
        'Norm',
        [
          'List',
          ['List', ['List', 3e200, 0], ['List', 0, 0]],
          ['List', ['List', 0, 0], ['List', 0, 4e200]],
        ],
      ],
      5e200,
    ],
    [
      'Norm of order 3 of a huge vector',
      ['Norm', ['List', 1e150, 1e150], 3],
      Math.cbrt(2) * 1e150,
    ],
    [
      'Norm of order 3 of a tiny vector',
      ['Norm', ['List', 1e-150, 1e-150], 3],
      Math.cbrt(2) * 1e-150,
    ],
    [
      'Norm of order 2.5 of a huge vector',
      ['Norm', ['List', 1e200, 1e200], 2.5],
      Math.pow(2, 1 / 2.5) * 1e200,
    ],
    [
      'Norm of a vector with a subnormal component',
      ['Norm', ['List', 1e-320, 0]],
      1e-320,
    ],
    [
      'Norm of a vector near the largest double',
      ['Norm', ['List', 1e308, 1e308]],
      Math.SQRT2 * 1e308,
    ],
  ];

  test.each(cases)(
    '%s: evaluate(), N() and the compiled code',
    (_, expr, expected) => {
      for (const x of [value(expr), valueN(expr), compiled(expr)])
        expect(relErr(x, expected)).toBeLessThan(4e-16);
    }
  );

  test('the compiled Distance of points with very small or very large coordinates', () => {
    me.declare('p', 'tuple<real, real>');
    me.declare('q', 'tuple<real, real>');
    const f = compile(me.box(['Distance', 'p', 'q']));
    expect(f?.success).toBe(true);
    const run = (p: number[], q: number[]) => f!.run!({ p, q }) as number;
    expect(relErr(run([3e200, 4e200], [0, 0]), 5e200)).toBeLessThan(4e-16);
    expect(relErr(run([3e-200, 4e-200], [0, 0]), 5e-200)).toBeLessThan(4e-16);
    // The normal range keeps the plain formula.
    expect(run([0.1, 0.2], [0.3, 0.7])).toBe(
      Math.sqrt((0.1 - 0.3) ** 2 + (0.2 - 0.7) ** 2)
    );
  });

  test('a subnormal result keeps its value', () => {
    // 1e-320 is a subnormal double: the result is exact, as the scaling by a
    // power of 2 is.
    expect(value(['Norm', ['List', 1e-320, 0]])).toBe(1e-320);
    expect(value(['Hypot', 5e-324, 0])).toBe(5e-324);
  });

  test('N() of exact components outside the range does not overflow', () => {
    const big = ['Power', 10, 300];
    expect(
      relErr(valueN(['Norm', ['List', big, big]]), Math.SQRT2 * 1e300)
    ).toBeLessThan(4e-16);
    expect(
      relErr(valueN(['Hypot', big, big]), Math.SQRT2 * 1e300)
    ).toBeLessThan(4e-16);
    // An exact rational beside a float.
    expect(
      relErr(
        value(['Norm', ['List', ['Rational', 3, ['Power', 10, 200]], 4e-200]]),
        5e-200
      )
    ).toBeLessThan(4e-16);
  });

  test('exact components stay exact under evaluate()', () => {
    const big = ['Power', 10, 300];
    const norm = me.box(['Norm', ['List', big, big]]).evaluate();
    expect(norm.operator).toBe('Sqrt');
    expect(me.box(['Hypot', big, big]).evaluate().operator).toBe('Sqrt');
  });

  test('zero, NaN and infinite components behave as before', () => {
    expect(value(['Norm', ['List', 0, 0]])).toBe(0);
    expect(value(['Norm', ['List', 0.0, -0.0]])).toBe(0);
    expect(value(['Norm', ['List', 1e-300, 'NaN']])).toBeNaN();
    expect(value(['Hypot', 1e-300, 'NaN'])).toBeNaN();
    expect(value(['Norm', ['List', 1e-300, 'PositiveInfinity']])).toBe(
      Infinity
    );
    expect(value(['Hypot', 1e300, 'NegativeInfinity'])).toBe(Infinity);
    expect(compiled(['Norm', ['List', 1e-300, 'NaN']])).toBeNaN();
    expect(compiled(['Norm', ['List', 1e300, 'PositiveInfinity']])).toBe(
      Infinity
    );
  });

  test('the scaled kernel matches the plain formula on the scaled values', () => {
    // Out of the safe range, the result is the plain formula on the values
    // multiplied by 2^-e, then multiplied by 2^e: both multiplications are
    // exact.
    const v = [3e-200, 4e-200, 1e-201];
    const e = Math.floor(Math.log2(4e-200)) + 1;
    const plain = Math.sqrt(
      v.map((x) => x * 2 ** -e).reduce((s, x) => s + x * x, 0)
    );
    expect(scaledPNorm(v, 2)).toBe(plain * 2 ** e);
    // In the safe range, there is no scaled result.
    expect(scaledPNorm([3, 4], 2)).toBeUndefined();
    expect(scaledPNorm([2 ** -500, 0], 2)).toBeUndefined();
    expect(scaledPNorm([2 ** 500, 0], 2)).toBeUndefined();
    expect(scaledPNorm([0, 0], 2)).toBeUndefined();
    expect(scaledPNorm([1e-300, NaN], 2)).toBeUndefined();
    // For p ≤ 1 the plain formula is always safe.
    expect(scaledPNorm([1e300, 1e300], 1)).toBeUndefined();
    // A large order: the largest term is made exactly 1.
    expect(
      relErr(scaledPNorm([1.5, 1.5], 2000)!, 1.5 * 2 ** (1 / 2000))
    ).toBeLessThan(4e-16);
    expect(pNormIsSafe(2 ** 333, 3)).toBe(true);
    expect(pNormIsSafe(2 ** 334, 3)).toBe(false);
  });

  test('results in the normal range are bit-identical to the plain formula', () => {
    // A seeded generator, so that the vectors are the same at each run.
    let seed = 20261006;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const fNorm = compile(me.box(['Norm', 'v']));
    const fNorm3 = compile(me.box(['Norm', 'v', 3]));
    const fHypot = compile(me.box(['Hypot', 'a', 'b']));
    expect(fNorm?.success).toBe(true);
    expect(fNorm3?.success).toBe(true);
    expect(fHypot?.success).toBe(true);
    let checked = 0;
    for (let t = 0; t < 300; t++) {
      const n = 2 + Math.floor(random() * 6);
      // The largest magnitude is in [2^-480, 2^480], in the range where
      // the plain formula is kept for the order 2. Some components are
      // much smaller than the largest one.
      const v = Array.from(
        { length: n },
        () => (random() - 0.5) * 2 ** Math.floor(random() * 960 - 480)
      );
      // The plain formulas: the sum of the squares in order, then the
      // square root (or the cube root for the order 3).
      let sum2 = 0;
      for (const x of v) sum2 += x * x;
      const plain2 = Math.sqrt(sum2);
      expect(value(['Norm', ['List', ...v]])).toBe(plain2);
      expect(fNorm!.run!({ v })).toBe(plain2);
      expect(
        value(['Norm', ['List', ['List', ...v], ['List', ...v.map(() => 0)]]])
      ).toBe(plain2);

      const hypot = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
      expect(value(['Hypot', v[0], v[1]])).toBe(hypot);

      // The order 3 is safe while the largest magnitude is in
      // [2^-333, 2^333].
      const w = v.map((x) => x * 2 ** -150);
      if (
        Math.max(...w.map(Math.abs)) <= 2 ** 333 &&
        Math.max(...w.map(Math.abs)) >= 2 ** -333
      ) {
        let sum3 = 0;
        for (const x of w) sum3 += Math.pow(Math.abs(x), 3);
        expect(value(['Norm', ['List', ...w], 3])).toBe(Math.cbrt(sum3));
        expect(fNorm3!.run!({ v: w })).toBe(Math.pow(sum3, 1 / 3));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
