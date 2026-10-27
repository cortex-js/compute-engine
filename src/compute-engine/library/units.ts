import type {
  SymbolDefinitions,
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { runWithEvaluationEffects } from '../effects-registry.js';
import {
  awaitedOperandOptions,
  bignumPreferred,
} from '../boxed-expression/utils.js';
import { asFloat, hasFloatOperand } from '../boxed-expression/float-result.js';
import { decodedPayload } from '../boxed-expression/decoded-payload.js';
import {
  isSymbol,
  isFunction,
  isNumber,
} from '../boxed-expression/type-guards.js';
import {
  convertUnit,
  unitConversionCoefficients,
  convertCompoundUnit,
  dimensionsEqual,
  getExpressionDimension,
  getExpressionScale,
  findNamedUnit,
  getUnitDimension,
  type DimensionVector,
  type UnitExpression,
} from './unit-data.js';
import { isMeasurement, measurementAffine } from './measurement-arithmetic.js';
import { asRational } from '../boxed-expression/numerics.js';
import { order } from '../boxed-expression/order.js';
import { gcd as bigGcd } from '../numerics/numeric-bigint.js';

/**
 * Convert a boxed expression representing a unit into a plain
 * `UnitExpression` (string or JSON array) that `unit-data.ts` functions
 * can work with.
 *
 * The result is decoded once for each boxed expression and then read from a
 * cache (`decodedPayload()`), since the quantity hooks read the unit of an
 * operand at each operation. The caller must not modify the result.
 */
export function boxedToUnitExpression(expr: Expression): UnitExpression | null {
  if (!expr) return null;
  return decodedPayload(expr, decodeUnitExpression);
}

/**
 * A unit decoded for the quantity hooks: the unit expression, a string key
 * of it (two equal unit expressions have the same key), its dimension
 * vector, a string key of that vector (two units of the same dimension have
 * the same key), and its scale relative to coherent SI. A field is `null`
 * when it is not known: every field when the boxed unit is not a unit
 * expression (`boxedToUnitExpression()` gives `null`), the dimension and the
 * scale when a unit is not in the unit table.
 */
export type DecodedUnit = {
  readonly unit: UnitExpression | null;
  readonly key: string | null;
  readonly dimension: DimensionVector | null;
  readonly dimensionKey: string | null;
  readonly scale: number | null;
};

/** The `DecodedUnit` of the unit expression `unit`, with no cache. */
export function describeUnit(unit: UnitExpression | null): DecodedUnit {
  const dimension = unit ? getExpressionDimension(unit) : null;
  return {
    unit,
    key: unit ? JSON.stringify(unit) : null,
    dimension,
    dimensionKey: dimension ? JSON.stringify(dimension) : null,
    scale: unit ? getExpressionScale(unit) : null,
  };
}

function decodeUnit(expr: Expression): DecodedUnit {
  return describeUnit(boxedToUnitExpression(expr));
}

/**
 * The decoded unit of the boxed unit `expr` (the second operand of a
 * `Quantity`), computed once for each boxed expression and then read from a
 * cache (`decodedPayload()`). The caller must not modify the result.
 */
export function decodedUnit(expr: Expression): DecodedUnit {
  return decodedPayload(expr, decodeUnit);
}

/**
 * The decode of `boxedToUnitExpression()`, without the cache. The recursion
 * on the operands is direct: only the unit expression as a whole is cached.
 */
function decodeUnitExpression(expr: Expression): UnitExpression | null {
  if (!expr) return null;

  // Simple symbol unit
  if (isSymbol(expr)) return expr.symbol;

  if (!isFunction(expr)) return null;

  const op = expr.operator;
  if (op === 'Multiply') {
    const parts: UnitExpression[] = [];
    for (const child of expr.ops) {
      const c = decodeUnitExpression(child);
      if (!c) return null;
      parts.push(c);
    }
    return ['Multiply', ...parts];
  }

  if (op === 'Divide') {
    // A reciprocal unit such as `s^-1` is boxed as `Divide(1, s)`. The `1`
    // is not a unit, so read it as the unit with exponent -1.
    if (expr.op1.isSame(1)) {
      const b = decodeUnitExpression(expr.op2);
      return b ? ['Power', b, -1] : null;
    }
    const a = decodeUnitExpression(expr.op1);
    const b = decodeUnitExpression(expr.op2);
    if (!a || !b) return null;
    return ['Divide', a, b];
  }

  if (op === 'Power') {
    const base = decodeUnitExpression(expr.op1);
    const exp = expr.op2?.re;
    // A symbolic exponent (`m^n`) has no numeric value: `.re` is `NaN`.
    if (!base || exp === undefined || Number.isNaN(exp)) return null;
    return ['Power', base, exp];
  }

  // A canonical unit with a fraction exponent can be a root: the canonical
  // form of `m^(1/2)` is `Sqrt(m)`, and of `m^(1/3)` is `Root(m, 3)`.
  if (op === 'Sqrt') {
    const base = decodeUnitExpression(expr.op1);
    return base ? ['Power', base, 0.5] : null;
  }

  if (op === 'Root') {
    const base = decodeUnitExpression(expr.op1);
    const n = expr.op2?.re;
    if (!base || n === undefined || !Number.isInteger(n) || n === 0)
      return null;
    return ['Power', base, 1 / n];
  }

  return null;
}

/**
 * The exponent of a unit factor: an exact fraction `[n, d]` with `d > 0`, or
 * a machine number for a float exponent (`m^{0.5}`).
 */
type UnitExponent = [number, number] | number;

function gcdInt(a: number, b: number): number {
  a = Math.abs(a);
  while (b !== 0) [a, b] = [b, a % b];
  return a === 0 ? 1 : a;
}

/**
 * The fraction `n/d` in lowest terms. Returns `null` when `n` or `d` is not
 * a safe integer: such an exponent (`m^(10^200)`) cannot be exact as a
 * machine number, and the unit keeps its usual canonical form.
 */
function unitFraction(n: number, d: number): UnitExponent | null {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d === 0)
    return null;
  if (d < 0) [n, d] = [-n, -d];
  const g = gcdInt(n, d);
  return [n / g, d / g];
}

