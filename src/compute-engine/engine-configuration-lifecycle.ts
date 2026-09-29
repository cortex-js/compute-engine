import {
  ConfigurationChangeTracker,
  type ConfigurationChangeListener,
} from '../common/configuration-change.js';
import { CACHE_STATS, recordBump } from '../common/cache-stats.js';
import { runWhenIdle } from '../common/computation-depth.js';

type ResetHooks = {
  refreshNumericConstants: () => void;
  resetCommonSymbols: () => void;
  purgeCaches: () => void;
};

/**
 * A semantic state change used to classify cache invalidation. Write sites
 * report what changed; {@link axisMaskOf} selects the affected cache axes.
 */
export type StateEvent =
  | { kind: 'value-write'; ephemeral: boolean; callable: boolean }
  | {
      kind: 'declare';
      callable: boolean;
      shadowsCallable: boolean;
      /** The declaration's target scope is a registered scratch scope, or a
       * scope created under one (`scratch-scopes.ts`), so the binding cannot
       * outlive the computation that registered it. See "Scratch events" in
       * the documentation of {@link axisMaskOf}. */
      scratch?: boolean;
    }
  // variance settle, callable-swap repair, minted-ctor removal
  | {
      kind: 'binding-repair';
      /** The repaired binding lives under a registered scratch scope
       * (`scratch-scopes.ts`). See "Scratch events" in the documentation of
       * {@link axisMaskOf}. */
      scratch?: boolean;
      /** The repair installs the first binding of a name in its scope (a
       * FRESH declaration, `updateDef`). It does not advance the definition
       * version: see `noteStateEvent`. */
      fresh?: boolean;
    }
  | { kind: 'redefine'; callableBefore: boolean; callableAfter: boolean }
  | { kind: 'type-write'; callableBefore: boolean; callableAfter: boolean }
  | {
      kind: 'scope-pop';
      assumptionsDirty: boolean;
      transient?: boolean;
      /** No cache axis advanced while this assumption-free scope was active,
       * so popping it cannot invalidate a version-keyed entry. */
      clean?: boolean;
    }
  | { kind: 'assumption' } // assume / forget
  /** `valueType`: a symbol's value type was written by an inference.
   * `widening`: the new type is not a subtype of the old one — a `widen` or
   * `replace` inference, a narrowing whose result is not below the previous
   * type, or the rollback of a narrowing putting the wider type back. Only an
   * event without it is a true narrowing. */
  | {
      kind: 'inference';
      symbolSignature?: boolean;
      valueType?: boolean;
      widening?: boolean;
      /** The inferred binding lives under a registered scratch scope
       * (`scratch-scopes.ts`). See "Scratch events" in the documentation of
       * {@link axisMaskOf}. */
      scratch?: boolean;
    }
  /** The deferred half of a value-type inference: see `noteStateEvent`. */
  | { kind: 'inference-settled' }
  | { kind: 'config' } // precision, tolerance, angularUnit, jit, reset, type-statement redefinition
  /** A mutable-object field write, invalidated through per-object versions. */
  | { kind: 'object-store' };

/** Which axes an event advances. */
export type AxisMask = {
  any: boolean;
  semantic: boolean;
  world: boolean;
};

/** Whether an event can change the cached effects of a callable expression. */
export function callableAxisSelects(e: StateEvent): boolean {
  switch (e.kind) {
    case 'assumption':
    case 'inference':
    case 'config':
    case 'binding-repair':
      return true;
    case 'redefine':
    case 'type-write':
      return e.callableBefore || e.callableAfter;
    case 'scope-pop':
      return e.assumptionsDirty;
    case 'value-write':
      return e.callable;
    case 'declare':
      // A scratch binding dies with the scope it was declared into (see
      // `axisMaskOf`), so it cannot change any cached callable's effects
      // either.
      return !e.scratch && (e.callable || e.shadowsCallable);
    case 'object-store':
      // A field store changes no declaration, binding, or signature.
      return false;
    case 'inference-settled':
      // The `inference` event it follows already selected this axis.
      return false;
  }
}

/**
 * `CE_OBJECT_STORE_BUMPS_ANY`: the field-store canary.
 *
 * Field stores normally use the per-object version channel in
 * `boxed-expression/object-deps.ts`, not an engine-wide cache axis.
 *
 * Setting this environment variable makes every store additionally advance the
 * engine-wide `any` version. If this removes a stale result, a cache family is
 * missing object-dependency tracking. This is a diagnostic flag, not a
 * semantic mode.
 */
const OBJECT_STORE_BUMPS_ANY: boolean = (() => {
  if (typeof process === 'undefined') return false;
  const flag = process.env?.CE_OBJECT_STORE_BUMPS_ANY;
  return flag !== undefined && flag !== '0';
})();

