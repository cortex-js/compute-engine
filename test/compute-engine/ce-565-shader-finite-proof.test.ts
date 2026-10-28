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
 *   of vectors of one width, are the built-ins. A scalar beside a vector in
 *   `max`, `min` or `clamp` keeps the helper, which broadcasts it, and
 *   `smoothstep` always keeps its helper (the built-in has no defined result
 *   when `e0 >= e1`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { shaderFunctions } from './gpu-shader-f32-eval';

type Target = 'glsl' | 'wgsl';

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

describe.each(['glsl', 'wgsl'] as const)('CE-565 on %s', (to) => {
  describe('a product of declared symbols', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'real');
    ce.declare('t', 'real');
    ce.declare('K', 'real<0..10>');
    ce.declare('T', 'real<-7..7>');
    ce.declare('H', 'real<0..1e30>');
    ce.declare('G', 'real<0..1e30>');

    it('two declared `real` factors keep the guard', () => {
      expect(shader(ce, '\\sin(kt)', to).code).toBe('_gpu_sin(k * t)');
    });

    it('two factors with declared ranges use the built-in', () => {
      expect(shader(ce, '\\sin(KT)', to).code).toBe('sin(K * T)');
      expect(shader(ce, '\\cos(KT\\cos(T))', to).code).toBe(
        'cos(K * T * cos(T))'
      );
      // A range on one factor is enough: the other factor is multiplied by
      // a value of known size, as by a literal.
      expect(shader(ce, '\\sin(Kt)', to).code).toBe('sin(K * t)');
    });

    it('a uniform with a declared range uses the built-in', () => {
      expect(
        shader(ce, '\\sin(KT)', to, { vars: { K: 'K', T: 'T' } }).code
      ).toBe('sin(K * T)');
      // A mapping to other source keeps the guard.
      expect(shader(ce, '\\sin(KT)', to, { vars: { K: 'uK' } }).code).toBe(
        '_gpu_sin(uK * T)'
      );
    });

    it('ranges whose product can overflow in f32 keep the guard', () => {
      expect(shader(ce, '\\sin(HG)', to).code).toBe('_gpu_sin(G * H)');
      // One factor of unknown size beside known factors whose product
      // already overflows f32: `H·G` alone can be 10⁶⁰.
      expect(shader(ce, '\\sin(HGt)', to).code).toMatch(/^_gpu_sin\(/);
    });

    it('a factor `sin`, `cos` or `tanh` has a magnitude of at most 1', () => {
      expect(shader(ce, '\\sin(t+k\\sin(t))', to).code).toBe(
        'sin(t + k * sin(t))'
      );
      // Two factors of unknown size.
      expect(shader(ce, '\\sin(kt\\cos(t))', to).code).toBe(
        '_gpu_sin(k * t * cos(t))'
      );
    });

    it('the product of two declared `real` can be +oo in f32', () => {
      // The reason the guard stays on `sin(k·t)`: in f32, 10²⁰ · 10²⁰ is
      // +∞, and the helper gives NaN there (the built-in gives 0 on Apple
      // GPUs). The f64 product 10⁴⁰ is finite.
      const { code, preamble } = shader(ce, '\\sin(kt)', to);
      const src =
        to === 'glsl'
          ? `${preamble}\nfloat f(float k, float t) {\n  return ${code};\n}`
          : `${preamble}\nfn f(k: f32, t: f32) -> f32 {\n  return ${code};\n}`;
      const f = shaderFunctions(src, to);
      expect(Number.isNaN(f('f', 1e20, 1e20) as number)).toBe(true);
      expect(f('f', 2, 0.25)).toBeCloseTo(Math.sin(0.5), 6);
    });

    it('the built-in of a ranged product matches the interpreter', () => {
      const { code } = shader(ce, '\\sin(KT)', to);
      const src =
        to === 'glsl'
          ? `float f(float K, float T) {\n  return ${code};\n}`
          : `fn f(K: f32, T: f32) -> f32 {\n  return ${code};\n}`;
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

  describe('a common-subexpression temporary', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('y', 'real');
    ce.declare('t', 'real');
    ce.declare('b', '(real) -> real');
    ce.parse('b(c) := \\arcsin(y/(0.04c+1.32))').evaluate();

    it('is finite when the expression it holds is', () => {
      expect(
        shader(
          ce,
          '(3t\\cos(2a-2\\arctan(y))+\\cos(a),3t\\sin(2a-2\\arctan(y)))',
          to,
          { vars: { a: 'a' } }
        ).code
      ).toMatch(/cos\(_cse1\) \+ cos\(a\), 3\.0 \* t \* sin\(_cse1\)/);
    });

    it('that holds `asin` of a call keeps the guard', () => {
      // `b(0.5)` is `asin(y / 1.34)`, NaN for |y| > 1.34. The declared
      // result type of `b` is a promise the interpreter does not check.
      const { code } = shader(
        ce,
        '(3t\\cos(2a-2b(0.5)),3t\\sin(2a-2b(0.5)))',
        to,
        { vars: { a: 'a' } }
      );
      expect(code).toMatch(/_gpu_cos\(_cse\d\)/);
      expect(code).toMatch(/_gpu_sin\(_cse\d\)/);
    });
  });

  describe('a symbol whose type is inferred', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('c', 2.5);
    ce.assign('a', 0.5);
    ce.parse('w := 3x+1').evaluate();
    ce.assign('p', ce.parse('c \\mapsto \\cos(x + 1.9c)'));

    it('a value the shader computes in place of the symbol is read', () => {
      expect(shader(ce, '\\sin(c+x)', to).code).toBe('sin(2.5 + x)');
      expect(shader(ce, '\\sin(cx)', to).code).toBe('sin(2.5 * x)');
      expect(shader(ce, '\\cos(w)', to).code).toBe('cos((3.0 * x + 1.0))');
    });

    it('a value that is finite in f64 but not in f32 keeps the guard', () => {
      // `1e39` is above the largest f32 (about 3.4·10³⁸): `+∞` in the shader.
      const ce2 = new ComputeEngine();
      ce2.declare('x', 'real');
      ce2.assign('c', 1e39);
      expect(shader(ce2, '\\sin(c+x)', to).code).toMatch(/^_gpu_sin\(/);
    });

    it('a uniform keeps the guard', () => {
      // `vars` makes `a` a run-time input: the host can pass NaN.
      expect(shader(ce, '\\cos(a)', to, { vars: { a: 'a' } }).code).toBe(
        '_gpu_cos(a)'
      );
      expect(shader(ce, '\\cos(c + x)', to, { vars: { c: 'c' } }).code).toBe(
        '_gpu_cos(c + x)'
      );
    });

    it('a parameter keeps the guard, also when a global of its name has a value', () => {
      // The parameter `c` of `p` is not the global `c := 2.5`.
      expect(shader(ce, 'p(x)', to).preamble).toMatch(/_gpu_cos\(/);
    });
  });

  describe('the helper definitions', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'real');
    ce.declare('t', 'real');
    const defines = (preamble: string, name: string) =>
      new RegExp(
        to === 'glsl' ? `\\w+ ${name}\\(\\w+ x` : `fn ${name}\\(x:`
      ).test(preamble);

    it('are left out when every call is a built-in', () => {
      const { code, preamble } = shader(
        ce,
        '(\\cos(t)+\\max(t,k), \\sin(t)\\operatorname{sign}(k))',
        to
      );
      expect(code).not.toMatch(/_gpu_/);
      expect(preamble).not.toMatch(/_gpu_/);
    });

    it('are only the ones the code calls', () => {
      const { code, preamble } = shader(
        ce,
        '(\\sin(kt)\\cos(t),\\sin(t)\\sin(kt))',
        to
      );
      expect(code).toMatch(/_gpu_sin\(k \* t\)/);
      expect(code).not.toMatch(/_gpu_cos/);
      expect(defines(preamble, '_gpu_sin')).toBe(true);
      expect(defines(preamble, '_gpu_isnonfinite')).toBe(true);
      expect(defines(preamble, '_gpu_cos')).toBe(false);
      expect(defines(preamble, '_gpu_isnan')).toBe(false);
      expect(defines(preamble, '_gpu_max')).toBe(false);
      expect(defines(preamble, '_gpu_sign')).toBe(false);
    });
  });

  describe('a vector operand', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.declare('k', 'real');
    ce.declare('u', 'number');
    ce.declare('v', 'vector<real^3>');
    ce.declare('a', 'vector<real^3>');
    ce.declare('b', 'vector<real^3>');
    ce.declare('w', 'vector<3>');
    ce.declare('p', 'tuple<real, real>');
    // `z` is typed `vector<real^3>` by inference, from its value.
    ce.assign('z', ce.parse('[t, k, 1]'));
    const vec3 = to === 'glsl' ? 'vec3' : 'vec3f';
    const box = (json: unknown) =>
      compile(ce.box(json as never), { to, fallback: false } as never).code;

    it('whose components are finite for certain uses the built-in', () => {
      expect(shader(ce, '\\sin([t,k,1])', to).code).toBe(
        `sin(${vec3}(t, k, 1.0))`
      );
      expect(shader(ce, '\\cos(v)', to).code).toBe('cos(v)');
      expect(shader(ce, '\\cos(p)', to).code).toBe('cos(p)');
      expect(shader(ce, '\\sin(2v+[t,k,1])', to).code).toBe(
        `sin(2.0 * v + ${vec3}(t, k, 1.0))`
      );
      expect(shader(ce, '\\operatorname{sign}(v)', to).code).toBe('sign(v)');
      expect(box(['ElementMax', 'v', 'a'])).toBe('max(v, a)');
      expect(box(['ElementMin', 'v', 'a', 'b'])).toBe('min(min(v, a), b)');
      expect(box(['Clamp', 'v', 'a', 'b'])).toBe('min(max(v, a), b)');
      expect(box(['Max', 'v', 2])).toBe('(max(max(max(v.x, v.y), v.z), 2.0))');
      // A uniform that `vars` maps to its own name, of its declared type.
      expect(shader(ce, '\\sin(v)', to, { vars: { v: 'v' } }).code).toBe(
        'sin(v)'
      );
      // A value written into the shader in place of the symbol.
      expect(shader(ce, '\\sin(z)', to).code).toBe(`sin(${vec3}(t, k, 1.0))`);
    });

    it('with one component that is not proven keeps the helper', () => {
      // `u: number` can be NaN.
      expect(shader(ce, '\\sin([t,u,1])', to).code).toBe(
        `_gpu_sin3(${vec3}(t, u, 1.0))`
      );
      // `vector<3>` has `number` cells.
      expect(shader(ce, '\\cos(w)', to).code).toBe('_gpu_cos3(w)');
      expect(box(['ElementMax', 'v', 'w'])).toBe('_gpu_max3(v, w)');
      expect(box(['Max', 'w'])).toBe('(_gpu_max(_gpu_max(w.x, w.y), w.z))');
      // Two factors of unknown size: `t·v` can overflow in f32.
      expect(shader(ce, '\\sin(tv)', to).code).toBe('_gpu_sin3(t * v)');
      // A mapping to other source.
      expect(shader(ce, '\\sin(v)', to, { vars: { v: 'uv' } }).code).toBe(
        '_gpu_sin3(uv)'
      );
    });

    it('with an inferred type keeps the helper when it is an input', () => {
      // As a uniform, `z` holds what the host passes.
      expect(shader(ce, '\\sin(z)', to, { vars: { z: 'z' } }).code).toBe(
        '_gpu_sin3(z)'
      );
    });

    it('a scalar beside a vector keeps the helper, which broadcasts it', () => {
      expect(box(['ElementMax', 'v', 0])).toBe(`_gpu_max3(v, ${vec3}(0.0))`);
      expect(box(['Clamp', 'v', 0, 1])).toBe(
        `_gpu_clamp3(v, ${vec3}(0.0), ${vec3}(1.0))`
      );
      expect(box(['Smoothstep', 'a', 'b', 'v'])).toBe(
        '_gpu_smoothstep3(a, b, v)'
      );
    });

    it('the vector built-ins give the interpreter values', () => {
      // The f32 interpreter has `vec2` only.
      const vt = to === 'glsl' ? 'vec2' : 'vec2f';
      const run = (latex: string, x: number, y: number) => {
        const { code } = shader(ce, latex, to);
        const src =
          to === 'glsl'
            ? `vec2 f(float t, float k) {\n  return ${code};\n}`
            : `fn f(t: f32, k: f32) -> vec2f {\n  return ${code};\n}`;
        return {
          code,
          value: shaderFunctions(src, to)('f', x, y) as {
            x: number;
            y: number;
          },
        };
      };
      const sin = run('\\sin([t, 2k])', 0.5, -1.25);
      expect(sin.code).toBe(`sin(${vt}(t, 2.0 * k))`);
      expect(sin.value.x).toBeCloseTo(Math.sin(0.5), 6);
      expect(sin.value.y).toBeCloseTo(Math.sin(-2.5), 6);
      const cos = run('\\cos([t, k] + [1, 2])', 0.5, -1.25);
      expect(cos.code).toMatch(/^cos\(/);
      expect(cos.value.x).toBeCloseTo(Math.cos(1.5), 6);
      expect(cos.value.y).toBeCloseTo(Math.cos(0.75), 6);
    });
  });
});
