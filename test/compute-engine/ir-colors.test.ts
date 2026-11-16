/**
 * The colour lane of the profile `ir` (batch G7; README of
 * `src/compute-engine/compilation/ir/`, "The colour lane").
 *
 * - JavaScript: each admitted operator against the interpreter (its colour
 *   read in the space of the compiled value, with `AsOklch`, `AsOklab`, …)
 *   and against the result object of the existing compiler (`CompiledColor`:
 *   `space`, `c0`, `c1`, `c2`, `alpha`), within 1e-12.
 * - GLSL: the text, assembled as a host assembles it, runs in WebGL2 (the
 *   headless Chromium of `scripts/glsl-check/glsl-driver.ts`), and each
 *   channel agrees with the JavaScript value within single-float precision.
 *   Without the browser, these tests are skipped.
 * - Tycho's witness (showcase/mandelbrot-colorings) in a reduced form on
 *   both targets; the declines; the three robustness tests.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import type { Expression } from '../../src/compute-engine/global-types';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Color = {
  space: string;
  c0: number;
  c1: number;
  c2: number;
  alpha: number | undefined;
};

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('n', 'integer');
ce.declare('c', 'color');
// The user functions of Tycho's witness, of real results.
ce.assign('Lz', ce.box(['Function', ['Divide', 'a', ['Add', 1, ['Abs', 'a']]], 'a']));
ce.assign(
  'Cz',
  ce.box([
    'Function',
    ['Add', 0.5, ['Multiply', 0.5, ['Cos', ['Multiply', 'a', 'k']]]],
    'a',
    'k',
  ])
);
ce.assign('Pz', ce.box(['Function', ['Fract', 'a'], 'a']));
ce.assign('fc', ce.box(['Function', ['Oklch', 'a', 0.1, 250], 'a']));
ce.declare('fk', '(color) -> color');
ce.assign('fk', ce.box(['Function', 'q', 'q']));

const IR = { profile: 'ir', fallback: false } as const;
const js = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { ...IR, ...options });
const glsl = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { ...IR, to: 'glsl', ...options });

/** The diagnostic of a compilation that throws, or `undefined`. */
function failure(
  f: () => unknown
): { code: string; message: string } | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { code: string; message: string } })
      .diagnostic;
  }
  return undefined;
}

const AS: Record<string, string> = {
  oklch: 'AsOklch',
  oklab: 'AsOklab',
  rgb: 'AsRgb',
  hsl: 'AsHsl',
  hsv: 'AsHsv',
};

/** The channels of the interpreter's colour of `json` at `point`, read in
 *  the space `space`. */
function interpreted(json: Json, point: object, space: string): number[] {
  const value = ce
    .box(json as never)
    .subs(point as never)
    .evaluate();
  const read = ce.box([AS[space], value.json] as never).evaluate();
  if (!isFunction(read)) throw new Error(`not a colour: ${read}`);
  return read.ops.slice(0, 3).map((op) => op.re);
}

const near = (a: number, b: number, tolerance: number) =>
  Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));

const WITNESS = [
  'AsOklab',
  [
    'Which',
    ['Equal', 'n', 7],
    [
      'Which',
      ['Less', 'x', 1],
      [
        'Oklch',
        ['Add', ['Multiply', 0.85, ['Sqrt', ['Max', ['Lz', 'x'], 0]]], 0.15],
        0.03,
        250,
      ],
      'True',
      ['Rgb', 0.1, 0.1, 0.15],
    ],
    ['Equal', 'n', 1],
    ['Rgb', ['Cz', 'x', 0.5], ['Cz', 'x', 0.6], ['Cz', 'x', 0.7]],
    ['Equal', 'n', 3],
    ['Oklch', ['Add', ['Multiply', 0.88, ['Power', ['Lz', 'x'], 2]], 0.12], 0.09, 250],
    'True',
    ['Rgb', ['Pz', 'x'], ['Pz', 'x'], ['Pz', 'x']],
  ],
];

