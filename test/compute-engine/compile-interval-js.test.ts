/**
 * Tests for interval JavaScript compilation target
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

describe('INTERVAL JS COMPILATION - BASIC', () => {
  test('compiles constant', () => {
    const expr = ce.parse('5');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain('_IA.point(5)');
  });

  test('compiles variable', () => {
    const expr = ce.parse('x');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_.x');
  });

  test('compiles Pi', () => {
    const expr = ce.parse('\\pi');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.point(Math.PI)');
  });
});

describe('INTERVAL JS COMPILATION - ARITHMETIC', () => {
  test('compiles addition', () => {
    const expr = ce.parse('x + y');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.add');
  });

  test('compiles subtraction', () => {
    const expr = ce.parse('x - y');
    const fn = compile(expr, { to: 'interval-js' });
    // Subtraction may compile to add(x, negate(y)) or sub(x, y)
    const code = fn.code;
    expect(code.includes('_IA.sub') || code.includes('_IA.negate')).toBe(true);
  });

  test('compiles multiplication', () => {
    const expr = ce.parse('x \\cdot y');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.mul');
  });

  test('compiles division', () => {
    const expr = ce.parse('\\frac{x}{y}');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.div');
  });

  test('compiles negation', () => {
    const expr = ce.parse('-x');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.negate');
  });
});

describe('INTERVAL JS COMPILATION - FUNCTIONS', () => {
  test('compiles sin', () => {
    const expr = ce.parse('\\sin(x)');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.sin');
  });

  test('compiles cos', () => {
    const expr = ce.parse('\\cos(x)');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.cos');
  });

  test('compiles tan', () => {
    const expr = ce.parse('\\tan(x)');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.tan');
  });

  test('compiles sqrt', () => {
    const expr = ce.parse('\\sqrt{x}');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.sqrt');
  });

  test('compiles square', () => {
    const expr = ce.parse('x^2');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.square');
  });

  test('compiles power', () => {
    const expr = ce.parse('x^3');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.pow');
  });

  test('compiles exp', () => {
    // e^x is Power(ExponentialE, x) internally but should compile to exp
    const expr = ce.parse('e^x');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.exp');
  });

  test('compiles ln', () => {
    const expr = ce.parse('\\ln(x)');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.ln');
  });

  test('compiles abs', () => {
    const expr = ce.parse('|x|');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.abs');
  });

  test('compiles if to piecewise', () => {
    const expr = ce.box(['If', ['Greater', 'x', 0], 'x', ['Negate', 'x']]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.piecewise');
  });

  test('compiles Gamma', () => {
    const expr = ce.parse('\\Gamma(x)');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain('_IA.gamma');
  });

  test('compiles GammaLn', () => {
    const expr = ce.box(['GammaLn', 'x']);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain('_IA.gammaln');
  });
});

describe('INTERVAL JS EXECUTION', () => {
  test('evaluates constant', () => {
    const expr = ce.parse('5');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({});

    // Constants compile to point intervals (plain Interval, not IntervalResult)
    expect(result.lo).toBe(5);
    expect(result.hi).toBe(5);
  });

  test('evaluates point interval input', () => {
    const expr = ce.parse('x + 1');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 2, hi: 2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(3);
    expect(result.value.hi).toBe(3);
  });

  test('evaluates interval input', () => {
    const expr = ce.parse('x + 1');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(2);
    expect(result.value.hi).toBe(3);
  });

  test('evaluates number input (converts to point)', () => {
    const expr = ce.parse('x + 1');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: 5 });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(6);
    expect(result.value.hi).toBe(6);
  });

  test('evaluates sin', () => {
    const expr = ce.parse('\\sin(x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 5);
    expect(result.value.hi).toBeCloseTo(Math.sin(0.1), 5);
  });

  test('sin over full period', () => {
    const expr = ce.parse('\\sin(x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 2 * Math.PI } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(-1);
    expect(result.value.hi).toBe(1);
  });

  test('sin with compound arguments', () => {
    const expr = ce.parse('\\sin(2x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 6);
    expect(result.value.hi).toBeCloseTo(Math.sin(0.2), 6);
  });

  test('sin with additive argument', () => {
    const expr = ce.parse('\\sin(x+x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 6);
    expect(result.value.hi).toBeCloseTo(Math.sin(0.2), 6);
  });

  test('sin with power argument', () => {
    const expr = ce.parse('\\sin(x^2)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 6);
    expect(result.value.hi).toBeCloseTo(Math.sin(0.01), 6);
  });

  test('cos with compound arguments', () => {
    const expr = ce.parse('\\cos(2x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(Math.cos(0.2), 6);
    expect(result.value.hi).toBeCloseTo(1, 6);
  });

  test('ln with compound argument', () => {
    const expr = ce.parse('\\ln(2x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(Math.log(2), 6);
    expect(result.value.hi).toBeCloseTo(Math.log(4), 6);
  });

  test('abs with additive argument', () => {
    const expr = ce.parse('|x+x|');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: -0.1, hi: 0.2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 6);
    expect(result.value.hi).toBeCloseTo(0.4, 6);
  });

  test('max with compound argument', () => {
    const expr = ce.parse('\\max(x, x+1)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 0.2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(1, 6);
    expect(result.value.hi).toBeCloseTo(1.2, 6);
  });

  test('comparison with compound argument', () => {
    const expr = ce.box(['Less', 'x', ['Add', 'x', 2]]);
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 } });

    expect(result).toBe('true');
  });

  test('comparison with compound argument is indeterminate', () => {
    const expr = ce.box(['Less', 'x', ['Add', 'x', 1]]);
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 2 } });

    expect(result).toBe('maybe');
  });

  test('comparison with compound argument is false', () => {
    const expr = ce.box(['Greater', 'x', ['Add', 'x', 3]]);
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 2 } });

    expect(result).toBe('false');
  });

  test('piecewise with compound argument', () => {
    const expr = ce.box([
      'If',
      ['Greater', ['Add', 'x', 'x'], 0],
      ['Add', 'x', 1],
      ['Negate', ['Add', 'x', 1]],
    ]);
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 } });

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
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: -1, hi: 1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(-2, 6);
    expect(result.value.hi).toBeCloseTo(2, 6);
  });

  test('piecewise with constant branches (Heaviside)', () => {
    const expr = ce.box(['If', ['GreaterEqual', 'x', 0], 1, 0]);
    const fn = compile(expr, { to: 'interval-js' });

    // x definitely >= 0 → 1
    const r1 = fn.run!({ x: { lo: 2, hi: 3 } });
    expect(r1.kind).toBe('interval');
    expect(r1.value.lo).toBeCloseTo(1, 10);
    expect(r1.value.hi).toBeCloseTo(1, 10);

    // x definitely < 0 → 0
    const r2 = fn.run!({ x: { lo: -3, hi: -1 } });
    expect(r2.kind).toBe('interval');
    expect(r2.value.lo).toBeCloseTo(0, 10);
    expect(r2.value.hi).toBeCloseTo(0, 10);

    // x spans 0 → union [0, 1]
    const r3 = fn.run!({ x: { lo: -1, hi: 1 } });
    expect(r3.kind).toBe('interval');
    expect(r3.value.lo).toBeCloseTo(0, 10);
    expect(r3.value.hi).toBeCloseTo(1, 10);

    // x exactly 0 → 1 (>= includes 0)
    const r4 = fn.run!({ x: { lo: 0, hi: 0 } });
    expect(r4.kind).toBe('interval');
    expect(r4.value.lo).toBeCloseTo(1, 10);
    expect(r4.value.hi).toBeCloseTo(1, 10);
  });

  test('piecewise from text{if} LaTeX', () => {
    const expr = ce.parse('\\text{if} x \\geq 0 \\text{then} 1 \\text{else} 0');
    expect(expr.operator).toBe('If');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    const result = fn.run!({ x: { lo: 2, hi: 3 } });
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(1, 10);
  });

  test('multiplication widens interval', () => {
    const expr = ce.parse('x \\cdot y');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 }, y: { lo: 3, hi: 4 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(3);
    expect(result.value.hi).toBe(8);
  });
});

describe('INTERVAL JS SINGULARITY DETECTION', () => {
  test('division by zero interval is singular', () => {
    const expr = ce.parse('\\frac{1}{x}');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: -1, hi: 1 } });

    expect(result.kind).toBe('singular');
  });

  test('division by positive interval is safe', () => {
    const expr = ce.parse('\\frac{1}{x}');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0.5, 5);
    expect(result.value.hi).toBeCloseTo(1, 5);
  });

  test('sqrt of negative interval is empty', () => {
    const expr = ce.parse('\\sqrt{x}');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: -2, hi: -1 } });

    expect(result.kind).toBe('empty');
  });

  test('sqrt of mixed interval is partial', () => {
    const expr = ce.parse('\\sqrt{x}');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: -1, hi: 4 } });

    expect(result.kind).toBe('partial');
    expect(result.value.lo).toBe(0);
    expect(result.value.hi).toBe(2);
    expect(result.domainClipped).toBe('lo');
  });

  test('tan near PI/2 is singular', () => {
    const expr = ce.parse('\\tan(x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1.5, hi: 1.65 } });

    expect(result.kind).toBe('singular');
  });

  test('ln of non-positive is empty', () => {
    const expr = ce.parse('\\ln(x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: -2, hi: 0 } });

    expect(result.kind).toBe('empty');
  });

  test('ln crossing zero is partial', () => {
    const expr = ce.parse('\\ln(x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: -1, hi: Math.E } });

    expect(result.kind).toBe('partial');
    expect(result.value.lo).toBe(-Infinity);
    expect(result.value.hi).toBeCloseTo(1, 5);
    expect(result.domainClipped).toBe('lo');
  });
});

describe('INTERVAL JS COMPLEX EXPRESSIONS', () => {
  test('sin(x)/x - classic singularity example', () => {
    const expr = ce.parse('\\frac{\\sin(x)}{x}');
    const fn = compile(expr, { to: 'interval-js' });

    // At zero - singular
    const atZero = fn.run!({ x: { lo: -0.1, hi: 0.1 } });
    expect(atZero.kind).toBe('singular');

    // Away from zero - valid
    const awayFromZero = fn.run!({ x: { lo: 1, hi: 2 } });
    expect(awayFromZero.kind).toBe('interval');
  });

  test('x^2 + y^2 composition', () => {
    const expr = ce.parse('x^2 + y^2');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 }, y: { lo: 3, hi: 4 } });

    expect(result.kind).toBe('interval');
    // x^2 in [1,4], y^2 in [9,16], sum in [10,20]
    expect(result.value.lo).toBe(10);
    expect(result.value.hi).toBe(20);
  });

  test('exp(-x^2) Gaussian-like', () => {
    const expr = ce.parse('e^{-x^2}');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(Math.exp(-1), 5);
    expect(result.value.hi).toBeCloseTo(1, 5);
  });

  test('Gamma function positive values', () => {
    const expr = ce.parse('\\Gamma(x)');
    const fn = compile(expr, { to: 'interval-js' });

    // Gamma(2.5) ≈ 1.329
    const result = fn.run!({ x: { lo: 2.5, hi: 2.5 } });
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(1.329, 2);
    expect(result.value.hi).toBeCloseTo(1.329, 2);
  });

  test('Gamma function detects singularity at zero', () => {
    const expr = ce.parse('\\Gamma(x)');
    const fn = compile(expr, { to: 'interval-js' });

    // Interval crossing zero should detect the pole
    const result = fn.run!({ x: { lo: -0.5, hi: 0.5 } });
    expect(result.kind).toBe('singular');
  });

  test('GammaLn function', () => {
    const expr = ce.box(['GammaLn', 'x']);
    const fn = compile(expr, { to: 'interval-js' });

    // GammaLn(2.5) ≈ ln(1.329) ≈ 0.284
    const result = fn.run!({ x: { lo: 2.5, hi: 2.5 } });
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0.284, 2);
    expect(result.value.hi).toBeCloseTo(0.284, 2);
  });
});

describe('INTERVAL JS - NEGATIVE BASE POWER', () => {
  test('(-1)^k with point integer exponent', () => {
    // (-1)^k where k is a variable — powInterval path
    const expr = ce.box(['Power', -1, 'k']);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    // Even exponent → 1
    const r0 = fn.run!({ k: { lo: 0, hi: 0 } });
    expect(r0.kind).toBe('interval');
    expect(r0.value.lo).toBe(1);
    expect(r0.value.hi).toBe(1);

    // Odd exponent → -1
    const r1 = fn.run!({ k: { lo: 1, hi: 1 } });
    expect(r1.kind).toBe('interval');
    expect(r1.value.lo).toBe(-1);
    expect(r1.value.hi).toBe(-1);

    // Even exponent → 1
    const r4 = fn.run!({ k: { lo: 4, hi: 4 } });
    expect(r4.kind).toBe('interval');
    expect(r4.value.lo).toBe(1);
    expect(r4.value.hi).toBe(1);
  });

  test('(-2)^k with point integer exponent', () => {
    const expr = ce.box(['Power', -2, 'k']);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    // (-2)^3 = -8
    const r3 = fn.run!({ k: { lo: 3, hi: 3 } });
    expect(r3.kind).toBe('interval');
    expect(r3.value.lo).toBe(-8);
    expect(r3.value.hi).toBe(-8);

    // (-2)^2 = 4
    const r2 = fn.run!({ k: { lo: 2, hi: 2 } });
    expect(r2.kind).toBe('interval');
    expect(r2.value.lo).toBe(4);
    expect(r2.value.hi).toBe(4);
  });

  test('(-1)^k with interval exponent spanning integers', () => {
    const expr = ce.box(['Power', -1, 'k']);
    const fn = compile(expr, { to: 'interval-js' });

    // Exponent spans both even and odd → [-1, 1]
    const r = fn.run!({ k: { lo: 0, hi: 3 } });
    expect(r.kind).toBe('interval');
    expect(r.value.lo).toBe(-1);
    expect(r.value.hi).toBe(1);
  });

  test('Factorial compiles and executes', () => {
    const expr = ce.box(['Factorial', 'n']);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    // 5! = 120
    const r5 = fn.run!({ n: { lo: 5, hi: 5 } });
    expect(r5.kind).toBe('interval');
    expect(r5.value.lo).toBe(120);
    expect(r5.value.hi).toBe(120);

    // 0! = 1
    const r0 = fn.run!({ n: { lo: 0, hi: 0 } });
    expect(r0.kind).toBe('interval');
    expect(r0.value.lo).toBe(1);
    expect(r0.value.hi).toBe(1);
  });

  test('alternating sign summation: sum of (-1)^k', () => {
    // Sum((-1)^k, k=0..5) = 1-1+1-1+1-1 = 0
    const expr = ce.box([
      'Sum',
      ['Power', -1, 'k'],
      ['Limits', 'k', 0, 5],
    ]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    const result = fn.run!({});
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(0);
    expect(result.value.hi).toBe(0);
  });

  test('Taylor-like: sum of (-1)^k * x^(2k+1) / (2k+1)!', () => {
    // First 4 terms of arctan(x) Taylor series: x - x^3/3! + x^5/5! - x^7/7!
    // But with factorial denominators approximating arctan
    const expr = ce.box([
      'Sum',
      [
        'Divide',
        ['Multiply', ['Power', -1, 'k'], ['Power', 'x', ['Add', ['Multiply', 2, 'k'], 1]]],
        ['Factorial', ['Add', ['Multiply', 2, 'k'], 1]],
      ],
      ['Limits', 'k', 0, 3],
    ]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    // Evaluate at x = 0.5 (point interval)
    const result = fn.run!({ x: { lo: 0.5, hi: 0.5 } });
    expect(result.kind).toBe('interval');
    // Should be a finite number (not empty/singular)
    expect(Number.isFinite(result.value.lo)).toBe(true);
    expect(Number.isFinite(result.value.hi)).toBe(true);
  });
});

/**
 * Helper to extract numeric interval from result
 */
