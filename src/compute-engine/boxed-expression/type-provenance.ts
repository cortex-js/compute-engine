import type { TypeProvenanceEntry } from '../global-types.js';
import {
  activeRollbackFrame,
  type InferenceRollbackFrame,
} from '../inference-rollback.js';

/**
 * Record one write to a definition's type (or an operator definition's
 * signature) in its provenance history — see `TypeProvenanceEntry` in
 * `types-definitions.ts` and the phase-1 design in
 * `docs/plans/2026-08-13-inference-provenance-journal.md`.
 *
 * Callers only record writes that actually changed the type (the write sites
 * skip no-op re-inferences via reference equality), so the history stays
 * short in practice. The cap below is a safety valve for pathological
 * sessions: entries hold `Expression` references through `cause`, so an
 * unbounded list would pin expressions alive. When the cap is hit, the
 * OLDEST entry is kept — it is the creation/first-evidence anchor
 * (`'auto-declared'`, or the first `'inferred'` write) that diagnostics and
 * the first-boxing predicate need — and the second-oldest is dropped.
 *
 * The cap bounds the entry COUNT, deliberately not the per-entry size: a
 * `cause` is a one-node wrapper over the program's own operand expressions
 * (shared structure, not a copy), so retaining it extends the liveness of
 * trees the session already built rather than duplicating them. Do not
 * mistake the count cap for a size bound.
 */
export function recordTypeProvenance(
  ce: { _rollbackFrames: ReadonlyArray<InferenceRollbackFrame> },
  target: { _typeProvenance: TypeProvenanceEntry[] | undefined },
  entry: TypeProvenanceEntry
): void {
  const wasUnallocated = target._typeProvenance === undefined;
  const list = (target._typeProvenance ??= []);
  list.push(entry);
  // At the cap the SECOND-oldest entry is displaced (the oldest is the
  // creation/first-evidence anchor — see the doc comment above).
  let displaced: TypeProvenanceEntry | undefined;
  if (list.length > MAX_TYPE_PROVENANCE) displaced = list.splice(1, 1)[0];

  // Rollback journal (family 7): pop the append, and reinsert a
  // cap-displaced entry at its index — without that, an aborted append at
  // capacity would permanently destroy a pre-existing entry. Strict-LIFO
  // replay guarantees the list is exactly in its post-append state when
  // this undo runs, so a `pop()` is the exact inverse.
  const frame = activeRollbackFrame(ce);
  if (frame !== undefined) {
    frame.record({
      undo: () => {
        if (displaced !== undefined) list.splice(1, 0, displaced);
        const popped = list.pop();
        console.assert(
          popped === entry,
          'Provenance rollback out of order: the journal replay is not LIFO'
        );
        // A history this append allocated goes back to unallocated, so an
        // aborted first write leaves the definition byte-identical.
        if (wasUnallocated && list.length === 0)
          target._typeProvenance = undefined;
      },
    });
  }
}

const MAX_TYPE_PROVENANCE = 8;

/**
 * The epoch to stamp on a provenance entry recorded right now: the current
 * outermost-boxing epoch while a boxing pass is in progress, `undefined`
 * outside one (an entry with no epoch tells consumers to fall back to the
 * containment test on `cause` — see `TypeProvenanceEntry.epoch`).
 */
export function currentBoxingEpoch(ce: {
  _inferenceTxDepth: number;
  _boxingEpoch: number;
}): number | undefined {
  return ce._inferenceTxDepth > 0 ? ce._boxingEpoch : undefined;
}
