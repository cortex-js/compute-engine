import Complex from 'complex.js';
import { Decimal } from 'decimal.js';
import {
  BoxedExpression,
  BoxedDomain,
  IComputeEngine,
  Metadata,
  PatternMatchOptions,
  BoxedSubstitution,
  EvaluateOptions,
  SemiBoxedExpression,
  Type,
  BoxedRuleSet,
  ReplaceOptions,
  Rule,
  Substitution,
  CanonicalOptions,
  SimplifyOptions,
} from '../public';
import { inferNumericDomain } from '../domain-utils';
import { Rational } from '../numerics/rationals';

import { _BoxedExpression } from './abstract-boxed-expression';
import { hashCode } from './utils';
import { Expression, MathJsonNumber } from '../../math-json';
import { asSmallInteger, signDiff } from './numerics';
import { match } from './match';
import { canonicalDivide } from '../library/arithmetic-divide';
import { NumericValue, NumericValueData } from '../numeric-value/public';
import { mul } from '../library/arithmetic-multiply';
import {
  canonicalInteger,
  SMALL_INTEGER,
  SmallInteger,
} from '../numerics/numeric';
import { add } from './terms';
import { bigint } from '../numerics/numeric-bigint';
import { isInMachineRange } from '../numerics/numeric-bignum';
import { xreplace } from '../rules';
import { simplify } from '../symbolic/simplify';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value';

/**
 * BoxedNumber
 *
 * @noInheritDoc
 */

export class BoxedNumber extends _BoxedExpression {
  // The value of a BoxedNumber is either a small integer or a NumericValue
  protected readonly _value: SmallInteger | NumericValue;

