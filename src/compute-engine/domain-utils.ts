import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';
import { isRational } from './numerics/rationals';
import { DomainLiteral, Rational, SemiBoxedExpression } from './public';
import { _BoxedExpression } from './boxed-expression/abstract-boxed-expression';
import {
  isDictionaryObject,
  isFunctionObject,
  isNumberObject,
  isStringObject,
  isSymbolObject,
  machineValue,
} from '../math-json/utils';
import { Expression } from '../math-json';
import { isDomain } from './boxed-expression/boxed-domain';

/** Quickly determine the numeric domain of a number or constant
 * For the symbols, this is a hard-coded optimization that doesn't rely on the
 * dictionaries. The regular path is in `internalDomain()`
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

export function inferDomain(expr: SemiBoxedExpression): DomainLiteral {
  if (expr instanceof _BoxedExpression) {
    if (expr.domain.base) return expr.domain.base;
    if (expr.domain.ctor) {
      switch (expr.domain.ctor) {
        case 'FunctionOf':
          return 'Functions';
        case 'ListOf':
          return 'Lists';
        case 'DictionaryOf':
          return 'Dictionaries';
        case 'TupleOf':
          return 'Tuples';
      }
    }
    return 'Anything';
  }
  if (
    typeof expr === 'number' ||
    expr instanceof Decimal ||
    expr instanceof Complex
  )
    return inferNumericDomain(expr);

  if (isStringObject(expr as Expression)) return 'Strings';

  if (isSymbolObject(expr as Expression) || typeof expr === 'string')
    return 'Symbols';

  if (isDictionaryObject(expr as Expression)) return 'Dictionaries';

  if (isFunctionObject(expr as Expression)) return 'Functions';

  if (typeof expr === 'function') return 'Functions';

  if (Array.isArray(expr)) return 'Functions';

  if (isNumberObject(expr as Expression)) {
    const value = machineValue(expr as Expression);
    if (value === null) return 'Numbers';
    return inferNumericDomain(value);
  }

  if (isDomain(expr)) return 'Domains';

  return 'Anything';
}
