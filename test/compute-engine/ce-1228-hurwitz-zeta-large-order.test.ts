/**
 * ζ(s, a) = Σ (k + a)^(−s) at a very large order s ends (CE-1228).
 *
 * The double kernel (`hurwitzEMComplex`, `numerics/numeric-complex.ts`) adds
 * terms until the bound of the rest is below 1e−17 of the sum. At s = 1e300,
 * a = 2 the first term underflows to 0, and 1e−17 of a sum of 0 is 0, which
 * no rest is below: the loop ran for about |s| terms. It ran as long when the
 * sum is a subnormal number, where 1e−17 of it underflows too. The kernel now
 * compares in logarithms and also stops once the rest is below half the
 * smallest subnormal, which cannot change any double. The interpreter reaches
 * this kernel when the bignum kernel declines (its terms underflow or
 * overflow the big-decimal range), and compiled `HurwitzZeta` calls it.
 *
 * For a large s the first term a^(−s) dominates: the value tends to 0 for
 * a > 1, to 1 for a = 1 (and for `Zeta(s, 0)` = ζ(s)), and to +∞ for
 * 0 < a < 1. A value past the double range keeps the expression symbolic in
 * the interpreter, and is `Infinity` in compiled code. A stuck kernel
 * blocks the test file until the runner's outer `timeout` stops it.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');

const interpreted = (op: string, s: number, a: unknown): string =>
  ce.box([op, s, a] as never).N().toString();

describe('ZETA(S, A) AT A VERY LARGE ORDER IN THE INTERPRETER', () => {
  test.each([
    ['HurwitzZeta', 2, '0'],
    ['HurwitzZeta', 1.5, '0'],
    ['HurwitzZeta', 1, '1'],
    ['HurwitzZeta', 0, '~oo'],
    ['HurwitzZeta', 0.5, 'HurwitzZeta(1e+300, 0.5)'],
    ['Zeta', 2, '0'],
    ['Zeta', 1, '1'],
    ['Zeta', 0, '1'],
    ['Zeta', -2, '2'],
    ['Zeta', 0.5, 'Zeta(1e+300, 0.5)'],
  ])('%s(1e300, %p) = %s', (op, a, expected) => {
    expect(interpreted(op, 1e300, a)).toBe(expected);
  });

  test('a complex a or a complex order', () => {
    expect(interpreted('HurwitzZeta', 1e300, ['Complex', 2, 1])).toBe('0');
    expect(
      ce.box(['HurwitzZeta', ['Complex', 1e300, 1], 2]).N().toString()
    ).toBe('0');
  });
});

describe('COMPILED HURWITZZETA(X, Y) AT A VERY LARGE ORDER', () => {
  const f = compile(ce.box(['HurwitzZeta', 'x', 'y']));
  const run = (s: number, a: number) => f.run!({ x: s, y: a }) as number;

  test('compiles', () => expect(f.success).toBe(true));

  test.each([
    [2, 0],
    [1.5, 0],
    [1, 1],
    [0.5, Infinity],
  ])('HurwitzZeta(1e300, %p) = %p', (a, expected) => {
    expect(run(1e300, a)).toBe(expected);
  });

  test('a large order below the double range', () => {
    // 2^(−10⁶) underflows; the loop added about 10⁶ terms of 0
    expect(run(1e6, 2)).toBe(0);
  });

  test('a subnormal value: the sum is above 0, and 1e−17 of it is 0', () => {
    // a = 1 + 2⁻²⁴ is exact in a double and in a rational, so the bignum
    // interpreter computes the same sum to 21 digits: ζ ≈ 2.3355505e−311.
    // A subnormal keeps about 41 bits here.
    const s = 1.2e10;
    const a = 1 + 2 ** -24;
    const reference = ce
      .box(['HurwitzZeta', s, ['Rational', 16777217, 16777216]])
      .N().re;
    expect(reference).toBeGreaterThan(0);
    expect(reference).toBeLessThan(2.2250738585072014e-308);
    expect(Math.abs(run(s, a) / reference - 1)).toBeLessThan(1e-9);
  });

  test('a moderate order keeps its value', () => {
    // Against the bignum interpreter at 21 digits.
    for (const [s, a] of [
      [20, 1.5],
      [200, 2],
      [3000, 0.9],
    ]) {
      const reference = ce.box(['HurwitzZeta', s, a]).N().re;
      expect(Math.abs(run(s, a) / reference - 1)).toBeLessThan(1e-12);
    }
  });
});
