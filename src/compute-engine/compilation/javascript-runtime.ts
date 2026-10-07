import { Complex } from 'complex.js';
import {
  chop,
  factorial,
  factorial2,
  realGcd as gcd,
  realLcm as lcm,
  limit,
  centeredDiffHigherOrder,
  centeredDiffHigherOrderVector,
  tanWithPole,
  cotWithPole,
  secWithPole,
  cscWithPole,
  floorModDouble,
  isBeyondSafeInteger,
  roundToInteger,
} from '../numerics/numeric.js';
import {
  parseColor,
  rgbToOklch,
  rgbToOklab,
  oklabToOklch,
  oklchToOklab,
  hsvToRgb,
  oklabDeltaE,
  apca,
  contrastingColor,
  SEQUENTIAL_PALETTES,
  CATEGORICAL_PALETTES,
  DIVERGING_PALETTES,
} from '@arnog/colors';
import type { HexColor } from '@arnog/colors';
import {
  readColorChannels,
  hslToRgb255,
  oklabToRgb255,
  oklchToRgb255,
  rgb255ToHsl,
  rgb255ToHsv,
  gamutMapOklch,
  gamutMapSrgb,
  gamutToSrgb,
  srgbToGamut,
  inGamut,
  readColorGamut,
  displayP3String,
} from '../numerics/color-conversion.js';
import type { ColorGamut } from '../numerics/color-conversion.js';
import {
  binomial,
  gamma,
  gammaln,
  erf,
  erfc,
  erfInv,
  beta,
  digamma,
  trigamma,
  polygamma,
  zeta,
  hurwitzZeta,
  zetaGeneralized,
  lambertW,
  besselJ,
  besselY,
  besselI,
  besselK,
  airyAi,
  airyBi,
  airyAiPrime,
  airyBiPrime,
  fresnelS,
  fresnelC,
  sinc,
  sinIntegral,
  cosIntegral,
  expIntegralEi,
  logIntegral,
  erfi,
  agm,
  ellipticK,
  ellipticE,
  ellipticEIncomplete,
  ellipticF,
  ellipticPiComplete,
  ellipticPiIncomplete,
  hypergeometric2F1,
  hypergeometric1F1,
  gammaQ,
  betaRegularized,
} from '../numerics/special-functions.js';
import {
  lerchPhiReal,
  dirichletEtaReal,
  dirichletBetaReal,
} from '../numerics/lerch-phi.js';
import { stieltjesGammaReal } from '../numerics/stieltjes.js';
import { clausen } from '../numerics/clausen.js';
import { polylogOrderReal } from '../numerics/polylog.js';
import {
  correlation,
  covariance,
  interquartileRange,
  kurtosis,
  mean,
  median,
  mode,
  populationCovariance,
  populationStandardDeviation,
  populationVariance,
  quartiles,
  skewness,
  standardDeviation,
  variance,
} from '../numerics/statistics.js';
import { monteCarloEstimate } from '../numerics/monte-carlo.js';
import { rangeCount } from '../numerics/range-count.js';
import { negativeBaseRealPowFromRational } from '../numerics/real-power.js';
import type { Rational } from '../numerics/types.js';
import type { RoundingTies } from '../types-definitions.js';
import {
  complexAcos,
  complexAcosh,
  complexAcot,
  complexAcoth,
  complexAcsc,
  complexAcsch,
  complexAsec,
  complexAsech,
  complexAsin,
  complexAsinh,
  complexAtan,
  complexAtanh,
  complexPow,
  complexSqrt,
  cosSinPi,
  scaledComplexDivide,
} from '../numerics/numeric-complex.js';
import {
  adaptiveQuadrature,
  insideQuadrature,
  quadratureBeatsMonteCarlo,
} from '../numerics/gauss-kronrod.js';
import { integrateSemiInfiniteOscillatory } from '../numerics/oscillatory-quadrature.js';
import {
  MAX_RANDOM_ELEMENT_COUNT,
  nextFrameDraw,
  withSeedFrame,
  foldSeed,
  type RandomSeedFrame,
} from '../numerics/random.js';
import {
  MAX_COLORMAP_SAMPLES,
  MAX_MATRIX_POWER_EXPONENT,
} from '../numerics/value-scaled-caps.js';
import {
  pNormIsSafe,
  scaledPNorm,
  spectralNorm,
} from '../numerics/linear-algebra.js';
import {
  checkDeadline,
  DEFAULT_ITERATION_LIMIT,
  type DeadlineFrame,
} from '../../common/interruptible.js';
import { CapabilityDeniedError } from '../effects-registry.js';
import { JET_HELPERS } from './jet-helpers.js';
import type {
  CompiledColor,
  CompiledColorSpace,
  ComplexResult,
  StoredEntryPlan,
} from './types.js';

/**
 * The number of significant digits the float exponent of a negative base is
 * read to, for the compiled code that is running now. A compilation result
 * records this number when the code is generated (`reconstructionDigits`),
 * and both `run()` and `load()` set it for the time of each call. The number
 * cannot be computed when the code runs: the precision of the engine can
 * change after the compilation, and a runtime bundle has its own `BigDecimal`,
 * whose precision is not the precision of the engine. When no compiled code
 * that records a number is running, the value is `undefined` and the helpers
 * use the current working precision.
 */
let activeReconstructionDigits: number | undefined;

/**
 * Set the number of digits the exponent of a negative base is read to, and
 * return the previous number. The caller restores the previous number in a
 * `finally` block, so that a call made from inside another compiled function
 * does not change the number of the outer one.
 */
export function setReconstructionDigits(
  digits: number | undefined
): number | undefined {
  const previous = activeReconstructionDigits;
  activeReconstructionDigits = digits;
  return previous;
}

// The helpers below call it as `negativeBaseRealPow`, as in the compiler.
const negativeBaseRealPow = (
  base: number,
  exact: Rational | null | undefined,
  expValue: number
): number | undefined =>
  negativeBaseRealPowFromRational(
    base,
    exact,
    expValue,
    activeReconstructionDigits
  );

/**
 * Convert a Complex instance produced by a TRANSCENDENTAL kernel (`csqrt`,
 * `cexp`, `casin`, `cpow`, …) to a plain `{re, im}` object. Nothing is
 * removed: these kernels give an exact `0` for a part whose value is `0` (a
 * real argument in the real domain, `sin` of an imaginary argument, `√−4`,
 * `ln(−1)`, `(1 + i)²`, `(−1)^0.5`, …), so the runner's result convention
 * can test `im !== 0` EXACTLY (a value whose imaginary part is exactly zero
 * comes back as a plain `number`) without chopping at the boundary —
 * ARCHITECTURE.md's rule is never to chop in ring arithmetic or constructors
 * (`1 + 1e-12i` is a legitimate value and stays one). A small part that is
 * the value is kept, as the interpreter keeps it (`arcoth(10⁻¹⁰⁰)` is
 * `10⁻¹⁰⁰ − (π/2)i`, `sin(π + i)` at the double `π` is
 * `1.9·10⁻¹⁶ − 1.175i`, `2^(10⁻¹⁰⁰·i)` is `1 + 6.93·10⁻¹⁰¹i`). A negative
 * zero part is made `+0`, since the interpreter does not keep the sign of a
 * zero.
 */
function kernelResult(c: Complex): { re: number; im: number } {
  return { re: c.re === 0 ? 0 : c.re, im: c.im === 0 ? 0 : c.im };
}

/**
 * The interpreter's unsigned pole `~oo` (`ComplexInfinity`) as the compiled
 * complex lane spells it: an infinite part and a non-zero imaginary part,
 * which is what `isUnsignedPole` tests for. A fresh object at every call, so
 * no caller can change the value another caller receives.
 */
const complexPole = (): { re: number; im: number } => ({
  re: Infinity,
  im: Infinity,
});

/** Is `z` exactly zero — the one argument at which a kernel's pole is hit
 *  exactly in floating point? */
const isComplexZero = (z: { re: number; im: number }): boolean =>
  z.re === 0 && z.im === 0;

/** Is `z` exactly `i` or `−i`, the poles of `arctan` and `arccot`? */
const isImaginaryUnitPole = (z: { re: number; im: number }): boolean =>
  z.re === 0 && Math.abs(z.im) === 1;

/**
 * `|z|`. A purely real `z` reads `Math.abs` rather than `Math.hypot(x, 0)`,
 * which is not guaranteed to return `|x|` to the last bit — and the base-10
 * and base-2 complex logarithms (`_SYS.clog10`, `_SYS.clog2`) need the exact
 * real argument so that their real-axis value matches the real lane's.
 */
function complexModulus(z: ComplexResult): number {
  return z.im === 0 ? Math.abs(z.re) : Math.hypot(z.re, z.im);
}

/**
 * `|v|` for one entry of a vector or a matrix that `_SYS.norm` reads: a
 * plain number, or a `{re, im}` object, which is how compiled code holds a
 * complex entry (`[x, i]` lowers to `[x, { re: 0, im: 1 }]`). A value with
 * an infinite part has the magnitude `+∞`, as `_SYS.cabs` answers. Anything
 * else — a nested array where a scalar was expected — is NaN.
 */
function entryModulus(v: unknown): number {
  if (typeof v === 'number') return Math.abs(v);
  if (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as ComplexResult).re === 'number' &&
    typeof (v as ComplexResult).im === 'number'
  ) {
    const z = v as ComplexResult;
    if (Math.abs(z.re) === Infinity || Math.abs(z.im) === Infinity)
      return Infinity;
    return complexModulus(z);
  }
  return NaN;
}

/**
 * Canonicalize an alpha value. Returns `undefined` for undefined, non-finite,
 * or effectively-1 inputs so downstream sites can use a simple
 * `alpha !== undefined` check to decide whether to emit it. Mirrors the
 * helper of the same name in `library/colors.ts` so the interpreted and
 * compiled paths agree on alpha semantics.
 */
function normalizeAlpha(a: number | undefined): number | undefined {
  if (a === undefined) return undefined;
  if (!Number.isFinite(a)) return undefined;
  if (Math.abs(a - 1) < 1e-9) return undefined;
  return a;
}

/** Are all three channels finite numbers? A conversion result whose channels
 * are not is the non-finite color (`nonFiniteColor`). */
function finiteChannels(c0: number, c1: number, c2: number): boolean {
  return Number.isFinite(c0) && Number.isFinite(c1) && Number.isFinite(c2);
}

/**
 * Build a color value.
 *
 * The five keys are always written in this order, so every color on this
 * target shares one hidden class and a channel read from a mixed stream of
 * colors stays monomorphic. `alpha` is present and `undefined` for a color
 * that carries no alpha; it is never omitted.
 */
function mkColor(
  space: CompiledColorSpace,
  c0: number,
  c1: number,
  c2: number,
  alpha: number | undefined
): CompiledColor {
  return { space, c0, c1, c2, alpha };
}

/** The five color spaces a compiled color value can carry. */
const COMPILED_COLOR_SPACES: ReadonlySet<string> = new Set([
  'oklch',
  'rgb',
  'hsv',
  'hsl',
  'oklab',
]);

/**
 * Is `v` a color VALUE (not a color string, and not a list)?
 *
 * The `space` must be one of the five spellings, not merely a string: the
 * readers below switch on it, and an unrecognized spelling — `srgb` from a
 * `vars` input, say — would take the OKLCh arm and answer a plausible but
 * wrong color. An object with some other `space` is not a color at all and
 * `asCompiledColor` refuses it by name.
 */
function isCompiledColor(v: unknown): v is CompiledColor {
  return (
    typeof v === 'object' &&
    v !== null &&
    COMPILED_COLOR_SPACES.has((v as CompiledColor).space)
  );
}

/** The shape a color helper accepts, named in the `TypeError` it throws for
 * anything else. */
const COLOR_SHAPE =
  "a color value — an object `{ space, c0, c1, c2, alpha }` with `space` one of 'oklch', " +
  "'rgb', 'hsv', 'hsl', 'oklab' — or a CSS color string. A bare numeric array is a LIST, " +
  'not a color.';

/** The compiled value of a color whose channels `readColorChannels` refuses
 * (a `NaN`, or an infinite value in a channel that is not clamped): the `NaN`
 * channels, the numeric projection of the interpreter's `incompatible-type`
 * error, in the space the answering helper names and keeping the alpha slot
 * when one was given. */
function nonFiniteColor(
  alpha: number | undefined,
  space: CompiledColorSpace = 'oklch'
): CompiledColor {
  return mkColor(space, NaN, NaN, NaN, normalizeAlpha(alpha));
}

/**
 * Resolve any accepted color input to a color VALUE.
 *
 * A CSS color string is parsed to the canonical OKLCh form. A color value
 * passes through unchanged, whatever its space — this is the single point
 * where a consumer learns the space of the color it was handed.
 *
 * A NON-FINITE number is the absent-position sentinel of a broadcast
 * (`_SYS.bcastColor` maps a `NaN` element through the same conversion as a
 * color), and it answers the non-finite color, which is what the
 * interpreter's per-position `incompatible-type` error projects to on this
 * target.
 *
 * Anything else throws. A bare numeric array reaches here from a `vars` input
 * or from a consumer that still passes the pre-2026-09 array representation,
 * and reading it as a color would answer a plausible but wrong value, so it
 * fails closed at run time with a message that names the shape. An object
 * that carries an unrecognized `space` fails the same way, and the message
 * names the offending spelling: the readers switch on the space, so a color
 * tagged `srgb` would silently take the OKLCh arm.
 */
function asCompiledColor(input: unknown): CompiledColor {
  if (typeof input === 'string')
    return packedToColor(parseColorStringOrThrow(input));
  if (isCompiledColor(input)) return input;
  if (typeof input === 'number' && !Number.isFinite(input))
    return nonFiniteColor(undefined);
  if (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as CompiledColor).space === 'string'
  )
    throw new TypeError(
      `Not a color: "${(input as CompiledColor).space}" is not a color ` +
        `space. Expected ${COLOR_SHAPE}`
    );
  throw new TypeError(`Not a color. Expected ${COLOR_SHAPE}`);
}

/**
 * Normalize any color input to an `RgbColor` (0-255 channels).
 *
 * The conversion is chosen from the value's own space: a color already in
 * sRGB is scaled, never routed through OKLCh, so `AsRgb(AsRgb(c))` answers
 * `AsRgb(c)` channel for channel, without the rounding error of a round
 * trip through OKLCh.
 */
function toRgb255(input: unknown): {
  r: number;
  g: number;
  b: number;
  alpha?: number;
} {
  if (typeof input === 'string') {
    const c = parseColorStringOrThrow(input);
    const rgb: { r: number; g: number; b: number; alpha?: number } = {
      r: (c >>> 24) & 0xff,
      g: (c >>> 16) & 0xff,
      b: (c >>> 8) & 0xff,
    };
    const alpha = normalizeAlpha((c & 0xff) / 255);
    if (alpha !== undefined) rgb.alpha = alpha;
    return rgb;
  }
  const c = asCompiledColor(input);
  const alpha = c.alpha;
  // The channels are read by the rule the interpreter applies
  // (`readColorChannels`): HSV/HSL saturation, value and lightness are
  // clamped into [0, 1], and an infinite channel that is not clamped is
  // refused. A value built by a constructor has already been read so, but a
  // color value from a `vars` input has not. Channels the rule refuses make
  // the non-finite color, and it stays non-finite: the conversions
  // below compute a hue from `max`/`min` comparisons, and every comparison
  // with `NaN` is false, so without this test an HSV `NaN` color came back
  // as a finite red.
  const channels = readColorChannels(c.space, c.c0, c.c1, c.c2);
  if (channels === undefined)
    return alpha !== undefined
      ? { r: NaN, g: NaN, b: NaN, alpha }
      : { r: NaN, g: NaN, b: NaN };
  const [c0, c1, c2] = channels;
  // The conversions do not round: the channels stay on the 0-255 scale as
  // real numbers, so `AsRgb(Hsv(30, 1, 1))` has a green channel of 0.5, not
  // 127/255 (`numerics/color-conversion.ts`). They do no gamut mapping
  // either: an OKLCh color outside the sRGB gamut converts to extended sRGB
  // channels, below 0 or above 255.
  let rgb: { r: number; g: number; b: number };
  switch (c.space) {
    case 'rgb':
      rgb = { r: c0 * 255, g: c1 * 255, b: c2 * 255 };
      break;
    case 'hsv':
      rgb = hsvToRgb(c0, c1, c2);
      break;
    case 'hsl':
      rgb = hslToRgb255(c0, c1, c2);
      break;
    case 'oklab':
      rgb = oklabToRgb255({ L: c0, a: c1, b: c2 });
      break;
    case 'oklch':
      rgb = oklchToRgb255({ L: c0, C: c1, H: c2 });
      break;
    default:
      // Unreachable: `asCompiledColor` admits only the five spellings, each
      // of which has an arm above. An arm is missing if this ever throws —
      // never a color read in a space it is not in.
      throw new TypeError(`Not a color: unhandled color space "${c.space}"`);
  }
  return alpha !== undefined
    ? { r: rgb.r, g: rgb.g, b: rgb.b, alpha }
    : { r: rgb.r, g: rgb.g, b: rgb.b };
}

/** Resolve any color input to Oklch components, preserving alpha if present.
 *
 * This is the ONE reader every color-consuming helper goes through: it reads
 * the value's `space` and converts from it, so a color produced by an
 * explicit conversion (`AsRgb`, `AsHsv`, …) is understood as the space it
 * names rather than misread as OKLCh. */
function toOklch(input: unknown): {
  L: number;
  C: number;
  H: number;
  alpha?: number;
} {
  const c = asCompiledColor(input);
  const alpha = c.alpha;
  // The channels are read by `readColorChannels`, the interpreter's rule:
  // HSV/HSL saturation, value and lightness are clamped into [0, 1], and a
  // `NaN` or an infinite channel that is not clamped makes the `NaN` color. A color value from a `vars`
  // input has not been through a constructor, so the rule is applied here.
  const channels = readColorChannels(c.space, c.c0, c.c1, c.c2);
  if (channels === undefined) return { L: NaN, C: NaN, H: NaN, alpha };
  const [c0, c1, c2] = channels;
  let oklch: { L: number; C: number; H: number };
  switch (c.space) {
    case 'oklab':
      oklch = oklabToOklch({ L: c0, a: c1, b: c2 });
      break;
    case 'rgb':
      oklch = rgbToOklch({ r: c0 * 255, g: c1 * 255, b: c2 * 255 });
      break;
    case 'hsv':
      oklch = rgbToOklch(hsvToRgb(c0, c1, c2));
      break;
    case 'hsl':
      oklch = rgbToOklch(hslToRgb255(c0, c1, c2));
      break;
    case 'oklch':
      oklch = { L: c0, C: c1, H: c2 };
      break;
    default:
      // Unreachable: `asCompiledColor` admits only the five spellings, each
      // of which has an arm above. An arm is missing if this ever throws —
      // never a color read in a space it is not in.
      throw new TypeError(`Not a color: unhandled color space "${c.space}"`);
  }
  return { L: oklch.L, C: oklch.C, H: oklch.H, alpha };
}

/**
 * A `#` color with exactly 3, 4, 6 or 8 hexadecimal digits. `parseColor()`
 * does not check the digits of a `#` form — it reads `#gg0000` as opaque
 * black — so the shape is checked here.
 */
const HEX_COLOR_FORM = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;

/** A `#` color with exactly 4 hexadecimal digits (`#rgba`). */
const FOUR_DIGIT_HEX_FORM = /^#[0-9a-f]{4}$/;

/**
 * Expand a four-digit `#rgba` spelling to the eight-digit `#rrggbbaa` form by
 * doubling each digit. Returns `undefined` for any other spelling.
 *
 * `parseColor()` reads a `#` form of 3, 6 or 8 digits only and answers its
 * zero sentinel for every other length, so `#f00f` — opaque red in CSS — was
 * read as transparent black. The expansion is done before the call so the
 * parser sees a length it handles.
 */
function expandFourDigitHex(spelling: string): string | undefined {
  if (!FOUR_DIGIT_HEX_FORM.test(spelling)) return undefined;
  return `#${[...spelling.slice(1)].map((d) => d + d).join('')}`;
}

/**
 * A COMPLETE functional color notation: one of the spellings `parseColor()`
 * understands, with a non-empty argument list closed by a parenthesis.
 *
 * Measured against `@arnog/colors`, not assumed: `hsla(`, `lab(`, `lch(`,
 * `hwb(` and `color(` are NOT among them and are refused like any other
 * unknown spelling.
 *
 * The whole form is anchored, not just the opening prefix: an unterminated or
 * empty spelling (`rgb(255,0,0`, `rgba()`) also packs to the parser's zero
 * sentinel, and reading it as transparent black turned a typing mistake into
 * a color. An alpha written inside the parentheses (`rgb(0 0 0 / 0)`) is part
 * of the argument list, so the form still admits it.
 */
const COLOR_FUNCTION_FORM = /^(rgba?|hsl|oklch|oklab)\s*\(\s*[^()]+\s*\)$/;

/**
 * Parse a CSS-style color string to a packed `0xRRGGBBAA` integer. This is
 * the same predicate the interpreter applies (`parseColorString`,
 * `library/colors.ts`), which the GPU target calls directly, so a string is a
 * color on every route or on none of them.
 *
 * `parseColor()` answers 0 both for a string that is not a color and for
 * transparent black, whose packing is 0. The two are told apart by the
 * SPELLING: a well-formed color notation that lands on 0 is transparent
 * black, so `#00000000` and `rgba(0, 0, 0, 0)` are colors just as the keyword
 * `transparent` is. A COMPUTED color with a zero alpha is a color value, not
 * a string, and never reaches this predicate.
 *
 * A string that names no color throws, which is how the neighbouring helpers
 * already report an unusable name ("Unknown palette", "Unknown color
 * space"). Reading it as transparent black instead made a misspelled color
 * compile to a silent, plausible-looking value where the interpreter answered
 * `incompatible-type`.
 */
function parseColorStringOrThrow(input: string): number {
  const spelling = input.trim().toLowerCase();
  const refuse = (): never => {
    throw new Error(`Unknown color: ${input}`);
  };
  if (spelling.startsWith('#') && !HEX_COLOR_FORM.test(spelling)) refuse();
  let c: number;
  try {
    c = parseColor((expandFourDigitHex(spelling) ?? input) as HexColor);
  } catch {
    // A malformed functional notation throws inside the parser.
    return refuse();
  }
  if (c !== 0) return c;
  if (spelling === 'transparent' || spelling.startsWith('#')) return 0;
  if (COLOR_FUNCTION_FORM.test(spelling)) return 0;
  return refuse();
}

/** Packed 0xRRGGBBAA integer to a canonical OKLCh color value. */
function packedToColor(c: number): CompiledColor {
  const r = (c >>> 24) & 0xff;
  const g = (c >>> 16) & 0xff;
  const b = (c >>> 8) & 0xff;
  const oklch = rgbToOklch({ r, g, b });
  return mkColor(
    'oklch',
    oklch.L,
    oklch.C,
    oklch.H,
    normalizeAlpha((c & 0xff) / 255)
  );
}

/**
 * Map a color into `gamut` with the CSS Color 4 gamut mapping, and answer its
 * gamma-encoded coordinates in that gamut (0-1 scale), each in [0, 1], with
 * its alpha.
 *
 * This is the rule of the interpreter (`gamutMapColor`, `library/colors.ts`):
 * a color held in OKLCh or OKLab is mapped from its own OKLCh channels, so its
 * chroma does not go through sRGB first, and any other color (a color in
 * sRGB, HSV or HSL, or a color string) is mapped from its extended sRGB
 * channels. A color whose channels `readColorChannels` refuses has `NaN`
 * channels, and they stay `NaN`: every comparison of the mapping with `NaN`
 * is false, so it returns the clip of the `NaN` channels, which is `NaN`.
 */
function gamutMapInput(
  input: unknown,
  gamut: ColorGamut
): { channels: [number, number, number]; alpha: number | undefined } {
  if (
    isCompiledColor(input) &&
    (input.space === 'oklch' || input.space === 'oklab')
  ) {
    const c = toOklch(input);
    return { channels: gamutMapOklch(c.L, c.C, c.H, gamut), alpha: c.alpha };
  }
  const rgb = toRgb255(input);
  return {
    channels: gamutMapSrgb(rgb.r / 255, rgb.g / 255, rgb.b / 255, gamut),
    alpha: rgb.alpha,
  };
}

/**
 * True when the run-time array `a` is a LIST of points rather than one point:
 * its first cell is a point (an array). A first cell that is `undefined` or
 * `null` is an absent point (the run-time spelling of `Missing`), and the
 * array is a list of points when another cell is a point. A point's own
 * coordinates are numbers or `{re, im}` objects, never arrays.
 */
function isPointArrayList(a: readonly unknown[]): boolean {
  if (Array.isArray(a[0])) return true;
  return a[0] == null && a.some((x) => Array.isArray(x));
}

