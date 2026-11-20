/**
 * `AsHsv` and `AsHsl` of a colour of their own space on the profile `ir`
 * (README of `src/compute-engine/compilation/ir/`, "The colour lane"). The
 * interpreter answers such a colour unchanged, which the round trip through
 * OKLCh loses at black and at grey: a name whose value is `Hsv(270, 1, 0)`
 * keeps the hue 270. A colour that can be of the own space at run time and
 * is not one at compile time (an `If`, a user function, a `ContrastingColor`
 * of candidates) declines.
 *
 * - JavaScript: each program against the interpreter, within 1e-12.
 * - GLSL: the shader runs in WebGL2 (the headless Chromium of
 *   `scripts/glsl-check/glsl-driver.ts`), and each channel agrees with the
 *   interpreter within single-float precision. Without the browser, these
 *   tests are skipped.
 * - The declines, on both targets.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Color = { space: string; c0: number; c1: number; c2: number };

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.assign('C', ce.box(['Hsv', 270, 1, 0]));
ce.assign('L', ce.box(['Hsl', 250, 0.5, 0]));
// A value with a channel that is a name: that expression where it is read.
const VALUES: Record<string, Json> = {
  Cy: ['Hsv', 'y', 1, 0],
  Ly: ['Hsl', 'y', 0, 0.4],
};
for (const [name, v] of Object.entries(VALUES))
  ce.assign(name, ce.box(v as never));
ce.assign(
  'f',
  ce.box(['Function', ['Hsv', ['Multiply', 270, 'q'], 1, 0], 'q'])
);

const IR = { profile: 'ir', fallback: false } as const;
const js = (json: Json) => compile(ce.box(json as never), IR);
const glsl = (json: Json) =>
  compile(ce.box(json as never), { ...IR, to: 'glsl' });

/** The diagnostic of a compilation that throws, or `undefined`. */
function failure(
  f: () => unknown
): { code: string; message: string } | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { code: string; message: string } }).diagnostic;
  }
  return undefined;
}

/** `json` with each name of `VALUES` replaced by its value and each input
 *  by its number at `point`: the interpreter reads a name of `VALUES` with
 *  the number of the input, which `subs()` does not put in the value. */
function at(json: Json, point: Record<string, number>): Json {
  if (typeof json === 'string')
    return json in point
      ? point[json]
      : json in VALUES
        ? at(VALUES[json], point)
        : json;
  return Array.isArray(json) ? json.map((x) => at(x, point)) : json;
}

/** The channels of the interpreter's colour of `json` at `point`. */
function interpreted(json: Json, point: object): number[] {
  const value = ce
    .box(at(json, point as Record<string, number>) as never)
    .evaluate();
  if (!isFunction(value)) throw new Error(`not a colour: ${value}`);
  return value.ops.slice(0, 3).map((op) => op.re);
}

const POINTS = [{ y: 270 }, { y: 400 }, { y: -30 }];

const PROGRAMS: [string, Json, object[]][] = [
  ['AsHsv of a name whose value is Hsv at black', ['AsHsv', 'C'], [{}]],
  ['AsHsl of a name whose value is Hsl at black', ['AsHsl', 'L'], [{}]],
  ['AsHsv of a name whose value is Hsv of a name', ['AsHsv', 'Cy'], POINTS],
  ['AsHsl of a name whose value is Hsl of a name', ['AsHsl', 'Ly'], POINTS],
  [
    'AsHsv of AsHsv of Hsv at black',
    ['AsHsv', ['AsHsv', ['Hsv', 'y', 1, 0]]],
    POINTS,
  ],
  ['AsHsl of AsHsl of a name', ['AsHsl', ['AsHsl', 'Ly']], POINTS],
  // A colour of another space converts, as the interpreter.
  ['AsHsv of a name whose value is Hsl', ['AsHsv', 'L'], [{}]],
  ['AsHsl of a name whose value is Hsv', ['AsHsl', 'Cy'], POINTS],
  [
    'AsHsv of AsOklch of Hsv at black',
    ['AsHsv', ['AsOklch', ['Hsv', 'y', 1, 0]]],
    POINTS,
  ],
  [
    'AsHsv of a mix',
    ['AsHsv', ['ColorMix', ['Rgb', 'x', 0.4, 0.6], ['Hsv', 'y', 0.5, 0.5]]],
    [{ x: 0.3, y: 120 }],
  ],
  [
    'AsHsl of a gamut map',
    ['AsHsl', ['GamutMap', ['Oklch', 0.7, 'x', 120]]],
    [{ x: 0.3 }],
  ],
];

const near = (a: number, b: number, tolerance: number) =>
  Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));

