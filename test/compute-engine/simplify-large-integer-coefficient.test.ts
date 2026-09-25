import { ComputeEngine } from '../../src/compute-engine';

// The simplification rule that combines powers with the same base factors an
// integer or rational coefficient into primes with `primeFactors()`. That
// function accepts only integers smaller than `Number.MAX_SAFE_INTEGER`, and it
// fires a `console.assert` for a larger value such as `1e30`. The rule must
// skip such coefficients instead of passing them.
describe('SIMPLIFY WITH A COEFFICIENT OUTSIDE THE SAFE-INTEGER RANGE', () => {
  const ce = new ComputeEngine();
  let failed: unknown[][] = [];
  let spy: jest.SpyInstance;

  beforeEach(() => {
    failed = [];
    spy = jest
      .spyOn(console, 'assert')
      .mockImplementation((condition?: unknown, ...args: unknown[]) => {
        if (!condition) failed.push(args);
      });
  });
  afterEach(() => spy.mockRestore());

  test.each([
    ['\\sin(10^{30}\\pi)', '0'],
    ['\\sin(10^{40}\\pi)', '0'],
    ['\\sin(10^{25}\\pi)', '0'],
    ['\\cos(10^{30}\\pi)', '1'],
    // Integer coefficient (`n`), rational coefficient with a large numerator
    // or denominator, and a radical coefficient with a large rational part.
    ['10^{30}\\cdot 2^x 5^y', '1e+30 * 2^x * 5^y'],
    ['\\frac{10^{30}}{3}2^x 3^y', '1e+30/3 * 2^x * 3^y'],
    ['\\frac{3}{10^{30}}2^x 5^y', '3/1e+30 * 2^x * 5^y'],
    ['\\frac{2^x}{10^{30}}', '1/1e+30 * 2^x'],
    ['10^{30}\\sqrt{2}\\cdot 2^x', '1e+30sqrt(2) * 2^x'],
    ['\\frac{\\sqrt{2}}{10^{30}}\\pi', 'sqrt(2)/1e+30 * pi'],
  ])('%s', (input, expected) => {
    expect(ce.parse(input).simplify().toString()).toBe(expected);
    expect(failed).toEqual([]);
  });

  test('a small coefficient is still combined with the powers', () => {
    expect(ce.parse('12\\cdot 2^x 3^y').simplify().toString()).toBe(
      '2^(x + 2) * 3^(y + 1)'
    );
    expect(ce.parse('6\\sqrt{2}\\cdot 2^x 3^y').simplify().toString()).toBe(
      '2^(x + 3/2) * 3^(y + 1)'
    );
    expect(failed).toEqual([]);
  });
});
