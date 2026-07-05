import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

// Phase 2 statistics: Covariance/PopulationCovariance/Correlation,
// LinearRegression/PolynomialFit, and the empirical `Quantile` overload.
//
// Numeric golden values were generated with the repo's numpy venv:
//   ./venv/bin/python3 -c "import numpy as np; \
//     x=[1.0,2.5,3.1,4.8,5.2,6.0]; y=[2.1,2.9,3.6,5.1,5.0,7.2]; \
//     print(np.cov(x,y)[0][1], np.cov(x,y,ddof=0)[0][1], np.corrcoef(x,y)[0][1])"

const ce = new ComputeEngine();
const L = (a: (number | any)[]) => ['List', ...a] as any;

// numpy sample data / goldens
const NX = [1.0, 2.5, 3.1, 4.8, 5.2, 6.0];
const NY = [2.1, 2.9, 3.6, 5.1, 5.0, 7.2];
const COV_SAMPLE = 3.3266666666666667;
const COV_POP = 2.772222222222222;
const CORR = 0.9606963498095882;

describe('Covariance / PopulationCovariance', () => {
  test('exact rational result on exact data (two-list form)', () => {
    // xs=[1,2,3,4], ys=[2,4,6,8]: sample cov = 10/3, pop cov = 5/2
    expect(
      ce.box(['Covariance', L([1, 2, 3, 4]), L([2, 4, 6, 8])]).evaluate().toString()
    ).toBe('10/3');
    expect(
      ce
        .box(['PopulationCovariance', L([1, 2, 3, 4]), L([2, 4, 6, 8])])
        .evaluate()
        .toString()
    ).toBe('5/2');
  });

  test('pairs form is identical to two-list form', () => {
    const pairs = ce
      .box([
        'Covariance',
        ['List', ['Pair', 1, 2], ['Pair', 2, 4], ['Pair', 3, 6], ['Pair', 4, 8]],
      ])
      .evaluate();
    expect(pairs.toString()).toBe('10/3');
    // Tuple pairs work too
    expect(
      ce
        .box([
          'Covariance',
          ['List', ['Tuple', 1, 2], ['Tuple', 2, 4], ['Tuple', 3, 6], ['Tuple', 4, 8]],
        ])
        .evaluate()
        .toString()
    ).toBe('10/3');
  });

  test('population identity PopCov = Mean(xy) − Mean(x)·Mean(y) on exact data', () => {
    const xs = [1, 3, 5, 7];
    const ys = [2, 2, 6, 10];
    const pc = ce.box(['PopulationCovariance', L(xs), L(ys)]).evaluate();
    const ident = ce
      .box([
        'Subtract',
        ['Mean', L(xs.map((x, i) => x * ys[i]))],
        ['Multiply', ['Mean', L(xs)], ['Mean', L(ys)]],
      ])
      .evaluate();
    expect(pc.toString()).toBe(ident.toString());
    expect(pc.toString()).toBe('7');
  });

  test('numeric path matches numpy goldens', () => {
    expect(ce.box(['Covariance', L(NX), L(NY)]).N().re).toBeCloseTo(COV_SAMPLE, 12);
    expect(ce.box(['PopulationCovariance', L(NX), L(NY)]).N().re).toBeCloseTo(
      COV_POP,
      12
    );
  });

  test('bignum path (50 digits)', () => {
    const hce = new ComputeEngine();
    hce.precision = 50;
    // 10/3 to 50 digits.
    expect(
      hce.box(['Covariance', L([1, 2, 3, 4]), L([2, 4, 6, 8])]).N().toString()
    ).toBe('3.3333333333333333333333333333333333333333333333333');
  });

  test('length mismatch and n < 2 produce error nodes', () => {
    expect(ce.box(['Covariance', L([1, 2, 3]), L([1, 2])]).evaluate().isValid).toBe(
      false
    );
    expect(ce.box(['Covariance', L([1]), L([1])]).evaluate().isValid).toBe(false);
    expect(
      ce.box(['PopulationCovariance', L([1, 2]), L([1])]).evaluate().isValid
    ).toBe(false);
  });
});