function unitExponentValue(e: UnitExponent): number {
  return typeof e === 'number' ? e : e[0] / e[1];
}

/** A float exponent, or `null` when it is not finite. */
function finiteUnitExponent(x: number): UnitExponent | null {
  return Number.isFinite(x) ? x : null;
}

function negateUnitExponent(e: UnitExponent): UnitExponent {
  return typeof e === 'number' ? -e : [-e[0], e[1]];
}

/**
 * The fraction `n/d` of two bigints, in lowest terms, as an exponent. Returns
 * `null` when the reduced `n` or `d` is not a safe integer (see
 * `unitFraction()`).
 *
 * The sum and the product of two exponents are computed with bigints: a
 * cross-product of two safe integers can be above 2^53, and a machine-number
 * product rounds it. The rounded cross-products can then give a small
 * numerator that passes the safe-integer test, but is wrong:
 * `6004799503160661/2 - 9007199254740991/3` is `1/6`, and machine numbers
 * give `2/6`.
 */
function bigUnitFraction(n: bigint, d: bigint): UnitExponent | null {
  if (d === 0n) return null;
  if (d < 0n) [n, d] = [-n, -d];
  const g = bigGcd(n, d);
  if (g > 1n) [n, d] = [n / g, d / g];
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (n > max || -n > max || d > max) return null;
  return [Number(n), Number(d)];
}

function addUnitExponents(
  a: UnitExponent,
  b: UnitExponent
): UnitExponent | null {
  if (typeof a === 'number' || typeof b === 'number')
    return finiteUnitExponent(unitExponentValue(a) + unitExponentValue(b));
  return bigUnitFraction(
    BigInt(a[0]) * BigInt(b[1]) + BigInt(b[0]) * BigInt(a[1]),
    BigInt(a[1]) * BigInt(b[1])
  );
}

function multiplyUnitExponents(
  a: UnitExponent,
  b: UnitExponent
): UnitExponent | null {
  if (typeof a === 'number' || typeof b === 'number')
    return finiteUnitExponent(unitExponentValue(a) * unitExponentValue(b));
  return bigUnitFraction(
    BigInt(a[0]) * BigInt(b[0]),
    BigInt(a[1]) * BigInt(b[1])
  );
}

/**
 * The exponent of a `Power` unit: an exact integer or rational literal gives
 * a fraction, a finite real float gives a float. Any other exponent (a
 * symbol, a radical) gives `null`. The exponent of a unit that is not
 * canonical yet (`Rational(1, 2)`, `Negate(2)`) is read from its canonical
 * form.
 */
