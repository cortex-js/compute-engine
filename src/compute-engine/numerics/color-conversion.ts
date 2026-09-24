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

import { gammaCorrect, inverseGammaCorrect, oklchToOklab } from '@arnog/colors';

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
 *   display (Display P3) can show. The conversions do not map it into a
 *   gamut; only the output does (see `gamutMapOklch`).
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
  const [r, g, bl] = oklabToLinearSrgb(L, a, b);
  return [gammaCorrect(r), gammaCorrect(g), gammaCorrect(bl)];
}

/** OKLab to LINEAR extended sRGB (no transfer function). The matrices are
 * the ones `oklabToRgb` of `@arnog/colors` uses. */
function oklabToLinearSrgb(
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
    4.076741661347994 * l - 3.307711590408193 * m + 0.230969928729428 * s,
    -1.2684380040921763 * l + 2.6097574006633715 * m - 0.3413193963102197 * s,
    -0.004196086541837188 * l - 0.7034186144594493 * m + 1.7076147009309444 * s,
  ];
}

/** LINEAR extended sRGB to OKLab. The matrices are the ones `rgbToOklab` of
 * `@arnog/colors` uses, so this is the inverse of `oklabToLinearSrgb`. */
function linearSrgbToOklab(
  r: number,
  g: number,
  b: number
): [number, number, number] {
  const l = Math.cbrt(
    0.41222147079999993 * r + 0.5363325363 * g + 0.0514459929 * b
  );
  const m = Math.cbrt(
    0.2119034981999999 * r + 0.6806995450999999 * g + 0.1073969566 * b
  );
  const s = Math.cbrt(
    0.08830246189999998 * r + 0.2817188376 * g + 0.6299787005000002 * b
  );
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
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
 * only the output maps a color into a gamut (see `gamutMapOklch`).
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
 * Bring an extended sRGB color (0-255 scale) into the sRGB gamut, and answer
 * its channels on the 0-1 scale.
 *
 * HSV and HSL describe only the sRGB gamut, so an extended sRGB color is
 * mapped into the gamut before it is converted to HSV or HSL. The mapping is
 * the CSS Color 4 gamut mapping (`gamutMapSrgb`): it reduces the OKLCh chroma
 * and keeps the OKLCh lightness and hue, where a clip of each channel on its
 * own changed the hue. A color inside the gamut is not changed.
 */
function srgbGamutChannels(
  r: number,
  g: number,
  b: number
): [number, number, number] {
  return gamutMapSrgb(r / 255, g / 255, b / 255, 'srgb');
}

/**
 * sRGB (0-255 scale) to HSV. The computation of `rgbToHsv` of
 * `@arnog/colors`, with a color whose channels differ by less than
 * `ACHROMATIC_TOLERANCE` read as achromatic, and a hue just below 360 read
 * as 0 (`reduceHue`). The color is first mapped into the sRGB gamut
 * (`srgbGamutChannels`).
 */
export function rgb255ToHsv(
  r: number,
  g: number,
  b: number
): { h: number; s: number; v: number } {
  [r, g, b] = srgbGamutChannels(r, g, b);
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
 * as 0 (`reduceHue`). The color is first mapped into the sRGB gamut
 * (`srgbGamutChannels`).
 */
export function rgb255ToHsl(
  r: number,
  g: number,
  b: number
): { h: number; s: number; l: number } {
  [r, g, b] = srgbGamutChannels(r, g, b);
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

// ---------------------------------------------------------------------------
// Gamut mapping at output.
//
// Color VALUES have no gamut: an `Rgb` channel outside [0, 1] is extended
// sRGB, and OKLab/OKLCh channels have no bound, so the conversions among
// these spaces never clamp. A gamut exists only where a color leaves the
// engine for a display: a CSS string, a hex string, the HSV/HSL channels
// (which describe only the sRGB gamut), or the `GamutMap` operator. There the
// color is brought into the target gamut by the CSS Color 4 gamut-mapping
// algorithm: the OKLCh chroma is reduced, at constant lightness and hue, by a
// binary search, until the color is inside the gamut or until clipping each
// channel moves the color by less than a "just noticeable difference"
// (ΔE_OK 0.02). A clip of each channel on its own changes the hue of the
// color, so it is not used alone: `Oklch(0.7, 0.4, 30)` clips to `#ff0000`,
// a red of another hue and lightness.
//
// Source: CSS Color Module Level 4, §13.2 "CSS gamut mapping to an RGB
// destination" (https://www.w3.org/TR/css-color-4/#css-gamut-mapping).
// ---------------------------------------------------------------------------

/** A target gamut of the output. Both have the sRGB transfer function. */
export type ColorGamut = 'srgb' | 'display-p3';

/** The gamut named by `name` (case is ignored), or `undefined` when the name
 * is not a gamut. */
export function readColorGamut(
  name: string | undefined
): ColorGamut | undefined {
  const n = name?.toLowerCase();
  if (n === 'srgb' || n === 'display-p3') return n;
  return undefined;
}

type Matrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

function mulMatrix(a: Matrix3, b: Matrix3): Matrix3 {
  const row = (i: number): [number, number, number] => [
    a[i][0] * b[0][0] + a[i][1] * b[1][0] + a[i][2] * b[2][0],
    a[i][0] * b[0][1] + a[i][1] * b[1][1] + a[i][2] * b[2][1],
    a[i][0] * b[0][2] + a[i][1] * b[1][2] + a[i][2] * b[2][2],
  ];
  return [row(0), row(1), row(2)];
}

function mulVector(
  m: Matrix3,
  v: readonly [number, number, number]
): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// The rational matrices of CSS Color 4, §18 "Sample code for color
// conversions": linear sRGB and linear Display-P3 to and from CIE XYZ with the
// D65 white point. Checked numerically: each pair multiplies to the identity,
// [1, 1, 1] maps to the D65 white (0.95046, 1, 1.08906), and the primaries
// have the chromaticities of the standards (sRGB red x = 0.64, y = 0.33;
// Display-P3 red x = 0.68, y = 0.32; green 0.265, 0.69).
const LINEAR_SRGB_TO_XYZ: Matrix3 = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];
const XYZ_TO_LINEAR_SRGB: Matrix3 = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];
const LINEAR_P3_TO_XYZ: Matrix3 = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0, 32229 / 714400, 5220557 / 5000800],
];
const XYZ_TO_LINEAR_P3: Matrix3 = [
  [446124 / 178915, -333277 / 357830, -72051 / 178915],
  [-14852 / 17905, 63121 / 35810, 423 / 17905],
  [11844 / 330415, -50337 / 660830, 316169 / 330415],
];

