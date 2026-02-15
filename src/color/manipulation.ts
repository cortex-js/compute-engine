// Helper functions for color calculations

import type { RgbColor } from "./types";
import { FOREGROUND_COLORS } from "./palette";

// sRGB gamma correction
export function gammaCorrect(channel: number): number {
  if (channel <= 0.0031308) return 12.92 * channel;

  return 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

// Inverse sRGB gamma correction
export function inverseGammaCorrect(channel: number): number {
  if (channel <= 0.04045) return channel / 12.92;

  return Math.pow((channel + 0.055) / 1.055, 2.4);
}

function lmsFromLab(
  L: number,
  a: number,
  b: number,
): { l: number; m: number; s: number } {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return { l, m, s };
}

function linSRGBFromLMS({ l, m, s }: { l: number; m: number; s: number }): {
  r: number;
  g: number;
  b: number;
} {
  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function inSRGB(r: number, g: number, b: number): boolean {
  return r >= 0 && g >= 0 && b >= 0 && r <= 1 && g <= 1 && b <= 1;
}

function findMaxChromaInGamut(
  l: number,
  h: number,
  targetChroma: number,
): number {
  // If target chroma is very low, no need to reduce it
  if (targetChroma <= 0.01) return targetChroma;

  // Binary search to find maximum chroma that produces in-gamut RGB
  let low = 0;
  let high = targetChroma;
  const tolerance = 0.001;
  let iterations = 0;
  const maxIterations = 20;

  while (high - low > tolerance && iterations < maxIterations) {
    const mid = (low + high) / 2;

    // Test if this chroma produces in-gamut RGB
    const hRad = (h * Math.PI) / 180;
    const labA = mid * Math.cos(hRad);
    const labB = mid * Math.sin(hRad);

    // OKLab to linear RGB
    const l_ = l + 0.3963377774 * labA + 0.2158037573 * labB;
    const m_ = l - 0.1055613458 * labA - 0.0638541728 * labB;
    const s_ = l - 0.0894841775 * labA - 1.291485548 * labB;

    const l_cubed = l_ * l_ * l_;
    const m_cubed = m_ * m_ * m_;
    const s_cubed = s_ * s_ * s_;

    const linearR =
      4.0767416621 * l_cubed - 3.3077115913 * m_cubed + 0.2309699292 * s_cubed;
    const linearG =
      -1.2684380046 * l_cubed + 2.6097574011 * m_cubed - 0.3413193965 * s_cubed;
    const linearB =
      -0.0041960863 * l_cubed - 0.7034186147 * m_cubed + 1.707614701 * s_cubed;

    // Apply sRGB gamma correction
    const r = gammaCorrect(linearR);
    const g = gammaCorrect(linearG);
    const b = gammaCorrect(linearB);

    // Check if all channels are in gamut (0-1 range)
    if (
      r >= -0.001 &&
      r <= 1.001 &&
      g >= -0.001 &&
      g <= 1.001 &&
      b >= -0.001 &&
      b <= 1.001
    )
      low = mid;
    else high = mid;

    iterations++;
  }

  return low;
}

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

// Core color manipulation functions

export function cMaxFor(L: number, Hdeg: number): number {
  const H = (Hdeg * Math.PI) / 180;
  let lo = 0;
  let hi = 1.5; // safely above any in-gamut chroma

  for (let i = 0; i < 32; i++) {
    // ~1e-9 precision on C
    const C = (lo + hi) / 2;
    const a = C * Math.cos(H);
    const b = C * Math.sin(H);
    const lms = lmsFromLab(L, a, b);
    const { r, g, b: bb } = linSRGBFromLMS(lms);

    if (inSRGB(r, g, bb)) lo = C;
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
  // Convert to 0-1 range
  l = l / 100;

  // Special case: At 0% lightness, color should be pure black
  if (l <= 0.0) return ((0 << 24) | (0 << 16) | (0 << 8) | 255) >>> 0; // #000000

  // Apply gamut mapping to reduce chroma if needed to preserve hue
  const mappedChroma = findMaxChromaInGamut(l, h, c);

  // Convert to Lab with the gamut-mapped chroma
  const hRad = (h * Math.PI) / 180;
  const labA = mappedChroma * Math.cos(hRad);
  const labB = mappedChroma * Math.sin(hRad);

  // OKLab to linear RGB
  const l_ = l + 0.3963377774 * labA + 0.2158037573 * labB;
  const m_ = l - 0.1055613458 * labA - 0.0638541728 * labB;
  const s_ = l - 0.0894841775 * labA - 1.291485548 * labB;

  const l_cubed = l_ * l_ * l_;
  const m_cubed = m_ * m_ * m_;
  const s_cubed = s_ * s_ * s_;

  const linearR =
    4.0767416621 * l_cubed - 3.3077115913 * m_cubed + 0.2309699292 * s_cubed;
  const linearG =
    -1.2684380046 * l_cubed + 2.6097574011 * m_cubed - 0.3413193965 * s_cubed;
  const linearB =
    -0.0041960863 * l_cubed - 0.7034186147 * m_cubed + 1.707614701 * s_cubed;

  // Apply sRGB gamma correction
  let r = gammaCorrect(linearR);
  let g = gammaCorrect(linearG);
  let b = gammaCorrect(linearB);

  // With proper gamut mapping, these should already be in range, but clamp as safety
  r = Math.max(0, Math.min(1, r));
  g = Math.max(0, Math.min(1, g));
  b = Math.max(0, Math.min(1, b));

  const rByte = Math.round(r * 255);
  const gByte = Math.round(g * 255);
  const bByte = Math.round(b * 255);

  return ((rByte << 24) | (gByte << 16) | (bByte << 8) | 255) >>> 0;
}

export function oklchFromRGB(rgba: number): {
  l: number;
  c: number;
  h: number;
} {
  // Extract RGB components
  const r = ((rgba >>> 24) & 0xff) / 255;
  const g = ((rgba >>> 16) & 0xff) / 255;
  const bChannel = ((rgba >>> 8) & 0xff) / 255;

  // Remove sRGB gamma correction
  const rLinear = inverseGammaCorrect(r);
  const gLinear = inverseGammaCorrect(g);
  const bLinear = inverseGammaCorrect(bChannel);

  // Linear RGB to OKLab
  const l_ = Math.cbrt(
    0.4122214708 * rLinear + 0.5363325363 * gLinear + 0.0514459929 * bLinear,
  );
  const m_ = Math.cbrt(
    0.2119034982 * rLinear + 0.6806995451 * gLinear + 0.1073969566 * bLinear,
  );
  const s_ = Math.cbrt(
    0.0883024619 * rLinear + 0.2817188376 * gLinear + 0.6299787005 * bLinear,
  );

  const lValue = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const aValue = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bValue = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  // Convert to LCH
  const c = Math.sqrt(aValue * aValue + bValue * bValue);
  let h = (Math.atan2(bValue, aValue) * 180) / Math.PI;
  if (h < 0) h += 360;

  return {
    l: lValue * 100, // Convert to 0-100 range
    c: c,
    h: h,
  };
}

// Helper function to interpolate between two colors in OKLCH space
function interpolateColor(color1: number, color2: number, t: number): number {
  const { l: l1, c: c1, h: h1 } = oklchFromRGB(color1);
  const { l: l2, c: c2, h: h2 } = oklchFromRGB(color2);

  // Interpolate in OKLCH space for perceptually uniform results
  const l = l1 + (l2 - l1) * t;
  const c = c1 + (c2 - c1) * t;

  // Handle hue interpolation (shortest path around the circle)
  let hDiff = h2 - h1;
  if (hDiff > 180) hDiff -= 360;
  if (hDiff < -180) hDiff += 360;
  const h = h1 + hDiff * t;

  // Interpolate alpha
  const a1 = color1 & 0xff;
  const a2 = color2 & 0xff;
  const a = Math.round(a1 + (a2 - a1) * t);

  const newColor = oklch(l, c, h < 0 ? h + 360 : h > 360 ? h - 360 : h);
  return (newColor & 0xffffff00) | a;
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

/**
 * Generate optimal darkest and lightest colors for a given hue using practical UI guidelines
 *
 * @param hue hue in degrees 0-360
 * @param chromaBackoff percentage to back off from maximum chroma to avoid edge clipping (0.05 = 5%)
 * @param minChroma minimum distinguishable chroma for UI visibility
 * @returns object with darkest and lightest colors in 0xrrggbbaa format
 */

export function getOptimalHueRange(
  hue: number,
  chromaBackoff: number = 0.1,
  _minChroma: number = 0.04,
): { darkest: number; lightest: number } {
  // Target chroma values based on perceptual requirements
  const targetDarkChroma = 0.15; // Dark colors need higher chroma for visible tint
  const targetLightChroma = 0.02; // Light colors appear tinted with minimal chroma

  // Practical lightness ranges for UI
  const darkLightnessMin = 0.35; // Not too dark
  const darkLightnessMax = 0.45; // Still clearly "dark"
  const lightLightnessMax = 0.96; // Not pure white

  // Find optimal darkest color:
  // Iterate through lightness range to find where we can achieve target chroma
  let bestDarkL = darkLightnessMax;
  let bestDarkChroma = 0;

  for (let L = darkLightnessMax; L >= darkLightnessMin; L -= 0.01) {
    const maxC = cMaxFor(L, hue);
    if (maxC >= targetDarkChroma) {
      // Found a lightness that supports our target chroma
      bestDarkL = L;
      bestDarkChroma = targetDarkChroma;
      break;
    } else if (maxC > bestDarkChroma) {
      // Track the best we can do
      bestDarkL = L;
      bestDarkChroma = maxC;
    }
  }

  // If we still can't get enough chroma, try going slightly lighter
  if (bestDarkChroma < targetDarkChroma * 0.8) {
    for (let L = darkLightnessMax + 0.01; L <= 0.5; L += 0.01) {
      const maxC = cMaxFor(L, hue);
      if (maxC >= targetDarkChroma || maxC > bestDarkChroma * 1.2) {
        bestDarkL = L;
        bestDarkChroma = Math.min(targetDarkChroma, maxC);
        break;
      }
    }
  }

  // Find optimal lightest color:
  // For light colors, we want minimal chroma but maximum lightness
  const bestLightL = lightLightnessMax;
  let bestLightChroma = targetLightChroma;

  // Check if we can achieve target chroma at maximum lightness
  const maxLightChroma = cMaxFor(lightLightnessMax, hue);
  if (maxLightChroma < targetLightChroma) {
    // If not, use what's available
    bestLightChroma = maxLightChroma * (1 - chromaBackoff);
  }

  // Ensure we have at least some visible chroma
  bestLightChroma = Math.max(
    0.015,
    Math.min(targetLightChroma, bestLightChroma),
  );

  // Convert back to 0-100 lightness range for oklch function
  const darkest = oklch(bestDarkL * 100, bestDarkChroma, hue);
  const lightest = oklch(bestLightL * 100, bestLightChroma, hue);

  return { darkest, lightest };
}

// Exported manipulation functions

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
 * Return a shade of the color.
 *
 * The index is a value between 0 and 1000. 0 represent the darkest shade (black) and 1000 represent the lightest shade (white).
 *
 * If color is a single number, the darkest shade and lightest shade are determined based on the hue and chroma of the color, with a 10% lightness for the darkest shade and a 95% lightness for the lightest shade.
 *
 * If `mid` is not provided, it is linearly interpolated between the darkest
 * and lightest shades.
 *
 * The result is determined by interpolating along a s-curve between the darkest and lightest shades, with the `mid` value at index 500.
 *
 * If any of the colors are a string, they are parsed with `parseColor`.
 *
 * @todo: provide a LaTeX equation of the s-curve interpolation function used
 *
 */

export function shade(
  color:
    | string
    | number
    | {
        lightest: number | string;
        darkest: number | string;
        mid?: number | string;
      },
  index: number,
): number {
  // Clamp index to 0-1000 range
  const idx = Math.max(0, Math.min(1000, index));

  let darkest: number, mid: number, lightest: number;

  if (typeof color === "object") {
    // Parse the provided colors
    darkest =
      typeof color.darkest === "string"
        ? parseColor(color.darkest)
        : color.darkest;
    lightest =
      typeof color.lightest === "string"
        ? parseColor(color.lightest)
        : color.lightest;
    mid = color.mid
      ? typeof color.mid === "string"
        ? parseColor(color.mid)
        : color.mid
      : 0;
  } else {
    // Single color provided - generate shades using gamut-aware algorithm
    mid = typeof color === "string" ? parseColor(color) : color;
    const { h } = oklchFromRGB(mid);
    const alpha = mid & 0xff;

    // Use gamut-limit curve to find optimal darkest and lightest colors
    const { darkest: optimalDarkest, lightest: optimalLightest } =
      getOptimalHueRange(h);

    // Apply alpha channel from base color
    darkest = (optimalDarkest & 0xffffff00) | alpha;
    lightest = (optimalLightest & 0xffffff00) | alpha;
  }

  // If no mid color was provided, use the center point
  if (!mid && typeof color === "object" && !color.mid)
    mid = interpolateColor(darkest, lightest, 0.5);

  // S-curve interpolation with consistent smooth step function
  // Fixed: Lower index = lighter, higher index = darker
  if (idx <= 500) {
    // Interpolate from lightest to mid
    const localT = idx / 500;
    // Smooth step for light side
    const smoothT = localT * localT * (3 - 2 * localT);
    return interpolateColor(lightest, mid, smoothT);
  }
  // Interpolate from mid to darkest
  const localT = (idx - 500) / 500;
  // Use the same smooth step for consistency
  const smoothT = localT * localT * (3 - 2 * localT);
  return interpolateColor(mid, darkest, smoothT);
}

/**
 * Return true if `s` is a named color from the FOREGROUND_COLORS palette
 * (e.g. "red", "blue", "dark-grey") or "transparent".
 */
export function isNamedColor(s: string): boolean {
  const str = s.trim().toLowerCase();
  return str === "transparent" || str in FOREGROUND_COLORS;
}

/**
 * Given a string `s` in the following formats, return a 0xrrggbbaa color.
 * - hex: #rrggbbaa, #rgb, #rrggbb
 * - rgba: rgba(r, g, b, a)
 * - rgb: rgb(r, g, b) or rgb(r, g, b / a) or rgb(r g b / a) or rgb(r g b)
 * - oklch: oklch(l c h / a) or oklch(l c h) or oklch(l, c, h / a) or oklch(l, c, h), when l is a percentage, c is a number between 0 and 0.4, and h is a number between 0 and 360, for example "oklch(50% 0.3 240 / 0.8)" or "oklch(50% 0.3 240 / 80%)"
 * - hsl: hsl(h, s, l) or hsl(h, s, l / a) or hsl(h s l / a) or hsl(h s l), where h is a number between 0 and 360, s is a percentage, l is a percentage and a is a percentage
 * - named: color names from the FOREGROUND_COLORS palette (e.g. "red", "blue", "cyan", "dark-grey") or "transparent"
 */

export function parseColor(s: string): number {
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

  // Named color lookup
  if (str in FOREGROUND_COLORS)
    return parseColor(FOREGROUND_COLORS[str as keyof typeof FOREGROUND_COLORS]);

  console.warn(`parseColor: unrecognized color "${s}"`);
  return 0;
}

export function parseColorToRgb(s: string): RgbColor {
  const color = parseColor(s);
  return {
    r: (color >>> 24) & 0xff,
    g: (color >>> 16) & 0xff,
    b: (color >>> 8) & 0xff,
    alpha: (color & 0xff) / 255,
  };
}