// prettier-ignore
const PROGRAMS: [label: string, json: Json, points: object[]][] = [
  ['Oklch', ['Oklch', 'x', 0.1, 250], [{ x: 0.3 }, { x: 0.8 }]],
  ['Oklab', ['Oklab', 'x', 0.05, -0.1], [{ x: 0.3 }, { x: 0.7 }]],
  ['Rgb', ['Rgb', 'x', 0.4, 0.6], [{ x: 0.3 }, { x: 0.9 }]],
  ['Rgb, extended sRGB', ['Rgb', 'x', 0.4, ['Negate', 'y']], [{ x: 1.2, y: 0.1 }]],
  ['AsOklab of Oklch', ['AsOklab', ['Oklch', 'x', 'y', 250]], [{ x: 0.3, y: 0.1 }, { x: 0.6, y: 0.2 }]],
  ['AsOklab of Rgb', ['AsOklab', ['Rgb', 'x', 0.4, 0.6]], [{ x: 0.3 }, { x: 0.05 }]],
  ['AsRgb of Oklch', ['AsRgb', ['Oklch', 'x', 0.1, 250]], [{ x: 0.6 }, { x: 0.3 }]],
  ['AsRgb of Oklch, out of gamut', ['AsRgb', ['Oklch', 0.9, 'x', 250]], [{ x: 0.3 }]],
  ['AsOklch of Rgb', ['AsOklch', ['Rgb', 'x', 0.4, 0.6]], [{ x: 0.3 }]],
  ['AsOklab of an If', ['AsOklab', ['If', ['Less', 'x', 0.5], ['Rgb', 'x', 0, 0], ['Oklch', 'x', 0.1, 250]]], [{ x: 0.25 }, { x: 0.75 }]],
  ['a Which of colours', ['Which', ['Less', 'x', 0.5], ['Oklab', 'x', 0, 0.1], 'True', ['Oklch', 'x', 0.1, 250]], [{ x: 0.25 }, { x: 0.75 }]],
  ['a local and a loop', ['Block', ['Declare', 'k', { str: 'unknown' }, ['Oklch', 0, 0, 0]], ['Loop', ['Assign', 'k', ['Oklch', ['Divide', 'i', 10], 0.1, 'x']], ['Element', 'i', ['Range', 1, 10]]], ['AsOklab', 'k']], [{ x: 120 }]],
  ['Oklab of chroma 0 (hue 0, no atan(0, 0))', ['Oklab', 'x', 0, 0], [{ x: 0.5 }]],
  ['AsRgb of Oklab of chroma 0', ['AsRgb', ['Oklab', 'x', 0, 0]], [{ x: 0.5 }]],
  ['AsRgb of a primary', ['AsRgb', ['Rgb', 0, 0, 1]], [{}]],
  ['AsRgb of primaries with a channel at 0', ['AsRgb', ['Rgb', 'x', 0, ['Subtract', 1, 'x']]], [{ x: 0 }, { x: 1 }]],
  ['AsOklab of a primary', ['AsOklab', ['Rgb', 1, 0, 0]], [{}]],
  ['Hsl', ['Hsl', 200, 'x', 0.4], [{ x: 0.3 }]],
  ['Hsv', ['Hsv', 200, 'x', 0.4], [{ x: 0.3 }]],
  ['AsOklab as the last operand of a Block', ['Block', ['Declare', 'k', { str: 'unknown' }, ['Oklch', 'x', 0.1, 250]], ['AsOklab', 'k']], [{ x: 0.4 }]],
  ["Tycho's witness", WITNESS, [{ n: 7, x: 0.5 }, { n: 7, x: 2 }, { n: 1, x: 0.5 }, { n: 3, x: 0.25 }, { n: 0, x: 0.3 }]],
];

// The operators that JavaScript compiles and GLSL declines.
// prettier-ignore
const JS_ONLY: [label: string, json: Json, points: object[]][] = [
  ['AsHsl', ['AsHsl', ['Rgb', 'x', 0.4, 0.6]], [{ x: 0.3 }]],
  ['AsHsv', ['AsHsv', ['Oklch', 'x', 0.1, 250]], [{ x: 0.6 }]],
  ['AsOklab of AsRgb', ['AsOklab', ['AsRgb', ['Oklch', 'x', 0.1, 250]]], [{ x: 0.6 }]],
];

