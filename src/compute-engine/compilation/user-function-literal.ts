// The function literal of a user function, for a compilation: refused when
// a captured symbol of its body changed type since the literal was typed.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isValueDef } from '../boxed-expression/utils.js';
import { capturedValueMismatchNowEntry } from '../function-utils.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import { capturedTypeWidening } from '../boxed-expression/function-literal.js';

/**
 * If `id` names a symbol whose engine definition is a user-defined function
 * literal, return that `["Function", body, …params]` literal; otherwise
 * `undefined`. Covers both storage routes:
 *  - an operator definition backed by a lambda (`f(x) := …`, `x ↦ …`, or
 *    `ce.assign(name, lambda)`), where the literal is kept on the operator
 *    definition as `_lambdaLiteral`; and
 *  - a plain symbol whose assigned value is itself a `Function` literal.
 *
 * Public so compilation targets can check whether a symbol operand is
 * structurally callable (e.g. the `Reduce` combiner) before compiling it.
 */
export function userFunctionLiteral(
  engine: ComputeEngine,
  id: string
): (Expression & FunctionInterface) | undefined {
  const def = engine.lookupDefinition(id);
  if (def && 'operator' in def) {
    const literal = (def.operator as { _lambdaLiteral?: Expression })
      ._lambdaLiteral;
    if (literal !== undefined && isFunction(literal, 'Function')) {
      assertCapturedTypesCurrent(id, literal, def.operator);
      return literal;
    }
  }
  const value = engine._getSymbolValue(id);
  if (value !== undefined && isFunction(value, 'Function')) {
    assertCapturedTypesCurrent(
      id,
      value,
      isValueDef(def) ? def.value : undefined
    );
    return value;
  }
  return undefined;
}

/**
 * Refuse to compile a call of the user function `id` whose literal is
 * `literal` when a captured symbol of the body makes the static type of
 * the call doubtful, as the interpreter checks such a call:
 * - the symbol holds a value of another type than the body was typed with
 *   (`capturedValueMismatchNow()`, `function-utils.ts`), whatever the
 *   provenance of the type of the definition;
 * - `def`, the definition that holds the literal, has a captured symbol
 *   that changed type since the literal was stored
 *   (`capturedTypesWidened()`), whatever the provenance of the type of
 *   `def`: the body was typed with the earlier type, and its compiled
 *   operators do not check their operands (with `y` changed from a number
 *   to a string, `x + y` compiles to a string concatenation, where the
 *   interpreter gives the `incompatible-type` error of `Add`).
 * The interpreter checks such a call (`resultOutsideCallType()`,
 * `boxed-expression/function-literal.ts`, and the operators of the body).
 * The compiled code has no such check, so the compile fails closed and the
 * interpreter evaluates the call.
 * (User decision 2026-10-25, option (c) of CE-473 in `ROADMAP.md`.)
 */
function assertCapturedTypesCurrent(
  id: string,
  literal: Expression,
  def: object | undefined
): void {
  // The message names the symbol and both types, so that a host can find
  // the declaration or the assignment that changed it.
  const widened = def !== undefined ? capturedTypeWidening(def) : undefined;
  let reason: string;
  if (widened !== undefined)
    reason =
      `the symbol '${widened.name}' that its body reads has the type ` +
      `\`${widened.now.toString()}\`, but the body of '${id}' was ` +
      `typed when '${widened.name}' had the type ` +
      `\`${widened.before.toString()}\``;
  else {
    const mismatch = capturedValueMismatchNowEntry(literal);
    if (mismatch === undefined) return;
    reason =
      `the symbol '${mismatch.name}' that its body reads holds a value of ` +
      `type \`${mismatch.value.type.toString()}\`, but the body was typed ` +
      `with '${mismatch.name}' of type \`${mismatch.expected.toString()}\``;
  }
  throw new Error(
    `Could not compile the function '${id}': ${reason}. ` +
      `The interpreter evaluates it instead.`
  );
}
