/**
 * The **engine checkpoint / restore API** described by
 * `docs/CHECKPOINT-MODEL.md`.
 *
 * A notebook client takes a checkpoint at a cell boundary and later rewinds
 * to it, so "the user edited cell k" becomes *restore the checkpoint taken
 * before cell k, replay cells k…n* instead of relying on the engine's
 * in-place redefinition semantics. The correctness specification the whole
 * design answers to (§2):
 *
 *     restore(cp[k-1]); run(P'k … P'm)
 *       ≡  fresh engine at B; run(P1 … Pk-1, P'k … P'm)
 *
 * State is covered three ways. The BOUNDED families — the type and protocol
 * registries, assumptions, host configuration, the sequence registries — are
 * snapshotted eagerly here, at `checkpoint()`. The UNBOUNDED ones —
 * definition-record fields, scope bindings, object slots, the unstamped
 * expression-keyed memos — are journaled as they are written, by the
 * copy-on-write window in `checkpoint-journal.ts`. Derived state that is
 * cheap to rebuild is simply purged on restore.
 *
 * ## Windows and the stack
 *
 * Checkpoints form a STACK, not a tree: one linear history, rewound and
 * re-extended. There is no branching, and restoring invalidates every
 * checkpoint above the target.
 *
 * Each checkpoint owns the journal window opened when it was taken, so that
 * window holds the writes made AFTER it and BEFORE the next checkpoint. The
 * newest checkpoint's window is the ACTIVE one (`ce._checkpointWindow`), which
 * is what makes every journaling hook a single field read. Restoring to `cp`
 * therefore replays cp's own window plus every younger one — exactly the
 * writes made since cp was taken. The design's worked example holds:
 * with `cp1; w1; cp2; w2; cp3; w3`, `restore(cp2)` undoes w3 then w2;
 * `discard(cp2)` instead folds w2 into cp1's window, so a later
 * `restore(cp1)` still undoes w3 + w2 + w1.
 *
 * ## Why restore rewrites in place
 *
 * Live boxed expressions capture definition-record identity
 * (`BoxedSymbol._def` is a readonly pointer; `sameBindingDef` in `binders.ts`
 * is object identity), and the consumer's collection element memo validates
 * its dependencies the same way. A restore that swapped in fresh records
 * would leave every pre-edit expression answering from the old objects and
 * make every downstream memo cold — which is what would make
 * restore-then-replay no cheaper than a full re-run. So: rewrite fields on
 * the existing objects, and ADVANCE the monotone counters rather than
 * rewinding them (over-invalidation costs a recompute; resurrecting a stale
 * cache entry is a wrong answer).
 */

import type {
  BoxedValueDefinition,
  Expression,
  IComputeEngine,
  EngineCheckpoint,
  EvalContext,
  FactRecord,
} from './global-types.js';
import { CheckpointWindow } from './checkpoint-journal.js';
import { clearClauseProvenance } from './clause-identity.js';
import {
  _sequenceRegistrySnapshot,
  _restoreSequenceRegistrySnapshot,
} from './sequence.js';
import { syncProtocolDispatchers } from './engine-protocols.js';

/** Every way a checkpoint call can refuse. Each is thrown BEFORE any live
 * state is written, so the refused call is a no-op — except
 * `checkpoint-restore-failed`, which reports the opposite: a throw escaped
 * the mutation phase and the engine is poisoned (§6a). */
export type CheckpointErrorCode =
  | 'checkpoint-not-quiescent'
  | 'checkpoint-dead'
  | 'checkpoint-foreign-engine'
  | 'checkpoint-restore-failed';

/** A typed refusal from `checkpoint()`, `restore()` or `discard()`. Carries a
 * `code` so a client can branch on the condition without matching message
 * text — the difference between "try again at a cell boundary" and "this
 * engine is unusable, rebuild it by full replay" is a decision the client has
 * to make programmatically. */
export class CheckpointError extends Error {
  readonly code: CheckpointErrorCode;

