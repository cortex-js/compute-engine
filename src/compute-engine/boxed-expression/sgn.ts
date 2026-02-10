import type { Expression, Sign } from '../global-types';
import { isFunction, isSymbol, isNumber } from './type-guards';

export function sgn(expr: Expression): Sign | undefined {
  const ce = expr.engine;

  // If we have a hold expression, we don't know the sign
  // @todo: or one could argue that the sign is 'unsigned'
  if (expr.operator === 'Hold') return undefined;

  let s: Sign | undefined = undefined;

  //
  // The expression is a function expression
  //
  if (isFunction(expr)) {
    const def = expr.operatorDefinition;
    if (def?.sgn) s = def.sgn(expr.ops, { engine: ce });

    return s;
  }

  //
  // A symbol or a number literal
  //
  if (isSymbol(expr) || isNumber(expr)) return expr.sgn;

  // A string, or a tensor
  return 'unsigned';
}

/**
 * Sign `s` is > 0.
 *
 * :::info[Note]
 * Returns `undefined` for cases where the given sign is either non-applicable to real numbers
 * ('nan', 'unsigned', 'complex-infinity') or does not convey enough information (e.g. 'real',
 * 'not-zero', 'real-not-zero', 'non-negative').
 * :::
 *
 * @param s
 */
export function positiveSign(s: Sign | undefined): boolean | undefined {
  if (s === undefined) return undefined;

  if (s === 'positive') return true;
  if ((['non-positive', 'zero', 'negative'] as Sign[]).includes(s))
    return false;

  //Case for 'nan', signs for complex numbers ('unsigned', 'complex-infinity'), or sign does not
  //convey enough info. (e.g. 'real', 'not-zero', 'real-not-zero')
  return undefined;
}

/**
 * Sign `s` is >= 0.
 *
 *
 * **note**: returns *undefined* where sign does not apply to the field of reals, or does not convey
 * enough information.
 *
 * @param s
 */
export function nonNegativeSign(s: Sign | undefined): boolean | undefined {
  if (s === undefined) return undefined;

  if (
    (
      ['positive', 'positive-infinity', 'non-negative', 'zero'] as Sign[]
    ).includes(s)
  )
    return true;
  if (s === 'negative') return false;

  //Case for 'nan', complex numbers ('unsigned', 'complex-infinity', maybe 'not-zero'), or sign does not
  //convey enough info. (e.g. 'non-positive','real', 'real-not-zero')
  return undefined;
}

/**
 * Sign `s` is < 0.
 *
 * :::info[Note]
 * Returns `undefined` for cases where the given sign is either non-applicable to real numbers
 * ('nan', 'unsigned', 'complex-infinity') or does not convey enough information (e.g. 'real',
 * 'not-zero', 'real-not-zero', 'non-positive').
 * :::
 *
 * @param s
 */
export function negativeSign(s: Sign | undefined): boolean | undefined {
  if (s === undefined) return undefined;

  if (s === 'negative') return true;
  if ((['non-negative', 'zero', 'positive'] as Sign[]).includes(s))
    return false;

  //'nan', 'unsigned','complex-infinity', or not enough info: 'real-not-zero', 'non-positive', etc.
  return undefined;
}

/**
 * Sign `s` is <= 0.
 *
 *
 * **note**: returns *undefined* where sign does not apply to the field of reals, or does not convey
 * enough information.
 *
 * @param s
 */
export function nonPositiveSign(s: Sign | undefined): boolean | undefined {
  if (s === undefined) return undefined;

  if ((['negative', 'non-positive', 'zero'] as Sign[] as Sign[]).includes(s))
    return true;
  //Definitely positive
  if ((['positive', 'positive-infinity'] as Sign[]).includes(s)) return false;

  //'nan', a complex-number sign, or a sign not conveying sufficient info.
  return undefined;
}
