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
  | { kind: 'config' }; // precision, tolerance, angularUnit, jit, reset, type-statement redefinition

/** Which axes an event advances. */
export type AxisMask = {
  any: boolean;
  semantic: boolean;
  world: boolean;
};

/**
 * The dispatch table: a row-by-row TRANSCRIPTION of the legacy counter
 * masks in the design's §2/§2b tables (parity-verified against the
 * pre-cutover counters by the step-2b dual-track gate: full suite plus the
 * three workloads, zero discrepancies). Pure and exported so the per-row
 * unit tests (`test/compute-engine/state-events.test.ts`) can pin every
 * (kind, payload) combination directly.
 *
 * Per kind:
 * - `value-write`: the definition value setter — `any` always, `semantic`
 *   unless the write is an ephemeral loop-index assign.
 * - `declare`: fresh declaration — `any` only.
 * - `binding-repair`: `updateDef`'s internal conditional advance, variance
 *   settle, minted-constructor removal — `any` only.
 * - `redefine`: the in-place `updateDef` redefinition callers —
 *   `semantic`+`world`, no `any` (§2's measured masks; the callable-swap
 *   `any` arrives via `binding-repair`). `callableAfter: false` is
 *   zero-mask (the operator→scalar swap's advances arrive via the
 *   accompanying `value-write`).
 * - `type-write`: direct def retype (§2c) — zero mask.
 * - `scope-pop`: `any` always for `popEvalContext`, +`semantic`+`world`
 *   when assumptions dirty; the `transient` (`inScope`) variant has no
 *   `any` and `semantic`+`world` only when dirty.
 * - `inference`: `BoxedFunction.infer` and the matrix freeze/restore — all
 *   three; `symbolSignature` (`BoxedSymbol.infer`, operator branch) —
 *   `semantic`+`world`; `valueType` (value branch) — zero mask.
 * - `assumption`, `config`: all three.
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

export class EngineConfigurationLifecycle {
  private _anyVersion = 0;
  private _semanticVersion = 0;
  private _worldVersion = 0;
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

  get ephemeralWriteDepth(): number {
    return this._ephemeralWriteDepth;
  }

  set ephemeralWriteDepth(value: number) {
    this._ephemeralWriteDepth = value;
  }

  /**
   * The state-event choke point (design §3) — since the step-2b cutover,
   * the SOLE writer of the invalidation axes: sites report what happened,
   * the dispatch table decides what advances. The pinning test in
   * `state-events.test.ts` asserts no direct axis write exists outside this
   * file.
   */
  noteStateEvent(e: StateEvent): void {
    const m = axisMaskOf(e);
    if (m.any) this._anyVersion += 1;
    if (m.semantic) this._semanticVersion += 1;
    if (m.world) this._worldVersion += 1;
    if (CACHE_STATS) {
      if (m.any) recordBump('generation');
      if (m.semantic) recordBump('mutationGeneration');
      if (m.world) {
        recordBump('semanticEpoch');
        // Shadow 'callable' axis probe: every world-class event is in its
        // predicate (assumption, inference, redefine, config, dirty pop).
        bumpShadowCallable();
      }
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
