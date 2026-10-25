/**
 * Tycho ledger rows 414, 415 and 408 (`~/dev/tycho/docs/COMPUTE_ENGINE.md`,
 * filed 2026-10-20 and 2026-10-21 on CE 0.158.0 and 0.159.0):
 *
 * - 414: `FindRoot` reported `converged: True` at a point that is not a
 *   root (`a^2 + 1 = 0`, residual norm 1). `converged` is now true only
 *   when the residual norm is within the engine's tolerance scaled by the
 *   system; the record gains `stationary`, the solver's own stop test.
 * - 415: `FindRoot` did not move a parameter read through `PointX` of a
 *   point: the symbolic derivative of `PointX(PointList(2a, 2))` was a type
 *   error that compiled to a Jacobian of NaN.
 * - 408: `FindRoot` takes the options dictionary of `FindFit`
 *   (`{global: {b: [lo, hi]}}`).
 *
 * The cases follow Tycho's instruments
 * (`scripts/repros/2026-10-21-ce414-findroot-converged-at-non-root-repro.mts`,
 * `…ce415-findroot-pointx-jacobian-repro.mts`,
 * `2026-10-20-ce408-findroot-global-option-repro.mts`), through the box
 * route the instruments take.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const ce = new ComputeEngine();

const field = (rec: Expression, key: string): Expression | undefined =>
  (rec as any).get(key);
const param = (rec: Expression, name: string): number =>
  field(field(rec, 'parameters')!, name)!.re;
const flag = (rec: Expression, key: string): boolean | undefined => {
  const v = field(rec, key);
  if (v === undefined) return undefined;
  return (v as any).symbol === 'True';
};
const residualNorm = (rec: Expression): number =>
  field(rec, 'residualNorm')!.re;

/** `FindRoot` through the box route, with an optional options argument. */
const findRoot = (
  equations: unknown,
  params: unknown,
  options?: unknown
): Expression =>
  ce
    .box([
      'FindRoot',
      equations,
      params,
      ...(options === undefined ? [] : [options]),
    ] as any)
    .evaluate();

const oneParam = (equation: unknown, start = 1): Expression =>
  findRoot(['List', equation], ['List', ['Tuple', 'a', start]]);

