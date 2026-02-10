import { Decimal } from 'decimal.js';

import { type BigNumFactory, Rational, SmallInteger } from '../numerics/types';
import { canonicalInteger, gcd, SMALL_INTEGER } from '../numerics/numeric';
import {
  isOne,
  isZero,
  reducedRational,
  neg,
  isPositive,
  isInteger,
  isNegativeOne,
  rationalAsFloat,
  add,
  mul,
  isMachineRational,
  rationalGcd,
} from '../numerics/rationals';
import {
  ExactNumericValueData,
  NumericValue,
  NumericValueFactory,
} from './types';
import { MathJsonExpression as Expression } from '../../math-json/types';
import { numberToExpression } from '../numerics/expression';
import { numberToString } from '../numerics/strings';
import { NumericPrimitiveType } from '../../common/type/types';
import { isSubtype } from '../../common/type/subtype';

/**
 * An ExactNumericValue is the sum of a Gaussian imaginary and the product of
 * a rational number and a square root:
 *
 *     a/b * sqrt(c) + ki where a, b, c and k are integers
 *
 * Note that ExactNumericValue does not "know" about BigNumericValue, but
 * BigNumericValue "knows" about ExactNumericValue.
 *
 */
export class ExactNumericValue extends NumericValue {
  __brand: 'ExactNumericValue';

  rational: Rational;
  radical: number; // An integer > 0

  // For exact numeric values, the imaginary part is always 0
  im = 0;

  factory: NumericValueFactory;
  bignum: BigNumFactory;

  /** The caller is responsible to make sure the input is valid, i.e.
   * - rational is a fraction of integers (but it may not be reduced)
   * - radical is an integer
   */
  constructor(
    value: number | bigint | ExactNumericValueData,
    factory: NumericValueFactory,
    bignum: BigNumFactory
  ) {
    super();
    this.factory = factory;
    this.bignum = bignum;

    if (typeof value === 'number') {
      console.assert(!Number.isFinite(value) || Number.isInteger(value));
      this.rational = [value, 1];
      this.radical = 1;
      return;
    }

    if (typeof value === 'bigint') {
      this.rational = [value, BigInt(1)];
      this.radical = 1;
      return;
    }

    console.assert(typeof value !== 'object' || !('im' in value));

    const decimal: bigint | number = 1;

    console.assert(typeof decimal !== 'number' || Number.isInteger(decimal));

    if (decimal == 0) {
      this.rational = [0, 1];
      this.radical = 1;
      return;
    }

    let rational: Rational = value.rational
      ? ([...value.rational] as Rational)
      : ([1, 1] as const);
    if (decimal != 1) {
      if (typeof decimal === 'bigint')
        rational = mul(rational, [decimal, BigInt(1)]);
      else rational = mul(rational, [decimal as number, 1]);
    }
    this.rational = rational;

    this.radical = value.radical ?? 1;
    console.assert(this.radical <= SMALL_INTEGER && this.radical >= 1);

    this.normalize();
  }

  get type(): NumericPrimitiveType {
    if (this.isNaN) return 'number';
    // a/b√c -> real number (c can't be a perfect square)
    if (this.isPositiveInfinity || this.isNegativeInfinity)
      return 'non_finite_number';
    if (this.radical !== 1) {
      console.assert(!isZero(this.rational));
      return 'finite_real';
    }
    return isInteger(this.rational) ? 'finite_integer' : 'finite_rational';
  }

  get isExact(): boolean {
    return true;
  }

  get asExact(): NumericValue | undefined {
    return this;
  }

  toJSON(): Expression {
    if (this.isNaN) return 'NaN';
    if (this.isPositiveInfinity) return 'PositiveInfinity';
    if (this.isNegativeInfinity) return 'NegativeInfinity';
    if (this.isZero) return 0;
    if (this.isOne) return 1;
    if (this.isNegativeOne) return -1;

    // ExactNumericValue are always real
    // if (this.isComplexInfinity) return 'ComplexInfinity';

    const rationalExpr = (r: Rational) => {
      if (isInteger(r)) return numberToExpression(r[0]);
      return [
        'Rational',
        numberToExpression(r[0]),
        numberToExpression(r[1]),
      ] as Expression;
    };

    // Only have a rational
    if (this.radical === 1) return rationalExpr(this.rational);

    // Only have a radical
    if (isOne(this.rational)) return ['Sqrt', this.radical];
    if (isNegativeOne(this.rational)) return ['Negate', ['Sqrt', this.radical]];

    // Have both a radical and a rational

    if (this.rational[0] == 1)
      return [
        'Divide',
        ['Sqrt', this.radical],
        numberToExpression(this.rational[1]),
      ];
    if (this.rational[0] == -1)
      return [
        'Negate',
        [
          'Divide',
          ['Sqrt', this.radical],
          numberToExpression(this.rational[1]),
        ],
      ];

    return ['Multiply', rationalExpr(this.rational), ['Sqrt', this.radical]];
  }

