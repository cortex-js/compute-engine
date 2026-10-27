/**
 * A quotient `π·u / d` is the angle `u / d` in half-turns
 * (`BaseCompiler.piMultiple`), so `sin`, `cos` and `tan` of it compile to the
 * exactly reduced `sinpi`/`cospi`/`tanpi` forms on every target. Found in
 * Tycho's `exoplanet-transit` document (2026-10-26): `f(s) = {sin(2πs/P) > 0 :
 * 1, 0}` at `s = 2`, `P = −2` was 1 in the compiled JavaScript, where
 * `Math.sin(2π·2/−2)` is `2.4·10⁻¹⁶`, and 0 in the interpreter, where the sine
 * is exactly 0.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

function code(latex: string, to: 'javascript' | 'glsl' | 'wgsl'): string {
  const r = compile(ce.parse(latex), { to, fallback: false } as never);
  expect([to, r.success]).toEqual([to, true]);
  return r.code!;
}

describe('a quotient with a factor π in the numerator is a multiple of π', () => {
  it('compiles to the half-turn forms', () => {
    expect(code('\\sin\\left(\\frac{2\\pi s}{P}\\right)', 'javascript')).toBe(
      '_SYS.sinpi((2 * _.s) / _.P)'
    );
    expect(code('\\sin\\left(\\frac{2\\pi s}{P}\\right)', 'glsl')).toBe(
      '_gpu_sinpi((2.0 * s) / P)'
    );
    expect(code('\\cos\\left(\\frac{\\pi}{P}\\right)', 'wgsl')).toBe(
      '_gpu_cospi(1.0 / P)'
    );
  });

  it('applies to e^{iπu/d} and to the hyperbolic functions of iπu/d', () => {
    expect(code('e^{i\\pi x/y}', 'javascript')).toBe('_SYS.cexppi(_.x / _.y)');
    expect(code('\\sinh\\left(\\frac{i\\pi x}{y}\\right)', 'glsl')).toBe(
      '_gpu_ipi_sinh(x / y)'
    );
  });

  it('keeps the plain form when π is in the denominator', () => {
    expect(code('\\sin\\left(\\frac{s}{\\pi}\\right)', 'javascript')).toBe(
      'Math.sin(_.s / Math.PI)'
    );
  });

  it('is exactly zero at an integer number of half-turns', () => {
    const r = compile(ce.parse('\\sin\\left(\\frac{2\\pi s}{P}\\right)'), {
      to: 'javascript',
    } as never) as unknown as { run: (v: Record<string, number>) => number };
    expect(r.run({ s: 2, P: -2 }) === 0).toBe(true);
    expect(r.run({ s: 0.3, P: 1.7 })).toBeCloseTo(
      Math.sin((2 * Math.PI * 0.3) / 1.7),
      14
    );
  });

  it('a test on the sine agrees with the interpreter at a zero', () => {
    const e = new ComputeEngine();
    const expr = e.parse(
      '\\begin{cases}1 & \\sin\\left(\\frac{2\\pi s}{P}\\right) > 0\\\\ 0 & \\text{otherwise}\\end{cases}'
    );
    const r = compile(expr, { to: 'javascript' } as never) as unknown as {
      run: (v: Record<string, number>) => number;
    };
    expect(r.run({ s: 2, P: -2 })).toBe(0);
    expect(expr.subs({ s: 2, P: -2 }).evaluate().re).toBe(0);
  });
});