function readUnitExponent(x: Expression): UnitExponent | null {
  x = x.canonical;
  if (!isNumber(x)) return null;
  const r = asRational(x);
  if (r !== undefined) return unitFraction(Number(r[0]), Number(r[1]));
  if (x.isExact || x.im !== 0) return null;
  return finiteUnitExponent(x.re);
}

/**
 * A unit symbol and its total exponent in a unit expression. The symbol is
 * kept as the canonical boxed symbol of the unit, so that a rebuilt unit has
 * the same binding as the original one.
 */
type UnitFactor = { symbol: Expression; exp: UnitExponent };

/**
 * The factors of a unit expression: each unit symbol with the sum of its
 * exponents, in the order of their first occurrence. `kg·m/s^2` gives
 * `kg^1, m^1, s^-2`, and `m·m` gives `m^2`. A `Sqrt` or `Root` is a power
 * with a fraction exponent: `Sqrt(m)` is `m^(1/2)`. The `1` of a reciprocal
 * unit, `Divide(1, s)`, is not a factor.
 *
 * The unit can be canonical or not: the parser gives a unit that is not
 * canonical yet. Only the symbols and the exponents are made canonical, not
 * the products and quotients. The canonical form of a product checks that
 * its operands are numbers, and it declares a single-letter unit that is
 * also an operator (`N`, the newton, and the operator `N`) as a new symbol
 * of the current scope. Then `N(π)` was not evaluated after the parse of
 * `\mathrm{N/A^{2}}`.
 *
 * Returns `null` when the expression is not a product of powers of symbols
 * with numeric exponents (for example `m^n`, or `m + s`).
 */
function unitFactors(
  ce: ComputeEngine,
  unit: Expression
): Map<string, UnitFactor> | null {
  const factors = new Map<string, UnitFactor>();
  const walk = (e: Expression, exp: UnitExponent): boolean => {
    if (isSymbol(e)) {
      const prev = factors.get(e.symbol);
      const total = prev ? addUnitExponents(prev.exp, exp) : exp;
      if (total === null) return false;
      factors.set(e.symbol, {
        symbol: prev?.symbol ?? ce._resolveOnly(() => e.canonical),
        exp: total,
      });
      return true;
    }
    if (!isFunction(e)) return false;
    const op = e.operator;
    if (op === 'Multiply') return e.ops.every((x) => walk(x, exp));
    if (op === 'Divide') {
      if (e.nops !== 2) return false;
      const minus = negateUnitExponent(exp);
      if (isNumber(e.op1) && e.op1.isSame(1)) return walk(e.op2, minus);
      return walk(e.op1, exp) && walk(e.op2, minus);
    }
    let inner: UnitExponent | null = null;
    if (op === 'Power' && e.nops === 2) inner = readUnitExponent(e.op2);
    else if (op === 'Sqrt' && e.nops === 1) inner = [1, 2];
    else if (op === 'Root' && e.nops === 2) {
      const n = readUnitExponent(e.op2);
      if (n !== null && typeof n !== 'number' && n[1] === 1 && n[0] > 0)
        inner = [1, n[0]];
    }
    if (inner === null) return false;
    const next = multiplyUnitExponents(exp, inner);
    return next !== null && walk(e.op1, next);
  };
  return walk(unit, [1, 1]) ? factors : null;
}

/**
 * The canonical unit expression of a list of unit factors, or `null` when
 * every exponent is zero (the unit is dimensionless).
 *
 * The factors with a positive exponent are the numerator, the factors with a
 * negative exponent the denominator, and the unit is `Divide(numerator,
 * denominator)`. With no positive factor, the numerator is `1`: `s^-1` is
 * `Divide(1, s)`. The factors of a product are sorted in the canonical order
 * of a product. A fraction exponent has the canonical form of a power:
 * `m^(1/2)` is `Sqrt(m)`, `m^(1/3)` is `Root(m, 3)`, `m^(2/3)` is
 * `Power(m, 2/3)`. This is also the canonical tree of `kg\cdot m/s^{2}` and
 * of `1/m^{1/2}`.
 *
 * The tree is built from its parts, with no canonicalization of the products
 * and quotients, for the reason given in `unitFactors()`.
 */