  constructor(code: CheckpointErrorCode, message: string) {
    super(message);
    this.name = 'CheckpointError';
    this.code = code;
  }
}

/** The §4a eager snapshots — the state families whose size is bounded and
 * small at a cell boundary, captured whole rather than journaled. */
type BoundedSnapshot = {
  /** Rollback thunks from the two registries. Reused as shipped: both already
   * snapshot per-record FIELDS (records are replaced in place elsewhere) and
   * bump the invalidation axes only when they actually restored something. */
  readonly typeRegistry: () => void;
  readonly protocolRegistry: () => void;
  readonly assumptions: ReadonlyArray<ContextAssumptions>;
  readonly config: ConfigSnapshot;
  readonly sequences: unknown;
};

/** One eval-context frame's assumption state. `pushScope` COPIES the parent's
 * assumptions (`engine-scope.ts`), so each frame owns its map and each needs
 * its own entry. */
type ContextAssumptions = {
  readonly context: EvalContext;
  readonly entries: ReadonlyArray<
    readonly [Expression, ReadonlyArray<FactRecord>]
  >;
  readonly dirty: boolean | undefined;
  /** The values `assume(x = …)` put in force, keyed by definition. Copied
   * because the overlay is mutated in place; the definition records
   * themselves are restored in place by the journal, so holding them by
   * reference is what the restore needs. */
  readonly assumedValues: ReadonlyArray<
    readonly [BoxedValueDefinition, Expression]
  >;
};

/** Host configuration a user program can reach. Stores that mutate IN PLACE
 * are copied structurally; scalars and injected services are held by
 * reference, which is all their restore needs. LaTeX DICTIONARY mutations are
 * a stated host precondition (§5.5a), not a covered family — only the
 * OPTIONS are captured. */
type ConfigSnapshot = {
  readonly precision: number;
  readonly tolerance: number;
  readonly angularUnit: IComputeEngine['angularUnit'];
  readonly strict: boolean;
  readonly jit: IComputeEngine['jit'];
  readonly costFunction: ((expr: Expression) => number) | undefined;
  readonly integrationProvider: unknown;
  readonly iterationLimit: number;
  readonly recursionLimit: number;
  readonly maxCollectionSize: number;
  readonly latexOptions: object;
  readonly ruleStores: ReadonlyArray<{
    readonly store: { rules: unknown[] };
    readonly rules: unknown[];
  }>;
  readonly compilationTargets: ReadonlyArray<readonly [string, unknown]>;
};

/** The implementation behind {@link EngineCheckpoint}. */
export class _EngineCheckpoint implements EngineCheckpoint {
  readonly id: number;
  readonly label: string | undefined;
  /** The engine this checkpoint belongs to. Restoring a checkpoint into a
   * different engine would write one engine's state from another's snapshot,
   * so ownership is checked rather than assumed. */
  readonly engine: IComputeEngine;
  /** The journal window opened when this checkpoint was taken: the writes
   * made AFTER it. `undefined` once the window has been folded away or freed
   * by `discard()`. */
  window: CheckpointWindow | undefined;
  readonly snapshot: BoundedSnapshot;
  /** The eval-context FRAMES that were on the stack when this checkpoint was
   * taken — the frames themselves, by identity, not their count. Restore
   * rewrites per-frame state (each frame's assumptions map) in place, so a
   * same-depth stack of DIFFERENT frames is a different world that happens to
   * be the same height: only identity distinguishes them. The kill-on-pop
   * rule keeps every LIVE checkpoint's captured stack a prefix of the
   * engine's current stack. */
  readonly contextStack: ReadonlyArray<EvalContext>;
  _live = true;

  get live(): boolean {
    return this._live;
  }

  constructor(
    engine: IComputeEngine,
    id: number,
    label: string | undefined,
    window: CheckpointWindow,
    snapshot: BoundedSnapshot,
    contextStack: ReadonlyArray<EvalContext>
  ) {
    this.engine = engine;
    this.id = id;
    this.label = label;
    this.window = window;
    this.snapshot = snapshot;
    this.contextStack = contextStack;
  }
}

