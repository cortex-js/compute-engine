/**
 * The VALUE KIND of the head `Enclosure` (`ENCLOSURE_ARITHMETIC`, the
 * `arithmetic` field of its definition in `enclosure.ts`).
 *
 * An `Enclosure(lo, hi)` is a closed, connected enclosure of one real number:
 * the real is somewhere in `[lo, hi]`. It is a value of the kind type
 * `enclosure`, admitted where a real is admitted (`admittedAs: 'real'`), so
 * the numeric functions are APPLY SITES for it (`Sin`, `Ln`, `Floor`, …,
 * `docs/plans/2026-10-26-value-kinds.md`, sections 4.3 and 4.9.2).
 *
 * THE ENDPOINTS. An endpoint is of one of three classes, which every hook
 * reads the same way (`endpointClass()`):
 * 1. a real number literal (`0`, `1/3`, `0.1`, `+oo`);
 * 2. an exact closed constant: an exact constant expression with no free
 *    variable, typed `real`, whose numeric value is known (`Pi`, `Sin(1)`);
 * 3. anything else (`a`, `f(1)`): the hooks leave the call unevaluated.
 *
 * THE TWO ROUTES. Under `evaluate()`, when every endpoint is exact (class 1
 * exact or class 2), a hook computes the image with exact endpoints, through
 * the engine (`Sin(Enclosure(0, 1))` is `Enclosure(0, Sin(1))`). Under
 * `.N()`, or with a float endpoint, or when an exact comparison that the
 * exact route needs is not decided (`UNDECIDED`), the endpoints are
 * converted to doubles with OUTWARD rounding (the largest double that is not
 * above `lo`, the smallest double that is not below `hi`:
 * `outwardDoubles()`), and the image is the answer of the interval library
 * (`src/compute-engine/interval/`), one kernel for each form, mapped by
 * `fromResult()`. The interval library is also what the `interval-js`
 * compilation target calls, so the two give the same doubles.
 *
 * `Artanh` and `Fract` call the library's `atanh` and `fract` as they are,
 * the functions the compiled code calls: `atanh` gives `±oo` at a boundary
 * `±1` that the range reaches, and `fract` rounds its subtraction outward
 * (ROADMAP CE-522, items 2 and 9). A `Power` with a negative integer
 * exponent takes the reciprocal of the positive power by the `divide` rule
 * (`numericPower()`), so a compiled form of it must use the same
 * composition to give the same doubles (ROADMAP CE-522, item 7).
 *
 * AN EMPTY IMAGE. There is no empty enclosure: an image with no real value
 * (`Ln(Enclosure(-2, -1))`, `1 / Enclosure(0, 0)`), or an infinite singleton
 * (`Enclosure(0, 1) + +oo`), is the indeterminate value: `Indeterminate`
 * under `evaluate()` with exact endpoints, `NaN` otherwise.
 *
 * THE HULL. A function with a pole inside the enclosure gives the whole line
 * `Enclosure(-oo, +oo)` (one connected value); a pole at an endpoint gives a
 * half-line (`1 / Enclosure(0, 1)` is `Enclosure(1, +oo)`).
 */

import type {
  ArithmeticContext,
  ArithmeticDefinition,
  Expression,
  IComputeEngine as ComputeEngine,
  KindFold,
  KindOperand,
  KindOperands,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { provablyDisjoint } from '../../common/type/subtype.js';
import { SIGNED_INFINITY_TYPE } from '../../common/type/primitive.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  exactConstantOrder,
  isExactConstantExpression,
} from '../boxed-expression/compare.js';
import { exactCompareNumbers } from '../boxed-expression/constraint-subject.js';
import { asRational } from '../boxed-expression/numerics.js';
import { halfTurnAngle } from '../boxed-expression/trigonometry.js';
import { realPowerBranchTerms } from '../numerics/real-power.js';
import { nextDown, nextUp } from '../numerics/numeric.js';
import { MachineNumericValue } from '../numeric-value/machine-numeric-value.js';
import { IntervalArithmetic as IA } from '../interval/index.js';
import type { Interval, IntervalResult } from '../interval/types.js';

//
// The values
//

/** A value of the kind: a call `Enclosure(lo, hi)` with two endpoints. */
export function isEnclosure(x: Expression): boolean {
  return isFunction(x, 'Enclosure') && x.nops === 2;
}

/**
 * An enclosure, or a number read as the point enclosure `[x, x]`, as the
 * hooks read it. `lo` and `hi` are endpoints of class 1 or 2. `exact` is
 * true when both are exact (class 1 exact, or class 2). `ordered` is true
 * when `lo ≤ hi` is known; when it is not (`Enclosure(Sin(10^600), 0)`), the
 * hooks read the value through the outward doubles of its endpoints, as
 * `[min, max]`.
 */
export interface Range {
  readonly lo: Expression;
  readonly hi: Expression;
  readonly exact: boolean;
  readonly ordered: boolean;
}

/** The marker of a number operand that is `+oo` or `-oo`. */
const INFINITE = 'infinite';

// The decodes below evaluate numerically (`.N()`, `exactConstantOrder()`),
// and the value of `Sin(1)` depends on the angular unit and the precision,
// so the cache of `decodedPayload()`, which is never invalidated and reads
// only the structure of an expression, cannot hold them. They are computed
// at each read. A cache keyed on the angular unit and the precision saved at
// most 15% on a probe made for it, below the ratio of 1.5 that a cache must
// reach to be kept, and each cache of evaluated values must follow the store
// rules of `boxed-expression/store-guard.ts`
// (`docs/plans/2026-10-30-evaluation-cache-architecture.md`, section 3.5 and
// decision 1).

//
// The endpoint classes
//

/**
 * The class of the endpoint `x` (see the overview above): `1` for a real
 * number literal (an infinity included), `2` for an exact closed constant
 * whose numeric value is known, `3` for anything else.
 */
function endpointClass(x: Expression): 1 | 2 | 3 {
  if (isNumber(x)) return x.isNaN === true || x.isComplex ? 3 : 1;
  return decodeConstantClass(x);
}

/** `endpointClass()` of an expression that is not a number literal. It
 * approximates the expression, so the result depends on the angular unit and
 * the precision. */
function decodeConstantClass(x: Expression): 2 | 3 {
  if (!isExactConstantExpression(x) || !x.type.matches('real')) return 3;
  const v = x.N();
  return isNumber(v) && !v.isComplex && v.isNaN !== true ? 2 : 3;
}

/** True when the endpoint `x` (class 1 or 2) is a float literal. */
function isInexactEndpoint(x: Expression): boolean {
  return isNumber(x) && x.isFinite === true && !x.isExact;
}

/** True when the endpoint `x` is exact: class 2, or a class 1 literal that
 * is exact or infinite. */
function isExactEndpoint(x: Expression): boolean {
  const c = endpointClass(x);
  return c === 2 || (c === 1 && !isInexactEndpoint(x));
}

/** `+1` for `+oo`, `-1` for `-oo`, `0` for anything else. */
function infinitySign(x: Expression): -1 | 0 | 1 {
  if (!isNumber(x) || x.isFinite !== false || x.isNaN === true) return 0;
  if (x.isComplex) return 0;
  return x.re > 0 ? 1 : -1;
}

//
// Exact rationals and the outward conversion to doubles
//

/** An exact rational `[numerator, denominator]`, with a positive
 * denominator. */
type Rational = readonly [bigint, bigint];

function compareRationals(a: Rational, b: Rational): -1 | 0 | 1 {
  const l = a[0] * b[1];
  const r = b[0] * a[1];
  return l < r ? -1 : l > r ? 1 : 0;
}

/** The exact value of the finite double `d`. */
function rationalOfDouble(d: number): Rational {
  if (d === 0) return [0n, 1n];
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, d);
  const bits = view.getBigUint64(0);
  const negative = bits >> 63n === 1n;
  const biased = Number((bits >> 52n) & 0x7ffn);
  let mantissa = bits & 0xfffffffffffffn;
  let exponent: number;
  if (biased === 0) exponent = -1074;
  else {
    mantissa |= 1n << 52n;
    exponent = biased - 1075;
  }
  const num = negative ? -mantissa : mantissa;
  return exponent >= 0
    ? [num << BigInt(exponent), 1n]
    : [num, 1n << BigInt(-exponent)];
}

/** The value of a decimal string (`"0.1"`, `"-2.5e-20"`), or `undefined`. */
function rationalOfDecimalString(s: string): Rational | undefined {
  const m = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s.trim());
  if (m === null) return undefined;
  const fraction = m[3] ?? '';
  let num = BigInt(m[2] + fraction);
  if (m[1] === '-') num = -num;
  const exponent = Number(m[4] ?? '0') - fraction.length;
  return exponent >= 0
    ? [num * 10n ** BigInt(exponent), 1n]
    : [num, 10n ** BigInt(-exponent)];
}

/**
 * The exact value of the finite real number literal `x`, or `undefined` for
 * a literal that is not a rational (`√2`). A float is read as the decimal
 * number it is written as: the literal `0.1` is the rational `1/10`, not the
 * double nearest to it. A machine double (a `MachineNumericValue`, which
 * the library route of the hooks makes, `boxDouble()`) is that double.
 */
function rationalOfLiteral(x: Expression): Rational | undefined {
  if (!isNumber(x) || x.isComplex || x.isFinite !== true) return undefined;
  const r = asRational(x);
  if (r !== undefined) return [BigInt(r[0]), BigInt(r[1])];
  const v = x.numericValue;
  if (typeof v === 'number') return rationalOfDecimalString(String(v));
  if (v instanceof MachineNumericValue) return rationalOfDouble(v.re);
  if (v.isExact) return undefined;
  const big = v.bignumRe;
  if (big !== undefined)
    return big.exponent >= 0
      ? [big.significand * 10n ** BigInt(big.exponent), 1n]
      : [big.significand, 10n ** BigInt(-big.exponent)];
  return rationalOfDecimalString(String(v.re));
}

/**
 * The doubles `[down, up]` around the finite rational `q`: the largest double
 * that is not above `q` and the smallest double that is not below it. They
 * are equal when `q` is a double. `guess` is a double near `q`.
 */
function outwardOfRational(q: Rational, guess: number): [number, number] {
  let d = guess;
  if (!Number.isFinite(d)) d = Number(q[0]) / Number(q[1]);
  if (!Number.isFinite(d) || Number.isNaN(d))
    return q[0] > 0n
      ? [Number.MAX_VALUE, Infinity]
      : [-Infinity, -Number.MAX_VALUE];
  let lo = d;
  for (
    let i = 0;
    i < 64 &&
    Number.isFinite(lo) &&
    compareRationals(rationalOfDouble(lo), q) > 0;
    i++
  )
    lo = nextDown(lo);
  let hi = d;
  for (
    let i = 0;
    i < 64 &&
    Number.isFinite(hi) &&
    compareRationals(rationalOfDouble(hi), q) < 0;
    i++
  )
    hi = nextUp(hi);
  return [lo, hi];
}

