import { Complex } from 'complex.js';
import { RUNTIME_VERSION } from '../../common/runtime-versions.js';
import {
  factorial,
  factorial2,
  realGcd as gcd,
  realLcm as lcm,
  centeredDiffHigherOrder,
  centeredDiffHigherOrderVector,
  isBeyondSafeInteger,
} from '../numerics/numeric.js';
import { isPrime as isPrimeNumber } from '../numerics/primes.js';
import { MAX_CHUNK_COUNT } from '../numerics/value-scaled-caps.js';
import {
  parseColor,
  rgbToOklch,
  oklabToOklch,
  oklchToOklab,
  hsvToRgb,
  apca,
  oklabDeltaE,
} from '@arnog/colors';
import type { HexColor } from '@arnog/colors';
import {
  gamutMapOklch,
  gamutMapSrgb,
  gamutToSrgb,
  colormapColor,
  COLORMAP_NAMES,
  readColorChannels,
  hslToRgb255,
  oklabToRgb255,
  oklchToRgb255,
  rgb255ToHsl,
  rgb255ToHsv,
  isParseColorSpelling,
  parseOkColorString,
  lerpOklchColor,
  normalizeAlpha,
  channelsColorString,
} from '../numerics/color-conversion.js';
import type { ColorChannelSpace } from '../numerics/color-conversion.js';
import {
  binomial,
  gamma,
  lnAbsGamma,
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
  incompleteGammaUpper,
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
  lerchPhiComplex,
  dirichletEtaReal,
  dirichletBetaReal,
} from '../numerics/lerch-phi.js';
import { lambertWComplex } from '../numerics/lambert-w-complex.js';
import { stieltjesGammaReal } from '../numerics/stieltjes.js';
import { clausen } from '../numerics/clausen.js';
import { polylogOrderComplex, polylogOrderReal } from '../numerics/polylog.js';
import { monteCarloEstimate } from '../numerics/monte-carlo.js';
import {
  divergentTailSign,
  tailIsFinite,
  tailReachesInfinity,
} from '../numerics/divergent-tail.js';
import { rangeCount } from '../numerics/range-count.js';
import {
  correlation,
  covariance,
  kurtosis,
  mode,
  populationCovariance,
  quartiles,
  skewness,
} from '../numerics/statistics.js';
import { escapeTime } from '../numerics/fractal-smooth.js';
import { negativeBaseRealPowFromRational } from '../numerics/real-power.js';
import {
  arcothReal,
  arcschReal,
  arsechReal,
} from '../numerics/inverse-hyperbolic.js';
import type { Rational } from '../numerics/types.js';
import type { IComputeEngine } from '../global-types.js';
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
  scaledComplexDivide,
  textbookQuotientIsAccurate,
  hurwitzZetaComplexWithError,
  polylogComplex,
  ellipticKComplex,
  ellipticEComplex,
  hypergeometric2F1Complex,
  gamma as complexGamma,
  incompleteGammaUpperComplex,
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
  checkDeadline,
  DEFAULT_ITERATION_LIMIT,
  makeLoopPassCounter,
  type DeadlineFrame,
} from '../../common/interruptible.js';
import { CapabilityDeniedError } from '../effects-registry.js';
import { BIGINT_HELPERS } from './bigint-runtime.js';
import { MATRIX_HELPERS } from './matrix-runtime.js';
import { TEXT_HELPERS } from './text-runtime.js';
import {
  broadcastNumbers,
  broadcastNumbersSlice,
  type BroadcastBatchBody,
  type BroadcastSlice,
} from './broadcast.js';
import type {
  BroadcastAsyncOptions,
  BroadcastAsyncResult,
  BroadcastInputs,
  BroadcastOptions,
  CompiledColor,
  CompiledColorSpace,
  ComplexResult,
  StoredBatchBody,
  StoredEntryPlan,
} from './types.js';
import {
  isKernelPool,
  isShippableCode,
  makeBroadcastAsync,
  makeWillUsePool,
  type BroadcastAsyncSpec,
} from '../kernel-pool.js';
import type { KernelPool } from '../kernel-pool-types.js';

/**
 * The number of significant digits the float exponent of a negative base is
 * read to, for the compiled code that is running now. A compilation result
 * records this number when the code is generated (`reconstructionDigits`),
 * and both `run()` and `load()` set it for the time of each call. The number
 * cannot be computed when the code runs: the precision of the engine can
 * change after the compilation, and a runtime bundle has its own `BigDecimal`,
 * whose precision is not the precision of the engine. When no compiled code
 * that records a number is running, the value is `undefined` and the helpers
 * read the exponent to 17 digits.
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
    // No compiled code that records its digits is running: the exponent is
    // read to the 17 digits of a double, as `load()` reads stored code that
    // records no digits.
    activeReconstructionDigits ?? 17
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
 *
 * A part that is `NaN` means that the kernel has no value (a `NaN`
 * argument), and the interpreter answers the real `NaN` there: the result
 * is `{re: NaN, im: 0}`, which the runner returns as `NaN`, as
 * `continuedKernel` does. `√NaN` gave `{re: 0, im: NaN}` (ROADMAP
 * CE-214.5).
 */
function kernelResult(c: Complex): { re: number; im: number } {
  if (Number.isNaN(c.re) || Number.isNaN(c.im)) return { re: NaN, im: 0 };
  return { re: c.re === 0 ? 0 : c.re, im: c.im === 0 ? 0 : c.im };
}

/**
 * A special function continued into the complex plane, as the interpreter's
 * `applyN` does: the real kernel answers where it has a real value (a pole is
 * its `Infinity`), and where it is `NaN` (the value is complex, or the kernel
 * declines) the complex kernel answers. A decline of the complex kernel is a
 * real `NaN`, so the result is never a number the kernel cannot vouch for.
 */
