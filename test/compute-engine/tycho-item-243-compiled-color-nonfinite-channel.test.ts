/**
 * A compiled color constructor with a NON-FINITE channel answers the `NaN`
 * COLOR — a color value whose three channels are `NaN` — as the interpreter's
 * `incompatible-type` rejection projects.
 *
 * The `javascript` target represents `~oo` as `Infinity`, and the sRGB
 * conversion inside `_SYS.hsv` clamped an infinite saturation or value into
 * `[0, 1]`: `Hsv(90, 1, ~oo)` compiled to the same finite color as
 * `Hsv(90, 1, 1)` while `AsRgb(Hsv(90, 1, +oo))` evaluates to an error (Tycho
 * item 243). A finite out-of-range channel still clamps on both routes, and a
 * non-finite alpha reads as opaque on both.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

function run(latex: string): unknown {
  const r = compile(ce.parse(latex), { to: 'javascript' });
  expect(r.success).toBe(true);
  return r.run!();
}

/** The non-finite color in a named space: the same five-key color value every
 * other color has, with `NaN` channels. A conversion answers it in the space it
 * names, so `AsHsv` of a non-finite color is the `hsv` one. */
function nanColor(space: string, alpha?: number): unknown {
  return { space, c0: NaN, c1: NaN, c2: NaN, alpha };
}

const NAN_OKLCH = nanColor('oklch');

describe('a non-finite channel', () => {
  test.each([
    ['infinite value', '\\operatorname{Hsv}(90,1,1/0)'],
    ['infinite saturation', '\\operatorname{Hsv}(90,1/0,1)'],
    ['infinite hue', '\\operatorname{Hsv}(1/0,1,1)'],
    ['NaN value', '\\operatorname{Hsv}(90,1,0/0)'],
    ['Hsl infinite lightness', '\\operatorname{Hsl}(90,1,1/0)'],
    ['Rgb infinite channel', '\\operatorname{Rgb}(1/0,0,0)'],
    ['Oklab infinite a', '\\operatorname{Oklab}(0.5,1/0,0)'],
    ['Oklch infinite chroma', '\\operatorname{Oklch}(0.5,1/0,90)'],
  ])('%s is the NaN color, and the interpreter rejects it', (_label, latex) => {
    expect(run(latex)).toEqual(NAN_OKLCH);
    expect(String(ce.parse(`\\operatorname{AsRgb}(${latex})`).evaluate())).toBe(
      'Error("incompatible-type")'
    );
  });

  test('keeps the alpha slot', () => {
    expect(run('\\operatorname{Hsv}(90,1,1/0,0.5)')).toEqual(
      nanColor('oklch', 0.5)
    );
  });

  test.each([
    ['AsRgb', 'rgb'],
    ['AsHsv', 'hsv'],
    ['AsHsl', 'hsl'],
    ['AsOklab', 'oklab'],
    ['AsOklch', 'oklch'],
  ])(
    'every conversion of a non-finite color answers the NaN color (%s)',
    (head, space) => {
      // `rgbToHsv` and `rgbToHsl` read the hue off `max`/`min` comparisons,
      // and every comparison with `NaN` is false, so `_SYS.asHsv` answered
      // `[0, NaN, NaN]` — a hue of zero, which is red — where the other four
      // conversions answered the NaN channels. The guard is now explicit in
      // both helpers. Each conversion tags the result with the space it
      // names, so the NaN color of `AsHsv` is an `hsv` color.
      expect(
        run(`\\operatorname{${head}}(\\operatorname{Hsv}(90,1,1/0))`)
      ).toEqual(nanColor(space));
    }
  );

  test('a conversion of a non-finite color keeps the alpha slot', () => {
    expect(
      run('\\operatorname{AsHsv}(\\operatorname{Hsv}(90,1,1/0,0.5))')
    ).toEqual(nanColor('hsv', 0.5));
  });

  test('a free variable bound to Infinity at run time', () => {
    const r = compile(ce.parse('\\operatorname{Hsv}(90,1,v)'), { to: 'javascript' });
    expect(r.run!({ v: Infinity })).toEqual(NAN_OKLCH);
    expect(r.run!({ v: 1 })).toEqual(r.run!({ v: 2 }));
  });
});

describe('finite channels are unchanged', () => {
  test('an out-of-range value clamps on both routes', () => {
    expect(run('\\operatorname{AsRgb}(\\operatorname{Hsv}(90,1,2))')).toEqual(
      run('\\operatorname{AsRgb}(\\operatorname{Hsv}(90,1,1))')
    );
    expect(String(ce.parse('\\operatorname{AsRgb}(\\operatorname{Hsv}(90,1,2))').evaluate())).toBe(
      'Rgb(0.5, 1, 0)'
    );
  });

  test('a non-finite alpha is opaque', () => {
    expect(run('\\operatorname{Hsv}(90,1,1,1/0)')).toEqual(run('\\operatorname{Hsv}(90,1,1)'));
  });
});
