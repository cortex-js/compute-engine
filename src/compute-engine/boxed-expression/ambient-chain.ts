import type { Scope } from '../global-types.js';

/**
 * Whether `scope` is reached by walking the parent links up from `from`
 * (`from` itself included). A root scope's parent link may be `undefined`
 * rather than `null` (the first frame is pushed with no context to read a
 * parent from).
 */
export function chainContains(
  from: Scope | null | undefined,
  scope: Scope
): boolean {
  for (let s = from; s != null; s = s.parent) if (s === scope) return true;
  return false;
}

/**
 * The scope a node's local scope is chained onto while the node evaluates
 * in the ambient scope `ambient`, or `undefined` when the local scope keeps
 * its own parent link.
 *
 * A node that owns a local scope — a comprehension, a sum, a block — pushes
 * that scope again on every evaluation. Its parent link is the scope it was
 * canonicalized in, so a declaration made later in a scope pushed on top of
 * that one (a child scope that shadows `n` with a value) is not on the
 * chain, and the node's free symbols never see it, while a plain symbol
 * evaluated beside it does (`bindingInContext` walks the ambient chain).
 * Ruled 2026-09-15: a directly evaluated expression reads the environment it
 * is evaluated in, so the local scope is chained onto the ambient scope —
 * only when the ambient chain descends from the scope's own parent, so an
 * unrelated chain captures nothing, and never onto the scope itself (a
 * re-entrant evaluation). A call frame is NOT chained: a stored function
 * value is a closure and evaluates in its own environment
 * (`docs/SCOPING-MODEL.md`).
 */
export function ambientChainParent(
  ambient: Scope | null | undefined,
  scope: Scope
): Scope | undefined {
  if (
    ambient != null &&
    ambient !== scope &&
    scope.parent != null &&
    scope.parent !== ambient &&
    !chainContains(ambient, scope) &&
    chainContains(ambient, scope.parent)
  )
    return ambient;
  return undefined;
}

/**
 * Run `fn` with `scope` chained onto `ambient` exactly as an evaluation of
 * the node that owns `scope` would chain it (`ambientChainParent`), and the
 * parent link restored afterwards. A memo that resolves the node's free
 * names must resolve them through this chain — the one the node's walk
 * reads — or a value computed under one ambient scope is served under
 * another.
 */
export function withAmbientChain<T>(
  ambient: Scope | null | undefined,
  scope: Scope | undefined,
  fn: () => T
): T {
  const parent =
    scope === undefined ? undefined : ambientChainParent(ambient, scope);
  if (scope === undefined || parent === undefined) return fn();
  const saved = scope.parent;
  scope.parent = parent;
  try {
    return fn();
  } finally {
    scope.parent = saved;
  }
}