/** Color runtime helpers shared by both SYS objects. */
const colorHelpers = {
  color(input: unknown): CompiledColor {
    const c = toOklch(input);
    return mkColor('oklch', c.L, c.C, c.H, c.alpha);
  },
  colorToString(input: unknown, format?: string): string {
    const fmt = (format ?? 'hex').toLowerCase();
    if (fmt === 'display-p3') {
      const p3 = gamutMapInput(input, 'display-p3');
      return displayP3String(p3.channels, p3.alpha);
    }
    // The hex, `srgb`, `rgb` and `hsl` formats are sRGB: the color is first
    // mapped into the sRGB gamut with the CSS Color 4 gamut mapping, as the
    // interpreter does. A clip of each channel changed the hue:
    // `Oklch(0.7, 0.4, 30)` was `#ff0000` here and `#ff5843` there. The
    // `oklch` format has no gamut and is not mapped.
    let rgb: { r: number; g: number; b: number; alpha?: number } = {
      r: NaN,
      g: NaN,
      b: NaN,
    };
    if (fmt === 'hex' || fmt === 'srgb' || fmt === 'rgb' || fmt === 'hsl') {
      const mapped = gamutMapInput(input, 'srgb');
      const [r, g, b] = mapped.channels;
      rgb = { r: r * 255, g: g * 255, b: b * 255 };
      if (mapped.alpha !== undefined) rgb.alpha = mapped.alpha;
    }
    switch (fmt) {
      case 'hex':
      case 'srgb': {
        const r = Math.round(Math.max(0, Math.min(255, rgb.r)));
        const g = Math.round(Math.max(0, Math.min(255, rgb.g)));
        const b = Math.round(Math.max(0, Math.min(255, rgb.b)));
        let hex = `#${r.toString(16).padStart(2, '0')}${g
          .toString(16)
          .padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        if (rgb.alpha !== undefined) {
          const a = Math.round(Math.max(0, Math.min(255, rgb.alpha * 255)));
          hex += a.toString(16).padStart(2, '0');
        }
        return hex;
      }
      case 'rgb': {
        const r = Math.round(rgb.r);
        const g = Math.round(rgb.g);
        const b = Math.round(rgb.b);
        if (rgb.alpha !== undefined)
          return `rgb(${r} ${g} ${b} / ${rgb.alpha})`;
        return `rgb(${r} ${g} ${b})`;
      }
      case 'hsl': {
        const hsl = rgb255ToHsl(rgb.r, rgb.g, rgb.b);
        const h = Math.round(hsl.h * 10) / 10;
        const s = Math.round(hsl.s * 1000) / 10;
        const l = Math.round(hsl.l * 1000) / 10;
        if (rgb.alpha !== undefined)
          return `hsl(${h} ${s}% ${l}% / ${rgb.alpha})`;
        return `hsl(${h} ${s}% ${l}%)`;
      }
      case 'oklch': {
        // Read the OKLCh components directly rather than through the sRGB
        // form above: an OKLCh color value already holds these components,
        // and routing it through sRGB clipped any chroma outside that gamut. The
        // interpreter keeps the same wide-gamut path for this format, so
        // `ColorToString(Oklch(0.6, 0.25, 29), 'oklch')` answered
        // `oklch(0.6 0.246 29)` here and `oklch(0.6 0.25 29)` there.
        const c = toOklch(input);
        const L = Math.round(c.L * 1000) / 1000;
        const C = Math.round(c.C * 1000) / 1000;
        const H = Math.round(c.H * 10) / 10;
        if (c.alpha !== undefined) return `oklch(${L} ${C} ${H} / ${c.alpha})`;
        return `oklch(${L} ${C} ${H})`;
      }
      default:
        throw new Error(`Unknown color format: ${fmt}`);
    }
  },
  colorMix(input1: unknown, input2: unknown, ratio = 0.5): CompiledColor {
    const c1 = toOklch(input1);
    const c2 = toOklch(input2);
    ratio = Math.max(0, Math.min(1, ratio));

    // Achromatic-aware shortest-arc hue interpolation: when one endpoint has
    // C ≈ 0 its hue is undefined, so use the other endpoint's hue throughout.
    const c1Achromatic = c1.C < 1e-6;
    const c2Achromatic = c2.C < 1e-6;
    let H: number;
    if (c1Achromatic && c2Achromatic) H = c1.H;
    else if (c1Achromatic) H = c2.H;
    else if (c2Achromatic) H = c1.H;
    else {
      let dh = c2.H - c1.H;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      H = c1.H + dh * ratio;
      if (H < 0) H += 360;
      if (H >= 360) H -= 360;
    }

    const L = c1.L + (c2.L - c1.L) * ratio;
    const C = c1.C + (c2.C - c1.C) * ratio;
    const a1 = c1.alpha ?? 1;
    const a2 = c2.alpha ?? 1;
    const alpha = normalizeAlpha(a1 + (a2 - a1) * ratio);
    return mkColor('oklch', L, C, H, alpha);
  },
  colorContrast(bg: unknown, fg: unknown): number {
    return apca(toRgb255(bg), toRgb255(fg));
  },
  contrastingColor(bg: unknown, fg1?: unknown, fg2?: unknown): CompiledColor {
    const bgRgb = toRgb255(bg);
    if (fg1 !== undefined && fg2 !== undefined) {
      // Answer the CHOSEN candidate itself, in this target's canonical OKLCh
      // form. The library routine answers a packed 0xRRGGBBAA integer, so
      // taking the color back from it quantized to 8 bits per channel a
      // candidate the caller passed as an exact color — the same loss the
      // interpreter no longer takes, where the chosen operand is answered
      // verbatim in the color space it was written in.
      //
      // `ContrastingColor` is a color-PRODUCING operator, so its value is
      // canonical whatever space the chosen candidate was written in. That is
      // the space `colorSpaceOf` reports for this head, and it is what makes
      // `AsOklch(ContrastingColor(bg, AsRgb(a), AsRgb(b)))` skip a conversion
      // it would otherwise need: answering the candidate in its own space
      // made that skip read sRGB channels as OKLCh.
      //
      // The comparison is the library's: the larger ABSOLUTE APCA contrast
      // wins, with the candidate as the FIRST argument of the contrast (APCA
      // is not symmetric in its two arguments).
      const rgb1 = toRgb255(fg1);
      const rgb2 = toRgb255(fg2);
      const chosen =
        Math.abs(apca(rgb1, bgRgb)) >= Math.abs(apca(rgb2, bgRgb)) ? fg1 : fg2;
      const c = toOklch(chosen);
      return mkColor('oklch', c.L, c.C, c.H, c.alpha);
    }
    // Default: the better of the built-in white and black. Neither is a
    // caller value, so there is no color space to preserve.
    return packedToColor(contrastingColor(bgRgb));
  },
  // `ColorToColorspace` answers COMPONENTS, not a color: its interpreter
  // signature is `-> tuple` and consumers index the result
  // (`At(ColorToColorspace(c, "rgb"), 1)`). So the compiled value is a plain
  // array of three channels, four with the alpha, which is the same array a
  // folded call emits for the interpreter's `Tuple`.
  colorToColorspace(input: unknown, space: string): number[] {
    const rgb = toRgb255(input);
    const alpha = rgb.alpha;
    let result: number[];
    switch (space.toLowerCase()) {
      case 'rgb':
        result = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
        break;
      case 'hsl': {
        const hsl = rgb255ToHsl(rgb.r, rgb.g, rgb.b);
        result = [hsl.h, hsl.s, hsl.l];
        break;
      }
      case 'hsv': {
        const hsv = rgb255ToHsv(rgb.r, rgb.g, rgb.b);
        result = [hsv.h, hsv.s, hsv.v];
        break;
      }
      case 'oklch': {
        const c = rgbToOklch(rgb);
        result = [c.L, c.C, c.H];
        break;
      }
      case 'oklab':
      case 'lab': {
        const lab = rgbToOklab(rgb);
        result = [lab.L, lab.a, lab.b];
        break;
      }
      default:
        throw new Error(`Unknown color space: ${space}`);
    }
    // A non-finite color converts to non-finite components. The hue
    // conversions above read the hue off `max`/`min` comparisons, and every
    // comparison with `NaN` is false, so they answered a hue of zero — red —
    // where every `As*` conversion answers `NaN` for the same input. The
    // components are replaced after the switch so an unknown space still
    // throws for a non-finite color, as it does for a finite one.
    if (!finiteChannels(rgb.r, rgb.g, rgb.b)) result = [NaN, NaN, NaN];
    if (alpha !== undefined) result.push(alpha);
    return result;
  },
  colormap(
    name: string,
    arg?: number
  ): CompiledColor | CompiledColor[] | number {
    const allPalettes = {
      ...SEQUENTIAL_PALETTES,
      ...CATEGORICAL_PALETTES,
      ...DIVERGING_PALETTES,
    };
    const palette = allPalettes[name as keyof typeof allPalettes];
    if (!palette) throw new Error(`Unknown palette: ${name}`);

    // Each palette stop is stored as an OKLCh color value for
    // perceptually-uniform interpolation and to match the compiled-runtime
    // color representation.
    const colors = (palette as readonly string[]).map((hex: HexColor) =>
      packedToColor(parseColor(hex))
    );

    // No second arg → return full palette
    if (arg === undefined) return colors;

    // Integer n >= 2 → resample to n evenly spaced colors. Past the cap the
    // interpreter stays symbolic; the compiled spelling for that is NaN.
    if (Number.isInteger(arg) && arg >= 2) {
      const n = arg;
      if (n > MAX_COLORMAP_SAMPLES) return NaN;
      const result: CompiledColor[] = [];
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        result.push(this._interpolatePalette(colors, t));
      }
      return result;
    }

    // A non-finite position (NaN from upstream real arithmetic, ±∞ — e.g. a
    // real-only guard's failing branch, or plain `√(-1)` in strict mode)
    // cannot index the palette: `colors[NaN]` is `undefined` and the
    // destructuring in `_interpolatePalette` throws "undefined is not
    // iterable" at run time. NaN-in/NaN-out, like compiled real arithmetic.
    if (!Number.isFinite(arg)) return nonFiniteColor(undefined);

    // Float t in [0, 1] → interpolate at position t
    const t = Math.max(0, Math.min(1, arg));
    return this._interpolatePalette(colors, t);
  },

  _interpolatePalette(colors: CompiledColor[], t: number): CompiledColor {
    const copy = (c: CompiledColor): CompiledColor =>
      mkColor(c.space, c.c0, c.c1, c.c2, c.alpha);
    if (colors.length === 0) return mkColor('oklch', 0, 0, 0, undefined);
    if (t <= 0) return copy(colors[0]);
    if (t >= 1) return copy(colors[colors.length - 1]);

    const pos = t * (colors.length - 1);
    const i = Math.floor(pos);
    const frac = pos - i;

    if (frac === 0 || i >= colors.length - 1)
      return copy(colors[Math.min(i, colors.length - 1)]);

    // Interpolate directly in Oklch (palette stops are already Oklch).
    const { c0: L1, c1: C1, c2: H1 } = colors[i];
    const { c0: L2, c1: C2, c2: H2 } = colors[i + 1];

    const c1Achromatic = C1 < 1e-6;
    const c2Achromatic = C2 < 1e-6;
    let H: number;
    if (c1Achromatic && c2Achromatic) H = H1;
    else if (c1Achromatic) H = H2;
    else if (c2Achromatic) H = H1;
    else {
      let dh = H2 - H1;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      H = H1 + dh * frac;
      if (H < 0) H += 360;
      if (H >= 360) H -= 360;
    }

    return mkColor(
      'oklch',
      L1 + (L2 - L1) * frac,
      C1 + (C2 - C1) * frac,
      H,
      undefined
    );
  },

  colorFromColorspace(components: unknown, space: string): CompiledColor {
    // The operand is raw COMPONENTS in the named space. A tuple compiles to a
    // numeric array; a typed color head reaches here as a color VALUE, and
    // the interpreter reads such a head's channels as components too
    // (`ColorFromColorspace`, `library/colors.ts`), so its channels are used
    // as they are and its own space is ignored.
    let c0: number, c1: number, c2: number;
    let alpha: number | undefined;
    if (Array.isArray(components)) {
      c0 = components[0];
      c1 = components[1];
      c2 = components[2];
      alpha = components.length >= 4 ? components[3] : undefined;
    } else {
      const c = asCompiledColor(components);
      c0 = c.c0;
      c1 = c.c1;
      c2 = c.c2;
      alpha = c.alpha;
    }
    // The channels are KEPT in the space they were given in, and the value is
    // tagged with it. The interpreter answers the color head of that space
    // (`ColorFromColorspace((0.5, 0.1, 20), "oklch")` is `Oklch(0.5, 0.1,
    // 20)`), so tagging rather than converting is what makes a caller that
    // reads `space`, or a channel, see the same color on both routes. Every
    // helper that consumes a color reads the tag (`toOklch`), so the
    // conversion happens where the color is used.
    const name = space.toLowerCase();
    const tag = name === 'lab' ? 'oklab' : name;
    if (!COMPILED_COLOR_SPACES.has(tag))
      throw new Error(`Unknown color space: ${space}`);
    // The channels are read by the rule of the named space, as the
    // interpreter reads them (`readColorChannels`).
    const channels = readColorChannels(tag as CompiledColorSpace, c0, c1, c2);
    if (channels === undefined)
      return nonFiniteColor(alpha, tag as CompiledColorSpace);
    return mkColor(
      tag as CompiledColorSpace,
      channels[0],
      channels[1],
      channels[2],
      normalizeAlpha(alpha)
    );
  },

  // -----------------------------------------------------------------------
  // Color constructors. Each accepts components in its colorspace's natural
  // units and returns a color value in the canonical OKLCh space.
  //
  // The channels are read by `readColorChannels`, the rule the
  // interpreter's `readColorExpr` (`library/colors.ts`) also applies, so the
  // two routes admit and refuse the same colors:
  //
  // - `Rgb` channels are EXTENDED sRGB. A finite channel outside [0, 1] is a
  //   color outside the sRGB gamut and is kept: no clamp, and no gamut
  //   mapping in any conversion. The sRGB transfer function is
  //   sign-extended, so a negative channel converts to OKLCh and back.
  // - HSV saturation and value and HSL saturation and lightness are clamped
  //   into [0, 1], an infinite one included (+Infinity reads as 1 and
  //   -Infinity as 0): HSV and HSL describe only the sRGB gamut. So
  //   `Hsv(90, 1, +oo)` is the color of `Hsv(90, 1, 1)`.
  // - A `NaN` channel, or an infinite channel that is not clamped (an sRGB
  //   channel, a hue, an OKLab/OKLCh channel), yields the `NaN` color, the
  //   projection on a numeric target of the interpreter's
  //   `incompatible-type` error.
  //
  // Alpha is separate: a non-finite alpha reads as opaque on both routes
  // (`normalizeAlpha`).
  // -----------------------------------------------------------------------
  rgb(r: number, g: number, b: number, alpha?: number): CompiledColor {
    const ch = readColorChannels('rgb', r, g, b);
    if (ch === undefined) return nonFiniteColor(alpha);
    // Inputs are 0-1 sRGB; `rgbToOklch` expects 0-255 channels.
    const c = rgbToOklch({ r: ch[0] * 255, g: ch[1] * 255, b: ch[2] * 255 });
    return mkColor('oklch', c.L, c.C, c.H, normalizeAlpha(alpha));
  },
  hsv(h: number, s: number, v: number, alpha?: number): CompiledColor {
    const ch = readColorChannels('hsv', h, s, v);
    if (ch === undefined) return nonFiniteColor(alpha);
    const rgb = hsvToRgb(ch[0], ch[1], ch[2]);
    const c = rgbToOklch(rgb);
    return mkColor('oklch', c.L, c.C, c.H, normalizeAlpha(alpha));
  },
  hsl(h: number, s: number, l: number, alpha?: number): CompiledColor {
    const ch = readColorChannels('hsl', h, s, l);
    if (ch === undefined) return nonFiniteColor(alpha);
    const c = rgbToOklch(hslToRgb255(ch[0], ch[1], ch[2]));
    return mkColor('oklch', c.L, c.C, c.H, normalizeAlpha(alpha));
  },
  oklab(L: number, a: number, b: number, alpha?: number): CompiledColor {
    const ch = readColorChannels('oklab', L, a, b);
    if (ch === undefined) return nonFiniteColor(alpha);
    const c = oklabToOklch({ L: ch[0], a: ch[1], b: ch[2] });
    return mkColor('oklch', c.L, c.C, c.H, normalizeAlpha(alpha));
  },
  oklch(L: number, C: number, H: number, alpha?: number): CompiledColor {
    const ch = readColorChannels('oklch', L, C, H);
    if (ch === undefined) return nonFiniteColor(alpha);
    return mkColor('oklch', ch[0], ch[1], ch[2], normalizeAlpha(alpha));
  },

  /**
   * Read color COMPONENTS as a color, in 0-1 sRGB, with a 4th component read
   * as alpha.
   *
   * A tuple's compiled value on this target is a bare array, and a tuple at
   * the operand of an ENTRY function — one of the five `As*` conversions, or
   * `ColorToColorspace` — is 0-1 sRGB components, exactly as a tuple written
   * literally there is. The array is only visible at run time when it reaches
   * the position through a variable or from a head that answers components,
   * so the width and the channels are checked here and the conversion is the
   * one `_SYS.rgb` performs (`compileColorEntryOperand`).
   *
   * Any other shape throws the color-shape `TypeError`: the interpreter
   * answers `incompatible-type` for an operand it cannot read three channels
   * off, and a plausible color built from a wrong shape would be worse than a
   * throw.
   */
  colorFromSrgbComponents(input: unknown): CompiledColor {
    if (
      Array.isArray(input) &&
      (input.length === 3 || input.length === 4) &&
      input.every((v) => typeof v === 'number')
    )
      return colorHelpers.rgb(input[0], input[1], input[2], input[3]);
    throw new TypeError(
      'Not a color: color components are 3 numbers, or 4 with the fourth ' +
        `read as alpha. Expected ${COLOR_SHAPE}`
    );
  },

  // -----------------------------------------------------------------------
  // As* converters. Inputs are anything `toOklch` accepts (a color value in
  // any space, or a color string). Each output is a color value TAGGED with
  // the space it names, so a conversion result reaching a second color
  // operator is understood rather than misread as OKLCh. sRGB-based outputs
  // (asRgb/asHsv/asHsl) use 0-1 channels for consistency with the GPU
  // target's shader convention.
  // -----------------------------------------------------------------------
  /**
   * `GamutMap`: map a color into `gamutName` ("srgb", the default, or
   * "display-p3") with the CSS Color 4 gamut mapping, and answer it as a
   * color in sRGB, tagged `rgb`, as the interpreter answers an `Rgb` head.
   * For "display-p3" the channels are extended sRGB: a color inside the
   * Display-P3 gamut but outside the sRGB gamut has a channel outside
   * [0, 1].
   *
   * A color already in sRGB and inside the gamut is returned with its own
   * channels, as the interpreter returns such an `Rgb` head unchanged. For
   * "srgb" that requires each channel in [0, 1]; a channel a little outside
   * (within the tolerance of the gamut test) is mapped, which clips it.
   */
  gamutMap(input: unknown, gamutName = 'srgb'): CompiledColor {
    const gamut = readColorGamut(gamutName);
    if (gamut === undefined)
      throw new Error(
        `Unknown gamut: ${gamutName} — the gamut is "srgb" or "display-p3"`
      );
    if (isCompiledColor(input) && input.space === 'rgb') {
      const ch = readColorChannels('rgb', input.c0, input.c1, input.c2);
      if (ch !== undefined) {
        const inside =
          gamut === 'srgb'
            ? ch.every((x) => x >= 0 && x <= 1)
            : inGamut(srgbToGamut(ch, gamut));
        if (inside) return mkColor('rgb', ch[0], ch[1], ch[2], input.alpha);
      }
    }
    const mapped = gamutMapInput(input, gamut);
    const [r, g, b] = gamutToSrgb(mapped.channels, gamut);
    return mkColor('rgb', r, g, b, mapped.alpha);
  },
  asRgb(input: unknown): CompiledColor {
    const rgb = toRgb255(input);
    return mkColor('rgb', rgb.r / 255, rgb.g / 255, rgb.b / 255, rgb.alpha);
  },
  // `rgb255ToHsv` and `rgb255ToHsl` compute the hue from `max`/`min`
  // comparisons, and every comparison with `NaN` is false, so a non-finite
  // color came out of `asHsv` with a hue of zero, which is red. The four
  // other conversions answer the `NaN` triple for the same input, and that
  // triple is what the interpreter's `incompatible-type` rejection projects
  // to on this target, so the guard is explicit here rather than left to the
  // comparisons.
  asHsv(input: unknown): CompiledColor {
    const rgb = toRgb255(input);
    if (!finiteChannels(rgb.r, rgb.g, rgb.b))
      return nonFiniteColor(rgb.alpha, 'hsv');
    const hsv = rgb255ToHsv(rgb.r, rgb.g, rgb.b);
    return mkColor('hsv', hsv.h, hsv.s, hsv.v, rgb.alpha);
  },
  asHsl(input: unknown): CompiledColor {
    const rgb = toRgb255(input);
    if (!finiteChannels(rgb.r, rgb.g, rgb.b))
      return nonFiniteColor(rgb.alpha, 'hsl');
    const hsl = rgb255ToHsl(rgb.r, rgb.g, rgb.b);
    return mkColor('hsl', hsl.h, hsl.s, hsl.l, rgb.alpha);
  },
  asOklab(input: unknown): CompiledColor {
    const c = toOklch(input);
    if (!finiteChannels(c.L, c.C, c.H)) return nonFiniteColor(c.alpha, 'oklab');
    const lab = oklchToOklab({ L: c.L, C: c.C, H: c.H });
    return mkColor('oklab', lab.L, lab.a, lab.b, c.alpha);
  },
  // `AsOklch` of a color VALUE is the identity, and the compile-time
  // pass-through covers it. This helper is for the element of a color
  // BROADCAST (`_SYS.bcastColor`), where the element may be a color STRING
  // that the pass-through would hand back unconverted.
  asOklch(input: unknown): CompiledColor {
    const c = toOklch(input);
    return mkColor('oklch', c.L, c.C, c.H, c.alpha);
  },

  // Perceptual color difference (ΔE_OK).
  colorDelta(a: unknown, b: unknown): number {
    const labA = oklchToOklab(toOklch(a));
    const labB = oklchToOklab(toOklch(b));
    return oklabDeltaE(labA, labB);
  },

  // Euclidean distance between two points, broadcasting over a list of
  // points. Plain numeric — not a color operation despite living in the same
  // helpers block.
  //
  // A point is a flat numeric array (both the `Tuple` and the `List`
  // spellings compile to one); a LIST of points is an array of those. A point
  // against a list of points maps the distance over the list; two lists zip
  // pairwise and must have the same length (the lifted-operator convention —
  // no truncation to the shortest), mirroring the interpreter's `Distance`
  // broadcast (Tycho items 130/138).
  distance(a: unknown, b: unknown): number | number[] {
    if (!Array.isArray(a) || !Array.isArray(b))
      throw new Error('Could not compile `Distance`: expected two arrays');
    // An EMPTY array reads as an empty list of points (a 0-dimensional point
    // has no distance), matching the interpreter's `Distance([], p) → []`.
    const aList = a.length === 0 || isPointArrayList(a);
    const bList = b.length === 0 || isPointArrayList(b);
    // An absent point of a list (`undefined`, the run-time spelling of
    // `Missing`, such as a restricted point whose condition is false) has no
    // distance: its cell is `NaN`, as in the interpreter.
    const leg = (p: unknown, q: unknown): number =>
      p == null || q == null ? NaN : colorHelpers.pointDistance(p, q);
    if (!aList && !bList) return colorHelpers.pointDistance(a, b);
    if (aList && bList) {
      if (a.length !== b.length)
        throw new Error('Could not compile `Distance`: dimension mismatch');
      return a.map((p, i) => leg(p, b[i]));
    }
    if (aList) return a.map((p) => leg(p, b));
    return b.map((p) => leg(a, p));
  },

  // The scalar leg of `distance`: the Euclidean distance between two points,
  // each a flat numeric array.
  pointDistance(a: unknown, b: unknown): number {
    if (!Array.isArray(a) || !Array.isArray(b))
      throw new Error(
        'Could not compile `Distance`: expected points (flat numeric arrays)'
      );
    if (a.length !== b.length || a.length === 0)
      throw new Error('Could not compile `Distance`: dimension mismatch');
    // An absent coordinate (`undefined`, the run-time spelling of `Missing`)
    // makes the distance `NaN`, even beside an infinite difference, as in the
    // interpreter (`Distance((1, Missing), (0, 0))` is `NaN`).
    if (a.some((x) => x == null) || b.some((x) => x == null)) return NaN;
    let sumSq = 0;
    // The largest magnitude of a difference.
    let m = 0;
    for (let i = 0; i < a.length; i++) {
      if (typeof a[i] !== 'number' || typeof b[i] !== 'number')
        throw new Error(
          'Could not compile `Distance`: expected points (flat numeric arrays)'
        );
      const d = a[i] - b[i];
      // An infinite coordinate difference makes the distance `+∞` whatever
      // the other differences are, a NaN one included. Every Euclidean norm
      // follows that rule, and `Math.hypot(Infinity, NaN)` answers `Infinity`
      // for the same reason. The test must be explicit because the sum below
      // cannot express it: `Infinity² + NaN²` is `NaN`, so without this line
      // `Distance((∞, NaN), (0, 0))` is `NaN` and disagrees with the
      // interpreter. Summing the squares by hand rather than calling
      // `Math.hypot` is deliberate — this helper runs once per point over a
      // point cloud, and the loop is cheaper. `_SYS.norm` repeats the same
      // test for the same reason.
      if (d === Infinity || d === -Infinity) return Infinity;
      sumSq += d * d;
      if (Math.abs(d) > m) m = Math.abs(d);
    }
    // When the largest difference `m` is so small or so large that its
    // square is below the normal doubles or overflows, the sum is computed
    // again with the differences scaled by a power of 2 (`scaledPNorm()`),
    // as `_SYS.norm` does: the distance from `(3e200, 4e200)` to the origin
    // was `+∞`. For the other points, the plain sum is the result,
    // unchanged.
    if (!pNormIsSafe(m, 2)) {
      const scaled = scaledPNorm(
        a.map((x, i) => (x as number) - (b[i] as number)),
        2
      );
      if (scaled !== undefined) return scaled;
    }
    return Math.sqrt(sumSq);
  },

  // `distance` over points whose coordinates may be `{re, im}` objects: the
  // same broadcast, with `pointDistanceAny` as the scalar leg. The compiler
  // emits it when the lane of the coordinates is not real
  // (`BaseCompiler.linearAlgebraLane`). Its value is a real number for real
  // and complex coordinates alike, so it has no complex counterpart.
  distanceAny(a: unknown, b: unknown): number | number[] {
    if (!Array.isArray(a) || !Array.isArray(b))
      throw new Error('Could not compile `Distance`: expected two arrays');
    const aList = a.length === 0 || isPointArrayList(a);
    const bList = b.length === 0 || isPointArrayList(b);
    // An absent point of a list is `NaN`, as in `distance`.
    const leg = (p: unknown, q: unknown): number =>
      p == null || q == null ? NaN : colorHelpers.pointDistanceAny(p, q);
    if (!aList && !bList) return colorHelpers.pointDistanceAny(a, b);
    if (aList && bList) {
      if (a.length !== b.length)
        throw new Error('Could not compile `Distance`: dimension mismatch');
      return a.map((p, i) => leg(p, b[i]));
    }
    if (aList) return a.map((p) => leg(p, b));
    return b.map((p) => leg(a, p));
  },

  // The scalar leg of `distanceAny`. The distance is the norm of the
  // difference, `√(Σ|aᵢ − bᵢ|²)`, so a complex coordinate difference
  // contributes its squared modulus. A real difference contributes `d²`
  // exactly as in `pointDistance`, and the infinite-difference rule is the
  // same.
  pointDistanceAny(a: unknown, b: unknown): number {
    if (!Array.isArray(a) || !Array.isArray(b))
      throw new Error(
        'Could not compile `Distance`: expected points (flat numeric arrays)'
      );
    if (a.length !== b.length || a.length === 0)
      throw new Error('Could not compile `Distance`: dimension mismatch');
    // An absent coordinate (`undefined`, the run-time spelling of `Missing`)
    // makes the distance `NaN`, even beside an infinite difference, as in the
    // interpreter (`Distance((1, Missing), (0, 0))` is `NaN`).
    if (a.some((x) => x == null) || b.some((x) => x == null)) return NaN;
    let sumSq = 0;
    // The largest magnitude of a part of a difference.
    let m = 0;
    for (let i = 0; i < a.length; i++) {
      if (
        (typeof a[i] !== 'number' && !isComplexObject(a[i])) ||
        (typeof b[i] !== 'number' && !isComplexObject(b[i]))
      )
        throw new Error(
          'Could not compile `Distance`: expected points (flat numeric arrays)'
        );
      const p = complexEntry(a[i]);
      const q = complexEntry(b[i]);
      const dr = p.re - q.re;
      const di = p.im - q.im;
      if (
        dr === Infinity ||
        dr === -Infinity ||
        di === Infinity ||
        di === -Infinity
      )
        return Infinity;
      sumSq += dr * dr + di * di;
      m = Math.max(m, Math.abs(dr), Math.abs(di));
    }
    // Scaled when a square would overflow or be below the normal doubles,
    // as in `pointDistance`. The real and imaginary parts of each
    // difference enter as separate values: the sum of their squares is the
    // same.
    if (!pNormIsSafe(m, 2)) {
      const parts: number[] = [];
      for (let i = 0; i < a.length; i++) {
        const p = complexEntry(a[i]);
        const q = complexEntry(b[i]);
        parts.push(p.re - q.re, p.im - q.im);
      }
      const scaled = scaledPNorm(parts, 2);
      if (scaled !== undefined) return scaled;
    }
    return Math.sqrt(sumSq);
  },
};

/** A compiled numeric value: a scalar, a complex `{re,im}`, or a (possibly
 * nested) array of these. */
type BcastValue = number | { re: number; im: number } | BcastValue[];

/**
 * The numeric value an `At` index entry contributes, mirroring the
 * interpreter's use of the boxed index's `.re`: a plain number passes through,
 * a compiled complex `{ re, im }` yields its real part (the imaginary part is
 * dropped, exactly as interpretation does), and anything else — a boolean, a
 * string, `undefined` — yields NaN so the caller declines.
 */
function indexValue(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 're' in v) {
    const re = (v as { re: unknown }).re;
    if (typeof re === 'number') return re;
  }
  return NaN;
}

/**
 * A new array with the elements of `x`: a copy of an array, or the characters
 * (grapheme clusters) of a string, as `_SYS.chars` segments it.
 */
function listCopy(x: unknown): unknown[] {
  return typeof x === 'string'
    ? SYS_HELPERS.chars(x)
    : (x as unknown[]).slice();
}

/**
 * `x`, checked as an operand of a compiled operation that reads every digit
 * of its operand: the floored remainder (`Mod`), the remainder (`Remainder`)
 * and the common divisor and multiple (`GCD`, `LCM`).
 *
 * Compiled arithmetic is machine arithmetic, and a double beyond
 * `±(2^53 − 1)` is the rounding of the value that produced it: `2^60 + 1`
 * is held as `2^60`, and a sum that overflows the double range is
 * `Infinity`. The interpreter computes these operations on the exact
 * integer, so a remainder or a divisor of the rounded double is a different
 * number, not a less precise one: compiled `Mod(2^60 + 1, 10)` would answer
 * `6` where the interpreter answers `7`, and `Mod` of an overflowed sum
 * would answer `NaN`. Such an operand throws a `RangeError` that names the
 * operation and the value, as the compiled list operations do for an
 * invalid index (`listPosition`). `NaN` is returned unchanged, so it
 * propagates as it does through the other compiled arithmetic.
 */
function integerOperand(operator: string, x: number): number {
  if (isBeyondSafeInteger(x))
    throw new RangeError(
      `${operator}: ${String(x)} is beyond the safe integer range of ` +
        `compiled code (±${Number.MAX_SAFE_INTEGER}); evaluate with the ` +
        `interpreter for the exact result`
    );
  return x;
}

/**
 * The 0-based position that the 1-based index `i` names in a list of `n`
 * positions, for the compiled `ReplaceAt`, `DeleteAt` and `Insert`. A
 * positive index counts from the start (1..n) and a negative index from the
 * end (-n..-1). Any other index throws a `RangeError` that names the
 * operator: a zero or out-of-range index, for which the interpreter leaves
 * the expression unevaluated, and a non-integer index, which the interpreter
 * rejects as an `incompatible-type` error.
 */
function listPosition(operator: string, n: number, i: unknown): number {
  // A complex index with a non-zero imaginary part is not an integer, so it
  // is rejected like 1.5. `indexValue` alone would read it by its real part,
  // which is what `At` does but not what these operators do.
  const im =
    typeof i === 'object' && i !== null && 'im' in i
      ? (i as { im: unknown }).im
      : 0;
  const iv = im === 0 ? indexValue(i) : NaN;
  if (Number.isInteger(iv) && iv !== 0 && iv <= n && iv >= -n)
    return iv > 0 ? iv - 1 : n + iv;
  throw new RangeError(
    `${operator}: the index ${String(iv)} is not a position of the list ` +
      `(1..${n} or -${n}..-1) at run time`
  );
}

/**
 * Adapt a statistics reducer so a SINGLE DATUM is accepted, not just a
 * collection of them.
 *
 * `Mean(x)` is a legal expression whatever `x` is, and the interpreter answers
 * it by treating one datum exactly as a one-element list — measured head by
 * head at `x = 4`, the scalar and the `[4]` columns agree everywhere:
 * `Mean`/`Median`/`Mode` are `4`, `Variance`/`StandardDeviation`/`Kurtosis`/
 * `Skewness`/`InterquartileRange` are `NaN` (the sample forms divide by
 * `n − 1 = 0`), the population forms are `0`, and `Quartiles` is
 * `(NaN, 4, NaN)`. The reducers in `numerics/statistics.ts` reproduce every one
 * of those from `[x]`, so wrapping is all that is needed — no per-head special
 * case, and no divergence to keep in sync.
 *
 * Without this the compiled code threw at RUN TIME behind `success: true`:
 * `Mean(x)` emitted `_SYS.mean(4)` and the reducer's `for…of` raised
 * "values is not iterable", where the interpreter answers `4`. Wrapping happens
 * here rather than in `numerics/statistics.ts` because those reducers are
 * shared with the interpreter, which reaches them through its own
 * collection-shaped call path and must keep its stricter contract.
 *
 * The static type is no help at the emission site — a bare symbol can be bound
 * to a number OR an array at call time — so the test is on the runtime value.
 *
 * It also applies the family's ABSENCE rule before the reducer runs
 * (2026-09-22): if ANY datum is absent, the answer is `absentResult()` and
 * the reducer is never called.
 *
 * That is the interpreter's rule, not an approximation of it. `collectData`
 * (`library/statistics.ts`) walks the operands, and a datum for which
 * `isAbsentValue` holds — the symbols `Missing` and `Undefined`, or a `NaN`
 * number — makes the whole head answer `NaN`, or the triple `(NaN, NaN, NaN)`
 * for `Quartiles`. The reducers in `numerics/statistics.ts` are shared with
 * the interpreter and never see an absent cell, so the compiled lane has to
 * apply the rule at this boundary.
 *
 * Normalizing an absent cell to `NaN` and reducing anyway is NOT enough, and
 * was the previous attempt: the reducers that SORT select a middle element,
 * so a `NaN` outside that position leaves an ordinary number — with a written
 * `Missing` at either end, `Median([Missing, 2, 3])` and `Median([1, 2,
 * Missing])` both answered `2`. The reducers that COUNT (`mode`) and the
 * quantile ones ignore it likewise.
 *
 * Three kinds of absent datum reach here. A written absence symbol lowers to
 * the JavaScript object null `undefined` (`docs/ERROR-MODEL.md` §3); a HOLE in
 * a sparse array the caller supplied reads `undefined` too, which is why the
 * scan is an index loop and not `Array.prototype.some` (`some` skips holes);
 * and a `NaN` cell is an absence marker for this family, by `isAbsentValue`.
 * A whole operand that is absent (`Mean(Missing)` emits
 * `_SYS.mean(undefined)`) is absent data as well, and used to throw "values is
 * not iterable" behind `success: true`.
 *
 * A lazy iterable is materialized so the scan can see it. The sorting
 * reducers already materialize; the streaming ones (the variance family) pay
 * one buffer for the parity.
 */
function oneDatumOk<T>(
  reduce: (values: Iterable<number>) => T,
  absentResult: () => T = () => Number.NaN as unknown as T
): (values: Iterable<number> | number | undefined | null) => T {
  return (values) => {
    if (values === undefined || values === null) return absentResult();
    if (typeof values === 'number')
      return Number.isNaN(values) ? absentResult() : reduce([values]);
    const data: ArrayLike<number> & Iterable<number> =
      Array.isArray(values) || ArrayBuffer.isView(values)
        ? (values as unknown as ArrayLike<number> & Iterable<number>)
        : Array.from(values);
    for (let i = 0; i < data.length; i++) {
      const v = data[i] as number | undefined | null;
      if (v === undefined || v === null || Number.isNaN(v))
        return absentResult();
    }
    return reduce(data);
  };
}

/**
 * Element-wise broadcast of a scalar function `f` over its arguments (the
 * runtime side of the compile target's list broadcasting — see
 * `tryCompileBroadcast` and `bcast`/`bcastFn` below). Any array argument makes
 * the result an array; a length MISMATCH among the array arguments projects to
 * NaN (the real-target rendering of the interpreter's
 * `incompatible-dimensions` — no truncation to the shortest), a scalar
 * argument is reused for every element, and nested arrays recurse. When no
 * argument is an array, `f` is applied directly. `f` therefore only ever sees
 * scalar (or complex) operands.
 */
function bcast(
  f: (...xs: BcastValue[]) => BcastValue,
  ...args: unknown[]
): BcastValue {
  return bcastWith(f, args);
}

/**
 * `bcast` for operands that may hold an ABSENT OBJECT: a restricted point or
 * list (`When((0, 1), c)` is `undefined` when `c` fails), or a list whose
 * elements may be absent points.
 *
 * The absent object is spelled `undefined` on the JavaScript target
 * (`docs/ERROR-MODEL.md` §3), and so is the result of arithmetic on it: the
 * interpreter answers `Missing` for `t·P`, `P + Q` or `−P` when the point `P`
 * is absent, so the whole point is absent, not a point of `NaN` coordinates
 * (user decision of 2026-09-27). The plain `bcast` cannot give this answer:
 * it applies its closure to an `undefined` operand as to a scalar, which
 * gives `NaN`.
 *
 * `depths[j]` is the set of array levels at which operand `j` can hold an
 * absent object, as a bit set: bit 0 when the operand itself can be absent,
 * bit 1 when its elements can be absent (a list of possibly absent points),
 * both for a restricted list of possibly absent points (`[P{c}, Q]{d}`),
 * and `0` when it cannot hold one (a number, a point, a list of numbers). An
 * operand that is `undefined` at a level where it can hold an absent object
 * makes that position of the result `undefined`: the whole result at level
 * 0, one cell of a list at level 1. Below the deepest such level, and for
 * the operands that cannot hold an absent object, the rules of `bcast` apply
 * unchanged, so a missing NUMBER still gives `NaN` (a numeric slot).
 *
 * The descent through the levels where an absent object can appear follows
 * `bcastWith`: array operands must share one length (a mismatch is `NaN`),
 * an empty position is the empty list, and a scalar operand is reused at
 * every position. A rotation view is never passed here.
 */
function bcastAbsent(
  depths: ReadonlyArray<number>,
  f: (...xs: BcastValue[]) => BcastValue,
  ...args: unknown[]
): BcastValue | undefined {
  let deeper = false;
  for (let j = 0; j < args.length; j++) {
    const d = depths[j] ?? 0;
    if ((d & 1) !== 0 && args[j] === undefined) return undefined;
    if (d > 1) deeper = true;
  }
  if (!deeper) return bcastWith(f, args);
  let n = -1;
  for (const a of args) {
    if (!Array.isArray(a)) continue;
    if (n < 0) n = a.length;
    else if (a.length !== n) return NaN;
  }
  if (n < 0) return bcastWith(f, args);
  if (n === 0) return [];
  const inner = depths.map((d) => d >> 1);
  const out: Array<BcastValue | undefined> = new Array(n);
  for (let i = 0; i < n; i++)
    out[i] = bcastAbsent(
      inner,
      f,
      ...args.map((a) => (Array.isArray(a) ? a[i] : a))
    );
  return out as BcastValue;
}

/**
 * `bcast` for a USER-FUNCTION application (`q(L)` — see
 * `tryCompileUserFunction`). An operator position and a function application
 * follow the same element-wise rule, including at an empty position, where
 * both answer the empty list. The two names are kept apart because the
 * emitter picks between them by what it is lowering, and a future divergence
 * would otherwise have to re-introduce the split at every call site.
 */
function bcastFn(
  f: (...xs: BcastValue[]) => BcastValue,
  ...args: unknown[]
): BcastValue {
  return bcastWith(f, args);
}

/**
 * `bcast` for a head that consumes a COLOR VALUE whole — the color-space
 * conversions `AsRgb`, `AsHsv`, `AsHsl`, `AsOklab` and `AsOklch`. Applies `f`
 * to one color, and maps over a list of colors.
 *
 * The generic `_SYS.bcast` cannot serve here, because it descends into any
 * array and would then apply `f` to each element of a nested list twice over.
 * The test this helper makes is the one the color representation allows: a
 * color VALUE is an OBJECT carrying its space (or a CSS color STRING), and an
 * ARRAY is always a LIST, at any depth. So an array maps element by element
 * and the map recurses — a nested list of colors stays nested, as the
 * interpreter's broadcast does.
 *
 * An empty array maps to the empty list, as the interpreter does for a
 * broadcast over an empty operand (`AsRgb([])` evaluates to `[]`) and as
 * `_SYS.bcast` does at an empty position.
 *
 * An upstream broadcast spells a MISMATCHED position `NaN`, so a ragged
 * operand reaches this helper with a number and a color side by side:
 * `AsRgb(Hsv(u, v, 0.5))` with `u = [[1, 2], [20]]` and `v = [[1], [20]]`
 * hands over `[NaN, [color]]`. A `NaN` element goes through `f` like any
 * other element, and the converters answer the non-finite color for it
 * (`asCompiledColor`) — the same projection the interpreter's
 * `incompatible-dimensions` error takes on this target.
 *
 * A list of plain NUMBERS at a color position is a list of errors in the
 * interpreter, and each element reaches `f` here and throws the color-shape
 * `TypeError`. The static gates refuse such an operand first
 * (`NESTED_COLOR_BROADCAST_TYPE`, `refuseColorList`); the throw is the
 * run-time backstop for a value that arrives through `vars`.
 */
function bcastColor(f: (c: unknown) => unknown, v: unknown): unknown {
  if (!Array.isArray(v)) return f(v);
  return v.map((e) => bcastColor(f, e));
}

/**
 * A rotated READ of a flat array, handed to `bcast` in place of a rotated
 * COPY. `_SYS.rotv(base, shift, ±1)` is emitted only as a DIRECT operand of a
 * `_SYS.bcast` call (see `BaseCompiler.tryCompileBroadcast`), so a view never
 * escapes into a value position: the broadcast reads `base[(i + shift) mod n]`
 * inside its element loop instead of allocating and copying the whole
 * rotation first. A stencil that sums eight rotations of a 40 000-element
 * board allocated eight full copies per evaluation before this (Tycho item
 * 262).
 *
 * `shift` is already normalized to `0 ≤ shift < base.length` by `rotv`, with
 * the `RotateLeft`/`RotateRight` rounding, default and modulo rules applied
 * (`normalizeRotation`), so a view denotes exactly the array `rotl`/`rotr`
 * would have produced.
 */
class RotView {
  constructor(
    readonly base: BcastValue[],
    readonly shift: number
  ) {}
}

/**
 * The shift a `RotateLeft` (`dir = 1`) or `RotateRight` (`dir = -1`) of a
 * length-`n` collection applies, as a non-negative offset below `n`: rounded,
 * a non-finite shift falls back to the default 1 (the interpreter's
 * `toInteger` treats it as missing), then reduced modulo `n`. `n` must be
 * positive.
 */
function normalizeRotation(shift: number, dir: 1 | -1, n: number): number {
  let k = Math.round(shift);
  if (!Number.isFinite(k)) k = 1;
  return (((dir * k) % n) + n) % n;
}

/** `RotateLeft` over an already-evaluated array: an empty array stays empty.
 * The two halves are joined with `concat`, never spread into a literal:
 * spreading a large `slice` walks it element by element through the iterator
 * protocol, and on a 40 000-element list that cost more than the broadcast
 * the rotation fed (Tycho item 262). */
function rotl<T>(l: T[], shift: number): T[] {
  if (l.length === 0) return [];
  const k = normalizeRotation(shift, 1, l.length);
  return l.slice(k).concat(l.slice(0, k));
}

/** `RotateRight` over an already-evaluated array; see `rotl`. */
function rotr<T>(l: T[], shift: number): T[] {
  if (l.length === 0) return [];
  const k = normalizeRotation(shift, -1, l.length);
  return l.slice(k).concat(l.slice(0, k));
}

/**
 * A rotation operand of a broadcast: a `RotView` over an array base, or —
 * for a base that is not an array — whatever the materializing rotation
 * answers, so the two spellings never disagree. An EMPTY base materializes
 * too (to `[]`): a view needs a positive length to normalize its shift, and
 * `bcast` answers the empty position from the array's length anyway.
 */
function rotv(base: unknown, shift: number, dir: 1 | -1): unknown {
  if (!Array.isArray(base) || base.length === 0)
    return dir === 1
      ? rotl(base as unknown[], shift)
      : rotr(base as unknown[], shift);
  return new RotView(
    base as BcastValue[],
    normalizeRotation(shift, dir, base.length)
  );
}

/** The value of broadcast operand `a` at position `i` (`a` is an array or a
 * view; a scalar operand is never asked). */
function bcastCell(a: BcastValue[] | RotView, i: number): BcastValue {
  if (a instanceof RotView) {
    let p = i + a.shift;
    const n = a.base.length;
    if (p >= n) p -= n;
    return a.base[p];
  }
  return a[i];
}

/**
 * One element loop per operand SHAPE: a generated function that reads each
 * operand the way its kind requires — `a` an array cell, `v` a rotation view
 * cell, `s` the scalar itself — and applies the closure to the cells, with
 * the operand reads written out explicitly for that arity.
 *
 * A single generic loop over an operand buffer (`for (j < k) cell[j] = …`)
 * cost 3.5× the explicit form on an 8-operand broadcast of 40 000 elements,
 * and the closure call itself was not the cost (Tycho item 264, measured
 * 2026-09-06). Generating the loop per shape is how a runtime helper gets the
 * explicit form for every arity; the same `Function` constructor already
 * builds every compiled artifact, so this adds no capability the artifact
 * did not need. Shapes are cached by signature; a host that forbids dynamic
 * code (the constructor throws) is remembered, and every broadcast then takes
 * the generic loop.
 *
 * The loop returns `-1` when every position was scalar, or the first position
 * whose cell is itself an array: positions before it are complete, and the
 * caller resumes there with the recursive projection.
 */
type BcastKernel = (
  f: (...xs: BcastValue[]) => BcastValue,
  out: BcastValue[],
  n: number,
  ...operands: unknown[]
) => number;

const BCAST_KERNELS = new Map<string, BcastKernel>();

const BCAST_KERNEL_CACHE_LIMIT = 256;

let bcastKernelsDisabled = false;

function bcastKernel(signature: string): BcastKernel | undefined {
  if (bcastKernelsDisabled) return undefined;
  const cached = BCAST_KERNELS.get(signature);
  if (cached !== undefined) return cached;
  if (BCAST_KERNELS.size >= BCAST_KERNEL_CACHE_LIMIT) return undefined;
  const params: string[] = [];
  const reads: string[] = [];
  const nested: string[] = [];
  const cells: string[] = [];
  for (let j = 0; j < signature.length; j++) {
    const kind = signature[j];
    params.push(`_o${j}`);
    if (kind === 's') {
      cells.push(`_o${j}`);
      continue;
    }
    if (kind === 'v') {
      // `_o${j}` is the view's base array, `_k${j}` its shift: both are
      // passed separately so the loop reads a plain array element.
      params.push(`_k${j}`);
      reads.push(
        `let _p${j} = _i + _k${j}; if (_p${j} >= _n) _p${j} -= _n; ` +
          `const _x${j} = _o${j}[_p${j}];`
      );
    } else reads.push(`const _x${j} = _o${j}[_i];`);
    nested.push(`Array.isArray(_x${j})`);
    cells.push(`_x${j}`);
  }
  const body =
    `for (let _i = 0; _i < _n; _i++) { ${reads.join(' ')} ` +
    (nested.length > 0 ? `if (${nested.join(' || ')}) return _i; ` : '') +
    `_out[_i] = _f(${cells.join(', ')}); } return -1;`;
  let kernel: BcastKernel;
  try {
    kernel = new Function('_f', '_out', '_n', ...params, body) as BcastKernel;
  } catch {
    bcastKernelsDisabled = true;
    return undefined;
  }
  BCAST_KERNELS.set(signature, kernel);
  return kernel;
}

/**
 * Shared implementation of `bcast`/`bcastFn`.
 *
 * An operand is a scalar, an array, or a rotation view (`RotView`, read in
 * place — see `rotv`). The array and view operands must share one length;
 * a mismatch projects the interpreter's `incompatible-dimensions` result to
 * NaN. Do not truncate or recycle operands.
 */
function bcastWith(
  f: (...xs: BcastValue[]) => BcastValue,
  args: unknown[]
): BcastValue {
  const k = args.length;
  let n = -1;
  let signature = '';
  for (let j = 0; j < k; j++) {
    const a = args[j];
    let len: number;
    if (Array.isArray(a)) {
      signature += 'a';
      len = a.length;
    } else if (a instanceof RotView) {
      signature += 'v';
      len = a.base.length;
    } else {
      signature += 's';
      continue;
    }
    if (n < 0) n = len;
    else if (len !== n) return NaN;
  }
  if (n < 0) return f(...(args as BcastValue[]));
  // An EMPTY position broadcasts to the EMPTY LIST, as in the interpreter:
  // `Not([])` is `[]`, and a nested operand keeps that per position
  // (`Not([[], [True]])` → `[[], [False]]`). Each empty position gets a
  // fresh array, never a shared instance, so a caller that mutates one
  // result cannot reach another. (Rule of 2026-09-21,
  // `docs/BROADCAST-MODEL.md`; an empty operand BESIDE a non-empty one is a
  // length mismatch, answered NaN by the loop above.)
  if (n === 0) return [];
  const out: BcastValue[] = new Array(n);

  // Flat fast path: every position whose cells are all scalars is one direct
  // application, through the explicit-read loop generated for this operand
  // shape. It stops at the first position holding a nested array, and the
  // recursive projection below finishes from there — so matrices, ragged
  // operands and a lone nested cell all keep the per-position semantics.
  let from = 0;
  const kernel = bcastKernel(signature);
  if (kernel !== undefined) {
    const operands: unknown[] = [];
    for (let j = 0; j < k; j++) {
      const a = args[j];
      if (a instanceof RotView) operands.push(a.base, a.shift);
      else operands.push(a);
    }
    from = kernel(f, out, n, ...operands);
    if (from < 0) return out;
  }

  const cell: BcastValue[] = new Array(k);
  for (let i = from; i < n; i++) {
    let nested = false;
    for (let j = 0; j < k; j++) {
      const a = args[j];
      const x =
        signature[j] === 's'
          ? (a as BcastValue)
          : bcastCell(a as BcastValue[] | RotView, i);
      if (Array.isArray(x)) nested = true;
      cell[j] = x;
    }
    // The recursive call keeps its operand array (it reads it after this loop
    // has moved on), so it gets a copy; the direct call consumes the buffer
    // before the next position overwrites it.
    out[i] = nested ? bcastWith(f, cell.slice()) : f(...cell);
  }
  return out;
}

/**
 * A selection arm the compiler proved to be one POINT — an array at this
 * ABI, like a list arm, but a value to lift WHOLE to every position that
 * selects it (see `compileJSSelection`). `select` unwraps it.
 */
class WholeArm {
  constructor(readonly value: unknown) {}
}

/**
 * Element-wise conditional selection — the runtime side of a compiled
 * `Which`/`If` whose condition may be an indexed collection (`np.select`
 * semantics, R1–R4 of
 * `docs/BROADCAST-MODEL.md`; the interpreter side is
 * `evaluateElementwiseSelection` in `library/control-structures.ts`).
 *
 * The clauses arrive as THUNKS, in `Which` order (condition, arm, …), so this
 * helper owns evaluation: conditions run in clause order and at most once, and
 * an arm runs only if selection reaches it somewhere — then exactly once, as a
 * WHOLE value (R2), cached for every position that selected it.
 *
 * - a scalar `true` condition captures every not-yet-decided position and ends
 *   the walk (later conditions are never evaluated); a scalar `false` captures
 *   none; an array condition captures its `true` cells;
 * - if EVERY condition turns out scalar, this is an ordinary scalar `Which`:
 *   the selected arm's value is returned WHOLE (it may itself be an array —
 *   `Which(True, [1,2])` is `[1,2]`, not an indexed cell);
 * - element-wise, all array participants (conditions AND selected arms) must
 *   share one length; a mismatch is the interpreter's `incompatible-dimensions`
 *   projected to NaN, as everywhere in `bcastWith` (R3). A scalar arm lifts to
 *   its positions, an array arm is indexed at each;
 * - a position no clause matched is NaN (R4). So is a position whose condition
 *   cell is absent (NaN — how a real target renders `Missing`): the position is
 *   CONSUMED, never offered to a later clause, matching the interpreter's
 *   positioned "condition is absent" error cell (R4′);
 * - a scalar condition that is neither boolean nor an array fails closed with
 *   the same message as `_SYS.cond`, so a conditional that is scalar at run
 *   time behaves exactly like the ternary chain it replaced.
 */
function select(...clauses: Array<() => unknown>): unknown {
  // 1/ The conditions, in clause order.
  const selectors: Array<true | 'absent' | unknown[]> = [];
  const armThunks: Array<() => unknown> = [];
  for (let k = 0; k + 1 < clauses.length; k += 2) {
    const c = clauses[k]();
    if (c === false) continue;
    armThunks.push(clauses[k + 1]);
    if (c === true) {
      selectors.push(true);
      break;
    }
    if (Array.isArray(c)) {
      selectors.push(c);
      continue;
    }
    if (c === undefined || c === null || c !== c) {
      // A lifted ABSENT condition (NaN — the real-target rendering of
      // `Missing`, which the interpreter answers with a whole-expression
      // "condition is absent" error) decides nothing anywhere, and no later
      // clause may decide what absence left undecided: stop, exactly as a
      // lifted `true` does.
      selectors.push('absent');
      break;
    }
    throw new Error('Condition must evaluate to "True" or "False".');
  }

  // 2/ The common length of the array participants.
  let n = -1;
  for (const s of selectors) {
    if (!Array.isArray(s)) continue;
    if (n < 0) n = s.length;
    else if (s.length !== n) return NaN;
  }
  if (n < 0) {
    const last = selectors[selectors.length - 1];
    if (last !== true) return NaN;
    const v = armThunks[armThunks.length - 1]();
    return v instanceof WholeArm ? v.value : v;
  }

  // 3/ Selection: the first clause that is `true` at each position (`-1`: no
  // match), and the positions whose condition cell is absent. A lifted
  // scalar selector decides every undecided position the same way, so it is
  // applied without reading a cell.
  const selection = new Int32Array(n).fill(-1);
  const absent = new Uint8Array(n);
  const reached = new Uint8Array(selectors.length);
  let undecided = n;
  for (let k = 0; k < selectors.length && undecided > 0; k++) {
    const cells = selectors[k];
    if (cells === true || cells === 'absent') {
      const lifted = cells === true;
      for (let j = 0; j < n; j++) {
        if (selection[j] >= 0 || absent[j] === 1) continue;
        if (lifted) selection[j] = k;
        else absent[j] = 1;
      }
      if (lifted) reached[k] = 1;
      undecided = 0;
      break;
    }
    for (let j = 0; j < n; j++) {
      if (selection[j] >= 0 || absent[j] === 1) continue;
      const v = cells[j];
      if (v === true) {
        selection[j] = k;
        reached[k] = 1;
        undecided -= 1;
      } else if (v === false) {
        continue;
      } else if (v === undefined || v === null || v !== v) {
        // An ABSENT cell (NaN — how a real target renders `Missing`, and how a
        // `Missing` symbol lowers through the vars object). Undecidable, and
        // the position is CONSUMED so no later clause decides it (R4′).
        absent[j] = 1;
        undecided -= 1;
      } else {
        // Any other cell is not a condition value at all: the interpreter
        // throws rather than picking a branch (`Which([10,20], …)`), and so
        // does the scalar guard `_SYS.cond`.
        throw new Error('Condition must evaluate to "True" or "False".');
      }
    }
  }

  // 4/ Each REACHED arm once, whole (R2), in clause order. Whether an arm is
  // indexed or lifted whole is a property of the arm, decided here once: a
  // list arm is indexed, and is a length participant (R3); a scalar, and a
  // point the compiler wrapped (`WholeArm`), is lifted.
  const values: unknown[] = new Array(selectors.length);
  const indexed: boolean[] = new Array(selectors.length).fill(false);
  for (let k = 0; k < selectors.length; k++) {
    if (reached[k] === 0) continue;
    const v = armThunks[k]();
    if (v instanceof WholeArm) {
      values[k] = v.value;
      continue;
    }
    if (Array.isArray(v)) {
      if (v.length !== n) return NaN;
      indexed[k] = true;
    }
    values[k] = v;
  }

  // 5/ Assemble, position by position.
  const out: unknown[] = new Array(n);
  for (let j = 0; j < n; j++) {
    const k = selection[j];
    if (absent[j] === 1 || k < 0) {
      out[j] = NaN;
      continue;
    }
    out[j] = indexed[k] ? (values[k] as unknown[])[j] : values[k];
  }
  return out;
}

// --- Complex entries of the linear-algebra helpers ------------------------
//
// Compiled code holds a complex entry of a vector or a matrix as a `{re, im}`
// object (`[x, i]` lowers to `[x, { re: 0, im: 1 }]`).
//
// Each linear-algebra helper therefore has two forms. The plain form (`det`,
// `matmul`, `inv`, `trace`, `cross`, `matpow`, `pointdot`) does real
// arithmetic only. The complex form (`complexDet`, `complexMatmul`, …) lifts
// every entry to `{re, im}` and computes with complex arithmetic, and EVERY
// entry of its result is a `{re, im}` object, even an entry whose imaginary
// part is zero. The compiler chooses the form from the lane of the operands
// (`BaseCompiler.linearAlgebraLane`), and a parent expression reads the
// result with the same answer (`BaseCompiler.isComplexValued`). So the
// choice is made when the code is compiled, and no helper tests its operands
// for a complex entry when the code runs.
//
// The two forms are separate functions on purpose. A plain helper that
// scanned its own operands became more than twice as slow on a 100×100 real
// matrix (`det`: 320 → 740 µs) once any helper in the process had met a
// complex entry. A plain helper that never meets a `{re, im}` object keeps
// its speed.

/** The `{re, im}` form of one entry: a number is lifted, a `{re, im}` object
 * passes through, and anything else (a nested array where a scalar was
 * expected, a string) is NaN. */
function complexEntry(v: unknown): ComplexResult {
  if (typeof v === 'number') return { re: v, im: 0 };
  if (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as ComplexResult).re === 'number' &&
    typeof (v as ComplexResult).im === 'number'
  )
    return v as ComplexResult;
  return { re: NaN, im: NaN };
}

const cxAdd = (a: ComplexResult, b: ComplexResult): ComplexResult => ({
  re: a.re + b.re,
  im: a.im + b.im,
});

const cxSub = (a: ComplexResult, b: ComplexResult): ComplexResult => ({
  re: a.re - b.re,
  im: a.im - b.im,
});

const cxMul = (a: ComplexResult, b: ComplexResult): ComplexResult => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

/** `a / b`, with Smith's formula (`scaledComplexDivide`). The linear-algebra
 * callers divide only by a pivot, which is not zero; a zero divisor takes the
 * componentwise branch of `scaledComplexDivide` and gives infinite parts for
 * a non-zero dividend (NaN parts for a zero dividend). */
function cxDiv(a: ComplexResult, b: ComplexResult): ComplexResult {
  return scaledComplexDivide(a.re, a.im, b.re, b.im);
}

/** `|z|`, used to choose a pivot and to test it for zero. */
const cxAbs = (z: ComplexResult): number => Math.hypot(z.re, z.im);

/** A matrix (or a vector) with every entry in `{re, im}` form. */
const complexEntries = (m: any): any =>
  Array.isArray(m)
    ? m.map((v: unknown) =>
        Array.isArray(v) ? complexEntries(v) : complexEntry(v)
      )
    : complexEntry(m);

/**
 * `matmul` over operands that hold a complex entry: the same dimensionality
 * dispatch, with complex arithmetic. The inner product does not conjugate
 * either operand, as in the interpreter (`Dot([1+i, 2], [1-i, i])` is
 * `2 + 2i`).
 */
function complexMatmul(a: any, b: any): any {
  const aM = Array.isArray(a?.[0]);
  const bM = Array.isArray(b?.[0]);
  const A = complexEntries(a);
  const B = complexEntries(b);
  const zero = (): ComplexResult => ({ re: 0, im: 0 });
  if (!aM && !bM) {
    // A scalar result is `{re, im}` even on a length mismatch, so that the
    // parent, which reads it as complex, reads NaN parts.
    if (A.length !== B.length) return { re: NaN, im: NaN };
    let s = zero();
    for (let i = 0; i < A.length; i++) s = cxAdd(s, cxMul(A[i], B[i]));
    return s;
  }
  if (aM && !bM)
    return A.map((row: ComplexResult[]) => {
      if (row.length !== B.length) return { re: NaN, im: NaN };
      let s = zero();
      for (let i = 0; i < row.length; i++) s = cxAdd(s, cxMul(row[i], B[i]));
      return s;
    });
  if (!aM && bM) {
    if (A.length !== B.length) return NaN;
    const n = B[0].length;
    const out: ComplexResult[] = Array.from({ length: n }, zero);
    for (let i = 0; i < A.length; i++)
      for (let j = 0; j < n; j++) out[j] = cxAdd(out[j], cxMul(A[i], B[i][j]));
    return out;
  }
  const m = A.length;
  const k = A[0].length;
  if (B.length !== k) return NaN;
  const n = B[0].length;
  const out: ComplexResult[][] = [];
  for (let i = 0; i < m; i++) {
    const row: ComplexResult[] = Array.from({ length: n }, zero);
    for (let p = 0; p < k; p++) {
      const v = A[i][p];
      for (let j = 0; j < n; j++) row[j] = cxAdd(row[j], cxMul(v, B[p][j]));
    }
    out.push(row);
  }
  return out;
}

/**
 * Shape-agnostic SCALAR add and multiply: two numbers combine as numbers, and
 * a complex value `{re, im}` in either position combines as complex (a number
 * operand is read as `{re: x, im: 0}`). The entries of a compiled array can be
 * complex values, and the raw `+`/`*` reads such an object as a string or as
 * `NaN`: the sum of the points `[(1+i, 2), (3+i, 4)]` was
 * `["0[object Object][object Object]", 6]`.
 */
function scalarAdd(a: unknown, b: unknown): number | ComplexResult {
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  const p = typeof a === 'number' ? { re: a, im: 0 } : (a as ComplexResult);
  const q = typeof b === 'number' ? { re: b, im: 0 } : (b as ComplexResult);
  return { re: p.re + q.re, im: p.im + q.im };
}

function scalarMul(a: unknown, b: unknown): number | ComplexResult {
  if (typeof a === 'number' && typeof b === 'number') return a * b;
  const p = typeof a === 'number' ? { re: a, im: 0 } : (a as ComplexResult);
  const q = typeof b === 'number' ? { re: b, im: 0 } : (b as ComplexResult);
  return {
    re: p.re * q.re - p.im * q.im,
    im: p.re * q.im + p.im * q.re,
  };
}

/**
 * Product dispatch on dimensionality, mirroring the interpreter's
 * `Dot`/`MatrixMultiply`: vector·vector → scalar, matrix·vector → vector,
 * vector·matrix → vector, matrix·matrix → matrix. Real, nested-array
 * representation; a dimension mismatch yields NaN (the interpreter's
 * error/inert result projected onto a real target).
 */
function matmul(a: any, b: any): any {
  const aM = Array.isArray(a?.[0]);
  const bM = Array.isArray(b?.[0]);
  if (!aM && !bM) {
    if (a.length !== b.length) return NaN;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }
  if (aM && !bM)
    return a.map((row: number[]) =>
      row.length === b.length
        ? row.reduce((s: number, v: number, i: number) => s + v * b[i], 0)
        : NaN
    );
  if (!aM && bM) {
    if (a.length !== b.length) return NaN;
    const n = b[0].length;
    const out = new Array(n).fill(0);
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < n; j++) out[j] += a[i] * b[i][j];
    return out;
  }
  const m = a.length;
  const k = a[0].length;
  if (b.length !== k) return NaN;
  const n = b[0].length;
  const out: number[][] = [];
  for (let i = 0; i < m; i++) {
    const row = new Array(n).fill(0);
    for (let p = 0; p < k; p++) {
      const v = a[i][p];
      for (let j = 0; j < n; j++) row[j] += v * b[p][j];
    }
    out.push(row);
  }
  return out;
}