function unitFromFactors(
  ce: ComputeEngine,
  factors: Iterable<UnitFactor>
): Expression | null {
  const power = (symbol: Expression, e: UnitExponent): Expression => {
    if (typeof e === 'number') return ce._fn('Power', [symbol, ce.number(e)]);
    const [n, d] = e;
    if (d === 1)
      return n === 1 ? symbol : ce._fn('Power', [symbol, ce.number(n)]);
    if (n === 1 && d === 2) return ce._fn('Sqrt', [symbol]);
    if (n === 1) return ce._fn('Root', [symbol, ce.number(d)]);
    return ce._fn('Power', [symbol, ce.number([n, d])]);
  };
  const product = (xs: Expression[]): Expression =>
    xs.length === 1 ? xs[0] : ce._fn('Multiply', xs.sort(order));
  const num: Expression[] = [];
  const den: Expression[] = [];
  for (const { symbol, exp } of factors) {
    const v = unitExponentValue(exp);
    if (v === 0) continue;
    if (v > 0) num.push(power(symbol, exp));
    else den.push(power(symbol, negateUnitExponent(exp)));
  }
  if (num.length === 0 && den.length === 0) return null;
  if (den.length === 0) return product(num);
  return ce._fn('Divide', [
    num.length === 0 ? ce.One : product(num),
    product(den),
  ]);
}

/**
 * The canonical form of a unit expression. A unit has many trees with the
 * same value: `Power(Sqrt(m), -1)`, `Power(m, -1/2)` and `Divide(1, Sqrt(m))`
 * are the same unit, and so are `Multiply(m, Power(s, -1))` and
 * `Divide(m, s)`, or `Multiply(m, m)` and `Power(m, 2)`. The canonical form
 * collects the exponents of each unit symbol, with exact fraction exponents,
 * and writes the result as in `unitFromFactors()`. The `Quantity` canonical
 * handler (which the parser output goes through) and the quantity arithmetic
 * both use this form, so that `isSame()` is `true` for two trees of the same
 * unit, and the LaTeX of a quantity parses back to the same tree.
 *
 * The unit can be canonical or not. A unit that is not a product of powers
 * of symbols with numeric exponents (`m^n`), and a unit whose exponents all
 * cancel (`m/m`), are returned in their usual canonical form. A unit name
 * is not a variable: the unit is boxed resolve-only, so a name with no
 * definition is not declared in the current scope.
 */
export function canonicalUnit(ce: ComputeEngine, unit: Expression): Expression {
  if (isFunction(unit)) {
    const factors = unitFactors(ce, unit);
    const result = factors ? unitFromFactors(ce, factors.values()) : null;
    if (result) return result;
  }
  return ce._resolveOnly(() => unit.canonical);
}

/**
 * The magnitude `mag` when `unit` is a compound unit whose factors all
 * cancel (`m/m`, `m·s/(s·m)`): the quantity `mag unit` is then the plain
 * number `mag`, as in the quantity arithmetic, where `(6 m)/(2 m)` is `3`.
 * Otherwise `undefined`, and the quantity stays a quantity. A unit symbol
 * (`percent`, `rad`) is a named unit, and a compound unit whose factors do
 * not cancel stays a unit also when its dimension is zero: `in/ft` (inches
 * per foot) is the unit of a slope.
 */
export function cancelledUnitValue(
  ce: ComputeEngine,
  mag: Expression,
  unit: Expression
): Expression | undefined {
  if (!isFunction(unit)) return undefined;
  const factors = unitFactors(ce, unit);
  if (factors === null || unitFromFactors(ce, factors.values()) !== null)
    return undefined;
  return mag;
}

/**
 * The canonical unit for the factor map of a unit after a cancellation by
 * `cancelUnitFactors()`, whose exponents are machine numbers: `m^(2/3)·m^(2/3)`
 * gives the exponent `1.3333333333333333`. The exact exponents are recovered
 * from the exponents of `original`, the unit before the cancellation: when
 * they are all exact, each exponent of the cancellation is a sum of them, so
 * it is a multiple of `1/L`, with `L` the least common multiple of their
 * denominators. Then `m^(4/3)` has the exact exponent `4/3`. When an
 * exponent of `original` is a float, or when `L` is above 10^6 (the rounding
 * error of `L` times an exponent can then reach one unit), the exponents stay
 * floats.
 *
 * Returns `null` when every exponent is zero, or when a symbol of `factors`
 * is not a symbol of `original`.
 */
