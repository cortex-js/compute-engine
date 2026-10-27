/**
 * `Smoothstep(e0, e1, x)`: t²(3 − 2t) with t = Clamp((x − e0)/(e1 − e0), 0,
 * 1), the formula of the GLSL and WGSL built-in. The library definition is
 * in `library/arithmetic.ts`. With `e0 = e1` the built-in is undefined; the
 * interpreter and the `javascript` and `python` targets give the step
 * function there (0 when `x < e0`, else 1).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { shaderFunctions } from './gpu-shader-f32-eval';

const ce = new ComputeEngine();

const evaluate = (latex: string): string =>
  ce.parse(latex).evaluate().toString();
const N = (latex: string): string => ce.parse(latex).N().toString();

describe('Smoothstep evaluates', () => {
  it('gives exact values for exact operands', () => {
    expect(evaluate('\\operatorname{Smoothstep}(0, 1, -1)')).toBe('0');
    expect(evaluate('\\operatorname{Smoothstep}(0, 1, \\frac12)')).toBe('1/2');
    expect(evaluate('\\operatorname{Smoothstep}(0, 1, \\frac13)')).toBe('7/27');
    expect(evaluate('\\operatorname{Smoothstep}(0, 1, 2)')).toBe('1');
    // t = 1/π stays exact.
    expect(evaluate('\\operatorname{Smoothstep}(0, \\pi, 1)')).toBe(
      '(3 - 2 / pi) / pi^2'
    );
  });

  it('gives a float under N', () => {
    expect(N('\\operatorname{Smoothstep}(0, 1, \\frac13)')).toBe(
      '0.259259259259259259259'
    );
    expect(N('\\operatorname{Smoothstep}(0, 1, 0.25)')).toBe('0.15625');
  });

  it('is the step function when the edges are equal', () => {
    expect(evaluate('\\operatorname{Smoothstep}(1, 1, 0.5)')).toBe('0');
    expect(evaluate('\\operatorname{Smoothstep}(1, 1, 1)')).toBe('1');
    expect(evaluate('\\operatorname{Smoothstep}(1, 1, 2)')).toBe('1');
  });

  it('falls from 1 to 0 when the edges are reversed', () => {
    // t = (1/2 − 2)/(0 − 2) = 3/4.
    expect(evaluate('\\operatorname{Smoothstep}(2, 0, \\frac12)')).toBe(
      '27/32'
    );
  });

  it('propagates NaN, clamps infinity, and stays symbolic on a free symbol', () => {
    expect(ce.box(['Smoothstep', 0, 1, 'NaN']).evaluate().isNaN).toBe(true);
    expect(evaluate('\\operatorname{Smoothstep}(0, 1, \\infty)')).toBe('1');
    expect(evaluate('\\operatorname{Smoothstep}(0, 1, y)')).toBe(
      'Smoothstep(0, 1, y)'
    );
  });

  it('broadcasts over a list', () => {
    expect(evaluate('\\operatorname{Smoothstep}(0, 1, [0.25, 0.5])')).toBe(
      '[0.15625,0.5]'
    );
  });
});

describe('Smoothstep compiles', () => {
  const samples = [-0.5, 0, 0.1, 1 / 3, 0.5, 0.9, 1, 1.5];

  it('on the javascript target, with the values of the interpreter', () => {
    const expr = ce.parse('\\operatorname{Smoothstep}(a, b, x)');
    const f = compile(expr, { to: 'javascript', fallback: false } as never);
    expect(f.success).toBe(true);
    for (const [a, b] of [
      [0, 1],
      [1, 0],
      [0.5, 0.5],
    ])
      for (const x of samples) {
        const expected = ce.box(['Smoothstep', a, b, x]).N().re as number;
        expect(f.run!({ a, b, x }) as number).toBeCloseTo(expected, 12);
      }
    expect(Number.isNaN(f.run!({ a: 0, b: 1, x: NaN }) as number)).toBe(true);
  });

  it('on the python target, through a helper', () => {
    const r = compile(ce.parse('\\operatorname{Smoothstep}(0, 1, x)'), {
      to: 'python',
      fallback: false,
    } as never);
    expect(r.success).toBe(true);
    expect(r.code).toContain('def _ce_smoothstep(');
    expect(r.code).toMatch(/_ce_smoothstep\(0, 1, /);
  });

  it('on the shader targets, to the NaN-safe built-in', () => {
    for (const to of ['glsl', 'wgsl'] as const) {
      const r = compile(ce.parse('\\operatorname{Smoothstep}(0, 1, x)'), {
        to,
        fallback: false,
      } as never);
      expect(r.success).toBe(true);
      expect(r.code).toContain('_gpu_smoothstep(');
    }
  });
});

describe('Smoothstep at its edge cases', () => {
  const N = (e: unknown): number => ce.box(e as never).N().re as number;

  it('compares float edges exactly, as the compiled targets do', () => {
    const f = compile(ce.parse('\\operatorname{Smoothstep}(a, b, x)'), {
      to: 'javascript',
      fallback: false,
    } as never);
    for (const [a, b, x] of [
      [0, 1e-12, 5e-13],
      [0.5, 0.5, 0.5 - 1e-12],
      [0.5, 0.5 + 1e-13, 0.5],
    ])
      expect(f.run!({ a, b, x }) as number).toBeCloseTo(
        N(['Smoothstep', a, b, x]),
        12
      );
    expect(N(['Smoothstep', 0, 1e-12, 5e-13])).toBe(0.5);
  });

  it('has no value when an infinite edge gives ∞/∞', () => {
    for (const e of [
      ['Smoothstep', 'NegativeInfinity', 'PositiveInfinity', 0],
      ['Smoothstep', 'NegativeInfinity', 1, 0],
    ]) {
      const b = ce.box(e as never);
      expect(b.evaluate().isNaN).toBe(true);
      // The type says so: a NaN-safe shader guard is not removed for it.
      expect(b.type.toString()).toBe('nan | real');
    }
    expect(ce.box(['Smoothstep', 0, 1, 0.5]).type.toString()).toBe('real');
  });

  it('broadcasts positionally on the python target', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('L', 'list<real>');
    const r = compile(ce2.box(['Smoothstep', 0, 1, 'L']), {
      to: 'python',
      fallback: false,
    } as never);
    expect(r.success).toBe(true);
    expect(r.code).toContain("_ce_bcast('smoothstep', 0, 1, L)");
    expect(r.code).toContain('def _ce_smoothstep(');
  });

  it('gives the interpreter value on the shader targets for e0 >= e1', () => {
    // The built-in `smoothstep` has no defined result there; the helper
    // writes the formula out.
    for (const language of ['glsl', 'wgsl'] as const) {
      const ce3 = new ComputeEngine();
      ce3.declare('a', 'number');
      ce3.declare('b', 'number');
      ce3.declare('x', 'number');
      const r = compile(ce3.box(['Smoothstep', 'a', 'b', 'x']), {
        to: language,
        fallback: false,
      } as never);
      const main =
        language === 'glsl'
          ? `float _main(float a, float b, float x) { return ${r.code}; }`
          : `fn _main(a: f32, b: f32, x: f32) -> f32 { return ${r.code}; }`;
      const run = shaderFunctions(`${r.preamble ?? ''}\n${main}`, language);
      for (const [a, b, x] of [
        [1, 1, 0.5],
        [1, 1, 1],
        [2, 0, 0.5],
        [0, 1, 0.25],
      ])
        expect(run('_main', a, b, x) as number).toBeCloseTo(
          N(['Smoothstep', a, b, x]),
          6
        );
    }
  });
});
