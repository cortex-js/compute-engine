export type ColorScaleMode = "single" | "two" | "three";
export type ColorScaleTheme = "light" | "dark";

export interface ColorScaleStop {
  /** Lightness component in OKLCH (percentage 0-100). */
  lightness: number;
  /** Chroma component in OKLCH (approx 0-0.4 in practice). */
  chroma: number;
  /** Hue component in OKLCH (degrees 0-360). */
  hue: number;
}

export interface ColorScalePreset {
  id: string;
  name: string;
  theme: ColorScaleTheme;
  colors: {
    mid?: ColorScaleStop;
    darkest?: ColorScaleStop;
    lightest?: ColorScaleStop;
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function shiftHue(hue: number, shift: number) {
  const wrapped = (hue + shift) % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function toDarkStop(
  stop: ColorScaleStop | undefined
): ColorScaleStop | undefined {
  if (!stop) return undefined;
  return {
    lightness: clamp(stop.lightness + 2.8, 0, 100),
    chroma: clamp(stop.chroma + 0.002, 0, 0.4),
    hue: shiftHue(stop.hue, 0.46),
  };
}

export const COLOR_SCALE_PRESETS = [
  {
    id: "pink",
    name: "Pink",
    theme: "light",
    colors: {
      mid: { lightness: 69, chroma: 0.202, hue: 7.4 },
    },
  },
  {
    id: "red",
    name: "Red",
    theme: "light",
    colors: {
      lightest: { lightness: 95, chroma: 0.2, hue: 30 },
      mid: { lightness: 62, chroma: 0.25, hue: 30 },
      darkest: { lightness: 36, chroma: 0.16, hue: 25 },
    },
  },
  {
    id: "brown",
    name: "Brown",
    theme: "light",
    colors: {
      lightest: { lightness: 94.5, chroma: 0.021, hue: 72.1 },
      mid: { lightness: 59, chroma: 0.2, hue: 73 },
      darkest: { lightness: 20, chroma: 0.061, hue: 72.7 },
    },
  },
  // {
  //   id: "orange2",
  //   name: "Orange 2",
  //   theme: "light",
  //   colors: {
  //     lightest: { lightness: 95, chroma: 0.1, hue: 73 },
  //     mid: { lightness: 67, chroma: 0.23, hue: 54 },
  //     darkest: { lightness: 43, chroma: 0.2, hue: 37 },
  //   },
  // },
  {
    id: "orange",
    name: "Orange",
    theme: "light",
    colors: {
      lightest: { lightness: 95, chroma: 0.06, hue: 82 },
      mid: { lightness: 73, chroma: 0.21, hue: 56 },
      darkest: { lightness: 46, chroma: 0.2, hue: 35 },
    },
  },
  {
    id: "yellow",
    name: "Yellow",
    theme: "light",
    // colors: {
    //   lightest: { lightness: 95, chroma: 0.15, hue: 106 },
    //   mid: { lightness: 67, chroma: 0.28, hue: 87 },
    //   darkest: { lightness: 48, chroma: 0.11, hue: 52 },
    // },
    colors: {
      lightest: { lightness: 97, chroma: 0.02, hue: 106 },
      mid: { lightness: 89, chroma: 0.21, hue: 99 },
      darkest: { lightness: 67, chroma: 0.43, hue: 59 },
    },
  },
  {
    id: "lime",
    name: "Lime",
    theme: "light",
    colors: {
      mid: { lightness: 65, chroma: 0.192, hue: 134.3 },
    },
  },

  {
    id: "green",
    name: "Green",
    theme: "light",
    colors: {
      mid: { lightness: 64, chroma: 0.21, hue: 144 },
    },
  },
  {
    id: "teal",
    name: "Teal",
    theme: "light",
    colors: {
      mid: { lightness: 65, chroma: 0.116, hue: 192.6 },
    },
  },
  {
    id: "cyan",
    name: "Cyan",
    theme: "light",
    colors: {
      lightest: { lightness: 97, chroma: 0.11, hue: 195 },
      mid: { lightness: 61, chroma: 0.11, hue: 210 },
      darkest: { lightness: 42, chroma: 0.11, hue: 210 },
    },
  },

  {
    id: "blue",
    name: "Blue",
    theme: "light",
    colors: {
      lightest: { lightness: 91, chroma: 0.22, hue: 240 },
      mid: { lightness: 63, chroma: 0.22, hue: 255 },
      darkest: { lightness: 38, chroma: 0.22, hue: 252 },
    },
  },
  {
    id: "indigo",
    name: "Indigo",
    theme: "light",
    colors: {
      lightest: { lightness: 92.7, chroma: 0.036, hue: 291 },
      mid: { lightness: 67, chroma: 0.285, hue: 296 },
      darkest: { lightness: 28, chroma: 0.23, hue: 278 },
    },
  },
  {
    id: "purple",
    name: "Purple",
    theme: "light",
    colors: {
      mid: { lightness: 67, chroma: 0.21, hue: 299 },
    },
  },
] as const satisfies readonly ColorScalePreset[];

export const COLOR_SCALE_PRESETS_DARK: readonly ColorScalePreset[] =
  COLOR_SCALE_PRESETS.map((preset) => {
    const colorsRecord = preset.colors as ColorScalePreset["colors"];
    const colors: ColorScalePreset["colors"] = {
      mid: toDarkStop(colorsRecord.mid),
      darkest: toDarkStop(colorsRecord.darkest),
      lightest: toDarkStop(colorsRecord.lightest),
    };

    return {
      id: `${preset.id}-dark`,
      name: `${preset.name}`,
      theme: "dark",
      colors,
    };
  });

export type NamedColor = (typeof COLOR_SCALE_PRESETS)[number]["id"];

export function getColorScaleMode(
  preset: Pick<ColorScalePreset, "colors">
): ColorScaleMode {
  const { colors } = preset;
  const hasLight = Boolean(colors.lightest);
  const hasDark = Boolean(colors.darkest);
  if (hasLight && hasDark && colors.mid) {
    return "three";
  }
  if (hasLight || hasDark) {
    return "two";
  }
  return "single";
}
