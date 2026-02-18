import { Complex } from 'complex-esm';
import { Decimal } from 'decimal.js';

import type { MathJsonExpression, MathJsonNumberObject } from '../../math-json';

import { mul, div } from './arithmetic-mul-div';

import { canonicalInteger, SMALL_INTEGER } from '../numerics/numeric';
import type { Rational, SmallInteger } from '../numerics/types';
import { bigint } from '../numerics/bigint';

import {
  ExactNumericValueData,
  NumericValue,
  NumericValueData,
} from '../numeric-value/types';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value';

import { replace } from './rules';
import { simplify } from './simplify';

import { _BoxedExpression } from './abstract-boxed-expression';
import { hashCode } from './utils';
import { match } from './match';
import { add } from './arithmetic-add';
import { pow } from './arithmetic-power';
import { isSubtype } from '../../common/type/subtype';
import {
  positiveSign,
  nonNegativeSign,
  negativeSign,
  nonPositiveSign,
} from './sgn';
import { BoxedType } from '../../common/type/boxed-type';
import type {
  BoxedRuleSet,
  BoxedSubstitution,
  CanonicalOptions,
  EvaluateOptions,
  IComputeEngine as ComputeEngine,
  Metadata,
  Rule,
  Sign,
  Substitution,
  Expression,
  PatternMatchOptions,
  ReplaceOptions,
  SimplifyOptions,
  NumberLiteralInterface,
} from '../global-types';
import { isNumber, isSymbol } from './type-guards';

/**
 * BoxedNumber
 *
 */

