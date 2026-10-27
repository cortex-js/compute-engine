import { integrateSemiInfiniteOscillatory } from '../../src/compute-engine/numerics/oscillatory-quadrature';

/**
 * A lobe with a finite value and an error with no bound (ROADMAP CE-549).
 *
 * `integrateSemiInfiniteOscillatory` integrates `∫ₐ^∞ f` lobe by lobe. A
 * lobe that holds a singular point is integrated again in two parts, with
 * the singular point at an end of each part (`splitLobe`). When the
 * adaptive quadrature of a part reports an error of `+∞` with a finite
 * value, the result was `{ estimate: NaN, error: NaN }`: the part was taken
 * for a divergence, and the lobe kept the result of its GK15 panels, whose
 * error was larger than every tolerance, at each of the 2000 lobes.
 *
 * The integrand has poles `|t − c|^(−1/2)` at 4 and at the first and the
 * fourth double above 4. The quadrature of the part above 4 cannot bound its
 * error: the sample 3 doubles beyond the second singular point is at the
 * third one, where the integrand is `+∞`.
 *
 * The integral is the sum of the integrals with one pole, which the routine
 * finds with an error of about `3e-11` each.
 */

/** The double `k` doubles above `x`. */
function doubleAt(x: number, k: number): number {
  const buffer = new Float64Array([x]);
  const bits = new BigInt64Array(buffer.buffer);
  bits[0] += BigInt(k);
  return buffer[0];
}

const onePole = (c: number) =>
  integrateSemiInfiniteOscillatory(
    (t) => Math.sin(t) / ((1 + t) * Math.sqrt(Math.abs(t - c))),
    0
  )!;

describe('A LOBE WHOSE ERROR HAS NO BOUND', () => {
  test.each([
    [[0, 1, 4], 4],
    [[0, 1, 4, 13], 4],
    [[0, 1, 4, 13], 5],
  ] as [number[], number][])('poles %j doubles above %p', (offsets, x) => {
    const poles = offsets.map((k) => doubleAt(x, k));
    const r = integrateSemiInfiniteOscillatory(
      (t) =>
        (Math.sin(t) * poles.reduce((s, c) => s + Math.abs(t - c) ** -0.5, 0)) /
        (1 + t),
      0
    );
    expect(r).not.toBeNull();
    const parts = poles.map(onePole);
    const truth = parts.reduce((s, p) => s + p.estimate, 0);
    // A finite value, not `NaN`, within its error, and close to the sum
    // of the integrals with one pole.
    expect(Number.isFinite(r!.estimate)).toBe(true);
    expect(Number.isNaN(r!.error)).toBe(false);
    expect(Math.abs(r!.estimate - truth)).toBeLessThanOrEqual(r!.error);
    expect(Math.abs(r!.estimate - truth)).toBeLessThan(1e-9);
  });

  // A pole that is not integrable still gives no value: the part of the lobe
  // next to it diverges.
  test.each([
    ['sin t/(t − 5)²', (t: number) => Math.sin(t) / (t - 5) ** 2],
    ['sin t/|t − 5|', (t: number) => Math.sin(t) / Math.abs(t - 5)],
    ['sin t/(t − π)²', (t: number) => Math.sin(t) / (t - Math.PI) ** 2],
  ] as [string, (t: number) => number][])('∫₀^∞ %s dt has no value', (_, f) => {
    const r = integrateSemiInfiniteOscillatory(f, 0);
    expect(r === null || !Number.isFinite(r.estimate)).toBe(true);
  });
});
