import type { SymbolDefinitions } from '../global-types';
import {
  parseColor,
  apca,
  oklabDeltaE,
  contrastingColor,
  interpolateOklch,
  asOklch,
  rgbToOklch,
  oklchToRgb,
  oklchToOklab,
  oklabToOklch,
  rgbToHsl,
  hslToRgb,
  rgbToHsv,
  hsvToRgb,
  rgbToOklab,
  oklabToRgb,
  SEQUENTIAL_PALETTES,
  CATEGORICAL_PALETTES,
  DIVERGING_PALETTES,
} from '@arnog/colors';
import type { OklchColor, RgbColor } from '@arnog/colors';
import {
  isFunction,
  isNumber,
  isString,
} from '../boxed-expression/type-guards';

/**
 * Canonicalize an alpha value. Returns `undefined` for undefined, non-finite,
 * or effectively-1 inputs so downstream sites can use a simple
 * `alpha !== undefined` check to decide whether the value needs to be emitted
 * as a 4th component.
 *
 * The 1e-9 tolerance collapses float-arithmetic noise (e.g. an interpolation
 * result that comes out as 0.9999999998 instead of 1) without dropping any
 * user-supplied value above that floor.
 */
function normalizeAlpha(a: number | undefined): number | undefined {
  if (a === undefined) return undefined;
  if (!Number.isFinite(a)) return undefined;
  if (Math.abs(a - 1) < 1e-9) return undefined;
  return a;
}

/**
 * For a typed color head with a 4th alpha argument, drop alpha when it's a
 * number literal that normalizes to undefined (i.e. effectively 1, or
 * non-finite). Used by `As*` short-circuits so that e.g. `AsRgb(Rgb(1,0,0,1))`
 * returns the 3-component form, consistent with how every other emit site
 * handles alpha. Symbolic alphas (variables, expressions) are left in place.
 */
function normalizeColorHead(ce: any, expr: any): any {
  if (!isFunction(expr) || !expr.ops || expr.ops.length < 4) return expr;
  const alphaExpr = expr.ops[3];
  if (!isNumber(alphaExpr)) return expr;
  if (normalizeAlpha(alphaExpr.re) === undefined) {
    return ce.function(expr.operator, [expr.ops[0], expr.ops[1], expr.ops[2]]);
  }
  return expr;
}

/** Convert a 0xRRGGBBAA packed integer to an Oklch boxed expression. */
function colorNumberToOklch(ce: any, color: number): any {
  const r = (color >>> 24) & 0xff;
  const g = (color >>> 16) & 0xff;
  const b = (color >>> 8) & 0xff;
  const a = normalizeAlpha((color & 0xff) / 255);
  const c = rgbToOklch({ r, g, b });
  const args = [ce.number(c.L), ce.number(c.C), ce.number(c.H)];
  if (a !== undefined) args.push(ce.number(a));
  return ce.function('Oklch', args);
}

const ALL_PALETTES: Record<string, readonly string[]> = {
  ...SEQUENTIAL_PALETTES,
  ...CATEGORICAL_PALETTES,
  ...DIVERGING_PALETTES,
};

/** Sample a palette at position t in [0,1], returning an Oklch expression. */
function samplePalette(ce: any, palette: readonly string[], t: number): any {
  t = Math.max(0, Math.min(1, t));

  const n = palette.length;
  if (n === 0) return ce.error('expected-value');
  if (n === 1) return colorNumberToOklch(ce, parseColor(palette[0]));

  const pos = t * (n - 1);
  const i = Math.floor(pos);
  const frac = pos - i;

  if (i >= n - 1) return colorNumberToOklch(ce, parseColor(palette[n - 1]));

  if (frac < 1e-9) return colorNumberToOklch(ce, parseColor(palette[i]));

  // interpolateOklch returns an RgbColor (gamut-clipped). Rewrap as Oklch.
  return oklchToExpr(
    ce,
    asOklch(interpolateOklch(palette[i], palette[i + 1], frac))
  );
}

/** Heads recognized as color values. */
const COLOR_OPERATORS = new Set(['Rgb', 'Hsv', 'Hsl', 'Oklab', 'Oklch']);

/**
 * Read the components of a typed color expression (`Rgb`/`Hsv`/`Hsl`/`Oklab`/`Oklch`).
 * Returns `null` if the expression isn't a recognized color head or the components
 * aren't all finite numbers.
 */