/**
 * Whether the unit factors of `unit` cancel exactly, as the unit
 * cancellation of `cancelUnitFactors()` found with machine numbers. That
 * cancellation groups the unit symbols by dimension, and a group cancels when
 * the sum of its exponents is zero. The sum of two large exponents can round
 * to zero: `m^(6004799503160661/2) · m^(-9007199254740991/3)` is `m^(1/6)`,
 * but both exponents round to the machine number `3002399751580330.5`.
 * This function adds the exact exponents of each group.
 *
 * Returns `false` when the exact sum of a group is not zero: then the unit
 * did not cancel. Returns `true` when every exact sum is zero, and also when
 * the exact sums cannot be computed (an exponent is not a number, a symbol is
 * not a known unit, or a sum is too large to be exact): then the result of
 * the cancellation with machine numbers is kept.
 */
export function unitExactlyCancels(
  ce: ComputeEngine,
  unit: Expression
): boolean {
  const factors = unitFactors(ce, unit);
  if (factors === null) return true;
  const sums = new Map<string, UnitExponent>();
  for (const [name, { exp }] of factors) {
    const dim = getUnitDimension(name);
    if (dim === null) return true;
    const key = dim.join(',');
    const prev = sums.get(key);
    const total = prev === undefined ? exp : addUnitExponents(prev, exp);
    if (total === null) return true;
    sums.set(key, total);
  }
  for (const e of sums.values()) if (unitExponentValue(e) !== 0) return false;
  return true;
}

export function canonicalUnitFromFactorMap(
  ce: ComputeEngine,
  factors: Map<string, number>,
  original: Expression
): Expression | null {
  const originalFactors = unitFactors(ce, original);
  if (originalFactors === null) return null;
  let lcm: number | null = 1;
  for (const { exp } of originalFactors.values()) {
    if (typeof exp === 'number') {
      lcm = null;
      break;
    }
    lcm = (lcm / gcdInt(lcm, exp[1])) * exp[1];
    if (lcm > 1e6) {
      lcm = null;
      break;
    }
  }
  const result: UnitFactor[] = [];
  for (const [name, e] of factors) {
    const symbol = originalFactors.get(name)?.symbol;
    if (symbol === undefined) return null;
    let exp: UnitExponent = e;
    if (lcm !== null) {
      const k = Math.round(e * lcm);
      if (Math.abs(k / lcm - e) <= 1e-9 * Math.max(1, Math.abs(e)))
        exp = unitFraction(k, lcm) ?? e;
    }
    result.push({ symbol, exp });
  }
  return unitFromFactors(ce, result);
}

/**
 * True when an operand or a magnitude of quantity arithmetic has no numeric
 * value, for example a free symbol `x` or a product `3x` that contains one.
 * Its `.re` is `NaN`, so numeric arithmetic cannot use it. Such a value goes
 * through the expression arithmetic of the `Measurement` branches instead,
 * which keeps it symbolic: `Quantity(3, m) · x` is `Quantity(3x, m)`. A
 * number literal `NaN` is a numeric value and stays on the numeric branch.
 */
export function isSymbolicValue(x: Expression): boolean {
  if (isMeasurement(x) || isFunction(x, 'Quantity') || isNumber(x))
    return false;
  return Number.isNaN(x.re);
}

/**
 * True when quantity arithmetic over `values` (the scalar operands and the
 * magnitudes of the quantity operands) combines them as expressions, with the
 * helpers of `measurement-arithmetic.ts`, and not as machine numbers read
 * with `.re`. This is the case when:
 * - a value is a `Measurement`: its error must propagate;
 * - a value has no numeric value (see `isSymbolicValue()`):
 *   `Quantity(3, m) · x` is `Quantity(3x, m)`;
 * - no value is a float: all the values are exact (an integer, a rational,
 *   a radical, an exact constant such as `π`), and `evaluate()` keeps an
 *   exact result exact. `Quantity(3, m) · π` is `Quantity(3π, m)`, not
 *   `Quantity(9.42…, m)`, and `Quantity(3, m)^-1` is `Quantity(1/3, m^-1)`.
 *   Under `.N()` the caller makes the result numeric;
 * - a value is not real: its `.re` drops the imaginary part;
 * - the precision of the engine is above the precision of a machine number
 *   (`bignumPreferred()`): `.re` would round a big decimal value to about
 *   16 digits. Under `.N()`, `π·(1 rad)` is `3.14159265358979323846 rad`
 *   at 21 digits, not `3.141592653589793 rad`.
 *
 * Otherwise at least one value is a float, all the values are real, and the
 * engine computes with machine numbers: the machine-number arithmetic gives
 * the float result.
 */
