/**
 * The store guard of the caches of evaluated values.
 *
 * A cache may keep a value only when the computation that made it gave a
 * final answer. Several events during a computation tell that the answer is
 * not final, or that it depends on state that the key of the cache does not
 * record. Each event adds one to a count for the whole process:
 *
 * - `host`: host code that does not state its purity ran, or a host handler
 *   that states it changed state (`host-handler-changes.ts`). The host code
 *   can read state that no key records.
 * - `cycle`: a guarded query found a reference cycle and gave its
 *   "cannot determine" answer (`cycle-guard.ts`). The same query outside the
 *   cycle can give another answer.
 * - `sequenceStop`: a read of a sequence term was stopped, so the term stays
 *   unevaluated for this read only (`sequence-read-stops.ts`).
 * - `reentrantSignature`: a computation read the signature of a function
 *   while that signature was being derived, and received a provisional
 *   signature (`declared-parameter-result.ts`).
 * - `incompleteWalk`: a walk of a collection missed elements that it could
 *   not compute (`incomplete-walks.ts`). This count can also go down: a
 *   nested evaluation whose result is a value takes back the incomplete
 *   walks it recorded.
 * - `iterationLimit`: a computation was cancelled by `engine.iterationLimit`
 *   and its caller gave an "unknown" answer (`common/interruptible.ts`).
 *   A larger limit can give a definite answer, and a change of the limit
 *   advances no version that a cache compares.
 * - `lazyValueProvisional`: a re-entrant evaluation of a lazy collection
 *   node whose value is being computed (`boxed-function.ts`).
 * - `cellProvisional`: a re-entrant read of a description cache (type, sign)
 *   was answered with a value that is not final (`cachedValue()`,
 *   `cache.ts`). This count can also go down: the outermost computation of
 *   a cell takes back the answers that only it received.
 *
 * A cache begins a guard before its computation and asks the guard at the
 * end whether it may store the value:
 *
 * ```ts
 * const guard = beginStoreGuard();
 * const value = compute();
 * if (guard.allowsStore()) store(value);
 * ```
 *
 * `allowsStore()` is false when any count changed. A cache that must keep a
 * value although a count changed names that count with `movedOnly()`, and
 * the call site states why.
 *
 * The counts are for the process, not for one engine: an event of one
 * engine stops a store of another engine, which is only a missed store. An
 * asynchronous evaluation can see the events of another evaluation that
 * runs during one of its `await`s; that also only stops a store.
 *
 * The modules that own each event increment the counts in
 * {@link failClosedCounts}, except the iteration limit, whose count is in
 * `common/interruptible.ts` (a lower part of the code base, which cannot
 * import this module).
 *
 * This module imports no module of the engine, so that every module can
 * import it with no dependency cycle.
 */

import { iterationLimitCancellationCount } from '../../common/interruptible.js';

/** The name of each count that a store guard compares. */
export type StoreGuardCount =
  | 'host'
  | 'cycle'
  | 'sequenceStop'
  | 'reentrantSignature'
  | 'incompleteWalk'
  | 'iterationLimit'
  | 'lazyValueProvisional'
  | 'cellProvisional';

/**
 * The counts of the events that stop a store, other than the iteration
 * limit. The module that owns an event changes its count here; any other
 * module only reads it, through a {@link StoreGuard}.
 */
export const failClosedCounts = {
  host: 0,
  cycle: 0,
  sequenceStop: 0,
  reentrantSignature: 0,
  incompleteWalk: 0,
  lazyValueProvisional: 0,
  cellProvisional: 0,
};

/** The counts when a computation began, compared at its end. */
export class StoreGuard {
  private readonly host = failClosedCounts.host;
  private readonly cycle = failClosedCounts.cycle;
  private readonly sequenceStop = failClosedCounts.sequenceStop;
  private readonly reentrantSignature = failClosedCounts.reentrantSignature;
  private readonly incompleteWalk = failClosedCounts.incompleteWalk;
  private readonly iterationLimit = iterationLimitCancellationCount();
  private readonly lazyValueProvisional = failClosedCounts.lazyValueProvisional;
  private readonly cellProvisional = failClosedCounts.cellProvisional;

  /** True when no count changed since the guard began. */
  allowsStore(): boolean {
    return (
      this.host === failClosedCounts.host &&
      this.cycle === failClosedCounts.cycle &&
      this.sequenceStop === failClosedCounts.sequenceStop &&
      this.reentrantSignature === failClosedCounts.reentrantSignature &&
      this.incompleteWalk === failClosedCounts.incompleteWalk &&
      this.iterationLimit === iterationLimitCancellationCount() &&
      this.lazyValueProvisional === failClosedCounts.lazyValueProvisional &&
      this.cellProvisional === failClosedCounts.cellProvisional
    );
  }

  /** True when the count `kind` changed since the guard began. */
  moved(kind: StoreGuardCount): boolean {
    switch (kind) {
      case 'host':
        return this.host !== failClosedCounts.host;
      case 'cycle':
        return this.cycle !== failClosedCounts.cycle;
      case 'sequenceStop':
        return this.sequenceStop !== failClosedCounts.sequenceStop;
      case 'reentrantSignature':
        return this.reentrantSignature !== failClosedCounts.reentrantSignature;
      case 'incompleteWalk':
        return this.incompleteWalk !== failClosedCounts.incompleteWalk;
      case 'iterationLimit':
        return this.iterationLimit !== iterationLimitCancellationCount();
      case 'lazyValueProvisional':
        return (
          this.lazyValueProvisional !== failClosedCounts.lazyValueProvisional
        );
      case 'cellProvisional':
        return this.cellProvisional !== failClosedCounts.cellProvisional;
    }
  }

  /**
   * True when every count that changed since the guard began is one of
   * `accepted` (also when no count changed). A cache that keeps a value
   * although one of these counts changed uses this in place of
   * {@link allowsStore}, and its call site states why the value stays
   * correct.
   */
  movedOnly(...accepted: StoreGuardCount[]): boolean {
    if (this.allowsStore()) return true;
    for (const kind of STORE_GUARD_COUNTS)
      if (!accepted.includes(kind) && this.moved(kind)) return false;
    return true;
  }
}

const STORE_GUARD_COUNTS: readonly StoreGuardCount[] = [
  'host',
  'cycle',
  'sequenceStop',
  'reentrantSignature',
  'incompleteWalk',
  'iterationLimit',
  'lazyValueProvisional',
  'cellProvisional',
];

/** Sample every count, before a computation whose value a cache may keep. */
export function beginStoreGuard(): StoreGuard {
  return new StoreGuard();
}
