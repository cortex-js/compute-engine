import type { Expression } from '../global-types.js';

/**
 * The values of eager sources that a finiteness read of a lazy collection
 * view evaluated, kept so that the operand step of the SAME evaluation of the
 * view uses them instead of evaluating the sources a second time.
 *
 * A view over an eager operand (`Join(src(1), [4])`, where `src(1)` is a call
 * that returns a list) does not know that it is finite until the operand is
 * evaluated: an eager operator has no collection handlers before it is
 * evaluated. A plain `evaluate()` of a view with an element memo reads that
 * finiteness first (`_isMemoizableLazyCollection()` in `boxed-function.ts`),
 * and the read evaluates the operand (`mapSource()` in
 * `library/collections.ts`). The operand step of the evaluation then
 * evaluated the operand again, so `src` was called twice. Reading the
 * finiteness from the static type of the operand instead is not correct: a
 * symbolic `Sort(xs)` has a `list` type and no value, and a consumer such as
 * `Sum` would walk it as an empty collection.
 *
 * The values are kept for ONE evaluation of ONE view (the owner), and each
 * value is used at most once. A value is used only when no value write and no
 * global change (an assumption, a redefinition, a change of configuration)
 * happened since it was computed; otherwise the operand is evaluated again.
 */

type Entry = { value: Expression; anyVersion: number; worldVersion: number };

/** The values that the finiteness read in progress records, or `undefined`
 * when no such read is in progress. */
let collecting: Map<Expression, Entry> | undefined;

/** The values recorded by the last finiteness read, and the view whose
 * evaluation can use them. */
let shared: { owner: Expression; values: Map<Expression, Entry> } | undefined;

/**
 * Run `read` (a finiteness read of the view `owner`) and keep the values of
 * the sources that it evaluated for the operand step of the evaluation of
 * `owner` that is in progress.
 */
export function readSharingEagerSourceValues<T>(
  owner: Expression,
  read: () => T
): T {
  const saved = collecting;
  const values = new Map<Expression, Entry>();
  collecting = values;
  try {
    return read();
  } finally {
    collecting = saved;
    if (values.size > 0) shared = { owner, values };
  }
}

/** Record that `source` evaluated to `value`, when a finiteness read that
 * shares its values is in progress. */
export function noteEagerSourceValue(
  source: Expression,
  value: Expression
): void {
  if (collecting === undefined) return;
  const ce = source.engine;
  collecting.set(source, {
    value,
    anyVersion: ce._anyVersion,
    worldVersion: ce._worldVersion,
  });
}

/**
 * The value of the operand `operand` of `owner` that the finiteness read of
 * the current evaluation of `owner` computed, or `undefined`. A value is
 * returned once only.
 */
export function takeEagerSourceValue(
  owner: Expression,
  operand: Expression
): Expression | undefined {
  if (shared === undefined || shared.owner !== owner) return undefined;
  const entry = shared.values.get(operand);
  if (entry === undefined) return undefined;
  shared.values.delete(operand);
  const ce = operand.engine;
  if (
    entry.anyVersion !== ce._anyVersion ||
    entry.worldVersion !== ce._worldVersion
  )
    return undefined;
  return entry.value;
}

/** Discard the values kept for the evaluation of `owner`, which has ended. */
export function releaseEagerSourceValues(owner: Expression): void {
  if (shared !== undefined && shared.owner === owner) shared = undefined;
}