export function usesExpressionArithmetic(
  values: ReadonlyArray<Expression>
): boolean {
  if (values.some((x) => isMeasurement(x) || isSymbolicValue(x))) return true;
  if (!hasFloatOperand(values)) return true;
  if (bignumPreferred(values[0].engine)) return true;
  return values.some((x) => x.im !== 0);
}

/**
 * True when the unit conversion `x → c1·x + c0` (with `c0 = convert(0)` and
 * `c1 = convert(1)`) keeps an exact magnitude exact: the conversion has no
 * offset and its factor is an integer (`m → cm` is `x → 100x`). The
 * conversion data are machine numbers, so another factor (`cm → m` is
 * `x → 0.01x`, `m/s → km/h` is `x → 3.5999999999999996x`) gives a float
 * result whatever the magnitude, and an offset (a temperature) also gives a
 * float. Then the conversion is numeric, as for a float magnitude.
 */
export function isExactConversion(
  c0: number | null,
  c1: number | null
): boolean {
  return c0 === 0 && c1 !== null && Number.isInteger(c1);
}

/**
 * The magnitude `mag` under the affine map `x → f·x + c` of a unit
 * conversion. A `Measurement` magnitude is mapped with `measurementAffine()`,
 * which scales its error by `|f|`. Another magnitude has no error, and it is
 * mapped with plain expression arithmetic: the error term of
 * `measurementAffine()` multiplies the square of the magnitude by the square
 * of a zero error, and for an infinite magnitude that product is
 * `Indeterminate` (`Quantity(+∞, m)` converted to `cm` gave
 * `(+∞ ± Indeterminate) cm`).
 */
export function affineMagnitude(
  ce: ComputeEngine,
  mag: Expression,
  f: number,
  c: number
): Expression {
  if (isMeasurement(mag)) return measurementAffine(ce, mag, f, c);
  let r = mag;
  if (f !== 1) r = ce.function('Multiply', [r, ce.number(f)]).evaluate();
  if (c !== 0) r = ce.function('Add', [r, ce.number(c)]).evaluate();
  return r;
}

/**
 * The conversion of the evaluated `quantity` to the unit `targetUnitExpr`,
 * shared by the synchronous and the asynchronous `UnitConvert` handlers.
 */
