/**
 * Color channel rules and sRGB conversions shared by the interpreter
 * (`library/colors.ts`) and the compiled JavaScript runtime
 * (`compilation/javascript-target.ts`).
 *
 * Both routes must answer the same color for the same input, so the rules
 * that decide which channel values are admitted, and the conversions that
 * must not round, live here, outside `library/` and `compilation/`, where
 * both can import them.
 *
 * The sRGB channels in this module use the 0-255 scale of `RgbColor` in
 * `@arnog/colors`, but they are NOT rounded to integers. Some conversions of
 * `@arnog/colors` (`hslToRgb`, `oklabToRgb`, `oklchToRgb`) round each
 * channel to an integer, which is a quantization to 8 bits: `Hsl(30, 1, 0.5)`
 * converted to a green channel of 128/255 instead of 0.5. The replacements
 * below compute the same colors without the rounding.
 */

import { gammaCorrect, oklchToOklab } from '@arnog/colors';

/** The five color spaces, spelled in lowercase. */
export type ColorChannelSpace = 'rgb' | 'hsv' | 'hsl' | 'oklab' | 'oklch';

/**
 * For each color space, which of the three channels are CLAMPED into
 * `[0, 1]` when they are read.
 *
 * Only HSV saturation and value, and HSL saturation and lightness, are
 * clamped. HSV and HSL describe only the sRGB gamut, so a value outside
 * `[0, 1]` has no other meaning.
 *
 * The other channels are not clamped:
 * - `rgb`: the channels are EXTENDED sRGB. A finite channel outside
 *   `[0, 1]` is a real color outside the sRGB gamut, which a wide-gamut
 *   display (Display P3) can show. Gamut mapping is the job of the renderer,
 *   not of the conversions.
 * - `oklab`, `oklch`: the channels have no bound. A lightness above 1 is
 *   kept.
 * - A hue is an angle. It is reduced modulo 360 (see `readColorChannels`).
 */
const CLAMPED_CHANNELS: Readonly<
  Record<ColorChannelSpace, readonly [boolean, boolean, boolean]>
> = {
  rgb: [false, false, false],
  hsv: [false, true, true],
  hsl: [false, true, true],
  oklab: [false, false, false],
  oklch: [false, false, false],
};

/**
 * Read the three channels of a color in `space`, or answer `undefined` when
 * they do not make a color.
 *
 * - A clamped channel (HSV saturation and value, HSL saturation and
 *   lightness, see `CLAMPED_CHANNELS`) is clamped into `[0, 1]`. This
 *   includes an infinite value: `+∞` reads as 1 and `−∞` as 0. So
 *   `Hsv(30, +∞, 3.14)` is the color of `Hsv(30, 1, 1)`.
 * - The HSV and HSL hue is reduced into `[0, 360)`, so `Hsv(390, 1, 1)` is
 *   the color of `Hsv(30, 1, 1)`.
 * - Any other finite channel is kept as it is. An `Rgb` channel of 2 is an
 *   extended sRGB channel, not an error.
 *
 * The channels are refused (`undefined`) when any channel is `NaN`, or when
 * a channel that is not clamped is infinite: an infinite sRGB channel, hue,
 * OKLab/OKLCh lightness, chroma or `a`/`b` value is not a color.
 *
 * The interpreter and the compiled runtime both read color channels through
 * this function, so the two routes admit and refuse the same colors.
 */
export function readColorChannels(
  space: ColorChannelSpace,
  c0: number,
  c1: number,
  c2: number
): [number, number, number] | undefined {
  const clamped = CLAMPED_CHANNELS[space];
  const read = (x: number, isClamped: boolean): number | undefined => {
    if (Number.isNaN(x)) return undefined;
    if (isClamped) return clamp01(x);
    return Number.isFinite(x) ? x : undefined;
  };
  let r0 = read(c0, clamped[0]);
  const r1 = read(c1, clamped[1]);
  const r2 = read(c2, clamped[2]);
  if (r0 === undefined || r1 === undefined || r2 === undefined)
    return undefined;
  if (space === 'hsv' || space === 'hsl') r0 = ((r0 % 360) + 360) % 360;
  return [r0, r1, r2];
}

/** Clamp `x` into `[0, 1]`. */
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * HSL to sRGB, with channels on the 0-255 scale and not rounded.
 *
 * The hue is reduced modulo 360, and the saturation and the lightness are
 * clamped into `[0, 1]`, as `hsvToRgb` of `@arnog/colors` does for HSV. The
 * `hslToRgb` of that library does not clamp them, so `Hsl(30, 1, 2)`
 * converted to the sRGB channels `(1, 2, 3)`.
 */
export function hslToRgb255(
  h: number,
  s: number,
  l: number
): { r: number; g: number; b: number } {
  h = (((h % 360) + 360) % 360) / 360;
  s = clamp01(s);
  l = clamp01(l);
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const hueToChannel = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hueToChannel(p, q, h + 1 / 3) * 255,
    g: hueToChannel(p, q, h) * 255,
    b: hueToChannel(p, q, h - 1 / 3) * 255,
  };
}

/** OKLab to gamma-encoded extended sRGB on the 0-1 scale. The matrices are
 * the ones `oklabToRgb` of `@arnog/colors` uses, and `gammaCorrect` is the
 * sign-extended sRGB transfer function (`sign(c)·f(|c|)`). */