function continuedKernel(
  zs: ReadonlyArray<ComplexResult>,
  real: (...x: number[]) => number,
  complex: (...z: Complex[]) => Complex | undefined
): { re: number; im: number } {
  if (zs.every((z) => z.im === 0)) {
    const r = real(...zs.map((z) => z.re));
    if (!Number.isNaN(r)) return { re: r, im: 0 };
  }
  const v = complex(...zs.map((z) => new Complex(z.re, z.im)));
  return v === undefined || v.isNaN() ? { re: NaN, im: 0 } : kernelResult(v);
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
 * complex logarithm (`_SYS.clog10`) needs the exact real argument so that
 * its real-axis value matches the real lane's.
 */
function complexModulus(z: ComplexResult): number {
  return z.im === 0 ? Math.abs(z.re) : Math.hypot(z.re, z.im);
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

/**
 * The color value of an `oklch(…)` or `oklab(…)` string, in its own space
 * and with its own channels (`parseOkColorString`), or `undefined` for any
 * other string. The packing of `parseColor()` is clipped to the sRGB gamut,
 * so these strings do not go through it: the interpreter reads them the
 * same way (`readColorExpr`, `library/colors.ts`). A string of one of these
 * notations that is not a color throws, as `parseColorStringOrThrow` does.
 */
function okStringColor(input: string): CompiledColor | undefined {
  const ok = parseOkColorString(input);
  if (ok === undefined) return undefined;
  if (ok === null) throw new Error(`Unknown color: ${input}`);
  return mkColor(ok.space, ok.c0, ok.c1, ok.c2, ok.alpha);
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
 * A NON-FINITE number is the absent-position sentinel of a broadcast, and
 * it answers the non-finite color, which is what the
 * interpreter's per-position `incompatible-type` error projects to on this
 * target.
 *
 * `undefined` is the compiled form of the marker `Missing`: a cell of a
 * color list that holds no value (a selection with no match), in the value
 * of a symbol or a read out of range. It answers the non-finite color too,
 * so the other cells of a broadcast keep their values: `AsOklab(cd)` with
 * `cd` at `[Missing, Rgb(0, 1, 0)]` gives `[NaN color, the Oklab of green]`,
 * where the interpreter gives `[incompatible-type error, the same Oklab]`.
 * The value of a `Missing` cell is unspecified in compiled code
 * (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code"); ROADMAP
 * CE-791.
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
    return (
      okStringColor(input) ?? packedToColor(parseColorStringOrThrow(input))
    );
  if (isCompiledColor(input)) return input;
  if (
    input === undefined ||
    (typeof input === 'number' && !Number.isFinite(input))
  )
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
  if (typeof input === 'string') input = okStringColor(input) ?? input;
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
  // A string that `parseColor()` does not read is refused before the call,
  // which would write a warning to the console.
  if (!isParseColorSpelling(input)) refuse();
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

/** Color runtime helpers shared by both SYS objects. */
const colorHelpers = {
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

  // -----------------------------------------------------------------------
  // As* converters. Inputs are anything `toOklch` accepts (a color value in
  // any space, or a color string). Each output is a color value TAGGED with
  // the space it names, so a conversion result reaching a second color
  // operator is understood rather than misread as OKLCh. sRGB-based outputs
  // (asRgb/asHsv/asHsl) use 0-1 channels for consistency with the GPU
  // target's shader convention.
  // -----------------------------------------------------------------------
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
  // BROADCAST, where the element may be a color STRING
  // that the pass-through would hand back unconverted.
  asOklch(input: unknown): CompiledColor {
    const c = toOklch(input);
    return mkColor('oklch', c.L, c.C, c.H, c.alpha);
  },
  // `ColorMix(a, b, t)`: the interpreter's mix in OKLCh (`lerpOklchColor`),
  // with the ratio clamped into [0, 1]; the result is in OKLCh. A ratio that
  // is not finite (an `expected-value` error of the interpreter) gives the
  // `NaN` colour.
  colorMix(a: unknown, b: unknown, t: number): CompiledColor {
    const c = lerpOklchColor(
      toOklch(a),
      toOklch(b),
      Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : NaN
    );
    return mkColor('oklch', c.L, c.C, c.H, c.alpha);
  },
  // `ColorContrast(bg, fg)`: the APCA contrast of `@arnog/colors`, of the
  // two colours in extended sRGB, as the interpreter.
  colorContrast(bg: unknown, fg: unknown): number {
    return apca(toRgb255(bg), toRgb255(fg));
  },
  // `ColorDelta(a, b)`: ΔE_OK, the distance of the two colours in OKLab.
  colorDelta(a: unknown, b: unknown): number {
    return oklabDeltaE(oklchToOklab(toOklch(a)), oklchToOklab(toOklch(b)));
  },
  // `ContrastingColor(bg, fg1, fg2)`: the candidate of the larger absolute
  // APCA contrast against `bg`, the candidate first in `apca` (it is not
  // symmetric), `fg1` at a tie, as the interpreter. The candidate is
  // answered as it is, the same colour as the interpreter's (which keeps the
  // head it was written with). A colour of non-finite channels (an error of
  // the interpreter) gives the `NaN` colour.
  contrastingColor(bg: unknown, fg1: unknown, fg2: unknown): CompiledColor {
    const [b, c1, c2] = [bg, fg1, fg2].map(toRgb255);
    if (![b, c1, c2].every((c) => finiteChannels(c.r, c.g, c.b)))
      return nonFiniteColor(undefined);
    return Math.abs(apca(c1, b)) >= Math.abs(apca(c2, b))
      ? asCompiledColor(fg1)
      : asCompiledColor(fg2);
  },
  // `ContrastingColor(bg)`: white or black, as the `Rgb` colour the
  // interpreter answers.
  contrastingColorBW(bg: unknown): CompiledColor {
    const b = toRgb255(bg);
    if (!finiteChannels(b.r, b.g, b.b)) return nonFiniteColor(undefined, 'rgb');
    const white = { r: 255, g: 255, b: 255 };
    const black = { r: 0, g: 0, b: 0 };
    const k = Math.abs(apca(white, b)) >= Math.abs(apca(black, b)) ? 1 : 0;
    return mkColor('rgb', k, k, k, undefined);
  },
  // `GamutMap(c)` and `GamutMap(c, "display-p3")`: the CSS Color 4 gamut
  // mapping, as the interpreter (`gamutMapColor`): a colour held in OKLCh or
  // OKLab is mapped from its OKLCh channels, any other from its extended
  // sRGB channels. The result is in sRGB (extended sRGB for Display-P3).
  gamutMap(input: unknown, p3: boolean): CompiledColor {
    const gamut = p3 ? 'display-p3' : 'srgb';
    const c = asCompiledColor(input);
    let mapped: [number, number, number];
    let alpha: number | undefined;
    if (c.space === 'oklch' || c.space === 'oklab') {
      const lch = toOklch(c);
      mapped = gamutMapOklch(lch.L, lch.C, lch.H, gamut);
      alpha = lch.alpha;
    } else {
      const rgb = toRgb255(c);
      mapped = gamutMapSrgb(rgb.r / 255, rgb.g / 255, rgb.b / 255, gamut);
      alpha = rgb.alpha;
    }
    const [r, g, b] = gamutToSrgb(mapped, gamut);
    return mkColor('rgb', r, g, b, alpha);
  },
  // `Colormap(name, t)` of a position `t` that is not an integer of 2 or
  // more (the lowering proves it): the interpreter's colour
  // (`colormapColor`), the palette named by its index in `COLORMAP_NAMES`.
  // A position that is not finite (an error of the interpreter) gives the
  // `NaN` colour.
  colormap(palette: number, t: number): CompiledColor {
    const c = Number.isFinite(t)
      ? colormapColor(COLORMAP_NAMES[palette], t)
      : undefined;
    if (c === undefined) return nonFiniteColor(undefined);
    return mkColor('oklch', c.L, c.C, c.H, c.alpha);
  },
  // `AsHsv(Hsv(h, s, v))` and `AsHsl(Hsl(h, s, l))`: the constructor's own
  // channels as the interpreter reads them (`readColorChannels`: the hue
  // reduced into [0, 360), the others clamped into [0, 1]), with no round
  // trip through OKLCh, which loses the hue and the saturation at black and
  // at grey.
  hsvChannels(h: number, s: number, v: number): CompiledColor {
    const ch = readColorChannels('hsv', h, s, v);
    if (ch === undefined) return nonFiniteColor(undefined, 'hsv');
    return mkColor('hsv', ch[0], ch[1], ch[2], undefined);
  },
  hslChannels(h: number, s: number, l: number): CompiledColor {
    const ch = readColorChannels('hsl', h, s, l);
    if (ch === undefined) return nonFiniteColor(undefined, 'hsl');
    return mkColor('hsl', ch[0], ch[1], ch[2], undefined);
  },
  // The channel `k` (0, 1 or 2) of a colour in the space `space`: an
  // element of `ColorToColorspace(c, space)`, as the interpreter.
  colorChannel(input: unknown, space: string, k: number): number {
    const c =
      space === 'rgb'
        ? colorHelpers.asRgb(input)
        : space === 'hsl'
          ? colorHelpers.asHsl(input)
          : space === 'hsv'
            ? colorHelpers.asHsv(input)
            : space === 'oklab'
              ? colorHelpers.asOklab(input)
              : colorHelpers.asOklch(input);
    return k === 0 ? c.c0 : k === 1 ? c.c1 : c.c2;
  },
  // `ColorToString` of the constructor of `space` of the channels `c0, c1,
  // c2` (CE-1548): the interpreter's string (`channelsColorString()`). The
  // channels that make no colour are the interpreter's `incompatible-type`.
  colorToString(
    space: ColorChannelSpace,
    c0: number,
    c1: number,
    c2: number,
    format: string
  ): string {
    const s = channelsColorString(space, c0, c1, c2, format);
    if (s === undefined)
      throw new RangeError(
        `ColorToString: the channels (${c0}, ${c1}, ${c2}) do not make a colour`
      );
    return s;
  },
};

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
 * Whether the `At` index `i` is a boolean mask, as the interpreter reads one:
 * its members are booleans or holes (`undefined` for `Missing`, `NaN`), with
 * at least one boolean. An empty index, and one of holes only, are a gather.
 */
function isMask(i: unknown[]): boolean {
  // One pass that stops at the first member that is neither: a list of
  // numbers is rejected at its first entry.
  let seen = false;
  for (const m of i) {
    if (typeof m === 'boolean') seen = true;
    else if (!(m === undefined || (typeof m === 'number' && Number.isNaN(m))))
      return false;
  }
  return seen;
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
 * invalid index. `NaN` is returned unchanged, so it
 * propagates as it does through the other compiled arithmetic.
 *
 * The throw applies to every operand type, an infinite dividend included
 * (`Mod(1/x, 2)` at `x = 0`): the interpreter gives a type error for
 * `Mod(+oo, 10)`, and a `NaN` would stand for a value the operation does
 * not have. A plot host that samples a compiled kernel catches the error at
 * that sample and draws a gap, as it does for any other thrown sample.
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

/** `a / b`, with Smith's formula (`scaledComplexDivide`). A zero divisor
 * takes the componentwise branch of `scaledComplexDivide` and gives infinite
 * parts for a non-zero dividend (NaN parts for a zero dividend). */
function cxDiv(a: ComplexResult, b: ComplexResult): ComplexResult {
  return scaledComplexDivide(a.re, a.im, b.re, b.im);
}

/**
 * A compiled scalar callback as the REAL function the numeric kernels
 * (`_SYS.integrate`, `_SYS.nd`, the Monte-Carlo estimator)
 * consume: those kernels are real-only, and under the promoting discipline
 * (`complex`) a compiled body may hand back a `{re, im}` object —
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
  if (activeIntegrals === 0) nestedEvalsLeft = NESTED_QUADRATURE_BUDGET;
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

/** The count `k` of `Chunk(l, k)`: the interpreter leaves the form
 *  unevaluated below 1 and above `MAX_CHUNK_COUNT`. */
function chunkCount(k: number): number {
  if (!(k >= 1 && k <= MAX_CHUNK_COUNT))
    throw new RangeError(
      `Chunk: expected a count in 1..${MAX_CHUNK_COUNT}, got ${String(k)}`
    );
  return k;
}

/** The size `n` of `Partition(l, n)`: the interpreter leaves the form
 *  unevaluated below 1. */
function partitionSize(n: number): number {
  if (!(n >= 1))
    throw new RangeError(
      `Partition: expected a size of 1 or more, got ${String(n)}`
    );
  return n;
}

/** An element of `l` is NaN. */
function holdsNaN(l: Iterable<number>): boolean {
  for (const x of l) if (x !== x) return true;
  return false;
}

export const SYS_HELPERS = {
  // The helpers of `mode: 'bigint'`, which compute with JavaScript
  // `bigint` values and throw a `NonFiniteValue` at a pole
  // (`bigint-runtime.ts`). Only the code of the bigint emitter calls them.
  ...BIGINT_HELPERS,
  // The helpers of the string lane (`text-runtime.ts`).
  ...TEXT_HELPERS,
  // The element count of an arithmetic `Range`, shared with the interpreter
  // (`numerics/range-count.ts`), so the compiled length agrees with the
  // interpreter's `count`.
  rangeCount,
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
  // ψ, ψ₁ and ψ⁽ⁿ⁾ have a pole at every non-positive integer, where the
  // interpreter answers `~oo`. The shared helpers answer `NaN` there, so the
  // pole is spelled `Infinity` here. The order −1 is
  // the antiderivative of ψ, `LogGamma`, which the interpreter computes for
  // `PolyGamma(-1, x)`: it is real for x > 0 (the logarithm of the positive
  // Γ(x)) and +∞ at a pole; at a negative non-integer x it is complex, and
  // this real lane answers `NaN`. Any other negative order is `NaN`, where
  // the interpreter stays symbolic.
  digamma: (x: number): number =>
    Number.isInteger(x) && x <= 0 ? Infinity : digamma(x),
  trigamma: (x: number): number =>
    Number.isInteger(x) && x <= 0 ? Infinity : trigamma(x),
  polygamma: (n: number, x: number): number => {
    if (n === -1) {
      if (Number.isInteger(x) && x <= 0) return Infinity;
      return x > 0 ? lnAbsGamma(x) : NaN;
    }
    if (Number.isInteger(n) && n >= 0 && Number.isInteger(x) && x <= 0)
      return Infinity;
    return polygamma(n, x);
  },
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

  // NaN propagates (Contract B `propagate` default, ratified 2026-08-27):
  // without the leading arm both comparisons are false for NaN and the
  // kernel answered the final arm's `1` — a fail-closed violation.
  heaviside: (x: number) =>
    Number.isNaN(x) ? NaN : x < 0 ? 0 : x === 0 ? 0.5 : 1,
  at: (arr: unknown, i: number | unknown[]): number | unknown[] => {
    if (!Array.isArray(arr)) return NaN;
    const n = arr.length;
    if (Array.isArray(i)) {
      const picked: unknown[] = [];
      // A boolean MASK (`isMask()`) is a filter over the positions up to the
      // shorter of the mask and the collection, as in the interpreter; a
      // hole keeps nothing.
      if (isMask(i)) {
        const len = Math.min(i.length, n);
        for (let k = 0; k < len; k++) if (i[k] === true) picked.push(arr[k]);
        return picked;
      }
      for (const m of i) {
        const mv = indexValue(m);
        if (!Number.isInteger(mv)) {
          // An entry with no numeric value at all (a string, an object with
          // no numeric real part) makes the interpreter leave `At`
          // unevaluated, which projects to a whole-result NaN. A `NaN` or
          // infinite entry, as a number or as a complex-lane value whose real
          // part is `NaN`, and an absent entry (`Missing` compiles to
          // `undefined`), name no position: the interpreter puts the absence
          // marker in its slot, as for a finite non-integer entry, so its
          // slot is NaN here too.
          const hasNumericValue =
            typeof m === 'number' ||
            m === undefined ||
            (typeof m === 'object' &&
              m !== null &&
              typeof (m as { re?: unknown }).re === 'number');
          if (!hasNumericValue) return NaN;
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
      // launder the divergence into a plausible-looking number. On an
      // infinite tail with an integrand of one sign, the divergence has a
      // sign (`divergentTailSign`), as in the interpreter
      // (`integrateRealPart`, library/calculus.ts): `∫₀^∞ x dx` is `+∞`.
      if (r.divergent) {
        // The quadrature could not tell a divergence from a convergence
        // (`undecided`): the tail gives no sign, as in the interpreter.
        if (r.undecided === true) return NaN;
        const sign = divergentTailSign(f, a, b);
        return sign === 0 ? NaN : sign * Infinity;
      }
      // The integrand is `NaN` on a set that is not some isolated points (a
      // real function outside its real domain, or a complex sample, which
      // `realFn` reads as `NaN`): the integral has no value, and the
      // Monte-Carlo fallback would spend 1e7 samples to find `NaN` again.
      if (r.nanRegion === true) return NaN;
      // An integrand that overflows on an infinite tail (`∫₀^∞ eˣ dx`): the
      // tail gives the sign of the divergence, as in the interpreter. With no
      // sign, an integrand that reaches an infinite value on the tail has no
      // value here (Monte Carlo would give a finite mean that changes at each
      // run); one that is only `NaN` there (`sinh x / cosh² x`) keeps the
      // methods below.
      if (!Number.isFinite(r.estimate)) {
        const sign = divergentTailSign(f, a, b);
        if (sign !== 0) return sign * Infinity;
        if (tailReachesInfinity(f, a, b)) return NaN;
        // Every sample of the tail is finite: the integral overflows double
        // precision (`tailIsFinite`), as in the interpreter.
        if (tailIsFinite(f, a, b)) return NaN;
      }
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
  // `Smoothstep(e0, e1, x)`: t²(3 − 2t) with t = clamp((x − e0)/(e1 − e0),
  // 0, 1). With e0 = e1, the step function (0 when x < e0, else 1), as the
  // interpreter gives; a NaN operand gives NaN.
  smoothstep: (e0: number, e1: number, x: number): number => {
    if (Number.isNaN(e0) || Number.isNaN(e1) || Number.isNaN(x)) return NaN;
    if (e0 === e1) return x < e0 ? 0 : 1;
    const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
    return t * t * (3 - 2 * t);
  },
  sinIntegral,
  // Integer-valued on the core domain 0 ≤ k ≤ n and extended like the
  // interpreter's `Binomial` elsewhere: negative and non-integer operands,
  // poles and infinite points (see `binomial()` in
  // `numerics/special-functions.ts`).
  binomial,
  // The statistics of a list of real numbers, and of two lists read pair
  // by pair: the interpreter's kernels (`numerics/statistics.ts`). `mode`
  // and `quartile` (the quartile `k` from 0: the lower one, the median,
  // the upper one) are NaN when an element is NaN, as the interpreter's
  // value of a statistic of data with a `NaN`; the sums of the other
  // kernels carry a NaN element to their result. `skewness` and `kurtosis`
  // are NaN for an element that is not finite, for no element and for
  // equal elements. `covariance`, `populationCovariance` and `correlation`
  // are NaN for lists of two lengths and for fewer than two pairs, and
  // `correlation` for a list of equal elements, where the interpreter's
  // value is an error.
  mode: (l: Iterable<number>): number => (holdsNaN(l) ? NaN : mode(l)),
  quartile: (l: Iterable<number>, k: 0 | 1 | 2): number =>
    holdsNaN(l) ? NaN : quartiles(l)[k],
  skewness,
  kurtosis,
  covariance,
  populationCovariance,
  correlation,
  // `Chunk(l, k)` and `Partition(l, n)` of a list of numbers or booleans
  // whose rows can have different lengths, as the interpreter's (`Chunk`,
  // `partitionWalk()` of `library/collections.ts`): `k` rows of
  // `⌈len/k⌉` elements, the last ones shorter or empty; rows of `n`
  // elements, the last one shorter. Each row is a plain array, also of an
  // array-like `l`. A count where the interpreter leaves the form
  // unevaluated (`k` below 1 or above `MAX_CHUNK_COUNT`, `n` below 1)
  // throws a `RangeError`; `chunkCount` and `partitionSize` are the checks
  // of a count of rows read one by one.
  chunkCount,
  partitionSize,
  chunk: (l: ArrayLike<unknown>, k: number): unknown[][] => {
    const m = chunkCount(k);
    const s = Math.ceil(l.length / m);
    return Array.from({ length: m }, (_, i) =>
      Array.prototype.slice.call(l, i * s, (i + 1) * s)
    );
  },
  partition: (l: ArrayLike<unknown>, n: number): unknown[][] => {
    const m = partitionSize(n);
    return Array.from({ length: Math.ceil(l.length / m) }, (_, i) =>
      Array.prototype.slice.call(l, i * m, (i + 1) * m)
    );
  },
  // The determinant, inverse, power and row echelon form of a matrix of
  // numbers (`matrix-runtime.ts`).
  ...MATRIX_HELPERS,
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
  // At `s = 1` the Hurwitz zeta function has a pole for every `a`, and the
  // interpreter answers `ComplexInfinity`. For a real `a`, the real kernel
  // answers `Infinity`. For a non-real `a`, the complex kernel runs, and it
  // returns NaN at `s = 1` because its interpreter caller handles the pole,
  // so this helper returns the compiled unsigned pole itself.
  churwitzZeta: (s: ComplexResult, a: ComplexResult) =>
    s.re === 1 && s.im === 0 && a.im !== 0
      ? complexPole()
      : continuedKernel(
          [s, a],
          hurwitzZeta,
          (s, a) => hurwitzZetaComplexWithError(s, a)?.value
        ),
  clerchPhi: (z: ComplexResult, s: ComplexResult, a: ComplexResult) =>
    continuedKernel([z, s, a], lerchPhiReal, lerchPhiComplex),
  cpolyLog: (s: ComplexResult, z: ComplexResult) =>
    continuedKernel([s, z], polylogOrderReal, (s, z) =>
      s.im === 0 && Number.isInteger(s.re) && s.re >= 2
        ? polylogComplex(s, z)
        : polylogOrderComplex(s, z)
    ),
  cellipticK: (m: ComplexResult) =>
    continuedKernel([m], ellipticK, ellipticKComplex),
  cellipticE: (m: ComplexResult) =>
    continuedKernel([m], ellipticE, ellipticEComplex),
  chypergeometric2F1: (
    a: ComplexResult,
    b: ComplexResult,
    c: ComplexResult,
    z: ComplexResult
  ) =>
    continuedKernel([a, b, c, z], hypergeometric2F1, (a, b, c, z) =>
      hypergeometric2F1Complex(a, b, c, z)
    ),
  // The branch index is read as an integer, as the interpreter's is.
  clambertW: (x: ComplexResult, k?: ComplexResult) =>
    continuedKernel(
      [x],
      (x) => lambertW(x, k?.re ?? 0),
      (z) => lambertWComplex(z, k?.re ?? 0)
    ),
  cln: (z: ComplexResult) => kernelResult(new Complex(z.re, z.im).log()),
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
  // The unsigned pole has no direction: its argument is `NaN`, as in the
  // interpreter, where `atan2(∞, ∞)` would answer `π/4`.
  carg: (z: ComplexResult) =>
    isUnsignedPole(z) ? NaN : new Complex(z.re, z.im).arg(),
  // Ring operation, not a kernel: no roundoff chop (see `kernelResult`).
  cconj: (z: ComplexResult) => ({ re: z.re, im: -z.im }),
  // A zero imaginary part stays `+0`. The negation of a real value lifted to
  // `{re, im: 0}` must be on the same side of a branch cut as the negative
  // real the interpreter computes: with `im: -0`, `_SYS.cln` and
  // `_SYS.csqrt` take the lower side of the cut, and `Ln(-x)` at `x = 2`
  // gave `ln 2 − iπ` where the interpreter gives `ln 2 + iπ`.
  cneg: (z: ComplexResult) => ({ re: -z.re, im: z.im === 0 ? 0 : -z.im }),
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
  randomChoice: (d: RandomDomainDescriptor, k: unknown) => unknown[];
  shuffle: (xs: unknown[]) => unknown[];
  randomSample: (n: number, k: unknown) => number[];
};

/** The `_SYS` bundle injected into a compiled JavaScript function. */
export type SysHelpers = typeof SYS_HELPERS &
  RandomSysHelpers &
  ReturnType<typeof makeLoopPassCounter> & {
    /** The functions of the profile `ir` (`IR_FUNCTIONS`). */
    ir: typeof IR_FUNCTIONS;
    /** The integral of the profile `ir`: `integrate` with the live draw. */
    irIntegrate: (fn: (x: number) => number, a: number, b: number) => number;
    tick: (n?: number) => void;
  };

/**
 * The state the engine-bound helpers of `_SYS` read each time they run, never
 * when the code is compiled. The engine passes its own (`ce._liveRandom`,
 * `ce._randomFrame`, `ce._deadlineFrame`);
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
  /** The deadline the shuffle/choice loops check, if any. */
  deadline: () => DeadlineFrame | number | undefined;
};

/**
 * What the engine-bound helpers of `_SYS` read from `ce` each time they run:
 * the same helpers as a standalone runtime (`createJavaScriptRuntime`), over
 * the engine's own random frame, entropy handler and deadline.
 */
export function engineRuntimeSource(ce: IComputeEngine): RuntimeSource {
  return {
    random: () => ce._liveRandom(),
    draw: () => ce._random(),
    frame: () => ce._randomFrame,
    setFrame: (frame) => {
      ce._randomFrame = frame;
    },
    deadline: () => ce._deadlineFrame,
  };
}

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
      // A seed on the complex lane (`WithRandomSeed(√x, …)` with `x` real)
      // arrives as a `{re, im}` object. The interpreter accepts a seed whose
      // value is a real number, so an object whose imaginary part is exactly
      // zero is read as its real part. Any other object is not a valid seed
      // and fails below, as the interpreter answers an error for it.
      if (
        typeof seed === 'object' &&
        seed !== null &&
        (seed as { im?: unknown }).im === 0 &&
        typeof (seed as { re?: unknown }).re === 'number'
      )
        seed = (seed as { re: number }).re;
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

    // `RandomSample(xs, k)` of a list of `n` elements: the indices from 0 of
    // the `k` elements, drawn WITHOUT replacement by the sparse Fisher-Yates
    // of the interpreter (`library/statistics.ts`): `k` draws, in order. A
    // count past `n` is an error there.
    randomSample: (n: number, k: unknown): number[] => {
      const m = count('RandomSample', k);
      if (m > n)
        throw new Error(
          `Could not compile \`RandomSample\`: expected a count in 0..${n}, got ${m}`
        );
      const swapped = new Map<number, number>();
      const at = (i: number): number => swapped.get(i) ?? i;
      const out: number[] = new Array(m);
      for (let i = 0; i < m; i++) {
        if ((i & 0x3ff) === 0) checkDeadline(source.deadline());
        const j = i + Math.floor(draw() * (n - i));
        const vi = at(i);
        const vj = at(j);
        swapped.set(i, vj);
        swapped.set(j, vi);
        out[i] = vj;
      }
      return out;
    },
  };
}

/** The modulo of the interpreter: the sign of the divisor (`Mod(-7, 3)` is
 *  2). Exact for integers below 2^53: `%` is exact in IEEE 754. There is no
 *  guard: for an operand of 2^53 or more the value is the remainder of the
 *  double, unspecified (`Mod(25!, 7)` is 0, the remainder of the double 6). */
export function floorMod(a: number, b: number): number {
  // The fractional part, `Mod(x, 1)`: the same double as the remainder
  // below (`x - floor(x)` is the rounding of `r + 1` for a negative `x`),
  // with no `%`, which is slow for a large `x` (`Mod(10^4·sin(…), 1)`).
  if (b === 1) return a - Math.floor(a);
  const r = a % b;
  return r !== 0 && r < 0 !== b < 0 ? r + b : r;
}

/** The largest exponent that `pow` computes by multiplications. */
export const MAX_PRODUCT_EXPONENT = 16;

/**
 * The real power of the profile `ir` (`_SYS.ir.pow`, and the fold): an
 * integer exponent 1 to 16 by multiplications from the left (exact on
 * integers in range); the exponent 0 gives 1 for a finite base other than
 * 0, and NaN for 0, NaN and an infinity (the interpreter's values); a
 * negative base with a non-integer exponent gives the interpreter's real
 * root when the exponent is `p/q` with an odd `q`
 * (`negativeBaseRealPow()`, the rule of `Power` on machine numbers, read to
 * the digits of the running code as `cpow` reads them), NaN otherwise (a
 * half-integer exponent, whose `q` is 2, without that search).
 */
export function realPow(a: number, b: number): number {
  if (Number.isInteger(b) && b >= 1 && b <= MAX_PRODUCT_EXPONENT) {
    let r = a;
    for (let i = 1; i < b; i++) r *= a;
    return r;
  }
  if (b === 0) return a !== 0 && Number.isFinite(a) ? 1 : NaN;
  // A half-integer exponent is `p/2`: no real value, without the search
  // for the terms of the exponent (`x^1.5` of a negative `x` in a loop).
  if (a < 0 && !Number.isInteger(b))
    return Number.isInteger(2 * b)
      ? NaN
      : (negativeBaseRealPow(a, undefined, b) ?? NaN);
  return Math.pow(a, b);
}

/**
 * The real functions of the profile `ir`, by the name of their IR
 * operation (`_SYS.ir.<name>`); the fold of their row computes them. Each
 * one gives the interpreter's real value within the precision of a double
 * (but see docs/COMPILATION-MODEL.md for `Zeta` below -171); a pole
 * (`Gamma(-2)`, `Coth(0)`) is +∞ or -∞, and a value that is not real is
 * NaN (the caveats of compiled code). `root(x, n)` of a negative `x` is the
 * real root when `n` is an odd integer, or when `1/n` is a rational of odd
 * denominator, as `realPow`.
 */
export const REAL_FUNCTIONS = Object.freeze({
  root: (x: number, n: number): number => {
    if (n === 0) return NaN;
    if (x < 0 && Number.isInteger(n) && n % 2 !== 0)
      return -Math.pow(-x, 1 / n);
    return negativeBaseRealPow(x, undefined, 1 / n) ?? Math.pow(x, 1 / n);
  },
  erf: (x: number): number => erf(x),
  erfc: (x: number): number => erfc(x),
  fresnelc: (x: number): number => fresnelC(x),
  fresnels: (x: number): number => fresnelS(x),
  // `Sinc(±∞)` is 0.
  sinc: (x: number): number => (Math.abs(x) === Infinity ? 0 : sinc(x)),
  gamma: (x: number): number =>
    Number.isInteger(x) && x <= 0 ? Infinity : gamma(x),
  gammaln: (x: number): number => lnAbsGamma(x),
  factorial: (x: number): number =>
    Number.isInteger(x) ? (x < 0 ? Infinity : factorial(x)) : gamma(x + 1),
  factorial2: (x: number): number =>
    Number.isInteger(x) && x < 0 && x % 2 === 0 ? Infinity : factorial2(x),
  zeta: (x: number): number => zeta(x),
  // `Chop(x, tol)`: the interpreter's test on a double.
  chop: (x: number, tol: number): number => (Math.abs(x) <= tol ? 0 : x),
  // The interpreter has no -0: `Arctan2(-0, -1)` is π.
  atan2: (y: number, x: number): number => Math.atan2(y + 0, x + 0),
  // The interpreter's `Arccot` is in (0, π).
  acot: (x: number): number =>
    x > 0 ? Math.atan(1 / x) : Math.PI / 2 - Math.atan(x),
  asec: (x: number): number => Math.acos(1 / x),
  acsc: (x: number): number => Math.asin(1 / x),
  acoth: arcothReal,
  asech: arsechReal,
  acsch: arcschReal,
  coth: (x: number): number => 1 / Math.tanh(x),
  fract: (x: number): number => x - Math.floor(x),
  hav: (x: number): number => Math.sin(x / 2) ** 2,
  // The interpreter's `GCD` (`GCD(-12, 18)` is 6) and `LCM`, also of reals
  // that are not integers (`realGcd`, `realLcm`).
  gcd: (a: number, b: number): number => gcd(a, b),
  lcm: (a: number, b: number): number => lcm(a, b),
  // The library's special functions and steps, by the kernels of the
  // interpreter. Where the interpreter's value of real operands is not real
  // (`CosIntegral(-1)`, `EllipticK(2)`), NaN.
  heaviside: (x: number): number => SYS_HELPERS.heaviside(x),
  remainder: ieeeRemainder,
  smoothstep: (e0: number, e1: number, x: number): number =>
    SYS_HELPERS.smoothstep(e0, e1, x),
  // `InverseHaversine(x)` is `2·Arcsin(√x)`.
  invhav: (x: number): number => 2 * Math.asin(Math.sqrt(x)),
  erfinv: (x: number): number => erfInv(x),
  erfi: (x: number): number => erfi(x),
  beta: (a: number, b: number): number => beta(a, b),
  // `BetaRegularized(x, a, b)` and `GammaRegularized(a, z)`, in the order of
  // the library's operands.
  betareg: (x: number, a: number, b: number): number =>
    betaRegularized(x, a, b),
  gammareg: (a: number, z: number): number => gammaQ(a, z),
  // A pole is +∞ (the interpreter's `~oo`).
  digamma: (x: number): number => SYS_HELPERS.digamma(x),
  trigamma: (x: number): number => SYS_HELPERS.trigamma(x),
  polygamma: (n: number, x: number): number => SYS_HELPERS.polygamma(n, x),
  airyai: (x: number): number => airyAi(x),
  airybi: (x: number): number => airyBi(x),
  airyaiprime: (x: number): number => airyAiPrime(x),
  airybiprime: (x: number): number => airyBiPrime(x),
  // Of an integer order `n` (the rows take no other). `Y₀(0)` is -∞ and
  // `K₀(0)` is +∞; at another order the pole is unsigned (NaN).
  besselj: (n: number, x: number): number => besselJ(n, x),
  bessely: (n: number, x: number): number =>
    n === 0 && x === 0 ? -Infinity : besselY(n, x),
  besseli: (n: number, x: number): number => besselI(n, x),
  besselk: (n: number, x: number): number =>
    n === 0 && x === 0 ? Infinity : besselK(n, x),
  sinint: (x: number): number => sinIntegral(x),
  // `Ci(x)` of a negative `x` is `Ci(-x) + iπ`: the kernel gives its real
  // part there.
  cosint: (x: number): number => (x < 0 ? NaN : cosIntegral(x)),
  expint: (x: number): number => expIntegralEi(x),
  logint: (x: number): number => logIntegral(x),
  agm: realAgm,
  // `AGM(x)` is `AGM(1, x)`.
  agm1: (x: number): number => realAgm(1, x),
  elliptick: (m: number): number => ellipticK(m),
  elliptice: (m: number): number => ellipticE(m),
  // The incomplete `EllipticE(φ, m)`, `EllipticF(φ, m)` and
  // `EllipticPi(n, φ, m)`; the complete `EllipticPi(n, m)`.
  ellipticeinc: (phi: number, m: number): number => ellipticEIncomplete(phi, m),
  ellipticf: (phi: number, m: number): number => ellipticF(phi, m),
  ellipticpi: (n: number, m: number): number => ellipticPiComplete(n, m),
  ellipticpiinc: (n: number, phi: number, m: number): number =>
    ellipticPiIncomplete(n, phi, m),
  hyp1f1: (a: number, b: number, z: number): number =>
    hypergeometric1F1(a, b, z),
  hyp2f1: (a: number, b: number, c: number, z: number): number =>
    hypergeometric2F1(a, b, c, z),
  hurwitzzeta: (s: number, a: number): number => hurwitzZeta(s, a),
  // `Zeta(s, a)`, the generalized zeta of Wolfram's convention, as the
  // interpreter's `evaluateGeneralizedZeta`: real for real operands, and
  // a pole at s = 1.
  zetagen: (s: number, a: number): number => zetaGeneralized(s, a),
  // `Gamma(s, z)`, the upper incomplete gamma (`realGammaUpper()`).
  gammaupper: (s: number, z: number): number => realGammaUpper(s, z),
  // `HarmonicNumber(n)` and `HarmonicNumber(n, r)` (`harmonicNumber()`).
  harmonic: (n: number): number => harmonicNumber(n),
  harmonic2: (n: number, r: number): number => harmonicNumber(n, r),
  lerchphi: (z: number, s: number, a: number): number => lerchPhiReal(z, s, a),
  polylog: (s: number, z: number): number => polylogOrderReal(s, z),
  dirichleteta: (s: number): number => dirichletEtaReal(s),
  dirichletbeta: (s: number): number => dirichletBetaReal(s),
  // `StieltjesGamma(n)` and `StieltjesGamma(n, a)`, of an integer order.
  stieltjes: (n: number): number => stieltjesGammaReal(n),
  stieltjesa: (n: number, a: number): number => stieltjesGammaReal(n, a),
  clausen: (n: number, x: number): number => clausen(n, x),
  // The principal branch, and the branch `k` (an integer).
  lambertw: (x: number): number => lambertW(x),
  lambertwk: (x: number, k: number): number => lambertW(x, k),
  fibonacci: realFibonacci,
  // A double of 2^53 or more is even: not a prime. An infinite operand
  // throws (the interpreter gives a type error).
  isprime: (n: number): boolean =>
    Number.isFinite(n) && Math.abs(n) > Number.MAX_SAFE_INTEGER
      ? false
      : isPrimeRuntime(n),
  // The number-theory functions of an integer, with the interpreter's
  // values (`library/number-theory.ts`); see `primeFactorExponents`.
  moebiusmu: (n: number): number => {
    const e = primeFactorExponents('MoebiusMu', n);
    if (e === undefined) return NaN;
    if (e.some((k) => k > 1)) return 0;
    return e.length % 2 === 0 ? 1 : -1;
  },
  primenu: (n: number): number =>
    primeFactorExponents('PrimeNu', n)?.length ?? NaN,
  primeomega: (n: number): number =>
    primeFactorExponents('PrimeOmega', n)?.reduce((a, k) => a + k, 0) ?? NaN,
  // φ(0) = 0 and φ(−n) = φ(n), as the interpreter's `Totient`.
  totient: (n: number): number => {
    if (n === 0) return 0;
    if (!Number.isInteger(n)) return NaN;
    const m = Math.abs(integerOperand('Totient', n));
    let phi = m;
    for (const p of primeFactorsOf(m)) phi = (phi / p) * (p - 1);
    return phi;
  },
  primepi: (x: number): number => primePi(x),
  nthprime: (n: number): number => nthPrime(n),
});

/**
 * The exponents of the prime factors of the integer `n`, its sign ignored:
 * `[]` for 1, and `undefined` for 0, `NaN` and a non-integer, where the
 * interpreter leaves the call unevaluated (compiled code gives `NaN`). An
 * operand beyond the safe integer range throws (`integerOperand`).
 */
function primeFactorExponents(
  operator: string,
  n: number
): number[] | undefined {
  if (!Number.isInteger(n)) return undefined;
  const m = Math.abs(integerOperand(operator, n));
  if (m === 0) return undefined;
  const exponents: number[] = [];
  let rest = m;
  for (const p of primeFactorsOf(m)) {
    let k = 0;
    while (rest % p === 0) {
      rest /= p;
      k += 1;
    }
    exponents.push(k);
  }
  return exponents;
}

/** The distinct prime factors of the positive safe integer `m`, by trial
 *  division. The division stops when the rest is prime (`isPrimeNumber`),
 *  so a large prime factor costs one primality test, not a division by
 *  every odd number below its square root. */
function primeFactorsOf(m: number): number[] {
  const primes: number[] = [];
  let rest = m;
  if (rest % 2 === 0) {
    primes.push(2);
    while (rest % 2 === 0) rest /= 2;
  }
  // The rest is tested when it changes, not at each divisor.
  let restIsPrime = rest > 1 && isPrimeNumber(rest);
  for (let d = 3; !restIsPrime && d * d <= rest; d += 2) {
    if (rest % d !== 0) continue;
    primes.push(d);
    while (rest % d === 0) rest /= d;
    restIsPrime = rest > 1 && isPrimeNumber(rest);
  }
  if (rest > 1) primes.push(rest);
  return primes;
}

/**
 * The bound of the sieve of `primePi` and `nthPrime`: the interpreter scans
 * at most 10⁷ odd numbers (`MAX_VALUE_SCALED_ITERATIONS` of
 * `library/number-theory.ts`), checked every 1,024 of them, so it gives an
 * error once it reaches 20,000,769, and the compiled code throws there. The
 * sieve is kept for the life of the process: about 20 MB at the bound.
 */
const SIEVE_LIMIT = 20_000_768;
/** The number of primes up to `SIEVE_LIMIT`. */
const PRIMES_TO_LIMIT = 1_270_660;
/** The primes counted below each multiple of `SIEVE_BLOCK`. */
const SIEVE_BLOCK = 256;
let sieve: { composite: Uint8Array; before: Uint32Array; size: number } = {
  composite: new Uint8Array(0),
  before: new Uint32Array(1),
  size: 0,
};

/** The sieve, grown to hold `n`: a plot calls `PrimePi` once for each
 *  sample, so the sieve is kept and grown by doubling. */
function sieveTo(n: number): typeof sieve {
  if (n < sieve.size) return sieve;
  const size = Math.min(SIEVE_LIMIT + 1, Math.max(2 * n, 1 << 16));
  const composite = new Uint8Array(size);
  composite[0] = 1;
  if (size > 1) composite[1] = 1;
  for (let p = 2; p * p < size; p++) {
    if (composite[p]) continue;
    for (let q = p * p; q < size; q += p) composite[q] = 1;
  }
  const before = new Uint32Array(Math.ceil(size / SIEVE_BLOCK) + 1);
  let count = 0;
  for (let i = 0; i < size; i++) {
    if (i % SIEVE_BLOCK === 0) before[i / SIEVE_BLOCK] = count;
    if (!composite[i]) count += 1;
  }
  // The last entry counts every prime of the sieve.
  before[before.length - 1] = count;
  sieve = { composite, before, size };
  return sieve;
}

/** The interpreter's `PrimePi(x)`: the number of primes up to `⌊x⌋`, `NaN`
 *  for an operand that is not finite. */
function primePi(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const n = Math.floor(x);
  if (n < 2) return 0;
  if (n > SIEVE_LIMIT)
    throw new RangeError(
      `PrimePi: ${n} is beyond the bound of compiled code (${SIEVE_LIMIT}); ` +
        `the interpreter gives an error there too`
    );
  const s = sieveTo(n);
  const block = Math.floor(n / SIEVE_BLOCK);
  let count = s.before[block];
  for (let i = block * SIEVE_BLOCK; i <= n; i++) if (!s.composite[i]) count++;
  return count;
}

/** The interpreter's `NthPrime(n)`: the `n`th prime, 1-based; `NaN` for
 *  `n < 1` and for a non-integer, where the interpreter leaves the call
 *  unevaluated. */
function nthPrime(n: number): number {
  if (!Number.isInteger(n) || n < 1) return NaN;
  if (n > PRIMES_TO_LIMIT)
    throw new RangeError(
      `NthPrime: the prime ${n} is beyond the bound of compiled code ` +
        `(${SIEVE_LIMIT}); the interpreter gives an error there too`
    );
  // The `n`th prime is less than n·(ln n + ln ln n) for n ≥ 6.
  const bound =
    n < 6 ? 16 : Math.ceil(n * (Math.log(n) + Math.log(Math.log(n))));
  const s = sieveTo(Math.min(bound, SIEVE_LIMIT));
  const blocks = s.before.length - 1;
  if (s.before[blocks] < n)
    throw new RangeError(
      `NthPrime: the prime ${n} is beyond the bound of compiled code ` +
        `(${SIEVE_LIMIT}); the interpreter gives an error there too`
    );
  // The last block whose count of the primes before it is less than `n`.
  let lo = 0;
  let hi = blocks - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s.before[mid] < n) lo = mid;
    else hi = mid - 1;
  }
  let count = s.before[lo];
  for (let i = lo * SIEVE_BLOCK; i < s.size; i++) {
    if (s.composite[i]) continue;
    count += 1;
    if (count === n) return i;
  }
  return NaN;
}

/**
 * The interpreter's `Remainder(x, y)`: `x - y·n` for the integer `n`
 * nearest to `x / y`, a tie rounded toward +∞. Exact for every pair of
 * doubles: the remainder `x % y` is exact, and a correction by `|y|` of a
 * value between `|y|/2` and `|y|` is exact. NaN for a divisor that is 0 or
 * not finite, as the interpreter's.
 */
function ieeeRemainder(x: number, y: number): number {
  if (!Number.isFinite(y)) return NaN;
  const r = x % y;
  const h = Math.abs(y) / 2;
  return Math.abs(r) > h || (Math.abs(r) === h && r / y > 0)
    ? r - Math.sign(r) * Math.abs(y)
    : r;
}

/**
 * The interpreter's `Gamma(s, z)` of reals, the upper incomplete gamma: the
 * real kernel for `z > 0`; at `z = 0`, `Gamma(s)` (+∞ at a non-positive
 * integer `s`, the interpreter's `~oo`); for `z < 0`, the complex kernel's
 * value where it is real (`s` a positive integer), NaN where it is not.
 */
function realGammaUpper(s: number, z: number): number {
  if (Number.isNaN(s) || Number.isNaN(z)) return NaN;
  if (z === 0) return Number.isInteger(s) && s <= 0 ? Infinity : gamma(s);
  if (z > 0) return incompleteGammaUpper(s, z);
  const c = incompleteGammaUpperComplex(new Complex(s, 0), new Complex(z, 0));
  return c.im === 0 ? c.re : NaN;
}

const EULER_GAMMA = 0.5772156649015329;

/**
 * The interpreter's `HarmonicNumber(n)` (`r = 1`) and `HarmonicNumber(n, r)`
 * of reals (`evaluateHarmonicNumber()`): 0 at `n = 0`; at a negative integer
 * `n` a pole (+∞) for `r > 0`, and NaN otherwise (the interpreter leaves it
 * unevaluated); at `n = +∞`, +∞ for `HarmonicNumber(n)` and `ζ(r)` for
 * `r > 1`; at `r = +∞`, 1 for `n > 0`, −∞ for `−1 < n < 0`, NaN below.
 * Otherwise `ψ(n + 1) + γ` for `r = 1`, its Taylor series
 * `Σ (−1)^k ζ(k) n^(k−1)` (k ≥ 2) for `|n| < 0.1`, where the sum cancels;
 * the sum of `k^(−r)` for an integer `n` from 1 to 1000; else
 * `ζ(r) − ζ(r, n + 1)`.
 */
function harmonicNumber(n: number, r?: number): number {
  if (Number.isNaN(n) || (r !== undefined && Number.isNaN(r))) return NaN;
  if (n === Infinity) return r === undefined ? Infinity : r > 1 ? zeta(r) : NaN;
  // H(n, +∞): the term 1 of k = 1, less (n + 1)^(−r) below n = 0.
  if (r === Infinity && Number.isFinite(n)) {
    if (Number.isInteger(n) && n <= 0) return n === 0 ? 0 : Infinity;
    return n > 0 ? 1 : n > -1 ? -Infinity : NaN;
  }
  if (n === -Infinity || (r !== undefined && !Number.isFinite(r))) return NaN;
  if (Number.isInteger(n) && n < 0)
    return r === undefined || r > 0 ? Infinity : NaN;
  if (n === 0) return 0;
  if (r === undefined || r === 1) {
    if (Math.abs(n) >= 0.1) return digamma(n + 1) + EULER_GAMMA;
    let sum = 0;
    let p = 1;
    // `ζ(k) < 2` and `|n| < 0.1`: the terms past the 23rd are below 1e-22.
    for (let k = 2; k <= 24; k++, p *= -n) sum += zeta(k) * p;
    return sum * n;
  }
  if (Number.isInteger(n) && n <= 1000) {
    let sum = 0;
    for (let k = n; k >= 1; k--) sum += Math.pow(k, -r);
    return sum;
  }
  // ζ(r) − ζ(r, n + 1) cancels near n = 0 and near r = 1 (each is about
  // 1/(r − 1)).
  // Each series gives `undefined` when it does not converge (a large `r`).
  const series =
    Math.abs(n) < 0.1 && r > -5
      ? harmonicNearZero(n, r)
      : n > -1 && r > -5 && Math.abs(r - 1) < 0.5
        ? harmonicSeries(n, r)
        : undefined;
  return series ?? zeta(r) - hurwitzZeta(r, n + 1);
}

/**
 * The generalized harmonic number for `|n| < 0.1`, by the binomial series of
 * `(k + n)^(−r)`: `Σ_{j ≥ 1} −(−n)^j (r)_j / j! ζ(r + j)`. At an integer
 * `r ≤ 0` the term of `ζ(1)` is its limit, `n^j / j`, and the later terms
 * are 0 (a polynomial: `HarmonicNumber(n, 0)` is `n`).
 */
function harmonicNearZero(n: number, r: number): number | undefined {
  let sum = 0;
  let c = 1;
  let p = 1;
  let peak = 0;
  for (let j = 1; j <= 100; j++) {
    p *= -n;
    if (r + j === 1) return sum + Math.pow(n, j) / j;
    c *= (r + j - 1) / j;
    const t = c * p * zeta(r + j);
    peak = Math.max(peak, Math.abs(t));
    sum -= t;
    // Past `r + j = 2`, `ζ(r + j) < 2`; where the ratio of two terms,
    // `|n|·(r + j)/(j + 1)`, is below 1/2 and falls, the rest is below the
    // last term.
    if (
      r + j > 2 &&
      (Math.abs(n) * (r + j)) / (j + 1) < 0.5 &&
      Math.abs(c * p) <= 1e-17 * Math.abs(sum)
    )
      // Terms much larger than the sum cancel: their rounding is in it.
      return peak <= 10 * Math.abs(sum) ? sum : undefined;
  }
  // Not converged: the terms of a large `r` grow before they fall.
  return undefined;
}

/** The Bernoulli numbers `B₂`, `B₄`, … `B₁₂`, each over `(2j)!`. */
const BERNOULLI_OVER_FACTORIAL = [
  1 / 6 / 2,
  -1 / 30 / 24,
  1 / 42 / 720,
  -1 / 30 / 40320,
  5 / 66 / 3628800,
  -691 / 2730 / 479001600,
];

/**
 * `Σ_{k ≥ 1} k^(−r) − (k + n)^(−r)`, the generalized harmonic number, for
 * `n > −1`: the terms below `k = 20`, then the Euler–Maclaurin sum of the
 * rest, whose integral `(20^(1−r) − (20 + n)^(1−r)) / (r − 1)` is written
 * with `expm1` and `log1p`, so that no term cancels at `r = 1`.
 */
function harmonicSeries(n: number, r: number): number | undefined {
  const M = 20;
  let sum = 0;
  for (let k = M - 1; k >= 1; k--) sum += Math.pow(k, -r) - Math.pow(k + n, -r);
  const l = Math.log1p(n / M);
  const u = (1 - r) * l;
  const integral = Math.pow(M, 1 - r) * (u === 0 ? l : (l * Math.expm1(u)) / u);
  let tail = integral + (Math.pow(M, -r) - Math.pow(M + n, -r)) / 2;
  // f^(m)(M) = (−1)^m (r)_m (M^(−r−m) − (M + n)^(−r−m)), for m = 2j − 1.
  let rising = r;
  let last = 0;
  for (let j = 1; j <= BERNOULLI_OVER_FACTORIAL.length; j++) {
    const m = 2 * j - 1;
    if (j > 1) rising *= (r + m - 2) * (r + m - 1);
    const d = -rising * (Math.pow(M, -r - m) - Math.pow(M + n, -r - m));
    last = BERNOULLI_OVER_FACTORIAL[j - 1] * d;
    tail -= last;
  }
  // The error of the asymptotic sum is about its last term.
  const value = sum + tail;
  return Math.abs(last) <= 1e-16 * Math.abs(value) ? value : undefined;
}

/**
 * The interpreter's real `AGM(a, b)`: 0 when an operand is 0, `-AGM(-a, -b)`
 * of two negative operands, NaN (a complex value) of operands of opposite
 * signs.
 */
function realAgm(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  if (a === 0 || b === 0) return 0;
  return a < 0 && b < 0 ? -agm(-a, -b) : agm(a, b);
}

/**
 * The Fibonacci number `F(n)` as a double: NaN for an `n` that is not an
 * integer, ±∞ beyond `|n| = 1476` (`F(1477)` is above the largest double),
 * `F(-n) = (-1)^(n+1)·F(n)`. Exact up to `|n| = 78`; above, within about
 * 1e-15 relative.
 */
function realFibonacci(n: number): number {
  if (!Number.isInteger(n)) return NaN;
  const m = Math.abs(n);
  let f = Infinity;
  if (m <= 1476) {
    let [a, b] = [0, 1];
    for (let i = 0; i < m; i++) [a, b] = [b, a + b];
    f = a;
  }
  return n < 0 && m % 2 === 0 ? -f : f;
}

// prettier-ignore
const IR_KERNELS = ['cneg', 'csqrt', 'cexp', 'cln', 'clog10', 'csin', 'ccos', 'ctan', 'ccot', 'csec', 'ccsc',
  'csinh', 'ccosh', 'ctanh', 'csech', 'ccsch', 'catan',
  'casin', 'cacos', 'cacot', 'casec', 'cacsc', 'ccoth', 'casinh', 'cacosh', 'catanh', 'cacoth',
  'casech', 'cacsch', 'cconj', 'cabs', 'carg'] as const;

type Cx = ComplexResult;

/** `escapeTime()` from `(zx, zy)`, NaN for a point that is not finite or a
 *  count that is not positive (`library/fractals.ts`). */
function fractal(zx: number, zy: number, c: Cx, n: number): number {
  if (
    !Number.isFinite(zx) ||
    !Number.isFinite(zy) ||
    !Number.isFinite(c.re) ||
    !Number.isFinite(c.im) ||
    !Number.isFinite(n) ||
    !(n > 0)
  )
    return NaN;
  return escapeTime(zx, zy, c.re, c.im, Math.round(n));
}

/**
 * The complex functions of the profile `ir`, by the name of their IR
 * operation (`_SYS.ir.<name>`); the fold computes them: the machine complex
 * functions of `SYS_HELPERS` (complex.js and the kernels of
 * `numerics/numeric-complex.ts`), and the ring operations part by part.
 * `cplx` is the conversion of a real.
 */
export const COMPLEX_FUNCTIONS = Object.freeze({
  cplx: (x: number): Cx => ({ re: x, im: 0 }),
  cadd: (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im }),
  csub: (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im }),
  cmul: (a: Cx, b: Cx): Cx => ({
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
  }),
  // The interpreter's quotient (`complexQuotient()`): the textbook formula
  // where its intermediate values are ordinary doubles; the scaled
  // division and the poles otherwise.
  cdiv: (a: Cx, b: Cx): Cx => {
    const d = b.re * b.re + b.im * b.im;
    const nr = a.re * b.re + a.im * b.im;
    const ni = a.im * b.re - a.re * b.im;
    return textbookQuotientIsAccurate(a.re, a.im, b.re, b.im, d, nr, ni)
      ? { re: nr / d, im: ni / d }
      : SYS_HELPERS.cdivedge(a.re, a.im, b.re, b.im);
  },
  // `z^2` and `z^3` of a finite `z` off the real axis: the products of the
  // interpreter (`integerPower()` of `complexPow()`), without the two
  // `Complex` objects of the general power.
  cpow: (a: Cx, b: Cx): Cx => {
    if (
      b.im === 0 &&
      (b.re === 2 || b.re === 3) &&
      a.im !== 0 &&
      Number.isFinite(a.re) &&
      Number.isFinite(a.im)
    ) {
      let re = a.re * a.re - a.im * a.im;
      let im = 2 * a.re * a.im;
      if (b.re === 3) [re, im] = [a.re * re - a.im * im, a.re * im + a.im * re];
      if (Number.isFinite(re) && Number.isFinite(im))
        return { re: re === 0 ? 0 : re, im: im === 0 ? 0 : im };
    }
    return SYS_HELPERS.cpow(a, b);
  },
  croot: (a: Cx, b: Cx): Cx => SYS_HELPERS.croot(a, b),
  ...(Object.fromEntries(IR_KERNELS.map((f) => [f, SYS_HELPERS[f]])) as Pick<
    typeof SYS_HELPERS,
    (typeof IR_KERNELS)[number]
  >),
  // The special functions continued into the complex plane, the
  // interpreter's kernels (`continuedKernel`).
  cinvhav: (z: Cx): Cx => SYS_HELPERS.cinvhav(z),
  // `Gamma(z)` of a complex: the real kernel on the real axis (a pole is
  // +∞), the interpreter's complex kernel (Lanczos with the reflection
  // formula) elsewhere.
  cgamma: (z: Cx): Cx =>
    continuedKernel([z], REAL_FUNCTIONS.gamma, (z) => complexGamma(z)),
  // `Gamma(s, z)`: complex for `z < 0` unless `s` is a positive integer
  // (`Γ(0, −1)` is `−1.895 − πi`).
  cgammaupper: (s: Cx, z: Cx): Cx =>
    continuedKernel([s, z], realGammaUpper, incompleteGammaUpperComplex),
  // The interpreter's `Sign` of a complex, `z/|z|`, and 0 at 0. The parts
  // are scaled by the larger one first, so that a modulus near the top of
  // the doubles does not overflow.
  csign: (z: Cx): Cx => {
    if (Number.isNaN(z.re) || Number.isNaN(z.im)) return { re: NaN, im: 0 };
    if (z.im === 0) return { re: Math.sign(z.re) + 0, im: 0 };
    const s = Math.max(Math.abs(z.re), Math.abs(z.im));
    const [a, b] = [z.re / s, z.im / s];
    const m = Math.hypot(a, b);
    return { re: a / m + 0, im: b / m };
  },
  churwitzzeta: (s: Cx, a: Cx): Cx => SYS_HELPERS.churwitzZeta(s, a),
  // ζ(s) = ζ(s, 1): the interpreter evaluates `Zeta` of a complex `s` with
  // the Hurwitz kernel at `a = 1` (CE-1600).
  czeta: (s: Cx): Cx => SYS_HELPERS.churwitzZeta(s, { re: 1, im: 0 }),
  clerchphi: (z: Cx, s: Cx, a: Cx): Cx => SYS_HELPERS.clerchPhi(z, s, a),
  cpolylog: (s: Cx, z: Cx): Cx => SYS_HELPERS.cpolyLog(s, z),
  celliptick: (m: Cx): Cx => SYS_HELPERS.cellipticK(m),
  celliptice: (m: Cx): Cx => SYS_HELPERS.cellipticE(m),
  chyp2f1: (a: Cx, b: Cx, c: Cx, z: Cx): Cx =>
    SYS_HELPERS.chypergeometric2F1(a, b, c, z),
  clambertw: (z: Cx): Cx => SYS_HELPERS.clambertW(z),
  // The smooth escape time of `z -> z^2 + c` (`Mandelbrot(c, n)`,
  // `Julia(z, c, n)`), the interpreter's function. NaN where the
  // interpreter gives the call unevaluated: a point that is not finite, or a
  // count that is not positive.
  mandelbrot: (c: Cx, n: number): number => fractal(0, 0, c, n),
  julia: (z: Cx, c: Cx, n: number): number => fractal(z.re, z.im, c, n),
  cre: (z: Cx): number => z.re,
  cim: (z: Cx): number => z.im,
  ceq: (a: Cx, b: Cx): boolean => a.re === b.re && a.im === b.im,
  cne: (a: Cx, b: Cx): boolean => a.re !== b.re || a.im !== b.im,
});

/**
 * The functions that the code of the profile `ir` calls as `_SYS.ir.<name>`
 * (`ir/print-js.ts`). They are under one member so that no name of the IR
 * meets a member of `SYS_HELPERS` of another meaning. The other members that
 * the profile calls are
 * members of `_SYS` itself: `drawNextRandomNumber`, `withRandomSeed`,
 * `rangeCount`, `countLoopPass`, `resetLoopPasses`, `tick`.
 */
export const IR_FUNCTIONS = Object.freeze({
  ...REAL_FUNCTIONS,
  ...COMPLEX_FUNCTIONS,
  pow: realPow,
  mod: floorMod,
});

/**
 * Build the `_SYS` bundle for ONE compiled function.
 *
 * The stateless helpers are shared through the prototype chain (no per-compile
 * copying); the random and lazy-stream families get own bindings over
 * `source`, so `_SYS.drawNextRandomNumber()` resolves the active
 * `WithRandomSeed` frame at call time.
 *
 * The own helpers are written in one object literal, which then gets
 * `SYS_HELPERS` as its prototype. V8 keeps such an object in fast mode. An
 * object that receives more than about 16 properties through
 * `Object.assign` or through stores with computed keys after its creation
 * goes to dictionary mode, and then each `_SYS.name` read of the compiled
 * code is a hash lookup: a loop that reads a few helpers per pass ran about
 * three times slower. Stores with literal names and `Object.defineProperties`
 * (as `createSysRuntime` adds its members) do not have this low limit.
 */
export function makeSysHelpers(source: RuntimeSource): SysHelpers {
  // The integrals' Monte-Carlo samples come from the live source, never from
  // `Math.random` directly: a host that mocks or denies it must see compiled
  // code follow. The draw is live inside a `WithRandomSeed` frame too —
  // compiled integrals sample live by ruling (`docs/RANDOMNESS-MODEL.md`).
  const draw = (): number => source.random();
  let ticks = 0;
  const own: Partial<SysHelpers> = {
    ...makeRandomHelpers(source),
    ...makeLoopPassCounter(),
    ir: IR_FUNCTIONS,
    // `n` passes of a loop or a build of the profile `ir` (one when not
    // given): the deadline is checked, and one step charged, each time the
    // count crosses a multiple of 1024 (once for `n` above 1024). The count
    // is on the deadline frame when there is one, so the steps charged to a
    // step budget do not depend on earlier calls; it is kept modulo 1024, so
    // it never stops advancing.
    tick: (n = 1): void => {
      const d = source.deadline();
      if (d === undefined || !(n > 0)) return;
      const r = ((typeof d === 'object' ? (d.tick ?? 0) : ticks) & 1023) + n;
      if (typeof d === 'object') d.tick = r & 1023;
      else ticks = r & 1023;
      if (r >= 1024) checkDeadline(d);
    },
    integrate: (fn, a, b, initialPanels) =>
      SYS_HELPERS.integrate(fn, a, b, initialPanels, draw),
    irIntegrate: (fn, a, b) => SYS_HELPERS.integrate(fn, a, b, undefined, draw),
    integrateMC: (fn, a, b) => SYS_HELPERS.integrateMC(fn, a, b, draw),
  };
  return Object.setPrototypeOf(own, SYS_HELPERS) as SysHelpers;
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
 * recognize `~oo` when it FOLDS a constant subtree, so the two routes agree on what counts as a pole.
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
const isNumericTypedArray = (v: unknown): v is ArrayLike<number> =>
  ArrayBuffer.isView(v) &&
  NUMERIC_TYPED_ARRAY_BRANDS.has(Object.prototype.toString.call(v));

/**
 * The D3 ENTRY CHECK of a compiled JavaScript runner (design §8 D3,
 * `docs/COMPILATION-MODEL.md`): the one runtime input the
 * static analysis cannot see is the value a caller binds at `run()` time, so
 * each free symbol (expression route) or positional parameter (lambda route)
 * is checked against the SHAPE the compilation analyzed it as:
 *
 * The plan CONVERTS some values and tests no value against its type: the
 * host supplies every input with a value of its declared type, and the
 * result for a value outside that type (an array or a string for a number
 * binding, a number for a `string` binding) is undefined
 * (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code"). The
 * conversions and refusals:
 *
 * - analyzed REAL: the unsigned pole `~oo` is PROJECTED to `Infinity` (see
 *   `isUnsignedPole` below), the spelling compiled code gives a pole it
 *   computes itself. Any other `{re, im}` object THROWS a `TypeError` that
 *   names the binding: a real binding can have the static type `number`
 *   (an undeclared free symbol), where a complex value is a value of its
 *   type, and the compiled code would read it as a number;
 * - analyzed COMPLEX (a `complex`-typed symbol or annotated parameter): a
 *   plain number is LIFTED to `{re, im: 0}` — a real IS a complex, and the
 *   compiled code reads `.re`/`.im` off it;
 * - analyzed as a LIST (a binding whose declared type proves a JS array): the
 *   value passes as it is, with no copy and no read of its entries. A
 *   numeric typed array and a string are values of some collection types
 *   that the compiled code cannot read, and are refused with a `TypeError`
 *   that names the binding (`refuseTypedArrayEntry`, `refuseStringEntry`).
 *   The plain-array carrier is described in
 *   `docs/plans/2026-09-07-numeric-list-store-and-typed-array-boundary.md`.
 *
 * `strings` names the bindings that the compiled code reads as JavaScript arrays;
 * `namedEntryError` reads it to name such a binding when the body fails on
 * a value that is not an array.
 *
 * The plan has no test for an input that the caller leaves out: the host
 * supplies every input with a value of its declared type, and the result for
 * an input left out is undefined (`docs/COMPILATION-MODEL.md`, "Caveats of
 * compiled code").
 *
 * In `mode: 'bigint'` an integer input (`bigints`) accepts a `bigint` and a
 * `number` that is a safe integer, which the emitted code converts with
 * `BigInt(x)`. Any other value THROWS a `TypeError` that names the binding
 * (`checkBigintEntry`). A `list<integer>` input (`bigintLists`) is the one
 * exception to the rule below that the entries of a list are never read:
 * the check converts each `number` cell to a `bigint` in a copy, and
 * refuses a cell that is neither a safe integer nor a `bigint`
 * (`liftBigintList`). The emitted code does not convert the cells of a
 * list, so with the entry checks off the host gives `bigint` cells.
 * (`docs/plans/2026-10-31-ce715-bigint-compile-mode.md`, §3.5.)
 *
 * One `typeof` (and, for a list binding, one brand check) per checked
 * binding per call, and never a read of the entries of a collection: the
 * work at the boundary is constant per binding, however long a list input
 * is. A per-call walk of a list input costs as much as the kernel it guards
 * when the kernel reads one element and is called a million times, so the
 * compiled route requires shaped inputs instead, and the interpreter is the
 * route that validates. The vars object is never mutated (a lifted copy is
 * built only when a lift is needed).
 */
export type EntryPlan =
  | {
      kind: 'vars';
      real: string[];
      complex: string[];
      lists: string[];
      strings: Map<string, string>;
      kinds?: Map<string, KindEntry>;
      /** The symbols declared `boolean` (also in `real`); read only by
       * `broadcast()`, for which an empty array is an empty column. */
      booleans?: string[];
      /** `mode: 'bigint'`: the integer inputs (`checkBigintEntry`). */
      bigints?: string[];
      /** `mode: 'bigint'`: the `list<integer>` inputs, also in `lists`
       * (`liftBigintList`). */
      bigintLists?: string[];
    }
  | {
      kind: 'args';
      real: number[];
      complex: number[];
      lists: number[];
      strings: Map<number, string>;
      kinds?: Map<number, KindEntry>;
      bigints?: number[];
      bigintLists?: number[];
      /** `mode: 'bigint'`: the integer parameters (also in `bigints`) that
       * have a default value. The check skips such a parameter when its
       * argument is left out (`undefined`), which the default fills; a
       * supplied `null` or `NaN` is checked as any other value. `run()`
       * fills the default value before the check,
       * and the code that `load()` makes fills it in the emitted function,
       * after the check. The default value is a `bigint`, so both give the
       * same result. */
      bigintDefaults?: number[];
    };

/**
 * The entry check of a binding of a VALUE KIND type (`gf8`, a type declared
 * by the host with a compile contract): the binding is not read as a number
 * or a collection, and the value given for it must pass `check`, the `entry`
 * of the kind's contract. `label` names the binding and
 * its type in the error. A stored plan cannot carry `check`, which is a
 * function of the host: a plan with such a binding is not stored, and a
 * runtime refuses to load code compiled with one (`restoreEntryPlan`).
 */
type KindEntry = {
  label: string;
  check: (value: unknown) => boolean;
};

export function kindEntryError(label: string): TypeError {
  return new TypeError(
    `${label} is compiled as a value of its kind type, and the value given for it is not one: the entry check of the kind refused it.`
  );
}

/** The text of a value in the error of an entry check of `mode: 'bigint'`. */
function bigintEntryValueText(x: unknown): string {
  if (typeof x === 'number') return `the number ${String(x)}`;
  if (typeof x === 'string') return `the string ${JSON.stringify(x)}`;
  if (x === undefined) return 'no value';
  if (x === null) return 'null';
  if (Array.isArray(x)) return 'an array';
  return `a value of type ${typeof x}`;
}

/**
 * Throw when `x`, the value of the integer input `binding` of
 * `mode: 'bigint'`, is neither a `bigint` nor a `number` that is a safe
 * integer. The emitted code converts a safe-integer `number` with
 * `BigInt(x)`. A `number` that is not a safe integer does not identify one
 * integer, and any other value has no integer value.
 */
function checkBigintEntry(binding: string, x: unknown): void {
  if (typeof x === 'bigint') return;
  if (typeof x === 'number' && Number.isSafeInteger(x)) return;
  throw new TypeError(
    `${binding} was compiled in mode 'bigint' as an integer, and received ${bigintEntryValueText(x)}. Pass a bigint, or a number that is a safe integer.`
  );
}

/**
 * The value `x` of the `list<integer>` input `binding` of `mode: 'bigint'`,
 * with each `number` cell converted to a `bigint`. The array of the caller
 * is not changed: a copy is made when a cell is converted, and `x` is
 * returned when no cell is a `number`. A nested array is converted in the
 * same way. A cell that is neither a `bigint` nor a safe-integer `number`
 * throws a `TypeError`, which names the cell by its index path from the
 * outer array (`element 2, 2` for the cell `x[1][1]`): `path` is the path of
 * `x` in the outer array, and is empty for the outer array. A value that is
 * not an array is returned as it is: the other checks of a list binding
 * apply to it.
 */
function liftBigintList(binding: string, x: unknown, path = ''): unknown {
  if (!Array.isArray(x)) return x;
  let out: unknown[] | undefined;
  for (let i = 0; i < x.length; i++) {
    const cell: unknown = x[i];
    let y: unknown = cell;
    if (typeof cell === 'number' && Number.isSafeInteger(cell))
      y = BigInt(cell);
    else if (Array.isArray(cell))
      y = liftBigintList(binding, cell, `${path}${i + 1}, `);
    else if (typeof cell !== 'bigint')
      throw new TypeError(
        `${binding} was compiled in mode 'bigint' as a list of integers, and its element ${path}${i + 1} is ${bigintEntryValueText(cell)}. Pass bigints, or numbers that are safe integers.`
      );
    if (y !== cell) {
      out ??= x.slice();
      out[i] = y;
    }
  }
  return out ?? x;
}

/**
 * Throw when the binding `key` is in `strings`, the bindings that the
 * compiled code reads as JavaScript arrays. A string is a value of a bare
 * `indexed_collection` or `collection` type, but the compiled code would
 * read it as UTF-16 code units, not as characters (`Length` of `"😀a"`
 * would be 3, not 2), so the value is refused rather than given a wrong
 * value. The value of `strings` is the label of the binding and its
 * declared type.
 */
function refuseStringEntry<K>(strings: Map<K, string>, key: K): void {
  const label = strings.get(key);
  if (label === undefined) return;
  throw new TypeError(
    `${label} is compiled as a JavaScript array, and compiled code does not accept a string for it: it would read the string as UTF-16 code units, not as characters. Pass an array, or declare the binding \`string\` to compile text.`
  );
}

/**
 * Throw for a numeric typed array bound to a binding the compiled code reads
 * as a JavaScript array. A typed array is a value of a `list` type, but the
 * compiled code reads plain arrays only, and the runner does not convert the
 * value (a copy on every call cost as much as the array): the host converts
 * it once, on its side. One brand check per list binding per call
 * (`isNumericTypedArray`).
 */
function refuseTypedArrayEntry(label: string): never {
  throw new TypeError(
    `${label} is compiled as a JavaScript array, and compiled code does not accept a typed array for it: it reads plain arrays only. Convert it once with Array.from(…) and pass the plain array.`
  );
}

/**
 * The error for a `{re, im}` value, other than `~oo`, bound to a binding
 * that the compiled code reads as a real number. `binding` names the
 * binding as the diagnostic shows it.
 */
function entryCheckError(binding: string): TypeError {
  return new TypeError(
    `${binding} was compiled as a real number but received a complex {re, im} value. Declare it complex, or compile with \`mode: 'complex'\`.`
  );
}

/**
 * The checked arguments of a call: the arguments, or a copy in which some
 * values are converted (a number for a complex binding, `~oo`, the cells of
 * a `list<integer>` in `mode: 'bigint'`).
 */
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
    // `{re, im}` value THROWS at a real binding: such a binding can have the
    // static type `number` (an undeclared free symbol, an unannotated lambda
    // parameter in the default mode), where the complex value is a value of
    // its type, and reading `3 + 4i` as a number would be silently wrong
    // (`"[object Object]1"` under `+`). Any other value is passed as it
    // is: a value outside the declared type of the binding gives an
    // undefined result.
    // A binding of a kind type is checked by the kind's own `entry`, and by
    // no other rule.
    if (plan.kinds !== undefined)
      for (const [id, k] of plan.kinds)
        if (!k.check(v[id])) throw kindEntryError(k.label);
    for (const id of plan.real) {
      const x = v[id];
      if (typeof x === 'number') continue;
      if (typeof x === 'string') refuseStringEntry(plan.strings, id);
      if (!isComplexObject(x)) continue;
      if (!isUnsignedPole(x)) throw entryCheckError(`"${id}"`);
      lifted ??= { ...v };
      lifted[id] = Infinity;
    }
    for (const id of plan.complex) {
      const x = v[id];
      if (typeof x === 'string') refuseStringEntry(plan.strings, id);
      if (typeof x !== 'number') continue;
      lifted ??= { ...v };
      lifted[id] = { re: x, im: 0 };
    }
    // `mode: 'bigint'`: the integer inputs, and the cells of the
    // `list<integer>` inputs, which are converted in a copy.
    if (plan.bigints !== undefined)
      for (const id of plan.bigints) checkBigintEntry(`"${id}"`, v[id]);
    if (plan.bigintLists !== undefined)
      for (const id of plan.bigintLists) {
        const x = v[id];
        const y = liftBigintList(`"${id}"`, x);
        if (y === x) continue;
        lifted ??= { ...v };
        lifted[id] = y;
      }
    // A list binding refuses a string and a typed array, which are values
    // of some collection types that the compiled code cannot read.
    for (const id of plan.lists) {
      const x = v[id];
      if (typeof x === 'string') refuseStringEntry(plan.strings, id);
      else if (isNumericTypedArray(x))
        refuseTypedArrayEntry(plan.strings.get(id) ?? `"${id}"`);
    }
    return lifted === undefined ? argumentsList : [lifted];
  }
  let lifted: unknown[] | undefined;
  if (plan.kinds !== undefined)
    for (const [i, k] of plan.kinds)
      if (!k.check(argumentsList[i])) throw kindEntryError(k.label);
  // The positional-parameter route makes the same `~oo` projection as the
  // free-symbol route above.
  for (const i of plan.real) {
    const x = argumentsList[i];
    if (typeof x === 'number') continue;
    if (typeof x === 'string') refuseStringEntry(plan.strings, i);
    if (!isComplexObject(x)) continue;
    if (!isUnsignedPole(x)) throw entryCheckError(`argument ${i + 1}`);
    lifted ??= [...argumentsList];
    lifted[i] = Infinity;
  }
  for (const i of plan.complex) {
    const x = argumentsList[i];
    if (typeof x === 'string') refuseStringEntry(plan.strings, i);
    if (typeof x !== 'number') continue;
    lifted ??= [...argumentsList];
    lifted[i] = { re: x, im: 0 };
  }
  // The `mode: 'bigint'` rules of the free-symbol route above.
  if (plan.bigints !== undefined)
    for (const i of plan.bigints) {
      // A left-out argument (`undefined`) for a parameter with a default
      // value gets the default value. A supplied absent value (`null`,
      // `NaN`) is not filled: a default fills only an argument that the
      // call leaves out (`docs/COMPILATION-MODEL.md`, "Function values").
      if (plan.bigintDefaults?.includes(i) && argumentsList[i] === undefined)
        continue;
      checkBigintEntry(`argument ${i + 1}`, argumentsList[i]);
    }
  if (plan.bigintLists !== undefined)
    for (const i of plan.bigintLists) {
      const x = argumentsList[i];
      const y = liftBigintList(`argument ${i + 1}`, x);
      if (y === x) continue;
      lifted ??= [...argumentsList];
      lifted[i] = y;
    }
  for (const i of plan.lists) {
    const x = argumentsList[i];
    if (typeof x === 'string') refuseStringEntry(plan.strings, i);
    else if (isNumericTypedArray(x))
      refuseTypedArrayEntry(plan.strings.get(i) ?? `argument ${i + 1}`);
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
    strings: [...plan.strings],
    // The bindings of a kind type, by name only: their check is a function
    // of the host, which stored data cannot carry.
    ...(plan.kinds !== undefined && plan.kinds.size > 0
      ? { kinds: [...plan.kinds.keys()] }
      : {}),
    ...(plan.kind === 'vars' &&
    plan.booleans !== undefined &&
    plan.booleans.length > 0
      ? { booleans: [...plan.booleans] }
      : {}),
    ...(plan.bigints !== undefined && plan.bigints.length > 0
      ? { bigints: [...plan.bigints] }
      : {}),
    ...(plan.bigintLists !== undefined && plan.bigintLists.length > 0
      ? { bigintLists: [...plan.bigintLists] }
      : {}),
    ...(plan.kind === 'args' &&
    plan.bigintDefaults !== undefined &&
    plan.bigintDefaults.length > 0
      ? { bigintDefaults: [...plan.bigintDefaults] }
      : {}),
  };
}

function restoreEntryPlan(stored: StoredEntryPlan): EntryPlan {
  // A binding of a kind type is checked by a function of the host that
  // compiled the code (`KindEntry`), which stored code does not carry: code
  // that needs that check is not run without it.
  if (stored.kinds !== undefined && stored.kinds.length > 0)
    throw new Error(
      `The stored code reads a value of a value kind (${stored.kinds.map((k) => `"${k}"`).join(', ')}), whose entry check is a function of the host that compiled it: it cannot be loaded. Run it with the \`run()\` of the compilation result.`
    );
  return {
    kind: stored.kind,
    real: [...stored.real],
    complex: [...stored.complex],
    lists: [...stored.lists],
    // A plan stored without the field refuses no string.
    strings: new Map(stored.strings ?? []),
    ...(stored.booleans !== undefined
      ? { booleans: [...stored.booleans] }
      : {}),
    // A plan stored without the fields checks no input of `mode: 'bigint'`.
    ...(stored.bigints !== undefined ? { bigints: [...stored.bigints] } : {}),
    ...(stored.bigintLists !== undefined
      ? { bigintLists: [...stored.bigintLists] }
      : {}),
    ...(stored.bigintDefaults !== undefined
      ? { bigintDefaults: [...stored.bigintDefaults] }
      : {}),
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
 * collection is normalized cell by cell WITHOUT a defensive copy
 * (`normalizeSharedArray`): it is returned as it is unless one of its cells
 * has to be rewritten by the convention, and a complex object is returned as
 * it is. The value may be a definition the runner evaluated once and keeps
 * for every later call (a hoisted constant list literal, a bound symbol
 * value), so a RESULT IS READ-ONLY BY CONTRACT: a caller that writes to a
 * returned array or `{re, im}` object changes what the next call answers.
 * The walk is one `typeof` per cell of a returned collection and allocates
 * nothing; it is the one per-call cost at the boundary that grows with the
 * result, and a defensive copy on top of it cost as much as the kernel for
 * a long result. A FUNCTION the kernel returns is returned under a wrapper
 * that applies this convention to what the function answers.
 *
 * The test is EXACT, not a chop: the transcendental kernels give an exact
 * zero part where the value has one (`kernelResult`), and chopping here would
 * violate the "never chop in ring arithmetic" rule (`1 + 1e-12i` is
 * `{re: 1, im: 1e-12}`).
 */
export function normalizeRunResult(r: unknown): unknown {
  if (typeof r === 'number' || typeof r === 'boolean') return r;
  // A result of `mode: 'bigint'` is returned as it is.
  if (typeof r === 'bigint') return r;
  if (Array.isArray(r)) return normalizeSharedArray(r);
  if (
    typeof r === 'object' &&
    r !== null &&
    typeof (r as ComplexResult).re === 'number' &&
    typeof (r as ComplexResult).im === 'number' &&
    (r as ComplexResult).im === 0
  )
    return (r as ComplexResult).re;
  // A complex object with a non-zero imaginary part is returned as it is
  // (read-only by contract, as a collection is).
  if (isComplexObject(r)) return r;
  if (typeof r === 'function') {
    const fn = r as (...args: unknown[]) => unknown;
    const wrapped = (...args: unknown[]): unknown =>
      normalizeRunResult(fn(...args));
    Object.defineProperty(wrapped, 'length', { value: fn.length });
    return wrapped;
  }
  return r;
}

/**
 * The result convention of `normalizeRunResult` applied to an array without
 * a defensive copy. The array is walked once; when no cell has to be
 * rewritten (every cell is a number, a boolean, or a nested array or complex
 * object that normalizes to itself), the array itself is returned. A copy is
 * built only when a cell changes, for example a `{re, im: 0}` cell that the
 * convention reads as a plain number, and only the cells that change are
 * rewritten in it, so the array the runner keeps is never written to. The
 * walk is one `typeof` per cell. (A number or boolean cell is tested inline:
 * a recursive call per cell cost as much as the computation it followed on
 * a 40 000-element result — Tycho item 264.)
 */
function normalizeSharedArray(r: unknown[]): unknown[] {
  const n = r.length;
  let out: unknown[] | undefined;
  for (let i = 0; i < n; i++) {
    const x = r[i];
    if (typeof x === 'number' || typeof x === 'boolean') continue;
    // A cell of a list result of `mode: 'bigint'` needs no change.
    if (typeof x === 'bigint') continue;
    const y = normalizeRunResult(x);
    if (y === x) continue;
    out ??= r.slice();
    out[i] = y;
  }
  return out ?? r;
}

/**
 * The compiled `IsPrime`, with the interpreter's answers: `false` for `NaN`,
 * for a non-integer and for an integer less than 2 (a negative integer is
 * not prime). An operand beyond the safe integer range, or infinite, throws
 * (`integerOperand`): its double does not identify one integer, and the
 * interpreter gives a type error for an infinite operand.
 */
function isPrimeRuntime(n: number): boolean {
  if (Number.isNaN(n)) return false;
  return isPrimeNumber(integerOperand('IsPrime', n));
}

// The version of the helper set (`common/runtime-versions.ts`).
export { RUNTIME_VERSION };

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
  /** @deprecated No effect: `ce.iterationLimit` applies to the interpreter
   * only, and compiled code is bounded by the compile option
   * `iterationBudget`. */
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
  /** The `assigns` field of the compilation result: the variables that a
   * lambda assigns. The loaded function takes the value of each one after
   * its arguments, and returns an array of the value of the lambda and the
   * new value of each one. The loaders do not read the field. */
  assigns?: string[];
  /** The digits a negative base's float exponent is read to; 17 when absent. */
  reconstructionDigits?: number;
  /** The input checks and conversions `run()` applies; `load()` applies them. */
  entryPlan?: StoredEntryPlan;
  /** The `mode` field of the compilation result: the mode the code was
   * compiled in. It is set whatever the entry checks are. `'bigint'` code
   * takes and returns JavaScript `bigint` values. Absent on code stored
   * before the field existed. */
  mode?: 'strict' | 'complex' | 'bigint';
  /** The `strings` field of the compilation result: the code reads or
   * returns a string, so the batch loaders refuse it. */
  strings?: boolean;
  /** The `rows` field of the compilation result: the result is a list of
   * lists whose rows can have different lengths, so the batch loaders
   * refuse it. */
  rows?: boolean;
  /** The count of values per cell that `loadBroadcast()` and
   * `loadBroadcastSlice()` write when the `outputs` option is absent: the
   * arity of a tuple-of-numbers expression. Absent means 1. */
  broadcastOutputs?: number;
  /** The batch body that `loadBroadcast()` and `loadBroadcastSlice()` run
   * in place of `code` when its shared lists pass the per-batch check
   * (`StoredBatchBody`). Read only by the runtime of the same version
   * (`runtimeVersion`). */
  batch?: StoredBatchBody;
  /** Required by `load()`. */
  runtimeVersion?: string;
  /** The `valueKinds` field of the compilation result: the value kind types
   * whose compiled representation the code reads or makes. `load()` and
   * the batch loaders refuse such code, whatever its `shippable` field
   * (`refuseStoredValueKinds`). */
  valueKinds?: string[];
  /** The `hostCalls` field of the compilation result: the functions of the
   * host that the code calls in the engine that compiled it. `load()` and
   * the batch loaders refuse such code (`refuseStoredValueKinds`). */
  hostCalls?: string[];
  /** The `shippable` field of the compilation result. `loadBroadcastAsync()`
   * sends a batch to a worker only when it is `true`: without it, every
   * batch runs on the calling thread (`reason: 'not-shippable'`). */
  shippable?: boolean;
  /** **Experimental.** The `profile` field of the compilation result: the
   * profile the code was compiled with. It records how the code was made,
   * for a host that keeps stored code with its compile options; the
   * loaders run the code the same way with or without it. */
  profile?: 'ir';
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
  /** @deprecated No effect on the code the runtime runs (see the option
   * `iterationLimit`). Reads back the value set: `Infinity` when 0 or less. */
  iterationLimit: number;
  deadline: number | undefined;
  /** The function the stored code denotes: `(vars?) => value` for code
   * compiled from an expression, `(...args) => value` for a lambda. Throws if
   * `runtimeVersion` is missing or differs. The definitions that read no
   * per-call value are evaluated once, here, as `run()` does. The inputs are
   * checked and converted by `entryPlan`, as `run()` does. */
  load(stored: StoredJavaScript): (...args: unknown[]) => unknown;
  /** The stored code as a batch evaluator: the `broadcast()` of the
   * compilation result (`compilation/broadcast.ts`), with the same inputs,
   * layouts and output. The variables the stored entry plan reads as lists
   * are shared inputs, and `broadcastOutputs` is the default count of values
   * per cell, as on the result. Code compiled from an expression only; a
   * lambda (`calling: 'lambda'`) throws. */
  loadBroadcast(
    stored: StoredJavaScript
  ): (inputs: BroadcastInputs, options?: BroadcastOptions) => Float64Array;
  /** The slice form of `loadBroadcast`: evaluate the cells of `slice` and
   * write them at the start of `out`, returning the count written
   * (`broadcastNumbersSlice` in `compilation/broadcast.ts`). The loop a
   * kernel worker runs for one task. */
  loadBroadcastSlice(
    stored: StoredJavaScript
  ): (
    inputs: BroadcastInputs,
    options: BroadcastOptions | undefined,
    out: Float64Array,
    slice: BroadcastSlice
  ) => number;
  /** The asynchronous form of `loadBroadcast`: the `broadcastAsync()` of the
   * compilation result, with the same options (`out`, `deadline`, `signal`,
   * `chunk`, `inline`, …) and result (`done`, `route`, `reason`). A large
   * batch goes to the kernel pool `workers` (from `createKernelPool()`),
   * other batches run on the calling thread in slices, with a turn of the
   * event loop between them. With no `workers`, every batch runs on the
   * calling thread (`reason: 'no-pool'`). Only stored code with
   * `shippable: true` (the field of the compilation result) goes to a
   * worker. The stored fields are copied at the call: a later change to
   * `stored` does not reach the function. The function also has
   * `willUsePool(cells)` and `shippable`, as the compilation result has.
   * Code compiled from an expression only; a lambda throws, and so does a
   * `workers` value that is not a pool from `createKernelPool()`. */
  loadBroadcastAsync(
    stored: StoredJavaScript,
    options?: { workers?: KernelPool }
  ): LoadedBroadcastAsync;
}

/** What `loadBroadcastAsync()` returns: the batch function, with the
 * `willUsePool` and `shippable` entries of a compilation result. */
export type LoadedBroadcastAsync = ((
  inputs: BroadcastInputs,
  options?: BroadcastAsyncOptions
) => Promise<BroadcastAsyncResult>) & {
  /** Whether a batch of `cells` cells would go to the pool now. */
  willUsePool: (cells: number) => boolean;
  /** Whether the code can run on a worker of the pool. */
  readonly shippable: boolean;
};

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
 * `_SYS` that `run()` uses, from the same factory,
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
        refuseStoredValueKinds(stored, false);
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
            const checked = plan ? checkEntry(plan, args) : args;
            const previous = setReconstructionDigits(digits);
            try {
              return normalizeRunResult(fn(...checked));
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
          const checked = plan ? checkEntry(plan, args) : args;
          const previous = setReconstructionDigits(digits);
          try {
            return normalizeRunResult(fn(...checked));
          } finally {
            setReconstructionDigits(previous);
          }
        };
      },
    },
    loadBroadcast: {
      value: (
        stored: StoredJavaScript
      ): ((
        inputs: BroadcastInputs,
        options?: BroadcastOptions
      ) => Float64Array) => {
        const { fn, plan, digits, outputs, batch } = storedExpressionRunner(
          sys,
          stored
        );
        // One function for every batch: `broadcastNumbers` keeps the cell
        // loop it makes for a compiled body by that function (`cellLoopFor`).
        const call = (vars: Record<string, unknown>): unknown => fn(vars);
        return (inputs, options) => {
          const previous = setReconstructionDigits(digits);
          try {
            return broadcastNumbers(
              call,
              plan,
              inputs,
              options,
              outputs,
              batch
            );
          } finally {
            setReconstructionDigits(previous);
          }
        };
      },
    },
    loadBroadcastSlice: {
      value: (
        stored: StoredJavaScript
      ): ((
        inputs: BroadcastInputs,
        options: BroadcastOptions | undefined,
        out: Float64Array,
        slice: BroadcastSlice
      ) => number) => {
        const { fn, plan, digits, outputs, batch } = storedExpressionRunner(
          sys,
          stored
        );
        // One function for every slice (see `loadBroadcast`).
        const call = (vars: Record<string, unknown>): unknown => fn(vars);
        return (inputs, options, out, slice) => {
          const previous = setReconstructionDigits(digits);
          try {
            return broadcastNumbersSlice(
              call,
              plan,
              inputs,
              options,
              out,
              slice,
              outputs,
              batch
            );
          } finally {
            setReconstructionDigits(previous);
          }
        };
      },
    },
    loadBroadcastAsync: {
      value: (
        stored: StoredJavaScript,
        loadOptions: { workers?: KernelPool } = {}
      ): LoadedBroadcastAsync => {
        const workers = loadOptions.workers;
        if (workers !== undefined && !isKernelPool(workers))
          throw new TypeError(
            'loadBroadcastAsync: `workers` must be a pool from createKernelPool()'
          );
        // A copy of the stored fields, taken now. A stored result is plain
        // data that the host can change; the pool keys its kernel id and its
        // calibration on this object, and a worker reads its fields when it
        // gets its first task. With a copy, the calling thread and the
        // workers run the same code, and a later change to the host's
        // object (or a second load of it) does not reach this function.
        const own: StoredJavaScript = {
          code: stored.code,
          preamble: stored.preamble,
          preambleOnce: stored.preambleOnce,
          preamblePerCall: stored.preamblePerCall,
          callCode: stored.callCode,
          calling: stored.calling,
          reconstructionDigits: stored.reconstructionDigits,
          entryPlan:
            stored.entryPlan === undefined
              ? undefined
              : structuredClone(stored.entryPlan),
          mode: stored.mode,
          strings: stored.strings,
          rows: stored.rows,
          broadcastOutputs: stored.broadcastOutputs,
          batch:
            stored.batch === undefined
              ? undefined
              : structuredClone(stored.batch),
          runtimeVersion: stored.runtimeVersion,
          shippable: stored.shippable,
          profile: stored.profile,
          valueKinds:
            stored.valueKinds === undefined
              ? undefined
              : [...stored.valueKinds],
          hostCalls:
            stored.hostCalls === undefined ? undefined : [...stored.hostCalls],
        };
        // The slice loop of the calling thread. It also checks the stored
        // code (its runtime version; a lambda is refused), before any batch.
        const slice = sys.loadBroadcastSlice(own);
        const entryPlan = own.entryPlan;
        const spec: BroadcastAsyncSpec = {
          kind: 'javascript',
          stored: own,
          // A `vars` plan is keyed by symbol name.
          lists:
            entryPlan?.kind === 'vars'
              ? entryPlan.lists.filter(
                  (name): name is string => typeof name === 'string'
                )
              : undefined,
          // Only code that the compiler marked shippable goes to a worker.
          // The text of the code shows a draw from the random stream, but
          // not a variable given by the name of a host global or a caller
          // preamble, which fail on a worker: stored code without the
          // `shippable: true` field of its compilation result stays on the
          // calling thread.
          shippable:
            own.shippable === true &&
            isShippableCode(
              [
                own.preamble,
                own.preambleOnce,
                own.preamblePerCall,
                own.code,
              ].join('\n')
            ),
          slice,
          workers: () => workers,
          iterationLimit: () => iterationLimit,
        };
        const run = makeBroadcastAsync(spec);
        return Object.assign(run, {
          shippable: spec.shippable,
          willUsePool: makeWillUsePool(spec),
        });
      },
    },
  });
  return sys;
}

