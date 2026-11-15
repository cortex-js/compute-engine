/**
 * Inference **rollback frames** — phase 2b of
 * `docs/TYPE-SYSTEM.md`.
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
 * counter* (it drives the `_freshlyInferred` lifecycle)
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

  record(entry: RollbackUndoEntry): void {
    (this._journal ??= []).push(entry);
  }

  /** True when the frame has journaled a mutation. */
  get hasEntries(): boolean {
    return (this._journal?.length ?? 0) > 0;
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