  clone(value: number | ExactNumericValueData): ExactNumericValue {
    return new ExactNumericValue(value, this.factory, this.bignum);
  }

  /** Object.toString() */
  toString(): string {
    if (this.isZero) return '0';
    if (this.isOne) return '1';
    if (this.isNegativeOne) return '-1';

    const rationalStr = (r: Rational) => {
      if (isInteger(r)) return numberToString(r[0]);

      return `${numberToString(r[0])}/${numberToString(r[1])}`;
    };

    // Only have a rational
    if (this.radical === 1) return rationalStr(this.rational);

    const radicalStr = (r: number) => `sqrt(${numberToString(r)})`;

    // Only have a radical
    // 1√b = √b
    if (isOne(this.rational)) return radicalStr(this.radical);
    // -1√b = -√b
    if (isNegativeOne(this.rational)) return `-${radicalStr(this.radical)}`;
    // 1/a√b = √b/a
    if (this.rational[0] == 1)
      return `${radicalStr(this.radical)}/${numberToString(this.rational[1])}`;
    if (this.rational[0] == -1)
      return `-${radicalStr(this.radical)}/${numberToString(this.rational[1])}`;

    // Have both a radical and a rational
    return `${rationalStr(this.rational)}${radicalStr(this.radical)}`;
  }

  get sign(): -1 | 0 | 1 {
    if (isZero(this.rational)) return 0;
    if (isPositive(this.rational)) return 1;
    return -1;
  }

  get re(): number {
    return rationalAsFloat(this.rational) * Math.sqrt(this.radical);
  }

  get bignumRe(): Decimal {
    let result: Decimal;
    const r = this.rational;
    if (isMachineRational(r)) result = this.bignum(r[0]).div(r[1]);
    else
      result = this.bignum(r[0].toString()).div(this.bignum(r[1].toString()));
    if (this.radical === 1) return result;
    return result.mul(this.bignum(this.radical).sqrt());
  }

  get numerator(): ExactNumericValue {
    if (this.rational[1] == 1) return this;
    return this.clone({
      rational: isMachineRational(this.rational)
        ? [this.rational[0], 1]
        : [this.rational[0], BigInt(1)],
      radical: this.radical,
    });
  }

  get denominator(): ExactNumericValue {
    if (isMachineRational(this.rational)) return this.clone(this.rational[1]);
    return this.clone({ rational: [this.rational[1], BigInt(1)] });
  }

  normalize(): void {
    console.assert(
      Number.isInteger(this.radical) &&
        this.radical > 0 &&
        Number.isFinite(this.radical)
    );

    //
    // Note: the order of the operations is significant
    //

    //
    // 1/ Propagate NaN
    //
    if (isNaN(this.radical)) {
      this.rational = [NaN, 1];
      this.radical = 1;
      return;
    }
    // a/0 -> NaN
    const [n, d] = this.rational;
    // Use double equal to catch both number and bigint
    if (d == 0) {
      this.rational = [NaN, 1];
      this.radical = 1;
      return;
    }

    //
    // 2/ Is the rational or radical zero?
    //
    if (this.radical === 0 || n === 0) {
      this.rational = [0, 1];
      this.radical = 1;
      return;
    }

    //
    // 3/ If sqrt is a product of exact square, simplify
    // sqrt(75) = sqrt(25 * 3) = 5 * sqrt(3)
    //
    if (this.radical >= 4) {
      const [factor, root] = canonicalInteger(this.radical, 2);
      if (typeof this.rational[0] === 'number') this.rational[0] *= factor;
      else this.rational = mul(this.rational, [factor, 1]);
      this.radical = root;
    }

    //
    // 3/ Reduce rational
    //

    this.rational = reducedRational(this.rational);
  }

  get isNaN(): boolean {
    return Number.isNaN(this.rational[0]);
  }

  get isPositiveInfinity(): boolean {
    return this.rational[0] == Infinity;
  }

  get isNegativeInfinity(): boolean {
    return this.rational[0] == -Infinity;
  }

