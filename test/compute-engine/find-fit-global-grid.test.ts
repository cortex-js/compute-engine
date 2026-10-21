import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine';
import {
  analyzeGlobalShape,
  gridCounts,
  sampleRowCounts,
  sampleRowIndices,
} from '../../src/compute-engine/nonlinear-fit';

//
// The grid of the `global` option of `FindFit` (Tycho row 407).
//
// The global search samples each searched parameter on a grid, solves the
// parameters the model is linear in at each grid point, and refines the best
// local minima of the grid by Levenberg–Marquardt. For a frequency `b` in
// `a cos(b x + c) + d x + e`, the residual has a basin about
// `π / span(x)` wide around each frequency that fits, so a grid with a fixed
// number of points over a wide range finds the best fit only when a point
// happens to fall in its basin. The search now:
//
// - spaces the grid of a parameter that scales the phase of a periodic
//   function of a fit variable by that basin width;
// - accepts a caller-given step, `b: [lo, hi, step]`;
// - bounds a two-parameter grid to a budget of points;
// - solves the phase `c` of `a cos(b x + c)` by least squares (with
//   `a cos(b x + c) = p cos(b x) + q sin(b x)`), so it leaves the grid;
// - scans on a stratified sample of the rows when there are many, solves
//   the best grid points again on every row, and refines on every row.
//
// The deciding cases and the controls are ported from Tycho's instrument
// `scripts/repros/2026-10-20-ce407-findfit-global-grid-resolution-repro.mts`.
//

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

const param = (rec: BoxedExpression, name: string): number =>
  Number(rec.get('parameters')?.get(name)?.re);
const converged = (rec: BoxedExpression): boolean =>
  rec.get('converged')?.symbol === 'True';
const residualNorm = (rec: BoxedExpression): number =>
  Number(rec.get('residualNorm')?.re);

/** `a cos(b x + c) + d x + e`, where `e` is Euler's number: the model of the
 * Desmos graph `neyret/5hn1azxfc8`. */
const MODEL = [
  'Add',
  ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
  ['Multiply', 'd', 'x'],
  'ExponentialE',
];
const PARAMS = ['List', 'a', 'b', 'c', 'd'];

/** `n` points evenly spaced on `[0, 10]`, with no noise, from `a = 2`,
 * `c = 0.5`, `d = 0.1` and the frequency `b`. */
function dense(n: number, b: number): { xs: number[]; ys: number[] } {
  const xs = Array.from({ length: n }, (_, i) => (10 * i) / (n - 1));
  const ys = xs.map((x) => 2 * Math.cos(b * x + 0.5) + 0.1 * x + Math.E);
  return { xs, ys };
}

const dataOf = (xs: number[], ys: number[]) => [
  'List',
  ...xs.map((x, i) => ['Tuple', x, ys[i]]),
];

/** `FindFit` of `MODEL` through the box route (Tycho's route), with the
 * `global` option `ranges`. */
function globalFit(
  xs: number[],
  ys: number[],
  ranges: Record<string, number[]>,
  params: any = PARAMS
): BoxedExpression {
  return ce
    .box([
      'FindFit',
      dataOf(xs, ys),
      MODEL,
      params,
      ['List', 'x'],
      { dict: { global: { dict: ranges } } },
    ] as any)
    .evaluate();
}

const rss = (rec: BoxedExpression): number => residualNorm(rec) ** 2;

// The top of Tycho's frequency range on 200 points: `2π / (smallest gap)`.
const HI_200 = (2 * Math.PI) / (10 / 199);

describe('FindFit global grid: Tycho row 407', () => {
  test('deciding 1: n = 200, b = 2.2 over [0.3, 2π / gap]', () => {
    const { xs, ys } = dense(200, 2.2);
    const rec = globalFit(xs, ys, { b: [0.3, HI_200], c: [0, 2 * Math.PI] });
    expect(rss(rec)).toBeLessThanOrEqual(1e-12);
  });

  test('deciding 2: n = 200, b = 50 over [0.3, 2π / gap]', () => {
    const { xs, ys } = dense(200, 50);
    const rec = globalFit(xs, ys, { b: [0.3, HI_200], c: [0, 2 * Math.PI] });
    expect(rss(rec)).toBeLessThanOrEqual(1e-12);
  });

  test('deciding 3: n = 200, b = 2.2 over [0.3, 120]', () => {
    const { xs, ys } = dense(200, 2.2);
    const rec = globalFit(xs, ys, { b: [0.3, 120], c: [0, 2 * Math.PI] });
    expect(rss(rec)).toBeLessThanOrEqual(1e-12);
    expect(param(rec, 'b')).toBeCloseTo(2.2, 9);
    expect(param(rec, 'a')).toBeCloseTo(2, 9);
    expect(param(rec, 'c')).toBeCloseTo(0.5, 9);
    expect(param(rec, 'd')).toBeCloseTo(0.1, 9);
  });

  test('control 1: n = 200, b = 2.2 over [0.3, 60]', () => {
    const { xs, ys } = dense(200, 2.2);
    const rec = globalFit(xs, ys, { b: [0.3, 60], c: [0, 2 * Math.PI] });
    expect(rss(rec)).toBeLessThanOrEqual(1e-12);
  });

  test('control 2: the five 5hn1azxfc8 points, b over [0.1, 6]', () => {
    const rec = globalFit(
      [1, 3.22, 5.27, 10.49, 7.12],
      [4.3, 1.18, 0.01, 1.48, 3.44],
      { b: [0.1, 6] }
    );
    expect(rss(rec)).toBeLessThanOrEqual(0.006);
  });

  test('the phase is found when its range is less than a period (two-parameter grid)', () => {
    // `c` over [0, 3] does not cover a period, so the scan cannot solve it
    // by least squares and samples it on the grid, reduced to fit the budget.
    const { xs, ys } = dense(200, 2.2);
    const rec = globalFit(xs, ys, { b: [0.3, HI_200], c: [0, 3] });
    expect(rss(rec)).toBeLessThanOrEqual(1e-12);
    expect(param(rec, 'c')).toBeGreaterThanOrEqual(0);
    expect(param(rec, 'c')).toBeLessThanOrEqual(3);
  });

  test('a non-positive amplitude bound reports a negative amplitude', () => {
    const { xs, ys } = dense(200, 2.2);
    const rec = globalFit(xs, ys, { b: [0.3, 120], c: [0, 2 * Math.PI] }, [
      'List',
      ['Tuple', 'a', -1, 'NegativeInfinity', 0],
      'b',
      'c',
      'd',
    ]);
    expect(rss(rec)).toBeLessThanOrEqual(1e-12);
    expect(param(rec, 'a')).toBeCloseTo(-2, 9);
    // −2 cos(2.2 x + 0.5 + π) = 2 cos(2.2 x + 0.5)
    expect(param(rec, 'c')).toBeCloseTo(0.5 + Math.PI, 9);
  });

  test('a phase range wider than a period gives a phase inside it', () => {
    const { xs, ys } = dense(200, 2.2);
    const rec = globalFit(xs, ys, { b: [0.3, 120], c: [-10, -3] });
    expect(rss(rec)).toBeLessThanOrEqual(1e-12);
    expect(param(rec, 'c')).toBeCloseTo(0.5 - 2 * Math.PI, 9);
  });

  test('only the phase searched: the scan is one point, solved exactly', () => {
    // With the frequency a constant, the model is linear in `a` and `d`, and
    // the phase is solved with them: the grid has no parameter left.
    const { xs, ys } = dense(200, 2.2);
    const rec = ce
      .box([
        'FindFit',
        dataOf(xs, ys),
        [
          'Add',
          ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 2.2, 'x'], 'c']]],
          ['Multiply', 'd', 'x'],
          'ExponentialE',
        ],
        ['List', 'a', 'c', 'd'],
        ['List', 'x'],
        { dict: { global: { dict: { c: [0, 2 * Math.PI] } } } },
      ] as any)
      .evaluate();
    expect(converged(rec)).toBe(true);
    expect(rss(rec)).toBeLessThanOrEqual(1e-12);
    expect(param(rec, 'c')).toBeCloseTo(0.5, 9);
  });
});

