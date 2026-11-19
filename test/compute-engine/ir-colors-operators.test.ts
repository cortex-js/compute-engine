/**
 * The colour operators of CE-1535 on the profile `ir` (README of
 * `src/compute-engine/compilation/ir/`, "The colour lane"): `Color`,
 * `ColorContrast`, `ColorDelta`, `ContrastingColor`, `GamutMap`, `Colormap`
 * and `ColorToColorspace` on JavaScript, and those of them with a GLSL
 * spelling, `ColorMix`, `AsHsv` and `AsHsl` on GLSL.
 *
 * - JavaScript: each program against the interpreter, within 1e-12 (a
 *   colour read in the space of the compiled value, with `AsOklch`, …).
 * - GLSL: the text runs in WebGL2 (the headless Chromium of
 *   `scripts/glsl-check/glsl-driver.ts`), and each channel agrees with the
 *   JavaScript value within single-float precision. Without the browser,
 *   these tests are skipped.
 * - The declines.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
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
ce.declare('t', 'real<0..1>');

const IR = { profile: 'ir', fallback: false } as const;
const js = (json: Json) => compile(ce.box(json as never), IR);
const glsl = (json: Json) => compile(ce.box(json as never), { ...IR, to: 'glsl' });

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

/** The interpreter's value of `json` at `point`, as the numbers that the
 *  compiled value `got` holds: a number, the elements of a tuple, or the
 *  channels of a colour read in the space of `got`. */
function interpreted(json: Json, point: object, got: unknown): number[] {
  const value = ce
    .box(json as never)
    .subs(point as never)
    .evaluate();
  if (typeof got === 'number') return [value.re];
  if (Array.isArray(got)) {
    if (!isFunction(value, 'Tuple')) throw new Error(`not a tuple: ${value}`);
    return value.ops.map((op) => op.re);
  }
  const space = (got as Color).space;
  const read = ce.box([AS[space], value.json] as never).evaluate();
  if (!isFunction(read)) throw new Error(`not a colour: ${read}`);
  return read.ops.slice(0, 3).map((op) => op.re);
}

/** The numbers of a compiled value (`interpreted()`). */
const numbers = (v: unknown): number[] =>
  typeof v === 'number'
    ? [v]
    : Array.isArray(v)
      ? v
      : [(v as Color).c0, (v as Color).c1, (v as Color).c2];

const near = (a: number, b: number, tolerance: number) =>
  Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));

