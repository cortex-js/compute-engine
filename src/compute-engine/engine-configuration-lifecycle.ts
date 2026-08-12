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
 * The `callable` axis predicate (design §5, migration step 3): does this
 * event select the axis that keys `BoxedFunction._effects`?
 *
 * Selected: every world-class event (`assumption`, `inference` — all
 * variants including the zero-mask `valueType` —, `config`), `redefine` and
 * `type-write` when EITHER side is callable, `binding-repair` wholesale,
 * assumption-dirty scope pops (either variant), callable-classified value
 * writes, and declares that install a callable or shadow one.
 *
 * Not selected — the measured waste of §1: scalar value writes (slider
 * ticks, loop indexes), non-callable non-shadowing declares (per-call
 * `let`s), and clean scope pops (neutralized by the effects cache's
 * scope-identity stamp instead).
 *
 * Soundness argument: design §5 (four-part, verified by the §1b shadow
 * simulation — zero divergences vs the generation key wherever it
 * recomputed — and guarded by the `CE_EFFECTS_PARANOID` canary).
 */
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
  }
}

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
 * - `type-write`: direct def retype (§2c) — `any` only (R5-normalized in
 *   step 5: pre-design these bare routes advanced nothing).
 * - `scope-pop`: `any` always for `popEvalContext`, +`semantic`+`world`
 *   when assumptions dirty; the `transient` (`inScope`) variant advances
 *   `any` only when dirty (R5) — a clean transient pop is zero-mask.
 * - `inference`: `BoxedFunction.infer` and the matrix freeze/restore — all
 *   three; `symbolSignature` (`BoxedSymbol.infer`, operator branch) — all
 *   three (R5); `valueType` (value branch) — `any` only (R5).
 * - `assumption`, `config`: all three.
 *
 * The R5 rows are the step-5 normalization (ruled 2026-08-09): the
 * pre-cutover masks they replace are recorded in the design's §2/§9.
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
      // R5 normalization (step 5, ruled 2026-08-09): a def retype advances
      // `any` so G-keyed `_sgn`/`_type` see it — closing the pre-design
      // latent gap where the bare routes (§2c) advanced nothing.
      return { any: true, semantic: false, world: false };
    case 'scope-pop':
      return {
        // R5: an assumption-dirty TRANSIENT pop advances `any` too, matching
        // its `popEvalContext` twin. A clean transient pop stays zero-mask —
        // `inScope` runs per boxing operation, and its twin's unconditional
        // `any` exists for assumption reverts a clean pop does not perform.
        any: !e.transient || e.assumptionsDirty,
        semantic: e.assumptionsDirty,
        world: e.assumptionsDirty,
      };
    case 'assumption':
      return { any: true, semantic: true, world: true };
    case 'inference':
      // R5 — PARTIALLY applied (amended by blast-radius evidence,
      // 2026-08-11): the `valueType` branch MUST stay off the `any` axis.
      // Value-branch inference is a side effect of type computation itself
      // (canonicalization infers operand types mid-walk), so advancing the
      // axis that `_type`/`_sgn` read makes the type system invalidate its
      // own footing: measured fallout was a stack overflow in
      // assumption-driven sign reasoning and inference-outcome drift in
      // two typing suites. The pre-design zero-mask was load-bearing. The
      // `symbolSignature` branch (rare, not self-triggered) does advance
      // `any`, matching its `BoxedFunction.infer` twin.
      if (e.valueType) return { any: false, semantic: false, world: false };
      if (e.symbolSignature) return { any: true, semantic: true, world: true };
      return { any: true, semantic: true, world: true };
    case 'config':
      return { any: true, semantic: true, world: true };
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
