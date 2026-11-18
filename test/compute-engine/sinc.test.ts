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
    const expr = ce.expr(['Sinc', 0]);
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
    const expr = ce.expr(['Sinc', 'Pi']);
    const result = expr.N();
    // sin(pi)/pi should be very close to 0
    expect(Math.abs(result.re)).toBeLessThan(1e-10);
  });

  test('sinc(1) is approximately sin(1)', () => {
    const expr = ce.expr(['Sinc', 1]);
    const result = expr.N();
    // sinc(1) = sin(1)/1 = sin(1)
    expect(result.re).toBeCloseTo(Math.sin(1), 10);
  });

  test('sinc(2) is approximately sin(2)/2', () => {
    const expr = ce.expr(['Sinc', 2]);
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
    const expr = ce.expr(['Sinc', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toContain('_SYS.sinc');
  });

  test('compiled sinc(0) returns 1', () => {
    const expr = ce.expr(['Sinc', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    const fn = result.run!;
    expect(fn({ x: 0 })).toBe(1);
  });

  test('compiled sinc(1) returns sin(1)/1', () => {
    const expr = ce.expr(['Sinc', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    const fn = result.run!;
    expect(fn({ x: 1 })).toBeCloseTo(Math.sin(1), 10);
  });

  test('compiled sinc(pi) is approximately 0', () => {
    const expr = ce.expr(['Sinc', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    const fn = result.run!;
    expect(Math.abs(fn({ x: Math.PI }))).toBeLessThan(1e-10);
  });
});
