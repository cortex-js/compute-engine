/**
 * Tycho ledger row 418 (`~/dev/tycho/docs/COMPUTE_ENGINE.md`, filed
 * 2026-10-21 on CE 0.161.0): `FindFit` reported `converged: false` at an
 * exact fit. A degree-10 polynomial through 11 points is an exact
 * interpolation whose constant term is 0. The record of a fit read
 * `converged` from the solver's stationarity tests alone, and neither can
 * pass on a problem scaled that badly: the Jacobian columns reach 10^10, so
 * a residual at the rounding floor still has a gradient far above the
 * absolute gradient tolerance, and the constant term, whose true value is 0,
 * never takes a step that is small relative to itself. The solve ran to the
 * iteration cap and was reported not converged.
 *
 * Now a fit whose every residual is within the solver's tolerance of the
 * terms its row computes is converged, and a solve within its tolerance
 * stops once an accepted step moves every parameter by less than the
 * tolerance of its own scale while the cost is at its rounding floor.
 *
 * The first block follows Tycho's instrument
 * (`scripts/repros/2026-10-21-ce418-findfit-exact-polynomial-not-converged-repro.mts`),
 * through the box route the instrument takes. The second block drives the
 * solver directly, for the exits the operators cannot reach on purpose (an
 * iteration cap, a deadline).
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';
import { levenbergMarquardt } from '../../src/compute-engine/numerics/levenberg-marquardt';

const ce = new ComputeEngine();

const field = (rec: Expression, key: string): Expression | undefined =>
  (rec as any).get(key);
// The record keys a parameter by its symbol name (`p_10` for the LaTeX
// `p_{10}`).
const param = (rec: Expression, name: string): number =>
  field(field(rec, 'parameters')!, ce.parse(name).json as string)!.re;
const flag = (rec: Expression, key: string): boolean | undefined => {
  const v = field(rec, key);
  if (v === undefined) return undefined;
  return (v as any).symbol === 'True';
};
const residualNorm = (rec: Expression): number =>
  field(rec, 'residualNorm')!.re;
const iterations = (rec: Expression): number => field(rec, 'iterations')!.re;

// The data of the corpus document: `y` is a tent function sampled at the
// integers 0 to 10, interpolated exactly by a polynomial of degree 10.
const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const ys = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4];
const names = [
  'p_0',
  'p_1',
  'p_2',
  'p_3',
  'p_4',
  'p_5',
  'p_6',
  'p_7',
  'p_8',
  'p_9',
  'p_{10}',
];
// The exact coefficients, as the document imports them.
const exact = [
  0, 39.22619047574171, -102.18916666547055, 108.40324073942986,
  -61.3380787029338, 20.770833333064452, -4.423055555497182, 0.597420634912711,
  -0.04965277777712648, 0.0023148148147852966, -0.000046296296295732265,
];
const poly = (x: string): string =>
  names.map((p, k) => (k === 0 ? p : `${p}\\cdot ${x}^{${k}}`)).join('+');
const data = xs.map((x, k) => ['Tuple', x, ys[k]]);

const findFit = (starts: number[] | undefined): Expression => {
  const specs = names.map((p, k) =>
    starts === undefined
      ? ce.parse(p).json
      : ['Tuple', ce.parse(p).json, starts[k]]
  );
  return ce
    .box([
      'FindFit',
      ['List', ...data],
      ce.parse(poly('x')).json,
      ['List', ...specs],
      ['List', 'x'],
    ] as any)
    .evaluate();
};

// A coefficient is checked to a relative 10^-6, and to an absolute 10^-9 for
// the constant term whose true value is 0 (the solve leaves it at about
// 10^-11).
const expectExactCoefficients = (rec: Expression): void => {
  for (let k = 0; k < names.length; k++)
    expect(Math.abs(param(rec, names[k]) - exact[k])).toBeLessThan(
      Math.max(1e-6 * Math.abs(exact[k]), 1e-9)
    );
};

describe('Tycho row 418: FindFit converged at an exact fit', () => {
  test('from the exact coefficients: converged, few iterations', () => {
    const rec = findFit(exact);
    expect(flag(rec, 'converged')).toBe(true);
    expect(residualNorm(rec)).toBeLessThan(1e-6);
    // The solve used to run on to its iteration cap (200) at the rounding
    // floor; now it stops once a step moves no parameter by more than the
    // tolerance of its scale.
    expect(iterations(rec)).toBeLessThan(50);
    expectExactCoefficients(rec);
  });

  test('from a start of 1 for every parameter: converged, below the cap', () => {
    const rec = findFit(undefined);
    expect(flag(rec, 'converged')).toBe(true);
    expect(residualNorm(rec)).toBeLessThan(1e-6);
    expect(iterations(rec)).toBeLessThan(200);
    expectExactCoefficients(rec);
  });

  test('the `FindFit` record still has no `stationary` key', () => {
    const rec = findFit(exact);
    expect(field(rec, 'stationary')).toBeUndefined();
  });

  test('the same system as a stacked FindRoot: converged and stationary', () => {
    const eqs = xs.map((x, k) => ce.parse(`${poly(`(${x})`)}=${ys[k]}`).json);
    const specs = names.map((p, k) => ['Tuple', ce.parse(p).json, exact[k]]);
    const rec = ce
      .box(['FindRoot', ['List', ...eqs], ['List', ...specs]] as any)
      .evaluate();
    expect(flag(rec, 'converged')).toBe(true);
    expect(flag(rec, 'stationary')).toBe(true);
    expect(residualNorm(rec)).toBeLessThan(1e-6);
  });

  test('a fit with a misfit is converged at its least-squares minimum', () => {
    // A line through three points that are not collinear: the misfit is not
    // zero, so the tolerance test never passes, and `converged` is the
    // stationarity test as before.
    const rec = ce
      .box([
        'FindFit',
        ['List', ['Tuple', 0, 0], ['Tuple', 1, 2], ['Tuple', 2, 2]],
        ce.parse('a x + b').json,
        ['List', ['Tuple', 'a', 1], ['Tuple', 'b', 1]],
        ['List', 'x'],
      ] as any)
      .evaluate();
    expect(flag(rec, 'converged')).toBe(true);
    expect(residualNorm(rec)).toBeGreaterThan(0.5);
    // The least-squares line is `y = x + 1/3`.
    expect(param(rec, 'a')).toBeCloseTo(1, 8);
    expect(param(rec, 'b')).toBeCloseTo(1 / 3, 8);
  });

  test('a well-scaled exact fit from a poor start is unchanged', () => {
    // A line through two exact points from a poor start: the solve stops
    // at the gradient test, as it did before the exact-fit test, with the
    // parameters within the engine's tolerance (`a = 2.00000000007` on
    // 0.161.0 and now).
    const rec = ce
      .box([
        'FindFit',
        ['List', ['Tuple', 1, 3], ['Tuple', 3, 7]],
        ce.parse('a x + b').json,
        ['List', ['Tuple', 'a', 10], ['Tuple', 'b', -10]],
        ['List', 'x'],
      ] as any)
      .evaluate();
    expect(flag(rec, 'converged')).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(2, 9);
    expect(param(rec, 'b')).toBeCloseTo(1, 9);
    expect(iterations(rec)).toBeLessThan(10);
  });

  test('a steep equation within the root tolerance is polished to its minimum', () => {
    // `1 + (10^12 a)^2 = 0` has no real root. From `a = 10^-11` the start is
    // within the root tolerance of its steep equation (a residual of 101
    // against a Jacobian of 2 · 10^13), and the first step, 5 · 10^-12, is
    // below the absolute tolerance; the solve must not stop there (a
    // residual of 25) but reach the minimum, a residual of 1, and report
    // it as not a root.
    const rec = ce
      .box([
        'FindRoot',
        ['List', ce.parse('1+(10^{12} a)^2=0').json],
        ['List', ['Tuple', 'a', 1e-11]],
      ] as any)
      .evaluate();
    expect(flag(rec, 'converged')).toBe(false);
    expect(flag(rec, 'stationary')).toBe(true);
    expect(residualNorm(rec)).toBeCloseTo(1, 6);
  });

  test('a root far below 1 keeps its relative precision', () => {
    // `10^12 k = 1` from `k = 1`: a stall at the absolute tolerance would
    // leave `k` at a relative error of 10^-3; the solve goes on while the
    // cost is above its rounding floor and reaches the root exactly.
    const rec = ce
      .box([
        'FindRoot',
        ['List', ce.parse('10^{12} k = 1').json],
        ['List', ['Tuple', 'k', 1]],
      ] as any)
      .evaluate();
    expect(flag(rec, 'converged')).toBe(true);
    expect(Math.abs(param(rec, 'k') - 1e-12)).toBeLessThan(1e-12 * 1e-9);
  });
});

/**
 * The polynomial rows of a least-squares problem as the solver sees them:
 * `r_i = Σ_j θ_j x_i^j − y_i`, `J_ij = x_i^j`.
 */
