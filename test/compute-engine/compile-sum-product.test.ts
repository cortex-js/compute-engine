/**
 * Tests for Sum and Product compilation
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

/**
 * Extract the numeric interval {lo, hi} from an IntervalResult.
 * Handles both plain {lo, hi} and {kind: 'interval', value: {lo, hi}}.
 */
function unwrapInterval(val: unknown): { lo: number; hi: number } {
  if (val && typeof val === 'object') {
    if ('kind' in val && (val as any).kind === 'interval') {
      return (val as any).value;
    }
    if ('lo' in val && 'hi' in val) {
      return val as { lo: number; hi: number };
    }
  }
  throw new Error(`Expected interval result, got: ${JSON.stringify(val)}`);
}

describe('COMPILE Sum', () => {
  test('simple sum: sum_{k=0}^{3} k^2 = 0+1+4+9 = 14', () => {
    const expr = ce.parse('\\sum_{k=0}^{3} k^2');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(14);
  });

  test('sum with variable: sum_{k=0}^{2} k*x, x=3 => 0+3+6 = 9', () => {
    const expr = ce.parse('\\sum_{k=0}^{2} k \\cdot x');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 3 })).toBe(9);
  });

  test('single term: sum_{k=0}^{0} k^2 = 0', () => {
    const expr = ce.parse('\\sum_{k=0}^{0} k^2');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(0);
  });

  test('empty range: sum_{k=5}^{3} k = 0', () => {
    const expr = ce.parse('\\sum_{k=5}^{3} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(0);
  });

  test('Fourier-like: sum_{k=0}^{2} sin((2k+1)x)/(2k+1) at x=1', () => {
    const expr = ce.parse(
      '\\sum_{k=0}^{2} \\frac{\\sin((2k+1)x)}{2k+1}'
    );
    const result = compile(expr);
    expect(result.success).toBe(true);
    // sin(1)/1 + sin(3)/3 + sin(5)/5
    const expected =
      Math.sin(1) / 1 + Math.sin(3) / 3 + Math.sin(5) / 5;
    expect(result.run!({ x: 1 })).toBeCloseTo(expected, 10);
  });
});

describe('COMPILE Product', () => {
  test('factorial: prod_{k=1}^{4} k = 24', () => {
    const expr = ce.parse('\\prod_{k=1}^{4} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(24);
  });

  test('product with variable: prod_{k=1}^{3} (x-k), x=5 => 4*3*2 = 24', () => {
    const expr = ce.parse('\\prod_{k=1}^{3} (x - k)');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 5 })).toBe(24);
  });

  test('empty range product: prod_{k=5}^{3} k = 1', () => {
    const expr = ce.parse('\\prod_{k=5}^{3} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(1);
  });

  test('single term product: prod_{k=3}^{3} k = 3', () => {
    const expr = ce.parse('\\prod_{k=3}^{3} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(3);
  });
});

describe('COMPILE Sum - interval-js', () => {
  test('simple sum: sum_{k=0}^{3} k^2 = 14', () => {
    const expr = ce.parse('\\sum_{k=0}^{3} k^2');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!());
    expect(val.lo).toBeCloseTo(14, 10);
    expect(val.hi).toBeCloseTo(14, 10);
  });

  test('sum with variable: sum_{k=0}^{2} k*x, x=3 => 9', () => {
    const expr = ce.parse('\\sum_{k=0}^{2} k \\cdot x');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!({ x: 3 }));
    expect(val.lo).toBeCloseTo(9, 10);
    expect(val.hi).toBeCloseTo(9, 10);
  });

  test('empty range: sum_{k=5}^{3} k = 0', () => {
    const expr = ce.parse('\\sum_{k=5}^{3} k');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!());
    expect(val.lo).toBe(0);
    expect(val.hi).toBe(0);
  });
});

