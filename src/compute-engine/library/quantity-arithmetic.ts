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
} from '../global-types';
import { isFunction, isSymbol } from '../boxed-expression/type-guards';
import { boxedToUnitExpression } from './units';
import {
  convertUnit,
  convertCompoundUnit,
  dimensionsEqual,
  isDimensionless,
  getExpressionScale,
  getExpressionDimension,
  findNamedUnit,
} from './unit-data';
import {
  isMeasurement,
  measurementAdd,
  measurementMultiply,
  measurementDivide,
  measurementPower,
  measurementAffine,
} from './measurement-arithmetic';

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
 */
function convertMagnitude(
  ce: ComputeEngine,
  mag: Expression,
  opSymbol: string | null,
  opUE: ReturnType<typeof boxedToUnitExpression>,
  targetSymbol: string | null,
  targetUE: ReturnType<typeof boxedToUnitExpression>
): Expression | undefined {
  if (targetSymbol && opSymbol) {
    if (opSymbol === targetSymbol) return mag;
    const c0 = convertUnit(0, opSymbol, targetSymbol);
    const c1 = convertUnit(1, opSymbol, targetSymbol);
    if (c0 === null || c1 === null) return undefined;
    return measurementAffine(ce, mag, c1 - c0, c0);
  }
  if (!opUE || !targetUE) return undefined;
  const c0 = convertCompoundUnit(0, opUE, targetUE);
  const c1 = convertCompoundUnit(1, opUE, targetUE);
  if (c0 === null || c1 === null) return undefined;
  return measurementAffine(ce, mag, c1 - c0, c0);
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
  // addition instead of raw numeric summation.
  if (quantities.some((q) => isMeasurement(q.op1))) {
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
    const combined = measurementAdd(ce, mags);
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

  return ce._fn('Quantity', [ce.number(total), bestQ.op2]);
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
  // error-propagating multiplication instead of raw numeric products.
  if (
    ops.some((x) => isMeasurement(x)) ||
    quantities.some((q) => isMeasurement(q.op1))
  ) {
    const factors: Expression[] = [...scalars, ...quantities.map((q) => q.op1)];
    const combinedMag = measurementMultiply(ce, factors);
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
    return ce._fn('Quantity', [ce.number(scalarValue * mag), q.op2]);
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
  const numMagIsM =
    isMeasurement(num) || (numQ ? isMeasurement(numQ.op1) : false);
  const denMagIsM =
    isMeasurement(den) || (denQ ? isMeasurement(denQ.op1) : false);
  if (numMagIsM || denMagIsM) {
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
          return ce.number((numMag * numScale) / (denMag * denScale));
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
    return ce._fn('Quantity', [ce.number(mag / scalar), numQ.op2]);
  }

  if (!numQ && denQ) {
    // scalar / Quantity => Quantity with inverted unit
    const scalar = num.re;
    const mag = denQ.op1.re;
    if (scalar === undefined || mag === undefined || mag === 0)
      return undefined;
    const invertedUnit = ce._fn('Power', [denQ.op2, ce.number(-1)]);
    return ce._fn('Quantity', [ce.number(scalar / mag), invertedUnit]);
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
          const ratio = measurementDivide(ce, numMag, denMag);
          if (ratio === undefined) return undefined;
          return scaleMagnitude(ce, ratio, numScale / denScale);
        }
      }
    }

    const resultMag = measurementDivide(ce, numMag, denMag);
    if (resultMag === undefined) return undefined;
    const resultUnit = ce._fn('Divide', [numQ.op2, denQ.op2]);
    return simplifyQuantityUnitMeasurement(ce, resultMag, resultUnit);
  }

  if (numQ && !denQ) {
    // Quantity / scalar
    const resultMag = measurementDivide(ce, numQ.op1, den);
    if (resultMag === undefined) return undefined;
    return ce._fn('Quantity', [resultMag, numQ.op2]);
  }

  if (!numQ && denQ) {
    // scalar / Quantity => Quantity with inverted unit
    const resultMag = measurementDivide(ce, num, denQ.op1);
    if (resultMag === undefined) return undefined;
    const invertedUnit = ce._fn('Power', [denQ.op2, ce.number(-1)]);
    return ce._fn('Quantity', [resultMag, invertedUnit]);
  }

  return undefined;
}

/**
 * Try to simplify a compound unit to a named derived unit.
 * E.g. Multiply(N, m) → J, Divide(kg, Multiply(m, Power(s, 2))) → Pa.
 * If no simplification is found, returns the Quantity as-is.
 */
function simplifyQuantityUnit(
  ce: ComputeEngine,
  mag: number,
  unit: Expression
): Expression {
  const ue = boxedToUnitExpression(unit);
  if (ue) {
    const dim = getExpressionDimension(ue);
    if (dim) {
      // Dimensionless result (all exponents zero) → plain scalar
      if (isDimensionless(dim)) {
        const scale = getExpressionScale(ue);
        if (scale !== null) return ce.number(mag * scale);
      }
      const match = findNamedUnit(dim);
      if (match) {
        // findNamedUnit only returns scale=1 units, so just multiply mag by
        // the compound unit's scale to get the magnitude in the named unit.
        const scale = getExpressionScale(ue);
        if (scale !== null)
          return ce._fn('Quantity', [ce.number(mag * scale), ce.symbol(match)]);
      }
    }
  }
  return ce._fn('Quantity', [ce.number(mag), unit]);
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
  const ue = boxedToUnitExpression(unit);
  if (ue) {
    const dim = getExpressionDimension(ue);
    if (dim) {
      // Dimensionless result (all exponents zero) → plain (unitless) magnitude
      if (isDimensionless(dim)) {
        const scale = getExpressionScale(ue);
        if (scale !== null) return scaleMagnitude(ce, mag, scale);
      }
      const match = findNamedUnit(dim);
      if (match) {
        const scale = getExpressionScale(ue);
        if (scale !== null)
          return ce._fn('Quantity', [
            scaleMagnitude(ce, mag, scale),
            ce.symbol(match),
          ]);
      }
    }
  }
  return ce._fn('Quantity', [mag, unit]);
}

/** Scale a (possibly `Measurement`) magnitude by a plain factor. */
function scaleMagnitude(
  ce: ComputeEngine,
  mag: Expression,
  scale: number
): Expression {
  if (scale === 1) return mag;
  return measurementAffine(ce, mag, scale, 0);
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
  const magIsMeasurement = isMeasurement(base.op1);
  const mag = base.op1.re;
  const n = exp.re;
  if (n === undefined) return undefined;
  if (!magIsMeasurement && mag === undefined) return undefined;

  // Simplify unit exponents: Power(Power(u, a), b) → Power(u, a*b)
  const unit = base.op2;
  let resultUnit: Expression;
  if (isFunction(unit, 'Power')) {
    const innerExp = unit.op2?.re;
    if (innerExp !== undefined) {
      const combined = innerExp * n;
      resultUnit =
        combined === 1
          ? unit.op1
          : ce._fn('Power', [unit.op1, ce.number(combined)]);
    } else {
      resultUnit = ce._fn('Power', [unit, exp]);
    }
  } else {
    resultUnit = n === 1 ? unit : ce._fn('Power', [unit, exp]);
  }

  if (magIsMeasurement) {
    const poweredMag = measurementPower(ce, base.op1, exp);
    if (poweredMag === undefined) return undefined;
    return ce._fn('Quantity', [poweredMag, resultUnit]);
  }

  return ce._fn('Quantity', [ce.number(Math.pow(mag!, n)), resultUnit]);
}
