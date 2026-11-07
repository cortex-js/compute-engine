/**
 * The limit at infinity of a logarithm reads its base.
 *
 * `Log(u)` is the logarithm in base 10, and `Log(u, b)` the logarithm in base
 * `b`. Both are `ln u / ln b`. `limitAtPosInf()` in
 * `src/compute-engine/symbolic/limit.ts` divides the limit of `ln u` by the
 * limit of `ln b` when that limit is a constant with a known sign, and else
 * gives the quotient `ln u / ln b` to the quotient rule. Before, the base was
 * not read: `log₁₀((2x + 1)/x)` gave `ln 2`, and `log_{x/(x+1)}(x)` gave `+∞`
 * (the base tends to 1 from below, so the limit is `−∞`).
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const atPosInf = (body: unknown): string =>
  ce
    .box(['Limit', ['Function', body, 'x'], 'PositiveInfinity'] as never)
    .evaluate()
    .toString();

// (2x + 1)/x, which tends to 2.
const twoPlus = ['Divide', ['Add', ['Multiply', 2, 'x'], 1], 'x'];

describe('A LOGARITHM IN BASE 10 OR IN A CONSTANT BASE', () => {
  test('log₁₀ of an argument that tends to 2 tends to log₁₀(2)', () => {
    expect(atPosInf(['Log', twoPlus])).toBe('ln(2) / ln(10)');
    const v = ce
      .box(['Limit', ['Function', ['Log', twoPlus], 'x'], 'PositiveInfinity'])
      .evaluate()
      .N().re;
    expect(v).toBeCloseTo(Math.log10(2), 12);
  });

  test.each([
    [['Log', twoPlus, 2], '1'],
    [['Log', ['Divide', 1, 'x']], '-oo'],
    [['Log', 'x', 2], '+oo'],
    // A base between 0 and 1 changes the sign of an infinite limit.
    [['Log', 'x', ['Rational', 1, 2]], '-oo'],
    [['Log', ['Divide', 1, 'x'], ['Rational', 1, 2]], '+oo'],
    // x·log₁₀(1 + 1/x) tends to 1/ln(10), not to 1.
    [['Multiply', 'x', ['Log', ['Divide', ['Add', 'x', 1], 'x']]], '1 / ln(10)'],
  ])('%j → %s', (body, expected) => {
    expect(atPosInf(body)).toBe(expected);
  });

  test('a base whose logarithm has no known sign declines', () => {
    // log_a(x) tends to +∞ when a > 1 and to −∞ when 0 < a < 1.
    expect(atPosInf(['Log', 'x', 'a'])).toMatch(/^lim/);
  });
});

describe('A BASE THAT DEPENDS ON THE VARIABLE', () => {
  test.each([
    // ln(x/(x + 1)) tends to 0 from below.
    [['Log', 'x', ['Divide', 'x', ['Add', 'x', 1]]], '-oo'],
    [['Log', 'x', ['Add', 'x', 1]], '1'],
    [['Log', ['Power', 'x', 3], 'x'], '3'],
    [['Log', 2, 'x'], '0'],
    // The base tends to 2, and to 1/2.
    [['Log', 'x', ['Add', 2, ['Divide', 1, 'x']]], '+oo'],
    [
      ['Log', 'x', ['Subtract', ['Rational', 1, 2], ['Divide', 1, 'x']]],
      '-oo',
    ],
  ])('%j → %s', (body, expected) => {
    expect(atPosInf(body)).toBe(expected);
  });

  test('an argument of 0 gives −∞ when ln b tends to +∞', () => {
    // log_x(0) = ln 0 / ln x is −∞ for each x > 1.
    expect(atPosInf(['Log', 0, 'x'])).toBe('-oo');
  });

  test('a base of 0 declines', () => {
    expect(atPosInf(['Log', 'x', 0])).toMatch(/^lim/);
  });
});
