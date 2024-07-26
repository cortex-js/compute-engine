import Decimal from 'decimal.js';
import { add } from '../boxed-expression/numerics';
import { factorPower, gcd, SMALL_INTEGER } from '../numerics/numeric';
import {
  isOne,
  isZero,
  reducedRational,
  neg,
  isPositive,
  isInteger,
  isNegativeOne,
  rationalAsFloat,
} from '../numerics/rationals';
import { NumericValue, NumericValueData, NumericValueFactory } from './public';

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
  rational: [number, number];
  radical: number;

  im: number;

  factory: NumericValueFactory;

  /** The caller is responsible to make sure the input is valid, i.e.
   * - rational is a fraction of integers (but it may not be reduced)
   * - radical is an integer
   * - im is an integer
   */
  constructor(value: number | NumericValueData, factory: NumericValueFactory) {
    super();
    this.factory = factory;

    if (typeof value === 'number') {
      console.assert(!Number.isFinite(value) || Number.isInteger(value));
      this.im = 0;
      this.rational = [value, 1];
      this.radical = value === 0 ? 0 : 1;
      return;
    }

    this.im = value.im ?? 0;
    console.assert(Number.isInteger(this.im));

    if ('rational' in value || 'radical' in value || 'decimal' in value) {
      let decimal = value.decimal ?? 1;
      if (decimal instanceof Decimal) decimal = decimal.toNumber();
      console.assert(Number.isInteger(decimal));
      if (decimal === 0) {
        this.rational = [0, 1];
        this.radical = 0;
        return;
      }
      let rational = value.rational
        ? ([...value.rational] as const)
        : ([1, 1] as const);
      if (decimal !== 1) rational = [rational[0] * decimal, rational[1]];

      this.radical = value.radical ?? 1;
      this.rational = rational as [number, number];

      this.normalize();
    } else {
      this.rational = [0, 1];
      this.radical = 0;
    }
  }

  get isExact(): boolean {
    return true;
  }

  cloneIm(im: number): NumericValue {
    // If a gaussian imaginary, keep it as an exact value
    if (Number.isInteger(im))
      return new ExactNumericValue({ im }, this.factory);
    return this.factory({ im });
  }

  clone(value: number | NumericValueData): ExactNumericValue {
    return new ExactNumericValue(value, this.factory);
  }

  /** Object.toString() */
  toString(): string {
    if (this.isZero) return '0';
    if (this.isOne) return '1';
    if (this.isNegativeOne) return '-1';

    const products: string[] = [];

    if (!isZero(this.rational)) {
      if (!isOne(this.rational) && !isNegativeOne(this.rational)) {
        if (isInteger(this.rational)) products.push(toFixed(this.rational[0]));
        else
          products.push(
            `${toFixed(this.rational[0])}/${toFixed(this.rational[1])}`
          );
      }
      if (this.radical !== 1) {
        products.push(
          `${isNegativeOne(this.rational) ? '-' : ''}sqrt(${this.radical})`
        );
      } else if (isNegativeOne(this.rational)) {
        products.push('-1');
      } else if (isOne(this.rational)) {
        products.push('1');
      }
    }

    let im = '';
    if (this.im < 0) im = `${this.im} i`;
    else if (this.im > 0) im = `+${this.im} i`;

    return `${products.join(' * ')}${im}`;
  }

  get sign(): -1 | 0 | 1 {
    if (isZero(this.rational)) return 0;
    if (isPositive(this.rational)) return 1;
    return -1;
  }

  get re(): number {
    return rationalAsFloat(this.rational) * Math.sqrt(this.radical);
  }

  get num(): ExactNumericValue {
    if (this.rational[1] === 1) return this;
    return this.clone({
      im: this.im,
      rational: [this.rational[0], 1],
      radical: this.radical,
    });
  }

  get denom(): ExactNumericValue {
    return this.clone(this.rational[1]);
  }

  normalize(): void {
    console.assert(
      Number.isInteger(this.rational[0]) &&
        Number.isInteger(this.rational[1]) &&
        Number.isInteger(this.radical) &&
        this.radical >= 0 &&
        Number.isFinite(this.radical) &&
        Number.isInteger(this.im)
    );

    //
    // Note: the order of the operations is significant
    //

    //
    // 1/ Is the rational or radical zero?
    //
    if (this.radical === 0 || isZero(this.rational)) {
      this.rational = [0, 1];
      this.radical = 0;
      return;
    }

    //
    // 2/ Propagate non-finite values
    //  @fixme: not needed
    if (!isFinite(this.radical)) {
      this.rational = [this.radical, 1];
      this.radical = 1;
      return;
    }

    //
    // 3/ If sqrt is a product of exact square, simplify
    // sqrt(75) = sqrt(25 * 3) = 5 * sqrt(3)
    //
    if (this.radical >= 4) {
      const [factor, root] = factorPower(this.radical, 2);
      this.rational[0] *= factor;
      this.radical = root;
    }

    //
    // 5/ Reduce rational
    //

    this.rational = reducedRational(this.rational);
  }

  get isNaN(): boolean {
    return Number.isNaN(this.rational[0]);
  }

  get isPositiveInfinity(): boolean {
    return this.rational[0] === Infinity;
  }

  get isNegativeInfinity(): boolean {
    return this.rational[0] === -Infinity;
  }

  get isZero(): boolean {
    return this.im === 0 && isZero(this.rational);
  }

  get isOne(): boolean {
    if (this.im !== 0) return false;
    if (this.rational[0] !== this.rational[1]) return false;
    if (this.radical !== 1) return false;
    return true;
  }

  get isNegativeOne(): boolean {
    if (this.im !== 0) return false;
    if (this.rational[0] !== -this.rational[1]) return false;
    if (this.radical !== 1) return false;
    return true;
  }

  N(): NumericValue {
    if (this.isZero || this.isOne || this.isNegativeOne || this.isNaN)
      return this;
    return this.factory(this);
  }

  neg(): ExactNumericValue {
    if (this.isZero) return this;
    return this.clone({
      im: -this.im,
      rational: neg(this.rational),
      radical: this.radical,
    });
  }

  inv(): NumericValue {
    if (this.isOne) return this;
    if (this.isNegativeOne) return this;
    if (this.im !== 0) {
      // If no real part, keep it as an exact imaginary value
      if (this.sign === 0) return this.clone({ im: -this.im });
      return this.factory(this).inv();
    }

    // inv(a/b√c) = b/(a√c) = (b√c)/(ac) = (b/ac)√c

    return this.clone({
      rational: [this.rational[1], this.rational[0] * this.radical],
      radical: this.radical,
    });
  }

  add(other: NumericValue): NumericValue {
    if (other.isZero) return this;
    if (this.isZero) return other;

    if (!(other instanceof ExactNumericValue)) return other.add(this);

    // Can we keep a rational result?
    // Yes, if both numbers are rational and have the same radical

    if (this.radical === other.radical) {
      const [a, b] = this.rational;
      const [c, d] = other.rational;
      return this.clone({
        rational: [a * d + b * c, b * d],
        radical: this.radical,
        im: this.im + other.im,
      });
    }

    return this.factory(this).add(other);
  }

  sub(other: NumericValue): NumericValue {
    return this.add(other.neg());
  }

  mul(other: number | Decimal | NumericValue): NumericValue {
    if (other === 0) return this.clone(0);
    if (other === 1) return this;
    if (other === -1) return this.neg();
    if (typeof other === 'number') {
      if (Number.isInteger(other))
        return this.clone({
          im: this.im * other,
          rational: [this.rational[0] * other, this.rational[1]],
          radical: this.radical,
        });
      return this.factory(this).mul(other);
    }
    if (other instanceof Decimal) return this.factory(other).mul(this);

    if (other.isZero) return other;
    if (other.isOne) return this;
    if (other.isNegativeOne) return this.neg();
    if (other.isNaN) return other;

    if (this.isZero) return this;
    if (this.isOne) return other;
    if (this.isNegativeOne) return other.neg();

    if (!(other instanceof ExactNumericValue)) return other.mul(this);

    if (this.im !== 0 || other.im !== 0) {
      if (this.sign === 0 && other.sign === 0)
        return this.clone({ rational: [-this.im * other.im, 1] });
      this.factory(this).mul(other);
    }
    return this.clone({
      rational: [
        this.rational[0] * other.rational[0],
        this.rational[1] * other.rational[1],
      ],
      radical: this.radical * other.radical,
    });
  }

  div(other: NumericValue): NumericValue {
    if (other.isOne) return this;
    if (other.isNegativeOne) return this.neg();
    if (this.isZero) {
      if (other.isZero) return this.clone(NaN);
      return other.isNaN ? other : this;
    }
    if (other.isNaN) return other;
    if (other.isZero) return this.clone(this.sign * Infinity);

    if (!(other instanceof ExactNumericValue))
      return this.factory(this).div(other);

    if (this.im !== 0 || other.im !== 0) return this.factory(this).div(other);

    // (a/b √c) / (d/e √f) = (ae/bdf) * √(cf)
    const [a, b] = this.rational;
    const [d, e] = other.rational;
    return this.clone({
      rational: [a * e, b * d * other.radical],
      radical: this.radical * other.radical,
    });
  }

  pow(
    exponent: number | [number, number] | { re: number; im: number }
  ): NumericValue {
    if (Array.isArray(exponent)) exponent = exponent[0] / exponent[1];

    if (this.isNaN) return this;
    if (typeof exponent === 'number' && isNaN(exponent)) return this.clone(NaN);

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
      return this.factory(this).pow(exponent);

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

    // Is it a multiple of square root?
    // Decompose to try to preserve the rational part
    if (exponent % 1 === 0.5)
      return this.pow(Math.floor(exponent)).mul(this.sqrt());

    if (this.im !== 0) return this.factory(this).pow(exponent);

    // If the parts (rational or radical) are too large, we convert to float
    if (
      this.radical > SMALL_INTEGER ||
      Math.abs(this.im) > SMALL_INTEGER ||
      Math.abs(this.rational[0]) > SMALL_INTEGER ||
      this.rational[1] > SMALL_INTEGER
    )
      return this.factory(this).pow(exponent);

    if (this.sign < 0) {
      if (Number.isInteger(exponent)) {
        const sign = exponent % 2 === 0 ? 1 : -1;
        return this.clone({
          rational: [
            sign * (-this.rational[0]) ** exponent,
            this.rational[1] ** exponent,
          ],
          radical: this.radical ** exponent,
        });
      }
      return this.cloneIm((-this.re) ** exponent);
    }
    return this.factory(this).pow(exponent);
  }

  sqrt(): NumericValue {
    if (this.isZero || this.isOne) return this;

    if (this.im !== 0) {
      // Complex square root:
      // sqrt(a + bi) = sqrt((a + sqrt(a^2 + b^2)) / 2) + i * sign(b) * sqrt((sqrt(a^2 + b^2) - a) / 2)
      const a = this.re;
      const b = this.im;
      const modulus = Math.sqrt(a * a + b * b);
      const realPart = Math.sqrt((a + modulus) / 2);
      const imaginaryPart = Math.sign(b) * Math.sqrt((modulus - a) / 2);
      if (Number.isInteger(realPart) && Number.isInteger(imaginaryPart))
        return this.clone({ decimal: realPart, im: imaginaryPart });
      return this.factory({ decimal: realPart, im: imaginaryPart });
    }

    // Can we preserve the rational?
    // If radical ≠ 1, we know that √radical is not an integer, or it would
    // have been normalized to the rational part
    if (this.radical === 1) {
      // √(n/d) = √(n/d) = √(nd) / d
      // (if nd is a perfect square, or a product of perfect squares it
      // will get normalized to the rational numerator)
      const [n, d] = this.rational;
      if (n > 0) return this.clone({ radical: n * d, rational: [1, d] });

      //
      // Negative Rational: convert to imaginary
      //
      return this.cloneIm(Math.sqrt(-n * d) / d);
    }

    console.assert(this.im === 0);

    if (this.sign > 0) {
      const re = Math.sqrt(this.re);
      if (Number.isInteger(re)) return this.clone(re);
    }
    return this.factory(this).sqrt();
  }

  gcd(other: NumericValue): NumericValue {
    if (!(other instanceof ExactNumericValue)) return other.gcd(this);
    if (this.im !== 0 || this.isOne || other.im !== 0 || other.isOne)
      return this.clone(1);

    // Calculate the GCD of the rational parts
    const rational: [number, number] = [
      gcd(this.rational[0], other.rational[0]),
      gcd(this.rational[1], other.rational[1]),
    ];
    const radical: number = gcd(this.radical, other.radical);
    return this.clone({ rational, radical });
  }

  abs(): NumericValue {
    if (this.im === 0) {
      if (this.sign === -1) return this.neg();
      return this;
    }
    // abs(z) = √(z.real² + z.imaginary²)
    if (this.sign === 0) return this.clone({ im: -this.im });
    return this.factory(this).abs();
  }

  ln(base?: number): NumericValue {
    if (this.isZero) return this.clone(-Infinity);
    if (this.isPositiveInfinity) return this.clone(Infinity);

    if (this.im === 0) {
      if (this.sign < 0) return this.clone(NaN);
      if (this.isOne) return this.clone(0);
      if (this.isNegativeOne) return this.clone({ im: Math.PI });
    }

    return this.factory(this).ln(base);
  }

  // When using add(), inexact values propagate, i.e. '1.2 + 1/4' -> '1.45'
  // This may not be desirable when adding many values, i.e. '1.2 - 1.2 + 1/4' -> '1/4'
  // Furthermore we may want to keep track of rational and square rational parts
  // i.e. '1.2 + 1/4 + √5 + √7' -> '3/4 + √5 + √7'
  // '1.2 + 1/4 + √5 + √5' -> '3/4 + 2√5'
  static sum(
    values: NumericValue[],
    factory: NumericValueFactory
  ): NumericValue[] {
    // If we have some inexact values, just do a simple sum
    if (!values.every((x) => x instanceof ExactNumericValue)) {
      let sum = factory(0);
      for (const value of values) sum = sum.add(value);
      return [sum];
    }

    let imSum = 0;
    let rationalSum: [number, number] = [0, 1];
    const radicals: { multiple: [number, number]; radical: number }[] = [];

    for (const value of values) {
      if (value.isNaN) return [new ExactNumericValue(NaN, factory)];
      if (value.isZero) continue;

      imSum += value.im;

      // We have a rational or a radical
      const rational = value.rational;
      if (value.radical === 1) {
        // Just a fraction, add it to the sum
        rationalSum = add(rationalSum, rational) as [number, number];
      } else {
        // We have a rational and a radical, e.g. 2√5 or (1/3)√7 or √2
        const index = radicals.findIndex((x) => x.radical === value.radical);
        if (index === -1) {
          radicals.push({ multiple: rational, radical: value.radical });
        } else {
          // There was already a radical, add to it, e.g. "√2 + √2" = "2√2"
          radicals[index].multiple = add(
            radicals[index].multiple,
            rational
          ) as [number, number];
        }
      }
    }

    // If we add no additional rational or radical,
    if (isZero(rationalSum) && radicals.length === 0)
      return [new ExactNumericValue({ im: imSum }, factory)];

    // If we have a rational, merge it with the radicals
    radicals.push({ multiple: rationalSum, radical: 1 });
    return radicals.map(
      (x) =>
        new ExactNumericValue(
          { rational: x.multiple, radical: x.radical },
          factory
        )
    );
  }
}

function toFixed(n: bigint | number): string {
  if (typeof n === 'number') return n.toFixed();
  let result = n.toString();
  // Remove any trailing zeros and count them
  let zeros = 0;
  while (result.endsWith('0')) {
    zeros++;
    result = result.slice(0, -1);
  }
  if (zeros === 0) return result;
  return `${result}e${zeros}`;
}