describe('FindFit global grid: the phase solved by least squares', () => {
  /** `a cos(b x + c) + d x` (or `Sin` with `fn`) on `n` exact points evenly
   * spaced over `[0, span]`, from `a = 2`, `d = 0.1`, the frequency `b` and
   * the phase `c`. */
  const fitPhase = (
    n: number,
    span: number,
    b: number,
    c: number,
    ranges: Record<string, number[]>,
    fn: 'Cos' | 'Sin' = 'Cos'
  ): BoxedExpression => {
    const g = fn === 'Cos' ? Math.cos : Math.sin;
    const xs = Array.from({ length: n }, (_, i) => (span * i) / (n - 1));
    const ys = xs.map((x) => 2 * g(b * x + c) + 0.1 * x);
    return ce
      .box([
        'FindFit',
        dataOf(xs, ys),
        [
          'Add',
          ['Multiply', 'a', [fn, ['Add', ['Multiply', 'b', 'x'], 'c']]],
          ['Multiply', 'd', 'x'],
        ],
        PARAMS,
        ['List', 'x'],
        { dict: { global: { dict: ranges } } },
      ] as any)
      .evaluate();
  };

  test('a phase near the end of its range is refined across it', () => {
    // The scan's frequency is off by up to half a basin, so its phase is off
    // too; with the true phase 6.2 near 2π, the scan's phase can be near 0.
    // A refinement bounded to [0, 2π] stopped at the bound (residual norm
    // about 0.8 for these frequencies). A frequency near 125 − b, an alias
    // of b on these evenly spaced points, is a correct answer too.
    for (const i of [0, 5, 6, 11]) {
      const b = 1 + (59 * i) / 39;
      const rec = fitPhase(200, 10, b, 6.2, {
        b: [0.3, 125],
        c: [0, 2 * Math.PI],
      });
      expect(residualNorm(rec)).toBeLessThan(1e-8);
      expect(param(rec, 'c')).toBeGreaterThanOrEqual(0);
      expect(param(rec, 'c')).toBeLessThanOrEqual(2 * Math.PI);
      expect(param(rec, 'a')).toBeGreaterThan(0);
    }
  });

  test('a phase over a large span of the variable', () => {
    // x in [0, 100]: an error of the scan's frequency moves the phase by up
    // to about 50 times that error.
    for (const b of [1 + 58 / 39, 12, 30.5]) {
      const rec = fitPhase(1000, 100, b, 0.5, {
        b: [0.3, 60],
        c: [0, 2 * Math.PI],
      });
      expect(residualNorm(rec)).toBeLessThan(1e-8);
      expect(param(rec, 'b')).toBeCloseTo(b, 9);
      expect(param(rec, 'c')).toBeCloseTo(0.5, 6);
    }
  });

  test('a sine', () => {
    const rec = fitPhase(
      200,
      10,
      7.3,
      1.2,
      {
        b: [0.3, 60],
        c: [0, 2 * Math.PI],
      },
      'Sin'
    );
    expect(converged(rec)).toBe(true);
    expect(residualNorm(rec)).toBeLessThan(1e-8);
    expect(param(rec, 'b')).toBeCloseTo(7.3, 9);
    expect(param(rec, 'a')).toBeCloseTo(2, 9);
    expect(param(rec, 'c')).toBeCloseTo(1.2, 9);
  });

  test('in degree mode (deciding 3)', () => {
    // The model reads its angles in degrees: the frequency and the phase of
    // the fit are those of deciding 3 converted to degrees.
    ce.angularUnit = 'deg';
    const deg = 180 / Math.PI;
    const { xs, ys } = dense(200, 2.2);
    const rec = globalFit(xs, ys, { b: [0.3 * deg, 120 * deg], c: [0, 360] });
    expect(rss(rec)).toBeLessThanOrEqual(1e-12);
    expect(param(rec, 'b') / deg).toBeCloseTo(2.2, 9);
    expect(param(rec, 'c') / deg).toBeCloseTo(0.5, 9);
  });

  test('a step on the phase keeps it on the grid', () => {
    // 795 points of `b` × 8 of `c`: within the budget.
    const { xs, ys } = dense(200, 2.2);
    const rec = globalFit(xs, ys, {
      b: [0.3, 40, 0.05],
      c: [0, 2 * Math.PI, 1],
    });
    expect(rss(rec)).toBeLessThanOrEqual(1e-12);
    expect(param(rec, 'c')).toBeCloseTo(0.5, 9);
  });
});