describe('AsHsv and AsHsl of a colour of their own space on JavaScript', () => {
  test.each(PROGRAMS)('%s', (_, json, points) => {
    const f = js(json);
    for (const p of points) {
      const v = f.run!(p as never) as unknown as Color;
      const got = [v.c0, v.c1, v.c2];
      const want = interpreted(json, p);
      want.forEach((x, k) => {
        if (!near(got[k], x, 1e-12))
          throw new Error(`${JSON.stringify(p)}: ${got} vs ${want}`);
      });
    }
  });

  test('the witnesses keep the hue and the saturation', () => {
    expect(js(['AsHsv', 'C']).run!({} as never)).toMatchObject({
      space: 'hsv',
      c0: 270,
      c1: 1,
      c2: 0,
    });
    expect(js(['AsHsl', 'L']).run!({} as never)).toMatchObject({
      space: 'hsl',
      c0: 250,
      c1: 0.5,
      c2: 0,
    });
  });

  // A constructor that threads over a list is a list of colours of its
  // space (glsl declines a list of colours).
  test.each([
    [
      'AsHsv of Hsv of a list at black',
      ['AsHsv', ['Hsv', ['List', 270, 90], 1, 0]],
    ],
    [
      'AsHsl of Hsl of a list at black',
      ['AsHsl', ['Hsl', ['List', 'y', 270], 0.5, 0]],
    ],
    [
      'AsHsv of Rgb of a list',
      ['AsHsv', ['Rgb', ['List', 0.1, 0.5], 0.2, 0.3]],
    ],
    [
      'AsHsv of a list of colours, each of its own space',
      ['AsHsv', ['List', ['Hsv', 270, 1, 0], ['Hsv', 'y', 1, 0], 'C']],
    ],
    [
      'AsHsl of a list of colours of several spaces',
      ['AsHsl', ['List', 'L', ['Hsv', 270, 1, 0], ['Rgb', 0.2, 'y', 0]]],
    ],
  ] as [string, Json][])('%s', (_, json) => {
    const p = { y: 30 };
    const got = js(json).run!(p as never) as unknown as Color[];
    const value = ce.box(at(json, p) as never).evaluate();
    if (!isFunction(value, 'List')) throw new Error(`not a list: ${value}`);
    expect(got.length).toBe(value.nops);
    value.ops.forEach((c, n) => {
      const want = (c as unknown as { ops: { re: number }[] }).ops
        .slice(0, 3)
        .map((op) => op.re);
      const g = [got[n].c0, got[n].c1, got[n].c2];
      want.forEach((x, k) => {
        if (!near(g[k], x, 1e-12)) throw new Error(`${g} vs ${want}`);
      });
    });
  });

  test('an effectful operand is lowered once: the seeded draw is the interpreter’s', () => {
    const json = [
      'WithRandomSeed',
      7,
      ['AsHsv', ['Tuple', ['Random'], 'x', 0.6]],
    ];
    const got = js(json).run!({ x: 0.3 } as never) as unknown as Color;
    const want = interpreted(json, { x: 0.3 });
    [got.c0, got.c1, got.c2].forEach((g, k) =>
      expect(near(g, want[k], 1e-12)).toBe(true)
    );
  });
});

const DECLINES: [string, Json][] = [
  [
    'AsHsv of a list of colours with an If',
    [
      'AsHsv',
      [
        'List',
        ['Hsv', 270, 1, 0],
        ['If', ['Greater', 'x', 0], 'C', ['Rgb', 1, 0, 0]],
      ],
    ],
  ],
  [
    'AsHsv of an If with an Hsv arm',
    [
      'AsHsv',
      ['If', ['Greater', 'x', 0], ['Hsv', 270, 1, 0], ['Rgb', 1, 0, 0]],
    ],
  ],
  [
    'AsHsl of an If with an Hsl arm',
    ['AsHsl', ['If', ['Greater', 'x', 0], 'L', ['Rgb', 1, 0, 0]]],
  ],
  ['AsHsv of a user function whose value is Hsv', ['AsHsv', ['f', 'x']]],
  [
    'AsHsv of ContrastingColor of an Hsv candidate',
    [
      'AsHsv',
      [
        'ContrastingColor',
        ['Rgb', 'x', 1, 1],
        ['Hsv', 270, 1, 0],
        ['Rgb', 0.9, 0.9, 0.9],
      ],
    ],
  ],
];

describe('AsHsv and AsHsl of a colour that can be of their space at run time', () => {
  test.each(DECLINES)('%s declines on JavaScript and GLSL', (_, json) => {
    for (const target of [js, glsl]) {
      const d = failure(() => target(json));
      expect(d?.code).toBe('outside-profile');
      expect(d?.message).toMatch(/can be an Hs[vl] colour at run time/);
    }
  });

  test('the interpreter keeps the arm of the If', () => {
    expect(interpreted(DECLINES[1][1], { x: 1 })).toEqual([270, 1, 0]);
  });
});

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
  'AsHsv and AsHsl of a colour of their own space on GLSL, in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('each channel agrees with the interpreter within single-float precision', async () => {
      // The programs of an own-space colour, which keep its channels.
      const programs = PROGRAMS.slice(0, 6);
      const items = programs.flatMap(([label, json, points]) => {
        const r = glsl(json);
        return points.flatMap((p) =>
          interpreted(json, p).map((expected, k) => ({
            name: `${label} at ${JSON.stringify(p)}, channel ${k}`,
            source: shader(r, k),
            uniforms: Object.fromEntries(
              r.freeSymbols!.map((n) => [
                `u_${n}`,
                (p as Record<string, number>)[n],
              ])
            ),
            expected,
          }))
        );
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        if (
          !(
            Math.abs(v.value - expected) <=
            1e-4 * Math.max(1, Math.abs(expected))
          )
        )
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBe(42);
    }, 180_000);
  }
);
