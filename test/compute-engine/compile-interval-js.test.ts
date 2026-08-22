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
    const expr = ce.expr(['If', ['Greater', 'x', 0], 'x', ['Negate', 'x']]);
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
    const expr = ce.expr(['GammaLn', 'x']);
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
    const expr = ce.expr(['Less', 'x', ['Add', 'x', 2]]);
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 } });

    expect(result).toBe('true');
  });

  test('comparison with compound argument is indeterminate', () => {
    const expr = ce.expr(['Less', 'x', ['Add', 'x', 1]]);
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 2 } });

    expect(result).toBe('maybe');
  });

  test('comparison with compound argument is false', () => {
    const expr = ce.expr(['Greater', 'x', ['Add', 'x', 3]]);
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 2 } });

    expect(result).toBe('false');
  });

  // Regression: N-ary chained relations and N-ary And/Or must compile ALL
  // operands, not just the first two. A binary-only emission silently drops
  // the tail comparison — unsound for mask exclusion / inclusion.
  test('chained 1 < x < 4 is false for a wholly-outside box', () => {
    const fn = compile(ce.parse('1<x<4'), { to: 'interval-js' });
    // [5, 6] is entirely outside 1 < x < 4.
    expect(fn.run!({ x: { lo: 5, hi: 6 } })).toBe('false');
  });

  test('chained 1 < x < 4 is true for a wholly-inside box', () => {
    const fn = compile(ce.parse('1<x<4'), { to: 'interval-js' });
    expect(fn.run!({ x: { lo: 2, hi: 3 } })).toBe('true');
  });

  test('chained 1 < x < 4 is maybe for a straddling box', () => {
    const fn = compile(ce.parse('1<x<4'), { to: 'interval-js' });
    expect(fn.run!({ x: { lo: 0, hi: 2 } })).toBe('maybe');
  });

  test('3-operand Or admits a box via its third branch only', () => {
    const fn = compile(ce.parse('x<-2\\lor x>2\\lor y>0'), {
      to: 'interval-js',
    });
    // First two branches are false for x∈[0,1]; only y>0 (third) admits it.
    // A binary-only fold would drop y>0 and wrongly report 'false'.
    expect(fn.run!({ x: { lo: 0, hi: 1 }, y: { lo: 5, hi: 6 } })).toBe('true');
  });

  test('3-operand And is false when its third operand excludes the box', () => {
    const fn = compile(ce.parse('x>-2\\land x<2\\land y>0'), {
      to: 'interval-js',
    });
    // First two conjuncts hold for x∈[0,1]; y<0 (third) excludes the box.
    // A binary-only fold would drop y>0 and wrongly report 'true'.
    expect(fn.run!({ x: { lo: 0, hi: 1 }, y: { lo: -6, hi: -5 } })).toBe(
      'false'
    );
  });

  test('piecewise with compound argument', () => {
    const expr = ce.expr([
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
    const expr = ce.expr([
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
    const expr = ce.expr(['If', ['GreaterEqual', 'x', 0], 1, 0]);
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
    const expr = ce.expr(['GammaLn', 'x']);
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
    const expr = ce.expr(['Power', -1, 'k']);
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
    const expr = ce.expr(['Power', -2, 'k']);
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
    const expr = ce.expr(['Power', -1, 'k']);
    const fn = compile(expr, { to: 'interval-js' });

    // Exponent spans both even and odd → [-1, 1]
    const r = fn.run!({ k: { lo: 0, hi: 3 } });
    expect(r.kind).toBe('interval');
    expect(r.value.lo).toBe(-1);
    expect(r.value.hi).toBe(1);
  });

  test('Factorial compiles and executes', () => {
    const expr = ce.expr(['Factorial', 'n']);
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
    const expr = ce.expr(['Sum', ['Power', -1, 'k'], ['Limits', 'k', 0, 5]]);
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
    const expr = ce.expr([
      'Sum',
      [
        'Divide',
        [
          'Multiply',
          ['Power', -1, 'k'],
          ['Power', 'x', ['Add', ['Multiply', 2, 'k'], 1]],
        ],
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

  // REVIEW.md E5: a compound symbolic bound (e.g. `n + 2`) compiles to an
  // `_IA.*` call that returns an IntervalResult wrapper ({kind, value}), not a
  // bare {lo, hi}. The loop bound read `.hi` off the wrapper → undefined →
  // Math.floor(undefined) = NaN → the loop never ran, silently returning the
  // identity (0 for Sum, 1 for Product) instead of the real value.
  test('Sum with a compound symbolic upper bound (n + 2)', () => {
    // Sum(k, k=1..n+2) with n=3 → 1+2+3+4+5 = 15
    const expr = ce.expr(['Sum', 'k', ['Limits', 'k', 1, ['Add', 'n', 2]]]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    const result = fn.run!({ n: { lo: 3, hi: 3 } });
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(15);
    expect(result.value.hi).toBe(15);
  });

  test('Sum with a simple symbolic upper bound (n) still works', () => {
    // Sum(k, k=1..n) with n=5 → 15 (the bare-interval `.hi` path)
    const expr = ce.expr(['Sum', 'k', ['Limits', 'k', 1, 'n']]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    const result = fn.run!({ n: { lo: 5, hi: 5 } });
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(15);
    expect(result.value.hi).toBe(15);
  });

  test('Product with a compound symbolic upper bound (n + 1)', () => {
    // Product(k, k=1..n+1) with n=3 → 1·2·3·4 = 24
    const expr = ce.expr(['Product', 'k', ['Limits', 'k', 1, ['Add', 'n', 1]]]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    const result = fn.run!({ n: { lo: 3, hi: 3 } });
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(24);
    expect(result.value.hi).toBe(24);
  });

  test('a collection-valued Sum body fails closed (D6)', () => {
    // `Σ h(i)·(1/1.4^i)·a(…)` where `a` returns a vector — the interpreter's
    // elementwise zip-broadcast Sum. Interval scalar accumulation over arrays
    // would silently produce a wrong value, so compilation must fail closed
    // (mirrors the JS/base/python/gpu gate).
    const e = new ComputeEngine();
    e.parse('a(t)\\coloneq[\\cos t,\\sin t]').evaluate();
    e.parse(
      'h(i)\\coloneq\\operatorname{mod}(10^{4}\\sin(10^{4}i),1)'
    ).evaluate();
    const expr = e.parse(
      '\\sum_{i=0}^{6}h(i)\\frac{1}{1.4^{i}}a(1.9^{i}t+h(i))'
    );
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(false);
    expect(fn.error).toMatch(/collection-valued body.*Fail closed/s);
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
    const expr = ce.expr(['Binomial', 5, 2]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(10, 10);
    expect(val.hi).toBeCloseTo(10, 10);
  });

  test('GCD(12, 8) = 4', () => {
    const expr = ce.expr(['GCD', 12, 8]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(4, 10);
    expect(val.hi).toBeCloseTo(4, 10);
  });

  test('LCM(12, 8) = 24', () => {
    const expr = ce.expr(['LCM', 12, 8]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(24, 10);
    expect(val.hi).toBeCloseTo(24, 10);
  });

  test('Chop(5) = 5', () => {
    const expr = ce.expr(['Chop', 5]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(5, 10);
    expect(val.hi).toBeCloseTo(5, 10);
  });

  test('Chop bakes the engine tolerance, matching the interpreter', () => {
    // `Chop` is a comparison-tolerance operator: the compiled form must honor
    // the engine's configured `ce.tolerance` (baked at compile time, like
    // compiled `Equal`), not the static default — `Chop(1e-7)` at
    // `tolerance = 1e-6` is `0` interpreted, and used to compile to `1e-7`.
    const loose = new ComputeEngine();
    loose.tolerance = 1e-6;
    const expr = loose.expr(['Chop', 1e-7]);
    expect(expr.evaluate().isSame(0)).toBe(true);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBe(0);
    expect(val.hi).toBe(0);
    // …and a value above the tolerance passes through unchanged.
    const above = compile(loose.expr(['Chop', 1e-5]), { to: 'interval-js' });
    const aval = unwrapInterval(above.run!());
    expect(aval.lo).toBeCloseTo(1e-5, 12);
    expect(aval.hi).toBeCloseTo(1e-5, 12);
  });

  test('Erf(1) ≈ 0.8427', () => {
    const expr = ce.expr(['Erf', 1]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(0.8427, 3);
    expect(val.hi).toBeCloseTo(0.8427, 3);
  });

  test('Erfc(0) ≈ 1', () => {
    const expr = ce.expr(['Erfc', 0]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(1, 3);
    expect(val.hi).toBeCloseTo(1, 3);
  });

  test('Exp2(3) = 8', () => {
    const expr = ce.expr(['Exp2', 3]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(8, 10);
    expect(val.hi).toBeCloseTo(8, 10);
  });

  test('Arctan2(1, 1) ≈ π/4', () => {
    const expr = ce.expr(['Arctan2', 1, 1]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(Math.PI / 4, 10);
    expect(val.hi).toBeCloseTo(Math.PI / 4, 10);
  });

  test('Hypot(3, 4) = 5', () => {
    const expr = ce.expr(['Hypot', 3, 4]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(5, 10);
    expect(val.hi).toBeCloseTo(5, 10);
  });
});

// WP-2.17: the compiled interval runtime must agree with the interpreter's real
// conventions for Arccot (continuous (0, π)), odd roots / rational powers of
// negative bases, and Mod (floored) on a negative divisor multiple.
describe('INTERVAL JS - WP-2.17 INTERPRETER ALIGNMENT', () => {
  test('Arccot of a negative point uses the (0, π) branch', () => {
    const fn = compile(ce.box(['Arccot', 'x']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    // Arccot(-2) ≈ 2.678 (NOT the atan(1/x) value −0.4636).
    const r = unwrapInterval(fn.run!({ x: { lo: -2, hi: -2 } }));
    expect(r.lo).toBeCloseTo(2.677945044588987, 9);
    expect(r.hi).toBeCloseTo(2.677945044588987, 9);
  });

  test('Arccot is continuous through zero (Arccot(0) = π/2, not singular)', () => {
    const fn = compile(ce.box(['Arccot', 'x']), { to: 'interval-js' });
    const r0 = fn.run!({ x: { lo: 0, hi: 0 } });
    expect(r0.kind).toBe('interval');
    expect(r0.value.lo).toBeCloseTo(Math.PI / 2, 9);
    // An interval straddling 0 is a valid decreasing interval, not singular.
    const r = unwrapInterval(fn.run!({ x: { lo: -1, hi: 1 } }));
    expect(r.lo).toBeCloseTo(Math.PI / 4, 9);
    expect(r.hi).toBeCloseTo((3 * Math.PI) / 4, 9);
  });

  test('odd Root of a negative base is real (Root(-8, 3) = -2)', () => {
    const fn = compile(ce.box(['Root', 'x', 3]), { to: 'interval-js' });
    expect(fn.code).toContain('_IA.nthRoot');
    const r = unwrapInterval(fn.run!({ x: { lo: -8, hi: -8 } }));
    expect(r.lo).toBeCloseTo(-2, 9);
    expect(r.hi).toBeCloseTo(-2, 9);
    // Interval straddling zero: monotone increasing.
    const r2 = unwrapInterval(fn.run!({ x: { lo: -8, hi: 27 } }));
    expect(r2.lo).toBeCloseTo(-2, 9);
    expect(r2.hi).toBeCloseTo(3, 9);
  });

  test('even Root of a negative base has no real value (empty)', () => {
    const fn = compile(ce.box(['Root', 'x', 4]), { to: 'interval-js' });
    const r = fn.run!({ x: { lo: -16, hi: -1 } });
    expect(r.kind).toBe('empty');
  });

  test('rational Power with odd denominator over a negative base', () => {
    const f23 = compile(ce.box(['Power', 'x', ['Rational', 2, 3]]), {
      to: 'interval-js',
    });
    expect(f23.code).toContain('_IA.powRational');
    // (-8)^(2/3) = 4
    const r = unwrapInterval(f23.run!({ x: { lo: -8, hi: -8 } }));
    expect(r.lo).toBeCloseTo(4, 9);
    expect(r.hi).toBeCloseTo(4, 9);

    const f35 = compile(ce.box(['Power', 'x', ['Rational', 3, 5]]), {
      to: 'interval-js',
    });
    // (-32)^(3/5) = -8
    const r2 = unwrapInterval(f35.run!({ x: { lo: -32, hi: -32 } }));
    expect(r2.lo).toBeCloseTo(-8, 9);
    expect(r2.hi).toBeCloseTo(-8, 9);
  });

  test('Mod is floored: Mod(-1, 3) = 2, Mod(5, -3) = -1', () => {
    const fn = compile(ce.box(['Mod', 'x', 'y']), { to: 'interval-js' });
    const r1 = unwrapInterval(
      fn.run!({ x: { lo: -1, hi: -1 }, y: { lo: 3, hi: 3 } })
    );
    expect(r1.lo).toBe(2);
    expect(r1.hi).toBe(2);
    const r2 = unwrapInterval(
      fn.run!({ x: { lo: 5, hi: 5 }, y: { lo: -3, hi: -3 } })
    );
    expect(r2.lo).toBe(-1);
    expect(r2.hi).toBe(-1);
    // Point on a multiple of a negative divisor is 0 (well-defined), not singular.
    const r3 = unwrapInterval(
      fn.run!({ x: { lo: 6, hi: 6 }, y: { lo: -3, hi: -3 } })
    );
    expect(r3.lo).toBe(0);
    expect(r3.hi).toBe(0);
  });

  test('Round rounds half away from zero (Round(-2.5) = -3)', () => {
    const fn = compile(ce.box(['Round', 'x']), { to: 'interval-js' });
    const rNeg = unwrapInterval(fn.run!({ x: { lo: -2.5, hi: -2.5 } }));
    expect(rNeg.lo).toBe(-3);
    expect(rNeg.hi).toBe(-3);
    const rPos = unwrapInterval(fn.run!({ x: { lo: 2.5, hi: 2.5 } }));
    expect(rPos.lo).toBe(3);
    expect(rPos.hi).toBe(3);
  });
});

// GammaRegularized/BetaRegularized have no interval kernel (`_IA` has no
// gammaQ/betaRegularized equivalent). Compiling must fail closed — report
// `success: false` with the offending head listed as unsupported — rather
// than silently emit wrong (point-only) code.
describe('INTERVAL JS - fails closed on regularized gamma/beta (no kernel)', () => {
  test('GammaRegularized is reported unsupported', () => {
    const fn = compile(ce.box(['GammaRegularized', 3, 'x']), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(false);
    expect(fn.unsupported).toContain('GammaRegularized');
  });

  test('BetaRegularized is reported unsupported', () => {
    const fn = compile(ce.box(['BetaRegularized', 'x', 2, 3]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(false);
    expect(fn.unsupported).toContain('BetaRegularized');
  });
});

// The interval domain is scalar — one interval per quantity — so there is no
// element-wise selection convention for a collection-valued `Which`/`If`
// condition. Decline with a message that says so (D6), instead of the generic
// ``Unknown operator `List` `` the clause list used to produce.
describe('INTERVAL JS - element-wise selection declines cleanly', () => {
  const ceSel = new ComputeEngine();
  ceSel.declare('BL', 'list<boolean>');

  test('Which with a literal boolean-list condition declines', () => {
    const fn = compile(
      ceSel.box(['Which', ['List', 'True', 'False'], 1, 'True', 0]),
      {
        to: 'interval-js',
      }
    );
    expect(fn.success).toBe(false);
    expect(fn.error).toContain('no interval-js lowering');
  });

  test('Which with a `list<boolean>` declared condition declines', () => {
    const fn = compile(ceSel.box(['Which', 'BL', 1, 'True', 0]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(false);
    expect(fn.error).toContain('no interval-js lowering');
  });

  test('If with a collection condition declines', () => {
    const fn = compile(ceSel.box(['If', 'BL', 1, 0]), { to: 'interval-js' });
    expect(fn.success).toBe(false);
    expect(fn.error).toContain('no interval-js lowering');
  });

  test('When with a collection condition declines', () => {
    const fn = compile(ceSel.box(['When', 1, ['List', 'True', 'False']]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(false);
    expect(fn.error).toContain('branch condition is a collection-valued');
  });

  test('a scalar Which is unchanged', () => {
    const fn = compile(ceSel.box(['Which', ['Less', 'x', 3], 1, 'True', 0]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain('_IA.piecewise');
    expect(fn.code).toContain('_IA.less(_.x, _IA.point(3))');
  });

  test('a wide-declared (unprovable) condition still compiles', () => {
    // Only PROVABLE collection-ness declines: a condition whose collection-ness
    // is not statically visible must keep compiling (scalar curve/implicit
    // plotting rides this target).
    const ceWide = new ComputeEngine();
    ceWide.declare('u', 'unknown');
    const fn = compile(ceWide.box(['Which', ['Less', 'u', 3], 1, 'True', 0]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain('_IA.piecewise');
  });
});

// Collection OPERANDS on the interval target (`At`, `Length`,
// `PointX`/`PointY`/`PointZ`). A collection is never the target's RESULT — its
// `run` contract is a single interval — but it is a legal operand of these
// accessors, where it is a JavaScript array of intervals at run time.
describe('INTERVAL JS - collection access', () => {
  const ceColl = new ComputeEngine();
  ceColl.declare('L', 'list<number>');
  ceColl.declare('P', 'tuple<number, number>');

  /** The interval-js absence marker: a whole-NaN BARE interval (no `kind`). */
  function expectAbsent(result) {
    expect('kind' in result).toBe(false);
    expect(Number.isNaN(result.lo)).toBe(true);
  }

  test('At with a point index selects the element (1-based)', () => {
    const fn = compile(ceColl.box(['At', 'L', 2]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain('_IA.at(_.L,');
    // A plain numeric array input: each element is read as a point interval.
    expect(fn.run!({ L: [10, 20, 30] })).toEqual({
      kind: 'interval',
      value: { lo: 20, hi: 20 },
    });
  });

  test('At over an array of intervals', () => {
    const fn = compile(ceColl.box(['At', 'L', 2]), { to: 'interval-js' });
    expect(fn.run!({ L: [{ lo: 0, hi: 1 }, { lo: 2, hi: 5 }, 30] })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 5 },
    });
  });

  test('At with a WIDE index hulls the elements it spans', () => {
    const fn = compile(ceColl.box(['At', 'L', 'k']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({ L: [10, 20, 30], k: { lo: 1, hi: 2 } })).toEqual({
      kind: 'interval',
      value: { lo: 10, hi: 20 },
    });
    // Partly out of range: the value exists over only part of the index band.
    expect(fn.run!({ L: [10, 20, 30], k: { lo: 2, hi: 9 } })).toEqual({
      kind: 'partial',
      value: { lo: 20, hi: 30 },
      domainClipped: 'both',
    });
  });

  test('At out of range yields the absence marker', () => {
    const fn = compile(ceColl.box(['At', 'L', 9]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expectAbsent(fn.run!({ L: [10, 20, 30] }));
  });

  test('At with a negative index counts from the end', () => {
    const fn = compile(ceColl.box(['At', 'L', -1]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({ L: [10, 20, 30] })).toEqual({
      kind: 'interval',
      value: { lo: 30, hi: 30 },
    });
  });

  test('At over a literal list with a literal index folds statically', () => {
    const fn = compile(ceColl.box(['At', ['List', 10, 20, 30], 2]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('_IA.point(20)');
    expect(fn.run!({})).toEqual({ lo: 20, hi: 20 });
  });

  test('a literal-list index out of range folds to the absence marker', () => {
    const fn = compile(ceColl.box(['At', ['List', 10, 20, 30], 7]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expectAbsent(fn.run!({}));
  });

  test('At over a literal list with a symbolic index emits the array', () => {
    const fn = compile(ceColl.box(['At', ['List', 10, 20, 30], 'k']), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain('[_IA.point(10), _IA.point(20), _IA.point(30)]');
    expect(fn.run!({ k: 3 })).toEqual({
      kind: 'interval',
      value: { lo: 30, hi: 30 },
    });
  });

  test('Length of a declared list', () => {
    const fn = compile(ceColl.box(['Length', 'L']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('_IA.length(_.L)');
    expect(fn.run!({ L: [10, 20, 30] })).toEqual({
      kind: 'interval',
      value: { lo: 3, hi: 3 },
    });
  });

  test('Length of a literal list folds statically', () => {
    const fn = compile(ceColl.box(['Length', ['List', 10, 20, 30]]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('_IA.point(3)');
  });

  test('PointX/PointY of a declared tuple', () => {
    const fx = compile(ceColl.box(['PointX', 'P']), { to: 'interval-js' });
    const fy = compile(ceColl.box(['PointY', 'P']), { to: 'interval-js' });
    expect(fx.success).toBe(true);
    expect(fx.code).toBe('_IA.component(_.P, 0)');
    expect(fx.run!({ P: [1, 2] })).toEqual({
      kind: 'interval',
      value: { lo: 1, hi: 1 },
    });
    expect(fy.run!({ P: [1, 2] })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
    // An interval-valued coordinate keeps its band.
    expect(fx.run!({ P: [{ lo: 0, hi: 1 }, 2] })).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 1 },
    });
  });

  test('PointX of a literal Tuple folds statically', () => {
    const fn = compile(ceColl.box(['PointX', ['Tuple', 3, 4]]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('_IA.point(3)');
  });

  test('an absence marker composes through interval arithmetic', () => {
    const fn = compile(ceColl.box(['Add', ['At', 'L', 'k'], 1]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    // In range: ordinary arithmetic.
    expect(fn.run!({ L: [10, 20, 30], k: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 21, hi: 21 },
    });
    // Out of range: the absence marker propagates as NaN bounds rather than
    // inventing a value.
    const absent = fn.run!({ L: [10, 20, 30], k: 9 }) as {
      value: { lo: number };
    };
    expect(Number.isNaN(absent.value.lo)).toBe(true);
  });
});

describe('INTERVAL JS - collections decline where the value model has no room', () => {
  const ceNo = new ComputeEngine();
  ceNo.declare('L', 'list<number>');
  ceNo.declare('PL', 'list<tuple<number, number>>');
  ceNo.declare('S', 'string');

  test('a bare List/Tuple root declines', () => {
    // A collection is never this target's RESULT. That is enforced
    // structurally: there is no `List`/`Tuple` lowering in the function table,
    // because the array spelling exists only in the operand position of an
    // accessor that immediately projects it back to one interval (see
    // `compileIntervalCollectionOperand`). A bare constructor at the root
    // therefore declines as an unlowered head.
    for (const root of [
      ceNo.box(['List', 1, 2, 3]),
      ceNo.box(['Tuple', 1, 2]),
    ]) {
      const fn = compile(root, { to: 'interval-js' });
      expect(fn.success).toBe(false);
    }
  });

  test('PointX over a LIST of points declines', () => {
    const fn = compile(ceNo.box(['Length', ['PointX', 'PL']]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(false);
    expect(fn.error).toContain('not a single point');
  });

  test('Length of a string declines (no text model)', () => {
    const fn = compile(ceNo.box(['Length', 'S']), { to: 'interval-js' });
    expect(fn.success).toBe(false);
    expect(fn.error).toContain('domain is numeric');
  });

  test('a collection-valued INDEX (gather) declines', () => {
    const fn = compile(ceNo.box(['Length', ['At', 'L', ['List', 1, 2]]]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(false);
    expect(fn.error).toContain('collection-valued index');
  });
});

describe('INTERVAL JS - ACCESSORS OVER AN ASSIGNED LITERAL', () => {
  // A symbol whose assigned value is a literal collection is looked through
  // by the accessors (`assignedLiteral` in the target): the element, count or
  // coordinate folds at compile time, where the generic symbol fold would
  // compile the `List`/`Tuple` value and decline.
  const ceA = new ComputeEngine();
  ceA.assign('La', ceA.box(['List', 10, 20, 30]));
  ceA.assign('Pa', ceA.box(['Tuple', 1, 2]));

  test('At over an assigned list folds to the element', () => {
    const fn = compile(ceA.box(['At', 'La', 2]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('_IA.point(20)');
    expect(fn.run!({})).toEqual({ lo: 20, hi: 20 });
  });

  test('At over an assigned list with a run-time index emits the array', () => {
    const fn = compile(ceA.box(['At', 'La', 'n']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe(
      '_IA.at([_IA.point(10), _IA.point(20), _IA.point(30)], _.n)'
    );
    const r = fn.run!({ n: { lo: 2, hi: 3 } }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(r.kind).toBe('interval');
    expect(r.value).toEqual({ lo: 20, hi: 30 });
  });

  test('Length of an assigned list folds to the count', () => {
    const fn = compile(ceA.box(['Length', 'La']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('_IA.point(3)');
  });

  test('PointY of an assigned point folds to the coordinate', () => {
    const fn = compile(ceA.box(['PointY', 'Pa']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('_IA.point(2)');
  });

  test('a symbol pinned by `vars` is a run-time input, never looked through', () => {
    const fn = compile(ceA.box(['At', 'La', 2]), {
      to: 'interval-js',
      vars: { La: '_.La' },
    });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('_IA.at(_.La, _IA.point(2))');
    expect(fn.run!({ La: [7, 8, 9] })).toEqual({
      kind: 'interval',
      value: { lo: 8, hi: 8 },
    });
  });
});

describe('INTERVAL JS - At/Length OVER A TUPLE BASE', () => {
  const ceT = new ComputeEngine();
  ceT.declare('Pt', 'tuple<number, number>');
  ceT.declare('Mixed', 'tuple<number, string>');

  test('At over a declared tuple reads the component', () => {
    const fn = compile(ceT.box(['At', 'Pt', 2]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({ Pt: [1, 2] })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
  });

  test('Length of a declared tuple is its arity', () => {
    const fn = compile(ceT.box(['Length', 'Pt']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({ Pt: [1, 2] })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
  });

  test('At over a tuple with a non-numeric component declines', () => {
    const fn = compile(ceT.box(['At', 'Mixed', 1]), { to: 'interval-js' });
    expect(fn.success).toBe(false);
    expect(fn.error).toContain('not a number');
  });
});

describe('INTERVAL JS - COLLECTIONS: kernels fail closed, roots and fallbacks are arrays', () => {
  // One interval per quantity: a scalar kernel handed a collection operand
  // declines with a reason (it used to answer NaN bounds or `'maybe'` behind
  // `success: true`); a collection-valued RESULT is an array of interval
  // values (`IntervalValue`), on the compiled path and on the interpreter
  // fallback alike.
  const ceC = new ComputeEngine();
  ceC.declare('Lc', 'list<number>');

  test('Add over a list operand declines', () => {
    const fn = compile(ceC.box(['Add', 'Lc', 1]), { to: 'interval-js' });
    expect(fn.success).toBe(false);
    expect(fn.error).toContain('is a collection');
  });

  test('Sin over a list operand declines', () => {
    const fn = compile(ceC.box(['Sin', 'Lc']), { to: 'interval-js' });
    expect(fn.success).toBe(false);
    expect(fn.error).toContain('is a collection');
  });

  test('an If with a collection-valued arm declines', () => {
    const fn = compile(ceC.box(['If', ['Less', 'x', 0], 'Lc', 1]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(false);
    expect(fn.error).toContain('is a collection');
  });

  test('an accessor over the same list still compiles (the gate is per kernel)', () => {
    const fn = compile(ceC.box(['Add', ['At', 'Lc', 1], 1]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.run!({ Lc: [5, 6] })).toEqual({
      kind: 'interval',
      value: { lo: 6, hi: 6 },
    });
  });

  test('the interpreter fallback maps a collection result to an array of point intervals', () => {
    // `Reverse` has no interval lowering; with `fallback: true` the interpreter
    // evaluates it and its list is handed back element by element, not
    // collapsed to `entire`.
    const fn = compile(ceC.box(['Reverse', ['List', 1, 2, 3]]), {
      to: 'interval-js',
      fallback: true,
    });
    expect(fn.success).toBe(false);
    expect(fn.run!({})).toEqual([
      { lo: 3, hi: 3 },
      { lo: 2, hi: 2 },
      { lo: 1, hi: 1 },
    ]);
  });
});
