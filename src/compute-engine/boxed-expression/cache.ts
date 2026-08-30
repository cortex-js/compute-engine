import {
  CACHE_STATS,
  recordCache,
  type CacheClass,
  type CacheEvent,
} from '../../common/cache-stats.js';
import {
  beginObjectDeps,
  endObjectDeps,
  engineHasObjects,
  mergeObjectDeps,
  objectDepsValid,
  type ObjectDeps,
} from './object-deps.js';
import { containsObject } from './object-walk.js';
import { isExpression } from './type-guards.js';

/**
 * One memoized answer, with everything that decides whether it may be served.
 *
 * A {@link CachedValue} holds two of these — see the composite-generation
 * section of {@link cachedValue}.
 */
export type CachedCell<T> = {
  value: T | null;
  generation: number | undefined;
  /** The mutable objects whose fields this entry's value was derived from,
   * with their versions at read time (`object-deps.ts`). `undefined` — the
   * overwhelmingly common case — means the computation read no object field
   * and this channel constrains the entry not at all. */
  objectDeps?: ObjectDeps;
  /** How many computations OF THIS CELL are on the host call stack right
   * now, or `undefined` when none is. A count rather than a flag because a
   * re-entrant read of a cell that has no previous value falls through and
   * recomputes, nesting a second computation of the same slot inside the
   * first. See the re-entrancy section of {@link cachedValue}. */
  inFlight?: number;
};

export type CachedValue<T> = CachedCell<T> & {
  /** The cell for a computation made while the engine's assumptions were
   * hidden (an ODD composite generation). Allocated on the first such read;
   * an engine that never hides its assumptions never pays for it. The fields
   * above are the LIVE cell, so a slot that is managed by hand rather than
   * through {@link cachedValue} keeps working unchanged. */
  suppressed?: CachedCell<T>;
};

/** Optional cache-statistics instrumentation for {@link cachedValue}: the
 * class to record under, and an equality test used to classify a recompute
 * that landed on the same answer as wasted. Callers pass this only when
 * `CACHE_STATS` is on (`CE_CACHE_STATS`); it costs nothing otherwise. */
export type CachedValueStats<T> = {
  cls: CacheClass;
  same: (a: T, b: T) => boolean;
};

/**
 * How many re-entrant reads {@link cachedValue} has answered provisionally in
 * this process, ever. Monotonic, and only ever compared before/after a
 * computation — the same shape as `_lazyValueProvisionalReads` in
 * `boxed-function.ts` and `cycleDetectionCount()` in `cycle-guard.ts`, and
 * used for the same purpose: a computation that consumed a provisional answer
 * must not be frozen. Process-wide rather than per-entry because the
 * provisional answer travels upward — every entry whose computation was on the
 * stack when one was served has to decline, not just the one that was
 * re-entered.
 */
let _provisionalReads = 0;

/**
 * The cell {@link cachedValue} uses for `generation`, allocated on first use.
 *
 * A caller with a fast path of its own — one that reads `value` and
 * `objectDeps` without going through the helper — must select its cell with
 * this function, or it reads the live answer while asking for the suppressed
 * one. `generation: undefined` (a constant entry) always selects the live
 * cell.
 */
export function cachedCell<T>(
  v: CachedValue<T>,
  generation: number | undefined
): CachedCell<T> {
  if (generation === undefined || (generation & 1) === 0) return v;
  return (v.suppressed ??= { value: null, generation: undefined });
}

