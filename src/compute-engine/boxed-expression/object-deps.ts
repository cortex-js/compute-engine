/**
 * The **per-object version dependency channel**: how a cache entry remembers
 * which mutable objects its value was derived from, and how it finds out that
 * one of them has changed.
 *
 * An object's fields can change in place, but a field READ is a pure load —
 * stores write already-evaluated values, so reading one runs no code and
 * evaluates nothing. That is what makes the object's version counter a
 * SUFFICIENT dependency: a cached result that read `p.age` is valid exactly
 * while `p._version` is still what it was at read time. Nothing else about
 * `p` needs recording, and stores to unrelated objects invalidate nothing.
 * (Spec: `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "A store writes the
 * evaluated value" and "Changing a field is an effect".)
 *
 * ## The collector protocol
 *
 * Collection is **stack-scoped**, not a single ambient slot. Every
 * cache-backed computation that can read fields pushes a collector for its
 * dynamic extent, and every field read reports to EVERY collector on the
 * stack, not just the innermost one: an outer entry's dependency set must
 * include everything its callees read, or the outer entry outlives the inner
 * one's invalidation.
 *
 * A cache **hit** performs no reads at all, so the hit path has to put back
 * what the computation would have collected: {@link mergeObjectDeps} folds the
 * hit entry's own (already validated) dependencies into every enclosing
 * collector. Without that step an outer computation that hits an inner entry
 * commits with an empty dependency set and then serves stale data after a
 * store — the one hole this protocol exists to close, and the reason each
 * wired cache family carries a nested hit → store → re-hit test.
 *
 * A computation that does not settle — a cycle-guard fail-closed answer, a
 * rollback-frame abort, a thrown evaluation — commits neither its value nor
 * its dependencies: the collector is popped and discarded, mirroring the
 * refusal the lazy-collection memo already applies to cycle-tainted results.
 *
 * ## Entry representation
 *
 * `Array<[WeakRef<ObjectInterface>, number]>` — the object read, and its
 * version at read time. The reference is **weak** because a dependency edge
 * must not keep an object alive (ruling B12: "the engine must not secretly
 * keep objects alive"); a reference that has since been collected invalidates
 * the entry conservatively, since there is no longer any way to check its
 * version. Duplicate reads of one object coalesce to the LOWEST version seen
 * (equivalently: first read wins — any later bump already invalidates).
 *
 * The dependency edge is only half of B12/B3. The other half is a payload
 * rule enforced at each cache's commit point rather than here: **a cache
 * payload that transitively contains an object is not memoized at all**
 * (`containsObject()` in `object-walk.ts`), because a weak dependency edge
 * says nothing about a cached VALUE that itself holds the object strongly.
 *
 * ## The cache inventory (ruling B3)
 *
 * The acceptance criterion for objects is an invariant over EVERY cache, not
 * over the ones that happened to come to mind: *no cache serves a value
 * derived from an object field without validating that object's version.*
 *
 * A field store reports an `object-store` state event, and that event advances
 * no engine axis — not `any`, not `semantic`, not `world`, not `callable`
 * (ruled 2026-08-15; the `object-store` row of `axisMaskOf` in
 * `engine-configuration-lifecycle.ts` carries the argument, and
 * `docs/plans/2026-08-14-object-representation-decision.md` the fork it
 * settles). So a cache that only checks a generation is blind to mutation by
 * construction, and "we forgot one" is indistinguishable from "the engine
 * returns stale answers". Widening the mask would not have rescued a forgotten
 * family either: an object is `isConstant`, so a field-reading node takes a
 * generation-INDEPENDENT cache key that no axis bump reaches. This channel is
 * load-bearing, not a refinement.
 *
 * The disposition of each family is recorded at its own site; this is the
 * index. Each wired family carries an adversarial evaluate → store →
 * re-evaluate test (`test/compute-engine/object-caching.test.ts`), which is the
 * inventory's only empirical proof; `CE_OBJECT_STORE_BUMPS_ANY` makes every
 * store advance `any` so that a suspected staleness bug in the field can be
 * bisected to a missing family in one run.
 *
 * RECORDING DEPENDENCIES (they can be object-derived, and they validate):
 * - `cachedValue()` (`cache.ts`) and therefore every slot that goes through
 *   it: `BoxedFunction._sgn`, `._type` (including its bypassing fast path,
 *   which repeats the two duties inline), `._eagerSource`.
 * - The lazy-collection evaluate memo, `BoxedFunction._value`.
 * - The collection element memo (`collection-element-memo.ts`) and the
 *   collection-facet memo (`BoxedFunction._facetMemo`).
 *
 * EXCLUDED, each for a stated reason:
 * - `BoxedFunction._effects` and the operator-definition/dispatcher effect
 *   derivers: effects are derived from declarations and bodies without
 *   evaluating anything, so they cannot reach a field read.
 * - Simplify has no cache at all; the rule caches (`rules.ts`,
 *   `rule-index.ts`) and the match plan cache (`match-dispatch.ts`) hold
 *   structural classifications, never evaluated values.
 * - Serialization and display memoize nothing for objects, by construction —
 *   `.json`, `toString` and AsciiMath each walk the live slots afresh, because
 *   a frozen serialization of a mutable value goes stale at the next store.
 * - Compiled artifacts (`map-auto-compile.ts`, and the compiled probes
 *   elsewhere): objects have no compiled representation, so a body that reads
 *   or constructs one fails to compile and no artifact exists to cache.
 * - `EngineCacheStore` (`engine-cache.ts`), the one engine-global strong
 *   retainer: nothing routed through it is ever built from a user value.
 * - `cachedValueAsync()`: no callers, and an `await` breaks the collector's
 *   extent — see its own note. `BoxedFunction`'s async lazy-collection memo
 *   has the same problem and solves it by sampling {@link objectReadCount}
 *   and refusing to store if any field was read while it ran.
 *
 * @module
 */