describe('COMPILE Sum - symbolic bounds', () => {
  test('JS: sum_{k=0}^{n} k with n=4 => 0+1+2+3+4 = 10', () => {
    const expr = ce.parse('\\sum_{k=0}^{n} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ n: 4 })).toBe(10);
  });

  test('JS: Taylor sin(x) = sum_{k=0}^{n} (-1)^k x^(2k+1)/(2k+1)!', () => {
    const expr = ce.parse(
      '\\sum_{k=0}^{n} \\frac{(-1)^k x^{2k+1}}{(2k+1)!}'
    );
    const result = compile(expr);
    expect(result.success).toBe(true);
    const val = result.run!({ x: 0.5, n: 10 });
    expect(val).toBeCloseTo(Math.sin(0.5), 10);
  });

  test('JS: product with symbolic bound: prod_{k=1}^{n} k = n!', () => {
    const expr = ce.parse('\\prod_{k=1}^{n} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ n: 5 })).toBe(120);
    expect(result.run!({ n: 0 })).toBe(1); // empty range
  });

  test('interval-js: sum_{k=0}^{n} k with n=4 => 10', () => {
    const expr = ce.parse('\\sum_{k=0}^{n} k');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!({ n: 4 }));
    expect(val.lo).toBeCloseTo(10, 10);
    expect(val.hi).toBeCloseTo(10, 10);
  });

  test('interval-js: Taylor sin(x) with symbolic n', () => {
    const expr = ce.parse(
      '\\sum_{k=0}^{n} \\frac{(-1)^k x^{2k+1}}{(2k+1)!}'
    );
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!({ x: 0.5, n: 10 }));
    expect(val.lo).toBeCloseTo(Math.sin(0.5), 10);
    expect(val.hi).toBeCloseTo(Math.sin(0.5), 10);
  });

  test('interval-js: product with symbolic bound: prod_{k=1}^{n} k', () => {
    const expr = ce.parse('\\prod_{k=1}^{n} k');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!({ n: 5 }));
    expect(val.lo).toBeCloseTo(120, 10);
    expect(val.hi).toBeCloseTo(120, 10);
  });

  // Symbolic LOWER bound tests
  test('JS: sum_{k=m}^{10} k with m=3 => 3+4+...+10 = 52', () => {
    const expr = ce.parse('\\sum_{k=m}^{10} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ m: 3 })).toBe(52);
  });

  test('JS: sum_{k=m}^{n} k with m=1 n=4 => 10', () => {
    const expr = ce.parse('\\sum_{k=m}^{n} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ m: 1, n: 4 })).toBe(10);
  });

  test('interval-js: sum_{k=m}^{10} k with m=3 => 52', () => {
    const expr = ce.parse('\\sum_{k=m}^{10} k');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!({ m: 3 }));
    expect(val.lo).toBeCloseTo(52, 10);
    expect(val.hi).toBeCloseTo(52, 10);
  });

  test('JS: prod_{k=m}^{5} k with m=3 => 3*4*5 = 60', () => {
    const expr = ce.parse('\\prod_{k=m}^{5} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ m: 3 })).toBe(60);
  });
});

describe('COMPILE Product - interval-js', () => {
  test('factorial: prod_{k=1}^{4} k = 24', () => {
    const expr = ce.parse('\\prod_{k=1}^{4} k');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!());
    expect(val.lo).toBeCloseTo(24, 10);
    expect(val.hi).toBeCloseTo(24, 10);
  });

  test('product with variable: prod_{k=1}^{3} (x-k), x=5 => 24', () => {
    const expr = ce.parse('\\prod_{k=1}^{3} (x - k)');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!({ x: 5 }));
    expect(val.lo).toBeCloseTo(24, 10);
    expect(val.hi).toBeCloseTo(24, 10);
  });

  test('empty range product: prod_{k=5}^{3} k = 1', () => {
    const expr = ce.parse('\\prod_{k=5}^{3} k');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!());
    expect(val.lo).toBe(1);
    expect(val.hi).toBe(1);
  });
});

describe('COMPILE Integrate - symbolic bounds', () => {
  test('JS: int_0^a x dx with a=2 => 2', () => {
    const expr = ce.parse('\\int_0^a x \\, dx');
    const result = compile(expr);
    expect(result.success).toBe(true);
    // int_0^2 x dx = x^2/2 |_0^2 = 2
    const val = result.run!({ a: 2 });
    expect(val).toBeCloseTo(2, 1);
  });

  test('JS: int_a^b x dx with a=0 b=1 => 0.5', () => {
    const expr = ce.parse('\\int_a^b x \\, dx');
    const result = compile(expr);
    expect(result.success).toBe(true);
    const val = result.run!({ a: 0, b: 1 });
    expect(val).toBeCloseTo(0.5, 1);
  });
});
