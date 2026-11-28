/**
 * CE-520: on the `glsl` target, `Sin`, `Cos` (and `Sec`, `Csc`,
 * `Cot`), `Sign`, `Smoothstep` and `Heaviside` give NaN for a NaN operand,
 * as the `javascript` target does, and `tan(πx)` is `+∞` at a pole.
 *
 * Measured on an Apple M5 Max (WebGL2 over ANGLE Metal, 2026-10-26): the
 * built-ins `sin`, `cos`, `sign` and `smoothstep` of a NaN gave 0, `sin`
 * and `cos` of ±∞ gave 0 too, `1 / cos` gave +∞, and `_gpu_heaviside` of a
 * NaN gave 0.5. The target now calls the NaN-safe helpers of
 * `gpuNaNSafeLibrary` (`compilation/gpu-target.ts`), which test the bit pattern of the operand:
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

const ce = new ComputeEngine();
ce.declare('v', 'vector<real^3>');

describe('CE-520 — operands the helpers do not take', () => {
  it('a complex Smoothstep declines, as before', () => {
    const cz = new ComputeEngine();
    cz.declare('z', 'complex');
    for (const to of ['glsl'] as const) {
      for (const expr of [['Smoothstep', 0, 1, 'z']])
        expect(() =>
          compile(cz.box(expr as never), { to, fallback: false } as never)
        ).toThrow(/Could not compile/);
    }
  });

  it('a vector that draws a random value declines when Cot would use it twice', () => {
    // Binding it to a temporary would move its draw before the draws written
    // before it, so the lowering declines and the interpreter evaluates it.
    expect(() =>
      compile(ce.box(['Cot', ['List', 'x', ['Random'], 1]] as never), {
        to: 'glsl',
        fallback: false,
      } as never)
    ).toThrow(/Random on glsl/);
  });

  it('a vector that draws a random value declines even when used once', () => {
    const V = ['List', 'x', ['Random'], 1];
    for (const expr of [
      ['Sin', V],
      ['If', ['Greater', 'x', 0], ['Sin', V], ['List', 0, 0, 0]],
    ])
      expect(() =>
        compile(ce.box(expr as never), { to: 'glsl', fallback: false } as never)
      ).toThrow(/Random on glsl/);
  });
});
