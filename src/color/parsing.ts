import type { HexColor, RgbColor } from "./types";
import {
  oklch,
  oklabToRgb,
  hslToRgb,
  rgbToHex,
} from "./conversion";
import { shade } from "./interpolation";
import { getLightShadeMap, getDarkShadeMap } from "./scale";

// --- Named colors ---

const NAMED_COLORS = {
  red: "#d7170b", //<- 700, 500 ->'#f21c0d'
  orange: "#fe8a2b",
  yellow: "#ffc02b", // <- 600, 500 -> '#ffcf33',
  lime: "#63b215",
  green: "#21ba3a",
  teal: "#17cfcf",
  cyan: "#13a7ec",
  blue: "#0d80f2",
  indigo: "#63c",
  purple: "#a219e6",
  magenta: "#eb4799",
  brown: "#8c564b",
  olive: "#8a8f2a",
  midnight: "#2c4670",
  sky: "#d2dce9",
  black: "#000",
  white: "#ffffff",
  carbon: "#111111", // near-black, high-contrast text
  charcoal: "#333333", // primary axis / label color
  slate: "#555555", // secondary text, major gridlines
  "dark-grey": "#666",
  graphite: "#777777", // minor gridlines
  stone: "#999999", // de-emphasized strokes
  grey: "#A6A6A6",
  "light-grey": "#d4d5d2",
  ash: "#E6E6E6", // subtle fills, light strokes
  mist: "#F3F3F3", // light background tint
  snow: "#FFFFFF", // pure white
} as const;

// --- Parsing ---

/**
 * Return true if `s` is a named color from the NAMED_COLORS palette
 * (e.g. "red", "blue", "dark-grey") or "transparent".
 */
export function isNamedColor(s: string): boolean {
  const str = s.trim().toLowerCase();
  return str === "transparent" || str in NAMED_COLORS;
}

/**
 * Given a string `s` in the following formats, return a 0xrrggbbaa color.
 * - hex: #rrggbbaa, #rgb, #rrggbb
 * - rgba: rgba(r, g, b, a)
 * - rgb: rgb(r, g, b) or rgb(r, g, b / a) or rgb(r g b / a) or rgb(r g b)
 * - oklch: oklch(l c h / a) or oklch(l c h) or oklch(l, c, h / a) or oklch(l, c, h), when l is a percentage, c is a number between 0 and 0.4, and h is a number between 0 and 360, for example "oklch(50% 0.3 240 / 0.8)" or "oklch(50% 0.3 240 / 80%)"
 * - oklab: oklab(L a b / alpha) or oklab(L a b), where L is 0-1 (or percentage), a is ~-0.4 to 0.4, b is ~-0.4 to 0.4
 * - hsl: hsl(h, s, l) or hsl(h, s, l / a) or hsl(h s l / a) or hsl(h s l), where h is a number between 0 and 360, s is a percentage, l is a percentage and a is a percentage
 * - named: color names from the NAMED_COLORS palette (e.g. "red", "blue", "cyan", "dark-grey") or "transparent"
 * - palette: "{name}-{shade}" from COLOR_SCALE_PRESETS (e.g. "red-700", "blue-300"). When `darkMode` is true, shades are derived from COLOR_SCALE_PRESETS_DARK instead.
 */

