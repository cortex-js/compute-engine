/**
 * The scopes whose parent link a live evaluation frame has re-pointed.
 *
 * A node that owns a local scope (a block, a sum, a comprehension) pushes
 * that scope again on every evaluation, and the push chains the scope onto
 * the ambient scope: `pushEvalContext` (`engine-scope.ts`) replaces the
 * scope's parent link with the ambient scope for the life of the frame
 * (`ambientChainParent`, `boxed-expression/ambient-chain.ts`), and the link
 * is restored when the last frame that chains the scope is discarded.
 *
 * The same scope object can be live in more than one frame at once: two
 * evaluations of one node interleaved on the asynchronous path. Each
 * asynchronous evaluation keeps its frames on its own copy of the
 * evaluation-context stack (`EvaluateOptions._contextStack`), so the frames
 * of two interleaved evaluations are not on one array, and a search of the
 * current stack does not find all of them. This registry finds them, and it
 * keeps the link the scope had before the first of them re-pointed it: that
 * is the link every later frame restores, and the link a walk that must
 * follow the CREATION links of the scopes takes instead of the re-pointed
 * one (`scratchRootOf`, `scratch-scopes.ts`, which decides whether a
 * declaration's target scope was created under a scratch scope; a chained
 * scope was not created under the ambient scope it is chained onto, and a
 * binding declared in it outlives the frame).
 *
 * A frame leaves the registry when it is dropped from its stack:
 * `popEvalContext` and `removeEvalContext` (through `discardEvalContext`),
 * and the public `ce.contextStack` setter for each frame that the new stack
 * does not keep (`releaseChainingFrame`, `engine-scope.ts`). A frame of an
 * asynchronous evaluation that never settles stays in the registry, and its
 * scope stays chained onto the ambient scope, until that evaluation settles:
 * the evaluation can still resume and use the frame.
 *
 * This module imports nothing, so every module that walks scope links can
 * import it without creating a dependency cycle.
 */

/** A chained scope: the live frames that chain it, and the parent link it
 * had before the first of them re-pointed it. */
type ChainedScope = { readonly frames: Set<object>; readonly parent: unknown };

const CHAINED_SCOPES = new WeakMap<object, ChainedScope>();

/** The record of `scope` while at least one live frame chains it, or
 * `undefined`. */
export function chainedScopeOf(
  scope: object
): Readonly<ChainedScope> | undefined {
  return CHAINED_SCOPES.get(scope);
}

/** Record that `frame` chains `scope`. `parent` is the link the scope had
 * before any live frame re-pointed it; a second frame of the same scope
 * passes the link the registry already holds. */
export function addChainingFrame(
  scope: object,
  frame: object,
  parent: unknown
): void {
  const chained = CHAINED_SCOPES.get(scope);
  if (chained !== undefined) chained.frames.add(frame);
  else CHAINED_SCOPES.set(scope, { frames: new Set([frame]), parent });
}

/** Forget that `frame` chains `scope`. Returns `true` when no live frame
 * chains `scope` any more (the scope was not registered, or `frame` was the
 * last one), so the caller gives the scope its original parent link back. */
export function removeChainingFrame(scope: object, frame: object): boolean {
  const chained = CHAINED_SCOPES.get(scope);
  if (chained === undefined) return true;
  chained.frames.delete(frame);
  if (chained.frames.size > 0) return false;
  CHAINED_SCOPES.delete(scope);
  return true;
}