/**
 * The error of a batch run (`broadcast()`, `broadcastAsync()` and the batch
 * loaders of stored code) of code that reads or makes a value of the kind
 * types `kinds`. The batch runner reads each input column as numbers and
 * writes each result into a `Float64Array`: it does not run the `entry`
 * check of a kind binding, and it cannot hold the representation of a kind
 * value (an object). A batch would then give a `NaN` or a wrong number with
 * no error, so it is refused.
 */
function kindBroadcastError(kinds: Iterable<string>): Error {
  const names = [...kinds].map((k) => `'${k}'`).join(', ');
  return new Error(
    `A value-kind result cannot be broadcast: the code reads or makes a ` +
      `value of the kind type ${names}, and the batch runner reads and ` +
      `writes numbers only. Call \`run()\` for each value.`
  );
}

/**
 * The error of a batch run (`broadcast()`, `broadcastAsync()` and the batch
 * loaders of stored code) of code compiled in `mode: 'bigint'`. The code
 * takes and returns JavaScript `bigint` values, and the batch runner reads
 * each input column as numbers and writes each result into a
 * `Float64Array`, which cannot hold a `bigint`. So the batch is refused
 * before any cell runs, and before any task goes to a worker.
 * (`docs/plans/2026-10-31-ce715-bigint-compile-mode.md`, §3.5; a batch
 * form with a `bigint` output is CE-715.5.)
 */
