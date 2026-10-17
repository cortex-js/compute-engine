/**
 * A `Sum` or `Product` with a complex-valued body compiles on the `glsl` and
 * `wgsl` targets (Tycho ledger row 377).
 *
 * Before, a shader `Sum`/`Product` refused any complex-valued body, while
 * the same terms written out by hand compiled. The consumer case was a domain
 * colouring `|f(x+iy)|` with `f` the arctangent Taylor polynomial. The shader
 * target now accumulates such a body in a `vec2(re, im)`: a sum adds the terms
 * component-wise, a product multiplies them with the `_gpu_cmul` helper of
 * the complex preamble (`*` on two `vec2` is the component-wise product), and
 * an empty range answers the complex identity. This applies to the unrolled
 * form (constant bounds) and to the loop form (symbolic or large bounds).
 */

import { ComputeEngine, compile } from '../../src/compute-engine';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('m', 'integer');
  return ce;
}

function gpu(latex: string, to: 'glsl' | 'wgsl'): any {
  const r = compile(engine().parse(latex), { to, fallback: false } as any);
  expect(r.success).toBe(true);
  return r;
}

const ARCTAN_SUM =
  '\\left|\\sum_{n=0}^{10}\\frac{(-1)^n}{2n+1}(x+iy)^{2n+1}\\right|';

// The same eleven terms, written out by hand.
const ARCTAN_HAND = `\\left|${Array.from(
  { length: 11 },
  (_, n) => `${n % 2 ? '-' : '+'}\\frac{(x+iy)^{${2 * n + 1}}}{${2 * n + 1}}`
).join('')}\\right|`;

// The complex helpers (`_gpu_c…`) the code calls. The real `_gpu_powi` is
// left out: the hand-written coefficients are exact rationals, while the sum
// computes `(-1)^n` per term, and a shader does not fold `_gpu_powi(-1.0, n)`
// for `n` of 5 or more (`gpuIntegerPow` in `constant-folding.ts`).
const complexHelpers = (code: string) =>
  [...new Set(code.match(/_gpu_c\w+/g) ?? [])].sort();