describe('FindFit global grid: a phase that is not a factor of the amplitude', () => {
  // `analyzeGlobalShape` gives no amplitude–phase pair for these models, so
  // the phase stays on the grid and the scan searches `b` and `c` together.
  const xs = Array.from({ length: 200 }, (_, i) => (10 * i) / 199);
  const fit = (model: any, ys: number[]) =>
    ce
      .box([
        'FindFit',
        dataOf(xs, ys),
        ['Add', model, ['Multiply', 'd', 'x']],
        PARAMS,
        ['List', 'x'],
        { dict: { global: { dict: { b: [0.3, 6], c: [0, 2 * Math.PI] } } } },
      ] as any)
      .evaluate();
  const arg = ['Add', ['Multiply', 'b', 'x'], 'c'];

  test('a cos(b x + c)²', () => {
    const ys = xs.map((x) => 2 * Math.cos(2.2 * x + 0.5) ** 2 + 0.1 * x);
    const rec = fit(['Multiply', 'a', ['Power', ['Cos', arg], 2]], ys);
    expect(residualNorm(rec)).toBeLessThan(1e-8);
    expect(param(rec, 'b')).toBeCloseTo(2.2, 9);
  });

  test('a e^{cos(b x + c)}', () => {
    const ys = xs.map((x) => 2 * Math.exp(Math.cos(2.2 * x + 0.5)) + 0.1 * x);
    const rec = fit(['Multiply', 'a', ['Exp', ['Cos', arg]]], ys);
    expect(residualNorm(rec)).toBeLessThan(1e-8);
    expect(param(rec, 'b')).toBeCloseTo(2.2, 9);
    expect(param(rec, 'c')).toBeCloseTo(0.5, 9);
  });
});

describe('FindFit global grid: an even power or an absolute value of a cosine', () => {
  // `a g(b x) + d x + e` with only `b` searched over [0.3, 300]. For
  // `g = cos`, the basin of `b` is π / span(x) = 0.314 wide and the grid has
  // 955 points 0.314 apart. `cos²` and `|cos|` have the period π, so their
  // basins are half as wide: the grid must have twice as many points (1,909,
  // 0.157 apart). The first three true `b` below are halfway between two
  // points of the 955-point grid, where that grid did not find them
  // (residual norm about 9). The last one is halfway between two points of
  // the 1,909-point grid, the farthest a true `b` can be from the grid now:
  // one point per basin of the period π is enough. The `x` are
  // moved off an even spacing, so no other frequency fits the points
  // exactly (on evenly spaced `x`, `b + π / gap` is an alias of `b`).
  const n = 200;
  const xs = Array.from({ length: n }, (_, i) => {
    const u = i > 0 && i < n - 1 ? 0.45 * Math.sin(i * 12.9898) : 0;
    return (10 * (i + u)) / (n - 1);
  });
  const fit = (g: any, f: (t: number) => number, b: number) =>
    ce
      .box([
        'FindFit',
        dataOf(
          xs,
          xs.map((x) => 2 * f(b * x) + 0.1 * x + Math.E)
        ),
        ['Add', ['Multiply', 'a', g], ['Multiply', 'd', 'x'], 'ExponentialE'],
        ['List', 'a', 'b', 'd'],
        ['List', 'x'],
        { dict: { global: { dict: { b: [0.3, 300] } } } },
      ] as any)
      .evaluate();
  const arg = ['Multiply', 'b', 'x'];
  const B = [3.598585, 31.87217, 220.362736, 0.3 + (21.5 * 299.7) / 1908];

  test('a cos(b x)²', () => {
    for (const b of B) {
      const rec = fit(['Power', ['Cos', arg], 2], (t) => Math.cos(t) ** 2, b);
      expect(residualNorm(rec)).toBeLessThan(1e-8);
      expect(param(rec, 'b')).toBeCloseTo(b, 9);
    }
  });

  test('a |cos(b x)|', () => {
    for (const b of B) {
      const rec = fit(['Abs', ['Cos', arg]], (t) => Math.abs(Math.cos(t)), b);
      expect(residualNorm(rec)).toBeLessThan(1e-8);
      expect(param(rec, 'b')).toBeCloseTo(b, 9);
    }
  });

  test('the 955-point grid of the period 2π finds a cos(b x)³', () => {
    for (const b of B.slice(0, 3)) {
      const rec = fit(['Power', ['Cos', arg], 3], (t) => Math.cos(t) ** 3, b);
      expect(residualNorm(rec)).toBeLessThan(1e-8);
      expect(param(rec, 'b')).toBeCloseTo(b, 9);
    }
  });
});