import type { ObjectInterface } from '../global-types.js';

/** One recorded read: the object, held weakly, and its version at read time. */
export type ObjectDep = [WeakRef<ObjectInterface>, number];

/** The dependency set of one cache entry. An entry with no object reads
 * carries `undefined` rather than an empty array, so the overwhelmingly
 * common case costs one property and no allocation. */
export type ObjectDeps = ObjectDep[];

/**
 * The collector stack — outermost first. Module-level rather than
 * engine-level on purpose: the stack tracks a DYNAMIC EXTENT of the host call
 * stack, which is per-process, and an evaluation nested inside another
 * engine's evaluation must still report outward. Entries are plain arrays of
 * weak references, so the stack retains nothing between computations (it is
 * empty whenever no cache-backed computation is running).
 */
const _collectors: ObjectDeps[] = [];

/**
 * How many field reads have happened in this process, ever. Monotonic, and
 * only ever compared before/after a computation — the same shape as
 * `cycleDetectionCount()` in `cycle-guard.ts`, and used for the same purpose:
 * a computation that CANNOT bracket a collector around itself (an `async` one,
 * whose extent is broken by every `await`) samples this counter instead and
 * refuses to cache its result if it moved. That is fail-closed — an unrelated
 * interleaved read also suppresses the entry — never a wrong entry.
 */
let _objectReads = 0;

/** See {@link _objectReads}. */
export function objectReadCount(): number {
  return _objectReads;
}

/**
 * Has any object been constructed in this process at all?
 *
 * The payload rule ("a cache payload that transitively contains an object is
 * not memoized") is enforced with a structural walk of the payload at every
 * cache commit point, and that walk is O(size of the payload) — a memoized
 * 10,000-element collection would be re-walked on every fill. In a session
 * that has never constructed an object the answer is `false` by construction,
 * so this flag turns the whole walk into one boolean check for the
 * overwhelming majority of workloads. It is process-wide and one-way: it never
 * goes back to `false`, so it can never mask a real containment.
 */
let _objectsExist = false;

/** The engines that have constructed at least one object. Per-ENGINE, unlike
 * {@link _objectsExist}, and the two are not interchangeable:
 *
 * - {@link anyObjectExists} gates pure OPTIMIZATIONS (skipping a containment
 *   walk, skipping a foreign-engine scan). Being process-wide only makes
 *   those conservative once any object exists anywhere — never wrong.
 * - {@link engineHasObjects} gates a BEHAVIOUR: `cachedValue`'s refusal to
 *   commit a computation that consumed a provisional re-entrant answer.
 *   Process-wide leakage there is a real defect, not conservatism: one
 *   object built in one engine permanently stopped re-entrant nodes from
 *   caching in EVERY engine in the process, including engines that never
 *   see an object. Found 2026-08-14 by bisecting an intermittent numeric
 *   disagreement in `definition-order.test.ts` down to "shares a jest
 *   worker with a suite that constructs an object"; the same leak degrades
 *   a real session permanently after its first object.
 *
 * A `WeakSet` so an engine is not retained by this module (ruling B12). */
const _enginesWithObjects = new WeakSet<object>();

/** Called once per constructed object, from `BoxedObject`'s constructor. */
export function noteObjectConstructed(engine: object): void {
  _objectsExist = true;
  _enginesWithObjects.add(engine);
}

/** See {@link _objectsExist} — process-wide, for optimization gates only. */
export function anyObjectExists(): boolean {
  return _objectsExist;
}

