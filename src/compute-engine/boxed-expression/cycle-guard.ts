/**
 * Guard against **indirect** reference cycles between symbol values.
 *
 * A pair of bindings such as `a := b` with `b := a` is individually
 * well-formed: the static `isSelfReferential` check on each value sees no
 * self-mention, and the degenerate `a := a` check does not fire either. Only
 * the *pair* is cyclic. Any query that resolves a symbol's value and delegates
 * to it (`isFiniteCollection`, `count`, `at`, `N()`, `sgn`, …) would then
 * recurse forever and blow the stack with a `RangeError`.
 *
 * A function expression is a finite tree and cannot refer back to itself, so
 * every such cycle must traverse at least one symbol. Guarding the value
 * delegation in `BoxedSymbol` — plus `same()` in `compare.ts`, which follows
 * symbol bindings itself — is therefore complete for this class of cycle.
 *
 * A guarded query **fails closed**: it returns `false`/`undefined`/no value,
 * whatever means "cannot determine" for that getter. It never throws, and a
 * cycle is never silently resolved to a value.
 *
 * ## Keying
 *
 * The guard is keyed on (binding, query **kind**), never on the binding alone:
 * queries legitimately nest on the same symbol — `at()` consults its own
 * `isFiniteCollection` and `count` to normalize a negative index. Keying on
 * the kind as well keeps those nestings legal. This is sound because a cycle
 * repeats *identically*, so it must revisit some (binding, kind) pair.
 *
 * For `at` and `isSame`/`same` even a per-kind boolean is too strict: nested
 * access or nested comparison of one and the same collection is ordinary.
 * Those use a depth limit instead.
 *
 * `each` is a flag despite belonging to that family, because its guard spans
 * only the synchronous body of `each()` — where the delegation happens — and
 * is released before the returned generator is consumed, so a legitimate
 * nested enumeration never holds it. Under a depth limit the cycle instead
 * unwound `MAX_CYCLE_DEPTH` times before failing, so `a := Append(b, 1)` with
 * `b := a` materialized 32 invented elements. As a flag it yields `[1, 1]`,
 * matching what the DIRECT self-reference `d := Append(d, 1)` has always
 * produced (`[1]`, one hop shorter) rather than inventing a length.
 *
 * ## Allocation
 *
 * These getters are hot and are on the memory budget of
 * `test/compute-engine/compile-performance.test.ts`. All bookkeeping lives in
 * module-level structures created once: nothing is allocated per query, and
 * entries are removed as each query unwinds (always from a `finally`, so an
 * interrupted evaluation cannot leave a binding poisoned).
 */

/**
 * Single-entry query kinds. Each is one bit of a per-binding bitmask, so
 * entering and leaving a guarded query is a single map operation.
 */
export const CycleQuery = {
  IsCollection: 1 << 0,
  IsIndexedCollection: 1 << 1,
  IsLazyCollection: 1 << 2,
  IsEmptyCollection: 1 << 3,
  IsFiniteCollection: 1 << 4,
  Count: 1 << 5,
  Contains: 1 << 6,
  IndexWhere: 1 << 7,
  SubsetOf: 1 << 8,
  Get: 1 << 9,
  N: 1 << 10,
  Sgn: 1 << 11,
  IsFinite: 1 << 12,
  IsNaN: 1 << 13,
  IsInfinity: 1 << 14,
  IsOdd: 1 << 15,
  IsEven: 1 << 16,
  Re: 1 << 17,
  Im: 1 << 18,
  BignumRe: 1 << 19,
  BignumIm: 1 << 20,
  Is: 1 << 21,
  Each: 1 << 22,
} as const;

/** A bitmask of the query kinds currently in progress for a binding. */
const _active = new Map<object, number>();

/**
 * Begin a guarded query of kind `kind` on `key` (the binding's definition).
 *
 * Returns `CYCLE_DETECTED` (a negative value) if a query of the same kind on
 * the same binding is already in progress — i.e. a reference cycle. The caller
 * must then fail closed and must NOT call `exitCycleQuery()`.
 *
 * Otherwise returns the state to hand back to `exitCycleQuery()` from a
 * `finally`. (Returning it, rather than having the exit re-read it, keeps the
 * guard down to three map operations per query.)
 */
export function enterCycleQuery(key: object, kind: number): number {
  const flags = _active.get(key) ?? 0;
  if ((flags & kind) !== 0) return CYCLE_DETECTED;
  _active.set(key, flags | kind);
  return flags;
}

/**
 * End a guarded query started by a successful `enterCycleQuery()`; `restore`
 * is the value it returned.
 */
export function exitCycleQuery(key: object, restore: number): void {
  if (restore === 0) _active.delete(key);
  else _active.set(key, restore);
}

/** Returned by the `enter…` functions when the query is already in progress. */
export const CYCLE_DETECTED = -1;

/**
 * Re-entrant query kinds, tracked by depth rather than by a flag: nesting the
 * same query on the same binding is legitimate, unbounded nesting is not.
 */
export const CycleDepthQuery = {
  At: 0,
  IsSame: 1,
  Same: 2,
} as const;

/**
 * How deep the same query may nest on the same binding before it is treated as
 * a cycle. Deep enough that no legitimate nesting reaches it, shallow enough
 * that the stack never gets close to overflowing.
 */
const MAX_CYCLE_DEPTH = 32;

const _depths: Map<object, number>[] = [new Map(), new Map(), new Map()];

/**
 * Begin a re-entrant guarded query. Returns `CYCLE_DETECTED` once the same
 * query nests more than `MAX_CYCLE_DEPTH` times on the same binding; the
 * caller must then fail closed and must NOT call `exitCycleDepthQuery()`.
 *
 * Otherwise returns the state to hand back to `exitCycleDepthQuery()`.
 */
export function enterCycleDepthQuery(key: object, kind: number): number {
  const depths = _depths[kind];
  const depth = depths.get(key) ?? 0;
  if (depth >= MAX_CYCLE_DEPTH) return CYCLE_DETECTED;
  depths.set(key, depth + 1);
  return depth;
}

/**
 * End a query started by a successful `enterCycleDepthQuery()`; `restore` is
 * the value it returned.
 */
export function exitCycleDepthQuery(
  key: object,
  kind: number,
  restore: number
): void {
  if (restore === 0) _depths[kind].delete(key);
  else _depths[kind].set(key, restore);
}