describe('FindFit global grid: the caller-given step', () => {
  test('a coarse step overrides the automatic spacing', () => {
    // Five points 30 apart: none falls in the basin of b = 2.2, which the
    // automatic spacing finds (deciding 3 above).
    const { xs, ys } = dense(200, 2.2);
    const rec = globalFit(xs, ys, { b: [0.3, 120, 30], c: [0, 2 * Math.PI] });
    expect(rss(rec)).toBeGreaterThan(1);
  });

  test('the multi-start keeps its coarse grid of 24 points whatever the step', () => {
    // `c` is not searched, so the model is not linear in the other
    // parameters: the solver runs from each grid point, and a step of 3
    // (two points) does not reduce that grid.
    const rec = globalFit(
      [1, 3.22, 5.27, 10.49, 7.12],
      [4.3, 1.18, 0.01, 1.48, 3.44],
      { b: [0.1, 6, 3] }
    );
    expect(rss(rec)).toBeLessThanOrEqual(0.006);
  });

  test('a fine step finds the fit of a model without a constant phase rate', () => {
    // `cos(x / b)`: the derivative of the phase with respect to `b` is not
    // constant, so the grid has the default 400 points unless a step is given.
    const xs = Array.from({ length: 200 }, (_, i) => (10 * i) / 199);
    const ys = xs.map((x) => 2 * Math.cos(x / 0.0537));
    const rec = ce
      .box([
        'FindFit',
        dataOf(xs, ys),
        ['Multiply', 'a', ['Cos', ['Divide', 'x', 'b']]],
        ['List', 'a', 'b'],
        ['List', 'x'],
        { dict: { global: { dict: { b: [0.04, 1, 0.0005] } } } },
      ] as any)
      .evaluate();
    expect(residualNorm(rec)).toBeLessThan(1e-9);
    expect(param(rec, 'b')).toBeCloseTo(0.0537, 9);
  });

  const STEP_DATA = () => {
    const xs = [0, 1, 2, 3, 4, 5];
    return dataOf(
      xs,
      xs.map((x) => 2 * Math.cos(2 * x))
    );
  };
  const STEP_MODEL = ['Multiply', 'a', ['Cos', ['Multiply', 'b', 'x']]];

  test('box route', () => {
    const rec = ce
      .box([
        'FindFit',
        STEP_DATA(),
        STEP_MODEL,
        ['List', 'a', 'b'],
        ['List', 'x'],
        { dict: { global: { dict: { b: [0.5, 3, 0.01] } } } },
      ] as any)
      .evaluate();
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'b')).toBeCloseTo(2, 9);
    expect(param(rec, 'a')).toBeCloseTo(2, 9);
  });

  test('function route', () => {
    const rec = ce
      .function('FindFit', [
        ce.box(STEP_DATA() as any),
        ce.box(STEP_MODEL as any),
        ce.box(['List', 'a', 'b']),
        ce.symbol('x'),
        ce.box({ dict: { global: { dict: { b: [0.5, 3, 0.01] } } } } as any),
      ])
      .evaluate();
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'b')).toBeCloseTo(2, 9);
  });

  const latexFit = (range: string) =>
    ce
      .parse(
        String.raw`\operatorname{FindFit}(\lbrack(0,2),(1,-0.832),(2,-1.307),(3,1.920),(4,-0.291),(5,-1.678)\rbrack, a\cos(b x), \lbrack a, b\rbrack, x, \operatorname{Dictionary}(\operatorname{KeyValuePair}(\text{global}, \operatorname{Dictionary}(\operatorname{KeyValuePair}(\text{b}, \lbrack ${range}\rbrack)))))`
      )
      .evaluate();

  test('parse route', () => {
    // The data are 2 cos(2x) rounded to three decimals.
    const rec = latexFit('0.5, 3, 0.01');
    expect(rec.operator).toBe('Dictionary');
    expect(param(rec, 'b')).toBeCloseTo(2, 3);
    expect(param(rec, 'a')).toBeCloseTo(2, 3);
  });

  test('parse route: a negative step is an error', () => {
    const rec = latexFit('0.5, 3, -1');
    expect(rec.operator).toBe('Error');
    expect(rec.op1.string ?? rec.op1.symbol).toBe('unexpected-argument');
  });

  describe('an invalid step is an error that names the parameter', () => {
    const cases: [string, any][] = [
      ['a zero step', { b: [0.5, 3, 0] }],
      ['a negative step', { b: [0.5, 3, -0.1] }],
      ['a step that is not a number', { b: [0.5, 3, 'z'] }],
      ['four elements', { b: [0.5, 3, 0.1, 1] }],
    ];
    for (const [label, ranges] of cases)
      test(label, () => {
        const rec = ce
          .box([
            'FindFit',
            STEP_DATA(),
            STEP_MODEL,
            ['List', 'a', 'b'],
            ['List', 'x'],
            { dict: { global: { dict: ranges } } },
          ] as any)
          .evaluate();
        expect(rec.operator).toBe('Error');
        expect(rec.op1.string ?? rec.op1.symbol).toBe('unexpected-argument');
        expect(rec.op2.string).toContain('"b"');
      });
  });

  test('two caller-given steps over the budget are an error', () => {
    const { xs, ys } = dense(20, 2.2);
    const rec = globalFit(xs, ys, {
      b: [0.3, 60, 0.01],
      c: [0, 6.3, 0.01],
    });
    expect(rec.operator).toBe('Error');
    expect(rec.op1.string ?? rec.op1.symbol).toBe('unexpected-argument');
    expect(rec.op2.string).toContain('"b"');
    expect(rec.op2.string).toContain('"c"');
  });

  test('two fine steps are not an error when the solver runs from a coarse grid', () => {
    // `c` is not searched, so the model is not linear in the other
    // parameters: the multi-start keeps its 6 × 6 grid and builds no grid
    // from the steps.
    const rec = globalFit(
      [1, 3.22, 5.27, 10.49, 7.12],
      [4.3, 1.18, 0.01, 1.48, 3.44],
      { b: [0.1, 6, 0.001], d: [-1, 1, 0.0001] }
    );
    expect(rec.operator).toBe('Dictionary');
    expect(Number.isFinite(residualNorm(rec))).toBe(true);
  });
});