/**
 * The doubles `[down, up]` around the value of the exact constant `x`
 * (class 2, or an exact literal that is not a rational, `√2`). `d` is the
 * double of its numeric value. The direction of `d` from the true value is
 * decided by the engine's exact comparison (`exactConstantOrder()`); the far
 * bound is checked the same way, and moved again when it is not decided.
 * When the direction is not decided, both bounds move one double outward.
 */
function outwardOfConstant(x: Expression, d: number): [number, number] {
  if (Number.isNaN(d)) return [-Infinity, Infinity];
  if (!Number.isFinite(d))
    return d > 0
      ? [Number.MAX_VALUE, Infinity]
      : [-Infinity, -Number.MAX_VALUE];
  const ce = x.engine;
  const order = (y: number): -1 | 0 | 1 | undefined =>
    exactConstantOrder(x, ce.number(rationalOfDouble(y) as [bigint, bigint]));
  const o = order(d);
  if (o === 1) {
    let hi = nextUp(d);
    for (let i = 0; i < 4 && order(hi) !== -1; i++) hi = nextUp(hi);
    return [d, hi];
  }
  if (o === -1) {
    let lo = nextDown(d);
    for (let i = 0; i < 4 && order(lo) !== 1; i++) lo = nextDown(lo);
    return [lo, d];
  }
  return [nextDown(d), nextUp(d)];
}

/** `outwardDoubles()` of an endpoint. */
function decodeOutward(x: Expression): readonly [number, number] {
  if (isNumber(x)) {
    if (x.isNaN === true || x.isComplex) return [-Infinity, Infinity];
    if (x.isFinite === false) return [x.re, x.re];
    const q = rationalOfLiteral(x);
    if (q !== undefined) return outwardOfRational(q, x.re);
    return outwardOfConstant(x, x.re);
  }
  return outwardOfConstant(x, x.N().re);
}

/**
 * The OUTWARD conversion of the endpoint `x` (class 1 or 2) to doubles: the
 * largest double that is not above its value and the smallest double that is
 * not below it. `Pi` gives `[3.141592653589793, 3.1415926535897936]`, the
 * decimal literal `0.1` gives `[0.09999999999999999, 0.1]` (the double
 * nearest to `0.1` is above it), and a value that is a double gives that
 * double twice. This is the conversion of the compiled `value` of a literal
 * enclosure too.
 */
export function outwardDoubles(x: Expression): readonly [number, number] {
  return decodeOutward(x);
}

/** The doubles of the range `r`, outward: `[min(down), max(up)]` of its two
 * endpoints, which is `[down(lo), up(hi)]` for an ordered range. */
function doublesOf(r: Range): Interval {
  const a = outwardDoubles(r.lo);
  const b = outwardDoubles(r.hi);
  return { lo: Math.min(a[0], b[0]), hi: Math.max(a[1], b[1]) };
}

//
// The order of two endpoints
//

/**
 * The order of the endpoints `x` and `y` (class 1 or 2), or `undefined` when
 * it is not decided. Two number literals are compared exactly
 * (`exactCompareNumbers()`, a float as the rational it holds); two exact
 * values by the engine's exact comparison (`exactConstantOrder()`), where a
 * tie of two values that are not identical (two values closer than the
 * working precision) is not decided; a float and an exact constant by their
 * outward doubles.
 */
function endpointOrder(x: Expression, y: Expression): -1 | 0 | 1 | undefined {
  if (x === y || x.isSame(y)) return 0;
  const xi = infinitySign(x);
  const yi = infinitySign(y);
  if (xi !== 0 || yi !== 0) return xi === yi ? 0 : xi < yi ? -1 : 1;
  if (isNumber(x) && isNumber(y)) return exactCompareNumbers(x, y);
  if (isExactEndpoint(x) && isExactEndpoint(y)) {
    const o = exactConstantOrder(x, y);
    return o === 0 ? undefined : o;
  }
  const a = outwardDoubles(x);
  const b = outwardDoubles(y);
  if (a[1] < b[0]) return -1;
  if (a[0] > b[1]) return 1;
  return undefined;
}

/** True when `x < y` is known, from the exact order or, when it is not
 * decided, from the outward doubles. */
function strictlyLess(x: Expression, y: Expression): boolean {
  const o = endpointOrder(x, y);
  if (o !== undefined) return o < 0;
  return outwardDoubles(x)[1] < outwardDoubles(y)[0];
}

//
// Reading the operands
//

/** The range of the enclosure `x`, or `undefined` when an endpoint is of
 * class 3. */
function decodeEnclosure(x: Expression): Range | undefined {
  if (!isFunction(x) || x.nops !== 2) return undefined;
  const [a, b] = x.ops;
  if (endpointClass(a) === 3 || endpointClass(b) === 3) return undefined;
  if (a.isNaN === true || b.isNaN === true) return undefined;
  const exact = isExactEndpoint(a) && isExactEndpoint(b);
  const o = endpointOrder(a, b);
  if (o === undefined) return { lo: a, hi: b, exact, ordered: false };
  return o <= 0
    ? { lo: a, hi: b, exact, ordered: true }
    : { lo: b, hi: a, exact, ordered: true };
}

export function enclosureRange(x: Expression): Range | undefined {
  return decodeEnclosure(x);
}

/** The point range `[x, x]` of the endpoint `x`. */
function pointRange(x: Expression): Range {
  return { lo: x, hi: x, exact: isExactEndpoint(x), ordered: true };
}

/**
 * The range of an operand of a hook: an enclosure (whose endpoints are of
 * class 1 or 2), or a finite real number of class 1 or 2 read as a point;
 * `INFINITE` for `+oo` and `-oo`; `undefined` for anything else (a complex
 * number, a symbol, a value of another kind, an enclosure with a class 3
 * endpoint). Under `.N()`, a number operand is read from its exact value
 * (`exact()`), so that the compiled code and the interpreter convert the
 * same value: `1/3` and not the float `0.333…`.
 */
function operandRange(
  x: Expression,
  exact: () => Expression,
  numericApproximation: boolean
): Range | typeof INFINITE | undefined {
  if (isEnclosure(x)) return enclosureRange(x);
  let p = x;
  if (numericApproximation) {
    const e = exact();
    if (isNumber(e) || endpointClass(e) === 2) p = e;
  }
  if (isNumber(p)) {
    if (p.isNaN === true || p.isComplex) return undefined;
    if (p.isFinite === false) return INFINITE;
    return pointRange(p);
  }
  return endpointClass(p) === 2 ? pointRange(p) : undefined;
}

/**
 * The range of an operand of `compare`, `eq` and `extremum`: as
 * `operandRange()`, with an infinite number read as the point `[±oo, ±oo]`.
 */
function comparisonRange(x: Expression): Range | undefined {
  if (isEnclosure(x)) return enclosureRange(x);
  if (isNumber(x)) {
    if (x.isNaN === true || x.isComplex) return undefined;
    return pointRange(x);
  }
  return endpointClass(x) === 2 ? pointRange(x) : undefined;
}

export function isPointRange(r: Range): boolean {
  return r.lo === r.hi || endpointOrder(r.lo, r.hi) === 0;
}

//
// The results
//

/** Thrown by the exact route when an order that it needs is not decided:
 * the hook then gives the answer of the library (the float route). */
const UNDECIDED = { undecided: true };

function undecided(): never {
  throw UNDECIDED;
}

/**
 * The expression of the double `d`, an endpoint computed by the interval
 * library or by the outward conversion. It is a MACHINE double whatever the
 * precision of the engine (the library works on doubles): a float literal of
 * the engine holds a decimal, whose value is not `d` (the shortest decimal
 * of `0.3333333333333333` is below that double), and reading it again would
 * move the endpoint outward a second time.
 */
function boxDouble(ce: ComputeEngine, d: number): Expression {
  if (d === Infinity) return ce.PositiveInfinity;
  if (d === -Infinity) return ce.NegativeInfinity;
  return ce.number(new MachineNumericValue(d === 0 ? 0 : d));
}

const WHOLE_LINE: Interval = { lo: -Infinity, hi: Infinity };

/** The enclosure `[lo, hi]` of two exact endpoints; the indeterminate value
 * for an infinite singleton (`[+oo, +oo]`). */
function exactEnclosure(
  ce: ComputeEngine,
  lo: Expression,
  hi: Expression,
  nan: () => Expression
): Expression {
  const s = infinitySign(lo);
  if (s !== 0 && s === infinitySign(hi)) return nan();
  return ce._fn('Enclosure', [lo, hi]);
}

/** The enclosure of the doubles `v`; the indeterminate value for a `NaN`
 * endpoint or an infinite singleton. */
function fromInterval(
  ce: ComputeEngine,
  v: Interval,
  nan: () => Expression
): Expression {
  if (Number.isNaN(v.lo) || Number.isNaN(v.hi)) return nan();
  if (v.lo === v.hi && !Number.isFinite(v.lo)) return nan();
  if (v.lo > v.hi) return nan();
  return ce._fn('Enclosure', [boxDouble(ce, v.lo), boxDouble(ce, v.hi)]);
}

/**
 * The enclosure of a result of the interval library:
 * - `interval` and `partial` (the domain was clipped): the value
 *   (`Sqrt(Enclosure(-1, 4))` is `Enclosure(0, 2)`);
 * - `singular` with a `value` (a finite jump inside: `Floor`, `Sign`): that
 *   value;
 * - `singular` with no value (a pole inside) and `entire`: the whole line;
 * - `empty`: the indeterminate value.
 */
function fromResult(
  ce: ComputeEngine,
  r: IntervalResult | Interval,
  nan: () => Expression
): Expression {
  if (!('kind' in r)) return fromInterval(ce, r, nan);
  switch (r.kind) {
    case 'interval':
    case 'partial':
      return fromInterval(ce, r.value, nan);
    case 'singular':
      return fromInterval(ce, r.value ?? WHOLE_LINE, nan);
    case 'entire':
      return fromInterval(ce, WHOLE_LINE, nan);
    case 'empty':
      return nan();
  }
}

/** The indeterminate value of a hook: `Indeterminate` under `evaluate()`
 * with exact operands, `NaN` under `.N()` or with a float operand (the
 * exact-twin rule of `NaN`). */
function indeterminate(
  ce: ComputeEngine,
  numericApproximation: boolean,
  ranges: ReadonlyArray<Range>
): () => Expression {
  return () =>
    numericApproximation || ranges.some((r) => !r.exact)
      ? ce.NaN
      : ce.Indeterminate;
}

/**
 * The value of a hook by the exact route when it applies (no `.N()`, every
 * range exact and ordered, and every order it needs decided), else by the
 * library over the outward doubles of the ranges.
 */
