import { ComputeEngine } from '../../src/compute-engine';
import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';

/**
 * A jump or a kink of the integrand between an endpoint of a Gauss–Kronrod
 * panel and the node nearest to it (at `0.0043·(b − a)` from the endpoint)
 * is seen by no node: the Gauss and Kronrod sums agree and the panel reports
 * an error of about 0. The adaptive quadrature compares the sample AT the
 * endpoint of a panel (the center of its parent, or a common endpoint of two
 * starting panels) with the parabola through the nearest nodes, and adds the
 * area such a jump can hide to the error of the panel
 * (`hiddenEdgeError`, `numerics/gauss-kronrod.ts`).
 *
 * The integrand is the inner integrand of the Tycho document
 * `neyret/2agcgxq87y` (Tycho ROADMAP row HY):
 * `n(x, y) = 1/max(ε, max(0, √(x² + y²) − 1))` for `x < −√(1 − y²)`, else 0
 * (for `y ≤ 1`). It jumps from `1/ε` to 0 at `x = −√(1 − y²)` and has a kink
 * at `x = −√((1 + ε)² − y²)`. Before the test above, the quadrature on
 * `[−10, 10]` reported `converged` with an error of about `6e-10` and was
 * wrong by `5e-6` (`y = 0.1`), `2e-5` (`y = 0.640025`, the kink in the gap)
 * and `1.4e-2` (`y = 1 − 1e-8`, the jump next to the starting-panel
 * boundary `x = 0`). The outer integral `∫₀¹ y·(∫ n dx) dy` was then
 * `5.286578 ± 0.0017` (true value `5.2869427`) after 45 955 inner
 * integrations (about 9 s).
 */

function innerIntegrand(y: number, eps: number): (x: number) => number {
  const cut = -Math.sqrt(1 - y * y);
  return (x) =>
    x < cut ? 1 / Math.max(eps, Math.max(0, Math.hypot(x, y) - 1)) : 0;
}

/** The inner integral, split at its jump and at its kink, where each piece
 * is smooth. */
function innerReference(y: number, eps: number): number {
  const f = innerIntegrand(y, eps);
  const jump = -Math.sqrt(1 - y * y);
  const kink = -Math.sqrt((1 + eps) ** 2 - y * y);
  const piece = (lo: number, hi: number) =>
    adaptiveQuadrature(f, lo, hi, { rtol: 1e-14, atol: 1e-20 }).estimate;
  return piece(-10, kink) + piece(kink, jump);
}

describe('A JUMP OR A KINK NEXT TO THE ENDPOINT OF A PANEL', () => {
  test.each([
    // A jump in the gap of a panel made by bisection.
    [0.1, 0.01],
    // A kink in the gap of a panel made by bisection.
    [0.640025, 0.01],
    // A jump in the gap next to the boundary `x = 0` of two starting panels.
    [1 - 1e-8, 0.01],
    [0.988725, 0.001],
  ])('y = %p, ε = %p: the error bounds the true error', (y, eps) => {
    const r = adaptiveQuadrature(innerIntegrand(y, eps), -10, 10, {
      singularEndpoints: true,
    });
    const truth = innerReference(y, eps);
    expect(r.converged).toBe(true);
    expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
    expect(r.error).toBeLessThan(1e-8);
  });

  test('a smooth integrand is not refined more', () => {
    // A smooth integrand passes the test at every panel endpoint: it still
    // converges on the 16 starting panels (240 evaluations, plus 15 samples
    // at the common endpoints of the starting panels).
    let evaluations = 0;
    const r = adaptiveQuadrature(
      (x) => {
        evaluations += 1;
        return Math.exp(x);
      },
      0,
      1
    );
    expect(r.converged).toBe(true);
    expect(Math.abs(r.estimate - (Math.E - 1))).toBeLessThan(1e-14);
    expect(evaluations).toBe(255);
  });
});

/**
 * A jump AT the common endpoint of two panels hides no area, but the sample
 * at the endpoint misses the parabola of the nodes of the panel on the other
 * side, at each bisection. The test samples once more, very near the
 * endpoint, and finds that the jump is not in the gap (`hiddenEdgeError`).
 * Without this sample, `Math.floor` on `[0, 16]` took 10 365 evaluations
 * (and did not converge with the panel budget of an integrand that did not
 * compile, 330 panels), `Math.sign` on `[−1, 1]` 2 055. Without the test of
 * the endpoints, each took 240 evaluations.
 */
