/**
 * The scopes that a function call made for its parameters and has not
 * pushed yet.
 *
 * A call of a function literal makes a new scope, declares the parameters
 * in it with the values of the arguments, then pushes the frame of the call
 * on that scope (`function-utils.ts`). Until the push, no frame reads the
 * scope: no node evaluated in a frame that is on the stack can see a binding
 * of it. A declaration into such a scope does not advance the evaluation
 * version (`changesFrameBinding`, `engine-declarations.ts`), so that a call
 * does not make the memo of shared evaluations (`shared-evaluation-memo.ts`)
 * discard the results of its caller's frame: a recursive function whose body
 * shares nodes would take exponential time again.
 *
 * A scope leaves the set when it is pushed (`pushEvalContext`,
 * `engine-scope.ts`): from then on a frame reads it, and a declaration into
 * it is a change that the memo must see.
 *
 * This module imports nothing, so that each module can import it with no
 * dependency cycle.
 */

const pendingCallScopes = new WeakSet<object>();

/** Record `scope` as the new scope of a call, not pushed yet. */
export function notePendingCallScope(scope: object): void {
  pendingCallScopes.add(scope);
}

/** `scope` is now the scope of a frame on the stack. */
export function notePushedScope(scope: object): void {
  pendingCallScopes.delete(scope);
}

/** Is `scope` the new scope of a call that no frame reads yet? */
export function isPendingCallScope(scope: object): boolean {
  return pendingCallScopes.has(scope);
}
