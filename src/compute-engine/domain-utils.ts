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

  if (isRational(value)) {
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

export function inferDomain(expr: SemiBoxedExpression): DomainLiteral {
  if (expr instanceof _BoxedExpression)
    return expr.domain.literal ?? expr.domain.ctor ?? 'Anything';

  if (
    typeof expr === 'number' ||
    expr instanceof Decimal ||
    expr instanceof Complex
  )
    return inferNumericDomain(expr);

  if (isStringObject(expr as Expression)) return 'String';

  if (isSymbolObject(expr as Expression) || typeof expr === 'string')
    return 'Symbol';

  if (isDictionaryObject(expr as Expression)) return 'Dictionary';

  if (isFunctionObject(expr as Expression)) return 'Functions';

  if (typeof expr === 'function') return 'Functions';

  if (Array.isArray(expr)) return 'Functions';

  if (isNumberObject(expr as Expression)) {
    const value = machineValue(expr as Expression);
    if (value === null) return 'Number';
    return inferNumericDomain(value);
  }

  if (isDomain(expr)) return 'Domain';

  return 'Anything';
}