function compute(
  ranges: ReadonlyArray<Range>,
  numericApproximation: boolean,
  exact: () => Expression,
  numeric: (xs: Interval[]) => Expression
): Expression {
  if (!numericApproximation && ranges.every((r) => r.exact && r.ordered)) {
    try {
      return exact();
    } catch (e) {
      if (e !== UNDECIDED) throw e;
    }
  }
  return numeric(ranges.map(doublesOf));
}

//
// The exact route
//

/** `operator(...args)` evaluated; undecided when the value is not an
 * endpoint of class 1 or 2. */
function ev(
  ce: ComputeEngine,
  operator: string,
  args: ReadonlyArray<Expression>
): Expression {
  const v = ce.function(operator, [...args]).evaluate();
  if (endpointClass(v) === 3) undecided();
  return v;
}

function isZero(x: Expression): boolean {
  return isNumber(x) && x.isExact && x.isSame(0);
}

/** The order of `x` and `y`; undecided when it is not known. */
function order(x: Expression, y: Expression): -1 | 0 | 1 {
  return endpointOrder(x, y) ?? undecided();
}

function exactMin(xs: ReadonlyArray<Expression>): Expression {
  let m = xs[0];
  for (const x of xs.slice(1)) if (order(x, m) < 0) m = x;
  return m;
}

function exactMax(xs: ReadonlyArray<Expression>): Expression {
  let m = xs[0];
  for (const x of xs.slice(1)) if (order(x, m) > 0) m = x;
  return m;
}

/** The product of two endpoints, with `0 · ±oo` read as `0` (the
 * convention of the interval library). */
function product(ce: ComputeEngine, x: Expression, y: Expression): Expression {
  if (isZero(x) || isZero(y)) return ce.Zero;
  return ev(ce, 'Multiply', [x, y]);
}

/** The exact product of two ranges: `[min, max]` of the four products. */
function exactProduct(ce: ComputeEngine, x: Range, y: Range): Range {
  const ps = [
    product(ce, x.lo, y.lo),
    product(ce, x.lo, y.hi),
    product(ce, x.hi, y.lo),
    product(ce, x.hi, y.hi),
  ];
  return { lo: exactMin(ps), hi: exactMax(ps), exact: true, ordered: true };
}

/**
 * The exact reciprocal of the range `y`: `[1/d, 1/c]` when `0` is not in
 * `[c, d]`; a half-line for a zero endpoint (`1 / [0, d]` is `[1/d, +oo]`);
 * `'hull'` when `0` is inside; `'empty'` for `[0, 0]`.
 */
function exactReciprocal(
  ce: ComputeEngine,
  y: Range
): Range | 'hull' | 'empty' {
  const c = order(y.lo, ce.Zero);
  const d = order(y.hi, ce.Zero);
  if (c === 0 && d === 0) return 'empty';
  const inv = (v: Expression): Expression =>
    infinitySign(v) !== 0 ? ce.Zero : ev(ce, 'Divide', [ce.One, v]);
  if (c > 0 || d < 0)
    return { lo: inv(y.hi), hi: inv(y.lo), exact: true, ordered: true };
  if (c === 0)
    return {
      lo: inv(y.hi),
      hi: ce.PositiveInfinity,
      exact: true,
      ordered: true,
    };
  if (d === 0)
    return {
      lo: ce.NegativeInfinity,
      hi: inv(y.lo),
      exact: true,
      ordered: true,
    };
  return 'hull';
}

/** The exact quotient `x / y` by the `divide` rule. */
function exactQuotient(
  ce: ComputeEngine,
  x: Range,
  y: Range,
  nan: () => Expression
): Expression {
  const r = exactReciprocal(ce, y);
  if (r === 'empty') return nan();
  if (r === 'hull')
    return ce._fn('Enclosure', [ce.NegativeInfinity, ce.PositiveInfinity]);
  const p = exactProduct(ce, x, r);
  return exactEnclosure(ce, p.lo, p.hi, nan);
}

/** The range `[|lo|, |hi|]` sorted, with `0` when the range holds `0`. */
function exactAbs(ce: ComputeEngine, r: Range): Range {
  const a = order(r.lo, ce.Zero);
  const b = order(r.hi, ce.Zero);
  if (a >= 0) return r;
  const neg = (v: Expression): Expression => ev(ce, 'Negate', [v]);
  if (b <= 0)
    return { lo: neg(r.hi), hi: neg(r.lo), exact: true, ordered: true };
  return {
    lo: ce.Zero,
    hi: exactMax([neg(r.lo), r.hi]),
    exact: true,
    ordered: true,
  };
}

//
// `add`, `multiply`, `negate`, `divide`
//

/** The operands that a sum or a product folds: the enclosures and the
 * points, with the indices of the operands. */
function foldableOperands(
  ops: KindOperands,
  numericApproximation: boolean
): { indices: number[]; ranges: Range[]; infinite: boolean } | undefined {
  const indices: number[] = [];
  const ranges: Range[] = [];
  let infinite = false;
  let enclosures = 0;
  ops.evaluated.forEach((x, i) => {
    const r = operandRange(x, () => ops.exact(i), numericApproximation);
    if (r === undefined) return;
    indices.push(i);
    if (r === INFINITE) {
      infinite = true;
      return;
    }
    ranges.push(r);
    if (isEnclosure(x)) enclosures += 1;
  });
  if (enclosures === 0 || indices.length < 2) return undefined;
  return { indices, ranges, infinite };
}

function sumFolds(
  ops: KindOperands,
  { engine: ce, numericApproximation }: ArithmeticContext
): ReadonlyArray<KindFold> | undefined {
  const operands = foldableOperands(ops, numericApproximation);
  if (operands === undefined) return undefined;
  const { indices, ranges, infinite } = operands;
  const nan = indeterminate(ce, numericApproximation, ranges);
  // `x + (±oo)` would be an infinite singleton, which is no enclosure.
  if (infinite) return [{ value: nan(), operands: indices }];
  const value = compute(
    ranges,
    numericApproximation,
    () =>
      exactEnclosure(
        ce,
        ev(
          ce,
          'Add',
          ranges.map((r) => r.lo)
        ),
        ev(
          ce,
          'Add',
          ranges.map((r) => r.hi)
        ),
        nan
      ),
    (xs) =>
      fromResult(
        ce,
        xs
          .slice(1)
          .reduce<Interval | IntervalResult>((acc, x) => IA.add(acc, x), xs[0]),
        nan
      )
  );
  return [{ value, operands: indices }];
}

function productFolds(
  ops: KindOperands,
  { engine: ce, numericApproximation }: ArithmeticContext
): ReadonlyArray<KindFold> | undefined {
  const operands = foldableOperands(ops, numericApproximation);
  if (operands === undefined) return undefined;
  const { indices, ranges, infinite } = operands;
  const nan = indeterminate(ce, numericApproximation, ranges);
  if (infinite) return [{ value: nan(), operands: indices }];
  const value = compute(
    ranges,
    numericApproximation,
    () => {
      const p = ranges
        .slice(1)
        .reduce((acc, r) => exactProduct(ce, acc, r), ranges[0]);
      return exactEnclosure(ce, p.lo, p.hi, nan);
    },
    (xs) =>
      fromResult(
        ce,
        xs
          .slice(1)
          .reduce<Interval | IntervalResult>((acc, x) => IA.mul(acc, x), xs[0]),
        nan
      )
  );
  return [{ value, operands: indices }];
}

function negateHook(
  x: KindOperand,
  { engine: ce, numericApproximation }: ArithmeticContext
): Expression | undefined {
  if (!isEnclosure(x.evaluated)) return undefined;
  const r = enclosureRange(x.evaluated);
  if (r === undefined) return undefined;
  const nan = indeterminate(ce, numericApproximation, [r]);
  return compute(
    [r],
    numericApproximation,
    () =>
      exactEnclosure(
        ce,
        ev(ce, 'Negate', [r.hi]),
        ev(ce, 'Negate', [r.lo]),
        nan
      ),
    ([v]) => fromResult(ce, IA.negate(v), nan)
  );
}

/** The two operands of a binary hook as ranges, or `undefined`. */
function binaryRanges(
  a: KindOperand,
  b: KindOperand,
  numericApproximation: boolean
): [Range | typeof INFINITE, Range | typeof INFINITE] | undefined {
  const x = operandRange(a.evaluated, a.exact, numericApproximation);
  const y = operandRange(b.evaluated, b.exact, numericApproximation);
  if (x === undefined || y === undefined) return undefined;
  return [x, y];
}

function divideHook(
  a: KindOperand,
  b: KindOperand,
  { engine: ce, numericApproximation }: ArithmeticContext
): Expression | undefined {
  const operands = binaryRanges(a, b, numericApproximation);
  if (operands === undefined) return undefined;
  const [x, y] = operands;
  const ranges = [x, y].filter((r): r is Range => r !== INFINITE);
  const nan = indeterminate(ce, numericApproximation, ranges);
  if (x === INFINITE || y === INFINITE) return nan();
  return compute(
    [x, y],
    numericApproximation,
    () => exactQuotient(ce, x, y, nan),
    ([u, v]) =>
      // The quotient by the point zero has no value (the image of `1/x` over
      // `{0}` is empty), whatever the library answers for it.
      v.lo === 0 && v.hi === 0 ? nan() : fromResult(ce, IA.div(u, v), nan)
  );
}

//
// `power`
//

/** The exponent as the hooks read it: an integer, a rational `p/q` in lowest
 * terms, a float, or an exact constant. */
export type ExponentForm =
  | { kind: 'integer'; n: bigint; exact: boolean }
  | { kind: 'rational'; p: bigint; q: bigint }
  | { kind: 'float'; value: number }
  | { kind: 'constant'; value: Expression };

export function exponentForm(e: Expression): ExponentForm | undefined {
  if (isNumber(e)) {
    if (e.isComplex || e.isNaN === true || e.isFinite !== true)
      return undefined;
    if (e.isExact) {
      const r = asRational(e);
      if (r === undefined) return { kind: 'constant', value: e };
      const p = BigInt(r[0]);
      const q = BigInt(r[1]);
      return q === 1n
        ? { kind: 'integer', n: p, exact: true }
        : { kind: 'rational', p, q };
    }
    const v = e.re;
    if (Number.isInteger(v))
      return { kind: 'integer', n: BigInt(v), exact: false };
    return { kind: 'float', value: v };
  }
  return endpointClass(e) === 2 ? { kind: 'constant', value: e } : undefined;
}

export function isSafe(n: bigint): boolean {
  return (
    n <= BigInt(Number.MAX_SAFE_INTEGER) &&
    n >= -BigInt(Number.MAX_SAFE_INTEGER)
  );
}

/** The exact power of the range `x` to the integer `n` (the rule of the
 * `power` hook for an integer exponent). */
