/**
 * Arithmetic helpers for Quantity expressions.
 *
 * Extracted from arithmetic.ts to keep that file focused on scalar
 * arithmetic.  Every function here operates on Quantity expressions
 * (magnitude + unit pairs) and is called from the evaluate paths of
 * Add, Multiply, Divide, Power, Negate, Sqrt, and Root.
 */

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { asFloat, hasFloatOperand } from '../boxed-expression/float-result.js';
import { bignumPreferred } from '../boxed-expression/utils.js';
import {
  affineMagnitude,
  boxedToUnitExpression,
  canonicalUnit,
  canonicalUnitFromFactorMap,
  isExactConversion,
  unitExactlyCancels,
  isSymbolicValue,
  usesExpressionArithmetic,
} from './units.js';
import {
  convertUnit,
  unitConversionCoefficients,
  convertCompoundUnit,
  exactUnitConversion,
  dimensionsEqual,
  isDimensionless,
  getExpressionScale,
  getExpressionDimension,
  flattenUnitFactors,
  cancelUnitFactors,
  unitExpressionFromFactors,
  type UnitExpression,
} from './unit-data.js';
import {
  isMeasurement,
  measurementAdd,
  measurementMultiply,
  measurementDivide,
  measurementPower,
} from './measurement-arithmetic.js';

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/** A Quantity function expression with guaranteed op1 and op2 access. */
export type QuantityExpr = Expression & {
  readonly op1: Expression;
  readonly op2: Expression;
  readonly ops: ReadonlyArray<Expression>;
};

/** Check if an expression is a Quantity and narrow the type. */
export function isQuantity(expr: Expression): expr is QuantityExpr {
  return isFunction(expr, 'Quantity');
}

// ---------------------------------------------------------------------------
// Internal accessors
// ---------------------------------------------------------------------------

function unitSymbol(q: QuantityExpr): string | null {
  const u = q.op2;
  return isSymbol(u) ? u.symbol : null;
}

/**
 * Convert a (possibly `Measurement`) magnitude expression from its own unit to
 * the target unit, preserving/scaling a `Measurement` error.  Unit conversion
 * is affine (`x → f·x + c`); the linear factor `f = convert(1) − convert(0)`
 * removes any additive offset (so the error scales by `|f|` while the offset
 * shifts the nominal only).  Returns `undefined` if the units are incompatible.
 *
 * A magnitude that has a numeric value (not a `Measurement`, not symbolic)
 * is converted with expression arithmetic only when the conversion keeps an
 * exact value exact (see `isExactConversion()`). Otherwise the result is a
 * float, and the conversion is numeric. For two unit symbols, the expression
 * arithmetic reads `f` and `c` from `unitConversionCoefficients()`, which
 * computes them from exact data: the difference `convert(1) − convert(0)` of
 * two floats loses digits for a temperature (`degC → degF` gives
 * `1.7999999999999972`).
 */
function convertMagnitude(
  ce: ComputeEngine,
  mag: Expression,
  opSymbol: string | null,
  opUE: ReturnType<typeof boxedToUnitExpression>,
  targetSymbol: string | null,
  targetUE: ReturnType<typeof boxedToUnitExpression>
): Expression | undefined {
  const numeric = !isMeasurement(mag) && !isSymbolicValue(mag);
  // Above machine precision (`bignumPreferred()`), a float magnitude is
  // converted with the exact factor and offset of the conversion
  // (`exactUnitConversion()`), at the working precision: the machine factor
  // `0.01` of `cm → m` converts `1.3 cm` to `0.013000000000000001 m`. An
  // exact magnitude keeps the rule below: a conversion that is not exact
  // gives a float.
  if (
    numeric &&
    hasFloatOperand([mag]) &&
    bignumPreferred(ce) &&
    opUE &&
    targetUE
  ) {
    const map = exactUnitConversion(opUE, targetUE);
    if (map !== null) {
      const factor = [ce.number(map.factor)];
      if (map.piPower !== 0)
        factor.push(ce.function('Power', [ce.Pi, ce.number(map.piPower)]));
      return ce
        .function('Add', [
          ce.function('Multiply', [...factor, mag]),
          ce.number(map.offset),
        ])
        .evaluate();
    }
  }
  // The conversion is numeric only when it is not exact, so the result is a
  // float, also when its value is an integer: `100 cm` converted to `m` is
  // the float `1`.
  const numericResult = (x: number | null) =>
    x === null ? undefined : asFloat(ce.number(x));
  if (targetSymbol && opSymbol) {
    if (opSymbol === targetSymbol) return mag;
    const c0 = convertUnit(0, opSymbol, targetSymbol);
    const c1 = convertUnit(1, opSymbol, targetSymbol);
    if (c0 === null || c1 === null) return undefined;
    if (numeric && !isExactConversion(c0, c1))
      return numericResult(convertUnit(mag.re, opSymbol, targetSymbol));
    const map = unitConversionCoefficients(opSymbol, targetSymbol);
    if (map === null) return undefined;
    return affineMagnitude(ce, mag, map.factor, map.offset);
  }
  if (!opUE || !targetUE) return undefined;
  const c0 = convertCompoundUnit(0, opUE, targetUE);
  const c1 = convertCompoundUnit(1, opUE, targetUE);
  if (c0 === null || c1 === null) return undefined;
  if (numeric && !isExactConversion(c0, c1))
    return numericResult(convertCompoundUnit(mag.re, opUE, targetUE));
  return affineMagnitude(ce, mag, c1 - c0, c0);
}

