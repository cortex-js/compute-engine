/**
 * The VALUE KIND of the head `Quantity` (`QUANTITY_ARITHMETIC`, the
 * `arithmetic` field of its definition, `QUANTITY_LIBRARY` below), and the
 * definition of the head itself.
 *
 * A `Quantity(magnitude, unit)` is a value of the kind type `quantity`: an
 * opaque type, disjoint from every numeric type, so that the number rules
 * (`x - x` is 0, `x/x` is 1) do not apply to it. It is admitted at the
 * arithmetic operators (through the hooks below) and at the operators that
 * name `quantity` in a parameter (the 24 trigonometric functions, `Abs`, and
 * the operators with a `value` parameter, such as `UnitConvert`), and it is
 * refused at every other operator (`admittedAs: 'none'`): `Floor(2 m)` is an
 * `incompatible-type` error. See `docs/plans/2026-10-26-value-kinds.md`,
 * sections 4.7 and 13.
 *
 * The arithmetic operators reach the hooks through the kind dispatch
 * (`boxed-expression/kind-dispatch.ts`), and the comparisons reach `compare`
 * and the `eq` handler of the definition (`quantityEq()`) through
 * `boxed-expression/kind-compare.ts`. The hooks call the helpers of
 * `quantity-arithmetic.ts` (sums, products, quotients and powers of
 * quantities, with the unit conversions) and `compareQuantities()` of
 * `quantity-compare.ts` (the order after conversion).
 *
 * This module is separate from `units.ts` because the helpers it calls
 * import `units.ts`: the definition of `Quantity` lives here so that
 * `units.ts` does not import them back.
 */

import type {
  ArithmeticDefinition,
  Expression,
  IComputeEngine as ComputeEngine,
  KindFold,
  KindOperand,
  KindOperands,
  SymbolDefinitions,
} from '../global-types.js';
import { runWithEvaluationEffects } from '../effects-registry.js';
import { awaitedOperandOptions } from '../boxed-expression/utils.js';
import {
  isFunction,
  isInexactOperand,
  isNumber,
  isString,
} from '../boxed-expression/type-guards.js';
import { holdsKindValue } from '../boxed-expression/residue-class.js';
import { isExactConstantExpression } from '../boxed-expression/compare.js';
import {
  type UnitExpression,
  dimensionsEqual,
  exactUnitConversion,
  getExpressionDimension,
  getExpressionScale,
  parseUnitDSL,
} from './unit-data.js';
import {
  boxedToUnitExpression,
  cancelledUnitValue,
  canonicalUnit,
} from './units.js';
import { isMeasurement } from './measurement-arithmetic.js';
import {
  isOffsetTemperatureUnit,
  isQuantity,
  type QuantityExpr,
  quantityAdd,
  quantityDivide,
  quantityMultiply,
  quantityNegate,
  quantityPower,
} from './quantity-arithmetic.js';
import {
  compareQuantities,
  quantityDimensionsDiffer,
  hasLogarithmicUnit,
} from './quantity-compare.js';

/**
 * The 24 trigonometric, hyperbolic and inverse functions. Each one names
 * `quantity` in its parameter: an angle (`Sin(30 deg)`) is folded to
 * radians at canonicalization, and any other quantity (`Sin(2 m)`) is
 * admitted and stays unevaluated. The result of each one is a number
 * (`quantityResultType()`).
 */
const QUANTITY_TRIGONOMETRIC_OPERATORS: ReadonlySet<string> = new Set([
  'Sin',
  'Cos',
  'Tan',
  'Cot',
  'Sec',
  'Csc',
  'Sinh',
  'Cosh',
  'Tanh',
  'Coth',
  'Sech',
  'Csch',
  'Arcsin',
  'Arccos',
  'Arctan',
  'Arccot',
  'Arcsec',
  'Arccsc',
  'Arsinh',
  'Arcosh',
  'Artanh',
  'Arcoth',
  'Arsech',
  'Arcsch',
]);

/** `x.N()` under the numeric approximation, else `x`. The hooks make their
 * own result numeric (`ArithmeticContext.numericApproximation`). */
function numericIf(
  x: Expression | undefined,
  numericApproximation: boolean
): Expression | undefined {
  return numericApproximation && x !== undefined ? x.N() : x;
}