export class BoxedNumber
  extends _BoxedExpression
  implements NumberLiteralInterface
{
  override readonly _kind = 'number';

  // The value of a BoxedNumber is either a small integer or a NumericValue
  protected readonly _value: SmallInteger | NumericValue;

  private _hash: number | undefined;

  /**
   * By the time the constructor is called, the `value` should have been
   * screened for cases where it's a well-known value (0, NaN, +Infinity,
   * etc...) or non-normal (complex number with im = 0, rational with
   * denom = 1, etc...).
   *
   * This is done in `ce.number()`. In general, use `ce.number()` rather
   * than calling this constructor directly.
   *
   * We may store as a machine number if a Decimal is passed that is in machine
   * range
   */
  constructor(
    ce: ComputeEngine,
    value:
      | SmallInteger
      | NumericValueData
      | ExactNumericValueData
      | NumericValue,
    options?: { metadata?: Metadata }
  ) {
    super(ce, options?.metadata);
    if (value instanceof NumericValue || typeof value === 'number')
      this._value = value;
    else this._value = ce._numericValue(value);
  }

  get hash(): number {
    this._hash ??= hashCode(this._value.toString());
    // console.info('hash BoxedNumber ', this._hash);
    return this._hash;
  }

  get json(): MathJsonExpression {
    // Note: the `.json` property outputs a "default" serialization
    // which does not attempt to capture all the information in the
    // expression.
    // In particular for numbers, it may output a numeric approximation of
    // the number that can be represented as a JSON number, rather than
    // the exact value.

    const value = this._value;
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return 'NaN';
      if (!Number.isFinite(value))
        return value > 0 ? 'PositiveInfinity' : 'NegativeInfinity';
      return value;
    }

    return value.toJSON() as MathJsonExpression;
  }

  get operator(): string {
    // Handle plain JavaScript numbers
    if (typeof this._value === 'number') {
      if (Number.isNaN(this._value)) return 'NaN';
      if (!Number.isFinite(this._value))
        return this._value > 0 ? 'PositiveInfinity' : 'NegativeInfinity';
      return Number.isInteger(this._value) ? 'Integer' : 'Real';
    }

    // Handle NumericValue objects
    if (this._value.isNaN) return 'NaN';
    if (this._value.isPositiveInfinity) return 'PositiveInfinity';
    if (this._value.isNegativeInfinity) return 'NegativeInfinity';

    // Check for complex numbers (non-zero imaginary part)
    if (this._value.im !== 0) return 'Complex';

    // Map the type property to operator string
    const type = this._value.type;
    if (type === 'integer' || type === 'finite_integer') return 'Integer';
    if (type === 'rational' || type === 'finite_rational') return 'Rational';
    if (
      type === 'real' ||
      type === 'finite_real' ||
      type === 'imaginary' ||
      type === 'finite_complex' ||
      type === 'complex'
    )
      return 'Real';
    if (type === 'non_finite_number') return 'Infinity';

    // Fallback for any other numeric type
    return 'Number';
  }

  get isPure(): boolean {
    return true;
  }

  get isCanonical(): boolean {
    return true;
  }
  set isCanonical(val: boolean) {}

  get complexity(): number {
    return 1;
  }

  /**
   *
   * Return a JavaScript number when possible (most cases); else return a
   * string representation of the number (ComplexInfinity and complex numbers
   * for example).
   *
   * When a JavaScript number is returned, it may have fewer digits than the
   * original number, but it will be a close approximation.
   *
   * @returns {number | string} The value of the number.
   */

  valueOf(): number | string {
    if (typeof this._value === 'number') return this._value;
    return this._value.N().valueOf();
  }

  get numericValue(): number | NumericValue {
    return this._value;
  }

  get isNumberLiteral(): true {
    return true;
  }

  get re(): number {
    if (typeof this._value === 'number') return this._value;
    return this._value.re;
  }

  get im(): number {
    if (typeof this._value === 'number') return 0;
    return this._value.im;
  }

  get bignumRe(): Decimal | undefined {
    if (typeof this._value === 'number') return undefined;
    return this._value.bignumRe;
  }

  get bignumIm(): Decimal | undefined {
    if (typeof this._value === 'number') return this.engine._BIGNUM_ZERO;
    return this.engine.bignum(this._value.im);
  }

  neg(): Expression {
    const n = this._value;
    if (n === 0) return this;

    if (typeof n === 'number') return this.engine.number(-n);

    return this.engine.number(n.neg());
  }

  inv(): Expression {
    if (typeof this._value === 'number') {
      if (Math.abs(this._value) === 1) return this;
      if (!Number.isInteger(this._value))
        return this.engine.number(1 / this._value);
      return this.engine.number(
        this.engine._numericValue({ rational: [1, this._value] })
      );
    }
    if (Math.abs(this.re) === 1 && this.im === 0) return this;
    return this.engine.number(this._value.inv());
  }

  abs(): Expression {
    if (this.isPositive) return this;
    if (typeof this._value === 'number')
      return this.engine.number(-this._value);

    return this.engine.number(this._value.abs());
  }

  add(rhs: number | Expression): Expression {
    const ce = this.engine;
    if (this.is(0)) return ce.box(rhs);
    if (typeof rhs === 'number') {
      // @fastpath
      if (rhs === 0) return this;
      if (typeof this._value === 'number') return ce.number(this._value + rhs);

      return ce.number(this._value.add(rhs));
    }
    if (isNumber(rhs)) {
      // @fastpath
      if (typeof this._value === 'number') {
        if (typeof rhs.numericValue === 'number')
          return ce.number(this._value + rhs.numericValue);
        return ce.number(rhs.numericValue.add(this._value));
      }

      return ce.number(this._value.add(rhs.numericValue));
    }
    return add(this, rhs.canonical);
  }

  mul(rhs: NumericValue | number | Expression): Expression {
    if (this.is(1)) return this.engine.box(rhs);
    if (this.is(-1)) return this.engine.box(rhs).neg();

    const ce = this.engine;

    // @fastpath
    if (typeof rhs === 'number') {
      if (rhs === 1) return this;
      if (rhs === 0 || this.is(0)) return this.engine.Zero;
      if (rhs === -1) return this.neg();
      return ce.number(
        typeof this._value === 'number'
          ? this._value * rhs
          : this._value.mul(rhs)
      );
    }

    if (typeof this._value === 'number' && typeof rhs === 'number')
      return ce.number(this._value * rhs);

    if (rhs instanceof NumericValue) {
      if (this.is(1)) return ce.number(rhs);
      if (this.is(-1)) return ce.number(rhs.neg());
      return ce.number(rhs.mul(this._value));
    }

    if (isNumber(rhs))
      return ce.number(ce._numericValue(this._value).mul(rhs.numericValue));

    return mul(this, rhs);
  }

  div(rhs: number | Expression): Expression {
    return div(this, rhs);
  }

  pow(exp: number | Expression): Expression {
    return pow(this, exp, { numericApproximation: false });
  }

  root(exp: number | Expression): Expression {
    if (typeof exp === 'number') {
      if (exp === 0) return this.engine.NaN;
      if (exp === 1) return this;
      if (exp === -1) return this.inv();
      if (exp === 2) return this.sqrt();
      if (this.isNegative) {
        if (exp % 2 === 1) return this.neg().root(exp).neg();
        if (exp % 2 === 0) return this.neg().root(exp);
      }
    } else {
      exp = exp.canonical;
      if (exp.is(0)) return this.engine.NaN;
      if (exp.is(1)) return this;
      if (exp.is(-1)) return this.inv();
      if (exp.is(2)) return this.sqrt();
      if (this.isNegative) {
        if (exp.isOdd) return this.neg().root(exp).neg();
        if (exp.isEven) return this.neg().root(exp);
      }
    }

    const n = typeof exp === 'number' ? exp : exp.re;
    if (Number.isInteger(n)) {
      if (typeof this._value === 'number') {
        const r = this._value ** (1 / n);
        if (Number.isInteger(r)) return this.engine.number(r);
      } else {
        const r = this._value.root(n);
        if (isSubtype(r.type, 'integer')) return this.engine.number(r);
      }
    }
    return this.engine._fn('Root', [this, this.engine.box(exp)]);
  }

  sqrt(): Expression {
    // @fastpath
    if (typeof this._value === 'number') {
      if (this._value === 0 || this._value === 1) return this;
      if (this._value === -1) return this.engine.I;

      if (
        this._value > 0 &&
        Number.isInteger(this._value) &&
        this._value < SMALL_INTEGER
      )
        return this.engine.number(
          this.engine._numericValue({ radical: this._value })
        );

      return this.engine.number(this.engine._numericValue(this._value).sqrt());
    }
    if (this.is(0) || this.is(1)) return this;

    return this.engine.number(this._value.sqrt());
  }

  ln(semiBase?: number | Expression): Expression {
    const base = semiBase ? this.engine.box(semiBase) : undefined;

    // Mathematica returns `Log[0]` as `-∞`
    if (this.is(0)) return this.engine.NegativeInfinity;

    if (base && this.isSame(base)) return this.engine.One;
    if (
      (!base || isSymbol(base, 'ExponentialE')) &&
      this.symbol === 'ExponentialE'
    )
      return this.engine.One;

    const f = this.re;
    if (Number.isInteger(f) && f > 0) {
      const ce = this.engine;
      let [factor, root] = canonicalInteger(f, 3);
      if (factor !== 1)
        return ce.number(factor).ln(base).mul(3).add(ce.number(root).ln(base));
      [factor, root] = canonicalInteger(f, 2);
      if (factor !== 1)
        return ce.number(factor).ln(base).mul(2).add(ce.number(root).ln(base));
    }

    if (base && base.isInteger) {
      if (typeof this._value === 'number')
        return this.engine.number(Math.log(this._value) / Math.log(base.re));
      return this.engine.number(this._value.ln(base.re));
    }

    if (base === undefined) {
      if (typeof this._value === 'number')
        return this.engine.number(Math.log(this._value));
      return this.engine.number(this._value.ln());
    }

    return this.engine._fn('Ln', [this]);
  }

  get value(): Expression {
    return this;
  }

  get type(): BoxedType {
    if (typeof this._value === 'number') {
      if (Number.isNaN(this._value)) return BoxedType.number;
      if (!Number.isFinite(this._value)) return BoxedType.non_finite_number;
      return Number.isInteger(this._value)
        ? BoxedType.finite_integer
        : BoxedType.finite_real;
    }

    return new BoxedType(this._value.type, this.engine._typeResolver);
  }

  get sgn(): Sign | undefined {
    if (this._value === 0) return 'zero';

    let s: number | undefined;
    if (typeof this._value === 'number') s = Math.sign(this._value);
    else s = this._value.sgn();

    // If undefined, it's a complex number. Return 'unsigned'
    if (s === undefined) return 'unsigned';

    if (Number.isNaN(s)) return 'unsigned';

    // It's a real number
    if (s === 0) return 'zero';
    if (s > 0) return 'positive';
    return 'negative';
  }

  get numerator(): Expression {
    if (typeof this._value === 'number') return this;
    return this.engine.number(this._value.numerator);
  }

  get denominator(): Expression {
    if (typeof this._value === 'number') return this.engine.One;
    return this.engine.number(this._value.denominator);
  }

  get numeratorDenominator(): [Expression, Expression] {
    if (typeof this._value === 'number') return [this, this.engine.One];
    const ce = this.engine;
    return [
      ce.number(this._value.numerator),
      ce.number(this._value.denominator),
    ];
  }

  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): Expression {
    if (this.isStructural) return this;
    // Apply the substition to the structural version of the number.
    // For example, `3/4` will be replaced by
    // ["Rational", 3, 4].subs({ "Rational": "Divide" }) -> ["Divide", 3, 4]
    return this.structural.subs(sub, options);
  }

  replace(
    rules: BoxedRuleSet | Rule | Rule[],
    options?: Partial<ReplaceOptions>
  ): Expression | null {
    // Apply the replace on the structural version of the number.
    // This will allow transformations to be applied on ["Rational", 3, 4]
    // for example.
    return replace(this.structural, rules, options).at(-1)?.value ?? null;
  }
  match(
    pattern: Expression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return match(this.structural, pattern, options);
  }

  /** x > 0, same as `isGreater(0)` */
  get isPositive(): boolean | undefined {
    if (typeof this._value === 'number')
      return !Number.isNaN(this._value) && this._value > 0;

    return positiveSign(this.sgn);
  }

  /** x >= 0, same as `isGreaterEqual(0)` */
  get isNonNegative(): boolean | undefined {
    if (typeof this._value === 'number')
      return !Number.isNaN(this._value) && this._value >= 0;

    return nonNegativeSign(this.sgn);
  }

  /** x < 0, same as `isLess(0)` */
  get isNegative(): boolean | undefined {
    if (typeof this._value === 'number')
      return !Number.isNaN(this._value) && this._value < 0;

    return negativeSign(this.sgn);
  }

  /** x <= 0, same as `isLessEqual(0)` */
  get isNonPositive(): boolean | undefined {
    if (typeof this._value === 'number')
      return !Number.isNaN(this._value) && this._value <= 0;

    return nonPositiveSign(this.sgn);
  }

  get isOdd(): boolean | undefined {
    if (this.is(1) || this.is(-1)) return true;
    if (this.is(0)) return false;

    if (!this.isFinite || !this.isInteger) return undefined;

    if (typeof this._value === 'number') return this._value % 2 !== 0;

    const [n, d] = [this._value.numerator, this._value.denominator];
    if (d.isOne) {
      const re = n.re;
      return re % 2 !== 0;
    }
    // a/b is odd if a is odd and b is even
    return n.re % 2 !== 0 && d.re % 2 === 0;
  }

  get isEven(): boolean | undefined {
    const odd = this.isOdd;
    return odd !== undefined ? !odd : undefined;
  }

  get isInfinity(): boolean {
    if (typeof this._value === 'number')
      return !Number.isFinite(this._value) && !Number.isNaN(this._value);

    // Complex infinity?
    if (!Number.isFinite(this._value.im)) return true;

    // Real infinity?
    return this._value.isPositiveInfinity || this._value.isNegativeInfinity;
  }

  get isNaN(): boolean {
    if (typeof this._value === 'number') return Number.isNaN(this._value);

    return this._value.isNaN;
  }

  get isFinite(): boolean {
    return this.isInfinity === false && this.isNaN === false;
  }

  get isNumber(): true {
    return true;
  }

  get isInteger(): boolean {
    if (typeof this._value === 'number') return Number.isInteger(this._value);

    return isSubtype(this._value.type, 'integer');
  }

  get isRational(): boolean {
    if (typeof this._value === 'number') return Number.isInteger(this._value);
    // Every integer is also a rational
    return isSubtype(this._value.type, 'rational');
  }

  get isReal(): boolean {
    if (typeof this._value === 'number') return true;
    // If it's 'complex', it has an imaginary part, otherwise it's real
    //    complex :> real :> rational :> integer
    return isSubtype(this._value.type, 'real');
  }

  is(other: Expression | number | bigint | boolean): boolean {
    if (typeof other === 'number') {
      // We want to be able to compare NaN with NaN, so we have to use
      // Object.is() instead of === (which return false for NaN === NaN)
      if (typeof this._value === 'number') return Object.is(this._value, other);

      if (this._value.isNaN) return Object.is(other, NaN);

      return this._value.eq(other);
    }
    if (typeof other === 'bigint') {
      if (typeof this._value === 'number') return bigint(this._value) === other;
      return this._value.eq(this.engine._numericValue(other));
    }
    if (typeof other === 'boolean') return false;
    return this.isSame(other);
  }

  get canonical(): Expression {
    return this;
  }

  get isStructural(): boolean {
    if (typeof this._value === 'number') return true;
    if (this.type.matches('rational')) return true;
    if (this._value instanceof ExactNumericValue) return false;
    return true;
  }

  get structural(): Expression {
    if (this.isStructural) return this;
    return this.engine.box(this.json, { form: 'structural' });
  }

  toNumericValue(): [NumericValue, Expression] {
    const v = this._value;
    if (typeof v === 'number')
      return [this.engine._numericValue(v), this.engine.One];

    return [v, this.engine.One];
  }

  simplify(options?: Partial<SimplifyOptions>): Expression {
    const results = simplify(this.structural, options);

    return results.at(-1)!.value ?? this;
  }

  evaluate(options?: Partial<EvaluateOptions>): Expression {
    if (options?.numericApproximation) return this.N();
    return this;
  }

  N(): Expression {
    const v = this._value;
    if (typeof v === 'number') return this;
    // NumericValue
    const n = v.N();
    // Often, 'evaluating' a numeric-value yields the same result, but sometimes may result in a
    // different representation: e.g. some cases of Exact -> Big
    if (v === n) return this;
    return this.engine.number(n);
  }
}

