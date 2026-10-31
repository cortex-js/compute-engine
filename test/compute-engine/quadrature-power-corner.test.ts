import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';
import {
  uncountedArea,
  type CornerSeries,
} from '../../src/compute-engine/numerics/endpoint-quadrature';

/**
 * ROADMAP CE-695. Next to a logarithmic singularity such as `1/(x·ln²x)`,
 * the corner shells decrease as a power `1/kᵅ` of their index, and the part
 * of the corner that the panels leave out is about `1/(n·ln 2)` after `n`
 * shells. Its bound came from a geometric model of the deepest shells, whose
 * tail is about `(α − 1)/α` of the tail of the power, and the reported error
 * was smaller than the true error when no extrapolation was used. The bound
 * is now at least the tail of a power fitted to the deepest shells, when the
 * shells decrease as a power (`powerCornerArea`,
 * `numerics/endpoint-quadrature.ts`). Measured on the corpora of
 * `docs/plans/2026-10-31-ce695-power-corner-area.md`.
 */

/** `u^(−1)·(−ln u)^(−q)` with `u` the distance to `c`, on `[c − L, c]`: the
 * integral is `(−ln L)^(1−q)/(q − 1)`. */
function logCorner(c: number, q: number, L: number) {
  const r = adaptiveQuadrature(
    (x) => 1 / ((c - x) * (-Math.log(c - x)) ** q),
    c - L,
    c,
    { singularEndpoints: true }
  );
  const exact = (-Math.log(L)) ** (1 - q) / (q - 1);
  return { r, trueError: Math.abs(r.estimate - exact) };
}

/** A corner of 200 shells of width 1/32 next to 0, whose last panel is
 * `2^(−205)` wide and has no value. */
function powerShellsCorner(shell: (k: number) => number): CornerSeries {
  const n = 200;
  const shells = Array.from({ length: n }, (_, k) => shell(k));
  return {
    shells,
    shellErrors: shells.map((v) => 1e-14 * v),
    value: Number.NaN,
    error: Number.NaN,
    width: 1 / 32,
    endpoint: 0,
    last: { width: 2 ** -(5 + n), value: Number.NaN, error: Number.NaN },
  };
}

describe('A CORNER WHOSE SHELLS DECREASE AS A POWER', () => {
  test('1/(x·ln²x) plus a step that stops the extrapolation', () => {
    // The step of area 1e-6 on [0, 1e-3] stops the extrapolation, and the
    // integrand overflows in the last corner panel [0, 5e-324]. Before:
    // ± 1.28e-3 for a true error of 1.38e-3.
    const A = 1e-6;
    const d = 1e-3;
    const r = adaptiveQuadrature(
      (x) => 1 / (x * Math.log(x) ** 2) + (x <= d ? A / d : 0),
      0,
      0.5,
      { singularEndpoints: true }
    );
    const trueError = Math.abs(r.estimate - (1 / Math.log(2) + A));
    expect(r.extrapolated).toBeFalsy();
    expect(trueError).toBeGreaterThan(1e-3);
    expect(r.error).toBeGreaterThanOrEqual(trueError);
    expect(r.singularCorner).toBe(true);
  });

  test('a logarithmic singularity next to 10⁶', () => {
    // Before: ± 1.24 for a true error of 7.32. Only 6 shells pass the
    // accuracy test of the extrapolation.
    const { r, trueError } = logCorner(1e6, 1.1, 0.25);
    expect(trueError).toBeGreaterThan(7);
    expect(r.error).toBeGreaterThanOrEqual(trueError);
    expect(Number.isFinite(r.error)).toBe(true);
    expect(r.singularCorner).toBe(true);
    expect(r.error).toBeLessThan(20 * trueError);
  });

  test('a logarithmic singularity next to 10⁶ with 9 usable shells', () => {
    // On an interval of width 1e-3, the corner has 9 shells whose relative
    // error is small enough for the model. Before: ± 1.08 for 7.32.
    const { r, trueError } = logCorner(1e6, 1.1, 1e-3);
    expect(r.error).toBeGreaterThanOrEqual(trueError);
    expect(Number.isFinite(r.error)).toBe(true);
    expect(r.singularCorner).toBe(true);
    expect(r.error).toBeLessThan(20 * trueError);
  });

  test('a geometric corner still converges', () => {
    const r = adaptiveQuadrature((x) => x ** -0.5, 0, 0.25, {
      singularEndpoints: true,
    });
    expect(r.converged).toBe(true);
    expect(Math.abs(r.estimate - 1)).toBeLessThanOrEqual(r.error);
  });

  // Shells `A·y^(−1.0001)` at the depths `y = k + 5.5`: the tail of the
  // power is about `A·10⁴`. An area of `+∞` would make the error `+∞`, take
  // away `singularCorner`, and let a caller use Monte Carlo, so the area is
  // capped: `UNCOUNTED_SAFETY` (2) times it is at most `Number.MAX_VALUE / 16`.
  const cap = Number.MAX_VALUE / 16;
  test.each([
    ['the tail overflows', 1e305],
    ['the tail is finite and its double overflows', 1.2e304],
    ['the double of the tail is above the cap', 2e303],
  ])('a power whose area is too large for the sums: %s', (_, A) => {
    const corner = powerShellsCorner((k) => A * (k + 5.5) ** -1.0001);
    const area = uncountedArea(corner);
    expect(Number.isFinite(area)).toBe(true);
    expect(area).toBeLessThanOrEqual(cap);
    // The cap, not the geometric area (about `4e-4` times the tail).
    expect(area).toBeGreaterThanOrEqual(0.99 * cap);
  });

  test('the power area is used when the shells decrease as a power', () => {
    // Shells `(k + 5.5)^(−2)`: the tail of the power from the depth 205 is
    // `1/205`, and the area is `UNCOUNTED_SAFETY` (2) times it. The geometric
    // model alone gives about half of that.
    const corner = powerShellsCorner((k) => (k + 5.5) ** -2);
    expect(uncountedArea(corner)).toBeGreaterThanOrEqual((0.95 * 2) / 205);
  });
});