describe('row 414: `converged` is true only at a root', () => {
  test('a^2 + 1 = 0 has no real root: converged false, stationary true', () => {
    const rec = oneParam(['Equal', ['Add', ['Square', 'a'], 1], 0]);
    expect(flag(rec, 'converged')).toBe(false);
    expect(flag(rec, 'stationary')).toBe(true);
    expect(residualNorm(rec)).toBeCloseTo(1, 10);
    expect(Math.abs(param(rec, 'a'))).toBeLessThan(1e-6);
  });

  test('a^2 - 4 = 0 has a root: converged true', () => {
    const rec = oneParam(['Equal', ['Add', ['Square', 'a'], -4], 0]);
    expect(flag(rec, 'converged')).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(2, 8);
  });

  test('a residual scaled small is solved to its root, not stopped at the start', () => {
    // The absolute gradient tolerance of the solver passes at every point
    // of `10^{-6} (a^2 - 4)`: the old solve stopped at `a = 1` with
    // `converged: True` and `iterations: 0`.
    const rec = oneParam([
      'Equal',
      ['Multiply', 1e-6, ['Add', ['Square', 'a'], -4]],
      0,
    ]);
    expect(flag(rec, 'converged')).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(2, 5);
    expect(field(rec, 'iterations')!.re).toBeGreaterThan(0);
  });

  test('a residual scaled large is a root to the relative tolerance', () => {
    // `a^2 = 10^12` from `a = 1`: at the root the residual is
    // `2 · 10^6 · δa`, far above an absolute tolerance for the last
    // digits of `a`; the relative part of the test, `‖J‖ · max(1, ‖θ‖)`,
    // admits it.
    const rec = oneParam(['Equal', ['Square', 'a'], 1e12]);
    expect(flag(rec, 'converged')).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(1e6, 0);
  });

  test('a double root converges', () => {
    const rec = oneParam(['Equal', ['Square', ['Subtract', 'a', 2]], 0]);
    expect(flag(rec, 'converged')).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(2, 4);
  });

  test('a residual below the tolerance everywhere is not a root', () => {
    // `a^2 + 10^{-7} = 0`: the minimum of the residual is `10^{-7}`,
    // above the engine's tolerance.
    const rec = oneParam(['Equal', ['Add', ['Square', 'a'], 1e-7], 0]);
    expect(flag(rec, 'converged')).toBe(false);
    expect(flag(rec, 'stationary')).toBe(true);
  });

  test('a steep equation is polished past the first point within the bound', () => {
    // `10^12 x = 3 · 10^12` from `x = 1`: the first point within the root
    // tolerance has a residual of about 74 (x correct to 1e-11 relative);
    // the solve goes on until the step stalls, where the residual is about
    // 0.002, as before this change.
    const rec = findRoot(
      ['List', ['Equal', ['Multiply', 1e12, 'x'], 3e12]],
      ['List', ['Tuple', 'x', 1]]
    );
    expect(flag(rec, 'converged')).toBe(true);
    expect(flag(rec, 'stationary')).toBe(true);
    expect(residualNorm(rec)).toBeLessThan(1);
    expect(param(rec, 'x')).toBeCloseTo(3, 10);
  });

  test('a root reports the stationarity of the point it was found at', () => {
    const rec = oneParam(['Equal', ['Subtract', 'a', 2], 0]);
    expect(flag(rec, 'converged')).toBe(true);
    expect(flag(rec, 'stationary')).toBe(true);
  });

  test('each equation is tested against its own scale', () => {
    // A large parameter of one equation, or a steep equation, must not
    // raise the allowance of another equation: with one scale for the whole
    // system these two reported a root at the start, with 0 iterations.
    const two = (eqs: unknown[], starts: [number, number]) =>
      findRoot(
        ['List', ...eqs],
        ['List', ['Tuple', 'a', starts[0]], ['Tuple', 'b', starts[1]]]
      );
    const large = two(
      [
        ['Equal', ['Square', 'a'], 4],
        ['Equal', 'b', 1e11],
      ],
      [1, 1e11]
    );
    expect(flag(large, 'converged')).toBe(true);
    expect(param(large, 'a')).toBeCloseTo(2, 6);
    expect(field(large, 'iterations')!.re).toBeGreaterThan(0);
    const steep = two(
      [
        ['Equal', ['Add', ['Square', 'a'], 1], 0],
        ['Equal', ['Multiply', 1e12, 'b'], 0],
      ],
      [0, 0]
    );
    expect(flag(steep, 'converged')).toBe(false);
  });

  test('an infinite Jacobian entry at the start is not a root', () => {
    // `√a = 1` from `a = 0`: the derivative `1 / (2√a)` is infinite there,
    // and the residual is 1. A root test that read the infinite scale as
    // an allowance reported a root at the start. The solver cannot move
    // from an infinite Jacobian (the main tree gives the same record), so
    // the honest record is the start point, not converged.
    const rec = oneParam(['Equal', ['Sqrt', 'a'], 1], 0);
    expect(flag(rec, 'converged')).toBe(false);
    expect(param(rec, 'a')).toBe(0);
    // From inside the domain the root is found.
    const inside = oneParam(['Equal', ['Sqrt', 'a'], 1], 0.5);
    expect(flag(inside, 'converged')).toBe(true);
    expect(param(inside, 'a')).toBeCloseTo(1, 6);
  });

  test('an engine tolerance below what doubles resolve still reports a root', () => {
    const strict = new ComputeEngine();
    strict.tolerance = 1e-30;
    const rec = strict
      .box([
        'FindRoot',
        ['List', ['Equal', ['Square', 'a'], 2]],
        ['List', ['Tuple', 'a', 1]],
      ] as any)
      .evaluate();
    expect(flag(rec, 'converged')).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(Math.SQRT2, 10);
  });

  test('the `FindFit` record has no `stationary` key', () => {
    const rec = ce
      .box([
        'FindFit',
        ['List', ['Tuple', 1, 2.1], ['Tuple', 2, 3.9], ['Tuple', 3, 6.2]],
        ['Add', ['Multiply', 'm', 'x'], 'k'],
        ['List', 'm', 'k'],
        ['List', 'x'],
      ] as any)
      .evaluate();
    expect(flag(rec, 'converged')).toBe(true);
    expect(field(rec, 'stationary')).toBeUndefined();
  });
});