// The error terms of the `Measurement` combinators multiply a value by the
// square of a zero error, and for an infinite value that product is
// `Indeterminate`: `2 · Quantity(+∞, m)` gave `(+∞ ± Indeterminate) m`. The
// helpers below use the combinators only when an operand is a `Measurement`,
// and plain expression arithmetic otherwise.

function addMagnitudes(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (ops.some((x) => isMeasurement(x))) return measurementAdd(ce, ops);
  return ce.function('Add', ops).evaluate();
}

function multiplyMagnitudes(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (ops.some((x) => isMeasurement(x))) return measurementMultiply(ce, ops);
  return ce.function('Multiply', ops).evaluate();
}

function divideMagnitudes(
  ce: ComputeEngine,
  num: Expression,
  den: Expression
): Expression | undefined {
  if (isMeasurement(num) || isMeasurement(den))
    return measurementDivide(ce, num, den);
  return num.div(den);
}

// ---------------------------------------------------------------------------
// Quantity arithmetic
// ---------------------------------------------------------------------------

/**
 * Add Quantity expressions.  All operands must be Quantities with
 * compatible dimensions.  The result uses the unit with the largest
 * scale factor (e.g. `m` wins over `cm`, `km` wins over `m`).
 */
export function quantityAdd(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (ops.length === 0) return undefined;

  // Collect all Quantity operands and cache their UnitExpressions
  const quantities: QuantityExpr[] = [];
  const unitExprs: ReturnType<typeof boxedToUnitExpression>[] = [];
  for (const op of ops) {
    if (!isQuantity(op)) return undefined; // non-Quantity mixed in
    const ue = boxedToUnitExpression(op.op2);
    if (!ue) return undefined;
    quantities.push(op);
    unitExprs.push(ue);
  }
  if (quantities.length === 0) return undefined;

  // Find the unit with the largest scale factor
  let bestIdx = 0;
  let bestScale = 0;
  for (let i = 0; i < quantities.length; i++) {
    const s = getExpressionScale(unitExprs[i]!);
    if (s === null) return undefined;
    if (s > bestScale) {
      bestScale = s;
      bestIdx = i;
    }
  }

  const bestQ = quantities[bestIdx];
  const targetSymbol = unitSymbol(bestQ);
  const targetUE = unitExprs[bestIdx];

  // Measurement-carrying magnitudes: convert each to the target unit (scaling
  // its error by the conversion factor) then combine with error-propagating
  // addition instead of raw numeric summation. A symbolic or exact magnitude
  // uses the same expression arithmetic, with no error (see
  // `usesExpressionArithmetic()`).
  if (usesExpressionArithmetic(quantities.map((q) => q.op1))) {
    const mags: Expression[] = [];
    for (let i = 0; i < quantities.length; i++) {
      const q = quantities[i];
      const converted = convertMagnitude(
        ce,
        q.op1,
        unitSymbol(q),
        unitExprs[i],
        targetSymbol,
        targetUE
      );
      if (converted === undefined) return undefined;
      mags.push(converted);
    }
    const combined = addMagnitudes(ce, mags);
    if (combined === undefined) return undefined;
    return ce._fn('Quantity', [combined, bestQ.op2]);
  }

  let total = 0;
  for (let i = 0; i < quantities.length; i++) {
    const q = quantities[i];
    const mag = q.op1.re;
    if (mag === undefined) return undefined;

    const opSymbol = unitSymbol(q);

    // Fast path: both are simple symbol units
    if (targetSymbol && opSymbol) {
      if (opSymbol === targetSymbol) {
        total += mag;
      } else {
        const converted = convertUnit(mag, opSymbol, targetSymbol);
        if (converted === null) return undefined;
        total += converted;
      }
      continue;
    }

    // Compound unit path
    const opUE = unitExprs[i];
    if (!opUE || !targetUE) return undefined;
    const converted = convertCompoundUnit(mag, opUE, targetUE);
    if (converted === null) return undefined;
    total += converted;
  }

  // A float magnitude makes the sum a float, also when its value is an
  // integer.
  return ce._fn('Quantity', [asFloat(ce.number(total)), bestQ.op2]);
}