/**
 * The broadcasting inner product of `Dot`, for operands of which at least one
 * is a LIST OF POINTS: one number per point, mirroring the interpreter's
 * point-list broadcast.
 *
 * Which operand is the list is decided by the COMPILER, from the static
 * type, and arrives as `aList`/`bList`. It cannot be read from the run-time
 * value: a list of points and a single point are both arrays, and an EMPTY
 * list of points has no first element to tell them apart, so sniffing the
 * nesting read `[]` as one point and answered NaN where the interpreter
 * answers `[]`.
 *
 * A point operand is lifted over the list; the flipped order answers the same
 * list, since the inner product is symmetric on a real target. Two lists of
 * points are paired element by element, so two empty lists answer the empty
 * list too.
 *
 * A mismatch in the number of points, or in the width of a pair of points,
 * yields NaN — the convention the whole linear-algebra runtime uses for the
 * interpreter's `incompatible-dimensions`. So does an operand the type called
 * a list that is not an array at run time.
 */
function pointdot(a: any, b: any, aList: boolean, bList: boolean): any {
  const inner = (p: number[], q: number[]): number => {
    if (!Array.isArray(p) || !Array.isArray(q) || p.length !== q.length)
      return NaN;
    let s = 0;
    for (let i = 0; i < p.length; i++) s += p[i] * q[i];
    return s;
  };
  if (aList && !Array.isArray(a)) return NaN;
  if (bList && !Array.isArray(b)) return NaN;
  if (aList && bList)
    return a.length === b.length
      ? a.map((p: number[], i: number) => inner(p, b[i]))
      : NaN;
  if (aList) return a.map((p: number[]) => inner(p, b));
  if (bList) return b.map((q: number[]) => inner(a, q));
  return inner(a, b);
}

/**
 * The complex form of `pointdot`: every inner product is computed with
 * complex arithmetic, without conjugation (as in the interpreter), and is a
 * `{re, im}` object. See the note above `complexEntry`.
 */
function complexPointdot(a: any, b: any, aList: boolean, bList: boolean): any {
  const inner = (p: unknown[], q: unknown[]): ComplexResult => {
    if (!Array.isArray(p) || !Array.isArray(q) || p.length !== q.length)
      return { re: NaN, im: NaN };
    let s: ComplexResult = { re: 0, im: 0 };
    for (let i = 0; i < p.length; i++)
      s = cxAdd(s, cxMul(complexEntry(p[i]), complexEntry(q[i])));
    return s;
  };
  if (aList && !Array.isArray(a)) return NaN;
  if (bList && !Array.isArray(b)) return NaN;
  if (aList && bList)
    return a.length === b.length
      ? a.map((p: unknown[], i: number) => inner(p, b[i]))
      : NaN;
  if (aList) return a.map((p: unknown[]) => inner(p, b));
  if (bList) return b.map((q: unknown[]) => inner(a, q));
  return inner(a, b);
}

/**
 * Interpreter-faithful `Multiply` over a mix of scalars and (possibly nested)
 * real arrays — the runtime side of the compile target's tensor-Multiply
 * lowering for operands whose collection-ness is not statically provable (a
 * `broadcastable<T>` node or a top-typed application such as `h(x)`); see
 * `tryCompileBroadcast`'s ≥2-possibly-collection branch.
 *
 * Mirrors `mulTensors` (`arithmetic-mul-div.ts`): scalar factors combine into a
 * single factor that scales the tensor result; two rank-1 vectors take the
 * element-wise (Hadamard) product — inert (NaN) on a length mismatch — while any
 * rank-≥2 operand contracts via the matrix product (`matmul`), so no runtime
 * shape (vector·vector, matrix·vector, matrix·matrix) silently diverges from the
 * interpreter. This form is real-only (the raw `*` and `matmul`), as the
 * other plain linear-algebra helpers are. `complexMulTensor` is the complex
 * form (every entry `{re, im}`, `complexMatmul`), and `mulTensorAny` tests
 * each entry and multiplies a complex one as complex (`scalarMul`). The
 * compiler chooses the form from the lane of the operands (`foldLane`);
 * no form scans its operands to choose.
 */
function mulTensor(...args: BcastValue[]): BcastValue {
  return mulTensorWith(matmul, (a, b) => (a as number) * (b as number), args);
}

/** The complex form of `mulTensor`: the matrix product is `complexMatmul`,
 * and every entry of the result is `{re, im}`, as in the result of the other
 * complex linear-algebra helpers. Chosen by the compiler when the operands
 * are complex (`elementwiseFoldCombiner`). */
function complexMulTensor(...args: BcastValue[]): BcastValue {
  return mulTensorWith(
    complexMatmul,
    (a, b) => cxMul(complexEntry(a), complexEntry(b)),
    args
  );
}

/** `mulTensor` for operands whose lane is not known when the code is
 * compiled: the scalar factors and the element-wise product use
 * `scalarMul` (one type test per entry), and the matrix product is the
 * real `matmul`, as for a `list<number>` operand of `Dot`. So a product of
 * complex MATRICES whose type is known only at run time (`Product(h(t))`
 * with `h` typed `-> unknown`) has `NaN` entries. This is the convention
 * the user kept on 2026-10-01: a lane not proved complex is real. Using
 * `complexMatmul` here would make every entry `{re, im}` and slow down a
 * real `list<number>` product. */
function mulTensorAny(...args: BcastValue[]): BcastValue {
  return mulTensorWith(matmul, scalarMul, args);
}

function mulTensorWith(
  product2: (a: any, b: any) => any,
  times: (a: unknown, b: unknown) => number | ComplexResult,
  args: BcastValue[]
): BcastValue {
  const tensors: BcastValue[][] = [];
  let scalar: BcastValue | undefined = undefined;
  for (const x of args) {
    if (Array.isArray(x)) tensors.push(x);
    else scalar = scalar === undefined ? x : (times(scalar, x) as BcastValue);
  }
  if (tensors.length === 0) return scalar === undefined ? 1 : scalar;
  let product: BcastValue[] = tensors[0];
  for (let i = 1; i < tensors.length; i++) {
    const next = tensors[i];
    const pRank1 = !Array.isArray(product[0]);
    const nRank1 = !Array.isArray(next[0]);
    if (pRank1 && nRank1) {
      // Two rank-1 vectors: Hadamard (element-wise), inert on a length
      // mismatch — matching the interpreter (Issue #29), NOT the dot product.
      if (product.length !== next.length) return NaN;
      const out: BcastValue[] = new Array(product.length);
      for (let k = 0; k < product.length; k++)
        out[k] = times(product[k], next[k]) as BcastValue;
      product = out;
    } else {
      // A rank-≥2 operand contracts via the matrix product. The matrix
      // product returns a bare number only on a dimension mismatch (NaN)
      // here — stay inert.
      const r = product2(product, next);
      if (typeof r === 'number') return r;
      product = r as BcastValue[];
    }
  }
  // A single tensor operand is returned as it is unless a scalar factor
  // scales it; a scalar factor of exactly 1 changes nothing and is skipped.
  if (scalar !== undefined && scalar !== 1)
    product = bcast(
      (v) => times(v, scalar) as BcastValue,
      product
    ) as BcastValue[];
  else if (tensors.length === 1 && product2 === complexMatmul)
    // The complex form lifts every entry, also when no product was taken.
    product = bcast(
      (v) => complexEntry(v) as BcastValue,
      product
    ) as BcastValue[];
  return product;
}

/**
 * Interpreter-faithful `Equal` over operands whose collection-ness is not
 * statically provable (a `broadcastable<T>` node or a top-typed application
 * such as `q(x)`) — the runtime side of `compileJSEquality`'s
 * possibly-collection lowering (Tycho item 41). Mirrors the interpreter's
 * dispatch, probe-verified shape by shape:
 * - scalar = scalar → an EXACT boolean (`a === b`, the IEEE 754 comparison
 *   that `compileJSEquality` emits for scalars; a complex operand compares
 *   component-wise)
 * - array = scalar (either order) → element-wise array of booleans
 *   (`[1,4,4] = 4` → `[false, true, true]`), recursing into nested arrays
 * - array = array → a single boolean: equal lengths and every element pair
 *   equal (recursive, so matrices compare element-wise; a length mismatch or
 *   an element-shape mismatch is `false`) — collection equality, not a
 *   broadcast
 *
 * The scalar leaf has a STRING branch (tier 2, 2026-08-08): when either side is
 * a string the comparison is content equality with no tolerance, the
 * interpreter's own string semantics (`compare.ts`). Without it the leaf fell
 * through to the numeric leaf, which is `false` on strings, so two EQUAL
 * string lists answered `false`. It is the mirror of the Python target's `_ce_eqcoll` string
 * leaf, and it is faithful for a MIXED leaf pair too (`Equal("a", 1)` is
 * `False` in the interpreter, and `eqText("a", 1)` is `false`) — though only the
 * all-string shapes are ADMITTED at compile time
 * (`isStringCollectionEquality`). It compares CONDITIONED content (`eqText`),
 * not raw UTF-16, because the interpreter's strings are NFC and well-formed by
 * the time it compares them.
 */