/**
 * True when `q` is a quantity whose unit is a temperature with an offset
 * (`degC`, `degF`): its zero is not the zero of the kelvin scale.
 */
function isOffsetTemperature(q: Expression): boolean {
  return isQuantity(q) && isOffsetTemperatureUnit(boxedToUnitExpression(q.op2));
}

/**
 * The quantity that the operand `x` of a sum or a product stands for, and
 * whether it is negated: `x` itself, or the quantity `q` of `x = Negate(q)`.
 * A negated temperature with an offset can stay `Negate(q)` in a value that
 * a hook made (`negatedValue()`), since the sum of temperatures reads the
 * sign of each term (`kelvinSum()`, `quantity-arithmetic.ts`).
 * `undefined` when `x` is neither.
 */
function quantityTerm(
  x: Expression
): { quantity: QuantityExpr; negated: boolean } | undefined {
  if (isQuantity(x)) return { quantity: x, negated: false };
  if (isFunction(x, 'Negate') && isQuantity(x.op1))
    return { quantity: x.op1, negated: true };
  return undefined;
}

/**
 * The quantity that the term `x` of a sum stands for, and whether the term
 * is its negation, when `x` is a quantity, a negated term (`Negate(t)`), or
 * a quotient or a product of one such term by values that hold no kind
 * value; `undefined` otherwise.
 *
 * A negated temperature with an offset can stay `Negate(q)` in a value that
 * a hook made (`negatedValue()`), and a term that holds a kind value
 * without being one is read here too: the quantity it stands for, and
 * whether it is negated. The canonical form of `a - b/2` negates the
 * numerator of the quotient (`20 degC - (10 degC)/2` is
 * `Add(Divide(Negate(10 degC), 2), 20 degC)`); its evaluated term is the
 * quantity `-5 degC`, and the sign of the written term
 * (`isNegatedOperand()`, `quantity-arithmetic.ts`) says that it is the
 * negation of the temperature `5 degC`.
 */
function sumTerm(
  ce: ComputeEngine,
  x: Expression,
  depth = 0
): { quantity: QuantityExpr; negated: boolean } | undefined {
  if (isQuantity(x)) return { quantity: x, negated: false };
  if (depth > 8 || !isFunction(x)) return undefined;
  if (x.operator === 'Negate') {
    const t = sumTerm(ce, x.op1, depth + 1);
    return t === undefined ? undefined : { ...t, negated: !t.negated };
  }
  if (x.operator === 'Divide' && !holdsKindValue(x.op2)) {
    const t = sumTerm(ce, x.op1, depth + 1);
    if (t === undefined) return undefined;
    const q = quantityDivide(ce, t.quantity, x.op2);
    return q !== undefined && isQuantity(q)
      ? { quantity: q, negated: t.negated }
      : undefined;
  }
  if (x.operator === 'Multiply') {
    const i = x.ops.findIndex((op) => holdsKindValue(op));
    if (i < 0 || x.ops.some((op, j) => j !== i && holdsKindValue(op)))
      return undefined;
    const t = sumTerm(ce, x.ops[i], depth + 1);
    if (t === undefined) return undefined;
    const q = quantityMultiply(ce, [
      ...x.ops.filter((_, j) => j !== i),
      t.quantity,
    ]);
    return q !== undefined && isQuantity(q)
      ? { quantity: q, negated: t.negated }
      : undefined;
  }
  return undefined;
}

/**
 * The operands `xs` of a product or a quotient with each negated quantity
 * (`Negate(q)`, `quantityTerm()`) replaced by its quantity `q`, and whether
 * the number of the negations removed is odd.
 */
function withoutNegations(xs: ReadonlyArray<Expression>): {
  operands: Expression[];
  negated: boolean;
} {
  let negated = false;
  const operands = xs.map((x) => {
    const term = quantityTerm(x);
    if (term === undefined || !term.negated) return x;
    negated = !negated;
    return term.quantity;
  });
  return { operands, negated };
}

/**
 * The negation of `v`, the value of a product or a quotient of quantities:
 * a temperature with an offset stays `Negate(v)`, so that a sum of
 * temperatures reads the sign of the term (`quantityTerm()`):
 * `20 degC − (10 degC)/2` is `15 K`. Another quantity has its magnitude
 * negated (`quantityNegate()`), and a number (a dimensionless product) is
 * negated.
 */
