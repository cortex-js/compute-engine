import Decimal from 'decimal.js';
import { NumericValue, NumericValueData } from './public';
import { ExactNumericValue } from './exact-numeric-value';
import { isInMachineRange } from '../numerics/numeric-bignum';
import { Expression } from '../../math-json/types';
import { MACHINE_TOLERANCE, SmallInteger } from '../numerics/numeric';
import { numberToExpression } from '../numerics/expression';
import { numberToString } from '../numerics/strings';
import { bigint } from '../numerics/numeric-bigint';

export type BigNumFactory = (value: Decimal.Value) => Decimal;

export class BigNumericValue extends NumericValue {
  decimal: Decimal;
  im: number;

  bignum: BigNumFactory;

  constructor(
    value: number | Decimal | NumericValueData,
    bignum: BigNumFactory
  ) {
    super();
    this.bignum = bignum;

    if (typeof value === 'number') {
      this.decimal = bignum(value);
      this.im = 0;
    } else if (value instanceof Decimal) {
      this.decimal = value;
      this.im = 0;
    } else if (
      !('decimal' in value) &&
      !('rational' in value) &&
      !('radical' in value)
    ) {
      this.decimal = bignum(0);
      this.im = value.im ?? 0;
    } else {
      let decimal = bignum(value.decimal ?? 1);
      if (value.rational !== undefined) {
        const [n, d] = value.rational;
        if (typeof n === 'number') decimal = decimal.mul(n).div(d as number);
        else decimal = decimal.mul(n.toString()).div(d.toString());
      }
      if (value.radical !== undefined)
        decimal = decimal.mul(bignum(value.radical).sqrt());

      this.decimal = decimal;
      this.im = value.im ?? 0;
    }

    if (this.decimal.isNaN()) this.im = NaN;

    // If the decimal is NaN, the imaginary part should be NaN
    console.assert(this.decimal.isNaN() === isNaN(this.im));
  }

  get type(): 'complex' | 'real' | 'rational' | 'integer' {
    if (this.im !== 0) return 'complex';
    if (this.decimal.isInteger()) return 'integer';
    return 'real';
  }

  toJSON(): Expression {
    if (this.isNaN) return 'NaN';
    if (this.isPositiveInfinity) return 'PositiveInfinity';
    if (this.isNegativeInfinity) return 'NegativeInfinity';
    if (this.im === 0) {
      if (isInMachineRange(this.decimal)) return chop(this.decimal.toNumber());
      return { num: decimalToString(this.decimal) };
    }
    if (isInMachineRange(this.decimal))
      return [
        'Complex',
        numberToExpression(chop(this.decimal.toNumber())),
        numberToExpression(this.im),
      ];
    return [
      'Complex',
      { num: decimalToString(this.decimal) },
      numberToExpression(this.im),
    ];
  }

  toString(): string {
    if (this.isZero) return '0';
    if (this.isOne) return '1';
    if (this.isNegativeOne) return '-1';
    if (this.im === 0) return decimalToString(this.decimal);
    if (this.decimal.isZero()) {
      if (this.im === 1) return 'i';
      if (this.im === -1) return '-i';
      return `${numberToString(this.im)}i`;
    }

    let im = '';
    if (this.im === 1) im = '+ i';
    else if (this.im === -1) im = '- i';
    else if (this.im > 0) im = `+ ${this.im}i`;
    else im = `- ${-this.im}i`;

    return `(${decimalToString(this.decimal)} ${im})`;
  }

  get isExact(): boolean {
    return (
      (this.decimal.isInteger() && Number.isInteger(this.im)) ||
      !this.decimal.isFinite()
    );
  }

  clone(value: number | Decimal | NumericValueData) {
    return new BigNumericValue(value, this.bignum);
  }

  private _makeExact(value: number | bigint): ExactNumericValue {
    return new ExactNumericValue(value, (x) => this.clone(x));
  }

  get re(): number {
    return chop(this.decimal.toNumber());
  }

  get bignumRe(): Decimal {
    return this.decimal;
  }

  get numerator(): BigNumericValue {
    return this;
  }

  get denominator(): ExactNumericValue {
    return this._makeExact(1);
  }

  get isNaN(): boolean {
    return this.decimal.isNaN();
  }

  get isPositiveInfinity(): boolean {
    return (
      (!this.decimal.isFinite() &&
        !this.decimal.isNaN() &&
        this.decimal.isPositive()) ||
      this.im === Infinity
    );
  }

  get isNegativeInfinity(): boolean {
    return (
      (!this.decimal.isFinite() &&
        !this.decimal.isNaN() &&
        this.decimal.isNegative()) ||
      this.im === -Infinity
    );
  }