describe('Correlation', () => {
  test('Correlation(xs, xs) = 1 exactly', () => {
    expect(
      ce.box(['Correlation', L([1, 2, 3, 5]), L([1, 2, 3, 5])]).evaluate().toString()
    ).toBe('1');
  });

  test('exact result on perfectly linear data', () => {
    expect(
      ce.box(['Correlation', L([1, 2, 3, 4]), L([2, 4, 6, 8])]).evaluate().toString()
    ).toBe('1');
  });

  test('pairs form equals two-list form', () => {
    const a = ce.box(['Correlation', L(NX), L(NY)]).N().re;
    const pairsExpr = [
      'List',
      ...NX.map((x, i) => ['Tuple', x, NY[i]]),
    ] as any;
    const b = ce.box(['Correlation', pairsExpr]).N().re;
    expect(a).toBeCloseTo(b, 14);
  });

  test('numeric path matches numpy golden', () => {
    expect(ce.box(['Correlation', L(NX), L(NY)]).N().re).toBeCloseTo(CORR, 12);
  });

  test('zero variance produces an error node', () => {
    expect(
      ce.box(['Correlation', L([1, 1, 1]), L([1, 2, 3])]).evaluate().isValid
    ).toBe(false);
    expect(
      ce.box(['Correlation', L([1.0, 1.0, 1.0]), L([1.0, 2.0, 3.0])]).N().isValid
    ).toBe(false);
  });
});

describe('LinearRegression', () => {
  test('recovers exact coefficients from exactly-linear data', () => {
    // points on 1/3 + 2x
    const r = ce
      .box([
        'LinearRegression',
        L([0, 1, 2, 3]),
        ['List', ['Rational', 1, 3], ['Rational', 7, 3], ['Rational', 13, 3], ['Rational', 19, 3]],
      ])
      .evaluate();
    expect(r.toString()).toBe('(1/3, 2)');
  });

  test('equals degree-1 PolynomialFit', () => {
    const lin = ce
      .box(['LinearRegression', L([0, 1, 2, 3]), L([1, 3, 5, 7])])
      .evaluate();
    const poly = ce
      .box(['PolynomialFit', L([0, 1, 2, 3]), L([1, 3, 5, 7]), 1])
      .evaluate();
    // LinearRegression → Tuple(b0, b1); PolynomialFit → List(c0, c1)
    expect(lin.ops!.map((x) => x.toString())).toEqual(
      poly.ops!.map((x) => x.toString())
    );
  });

  test('trailing-variable form returns the fitted expression; subs reproduces exact y', () => {
    const expr = ce
      .box([
        'LinearRegression',
        L([0, 1, 2, 3]),
        ['List', ['Rational', 1, 3], ['Rational', 7, 3], ['Rational', 13, 3], ['Rational', 19, 3]],
        'x',
      ])
      .evaluate();
    // at x=2 → 1/3 + 2·2 = 13/3
    expect(expr.subs({ x: 2 }).evaluate().toString()).toBe('13/3');
  });

  test('numeric fit matches numpy polyfit golden', () => {
    // np.polyfit(NX, NY, 1)[::-1] = [0.799513473053891, 0.93375748502994]
    const r = ce.box(['LinearRegression', L(NX), L(NY)]).N();
    expect(r.op1.re).toBeCloseTo(0.799513473053891, 10);
    expect(r.op2.re).toBeCloseTo(0.93375748502994, 10);
  });

  test('pairs form supported', () => {
    const pairs = ['List', ...[0, 1, 2, 3].map((x) => ['Tuple', x, 1 + 2 * x])] as any;
    expect(ce.box(['LinearRegression', pairs]).evaluate().toString()).toBe('(1, 2)');
  });

  test('degenerate data (constant xs) errors', () => {
    expect(
      ce.box(['LinearRegression', L([2, 2, 2]), L([1, 2, 3])]).evaluate().isValid
    ).toBe(false);
  });
});

