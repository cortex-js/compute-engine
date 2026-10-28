/**
 * CE-519 (Tycho row 465): on the `glsl` and `wgsl` targets, `Max`, `Min`,
 * `Clamp`, `ElementMax` and `ElementMin` give NaN when an operand is NaN, as
 * the interpreter and the `javascript` target do.
 *
 * GLSL ES 3.0 and WGSL leave the built-ins `max`, `min` and `clamp`
 * undefined for a NaN operand, and on Apple GPUs they return the other
 * operand: `max(0, sqrt(1 - x²))` at x = 2 was 0. The targets now call the
 * helpers `_gpu_max`, `_gpu_min` and `_gpu_clamp` (and their vector forms),
 * which test the bit pattern of each operand (a test `a != a` was removed by
 * the compiler on WebGPU over Metal) and return a NaN operand by selection,
 * not through arithmetic. The emitted shaders were run on an Apple M5 Max
 * (WebGL2 over ANGLE Metal and WebGPU over Metal) on 2026-10-26 and gave the
 * `javascript` values, NaN included.
 *
 * Shader text cannot run under jest. The last block runs the GLSL scalar
 * helpers and the emitted call as JavaScript, with the bit test written out,
 * so it checks the helper bodies themselves.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('v', 'vector<real^3>');
// `vector<3>` has `number` cells, which can be NaN: the vector operand of the
// helper tests. The cells of `v` are finite for certain, so the operations on
// `v` and on finite scalars call the built-ins (CE-565.2).
ce.declare('n', 'vector<3>');

const ROOT = ['Sqrt', ['Subtract', 1, ['Square', 'x']]];

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

describe('CE-519 — Max, Min and Clamp call the NaN-safe helpers', () => {
  it('emits the helpers for the Tycho row 465 cases on both targets', () => {
    for (const to of ['glsl', 'wgsl'] as const) {
      expect(shader(['Max', 0, ROOT], to).code).toBe(
        '_gpu_max(0.0, sqrt(-(x * x) + 1.0))'
      );
      expect(shader(['Min', 1, ROOT], to).code).toBe(
        '_gpu_min(1.0, sqrt(-(x * x) + 1.0))'
      );
      expect(shader(['Clamp', ROOT, 0, 1], to).code).toBe(
        '_gpu_clamp(sqrt(-(x * x) + 1.0), 0.0, 1.0)'
      );
    }
  });

  it('tests the bit pattern, not `a != a`', () => {
    const g = shader(['Max', 0, ROOT], 'glsl').preamble;
    expect(g).toContain(
      'bool _gpu_isnan(float x) {\n  return (floatBitsToUint(x) & 0x7FFFFFFFu) > 0x7F800000u;\n}'
    );
    expect(g).toContain(
      'return (_gpu_isnan(a) ? a : (_gpu_isnan(b) ? b : max(a, b)));'
    );
    const w = shader(['Max', 0, ROOT], 'wgsl').preamble;
    expect(w).toContain(
      'fn _gpu_isnan(x: f32) -> bool {\n  return (bitcast<u32>(x) & 0x7FFFFFFFu) > 0x7F800000u;\n}'
    );
    expect(w).toContain(
      'return select(select(max(a, b), b, _gpu_isnan(b)), a, _gpu_isnan(a));'
    );
    // Only the helpers this compilation names are in the preamble.
    expect(g).not.toContain('_gpu_min');
    expect(g).not.toContain('_gpu_clamp');
  });

  it('a vector Clamp calls the vector helper, with scalar bounds broadcast', () => {
    expect(shader(['Clamp', 'n', 0, 1], 'glsl').code).toBe(
      '_gpu_clamp3(n, vec3(0.0), vec3(1.0))'
    );
    expect(shader(['Clamp', 'n', 0, 1], 'wgsl').code).toBe(
      '_gpu_clamp3(n, vec3f(0.0), vec3f(1.0))'
    );
    expect(shader(['Clamp', 'v', 0, 1], 'glsl').code).toBe(
      'min(max(v, vec3(0.0)), vec3(1.0))'
    );
    expect(shader(['Clamp', 'n', 0, 1], 'glsl').preamble).toContain(
      'return mix(mix(mix(min(max(x, lo), hi), hi, _gpu_isnan3(hi)), lo, _gpu_isnan3(lo)), x, _gpu_isnan3(x));'
    );
    expect(shader(['Clamp', 'n', 0, 1], 'wgsl').preamble).toContain(
      'return select(select(select(min(max(x, lo), hi), hi, _gpu_isnan3(hi)), lo, _gpu_isnan3(lo)), x, _gpu_isnan3(x));'
    );
  });

  it('ElementMax and ElementMin call the helpers, with a scalar broadcast', () => {
    for (const to of ['glsl', 'wgsl'] as const)
      expect(shader(['ElementMax', 'x', ROOT], to).code).toBe(
        '_gpu_max(x, sqrt(-(x * x) + 1.0))'
      );
    expect(shader(['ElementMin', 0.5, 'n'], 'glsl').code).toBe(
      '_gpu_min3(vec3(0.5), n)'
    );
    expect(shader(['ElementMin', 0.5, 'n'], 'wgsl').code).toBe(
      '_gpu_min3(vec3f(0.5), n)'
    );
    expect(shader(['ElementMin', 0.5, 'v'], 'wgsl').code).toBe(
      'min(vec3f(0.5), v)'
    );
  });

  it('a Max over a vector folds the helper over its components', () => {
    // `x` has no declared type and can be NaN.
    expect(shader(['Max', ['List', 'x', 1, 2], 0], 'wgsl').code).toBe(
      '(_gpu_max(_gpu_max(_gpu_max(x, 1.0), 2.0), 0.0))'
    );
    // The components of `v: vector<real^3>` are finite for certain: the
    // built-in (CE-565).
    expect(shader(['Max', 'v', 0], 'wgsl').code).toBe(
      '(max(max(max(v.x, v.y), v.z), 0.0))'
    );
  });

  it('the vector helpers test each component and return a NaN operand', () => {
    const g = shader(['ElementMax', 2, 'n', 'n'], 'glsl');
    expect(g.code).toBe('_gpu_max3(_gpu_max3(vec3(2.0), n), n)');
    expect(g.preamble).toContain(
      'bvec3 _gpu_isnan3(vec3 x) {\n  return greaterThan(floatBitsToUint(x) & 0x7FFFFFFFu, uvec3(0x7F800000u));\n}'
    );
    expect(g.preamble).toContain(
      'return mix(mix(max(a, b), b, _gpu_isnan3(b)), a, _gpu_isnan3(a));'
    );
    // In GLSL a function is declared before the function that calls it.
    expect(g.preamble.indexOf('_gpu_isnan3(vec3 x)')).toBeLessThan(
      g.preamble.indexOf('_gpu_max3(vec3 a')
    );
    const w = shader(['ElementMax', 2, 'n', 'n'], 'wgsl');
    expect(w.code).toBe('_gpu_max3(_gpu_max3(vec3f(2.0), n), n)');
    expect(w.preamble).toContain(
      'fn _gpu_isnan3(x: vec3f) -> vec3<bool> {\n  return (bitcast<vec3u>(x) & vec3u(0x7FFFFFFFu)) > vec3u(0x7F800000u);\n}'
    );
    expect(w.preamble).toContain(
      'return select(select(max(a, b), b, _gpu_isnan3(b)), a, _gpu_isnan3(a));'
    );
  });

  it('a Clamp with vector bounds calls the vector helper', () => {
    expect(shader(['Clamp', 'n', 'n', 1], 'glsl').code).toBe(
      '_gpu_clamp3(n, n, vec3(1.0))'
    );
    expect(shader(['Clamp', 'v', 'v', 1], 'glsl').code).toBe(
      'min(max(v, v), vec3(1.0))'
    );
  });

  it('shapes with no helper still decline', () => {
    const cev = new ComputeEngine();
    cev.declare('v', 'vector<real^3>');
    cev.declare('u', 'vector<real^2>');
    for (const to of ['glsl', 'wgsl'] as const) {
      // A scalar `x` between vector bounds.
      expect(() =>
        compile(cev.box(['Clamp', 'x', 'v', 1] as never), {
          to,
          fallback: false,
        } as never)
      ).toThrow(/Could not compile `Clamp`/);
      // Vectors of different widths.
      expect(() =>
        compile(cev.box(['ElementMax', 'v', 'u'] as never), {
          to,
          fallback: false,
        } as never)
      ).toThrow(/Could not compile `ElementMax`/);
    }
  });

  it('a function applied to a written list of these calls still compiles', () => {
    // The check that a lowering is componentwise reads only the text the
    // lowering adds, not the helper calls inside the operand's own source.
    for (const [head, code] of [
      ['Clamp', '_gpu_clamp(x, 0.0, 1.0)'],
      ['Max', '_gpu_max(x, 0.0)'],
    ] as const) {
      const operand = head === 'Clamp' ? ['Clamp', 'x', 0, 1] : ['Max', 'x', 0];
      expect(shader(['Sin', ['List', operand, 0, 1]], 'glsl').code).toBe(
        `_gpu_sin3(vec3(${code}, 0.0, 1.0))`
      );
      expect(shader(['Sin', ['List', operand, 0, 1]], 'wgsl').code).toBe(
        `_gpu_sin3(vec3f(${code}, 0.0, 1.0))`
      );
    }
    expect(shader(['Sin', ['List', ['Mod', 'x', 2], 0, 1]], 'glsl').code).toBe(
      '_gpu_sin3(vec3(_gpu_fmod(x, 2.0), 0.0, 1.0))'
    );
    // A helper that the lowering itself calls on the vector still declines.
    expect(() =>
      compile(ce.box(['Sinc', ['List', 'x', 0, 1]] as never), {
        to: 'glsl',
        fallback: false,
      } as never)
    ).toThrow(/not componentwise/);
  });
});

describe('CE-519 — the GLSL helpers agree with the javascript target', () => {
  const bits = new DataView(new ArrayBuffer(4));
  /** `floatBitsToUint` of the f32 rounding of `v`. */
  const floatBitsToUint = (v: number): number => {
    bits.setFloat32(0, v);
    return bits.getUint32(0);
  };

  /**
   * The GLSL scalar helpers and the emitted call as a JavaScript function of
   * `x`. A helper signature (`float f(float a, float b) {`) becomes
   * `function f(a, b) {`; `max`, `min` and `sqrt` are the built-ins.
   */
  function asFunction(expr: unknown): (x: number) => number {
    const { code, preamble } = shader(expr, 'glsl');
    // An unsigned literal (`0x7F800000u`) loses its `u` suffix.
    const helpers = preamble
      .replace(
        /\b(?:float|bool) (\w+)\(([^)]*)\) \{/g,
        (_, name, params: string) =>
          `function ${name}(${params.replace(/\bfloat /g, '')}) {`
      )
      .replace(/\b(0x[0-9A-F]+)u\b/g, '$1');
    // eslint-disable-next-line no-new-func
    const f = new Function(
      'x',
      'floatBitsToUint',
      'max',
      'min',
      'sqrt',
      `${helpers}\nreturn ${code};`
    );
    return (x) =>
      f(
        x,
        floatBitsToUint,
        // The GPU built-ins return the operand that is a number.
        (a: number, b: number) =>
          Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.max(a, b),
        (a: number, b: number) =>
          Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.min(a, b),
        Math.sqrt
      );
  }

  const CASES: unknown[] = [
    ['Max', 0, ROOT],
    ['Max', ROOT, 0],
    ['Min', 1, ROOT],
    ['Clamp', ROOT, 0, 1],
    ['Clamp', 'x', 0, ROOT],
    ['Clamp', 'x', 1, 0],
    ['Max', 'x', 1, ['Negate', 'x']],
    ['ElementMax', 'x', ROOT],
    ['ElementMin', ROOT, 'x', 0.25],
  ];

  it.each(CASES.map((c) => [JSON.stringify(c), c]))('%s', (_label, expr) => {
    const f = asFunction(expr);
    const js = compile(ce.box(expr as never), { to: 'javascript' } as never)
      .run as (v: Record<string, number>) => number;
    let nans = 0;
    for (const x of [0.5, 1, -1, 0, 2, 3]) {
      const expected = js({ x });
      const value = f(x);
      if (Number.isNaN(expected)) {
        nans += 1;
        expect([x, value]).toEqual([x, NaN]);
      } else expect(value).toBeCloseTo(expected, 6);
    }
    // Each case except the two with no square root has NaN points
    // (x = 2 and x = 3), so the NaN case is checked.
    const hasRoot = JSON.stringify(expr).includes('Sqrt');
    expect(nans).toBe(hasRoot ? 2 : 0);
  });
});
