import Decimal from 'decimal.js';
import { NumericValue, NumericValueData } from './public';
import { ExactNumericValue } from './exact-numeric-value';

export class MachineNumericValue extends NumericValue {
  decimal: number;
  im: number;

  constructor(value: number | Decimal | NumericValueData) {
    super();

    if (typeof value === 'number') {
      this.decimal = value;
      this.im = 0;
    } else if (value instanceof Decimal) {
      this.decimal = value.toNumber();
      this.im = 0;
    } else if (
      !('decimal' in value) &&
      !('rational' in value) &&
      !('radical' in value)
    ) {
      this.decimal = 0;
      this.im = value.im ?? 0;
    } else {
      let decimal =
        value.decimal === undefined
          ? 1
          : value.decimal instanceof Decimal
            ? value.decimal.toNumber()
            : value.decimal;
      if (value.rational !== undefined) {
        const [n, d] = value.rational;
        decimal = (decimal * n) / d;
      }
      if (value.radical !== undefined) decimal *= Math.sqrt(value.radical);

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
    if (this.im > 0) return `${this.decimal.toString()} + ${this.im}i`;
    else return `${this.decimal.toString()} - ${-this.im}i`;
  }

  get isExact(): boolean {
    return (
      (Number.isInteger(this.decimal) && Number.isInteger(this.im)) ||
      !isFinite(this.decimal)
    );
  }

  clone(value: number | Decimal | NumericValueData) {
    return new MachineNumericValue(value);
  }

  private _makeExact(value: number): ExactNumericValue {
    return new ExactNumericValue(value, (x) => this.clone(x));
  }

  get re(): number {
    return this.decimal;
  }

  get bignumRe(): Decimal | undefined {
    return undefined;
  }

  get num(): MachineNumericValue {
    return this;
  }

  get denom(): ExactNumericValue {
    return this._makeExact(1);
  }

  get isNaN(): boolean {
    return Number.isNaN(this.decimal);
  }

  get isPositiveInfinity(): boolean {
    return (
      (!Number.isFinite(this.decimal) && this.decimal > 0) ||
      this.im === Infinity
    );
  }

  get isNegativeInfinity(): boolean {
    return (
      (!Number.isFinite(this.decimal) && this.decimal < 0) ||
      this.im === -Infinity
    );
  }

  get isZero(): boolean {
    return this.im === 0 && this.decimal === 0;
  }

  get isOne(): boolean {
    return this.im === 0 && this.decimal === 1;
  }

  get isNegativeOne(): boolean {
    return this.im === 0 && this.decimal === -1;
  }

  N(): NumericValue {
    return this;
  }

  neg(): MachineNumericValue {
    if (this.isZero) return this;
    return this.clone({ decimal: -this.decimal, im: -this.im });
  }

  inv(): MachineNumericValue {
    if (this.isOne) return this;
    if (this.isNegativeOne) return this;
    if (this.im === 0) return this.clone(1 / this.decimal);

    const d = Math.hypot(this.re, this.im);
    return this.clone({ decimal: this.decimal / d, im: -this.im / d });
  }

  add(other: NumericValue): NumericValue {
    if (other.isZero) return this;
    if (this.isZero) return this.clone(other);

    return this.clone({
      decimal: this.decimal + other.re,
      im: this.im + other.im,
    });
  }

  sub(other: NumericValue): NumericValue {
    return this.add(other.neg());
  }

  mul(other: number | Decimal | NumericValue): NumericValue {
    if (this.isZero) return this;

    if (other instanceof Decimal) other = other.toNumber();
    if (other === 1) return this;
    if (other === -1) return this.neg();
    if (other === 0) return this.clone(0);

    // We need to ensure that non-exact propagates, so clone value in case
    // it was an ExactNumericValue
    if (this.isOne) return this.clone(other);

    if (typeof other === 'number') {
      if (this.im === 0) return this.clone(this.decimal * other);

      return this.clone({
        decimal: this.decimal * other,
        im: this.im * other,
      });
    }

    if (this.isNegativeOne) return this.clone(other.neg());
    if (other.isOne) return this;
    if (other.isNegativeOne) return this.neg();
    if (other.isZero) return this.clone(other);

    if (this.im === 0 && other.im === 0)
      return this.clone(this.decimal * other.re);

    return this.clone({
      decimal: this.decimal * other.re - this.im * other.im,
      im: this.re * other.im + this.im * other.re,
    });
  }

  div(other: NumericValue): NumericValue {
    if (other.isOne) return this;
    if (other.isNegativeOne) return this.neg();
    if (other.isZero) return this.clone(this.isZero ? NaN : Infinity);

    if (this.im === 0 && other.im === 0)
      return this.clone(this.decimal / other.re);

    const [a, b] = [this.decimal, this.im];
    const [c, d] = [other.re, other.im];
    const denominator = c * c + d * d;
    return this.clone({
      decimal: (a * c + b * d) / denominator,
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
        const zArg = Math.log(this.decimal) * im;
        const zIm = this.clone({ decimal: Math.cos(zArg), im: Math.sin(zArg) });
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
      return this.clone(this.decimal ** exponent);
    }

    const a = this.decimal;
    const b = this.im;
    const modulus = Math.sqrt(a * a + b * b);
    const argument = Math.atan2(b, a);
    const newModulus = modulus ** exponent;
    const newArgument = argument ** exponent;
    return this.clone({
      decimal: newModulus * Math.cos(newArgument),
      im: newModulus * Math.sin(newArgument),
    });
  }

  sqrt(): NumericValue {
    if (this.isZero || this.isOne) return this;

    if (this.im !== 0) {
      // Complex square root:
      // sqrt(a + bi) = sqrt((a + sqrt(a^2 + b^2)) / 2) + i * sign(b) * sqrt((sqrt(a^2 + b^2) - a) / 2)
      const a = this.decimal;
      const b = this.im;
      const modulus = Math.sqrt(a * a + b * b);

      const realPart = Math.sqrt((a + modulus) / 2);
      const imaginaryPart = Math.sign(b) * Math.sqrt((modulus - a) / 2);
      return this.clone({ decimal: realPart, im: imaginaryPart });
    }

    if (this.decimal > 0) return this.clone(Math.sqrt(this.decimal));
    return this.clone({ im: Math.sqrt(-this.decimal) });
  }

  gcd(other: NumericValue): NumericValue {
    if (this.isZero) return other;
    if (other.isZero) return this;

    if (this.im !== 0 || other.im !== 0) return this._makeExact(NaN);
    if (!Number.isInteger(this.decimal)) return this._makeExact(1);
    let b = other.re;
    if (!Number.isInteger(b)) return this._makeExact(1);

    let a = this.decimal;
    while (b !== 0) {
      const t = b;
      b = a % b;
      a = t;
    }
    return this.clone(Math.abs(a));
  }

  abs(): NumericValue {
    if (this.decimal > 0) return this;
    return this.clone(-this.decimal);
  }

  ln(base?: number): NumericValue {
    if (this.isZero) return this._makeExact(-Infinity);
    if (this.isNegativeInfinity) return this._makeExact(NaN);
    if (this.isPositiveInfinity) return this._makeExact(Infinity);

    if (this.im === 0) {
      if (this.decimal < 0) return this._makeExact(NaN);
      if (this.isOne) return this._makeExact(0);
      if (this.isNegativeOne) return this.clone({ im: Math.PI });

      if (base === undefined) return this.clone(Math.log(this.decimal));
      return this.clone(Math.log(this.decimal) / Math.log(base));
    }

    // ln(a + bi) = ln(|a + bi|) + i * arg(a + bi)
    const a = this.decimal;
    const b = this.im;
    const modulus = Math.hypot(a, b);
    const argument = Math.atan2(b, a);

    const decimal =
      base === undefined
        ? Math.log(modulus)
        : Math.log(modulus) / Math.log(base);

    return this.clone({ decimal, im: argument });
  }
}
