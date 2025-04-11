import type { BoxedExpression, Sign } from '../global-types';

export function sgn(expr: BoxedExpression): Sign | undefined {
  const ce = expr.engine;

  // If we have a hold expression, we don't know the sign
  if (expr.operator === 'Hold') return undefined;

  let s: Sign | undefined = undefined;

  //
  // The expression is a function expression
  //
  if (expr.ops) {
    const def = expr.functionDefinition;
    if (def?.sgn) {
      const context = ce.swapScope(expr.scope);
      s = def.sgn(expr.ops, { engine: ce });
      ce.swapScope(context);
    }
    return s;
  }

  //
  // A symbol
  //
  if (expr.symbol) return expr.symbolDefinition?.sgn;

  //
  // A number
  //
  if (expr.isNumberLiteral) return expr.sgn;

  // A string, or a tensor
  return 'unsigned';
}

export function infinitySgn(s: Sign | undefined): boolean | undefined {
  if (s === undefined) return undefined;
  return (
    s === 'positive-infinity' ||
    s === 'negative-infinity' ||
    s === 'complex-infinity'
  );
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

  if (s === 'positive' || s === 'positive-infinity') return true;
  if (
    (
      ['non-positive', 'zero', 'negative', 'negative-infinity'] as Sign[]
    ).includes(s)
  )
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
  if ((['negative', 'negative-infinity'] as Sign[]).includes(s)) return false;

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

  if (s === 'negative' || s === 'negative-infinity') return true;
  if (
    (
      ['non-negative', 'zero', 'positive', 'positive-infinity'] as Sign[]
    ).includes(s)
  )
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

  if (
    (
      [
        'negative',
        'negative-infinity',
        'non-positive',
        'zero',
      ] as Sign[] as Sign[]
    ).includes(s)
  )
    return true;
  //Definitely positive
  if ((['positive', 'positive-infinity'] as Sign[]).includes(s)) return false;

  //'nan', a complex-number sign, or a sign not conveying sufficient info.
  return undefined;
}