function exactIntegerPower(
  ce: ComputeEngine,
  x: Range,
  n: bigint,
  nan: () => Expression
): Expression {
  if (n === 0n) return ce._fn('Enclosure', [ce.One, ce.One]);
  if (n < 0n) {
    const one = pointRange(ce.One);
    const p = exactIntegerPowerRange(ce, x, -n);
    return exactQuotient(ce, one, p, nan);
  }
  const p = exactIntegerPowerRange(ce, x, n);
  return exactEnclosure(ce, p.lo, p.hi, nan);
}

/** The range of `x^n` for an integer `n > 0`. */
function exactIntegerPowerRange(ce: ComputeEngine, x: Range, n: bigint): Range {
  const odd = n % 2n === 1n;
  const pow = (v: Expression): Expression => {
    if (infinitySign(v) !== 0) return odd ? v : ce.PositiveInfinity;
    // `0`, `1` and `-1` are read without the engine, which leaves
    // `(-1)^n` unevaluated for an `n` beyond the safe integers.
    if (isZero(v) || (isNumber(v) && v.isExact && v.isSame(1))) return v;
    if (isNumber(v) && v.isExact && v.isSame(-1)) return odd ? v : ce.One;
    return ev(ce, 'Power', [v, ce.number(n)]);
  };
  if (odd) return { lo: pow(x.lo), hi: pow(x.hi), exact: true, ordered: true };
  const a = exactAbs(ce, x);
  return { lo: pow(a.lo), hi: pow(a.hi), exact: true, ordered: true };
}

/** The exact power of the range `x` to the real exponent `r` when the base
 * is clipped to `[0, +oo)` (an exponent that is not read as a rational with
 * an odd denominator). */
function exactClippedPower(
  ce: ComputeEngine,
  x: Range,
  r: Expression,
  nan: () => Expression
): Expression {
  if (order(x.hi, ce.Zero) < 0) return nan();
  const lo = order(x.lo, ce.Zero) < 0 ? ce.Zero : x.lo;
  const positive = order(r, ce.Zero) > 0;
  const pow = (v: Expression): Expression => {
    if (isZero(v)) return positive ? ce.Zero : ce.PositiveInfinity;
    if (infinitySign(v) > 0) return positive ? ce.PositiveInfinity : ce.Zero;
    return ev(ce, 'Power', [v, r]);
  };
  return positive
    ? exactEnclosure(ce, pow(lo), pow(x.hi), nan)
    : exactEnclosure(ce, pow(x.hi), pow(lo), nan);
}

/** The power of the range `x` (an enclosure or a point) to the point
 * exponent `e`. `undefined` leaves the call unevaluated. */
function powerByPoint(
  ce: ComputeEngine,
  base: Expression,
  x: Range,
  e: Expression,
  numericApproximation: boolean
): Expression | undefined {
  const form = exponentForm(e);
  if (form === undefined) return undefined;
  const nan = indeterminate(ce, numericApproximation || isInexactEndpoint(e), [
    x,
  ]);
  const exactExponent =
    form.kind === 'integer' ? form.exact : form.kind !== 'float';
  // A power of `e` (what `Exp(x)` canonicalizes to) uses `exp` on both
  // routes.
  if (isSymbol(base, 'ExponentialE')) {
    const y = pointRange(e);
    return compute(
      [y],
      numericApproximation || !exactExponent,
      () => exactEnclosure(ce, ev(ce, 'Exp', [e]), ev(ce, 'Exp', [e]), nan),
      ([v]) => fromResult(ce, IA.exp(v), nan)
    );
  }
  const exact = (fn: () => Expression) =>
    compute([x], numericApproximation || !exactExponent, fn, ([v]) =>
      numericPower(ce, v, form, nan)
    );
  switch (form.kind) {
    case 'integer':
      // An exponent beyond the safe integers is decided exactly (its parity
      // is known), but the kernels take a double, which loses the parity:
      // the call stays unevaluated under `.N()` and with a float.
      if (!isSafe(form.n) && (numericApproximation || !x.exact || !x.ordered))
        return undefined;
      return exact(() => exactIntegerPower(ce, x, form.n, nan));
    case 'rational': {
      if (form.q % 2n === 1n) {
        // The real branch: the odd root, then the integer power.
        return exact(() => {
          const q = ce.number(form.q);
          const root = (v: Expression): Expression =>
            infinitySign(v) !== 0 ? v : ev(ce, 'Root', [v, q]);
          const r: Range = {
            lo: root(x.lo),
            hi: root(x.hi),
            exact: true,
            ordered: true,
          };
          return exactIntegerPower(ce, r, form.p, nan);
        });
      }
      return exact(() => exactClippedPower(ce, x, e, nan));
    }
    case 'float':
      return compute([x], true, undecided, ([v]) =>
        numericPower(ce, v, form, nan)
      );
    case 'constant':
      return exact(() => exactClippedPower(ce, x, form.value, nan));
  }
}

/**
 * The power of the doubles `v` to a point exponent, one kernel for each
 * form of the exponent (the table of `docs/plans/2026-10-26-value-kinds.md`,
 * section 4.9.2, which is the selection of the `interval-js` target): `2` →
 * `square`; `1/2` → `sqrt`; another integer → `pow`; `p/q` with `q` odd →
 * `powRational`; a float that is the double nearest to such a `p/q` →
 * `powRational`, a float near one but not equal to its double →
 * `powRealBranch` with the float, any other float → `pow`.
 */
function numericPower(
  ce: ComputeEngine,
  v: Interval,
  form: ExponentForm,
  nan: () => Expression
): Expression {
  const result = (r: IntervalResult): Expression => fromResult(ce, r, nan);
  switch (form.kind) {
    case 'integer': {
      if (!isSafe(form.n)) return nan();
      const n = Number(form.n);
      if (n === 2) return result(IA.square(v));
      // A negative power is the reciprocal of the positive power, by the
      // `divide` rule, computed here rather than by the library's `pow` with
      // a negative exponent: that kernel rounded an intermediate before the
      // reciprocal, which could exclude the true value, and answered the
      // whole line over a base with a zero endpoint, where `1 / [0, 1]^1` is
      // `[1, +oo]` (both fixed in the library on 2026-10-26, formerly
      // ROADMAP CE-522.7 and CE-522.4; the composition stays so that the
      // compiled route, which emits the same one, agrees with this one).
      if (n < 0) {
        if (v.lo === 0 && v.hi === 0) return nan();
        const positive = n === -2 ? IA.square(v) : IA.pow(v, -n);
        return result(IA.div(IA.point(1), positive));
      }
      return result(IA.pow(v, n));
    }
    case 'rational': {
      if (form.p === 1n && form.q === 2n) return result(IA.sqrt(v));
      if (form.q % 2n === 1n && isSafe(form.p) && isSafe(form.q))
        return result(IA.powRational(v, Number(form.p), Number(form.q)));
      return result(IA.pow(v, Number(form.p) / Number(form.q)));
    }
    case 'float': {
      const value = form.value;
      if (value === 0.5) return result(IA.sqrt(v));
      const terms = realPowerBranchTerms(undefined, value);
      if (terms !== undefined && terms[1] % 2 !== 0) {
        const [p, q] = terms;
        return p / q === value
          ? result(IA.powRational(v, p, q))
          : result(IA.powRealBranch(v, value, p % 2 !== 0));
      }
      return result(IA.pow(v, value));
    }
    case 'constant':
      return result(IA.pow(v, form.value.N().re));
  }
}

/** True when the base `b` of a power is `e` (`ExponentialE`, what `Exp(x)`
 * canonicalizes to). Under `.N()` the evaluated base is the float of `e`,
 * so the base as written is read too. */
function isEulerBase(b: KindOperand): boolean {
  return (
    isSymbol(b.evaluated, 'ExponentialE') || isSymbol(b.written, 'ExponentialE')
  );
}

/** The power of the base `b` to the enclosure exponent `y` (not a point).
 * `undefined` when the base is not provably positive. */
function powerByEnclosure(
  ce: ComputeEngine,
  b: KindOperand,
  y: Range,
  numericApproximation: boolean
): Expression | undefined {
  const base = b.evaluated;
  if (isEulerBase(b)) {
    const nan = indeterminate(ce, numericApproximation, [y]);
    return compute(
      [y],
      numericApproximation,
      () =>
        exactEnclosure(ce, ev(ce, 'Exp', [y.lo]), ev(ce, 'Exp', [y.hi]), nan),
      ([v]) => fromResult(ce, IA.exp(v), nan)
    );
  }
  const x = operandRange(base, b.exact, numericApproximation);
  if (x === undefined) return undefined;
  const nan = indeterminate(
    ce,
    numericApproximation,
    x === INFINITE ? [y] : [x, y]
  );
  if (x === INFINITE) return nan();
  // The base must be provably positive: a negative base with a non-point
  // exponent has no real-branch rule here, and the call stays unevaluated,
  // under `.N()` too.
  const sign = endpointOrder(x.lo, ce.Zero);
  if (sign === undefined ? !(doublesOf(x).lo > 0) : sign <= 0) return undefined;
  return compute(
    [x, y],
    numericApproximation,
    () => {
      const pow = (u: Expression, v: Expression): Expression =>
        ev(ce, 'Power', [u, v]);
      if (isPointRange(x)) {
        const o = order(x.lo, ce.One);
        if (o === 0) return ce._fn('Enclosure', [ce.One, ce.One]);
        const a = pow(x.lo, y.lo);
        const c = pow(x.lo, y.hi);
        return o > 0
          ? exactEnclosure(ce, a, c, nan)
          : exactEnclosure(ce, c, a, nan);
      }
      const corners = [
        pow(x.lo, y.lo),
        pow(x.lo, y.hi),
        pow(x.hi, y.lo),
        pow(x.hi, y.hi),
      ];
      return exactEnclosure(ce, exactMin(corners), exactMax(corners), nan);
    },
    ([u, v]) => fromResult(ce, IA.powInterval(u, v), nan)
  );
}

function powerHook(
  base: KindOperand,
  exponent: KindOperand,
  { engine: ce, numericApproximation }: ArithmeticContext
): Expression | undefined {
  const e = exponent.evaluated;
  if (isEnclosure(e)) {
    const y = enclosureRange(e);
    if (y === undefined) return undefined;
    // A point enclosure exponent is read as its point:
    // `(-2)^Enclosure(2, 2)` is `Enclosure(4, 4)`.
    if (!isPointRange(y))
      return powerByEnclosure(ce, base, y, numericApproximation);
    const x = operandRange(base.evaluated, base.exact, numericApproximation);
    if (x === undefined) return undefined;
    if (x === INFINITE) return indeterminate(ce, numericApproximation, [y])();
    return powerByPoint(
      ce,
      isEulerBase(base) ? ce.E : base.evaluated,
      x,
      y.lo,
      numericApproximation
    );
  }
  if (!isEnclosure(base.evaluated)) return undefined;
  const x = enclosureRange(base.evaluated);
  if (x === undefined) return undefined;
  // Under `.N()` the exponent is read exactly (`1/3` and not `0.333…`), so
  // that the kernel of its form is the one the compiled code uses.
  let point = e;
  if (numericApproximation) {
    const exact = exponent.exact();
    if (isNumber(exact) || endpointClass(exact) === 2) point = exact;
  }
  if (isNumber(point) && point.isFinite === false && point.isNaN !== true)
    return indeterminate(ce, numericApproximation, [x])();
  return powerByPoint(ce, base.evaluated, x, point, numericApproximation);
}