describe('row 415: a parameter read through an accessor of a point', () => {
  test('PointX(PointList(2a, 2)) = 4 solves a = 2 as 2a = 4 does', () => {
    const point = findRoot(
      [
        'List',
        ['Equal', ['PointX', ['PointList', ['Multiply', 2, 'a'], 2]], 4],
      ],
      ['List', 'a']
    );
    const control = findRoot(
      ['List', ['Equal', ['Multiply', 2, 'a'], 4]],
      ['List', 'a']
    );
    expect(flag(point, 'converged')).toBe(true);
    expect(param(point, 'a')).toBeCloseTo(2, 6);
    expect(field(point, 'iterations')!.re).toBe(
      field(control, 'iterations')!.re
    );
  });

  test('PointY of a tuple and At with a literal index', () => {
    const y = findRoot(
      [
        'List',
        [
          'Equal',
          ['PointY', ['Tuple', ['Multiply', 2, 'a'], ['Square', 'a']]],
          9,
        ],
      ],
      ['List', 'a']
    );
    expect(flag(y, 'converged')).toBe(true);
    expect(param(y, 'a')).toBeCloseTo(3, 6);
    const at = findRoot(
      [
        'List',
        [
          'Equal',
          ['At', ['Tuple', ['Multiply', 2, 'a'], ['Square', 'a']], 2],
          9,
        ],
      ],
      ['List', 'a']
    );
    expect(flag(at, 'converged')).toBe(true);
    expect(param(at, 'a')).toBeCloseTo(3, 6);
  });

  test('D differentiates the accessor through the selected operand', () => {
    const d = (expr: unknown) =>
      ce
        .box(['D', expr, 'a'] as any)
        .evaluate()
        .toString();
    expect(d(['PointX', ['PointList', ['Multiply', 2, 'a'], 2]])).toBe('2');
    expect(
      d(['PointY', ['Tuple', ['Multiply', 2, 'a'], ['Square', 'a']]])
    ).toBe('2a');
    expect(d(['At', ['Tuple', ['Multiply', 2, 'a'], ['Square', 'a']], 2])).toBe(
      '2a'
    );
    // A negative index counts from the end, as `At` reads it.
    expect(d(['At', ['List', ['Multiply', 2, 'a'], ['Square', 'a']], -1])).toBe(
      '2a'
    );
    expect(d(['At', ['List', ['Multiply', 2, 'a'], ['Square', 'a']], 1])).toBe(
      '2'
    );
  });

  test('a PointList with a collection component is a zipped list, not a point', () => {
    // `PointList([a, 2a], 5)` is `[(a, 5), (2a, 5)]`: its first element is
    // the point `(a, 5)`, not the list `[a, 2a]`, so the accessor rule does
    // not read the operands as the elements. The derivative evaluates the
    // zip first.
    const d = (expr: unknown) =>
      ce
        .box(['D', expr, 'a'] as any)
        .evaluate()
        .toString();
    expect(
      d(['At', ['PointList', ['List', 'a', ['Multiply', 2, 'a']], 5], 1])
    ).toBe('(1, 0)');
    expect(
      d(['PointY', ['PointList', ['List', 1, 2, 3], ['Multiply', 2, 'a']]])
    ).toBe('[2,2,2]');
  });
});

