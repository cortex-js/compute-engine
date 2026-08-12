import {
  ConfigurationChangeTracker,
  type ConfigurationChangeListener,
} from '../common/configuration-change.js';
import {
  CACHE_STATS,
  recordBump,
  bumpShadowCallable,
} from '../common/cache-stats.js';

type ResetHooks = {
  refreshNumericConstants: () => void;
  resetCommonSymbols: () => void;
  purgeCaches: () => void;
};

/**
 * A **state event**: what a write site reports happened, in place of
 * hand-picking invalidation counters
 * (`docs/plans/2026-08-09-state-event-invalidation-axes.md` §4).
 *
 * Kinds are semantic; payload flags exist for axis classification
 * (`ephemeral`, `callable`, `shadowsCallable`, `assumptionsDirty`,
 * `callableBefore`/`callableAfter`) and for legacy-mask transcription
 * (`transient`, `symbolSignature`, `valueType` — the flags that distinguish
 * same-kind sites with different masks in the design's §2/§2b tables).
 */
export type StateEvent =
  | { kind: 'value-write'; ephemeral: boolean; callable: boolean }
  | { kind: 'declare'; callable: boolean; shadowsCallable: boolean }
  | { kind: 'binding-repair' } // variance settle, callable-swap repair, minted-ctor removal
  | { kind: 'redefine'; callableBefore: boolean; callableAfter: boolean }
  | { kind: 'type-write'; callableBefore: boolean; callableAfter: boolean }
  | { kind: 'scope-pop'; assumptionsDirty: boolean; transient?: boolean }
  | { kind: 'assumption' } // assume / forget
  | { kind: 'inference'; symbolSignature?: boolean; valueType?: boolean }
  | { kind: 'config' }; // precision, tolerance, angularUnit, jit, reset

/** Which legacy axes an event advances. */
export type AxisMask = {
  any: boolean;
  semantic: boolean;
  world: boolean;
};

/**
 * The dispatch table of the PARITY regime (design §3/§5): a row-by-row
 * TRANSCRIPTION of the legacy counter masks in the design's §2/§2b tables —
 * no semantic choice is exercised here. Pure and exported so the per-row
 * unit tests can pin every (kind, payload) combination directly.
 *
 * Transcription notes, per kind:
 * - `value-write`: the definition value setter — G always, M unless the
 *   write is an ephemeral loop-index assign.
 * - `declare`: fresh declaration — G only (the callable-shaped double-bump
 *   at those sites comes from `updateDef`'s separate `binding-repair`
 *   emission; advancement-equivalence absorbs the magnitude).
 * - `binding-repair`: `updateDef`'s internal conditional bump, variance
 *   settle, minted-constructor removal — G only.
 * - `redefine`: the in-place `updateDef` redefinition callers — M+E, **no
 *   G** (§2's measured masks; the callable-swap G arrives via
 *   `binding-repair`). The operator→scalar swap (`callableAfter: false`)
 *   has a ZERO mask: its legacy G+M arrives via the accompanying
 *   `value-write`.
 * - `type-write`: direct def retype (§2c) — zero mask today.
 * - `scope-pop`: `popEvalContext` — G always, +M+E when assumptions dirty;
 *   the `transient` (`inScope`) variant has no G and M+E only when dirty.
 * - `inference`: `BoxedFunction.infer` and the matrix freeze/restore —
 *   G+M+E; the `symbolSignature` variant (`BoxedSymbol.infer`, operator
 *   branch) — M+E only; the `valueType` variant (value branch) — zero mask.
 * - `assumption`, `config`: G+M+E.
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
      return e.callableAfter
        ? { any: false, semantic: true, world: true }
        : { any: false, semantic: false, world: false };
    case 'type-write':
      return { any: false, semantic: false, world: false };
    case 'scope-pop':
      return {
        any: !e.transient,
        semantic: e.assumptionsDirty,
        world: e.assumptionsDirty,
      };
    case 'assumption':
      return { any: true, semantic: true, world: true };
    case 'inference':
      if (e.valueType) return { any: false, semantic: false, world: false };
      if (e.symbolSignature)
        return { any: false, semantic: true, world: true };
      return { any: true, semantic: true, world: true };
    case 'config':
      return { any: true, semantic: true, world: true };
  }
}

/** `CE_PARITY_CHECK`: enables the dual-track parity gate of migration step
 * 2b (design §8) — shadow-counter accounting, the event trace, and the
 * checkpoint comparison. A verification aid for the migration, not a
 * semantic mode; env-gated like `CE_CACHE_STATS`. */
export const PARITY_CHECK: boolean = (() => {
  if (typeof process === 'undefined') return false;
  const flag = process.env?.CE_PARITY_CHECK;
  return flag !== undefined && flag !== '0';
})();

const TRACE_CAPACITY = 200;

export class EngineConfigurationLifecycle {
  private _anyVersion = 0;
  private _semanticVersion = 0;
  private _worldVersion = 0;
  private _ephemeralWriteDepth = 0;
  private _tracker = new ConfigurationChangeTracker();