// The programs that compile on both targets. A colour result is read with
// `AsOklab` (a space with no hue), so that the GLSL value, an OKLCh `vec3`,
// gives the channels of the JavaScript value.
// prettier-ignore
const PROGRAMS: [label: string, json: Json, points: object[]][] = [
  ['Color of a hex string', ['AsOklab', ['Color', { str: '#ff0000' }]], [{}]],
  ['Color of a name', ['AsOklab', ['Color', { str: 'red' }]], [{}]],
  ['Color of an oklch string, outside the sRGB gamut', ['AsOklab', ['Color', { str: 'oklch(0.5 0.3 240)' }]], [{}]],
  ['ColorMix', ['AsOklab', ['ColorMix', ['Rgb', 'x', 0.2, 0.3], ['Oklch', 0.6, 0.1, 250], 'x']], [{ x: 0.25 }, { x: 0.8 }]],
  ['ColorMix with an achromatic colour', ['AsOklab', ['ColorMix', ['Rgb', 1, 0, 0], ['Rgb', 1, 1, 1], 'x']], [{ x: 0.5 }]],
  ['ColorContrast, dark on light', ['ColorContrast', ['Rgb', 1, 1, 1], ['Rgb', 'x', 0.1, 0.2]], [{ x: 0.1 }, { x: 0.5 }]],
  ['ColorContrast, light on dark', ['ColorContrast', ['Oklch', 0.2, 0.05, 250], ['Rgb', 'x', 0.9, 0.9]], [{ x: 0.95 }]],
  ['ColorContrast below the clip', ['ColorContrast', ['Rgb', 0.2, 0.4, 0.6], ['Rgb', 'x', 0.1, 0.3]], [{ x: 0.8 }]],
  ['ColorDelta', ['ColorDelta', ['Rgb', 'x', 0.4, 0.6], ['Oklch', 0.5, 0.1, 30]], [{ x: 0.3 }, { x: 0.9 }]],
  ['ColorDelta of a tuple of channels', ['ColorDelta', ['Tuple', 'x', 0, 0], ['Rgb', 0, 0, 1]], [{ x: 1 }]],
  ['ContrastingColor, white', ['AsOklab', ['ContrastingColor', ['Rgb', 'x', 0.1, 0.2]]], [{ x: 0.1 }]],
  ['ContrastingColor, black', ['AsOklab', ['ContrastingColor', ['Rgb', 'x', 0.9, 0.8]]], [{ x: 0.9 }]],
  ['ContrastingColor of two candidates', ['AsOklab', ['ContrastingColor', ['Rgb', 'x', 0.4, 0.6], ['Oklch', 0.3, 0.1, 30], ['Hsv', 60, 0.3, 0.95]]], [{ x: 0.1 }, { x: 0.9 }]],
  ['GamutMap inside the gamut', ['AsOklab', ['GamutMap', ['Oklch', 0.7, 'x', 30]]], [{ x: 0.05 }]],
  ['GamutMap outside the gamut', ['AsOklab', ['GamutMap', ['Oklch', 0.7, 'x', 30]]], [{ x: 0.3 }]],
  ['GamutMap of an extended sRGB colour', ['AsOklab', ['GamutMap', ['Rgb', 'x', 0.5, -0.2]]], [{ x: 1.1 }]],
  ['GamutMap of a lightness above 1', ['AsOklab', ['GamutMap', ['Oklch', 'x', 0.1, 30]]], [{ x: 1.2 }]],
  ['GamutMap to srgb', ['AsOklab', ['GamutMap', ['Oklch', 0.6, 'x', 150], { str: 'srgb' }]], [{ x: 0.3 }]],
  ['GamutMap to display-p3', ['AsOklab', ['GamutMap', ['Oklch', 0.6, 'x', 150], { str: 'display-p3' }]], [{ x: 0.3 }, { x: 0.15 }]],
  ['ColorToColorspace, rgb', ['ColorToColorspace', ['Oklch', 'x', 0.1, 250], { str: 'rgb' }], [{ x: 0.6 }]],
  ['ColorToColorspace, oklab', ['ColorToColorspace', ['Rgb', 'x', 0.4, 0.6], { str: 'oklab' }], [{ x: 0.3 }]],
  ['ColorToColorspace, lab', ['ColorToColorspace', ['Rgb', 'x', 0.4, 0.6], { str: 'lab' }], [{ x: 0.3 }]],
  ['ColorToColorspace, oklch', ['ColorToColorspace', ['Rgb', 'x', 0.4, 0.6], { str: 'OKLCH' }], [{ x: 0.3 }]],
  ['ColorToColorspace, hsl', ['ColorToColorspace', ['Rgb', 'x', 0.4, 0.6], { str: 'hsl' }], [{ x: 0.3 }, { x: 0.9 }]],
  ['ColorToColorspace, hsv', ['ColorToColorspace', ['Hsv', 200, 'x', 0.7], { str: 'hsv' }], [{ x: 0.5 }]],
  ['ColorToColorspace, hsv of a colour outside the gamut (mapped)', ['ColorToColorspace', ['Oklch', 0.7, 'x', 30], { str: 'hsv' }], [{ x: 0.3 }]],
  ['ColorToColorspace of a tuple of channels', ['ColorToColorspace', ['Tuple', 'x', 0.5, 0.25], { str: 'hsl' }], [{ x: 0.75 }]],
  ['At of ColorToColorspace', ['At', ['ColorToColorspace', ['Rgb', 'x', 0.4, 0.6], { str: 'hsl' }], 3], [{ x: 0.3 }]],
  ['AsHsv', ['AsHsv', ['Rgb', 'x', 0.4, 0.6]], [{ x: 0.3 }, { x: 0.8 }]],
  ['AsHsl', ['AsHsl', ['Oklch', 'x', 0.1, 150]], [{ x: 0.6 }]],
  ['AsHsl of a grey', ['AsHsl', ['Rgb', 'x', 'x', 'x']], [{ x: 0.1 }, { x: 0.5 }, { x: 0.9 }, { x: 1 }]],
  // A conversion of a constructor of its own space keeps its channels, as
  // the interpreter: the hue and the saturation at black, white and grey.
  ['AsHsv of Hsv at black', ['AsHsv', ['Hsv', 'x', 1, 0]], [{ x: 30 }, { x: 400 }, { x: -50 }]],
  ['AsHsv of Hsv of saturation 0', ['AsHsv', ['Hsv', 'x', 0, 0.5]], [{ x: 200 }]],
  ['AsHsv of Hsv, clamped', ['AsHsv', ['Hsv', 'x', 2, -1]], [{ x: 120 }]],
  ['AsHsl of Hsl at white', ['AsHsl', ['Hsl', 'x', 1, 1]], [{ x: 30 }]],
  ['AsHsl of Hsl at black', ['AsHsl', ['Hsl', 'x', 0.5, 0]], [{ x: 250 }]],
  ['AsHsl of Hsl of saturation 0', ['AsHsl', ['Hsl', 'x', 0, 0.4]], [{ x: 90 }]],
];