describe('FindFit global grid: the grid counts and the budget', () => {
  const basin = Math.PI / 10;

  test('a basin width sets the count, not less than the default', () => {
    // 124.7 / (π / 10) = 396.9 → 398 points; the default is 400.
    expect(gridCounts([{ lo: 0.3, hi: 125, basin }], 400)).toEqual([400]);
    // [0.3, 628]: 627.7 / (π / 10) = 1998.04 → 2,000 points.
    expect(gridCounts([{ lo: 0.3, hi: 628, basin }], 400)).toEqual([2000]);
    // At most 4,000 points per parameter.
    expect(gridCounts([{ lo: 0, hi: 10000, basin }], 400)).toEqual([4000]);
    // No basin: the default.
    expect(gridCounts([{ lo: 0.3, hi: 628 }], 400)).toEqual([400]);
  });

  test('a caller-given step sets the count, between 2 and 4,000', () => {
    expect(gridCounts([{ lo: 0, hi: 1, step: 0.1 }], 400)).toEqual([11]);
    expect(gridCounts([{ lo: 0, hi: 1, step: 0.3 }], 400)).toEqual([5]);
    expect(gridCounts([{ lo: 0, hi: 1, step: 5 }], 400)).toEqual([2]);
    expect(gridCounts([{ lo: 0, hi: 1, step: 1e-6 }], 400)).toEqual([4000]);
    // The step wins over the basin width.
    expect(gridCounts([{ lo: 0.3, hi: 120, step: 30, basin }], 400)).toEqual([
      5,
    ]);
  });

  test('over the budget, the parameter without a basin width is reduced', () => {
    // 398 × 40 > 8,000: `c` (no basin width) goes to floor(8000 / 398) = 20.
    expect(
      gridCounts(
        [
          { lo: 0.3, hi: 125, basin },
          { lo: 0, hi: 2 * Math.PI },
        ],
        40
      )
    ).toEqual([398, 20]);
    // The same with the parameters in the other order.
    expect(
      gridCounts(
        [
          { lo: 0, hi: 2 * Math.PI },
          { lo: 0.3, hi: 125, basin },
        ],
        40
      )
    ).toEqual([20, 398]);
    // Both with a basin width: the second is reduced to 8, and since
    // 2,000 × 8 is still over the budget, the first to 8,000 / 8 = 1,000.
    expect(
      gridCounts(
        [
          { lo: 0, hi: 628, basin },
          { lo: 0, hi: 628, basin },
        ],
        40
      )
    ).toEqual([1000, 8]);
    expect(
      gridCounts(
        [
          { lo: 0, hi: 10000, basin },
          { lo: 0, hi: 10000, basin },
        ],
        40
      )
    ).toEqual([1000, 8]);
    // Under the budget nothing changes.
    expect(
      gridCounts(
        [
          { lo: 0.3, hi: 60, basin },
          { lo: 0, hi: 2 * Math.PI },
        ],
        40
      )
    ).toEqual([192, 40]);
  });

  test('a caller-given step is never reduced', () => {
    // 1,001 × 8 is over the budget: the other parameter goes below 8, to
    // floor(8000 / 1001) = 7.
    expect(
      gridCounts(
        [
          { lo: 0, hi: 1, step: 0.001 },
          { lo: 0.3, hi: 125, basin },
        ],
        40
      )
    ).toEqual([1001, 7]);
    // A step at the limit of 4,000 points leaves 2 for the other parameter.
    expect(
      gridCounts(
        [
          { lo: 0.3, hi: 125, basin },
          { lo: 0, hi: 1, step: 1e-6 },
        ],
        40
      )
    ).toEqual([2, 4000]);
    expect(
      gridCounts(
        [
          { lo: 0, hi: 1, step: 0.001 },
          { lo: 0, hi: 1, step: 0.001 },
        ],
        40
      )
    ).toBe('over-budget');
  });
});