function negatedValue(ce: ComputeEngine, v: Expression): Expression {
  if (!isQuantity(v)) return v.neg();
  if (isOffsetTemperature(v)) return ce._fn('Negate', [v]);
  return quantityNegate(ce, v) ?? ce._fn('Negate', [v]);
}

/**
 * A key for the physical dimension of the unit of the quantity `q`, or
 * `undefined` when the unit or its dimension is not known. Two quantities
 * with the same key have units of the same dimension (`m` and `cm`, `K` and
 * `degC`).
 */
function dimensionKey(q: Expression): string | undefined {
  if (!isQuantity(q)) return undefined;
  const ue = boxedToUnitExpression(q.op2);
  if (!ue) return undefined;
  const dimension = getExpressionDimension(ue);
  return dimension ? JSON.stringify(dimension) : undefined;
}

/**
 * The folds of the `add` hook: one fold for each group of two or more
 * quantities whose units have the same dimension, in the order of the
 * first quantity of each group. A negated temperature with an offset
 * (`Negate(5 degC)`, `sumTerm()`) is a term of its group. The other
 * operands are not folded: the
 * dispatch sums them as one sub-sum beside the quantities, so
 * `x + 2 m + 3 m` is `x + 5 m`, and `2 m + 3 m + 4 s + 5 s` is `5 m + 9 s`.
 *
 * The sum of a group is the sum of `quantityAdd()`: in the unit with the
 * largest scale (`2 m + 30 cm` is `2.3 m`), and in kelvin for a
 * temperature with an offset (`20 degC − 5 degC` is `15 K`). The operands
 * as written (`ops.written`) tell a difference from a sum for such a
 * temperature: `a − b` is canonically `Add(Negate(b), a)`.
 */
function quantityAddFolds(
  ce: ComputeEngine,
  ops: KindOperands,
  numericApproximation: boolean
): ReadonlyArray<KindFold> | undefined {
  const groups = new Map<string, number[]>();
  const terms = ops.evaluated.map((x) => sumTerm(ce, x));
  terms.forEach((term, i) => {
    const key = term === undefined ? undefined : dimensionKey(term.quantity);
    if (key === undefined) return;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [i]);
    else group.push(i);
  });
  const folds: KindFold[] = [];
  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    // A negated term is given to `quantityAdd()` as the quantity with its
    // magnitude negated, written `Negate(q)`, which tells it that the term
    // is negated (a temperature with an offset is negated in kelvin).
    const values: Expression[] = [];
    const written: (Expression | undefined)[] = [];
    for (const i of indices) {
      const term = terms[i]!;
      if (!term.negated) {
        values.push(term.quantity);
        written.push(ops.written[i]);
        continue;
      }
      const negated = quantityNegate(ce, term.quantity);
      if (negated === undefined) break;
      values.push(negated);
      written.push(ce._fn('Negate', [term.quantity]));
    }
    if (values.length !== indices.length) continue;
    const value = quantityAdd(ce, values, written);
    if (value === undefined) continue;
    folds.push({
      value: numericIf(value, numericApproximation)!,
      operands: indices,
    });
  }
  return folds;
}

/**
 * True when the `multiply` hook folds the operand `x` into the product of
 * the quantities: a quantity, a measurement (it becomes the magnitude, or a
 * factor of it: `Quantity(2, m) · Measurement(3, 0.1)` is
 * `Quantity(Measurement(6, 0.2), m)`), or an operand that holds no value
 * of a kind (a number, a constant, a symbol: `x · 3 m` is `3x m`).
 */
function isMultiplyOperand(x: Expression): boolean {
  return (
    quantityTerm(x) !== undefined || isMeasurement(x) || !holdsKindValue(x)
  );
}

/**
 * The fold of the `multiply` hook: every quantity and every operand that
 * `isMultiplyOperand()` accepts, in one fold, when there is at least one
 * quantity and at least two such operands. The product is the product of
 * `quantityMultiply()`: the magnitudes are multiplied and the units are
 * combined. A product whose unit is dimensionless is a plain number, which
 * the dispatch puts with the other numeric factors:
 * `Quantity(6, m) · Quantity(1, 1/m) · 2` is `12`.
 */
