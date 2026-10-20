/**
 * The assignment locals of each block scope: the names of the `Assign`
 * statements of a `Block` that no enclosing scope declared when the block
 * was canonicalized (`canonicalBlock()`, `library/control-structures.ts`).
 *
 * Whether such a name is a local of the block is decided at
 * canonicalization and never changes after. Each run of the block gives the
 * name a new binding (`declareAssignmentLocals()`, `function-utils.ts`), and
 * the effect inference counts a write to it as confined (`withBlockLocals()`,
 * `boxed-expression/effects-inference.ts`).
 *
 * The record is kept here, apart from the scope bindings, because a run of
 * the block removes the bindings that the canonicalization made
 * (`sweepCanonicalizationBindings()` in `library/control-structures.ts`,
 * `hideBodyScopeParams()` in `function-utils.ts`). This module imports
 * nothing, so that both the evaluation and the inference can read it.
 */

const ASSIGNMENT_LOCALS = new WeakMap<object, readonly string[]>();

/**
 * Record the assignment locals of the block scope `scope`, when the block is
 * canonicalized for the first time.
 *
 * A block that is built again with the same scope (`subs()`,
 * `rewriteWithBinders()` in `boxed-expression/binders.ts`, the simplifier)
 * is canonicalized again, and `canonicalBlock()` then finds the names that
 * the scope already binds, and does not count them. A second record for the
 * same scope is ignored, so that such a name stays a local, and the block
 * does not write a binding of the same name outside it. The record is kept
 * also when it has no name, so that a name that a later canonicalization
 * finds is not made a local either.
 *
 * The map holds its keys weakly: a record goes away with its scope, and the
 * record of a scope of one engine is never read for another engine.
 */
export function recordAssignmentLocals(
  scope: object,
  names: readonly string[]
): void {
  if (!ASSIGNMENT_LOCALS.has(scope)) ASSIGNMENT_LOCALS.set(scope, names);
}

/** The assignment locals of the block scope `scope`, or `undefined` when
 * no block with this scope was canonicalized. */
export function assignmentLocalsOf(
  scope: object
): readonly string[] | undefined {
  return ASSIGNMENT_LOCALS.get(scope);
}
