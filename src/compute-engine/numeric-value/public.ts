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
 * - `ExactNumericValue` is a numeric value that represents numbers as the
 *    sum of an imaginary number and the product of a rational and a radical
 *    (square root of a integer).
 * - `BigNumericValue` is a numeric value that represents numbers as the
 *   sum of an imaginary number and a decimal (arbitrary precision) number.
 *
 * An exact numeric value may need to be converted to a float one, for
 *   example when calculating the square root of a square root.
 *
 * A float numeric value is never converted to an exact one.
 *
 */

import Decimal from 'decimal.js';
import { SmallInteger } from '../numerics/numeric';
import { Rational } from '../numerics/rationals';

/** The value is equal to `(decimal * rational * sqrt(radical)) + im * i` */
export interface NumericValueData {
  decimal?: Decimal | number; // A floating point number (non-integer)
  rational?: Rational; // A rational number, may not be reduced
  radical?: number; // A square root of an integer, may not be reduced
  im?: number; // The imaginary part of the number
}

export type NumericValueFactory = (
  data: number | Decimal | NumericValueData
) => NumericValue;

export abstract class NumericValue {
  get isExact(): boolean {
    return false;
  }

  // Note: complex :> real :> rational :> integer
  abstract get type(): 'complex' | 'real' | 'rational' | 'integer';

  /** The imaginary part of this numeric value.
   *
   * Can be negative, zero or positive.
   */
  readonly im: number;

  /** The real part of this numeric value.
   *
   * Can be negative, 0 or positive.
   */
  abstract get re(): number;

  /**  bignum version of .re, if available */
  get bignumRe(): Decimal | undefined {
    return undefined;
  }

  abstract get numerator(): NumericValue;
  abstract get denominator(): NumericValue;

  abstract get isNaN(): boolean;
  abstract get isPositiveInfinity(): boolean;
  abstract get isNegativeInfinity(): boolean;

  abstract get isZero(): boolean;
  isZeroWithTolerance(_tolerance: number | Decimal): boolean {
    return this.isZero;
  }
  abstract get isOne(): boolean;
  abstract get isNegativeOne(): boolean;

  /** The sign of complex numbers is undefined */
  abstract sgn(): -1 | 0 | 1 | undefined;

  abstract N(): NumericValue;

  abstract neg(): NumericValue;
  abstract inv(): NumericValue;
  abstract add(other: number | NumericValueData): NumericValue;
  abstract sub(other: NumericValueData): NumericValue;
  abstract mul(other: number | Decimal | NumericValueData): NumericValue;
  abstract div(other: SmallInteger | NumericValueData): NumericValue;
  abstract pow(n: number | { re: number; im: number }): NumericValue;
  abstract root(n: number): NumericValue;
  abstract sqrt(): NumericValue;
  abstract gcd(other: NumericValue): NumericValue;
  abstract abs(): NumericValue;
  abstract ln(base?: number): NumericValue;
  abstract exp(): NumericValue;
  abstract floor(): NumericValue;
  abstract ceil(): NumericValue;
  abstract round(): NumericValue;

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
      // JSON cannot represent NaN, Infinity, -Infinity
      if (Number.isFinite(r)) return r;
    }
    return this.N().toString();
  }

  print(): void {
    // Make sure the console.log is not removed by minification
    const log = console['log'];
    log?.(this.toString());
  }
}
