/**
 * The exact value of a constant term of a shader expression: the operands
 * that the warning `float32-unsafe-argument` (`gpu-exact-trig.ts`, and
 * `amplifiedTrigMemo()` of `ir/adapter-glsl.ts`) and the exact sine hash read
 * as constants.
 */

import type { Expression } from '../global-types.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';

/**
 * The heads an exact constant term may use. Each one evaluates exactly and
 * has no side effect.
 */
const GPU_EXACT_ARITHMETIC_HEADS = new Set([
  'Add',
  'Subtract',
  'Negate',
  'Multiply',
  'Divide',
  'Rational',
  'Power',
  'Sqrt',
  'Root',
]);

/**
 * Whether `op` is a real number literal or an exact-arithmetic expression over
 * real number literals. An exponent above 4096 is refused, so that the exact
 * evaluation stays cheap (`2^{10^6}` has 300 000 digits).
 */
function gpuIsExactArithmetic(op: Expression): boolean {
  if (isNumber(op)) return !op.isComplex && op.isFinite === true;
  if (!isFunction(op) || !GPU_EXACT_ARITHMETIC_HEADS.has(op.operator))
    return false;
  if (op.operator === 'Power') {
    const e = op.ops[1];
    if (e === undefined || !isNumber(e) || !(Math.abs(e.re) <= 4096))
      return false;
  }
  return op.ops.every(gpuIsExactArithmetic);
}

/**
 * The exact real value of a constant term, as a number literal: a real number
 * literal, or an exact-arithmetic expression over real number literals
 * (`10^{20}`, `10^7/3`, `10^6·√2`). A term that calls any other function is
 * not a constant term, even with no symbols: `Random()` must be drawn at run
 * time, and a caller may map a function to its own code (the `functions`
 * option of `compile()`).
 */
export function gpuExactConstant(op: Expression): Expression | undefined {
  if (!gpuIsExactArithmetic(op)) return undefined;
  const v = isNumber(op) ? op : op.evaluate();
  return isNumber(v) && !v.isComplex && v.isFinite === true ? v : undefined;
}
