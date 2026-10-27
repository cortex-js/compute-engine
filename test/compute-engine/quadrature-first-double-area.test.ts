import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';
import {
  lastPanelGap,
  uncountedArea,
} from '../../src/compute-engine/numerics/endpoint-quadrature';

/**
 * ROADMAP CE-552. Next to a singular endpoint `e` far from 0, no node can be
 * closer to `e` than the first double above it. The adaptive quadrature
 * bisects the panel at `e` until one of its nodes rounds to `e`, where the
 * integrand is not finite, and leaves that panel out; tanh-sinh leaves out
 * its nodes that round to `e`. The area between `e` and the first double was
 * not in the result, nor in its error: `(x − e)^(−0.9)` on `[e, e + 1]` with
 * `e = 10⁶` was `± 0.12` for a true error of `1.03`. The error now includes a
 * bound of that area, from a model of the shells next to `e`
 * (`uncountedArea`, `numerics/endpoint-quadrature.ts`).
 */

/** `∫₀¹ u^(−p)·g(u) du` for the smooth factors of the cases. */
const exact: Record<string, (p: number) => number> = {
  '1': (p) => 1 / (1 - p),
  'e^u': (p) => {
    // `Σ 1/(k!·(k + 1 − p))`.
    let sum = 0;
    let factorial = 1;
    for (let k = 0; k < 40; k++) {
      if (k > 0) factorial *= k;
      sum += 1 / (factorial * (k + 1 - p));
    }
    return sum;
  },
};
const factor: Record<string, (u: number) => number> = {
  '1': () => 1,
  'e^u': (u) => Math.exp(u),
};

describe('THE AREA OF THE FIRST DOUBLE NEXT TO A SINGULAR ENDPOINT', () => {
  const cases: [number, number, string, 'lo' | 'hi'][] = [];
  for (const e of [1e3, 1e5, 1e6, 1e9])
    for (const p of [0.1, 0.25, 0.5, 0.9])
      for (const g of ['1', 'e^u'])
        for (const end of ['lo', 'hi'] as const) cases.push([e, p, g, end]);
  test.each(cases)(
    '(x − e)^(−p)·g, e = %p, p = %p, g = %s, singular at %s',
    (e, p, g, end) => {
      const h = factor[g];
      const f =
        end === 'lo'
          ? (x: number) => (x - e) ** -p * h(x - e)
          : (x: number) => (e + 1 - x) ** -p * h(e + 1 - x);
      const r = adaptiveQuadrature(f, e, e + 1, { singularEndpoints: true });
      expect(Math.abs(r.estimate - exact[g](p))).toBeLessThanOrEqual(r.error);
    }
  );

  test('(x − 10⁶)^(−0.9): the error covers the area of the first double', () => {
    // The area of the first double is `1.02`. The result was `± 0.12` for a
    // true error of `1.03`.
    const e = 1e6;
    const r = adaptiveQuadrature((x) => (x - e) ** -0.9, e, e + 1, {
      singularEndpoints: true,
    });
    expect(r.converged).toBe(false);
    expect(Math.abs(r.estimate - 10)).toBeLessThanOrEqual(r.error);
    expect(r.error).toBeLessThan(5);
  });

  test('(x − 10⁶)^(−0.1) is not converged with a wrong error', () => {
    // Was `converged`, `± 5.7e-11`, for a true error of `7e-10`.
    const e = 1e6;
    const r = adaptiveQuadrature((x) => (x - e) ** -0.1, e, e + 1, {
      singularEndpoints: true,
    });
    expect(Math.abs(r.estimate - 1 / 0.9)).toBeLessThanOrEqual(r.error);
  });

  test('the tanh-sinh value next to 1000 counts the first double', () => {
    // The adaptive quadrature converged, and the tanh-sinh value replaced
    // it: `converged`, `± 1.77e-12`, for a true error of `1.85e-12`.
    const e = 1000;
    const r = adaptiveQuadrature((x) => (x - e) ** -0.1, e, e + 1, {
      singularEndpoints: true,
    });
    expect(r.converged).toBe(true);
    expect(Math.abs(r.estimate - 1 / 0.9)).toBeLessThanOrEqual(r.error);
  });

  test.each([
    [1e5, 1e-7, 0.9],
    [1e6, 1e-7, 0.9],
    [1e9, 1e-5, 0.5],
  ])(
    'a zero of the smooth factor next to e = %p, at a distance %p, p = %p',
    (e, z, p) => {
      // `(x − e)^(−p)·(x − e − z)`: next to `e`, the shells fall toward the
      // term `−z·(x − e)^(−p)`, and the shells farther away are those of
      // `(x − e)^(1−p)`. At `e = 10⁶` the result was `± 1.2e-8` for a true
      // error of `1e-7`; at `e = 10⁹`, `± 6.4e-9` for `7.2e-9`.
      const r = adaptiveQuadrature(
        (x) => (x - e) ** -p * (x - e - z),
        e,
        e + 1,
        { singularEndpoints: true }
      );
      expect(Number.isFinite(r.error)).toBe(true);
      const truth = 1 / (2 - p) - z / (1 - p);
      expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
    }
  );
});