describe('FindFit global grid: the phase rate of a parameter', () => {
  const shape = (model: any, vars: string[], params: string[]) =>
    analyzeGlobalShape(ce.box(model).canonical, vars, params);

  test('a cos(b x + c): b has rate 1 in x, and (a, c) is an amplitude–phase pair', () => {
    const s = shape(MODEL, ['x'], ['a', 'b', 'c', 'd']);
    expect(s.periodicRates).toEqual([
      { param: 1, variable: 0, rate: 1, period: 2 * Math.PI },
    ]);
    expect(s.phaseShapes).toEqual([{ amplitude: 0, phase: 2, rate: 1 }]);
    expect(s.mentions).toEqual([true, true, true, true]);
  });

  test('a constant factor of the argument is the rate', () => {
    const s = shape(
      ['Multiply', 'a', ['Sin', ['Multiply', 2, 'Pi', 'b', 'x']]],
      ['x'],
      ['a', 'b']
    );
    expect(s.periodicRates).toHaveLength(1);
    expect(s.periodicRates[0].rate).toBeCloseTo(2 * Math.PI, 12);
  });

  test('a rate that is not a constant is not recorded', () => {
    for (const arg of [
      ['Multiply', ['Power', 'b', 2], 'x'],
      ['Multiply', 'b', 'x', 'y'],
      ['Divide', 'x', 'b'],
    ]) {
      const s = shape(['Multiply', 'a', ['Cos', arg]], ['x', 'y'], ['a', 'b']);
      expect(s.periodicRates).toEqual([]);
    }
  });

  test('Tan and Cot record a period of π, the others 2π', () => {
    for (const [fn, period] of [
      ['Tan', Math.PI],
      ['Cot', Math.PI],
      ['Sin', 2 * Math.PI],
      ['Sec', 2 * Math.PI],
    ] as const) {
      const s = shape(
        ['Multiply', 'a', [fn, ['Multiply', 'b', 'x']]],
        ['x'],
        ['a', 'b']
      );
      expect(s.periodicRates).toEqual([
        { param: 1, variable: 0, rate: 1, period },
      ]);
    }
  });

  test('an even power, an absolute value or a product records the period π', () => {
    // The period is that of the expression the function node is part of:
    // cos(θ + π)² = cos(θ)², so the basins of `b` are half as wide.
    const arg = ['Add', ['Multiply', 'b', 'x'], 'c'];
    const period = (model: any) =>
      shape(model, ['x'], ['a', 'b', 'c']).periodicRates.map((r) => r.period);
    // a cos(b x + c)²
    expect(period(['Multiply', 'a', ['Power', ['Cos', arg], 2]])).toEqual([
      Math.PI,
    ]);
    // a |cos(b x + c)|
    expect(period(['Multiply', 'a', ['Abs', ['Cos', arg]]])).toEqual([Math.PI]);
    // |a cos(b x + c)|: the factor `a` does not change when θ moves by π
    expect(period(['Abs', ['Multiply', 'a', ['Cos', arg]]])).toEqual([Math.PI]);
    // a sin(b x + c)⁴ and a sec(b x + c)²
    expect(period(['Multiply', 'a', ['Power', ['Sin', arg], 4]])).toEqual([
      Math.PI,
    ]);
    expect(period(['Multiply', 'a', ['Power', ['Sec', arg], 2]])).toEqual([
      Math.PI,
    ]);
    // a cos(b x + c) cos(b x + c): two copies of the node, one rate each
    expect(period(['Multiply', 'a', ['Cos', arg], ['Cos', arg]])).toEqual([
      Math.PI,
      Math.PI,
    ]);
    // (−cos(b x + c)³)²: an odd power and a negation, then an even power
    expect(
      period(['Power', ['Negate', ['Power', ['Cos', arg], 3]], 2])
    ).toEqual([Math.PI]);
    // a sin θ cos θ = a sin(2θ) / 2
    expect(period(['Multiply', 'a', ['Sin', arg], ['Cos', arg]])).toEqual([
      Math.PI,
      Math.PI,
    ]);
    // sin θ / cos θ = tan θ
    expect(period(['Divide', ['Sin', arg], ['Cos', arg]])).toEqual([
      Math.PI,
      Math.PI,
    ]);
    // a cos θ · cos(θ)³ = a cos(θ)⁴ (the canonical form keeps two factors)
    expect(
      period(['Multiply', 'a', ['Cos', arg], ['Power', ['Cos', arg], 3]])
    ).toEqual([Math.PI, Math.PI]);
  });

  test('(sin θ cos θ)² and |sin θ cos θ| record the period π/2', () => {
    // sin(θ + π/2) cos(θ + π/2) = −cos θ sin θ
    const f = (t: number) => (Math.sin(t) * Math.cos(t)) ** 2;
    for (const t of [0.3, 1.1, 2.7])
      expect(f(t + Math.PI / 2)).toBeCloseTo(f(t), 14);
    expect(f(0.3 + Math.PI / 4)).not.toBeCloseTo(f(0.3), 2);
    const arg = ['Add', ['Multiply', 'b', 'x'], 'c'];
    const sinCos = ['Multiply', ['Sin', arg], ['Cos', arg]];
    for (const model of [
      ['Multiply', 'a', ['Power', sinCos, 2]],
      ['Abs', ['Multiply', 'a', ...sinCos.slice(1)]],
    ]) {
      expect(
        shape(model, ['x'], ['a', 'b', 'c']).periodicRates.map((r) => r.period)
      ).toEqual([Math.PI / 2, Math.PI / 2]);
    }
  });

  test('tan² keeps the period π of tan', () => {
    // tan(θ + π/2) = −cot(θ), so tan(θ)² does not have the period π/2:
    // at θ = 0.3, tan² is 0.0957 and tan²(θ + π/2) is 10.45.
    expect(Math.tan(0.3) ** 2).toBeCloseTo(0.0957, 4);
    expect(Math.tan(0.3 + Math.PI / 2) ** 2).toBeCloseTo(10.45, 2);
    const arg = ['Multiply', 'b', 'x'];
    for (const model of [
      ['Multiply', 'a', ['Power', ['Tan', arg], 2]],
      ['Multiply', 'a', ['Abs', ['Cot', arg]]],
    ]) {
      expect(shape(model, ['x'], ['a', 'b']).periodicRates).toEqual([
        { param: 1, variable: 0, rate: 1, period: Math.PI },
      ]);
    }
  });

  test('an odd power, a non-integer power or another function keeps the period of the function', () => {
    const arg = ['Add', ['Multiply', 'b', 'x'], 'c'];
    for (const model of [
      // a cos(b x + c)³: cos(θ + π)³ = −cos(θ)³
      ['Multiply', 'a', ['Power', ['Cos', arg], 3]],
      // a / cos(b x + c)
      ['Divide', 'a', ['Cos', arg]],
      // a √cos(b x + c)
      ['Multiply', 'a', ['Sqrt', ['Cos', arg]]],
      // a e^{cos(b x + c)}
      ['Multiply', 'a', ['Exp', ['Cos', arg]]],
      // a sec(b x + c)
      ['Multiply', 'a', ['Sec', arg]],
    ]) {
      const s = shape(model, ['x'], ['a', 'b', 'c']);
      expect(s.periodicRates.length).toBeGreaterThan(0);
      for (const r of s.periodicRates) expect(r.period).toBe(2 * Math.PI);
    }
  });

  test('in degree mode the rates are converted to radians', () => {
    ce.angularUnit = 'deg';
    const s = shape(MODEL, ['x'], ['a', 'b', 'c', 'd']);
    expect(s.periodicRates).toHaveLength(1);
    expect(s.periodicRates[0].rate).toBeCloseTo(Math.PI / 180, 15);
    expect(s.phaseShapes).toHaveLength(1);
    expect(s.phaseShapes[0].rate).toBeCloseTo(Math.PI / 180, 15);
  });

  test('a cosine that is not a direct factor of the amplitude is not a pair', () => {
    const arg = ['Add', ['Multiply', 'b', 'x'], 'c'];
    // a cos(b x + c)²
    const squared = shape(
      ['Multiply', 'a', ['Power', ['Cos', arg], 2]],
      ['x'],
      ['a', 'b', 'c']
    );
    expect(squared.phaseShapes).toEqual([]);
    expect(squared.periodicRates).toHaveLength(1);
    // a e^{cos(b x + c)}
    const exponential = shape(
      ['Multiply', 'a', ['Exp', ['Cos', arg]]],
      ['x'],
      ['a', 'b', 'c']
    );
    expect(exponential.phaseShapes).toEqual([]);
    expect(exponential.periodicRates).toHaveLength(1);
  });

  test('a hyperbolic function and a non-periodic model record no rate', () => {
    expect(
      shape(
        ['Multiply', 'a', ['Cosh', ['Multiply', 'b', 'x']]],
        ['x'],
        ['a', 'b']
      ).periodicRates
    ).toEqual([]);
    expect(
      shape(
        ['Add', ['Multiply', 'a', ['Exp', ['Multiply', 'b', 'x']]], 'c'],
        ['x'],
        ['a', 'b', 'c']
      ).periodicRates
    ).toEqual([]);
  });

  test('a phase that appears elsewhere, or an amplitude that does, is not a pair', () => {
    const cosine = ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']];
    expect(
      shape(['Add', ['Multiply', 'a', cosine], 'c'], ['x'], ['a', 'b', 'c'])
        .phaseShapes
    ).toEqual([]);
    expect(
      shape(
        ['Add', ['Multiply', 'a', cosine], ['Multiply', 'a', 'x']],
        ['x'],
        ['a', 'b', 'c']
      ).phaseShapes
    ).toEqual([]);
    // Another factor of the product is allowed: a x sin(b x + 2c).
    expect(
      shape(
        [
          'Multiply',
          'a',
          'x',
          ['Sin', ['Add', ['Multiply', 'b', 'x'], ['Multiply', 2, 'c']]],
        ],
        ['x'],
        ['a', 'b', 'c']
      ).phaseShapes
    ).toEqual([{ amplitude: 0, phase: 2, rate: 2 }]);
  });
});

