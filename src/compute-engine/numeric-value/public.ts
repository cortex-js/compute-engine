/**
 *
 * ## THEORY OF OPERATIONS
 *
 * A numeric value represents a number literal.
 *
 * It is defined as a functional field over the complex numbers.
 *
 * It includes basic arithmetic operations: addition, subtraction,
 * multiplication, power, division, negation, inversion, square root.
 *
 * Several flavors of numeric values are available:
 * - `NumericValue` is the base class for all numeric values.
 * - `MachineNumericValue` is a numeric value that represents numbers as a
 *   product of a decimal (float), a rational and a radical (square root of a
 *    an integer). This allows calculations to preseve exact values.
 * - `BigNumericValue` is an extension of `MachineNumericValue` that uses
 *   `Decimal` instead of `number` for the decimal part and
 *   `BigRational` instead of `[integer, integer]` for the rational parts.
 *
 */

import Decimal from 'decimal.js';
import { Rational, isOne, isInteger } from '../numerics/rationals';

/** The value is equal to `(re * rational * sqrt(radical)) + im * i` */
export interface NumericValueData<
  D extends number | Decimal,
  R extends Rational,
> {
  re: D;
  rational: R;
  radical: number;
  im: number;
}

export type NumericValueFactory<D extends number | Decimal> = (
  data: NumericValueData<D, Rational>
) => NumericValue<D, Rational>;

/** The numeric value is equal to :
 * - complex(sign * decimal * rational * sqrt(radical), im)
 * - re = sign * decimal * rational * sqrt(radical)
 */

export abstract class NumericValue<
  D extends number | Decimal = number,
  R extends Rational = Rational,
> {
  sign: -1 | 0 | 1;
  /**  Includes Nan, Infinity, otherwise a decimal number, never an integer. Always positive. Can be zero if imaginary is not zero. */
  decimal: D;
  rational: R;
  radical: number;
  /** The imaginary part of this numeric value. Can be negative, zero or positive. */ im: number;
  abstract get re(): number; // = sign * decimal * rational * sqrt(radical)
  /**  bignum version of .re, if available */
  get bignumRe(): Decimal | undefined {
    return undefined;
  }

  /** The numerator of this numeric value */
  abstract get num(): NumericValue<D, R>;
  /** The denominator of this numeric value */
  abstract get denom(): NumericValue<D, R>;

  abstract normalize(): void;

  abstract get isExact(): boolean; // => decimal = 1 && imaginary = 0
  abstract get isNaN(): boolean;
  abstract get isPositiveInfinity(): boolean;
  abstract get isNegativeInfinity(): boolean;

  get isZero(): boolean {
    return this.sign === 0 && this.im === 0;
  }
  abstract get isOne(): boolean;
  abstract get isNegativeOne(): boolean;

  abstract N(): NumericValue<D, R>;

  abstract neg(): NumericValue<D, R>;
  abstract inv(): NumericValue<D, R>;
  abstract add(
    other: Partial<NumericValueData<D, R>> | number | Rational
  ): NumericValue<D, R>;
  abstract sub(
    other: Partial<NumericValueData<D, R>> | number | Rational
  ): NumericValue<D, R>;
  abstract mul(
    other: Partial<NumericValueData<D, R>> | number | Rational
  ): NumericValue<D, R>;
  abstract div(
    other: Partial<NumericValueData<D, R>> | number | Rational
  ): NumericValue<D, R>;
  abstract pow(n: number): NumericValue<D, R>;
  abstract sqrt(): NumericValue<D, R>;
  abstract gcd(other: NumericValue<D, R>): NumericValue<D, R>;
  abstract abs(): NumericValue<D, R>;

  // When using add(), inexact value propagate, i.e. '1.2 + 1/4' -> '1.45'
  // This may not be desirable when adding many values, i.e. '1.2 - 1.2 + 1/4' -> '1/4'
  // Furthermore we may want to keep track of rational and square rational parts
  // i.e. '1.2 + 1/4 + √5 + √7' -> '3/4 + √5 + √7'
  // '1.2 + 1/4 + √5 + √5' -> '3/4 + 2√5'
  // Note: this should be a static method, but TypeScript does not support static abstract methods
  abstract sum(...values: NumericValue<D, R>[]): NumericValue<D, R>[];

  //
  // JavaScript Object methods
  //

  /** Object.valueOf(): returns a primitive value */
  valueOf(): number | string {
    if (this.im === 0) {
      console.assert(typeof this.re === 'number');
      return this.bignumRe ? this.bignumRe.toFixed() : this.re;
    }
    return this.N().toString();
  }

  /** Object.toPrimitive() */
  [Symbol.toPrimitive](
    hint: 'number' | 'string' | 'default'
  ): number | string | null {
    return hint === 'string' ? this.toString() : this.valueOf();
  }

  /** Object.toJSON */
  toJSON(): any {
    if (this.im === 0) {
      const r = this.re;
      console.assert(typeof this.re === 'number');
      // JSON cannot represent NaN, Infinity, -Infinity
      if (Number.isFinite(r)) return r;
    }
    return this.N().toString();
  }

  /** Object.toString() */
  toString(): string {
    if (this.isZero) return '0';
    if (this.isOne) return '1';
    if (this.isNegativeOne) return '-1';

    const sign = this.sign < 0 ? '-' : '';

    const products: string[] = [];

    {
      const r = this.decimal.toString();
      if (r !== '1') {
        if (r.startsWith('-')) products.push(r.slice(1));
        else products.push(r);
      }
    }

    if (!isOne(this.rational)) {
      if (isInteger(this.rational)) products.push(toFixed(this.rational[0]));
      else
        products.push(
          `${toFixed(this.rational[0])}/${toFixed(this.rational[1])}`
        );
    }

    if (this.radical !== 1) products.push(`sqrt(${this.radical})`);

    if (this.im !== 0 && this.re === 0) return `${this.im}i`;

    let im = '';
    if (this.im < 0) im = `${this.im}i`;
    else if (this.im > 0) im = `+${this.im}i`;

    return `${sign}${products.join(' * ')}${im}`;
  }

  print(): void {
    // Make sure the console.log is not removed by minification
    const log = console['log'];
    log?.(this.toString());
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
