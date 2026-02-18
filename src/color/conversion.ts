import type {
  RgbColor,
  OklchColor,
  OklabColor,
  HexColor,
  Color,
} from "./types";

// --- sRGB transfer functions ---

/** sRGB gamma correction (linear -> sRGB). Handles negative values via sign preservation. */
export function gammaCorrect(channel: number): number {
  const abs = Math.abs(channel);
  if (abs <= 0.0031308) return 12.92 * channel;
  const sign = Math.sign(channel) || 1;
  return sign * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055);
}

/** Inverse sRGB gamma correction (sRGB -> linear). Handles negative values via sign preservation. */
export function inverseGammaCorrect(channel: number): number {
  const abs = Math.abs(channel);
  if (abs <= 0.04045) return channel / 12.92;
  const sign = Math.sign(channel) || 1;
  return sign * Math.pow((abs + 0.055) / 1.055, 2.4);
}

// --- HSL conversion ---

export function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  h = h / 360;
  let r: number, g: number, b: number;

  if (s === 0) r = g = b = l;
  else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

/** Convert an RGB color (0-255 per channel) to HSL.
 * Returns h: 0-360, s: 0-1, l: 0-1. */
export function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s, l };
}

// --- RGB ↔ hex ---

/**
 * Convert 0-255 RGB components to a `#rrggbb` hex string.
 */
