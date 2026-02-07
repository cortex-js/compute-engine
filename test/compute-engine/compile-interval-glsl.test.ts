/**
 * Tests for interval GLSL compilation target
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { IntervalGLSLTarget } from '../../src/compute-engine/compilation/interval-glsl-target';

const ce = new ComputeEngine();

describe('INTERVAL GLSL COMPILATION - BASIC', () => {
  test('compiles constant', () => {
    const expr = ce.parse('5');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.isCompiled).toBe(true);
    expect(fn.toString()).toContain('ia_point(5.0)');
  });

  test('compiles variable', () => {
    const expr = ce.parse('x');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toBe('x');
  });

  test('compiles Pi', () => {
    const expr = ce.parse('\\pi');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toContain('ia_point(3.14159');
  });
});

describe('INTERVAL GLSL COMPILATION - ARITHMETIC', () => {
  test('compiles addition', () => {
    const expr = ce.parse('x + y');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toContain('ia_add');
  });

  test('compiles subtraction', () => {
    const expr = ce.parse('x - y');
    const fn = compile(expr, { to: 'interval-glsl' });
    // Subtraction may compile to ia_add(x, ia_negate(y)) or ia_sub(x, y)
    const code = fn.toString();
    expect(code.includes('ia_sub') || code.includes('ia_negate')).toBe(true);
  });

  test('compiles multiplication', () => {
    const expr = ce.parse('x \\cdot y');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toContain('ia_mul');
  });

  test('compiles division', () => {
    const expr = ce.parse('\\frac{x}{y}');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toContain('ia_div');
  });

  test('compiles negation', () => {
    const expr = ce.parse('-x');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toContain('ia_negate');
  });
});

describe('INTERVAL GLSL COMPILATION - FUNCTIONS', () => {
  test('compiles sin', () => {
    const expr = ce.parse('\\sin(x)');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toContain('ia_sin');
  });

  test('compiles sin with compound argument', () => {
    const expr = ce.parse('\\sin(2x)');
    const fn = compile(expr, { to: 'interval-glsl' });
    const code = fn.toString();
    expect(code).toContain('ia_sin');
    expect(code).toContain('ia_mul');
  });

  test('compiles cos', () => {
    const expr = ce.parse('\\cos(x)');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toContain('ia_cos');
  });

  test('compiles cos with compound argument', () => {
    const expr = ce.parse('\\cos(2x)');
    const fn = compile(expr, { to: 'interval-glsl' });
    const code = fn.toString();
    expect(code).toContain('ia_cos');
    expect(code).toContain('ia_mul');
  });

  test('compiles tan', () => {
    const expr = ce.parse('\\tan(x)');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toContain('ia_tan');
  });

  test('compiles sqrt', () => {
    const expr = ce.parse('\\sqrt{x}');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toContain('ia_sqrt');
  });

  test('compiles square', () => {
    const expr = ce.parse('x^2');
    const fn = compile(expr, { to: 'interval-glsl' });
    // Square may compile to ia_square or ia_pow with exponent 2
    const code = fn.toString();
    expect(code.includes('ia_square') || code.includes('ia_pow')).toBe(true);
  });

  test('compiles power', () => {
    const expr = ce.parse('x^3');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toContain('ia_pow');
  });

  test('compiles exp', () => {
    // e^x is Power(ExponentialE, x) internally but should compile to ia_exp
    const expr = ce.parse('e^x');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toContain('ia_exp');
  });

  test('compiles ln', () => {
    const expr = ce.parse('\\ln(x)');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toContain('ia_ln');
  });

  test('compiles ln with compound argument', () => {
    const expr = ce.parse('\\ln(2x)');
    const fn = compile(expr, { to: 'interval-glsl' });
    const code = fn.toString();
    expect(code).toContain('ia_ln');
    expect(code).toContain('ia_mul');
  });

  test('compiles abs', () => {
    const expr = ce.parse('|x|');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toContain('ia_abs');
  });

  test('compiles abs with additive argument', () => {
    const expr = ce.parse('|x+x|');
    const fn = compile(expr, { to: 'interval-glsl' });
    const code = fn.toString();
    expect(code).toContain('ia_abs');
    expect(code).toContain('ia_add');
  });
});

describe('INTERVAL GLSL LIBRARY', () => {
  test('getLibrary returns GLSL code', () => {
    const target = new IntervalGLSLTarget();
    const library = target.getLibrary();

    // Check for key components
    expect(library).toContain('struct IntervalResult');
    expect(library).toContain('ia_point');
    expect(library).toContain('ia_add');
    expect(library).toContain('ia_sub');
    expect(library).toContain('ia_mul');
    expect(library).toContain('ia_div');
    expect(library).toContain('ia_sin');
    expect(library).toContain('ia_cos');
    expect(library).toContain('ia_tan');
    expect(library).toContain('ia_sqrt');
    expect(library).toContain('ia_exp');
    expect(library).toContain('ia_ln');
  });

  test('library contains status constants', () => {
    const target = new IntervalGLSLTarget();
    const library = target.getLibrary();

    expect(library).toContain('IA_NORMAL');
    expect(library).toContain('IA_EMPTY');
    expect(library).toContain('IA_ENTIRE');
    expect(library).toContain('IA_SINGULAR');
    expect(library).toContain('IA_PARTIAL_LO');
    expect(library).toContain('IA_PARTIAL_HI');
  });

  test('library contains epsilon for conservative bounds', () => {
    const target = new IntervalGLSLTarget();
    const library = target.getLibrary();

    expect(library).toContain('IA_EPS');
  });
});

describe('INTERVAL GLSL FUNCTION COMPILATION', () => {
  test('compileFunction generates valid GLSL function', () => {
    const target = new IntervalGLSLTarget();
    const expr = ce.parse('x^2 + y');
    const glsl = target.compileFunction(expr, 'myFunc', ['x', 'y']);

    expect(glsl).toContain('IntervalResult myFunc(vec2 x, vec2 y)');
    expect(glsl).toContain('return');
    expect(glsl).toContain('ia_add');
    // Square may be ia_square or ia_pow
    expect(glsl.includes('ia_square') || glsl.includes('ia_pow')).toBe(true);
  });
});

describe('INTERVAL GLSL SHADER COMPILATION', () => {
  test('compileShaderFunction generates complete shader', () => {
    const target = new IntervalGLSLTarget();
    const expr = ce.parse('\\sin(x)');
    const shader = target.compileShaderFunction(expr);

    expect(shader).toContain('#version 300 es');
    expect(shader).toContain('precision highp float');
    expect(shader).toContain('struct IntervalResult');
    expect(shader).toContain('IntervalResult evaluateInterval(vec2 x)');
    expect(shader).toContain('ia_sin');
  });

  test('compileShaderFunction respects options', () => {
    const target = new IntervalGLSLTarget();
    const expr = ce.parse('x + y');
    const shader = target.compileShaderFunction(expr, {
      functionName: 'customEval',
      version: '330',
      parameters: ['x', 'y'],
    });

    expect(shader).toContain('#version 330');
    expect(shader).toContain('IntervalResult customEval(vec2 x, vec2 y)');
  });
});

describe('INTERVAL GLSL COMPLEX EXPRESSIONS', () => {
  test('compiles sin(x)/x', () => {
    const expr = ce.parse('\\frac{\\sin(x)}{x}');
    const fn = compile(expr, { to: 'interval-glsl' });
    const code = fn.toString();

    expect(code).toContain('ia_div');
    expect(code).toContain('ia_sin');
  });

  test('compiles x^2 + y^2', () => {
    const expr = ce.parse('x^2 + y^2');
    const fn = compile(expr, { to: 'interval-glsl' });
    const code = fn.toString();

    expect(code).toContain('ia_add');
    // Square may be ia_square or ia_pow
    expect(code.includes('ia_square') || code.includes('ia_pow')).toBe(true);
  });

  test('compiles nested expressions', () => {
    const expr = ce.parse('\\sin(\\cos(x))');
    const fn = compile(expr, { to: 'interval-glsl' });
    const code = fn.toString();

    expect(code).toContain('ia_sin');
    expect(code).toContain('ia_cos');
    // Should be nested: ia_sin(ia_cos(x))
    expect(code).toMatch(/ia_sin.*ia_cos/);
  });

  test('compiles exp(-x^2)', () => {
    const expr = ce.parse('e^{-x^2}');
    const fn = compile(expr, { to: 'interval-glsl' });
    const code = fn.toString();

    expect(code).toContain('ia_exp');
    expect(code).toContain('ia_negate');
    // Square may be ia_square or ia_pow
    expect(code.includes('ia_square') || code.includes('ia_pow')).toBe(true);
  });
});

describe('INTERVAL GLSL OUTPUT FORMAT', () => {
  test('float constants have decimal points', () => {
    const expr = ce.parse('5');
    const fn = compile(expr, { to: 'interval-glsl' });
    expect(fn.toString()).toContain('5.0');
  });

  test('compiles chained operations correctly', () => {
    const expr = ce.parse('a + b + c');
    const fn = compile(expr, { to: 'interval-glsl' });
    const code = fn.toString();

    // Should be nested: ia_add(ia_add(a, b), c)
    const addCount = (code.match(/ia_add/g) || []).length;
    expect(addCount).toBe(2);
  });
});
