/**
 * The count of the stopped reads of sequence terms.
 *
 * A read of a sequence term is stopped when it needs too many terms, or
 * when the recursion is too deep (`stopSequenceReads()` in `sequence.ts`).
 * A stopped read declines the term for this read only: the `Subscript`
 * stays unevaluated, and a later read, after a read of a lower index, can
 * give the term. Thus a cache must not keep a result that was computed
 * while the count changed: the result can contain such a declined term.
 * Each cache that stores an evaluation result reads the count before the
 * computation and does not store the result when the count is different
 * after it.
 *
 * The count is for the process, not for one engine: a stop also declines
 * the terms of the reads in progress of the other engines, because the
 * limit of the depth is a limit of the call stack, which they share.
 *
 * The count is kept in `failClosedCounts` (`store-guard.ts`), so that a
 * store guard can read it. This module imports only `store-guard.ts`,
 * which imports no module of the engine, so that each cache module can import it
 * with no dependency cycle.
 */

import { failClosedCounts } from './store-guard.js';

/** The number of the stopped reads of sequence terms in this process. */
export function sequenceReadStopCount(): number {
  return failClosedCounts.sequenceStop;
}

/** Add one to the count of the stopped reads of sequence terms. */
export function noteSequenceReadStop(): void {
  failClosedCounts.sequenceStop += 1;
}