function quantityMultiplyFolds(
  ce: ComputeEngine,
  ops: KindOperands,
  numericApproximation: boolean
): ReadonlyArray<KindFold> | undefined {
  const indices: number[] = [];
  let quantities = 0;
  ops.evaluated.forEach((x, i) => {
    if (!isMultiplyOperand(x)) return;
    if (quantityTerm(x) !== undefined) quantities += 1;
    indices.push(i);
  });
  if (quantities === 0 || indices.length < 2) return undefined;
  // A negated temperature with an offset is multiplied as the temperature,
  // and the product is negated (`negatedValue()`).
  const factors = withoutNegations(indices.map((i) => ops.evaluated[i]));
  const product = quantityMultiply(ce, factors.operands);
  if (product === undefined) return undefined;
  const value = factors.negated ? negatedValue(ce, product) : product;
  return [
    { value: numericIf(value, numericApproximation)!, operands: indices },
  ];
}

/**
 * The quantity `x` with an evaluated magnitude, when the magnitude is an
 * expression with no unknowns that is not a number literal, an exact
 * constant expression or a measurement: `Quantity(1.5 + 0.5, m)` is
 * `Quantity(2, m)`, and `Quantity(k, m)` is `Quantity(2, m)` when the value
 * of `k` is `2`. Otherwise `x`.
 */
function withEvaluatedMagnitude(x: Expression): Expression {
  if (!isQuantity(x)) return x;
  const m = x.op1;
  if (
    isNumber(m) ||
    m.unknowns.length > 0 ||
    isExactConstantExpression(m) ||
    isMeasurement(m)
  )
    return x;
  const value = m.evaluate();
  return value === m ? x : x.engine._fn('Quantity', [value, x.op2]);
}

/**
 * The value of the operand `x` of a comparison: its exact value
 * (`x.exact()`, which evaluates the operand as written again without the
 * numeric approximation under `.N()`) when that is a quantity, a number
 * literal or an exact constant expression (`π`), else its value. So under
 * `.N()`, `Quantity(1 + 10⁻³⁰, m)` is compared with its exact magnitude,
 * and `1 m < (1 + 10⁻³⁰) m` is `True`, as it is with `evaluate()`.
 */
function comparisonOperand(x: KindOperand): Expression {
  const exact = x.exact();
  const value =
    isQuantity(exact) || isNumber(exact) || isExactConstantExpression(exact)
      ? exact
      : x.evaluated;
  return withEvaluatedMagnitude(value);
}

/**
 * The magnitudes and the unit expressions `[xMagnitude, xUnit, yMagnitude,
 * yUnit]` of `x` and `y` when one of the two magnitudes is a number literal
 * with a non-zero imaginary part (for a measured magnitude, its nominal
 * value), and `x` and `y` are values that `compareQuantities()` compares
 * when their magnitudes are real:
 * - two quantities whose units have one known dimension: `(1 + i) m` and
 *   `1 m`;
 * - a quantity whose unit is dimensionless and has no nominal scale
 *   (`percent`, `deg`), and a number (a number literal or an exact constant
 *   expression): `(1 + i) percent` and `0.07`. The number has the unit
 *   `rad`, whose scale is exactly 1, as in `compareQuantities()`.
 *
 * Such values have no order: `(1 + i) m < 1 m` is `False`, as `1 + i < 1`
 * is. Otherwise `undefined`; in particular for two quantities of different
 * dimensions, which have no order and no answer.
 */
function nonRealQuantityOperands(
  x: Expression,
  y: Expression
): [Expression, UnitExpression, Expression, UnitExpression] | undefined {
  const magnitudeAndUnit = (
    v: Expression,
    other: Expression
  ): [Expression, UnitExpression] | undefined => {
    if (isQuantity(v)) {
      const unit = boxedToUnitExpression(v.op2);
      if (!unit) return undefined;
      return [isMeasurement(v.op1) ? v.op1.op1 : v.op1, unit];
    }
    // A number is compared only with a quantity
    if (!isQuantity(other)) return undefined;
    if (
      !isNumber(v) &&
      !(isExactConstantExpression(v) && v.type.matches('number'))
    )
      return undefined;
    return [v, 'rad'];
  };
  const xm = magnitudeAndUnit(x, y);
  const ym = magnitudeAndUnit(y, x);
  if (!xm || !ym) return undefined;
  const [xMag, xUnit] = xm;
  const [yMag, yUnit] = ym;
  const xDim = getExpressionDimension(xUnit);
  const yDim = getExpressionDimension(yUnit);
  if (!xDim || !yDim || !dimensionsEqual(xDim, yDim)) return undefined;
  // The order of two values with different units of which one has a
  // nominal scale is not known (`compareQuantities()`)
  if (
    JSON.stringify(xUnit) !== JSON.stringify(yUnit) &&
    (hasLogarithmicUnit(xUnit) || hasLogarithmicUnit(yUnit))
  )
    return undefined;
  const nonReal = (m: Expression): boolean =>
    isNumber(m) && m.im !== 0 && !Number.isNaN(m.im);
  if (!nonReal(xMag) && !nonReal(yMag)) return undefined;
  return [xMag, xUnit, yMag, yUnit];
}