/**
 * The quiescence precondition, exhaustively.
 *
 * A checkpoint operation is legal only between statements, with no transient
 * machinery live. Checking that turns every transient state family — a
 * static pre-pass in progress, an open Epsil batch, an inference frame, a
 * boxing repair — from "must be snapshotted" into "must be absent", which is
 * both cheaper and a standing invariant check. Scope DEPTH is deliberately
 * not part of this predicate: checkpoints are legal at any depth, and the
 * scope discipline lives in `restore`'s separate {@link assertSameStack}
 * plus the kill-on-pop rule.
 *
 * The two members that catch a call from inside an evaluation:
 *
 * - **`_evaluationDepth`.** A synchronous evaluation cannot be interleaved
 *   with a host call on a single thread, so the only way to reach here from
 *   inside one is for an operator handler to call the API mid-evaluation. A
 *   plain `evaluate` handler pushes no eval-context frame, so no stack
 *   comparison can see this — the bracketed counter is the only signal, and
 *   for `checkpoint()` and `discard()` it is the ONLY mid-evaluation guard.
 * - **In-flight ASYNC evaluation.** An `evaluateAsync` suspended at an
 *   `await` holds its context across the suspension and hands control back to
 *   the host, so the engine counts those separately and refuses while the
 *   count is nonzero.
 */
function assertQuiescent(ce: IComputeEngine, operation: string): void {
  const refuse = (why: string): never => {
    throw new CheckpointError(
      'checkpoint-not-quiescent',
      `${operation}: the engine is not at a quiescent cell boundary (${why}). ` +
        `Checkpoint operations are legal only between statements, with no ` +
        `evaluation, static pre-pass or declaration batch in progress.`
    );
  };

  if (ce._checkpointPoisoned)
    throw new CheckpointError(
      'checkpoint-restore-failed',
      `${operation}: a previous restore failed and left this engine poisoned. ` +
        `Its state is no longer covered by the checkpoint contract — rebuild ` +
        `the engine and replay from the baseline instead.`
    );

  if (ce._staticTypeCheckDepth !== 0) refuse('a static pre-pass is running');
  if (ce._staticAssignmentEvidence !== undefined)
    refuse('static assignment evidence is installed');
  if (ce._epsilDeclarationRoute) refuse('an Epsil declaration route is open');
  if (ce._epsilBatchId !== undefined) refuse('an Epsil batch is executing');
  if (ce._rollbackFrames.length !== 0)
    refuse('an inference rollback frame is open');
  if (ce._inferenceTxDepth !== 0) refuse('a boxing pass is in progress');
  if (ce._boxingState.frameDepth() !== 0)
    refuse('a boxing repair frame is open');
  if (ce._evaluationDepth !== 0) refuse('an evaluation is in progress');
  if (ce._inFlightAsyncEvaluations !== 0)
    refuse('an asynchronous evaluation is suspended');
}

/** Refuse a restore whose live eval-context stack is not the one the
 * checkpoint captured — frame for frame, by identity. A depth count is not
 * enough: restore rewrites each captured frame's assumption state in place,
 * and a same-height stack of different frames (the old scope popped, a new
 * one pushed) would have those writes land on frames the checkpoint never
 * saw. In practice the kill-on-pop rule already retires a checkpoint whose
 * frame pops, so the mismatch a caller actually meets is a scope pushed on
 * TOP since the checkpoint was taken. */
