/**
 * Tests for the Sinc (cardinal sine) function
 *
 * sinc(x) = sin(x)/x with sinc(0) = 1 (unnormalized)
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

describe('SINC - Evaluation', () => {
  test('sinc(0) = 1', () => {
    const expr = ce.box(['Sinc', 0]);
    const result = expr.evaluate();
    expect(result.re).toBe(1);
  });

  test('sinc(0) via LaTeX parse', () => {
    const expr = ce.parse('\\operatorname{sinc}(0)');
    expect(expr.operator).toBe('Sinc');
    const result = expr.N();
    expect(result.re).toBe(1);
  });

  test('sinc(pi) is approximately 0', () => {
    const expr = ce.box(['Sinc', 'Pi']);
    const result = expr.N();
    // sin(pi)/pi should be very close to 0
    expect(Math.abs(result.re)).toBeLessThan(1e-10);
  });

  test('sinc(1) is approximately sin(1)', () => {
    const expr = ce.box(['Sinc', 1]);
    const result = expr.N();
    // sinc(1) = sin(1)/1 = sin(1)
    expect(result.re).toBeCloseTo(Math.sin(1), 10);
  });

  test('sinc(2) is approximately sin(2)/2', () => {
    const expr = ce.box(['Sinc', 2]);
    const result = expr.N();
    expect(result.re).toBeCloseTo(Math.sin(2) / 2, 10);
  });
});

describe('SINC - LaTeX parsing and serialization', () => {
  test('parses \\operatorname{sinc}(x)', () => {
    const expr = ce.parse('\\operatorname{sinc}(x)');
    expect(expr.operator).toBe('Sinc');
    expect(expr.json).toEqual(['Sinc', 'x']);
  });

  test('round-trip: parse and serialize', () => {
    const expr = ce.parse('\\operatorname{sinc}(x)');
    const latex = expr.latex;
    // Serialization should produce valid LaTeX containing sinc
    expect(latex).toContain('sinc');
  });
});

describe('SINC - JavaScript compilation', () => {
  test('compiles Sinc to _SYS.sinc', () => {
    const expr = ce.box(['Sinc', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toContain('_SYS.sinc');
  });

  test('compiled sinc(0) returns 1', () => {
    const expr = ce.box(['Sinc', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    const fn = result.run!;
    expect(fn({ x: 0 })).toBe(1);
  });

  test('compiled sinc(1) returns sin(1)/1', () => {
    const expr = ce.box(['Sinc', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    const fn = result.run!;
    expect(fn({ x: 1 })).toBeCloseTo(Math.sin(1), 10);
  });

  test('compiled sinc(pi) is approximately 0', () => {
    const expr = ce.box(['Sinc', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    const fn = result.run!;
    expect(Math.abs(fn({ x: Math.PI }))).toBeLessThan(1e-10);
  });
});

describe('SINC - Interval JS compilation', () => {
  test('compiles Sinc to _IA.sinc', () => {
    const expr = ce.box(['Sinc', 'x']);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    expect(result.code).toContain('_IA.sinc');
  });

  test('interval containing 0 includes 1 in result', () => {
    const expr = ce.box(['Sinc', 'x']);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const fn = result.run!;
    // Pass an interval containing 0
    const interval = fn({ x: { lo: -1, hi: 1 } });
    // The result should contain 1 (the value at 0)
    expect(interval.kind).toBe('interval');
    if (interval.kind === 'interval') {
      expect(interval.value.hi).toBeGreaterThanOrEqual(1);
    }
  });

  test('interval not containing 0', () => {
    const expr = ce.box(['Sinc', 'x']);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const fn = result.run!;
    // Pass an interval not containing 0
    const interval = fn({ x: { lo: 1, hi: 2 } });
    expect(interval.kind).toBe('interval');
    if (interval.kind === 'interval') {
      // sinc is positive and decreasing on [1, 2]
      const sincAt1 = Math.sin(1) / 1;
      const sincAt2 = Math.sin(2) / 2;
      expect(interval.value.lo).toBeCloseTo(
        Math.min(sincAt1, sincAt2),
        10
      );
      expect(interval.value.hi).toBeCloseTo(
        Math.max(sincAt1, sincAt2),
        10
      );
    }
  });
});
