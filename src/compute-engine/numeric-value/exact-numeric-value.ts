import { add, div, mul } from '../boxed-expression/numerics';
import { factorPower, gcd } from '../numerics/numeric';
import {
  inverse,
  isMachineRational,
  isRational,
  isOne,
  isZero,
  reducedRational,
  neg,
} from '../numerics/rationals';
import { NumericValue, NumericValueData } from './public';

export type ExactNumericValueData = NumericValueData<number, [number, number]>;

export type PrivateExactNumericValueData = NumericValueData<
  number,
  [number, number]
> & {
  sign: -1 | 0 | 1;
  rational: [number, number];
  radical: number;
};

export class ExactNumericValue extends NumericValue<number, [number, number]> {
  sign: -1 | 0 | 1;

  // If decimal is not 1, then rational and radical are 1, or they're all 0
  decimal: number;
  rational: [number, number];
  radical: number;

  im: number;

  constructor(value: Partial<PrivateExactNumericValueData>) {
    super();
    console.assert(value.re === undefined || typeof value.re === 'number');

    this.sign = value.sign ?? 1;
    this.im = value.im ?? 0;

    if ('re' in value || 'rational' in value || 'radical' in value) {
      // If we have one of those three properties, their default value is 1
      // Otherwise, their default value is 0.
      // This is to support {im: 2} as a shorthand for {im: 2, re: 0, }
      this.decimal = value.re ?? 1;
      this.rational = value.rational ? [...value.rational] : [1, 1];
      this.radical = value.radical ?? 1;
    } else {
      this.decimal = 0;
      this.rational = [0, 1];
      this.radical = 0;
    }

    this.normalize();
  }

  get re(): number {
    let result = this.sign * this.decimal;
    result = (result * this.rational[0]) / this.rational[1];
    if (this.radical !== 1) result *= Math.sqrt(this.radical);
    return result;
  }

  get num(): ExactNumericValue {
    if (this.rational[1] === 1) return this;
    return new ExactNumericValue({
      sign: this.sign,
      re: this.decimal,
      im: this.im,
      rational: [this.rational[0], 1],
      radical: this.radical,
    });
  }

  get denom(): ExactNumericValue {
    return new ExactNumericValue({ rational: [this.rational[1], 1] });
  }

  normalize(): void {
    //
    // Note: the order of the operations is significant
    //

    //
    // 1/ Is the real part zero?
    //
    if (this.decimal === 0 || this.radical === 0 || isZero(this.rational)) {
      this.sign = 0; // main indicator that the real part is zero
      this.decimal = 0;
      this.rational = [0, 1];
      this.radical = 0;
      return;
    }

    //
    // 2/ If sqrt is a product of exact square, simplify
    // sqrt(75) = sqrt(25 * 3) = 5 * sqrt(3)
    //
    if (this.radical !== 1) {
      const [factor, root] = factorPower(this.radical, 2);
      this.rational[0] = this.rational[0] * factor;
      this.radical = root;
    }

    //
    // 3/ Convert big rationals to machine rationals
    //
    if (typeof this.rational[0] === 'bigint')
      this.rational = [Number(this.rational[0]), Number(this.rational[1])];
    if (typeof this.radical === 'bigint') this.radical = Number(this.radical);

    if (!isFinite(this.rational[0])) {
      this.decimal = this.rational[0];
      this.rational = [1, 1];
    }
    if (!isFinite(this.radical)) {
      this.decimal = this.radical;
      this.radical = 1;
    }

    //
    // 4/ If not a valid rational (i.e. "1.23/2.4"), convert to a float
    //
    console.assert(isMachineRational(this.rational));
    if (
      !Number.isInteger(this.rational[0]) ||
      !Number.isInteger(this.rational[1])
    ) {
      this.decimal = (this.decimal * this.rational[0]) / this.rational[1];
      this.rational = [1, 1];
    }
    if (!Number.isInteger(this.radical)) {
      this.decimal = this.decimal * Math.sqrt(this.radical);
      this.radical = 1;
    }

    //
    // 5/ If float is an integer, convert to rational
    //
    if (this.decimal !== 1 && Number.isInteger(this.decimal)) {
      this.rational[0] *= this.decimal;
      this.decimal = 1;
    }

    //
    // 6/ Reduce rational
    //

    this.rational = reducedRational(this.rational);
    if (this.radical < 0) {
      this.radical = -this.radical;
      this.im += 1;
    }

    //
    // 7/ Capture the sign
    //
    if (this.decimal < 0) {
      this.sign *= -1;
      this.decimal = -this.decimal;
    }
    if (this.rational[0] < 0) {
      this.sign *= -1;
      this.rational[0] = -this.rational[0];
    }

    //
    // 8/ If a non-exact float (or has an imaginary part), convert all to float
    //
    if (
      (this.decimal !== 1 || this.im !== 0) &&
      (this.radical !== 1 || !isOne(this.rational))
    ) {
      this.decimal = Math.abs(this.re);
      this.rational = [1, 1];
      this.radical = 1;
    }
  }