/**
 * Multiply expressions where at least one is a Quantity.
 * - scalar * Quantity => Quantity with scaled magnitude
 * - Quantity * Quantity => Quantity with compound unit
 */
export function quantityMultiply(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  const scalars: Expression[] = [];
  const quantities: QuantityExpr[] = [];

  for (const op of ops) {
    if (isQuantity(op)) quantities.push(op);
    else scalars.push(op);
  }

  if (quantities.length === 0) return undefined;

  // Measurement-carrying magnitudes (or scalars): multiply magnitudes with
  // error-propagating multiplication instead of raw numeric products. A
  // symbolic or exact scalar or magnitude uses the same expression
  // arithmetic, with no error, so that the product stays symbolic or exact
  // (see `usesExpressionArithmetic()`).
  const factors: Expression[] = [...scalars, ...quantities.map((q) => q.op1)];
  if (usesExpressionArithmetic(factors)) {
    const combinedMag = multiplyMagnitudes(ce, factors);
    if (combinedMag === undefined) return undefined;

    if (quantities.length === 1)
      return ce._fn('Quantity', [combinedMag, quantities[0].op2]);

    const unitParts = quantities.map((q) => q.op2);
    const combinedUnit = ce._fn('Multiply', unitParts);
    return simplifyQuantityUnitMeasurement(ce, combinedMag, combinedUnit);
  }

  // Compute scalar product
  let scalarValue = 1;
  for (const s of scalars) {
    const v = s.re;
    if (v === undefined) return undefined;
    scalarValue *= v;
  }

  if (quantities.length === 1) {
    // scalar * Quantity
    const q = quantities[0];
    const mag = q.op1.re;
    if (mag === undefined) return undefined;
    return ce._fn('Quantity', [asFloat(ce.number(scalarValue * mag)), q.op2]);
  }

  // Multiple quantities: multiply magnitudes, combine units
  let totalMag = scalarValue;
  const unitParts: Expression[] = [];
  for (const q of quantities) {
    const mag = q.op1.re;
    if (mag === undefined) return undefined;
    totalMag *= mag;
    unitParts.push(q.op2);
  }

  const combinedUnit =
    unitParts.length === 1 ? unitParts[0] : ce._fn('Multiply', unitParts);

  return simplifyQuantityUnit(ce, totalMag, combinedUnit);
}

/**
 * Post-numericization re-dispatch for `Add`/`Multiply` (Tycho item 101).
 *
 * The Quantity check in the `Add`/`Multiply` evaluate handlers runs against
 * the operands as returned by `evaluate()`.  An operand that only BECOMES a
 * Quantity under numeric approximation is invisible to that check, so
 * `addN`/`mulN` leave the fold undone — the same structural gap as the
 * Measurement one closed by `foldMeasurementOperands`, and the same fix:
 * `addN`/`mulN` numericize their operands, so the Quantity IS visible in the
 * result they return; fold it here so the FIRST `.N()` yields a Quantity.
 *
 * Checked BEFORE the Measurement fold at the call sites, mirroring the
 * handlers' precedence for mixed operands (`quantityAdd`/`quantityMultiply`
 * route Measurement-carrying magnitudes through the measurement combinators
 * themselves).  The result is made numeric, as in the handlers'
 * numeric-approximation branch: a Measurement magnitude, and an exact
 * magnitude that the exact arithmetic of `quantityMultiply` kept exact, are
 * `.N()`-ed.
 *
 * Keyed off the RESULT's operator, not the caller's: `addN` may return a
 * `Multiply` (`q + q` → `2·q`).  Returns `undefined` when there is nothing to
 * fold, which is the hot path (a plain numeric sum returns a number literal,
 * rejected by the operator test alone).
 */
