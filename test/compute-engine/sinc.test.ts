/**
 * Tests for the Sinc (cardinal sine) function
 *
 * sinc(x) = sin(x)/x with sinc(0) = 1 (unnormalized)
 */

import { ComputeEngine } from '../../src/compute-engine';
import { sinc } from '../../src/compute-engine/interval';

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

describe('SINC - the interval kernel encloses its turning points', () => {
  // CE-1436: the extrema were tabulated to 6 digits, so the end that an
  // extremum sets missed the true extremum by 3e-14 to 2e-13.
  const ce = new ComputeEngine();
  ce.precision = 40;
  const inside = (box: [number, number], value: string) => {
    const r = sinc({ lo: box[0], hi: box[1] }) as {
      value: { lo: number; hi: number };
    };
    const v = ce.parse(value).N();
    expect(v.isLess(r.value.lo)).toBe(false);
    expect(v.isGreater(r.value.hi)).toBe(false);
  };
  test('the minimum on [4, 5] and the maximum on [7, 8]', () => {
    inside([4, 5], '-0.2172336282112216574');
    inside([7, 8], '0.1283745535258991367');
    inside([-5, -4], '-0.2172336282112216574');
  });
  test('a box that ends just before a turning point', () => {
    // The minimum at 4.4934094579… is 8e-9 past the end of the box, where
    // sinc is above it by less than 1e-32: the widened end encloses both.
    inside([4.4934, 4.49340945], '-0.2172336282112216574');
    // One that ends within the margin of 1e-9 counts the extremum.
    inside([4.4934, 4.4934094575], '-0.2172336282112216574');
  });
  test('the point 0 still has the upper end 1', () => {
    const r = sinc({ lo: 0, hi: 0 }) as { value: { lo: number; hi: number } };
    expect(r.value.hi).toBe(1);
  });
});
