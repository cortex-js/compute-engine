/**
 * A color channel that is not a finite number, on the interpreter and on the
 * `javascript` target. The two routes read the channels by the same rule
 * (`readColorChannels`, `src/compute-engine/numerics/color-conversion.ts`),
 * from the user decision on out-of-range color channels:
 *
 * - HSV saturation and value and HSL saturation and lightness are CLAMPED
 *   into [0, 1], an infinite one included: `+oo` reads as 1 and `-oo` as 0.
 *   HSV and HSL describe only the sRGB gamut. So `AsRgb(Hsv(30, +oo, 3.14))`
 *   is `Rgb(1, 0.5, 0)` (Tycho request 309).
 * - An `Rgb` channel is extended sRGB: a finite channel outside [0, 1] is
 *   kept, and an infinite one is an error. OKLab/OKLCh channels have no
 *   bound, so an infinite one is an error too.
 * - A `NaN` channel, or an infinite channel that is not clamped (an sRGB
 *   channel, a hue, an OKLab/OKLCh channel), is `incompatible-type` on the
 *   interpreter and the `NaN` COLOR — a color value whose three channels are
 *   `NaN` — on the compiled route.
 *
 * Tycho item 243 required that the two routes agree: the compiled `_SYS.hsv`
 * clamped an infinite value while the interpreter refused it. They still
 * agree, now on the clamped color.
 *
 * `1/0` parses as `ComplexInfinity`, whose real part is `+oo`, and the
 * `javascript` target represents it as `Infinity`. So in a clamped channel it
 * reads as 1 on both routes, like `+oo`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

function run(latex: string): unknown {
  const r = compile(ce.parse(latex), { to: 'javascript' });
  expect(r.success).toBe(true);
  return r.run!();
}

/** The channels of a compiled color value. */
function channels(value: unknown): number[] {
  const c = value as { c0: number; c1: number; c2: number };
  return [c.c0, c.c1, c.c2];
}

/** The channels of an interpreted color head. */
function interpretedChannels(latex: string): number[] {
  const e = ce.parse(latex).evaluate();
  expect(e.operator).not.toBe('Error');
  return e.ops!.slice(0, 3).map((op) => op.re);
}

function expectChannelsClose(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(3);
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], 9);
}

/** The non-finite color in a named space: the same five-key color value every
 * other color has, with `NaN` channels. A conversion answers it in the space it
 * names, so `AsHsv` of a non-finite color is the `hsv` one. */
function nanColor(space: string, alpha?: number): unknown {
  return { space, c0: NaN, c1: NaN, c2: NaN, alpha };
}

const NAN_OKLCH = nanColor('oklch');