//
// `apply`: the image of a numeric function
//

/** The half turn in the engine's angular unit (`π` rad, `180` deg). */
function halfTurn(ce: ComputeEngine): Expression {
  return halfTurnAngle(ce);
}

/**
 * The doubles, in radians, of the range `r`, an angle in the engine's
 * angular unit. In radians, the outward doubles of the range. In another
 * unit, each endpoint is multiplied EXACTLY by the factor of the unit
 * (`π/180` in degrees; a float endpoint is read as the rational it is
 * written as), and the product is converted outward.
 */
function radiansOf(ce: ComputeEngine, r: Range): Interval {
  if (ce.angularUnit === 'rad') return doublesOf(r);
  const factor = ce.function('Divide', [ce.Pi, halfTurn(ce)]).evaluate();
  const convert = (x: Expression): readonly [number, number] => {
    if (infinitySign(x) !== 0) return outwardDoubles(x);
    const q = rationalOfLiteral(x);
    const exact =
      q !== undefined && isInexactEndpoint(x)
        ? ce.number(q as [bigint, bigint])
        : x;
    return outwardDoubles(ce.function('Multiply', [exact, factor]).evaluate());
  };
  const a = convert(r.lo);
  const b = convert(r.hi);
  return { lo: Math.min(a[0], b[0]), hi: Math.max(a[1], b[1]) };
}

/** The result `v` of an inverse trigonometric kernel (radians) as an
 * angle in the engine's unit: multiplied by the outward enclosure of the
 * factor `180/π` (in degrees). */
function angleFromRadians(
  ce: ComputeEngine,
  v: IntervalResult
): IntervalResult {
  if (ce.angularUnit === 'rad') return v;
  const factor = ce.function('Divide', [halfTurn(ce), ce.Pi]).evaluate();
  const [lo, hi] = outwardDoubles(factor);
  return IA.mul(v, { lo, hi });
}

/** The value of a kernel at the doubles of `r`, mapped. */
type Kernel = (x: Interval) => IntervalResult;

/**
 * The image of a monotone function `operator` on the range `r`, by the
 * exact route: the values at the endpoints, after the range is clipped to
 * the domain `[domainLo, domainHi]` of the function. `atLo` and `atHi` are
 * the values at the bounds of the domain when the engine does not give them
 * (`Ln` at `0` is `-oo`). A range entirely outside the domain, and an
 * infinite singleton image, are the indeterminate value.
 */
function exactMonotone(
  ce: ComputeEngine,
  r: Range,
  f: (x: Expression) => Expression,
  increasing: boolean,
  nan: () => Expression,
  domain?: {
    lo?: Expression;
    hi?: Expression;
    atLo?: Expression;
    atHi?: Expression;
  }
): Expression {
  let lo = r.lo;
  let hi = r.hi;
  let atLo: Expression | undefined;
  let atHi: Expression | undefined;
  if (domain?.lo !== undefined) {
    if (order(hi, domain.lo) < 0) return nan();
    if (order(lo, domain.lo) <= 0) {
      lo = domain.lo;
      atLo = domain.atLo;
    }
  }
  if (domain?.hi !== undefined) {
    if (order(lo, domain.hi) > 0) return nan();
    if (order(hi, domain.hi) >= 0) {
      hi = domain.hi;
      atHi = domain.atHi;
    }
  }
  // A range clipped to one bound of the domain is the value there.
  if (domain?.lo !== undefined && lo === domain.lo && order(hi, lo) === 0)
    atHi = atLo;
  if (domain?.hi !== undefined && hi === domain.hi && order(lo, hi) === 0)
    atLo = atHi;
  const fLo = atLo ?? f(lo);
  const fHi = atHi ?? f(hi);
  return increasing
    ? exactEnclosure(ce, fLo, fHi, nan)
    : exactEnclosure(ce, fHi, fLo, nan);
}

/** True when a periodic point `offset + k·period` is in the range `r`. */
function holdsPeriodicPoint(
  ce: ComputeEngine,
  r: Range,
  offset: Expression,
  period: Expression
): boolean {
  const p = periodicPointPosition(ce, r, offset, period);
  return p.inside || p.atLo || p.atHi;
}

/**
 * Where the periodic points `offset + k·period` (the critical points or the
 * poles of a trigonometric function, an angle in the engine's unit) are in
 * the range `r`: strictly inside, at its low end, at its high end. The
 * candidates `k` are read from the doubles of the range, and each one is
 * placed by the exact order (undecided when it is not known). A range wider
 * than a few periods is undecided: the callers answer it before.
 */
function periodicPointPosition(
  ce: ComputeEngine,
  r: Range,
  offset: Expression,
  period: Expression
): { inside: boolean; atLo: boolean; atHi: boolean } {
  const d = doublesOf(r);
  const off = offset.N().re;
  const per = period.N().re;
  const kLo = Math.floor((d.lo - off) / per) - 1;
  const kHi = Math.ceil((d.hi - off) / per) + 1;
  // Above `Number.MAX_SAFE_INTEGER` (a range near `10^20`), `k++` does not
  // change `k` and the loop below does not end: such a range is undecided.
  if (!Number.isSafeInteger(kLo) || !Number.isSafeInteger(kHi) || kHi - kLo > 8)
    undecided();
  const result = { inside: false, atLo: false, atHi: false };
  for (let k = kLo; k <= kHi; k++) {
    const c = ev(ce, 'Add', [
      offset,
      ev(ce, 'Multiply', [ce.number(k), period]),
    ]);
    const a = order(r.lo, c);
    const b = order(c, r.hi);
    if (a < 0 && b < 0) result.inside = true;
    if (a === 0) result.atLo = true;
    if (b === 0) result.atHi = true;
  }
  return result;
}

/** The exact image of `Sin` (`which` is `'Sin'`) or `Cos` on the range `r`,
 * an angle in the engine's unit: the values at the endpoints and at the
 * critical points inside, `[-1, 1]` for a range at least one period wide. */
function exactSinCos(
  ce: ComputeEngine,
  r: Range,
  which: 'Sin' | 'Cos',
  nan: () => Expression
): Expression {
  const T = halfTurn(ce);
  const full = (): Expression => ce._fn('Enclosure', [ce.NegativeOne, ce.One]);
  if (infinitySign(r.lo) !== 0 || infinitySign(r.hi) !== 0) return full();
  const period = ev(ce, 'Multiply', [ce.Two, T]);
  const width = ev(ce, 'Subtract', [r.hi, r.lo]);
  if (order(width, period) >= 0) return full();
  const fa = ev(ce, which, [r.lo]);
  const fb = ev(ce, which, [r.hi]);
  let lo = exactMin([fa, fb]);
  let hi = exactMax([fa, fb]);
  const half = ev(ce, 'Divide', [T, ce.Two]);
  // The maxima of `Sin` are at `T/2 + 2kT` and its minima at `-T/2 + 2kT`;
  // those of `Cos` at `2kT` and `T + 2kT`.
  const maxAt = which === 'Sin' ? half : ce.Zero;
  const minAt = which === 'Sin' ? ev(ce, 'Negate', [half]) : T;
  if (holdsPeriodicPoint(ce, r, maxAt, period)) hi = ce.One;
  if (holdsPeriodicPoint(ce, r, minAt, period)) lo = ce.NegativeOne;
  return exactEnclosure(ce, lo, hi, nan);
}

/** The exact image of `Tan` or `Cot`: monotone between the poles; a pole
 * inside gives the whole line, a pole at an endpoint a half-line. */
function exactTanCot(
  ce: ComputeEngine,
  r: Range,
  which: 'Tan' | 'Cot',
  nan: () => Expression
): Expression {
  const T = halfTurn(ce);
  const whole = (): Expression =>
    ce._fn('Enclosure', [ce.NegativeInfinity, ce.PositiveInfinity]);
  if (infinitySign(r.lo) !== 0 || infinitySign(r.hi) !== 0) return whole();
  const width = ev(ce, 'Subtract', [r.hi, r.lo]);
  if (order(width, T) >= 0) return whole();
  // The poles of `Tan` are at `T/2 + kT`, those of `Cot` at `kT`.
  const offset = which === 'Tan' ? ev(ce, 'Divide', [T, ce.Two]) : ce.Zero;
  const pole = periodicPointPosition(ce, r, offset, T);
  if (pole.inside) return whole();
  if (pole.atLo && pole.atHi) return nan();
  // `Tan` increases between its poles: `-oo` just after a pole, `+oo` just
  // before one. `Cot` decreases: `+oo` just after a pole, `-oo` just before.
  const f = (x: Expression): Expression => ev(ce, which, [x]);
  if (which === 'Tan') {
    const lo = pole.atLo ? ce.NegativeInfinity : f(r.lo);
    const hi = pole.atHi ? ce.PositiveInfinity : f(r.hi);
    return exactEnclosure(ce, lo, hi, nan);
  }
  const lo = pole.atHi ? ce.NegativeInfinity : f(r.hi);
  const hi = pole.atLo ? ce.PositiveInfinity : f(r.lo);
  return exactEnclosure(ce, lo, hi, nan);
}

/** The range of an enclosure value (an exact result of a hook). */
function rangeOfValue(x: Expression): Range | undefined {
  return isEnclosure(x) ? enclosureRange(x) : undefined;
}

/** The exact image of `Sec` or `Csc`: the reciprocal of the image of `Cos`
 * or `Sin` by the `divide` rule (a pole inside, where the image of `Cos`
 * holds `0` inside, gives the whole line). */
function exactSecCsc(
  ce: ComputeEngine,
  r: Range,
  which: 'Sec' | 'Csc',
  nan: () => Expression
): Expression {
  const image = rangeOfValue(
    exactSinCos(ce, r, which === 'Sec' ? 'Cos' : 'Sin', nan)
  );
  if (image === undefined) return nan();
  return exactQuotient(ce, pointRange(ce.One), image, nan);
}

/** The minimum of `Gamma` on `(0, +oo)`, at `x0 ≈ 1.4616321449683623`,
 * between these two doubles. */
const GAMMA_MIN_AT: readonly [number, number] = [
  1.4616321449683622, 1.4616321449683625,
];

/**
 * The exact image of `Gamma` on a range in `[0, +oo)`: decreasing on
 * `(0, x0]` and increasing on `[x0, +oo)`, with a pole at `0`. A range that
 * holds the minimum `x0`, whose value has no closed form, has the lower
 * endpoint of the library (a float). A range that reaches below `0` goes to
 * the library (undecided).
 */
