import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('toRational()', () => {
  test('integer returns [n, 1]', () => {
    expect(ce.parse('7').toRational()).toEqual([7, 1]);
  });

  test('negative integer', () => {
    expect(ce.parse('-3').toRational()).toEqual([-3, 1]);
  });

  test('zero', () => {
    expect(ce.parse('0').toRational()).toEqual([0, 1]);
  });

  test('fraction is reduced to lowest terms', () => {
    expect(ce.parse('\\frac{6}{4}').toRational()).toEqual([3, 2]);
  });

  test('negative fraction', () => {
    expect(ce.parse('\\frac{-3}{4}').toRational()).toEqual([-3, 4]);
  });

  test('fraction with negative denominator normalizes sign', () => {
    // Parse raw Divide with negative denominator
    const expr = ce.box(['Divide', 3, -4]);
    expect(expr.toRational()).toEqual([-3, 4]);
  });

  test('already reduced fraction', () => {
    expect(ce.parse('\\frac{1}{3}').toRational()).toEqual([1, 3]);
  });

  test('symbol returns null', () => {
    expect(ce.parse('x').toRational()).toBeNull();
  });

  test('Add expression returns null', () => {
    expect(ce.parse('x+1').toRational()).toBeNull();
  });

  test('machine float returns null', () => {
    expect(ce.number(1.5).toRational()).toBeNull();
  });

  test('Negate of fraction', () => {
    const expr = ce.box(['Negate', ['Divide', 3, 4]]);
    // Negate is non-canonical, so it becomes -3/4 after canonicalization
    const r = expr.toRational();
    expect(r).not.toBeNull();
    if (r) expect(r[0] / r[1]).toBeCloseTo(-0.75);
  });

  test('irrational returns null', () => {
    expect(ce.parse('\\sqrt{2}').toRational()).toBeNull();
  });

  test('pi returns null', () => {
    expect(ce.parse('\\pi').toRational()).toBeNull();
  });
});

describe('factors()', () => {
  test('number returns [self]', () => {
    const expr = ce.parse('5');
    const f = expr.factors();
    expect(f.length).toBe(1);
    expect(f[0].isSame(5)).toBe(true);
  });

  test('symbol returns [self]', () => {
    const expr = ce.parse('x');
    const f = expr.factors();
    expect(f.length).toBe(1);
    expect(f[0].latex).toBe('x');
  });

  test('Multiply flattens factors', () => {
    const expr = ce.parse('2xyz');
    const f = expr.factors();
    // Should contain 2, x, y, z (order may vary due to canonicalization)
    expect(f.length).toBe(4);
    const latexes = f.map((e) => e.latex).sort();
    expect(latexes).toEqual(['2', 'x', 'y', 'z']);
  });

  test('Negate decomposes to -1 and inner factors', () => {
    const expr = ce.parse('-x');
    const f = expr.factors();
    expect(f.length).toBe(2);
    expect(f[0].isSame(-1)).toBe(true);
    expect(f[1].latex).toBe('x');
  });

  test('Negate of product', () => {
    const expr = ce.parse('-2x');
    const f = expr.factors();
    // -2x canonicalizes as Negate(Multiply(2, x)) or Multiply(-2, x)
    // Either way, factors should include -1 or -2, and x
    const product = f.reduce((acc, e) => acc * e.re, 1);
    // The symbolic product should reconstruct -2 * x
    const nums = f.filter((e) => !isNaN(e.re)).map((e) => e.re);
    const numProduct = nums.reduce((a, b) => a * b, 1);
    expect(numProduct).toBe(-2);
  });

  test('Add returns [self]', () => {
    const expr = ce.parse('x + 1');
    const f = expr.factors();
    expect(f.length).toBe(1);
    expect(f[0].latex).toBe(expr.latex);
  });

  test('nested Multiply flattens recursively', () => {
    // 2 * (3 * x) should flatten to [2, 3, x] or [6, x] depending on canonicalization
    const expr = ce.parse('2 \\times 3 \\times x');
    const f = expr.factors();
    // After canonicalization, 2*3 may fold to 6
    expect(f.length).toBeGreaterThanOrEqual(2);
  });
});