/**
 * The cache v will get updated if necessary.
 *
 * ## The composite generation
 *
 * A generation-keyed caller passes `ce._cacheGeneration()`, which packs two
 * things into one number: the engine's `any` invalidation axis, doubled, plus
 * one when the engine is hiding its assumptions from every reader
 * (`ce._factsHidden()`). So an EVEN key is a computation made with the
 * assumptions in force and an ODD key is one made without them, and the axis
 * alone is the key shifted right by one (`generation >> 1`).
 *
 * The same node answers differently on the two sides — a symbol assumed
 * greater than 3 types `real<3<..>` live and `real` with the facts hidden —
 * so the two answers may never be served to each other. They are kept in two
 * CELLS of one entry rather than in one cell keyed by the composite, so that
 * a read made with the facts hidden does not evict the live answer and force
 * the whole subtree to be derived again the next time it is read. The cost of
 * the second cell is at most one extra derivation per write, for the nodes
 * that are read on both sides; an engine that never hides its assumptions
 * never allocates it.
 *
 * The one place the two cells meet is the in-flight window below.
 *
 * Beyond the generation key, an entry also records the per-object version
 * dependencies of the computation that produced it (`object-deps.ts`). A
 * mutable object's field store bumps no engine generation, so without this an
 * entry keyed only on a generation would serve a value derived from a field
 * that has since changed. Three rules are applied here, once, for every cache
 * that goes through this helper:
 *
 * - A HIT is served only while every recorded `(object, version)` pair still
 *   holds, and the hit MERGES those dependencies into any enclosing collector
 *   — a hit performs no reads, so an outer computation would otherwise commit
 *   as if the value had no dependencies at all.
 * - A payload that transitively contains an object is NOT stored: a cached
 *   value holding an object reference would keep it alive for as long as the
 *   entry lives (ruling B12) and could hand back an object whose contents the
 *   entry never validated.
 * - A computation that THROWS commits nothing — neither value nor
 *   dependencies — and the key it stamped for its in-flight window is put
 *   back, so a failed attempt leaves the cache exactly as it found it.
 *
 * ## The in-flight window
 *
 * These caches ARE re-entered: computing `x.type` resolves operand types,
 * which can travel a binding back to `x` itself. The key (`generation`) is
 * therefore stamped BEFORE `fn()` runs, deliberately: it makes the entry's
 * previous value answer a re-entrant read instead of recursing, and recursive
 * and mutually recursive definitions in this engine terminate through exactly
 * that answer. What must NOT be stamped early is the dependency set.
 *
 * Clearing `objectDeps` for the window (the shape this helper used to have)
 * described the value in `v.value` — the PREVIOUS one, still sitting there for
 * the whole computation — as depending on nothing. A re-entrant read was
 * served that value and merged nothing into the enclosing collector, so an
 * outer entry could commit without the dependencies of everything it
 * transitively read: the exact hole this channel exists to close. The entry's
 * dependencies are now left alone until the commit, where they are replaced
 * together with the value they describe. Through the window they keep
 * describing `v.value`, so a re-entrant read is guarded by them (a previous
 * value whose object has since changed is not served at all) and merges them
 * outward when it is served.
 *
 * A re-entrant read is still a STALE answer with respect to the generation,
 * which is why, in a session that has constructed a mutable object, it is also
 * COUNTED: any computation on the stack that consumed one then commits
 * nothing, the way `_effectsOf` and the lazy-collection evaluate memo (both in
 * `boxed-function.ts`) refuse to freeze a value built on a provisional edge.
 * Where no object has ever been constructed, no entry can carry object
 * dependencies, and the helper behaves exactly as it always has — see the note
 * on that gate below.
 *
 * The window reaches ACROSS the two cells, and there it compares only the axis
 * half of the key. A derivation that runs with the assumptions hidden and
 * re-enters the same node finds its own cell empty — nothing was ever computed
 * on that side — and would recurse until the host stack is exhausted, which is
 * what one recursive definition and one mutually recursive pair did the moment
 * the entry gained a second cell. So a read whose own cell misses is served
 * the TWIN cell's value, provided a computation of this entry (either cell) is
 * on the stack and the two keys agree on the axis half. That answer is a
 * fact-bearing value handed to a fact-free read, or the reverse, which is why
 * it is marked provisional UNCONDITIONALLY — unlike a same-cell re-entrant
 * answer, which is counted only where the engine has objects: it terminates the
 * recursion, and nothing derived from it is committed.
 *
 * `inFlight` is kept PER CELL, because it answers "is a computation of THIS
 * cell on the stack" — which is what decides whether that cell's value is a
 * provisional one — and a live computation and a suppressed computation of the
 * same node can be on the stack at the same time. The terminator gets the
 * entry-wide view it needs by looking at both cells.
 */