describe('A JUMP AT THE COMMON ENDPOINT OF TWO PANELS', () => {
  test.each([
    ['floor on [0, 16]', Math.floor, 0, 16, 120],
    ['floor(4x) on [0, 4]', (x: number) => Math.floor(4 * x), 0, 4, 30],
    ['sign on [-1, 1]', Math.sign, -1, 1, 0],
    [
      'Heaviside on [-1, 1]',
      (x: number) => (x < 0 ? 0 : x > 0 ? 1 : 0.5),
      -1,
      1,
      1,
    ],
    ['a value at one point only', (x: number) => (x === 0 ? 5 : x), -1, 1, 0],
  ] as [string, (x: number) => number, number, number, number][])(
    '%s',
    (_, f, a, b, truth) => {
      for (const maxIntervals of [1500, 330]) {
        let evaluations = 0;
        const r = adaptiveQuadrature(
          (x) => {
            evaluations += 1;
            return f(x);
          },
          a,
          b,
          { maxIntervals, singularEndpoints: true }
        );
        expect(r.converged).toBe(true);
        expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
        expect(r.error).toBeLessThan(1e-12);
        expect(evaluations).toBeLessThanOrEqual(2 * 240);
      }
    }
  );
});

/**
 * The errors of the inner integrals in the error of an outer one
 * (`withNestedErrors`, `numerics/gauss-kronrod.ts`). The inner integral
 * `I(y) = ∫₀^y √x dx = (2/3)·y^1.5` is computed on two panels only, and does
 * not converge: its error is about `1e-2`.
 */
describe('THE ERRORS OF INNER INTEGRALS', () => {
  const coarse = { maxIntervals: 2, initialPanels: 1 };
  const inner = (lo: number, hi: number) =>
    adaptiveQuadrature((x) => Math.sqrt(x), lo, hi, coarse).estimate;

  test.each([
    ['∫ I(y) dy', (y: number) => inner(0, y), 4 / 15],
    // Reversed bounds: the values are negative.
    ['∫ −I(y) dy, as ∫_y^0', (y: number) => inner(y, 0), -4 / 15],
    // The values are near 0, and the outer estimate is near 0: the error
    // is not proportional to the outer estimate.
    ['∫ (4/15 − I(y)) dy', (y: number) => 4 / 15 - inner(0, y), 0],
    // Three levels: the errors of the innermost integrals are in the error
    // of the middle one, which is in the error of the outer one.
    [
      '∫∫ I(y·z) dy dz',
      (z: number) =>
        adaptiveQuadrature((y) => inner(0, y * z), 0, 1, {
          nestedErrors: true,
        }).estimate,
      8 / 75,
    ],
  ] as [string, (y: number) => number, number][])(
    '%s: the error bounds the true error, and the result is not converged',
    (_, f, truth) => {
      const r = adaptiveQuadrature(f, 0, 1, { nestedErrors: true });
      expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
      expect(r.converged).toBe(false);
    }
  );

  test('an inner integral over (−∞, ∞) is counted once', () => {
    // The two halves `(−∞, 0]` and `[0, ∞)` of the inner integral, on two
    // panels each, do not converge.
    const J = () =>
      adaptiveQuadrature((x) => 1 / (1 + x * x), -Infinity, Infinity, {
        maxIntervals: 4,
        initialPanels: 1,
      });
    const inner = J();
    expect(inner.error).toBeGreaterThan(1e-10);
    // Values of both signs: the added error is the mean error of the values,
    // `inner.error`, times the length of the interval, 1.
    const r = adaptiveQuadrature((y) => (y - 0.5) * J().estimate, 0, 1, {
      nestedErrors: true,
    });
    expect(r.error).toBeGreaterThanOrEqual(inner.error);
    expect(r.error).toBeLessThan(1.01 * inner.error);
  });

  test('a result tells whether an inner quadrature ran', () => {
    const smooth = (y: number) => Math.exp(-y);
    expect(
      adaptiveQuadrature((y) => inner(0, y), 0, 1, { nestedErrors: true })
        .innerQuadrature
    ).toBe(true);
    // An inner integral with no value is not counted in the error, but it ran.
    expect(
      adaptiveQuadrature(
        (y) => adaptiveQuadrature(() => NaN, 0, y).estimate,
        0,
        1,
        { nestedErrors: true }
      ).innerQuadrature
    ).toBe(true);
    // With no inner quadrature, the option changes nothing.
    expect(adaptiveQuadrature(smooth, 0, 1, { nestedErrors: true })).toEqual(
      adaptiveQuadrature(smooth, 0, 1)
    );
  });
});

/**
 * An integral in the body of a function that the integrand calls is not in the
 * expression of the integrand, so only the quadrature can see it, when it runs.
 */