function assertSameStack(
  ce: IComputeEngine,
  operation: string,
  expected: ReadonlyArray<EvalContext>
): void {
  const actual = ce._evalContextStack;
  if (actual.length > expected.length) {
    // The one mismatch a caller can produce: scopes pushed on top since the
    // checkpoint was taken. (A shallower stack cannot carry a LIVE
    // checkpoint — the pop that removed a captured frame retires it.)
    throw new CheckpointError(
      'checkpoint-not-quiescent',
      `${operation}: ${actual.length - expected.length} scope(s) have been ` +
        `pushed since this checkpoint was taken. Pop back to the ` +
        `checkpoint's scope before restoring.`
    );
  }
  const same =
    actual.length === expected.length &&
    expected.every((frame, i) => actual[i] === frame);
  if (!same)
    // Unreachable through the public surface: kill-on-pop keeps every live
    // checkpoint's frames a prefix of the current stack, so a live
    // checkpoint with a shallower or same-depth-different-frames stack means
    // a frame-discard site failed to run the retirement hook. Say so — the
    // reader of this message is debugging that gap, and "pop a scope" would
    // send them the wrong way.
    throw new CheckpointError(
      'checkpoint-not-quiescent',
      `${operation}: the evaluation-context stack no longer contains the ` +
        `frames this checkpoint captured (now ${actual.length} frame(s), ` +
        `captured ${expected.length}). A live checkpoint's frames should ` +
        `be impossible to pop without retiring it, so this indicates a ` +
        `frame-discard site that missed the checkpoint-retirement hook — ` +
        `an engine bug, not a caller scope mismatch.`
    );
}

function assertOwned(
  ce: IComputeEngine,
  cp: EngineCheckpoint,
  operation: string
): _EngineCheckpoint {
  if (!(cp instanceof _EngineCheckpoint) || cp.engine !== ce)
    throw new CheckpointError(
      'checkpoint-foreign-engine',
      `${operation}: this checkpoint belongs to a different engine.`
    );
  if (!cp._live)
    throw new CheckpointError(
      'checkpoint-dead',
      `${operation}: checkpoint ${cp.id} is no longer live — it was discarded, ` +
        `or invalidated by a restore to an earlier checkpoint.`
    );
  return cp;
}

// ─── Snapshots (§4a) ───────────────────────────────────────────────────────

function snapshotAssumptions(
  ce: IComputeEngine
): ReadonlyArray<ContextAssumptions> {
  return ce._evalContextStack.map((context) => ({
    context,
    entries: [...context.assumptions.entries()] as ReadonlyArray<
      readonly [Expression, ReadonlyArray<FactRecord>]
    >,
    dirty: context._assumptionsDirty,
    assumedValues: [...context.assumedValues.entries()],
  }));
}

function restoreAssumptions(snapshot: ReadonlyArray<ContextAssumptions>): void {
  for (const { context, entries, dirty, assumedValues } of snapshot) {
    // The MAP is mutated, never replaced: `assume`/`forget` and the scope
    // machinery hold it by identity. Refilling it advances the map's own
    // `version`, which is what retires an index built from the contents the
    // window installed — the engine's generation counters cannot see a
    // refill that lands within one generation.
    context.assumptions.clear();
    for (const [expr, records] of entries) {
      // An assertion whose subject definition was DISPOSED between the
      // snapshot and the restore is about a binding that no longer exists —
      // its scope was discarded — so it is not brought back. Dropping the
      // last assertion of a key drops the key.
      const live = records.filter(
        (record) => !record.subjects.some((s) => s.def.disposed)
      );
      if (live.length !== 0) context.assumptions.set(expr, live);
    }
    context._assumptionsDirty = dirty;
    // The assumed-value overlay is part of the same assumption state and is
    // restored the same way, in place.
    context.assumedValues.clear();
    for (const [def, value] of assumedValues)
      if (!def.disposed) context.assumedValues.set(def, value);
  }
}

