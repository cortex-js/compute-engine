import Decimal from 'decimal.js';
import { NumericValue, NumericValueData } from './public';
import { ExactNumericValue } from './exact-numeric-value';

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
        decimal = decimal.mul(n).div(d);
      }
      if (value.radical !== undefined)
        decimal = decimal.mul(bignum(value.radical).sqrt());

      this.decimal = decimal;
      this.im = value.im ?? 0;
    }

    // Don't expect im to ever be NaN. If it is, it would need to be handled
    // by setting the decimal portion to NaN as well.
    console.assert(!isNaN(this.im));
  }

  toString(): string {
    if (this.isZero) return '0';
    if (this.isOne) return '1';
    if (this.isNegativeOne) return '-1';
    if (this.im === 0) return this.decimal.toString();
    if (this.decimal.isZero()) return `${this.im}i`;
    if (this.im > 0) return `${this.decimal.toString()} + ${this.im}i`;
    else return `${this.decimal.toString()} - ${-this.im}i`;
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

  private _makeExact(value: number): ExactNumericValue {
    return new ExactNumericValue(value, (x) => this.clone(x));
  }

  get re(): number {
    return this.decimal.toNumber();
  }

  get bignumRe(): Decimal {
    return this.decimal;
  }

  get num(): BigNumericValue {
    return this;
  }

  get denom(): ExactNumericValue {
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

  get isOne(): boolean {
    return this.im === 0 && this.decimal.eq(1);
  }

  get isNegativeOne(): boolean {
    return this.im === 0 && this.decimal.eq(-1);
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

  add(other: NumericValue): NumericValue {
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
        im: this.im * other.toNumber(),
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

  div(other: NumericValue): NumericValue {
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

  pow(
    exponent: number | [number, number] | { re: number; im: number }
  ): NumericValue {
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
          im: zArg.sin().toNumber(),
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
      im: newModulus.mul(newArgument.sin()).toNumber(),
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
      const imaginaryPart =
        Math.sign(b) * modulus.sub(a).div(2).sqrt().toNumber();
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
    if (this.decimal.isPositive()) return this;
    return this.clone(this.decimal.neg());
  }

  ln(base?: number): NumericValue {
    if (this.isZero) return this._makeExact(-Infinity);
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
    const argument = Decimal.atan2(b, a).toNumber();

    if (base === undefined)
      return this.clone({ decimal: modulus.ln(), im: argument });

    return this.clone({ decimal: modulus.log(base), im: argument });
  }
}