function readColorExpr(arg: any): {
  space: string;
  c0: number;
  c1: number;
  c2: number;
  alpha?: number;
} | null {
  if (!isFunction(arg)) return null;
  if (!COLOR_OPERATORS.has(arg.operator)) return null;
  if (!arg.ops || arg.ops.length < 3) return null;
  const c0 = arg.ops[0].re;
  const c1 = arg.ops[1].re;
  const c2 = arg.ops[2].re;
  if (!Number.isFinite(c0) || !Number.isFinite(c1) || !Number.isFinite(c2))
    return null;
  const alpha = arg.ops.length >= 4 ? normalizeAlpha(arg.ops[3].re) : undefined;
  return { space: arg.operator, c0, c1, c2, alpha };
}

/**
 * Convert a typed color expression to an `RgbColor` with channels in [0, 255].
 * Used by routines that need a single internal representation regardless of
 * the user-supplied colorspace. Returns `null` for non-color expressions.
 */
function colorExprToRgb(arg: any): RgbColor | null {
  const c = readColorExpr(arg);
  if (!c) return null;
  // c.alpha is already normalized by readColorExpr — undefined ↔ opaque.
  const withAlpha = (rgb: { r: number; g: number; b: number }): RgbColor =>
    c.alpha !== undefined ? { ...rgb, alpha: c.alpha } : rgb;
  switch (c.space) {
    case 'Rgb':
      // Rgb head components are 0-1 sRGB; `@arnog/colors`'s RgbColor is
      // 0-255, so scale at the boundary.
      return withAlpha({ r: c.c0 * 255, g: c.c1 * 255, b: c.c2 * 255 });
    case 'Hsv':
      return withAlpha(hsvToRgb(c.c0, c.c1, c.c2));
    case 'Hsl':
      return withAlpha(hslToRgb(c.c0, c.c1, c.c2));
    case 'Oklab':
      return withAlpha(oklabToRgb({ L: c.c0, a: c.c1, b: c.c2 }));
    case 'Oklch':
      return withAlpha(oklchToRgb({ L: c.c0, C: c.c1, H: c.c2 }));
  }
  return null;
}

/**
 * Convert a typed color expression to an `OklchColor`, preserving wide-gamut
 * components for Oklab/Oklch inputs (no sRGB pinch point). Returns `null` for
 * expressions that aren't a recognized color head.
 */
function colorExprToOklch(arg: any): OklchColor | null {
  const c = readColorExpr(arg);
  if (!c) return null;
  switch (c.space) {
    case 'Oklch':
      return asOklch({ L: c.c0, C: c.c1, H: c.c2, alpha: c.alpha });
    case 'Oklab':
      return asOklch({ L: c.c0, a: c.c1, b: c.c2, alpha: c.alpha });
    case 'Rgb':
      // Rgb head components are 0-1 sRGB; `asOklch`'s RgbColor is 0-255.
      return asOklch({
        r: c.c0 * 255,
        g: c.c1 * 255,
        b: c.c2 * 255,
        alpha: c.alpha,
      });
    case 'Hsv': {
      const rgb = hsvToRgb(c.c0, c.c1, c.c2);
      return asOklch({ ...rgb, alpha: c.alpha });
    }
    case 'Hsl': {
      const rgb = hslToRgb(c.c0, c.c1, c.c2);
      return asOklch({ r: rgb.r, g: rgb.g, b: rgb.b, alpha: c.alpha });
    }
  }
  return null;
}

/**
 * Convert any accepted color input — typed color head, color string, or 0-1
 * sRGB Tuple — to an `OklchColor`. Typed heads take the wide-gamut path;
 * strings/Tuples route through sRGB via `extractRgb`. Returns `null` if the
 * input isn't a recognized color form.
 */
function toOklch(ce: any, arg: any): OklchColor | null {
  const direct = colorExprToOklch(arg);
  if (direct) return direct;
  const rgb = extractRgb(ce, arg);
  return rgb ? asOklch(rgb) : null;
}

