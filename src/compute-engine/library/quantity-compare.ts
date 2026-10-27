import type { Expression } from '../global-types.js';
import {
  exactCompareNumbers,
  isExactRealLiteral,
} from '../boxed-expression/constraint-subject.js';
import {
  isAbsentSymbol,
  isCharacter,
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  exactConstantOrder,
  isExactConstantExpression,
} from '../boxed-expression/compare.js';
import { isMeasurement } from './measurement-arithmetic.js';
import { type DecodedUnit, decodedUnit, describeUnit } from './units.js';
import {
  type DimensionVector,
  type UnitExpression,
  convertCompoundUnit,
  decimalFraction,
  dimensionsEqual,
  isDimensionless,
  exactUnitConversion,
} from './unit-data.js';

/** How `compareQuantities()` compares two quantities. */
export type QuantityCompareOptions = {
  /** Two values that differ by this amount or less, expressed in the finer
   * of the two units, are a tie. `0` separates any two different values. */
  tolerance: number;
  /** When `true`, two quantities with EXACT magnitudes are compared exactly,
   * with no tolerance, as two exact numbers are compared by `isEqual()`,
   * `isLess()` and the relational operators. When `false` (`is()`), the
   * tolerance applies to them too. A float magnitude is always compared
   * within the tolerance. */
  exact: boolean;
  /** When `true`, a `Measurement` magnitude is compared through its nominal
   * value. When `false`, a `Measurement` magnitude makes the result
   * `undefined`. */
  nominal: boolean;
};

/**
 * The order of the two quantities `a` and `b` by their physical value:
 * `-1` when `a < b`, `0` when they are equal, `1` when `a > b`.
 *
 * One of `a` and `b` can be a number (a number literal, or an exact
 * constant expression such as `π/6`) when the other is a quantity whose unit
 * is dimensionless and not logarithmic: the number is a value with a unit
 * of scale 1 (`quantityOperands()`). So `6 percent` and `0.06` are equal,
 * `180 deg` and `π` are equal, and `6 percent` is less than `0.07`.
 *
 * Returns `undefined` when `a` or `b` is not a `Quantity` (except for the
 * number above), when the two units have different dimensions (`6 W` and
 * `6 m`: they are not equal, see
 * `quantityDimensionsDiffer()`, but they have no order), when a unit is not
 * known, when a magnitude has no real value (a symbol with no value, a
 * complex number, also `1 + 10⁻⁸⁰⁰i`), or when the order cannot be decided.
 *
 * The magnitude of the quantity with the coarser unit is converted to the
 * finer unit (the unit with the smaller scale), and the two numbers are
 * compared there within `tolerance`. So two quantities with the same unit
 * compare as their magnitudes do (`6 W` and `7 W` as `6` and `7`), and the
 * tolerance never hides a difference of one finer unit or more: `1 eV` and
 * `2 eV` are different, also if their difference in joules is `1.6e-19`. The
 * order does not depend on which operand comes first. The conversion applies
 * the offset of a temperature unit (`0 degC` is `273.15 K`).
 *
 * Two EXACT magnitudes (exact number literals, or exact constant
 * expressions such as `π` or `√(10⁶⁰ + 10⁴⁰) − 10³⁰`) are compared first
 * with exact arithmetic, when the unit conversion is exact
 * (`exactUnitConversion()`). Their machine numbers are not used for this:
 * the double of `10⁴⁰⁰` is `Infinity`, and the double of
 * `√(10⁶⁰ + 10⁴⁰) − 10³⁰` loses all its digits by cancellation. With
 * `exact`, the exact order is the answer: `1000 m` and `1 km` are equal,
 * `1 m` and `(1 + 10⁻¹⁶) m` are not.
 *
 * Otherwise the machine numbers decide, within `tolerance`, unless they
 * cannot: a value that is too large for a double, or two converted values
 * whose difference is not larger than the rounding of the conversion. Such
 * a pair is compared with the full representation of the magnitudes (a big
 * decimal number, an exact number), and the result is `undefined` when this
 * is not possible either.
 *
 * This function is the one comparison of quantities for every route: the
 * `compare` hook and the `eq` handler of the quantity kind
 * (`QUANTITY_ARITHMETIC` and `quantityEq()`, `quantity-kind.ts`) call it,
 * and the comparison operators, `Max`, `Min`, `Sort`, `Clamp`, the methods
 * `isEqual()`, `isLess()`, … and `is()` reach those through the dispatch of
 * the kinds (`boxed-expression/kind-compare.ts`).
 */