export function bigintBroadcastError(): Error {
  return new Error(
    `Code compiled in mode 'bigint' cannot be broadcast: it takes and ` +
      `returns bigint values, and the batch runner reads and writes ` +
      `numbers only. Call \`run()\` for each value.`
  );
}

/** The error of a batch of code that reads or returns a string: the batch
 *  runner reads and writes numbers only. */
export function stringBroadcastError(): Error {
  return new TypeError(
    'Code that reads or returns a string cannot be broadcast: the batch runner reads and writes numbers only. Call `run()` for each value.'
  );
}

/** The error of a batch of code whose result is a list of lists of rows of
 *  different lengths (`Chunk`, `Partition`): a batch writes numbers only. */
export function rowsBroadcastError(): Error {
  return new TypeError(
    'Code whose result is a list of lists of rows of different lengths cannot be broadcast: the batch runner writes numbers only. Call `run()` for each value.'
  );
}

/**
 * Throw for stored code compiled with the compile contract of a value kind
 * (`valueKinds`). The run-time checks of a kind are functions of the host
 * that compiled the code, and stored code does not
 * carry them, so `load()` refuses such code. The batch loaders (`batch`
 * true) refuse it whatever its `shippable` field says, with the error of
 * `broadcast()` (`kindBroadcastError()`): the batch runner writes numbers
 * only, so it would write the representation of a kind value into the
 * numeric output with no error. A worker of the kernel pool loads its code
 * with `loadBroadcastSlice()`, so no worker runs such code, and
 * `loadBroadcastAsync()` throws before it makes a `willUsePool`.
 */
