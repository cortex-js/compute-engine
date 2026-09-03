/**
 * One kernel per logarithm base, on every path of a target.
 *
 * The interpreter folds `Log(2)` through `Math.log10`; the `javascript`
 * target spelled a RUNTIME `Log(x)` as `ln(x) / ln(10)`, one ulp away, so
 * `log(x) / log(2)` at `x = 4` ran to `1.9999999999999996` and a Desmos "power
 * of two" selector (`log(i)/log(2) mod 1 = 0`) kept only `i = 1` (Tycho item
 * 240). Base 10 and base 2 now take the dedicated kernel on both the real and
 * the complex lane, and on every target that has one; any other base keeps
 * the quotient of natural logarithms, which is also the interpreter's fold at
 * machine precision.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

function js(latex: string, vars: Record<string, number> = {}): { code: string; value: unknown } {
  const r = compile(ce.parse(latex), { to: 'javascript' });
  expect(r.success).toBe(true);
  return { code: r.code!, value: r.run!(vars) };
}

function code(latex: string, to: 'glsl' | 'wgsl' | 'python' | 'interval-js'): string {
  const r = compile(ce.parse(latex), { to });
  expect(r.success).toBe(true);
  return r.code!;
}

describe('javascript: the runtime spelling matches the fold', () => {
  test('base 10 on the real lane', () => {
    ce.declare('p', 'real<0..>');
    const { code, value } = js('\\log(p)', { p: 4 });
    expect(code).toBe('Math.log10(_.p)');
    expect(value).toBe(Math.log10(4));
  });

  test('base 10 on the complex lane agrees with the fold on the real axis', () => {
    const { code, value } = js('\\log(x)', { x: 4 });
    expect(code).toBe('_SYS.clog10(({ re: _.x, im: 0 }))');
    expect(value).toBe(Math.log10(4));
    expect(ce.parse('\\log(4)').N().re).toBe(Math.log10(4));
  });

  test('the ratio of a runtime and a folded base-10 log is exact at a power of two', () => {
    expect(js('\\frac{\\log(x)}{\\log(2)}', { x: 4 }).value).toBe(2);
    expect(js('\\frac{\\log(x)}{\\log(2)}\\bmod1', { x: 4 }).value).toBe(0);
    expect(js('\\frac{\\log(x)}{\\log(2)}', { x: 1024 }).value).toBe(10);
  });

  test('base 2 takes Math.log2 on both lanes', () => {
    expect(js('\\log_{2}(x)', { x: 8 })).toEqual({
      code: '_SYS.clog2(({ re: _.x, im: 0 }))',
      value: 3,
    });
    expect(js('\\log_{2}(p)', { p: 8 })).toEqual({ code: 'Math.log2(_.p)', value: 3 });
  });

  test('a negative real argument keeps its imaginary part', () => {
    const r = compile(ce.parse('\\log(x)'), { to: 'javascript' });
    expect(r.run!({ x: -100 })).toEqual({ re: 2, im: Math.PI / Math.LN10 });
  });

  test('another base keeps the quotient of natural logarithms', () => {
    expect(js('\\log_{3}(p)', { p: 9 }).code).toBe('(Math.log(_.p) / Math.log(3))');
    expect(js('\\log_{p}(8)', { p: 2 }).code).toBe('(Math.log(8) / Math.log(_.p))');
  });
});

describe('the interpreter machine lane uses the same kernels', () => {
  test('Log(x, 2) and Log(x, 10) agree with Math.log2 / Math.log10 at every sample', () => {
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    for (let x = 1.001; x < 1000; x *= 1.0137) {
      expect(machine.box(['Log', x, 2]).N().re).toBe(Math.log2(x));
      expect(machine.box(['Log', x, 10]).N().re).toBe(Math.log10(x));
    }
    expect(machine.box(['Log', 0, 2]).N().re).toBe(-Infinity);
  });
});

describe('the other targets', () => {
  test('shaders take the log2 builtin for base 2', () => {
    expect(code('\\log_{2}(x)', 'glsl')).toBe('log2(x)');
    expect(code('\\log_{2}(x)', 'wgsl')).toBe('log2(x)');
    expect(code('\\log(x)', 'glsl')).toBe('(log(x) / log(10.0))');
  });

  test('python takes the dedicated numpy kernel', () => {
    expect(code('\\log_{2}(p)', 'python')).toBe('np.log2(p)');
    expect(code('\\log(p)', 'python')).toBe('np.log10(p)');
    expect(code('\\log_{3}(p)', 'python')).toBe('(np.log(p) / np.log(3))');
  });

  test('the interval target takes the dedicated enclosure', () => {
    expect(code('\\log_{2}(p)', 'interval-js')).toContain('_IA.log2(');
    expect(code('\\log(p)', 'interval-js')).toContain('_IA.log10(');
    expect(code('\\log_{3}(p)', 'interval-js')).toContain('_IA.div(_IA.ln(');
  });
});
