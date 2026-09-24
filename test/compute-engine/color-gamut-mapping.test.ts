import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  deltaEOK,
  gamutMapOklch,
  gamutMapSrgb,
  gamutToSrgb,
  inGamut,
} from '../../src/compute-engine/numerics/color-conversion';
import { rgbToOklch } from '@arnog/colors';

// Color values have no gamut: `Rgb` is extended sRGB and OKLab/OKLCh have no
// bound, so the conversions never clamp. A color is mapped into a gamut only
// at output (`GamutMap`, `ColorToString`, and the conversion to HSV or HSL,
// which describe only the sRGB gamut), with the CSS Color 4 gamut mapping:
// the OKLCh chroma is reduced at constant lightness and hue. Clipping each
// channel on its own is not gamut mapping: it changes the hue.
//
// The reference values below were checked against colorjs.io 0.5
// (`toGamut({ method: 'css' })`), an independent implementation of the same
// algorithm, to 6 decimals.

const ce = new ComputeEngine();

/** The OKLCh of gamma-encoded coordinates (0-1) in `gamut`. */
function oklchOf(
  rgb: [number, number, number],
  gamut: 'srgb' | 'display-p3' = 'srgb'
) {
  const [r, g, b] = gamutToSrgb(rgb, gamut);
  return rgbToOklch({ r: r * 255, g: g * 255, b: b * 255 });
}

/** The numeric channels of an evaluated color head. */
function channels(expr: any): number[] {
  const result = ce.box(expr).evaluate();
  return result.ops!.map((x) => x.re);
}

