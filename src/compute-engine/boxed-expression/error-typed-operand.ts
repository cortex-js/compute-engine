import type { Expression } from '../global-types.js';
import { isSymbol } from './type-guards.js';

/**
 * True when `op` is a valid symbol whose type is `error` and whose value is
 * an error (an `Error` expression), such as `w` after `w := Ln("a")`. The
 * symbol always evaluates to that error. Argument validation
 * (`validateArguments()`) passes such an operand through at every
 * parameter and does not replace it with a new `incompatible-type` error.
 * Overload resolution lets it through every arm, and the conditions of `If`
 * and `Which` pass it through too. The callback parameters of the lazy
 * collection operators pass it through (`canonicalCallbackOperand()`,
 * `library/collections.ts`), and the evaluation of the call gives its error
 * (`heldErrorCallback()`, `boxed-function.ts`): `Filter(xs, w)` and
 * `Map(w, xs)` are the error of `w`.
 *
 * Only a symbol can qualify. Other operands of type `error` are not passed
 * through as an error:
 * - An inline error expression (`Ln("a")` at boxing) is invalid, and the
 *   checks for an invalid operand handle it.
 * - A valid application whose type is `error` (`g(2)` after
 *   `ce.declare('g', '(number) -> error')`) has that type only because the
 *   declared result type says so. That type is a promise of the host, not a
 *   value: with no body, `g(2)` evaluates to itself.
 * - A symbol declared `error` with no value (`ce.declare('e', 'error')`)
 *   evaluates to itself, not to an error.
 * These operands are checked as ordinary operands of type `error` (see
 * {@link isErrorTypedWithoutErrorValue}).
 *
 * This predicate is in its own file because `validate.ts` imports
 * `overload.ts`, and both use it.
 */
export function isErrorTypedOperand(op: Expression): boolean {
  if (!op.isValid || !isSymbol(op) || op.type.type !== 'error') return false;
  return op.value?.operator === 'Error';
}

/**
 * True when `op` is valid and its type is `error`, but it is not known to
 * hold an error value: a symbol declared `error` with no value
 * (`ce.declare('e', 'error')`), or an application whose declared result
 * type is `error`. The type checks treat it as an ordinary operand of type
 * `error`. The type `error` overlaps every type, so a scalar parameter
 * (`number`, `boolean`, `T` with `T: number`) and the condition of `If`
 * admit it, and the call evaluates to itself. A collection parameter
 * (`list`, `T` with `T: list`) refuses it, and so does a parameter typed
 * `unknown` of a library operator or of a function literal (the declared
 * signature `(unknown) -> unknown` of a function name admits it). See
 * {@link isErrorTypedOperand}.
 */
export function isErrorTypedWithoutErrorValue(op: Expression): boolean {
  return op.isValid && op.type.type === 'error' && !isErrorTypedOperand(op);
}