export function compareQuantities(
  a: Expression,
  b: Expression,
  options: QuantityCompareOptions
): -1 | 0 | 1 | undefined {
  const operands = quantityOperands(a, b);
  if (operands === undefined) return undefined;
  const [aMagnitude, aUnit, bMagnitude, bUnit] = operands;
  const aUE = aUnit.unit!;
  const bUE = bUnit.unit!;

  const aDim = aUnit.dimension;
  const bDim = bUnit.dimension;
  if (!aDim || !bDim || !dimensionsEqual(aDim, bDim)) return undefined;

  // The scale of a logarithmic unit (`dB`, `Np`) in the unit table is
  // nominal: `1 Np` is not `1 dB`. Two quantities with different units of
  // which one is logarithmic have no known order.
  if (
    aUnit.key !== bUnit.key &&
    (hasLogarithmicUnit(aUE) || hasLogarithmicUnit(bUE))
  )
    return undefined;

  // A measured magnitude is compared by its nominal value, the first
  // operand of the `Measurement`, as the order of the measurement kind
  // compares a measurement (`MEASUREMENT_ARITHMETIC`,
  // `measurement-arithmetic.ts`).
  let aMag = aMagnitude;
  let bMag = bMagnitude;
  if (isMeasurement(aMag) || isMeasurement(bMag)) {
    if (!options.nominal) return undefined;
    if (isMeasurement(aMag)) aMag = aMag.op1;
    if (isMeasurement(bMag)) bMag = bMag.op1;
  }

  if (!isRealMagnitude(aMag) || !isRealMagnitude(bMag)) return undefined;

  // The scales of all the units are positive, so an infinite magnitude is
  // an infinite value of the same sign, whatever the unit. The test is on
  // the expression: the double of a finite value can also be `Infinity`
  // (`10⁴⁰⁰`).
  const aInfinity = aMag.isInfinity === true;
  const bInfinity = bMag.isInfinity === true;
  if (aInfinity || bInfinity) {
    const sa = aInfinity ? Math.sign(aMag.re) : 0;
    const sb = bInfinity ? Math.sign(bMag.re) : 0;
    if (Number.isNaN(sa) || Number.isNaN(sb)) return undefined;
    return sa === sb ? 0 : sa < sb ? -1 : 1;
  }

  const aScale = aUnit.scale;
  const bScale = bUnit.scale;
  if (aScale === null || bScale === null) return undefined;
  // Convert to the finer unit: the unit of `a` when it is the finer one.
  const toUnitOfA = aScale < bScale;

  if (isExactMagnitude(aMag) && isExactMagnitude(bMag)) {
    const order = orderByConversion(
      aMag,
      aUE,
      bMag,
      bUE,
      toUnitOfA,
      options.exact ? 0 : options.tolerance
    );
    if (order !== undefined) return order;
  }

  // `d` is `a − b`, in the finer of the two units.
  const x = numericValue(aMag);
  const y = numericValue(bMag);
  if (Number.isNaN(x) || Number.isNaN(y)) return undefined;
  let d = NaN;
  let largest = NaN;
  if (toUnitOfA) {
    const y1 = convertCompoundUnit(y, bUE, aUE);
    if (y1 !== null) {
      d = x - y1;
      largest = Math.max(Math.abs(x), Math.abs(y1));
    }
  } else {
    const x1 = convertCompoundUnit(x, aUE, bUE);
    if (x1 !== null) {
      d = x1 - y;
      largest = Math.max(Math.abs(x1), Math.abs(y));
    }
  }

  // The doubles do not decide the order when a value is too large for a
  // double, or when the difference is not larger than the rounding of the
  // conversion (`0.3 m` in `dm` is `2.9999999999999996`, not `3`). The
  // full representation of the magnitudes decides then: a big decimal
  // number keeps its digits beyond those of its double.
  if (!Number.isFinite(d) || Math.abs(d) <= 2 ** -44 * largest) {
    const order = orderByConversion(
      aMag,
      aUE,
      bMag,
      bUE,
      toUnitOfA,
      options.tolerance
    );
    if (order !== undefined) return order;
    if (!Number.isFinite(d)) return undefined;
  }
  if (Math.abs(d) <= options.tolerance) return 0;
  return d < 0 ? -1 : 1;
}

