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

import { BigDecimal } from '../../big-decimal/index.js';
import type { Rational, SmallInteger } from '../numerics/types.js';
import { NumericPrimitiveType } from '../../common/type/types.js';

/** The value is equal to `rational * sqrt(radical) + imRational * sqrt(imRadical) * i`
 *
 * Representable set (enforced by `ExactNumericValue`): one radical times a
 * Gaussian rational, `√r·(p + q·i)`:
 * - real values: `rational * sqrt(radical)` (imaginary part 0);
 * - pure-imaginary values: the real part is 0 (e.g. `√2·i`);
 * - both parts non-zero: `radical` and `imRadical` are equal (e.g. `2+3i`,
 *   `1/2-5i/3`, `√2 + √2·i`).
 *
 * A value needing two different radicals on a non-zero real AND a non-zero
 * imaginary component (e.g. `1 + √2·i`) is NOT representable exactly.
 *
 * @category Numerics */
export type ExactNumericValueData = {
  rational?: Rational; // A rational number, may not be reduced (i.e. 6/8)
  radical?: number; // A square root of an integer, may not be reduced (i.e. 4)
  imRational?: Rational; // The rational factor of the imaginary part
  imRadical?: number; // The radical factor of the imaginary part
};

/** @category Numerics */
export type NumericValueData = {
  re?: BigDecimal | number; // A floating point number (non-integer)
  // The imaginary part of the number. A big decimal keeps an imaginary part
  // that a double cannot hold (`10^{-800}`, `10^{800}`, or more than 16
  // digits). A `MachineNumericValue` converts it to the nearest double.
  im?: BigDecimal | number;
};

/** @category Numerics */
export type NumericValueFactory = (
  data: number | BigDecimal | NumericValueData
) => NumericValue;

/** @category Numerics */
export abstract class NumericValue {
  abstract get type(): NumericPrimitiveType;

  /** True if numeric value is the product of a rational and the square root of an integer.
   *
   * This includes: 3/4√5, -2, √2, etc...
   *
   * But it doesn't include 0.5, 3.141592, etc...
   *
   */
  abstract get isExact(): boolean;

  /** If `isExact()`, returns an ExactNumericValue, otherwise returns undefined.
   */
  abstract get asExact(): NumericValue | undefined;

  /** The real part of this numeric value.
   *
   * Can be negative, 0 or positive.
   */
  abstract get re(): number;

  /**  bignum version of .re, if available */
  get bignumRe(): BigDecimal | undefined {
    return undefined;
  }

  /** `bignumRe` computed at `prec` significant digits instead of
   * `BigDecimal.precision`. Only an exact value computes its big decimal
   * (a quotient or a radical); the other values hold it. */
  bignumReAt(_prec: number): BigDecimal | undefined {
    return this.bignumRe;
  }

  /** The imaginary part of this numeric value, as the double nearest to it.
   *
   * Can be negative, zero or positive.
   *
   * This is a PROJECTION for computations in doubles. It is `0` when the
   * true imaginary part is too small for a double (`10^{-800}`) and
   * `±Infinity` when it is too large (`10^{800}`). So do not use it to decide
   * whether the value is complex (use `isComplex`), nor whether the
   * imaginary part is finite or an integer.
   */
  im!: number; // Assigned by every concrete subclass constructor.

  /** True if the imaginary part of this numeric value is not zero.
   *
   * This is read from a representation that holds the imaginary part without
   * loss (the exact rational of an `ExactNumericValue`), so it is true for an
   * imaginary part whose double projection `im` is `0`, such as the exact
   * `10^{-800}·i`. Use it, not `im !== 0`, to decide whether a value is
   * complex.
   *
   * A value with a NaN imaginary part is NaN; do not rely on `isComplex` to
   * detect it.
   */
  abstract get isComplex(): boolean;

  get bignumIm(): BigDecimal | undefined {
    return undefined;
  }

  /** `bignumIm` computed at `prec` significant digits (see `bignumReAt`). */
  bignumImAt(_prec: number): BigDecimal | undefined {
    return this.bignumIm;
  }

  abstract get numerator(): NumericValue;
  abstract get denominator(): NumericValue;

