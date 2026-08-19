import {
  ConfigurationChangeTracker,
  type ConfigurationChangeListener,
} from '../common/configuration-change.js';
import { CACHE_STATS, recordBump } from '../common/cache-stats.js';

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
  | { kind: 'declare'; callable: boolean; shadowsCallable: boolean }
  | { kind: 'binding-repair' } // variance settle, callable-swap repair, minted-ctor removal
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
  | { kind: 'inference'; symbolSignature?: boolean; valueType?: boolean }
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
      return e.callable || e.shadowsCallable;
    case 'object-store':
      // A field store changes no declaration, binding, or signature.
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
 */
export function axisMaskOf(e: StateEvent): AxisMask {
  switch (e.kind) {
    case 'value-write':
      return { any: true, semantic: !e.ephemeral, world: false };
    case 'declare':
      return { any: true, semantic: false, world: false };
    case 'binding-repair':
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
      if (e.symbolSignature) return { any: true, semantic: true, world: true };
      return { any: true, semantic: true, world: true };
    case 'config':
      return { any: true, semantic: true, world: true };
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
  private _ephemeralWriteDepth = 0;
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

  get ephemeralWriteDepth(): number {
    return this._ephemeralWriteDepth;
  }

  set ephemeralWriteDepth(value: number) {
    this._ephemeralWriteDepth = value;
  }

  /**
   * The only writer of the invalidation versions. Callers report a semantic
   * event, and the dispatch functions decide which versions advance.
   */
  noteStateEvent(e: StateEvent): void {
    const m = axisMaskOf(e);
    if (m.any) this._anyVersion += 1;
    if (m.semantic) this._semanticVersion += 1;
    if (m.world) this._worldVersion += 1;
    if (callableAxisSelects(e)) this._callableVersion += 1;
    if (CACHE_STATS) {
      if (m.any) recordBump('generation');
      if (m.semantic) recordBump('mutationGeneration');
      if (m.world) recordBump('semanticEpoch');
    }
  }

  reset(hooks: ResetHooks): void {
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