export function foldQuantityOperands(
  ce: ComputeEngine,
  expr: Expression
): Expression | undefined {
  const operator = expr.operator;
  if (operator !== 'Add' && operator !== 'Multiply') return undefined;
  if (!isFunction(expr)) return undefined;
  const ops = expr.ops;
  if (!ops.some((x) => isQuantity(x))) return undefined;
  const r =
    operator === 'Add' ? quantityAdd(ce, ops) : quantityMultiply(ce, ops);
  if (r === undefined) return undefined;
  return r.N();
}

/**
 * Divide two expressions where at least one is a Quantity.
 */
export function quantityDivide(
  ce: ComputeEngine,
  num: Expression,
  den: Expression
): Expression | undefined {
  const numQ = isQuantity(num) ? num : null;
  const denQ = isQuantity(den) ? den : null;

  // Measurement-carrying magnitudes: propagate the error through the division.
  // A symbolic or exact operand or magnitude uses the same expression
  // arithmetic, with no error (see `usesExpressionArithmetic()`). A division
  // by an exact zero is left to the generic `Divide` handler, as on the
  // numeric route below.
  const numValue = numQ ? numQ.op1 : num;
  const denValue = denQ ? denQ.op1 : den;
  if (usesExpressionArithmetic([numValue, denValue])) {
    if (isNumber(denValue) && denValue.isSame(0)) return undefined;
    const result = quantityDivideMeasurement(ce, num, den, numQ, denQ);
    if (result !== undefined) return result;
  }

  if (numQ && denQ) {
    // Quantity / Quantity
    const numMag = numQ.op1.re;
    const denMag = denQ.op1.re;
    if (numMag === undefined || denMag === undefined || denMag === 0)
      return undefined;
    const resultMag = numMag / denMag;

    // Check if units cancel (same dimension → dimensionless scalar)
    const numUE = boxedToUnitExpression(numQ.op2);
    const denUE = boxedToUnitExpression(denQ.op2);
    if (numUE && denUE) {
      const numDim = getExpressionDimension(numUE);
      const denDim = getExpressionDimension(denUE);
      if (numDim && denDim && dimensionsEqual(numDim, denDim)) {
        // Same dimension — convert to common scale and return scalar
        const numScale = getExpressionScale(numUE);
        const denScale = getExpressionScale(denUE);
        if (numScale !== null && denScale !== null)
          return asFloat(ce.number((numMag * numScale) / (denMag * denScale)));
      }
    }

    // Different dimensions — produce compound unit, then try to simplify
    const resultUnit = ce._fn('Divide', [numQ.op2, denQ.op2]);
    return simplifyQuantityUnit(ce, resultMag, resultUnit);
  }

  if (numQ && !denQ) {
    // Quantity / scalar
    const mag = numQ.op1.re;
    const scalar = den.re;
    if (mag === undefined || scalar === undefined || scalar === 0)
      return undefined;
    return ce._fn('Quantity', [asFloat(ce.number(mag / scalar)), numQ.op2]);
  }

  if (!numQ && denQ) {
    // scalar / Quantity => Quantity with inverted unit
    const scalar = num.re;
    const mag = denQ.op1.re;
    if (scalar === undefined || mag === undefined || mag === 0)
      return undefined;
    const invertedUnit = canonicalUnit(
      ce,
      ce._fn('Power', [denQ.op2, ce.number(-1)])
    );
    return ce._fn('Quantity', [asFloat(ce.number(scalar / mag)), invertedUnit]);
  }

  return undefined;
}

/**
 * Measurement-magnitude counterpart of `quantityDivide`.  Mirrors the four
 * cases (Quantity/Quantity, Quantity/scalar, scalar/Quantity) but combines the
 * magnitudes with error-propagating division.  `num`/`den` may themselves be
 * bare `Measurement` scalars (dimensionless measured quantities).
 */
