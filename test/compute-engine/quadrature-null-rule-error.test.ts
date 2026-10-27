import {
  adaptiveQuadrature,
  gk15,
  GK15_NULL_RULES_FOR_TESTS,
  splitPointIsJump,
} from '../../src/compute-engine/numerics/gauss-kronrod';
import { extrapolateCorner } from '../../src/compute-engine/numerics/endpoint-quadrature';

/**
 * The error of a Gauss–Kronrod (GK15) panel is at least the estimate of 8
 * null rules of its 15 samples (`nullRuleError`,
 * `numerics/gauss-kronrod.ts`), ROADMAP CE-533. Before, the error was only
 * the QUADPACK error, which is computed from one number: the Kronrod sum
 * minus the Gauss sum. When the integrand has a kink inside the panel, this
 * difference can be near 0 by chance, and the panel reported an error much
 * smaller than its true error.
 *
 * The integrand of the witness is the inner integrand of the Tycho document
 * `neyret/2agcgxq87y`: `1/max(ε, max(0, √(x² + y²) − 1))` for
 * `x < −√(1 − y²)`, else 0, with `y = 0.758125` and `ε = 0.01`. On the panel
 * `[−0.6689453125, −0.66650390625]` it has a kink at 0.31 of the half-width
 * from the center. The difference of the two sums was `1.2e-10`, the panel
 * reported an error of `4e-11`, and its true error is `1.6e-5`.
 */

function innerIntegrand(y: number, eps: number): (x: number) => number {
  const cut = -Math.sqrt(1 - y * y);
  return (x) =>
    x < cut ? 1 / Math.max(eps, Math.max(0, Math.hypot(x, y) - 1)) : 0;
}

/**
 * An antiderivative of `1/(√(x² + y²) − 1)` where `√(x² + y²) > 1`, for
 * `0 < y < 1`. With `x = y·sinh u` the integrand is
 * `1 + 1/(y·cosh u − 1)`, and with `t = tanh(u/2)` the second term is
 * `(2/(y + 1))/(t² − a²)` in `t`, with `a² = (1 − y)/(1 + y)`.
 */
function tailAntiderivative(x: number, y: number): number {
  const u = Math.asinh(x / y);
  const t = Math.tanh(u / 2);
  const a = Math.sqrt((1 - y) / (1 + y));
  return u + Math.log(Math.abs((t - a) / (t + a))) / ((y + 1) * a);
}

/** The integral of `innerIntegrand` on `[lo, hi]`, in closed form: the
 * integrand is `1/(√(x² + y²) − 1)` left of its kink, `1/ε` between the kink
 * and the jump, and 0 right of the jump (`0 < y < 1`, `lo < 0`). */
function innerReference(y: number, eps: number, lo = -10, hi = 10): number {
  const kink = -Math.sqrt((1 + eps) ** 2 - y * y);
  const jump = -Math.sqrt(1 - y * y);
  let sum = 0;
  if (Math.min(hi, kink) > lo)
    sum +=
      tailAntiderivative(Math.min(hi, kink), y) - tailAntiderivative(lo, y);
  const c = Math.max(lo, kink);
  const d = Math.min(hi, jump);
  if (d > c) sum += (d - c) / eps;
  return sum;
}

describe('THE NULL RULES OF THE GK15 NODES', () => {
  const { nodes, rules } = GK15_NULL_RULES_FOR_TESTS;

  test('there are 15 nodes and 8 rules', () => {
    expect(nodes.length).toBe(15);
    expect(rules.length).toBe(8);
    for (const rule of rules) expect(rule.length).toBe(15);
  });

  test('the rule i is 0 on the polynomials of degree at most 13 − i', () => {
    rules.forEach((rule, i) => {
      for (let j = 0; j <= 13 - i; j++) {
        const moment = rule.reduce((s, w, k) => s + w * nodes[k] ** j, 0);
        expect(Math.abs(moment)).toBeLessThan(1e-14);
      }
      // It is not 0 on the next degree.
      const next = rule.reduce((s, w, k) => s + w * nodes[k] ** (14 - i), 0);
      expect(Math.abs(next)).toBeGreaterThan(1e-5);
    });
  });

  test('the rules are orthogonal, with the norm of the Kronrod weights', () => {
    // The Kronrod weights, from `−1` to `1`.
    const w = [
      0.0229353220105292, 0.0630920926299786, 0.1047900103222502,
      0.1406532597155259, 0.1690047266392679, 0.1903505780647854,
      0.2044329400752989, 0.2094821410847278,
    ];
    const weights = [...w, ...w.slice(0, 7).reverse()];
    const norm = Math.hypot(...weights);
    for (let i = 0; i < rules.length; i++)
      for (let j = 0; j < rules.length; j++) {
        const dot = rules[i].reduce((s, v, k) => s + v * rules[j][k], 0);
        if (i === j) expect(dot).toBeCloseTo(norm * norm, 14);
        else expect(Math.abs(dot)).toBeLessThan(1e-15);
      }
  });
});

describe('A KINK INSIDE A PANEL', () => {
  test('the witness panel reports an error that bounds its true error', () => {
    const [a, b] = [-0.6689453125, -0.66650390625];
    const p = gk15(innerIntegrand(0.758125, 0.01), a, b);
    const trueError = Math.abs(p.value - innerReference(0.758125, 0.01, a, b));
    expect(trueError).toBeGreaterThan(1e-5);
    expect(p.error).toBeGreaterThanOrEqual(trueError);
  });

  // `10x + 3 + 0.01·max(0, x − t)` on `[−1, 1]`: its integral is
  // `6 + 0.01·(1 − t)²/2`. At each of these positions, the QUADPACK error
  // was smaller than the true error (by 10 to 200 times).
  test.each([-0.822, -0.679, -0.508, -0.316, 0.317, 0.509, 0.68, 0.823])(
    'a kink at t = %p: the error bounds the true error',
    (t) => {
      const p = gk15((x) => 10 * x + 3 + 0.01 * Math.max(0, x - t), -1, 1);
      const trueError = Math.abs(p.value - (6 + (0.01 * (1 - t) ** 2) / 2));
      expect(p.error).toBeGreaterThanOrEqual(trueError);
    }
  );

  test('a kink at any position between the outer nodes', () => {
    // The outer nodes are at `±0.9915`. Nearer to an endpoint, a kink is
    // seen by one node or none (see `hiddenEdgeError`).
    let misses = 0;
    for (let i = -990; i <= 990; i++) {
      const t = i / 1000;
      for (const [f, truth] of [
        [
          (x: number) => 10 * x + 3 + 0.01 * Math.max(0, x - t),
          6 + (0.01 * (1 - t) ** 2) / 2,
        ],
        [
          (x: number) => Math.exp(x) + 0.01 * Math.abs(x - t),
          Math.E - 1 / Math.E + 0.01 * (1 + t * t),
        ],
      ] as [(x: number) => number, number][]) {
        const p = gk15(f, -1, 1);
        if (Math.abs(p.value - truth) > p.error) misses += 1;
      }
    }
    expect(misses).toBe(0);
  });

  test.each([
    // The witness: the true error was `1.6e-5`, the reported error `5.7e-10`.
    [0.758125, 0.01],
    // The refinement goes deep at the jump. The interval was split there
    // (`interiorSingularPoint`), `2.4e-12` from the jump, and the half on
    // the other side of the jump reported `0 ± 0` for an integral of
    // `2.4e-9`. The interval is not split at a jump any more
    // (`splitPointIsJump`).
    [0.374625, 0.001],
  ])(
    'the adaptive quadrature, y = %p, ε = %p: the error bounds the true error',
    (y, eps) => {
      const r = adaptiveQuadrature(innerIntegrand(y, eps), -10, 10, {
        singularEndpoints: true,
      });
      expect(r.converged).toBe(true);
      expect(Math.abs(r.estimate - innerReference(y, eps))).toBeLessThanOrEqual(
        r.error
      );
    }
  );

  test('the inner integrals of the Tycho document, ε = 0.001 to 0.2', () => {
    // 20 values of `y` for each `ε`. With the QUADPACK error alone and no
    // sample at a split point, 10 of these 120 integrals reported an error
    // smaller than their true error (9 with `ε = 0.001`, up to 300 times
    // smaller).
    let misses = 0;
    for (const eps of [0.001, 0.005, 0.01, 0.05, 0.1, 0.2])
      for (let i = 0; i < 20; i++) {
        const y = ((i + 0.5) / 20) * 0.999;
        const r = adaptiveQuadrature(innerIntegrand(y, eps), -10, 10, {
          singularEndpoints: true,
        });
        if (Math.abs(r.estimate - innerReference(y, eps)) > r.error)
          misses += 1;
      }
    expect(misses).toBe(0);
  });
});

