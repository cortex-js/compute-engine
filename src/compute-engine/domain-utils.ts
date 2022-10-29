import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';
import { BoxedExpression } from './public';

/** Quickly determine the numeric domain of a number or constant
 * For the symbols, this is a hard-coded optimization that doesn't rely on the
 * dictionaries. The regular path is in `internalDomain()`
 */
export function inferNumericDomain(
  value:
    | number
    | Decimal
    | Complex
    | [numer: number, denom: number]
    | [numer: Decimal, denom: Decimal]
): string {
  //
  // 1. Is it a number?
  //

  if (typeof value === 'number' && !isNaN(value)) {
    if (!isFinite(value)) return 'ExtendedRealNumber';

    // if (value === 0) return 'NonNegativeInteger'; // Bias: Could be NonPositiveInteger

    if (Number.isInteger(value)) {
      if (value > 0) return 'PositiveInteger';
      if (value < 0) return 'NegativeInteger';
      return 'Integer';
    }

    if (value > 0) return 'PositiveNumber';
    if (value < 0) return 'NegativeNumber';

    return 'RealNumber';
  }

  //
  // 2 Is it a bignum?
  //
  if (value instanceof Decimal) {
    if (value.isNaN()) return 'Number';
    if (!value.isFinite()) return 'ExtendedRealNumber';
    // if (value.isZero()) return 'NonNegativeInteger'; // Bias: Could be NonPositiveInteger

    if (value.isInteger()) {
      if (value.isPositive()) return 'PositiveInteger';
      if (value.isNegative()) return 'NegativeInteger';
      return 'Integer';
    }

    if (value.isPositive()) return 'PositiveNumber';
    if (value.isNegative()) return 'NegativeNumber';
    return 'RealNumber';
  }

  //
  // 3 Is it a complex number?
  //
  if (value instanceof Complex) {
    const c = value as Complex;
    console.assert(c.im !== 0);
    if (c.re === 0) return 'ImaginaryNumber';
    return 'ComplexNumber';
  }

  //
  // 4. Is it a rational? (machine or bignum)
  //

  if (Array.isArray(value)) {
    const [numer, denom] = value;

    // The value is a rational number
    console.assert(
      typeof numer !== 'number' ||
        (!Number.isNaN(numer) && !Number.isNaN(denom))
    );
    return 'RationalNumber';
  }

  return 'Number';
}

/**
 * Simple description of a numeric domain as a base domain, a min and
 * max value, possibly open ends, and some excluded values.
 */
export type NumericDomainInfo = {
  domain?: string; // Integer, RealNumber, ComplexNumber...
  // (not one of the 'shortcuts', i.e. PositiveInteger)
  min?: number; // Min and Max are not defined for ComplexNumbers
  max?: number;
  open?: 'left' | 'right' | 'both'; // For RealNumbers
  /** Values from _excludedValues_ are considered not in this domain */
  excludedValues?: number[];
  /** If defined, the values in this domain must follow the relation
   * _period_ * _n_ + _phase_ when _n_ is in _domain_.
   */
  multiple?: [period: number, domain: BoxedExpression, phase: number];
};