describe('IR profile, colours on JavaScript', () => {
  test.each([...PROGRAMS, ...JS_ONLY].map(([l, j, p]) => [l, j, p] as const))(
    '%s: the interpreter and the existing compiler',
    (_, json, points) => {
      const r = js(json);
      expect(r.success).toBe(true);
      expect(r.profile).toBe('ir');
      const existing = compile(ce.box(json as never), { fallback: false });
      for (const p of points) {
        const v = r.run!(p as never) as unknown as Color;
        const e = existing.run!(p as never) as unknown as Color;
        // The fields a host reads, in the same order.
        expect(Object.keys(v)).toEqual(['space', 'c0', 'c1', 'c2', 'alpha']);
        expect([v.space, v.alpha]).toEqual([e.space, e.alpha]);
        const got = [v.c0, v.c1, v.c2];
        [e.c0, e.c1, e.c2].forEach((x, k) =>
          expect(near(got[k], x, 1e-12)).toBe(true)
        );
        const want = interpreted(json, p, v.space);
        want.forEach((x, k) => {
          if (!near(got[k], x, 1e-12))
            throw new Error(`${JSON.stringify(p)}: ${got} vs ${want}`);
        });
      }
    }
  );

  test('a constructor gives OKLCh, a conversion the space it names', () => {
    expect(js(['Rgb', 'x', 0.4, 0.6]).run!({ x: 0.3 } as never)).toMatchObject({ space: 'oklch' });
    expect(js(['AsRgb', ['Oklch', 'x', 0.1, 250]]).code).toMatch(/_SYS\.asRgb\(_SYS\.oklch\(_\.x, 0\.1, 250\)\)/);
  });

  test('broadcast() gives what the existing compiler gives', () => {
    const json = ['AsOklab', ['Oklch', 'x', 0.1, 250]];
    const r = js(json);
    const existing = compile(ce.box(json as never), { fallback: false });
    expect(r.broadcastOutputs).toBe(existing.broadcastOutputs);
    const inputs = { x: new Float64Array([0.3, 0.6]) };
    expect(r.broadcast!(inputs as never)).toEqual(
      existing.broadcast!(inputs as never)
    );
  });
});

//
// GLSL: the text
//

describe('IR profile, colours on GLSL: the text', () => {
  test.each(PROGRAMS.map(([l, j]) => [l, j] as const))('%s', (_, json) => {
    const r = glsl(json);
    expect(r).toMatchObject({ success: true, profile: 'ir', unsupported: [] });
    // Every function of the preamble is a helper or a user function.
    const defined = [
      ...(r.preamble ?? '').matchAll(/^(?:float|bool|vec3) (\w+)\(/gm),
    ].map((m) => m[1]);
    for (const name of defined) expect(name).toMatch(/^(_gpu_ir_|_fn_ir_)/);
    for (const name of r.freeSymbols!)
      expect(r.freeSymbolTypes![name].lowered).toBe('float');
  });

  test("Tycho's witness with Tycho's options", () => {
    const r = glsl(WITNESS, {
      vars: { x: 'v_pos.x', n: 'u_var_n' },
      inputs: { x: 'real', n: 'real<-10..10>' },
      symbolic: ['t', 'u', 'v'],
      iterationBudget: 1_000_000,
    });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/return _gpu_ir_lab\(\w+\);$/);
    const j = js(WITNESS, {
      inputs: { x: 'real', n: 'real<-10..10>' },
      symbolic: ['t', 'u', 'v'],
      iterationBudget: 1_000_000,
    });
    expect(j.run!({ x: 0.5, n: 7 } as never)).toMatchObject({ space: 'oklab' });
  });
});

//
// GLSL: the values in WebGL2
//

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** The fragment shader of a host that reads the channel `k` of the colour. */
function shader(r: ReturnType<typeof glsl>, k: number): string {
  const inputs = r.freeSymbols!;
  const type = (n: string) => r.freeSymbolTypes![n].lowered;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    ...inputs.map((n) => `uniform ${type(n)} u_${n};`),
    'out vec4 fragColor;',
    r.preamble ?? '',
    `vec3 userFn(${inputs.map((n) => `${type(n)} ${n}`).join(', ')}) {`,
    body,
    '}',
    'void main() {',
    `  fragColor = vec4(userFn(${inputs.map((n) => `u_${n}`).join(', ')})[${k}], 0.0, 0.0, 0.0);`,
    '}',
  ].join('\n');
}

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, colours on GLSL: the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test("each channel of the profile's shader and of the existing target's agrees with the JavaScript value within single-float precision", async () => {
      const items = PROGRAMS.flatMap(([label, json, points]) => {
        const f = js(json);
        const shaders: [string, ReturnType<typeof glsl>][] = [['ir', glsl(json)]];
        try {
          shaders.push(['existing', compile(ce.box(json as never), { to: 'glsl', fallback: false })]);
        } catch {
          // The existing target declines it.
        }
        return shaders.flatMap(([route, r]) =>
          points.flatMap((p) => {
            const v = f.run!(p as never) as unknown as Color;
            return [v.c0, v.c1, v.c2].map((expected, k) => ({
              name: `${route}: ${label} at ${JSON.stringify(p)}, channel ${k}`,
              source: shader(r, k),
              uniforms: Object.fromEntries(
                r.freeSymbols!.map((n) => [`u_${n}`, (p as Record<string, number>)[n]])
              ),
              expected,
            }));
          })
        );
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        // In float32 the round trip of `AsRgb` through OKLab is off by up to
        // 5e-4 near a primary; the existing target has the same error for
        // `AsRgb(Oklab(…))`.
        const tolerance = /: AsRgb/.test(name) ? 1e-3 : 1e-4;
        if (!(Math.abs(v.value - expected) <= tolerance * Math.max(1, Math.abs(expected))))
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBeGreaterThanOrEqual(120);
    }, 120_000);
  }
);