function evalString(expr: any): string | undefined {
  return ce.box(expr).evaluate().string;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

describe('gamutMapOklch and gamutMapSrgb', () => {
  test('pure sRGB red maps to itself', () => {
    expect(gamutMapSrgb(1, 0, 0)).toEqual([1, 0, 0]);
  });

  test('a color inside the gamut is unchanged', () => {
    for (const rgb of [
      [0.3, 0.55, 0.8],
      [0, 0, 0],
      [1, 1, 1],
      [0.123456789, 0.987654321, 0.5],
    ] as [number, number, number][]) {
      const mapped = gamutMapSrgb(...rgb);
      for (let i = 0; i < 3; i++)
        expect(Math.abs(mapped[i] - rgb[i])).toBeLessThan(1e-12);
    }
  });

  test('an OKLCh color inside the gamut keeps its lightness, chroma and hue', () => {
    const c = oklchOf(gamutMapOklch(0.6, 0.1, 200));
    expect(c.L).toBeCloseTo(0.6, 9);
    expect(c.C).toBeCloseTo(0.1, 9);
    expect(c.H).toBeCloseTo(200, 6);
  });

  test('Oklch(0.7, 0.4, 30) keeps its hue and loses chroma, not #ff0000', () => {
    const mapped = gamutMapOklch(0.7, 0.4, 30, 'srgb');
    expect(inGamut(mapped)).toBe(true);
    for (const x of mapped) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
    const c = oklchOf(mapped);
    expect(hueDistance(c.H, 30)).toBeLessThan(0.5);
    expect(c.C).toBeLessThan(0.4);
    // A clip of each channel gives (1, 0, 0), the sRGB red of hue 29.2.
    expect(mapped[1]).toBeGreaterThan(0.1);
    expect(mapped[0]).toBeCloseTo(1, 6);
    expect(mapped[1]).toBeCloseTo(0.345135, 6);
    expect(mapped[2]).toBeCloseTo(0.264575, 6);
  });

  test('Display-P3 keeps more chroma than sRGB', () => {
    const srgb = oklchOf(gamutMapOklch(0.7, 0.4, 30, 'srgb'));
    const p3Coords = gamutMapOklch(0.7, 0.4, 30, 'display-p3');
    expect(p3Coords[0]).toBeCloseTo(1, 6);
    expect(p3Coords[1]).toBeCloseTo(0.285223, 6);
    expect(p3Coords[2]).toBeCloseTo(0.192905, 6);
    const p3 = oklchOf(p3Coords, 'display-p3');
    expect(p3.C).toBeGreaterThan(srgb.C + 0.03);
    expect(hueDistance(p3.H, 30)).toBeLessThan(0.5);
  });

  test('other hues match the reference implementation', () => {
    const cases: [[number, number, number], [number, number, number]][] = [
      [
        [0.9, 0.3, 140],
        [0.385342, 1, 0.189913],
      ],
      [
        [0.3, 0.3, 264],
        [0.011215, 0, 0.618124],
      ],
    ];
    for (const [[L, C, H], expected] of cases) {
      const mapped = gamutMapOklch(L, C, H);
      for (let i = 0; i < 3; i++)
        expect(Math.abs(mapped[i] - expected[i])).toBeLessThan(2e-6);
    }
  });

  test('an extended sRGB color is mapped at constant OKLCh hue', () => {
    // Rgb(1.2, 0, 0) is outside the gamut with an OKLCh lightness below 1.
    const mapped = gamutMapSrgb(1.2, 0, 0);
    expect(mapped[0]).toBeCloseTo(1, 6);
    expect(mapped[1]).toBeCloseTo(0.410225, 6);
    expect(mapped[2]).toBeCloseTo(0.339121, 6);
  });

  test('a lightness of 1 or more is white, 0 or less is black', () => {
    expect(gamutMapOklch(1, 0.2, 30)).toEqual([1, 1, 1]);
    expect(gamutMapOklch(1.5, 0.2, 30)).toEqual([1, 1, 1]);
    expect(gamutMapOklch(0, 0.2, 30)).toEqual([0, 0, 0]);
    expect(gamutMapOklch(-0.1, 0.2, 30)).toEqual([0, 0, 0]);
    // Rgb(2, 0, 0) has an OKLCh lightness of 1.07.
    expect(gamutMapSrgb(2, 0, 0)).toEqual([1, 1, 1]);
  });

  test('deltaEOK is the Euclidean distance in OKLab', () => {
    expect(deltaEOK([0.5, 0.1, 0.1], [0.5, 0.1, 0.1])).toBe(0);
    expect(deltaEOK([0.5, 0, 0], [0.5, 0.03, 0.04])).toBeCloseTo(0.05, 15);
  });
});

describe('GamutMap', () => {
  test('Oklch(0.7, 0.4, 30) maps into [0, 1] at the same hue', () => {
    const rgb = channels(['GamutMap', ['Oklch', 0.7, 0.4, 30]]);
    expect(rgb).toHaveLength(3);
    for (const x of rgb) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
    const c = oklchOf(rgb as [number, number, number]);
    expect(hueDistance(c.H, 30)).toBeLessThan(0.5);
  });

  test('the result is an Rgb head', () => {
    expect(
      ce.box(['GamutMap', ['Oklch', 0.7, 0.4, 30]]).evaluate().operator
    ).toBe('Rgb');
  });

  test('an extended red with a lightness above 1 maps to white', () => {
    // The OKLCh lightness of Rgb(2, 0, 0) is 1.07, and the CSS Color 4
    // algorithm answers white for a lightness of 1 or more.
    expect(channels(['GamutMap', ['Rgb', 2, 0, 0]])).toEqual([1, 1, 1]);
  });

  test('an extended red with a lightness below 1 keeps its hue', () => {
    const rgb = channels(['GamutMap', ['Rgb', 1.2, 0, 0]]);
    expect(rgb[0]).toBeCloseTo(1, 6);
    expect(rgb[1]).toBeCloseTo(0.410225, 6);
    expect(rgb[2]).toBeCloseTo(0.339121, 6);
  });

  test('a color inside the gamut is returned as it is', () => {
    expect(
      ce
        .box(['GamutMap', ['Rgb', ['Rational', 1, 2], 0, 0]])
        .evaluate()
        .toString()
    ).toBe('Rgb(1/2, 0, 0)');
  });

  test('display-p3: the result is in sRGB coordinates, inside the P3 gamut', () => {
    const rgb = channels(['GamutMap', ['Oklch', 0.7, 0.4, 30], "'display-p3'"]);
    // Outside the sRGB gamut: a red channel above 1.
    expect(rgb[0]).toBeGreaterThan(1);
    const c = oklchOf(rgb as [number, number, number]);
    expect(hueDistance(c.H, 30)).toBeLessThan(0.5);
    // An sRGB color inside the P3 gamut is returned as it is.
    expect(
      ce
        .box(['GamutMap', ['Rgb', 1.05, 0, 0], "'display-p3'"])
        .evaluate()
        .toString()
    ).toBe('Rgb(1.05, 0, 0)');
  });

  test('the alpha is kept', () => {
    const rgb = channels(['GamutMap', ['Oklch', 0.7, 0.4, 30, 0.5]]);
    expect(rgb).toHaveLength(4);
    expect(rgb[3]).toBe(0.5);
  });

  test('an unknown gamut is an error', () => {
    expect(
      ce
        .box(['GamutMap', ['Rgb', 1, 0, 0], "'rec2020'"])
        .evaluate()
        .toString()
    ).toMatch(/expected-value/);
  });

  test('parses as a function', () => {
    expect(
      ce.parse('\\operatorname{GamutMap}(\\operatorname{Oklch}(0.7,0.4,30))')
        .json
    ).toEqual(['GamutMap', ['Oklch', 0.7, 0.4, 30]]);
  });
});

describe('ColorToString maps into the gamut', () => {
  test('an out-of-gamut color is not the clipped #ff0000', () => {
    const s = evalString(['ColorToString', ['Oklch', 0.7, 0.4, 30]]);
    expect(s).not.toBe('#ff0000');
    expect(s).toBe('#ff5843');
    expect(
      evalString(['ColorToString', ['Oklch', 0.7, 0.4, 30], "'srgb'"])
    ).toBe('#ff5843');
    expect(
      evalString(['ColorToString', ['Oklch', 0.7, 0.4, 30], "'rgb'"])
    ).toBe('rgb(255 88 67)');
  });

  test('the oklch format is not mapped', () => {
    expect(
      evalString(['ColorToString', ['Oklch', 0.7, 0.4, 30], "'oklch'"])
    ).toBe('oklch(0.7 0.4 30)');
  });

  test('display-p3 format', () => {
    expect(
      evalString(['ColorToString', ['Oklch', 0.7, 0.4, 30], "'display-p3'"])
    ).toBe('color(display-p3 1 0.2852 0.1929)');
    // sRGB red in Display-P3 coordinates.
    expect(
      evalString(['ColorToString', ['Rgb', 1, 0, 0], "'display-p3'"])
    ).toBe('color(display-p3 0.9175 0.2003 0.1386)');
    expect(
      evalString(['ColorToString', ['Rgb', 1, 0, 0, 0.5], "'display-p3'"])
    ).toBe('color(display-p3 0.9175 0.2003 0.1386 / 0.5)');
  });

  test('an in-gamut color keeps its hex spelling', () => {
    expect(evalString(['ColorToString', ['Rgb', 1, 0.5, 0]])).toBe('#ff8000');
  });
});

describe('conversions keep extended values; HSV and HSL map', () => {
  test('AsHsv of a pure extended red with a lightness above 1 is white', () => {
    // The CSS Color 4 algorithm maps a lightness of 1 or more to white, so
    // this red does not stay red.
    expect(channels(['AsHsv', ['Rgb', 2, 0, 0]])).toEqual([0, 0, 1]);
  });

  test('AsHsv of an extended red with a lightness below 1 is a red', () => {
    const [h, s, v] = channels(['AsHsv', ['Rgb', 1.2, 0, 0]]);
    expect(h).toBeCloseTo(6.455435, 5);
    expect(s).toBeCloseTo(0.660879, 5);
    expect(v).toBe(1);
  });

  test('AsRgb keeps the extended channels', () => {
    expect(
      ce
        .box(['AsRgb', ['Rgb', 2, 0, 0]])
        .evaluate()
        .toString()
    ).toBe('Rgb(2, 0, 0)');
    const [r, g, b] = channels(['AsRgb', ['Oklch', 0.7, 0.4, 30]]);
    expect(r).toBeGreaterThan(1);
    expect(g).toBeLessThan(0);
    expect(b).toBeLessThan(0);
    expect(r).toBeCloseTo(1.3196, 3);
    expect(g).toBeCloseTo(-0.4498, 3);
    expect(b).toBeCloseTo(-0.3101, 3);
  });
});

// The compiled `javascript` route must answer what the interpreter answers:
// `_SYS.colorToString` and `_SYS.gamutMap` apply the same gamut mapping
// (`compilation/javascript-target.ts`).
describe('compiled javascript route', () => {
  function run(expr: any): any {
    const f: any = compile(ce.box(expr));
    if (!f.success) throw new Error('no lowering');
    return f.run();
  }

  test('AsHsv of an extended color agrees with the interpreter', () => {
    const c = run(['AsHsv', ['Rgb', 1.2, 0, 0]]);
    expect(c.c0).toBeCloseTo(6.455435, 5);
    expect(c.c1).toBeCloseTo(0.660879, 5);
    expect(c.c2).toBeCloseTo(1, 9);
  });

  test('ColorToString maps into the sRGB gamut', () => {
    expect(run(['ColorToString', ['Oklch', 0.7, 0.4, 30]])).toBe('#ff5843');
  });

  test('ColorToString has the display-p3 format', () => {
    expect(
      run(['ColorToString', ['Oklch', 0.7, 0.4, 30], "'display-p3'"])
    ).toBe('color(display-p3 1 0.2852 0.1929)');
  });

  test('GamutMap compiles', () => {
    const c = run(['GamutMap', ['Oklch', 0.7, 0.4, 30]]);
    expect(c.c0).toBeCloseTo(1, 6);
    expect(c.c1).toBeCloseTo(0.345135, 6);
    expect(c.c2).toBeCloseTo(0.264575, 6);
  });
});

// For random colors, inside and outside the sRGB gamut, built with `Rgb` and
// with `Oklch`, the compiled `javascript` route answers the string and the
// mapped color the interpreter answers.
describe('route agreement: interpreter and compiled javascript', () => {
  // A seeded generator, so a failure can be reproduced.
  let seed = 12345;
  function random(): number {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  }

  const colors: any[] = [];
  for (let i = 0; i < 25; i++)
    // Channels in [-0.3, 1.3]: about half of these are outside the gamut.
    colors.push(['Rgb', ...[0, 1, 2].map(() => -0.3 + 1.6 * random())]);
  for (let i = 0; i < 25; i++)
    // Lightness in [0.05, 0.95] and chroma up to 0.4: most of these are
    // outside the sRGB gamut, some outside the Display-P3 gamut too.
    colors.push(['Oklch', 0.05 + 0.9 * random(), 0.4 * random(), 360 * random()]);

  function run(expr: any): any {
    const f: any = compile(ce.box(expr));
    if (!f.success) throw new Error(`no lowering for ${JSON.stringify(expr)}`);
    return f.run();
  }

  test('50 colors: ColorToString (hex and display-p3) agrees', () => {
    let outOfGamut = 0;
    for (const color of colors) {
      const rgb = channels(['AsRgb', color]);
      if (!inGamut(rgb as [number, number, number])) outOfGamut += 1;
      for (const format of ["'hex'", "'display-p3'"]) {
        const expr = ['ColorToString', color, format];
        expect([color, format, run(expr)]).toEqual([
          color,
          format,
          evalString(expr),
        ]);
      }
    }
    // The sample covers both sides of the gamut boundary.
    expect(outOfGamut).toBeGreaterThan(10);
    expect(outOfGamut).toBeLessThan(45);
  });

  test('50 colors: GamutMap agrees within 1e-9 per channel', () => {
    for (const gamut of [undefined, "'display-p3'"]) {
      for (const color of colors) {
        const expr =
          gamut === undefined
            ? ['GamutMap', color]
            : ['GamutMap', color, gamut];
        const c = run(expr);
        expect(c.space).toBe('rgb');
        const expected = channels(expr);
        const actual = [c.c0, c.c1, c.c2];
        for (let i = 0; i < 3; i++)
          expect([color, gamut, i, Math.abs(actual[i] - expected[i]) < 1e-9]).toEqual([
            color,
            gamut,
            i,
            true,
          ]);
      }
    }
  });
});
