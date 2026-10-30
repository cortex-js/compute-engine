import { cacheOff } from '../../common/cache-switches.js';
import type { Expression } from '../global-types.js';
import {
  beginObjectDeps,
  endObjectDeps,
  mergeObjectDeps,
  objectDepsValid,
  type ObjectDeps,
} from './object-deps.js';
import { beginStoreGuard } from './store-guard.js';
import { noteUncachedHostEvaluation } from './shared-evaluation-memo.js';
import { topLevelEvaluationEpoch } from './evaluation-epoch.js';

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
 * value is used at most once. A value is used only when no value write, no
 * global change (an assumption, a redefinition, a change of configuration)
 * and no store to the field of an object happened since it was computed;
 * otherwise the operand is evaluated again. A store to a field changes
 * neither version of the engine (only the version of the object and
 * `ce._objectStoreEpoch`), and a `Field` read is pure, so a value computed
 * from a field (`Map(f, o.xs - 1)`) must check the epoch too.
 *
 * The field reads that the evaluation of a source did are kept with its
 * value. When the value is used, they are reported to the computations that
 * collect object dependencies (`object-deps.ts`): the use reads no field, and
 * a cache of the enclosing computation would otherwise keep its value after a
 * store to the field. An asynchronous computation cannot collect these
 * dependencies: it counts the field reads instead (`objectReadCount()`), and
 * a use reads nothing. Thus a value computed from a field is not used while
 * an asynchronous evaluation is in progress on the engine.
 *
 * An `evaluateAsync()` of a view reads the finiteness in the same way, and
 * takes the values out of the shared store immediately after the read
 * (`detachEagerSourceValues()`), before its first `await`. Its operand step
 * uses them as the operand step of `evaluate()` does.
 *
 * A second store keeps the value of a PURE source for the rest of the
 * evaluations in progress on its engine (`keptEagerSourceValue()`). It covers
 * the two cases where the value is needed by an evaluation that is not the
 * operand step of the view:
 * - a consumer reads the finiteness of a view that it does not evaluate, and
 *   then iterates the view: `Sum(Join(src(1), [4]))` reads that the `Join`
 *   is finite, and the iterator of the `Join` evaluates `src(1)` again;
 * - the source is not an operand of the view, but an operand of an operand:
 *   in `Join(Sort(src(1)), [4])`, the read evaluates `src(1)` to know that
 *   `Sort(src(1))` is finite, and the operand step of the `Join` evaluates
 *   `Sort(src(1))`, which evaluates `src(1)` again.
 */

type Entry = {
  value: Expression;
  anyVersion: number;
  worldVersion: number;
  objectStoreEpoch: number;
  /** The field reads of the evaluation that computed `value`. */
  objectDeps: ObjectDeps | undefined;
  /** True when the evaluation that computed `value` ran host code that no
   * memo keeps a result across (`host-handler-changes.ts`). Each use of
   * the value counts that host code again (`entryValue()`). */
  hostCode?: boolean;
};

/** A new entry for `value`, the value of a source of the engine `ce`. */
function newEntry(
  ce: Expression['engine'],
  value: Expression,
  objectDeps: ObjectDeps | undefined
): Entry {
  return {
    value,
    anyVersion: ce._anyVersion,
    worldVersion: ce._worldVersion,
    objectStoreEpoch: ce._objectStoreEpoch,
    objectDeps,
  };
}

/**
 * The value of `entry`, or `undefined` when it cannot be used: a value write,
 * a global change or a store to the field of an object happened since it was
 * computed, or it was computed from a field while an asynchronous evaluation
 * is in progress. When the value is used, the field reads that computed it
 * are reported to the computations that collect object dependencies.
 */
function entryValue(
  ce: Expression['engine'],
  entry: Entry
): Expression | undefined {
  if (
    entry.anyVersion !== ce._anyVersion ||
    entry.worldVersion !== ce._worldVersion ||
    entry.objectStoreEpoch !== ce._objectStoreEpoch ||
    !objectDepsValid(entry.objectDeps)
  )
    return undefined;
  if (entry.objectDeps !== undefined) {
    if (ce._inFlightAsyncEvaluations > 0) return undefined;
    mergeObjectDeps(entry.objectDeps);
  }
  // A use of a value that host code computed runs no host code, so a memo
  // that encloses the use and sampled the count after the value was
  // computed would not see it: the host code is counted again.
  if (entry.hostCode === true) noteUncachedHostEvaluation(ce);
  return entry.value;
}

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

/** Evaluate the eager source `source`, and record its value when a
 * finiteness read that shares its values is in progress. The value of a pure
 * source is also kept for the evaluations in progress
 * (`keptEagerSourceValue()`). The field reads of the evaluation are recorded
 * with the value; they are also reported to the collectors that are open. */