// The programs that compile on JavaScript only.
// prettier-ignore
const JS_ONLY: [label: string, json: Json, points: object[]][] = [
  ['Color', ['Color', { str: '#336699' }], [{}]],
  ['Colormap of a gradient', ['Colormap', { str: 'viridis' }, 't'], [{ t: 0 }, { t: 0.3 }, { t: 1 }]],
  ['Colormap of a categorical palette', ['Colormap', { str: 'tycho11' }, 't'], [{ t: 0.3 }, { t: 0.96 }]],
  ['Colormap of a diverging palette', ['AsOklab', ['Colormap', { str: 'roma' }, 't']], [{ t: 0.55 }]],
  ['Colormap of a literal position', ['Colormap', { str: 'viridis' }, 0.3], [{}]],
  ['Colormap of a literal integer below 2', ['Colormap', { str: 'viridis' }, 1], [{}]],
  ['ContrastingColor, the space of the candidate', ['ContrastingColor', ['Rgb', 'x', 0.4, 0.6], ['AsHsv', ['Oklch', 0.3, 0.1, 30]], ['Rgb', 0.9, 0.9, 0.8]], [{ x: 0.9 }]],
  ['ContrastingColor, white or black as Rgb', ['ContrastingColor', ['Oklch', 'x', 0.1, 30]], [{ x: 0.2 }, { x: 0.9 }]],
  ['GamutMap is in sRGB', ['GamutMap', ['Oklch', 0.7, 'x', 30]], [{ x: 0.3 }]],
  ['ColorToColorspace of a conversion', ['ColorToColorspace', ['AsHsl', ['Rgb', 'x', 0.4, 0.6]], { str: 'hsv' }], [{ x: 0.3 }]],
];

