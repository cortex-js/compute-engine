/**
 * Color represented as a hex string.
 *
 * Supports both RGB and RGBA formats:
 * - RGB: "#RRGGBB" (e.g., "#FF0000" for red)
 * - RGBA: "#RRGGBBAA" (e.g., "#FF000080" for red at 50% opacity)
 *
 * The alpha channel (AA) is optional and represents opacity from
 * 00 (fully transparent) to FF (fully opaque).
 */
export type HexColor = string;

// RGB color in the sRGB color space
export type RgbColor = {
  r: number; // 0..255
  g: number; // 0..255
  b: number; // 0..255
  alpha?: number; // 0..1
};

// Perceptual uniform color, can represent colors outside the sRGB gamut
export type OklchColor = {
  L: number; // perceived lightness 0..1
  C: number; // chroma 0.. 0.37
  H: number; // hue 0..360
  alpha?: number; // 0..1
};

// Perceptual uniform color, can represent colors outside the sRGB gamut
export type OklabColor = {
  L: number; // perceived lightness 0..1
  a: number; // green <-> red -0.4..0.4
  b: number; // blue <-> yellow -0.4..0.4
  alpha?: number; // 0..1
};

export type Color = HexColor | RgbColor | OklchColor | OklabColor;