function exactGamma(
  ce: ComputeEngine,
  r: Range,
  nan: () => Expression
): Expression {
  if (order(r.lo, ce.Zero) < 0) undecided();
  const f = (x: Expression): Expression =>
    isZero(x)
      ? ce.PositiveInfinity
      : infinitySign(x) > 0
        ? ce.PositiveInfinity
        : ev(ce, 'Gamma', [x]);
  const d = doublesOf(r);
  if (d.hi < GAMMA_MIN_AT[0]) return exactEnclosure(ce, f(r.hi), f(r.lo), nan);
  if (d.lo > GAMMA_MIN_AT[1]) return exactEnclosure(ce, f(r.lo), f(r.hi), nan);
  const library = IA.gamma(d);
  const value =
    'kind' in library
      ? library.kind === 'interval' || library.kind === 'partial'
        ? library.value
        : undefined
      : undefined;
  if (value === undefined) undecided();
  return exactEnclosure(
    ce,
    boxDouble(ce, value.lo),
    exactMax([f(r.lo), f(r.hi)]),
    nan
  );
}

/** The exact image of `Sign`, or of `Heaviside` (`which`), whose value at
 * zero is the engine's. */
function exactSignLike(
  ce: ComputeEngine,
  r: Range,
  which: 'Sign' | 'Heaviside',
  nan: () => Expression
): Expression {
  const a = order(r.lo, ce.Zero);
  const b = order(r.hi, ce.Zero);
  const neg = which === 'Sign' ? ce.NegativeOne : ce.Zero;
  const pos = ce.One;
  const atZero = ev(ce, which, [ce.Zero]);
  if (a > 0) return exactEnclosure(ce, pos, pos, nan);
  if (b < 0) return exactEnclosure(ce, neg, neg, nan);
  if (a === 0 && b === 0) return exactEnclosure(ce, atZero, atZero, nan);
  if (a === 0) return exactEnclosure(ce, atZero, pos, nan);
  if (b === 0) return exactEnclosure(ce, neg, atZero, nan);
  return exactEnclosure(ce, neg, pos, nan);
}

/** The exact image of `Cosh`: its minimum `1` is at `0`. */
function exactCosh(
  ce: ComputeEngine,
  r: Range,
  nan: () => Expression
): Expression {
  const a = exactAbs(ce, r);
  const f = (x: Expression): Expression =>
    infinitySign(x) !== 0 ? ce.PositiveInfinity : ev(ce, 'Cosh', [x]);
  return exactEnclosure(ce, f(a.lo), f(a.hi), nan);
}

/** The exact image of `Fract`: `[Fract(lo), Fract(hi)]` within one unit
 * interval, else `[0, 1]` (the jump of the library). */
function exactFract(
  ce: ComputeEngine,
  r: Range,
  nan: () => Expression
): Expression {
  if (infinitySign(r.lo) !== 0 || infinitySign(r.hi) !== 0)
    return ce._fn('Enclosure', [ce.Zero, ce.One]);
  const fa = ev(ce, 'Floor', [r.lo]);
  const fb = ev(ce, 'Floor', [r.hi]);
  if (order(fa, fb) !== 0) return ce._fn('Enclosure', [ce.Zero, ce.One]);
  return exactEnclosure(
    ce,
    ev(ce, 'Fract', [r.lo]),
    ev(ce, 'Fract', [r.hi]),
    nan
  );
}

/** A function of one operand, with its exact rule and its kernel. `angle`
 * is `'in'` for a function whose operand is an angle in the engine's unit
 * (`Sin`), `'out'` for one whose value is an angle (`Arcsin`). */
export interface UnaryRule {
  readonly exact: (
    ce: ComputeEngine,
    r: Range,
    nan: () => Expression
  ) => Expression;
  readonly kernel: Kernel;
  readonly angle?: 'in' | 'out';
}

/** The monotone exact rule of the operator `name`, with the domain of the
 * function. */
function monotoneRule(
  name: string,
  increasing: boolean,
  domain?: (ce: ComputeEngine) => {
    lo?: Expression;
    hi?: Expression;
    atLo?: Expression;
    atHi?: Expression;
  }
): UnaryRule['exact'] {
  return (ce, r, nan) =>
    exactMonotone(
      ce,
      r,
      (x) => ev(ce, name, [x]),
      increasing,
      nan,
      domain?.(ce)
    );
}

export const UNARY_RULES: Readonly<Record<string, UnaryRule>> = {
  Ln: {
    exact: monotoneRule('Ln', true, (ce) => ({
      lo: ce.Zero,
      atLo: ce.NegativeInfinity,
    })),
    kernel: IA.ln,
  },
  Sinh: { exact: monotoneRule('Sinh', true), kernel: IA.sinh },
  Tanh: { exact: monotoneRule('Tanh', true), kernel: IA.tanh },
  Arsinh: { exact: monotoneRule('Arsinh', true), kernel: IA.asinh },
  Arctan: {
    exact: monotoneRule('Arctan', true),
    kernel: IA.atan,
    angle: 'out',
  },
  Artanh: {
    exact: monotoneRule('Artanh', true, (ce) => ({
      lo: ce.NegativeOne,
      hi: ce.One,
      atLo: ce.NegativeInfinity,
      atHi: ce.PositiveInfinity,
    })),
    kernel: IA.atanh,
  },
  Arcosh: {
    exact: monotoneRule('Arcosh', true, (ce) => ({ lo: ce.One })),
    kernel: IA.acosh,
  },
  Arcsin: {
    exact: monotoneRule('Arcsin', true, (ce) => ({
      lo: ce.NegativeOne,
      hi: ce.One,
    })),
    kernel: IA.asin,
    angle: 'out',
  },
  Arccos: {
    exact: monotoneRule('Arccos', false, (ce) => ({
      lo: ce.NegativeOne,
      hi: ce.One,
    })),
    kernel: IA.acos,
    angle: 'out',
  },
  Erf: { exact: monotoneRule('Erf', true), kernel: IA.erf },
  Erfc: { exact: monotoneRule('Erfc', false), kernel: IA.erfc },
  Sin: {
    exact: (ce, r, nan) => exactSinCos(ce, r, 'Sin', nan),
    kernel: IA.sin,
    angle: 'in',
  },
  Cos: {
    exact: (ce, r, nan) => exactSinCos(ce, r, 'Cos', nan),
    kernel: IA.cos,
    angle: 'in',
  },
  Tan: {
    exact: (ce, r, nan) => exactTanCot(ce, r, 'Tan', nan),
    kernel: IA.tan,
    angle: 'in',
  },
  Cot: {
    exact: (ce, r, nan) => exactTanCot(ce, r, 'Cot', nan),
    kernel: IA.cot,
    angle: 'in',
  },
  Sec: {
    exact: (ce, r, nan) => exactSecCsc(ce, r, 'Sec', nan),
    kernel: IA.sec,
    angle: 'in',
  },
  Csc: {
    exact: (ce, r, nan) => exactSecCsc(ce, r, 'Csc', nan),
    kernel: IA.csc,
    angle: 'in',
  },
  Cosh: { exact: exactCosh, kernel: IA.cosh },
  Abs: {
    exact: (ce, r, nan) => {
      const a = exactAbs(ce, r);
      return exactEnclosure(ce, a.lo, a.hi, nan);
    },
    kernel: IA.abs,
  },
  Sign: {
    exact: (ce, r, nan) => exactSignLike(ce, r, 'Sign', nan),
    kernel: IA.sign,
  },
  Heaviside: {
    exact: (ce, r, nan) => exactSignLike(ce, r, 'Heaviside', nan),
    kernel: IA.heaviside,
  },
  Gamma: { exact: exactGamma, kernel: IA.gamma },
  Fract: { exact: exactFract, kernel: IA.fract },
};

/** The image of the function of `UNARY_RULES` named `operator` on the
 * enclosure `x`. */
function unaryApply(
  ce: ComputeEngine,
  rule: UnaryRule,
  x: Expression,
  numericApproximation: boolean
): Expression | undefined {
  const r = enclosureRange(x);
  if (r === undefined) return undefined;
  const nan = indeterminate(ce, numericApproximation, [r]);
  if (!numericApproximation && r.exact && r.ordered) {
    try {
      return rule.exact(ce, r, nan);
    } catch (e) {
      if (e !== UNDECIDED) throw e;
    }
  }
  const v = rule.angle === 'in' ? radiansOf(ce, r) : doublesOf(r);
  const result = rule.kernel(v);
  return fromResult(
    ce,
    rule.angle === 'out' ? angleFromRadians(ce, result) : result,
    nan
  );
}

/** A point second operand of an `apply` operator (the base of `Log`, the
 * step of `Round`, the divisor of `Mod`): a number or a class 2 constant,
 * read exactly under `.N()`. `INFINITE` for `±oo`, `undefined` for anything
 * else (an enclosure there leaves the call unevaluated). */
function pointOperand(
  ops: KindOperands,
  i: number,
  numericApproximation: boolean
): Range | typeof INFINITE | undefined {
  const x = ops.evaluated[i];
  if (x === undefined || isEnclosure(x)) return undefined;
  return operandRange(x, () => ops.exact(i), numericApproximation);
}

/** `Floor`, `Ceil`, `Round`, `Truncate` with an optional step. */
function roundingApply(
  ce: ComputeEngine,
  operator: 'Floor' | 'Ceil' | 'Round' | 'Truncate',
  ops: KindOperands,
  numericApproximation: boolean
): Expression | undefined {
  const x = ops.evaluated[0];
  if (!isEnclosure(x)) return undefined;
  const r = enclosureRange(x);
  if (r === undefined) return undefined;
  let step: Range | undefined;
  if (ops.evaluated.length > 1) {
    const s = pointOperand(ops, 1, numericApproximation);
    if (s === undefined || s === INFINITE) return undefined;
    step = s;
  }
  const ranges = step === undefined ? [r] : [r, step];
  const nan = indeterminate(ce, numericApproximation, ranges);
  // A zero step has no multiple to round to (`roundingStepDefined()`).
  if (step !== undefined && endpointOrder(step.lo, ce.Zero) === 0) return nan();
  const kernel = (v: Interval): IntervalResult => {
    switch (operator) {
      case 'Floor':
        return IA.floor(v);
      case 'Ceil':
        return IA.ceil(v);
      case 'Truncate':
        return IA.trunc(v);
      case 'Round':
        return IA.round(v, ce.roundingTies);
    }
  };
  return compute(
    ranges,
    numericApproximation,
    () => {
      const f = (v: Expression): Expression =>
        infinitySign(v) !== 0
          ? v
          : ev(ce, operator, step === undefined ? [v] : [v, step.lo]);
      return exactEnclosure(ce, f(r.lo), f(r.hi), nan);
    },
    ([v, s]) => {
      if (step === undefined || s === undefined)
        return fromResult(ce, kernel(v), nan);
      // A step `m` or `1/m`, with `m` a safe integer, scales through the
      // exact point `m` (`intervalRoundToStep()` of the `interval-js`
      // target): `1/100` has no double, and a division by an enclosure of
      // it would widen a tie across its jump.
      const q = isNumber(step.lo) ? asRational(step.lo) : undefined;
      if (q !== undefined) {
        const p = Math.abs(Number(q[0]));
        const d = Number(q[1]);
        if (p === 1 && Number.isSafeInteger(d) && d > 0)
          return fromResult(
            ce,
            IA.div(kernel(IA.mul(v, IA.point(d)) as never), IA.point(d)),
            nan
          );
        if (d === 1 && Number.isSafeInteger(p) && p > 0)
          return fromResult(
            ce,
            IA.mul(kernel(IA.div(v, IA.point(p)) as never), IA.point(p)),
            nan
          );
      }
      const k = IA.abs(s);
      return fromResult(ce, IA.mul(kernel(IA.div(v, k) as never), k), nan);
    }
  );
}