  get isZero(): boolean {
    return this.im === 0 && this.decimal.isZero();
  }

  isZeroWithTolerance(tolerance: number | Decimal): boolean {
    if (this.im !== 0) return false;
    const tol =
      typeof tolerance === 'number' ? this.bignum(tolerance) : tolerance;
    return this.decimal.abs().lte(tol);
  }

  get isOne(): boolean {
    return this.im === 0 && this.decimal.eq(1);
  }

  get isNegativeOne(): boolean {
    return this.im === 0 && this.decimal.eq(-1);
  }

  sgn(): -1 | 0 | 1 | undefined {
    if (this.im !== 0) return undefined;
    if (this.decimal.isZero()) return 0;
    if (this.decimal.isPositive()) return 1;
    if (this.decimal.isNegative()) return -1;
    return undefined;
  }

  N(): NumericValue {
    return this;
  }

  neg(): BigNumericValue {
    if (this.isZero) return this;
    return this.clone({ decimal: this.decimal.neg(), im: -this.im });
  }

  inv(): BigNumericValue {
    if (this.isOne) return this;
    if (this.isNegativeOne) return this;
    if (this.im === 0) return this.clone(this.decimal.pow(-1));

    const d = Math.hypot(this.re, this.im);
    const bigD = this.decimal
      .mul(this.decimal)
      .add(this.im * this.im)
      .sqrt();
    return this.clone({ decimal: this.decimal.div(bigD), im: -this.im / d });
  }

  add(other: number | NumericValue): NumericValue {
    if (typeof other === 'number') {
      if (other === 0) return this;
      return this.clone({ decimal: this.decimal.add(other), im: this.im });
    }

    if (other.isZero) return this;
    if (this.isZero) return this.clone(other);

    return this.clone({
      decimal: this.decimal.add(other.bignumRe ?? other.re),
      im: this.im + other.im,
    });
  }

  sub(other: NumericValue): NumericValue {
    return this.add(other.neg());
  }

  mul(other: number | Decimal | NumericValue): NumericValue {
    if (this.isZero) return this;
    if (other === 1) return this;
    if (other === -1) return this.neg();
    if (other === 0) return this.clone(0);

    // We need to ensure that non-exact propagates, so clone value in case
    // it was an ExactNumericValue
    if (this.isOne) return this.clone(other);

    if (typeof other === 'number') {
      if (this.im === 0) return this.clone(this.decimal.mul(other));

      return this.clone({
        decimal: this.decimal.mul(other),
        im: this.im * other,
      });
    }
    if (other instanceof Decimal) {
      if (this.im === 0) return this.clone(this.decimal.mul(other));

      return this.clone({
        decimal: this.decimal.mul(other),
        im: chop(this.im * other.toNumber()),
      });
    }

    if (this.isNegativeOne) return this.clone(other.neg());
    if (other.isOne) return this;
    if (other.isNegativeOne) return this.neg();
    if (other.isZero) return this.clone(other);

    if (this.im === 0 && other.im === 0)
      return this.clone(this.decimal.mul(other.bignumRe ?? other.re));

    return this.clone({
      decimal: this.decimal
        .mul(other.bignumRe ?? other.re)
        .sub(this.im * other.im),
      im: this.re * other.im + this.im * other.re,
    });
  }

  div(other: SmallInteger | NumericValue): NumericValue {
    if (typeof other === 'number') {
      if (other === 1) return this;
      if (other === -1) return this.neg();
      if (other === 0) return this.clone(NaN);
      return this.clone({
        decimal: this.decimal.div(other),
        im: this.im / other,
      });
    }

    if (other.isOne) return this;
    if (other.isNegativeOne) return this.neg();
    if (other.isZero) return this.clone(this.isZero ? NaN : Infinity);

    if (this.im === 0 && other.im === 0)
      return this.clone(this.decimal.div(other.bignumRe ?? other.re));

    const [a, b] = [this.re, this.im];
    const [c, d] = [other.re, other.im];
    const denominator = c * c + d * d;
    const bigC = other.bignumRe ?? this.bignum(other.re);
    const bigDenominator = bigC.mul(bigC).add(d * d);
    return this.clone({
      decimal: this.decimal
        .mul(bigC)
        .add(b * d)
        .div(bigDenominator),
      im: (b * c - a * d) / denominator,
    });
  }

