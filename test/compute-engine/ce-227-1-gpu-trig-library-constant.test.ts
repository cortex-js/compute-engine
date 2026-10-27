/**
 * CE-227.1: on the shader targets, a constant term of a trigonometric
 * argument that applies a pure library function to constant operands
 * (`\sin(x+\Gamma(20))`) is reduced by whole periods at compile time, as a
 * number literal is (`gpuReduceTrigOffset`, `compilation/gpu-target.ts`).
 *
 * Before the fix, the compiler's own constant fold emitted the large value
 * unreduced (`sin(x + 121645100408832000.0)`), and in float32 the sum lost
 * every digit of `x`. The remainders below were checked with mpmath at 50
 * digits: Γ(20) = 19! ≡ 0.02064149648 (mod 2π and mod π),
 * 20! ≡ 0.4128299295 (mod 2π), C(40, 20) ≡ −1.492820046 (mod 2π) and
 * e²⁰ ≡ 0.4122614767 (mod 2π).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { shaderFunctions } from './gpu-shader-f32-eval';

const TARGETS = [
  ['glsl', GLSLTarget],
  ['wgsl', WGSLTarget],
] as const;

let ce: ComputeEngine;
beforeAll(() => {
  ce = new ComputeEngine();
  ce.declare('x', 'real');
});

function code(latex: string, Target: typeof GLSLTarget | typeof WGSLTarget) {
  return new Target().compile(ce.parse(latex)).code;
}

describe('CE-227.1 the emitted argument', () => {
  test.each(TARGETS)('%s', (_, Target) => {
    expect(code('\\sin(x+\\Gamma(20))', Target)).toBe(
      '_gpu_sin(x + 0.020641496)'
    );
    expect(code('\\tan(x+\\Gamma(20))', Target)).toBe('tan(x + 0.020641496)');
    expect(code('\\sin(x+20!)', Target)).toBe('_gpu_sin(x + 0.41282994)');
    expect(code('\\cos(x+\\binom{40}{20})', Target)).toBe(
      '_gpu_cos(x + -1.49282)'
    );
    expect(code('\\sin(x+e^{20})', Target)).toBe('_gpu_sin(x + 0.4122615)');
  });
});

describe('CE-227.1 the shader value', () => {
  test('is the float64 value', () => {
    const latex = '\\sin(x+\\Gamma(20))';
    const r = new GLSLTarget().compile(ce.parse(latex));
    const run = shaderFunctions(
      `${r.preamble ?? ''}\nfloat _main(float x) { return ${r.code}; }`,
      'glsl'
    );
    for (const x of [-2.718, 0.1, 1.2345].map(Math.fround)) {
      const want = ce
        .parse(latex)
        .subs({ x: ce.number(x) })
        .N().re;
      expect(Math.abs((run('_main', x) as number) - want)).toBeLessThan(1e-6);
    }
  });
});

describe('CE-227.1 terms that stay unfolded', () => {
  test('a function the caller maps to its own code', () => {
    const e = ce.box(['Sin', ['Add', 'x', ['Gamma', 20]]]);
    expect(
      compile(e, { to: 'glsl', functions: { Gamma: 'myGamma' } }).code
    ).toBe('_gpu_sin(x + myGamma(20.0))');
  });

  test('a user function whose body calls a function the caller maps', () => {
    ce.parse('u(t) \\coloneq t + \\Gamma(t) + 10^6').evaluate();
    const e = ce.box(['Sin', ['Add', 'x', ['u', 20]]]);
    expect(
      compile(e, { to: 'glsl', functions: { Gamma: 'mygamma' } }).code
    ).toBe('_gpu_sin(x + _fn_u(20.0))');
  });

  test('a symbol the caller maps to a run-time input', () => {
    const e = ce.box(['Sin', ['Add', 'x', ['Power', 'ExponentialE', 10]]]);
    expect(
      compile(e, { to: 'glsl', vars: { ExponentialE: 'otherBase' } }).code
    ).toBe('_gpu_sin(x + _gpu_powi(otherBase, 10.0))');
  });

  test('a Random() term', () => {
    const e = ce.box(['Sin', ['Add', 'x', ['Multiply', 1e6, ['Random']]]]);
    expect(compile(e, { to: 'glsl' }).code).toContain('_gpu_rnd_draw');
  });

  test('a term with a variable', () => {
    expect(code('\\sin(x+\\Gamma(a))', GLSLTarget)).toBe(
      '_gpu_sin(x + _gpu_gamma(a))'
    );
  });
});
