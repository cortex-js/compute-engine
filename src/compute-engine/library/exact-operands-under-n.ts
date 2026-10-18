/**
 * Guard digits for the exact operands of a special or elementary function
 * under `.N()`.
 */

import type { EvaluateHandlerOptions, Expression } from '../global-types.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { bignumPreferred } from '../boxed-expression/utils.js';
import { isExactConstantExpression } from '../boxed-expression/compare.js';
import { isExactRealLiteral } from '../boxed-expression/constraint-subject.js';

/**
 * The number of digits above the working precision at which an exact
 * operand is approximated, and at which the handler computes, before its
 * result is rounded to the working precision. The rounding error of the
 * operand reaches the result multiplied by the condition number of the
 * function at that point (`|x·f′(x)/f(x)|`), which is large near a zero of
 * the function: `Digamma(13/9)`, close to the zero of ψ at 1.4616…, lost
 * three digits.
 */
const EXACT_OPERAND_GUARD_DIGITS = 10;

/**
 * The precision of the guarded evaluation that runs now (the working
 * precision plus `EXACT_OPERAND_GUARD_DIGITS`), or `undefined` when none
 * runs. A handler called inside that evaluation, at that precision or
 * higher, does not add guard digits again: its operands were approximated
 * with the guard digits already. Without this, each level of a nested call
 * (`Sin(Cos(Sin(1/3)))`) approximated its operand again, and that operand
 * approximated its own operand again, so the cost doubled with each level.
 *
 * It is kept for each engine: a guarded evaluation on one engine does not
 * remove the guard digits of an evaluation on another engine that it calls.
 */
const guardedPrecision = new WeakMap<object, number>();

/**
 * True when `original`, an operand as written before `.N()` approximated
 * it, is an exact value whose approximation at the working precision has a
 * rounding error: an exact real number literal that is not an integer
 * (`1/3`, `√2`), or an exact constant expression (`π`, `ln 2`,
 * `isExactConstantExpression()`). An integer has no rounding error, and a
 * float has no more digits to read.
 */
function needsGuardDigits(original: Expression): boolean {
  if (isNumber(original))
    return isExactRealLiteral(original) && original.isInteger !== true;
  return isExactConstantExpression(original);
}

/**
 * An `evaluate` handler of a special or elementary function that reads its
 * exact operands with guard digits under `.N()`.
 *
 * Under `.N()`, the operands reach the handler as floats at the working
 * precision. The float of an exact operand (`1/3`, `√2`, `π`) has a
 * rounding error in its last digit, and the function carries that error to
 * the last digit of its result: at 50 digits, `Digamma(1/3).N()` ended in
 * `…67205`, where the correct value ends in `…67204`. The kernels compute
 * with their own guard digits, but they cannot get back digits that the
 * operand lost before they read it.
 *
 * So when an operand as written (`options.expression`) is an exact value
 * with a rounding error (`needsGuardDigits()`), and the handler received a
 * real number literal for it, the handler runs at the working precision plus
 * `EXACT_OPERAND_GUARD_DIGITS` digits. Each such operand is approximated
 * again at that precision; the other operands are kept as they are. A
 * float result is then rounded to the working precision. Another result (an
 * exact value, a symbolic expression, a non-finite value) is returned as it
 * is.
 *
 * Only above machine precision: at machine precision the kernels compute in
 * doubles, and a raised precision would change them to the big-decimal
 * kernels. Only for a real operand: a complex operand goes to the complex
 * kernels, which compute in doubles at every precision, so guard digits
 * add cost and no correct digit.
 *
 * `readAgain`, when given, selects the operands that can be approximated
 * again, by their operand as written and their index. An operand that it
 * rejects is kept as the handler received it.
 *
 * Do not use it for a `lazy` operator: its handler gets the operands as they
 * are written, not approximated.
 */
export function guardDigitsN(
  evaluate: (
    ops: ReadonlyArray<Expression>,
    options: EvaluateHandlerOptions
  ) => Expression | undefined,
  readAgain?: (original: Expression, index: number) => boolean
): (
  ops: ReadonlyArray<Expression>,
  options: EvaluateHandlerOptions
) => Expression | undefined {
  return (ops, options) => {
    const { numericApproximation, engine: ce, expression } = options;
    if (
      !numericApproximation ||
      !bignumPreferred(ce) ||
      expression === undefined ||
      !isFunction(expression) ||
      expression.nops !== ops.length ||
      ce.precision >= (guardedPrecision.get(ce) ?? Infinity)
    )
      return evaluate(ops, options);
    const originals = expression.ops;
    const guarded = ops.map(
      (op, i) =>
        isNumber(op) &&
        !op.isComplex &&
        needsGuardDigits(originals[i]) &&
        (readAgain === undefined || readAgain(originals[i], i))
    );
    if (!guarded.some((x) => x)) return evaluate(ops, options);

    const working = ce.precision;
    const raisedPrecision = working + EXACT_OPERAND_GUARD_DIGITS;
    const outerGuardedPrecision = guardedPrecision.get(ce);
    const result = ce._withTransientPrecision(raisedPrecision, () => {
      guardedPrecision.set(ce, raisedPrecision);
      try {
        const raised: Expression[] = [];
        for (let i = 0; i < ops.length; i++) {
          if (!guarded[i]) {
            raised.push(ops[i]);
            continue;
          }
          const value = originals[i].N();
          // The approximation of an exact constant expression is not always
          // a real number literal (an application that has only an
          // asynchronous handler stays unevaluated). Then the handler runs
          // at the working precision with the operands it received: at the
          // raised precision, the float of that operand has the error of
          // the working precision, and the handler reads this error as a
          // value (`sin` of the float of `π` is not rounded to `0`).
          if (!isNumber(value) || value.isComplex) return null;
          raised.push(value);
        }
        return evaluate(raised, options);
      } finally {
        if (outerGuardedPrecision === undefined) guardedPrecision.delete(ce);
        else guardedPrecision.set(ce, outerGuardedPrecision);
      }
    });
    if (result === null) return evaluate(ops, options);
    return roundToWorkingPrecision(result, working);
  };
}

/**
 * `result` rounded to `working` digits when it is a finite float with
 * big-decimal parts; `result` otherwise. It is called after the precision
 * of the engine is restored to `working`.
 */
function roundToWorkingPrecision(
  result: Expression | undefined,
  working: number
): Expression | undefined {
  if (result === undefined || !isNumber(result)) return result;
  if (result.isExact || result.isFinite !== true) return result;
  const re = result.bignumRe;
  const im = result.bignumIm;
  if (re === undefined && im === undefined) return result;
  const ce = result.engine;
  const bigRe = (re ?? ce.bignum(result.re)).toPrecision(working);
  if (!result.isComplex) return ce.number(ce._numericValue(bigRe));
  const bigIm = (im ?? ce.bignum(result.im)).toPrecision(working);
  return ce.number(ce._inexactNumericValue({ re: bigRe, im: bigIm }));
}