function snapshotConfig(ce: IComputeEngine): ConfigSnapshot {
  const engine = ce as unknown as {
    _cost?: (expr: Expression) => number;
    _integrationProvider?: unknown;
    _latexOptions: object;
    _simplificationRules: { rules: unknown[] };
    _solveRules: { rules: unknown[] };
    _harmonizationRules: { rules: unknown[] };
  };
  return {
    precision: ce.precision,
    tolerance: ce.tolerance,
    angularUnit: ce.angularUnit,
    strict: ce.strict,
    jit: ce.jit,
    costFunction: engine._cost,
    integrationProvider: engine._integrationProvider,
    iterationLimit: ce.iterationLimit,
    recursionLimit: ce.recursionLimit,
    maxCollectionSize: ce.maxCollectionSize,
    // COPIED: the setter replaces the object, but a caller can also spread
    // into it, and a shared reference would track the very edits the restore
    // exists to undo.
    latexOptions: { ...engine._latexOptions },
    // The three rule stores are ARRAYS reachable by `push`/`splice`, so the
    // contents are copied rather than the store referenced.
    ruleStores: [
      engine._simplificationRules,
      engine._solveRules,
      engine._harmonizationRules,
    ].map((store) => ({ store, rules: [...store.rules] })),
    compilationTargets: ce
      ._listCompilationTargets()
      .map((name: string) => [name, ce._getCompilationTarget(name)] as const),
  };
}

function restoreConfig(ce: IComputeEngine, snapshot: ConfigSnapshot): void {
  const engine = ce as unknown as {
    _cost?: (expr: Expression) => number;
    _integrationProvider?: unknown;
    _latexOptions: object;
  };
  // ORDERED: setting precision RESETS tolerance
  // (`engine-numeric-configuration.ts`), so tolerance must be written after
  // it or the restore would silently install the precision-derived default.
  ce.precision = snapshot.precision;
  ce.tolerance = snapshot.tolerance;
  ce.angularUnit = snapshot.angularUnit;
  ce.strict = snapshot.strict;
  ce.jit = snapshot.jit;
  engine._cost = snapshot.costFunction;
  engine._integrationProvider = snapshot.integrationProvider;
  ce.iterationLimit = snapshot.iterationLimit;
  ce.recursionLimit = snapshot.recursionLimit;
  ce.maxCollectionSize = snapshot.maxCollectionSize;
  engine._latexOptions = { ...snapshot.latexOptions };

  for (const { store, rules } of snapshot.ruleStores) {
    // Through the SETTER, not by mutating the array in place: the store's
    // dirty check compares the array's length against the length recorded at
    // the last cache build, so a window whose net length change is zero (one
    // rule swapped for another) would restore content the cache still
    // considers current. The setter resets that recorded length
    // unconditionally.
    store.rules = [...rules];
  }

  const wanted = new Map(snapshot.compilationTargets);
  for (const name of ce._listCompilationTargets())
    if (!wanted.has(name)) ce._unregisterCompilationTarget(name);
  for (const [name, target] of wanted)
    if (ce._getCompilationTarget(name) !== target)
      ce._registerCompilationTarget(name, target as never);
}

// ─── The API (§3) ──────────────────────────────────────────────────────────

/**
 * Take a checkpoint of the engine's current state. Legal on a freshly
 * constructed engine, which is how a client gets a `cp[0]` that makes an edit
 * of the FIRST cell checkpoint-tier too.
 *
 * Closes the previously active journal window — attaching it to the
 * checkpoint that opened it — and opens a fresh one for this checkpoint.
 */
export function takeCheckpoint(
  ce: IComputeEngine,
  label?: string
): EngineCheckpoint {
  assertQuiescent(ce, 'checkpoint()');

  const snapshot: BoundedSnapshot = {
    typeRegistry: ce._typeRegistryRollbackPoint(),
    protocolRegistry: ce._protocolRegistryRollbackPoint(),
    assumptions: snapshotAssumptions(ce),
    config: snapshotConfig(ce),
    sequences: _sequenceRegistrySnapshot(ce),
  };

  // The window that was active belongs to the checkpoint that opened it and
  // is already attached to it; taking a new checkpoint simply stops writing
  // into it. At most one window is ever active (§4b), which is what keeps the
  // write path to one field read and one map lookup.
  const window = new CheckpointWindow();
  ce._checkpointWindow = window;

  const cp = new _EngineCheckpoint(
    ce,
    ce._nextCheckpointId++,
    label,
    window,
    snapshot,
    // A COPY: the live stack keeps growing and shrinking after this.
    [...ce._evalContextStack]
  );
  ce._checkpointStack.push(cp);
  return cp;
}

