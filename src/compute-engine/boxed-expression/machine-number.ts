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
