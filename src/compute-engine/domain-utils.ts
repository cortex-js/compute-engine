import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';
import { BoxedExpression } from './public';
// import { gcd as decimalGcd } from './numerics/numeric-bignum';
import { reducedRational } from './numerics/numeric';

/** Quickly determine the numeric domain of a number or constant
 * For the symbols, this is a hard-coded optimization that doesn't rely on the
 * dictionaries. The regular path is in `internalDomain()`
 */
export function inferNumericDomain(
  value: number | Decimal | Complex | [numer: number, denom: number]
): string {
  //
  // 1. Is it a number?
  //

  if (typeof value === 'number' && !isNaN(value)) {
    if (!isFinite(value)) return 'ExtendedRealNumber';

    if (value === 0) return 'NonNegativeInteger'; // Bias: Could be NonPositiveInteger

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
    if (value.isZero()) return 'NonNegativeInteger'; // Bias: Could be NonPositiveInteger

    if (value.isInteger()) {
      if (value.gt(0)) return 'PositiveInteger';
      if (value.lt(0)) return 'NegativeInteger';
      return 'Integer';
    }

    if (value.gt(0)) return 'PositiveNumber';
    if (value.lt(0)) return 'NegativeNumber';
    return 'RealNumber';
  }

  //
  // 3 Is it a complex number?
  //
  if (value instanceof Complex) {
    const c = value as Complex;
    if (c.im === 0) return inferNumericDomain(c.re);
    if (c.re === 0 && c.im !== 0) return 'ImaginaryNumber';
    return 'ComplexNumber';
  }

  //
  // 4. Is it a rational?
  //

  if (Array.isArray(value)) {
    const [numer, denom] = reducedRational(value);

    if (!Number.isNaN(numer) && !Number.isNaN(denom)) {
      // The value is a rational number
      if (denom !== 1) return 'RationalNumber';

      return inferNumericDomain(numer);
    }
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

/**
 * Return an efficient data structure describing a numeric domain,
 * an `Interval` or `Range`
 * @todo could also check for `Multiple`
 */
export function inferNumericDomainInfo(
  expr: BoxedExpression
): NumericDomainInfo | null {
  const head = expr.head;
  if (head === 'Range' || head == 'Interval') {
    let open: 'both' | 'left' | 'right' | undefined = undefined;
    const arg1 = expr.op1;
    const arg2 = expr.op2;
    let min: number | null = null;
    let max: number | null = null;
    if (arg1.head === 'Open') {
      open = 'left';
      min = arg1.op1.asFloat ?? null;
    } else {
      min = arg1.asFloat ?? null;
    }
    if (arg2?.head === 'Open') {
      open = open === undefined ? 'right' : 'both';
      max = arg2.op1.asFloat ?? null;
    } else {
      max = arg2.asFloat ?? null;
    }
    if (min === null || max === null) return null;
    return {
      min,
      max,
      open,
      domain: head === 'Range' ? 'Integer' : 'RealNumber',
    };
  }
  const val = expr.asFloat;
  if (val !== null) {
    return {
      min: val,
      max: val,
      domain: inferNumericDomain(val) ?? 'Number',
    };
  }
  return null;
}
