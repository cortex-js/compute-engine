/**
 * CE-520: on the `glsl` and `wgsl` targets, `Sin`, `Cos` (and `Sec`, `Csc`,
 * `Cot`), `Sign`, `Smoothstep` and `Heaviside` give NaN for a NaN operand,
 * as the `javascript` target does, and `tan(πx)` is `+∞` at a pole.
 *
 * Measured on an Apple M5 Max (WebGL2 over ANGLE Metal and WebGPU over
 * Metal, 2026-10-26): the built-ins `sin`, `cos`, `sign` and `smoothstep`
 * of a NaN gave 0 on both targets, `sin` and `cos` of ±∞ gave 0 too, `1 /
 * cos` gave +∞, and the GLSL `_gpu_heaviside` of a NaN gave 0.5. The targets
 * now call the NaN-safe helpers of `gpuNaNSafeLibrary`
 * (`compilation/gpu-target.ts`), which test the bit pattern of the operand:
 * `_gpu_sign` and `_gpu_smoothstep` return a NaN operand, and `_gpu_sin` and
 * `_gpu_cos` return a NaN built from its bit pattern for a NaN or an
 * infinite operand. The emitted shaders were run on that GPU and gave NaN at
 * the NaN and infinite inputs.
 *
 * Shader text cannot run under jest, and the f32 interpreter of
 * `gpu-shader-f32-eval.ts` computes `sin(NaN)` as NaN, so a value test
 * cannot show the guard of `_gpu_sin`; the emission is pinned instead. The
 * half-turn helpers are run in that interpreter: their guard and the pole of
 * `_gpu_tanpi` are in their own arithmetic.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { shaderFunctions } from './gpu-shader-f32-eval';

const ce = new ComputeEngine();
ce.declare('v', 'vector<real^3>');

function shader(
  expr: unknown,
  to: 'glsl' | 'wgsl'
): { code: string; preamble: string } {
  const r = compile(ce.box(expr as never), { to, fallback: false } as never);
  expect([to, r.success]).toEqual([to, true]);
  return {
    code: r.code!,
    preamble: (r as { preamble?: string }).preamble ?? '',
  };
}

describe('CE-520 — the NaN-safe helpers', () => {
  it('Sin, Cos and Sign of a scalar call the scalar helper', () => {
    for (const to of ['glsl', 'wgsl'] as const) {
      expect(shader(['Sin', 'x'], to).code).toBe('_gpu_sin(x)');
      expect(shader(['Cos', ['Add', 'x', 1]], to).code).toBe(
        '_gpu_cos(x + 1.0)'
      );
      expect(shader(['Sign', 'x'], to).code).toBe('_gpu_sign(x)');
      expect(shader(['Sec', 'x'], to).code).toBe('(1.0 / _gpu_cos(x))');
      expect(shader(['Csc', 'x'], to).code).toBe('(1.0 / _gpu_sin(x))');
      expect(shader(['Cot', 'x'], to).code).toBe('(_gpu_cos(x) / _gpu_sin(x))');
    }
  });

  it('a number literal keeps the built-in, which the driver folds', () => {
    // A literal cannot be NaN, and a helper call of it is not folded: the
    // difference changed a threshold test in Tycho's `voronoi-diagram`.
    // Constant folding is off, so that the literal reaches the shader, as
    // in a compile whose folding leaves it (an exact `cos(12/5)`).
    const unfolded = (expr: unknown, to: 'glsl' | 'wgsl') =>
      compile(ce.box(expr as never), {
        to,
        fallback: false,
        constantFold: false,
      } as never).code;
    for (const to of ['glsl', 'wgsl'] as const) {
      expect(unfolded(['Add', 'x', ['Sin', 4.8]], to)).toBe('x + sin(4.8)');
      expect(unfolded(['Cos', ['Rational', 12, 5]], to)).toBe('cos(2.4)');
    }
  });

  it('a vector operand calls the helper of its width', () => {
    expect(shader(['Sin', 'v'], 'glsl').code).toBe('_gpu_sin3(v)');
    expect(shader(['Sign', ['List', 'x', 1]], 'wgsl').code).toBe(
      '_gpu_sign2(vec2f(x, 1.0))'
    );
    expect(shader(['Smoothstep', 0, 1, 'v'], 'wgsl').code).toBe(
      '_gpu_smoothstep3(vec3f(0.0), vec3f(1.0), v)'
    );
    expect(shader(['Smoothstep', 0, 1, 'x'], 'glsl').code).toBe(
      '_gpu_smoothstep(0.0, 1.0, x)'
    );
  });

  it('the helpers test the bit pattern and return the operand', () => {
    const g = shader(['Sin', 'x'], 'glsl').preamble;
    expect(g).toContain(
      'return (_gpu_isnonfinite(x) ? intBitsToFloat(0x7FC00000) : sin(x));'
    );
    const w = shader(['Sign', 'v'], 'wgsl').preamble;
    expect(w).toContain(
      'fn _gpu_sign3(x: vec3f) -> vec3f {\n  return select(sign(x), x, _gpu_isnan3(x));\n}'
    );
    const s = shader(['Smoothstep', 0, 1, 'x'], 'glsl').preamble;
    expect(s).toContain(
      'return (_gpu_isnan(e0) ? e0 : (_gpu_isnan(e1) ? e1 : (_gpu_isnan(x) ? x : (e0 == e1 ? (x < e0 ? 0.0 : 1.0) : _gpu_hermite(min(max((x - e0) / (e1 - e0), 0.0), 1.0))))));'
    );
  });

  it('Heaviside and the half-turn helpers test the bit pattern first', () => {
    expect(shader(['Heaviside', 'x'], 'glsl').preamble).toContain(
      'float _gpu_heaviside(float x) {\n  if ((floatBitsToUint(x) & 0x7FFFFFFFu) > 0x7F800000u) return x;'
    );
    expect(shader(['Heaviside', 'x'], 'wgsl').preamble).toContain(
      'if ((bitcast<u32>(x) & 0x7FFFFFFFu) > 0x7F800000u) { return x; }'
    );
    expect(shader(['Cos', ['Multiply', 'Pi', 'x']], 'glsl').preamble).toContain(
      'vec2 _gpu_cossinpi(float u) {\n  if ((floatBitsToUint(u) & 0x7FFFFFFFu) >= 0x7F800000u) return vec2(intBitsToFloat(0x7FC00000));'
    );
  });
});

describe('CE-520 — operands the helpers do not take', () => {
  it('a complex Sign or Smoothstep declines, as before', () => {
    const cz = new ComputeEngine();
    cz.declare('z', 'complex');
    for (const to of ['glsl', 'wgsl'] as const) {
      for (const expr of [
        ['Sign', 'z'],
        ['Smoothstep', 0, 1, 'z'],
      ])
        expect(() =>
          compile(cz.box(expr as never), { to, fallback: false } as never)
        ).toThrow(/real-only/);
    }
  });

  it('Haversine calls the NaN-safe cos', () => {
    expect(shader(['Haversine', 'x'], 'wgsl').code).toBe(
      '((1.0 - _gpu_cos(x)) * 0.5)'
    );
  });

  it('a vector that draws a random value declines when Cot would use it twice', () => {
    // Binding it to a temporary would move its draw before the draws written
    // before it, so the lowering declines and the interpreter evaluates it.
    expect(() =>
      compile(ce.box(['Cot', ['List', 'x', ['Random'], 1]] as never), {
        to: 'glsl',
        fallback: false,
      } as never)
    ).toThrow(/draws a random value/);
  });

  it('a vector that draws a random value stays inline when used once', () => {
    const V = ['List', 'x', ['Random'], 1];
    for (const expr of [
      ['Sin', V],
      ['If', ['Greater', 'x', 0], ['Sin', V], ['List', 0, 0, 0]],
    ]) {
      const code = shader(expr, 'glsl').code;
      expect(code.split('_gpu_rnd_draw(').length - 1).toBe(1);
      expect(code).toContain('_gpu_sin3(vec3(x, _gpu_rnd_draw(');
    }
  });
});

describe('CE-520 — the half-turn helpers in f32', () => {
  for (const language of ['glsl', 'wgsl'] as const) {
    const main = (code: string): string =>
      language === 'glsl'
        ? `float _main(float x) { return ${code}; }`
        : `fn _main(x: f32) -> f32 { return ${code}; }`;
    const run = (expr: unknown) => {
      const r = shader(expr, language);
      const f = shaderFunctions(`${r.preamble}\n${main(r.code)}`, language);
      return (x: number) => f('_main', x) as number;
    };

    it(`${language}: sin(πx) and cos(πx) of a NaN or an infinity are NaN`, () => {
      expect(run(['Sin', ['Multiply', 'Pi', 'x']])(NaN)).toBeNaN();
      expect(run(['Cos', ['Multiply', 'Pi', 'x']])(NaN)).toBeNaN();
      expect(run(['Sin', ['Multiply', 'Pi', 'x']])(Infinity)).toBeNaN();
      expect(run(['Cos', ['Multiply', 'Pi', 'x']])(-Infinity)).toBeNaN();
      expect(run(['Tan', ['Multiply', 'Pi', 'x']])(Infinity)).toBeNaN();
      expect(run(['Sin', ['Multiply', 'Pi', 'x']])(0.5)).toBe(1);
    });

    it(`${language}: tan(πx) is +∞ at every pole`, () => {
      // The interpreter gives the undirected infinity `~oo` there, and a
      // compiled target writes it as +∞. The quotient sin/cos gave +∞ or −∞
      // from the sign of the zero cosine.
      const tanpi = run(['Tan', ['Multiply', 'Pi', 'x']]);
      for (const x of [0.5, -0.5, 1.5, -2.5]) expect(tanpi(x)).toBe(Infinity);
      expect(tanpi(0.25)).toBeCloseTo(1, 6);
      expect(tanpi(NaN)).toBeNaN();
    });
  }

  it('glsl: a shader that calls _gpu_tanpi includes the infinity helper', () => {
    expect(shader(['Tan', ['Multiply', 'Pi', 'x']], 'glsl').preamble).toContain(
      'float _gpu_inf()'
    );
  });
});