describe('FindFit global grid: models without a constant phase rate keep the default grid', () => {
  // The reference records were computed before the basin-aware spacing
  // existed (main `6d5c6d542`): these models must give the same answer.

  test('a non-periodic model: a e^{b x} + c with b searched', () => {
    const xs = Array.from({ length: 40 }, (_, i) => i * 0.1);
    const ys = xs.map(
      (x) => 1.5 * Math.exp(0.7 * x) + 0.3 + 0.01 * Math.sin(7 * x)
    );
    const rec = ce
      .box([
        'FindFit',
        dataOf(xs, ys),
        ['Add', ['Multiply', 'a', ['Exp', ['Multiply', 'b', 'x']]], 'c'],
        ['List', 'a', 'b', 'c'],
        ['List', 'x'],
        { dict: { global: { dict: { b: [-2, 2] } } } },
      ] as any)
      .evaluate();
    expect(param(rec, 'a')).toBeCloseTo(1.4965754157171696, 9);
    expect(param(rec, 'b')).toBeCloseTo(0.7005823786813601, 9);
    expect(param(rec, 'c')).toBeCloseTo(0.30596097035403286, 9);
    expect(residualNorm(rec)).toBeCloseTo(0.04348359866282177, 12);
    expect(Number(rec.get('iterations')?.re)).toBe(7);
  });

  test('a rate that is not a constant: a cos(b² x) with b searched', () => {
    const xs = Array.from({ length: 60 }, (_, i) => i * 0.1);
    const ys = xs.map((x) => 2 * Math.cos(2.25 * x) + 0.02 * Math.sin(5 * x));
    const rec = ce
      .box([
        'FindFit',
        dataOf(xs, ys),
        ['Multiply', 'a', ['Cos', ['Multiply', ['Power', 'b', 2], 'x']]],
        ['List', 'a', 'b'],
        ['List', 'x'],
        { dict: { global: { dict: { b: [0.5, 3] } } } },
      ] as any)
      .evaluate();
    expect(param(rec, 'a')).toBeCloseTo(2.0022036255974958, 9);
    expect(param(rec, 'b')).toBeCloseTo(1.500050209055491, 9);
    expect(residualNorm(rec)).toBeCloseTo(0.10807812817364457, 12);
    expect(Number(rec.get('iterations')?.re)).toBe(140);
  });
});

