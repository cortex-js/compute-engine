/**
 * CE-619: on the shader targets, `sin`, `min`, … call the built-in, not the
 * NaN-safe helper (`_gpu_sin`, …), only when the operand is finite for
 * certain in f32 (`gpuProvablyFinite` in `compilation/gpu-target.ts`). An
 * operand that overflows to `+∞` in f32 gives 0 with the built-in `sin` on
 * Apple GPUs, where the helper gives NaN. Each input below was accepted
 * before, and overflows f32 for ordinary values:
 *
 * - CE-619.1: a parameter of a user function holds the value of its
 *   argument, which can be large (tested in
 *   `ce-565-4-gpu-parameter-finite.test.ts`).
 * - CE-619.2: a product with a factor of unknown size: `H·x` with
 *   `H: real<0..1e30>` and `x` declared `real`. A product is now accepted
 *   when every factor has a known size and the product of the sizes stays
 *   within half the largest f32, or when the only other factors are number
 *   literals of magnitude at most 1 (`0.5·x`).
 * - CE-619.3: `Random()` was drawn at compile time by the test of constant
 *   subtrees, so the compiled code changed from run to run.
 * - CE-619.4: `mod(R, 10⁻³⁰)`: the quotient `R / 10⁻³⁰` is `+∞` in f32.
 * - CE-619.5: a sum of terms whose declared ranges add up past the largest
 *   f32: `R + Q` with `R, Q: real<0..2e38>`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { shaderFunctions } from './gpu-shader-f32-eval';

type Target = 'glsl';

function shader(
  ce: ComputeEngine,
  expr: string | unknown[],
  to: Target,
  options: { constantFold?: boolean } = {}
): { code: string; preamble: string } {
  const r = compile(
    typeof expr === 'string' ? ce.parse(expr) : ce.box(expr as never),
    { to, fallback: false, ...options } as never
  ) as { success: boolean; code?: string; preamble?: string };
  expect([expr, r.success]).toEqual([expr, true]);
  return { code: r.code ?? '', preamble: r.preamble ?? '' };
}

describe.each(['glsl'] as const)('CE-619 on %s', (to) => {
  describe('CE-619.2: a product with a factor of unknown size', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('H', 'real<0..1e30>');
    ce.declare('G', 'real<0..1e19>');
    ce.declare('K', 'real<0..10>');
    ce.declare('s', 'real<-1..1>');

    it('the helper gives NaN where the product overflows f32', () => {
      // `H·x` at `H = 10³⁰`, `x = 10⁹` is 10³⁹, `+∞` in f32.
      const { code, preamble } = shader(ce, '\\sin(Hx)', to);
      const src = `${preamble}\nfloat f(float H, float x) {\n  return ${code};\n}`;
      const f = shaderFunctions(src, to);
      expect(Number.isNaN(f('f', 1e30, 1e9) as number)).toBe(true);
      expect(f('f', 2, 0.25)).toBeCloseTo(Math.sin(0.5), 6);
    });

  });

  describe('CE-619.3: `Random()` is not drawn at compile time', () => {
    const framed = (e: unknown[]) => e;
    // The pipeline refuses `Random` on GLSL (and a symbol whose value has
    // an effect), so every program below declines.
    const declinesRandom = (ce: ComputeEngine, e: unknown[]) =>
      expect(() =>
        compile(ce.box(e as never), { to, fallback: false } as never)
      ).toThrow(/Could not compile/);

    it('gives the same code on every compilation', () => {
      // `5·Random()·10³⁸` is `+∞` in f32 for a draw above 0.68.
      const ce = new ComputeEngine();
      ce.declare('n', 'real');
      const expr = framed([
        'Sin',
        ['Multiply', 5, ['Random'], ['Power', 10, 38]],
      ]);
      declinesRandom(ce, expr);
    });

    it('a symbol assigned `Random()` is not drawn at compile time', () => {
      // The engine reports `5·r·10³⁸` pure when `r := Random()`: its
      // purity stops at a symbol with a value.
      const ce = new ComputeEngine();
      ce.declare('n', 'real');
      ce.assign('r', ce.box(['Random']));
      const expr = framed(['Sin', ce.parse('5r10^{38}').json]);
      declinesRandom(ce, expr);
    });

    it('a draw of known size beside a finite term', () => {
      const ce = new ComputeEngine();
      ce.declare('n', 'real');
      ce.declare('x', 'real');
      declinesRandom(ce, framed(['Sin', ['Add', 'x', ['Random']]]));
    });
  });

});