/**
 * A zero of the smooth factor within a few spacings of the singular
 * endpoint: the deepest shells change sign or fall below `1/2`, and give no
 * model of the last corner panel. The bound is then the tail of shells that
 * continue the deepest ones as those of `x^(−0.99)` (`fallbackArea`). With
 * the model of the shells farther out, `e = 10⁶`, `z = 10⁻⁹` was `± 1.3e-10`
 * for a true error of `1.0e-9`.
 */
describe('A ZERO OF THE SMOOTH FACTOR A FEW SPACINGS FROM THE ENDPOINT', () => {
  test.each([
    [1e5, 1e-9],
    [1e6, 1e-9],
    [1e9, 1e-5],
    [1e9, 1e-7],
  ])('(x − e)^(−0.9)·(x − e − z), e = %p, z = %p', (e, z) => {
    const r = adaptiveQuadrature(
      (x) => (x - e) ** -0.9 * (x - e - z),
      e,
      e + 1,
      { singularEndpoints: true }
    );
    expect(Number.isFinite(r.error)).toBe(true);
    expect(Math.abs(r.estimate - (1 / 1.1 - z / 0.1))).toBeLessThanOrEqual(
      r.error
    );
  });

  // The zero is inside the last corner panel, which is finite: the shells
  // do not see it, and tanh-sinh leaves out the part of `−z·(x − e)^(−0.9)`
  // next to `e`. The Gauss–Kronrod value is kept (`lastPanelHoldsFeature`).
  // At `e = 1000` the result was `converged`, `± 2.5e-12`, for a true error
  // of `5.1e-12`.
  test.each([1000, 1e5, 1e6])(
    '(x − e)^(−0.9)·(x − e − 10⁻¹¹), e = %p, converges',
    (e) => {
      const z = 1e-11;
      const r = adaptiveQuadrature(
        (x) => (x - e) ** -0.9 * (x - e - z),
        e,
        e + 1,
        { singularEndpoints: true }
      );
      expect(r.converged).toBe(true);
      expect(Math.abs(r.estimate - (1 / 1.1 - z / 0.1))).toBeLessThanOrEqual(
        r.error
      );
    }
  );
});