function eqTensor(
  a: unknown,
  b: unknown
): boolean | number | (boolean | number | unknown[])[] {
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr && bArr) {
    // A length mismatch is DECIDED: no value an absent cell could hold makes
    // 2 elements equal 3.
    if (a.length !== b.length) return false;
    // One element pair with no answer makes the WHOLE comparison undecided
    // (user ruling of 2026-09-21, the compiled half of the rule the
    // interpreter applies in `undecidedElementPair`,
    // `library/relational-operator.ts`). An absent cell can stand for any
    // value, so the cells that ARE there cannot settle whether the two
    // collections hold the same values. The rule holds even when another
    // pair is decidedly unequal, which is why the walk does NOT stop at the
    // first mismatch: `[1, undefined, 3]` against `[2, undefined, 3]`
    // answers the marker, not `false`. The marker is `NaN`, the compiled
    // spelling of the interpreter's `Missing` (see the absence note on the
    // scalar leaf below).
    let undecided = false;
    let unequal = false;
    for (let i = 0; i < a.length; i++) {
      // The absence test comes BEFORE the recursion. An absent cell opposite
      // a NESTED array would otherwise reach the array-vs-scalar branch,
      // whose per-element array reads here as a decided mismatch.
      if (a[i] === undefined || b[i] === undefined) {
        undecided = true;
        continue;
      }
      const cmp = eqTensor(a[i], b[i]);
      if (typeof cmp === 'number') undecided = true;
      else if (cmp !== true) unequal = true;
    }
    if (undecided) return Number.NaN;
    return !unequal;
  }
  // Array-vs-scalar with a NUMBER on the scalar side: one exact test per
  // element, with the `{re, im}` projection and the string branch reserved
  // for the elements that need them. The generic per-element recursion
  // allocated two projection objects per cell and re-probed the scalar's kind
  // at every position; over a 40 000-element list that was the larger half of
  // a compiled `Equal(list, 3)` (Tycho item 264).
  if (aArr !== bArr) {
    const arr = (aArr ? a : b) as unknown[];
    const scalar = aArr ? b : a;
    const out: (boolean | number | unknown[])[] = new Array(arr.length);
    if (typeof scalar === 'number') {
      for (let i = 0; i < arr.length; i++) {
        const x = arr[i];
        out[i] = typeof x === 'number' ? x === scalar : eqTensor(x, scalar);
      }
      return out;
    }
    for (let i = 0; i < arr.length; i++)
      out[i] = aArr ? eqTensor(arr[i], b) : eqTensor(a, arr[i]);
    return out;
  }
  // An ABSENT operand reads `undefined`, and a comparison with it is
  // UNDECIDED: the interpreter answers `Equal([1, 2, 3], Missing)` with
  // `[Missing, Missing, Missing]` and `Equal([1, Missing], 1)` with
  // `[True, Missing]`, so the cell carries an absence marker, not a decided
  // `false`. The marker is `NaN`, which is how a real target renders `Missing`
  // in a cell: the selection runtime reads such a cell as undecided and
  // consumes the position (see `select`), and the element-wise connective
  // guard tests absence as `x !== x` (`guardConnectiveAbsence`), so a marked
  // cell combines correctly with `And`/`Or` — a decided `false` still wins.
  // An `undefined` cell would satisfy neither test.
  //
  // A `NaN` OPERAND is not absent: it is a number that equals nothing, and it
  // keeps answering `false` below. Only a genuinely missing read is marked.
  if (a === undefined || b === undefined) return Number.NaN;
  if (typeof a === 'string' || typeof b === 'string') return eqText(a, b);
  const part = (v: unknown): { re: number; im: number } =>
    typeof v === 'object' && v !== null && 're' in v
      ? (v as { re: number; im: number })
      : { re: v as number, im: 0 };
  const pa = part(a);
  const pb = part(b);
  // Bit-exact equality, as `compileJSEquality`'s scalar form emits it: two
  // infinities of the same sign are equal, `NaN` equals nothing. The test
  // requires a real number on the left so that a leaf which is neither a
  // number nor a complex part — a boolean, `null` — stays `false` rather than
  // comparing by JavaScript identity.
  return typeof pa.re === 'number' && pa.re === pb.re && pa.im === pb.im;
}

/**
 * Interpreter-faithful `NotEqual` (see `eqTensor`): element-wise negation for
 * an array-vs-scalar pair, a single negated boolean for array-vs-array and
 * scalar-vs-scalar.
 */
function neqTensor(
  a: unknown,
  b: unknown
): boolean | number | (boolean | number | unknown[])[] {
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr && bArr) {
    // A whole-collection comparison with no answer keeps its marker under
    // negation (user ruling of 2026-09-21): `NotEqual` must not report a
    // confident `true` where `Equal` could not report `false`.
    const equal = eqTensor(a, b);
    return typeof equal === 'number' ? equal : equal !== true;
  }
  if (aArr)
    return a.map((x) => neqTensor(x, b)) as (boolean | number | unknown[])[];
  if (bArr)
    return b.map((y) => neqTensor(a, y)) as (boolean | number | unknown[])[];
  // An UNDECIDED comparison stays undecided under negation: the interpreter
  // answers `NotEqual([1, 2, 3], Missing)` with `[Missing, Missing, Missing]`,
  // never `[True, True, True]`. Only a decided answer is negated, so the
  // marker is relayed rather than negated into a confident `true`.
  const equal = eqTensor(a, b);
  return typeof equal === 'number' ? equal : equal !== true;
}

/**
 * Inverse by Gauss–Jordan with partial pivoting; a non-square or singular input
 * yields NaN (the interpreter stays inert for a singular matrix). Standalone so
 * `matpow` can reuse it for a negative exponent.
 */
function matinv(m: number[][]): number[][] | number {
  const n = m?.length;
  if (!n || m.some((row) => !Array.isArray(row) || row.length !== n))
    return NaN;
  const a = m.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++)
      if (Math.abs(a[r][i]) > Math.abs(a[piv][i])) piv = r;
    if (a[piv][i] === 0) return NaN;
    if (piv !== i) [a[i], a[piv]] = [a[piv], a[i]];
    const f = a[i][i];
    for (let c = 0; c < 2 * n; c++) a[i][c] /= f;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const g = a[r][i];
      if (g === 0) continue;
      for (let c = 0; c < 2 * n; c++) a[r][c] -= g * a[i][c];
    }
  }
  return a.map((row) => row.slice(n));
}

/**
 * `matinv` over a square matrix with a complex entry: the same Gauss–Jordan
 * elimination with complex arithmetic, the pivot chosen by modulus. A
 * singular matrix yields NaN.
 */
function complexMatinv(m: unknown[][]): ComplexResult[][] | number {
  const n = m.length;
  const a: ComplexResult[][] = m.map((row, i) => [
    ...row.map(complexEntry),
    ...Array.from({ length: n }, (_, j) => ({ re: i === j ? 1 : 0, im: 0 })),
  ]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++)
      if (cxAbs(a[r][i]) > cxAbs(a[piv][i])) piv = r;
    if (cxAbs(a[piv][i]) === 0) return NaN;
    if (piv !== i) [a[i], a[piv]] = [a[piv], a[i]];
    const f = a[i][i];
    for (let c = 0; c < 2 * n; c++) a[i][c] = cxDiv(a[i][c], f);
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const g = a[r][i];
      if (g.re === 0 && g.im === 0) continue;
      for (let c = 0; c < 2 * n; c++)
        a[r][c] = cxSub(a[r][c], cxMul(g, a[i][c]));
    }
  }
  return a.map((row) => row.slice(n));
}

/**
 * Determinant by Gaussian elimination with partial pivoting over a square
 * matrix with a complex entry; the pivot is chosen by modulus.
 */
function complexDet(m: unknown[][]): ComplexResult {
  const n = m.length;
  const a: ComplexResult[][] = m.map((row) => row.map(complexEntry));
  let d: ComplexResult = { re: 1, im: 0 };
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++)
      if (cxAbs(a[r][i]) > cxAbs(a[piv][i])) piv = r;
    if (cxAbs(a[piv][i]) === 0) return { re: 0, im: 0 };
    if (piv !== i) {
      [a[i], a[piv]] = [a[piv], a[i]];
      d = { re: -d.re, im: -d.im };
    }
    d = cxMul(d, a[i][i]);
    for (let r = i + 1; r < n; r++) {
      const f = cxDiv(a[r][i], a[i][i]);
      for (let c = i; c < n; c++) a[r][c] = cxSub(a[r][c], cxMul(f, a[i][c]));
    }
  }
  return d;
}

/** Whether `m` is a non-empty square matrix. */
function isSquareMatrix(m: unknown): m is unknown[][] {
  const n = Array.isArray(m) ? m.length : 0;
  return (
    n > 0 &&
    (m as unknown[]).every((row) => Array.isArray(row) && row.length === n)
  );
}

// The complex forms of the linear-algebra helpers that have no standalone
// function above. Each one returns `{re, im}` entries only. See the note above
// `complexEntry`.

function complexDetOrNaN(m: unknown): ComplexResult {
  return isSquareMatrix(m) ? complexDet(m) : { re: NaN, im: NaN };
}

function complexInvOrNaN(m: unknown): ComplexResult[][] | number {
  return isSquareMatrix(m) ? complexMatinv(m) : NaN;
}

/** A matrix with a complex entry ANYWHERE has a `{re, im}` trace, even when
 * its diagonal is real. */
function complexTrace(m: unknown): ComplexResult {
  if (!Array.isArray(m) || !Array.isArray(m[0])) return { re: NaN, im: NaN };
  let re = 0;
  let im = 0;
  for (let i = 0; i < Math.min(m.length, m[0].length); i++) {
    // An array on the diagonal (a tensor of rank > 2) has no trace, as in
    // `trace`.
    const v: unknown = m[i][i];
    if (Array.isArray(v)) return { re: NaN, im: NaN };
    const z = complexEntry(v);
    re += z.re;
    im += z.im;
  }
  return { re, im };
}

/** No conjugation of either operand, as in the interpreter. */
function complexCross(a: unknown, b: unknown): ComplexResult[] | number {
  if (!Array.isArray(a) || !Array.isArray(b)) return NaN;
  if (a.length !== 3 || b.length !== 3) return NaN;
  const [a0, a1, a2] = a.map(complexEntry);
  const [b0, b1, b2] = b.map(complexEntry);
  return [
    cxSub(cxMul(a1, b2), cxMul(a2, b1)),
    cxSub(cxMul(a2, b0), cxMul(a0, b2)),
    cxSub(cxMul(a0, b1), cxMul(a1, b0)),
  ];
}

/** The complex form mirrors `matpow` step by step; the identity of `M^0` has
 * `{re, im}` entries too. */
function complexMatpow(m: unknown, p: number): ComplexResult[][] | number {
  if (!isSquareMatrix(m)) return NaN;
  const n = m.length;
  if (!Number.isInteger(p)) return NaN;
  if (Math.abs(p) > MAX_MATRIX_POWER_EXPONENT) return NaN;
  let base: ComplexResult[][];
  let e = p;
  if (e < 0) {
    const inv = complexMatinv(m);
    if (!Array.isArray(inv)) return NaN;
    base = inv;
    e = -e;
  } else base = complexEntries(m);
  let result: ComplexResult[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => ({ re: i === j ? 1 : 0, im: 0 }))
  );
  for (; e > 0; e = Math.floor(e / 2)) {
    if (e % 2 === 1) result = complexMatmul(result, base);
    if (e > 1) base = complexMatmul(base, base);
  }
  return result;
}

/**
 * Conjugate transpose: transpose the matrix and complex-conjugate every element
 * (a real element is unchanged; a `{re,im}` element flips the sign of `im`). A
 * vector conjugates in place (transpose of a rank-1 vector is itself), matching
 * the interpreter and `_SYS.transpose`.
 */
function conjTranspose(m: any): any {
  const conj = (v: any): any =>
    v && typeof v === 'object' && 'im' in v ? { re: v.re, im: -v.im } : v;
  if (!Array.isArray(m)) return m;
  if (!Array.isArray(m[0])) return m.map(conj);
  return m[0].map((_: unknown, j: number) =>
    m.map((row: any[]) => conj(row[j]))
  );
}

/**
 * `Diagonal` dispatches on rank, matching the interpreter: a MATRIX yields its
 * main-diagonal vector (length `min(rows, cols)`); a VECTOR yields the square
 * matrix with that vector on the diagonal and zeros elsewhere.
 */
function diagonal(m: any): any {
  if (!Array.isArray(m)) return NaN;
  if (Array.isArray(m[0])) {
    const n = Math.min(m.length, m[0].length);
    const out: any[] = [];
    for (let i = 0; i < n; i++) out.push(m[i][i]);
    return out;
  }
  const n = m.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? m[i] : 0))
  );
}

/**
 * Integer matrix power, mirroring the interpreter: `M^0` is the identity,
 * `M^n` is computed by exponentiation by squaring (O(log n) products, as
 * the interpreter does), and a negative power inverts first (`M^-n =
 * (M^-1)^n`). A non-square matrix, a singular matrix under a negative power,
 * or a non-integer exponent yields NaN (the interpreter errors / stays
 * inert), and so does an exponent past `MAX_MATRIX_POWER_EXPONENT`, where
 * the interpreter stays symbolic.
 */
function matpow(m: number[][], p: number): number[][] | number {
  if (!Array.isArray(m) || !Array.isArray(m[0])) return NaN;
  const n = m.length;
  if (m.some((r) => !Array.isArray(r) || r.length !== n)) return NaN;
  if (!Number.isInteger(p)) return NaN;
  if (Math.abs(p) > MAX_MATRIX_POWER_EXPONENT) return NaN;
  let base: number[][] = m.map((r) => r.slice());
  let e = p;
  if (e < 0) {
    const inv = matinv(m);
    if (!Array.isArray(inv)) return NaN;
    base = inv as number[][];
    e = -e;
  }
  let result: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );
  for (; e > 0; e = Math.floor(e / 2)) {
    if (e % 2 === 1) result = matmul(result, base) as number[][];
    if (e > 1) base = matmul(base, base) as number[][];
  }
  return result;
}

/**
 * Reduced row echelon form (Gauss–Jordan with partial pivoting), matching the
 * interpreter's `RowReduce`. A non-matrix operand yields NaN. Float arithmetic:
 * pivots are compared with an exact zero test (the same convention as `det`/
 * `inv`), so near-singular inputs with floating-point noise may pivot
 * differently than the exact interpreter.
 */
function rref(m: number[][]): number[][] | number {
  if (!Array.isArray(m) || !Array.isArray(m[0])) return NaN;
  const rows = m.length;
  const cols = m[0].length;
  const a = m.map((r) => r.slice());
  let r = 0;
  for (let c = 0; c < cols && r < rows; c++) {
    let piv = r;
    for (let i = r + 1; i < rows; i++)
      if (Math.abs(a[i][c]) > Math.abs(a[piv][c])) piv = i;
    if (a[piv][c] === 0) continue;
    if (piv !== r) [a[piv], a[r]] = [a[r], a[piv]];
    const lv = a[r][c];
    for (let j = 0; j < cols; j++) a[r][j] /= lv;
    for (let k = 0; k < rows; k++) {
      if (k === r) continue;
      const f = a[k][c];
      if (f === 0) continue;
      for (let j = 0; j < cols; j++) a[k][j] -= f * a[r][j];
    }
    r++;
  }
  return a;
}

/** Lazily built, then reused by every `_SYS.chars` call — see there. */
let graphemeSegmenter: Intl.Segmenter | undefined = undefined;

/**
 * Put a value through the SAME ingress conditioning the interpreter applies
 * when it boxes a string or a character — Unicode NFC normalization, then the
 * lone-surrogate → U+FFFD replacement (`boxed-string.ts`, `boxed-character.ts`)
 * — and return the resulting text.
 *
 * Every text comparison in a compiled artifact goes through it, because the
 * interpreter's own text comparisons (`a.string === b.string`) run on already-
 * conditioned content: without it the decomposed `"e" + U+0301` and the
 * precomposed `"é"` are different code-unit sequences here and compare unequal,
 * where the interpreter answers equal. Literals and everything `_SYS.chars`
 * produces are already conditioned, so this only changes a raw host string
 * bound to a compiled parameter.
 */
/** The code-unit width of the code POINT starting at `i` — 2 for a surrogate
 * pair, 1 otherwise.
 *
 * Used to step past a zero-width regex match. The obvious spelling,
 * `[...s.slice(i)][0].length`, copies the entire remaining suffix and expands
 * all of its code points just to look at the first one, which makes a pattern
 * that matches everywhere (`(?:)`) quadratic in the subject length. */
function codePointWidthAt(s: string, i: number): number {
  const cp = s.codePointAt(i);
  return cp !== undefined && cp > 0xffff ? 2 : 1;
}

function conditionText(x: unknown): string {
  const s = String(x).normalize();
  // `toWellFormed` is Node ≥ 20 / ES2024; older hosts keep the raw string,
  // which only matters for the lone surrogates they cannot replace anyway.
  return (
    (s as unknown as { toWellFormed?: () => string }).toWellFormed?.() ?? s
  );
}

/**
 * The interpreter's element/scalar equality for text: two strings are equal
 * when their CONDITIONED content is identical (see {@link conditionText}), and
 * anything else falls back to SameValueZero, the test of `includes`: strict
 * identity, except that `NaN` is the same as `NaN`.
 *
 * The fallback keeps every non-text shape as it was: a number, a boolean and
 * an array compare exactly as `===` does, and a string paired with a
 * non-string is `false` either way (`Equal("1", 1)` is `False` in the
 * interpreter). The one addition is the `NaN` pair, which is the interpreter's
 * own structural verdict (`isSame`): `IndexOf([1, NaN], NaN)` is `2` there,
 * so the compiled element test of `IndexOf` and the sequence-search family
 * must find it too (user decision 2026-09-26, `SEARCHED_VALUE_POLICY` in
 * `library/collections.ts`).
 */
function eqText(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string')
    return a === b || (a !== a && b !== b);
  return conditionText(a) === conditionText(b);
}

/**
 * `Unique` over a collection whose elements may be TEXT.
 *
 * Each string element is put through the interpreter's ingress conditioning
 * (see {@link conditionText}) before it becomes a `Set` key, so a decomposed
 * `"e" + U+0301` and a precomposed `"é"` supplied at run time collapse to the
 * single element the interpreter answers, instead of surviving as two distinct
 * code-unit sequences. The CONDITIONED form is what comes out, matching the
 * content the interpreter's boxed strings hold. Non-string elements are keyed
 * and returned unchanged, so a mixed collection keeps `Set`'s SameValueZero
 * verdict (NaN included) on every non-text element.
 */
function uniqueText(l: unknown[]): unknown[] {
  return [
    ...new Set(l.map((x) => (typeof x === 'string' ? conditionText(x) : x))),
  ];
}

/**
 * True when two ELEMENTS of a sequence-search operand are the same value, by
 * the interpreter's own element test.
 *
 * The interpreter compares elements with `.isSame()` — the exact structural
 * check, with no numeric tolerance (`matchesSequenceAt` in
 * `library/collections.ts`). {@link eqText} reproduces it for every sort a
 * compiled artifact can hold: strict `===` for a number, a boolean or an array
 * reference, and conditioned (NFC, well-formed) content equality for a text
 * pair — which is what a string subject segmented by `_SYS.chars` yields, and
 * what bridges a `list<character>` needle against a string subject (a
 * character and a one-cluster string with the same content are the same value
 * to `.isSame()`). NaN needs the extra disjunct because `NaN === NaN` is false
 * while `.isSame()` answers true; `IndexOf`'s emitted element test already
 * carries the identical disjunct.
 */
function sameSequenceElement(a: unknown, b: unknown): boolean {
  return (a !== a && b !== b) || eqText(a, b);
}

/**
 * True when `p` occurs in `xs` starting at the 0-based offset `off` — the
 * anchored test behind `StartsWith` and `EndsWith`, mirroring
 * `matchesSequenceAt` (`library/collections.ts`). The caller has already
 * checked that the window fits. An EMPTY `p` matches at any offset, which is
 * what makes the boolean members of the family answer `True` on an empty
 * needle.
 */
function matchesSequenceAtJS(
  xs: unknown[],
  p: unknown[],
  off: number
): boolean {
  for (let k = 0; k < p.length; k++)
    if (!sameSequenceElement(xs[off + k], p[k])) return false;
  return true;
}

/**
 * The 0-based index of the first occurrence of `p` in `xs` at or after `from`,
 * or `-1` when there is none.
 *
 * The naive O(n·m) scan is the interpreter's own (`RangeOf` /
 * `ContainsSequence` in `library/collections.ts`; accepted for v1 by decision
 * D3 of `docs/STRING_ROADMAP.md`). An empty `p`
 * is found at `from`, which is `ContainsSequence`'s empty-needle `True`.
 * `RangeOf` — whose empty needle is an ERROR value, not a span — never reaches
 * here with one: its lowering admits only a provably non-empty needle.
 */
function findSequenceJS(xs: unknown[], p: unknown[], from: number): number {
  for (let i = Math.max(0, from); i + p.length <= xs.length; i++)
    if (matchesSequenceAtJS(xs, p, i)) return i;
  return -1;
}

/**
 * The Unicode White_Space property as a single-character test — the set
 * `Trim`/`TrimStart`/`TrimEnd` strip when no `chars` operand is given.
 *
 * The code points are spelled out (U+0009..U+000D, U+0020, U+0085, U+00A0,
 * U+1680, U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000) rather than
 * written `\s`, so a compiled artifact's notion of whitespace does not depend
 * on the host regex engine. This duplicates `UNICODE_WHITESPACE` in
 * `library/core.ts` — the operator library is deliberately not imported by the
 * compilation layer, and the two must be kept in step (the parity tests in
 * `test/compute-engine/compile-string-operations.test.ts` compare compiled and
 * interpreted trims on the non-ASCII members of the set).
 */
const JS_UNICODE_WHITESPACE_CHARACTER =
  /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/;

/**
 * `StringReplace(s, target, replacement, count)` over GRAPHEME CLUSTERS, the
 * interpreter's algorithm verbatim (`library/core.ts`): the scan walks the
 * ORIGINAL subject's cluster sequence and skips past each match's span, so a
 * replacement's own content is never re-matched (`StringReplace("aa", "a",
 * "aa")` is `"aaaa"`, not an infinite expansion), matches are non-overlapping
 * and taken left to right, and re-segmentation happens ONCE when the pieces are
 * joined.
 *
 * `limit` is `Infinity` for the count-less form. An EMPTY `target` would make
 * the scan advance by zero and never terminate; the interpreter answers an
 * error value for it, and the lowering keeps it away from here — an empty
 * literal declines to compile and a computed target is wrapped in a
 * `_SYS.doms` guard that throws before this runs.
 */
function replaceText(
  s: unknown,
  target: unknown,
  replacement: unknown,
  limit: number
): string {
  const subject = SYS_HELPERS.chars(s);
  const needle = SYS_HELPERS.chars(target);
  const rep = conditionText(replacement);
  const out: string[] = [];
  let i = 0;
  let done = 0;
  while (i < subject.length) {
    if (
      done < limit &&
      i + needle.length <= subject.length &&
      needle.every((c, k) => subject[i + k] === c)
    ) {
      out.push(rep);
      i += needle.length;
      done += 1;
    } else {
      out.push(subject[i]);
      i += 1;
    }
  }
  return out.join('').normalize();
}

/**
 * `Trim`/`TrimStart`/`TrimEnd` — `s` with the leading (`start`) and/or trailing
 * (`end`) characters that belong to `chars` removed, walking GRAPHEME CLUSTERS
 * so a cluster is never cut in half (`trimClusters`, `library/core.ts`).
 *
 * `chars === undefined` selects the default Unicode White_Space set. Otherwise
 * `chars` is a SET of characters, never a literal substring: a string operand
 * contributes each of ITS characters, and a collection operand contributes each
 * of its elements' characters — so `Trim("xyhiyx", "xy")` strips any mix of the
 * two.
 */
function trimText(
  s: unknown,
  chars: unknown,
  start: boolean,
  end: boolean
): string {
  const cs = SYS_HELPERS.chars(s);
  let strip: (c: string) => boolean;
  if (chars === undefined)
    strip = (c) => JS_UNICODE_WHITESPACE_CHARACTER.test(c);
  else {
    const set = new Set<string>();
    const add = (t: unknown): void => {
      for (const g of SYS_HELPERS.chars(t)) set.add(g);
    };
    if (Array.isArray(chars)) for (const c of chars) add(c);
    else add(chars);
    strip = (c) => set.has(c);
  }
  let i = 0;
  let j = cs.length;
  if (start) while (i < j && strip(cs[i])) i += 1;
  if (end) while (j > i && strip(cs[j - 1])) j -= 1;
  return cs.slice(i, j).join('').normalize();
}

/**
 * `PadStart`/`PadEnd` — `s` padded to `n` CHARACTERS by repeating `pad`, with
 * the padding placed at the start (`atStart`) or the end (`padClusters`,
 * `library/core.ts`).
 *
 * The padding is built from `pad`'s own grapheme clusters, cycled, so the final
 * copy is truncated ON A CHARACTER BOUNDARY (`PadStart("a", 4, "xy")` is
 * `"xyxa"`). A string that already has `n` or more characters comes back
 * unchanged. An empty `pad` and a negative `n` — both error values in the
 * interpreter — never reach here: an out-of-domain literal declines to
 * compile, and a computed operand is wrapped in a `_SYS.domi`/`_SYS.doms`
 * guard that throws first.
 */
function padText(
  s: unknown,
  n: number,
  pad: unknown,
  atStart: boolean
): string {
  const text = conditionText(s);
  const cs = SYS_HELPERS.chars(text);
  if (cs.length >= n) return text;
  const ps = SYS_HELPERS.chars(pad);
  const fill: string[] = [];
  for (let i = 0; i < n - cs.length; i += 1) fill.push(ps[i % ps.length]);
  return (atStart ? fill.join('') + text : text + fill.join('')).normalize();
}

/**
 * `CaseFold(s)` — the interpreter's v1 approximation of Unicode full case
 * folding, byte for byte (`library/core.ts`): `toUpperCase()` then
 * `toLowerCase()` (the round trip through upper case is what collapses the
 * pairs a single `toLowerCase()` leaves apart, `"ß"` → `"SS"` → `"ss"`), with
 * the Greek FINAL sigma U+03C2 mapped back to the medial U+03C3 so that
 * `CaseFold("ΟΔΟΣ") == CaseFold("οδοσ")` holds. Faithful by construction: the
 * same JS calls run on the same conditioned input, then NFC-normalized as
 * `engine.string()` does.
 */
function caseFoldText(s: unknown): string {
  return conditionText(s)
    .toUpperCase()
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .normalize();
}

/**
 * A compiled scalar callback as the REAL function the numeric kernels
 * (`_SYS.integrate`, `_SYS.nd`, `_SYS.limit`, the Monte-Carlo estimator)
 * consume: those kernels are real-only, and under the promoting disciplines
 * (`auto`, `complex`) a compiled body may hand back a `{re, im}` object —
 * `y^{3/2}` in an integrand promotes to `_SYS.cpow`, which yields `{re: …, im:
 * 0}` on the real axis. The value is projected exactly as the D2 rule
 * projects a real-only head's operand: a plain number passes; an object with
 * an EXACTLY zero imaginary part is its real part; anything else — a genuinely
 * complex value, where the kernel's real result is meaningless — is `NaN`. A
 * plain-number-returning callback costs one `typeof` per evaluation.
 */
function realFn(f: (x: number) => unknown): (x: number) => number {
  return (x: number): number => machineReal(f(x));
}

/**
 * A value as a machine real: a number as it is, a complex result object
 * with a zero imaginary part as its real part, anything else `NaN`.
 */
function machineReal(v: unknown): number {
  if (typeof v === 'number') return v;
  if (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as ComplexResult).re === 'number' &&
    (v as ComplexResult).im === 0
  )
    return (v as ComplexResult).re;
  return NaN;
}

/**
 * Runtime integrand-evaluation budget for DYNAMICALLY nested quadrature —
 * integrals entered from inside another integral's integrand at run time.
 *
 * An inner integral runs one full quadrature per evaluation of the enclosing
 * integrand, so every level of nesting MULTIPLIES the work: the adaptive GK15
 * emitter starts from 16 panels of 15 points, so a smooth integrand costs 240
 * evaluations at one level, 5.76·10⁴ at two (measured 6 ms), 1.39·10⁷ at three
 * (measured ~1 s), and ~3.3·10⁹ at four — minutes to hours of synchronous work
 * that never yields to the caller's thread. The quadrature's own deadline check
 * does not bound this: it stops subdividing only when a deadline is armed, and
 * a compiled artifact called outside an engine span (`ce.withTimeLimit`) has
 * none — and a synchronous call cannot be interrupted from outside either.
 *
 * Nesting written into one `Integrate` node's limits is visible to the
 * compiler, but nesting reached BY REFERENCE is not: `∫ g(x) dx` where the
 * compiled `g` computes an integral of its own shows no nested `Integrate` node
 * anywhere in the tree, and a macro-expanded iteration can stack six such
 * levels. No tree walk can see that composition, because it happens per RUNTIME
 * call.
 *
 * So the runtime enforces its own cap: each OUTERMOST `_SYS.integrate` entry
 * (one with no integral already running) re-arms this budget, and every
 * integrand evaluation performed by a NESTED integral consumes one unit. Once
 * it is gone, a nested integral answers `NaN` — the scalar target's "no value"
 * spelling — on entry or mid-accumulation, which propagates outward through the
 * enclosing quadratures instead of spinning, and the caller falls back to the
 * interpreter. The cap is PER OUTERMOST INTEGRAL, so integrals started after
 * the exhausted one completes get a full budget again.
 *
 * Sized so the nesting the compiler DOES emit stays untouched: a triple
 * integral's inner two levels consume ~1.4·10⁷ evaluations for a smooth
 * integrand, and hard-but-legitimate double integrals measured up to 4.7·10⁵
 * (`∫₀¹∫₀¹ √(xy)`, 20 ms), so 2²⁵ ≈ 3.4·10⁷ leaves a double integral two
 * orders of magnitude of headroom and a smooth triple a factor of two, while a
 * runaway dynamic composition is cut after a few seconds rather than never.
 */
export const NESTED_QUADRATURE_BUDGET = 1 << 25;

/** The nested budget in force: the constant above, unless a test made it
 *  smaller with `JavaScriptTarget.setNestedQuadratureBudgetForTesting`. The
 *  compiled code does not contain the budget: `enterIntegral` reads this
 *  variable each time an outermost integral starts. */
let nestedQuadratureBudget = NESTED_QUADRATURE_BUDGET;

/** Set the nested budget, or restore the default when called with no
 *  argument. For tests only. */
export function setNestedQuadratureBudget(evaluations?: number): void {
  nestedQuadratureBudget = evaluations ?? NESTED_QUADRATURE_BUDGET;
}

/** Number of `_SYS.integrate` activations currently on the call stack. Zero at
 *  every outermost entry — module state is safe here because compiled code runs
 *  synchronously on one thread. */
let activeIntegrals = 0;

/** Remaining nested-integrand-evaluation budget for the current outermost
 *  integral — see {@link NESTED_QUADRATURE_BUDGET}. Negative once exhausted,
 *  which is what tells an enclosing quadrature its estimate is incomplete. */
let nestedEvalsLeft = 0;

/**
 * `f` wrapped so that each evaluation made on behalf of a NESTED integral (one
 * running inside another integral's integrand) consumes budget, and answers
 * `NaN` once the budget is exhausted — which the quadrature carries into its
 * estimate, ending the nested integral with no value.
 */
function budgetedIntegrand(f: (x: number) => number): (x: number) => number {
  return (x: number): number => {
    if (activeIntegrals > 1 && --nestedEvalsLeft < 0) return NaN;
    return f(x);
  };
}

/**
 * Open one integral activation: re-arm the nested budget at an outermost entry,
 * or refuse a nested entry whose budget is already gone. Returns `false` when
 * the caller must answer `NaN` without integrating; `true` when it may proceed,
 * and must then run its work inside `try { … } finally { activeIntegrals--; }`.
 */
function enterIntegral(): boolean {
  if (activeIntegrals === 0) nestedEvalsLeft = nestedQuadratureBudget;
  else if (nestedEvalsLeft <= 0) {
    // A refusal answers `NaN` to an enclosing quadrature, so the counter must
    // also show exhaustion. If a nested integral used the budget to exactly
    // zero, the counter is not yet negative. Then the enclosing integral does
    // not see that it has refused values, and returns a wrong finite estimate.
    nestedEvalsLeft = -1;
    return false;
  }
  activeIntegrals++;
  return true;
}

/**
 * The elements of the arithmetic range `lower, lower + step, …`, as an array:
 * the run-time helper `_SYS.range` that a compiled `Range` calls.
 *
 * The element count is `rangeCount`, the interpreter's own count
 * (`numerics/range-count.ts`), and element `i` is `lower + i × step`, so the
 * values are those of the interpreter's `Range` (element 0 is `lower`, also
 * when the step is infinite). A NaN count (a bound that is
 * not a number at run time) gives an empty array. A count above the array
 * limit, 2³² − 1 (an infinite bound at run time gives an infinite count),
 * throws the `RangeError` that `Array.from` and `new Array` throw.
 *
 * The array is preallocated and filled in a counted loop. The earlier
 * emission, `Array.from({length: n}, (_e, i) => lower + i * step)`, gave the
 * same values but was about 18 times slower on V8: 720 ns for 17 elements,
 * where the loop takes about 20 ns (issue #387).
 */
function materializeRange(
  lower: number,
  upper: number,
  step: number
): number[] {
  const count = rangeCount(lower, upper, step);
  if (count > 4294967295) throw new RangeError('Invalid array length');
  // `count > 0` is false for NaN, so a NaN count gives an empty array.
  const n = count > 0 ? Math.floor(count) : 0;
  const result = new Array<number>(n);
  // Element 0 is `lower` itself, not `lower + 0 × step`: with an infinite
  // step, `0 × step` is NaN, and the interpreter's `Range` answers `lower`
  // for its first element (`rangeElement`, `library/collections.ts`).
  if (n > 0) result[0] = lower;
  for (let i = 1; i < n; i++) result[i] = lower + i * step;
  return result;
}

/** A short description of the run-time value `x`, for an error message. */
function describeRuntimeValue(x: unknown): string {
  if (typeof x === 'string') return 'a string';
  if (Array.isArray(x)) return 'a list';
  if (x instanceof Set) return 'a set';
  return `a value of type ${typeof x}`;
}

/**
 * Runtime helpers injected as `_SYS` into compiled JavaScript functions.
 * Shared by both ComputeEngineFunction and ComputeEngineFunctionLiteral.
 */
/**
 * The digits and the exponent of the shortest decimal of a finite double:
 * `x = m·10^e`, with `m` a `bigint`. This is the decimal that the
 * interpreter reads for a float: `0.1` is `1·10^-1`, not the binary value
 * of the double.
 */
function shortestDecimal(x: number): [bigint, number] {
  const [mantissa, exponent] = Math.abs(x).toString().split('e');
  const dot = mantissa.indexOf('.');
  const digits =
    dot < 0 ? mantissa : mantissa.slice(0, dot) + mantissa.slice(dot + 1);
  const fraction = dot < 0 ? 0 : mantissa.length - dot - 1;
  const m = BigInt(digits);
  return [x < 0 ? -m : m, Number(exponent ?? 0) - fraction];
}

