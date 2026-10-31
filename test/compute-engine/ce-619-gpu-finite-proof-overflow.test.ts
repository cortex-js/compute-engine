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

type Target = 'glsl' | 'wgsl';

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

describe.each(['glsl', 'wgsl'] as const)('CE-619 on %s', (to) => {
  describe('CE-619.2: a product with a factor of unknown size', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('H', 'real<0..1e30>');
    ce.declare('G', 'real<0..1e19>');
    ce.declare('K', 'real<0..10>');
    ce.declare('s', 'real<-1..1>');

    it('keeps the helper', () => {
      expect(shader(ce, '\\sin(Hx)', to).code).toBe('_gpu_sin(H * x)');
      expect(shader(ce, '\\sin(G(Gx))', to).code).toBe('_gpu_sin(G * G * x)');
      expect(shader(ce, '\\sin(x/10^{-30})', to).code).toBe(
        '_gpu_sin(1e+30 * x)'
      );
      expect(shader(ce, '\\sin(\\lfloor x\\rfloor\\cdot10^{30})', to).code).toBe(
        '_gpu_sin(floor(x) * 1e+30)'
      );
      expect(shader(ce, '\\sin(5x)', to).code).toBe('_gpu_sin(5.0 * x)');
    });

    it('the helper gives NaN where the product overflows f32', () => {
      // `H·x` at `H = 10³⁰`, `x = 10⁹` is 10³⁹, `+∞` in f32.
      const { code, preamble } = shader(ce, '\\sin(Hx)', to);
      const src =
        to === 'glsl'
          ? `${preamble}\nfloat f(float H, float x) {\n  return ${code};\n}`
          : `${preamble}\nfn f(H: f32, x: f32) -> f32 {\n  return ${code};\n}`;
      const f = shaderFunctions(src, to);
      expect(Number.isNaN(f('f', 1e30, 1e9) as number)).toBe(true);
      expect(f('f', 2, 0.25)).toBeCloseTo(Math.sin(0.5), 6);
    });

    it('a factor whose typed range holds only before the rounding to f32 keeps the helper', () => {
      // `A − B` is typed in [2, 3], but `A` rounds to 100000008 and `B` to
      // 10⁸ in f32: `A − B` is 8 there, and `H·(A − B)` can be 4·10³⁸, `+∞`.
      const ce = new ComputeEngine();
      ce.declare('A', 'real<100000005..100000006>');
      ce.declare('B', 'real<100000003..100000003>');
      ce.declare('H', 'real<0..5e37>');
      expect(shader(ce, '\\sin(H(A-B))', to).code).toBe(
        '_gpu_sin(H * (A + -B))'
      );
    });

    it('a constant subtree that is not folded is bounded by its parts', () => {
      // With `constantFold: false`, `|A − B|` is computed in the shader:
      // its f64 value is 2, but in f32 `A` rounds to 100000008 and `B` to
      // 10⁸, so it is 8, and `H·|A − B|` is `+∞` at `H = 5·10³⁷`.
      const ce = new ComputeEngine();
      ce.assign('A', 100000005);
      ce.assign('B', 100000003);
      ce.declare('H', 'real<0..5e37>');
      const { code, preamble } = shader(ce, '\\sin(H\\cdot|A-B|)', to, {
        constantFold: false,
      });
      expect(code).toMatch(/^_gpu_sin\(/);
      const src =
        to === 'glsl'
          ? `${preamble}\nfloat f(float H) {\n  return ${code};\n}`
          : `${preamble}\nfn f(H: f32) -> f32 {\n  return ${code};\n}`;
      const f = shaderFunctions(src, to);
      expect(Number.isNaN(f('f', 5e37) as number)).toBe(true);
    });

    it('a chain of stored values past the depth limit gives no bound', () => {
      // `C8` is `C0 = |A − B|` through eight aliases. Past the depth limit
      // the proof must not read the interpreter's value 2: with
      // `constantFold: false` the shader computes 8 in f32.
      const ce = new ComputeEngine();
      ce.assign('A', 100000005);
      ce.assign('B', 100000003);
      ce.assign('C0', ce.box(['Abs', ['Subtract', 'A', 'B']]));
      for (let i = 1; i <= 8; i++) ce.assign(`C${i}`, ce.box(`C${i - 1}`));
      ce.declare('H', 'real<0..5e37>');
      expect(
        shader(ce, ['Sin', ['Multiply', 'H', 'C8']], to, {
          constantFold: false,
        }).code
      ).toMatch(/^_gpu_sin\(/);
    });

    it('a stored value is read in the angular unit of the engine', () => {
      // In degree mode the shader computes `c := |\arccos(-1) - \pi|` as
      // `|180 - π|`, about 176.86, not 0: `H·c` with `H` up to 1.5·10³⁸ is
      // `+∞` in f32, so the helper stays.
      const ce = new ComputeEngine();
      ce.angularUnit = 'deg';
      ce.assign('c', ce.box(['Abs', ['Subtract', ['Arccos', -1], 'Pi']]));
      ce.declare('H', 'real<0..1.5e38>');
      expect(shader(ce, ['Sin', ['Multiply', 'H', 'c']], to).code).toMatch(
        /^_gpu_sin\(/
      );
    });

    it('a constant subtree that is folded into one literal is bounded by its value', () => {
      const ce = new ComputeEngine();
      ce.assign('A', 100000005);
      ce.assign('B', 100000003);
      ce.declare('H', 'real<0..5e37>');
      expect(shader(ce, '\\sin(H\\cdot|A-B|)', to).code).toBe('sin(H * 2.0)');
      // A pure literal subtree, `ln 2`, which canonicalization keeps.
      expect(shader(ce, '\\sin(H\\ln2)', to).code).toMatch(
        /^sin\(H \* 0\.69314/
      );
    });

    it('factors of known size, or literals of magnitude at most 1, use the built-in', () => {
      expect(shader(ce, '\\sin(Ks)', to).code).toBe('sin(K * s)');
      expect(shader(ce, '\\sin(Hs)', to).code).toBe('sin(H * s)');
      expect(shader(ce, '\\sin(0.5x)', to).code).toBe('sin(0.5 * x)');
      // A rational factor `1/q`: the shader multiplies by its value or
      // divides by `q`, and neither can overflow.
      expect(shader(ce, '\\sin(x/2)', to).code).toBe('sin(0.5 * x)');
      expect(shader(ce, '\\sin(x/3)', to).code).toBe('sin(x / 3.0)');
      expect(shader(ce, '\\sin(-x/3)', to).code).toBe('sin(-(x / 3.0))');
    });
  });

  describe('CE-619.3: `Random()` is not drawn at compile time', () => {
    // WGSL draws only inside a seed frame (`WithRandomSeed`), whose seed
    // varies at run time here: a constant seed is drawn at compile time.
    const framed = (e: unknown[]) =>
      to === 'wgsl' ? ['WithRandomSeed', 'n', e] : e;

    it('gives the same code on every compilation', () => {
      // `5·Random()·10³⁸` is `+∞` in f32 for a draw above 0.68.
      const ce = new ComputeEngine();
      ce.declare('n', 'real');
      const expr = framed([
        'Sin',
        ['Multiply', 5, ['Random'], ['Power', 10, 38]],
      ]);
      const codes = new Set<string>();
      for (let i = 0; i < 8; i++) codes.add(shader(ce, expr, to).code);
      expect(codes.size).toBe(1);
      expect([...codes][0]).toMatch(/_gpu_sin\(5\.0 \* /);
    });

    it('a symbol assigned `Random()` is not drawn at compile time', () => {
      // The engine reports `5·r·10³⁸` pure when `r := Random()`: its
      // purity stops at a symbol with a value.
      const ce = new ComputeEngine();
      ce.declare('n', 'real');
      ce.assign('r', ce.box(['Random']));
      const expr = framed(['Sin', ce.parse('5r10^{38}').json]);
      const codes = new Set<string>();
      for (let i = 0; i < 8; i++) codes.add(shader(ce, expr, to).code);
      expect(codes.size).toBe(1);
      expect([...codes][0]).toMatch(/^_gpu_sin\(5\.0 \* _gpu_rnd_draw\(/);
    });

    it('a draw of known size beside a finite term uses the built-in', () => {
      const ce = new ComputeEngine();
      ce.declare('n', 'real');
      ce.declare('x', 'real');
      const { code } = shader(ce, framed(['Sin', ['Add', 'x', ['Random']]]), to);
      expect(code).toMatch(/\bsin\(x \+ /);
      expect(code).not.toMatch(/_gpu_sin/);
    });
  });

  describe('CE-619.4: `Mod` with a tiny divisor', () => {
    const ce = new ComputeEngine();
    ce.declare('R', 'real<0..1e17>');
    ce.declare('x', 'real');
    ce.declare('d', 'real<0.5..2>');

    it('keeps the helper', () => {
      expect(
        shader(ce, '\\sin(\\operatorname{mod}(R, 10^{-30}))', to).code
      ).toMatch(/^_gpu_sin\(/);
      expect(shader(ce, ['Sin', ['Mod', 'R', 1e-30]], to).code).toMatch(
        /^_gpu_sin\(/
      );
      // A dividend of unknown size: the product of the divisor and the
      // rounded quotient can round past the largest f32.
      expect(shader(ce, '\\sin(\\operatorname{mod}(x, 3))', to).code).toMatch(
        /^_gpu_sin\(/
      );
    });

    it('a divisor whose range holds only before the rounding to f32 keeps the helper', () => {
      // `A − B` is typed in [0.5, 2], but `A` and `B` both round to 10⁸ in
      // f32: the divisor is 0 and the floored modulo is NaN.
      const ce = new ComputeEngine();
      ce.declare('A', 'real<100000000.5..100000002>');
      ce.declare('B', 'real<100000000..100000000>');
      ce.declare('R', 'real<0..10>');
      expect(
        shader(ce, '\\sin(\\operatorname{mod}(R, A-B))', to).code
      ).toMatch(/^_gpu_sin\(/);
    });

    it('a divisor above 2¹²⁶ keeps the helper', () => {
      const ce = new ComputeEngine();
      ce.declare('R', 'real<0..10>');
      ce.declare('D', 'real<1..1e38>');
      expect(
        shader(ce, '\\sin(\\operatorname{mod}(R, D))', to).code
      ).toMatch(/^_gpu_sin\(/);
    });

    it('a quotient of known size uses the built-in', () => {
      expect(shader(ce, '\\sin(\\operatorname{mod}(R, 3))', to).code).toMatch(
        /^sin\(_gpu_fmod\(R, 3\.0\)\)$/
      );
      // A divisor with a declared range that excludes 0.
      expect(shader(ce, '\\sin(\\operatorname{mod}(R, d))', to).code).toMatch(
        /^sin\(_gpu_fmod\(R, d\)\)$/
      );
      // A divisor 1 is `fract`, finite for every finite dividend.
      expect(shader(ce, '\\sin(\\operatorname{mod}(x, 1))', to).code).toMatch(
        /^sin\(/
      );
    });
  });

  describe('CE-619.5: a sum of terms with large declared ranges', () => {
    const ce = new ComputeEngine();
    ce.declare('R', 'real<0..2e38>');
    ce.declare('Q', 'real<0..2e38>');
    ce.declare('S', 'real<0..1e30>');
    ce.declare('U', 'real<0..1e30>');
    ce.declare('x', 'real');
    ce.declare('y', 'real');

    it('keeps the helper', () => {
      expect(shader(ce, '\\sin(R+Q)', to).code).toBe('_gpu_sin(Q + R)');
      // Two terms of unknown size: `x + y` is `+∞` at `x = y = 2·10³⁸`.
      expect(shader(ce, '\\sin(x+y)', to).code).toBe('_gpu_sin(x + y)');
      // One term of unknown size beside a term that can be 2·10³⁸.
      expect(shader(ce, '\\sin(x+R)', to).code).toBe('_gpu_sin(R + x)');
    });

    it('terms whose sizes add up to a finite f32 use the built-in', () => {
      expect(shader(ce, '\\sin(S+U)', to).code).toBe('sin(S + U)');
      // One term of unknown size beside small terms.
      expect(shader(ce, '\\sin(x+1)', to).code).toBe('sin(x + 1.0)');
      expect(shader(ce, '\\sin(x+S)', to).code).toBe('sin(S + x)');
    });
  });

  describe('the absolute value of a point is its Euclidean norm', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real<-1..1>');
    ce.declare('y', 'real<-1..1>');
    ce.declare('H', 'real<0..1e38>');
    const v = to === 'glsl' ? 'vec4' : 'vec4f';
    const pointNorms = [
      'Sin',
      [
        'Multiply',
        'H',
        ['Abs', ['Tuple', 'x', 'x', 'x', 'x']],
        ['Abs', ['Tuple', 'y', 'y', 'y', 'y']],
      ],
    ];

    it('keeps the helper', () => {
      // Each norm is 2 at `x = y = 1`, not the largest coordinate 1, and
      // `H·2·2` is `+∞` in f32 at `H = 10³⁸`.
      expect(shader(ce, pointNorms, to).code).toBe(
        `_gpu_sin(H * length(${v}(x, x, x, x)) * length(${v}(y, y, y, y)))`
      );
    });

    it('`abs`, `min` and `max` of real scalars use the built-in', () => {
      expect(
        shader(ce, ['Sin', ['Multiply', 'H', ['Abs', 'x'], ['Abs', 'y']]], to)
          .code
      ).toBe('sin(H * abs(x) * abs(y))');
      expect(
        shader(
          ce,
          ['Sin', ['Multiply', 'H', ['Max', 'x', 'y'], ['Min', 'x', 'y']]],
          to
        ).code
      ).toBe('sin(H * min(x, y) * max(x, y))');
    });
  });
});