  pow(exponent: number | { re: number; im: number }): NumericValue {
    if (Array.isArray(exponent)) exponent = exponent[0] / exponent[1];

    if (this.isNaN) return this;
    if (typeof exponent === 'number' && isNaN(exponent)) return this.clone(NaN);

    //
    // For the special cases we implement the same (somewhat arbitrary) results
    // as sympy. See https://docs.sympy.org/1.6/modules/core.html#pow
    //

    // If the exponent is a complex number, we use the formula:
    // z^w = (r^w) * (cos(wθ) + i * sin(wθ)),
    // where z = r * (cos(θ) + i * sin(θ))

    if (
      typeof exponent === 'object' &&
      ('re' in exponent || 'im' in exponent)
    ) {
      //
      // Complex Exponent
      //
      const [re, im] = [exponent?.re ?? 0, exponent?.im ?? 0];
      if (Number.isNaN(im) || Number.isNaN(re)) return this.clone(NaN);
      if (im === 0) {
        exponent = re; // fallthrough and continue
      } else {
        // Complex Infinity ^ z -> NaN
        if (this.im === Infinity) return this.clone(NaN);
        if (this.isNegativeInfinity) return this.clone(0);
        if (this.isPositiveInfinity) return this.clone({ im: Infinity });

        const zRe = this.pow(re);
        const zArg = this.decimal.ln().mul(im);
        const zIm = this.clone({
          decimal: zArg.cos(),
          im: chop(zArg.sin().toNumber()),
        });
        return zRe.mul(zIm);
      }
    }

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
      if (exponent < 0) return this.clone({ im: Infinity }); // Complex/unsigned infinity
    }

    if (exponent < 0) return this.pow(-exponent).inv();

    if (this.im === 0) {
      return this.clone(this.decimal.pow(exponent));
    }