describe('AN INNER INTEGRAL IN THE BODY OF A CALLED FUNCTION', () => {
  test('its error is in the error of the outer integral', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'F',
      ce.parse('y \\mapsto \\int_0^1 \\frac{e^{-xy}}{x^{0.99}} dx')
    );
    const result = ce.parse('\\int_0^1 F(y) dy').N().json as [
      string,
      number,
      number,
    ];
    expect(result[0]).toBe('Measurement');
    // The sum of `(−1)ᵏ/(k!·(k + 0.01)·(k + 1))` over `k`, term by term.
    const truth = 99.57585719444842;
    expect(Math.abs(result[1] - truth)).toBeLessThanOrEqual(result[2]);
    // The error of the outer quadrature alone is about `9e-14`.
    expect(result[2]).toBeGreaterThan(1e-11);
  });

  test.each([
    ['a real integrand', 'real', 0],
    // The real and imaginary parts refine the same panels, so the second pass
    // reads every sample from the cache and runs no inner quadrature.
    ['a complex integrand', 'number', 1],
  ] as [string, string, number][])(
    '%s that does not converge is not sampled',
    (_, resultType, imaginaryFactor) => {
      // The factor `sin(10⁵·y)` uses up the panels of the outer quadrature, so
      // the outer result does not converge, and the Monte-Carlo fallback of an
      // integrand that did not compile would take 10⁴ more samples, each with
      // an inner quadrature.
      const ce = new ComputeEngine();
      let evaluations = 0;
      ce.declare('G', {
        signature: `(real) -> ${resultType}`,
        evaluate: ([y]) => {
          evaluations += 1;
          const r = adaptiveQuadrature((x) => Math.exp(-x), 0, y.re);
          const v = Math.sin(1e5 * y.re) * r.estimate;
          return ce.number(ce.complex(v, imaginaryFactor * v));
        },
      });
      ce.box([
        'Integrate',
        ['Function', ['G', 'y'], 'y'],
        ['Limits', 'y', 0, 1],
      ]).N();
      // The quadrature takes about 10⁴ evaluations of its own, and the
      // Monte-Carlo fallback 10⁴ more.
      expect(evaluations).toBeGreaterThan(5_000);
      expect(evaluations).toBeLessThan(15_000);
    }
  );
});

/**
 * The outer integral of the same document: each outer sample runs an inner
 * adaptive quadrature (compiled to `_SYS.integrate`). The error of the inner
 * integrals has the same sign at neighboring samples, so the outer quadrature
 * does not see it: the reported error includes it (`withNestedErrors`,
 * `numerics/gauss-kronrod.ts`).
 *
 * The reference values do not use the Compute Engine. The inner integral is
 * `(√((1 + ε)² − y²) − √(1 − y²))/ε` plus the integral of `ρ/√(ρ² − y²)`
 * over `ln(ρ − 1)` from `ln ε` to `ln(√(100 + y²) − 1)` (where
 * `ρ = √(x² + y²)`), and the outer integral uses `y = 1 − u²`, which removes
 * the square-root behavior at `y = 1`. Both are smooth, and composite
 * 30-point Gauss–Legendre rules with 40 to 300 panels agree to 5e-14.
 * (The reference of `scripts/repros/2026-10-26-hy-reference-values.mts` in
 * the Tycho repository, 5.2869394 for `ε = 0.01`, is accurate only to about
 * 3e-6.)
 */
describe('THE NESTED INTEGRAL OF TYCHO ROW HY', () => {
  const ce = new ComputeEngine();
  ce.declare('d', 'function');
  ce.assign(
    'd',
    ce.box([
      'Function',
      [
        'ElementMax',
        0,
        [
          'Subtract',
          ['Sqrt', ['Add', ['Power', 'x', 2], ['Power', 'r', 2]]],
          1,
        ],
      ],
      'x',
      'r',
    ])
  );
  ce.declare('n', 'function');
  ce.assign(
    'n',
    ce.box([
      'Function',
      [
        'Multiply',
        ['Divide', 1, ['ElementMax', 'e_ps', ['d', 'x', 'r']]],
        [
          'Which',
          ['LessEqual', 'r', 1],
          [
            'Which',
            [
              'Less',
              'x',
              ['Negate', ['Sqrt', ['Subtract', 1, ['Power', 'r', 2]]]],
            ],
            1,
            'True',
            0,
          ],
          'True',
          1,
        ],
      ],
      'x',
      'r',
      'e_ps',
    ])
  );
  const body = (eps: number) =>
    ce.box([
      'Integrate',
      [
        'Function',
        [
          'Multiply',
          'y',
          [
            'If',
            ['LessEqual', 0, 'y', 5],
            [
              'Integrate',
              ['Function', ['n', 'x', 'y', eps], 'x'],
              ['Limits', 'x', -10, 10],
            ],
          ],
        ],
        'y',
      ],
      ['Limits', 'y', 0, 1],
    ]);

  test.each([
    [0.01, 5.28694266088],
    [0.2, 2.79158970333097],
  ])('ε = %p', (eps, reference) => {
    const v = body(eps).N();
    expect(v.operator).toBe('Measurement');
    const json = v.json as [string, unknown, unknown];
    const num = (x: unknown) =>
      Number(
        typeof x === 'object' && x !== null ? (x as { num: string }).num : x
      );
    const value = num(json[1]);
    const uncertainty = num(json[2]);
    // The uncertainty bounds the true error, and is at most 1e-8 relative.
    expect(Math.abs(value - reference)).toBeLessThanOrEqual(uncertainty);
    expect(uncertainty).toBeLessThan(1e-8 * reference);
  });
});