/**
 * Return the cache axes invalidated by an event. This pure mapping is exported
 * so `state-events.test.ts` can pin every event and payload combination.
 *
 * Scratch events. A `declare`, `binding-repair` or `inference` event can carry
 * `scratch: true`: the binding it writes lives in a scope that a running
 * computation registered as scratch, or in a scope created under one
 * (`scratch-scopes.ts`). Today the only registrar is `withScratchScope`, which
 * `resultUnderDeclaredParameters` calls to box a copy of a function literal
 * under the declared parameter types. The computation discards that scope
 * when it returns, and only the expressions it builds there resolve a name
 * to a binding in it. So no cache that outlives the computation can depend on
 * the binding, and the three scratch events leave the `semantic` and `world`
 * axes and the definition version alone: those are what such caches key on
 * (the memo of a derived signature reads all three, `declaredResultMemoKey`).
 *
 * The three kinds differ only in the axes that the computation's OWN caches
 * key on. A scratch `binding-repair` or `inference` changes a binding that
 * already exists, and expressions the computation built earlier may have
 * cached a type (`any` axis) or an effect set (`callable` axis) from it. So
 * both still advance `any` and `callable`. A value-type inference advances
 * `any` later, through the deferred `inference-settled` event
 * (`noteStateEvent`), as it does for any binding. A scratch `declare` makes a
 * new binding that no expression has resolved to yet (an expression binds its
 * names when it is canonicalized, and a new declaration does not rebind it),
 * so it advances neither `any` nor `callable`.
 */
export function axisMaskOf(e: StateEvent): AxisMask {
  switch (e.kind) {
    case 'value-write':
      return { any: true, semantic: !e.ephemeral, world: false };
    case 'declare':
      // A SCRATCH declaration advances nothing (see "Scratch events" above).
      // It is emitted from INSIDE a computation whose caches key on the `any`
      // axis, and advancing the axis retires the `_type`/`_sgn` cache of every
      // expression in the engine, including the sources the enclosing
      // computation is mid-way through reading. Historical note: the
      // exemption was added when the `Map` type handler derived a bare
      // mapping's element type by declaring stand-ins in a scope it
      // registered around one probe; for a chain of nested lazy `Map` views
      // the advances turned each level into a fresh recursive descent
      // (measured 998K handler invocations and 2.0M axis advances in ONE
      // `PointList` evaluation, about 17 s, against 5 ms before). That
      // handler no longer registers a scope; `withScratchScope`, called from
      // `resultUnderDeclaredParameters`, is now the only registrar. Same
      // remedy as the `clean` scope-pop flag below.
      //
      // The soundness condition is ONE property, and it is established
      // mechanically rather than by a caller's promise: the declaration's
      // resolved target scope is itself a scope some computation on the stack
      // registered as scratch (`_scratchDeclarationScopes`), or a scope
      // created under one (`scratchRootOf`, `scratch-scopes.ts`), so the pop
      // that ends that computation discards the binding. A scope created
      // under a scratch scope is reached only from the expressions the
      // computation builds there: the local scope of the copy of a function
      // literal that a signature derivation boxes and then drops
      // (`resultUnderDeclaredParameters`). `declareSymbolValue` and
      // `declareSymbolOperator` set the flag only on that test, so a
      // declaration aimed anywhere else keeps its axis advance even when made
      // during a scratch extent. That matters: canonicalizing the probe can
      // declare into scopes that OUTLIVE it — a function literal's
      // `block.localScope` (`function-utils.ts`), a protocol member's
      // explicit scope (`engine-protocols.ts`) — and exempting those would
      // leave stale `_type`/`_sgn` answers engine-wide, the exact class of
      // bug this axis exists to prevent. A colliding name is harmless for the
      // same structural reason: it shadows inside a scope that is discarded.
      if (e.scratch) return { any: false, semantic: false, world: false };
      return { any: true, semantic: false, world: false };
    case 'binding-repair':
      // A SCRATCH repair (the auto-declared head `b` of `b(x)` in the scope
      // where a derivation boxes a function body again) advances `any`, as
      // every repair does (see "Scratch events" above).
      return { any: true, semantic: false, world: false };
    case 'redefine':
      // A zero-mask redefinition is valid only when an accompanying value
      // write advances an axis. Otherwise a stale cache could survive a scope
      // that `discardEvalContext` classifies as clean.
      return e.callableAfter
        ? { any: false, semantic: true, world: true }
        : { any: false, semantic: false, world: false };
    case 'type-write':
      // `_sgn` and `_type` use the `any` version in their cache keys.
      return { any: true, semantic: false, world: false };
    case 'scope-pop':
      return {
        // A clean scope changed no cache axis, so its removal invalidates
        // nothing. A transient scope advances `any` only when it reverts an
        // assumption.
        any: (!e.transient && !e.clean) || e.assumptionsDirty,
        semantic: e.assumptionsDirty,
        world: e.assumptionsDirty,
      };
    case 'assumption':
      return { any: true, semantic: true, world: true };
    case 'inference':
      // Value-type inference can run while `_type` and `_sgn` are being
      // computed. Advancing their cache axis here would invalidate that
      // computation recursively. Signature inference is not self-triggered and
      // can safely advance all axes.
      if (e.valueType) return { any: false, semantic: false, world: false };
      // A value-type inference on a SCRATCH binding takes the branch above:
      // its `any` advance is the deferred `inference-settled` event. Any
      // other SCRATCH inference advances `any` at once, and not `semantic` or
      // `world` (see "Scratch events" above).
      if (e.scratch) return { any: true, semantic: false, world: false };
      if (e.symbolSignature) return { any: true, semantic: true, world: true };
      return { any: true, semantic: true, world: true };
    case 'config':
      return { any: true, semantic: true, world: true };
    case 'inference-settled':
      // Types and signs cached before a value-type inference narrowed a
      // symbol are outdated; see `noteStateEvent`. Only the axis that the
      // `_type` and `_sgn` caches key on advances, as for a `type-write`.
      return { any: true, semantic: false, world: false };
    case 'object-store':
      // Field-derived cache entries carry `(object, version)` dependencies and
      // revalidate independently of engine-wide versions. The diagnostic flag
      // below can additionally cold generation-keyed caches when investigating
      // a missing dependency.
      return OBJECT_STORE_BUMPS_ANY
        ? { any: true, semantic: false, world: false }
        : { any: false, semantic: false, world: false };
  }
}