/**
 * True when `a` and `b` are two different values because they have
 * different physical dimensions:
 * - two quantities whose units have known dimensions that are not the same:
 *   `6 W` and `6 m`, also `0 m` and `0 s` and `x m` and `6 s`. The dimension
 *   is part of the value, so the magnitudes do not change the answer;
 * - a quantity whose unit has a known dimension that is not
 *   dimensionless, and a number (a number literal, or an exact constant
 *   expression such as `π`): `6 m` and `6`. A number is dimensionless;
 * - a quantity whose unit has a known dimension, also dimensionless, and
 *   a string, a character or a boolean: `6 m` and `"a"`, `6 percent` and
 *   `True`. Two values of different kinds are different, as a number and a
 *   string are, and a number and a boolean are.
 *
 * So `Equal` is `False` and `NotEqual` is `True` for such a pair. Their
 * order has no meaning, and `compareQuantities()` gives `undefined` for it.
 *
 * False when the dimension of a unit is not known (a symbol that is not in
 * the unit table), when a dimensionless quantity is compared with a number
 * (`6 percent` and `0.06`, `30 deg` and `1`: `compareQuantities()` compares
 * them by their values), and when the magnitude is an absent value,
 * `Missing` or `Undefined` (an absent value is not known to be different).
 */
export function quantityDimensionsDiffer(
  a: Expression,
  b: Expression
): boolean {
  const aQuantity = isQuantity(a);
  const bQuantity = isQuantity(b);
  if (!aQuantity && !bQuantity) return false;
  const aDim = aQuantity ? quantityDimension(a) : undefined;
  const bDim = bQuantity ? quantityDimension(b) : undefined;
  if (aDim === null || bDim === null) return false;
  if (aDim !== undefined && bDim !== undefined)
    return !dimensionsEqual(aDim, bDim);
  // One quantity and one other value
  const [dim, other] = aDim !== undefined ? [aDim, b] : [bDim!, a];
  // A string, a character or a boolean is never equal to a quantity,
  // whatever its dimension. A boolean is tested by name.
  if (
    isString(other) ||
    isCharacter(other) ||
    isSymbol(other, 'True') ||
    isSymbol(other, 'False')
  )
    return true;
  if (isDimensionless(dim)) return false;
  // `isExactConstantExpression()` also accepts a constant symbol that is not
  // a number (`True`), so its type is tested too.
  return (
    isNumber(other) ||
    (isExactConstantExpression(other) && other.type.matches('number'))
  );
}

/**
 * The unit of a dimensionless value that is not a quantity (a number): the
 * radian. Its scale is exactly 1, with no power of π, and it is the
 * coherent SI unit of a dimensionless value. So `6 percent` compared with
 * the number `0.06` is `6 percent` compared with `0.06 rad`, and
 * `180 deg` compared with `π` is `180 deg` compared with `π rad`.
 */
const SCALE_ONE_UNIT: DecodedUnit = describeUnit('rad');

/** The units of the unit table whose scale is nominal: a quantity with
 * such a unit is not compared with a number, nor with a quantity that has
 * another unit. */
const LOGARITHMIC_UNITS = new Set(['dB', 'Np']);

/** True when the unit expression `unit` has a logarithmic unit
 * (`LOGARITHMIC_UNITS`) in it, at any depth. */