describe('FindFit global grid: the scan on a sample of the rows', () => {
  test('the sample is stratified, keeps the first and last rows, and is deterministic', () => {
    for (const n of [1000, 2991]) {
      const s = sampleRowIndices(n, 300);
      expect(s).toHaveLength(300);
      expect(s[0]).toBe(0);
      expect(s[299]).toBe(n - 1);
      for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
      // One row in each stratum of about n / 300 rows.
      for (let i = 1; i < s.length - 1; i++) {
        expect(s[i]).toBeGreaterThanOrEqual(Math.floor((i * n) / 300));
        expect(s[i]).toBeLessThan(Math.floor(((i + 1) * n) / 300));
      }
      expect(sampleRowIndices(n, 300)).toEqual(s);
    }
    // 2,991 = 299 × 10 + 1 rows: every 10th row would be a regular sub-grid;
    // the gaps of the sample are not all equal.
    const s = sampleRowIndices(2991, 300);
    const gaps = new Set(s.slice(1).map((v, i) => v - s[i]));
    expect(gaps.size).toBeGreaterThan(5);
    expect(sampleRowIndices(5, 300)).toEqual([0, 1, 2, 3, 4]);
  });

  test('the sampled rows are shared among the datasets by largest remainder', () => {
    expect(sampleRowCounts([400, 400], 300)).toEqual([150, 150]);
    expect(sampleRowCounts([1000, 1], 300)).toEqual([300, 0]);
    // Shares 99.67, 99.67, 99.67 and 0.997: the largest remainder is the
    // small dataset's, then the first two.
    expect(sampleRowCounts([100, 100, 100, 1], 300)).toEqual([100, 100, 99, 1]);
    // 500 datasets of 2 rows: 300 of them get one row, the others none.
    const small = sampleRowCounts(new Array(500).fill(2), 300);
    expect(small.reduce((n, c) => n + c, 0)).toBe(300);
    expect(small.every((c) => c === 0 || c === 1)).toBe(true);
    // The total is never exceeded.
    const mixed = sampleRowCounts([7, 13, 251, 3, 99], 300);
    expect(mixed.reduce((n, c) => n + c, 0)).toBe(300);
    // Fewer rows than the sample: every row.
    expect(sampleRowCounts([100, 50], 300)).toEqual([100, 50]);
  });

  test('the sample is not a regular sub-grid of evenly spaced rows', () => {
    // 2,991 rows over [0, 100]: a sample of every 10th row is evenly spaced
    // 1/3 apart, and a frequency that differs from the true one by a
    // multiple of 2π / (1/3) ≈ 18.85 fits those rows exactly. The scan then
    // could not tell b = 50 from 43.9 or 68.8.
    const n = 2991;
    const xs = Array.from({ length: n }, (_, i) => (100 * i) / (n - 1));
    for (const b of [50, 71.7]) {
      const ys = xs.map((x) => 2 * Math.cos(b * x + 0.5) + 0.1 * x);
      const rec = ce
        .box([
          'FindFit',
          dataOf(xs, ys),
          [
            'Add',
            ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
            ['Multiply', 'd', 'x'],
          ],
          PARAMS,
          ['List', 'x'],
          {
            dict: {
              global: { dict: { b: [0.3, 90], c: [-Math.PI, 3 * Math.PI] } },
            },
          },
        ] as any)
        .evaluate();
      expect(residualNorm(rec)).toBeLessThan(1e-8);
      expect(param(rec, 'b')).toBeCloseTo(b, 9);
    }
  });

  test('a sampled scan reaches the same fit as a scan on every row', () => {
    // 300 rows: no sample. 900 rows: the scan runs on 300 of them and the
    // refinement on all 900.
    const ranges = { b: [0.3, 120], c: [0, 2 * Math.PI] };
    const small = dense(300, 2.2);
    const large = dense(900, 2.2);
    const recSmall = globalFit(small.xs, small.ys, ranges);
    const recLarge = globalFit(large.xs, large.ys, ranges);
    for (const rec of [recSmall, recLarge]) {
      expect(converged(rec)).toBe(true);
      expect(rss(rec)).toBeLessThanOrEqual(1e-12);
    }
    for (const name of ['a', 'b', 'c', 'd'])
      expect(param(recLarge, name)).toBeCloseTo(param(recSmall, name), 9);
    // The same inputs give the same record.
    expect(globalFit(large.xs, large.ys, ranges).isSame(recLarge)).toBe(true);
  });

  test('a joint fit is sampled per dataset', () => {
    // Two datasets of 400 rows (800 in total): each contributes 150 rows to
    // the scan. The second model mentions neither the amplitude nor the
    // phase of the first, so the phase is still solved by least squares.
    const xs = Array.from({ length: 400 }, (_, i) => (10 * i) / 399);
    const first = xs.map((x) => ['Tuple', x, 2 * Math.cos(7.3 * x + 0.5)]);
    const second = xs.map((x) => ['Tuple', x, 0.1 * x]);
    const rec = ce
      .box([
        'FindFit',
        ['List', ['List', ...first], ['List', ...second]],
        [
          'List',
          ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
          ['Multiply', 'd', 'x'],
        ],
        PARAMS,
        ['List', 'x'],
        { dict: { global: { dict: { b: [0.3, 100], c: [0, 2 * Math.PI] } } } },
      ] as any)
      .evaluate();
    expect(rss(rec)).toBeLessThanOrEqual(1e-12);
    expect(param(rec, 'b')).toBeCloseTo(7.3, 9);
    expect(param(rec, 'd')).toBeCloseTo(0.1, 9);
  });

  test('a deadline during a sampled scan returns the best scanned point with timedOut: True and no residual', () => {
    // The interpreted per-row route makes each grid point slow, so a short
    // budget expires during the scan of 1,000 rows (sampled to 300).
    (ce as any).jit = 'off';
    const { xs, ys } = dense(1000, 2.2);
    const data = ce.box(dataOf(xs, ys) as any);
    const model = ce.box(MODEL as any);
    const params = ce.box(PARAMS);
    const options = ce.box({
      dict: { global: { dict: { b: [0.3, 120], c: [0, 2 * Math.PI] } } },
    } as any);
    const fit = (ms: number) =>
      ce.withTimeLimit({ ms, label: 'test:sampled-scan-budget' }, () =>
        ce
          .function('FindFit', [data, model, params, ce.symbol('x'), options])
          .evaluate()
      );
    // Raise the budget until the setup fits in it; the first such budget is
    // still far too short for the scan of 400 interpreted grid points.
    let r = fit(200);
    for (const ms of [800, 3200]) {
      if (r.get('phase')?.string !== 'setup') break;
      r = fit(ms);
    }
    expect(r.operator).toBe('Dictionary');
    expect(r.get('timedOut')?.symbol).toBe('True');
    expect(r.get('phase')?.string).toBe('solve');
    expect(converged(r)).toBe(false);
    for (const name of ['a', 'b', 'c', 'd'])
      expect(Number.isFinite(param(r, name))).toBe(true);
    // The residual of the scanned point was computed on the sample of the
    // rows, not on every row, so the record does not report one.
    expect(Number.isNaN(residualNorm(r))).toBe(true);
  });
});