describe('an infinite HSV or HSL channel reads as its bound', () => {
  test.each([
    [
      'infinite value',
      '\\operatorname{Hsv}(90,1,\\infty)',
      '\\operatorname{Hsv}(90,1,1)',
    ],
    [
      'negative infinite value',
      '\\operatorname{Hsv}(90,1,-\\infty)',
      '\\operatorname{Hsv}(90,1,0)',
    ],
    [
      'infinite saturation',
      '\\operatorname{Hsv}(90,\\infty,1)',
      '\\operatorname{Hsv}(90,1,1)',
    ],
    [
      'negative infinite saturation',
      '\\operatorname{Hsv}(90,-\\infty,1)',
      '\\operatorname{Hsv}(90,0,1)',
    ],
    [
      '1/0 value',
      '\\operatorname{Hsv}(90,1,1/0)',
      '\\operatorname{Hsv}(90,1,1)',
    ],
    [
      'Hsl infinite lightness',
      '\\operatorname{Hsl}(90,1,\\infty)',
      '\\operatorname{Hsl}(90,1,1)',
    ],
    [
      'Hsl infinite saturation',
      '\\operatorname{Hsl}(90,\\infty,0.5)',
      '\\operatorname{Hsl}(90,1,0.5)',
    ],
    [
      'Hsl negative infinite lightness',
      '\\operatorname{Hsl}(90,1,-\\infty)',
      '\\operatorname{Hsl}(90,1,0)',
    ],
  ])('%s', (_label, latex, bound) => {
    // The compiled constructor answers the color of the bound…
    expect(run(latex)).toEqual(run(bound));
    // …the interpreter converts it to the color of the bound…
    for (const head of ['AsRgb', 'AsHsv', 'AsHsl', 'AsOklch']) {
      expect(
        String(ce.parse(`\\operatorname{${head}}(${latex})`).evaluate())
      ).toBe(String(ce.parse(`\\operatorname{${head}}(${bound})`).evaluate()));
    }
    // …and the two routes agree.
    expectChannelsClose(
      channels(run(`\\operatorname{AsRgb}(${latex})`)),
      interpretedChannels(`\\operatorname{AsRgb}(${latex})`)
    );
  });

  test('the colors of Tycho request 309', () => {
    for (const latex of [
      '\\operatorname{AsRgb}(\\operatorname{Hsv}(30,\\infty,3.14))',
      '\\operatorname{AsRgb}(\\operatorname{Hsv}(30,1,\\infty))',
    ]) {
      expect(String(ce.parse(latex).evaluate())).toBe('Rgb(1, 0.5, 0)');
      expectChannelsClose(channels(run(latex)), [1, 0.5, 0]);
    }
  });

  test('the same-space conversion answers the bound', () => {
    expect(
      String(
        ce
          .parse('\\operatorname{AsHsv}(\\operatorname{Hsv}(30,\\infty,1))')
          .evaluate()
      )
    ).toBe('Hsv(30, 1, 1)');
    // A finite out-of-range saturation is clamped by a same-space
    // conversion too, on both routes.
    const latex = '\\operatorname{AsHsv}(\\operatorname{Hsv}(30,2,1))';
    expect(String(ce.parse(latex).evaluate())).toBe('Hsv(30, 1, 1)');
    expectChannelsClose(channels(run(latex)), [30, 1, 1]);
  });

  test('keeps the alpha slot', () => {
    expect(run('\\operatorname{Hsv}(90,1,\\infty,0.5)')).toEqual(
      run('\\operatorname{Hsv}(90,1,1,0.5)')
    );
  });
});

