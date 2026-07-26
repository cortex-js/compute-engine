/**
 * The `popScope` debug invariant, Tier 1
 * (`docs/plans/2026-07-26-binder-mechanism-design.md` §3).
 *
 * The operational half of "the binder constructor is the single authority for
 * its variable" is *no live result references a binding of the dying scope*.
 * `popScope` cannot see live results — the engine holds no registry of boxed
 * expressions — so the invariant is checked from the other end: a scope being
 * discarded **tombstones** its value definitions, and the symbol RESOLUTION
 * sites report a tombstoned binding with both stacks (where the scope died,
 * where the dead binding was used) instead of the mystery test failure a
 * missing `rebindEscaping` produces today.
 *
 * Debug-only, gated on `ce._debugBindings` (default: the `CE_DEBUG_BINDINGS`
 * environment variable). When off, the cost is one boolean test per scope pop
 * and nothing at all on the resolution path. The tombstone fields are declared
 * `undefined` on the definition class so the flag does not change its V8 shape.
 *
 * A leaf module: it must stay importable from `engine-scope.ts`, `binders.ts`
 * and `boxed-symbol.ts` alike, so it imports nothing.
 */

/** The tombstone fields, as carried by `_BoxedValueDefinition`. */
type Tombstoned = {
  _deadStack?: string;
  _deadScope?: string;
};

/** The default for `ce._debugBindings`. Guarded for non-Node hosts, where
 * `process` is not defined. */
export function debugBindingsDefault(): boolean {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string> } })
      .process?.env;
    const flag = env?.CE_DEBUG_BINDINGS;
    return flag !== undefined && flag !== '' && flag !== '0';
  } catch {
    return false;
  }
}

/**
 * The depth of nested **dormant** pops — a pop that is not the end of the
 * scope's life.
 *
 * `canonicalizeBinder` pops the binder's scope when canonicalization is done,
 * but the canonical expression KEEPS it (as its `localScope`) and pushes it
 * again on every evaluation. Tombstoning it there makes the whole
 * canonicalize-to-first-evaluate window report each bound variable as
 * belonging to a "discarded scope" — a diagnostic that is not merely noisy but
 * wrong. A dormant pop leaves no tombstone; the pop that ends an *evaluation*
 * frame still does.
 *
 * Module-level rather than per-engine: the state is debug-only, and the pop it
 * brackets is a synchronous leaf operation that cannot nest an evaluation.
 */
let dormantPopDepth = 0;

/** Begin a pop that does not end its scope's life. Pair with
 * {@link endDormantPop} in a `finally`. */
export function beginDormantPop(): void {
  dormantPopDepth += 1;
}

/** End a {@link beginDormantPop} bracket. */
export function endDormantPop(): void {
  dormantPopDepth -= 1;
}

/** Is the pop currently unwinding a dormant one? */
export function isDormantPop(): boolean {
  return dormantPopDepth > 0;
}

/**
 * Record that this binding's scope is being discarded. Called from
 * `discardEvalContext`, which already walks exactly the right set (the value
 * definitions it disposes), so there is no second traversal.
 *
 * NOT called from `inScope`, which pops WITHOUT `discardEvalContext`: that is a
 * temporary context switch, not a scope lifetime. The asymmetry is deliberate.
 */
export function tombstoneBinding(def: object, scopeName: string): void {
  const t = def as Tombstoned;
  t._deadStack = new Error().stack ?? '<no stack>';
  t._deadScope = scopeName;
}

/**
 * Clear the tombstones of a scope that is being pushed again.
 *
 * A scope object outlives its frame by design: a canonicalized `Sum` keeps its
 * `localScope` and pushes it again on every evaluation, and `canonicalBigop`
 * pops that scope at the end of canonicalization. Such a scope is not dead, so
 * a push revokes the tombstone rather than reporting every big-op index.
 */
export function reviveBindings(bindings: Iterable<unknown>): void {
  for (const binding of bindings) {
    const value = (binding as { value?: object } | undefined)?.value;
    if (value === undefined) continue;
    const t = value as Tombstoned;
    if (t._deadStack === undefined) continue;
    t._deadStack = undefined;
    t._deadScope = undefined;
  }
}

/**
 * Throw if `def` is a binding of a scope that has been discarded — the
 * "assertion with a stack" that replaces a silent stale read.
 *
 * Called only at RESOLUTION sites (`BoxedSymbol.evaluate`, `BoxedSymbol._N`,
 * `evaluateInOwnBindings`), never from the `valueDefinition` getter: that is a
 * hot path and must stay a plain field read.
 */
export function assertLiveBinding(def: object, name: string): void {
  const t = def as Tombstoned;
  if (t._deadStack === undefined) return;
  throw new Error(
    `The binding of "${name}" belongs to the discarded scope "${t._deadScope}".\n` +
      `A result that leaves a scope must be re-bound to the enclosing scope ` +
      `(\`rebindEscaping\`), or it references a dead binding.\n` +
      `Note: a scope object can outlive its frame — pushing it again revokes ` +
      `its tombstone — so this reports a use between two frames of that scope, ` +
      `which is not necessarily after its last one.\n` +
      `--- the scope was discarded at ---\n${t._deadStack}\n` +
      `--- the dead binding was used at ---\n${new Error().stack ?? '<no stack>'}`
  );
}