/**
 * Whether two values with a non-real magnitude (`nonRealQuantityOperands()`)
 * are equal. The magnitude of the value with the coarser unit is converted
 * to the finer unit with the exact affine map of the conversion
 * (`exactUnitConversion()`), as `compareQuantities()` converts a real
 * magnitude, and the two magnitudes are compared there by `isEqual()`:
 * exactly for two exact values, within the engine tolerance when one is a
 * float. So `(1 + i) m` and `(100 + 100i) cm` are equal, and `(1 + i) m`
 * and `1 m` are not. `undefined` when the conversion is not exact or
 * `isEqual()` does not decide.
 */
function nonRealQuantitiesEqual(
  ce: ComputeEngine,
  [xMag, xUnit, yMag, yUnit]: [
    Expression,
    UnitExpression,
    Expression,
    UnitExpression,
  ]
): boolean | undefined {
  const xScale = getExpressionScale(xUnit);
  const yScale = getExpressionScale(yUnit);
  if (xScale === null || yScale === null) return undefined;
  const [from, fromUnit, to, toUnit] =
    xScale < yScale ? [yMag, yUnit, xMag, xUnit] : [xMag, xUnit, yMag, yUnit];
  const map = exactUnitConversion(fromUnit, toUnit);
  if (map === null) return undefined;
  const factor =
    map.piPower === 0
      ? [ce.number(map.factor)]
      : [
          ce.number(map.factor),
          ce.function('Power', [ce.Pi, ce.number(map.piPower)]),
        ];
  const converted = ce
    .function('Add', [
      ce.function('Multiply', [...factor, from]),
      ce.number(map.offset),
    ])
    .evaluate();
  return converted.isEqual(to);
}

/**
 * The `eq` handler of the head `Quantity`. `Equal` asks it when the order
 * of the two values (`compare`) is not known:
 * - two values of different physical dimensions are not equal: `2 m` and
 *   `2 s`, `2 m` and the number `2`, `2 m` and a string
 *   (`quantityDimensionsDiffer()`);
 * - two values of one dimension are equal when their values after the
 *   conversion are (`compareQuantities()`);
 * - two such values of which one has a non-real magnitude are equal when
 *   their complex values after the conversion are
 *   (`nonRealQuantitiesEqual()`): `(1 + i) m` and `(100 + 100i) cm`;
 * - otherwise `undefined` (a symbolic magnitude): the comparison stays
 *   unevaluated.
 */
export function quantityEq(a: Expression, b: Expression): boolean | undefined {
  if (quantityDimensionsDiffer(a, b)) return false;
  const x = withEvaluatedMagnitude(a);
  const y = withEvaluatedMagnitude(b);
  const order = compareQuantities(x, y, {
    tolerance: a.engine.tolerance,
    exact: true,
    nominal: true,
  });
  if (order !== undefined) return order === 0;
  const operands = nonRealQuantityOperands(x, y);
  return operands === undefined
    ? undefined
    : nonRealQuantitiesEqual(a.engine, operands);
}

/**
 * The static result type of a cell of an operator with a quantity operand,
 * when it is not the type `quantity` (the default):
 * - `number | quantity` for `Multiply`, `Divide` and `Power` (also `Sqrt`,
 *   `Root` and `Square`), whose result is a plain number when the unit is
 *   dimensionless (`6 m / 3 m` is `2`);
 * - `quantity` for `Abs` (`Abs(-2 m)` is `2 m`);
 * - `number` for the trigonometric functions: an angle is folded to
 *   radians, and another quantity leaves the call unevaluated.
 */