export function evaluateEagerSource(source: Expression): Expression {
  beginObjectDeps();
  let value: Expression;
  let objectDeps: ObjectDeps | undefined;
  const guard = beginStoreGuard();
  try {
    value = source.evaluate();
  } finally {
    objectDeps = endObjectDeps();
  }
  // A value computed with host code that does not state its purity, or with
  // a host handler that changed state (`host-handler-changes.ts`), is kept
  // for the top-level evaluation that computed it only
  // (`keepEagerSourceValue()`), so that every consumer of the source in that
  // evaluation (the operand step of the view, a `Sum` that reads the
  // finiteness of the view and iterates it, an enclosing view) sees one
  // value and the host code runs once. Each use counts the host code again
  // (`entryValue()`), so that a memo around the use does not keep a result
  // that depends on it.
  //
  // The value is kept whatever the other counts of the store guard
  // (`store-guard.ts`) did: these values define a result (the host code runs
  // once in the evaluation), so changing when they are kept is a separate
  // change, with a test that counts the host calls. The entry lives for this
  // evaluation only, and each use counts the host code again, so a memo
  // around a use does not keep a result built on it. One memo accepts the
  // host count: the memo of
  // factorizations (`factor.ts`). That does not matter here: its only
  // evaluation is a `.N()` of a candidate root, and a kept value is served
  // only to a plain `evaluate()` (no numeric approximation), and the memo
  // keeps a factor only after an exact polynomial division confirms it.
  const hostCode = guard.moved('host');
  keepEagerSourceValue(source, value, objectDeps, hostCode);
  if (collecting !== undefined)
    collecting.set(source, {
      ...newEntry(source.engine, value, objectDeps),
      hostCode,
    });
  return value;
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
  return takeDetachedEagerSourceValue(shared.values, operand);
}

/** The values kept for one asynchronous evaluation of a view, which
 * {@link detachEagerSourceValues} removed from the shared store. */
export type EagerSourceValues = Map<Expression, Entry>;

/**
 * Remove the values that the last finiteness read kept for the evaluation of
 * `owner` from the shared store, and return them (`undefined` when there are
 * none).
 *
 * The asynchronous evaluation of a view uses this. Its finiteness read is
 * synchronous, but its operand step runs after one or more `await`s, and
 * other evaluations can run on the same engine in that interval. A value in
 * the shared store could then be replaced by the read of another evaluation,
 * or be used by another evaluation of the same view. The asynchronous
 * evaluation calls this function immediately after its read, before any
 * `await`, and gives the returned values to its operand step
 * ({@link takeDetachedEagerSourceValue}). Thus the shared store keeps no
 * value after the read, also when the evaluation later throws or is
 * cancelled.
 */
export function detachEagerSourceValues(
  owner: Expression
): EagerSourceValues | undefined {
  if (shared === undefined || shared.owner !== owner) return undefined;
  const values = shared.values;
  shared = undefined;
  return values;
}

/**
 * The value of `operand` in `values`, or `undefined`. A value is returned
 * once only, and only when it can be used (`entryValue()`).
 */
export function takeDetachedEagerSourceValue(
  values: EagerSourceValues | undefined,
  operand: Expression
): Expression | undefined {
  if (values === undefined || cacheOff('eagersource')) return undefined;
  const entry = values.get(operand);
  if (entry === undefined) return undefined;
  values.delete(operand);
  return entryValue(operand.engine, entry);
}

/** Discard the values kept for the evaluation of `owner`, which has ended. */
export function releaseEagerSourceValues(owner: Expression): void {
  if (shared !== undefined && shared.owner === owner) shared = undefined;
}

/**
 * The state that the value of a pure expression can depend on, other than the
 * expression: the value writes and the global changes (the two versions), the
 * stores to the fields of objects (the epoch), the scope where the names of
 * the expression are looked up, the assumptions that are hidden or not, and
 * the precision.
 */
type KeptEntry = Entry & {
  scope: unknown;
  factsHidden: boolean;
  precision: number;
  /** For a value that host code computed: the number of the top-level
   * evaluation that computed it (`topLevelEvaluationEpoch()`). The value is
   * used in that evaluation only. */
  epoch?: number;
};

/** The values of pure eager sources kept by `keepEagerSourceValue()`, for
 * each engine. The map of an engine is discarded when the engine has no
 * evaluation in progress any more. */
const keptByEngine = new WeakMap<object, Map<Expression, KeptEntry>>();

/** The number of values in all the maps of `keptByEngine`, so that the
 * evaluation of an expression does not look up a map when no value is kept.
 * The values of an engine that is garbage collected during an evaluation are
 * not subtracted: the count is then too large, and the look-up is done. */
let keptCount = 0;

/** The most values the map of one engine holds. When it is full, the value
 * that was kept the longest time ago is discarded. An engine that always has
 * an asynchronous evaluation in progress never discards its values
 * otherwise. */
const MAX_KEPT_VALUES = 64;

function evaluationInProgress(ce: Expression['engine']): boolean {
  return ce._evaluationDepth > 0 || ce._inFlightAsyncEvaluations > 0;
}