/**
 * The null rules do not refine a smooth integrand more: the evaluation
 * counts and errors are the same as with the QUADPACK error alone. On the
 * panels of these integrands, the pairs of null rules either decrease fast
 * or are of the size of the rounding of the samples (`NULL_RULE_NOISE_ULPS`).
 */
describe('THE COST ON SMOOTH INTEGRANDS AND ENDPOINT SINGULARITIES', () => {
  test.each([
    ['eˣ on [0, 1]', Math.exp, 0, 1, Math.E - 1, false, 255],
    ['sin x on [0, π]', Math.sin, 0, Math.PI, 2, false, 255],
    [
      '1/(1 + x²) on [−5, 5]',
      (x: number) => 1 / (1 + x * x),
      -5,
      5,
      2 * Math.atan(5),
      false,
      255,
    ],
    ['√x on [0, 1]', Math.sqrt, 0, 1, 2 / 3, false, 705],
    ['ln x on [0, 1]', Math.log, 0, 1, -1, false, 1125],
    ['√x on [0, 1], singular endpoints', Math.sqrt, 0, 1, 2 / 3, true, 780],
    ['ln x on [0, 1], singular endpoints', Math.log, 0, 1, -1, true, 1200],
    [
      'x^(−1/2) on [0, 1], singular endpoints',
      (x: number) => x ** -0.5,
      0,
      1,
      2,
      true,
      2160,
    ],
    [
      'ln x/√x on [0, 1], singular endpoints',
      (x: number) => Math.log(x) / Math.sqrt(x),
      0,
      1,
      -4,
      true,
      2430,
    ],
    [
      'x^(−0.9) on [0, 1], singular endpoints',
      (x: number) => x ** -0.9,
      0,
      1,
      10,
      true,
      9900,
    ],
  ] as [
    string,
    (x: number) => number,
    number,
    number,
    number,
    boolean,
    number,
  ][])('%s', (_, f, a, b, truth, singularEndpoints, count) => {
    let evaluations = 0;
    const r = adaptiveQuadrature(
      (x) => {
        evaluations += 1;
        return f(x);
      },
      a,
      b,
      { singularEndpoints }
    );
    expect(r.converged).toBe(true);
    expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
    expect(evaluations).toBe(count);
  });
});

/** `∫₋₁¹ |x − c|^(−p) dx`. */
const powerIntegral = (c: number, p: number) =>
  ((1 + c) ** (1 - p) + (1 - c) ** (1 - p)) / (1 - p);

/**
 * The accuracy test of the shells next to a singular endpoint
 * (`SHELL_RELATIVE_ERROR`, `endpoint-quadrature.ts`) reads the QUADPACK error
 * of a panel (`quadpackError`), not the error with the null rules.
 */