export function cachedValue<T>(
  v: CachedValue<T>,
  generation: number | undefined,
  fn: () => T,
  stats?: CachedValueStats<T>,
  /** The engine this entry belongs to. Supplied so the same-cell
   * provisional-read gate below (the only gate that consults it; the
   * cross-cell serve always counts) can ask whether THIS engine has objects
   * rather than whether the PROCESS does — see `engineHasObjects` in
   * `object-deps.ts` for why the difference is a correctness matter and not a
   * tuning one. Optional so a caller with no engine in hand (there are none
   * today) degrades to never counting a same-cell re-entrant read, i.e. to the
   * pre-object behaviour. */
  engine?: object
): T {
  const cell = cachedCell(v, generation);
  // The other side of the entry, consulted only by the in-flight terminator
  // below.
  const twin: CachedCell<T> | undefined = cell === v ? v.suppressed : v;

  if (
    cell.generation === generation &&
    cell.value !== null &&
    objectDepsValid(cell.objectDeps)
  ) {
    // The dependencies are those of the value being served, whether this cell
    // is settled or still in flight (they are not cleared for the window), so
    // the merge is correct either way.
    mergeObjectDeps(cell.objectDeps);
    if (cell.inFlight) {
      // A RE-ENTRANT read: the value served is the cell's PREVIOUS one, and
      // the key it is being served under belongs to a computation that has not
      // finished. Mark the pass so that computation — and every computation
      // enclosing it — refuses to commit.
      //
      // Only in a session that has constructed a mutable object. Without one
      // an entry cannot carry object dependencies, so there is nothing for a
      // commit to truncate and suppressing it would buy nothing — while
      // costing the engine its established answers, since recursive and
      // mutually recursive definitions terminate BY consuming this value and
      // freezing what they built from it (`scope-advanced.test.ts` MUTUAL
      // RECURSION; `definition-order.test.ts`, which pins that a compiled
      // result does not depend on which definition was read first, both fail
      // when these nodes stop caching). The gate is PER-ENGINE: a process-wide
      // one leaked across engines, so a single object anywhere stopped these
      // nodes caching everywhere, which is what made those two suites fail
      // merely for sharing a jest worker with an object-constructing suite.
      if (engine !== undefined && engineHasObjects(engine))
        _provisionalReads += 1;
      if (stats && CACHE_STATS) recordCache(stats.cls, 'declineCycle');
    } else if (stats && CACHE_STATS)
      recordCache(stats.cls, generation === undefined ? 'hitConstant' : 'hit');
    return cell.value;
  }

  // The cross-cell terminator. While a computation OF THIS ENTRY — either
  // cell — is on the stack, the two keys are compared on their axis half
  // only, and the twin cell's value answers a read whose own cell has none.
  // Without it a recursion that crosses a fact-suppression boundary has
  // nothing to bottom out on: before the entry had two cells, the value that
  // terminated such a recursion was simply the one value the entry held, and
  // splitting it in two must not take that away.
  //
  // It is answered only inside the window. Outside it the two sides are
  // separate answers and neither may stand in for the other. The answer
  // belongs to the other side of the window, so nothing built on it may be
  // committed: a fact-bearing value would be frozen into the suppressed cell,
  // or a fact-free one into the live cell, which is the cross-contamination
  // the two cells exist to prevent. This serve is therefore ALWAYS counted as
  // provisional, unlike the same-cell re-entrant serve above, which is counted
  // only when the engine has constructed a mutable object. The asymmetry is
  // sound: a cross-cell serve needs an odd generation on one side, so it can
  // only happen on an engine where assumptions are in force, and an engine
  // that never suppresses facts never reaches this branch at all. Its
  // recursion caching — which depends on the same-cell serve NOT being counted
  // — is untouched, while an assumption-bearing recursion that crosses a
  // suppression window still terminates on the twin value and simply freezes
  // nothing built from it.
  if (
    generation !== undefined &&
    (cell.inFlight || twin?.inFlight) &&
    twin !== undefined &&
    twin.value !== null &&
    twin.generation !== undefined &&
    twin.generation >> 1 === generation >> 1 &&
    objectDepsValid(twin.objectDeps)
  ) {
    mergeObjectDeps(twin.objectDeps);
    _provisionalReads += 1;
    if (stats && CACHE_STATS) recordCache(stats.cls, 'declineCycle');
    return twin.value;
  }

  let ev: CacheEvent | undefined = undefined;
  if (stats && CACHE_STATS) {
    if (cell.value === null) ev = 'missCold';
    else if (generation === undefined || cell.generation === undefined)
      ev = 'missKeyShape';
    else ev = 'missGeneration';
  }
  const prev = cell.value;

  // The key is stamped for the window, so that a re-entrant read is answered
  // from the cell's value rather than recursing (see the in-flight window
  // section above). `objectDeps` is NOT touched: it describes the value still
  // sitting in the cell, which is the value such a read is served, and
  // clearing it would advertise that value as depending on nothing.
  const provisionalBefore = _provisionalReads;
  const prevGeneration = cell.generation;
  cell.generation = generation;
  cell.inFlight = (cell.inFlight ?? 0) + 1;
  beginObjectDeps();
  let result: T;
  try {
    result = fn();
  } catch (e) {
    // A failed computation commits nothing: put the key back, so the next
    // call retries rather than serving a value from an older generation under
    // the new one.
    endObjectDeps();
    cell.inFlight -= 1;
    cell.generation = prevGeneration;
    throw e;
  }
  const deps = endObjectDeps();
  cell.inFlight -= 1;

  // The settled-only gate. A computation that consumed a provisional answer —
  // its own, or one handed to something it called — commits nothing: freezing
  // a value built on a stale in-flight answer is what made the previous shape
  // of this helper unsound, and the dependencies collected under it are
  // truncated by exactly the reads the provisional answer did not perform.
  //
  // "Commits nothing" means the cell goes back to exactly what it was found
  // as — the previous value, under the previous KEY. Restoring the key is the
  // load-bearing half: leaving the window's stamp on it while the old value
  // sits in the cell is precisely the "stale value under the new generation"
  // this gate is refusing to create. The value itself is kept rather than
  // emptied, because it is what the next re-entrant read has to be answered
  // with — a cycle is re-entered on every read, and discarding it would leave
  // two mutually recursive definitions each falling through to a fresh
  // computation of the other, forever. Keeping it is sound: a value that
  // stays is one an earlier, settled computation committed with its full
  // dependency set, and it is re-validated before it is ever served.
  if (_provisionalReads !== provisionalBefore) {
    cell.generation = prevGeneration;
    if (stats && CACHE_STATS) recordCache(stats.cls, 'declineStore');
    return result;
  }

  // A payload that transitively holds an object is never memoized (ruling
  // B12: a cache must not keep an object alive; ruling B3: the object's own
  // contents are not part of what the version stamps validate, so a later
  // hit could hand back contents nothing checked). The cell is left EMPTY
  // rather than stale.
  if (isExpression(result) && containsObject(result)) {
    cell.value = null;
    cell.generation = undefined;
    cell.objectDeps = undefined;
    if (stats && CACHE_STATS) recordCache(stats.cls, 'declineStore');
    return result;
  }

  cell.value = result;
  cell.generation = generation;
  cell.objectDeps = deps;
  // The reads this computation made belong to the ENCLOSING computations too,
  // and `recordObjectRead` already reported them outward while the collector
  // was open, so nothing more is needed for them here.
  if (stats && CACHE_STATS && ev !== undefined) {
    recordCache(stats.cls, ev);
    if (ev === 'missGeneration' && prev !== null && stats.same(prev, result))
      recordCache(stats.cls, 'missGenerationWasted');
  }
  return result;
}