export class EngineConfigurationLifecycle {
  private _anyVersion = 0;
  private _semanticVersion = 0;
  private _worldVersion = 0;
  private _callableVersion = 0;
  private _definitionVersion = 0;
  private _ephemeralWriteDepth = 0;
  private _factSuppressionDepth = 0;
  private _scratchDeclarationScopes: object[] = [];
  /** A deferred `inference-settled` advance is waiting (`noteStateEvent`). */
  private _inferencePending = false;
  private _tracker = new ConfigurationChangeTracker();

  get anyVersion(): number {
    return this._anyVersion;
  }

  get semanticVersion(): number {
    return this._semanticVersion;
  }

  get worldVersion(): number {
    return this._worldVersion;
  }

  get callableVersion(): number {
    return this._callableVersion;
  }

  /** Advanced when an existing definition changes: a symbol retyped (a
   * `type-write`), a declaration that SHADOWS a callable (a name that held a
   * function now resolves to the new binding, in whatever scope), or any
   * other event that can change a callable (`callableAxisSelects`). A retype
   * of a scalar advances only the `any` axis, which every declaration also
   * advances; and a declaration of a parameter that may hold a function (an
   * `unknown` parameter) selects the `callable` axis without shadowing
   * anything. A cache that must follow those changes but must not be
   * invalidated by the declarations every function literal makes for its
   * parameters keys on this counter, and tracks the other declarations it
   * depends on per scope (`scopeChainDeclarationCount`). See
   * `declaredResultMemoKey`.
   *
   * A symbol narrowed by a use (an `inference` event with `valueType`, and
   * the `inference-settled` event that follows it) does not advance it:
   * those are frequent during type derivation, and counting them made a
   * Tycho document three times slower to register. A narrowing
   * can only make a cached result wider than it could be, never wrong. */
  get definitionVersion(): number {
    return this._definitionVersion;
  }

  get ephemeralWriteDepth(): number {
    return this._ephemeralWriteDepth;
  }

  set ephemeralWriteDepth(value: number) {
    this._ephemeralWriteDepth = value;
  }

  /** See `IComputeEngine._factSuppressionDepth`: while this is above zero the
   * assumptions store answers every QUERY as if it were empty. */
  get factSuppressionDepth(): number {
    return this._factSuppressionDepth;
  }

  set factSuppressionDepth(value: number) {
    this._factSuppressionDepth = value;
  }

  get scratchDeclarationScopes(): object[] {
    return this._scratchDeclarationScopes;
  }

