/**
 * CE-605 (Tycho ledger row 475): on the `glsl` and `wgsl` targets, a `Map`
 * inside the lambda of another `Map` compiles when each source is a list of
 * a length known at compile time.
 *
 * The shader targets have no `Map` lowering. The pass of
 * `compilation/fixed-width-unroll.ts` writes a `Map` over such a list out as
 * the list of its substituted bodies, and then reduces the list by `Min`,
 * `Max` or `Sum`. The rule refused a lambda whose body holds a binder (the
 * inner `Map`'s lambda, a `Sum` index), so the outer `Map` stayed and the
 * compilation declined: "Could not compile `Map`: … no lowering for it". On
 * the shader targets only, the rule now accepts such a body, and keeps the
 * decline in three cases:
 *  - a binder in the body binds a symbol of an element: `subs` would
 *    capture that symbol;
 *  - the parameter starts with `_` (an anonymous parameter, `_1`) and a
 *    binder in the body binds it again: `subs` does not treat such a name
 *    as a binder, and would rewrite the inner lambda too;
 *  - the written-out form would have more than 64 bodies (the product of
 *    the sizes of the nested `Map` and `Comprehension` nodes), or the size
 *    of an inner one is not known before the substitution.
 * The other targets lower `Map` as a loop and keep the old refusal.
 *
 * The values are checked against the `javascript` target, by running the
 * emitted shader text in the f32 interpreter of `gpu-shader-f32-eval.ts`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { shaderFunctions } from './gpu-shader-f32-eval';

const ce = new ComputeEngine();

type Language = 'glsl' | 'wgsl';

function shader(latex: string, to: Language) {
  const r = compile(ce.parse(latex, { strict: false }), {
    to,
    fallback: false,
  } as never) as { success: boolean; code?: string; preamble?: string };
  expect([to, r.success]).toEqual([to, true]);
  return { code: r.code!, preamble: r.preamble ?? '' };
}

/** The emitted shader as a function of `x`, run in f32. */
function runShader(latex: string, language: Language): (x: number) => number {
  const { code, preamble } = shader(latex, language);
  // A compilation with common subexpressions emits statements that end with
  // a `return`; otherwise the code is one expression.
  const body = /\breturn\b/.test(code) ? code : `return ${code};`;
  const main =
    language === 'glsl'
      ? `float _main(float x) { ${body} }`
      : `fn _main(x: f32) -> f32 { ${body} }`;
  const f = shaderFunctions(`${preamble}\n${main}`, language);
  return (x) => f('_main', x) as number;
}

function runJavaScript(latex: string): (x: number) => number {
  const r = compile(ce.parse(latex, { strict: false }), {
    to: 'javascript',
    fallback: false,
  } as never) as { success: boolean; run: (v: object) => number };
  expect(r.success).toBe(true);
  return (x) => r.run({ x });
}

const SAMPLES = [-1.5, 0, 0.7, 2];

function expectSameValues(latex: string): void {
  const js = runJavaScript(latex);
  for (const language of ['glsl', 'wgsl'] as const) {
    const gpu = runShader(latex, language);
    for (const x of SAMPLES)
      expect([language, x, gpu(x)]).toEqual([
        language,
        x,
        expect.closeTo(js(x), 5),
      ]);
  }
}

// The two cases of Tycho's instrument
// (`scripts/repros/2026-10-28-ce475-glsl-nested-map-reduction-repro.mts`).
const X_IN_OUTER = String.raw`\min\left(\mathrm{Map}\left(k\mapsto \max\left(\mathrm{Map}\left(j\mapsto j\cdot k, \left[1,3\right]\right)\right)+x, \left[1,2\right]\right)\right)`;
const X_IN_INNER = String.raw`\min\left(\mathrm{Map}\left(k\mapsto \max\left(\mathrm{Map}\left(j\mapsto j+x, \left[1,3\right]\right)\right), \left[1,2\right]\right)\right)`;