/**
 * The async twin of {@link cachedValue}. **It records NO object-version
 * dependencies, and must not be used for a computation that can read a
 * mutable object's fields.**
 *
 * The reason is the collector protocol's shape: a collector brackets a
 * DYNAMIC EXTENT of the host call stack, and an `await` breaks that extent —
 * the frame suspends while unrelated work runs, so a collector left open would
 * either mis-attribute that work's reads or be popped by it. An async-safe
 * form (a collector handle threaded through the promise chain rather than a
 * stack) is deliberately not built in v1: this function currently has no
 * callers at all, so the exclusion costs nothing. A future caller whose
 * computation can reach a field read must record dependencies explicitly, the
 * way `BoxedFunction`'s async lazy-collection memo does.
 *
 * The other two rules do NOT depend on the collector and are applied here in
 * full: a payload that transitively contains an object is refused rather than
 * stored (rulings B12 and B3), and the entry is written only once the promise
 * has FULFILLED, so a rejection leaves the cache exactly as it found it
 * instead of leaving the new generation stamped over the old value.
 */
export async function cachedValueAsync<T>(
  v: CachedValue<T>,
  generation: number | undefined,
  fn: () => Promise<T>
): Promise<T> {
  // The same two cells, selected the same way — see the composite-generation
  // section of {@link cachedValue}.
  const cell = cachedCell(v, generation);
  if (
    cell.generation === generation &&
    cell.value !== null &&
    objectDepsValid(cell.objectDeps)
  ) {
    mergeObjectDeps(cell.objectDeps);
    return cell.value;
  }

  const result = await fn();

  // The same payload rule {@link cachedValue} applies: a value that
  // transitively holds an object is never memoized, and the cell is left
  // EMPTY rather than stale.
  if (isExpression(result) && containsObject(result)) {
    cell.value = null;
    cell.generation = undefined;
    cell.objectDeps = undefined;
    return result;
  }

  cell.value = result;
  cell.generation = generation;
  // An async call cannot safely use the stack-based dependency collector, so
  // this entry is constrained by its generation alone.
  cell.objectDeps = undefined;
  return result;
}
