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

describe('COMPILE Sum - iterationBudget', () => {
  // The budget keeps a single compiled call cheap enough for the engine
  // deadline to be honored between calls on the numeric limit ladder (the
  // Stage-2 corpus-audit deadline escape: N() of a Limit at +∞ whose body
  // contains a variable-bound Sum ran unbounded past ce.timeLimit).
  test('within budget: normal result', () => {
    const expr = ce.parse('\\sum_{k=1}^{n} k');
    const result = compile(expr, { iterationBudget: 1e6 });
    expect(result.success).toBe(true);
    expect(result.run!({ n: 4 })).toBe(10);
  });

  test('over budget: NaN instead of running the loop', () => {
    const expr = ce.parse('\\sum_{k=1}^{n} k');
    const result = compile(expr, { iterationBudget: 1e6 });
    expect(result.success).toBe(true);
    expect(result.run!({ n: 1e12 })).toBeNaN();
  });

  test('infinite bound: NaN instead of a non-terminating loop', () => {
    const expr = ce.parse('\\sum_{k=1}^{\\infty} \\frac{1}{k^2}');
    const result = compile(expr, { iterationBudget: 1e6 });
    expect(result.success).toBe(true);
    expect(result.run!({})).toBeNaN();
  });

  test('no budget: loops of any length run (unchanged public behavior)', () => {
    const expr = ce.parse('\\sum_{k=1}^{n} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ n: 2e6 })).toBe((2e6 * (2e6 + 1)) / 2);
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

// Regression: WP-2.8 / P0-43 — multi-index Sum/Product must honor *every*
// indexing-set clause. Previously only the first Limits clause was read,
// leaving the trailing indices dangling (`_.j` undefined → NaN) while the
// result still reported success and an empty freeSymbols set.
describe('COMPILE Sum/Product - multi-index (P0-43 regression)', () => {
  const engine = new ComputeEngine();

  test('JS: double-index sum ∑_{i=1}^{3} ∑_{j=1}^{3} i·j = 36', () => {
    const expr = engine.box([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Limits', 'i', 1, 3],
      ['Limits', 'j', 1, 3],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(36);
    // No dangling free symbol — all indices are bound.
    expect(result.freeSymbols).toEqual([]);
  });

  test('JS: triple-index sum ∑∑∑ i·j·k over 1..2 = 27', () => {
    const expr = engine.box([
      'Sum',
      ['Multiply', 'i', ['Multiply', 'j', 'k']],
      ['Limits', 'i', 1, 2],
      ['Limits', 'j', 1, 2],
      ['Limits', 'k', 1, 2],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(27);
  });

  test('JS: double-index product ∏_{i=1}^{2} ∏_{j=1}^{2} (i+j) = 72', () => {
    const expr = engine.box([
      'Product',
      ['Add', 'i', 'j'],
      ['Limits', 'i', 1, 2],
      ['Limits', 'j', 1, 2],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(72);
  });

  test('JS: multi-index with a large outer (loop) range nests correctly', () => {
    // Outer range exceeds the unroll limit → outer while-loop, inner unroll.
    const expr = engine.box([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Limits', 'i', 1, 150],
      ['Limits', 'j', 1, 3],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    // (∑_{1..150} i)·(∑_{1..3} j) = 11325·6 = 67950
    expect(result.run!({})).toBe(67950);
  });

  test('GPU: multi-index Sum fails closed (not silently wrong)', () => {
    const expr = engine.box([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Limits', 'i', 1, 3],
      ['Limits', 'j', 1, 3],
    ]);
    const result = compile(expr, { to: 'glsl' });
    expect(result.success).toBe(false);
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
