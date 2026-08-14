/**
 * Inference **rollback frames** — phase 2b of
 * `docs/plans/2026-08-13-inference-tx-design.md`.
 *
 * A rollback frame journals every inference-driven engine mutation made while
 * it is open — type-slot writes, operator-signature writes, binding-half
 * swaps, declarations, forward-reference registry deltas, `_freshlyInferred`
 * membership, provenance appends, narrowing-sink entries — and undoes them
 * all, in strict LIFO order, when the frame closes. Frames are
 * ALWAYS-ROLLBACK: there is no commit. The consumer-facing form is
 * `ce._withRolledBackInference(fn)` (`index.ts`), which pushes a frame, runs
 * `fn`, and rolls the frame back on normal return and on throw alike.
 *
 * Naming: a rollback frame is NOT the `_inferenceTxDepth` /
 * `beginInferenceTransaction` machinery — that is a boxing-pass *window
 * counter* (it drives `_boxingEpoch` and the `_freshlyInferred` lifecycle)
 * with no undo semantics. A rollback frame always nests strictly inside one
 * boxing-pass window; `_withRolledBackInference` asserts that.
 *
 * Journaling hooks live at the mutation sites (the write sites the phase-1
 * provenance channel enumerates, `updateDef`, the declare routes, the
 * forward-reference registry, `recordTypeProvenance`, the narrowing sink,
 * and the provisional-literal re-derivation `installRebuiltLiteral`). Each
 * hook is one `activeRollbackFrame(ce)` null check when no frame is open.
 * Undo actions write raw state directly — setter-bypassing, no events, no
 * re-journaling — so an inner frame's rollback is never recorded by an
 * outer frame.
 *
 * A LEAF module by design: it imports nothing (types included), so any
 * layer — `types-engine.ts`, `boxed-expression/*`, `engine-declarations.ts`
 * — can import it without creating a dependency cycle.
 */

/** One journaled mutation: `undo()` restores the state the mutation
 * replaced, writing raw slots directly (no setters, no events, no
 * journaling of its own). */
export type RollbackUndoEntry = { undo(): void };

export class InferenceRollbackFrame {
  /** Undo entries in recording order; replayed in reverse (strict LIFO).
   * Allocated lazily on the first write — frames open on
   * canonicalization-adjacent hot paths, and most record nothing. */
  private _journal: RollbackUndoEntry[] | null = null;

  /** `EngineBoxingState` repair-frame depth when this frame opened. At
   * close, every still-live repair frame at or above this depth must have
   * `repairRequested` unset: a repair frame pushed and popped inside this
   * frame's lifetime was consumed by its own rebuild loop (which ran inside
   * this frame), so only the still-live frames need the close-time scan. */
  readonly boxingRepairDepthAtOpen: number;

  /** True for a frame that must not execute the construction-level repairs
   * (`devolveUnappliedOperator`, `repairFreshMatrixInference`) — the
   * repair-free TRIAL validation mode of phase 2c, which admits repairs by
   * precondition without running them. No 2b consumer sets it: the static
   * checking pass's frame wraps ordinary full canonicalization, where the
   * repairs legitimately run (and are journaled, so they roll back). The
   * repair helpers assert against it. */
  readonly forbidsRepairs: boolean;

  constructor(options: {
    boxingRepairDepthAtOpen: number;
    forbidsRepairs?: boolean;
  }) {
    this.boxingRepairDepthAtOpen = options.boxingRepairDepthAtOpen;
    this.forbidsRepairs = options.forbidsRepairs ?? false;
  }

  record(entry: RollbackUndoEntry): void {
    (this._journal ??= []).push(entry);
  }

  /**
   * Replay the journal in reverse order.
   *
   * A throw from an undo entry is a broken-engine condition (undo restores
   * raw slots and runs no user code): the unwind continues best-effort past
   * it, the failure is reported via `console.assert` (visible in
   * development, stripped from production builds), and the FIRST failure is
   * returned so the caller can decide — in debug builds — to surface it.
   * The caller must never let an undo failure mask the body's own error in
   * release; that is why each entry is caught here rather than letting a
   * `finally`-throw replace the body error.
   */
  rollback(): { error: unknown } | undefined {
    const journal = this._journal;
    this._journal = null;
    if (journal === null) return undefined;
    let firstFailure: { error: unknown } | undefined;
    for (let i = journal.length - 1; i >= 0; i--) {
      try {
        journal[i].undo();
      } catch (error) {
        firstFailure ??= { error };
        console.assert(
          false,
          'Inference rollback: an undo entry threw — engine state may be partially restored',
          error
        );
      }
    }
    return firstFailure;
  }
}

/** The innermost open rollback frame of `host`, or `undefined` when none is
 * open. The one-null-check gate every journaling hook goes through. */
export function activeRollbackFrame(host: {
  _rollbackFrames: ReadonlyArray<InferenceRollbackFrame>;
}): InferenceRollbackFrame | undefined {
  const frames = host._rollbackFrames;
  return frames.length === 0 ? undefined : frames[frames.length - 1];
}

/** True when some open rollback frame forbids the construction-level
 * repairs — the phase-2c trial mode. Asserted by the repair helpers
 * (`devolveUnappliedOperator`, `repairFreshMatrixInference`). */
export function repairsForbiddenByRollbackFrame(host: {
  _rollbackFrames: ReadonlyArray<InferenceRollbackFrame>;
}): boolean {
  return host._rollbackFrames.some((frame) => frame.forbidsRepairs);
}