/**
 * True when the quotient of the shortest decimals of `x` and `k` is exactly
 * `r`, a multiple of `1/2`: `x/k = r` is tested as `2·x = (2r)·k` in integer
 * arithmetic.
 */
function decimalQuotientIs(x: number, k: number, r: number): boolean {
  const [a, ea] = shortestDecimal(x);
  const [b, eb] = shortestDecimal(k);
  const e = Math.min(ea, eb);
  const lhs = 2n * a * 10n ** BigInt(ea - e);
  const rhs = BigInt(Math.round(2 * r)) * b * 10n ** BigInt(eb - e);
  return lhs === rhs;
}

/**
 * The quotient `x / k` of a step form (`Floor(x, step)`), taken to be AT a
 * jump when the interpreter finds it there: the jumps are the multiples of
 * `unit`, which is `1` for `Floor`, `Ceil` and `Truncate` and `0.5` for
 * `Round`.
 *
 * The interpreter reads a float as its shortest decimal and divides the
 * decimals: `0.3 / 0.1` is `3`, and `Floor(0.3, 0.1)` is `0.3`. The double
 * quotient is `2.9999999999999996`, whose floor is `2`. So a double quotient
 * within 4 ulps of a jump (the quotient of two doubles is wrong by about 1.5
 * ulps at most) is taken to be at the jump when the quotient of the
 * decimals is exactly at it (`decimalQuotientIs()`), and is kept otherwise:
 * `0.49999999999999994 / 1` is not a tie, and `Round` of it is `0`. The
 * tolerance is relative to the quotient only, so a non-zero quotient is
 * never taken to be `0` (`Ceil(1e-20, 1)` is `1`).
 *
 * A non-zero quotient that underflows to `0` (`1e-300 / 1e300`) is replaced
 * by the smallest double of its sign, so that `Ceil` gives `1` and `Floor`
 * of a negative value gives `-1`.
 */
function stepQuotient(x: number, k: number, unit = 1): number {
  const q = x / k;
  if (q === 0 && x !== 0 && k !== 0 && Number.isFinite(k))
    return Math.sign(x) * Number.MIN_VALUE;
  const r = Math.round(q / unit) * unit;
  if (q === r || Math.abs(q - r) > 4 * Number.EPSILON * Math.abs(q)) return q;
  return Number.isFinite(x) && Number.isFinite(k) && decimalQuotientIs(x, k, r)
    ? r
    : q;
}

/**
 * The multiple `round(q) · k` of a step form, with `k = |step|` and `q` the
 * quotient of `stepQuotient()`. When the quotient overflows (`1e200 /
 * 1e-200`), the multiple is an integer far beyond 2⁵³ times the step, and
 * `x` itself is the nearest double to it. A zero step gives `NaN`, as
 * `Floor(x, 0)` is in the interpreter.
 */
function stepMultiple(
  round: (q: number) => number,
  x: number,
  step: number,
  unit = 1
): number {
  const k = Math.abs(step);
  const q = stepQuotient(x, k, unit);
  if (
    !Number.isFinite(q) &&
    Number.isFinite(x) &&
    Number.isFinite(k) &&
    k !== 0
  )
    return x;
  return round(q) * k;
}