function quantityResultType(operator: string): string | undefined {
  if (operator === 'Multiply' || operator === 'Divide' || operator === 'Power')
    return 'number | quantity';
  if (operator === 'Abs') return 'quantity';
  if (QUANTITY_TRIGONOMETRIC_OPERATORS.has(operator)) return 'number';
  return undefined;
}

/**
 * The arithmetic of the value kind `quantity`, the `arithmetic` field of the
 * head `Quantity`.
 */
export const QUANTITY_ARITHMETIC: ArithmeticDefinition = {
  admittedAs: 'none',
  add: (ops, { engine, numericApproximation }) =>
    quantityAddFolds(engine, ops, numericApproximation),
  multiply: (ops, { engine, numericApproximation }) =>
    quantityMultiplyFolds(engine, ops, numericApproximation),
  // The negation of a quantity negates its magnitude (`-(2 m)` is `-2 m`,
  // `Negate(20 degC)` is `-20 degC`). A sum of temperatures with an offset
  // still reads the sign of each term as written (`ops.written`, where the
  // canonical form of `a - b` keeps `Negate(b)`: `.neg()` does not run this
  // hook), so `20 degC - 5 degC` is `15 K`.
  negate: (x, { engine, numericApproximation }) =>
    isQuantity(x.evaluated)
      ? numericIf(quantityNegate(engine, x.evaluated), numericApproximation)
      : undefined,
  // A quotient with a quantity, and a quantity or a value that holds no
  // kind value (a number, a symbol) or a measurement: `6 m / 3 m` is `2`,
  // `6 m / 2` is `3 m`, `6 / 2 m` is `3 m⁻¹`.
  // A negated temperature with an offset is divided as the temperature, and
  // the quotient is negated (`negatedValue()`).
  divide: (a, b, { engine, numericApproximation }) => {
    const [x, y] = [a.evaluated, b.evaluated];
    if (quantityTerm(x) === undefined && quantityTerm(y) === undefined)
      return undefined;
    if (!isMultiplyOperand(x) || !isMultiplyOperand(y)) return undefined;
    const { operands, negated } = withoutNegations([x, y]);
    const quotient = quantityDivide(engine, operands[0], operands[1]);
    if (quotient === undefined) return undefined;
    return numericIf(
      negated ? negatedValue(engine, quotient) : quotient,
      numericApproximation
    );
  },
  // A power of a quantity: the unit takes the exponent (`(2 m)^2` is
  // `4 m^2`, `√(4 m^2)` is `2 m`). Under `.N()` the exact exponent is read
  // (`exact()`), so that the unit keeps an exact exponent: `Root(8 m^3, 3)`
  // is `2 m`, not `2 m^(1.0000…)`.
  power: (base, exponent, { engine, numericApproximation }) => {
    const b = base.evaluated;
    if (!isQuantity(b)) return undefined;
    let e = exponent.evaluated;
    if (numericApproximation) {
      const exact = exponent.exact();
      if (isNumber(exact)) e = exact;
    }
    if (holdsKindValue(e)) return undefined;
    return numericIf(quantityPower(engine, b, e), numericApproximation);
  },
  // The order of two quantities of one dimension after the conversion to the
  // finer of the two units, within the engine tolerance there (a float
  // magnitude) or exactly (two exact magnitudes); a quantity with a
  // dimensionless unit is ordered against a number (`6 percent < 0.07`). Two
  // values of different dimensions have no order (`undefined`), and `Equal`
  // asks `quantityEq()`, which says that they are not equal.
  // A caller that compares within a tolerance (`.is()`, through
  // `context.tolerance`) has every pair compared within it, two exact
  // magnitudes too: `1 m` is `(1 + 10⁻¹⁶) m`, and `1 m` is `1.1 m` within
  // `0.2`.
  // Two quantities of one dimension of which one has a magnitude with a
  // known non-real value are `'unordered'`: the order operators answer
  // `False` for them, as for two complex numbers (`(1 + i) m < 1 m` is
  // `False`, as `1 + i < 1` is), and `Equal` asks `quantityEq()`.
  compare: (a, b, { engine, tolerance }) => {
    const x = comparisonOperand(a);
    const y = comparisonOperand(b);
    const order = compareQuantities(x, y, {
      tolerance: tolerance ?? engine.tolerance,
      exact: tolerance === undefined,
      nominal: true,
    });
    if (order !== undefined) return order;
    return nonRealQuantityOperands(x, y) !== undefined
      ? 'unordered'
      : undefined;
  },
  // A quantity is as exact as its magnitude: `Quantity(1.5, m)` is not
  // exact, `Quantity(3/2, m)` is.
  isExact: (value) => !isQuantity(value) || !isInexactOperand(value.op1),
  // A quantity with a `NaN` magnitude (also a measured magnitude with a
  // `NaN` nominal) stands for no value: `Max(Quantity(NaN, m), 2 m)` is
  // `NaN`, as `Max(NaN, 2)` is.
  isNaN: (value) => {
    if (!isQuantity(value)) return false;
    const m = value.op1;
    return isMeasurement(m) ? m.op1.isNaN === true : m.isNaN === true;
  },
  resultType: (operator) => quantityResultType(operator),
};