  // This is an "exact" numeric value if it can be represented as a product
  // of rational numbers: a/b * sqrt(c/d)
  get isExact(): boolean {
    return this.sign === 0 || (this.decimal === 1 && this.im === 0);
  }

  get isNaN(): boolean {
    return Number.isNaN(this.decimal);
  }

  get isPositiveInfinity(): boolean {
    if (this.sign !== 1) return false;
    if (this.decimal !== Infinity) return false;
    return true;
  }

  get isNegativeInfinity(): boolean {
    if (this.sign !== -1) return false;
    if (this.decimal !== Infinity) return false;
    return true;
  }

  get isOne(): boolean {
    if (this.sign !== 1) return false;
    if (this.decimal !== 1) return false;
    if (this.im !== 0) return false;
    if (this.rational[0] !== this.rational[1]) return false;
    if (this.radical !== 1) return false;
    return true;
  }

  get isNegativeOne(): boolean {
    if (this.sign !== -1) return false;
    if (this.decimal !== 1) return false;
    if (this.im !== 0) return false;
    if (this.rational[0] !== this.rational[1]) return false;
    if (this.radical !== 1) return false;
    return true;
  }

  N(): ExactNumericValue {
    return new ExactNumericValue({ re: this.re, im: this.im });
  }

  neg(): ExactNumericValue {
    if (this.isZero) return this;
    return new ExactNumericValue({
      im: -this.im,
      sign: -this.sign as -1 | 0 | 1,
      re: this.decimal,
      rational: this.rational,
      radical: this.radical,
    });
  }

  inv(): ExactNumericValue {
    if (this.isOne) return this;
    if (this.im !== 0) {
      const d = Math.hypot(this.re, this.im);
      return new ExactNumericValue({ im: -this.im / d, re: this.re / d });
    }

    // inv(a/b√c) = b/(a√c) = (b√c)/(ac) = (b/ac)√c

    return new ExactNumericValue({
      sign: this.sign,
      re: 1 / this.decimal,
      rational: mul(inverse(this.rational), [1, this.radical]) as [
        number,
        number,
      ],
      radical: this.radical,
    });
  }

  add(
    other: Partial<ExactNumericValueData> | number | [number, number]
  ): ExactNumericValue {
    if (typeof other === 'number') other = { re: other };
    else if (isRational(other)) other = { rational: other };

    const rhs =
      other instanceof ExactNumericValue ? other : new ExactNumericValue(other);

    if (rhs.isZero) return this;
    if (this.isZero) return rhs;

    // Can we keep a rational result?
    // Yes, if both numbers are rational and have the same radical

    if (
      this.decimal === 1 &&
      rhs.decimal === 1 &&
      this.radical === rhs.radical
    ) {
      const [a, b] = this.rational;
      const [c, d] = rhs.rational;
      return new ExactNumericValue({
        rational: [this.sign * a * d + rhs.sign * b * c, b * d],
        radical: this.radical,
        im: this.im + rhs.im,
      });
    }

    return new ExactNumericValue({
      re: this.re + rhs.re,
      im: this.im + rhs.im,
    });
  }

  sub(
    other: Partial<ExactNumericValueData> | number | [number, number]
  ): ExactNumericValue {
    if (typeof other === 'number') other = { re: other };
    else if (isRational(other)) other = { rational: other };

    return this.add(new ExactNumericValue(other).neg());
  }