describe('row 408: the `global` option of `FindRoot`', () => {
  // The five points of the Desmos graph `neyret/5hn1azxfc8` as equations
  // `a cos(b x_i + c) + d x_i + e = y_i` (CE reads `e` as Euler's number),
  // plus the equation `d = 0`. The lowest sum of squared residuals of the
  // whole system with `b` in [0.1, 6] is 0.04383 (b = 2.171); the plain
  // solve from the default start gives the period-8 fit, 0.3687.
  const X = [1, 3.22, 5.27, 10.49, 7.12];
  const Y = [4.3, 1.18, 0.01, 1.48, 3.44];
  const model = (x: number): unknown => [
    'Add',
    ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', x], 'c']]],
    ['Multiply', 'd', x],
    'ExponentialE',
  ];
  const EQUATIONS = [
    'List',
    ...X.map((x, i) => ['Equal', model(x), Y[i]]),
    ['Equal', 'd', 0],
  ];
  const PARAMS = ['List', 'a', 'b', 'c', 'd'];
  const rss = (rec: Expression) => residualNorm(rec) ** 2;

  test('the search over b in [0.1, 6] finds the lowest residual of the system', () => {
    const rec = findRoot(EQUATIONS, PARAMS, {
      dict: { global: { dict: { b: [0.1, 6] } } },
    });
    expect(rec.operator).toBe('Dictionary');
    expect(rss(rec)).toBeGreaterThanOrEqual(0.043);
    expect(rss(rec)).toBeLessThanOrEqual(0.0445);
    expect(param(rec, 'b')).toBeGreaterThanOrEqual(2.1);
    expect(param(rec, 'b')).toBeLessThanOrEqual(2.25);
    // The record of a stacked system: the misfit is not zero, so it is not
    // a root; the solver settled.
    expect(flag(rec, 'converged')).toBe(false);
    expect(flag(rec, 'stationary')).toBe(true);
    for (const name of ['a', 'b', 'c', 'd'])
      expect(Number.isFinite(param(rec, name))).toBe(true);
  });

  test('without the option the default start gives the period-8 local fit', () => {
    const rec = findRoot(EQUATIONS, PARAMS);
    expect(rss(rec)).toBeGreaterThanOrEqual(0.36);
    expect(rss(rec)).toBeLessThanOrEqual(0.38);
  });

  test('`evaluateAsync` gives the same record', async () => {
    const rec = await ce
      .box([
        'FindRoot',
        EQUATIONS,
        PARAMS,
        { dict: { global: { dict: { b: [0.1, 6] } } } },
      ] as any)
      .evaluateAsync();
    expect(param(rec, 'b')).toBeGreaterThanOrEqual(2.1);
    expect(param(rec, 'b')).toBeLessThanOrEqual(2.25);
  });

  test('a malformed option is an error that names FindRoot', () => {
    const rec = findRoot(EQUATIONS, PARAMS, {
      dict: { global: { dict: { z: [0.1, 6] } } },
    });
    expect(rec.operator).toBe('Error');
    expect(rec.toString()).toContain('FindRoot:');
    expect(rec.toString()).toContain('z');
    expect(rec.toString()).toContain('is not a parameter');
  });

  test('the constant phase coefficients of the equations space the grid by the basin', () => {
    // Sixty exact rows of `2 cos(2.2 x + 0.5) + 0.1 x + e` on [0, 10] as
    // equations, `b` searched over [0.3, 60] and `c` over one period. The
    // basin of the true frequency is about π / 10 wide; a grid of 400 fixed
    // points over [0.3, 60] has a step of 0.15, and the span of the
    // coefficients `x_i` gives a step of at most π / 10 = 0.31 in any case,
    // so this also runs the separable scan on a system of equations.
    const n = 60;
    const xs = Array.from({ length: n }, (_, i) => (10 * i) / (n - 1));
    const ys = xs.map((x) => 2 * Math.cos(2.2 * x + 0.5) + 0.1 * x + Math.E);
    const rec = findRoot(
      ['List', ...xs.map((x, i) => ['Equal', model(x), ys[i]])],
      PARAMS,
      { dict: { global: { dict: { b: [0.3, 60], c: [0, 2 * Math.PI] } } } }
    );
    expect(flag(rec, 'converged')).toBe(true);
    expect(rss(rec)).toBeLessThanOrEqual(1e-10);
  });

  test('a row at x = 0 counts in the span of the phase coefficients', () => {
    // Three rows at x = 0, 0.5 and 1 of `2 cos(2.2 x + 0.5) + 0.1 x + e`
    // give a span of 1, so the basin in `b` is π wide; with the zero rate
    // of the row at `x = 0` dropped the span would be 0.5 and the grid half
    // as dense. The search over `b` in [0.3, 60] with `a`, `d` linear and
    // `c` a phase solved by least squares finds an exact fit.
    const xs = [0, 0.5, 1];
    const ys = xs.map((x) => 2 * Math.cos(2.2 * x + 0.5) + 0.1 * x + Math.E);
    const rec = findRoot(
      ['List', ...xs.map((x, i) => ['Equal', model(x), ys[i]])],
      PARAMS,
      { dict: { global: { dict: { b: [0.3, 60], c: [0, 2 * Math.PI] } } } }
    );
    expect(flag(rec, 'converged')).toBe(true);
    expect(rss(rec)).toBeLessThanOrEqual(1e-10);
  });
});