  private _domain: BoxedDomain | undefined;
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
    ce: IComputeEngine,
    value: SmallInteger | NumericValue | NumericValueData,
    options?: { metadata?: Metadata; canonical?: boolean }
  ) {
    super(ce, options?.metadata);
    if (value instanceof NumericValue || typeof value === 'number')
      this._value = value;
    else this._value = ce._numericValue(value);
  }

  get hash(): number {
    this._hash ??= hashCode(this._value.toString());
    console.info('hash BoxedNumber ', this._hash);
    return this._hash;
  }

  get json(): Expression {
    // Note: the `.json` property outputs a "default" serialization
    // which does not attempt to capture all the information in the expression.
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

    return value.toJSON();
  }

  get operator(): string {
    // @fixme: return 'Number', 'Integer', 'Rational', 'Real'
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

  get numericValue(): number | NumericValue {
    return this._value;
  }

  get re(): number | undefined {
    if (typeof this._value === 'number') return this._value;
    return this._value.re;
  }
  get im(): number | undefined {
    if (typeof this._value === 'number') return 0;
    return this._value.im;
  }
  get bignumRe(): Decimal | undefined {
    if (typeof this._value === 'number') return undefined;
    return this._value.bignumRe;
  }
  get bignumIm(): Decimal | undefined {
    return undefined;
  }

  neg(): BoxedExpression {
    const n = this._value;
    if (n === 0) return this;

    if (typeof n === 'number') return this.engine.number(-n);

    return this.engine.number(n.neg());
  }

  inv(): BoxedExpression {
    if (this.value === 1 || this.value === -1) return this;
    if (typeof this._value === 'number') {
      if (!Number.isInteger(this._value))
        return this.engine.number(1 / this._value);
      return this.engine.number(
        this.engine._numericValue({ rational: [1, this._value] })
      );
    }
    return this.engine.number(this._value.inv());
  }

  abs(): BoxedExpression {
    if (this.isPositive) return this;
    if (typeof this._value === 'number')
      return this.engine.number(-this._value);

    return this.engine.number(this._value.abs());
  }

  add(rhs: number | BoxedExpression): BoxedExpression {
    const ce = this.engine;
    if (this.isZero) return ce.box(rhs);
    if (typeof rhs === 'number') {
      // @fastpath
      if (rhs === 0) return this;
      if (typeof this._value === 'number') return ce.number(this._value + rhs);

      return ce.number(this._value.add(rhs));
    }
    if (rhs.numericValue !== null) {
      // @fastpath
      if (typeof this._value === 'number') {
        if (typeof rhs.numericValue === 'number')
          return ce.number(this._value + rhs.numericValue);
        return ce.number(rhs.numericValue.add(this._value));
      }

      return ce.number(this._value.add(rhs.numericValue));
    }
    return add(this.canonical, rhs.canonical);
  }

  mul(rhs: NumericValue | number | BoxedExpression): BoxedExpression {
    if (this.isOne) return this.engine.box(rhs);
    if (this.isNegativeOne) return this.engine.box(rhs).neg();

    const ce = this.engine;

    // @fastpath
    if (typeof rhs === 'number') {
      if (rhs === 1) return this;
      if (rhs === 0 || this.isZero) return this.engine.Zero;
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
      if (this.isOne) return ce.number(rhs);
      if (this.isNegativeOne) return ce.number(rhs.neg());
      return ce.number(rhs.mul(this._value));
    }

    if (rhs.numericValue !== null)
      return ce.number(ce._numericValue(this._value).mul(rhs.numericValue));

    return mul(this, rhs);
  }

  div(rhs: number | BoxedExpression): BoxedExpression {
    if (typeof rhs === 'number') {
      if (rhs === 1) return this;
      if (rhs === -1) return this.neg();
      if (rhs === 0) return this.engine.NaN;
      if (isNaN(rhs)) return this.engine.NaN;
      // @fastpath
      if (typeof this._value === 'number')
        return this.engine.number(this._value / rhs);
      rhs = this.engine.number(rhs);
    }
    if (this.isNaN || rhs.isNaN) return this.engine.NaN;
    if (this.isZero && rhs.isZero) return this.engine.NaN;
    if (this.isZero && rhs.isFinite) return this.engine.Zero;

    if (rhs.numericValue !== null) {
      const ce = this.engine;
      const n = ce._numericValue(this._value);
      return ce.number(n.div(rhs.numericValue));
    }
    return canonicalDivide(this, rhs);
  }

  pow(exp: number | BoxedExpression): BoxedExpression {
    if (!this.isCanonical) return this.canonical.pow(exp);

    if (typeof exp !== 'number') exp = exp.canonical;

    const e = typeof exp === 'number' ? exp : exp.im === 0 ? exp.re : undefined;

    const ce = this.engine;
    if (e === 0) return ce.One;
    if (e === 1) return this;
    if (e === -1) return this.inv();
    if (exp === 0.5) return this.sqrt();
    if (exp === -0.5) return this.sqrt().inv();
    if (e === Number.POSITIVE_INFINITY) {
      if (this.isGreater(1)) return ce.PositiveInfinity;
      if (this.isPositive && this.isLess(1)) return ce.Zero;
    }
    if (e === Number.NEGATIVE_INFINITY) {
      if (this.isGreater(1)) return ce.Zero;
      if (this.isPositive && this.isLess(1)) return ce.PositiveInfinity;
    }

    if (exp === 2) {
      if (typeof this._value === 'number')
        return ce.number(this._value * this._value);
      return ce.number(this._value.pow(2));
    }

    if (typeof exp !== 'number' && exp.operator === 'Negate')
      return this.pow(exp.op1).inv();

    if (e !== undefined) {
      if (typeof this._value === 'number')
        return ce.number(Math.pow(this._value, e));
      return ce.number(this._value.pow(e));
    }

    // Could be a complex exponent...
    if (typeof this._value !== 'number')
      if (typeof exp !== 'number' && exp.numericValue !== null)
        return ce.number(this._value.pow(exp.numericValue));

    return ce._fn('Power', [this, ce.box(exp)]);
  }

  root(exp: number | BoxedExpression): BoxedExpression {
    if (!this.isCanonical) return this.canonical.root(exp);

    if (typeof exp !== 'number') exp = exp.canonical;

    const e = typeof exp === 'number' ? exp : exp.im === 0 ? exp.re : undefined;

    if (e === 0) return this.engine.NaN;
    if (e === 1) return this;
    if (e === -1) return this.inv();
    if (e === 2) return this.sqrt();
    if (typeof this._value === 'number') {
      if (e === 3) this.engine.number(Math.cbrt(this._value));
      const n = asSmallInteger(exp);
      if (n !== null) return this.engine.number(Math.pow(this._value, 1 / n));
      return this.engine.function('Root', [this, this.engine.box(exp)]);
    }
    const n = asSmallInteger(exp);
    if (n === null)
      return this.engine.function('Root', [this, this.engine.box(exp)]);
    return this.engine.number(this._value.root(n));
  }

  sqrt(): BoxedExpression {
    // @fastpath
    if (typeof this._value === 'number') {
      if (this._value === 0 || this._value === 1) return this;
      if (this._value === -1) return this.engine.I;

      if (this._value > 0 && Number.isInteger(this._value))
        return this.engine.number(
          this.engine._numericValue({ radical: this._value })
        );

      return this.engine.number(this.engine._numericValue(this._value).sqrt());
    }
    if (this.isZero || this.isOne) return this;

    return this.engine.number(this._value.sqrt());
  }

  ln(semiBase?: SemiBoxedExpression): BoxedExpression {
    const base = semiBase ? this.engine.box(semiBase) : undefined;
    if (!this.isCanonical) return this.canonical.ln(base);

    // Mathematica returns `Log[0]` as `-∞`
    if (this.isZero) return this.engine.NegativeInfinity;

    if (base && this.isEqual(base)) return this.engine.One;
    if (
      (!base || base.symbol === 'ExponentialE') &&
      this.symbol === 'ExponentialE'
    )
      return this.engine.One;

    const f = this.re;
    if (f !== undefined && Number.isInteger(f) && f > 0) {
      const ce = this.engine;
      let [factor, root] = canonicalInteger(f, 3);
      if (factor !== 1)
        return ce.number(factor).ln(base).mul(3).add(ce.number(root).ln(base));
      [factor, root] = canonicalInteger(f, 2);
      if (factor !== 1)
        return ce.number(factor).ln(base).mul(2).add(ce.number(root).ln(base));
    }

    if (base && base.type === 'integer') {
      if (typeof this._value === 'number')
        return this.engine.number(Math.log(this._value) / Math.log(base.re!));
      return this.engine.number(this._value.ln(base.re!));
    }

    if (base === undefined) {
      if (typeof this._value === 'number')
        return this.engine.number(Math.log(this._value));
      return this.engine.number(this._value.ln());
    }

    return this.engine._fn('Ln', [this]);
  }

  get domain(): BoxedDomain {
    this._domain ??= this.engine.domain(inferNumericDomain(this._value));
    return this._domain;
  }

  get type(): Type {
    if (typeof this._value === 'number')
      return Number.isInteger(this._value) ? 'integer' : 'real';
    return this._value.type;
  }

  get sgn(): -1 | 0 | 1 | undefined | typeof NaN {
    if (this._value === 0) return 0;

    if (typeof this._value === 'number') {
      const s = Math.sign(this._value);
      return Number.isNaN(s) ? NaN : (s as -1 | 0 | 1);
    }
    return this._value.sgn() ?? NaN;
  }

  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;

    //
    // Make a structural comparison if necessary
    // For example, to compare a rational 3/4 with an expression
    //  ['Rational, 3, 4]
    //
    const lhs = this.structural;
    if (!(lhs instanceof BoxedNumber)) return lhs.isSame(rhs.structural);
    rhs = rhs.structural;
    if (!(rhs instanceof BoxedNumber)) return false;

    //
    // Compare two rational numbers
    //
    if (typeof this._value === 'number') {
      if (typeof rhs._value === 'number') return this._value === rhs._value;
      return rhs._value.im === 0 && this._value === rhs._value.re;
    }

    if (typeof rhs._value === 'number')
      return this._value.im === 0 && this._value.re === rhs._value;

    const ce = this.engine;
    const rhsV = ce._numericValue(rhs._value);

    return this._value.eq(rhsV);
  }

  isEqual(rhs: number | BoxedExpression): boolean {
    // Note: this is not the same as `isSame()`: we want 0.09 and 9/100
    // to be considered equal.
    // We also want a number to be equal to an exact expression, so don't
    // bail if rhs is not a BoxedNumber
    // Note: signDiff() uses the tolerance of the engine by default
    if (typeof rhs === 'number') return this.im === 0 && this.re === rhs;

    return this === rhs || signDiff(this, rhs) === 0;
  }

  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): BoxedExpression {
    if (this.isStructural) return this;
    return this.structural.subs(sub, options);
  }

  replace(
    rules: BoxedRuleSet | Rule | Rule[],
    options?: Partial<ReplaceOptions>
  ): BoxedExpression | null {
    // Apply the replace on the structural version of the number.
    // This will allow transformations to be applied on ["Rational", 3, 4]
    // for example.
    return xreplace(this.structural, rules, options).at(-1)?.value ?? null;
  }

  match(
    pattern:
      | Decimal
      | Complex
      | [num: number, denom: number]
      | SemiBoxedExpression
      | BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return match(this.structural, pattern, options);
  }

  isLess(rhs: number | BoxedExpression): boolean | undefined {
    if (typeof rhs === 'number') {
      if (typeof this._value === 'number') return this._value < rhs;
      return this._value.re < rhs;
    }
    const s = signDiff(this, rhs);
    if (s === undefined) return undefined;
    return s < 0;
  }

  isLessEqual(rhs: number | BoxedExpression): boolean | undefined {
    if (typeof rhs === 'number') {
      if (typeof this._value === 'number') return this._value <= rhs;
      return this._value.re <= rhs;
    }
    const s = signDiff(this, rhs);
    if (s === undefined) return undefined;
    return s <= 0;
  }

  isGreater(rhs: number | BoxedExpression): boolean | undefined {
    if (typeof rhs === 'number') {
      if (typeof this._value === 'number') return this._value > rhs;
      return this._value.re > rhs;
    }
    return rhs.isLessEqual(this);
  }

  isGreaterEqual(rhs: number | BoxedExpression): boolean | undefined {
    if (typeof rhs === 'number') {
      if (typeof this._value === 'number') return this._value >= rhs;
      return this._value.re >= rhs;
    }
    return rhs.isLess(this);
  }

  /** x > 0, same as `isGreater(0)` */
  get isPositive(): boolean | undefined {
    if (typeof this._value === 'number') return this._value > 0;
    const s = this.sgn;
    if (s === undefined || s === null) return undefined;
    return s > 0;
  }

  /** x >= 0, same as `isGreaterEqual(0)` */
  get isNonNegative(): boolean | undefined {
    if (typeof this._value === 'number') return this._value >= 0;
    const s = this.sgn;
    if (s === undefined || s === null) return undefined;
    return s >= 0;
  }

  /** x < 0, same as `isLess(0)` */
  get isNegative(): boolean | undefined {
    if (typeof this._value === 'number') return this._value < 0;
    const s = this.sgn;
    if (s === undefined || s === null) return undefined;
    return s < 0;
  }

  /** x <= 0, same as `isLessEqual(0)` */
  get isNonPositive(): boolean | undefined {
    if (typeof this._value === 'number') return this._value <= 0;
    const s = this.sgn;
    if (s === undefined || s === null) return undefined;
    return s <= 0;
  }

  get isZero(): boolean {
    if (this._value === 0) return true;
    if (typeof this._value === 'number') return false;
    return this._value.isZero;
  }

  get isNotZero(): boolean {
    if (this._value === 0) return false;
    if (typeof this._value === 'number') return true;

    return !this._value.isZero;
  }

  get isOne(): boolean {
    if (this._value === 1) return true;
    if (typeof this._value === 'number') return false;

    return this._value.isOne;
  }

  get isNegativeOne(): boolean {
    if (this._value === -1) return true;
    if (typeof this._value === 'number') return false;

    return this._value.isNegativeOne;
  }

  get isOdd(): boolean | undefined {
    if (this.isOne || this.isNegativeOne) return true;
    if (this.isZero) return false;

    if (!this.isInteger) return false;

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
    return !this.isInfinity && !this.isNaN;
  }

  get isNumber(): true {
    return true;
  }

  get isInteger(): boolean {
    if (typeof this._value === 'number') return Number.isInteger(this._value);

    return this._value.type === 'integer';
  }

  get isRational(): boolean {
    if (typeof this._value === 'number') return Number.isInteger(this._value);
    const t = this._value.type;
    // Every integer is also a rational
    return t === 'integer' || t === 'rational';
  }

  get isReal(): boolean {
    if (typeof this._value === 'number') return true;
    // If it's 'complex', it has an imaginary part, otherwise it's real
    return this._value.type !== 'complex';
  }

  get isComplex(): boolean | undefined {
    // A real number, or an imaginary number
    // isFinite
    return !this.isNaN;
  }

  get isImaginary(): boolean | undefined {
    if (typeof this._value === 'number') return false;
    return this._value.im !== 0;
  }

  get canonical(): BoxedExpression {
    return this;
  }

  get isStructural(): boolean {
    if (typeof this._value === 'number') return true;
    if (this.type === 'integer' || this.type === 'rational') return true;
    if (this._value instanceof ExactNumericValue) return false;
    return true;
  }

  get structural(): BoxedExpression {
    if (this.isStructural) return this;
    return this.engine.box(this.json, { canonical: false, structural: true });
  }

  toNumericValue(): [NumericValue, BoxedExpression] {
    const v = this._value;
    if (typeof v === 'number')
      return [this.engine._numericValue(v), this.engine.One];

    return [v, this.engine.One];
  }

  simplify(options?: Partial<SimplifyOptions>): BoxedExpression {
    const results = simplify(this.canonical.structural, options);

    if (results.length === 0) return this;
    return results[results.length - 1].value;
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    if (options?.numericApproximation) return this.N();
    return this;
  }

  N(): BoxedExpression {
    const v = this._value;
    if (typeof v === 'number') return this;
    const n = v.N();
    if (v === n) return this;
    return this.engine.number(n);
  }
}

export function canonicalNumber(
  ce: IComputeEngine,
  value:
    | number
    | bigint
    | string
    | Decimal
    | Complex
    | Rational
    | NumericValue
    | MathJsonNumber
): number | NumericValue {
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

    return ce._numericValue(value);
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
  ce: IComputeEngine,
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
  if (s === 'infinity' || s === '+infinity') return Number.POSITIVE_INFINITY;
  if (s === '-infinity') return Number.NEGATIVE_INFINITY;
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
    if (n >= Number.MIN_SAFE_INTEGER && n <= Number.MAX_SAFE_INTEGER)
      return Number(n);
    return ce._numericValue(n);
  }

  // This could be a real in the machine range
  const b = ce.bignum(s);
  return isInMachineRange(b) ? b.toNumber() : ce._numericValue(b);
}