/** `Mod(x, m)` with a point divisor `m`. */
function modApply(
  ce: ComputeEngine,
  ops: KindOperands,
  numericApproximation: boolean
): Expression | undefined {
  const x = ops.evaluated[0];
  if (!isEnclosure(x) || ops.evaluated.length !== 2) return undefined;
  const r = enclosureRange(x);
  if (r === undefined) return undefined;
  const m = pointOperand(ops, 1, numericApproximation);
  if (m === undefined || m === INFINITE) return undefined;
  const nan = indeterminate(ce, numericApproximation, [r, m]);
  // `Mod(x, 0)` has no value, as for a number.
  if (endpointOrder(m.lo, ce.Zero) === 0) return nan();
  return compute(
    [r, m],
    numericApproximation,
    () => {
      const positive = order(m.lo, ce.Zero) > 0;
      const jump = (): Expression =>
        positive
          ? ce._fn('Enclosure', [ce.Zero, m.lo])
          : ce._fn('Enclosure', [m.lo, ce.Zero]);
      if (infinitySign(r.lo) !== 0 || infinitySign(r.hi) !== 0) return jump();
      const ka = ev(ce, 'Floor', [ev(ce, 'Divide', [r.lo, m.lo])]);
      const kb = ev(ce, 'Floor', [ev(ce, 'Divide', [r.hi, m.lo])]);
      if (order(ka, kb) !== 0) return jump();
      return exactEnclosure(
        ce,
        ev(ce, 'Mod', [r.lo, m.lo]),
        ev(ce, 'Mod', [r.hi, m.lo]),
        nan
      );
    },
    ([v, d]) => fromResult(ce, IA.mod(v, d), nan)
  );
}

/** `Log(x)` (base 10) and `Log(x, b)` with a point base. */
function logApply(
  ce: ComputeEngine,
  ops: KindOperands,
  numericApproximation: boolean
): Expression | undefined {
  const x = ops.evaluated[0];
  if (!isEnclosure(x)) return undefined;
  const r = enclosureRange(x);
  if (r === undefined) return undefined;
  if (ops.evaluated.length === 1) {
    const nan = indeterminate(ce, numericApproximation, [r]);
    return compute(
      [r],
      numericApproximation,
      logRule(ce, r, [], true, nan),
      ([v]) => fromResult(ce, IA.log10(v), nan)
    );
  }
  const b = pointOperand(ops, 1, numericApproximation);
  if (b === undefined) return undefined;
  // `Log(x, +oo)` is the limit `0`, as for a number.
  if (b === INFINITE) {
    if (infinitySign(ops.exact(1)) < 0) return undefined;
    return ce._fn('Enclosure', [ce.Zero, ce.Zero]);
  }
  const nan = indeterminate(ce, numericApproximation, [r, b]);
  // A base that is not positive, or that is `1`, leaves the call
  // unevaluated.
  const sign = endpointOrder(b.lo, ce.Zero);
  const unit = endpointOrder(b.lo, ce.One);
  if (sign === undefined || sign <= 0 || unit === undefined || unit === 0)
    return undefined;
  const increasing = unit > 0;
  return compute(
    [r, b],
    numericApproximation,
    logRule(ce, r, [b.lo], increasing, nan),
    ([v, base]) => {
      if (base.lo === 2 && base.hi === 2)
        return fromResult(ce, IA.log2(v), nan);
      if (base.lo === 10 && base.hi === 10)
        return fromResult(ce, IA.log10(v), nan);
      return fromResult(ce, IA.div(IA.ln(v), IA.ln(base)), nan);
    }
  );
}

/** The exact rule of a logarithm of base `rest[0]` (base 10 when `rest` is
 * empty), clipped to `(0, +oo)`, with its value at `0`: increasing for a
 * base above 1, decreasing for a base below 1. */
function logRule(
  ce: ComputeEngine,
  r: Range,
  rest: ReadonlyArray<Expression>,
  increasing: boolean,
  nan: () => Expression
): () => Expression {
  return () =>
    exactMonotone(
      ce,
      r,
      (v) =>
        infinitySign(v) > 0
          ? increasing
            ? ce.PositiveInfinity
            : ce.NegativeInfinity
          : ev(ce, 'Log', [v, ...rest]),
      increasing,
      nan,
      {
        lo: ce.Zero,
        atLo: increasing ? ce.NegativeInfinity : ce.PositiveInfinity,
      }
    );
}

/** The two operands of `Hypot` or `Arctan2`, each an enclosure or a point. */
function pairOperands(
  ops: KindOperands,
  numericApproximation: boolean
): [Range | typeof INFINITE, Range | typeof INFINITE] | undefined {
  if (ops.evaluated.length !== 2) return undefined;
  const x = operandRange(
    ops.evaluated[0],
    () => ops.exact(0),
    numericApproximation
  );
  const y = operandRange(
    ops.evaluated[1],
    () => ops.exact(1),
    numericApproximation
  );
  if (x === undefined || y === undefined) return undefined;
  return [x, y];
}

function hypotApply(
  ce: ComputeEngine,
  ops: KindOperands,
  numericApproximation: boolean
): Expression | undefined {
  const operands = pairOperands(ops, numericApproximation);
  if (operands === undefined) return undefined;
  const [x, y] = operands;
  const ranges = [x, y].filter((r): r is Range => r !== INFINITE);
  const nan = indeterminate(ce, numericApproximation, ranges);
  // An infinite point gives an infinite singleton.
  if (x === INFINITE || y === INFINITE) return nan();
  return compute(
    [x, y],
    numericApproximation,
    () => {
      const a = exactAbs(ce, x);
      const b = exactAbs(ce, y);
      const f = (u: Expression, v: Expression): Expression =>
        infinitySign(u) !== 0 || infinitySign(v) !== 0
          ? ce.PositiveInfinity
          : ev(ce, 'Hypot', [u, v]);
      return exactEnclosure(ce, f(a.lo, b.lo), f(a.hi, b.hi), nan);
    },
    ([u, v]) => fromResult(ce, IA.hypot(u, v), nan)
  );
}

/** `Arctan2(y, x)`: the extremes at the corners, the hull `[-π, π]` (in the
 * engine's unit) when the box reaches the branch cut (a negative `x` with a
 * `y` that holds `0` and goes below it) or the origin. An infinite point
 * takes the limit value, as for a number. */
function arctan2Apply(
  ce: ComputeEngine,
  ops: KindOperands,
  numericApproximation: boolean
): Expression | undefined {
  if (ops.evaluated.length !== 2) return undefined;
  const read = (i: number): Range | undefined => {
    const r = operandRange(
      ops.evaluated[i],
      () => ops.exact(i),
      numericApproximation
    );
    if (r === undefined) return undefined;
    if (r === INFINITE) {
      const v = numericApproximation ? ops.exact(i) : ops.evaluated[i];
      return pointRange(v);
    }
    return r;
  };
  const y = read(0);
  const x = read(1);
  if (y === undefined || x === undefined) return undefined;
  const nan = indeterminate(ce, numericApproximation, [y, x]);
  return compute(
    [y, x],
    numericApproximation,
    () => {
      const T = halfTurn(ce);
      const yLo = order(y.lo, ce.Zero);
      const yHi = order(y.hi, ce.Zero);
      const xLo = order(x.lo, ce.Zero);
      const xHi = order(x.hi, ce.Zero);
      const yHoldsZero = yLo <= 0 && yHi >= 0;
      if (
        (xLo < 0 && yLo < 0 && yHi >= 0) ||
        (yHoldsZero && xLo <= 0 && xHi >= 0)
      )
        return ce._fn('Enclosure', [ev(ce, 'Negate', [T]), T]);
      const corners = [
        ev(ce, 'Arctan2', [y.lo, x.lo]),
        ev(ce, 'Arctan2', [y.lo, x.hi]),
        ev(ce, 'Arctan2', [y.hi, x.lo]),
        ev(ce, 'Arctan2', [y.hi, x.hi]),
      ];
      return exactEnclosure(ce, exactMin(corners), exactMax(corners), nan);
    },
    ([u, v]) => fromResult(ce, angleFromRadians(ce, IA.atan2(u, v)), nan)
  );
}

/** `Mean` of enclosures and points: the sum through `add`, divided by the
 * count. An infinite point gives the indeterminate value. */
function meanApply(
  ce: ComputeEngine,
  ops: KindOperands,
  numericApproximation: boolean
): Expression | undefined {
  const items: Expression[] = [];
  ops.evaluated.forEach((x, i) => {
    const elements = ops.elements(i);
    if (elements !== undefined) items.push(...elements);
    else items.push(x);
  });
  if (items.length === 0) return undefined;
  const ranges: Range[] = [];
  let infinite = false;
  for (const x of items) {
    const r = operandRange(x, () => x, numericApproximation);
    if (r === undefined) return undefined;
    if (r === INFINITE) infinite = true;
    else ranges.push(r);
  }
  const nan = indeterminate(ce, numericApproximation, ranges);
  if (infinite) return nan();
  const n = ce.number(ranges.length);
  return compute(
    ranges,
    numericApproximation,
    () =>
      exactEnclosure(
        ce,
        ev(ce, 'Divide', [
          ev(
            ce,
            'Add',
            ranges.map((r) => r.lo)
          ),
          n,
        ]),
        ev(ce, 'Divide', [
          ev(
            ce,
            'Add',
            ranges.map((r) => r.hi)
          ),
          n,
        ]),
        nan
      ),
    (xs) => {
      const sum = xs
        .slice(1)
        .reduce<Interval | IntervalResult>((acc, x) => IA.add(acc, x), xs[0]);
      return fromResult(ce, IA.div(sum, IA.point(ranges.length)), nan);
    }
  );
}

