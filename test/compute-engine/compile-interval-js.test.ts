/**
 * Tests for interval JavaScript compilation target
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('INTERVAL JS COMPILATION - BASIC', () => {
  test('compiles constant', () => {
    const expr = ce.parse('5');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.isCompiled).toBe(true);
    expect(fn.toString()).toContain('_IA.point(5)');
  });

  test('compiles variable', () => {
    const expr = ce.parse('x');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_.x');
  });

  test('compiles Pi', () => {
    const expr = ce.parse('\\pi');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.point(Math.PI)');
  });
});

describe('INTERVAL JS COMPILATION - ARITHMETIC', () => {
  test('compiles addition', () => {
    const expr = ce.parse('x + y');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.add');
  });

  test('compiles subtraction', () => {
    const expr = ce.parse('x - y');
    const fn = expr.compile({ to: 'interval-js' });
    // Subtraction may compile to add(x, negate(y)) or sub(x, y)
    const code = fn.toString();
    expect(code.includes('_IA.sub') || code.includes('_IA.negate')).toBe(true);
  });

  test('compiles multiplication', () => {
    const expr = ce.parse('x \\cdot y');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.mul');
  });

  test('compiles division', () => {
    const expr = ce.parse('\\frac{x}{y}');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.div');
  });

  test('compiles negation', () => {
    const expr = ce.parse('-x');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.negate');
  });
});

describe('INTERVAL JS COMPILATION - FUNCTIONS', () => {
  test('compiles sin', () => {
    const expr = ce.parse('\\sin(x)');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.sin');
  });

  test('compiles cos', () => {
    const expr = ce.parse('\\cos(x)');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.cos');
  });

  test('compiles tan', () => {
    const expr = ce.parse('\\tan(x)');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.tan');
  });

  test('compiles sqrt', () => {
    const expr = ce.parse('\\sqrt{x}');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.sqrt');
  });

  test('compiles square', () => {
    const expr = ce.parse('x^2');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.square');
  });

  test('compiles power', () => {
    const expr = ce.parse('x^3');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.pow');
  });

  test('compiles exp', () => {
    // e^x is Power(ExponentialE, x) internally but should compile to exp
    const expr = ce.parse('e^x');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.exp');
  });

  test('compiles ln', () => {
    const expr = ce.parse('\\ln(x)');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.ln');
  });

  test('compiles abs', () => {
    const expr = ce.parse('|x|');
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.abs');
  });

  test('compiles if to piecewise', () => {
    const expr = ce.box(['If', ['Greater', 'x', 0], 'x', ['Negate', 'x']]);
    const fn = expr.compile({ to: 'interval-js' });
    expect(fn.toString()).toContain('_IA.piecewise');
  });
});

describe('INTERVAL JS EXECUTION', () => {
  test('evaluates constant', () => {
    const expr = ce.parse('5');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({});

    // Constants compile to point intervals (plain Interval, not IntervalResult)
    expect(result.lo).toBe(5);
    expect(result.hi).toBe(5);
  });

  test('evaluates point interval input', () => {
    const expr = ce.parse('x + 1');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 2, hi: 2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(3);
    expect(result.value.hi).toBe(3);
  });

  test('evaluates interval input', () => {
    const expr = ce.parse('x + 1');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 1, hi: 2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(2);
    expect(result.value.hi).toBe(3);
  });

  test('evaluates number input (converts to point)', () => {
    const expr = ce.parse('x + 1');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: 5 });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(6);
    expect(result.value.hi).toBe(6);
  });

  test('evaluates sin', () => {
    const expr = ce.parse('\\sin(x)');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 5);
    expect(result.value.hi).toBeCloseTo(Math.sin(0.1), 5);
  });

  test('sin over full period', () => {
    const expr = ce.parse('\\sin(x)');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 0, hi: 2 * Math.PI } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(-1);
    expect(result.value.hi).toBe(1);
  });

  test('sin with compound arguments', () => {
    const expr = ce.parse('\\sin(2x)');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 6);
    expect(result.value.hi).toBeCloseTo(Math.sin(0.2), 6);
  });

  test('sin with additive argument', () => {
    const expr = ce.parse('\\sin(x+x)');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 6);
    expect(result.value.hi).toBeCloseTo(Math.sin(0.2), 6);
  });

  test('sin with power argument', () => {
    const expr = ce.parse('\\sin(x^2)');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 6);
    expect(result.value.hi).toBeCloseTo(Math.sin(0.01), 6);
  });

  test('cos with compound arguments', () => {
    const expr = ce.parse('\\cos(2x)');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(Math.cos(0.2), 6);
    expect(result.value.hi).toBeCloseTo(1, 6);
  });

  test('ln with compound argument', () => {
    const expr = ce.parse('\\ln(2x)');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 1, hi: 2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(Math.log(2), 6);
    expect(result.value.hi).toBeCloseTo(Math.log(4), 6);
  });

  test('abs with additive argument', () => {
    const expr = ce.parse('|x+x|');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: -0.1, hi: 0.2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 6);
    expect(result.value.hi).toBeCloseTo(0.4, 6);
  });

  test('max with compound argument', () => {
    const expr = ce.parse('\\max(x, x+1)');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 0, hi: 0.2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(1, 6);
    expect(result.value.hi).toBeCloseTo(1.2, 6);
  });

  test('comparison with compound argument', () => {
    const expr = ce.box(['Less', 'x', ['Add', 'x', 2]]);
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 1, hi: 2 } });

    expect(result).toBe('true');
  });

  test('comparison with compound argument is indeterminate', () => {
    const expr = ce.box(['Less', 'x', ['Add', 'x', 1]]);
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 0, hi: 2 } });

    expect(result).toBe('maybe');
  });

  test('comparison with compound argument is false', () => {
    const expr = ce.box(['Greater', 'x', ['Add', 'x', 3]]);
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 0, hi: 2 } });

    expect(result).toBe('false');
  });

  test('piecewise with compound argument', () => {
    const expr = ce.box([
      'If',
      ['Greater', ['Add', 'x', 'x'], 0],
      ['Add', 'x', 1],
      ['Negate', ['Add', 'x', 1]],
    ]);
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 1, hi: 2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(2, 6);
    expect(result.value.hi).toBeCloseTo(3, 6);
  });

  test('piecewise union on indeterminate condition', () => {
    const expr = ce.box([
      'If',
      ['Greater', ['Add', 'x', 'x'], 0],
      ['Add', 'x', 1],
      ['Negate', ['Add', 'x', 1]],
    ]);
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: -1, hi: 1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(-2, 6);
    expect(result.value.hi).toBeCloseTo(2, 6);
  });

  test('multiplication widens interval', () => {
    const expr = ce.parse('x \\cdot y');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 1, hi: 2 }, y: { lo: 3, hi: 4 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(3);
    expect(result.value.hi).toBe(8);
  });
});

describe('INTERVAL JS SINGULARITY DETECTION', () => {
  test('division by zero interval is singular', () => {
    const expr = ce.parse('\\frac{1}{x}');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: -1, hi: 1 } });

    expect(result.kind).toBe('singular');
  });

  test('division by positive interval is safe', () => {
    const expr = ce.parse('\\frac{1}{x}');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 1, hi: 2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0.5, 5);
    expect(result.value.hi).toBeCloseTo(1, 5);
  });

  test('sqrt of negative interval is empty', () => {
    const expr = ce.parse('\\sqrt{x}');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: -2, hi: -1 } });

    expect(result.kind).toBe('empty');
  });

  test('sqrt of mixed interval is partial', () => {
    const expr = ce.parse('\\sqrt{x}');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: -1, hi: 4 } });

    expect(result.kind).toBe('partial');
    expect(result.value.lo).toBe(0);
    expect(result.value.hi).toBe(2);
    expect(result.domainClipped).toBe('lo');
  });

  test('tan near PI/2 is singular', () => {
    const expr = ce.parse('\\tan(x)');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 1.5, hi: 1.65 } });

    expect(result.kind).toBe('singular');
  });

  test('ln of non-positive is empty', () => {
    const expr = ce.parse('\\ln(x)');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: -2, hi: 0 } });

    expect(result.kind).toBe('empty');
  });

  test('ln crossing zero is partial', () => {
    const expr = ce.parse('\\ln(x)');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: -1, hi: Math.E } });

    expect(result.kind).toBe('partial');
    expect(result.value.lo).toBe(-Infinity);
    expect(result.value.hi).toBeCloseTo(1, 5);
    expect(result.domainClipped).toBe('lo');
  });
});

describe('INTERVAL JS COMPLEX EXPRESSIONS', () => {
  test('sin(x)/x - classic singularity example', () => {
    const expr = ce.parse('\\frac{\\sin(x)}{x}');
    const fn = expr.compile({ to: 'interval-js' });

    // At zero - singular
    const atZero = fn({ x: { lo: -0.1, hi: 0.1 } });
    expect(atZero.kind).toBe('singular');

    // Away from zero - valid
    const awayFromZero = fn({ x: { lo: 1, hi: 2 } });
    expect(awayFromZero.kind).toBe('interval');
  });

  test('x^2 + y^2 composition', () => {
    const expr = ce.parse('x^2 + y^2');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 1, hi: 2 }, y: { lo: 3, hi: 4 } });

    expect(result.kind).toBe('interval');
    // x^2 in [1,4], y^2 in [9,16], sum in [10,20]
    expect(result.value.lo).toBe(10);
    expect(result.value.hi).toBe(20);
  });

  test('exp(-x^2) Gaussian-like', () => {
    const expr = ce.parse('e^{-x^2}');
    const fn = expr.compile({ to: 'interval-js' });
    const result = fn({ x: { lo: 0, hi: 1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(Math.exp(-1), 5);
    expect(result.value.hi).toBeCloseTo(1, 5);
  });
});