export function parseColor(s: string, darkMode?: boolean): number {
  const str = s.trim().toLowerCase();

  // Hex format
  if (str.startsWith("#")) {
    const hex = str.substring(1);
    let r: number,
      g: number,
      b: number,
      a = 255;

    if (hex.length === 3) {
      // #rgb
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      // #rrggbb
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    } else if (hex.length === 8) {
      // #rrggbbaa
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
      a = parseInt(hex.substring(6, 8), 16);
    } else return 0;

    return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
  }

  // RGB/RGBA format
  const rgbMatch = str.match(/^rgba?\s*\(\s*([^)]+)\s*\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].replace(/[,/]/g, " ").trim().split(/\s+/);

    // Parse RGB values (can be 0-255 or 0-1)
    let r = parseFloat(parts[0]) || 0;
    let g = parseFloat(parts[1]) || 0;
    let b = parseFloat(parts[2]) || 0;

    // Check if RGB values are percentages or 0-1 range
    if (
      parts[0].includes("%") ||
      parts[1].includes("%") ||
      parts[2].includes("%")
    ) {
      // Handle percentage values
      if (parts[0].includes("%")) r = (r / 100) * 255;
      if (parts[1].includes("%")) g = (g / 100) * 255;
      if (parts[2].includes("%")) b = (b / 100) * 255;
    } else if (r <= 1 && g <= 1 && b <= 1) {
      // If all values are <= 1, treat as 0-1 range
      r = r * 255;
      g = g * 255;
      b = b * 255;
    }
    // Otherwise assume 0-255 range

    r = Math.round(Math.max(0, Math.min(255, r)));
    g = Math.round(Math.max(0, Math.min(255, g)));
    b = Math.round(Math.max(0, Math.min(255, b)));

    let a = 255;
    if (parts.length >= 4) {
      let alpha = parseFloat(parts[3]);
      if (parts[3].includes("%")) alpha = alpha / 100;
      else if (alpha > 1) alpha = alpha / 255;

      // Otherwise alpha is already in 0-1 range
      a = Math.round(Math.max(0, Math.min(255, alpha * 255)));
    }

    return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
  }

  // OKLCH format
  const oklchMatch = str.match(/^oklch\s*\(\s*([^)]+)\s*\)$/);
  if (oklchMatch) {
    const parts = oklchMatch[1].replace(/[,/]/g, " ").trim().split(/\s+/);
    let l = parseFloat(parts[0]);
    if (parts[0].includes("%")) l = l / 100;
    else if (l <= 1) {
      // If value is 0-1, treat as percentage
      // l is already in the correct range
    } else {
      // Assume 0-100 range
      l = l / 100;
    }
    const c = parseFloat(parts[1]) || 0;
    const h = parseFloat(parts[2]) || 0;
    let alpha = 1;

    if (parts.length >= 4) {
      alpha = parseFloat(parts[3]);
      if (parts[3].includes("%")) alpha = alpha / 100;
      else if (alpha > 1) {
        // If alpha > 1, assume 0-255 range
        alpha = alpha / 255;
      }
      // Otherwise alpha is already in 0-1 range
    }

    const rgb = oklch(l * 100, c, h);
    const a = Math.round(alpha * 255);
    return (rgb & 0xffffff00) | a;
  }

  // OKLab format
  const oklabMatch = str.match(/^oklab\s*\(\s*([^)]+)\s*\)$/);
  if (oklabMatch) {
    const parts = oklabMatch[1].replace(/[,/]/g, " ").trim().split(/\s+/);
    let l = parseFloat(parts[0]);
    if (parts[0].includes("%")) l = l / 100;
    else if (l > 1) l = l / 100; // Assume 0-100 range

    const labA = parseFloat(parts[1]) || 0;
    const labB = parseFloat(parts[2]) || 0;

    let alpha = 1;
    if (parts.length >= 4) {
      alpha = parseFloat(parts[3]);
      if (parts[3].includes("%")) alpha = alpha / 100;
      else if (alpha > 1) alpha = alpha / 255;
    }

    // OKLab -> sRGB using oklabToRgb from conversion.ts
    const rgb = oklabToRgb({ L: l, a: labA, b: labB });
    const rByte = rgb.r;
    const gByte = rgb.g;
    const bByte = rgb.b;
    const alphaByte = Math.round(alpha * 255);

    return ((rByte << 24) | (gByte << 16) | (bByte << 8) | alphaByte) >>> 0;
  }

  // HSL format
  const hslMatch = str.match(/^hsl\s*\(\s*([^)]+)\s*\)$/);
  if (hslMatch) {
    const parts = hslMatch[1].replace(/[,/]/g, " ").trim().split(/\s+/);
    const h = parseFloat(parts[0]) || 0;

    // Parse saturation
    let s = parseFloat(parts[1]) || 0;
    if (parts[1].includes("%")) s = s / 100;
    else if (s <= 1) {
      // Already in 0-1 range
    } else {
      // Assume 0-100 range
      s = s / 100;
    }

    // Parse lightness
    let l = parseFloat(parts[2]) || 0;
    if (parts[2].includes("%")) l = l / 100;
    else if (l <= 1) {
      // Already in 0-1 range
    } else {
      // Assume 0-100 range
      l = l / 100;
    }

    let alpha = 1;
    if (parts.length >= 4) {
      alpha = parseFloat(parts[3]);
      if (parts[3].includes("%")) alpha = alpha / 100;
      else if (alpha > 1) {
        // If alpha > 1, assume 0-255 range
        alpha = alpha / 255;
      }
      // Otherwise alpha is already in 0-1 range
    }

    const { r, g, b } = hslToRgb(h, s, l);
    const a = Math.round(alpha * 255);
    return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
  }

  if (str === "transparent") return 0;

  // Palette color (e.g. "red-700")
  const paletteMatch = str.match(/^([a-z]+)-(\d+)$/);
  if (paletteMatch) {
    const map = darkMode ? getDarkShadeMap() : getLightShadeMap();
    const input = map[paletteMatch[1]];
    if (input) {
      return shade(input, parseInt(paletteMatch[2], 10));
    }
  }

  // Named color lookup
  if (str in NAMED_COLORS)
    return parseColor(NAMED_COLORS[str as keyof typeof NAMED_COLORS]);

  console.warn(`parseColor: unrecognized color "${s}"`);
  return 0;
}