function quantityDivideMeasurement(
  ce: ComputeEngine,
  num: Expression,
  den: Expression,
  numQ: QuantityExpr | null,
  denQ: QuantityExpr | null
): Expression | undefined {
  if (numQ && denQ) {
    const numMag = numQ.op1;
    const denMag = denQ.op1;

    // Check if units cancel (same dimension → dimensionless measurement)
    const numUE = boxedToUnitExpression(numQ.op2);
    const denUE = boxedToUnitExpression(denQ.op2);
    if (numUE && denUE) {
      const numDim = getExpressionDimension(numUE);
      const denDim = getExpressionDimension(denUE);
      if (numDim && denDim && dimensionsEqual(numDim, denDim)) {
        const numScale = getExpressionScale(numUE);
        const denScale = getExpressionScale(denUE);
        if (numScale !== null && denScale !== null && denScale !== 0) {
          const ratio = divideMagnitudes(ce, numMag, denMag);
          if (ratio === undefined) return undefined;
          return scaleMagnitude(ce, ratio, numScale / denScale);
        }
      }
    }

    const resultMag = divideMagnitudes(ce, numMag, denMag);
    if (resultMag === undefined) return undefined;
    const resultUnit = ce._fn('Divide', [numQ.op2, denQ.op2]);
    return simplifyQuantityUnitMeasurement(ce, resultMag, resultUnit);
  }

  if (numQ && !denQ) {
    // Quantity / scalar
    const resultMag = divideMagnitudes(ce, numQ.op1, den);
    if (resultMag === undefined) return undefined;
    return ce._fn('Quantity', [resultMag, numQ.op2]);
  }

  if (!numQ && denQ) {
    // scalar / Quantity => Quantity with inverted unit
    const resultMag = divideMagnitudes(ce, num, denQ.op1);
    if (resultMag === undefined) return undefined;
    const invertedUnit = canonicalUnit(
      ce,
      ce._fn('Power', [denQ.op2, ce.number(-1)])
    );
    return ce._fn('Quantity', [resultMag, invertedUnit]);
  }

  return undefined;
}