/**
 * Rewind the engine to the moment `cp` was taken, and invalidate every
 * checkpoint above it. `cp` itself stays live and can be restored again.
 *
 * Two phases, for the reason §6 gives: phase 1 validates and COLLECTS without
 * writing, so every refusal leaves the engine untouched; phase 2 mutates, and
 * is built out of plain field assignments, map surgery on already-collected
 * entries, and counter bumps, so that it has no expected throw path. If one
 * escapes anyway the engine is POISONED — every later checkpoint call refuses
 * with `checkpoint-restore-failed` — because a partially rewound engine no
 * longer satisfies §2 and the client needs to know to rebuild rather than
 * trust it.
 */
export function restoreCheckpoint(
  ce: IComputeEngine,
  cp: EngineCheckpoint
): void {
  // ── Phase 1: validate and collect. No live writes. ──
  assertQuiescent(ce, 'restore()');
  const target = assertOwned(ce, cp, 'restore()');
  assertSameStack(ce, 'restore()', target.contextStack);

  const stack = ce._checkpointStack as _EngineCheckpoint[];
  const index = stack.indexOf(target);
  console.assert(index >= 0, 'A live checkpoint is not on its engine stack');

  // Newest-first: the windows of every checkpoint above the target, then the
  // target's own — which together are exactly the writes made since it was
  // taken.
  const doomed = stack.slice(index);
  const windows = doomed
    .map((c) => c.window)
    .filter((w): w is CheckpointWindow => w !== undefined)
    .reverse();

  // ── Phase 2: mutate. Designed not to throw. ──
  let failure: { error: unknown } | undefined;
  // Journaling is OFF for the duration: an undo writes raw slots and would
  // record nothing anyway, but a restore that journaled its own writes into
  // the window it is unwinding is the kind of thing that only works by
  // accident.
  ce._checkpointWindow = undefined;
  try {
    // 1. Invalidate every checkpoint at or above the target. The target is
    //    re-armed at step 10; the rest are dead for good.
    for (const c of doomed) {
      c._live = false;
      c.window = undefined;
    }
    stack.length = index;

    // 2. Journal undo, newest window first. Within a window the entries are
    //    order-independent (first-write-wins makes each carry the value as of
    //    window open), so only the window order matters.
    const touched = new Set<object>();
    const created: { dispose(): void }[] = [];
    for (const w of windows) {
      for (const owner of w.owners()) touched.add(owner);
      for (const half of w.created()) created.push(half);
      // Every window is unwound even after one reports a failure: `undo()`
      // already catches per entry so the rest of ITS window still runs, and
      // stopping at the first failing window would skip older ones whose
      // created halves are disposed below regardless. `??=` would not even
      // call `undo()` once `failure` is set.
      const result = w.undo();
      failure ??= result;
    }

    // 3. Registry rollbacks. Safe after the journal undo because the two
    //    touch disjoint fields — definitions versus registry records.
    target.snapshot.typeRegistry();
    target.snapshot.protocolRegistry();

    // 4. Bounded-family snapshots.
    restoreAssumptions(target.snapshot.assumptions);
    restoreConfig(ce, target.snapshot.config);
    _restoreSequenceRegistrySnapshot(ce, target.snapshot.sequences);

    // 5. Dispose the definition halves created inside the rewound windows.
    //    AFTER every half restore, because a half orphaned by one entry can
    //    be reinstated by an older one. Skipping this leaks the
    //    configuration-change listener a constant's definition subscribes on
    //    construction, for the engine's lifetime.
    for (const half of created) {
      try {
        half.dispose();
      } catch (error) {
        failure ??= { error };
      }
    }

    // 6. Purge the caches that carry no version key of their own, and the
    //    record-keyed side channels that in-place restore leaves stale. The
    //    engine cache store has no version key at all, so nothing above
    //    invalidates it; the clause-provenance WeakMaps are keyed on record
    //    IDENTITY, which this restore deliberately preserved, so their
    //    entries survive the rewind and have to be dropped explicitly.
    (
      ce as unknown as { _cacheStore: { purgeValues(): void } }
    )._cacheStore.purgeValues();
    for (const owner of touched) clearClauseProvenance(owner);
    // Library-load idempotence markers. A loader that installed declarations
    // during the window records the ids it registered, and the restore has
    // just rolled those declarations back — so a replayed load would consult
    // the marker, decide the ids were already present, and skip re-declaring
    // rules the engine no longer has. Cleared rather than snapshotted: a
    // re-load is idempotent and rare, so over-clearing costs one reload.
    //
    // Invoked through hooks the loaders register on the engine, so the core
    // checkpoint path never imports them — a static import would pull the
    // whole Fungrim/Rubi payload into every bundle that can take a
    // checkpoint.
    for (const hook of ce._checkpointResetHooks ?? []) {
      try {
        hook();
      } catch (error) {
        failure ??= { error };
      }
    }

    // 7. Bump, never rewind. Every memo stamped during the rewound windows is
    //    invalidated here — which is also what exempts the checkpoint journal
    //    from the rule that forbids memo stamping while an inference frame is
    //    open (an inference undo advances no counter; this one does).
    ce._noteStateEvent({ kind: 'config' });
    // The conformance axis is NOT covered by state events, so it is advanced
    // explicitly.
    ce._noteConformanceRegistryChange();
    for (const owner of touched) {
      const versioned = owner as { _writeVersion?: number; _version?: number };
      // A definition record: the element memo and map-auto-compile key on
      // per-record write versions, so the engine-wide axes above are not
      // enough.
      if (typeof versioned._writeVersion === 'number')
        versioned._writeVersion += 1;
      // A mutable object: one bump per object, after all of its slot undos.
      if (typeof versioned._version === 'number') versioned._version += 1;
    }

    // 8. Re-sync derived scope state last, because it reads the final
    //    registry: the protocol rollback thunk restores the REGISTRY only,
    //    never the dispatcher bindings derived from it.
    syncProtocolDispatchers(ce);

    // 9. Re-arm the target with a fresh, empty window: it becomes the live top
    //    of the stack and is restorable again.
    const window = new CheckpointWindow();
    target._live = true;
    target.window = window;
    stack.push(target);
    ce._checkpointWindow = window;
  } catch (error) {
    ce._checkpointWindow = undefined;
    ce._checkpointPoisoned = true;
    throw new CheckpointError(
      'checkpoint-restore-failed',
      `restore(): a throw escaped the mutation phase and the engine is now ` +
        `poisoned. Rebuild the engine and replay from the baseline. ` +
        `Cause: ${String(error)}`
    );
  }

  // An undo entry that threw is the same broken-engine condition as a throw
  // escaping the phase, and reported the same way — the difference is only
  // that the journal caught it per entry so the rest of the unwind could run
  // best-effort.
  if (failure !== undefined) {
    ce._checkpointPoisoned = true;
    throw new CheckpointError(
      'checkpoint-restore-failed',
      `restore(): an undo entry threw while unwinding; engine state is only ` +
        `partially restored and is now poisoned. Rebuild the engine and ` +
        `replay from the baseline. Cause: ${String(failure.error)}`
    );
  }
}