export function canonicalNumber(
  ce: ComputeEngine,
  value:
    | number
    | bigint
    | string
    | Decimal
    | Complex
    | Rational
    | NumericValue
    | MathJsonNumberObject
): number | NumericValue {
  if (value === undefined || value === null) return NaN;

  // If the value is already a NumericValue, we're done
  if (value instanceof NumericValue) return value;

  // If the value is a machine number, check if it's a small integer
  // or a non-finite value
  if (typeof value === 'number') {
    if (
      Number.isInteger(value) &&
      value >= -SMALL_INTEGER &&
      value <= SMALL_INTEGER
    )
      return value;
    if (!Number.isFinite(value)) return value;
    return ce._numericValue(value);
  }

  if (value instanceof Decimal) {
    const n = value.toNumber();
    // Is it a small integer?
    if (value.isInteger() && Math.abs(n) <= SMALL_INTEGER) return n;
    if (value.isNaN()) return NaN;
    if (!value.isFinite()) return n > 0 ? +Infinity : -Infinity;
    return ce._numericValue(value);
  }

  if (typeof value === 'bigint') {
    if (value >= -SMALL_INTEGER && value <= SMALL_INTEGER) return Number(value);
    return ce._numericValue(value);
  }

  // Is it a Complex?
  if (value instanceof Complex) {
    if (value.im === 0) return canonicalNumber(ce, value.re);
    if (value.isNaN()) return NaN;
    if (!value.isFinite() && value.im === 0)
      return value.re > 0 ? +Infinity : -Infinity;

    return ce._numericValue({ re: value.re, im: value.im });
  }

  if (typeof value === 'object' && 'num' in value) {
    // Technically, num.num as a number is not valid MathJSON: it should be a
    // string, but we'll allow it.
    // i.e. `{num: 1}` is the same as `{num: "1"}`
    if (typeof value.num === 'number') return canonicalNumber(ce, value.num);

    if (typeof value.num !== 'string')
      throw new Error('MathJSON `num` property should be a string of digits');
    return canonicalNumberString(ce, value.num);
  }

  if (typeof value === 'string') return canonicalNumberString(ce, value);

  //
  // It's a rational
  //
  // a/0 -> NaN
  if (value[1] == 0) return NaN;
  // a/±oo
  if (typeof value[1] === 'number' && !Number.isFinite(value[1])) {
    // ±oo/±oo
    if (!Number.isFinite(value[0])) return NaN;
    return 0;
  }
  // // ±oo/a
  if (typeof value[0] === 'number' && !Number.isFinite(value[0])) {
    const sign = value[0] > 0 ? +1 : -1;
    if (value[0] > 0) return sign > 0 ? +Infinity : -Infinity;
    if (value[0] < 0) return sign > 0 ? -Infinity : +Infinity;
    return NaN;
  }

  return ce._numericValue(value);
}

