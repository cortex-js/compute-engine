import { oklch, oklchFromRGB, parseColor, shade } from "./manipulation";
import { colorToHex } from "./conversion";
import {
  COLOR_SCALE_PRESETS,
  type ColorScalePreset,
  type NamedColor,
  type ColorScaleStop,
} from "./color-presets";

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
type ShadeInput = Parameters<typeof shade>[0];

type ShadeInputMap = Record<NamedColor, ShadeInput>;
const SHADE_INPUT_MAP = COLOR_SCALE_PRESETS.reduce<ShadeInputMap>(
  (acc, preset) => {
    acc[preset.id] = toShadeInput(preset);
    return acc;
  },
  Object.create(null) as ShadeInputMap
);

function toOklchString({ lightness, chroma, hue }: ColorScaleStop): string {
  return `oklch(${lightness}% ${chroma} ${hue})`;
}

function toShadeInput(preset: ColorScalePreset): ShadeInput {
  const { colors } = preset;
  const { mid, lightest, darkest } = colors;

  if (lightest && darkest && mid) {
    return {
      lightest: toOklchString(lightest),
      mid: toOklchString(mid),
      darkest: toOklchString(darkest),
    };
  }

  if (lightest && darkest) {
    return {
      lightest: toOklchString(lightest),
      darkest: toOklchString(darkest),
    };
  }

  if (mid) {
    return toOklchString(mid);
  }

  throw new Error(
    `Color scale preset "${preset.id}" is missing required anchors.`
  );
}

function paletteColor(id: NamedColor, n = 500): string {
  return colorToHex(shade(SHADE_INPUT_MAP[id], n));
}

export function shades(fn: (n: number) => string) {
  return Object.fromEntries(SHADES.map((n) => [n, fn(n)]));
}

export function darkShades(fn: (n: number) => string) {
  return Object.fromEntries(
    SHADES.map((n) => {
      const { l, c, h } = oklchFromRGB(parseColor(fn(n)));
      return [n, colorToHex(oklch(l + 2.8, c + 0.002, h + 0.46))];
    })
  );
}

export function yellow(n = 500) {
  return paletteColor("yellow", n);
}
export function brown(n = 500) {
  return paletteColor("brown", n);
}

export function red(n = 500) {
  return paletteColor("red", n);
}

export function orange(n = 500) {
  return paletteColor("orange", n);
}

export function lime(n = 500) {
  return paletteColor("lime", n);
}

export function green(n = 500) {
  return paletteColor("green", n);
}

export function pink(n = 500) {
  return paletteColor("pink", n);
}
export function purple(n = 500) {
  return paletteColor("purple", n);
}

export function indigo(n = 500) {
  return paletteColor("indigo", n);
}

export function blue(n = 500) {
  return paletteColor("blue", n);
}

export function teal(n = 500) {
  return paletteColor("teal", n);
}

export function cyan(n = 500) {
  return paletteColor("cyan", n);
}

export function gray(percent: number): number {
  return oklch(percent, 0, 0);
}
