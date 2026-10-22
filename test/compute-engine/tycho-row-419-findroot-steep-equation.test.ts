/**
 * Tycho ledger row 419 (`~/dev/tycho/docs/COMPUTE_ENGINE.md`, filed
 * 2026-10-22 on CE 0.161.0): `FindRoot` reported `converged: True` far from
 * a root when the equation is steep. The root test of row 414 allows a
 * residual of `tolerance · (1 + Σ_j |J_ij| · max(1, |θ_j|))`, and its
 * Jacobian part has no cap: `2 - sin(10^18 a) = 0` has no real root, and at
 * every point its Jacobian, up to 10^18, let a residual of 1 to 3 pass.
 *
 * Now an equation whose residual needs the Jacobian part is a root only
 * when the first-order claim of that part holds: moved against its
 * residual by twice the relative change the part grants, the residual
 * changes sign and changes as the Jacobian predicts, to within half. A root
 * solve also goes on past the relative step stall while its steps still
 * more than halve the cost, so a steep equation is polished to its root.
 *
 * The cases follow Tycho's instrument
 * (`scripts/repros/2026-10-22-ce419-findroot-converged-steep-jacobian-repro.mts`),
 * through the box route it takes.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const ce = new ComputeEngine();

const field = (rec: Expression, key: string): Expression | undefined =>
  (rec as any).get(key);
const param = (rec: Expression): number =>
  field(field(rec, 'parameters')!, 'a')!.re;
const flag = (rec: Expression, key: string): boolean =>
  (field(rec, key) as any)?.symbol === 'True';
const residualNorm = (rec: Expression): number =>
  field(rec, 'residualNorm')!.re;

/** `FindRoot` of one equation in `a` through the box route. */
const findRoot = (
  latex: string,
  start: number,
  bounds?: [number, number]
): Expression =>
  ce
    .box([
      'FindRoot',
      ['List', ce.parse(latex).json],
      ['List', ['Tuple', 'a', start, ...(bounds ?? [])]],
    ] as any)
    .evaluate();

describe('row 419: a steep equation with no root is not converged', () => {
  test('2 - sin(10^18 a) = 0 from a = 1 (the instrument)', () => {
    const r = findRoot('2-\\sin(10^{18}a)=0', 1);
    expect(flag(r, 'converged')).toBe(false);
    expect(residualNorm(r)).toBeGreaterThanOrEqual(1);
  });

  test('2 - sin(10^18 a) = 0 from a = 0 (the instrument)', () => {
    const r = findRoot('2-\\sin(10^{18}a)=0', 0);
    expect(flag(r, 'converged')).toBe(false);
    expect(residualNorm(r)).toBeGreaterThanOrEqual(1);
  });

  test('2 - sin(10^18 a) = 0 under the bound a <= 0', () => {
    const r = findRoot('2-\\sin(10^{18}a)=0', 0, [-1, 0]);
    expect(flag(r, 'converged')).toBe(false);
  });

  test('2 - sin(10^18 a) = 0 is never converged, over 20 starts', () => {
    for (let k = 0; k < 20; k++) {
      const r = findRoot('2-\\sin(10^{18}a)=0', 1 + k / 20);
      expect(flag(r, 'converged')).toBe(false);
    }
  });

  test('sin(10^12 a) = 0.5 oscillates faster than the tolerance: not converged', () => {
    // Its zeros are 6 · 10^-12 apart, but over the reach of the tolerance,
    // 2 · 10^-10, it turns through 200 radians: the Jacobian says nothing
    // there, and the solve stopped at a residual of 0.18.
    for (let k = 0; k < 10; k++) {
      const r = findRoot('\\sin(10^{12}a)=0.5', 1 + k / 10);
      expect(flag(r, 'converged')).toBe(false);
    }
  });

  test('1 + (10^12 a)^2 = 0 has no root: not converged', () => {
    const r = findRoot('1+(10^{12}a)^2=0', 1e-11);
    expect(flag(r, 'converged')).toBe(false);
    expect(flag(r, 'stationary')).toBe(true);
    expect(residualNorm(r)).toBeCloseTo(1, 6);
  });
});