/**
 * The `apply` hook: the image of the numeric function `operator` at an
 * apply site. An operator that is not in the table of
 * `docs/plans/2026-10-26-value-kinds.md`, section 4.9.2 (`Factorial`,
 * `Median`, the incomplete `Gamma(s, x)`), and a second operand that is an
 * enclosure where a point is expected (the base of `Log`, the step of
 * `Round`, the divisor of `Mod`), leave the call unevaluated.
 */
function enclosureApply(
  operator: string,
  ops: KindOperands,
  { engine: ce, numericApproximation }: ArithmeticContext
): Expression | undefined {
  switch (operator) {
    case 'Floor':
    case 'Ceil':
    case 'Round':
    case 'Truncate':
      return roundingApply(ce, operator, ops, numericApproximation);
    case 'Mod':
      return modApply(ce, ops, numericApproximation);
    case 'Log':
      return logApply(ce, ops, numericApproximation);
    case 'Hypot':
      return hypotApply(ce, ops, numericApproximation);
    case 'Arctan2':
      return arctan2Apply(ce, ops, numericApproximation);
    case 'Mean':
      return meanApply(ce, ops, numericApproximation);
  }
  const rule = UNARY_RULES[operator];
  if (rule === undefined || ops.evaluated.length !== 1) return undefined;
  const x = ops.evaluated[0];
  if (!isEnclosure(x)) return undefined;
  return unaryApply(ce, rule, x, numericApproximation);
}

//
// The order
//

/** True when the two points `x` and `y` are equal: exactly for two exact
 * values, within `tolerance` when one of them is a float. */
function samePoint(x: Expression, y: Expression, tolerance: number): boolean {
  if (x.isSame(y)) return true;
  if (isExactEndpoint(x) && isExactEndpoint(y))
    return endpointOrder(x, y) === 0;
  if (infinitySign(x) !== 0 || infinitySign(y) !== 0)
    return infinitySign(x) === infinitySign(y);
  const a = isNumber(x) ? x.re : x.N().re;
  const b = isNumber(y) ? y.re : y.N().re;
  return Math.abs(a - b) <= tolerance;
}

/** The operand of `compare` as it is read: its exact value under `.N()`
 * when that is an enclosure or a number. */
function comparisonOperand(x: KindOperand): Expression {
  const exact = x.exact();
  return isEnclosure(exact) || isNumber(exact) ? exact : x.evaluated;
}

/**
 * The `compare` hook, in this order: two points that are equal are `0`
 * (exactly, or within the tolerance when one is a float); `-1` when
 * `x.hi < y.lo` and `1` when `x.lo > y.hi`; `'<='` when `x.hi = y.lo` and
 * `'>='` when `x.lo = y.hi`, decided exactly (two enclosures that touch);
 * else `undefined`: the two overlap, and the comparison stays unevaluated,
 * since an order may exist. An infinite number is the point `[±oo, ±oo]`.
 */
function enclosureCompare(
  a: KindOperand,
  b: KindOperand,
  { engine: ce, tolerance }: ArithmeticContext
): -1 | 0 | 1 | '<=' | '>=' | undefined {
  const x = comparisonRange(comparisonOperand(a));
  const y = comparisonRange(comparisonOperand(b));
  if (x === undefined || y === undefined) return undefined;
  if (
    isPointRange(x) &&
    isPointRange(y) &&
    samePoint(x.lo, y.lo, tolerance ?? ce.tolerance)
  )
    return 0;
  if (strictlyLess(x.hi, y.lo)) return -1;
  if (strictlyLess(y.hi, x.lo)) return 1;
  if (endpointOrder(x.hi, y.lo) === 0) return '<=';
  if (endpointOrder(x.lo, y.hi) === 0) return '>=';
  return undefined;
}

/**
 * The `eq` handler of the head `Enclosure`: `true` when the two are the same
 * point, `false` when they are disjoint, else `undefined` (the two enclosed
 * reals may be equal). Two identical expressions are equal before this
 * handler is asked.
 */
export function enclosureEq(a: Expression, b: Expression): boolean | undefined {
  const x = comparisonRange(a);
  const y = comparisonRange(b);
  if (x === undefined || y === undefined) return undefined;
  if (
    isPointRange(x) &&
    isPointRange(y) &&
    samePoint(x.lo, y.lo, a.engine.tolerance)
  )
    return true;
  if (strictlyLess(x.hi, y.lo) || strictlyLess(y.hi, x.lo)) return false;
  return undefined;
}

/**
 * The `extremum` hook: the maximum (`'max'`) of enclosures and numbers is
 * the enclosure `[max(lo), max(hi)]`, the minimum `[min(lo), min(hi)]`; a
 * finite number is a point. An infinite number is a scalar that wins or
 * loses: `Max(Enclosure(0, 1), +oo)` is the number `+oo`, and
 * `Min(Enclosure(0, 1), +oo)` is `Enclosure(0, 1)`. `undefined` for an
 * operand that is not read (a symbol, a value of another kind).
 */
function enclosureExtremum(
  which: 'max' | 'min',
  ops: KindOperands,
  { engine: ce }: ArithmeticContext
): Expression | undefined {
  const winner = which === 'max' ? 1 : -1;
  const ranges: Range[] = [];
  for (const x of ops.evaluated) {
    if (isNumber(x) && infinitySign(x) !== 0) {
      if (infinitySign(x) === winner) return x;
      continue;
    }
    const r = comparisonRange(x);
    if (r === undefined) return undefined;
    ranges.push(r);
  }
  if (ranges.length === 0) return undefined;
  const nan = indeterminate(ce, false, ranges);
  const pick = which === 'max' ? exactMax : exactMin;
  return compute(
    ranges,
    false,
    () =>
      exactEnclosure(
        ce,
        pick(ranges.map((r) => r.lo)),
        pick(ranges.map((r) => r.hi)),
        nan
      ),
    (xs) =>
      fromResult(
        ce,
        xs
          .slice(1)
          .reduce<Interval | IntervalResult>(
            (acc, x) => (which === 'max' ? IA.max(acc, x) : IA.min(acc, x)),
            xs[0]
          ),
        nan
      )
  );
}

//
// The result types
//

/** The operators whose image of an enclosure is always an enclosure. */
const ENCLOSURE_RESULT: ReadonlySet<string> = new Set([
  'Abs',
  'Sin',
  'Cos',
  'Sinh',
  'Cosh',
  'Tanh',
  'Arctan',
  'Arsinh',
  'Erf',
  'Erfc',
  'Fract',
  'Sign',
  'Heaviside',
]);

/** The arithmetic operators whose result is an enclosure unless an operand
 * may be infinite (`x + oo` is an infinite singleton). */
const SUM_LIKE: ReadonlySet<string> = new Set([
  'Add',
  'Negate',
  'Subtract',
  'Multiply',
  'Sum',
  'Product',
]);

/** The extrema, whose result is a number when an operand is an infinite
 * number that wins. */
const EXTREMA: ReadonlySet<string> = new Set([
  'Max',
  'Min',
  'Clamp',
  'ElementMax',
  'ElementMin',
]);

/** True when a value of the type `t` may be infinite or `NaN`. */
function admitsNonFinite(t: Type): boolean {
  return (
    !provablyDisjoint(t, SIGNED_INFINITY_TYPE) || !provablyDisjoint(t, 'nan')
  );
}

/**
 * The static result type of a cell of `operator` with an enclosure operand
 * (`docs/plans/2026-10-26-value-kinds.md`, section 4.9.2): `enclosure` for
 * the functions whose image is always an enclosure; for the sums, the
 * products and the extrema, `enclosure` when every operand is an enclosure
 * or a finite number, else with the arms that an infinite operand gives
 * (`nan`, and `signed_infinity` for an extremum); `enclosure | nan` for
 * every other operator of the hooks, whose image can be empty.
 */
function enclosureResultType(
  operator: string,
  operandTypes: ReadonlyArray<Type>
): string | undefined {
  if (ENCLOSURE_RESULT.has(operator)) return 'enclosure';
  if (SUM_LIKE.has(operator))
    return operandTypes.some(admitsNonFinite) ? 'enclosure | nan' : 'enclosure';
  if (EXTREMA.has(operator))
    return operandTypes.some(admitsNonFinite)
      ? 'enclosure | signed_infinity | nan'
      : 'enclosure';
  return 'enclosure | nan';
}

/**
 * The arithmetic of the value kind `enclosure`, the `arithmetic` field of
 * the head `Enclosure` (`enclosure.ts`).
 */
export const ENCLOSURE_ARITHMETIC: ArithmeticDefinition = {
  admittedAs: 'real',
  add: (ops, context) => sumFolds(ops, context),
  multiply: (ops, context) => productFolds(ops, context),
  negate: (x, context) => negateHook(x, context),
  divide: (a, b, context) => divideHook(a, b, context),
  power: (base, exponent, context) => powerHook(base, exponent, context),
  compare: (a, b, context) => enclosureCompare(a, b, context),
  extremum: (which, ops, context) => enclosureExtremum(which, ops, context),
  apply: (operator, ops, context) => enclosureApply(operator, ops, context),
  // An enclosure is exact when both endpoints are: `Enclosure(0, Sin(1))`
  // is, `Enclosure(0, 0.84)` is not.
  isExact: (value) => {
    if (!isFunction(value) || !isEnclosure(value)) return true;
    return value.ops.every((x) => isExactEndpoint(x));
  },
  // An indeterminate value never becomes an enclosure.
  isNaN: () => false,
  resultType: (operator, operandTypes) =>
    enclosureResultType(operator, operandTypes),
};

/**
 * The outward conversion of the endpoints of the enclosure `x` (class 1 or
 * 2) to doubles, for `.N()` of an enclosure: `Enclosure(0, Pi).N()` is
 * `Enclosure(0, 3.1415926535897936)`. `undefined` when an endpoint is of
 * class 3.
 */
export function numericEnclosure(
  ce: ComputeEngine,
  lo: Expression,
  hi: Expression
): Expression | undefined {
  if (endpointClass(lo) === 3 || endpointClass(hi) === 3) return undefined;
  const a = outwardDoubles(lo);
  const b = outwardDoubles(hi);
  return ce._fn('Enclosure', [
    boxDouble(ce, Math.min(a[0], b[0])),
    boxDouble(ce, Math.max(a[1], b[1])),
  ]);
}

/** The order of the endpoints `a` and `b` of an enclosure, for its canonical
 * form: `-1`, `0` or `1`, or `undefined` when an endpoint is of class 3 or
 * the order is not decided. */
export function enclosureEndpointOrder(
  a: Expression,
  b: Expression
): -1 | 0 | 1 | undefined {
  if (endpointClass(a) === 3 || endpointClass(b) === 3) return undefined;
  return endpointOrder(a, b);
}

/** The class of an endpoint, for the head (`endpointClass()`). */
export function enclosureEndpointClass(x: Expression): 1 | 2 | 3 {
  return endpointClass(x);
}
