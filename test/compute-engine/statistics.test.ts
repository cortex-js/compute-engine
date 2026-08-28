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

  test('mismatched lengths report incompatible-dimensions, like every broadcast path', () => {
    // Harmonized 2026-07-27 (`docs/BROADCAST-MODEL.md` audit): was
    // `unexpected-argument: "... collections differ in length"`.
    expect(
      ce.box(['Covariance', L([1, 2, 3]), L([2, 4])]).evaluate().toString()
    ).toMatch(/incompatible-dimensions.*3 vs 2/);
    expect(
      ce.box(['Correlation', L([1, 2, 3]), L([2, 4])]).evaluate().toString()
    ).toMatch(/incompatible-dimensions.*3 vs 2/);
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

// The bivariate kernels project every datum onto its real part (`machineVals`
// reads `.re`, `bigVals` reads `.bignumRe`), so complex data would answer the
// question for different data with no diagnostic: under that projection
// `Covariance([1, 1+2i], [2, 3])` is the covariance of `[1, 1]`, namely `0`.
// Complex data must therefore produce a clear error, and data that has no real
// value at all — `NaN`, `±∞`, `~oo` — must propagate `NaN` rather than be
// reported as a variance of zero.
describe('Bivariate statistics reject non-real data', () => {
  const I = ['Complex', 1, 2] as any; // 1 + 2i
  // The error carries the `incompatible-type` code with the `real` constraint
  // and the offending datum, so it is distinguishable from the shape, length
  // and zero-variance rejections that share this file.
  const NON_REAL = /incompatible-type.*real.*complex/;

  test('complex datum errors — two-collection form', () => {
    for (const op of ['Covariance', 'PopulationCovariance', 'Correlation']) {
      const r = ce.box([op, L([1, I]), L([2, 3])]).evaluate();
      expect(r.isValid).toBe(false);
      expect(r.toString()).toMatch(NON_REAL);
    }
  });

  test('complex datum errors — collection-of-pairs form', () => {
    for (const op of ['Covariance', 'PopulationCovariance', 'Correlation']) {
      const r = ce
        .box([op, ['List', ['Tuple', 1, 2], ['Tuple', I, 3]]] as any)
        .evaluate();
      expect(r.isValid).toBe(false);
      expect(r.toString()).toMatch(NON_REAL);
    }
  });

  test('complex datum errors under .N() too, not just evaluate()', () => {
    const r = ce.box(['Covariance', L([1, I]), L([2, 3])]).N();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toMatch(NON_REAL);
  });

  test('a complex literal with zero imaginary part is real data', () => {
    // `Complex(2, 0)` canonicalizes to the real `2`, so it must not trip the
    // gate — and must stay on the EXACT path.
    expect(
      ce
        .box(['Covariance', L([1, ['Complex', 2, 0], 5]), L([2, 3, 9])])
        .evaluate()
        .toString()
    ).toBe('47/6');
  });

  test('the regression siblings share the kernels and reject complex data too', () => {
    const lr = ce
      .box(['LinearRegression', L([1, I, 5]), L([2, 3, 9])])
      .evaluate();
    expect(lr.isValid).toBe(false);
    expect(lr.toString()).toMatch(NON_REAL);
    const pf = ce
      .box(['PolynomialFit', L([1, I, 5, 7]), L([2, 3, 9, 11]), 2])
      .evaluate();
    expect(pf.isValid).toBe(false);
    expect(pf.toString()).toMatch(NON_REAL);
  });

  test('Correlation propagates NaN data, like Covariance', () => {
    expect(
      ce.box(['Correlation', L([1, 'NaN', 3]), L([2, 3, 7])]).evaluate().isNaN
    ).toBe(true);
    expect(
      ce.box(['Correlation', L([1, 'NaN', 3]), L([2, 3, 7])]).N().isNaN
    ).toBe(true);
    // The behavior it now matches.
    expect(
      ce.box(['Covariance', L([1, 'NaN']), L([2, 3])]).evaluate().isNaN
    ).toBe(true);
  });

  test('±∞ data propagates NaN, and is not diagnosed as a zero variance', () => {
    const inf = { num: '+Infinity' } as any;
    expect(
      ce.box(['Covariance', L([1, inf]), L([2, 3])]).evaluate().isNaN
    ).toBe(true);
    expect(
      ce.box(['Correlation', L([1, inf, 3]), L([2, 3, 7])]).evaluate().isNaN
    ).toBe(true);
  });

  test('the complex infinity ~oo propagates NaN, like ±∞', () => {
    // `~oo` is not a complex datum to reject: it has no real part to misuse.
    // Its `.re` is an artifact of how it was written — `ComplexInfinity`
    // reports `Infinity`, `Complex(1, Infinity)` reports `1` — so both spellings
    // must reach the same `NaN`, not a fit of the data `[1, 1]`.
    for (const oo of [
      'ComplexInfinity',
      ['Complex', 1, { num: '+Infinity' }],
    ]) {
      expect(
        ce.box(['Covariance', L([1, oo]), L([2, 3])]).evaluate().isNaN
      ).toBe(true);
      expect(
        ce.box(['Correlation', L([1, oo, 3]), L([2, 3, 7])]).evaluate().isNaN
      ).toBe(true);
      // The fits read the same real part, so they must not answer with the
      // fit of the projected data `[1, 1, 5]` either.
      const fit = ce
        .box(['LinearRegression', L([1, oo, 5]), L([2, 3, 9])])
        .evaluate();
      expect(fit.toString()).not.toBe(
        ce
          .box(['LinearRegression', L([1, 1, 5]), L([2, 3, 9])])
          .evaluate()
          .toString()
      );
    }
  });

  test('a non-real datum that is not a number literal names the real constraint', () => {
    // `Sqrt(-2)` is a function expression, so it is rejected before the data
    // is read. Blaming the shape of the collections would be a false
    // diagnosis: the collections are shaped correctly.
    const r = ce
      .box(['Covariance', L([1, ['Sqrt', -2]]), L([2, 3])])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toMatch(NON_REAL);
    const lr = ce
      .box(['LinearRegression', L([1, ['Sqrt', -2], 5]), L([2, 3, 9])])
      .evaluate();
    expect(lr.isValid).toBe(false);
    expect(lr.toString()).toMatch(NON_REAL);
  });

  test('an element that is not data at all still reports the shape', () => {
    const r = ce
      .box(['Covariance', L([1, { str: 'a' }]), L([2, 3])] as any)
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toMatch(/expects two equal-length collections/);
  });

  test('genuinely constant real data still reports zero variance', () => {
    for (const r of [
      ce.box(['Correlation', L([2, 2, 2]), L([1, 5, 9])]).evaluate(),
      ce.box(['Correlation', L([2.0, 2.0, 2.0]), L([1.0, 5.0, 9.0])]).N(),
    ]) {
      expect(r.isValid).toBe(false);
      expect(r.toString()).toMatch(/zero variance/);
    }
  });

  test('a kernel NaN from overflow is not reported as a zero variance', () => {
    // The machine kernel sums squares, which overflow to `Infinity` for data
    // around `1e200`; `Infinity - Infinity` then makes the variance `NaN` even
    // though the data is perfectly correlated and not constant at all. Only a
    // column that is actually constant earns the zero-variance diagnosis.
    const precision = ce.precision;
    try {
      ce.precision = 'machine';
      expect(
        ce
          .box([
            'Correlation',
            L([1.5e200, 2.5e200, 3.5e200]),
            L([1.0, 2.0, 3.0]),
          ])
          .N().isNaN
      ).toBe(true);
      const constant = ce
        .box(['Correlation', L([2.0, 2.0, 2.0]), L([1.0, 5.0, 9.0])])
        .N();
      expect(constant.isValid).toBe(false);
      expect(constant.toString()).toMatch(/zero variance/);
    } finally {
      // `BigDecimal.precision` is module-global, so a shared engine must be
      // put back before the next test reads it.
      ce.precision = precision;
    }
  });

  // A constant column whose value is outside the double range: `1e400` is
  // `Infinity` as a JS number, so it is written as a MathJSON literal.
  const BIG = { num: '1e400' } as any;

  test('an out-of-machine-range constant column still reports zero variance', () => {
    // At the default (bignum) precision the correlation kernel sums
    // `BigDecimal`s, where `1e400` is an ordinary finite value; the
    // zero-variance diagnosis must run in the SAME channel. Reading the
    // machine projection instead saw `Infinity`, refused to call the column
    // constant, and answered a bare `NaN`.
    for (const r of [
      ce.box(['Correlation', L([BIG, BIG, BIG]), L([1, 2, 3])]).evaluate(),
      ce.box(['Correlation', L([BIG, BIG, BIG]), L([1.0, 2.0, 3.0])]).N(),
    ]) {
      expect(r.isValid).toBe(false);
      expect(r.toString()).toMatch(/zero variance/);
    }
  });

  test('a complex non-data ARGUMENT is diagnosed as an argument, not as data', () => {
    // A `PolynomialFit` degree is not a datum. `toInteger` reads a number's
    // real part, so `Complex(1, 2)` silently fitted a degree-1 polynomial;
    // scanning it as data would be the opposite mistake, reporting perfectly
    // real data as `incompatible-type real`.
    const r = ce
      .box(['PolynomialFit', L([1, 2]), L([3, 4]), ['Complex', 1, 2]])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toMatch(/degree must be an integer/);
    expect(r.toString()).not.toMatch(NON_REAL);
    // A complex DATUM in the same head is still bad data.
    const d = ce
      .box(['PolynomialFit', L([1, ['Sqrt', -2], 3]), L([3, 4, 5]), 1])
      .evaluate();
    expect(d.isValid).toBe(false);
    expect(d.toString()).toMatch(NON_REAL);
  });

  test('exact real data still returns an exact result', () => {
    expect(
      ce
        .box(['Covariance', L([1, 1, 5]), L([2, 3, 9])])
        .evaluate()
        .toString()
    ).toBe('26/3');
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

describe('Histogram/BinCounts bin spec', () => {
  test('an integer bin count bins; a non-integer scalar stays INERT, never rounded', () => {
    // The declared `number | list<number>` bin spec deliberately admits
    // Desmos-style bin-WIDTH spellings (`histogram(L, .05)`) so they parse;
    // the contract (Histogram's signature note in `library/statistics.ts`)
    // is that a non-integer scalar stays inert for the importer to
    // translate. `computeBinning` used to read it with `toInteger`, which
    // Math.rounds — `BinCounts(L, 2.5)` silently answered the 3-bin
    // question. The high-precision near-integer probes the EXACT
    // integrality test: its rounded machine projection (`.re`) IS 2, so a
    // `.re`-based comparison would wrongly bin it.
    const eng = new ComputeEngine();
    expect(
      eng.box(['BinCounts', L([1, 2, 2, 3]), 3]).evaluate().toString()
    ).toBe('[1,2,1]');
    for (const bad of [
      2.5,
      0.05,
      0,
      -1,
      { num: '2.00000000000000000000000001' },
      ['Complex', 3, 1],
    ]) {
      const b = eng.box(['BinCounts', L([1, 2, 2, 3]), bad as any]).evaluate();
      expect(b.operator).toBe('BinCounts');
      const h = eng.box(['Histogram', L([1, 2, 2, 3]), bad as any]).evaluate();
      expect(h.operator).toBe('Histogram');
    }
    // An exact non-machine spelling of an integer count still bins.
    expect(
      eng
        .box(['BinCounts', L([1, 2, 2, 3]), ['Divide', 6, 2]])
        .evaluate()
        .toString()
    ).toBe('[1,2,1]');
  });
});

describe('One-sample statistics on complex data', () => {
  const I = ['Complex', 1, 2] as any; // 1 + 2i
  const NON_REAL = /incompatible-type.*real.*complex/;

  test('Mean returns the COMPLEX mean, exactly, on exact data', () => {
    // The mean is linear over the complex numbers, so there is no convention
    // to choose. Σx/n by hand: (1 + i)/2, and (1 + (1+2i) + 5)/3 = (7 + 2i)/3.
    expect(ce.box(['Mean', L([1, 'ImaginaryUnit'])]).evaluate().toString()).toBe(
      '(1/2 + 1/2i)'
    );
    expect(ce.box(['Mean', L([1, I, 5])]).evaluate().toString()).toBe(
      '(7/3 + 2/3i)'
    );
    // A two-datum mean with an exact integer answer stays an integer.
    expect(
      ce
        .box(['Mean', L([['Complex', 1, 1], ['Complex', 1, -1]])])
        .evaluate()
        .toString()
    ).toBe('1');
    // Scalar operands (not a collection) take the same path.
    expect(ce.box(['Mean', 1, I]).evaluate().toString()).toBe('(1 + i)');
  });

  test('Mean of float complex data matches the component-wise average', () => {
    // (1.5 + (2.5+0.5i) + (−3.25−1.75i))/3 = 0.25 − (5/12)i
    const r = ce
      .box([
        'Mean',
        L([1.5, ['Complex', 2.5, 0.5], ['Complex', -3.25, -1.75]]),
      ])
      .N();
    expect(r.re).toBeCloseTo(0.25, 12);
    expect(r.im).toBeCloseTo(-5 / 12, 12);
  });

  test('the variance family computes E[|X − μ|²], a real result', () => {
    // Data [1+i, 1−i]: n = 2, μ = 1, deviations ±i, |±i|² = 1, Σ = 2.
    // Sample divisor n−1 = 1 ⇒ 2; population divisor n = 2 ⇒ 1.
    const D = L([
      ['Complex', 1, 1],
      ['Complex', 1, -1],
    ]);
    expect(ce.box(['Variance', D]).evaluate().toString()).toBe('2');
    expect(ce.box(['PopulationVariance', D]).evaluate().toString()).toBe('1');
    expect(ce.box(['StandardDeviation', D]).evaluate().toString()).toBe(
      'sqrt(2)'
    );
    expect(
      ce.box(['PopulationStandardDeviation', D]).evaluate().toString()
    ).toBe('1');
    // Not (X − μ)², which would be i² + (−i)² = −2 for this data.
    expect(ce.box(['Variance', D]).N().im).toBe(0);
    expect(ce.box(['Variance', D]).N().re).toBe(2);
  });

  test('variance of [1, 1+2i, 5] matches the hand-computed magnitudes', () => {
    // μ = 7/3 + (2/3)i. |1 − μ|² = 16/9 + 4/9 = 20/9;
    // |(1+2i) − μ|² = 16/9 + 16/9 = 32/9; |5 − μ|² = 64/9 + 4/9 = 68/9.
    // Σ = 120/9 = 40/3 ⇒ sample 40/3 / 2 = 20/3, population 40/3 / 3 = 40/9.
    const D = L([1, I, 5]);
    expect(ce.box(['Variance', D]).evaluate().toString()).toBe('20/3');
    expect(ce.box(['PopulationVariance', D]).evaluate().toString()).toBe('40/9');
    expect(ce.box(['StandardDeviation', D]).N().re).toBeCloseTo(
      Math.sqrt(20 / 3),
      12
    );
    expect(ce.box(['PopulationStandardDeviation', D]).N().re).toBeCloseTo(
      Math.sqrt(40 / 9),
      12
    );
  });

  test('exact Gaussian-rational data keeps an exact variance', () => {
    // [1/3 + (2/5)i, 1/3 − (2/5)i]: μ = 1/3, |±(2/5)i|² = 4/25,
    // Σ = 8/25, sample divisor 1.
    const r = ce
      .box([
        'Variance',
        L([ce.parse('\\frac13+\\frac25i'), ce.parse('\\frac13-\\frac25i')]),
      ])
      .evaluate();
    expect(r.toString()).toBe('8/25');
    expect(r.isExact).toBe(true);
  });

  test('an INEXACT complex deviation loses no ulp to a square-root round trip', () => {
    // μ = 1.25 + i; |1.5 − μ|² = 0.0625 + 1 = 1.0625, |(1+2i) − μ|² = the same,
    // Σ = 2.125, sample divisor 1. Taking `Abs` first rounds the square root
    // and squaring it back read `2.1250…02` at the default precision.
    const D = L([1.5, I]);
    for (const precision of ['machine', ce.precision] as const) {
      const saved = ce.precision;
      try {
        ce.precision = precision;
        expect(ce.box(['Variance', D]).evaluate().re).toBe(2.125);
        expect(ce.box(['Variance', D]).N().re).toBe(2.125);
      } finally {
        // `BigDecimal.precision` is module-global — put the shared engine back.
        ce.precision = saved;
      }
    }
  });

  test('the order-based and higher-moment heads reject complex data', () => {
    // No canonical order on the complex plane, and no convention-free complex
    // extension of the standardized moments — so these error rather than
    // answer for the projected sample. Same error shape as the bivariate heads.
    for (const op of [
      'Median',
      'Mode',
      'Quartiles',
      'InterquartileRange',
      'Skewness',
      'Kurtosis',
    ]) {
      for (const r of [
        ce.box([op, L([1, I])]).evaluate(),
        ce.box([op, L([1, I])]).N(),
      ]) {
        expect(r.isValid).toBe(false);
        expect(r.toString()).toMatch(NON_REAL);
      }
    }
  });

  test('the empirical Quantile form rejects complex data too', () => {
    // A quantile is an order statistic like Median; its empirical branch
    // lives in `library/distributions.ts` and shares the validators via
    // `library/statistics-data.ts` (a direct import from statistics.ts
    // would be a dependency cycle — statistics already imports
    // distributions for the distribution branches of Mean/Variance).
    const half = ['Rational', 1, 2] as any;
    for (const r of [
      ce.box(['Quantile', L([1, I, 5]), half]).evaluate(),
      ce.box(['Quantile', L([1, I, 5]), half]).N(),
    ]) {
      expect(r.isValid).toBe(false);
      expect(r.toString()).toMatch(NON_REAL);
    }
    // Real data and the distribution form are untouched.
    expect(ce.box(['Quantile', L([1, 3, 5]), half]).evaluate().toString()).toBe(
      '3'
    );
    expect(
      ce
        .box(['Quantile', ['NormalDistribution', 0, 1], half])
        .evaluate()
        .toString()
    ).toBe('0');
  });

  test('the binning heads reject complex data and complex bin edges', () => {
    for (const op of ['Histogram', 'BinCounts']) {
      const data = ce.box([op, L([1, I, 5]), 2] as any).evaluate();
      expect(data.isValid).toBe(false);
      expect(data.toString()).toMatch(NON_REAL);
      // An explicit bin edge is read through `.re` too.
      const edges = ce.box([op, L([1, 2, 3]), L([0, I, 4])] as any).evaluate();
      expect(edges.isValid).toBe(false);
      expect(edges.toString()).toMatch(NON_REAL);
    }
  });

  test('a non-literal element leaves the binning heads INERT, never silently dropped', () => {
    // `Sqrt(-2)` is a function expression during ordinary evaluation, so the
    // complex gate cannot see it; its `.re` is `NaN`, and the datum used to be
    // silently FILTERED out — `BinCounts([1, Sqrt(-2), 5], 2)` reported the
    // counts of the two-point dataset `[1, 5]`. Declining is the same doctrine
    // `empiricalQuantile` follows, and `.N()` then numericizes the element to
    // a complex literal the gate does reject.
    for (const op of ['Histogram', 'BinCounts']) {
      expect(
        ce.box([op, L([1, ['Sqrt', -2], 5]), 2] as any).evaluate().operator
      ).toBe(op);
      const n = ce.box([op, L([1, ['Sqrt', -2], 5]), 2] as any).N();
      expect(n.isValid).toBe(false);
      // `√-2` numericizes to a pure imaginary, so the reported type is
      // `imaginary` rather than the `complex` of `1 + 2i`.
      expect(n.toString()).toMatch(/incompatible-type.*real/);
      // A non-literal bin EDGE declines the same way.
      expect(
        ce
          .box([op, L([1, 2, 3]), L([0, ['Sqrt', -2], 4])] as any)
          .evaluate().operator
      ).toBe(op);
    }
    // A real `Sqrt(2)` is an exact number literal, so it bins on both routes.
    expect(
      ce.box(['BinCounts', L([1, ['Sqrt', 2], 5]), 2] as any).evaluate().toString()
    ).toBe('[2,1]');
    expect(
      ce.box(['BinCounts', L([1, ['Sqrt', 2], 5]), 2] as any).N().toString()
    ).toBe('[2,1]');
  });

  test('real data is untouched: exact results and the median still stand', () => {
    expect(ce.box(['Mean', L([1, 1, 5])]).evaluate().toString()).toBe('7/3');
    expect(ce.box(['Mean', L([1, 2, 3, 4])]).evaluate().toString()).toBe('5/2');
    expect(ce.box(['Median', L([1, 1, 5])]).evaluate().toString()).toBe('1');
    expect(ce.box(['Median', L([1, 2, 3, 4])]).evaluate().toString()).toBe(
      '5/2'
    );
    expect(ce.box(['Variance', L([1, 1, 5])]).evaluate().toString()).toBe(
      '16/3'
    );
    expect(ce.box(['Quartiles', L([1, 2, 3, 4, 5])]).evaluate().toString()).toBe(
      '(3/2, 3, 9/2)'
    );
    expect(ce.box(['Mode', L([1, 2, 2, 3])]).evaluate().toString()).toBe('2');
    expect(
      ce.box(['BinCounts', L([1, 2, 2, 3]), 3]).evaluate().toString()
    ).toBe('[1,2,1]');
    // `Complex(2, 0)` canonicalizes to the real `2`, so it is real data and
    // must not trip the gate on either side of the split.
    expect(
      ce.box(['Mean', L([1, ['Complex', 2, 0], 5])]).evaluate().toString()
    ).toBe('8/3');
    expect(
      ce.box(['Median', L([1, ['Complex', 2, 0], 5])]).evaluate().toString()
    ).toBe('2');
  });

  test('absent-datum and REAL ±∞ behavior is unchanged', () => {
    // A `NaN` datum absorbs to `NaN` for every head (the §3.C aggregate rule),
    // and a REAL `±∞` keeps the reading it has always had — this round changed
    // neither. (`~oo` did change: see the next test.)
    const inf = { num: '+Infinity' } as any;
    for (const op of [
      'Mean',
      'Median',
      'Variance',
      'PopulationVariance',
      'StandardDeviation',
      'PopulationStandardDeviation',
      'Skewness',
      'Kurtosis',
      'Mode',
      'InterquartileRange',
    ])
      expect(ce.box([op, L([1, 'NaN', 5])]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Quartiles', L([1, 'NaN', 5])]).evaluate().toString()).toBe(
      '(NaN, NaN, NaN)'
    );
    // A real `±∞` has a real value: `Mean` carries it, `Median`/`Mode` order
    // around it, and the variance family cancels it to `NaN`.
    expect(ce.box(['Mean', L([1, inf, 5])]).evaluate().toString()).toBe('+oo');
    expect(ce.box(['Median', L([1, inf, 5])]).evaluate().toString()).toBe('5');
    expect(ce.box(['Mode', L([1, inf, 5])]).evaluate().toString()).toBe('1');
    expect(ce.box(['Variance', L([1, inf, 5])]).evaluate().isNaN).toBe(true);
    expect(
      ce.box(['Quartiles', L([1, inf, 5])]).evaluate().toString()
    ).toBe('(1, 5, +oo)');
    expect(
      ce.box(['InterquartileRange', L([1, inf, 5])]).evaluate().toString()
    ).toBe('+oo');
    expect(
      ce.box(['Quantile', L([1, inf, 5]), ['Rational', 1, 2]]).evaluate().isNaN
    ).toBe(true);
  });

  test('`~oo` reads as NaN in every univariate head, under BOTH spellings', () => {
    // The complex infinity has no real value, and the real part it reports is
    // an artifact of how it was written: `ComplexInfinity` reports `Infinity`,
    // `Complex(1, Infinity)` reports `1`. Reading either made the same value
    // answer `Mean([1, ~oo, 5])` as `+oo` under one spelling and as `2.33…`
    // under the other, and `Median` as `5` and `1`. Every head now projects it
    // to `NaN` (`realProjection`) — the treatment the bivariate heads already
    // gave it — so the two spellings agree and neither reports a statistic of
    // data nobody supplied.
    const spellings = ['ComplexInfinity', ['Complex', 1, { num: '+Infinity' }]];
    for (const oo of spellings) {
      for (const op of [
        'Mean',
        'Median',
        'Mode',
        'Variance',
        'PopulationVariance',
        'StandardDeviation',
        'PopulationStandardDeviation',
        'Skewness',
        'Kurtosis',
        'InterquartileRange',
      ])
        expect(ce.box([op, L([1, oo as any, 5])]).evaluate().isNaN).toBe(true);
      expect(
        ce.box(['Quartiles', L([1, oo as any, 5])]).evaluate().toString()
      ).toBe('(NaN, NaN, NaN)');
      expect(
        ce
          .box(['Quantile', L([1, oo as any, 5]), ['Rational', 1, 2]])
          .evaluate().isNaN
      ).toBe(true);
      // The bivariate heads already answered `NaN`; they still do.
      expect(
        ce.box(['Covariance', L([1, oo as any, 5]), L([2, 3, 4])]).evaluate()
          .isNaN
      ).toBe(true);
    }
  });

  test('a non-finite datum makes the COMPLEX branches NaN too', () => {
    // The complex branches of `Mean` and the variance family are reached only
    // when some datum is genuinely complex. A complex sample point plus a
    // point at infinity has no reading — `+∞` is a limit along the real axis —
    // yet boxed arithmetic folded both to `+oo`, which for the variance also
    // contradicted the real-only path (`Variance([1, +∞])` is `NaN`).
    const inf = { num: '+Infinity' } as any;
    const z = ['Complex', 1, 2];
    for (const op of [
      'Mean',
      'Variance',
      'PopulationVariance',
      'StandardDeviation',
      'PopulationStandardDeviation',
    ]) {
      expect(ce.box([op, L([z as any, inf])]).evaluate().isNaN).toBe(true);
      expect(
        ce.box([op, L([z as any, 'ComplexInfinity'])]).evaluate().isNaN
      ).toBe(true);
    }
    // The real-only path is untouched: the mean of `[1, +∞]` is still `+oo`.
    expect(ce.box(['Mean', L([1, inf])]).evaluate().toString()).toBe('+oo');
    expect(ce.box(['Variance', L([1, inf])]).evaluate().isNaN).toBe(true);
  });

  test('a complex-valued EXPRESSION datum leaves the head inert, as before', () => {
    // `Sqrt(-2)` is not a number literal, so `collectData` declines and the
    // aggregate stays symbolic rather than folding — the same rule that keeps
    // `Mean(L)` inert for an unassigned `L`. Under `.N()` the datum becomes a
    // complex literal and the split applies.
    expect(ce.box(['Mean', L([1, ['Sqrt', -2]])]).evaluate().operator).toBe(
      'Mean'
    );
    const n = ce.box(['Mean', L([1, ['Sqrt', -2]])]).N();
    expect(n.re).toBeCloseTo(0.5, 12);
    expect(n.im).toBeCloseTo(Math.SQRT2 / 2, 12);
    const m = ce.box(['Median', L([1, ['Sqrt', -2]])]).N();
    expect(m.isValid).toBe(false);
    expect(m.toString()).toMatch(/incompatible-type.*real/);
  });
});

// Both halves of the binning path used to answer a question
// nobody asked when a value had no finite real reading: the DATA path filtered
// the value out of the sample, and the EDGE path let every interval comparison
// against it be false and reported a row of zeros. There is no NaN-absorbing
// result form to fall back on here — a histogram's answer is a vector of
// COUNTS — so both now raise the structured `incompatible-type` error, naming
// the `real` constraint. A value the binning's machine-float
// arithmetic cannot represent is refused too, but as `out-of-range`: that is a
// limit of the kernel, not a claim about the value.
describe('Histogram/BinCounts reject values they cannot bin', () => {
  const NON_FINITE = /incompatible-type.*real/;
  const inf = { num: '+Infinity' } as any;
  const nan = { num: 'NaN' } as any;
  // Both spellings of the complex infinity: `ComplexInfinity` reports a real
  // part of `Infinity`, `Complex(1, Infinity)` reports `1`, and neither is a
  // reading of the value.
  const spellings = ['ComplexInfinity', ['Complex', 1, inf]] as any[];

  test('a non-finite DATUM errors instead of being dropped from the sample', () => {
    for (const op of ['Histogram', 'BinCounts']) {
      for (const bad of [inf, { num: '-Infinity' }, nan, ...spellings]) {
        const r = ce.box([op, L([1, bad, 5]), 2] as any).evaluate();
        expect(r.isValid).toBe(false);
        expect(r.toString()).toMatch(NON_FINITE);
        expect(r.toString()).toContain(op);
      }
    }
    // The behavior this replaces: the value was filtered out and the head
    // reported the counts of the two-point dataset `[1, 5]`.
    expect(ce.box(['BinCounts', L([1, 5]), 2]).evaluate().toString()).toBe(
      '[1,1]'
    );
  });

  test('a non-finite explicit bin EDGE errors instead of fabricating zeros', () => {
    for (const op of ['Histogram', 'BinCounts']) {
      for (const bad of [inf, nan, ...spellings]) {
        const r = ce
          .box([op, L([1, 2, 3]), L([0, bad, 10])] as any)
          .evaluate();
        expect(r.isValid).toBe(false);
        expect(r.toString()).toMatch(NON_FINITE);
      }
    }
  });

  test('every rejection names the `real` constraint and reports the datum type', () => {
    // Both scans reject against the same constraint: `real` denotes the FINITE
    // reals, so a complex datum and a non-finite one are both outside it. The
    // rejections stay distinguishable through the GOT side — the offending
    // datum's own type. (Before the `finite_*` names retired, the two scans
    // named different constraints, `real` and `finite_real`.)
    const complex = ce
      .box(['BinCounts', L([1, ['Complex', 1, 2], 5]), 2])
      .evaluate();
    expect(complex.isValid).toBe(false);
    expect(complex.toString()).toMatch(/incompatible-type.*real.*complex/);

    const inf = { num: '+Infinity' } as any;
    const infinite = ce.box(['BinCounts', L([1, inf, 5]), 2]).evaluate();
    expect(infinite.isValid).toBe(false);
    expect(infinite.toString()).toMatch(/incompatible-type.*real.*Infinity/);
  });

  test('a finite real beyond the MACHINE range is out-of-range, not mistyped', () => {
    // `10^400` is an exact `integer`: the value is a perfectly good
    // finite real, and it is the binning's own double arithmetic — the sample
    // min/max, the bin width, every interval comparison — that cannot place
    // it. So the error names the kernel's range instead of claiming the datum
    // is not a finite real, which would contradict its own type evidence.
    const big = ['Power', 10, 400] as any;
    for (const op of ['Histogram', 'BinCounts']) {
      const r = ce.box([op, L([1, big, 5]), 2] as any).evaluate();
      expect(r.isValid).toBe(false);
      expect(r.toString()).toMatch(/out-of-range.*machine floating-point range/);
      expect(r.toString()).not.toMatch(/incompatible-type/);
      expect(r.toString()).toContain(op);
    }
    // The same value as an explicit bin EDGE.
    const edge = ce
      .box(['BinCounts', L([1, 2, 3]), L([0, big, 10])] as any)
      .evaluate();
    expect(edge.isValid).toBe(false);
    expect(edge.toString()).toMatch(/out-of-range/);
    // The limit belongs to the binning kernel alone: the statistics that sum
    // their data exactly accept the same sample.
    expect(
      ce.box(['Mean', L([1, big, 5])] as any).evaluate().isValid
    ).toBe(true);
  });

  test('finite real data and finite explicit edges are untouched', () => {
    expect(ce.box(['BinCounts', L([1, 2, 2, 3]), 3]).evaluate().toString()).toBe(
      '[1,2,1]'
    );
    expect(
      ce.box(['Histogram', L([1, 2, 2, 3]), 3]).evaluate().ops!.length
    ).toBe(3);
    expect(
      ce.box(['BinCounts', L([1, 2, 3, 9]), L([0, 2, 10])]).evaluate().toString()
    ).toBe('[1,3]');
  });
});

// A value with no finite real reading in the X column used
// to be diagnosed by the Gaussian elimination rather than by the data: the
// pivot search found no non-zero pivot and the head reported `degenerate
// data`, a claim about the geometry of the sample the data does not support,
// or — when it happened to pivot on a later row — returned the half-`NaN`
// tuple `(NaN, 0)`, whose `0` slope is not a fit of anything.
describe('LinearRegression/PolynomialFit propagate NaN for non-finite data', () => {
  const inf = { num: '+Infinity' } as any;
  const nan = { num: 'NaN' } as any;
  // Both spellings of the complex infinity are included: `ComplexInfinity`
  // reports a real part of `Infinity`, `Complex(1, Infinity)` reports `1`.
  const bad = [
    nan,
    inf,
    { num: '-Infinity' },
    'ComplexInfinity',
    ['Complex', 1, inf],
  ] as any[];

  test('LinearRegression answers the all-NaN PAIR its signature declares', () => {
    for (const b of bad) {
      // In the X column (this is the case that used to error) …
      const x = ce.box(['LinearRegression', L([1, b, 5]), L([2, 3, 9])]).evaluate();
      expect(x.toString()).toBe('(NaN, NaN)');
      // … and in the Y column, which already answered this way.
      const y = ce.box(['LinearRegression', L([1, 2, 5]), L([2, b, 9])]).evaluate();
      expect(y.toString()).toBe('(NaN, NaN)');
    }
    // `.N()` agrees — the old `(NaN, 0)` artifact survived numericization.
    expect(
      ce.box(['LinearRegression', L([1, inf, 5]), L([2, 3, 9])]).N().toString()
    ).toBe('(NaN, NaN)');
    // The pairs form takes the same route.
    expect(
      ce
        .box(['LinearRegression', L([L([1, 2]), L([nan, 3]), L([3, 6])])])
        .evaluate()
        .toString()
    ).toBe('(NaN, NaN)');
  });

  test('a datum outside the MACHINE range still gets the exact fit', () => {
    // The non-finite test is on the VALUE, not on its double projection:
    // `10^400` is an exact finite integer that projects to `Infinity`, and
    // reading the projection made these heads answer `(NaN, NaN)` for data
    // they fit exactly. The fits sum their data exactly, so they have no
    // machine-range limit (unlike the binning heads above).
    const r = ce
      .box(['LinearRegression', L([1, ['Power', 10, 400], 5]), L([2, 3, 9])])
      .evaluate();
    expect(r.isValid).toBe(true);
    expect(r.operator).toBe('Tuple');
    expect(r.toString()).not.toMatch(/NaN/);
    // Exact throughout: an inexact fit would serialize as machine floats, with
    // a decimal point or an exponent. These coefficients are big rationals.
    for (const c of r.ops!) expect(c.toString()).toMatch(/^-?\d+(\/\d+)?$/);
  });

  test('PolynomialFit answers a NaN coefficient per declared degree', () => {
    // The degree is validated before the fit runs, so the list length is
    // always well defined — one coefficient per power, all NaN.
    for (const b of bad) {
      for (const [degree, want] of [
        [0, '[NaN]'],
        [1, '[NaN,NaN]'],
        [2, '[NaN,NaN,NaN]'],
      ] as [number, string][])
        expect(
          ce
            .box(['PolynomialFit', L([1, b, 5, 7]), L([2, 3, 9, 11]), degree])
            .evaluate()
            .toString()
        ).toBe(want);
    }
  });

  test('the trailing-variable form returns the expression with NaN coefficients', () => {
    expect(
      ce
        .box(['LinearRegression', L([1, nan, 5]), L([2, 3, 9]), 'x'])
        .evaluate()
        .toString()
    ).toBe('NaN * x + NaN');
    expect(
      ce
        .box(['PolynomialFit', L([1, nan, 5, 7]), L([2, 3, 9, 11]), 2, 'x'])
        .evaluate()
        .toString()
    ).toBe('NaN * x^2 + NaN * x + NaN');
  });

  test('`degenerate data` survives for rank-deficient FINITE real data', () => {
    for (const r of [
      ce.box(['LinearRegression', L([2, 2, 2]), L([1, 2, 3])]).evaluate(),
      ce.box(['PolynomialFit', L([2, 2, 2]), L([1, 2, 3]), 1]).evaluate(),
    ]) {
      expect(r.isValid).toBe(false);
      expect(r.toString()).toMatch(/degenerate data/);
    }
  });

  test('finite real data is untouched', () => {
    expect(
      ce.box(['LinearRegression', L([1, 2, 3]), L([2, 4, 6])]).evaluate().toString()
    ).toBe('(0, 2)');
    expect(
      ce.box(['PolynomialFit', L([1, 2, 3]), L([2, 4, 6]), 1]).evaluate().toString()
    ).toBe('[0,2]');
  });

  test('mismatched lengths report incompatible-dimensions, like the bivariate heads', () => {
    // A length mismatch is a dimension error, not "degenerate data" — the
    // same strict pairwise-length convention `Covariance` pins above. It
    // previously fell through to the kernel's rank guard and was
    // misdiagnosed.
    for (const r of [
      ce.box(['LinearRegression', L([1, 2]), L([1, 2, 3])]).evaluate(),
      ce.box(['PolynomialFit', L([1, 2]), L([1, 2, 3]), 1]).evaluate(),
      // The length disagreement is the dominant fact: it wins over a NaN
      // datum, which would otherwise propagate, and over a complex one,
      // which would otherwise be rejected as non-real data.
      ce.box(['LinearRegression', L([1, nan]), L([1, 2, 3])]).evaluate(),
      ce.box(['PolynomialFit', L([1, nan]), L([1, 2, 3]), 1]).evaluate(),
      ce
        .box(['LinearRegression', L([1, ['Complex', 1, 2]]), L([1, 2, 3])])
        .evaluate(),
      ce
        .box(['PolynomialFit', L([1, ['Complex', 1, 2]]), L([1, 2, 3]), 1])
        .evaluate(),
    ]) {
      expect(r.isValid).toBe(false);
      expect(r.toString()).toMatch(/incompatible-dimensions.*2 vs 3/);
    }
  });

  test('fewer than two points is a sample-geometry error, not a NaN answer', () => {
    // One point determines no line whatever its value is, so the geometry is
    // reported ahead of the NaN propagation — `LinearRegression([NaN], [2])`
    // used to answer `(NaN, NaN)` while `PolynomialFit([NaN], [2], 1)` said
    // there were not enough points. The finite one-point sample, which used
    // to be blamed on the data as `degenerate data`, now says the same thing.
    for (const r of [
      ce.box(['LinearRegression', L([nan]), L([2])]).evaluate(),
      ce.box(['LinearRegression', L([1]), L([2])]).evaluate(),
      ce.box(['LinearRegression', L([]), L([])]).evaluate(),
    ]) {
      expect(r.isValid).toBe(false);
      expect(r.toString()).toMatch(/not enough data points/);
      expect(r.toString()).not.toMatch(/degenerate/);
    }
    expect(
      ce.box(['PolynomialFit', L([nan]), L([2]), 1]).evaluate().toString()
    ).toMatch(/not enough data points/);
  });

  test('a NaN or infinite DEGREE is reported as a degree, not as a bad call', () => {
    // A number in the degree position is a degree, however badly spelled:
    // `NaN`/`±∞` used to make the parse fail and blame the whole argument
    // list, and a non-integer was silently rounded (`2.5` fitted degree 3),
    // which the error message's own "must be an integer" contradicts.
    for (const degree of [nan, inf, { num: '-Infinity' }, 2.5]) {
      const r = ce
        .box(['PolynomialFit', L([1, 2, 3, 4]), L([2, 4, 6, 8]), degree] as any)
        .evaluate();
      expect(r.isValid).toBe(false);
      expect(r.toString()).toMatch(/degree must be an integer in \[0, 12\]/);
    }
  });
});
