import type { Expression } from '../global-types.js';
import {
  exactCompareNumbers,
  isExactRealLiteral,
} from '../boxed-expression/constraint-subject.js';
import { isNumber } from '../boxed-expression/type-guards.js';
import {
  exactConstantOrder,
  isExactConstantExpression,
} from '../boxed-expression/compare.js';
import { isMeasurement, measurementNominal } from './measurement-arithmetic.js';
import { isQuantity } from './quantity-arithmetic.js';
import { boxedToUnitExpression } from './units.js';
import {
  type UnitExpression,
  convertCompoundUnit,
  decimalFraction,
  dimensionsEqual,
  exactUnitConversion,
  getExpressionDimension,
  getExpressionScale,
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
 * Returns `undefined` when `a` or `b` is not a `Quantity`, when the two
 * units have different dimensions (`6 W` and `6 m`), when a unit is not
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
 * With a `tolerance` of 0 and `exact`, the order is exact, as `exactOrder()`
 * needs for `Max`, `Min`, `Clamp` and `Sort`.
 *
 * This function is the one comparison of quantities for every route: the
 * operators `Equal`, `NotEqual`, `Less`, `LessEqual` and `IdenticallyEqual`
 * (`library/relational-operator.ts`), the methods `isEqual()`,
 * `isIdenticallyEqual()`, `isLess()` and the other order predicates, `is()`
 * and `exactOrder()` (`boxed-expression/compare.ts` reaches it through a
 * lazy reference that `src/compute-engine/index.ts` sets).
 */
export function compareQuantities(
  a: Expression,
  b: Expression,
  options: QuantityCompareOptions
): -1 | 0 | 1 | undefined {
  if (!isQuantity(a) || !isQuantity(b)) return undefined;

  const aUE = boxedToUnitExpression(a.op2);
  const bUE = boxedToUnitExpression(b.op2);
  if (!aUE || !bUE) return undefined;

  const aDim = getExpressionDimension(aUE);
  const bDim = getExpressionDimension(bUE);
  if (!aDim || !bDim || !dimensionsEqual(aDim, bDim)) return undefined;

  let aMag = a.op1;
  let bMag = b.op1;
  if (isMeasurement(aMag) || isMeasurement(bMag)) {
    if (!options.nominal) return undefined;
    aMag = measurementNominal(aMag);
    bMag = measurementNominal(bMag);
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

  const aScale = getExpressionScale(aUE);
  const bScale = getExpressionScale(bUE);
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
  if (map.factor[0] !== map.factor[1] || map.offset[0] !== 0n) {
    // The canonical forms of `Multiply` and `Add` fold exact number
    // literals, and keep an exact constant expression exact. A float is not
    // folded at canonicalization: the evaluation computes it.
    converted = ce.function('Add', [
      ce.function('Multiply', [ce.number(map.factor), from]),
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