/**
 * Keep the value of the pure eager source `source`, which a finiteness read
 * evaluated, for the evaluations in progress on its engine.
 *
 * Only a pure source whose value is a collection is kept, and only while an
 * evaluation (`evaluate()` or `evaluateAsync()`) is in progress: the values
 * are discarded when the engine has no evaluation in progress any more
 * (`releaseKeptEagerSourceValues()`). A pure expression has the same value
 * each time it is evaluated in the same state, so the value is used for each
 * plain evaluation of the same expression, as long as the state that is
 * recorded with it (`KeptEntry`) did not change. A value write (also the
 * value of the index of a `Sum` that advances) changes that state.
 */
function keepEagerSourceValue(
  source: Expression,
  value: Expression,
  objectDeps: ObjectDeps | undefined,
  hostCode: boolean
): void {
  const ce = source.engine;
  if (!evaluationInProgress(ce)) return;
  if (!value.isCollection || !source.isPure) return;
  const epoch = hostCode ? topLevelEvaluationEpoch(ce) : undefined;
  let kept: Map<Expression, KeptEntry> | undefined;
  if (epoch === undefined) {
    kept = keptByEngine.get(ce);
    if (kept === undefined) {
      kept = new Map();
      keptByEngine.set(ce, kept);
    }
  } else {
    let byEpoch = hostKeptByEngine.get(ce);
    if (byEpoch === undefined) {
      byEpoch = new Map();
      hostKeptByEngine.set(ce, byEpoch);
    }
    kept = byEpoch.get(epoch);
    if (kept === undefined) {
      kept = new Map();
      byEpoch.set(epoch, kept);
    }
  }
  const size = kept.size;
  // A source that is kept again (each iteration of a loop) is removed
  // first, so that it is the newest value of the map and not the oldest.
  if (!kept.delete(source) && kept.size >= MAX_KEPT_VALUES)
    kept.delete(kept.keys().next().value!);
  kept.set(source, {
    ...newEntry(ce, value, objectDeps),
    scope: ce.context?.lexicalScope,
    factsHidden: ce._factsHidden(),
    precision: ce.precision,
    ...(epoch !== undefined ? { hostCode: true, epoch } : {}),
  });
  keptCount += kept.size - size;
}

/** The values of eager sources that host code computed
 * (`host-handler-changes.ts`), for each engine, then for each top-level
 * evaluation (`topLevelEvaluationEpoch()`): a value is used only in the
 * evaluation that computed it, also when two asynchronous evaluations run
 * at the same time. The values of an evaluation are discarded when it ends
 * (`releaseHostEagerSourceValues()`). */
const hostKeptByEngine = new WeakMap<
  object,
  Map<number, Map<Expression, KeptEntry>>
>();

/**
 * The value of `expr` kept by a finiteness read during the evaluations in
 * progress, or `undefined`. The caller uses it in place of a plain
 * evaluation of `expr` (no numeric approximation, no materialization).
 */
export function keptEagerSourceValue(expr: Expression): Expression | undefined {
  if (keptCount === 0 || cacheOff('eagersource')) return undefined;
  const ce = expr.engine;
  // Each store is tried in turn: an ordinary entry that is out of date must
  // not hide a valid entry that host code computed for the same source in
  // this evaluation.
  return (
    keptEntryValue(ce, keptByEngine.get(ce)?.get(expr)) ??
    keptEntryValue(
      ce,
      hostKeptByEngine.get(ce)?.get(topLevelEvaluationEpoch(ce))?.get(expr)
    )
  );
}

/** The value of `entry`, or `undefined` when there is no entry or it
 * cannot be used in the current scope, assumptions and precision, or when
 * `entryValue()` refuses it. */
function keptEntryValue(
  ce: Expression['engine'],
  entry: KeptEntry | undefined
): Expression | undefined {
  if (entry === undefined) return undefined;
  if (
    entry.scope !== ce.context?.lexicalScope ||
    entry.factsHidden !== ce._factsHidden() ||
    entry.precision !== ce.precision
  )
    return undefined;
  return entryValue(ce, entry);
}

/** Discard the values that host code computed for the top-level evaluation
 * `epoch` of `ce`, which has ended. */
export function releaseHostEagerSourceValues(
  ce: Expression['engine'],
  epoch: number
): void {
  if (keptCount === 0) return;
  const byEpoch = hostKeptByEngine.get(ce);
  const kept = byEpoch?.get(epoch);
  if (kept === undefined) return;
  keptCount -= kept.size;
  byEpoch!.delete(epoch);
}

/** Discard the values kept for the evaluations of `ce`, when `ce` has no
 * evaluation in progress any more. */
export function releaseKeptEagerSourceValues(ce: Expression['engine']): void {
  if (keptCount === 0 || evaluationInProgress(ce)) return;
  const kept = keptByEngine.get(ce);
  if (kept !== undefined) {
    keptCount -= kept.size;
    keptByEngine.delete(ce);
  }
  const byEpoch = hostKeptByEngine.get(ce);
  if (byEpoch !== undefined) {
    for (const values of byEpoch.values()) keptCount -= values.size;
    hostKeptByEngine.delete(ce);
  }
}