function oklabToUnclippedSrgb(
  L: number,
  a: number,
  b: number
): [number, number, number] {
  const l = Math.pow(
    0.9999999984505198 * L + 0.39633779217376786 * a + 0.2158037580607588 * b,
    3
  );
  const m = Math.pow(
    1.00000000888176 * L - 0.10556134232365635 * a - 0.0638541747717059 * b,
    3
  );
  const s = Math.pow(
    L * 1.000000054672411 - 0.0894841820949657 * a - 1.2914855378640917 * b,
    3
  );
  return [
    gammaCorrect(
      4.076741661347994 * l - 3.307711590408193 * m + 0.230969928729428 * s
    ),
    gammaCorrect(
      -1.2684380040921763 * l + 2.6097574006633715 * m - 0.3413193963102197 * s
    ),
    gammaCorrect(
      -0.004196086541837188 * l -
        0.7034186144594493 * m +
        1.7076147009309444 * s
    ),
  ];
}

/**
 * The distance, on the 0-1 scale, within which a channel computed from OKLab
 * is read as exactly 0 or exactly 1.
 *
 * A pure red that goes through OKLab comes back as about
 * `(1, 4e-14, 7e-15)`. The channels at the edge of the gamut are the common
 * case (a saturated color has a channel at 0 and one at 1), so they are
 * returned exactly, and a hue read off them is not moved by that error. A
 * channel farther than this from 0 and from 1 is kept as it is, also when it
 * is outside `[0, 1]`.
 */
const EDGE_TOLERANCE = 1e-12;

function snappedChannel(x: number): number {
  if (Math.abs(x) < EDGE_TOLERANCE) return 0;
  if (Math.abs(x - 1) < EDGE_TOLERANCE) return 1;
  return x;
}

/**
 * OKLab to extended sRGB, with channels on the 0-255 scale and not rounded.
 *
 * This is the conversion `oklabToRgb` of `@arnog/colors` does, without its
 * gamut mapping and without its final rounding to integers. A color outside
 * the sRGB gamut converts to channels outside `[0, 1]` (on the 0-1 scale):
 * a negative channel, or a channel above 1. The transfer function is the
 * sign-extended sRGB one (`gammaCorrect`), so the conversion is the inverse
 * of `rgbToOklab` also for these channels. No gamut mapping is done here:
 * that is the job of the renderer.
 */
export function oklabToRgb255(color: { L: number; a: number; b: number }): {
  r: number;
  g: number;
  b: number;
} {
  const [r, g, b] = oklabToUnclippedSrgb(color.L, color.a, color.b);
  return {
    r: snappedChannel(r) * 255,
    g: snappedChannel(g) * 255,
    b: snappedChannel(b) * 255,
  };
}

/** OKLCh to sRGB, with channels on the 0-255 scale and not rounded. See
 * `oklabToRgb255`. */
export function oklchToRgb255(color: { L: number; C: number; H: number }): {
  r: number;
  g: number;
  b: number;
} {
  return oklabToRgb255(oklchToOklab(color));
}

/**
 * The smallest difference, on the 0-1 scale, between the largest and the
 * smallest sRGB channel for which a color has a hue.
 *
 * A gray that the compiled runtime carries through OKLCh comes back with its
 * three channels different by about 1e-13, and reading a hue off that
 * difference answers an arbitrary hue. Below this tolerance the color is
 * achromatic: hue 0 and saturation 0, as for an exact gray.
 */
const ACHROMATIC_TOLERANCE = 1e-9;

/** The tolerance, in degrees, within which a hue just below 360 is read as
 * 0. See `reduceHue`. */
const HUE_TOLERANCE = 1e-9;

/**
 * A hue, in degrees, reduced into `[0, 360)`, with a hue that is less than
 * `HUE_TOLERANCE` degrees below 360 read as 0. A red that went through
 * OKLCh has a blue channel of about `-1e-15` more or less than its green
 * channel, and without this its hue is 359.99999999999994 instead of 0.
 */
function reduceHue(h: number): number {
  if (h < 0) h += 360;
  if (h >= 360 - HUE_TOLERANCE) h = 0;
  return h;
}

/**
 * Clip an extended sRGB channel (0-255 scale) into `[0, 255]`.
 *
 * HSV and HSL describe only the sRGB gamut, so an extended sRGB color is
 * brought into the gamut before it is converted to HSV or HSL. The method is
 * a clip of each channel on its own: `Rgb(2, 0.5, -1)` converts as
 * `Rgb(1, 0.5, 0)`. It does not keep the hue or the lightness of the color.
 */
function clip255(x: number): number {
  return Math.max(0, Math.min(255, x));
}

/**
 * sRGB (0-255 scale) to HSV. The computation of `rgbToHsv` of
 * `@arnog/colors`, with a color whose channels differ by less than
 * `ACHROMATIC_TOLERANCE` read as achromatic, and a hue just below 360 read
 * as 0 (`reduceHue`). Each channel is first clipped into `[0, 255]`
 * (`clip255`).
 */
export function rgb255ToHsv(
  r: number,
  g: number,
  b: number
): { h: number; s: number; v: number } {
  r = clip255(r) / 255;
  g = clip255(g) / 255;
  b = clip255(b) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (!(d > ACHROMATIC_TOLERANCE)) return { h: 0, s: 0, v: max };
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  const s = max === 0 ? 0 : d / max;
  return { h: reduceHue(h * 60), s, v: max };
}

/**
 * sRGB (0-255 scale) to HSL. The computation of `rgbToHsl` of
 * `@arnog/colors`, with a color whose channels differ by less than
 * `ACHROMATIC_TOLERANCE` read as achromatic, and a hue just below 360 read
 * as 0 (`reduceHue`). Each channel is first clipped into `[0, 255]`
 * (`clip255`).
 */
export function rgb255ToHsl(
  r: number,
  g: number,
  b: number
): { h: number; s: number; l: number } {
  r = clip255(r) / 255;
  g = clip255(g) / 255;
  b = clip255(b) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!(d > ACHROMATIC_TOLERANCE)) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: reduceHue(h * 60), s, l };
}