  get isComplexInfinity(): boolean {
    return false;
  }

  get isZero(): boolean {
    return isZero(this.rational);
  }

  get isOne(): boolean {
    if (this.rational[0] !== this.rational[1]) return false;
    if (this.radical !== 1) return false;
    return true;
  }

  get isNegativeOne(): boolean {
    if (this.rational[0] !== -this.rational[1]) return false;
    if (this.radical !== 1) return false;
    return true;
  }

  sgn(): -1 | 0 | 1 | undefined {
    if (Number.isNaN(this.rational[0])) return undefined;
    if (isZero(this.rational)) return 0;
    return isPositive(this.rational) ? 1 : -1;
  }

  N(): NumericValue {
    if (this.isZero || this.isOne || this.isNegativeOne) return this;
    if (this.rational[1] == 1 && this.radical === 1) return this;
    return this.factory(this.bignumRe);
  }

  neg(): ExactNumericValue {
    if (this.isZero) return this;
    return this.clone({
      rational: neg(this.rational),
      radical: this.radical,
    });
  }

  inv(): NumericValue {
    if (this.isOne) return this;
    if (this.isNegativeOne) return this;

    // inv(a/b√c) = b/(a√c) = (b√c)/(ac) = (b/ac)√c

    return this.clone({
      rational: isMachineRational(this.rational)
        ? [this.rational[1], this.rational[0] * this.radical]
        : [this.rational[1], this.rational[0] * BigInt(this.radical)],
      radical: this.radical,
    });
  }

  add(other: number | NumericValue): NumericValue {
    if (typeof other === 'number') {
      if (other === 0) return this;
      if (Number.isInteger(other) && this.radical === 1)
        return this.clone({
          rational: isMachineRational(this.rational)
            ? [this.rational[0] + other * this.rational[1], this.rational[1]]
            : [
                this.rational[0] + BigInt(other) * this.rational[1],
                this.rational[1],
              ],
        });
      return this.factory(this.bignumRe).add(other);
    }
    if (other.isZero) return this;
    if (this.isZero) return other;

    if (!(other instanceof ExactNumericValue)) return other.add(this);

    // Can we keep a rational result?
    // Yes, if both numbers are rational and have the same radical

    if (this.radical === other.radical) {
      return this.clone({
        rational: add(this.rational, other.rational),
        radical: this.radical,
      });
    }

    return this.factory(this.bignumRe).add(other);
  }

  sub(other: NumericValue): NumericValue {
    return this.add(other.neg());
  }

  mul(other: number | Decimal | NumericValue): NumericValue {
    if (other === 0) {
      if (this.isPositiveInfinity || this.isNegativeInfinity || this.isNaN)
        return this.clone(NaN);
      return this.clone(0);
    }
    if (other === 1) return this;
    if (other === -1) return this.neg();
    if (typeof other === 'number') {
      if (Number.isInteger(other))
        return this.clone({
          rational: isMachineRational(this.rational)
            ? [this.rational[0] * other, this.rational[1]]
            : [this.rational[0] * BigInt(other), this.rational[1]],
          radical: this.radical,
        });
      return this.factory(this.bignumRe).mul(other);
    }
    if (other instanceof Decimal) return this.factory(other).mul(this);
    if (other.im !== 0) return other.mul(this);

    if (other.isZero) {
      if (this.isPositiveInfinity || this.isNegativeInfinity || this.isNaN)
        return this.clone(NaN);
      return other;
    }
    if (other.isOne) return this;
    if (other.isNegativeOne) return this.neg();
    if (other.isNaN) return other;

    if (this.isZero) {
      if (
        other.isPositiveInfinity ||
        other.isNegativeInfinity ||
        other.isComplexInfinity ||
        other.isNaN
      )
        return this.clone(NaN);
      return this;
    }
    if (this.isOne) return other;
    if (this.isNegativeOne) return other.neg();

    if (!(other instanceof ExactNumericValue)) return other.mul(this);

    return this.clone({
      rational: mul(this.rational, other.rational),
      radical: this.radical * other.radical,
    });
  }