//
// Declines
//

// prettier-ignore
const DECLINES: [label: string, json: Json, targets: ('javascript' | 'glsl')[], cause: RegExp][] = [
  ['AsHsl on GLSL', ['AsHsl', ['Rgb', 'x', 0.4, 0.6]], ['glsl'], /AsHsl/],
  ['AsHsv on GLSL', ['AsHsv', ['Rgb', 'x', 0.4, 0.6]], ['glsl'], /AsHsv/],
  ['a conversion read by a colour operator on GLSL', ['AsOklab', ['AsRgb', ['Oklch', 'x', 0.1, 250]]], ['glsl'], /AsRgb other than as the result/],
  ['a local that holds a conversion and is the result, on GLSL', ['Block', ['Declare', 'k', { str: 'unknown' }, ['AsOklab', ['Oklch', 'x', 0.1, 250]]], 'k'], ['glsl'], /not the result position of the expression/],
  ['a local declared color', ['Block', ['Declare', 'k', { str: 'color' }, ['Oklch', 'x', 0.1, 250]], ['AsOklab', 'k']], ['javascript', 'glsl'], /a local of type color/],
  ['a conversion in an arm on GLSL', ['If', ['Less', 'x', 0], ['AsOklab', ['Oklch', 'x', 0.1, 250]], ['AsOklab', ['Rgb', 'x', 0, 0]]], ['glsl'], /AsOklab other than as the result/],
  ['an alpha', ['Oklch', 'x', 0.1, 250, 0.5], ['javascript', 'glsl'], /Oklch with 4 operands/],
  ['a list of colours on GLSL', ['List', ['Oklch', 'x', 0.1, 250], ['Rgb', 'x', 0, 0]], ['glsl'], /a list of colours/],
  ['a constructor of a list on GLSL', ['Rgb', ['List', 1, 2], 0, 0], ['glsl'], /a list of colours/],
  ['a tuple of components', ['AsOklab', ['Tuple', 'x', 0.2, 0.3]], ['javascript', 'glsl'], /AsOklab of a tuple/],
  ['a colour string', ['AsOklab', { str: 'red' }], ['javascript', 'glsl'], /./],
  ['a colour input', ['AsOklab', 'c'], ['javascript', 'glsl'], /./],
  ['a colour parameter of a user function', ['AsOklab', ['fk', ['fc', 'x']]], ['javascript', 'glsl'], /the parameter q of fk is not a scalar \(color\)/],
  ['a Which with no True clause', ['Which', ['Less', 'x', 0], ['Rgb', 'x', 0, 0], ['Less', 'x', 1], ['Oklch', 'x', 0.1, 250]], ['javascript', 'glsl'], /arms of two types/],
  ['an operator of colours not in the slice', ['ColorMix', ['Rgb', 'x', 0, 0], ['Oklch', 'x', 0.1, 250], 0.5], ['javascript', 'glsl'], /ColorMix/],
];

describe('IR profile, colours: the declines', () => {
  test.each(DECLINES)('%s', (_, json, targets, cause) => {
    for (const to of targets) {
      const d = failure(() => compile(ce.box(json as never), { ...IR, to }));
      expect(d?.code).toBe('outside-profile');
      expect(d?.message).toMatch(cause);
    }
  });

  test('the bigint mode declines the lane', () => {
    const d = failure(() => js(['Oklch', 1, 0, 'n'], { mode: 'bigint' }));
    expect(d?.code).toBe('outside-profile');
    expect(d?.message).toMatch(/a color value: the bigint mode/);
  });
});

//
// Robustness
//

