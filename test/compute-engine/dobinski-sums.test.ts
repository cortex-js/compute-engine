import { engine as ce } from '../utils';

/**
 * Moments of the exponential series, `Σ_{k≥a} kⁿ·rᵏ/k!`: the Touchard
 * polynomial times eʳ, and Dobiński's formula `Σ kⁿ/k! = e·Bₙ` for r = 1.
 * Every expected value is the sum of the first 40 terms (the tail is below
 * 1e-30 for these r).
 */
const partialSum = (n: number, r: number, a: number): number => {
  let total = 0;
  let term = 1; // rᵏ/k!
  for (let k = 0; k < 40; k++) {
    if (k >= a) total += k ** n * term;
    term = (term * r) / (k + 1);
  }
  return total;
};

const bell = [1, 1, 2, 5, 15, 52, 203, 877];

describe('Dobiński sums Σ kⁿ/k!', () => {
  for (const a of [0, 1]) {
    for (let n = 1; n < bell.length; n++) {
      const latex = `\\sum_{k=${a}}^\\infty \\frac{k^${n}}{k!}`;
      test(`${latex} = ${bell[n]}e (evaluate)`, () => {
        expect(ce.parse(latex).evaluate().json).toEqual(
          bell[n] === 1 ? 'ExponentialE' : ['Multiply', bell[n], 'ExponentialE']
        );
      });
    }
  }

  test('Σ k³/k! = 5e under evaluate(), simplify() and .N()', () => {
    const sum = ce.box([
      'Sum',
      ['Divide', ['Power', 'k', 3], ['Factorial', 'k']],
      ['Limits', 'k', 1, 'PositiveInfinity'],
    ]);
    expect(sum.evaluate().json).toEqual(['Multiply', 5, 'ExponentialE']);
    expect(sum.simplify().json).toEqual(['Multiply', 5, 'ExponentialE']);
    expect(sum.N().re).toBeCloseTo(5 * Math.E, 12);
  });

  const cases: [number, number, number][] = [
    [3, 1, 2],
    [2, 1, 5],
    [4, 2, 3],
    [2, 0.5, 1],
  ];
  for (const [n, r, a] of cases) {
    test(`Σ_{k≥${a}} k^${n}·${r}^k/k! matches the partial sum`, () => {
      const sum = ce.box([
        'Sum',
        [
          'Divide',
          ['Multiply', ['Power', 'k', n], ['Power', r, 'k']],
          ['Factorial', 'k'],
        ],
        ['Limits', 'k', a, 'PositiveInfinity'],
      ]);
      expect(sum.evaluate().N().re).toBeCloseTo(partialSum(n, r, a), 10);
      expect(sum.N().re).toBeCloseTo(partialSum(n, r, a), 10);
    });
  }

  test('a lower bound above 1 subtracts the terms below it: Σ_{k≥2} k²/k! = 2e − 1', () => {
    const e = ce.parse('\\sum_{k=2}^\\infty \\frac{k^2}{k!}').evaluate();
    expect(e.N().re).toBeCloseTo(2 * Math.E - 1, 12);
    expect(e.has('Sum')).toBe(false);
  });

  test('a free ratio: Σ k³xᵏ/k! = (x³ + 3x² + x)·eˣ', () => {
    const e = ce.parse('\\sum_{k=0}^\\infty \\frac{k^3 x^k}{k!}').evaluate();
    expect(e.subs({ x: 2 }).N().re).toBeCloseTo(partialSum(3, 2, 0), 10);
    expect(e.has('Sum')).toBe(false);
  });

  test('a coefficient: Σ 3k²/k! = 6e', () => {
    const e = ce.parse('\\sum_{k=1}^\\infty \\frac{3k^2}{k!}').evaluate();
    expect(e.N().re).toBeCloseTo(6 * Math.E, 12);
  });

  test('a polynomial over k!: Σ (k² + k)/k! = 3e, Σ (k² − 1)/k! = e', () => {
    expect(
      ce.parse('\\sum_{k=0}^\\infty \\frac{k^2+k}{k!}').evaluate().json
    ).toEqual(['Multiply', 3, 'ExponentialE']);
    expect(
      ce.parse('\\sum_{k=0}^\\infty \\frac{k^2-1}{k!}').evaluate().json
    ).toEqual('ExponentialE');
  });

  test('a large order is exact: Σ k^150/k! is e·B₁₅₀', () => {
    const e = ce.parse('\\sum_{k=0}^\\infty \\frac{k^{150}}{k!}').evaluate();
    expect(e.has('Sum')).toBe(false);
    expect(e.operator).toBe('Multiply');
  });

  test('a negative power of k stays a sum: Σ 1/(k·k!)', () => {
    const e = ce.parse('\\sum_{k=1}^\\infty \\frac{1}{k\\cdot k!}').evaluate();
    expect(e.has('Sum')).toBe(true);
  });
});