  div(other: SmallInteger | NumericValue): NumericValue {
    if (typeof other === 'number') {
      if (other === 1) return this;
      if (other === -1) return this.neg();
      if (other === 0) return this.clone(NaN);
      return this.clone({
        rational: isMachineRational(this.rational)
          ? [this.rational[0], this.rational[1] * other]
          : [this.rational[0], this.rational[1] * BigInt(other)],
        radical: this.radical,
      });
    }

    if (other.isOne) return this;
    if (other.isNegativeOne) return this.neg();
    if (this.isZero) {
      if (other.isZero) return this.clone(NaN);
      return other.isNaN ? other : this;
    }
    if (other.isNaN) return other;
    if (other.isZero) return this.clone(this.sign * Infinity);

    if (!(other instanceof ExactNumericValue))
      return this.factory(this.bignumRe).div(other);

    if (other.im !== 0) return this.factory(this.bignumRe).div(other);

    // (a/b √c) / (d/e √f) = (ae/bdf) * √(cf)
    let rational: Rational;
    if (isMachineRational(this.rational) && isMachineRational(other.rational)) {
      const [a, b] = this.rational;
      const [d, e] = other.rational;
      rational = [a * e, b * d * other.radical];
    } else {
      rational = mul(this.rational, [
        BigInt(other.rational[1]),
        BigInt(other.rational[0]) * BigInt(other.radical),
      ]);
    }
    return this.clone({ rational, radical: this.radical * other.radical });
  }

  pow(
    exponent: number | NumericValue | { re: number; im: number }
  ): NumericValue {
    console.assert(!Array.isArray(exponent));
    // if (Array.isArray(exponent)) exponent = exponent[0] / exponent[1];

    if (this.isNaN) return this;
    if (typeof exponent === 'number' && isNaN(exponent)) return this.clone(NaN);

    if (exponent instanceof NumericValue) {
      if (exponent.isNaN) return this.clone(NaN);
      if (exponent.isZero) return this.clone(1);
      if (exponent.isOne) return this;
      if (exponent.im) {
        exponent = { re: exponent.re, im: exponent.im };
      } else {
        if (exponent instanceof ExactNumericValue) {
          if (exponent.radical === 1 && exponent.rational[0] == 1)
            return this.root(exponent.rational[0]);
        }
        exponent = exponent.re;
      }
    }

    // Special case square root, where we try to preserve the rational part
    if (exponent === 0.5) return this.sqrt();

    //
    // For the special cases we implement the same (somewhat arbitrary) results
    // as sympy. See https://docs.sympy.org/1.6/modules/core.html#pow
    //

    // If the exponent is a complex number, we use the formula:
    // z^w = (r^w) * (cos(wθ) + i * sin(wθ)),
    // where z = r * (cos(θ) + i * sin(θ))

    // Complex Exponent -> float result, use factory
    if (typeof exponent === 'object' && ('re' in exponent || 'im' in exponent))
      return this.factory(this.bignumRe).pow(exponent);

    if (this.isPositiveInfinity) {
      if (exponent === -1) return this.clone(0);
      if (exponent === Infinity) return this.clone(Infinity);
      if (exponent === -Infinity) return this.clone(0);
    } else if (this.isNegativeInfinity && exponent === Infinity)
      return this.clone(NaN);

    if (
      (exponent === Infinity || exponent === -Infinity) &&
      (this.isOne || this.isNegativeOne)
    )
      return this.clone(NaN);

    if (exponent === 1) return this;
    if (exponent === -1) return this.inv();

    if (exponent === 0) return this.clone(1);

    if (this.isZero) {
      if (exponent > 0) return this; // 0^x = 0 when x > 0
      if (exponent < 0) return this.factory({ im: Infinity }); // Complex/unsigned infinity
    }

    if (exponent < 0) return this.pow(-exponent).inv();

    // Is it a multiple of square root?
    // Decompose to try to preserve the rational part
    if (exponent % 1 === 0.5)
      return this.pow(Math.floor(exponent)).mul(this.sqrt());

    // If the parts (rational or radical) are too large, we convert to float
    if (
      this.radical > SMALL_INTEGER ||
      this.rational[0] > SMALL_INTEGER ||
      this.rational[0] < -SMALL_INTEGER ||
      this.rational[1] > SMALL_INTEGER
    )
      return this.factory(this.bignumRe).pow(exponent);

    if (this.sign < 0) {
      if (Number.isInteger(exponent)) {
        const sign = exponent % 2 === 0 ? 1 : -1;
        return this.clone({
          rational: isMachineRational(this.rational)
            ? [
                sign * (-this.rational[0]) ** exponent,
                this.rational[1] ** exponent,
              ]
            : [
                BigInt(sign) * (-this.rational[0]) ** BigInt(exponent),
                this.rational[1] ** BigInt(exponent),
              ],
          radical: this.radical ** exponent,
        });
      }
      return this.factory({ im: (-this.re) ** exponent });
    } else {
      if (Number.isInteger(exponent)) {
        return this.clone({
          rational: isMachineRational(this.rational)
            ? [this.rational[0] ** exponent, this.rational[1] ** exponent]
            : [
                BigInt(this.rational[0]) ** BigInt(exponent),
                this.rational[1] ** BigInt(exponent),
              ],
          radical: this.radical ** exponent,
        });
      }
    }
    return this.factory(this.bignumRe).pow(exponent);
  }