describe('CE-1535: colour operators on JavaScript', () => {
  test.each([...PROGRAMS, ...JS_ONLY].map(([l, j, p]) => [l, j, p] as const))(
    '%s: the interpreter',
    (_, json, points) => {
      const r = js(json);
      expect(r).toMatchObject({ success: true, profile: 'ir' });
      for (const p of points) {
        const v = r.run!(p as never) as unknown;
        const got = numbers(v);
        const want = interpreted(json, p, v);
        expect(got.length).toBe(want.length);
        want.forEach((x, k) => {
          if (!near(got[k], x, 1e-12))
            throw new Error(`${JSON.stringify(p)}: ${got} vs ${want}`);
        });
      }
    }
  );

  test('a colour value keeps its fields and its space', () => {
    const contrasting = js(['ContrastingColor', ['Oklch', 'x', 0.1, 30]]);
    expect(contrasting.run!({ x: 0.2 } as never)).toEqual({
      space: 'rgb',
      c0: 1,
      c1: 1,
      c2: 1,
      alpha: undefined,
    });
    const v = js(['GamutMap', ['Oklch', 0.7, 'x', 30]]).run!({
      x: 0.3,
    } as never) as unknown as Color;
    expect(Object.keys(v)).toEqual(['space', 'c0', 'c1', 'c2', 'alpha']);
    expect(v.space).toBe('rgb');
  });

  test('a colour of non-finite channels, or a position that is not finite, gives NaN', () => {
    // The interpreter gives an error (`incompatible-type`, `expected-value`).
    const nan = [NaN, NaN, NaN];
    const colormap = js(['Colormap', { str: 'viridis' }, 't']);
    expect(numbers(colormap.run!({ t: NaN } as never))).toEqual(nan);
    const contrasting = js(['ContrastingColor', ['Oklch', 'x', 0.1, 30], ['Rgb', 1, 1, 1], ['Rgb', 0, 0, 0]]);
    expect(numbers(contrasting.run!({ x: NaN } as never))).toEqual(nan);
    const bw = js(['ContrastingColor', ['Oklch', 'x', 0.1, 30]]);
    expect(numbers(bw.run!({ x: NaN } as never))).toEqual(nan);
    for (const json of [
      ['ColorContrast', ['Rgb', 'x', 0, 0], ['Rgb', 1, 1, 1]],
      ['ColorDelta', ['Rgb', 'x', 0, 0], ['Rgb', 1, 1, 1]],
    ])
      expect(js(json).run!({ x: NaN } as never)).toBeNaN();
    expect(
      numbers(js(['GamutMap', ['Oklch', 'x', 0.1, 30]]).run!({ x: NaN } as never))
    ).toEqual(nan);
    expect(
      js(['ColorToColorspace', ['Rgb', 'x', 0, 0], { str: 'hsl' }]).run!({
        x: NaN,
      } as never)
    ).toEqual(nan);
  });

  test('a constant colour operation is computed once', () => {
    const r = js(['ColorContrast', ['Rgb', 1, 1, 1], ['Color', { str: 'blue' }]]);
    expect(r.run!({} as never)).toBe(
      ce.box(['ColorContrast', ['Rgb', 1, 1, 1], ['Color', { str: 'blue' }]] as never).evaluate().re
    );
  });
});

//
// GLSL
//

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** The fragment shader of a host that reads the element `k` of the value
 *  (the value itself for a `float`, `scalar`). */
function shader(r: ReturnType<typeof glsl>, k: number, scalar: boolean): string {
  const inputs = r.freeSymbols!;
  const type = (n: string) => r.freeSymbolTypes![n].lowered;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  const result = scalar ? 'float' : 'vec3';
  const call = `userFn(${inputs.map((n) => `u_${n}`).join(', ')})`;
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    ...inputs.map((n) => `uniform ${type(n)} u_${n};`),
    'out vec4 fragColor;',
    r.preamble ?? '',
    `${result} userFn(${inputs.map((n) => `${type(n)} ${n}`).join(', ')}) {`,
    body,
    '}',
    'void main() {',
    `  fragColor = vec4(${result === 'float' ? call : `${call}[${k}]`}, 0.0, 0.0, 0.0);`,
    '}',
  ].join('\n');
}

describe('CE-1535: colour operators on GLSL, the text', () => {
  test.each(PROGRAMS.map(([l, j]) => [l, j] as const))('%s', (_, json) => {
    const r = glsl(json);
    expect(r).toMatchObject({ success: true, profile: 'ir', unsupported: [] });
    const defined = [
      ...(r.preamble ?? '').matchAll(/^(?:float|bool|vec3) (\w+)\(/gm),
    ].map((m) => m[1]);
    for (const name of defined) expect(name).toMatch(/^_gpu_ir_/);
  });
});

(chromiumAvailable() ? describe : describe.skip)(
  'CE-1535: colour operators on GLSL, the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('each channel agrees with the JavaScript value within single-float precision', async () => {
      const items = PROGRAMS.flatMap(([label, json, points]) => {
        const f = js(json);
        const r = glsl(json);
        return points.flatMap((p) => {
          const v = f.run!(p as never) as unknown;
          return numbers(v).map((expected, k) => ({
            name: `${label} at ${JSON.stringify(p)}, element ${k}`,
            source: shader(r, k, typeof v === 'number'),
            uniforms: Object.fromEntries(
              r.freeSymbols!.map((n) => [`u_${n}`, (p as Record<string, number>)[n]])
            ),
            expected,
          }));
        });
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        // The gamut mapping searches the chroma to 1e-4, and the float32
        // round trip through OKLab is off by up to 5e-4 near a primary.
        if (!(Math.abs(v.value - expected) <= 2e-3 * Math.max(1, Math.abs(expected))))
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBeGreaterThanOrEqual(90);
    }, 120_000);
  }
);