function refuseStoredValueKinds(
  stored: StoredJavaScript,
  batch: boolean
): void {
  const hosts = stored.hostCalls;
  if (hosts !== undefined && hosts.length > 0)
    throw new Error(
      `The stored code calls the function${hosts.length > 1 ? 's' : ''} ${hosts.map((h) => `"${h}"`).join(', ')} of the host in the engine that compiled it: it cannot be loaded. Run it with the \`run()\` of the compilation result.`
    );
  const kinds = stored.valueKinds;
  if (kinds === undefined || kinds.length === 0) return;
  if (batch) throw kindBroadcastError(kinds);
  throw new Error(
    `The stored code was compiled with the compile contract of the value kind type ${kinds.map((k) => `'${k}'`).join(', ')}, whose run-time checks are functions of the host that compiled it: it cannot be loaded. Run it with the \`run()\` of the compilation result.`
  );
}

/**
 * The raw function of stored code compiled from an expression, for the batch
 * loaders: the same construction as `load()` (the once-only definitions
 * evaluated here, the per-call ones on every call, the exponent digits fixed
 * to the stored count), without the per-call entry check and result
 * normalization that `broadcastNumbers` applies itself. A lambda (positional
 * arguments) has no batch form. `outputs` is the stored default count of
 * values per cell (`broadcastOutputs`), or `undefined` for one. `batch` is
 * the stored batch body, built over the same helpers (`loadBatchBody`).
 */