export function rgbToHex(r: number, g: number, b: number): HexColor {
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${cl(r).toString(16).padStart(2, "0")}${cl(g)
    .toString(16)
    .padStart(2, "0")}${cl(b).toString(16).padStart(2, "0")}`;
}

// --- Hex string parsing (minimal, no named-color or format support) ---

/** Parse a hex color string (#rgb, #rrggbb, #rrggbbaa) to an RgbColor. */
export function parseHexColor(s: string): RgbColor {
  const hex = s.startsWith("#") ? s.substring(1) : s;
  let r: number, g: number, b: number;
  let alpha: number | undefined;

  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length === 6) {
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
  } else if (hex.length === 8) {
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
    alpha = parseInt(hex.substring(6, 8), 16) / 255;
  } else {
    return { r: 0, g: 0, b: 0 };
  }

  const result: RgbColor = { r, g, b };
  if (alpha !== undefined) result.alpha = alpha;
  return result;
}

// --- Color type coercion ---

export function asOklch(
  color: HexColor | RgbColor | OklchColor | OklabColor,
): OklchColor {
  if (typeof color === "string") return rgbToOklch(parseHexColor(color));

  if ("C" in color) return color;
  if ("a" in color && "b" in color) return oklabToOklch(color as OklabColor);
  return rgbToOklch(color as RgbColor);
}

export function asRgb(color: number | Color): RgbColor {
  if (typeof color === "number") {
    return {
      r: (color >>> 24) & 0xff,
      g: (color >>> 16) & 0xff,
      b: (color >>> 8) & 0xff,
      alpha: (color & 0xff) / 255,
    };
  }
  if (typeof color === "string") return parseHexColor(color);

  if ("C" in color) return oklchToRgb(color);
  if ("a" in color && "b" in color) return oklabToRgb(color as OklabColor);
  return color as RgbColor;
}

export function asColorNumber(color: number | Color): number {
  const rgb = asRgb(color);
  const a = rgb.alpha !== undefined ? clampByte(rgb.alpha * 255) : 255;
  return (
    ((clampByte(rgb.r) << 24) |
      (clampByte(rgb.g) << 16) |
      (clampByte(rgb.b) << 8) |
      a) >>>
    0
  );
}

// --- OKLab / OKLCH core ---
// https://bottosson.github.io/posts/oklab/

export function clampByte(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return Math.round(v);
}

export function colorToHex(color: number): string {
  const toHex = (n: number) => {
    const hex = Math.round(Math.max(0, Math.min(255, n))).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  const r = (color >>> 24) & 0xff;
  const g = (color >>> 16) & 0xff;
  const b = (color >>> 8) & 0xff;
  const a = color & 0xff;

  if (a !== 255) return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`;

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function oklchToOklab(_: OklchColor): OklabColor {
  const [L, C, H] = [_.L, _.C, _.H];
  const hRadians = (H * Math.PI) / 180;
  const result: OklabColor = {
    L,
    a: C * Math.cos(hRadians),
    b: C * Math.sin(hRadians),
  };
  if (_.alpha !== undefined) result.alpha = _.alpha;
  return result;
}

export function oklabToOklch(_: OklabColor): OklchColor {
  const [L, a, b] = [_.L, _.a, _.b];
  const C = Math.sqrt(a * a + b * b);
  const hRadians = Math.atan2(b, a);
  const H = (hRadians * 180) / Math.PI;
  const result: OklchColor = { L, C, H };
  if (_.alpha !== undefined) result.alpha = _.alpha;
  return result;
}

export function oklabToUnclippedRgb(_: OklabColor): number[] {
  const [l, a, b] = [_.L, _.a, _.b];

  const L = Math.pow(
    0.9999999984505198 * l + 0.39633779217376786 * a + 0.2158037580607588 * b,
    3,
  );
  const M = Math.pow(
    1.00000000888176 * l - 0.10556134232365635 * a - 0.0638541747717059 * b,
    3,
  );
  const S = Math.pow(
    l * 1.000000054672411 - 0.0894841820949657 * a - 1.2914855378640917 * b,
    3,
  );

  const r =
    +4.076741661347994 * L - 3.307711590408193 * M + 0.230969928729428 * S;
  const g =
    -1.2684380040921763 * L + 2.6097574006633715 * M - 0.3413193963102197 * S;
  const bl =
    -0.004196086541837188 * L - 0.7034186144594493 * M + 1.7076147009309444 * S;

  return [gammaCorrect(r), gammaCorrect(g), gammaCorrect(bl)];
}

function inGamut(rgb: number[]): boolean {
  const [r, g, b] = rgb;
  return r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1;
}

function clampRgb(rgb: number[], alpha?: number): RgbColor {
  let [r, g, b] = rgb;
  r = clampByte(r * 255);
  g = clampByte(g * 255);
  b = clampByte(b * 255);
  return alpha !== undefined ? { r, g, b, alpha } : { r, g, b };
}

/** Convert an oklab color to sRGB, clipping the chroma if necessary */
export function oklabToRgb(color: OklabColor): RgbColor {
  let [r, g, b] = oklabToUnclippedRgb(color);
  if (inGamut([r, g, b])) return clampRgb([r, g, b], color.alpha);

  // Try with chroma = 0
  const oklch = oklabToOklch(color);
  oklch.C = 0;
  [r, g, b] = oklabToUnclippedRgb(oklchToOklab(oklch));

  // If even chroma 0 is not in gamut, return the clamped value
  if (!inGamut([r, g, b])) return clampRgb([r, g, b], color.alpha);

  // Use a binary search to find a chroma that is in gamut
  let low = 0;
  let high = color.L;
  let mid = (low + high) / 2;
  oklch.C = mid;
  const resolution = 0.36 / Math.pow(2, 12);
  while (high - low > resolution) {
    mid = (low + high) / 2;
    oklch.C = mid;
    [r, g, b] = oklabToUnclippedRgb(oklchToOklab(oklch));
    if (inGamut([r, g, b])) low = mid;
    else high = mid;
  }
  return clampRgb([r, g, b], color.alpha);
}

export function oklchToRgb(_: OklchColor): RgbColor {
  return oklabToRgb(oklchToOklab(_));
}

export function rgbToOklab(_: RgbColor): OklabColor {
  const [r, g, b] = [_.r, _.g, _.b];

  const rLin = inverseGammaCorrect(r / 255);
  const gLin = inverseGammaCorrect(g / 255);
  const bLin = inverseGammaCorrect(b / 255);

  const L =
    0.41222147079999993 * rLin + 0.5363325363 * gLin + 0.0514459929 * bLin;
  const M =
    0.2119034981999999 * rLin + 0.6806995450999999 * gLin + 0.1073969566 * bLin;
  const S =
    0.08830246189999998 * rLin +
    0.2817188376 * gLin +
    0.6299787005000002 * bLin;

  const L3 = Math.cbrt(L);
  const M3 = Math.cbrt(M);
  const S3 = Math.cbrt(S);

  const result: OklabColor = {
    L: 0.2104542553 * L3 + 0.793617785 * M3 - 0.0040720468 * S3,
    a: 1.9779984951 * L3 - 2.428592205 * M3 + 0.4505937099 * S3,
    b: 0.0259040371 * L3 + 0.7827717662 * M3 - 0.808675766 * S3,
  };
  if (_.alpha !== undefined) result.alpha = _.alpha;
  return result;
}

export function rgbToOklch(_: RgbColor): OklchColor {
  return oklabToOklch(rgbToOklab(_));
}

// --- OKLCH convenience functions (packed 0xRRGGBBAA integers) ---

export function cMaxFor(L: number, Hdeg: number): number {
  const hRad = (Hdeg * Math.PI) / 180;
  let lo = 0;
  let hi = 1.5; // safely above any in-gamut chroma

  for (let i = 0; i < 32; i++) {
    // ~1e-9 precision on C
    const C = (lo + hi) / 2;
    const [r, g, b] = oklabToUnclippedRgb({
      L,
      a: C * Math.cos(hRad),
      b: C * Math.sin(hRad),
    });
    if (r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1) lo = C;
    else hi = C;
  }

  return lo;
}

/**
 * Convert OKLCH to RGB color
 * @param l lightness: 0..100
 * @param c chroma: 0..about 0.4
 * @param h hue: 0..360
 * @returns 0xrrggbbaa color
 */

export function oklch(l: number, c: number, h: number): number {
  const L = l / 100;

  // Special case: At 0% lightness, color should be pure black
  if (L <= 0) return 0x000000ff;

  const rgb = oklchToRgb({ L, C: c, H: h });
  return (
    ((clampByte(rgb.r) << 24) |
      (clampByte(rgb.g) << 16) |
      (clampByte(rgb.b) << 8) |
      255) >>>
    0
  );
}

export function oklchFromRGB(rgba: number): {
  l: number;
  c: number;
  h: number;
} {
  const r = (rgba >>> 24) & 0xff;
  const g = (rgba >>> 16) & 0xff;
  const b = (rgba >>> 8) & 0xff;
  const result = rgbToOklch({ r, g, b });
  return {
    l: result.L * 100,
    c: result.C,
    h: result.H < 0 ? result.H + 360 : result.H,
  };
}

/**
 * Calculate the usable lightness range for a given hue where chroma is above the visibility floor
 *
 * @param Hdeg hue in degrees 0-360
 * @param Cmin minimum distinguishable chroma (0.03-0.06 for UI)
 * @param step lightness sampling step
 * @returns object with darkestL and lightestL values
 */
export function lightnessRangeForHue(
  Hdeg: number,
  Cmin: number = 0.04,
  step: number = 0.002,
): { darkestL: number | null; lightestL: number | null } {
  let Lmin: number | null = null;
  let Lmax: number | null = null;

  for (let L = 0; L <= 1 + 1e-9; L += step) {
    if (cMaxFor(L, Hdeg) >= Cmin) {
      if (Lmin === null) Lmin = L;
      Lmax = L;
    }
  }

  return { darkestL: Lmin, lightestL: Lmax };
}