export function hasLogarithmicUnit(unit: UnitExpression): boolean {
  if (typeof unit === 'string') return LOGARITHMIC_UNITS.has(unit);
  return unit.some(
    (part, i) =>
      i > 0 &&
      (typeof part === 'string' || Array.isArray(part)) &&
      hasLogarithmicUnit(part as UnitExpression)
  );
}

/**
 * The magnitudes and the decoded units of the two operands of
 * `compareQuantities()`: `[aMagnitude, aUnit, bMagnitude, bUnit]`, or
 * `undefined` when the two operands are not comparable as quantities. The
 * `unit` field of each decoded unit is not `null`.
 *
 * - Two quantities give their magnitudes and their units.
 * - A quantity whose unit is dimensionless and not logarithmic (`percent`,
 *   `deg`, `rad`), and a number (a number literal, or an exact constant
 *   expression with a number type such as `π` or `π/6`): the number is a
 *   value with the unit `SCALE_ONE_UNIT`, whose scale is 1. So
 *   `6 percent` and `0.06` are equal, and `180 deg` and `π` are equal.
 *
 * A unit that the unit table does not know gives `undefined`.
 */
function quantityOperands(
  a: Expression,
  b: Expression
): [Expression, DecodedUnit, Expression, DecodedUnit] | undefined {
  const aQuantity = isQuantity(a);
  const bQuantity = isQuantity(b);
  if (aQuantity && bQuantity) {
    const aUnit = decodedUnit(a.op2);
    const bUnit = decodedUnit(b.op2);
    if (!aUnit.unit || !bUnit.unit) return undefined;
    return [a.op1, aUnit, b.op1, bUnit];
  }
  if (aQuantity === bQuantity) return undefined;
  const [q, other] = aQuantity ? [a, b] : [b, a];
  if (!isFunction(q, 'Quantity')) return undefined;
  if (
    !isNumber(other) &&
    !(isExactConstantExpression(other) && other.type.matches('number'))
  )
    return undefined;
  const unit = decodedUnit(q.op2);
  if (!unit.unit || hasLogarithmicUnit(unit.unit)) return undefined;
  const dim = unit.dimension;
  if (!dim || !isDimensionless(dim)) return undefined;
  return aQuantity
    ? [q.op1, unit, other, SCALE_ONE_UNIT]
    : [other, SCALE_ONE_UNIT, q.op1, unit];
}

/** True when `x` is a call of the head `Quantity`, with its two operands. */
function isQuantity(
  x: Expression
): x is Expression & { readonly op1: Expression; readonly op2: Expression } {
  return isFunction(x, 'Quantity');
}

/** The dimension of the unit of the quantity `q`, or `null` when it is not
 * known or when the magnitude of `q` is absent (`Missing` or `Undefined`,
 * `isAbsentSymbol()`). */
function quantityDimension(q: Expression): DimensionVector | null {
  if (!isQuantity(q) || isAbsentSymbol(q.op1)) return null;
  return decodedUnit(q.op2).dimension;
}

/** True when `x` is an exact number literal or an exact constant
 * expression (`π`, `√2 + 1`): a value with no rounding. */
function isExactMagnitude(x: Expression): boolean {
  return isExactRealLiteral(x) || isExactConstantExpression(x);
}

/**
 * True when the magnitude `x` can be a real value. A number literal is
 * tested on its full representation (`isComplex`), not on the double of its
 * imaginary part: the double of `10⁻⁸⁰⁰` is `0`. An exact constant
 * expression is tested on its numeric value in the same way. Another
 * expression must have a real double value.
 */
function isRealMagnitude(x: Expression): boolean {
  if (isNumber(x)) return !x.isComplex && !x.isNaN;
  if (isExactConstantExpression(x)) {
    const n = x.N();
    return isNumber(n) && !n.isComplex && !n.isNaN;
  }
  return !Number.isNaN(x.re) && x.im === 0;
}

/**
 * The value of the magnitude `x` as a machine number: `NaN` when `x` has
 * no numeric value (a symbol with no value).
 *
 * `.re` is `NaN` for an exact constant expression (`π`, `1000π`), which has a
 * numeric value: its numeric approximation gives it.
 */