export function parseColorToRgb(s: string, darkMode?: boolean): RgbColor {
  const color = parseColor(s, darkMode);
  return {
    r: (color >>> 24) & 0xff,
    g: (color >>> 16) & 0xff,
    b: (color >>> 8) & 0xff,
    alpha: (color & 0xff) / 255,
  };
}

export function parseColorToHex(s: string, darkMode?: boolean): HexColor {
  const color = parseColor(s, darkMode);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const rHex = clamp((color >>> 24) & 0xff)
    .toString(16)
    .padStart(2, "0");
  const gHex = clamp((color >>> 16) & 0xff)
    .toString(16)
    .padStart(2, "0");
  const bHex = clamp((color >>> 8) & 0xff)
    .toString(16)
    .padStart(2, "0");

  const alpha = clamp(color & 0xff)
    .toString(16)
    .padStart(2, "0");
  if (alpha === "ff") return `#${rHex}${gHex}${bHex}`;
  return `#${rHex}${gHex}${bHex}${alpha}`;
}

/**
 * Parse any color string to a `[0-1, 0-1, 0-1]` float tuple.
 * Useful for WebGL uniforms that expect normalized RGB values.
 */
export function parseColorToRgb01(
  s: string,
  darkMode?: boolean,
): [number, number, number] {
  const color = parseColor(s, darkMode);
  return [
    ((color >>> 24) & 0xff) / 255,
    ((color >>> 16) & 0xff) / 255,
    ((color >>> 8) & 0xff) / 255,
  ];
}

/**
 * Parse any color string to a `[0-1, 0-1, 0-1, 0-1]` float tuple (RGBA).
 * Useful for WebGL uniforms that need both color and alpha.
 */
export function parseColorToRgba01(
  s: string,
  darkMode?: boolean,
): [number, number, number, number] {
  const color = parseColor(s, darkMode);
  return [
    ((color >>> 24) & 0xff) / 255,
    ((color >>> 16) & 0xff) / 255,
    ((color >>> 8) & 0xff) / 255,
    (color & 0xff) / 255,
  ];
}

/**
 * Set the alpha channel of a color string.
 *
 * @returns `#rrggbbaa` hex string (or `#rrggbb` if alpha is 1.0)
 */
export function parseColorWithAlpha(
  color: string,
  alpha: number,
  darkMode?: boolean,
): string {
  const parsed = parseColor(color, darkMode);
  const r = (parsed >>> 24) & 0xff;
  const g = (parsed >>> 16) & 0xff;
  const b = (parsed >>> 8) & 0xff;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  if (a === 255) return rgbToHex(r, g, b);
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}${a
    .toString(16)
    .padStart(2, "0")}`;
}

/**
 * Check if a string is a valid, parseable color.
 *
 * Returns true for hex, rgb/rgba, oklch, hsl, named colors, and "transparent".
 */
export function isValidColor(s: string): boolean {
  const str = s.trim().toLowerCase();
  if (str === "transparent") return true;
  if (str in NAMED_COLORS) return true;
  if (str.startsWith("#")) {
    const hex = str.substring(1);
    return [3, 6, 8].includes(hex.length) && /^[0-9a-f]+$/.test(hex);
  }
  if (/^(rgba?|oklch|hsl)\s*\(/.test(str)) return true;
  // Palette color (e.g. "red-700")
  const palMatch = str.match(/^([a-z]+)-(\d+)$/);
  if (palMatch && palMatch[1] in getLightShadeMap()) return true;
  // Accept bare alphabetic strings as potential CSS named colors
  if (/^[a-z]+$/.test(str)) return true;
  return false;
}