/** Linear sRGB to linear Display-P3, and back. */
export const LINEAR_SRGB_TO_LINEAR_P3: Matrix3 = mulMatrix(
  XYZ_TO_LINEAR_P3,
  LINEAR_SRGB_TO_XYZ
);
export const LINEAR_P3_TO_LINEAR_SRGB: Matrix3 = mulMatrix(
  XYZ_TO_LINEAR_SRGB,
  LINEAR_P3_TO_XYZ
);

/** Linear extended sRGB to the gamma-encoded coordinates of `gamut`. */
function linearSrgbToGamut(
  rgb: [number, number, number],
  gamut: ColorGamut
): [number, number, number] {
  const lin =
    gamut === 'display-p3' ? mulVector(LINEAR_SRGB_TO_LINEAR_P3, rgb) : rgb;
  return [gammaCorrect(lin[0]), gammaCorrect(lin[1]), gammaCorrect(lin[2])];
}

/** Gamma-encoded coordinates of `gamut` to linear extended sRGB. */
function gamutToLinearSrgb(
  rgb: readonly [number, number, number],
  gamut: ColorGamut
): [number, number, number] {
  const lin: [number, number, number] = [
    inverseGammaCorrect(rgb[0]),
    inverseGammaCorrect(rgb[1]),
    inverseGammaCorrect(rgb[2]),
  ];
  return gamut === 'display-p3'
    ? mulVector(LINEAR_P3_TO_LINEAR_SRGB, lin)
    : lin;
}

/**
 * Gamma-encoded extended sRGB coordinates (0-1 scale) to the gamma-encoded
 * coordinates of `gamut`. For `srgb` the coordinates are returned as they
 * are.
 */
export function srgbToGamut(
  rgb: readonly [number, number, number],
  gamut: ColorGamut
): [number, number, number] {
  if (gamut === 'srgb') return [rgb[0], rgb[1], rgb[2]];
  return linearSrgbToGamut(gamutToLinearSrgb(rgb, 'srgb'), gamut);
}

/**
 * Gamma-encoded coordinates of `gamut` to gamma-encoded extended sRGB
 * coordinates (0-1 scale). A Display-P3 color outside the sRGB gamut has
 * sRGB coordinates outside [0, 1]. For `srgb` the coordinates are returned
 * as they are.
 */
export function gamutToSrgb(
  rgb: readonly [number, number, number],
  gamut: ColorGamut
): [number, number, number] {
  if (gamut === 'srgb') return [rgb[0], rgb[1], rgb[2]];
  return linearSrgbToGamut(gamutToLinearSrgb(rgb, gamut), 'srgb');
}

/**
 * The distance, on the 0-1 scale, by which a channel can be outside [0, 1]
 * and the color still be read as inside the gamut. It absorbs the rounding
 * error of the conversions (about 1e-15 in double precision, about 1e-7 in
 * the single precision of a shader), so a color on the edge of the gamut is
 * not moved by the mapping.
 */
export const GAMUT_TOLERANCE = 1e-6;

/** True when the three gamma-encoded channels (0-1 scale) are inside
 * [0, 1], within `GAMUT_TOLERANCE`. */
export function inGamut(rgb: readonly [number, number, number]): boolean {
  return rgb.every((x) => x >= -GAMUT_TOLERANCE && x <= 1 + GAMUT_TOLERANCE);
}