/** Shallow equality of two `symbol → exponent` factor maps. */
function factorMapsEqual(
  a: Map<string, number>,
  b: Map<string, number>
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/**
 * Whether a unit symbol occurs more than once in a unit expression
 * (`m·m`, `m^2·m`, `m/m`).  The operator name at index 0 and the numeric
 * exponents of `Power` are skipped.
 */
function hasRepeatedUnitSymbol(ue: UnitExpression): boolean {
  const seen = new Set<string>();
  const walk = (e: UnitExpression): boolean => {
    if (typeof e === 'string') {
      if (seen.has(e)) return true;
      seen.add(e);
      return false;
    }
    return e.slice(1).some((x) => typeof x !== 'number' && walk(x));
  };
  return walk(ue);
}

/**
 * Structurally cancel repeated unit factors in a compound unit expression
 * (e.g. `in/in` → dimensionless, `m·s/in` → `s` after converting `in` to `m`),
 * and collect equal factors into a power (`m·m` → `m^2`, `m^2·m` → `m^3`).
 *
 * Returns `null` when the unit cannot be flattened/cancelled, or when nothing
 * changed — in which case the caller should keep the original boxed unit, as
 * the user wrote it, to avoid churn.  Nothing changed when the unit magnitude
 * scale is 1, the factor map is the same as before, and no unit symbol occurs
 * more than once in the original unit.  The last test is necessary because
 * `m·m` and `m^2` have the same factor map, but only `m^2` has each unit once.
 * The factor maps are compared, not the rebuilt unit: the rebuilt unit is
 * always a quotient of positive powers, so `(m/s)^2` or `kg·m·s^-2` would
 * otherwise be rewritten although nothing cancelled or collected.
 *
 * Otherwise returns the magnitude scale to apply, the rebuilt
 * `UnitExpression` (`null` rebuilt = fully cancelled → dimensionless), and
 * the factor map of the rebuilt unit (unit symbol → exponent).
 */
function cancelCompoundUnit(ue: UnitExpression): {
  magnitudeScale: number;
  rebuilt: UnitExpression | null;
  factors: Map<string, number>;
} | null {
  const flat = flattenUnitFactors(ue);
  if (!flat) return null;
  const cancelled = cancelUnitFactors(flat);
  if (!cancelled) return null;
  const rebuilt = unitExpressionFromFactors(cancelled.factors);
  if (
    cancelled.magnitudeScale === 1 &&
    factorMapsEqual(cancelled.factors, flat) &&
    !hasRepeatedUnitSymbol(ue)
  )
    return null;
  return {
    magnitudeScale: cancelled.magnitudeScale,
    rebuilt,
    factors: cancelled.factors,
  };
}

/**
 * Combine the compound unit of a product or a quotient of quantities. Unit
 * factors with the same dimension cancel (`km/m` → `1000`, `m·s/in`), and a
 * dimensionless unit gives a plain number. The other units are kept in the
 * canonical unit form (see `canonicalUnit()`): a unit is not renamed, so
 * `Multiply(N, m)` stays `N·m` and does not become `J`. Only `UnitSimplify`
 * replaces a compound unit with a named derived unit.
 *
 * `mag` is the result of machine-number arithmetic with a float operand, so
 * the magnitude is boxed as a float, also when its value is an integer.
 */
function simplifyQuantityUnit(
  ce: ComputeEngine,
  mag: number,
  unit: Expression
): Expression {
  const float = (x: number) => asFloat(ce.number(x));
  let ue = boxedToUnitExpression(unit);

  // First, structurally cancel any repeated unit factors that share a
  // dimension (e.g. in/in, m·s/in), so that a fully-cancelled unit collapses
  // to a scalar.
  if (ue) {
    const cancelled = cancelCompoundUnit(ue);
    // The cancellation adds the exponents as machine numbers, and a sum can
    // round to zero although the exact sum is not zero (see
    // `unitExactlyCancels()`). Then the unit did not cancel: it is kept, and
    // the dimension test below, which also uses machine numbers, is skipped.
    if (
      cancelled &&
      cancelled.rebuilt === null &&
      !unitExactlyCancels(ce, unit)
    )
      return ce._fn('Quantity', [float(mag), canonicalUnit(ce, unit)]);
    if (cancelled) {
      mag = mag * cancelled.magnitudeScale;
      if (cancelled.rebuilt === null) return float(mag);
      // A unit name is not a variable: box the rebuilt unit resolve-only, so
      // that a unit name with no definition is not declared in the current
      // scope. The rebuilt unit has exact exponents when the exponents of
      // `unit` are exact: `m^(2/3)·m^(2/3)` is `m^(4/3)`, not
      // `m^1.3333333333333333` (see `canonicalUnitFromFactorMap()`).
      unit =
        canonicalUnitFromFactorMap(ce, cancelled.factors, unit) ??
        ce._resolveOnly(() => ce.expr(cancelled.rebuilt as any));
      ue = boxedToUnitExpression(unit);
    }
  }

  if (ue) {
    const dim = getExpressionDimension(ue);
    if (dim) {
      // Dimensionless result (all exponents zero) → plain scalar
      if (isDimensionless(dim)) {
        const scale = getExpressionScale(ue);
        if (scale !== null) return float(mag * scale);
      }
    }
  }
  return ce._fn('Quantity', [float(mag), canonicalUnit(ce, unit)]);
}

/**
 * Measurement-magnitude counterpart of `simplifyQuantityUnit`: the magnitude is
 * a boxed expression (typically a `Measurement`) rather than a raw number, so a
 * unit scale factor is applied with error-propagating multiplication.
 */
function simplifyQuantityUnitMeasurement(
  ce: ComputeEngine,
  mag: Expression,
  unit: Expression
): Expression {
  let ue = boxedToUnitExpression(unit);

  // Structurally cancel repeated unit factors (see `simplifyQuantityUnit`).
  // The magnitude is a boxed (possibly Measurement) value, so the scale is
  // applied with error-propagating multiplication.
  if (ue) {
    const cancelled = cancelCompoundUnit(ue);
    // A unit whose exponents cancel only as machine numbers is kept (see
    // `simplifyQuantityUnit`).
    if (
      cancelled &&
      cancelled.rebuilt === null &&
      !unitExactlyCancels(ce, unit)
    )
      return ce._fn('Quantity', [mag, canonicalUnit(ce, unit)]);
    if (cancelled) {
      mag = scaleMagnitude(ce, mag, cancelled.magnitudeScale);
      if (cancelled.rebuilt === null) return mag;
      // Resolve-only, as in `simplifyQuantityUnit`: a unit name is not a
      // variable.
      unit =
        canonicalUnitFromFactorMap(ce, cancelled.factors, unit) ??
        ce._resolveOnly(() => ce.expr(cancelled.rebuilt as any));
      ue = boxedToUnitExpression(unit);
    }
  }

  if (ue) {
    const dim = getExpressionDimension(ue);
    if (dim) {
      // Dimensionless result (all exponents zero) → plain (unitless) magnitude
      if (isDimensionless(dim)) {
        const scale = getExpressionScale(ue);
        if (scale !== null) return scaleMagnitude(ce, mag, scale);
      }
    }
  }
  return ce._fn('Quantity', [mag, canonicalUnit(ce, unit)]);
}

/** Scale a (possibly `Measurement`) magnitude by a plain factor. */
function scaleMagnitude(
  ce: ComputeEngine,
  mag: Expression,
  scale: number
): Expression {
  if (scale === 1) return mag;
  return affineMagnitude(ce, mag, scale, 0);
}

/**
 * Raise a Quantity to a power.
 */
export function quantityPower(
  ce: ComputeEngine,
  base: Expression,
  exp: Expression
): Expression | undefined {
  if (!isQuantity(base)) return undefined;
  // A symbolic or exact magnitude is raised with the expression arithmetic of
  // the `Measurement` branch, with no error: `Quantity(3, m)^-1` is
  // `Quantity(1/3, m^-1)` and `Quantity(2, m)^(1/2)` is `Quantity(√2, m^(1/2))`
  // (see `usesExpressionArithmetic()`). The exponent is read with it: a
  // float exponent makes the power a float.
  const magIsMeasurement = usesExpressionArithmetic([base.op1, exp]);
  const mag = base.op1.re;
  const n = exp.re;
  // A unit exponent must be a number: `Quantity(3, m)^n` stays unevaluated.
  if (n === undefined || isSymbolicValue(exp)) return undefined;
  if (!magIsMeasurement && mag === undefined) return undefined;

  // Simplify unit exponents: Power(Power(u, a), b) → Power(u, a*b). A root
  // is a power too: the canonical form of `m^(1/2)` is `Sqrt(m)`, and of
  // `m^(1/3)` is `Root(m, 3)`. The product of the exponents is exact for
  // exact exponents: `(m^(1/3))^2` is `m^(2/3)`, not `m^0.6666666666666666`.
  const unit = base.op2;
  let innerBase: Expression | undefined;
  let innerExp: Expression | undefined;
  if (isFunction(unit, 'Power') && isNumber(unit.op2)) {
    innerBase = unit.op1;
    innerExp = unit.op2;
  } else if (isFunction(unit, 'Sqrt')) {
    innerBase = unit.op1;
    innerExp = ce.number([1, 2]);
  } else if (isFunction(unit, 'Root') && isNumber(unit.op2)) {
    innerBase = unit.op1;
    innerExp = ce.function('Divide', [ce.One, unit.op2]).evaluate();
  }
  let resultUnit: Expression;
  if (innerBase && innerExp) {
    const combined = ce.function('Multiply', [innerExp, exp]).evaluate();
    resultUnit = combined.isSame(1)
      ? innerBase
      : ce._fn('Power', [innerBase, combined]);
  } else if (isFunction(unit, 'Power')) {
    resultUnit = ce._fn('Power', [unit, exp]);
  } else {
    resultUnit = n === 1 ? unit : ce._fn('Power', [unit, exp]);
  }
  // The unit takes its canonical form: `(m^(1/2))^-1` is `1/Sqrt(m)`, the
  // tree that the parser gives for `1/m^{1/2}` (see `canonicalUnit()`).
  resultUnit = canonicalUnit(ce, resultUnit);

  if (magIsMeasurement) {
    const poweredMag = measurementPower(ce, base.op1, exp);
    if (poweredMag === undefined) return undefined;
    return ce._fn('Quantity', [poweredMag, resultUnit]);
  }

  return ce._fn('Quantity', [
    asFloat(ce.number(Math.pow(mag!, n))),
    resultUnit,
  ]);
}
