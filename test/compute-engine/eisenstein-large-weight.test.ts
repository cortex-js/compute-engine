import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// Reference values: mpmath 1.3.0 at 120 digits, summing
// E_k(τ) = 1 − (2k/B_k) Σ_{m≥1} m^{k−1} qᵐ/(1 − qᵐ), q = e^{2πiτ}.
const REFERENCE: [number, number, number, number, number][] = [
  // k, Re τ, Im τ, Re E, Im E
  [4, 0, 1, 1.4557628922687093, 0],
  [12, 0.3, 0.9, -0.42959715699982927, -1.4503167555877787],
  [50, 0.4, 0.87, 8.8805290714079037, -3.8151192202071446],
  [100, 0.3, 0.9, 141.75814584287609, 133.55060233607557],
  [100, 0.4, 0.87, 49.328125681986543, -59.350788486044932],
  [100, 0.1, 1, 0.47913347395982934, -0.3137025253005848],
  [100, 0.2, 0.3, -1.264059123710867e44, 1.5606069127924181e44],
  [200, 0.1, 1, 1.172892663569051, 0.32679428912676245],
  [400, 0.4, 0.87, -31507089.946111971, 13619148.946208531],
  [400, 0.3, 0.9, -1409600756.5416952, 148664219.269962],
  [1000, 0.4, 0.87, -5.881782318457068e18, -3.6125790177871562e18],
];

function value(k: number, x: number, y: number, mode: 'N' | 'evaluate') {
  const e = ce.box(['EisensteinE', k, ['Complex', x, y]]);
  return mode === 'N' ? e.N() : e.evaluate();
}

function relativeError(
  actual: { re: number; im: number },
  re: number,
  im: number
): number {
  return Math.hypot(actual.re - re, actual.im - im) / Math.hypot(re, im);
}

describe('EisensteinE of a large weight', () => {
  test.each(REFERENCE)(
    'E_%d(%d + %di) agrees with mpmath',
    (k, x, y, re, im) => {
      const n = value(k, x, y, 'N');
      expect(n.operator).not.toBe('EisensteinE');
      expect(relativeError(n, re, im)).toBeLessThan(1e-13);
    }
  );

  test('evaluate() agrees with N()', () => {
    for (const [k, x, y] of [
      [100, 0.4, 0.87],
      [400, 0.4, 0.87],
    ]) {
      const a = value(k, x, y, 'evaluate');
      const b = value(k, x, y, 'N');
      expect(a.re).toEqual(b.re);
      expect(a.im).toEqual(b.im);
    }
  });

  test('N() at a higher precision answers in doubles, as before', () => {
    const saved = ce.precision;
    ce.precision = 30;
    try {
      const n = value(100, 0.4, 0.87, 'N');
      expect(
        relativeError(n, 49.328125681986543, -59.350788486044932)
      ).toBeLessThan(1e-13);
    } finally {
      ce.precision = saved;
    }
  });

  test('the value at 400 is finite, not ComplexInfinity', () => {
    const n = value(400, 0.4, 0.87, 'N');
    expect(n.isFinite).toBe(true);
  });

  test('modularity E_k(−1/τ) = τ^k E_k(τ), computed at both points', () => {
    // τ = 0.4 + 0.87i has |τ| < 1, so −1/τ is far into the cusp where the
    // sum is easy; the other side needs the cancellation.
    const x = 0.4;
    const y = 0.87;
    const abs2 = x * x + y * y;
    const x2 = -x / abs2;
    const y2 = y / abs2;
    for (const k of [12, 50, 100, 200]) {
      const e = value(k, x, y, 'N');
      const f = value(k, x2, y2, 'N');
      // τ^k by polar form
      const mod = Math.pow(Math.sqrt(abs2), k);
      const arg = k * Math.atan2(y, x);
      const re = mod * Math.cos(arg);
      const im = mod * Math.sin(arg);
      const pr = re * e.re - im * e.im;
      const pi = re * e.im + im * e.re;
      expect(Math.hypot(f.re - pr, f.im - pi)).toBeLessThan(
        1e-9 * (1 + Math.hypot(pr, pi))
      );
    }
  });

  test('E_8 = E_4² where the series cancels', () => {
    const e4 = value(4, 0.4, 0.87, 'N');
    const e8 = value(8, 0.4, 0.87, 'N');
    const re = e4.re * e4.re - e4.im * e4.im;
    const im = 2 * e4.re * e4.im;
    expect(relativeError(e8, re, im)).toBeLessThan(1e-13);
  });

  test('the elliptic points are zero to the floor of the series', () => {
    const e6 = value(6, 0, 1, 'N');
    expect(Math.hypot(e6.re, e6.im)).toBeLessThan(1e-25);
    const e4 = value(4, -0.5, Math.sqrt(3) / 2, 'N');
    expect(Math.hypot(e4.re, e4.im)).toBeLessThan(1e-14);
  });

  test('a point that needs more digits than the cap stays unevaluated', () => {
    // 10⁷⁴⁷ for a value of order 1 at k = 1000 needs more than 800 digits
    expect(value(1000, 0.37, 0.1, 'N').operator).toBe('EisensteinE');
  });

  test('a weight above the cap stays unevaluated', () => {
    expect(value(1002, 0.4, 0.87, 'N').operator).toBe('EisensteinE');
  });

  test('small-weight values keep their digits', () => {
    const e4 = value(4, 0, 1, 'N');
    expect(e4.re).toBeCloseTo(1.4557628922687093, 14);
    const e2 = value(2, 0, 1, 'N');
    expect(e2.re).toBeCloseTo(3 / Math.PI, 14);
  });
});