describe('uncountedArea and lastPanelGap', () => {
  // The shells of `x^(−1/2)` next to an endpoint `e = 10⁶`, on a corner of
  // width `1/16`, down to the spacing of the doubles at `e`.
  const width = 1 / 16;
  const n = 29;
  const delta = width / 2 ** n;
  const shells = Array.from({ length: n }, (_, k) => {
    const w = width / 2 ** (k + 1);
    return 2 * (Math.sqrt(2 * w) - Math.sqrt(w));
  });
  const corner = {
    shells,
    shellErrors: shells.map(() => 0),
    value: 0,
    error: 0,
    width,
    endpoint: 1e6,
  };
  const left = { width: delta, value: Infinity, error: NaN };

  test('0 when the last corner panel is counted', () => {
    expect(uncountedArea(corner)).toBe(0);
    const counted = { width: delta, value: 2 * Math.sqrt(delta), error: 0 };
    expect(uncountedArea({ ...corner, last: counted })).toBe(0);
  });

  test('twice the area of the model over the last corner panel', () => {
    expect(uncountedArea({ ...corner, last: left })).toBeCloseTo(
      2 * 2 * Math.sqrt(delta),
      12
    );
  });

  test('+∞ for shells that do not shrink', () => {
    const ln2 = shells.map(() => Math.LN2);
    expect(uncountedArea({ ...corner, shells: ln2, last: left })).toBe(
      Number.POSITIVE_INFINITY
    );
  });

  test('the fallback when the shells change sign at each step', () => {
    // No model: the tail of the larger of the last two shells, continued
    // with the ratio of the shells of `x^(−0.99)` (`fallbackArea`).
    const alternating = shells.map((v, k) => (k % 2 === 0 ? v : -v));
    const r = 2 ** -0.01;
    const amplitude = Math.max(
      Math.abs(shells[n - 1]),
      Math.abs(shells[n - 2])
    );
    expect(
      uncountedArea({ ...corner, shells: alternating, last: left })
    ).toBeCloseTo((amplitude * r) / (1 - r), 15);
  });

  // The shells of `x^(−0.95)` next to 0.
  const p = 0.95;
  const strong = Array.from({ length: n }, (_, k) => {
    const w = width / 2 ** (k + 1);
    return ((2 * w) ** (1 - p) - w ** (1 - p)) / (1 - p);
  });
  const area = delta ** (1 - p) / (1 - p);

  test('the gap of a last panel whose error is too small', () => {
    // The Gauss–Kronrod value of `x^(−0.95)` on `[0, δ]` is `0.30` times the
    // integral, and its error `0.33` times the integral.
    const last = { width: delta, value: 0.3 * area, error: 0.33 * area };
    const gap = lastPanelGap({ ...corner, endpoint: 0, shells: strong, last });
    expect(gap).toBeCloseTo(0.37 * area, 6);
  });

  test('no gap when the error of the last panel covers the model', () => {
    const last = { width: delta, value: 0.3 * area, error: 0.71 * area };
    expect(lastPanelGap({ ...corner, endpoint: 0, shells: strong, last })).toBe(
      0
    );
  });

  test('no gap for the shells of a weak singularity', () => {
    // `x^(−1/2)`: the ratio of the shells is `2^(−1/2)`, below
    // `LAST_PANEL_MIN_RATIO`.
    const value = 2 * Math.sqrt(delta);
    const last = { width: delta, value: 0.5 * value, error: 0 };
    expect(lastPanelGap({ ...corner, last })).toBe(0);
  });
});

/**
 * ROADMAP CE-547. With a step inside the corner panel next to a singular
 * endpoint, the shell that holds the step stops the extrapolation of the
 * shells, and tanh-sinh does not converge. The Gauss–Kronrod result was then
 * kept as `converged`, and the error of its last corner panel was too small
 * for a strong singularity (`lastPanelGap`): `x^(−0.95)·(x < 0.01 ? 2 : 1)`
 * on `[0, 1]` was `converged`, `± 3.6e-9`, for a true error of `4.4e-9`.
 */
describe('A STEP NEXT TO A STRONG ENDPOINT SINGULARITY', () => {
  test.each([
    [0.95, 0.3],
    [0.95, 0.1],
    [0.95, 0.01],
    [0.95, 0.001],
    [0.97, 1e-4],
    [0.9, 0.01],
    [0.99, 0.01],
  ])('x^(−%p)·(x < %p ? 2 : 1) on [0, 1]', (p, s) => {
    const r = adaptiveQuadrature((x) => x ** -p * (x < s ? 2 : 1), 0, 1, {
      singularEndpoints: true,
    });
    const truth = (1 + s ** (1 - p)) / (1 - p);
    expect(Math.abs(r.estimate - truth)).toBeLessThanOrEqual(r.error);
  });
});
