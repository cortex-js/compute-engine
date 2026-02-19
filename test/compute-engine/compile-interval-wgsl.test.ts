/**
 * Tests for interval WGSL compilation target
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { IntervalWGSLTarget } from '../../src/compute-engine/compilation/interval-wgsl-target';

const ce = new ComputeEngine();

describe('INTERVAL WGSL COMPILATION - BASIC', () => {
  test('compiles constant', () => {
    const expr = ce.parse('5');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain('ia_point(5.0)');
  });

  test('compiles variable', () => {
    const expr = ce.parse('x');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toBe('x');
  });

  test('compiles Pi', () => {
    const expr = ce.parse('\\pi');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toContain('ia_point(3.14159');
  });
});

describe('INTERVAL WGSL COMPILATION - ARITHMETIC', () => {
  test('compiles addition', () => {
    const expr = ce.parse('x + y');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toContain('ia_add');
  });

  test('compiles subtraction', () => {
    const expr = ce.parse('x - y');
    const fn = compile(expr, { to: 'interval-wgsl' });
    const code = fn.code;
    expect(code.includes('ia_sub') || code.includes('ia_negate')).toBe(true);
  });

  test('compiles multiplication', () => {
    const expr = ce.parse('x \\cdot y');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toContain('ia_mul');
  });

  test('compiles division', () => {
    const expr = ce.parse('\\frac{x}{y}');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toContain('ia_div');
  });

  test('compiles negation', () => {
    const expr = ce.parse('-x');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toContain('ia_negate');
  });
});

describe('INTERVAL WGSL COMPILATION - FUNCTIONS', () => {
  test('compiles sin', () => {
    const expr = ce.parse('\\sin(x)');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toContain('ia_sin');
  });

  test('compiles sin with compound argument', () => {
    const expr = ce.parse('\\sin(2x)');
    const fn = compile(expr, { to: 'interval-wgsl' });
    const code = fn.code;
    expect(code).toContain('ia_sin');
    expect(code).toContain('ia_mul');
  });

  test('compiles cos', () => {
    const expr = ce.parse('\\cos(x)');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toContain('ia_cos');
  });

  test('compiles tan', () => {
    const expr = ce.parse('\\tan(x)');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toContain('ia_tan');
  });

  test('compiles sqrt', () => {
    const expr = ce.parse('\\sqrt{x}');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toContain('ia_sqrt');
  });

  test('compiles square', () => {
    const expr = ce.parse('x^2');
    const fn = compile(expr, { to: 'interval-wgsl' });
    const code = fn.code;
    expect(code.includes('ia_square') || code.includes('ia_pow')).toBe(true);
  });

  test('compiles power', () => {
    const expr = ce.parse('x^3');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toContain('ia_pow');
  });

  test('compiles exp', () => {
    const expr = ce.parse('e^x');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toContain('ia_exp');
  });

  test('compiles ln', () => {
    const expr = ce.parse('\\ln(x)');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toContain('ia_ln');
  });

  test('compiles abs', () => {
    const expr = ce.parse('|x|');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toContain('ia_abs');
  });
});

describe('INTERVAL WGSL LIBRARY', () => {
  test('getLibrary returns WGSL code', () => {
    const target = new IntervalWGSLTarget();
    const library = target.getLibrary();

    // Check for WGSL-specific syntax
    expect(library).toContain('struct IntervalResult {');
    expect(library).toContain('vec2f');
    expect(library).toContain('f32');
    expect(library).toContain('fn ');

    // Check for key functions
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

  test('library uses _v suffix for vec2f implementations', () => {
    const target = new IntervalWGSLTarget();
    const library = target.getLibrary();

    expect(library).toContain('ia_add_v');
    expect(library).toContain('ia_sub_v');
    expect(library).toContain('ia_mul_v');
    expect(library).toContain('ia_div_v');
    expect(library).toContain('ia_sin_v');
  });

  test('library contains status constants', () => {
    const target = new IntervalWGSLTarget();
    const library = target.getLibrary();

    expect(library).toContain('IA_NORMAL');
    expect(library).toContain('IA_EMPTY');
    expect(library).toContain('IA_ENTIRE');
    expect(library).toContain('IA_SINGULAR');
    expect(library).toContain('IA_PARTIAL_LO');
    expect(library).toContain('IA_PARTIAL_HI');
  });

  test('library does not contain GLSL-specific syntax', () => {
    const target = new IntervalWGSLTarget();
    const library = target.getLibrary();

    // Should not have bare vec2( (GLSL), should use vec2f(
    expect(library).not.toMatch(/\bvec2\(/);
    // Should not have GLSL-style "const float"
    expect(library).not.toContain('const float');
  });
});

describe('INTERVAL WGSL FUNCTION COMPILATION', () => {
  test('compileFunction generates valid WGSL function', () => {
    const target = new IntervalWGSLTarget();
    const expr = ce.parse('x^2 + y');
    const wgsl = target.compileFunction(expr, 'myFunc', ['x', 'y']);

    expect(wgsl).toContain('fn myFunc(x: vec2f, y: vec2f) -> IntervalResult');
    expect(wgsl).toContain('return');
    expect(wgsl).toContain('ia_add');
    expect(wgsl.includes('ia_square') || wgsl.includes('ia_pow')).toBe(true);
  });
});

describe('INTERVAL WGSL SHADER COMPILATION', () => {
  test('compileShaderFunction generates complete shader', () => {
    const target = new IntervalWGSLTarget();
    const expr = ce.parse('\\sin(x)');
    const shader = target.compileShaderFunction(expr);

    // WGSL does not use #version or precision directives
    expect(shader).not.toContain('#version');
    expect(shader).not.toContain('precision');
    expect(shader).toContain('struct IntervalResult');
    expect(shader).toContain('fn evaluateInterval(x: vec2f) -> IntervalResult');
    expect(shader).toContain('ia_sin');
  });

  test('compileShaderFunction respects options', () => {
    const target = new IntervalWGSLTarget();
    const expr = ce.parse('x + y');
    const shader = target.compileShaderFunction(expr, {
      functionName: 'customEval',
      parameters: ['x', 'y'],
    });

    expect(shader).toContain(
      'fn customEval(x: vec2f, y: vec2f) -> IntervalResult'
    );
  });
});

describe('INTERVAL WGSL COMPLEX EXPRESSIONS', () => {
  test('compiles sin(x)/x', () => {
    const expr = ce.parse('\\frac{\\sin(x)}{x}');
    const fn = compile(expr, { to: 'interval-wgsl' });
    const code = fn.code;

    expect(code).toContain('ia_div');
    expect(code).toContain('ia_sin');
  });

  test('compiles x^2 + y^2', () => {
    const expr = ce.parse('x^2 + y^2');
    const fn = compile(expr, { to: 'interval-wgsl' });
    const code = fn.code;

    expect(code).toContain('ia_add');
    expect(code.includes('ia_square') || code.includes('ia_pow')).toBe(true);
  });

  test('compiles nested expressions', () => {
    const expr = ce.parse('\\sin(\\cos(x))');
    const fn = compile(expr, { to: 'interval-wgsl' });
    const code = fn.code;

    expect(code).toContain('ia_sin');
    expect(code).toContain('ia_cos');
    expect(code).toMatch(/ia_sin.*ia_cos/);
  });

  test('compiles exp(-x^2)', () => {
    const expr = ce.parse('e^{-x^2}');
    const fn = compile(expr, { to: 'interval-wgsl' });
    const code = fn.code;

    expect(code).toContain('ia_exp');
    expect(code).toContain('ia_negate');
    expect(code.includes('ia_square') || code.includes('ia_pow')).toBe(true);
  });
});

describe('INTERVAL WGSL SELECTIVE PREAMBLE', () => {
  test('simple expression has smaller preamble than full library', () => {
    const target = new IntervalWGSLTarget();
    const fullLibrary = target.getLibrary();
    const expr = ce.parse('x^2 + y^2');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.success).toBe(true);
    // Selective preamble should be much smaller than full library
    expect(fn.preamble!.length).toBeLessThan(fullLibrary.length * 0.6);
  });

  test('preamble includes only functions used by the expression', () => {
    const expr = ce.parse('\\sin(x)');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.success).toBe(true);
    expect(fn.preamble).toContain('ia_sin');
    // Should NOT contain gamma, factorial, etc.
    expect(fn.preamble).not.toContain('ia_gamma');
    expect(fn.preamble).not.toContain('ia_factorial');
    expect(fn.preamble).not.toContain('ia_floor');
  });

  test('preamble includes transitive dependencies', () => {
    const expr = ce.parse('\\operatorname{Gamma}(x)');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.success).toBe(true);
    // gamma depends on _gpu_gamma
    expect(fn.preamble).toContain('ia_gamma');
    expect(fn.preamble).toContain('_gpu_gamma');
  });

  test('comparison functions include IA_TRUE/FALSE/MAYBE constants', () => {
    const expr = ce.parse(
      '\\begin{cases} x & x > 0 \\\\ -x & \\text{otherwise} \\end{cases}'
    );
    const fn = compile(expr, { to: 'interval-wgsl' });
    if (fn.success && fn.preamble!.includes('ia_greater')) {
      expect(fn.preamble).toContain('IA_TRUE');
      expect(fn.preamble).toContain('IA_FALSE');
      expect(fn.preamble).toContain('IA_MAYBE');
    }
  });

  test('preamble always includes core infrastructure', () => {
    const expr = ce.parse('x');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.success).toBe(true);
    expect(fn.preamble).toContain('struct IntervalResult');
    expect(fn.preamble).toContain('IA_NORMAL');
    expect(fn.preamble).toContain('IA_EPS');
  });

  test('compileShaderFunction uses selective preamble', () => {
    const target = new IntervalWGSLTarget();
    const fullLibrary = target.getLibrary();
    const expr = ce.parse('\\sin(x)');
    const shader = target.compileShaderFunction(expr);
    // Shader should be smaller than full library + function
    expect(shader.length).toBeLessThan(fullLibrary.length);
    expect(shader).toContain('ia_sin');
    expect(shader).toContain('fn evaluateInterval');
  });
});

describe('INTERVAL WGSL OUTPUT FORMAT', () => {
  test('float constants have decimal points', () => {
    const expr = ce.parse('5');
    const fn = compile(expr, { to: 'interval-wgsl' });
    expect(fn.code).toContain('5.0');
  });

  test('compiles chained operations correctly', () => {
    const expr = ce.parse('a + b + c');
    const fn = compile(expr, { to: 'interval-wgsl' });
    const code = fn.code;

    const addCount = (code.match(/ia_add/g) || []).length;
    expect(addCount).toBe(2);
  });
});