function storedExpressionRunner(
  sys: SysHelpers,
  stored: StoredJavaScript
): {
  fn: (...args: unknown[]) => unknown;
  plan: EntryPlan | undefined;
  digits: number;
  outputs: number | undefined;
  batch: BroadcastBatchBody | undefined;
} {
  // `loadBroadcastAsync()` calls `loadBroadcastSlice()`, and thus this
  // function, before it gives any task to a worker.
  if (stored.mode === 'bigint') throw bigintBroadcastError();
  if (stored.strings === true) throw stringBroadcastError();
  if (stored.rows === true) throw rowsBroadcastError();
  if (stored.calling === 'lambda')
    throw new Error(
      'The stored code is a lambda (positional arguments): it has no broadcast'
    );
  refuseStoredValueKinds(stored, true);
  if (stored.runtimeVersion === undefined)
    throw new Error(
      'The stored code has no runtimeVersion: it cannot be matched to this runtime'
    );
  if (stored.runtimeVersion !== RUNTIME_VERSION)
    throw new Error(
      `The code was compiled for runtime ${stored.runtimeVersion}, this is runtime ${RUNTIME_VERSION}`
    );
  // A stored result is plain data that a host can change: a stride that is
  // not a positive integer would lay the cells out wrongly, so it throws.
  const outputs = stored.broadcastOutputs;
  if (outputs !== undefined && (!Number.isInteger(outputs) || outputs < 1))
    throw new Error(
      `The stored broadcastOutputs must be a positive integer (got ${String(outputs)})`
    );
  const plan = stored.entryPlan && restoreEntryPlan(stored.entryPlan);
  const storedDigits = stored.reconstructionDigits;
  const digits =
    typeof storedDigits === 'number' && Number.isFinite(storedDigits)
      ? Math.max(15, Math.min(17, Math.trunc(storedDigits)))
      : 17;
  const split =
    stored.preambleOnce !== undefined || stored.preamblePerCall !== undefined;
  const perCall = split ? stored.preamblePerCall : stored.preamble;
  const previous = setReconstructionDigits(digits);
  try {
    const own = sys;
    const fn = twoStageRunner(
      own,
      stored.preambleOnce ?? '',
      ['_'],
      `${perCall ?? ''}\nreturn ${stored.code};`
    );
    return {
      fn,
      plan: plan || undefined,
      digits,
      outputs,
      batch: loadBatchBody(own, stored.batch),
    };
  } finally {
    setReconstructionDigits(previous);
  }
}

