import type { SymbolDefinitions } from '../global-types';
import { asOklch, oklchToRgb, oklabToRgb, rgbToOklab, rgbToOklch, rgbToHsl, hslToRgb, parseColor } from '../../color';
import type { RgbColor } from '../../color';
import { SEQUENTIAL_PALETTES } from '../../color/sequential';
import { CATEGORICAL_PALETTES } from '../../color/categorical';
import { DIVERGING_PALETTES } from '../../color/diverging-palettes';
import { isFunction, isString } from '../boxed-expression/type-guards';

/** Convert a 0xRRGGBBAA packed integer to a Tuple of 0-1 sRGB components. */
function colorNumberToTuple(
  ce: any,
  color: number
): any {
  const r = ((color >>> 24) & 0xff) / 255;
  const g = ((color >>> 16) & 0xff) / 255;
  const b = ((color >>> 8) & 0xff) / 255;
  const a = (color & 0xff) / 255;

  if (Math.abs(a - 1) < 1e-4)
    return ce.tuple(ce.number(r), ce.number(g), ce.number(b));

  return ce.tuple(ce.number(r), ce.number(g), ce.number(b), ce.number(a));
}

const ALL_PALETTES: Record<string, readonly string[]> = {
  ...SEQUENTIAL_PALETTES,
  ...CATEGORICAL_PALETTES,
  ...DIVERGING_PALETTES,
};

/** Interpolate between two hex colors in OKLCh space at fraction f in [0,1]. */
function interpolateOklch(
  hex1: string,
  hex2: string,
  f: number
): { r: number; g: number; b: number; alpha?: number } {
  const c1 = asOklch(hex1);
  const c2 = asOklch(hex2);

  const L = c1.L + (c2.L - c1.L) * f;
  const C = c1.C + (c2.C - c1.C) * f;

  // Shorter arc hue interpolation
  let dh = c2.H - c1.H;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  let H = c1.H + dh * f;
  if (H < 0) H += 360;
  if (H >= 360) H -= 360;

  return oklchToRgb({ L, C, H });
}

/** Sample a palette at position t in [0,1], returning a 0-1 sRGB Tuple expression. */
function samplePalette(ce: any, palette: readonly string[], t: number): any {
  t = Math.max(0, Math.min(1, t));

  const n = palette.length;
  if (n === 0) return ce.error('expected-value');
  if (n === 1) return colorNumberToTuple(ce, parseColor(palette[0]));

  const pos = t * (n - 1);
  const i = Math.floor(pos);
  const frac = pos - i;

  if (i >= n - 1)
    return colorNumberToTuple(ce, parseColor(palette[n - 1]));

  if (frac < 1e-9)
    return colorNumberToTuple(ce, parseColor(palette[i]));

  const rgb = interpolateOklch(palette[i], palette[i + 1], frac);
  // oklchToRgb returns 0-255
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  return ce.tuple(ce.number(r), ce.number(g), ce.number(b));
}

/** Extract an RgbColor (0-255) from a Color string or an sRGB Tuple (0-1). */
function extractRgb(ce: any, arg: any): RgbColor | undefined {
  if (isString(arg)) {
    const s = arg.string;
    if (!s) return undefined;
    const color = parseColor(s);
    return {
      r: (color >>> 24) & 0xff,
      g: (color >>> 16) & 0xff,
      b: (color >>> 8) & 0xff,
      alpha: (color & 0xff) / 255,
    };
  }
  if (arg.operator === 'Tuple' && arg.ops && arg.ops.length >= 3) {
    const rgb: RgbColor = {
      r: arg.ops[0].re * 255,
      g: arg.ops[1].re * 255,
      b: arg.ops[2].re * 255,
    };
    if (arg.ops.length >= 4) rgb.alpha = arg.ops[3].re;
    return rgb;
  }
  return undefined;
}

/** Build a Tuple expression from components, appending alpha if not 1. */
function componentsTuple(
  ce: any,
  components: number[],
  alpha?: number
): any {
  const args = components.map((v) => ce.number(v));
  if (alpha !== undefined && Math.abs(alpha - 1) > 1e-4)
    args.push(ce.number(alpha));
  return ce.tuple(...args);
}

