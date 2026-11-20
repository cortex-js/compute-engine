import { ComputeEngine } from '../../src/compute-engine';

//
// `HarmonicNumber(n)` and `HarmonicNumber(n, r)` in the interpreter: the
// exact sum of a large integer n (CE-1555) and the series near n = 0
// (CE-1559). Reference values are mpmath's, `psi(0, n + 1) + euler` and
// `zeta(r) - zeta(r, n + 1)` at 400 digits. The times are checked only
// under `CE_PERF=1`; the work of the series is checked by its steps.
//

const perf = process.env.CE_PERF === '1';

const H = (ce: ComputeEngine, ...ops: (number | string)[]) =>
  ce.function(
    'HarmonicNumber',
    ops.map((x) => ce.number(x))
  );

/** The relative difference of `value` and the decimal string `expected`. */
function relativeError(value: string, expected: string): number {
  const e = Number(expected);
  return Math.abs(Number(value) - e) / Math.abs(e);
}

/** The relative difference of `value` and `expected`, at `ce.precision`. */
function bigRelativeError(
  ce: ComputeEngine,
  value: ReturnType<ComputeEngine['number']>,
  expected: string
): number {
  const e = ce.number(expected);
  return Math.abs(value.sub(e).div(e).N().re);
}

describe('HarmonicNumber OF A LARGE INTEGER (CE-1555)', () => {
  const ce = new ComputeEngine();

  test('an order of 0 is n, exact and immediate', () => {
    const start = Date.now();
    const v = H(ce, 1e6, 0).N();
    if (perf) expect(Date.now() - start).toBeLessThan(500);
    expect(v.json).toBe(1000000);
    expect(H(ce, 1e6, 0).evaluate().isExact).toBe(true);
  });

  test('a large n with a small order is exact within the budget, or numeric', () => {
    for (const [n, r, value] of [
      [30000, 1, 10.886184992119898],
      [20000, 2, 1.6448840680982056],
      [5000, 10, 1.000994575127818],
      [1000, 50, 1],
      [1e6, 1, 14.392726722865723],
    ]) {
      const start = Date.now();
      const v = H(ce, n, r).N();
      if (perf) expect(Date.now() - start).toBeLessThan(3000);
      expect(v.re).toBeCloseTo(value, 12);
    }
  });

  test('past the budget the exact form stays symbolic', () => {
    for (const [n, r] of [
      [20000, 2],
      [5000, 10],
      [1000, 50],
    ]) {
      const start = Date.now();
      expect(H(ce, n, r).evaluate().operator).toBe('HarmonicNumber');
      if (perf) expect(Date.now() - start).toBeLessThan(500);
    }
    // Within the budget, the exact rational.
    expect(H(ce, 2000, 10).evaluate().operator).toBe('Rational');
  });

  test('a small n with a large order is exact', () => {
    expect(H(ce, 1, 100000).evaluate().json).toBe(1);
    const v = H(ce, 2, 30000).evaluate();
    expect(v.operator).toBe('Rational');
    expect(v.N().re).toBe(1);
  });
});

describe('HarmonicNumber NEAR 0 (CE-1559)', () => {
  // [n, r, value]; r = '' is the one-operand form.
  const cases: [string, string, string][] = [
    ['1e-30', '', '1.6449340668482264364724151666448231323157903069213987e-30'],
    [
      '1e-30',
      '2',
      '2.404113806319188570799476323019653011828839170106449752e-30',
    ],
    ['1e-30', '-1', '5.000000000000000000000000000005e-31'],
    [
      '1e-30',
      '0.5',
      '1.306187674342744171674283783961532757563931232257622915e-30',
    ],
    [
      '1e-10',
      '',
      '1.644934066728020746167278970442125827227923303475568483e-10',
    ],
    ['0.05', '', '0.0793706736016624895436328372156106627759425578580506155'],
    [
      '-0.05',
      '',
      '-0.08539395130379247555551694447246176886169644485559823244',
    ],
    ['0.05', '3', '0.1479778921868776924780228782643550950233962509792009949'],
    ['0.09', '50', '0.9865514611167736410625898541173227527471742841611841928'],
    [
      '-0.09',
      '2.5',
      '-0.2964735361582417071301285160323265471311994389863723573',
    ],
    ['0.05', '-4.5', '-0.0011426881472433749627225373742517249918158273331919'],
    // An order r ≤ −5 (the series ends at j = 1 − r for an integer r).
    [
      '1e-30',
      '-5',
      '-8.333333333333333333333333333333333333333333333333333333e-62',
    ],
    [
      '1e-30',
      '-5.5',
      '1.700418085968708614653341209816050543877817533256606807e-32',
    ],
    [
      '1e-30',
      '-6',
      '2.380952380952380952380952380952380952380952380952380952e-32',
    ],
    [
      '1e-30',
      '-10',
      '7.575757575757575757575757575757575757575757575757575758e-32',
    ],
    ['0.07', '-30', '40766055.07609740926575370850433241247357140740200140864'],
    [
      '0.0999',
      '-5.5',
      '0.001056482110256415847561720559343129155836208358316020173',
    ],
    [
      '-0.07',
      '-2.5',
      '-0.002704010174456282945305882890042212447906866426366683916',
    ],
    // Near the pole of ζ(1 + r), which the coefficient r cancels.
    ['0.05', '1e-100', '0.05'],
    // Near |n| = 0.1, the continuation at a raised precision.
    [
      '-0.0999',
      '0.3',
      '-0.120814112784026913283261877314173847985333353963297393',
    ],
    ['0.0999', '', '0.1533173852673376866690421769679922961009790140607422591'],
  ];
  const operands = (n: string, r: string) => (r === '' ? [n] : [n, r]);

  test('at machine precision', () => {
    const ce = new ComputeEngine();
    for (const [n, r, expected] of cases) {
      const v = H(ce, ...operands(n, r)).N();
      expect([n, r, relativeError(v.toString(), expected) < 1e-14]).toEqual([
        n,
        r,
        true,
      ]);
    }
  });

  test('at 50 digits', () => {
    const ce = new ComputeEngine();
    ce.precision = 50;
    for (const [n, r, expected] of cases) {
      const v = H(ce, ...operands(n, r)).N();
      expect([n, r, bigRelativeError(ce, v, expected) < 1e-48]).toEqual([
        n,
        r,
        true,
      ]);
    }
  });

  test('the series is short at a high precision', () => {
    // One step per term of the series: the series of a |n| near 0.1 at 300
    // digits would take about 300 terms, each a ζ at 300 digits.
    const ce = new ComputeEngine();
    ce.precision = 300;
    for (const ops of [
      ['-0.0999', '0.3'],
      ['0.0999', '1'],
      ['0.0999', '-5.5'],
      ['1e-30', '2'],
    ]) {
      const steps = ce.withStepBudget({ steps: 1_000_000 }, () => {
        expect(H(ce, ...ops).N().isFinite).toBe(true);
        return 1_000_000 - ce.stepsLeft!;
      });
      expect([ops, steps <= 60]).toEqual([ops, true]);
    }
  });

  test('an order of 0 is n', () => {
    const ce = new ComputeEngine();
    expect(H(ce, '0.05', '0').N().re).toBe(0.05);
  });
});