const polynomialRows = (
  points: number[],
  values: number[],
  degree: number
) => ({
  residual: (theta: number[]): number[] =>
    points.map(
      (x, i) =>
        theta.reduce((sum, c, j) => sum + c * Math.pow(x, j), 0) - values[i]
    ),
  jacobian: (_theta: number[]): number[][] =>
    points.map((x) =>
      Array.from({ length: degree + 1 }, (_, j) => Math.pow(x, j))
    ),
});

describe('Tycho row 418: the solver exits the operators cannot reach', () => {
  test('a fit that stops before stationarity is not converged at a misfit', () => {
    // A degree-10 model over `x` in [10, 20] on data of magnitude 1 from a
    // start of 0: the residual norm is 3.1 at the start and 0.1 after three
    // iterations. With the row scale of a root solve, `Σ_j |J_ij| ·
    // max(1, |θ_j|)`, every such point was within the tolerance (an
    // allowance of 1 to 1000 a row), and an exit at an iteration cap would
    // have reported `converged: true`. The fit's scale is the magnitude of
    // the terms the row computes, `Σ_j |J_ij · θ_j|`.
    const points = Array.from({ length: 11 }, (_, i) => 10 + i);
    const values = points.map((x) => Math.sin(x / 3));
    const { residual, jacobian } = polynomialRows(points, values, 10);
    for (const maxIterations of [0, 1, 3]) {
      const r = levenbergMarquardt(residual, jacobian, new Array(11).fill(0), {
        fitTolerance: 1e-10,
        maxIterations,
      });
      expect(r.converged).toBe(false);
      expect(r.residualNorm).toBeGreaterThan(0.05);
    }
  });

  test('a deadline during the polishing of an exact fit clears converged', () => {
    // From the exact coefficients the fit is within the tolerance at the
    // start and not yet stationary; a timeout cancellation thrown from the
    // iteration hook during that polishing is reported as `timedOut`, and
    // never beside `converged: true`.
    const { residual, jacobian } = polynomialRows(xs, ys, 10);
    const r = levenbergMarquardt(residual, jacobian, exact.slice(), {
      fitTolerance: 1e-10,
      onIteration: (iter) => {
        if (iter >= 1)
          throw new CancellationError({
            message: 'deadline',
            cause: 'timeout',
          });
      },
    });
    expect(r.timedOut).toBe(true);
    expect(r.converged).toBe(false);
    expect(r.residualNorm).toBeLessThan(1e-6);
  });
});