  mul(
    other: Partial<PrivateExactNumericValueData> | number | [number, number]
  ): ExactNumericValue {
    if (this.isZero) return this;

    if (typeof other === 'number') other = { re: other };
    else if (isRational(other)) other = { rational: other };

    const rhs =
      other instanceof ExactNumericValue ? other : new ExactNumericValue(other);
    if (this.isOne) return rhs;
    if (rhs.isOne) return this;

    if (this.im !== 0 || rhs.im !== 0) {
      const a = this.re;
      const b = this.im;
      const c = rhs.re;
      const d = rhs.im;
      return new ExactNumericValue({
        im: a * d + b * c,
        re: a * c - b * d,
      });
    }
    return new ExactNumericValue({
      re: this.sign * rhs.sign * this.decimal * rhs.decimal,
      rational: mul(this.rational, rhs.rational) as [number, number],
      radical: this.radical * rhs.radical,
    });
  }

  div(
    other: Partial<PrivateExactNumericValueData> | number | [number, number]
  ): ExactNumericValue {
    if (typeof other === 'number') other = { re: other };
    else if (isRational(other)) other = { rational: other };

    const rhs =
      other instanceof ExactNumericValue ? other : new ExactNumericValue(other);

    if (rhs.isOne) return this;
    if (rhs.isNegativeOne) return this.neg();

    if (this.im !== 0 || rhs.im !== 0) {
      const [a, b] = [this.re, this.im];
      const [c, d] = [rhs.re, rhs.im];
      const denominator = c * c + d * d;
      return new ExactNumericValue({
        im: (b * c - a * d) / denominator,
        re: (a * c + b * d) / denominator,
      });
    }

    // (a/b √c) / (d/e √f) = (ad/be) * √(c/f) =
    // ((a/b)/(d/e))*(1/f) * √(cf)
    return new ExactNumericValue({
      sign: (this.sign * rhs.sign) as -1 | 0 | 1,
      re: this.decimal / rhs.decimal,
      rational: mul(div(this.rational, rhs.rational), [1, rhs.radical]) as [
        number,
        number,
      ],
      radical: this.radical * rhs.radical,
    });
  }

  pow(exponent: number): ExactNumericValue {
    if (exponent === 1) return this;
    if (exponent === 0) return new ExactNumericValue({ re: 1 });
    if (exponent === -1) return this.inv();
    if (exponent === 0.5) return this.sqrt();
    if (exponent === -0.5) return this.sqrt().inv();

    console.assert(Number.isInteger(exponent));

    if (exponent < 0) return this.pow(-exponent).inv();

    if (this.im === 0) {
      return new ExactNumericValue({
        sign: this.sign < 0 && exponent % 2 === 0 ? -1 : 1,
        re: this.decimal ** exponent,
        rational: [this.rational[0] ** exponent, this.rational[1] ** exponent],
        radical: this.radical ** exponent,
      });
    }
    const a = this.re;
    const b = this.im;
    const modulus = Math.hypot(a, b);
    const argument = Math.atan2(b, a);
    const newModulus = modulus ** exponent;
    const newArgument = argument * exponent;
    return new ExactNumericValue({
      re: newModulus * Math.cos(newArgument),
      im: newModulus * Math.sin(newArgument),
    });
  }

  sqrt(): ExactNumericValue {
    if (this.sign === 0) return this;

    if (this.im !== 0) {
      // Complex square root:
      // sqrt(a + bi) = sqrt((a + sqrt(a^2 + b^2)) / 2) + i * sign(b) * sqrt((sqrt(a^2 + b^2) - a) / 2)
      const a = this.re;
      const b = this.im;
      const modulus = Math.sqrt(a * a + b * b);
      const realPart = Math.sqrt((a + modulus) / 2);
      const imaginaryPart = Math.sign(b) * Math.sqrt((modulus - a) / 2);
      return new ExactNumericValue({
        re: realPart,
        im: imaginaryPart,
      });
    }

    // Can we preserve the rational?
    // If radical ≠ 1, we know that √radical is not an integer, or it would
    // have been normalized to the rational part
    if (this.radical === 1 && !isOne(this.rational)) {
      console.assert(this.decimal === 1);

      // √(n/d) = √(n/d) = √(nd) / d
      // (if nd is a perfect square, or a product of perfect squares it
      // will get normalized to the rational numerator)
      let [n, d] = this.rational;
      return new ExactNumericValue({
        sign: this.sign,
        radical: n * d,
        rational: [1, d],
      });
    }

    console.assert(this.im === 0);

    if (this.sign > 0) return new ExactNumericValue({ re: Math.sqrt(this.re) });
    return new ExactNumericValue({ im: Math.sqrt(-this.re) });
  }