export const COLORS_LIBRARY: SymbolDefinitions = {
  Color: {
    description: 'Convert a color string to a canonical sRGB tuple',
    complexity: 8000,
    signature: '(string) -> tuple',
    evaluate: (ops, { engine: ce }) => {
      const input = isString(ops[0]) ? ops[0].string : undefined;
      if (!input) return ce.error('incompatible-type');

      const color = parseColor(input);
      // parseColor returns 0 for both invalid input and "transparent"
      // Distinguish: "transparent" is valid (returns [0,0,0,0])
      if (color === 0 && input.trim().toLowerCase() !== 'transparent')
        return ce.error('incompatible-type');

      return colorNumberToTuple(ce, color);
    },
  },

  Colormap: {
    description: 'Sample colors from a named palette',
    complexity: 8000,
    signature: '(string, number?) -> any',
    evaluate: (ops, { engine: ce }) => {
      const name = isString(ops[0]) ? ops[0].string : undefined;
      if (!name) return ce.error('incompatible-type');

      const palette = ALL_PALETTES[name];
      if (!palette) return ce.error('expected-value', name);

      // Variant 1: no second arg -> return full palette
      if (ops.length < 2 || ops[1] === undefined) {
        const tuples = palette.map((hex) =>
          colorNumberToTuple(ce, parseColor(hex))
        );
        return ce.function('List', tuples);
      }

      const val = ops[1].re;
      if (!Number.isFinite(val)) return ce.error('expected-value');

      // Variant 2: integer >= 2 -> resample to n colors
      if (Number.isInteger(val) && val >= 2) {
        const n = val;
        const tuples: any[] = [];
        for (let i = 0; i < n; i++) {
          tuples.push(samplePalette(ce, palette, i / (n - 1)));
        }
        return ce.function('List', tuples);
      }

      // Variant 3: real in [0,1] -> sample at position
      return samplePalette(ce, palette, val);
    },
  },

  ColorToColorspace: {
    description: 'Convert a color to components in a target color space',
    complexity: 8000,
    signature: '(any, string) -> tuple',
    evaluate: (ops, { engine: ce }) => {
      const rgb = extractRgb(ce, ops[0]);
      if (!rgb) return ce.error('incompatible-type');

      const space = isString(ops[1]) ? ops[1].string?.toLowerCase() : undefined;
      if (!space) return ce.error('incompatible-type');

      const alpha = rgb.alpha;

      switch (space) {
        case 'rgb':
          return componentsTuple(ce, [rgb.r / 255, rgb.g / 255, rgb.b / 255], alpha);

        case 'hsl': {
          const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
          return componentsTuple(ce, [hsl.h, hsl.s, hsl.l], alpha);
        }

        case 'oklch': {
          const c = rgbToOklch(rgb);
          return componentsTuple(ce, [c.L, c.C, c.H], alpha);
        }

        case 'oklab':
        case 'lab': {
          const lab = rgbToOklab(rgb);
          return componentsTuple(ce, [lab.L, lab.a, lab.b], alpha);
        }

        default:
          return ce.error('expected-value');
      }
    },
  },

  ColorFromColorspace: {
    description: 'Convert color space components to a canonical sRGB tuple',
    complexity: 8000,
    signature: '(tuple, string) -> tuple',
    evaluate: (ops, { engine: ce }) => {
      const tuple = ops[0];
      if (!isFunction(tuple) || tuple.operator !== 'Tuple' || tuple.ops.length < 3)
        return ce.error('incompatible-type');

      const c0 = tuple.ops[0].re;
      const c1 = tuple.ops[1].re;
      const c2 = tuple.ops[2].re;
      const alpha = tuple.ops.length >= 4 ? tuple.ops[3].re : undefined;

      const space = isString(ops[1]) ? ops[1].string?.toLowerCase() : undefined;
      if (!space) return ce.error('incompatible-type');

      let rgb: RgbColor;

      switch (space) {
        case 'rgb':
          return componentsTuple(ce, [c0, c1, c2], alpha);

        case 'hsl': {
          const result = hslToRgb(c0, c1, c2);
          return componentsTuple(
            ce,
            [result.r / 255, result.g / 255, result.b / 255],
            alpha
          );
        }

        case 'oklch':
          rgb = oklchToRgb({ L: c0, C: c1, H: c2 });
          return componentsTuple(ce, [rgb.r / 255, rgb.g / 255, rgb.b / 255], alpha);

        case 'oklab':
        case 'lab':
          rgb = oklabToRgb({ L: c0, a: c1, b: c2 });
          return componentsTuple(ce, [rgb.r / 255, rgb.g / 255, rgb.b / 255], alpha);

        default:
          return ce.error('expected-value');
      }
    },
  },
};