describe('CE-605 — a Map inside the lambda of another Map on the GPU', () => {
  it('min of max, x in the outer lambda: written out', () => {
    // k = 1 gives max(1, 3) + x, k = 2 gives max(2, 6) + x.
    for (const to of ['glsl', 'wgsl'] as const)
      expect(shader(X_IN_OUTER, to).code).toBe('_gpu_min(x + 3.0, x + 6.0)');
    expectSameValues(X_IN_OUTER);
  });

  it('min of max, x in the inner lambda', () => {
    for (const to of ['glsl', 'wgsl'] as const)
      expect(shader(X_IN_INNER, to).code).toContain('_gpu_max(x + 1.0, x + 3.0)');
    expectSameValues(X_IN_INNER);
  });

  it('sum of sums', () => {
    const latex = String.raw`\sum\left(\mathrm{Map}\left(k\mapsto \sum\left(\mathrm{Map}\left(j\mapsto j\cdot k\cdot x, \left[1,2,3\right]\right)\right), \left[1,2\right]\right)\right)`;
    for (const to of ['glsl', 'wgsl'] as const)
      expect(shader(latex, to).code).not.toContain('Map');
    expectSameValues(latex);
  });

  it('max over a Map whose lambda holds a Sum', () => {
    const latex = String.raw`\max\left(\mathrm{Map}\left(k\mapsto \sum_{i=1}^{3} k i + x, \left[1,2\right]\right)\right)`;
    for (const to of ['glsl', 'wgsl'] as const)
      expect(shader(latex, to).code).toBe('_gpu_max(x + 6.0, x + 12.0)');
    expectSameValues(latex);
  });

  it('an inner lambda whose parameter has the name of the outer one', () => {
    // The inner `k` is the inner parameter: `subs` does not replace it.
    const latex = String.raw`\max\left(\mathrm{Map}\left(k\mapsto \max\left(\mathrm{Map}\left(k\mapsto k\cdot 2, \left[1,3\right]\right)\right)+k x, \left[1,2\right]\right)\right)`;
    expectSameValues(latex);
  });

  it('an inner source of unknown length: the decline stays', () => {
    const latex = String.raw`\min\left(\mathrm{Map}\left(k\mapsto \max\left(\mathrm{Map}\left(j\mapsto j\cdot k, L\right)\right)+x, \left[1,2\right]\right)\right)`;
    for (const to of ['glsl', 'wgsl'] as const)
      expect(() =>
        compile(ce.parse(latex, { strict: false }), {
          to,
          fallback: false,
        } as never)
      ).toThrow(/Could not compile `Map`: .* has no lowering for it/);
  });

  it('nested anonymous parameters: no wrong code on any target', () => {
    // Both lambdas are written with the parameter `_1`. `subs` does not
    // treat a name that starts with `_` as a binder, so writing out the
    // outer `Map` with `subs` would also replace the parameter and the body
    // of the inner lambda. The shader targets keep the decline, and the
    // JavaScript target gives the interpreter value.
    const list = (n: number) => [
      'List',
      ...Array.from({ length: n }, (_, i) => i + 1),
    ];
    for (const n of [2, 6]) {
      const expr = ce.box([
        'Min',
        [
          'Map',
          [
            'Function',
            [
              'Add',
              '_1',
              ['Max', ['Map', ['Function', ['Multiply', '_1', 'x'], '_1'], list(n)]],
            ],
            '_1',
          ],
          list(n),
        ],
      ] as never);
      const js = compile(expr, { to: 'javascript', fallback: false } as never) as {
        run: (v: object) => number;
      };
      for (const x of SAMPLES)
        expect([n, x, js.run({ x })]).toEqual([
          n,
          x,
          expect.closeTo(expr.subs({ x }).N().re, 9),
        ]);
      for (const to of ['glsl', 'wgsl'] as const)
        expect(() =>
          compile(expr, { to, fallback: false } as never)
        ).toThrow(/Could not compile `Map`: .* has no lowering for it/);
    }
  });

  it('on javascript, a nested Map over two wide lists stays two loops', () => {
    // The javascript target lowers `Map` as a loop. Written out, the 20×20
    // case below was 8,968 characters (1,010 as loops), and 300×300 was
    // 2.2 million.
    const n = 20;
    const inner = [
      'List',
      ...Array.from({ length: n }, (_, i) => ['Multiply', i + 1, 'y']),
    ];
    const outer = [
      'List',
      ...Array.from({ length: n }, (_, i) => ['Add', 'x', i + 1]),
    ];
    const expr = ce.box([
      'Min',
      [
        'Map',
        [
          'Function',
          ['Max', ['Map', ['Function', ['Multiply', 'j', 'k'], 'j'], inner]],
          'k',
        ],
        outer,
      ],
    ] as never);
    const r = compile(expr, { to: 'javascript', fallback: false } as never) as {
      code: string;
      run: (v: object) => number;
    };
    expect(r.code.match(/\.map\(/g)?.length).toBe(2);
    expect(r.code.length).toBeLessThan(2000);
    expect(r.run({ x: 0.5, y: 2 })).toBeCloseTo(
      expr.subs({ x: 0.5, y: 2 }).N().re,
      9
    );
  });

  it('a nested Map that writes out more than 64 bodies declines', () => {
    // Each level checks its own width, so the nested form writes out the
    // product of the widths. A 100×100 nested `Map` was a GLSL shader of
    // 330,000 characters; the limit is `MAX_UNROLLED_COMPREHENSION_SIZE`.
    const nested = (outer: number, inner: number) =>
      ce.box([
        'Min',
        [
          'Map',
          [
            'Function',
            [
              'Max',
              [
                'Map',
                ['Function', ['Multiply', 'j', 'k'], 'j'],
                [
                  'List',
                  ...Array.from({ length: inner }, (_, i) => ['Multiply', i + 1, 'y']),
                ],
              ],
            ],
            'k',
          ],
          [
            'List',
            ...Array.from({ length: outer }, (_, i) => ['Add', 'x', i + 1]),
          ],
        ],
      ] as never);
    for (const to of ['glsl', 'wgsl'] as const) {
      // 8 × 8 = 64 bodies: written out.
      const r = compile(nested(8, 8), { to, fallback: false } as never) as {
        code: string;
      };
      expect(r.code).not.toContain('Map');
      for (const [outer, inner] of [
        [9, 8],
        [100, 100],
      ])
        expect(() =>
          compile(nested(outer, inner), { to, fallback: false } as never)
        ).toThrow(/Could not compile `Map`: .* has no lowering for it/);
    }
  });

  it('a Comprehension in the lambda counts toward the 64-body limit', () => {
    const mapOverComprehension = (n: number) =>
      ce.box([
        'Max',
        [
          'Map',
          [
            'Function',
            [
              'Max',
              [
                'Comprehension',
                ['Sin', ['Multiply', 'k', 'i', 'x']],
                ['Element', 'i', ['Range', 1, n]],
              ],
            ],
            'k',
          ],
          ['List', ...Array.from({ length: n }, (_, i) => i + 1)],
        ],
      ] as never);

    // 8 × 8 = 64 bodies: written out, with the values of the javascript
    // target and of the interpreter.
    const small = mapOverComprehension(8);
    const js = compile(small, { to: 'javascript', fallback: false } as never) as {
      run: (v: object) => number;
    };
    for (const language of ['glsl', 'wgsl'] as const) {
      const r = compile(small, { to: language, fallback: false } as never) as {
        code: string;
        preamble?: string;
      };
      const body = /\breturn\b/.test(r.code) ? r.code : `return ${r.code};`;
      const main =
        language === 'glsl'
          ? `float _main(float x) { ${body} }`
          : `fn _main(x: f32) -> f32 { ${body} }`;
      const f = shaderFunctions(`${r.preamble ?? ''}\n${main}`, language);
      for (const x of SAMPLES) {
        const expected = small.subs({ x }).N().re;
        expect(js.run({ x })).toBeCloseTo(expected, 9);
        expect([language, x, f('_main', x)]).toEqual([
          language,
          x,
          expect.closeTo(expected, 5),
        ]);
      }
    }

    // 64 × 64 = 4,096 bodies: declined.
    for (const to of ['glsl', 'wgsl'] as const)
      expect(() =>
        compile(mapOverComprehension(64), { to, fallback: false } as never)
      ).toThrow(/Could not compile `Map`: .* has no lowering for it/);
  });

  it('an element that an inner binder would capture: the decline stays', () => {
    // Writing `j` for `k` under the inner lambda `j ↦ j + k` would read the
    // inner `j`, so the outer `Map` is not written out.
    const latex = String.raw`\min\left(\mathrm{Map}\left(k\mapsto \max\left(\mathrm{Map}\left(j\mapsto j+k, \left[1,3\right]\right)\right), \left[j,2\right]\right)\right)+x`;
    for (const to of ['glsl', 'wgsl'] as const)
      expect(() =>
        compile(ce.parse(latex, { strict: false }), {
          to,
          fallback: false,
        } as never)
      ).toThrow(/Could not compile `Map`: .* has no lowering for it/);
  });
});