describe('PolynomialFit', () => {
  test('recovers exact coefficients from exactly-quadratic data', () => {
    // y = x² − x/2 + 1 at x = -2..3
    const px = [-2, -1, 0, 1, 2, 3];
    const py = px.map((x) => ['Add', ['Square', x], ['Rational', -x, 2], 1]);
    const r = ce.box(['PolynomialFit', L(px), ['List', ...py], 2]).evaluate();
    // ascending: c0=1, c1=-1/2, c2=1
    expect(r.ops!.map((c) => c.toString())).toEqual(['1', '-1/2', '1']);
  });

  test('trailing-variable form returns the fitted expression', () => {
    const px = [-2, -1, 0, 1, 2, 3];
    const py = px.map((x) => ['Add', ['Square', x], ['Rational', -x, 2], 1]);
    const expr = ce.box(['PolynomialFit', L(px), ['List', ...py], 2, 'x']).evaluate();
    // reproduces exact y at a data point x=2 → 4 − 1 + 1 = 4
    expect(expr.subs({ x: 2 }).evaluate().toString()).toBe('4');
  });

  test('expression form omits zero-coefficient terms', () => {
    // Points on x² + 1: the linear coefficient is exactly 0 → `x^2 + 1`,
    // not `x^2 + 0x + 1`.
    const pts = [
      'List',
      ['Tuple', 0, 1],
      ['Tuple', 1, 2],
      ['Tuple', 2, 5],
      ['Tuple', 3, 10],
    ] as any;
    const expr = ce.box(['PolynomialFit', pts, 2, 'x']).evaluate();
    expect(expr.isSame(ce.box(['Add', ['Power', 'x', 2], 1]))).toBe(true);
    // All-zero data → the zero literal, not an empty Add.
    expect(
      ce
        .box(['PolynomialFit', L([1, 2, 3]), L([0, 0, 0]), 1, 'x'])
        .evaluate()
        .toString()
    ).toBe('0');
  });

  test('numeric fit matches numpy polyfit golden within 1e-10', () => {
    const px = [-2, -1, 0, 1, 2, 3, 4];
    const py = [3.9, 1.1, 0.2, 1.05, 4.2, 9.1, 16.3];
    const r = ce.box(['PolynomialFit', L(px), L(py), 2]).N();
    const got = r.ops!.map((c) => c.re);
    const want = [0.09285714285714286, 0.05238095238095148, 0.9952380952380958];
    for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i], 10);
  });

  test('degenerate / out-of-range inputs error cleanly', () => {
    // n ≤ deg
    expect(ce.box(['PolynomialFit', L([1, 2]), L([1, 2]), 2]).evaluate().isValid).toBe(
      false
    );
    // deg > 12
    expect(
      ce.box(['PolynomialFit', L([1, 2, 3]), L([1, 2, 3]), 13]).evaluate().isValid
    ).toBe(false);
    // constant xs (singular normal matrix)
    expect(
      ce.box(['PolynomialFit', L([2, 2, 2]), L([1, 2, 3]), 1]).evaluate().isValid
    ).toBe(false);
  });
});