export const QUANTITY_LIBRARY: SymbolDefinitions = {
  Quantity: {
    description: 'A value paired with a physical unit',
    wikidata: 'Q309314',
    complexity: 1200,
    lazy: true,
    // A quantity is a value of the VALUE KIND `quantity`
    // (`QUANTITY_ARITHMETIC` above): an opaque type, with its own
    // arithmetic and order.
    signature: '(value, value) -> quantity',
    arithmetic: QUANTITY_ARITHMETIC,
    // Two values of different dimensions are not equal; `Equal` asks it when
    // the order (`compare`) has no answer (`quantityEq()`).
    eq: (a, b) => quantityEq(a, b),
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce.error('incompatible-type');

      // Canonicalize the magnitude (first arg) but leave the unit as-is
      const mag = args[0].canonical;

      // A unit name (`m`, `km`, `K`) is not a variable. The unit is boxed
      // resolve-only: a name binds to an existing definition, but a name
      // with no definition stays unbound and is not declared in the current
      // scope.
      //
      // A string second argument (e.g. "km/h", "km") is parsed into a
      // structured unit expression with the same DSL parser the LaTeX/text
      // path uses. A simple unit becomes a symbol; a compound unit becomes a
      // Multiply/Divide/Power expression — so the string form canonicalizes
      // identically to the symbolic-unit form `Quantity(30, km/h)`.
      const unitArg = args[1];
      if (isString(unitArg)) {
        const parsed = parseUnitDSL(unitArg.string);
        if (parsed === null)
          return ce._fn('Quantity', [
            mag,
            ce.error(['unexpected-argument', unitArg.string]),
          ]);
        // The compound unit is boxed raw: `canonicalUnit()` makes it
        // canonical.
        const boxed = ce._resolveOnly(() =>
          typeof parsed === 'string'
            ? ce.symbol(parsed)
            : ce.box(parsed as any, { form: 'raw' })
        );
        return (
          cancelledUnitValue(ce, mag, boxed) ??
          ce._fn('Quantity', [mag, canonicalUnit(ce, boxed)])
        );
      }

      // A compound unit whose factors cancel (`m/m`) gives a plain number,
      // as the quantity arithmetic does.
      const value = cancelledUnitValue(ce, mag, unitArg);
      if (value !== undefined) return value;

      // The unit takes its canonical form (see `canonicalUnit()`): a unit
      // has one tree, whatever the tree of the input.
      return ce._fn('Quantity', [mag, canonicalUnit(ce, unitArg)]);
    },
    evaluate: (ops, { numericApproximation, engine: ce }) => {
      const mag = numericApproximation ? ops[0].N() : ops[0].evaluate();
      return ce._fn('Quantity', [mag, ops[1]]);
    },
    // Only the magnitude is evaluated, not the unit.
    evaluateAsync: async (ops, options) => {
      const { numericApproximation, engine: ce } = options;
      // A leaf keeps its own `N()`, which reads its value through the
      // ambient scope chain.
      const mag =
        numericApproximation && !isFunction(ops[0])
          ? runWithEvaluationEffects(
              ce,
              options.effects,
              () => ops[0].N(),
              options._contextStack,
              options._precisionWindow
            )
          : await ops[0].evaluateAsync(awaitedOperandOptions(options));
      return ce._fn('Quantity', [mag, ops[1]]);
    },
  },
};
