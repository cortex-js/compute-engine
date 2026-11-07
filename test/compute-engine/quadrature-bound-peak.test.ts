import { ComputeEngine } from '../../src/compute-engine';
import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';

/**
 * A peak at a bound of the integral that is narrower than the gap between
 * the bound and the node nearest to it (`boundGapError`,
 * `numerics/gauss-kronrod.ts`). The nearest node of the starting panels of
 * `[0, 1]` is at `2.7e-4`, where `e^(−10⁸·x)` is 0 in double precision:
 * every node gave 0, and the quadrature gave `0`, converged, with an error
 * of 0. The integrand is now sampled in the gap, and the panel is bisected
 * toward the bound until its nodes see the peak.
 */

const ce = new ComputeEngine();

/** `∫₀¹ e^(−r·x)·x^(−α) dx`, for `r` so large that the part past 1 is 0 in
 * double precision: `r^(α − 1)·Γ(1 − α)`. */
const gamma: Record<number, number> = {
  0: 1,
  0.5: Math.sqrt(Math.PI),
  0.9: 9.513507698668732,
  0.99: 99.4325851191506,
};
const peakIntegral = (rate: number, alpha: number) =>
  rate ** (alpha - 1) * gamma[alpha];

describe('A PEAK AT A BOUND OF THE INTEGRAL', () => {
  test.each([
    ['e^(−10⁸·x) at 0', (x: number) => Math.exp(-1e8 * x), 1e-8],
    [
      '1 + 10³·e^(−10⁸·x), a peak on a constant',
      (x: number) => 1 + 1e3 * Math.exp(-1e8 * x),
      1 + 1e-5,
    ],
    [
      '1 + 2·e^(−10⁸·x), a small peak on a constant',
      (x: number) => 1 + 2 * Math.exp(-1e8 * x),
      1 + 2e-8,
    ],
    [
      '1 − e^(−10⁸·x), a dip on a constant',
      (x: number) => 1 - Math.exp(-1e8 * x),
      1 - 1e-8,
    ],
    [
      'e^(−10¹⁰·x)/√x',
      (x: number) => Math.exp(-1e10 * x) / Math.sqrt(x),
      peakIntegral(1e10, 0.5),
    ],
    [
      'e^(−10⁸·x)/x^0.9',
      (x: number) => Math.exp(-1e8 * x) / x ** 0.9,
      peakIntegral(1e8, 0.9),
    ],
  ] as [string, (x: number) => number, number][])(
    '%s converges to its value',
    (_, f, truth) => {
      for (const singularEndpoints of [false, true]) {
        const r = adaptiveQuadrature(f, 0, 1, { singularEndpoints });
        expect(r.converged).toBe(true);
        expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
        expect(r.error).toBeLessThanOrEqual(1e-10 * truth);
      }
    }
  );

  test('a peak at a singular endpoint is not a divergence', () => {
    // The corner panel at 0 is bisected toward the peak while its nodes see
    // 0. These bisections do not start the series of shells of the corner:
    // with 18 shells of about 0 before the peak, the divergence test
    // reported the integral as divergent. The result is not converged (the
    // shells of `x^(−0.99)` decrease slowly), and its error bounds the true
    // error.
    for (const rate of [1e8, 1e10]) {
      const truth = peakIntegral(rate, 0.99);
      const r = adaptiveQuadrature(
        (x) => Math.exp(-rate * x) / x ** 0.99,
        0,
        1,
        { singularEndpoints: true }
      );
      expect(r.divergent).toBe(false);
      expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
      expect(r.error).toBeLessThan(0.01 * truth);
    }
  });

  test.each([
    [
      '(1 − cos x)/x² on [0, 1]',
      (x: number) => (1 - Math.cos(x)) / (x * x),
      1,
      0.4863853762347,
    ],
    [
      '(1 − cos x)/x² on [0, 10]',
      (x: number) => (1 - Math.cos(x)) / (x * x),
      10,
      1.4744404413,
    ],
    [
      '(x − sin x)/x³ on [0, 1]',
      (x: number) => (x - Math.sin(x)) / x ** 3,
      1,
      0.16392818052,
    ],
    [
      'ln(1 + x)/x on [0, 1]',
      (x: number) => Math.log(1 + x) / x,
      1,
      Math.PI ** 2 / 12,
    ],
    [
      '(eˣ − 1 − x)/x² on [0, 1]',
      (x: number) => (Math.exp(x) - 1 - x) / (x * x),
      1,
      0.5996203229964883,
    ],
    [
      '(eˣ − 1 − x)/x² on [0, 3]',
      (x: number) => (Math.exp(x) - 1 - x) / (x * x),
      3,
      // `Σ 3^(k+1)/((k + 2)!·(k + 1))`.
      (() => {
        let sum = 0;
        let factorial = 1;
        for (let k = 0; k < 60; k++) {
          factorial *= k + 2;
          sum += 3 ** (k + 1) / (factorial * (k + 1));
        }
        return sum;
      })(),
    ],
    [
      '(x − ln(1 + x))/x² on [0, 1]',
      (x: number) => (x - Math.log(1 + x)) / (x * x),
      1,
      2 * Math.LN2 - 1,
    ],
  ] as [string, (x: number) => number, number, number][])(
    'a removable singularity that loses its digits next to 0 is not a peak: %s',
    (_, f, b, truth) => {
      // Next to 0 the integrand is computed with a cancellation, and is 0,
      // noise, or `±1/x` there. The nodes of the panel at 0 are not flat
      // (`nodesAreFlat`), so the probes are not computed: the integral
      // converges on the starting panels, as without the probes.
      for (const singularEndpoints of [false, true]) {
        let evaluations = 0;
        const r = adaptiveQuadrature(
          (x) => {
            evaluations += 1;
            return f(x);
          },
          0,
          b,
          { singularEndpoints }
        );
        expect(r.converged).toBe(true);
        expect(Math.abs(r.estimate - truth)).toBeLessThan(1e-9);
        expect(evaluations).toBe(255);
      }
    }
  );

  test('a peak at the upper bound', () => {
    // Next to 1, `1 − x` is rounded to the spacing of the doubles at 1
    // (`1.1e-16`), so the integrand has a relative error of about `1e-10`
    // at the peak: the result does not meet the relative tolerance `1e-10`,
    // and its error bounds the true error.
    for (const singularEndpoints of [false, true]) {
      const r = adaptiveQuadrature((x) => Math.exp(-1e8 * (1 - x)), 0, 1, {
        singularEndpoints,
      });
      expect(r.divergent).toBe(false);
      expect(Math.abs(r.estimate - 1e-8)).toBeLessThanOrEqual(r.error);
      expect(r.error).toBeLessThan(1e-8 * 1e-8);
    }
  });

  test('a peak at a bound far from 0', () => {
    // Next to 10⁶, the doubles are 1.2e-10 apart, and the peak is about 80
    // doubles wide: the rounding of the nodes stops the refinement before
    // the tolerance, and the error bounds the true error.
    const r = adaptiveQuadrature(
      (x) => Math.exp(-1e8 * (x - 1e6)),
      1e6,
      1e6 + 1
    );
    expect(Math.abs(r.estimate - 1e-8)).toBeLessThanOrEqual(r.error);
    expect(r.error).toBeLessThan(0.01 * 1e-8);
  });

  test('.N() of the integrals of the issue', () => {
    const value = (latex: string) =>
      (ce.parse(latex).N().json as [string, number, number]).slice(1);
    const [v1, e1] = value('\\int_0^1 e^{-10^8 x}\\,dx');
    expect(Math.abs(v1 - 1e-8)).toBeLessThanOrEqual(e1);
    expect(e1).toBeLessThan(1e-18);
    const [v2, e2] = value('\\int_0^1 \\frac{e^{-10^8 x}}{x^{0.99}}\\,dx');
    expect(Math.abs(v2 - peakIntegral(1e8, 0.99))).toBeLessThanOrEqual(e2);
    expect(e2).toBeLessThan(1);
  });
});