/** ΔE_OK: the Euclidean distance between two OKLab colors `[L, a, b]`. */
export function deltaEOK(
  x: readonly [number, number, number],
  y: readonly [number, number, number]
): number {
  const dL = x[0] - y[0];
  const da = x[1] - y[1];
  const db = x[2] - y[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

/** The "just noticeable difference" of the CSS Color 4 algorithm: a clipped
 * color closer than this (ΔE_OK) to the unclipped one is accepted. */
const GAMUT_JND = 0.02;

/** The chroma resolution of the binary search of the CSS Color 4
 * algorithm. */
const GAMUT_CHROMA_EPSILON = 0.0001;

function clipChannels(
  rgb: readonly [number, number, number]
): [number, number, number] {
  return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
}

/**
 * Map the OKLCh color `(L, C, H)` into `gamut` with the CSS Color 4
 * gamut-mapping algorithm, and answer its gamma-encoded coordinates in that
 * gamut (sRGB or Display-P3), each in [0, 1].
 *
 * - A lightness of 1 or more answers white, and a lightness of 0 or less
 *   answers black.
 * - A color inside the gamut (within `GAMUT_TOLERANCE`) answers its own
 *   coordinates, clipped into [0, 1] to remove the tolerance.
 * - Otherwise the chroma is searched in [0, C] at constant lightness and hue.
 *   The search stops at the first chroma whose per-channel clip is within
 *   ΔE_OK 0.02 of it (and within 0.0001 of that bound), or when the chroma
 *   interval is narrower than 0.0001. The answer is that clipped color.
 *
 * A negative chroma is the chroma `|C|` at the opposite hue, `H + 180`. The
 * channels must be finite.
 */
export function gamutMapOklch(
  L: number,
  C: number,
  H: number,
  gamut: ColorGamut = 'srgb'
): [number, number, number] {
  // A non-finite channel has no colour; the chroma search below would never
  // end with an infinite chroma (its upper bound stays infinite).
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(H))
    return [NaN, NaN, NaN];
  if (L >= 1) return [1, 1, 1];
  if (L <= 0) return [0, 0, 0];
  if (C < 0) {
    C = -C;
    H += 180;
  }
  const hRad = (H * Math.PI) / 180;
  const cosH = Math.cos(hRad);
  const sinH = Math.sin(hRad);
  const lab = (c: number): [number, number, number] => [L, c * cosH, c * sinH];
  const toGamut = (c: number): [number, number, number] =>
    linearSrgbToGamut(oklabToLinearSrgb(L, c * cosH, c * sinH), gamut);
  const labOfGamut = (
    rgb: readonly [number, number, number]
  ): [number, number, number] =>
    linearSrgbToOklab(...gamutToLinearSrgb(rgb, gamut));

  const origin = toGamut(C);
  if (inGamut(origin)) return clipChannels(origin);

  let clipped = clipChannels(origin);
  if (deltaEOK(labOfGamut(clipped), lab(C)) < GAMUT_JND) return clipped;

  let min = 0;
  let max = C;
  let minInGamut = true;
  while (max - min > GAMUT_CHROMA_EPSILON) {
    const chroma = (min + max) / 2;
    const current = toGamut(chroma);
    if (minInGamut && inGamut(current)) {
      min = chroma;
      continue;
    }
    clipped = clipChannels(current);
    const e = deltaEOK(labOfGamut(clipped), lab(chroma));
    if (e < GAMUT_JND) {
      if (GAMUT_JND - e < GAMUT_CHROMA_EPSILON) return clipped;
      minInGamut = false;
      min = chroma;
    } else {
      max = chroma;
    }
  }
  return clipped;
}

/**
 * Map the gamma-encoded extended sRGB color `(r, g, b)` (0-1 scale) into
 * `gamut`, and answer its gamma-encoded coordinates in that gamut, each in
 * [0, 1]. See `gamutMapOklch`.
 *
 * A color inside the gamut is not converted through OKLCh: for `srgb` its
 * channels are returned as they are (clipped into [0, 1] to remove
 * `GAMUT_TOLERANCE`). A color with a channel that is not finite is not a
 * color the algorithm can map; each of its channels is clipped, so a `NaN`
 * channel stays `NaN`.
 */
export function gamutMapSrgb(
  r: number,
  g: number,
  b: number,
  gamut: ColorGamut = 'srgb'
): [number, number, number] {
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b))
    return clipChannels([r, g, b]);
  const inTarget = srgbToGamut([r, g, b], gamut);
  if (inGamut(inTarget)) return clipChannels(inTarget);
  const [L, A, B] = linearSrgbToOklab(...gamutToLinearSrgb([r, g, b], 'srgb'));
  return gamutMapOklch(
    L,
    Math.sqrt(A * A + B * B),
    Math.atan2(B, A) * (180 / Math.PI),
    gamut
  );
}

/**
 * The CSS spelling `color(display-p3 r g b)` of Display-P3 coordinates (each
 * rounded to 4 decimals), with ` / alpha` when an alpha is given.
 */
export function displayP3String(
  rgb: readonly [number, number, number],
  alpha?: number
): string {
  const f = (x: number): number => Math.round(x * 10000) / 10000;
  const channels = `${f(rgb[0])} ${f(rgb[1])} ${f(rgb[2])}`;
  if (alpha !== undefined) return `color(display-p3 ${channels} / ${alpha})`;
  return `color(display-p3 ${channels})`;
}
