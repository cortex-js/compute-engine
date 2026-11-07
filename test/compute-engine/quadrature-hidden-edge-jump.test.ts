import { ComputeEngine } from '../../src/compute-engine';
import {
  adaptiveQuadrature,
  insideReplay,
} from '../../src/compute-engine/numerics/gauss-kronrod';
import { integrateSemiInfiniteOscillatory } from '../../src/compute-engine/numerics/oscillatory-quadrature';

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

  /**
   * The error that an inner integral gives to a value of the integrand
   * depends on how the value changes with the inner integral. With
   * `replayIntegrand`, the quadrature measures it: it evaluates the integrand
   * again with the inner result changed by its error (`measuredValueError`,
   * `numerics/gauss-kronrod.ts`). The inner integral
   * `J = ∫ dx/(1 + x²) = π` over `(−∞, ∞)` is computed on four panels, and
   * has the same error `e` of about `2e-9` at each node.
   */
  describe('the error of a value is measured', () => {
    const J = () =>
      adaptiveQuadrature((x) => 1 / (1 + x * x), -Infinity, Infinity, {
        maxIntervals: 4,
        initialPanels: 1,
      });
    const { estimate: j, error: e } = J();
    const measured = (f: (y: number) => number) =>
      adaptiveQuadrature(f, 0, 1, { nestedErrors: true, replayIntegrand: f });
    const errorOf = (f: (y: number) => number) => measured(f).error;
    // The error of the outer quadrature is at the level of the rounding, so
    // the error of the result is the expected one to 1e-5 relative.
    const expectError = (actual: number, expected: number) => {
      expect(actual).toBeGreaterThan(0.99999 * expected);
      expect(actual).toBeLessThan(1.00001 * expected);
    };

    test('a small factor of the inner integral applies to its error', () => {
      const f = () => 1e-6 * J().estimate;
      const r = measured(f);
      expectError(r.error, 1e-6 * e);
      // The error is smaller than the tolerance of the outer integral, so
      // the result converged.
      expect(r.converged).toBe(true);
      // Without `replayIntegrand`, the error is not measured: it is the
      // larger of `e` and `|v|·e/|J|`.
      expectError(adaptiveQuadrature(f, 0, 1, { nestedErrors: true }).error, e);
    });

    test('a large factor applies too', () => {
      expectError(
        errorOf(() => 1e6 * J().estimate),
        1e6 * e
      );
    });

    test('the square of the inner integral has the error 2·J·e', () => {
      expectError(
        errorOf(() => J().estimate ** 2),
        2 * j * e + e * e
      );
    });

    test('the errors of two inner integrals do not cancel', () => {
      expectError(
        errorOf((y) => J().estimate - J().estimate + (y - 0.5)),
        2 * e
      );
    });

    test('an inner result that is not used gives no error', () => {
      const r = measured((y) => {
        J();
        return y;
      });
      expect(r.error).toBeLessThan(1e-14);
      expect(r.innerQuadrature).toBe(true);
    });

    test('a bound that depends on an inner integral', () => {
      // `∫₀^J x dx = J²/2`.
      expectError(
        errorOf(() => adaptiveQuadrature((x) => x, 0, J().estimate).estimate),
        j * e + (e * e) / 2
      );
    });

    test('a later integrand that uses an inner integral', () => {
      // `∫₀¹ J·x dx = J/2`. The second integral has the same bounds with the
      // changed `J`, and it is computed again: its recorded result does not
      // hold the change.
      expectError(
        errorOf(() => {
          const first = J().estimate;
          return adaptiveQuadrature((x) => first * x, 0, 1).estimate;
        }),
        e / 2
      );
    });

    test('an inner integral of a quadrature that measures its own errors', () => {
      // `M = ∫₀^J J₂ dz = J·J₂`, where the middle quadrature measures the
      // error `J·e` that `J₂` gives to it. With the changed `J`, the middle
      // quadrature has another bound: it runs, and measures, during the
      // measure of the outer quadrature. `J` gives the error `J₂·e`.
      const middle = () => {
        const g = () => J().estimate;
        return adaptiveQuadrature(g, 0, J().estimate, {
          nestedErrors: true,
          replayIntegrand: g,
        });
      };
      expectError(middle().error, j * e);
      expectError(
        errorOf(() => middle().estimate),
        2 * j * e
      );
    });

    test('the measure ends when the integrand throws', () => {
      // The integrand throws for the changed `J`, as an expired deadline
      // does.
      const f = () => {
        const r = J();
        if (r.estimate !== j) throw new Error('changed');
        return r.estimate;
      };
      expect(() => measured(f)).toThrow('changed');
      expect(insideReplay()).toBe(false);
      // A quadrature that runs after it computes its inner integrals, and
      // collects their errors.
      expectError(errorOf(() => 1e-6 * J().estimate), 1e-6 * e);
    });

    test('the integrand can tell that it is evaluated for a measure', () => {
      const seen: boolean[] = [];
      measured((y) => {
        seen.push(insideReplay());
        return y * J().estimate;
      });
      // Each point is evaluated once for its value, then once for the
      // measure.
      expect(seen.length).toBe(2 * 255);
      expect(seen.filter((x) => x).length).toBe(255);
      expect(seen[0]).toBe(false);
      expect(seen[1]).toBe(true);
      expect(insideReplay()).toBe(false);
    });

    test('a value with no finite value on one side of the inner result', () => {
      // `√(j − J)` is 0, and has no real value for `J + e`: the value for
      // `J − e` is used.
      expectError(
        errorOf((y) => Math.sqrt(j - J().estimate) + y),
        Math.sqrt(e)
      );
    });

    test('an integrand that reads its values from a cache', () => {
      const cache = new Map<number, number>();
      const cached = (y: number) => {
        let v = cache.get(y);
        if (v === undefined) {
          v = 1e-6 * J().estimate;
          cache.set(y, v);
        }
        return v;
      };
      // A second call at the same point calls no inner integral, so the
      // error is not measured: it is the larger of `e` and `|v|·e/|J|`.
      expectError(errorOf(cached), e);
      // `replayIntegrand` is the function without the cache.
      cache.clear();
      expectError(
        adaptiveQuadrature(cached, 0, 1, {
          nestedErrors: true,
          replayIntegrand: () => 1e-6 * J().estimate,
        }).error,
        1e-6 * e
      );
    });

    test('an inner integral that only the first evaluation computes', () => {
      // The first evaluation computes `J` and keeps it, then computes the
      // integral of 0 over the same interval. The second evaluation at that
      // point computes only the integral of 0, which is in the position of
      // `J`: the result of `J` must not be returned for it (the value would
      // change by `π`). The error at that point is then not measured, and it
      // is taken as `e`; the other points have no error.
      let kept: number | undefined;
      let evaluations = 0;
      const r = measured((y) => {
        evaluations += 1;
        kept ??= J().estimate;
        const zero = adaptiveQuadrature(() => 0, -Infinity, Infinity);
        return y - 0.5 + zero.estimate;
      });
      expect(kept).toBe(j);
      expect(r.error).toBeLessThanOrEqual(e);
      // The points of the quadrature, and one more evaluation at the first.
      expect(evaluations).toBe(255 + 1);
    });

    test('a point with more than 4 inner integrals is not measured', () => {
      // The measure of an inner integral computes the later ones again, so
      // its cost grows with the square of their number.
      const sum = (n: number) => {
        let evaluations = 0;
        const r = measured(() => {
          evaluations += 1;
          let total = 0;
          for (let k = 0; k < n; k++) total += J().estimate;
          return 1e-6 * total;
        });
        return { error: r.error, evaluations };
      };
      // 4 inner integrals: the point is evaluated once more for each. The
      // integrand is a constant, so its nodes next to each bound are flat,
      // and the deepest probe next to each bound is computed
      // (`boundGapError`): it is evaluated once, and is not measured.
      const four = sum(4);
      expectError(four.error, 4e-6 * e);
      expect(four.evaluations).toBe(5 * 255 + 2);
      // 5 inner integrals: the error is the larger of `Σ e` and
      // `|v|·Σ e/|J|`.
      const five = sum(5);
      expectError(five.error, 5 * e);
      expect(five.evaluations).toBe(255 + 2);
    });

    test('the inner integrals that are computed again', () => {
      // The integrand computes two inner integrals. For the measure of the
      // first, the second is computed again, because its integrand could use
      // the first. For the measure of the second, the last inner integral of
      // the point, nothing is computed again.
      const count = (measure: boolean) => {
        const evaluations = [0, 0];
        const inner = (index: number, y: number) =>
          adaptiveQuadrature(
            (x) => {
              evaluations[index] += 1;
              return Math.sqrt(x);
            },
            0,
            y,
            coarse
          ).estimate;
        const f = (y: number) => (y + 1) * inner(0, y) + inner(1, y);
        adaptiveQuadrature(f, 0, 1, {
          nestedErrors: true,
          replayIntegrand: measure ? f : undefined,
        });
        return evaluations;
      };
      const [first, second] = count(false);
      expect(second).toBe(first);
      expect(count(true)).toEqual([first, 2 * second]);
    });

    test.each([
      // No change of sign: the routine scans the integrand, gives `null`,
      // and the adaptive quadrature gives the integral.
      ['e^(−x)', (x: number) => Math.exp(-x), 1],
      // The first lobe has a singular end and is computed by the adaptive
      // quadrature; the routine sums and accelerates the lobes.
      [
        'sin x/x^1.5',
        (x: number) => Math.sin(x) / x ** 1.5,
        Math.sqrt(2 * Math.PI),
      ],
    ] as [string, (x: number) => number, number][])(
      'the routine for an oscillatory inner integrand does not run again: %s',
      (_, h, truth) => {
        const outer = (nestedErrors: boolean) => {
          let evaluations = 0;
          const counted = (x: number) => {
            evaluations += 1;
            return h(x);
          };
          const f = (y: number) =>
            1e-6 *
            (y + 1) *
            (
              integrateSemiInfiniteOscillatory(counted, 0) ??
              adaptiveQuadrature(counted, 0, Infinity, {
                singularEndpoints: true,
              })
            ).estimate;
          const r = adaptiveQuadrature(f, 0, 1, {
            nestedErrors,
            replayIntegrand: f,
            initialPanels: 1,
          });
          return { r, evaluations };
        };
        const withErrors = outer(true);
        expect(withErrors.evaluations).toBe(outer(false).evaluations);
        expect(
          Math.abs(withErrors.r.estimate - 1.5e-6 * truth)
        ).toBeLessThanOrEqual(withErrors.r.error);
        // The factor `1e-6·(y + 1)` applies to the error of the inner
        // integral, which is smaller than `1e-9`.
        expect(withErrors.r.error).toBeLessThan(1e-15);
        expect(withErrors.r.innerQuadrature).toBe(true);
      }
    );
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

  /**
   * The inner integral `I(y) = ∫₀¹ e^(−xy)/x^0.99 dx` has an error of about
   * `1e-10`, and of about `0.1` for `y > 1000`, where it does not converge.
   * The factor of `I(y)` in the integrand applies to this error.
   */
  describe('a factor of the inner integral applies to its error', () => {
    const measurement = (ce: ComputeEngine, latex: string) => {
      const json = ce.parse(latex).N().json as [string, number, number];
      expect(json[0]).toBe('Measurement');
      return { value: json[1], error: json[2] };
    };
    // `∫₀^∞ e^(−y)·I(y) dy = ∫₀¹ x^(−0.99)/(1 + x) dx
    // = (ψ(0.505) − ψ(0.005))/2`.
    const decayTruth = 99.31498827291576;

    test('the factor e^(−y) over [0, ∞)', () => {
      const r = measurement(
        new ComputeEngine(),
        '\\int_0^{\\infty} e^{-y}\\int_0^1 \\frac{e^{-xy}}{x^{0.99}} dx dy'
      );
      expect(Math.abs(r.value - decayTruth)).toBeLessThanOrEqual(r.error);
      expect(r.error).toBeLessThan(1e-7);
    });

    test('the factor e^(−y) of a called function', () => {
      const ce = new ComputeEngine();
      ce.assign(
        'F',
        ce.parse('y \\mapsto \\int_0^1 \\frac{e^{-xy}}{x^{0.99}} dx')
      );
      const r = measurement(ce, '\\int_0^{\\infty} e^{-y} F(y) dy');
      expect(Math.abs(r.value - decayTruth)).toBeLessThanOrEqual(r.error);
      expect(r.error).toBeLessThan(1e-7);
    });

    test('the factor 10^(−12) over [0, 1]', () => {
      const r = measurement(
        new ComputeEngine(),
        '\\int_0^1 10^{-12}\\int_0^1 \\frac{e^{-xy}}{x^{0.99}} dx dy'
      );
      const truth = 1e-12 * 99.57585719444842;
      expect(Math.abs(r.value - truth)).toBeLessThanOrEqual(r.error);
      expect(r.error).toBeLessThan(1e-20);
    });
  });

  /**
   * An integrand that did not compile is measured too: the function `G` has
   * only an `evaluate` handler. Its inner integral `∫₀^y √x dx` is computed
   * on two panels, with an error of about `1e-2`.
   */
  describe('an integrand that did not compile', () => {
    const integral = (body: unknown[]) => {
      const ce = new ComputeEngine();
      // The evaluations of `G`, and those that computed the inner integral.
      const count = { evaluations: 0, computed: 0 };
      ce.declare('G', {
        signature: '(real) -> real',
        evaluate: ([y]) => {
          count.evaluations += 1;
          let computed = false;
          const r = adaptiveQuadrature(
            (x) => {
              computed = true;
              return Math.sqrt(x);
            },
            0,
            y.re,
            { maxIntervals: 2, initialPanels: 1 }
          );
          if (computed) count.computed += 1;
          return ce.number(r.estimate);
        },
      });
      const json = ce
        .box(['Integrate', ['Function', body, 'y'], ['Limits', 'y', 0, 1]])
        .N().json as [string, number, number];
      expect(json[0]).toBe('Measurement');
      return { value: json[1], error: json[2], ...count };
    };
    const truth = 1e-6 * (4 / 15);

    test('the factor 10^(−6) applies to the error of the inner integral', () => {
      const r = integral(['Multiply', 1e-6, ['G', 'y']]);
      expect(Math.abs(r.value - truth)).toBeLessThanOrEqual(r.error);
      expect(r.error).toBeLessThan(1e-8);
      // Each point is evaluated a second time for the measure, and the
      // inner integral is not computed then.
      expect(r.evaluations).toBe(2 * r.computed);
    });

    test('an integrand with an effect is not evaluated a second time', () => {
      // `Random()` would draw a second number at each point. The error of a
      // value is then not measured: it is the error of the inner integral,
      // with no factor.
      const r = integral([
        'Add',
        ['Multiply', 1e-6, ['G', 'y']],
        ['Multiply', 1e-300, ['Random']],
      ]);
      expect(r.evaluations).toBe(r.computed);
      expect(Math.abs(r.value - truth)).toBeLessThanOrEqual(r.error);
      expect(r.error).toBeGreaterThan(1e-4);
    });
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
      // The number of evaluations of `G` that computed the inner integral.
      // The quadrature evaluates `G` a second time at each point to measure
      // how its value changes with the inner integral; the inner integral is
      // not computed then, so its integrand is not called.
      let evaluations = 0;
      ce.declare('G', {
        signature: `(real) -> ${resultType}`,
        evaluate: ([y]) => {
          let computed = false;
          const r = adaptiveQuadrature(
            (x) => {
              computed = true;
              return Math.exp(-x);
            },
            0,
            y.re
          );
          if (computed) evaluations += 1;
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
