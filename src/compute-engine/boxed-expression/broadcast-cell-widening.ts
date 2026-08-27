/**
 * Withhold a number literal's literal type while the interpreter computes a
 * broadcast cell.
 *
 * A number literal's public type carries its value (`0.5`,
 * `finite_rational<0.5..0.5>`) rather than its tier (`finite_real`). That
 * precision is what a reader of an expression wants. An element-wise
 * broadcast, however, asks type questions once per cell, and the answers are
 * used only to decide how to evaluate that cell — no caller ever inspects
 * them. Deriving and comparing the precise type each time is therefore work
 * with no reader.
 *
 * While a cell is being computed, a number literal reports its bare TIER
 * instead. Two rules keep that invisible from outside:
 *
 * - The window is open only for the duration of one cell's computation. Once
 *   the cell's value is handed back, a `.type` read on it answers with the
 *   full precision again.
 * - A type read inside the window is never MEMOIZED (`BoxedNumber.type`
 *   returns the tier without recording it). Otherwise whether the interpreter
 *   happened to ask first would change what a later reader sees.
 *
 * Consequently the window may only ever be opened around a read whose answer
 * is discarded, or around one whose result is not cached. A read that
 * computes and caches a COMPOSITE type — a tuple's or a list's — must stay
 * outside it: those memos are not covered by the rule above, and a widened
 * component type would survive the window.
 *
 * Types that a type HANDLER sees are also deliberately outside the window.
 * Handlers consume literal operand types on purpose — that is how a result
 * type gets its range or its sign — so widening them would change the types
 * the engine stores, not merely the cost of computing them.
 *
 * The state is per engine: a handler running for one engine may synchronously
 * touch another engine's literals, and must not widen them. It is a counter
 * rather than a flag because a nested broadcast opens the window again inside
 * an outer one.
 *
 * This module deliberately imports nothing — it is reached from both the
 * literal type getter and the collection iterators, which sit on opposite
 * sides of the boxed-expression/library layering. The engine is therefore
 * typed as a bare `object` key.
 *
 * The behavior is pinned by `test/compute-engine/broadcast-cell-widening.test.ts`.
 */

const depths = new WeakMap<object, number>();

/** Open a broadcast-cell window. Pair with `endBroadcastCell` in a `finally`. */
export function beginBroadcastCell(engine: object): void {
  depths.set(engine, (depths.get(engine) ?? 0) + 1);
}

/** Close a broadcast-cell window opened by `beginBroadcastCell`. */
export function endBroadcastCell(engine: object): void {
  const d = (depths.get(engine) ?? 0) - 1;
  if (d > 0) depths.set(engine, d);
  else depths.delete(engine);
}

/** Is a broadcast cell of `engine` being computed right now? */
export function inBroadcastCell(engine: object): boolean {
  return (depths.get(engine) ?? 0) > 0;
}

/**
 * Compute one broadcast cell, with the window open for its duration.
 *
 * Shared by the routes that produce a cell — the drain iterator and indexed
 * access — so both observe the same types; serving one of them widened and
 * the other precise would make an element's type depend on how it was
 * reached. The window is closed on the way out whether `fn` returns or
 * throws, so a handler that throws mid-cell cannot leave it open.
 */
export function computeBroadcastCell<T>(engine: object, fn: () => T): T {
  beginBroadcastCell(engine);
  try {
    return fn();
  } finally {
    endBroadcastCell(engine);
  }
}

/**
 * Run `fn` with the window fully closed, then restore it.
 *
 * The window covers the type questions the interpreter asks itself. A type
 * that will be shown to a person is a different kind of read: a diagnostic
 * naming the offending value ("expected integer, got 2.5") must name the
 * value, not the tier it belongs to, even when the check that produced it ran
 * inside a cell.
 */
export function withoutBroadcastCellWidening<T>(
  engine: object,
  fn: () => T
): T {
  const saved = depths.get(engine);
  depths.delete(engine);
  try {
    return fn();
  } finally {
    if (saved !== undefined) depths.set(engine, saved);
  }
}