export const SYS_HELPERS = {
  ...JET_HELPERS,
  // The element count of an arithmetic `Range`, shared with the interpreter
  // (`numerics/range-count.ts`), so the compiled length agrees with the
  // interpreter's `count`.
  rangeCount,
  // The elements of an arithmetic `Range`, as an array.
  range: materializeRange,
  bcast,
  bcastAbsent,
  bcastFn,
  bcastColor,
  // Establish the representation used by the fused numeric selection loop.
  // Scan every cell: a declaration alone cannot exclude nested or absent cells.
  numericSelectionInputs: (...arrays: unknown[]): boolean => {
    const first = arrays[0];
    if (!Array.isArray(first) || first.length === 0) return false;
    for (const array of arrays) {
      if (!Array.isArray(array) || array.length !== first.length) return false;
      for (let i = 0; i < array.length; i++)
        if (typeof array[i] !== 'number') return false;
    }
    return true;
  },
  // `RotateLeft`/`RotateRight` over an evaluated array, and the in-place
  // rotated READ a broadcast consumes instead of a copy (see `RotView`).
  rotl,
  rotr,
  rotv,
  // Element/scalar equality that is faithful for text — see `eqText`. Emitted
  // by `IndexOf`'s element test, where the elements and the needle may be text
  // or anything else; the equality LOWERINGS reach the same verdict through
  // `cmpc`, which conditions its operands identically.
  eqt: eqText,
  // The interpreter's ingress conditioning for text — NFC normalization, then
  // the lone-surrogate replacement (see `conditionText`) — as a standalone
  // helper. Emitted by the all-string ORDERINGS, which compare the conditioned
  // operands with the raw infix `<`/`<=`/`>`/`>=` the interpreter itself uses
  // on strings; the equality lowerings reach the same conditioning inside
  // `eqt`/`cmpc` instead.
  ct: conditionText,
  // `Unique` over possibly-text elements — see `uniqueText`.
  uniqt: uniqueText,
  // Coerce a value to the `{ re, im }` complex representation, idempotently.
  //
  // A user function whose signature declares a `complex` PARAMETER compiles
  // its body in the complex lane, so the callee reads `.re`/`.im` off that
  // parameter and the call site owes it an object. When the argument is
  // provably real the wrap is emitted statically (`({ re: x, im: 0 })`, no
  // runtime cost); when its realness is not decidable at compile time — an
  // untyped free symbol supplied at `run()` time, the commonest shape — the
  // caller may hand over either a plain number or an already-complex object,
  // and only a runtime test can tell. Passing a number through unwrapped made
  // the callee compute `x.re` on a number; wrapping an object unconditionally
  // would nest it as `{ re: { re, im }, im: 0 }`. This does neither.
  cplx: (x: unknown): { re: number; im: number } =>
    typeof x === 'number'
      ? { re: x, im: 0 }
      : (x as { re: number; im: number }),
  // The quotient `(ar + ai·i) / (br + bi·i)` where the quotient formula of
  // the `Divide` codegen fails: the squared modulus of the divisor is zero,
  // subnormal or infinite, or a part of the numerator is not finite. For a
  // divisor that is exactly zero the interpreter answers the unsigned pole
  // `~oo` when the dividend is not zero, and `NaN` for `0 / 0`. For a divisor
  // with an infinite part it answers `0` when the dividend is finite, and
  // `NaN` for `∞ / ∞`. Any other divisor is finite and not zero, and the
  // quotient is computed by `scaledComplexDivide`, which scales both operands by
  // powers of two first, so no intermediate value overflows
  // (`1 / (1e-200 + 1e-200·i)` is `5e199 − 5e199·i`,
  // `1 / (1e308 + 1e308·i)` is `5e-309 − 5e-309·i`, and
  // `(1e308 + 1e308·i) / (1 + i)` is `1e308`).
  // True when `x·y` is an exact zero (a factor is zero) or a normal double:
  // the emitted complex `Divide` tests its four numerator products with it,
  // as `complexQuotient()` in `numerics/numeric-complex.ts` does.
  cprodok: (x: number, y: number): boolean => {
    if (x === 0 || y === 0) return true;
    const p = Math.abs(x * y);
    return p >= 2.2250738585072014e-308 && p < Infinity;
  },
  cdivedge: (ar: number, ai: number, br: number, bi: number): ComplexResult => {
    if (ar !== ar || ai !== ai || br !== br || bi !== bi)
      return { re: NaN, im: NaN };
    if (br === 0 && bi === 0)
      return ar === 0 && ai === 0 ? { re: NaN, im: NaN } : complexPole();
    if (Math.abs(br) === Infinity || Math.abs(bi) === Infinity)
      return Math.abs(ar) === Infinity || Math.abs(ai) === Infinity
        ? { re: NaN, im: NaN }
        : { re: 0, im: 0 };
    return scaledComplexDivide(ar, ai, br, bi);
  },
  // The exact runtime realness test of a value that may be a plain number or
  // a `{re, im}` object: true when the imaginary part is exactly zero. The
  // `complexIsReal` hook of this target (`CompileTarget.complexIsReal`); the
  // test is exact because the transcendental kernels give an exact zero part
  // where the value has one (`kernelResult`).
  cisreal: (x: unknown): boolean =>
    typeof x === 'number' || (x as { im: number }).im === 0,
  // The real part of a value that may be a plain number or a `{re, im}`
  // object, the imaginary part ignored — the interpreter's reading of a
  // complex bound, count or index. Anything else is NaN.
  realPart: (x: unknown): number => indexValue(x),
  // Shape-agnostic SCALAR add / multiply: two numbers combine as numbers; a
  // `{re, im}` in either position combines as complex (the other operand
  // lifted). The fold combiner of a collection `Sum`/`Product` whose elements
  // are not provably real (`emitCollectionReduce`), so a promoted or complex
  // element never reaches the raw `+`.
  sadd: scalarAdd,
  smul: scalarMul,
  // The exactly-real complex object `{re, im: 0}` AS the real number `re`;
  // any other value passes through. Used by the emitted DISPATCHERS
  // (multi-clause guard chains, protocol receiver guards) to test their
  // guards on the value the interpreter would see — a `complex`-typed symbol
  // is lifted to `{re, im: 0}` at `run()` entry (D3), and a value-literal
  // guard (`_$a[0] === 0`) or a `real` guard must still select the clause the
  // interpreter selects for the real number `0`.
  creal: (x: unknown): unknown =>
    typeof x === 'object' &&
    x !== null &&
    (x as { im: unknown }).im === 0 &&
    typeof (x as { re: unknown }).re === 'number'
      ? (x as { re: number }).re
      : x,
  // The ELEMENT-WISE real projection (`CompileTarget.complexRealElements`):
  // an array — nested arrays recursed — with every exactly-real element
  // (`cisreal`) replaced by its real part and every other element by NaN; a
  // scalar takes the same rule whole. The element-wise form of the D2/D6
  // runtime rule (`BaseCompiler.realOperandGuard`) hands a real-only head's
  // array operand through this, so the real lowering that follows sees plain
  // numbers and answers NaN (or `false`, for an ordering) exactly at the
  // complex positions: `⌊√L⌋` at `L = [4, -1]` is `[2, NaN]`.
  crealElements: function crealElements(x: unknown): unknown {
    if (Array.isArray(x)) return x.map(crealElements);
    if (typeof x === 'number') return x;
    return typeof x === 'object' &&
      x !== null &&
      (x as { im: unknown }).im === 0 &&
      typeof (x as { re: unknown }).re === 'number'
      ? (x as { re: number }).re
      : NaN;
  },
  // Element-wise addition, mirroring the interpreter's `Add` broadcast
  // (`addTensors`/`broadcastOverIndexedCollections`): scalar+scalar is ordinary
  // addition; over (possibly nested) arrays it recurses element-wise. Used as
  // the `Sum` collection-reduce combiner on the possibly-collection path, where
  // the elements may themselves be vectors/matrices at run time.
  add: (a: BcastValue, b: BcastValue): BcastValue =>
    bcast((x, y) => (x as number) + (y as number), a, b),
  // The complex form of `add`: every entry of the result is `{re, im}`, as
  // in the result of the other complex linear-algebra helpers. Chosen by
  // the compiler when the operands are complex (`elementwiseFoldCombiner`).
  cadd: (a: BcastValue, b: BcastValue): BcastValue =>
    bcast((x, y) => cxAdd(complexEntry(x), complexEntry(y)), a, b),
  // `add` for operands whose lane is not known when the code is compiled (a
  // function typed `unknown`, a `list<number>`): two numbers add as numbers
  // and a complex entry adds as complex, with one type test per entry.
  addAny: (a: BcastValue, b: BcastValue): BcastValue =>
    bcast((x, y) => scalarAdd(x, y) as BcastValue, a, b),
  chop,
  // `x! = Γ(x+1)`, matching the interpreter's `Factorial` evaluate handler.
  // The shared `factorial()` helper is integer-only (it returns NaN for a
  // non-integer), so a non-integer argument goes through Γ instead —
  // `(-1/2)! = Γ(1/2) = √π`, not NaN (Tycho item 99). The non-negative
  // integer fast path is unchanged (`n > 170 → Infinity`; `170!` itself is
  // the largest double-representable factorial and stays finite).
  // A negative *integer* is a pole of Γ(x+1): the interpreter returns
  // ComplexInfinity, whose float projection is `Infinity` (pole-encoding
  // ruling 2026-08-28 — the magnitude survives, the missing direction does
  // not), the same value an embedded `~oo` literal compiles to.
  factorial: (x: number): number =>
    Number.isInteger(x) ? (x < 0 ? Infinity : factorial(x)) : gamma(x + 1),
  factorial2,
  // Γ has a pole at every non-positive integer; the shared numeric helper
  // answers `NaN` there, but the compiled lane spells a pole as `Infinity`
  // (the float projection of the interpreter's `~oo`), the same value a
  // folded `Gamma(-2)` embeds — so the runtime and folded routes agree. A
  // non-integer or non-finite argument (`-Infinity` is not a pole) still
  // goes to the helper unchanged.
  gamma: (z: number): number =>
    Number.isInteger(z) && z <= 0 ? Infinity : gamma(z),
  // The common divisor of two reals (`realGcd`). An operand beyond the safe
  // integer range, or infinite, throws (`integerOperand`).
  gcd: (a: number, b: number): number =>
    gcd(integerOperand('GCD', a), integerOperand('GCD', b)),
  // Numeric-differentiation fallback (item 177): `_SYS.nd(f, k)` returns the
  // function x ↦ (numeric k-th derivative of f at x). Emitted by
  // `compileDerivative` (library/calculus.ts) when the symbolic closed form
  // is unavailable (the differentiation growth budget tripped, or the head
  // stayed unresolved). The implementation is the SAME exported function the
  // interpreter's fallback calls (`centeredDiffHigherOrder`,
  // numerics/numeric.ts), so compiled and interpreted values are
  // bit-identical — Tycho's route-parity requirement.
  // A point- or list-valued function (a space curve) is differentiated
  // component by component through the vector form of the same stencil,
  // one evaluation per sample; the interpreter's fallback does the same
  // (`stencilDerivativeAt`, library/calculus.ts). `shape` is what the
  // emitter read from the function's result type; without it the function
  // is probed once at `x`. A function that answers no vector of one length
  // at every sample is NaN, like a scalar sample that is not a real.
  nd:
    (f: (x: number) => unknown, order: number, shape?: 'vector' | 'scalar') =>
    (x: number): number | number[] => {
      const vector =
        shape === 'vector' || (shape === undefined && Array.isArray(f(x)));
      if (!vector) return centeredDiffHigherOrder(realFn(f), x, order);
      return (
        centeredDiffHigherOrderVector(
          (t) => {
            const at = f(t);
            return Array.isArray(at) ? at.map(machineReal) : undefined;
          },
          x,
          order
        ) ?? NaN
      );
    },
  // Fixed exponents avoid repeated base evaluation and the general power
  // kernel. Keep multiplication order explicit for small real powers.
  pow2: (x: number) => x * x,
  // `Tan`, `Cot`, `Sec` and `Csc` of a real argument answer the pole
  // (`Infinity`) where the interpreter answers `~oo`: see `tanWithPole`.
  tan: tanWithPole,
  // `sin(πu)`, `cos(πu)`, `tan(πu)` and `e^{iπu}` with the angle `u` in
  // half-turns, reduced exactly (`cosSinPi()`): the value at an integer or a
  // half-integer `u` has an exact zero part (`sinpi(2)` is `0`, where
  // `Math.sin(Math.PI * 2)` is `−2.4e-16`). See `BaseCompiler.piMultiple`.
  // `tan` at a half-integer is the pole, `Infinity` on the real lane, as
  // `_SYS.tan` answers it.
  sinpi: (u: number): number => cosSinPi(u)[1],
  cospi: (u: number): number => cosSinPi(u)[0],
  tanpi: (u: number): number => {
    const [c, s] = cosSinPi(u);
    return c === 0 ? Infinity : s === 0 ? 0 : s / c;
  },
  // `e^{a + iπu}`: `e^a·(cos πu + i·sin πu)`, a zero part `+0`.
  cexppi: (u: number, a?: number): ComplexResult => {
    const [c, s] = cosSinPi(u);
    const m = a === undefined ? 1 : Math.exp(a);
    return { re: c === 0 ? 0 : m * c, im: s === 0 ? 0 : m * s };
  },
  cot: cotWithPole,
  sec: secWithPole,
  csc: cscWithPole,
  pow3: (x: number) => x * x * x,
  // The fractional part under the floored convention, the value of
  // `Mod(x, 1)`. The trailing `% 1` maps the one case where the subtraction
  // rounds up to exactly `1` (a tiny negative `x`) back into `[0, 1)`; it
  // is exact everywhere else on that range. NaN and the infinities give NaN.
  fract: (x: number) => (x - Math.floor(x)) % 1,
  // The floored remainder, the value of `Mod(a, b)`, as the interpreter
  // computes it on doubles: the divisor is added only when the signs of the
  // truncated remainder and of the divisor differ (see `floorModDouble`).
  // An operand beyond the safe integer range, or infinite, throws
  // (`integerOperand`).
  floorMod: (a: number, b: number): number =>
    floorModDouble(integerOperand('Mod', a), integerOperand('Mod', b)),
  // The remainder of `a / b` with the quotient rounded to the nearest
  // integer, a tie toward `+∞` (`Math.round`), the value of
  // `Remainder(a, b)`. An operand beyond the safe integer range, or
  // infinite, throws (`integerOperand`): there the rounded quotient is not
  // exact, and the formula answers a value that is not the remainder of
  // either the double or the exact operand (`2^60 - 7·round(2^60/7)` is
  // `0`, where the remainder is `1`).
  remainder: (a: number, b: number): number => {
    const x = integerOperand('Remainder', a);
    const y = integerOperand('Remainder', b);
    return x - y * Math.round(x / y);
  },
  pow4: (x: number) => {
    const s = x * x;
    return s * s;
  },
  pow5: (x: number) => {
    const s = x * x;
    return s * s * x;
  },

  // Power with the interpreter's 0^0 = NaN convention. `Math.pow(0, 0)` is 1,
  // but the interpreter treats a genuine 0^0 as indeterminate (NaN). Used only
  // on the variable-exponent path — where the exponent could be 0 at run time
  // (a constant nonzero exponent stays on the plain `Math.pow` fast path). See
  // finding CO-P2-24. A negative base with an exponent that is not an
  // integer has the real root the interpreter answers when the exponent is
  // a rational `p/q` with an odd `q`, recovered from the double as the
  // interpreter recovers it (`negativeBaseRealPow()`): `(−8)^w` at
  // `w = 0.3333333333333333` is `−2`, as in the interpreter at machine
  // precision. Otherwise the value is not real, and `Math.pow` gives `NaN`.
  pow: (base: number, exp: number): number => {
    if (base === 0 && exp === 0) return NaN;
    if (base < 0) {
      const r = negativeBaseRealPow(base, null, exp);
      if (r !== undefined) return r;
    }
    return Math.pow(base, exp);
  },
  // Fail-closed Which/When condition guard. The interpreter requires a
  // condition to evaluate to True/False and throws otherwise; a compiled
  // ternary would silently treat a non-boolean (notably NaN) as falsy and take
  // the default branch. Rethrow to match the interpreter (D6, CO-P2-24).
  cond: (c: unknown): boolean => {
    if (c === true || c === false) return c;
    throw new Error('Condition must evaluate to "True" or "False".');
  },
  // Element-wise `Which`/`If` selection over a condition that may be a
  // collection at run time — see `select` and `compileJSSelection`.
  select,
  // A point arm of such a selection, lifted whole rather than indexed.
  wholeArm: (value: unknown): WholeArm => new WholeArm(value),
  // The restriction `value\{conditions\}` (`When`) over a LIST of conditions:
  // one masked value per condition, `absent` (the target's absence value,
  // `NaN` or its complex form) where the condition is not true. A list
  // value (`zip`) is aligned with the conditions element by element and
  // truncated to the shorter of the two, exactly as the interpreter aligns
  // them; any other value — a number, a point — is one value, repeated at
  // every position. A condition that is not an array at run time is one
  // scalar condition.
  restrict: (
    conds: unknown,
    value: unknown,
    zip: boolean,
    absent: unknown
  ): unknown => {
    if (!Array.isArray(conds)) return conds === true ? value : absent;
    if (zip) {
      if (!Array.isArray(value)) return absent;
      const n = Math.min(conds.length, value.length);
      const out = new Array<unknown>(n);
      for (let i = 0; i < n; i++)
        out[i] = conds[i] === true ? value[i] : absent;
      return out;
    }
    return conds.map((c) => (c === true ? value : absent));
  },
  // NaN propagates (Contract B `propagate` default, ratified 2026-08-27):
  // without the leading arm both comparisons are false for NaN and the
  // kernel answered the final arm's `1` — a fail-closed violation.
  heaviside: (x: number) =>
    Number.isNaN(x) ? NaN : x < 0 ? 0 : x === 0 ? 0.5 : 1,
  // The step forms `Floor(x, step)`, `Ceil(x, step)` and `Truncate(x, step)`:
  // `round(x / k) · k` with `k = |step|`, the quotient taken to the nearest
  // integer when it is within its rounding error of it (`stepMultiple`).
  floorStep: (x: number, step: number) => stepMultiple(Math.floor, x, step),
  ceilStep: (x: number, step: number) => stepMultiple(Math.ceil, x, step),
  truncStep: (x: number, step: number) => stepMultiple(Math.trunc, x, step),
  // `Round(x, step)`: the quotient is taken to the nearest half-integer
  // when it is that close, so that a tie is found, and the tie is rounded
  // with the rule `ties` (`ce.roundingTies` when the code is compiled).
  roundStep: (x: number, step: number, ties: RoundingTies) =>
    stepMultiple((q) => roundToInteger(q, ties), x, step, 0.5),
  // `Round` with a tie rounded to the even neighbour (`ce.roundingTies` is
  // `'to-even'` when the code is compiled). The other tie rules have an
  // inline form made of `Math.round`; this one does not.
  roundToEven: (x: number) => roundToInteger(x, 'to-even'),
  // `Characters`/`GraphemeClusters`: the interpreter's own decomposition —
  // UAX #29 grapheme clusters via `Intl.Segmenter` (`splitGraphemeClusters` in
  // `library/core.ts`), with the NFC normalization `engine.string()` applies to
  // the input and to every element. Deliberately not `[...s]` (code points) nor
  // `s.split('')` (UTF-16 units): both disagree with the interpreter on a
  // combining sequence, a ZWJ emoji or a flag. The segmenter is built once —
  // constructing one per call dominates the cost in a scanner loop.
  chars: (s: unknown): string[] => {
    if (typeof s !== 'string')
      throw new Error(
        'Could not compile `Characters`: expected a string operand'
      );
    graphemeSegmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' });
    // `conditionText`, not a bare `.normalize()`: the interpreter conditions a
    // string at INGRESS — NFC normalization AND the lone-surrogate → U+FFFD
    // replacement of `String.prototype.toWellFormed` (`BoxedString`'s
    // constructor) — so a raw host string bound to a compiled parameter must go
    // through the same two steps here. Without the second one, a lone surrogate
    // reaching `Characters`, indexing, iteration or a string-preserving
    // operator would be segmented as itself, where the interpreter has already
    // replaced it with U+FFFD.
    return Array.from(graphemeSegmenter.segment(conditionText(s)), (seg) =>
      seg.segment.normalize()
    );
  },
  // Order two CHARACTERS (each a one-cluster string) the way the interpreter
  // does: by their Unicode SCALAR sequence, comparing code point against code
  // point and, on a common prefix, the shorter cluster first
  // (`compare.ts`, decision D8).
  //
  // Not `a < b`: `String.prototype.<` compares UTF-16 code UNITS, so every
  // astral character — U+10000 and above, encoded as a surrogate pair whose
  // lead unit is 0xD800–0xDBFF — sorts BELOW the private-use and specials
  // block U+E000–U+FFFF. `"\u{10000}" < ""` is `true` under the raw operator
  // and `False` in the interpreter. `Array.from` iterates CODE POINTS (not
  // code units), which is what makes the surrogate pair one comparison.
  //
  // Returns the usual −1/0/1, so it doubles as the comparator for a
  // character `Sort`.
  //
  // Each operand is put through the SAME ingress conditioning the interpreter
  // applies when it boxes a character — Unicode NFC normalization, then the
  // lone-surrogate → U+FFFD replacement of `String.prototype.toWellFormed`
  // (`boxed-character.ts`). Without it the decomposed `"e" + U+0301` and the
  // precomposed `"é"` are different code-point sequences here and compare
  // unequal, where the interpreter — which normalized both at boxing time —
  // answers equal. Literals and everything `_SYS.chars` produces are already
  // conditioned, so this only changes a raw host string bound to a compiled
  // parameter.
  cmpc: (a: unknown, b: unknown): number => {
    const sa = Array.from(conditionText(a), (c) => c.codePointAt(0)!);
    const sb = Array.from(conditionText(b), (c) => c.codePointAt(0)!);
    const n = Math.min(sa.length, sb.length);
    for (let i = 0; i < n; i++)
      if (sa[i] !== sb[i]) return sa[i] < sb[i] ? -1 : 1;
    return sa.length === sb.length ? 0 : sa.length < sb.length ? -1 : 1;
  },
  // --- Sequence search and string operations ----------------------------
  // The kernels behind `StartsWith`/`EndsWith` (`seqat`, the anchored test),
  // `ContainsSequence`/`RangeOf` (`seqidx`, the scan) and the string-specific
  // operators. Each is the interpreter's own algorithm over the same element
  // sequence: a string operand reaches them already segmented into grapheme
  // clusters by `chars`, so no comparison can straddle a cluster boundary.
  // See `matchesSequenceAtJS`, `findSequenceJS`, `replaceText`, `trimText`,
  // `padText` and `caseFoldText`.
  // (`docs/STRING_ROADMAP.md`, decision D8.)
  // --- Regular expressions (Strings Phase 3) ----------------------------
  // The dialect is the HOST's, by user ruling 2026-08-17 — no feature subset
  // and no caps — which is exactly what makes compiled code and the
  // interpreter agree here: both hand the same pattern text to the same
  // `RegExp` implementation, so there is no second engine to diverge from.
  //
  // `rerep` compiles its own `g`-flagged object per call rather than reusing
  // one. A `g`-flagged `RegExp` carries its scan position in `lastIndex`, so
  // a shared instance corrupts two live loops; the interpreter learned this
  // the hard way when a replacement callback re-entered the same pattern and
  // hung. Compiled code has the same hazard. `reis` is NOT global — `.test()`
  // on a plain pattern neither reads nor writes `lastIndex` — so its per-call
  // construction is only a small allocation, not a correctness requirement.
  // `conditionText` + the non-string rejection, exactly as `chars` does: the
  // interpreter conditions a string at INGRESS (NFC normalization AND the
  // lone-surrogate → U+FFFD repair of `BoxedString`'s constructor), so a raw
  // host string bound to a compiled parameter must go through the same steps
  // or the two surfaces disagree. Measured before this: the NFD spelling of
  // `é` (`e` + U+0301) matched `/é/` in the interpreter and NOT in compiled
  // code. Rejecting a non-string is the same contract too — `test()` would
  // otherwise coerce `42` to `\"42\"` and answer.
  reis: (s: unknown, src: string, flags: string) => {
    if (typeof s !== 'string')
      throw new Error('Could not compile `IsMatch`: expected a string subject');
    return new RegExp(src, flags).test(conditionText(s));
  },
  // Conditioned on both the subject and the replacement, for the reason given
  // on `reis`: the interpreter has already conditioned both by the time it
  // builds a result, so compiled code must too.
  rerep: (
    sRaw: unknown,
    src: string,
    flags: string,
    replacementRaw: unknown,
    limit: number
  ) => {
    if (typeof sRaw !== 'string' || typeof replacementRaw !== 'string')
      throw new Error(
        'Could not compile `StringReplace`: expected string operands'
      );
    const s = conditionText(sRaw);
    const replacement = conditionText(replacementRaw);
    const re = new RegExp(src, flags.includes('g') ? flags : flags + 'g');
    const out: string[] = [];
    let from = 0;
    let done = 0;
    re.lastIndex = 0;
    for (;;) {
      if (done >= limit) break;
      const m = re.exec(s);
      if (m === null) break;
      out.push(s.slice(from, m.index), replacement);
      from = m.index + m[0].length;
      done += 1;
      if (m[0].length === 0) {
        const step = codePointWidthAt(s, re.lastIndex);
        out.push(s.slice(from, from + step));
        from += step;
        re.lastIndex += step;
        if (re.lastIndex > s.length) break;
      }
    }
    out.push(s.slice(from));
    // NFC-normalize the JOIN, as `replaceText` (the literal-target kernel) and
    // the interpreter's `ce.string(out.join(''))` both do. Re-segmentation
    // happens once, when the pieces are joined, so a replacement whose
    // trailing edge composes with the character following it must combine:
    // replacing `q` with `e` in `q` + U+0301 is the single character `é`
    // (U+E9), not `e` + U+0301. Without this the compiled result had a
    // different `Length()` from the interpreted one.
    return out.join('').normalize();
  },
  seqat: matchesSequenceAtJS,
  seqidx: findSequenceJS,
  srep: replaceText,
  strim: trimText,
  spad: padText,
  cfold: caseFoldText,
  // Run-time DOMAIN guards for the operands whose out-of-domain value the
  // interpreter answers with an ERROR VALUE — `RangeOf`'s `from` and needle,
  // `StringReplace`'s `count` and `target`, `StringRepeat`'s and
  // `PadStart`/`PadEnd`'s `n` and `pad`. A compiled artifact has no error
  // value to hand back, so the emitted code THROWS with the operator and the
  // violated rule named: the interpreter returns an error VALUE, compiled
  // code throws — a visible failure, never a wrong value. Same contract as
  // the `Slice` lowering's run-time span check, which throws on a span
  // argument that is not an ascending index range.
  //
  // Emitted only for a COMPUTED operand: a literal is decided at compile
  // time, where an out-of-domain one declines instead (see
  // `guardedIntegerArg`). Each returns its operand so it can wrap the value
  // in place.
  // `max` is the UPPER bound the interpreter's own reader imposes: the string
  // operators read their count through `asSmallInteger` (`library/core.ts`),
  // which answers `null` — hence an error value — for a magnitude above
  // `SMALL_INTEGER` (1000000). Without it, `StringRepeat(s, 2000001)` would
  // build a multi-megabyte string where the interpreter errors. `RangeOf`'s
  // `from` reads through `toInteger` instead and has no such ceiling, so it
  // passes `Infinity`. A lower bound below `-SMALL_INTEGER` needs no separate
  // test: every caller's `min` is 0 or 1.
  domi: (v: unknown, min: number, max: number, message: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
      throw new RangeError(message);
    return v;
  },
  doms: (v: unknown, message: string): string => {
    if (typeof v !== 'string' || v === '') throw new RangeError(message);
    return v;
  },
  // The needle of `RangeOf`, which must be a NON-EMPTY sequence: an empty
  // needle has no representable span (`Range(1, 0)` is the DESCENDING range
  // [1, 0], not an empty one), so the interpreter answers an error value for
  // it. Both kinds of needle reach here as an array — a string's grapheme
  // clusters or a list's elements — so the length test covers both.
  domne: <T extends ArrayLike<unknown>>(v: T, message: string): T => {
    if (v.length === 0) throw new RangeError(message);
    return v;
  },
  // --- Lazy infinite-collection streams ---------------------------------
  // A STATICALLY infinite collection (`Range(1, ∞)` and the Map/Filter/Drop/
  // Rest pipeline over it) has no array representation, so it compiles to a
  // lazy iterator instead, materialized by a bounding consumer
  // (`takeIter`/`takeWhileIter`). These helpers are emitted ONLY by
  // `emitLazyStream` — the eager collection lowering never produces or
  // consumes them, and an infinite pipeline that never reaches `Take`/
  // `TakeWhile` fails closed at compile time (see the `Range` handler and
  // `collArg`). Only the two non-scanning helpers live here; the four
  // SCANNING helpers (`filterIter`/`dropIter`/`takeIter`/`takeWhileIter`)
  // need the owning engine's iteration limit, so they are bound per compiled
  // artifact by `makeLazyStreamHelpers(ce)` below, like the random helpers.
  rangeIter: function* (start: number, step: number): Generator<number> {
    for (let x = start; ; x += step) yield x;
  },
  mapIter: function* (
    it: Iterable<unknown>,
    f: (x: unknown) => unknown
  ): Generator<unknown> {
    for (const x of it) yield f(x);
  },
  // NOTE: the random helpers (`drawNextRandomNumber`, `withRandomSeed`, the
  // `domain*` descriptor builders, `randomPick`/`randomChoice`/
  // `randomSample`/`shuffle`) are deliberately NOT defined here: they need the
  // OWNING ENGINE, so they are bound per compiled artifact by
  // `makeSysHelpers(ce)` below. A shared instance would have to reach a
  // module-level slot — a process singleton cross-contaminating engines.
  // --- Linear algebra (nested-array representation) ------------------------
  // Dimension mismatches yield NaN (the interpreter's error/inert result
  // projected onto a real target). Each helper has a real-only plain form
  // and a complex form that computes with `{re, im}` entries; the compiler
  // picks one from the lane of the operands (see `complexEntry`).
  //
  // Product dispatch on dimensionality, mirroring the interpreter's
  // `Dot`/`MatrixMultiply`: vector·vector → scalar, matrix·vector → vector,
  // vector·matrix → vector, matrix·matrix → matrix.
  matmul,
  // The complex forms, emitted when the lane of the operands is complex —
  // see the note above `complexEntry`.
  complexMatmul,
  complexDet: complexDetOrNaN,
  complexInv: complexInvOrNaN,
  complexTrace,
  complexCross,
  complexMatpow,
  // The broadcasting `Dot` over a LIST OF POINTS — one inner product per
  // point. Separate from `matmul` because an array of points and an array of
  // matrix rows are the same run-time shape but contract differently. The
  // last two arguments say which operand the static type called a list.
  pointdot,
  complexPointdot,
  // Interpreter-faithful `Multiply` over a mix of scalars and (possibly
  // nested) real arrays whose collection-ness was not statically provable —
  // see `tryCompileBroadcast`'s ≥2-possibly-collection branch.
  mul: mulTensor,
  cmul: complexMulTensor,
  mulAny: mulTensorAny,
  // Interpreter-faithful `Equal`/`NotEqual` over operands whose
  // collection-ness was not statically provable — see `compileJSEquality`'s
  // possibly-collection lowering (Tycho item 41).
  eq: eqTensor,
  neq: neqTensor,
  cross: (a: number[], b: number[]): number[] | number =>
    a.length === 3 && b.length === 3
      ? [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ]
      : NaN,
  // `Abs` over a value whose static type admits BOTH a point and a point
  // list (the `list<tuple<…>> | tuple<…>` union a point-consuming document
  // function declares): the shape is only known at run time, so dispatch on
  // it here the way `evaluate()` dispatches on the operand's kind — a number
  // is `Math.abs`, a complex object its modulus, an array of scalars a POINT
  // (its norm; a scalar is a number or a `{re, im}` object, whose modulus
  // `_SYS.norm` reads), and an array of arrays a point list (one norm per
  // point). An
  // EMPTY array is an empty point LIST — the interpreter answers the empty
  // list for it, not the norm of no components (which is 0).
  //
  // A compiled array carries no tuple-versus-list tag, so a flat numeric
  // array is read as a point. That is the only reading the operands which
  // reach this helper admit: the compiler sends an operand here only when
  // its type has no flat-numeric-list arm, or when it is a point SUM, for
  // which the interpreter refuses a flat list of numbers. A NESTED array is
  // read as a point list, never as a matrix, for the same reason: the
  // operand types that reach this helper have no legitimate matrix value —
  // a point-list union refuses a matrix at the call gate, and where the
  // declaration does accept one the point subtraction errors at every
  // element (Tycho item 253).
  absShape: (x: unknown): unknown => {
    if (typeof x === 'number') return Math.abs(x);
    if (Array.isArray(x)) {
      if (x.length === 0) return [];
      if (
        x.every(
          (v) =>
            typeof v === 'number' ||
            (typeof v === 'object' && v !== null && !Array.isArray(v))
        )
      )
        return SYS_HELPERS.norm(x);
      return x.map((v) => SYS_HELPERS.absShape(v));
    }
    if (
      typeof x === 'object' &&
      x !== null &&
      typeof (x as { re?: unknown }).re === 'number'
    )
      return SYS_HELPERS.cabs(x as ComplexResult);
    return NaN;
  },
  // Norm: |x| for a scalar; the 2-norm (Frobenius for a matrix) by default.
  // With an explicit p: for a vector the p-norm (Σ|xᵢ|^p)^(1/p), p =
  // Infinity → max |xᵢ|; for a matrix p = 1 → max column abs sum, p = 2 →
  // the spectral norm (the largest singular value, from `spectralNorm()`),
  // p = Infinity → max row abs sum. Every other matrix p yields NaN. Above
  // rank 2 the order 2 is the Frobenius norm, as in the interpreter: the
  // spectral norm is a matrix norm only.
  //
  // Every order except the matrix order 2 reads an entry only through its
  // magnitude |xᵢ| (`entryModulus`), so a complex entry — a `{re, im}`
  // object — takes part like the interpreter's `Abs` of it: `‖[2, i]‖` is
  // √5. The matrix order 2 reads the real and imaginary parts of each entry. Before, the
  // arithmetic below met the object itself and every order answered NaN.
  norm: (x: unknown, p?: number): number => {
    if (typeof x === 'number') return Math.abs(x);
    if (!Array.isArray(x)) return entryModulus(x);
    const flat = (x.flat(Infinity) as unknown[]).map(entryModulus);
    // An infinite entry makes the norm `+∞` whatever the other entries are, a
    // NaN entry included: `|±∞|` is `+∞`, and it dominates every sum and every
    // maximum below. The test must be explicit because the accumulators cannot
    // express it — `Infinity² + NaN²` is `NaN`, and `Math.max(Infinity, NaN)`
    // is `NaN` — so without it the result is `NaN` where the interpreter and
    // `Math.hypot(Infinity, NaN)` both answer `Infinity`. It applies to the
    // matrix operator norms too, so that the column or row carrying the
    // infinity never decides the answer on its own. Each order consults it
    // only after accepting the order, so that an entry cannot turn an order
    // this helper does not implement into one it answers. The rule is recorded
    // in `docs/ERROR-MODEL.md`.
    const hasInfiniteEntry = flat.some(
      (v) => v === Infinity || v === -Infinity
    );
    // A rank ≥ 3 tensor with the order 2 takes the vector branch below: the
    // entry-wise sum of squares over every cell, the Frobenius norm.
    if (
      Array.isArray(x[0]) &&
      p !== undefined &&
      !(p === 2 && Array.isArray(x[0][0]))
    ) {
      const m = x as unknown[][];
      // The matrix orders below are the max column sum, the spectral norm
      // and the max row sum; any other one is NaN whatever the entries are.
      if (p !== 1 && p !== 2 && p !== Infinity) return NaN;
      if (hasInfiniteEntry) return Infinity;
      // The spectral norm needs the real and imaginary parts of each entry,
      // not only its modulus. A NaN entry makes the norm NaN, as in the
      // interpreter (`spectralMatrixNorm`, `library/linear-algebra.ts`); the
      // infinite entries are already decided above. A ragged matrix, or an
      // entry that is not a number, has no spectral norm, so it is NaN too.
      if (p === 2) {
        const n = m[0].length;
        const re: number[][] = [];
        const im: number[][] = [];
        for (const row of m) {
          if (!Array.isArray(row) || row.length !== n) return NaN;
          const rowRe: number[] = [];
          const rowIm: number[] = [];
          for (const v of row) {
            let a: number;
            let b: number;
            if (typeof v === 'number') {
              a = v;
              b = 0;
            } else if (
              typeof v === 'object' &&
              v !== null &&
              typeof (v as ComplexResult).re === 'number' &&
              typeof (v as ComplexResult).im === 'number'
            ) {
              a = (v as ComplexResult).re;
              b = (v as ComplexResult).im;
            } else return NaN;
            if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
            rowRe.push(a);
            rowIm.push(b);
          }
          re.push(rowRe);
          im.push(rowIm);
        }
        return spectralNorm(re, im);
      }
      if (p === 1) {
        let best = 0;
        for (let j = 0; j < m[0].length; j++) {
          let s = 0;
          for (let i = 0; i < m.length; i++) s += entryModulus(m[i][j]);
          best = Math.max(best, s);
        }
        return best;
      }
      if (p === Infinity) {
        let best = 0;
        for (const row of m) {
          let s = 0;
          for (const v of row) s += entryModulus(v);
          best = Math.max(best, s);
        }
        return best;
      }
      return NaN;
    }
    // The vector orders this helper implements are the L∞ maximum and the
    // p-norms for `p > 0`; with no `p` the order is 2. Any other order —
    // `p = 0`, a negative `p`, a NaN `p` — has no value here, so the result is
    // NaN, which is how compiled code spells an absent number. An unsupported
    // matrix order above answers the same way. The interpreter is stricter
    // there: a non-positive order violates `Norm`'s declared precondition and
    // answers an `evaluation-error` (the `requires` clause,
    // `library/linear-algebra.ts`), while an order it merely does not compute
    // for the operand's rank — a matrix p-norm for `p ∉ {1, 2, ∞}` — leaves
    // the application unevaluated. An `Error` has no float representation, so
    // the compiled lane degrades both to NaN. Without this line the general
    // accumulator
    // returns whatever `(Σ|xᵢ|^p)^(1/p)` happens to produce, which for `p = 0`
    // is `+∞` on a two-element vector and for a negative `p` an ordinary
    // number.
    //
    // The order is checked before the infinite-entry test above, for the same
    // reason the matrix branch checks it first: otherwise the data would be
    // what makes an unsupported order answer, and `norm([+∞], 0)` would be
    // `+∞` while `norm([1], 0)` is NaN.
    if (p !== undefined && !(p === Infinity || p > 0)) return NaN;
    if (hasInfiniteEntry) return Infinity;
    if (p === Infinity) {
      let m = 0;
      for (const v of flat) m = Math.max(m, Math.abs(v));
      return m;
    }
    // The largest magnitude `m` is found in the same loop as the sum. When a
    // term `m²` (or `m^p`) would overflow or be below the normal doubles,
    // the sum is computed again with the magnitudes scaled by a power of 2
    // (`scaledPNorm()`): `norm([3e-200, 4e-200])` was 0 and
    // `norm([3e200, 4e200])` was `+∞`. For the other vectors, the plain sum
    // below is the result, unchanged. `Math.hypot` would also be correct,
    // but it rounds differently and costs more.
    if (p === undefined || p === 2) {
      let s = 0;
      let m = 0;
      for (const v of flat) {
        s += v * v;
        if (v > m) m = v;
      }
      if (!pNormIsSafe(m, 2)) {
        const scaled = scaledPNorm(flat, 2);
        if (scaled !== undefined) return scaled;
      }
      return Math.sqrt(s);
    }
    let s = 0;
    let m = 0;
    for (const v of flat) {
      s += Math.pow(Math.abs(v), p);
      if (v > m) m = v;
    }
    if (!pNormIsSafe(m, p)) {
      const scaled = scaledPNorm(flat, p);
      if (scaled !== undefined) return scaled;
    }
    return Math.pow(s, 1 / p);
  },
  // Transpose of a 2D matrix; a vector (or scalar) is returned unchanged,
  // like the interpreter.
  transpose: (m: any): any => {
    if (!Array.isArray(m) || !Array.isArray(m[0])) return m;
    return m[0].map((_: unknown, j: number) =>
      m.map((row: number[]) => row[j])
    );
  },
  // Determinant by Gaussian elimination with partial pivoting; a non-square
  // input yields NaN.
  det: (m: number[][]): number => {
    const n = m?.length;
    if (!n || m.some((row) => !Array.isArray(row) || row.length !== n))
      return NaN;
    const a = m.map((row) => row.slice());
    let d = 1;
    for (let i = 0; i < n; i++) {
      let piv = i;
      for (let r = i + 1; r < n; r++)
        if (Math.abs(a[r][i]) > Math.abs(a[piv][i])) piv = r;
      if (a[piv][i] === 0) return 0;
      if (piv !== i) {
        [a[i], a[piv]] = [a[piv], a[i]];
        d = -d;
      }
      d *= a[i][i];
      for (let r = i + 1; r < n; r++) {
        const f = a[r][i] / a[i][i];
        for (let c = i; c < n; c++) a[r][c] -= f * a[i][c];
      }
    }
    return d;
  },
  // Inverse by Gauss–Jordan with partial pivoting; a non-square or singular
  // input yields NaN (the interpreter stays inert for a singular matrix).
  inv: matinv,
  // Conjugate transpose, diagonal (rank-dispatched), integer matrix power, and
  // reduced row echelon form — see the standalone helpers above.
  conjTranspose,
  diagonal,
  matpow,
  rref,
  trace: (m: number[][]): number => {
    if (!Array.isArray(m) || !Array.isArray(m[0])) return NaN;
    let s = 0;
    for (let i = 0; i < Math.min(m.length, m[0].length); i++) {
      // A rank > 2 tensor has array diagonal entries — adding one would
      // string-concatenate. Only a numeric diagonal sums; anything else is
      // NaN.
      if (typeof m[i][i] !== 'number') return NaN;
      s += m[i][i];
    }
    return s;
  },
  // Dimensions of a (regular) nested array, measured along first elements.
  shape: (x: unknown): number[] => {
    const dims: number[] = [];
    let cur = x;
    while (Array.isArray(cur)) {
      dims.push(cur.length);
      cur = cur[0];
    }
    return dims;
  },
  // Reshape with cyclic padding (Mathematica-style, matching the
  // interpreter): the source is flattened, then elements fill the new shape,
  // wrapping around when the source is shorter. 1-D and 2-D shapes.
  reshape: (x: unknown[], dims: number[]): unknown => {
    const flat = x.flat(Infinity);
    if (flat.length === 0) return NaN;
    const at = (i: number) => flat[i % flat.length];
    if (dims.length === 1)
      return Array.from({ length: Math.max(0, dims[0]) }, (_, i) => at(i));
    if (dims.length === 2)
      return Array.from({ length: Math.max(0, dims[0]) }, (_, i) =>
        Array.from({ length: Math.max(0, dims[1]) }, (_, j) =>
          at(i * dims[1] + j)
        )
      );
    return NaN;
  },
  // One component slot of an all-scalar compiled `PointList` whose static type
  // did not prove it a number (`unknown`, `value` — the type a free plot
  // variable carries).
  //
  // Such a slot is admitted statically because a per-pixel plot body is parsed
  // LaTeX whose free variables are `unknown` and are scalars at run time. When
  // one turns out to hold a LIST instead, the point would otherwise get a
  // whole array spliced into a component — `PointList(u, v)` with `v` bound to
  // `[10, 20]` produced `[1, [10, 20]]` — and no consumer of a point can read
  // that. The array becomes NaN, a self-describing absence marker, which is
  // the convention the ZIPPED lowering of `PointList` (`compileJSPointList`)
  // already applies to its own opaque slots.
  //
  // Deliberate divergence from the interpreter, shared with that zip guard:
  // the interpreter re-reads such a component as a list SOURCE and transposes
  // it, which the compiled form cannot know to do, and a silently-wrong point
  // is worse than an absent one.
  pointSlot: (v: unknown): unknown => (Array.isArray(v) ? NaN : v),
  /**
   * Coordinate `k` (0-based) of a point-shaped value whose static type did
   * not settle whether it is ONE point or a LIST of points. Mirrors the
   * interpreter's `pointComponentAt` and `runtimePointArity`
   * (`library/collections.ts`) under the JavaScript erasure, where a tuple
   * and a list are both arrays:
   *
   *  - a list whose first element is a NUMERIC coordinate row (an array whose
   *    cells are ALL numbers, the empty array included) is a list of points
   *    and yields the list of coordinates. A row that holds anything else is
   *    not a point in the interpreter (`isPointLike` admits a row only when
   *    its element type is a subtype of `number`, and admits tuples), so such
   *    a list is indexed like `First`/`Second`/`Third` instead; the
   *    tuple-of-strings spelling is erased to the same array and takes the
   *    same reading. Every cell must be tested, not just the first: a MIXED
   *    row such as `[1, "a"]` starts with a number and is not a point;
   *  - the third coordinate of a point (or of a list whose first point) has
   *    fewer than three components is the interpreter's `incompatible-
   *    dimensions` error, projected to a single `NaN` for the whole
   *    application — never a `NaN` per point;
   *  - an EMPTY array is the one shape the VALUE cannot settle, since both
   *    readings spell it `[]`. The caller settles it from the declared element
   *    type — the same evidence the interpreter uses there — and states the
   *    answer in `emptyBroadcasts`. When it broadcasts, the coordinate of zero
   *    points is the empty list, for every coordinate: what the interpreter
   *    answers for `PointX([])` (Desmos agrees: `[].x` is `[]`). When it
   *    element-INDEXES instead (a `list<list<any>>`, whose rows are points
   *    only when they hold numbers), the coordinate is absent and the answer
   *    is `NaN`, this target's projection of the interpreter's marker. The
   *    erasure makes an empty TUPLE the same value; it takes the broadcast
   *    reading too, since a zero-component point is not a shape any compiled
   *    producer builds;
   *  - an absent coordinate otherwise, and a non-array value (the
   *    interpreter's `incompatible-type` error) answer `NaN`.
   */
  pointComponent: (v: unknown, k: number, emptyBroadcasts = true): unknown => {
    if (!Array.isArray(v)) return NaN;
    if (v.length === 0) return emptyBroadcasts ? [] : NaN;
    const first = v[0];
    // A cell holds a coordinate when it is a JavaScript number — the absence
    // marker `NaN` and the infinities included — or the `{ re, im }` object a
    // complex value is erased to, `complex` being a subtype of `number`.
    const isCoordinate = (c: unknown): boolean =>
      typeof c === 'number' ||
      (typeof c === 'object' && c !== null && 're' in c);
    // EVERY cell must be a coordinate, as the interpreter's `isPointLike`
    // requires of a row's element type. Testing the first cell alone read
    // `[[1, "a"], [3, "b"]]` as a list of points and answered `[1, 3]`, where
    // the interpreter reads a row of mixed cells as no point at all and
    // element-indexes, answering the first row. An empty row passes, as it
    // does in the interpreter, where its element type is the bottom `never`.
    const rows = Array.isArray(first) && first.every(isCoordinate);
    if (k === 2 && (rows ? first.length : v.length) < 3) return NaN;
    if (rows) return v.map((p) => (Array.isArray(p) ? (p[k] ?? NaN) : NaN));
    return v[k] ?? NaN;
  },
  // Positional access for compiled `At`. CE `At` is 1-based; a negative index
  // counts from the end. A zero or out-of-range index yields NaN (the
  // interpreter returns `Nothing`, projected to NaN on a real target).
  //
  // A COMPLEX index value arrives as an `{ re, im }` object; the interpreter
  // reads its `.re` and ignores the imaginary part, so `indexValue` does the
  // same. Doing this at RUN time rather than gating at compile time is
  // deliberate: the index's declared type is routinely far wider than its
  // runtime value (a comprehension variable types as
  // `boolean | character | indexed_collection | number | string`), so a
  // static "provably real" gate rejected ordinary compilable code.
  //
  // The index may itself be a collection at run time (a literal list, or the
  // array a `_SYS.bcast` index expression such as `p[X-1]` produces), so
  // dispatch on its shape here rather than at compile time. A collection index
  // mirrors the interpreter's `At` Case B:
  //  - boolean mask (EVERY entry a boolean — an empty index is a mask, since
  //    `every` on an empty array is true): keep element i where mask[i] is
  //    true, 1-based; mask entries past the end contribute nothing;
  //  - integer gather: select each indexed element, negative entries counting
  //    from the end (same normalization as the scalar path). POSITION-
  //    PRESERVING: an out-of-range entry contributes NaN in place (the
  //    interpreter's absence marker), so the result always has the same
  //    length as the index list.
  // A FINITE non-integer entry selects no element: the interpreter puts the
  // absence marker in its slot, as for an out-of-range entry, and so does
  // this. A non-finite entry (`NaN`, an infinity) leaves the interpreter's
  // `At` unevaluated — no value at all — so the WHOLE result is NaN, the
  // projection of "no value" on a real target.
  // The operand of a list operator whose static type did not prove an
  // array (`runtimeCheckedArrayCode`): the array itself, or a `RangeError`.
  arr: (x: unknown, kind: string): unknown[] => {
    if (Array.isArray(x)) return x;
    throw new RangeError(`${kind}: the operand is not a list at run time`);
  },
  // An argument of a user function at a parameter annotated with a type that
  // is not numeric and has no `missing` member, whose static type admits an
  // absent value (`absentArgumentChecks`, `base-compiler.ts`): the value as
  // it is, or a `TypeError` for an absent value (`undefined`), where the
  // interpreter answers an `incompatible-type` error.
  present: <T>(x: T, message: string): T => {
    if (x === undefined) throw new TypeError(message);
    return x;
  },
  // The operand of an operator that only visits each element once, in any
  // order (`iterableCollectionCode`): an array as it is, the elements of a
  // JavaScript `Set` as an array, or a `RangeError` for any other value.
  // `scalar` reads a single value as a collection of one element: a number
  // when it is `'real'`, a number or a complex value `{re, im}` when it is
  // `'complex'` (see `iterableCollectionCode` for when each applies).
  // A numeric typed array is copied into a plain array, as the binding
  // boundary copies one for a parameter typed `list<real>`. When `real` is
  // true (`Max`, `Min`), every element must be a number: a complex value
  // `{re, im}` has no order, and `Math.max` would read it as `NaN`. A
  // parameter typed `list` gets this check at the binding boundary; a
  // parameter typed `collection` does not, so it is made here.
  elts: (
    x: unknown,
    kind: string,
    scalar?: 'real' | 'complex',
    real?: boolean
  ): unknown[] => {
    let xs: unknown[] | undefined;
    if (Array.isArray(x)) xs = x;
    else if (x instanceof Set) xs = [...x];
    else if (isNumericTypedArray(x)) xs = copyToPlainArray(x);
    else if (
      (scalar !== undefined && typeof x === 'number') ||
      (scalar === 'complex' &&
        typeof x === 'object' &&
        x !== null &&
        're' in x &&
        'im' in x)
    )
      xs = [x];
    if (xs === undefined)
      throw new RangeError(
        `${kind}: the operand is not a list or a set at run time`
      );
    if (real === true)
      for (const v of xs)
        if (typeof v !== 'number')
          throw new TypeError(
            `${kind}: an element of the operand is not a real number at run time`
          );
    return xs;
  },
  at: (arr: unknown, i: number | unknown[]): number | unknown[] => {
    if (!Array.isArray(arr)) return NaN;
    const n = arr.length;
    if (Array.isArray(i)) {
      const picked: unknown[] = [];
      // A boolean MASK is a filter, but its length must EQUAL the collection
      // length (BREAKING — was a silent prefix). A mismatch makes the
      // interpreter decline (an error), projected here as a whole-result NaN.
      // An EMPTY index is a gather that yields the empty list (not a mask —
      // `every` on an empty array is true), so guard the length explicitly.
      if (i.length > 0 && i.every((m) => typeof m === 'boolean')) {
        if (i.length !== n) return NaN;
        i.forEach((m, k) => {
          if (m === true) picked.push(arr[k]);
        });
        return picked;
      }
      for (const m of i) {
        const mv = indexValue(m);
        if (!Number.isInteger(mv)) {
          if (!Number.isFinite(mv)) return NaN;
          picked.push(NaN);
          continue;
        }
        const idx = mv > 0 ? mv - 1 : n + mv;
        // Out-of-range (or zero) index: keep the position, mark the absence
        // (POSITION-PRESERVING gather — matches the interpreter, whose
        // out-of-band access yields the absence marker, `NaN` for a numeric
        // collection). The result always has the same length as the index list.
        if (mv === 0 || idx < 0 || idx >= n) picked.push(NaN);
        else picked.push(arr[idx]);
      }
      return picked;
    }
    // Scalar index. The interpreter's Case C selects on an INTEGER `.re`,
    // answers the absence marker for a finite non-integer, and leaves `At`
    // unevaluated for anything else — so every non-integer projects to NaN.
    // Guard explicitly rather than falling into index arithmetic: JS coercion
    // would silently invent a value — `true` would index slot 0 (`true > 0`,
    // `true - 1 === 0`) and a fractional or NaN index would read a
    // non-existent property and yield `undefined`.
    const iv = indexValue(i);
    if (!Number.isInteger(iv)) return NaN;
    const idx = iv > 0 ? iv - 1 : n + iv;
    if (i === 0 || idx < 0 || idx >= n) return NaN;
    return arr[idx] as number;
  },
  // `ReplaceAt`, `DeleteAt` and `Insert` return a COPY of the array, as the
  // interpreter returns a new list and leaves its operand unchanged. The
  // index follows the interpreter's rules: 1-based, a negative index counts
  // from the end, and for `Insert` the positions are the n + 1 gaps (n + 1 or
  // -1 appends). The interpreter leaves the expression unevaluated for a zero
  // or out-of-range index and rejects a non-integer one. Compiled code has no
  // unevaluated value to return, so these helpers throw a `RangeError`, as
  // the compiled `Slice` does for an invalid span. The index is checked by
  // `listPosition`.
  // An operand that is a string only at run time (a fold accumulator seeded
  // with a string) is split into its characters by `listCopy`, as the
  // lowering does for an operand that is provably a string. `DeleteAt` then
  // joins the characters back into a string, as the interpreter does.
  replaceAt: (arr: unknown, i: unknown, v: unknown): unknown[] => {
    const out = listCopy(arr);
    out[listPosition('ReplaceAt', out.length, i)] = v;
    return out;
  },
  deleteAt: (arr: unknown, i: unknown): unknown => {
    const out = listCopy(arr);
    out.splice(listPosition('DeleteAt', out.length, i), 1);
    return typeof arr === 'string' ? out.join('').normalize() : out;
  },
  insert: (arr: unknown, i: unknown, v: unknown): unknown[] => {
    const out = listCopy(arr);
    // The n + 1 gaps of the array are the positions of an array one longer.
    const gap = listPosition('Insert', out.length + 1, i);
    out.splice(gap, 0, v);
    return out;
  },
  // The in-place form of a chain of `ReplaceAt` in the step of a fold that
  // owns its accumulator (`inPlaceUpdateChains` in `in-place-update.ts`):
  // `updates` holds the index and the value of each level, innermost first.
  // All of them were computed before this call, from the accumulator as it
  // was at the start of the step, so a step that swaps two slots reads both
  // old values, as in the interpreter. The indexes are checked as `replaceAt`
  // checks them. The array is the copy that `ownedCopy` made of the seed.
  replaceAtInPlace: (arr: unknown[], ...updates: unknown[]): unknown[] => {
    for (let k = 0; k < updates.length; k += 2)
      arr[listPosition('ReplaceAt', arr.length, updates[k])] = updates[k + 1];
    return arr;
  },
  // The seed of a fold that updates its accumulator in place: a copy, so
  // that the caller's array (a `run()` argument, a variable, a constant
  // list) is never changed. A string seed becomes the array of its
  // characters, which is what the first `ReplaceAt` would answer.
  ownedCopy: (x: unknown): unknown =>
    Array.isArray(x) || typeof x === 'string'
      ? listCopy(x)
      : ArrayBuffer.isView(x)
        ? Array.from(x as unknown as ArrayLike<unknown>)
        : x,
  // `at` for a base whose STATIC element type is numeric and whose value
  // comes from outside the kernel (a `run()` argument, a function
  // parameter). Every consumer of the read was compiled for a number, so a
  // row where a number was expected — a matrix handed to a kernel compiled
  // for a list of numbers — would make the scalar `+` concatenate strings.
  // The check dispatches on the run-time index shape: a scalar read must not
  // yield an array, and a gather or mask must not yield a list with an array
  // in it. Throw with the remedy: declare the collection with its nested
  // element type, or evaluate with the interpreter, which broadcasts.
  atNumeric: (
    arr: unknown,
    i: number | unknown[],
    elementType: string
  ): number | unknown[] => {
    const v = SYS_HELPERS.at(arr, i);
    const nested = Array.isArray(i)
      ? Array.isArray(v) && v.some((x) => Array.isArray(x))
      : Array.isArray(v);
    if (!nested) return v;
    throw new Error(
      `Could not compile \`At\`: the element read is a list at run time, but its static element ` +
        `type is \`${elementType}\`, so the compiled code treats it as a ` +
        `number. Declare the collection with its nested element type ` +
        `(for example \`list<list<number>>\` or \`matrix\`), or evaluate ` +
        `with the interpreter.`
    );
  },
  // Positional access WITHOUT the from-the-end convention: the index must be
  // an integer in `1..length`, and every other index — zero, negative,
  // fractional, past the end, a non-number — reads the collection's absence
  // marker. It exists for a HOST that replaces the `At` lowering because its
  // own source language has no from-the-end indexing: there a computed
  // negative index means "undefined", and `_SYS.at` would hand back a real
  // element from the far end instead. `_SYS.at` stays the lowering the
  // compiler itself emits, and the two differ in three ways: this one takes no
  // negative index, reads no boolean mask, and marks each out-of-band position
  // of a LIST index rather than refusing the whole read.
  //
  // A COMPLEX index — the `{ re, im }` object the compiler emits for an
  // operand that is not provably real, such as `\sqrt{K}` — is read through
  // its `.re`, as `_SYS.at` and the interpreter read it (`indexValue`), so
  // `[10,20,30][\sqrt{K}]` at `K = 4` reads 20 through either helper. Before,
  // the integer test ran on the object itself and every such read was out of
  // band.
  //
  // The absence marker is decided at RUN time, from the first cell: `NaN` for
  // a numeric collection (and for an empty one, where every read is out of
  // band anyway and `NaN` propagates where `null` would coerce to 0),
  // `undefined` for any other domain — the target null the object discharge
  // (`Coalesce`, `IsMissing`) reads. The compiled `At` decides the same thing
  // from the static element type; a host lowering has no such type for a
  // symbolic base, and `matrix<number>` matches `list<number>` yet holds its
  // absences as `Missing`, so the type test would misclassify it.
  //
  // A base that is not an array has no elements to index, so it reads `NaN`.
  // The guard is load-bearing rather than defensive: a STRING has both
  // `.length` and `[k - 1]`, so without it an accidental string base would
  // silently answer CHARACTERS.
  atNoWrap: (arr: unknown, i: unknown): unknown => {
    if (!Array.isArray(arr)) return NaN;
    const hole =
      arr.length === 0 || typeof arr[0] === 'number' ? NaN : undefined;
    const pick = (k: unknown): unknown => {
      const kv = indexValue(k);
      return Number.isInteger(kv) && kv >= 1 && kv <= arr.length
        ? arr[kv - 1]
        : hole;
    };
    return Array.isArray(i) ? i.map((k) => pick(k)) : pick(i);
  },
  // The element at 0-based position `k` of `arr`, for the compiled
  // `First`/`Second`/`Third` (`compileNthElement`). An absent collection
  // (`undefined`, the run-time spelling of `Missing`) reads the marker of the
  // element domain: `NaN` when `numeric` is true, and `undefined` otherwise.
  // The interpreter does the same: `First` of a restricted pair of numbers
  // whose condition is false is `NaN`, and `First(Missing)` is `Missing`
  // (user decision of 2026-09-26). A cell inside the array is
  // returned as it is, an absent cell included. A position past the end reads
  // the marker of the element domain: `NaN` when `numeric` is true (the
  // element type is numeric), and otherwise the domain the cells show, as
  // the interpreter's `absenceMarker()` decides it for an element type that
  // does not: `NaN` when the first cells that are present are numbers, and
  // `undefined` when one is not or no cell is present. A value that is not
  // an array is read as it was before this helper.
  nth: (arr: unknown, k: number, numeric?: boolean): unknown => {
    if (arr === undefined || arr === null)
      return numeric === true ? NaN : undefined;
    if (!Array.isArray(arr)) return (arr as Record<number, unknown>)[k];
    if (k < arr.length) return arr[k];
    if (numeric === true) return NaN;
    let sawNumber = false;
    // The interpreter looks at the first 10 cells only (its
    // `MAX_ABSENCE_MARKER_PROBE`), absent ones included.
    for (let j = 0; j < arr.length && j < 10; j++) {
      const c: unknown = arr[j];
      if (c === undefined) continue;
      const isNum =
        typeof c === 'number' ||
        (typeof c === 'object' &&
          c !== null &&
          typeof (c as { re?: unknown }).re === 'number' &&
          typeof (c as { im?: unknown }).im === 'number');
      if (!isNum) return undefined;
      sawNumber = true;
    }
    return sawNumber ? NaN : undefined;
  },
  // Definite integral via deterministic adaptive Gauss–Kronrod (GK15) — near
  // machine precision on smooth integrands, µs-scale. On non-convergence
  // (pathological integrand), fall back to the Monte-Carlo estimator — but only
  // when sampling could actually improve on the quadrature bound
  // (`quadratureBeatsMonteCarlo`): an inner level of an iterated integral pays
  // this fallback once per OUTER node, so 1e7 samples of a stalled-but-accurate
  // result is minutes spent making the answer worse. See `compileIntegrate`.
  integrate: (
    fn: (x: number) => number,
    a: number,
    b: number,
    // Equal panels the adaptive loop starts from. The emitter passes this for
    // an integral whose tree shows nesting: one full inner quadrature runs per
    // outer panel node, so the starting count multiplies across levels and a
    // per-level default of 16 costs 16^depth before any refinement. Omitted for
    // a single integral, which keeps the quadrature default.
    initialPanels?: number,
    // The source of the Monte-Carlo fallback's samples. `makeSysHelpers`
    // binds the compiling engine's live draw — the `entropy` handler of its
    // host capability registry — so a mocked or denied handler applies to
    // compiled code as it does to the interpreter. Absent only when the
    // static object is called directly, outside an engine.
    draw?: () => number
  ) => {
    // Dynamic nesting is bounded by a shared evaluation budget — see
    // `NESTED_QUADRATURE_BUDGET`. A nested entry that finds it gone has no
    // value to report.
    if (!enterIntegral()) return NaN;
    try {
      const f = budgetedIntegrand(realFn(fn));
      // A semi-infinite interval: a conditionally convergent oscillatory
      // integrand (`∫₀^∞ sin x/√x`) is integrated lobe by lobe, as in the
      // interpreter (`integrateRealPart`, library/calculus.ts). The adaptive
      // quadrature gave `NaN` for `∫₀^∞ sin x/√x dx` and `2.5237` for
      // `∫₀^∞ sin x/x^1.5 dx = √(2π) = 2.5066`. The routine returns `null` for
      // an integrand that is not oscillatory or does not converge.
      // Reversed bounds integrate over the ordered interval and negate.
      if (Number.isFinite(a) !== Number.isFinite(b)) {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const osc = Number.isFinite(lo)
          ? integrateSemiInfiniteOscillatory(f, lo)
          : integrateSemiInfiniteOscillatory((t) => f(-t), -hi);
        // An exhausted nested budget: see the same test below.
        if (osc !== null)
          return nestedEvalsLeft < 0
            ? NaN
            : a > b
              ? -osc.estimate
              : osc.estimate;
      }
      // `singularEndpoints`: a slowly integrable singularity at a bound is
      // resolved by extrapolating the endpoint shells, as in the interpreter
      // (`integrateRealPart`, library/calculus.ts).
      const r = adaptiveQuadrature(f, a, b, {
        initialPanels,
        singularEndpoints: true,
      });
      // A diagnosed divergence has no finite value, and sampling it would only
      // launder the divergence into a plausible-looking number.
      if (r.divergent) return NaN;
      // The budget ran out somewhere below this level, so the panels this
      // quadrature accumulated rest on refused evaluations: the estimate is not
      // an estimate of anything. Answer `NaN` directly rather than falling
      // through — the Monte-Carlo fallback would spend 1e7 samples on the same
      // exhausted integrand.
      if (nestedEvalsLeft < 0) return NaN;
      // Next to a singular corner that the quadrature could not resolve
      // (`singularCorner`), the unconverged estimate is returned, as the
      // interpreter does (`integrateRealPart`, library/calculus.ts): Monte
      // Carlo is less accurate there (see `QuadratureResult`,
      // numerics/endpoint-quadrature.ts).
      if (
        r.converged ||
        r.extrapolated === true ||
        r.singularCorner === true ||
        quadratureBeatsMonteCarlo(r, 10e6)
      )
        return r.estimate;
      // A nested integral (inside a compiled integral, `activeIntegrals > 1`,
      // or inside a quadrature of the interpreter, `insideQuadrature()`) has
      // no Monte-Carlo fallback: it would draw 1e7 samples at EACH node of
      // the enclosing quadrature (minutes for `∫₀^10 ∫₃^4 (y − x)⁻² dx dy`,
      // whose inner integral has no value for `y` in `[3, 4]`). The result
      // did not converge and is not better than sampling: it has no value.
      if (activeIntegrals > 1 || insideQuadrature()) return NaN;
      return monteCarloEstimate(f, a, b, 10e6, undefined, draw).estimate;
    } finally {
      activeIntegrals--;
    }
  },
  // Definite integral via Monte-Carlo (1e7 uniform samples). STOCHASTIC and
  // approximate (~1e-4 typical error, ~200 ms/call). Emitted when
  // `quadrature: 'monte-carlo'` is requested — see `compileIntegrate`.
  integrateMC: (
    fn: (x: number) => number,
    a: number,
    b: number,
    // See `integrate`: the engine-bound live draw.
    draw?: () => number
  ) => {
    // Monte Carlo joins the same activation accounting as `integrate`, so that
    // an integral reached from inside THIS one's integrand is nested and pays
    // budget. Without the activation, every sample looked like an outermost
    // entry and re-armed the budget, leaving that composition unbounded.
    // The sample count itself is free at the OUTERMOST level: `budgetedIntegrand`
    // charges an evaluation only while another integral is already running, so a
    // plain Monte-Carlo integral spends none of its 2²⁵ budget on its own 1e7
    // samples — exactly how the deterministic path treats depth. A Monte-Carlo
    // integral running INSIDE another integral does charge per sample, which
    // exhausts the budget within a few calls; that is the intent, since one such
    // level costs 1e7 evaluations of an integrand that is itself a quadrature.
    if (!enterIntegral()) return NaN;
    try {
      const f = budgetedIntegrand(realFn(fn));
      const estimate = monteCarloEstimate(
        f,
        a,
        b,
        10e6,
        undefined,
        draw
      ).estimate;
      // The budget ran out below this level, so an unknown share of the samples
      // were refused rather than evaluated: the mean of what is left is not an
      // estimate of this integral.
      if (nestedEvalsLeft < 0) return NaN;
      return estimate;
    } finally {
      activeIntegrals--;
    }
  },
  // The common multiple of two reals (`realLcm`). An operand beyond the safe
  // integer range, or infinite, throws (`integerOperand`).
  lcm: (a: number, b: number): number =>
    lcm(integerOperand('LCM', a), integerOperand('LCM', b)),
  lngamma: gammaln,
  limit: (f: (x: number) => number, x: number, dir?: number): number =>
    limit(realFn(f), x, dir),
  mean: oneDatumOk(mean),
  median: oneDatumOk(median),
  variance: oneDatumOk(variance),
  populationVariance: oneDatumOk(populationVariance),
  standardDeviation: oneDatumOk(standardDeviation),
  populationStandardDeviation: oneDatumOk(populationStandardDeviation),
  kurtosis: oneDatumOk(kurtosis),
  skewness: oneDatumOk(skewness),
  mode: oneDatumOk(mode),
  // `Quartiles` is the one reducer of the family whose answer is not a
  // scalar, so its absent answer is not the bare `NaN` the others use: the
  // interpreter answers the triple `(NaN, NaN, NaN)` (the `absentAnswer` its
  // `collectData` call passes), which compiles to a three-element array. A
  // fresh array per call — the caller may hold on to it.
  quartiles: oneDatumOk(quartiles, (): [number, number, number] => [
    Number.NaN,
    Number.NaN,
    Number.NaN,
  ]),
  interquartileRange: oneDatumOk(interquartileRange),
  covariance,
  populationCovariance,
  correlation,
  erf,
  erfc,
  erfInv,
  beta,
  gammaQ,
  betaRegularized,
  digamma,
  trigamma,
  polygamma,
  zeta,
  hurwitzZeta,
  zetaGeneralized,
  lerchPhi: lerchPhiReal,
  dirichletEta: dirichletEtaReal,
  dirichletBeta: dirichletBetaReal,
  polyLog: polylogOrderReal,
  stieltjesGamma: stieltjesGammaReal,
  clausen,
  lambertW,
  besselJ,
  besselY,
  besselI,
  besselK,
  airyAi,
  airyBi,
  airyAiPrime,
  airyBiPrime,
  sinc,
  fresnelS,
  fresnelC,
  sinIntegral,
  cosIntegral,
  expIntegralEi,
  logIntegral,
  erfi,
  agm,
  ellipticK,
  ellipticE,
  ellipticEIncomplete,
  ellipticF,
  ellipticPiComplete,
  ellipticPiIncomplete,
  hypergeometric2F1,
  hypergeometric1F1,
  mandelbrot: (c: number | { re: number; im: number }, maxIter: number) => {
    let zx = 0,
      zy = 0;
    const cx = typeof c === 'number' ? c : c.re;
    const cy = typeof c === 'number' ? 0 : c.im;
    const n = Math.round(maxIter);
    for (let i = 0; i < n; i++) {
      const newZx = zx * zx - zy * zy + cx;
      zy = 2 * zx * zy + cy;
      zx = newZx;
      const mag2 = zx * zx + zy * zy;
      if (mag2 > 4) {
        const smooth = (i - Math.log2(Math.log2(mag2)) + 4.0) / n;
        return Math.max(0, Math.min(1, smooth));
      }
    }
    return 1.0;
  },
  julia: (
    z: number | { re: number; im: number },
    c: number | { re: number; im: number },
    maxIter: number
  ) => {
    let zx = typeof z === 'number' ? z : z.re;
    let zy = typeof z === 'number' ? 0 : z.im;
    const cx = typeof c === 'number' ? c : c.re;
    const cy = typeof c === 'number' ? 0 : c.im;
    const n = Math.round(maxIter);
    for (let i = 0; i < n; i++) {
      const newZx = zx * zx - zy * zy + cx;
      zy = 2 * zx * zy + cy;
      zx = newZx;
      const mag2 = zx * zx + zy * zy;
      if (mag2 > 4) {
        const smooth = (i - Math.log2(Math.log2(mag2)) + 4.0) / n;
        return Math.max(0, Math.min(1, smooth));
      }
    }
    return 1.0;
  },
  // Integer-valued on the core domain 0 ≤ k ≤ n and extended like the
  // interpreter's `Binomial` elsewhere: negative and non-integer operands,
  // poles and infinite points (see `binomial()` in
  // `numerics/special-functions.ts`).
  binomial,
  fibonacci,
  // Complex helpers
  csin: (z: ComplexResult) => kernelResult(new Complex(z.re, z.im).sin()),
  ccos: (z: ComplexResult) => kernelResult(new Complex(z.re, z.im).cos()),
  ctan: (z: ComplexResult) => kernelResult(new Complex(z.re, z.im).tan()),
  casin: (z: ComplexResult) =>
    kernelResult(complexAsin(new Complex(z.re, z.im))),
  cacos: (z: ComplexResult) =>
    kernelResult(complexAcos(new Complex(z.re, z.im))),
  // `arctan` and `arccot` have a logarithmic pole at `±i`, where the
  // interpreter answers the unsigned pole `~oo`; the kernels answer
  // `0 ± ∞i`, so the pole is answered here (`isImaginaryUnitPole`).
  catan: (z: ComplexResult) =>
    isImaginaryUnitPole(z)
      ? complexPole()
      : kernelResult(complexAtan(new Complex(z.re, z.im))),
  csinh: (z: ComplexResult) => kernelResult(new Complex(z.re, z.im).sinh()),
  ccosh: (z: ComplexResult) => kernelResult(new Complex(z.re, z.im).cosh()),
  ctanh: (z: ComplexResult) => kernelResult(new Complex(z.re, z.im).tanh()),
  csqrt: (z: ComplexResult) =>
    kernelResult(complexSqrt(new Complex(z.re, z.im))),
  // hav⁻¹(z) = 2·arcsin(√z), continued to the complex plane
  cinvhav: (z: ComplexResult) =>
    kernelResult(complexAsin(complexSqrt(new Complex(z.re, z.im))).mul(2)),
  cexp: (z: ComplexResult) => kernelResult(new Complex(z.re, z.im).exp()),
  cln: (z: ComplexResult) => kernelResult(new Complex(z.re, z.im).log()),
  // The complex sign `z/|z|`: the point of the unit circle in the direction
  // of `z`, and `0` for `0` — the interpreter's `Sign` off the real line. A
  // real value in `{re, im: 0}` form reads its modulus as `Math.abs`
  // (`complexModulus`), so its sign is exactly ±1; otherwise the components
  // are scaled by the larger one first, so a direction near the top of the
  // double range is not lost to an overflowing modulus.
  csign: (z: ComplexResult): ComplexResult => {
    if (Number.isNaN(z.re) || Number.isNaN(z.im)) return { re: NaN, im: NaN };
    if (z.im === 0) {
      const m = complexModulus(z);
      return m === 0 ? { re: 0, im: 0 } : { re: z.re / m, im: 0 };
    }
    const s = Math.max(Math.abs(z.re), Math.abs(z.im));
    const a = z.re / s;
    const b = z.im / s;
    const m = Math.hypot(a, b);
    return { re: a / m, im: b / m };
  },
  // Base-10 and base-2 complex logarithms. The real part is `Math.log10` /
  // `Math.log2` of the MODULUS rather than `ln|z| / ln(b)`: on the real axis
  // the modulus is the argument itself, so this lane, the real lane's
  // `Math.log10(x)` and the interpreter's constant fold agree bit for bit
  // (Tycho item 240). The imaginary part is the argument of `z` rescaled,
  // exactly as `cln(z).im / ln(b)` was. A purely real operand reads its
  // modulus as `Math.abs` — `Math.hypot(x, 0)` is not guaranteed to return
  // `|x|` exactly.
  clog10: (z: ComplexResult) => ({
    re: Math.log10(complexModulus(z)),
    im: Math.atan2(z.im, z.re) / Math.LN10,
  }),
  clog2: (z: ComplexResult) => ({
    re: Math.log2(complexModulus(z)),
    im: Math.atan2(z.im, z.re) / Math.LN2,
  }),
  // A ZERO base is answered here, as the interpreter answers it: `0` for an
  // exponent with a positive real part, the unsigned pole `~oo` for a
  // negative real exponent (`0⁻²`), and `NaN` otherwise (`0⁰`, `0ⁱ`,
  // `0⁻¹⁺ⁱ`). The complex library answers `−∞` for `0⁻²`, `−∞·i` for `0⁻¹`,
  // `NaN` for `0^(−1/2)` and `1` for `0⁰`.
  //
  // A NEGATIVE real base with a real exponent that is not an integer has
  // the real root the interpreter answers when the exponent is a rational
  // `p/q` with an odd `q`, recovered from the double as the interpreter
  // recovers it (`negativeBaseRealPow()`): `(−8)^0.3333333333333333` is
  // `−2`, as in the interpreter at machine precision, and `(−8)^0.4` is
  // `2.297`. Any other pair takes the principal value (`complexPow()`), which has an exact zero part where the
  // value has one and keeps a small part that is the value.
  cpow: (z: number | ComplexResult, w: number | ComplexResult) => {
    const zz =
      typeof z === 'number' ? new Complex(z, 0) : new Complex(z.re, z.im);
    const ww =
      typeof w === 'number' ? new Complex(w, 0) : new Complex(w.re, w.im);
    if (zz.re === 0 && zz.im === 0) {
      if (ww.re > 0) return { re: 0, im: 0 };
      if (ww.re < 0 && ww.im === 0) return complexPole();
      return { re: NaN, im: NaN };
    }
    if (zz.im === 0 && ww.im === 0) {
      const r = negativeBaseRealPow(zz.re, null, ww.re);
      if (r !== undefined) return { re: r, im: 0 };
    }
    return kernelResult(complexPow(zz, ww));
  },
  // `Root(z, n)` over a complex-lane radicand or degree. A radicand whose
  // imaginary part is exactly zero, under an odd integer degree, has the REAL
  // root the interpreter answers (`Root(-8, 3)` is `-2`, not the principal
  // value `1 + 1.732i`); the real lane computes it the same way. Any other
  // pair takes the principal value `z^(1/n)`, as the interpreter does
  // (`Root(0.5 + 0.25i, 3)` is `0.8140 + 0.1268i`).
  croot: (
    z: number | ComplexResult,
    n: number | ComplexResult
  ): ComplexResult => {
    const zz = typeof z === 'number' ? { re: z, im: 0 } : z;
    const nn = typeof n === 'number' ? { re: n, im: 0 } : n;
    if (
      zz.im === 0 &&
      nn.im === 0 &&
      Number.isInteger(nn.re) &&
      nn.re % 2 !== 0
    )
      return {
        re:
          nn.re === 3
            ? Math.cbrt(zz.re)
            : Math.sign(zz.re) * Math.pow(Math.abs(zz.re), 1 / nn.re),
        im: 0,
      };
    return SYS_HELPERS.cpow(zz, cxDiv({ re: 1, im: 0 }, nn));
  },
  // The reciprocal kernels have a pole at zero, where the complex library
  // answers `NaN`. The interpreter answers the two-sided pole `~oo` for
  // `cot 0`, `csc 0`, `coth 0` and `csch 0` (`hyperbolicExactValue`,
  // `boxed-expression/trigonometry.ts`), so the compiled lane does too.
  ccot: (z: ComplexResult) =>
    isComplexZero(z)
      ? complexPole()
      : kernelResult(new Complex(z.re, z.im).cot()),
  csec: (z: ComplexResult) => kernelResult(new Complex(z.re, z.im).sec()),
  ccsc: (z: ComplexResult) =>
    isComplexZero(z)
      ? complexPole()
      : kernelResult(new Complex(z.re, z.im).csc()),
  ccoth: (z: ComplexResult) =>
    isComplexZero(z)
      ? complexPole()
      : kernelResult(new Complex(z.re, z.im).coth()),
  csech: (z: ComplexResult) => kernelResult(new Complex(z.re, z.im).sech()),
  ccsch: (z: ComplexResult) =>
    isComplexZero(z)
      ? complexPole()
      : kernelResult(new Complex(z.re, z.im).csch()),
  cacot: (z: ComplexResult) =>
    isImaginaryUnitPole(z)
      ? complexPole()
      : kernelResult(complexAcot(new Complex(z.re, z.im))),
  // `arcsec 0` and `arccsc 0` are `NaN` in the interpreter, and `arsech 0` is
  // `+∞`. The complex library answers a value with an infinite imaginary
  // part for each, which reads as the unsigned pole.
  casec: (z: ComplexResult) =>
    isComplexZero(z)
      ? { re: NaN, im: NaN }
      : kernelResult(complexAsec(new Complex(z.re, z.im))),
  cacsc: (z: ComplexResult) =>
    isComplexZero(z)
      ? { re: NaN, im: NaN }
      : kernelResult(complexAcsc(new Complex(z.re, z.im))),
  cacoth: (z: ComplexResult) =>
    kernelResult(complexAcoth(new Complex(z.re, z.im))),
  casech: (z: ComplexResult) =>
    isComplexZero(z)
      ? { re: Infinity, im: 0 }
      : kernelResult(complexAsech(new Complex(z.re, z.im))),
  cacsch: (z: ComplexResult) =>
    kernelResult(complexAcsch(new Complex(z.re, z.im))),
  cacosh: (z: ComplexResult) =>
    kernelResult(complexAcosh(new Complex(z.re, z.im))),
  catanh: (z: ComplexResult) =>
    kernelResult(complexAtanh(new Complex(z.re, z.im))),
  casinh: (z: ComplexResult) =>
    kernelResult(complexAsinh(new Complex(z.re, z.im))),
  // A value with an infinite part has an infinite absolute value: the
  // unsigned pole `{ re: ∞, im: ∞ }` (see `complexPole`) and a signed infinity
  // alike, as the interpreter answers (`|~oo|` is `+∞`). The complex library
  // answers `NaN` for the pole.
  cabs: (z: ComplexResult) =>
    Math.abs(z.re) === Infinity || Math.abs(z.im) === Infinity
      ? Infinity
      : new Complex(z.re, z.im).abs(),
  // `Abs` of an operand whose type allows a string or a set (see
  // `absOperandMayBeCardinality`): the absolute value of a number or of a
  // complex number, and `NaN` for an absent value (`undefined`), as
  // `Math.abs` answers. Any other value throws. The interpreter computes
  // `|x|` of a string or a set as its number of elements, and `Abs` of a list
  // as the absolute value of each element; this compiled code computes
  // neither, so it fails instead of answering `NaN`.
  absAny: (x: unknown): number => {
    if (typeof x === 'number') return Math.abs(x);
    if (x === undefined || x === null) return NaN;
    if (typeof x === 'object' && 're' in x && 'im' in x)
      return SYS_HELPERS.cabs(x as ComplexResult);
    throw new TypeError(
      `Abs: the compiled code computes the absolute value of a number, and the operand is ${describeRuntimeValue(x)}. The interpreter computes |x| of a string or a set as its number of elements.`
    );
  },
  // The unsigned pole has no direction: its argument is `NaN`, as in the
  // interpreter, where `atan2(∞, ∞)` would answer `π/4`.
  carg: (z: ComplexResult) =>
    isUnsignedPole(z) ? NaN : new Complex(z.re, z.im).arg(),
  // Ring operation, not a kernel: no roundoff chop (see `kernelResult`).
  cconj: (z: ComplexResult) => ({ re: z.re, im: -z.im }),
  cneg: (z: ComplexResult) => ({ re: -z.re, im: -z.im }),
  // Color helpers
  ...colorHelpers,
};