  gcd(other: ExactNumericValue): ExactNumericValue {
    if (!this.isExact || !other.isExact || this.isOne || other.isOne)
      return new ExactNumericValue({ re: 1 });

    // Calculate the GCD of the rational parts
    const rational: [number, number] = [
      gcd(this.rational[0], other.rational[0]),
      gcd(this.rational[1], other.rational[1]),
    ];
    const radical: number = gcd(this.radical, other.radical);
    return new ExactNumericValue({ rational, radical });
  }

  abs(): ExactNumericValue {
    if (this.im === 0) {
      if (this.sign !== -1) return this;
      return this.neg();
    }
    // abs(z) = √(z.real² + z.imaginary²)
    return new ExactNumericValue({
      re: Math.hypot(this.re, this.im),
    });
  }

  sum(...values: ExactNumericValue[]): ExactNumericValue[] {
    let imSum = this.im;
    let decimalSum = 0;
    let rationalSum: [number, number] = [0, 1];
    let radicals: { multiple: [number, number]; radical: number }[] = [];

    if (this.sign !== 0) {
      if (this.decimal !== 1) decimalSum += this.sign * this.decimal;
      if (this.radical !== 1)
        radicals.push({ multiple: [1, 1], radical: this.radical });
      if (!isOne(this.rational))
        rationalSum =
          this.sign > 0
            ? this.rational
            : (neg(this.rational) as [number, number]);
    }

    for (const value of values) {
      if (value.isZero) continue;

      imSum += value.im;

      // No real part? Continue.
      if (value.sign === 0) continue;

      if (value.decimal !== 1) {
        // We have a decimal, therefore no rational or radical
        console.assert(isOne(value.rational) && value.radical === 1);
        decimalSum += value.sign * value.decimal;
      } else {
        // We have a rational or a radical
        const signedRational =
          value.sign > 0 ? value.rational : neg(value.rational);
        if (value.radical === 1) {
          // Just a fraction, add it to the sum
          rationalSum = add(rationalSum, signedRational) as [number, number];
        } else {
          // We have a rational and a radical, e.g. 2√5 or (1/3)√7 or √2
          const index = radicals.findIndex((x) => x.radical === value.radical);
          if (index === -1) {
            radicals.push({ multiple: signedRational, radical: value.radical });
          } else {
            // There was already a radical, add to it, e.g. "√2 + √2" = "2√2"
            radicals[index].multiple = add(
              radicals[index].multiple,
              signedRational
            ) as [number, number];
          }
        }
      }
    }

    // The literal sum is decimalSum + rationalSum + sqrt(radical)
    if (decimalSum !== 0) {
      // If we have an inexact sum, merge everything into a decimal
      decimalSum +=
        rationalSum[0] / rationalSum[1] +
        radicals.reduce(
          (acc, sqrt) =>
            (acc + Math.sqrt(sqrt.radical) * (sqrt.multiple[0] as number)) /
            (sqrt.multiple[1] as number),
          0
        );
      return [this, new ExactNumericValue({ re: decimalSum, im: imSum })];
    }

    // If we add no additional rational or radical, return the original value
    if (isZero(rationalSum) && radicals.length === 0) return [this];

    // If we have a rational, merge it with the radicals
    radicals.push({ multiple: rationalSum, radical: 1 });
    return radicals.map(
      (x) =>
        new ExactNumericValue({
          rational: x.multiple,
          radical: x.radical,
        })
    );
  }
}