function canonicalNumberString(
  ce: ComputeEngine,
  s: string
): number | NumericValue {
  s = s.toLowerCase();

  // Remove trailing "n" or "d" letter (from legacy version of MathJSON spec)
  if (/[0-9][nd]$/.test(s)) s = s.slice(0, -1);

  // Remove any whitespace:
  // Tab, New Line, Vertical Tab, Form Feed, Carriage Return, Space, Non-Breaking Space
  s = s.replace(/[\u0009-\u000d\u0020\u00a0]/g, '');

  // Special case some common values to share boxed instances
  if (s === 'nan') return NaN;
  if (s === 'infinity' || s === '+infinity' || s === 'oo' || s === '+oo')
    return Number.POSITIVE_INFINITY;
  if (s === '-infinity' || s === '-oo') return Number.NEGATIVE_INFINITY;
  if (s === '0') return 0;
  if (s === '1') return 1;
  if (s === '-1') return -1;

  // Do we have repeating digits?
  if (/\([0-9]+\)/.test(s)) {
    const [_, body, repeat, trail] = s.match(/(.+)\(([0-9]+)\)(.+)?$/) ?? [];
    // @todo we probably shouldn't be using the ce.precision since it may change later
    s =
      body +
      repeat.repeat(Math.ceil(ce.precision / repeat.length)) +
      (trail ?? '');
  }

  // Does this look like an integer?
  const n = bigint(s);
  if (n !== null) {
    if (n >= -SMALL_INTEGER && n <= SMALL_INTEGER) return Number(n);
    return ce._numericValue(n);
  }

  return ce._numericValue(ce.bignum(s));
}