/**
 * A compiled random domain, built (and validated) at RUN time by the
 * `_SYS.domain*` builders. `continuous` is an `Interval`; everything else is
 * an indexed domain of `n` elements addressed by a 0-based `at`.
 */
export type RandomDomainDescriptor =
  | { continuous: true; lo: number; hi: number }
  | { continuous: false; n: number; at: (i: number) => unknown };

/** The engine-bound half of the `_SYS` bundle: the random family. */
export type RandomSysHelpers = {
  drawNextRandomNumber: () => number;
  withRandomSeed: <T>(seed: unknown, body: () => T) => T;
  domainInterval: (
    op: string,
    lo: number,
    hi: number
  ) => RandomDomainDescriptor;
  domainRange: (
    op: string,
    a: number,
    b: number,
    s?: number
  ) => RandomDomainDescriptor;
  domainList: (op: string, xs: unknown) => RandomDomainDescriptor;
  randomPick: (d: RandomDomainDescriptor) => unknown;
  randomChoice: (d: RandomDomainDescriptor, k: unknown) => unknown[];
  randomSample: (d: RandomDomainDescriptor, k: unknown) => unknown[];
  shuffle: (xs: unknown[]) => unknown[];
};

/** The `_SYS` bundle injected into a compiled JavaScript function. */
export type LazyStreamSysHelpers = {
  filterIter: (
    it: Iterable<unknown>,
    p: (x: unknown) => unknown
  ) => Generator<unknown>;
  dropIter: (it: Iterable<unknown>, n: number) => Generator<unknown>;
  takeIter: (it: Iterable<unknown>, n: number) => unknown[];
  takeWhileIter: (
    it: Iterable<unknown>,
    p: (x: unknown) => unknown
  ) => unknown[];
  listRecursion: (
    op: string,
    args: unknown[],
    step: (...args: unknown[]) => unknown
  ) => unknown;
};

export type SysHelpers = typeof SYS_HELPERS &
  RandomSysHelpers &
  LazyStreamSysHelpers;

/**
 * The state the engine-bound helpers of `_SYS` read each time they run, never
 * when the code is compiled. The engine passes its own (`ce._liveRandom`,
 * `ce._randomFrame`, `ce.iterationLimit`, `ce._deadlineFrame`);
 * `createJavaScriptRuntime` builds one from plain options. This module imports
 * no engine code, so that a host can run compiled code without the engine.
 */
export type RuntimeSource = {
  /** A live uniform in [0, 1), used outside any `WithRandomSeed` frame and by
   * the integrals' Monte-Carlo draws. Throws when draws are denied. */
  random: () => number;
  /** The next draw, framed or live. Absent: a draw of the active frame
   * (`nextFrameDraw`), or `random()` when there is none. The engine passes
   * `ce._random()`, which does the same, so that an engine whose `_random` is
   * wrapped sees every draw. */
  draw?: () => number;
  /** The innermost active `WithRandomSeed` frame, if any. */
  frame: () => RandomSeedFrame | undefined;
  /** Install (or, with `undefined`, clear) the active frame. */
  setFrame: (frame: RandomSeedFrame | undefined) => void;
  /** The cap on the walks of the lazy-stream helpers. */
  iterationLimit: () => number;
  /** The deadline the shuffle/choice loops check, if any. */
  deadline: () => DeadlineFrame | number | undefined;
};

/**
 * The random family of `_SYS`, bound to a `RuntimeSource`.
 *
 * The binding is a SOURCE, not a frame handle: there is exactly one
 * `WithRandomSeed` frame stack per source (for the engine, the engine's), and
 * both the interpreter and compiled code reach it through it. So a compiled function called
 * from inside an interpreted frame draws from that frame (dynamic scoping
 * across the compile boundary), two engines never share frames, and a call
 * made outside any evaluation sees an empty stack and draws live.
 *
 * Compiled code cannot raise the interpreter's structured errors, so every
 * validation failure here is a plain `Error` naming the operator — never a
 * silent `NaN` or a reversed draw.
 *
 * Every draw goes through `draw()`, the SAME primitive the interpreter
 * uses, so interpreted/compiled parity for framed draws is by construction
 * rather than by two implementations kept in agreement. Draw ORDER and COUNT
 * are equally load-bearing (the frame's counter is shared), so each loop below
 * mirrors its interpreted counterpart step for step.
 */
export function makeRandomHelpers(source: RuntimeSource): RandomSysHelpers {
  const cap = MAX_RANDOM_ELEMENT_COUNT;
  const draw =
    source.draw ??
    ((): number => {
      const frame = source.frame();
      return frame !== undefined ? nextFrameDraw(frame) : source.random();
    });

  /** The `k` operand, rounded and validated — the compiled half of
   * `randomCount` (`library/random-utils.ts`). `toInteger` rounds half toward
   * `+∞`, which is what `Math.round` does. */
  const count = (op: string, k: unknown): number => {
    const v = typeof k === 'number' ? Math.round(k) : NaN;
    if (!Number.isSafeInteger(v) || v < 0 || v > cap)
      throw new Error(
        `Could not compile \`${op}\`: expected a count in 0..${cap}, got ${k}`
      );
    return v;
  };

  /** The uniform-driven element of an indexed descriptor. */
  const pick = (d: RandomDomainDescriptor, u: number): unknown =>
    d.continuous ? d.lo + u * (d.hi - d.lo) : d.at(Math.floor(u * d.n));

  return {
    // The one primitive, branching at CALL time: innermost frame →
    // `hash(seed, n)` and advance; no frame → the live source.
    drawNextRandomNumber: draw,

    withRandomSeed: <T>(seed: unknown, body: () => T): T => {
      if (
        (typeof seed !== 'number' || !Number.isFinite(seed)) &&
        typeof seed !== 'string'
      )
        throw new Error(
          `Could not compile \`WithRandomSeed\`: expected a finite real number or a string seed, got ${String(seed)}`
        );
      return withSeedFrame(
        seed as number | string,
        source.frame,
        source.setFrame,
        body
      );
    },

    domainInterval: (op, lo, hi) => {
      if (!Number.isFinite(lo) || !Number.isFinite(hi))
        throw new Error(
          `Could not compile \`${op}\`: expected a bounded Interval, got (${lo}, ${hi})`
        );
      if (!(hi > lo))
        throw new Error(
          `Could not compile \`${op}\`: expected a non-empty Interval, got (${lo}, ${hi})`
        );
      return { continuous: true, lo, hi };
    },

    domainRange: (op, a, b, s) => {
      // The normalization of `range()` + the `Range` handler's `count`
      // (`library/collections.ts`): a two-operand range descends when
      // `b < a`, and a zero or sign-mismatched step is empty.
      const step = s === undefined ? (b >= a ? 1 : -1) : s;
      const n = rangeCount(a, b, step);
      if (!Number.isFinite(n) || n <= 0)
        throw new Error(
          `Could not compile \`${op}\`: expected a finite, non-empty Range, got Range(${a}, ${b}, ${step})`
        );
      return { continuous: false, n, at: (i) => a + step * i };
    },

    domainList: (op, xs) => {
      if (!Array.isArray(xs))
        throw new Error(
          `Could not compile \`${op}\`: expected a finite indexed collection`
        );
      if (xs.length === 0)
        throw new Error(
          `Could not compile \`${op}\`: expected a non-empty collection`
        );
      return { continuous: false, n: xs.length, at: (i) => xs[i] };
    },

    // `Random(domain)` — exactly ONE draw, for every domain kind.
    randomPick: (d) => pick(d, draw()),

    // `RandomChoice(domain, k)` — exactly `k` draws, WITH replacement, in
    // output order.
    randomChoice: (d, k) => {
      const n = count('RandomChoice', k);
      const out: unknown[] = new Array(n);
      for (let i = 0; i < n; i++) {
        if ((i & 0x3ff) === 0) checkDeadline(source.deadline());
        out[i] = pick(d, draw());
      }
      return out;
    },

    // `RandomSample(domain, k)` — exactly `k` draws, WITHOUT replacement, by
    // the same SPARSE Fisher-Yates over the index space as the interpreter
    // (`library/statistics.ts`): only the touched positions are held, so
    // `RandomSample(Range(1, 10^6), 3)` never materializes the domain.
    randomSample: (d, k) => {
      if (d.continuous)
        throw new Error(
          `Could not compile \`RandomSample\`: an Interval is not an indexed collection`
        );
      const n = count('RandomSample', k);
      // Unlike `RandomChoice`, `k` may not exceed the domain size.
      if (n > d.n)
        throw new Error(
          `Could not compile \`RandomSample\`: expected a count in 0..${d.n}, got ${n}`
        );
      const swapped = new Map<number, number>();
      const at = (i: number): number => swapped.get(i) ?? i;
      const out: unknown[] = new Array(n);
      for (let i = 0; i < n; i++) {
        if ((i & 0x3ff) === 0) checkDeadline(source.deadline());
        const j = i + Math.floor(draw() * (d.n - i));
        const vi = at(i);
        const vj = at(j);
        swapped.set(i, vj);
        swapped.set(j, vi);
        out[i] = d.at(vj);
      }
      return out;
    },

    // `RandomShuffle(xs)` — unbiased Fisher-Yates on a copy, consuming
    // exactly `n − 1` draws in the interpreter's order and direction
    // (`library/collections.ts`).
    shuffle: (xs: unknown[]): unknown[] => {
      if (xs.length > cap)
        throw new Error(
          `Could not compile \`RandomShuffle\`: expected a collection of at most ${cap} elements`
        );
      const l = xs.slice();
      for (let i = l.length - 1; i > 0; i--) {
        if ((i & 0x3ff) === 0) checkDeadline(source.deadline());
        const j = Math.floor(draw() * (i + 1));
        [l[i], l[j]] = [l[j], l[i]];
      }
      return l;
    },
  };
}

/**
 * The four SCANNING lazy-stream helpers, bound to a `RuntimeSource` so each
 * source walk is capped at its `iterationLimit()` (read at call time, so later
 * assignments apply; the engine's is `ce.iterationLimit`). The interpreter enforces the same
 * guard on the corresponding walks — the `Filter`/`TakeWhile` iterators in
 * `library/collections.ts` throw `iteration-limit-exceeded` — and without it
 * a predicate that never matches on an infinite source
 * (`Take(Filter(1..∞, x → False), 1)`) would lock the caller's thread.
 * `rangeIter`/`mapIter` need no cap of their own: they advance exactly one
 * step per pull, and every pull chain terminates in one of these capped
 * scanners (only `takeIter`/`takeWhileIter` materialize).
 */
export function makeLazyStreamHelpers(
  source: RuntimeSource
): LazyStreamSysHelpers {
  // The interpreter's integer-count contract (`toInteger`,
  // `boxed-expression/numerics.ts`): round to the nearest integer; a
  // non-finite count, or one outside the safe-integer range (|n| > 2^53), does
  // NOT resolve. An unresolved count is a PRESENT-but-invalid parameter, which
  // the interpreter's collection handlers route to their indeterminate
  // channel — an EMPTY walk (`integerParam`, `library/collections.ts`) — never
  // to a substituted default. So `Take(1..∞, NaN)` is `[]` because the walk is
  // indeterminate, `Drop(1..∞, NaN)` under a `Take` contributes NO elements
  // (not "drops nothing"), and a count like `1e100` yields the empty walk
  // instead of a loop that can never finish over an infinite source.
  const intCount = (n: number): number | null => {
    if (!Number.isFinite(n)) return null;
    const k = Math.round(n);
    return Number.isSafeInteger(k) ? k : null;
  };
  const exceeded = (op: string): Error =>
    new Error(
      `Iteration limit of ${source.iterationLimit()} exceeded while evaluating ${op}()`
    );
  const negativeCountOverStream = (op: string): Error =>
    new Error(
      `${op}(): a negative count counts from the end, and an infinite collection has no end`
    );
  // Which helpers get the iteration cap, and what it counts.
  //
  // The cap exists to turn a walk that can NEVER FINISH into the interpreter's
  // iteration-limit error instead of a hang. That danger is a property of the
  // helper, not of the source being infinite, and it comes in two shapes:
  //
  //  - A helper that can spin WITHOUT EMITTING. `filterIter` advances its
  //    source until the predicate matches, so an infinite source with a
  //    predicate that never matches loops inside `filterIter` forever. Capped
  //    — but on pulls SINCE THE LAST YIELD, not on pulls in total: a filter
  //    that keeps yielding has proved it is not stuck, and is bounded by
  //    whatever consumes it. Counting productive pulls made
  //    `Take(Filter(1..∞, _ > 0), 1025)` throw at the default limit of 1024
  //    for a walk that rejects nothing.
  //  - A helper that MATERIALIZES an unbounded result. `takeWhileIter` builds
  //    an array and stops only when the predicate turns false, so a predicate
  //    that never does yields forever into memory. Nothing else bounds it —
  //    unlike `takeIter` it has no count — so it is capped on TOTAL pulls, and
  //    that total is what limits the size of the result it returns.
  //  - `takeIter` pulls at most `k` elements, and `dropIter` skips exactly `k`
  //    before yielding. `k` is a resolved SAFE INTEGER (`intCount` above has
  //    already rejected non-finite and out-of-range counts, which return the
  //    empty walk), so both loops provably terminate. NOT capped: `k` is the
  //    caller's explicit, finite request, and the interpreter honours it in
  //    full — `Sum(Take(Map(_ ↦ _², 1..∞), 100000))` answers 333338333350000
  //    there, where a capped `takeIter` threw at the default limit of 1024,
  //    and `Take(Drop(1..∞, 2000), 3)` answers [2001, 2002, 2003] where a
  //    capped `dropIter` threw. An unbounded stage UPSTREAM of either still
  //    fails as it should, because that stage carries its own cap.
  return {
    // Predicate TRUTHINESS, matching the eager `Filter` lowering
    // (`.filter((_x) => _f(_x))`).
    filterIter: function* (it, p) {
      // Counted since the last element was YIELDED, not in total — see the
      // note above `intCount`. Only an unbroken run of rejections is a walk
      // that can never finish; a filter that keeps yielding is bounded by its
      // consumer, and counting its productive pulls made
      // `Take(Filter(1..∞, _ > 0), 1025)` throw at the default limit of 1024
      // for a walk that rejects nothing. Mirrors the interpreter's `Filter`
      // iterator (`library/collections.ts`).
      let sinceYield = 0;
      for (const x of it) {
        if (p(x)) {
          sinceYield = 0;
          yield x;
        } else if (++sinceYield > source.iterationLimit())
          throw exceeded('Filter');
      }
    },
    // A negative count drops the LAST elements, and an infinite stream has
    // no last elements: the interpreter leaves `Drop(1..∞, -2)` unevaluated,
    // and here such a count throws instead of yielding a wrong walk. (A
    // constant negative count never reaches this helper: the compiler does
    // not lower that pipeline as a stream.)
    dropIter: function* (it, n) {
      const k = intCount(n);
      if (k === null) return;
      if (k < 0) throw negativeCountOverStream('Drop');
      let dropped = 0;
      for (const x of it) {
        if (dropped < k) {
          dropped++;
          continue;
        }
        yield x;
      }
    },
    // Materialize the first k elements of a (possibly infinite) stream — one
    // of the two points where a lazy pipeline becomes an array. An invalid
    // count yields []. A negative count takes the LAST elements, which an
    // infinite stream does not have, so it throws (the interpreter leaves
    // `Take(1..∞, -2)` unevaluated).
    takeIter: (it, n) => {
      const k = intCount(n);
      if (k === null || k === 0) return [];
      if (k < 0) throw negativeCountOverStream('Take');
      const out: unknown[] = [];
      for (const x of it) {
        out.push(x);
        if (out.length >= k) break;
      }
      return out;
    },
    // Longest satisfying prefix of a (possibly infinite) stream. A predicate
    // that never turns false does not produce a prefix; the iteration cap
    // turns that into the interpreter's iteration-limit error instead of a
    // hang.
    takeWhileIter: (it, p) => {
      const out: unknown[] = [];
      let pulls = 0;
      for (const x of it) {
        if (++pulls > source.iterationLimit()) throw exceeded('TakeWhile');
        if (!p(x)) break;
        out.push(x);
      }
      return out;
    },
    // The run-time loop behind a list-building user-defined recursion
    // (`BaseCompiler.emitFunctionLiteralDefinition` emits the call). `step` is
    // the function's own `Which` with each arm rewritten to report what it
    // does instead of doing it: `[0, list]` for an arm that returns a list,
    // `[1, list, nextArgs]` for an arm that prepends a list to a direct
    // self-call. Prefix lists are collected and concatenated once at the
    // end, so neither the JavaScript call stack nor the amount of copying
    // grows with the length of the result — the natively recursive form
    // overflows the stack near 5,000 levels. The interpreter runs the same
    // loop (`evaluateListRecursion`, `boxed-expression/recursive-list-
    // builder.ts`) under the same cap, so a definition with no reachable base
    // case reports the iteration-limit error on both routes instead of
    // spinning. When no arm matches, `step` returns `undefined` like the
    // original `Which`; at depth zero that is the result, and deeper the
    // spread throws the same `TypeError` the original nested spread threw.
    listRecursion: (op, args, step) => {
      const chunks: unknown[][] = [];
      let current = args;
      let iterations = 0;
      for (;;) {
        if (++iterations > source.iterationLimit()) throw exceeded(op);
        const result = step(...current) as unknown[] | undefined;
        if (!Array.isArray(result)) {
          if (chunks.length === 0) return result;
          return [...chunks.flat(1), ...(result as unknown as unknown[])];
        }
        chunks.push(result[1] as unknown[]);
        if (result[0] === 0) return chunks.flat(1);
        current = result[2] as unknown[];
      }
    },
  };
}