describe('empirical Quantile', () => {
  test('agrees with Quartiles and Median (odd-length data)', () => {
    const xs = L([1, 2, 3, 4, 5]);
    const [q1, q2, q3] = ce
      .box(['Quartiles', xs])
      .evaluate()
      .ops!.map((x) => x.toString());
    expect(ce.box(['Quantile', xs, ['Rational', 1, 4]]).evaluate().toString()).toBe(q1);
    expect(ce.box(['Quantile', xs, ['Rational', 1, 2]]).evaluate().toString()).toBe(q2);
    expect(ce.box(['Quantile', xs, ['Rational', 3, 4]]).evaluate().toString()).toBe(q3);
    expect(ce.box(['Quantile', xs, ['Rational', 1, 2]]).evaluate().toString()).toBe(
      ce.box(['Median', xs]).evaluate().toString()
    );
  });

  test('agrees with Quartiles (even-length data)', () => {
    const xs = L([1, 2, 3, 4, 5, 6]);
    const [q1, q2, q3] = ce
      .box(['Quartiles', xs])
      .evaluate()
      .ops!.map((x) => x.toString());
    expect(ce.box(['Quantile', xs, ['Rational', 1, 4]]).evaluate().toString()).toBe(q1);
    expect(ce.box(['Quantile', xs, ['Rational', 1, 2]]).evaluate().toString()).toBe(q2);
    expect(ce.box(['Quantile', xs, ['Rational', 3, 4]]).evaluate().toString()).toBe(q3);
  });

  test('p = 0 → min, p = 1 → max', () => {
    const xs = L([3, 1, 4, 1, 5, 9, 2, 6]);
    expect(ce.box(['Quantile', xs, 0]).evaluate().toString()).toBe('1');
    expect(ce.box(['Quantile', xs, 1]).evaluate().toString()).toBe('9');
  });

  test('exact rational p between anchors yields an exact result', () => {
    // n = 8: rank(Q1) = 2.5, rank(median) = 4.5; p = 3/8 maps to rank 3.5
    // → (x₃ + x₄)/2 = 7/2
    expect(
      ce
        .box(['Quantile', L([1, 2, 3, 4, 5, 6, 7, 8]), ['Rational', 3, 8]])
        .evaluate()
        .toString()
    ).toBe('7/2');
  });

  test('large-n percentile uses order statistics, not the Q3-max chord', () => {
    // xs = 1..99 plus a big outlier at 1000. The 90th percentile must land in
    // the rank-90 region (≈ 90–91); interpolating the anchor VALUES instead
    // would put it on the Q3–max chord (≈ 75.5 → 1000, i.e. well above 100).
    const big = [...Array.from({ length: 99 }, (_, i) => i + 1), 1000];
    const q90 = ce.box(['Quantile', L(big), 0.9]).N().re;
    expect(q90).toBeGreaterThan(89);
    expect(q90).toBeLessThan(92);

    // Monotonicity in p.
    const q80 = ce.box(['Quantile', L(big), 0.8]).N().re;
    const q95 = ce.box(['Quantile', L(big), 0.95]).N().re;
    expect(q80).toBeLessThanOrEqual(q90);
    expect(q90).toBeLessThanOrEqual(q95);
  });

  test('distribution branch still works (Poisson regression check)', () => {
    expect(ce.box(['Quantile', ['PoissonDistribution', 9], 0.95]).N().re).toBe(14);
  });
});

describe('LaTeX round-trip', () => {
  const heads = [
    'Covariance',
    'PopulationCovariance',
    'Correlation',
    'LinearRegression',
    'PolynomialFit',
  ];
  for (const h of heads) {
    test(`round-trips ${h}`, () => {
      const e = ce.box([h, ce.symbol('a'), ce.symbol('b')]);
      expect(e.latex).toContain(`\\operatorname{${h}}`);
      expect(ce.parse(e.latex).operator).toBe(h);
    });
  }

  test('cov/corr parse aliases', () => {
    expect(ce.parse('\\operatorname{cov}(a, b)').operator).toBe('Covariance');
    expect(ce.parse('\\operatorname{corr}(a, b)').operator).toBe('Correlation');
  });
});

describe('compilation', () => {
  test('JS compile of Covariance/Correlation matches .N()', () => {
    const cov = compile(ce.box(['Covariance', L(NX), L(NY)]));
    expect(cov?.success).toBe(true);
    expect(cov?.run?.({})).toBeCloseTo(
      ce.box(['Covariance', L(NX), L(NY)]).N().re,
      10
    );
    const corr = compile(ce.box(['Correlation', L(NX), L(NY)]));
    expect(corr?.run?.({})).toBeCloseTo(
      ce.box(['Correlation', L(NX), L(NY)]).N().re,
      10
    );
  });

  test('Python codegen for cov/corr', () => {
    const py = new PythonTarget();
    expect(
      py.compile(ce.box(['Covariance', ce.symbol('a'), ce.symbol('b')])).code
    ).toBe('np.cov(a, b)[0][1]');
    expect(
      py.compile(ce.box(['PopulationCovariance', ce.symbol('a'), ce.symbol('b')])).code
    ).toBe('np.cov(a, b, ddof=0)[0][1]');
    expect(
      py.compile(ce.box(['Correlation', ce.symbol('a'), ce.symbol('b')])).code
    ).toBe('np.corrcoef(a, b)[0][1]');
  });
});