describe('THE SHELLS NEXT TO A SINGULAR ENDPOINT', () => {
  test('∫₋₁¹ |x − 0.7|^(−3/4) dx converges', () => {
    // With the null-rule error in the test of the shells, and the test
    // loosened to 1e-7, inaccurate shells were extrapolated: `± 2.5e-7` for a
    // true error of `9.1e-4`. With the rounding of the nodes
    // (`positionShift`) in the errors of the shells, the result was not
    // converged, `± 3.2e-9`, for a true error of `1.6e-12`.
    const r = adaptiveQuadrature((x) => Math.abs(x - 0.7) ** -0.75, -1, 1, {
      singularEndpoints: true,
    });
    expect(r.converged).toBe(true);
    expect(Math.abs(r.estimate - powerIntegral(0.7, 0.75))).toBeLessThanOrEqual(
      r.error
    );
  });

  test('the shells of ∫₀¹ sin(3·ln t)/t dt oscillate', () => {
    // With the null-rule error in the test of the shells, no shell passed
    // it, and the oscillation was not found.
    for (const maxIntervals of [100, 330, 1500]) {
      const r = adaptiveQuadrature((t) => Math.sin(3 * Math.log(t)) / t, 0, 1, {
        maxIntervals,
        singularEndpoints: true,
      });
      expect(r.divergent).toBe(true);
      expect(r.oscillates).toBe(true);
    }
  });

  // The singular point is not exact in binary. The search for it stopped
  // one double below `0.3`, and the half that held the singular point was 3
  // doubles wide: the result was `± 6e-13` for a true error of `2.2e-8`
  // (`± 3.9e-10` for `1.3e-8` before the null rules, after 28,480
  // evaluations). The split point now moves to the double where `|f|` is
  // largest (`interiorSingularPoint`).
  test.each([
    [0.3, true],
    [0.3, false],
    [1 / 3, true],
    [0.1, true],
  ])(
    '∫₋₁¹ |x − %p|^(−1/2) dx, singular endpoints %p: the error bounds the true error',
    (c, singularEndpoints) => {
      let evaluations = 0;
      const r = adaptiveQuadrature(
        (x) => {
          evaluations += 1;
          return Math.abs(x - c) ** -0.5;
        },
        -1,
        1,
        { singularEndpoints }
      );
      expect(Math.abs(r.estimate - powerIntegral(c, 0.5))).toBeLessThanOrEqual(
        r.error
      );
      // Without singular endpoints, the result does not converge.
      expect(r.converged).toBe(singularEndpoints);
      if (singularEndpoints) expect(evaluations).toBeLessThan(10000);
    }
  );

  test.each([
    [0.3, 1e-6, 1],
    [0.3, 1e-8, 1],
    [0.3, 1e-4, 1],
    [0.5, -1e-6, 5],
  ])(
    'a step at %p next to a singularity at a distance %p (height %p)',
    (s, gap, h) => {
      // `(x < s ? 0 : h) + |x − c|^(−1/2)` on `[0, 1]`, `c = s + gap`. The
      // interval is split at `c`, and the step is in the shells next to the
      // singular endpoint `c`. The shell that holds it was inaccurate, the
      // shells after it were accurate, and the extrapolation of the shells
      // before it left out the strip between `s` and `c`: `± 3.1e-12` for
      // a true error of `1e-6` (`s = 0.3`, `gap = 1e-6`).
      const c = s + gap;
      const truth = h * (1 - s) + 2 * (Math.sqrt(c) + Math.sqrt(1 - c));
      const r = adaptiveQuadrature(
        (x) => (x < s ? 0 : h) + Math.abs(x - c) ** -0.5,
        0,
        1,
        { singularEndpoints: true }
      );
      expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
    }
  );

  test('the uncertainty of an extrapolation includes the null rules', () => {
    // The shells of `x^(−1/2)` next to 0 on a corner of width 1. Their
    // QUADPACK errors pass the accuracy test, and their full errors (with
    // the null rules) are in the uncertainty of the extrapolation.
    const shells = Array.from(
      { length: 30 },
      (_, k) => 2 * (2 ** (-k / 2) - 2 ** (-(k + 1) / 2))
    );
    const corner = { shells, value: 2, error: 1e-12, width: 1, endpoint: 0 };
    const full = shells.map((v) => 1e-7 * Math.abs(v));
    const sum = full.reduce((a, b) => a + b, 0);
    const r = extrapolateCorner({
      ...corner,
      shellErrors: full,
      shellQuadpackErrors: shells.map((v) => 1e-14 * Math.abs(v)),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.error).toBeGreaterThanOrEqual(sum);
    // Without the QUADPACK errors, the full errors fail the accuracy test.
    expect(extrapolateCorner({ ...corner, shellErrors: full }).ok).toBe(false);
  });

  test.each([Infinity, NaN])(
    'a shell with the error %p is not accurate',
    (bad) => {
      // A panel with a node position that is not finite has the error `+∞`
      // (`gk15`), and its QUADPACK error is finite. The last shell has
      // such an error: the extrapolation uses the 29 shells before it.
      const shells = Array.from(
        { length: 30 },
        (_, k) => 2 * (2 ** (-k / 2) - 2 ** (-(k + 1) / 2))
      );
      const shellErrors = shells.map((v) => 1e-14 * Math.abs(v));
      shellErrors[29] = bad;
      const r = extrapolateCorner({
        shells,
        shellErrors,
        shellQuadpackErrors: shells.map((v) => 1e-14 * Math.abs(v)),
        value: 2,
        error: 1e-12,
        width: 1,
        endpoint: 0,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(Number.isFinite(r.error)).toBe(true);
    }
  );
});

/**
 * A jump at `J = offset + 0.3` on `[offset, offset + 1]`. The spacing of the
 * doubles at `J` grows with the offset, and the area of `1003` times that
 * spacing cannot be resolved by the panels.
 */
describe('A JUMP AWAY FROM 0', () => {
  test.each([
    [0, true],
    [1e3, true],
    [1e6, false],
    [1e9, false],
  ])('offset %p', (offset, converges) => {
    const jump = offset + 0.3;
    // The exact integral of the doubles: `jump − offset` and
    // `offset + 1 − jump` are exact differences.
    const truth = 1000 * (jump - offset) - 3 * (offset + 1 - jump);
    for (const singularEndpoints of [true, false]) {
      let evaluations = 0;
      const r = adaptiveQuadrature(
        (x) => {
          evaluations += 1;
          return x < jump ? 1000 : -3;
        },
        offset,
        offset + 1,
        { singularEndpoints }
      );
      expect(r.converged).toBe(converges);
      expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
      // The interval is not split at the jump (`splitPointIsJump`). Split,
      // `offset = 1000` took 7,000 evaluations and reported `2.7e-13` for a
      // true error of `3.4e-10`.
      expect(evaluations).toBeLessThan(4000);
    }
  });
});

describe('A KINK HIDDEN BY A SMOOTH PART', () => {
  test('the adaptive quadrature resolves it', () => {
    // On the single panel `[−1, 1]` the error is `1.9e-6` for a true error
    // of `8.3e-5`: the null rules see `e^(5x)` more than the kink.
    const f = (x: number) => Math.exp(5 * x) + 0.0316 * Math.abs(x - 0.51);
    const truth =
      (Math.exp(5) - Math.exp(-5)) / 5 +
      (0.0316 * ((1 + 0.51) ** 2 + (1 - 0.51) ** 2)) / 2;
    for (const initialPanels of [1, 16]) {
      const r = adaptiveQuadrature(f, -1, 1, { initialPanels });
      expect(r.converged).toBe(true);
      expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
    }
  });
});

describe('splitPointIsJump', () => {
  const jump = (x: number) => (x < 0.3 ? 1000 : -3);
  test('a jump, from either side', () => {
    expect(splitPointIsJump(jump, 0, 1, 0.3 - 1e-12)).toBe(true);
    expect(splitPointIsJump(jump, 0, 1, 0.3)).toBe(true);
  });
  test('one level, or an oscillation, is not a jump', () => {
    expect(splitPointIsJump(() => 1, 0, 1, 0.5)).toBe(false);
    // `δ = 2⁻³⁰` on `[0, 1]`: periods of `δ` and `2δ`.
    const d = 2 ** -30;
    for (const period of [d, 2 * d])
      expect(
        splitPointIsJump(
          (x) => Math.cos((2 * Math.PI * (x - 0.5)) / period),
          0,
          1,
          0.5
        )
      ).toBe(false);
  });
  test('a jump on a slope', () => {
    expect(
      splitPointIsJump((x) => (x < 0.3 ? 1000 : -3) + 50 * x, 0, 1, 0.3)
    ).toBe(true);
  });
  test('a logarithm next to a large constant is not a jump', () => {
    // The relative spread of the values is small (`2e-4`); the spread
    // against the largest difference of two runs is not.
    const c = 0.3;
    expect(
      splitPointIsJump(
        (x) => 100000 - Math.log(Math.abs(x - c)),
        0,
        1,
        c + 1e-15
      )
    ).toBe(false);
  });
  test('a pole or a logarithm is not a jump', () => {
    const c = 0.3;
    const s = c + 1e-15;
    expect(splitPointIsJump((x) => Math.abs(x - c) ** -0.5, 0, 1, s)).toBe(
      false
    );
    expect(splitPointIsJump((x) => Math.log(Math.abs(x - c)), 0, 1, s)).toBe(
      false
    );
  });
  test('a sample that is not finite is not a jump', () => {
    expect(splitPointIsJump(() => NaN, 0, 1, 0.5)).toBe(false);
    expect(splitPointIsJump((x) => (x === 0.5 ? Infinity : 1), 0, 1, 0.5)).toBe(
      false
    );
  });
  test('the endpoints of the interval are never sampled', () => {
    // An interval of 3 doubles: the samples next to `s` would be the
    // endpoints.
    const lo = 1;
    const s = lo + Number.EPSILON;
    const hi = s + Number.EPSILON;
    const f = (x: number) => {
      if (x <= lo || x >= hi) throw new Error('an endpoint was sampled');
      return 1;
    };
    expect(splitPointIsJump(f, lo, hi, s)).toBe(false);
  });
  test('an integrand that throws at the endpoints of the integral', () => {
    // A jump inside, singular endpoints: no sample at 0 or 1.
    const f = (x: number) => {
      if (x <= 0 || x >= 1) throw new Error('an endpoint was sampled');
      return x < 0.3 ? 1000 : -3;
    };
    const r = adaptiveQuadrature(f, 0, 1, { singularEndpoints: true });
    expect(Math.abs(r.estimate - (1000 * 0.3 - 3 * 0.7))).toBeLessThanOrEqual(
      r.error + 1e-12
    );
  });
});

describe('A SMOOTH INTEGRAND ON A PANEL FEW DOUBLES WIDE', () => {
  test('∫ e^(x − 10⁹) dx over [10⁹, 10⁹ + 10⁻⁶]', () => {
    // The panel is 8 doubles wide, and its 15 nodes round to 9 doubles. The
    // null rules measured the rounding of the positions of the nodes: the
    // result was not converged, `± 1.1e-13`, after 225 evaluations.
    const a = 1e9;
    const b = a + 1e-6;
    let evaluations = 0;
    const r = adaptiveQuadrature(
      (x) => {
        evaluations += 1;
        return Math.exp(x - a);
      },
      a,
      b
    );
    expect(r.converged).toBe(true);
    expect(Math.abs(r.estimate - Math.expm1(b - a))).toBeLessThanOrEqual(
      r.error
    );
    expect(evaluations).toBeLessThanOrEqual(30);
  });

  // Each node is up to half a unit in the last place of the center from its
  // exact position, whatever the width of the panel (`positionShift`). A
  // test that read the shifts only on panels narrower than 2²⁰ doubles left
  // these results `converged` with an error smaller than the true error
  // (`sin(10³·(x − a))` over `[10⁶, 10⁶ + 0.01]`: `± 2.2e-13` for
  // `2.3e-11`). Each result now bounds its true error, and is not
  // converged when its true relative error is above `rtol = 1e-10`.
  const W = (a: number, w: number) => a + w - a;
  test.each([
    [
      'sin(10³·(x − a)), a = 10⁶, w = 0.01',
      1e6,
      0.01,
      (u: number) => Math.sin(1e3 * u),
      (w: number) => (1 - Math.cos(1e3 * w)) / 1e3,
      1,
    ],
    [
      'sin(10³·(x − a)), a = 10⁵, w = 10⁻³',
      1e5,
      1e-3,
      (u: number) => Math.sin(1e3 * u),
      (w: number) => (1 - Math.cos(1e3 * w)) / 1e3,
      16,
    ],
    [
      'e^(x − a), a = 10⁶, w = 0.01',
      1e6,
      0.01,
      (u: number) => Math.exp(u),
      (w: number) => Math.expm1(w),
      16,
    ],
    [
      'e^(x − a), a = 10⁶, w = 1',
      1e6,
      1,
      (u: number) => Math.exp(u),
      (w: number) => Math.expm1(w),
      16,
    ],
    [
      '(x − a)², a = 10⁵, w = 0.01',
      1e5,
      0.01,
      (u: number) => u * u,
      (w: number) => (w * w * w) / 3,
      16,
    ],
    [
      '(x − a)², a = 10⁶, w = 1',
      1e6,
      1,
      (u: number) => u * u,
      (w: number) => (w * w * w) / 3,
      16,
    ],
    [
      'x − a, a = 2³⁰, w = 1 + 2⁻²², one panel',
      2 ** 30,
      1 + 2 ** -22,
      (u: number) => u,
      (w: number) => (w * w) / 2,
      1,
    ],
  ] as [
    string,
    number,
    number,
    (u: number) => number,
    (w: number) => number,
    number,
  ][])('%s', (_, a, w, f, integral, initialPanels) => {
    const b = a + w;
    const truth = integral(W(a, w));
    const r = adaptiveQuadrature((x) => f(x - a), a, b, { initialPanels });
    const trueError = Math.abs(r.estimate - truth);
    expect(trueError).toBeLessThanOrEqual(r.error);
    if (trueError > 1e-10 * Math.abs(truth)) expect(r.converged).toBe(false);
  });

  test.each([
    [1e9, 1e-5],
    [1e9, 1e-4],
    [1e9, 1e-3],
    [1e6, 1e-9],
  ])('∫ e^(x − a) dx over [a, a + w], a = %p, w = %p', (a, w) => {
    // The nodes round to the doubles, and the rule samples the integrand
    // away from the exact nodes (`positionShift`). With `w = 10⁻⁴`, the
    // result was `converged`, `± 1.1e-18`, for a true error of `3.8e-13`
    // (`± 9.2e-15` for `9.2e-14` before the null rules).
    const b = a + w;
    const r = adaptiveQuadrature((x) => Math.exp(x - a), a, b);
    expect(Math.abs(r.estimate - Math.expm1(b - a))).toBeLessThanOrEqual(
      r.error
    );
  });
});

/**
 * A singular point some doubles inside an endpoint of the interval
 * (`offsetSingularity`, `endpoint-quadrature.ts`). The shells next to the
 * endpoint are accurate only down to 2²⁰ doubles from it, and the model of
 * the part nearer to it has the singularity AT the endpoint. With `c` 1 to
 * 1,000 doubles above `0.3`, `∫_0.3^1 |t − c|^(−1/2) dt` was `converged`
 * with an error of about `2e-13`, for true errors of `1.5e-8` to `4.7e-7`.
 */
describe('A SINGULARITY SOME DOUBLES INSIDE AN ENDPOINT', () => {
  const integral = (c: number, lo: number, hi: number) =>
    2 * Math.sqrt(c - lo) + 2 * Math.sqrt(hi - c);
  test.each([
    ['0.1·3 on [0.3, 1]', 0.1 * 3, 0.3, 1],
    ['0.7 + 0.1 + 0.1 on [0, 0.9]', 0.7 + 0.1 + 0.1, 0, 0.9],
    ...[1, 2, 10, 100, 1000, 1e5, 1e8].map(
      (k) =>
        [`0.3 + ${k} doubles on [0.3, 1]`, 0.3 + k * 2 ** -54, 0.3, 1] as [
          string,
          number,
          number,
          number,
        ]
    ),
  ] as [string, number, number, number][])('%s', (_, c, lo, hi) => {
    const r = adaptiveQuadrature((t) => Math.abs(t - c) ** -0.5, lo, hi, {
      singularEndpoints: true,
    });
    expect(Math.abs(r.estimate - integral(c, lo, hi))).toBeLessThanOrEqual(
      r.error
    );
  });

  test('the midpoint of [1, 1 + 2⁻³²] is split off', () => {
    // Every point of the interval is within 2²⁰ doubles of an endpoint. The
    // interval was not split at the singular point, which is 2²⁰ doubles
    // from each endpoint, and the error was `+∞`.
    const lo = 1;
    const hi = 1 + 2 ** -32;
    const c = (lo + hi) / 2;
    const r = adaptiveQuadrature((t) => Math.abs(t - c) ** -0.5, lo, hi, {
      singularEndpoints: true,
    });
    expect(Number.isFinite(r.error)).toBe(true);
    expect(Math.abs(r.estimate - integral(c, lo, hi))).toBeLessThanOrEqual(
      r.error
    );
  });

  // The cases of ROADMAP CE-376, with the singularity AT an endpoint.
  test.each([
    [
      '(t − 1/3)^(−1/2) on [1/3, 2]',
      (t: number) => (t - 1 / 3) ** -0.5,
      1 / 3,
      2,
      2 * Math.sqrt(2 - 1 / 3),
    ],
    [
      't^(−1/2) on [0, 5/3]',
      (t: number) => t ** -0.5,
      0,
      5 / 3,
      2 * Math.sqrt(5 / 3),
    ],
    ['(t − 1)^(−1/2) on [1, 2]', (t: number) => (t - 1) ** -0.5, 1, 2, 2],
  ] as [string, (t: number) => number, number, number, number][])(
    '%s converges',
    (_, f, lo, hi, truth) => {
      const r = adaptiveQuadrature(f, lo, hi, { singularEndpoints: true });
      expect(r.converged).toBe(true);
      expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
    }
  );
});

/**
 * A singularity AT an endpoint that is not 0. The rounding of the nodes
 * (`positionShift`) is not in the errors of the shells that the
 * extrapolation reads: with it, `∫₁² (x − 1)^(−0.9) dx` was not converged,
 * `± 8.3e-9`, for a true error of `1.7e-12`.
 */
describe('A SINGULARITY AT AN ENDPOINT THAT IS NOT 0', () => {
  test.each([
    ['(x − 1)^(−0.75) on [1, 2]', (x: number) => (x - 1) ** -0.75, 1, 2, 4],
    ['(x − 1)^(−0.8) on [1, 2]', (x: number) => (x - 1) ** -0.8, 1, 2, 5],
    [
      '(x − 1)^(−0.85) on [1, 2]',
      (x: number) => (x - 1) ** -0.85,
      1,
      2,
      1 / 0.15,
    ],
    ['(x − 1)^(−0.9) on [1, 2]', (x: number) => (x - 1) ** -0.9, 1, 2, 10],
    ['(1 − x)^(−0.8) on [0, 1]', (x: number) => (1 - x) ** -0.8, 0, 1, 5],
    [
      '(1 − x)^(−0.85) on [0, 1]',
      (x: number) => (1 - x) ** -0.85,
      0,
      1,
      1 / 0.15,
    ],
    ['(1 − x)^(−0.9) on [0, 1]', (x: number) => (1 - x) ** -0.9, 0, 1, 10],
    [
      '(x − 3)^(−0.8) on [3, 3.5]',
      (x: number) => (x - 3) ** -0.8,
      3,
      3.5,
      0.5 ** 0.2 / 0.2,
    ],
    [
      '(x − 3)^(−0.9) on [3, 3.5]',
      (x: number) => (x - 3) ** -0.9,
      3,
      3.5,
      0.5 ** 0.1 / 0.1,
    ],
    [
      '(x − 1)^(−1/2)·ln(x − 1) on [1, 2]',
      (x: number) => (x - 1) ** -0.5 * Math.log(x - 1),
      1,
      2,
      -4,
    ],
    ['ln(x − 1) on [1, 2]', (x: number) => Math.log(x - 1), 1, 2, -1],
  ] as [string, (x: number) => number, number, number, number][])(
    '%s converges',
    (_, f, lo, hi, truth) => {
      const r = adaptiveQuadrature(f, lo, hi, { singularEndpoints: true });
      expect(r.converged).toBe(true);
      expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
    }
  );
});

/**
 * A singular point some doubles OUTSIDE an endpoint. The model of the shells
 * puts the area of a singularity AT the endpoint, which is not there:
 * `|t − (0.7 − 0.4)|^(−1/2)` on `[0.3, 1]` (singular one double below 0.3)
 * was `converged`, `± 4e-13`, for a true error of `1.5e-8`.
 */
describe('A SINGULARITY SOME DOUBLES OUTSIDE AN ENDPOINT', () => {
  const outside = (c: number) => 2 * Math.sqrt(1 - c) - 2 * Math.sqrt(0.3 - c);
  test.each([
    ['0.7 − 0.4', 0.7 - 0.4],
    ['0.3 − 5·2⁻⁵⁴', 0.3 - 5 * 2 ** -54],
    ['0.3 − 20·2⁻⁵⁴', 0.3 - 20 * 2 ** -54],
    ['0.3 − 100·2⁻⁵⁴', 0.3 - 100 * 2 ** -54],
  ] as [string, number][])('|t − (%s)|^(−1/2) on [0.3, 1]', (_, c) => {
    const r = adaptiveQuadrature((t) => Math.abs(t - c) ** -0.5, 0.3, 1, {
      singularEndpoints: true,
    });
    expect(Math.abs(r.estimate - outside(c))).toBeLessThanOrEqual(r.error);
  });

  test.each([3e-14, 1e-14, 1e-15])('1/√(x − 1 + %p) on [1, 2]', (d) => {
    const r = adaptiveQuadrature((x) => 1 / Math.sqrt(x - 1 + d), 1, 2, {
      singularEndpoints: true,
    });
    const truth = 2 * Math.sqrt(1 + d) - 2 * Math.sqrt(d);
    expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
  });
});

/**
 * The exponent of a singular point some doubles inside an endpoint, read
 * from the samples beyond it. A bound valid for `p ≤ 3/4` only gave
 * `± 2.75` for a true error of `69` with `p = 0.99`.
 */
describe('THE EXPONENT OF A SINGULARITY INSIDE AN ENDPOINT', () => {
  test.each([
    [0.5, 1],
    [0.75, 1],
    [0.9, 1],
    [0.9, 20],
    [0.99, 1],
    [0.99, 20],
  ])('|t − (0.3 + k·2⁻⁵⁴)|^(−%p), k = %p', (p, k) => {
    const c = 0.3 + k * 2 ** -54;
    const truth = ((c - 0.3) ** (1 - p) + (1 - c) ** (1 - p)) / (1 - p);
    const r = adaptiveQuadrature((t) => Math.abs(t - c) ** -p, 0.3, 1, {
      singularEndpoints: true,
    });
    expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
  });
});

/**
 * The exponent of a singular point some doubles inside an endpoint is read
 * from two samples beyond it. When the integrand is 0 at one of them, the
 * ratio gives no exponent: `(x − (1 + 4u))/√|x − (1 + u)|` on `[1, 2]`
 * (`u = Number.EPSILON`) is 0 at `1 + 4u`, the sample 3 distances beyond the
 * singular point `1 + u`, and the result was not converged with an error of
 * `+∞` (ROADMAP CE-557). Other distances are tried.
 */
describe('AN EXACT ZERO AT A SAMPLE THAT GIVES THE EXPONENT', () => {
  const u = Number.EPSILON;
  // `∫₁² (x − z)/√|x − c| dx` for `1 < c < 2`.
  const integral = (c: number, z: number) =>
    (2 / 3) * (2 - c) ** 1.5 +
    2 * (c - z) * Math.sqrt(2 - c) +
    2 * (c - z) * Math.sqrt(c - 1) -
    (2 / 3) * (c - 1) ** 1.5;
  test.each([
    ['(x − (1 + 4u))/√|x − (1 + u)|', 1 + u, 1 + 4 * u, 1],
    // The same at the upper endpoint, with `x ↦ 3 − x`.
    ['(x − (2 − 4u))/√|x − (2 − u)|', 2 - u, 2 - 4 * u, -1],
  ] as [string, number, number, number][])('%s on [1, 2]', (_, c, z, sign) => {
    const r = adaptiveQuadrature(
      (x) => (x - z) / Math.sqrt(Math.abs(x - c)),
      1,
      2,
      { singularEndpoints: true }
    );
    const truth = sign * integral(sign > 0 ? c : 3 - c, sign > 0 ? z : 3 - z);
    expect(Number.isFinite(r.error)).toBe(true);
    expect(r.converged).toBe(true);
    expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
  });
});

describe('A SMOOTH PEAK NEXT TO AN ENDPOINT', () => {
  test('1/((x − 10⁶ − 10⁻⁵)² + 10⁻¹²) on [10⁶, 10⁶ + 1]', () => {
    // The peak is 86,000 doubles from the endpoint. It was taken for a
    // singular point: `± 1.1e6` for a true error of `7`, after 1,696
    // evaluations (the stop on the rounding of the nodes ended the run).
    const f = (x: number) => 1 / ((x - 1e6 - 1e-5) ** 2 + 1e-12);
    const truth = 1e6 * (Math.atan((1 - 1e-5) / 1e-6) + Math.atan(1e-5 / 1e-6));
    const r = adaptiveQuadrature(f, 1e6, 1e6 + 1, { singularEndpoints: true });
    const trueError = Math.abs(r.estimate - truth);
    expect(trueError).toBeLessThanOrEqual(r.error);
    expect(r.error).toBeLessThan(1);
    expect(trueError).toBeLessThan(0.1);
  });
});

describe('THE WALK TO A SINGULAR POINT STAYS IN THE INTERVAL', () => {
  test('2 − x on [1, 1 + 64·ε]', () => {
    const a = 1;
    const b = 1 + 64 * Number.EPSILON;
    const f = (x: number) => {
      if (x < a || x > b) throw new Error(`sampled outside: ${x}`);
      return 2 - x;
    };
    const r = adaptiveQuadrature(f, a, b, { singularEndpoints: true });
    expect(
      Math.abs(r.estimate - (b - a) * (2 - (a + b) / 2))
    ).toBeLessThanOrEqual(r.error + 1e-30);
  });
});

/**
 * The nodes of a panel a few doubles wide are clamped to the panel
 * (`nodeAt`, `gauss-kronrod.ts`). The rounded center minus the rounded
 * offset of an outer node rounded to a double outside the panel:
 * `∫ (2 − x) dx` over `[1, 1 + 5ε]` sampled the integrand at `1 − ε/2`.
 */
describe('THE NODES OF A NARROW PANEL STAY IN THE PANEL', () => {
  const e = Number.EPSILON;
  test.each([
    [1, 1 + 5 * e, false],
    [1, 1 + 5 * e, true],
    [1 - 5 * e, 1, false],
    [1 - 5 * e, 1, true],
    // The doubles above `−1` are closer together than the doubles below
    // it: the upper node can round to a double above the panel.
    [-1 - 5 * e, -1, false],
    [-1 - 5 * e, -1, true],
  ])('[%p, %p], singular endpoints %p', (a, b, singularEndpoints) => {
    const outside: number[] = [];
    const r = adaptiveQuadrature(
      (x) => {
        if (x < a || x > b) outside.push(x);
        return 2 - x;
      },
      a,
      b,
      { singularEndpoints }
    );
    expect(outside).toEqual([]);
    expect(Number.isFinite(r.estimate)).toBe(true);
  });

  // With `k = 1`, a node below 1 made the value `NaN`.
  test.each([1, 5, 64])('√(x − 1) on [1, 1 + %p·ε] is finite', (k) => {
    const r = adaptiveQuadrature((x) => Math.sqrt(x - 1), 1, 1 + k * e);
    expect(Number.isFinite(r.estimate)).toBe(true);
    expect(Number.isFinite(r.error)).toBe(true);
  });

  test.each([5, 64])('√(x − 1) on [1, 1 + %p·ε]: the error bounds', (k) => {
    const b = 1 + k * e;
    const r = adaptiveQuadrature((x) => Math.sqrt(x - 1), 1, b);
    expect(Math.abs(r.estimate - (2 / 3) * (b - 1) ** 1.5)).toBeLessThanOrEqual(
      r.error
    );
  });
});

/** The double `k` doubles above `x` (below for a negative `k`). */
function doubleAt(x: number, k: number): number {
  const buffer = new Float64Array([x]);
  const bits = new BigInt64Array(buffer.buffer);
  bits[0] += BigInt(k);
  return buffer[0];
}

/**
 * The value at the endpoint is not evidence of a singularity there: a guard
 * can return `NaN` or `+∞` at the endpoint for a pole outside the interval.
 * The test of `f(e)` gave `converged`, `± 1.9e-13`, for a true error of
 * `3.5e-7` with `((x − 1)/(x − 1))/√(x − 1 + 3e-14)`.
 */
describe('A GUARD AT THE ENDPOINT FOR A POLE OUTSIDE', () => {
  test.each([3e-14, 1e-15])('guards at x = 1, d = %p', (d) => {
    const truth = 2 * Math.sqrt(1 + d) - 2 * Math.sqrt(d);
    const fs = [
      (x: number) => (x - 1) / (x - 1) / Math.sqrt(x - 1 + d),
      (x: number) => (x === 1 ? Infinity : 1 / Math.sqrt(x - 1 + d)),
      (x: number) => (2 - x) / (2 - x) / Math.sqrt(2 - x + d),
    ];
    for (const f of fs) {
      const r = adaptiveQuadrature(f, 1, 2, { singularEndpoints: true });
      expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
    }
  });

  test.each([1, 5, 20])('NaN at 0.3, pole %p doubles below', (k) => {
    const c = doubleAt(0.3, -k);
    const r = adaptiveQuadrature(
      (t) => (t === 0.3 ? NaN : Math.abs(t - c) ** -0.5),
      0.3,
      1,
      { singularEndpoints: true }
    );
    const truth = 2 * Math.sqrt(1 - c) - 2 * Math.sqrt(0.3 - c);
    expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
  });
});

test('poles at the first and the fourth double inside an endpoint', () => {
  // The exponent was read from a sample at the second pole (`+∞`), and the
  // error was finite: `± 2.5e-8` for a true error of `4.5e-8`.
  const c1 = doubleAt(0.3, 1);
  const c4 = doubleAt(0.3, 4);
  const r = adaptiveQuadrature(
    (t) => Math.abs(t - c1) ** -0.5 + Math.abs(t - c4) ** -0.5,
    0.3,
    1,
    { singularEndpoints: true }
  );
  const truth =
    2 * Math.sqrt(1 - c1) +
    2 * Math.sqrt(c1 - 0.3) +
    2 * Math.sqrt(1 - c4) +
    2 * Math.sqrt(c4 - 0.3);
  expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
});

test.each([
  [1, 4],
  [2, 8],
])(
  'poles at the doubles %p and %p above an endpoint: not extrapolated',
  (k1, k2) => {
    // The error of the singular points inside the endpoint is `+∞`
    // (`offsetSingularity`). The result kept `extrapolated: true`, and the
    // callers use an extrapolated estimate even when it is not converged.
    const c1 = doubleAt(0.3, k1);
    const c2 = doubleAt(0.3, k2);
    const r = adaptiveQuadrature(
      (t) => Math.abs(t - c1) ** -0.5 + Math.abs(t - c2) ** -0.5,
      0.3,
      1,
      { singularEndpoints: true }
    );
    expect(r.error).toBe(Infinity);
    expect(r.converged).toBe(false);
    expect(r.extrapolated).not.toBe(true);
  }
);

/**
 * A logarithm inside the interval, or at the endpoint, is not a pole
 * outside: `ln|x − c|` with `c` 10⁵ doubles above 1, on `[1, 2]`, was not
 * converged, `± 3.0e-9`, for a true error of `5.1e-11`.
 */
describe('A LOGARITHM NEXT TO AN ENDPOINT', () => {
  const lnIntegral = (e: number, c: number, b: number) => {
    const L = (u: number) => (u === 0 ? 0 : u * Math.log(Math.abs(u)) - u);
    return L(b - c) - L(e - c);
  };
  test.each([
    [1, 1e5],
    [0.3, 1e5],
    [1000, 1e3],
    [1000, 1e5],
  ])('ln|x − c| on [%p, +1], c %p doubles inside', (e, k) => {
    const c = doubleAt(e, k);
    const r = adaptiveQuadrature((x) => Math.log(Math.abs(x - c)), e, e + 1, {
      singularEndpoints: true,
    });
    expect(r.converged).toBe(true);
    expect(Math.abs(r.estimate - lnIntegral(e, c, e + 1))).toBeLessThanOrEqual(
      r.error
    );
  });

  test('ln²(x − 1000) on [1000, 1001], 0 at 1000', () => {
    const r = adaptiveQuadrature(
      (x) => (x === 1000 ? 0 : Math.log(x - 1000) ** 2),
      1000,
      1001,
      { singularEndpoints: true }
    );
    expect(r.converged).toBe(true);
    expect(Math.abs(r.estimate - 2)).toBeLessThanOrEqual(r.error);
  });
});

test('the reducible error and the rounding together meet the tolerance', () => {
  // Each part met its own test, and the sum was 1.89 times the tolerance.
  const a = 1e5;
  const rtol = 6.31e-10;
  const r = adaptiveQuadrature(
    (x) => 1.5 + Math.cos(3000 * (x - a)),
    a,
    a + 1,
    {
      rtol,
    }
  );
  if (r.converged)
    expect(r.error).toBeLessThanOrEqual(rtol * Math.abs(r.estimate));
});

test('a removable NaN is bisected away before the stop on the rounding', () => {
  // With a NaN at a node of a panel made late in the run, the stop on the
  // rounding of the nodes ended the run with that panel left: 15 of the 273
  // nodes gave an error of `+∞`, and 15 gave a wrong bound (`± 3.6e-10` for
  // a true error of `1.9e-4`).
  const a = 1e6;
  const b = 1e6 + 0.01;
  const truth = (1 - Math.cos(10)) / 1e3;
  const xs: number[] = [];
  adaptiveQuadrature(
    (x) => {
      xs.push(x);
      return Math.sin(1e3 * (x - a));
    },
    a,
    b,
    { initialPanels: 4 }
  );
  for (const target of xs) {
    const r = adaptiveQuadrature(
      (x) => (x === target ? NaN : Math.sin(1e3 * (x - a))),
      a,
      b,
      { initialPanels: 4 }
    );
    expect(Number.isFinite(r.error)).toBe(true);
    expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
  }
});

test('the samples next to an endpoint poll the deadline', () => {
  // The deadline expires at the samples 16, 32 and 64 doubles above 0.3,
  // which only the test of a singular point next to an endpoint reads.
  const c = 0.7 - 0.4;
  const s = doubleAt(0.3, 1) - 0.3;
  let expired = false;
  let after = 0;
  const recent: number[] = [];
  const frame = {
    get at() {
      return expired ? 0 : Number.POSITIVE_INFINITY;
    },
    spans: [] as string[],
  };
  const f = (t: number) => {
    if (expired) after += 1;
    recent.push(t);
    if (recent.length > 3) recent.shift();
    if (
      recent.length === 3 &&
      recent[0] === 0.3 + 16 * s &&
      recent[1] === 0.3 + 32 * s &&
      recent[2] === 0.3 + 64 * s
    )
      expired = true;
    return Math.abs(t - c) ** -0.5;
  };
  let error: unknown;
  try {
    adaptiveQuadrature(f, 0.3, 1, { singularEndpoints: true, deadline: frame });
  } catch (e) {
    error = e;
  }
  expect(expired).toBe(true);
  expect((error as Error | undefined)?.name).toBe('CancellationError');
  expect(after).toBeLessThanOrEqual(1);
});

/**
 * A pole some doubles outside an endpoint far from 0, with a smooth factor.
 * The exponents of the samples next to the endpoint then have a smooth part
 * that doubles at each step, and a test that their differences halve took
 * the pole for a logarithm: `(1 + 100·u)/√(x − c)` with `c` one double below
 * 1000 was `converged`, `± 5.4e-12`, for a true error of `6.7e-7`.
 */
describe('A POLE OUTSIDE AN ENDPOINT FAR FROM 0', () => {
  // `∫ g(x)/√(x − c) dx` over `[e, e + 1]`, with `x = c + v²`.
  const reference = (g: (x: number) => number, c: number, e: number) =>
    adaptiveQuadrature(
      (v) => 2 * g(c + v * v),
      Math.sqrt(e - c),
      Math.sqrt(e + 1 - c),
      { rtol: 1e-15 }
    ).estimate;
  const cases: [string, number, number, (u: number) => number][] = [
    ['1 + 100·u', 1000, 1, (u) => 1 + 100 * u],
    ['1 + 100·u', 1000, 3, (u) => 1 + 100 * u],
    ['e^u', 1e5, 1, (u) => Math.exp(u)],
    ['e^u', 1e5, 3, (u) => Math.exp(u)],
    ['e^u', 1e6, 30, (u) => Math.exp(u)],
    ['1', 1e5, 1, () => 1],
    ['1', 1e5, 3, () => 1],
    ['1', 1e5, 30, () => 1],
    ['1', 1e6, 1, () => 1],
    ['1', 1e6, 3, () => 1],
    ['1', 1e6, 30, () => 1],
  ];
  test.each(cases)('g = %s, e = %p, pole %p doubles below', (_, e, k, g) => {
    const c = doubleAt(e, -k);
    const h = (x: number) => g(x - e);
    const r = adaptiveQuadrature((x) => h(x) / Math.sqrt(x - c), e, e + 1, {
      singularEndpoints: true,
    });
    expect(Math.abs(r.estimate - reference(h, c, e))).toBeLessThanOrEqual(
      r.error
    );
  });

  test('(x − e)^(−1/2)·(x − e − 10⁻⁹) on [10⁶, 10⁶ + 1] converges', () => {
    const e = 1e6;
    const r = adaptiveQuadrature(
      (x) => (x - e) ** -0.5 * (x - e - 1e-9),
      e,
      e + 1,
      { singularEndpoints: true }
    );
    expect(r.converged).toBe(true);
    expect(Math.abs(r.estimate - (2 / 3 - 2e-9))).toBeLessThanOrEqual(r.error);
  });
});

/**
 * A pole 10⁴ to 10⁵ doubles outside an endpoint. The exponents of the
 * samples next to the endpoint were fitted with a pole part that halves at
 * each step, which holds only when the distance of the samples is much larger
 * than the distance of the pole: the fit missed by 3 % to 20 %, and the pole
 * was not counted (ROADMAP CE-558). `(x − c)^(−3/4)` with `c` 10⁴ doubles
 * below `e = 1000` was `converged`, `± 1.5e-10`, for a true error of
 * `2.3e-2`.
 */
describe('A POLE 10⁴ TO 10⁵ DOUBLES OUTSIDE AN ENDPOINT', () => {
  // `∫ g(x − e)·(x − c)^(−p) dx` over `[e, e + 1]`, with `x = c + v^q`,
  // `q = 1/(1 − p)`, which removes the singularity.
  const reference = (g: (u: number) => number, p: number, d: number) => {
    const q = 1 / (1 - p);
    return adaptiveQuadrature(
      (v) => q * g(v ** q - d),
      d ** (1 - p),
      (1 + d) ** (1 - p),
      { rtol: 1e-15 }
    ).estimate;
  };
  const g: Record<string, (u: number) => number> = {
    '1': () => 1,
    '1 + 100·u': (u) => 1 + 100 * u,
    '1 + 1000·u': (u) => 1 + 1000 * u,
    '1/(1 + 100·u)': (u) => 1 / (1 + 100 * u),
    'e^u': (u) => Math.exp(u),
  };
  // Each case reported an error smaller than its true error before.
  test.each([
    // ROADMAP CE-558: `± 4.2e-10` for `4.4e-10`, and `converged`, `± 1.5e-9`,
    // for `1.5e-9`.
    ['1', 1e5, 1e4, 0.25],
    ['1 + 100·u', 1e5, 1e4, 0.25],
    ['1', 1000, 1e4, 0.75],
    ['e^u', 1000, 1e4, 0.75],
    ['1/(1 + 100·u)', 1000, 1e4, 0.75],
    ['1 + 100·u', 1000, 1e4, 0.5],
    ['e^u', 1000, 1e4, 0.5],
    ['1 + 100·u', 1e6, 1e4, 0.25],
    ['1 + 1000·u', 1e5, 1e4, 0.5],
    // A pole 10 doubles outside with a factor that changes by 12 % over the
    // samples: `converged`, `± 5.48e-8`, for `5.53e-8`.
    ['1 + 1000·u', 1e6, 10, 0.25],
  ] as [string, number, number, number][])(
    'g = %s, e = %p, pole %p doubles below, p = %p',
    (name, e, k, p) => {
      const c = doubleAt(e, -k);
      const h = g[name];
      const r = adaptiveQuadrature((x) => h(x - e) * (x - c) ** -p, e, e + 1, {
        singularEndpoints: true,
      });
      expect(Math.abs(r.estimate - reference(h, p, e - c))).toBeLessThanOrEqual(
        r.error
      );
    }
  );

  // A far pole that the adaptive panels resolve: the corner is not
  // extrapolated, nothing is put in the wrong place, and the result stays
  // converged. With the area of a model over the distance of the pole as
  // the error, `e = 10⁶`, `p = 1/4` was `± 9.2e-4` and `e = 1000`, `p = 1/2`
  // was `± 1.2e-4`, for true errors of `7.7e-12` and `2.5e-11`.
  test.each([
    [1e5, 1e6, 0.25],
    [1e4, 1000, 0.5],
  ])('a pole %p doubles below e = %p, p = %p, converges', (k, e, p) => {
    const c = doubleAt(e, -k);
    const r = adaptiveQuadrature((x) => (x - c) ** -p, e, e + 1, {
      singularEndpoints: true,
    });
    expect(r.converged).toBe(true);
    expect(
      Math.abs(r.estimate - reference(() => 1, p, e - c))
    ).toBeLessThanOrEqual(r.error);
  });

  // Cases whose bound held before the exact model of the pole, from 1 to
  // 10⁵ doubles outside: the bound still holds.
  test.each([
    ['1', 1, 1e5, 0.5],
    ['e^u', 1000, 1e5, 0.25],
    ['1 + 100·u', 1e6, 1e5, 0.75],
    ['1', 1e6, 1, 0.5],
    ['1 + 100·u', 1000, 1000, 0.25],
  ] as [string, number, number, number][])(
    'the bound holds: g = %s, e = %p, pole %p doubles below, p = %p',
    (name, e, k, p) => {
      const c = doubleAt(e, -k);
      const h = g[name];
      const r = adaptiveQuadrature((x) => h(x - e) * (x - c) ** -p, e, e + 1, {
        singularEndpoints: true,
      });
      expect(Math.abs(r.estimate - reference(h, p, e - c))).toBeLessThanOrEqual(
        r.error
      );
    }
  );
});

test.each([2e-5, 4e-5, 1e-4, 1e-3])(
  'a step %p from a singular endpoint at 10⁵ is not a split point',
  (step) => {
    // The search for a singular point ended at the edge of its window, below
    // the step, where `|f|` grows toward the endpoint. The split there left
    // the step `6.3e-8` inside the right half, before its first node: the
    // result was `± 1.5e-8` for a true error of `6.4e-7` (the same at HEAD).
    const e = 1e5;
    const w = 1 / 16;
    const f = (t: number) => (t - e) ** -0.25 + (t - e < step ? 10 : 0);
    const r = adaptiveQuadrature(f, e, e + w, { singularEndpoints: true });
    const truth = w ** 0.75 / 0.75 + 10 * step;
    expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
  }
);

test.each([1, undefined])(
  'a slope that overflows, %p starting panels',
  (initialPanels) => {
    // The samples are about `2¹⁰⁰⁵` and the nodes some doubles apart: the
    // slope `Δf/Δx` was `+∞`, the noise floor of the null rules `+∞`, and the
    // result was `converged`, `± 4.4e273`, for a true error of `3.8e286`.
    const a = 1;
    const b = 1 + 129 * Number.EPSILON;
    const r = adaptiveQuadrature(
      (x) => (x - 1) * 2 ** 1000 * 2 ** 50,
      a,
      b,
      initialPanels === undefined ? {} : { initialPanels }
    );
    // `(129·ε)²/2·2¹⁰⁵⁰`, computed without overflow.
    const truth = 16641 * 2 ** 945;
    expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
  }
);

/**
 * A pole one double outside an endpoint far from 0, with a smooth factor
 * whose part in the exponents of the samples biased the exponent of the
 * pole: `(1 + 100·(x − e))·(x − c)^(−1/4)`, `e = 10⁶`, was `converged`,
 * `± 2.0e-9`, for a true error of `2.1e-8` (HEAD: `± 5.6e-9` for `3.7e-9`).
 */
describe('THE SMOOTH PART OF THE EXPONENTS NEXT TO AN ENDPOINT', () => {
  test.each([
    [1e6, 0.25],
    [1e6, 0.5],
    [1e5, 0.25],
    [1e5, 0.5],
  ])('(1 + 100·u)·(x − c)^(−p), e = %p, p = %p', (e, p) => {
    const a = 100;
    const c = doubleAt(e, -1);
    const d = e - c;
    // `∫ from d to d + 1 of (1 + a·(t − d))·t^(−p) dt`.
    const F = (t: number) =>
      ((1 - a * d) * t ** (1 - p)) / (1 - p) + (a * t ** (2 - p)) / (2 - p);
    const r = adaptiveQuadrature(
      (x) => (1 + a * (x - e)) * (x - c) ** -p,
      e,
      e + 1,
      { singularEndpoints: true }
    );
    expect(Math.abs(r.estimate - (F(d + 1) - F(d)))).toBeLessThanOrEqual(
      r.error
    );
  });

  test('e^u·(x − c)^(−1/4), e = 10⁵, c one double below', () => {
    const e = 1e5;
    const c = doubleAt(e, -1);
    const d = e - c;
    const q = 1 / 0.75;
    // `x = c + v^q` removes the singularity.
    const truth = adaptiveQuadrature(
      (v) => q * Math.exp(v ** q - d),
      d ** 0.75,
      (1 + d) ** 0.75,
      { rtol: 1e-15 }
    ).estimate;
    const r = adaptiveQuadrature(
      (x) => Math.exp(x - e) * (x - c) ** -0.25,
      e,
      e + 1,
      { singularEndpoints: true }
    );
    expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
  });
});
