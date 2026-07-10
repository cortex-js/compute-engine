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
}

// ---------------------------------------------------------------------------
// SI Prefixes
// ---------------------------------------------------------------------------

/** Map from prefix symbol to its power-of-10 multiplier. */
const SI_PREFIXES: Record<string, number> = {
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
  'degC': { dimension: [0, 0, 0, 0, 1, 0, 0, 0], scale: 1, offset: 273.15 },
  'degF': { dimension: [0, 0, 0, 0, 1, 0, 0, 0], scale: 5 / 9, offset: 459.67 },

  // ---- Non-SI accepted for use with SI ----
  'min': { dimension: [0, 0, 1, 0, 0, 0, 0, 0], scale: 60 },
  'h': { dimension: [0, 0, 1, 0, 0, 0, 0, 0], scale: 3600 },
  'd': { dimension: [0, 0, 1, 0, 0, 0, 0, 0], scale: 86400 },
  'wk': { dimension: [0, 0, 1, 0, 0, 0, 0, 0], scale: 604800 },
  'ha': { dimension: [2, 0, 0, 0, 0, 0, 0, 0], scale: 1e4 },
  'L': { dimension: [3, 0, 0, 0, 0, 0, 0, 0], scale: 1e-3 },
  't': { dimension: [0, 1, 0, 0, 0, 0, 0, 0], scale: 1e3 },
  'eV': { dimension: [2, 1, -2, 0, 0, 0, 0, 0], scale: 1.602176634e-19 },
  'Da': { dimension: [0, 1, 0, 0, 0, 0, 0, 0], scale: 1.6605390666e-27 },
  'au': { dimension: [1, 0, 0, 0, 0, 0, 0, 0], scale: 1.495978707e11 },

  // Angle units (dimensionless)
  'deg': { dimension: [0, 0, 0, 0, 0, 0, 0, 0], scale: Math.PI / 180 },
  'rad': { dimension: [0, 0, 0, 0, 0, 0, 0, 0], scale: 1 },
  'grad': { dimension: [0, 0, 0, 0, 0, 0, 0, 0], scale: Math.PI / 200 },
  'turn': { dimension: [0, 0, 0, 0, 0, 0, 0, 0], scale: 2 * Math.PI },
  'arcmin': { dimension: [0, 0, 0, 0, 0, 0, 0, 0], scale: Math.PI / 10800 },
  'arcsec': { dimension: [0, 0, 0, 0, 0, 0, 0, 0], scale: Math.PI / 648000 },

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

  // Affine conversion: SI_value = (value + offset) * scale
  // Then: result = SI_value / to.scale - to.offset
  const fromOffset = from.offset ?? 0;
  const toOffset = to.offset ?? 0;

  const siValue = (value + fromOffset) * from.scale;
  return siValue / to.scale - toOffset;
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
    const exp = expr[2];
    if (!d || typeof exp !== 'number') return null;
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
    const exp = expr[2];
    if (s === null || typeof exp !== 'number') return null;
    return Math.pow(s, exp);
  }

  return null;
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
      const n = e[2];
      if (typeof n !== 'number') return false;
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
 */
function parseUnitToken(token: string): UnitExpression {
  const caretIdx = token.indexOf('^');
  if (caretIdx === -1) return token;

  const base = token.slice(0, caretIdx);
  const expStr = token.slice(caretIdx + 1);
  const exp = parseInt(expStr, 10);
  if (isNaN(exp)) return token;

  return ['Power', base, exp];
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
    const num = parseDSLGroup(numStr);
    const den = parseDSLGroup(denStr);
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

  // Single token — if it starts with `(` we already tried paren-stripping
  // at the top and it didn't match, so the parens are unbalanced.
  if (s[0] === '(') return null;
  return parseUnitToken(s);
}

/**
 * Parse a unit DSL string like `"m/s^2"` or `"kg*m/s^2"` into a
 * MathJSON unit expression.
 *
 * Grammar:
 * - `*` = multiplication
 * - `/` = division (everything after `/` is in denominator)
 * - `^N` = power (integer exponent)
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