/**
 * Linear interpolation between two OklchColor values. Hue takes the shortest
 * path around the wheel (delta wrapped to ±180°). Operates on raw components
 * — does not pack/unpack — so wide-gamut chroma is preserved.
 *
 * When one endpoint is achromatic (C ≈ 0) its hue is undefined; the other
 * endpoint's hue is used throughout, matching CSS Color 4 `color-mix` so
 * mixing red with white yields a desaturated red rather than drifting through
 * intermediate hues.
 */
function lerpOklchColor(a: OklchColor, b: OklchColor, t: number): OklchColor {
  const L = a.L + (b.L - a.L) * t;
  const C = a.C + (b.C - a.C) * t;

  const aAchromatic = a.C < 1e-6;
  const bAchromatic = b.C < 1e-6;
  let H: number;
  if (aAchromatic && bAchromatic) H = a.H;
  else if (aAchromatic) H = b.H;
  else if (bAchromatic) H = a.H;
  else {
    let dH = b.H - a.H;
    if (dH > 180) dH -= 360;
    if (dH < -180) dH += 360;
    H = a.H + dH * t;
    if (H < 0) H += 360;
    if (H >= 360) H -= 360;
  }

  const alphaA = a.alpha ?? 1;
  const alphaB = b.alpha ?? 1;
  return { L, C, H, alpha: normalizeAlpha(alphaA + (alphaB - alphaA) * t) };
}

/** Build an Oklch boxed expression from an OklchColor. */
function oklchToExpr(ce: any, c: OklchColor): any {
  const args = [ce.number(c.L), ce.number(c.C), ce.number(c.H)];
  if (c.alpha !== undefined) args.push(ce.number(c.alpha));
  return ce.function('Oklch', args);
}

/**
 * Extract an RgbColor (0-255) from a Color string, an sRGB Tuple (0-1), or
 * a typed color expression (`Rgb`/`Hsv`/`Hsl`/`Oklab`/`Oklch`).
 */
function extractRgb(ce: any, arg: any): RgbColor | undefined {
  if (isString(arg)) {
    const s = arg.string;
    if (!s) return undefined;
    const color = parseColor(s);
    const rgb: RgbColor = {
      r: (color >>> 24) & 0xff,
      g: (color >>> 16) & 0xff,
      b: (color >>> 8) & 0xff,
    };
    const alpha = normalizeAlpha((color & 0xff) / 255);
    if (alpha !== undefined) rgb.alpha = alpha;
    return rgb;
  }
  const fromTyped = colorExprToRgb(arg);
  if (fromTyped) return fromTyped;
  if (arg.operator === 'Tuple' && arg.ops && arg.ops.length >= 3) {
    const rgb: RgbColor = {
      r: arg.ops[0].re * 255,
      g: arg.ops[1].re * 255,
      b: arg.ops[2].re * 255,
    };
    if (arg.ops.length >= 4) {
      const alpha = normalizeAlpha(arg.ops[3].re);
      if (alpha !== undefined) rgb.alpha = alpha;
    }
    return rgb;
  }
  return undefined;
}

/** Build a Tuple expression from components, appending alpha when defined. */
function componentsTuple(ce: any, components: number[], alpha?: number): any {
  const args = components.map((v) => ce.number(v));
  if (alpha !== undefined) args.push(ce.number(alpha));
  return ce.tuple(...args);
}