describe('IR profile, colours: robustness', () => {
  test('a shared graph of 2^20 paths feeding a colour compiles in bounded text, on both targets', () => {
    let e: Expression = ce.box('x');
    for (let i = 0; i < 20; i++)
      e = ce.function('Add', [e, ce.function('Sin', [e])]);
    const color = ce.function('AsOklab', [
      ce.function('Oklch', [ce.function('Fract', [e]), ce.number(0.1), e]),
    ]);
    for (const to of ['javascript', 'glsl'] as const) {
      const start = performance.now();
      const r = compile(color, { ...IR, to });
      expect(r.code.length + (r.preamble ?? '').length).toBeLessThan(10_000);
      // A guard against a walk by paths (a hang), not a measure.
      expect(performance.now() - start).toBeLessThan(30_000);
    }
  });

  // A chain of 1,000 nested `If`s overflows the stack in the engine's own
  // `.type`, before any compilation (with real arms too), so the chain of
  // conditionals is a `Which`, which the lowering nests. (Its compilation
  // took 12 to 33 s and gave 6 MB of text before the operation index of
  // `rowOfOp()`, the region memo of `effects()` and the cap on the
  // printer's indentation.)
  test('a chain of 1,000 conditionals compiles, and a chain of 1,000 conversions compiles on JavaScript and declines as too deep on GLSL', () => {
    const x = ce.box('x');
    const base = ce.function('Oklch', [x, ce.number(0.1), ce.number(250)]);
    const clauses: Expression[] = [];
    let conversions: Expression = base;
    for (let i = 0; i < 1_000; i++) {
      clauses.push(
        ce.function('Greater', [x, ce.number(i)]),
        ce.function('Rgb', [x, ce.number(i / 1000), ce.number(0)])
      );
      conversions = ce.function('AsOklch', [conversions]);
    }
    const which = ce.function('AsOklab', [
      ce.function('Which', [...clauses, ce.True, base]),
    ]);
    const chain = ce.function('AsOklab', [conversions]);
    for (const to of ['javascript', 'glsl'] as const) {
      const start = performance.now();
      const r = compile(which, { ...IR, to });
      expect(r.code.length + (r.preamble ?? '').length).toBeLessThan(1_000_000);
      expect(performance.now() - start).toBeLessThan(30_000);
    }
    // The chain of 1,000 conversions is near the depth at which a walk of
    // the pipeline exceeds the call stack, which depends on the host (under
    // Jest it compiles, under tsx it declines): each target gives the value
    // of `AsOklab(Oklch(x, 0.1, 250))` or the decline "too deep".
    const plain = js(['AsOklab', ['Oklch', 'x', 0.1, 250]]).run!({ x: 0.5 } as never);
    // The OKLCh `vec3`, under copies that the printer names (a nest of
    // inlined values is named every 64 levels), then its conversion.
    const GLSL_CHAIN =
      /^(vec3 v\d+ = vec3\(x, 0\.1, 250\.0\);\n(vec3 v\d+ = v\d+;\n)*return )?_gpu_ir_lab\((v\d+|vec3\(x, 0\.1, 250\.0\))\);?$/;
    for (const to of ['javascript', 'glsl'] as const) {
      let r: ReturnType<typeof compile> | undefined;
      const d = failure(() => (r = compile(chain, { ...IR, to })));
      if (d !== undefined) expect(d.message).toMatch(/too deep to compile/);
      else if (to === 'javascript') expect(r!.run!({ x: 0.5 } as never)).toEqual(plain);
      else expect(r!.code).toMatch(GLSL_CHAIN);
    }
    // A chain of 200 conversions compiles on both targets.
    let short: Expression = base;
    for (let i = 0; i < 200; i++) short = ce.function('AsOklch', [short]);
    short = ce.function('AsOklab', [short]);
    expect(compile(short, IR).run!({ x: 0.5 } as never)).toEqual(plain);
    expect(compile(short, { ...IR, to: 'glsl' }).code).toMatch(GLSL_CHAIN);
  });

  test('a colour computed in a loop compiles within the pass bound, and declines over it on GLSL', () => {
    const loop = (n: number) => [
      'Block',
      ['Declare', 'k', { str: 'unknown' }, ['Oklch', 0, 0, 0]],
      ['Loop', ['Assign', 'k', ['Oklch', ['Divide', 'i', n], 0.1, 'x']], ['Element', 'i', ['Range', 1, n]]],
      ['AsOklab', 'k'],
    ];
    expect(glsl(loop(100)).success).toBe(true);
    const d = failure(() => glsl(loop(20_000)));
    expect(d?.code).toBe('outside-profile');
    expect(d?.message).toMatch(/iterationBudget/);
    const r = js(loop(20_000));
    expect(r.run!({ x: 120 } as never)).toMatchObject({ space: 'oklab' });
  });
});
