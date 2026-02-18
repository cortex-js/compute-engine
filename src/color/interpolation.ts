import { oklch, oklchFromRGB, cMaxFor } from "./conversion";

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
 * Generate optimal darkest and lightest colors for a given hue using practical UI guidelines
 *
 * @param hue hue in degrees 0-360
 * @param chromaBackoff percentage to back off from maximum chroma to avoid edge clipping (0.05 = 5%)
 * @returns object with darkest and lightest colors in 0xrrggbbaa format
 */

export function getOptimalHueRange(
  hue: number,
  chromaBackoff: number = 0.1,
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
 * All colors are packed 0xRRGGBBAA integers.
 *
 * @todo: provide a LaTeX equation of the s-curve interpolation function used
 *
 */

export function shade(
  color:
    | number
    | {
        lightest: number;
        darkest: number;
        mid?: number;
      },
  index: number,
): number {
  // Clamp index to 0-1000 range
  const idx = Math.max(0, Math.min(1000, index));

  let darkest: number, mid: number, lightest: number;

  if (typeof color === "object") {
    darkest = color.darkest;
    lightest = color.lightest;
    mid = color.mid ?? 0;
  } else {
    // Single color provided - generate shades using gamut-aware algorithm
    mid = color;
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