describe('Tycho row 377: a complex-valued Sum or Product compiles on GPU targets', () => {
  for (const to of ['glsl', 'wgsl'] as const) {
    test(`${to}: the arctangent Taylor sum unrolls to eleven complex powers`, () => {
      const code = String(gpu(ARCTAN_SUM, to).code);
      expect(code.startsWith('length(')).toBe(true);
      expect(code.match(/_gpu_cpow\(/g)?.length).toBe(11);
      // The unrolled sum and the hand-unrolled terms use the same helpers.
      expect(complexHelpers(code)).toEqual(['_gpu_cpow']);
      expect(complexHelpers(String(gpu(ARCTAN_HAND, to).code))).toEqual([
        '_gpu_cpow',
      ]);
    });

    test(`${to}: the real Taylor sum still unrolls to scalar terms`, () => {
      const code = String(
        gpu('\\sum_{n=0}^{10}\\frac{(-1)^n}{2n+1}x^{2n+1}', to).code
      );
      expect(code).not.toMatch(/vec2/);
    });
  }

  test('glsl: a sum adds the complex terms component-wise', () => {
    expect(gpu('\\sum_{n=1}^{3}(n+ix)', 'glsl').code).toBe(
      '((vec2(1.0, x)) + (vec2(2.0, x)) + (vec2(3.0, x)))'
    );
  });

  test('glsl and wgsl: a product multiplies the terms with _gpu_cmul', () => {
    const glsl = gpu('\\prod_{n=1}^{3}(x+in)', 'glsl');
    expect(glsl.code).toBe(
      '(_gpu_cmul(_gpu_cmul((vec2(x, 1.0)), (vec2(x, 2.0))), (vec2(x, 3.0))))'
    );
    expect(glsl.preamble).toContain('vec2 _gpu_cmul(vec2 a, vec2 b)');
    const wgsl = gpu('\\prod_{n=1}^{3}(x+in)', 'wgsl');
    expect(wgsl.code).toBe(
      '(_gpu_cmul(_gpu_cmul((vec2f(x, 1.0)), (vec2f(x, 2.0))), (vec2f(x, 3.0))))'
    );
    expect(wgsl.preamble).toContain(
      'fn _gpu_cmul(a: vec2f, b: vec2f) -> vec2f'
    );
  });

  test('an empty range answers the complex identity', () => {
    expect(gpu('\\sum_{n=3}^{1}(x+iy)^n', 'glsl').code).toBe('vec2(0.0, 0.0)');
    expect(gpu('\\prod_{n=3}^{1}(x+iy)^n', 'glsl').code).toBe('vec2(1.0, 0.0)');
    expect(gpu('\\sum_{n=3}^{1}(x+iy)^n', 'wgsl').code).toBe('vec2f(0.0, 0.0)');
    expect(gpu('\\prod_{n=3}^{1}(x+iy)^n', 'wgsl').code).toBe(
      'vec2f(1.0, 0.0)'
    );
  });

  test('glsl: the loop form accumulates in a vec2', () => {
    expect(gpu('\\sum_{n=1}^{m}(x+iy)^n', 'glsl').code).toBe(
      [
        'vec2 _tv1 = vec2(0.0, 0.0);',
        'for (int n = 1; n <= int(floor(m)); n++) {',
        '  _tv1 += _gpu_cpow(vec2(x, y), vec2(float(n), 0.0));',
        '}',
        'return _tv1;',
      ].join('\n')
    );
    expect(gpu('\\prod_{n=1}^{m}(x+in)', 'glsl').code).toBe(
      [
        'vec2 _tv1 = vec2(1.0, 0.0);',
        'for (int n = 1; n <= int(floor(m)); n++) {',
        '  _tv1 = _gpu_cmul(_tv1, vec2(x, float(n)));',
        '}',
        'return _tv1;',
      ].join('\n')
    );
  });

  test('wgsl: the loop form accumulates in a vec2f', () => {
    expect(gpu('\\sum_{n=1}^{m}(x+iy)^n', 'wgsl').code).toBe(
      [
        'var _tv1: vec2f = vec2f(0.0, 0.0);',
        'for (var n: i32 = 1; n <= i32(floor(m)); n++) {',
        '  _tv1 += _gpu_cpow(vec2f(x, y), vec2f(f32(n), 0.0));',
        '}',
        'return _tv1;',
      ].join('\n')
    );
    expect(gpu('\\prod_{n=1}^{m}(x+in)', 'wgsl').code).toBe(
      [
        'var _tv1: vec2f = vec2f(1.0, 0.0);',
        'for (var n: i32 = 1; n <= i32(floor(m)); n++) {',
        '  _tv1 = _gpu_cmul(_tv1, vec2f(x, f32(n)));',
        '}',
        'return _tv1;',
      ].join('\n')
    );
  });

  test('an unrolled term bound to a temporary is declared vec2', () => {
    // Each term holds a loop-form inner sum, so its value is bound to a
    // temporary after the inner loop.
    const code = String(
      gpu('\\prod_{n=1}^{2}\\left(n+\\sum_{k=1}^{m}(x+iy)^k\\right)', 'glsl')
        .code
    );
    expect(code).toContain('vec2 _tv2 = vec2(1.0, 0.0) + _tv1;');
    expect(code).toContain('vec2 _tv4 = vec2(2.0, 0.0) + _tv3;');
    expect(code).toMatch(/return \(_gpu_cmul\(\(_tv2\), \(_tv4\)\)\);$/);
    expect(code).not.toMatch(/float _tv/);
  });
});

describe('Tycho row 377: the index of a GPU Sum or Product is a real counter', () => {
  // A `Block` declares a complex local `n`, and a `Sum`/`Product` inside it
  // binds its own index `n`. The index is an integer counter, so a real body
  // must accumulate in a scalar. Reading the index as the outer complex local
  // selected a `vec2` accumulator and passed the scalar `float(n)` to
  // `_gpu_cmul`, which a shader compiler rejects.
  const inBlock = (body: unknown): unknown => [
    'Block',
    ['Declare', 'n'],
    ['Assign', 'n', ['Add', 'x', 'ImaginaryUnit']],
    ['Add', ['Abs', 'n'], body],
  ];
  const gpuBox = (json: unknown, to: 'glsl' | 'wgsl'): string => {
    const r = compile(engine().box(json as any), {
      to,
      fallback: false,
    } as any);
    expect(r.success).toBe(true);
    return String(r.code);
  };

  test('glsl: a real Product over n compiles on the real lane', () => {
    expect(
      gpuBox(inBlock(['Product', 'n', ['Limits', 'n', 1, 'm']]), 'glsl')
    ).toBe(
      [
        'vec2 n;',
        'n = vec2(x, 1.0);',
        'float _tv1 = 1.0;',
        'for (int n = 1; n <= int(floor(m)); n++) {',
        '  _tv1 *= float(n);',
        '}',
        'return _tv1 + length(n);',
      ].join('\n')
    );
  });

  test('glsl: the terms of a real Sum over n are real', () => {
    const code = gpuBox(
      inBlock(['Sum', ['Power', 'n', 2], ['Limits', 'n', 1, 'm']]),
      'glsl'
    );
    expect(code).toContain('float _tv1 = 0.0;');
    expect(code).toContain('_tv1 += _gpu_pow2(float(n));');
    expect(code).not.toMatch(/_gpu_c\w+/);
  });

  test('wgsl: a real Product over n compiles on the real lane', () => {
    const code = gpuBox(
      inBlock(['Product', 'n', ['Limits', 'n', 1, 'm']]),
      'wgsl'
    );
    expect(code).toContain('var _tv1: f32 = 1.0;');
    expect(code).toContain('_tv1 *= f32(n);');
    expect(code).not.toMatch(/_gpu_cmul/);
  });

  test('glsl: an unrolled real Sum over n has real terms', () => {
    const code = gpuBox(
      inBlock([
        'Sum',
        ['Multiply', 'x', ['Power', 'n', 2]],
        ['Limits', 'n', 1, 3],
      ]),
      'glsl'
    );
    expect(code).not.toMatch(/_gpu_c\w+/);
    expect(code).not.toMatch(/vec2\((1|2|3)\.0, 0\.0\)/);
  });

  test('glsl: a complex body over n still compiles on the complex lane', () => {
    expect(
      gpuBox(
        inBlock([
          'Abs',
          [
            'Product',
            ['Add', 'x', ['Multiply', 'ImaginaryUnit', 'n']],
            ['Limits', 'n', 1, 'm'],
          ],
        ]),
        'glsl'
      )
    ).toBe(
      [
        'vec2 n;',
        'n = vec2(x, 1.0);',
        'vec2 _tv1 = vec2(1.0, 0.0);',
        'for (int n = 1; n <= int(floor(m)); n++) {',
        '  _tv1 = _gpu_cmul(_tv1, vec2(x, float(n)));',
        '}',
        'return length(_tv1) + length(n);',
      ].join('\n')
    );
  });
});