  /**
   * The only writer of the invalidation versions. Callers report a semantic
   * event, and the dispatch functions decide which versions advance.
   */
  noteStateEvent(e: StateEvent): void {
    // A value-type inference changes the type of a symbol that expressions
    // built earlier have cached types from (`l = List(x)` keeps `vector<1>`
    // after a use narrows `x` to `real`). It cannot advance the `any` axis
    // where it happens: it happens while a `_type` or `_sgn` is computed, and
    // the advance would make that computation stale at once. So the advance
    // runs when no cached computation is running (`runWhenIdle`).
    //
    // This holds for a SCRATCH binding too (`scratch-scopes.ts`): the
    // computation that owns the scratch scope may have cached a type while
    // the binding had the previous type, and `inference-settled` advances
    // only `any`, which no cache that outlives the computation keys on.
    if (e.kind === 'inference' && e.valueType && !this._inferencePending) {
      // One advance covers every inference made before it runs.
      this._inferencePending = true;
      runWhenIdle(() => {
        this._inferencePending = false;
        this.noteStateEvent({ kind: 'inference-settled' });
      });
    }
    const m = axisMaskOf(e);
    if (m.any) this._anyVersion += 1;
    if (m.semantic) this._semanticVersion += 1;
    if (m.world) this._worldVersion += 1;
    if (callableAxisSelects(e)) this._callableVersion += 1;
    // A value-type inference (a symbol narrowed by a use, such as `unknown`
    // to `number` for a free `T` read by `sin(4x - T)`) does not advance the
    // definition version, for the same reason its deferred
    // `inference-settled` event does not: a narrowing can only leave a
    // memoized result wider than it could be, never wrong. Counting it made
    // the cost of a type read exponential. The memo of a declared function's
    // derived signature keys on this version, and deriving that signature
    // boxes the function's body again, in a fresh local scope. A free name
    // of the body that no enclosing scope declares is then declared again in
    // that fresh scope and narrowed by its use, so each derivation advanced
    // the version and invalidated the memo of every other declared function.
    // Typing a product of calls re-derived the callees of each factor
    // recursively: 1.87 million derivations for one sum over 400 terms,
    // which did not finish in 60 s (Tycho item 329, reproduced in
    // `test/compute-engine/tycho-item-329-signature-memo.test.ts`). An
    // inference that is not a true narrowing (`widening`: a `widen` or
    // `replace` write, or the rollback of a narrowing) still advances the
    // version: it can put a WIDER or a different type in place, so a result
    // memoized under the old type could be wrong, not only loose.
    //
    // A write to a SCRATCH binding (`scratch-scopes.ts`: a `declare`, a
    // `binding-repair` or an `inference` whose binding lives under a scope
    // that a running computation registered as scratch) does not advance the
    // definition version either (see "Scratch events" in the documentation
    // of `axisMaskOf`). Deriving the signature of a function
    // declared `-> unknown` boxes its body again in such a scope, and every
    // undeclared name the body APPLIES (`b` in `b(x, y)`) is declared there
    // as a function, which repairs its binding. When that advanced the
    // version, each derivation invalidated the memoized signature of every
    // other declared function, and typing nested calls of such functions
    // derived their signatures again at each level (Tycho item 336,
    // `test/compute-engine/tycho-item-336-nested-signature-derivation.test.ts`).
    // This is sound because a memoized signature is computed from bindings
    // that the scratch scope cannot hold: the memo is stored after the
    // derivation returns, the scratch scope is then discarded, and no later
    // read of any function resolves a name to a binding in it. A write to a
    // binding OUTSIDE a scratch scope keeps its advance, even when made
    // during a derivation: a declaration in the scope a function was defined
    // in, an assignment, or a repair of a binding that later reads see.
    //
    // The `binding-repair` of a FRESH declaration (`fresh`: the target scope
    // held no binding of the name) does not advance it either. The reasons
    // are in `updateDef`, which emits it.
    const scratch =
      (e.kind === 'declare' ||
        e.kind === 'inference' ||
        e.kind === 'binding-repair') &&
      e.scratch === true;
    if (
      !scratch &&
      (e.kind === 'type-write' ||
        (e.kind === 'declare'
          ? e.shadowsCallable
          : e.kind === 'binding-repair' && e.fresh === true
            ? false
            : e.kind === 'inference' && e.valueType === true && !e.widening
              ? false
              : callableAxisSelects(e)))
    )
      this._definitionVersion += 1;
    if (CACHE_STATS) {
      if (m.any) recordBump('generation');
      if (m.semantic) recordBump('mutationGeneration');
      if (m.world) recordBump('semanticEpoch');
    }
  }

  reset(hooks: ResetHooks): void {
    // A scratch extent brackets its own registration in a `finally`, so a
    // non-empty list here means a computation was abandoned mid-flight (a
    // host `throw` past the bracket). Clearing it keeps a leaked entry from
    // exempting declarations for the rest of the engine's life.
    this._scratchDeclarationScopes.length = 0;
    this.noteStateEvent({ kind: 'config' });
    hooks.refreshNumericConstants();
    hooks.resetCommonSymbols();
    hooks.purgeCaches();
    this._tracker.notifyNow();
  }

  listen(listener: ConfigurationChangeListener): () => void {
    return this._tracker.listen(listener);
  }
}