    const a = this.decimal;
    const b = this.im;
    const modulus = a
      .mul(a)
      .add(b * b)
      .sqrt();
    const argument = Decimal.atan2(b, a);
    const newModulus = modulus.pow(exponent);
    const newArgument = argument.mul(exponent);
    return this.clone({
      decimal: newModulus.mul(newArgument.cos()),
      im: chop(newModulus.mul(newArgument.sin()).toNumber()),
    });
  }

  root(exp: number): NumericValue {
    if (!Number.isInteger(exp)) return this._makeExact(NaN);
    if (exp === 0) return this._makeExact(NaN);
    if (exp === 1) return this;

    if (this.isZero) return this;
    if (this.isOne) return this;
    if (this.isNegativeOne) return this;

    if (this.im === 0) {
      if (this.decimal.isNegative()) return this._makeExact(NaN);
      if (exp === 2) return this.clone(this.decimal.sqrt());
      if (exp === 3) return this.clone(this.decimal.cbrt());
      return this.clone(this.decimal.pow(1 / exp));
    }

    // Complex root:
    // z^(1/n) = (r^(1/n)) * (cos((θ + 2πk) / n) + i * sin((θ + 2πk) / n))
    // where z = r * (cos(θ) + i * sin(θ))

    const a = this.decimal;
    const b = this.im;
    const modulus = a
      .mul(a)
      .add(b * b)
      .sqrt();
    const argument = Decimal.atan2(b, a);
    const newModulus = modulus.pow(1 / exp);
    const newArgument = argument.div(exp);

    // Return the principal root
    return this.clone({
      decimal: newModulus.mul(newArgument.cos()),
      im: chop(newModulus.mul(newArgument.sin()).toNumber()),
    });
  }

  sqrt(): NumericValue {
    if (this.isZero || this.isOne) return this;

    if (this.im !== 0) {
      // Complex square root:
      // sqrt(a + bi) = sqrt((a + sqrt(a^2 + b^2)) / 2) + i * sign(b) * sqrt((sqrt(a^2 + b^2) - a) / 2)
      const a = this.decimal;
      const b = this.im;
      const modulus = a
        .mul(a)
        .add(b * b)
        .sqrt();

      const realPart = a.add(modulus).div(2).sqrt();
      const imaginaryPart = chop(
        Math.sign(b) * modulus.sub(a).div(2).sqrt().toNumber()
      );
      return this.clone({ decimal: realPart, im: imaginaryPart });
    }

    if (this.decimal.isPositive()) return this.clone(this.decimal.sqrt());
    return this.clone({ im: Math.sqrt(-this.re) });
  }

  gcd(other: NumericValue): NumericValue {
    if (this.isZero) return other;
    if (other.isZero) return this;

    if (this.im !== 0 || other.im !== 0) return this._makeExact(NaN);
    if (!this.decimal.isInteger()) return this._makeExact(1);
    let b = this.bignum(other.bignumRe ?? other.re);
    if (!b.isInteger()) return this._makeExact(1);

    let a = this.decimal;
    while (!b.isZero()) {
      const t = b;
      b = a.mod(b);
      a = t;
    }
    return this.clone(a.abs());
  }

  abs(): NumericValue {
    if (this.im === 0)
      return this.decimal.isPositive() ? this : this.clone(this.decimal.neg());

    return this.clone(
      this.decimal
        .pow(2)
        .add(this.im ** 2)
        .sqrt()
    );
  }

  ln(base?: number): NumericValue {
    if (this.isZero) return this._makeExact(NaN);
    if (this.isNegativeInfinity) return this._makeExact(NaN);
    if (this.isPositiveInfinity) return this._makeExact(Infinity);

    if (this.im === 0) {
      if (this.decimal.isNegative()) return this._makeExact(NaN);
      if (this.isOne) return this._makeExact(0);
      if (this.isNegativeOne) return this.clone({ im: Math.PI });

      if (base === undefined) return this.clone(this.decimal.ln());
      return this.clone(this.decimal.log(base));
    }

    // ln(a + bi) = ln(|a + bi|) + i * arg(a + bi)
    const a = this.decimal;
    const b = this.im;
    const modulus = a
      .mul(a)
      .add(b * b)
      .sqrt();
    const argument = chop(Decimal.atan2(b, a).toNumber());

    if (base === undefined)
      return this.clone({ decimal: modulus.ln(), im: argument });

    return this.clone({ decimal: modulus.log(base), im: argument });
  }

  exp(): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (this.isZero) return this._makeExact(1);
    if (this.isNegativeInfinity) return this._makeExact(0);
    if (this.isPositiveInfinity) return this._makeExact(Infinity);
    if (this.im !== 0) {
      // Complex exponential:
      // exp(a + bi) = exp(a) * (cos(b) + i * sin(b))
      const e = this.decimal.exp();
      return this.clone({
        decimal: e.mul(chop(Math.cos(this.im))),
        im: chop(e.mul(Math.sin(this.im)).toNumber()),
      });
    }
    return this.clone(this.decimal.exp());
  }

  floor(): NumericValue {
    if (this.isNaN || this.im !== 0) return this._makeExact(NaN);
    if (this.decimal.isInteger()) return this;
    return this._makeExact(bigint(this.decimal.floor())!);
  }

  ceil(): NumericValue {
    if (this.isNaN || this.im !== 0) return this._makeExact(NaN);
    if (this.decimal.isInteger()) return this;
    return this._makeExact(bigint(this.decimal.ceil())!);
  }

  round(): NumericValue {
    if (this.isNaN || this.im !== 0) return this._makeExact(NaN);
    if (this.decimal.isInteger()) return this;
    return this._makeExact(bigint(this.decimal.round())!);
  }

  eq(other: number | NumericValue): boolean {
    if (typeof other === 'number') return this.decimal.eq(other);
    return (
      this.decimal.eq(other.bignumRe ?? other.re) &&
      chop(this.im - other.im) === 0
    );
  }

  lt(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) undefined;
    if (typeof other === 'number') return this.decimal.lt(other);
    return this.decimal.lt(other.bignumRe ?? other.re);
  }

  lte(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) undefined;
    if (typeof other === 'number') return this.decimal.lte(other);
    return this.decimal.lte(other.bignumRe ?? other.re);
  }

  gt(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) undefined;
    if (typeof other === 'number') return this.decimal.gt(other);
    return this.decimal.gt(other.bignumRe ?? other.re);
  }

  gte(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) undefined;
    if (typeof other === 'number') return this.decimal.gte(other);
    return this.decimal.gte(other.bignumRe ?? other.re);
  }
}

function decimalToString(num: Decimal): string {
  // Use scientific notation if the exponent is too large or too small
  // Convert the number to a string
  let numStr = num.toString();

  // Check if the number is in scientific notation
  if (num.isInteger() && numStr.includes('e')) {
    // Convert the number to a fixed notation string with no decimal places
    let fixedStr = num.toFixed();

    // Check the number of trailing zeros
    let trailingZeros = fixedStr.match(/0+$/);
    let trailingZerosCount = trailingZeros ? trailingZeros[0].length : 0;

    // If there are 5 or fewer trailing zeros, return the fixed notation string
    if (trailingZerosCount <= 5) {
      return fixedStr;
    }
  }

  // If the number is not in scientific notation or doesn't meet the criteria, return the original string
  return numStr;
}

function chop(n: number): number {
  if (Math.abs(n) <= MACHINE_TOLERANCE) return 0;

  return n;
}
