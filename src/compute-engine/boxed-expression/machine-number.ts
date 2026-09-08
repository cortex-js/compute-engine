import type { Expression } from '../types-expression.js';
import { isNumber } from './type-guards.js';
import { exactDoubleValue } from '../numeric-value/exact-integer-value.js';

/**
 * The machine number a boxed number stands for, when it stands for one —
 * that is, when the boxed form of the answer is the same expression
 * (`ce.number(x).isSame(target)`): an integer, a finite double, an infinity
 * or `NaN`. `undefined` for an exact rational, a radical, a bignum with more
 * digits than a double holds, a complex number, or a non-number.
 *
 * This is the admission test of every numeric-store fast path
 * (`FunctionInterface._numericStore`): a store entry `v` is exactly
 * `ce.number(v)`, so a value admitted here compares by value against the
 * store, and the `array` facet of an ordinary list admits an element by the
 * same rule. It never returns an approximation of an exact value.
 *
 * An EXACT value is tested on its exact representation, not with `isSame`:
 * at `precision: "machine"` the engine compares numbers by their machine
 * value, so `ce.number(1/3).isSame(Rational(1, 3))` is `true` there, and
 * the test would have admitted the double `0.333…` for the exact rational
 * `1/3` (and `1.414…` for `√2`) — an approximation, which this function
 * promises never to return. An exact value is a machine number only when a
 * double holds it with no rounding (`exactDoubleValue`): an integer inside
 * the significand's reach (`2^70` is, `2^53 + 1` is not) or a rational with
 * a power-of-two denominator (`1/2`, `3/4`). An inexact value (a machine float, or a bignum float) is admitted when the
 * double is the same value, which `isSame` does decide.
 */
export function machineNumberOf(target: Expression): number | undefined {
  if (!isNumber(target)) return undefined;
  const nv = target.numericValue;
  if (typeof nv === 'number') return nv;
  if (nv.im !== 0) return undefined;
  if (nv.isExact) return exactDoubleValue(nv);
  const x = target.re;
  return target.engine.number(x).isSame(target) ? x : undefined;
}

/**
 * Whether a boxed number that `machineNumberOf` answered `x` for is an
 * EXACT value that is not an integer: an exact rational with a power-of-two
 * denominator, such as `1/2` or `-7/8` (the only exact non-integers a
 * double holds). `false` for an integer in any representation (a machine
 * integer, an integer-valued bignum, an exact bigint such as `2^70`), for a
 * float, for `NaN` and the infinities, and for a non-number.
 *
 * This is the one test that separates the `array` facet from the
 * `isMachineNumeric` predicate. `array` answers the VALUES: `1/2` is in it
 * as `0.5`, with no rounding. But re-boxing that array does not reproduce
 * the list: `ce.number(0.5)` is a float, and the interpreter then computes
 * `0.5 / 3` as a float where the list computed `1/2 ÷ 3 = 1/6` exactly. An
 * integer has no such residue — `ce.number()` of an integer-valued double
 * is an exact integer, a bigint when the double is past the safe range —
 * so an integer is never counted, whatever its representation.
 *
 * The integer test is on the admitted double `x`, not on the numeric
 * value's fields: `x` holds the exact value with no rounding, so
 * `Number.isInteger(x)` is exact, where a reduced-denominator test would
 * repeat the reduction `exactDoubleValue` already did.
 */
export function isExactNonInteger(target: Expression, x: number): boolean {
  if (!isNumber(target)) return false;
  const nv = target.numericValue;
  if (typeof nv === 'number') return false;
  return nv.isExact && !Number.isInteger(x);
}
