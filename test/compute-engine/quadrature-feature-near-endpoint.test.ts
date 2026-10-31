import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';

/**
 * ROADMAP CE-691. With `singularEndpoints`, a pole `(c − x)^(−1/2)` at the
 * bound `c` plus a step or a bump next to `c` gave an error smaller than the
 * true error in 187 of 900 cases
 * (`docs/scratch/2026-10-30-ce691-quadrature/sweep.mts`). Three causes:
 *
 * - The extrapolation of the corner shells reads the accurate shells only,
 *   down to about `2²⁰` spacings of the doubles from `c`, and nearer than
 *   that the value is a model of a singularity AT `c`. A step there was not
 *   seen.
 * - A small step inside the accurate shells passes their accuracy test, and
 *   the ε-algorithm then reads partial sums that do not converge
 *   geometrically.
 * - When a step stopped the extrapolation, the area that tanh-sinh leaves
 *   out next to `0.3` came from the shells a few doubles wide, whose values
 *   are off by several percent, and it was too small.
 *
 * The integrand is now read at 4 points per octave of the distance to `c`
 * (`featureNearEndpoint`, `numerics/endpoint-quadrature.ts`), and a step or
 * a bump stops the extrapolation. The area next to the endpoint is the
 * larger of the areas of the models of all the deepest shells and of the
 * accurate deepest shells (`cornerModelArea`).
 */

/** `(c − x)^(−1/2)` on `[c − 0.3, c]` plus a step of height `J` on
 * `[c − d, c]`: the integral is `2·√0.3 + J·d`. */
function stepNextToPole(c: number, J: number, d: number) {
  const s = c - d;
  const r = adaptiveQuadrature(
    (x) => (x < s ? 0 : J) + 1 / Math.sqrt(c - x),
    c - 0.3,
    c,
    { singularEndpoints: true }
  );
  return { r, trueError: Math.abs(r.estimate - (2 * Math.sqrt(0.3) + J * d)) };
}

describe('A STEP NEXT TO A SINGULAR ENDPOINT', () => {
  // Before: `± 1.4e-13`, extrapolated, for a true error of `1.3e-10`.
  test('a step nearer to the endpoint than the accurate shells', () => {
    const { r, trueError } = stepNextToPole(0.3, 1, 1.27e-10);
    expect(r.extrapolated).not.toBe(true);
    expect(trueError).toBeLessThanOrEqual(r.error);
  });

  // Before: `± 2.5e-12`, extrapolated, for a true error of `2.6e-11`.
  test('a small step inside the accurate shells', () => {
    const { r, trueError } = stepNextToPole(0.7, 1e-4, 2.59e-7);
    expect(r.extrapolated).not.toBe(true);
    expect(trueError).toBeLessThanOrEqual(r.error);
  });

  // Not extrapolated before either: `± 4.7e-9` for a true error of
  // `1.08e-8`. The last corner panel is one double wide, and the area that
  // tanh-sinh leaves out came from a model of the shells 2 to 16 doubles
  // wide, with the ratio `0.567` instead of `2^(−1/2)`.
  test('the area next to the endpoint when a step stops the extrapolation', () => {
    const { r, trueError } = stepNextToPole(0.3, 1, 1.61e-9);
    expect(trueError).toBeLessThanOrEqual(r.error);
  });

  // About 180 doubles from 0.3. Before: `± 1.4e-13`, extrapolated, for a
  // true error of `1e-8`.
  test('a large step a few hundred doubles from the endpoint', () => {
    const { r, trueError } = stepNextToPole(0.3, 1e6, 1e-14);
    expect(r.extrapolated).not.toBe(true);
    expect(trueError).toBeLessThanOrEqual(r.error);
  });

  test('a bump nearer to the endpoint than the accurate shells', () => {
    const c = 0.7;
    const d = 1e-10;
    const r = adaptiveQuadrature(
      (x) => (Math.abs(x - (c - d)) < d / 8 ? 1 : 0) + 1 / Math.sqrt(c - x),
      c - 0.3,
      c,
      { singularEndpoints: true }
    );
    expect(r.extrapolated).not.toBe(true);
    expect(
      Math.abs(r.estimate - (2 * Math.sqrt(0.3) + d / 4))
    ).toBeLessThanOrEqual(r.error);
  });

  // The deepest shells carry the second term, and the model of the shells
  // farther out leaves it out: with that model alone, the error was
  // `1.851e-3` for a true error of `1.865e-3`.
  test('two powers at a large endpoint keep an error that covers the true error', () => {
    const e = 1e9;
    const r = adaptiveQuadrature(
      (x) => (x - e) ** -0.5 + 1.33e-5 * (x - e) ** -0.99,
      e,
      e + 1,
      { singularEndpoints: true }
    );
    expect(Math.abs(r.estimate - (2 + 1.33e-5 / 0.01))).toBeLessThanOrEqual(
      r.error
    );
  });
});

describe('AN ENDPOINT SINGULARITY WITH NO FEATURE IS STILL EXTRAPOLATED', () => {
  test.each<[string, (x: number) => number, number, number, number]>([
    [
      '(0.3 − x)^(−1/2) on [0, 0.3]',
      (x) => 1 / Math.sqrt(0.3 - x),
      0,
      0.3,
      2 * Math.sqrt(0.3),
    ],
    // Rounding noise: `1 − x²` cancels next to 1.
    [
      '1/√(1 − x²) on [0, 1]',
      (x) => 1 / Math.sqrt(1 - x * x),
      0,
      1,
      Math.PI / 2,
    ],
    // Overflows at the denormals next to 0.
    ['x^(−0.99) on [0, 1]', (x) => x ** -0.99, 0, 1, 100],
    [
      '(x − 1000)^(−0.75) on [1000, 1001]',
      (x) => (x - 1000) ** -0.75,
      1000,
      1001,
      4,
    ],
    // The shells change sign: not tested.
    [
      'cos(ln t)/t^0.999 on [0, 1]',
      (t) => Math.cos(Math.log(t)) / t ** 0.999,
      0,
      1,
      0.001 / (0.001 ** 2 + 1),
    ],
  ])('%s', (_, f, a, b, value) => {
    const r = adaptiveQuadrature(f, a, b, { singularEndpoints: true });
    expect(r.extrapolated).toBe(true);
    expect(Math.abs(r.estimate - value)).toBeLessThanOrEqual(r.error);
  });
});
