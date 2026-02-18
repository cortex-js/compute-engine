// Slim manipulation module — high-level color operations.

import type { HexColor, RgbColor, OklchColor } from "./types";
import { oklch, oklchFromRGB, rgbToHex, parseHexColor, rgbToOklch, oklchToRgb } from "./conversion";
import { parseColor } from "./parsing";
import { apca } from "./contrast";

export function gray(percent: number): number {
  return oklch(percent, 0, 0);
}

export function lighten(color: number, amount: number): number {
  const { l, c, h } = oklchFromRGB(color);
  const alpha = color & 0xff;
  const newL = Math.max(0, Math.min(100, l + amount));
  const newColor = oklch(newL, c, h);
  return (newColor & 0xffffff00) | alpha;
}

export function darken(color: number, amount: number): number {
  return lighten(color, -amount);
}

/**
 * Darken a color by a factor in OKLCH space (perceptually uniform).
 *
 * @param color - Any parseable color string
 * @param factor - Multiplier for lightness (0.6 = 60% of original lightness)
 * @returns `#rrggbb` hex string
 */
export function darkenHex(color: HexColor, factor: number): HexColor {
  const packed = parseColor(color);
  const { l, c, h } = oklchFromRGB(packed);
  const newColor = oklch(Math.max(0, l * factor), c, h);
  const r = (newColor >>> 24) & 0xff;
  const g = (newColor >>> 16) & 0xff;
  const b = (newColor >>> 8) & 0xff;
  return rgbToHex(r, g, b);
}

/**
 * Determine whether a color is "light" (i.e., needs dark text on top).
 *
 * Uses APCA contrast: if a color has higher contrast with black text than
 * white text, it's considered light.
 */
export function isLightColor(color: HexColor): boolean {
  return Math.abs(apca(color, "#000000")) > Math.abs(apca(color, "#ffffff"));
}

/**
 * Linearly interpolate between two `[0-1, 0-1, 0-1]` RGB tuples.
 */
export function mixColors(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const f = Math.max(0, Math.min(1, t));
  return [
    a[0] * (1 - f) + b[0] * f,
    a[1] * (1 - f) + b[1] * f,
    a[2] * (1 - f) + b[2] * f,
  ];
}

/**
 * Mix a `[0-1, 0-1, 0-1]` RGB tuple toward white (positive lift) or
 * black (negative lift).
 *
 * @param color - RGB tuple with values in 0-1 range
 * @param lift - Amount to lift: positive = toward white, negative = toward black
 */
export function liftColor(
  color: [number, number, number],
  lift: number,
): [number, number, number] {
  if (lift === 0) return color;
  const target: [number, number, number] = lift > 0 ? [1, 1, 1] : [0, 0, 0];
  return mixColors(color, target, Math.abs(lift));
}

/**
 * Convert a hex color string to a CSS color string suitable for Canvas or SVG.
 *
 * - `#RRGGBB` is returned as-is.
 * - `#RRGGBBAA` is converted to `rgba(r, g, b, a)`.
 */
/** Interpolate two OKLCh colors at fraction f in [0,1], returning {L, C, H}. */
export function lerpOklch(
  c1: OklchColor,
  c2: OklchColor,
  f: number
): OklchColor {
  const L = c1.L + (c2.L - c1.L) * f;
  const C = c1.C + (c2.C - c1.C) * f;

  // Shorter arc hue interpolation
  let dh = c2.H - c1.H;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  let H = c1.H + dh * f;
  if (H < 0) H += 360;
  if (H >= 360) H -= 360;

  return { L, C, H };
}

/** Interpolate between two hex colors in OKLCh space at fraction f in [0,1]. */
export function interpolateOklch(
  hex1: HexColor,
  hex2: HexColor,
  f: number
): RgbColor {
  const c1 = rgbToOklch(parseHexColor(hex1));
  const c2 = rgbToOklch(parseHexColor(hex2));
  return oklchToRgb(lerpOklch(c1, c2, f));
}

export function colorToCss(color: string): string {
  if (color.length === 9) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    const a = parseInt(color.slice(7, 9), 16) / 255;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return color;
}
