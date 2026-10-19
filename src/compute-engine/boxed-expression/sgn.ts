import type { Expression, Sign } from '../global-types.js';
import { isFunction, isSymbol, isNumber } from './type-guards.js';
import { signOfType } from '../../common/type/utils.js';

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

    // When the operator's sign handler proves nothing, a RANGED result type
    // can: `1 - t` with `t: real<0.9985..0.9999>` is typed
    // `real<0.0001..0.0015>`, so it is positive. The symbol route reads a
    // ranged declaration the same way (`BoxedSymbol.sgn`). `signOfType`
    // answers only for a real type that excludes NaN.
    if (s === undefined) s = signOfType(expr.type.type);

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

/**
 * The sign of a value that has both sign `a` and sign `b`: the strongest
 * sign the two facts entail together. For example, `non-negative` and
 * `not-zero` give `positive`, and `non-negative` and `non-positive` give
 * `zero`.
 *
 * Only the real signs (`zero`, `positive`, `negative`, `non-negative`,
 * `non-positive`, `not-zero`) are combined. When one of the two is
 * `undefined`, the result is the other. When one is another sign
 * (`unsigned`…), the result is `a`. When the two contradict each other
 * (`positive` and `negative`), no value has both signs, and the result is
 * `undefined` rather than one of the two.
 */
export function meetSigns(
  a: Sign | undefined,
  b: Sign | undefined
): Sign | undefined {
  if (a === undefined) return b;
  if (b === undefined || a === b) return a;
  const facts = (s: Sign) => {
    switch (s) {
      case 'zero':
        return { ge0: true, le0: true, nz: false };
      case 'positive':
        return { ge0: true, le0: false, nz: true };
      case 'negative':
        return { ge0: false, le0: true, nz: true };
      case 'non-negative':
        return { ge0: true, le0: false, nz: false };
      case 'non-positive':
        return { ge0: false, le0: true, nz: false };
      case 'not-zero':
        return { ge0: false, le0: false, nz: true };
      default:
        return undefined;
    }
  };
  const fa = facts(a);
  const fb = facts(b);
  if (fa === undefined || fb === undefined) return a;
  const ge0 = fa.ge0 || fb.ge0;
  const le0 = fa.le0 || fb.le0;
  const nz = fa.nz || fb.nz;
  if (ge0 && le0) return nz ? undefined : 'zero';
  if (ge0) return nz ? 'positive' : 'non-negative';
  if (le0) return nz ? 'negative' : 'non-positive';
  return 'not-zero';
}