/**
 * Build the `_SYS` bundle for ONE compiled function.
 *
 * The stateless helpers are shared through the prototype chain (no per-compile
 * copying); the random and lazy-stream families get own bindings over
 * `source`, so `_SYS.drawNextRandomNumber()` resolves the active
 * `WithRandomSeed` frame at call time.
 */
export function makeSysHelpers(source: RuntimeSource): SysHelpers {
  const sys = Object.create(SYS_HELPERS) as SysHelpers;
  Object.assign(sys, makeRandomHelpers(source), makeLazyStreamHelpers(source));
  // The integrals' Monte-Carlo samples come from the live source, never from
  // `Math.random` directly: a host that mocks or denies it must see compiled
  // code follow. The draw is live inside a `WithRandomSeed` frame too —
  // compiled integrals sample live by ruling (`docs/RANDOMNESS-MODEL.md`).
  const draw = (): number => source.random();
  sys.integrate = (fn, a, b, initialPanels) =>
    SYS_HELPERS.integrate(fn, a, b, initialPanels, draw);
  sys.integrateMC = (fn, a, b) => SYS_HELPERS.integrateMC(fn, a, b, draw);
  return sys;
}

export const isComplexObject = (v: unknown): v is ComplexResult =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as ComplexResult).re === 'number' &&
  typeof (v as ComplexResult).im === 'number';

/**
 * Whether a `{re, im}`-shaped value is the interpreter's UNSIGNED pole `~oo`
 * (`ComplexInfinity`) rather than a genuine complex number. The interpreter
 * carries `~oo` as a complex value with an infinite part and a NON-ZERO
 * imaginary part — `ComplexInfinity` itself reads `{re: ∞, im: ∞}`, and any
 * complex it builds with an infinite part collapses to `~oo` as well
 * (`Complex(3, ∞)` types `~oo`). A signed real infinity keeps `im === 0` and
 * so is not matched here; neither is a finite complex such as `3 + 4i`.
 *
 * This mirrors the `isInfinity && im !== 0` test the compiler already uses to
 * recognize `~oo` when it FOLDS a constant subtree (`tryConstantFold` in
 * base-compiler.ts), so the two routes agree on what counts as a pole.
 */
export const isUnsignedPole = (v: ComplexResult): boolean =>
  v.im !== 0 &&
  (v.re === Infinity ||
    v.re === -Infinity ||
    v.im === Infinity ||
    v.im === -Infinity);

/**
 * The brands (`Object.prototype.toString` tags) of the typed arrays whose
 * elements read as JavaScript numbers. A `DataView` is not listed (it has no
 * indexed elements at all) and neither are the two `BigInt` views (their
 * elements read as `bigint`, which the compiled arithmetic cannot mix with
 * numbers).
 */
const NUMERIC_TYPED_ARRAY_BRANDS = new Set([
  '[object Int8Array]',
  '[object Uint8Array]',
  '[object Uint8ClampedArray]',
  '[object Int16Array]',
  '[object Uint16Array]',
  '[object Int32Array]',
  '[object Uint32Array]',
  '[object Float16Array]',
  '[object Float32Array]',
  '[object Float64Array]',
]);

/**
 * Whether `v` is a typed array of NUMBERS — a view on an `ArrayBuffer` whose
 * elements read as JavaScript numbers. The test is the object's brand, not
 * `instanceof`: a view built in another realm (an iframe, a Node `vm`
 * context) has a different constructor, so `instanceof DataView` would let
 * a foreign `DataView` or `BigInt64Array` through as numeric.
 */
export const isNumericTypedArray = (v: unknown): v is ArrayLike<number> =>
  ArrayBuffer.isView(v) &&
  NUMERIC_TYPED_ARRAY_BRANDS.has(Object.prototype.toString.call(v));

/**
 * A fresh plain `Array` holding the elements of a numeric typed array.
 *
 * The copy is an index loop on purpose: `Array.from` on a typed array goes
 * through the iterator protocol, and on a 40 000-element `Float64Array` it
 * measured about nine times slower than this loop.
 */
export function copyToPlainArray(x: ArrayLike<number>): number[] {
  const n = x.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = x[i];
  return out;
}

/**
 * The D3 ENTRY CHECK of a compiled JavaScript runner (design §8 D3,
 * `docs/COMPILATION-MODEL.md`): the one runtime input the
 * static analysis cannot see is the value a caller binds at `run()` time, so
 * each free symbol (expression route) or positional parameter (lambda route)
 * is checked against the SHAPE the compilation analyzed it as:
 *
 * - analyzed REAL: a `{re, im}` object THROWS a `TypeError` naming the symbol
 *   — the compiled code reads it as a number, and every arithmetic on it
 *   would be silently wrong (`NaN`, or `"[object Object]1"` under `+`). The
 *   one exception is the unsigned pole `~oo`, which is PROJECTED to
 *   `Infinity` instead of throwing (see `isUnsignedPole` below);
 * - analyzed COMPLEX (a `complex`-typed symbol or annotated parameter): a
 *   plain number is LIFTED to `{re, im: 0}` — a real IS a complex, and the
 *   compiled code reads `.re`/`.im` off it;
 * - analyzed as a LIST (a binding whose declared type proves a JS array): a
 *   plain `Array` passes as it is, with no copy, and a numeric typed array
 *   (`Float64Array`, `Int32Array`, ...) is COPIED into a fresh plain `Array`,
 *   because the compiled body reads plain arrays only. Any other value passes
 *   UNTOUCHED and the lowerings dispatch on its runtime shape, as before: a
 *   scalar there is not an error, because the declared type is routinely wider
 *   than the value a caller binds and several lowerings project on the runtime
 *   shape. The element-wise big-operator lane is the witness — a `list`-typed
 *   summand bound to a number gives the scalar sum, not `NaN` (see
 *   `test/compute-engine/compile-elementwise-bigop.test.ts`). Carrier contract:
 *   `docs/plans/2026-09-07-numeric-list-store-and-typed-array-boundary.md`;
 * - analyzed as a collection whose ENTRIES are read on the real lane (a
 *   declared type with a collection member and no complex leaf, in `strict`
 *   or `auto` mode, or a type that proves every entry real, in any mode —
 *   `BaseCompiler.realLaneEntryCheck`): when the value is a plain `Array`,
 *   every entry is visited, through nested arrays, and a `{re, im}` entry
 *   THROWS a `TypeError` that names the binding and the entry. When the type
 *   proves every entry a number, any other entry that is not a number (a
 *   string, `null`) throws too, except `undefined`, an absent cell. The linear-algebra heads read a
 *   `matrix<number>` operand as real in these modes, and would otherwise
 *   give `NaN` or a wrong number for a complex entry;
 * - declared with a collection type that the compiled code reads as a
 *   JavaScript array, and whose elements are not text (`strings`, built by
 *   `stringRefusedEntryType` in `javascript-target.ts`): a string THROWS a
 *   `TypeError` that names the binding. The engine reads a string as an
 *   indexed collection of grapheme clusters, so a bare `indexed_collection`
 *   or `collection` type admits one, but the compiled code would read it as
 *   an array of UTF-16 code units: `Length` of `"😀a"` would be 3, not 2;
 * - anything else (a string for any other binding, a boolean, an array,
 *   `undefined`) is left to today's behavior.
 *
 * One `typeof` per checked binding per call, plus one per entry of each
 * collection whose entries are checked. The vars object is never mutated (a
 * lifted copy is built only when a lift or a typed-array copy is needed).
 */
export type EntryPlan =
  | {
      kind: 'vars';
      real: string[];
      complex: string[];
      lists: string[];
      entries: Map<string, RealEntryCheck>;
      strings: Map<string, string>;
    }
  | {
      kind: 'args';
      real: number[];
      complex: number[];
      lists: number[];
      entries: Map<number, RealEntryCheck>;
      strings: Map<number, string>;
    };

/**
 * Throw when the binding `key` is in `strings`, the bindings of an entry plan
 * that refuse a string. The caller has already found that the value of the
 * binding is a string, so a binding that is not a string costs no map read.
 * The value of `strings` is the label of the binding and its declared type,
 * as the diagnostic shows them.
 */
function refuseStringEntry<K>(strings: Map<K, string>, key: K): void {
  const label = strings.get(key);
  if (label === undefined) return;
  throw new TypeError(
    `${label} is compiled as a JavaScript array, and compiled code does not accept a string for it: it would read the string as UTF-16 code units, not as characters. Pass an array, or declare the binding \`string\` to compile text.`
  );
}

/**
 * The entry check of one collection-valued binding read on the real lane,
 * keyed in `EntryPlan.entries` by the name of the free symbol or the index
 * of the parameter: `numbers` is whether every entry must be a number
 * (otherwise only a `{re, im}` entry is refused), and `label` the binding
 * and its declared type as the diagnostic shows them. Every key of
 * `entries` is also in `real`, `complex` or `lists`, and the check runs in
 * that loop, on the value it has read: the vars object is read once per
 * binding (a getter on it runs once).
 */
export type RealEntryCheck = { numbers: boolean; depth: number; label: string };

/**
 * Run the entry check `check` of a binding on its value `x`, when `x` is a
 * plain array, and return the value the compiled code reads: `x` itself, or,
 * when an entry of `x` at any depth is a numeric typed array (a
 * `Float64Array` row of a matrix), a copy of `x` in which each such typed
 * array is replaced by a plain `Array`. The compiled code reads plain arrays
 * only: the `det` helper, for one, answers `NaN` for a typed-array row. A
 * top-level typed array is not an `Array` and is returned unchanged; the
 * list rule of `checkEntry` copies it.
 */
function checkBindingEntries(
  check: RealEntryCheck | undefined,
  x: unknown
): unknown {
  if (check === undefined || !Array.isArray(x)) return x;
  sawTypedArrayEntry = false;
  checkRealEntries(x, check.numbers, check.depth, check.label);
  return sawTypedArrayEntry ? copyNestedTypedArrays(x) : x;
}

/**
 * Set by `realEntryAdmitted` when it admits a numeric typed array as an
 * entry, and reset by `checkBindingEntries` before each walk. A flag, and
 * not a return value of the walk, so that the walk of an array of numbers
 * (the common case) does no extra work.
 */
let sawTypedArrayEntry = false;

/** A copy of the array `x` in which each numeric typed array, at any depth,
 * is a plain `Array`. A hole of `x` stays a hole. */
function copyNestedTypedArrays(x: unknown[]): unknown[] {
  return x.map((e) =>
    Array.isArray(e)
      ? copyNestedTypedArrays(e)
      : isNumericTypedArray(e)
        ? copyToPlainArray(e)
        : e
  );
}

/**
 * Throw when an entry of the array `x`, at any depth, is a `{re, im}` object
 * or, when `numbers` is set, anything that is not a number or `undefined`
 * (`realEntryAdmitted`). `label` names the binding. The walk goes into an
 * array at ANY depth and never refuses one: a declared type constrains what
 * the engine assigns, not what a caller supplies, and a caller may pass a
 * matrix where a point was declared (the compiled code then hands the value
 * to the run-time helper, which reads its rank; pinned in
 * `compile-static-point-components.test.ts`). `depth` is kept for the
 * diagnostic path only.
 *
 * The walk is split in two functions that call each other, one for the
 * arrays at an even depth and one for the arrays at an odd depth, so that
 * the element read of each function sees one kind of array in a vector or a
 * matrix: the outer array of a matrix holds arrays, and its rows hold
 * numbers. A single recursive function that read both kinds made the `det`
 * helper that ran next on the same matrix more than twice as slow (100×100:
 * 320 → 720 µs, measured 2026-09-24 on Node, reproducible in a separate
 * process), while this form leaves it at 320 µs and walks the matrix in
 * about 1.4 µs. The entry path of the diagnostic is found by a second walk
 * (`realEntryError`), only when the check fails.
 */
function checkRealEntries(
  x: unknown[],
  numbers: boolean,
  depth: number,
  label: string
): void {
  if (!realEntriesEven(x, numbers, depth))
    throw realEntryError(x, numbers, depth, label);
}

function realEntriesEven(
  x: unknown[],
  numbers: boolean,
  depth: number
): boolean {
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const e = x[i];
    if (typeof e === 'number') continue;
    if (Array.isArray(e)) {
      if (!realEntriesOdd(e, numbers, depth - 1)) return false;
    } else if (!realEntryAdmitted(e, numbers)) return false;
  }
  return true;
}

function realEntriesOdd(
  x: unknown[],
  numbers: boolean,
  depth: number
): boolean {
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const e = x[i];
    if (typeof e === 'number') continue;
    if (Array.isArray(e)) {
      if (!realEntriesEven(e, numbers, depth - 1)) return false;
    } else if (!realEntryAdmitted(e, numbers)) return false;
  }
  return true;
}

/** Whether an entry that is neither a number nor an array is admitted: never
 * a `{re, im}` object; `undefined` always, because an absent cell (a hole,
 * or a written `Missing`) is read by the lowerings that accept one (the
 * numeric selection fusion tests every cell for it); a typed array of
 * numbers at any depth, recorded in `sawTypedArrayEntry` so that the value
 * is copied to plain arrays; anything else only when `numbers` is not
 * set. */
function realEntryAdmitted(e: unknown, numbers: boolean): boolean {
  if (e === undefined) return true;
  if (isComplexObject(e)) return false;
  if (isNumericTypedArray(e)) {
    sawTypedArrayEntry = true;
    return true;
  }
  return !numbers;
}

/** The diagnostic of `checkRealEntries`: the first entry of `x` that is not
 * admitted, with its path (`[1][0]`). */
function realEntryError(
  x: unknown[],
  numbers: boolean,
  depth: number,
  label: string,
  path = ''
): TypeError {
  for (let i = 0; i < x.length; i++) {
    const e = x[i];
    if (typeof e === 'number') continue;
    const at = `${path}[${i}]`;
    if (Array.isArray(e)) {
      const error = realEntryError(e, numbers, depth - 1, label, at);
      if (error.message !== '') return error;
      continue;
    }
    if (isComplexObject(e))
      return new TypeError(
        `${label} was compiled with real entries, but its entry ${at} is a complex {re, im} value. Declare complex entries (for example \`matrix<complex>\` or \`list<complex>\`), or compile with \`mode: 'complex'\`.`
      );
    if (!realEntryAdmitted(e, numbers))
      return new TypeError(
        `${label} was compiled with number entries, but its entry ${at} is ${e === null ? 'null' : typeof e === 'object' ? 'an object' : `a ${typeof e}`}, not a number.`
      );
  }
  return new TypeError('');
}

function entryCheckError(binding: string): TypeError {
  return new TypeError(
    `${binding} was compiled as a real number but received a complex {re, im} value. Declare it complex, or compile with \`mode: 'complex'\`.`
  );
}

export function checkEntry(
  plan: EntryPlan,
  argumentsList: unknown[]
): unknown[] {
  if (plan.kind === 'vars') {
    const vars = argumentsList[0];
    if (typeof vars !== 'object' || vars === null) return argumentsList;
    const v = vars as Record<string, unknown>;
    let lifted: Record<string, unknown> | undefined;
    // A `~oo` argument is PROJECTED to `Infinity` rather than refused: the
    // compiled body has no value for the unsigned pole, and `Infinity` is the
    // spelling it already gives a pole it PRODUCES itself, so projecting here
    // gives one pole one spelling on both routes. The projection keeps the
    // magnitude and drops the direction `~oo` never had — the same trade the
    // constant-folding path makes for an embedded `~oo` literal. Every other
    // complex value still throws: reading `3 + 4i` as a number would be
    // silently wrong, while reading `~oo` as `Infinity` is the documented
    // float encoding of it.
    for (const id of plan.real) {
      const x = v[id];
      if (typeof x === 'string') refuseStringEntry(plan.strings, id);
      const read = checkBindingEntries(plan.entries.get(id), x);
      if (read !== x) {
        lifted ??= { ...v };
        lifted[id] = read;
        continue;
      }
      if (!isComplexObject(x)) continue;
      if (!isUnsignedPole(x)) throw entryCheckError(`"${id}"`);
      lifted ??= { ...v };
      lifted[id] = Infinity;
    }
    for (const id of plan.complex) {
      const x = v[id];
      if (typeof x === 'string') refuseStringEntry(plan.strings, id);
      const read = checkBindingEntries(plan.entries.get(id), x);
      if (read !== x) {
        lifted ??= { ...v };
        lifted[id] = read;
      } else if (typeof x === 'number') {
        lifted ??= { ...v };
        lifted[id] = { re: x, im: 0 };
      }
    }
    // A numeric typed array on a list-declared symbol is copied into a plain
    // one, which is what the compiled body reads. Every other value passes
    // untouched, including a scalar: the lowerings dispatch on the runtime
    // shape, so a narrower declaration is not enforced here.
    for (const id of plan.lists) {
      const x = v[id];
      if (typeof x === 'string') refuseStringEntry(plan.strings, id);
      const read = checkBindingEntries(plan.entries.get(id), x);
      if (read !== x) {
        lifted ??= { ...v };
        lifted[id] = read;
        continue;
      }
      if (!isNumericTypedArray(x)) continue;
      lifted ??= { ...v };
      lifted[id] = copyToPlainArray(x);
    }
    return lifted === undefined ? argumentsList : [lifted];
  }
  let lifted: unknown[] | undefined;
  // The positional-parameter route makes the same `~oo` projection as the
  // free-symbol route above.
  for (const i of plan.real) {
    const x = argumentsList[i];
    if (typeof x === 'string') refuseStringEntry(plan.strings, i);
    const read = checkBindingEntries(plan.entries.get(i), x);
    if (read !== x) {
      lifted ??= [...argumentsList];
      lifted[i] = read;
      continue;
    }
    if (!isComplexObject(x)) continue;
    if (!isUnsignedPole(x)) throw entryCheckError(`argument ${i + 1}`);
    lifted ??= [...argumentsList];
    lifted[i] = Infinity;
  }
  for (const i of plan.complex) {
    const x = argumentsList[i];
    if (typeof x === 'string') refuseStringEntry(plan.strings, i);
    const read = checkBindingEntries(plan.entries.get(i), x);
    if (read !== x) {
      lifted ??= [...argumentsList];
      lifted[i] = read;
    } else if (typeof x === 'number') {
      lifted ??= [...argumentsList];
      lifted[i] = { re: x, im: 0 };
    }
  }
  // The positional-parameter route applies the same list rule as the
  // free-symbol route above.
  for (const i of plan.lists) {
    const x = argumentsList[i];
    if (typeof x === 'string') refuseStringEntry(plan.strings, i);
    const read = checkBindingEntries(plan.entries.get(i), x);
    if (read !== x) {
      lifted ??= [...argumentsList];
      lifted[i] = read;
      continue;
    }
    if (!isNumericTypedArray(x)) continue;
    lifted ??= [...argumentsList];
    lifted[i] = copyToPlainArray(x);
  }
  return lifted ?? argumentsList;
}

/** The plan as plain data, for a compilation result that is stored. */
export function storeEntryPlan(plan: EntryPlan): StoredEntryPlan {
  return {
    kind: plan.kind,
    // Copies: a change to the stored plan must not change the plan that
    // `run()` reads.
    real: [...plan.real],
    complex: [...plan.complex],
    lists: [...plan.lists],
    entries: [...plan.entries],
    strings: [...plan.strings],
  };
}

function restoreEntryPlan(stored: StoredEntryPlan): EntryPlan {
  return {
    ...stored,
    entries: new Map(stored.entries),
    // A plan stored without the field refuses no string.
    strings: new Map(stored.strings ?? []),
  } as EntryPlan;
}

/**
 * The compiled JavaScript runner's RESULT CONVENTION (design §5,
 * `docs/COMPILATION-MODEL.md`), applied at the boundary
 * of every `run()` call: a value whose imaginary part is EXACTLY zero comes
 * back as a plain `number`; otherwise as `{re, im}`. Both directions are
 * guaranteed — a returned `ComplexResult` always has `im !== 0`, and a real
 * value is never returned as `{re, im: 0}` — so a consumer's per-sample test
 * is the single `typeof v === 'number'`, and a `{re, im}` with a non-zero
 * imaginary part tells "outside the real domain" from a genuine `NaN`.
 * Booleans pass through (never coerced), and so does anything else; a
 * collection is normalized element by element (a fresh array — the compiled
 * value may alias caller data).
 *
 * The test is EXACT, not a chop: the transcendental kernels give an exact
 * zero part where the value has one (`kernelResult`), and chopping here would
 * violate the "never chop in ring arithmetic" rule (`1 + 1e-12i` is
 * `{re: 1, im: 1e-12}`).
 */
export function normalizeRunResult(r: unknown): unknown {
  if (typeof r === 'number' || typeof r === 'boolean') return r;
  if (Array.isArray(r)) {
    // A number or boolean element copies through as it is; only another
    // shape is normalized recursively. The recursive `map` this replaced
    // was a full pass through a function call per element, which on a
    // 40 000-element result cost as much as the computation it followed
    // (Tycho item 264).
    const n = r.length;
    const out: unknown[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const x = r[i];
      out[i] =
        typeof x === 'number' || typeof x === 'boolean'
          ? x
          : normalizeRunResult(x);
    }
    return out;
  }
  if (
    typeof r === 'object' &&
    r !== null &&
    typeof (r as ComplexResult).re === 'number' &&
    typeof (r as ComplexResult).im === 'number' &&
    (r as ComplexResult).im === 0
  )
    return (r as ComplexResult).re;
  // A complex cell is returned as a FRESH object: the value may be part of a
  // definition the runner evaluated once and keeps for every later call
  // (`twoStageRunner`), and a caller writing to the returned object's `re`
  // must not change what the next call answers.
  if (isComplexObject(r)) return { re: r.re, im: r.im };
  return r;
}

/**
 * Compute the nth Fibonacci number using iterative doubling.
 */
function fibonacci(n: number): number {
  if (!Number.isInteger(n)) return NaN;
  if (n < 0) return n % 2 === 0 ? -fibonacci(-n) : fibonacci(-n);
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return b;
}

/**
 * The version of the helper set. Compilation results and runtimes carry it, so
 * a host that stores code and runs it elsewhere can tell that the two ends
 * were built from different releases: compare the strings.
 */
export const RUNTIME_VERSION = '{{SDK_VERSION}}';

/** A `WithRandomSeed` frame given to a runtime: the folded seed and the
 * counter (`{ seedLo, seedHi, next }`, what the engine holds), or the seed
 * itself and the index of the next draw (default 0). */
export type RuntimeFrameInput =
  RandomSeedFrame | { seed: number | string; next?: number };

export type JavaScriptRuntimeOptions = {
  /** The source of draws outside any `WithRandomSeed` frame, and of the
   * integrals' Monte-Carlo samples (which are live inside a frame too).
   * Default `Math.random`. `null` denies draws: a draw then throws, as it does
   * in an engine whose host denies the `entropy` capability. The error is a
   * `CapabilityDeniedError`, a different class in each bundle, so test it by
   * `e.name === 'CapabilityDeniedError'`, not with `instanceof`. */
  random?: (() => number) | null;
  /** The frame active when the code is called: set it when the code is called
   * from inside an interpreted `WithRandomSeed`. */
  frame?: RuntimeFrameInput;
  /** The cap on lazy-stream walks. Default 1024, the engine's default;
   * a value of 0 or less means no cap. */
  iterationLimit?: number;
  /** The time, in ms since the epoch (`Date.now()`), after which the
   * shuffle/choice loops throw. Off when unset. */
  deadline?: number;
};

/** The code of a compilation result, or the same fields stored. */
export type StoredJavaScript = {
  code: string;
  /** All the definitions `code` reads. Run on every call, unless
   * `preambleOnce` or `preamblePerCall` is present. */
  preamble?: string;
  /** The definitions that read nothing per call: evaluated once, when the
   * code is loaded. */
  preambleOnce?: string;
  /** The definitions evaluated on every call. */
  preamblePerCall?: string;
  /** For a lambda with `preambleOnce`: `code` without those definitions. */
  callCode?: string;
  calling?: 'expression' | 'lambda';
  /** The digits a negative base's float exponent is read to; 17 when absent. */
  reconstructionDigits?: number;
  /** The input checks and conversions `run()` applies; `load()` applies them. */
  entryPlan?: StoredEntryPlan;
  /** Required by `load()`. */
  runtimeVersion?: string;
};

/**
 * The runtime for compiled JavaScript, with no engine behind it: load stored
 * code with `load()`. The helpers the code calls are not part of this type and
 * may change in any release.
 */
export interface JavaScriptRuntime {
  readonly runtimeVersion: string;
  /** The active frame. Its `next` is the draw counter: read it after a call
   * to hand the advanced counter back to the host that owns the frame. */
  readonly frame: RandomSeedFrame | undefined;
  /** Set the active frame, from a folded frame or a seed (`undefined` clears). */
  setFrame(f: RuntimeFrameInput | undefined): void;
  /** The cap on lazy-stream walks: `Infinity` when set to 0 or less. */
  iterationLimit: number;
  deadline: number | undefined;
  /** The function the stored code denotes: `(vars?) => value` for code
   * compiled from an expression, `(...args) => value` for a lambda. Throws if
   * `runtimeVersion` is missing or differs. The definitions that read no
   * per-call value are evaluated once, here, as `run()` does. The inputs are
   * checked and converted by `entryPlan`, as `run()` does. */
  load(stored: StoredJavaScript): (...args: unknown[]) => unknown;
}

/** A runtime together with its helper table, for the engine's own tests. */
export type SysRuntime = JavaScriptRuntime & SysHelpers;

function toFrame(
  input: RuntimeFrameInput | undefined
): RandomSeedFrame | undefined {
  if (input === undefined) return undefined;
  if ('seed' in input) {
    const [seedLo, seedHi] = foldSeed(input.seed);
    return { seedLo, seedHi, next: input.next ?? 0 };
  }
  return input;
}

/**
 * The runtime for compiled JavaScript, with no engine behind it. It is the
 * `_SYS` that `JavaScriptTarget` builds for `run()`, from the same factory,
 * over plain options instead of an engine. See {@link JavaScriptRuntimeOptions}.
 */
export function createJavaScriptRuntime(
  options: JavaScriptRuntimeOptions = {}
): JavaScriptRuntime {
  return createSysRuntime(options);
}

/** `createJavaScriptRuntime()` with the helper table in the type. */
export function createSysRuntime(
  options: JavaScriptRuntimeOptions = {}
): SysRuntime {
  const random =
    options.random === null
      ? (): number => {
          throw new CapabilityDeniedError('entropy');
        }
      : (options.random ?? Math.random);
  let frame = toFrame(options.frame);
  let iterationLimit = options.iterationLimit ?? DEFAULT_ITERATION_LIMIT;
  let deadline = options.deadline;
  const limit = (): number => (iterationLimit <= 0 ? Infinity : iterationLimit);

  const sys = makeSysHelpers({
    random,
    frame: () => frame,
    setFrame: (f) => {
      frame = f;
    },
    iterationLimit: limit,
    deadline: () => deadline,
  }) as SysRuntime;

  Object.defineProperties(sys, {
    runtimeVersion: { value: RUNTIME_VERSION, enumerable: true },
    frame: { get: () => frame, enumerable: true },
    setFrame: {
      value: (f: RuntimeFrameInput | undefined): void => {
        frame = toFrame(f);
      },
      enumerable: true,
    },
    iterationLimit: {
      get: limit,
      set: (n: number) => {
        iterationLimit = n;
      },
      enumerable: true,
    },
    deadline: {
      get: () => deadline,
      set: (t: number | undefined) => {
        deadline = t;
      },
      enumerable: true,
    },
    load: {
      value: (stored: StoredJavaScript): ((...args: unknown[]) => unknown) => {
        if (stored.runtimeVersion === undefined)
          throw new Error(
            'The stored code has no runtimeVersion: it cannot be matched to this runtime'
          );
        if (stored.runtimeVersion !== RUNTIME_VERSION)
          throw new Error(
            `The code was compiled for runtime ${stored.runtimeVersion}, this is runtime ${RUNTIME_VERSION}`
          );
        const once = stored.preambleOnce ?? '';
        const plan = stored.entryPlan && restoreEntryPlan(stored.entryPlan);
        // A stored result is plain data that a host can change. A count
        // outside 15 to 17 gives a wrong branch for a negative base: a small
        // count makes almost every float exponent a small rational, and `NaN`
        // accepts every reconstruction. `realPowerReconstructionDigits()`
        // gives the same limits to the count of the engine.
        const storedDigits = stored.reconstructionDigits;
        const digits =
          typeof storedDigits === 'number' && Number.isFinite(storedDigits)
            ? Math.max(15, Math.min(17, Math.trunc(storedDigits)))
            : 17;
        // The evaluation of the once-only definitions, and every call below,
        // reads the exponent of a negative base to the digits the code was
        // compiled with.
        const withDigits = <T>(f: () => T): T => {
          const previous = setReconstructionDigits(digits);
          try {
            return f();
          } finally {
            setReconstructionDigits(previous);
          }
        };
        if (stored.calling === 'lambda') {
          const fn = withDigits(
            () =>
              twoStageRunner(
                sys,
                once,
                [],
                `return (${stored.callCode ?? stored.code});`
              )() as (...args: unknown[]) => unknown
          );
          return (...args) => {
            const previous = setReconstructionDigits(digits);
            try {
              return normalizeRunResult(
                fn(...(plan ? checkEntry(plan, args) : args))
              );
            } finally {
              setReconstructionDigits(previous);
            }
          };
        }
        const split =
          stored.preambleOnce !== undefined ||
          stored.preamblePerCall !== undefined;
        const perCall = split ? stored.preamblePerCall : stored.preamble;
        const fn = withDigits(() =>
          twoStageRunner(
            sys,
            once,
            ['_'],
            `${perCall ?? ''}\nreturn ${stored.code};`
          )
        );
        // The arguments are passed as they are given, as `run()` does: a call
        // with no vars object throws when the code reads a free symbol.
        return (...args) => {
          const previous = setReconstructionDigits(digits);
          try {
            return normalizeRunResult(
              fn(...(plan ? checkEntry(plan, args) : args))
            );
          } finally {
            setReconstructionDigits(previous);
          }
        };
      },
    },
  });
  return sys;
}

/**
 * The two-stage form of a compiled runner. `hoisted` is evaluated ONCE, when
 * the runner is built, in a scope that sees `_SYS` and nothing per call; the
 * inner function it returns runs on every call with the per-call preamble
 * and the body. A folded symbol value that reads no per-call binding is the
 * same on every call (`splitPreambleDefs`), and a plot that sampled `S[k]`
 * once per pixel rebuilt the whole 22 500-element `S` on each sample before
 * the split. Any error the hoisted stage raises is raised here, at
 * construction, instead of on the first call. The caller's own `preamble`
 * option is never part of `hoisted`: it is arbitrary source that may read
 * the vars object under another spelling, draw randomness, or hold per-call
 * state, so it keeps running on every call.
 */
export function twoStageRunner(
  sys: SysHelpers,
  hoisted: string,
  params: string[],
  perCallCode: string
): (...args: unknown[]) => unknown {
  const stage = new Function(
    '_SYS',
    `${hoisted}return function (${params.join(', ')}) { ${perCallCode} };`
  ) as (sys: SysHelpers) => (...args: unknown[]) => unknown;
  return stage(sys);
}
