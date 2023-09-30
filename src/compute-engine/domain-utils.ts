import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';
import { isRational } from './numerics/rationals';
import { DomainLiteral, Rational } from './public';

/**
 * Determine the numeric domain of a number.
 */
export function inferNumericDomain(
  value: number | Decimal | Complex | Rational
): DomainLiteral {
  //
  // 1. Is it a number?
  //

  if (typeof value === 'number' && !isNaN(value)) {
    if (!isFinite(value)) return 'ExtendedRealNumbers';

    // if (value === 0) return 'NonNegativeInteger'; // Bias: Could be NonPositiveInteger

    if (Number.isInteger(value)) {
      if (value > 0) return 'PositiveIntegers';
      if (value < 0) return 'NegativeIntegers';
      return 'Integers';
    }

    if (value > 0) return 'PositiveNumbers';
    if (value < 0) return 'NegativeNumbers';

    return 'RealNumbers';
  }

  //
  // 2 Is it a bignum?
  //
  if (value instanceof Decimal) {
    if (value.isNaN()) return 'Numbers';
    if (!value.isFinite()) return 'ExtendedRealNumbers';
    // if (value.isZero()) return 'NonNegativeInteger'; // Bias: Could be NonPositiveInteger

    if (value.isInteger()) {
      if (value.isPositive()) return 'PositiveIntegers';
      if (value.isNegative()) return 'NegativeIntegers';
      return 'Integers';
    }

    if (value.isPositive()) return 'PositiveNumbers';
    if (value.isNegative()) return 'NegativeNumbers';
    return 'RealNumbers';
  }

  //
  // 3 Is it a complex number?
  //
  if (value instanceof Complex) {
    const c = value as Complex;
    console.assert(c.im !== 0);
    if (c.re === 0) return 'ImaginaryNumbers';
    return 'ComplexNumbers';
  }

  //
  // 4. Is it a rational? (machine or bignum)
  //

  if (isRational(value)) {
    const [numer, denom] = value;

    // The value is a rational number
    console.assert(
      typeof numer !== 'number' ||
        (!Number.isNaN(numer) && !Number.isNaN(denom))
    );
    return 'RationalNumbers';
  }

  return 'Numbers';
}
