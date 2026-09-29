/**
 * Scratch scopes: scopes that a computation creates, registers in
 * `IComputeEngine._scratchDeclarationScopes`, and discards when it returns.
 *
 * A binding declared in a scratch scope, or in a scope created under one,
 * can be reached only by resolving a name from inside that scope. Only the
 * expressions the computation builds there do so, and the computation drops
 * them when it returns. So a write to such a binding (its declaration, the
 * repair of its definition, an inference that narrows its type or its
 * signature) cannot change the answer of a cache that outlives the
 * computation, and it does not need to advance the engine-wide versions that
 * such caches key on. See `axisMaskOf` in `engine-configuration-lifecycle.ts`
 * for which versions still advance.
 *
 * This module imports nothing, so every module that declares or infers can
 * import it without creating a dependency cycle.
 */

/** The part of the engine this module reads. */
type ScratchEngine = { readonly _scratchDeclarationScopes: object[] };

/** A scope, as far as this module needs it. */
type ScopeLike = { parent: unknown };

/** The registered scratch scope that `scope` is, or that `scope` was created
 * under, or `undefined`. */
export function scratchRootOf(
  ce: ScratchEngine,
  scope: ScopeLike | null | undefined
): object | undefined {
  const roots = ce._scratchDeclarationScopes;
  if (roots.length === 0) return undefined;
  for (let s = scope; s; s = s.parent as ScopeLike | null | undefined)
    if (roots.includes(s)) return s;
  return undefined;
}

/** The scratch scope each definition declared under one was declared under.
 * A `WeakMap`, so a discarded definition takes its entry with it. */
const SCRATCH_BINDINGS = new WeakMap<object, object>();

/** Record that `definitions` live under the registered scratch scope
 * `root`. Pass only objects that belong to the binding alone: the binding
 * record, and the halves that the declaration or the update constructed. A
 * half supplied by a caller is installed by identity and can be shared with
 * a binding outside the scratch scope, which must not be treated as
 * scratch. */
export function noteScratchBinding(
  root: object,
  definitions: ReadonlyArray<object | undefined>
): void {
  for (const d of definitions)
    if (d !== undefined) SCRATCH_BINDINGS.set(d, root);
}

/** The registered scratch scope that `definition` was declared under, while
 * the computation that owns that scope runs, or `undefined`. After that
 * computation returns, the scope is no longer registered and a write to the
 * definition advances the versions as any other write does. */
export function scratchRootOfBinding(
  ce: ScratchEngine,
  definition: object | undefined
): object | undefined {
  if (definition === undefined) return undefined;
  const root = SCRATCH_BINDINGS.get(definition);
  return root !== undefined && ce._scratchDeclarationScopes.includes(root)
    ? root
    : undefined;
}

/** True when `definition` was declared under a scratch scope that is still
 * registered. See `scratchRootOfBinding`. */
export function isScratchBinding(
  ce: ScratchEngine,
  definition: object | undefined
): boolean {
  return scratchRootOfBinding(ce, definition) !== undefined;
}

/** Run `f` with `scope` registered as a scratch scope, and remove the
 * registration when `f` returns or throws. */
export function withScratchScope<T>(
  ce: ScratchEngine,
  scope: object,
  f: () => T
): T {
  const roots = ce._scratchDeclarationScopes;
  roots.push(scope);
  try {
    return f();
  } finally {
    const i = roots.lastIndexOf(scope);
    if (i >= 0) roots.splice(i, 1);
  }
}
