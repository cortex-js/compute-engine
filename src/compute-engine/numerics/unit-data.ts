/**
 * Unit registry: dimension vectors, SI base units, prefixes, and conversion.
 *
 * A DimensionVector encodes the exponents for each of the 7 SI base
 * dimensions plus currency: [length, mass, time, current, temperature,
 * amount, luminosity, currency].  Currency (the 8th slot) is not an SI
 * dimension; it is included so monetary quantities (USD) participate in
 * dimensional analysis and cancellation.
 *
 * Every unit in the registry stores its dimension vector and a scale factor
 * relative to the coherent SI unit for that dimension.  For example the meter
 * has scale 1, the kilometer has scale 1000, and the inch has scale 0.0254
 * (all measuring length).
 *
 * Prefixed units (km, mg, GHz, ...) are resolved on the fly by
 * `parsePrefixedUnit` rather than stored explicitly.
 */

import { gcd } from './numeric-bigint.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * 8-tuple of exponents over the SI base dimensions plus currency:
 * [length, mass, time, current, temperature, amount, luminosity, currency]
 */
export type DimensionVector = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

interface UnitEntry {
  dimension: DimensionVector;
  /** Scale factor relative to the coherent SI unit for the same dimension. */
  scale: number;
  /**
   * Offset for affine temperature conversions.
   * To convert to SI: SI_value = (value + offset) * scale
   * Only used by degC and degF.
   */
  offset?: number;
  /**
   * The exact values of `scale` and `offset`, as fractions
   * `[numerator, denominator]`, for a unit whose `scale` or `offset` is not
   * exact as a machine number (`5/9`, `459.67`). `convertUnit()` combines
   * these fractions exactly into the affine map of a conversion, and rounds
   * only at the end: `20 degC` is `68 degF`, not `67.99999999999994 degF`.
   */
  exact?: { scale: [number, number]; offset: [number, number] };
  /**
   * For a unit whose scale is a rational multiple of an integer power of π
   * (the angle units): the fraction `[numerator, denominator]` and the
   * power of π, so that the exact scale is `(numerator/denominator)·π^power`.
   * `deg` is `{ factor: [1, 180], power: 1 }`. `scale` is the machine number
   * of this value. Only the exact comparison of two quantities reads this
   * field (`exactUnitConversion()`): the conversion of a value
   * (`convertUnit()`) uses `scale`.
   */
  piMultiple?: { factor: [number, number]; power: number };
}

// ---------------------------------------------------------------------------
// SI Prefixes
// ---------------------------------------------------------------------------

/** Map from prefix symbol to its power-of-10 multiplier. */
const SI_PREFIXES: Record<string, number> = {
  // Prototype-free: these tables are keyed by an arbitrary symbol name, and a
  // plain object literal answers `Object.prototype` for `__proto__` (and an
  // inherited function for `toString`/`valueOf`). `resolveUnit` tests the
  // lookup for truthiness, so `\mathrm{__proto__}` resolved as a known unit
  // and a `Sum` over an index of that name lost its index entirely.
  '__proto__': null as never,
  'Q': 1e30,
  'R': 1e27,
  'Y': 1e24,
  'Z': 1e21,
  'E': 1e18,
  'P': 1e15,
  'T': 1e12,
  'G': 1e9,
  'M': 1e6,
  'k': 1e3,
  'h': 1e2,
  'da': 1e1,
  'd': 1e-1,
  'c': 1e-2,
  'm': 1e-3,
  '\u00B5': 1e-6, // µ (micro sign U+00B5)
  '\u03BC': 1e-6, // μ (Greek small letter mu U+03BC)
  'n': 1e-9,
  'p': 1e-12,
  'f': 1e-15,
  'a': 1e-18,
  'z': 1e-21,
  'y': 1e-24,
  'r': 1e-27,
  'q': 1e-30,
};

/**
 * Units that may receive an SI prefix.  Includes the 7 SI base units (with
 * `g` instead of `kg` for prefixing) and all 18 named derived SI units.
 */
const PREFIXABLE_UNITS: Set<string> = new Set([
  // SI base (g replaces kg for prefixing)
  'm',
  'g',
  's',
  'A',
  'K',
  'mol',
  'cd',
  // Named derived SI
  'Hz',
  'N',
  'Pa',
  'J',
  'W',
  'C',
  'V',
  'F',
  'ohm',
  '\u03A9', // Ω
  'S',
  'Wb',
  'T',
  'H',
  'lm',
  'lx',
  'Bq',
  'Gy',
  'Sv',
  'kat',
  // Some non-SI that accept prefixes
  'eV',
  'L',
  'bar',
]);

// ---------------------------------------------------------------------------
// Unit data tables
// ---------------------------------------------------------------------------

//                        L  M  T  I  Θ  N  J  $
// Indices:               0  1  2  3  4  5  6  7
// ($ = currency, non-SI; see DimensionVector doc above)