/** Convert an RgbColor (0-255) to a hex string (#rrggbb or #rrggbbaa). */
function rgbToHex(rgb: RgbColor): string {
  const r = Math.round(Math.max(0, Math.min(255, rgb.r)));
  const g = Math.round(Math.max(0, Math.min(255, rgb.g)));
  const b = Math.round(Math.max(0, Math.min(255, rgb.b)));
  const hex = `#${r.toString(16).padStart(2, '0')}${g
    .toString(16)
    .padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  if (rgb.alpha !== undefined) {
    const a = Math.round(Math.max(0, Math.min(255, rgb.alpha * 255)));
    return hex + a.toString(16).padStart(2, '0');
  }
  return hex;
}

export const COLORS_LIBRARY: SymbolDefinitions = {
  Color: {
    description: 'Parse a CSS-style color string to an Oklch color',
    complexity: 8000,
    signature: '(string) -> color',
    evaluate: (ops, { engine: ce }) => {
      const input = isString(ops[0]) ? ops[0].string : undefined;
      if (!input) return ce.error('incompatible-type');

      const color = parseColor(input);
      // parseColor returns 0 for both invalid input and "transparent"
      // Distinguish: "transparent" is valid (returns [0,0,0,0])
      if (color === 0 && input.trim().toLowerCase() !== 'transparent')
        return ce.error('incompatible-type');

      const r = (color >>> 24) & 0xff;
      const g = (color >>> 16) & 0xff;
      const b = (color >>> 8) & 0xff;
      const a = normalizeAlpha((color & 0xff) / 255);
      const c = rgbToOklch({ r, g, b });
      const args = [ce.number(c.L), ce.number(c.C), ce.number(c.H)];
      if (a !== undefined) args.push(ce.number(a));
      return ce.function('Oklch', args);
    },
  },

  ColorToString: {
    description: 'Convert a color to a string in the specified format',
    complexity: 8000,
    signature: '(color | string | tuple, string?) -> string',
    evaluate: (ops, { engine: ce }) => {
      const rgb = extractRgb(ce, ops[0]);
      if (!rgb) return ce.error('incompatible-type');

      const format =
        ops.length >= 2 && isString(ops[1])
          ? ops[1].string?.toLowerCase()
          : 'hex';

      switch (format) {
        case 'hex':
          return ce.string(rgbToHex(rgb));

        case 'rgb': {
          const r = Math.round(rgb.r);
          const g = Math.round(rgb.g);
          const b = Math.round(rgb.b);
          if (rgb.alpha !== undefined)
            return ce.string(`rgb(${r} ${g} ${b} / ${rgb.alpha})`);
          return ce.string(`rgb(${r} ${g} ${b})`);
        }

        case 'hsl': {
          const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
          const h = Math.round(hsl.h * 10) / 10;
          const s = Math.round(hsl.s * 1000) / 10;
          const l = Math.round(hsl.l * 1000) / 10;
          if (rgb.alpha !== undefined)
            return ce.string(`hsl(${h} ${s}% ${l}% / ${rgb.alpha})`);
          return ce.string(`hsl(${h} ${s}% ${l}%)`);
        }

        case 'oklch': {
          // Wide-gamut path: prefer typed extraction so out-of-sRGB chroma
          // serializes losslessly. Fall back to the already-extracted sRGB.
          const c = colorExprToOklch(ops[0]) ?? asOklch(rgb);
          const L = Math.round(c.L * 1000) / 1000;
          const C = Math.round(c.C * 1000) / 1000;
          const H = Math.round(c.H * 10) / 10;
          if (c.alpha !== undefined)
            return ce.string(`oklch(${L} ${C} ${H} / ${c.alpha})`);
          return ce.string(`oklch(${L} ${C} ${H})`);
        }

        default:
          return ce.error('expected-value');
      }
    },
  },

  ColorMix: {
    description: 'Mix two colors in OKLCh space',
    complexity: 8000,
    signature:
      '(color | string | tuple, color | string | tuple, number?) -> color',
    evaluate: (ops, { engine: ce }) => {
      let ratio = 0.5;
      if (ops.length >= 3 && ops[2] !== undefined) {
        ratio = ops[2].re;
        if (!Number.isFinite(ratio)) return ce.error('expected-value');
        ratio = Math.max(0, Math.min(1, ratio));
      }

      // Both inputs converge on OklchColor (typed heads via wide-gamut path,
      // strings/Tuples via sRGB), then lerp in OKLCh and return as Oklch.
      const oklch1 = toOklch(ce, ops[0]);
      const oklch2 = toOklch(ce, ops[1]);
      if (!oklch1 || !oklch2) return ce.error('incompatible-type');

      return oklchToExpr(ce, lerpOklchColor(oklch1, oklch2, ratio));
    },
  },

  Colormap: {
    description: 'Sample colors from a named palette',
    complexity: 8000,
    signature: '(string, number?) -> color | list<color>',
    evaluate: (ops, { engine: ce }) => {
      const name = isString(ops[0]) ? ops[0].string : undefined;
      if (!name) return ce.error('incompatible-type');

      const palette = ALL_PALETTES[name];
      if (!palette) return ce.error('expected-value', name);

      // Variant 1: no second arg -> return full palette
      if (ops.length < 2 || ops[1] === undefined) {
        const colors = palette.map((hex) =>
          colorNumberToOklch(ce, parseColor(hex))
        );
        return ce.function('List', colors);
      }

      const val = ops[1].re;
      if (!Number.isFinite(val)) return ce.error('expected-value');

      // Variant 2: integer >= 2 -> resample to n colors
      if (Number.isInteger(val) && val >= 2) {
        const n = val;
        const colors: any[] = [];
        for (let i = 0; i < n; i++) {
          colors.push(samplePalette(ce, palette, i / (n - 1)));
        }
        return ce.function('List', colors);
      }

      // Variant 3: real in [0,1] -> sample at position
      return samplePalette(ce, palette, val);
    },
  },

  ColorToColorspace: {
    description: 'Convert a color to components in a target color space',
    complexity: 8000,
    signature: '(color | string | tuple, string) -> tuple',
    evaluate: (ops, { engine: ce }) => {
      const space = isString(ops[1]) ? ops[1].string?.toLowerCase() : undefined;
      if (!space) return ce.error('incompatible-type');

      // Wide-gamut path: if the input is a typed color head and the target
      // is OKLab or OKLCh, route directly without going through sRGB.
      if (space === 'oklch' || space === 'oklab' || space === 'lab') {
        const oklch = colorExprToOklch(ops[0]);
        if (oklch) {
          if (space === 'oklch')
            return componentsTuple(
              ce,
              [oklch.L, oklch.C, oklch.H],
              oklch.alpha
            );
          const lab = oklchToOklab(oklch);
          return componentsTuple(ce, [lab.L, lab.a, lab.b], lab.alpha);
        }
      }

      const rgb = extractRgb(ce, ops[0]);
      if (!rgb) return ce.error('incompatible-type');

      const alpha = rgb.alpha;

      switch (space) {
        case 'rgb':
          return componentsTuple(
            ce,
            [rgb.r / 255, rgb.g / 255, rgb.b / 255],
            alpha
          );

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
    signature: '(color | tuple, string) -> tuple',
    evaluate: (ops, { engine: ce }) => {
      const space = isString(ops[1]) ? ops[1].string?.toLowerCase() : undefined;
      if (!space) return ce.error('incompatible-type');

      // Accept typed color heads (Rgb/Hsv/Hsl/Oklab/Oklch) directly: their
      // component layout matches the named colorspace, so unwrap and use them
      // as if they were a Tuple of the same components.
      let c0: number, c1: number, c2: number;
      let alpha: number | undefined;
      const arg = ops[0];
      const typed = readColorExpr(arg);
      if (typed) {
        c0 = typed.c0;
        c1 = typed.c1;
        c2 = typed.c2;
        alpha = typed.alpha;
      } else if (
        isFunction(arg) &&
        arg.operator === 'Tuple' &&
        arg.ops.length >= 3
      ) {
        c0 = arg.ops[0].re;
        c1 = arg.ops[1].re;
        c2 = arg.ops[2].re;
        alpha = arg.ops.length >= 4 ? arg.ops[3].re : undefined;
      } else {
        return ce.error('incompatible-type');
      }

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
          return componentsTuple(
            ce,
            [rgb.r / 255, rgb.g / 255, rgb.b / 255],
            alpha
          );

        case 'oklab':
        case 'lab':
          rgb = oklabToRgb({ L: c0, a: c1, b: c2 });
          return componentsTuple(
            ce,
            [rgb.r / 255, rgb.g / 255, rgb.b / 255],
            alpha
          );

        default:
          return ce.error('expected-value');
      }
    },
  },

  ColorContrast: {
    description: 'APCA contrast ratio between two colors',
    complexity: 8000,
    signature: '(color | string | tuple, color | string | tuple) -> number',
    evaluate: (ops, { engine: ce }) => {
      const bgRgb = extractRgb(ce, ops[0]);
      const fgRgb = extractRgb(ce, ops[1]);
      if (!bgRgb || !fgRgb) return ce.error('incompatible-type');
      return ce.number(apca(bgRgb, fgRgb));
    },
  },

  ContrastingColor: {
    description:
      'Choose the foreground color with better APCA contrast against a background',
    complexity: 8000,
    signature:
      '(color | string | tuple, (color | string | tuple)?, (color | string | tuple)?) -> color',
    evaluate: (ops, { engine: ce }) => {
      const bgRgb = extractRgb(ce, ops[0]);
      if (!bgRgb) return ce.error('incompatible-type');

      let packed: number;
      if (ops.length >= 3 && ops[1] !== undefined && ops[2] !== undefined) {
        const fg1 = extractRgb(ce, ops[1]);
        const fg2 = extractRgb(ce, ops[2]);
        if (!fg1 || !fg2) return ce.error('incompatible-type');
        packed = contrastingColor({ bg: bgRgb, fg1, fg2 });
      } else {
        // Default: choose between white and black
        packed = contrastingColor(bgRgb);
      }

      // Unpack 0xRRGGBBAA into an Rgb head (channels 0-1).
      const r = ((packed >>> 24) & 0xff) / 255;
      const g = ((packed >>> 16) & 0xff) / 255;
      const b = ((packed >>> 8) & 0xff) / 255;
      const alpha = normalizeAlpha((packed & 0xff) / 255);
      const args = [ce.number(r), ce.number(g), ce.number(b)];
      if (alpha !== undefined) args.push(ce.number(alpha));
      return ce.function('Rgb', args);
    },
  },

  // ---------------------------------------------------------------------------
  // Color constructors. Each preserves its colorspace on evaluation; the
  // operator name is the discriminator. Components are interpreted per
  // colorspace conventions (Rgb channels 0-1, Hsv/Hsl hue in degrees with
  // sat/value 0-1, Oklab/Oklch L 0-1 with standard a/b/C/H ranges). The
  // optional 4th argument is alpha in [0, 1]. No clamping at evaluation time.
  // ---------------------------------------------------------------------------

  Rgb: {
    description: 'sRGB color (channels 0-1, optional alpha 0-1)',
    complexity: 8000,
    signature: '(number, number, number, number?) -> color',
  },
  Hsv: {
    description:
      'HSV color (hue degrees, saturation/value 0-1, optional alpha)',
    complexity: 8000,
    signature: '(number, number, number, number?) -> color',
  },
  Hsl: {
    description:
      'HSL color (hue degrees, saturation/lightness 0-1, optional alpha)',
    complexity: 8000,
    signature: '(number, number, number, number?) -> color',
  },
  Oklab: {
    description: 'OKLab color (L 0-1, a/b ~ -0.4..0.4, optional alpha)',
    complexity: 8000,
    signature: '(number, number, number, number?) -> color',
  },
  Oklch: {
    description: 'OKLCh color (L 0-1, C 0-~0.4, hue degrees, optional alpha)',
    complexity: 8000,
    signature: '(number, number, number, number?) -> color',
  },

  // ---------------------------------------------------------------------------
  // Color-space conversions. Each accepts any of the five color heads and
  // returns the same color in the named space. If the input is already in
  // the target space, returns the input unchanged.
  // ---------------------------------------------------------------------------

  AsRgb: {
    description: 'Convert any color to sRGB (channels 0-1)',
    complexity: 8000,
    signature: '(color) -> color',
    evaluate: (ops, { engine: ce }) => {
      const arg = ops[0];
      if (isFunction(arg) && arg.operator === 'Rgb')
        return normalizeColorHead(ce, arg);
      const rgb = colorExprToRgb(arg);
      if (!rgb) return ce.error('incompatible-type');
      // colorExprToRgb returns 0-255 channels (the `@arnog/colors` internal
      // form); divide to bring back to the Rgb head's 0-1 convention.
      const args = [
        ce.number(rgb.r / 255),
        ce.number(rgb.g / 255),
        ce.number(rgb.b / 255),
      ];
      if (rgb.alpha !== undefined) args.push(ce.number(rgb.alpha));
      return ce.function('Rgb', args);
    },
  },
  AsHsv: {
    description: 'Convert any color to HSV (hue degrees, s/v 0-1)',
    complexity: 8000,
    signature: '(color) -> color',
    evaluate: (ops, { engine: ce }) => {
      const arg = ops[0];
      if (isFunction(arg) && arg.operator === 'Hsv')
        return normalizeColorHead(ce, arg);
      const rgb = colorExprToRgb(arg);
      if (!rgb) return ce.error('incompatible-type');
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      const args = [ce.number(hsv.h), ce.number(hsv.s), ce.number(hsv.v)];
      if (rgb.alpha !== undefined) args.push(ce.number(rgb.alpha));
      return ce.function('Hsv', args);
    },
  },
  AsHsl: {
    description: 'Convert any color to HSL (hue degrees, s/l 0-1)',
    complexity: 8000,
    signature: '(color) -> color',
    evaluate: (ops, { engine: ce }) => {
      const arg = ops[0];
      if (isFunction(arg) && arg.operator === 'Hsl')
        return normalizeColorHead(ce, arg);
      const rgb = colorExprToRgb(arg);
      if (!rgb) return ce.error('incompatible-type');
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      const args = [ce.number(hsl.h), ce.number(hsl.s), ce.number(hsl.l)];
      if (rgb.alpha !== undefined) args.push(ce.number(rgb.alpha));
      return ce.function('Hsl', args);
    },
  },
  AsOklab: {
    description: 'Convert any color to OKLab',
    complexity: 8000,
    signature: '(color) -> color',
    evaluate: (ops, { engine: ce }) => {
      const arg = ops[0];
      if (isFunction(arg) && arg.operator === 'Oklab')
        return normalizeColorHead(ce, arg);
      // Wide-gamut path: Oklch → Oklab without an sRGB pinch.
      if (isFunction(arg) && arg.operator === 'Oklch') {
        const c = readColorExpr(arg);
        if (!c) return ce.error('incompatible-type');
        const lab = oklchToOklab({ L: c.c0, C: c.c1, H: c.c2, alpha: c.alpha });
        const args = [ce.number(lab.L), ce.number(lab.a), ce.number(lab.b)];
        if (lab.alpha !== undefined) args.push(ce.number(lab.alpha));
        return ce.function('Oklab', args);
      }
      const rgb = colorExprToRgb(arg);
      if (!rgb) return ce.error('incompatible-type');
      const lab = rgbToOklab(rgb);
      const args = [ce.number(lab.L), ce.number(lab.a), ce.number(lab.b)];
      if (rgb.alpha !== undefined) args.push(ce.number(rgb.alpha));
      return ce.function('Oklab', args);
    },
  },
  AsOklch: {
    description: 'Convert any color to OKLCh',
    complexity: 8000,
    signature: '(color) -> color',
    evaluate: (ops, { engine: ce }) => {
      const arg = ops[0];
      if (isFunction(arg) && arg.operator === 'Oklch')
        return normalizeColorHead(ce, arg);
      // Wide-gamut path: Oklab → Oklch without an sRGB pinch.
      if (isFunction(arg) && arg.operator === 'Oklab') {
        const c = readColorExpr(arg);
        if (!c) return ce.error('incompatible-type');
        const oklch = oklabToOklch({
          L: c.c0,
          a: c.c1,
          b: c.c2,
          alpha: c.alpha,
        });
        const args = [
          ce.number(oklch.L),
          ce.number(oklch.C),
          ce.number(oklch.H),
        ];
        if (oklch.alpha !== undefined) args.push(ce.number(oklch.alpha));
        return ce.function('Oklch', args);
      }
      const rgb = colorExprToRgb(arg);
      if (!rgb) return ce.error('incompatible-type');
      const c = rgbToOklch(rgb);
      const args = [ce.number(c.L), ce.number(c.C), ce.number(c.H)];
      if (rgb.alpha !== undefined) args.push(ce.number(rgb.alpha));
      return ce.function('Oklch', args);
    },
  },

  // ---------------------------------------------------------------------------
  // Perceptual difference. Returns ΔE_OK (Euclidean distance in OKLab),
  // an approximately perceptually uniform scalar.
  // ---------------------------------------------------------------------------

  ColorDelta: {
    description: 'Perceptual color difference (ΔE_OK) between two colors',
    complexity: 8000,
    signature: '(color | string | tuple, color | string | tuple) -> number',
    evaluate: (ops, { engine: ce }) => {
      // Both inputs converge on OklchColor; distance is computed in OKLab so
      // wide-gamut inputs aren't gamut-clipped before measurement.
      const a = toOklch(ce, ops[0]);
      const b = toOklch(ce, ops[1]);
      if (!a || !b) return ce.error('incompatible-type');
      return ce.number(oklabDeltaE(oklchToOklab(a), oklchToOklab(b)));
    },
  },
};
