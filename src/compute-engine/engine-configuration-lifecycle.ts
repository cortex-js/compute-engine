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
  | {
      kind: 'scope-pop';
      assumptionsDirty: boolean;
      transient?: boolean;
      /** Set by `discardEvalContext` (reached from `popEvalContext` and
       * from the async pop-by-identity path `removeEvalContext`) when NONE
       * of the engine's three axis versions advanced while the popped
       * context was on the stack (and its assumptions are clean): the
       * bracket performed no writes, declares, redefines, or assumptions,
       * so the pop reverts nothing a version-keyed cache could have
       * observed and must not advance `any`. */
      clean?: boolean;
    }
  | { kind: 'assumption' } // assume / forget
  | { kind: 'inference'; symbolSignature?: boolean; valueType?: boolean }
  | { kind: 'config' } // precision, tolerance, angularUnit, jit, reset, type-statement redefinition
  /** A field of a mutable object was written (`BoxedObject._store`). Advances
   * NO axis — see the `object-store` row of {@link axisMaskOf}. */
  | { kind: 'object-store' };

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
    case 'object-store':
      // A store changes no declaration, no binding and no signature, so no
      // expression's EFFECTS can differ because of it — the axis that keys
      // `BoxedFunction._effects` is not selected. See the `object-store` row
      // of `axisMaskOf` for the whole invalidation story.
      return false;
  }
}

/**
 * `CE_OBJECT_STORE_BUMPS_ANY`: the field-store canary.
 *
 * A field store advances no invalidation axis (the `object-store` row of
 * {@link axisMaskOf}); everything it invalidates travels the precise
 * per-object version channel in `boxed-expression/object-deps.ts` instead.
 * That is correct only while every cache that can hold a field-derived value
 * is wired to that channel or excluded from it, and a family that is neither
 * goes stale SILENTLY — there is no error, just an out-of-date answer.
 *
 * Setting this environment variable makes every store additionally advance the
 * engine-wide `any` version, which colds every generation-keyed cache. If a
 * suspected staleness bug disappears under the flag, the defect is a cache
 * family missing from the object-dependency channel rather than a store
 * defect, and the flag names the file to go read. It is a diagnostic for smoke
 * and soak runs, not a semantic mode — the same posture and env-gating as
 * `CE_EFFECTS_PARANOID` (`boxed-expression/boxed-function.ts`) and
 * `CE_CACHE_STATS`.
 *
 * Ruled 2026-08-15 (the `object-store` mask fork of
 * `docs/plans/2026-08-14-object-representation-decision.md`).
 */
const OBJECT_STORE_BUMPS_ANY: boolean = (() => {
  if (typeof process === 'undefined') return false;
  const flag = process.env?.CE_OBJECT_STORE_BUMPS_ANY;
  return flag !== undefined && flag !== '0';
})();

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
 * - `scope-pop`: `any` for `popEvalContext` unless the pop is `clean`
 *   (the frame's push-time stamps prove no interior event advanced any of
 *   the three axes, so there is nothing to retire — the item-181
 *   amendment), +`semantic`+`world` when assumptions dirty; the
 *   `transient` (`inScope`) variant advances `any` only when dirty (R5) —
 *   a clean transient pop is zero-mask.
 * - `inference`: `BoxedFunction.infer` and the matrix freeze/restore — all
 *   three; `symbolSignature` (`BoxedSymbol.infer`, operator branch) — all
 *   three (R5); `valueType` (value branch) — `any` only (R5).
 * - `assumption`, `config`: all three.
 * - `object-store`: a mutable object's field write — NONE of the three (and
 *   not the callable axis either). Invalidation for stores is the per-object
 *   version channel, not an axis; see the row's own note.
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
      // NOTE: since the clean-bracket pop carve-out (the `scope-pop {clean}`
      // row below), every zero-`any` branch in this table is a CORRECTNESS
      // precondition, not just a parity choice: `discardEvalContext` proves
      // a bracket clean by comparing all three axis versions at push vs
      // pop, so an event that advances none of them must be genuinely
      // unobservable to version-keyed caches across a scope boundary — its
      // effects covered by an atomically accompanying event that does
      // advance an axis (here: the operator→scalar swap's value-write).
      // A new emit site reaching a zero-mask branch without such a
      // companion would let a stale cache survive a clean pop.
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
        //
        // A `clean` pop — `discardEvalContext` proved via the frame's
        // push-time version stamps that no event advanced ANY of the three
        // axes inside the bracket (all three, because `redefine` advances
        // `semantic`+`world` without `any` yet ends a local operator's
        // visibility) — is likewise zero-mask on `any`: the pop-bump exists
        // to retire answers computed under interior
        // writes/declares/redefines/assumptions, and a bracket with none
        // has nothing to retire. Without this, the
        // push/pop-per-probe reads of lazy collections (`Comprehension`
        // count/finiteness scans, `Filter` emptiness walks) invalidated the
        // `_type`/`_sgn` caches the enclosing type derivation was filling —
        // the Tycho item-181 blowup (872K clean pops, 1.85M wasted type
        // recomputes in one canonical box).
        any: (!e.transient && !e.clean) || e.assumptionsDirty,
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
    case 'object-store':
      // A field store of a mutable object advances NOTHING (ruled 2026-08-15;
      // the fork is recorded in
      // `docs/plans/2026-08-14-object-representation-decision.md`). The engine
      // axes are the COARSE channel — an `any` bump colds every
      // generation-keyed cache in the engine — and objects exist for exactly
      // the workload that cannot afford it: store-heavy loops (sorts, sieves,
      // accumulating a running total). A per-store engine-wide bump is the
      // slider-tick pathology the invalidation-axes work was built to end
      // (item 181: 872K events, 1.85M wasted type recomputes in one box).
      //
      // What a store DOES invalidate travels the precise per-object channel in
      // `boxed-expression/object-deps.ts`: every cache entry built from a
      // field read carries `(object, version at read)` stamps that are
      // re-validated at every use, so a store to `p` drops exactly the entries
      // that read `p` and nothing else. The coarse channel could not
      // substitute for it in any case: an object answers `isConstant` true, so
      // a field-reading node takes a generation-INDEPENDENT cache key that an
      // `any` bump does not reach (see `BoxedObject.isConstant`). Soundness
      // therefore rests on the cache inventory being complete — every family
      // wired to the channel or excluded with a reason — which is what
      // `object-deps.ts`'s inventory records and what the adversarial
      // store-then-re-evaluate matrix in `test/compute-engine/object-caching.test.ts`
      // tests family by family. `CE_OBJECT_STORE_BUMPS_ANY` is the diagnostic
      // for the failure mode that inventory is guarding against.
      //
      // On the zero-mask correctness precondition stated in the `redefine`
      // note above: a store inside a scope bracket leaves that bracket
      // provably `clean`, and that is sound here rather than accidental,
      // because no version-keyed cache entry can be stale on account of a
      // store. An entry that read a field carries object-version stamps and
      // revalidates against them independently of any scope boundary; an entry
      // that read no field is unaffected by a store in the first place.
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
