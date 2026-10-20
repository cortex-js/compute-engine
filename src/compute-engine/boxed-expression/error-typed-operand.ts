import type { Expression } from '../global-types.js';
import { isSymbol } from './type-guards.js';

/**
 * True when `op` is a valid symbol whose type is `error` and whose value is
 * an error (an `Error` expression), such as `w` after `w := Ln("a")`. The
 * symbol always evaluates to that error. Argument validation
 * (`validateArguments()`) passes such an operand through at every
 * parameter and does not replace it with a new `incompatible-type` error.
 * Overload resolution lets it through every arm, and the conditions of `If`
 * and `Which` pass it through too.
 *
 * The callback slots of the library collection operators do not pass it
 * through yet: `Map(w, xs)` and `Filter(xs, w)` still give "expected
 * `function`, got `error`" (`canonicalCallbackOperand()`,
 * `library/collections.ts`).
 *
 * Only a symbol can qualify. Other operands of type `error` are not passed
 * through:
 * - An inline error expression (`Ln("a")` at boxing) is invalid, and the
 *   checks for an invalid operand handle it.
 * - A valid application whose type is `error` (`g(2)` after
 *   `ce.declare('g', '(number) -> error')`) has that type only because the
 *   declared result type says so. That type is a promise of the host, not a
 *   value: with no body, `g(2)` evaluates to itself.
 * - A symbol declared `error` with no value (`ce.declare('e', 'error')`)
 *   evaluates to itself, not to an error.
 * A parameter that does not accept the type `error` refuses these operands
 * (see {@link isErrorTypedWithoutErrorValue}).
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
 * `error`, so a parameter that does not accept `error` refuses it. See
 * {@link isErrorTypedOperand}.
 */
export function isErrorTypedWithoutErrorValue(op: Expression): boolean {
  return op.isValid && op.type.type === 'error' && !isErrorTypedOperand(op);
}
