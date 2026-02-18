// Types
export type {
  HexColor,
  Color,
  RgbColor,
  OklchColor,
  OklabColor,
} from "./types";

// Conversion (packed-int OKLCH)
export {
  oklch,
  oklchFromRGB,
  colorToHex,
  inverseGammaCorrect,
  cMaxFor,
  rgbToOklch,
  oklchToRgb,
  rgbToHsl,
  hslToRgb,
  rgbToOklab,
  oklabToRgb,
} from "./conversion";

// Parsing (string → color)
export {
  parseColor,
  parseColorToHex,
  parseColorToRgb,
  parseColorToRgb01,
  parseColorToRgba01,
  parseColorWithAlpha,
  isValidColor,
  isNamedColor,
} from "./parsing";

// Shading
export { shade, getOptimalHueRange } from "./interpolation";

// Contrast and accessibility
export { apca, contrastingColor } from "./contrast";

// Manipulation
export {
  gray,
  lighten,
  darken,
  darkenHex,
  isLightColor,
  mixColors,
  liftColor,
  lerpOklch,
  interpolateOklch,
  colorToCss,
} from "./utilities";

// Color palette
export * from "./scale-presets";
export * from "./scale";