function numericValue(x: Expression): number {
  if (Number.isNaN(x.re) && isExactConstantExpression(x)) return x.N().re;
  return x.re;
}

/**
 * The order of the quantities `aMag aUnit` and `bMag bUnit` with the full
 * representation of the magnitudes, when the conversion between the two
 * units is known exactly (`exactUnitConversion()`). Otherwise `undefined`.
 *
 * The magnitude in the coarser unit is converted to the finer unit (the
 * unit of `a` when `toUnitOfA`), with exact arithmetic. The factor of the
 * conversion is positive, so the order of the converted values is the order
 * of the quantities. Two values within `tolerance` of each other are a tie
 * (see `orderWithin()`).
 */
function orderByConversion(
  aMag: Expression,
  aUnit: UnitExpression,
  bMag: Expression,
  bUnit: UnitExpression,
  toUnitOfA: boolean,
  tolerance: number
): -1 | 0 | 1 | undefined {
  const [from, fromUnit, to, toUnit] = toUnitOfA
    ? [bMag, bUnit, aMag, aUnit]
    : [aMag, aUnit, bMag, bUnit];
  const map = exactUnitConversion(fromUnit, toUnit);
  if (map === null) return undefined;
  const ce = aMag.engine;
  let converted = from;
  if (
    map.factor[0] !== map.factor[1] ||
    map.piPower !== 0 ||
    map.offset[0] !== 0n
  ) {
    // The canonical forms of `Multiply` and `Add` fold exact number
    // literals, and keep an exact constant expression exact. A float is not
    // folded at canonicalization: the evaluation computes it. The factor of
    // a conversion between two angle units can have a power of π (`rad` to
    // `deg` is `180·π⁻¹`): the converted value of an exact magnitude is
    // then an exact constant expression (`180·π⁻¹·π` is `180`), which
    // `orderWithin()` compares with enclosures at a raised precision.
    const factor =
      map.piPower === 0
        ? [ce.number(map.factor)]
        : [
            ce.number(map.factor),
            ce.function('Power', [ce.Pi, ce.number(map.piPower)]),
          ];
    converted = ce.function('Add', [
      ce.function('Multiply', [...factor, from]),
      ce.number(map.offset),
    ]);
    if (!isExactMagnitude(converted)) converted = converted.evaluate();
  }
  const order = orderWithin(converted, to, tolerance);
  if (order === undefined || order === 0) return order;
  return toUnitOfA ? (-order as -1 | 1) : order;
}

/**
 * The order of the two real values `u` and `v`, with no rounding: two number
 * literals by their values (`exactCompareNumbers()`, an exact number or the
 * full representation of a float), two exact values of which one is an
 * exact constant expression by enclosures at a raised precision
 * (`exactConstantOrder()`). Two values within `tolerance` of each other are
 * a tie: `v − tolerance ≤ u ≤ v + tolerance`, with `tolerance` read as the
 * exact decimal number it stands for.
 */
function orderWithin(
  u: Expression,
  v: Expression,
  tolerance: number
): -1 | 0 | 1 | undefined {
  const order = orderOf(u, v);
  if (order === undefined || order === 0 || tolerance === 0) return order;
  const t = decimalFraction(tolerance);
  if (t === null) return undefined;
  const ce = u.engine;
  let bound = ce.function('Add', [v, ce.number(order > 0 ? t : [-t[0], t[1]])]);
  if (!isExactMagnitude(bound)) bound = bound.evaluate();
  const toBound = orderOf(u, bound);
  if (toBound === undefined) return undefined;
  const within = order > 0 ? toBound <= 0 : toBound >= 0;
  return within ? 0 : order;
}

/** See `orderWithin()`. */
function orderOf(u: Expression, v: Expression): -1 | 0 | 1 | undefined {
  if (isNumber(u) && isNumber(v)) return exactCompareNumbers(u, v);
  if (isExactMagnitude(u) && isExactMagnitude(v))
    return exactConstantOrder(u, v);
  return undefined;
}
