/**
 * CE-565: the shader targets call the built-in `sin` and `cos`, not the
 * NaN-safe helpers `_gpu_sin` and `_gpu_cos`, when the operand is finite for
 * certain (`gpuProvablyFinite` in `compilation/gpu-target.ts`). Four cases
 * that Tycho reported after it declared its plot parameters `real`:
 *
 * - `sin(k·t)` with `k` and `t` declared `real`: the product of two finite
 *   f32 values can overflow to `+∞` (`k = t = 10²⁰`), where the
 *   interpreter's f64 value is finite, so the guard stays. Declared ranges
 *   (`k: real<0..10>`) bound the product, and the built-in is used. A
 *   factor `sin`, `cos` or `tanh` of a real has a magnitude of at most 1.
 * - A common-subexpression temporary: the proof reads the expression that
 *   the temporary holds, so `cos(_cse1)` is the built-in when that
 *   expression is finite for certain. The Tycho row keeps the guard because
 *   the temporary holds `asin(…)` of a call of a user function, which is
 *   NaN outside [-1, 1].
 * - A symbol whose type is inferred: a uniform (`vars: { a: 'a' }`) holds
 *   what the host passes, so the guard stays. A symbol with a value that the
 *   shader computes in place of the symbol is read through its value.
 * - The helper definitions are in the preamble only when the code calls
 *   them.
 * - A `vec2`–`vec4` operand is finite for certain when each component is
 *   (`gpuFiniteRealCells`): a written vector of declared reals, a declared
 *   `vector<real^n>` or tuple of reals, or arithmetic over those under the
 *   scalar rules. Then `sin`, `cos`, `sign`, and `max`, `min` and `clamp`
 *   of vectors of one width, are the built-ins. `smoothstep` always keeps
 *   its helper (the built-in has no defined result when `e0 >= e1`).
 * - CE-565.2: a scalar beside a vector in `ElementMax`, `ElementMin` or
 *   `Clamp` is broadcast with the vector constructor (GLSL has no
 *   `max(float, vecN)`). The proof reads the scalar
 *   as written: `vec3(s)` is finite exactly when `s` is. When every operand
 *   is finite for certain, `Clamp(v, 0, 1)` is
 *   `min(max(v, vec3(0.0)), vec3(1.0))`; a scalar that can be NaN (`x:
 *   number`, `0/0`) or a vector that can hold NaN keeps the helper.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { shaderFunctions } from './gpu-shader-f32-eval';

type Target = 'glsl';

function shader(
  ce: ComputeEngine,
  latex: string,
  to: Target,
  options: object = {}
): { code: string; preamble: string } {
  const r = compile(ce.parse(latex), {
    to,
    fallback: false,
    ...options,
  } as never) as { success: boolean; code?: string; preamble?: string };
  expect([latex, r.success]).toEqual([latex, true]);
  return { code: r.code ?? '', preamble: r.preamble ?? '' };
}

describe.each(['glsl'] as const)('CE-565 on %s', (to) => {
  describe('a product of declared symbols', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'real');
    ce.declare('t', 'real');
    ce.declare('K', 'real<0..10>');
    ce.declare('T', 'real<-7..7>');
    ce.declare('H', 'real<0..1e30>');
    ce.declare('G', 'real<0..1e30>');

    it('the product of two declared `real` can be +oo in f32', () => {
      // The reason the guard stays on `sin(k·t)`: in f32, 10²⁰ · 10²⁰ is
      // +∞, and the helper gives NaN there (the built-in gives 0 on Apple
      // GPUs). The f64 product 10⁴⁰ is finite.
      const { code, preamble } = shader(ce, '\\sin(kt)', to);
      const src = `${preamble}\nfloat f(float k, float t) {\n  return ${code};\n}`;
      const f = shaderFunctions(src, to);
      expect(Number.isNaN(f('f', 1e20, 1e20) as number)).toBe(true);
      expect(f('f', 2, 0.25)).toBeCloseTo(Math.sin(0.5), 6);
    });

    it('the built-in of a ranged product matches the interpreter', () => {
      const { code } = shader(ce, '\\sin(KT)', to);
      const src = `float f(float K, float T) {\n  return ${code};\n}`;
      const f = shaderFunctions(src, to);
      for (const [K, T] of [
        [0, -7],
        [10, -7],
        [10, 7],
        [3.5, 1.25],
      ])
        expect(f('f', K, T)).toBeCloseTo(
          ce.box(['Sin', ['Multiply', K, T]]).N().re,
          5
        );
    });
  });

  describe('the helper definitions', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'real');
    ce.declare('t', 'real');

    it('are left out when every call is a built-in', () => {
      const { code, preamble } = shader(
        ce,
        '(\\cos(t)+\\max(t,k), \\sin(t)\\operatorname{sign}(k))',
        to
      );
      expect(code).not.toMatch(/_gpu_/);
      expect(preamble).not.toMatch(/_gpu_/);
    });
  });
});