/** Has THIS engine ever constructed an object? The gate for anything whose
 * behaviour (not merely its cost) depends on objects being in play. */
export function engineHasObjects(engine: object): boolean {
  return _enginesWithObjects.has(engine);
}

/** Open a collector for the computation that is about to run. Every caller
 * MUST pair this with exactly one {@link endObjectDeps}, in a `finally`. */
export function beginObjectDeps(): void {
  _collectors.push([]);
}

/**
 * Close the innermost collector and return what it gathered, or `undefined`
 * when nothing was read. A caller that is ABORTING (the computation did not
 * settle) calls this too and simply discards the result — the pop is what
 * matters, and discarding is how "a provisional or failed computation commits
 * no dependencies" is spelled.
 */
export function endObjectDeps(): ObjectDeps | undefined {
  const deps = _collectors.pop();
  return deps === undefined || deps.length === 0 ? undefined : deps;
}

/**
 * Report a field read of `obj`, whose version was `version` at the moment of
 * the read, to every collector currently open.
 *
 * This is called from `BoxedObject._field()`, the engine's hottest object
 * path, so the no-collector case — no cache-backed computation is running, by
 * far the common case — is one counter increment and a single length check,
 * with no allocation and no iteration.
 */
export function recordObjectRead(obj: ObjectInterface, version: number): void {
  _objectReads += 1;
  if (_collectors.length === 0) return;
  for (const deps of _collectors) addDep(deps, obj, version);
}

/**
 * Fold the dependencies of a cache entry that was just SERVED into every
 * enclosing collector.
 *
 * A hit reads nothing, so without this the enclosing computation would commit
 * as if the hit value had no dependencies, and would keep serving it after a
 * store invalidated the entry it came from. Callers must validate the entry
 * (see {@link objectDepsValid}) before serving it and before merging.
 */
export function mergeObjectDeps(deps: ObjectDeps | undefined): void {
  if (deps === undefined || _collectors.length === 0) return;
  for (const [ref, version] of deps) {
    const obj = ref.deref();
    if (obj === undefined) {
      // A dead reference cannot be matched against anything, so it is pushed
      // through verbatim: it must go on invalidating every entry that
      // inherits it, exactly as it invalidates the entry it came from.
      for (const c of _collectors) c.push([ref, version]);
      continue;
    }
    for (const c of _collectors) addDep(c, obj, version);
  }
}

/**
 * Fold `more` into `into`, coalescing repeats the same way a collector does,
 * and return the combined set (`undefined` when both sides are empty).
 *
 * For a computation whose extent is CHOPPED INTO PIECES — a generator that
 * yields between element pulls, so that a single collector cannot span it —
 * one collector is opened per piece and the pieces are accumulated here. The
 * pieces belong to one cache entry, so the union is exactly the entry's
 * dependency set.
 */
export function accumulateObjectDeps(
  into: ObjectDeps | undefined,
  more: ObjectDeps | undefined
): ObjectDeps | undefined {
  if (more === undefined) return into;
  if (into === undefined) return more;
  for (const [ref, version] of more) {
    const obj = ref.deref();
    if (obj === undefined) into.push([ref, version]);
    else addDep(into, obj, version);
  }
  return into;
}

/**
 * Is a cache entry with these dependencies still valid?
 *
 * Every recorded reference must still deref AND still carry the version that
 * was stamped. A reference that has been collected fails conservatively: the
 * object is gone, so its version cannot be compared, and the safe answer is
 * "recompute". An entry with no dependencies (`undefined`) is unconstrained by
 * this channel and answers `true` — its own generation guard still applies.
 */
export function objectDepsValid(deps: ObjectDeps | undefined): boolean {
  if (deps === undefined) return true;
  for (const [ref, version] of deps) {
    const obj = ref.deref();
    if (obj === undefined) return false;
    if (obj._version !== version) return false;
  }
  return true;
}

/** How many collectors are currently open. Test observability for the
 * push/pop pairing (a leaked collector would silently over-attribute every
 * later computation's reads); not used by the engine itself.
 * @internal */
export function objectDepCollectorDepth(): number {
  return _collectors.length;
}

/** Add one `(object, version)` read to a single collector, coalescing a
 * repeat read of the same object to the LOWEST version seen. Collectors hold
 * a handful of entries at most, so the linear scan beats a map. */
function addDep(deps: ObjectDeps, obj: ObjectInterface, version: number): void {
  for (const dep of deps) {
    if (dep[0].deref() === obj) {
      if (version < dep[1]) dep[1] = version;
      return;
    }
  }
  deps.push([new WeakRef(obj), version]);
}