//
// Declines
//

// prettier-ignore
const DECLINES: [label: string, json: Json, targets: ('javascript' | 'glsl')[], cause: RegExp, code?: string][] = [
  ['ColorToString (a string value)', ['ColorToString', ['Rgb', 'x', 0.4, 0.6]], ['javascript', 'glsl'], /ColorToString/],
  ['Color of a string that is not a colour', ['Color', { str: 'nosuchcolor' }], ['javascript', 'glsl'], /Color of an operand that is not a literal colour string/],
  ['Color of a colour with an alpha', ['Color', { str: '#ff000080' }], ['javascript', 'glsl'], /Color of a colour string with an alpha/],
  ['Colormap of a real position', ['Colormap', { str: 'viridis' }, 'x'], ['javascript', 'glsl'], /Colormap of a position that can be an integer of 2 or more/, 'unsettled-shape'],
  ['Colormap of a literal integer of 2 or more', ['Colormap', { str: 'viridis' }, 5], ['javascript', 'glsl'], /Colormap of a position that can be an integer of 2 or more/, 'unsettled-shape'],
  ['Colormap of an unknown palette', ['Colormap', { str: 'nosuchpalette' }, 't'], ['javascript', 'glsl'], /Colormap of a name that is not a literal palette name/],
  ['Colormap of no position', ['Colormap', { str: 'viridis' }], ['javascript', 'glsl'], /Colormap of a name that is not a literal palette name, or with no position/],
  ['Colormap on GLSL', ['Colormap', { str: 'viridis' }, 't'], ['glsl'], /Colormap \(the operation colormap\) on glsl/],
  ['GamutMap of an unknown gamut', ['GamutMap', ['Rgb', 'x', 0, 0], { str: 'rec2020' }], ['javascript', 'glsl'], /GamutMap of a gamut that is not the literal/],
  ['ColorToColorspace of an unknown space', ['ColorToColorspace', ['Rgb', 'x', 0, 0], { str: 'cmyk' }], ['javascript', 'glsl'], /ColorToColorspace of a space that is not a literal colour space name/],
  ['ContrastingColor of two operands', ['ContrastingColor', ['Rgb', 'x', 0, 0], ['Rgb', 1, 1, 1]], ['javascript', 'glsl'], /ContrastingColor with 2 operands/],
  ['ColorContrast of a tuple with an alpha', ['ColorContrast', ['Tuple', 1, 0, 0, 0.5], ['Rgb', 'x', 0, 0]], ['javascript', 'glsl'], /ColorContrast of a tuple that is not three real numbers/],
  ['AsHsv other than as the result on GLSL', ['AsOklab', ['AsHsv', ['Rgb', 'x', 0.4, 0.6]]], ['glsl'], /AsHsv other than as the result/],
  ['AsHsl in a local that is the result on GLSL', ['Block', ['Declare', 'k', { str: 'unknown' }, ['AsHsl', ['Oklch', 'x', 0.1, 250]]], 'k'], ['glsl'], /not the result position of the expression/],
];

describe('CE-1535: colour operators, the declines', () => {
  test.each(DECLINES.map(([l, ...rest]) => [l, rest] as const))('%s', (_, [json, targets, cause, code]) => {
    for (const to of targets) {
      const d = failure(() => compile(ce.box(json as never), { ...IR, to }));
      expect(d?.code).toBe(code ?? 'outside-profile');
      expect(d?.message).toMatch(cause);
    }
  });
});