function unwrapInterval(val: unknown): { lo: number; hi: number } {
  if (val && typeof val === 'object') {
    if ('kind' in val && (val as any).kind === 'interval')
      return (val as any).value;
    if ('lo' in val && 'hi' in val) return val as { lo: number; hi: number };
  }
  throw new Error(`Expected interval result, got: ${JSON.stringify(val)}`);
}

describe('INTERVAL JS - ADDITIONAL FUNCTIONS', () => {
  test('Binomial(5, 2) = 10', () => {
    const expr = ce.box(['Binomial', 5, 2]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(10, 10);
    expect(val.hi).toBeCloseTo(10, 10);
  });

  test('GCD(12, 8) = 4', () => {
    const expr = ce.box(['GCD', 12, 8]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(4, 10);
    expect(val.hi).toBeCloseTo(4, 10);
  });

  test('LCM(12, 8) = 24', () => {
    const expr = ce.box(['LCM', 12, 8]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(24, 10);
    expect(val.hi).toBeCloseTo(24, 10);
  });

  test('Chop(5) = 5', () => {
    const expr = ce.box(['Chop', 5]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(5, 10);
    expect(val.hi).toBeCloseTo(5, 10);
  });

  test('Erf(1) ≈ 0.8427', () => {
    const expr = ce.box(['Erf', 1]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(0.8427, 3);
    expect(val.hi).toBeCloseTo(0.8427, 3);
  });

  test('Erfc(0) ≈ 1', () => {
    const expr = ce.box(['Erfc', 0]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(1, 3);
    expect(val.hi).toBeCloseTo(1, 3);
  });

  test('Exp2(3) = 8', () => {
    const expr = ce.box(['Exp2', 3]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(8, 10);
    expect(val.hi).toBeCloseTo(8, 10);
  });

  test('Arctan2(1, 1) ≈ π/4', () => {
    const expr = ce.box(['Arctan2', 1, 1]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(Math.PI / 4, 10);
    expect(val.hi).toBeCloseTo(Math.PI / 4, 10);
  });

  test('Hypot(3, 4) = 5', () => {
    const expr = ce.box(['Hypot', 3, 4]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(5, 10);
    expect(val.hi).toBeCloseTo(5, 10);
  });
});
