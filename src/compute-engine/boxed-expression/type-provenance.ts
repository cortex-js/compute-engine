import type { TypeProvenanceEntry } from '../global-types.js';

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
  target: { _typeProvenance: TypeProvenanceEntry[] | undefined },
  entry: TypeProvenanceEntry
): void {
  const list = (target._typeProvenance ??= []);
  list.push(entry);
  if (list.length > MAX_TYPE_PROVENANCE) list.splice(1, 1);
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
