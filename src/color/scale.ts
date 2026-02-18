import { oklch, colorToHex } from "./conversion";
import { shade } from "./interpolation";
import {
  COLOR_SCALE_PRESETS,
  COLOR_SCALE_PRESETS_DARK,
  type ColorScalePreset,
  type NamedColor,
  type ColorScaleStop,
} from "./scale-presets";

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
type ShadeInput = Parameters<typeof shade>[0];

function stopToNumber({ lightness, chroma, hue }: ColorScaleStop): number {
  return oklch(lightness, chroma, hue);
}

function presetToShadeInput(preset: ColorScalePreset): ShadeInput {
  const { mid, lightest, darkest } = preset.colors;
  if (lightest && darkest && mid) {
    return {
      lightest: stopToNumber(lightest),
      mid: stopToNumber(mid),
      darkest: stopToNumber(darkest),
    };
  }
  if (lightest && darkest) {
    return {
      lightest: stopToNumber(lightest),
      darkest: stopToNumber(darkest),
    };
  }
  if (mid) return stopToNumber(mid);
  throw new Error(
    `Color scale preset "${preset.id}" is missing required anchors.`,
  );
}

// --- Shade maps (light + dark) ---

type ShadeInputMap = Record<string, ShadeInput>;

let _lightShadeMap: ShadeInputMap | null = null;
let _darkShadeMap: ShadeInputMap | null = null;

export function getLightShadeMap(): ShadeInputMap {
  if (!_lightShadeMap) {
    _lightShadeMap = Object.create(null) as ShadeInputMap;
    for (const preset of COLOR_SCALE_PRESETS) {
      _lightShadeMap[preset.id] = presetToShadeInput(preset);
    }
  }
  return _lightShadeMap;
}

export function getDarkShadeMap(): ShadeInputMap {
  if (!_darkShadeMap) {
    _darkShadeMap = Object.create(null) as ShadeInputMap;
    for (let i = 0; i < COLOR_SCALE_PRESETS.length; i++) {
      _darkShadeMap[COLOR_SCALE_PRESETS[i].id] = presetToShadeInput(
        COLOR_SCALE_PRESETS_DARK[i],
      );
    }
  }
  return _darkShadeMap;
}

// --- Palette color helpers ---

function paletteColor(id: NamedColor, n = 500): string {
  return colorToHex(shade(getLightShadeMap()[id], n));
}

export function shades(fn: (n: number) => string) {
  return Object.fromEntries(SHADES.map((n) => [n, fn(n)]));
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
