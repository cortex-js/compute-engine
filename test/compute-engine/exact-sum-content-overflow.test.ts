import { ComputeEngine } from '../../src/compute-engine';
import { lcm } from '../../src/compute-engine/numerics/numeric';
import { rationalGcd } from '../../src/compute-engine/numerics/rationals';

// The exact fold of a long sum of `ln(-k)/k²` terms extracts the content of
// the sum: the gcd of its rational coefficients, whose denominator is the lcm
// of `k²` over all the terms. For 300 terms that lcm is past the double
// range; `lcm` gave `Infinity`, and the next `lcm(Infinity, n)` threw a
// `RangeError` from `BigInt(Infinity)` (ROADMAP, found 2026-10-21).

const ce = new ComputeEngine();

describe('content of a long exact sum', () => {
  test('a comparison with a 300-term sum of logarithms does not throw', () => {
    const expr = ce.parse('0 < \\sum_{k=1}^{300} \\frac{\\ln(-k)}{k^2}');
    expect(expr.evaluate().toString()).toBe('"False"');
  });

  test('a comparison with a 3000-term sum of logarithms does not throw', () => {
    const expr = ce.parse('0 < \\sum_{k=1}^{3000} \\frac{\\ln(-k)}{k^2}');
    expect(expr.evaluate().toString()).toBe('"False"');
  });

  test('isLess on the sum does not throw', () => {
    const sum = ce.parse('\\sum_{k=1}^{300} \\frac{\\ln(-k)}{k^2}').evaluate();
    // The sum is complex (`ln(-k) = ln k + iπ`), so the method is undecided.
    expect(ce.number(0).isLess(sum)).toBeUndefined();
  });
});

describe('lcm and rationalGcd past the double range', () => {
  test('lcm of a non-finite or non-integer operand is NaN, as gcd', () => {
    expect(lcm(Infinity, 3)).toBeNaN();
    expect(lcm(3, Infinity)).toBeNaN();
    expect(lcm(2.5, 3)).toBeNaN();
    expect(lcm(0, NaN)).toBeNaN();
    expect(lcm(0, Infinity)).toBeNaN();
    expect(lcm(4, 6)).toBe(12);
    expect(lcm(-4, 6)).toBe(12);
    expect(lcm(0, 6)).toBe(0);
  });

  test('rationalGcd keeps an exact denominator past the safe integer range', () => {
    // 2^40 and 3^30 are coprime; their lcm is 2^40 · 3^30 ≈ 2.3e26.
    const d1 = 2 ** 40;
    const d2 = 3 ** 30;
    const [num, den] = rationalGcd([1, d1], [1, d2]);
    expect(typeof den).toBe('bigint');
    expect(den).toBe(BigInt(d1) * BigInt(d2));
    expect(num).toBe(1n);
  });

  test('rationalGcd gives a non-negative denominator past the safe range', () => {
    const [num, den] = rationalGcd([1, -(2 ** 40)], [1, 3 ** 30]);
    expect(den).toBe(BigInt(2 ** 40) * BigInt(3 ** 30));
    expect(num).toBe(1n);
  });

  test('rationalGcd keeps the machine form in the safe range', () => {
    expect(rationalGcd([2, 4], [3, 6])).toEqual([1, 12]);
    expect(rationalGcd([4, 1], [6, 1])).toEqual([2, 1]);
  });
});
