import { ComputeEngine } from '../../src/compute-engine';

/**
 * The numeric folds of `Sum` and `Product` round each partial result to the
 * working precision (`roundedToWorkingPrecision`, `library/arithmetic.ts`).
 *
 * The `add` and `mul` of a big decimal are exact. A running sum of big
 * floats whose exponents differ kept a significand as wide as the exponent
 * span (`Sum(n^n, n, 1, 8000).N()` built a 31,225-digit accumulator for a
 * 21-digit answer), and a running product grew by one working precision per
 * factor, so both folds were quadratic in the number of terms.
 *
 * The digit count is read from the MathJSON of the result, which keeps every
 * digit of a big float (`BigNumericValue.toJSON`), where `toString` rounds
 * for display.
 */

const ce = new ComputeEngine();

/** The number of significant digits the MathJSON of `x` carries. */
function jsonDigits(x: { json: unknown }): number {
  const s = JSON.stringify(x.json);
  const m = /"num":"([^"]+)"/.exec(s);
  const digits = (m ? m[1] : s)
    .replace(/e[+-]?\d+$/, '')
    .replace(/[^0-9]/g, '');
  return digits.replace(/^0+/, '').length;
}

describe('numeric Sum accumulator stays at the working precision', () => {
  test('a big-op sum of big floats', () => {
    const sum = ce.parse('\\sum_{n=1}^{400} n^n').N();
    // The exact value is 667416034701924785765596…, 1041 digits.
    expect(sum.toString()).toBe('6.67416034701924785766e+1040');
    expect(jsonDigits(sum)).toBeLessThanOrEqual(2 * ce.precision + 2);
  });

  test('a sum of a list of big floats with distinct exponents', () => {
    const list = Array.from({ length: 300 }, (_, i) => ({
      num: `1.5e${3 * i}`,
    }));
    const sum = ce.box(['Sum', ['List', ...list]]).N();
    expect(sum.toString()).toMatch(/^1\.5015015015015015015e\+897$/);
    expect(jsonDigits(sum)).toBeLessThanOrEqual(2 * ce.precision + 2);
  });

  test('the rounding keeps the digits the answer has', () => {
    // The float 10^30 plus 1 at 21 digits is 10^30: the 1 is past the
    // precision. (`{ num: '1e30' }` would be the EXACT integer, which the
    // exact arithmetic keeps whole.)
    const sum = ce.box(['Sum', ['List', { num: '1.0e30' }, 1]]).N();
    expect(sum.toString()).toBe('1e+30');
    // Two terms within the precision add exactly.
    const small = ce
      .box(['Sum', ['List', { num: '1.25e10' }, { num: '3.5' }]])
      .N();
    expect(small.toString()).toBe('12500000003.5');
  });

  test('a term that a later term cancels is kept, as the scalar Add keeps it', () => {
    const ops = [{ num: '1.0e30' }, 1, { num: '-1.0e30' }];
    expect(
      ce
        .box(['Add', ...ops])
        .N()
        .toString()
    ).toBe('1');
    expect(
      ce
        .box(['Sum', ['List', ...ops]])
        .N()
        .toString()
    ).toBe('1');
    expect(
      ce
        .box(['Sum', ['List', ...ops]])
        .evaluate()
        .toString()
    ).toBe('1');
    // The cancelled term is far below the guard digits as well.
    const wide = [{ num: '1.0e80' }, 1, { num: '-1.0e80' }];
    expect(
      ce
        .box(['Sum', ['List', ...wide]])
        .N()
        .toString()
    ).toBe('1');
  });

  test('many terms below half a unit of the accumulator are not lost', () => {
    // At 21 digits a unit of 10^23 is 10^3, and 400 is below half of it.
    const list = [
      { num: '1.0e23' },
      ...Array.from({ length: 10000 }, () => ({ num: '400.0' })),
    ];
    const sum = ce.box(['Sum', ['List', ...list]]).N();
    expect(sum.toString()).toBe('1.00000000000000004e+23');
  });

  test('the exact route is not rounded', () => {
    // Exact integers keep every digit under `evaluate()`.
    const exact = ce.parse('\\sum_{n=1}^{60} n^n').evaluate();
    expect(jsonDigits(exact)).toBeGreaterThan(100);
  });
});

describe('numeric Product accumulator stays at the working precision', () => {
  test('a big-op product of big floats', () => {
    const product = ce.parse('\\prod_{n=1}^{500} (1 + \\frac{1}{n})').N();
    // ∏ (1 + 1/n) for n = 1..k telescopes to k + 1.
    expect(product.toString()).toBe('501');
    expect(jsonDigits(product)).toBeLessThanOrEqual(2 * ce.precision + 2);
  });

  test('a product of a list of big floats', () => {
    const list = Array.from({ length: 200 }, () => ({ num: '1.1' }));
    const product = ce.box(['Product', ['List', ...list]]).N();
    // 1.1^200 = 1.8990527645…×10^8
    expect(product.toString()).toMatch(/^189905276\.4/);
    expect(jsonDigits(product)).toBeLessThanOrEqual(2 * ce.precision + 2);
  });
});

describe('the asynchronous twins round the same way', () => {
  test('Sum', async () => {
    const sum = await ce
      .parse('\\sum_{n=1}^{400} n^n')
      .evaluateAsync({ numericApproximation: true });
    expect(sum.toString()).toBe('6.67416034701924785766e+1040');
    expect(jsonDigits(sum)).toBeLessThanOrEqual(2 * ce.precision + 2);
  });

  test('Product', async () => {
    const product = await ce
      .parse('\\prod_{n=1}^{500} (1 + \\frac{1}{n})')
      .evaluateAsync({ numericApproximation: true });
    expect(product.toString()).toBe('501');
    expect(jsonDigits(product)).toBeLessThanOrEqual(2 * ce.precision + 2);
  });
});