  abstract get isNaN(): boolean;
  abstract get isPositiveInfinity(): boolean;
  abstract get isNegativeInfinity(): boolean;
  abstract get isComplexInfinity(): boolean;

  abstract get isZero(): boolean;
  isZeroWithTolerance(_tolerance: number | BigDecimal): boolean {
    return this.isZero;
  }
  abstract get isOne(): boolean;
  abstract get isNegativeOne(): boolean;

  /** The sign of complex numbers is undefined */
  abstract sgn(): -1 | 0 | 1 | undefined;

  /** Return a non-exact representation of the numeric value.
   *
   * The methods that round or bound a result (`N`, `inv`, `add`, `sub`,
   * `mul`, `div`, `pow`, `root`, `sqrt`, `abs`, `ln`, `exp`) take an
   * optional last argument `prec`, the number of significant digits of the
   * working precision. An engine passes its own precision; the default is
   * `BigDecimal.precision`, which the last engine made or configured wrote.
   */
  abstract N(prec?: number): NumericValue;

  /**
   * This value with each part rounded to `digits` significant digits. A
   * value that is already within `digits` (an exact value, a machine float,
   * a big decimal with no more digits) is returned as it is.
   *
   * The `add` and `mul` of a big decimal are exact, so a running sum or
   * product of big floats grows a digit count of the size of the exponent
   * span, or of the number of factors: the numeric folds of `Sum` and
   * `Product` round each partial result with this method.
   */
  roundToPrecision(_digits: number): NumericValue {
    return this;
  }

  abstract neg(): NumericValue;
  abstract inv(prec?: number): NumericValue;
  abstract add(other: number | NumericValue, prec?: number): NumericValue;
  abstract sub(other: NumericValue, prec?: number): NumericValue;
  abstract mul(
    other: number | BigDecimal | NumericValue,
    prec?: number
  ): NumericValue;
  abstract div(other: SmallInteger | NumericValue, prec?: number): NumericValue;
  abstract pow(
    n: number | NumericValue | { re: number; im: number },
    prec?: number
  ): NumericValue;
  abstract root(n: number, prec?: number): NumericValue;
  abstract sqrt(prec?: number): NumericValue;

  abstract gcd(other: NumericValue): NumericValue;
  abstract abs(prec?: number): NumericValue;

  abstract ln(base?: number, prec?: number): NumericValue;
  abstract exp(prec?: number): NumericValue;

  abstract floor(): NumericValue;
  abstract ceil(): NumericValue;
  abstract round(): NumericValue;

  abstract eq(other: number | NumericValue): boolean;
  abstract lt(other: number | NumericValue): boolean | undefined;
  abstract lte(other: number | NumericValue): boolean | undefined;
  abstract gt(other: number | NumericValue): boolean | undefined;
  abstract gte(other: number | NumericValue): boolean | undefined;

  //
  // JavaScript Object methods
  //

  /** Object.valueOf(): returns a primitive value, preferably a JavaScript
   *  number over a string, even if at the expense of precision. A complex
   *  value is a string with `prec` significant digits in each part. */
  valueOf(prec?: number): number | string {
    if (!this.isComplex) {
      const big = prec === undefined ? this.bignumRe : this.bignumReAt(prec);
      return big ? big.toNumber() : this.re;
    }

    return this.toString(prec);
  }

  /** Object.toPrimitive() */
  [Symbol.toPrimitive](
    hint: 'number' | 'string' | 'default'
  ): number | string | null {
    return hint === 'string' ? this.toString() : this.valueOf();
  }

  /** Object.toJSON */
  toJSON(): unknown {
    if (!this.isComplex) {
      const r = this.re;
      // JSON cannot represent NaN, Infinity, -Infinity
      if (Number.isFinite(r)) return r;
    }
    return this.N().toString();
  }

  /** A string of the value. A big decimal value is rounded to `prec`
   * significant digits (default `BigDecimal.precision`). */
  abstract toString(prec?: number): string;

  print(): void {
    // Make sure the console.log is not removed by minification
    const log = console['log'];
    log?.(this.toString());
  }
}
