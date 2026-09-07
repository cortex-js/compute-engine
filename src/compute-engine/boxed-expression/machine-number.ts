import type { Expression } from '../types-expression.js';
import { isNumber } from './type-guards.js';

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
 */
export function machineNumberOf(target: Expression): number | undefined {
  if (!isNumber(target)) return undefined;
  const nv = target.numericValue;
  if (typeof nv === 'number') return nv;
  if (nv.im !== 0) return undefined;
  const x = target.re;
  return target.engine.number(x).isSame(target) ? x : undefined;
}