/**
 * Retire every checkpoint standing on `frame`, because that frame is being
 * discarded — the scope-pop side of the stack-identity rule.
 *
 * A popped frame's bindings are disposed by the pop itself, so a checkpoint
 * that captured the frame can never be restored again: the world it would
 * rewrite no longer exists. It dies the way an interior discard does — its
 * window FOLDS into the next-older checkpoint (or is freed when there is
 * none), so restoring an older, still-live checkpoint continues to unwind
 * the writes made inside the popped scope. Undo entries that reference the
 * popped scope's own records replay harmlessly against unreachable objects
 * (`dispose()` on a definition half is idempotent by design).
 *
 * The checkpoints standing on `frame` are a contiguous TOP segment of the
 * stack: a checkpoint contains the frame exactly when it was taken while the
 * frame was up, frames pop once, and checkpoints are chronological. The scan
 * therefore walks down from the top and stops at the first survivor.
 *
 * Called from every frame-discard site through
 * `IComputeEngine._invalidateCheckpointsOnFrameDiscard`, gated there on a
 * non-empty checkpoint stack so a session that never takes a checkpoint pays
 * one length read per pop.
 */
export function invalidateCheckpointsOnFrameDiscard(
  ce: IComputeEngine,
  frame: EvalContext
): void {
  const stack = ce._checkpointStack as _EngineCheckpoint[];
  let first = stack.length;
  while (first > 0 && stack[first - 1].contextStack.includes(frame)) first--;
  if (first === stack.length) return;

  const survivorWindow = first > 0 ? stack[first - 1].window : undefined;
  const dying = stack.slice(first);
  // Newest first, each folding into the one below it — the bottom of the
  // dying segment folds into the survivor — so first-write-wins keeps the
  // oldest prior value at every key, exactly as a chain of interior
  // discards would.
  for (let i = dying.length - 1; i >= 0; i--) {
    const below = i > 0 ? dying[i - 1].window : survivorWindow;
    const w = dying[i].window;
    if (w !== undefined && below !== undefined) w.foldInto(below);
    dying[i]._live = false;
    dying[i].window = undefined;
  }
  stack.length = first;
  ce._checkpointWindow = survivorWindow;
}

