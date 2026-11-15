import type { TypeProvenanceEntry } from '../global-types.js';
import { beforeDefinitionWrite } from './definition-restore-point.js';

/**
 * Record one write to a definition's type (or an operator definition's
 * signature) in its provenance history — see `TypeProvenanceEntry` in
 * `types-definitions.ts` and the phase-1 design in
 * `docs/TYPE-SYSTEM.md`.
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
  beforeDefinitionWrite(target);
  const list = (target._typeProvenance ??= []);
  list.push(entry);
  // At the cap the SECOND-oldest entry is displaced (the oldest is the
  // creation/first-evidence anchor — see the doc comment above).
  if (list.length > MAX_TYPE_PROVENANCE) list.splice(1, 1);
}

const MAX_TYPE_PROVENANCE = 8;