function convertQuantity(
  ce: ComputeEngine,
  quantity: Expression | undefined,
  targetUnitExpr: Expression,
  numericApproximation: boolean | undefined
): Expression | undefined {
  if (!quantity || !isFunction(quantity) || quantity.operator !== 'Quantity')
    return undefined;

  // A Measurement magnitude scales (nominal and error) by the conversion
  // factor; unit conversion is affine, so the linear factor is
  // `convert(1) − convert(0)` and the offset shifts the nominal only. A
  // symbolic magnitude is converted with the same expression arithmetic.
  // An exact magnitude is converted with it too when the conversion is a
  // multiplication by an integer, so that `evaluate()` keeps `π m` as
  // `100π cm` (see `isExactConversion()`). Otherwise the result is a float
  // (the conversion factor is a float), and an exact magnitude is converted
  // numerically, as a float magnitude is.
  const magExpr = quantity.op1;
  const magIsMeasurement = isMeasurement(magExpr) || isSymbolicValue(magExpr);
  const magIsExact = !magIsMeasurement && usesExpressionArithmetic([magExpr]);
  const mag = magExpr.re;
  if (!magIsMeasurement && mag === undefined) return undefined;
  // The numeric conversion is used for a float magnitude, or for a
  // conversion by a float factor or with an offset. Its result is a float,
  // also when its value is an integer: `100 cm` converted to `m` is the
  // float `1`, as `150 cm` is the float `1.5`.
  const numericMagnitude = (x: number) => asFloat(ce.number(x));

  // Try simple symbol-based conversion first
  const fromUnit = quantity.op2;
  const fromSymbol = isSymbol(fromUnit) ? fromUnit.symbol : null;
  const toSymbol = isSymbol(targetUnitExpr) ? targetUnitExpr.symbol : null;

  if (fromSymbol && toSymbol) {
    const c0 = convertUnit(0, fromSymbol, toSymbol);
    const c1 = convertUnit(1, fromSymbol, toSymbol);
    if (magIsMeasurement || (magIsExact && isExactConversion(c0, c1))) {
      // The coefficients of the conversion are computed from exact data:
      // `c1 − c0` loses digits for a temperature (`degC → degF` gives
      // `1.7999999999999972`).
      const map = unitConversionCoefficients(fromSymbol, toSymbol);
      if (map === null) return ce.error('incompatible-type');
      const convertedMag = affineMagnitude(ce, magExpr, map.factor, map.offset);
      // A unit name is not a variable: it must not be declared in the
      // current scope.
      const r = ce._fn('Quantity', [
        convertedMag,
        ce.symbol(toSymbol, { autoDeclare: false }),
      ]);
      return numericApproximation ? r.N() : r;
    }
    const converted = convertUnit(mag!, fromSymbol, toSymbol);
    if (converted !== null)
      return ce._fn('Quantity', [
        numericMagnitude(converted),
        ce.symbol(toSymbol, { autoDeclare: false }),
      ]);
    // If conversion returned null, units are incompatible
    return ce.error('incompatible-type');
  }

  // Fall back to compound unit conversion
  const fromUE = boxedToUnitExpression(fromUnit);
  const toUE = boxedToUnitExpression(targetUnitExpr);
  if (!fromUE || !toUE) return undefined;

  const c0 = convertCompoundUnit(0, fromUE, toUE);
  const c1 = convertCompoundUnit(1, fromUE, toUE);
  if (magIsMeasurement || (magIsExact && isExactConversion(c0, c1))) {
    if (c0 === null || c1 === null) return ce.error('incompatible-type');
    const convertedMag = affineMagnitude(ce, magExpr, c1 - c0, c0);
    const r = ce._fn('Quantity', [convertedMag, targetUnitExpr]);
    return numericApproximation ? r.N() : r;
  }

  const converted = convertCompoundUnit(mag!, fromUE, toUE);
  if (converted === null) return ce.error('incompatible-type');

  return ce._fn('Quantity', [numericMagnitude(converted), targetUnitExpr]);
}