  root(exponent: number): NumericValue {
    if (exponent === 0) return this.clone(NaN);

    if (this.isNaN) return this;
    if (this.isZero) return this;
    if (exponent === 1) return this;
    if (exponent === -1) return this.inv();

    if (exponent < 0) return this.root(-exponent).inv();

    // Is it a multiple of square root?
    // Decompose to try to preserve the rational part
    if (exponent % 1 === 0.5) return this.root(Math.floor(exponent)).sqrt();

    if (this.radical === 1) {
      if (this.sign > 0) {
        const re = this.re;
        if (Number.isInteger(re)) {
          if (re > 0) {
            const root = Math.pow(re, 1 / exponent);
            if (Number.isInteger(root)) return this.clone(root);
          }
          return this.factory(this.bignumRe).root(exponent);
        }
      }
      return this.factory(this.bignumRe).root(exponent);
    }

    if (this.sign < 0)
      return this.factory({ im: Math.pow(-this.re, 1 / exponent) });

    // If the parts (rational or radical) are too large, we convert to float
    if (
      this.radical > SMALL_INTEGER ||
      this.rational[0] > SMALL_INTEGER ||
      this.rational[0] < -SMALL_INTEGER ||
      this.rational[1] > SMALL_INTEGER
    )
      return this.factory(this.bignumRe).root(exponent);

    if (this.rational[1] == 1) {
      const root = Math.pow(this.rational[0] as number, 1 / exponent);
      if (Number.isInteger(root)) return this.clone(root);
    }

    return this.factory(this.bignumRe).root(exponent);
  }

  sqrt(): NumericValue {
    if (this.isZero || this.isOne) return this;

    // Can we preserve the rational?
    // If radical ≠ 1, we know that √radical is not an integer, or it would
    // have been normalized to the rational part
    if (this.radical === 1) {
      // √(n/d) = √(n/d) = √(nd) / d
      // (if nd is a perfect square, or a product of perfect squares it
      // will get normalized to the rational numerator)
      if (isMachineRational(this.rational)) {
        const [n, d] = this.rational;
        if (n * d > SMALL_INTEGER) return this.factory(this.bignumRe).sqrt();
        if (n > 0) return this.clone({ radical: n * d, rational: [1, d] });

        //
        // Negative Rational: convert to imaginary
        //
        return this.factory({ im: Math.sqrt(-n * d) / d });
      } else {
        // If we have a big rational, we convert to float
        // (we can't keep the radical part)
        return this.factory(this.bignumRe).sqrt();
      }
    }

    if (this.sign > 0) {
      const re = Math.sqrt(this.re);
      if (Number.isInteger(re)) return this.clone(re);
    }
    return this.factory(this.bignumRe).sqrt();
  }

  gcd(other: NumericValue): NumericValue {
    if (!(other instanceof ExactNumericValue)) return other.gcd(this);
    if (this.isOne || other.im !== 0 || other.isOne) return this.clone(1);

    // Calculate the GCD of the rational parts
    const rational = rationalGcd(this.rational, other.rational);
    const radical = gcd(this.radical, other.radical);
    return this.clone({ rational, radical });
  }

  abs(): NumericValue {
    return this.sign === -1 ? this.neg() : this;
  }

  ln(base?: number): NumericValue {
    if (this.isZero) return this.clone(NaN);
    if (this.isPositiveInfinity) return this.clone(Infinity);

    if (this.sign < 0) return this.clone(NaN);
    if (this.isOne) return this.clone(0);
    if (this.isNegativeOne) return this.factory({ im: Math.PI });

    return this.factory(this.bignumRe).ln(base);
  }

  exp(): NumericValue {
    if (this.isNaN) return this.clone(NaN);
    if (this.isZero) return this.clone(1);
    if (this.isNegativeInfinity) return this.clone(0);
    if (this.isPositiveInfinity) return this.clone(Infinity);
    return this.factory(this.bignumRe).exp();
  }

