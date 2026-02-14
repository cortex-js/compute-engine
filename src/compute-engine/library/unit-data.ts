/**
 * Unit registry: dimension vectors, SI base units, prefixes, and conversion.
 *
 * A DimensionVector encodes the exponents for each of the 7 SI base
 * dimensions: [length, mass, time, current, temperature, amount, luminosity].
 *
 * Every unit in the registry stores its dimension vector and a scale factor
 * relative to the coherent SI unit for that dimension.  For example the meter
 * has scale 1, the kilometer has scale 1000, and the inch has scale 0.0254
 * (all measuring length).
 *
 * Prefixed units (km, mg, GHz, ...) are resolved on the fly by
 * `parsePrefixedUnit` rather than stored explicitly.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * 7-tuple of exponents over the SI base dimensions:
 * [length, mass, time, current, temperature, amount, luminosity]
 */
export type DimensionVector = [
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
}

// ---------------------------------------------------------------------------
// SI Prefixes
// ---------------------------------------------------------------------------

/** Map from prefix symbol to its power-of-10 multiplier. */
const SI_PREFIXES: Record<string, number> = {
  Q: 1e30,
  R: 1e27,
  Y: 1e24,
  Z: 1e21,
  E: 1e18,
  P: 1e15,
  T: 1e12,
  G: 1e9,
  M: 1e6,
  k: 1e3,
  h: 1e2,
  da: 1e1,
  d: 1e-1,
  c: 1e-2,
  m: 1e-3,
  '\u00B5': 1e-6, // µ (micro sign U+00B5)
  '\u03BC': 1e-6, // μ (Greek small letter mu U+03BC)
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
  a: 1e-18,
  z: 1e-21,
  y: 1e-24,
  r: 1e-27,
  q: 1e-30,
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

//                        L  M  T  I  Θ  N  J
// Indices:               0  1  2  3  4  5  6

const UNIT_TABLE: Record<string, UnitEntry> = {
  // ---- SI base units ----
  m: { dimension: [1, 0, 0, 0, 0, 0, 0], scale: 1 },
  kg: { dimension: [0, 1, 0, 0, 0, 0, 0], scale: 1 },
  g: { dimension: [0, 1, 0, 0, 0, 0, 0], scale: 1e-3 },
  s: { dimension: [0, 0, 1, 0, 0, 0, 0], scale: 1 },
  A: { dimension: [0, 0, 0, 1, 0, 0, 0], scale: 1 },
  K: { dimension: [0, 0, 0, 0, 1, 0, 0], scale: 1 },
  mol: { dimension: [0, 0, 0, 0, 0, 1, 0], scale: 1 },
  cd: { dimension: [0, 0, 0, 0, 0, 0, 1], scale: 1 },

  // ---- Named derived SI units ----
  Hz: { dimension: [0, 0, -1, 0, 0, 0, 0], scale: 1 },
  N: { dimension: [1, 1, -2, 0, 0, 0, 0], scale: 1 },
  Pa: { dimension: [-1, 1, -2, 0, 0, 0, 0], scale: 1 },
  J: { dimension: [2, 1, -2, 0, 0, 0, 0], scale: 1 },
  W: { dimension: [2, 1, -3, 0, 0, 0, 0], scale: 1 },
  C: { dimension: [0, 0, 1, 1, 0, 0, 0], scale: 1 },
  V: { dimension: [2, 1, -3, -1, 0, 0, 0], scale: 1 },
  F: { dimension: [-2, -1, 4, 2, 0, 0, 0], scale: 1 },
  ohm: { dimension: [2, 1, -3, -2, 0, 0, 0], scale: 1 },
  S: { dimension: [-2, -1, 3, 2, 0, 0, 0], scale: 1 },
  Wb: { dimension: [2, 1, -2, -1, 0, 0, 0], scale: 1 },
  T: { dimension: [0, 1, -2, -1, 0, 0, 0], scale: 1 },
  H: { dimension: [2, 1, -2, -2, 0, 0, 0], scale: 1 },
  lm: { dimension: [0, 0, 0, 0, 0, 0, 1], scale: 1 },
  lx: { dimension: [-2, 0, 0, 0, 0, 0, 1], scale: 1 },
  Bq: { dimension: [0, 0, -1, 0, 0, 0, 0], scale: 1 },
  Gy: { dimension: [2, 0, -2, 0, 0, 0, 0], scale: 1 },
  Sv: { dimension: [2, 0, -2, 0, 0, 0, 0], scale: 1 },
  kat: { dimension: [0, 0, -1, 0, 0, 1, 0], scale: 1 },

  // ---- Non-SI accepted for use with SI ----
  min: { dimension: [0, 0, 1, 0, 0, 0, 0], scale: 60 },
  h: { dimension: [0, 0, 1, 0, 0, 0, 0], scale: 3600 },
  d: { dimension: [0, 0, 1, 0, 0, 0, 0], scale: 86400 },
  ha: { dimension: [2, 0, 0, 0, 0, 0, 0], scale: 1e4 },
  L: { dimension: [3, 0, 0, 0, 0, 0, 0], scale: 1e-3 },
  t: { dimension: [0, 1, 0, 0, 0, 0, 0], scale: 1e3 },
  eV: { dimension: [2, 1, -2, 0, 0, 0, 0], scale: 1.602176634e-19 },
  Da: { dimension: [0, 1, 0, 0, 0, 0, 0], scale: 1.66053906660e-27 },
  au: { dimension: [1, 0, 0, 0, 0, 0, 0], scale: 1.495978707e11 },

  // Angle units (dimensionless)
  deg: { dimension: [0, 0, 0, 0, 0, 0, 0], scale: Math.PI / 180 },
  rad: { dimension: [0, 0, 0, 0, 0, 0, 0], scale: 1 },
  grad: { dimension: [0, 0, 0, 0, 0, 0, 0], scale: Math.PI / 200 },
  turn: { dimension: [0, 0, 0, 0, 0, 0, 0], scale: 2 * Math.PI },
  arcmin: { dimension: [0, 0, 0, 0, 0, 0, 0], scale: Math.PI / 10800 },
  arcsec: { dimension: [0, 0, 0, 0, 0, 0, 0], scale: Math.PI / 648000 },

  // Dimensionless ratios
  percent: { dimension: [0, 0, 0, 0, 0, 0, 0], scale: 0.01 },
  ppm: { dimension: [0, 0, 0, 0, 0, 0, 0], scale: 1e-6 },

  // Logarithmic (dimensionless, scale is nominal)
  dB: { dimension: [0, 0, 0, 0, 0, 0, 0], scale: 1 },
  Np: { dimension: [0, 0, 0, 0, 0, 0, 0], scale: 1 },

  // ---- Common non-SI units ----
  in: { dimension: [1, 0, 0, 0, 0, 0, 0], scale: 0.0254 },
  ft: { dimension: [1, 0, 0, 0, 0, 0, 0], scale: 0.3048 },
  mi: { dimension: [1, 0, 0, 0, 0, 0, 0], scale: 1609.344 },
  lb: { dimension: [0, 1, 0, 0, 0, 0, 0], scale: 0.45359237 },
  oz: { dimension: [0, 1, 0, 0, 0, 0, 0], scale: 0.028349523125 },
  gal: { dimension: [3, 0, 0, 0, 0, 0, 0], scale: 3.785411784e-3 },
  atm: { dimension: [-1, 1, -2, 0, 0, 0, 0], scale: 101325 },
  bar: { dimension: [-1, 1, -2, 0, 0, 0, 0], scale: 1e5 },
  cal: { dimension: [2, 1, -2, 0, 0, 0, 0], scale: 4.184 },
  kWh: { dimension: [2, 1, -2, 0, 0, 0, 0], scale: 3.6e6 },
  '\u00C5': { dimension: [1, 0, 0, 0, 0, 0, 0], scale: 1e-10 }, // Å
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Look up a unit symbol directly in the table (no prefix parsing).
 * Returns the entry or `null` if not found.
 */
function lookupUnit(symbol: string): UnitEntry | null {
  return UNIT_TABLE[symbol] ?? null;
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
  const direct = lookupUnit(symbol);
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
  return da.every((v, i) => v === db[i]);
}

/**
 * Convert a numeric `value` from `fromUnit` to `toUnit`.
 *
 * Returns the converted value, or `null` when the units are unknown or
 * dimensionally incompatible.
 *
 * Note: this performs a simple linear conversion via SI scale factors.
 * Affine temperature conversions (degC, degF) are **not** handled here.
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
  if (!from.dimension.every((v, i) => v === to.dimension[i])) return null;

  // value_SI = value * from.scale
  // result   = value_SI / to.scale
  return (value * from.scale) / to.scale;
}