/**
 * Release `cp`'s restore capability.
 *
 * Restoring PAST a discarded interior checkpoint stays possible through any
 * earlier live one: cp's window is FOLDED into the next-older live
 * checkpoint's, dropping the keys that window already holds because its prior
 * value is the earlier one. Discarding the OLDEST live checkpoint instead
 * frees its window outright — the documented meaning of discarding the base
 * is that state before the next-younger checkpoint stops being reachable.
 */
export function discardCheckpoint(
  ce: IComputeEngine,
  cp: EngineCheckpoint
): void {
  assertQuiescent(ce, 'discard()');
  const target = assertOwned(ce, cp, 'discard()');
  // No stack check, deliberately — a departure from the restore rule.
  // Discard folds journal windows and rewrites no frame state, so nothing it
  // does lands on a frame; and refusing it away from the capture depth would
  // make cleanup of an in-scope checkpoint impossible once the host's own
  // scope timing has moved on. The kill-on-pop rule keeps every live
  // checkpoint's frames on the current stack, so the fold target is live.

  const stack = ce._checkpointStack as _EngineCheckpoint[];
  const index = stack.indexOf(target);
  console.assert(index >= 0, 'A live checkpoint is not on its engine stack');

  const window = target.window;
  // The next-older LIVE checkpoint, read before the target leaves the stack.
  const older = index > 0 ? stack[index - 1] : undefined;

  if (window !== undefined && older?.window !== undefined) {
    // Interior (or top) discard: the target's window carries the writes made
    // after it, and the older checkpoint must now answer for them too. Keys
    // the older window already holds are dropped — its prior value is earlier
    // in time, and earlier is what a restore to it wants.
    window.foldInto(older.window);
  }
  // Discarding the OLDEST live checkpoint frees its window instead: with no
  // older checkpoint to fold into, the state it recorded stops being
  // reachable by restore, which is what discarding the base means.

  stack.splice(index, 1);
  target._live = false;
  target.window = undefined;

  // The active window always belongs to the newest live checkpoint. After
  // discarding the top, that is the one the fold just poured into; after
  // discarding the base or an interior checkpoint, it is unchanged.
  ce._checkpointWindow = stack[stack.length - 1]?.window;
}