export const UNITS_LIBRARY: SymbolDefinitions = {
  // Internal marker produced by the \mathrm/\text expression handler in
  // definitions-units.ts.  When juxtaposed with a number the
  // InvisibleOperator canonical detects this wrapper and produces
  // ['Quantity', number, unit].  If the marker reaches canonicalization
  // without InvisibleOperator (e.g. standalone `\mathrm{cm}`), unwrap it
  // to just the unit expression.
  __unit__: {
    signature: '(value) -> value',
    canonical: (args, { engine: ce }) => {
      if (args.length === 1) return args[0].canonical;
      return ce.error('incompatible-type');
    },
  },

  // `Quantity` is defined with its value kind in `quantity-kind.ts`
  // (`QUANTITY_LIBRARY`).

  QuantityMagnitude: {
    description: 'Extract the numeric value from a quantity',
    complexity: 1200,
    signature: '(value) -> value',
    evaluate: (ops) => {
      const arg = ops[0];
      if (isFunction(arg, 'Quantity')) return arg.op1;
      return undefined;
    },
  },

  QuantityUnit: {
    description: 'Extract the unit from a quantity',
    complexity: 1200,
    signature: '(value) -> value',
    evaluate: (ops) => {
      const arg = ops[0];
      if (isFunction(arg, 'Quantity')) return arg.op2;
      return undefined;
    },
  },

  UnitConvert: {
    description: 'Convert a quantity to a different compatible unit',
    complexity: 1200,
    lazy: true,
    signature: '(value, value) -> value',
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce.error('incompatible-type');
      // Canonicalize the quantity (first arg) but leave the target unit as-is.
      // The target unit is boxed resolve-only, as the unit of a `Quantity`:
      // a unit name is not declared in the current scope.
      // The target unit takes its canonical form, which is the unit of the
      // result (see `canonicalUnit()`).
      return ce._fn('UnitConvert', [
        args[0].canonical,
        canonicalUnit(ce, args[1]),
      ]);
    },
    evaluate: (ops, { numericApproximation, engine: ce }) => {
      if (!ce) return undefined;
      return convertQuantity(
        ce,
        ops[0]?.evaluate(),
        ops[1],
        numericApproximation
      );
    },
    // Only the quantity is evaluated, not the target unit.
    evaluateAsync: async (ops, options) => {
      const { numericApproximation, engine: ce } = options;
      if (!ce) return undefined;
      const quantity = await ops[0]?.evaluateAsync(
        awaitedOperandOptions(options, { numericApproximation: false })
      );
      return runWithEvaluationEffects(
        ce,
        options.effects,
        () => convertQuantity(ce, quantity, ops[1], numericApproximation),
        options._contextStack,
        options._precisionWindow
      );
    },
  },

  UnitSimplify: {
    description: 'Simplify a quantity unit to a named derived unit if possible',
    complexity: 1200,
    signature: '(value) -> value',
    evaluate: (ops, { engine: ce }) => {
      const arg = ops[0]?.evaluate();
      if (!isFunction(arg, 'Quantity')) return arg;

      const mag = arg.op1.re;
      const unitExpr = arg.op2;

      // Get the unit expression as a UnitExpression for dimension calculation
      const ue = boxedToUnitExpression(unitExpr);
      if (!ue) return arg;

      // Compute dimension vector of the compound unit
      const dim = getExpressionDimension(ue);
      if (!dim) return arg;

      // Search named derived units for a matching dimension with scale=1
      const match = findNamedUnit(dim);
      if (!match) return arg;

      // findNamedUnit only returns scale=1 units, so just multiply mag
      // by the compound unit's scale to get the magnitude in the named unit.
      const scale = getExpressionScale(ue);
      if (scale === null) return arg;

      // A Measurement, symbolic or exact magnitude is scaled with
      // expression arithmetic: a numeric read of its value loses the error,
      // gives `NaN`, or makes an exact `π` a float. For an exact magnitude
      // that is the case only for an integer scale (see
      // `isExactConversion()`). Otherwise the magnitude or the scale is a
      // float, and the result is a float, also when its value is an integer.
      const magExpr = arg.op1;
      const scaled =
        isMeasurement(magExpr) ||
        isSymbolicValue(magExpr) ||
        (usesExpressionArithmetic([magExpr]) && isExactConversion(0, scale))
          ? affineMagnitude(ce, magExpr, scale, 0)
          : asFloat(ce.number(mag * scale));
      return ce._fn('Quantity', [
        scaled,
        ce.symbol(match, { autoDeclare: false }),
      ]);
    },
  },

  IsCompatibleUnit: {
    description: 'Check if two units have the same dimension',
    complexity: 1200,
    lazy: true,
    signature: '(value, value) -> value',
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce.error('incompatible-type');
      // Don't canonicalize unit arguments — they may be symbols like 'N'
      // that conflict with function definitions
      return ce._fn('IsCompatibleUnit', args);
    },
    evaluate: (ops, { engine: ce }) => {
      // Support both simple symbols and compound unit expressions
      const aUE = boxedToUnitExpression(ops[0]);
      const bUE = boxedToUnitExpression(ops[1]);
      if (!aUE || !bUE) return undefined;

      const da = getExpressionDimension(aUE);
      const db = getExpressionDimension(bUE);
      if (!da || !db) return undefined;

      return ce.symbol(dimensionsEqual(da, db) ? 'True' : 'False');
    },
  },

  UnitDimension: {
    description: 'Return the dimension vector of a unit',
    complexity: 1200,
    lazy: true,
    signature: '(value) -> value',
    canonical: (args, { engine: ce }) => {
      if (args.length !== 1) return ce.error('incompatible-type');
      // Don't canonicalize unit argument — same reason as IsCompatibleUnit
      return ce._fn('UnitDimension', args);
    },
    evaluate: (ops, { engine: ce }) => {
      // Support both simple symbols and compound unit expressions
      const ue = boxedToUnitExpression(ops[0]);
      if (!ue) return undefined;

      const dim = getExpressionDimension(ue);
      if (!dim) return undefined;

      return ce._fn(
        'List',
        dim.map((d) => ce.number(d))
      );
    },
  },
};