  // ── Dual-track parity state (step 2b; deleted at cutover) ──────────────
  // During the parity regime the legacy `+= 1` writes at the sites remain
  // AUTHORITATIVE (they alone advance the live axes above); every
  // `noteStateEvent()` dispatch advances only these shadow counters, so the
  // two tracks never share state and advancement can be compared at each
  // public-API checkpoint.
  private _shadowAny = 0;
  private _shadowSemantic = 0;
  private _shadowWorld = 0;
  // Checkpoint baselines (live and shadow), sampled at the last checkpoint.
  private _cpAny = 0;
  private _cpSemantic = 0;
  private _cpWorld = 0;
  private _cpShadowAny = 0;
  private _cpShadowSemantic = 0;
  private _cpShadowWorld = 0;
  /** Ring buffer of the last events (parity mode only), for mismatch
   * attribution. */
  private _trace: string[] = [];

  get anyVersion(): number {
    return this._anyVersion;
  }

  set anyVersion(value: number) {
    if (CACHE_STATS && value > this._anyVersion) recordBump('generation');
    this._anyVersion = value;
  }

  get semanticVersion(): number {
    return this._semanticVersion;
  }

  set semanticVersion(value: number) {
    if (CACHE_STATS && value > this._semanticVersion)
      recordBump('mutationGeneration');
    this._semanticVersion = value;
  }

  get worldVersion(): number {
    return this._worldVersion;
  }

  set worldVersion(value: number) {
    if (CACHE_STATS && value > this._worldVersion) {
      recordBump('semanticEpoch');
      // Shadow 'callable' axis: every epoch event (assumption, inference,
      // redefine, config, dirty pop) is in its predicate.
      bumpShadowCallable();
    }
    this._worldVersion = value;
  }

  get ephemeralWriteDepth(): number {
    return this._ephemeralWriteDepth;
  }

  set ephemeralWriteDepth(value: number) {
    this._ephemeralWriteDepth = value;
  }

  /**
   * The state-event choke point (design §3). In the parity regime this
   * advances only the SHADOW counters — the sites' legacy writes stay
   * authoritative — and records the event for checkpoint attribution. At
   * cutover it becomes the sole writer of the live axes.
   */
  noteStateEvent(e: StateEvent): void {
    const m = axisMaskOf(e);
    if (m.any) this._shadowAny += 1;
    if (m.semantic) this._shadowSemantic += 1;
    if (m.world) this._shadowWorld += 1;
    if (PARITY_CHECK) {
      if (this._trace.length >= TRACE_CAPACITY) this._trace.shift();
      this._trace.push(
        `${JSON.stringify(e)} -> ${m.any ? 'A' : ''}${m.semantic ? 'S' : ''}${
          m.world ? 'W' : ''
        }`
      );
    }
  }

  /**
   * Parity-gate checkpoint (design §8, step 2b): called at the END of each
   * public engine entry point when `CE_PARITY_CHECK` is set. Compares
   * ADVANCEMENT (not magnitude — the enumerated double-bump collapse is
   * invisible to advancement) of each live axis against its shadow since
   * the previous checkpoint, throws with the recent event trace on
   * mismatch, and re-baselines.
   */
  parityCheckpoint(label: string): void {
    const mism: string[] = [];
    const cmp = (
      name: string,
      live: number,
      cpLive: number,
      shadow: number,
      cpShadow: number
    ): void => {
      if (live > cpLive !== shadow > cpShadow)
        mism.push(
          `${name}: live ${cpLive}->${live}, shadow ${cpShadow}->${shadow}`
        );
    };
    cmp('any', this._anyVersion, this._cpAny, this._shadowAny, this._cpShadowAny);
    cmp(
      'semantic',
      this._semanticVersion,
      this._cpSemantic,
      this._shadowSemantic,
      this._cpShadowSemantic
    );
    cmp(
      'world',
      this._worldVersion,
      this._cpWorld,
      this._shadowWorld,
      this._cpShadowWorld
    );
    this._cpAny = this._anyVersion;
    this._cpSemantic = this._semanticVersion;
    this._cpWorld = this._worldVersion;
    this._cpShadowAny = this._shadowAny;
    this._cpShadowSemantic = this._shadowSemantic;
    this._cpShadowWorld = this._shadowWorld;
    if (mism.length > 0) {
      const trace = this._trace.slice(-40).join('\n  ');
      this._trace.length = 0;
      throw new Error(
        `Parity mismatch at "${label}": ${mism.join('; ')}\nRecent events:\n  ${trace}`
      );
    }
    this._trace.length = 0;
  }

  reset(hooks: ResetHooks): void {
    if (CACHE_STATS) {
      recordBump('generation');
      recordBump('mutationGeneration');
      recordBump('semanticEpoch');
      bumpShadowCallable();
    }
    this.noteStateEvent({ kind: 'config' });
    this._anyVersion += 1;
    this._semanticVersion += 1;
    this._worldVersion += 1;
    hooks.refreshNumericConstants();
    hooks.resetCommonSymbols();
    hooks.purgeCaches();
    this._tracker.notifyNow();
  }

  listen(listener: ConfigurationChangeListener): () => void {
    return this._tracker.listen(listener);
  }
}
