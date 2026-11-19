import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';

/**
 * CE-1312. A peak between a bound of the integral and the node nearest to
 * it, whose value underflows both at the nodes and at the deepest probe of
 * `boundGapError` (`numerics/gauss-kronrod.ts`). For `x²⁵·e⁻ˣ` on
 * `[0, 10⁷]`, the nearest node is at 2680, where `e⁻ˣ` is 0, and the deepest
 * probe is at `2e-15`, where `x²⁵` is 0: the quadrature gave `0`, converged,
 * for `25! ≈ 1.55e25`. When the nodes next to a bound are all 0, every probe
 * is now computed, and the probe at 9.5 sees the peak.
 */

const FACTORIAL_25 = 1.5511210043330986e25;

describe('CE-1312 A PEAK THAT UNDERFLOWS AT THE BOUND AND AT THE NODES', () => {
  test.each([
    [
      'x²⁵·e⁻ˣ on [0, 10⁷]',
      (x: number) => x ** 25 * Math.exp(-x),
      0,
      1e7,
      FACTORIAL_25,
    ],
    [
      'x¹⁰⁰·e⁻ˣ/100! on [0, 10⁷]',
      (x: number) => Math.exp(100 * Math.log(x) - x - 363.73937555556347),
      0,
      1e7,
      1,
    ],
    // Unchanged: the integrals that gave the right value before.
    [
      '(10⁷ − x)²⁵·e^(x − 10⁷) on [0, 10⁷], the peak next to the upper bound',
      (x: number) => (1e7 - x) ** 25 * Math.exp(x - 1e7),
      0,
      1e7,
      FACTORIAL_25,
    ],
    [
      'x²⁵·e⁻ˣ on [0, 10⁴]',
      (x: number) => x ** 25 * Math.exp(-x),
      0,
      1e4,
      FACTORIAL_25,
    ],
    [
      'e^(−(x − 20)²) on [0, 10⁷]',
      (x: number) => Math.exp(-((x - 20) ** 2)),
      0,
      1e7,
      Math.sqrt(Math.PI),
    ],
  ])('%s', (_label, f, a, b, expected) => {
    let evaluations = 0;
    const result = adaptiveQuadrature(
      (x) => {
        evaluations += 1;
        return f(x);
      },
      a,
      b
    );
    expect(Math.abs(result.estimate - expected)).toBeLessThan(1e-9 * expected);
    expect(result.error).toBeLessThan(1e-9 * expected);
    expect(evaluations).toBeLessThan(2000);
  });

  const integrand = [
    'Multiply',
    ['Power', 'x', 25],
    ['Exp', ['Negate', 'x']],
  ] as const;

  test('N() of the integral', () => {
    const ce = new ComputeEngine();
    const value = ce
      .box(['Integrate', integrand, ['Limits', 'x', 0, 1e7]] as any)
      .N().re;
    expect(Math.abs(value - FACTORIAL_25)).toBeLessThan(1e-9 * FACTORIAL_25);
  });

  test('compiled code of the integral with a variable bound', () => {
    const ce = new ComputeEngine();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let f: any;
    try {
      f = compile(
        ce.box(['Integrate', integrand, ['Limits', 'x', 0, 'y']] as any)
      );
    } finally {
      warn.mockRestore();
    }
    expect(f.success).toBe(true);
    for (const y of [1e4, 1e7])
      expect(Math.abs(f.run({ y }) - FACTORIAL_25)).toBeLessThan(
        1e-9 * FACTORIAL_25
      );
  });
});