describe('a channel without a limit color', () => {
  test.each([
    ['infinite hue', '\\operatorname{Hsv}(\\infty,1,1)'],
    ['1/0 hue', '\\operatorname{Hsv}(1/0,1,1)'],
    ['Hsl infinite hue', '\\operatorname{Hsl}(-\\infty,1,0.5)'],
    ['NaN value', '\\operatorname{Hsv}(90,1,0/0)'],
    ['NaN Rgb channel', '\\operatorname{Rgb}(0/0,0,0)'],
    ['Rgb infinite channel', '\\operatorname{Rgb}(\\infty,0.5,0)'],
    ['Rgb negative infinite channel', '\\operatorname{Rgb}(1,-\\infty,0)'],
    ['Rgb 1/0 channel', '\\operatorname{Rgb}(1/0,0,0)'],
    ['Oklab infinite lightness', '\\operatorname{Oklab}(\\infty,0.1,0)'],
    [
      'Oklch negative infinite lightness',
      '\\operatorname{Oklch}(-\\infty,0.1,90)',
    ],
    ['Oklab infinite a', '\\operatorname{Oklab}(0.5,\\infty,0)'],
    ['Oklab infinite b', '\\operatorname{Oklab}(0.5,0,-\\infty)'],
    ['Oklch infinite chroma', '\\operatorname{Oklch}(0.5,\\infty,90)'],
    ['Oklch infinite hue', '\\operatorname{Oklch}(0.5,0.1,\\infty)'],
  ])('%s is the NaN color, and the interpreter rejects it', (_label, latex) => {
    expect(run(latex)).toEqual(NAN_OKLCH);
    expect(String(ce.parse(`\\operatorname{AsRgb}(${latex})`).evaluate())).toBe(
      'Error("incompatible-type")'
    );
  });

  test('keeps the alpha slot', () => {
    expect(run('\\operatorname{Hsv}(\\infty,1,1,0.5)')).toEqual(
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
      // `rgb255ToHsv` and `rgb255ToHsl` read the hue off `max`/`min`
      // comparisons, and every comparison with `NaN` is false, so without a
      // guard `_SYS.asHsv` answered a hue of zero — red — where the other
      // four conversions answered the NaN channels. The guard is explicit in
      // both helpers. Each conversion tags the result with the space it
      // names, so the NaN color of `AsHsv` is an `hsv` color.
      expect(
        run(`\\operatorname{${head}}(\\operatorname{Hsv}(\\infty,1,1))`)
      ).toEqual(nanColor(space));
    }
  );

  test('a conversion of a non-finite color keeps the alpha slot', () => {
    expect(
      run('\\operatorname{AsHsv}(\\operatorname{Hsv}(\\infty,1,1,0.5))')
    ).toEqual(nanColor('hsv', 0.5));
  });
});

describe('a free variable bound at run time', () => {
  test('an infinite value reads as its bound', () => {
    const r = compile(ce.parse('\\operatorname{Hsv}(90,1,v)'), {
      to: 'javascript',
    });
    expect(r.run!({ v: Infinity })).toEqual(r.run!({ v: 1 }));
    expect(r.run!({ v: -Infinity })).toEqual(r.run!({ v: 0 }));
    expect(r.run!({ v: NaN })).toEqual(NAN_OKLCH);
    expect(r.run!({ v: 1 })).toEqual(r.run!({ v: 2 }));
  });

  test('an infinite sRGB channel is the NaN color', () => {
    const r = compile(ce.parse('\\operatorname{Rgb}(v,0,0)'), {
      to: 'javascript',
    });
    expect(r.run!({ v: Infinity })).toEqual(NAN_OKLCH);
    expect(r.run!({ v: -Infinity })).toEqual(NAN_OKLCH);
    // A finite channel outside [0, 1] is extended sRGB, not an error.
    expect(channels(r.run!({ v: 2 })).every(Number.isFinite)).toBe(true);
  });

  test('an infinite hue is the NaN color', () => {
    const r = compile(ce.parse('\\operatorname{Hsv}(h,1,1)'), {
      to: 'javascript',
    });
    expect(r.run!({ h: Infinity })).toEqual(NAN_OKLCH);
    expect(r.run!({ h: -Infinity })).toEqual(NAN_OKLCH);
  });
});

describe('finite channels', () => {
  test('an out-of-range HSV value clamps on both routes', () => {
    expect(run('\\operatorname{AsRgb}(\\operatorname{Hsv}(90,1,2))')).toEqual(
      run('\\operatorname{AsRgb}(\\operatorname{Hsv}(90,1,1))')
    );
    expect(
      String(
        ce
          .parse('\\operatorname{AsRgb}(\\operatorname{Hsv}(90,1,2))')
          .evaluate()
      )
    ).toBe('Rgb(0.5, 1, 0)');
  });

  test('an out-of-range Rgb channel is kept on both routes', () => {
    const latex = '\\operatorname{AsRgb}(\\operatorname{Rgb}(2,-0.5,0))';
    expect(String(ce.parse(latex).evaluate())).toBe('Rgb(2, -0.5, 0)');
    expectChannelsClose(channels(run(latex)), [2, -0.5, 0]);
  });

  test('a non-finite alpha is opaque', () => {
    expect(run('\\operatorname{Hsv}(90,1,1,1/0)')).toEqual(
      run('\\operatorname{Hsv}(90,1,1)')
    );
  });
});
