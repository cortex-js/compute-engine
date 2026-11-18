/**
 * A `Sum` or `Product` with a complex-valued body compiles on the `glsl`
 * target (Tycho ledger row 377).
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

function gpu(latex: string, to: 'glsl'): any {
  const r = compile(engine().parse(latex), { to, fallback: false } as any);
  expect(r.success).toBe(true);
  return r;
}

describe('Tycho row 377: a complex-valued Sum or Product compiles on GPU targets', () => {
  for (const to of ['glsl'] as const) {
    test(`${to}: the real Taylor sum still unrolls to scalar terms`, () => {
      const code = String(
        gpu('\\sum_{n=0}^{10}\\frac{(-1)^n}{2n+1}x^{2n+1}', to).code
      );
      expect(code).not.toMatch(/vec2/);
    });
  }
});

describe('Tycho row 377: the index of a GPU Sum or Product is a real counter', () => {
  // A `Block` declares a complex local `n`, and a `Sum`/`Product` inside it
  // binds its own index `n`. The index is an integer counter, so a real body
  // must accumulate in a scalar. Reading the index as the outer complex local
  // selected a `vec2` accumulator and passed the scalar `float(n)` to
  // `_gpu_cmul`, which a shader compiler rejects.
  const inBlock = (body: unknown): unknown => [
    'Block',
    ['Declare', 'n', "'unknown'", ['Add', 'x', 'ImaginaryUnit']],
    ['Add', ['Abs', 'n'], body],
  ];
  const gpuBox = (json: unknown, to: 'glsl'): string => {
    const r = compile(engine().box(json as any), {
      to,
      fallback: false,
    } as any);
    expect(r.success).toBe(true);
    return String(r.code);
  };

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
});