/**
 * The batch body of a compilation result (`StoredBatchBody`), ready for
 * `broadcastNumbers` (`BroadcastBatchBody`): its function built over the
 * helpers `sys`, the definitions of `preambleOnce` evaluated once, here.
 * The caller sets the reconstruction digits of the code around this call,
 * as for the ordinary body.
 *
 * `undefined` when there is no batch body, and when the stored one cannot be
 * built: a stored result is plain data that a host can change, so a
 * parameter that is not an identifier, or code that does not compile, gives
 * no batch body, and every batch runs the ordinary body. The batch body is
 * read only by the runtime of the version that wrote it: the caller has
 * checked `runtimeVersion`.
 */
function loadBatchBody(
  sys: SysHelpers,
  batch: StoredBatchBody | undefined
): BroadcastBatchBody | undefined {
  if (batch === undefined || batch === null) return undefined;
  if (typeof batch.code !== 'string' || !Array.isArray(batch.params))
    return undefined;
  const params: StoredBatchBody['params'] = [];
  for (const p of batch.params as unknown[]) {
    if (typeof p !== 'object' || p === null) return undefined;
    const { name, local, direct, minLength } = p as Record<string, unknown>;
    if (
      typeof name !== 'string' ||
      typeof local !== 'string' ||
      !/^[A-Za-z_$][\w$]*$/.test(local) ||
      (minLength !== undefined &&
        !(typeof minLength === 'number' && Number.isSafeInteger(minLength)))
    )
      return undefined;
    params.push({
      name,
      local,
      ...(direct === true ? { direct: true } : {}),
      ...(typeof minLength === 'number' ? { minLength } : {}),
    });
  }
  try {
    const call = twoStageRunner(
      sys,
      typeof batch.preambleOnce === 'string' ? batch.preambleOnce : '',
      params.map((p) => p.local),
      `${typeof batch.preamblePerCall === 'string' ? batch.preamblePerCall : ''}\nreturn ${batch.code};`
    );
    return { call, params, checked: new WeakMap() };
  } catch {
    return undefined;
  }
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