  floor(): NumericValue {
    if (this.isNaN) return this.clone(NaN);
    if (this.type === 'integer') return this;
    return this.clone(Math.floor(this.re));
  }

  ceil(): NumericValue {
    if (this.isNaN) return this.clone(NaN);
    if (this.type === 'integer') return this;
    return this.clone(Math.ceil(this.re));
  }

  round(): NumericValue {
    if (this.isNaN) return this.clone(NaN);
    if (this.type === 'integer') return this;
    return this.clone(Math.round(this.re));
  }

  eq(other: number | NumericValue): boolean {
    if (typeof other === 'number')
      return (
        this.radical === 1 &&
        isInteger(this.rational) &&
        this.rational[0] == other
      );
    if (other instanceof ExactNumericValue) {
      return (
        this.radical === other.radical &&
        this.rational[0] == other.rational[0] &&
        this.rational[1] == other.rational[1]
      );
    }
    return other.im === 0 && other.re === this.re;
  }

  lt(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) undefined;
    if (typeof other === 'number') return this.re < other;
    return this.re < other.re;
  }

  lte(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) undefined;
    if (typeof other === 'number') return this.re <= other;
    return this.re <= other.re;
  }

  gt(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) undefined;
    if (typeof other === 'number') return this.re > other;
    return this.re > other.re;
  }

  gte(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) undefined;
    if (typeof other === 'number') return this.re >= other;
    return this.re >= other.re;
  }

  // When using add(), inexact values propagate, i.e. '1.2 + 1/4' -> '1.45'
  // This may not be desirable when adding many values, i.e. '1.2 - 1.2 + 1/4' -> '1/4'
  // Furthermore we may want to keep track of rational and square rational parts
  // i.e. '1.2 + 1/4 + √5 + √7' -> '3/4 + √5 + √7'
  // '1.2 + 1/4 + √5 + √5' -> '3/4 + 2√5'
  static sum(
    values: NumericValue[],
    factory: NumericValueFactory,
    bignumFactory: BigNumFactory
  ): NumericValue[] {
    if (values.length === 1) return values;

    // If we have some inexact values, just do a simple sum
    if (values.some((x) => !x.isExact)) {
      if (values.length === 2) return [values[0].add(values[1])];
      let sum = factory(0);
      for (const value of values) sum = sum.add(value);
      return [sum];
    }

    //
    // We have only exact values, we need to sum decimal, rational and radical parts
    //
    let imSum = 0;
    let rationalSum: Rational = [0, 1];
    const radicals: { multiple: Rational; radical: number }[] = [];

    for (const value of values) {
      if (value.isNaN)
        return [new ExactNumericValue(NaN, factory, bignumFactory)];
      if (value.isZero) continue;

      imSum += value.im;

      // We have a rational or a radical
      if (value instanceof ExactNumericValue) {
        const rational = value.rational;
        if (value.radical === 1) {
          // Just a fraction, add it to the sum
          rationalSum = add(rationalSum, rational);
        } else {
          // We have a rational and a radical, e.g. 2√5 or (1/3)√7 or √2
          const index = radicals.findIndex((x) => x.radical === value.radical);
          if (index === -1) {
            radicals.push({ multiple: rational, radical: value.radical });
          } else {
            // There was already a radical, add to it, e.g. "√2 + √2" = "2√2"
            radicals[index].multiple = add(radicals[index].multiple, rational);
          }
        }
      } else {
        console.assert(isSubtype(value.type, 'integer'));
        // Use bignumRe to avoid precision loss for large integers
        const intValue = BigInt(value.bignumRe!.toFixed(0));
        rationalSum = add(rationalSum, [intValue, BigInt(1)]);
      }
    }

    // If we add no additional rational or radical,
    if (isZero(rationalSum) && radicals.length === 0) {
      if (imSum === 0)
        return [new ExactNumericValue(0, factory, bignumFactory)];
      return [factory({ im: imSum })];
    }

    const result: NumericValue[] = [];
    if (imSum !== 0) result.push(factory({ im: imSum }));

    if (radicals.length === 0)
      result.push(
        new ExactNumericValue({ rational: rationalSum }, factory, bignumFactory)
      );
    else {
      // If we have a rational, merge it with the radicals
      radicals.push({ multiple: rationalSum, radical: 1 });
      result.push(
        ...radicals.map(
          (x) =>
            new ExactNumericValue(
              { rational: x.multiple, radical: x.radical },
              factory,
              bignumFactory
            )
        )
      );
    }
    return result;
  }
}
