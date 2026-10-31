import { ComputeEngine } from '../../src/compute-engine';
import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';

/**
 * GitHub issue #494. Next to a zero of a difference that cancels in doubles,
 * the integrand is `+∞` at some consecutive doubles next to a singular
 * endpoint: `cos(t/2)/√(cos t − cos ½)` is `+∞` at ½ and at the 2 doubles
 * below it, because `cos t − cos ½` is 0 there. The test of a singular point
 * some doubles inside an endpoint (`offsetSingularity`,
 * `numerics/endpoint-quadrature.ts`) put the singular point at the first
 * double, read the second one as another singular point, and gave an error
 * of `+∞`: `∫₀^½ cos(t/2)/√(cos t − cos ½) dt` was
 * `2.2214414411509225 ± PositiveInfinity`. A run of samples that are not
 * finite at consecutive doubles is now one singular point, at the far end of
 * the run, and the error is finite and covers the true error.
 */

describe('A RUN OF NON-FINITE DOUBLES NEXT TO A SINGULAR ENDPOINT', () => {
  test('the Mehler–Dirichlet integral has a finite error that covers the true error', () => {
    const ce = new ComputeEngine();
    const f = [
      'Function',
      [
        'Multiply',
        [
          'Divide',
          1,
          [
            'Sqrt',
            ['Add', ['Cos', 't'], ['Negate', ['Cos', ['Rational', 1, 2]]]],
          ],
        ],
        ['Cos', ['Multiply', ['Rational', 1, 2], 't']],
      ],
      't',
    ];
    const result = ce
      .box(['N', ['Integrate', f, ['Limits', 't', 0, ['Rational', 1, 2]]]])
      .evaluate();
    expect(result.operator).toBe('Measurement');
    const value = result.op1.re;
    const error = result.op2.re;
    // The quadrature does not converge here (its error is about `1.2e-7`),
    // so the engine reports at least the standard error of the Monte-Carlo
    // estimate it replaces, `|estimate|/√10⁷ ≈ 7e-4` (`integrateRealPart`,
    // `library/calculus.ts`). Only a finite error that covers the true error
    // is checked.
    expect(Number.isFinite(error)).toBe(true);
    expect(Math.abs(value - Math.PI / Math.SQRT2)).toBeLessThanOrEqual(error);
  });

  // `∫ dt/√(cos t − cos b)` over `[b/2, b]` (singular at the upper endpoint)
  // and the same integral mirrored to `[−b, −b/2]` (singular at the lower
  // endpoint). The reference value comes from `t = b − u²`, with
  // `cos(b − u²) − cos b = 2·sin(b − u²/2)·sin(u²/2)`, an integrand with no
  // singularity and no cancellation. For `b = 0.05` the integrand is `+∞` at
  // more than 12 doubles below `b`, past the 8 consecutive doubles that the
  // test samples first.
  const reference = (b: number) =>
    adaptiveQuadrature(
      (u) =>
        (2 * u) /
        Math.sqrt(2 * Math.sin(b - (u * u) / 2) * Math.sin((u * u) / 2)),
      0,
      Math.sqrt(b / 2),
      { rtol: 1e-14 }
    ).estimate;
  test.each([0.05, 0.2, 0.5, 1, 1.7, 2.5, 3])(
    '∫ dt/√(cos t − cos b) next to b = %p has a finite error that covers the true error',
    (b) => {
      const exact = reference(b);
      const c = Math.cos(b);
      const upper = adaptiveQuadrature(
        (t) => 1 / Math.sqrt(Math.cos(t) - c),
        b / 2,
        b,
        { singularEndpoints: true }
      );
      const lower = adaptiveQuadrature(
        (t) => 1 / Math.sqrt(Math.cos(t) - c),
        -b,
        -b / 2,
        { singularEndpoints: true }
      );
      for (const r of [upper, lower]) {
        expect(Number.isFinite(r.error)).toBe(true);
        expect(Math.abs(r.estimate - exact)).toBeLessThanOrEqual(r.error);
      }
    }
  );

  // Two singular points next to the endpoint 1 of `[1, 2]` (`u` is the
  // spacing of the doubles above 1): the integrand is `+∞` at the doubles
  // `1 + k·u` for the listed `k`, and `1/√(x − 1)` elsewhere. The doubles
  // between the two parts are finite, so the run ends at the first part,
  // and the sample of the second part gives an error of `+∞`, as for two
  // separate poles. In the cases `1 and 4` and `1 and 5` there is no run:
  // the code before issue #494 also gave `+∞` for `1 and 4`, but not for
  // `1 and 5`. A run of 1500 doubles is longer than the
  // `NON_FINITE_RUN_SPACINGS` (1024) doubles that are read one by one, and
  // the error is `+∞` too.
  const u = Number.EPSILON;
  test.each([
    ['1, 2, 3 and 6', [1, 2, 3, 6]],
    ['1 to 8 and 16', [1, 2, 3, 4, 5, 6, 7, 8, 16]],
    ['1 and 4', [1, 4]],
    ['1, 2, 3 and 5', [1, 2, 3, 5]],
    ['1 to 9 and 16', [1, 2, 3, 4, 5, 6, 7, 8, 9, 16]],
    ['1, 2, 3, 4 and 6', [1, 2, 3, 4, 6]],
    ['1 and 5', [1, 5]],
    ['1 to 1500', Array.from({ length: 1500 }, (_, i) => i + 1)],
  ])(
    'infinite at the doubles %s above 1: the error is +∞',
    (_label, doubles) => {
      const infinite = new Set(doubles as number[]);
      const r = adaptiveQuadrature(
        (x) =>
          infinite.has(Math.round((x - 1) / u))
            ? Number.POSITIVE_INFINITY
            : 1 / Math.sqrt(x - 1),
        1,
        2,
        { singularEndpoints: true }
      );
      expect(r.error).toBe(Number.POSITIVE_INFINITY);
    }
  );
});