const UNIT_TABLE: Record<string, UnitEntry> = {
  // Prototype-free — see `SI_PREFIXES` above.
  '__proto__': null as never,
  // ---- SI base units ----
  'm': { dimension: [1, 0, 0, 0, 0, 0, 0, 0], scale: 1 },
  'kg': { dimension: [0, 1, 0, 0, 0, 0, 0, 0], scale: 1 },
  'g': { dimension: [0, 1, 0, 0, 0, 0, 0, 0], scale: 1e-3 },
  's': { dimension: [0, 0, 1, 0, 0, 0, 0, 0], scale: 1 },
  'A': { dimension: [0, 0, 0, 1, 0, 0, 0, 0], scale: 1 },
  'K': { dimension: [0, 0, 0, 0, 1, 0, 0, 0], scale: 1 },
  'mol': { dimension: [0, 0, 0, 0, 0, 1, 0, 0], scale: 1 },
  'cd': { dimension: [0, 0, 0, 0, 0, 0, 1, 0], scale: 1 },

  // ---- Named derived SI units ----
  'Hz': { dimension: [0, 0, -1, 0, 0, 0, 0, 0], scale: 1 },
  'N': { dimension: [1, 1, -2, 0, 0, 0, 0, 0], scale: 1 },
  'Pa': { dimension: [-1, 1, -2, 0, 0, 0, 0, 0], scale: 1 },
  'J': { dimension: [2, 1, -2, 0, 0, 0, 0, 0], scale: 1 },
  'W': { dimension: [2, 1, -3, 0, 0, 0, 0, 0], scale: 1 },
  'C': { dimension: [0, 0, 1, 1, 0, 0, 0, 0], scale: 1 },
  'V': { dimension: [2, 1, -3, -1, 0, 0, 0, 0], scale: 1 },
  'F': { dimension: [-2, -1, 4, 2, 0, 0, 0, 0], scale: 1 },
  'ohm': { dimension: [2, 1, -3, -2, 0, 0, 0, 0], scale: 1 },
  // The symbol of the ohm, the Greek capital omega (U+03A9). The ohm sign
  // U+2126 is the same symbol after NFC normalization.
  '\u03A9': { dimension: [2, 1, -3, -2, 0, 0, 0, 0], scale: 1 }, // Ω
  'S': { dimension: [-2, -1, 3, 2, 0, 0, 0, 0], scale: 1 },
  'Wb': { dimension: [2, 1, -2, -1, 0, 0, 0, 0], scale: 1 },
  'T': { dimension: [0, 1, -2, -1, 0, 0, 0, 0], scale: 1 },
  'H': { dimension: [2, 1, -2, -2, 0, 0, 0, 0], scale: 1 },
  'lm': { dimension: [0, 0, 0, 0, 0, 0, 1, 0], scale: 1 },
  'lx': { dimension: [-2, 0, 0, 0, 0, 0, 1, 0], scale: 1 },
  'Bq': { dimension: [0, 0, -1, 0, 0, 0, 0, 0], scale: 1 },
  'Gy': { dimension: [2, 0, -2, 0, 0, 0, 0, 0], scale: 1 },
  'Sv': { dimension: [2, 0, -2, 0, 0, 0, 0, 0], scale: 1 },
  'kat': { dimension: [0, 0, -1, 0, 0, 1, 0, 0], scale: 1 },

  // ---- Temperature units with affine offset ----
  // To convert to kelvin: K = (value + offset) * scale
  'degC': {
    dimension: [0, 0, 0, 0, 1, 0, 0, 0],
    scale: 1,
    offset: 273.15,
    exact: { scale: [1, 1], offset: [27315, 100] },
  },
  'degF': {
    dimension: [0, 0, 0, 0, 1, 0, 0, 0],
    scale: 5 / 9,
    offset: 459.67,
    exact: { scale: [5, 9], offset: [45967, 100] },
  },

  // ---- Non-SI accepted for use with SI ----
  'min': { dimension: [0, 0, 1, 0, 0, 0, 0, 0], scale: 60 },
  'h': { dimension: [0, 0, 1, 0, 0, 0, 0, 0], scale: 3600 },
  'd': { dimension: [0, 0, 1, 0, 0, 0, 0, 0], scale: 86400 },
  'wk': { dimension: [0, 0, 1, 0, 0, 0, 0, 0], scale: 604800 },
  'ha': { dimension: [2, 0, 0, 0, 0, 0, 0, 0], scale: 1e4 },
  'L': { dimension: [3, 0, 0, 0, 0, 0, 0, 0], scale: 1e-3 },
  't': { dimension: [0, 1, 0, 0, 0, 0, 0, 0], scale: 1e3 },
  'eV': { dimension: [2, 1, -2, 0, 0, 0, 0, 0], scale: 1.602176634e-19 },
  // The dalton is a measured value (CODATA 2018). The decimal number
  // written here is its definition in this table: the exact comparison of
  // two quantities reads it as the exact fraction `16605390666/10³⁷`
  // (`decimalFraction()`), so `1 Da` and `1.6605390666e-27 kg` are equal.
  'Da': { dimension: [0, 1, 0, 0, 0, 0, 0, 0], scale: 1.6605390666e-27 },
  'au': { dimension: [1, 0, 0, 0, 0, 0, 0, 0], scale: 1.495978707e11 },

  // Angle units (dimensionless)
  'deg': {
    dimension: [0, 0, 0, 0, 0, 0, 0, 0],
    scale: Math.PI / 180,
    piMultiple: { factor: [1, 180], power: 1 },
  },
  'rad': { dimension: [0, 0, 0, 0, 0, 0, 0, 0], scale: 1 },
  'grad': {
    dimension: [0, 0, 0, 0, 0, 0, 0, 0],
    scale: Math.PI / 200,
    piMultiple: { factor: [1, 200], power: 1 },
  },
  'turn': {
    dimension: [0, 0, 0, 0, 0, 0, 0, 0],
    scale: 2 * Math.PI,
    piMultiple: { factor: [2, 1], power: 1 },
  },
  'arcmin': {
    dimension: [0, 0, 0, 0, 0, 0, 0, 0],
    scale: Math.PI / 10800,
    piMultiple: { factor: [1, 10800], power: 1 },
  },
  'arcsec': {
    dimension: [0, 0, 0, 0, 0, 0, 0, 0],
    scale: Math.PI / 648000,
    piMultiple: { factor: [1, 648000], power: 1 },
  },

  // Dimensionless ratios
  'percent': { dimension: [0, 0, 0, 0, 0, 0, 0, 0], scale: 0.01 },
  'ppm': { dimension: [0, 0, 0, 0, 0, 0, 0, 0], scale: 1e-6 },

  // Logarithmic (dimensionless, scale is nominal)
  'dB': { dimension: [0, 0, 0, 0, 0, 0, 0, 0], scale: 1 },
  'Np': { dimension: [0, 0, 0, 0, 0, 0, 0, 0], scale: 1 },

  // ---- Common non-SI units ----
  'in': { dimension: [1, 0, 0, 0, 0, 0, 0, 0], scale: 0.0254 },
  'ft': { dimension: [1, 0, 0, 0, 0, 0, 0, 0], scale: 0.3048 },
  'yd': { dimension: [1, 0, 0, 0, 0, 0, 0, 0], scale: 0.9144 },
  'mi': { dimension: [1, 0, 0, 0, 0, 0, 0, 0], scale: 1609.344 },
  'lb': { dimension: [0, 1, 0, 0, 0, 0, 0, 0], scale: 0.45359237 },
  'oz': { dimension: [0, 1, 0, 0, 0, 0, 0, 0], scale: 0.028349523125 },
  'gal': { dimension: [3, 0, 0, 0, 0, 0, 0, 0], scale: 3.785411784e-3 },
  // Volume: US liquid convention (matching gal = 3.785411784e-3). Imperial
  // qt/pt differ by ~20%; gal already established the US convention here.
  'qt': { dimension: [3, 0, 0, 0, 0, 0, 0, 0], scale: 9.46352946e-4 },
  'pt': { dimension: [3, 0, 0, 0, 0, 0, 0, 0], scale: 4.73176473e-4 },
  'cup': { dimension: [3, 0, 0, 0, 0, 0, 0, 0], scale: 2.365882365e-4 },
  'atm': { dimension: [-1, 1, -2, 0, 0, 0, 0, 0], scale: 101325 },
  'bar': { dimension: [-1, 1, -2, 0, 0, 0, 0, 0], scale: 1e5 },
  'cal': { dimension: [2, 1, -2, 0, 0, 0, 0, 0], scale: 4.184 },
  'kWh': { dimension: [2, 1, -2, 0, 0, 0, 0, 0], scale: 3.6e6 },
  '\u00C5': { dimension: [1, 0, 0, 0, 0, 0, 0, 0], scale: 1e-10 }, // Å

  // ---- Currency (8th dimension) ----
  // Only USD is represented. EUR/GBP/etc. have no fixed exchange rate to USD,
  // so they are deliberately unrepresentable rather than encoded with a wrong
  // (drifting) scale — same principle as the "NO ton(s) alias" note in
  // definitions-units.ts.
  'USD': { dimension: [0, 0, 0, 0, 0, 0, 0, 1], scale: 1 },
  'cent': { dimension: [0, 0, 0, 0, 0, 0, 0, 1], scale: 0.01 },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function dimensionsEqual(
  a: DimensionVector,
  b: DimensionVector
): boolean {
  return (
    a[0] === b[0] &&
    a[1] === b[1] &&
    a[2] === b[2] &&
    a[3] === b[3] &&
    a[4] === b[4] &&
    a[5] === b[5] &&
    a[6] === b[6] &&
    a[7] === b[7]
  );
}

export function isDimensionless(dim: DimensionVector): boolean {
  return (
    dim[0] === 0 &&
    dim[1] === 0 &&
    dim[2] === 0 &&
    dim[3] === 0 &&
    dim[4] === 0 &&
    dim[5] === 0 &&
    dim[6] === 0 &&
    dim[7] === 0
  );
}

/**
 * Try to split `symbol` into an SI prefix + a prefixable base unit.
 *
 * Strategy: try a 2-character prefix first (e.g. "da"), then 1-character.
 * The remaining suffix must be a member of `PREFIXABLE_UNITS`.
 *
 * Returns `{ prefix, prefixScale, baseEntry }` or `null`.
 */
function parsePrefixedUnit(
  symbol: string
): { prefixScale: number; baseEntry: UnitEntry } | null {
  // Try 2-char prefix first (only "da" currently, but future-proof)
  if (symbol.length > 2) {
    const p2 = symbol.slice(0, 2);
    const rest2 = symbol.slice(2);
    if (SI_PREFIXES[p2] !== undefined && PREFIXABLE_UNITS.has(rest2)) {
      const base = UNIT_TABLE[rest2];
      if (base) return { prefixScale: SI_PREFIXES[p2], baseEntry: base };
    }
  }

  // Try 1-char prefix
  if (symbol.length > 1) {
    const p1 = symbol.slice(0, 1);
    const rest1 = symbol.slice(1);
    if (SI_PREFIXES[p1] !== undefined && PREFIXABLE_UNITS.has(rest1)) {
      const base = UNIT_TABLE[rest1];
      if (base) return { prefixScale: SI_PREFIXES[p1], baseEntry: base };
    }
  }

  return null;
}

/**
 * Resolve a unit symbol — first by direct table lookup, then by prefix
 * parsing.  Returns a synthetic `UnitEntry` (dimension + effective scale)
 * or `null` for unknown symbols.
 */
function resolveUnit(symbol: string): UnitEntry | null {
  const direct = UNIT_TABLE[symbol];
  if (direct) return direct;

  const prefixed = parsePrefixedUnit(symbol);
  if (prefixed) {
    return {
      dimension: prefixed.baseEntry.dimension,
      scale: prefixed.prefixScale * prefixed.baseEntry.scale,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Every unit symbol of the registry: the units of the table, and each
 * prefixable unit with each SI prefix (`km`, `µs`, `kΩ`).
 */
export function unitRegistrySymbols(): string[] {
  const units = Object.keys(UNIT_TABLE);
  const prefixed = Object.keys(SI_PREFIXES).flatMap((p) =>
    [...PREFIXABLE_UNITS].map((u) => p + u)
  );
  return [...units, ...prefixed];
}

/**
 * Return the dimension vector for `symbol`, or `null` if unknown.
 *
 * Handles direct units (m, kg, N, ...) and prefixed units (km, MHz, ...).
 */
export function getUnitDimension(symbol: string): DimensionVector | null {
  const entry = resolveUnit(symbol);
  return entry ? entry.dimension : null;
}

/**
 * Return the scale factor of `symbol` relative to the coherent SI unit
 * for the same dimension, or `null` if unknown.
 *
 * Examples:
 * - getUnitScale('m')  → 1
 * - getUnitScale('km') → 1000
 * - getUnitScale('mg') → 1e-6   (milli × gram: 1e-3 × 1e-3)
 */
export function getUnitScale(symbol: string): number | null {
  const entry = resolveUnit(symbol);
  return entry ? entry.scale : null;
}

/**
 * Return `true` when `a` and `b` share the same dimension vector
 * (i.e. they measure the same physical quantity and can be inter-converted).
 */
export function areCompatibleUnits(a: string, b: string): boolean {
  const da = getUnitDimension(a);
  const db = getUnitDimension(b);
  if (!da || !db) return false;
  return dimensionsEqual(da, db);
}

/**
 * Map from dimension-vector key to the preferred named derived SI unit.
 *
 * Some dimensions are shared by multiple SI units:
 * - `[0,0,-1,…]` → Hz (frequency) and Bq (radioactive decay)
 * - `[2,0,-2,…]` → Gy (absorbed dose) and Sv (dose equivalent)
 *
 * We keep only the more general unit (Hz, Gy).  Domain-specific aliases
 * (Bq, Sv) are still in UNIT_TABLE for conversion and display; they're
 * just not the automatic simplification targets.
 */
const NAMED_UNIT_BY_DIMENSION: Map<string, string> = new Map(
  [
    'N',
    'J',
    'W',
    'Pa',
    'Hz',
    'C',
    'V',
    'F',
    'ohm',
    'S',
    'Wb',
    'T',
    'H',
    'lm',
    'lx',
    'Gy',
    'kat',
  ].map((unit) => [UNIT_TABLE[unit].dimension.join(','), unit])
);

/**
 * Search for a named derived SI unit that matches the given dimension vector
 * and has scale=1.
 *
 * Returns the unit symbol (e.g., 'N', 'J', 'W') or `null` if no match.
 */
export function findNamedUnit(dim: DimensionVector): string | null {
  return NAMED_UNIT_BY_DIMENSION.get(dim.join(',')) ?? null;
}

/**
 * Convert a numeric `value` from `fromUnit` to `toUnit`.
 *
 * Returns the converted value, or `null` when the units are unknown or
 * dimensionally incompatible.
 *
 * Handles both linear conversions (most units) and affine conversions
 * (degC, degF) via the optional `offset` field.
 */
export function convertUnit(
  value: number,
  fromUnit: string,
  toUnit: string
): number | null {
  const from = resolveUnit(fromUnit);
  const to = resolveUnit(toUnit);
  if (!from || !to) return null;

  // Dimensional compatibility check
  if (!dimensionsEqual(from.dimension, to.dimension)) return null;

  // A conversion with an offset (a temperature) uses the exact affine map
  // `value → (A·value + B)/D`, so that it rounds only at the end.
  if (from.offset !== undefined || to.offset !== undefined) {
    const map = exactAffineMap(from, to);
    if (map) {
      const result = (value * map.a + map.b) / map.d;
      // Near the largest float, `value·A` can overflow although the result
      // is finite (`1e308 degF` is about `5.56e307 degC`): the quotients are
      // then taken first.
      if (Number.isFinite(result) || !Number.isFinite(value)) return result;
      return value * (map.a / map.d) + map.b / map.d;
    }
  }

  // Affine conversion: SI_value = (value + offset) * scale
  // Then: result = SI_value / to.scale - to.offset
  const fromOffset = from.offset ?? 0;
  const toOffset = to.offset ?? 0;

  const siValue = (value + fromOffset) * from.scale;
  return siValue / to.scale - toOffset;
}

/**
 * The factor and the offset of the affine map `x → factor·x + offset` that
 * converts a value from `fromUnit` to `toUnit`, or `null` when the units are
 * unknown or dimensionally incompatible.
 *
 * For a conversion with an offset (a temperature) the two coefficients are
 * computed from the exact data of the units and rounded once: `degC → degF`
 * is `x → 1.8x + 32`. The difference `convertUnit(1) − convertUnit(0)` of two
 * rounded values loses digits (`1.7999999999999972`).
 */
export function unitConversionCoefficients(
  fromUnit: string,
  toUnit: string
): { factor: number; offset: number } | null {
  const from = resolveUnit(fromUnit);
  const to = resolveUnit(toUnit);
  if (!from || !to) return null;
  if (!dimensionsEqual(from.dimension, to.dimension)) return null;
  if (from.offset !== undefined || to.offset !== undefined) {
    const map = exactAffineMap(from, to);
    if (map) return { factor: map.a / map.d, offset: map.b / map.d };
  }
  const c0 = convertUnit(0, fromUnit, toUnit)!;
  const c1 = convertUnit(1, fromUnit, toUnit)!;
  return { factor: c1 - c0, offset: c0 };
}

/**
 * The units of the table whose scale is NOT an exact decimal number, so
 * that the decimal of its machine number is not its value: the angle
 * units, whose scale is computed from `Math.PI` (`deg` is `π/180`). Their
 * exact scale is a rational multiple of π, given by their `piMultiple`
 * field, which only `exactUnitConversion()` reads.
 *
 * Every other scale of the table is written as an exact decimal number that
 * defines the unit (`in` is `0.0254 m`, `eV` is `1.602176634e-19 J`, and
 * `Da`, a measured value whose decimal number is its definition here), or
 * is given by an `exact` field (`degF`). A unit added to the table with a
 * scale that is computed must be added here.
 */
const INEXACT_SCALE_UNITS: ReadonlySet<UnitEntry> = new Set(
  ['deg', 'grad', 'turn', 'arcmin', 'arcsec'].map((u) => UNIT_TABLE[u])
);

/**
 * The exact value of the decimal number that the machine number `x`
 * stands for, as a fraction of two integers with a positive denominator:
 * the shortest decimal that gives `x` back (`0.0254` is `254/10000`, `1e24`
 * is `10²⁴`, not the integer `999999999999999983222784` of the machine
 * number). This is the value of `x` only when `x` was written as that
 * decimal number, not when it is the result of a computation (`Math.PI /
 * 180`). `null` for a value that is not finite.
 */
export function decimalFraction(x: number): [bigint, bigint] | null {
  if (!Number.isFinite(x)) return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(x));
  if (!m) return null;
  const [, sign, int, frac = '', exp = '0'] = m;
  let n = BigInt(int + frac);
  if (sign === '-') n = -n;
  const e = Number(exp) - frac.length;
  return e >= 0 ? [n * 10n ** BigInt(e), 1n] : [n, 10n ** BigInt(-e)];
}

/**
 * The scale and the offset of `entry` as exact fractions of integers, or
 * `null` when they are not known exactly.
 *
 * A unit with an `exact` field gives it. A unit with no offset gives the
 * decimal number of its scale (see `decimalFraction()`), except a unit whose
 * scale is not an exact decimal number (`INEXACT_SCALE_UNITS`): `in` is
 * `254/10000`, `kK` is `1000`, `mK` is `1/1000`.
 */
function exactScaleAndOffset(
  entry: UnitEntry
): { scale: [bigint, bigint]; offset: [bigint, bigint] } | null {
  if (entry.exact) {
    const { scale, offset } = entry.exact;
    return {
      scale: [BigInt(scale[0]), BigInt(scale[1])],
      offset: [BigInt(offset[0]), BigInt(offset[1])],
    };
  }
  if (entry.offset !== undefined) return null;
  if (INEXACT_SCALE_UNITS.has(entry)) return null;
  const scale = decimalFraction(entry.scale);
  if (scale === null) return null;
  return { scale, offset: [0n, 1n] };
}

/**
 * The exact affine map of the conversion from `from` to `to`, as three
 * integers `a`, `b`, `d` such that the converted value is `(a·x + b)/d`.
 * Returns `null` when the data of a unit are not exact, or when an integer is
 * too large to be a safe machine integer.
 *
 * The value in the coherent SI unit is `(x + o₁)·s₁`, and the value in the
 * target unit is that divided by `s₂`, minus `o₂`. So the factor is
 * `k = s₁/s₂` and the constant is `c = o₁·k − o₂`.
 */
function exactAffineMap(
  from: UnitEntry,
  to: UnitEntry
): { a: number; b: number; d: number } | null {
  const f = exactScaleAndOffset(from);
  const t = exactScaleAndOffset(to);
  if (!f || !t) return null;
  // k = kn/kd
  const kn = f.scale[0] * t.scale[1];
  const kd = f.scale[1] * t.scale[0];
  // c = (o₁n·kn·o₂d − o₂n·o₁d·kd) / (o₁d·kd·o₂d)
  const cn = f.offset[0] * kn * t.offset[1] - t.offset[0] * f.offset[1] * kd;
  const cd = f.offset[1] * kd * t.offset[1];
  // Common denominator: k = (kn·cd)/(kd·cd) and c = (cn·kd)/(kd·cd)
  let a = kn * cd;
  let b = cn * kd;
  let d = kd * cd;
  if (d < 0n) {
    a = -a;
    b = -b;
    d = -d;
  }
  const g = gcd(gcd(a, b), d);
  if (g > 1n) {
    a /= g;
    b /= g;
    d /= g;
  }
  const result = { a: Number(a), b: Number(b), d: Number(d) };
  if (
    !Number.isSafeInteger(result.a) ||
    !Number.isSafeInteger(result.b) ||
    !Number.isSafeInteger(result.d) ||
    result.d === 0
  )
    return null;
  return result;
}

// ---------------------------------------------------------------------------
// Compound unit expressions
// ---------------------------------------------------------------------------

/**
 * A MathJSON-like unit expression: either a string (simple unit symbol) or
 * an array like `["Divide", "m", "s"]`.
 */
export type UnitExpression = string | [string, ...any[]];

/**
 * Compute the dimension vector for a MathJSON unit expression.
 *
 * - If `expr` is a string, delegates to `getUnitDimension`.
 * - `["Multiply", a, b, ...]` — adds dimension vectors component-wise.
 * - `["Divide", a, b]` — subtracts b's dimension from a's.
 * - `["Power", base, exp]` — multiplies base dimension by exp.
 *
 * Returns `null` if any component is unrecognised.
 */
export function getExpressionDimension(
  expr: UnitExpression
): DimensionVector | null {
  if (typeof expr === 'string') return getUnitDimension(expr);

  if (!Array.isArray(expr) || expr.length < 2) return null;

  const op = expr[0];

  if (op === 'Multiply') {
    const result: DimensionVector = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 1; i < expr.length; i++) {
      const d = getExpressionDimension(expr[i]);
      if (!d) return null;
      for (let j = 0; j < 8; j++) result[j] += d[j];
    }
    return result;
  }

  if (op === 'Divide') {
    if (expr.length !== 3) return null;
    const da = getExpressionDimension(expr[1]);
    const db = getExpressionDimension(expr[2]);
    if (!da || !db) return null;
    return da.map((v, i) => v - db[i]) as DimensionVector;
  }

  if (op === 'Power') {
    if (expr.length !== 3) return null;
    const d = getExpressionDimension(expr[1]);
    const exp = unitExponentValue(expr[2]);
    if (!d || exp === null) return null;
    return d.map((v) => v * exp) as DimensionVector;
  }

  return null;
}

/**
 * Compute the scale factor for a MathJSON unit expression relative to
 * coherent SI.
 *
 * - If `expr` is a string, delegates to `getUnitScale`.
 * - `["Multiply", a, b, ...]` — multiplies scales.
 * - `["Divide", a, b]` — a.scale / b.scale.
 * - `["Power", base, exp]` — base.scale ^ exp.
 *
 * Returns `null` if any component is unrecognised.
 */
export function getExpressionScale(expr: UnitExpression): number | null {
  if (typeof expr === 'string') return getUnitScale(expr);

  if (!Array.isArray(expr) || expr.length < 2) return null;

  const op = expr[0];

  if (op === 'Multiply') {
    let result = 1;
    for (let i = 1; i < expr.length; i++) {
      const s = getExpressionScale(expr[i]);
      if (s === null) return null;
      result *= s;
    }
    return result;
  }

  if (op === 'Divide') {
    if (expr.length !== 3) return null;
    const sa = getExpressionScale(expr[1]);
    const sb = getExpressionScale(expr[2]);
    if (sa === null || sb === null || sb === 0) return null;
    return sa / sb;
  }

  if (op === 'Power') {
    if (expr.length !== 3) return null;
    const s = getExpressionScale(expr[1]);
    const exp = unitExponentValue(expr[2]);
    if (s === null || exp === null) return null;
    return Math.pow(s, exp);
  }

  return null;
}

/** A fraction `[numerator, denominator]` of two integers. */
type BigFraction = [bigint, bigint];

/**
 * An exact positive scale `(n/d)·π^piPower`: a fraction of two integers
 * and an integer power of π. The power is `0` for every unit of the table
 * except the angle units (`deg` is `(1/180)·π`).
 */
type ExactScale = { scale: BigFraction; piPower: number };

/**
 * The exact scale and offset of the table entry `entry`, or `null` when
 * they are not known exactly. An angle unit gives the rational multiple of
 * π of its `piMultiple` field. Another unit gives its data as
 * `exactScaleAndOffset()` reads them, with a power of π of `0`.
 */
function exactEntryData(
  entry: UnitEntry
): (ExactScale & { offset: BigFraction }) | null {
  if (entry.piMultiple) {
    const { factor, power } = entry.piMultiple;
    return {
      scale: [BigInt(factor[0]), BigInt(factor[1])],
      piPower: power,
      offset: [0n, 1n],
    };
  }
  const data = exactScaleAndOffset(entry);
  return data ? { ...data, piPower: 0 } : null;
}

/**
 * The exact scale and offset of the unit `symbol`, or `null` when they are
 * not known exactly (see `exactEntryData()`).
 *
 * A prefixed unit (`km`, `Ym`, `keV`) is the product of the exact value of
 * its prefix (a power of ten) and the exact scale of its unit. The machine
 * number of that product is rounded (`1e24 · 1e-3` is not `1e21`), so it is
 * not read.
 */
function exactUnitData(
  symbol: string
): (ExactScale & { offset: BigFraction }) | null {
  const direct = UNIT_TABLE[symbol];
  if (direct) return exactEntryData(direct);
  const prefixed = parsePrefixedUnit(symbol);
  if (!prefixed) return null;
  const base = exactEntryData(prefixed.baseEntry);
  const prefix = decimalFraction(prefixed.prefixScale);
  if (!base || !prefix || base.offset[0] !== 0n) return null;
  return {
    scale: [prefix[0] * base.scale[0], prefix[1] * base.scale[1]],
    piPower: base.piPower,
    offset: [0n, 1n],
  };
}

/**
 * The exact scale of the unit expression `expr` relative to coherent SI, as
 * a fraction of two integers with a positive denominator times an integer
 * power of π, or `null` when the scale of a unit is not known exactly or an
 * exponent is not an integer. This is `getExpressionScale()` with exact
 * arithmetic: the offset of a temperature unit is ignored, as it is there.
 */
function exactExpressionScale(expr: UnitExpression): ExactScale | null {
  if (typeof expr === 'string') {
    const data = exactUnitData(expr);
    return data ? { scale: data.scale, piPower: data.piPower } : null;
  }

  if (!Array.isArray(expr) || expr.length < 2) return null;

  const op = expr[0];

  if (op === 'Multiply') {
    let n = 1n;
    let d = 1n;
    let piPower = 0;
    for (let i = 1; i < expr.length; i++) {
      const s = exactExpressionScale(expr[i]);
      if (s === null) return null;
      n *= s.scale[0];
      d *= s.scale[1];
      piPower += s.piPower;
    }
    return { scale: [n, d], piPower };
  }

  if (op === 'Divide') {
    if (expr.length !== 3) return null;
    const sa = exactExpressionScale(expr[1]);
    const sb = exactExpressionScale(expr[2]);
    if (sa === null || sb === null || sb.scale[0] === 0n) return null;
    const n = sa.scale[0] * sb.scale[1];
    const d = sa.scale[1] * sb.scale[0];
    return {
      scale: d < 0n ? [-n, -d] : [n, d],
      piPower: sa.piPower - sb.piPower,
    };
  }

  if (op === 'Power') {
    if (expr.length !== 3) return null;
    const s = exactExpressionScale(expr[1]);
    const exp = unitExponentValue(expr[2]);
    if (s === null || exp === null || !Number.isInteger(exp)) return null;
    const piPower = s.piPower * exp;
    if (exp >= 0)
      return {
        scale: [s.scale[0] ** BigInt(exp), s.scale[1] ** BigInt(exp)],
        piPower,
      };
    if (s.scale[0] === 0n) return null;
    const n = s.scale[1] ** BigInt(-exp);
    const d = s.scale[0] ** BigInt(-exp);
    return { scale: d < 0n ? [-n, -d] : [n, d], piPower };
  }

  return null;
}

/**
 * The exact affine map `v → factor·π^piPower·v + offset` that converts a
 * value from the unit expression `fromUnit` to the unit expression
 * `toUnit`, with `factor` and `offset` as fractions of integers and
 * `piPower` an integer. The power of π is not `0` only for a conversion
 * between angle units whose scales have different powers of π: `rad` to
 * `deg` is `v → 180·π⁻¹·v`, and `deg` to `turn` is `v → (1/360)·v`. Returns
 * `null` when the units are unknown or have different dimensions, or when
 * the data of a unit are not exact (see `exactExpressionScale()`).
 *
 * The offsets of the temperature units apply only between two unit symbols,
 * as in `convertCompoundUnit()`: in a compound unit, a temperature unit is a
 * temperature difference. The factor is always positive.
 *
 * The value in coherent SI is `(v + o₁)·s₁`, and the value in the target
 * unit is that divided by `s₂`, minus `o₂`. So the factor is `k = s₁/s₂` and
 * the offset is `o₁·k − o₂`.
 */
export function exactUnitConversion(
  fromUnit: UnitExpression,
  toUnit: UnitExpression
): { factor: BigFraction; piPower: number; offset: BigFraction } | null {
  const fromDim = getExpressionDimension(fromUnit);
  const toDim = getExpressionDimension(toUnit);
  if (!fromDim || !toDim || !dimensionsEqual(fromDim, toDim)) return null;

  // Two identical units: the conversion is the identity, whatever the data
  // of the unit (`in` to `in`, `Da` to `Da`, `m^(1/2)` to `m^(1/2)`). The
  // dimension of the unit is known, so the unit is valid.
  if (JSON.stringify(fromUnit) === JSON.stringify(toUnit))
    return { factor: [1n, 1n], piPower: 0, offset: [0n, 1n] };

  let e1: ExactScale | null;
  let e2: ExactScale | null;
  let o1: BigFraction = [0n, 1n];
  let o2: BigFraction = [0n, 1n];
  if (typeof fromUnit === 'string' && typeof toUnit === 'string') {
    const f = exactUnitData(fromUnit);
    const t = exactUnitData(toUnit);
    if (!f || !t) return null;
    [e1, e2, o1, o2] = [f, t, f.offset, t.offset];
  } else {
    e1 = exactExpressionScale(fromUnit);
    e2 = exactExpressionScale(toUnit);
  }
  if (e1 === null || e2 === null) return null;
  const [s1, s2] = [e1.scale, e2.scale];
  if (s1[0] <= 0n || s2[0] <= 0n) return null;
  const piPower = e1.piPower - e2.piPower;
  // An offset (a temperature unit) with a power of π is not a unit of the
  // table: the offset below would not be a fraction.
  if (piPower !== 0 && (o1[0] !== 0n || o2[0] !== 0n)) return null;

  const reduce = ([n, d]: BigFraction): BigFraction => {
    const g = gcd(n < 0n ? -n : n, d);
    return g > 1n ? [n / g, d / g] : [n, d];
  };
  // k = s₁/s₂, with a positive denominator because both scales are positive
  const k = reduce([s1[0] * s2[1], s1[1] * s2[0]]);
  // o₁·k − o₂
  const offset = reduce([
    o1[0] * k[0] * o2[1] - o2[0] * o1[1] * k[1],
    o1[1] * k[1] * o2[1],
  ]);
  return { factor: k, piPower, offset };
}

// ---------------------------------------------------------------------------
// Structural unit cancellation
// ---------------------------------------------------------------------------

/**
 * Flatten a compound unit expression into a map from unit symbol to its
 * summed exponent.
 *
 * - `string` → add `exp` to the symbol's running total.
 * - `["Multiply", ...]` → recurse each child with the same exponent.
 * - `["Divide", a, b]` → recurse `a` with `+exp`, `b` with `−exp`.
 * - `["Power", base, n]` (n a number) → recurse `base` with `exp·n`.
 *
 * Returns `null` on any other shape (the caller then leaves the unit
 * untouched).  Because same-symbol exponents are summed, `in¹·in⁻¹` cancels
 * exactly, with no floating-point scale involved.
 */
export function flattenUnitFactors(
  expr: UnitExpression
): Map<string, number> | null {
  const factors = new Map<string, number>();

  function walk(e: UnitExpression, exp: number): boolean {
    if (typeof e === 'string') {
      factors.set(e, (factors.get(e) ?? 0) + exp);
      return true;
    }
    if (!Array.isArray(e) || e.length < 2) return false;
    const op = e[0];
    if (op === 'Multiply') {
      for (let i = 1; i < e.length; i++) if (!walk(e[i], exp)) return false;
      return true;
    }
    if (op === 'Divide') {
      if (e.length !== 3) return false;
      return walk(e[1], exp) && walk(e[2], -exp);
    }
    if (op === 'Power') {
      if (e.length !== 3) return false;
      const n = unitExponentValue(e[2]);
      if (n === null) return false;
      return walk(e[1], exp * n);
    }
    return false;
  }

  if (!walk(expr, 1)) return null;
  return factors;
}

/**
 * Cancel repeated unit factors that share a physical dimension.
 *
 * Zero-exponent entries are dropped.  The remaining symbols are grouped by
 * their dimension vector.  For each group with MIXED-SIGN exponents (genuine
 * cancellation potential, e.g. `m` and `in` with `+1`/`−1`), the member with
 * the largest scale is chosen as the representative (same convention as
 * `quantityAdd`); every other member `s` with exponent `e` folds into the
 * representative (`magnitudeScale *= (scale_s / scale_rep) ** e`, and `e` is
 * added to the representative's exponent).  The representative itself is
 * dropped if its summed exponent reaches 0.  Groups whose exponents are all
 * the same sign are left untouched (so `in·ft` area survives as written).
 *
 * Offsets (degC/degF) are intentionally ignored, consistent with
 * `getExpressionScale`/`convertCompoundUnit` in compound contexts.
 *
 * Returns the reduced factor map plus the accumulated magnitude scale, or
 * `null` when a symbol has an unknown dimension.
 */
export function cancelUnitFactors(
  factors: Map<string, number>
): { factors: Map<string, number>; magnitudeScale: number } | null {
  // Drop zero-exponent entries.
  const result = new Map<string, number>();
  for (const [sym, exp] of factors) if (exp !== 0) result.set(sym, exp);

  // Group remaining symbols by dimension-vector key.
  const groups = new Map<string, string[]>();
  for (const sym of result.keys()) {
    const dim = getUnitDimension(sym);
    if (!dim) return null;
    const key = dim.join(',');
    const arr = groups.get(key);
    if (arr) arr.push(sym);
    else groups.set(key, [sym]);
  }

  let magnitudeScale = 1;
  for (const members of groups.values()) {
    if (members.length < 2) continue;

    // Only cancel groups with mixed-sign exponents.
    let hasPos = false;
    let hasNeg = false;
    for (const sym of members) {
      const e = result.get(sym)!;
      if (e > 0) hasPos = true;
      else if (e < 0) hasNeg = true;
    }
    if (!hasPos || !hasNeg) continue;

    // Representative = member with the largest scale.
    let rep = members[0];
    let repScale = getUnitScale(rep);
    if (repScale === null) return null;
    for (const sym of members) {
      const s = getUnitScale(sym);
      if (s === null) return null;
      if (s > repScale) {
        repScale = s;
        rep = sym;
      }
    }

    for (const sym of members) {
      if (sym === rep) continue;
      const e = result.get(sym)!;
      const s = getUnitScale(sym)!;
      magnitudeScale *= (s / repScale) ** e;
      result.set(rep, result.get(rep)! + e);
      result.delete(sym);
    }
    if (result.get(rep) === 0) result.delete(rep);
  }

  return { factors: result, magnitudeScale };
}

/**
 * Rebuild a canonical `UnitExpression` from a factor map (symbol → exponent).
 *
 * Numerator factors (positive exponents) become a bare symbol, a `Power`, or
 * a `Multiply`; denominator factors (negative exponents) go under a `Divide`.
 * When there are only denominator factors, negative `Power` forms are emitted
 * directly (matching what `quantityDivide`'s scalar/Quantity path produces),
 * since a numeric `1` is not a valid unit symbol.
 *
 * Returns `null` for an empty map (fully cancelled → dimensionless).
 */
export function unitExpressionFromFactors(
  factors: Map<string, number>
): UnitExpression | null {
  const num: UnitExpression[] = [];
  const den: UnitExpression[] = [];
  const negPow: UnitExpression[] = [];
  for (const [sym, exp] of factors) {
    if (exp === 0) continue;
    if (exp > 0) {
      num.push(exp === 1 ? sym : ['Power', sym, exp]);
    } else {
      den.push(-exp === 1 ? sym : ['Power', sym, -exp]);
      negPow.push(['Power', sym, exp]);
    }
  }

  if (num.length === 0 && den.length === 0) return null;

  if (num.length === 0) {
    // Only denominator factors — use negative Power form(s).
    return negPow.length === 1 ? negPow[0] : ['Multiply', ...negPow];
  }

  const numExpr: UnitExpression =
    num.length === 1 ? num[0] : ['Multiply', ...num];

  if (den.length === 0) return numExpr;

  const denExpr: UnitExpression =
    den.length === 1 ? den[0] : ['Multiply', ...den];

  return ['Divide', numExpr, denExpr];
}

// ---------------------------------------------------------------------------
// DSL string parsing
// ---------------------------------------------------------------------------

/**
 * Parse a unit token like `"s^2"` into a MathJSON expression.
 * A plain unit (no `^`) stays as a string; `"s^2"` becomes
 * `["Power", "s", 2]`.
 *
 * The exponent is an integer (`s^-2`), a decimal number (`m^0.5` is
 * `["Power", "m", 0.5]`) or a fraction, which may be in parentheses
 * (`m^(1/2)` is `["Power", "m", ["Rational", 1, 2]]`). Any other exponent
 * text leaves the token unchanged, so that it is not a known unit:
 * `m^2s` is not read as `m^2`.
 */
function parseUnitToken(token: string): UnitExpression {
  const caretIdx = token.indexOf('^');
  if (caretIdx === -1) return token;

  const base = token.slice(0, caretIdx);
  let expStr = token.slice(caretIdx + 1).trim();
  if (expStr.startsWith('(') && expStr.endsWith(')'))
    expStr = expStr.slice(1, -1).trim();

  if (/^[+-]?\d+$/.test(expStr)) return ['Power', base, parseInt(expStr, 10)];

  if (/^[+-]?(\d+\.\d*|\.\d+)$/.test(expStr))
    return ['Power', base, parseFloat(expStr)];

  const fraction = expStr.match(/^([+-]?\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const n = parseInt(fraction[1], 10);
    const d = parseInt(fraction[2], 10);
    if (d === 0) return token;
    if (n % d === 0) return ['Power', base, n / d];
    return ['Power', base, ['Rational', n, d]];
  }

  return token;
}

/**
 * The numeric value of the exponent of a `["Power", base, exp]` unit
 * expression: a number, or a fraction `["Rational", n, d]` (as the unit DSL
 * gives for `m^(1/2)`). Returns `null` for any other exponent.
 */
function unitExponentValue(exp: unknown): number | null {
  if (typeof exp === 'number') return exp;
  if (
    Array.isArray(exp) &&
    exp.length === 3 &&
    exp[0] === 'Rational' &&
    typeof exp[1] === 'number' &&
    typeof exp[2] === 'number' &&
    exp[2] !== 0
  )
    return exp[1] / exp[2];
  return null;
}

/**
 * Parse a DSL group, which may contain parenthesized sub-expressions.
 * Handles `(m*s^2)` by stripping outer parens and recursing.
 *
 * A single pass finds both the first top-level `/` and all top-level `*`
 * split points.  `/` binds more loosely than `*`, so if a slash is found
 * the string is split there first.
 */
function parseDSLGroup(s: string): UnitExpression | null {
  s = s.trim();
  if (s.length === 0) return null;

  // Strip outer parentheses: "(m*s^2)" → "m*s^2"
  if (s[0] === '(' && s[s.length - 1] === ')') {
    // Verify the parens are matched (not like "(a)*(b)")
    let depth = 0;
    let matched = true;
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      if (depth === 0 && i < s.length - 1) {
        matched = false;
        break;
      }
    }
    if (matched) return parseDSLGroup(s.slice(1, -1));
  }

  // Single pass: find top-level `/` and `*` positions
  let slashIdx = -1;
  const starPositions: number[] = [];
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (depth === 0) {
      if (s[i] === '/' && slashIdx === -1) slashIdx = i;
      else if (s[i] === '*') starPositions.push(i);
    }
  }

  // `/` binds more loosely — split there first
  if (slashIdx !== -1) {
    const numStr = s.slice(0, slashIdx).trim();
    const denStr = s.slice(slashIdx + 1).trim();
    const den = parseDSLGroup(denStr);
    // A numerator `1` is not a unit: `1/s` is `s^-1`.
    if (numStr === '1') return den ? ['Power', den, -1] : null;
    const num = parseDSLGroup(numStr);
    if (!num || !den) return null;
    return ['Divide', num, den];
  }

  // Split on top-level `*`
  if (starPositions.length > 0) {
    const tokens: string[] = [];
    let start = 0;
    for (const pos of starPositions) {
      tokens.push(s.slice(start, pos).trim());
      start = pos + 1;
    }
    tokens.push(s.slice(start).trim());
    const parts = tokens
      .filter((t) => t.length > 0)
      .map((t) => parseDSLGroup(t));
    if (parts.some((p) => p === null)) return null;
    if (parts.length === 1) return parts[0];
    return ['Multiply', ...parts];
  }

  // A group with an exponent: `(mi/h)^2` is `["Power", ["Divide", "mi",
  // "h"], 2]`. The exponent is read as the exponent of a unit token.
  if (s[0] === '(') {
    let close = -1;
    depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')' && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close > 0 && s[close + 1] === '^') {
      const base = parseDSLGroup(s.slice(1, close));
      const power = parseUnitToken(`x${s.slice(close + 1)}`);
      if (base !== null && Array.isArray(power))
        return ['Power', base, power[2]];
    }
    // Otherwise the text is not a unit: the parentheses are unbalanced, two
    // groups are adjacent (`(m)(s)`), or the exponent is not a number.
    return null;
  }
  return parseUnitToken(s);
}