describe('row 419: steep and scaled equations with a root still converge', () => {
  test('the control a^2 - 4 = 0 (the instrument)', () => {
    const r = findRoot('a^2-4=0', 1);
    expect(flag(r, 'converged')).toBe(true);
    expect(param(r)).toBeCloseTo(2, 9);
  });

  test('sin(10^8 a) = 0.5 is polished to a residual below 10^-7', () => {
    const r = findRoot('\\sin(10^{8}a)=0.5', 1);
    expect(flag(r, 'converged')).toBe(true);
    expect(residualNorm(r)).toBeLessThan(1e-7);
  });

  test('a^2 = 10^12 reaches a = 10^6 (it stopped at a residual of 0.14)', () => {
    const r = findRoot('a^2=10^{12}', 1);
    expect(flag(r, 'converged')).toBe(true);
    expect(Math.abs(param(r) - 1e6)).toBeLessThan(1e-8);
  });

  test('10^12 a = 3 · 10^12 and 10^12 a = 1', () => {
    const big = findRoot('10^{12}a=3\\cdot10^{12}', 1);
    expect(flag(big, 'converged')).toBe(true);
    expect(param(big)).toBeCloseTo(3, 12);
    const small = findRoot('10^{12}a=1', 1);
    expect(flag(small, 'converged')).toBe(true);
    expect(Math.abs(param(small) - 1e-12) / 1e-12).toBeLessThan(1e-9);
  });

  test('e^a = 10^30, a residual far above 1 at the rounding floor', () => {
    const r = findRoot('e^{a}=10^{30}', 60);
    expect(flag(r, 'converged')).toBe(true);
    expect(param(r)).toBeCloseTo(30 * Math.LN10, 9);
  });

  test('a root outside the bounds is not converged', () => {
    const r = findRoot('a^2-4=0', 1, [0, 1.9]);
    expect(flag(r, 'converged')).toBe(false);
  });

  test('a root less than one unit in the last place past a bound', () => {
    // The bound is the double just below the root of e^a = 10^30; the
    // residual there, -2.4 · 10^15, is the best the box allows.
    const r = findRoot('e^{a}=10^{30}', 60, [0, 69.07755278982137]);
    expect(flag(r, 'converged')).toBe(true);
    expect(param(r)).toBe(69.07755278982137);
  });

  test('a double root is converged at the rounding of its parameter', () => {
    // It touches 0 without crossing it; at the double nearest the root the
    // residual is above the absolute tolerance.
    const simple = findRoot('(a-1)^2=0', 3);
    expect(flag(simple, 'converged')).toBe(true);
    const far = findRoot('(a-100000000000.3)^2=0', 100000000003);
    expect(flag(far, 'converged')).toBe(true);
    // The tolerance determines a parameter of 10^11 to within 10; the
    // solve stopped 1.65 away from the root before this change.
    expect(Math.abs(param(far) - 100000000000.3)).toBeLessThan(1e-2);
    const scaled = findRoot('10^{24}(a^2-2)^2=0', 1.5);
    expect(flag(scaled, 'converged')).toBe(true);
    expect(param(scaled)).toBeCloseTo(Math.SQRT2, 7);
  });

  test('a steep system of two equations, and a parameter fixed by its bounds', () => {
    const system = ce
      .box([
        'FindRoot',
        [
          'List',
          ce.parse('10^{12}a+b=3\\cdot10^{12}').json,
          ce.parse('a-b=0').json,
        ],
        ['List', ['Tuple', 'a', 1], ['Tuple', 'b', 1]],
      ] as any)
      .evaluate();
    expect(flag(system, 'converged')).toBe(true);
    expect(param(system)).toBeCloseTo(3 / (1 + 1e-12), 9);

    const fixed = ce
      .box([
        'FindRoot',
        ['List', ce.parse('10^{12}a\\cdot b=6\\cdot10^{12}').json],
        ['List', ['Tuple', 'a', 1], ['Tuple', 'b', 2, 2, 2]],
      ] as any)
      .evaluate();
    expect(flag(fixed, 'converged')).toBe(true);
    expect(param(fixed)).toBeCloseTo(3, 9);
  });
});

describe('row 419: FindFit is not changed', () => {
  test('a steep exact fit and a fit with a misfit keep their records', () => {
    // The check of the root test and the polishing past the step stall are
    // for a root solve only: a fit reads neither.
    const fit = (data: number[][], model: string) =>
      ce
        .box([
          'FindFit',
          ['List', ...data.map((row) => ['Tuple', ...row])],
          ce.parse(model).json,
          ['List', ['Tuple', 'a', 1]],
          ['List', 'x'],
        ] as any)
        .evaluate();
    const exact = fit(
      [
        [1, 2e12],
        [2, 4e12],
      ],
      '10^{12}a x'
    );
    expect(flag(exact, 'converged')).toBe(true);
    expect(param(exact)).toBeCloseTo(2, 9);
    const misfit = fit(
      [
        [0, 1],
        [0, -1],
      ],
      'a'
    );
    expect(flag(misfit, 'converged')).toBe(true);
    expect(param(misfit)).toBeCloseTo(0, 9);
  });
});
