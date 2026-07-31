import type { Expression } from '../global-types.js';
import { isFunction } from './type-guards.js';

/**
 * Collection heads whose contents are DATA, not the structure of a failing
 * computation. `errorValue()` does not descend into them — see below.
 */
const COLLECTION_OPERATORS = new Set([
  'List',
  'Set',
  'Tuple',
  'Dictionary',
  'KeyValuePair',
]);

/**
 * The error carried by a value, per the error-propagation design
 * (`docs/plans/2026-07-31-error-propagation-design.md` §2 and the
 * implementation refinement in its Status block):
 *
 * - an `Error`-headed value **is** its own error;
 * - an INVALID value — a frozen tree that *embeds* a validation error, e.g.
 *   the canonical form of `"a" + 1` — yields its **first** embedded `Error`
 *   subexpression;
 * - anything else yields `undefined`.
 *
 * **Collections are not descended into.** An error inside a collection
 * literal is an error in one ELEMENT, not a failure of the collection: making
 * `f([1, "a" + 1])` bubble would discard the whole list (and every valid
 * element in it) to report one cell. Such an application freezes as before.
 * An invalid non-collection tree (`Error(…) + 1`) still bubbles its first
 * error. This is why the walk here is a bounded mirror of `.errors`
 * (`getSubexpressions('Error')`, which descends everywhere) rather than a
 * call to it.
 *
 * `isValid` is `false` exactly when a tree contains an `Error` node (only
 * `BoxedFunction` overrides it), so the walk runs only on values already known
 * to carry one, and prunes on it at every level.
 *
 * A leaf module (types + type guards only): `boxed-function.ts`,
 * `function-utils.ts` and `library/core.ts` all need it, and it must sit
 * upstream of `function-utils.ts`.
 */
export function errorValue(
  expr: Expression | undefined | null
): Expression | undefined {
  if (!expr || expr.isValid) return undefined;
  if (isFunction(expr, 'Error')) return expr;
  return firstEmbeddedError(expr);
}

/** The first `Error` node in `expr`, not descending into collection values. */
function firstEmbeddedError(expr: Expression): Expression | undefined {
  if (isFunction(expr, 'Error')) return expr;
  if (!isFunction(expr) || COLLECTION_OPERATORS.has(expr.operator))
    return undefined;
  for (const op of expr.ops) {
    if (op === undefined || op.isValid) continue;
    const err = firstEmbeddedError(op);
    if (err !== undefined) return err;
  }
  return undefined;
}