/**
 * Parse a unit DSL string like `"m/s^2"` or `"kg*m/s^2"` into a
 * MathJSON unit expression.
 *
 * Grammar:
 * - `*` = multiplication
 * - `/` = division (everything after `/` is in denominator)
 * - `^N` = power (an integer, a decimal number, or a fraction such as
 *   `^(1/2)`)
 * - `1/x` = the reciprocal of `x` (`["Power", x, -1]`)
 * - `(...)` = grouping
 * - Simple units (no operators) stay as strings.
 *
 * Examples:
 * ```
 * parseUnitDSL("m")          // "m"
 * parseUnitDSL("km")         // "km"
 * parseUnitDSL("m/s")        // ["Divide", "m", "s"]
 * parseUnitDSL("m/s^2")      // ["Divide", "m", ["Power", "s", 2]]
 * parseUnitDSL("kg*m/s^2")   // ["Divide", ["Multiply", "kg", "m"], ["Power", "s", 2]]
 * parseUnitDSL("kg/(m*s^2)") // ["Divide", "kg", ["Multiply", "m", ["Power", "s", 2]]]
 * ```
 */
export function parseUnitDSL(s: string): UnitExpression | null {
  s = s.trim();
  if (s.length === 0) return null;

  // Fast path: no operators at all
  if (!/[/*^()]/.test(s)) return s;

  return parseDSLGroup(s);
}

/**
 * Convert a numeric `value` between two compound unit expressions.
 *
 * Both `fromUnit` and `toUnit` may be simple strings or MathJSON arrays.
 * Returns the converted value, or `null` on dimensional mismatch or
 * unknown units.
 *
 * For simple string units, delegates to `convertUnit` so that affine
 * offsets (degC, degF) are handled correctly.
 */
export function convertCompoundUnit(
  value: number,
  fromUnit: UnitExpression,
  toUnit: UnitExpression
): number | null {
  // For two simple symbols, delegate to convertUnit (handles affine offsets)
  if (typeof fromUnit === 'string' && typeof toUnit === 'string')
    return convertUnit(value, fromUnit, toUnit);

  const fromDim = getExpressionDimension(fromUnit);
  const toDim = getExpressionDimension(toUnit);
  if (!fromDim || !toDim) return null;

  if (!dimensionsEqual(fromDim, toDim)) return null;

  const fromScale = getExpressionScale(fromUnit);
  const toScale = getExpressionScale(toUnit);
  if (fromScale === null || toScale === null || toScale === 0) return null;

  return (value * fromScale) / toScale;
}
