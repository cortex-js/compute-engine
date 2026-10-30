/**
 * The memo of the evaluations of shared nodes, for one top-level evaluation.
 *
 * An expression can use one node object at several places: `Max(t, t)`
 * nested 30 deep, built with `ce.function()`, has 31 distinct nodes and 2^30
 * paths from the root to its leaf. Without a memo, `evaluate()` evaluates a
 * shared node once per path, so its time is exponential in the depth. With
 * the memo, a node that was evaluated before in the same top-level
 * evaluation, in the same evaluation frame and with no change of state
 * since, gives the value it gave before (ROADMAP CE-601).
 *
 * The memo keeps a result only for a node whose effects are pure
 * (`isPure`). A node with an effect (`random`, `scope`, `state`, `console`,
 * `time`, …) is evaluated at each occurrence: `Max(r, r)` with one shared
 * node `r = Random()` draws two numbers.
 *
 * A remembered result is used again only when all of these are the same as
 * when it was stored:
 *
 * - the evaluation frame (`engine.context`, the top of the context stack).
 *   A symbol reads the innermost binding of its name in the scope chain of
 *   the frame, and the frames below it on the stack (`bindingInContext`,
 *   `binders.ts`). Each push of a frame makes a new frame object, and the
 *   frames below the top do not change while it is on the stack. So the body
 *   of a recursive call `r(n - 1)`, evaluated in the new frame of the call,
 *   does not use the results of the caller's frame, where `n` has another
 *   value.
 * - the request: an exact evaluation and a numeric approximation (`.N()`)
 *   have separate memos.
 * - the engine's evaluation version (`IComputeEngine._evaluationVersion`):
 *   every value write (the index of a `Sum` or of a loop included, and an
 *   assignment that host code makes from a handler), redefinition, retype,
 *   inference, assumption and configuration change advances it.
 * - the number of evaluations of impure nodes in this top-level evaluation
 *   (`noteImpureEvaluation`), counted when such a node starts and when it
 *   ends. A node with an effect can change state without a state event: a
 *   `Block` declares its locals, a host handler can keep its own state.
 *   Counting at the start makes a read inside the impure node, after a
 *   change it made before it evaluated its operands, a new read; counting
 *   at the end does the same for a read after the node.
 * - the working precision, the precision that an enclosing `N(x, n)`
 *   requests (`_withTransientPrecision` changes neither without an event),
 *   and whether the assumptions are hidden (`_withoutFacts`).
 * - the angular unit: `_withTransientAngularUnit` (the symbolic integrator
 *   works in radians) changes it with no event and no new frame, so a
 *   `Sin(x)` evaluated in degrees must not be used inside the window.
 * - the seed frame of `WithRandomSeed` (`_randomFrame`), by identity. A
 *   Monte Carlo estimate (`NIntegrate`) is pure but reads its substreams
 *   from the seed frame in force, so a shared estimate under two seeds has
 *   two values.
 * - whether a `verify()` runs (`isVerifying`): the comparisons answer with
 *   three values while it runs.
 * - the registry of host capabilities of the evaluation
 *   (`_evaluationEffects`), by identity: `withEffects()` replaces it during a
 *   nested evaluation, and an unseeded Monte Carlo estimate, pure for the
 *   effects model, draws through its `entropy` handler.
 *
 * A node does not keep its result when the impure count moved while it was
 * evaluated. A node can look pure and still run an impure evaluation: `t =
 * r + 1` where `r` holds the unevaluated `Random()` (`isPure` does not
 * follow the value of a symbol), or a call of a host handler. The stamp of
 * an entry is read at the end of the evaluation of its node, so without
 * this rule the node would give the value it computed before the impure
 * evaluation again after it.
 *
 * An operator that the host declared is cached only when the host states
 * `pure: true` (user decision 2026-10-28). An application of a host operator
 * that does not state its purity counts as an impure evaluation
 * (`noteUncachedHostEvaluation`): it is evaluated at each occurrence, and no
 * node that holds it keeps its result. A host operator that states `pure:
 * true` and still changes state would corrupt the results of other nodes:
 *
 * - a node does not keep its result when the persistent evaluation version
 *   (the evaluation version less the ephemeral writes of a loop index, which
 *   a pure node that holds a `Sum` makes) moved while it was evaluated. This
 *   covers a change made by any host code under the node, a collection
 *   handler (`at`, `iterator`) that the library `At` calls included;
 * - a call of its `evaluate` handler during which that version moved counts
 *   as an impure evaluation too (`endHostHandlerCall`), which also stops the
 *   memo of the applications of function literals (`host-handler-changes.ts`).
 *
 * The handlers of the standard libraries are not checked: a pure standard
 * operator changes only state local to it (the index of a `Sum`).
 *
 * A node is kept only from its SECOND evaluation in a top-level evaluation
 * on: the first one marks the node (`BoxedFunction._sharedEvaluationMark`),
 * with no look-up and no allocation. Most nodes of an expression are
 * evaluated once, and for them the memo costs one field write. A node that
 * is evaluated again is evaluated a second time, then kept: over `Max(t, t)`
 * nested d deep, each level is computed twice, which stays linear in d.
 *
 * The memo is made when a synchronous top-level evaluation starts and is
 * dropped when it ends, so nothing is kept from one evaluation to the next.
 * An asynchronous evaluation does not use it. It is not made while a
 * debugger hook is set (the hook must see each statement that runs) or
 * when the engine has made an object (a result that read a field of a
 * mutable object must not be kept: see `object-deps.ts`).
 *
 * The caller does not store a result when one of the fail-closed counters
 * moved during the computation (`failClosedCount`): such a result can hold
 * a provisional answer that a later read gives differently.
 */
import {
  debugStatementHook,
  debugStatementResultHook,
} from '../../common/debug-hook.js';
import { cycleDetectionCount } from './cycle-guard.js';
import { sequenceReadStopCount } from './sequence-read-stops.js';
import { reentrantSignatureReadCount } from './declared-parameter-result.js';
import {
  noteUncachedHostCall,
  uncachedHostCallCount,
} from './host-handler-changes.js';

/** The parts of the engine that the memo reads. */
type MemoEngine = {
  readonly _evaluationVersion: number;
  readonly precision: number;
  readonly _requestedPrecision: number | undefined;
  _factsHidden(): boolean;
  readonly context: object | undefined;
  readonly angularUnit: string;
  readonly _randomFrame?: object | undefined;
  readonly isVerifying: boolean;
  readonly _evaluationEffects?: object | undefined;
  readonly effects: object;
};

type Entry<T> = {
  value: T;
  version: number;
  impure: number;
  precision: number;
  requested: number | undefined;
  factsHidden: boolean;
  angularUnit: string;
  randomFrame: object | undefined;
  verifying: boolean;
  effects: object;
};

type FrameMemo<T> = {
  exact: WeakMap<object, Entry<T>>;
  numeric: WeakMap<object, Entry<T>>;
};

/**
 * The memo of the top-level evaluation in progress on an engine. One object
 * per engine, reused by each top-level evaluation, so that a start makes no
 * allocation.
 */
export type SharedEvaluationMemo<T> = {
  /** The node whose evaluation is in progress and uses the memo, or
   * `undefined` when no evaluation uses it. */
  owner: object | undefined;
  /** The number of the top-level evaluation, unique in the process: a node
   * marked with it was evaluated before in this evaluation
   * (`BoxedFunction._sharedEvaluationMark`). */
  mark: number;
  /** The number of starts and ends of evaluations of impure nodes, and of
   * host handler calls that changed state. */
  impure: number;
  /** The number of nodes in progress that will keep their result: a node
   * read for its second time, between the look-up and the store. While it
   * is zero and the memo holds no entry, the impurity of a node is not read:
   * an impure evaluation would change nothing that the memo compares. */
  pending: number;
  /** The entries, by frame, then by node; made at the first store. Weak
   * maps: a frame that was popped, or a node made during the evaluation and
   * no longer used, does not keep its entries alive. */
  frames: WeakMap<object, FrameMemo<T>> | undefined;
};

const memos = new WeakMap<object, SharedEvaluationMemo<unknown>>();

/** The engine whose top-level evaluation uses the memo now, and its memo:
 * one engine is the common case, and a field read is cheaper than a look-up
 * in `memos`. Set only while such an evaluation runs
 * (`beginSharedEvaluationMemo` to `endSharedEvaluationMemo`), so that the
 * module does not keep an engine alive after its evaluation ends. */
let lastEngine: object | undefined;
let lastMemo: SharedEvaluationMemo<unknown> | undefined;

/** The last number given to a top-level evaluation (`mark`). */
let lastMark = 0;

function memoOf(engine: object): SharedEvaluationMemo<unknown> | undefined {
  if (engine === lastEngine) return lastMemo;
  return memos.get(engine);
}

/**
 * Start the memo of the top-level evaluation of `owner` on `engine`. It is
 * not used when a debugger hook is set or when `noMemo` is true.
 */
export function beginSharedEvaluationMemo(
  engine: object,
  owner: object,
  noMemo: boolean
): void {
  let memo = memoOf(engine);
  if (
    noMemo ||
    debugStatementHook !== undefined ||
    debugStatementResultHook !== undefined
  ) {
    if (memo !== undefined) {
      memo.owner = undefined;
      memo.frames = undefined;
    }
    return;
  }
  if (memo === undefined) {
    memo = { owner, mark: 0, impure: 0, pending: 0, frames: undefined };
    memos.set(engine, memo);
  }
  lastEngine = engine;
  lastMemo = memo;
  memo.owner = owner;
  memo.mark = ++lastMark;
  memo.impure = 0;
  memo.pending = 0;
  memo.frames = undefined;
}

/** End the memo of `engine` when `owner` started it. */
export function endSharedEvaluationMemo(engine: object, owner: object): void {
  const memo = memoOf(engine);
  if (memo !== undefined && memo.owner === owner) {
    memo.owner = undefined;
    memo.frames = undefined;
  }
  // The cache of the last engine does not keep the engine alive after its
  // evaluation ends, also when the evaluation did not use the memo.
  if (lastEngine === engine && memo?.owner === undefined) {
    lastEngine = undefined;
    lastMemo = undefined;
  }
}

/** The memo of the top-level evaluation in progress on `engine`, if any. */
export function sharedEvaluationMemo<T>(
  engine: object
): SharedEvaluationMemo<T> | undefined {
  const memo = memoOf(engine);
  return memo?.owner === undefined
    ? undefined
    : (memo as SharedEvaluationMemo<T>);
}

/** Count the start or the end of the evaluation of an impure node. */
export function noteImpureEvaluation(
  memo: SharedEvaluationMemo<unknown>
): void {
  memo.impure += 1;
}

/** Start a call of a handler of an operator that the host declared. Returns
 * the persistent evaluation version, for `endHostHandlerCall()`. */
export function beginHostHandlerCall(engine: {
  readonly _persistentEvaluationVersion: number;
}): number {
  return engine._persistentEvaluationVersion;
}

/**
 * End a call of a handler of an operator that the host declared. When the
 * persistent evaluation version moved during the call (`ce.assign` or a
 * `ce.declare` that installs a value, made by the handler), count a change
 * of state (`host-handler-changes.ts`) and, for the memo of `engine` if one
 * is in progress, an impure evaluation: no node that holds the call keeps
 * its result. A loop index that the handler writes (a `Sum` it evaluates) is
 * not counted: it lives in the scope of the loop, gone when the handler
 * returns.
 */
export function endHostHandlerCall(
  engine: { readonly _persistentEvaluationVersion: number },
  versionBefore: number
): void {
  if (engine._persistentEvaluationVersion === versionBefore) return;
  noteUncachedHostEvaluation(engine);
}

/**
 * Count an evaluation of host code that no memo may keep a result across
 * (`host-handler-changes.ts`): an application of a host operator that does
 * not state `pure: true`, or a call of a handler that states it and changed
 * state. For the memo of `engine`, if one is in progress, it is an impure
 * evaluation: no node that holds it keeps its result.
 */
export function noteUncachedHostEvaluation(engine: object): void {
  noteUncachedHostCall();
  const memo = memoOf(engine);
  if (memo?.owner !== undefined) memo.impure += 1;
}

/**
 * Run `f`, a call of host code, and count it as an evaluation that no memo
 * may keep a result across (`noteUncachedHostEvaluation`) when the
 * persistent evaluation version of `engine` moved during it: the host code
 * changed state.
 */
export function withHostHandlerCall<T>(
  engine: { readonly _persistentEvaluationVersion: number },
  f: () => T
): T {
  const versionBefore = engine._persistentEvaluationVersion;
  try {
    return f();
  } finally {
    if (engine._persistentEvaluationVersion !== versionBefore)
      noteUncachedHostEvaluation(engine);
  }
}

/** The names of the collection handlers that are functions
 * (`CollectionHandlers` in `types-definitions.ts`). */
const COLLECTION_HANDLER_NAMES = [
  'iterator',
  'count',
  'isEmpty',
  'isFinite',
  'isEnumerable',
  'isCollection',
  'isLazy',
  'contains',
  'countOf',
  'subsetOf',
  'eltsgn',
  'elttype',
  'at',
  'indexWhere',
  'atBigint',
  'indexOf',
] as const;

/** The collection handlers that describe the collection (its kind, its
 * element type and sign) and compute no value of it. A call of one of them
 * is not counted as host code: it is only called with `this` bound to the
 * handlers that the host gave. */
const DESCRIPTIVE_COLLECTION_HANDLERS: ReadonlySet<string> = new Set([
  'isCollection',
  'isLazy',
  'isEnumerable',
  'eltsgn',
  'elttype',
]);

/** For each object of collection handlers that a definition installed from
 * host handlers (`noteHostCollectionSource()`), the handlers that the host
 * gave. */
const hostCollectionSources = new WeakMap<object, object>();

/** Record that the definition installed `installed` from the collection
 * handlers `source` that the host gave, wrapped by
 * `withHostCollectionHandlers()`. */
export function noteHostCollectionSource(
  installed: object | undefined,
  source: object
): void {
  if (installed !== undefined) hostCollectionSources.set(installed, source);
}

/** The collection handlers that the host gave for the handlers `installed`
 * of a definition, or `undefined` when `installed` was not made from host
 * handlers. A definition that is made again from the fields of another one
 * (`ce.declare(name, patch, { extend: true })`) wraps these again, not the
 * wrapped handlers: thus a handler is wrapped one time, and the wrapper
 * reads the purity of the new definition. */
export function hostCollectionSource(
  installed: object | undefined
): object | undefined {
  return installed === undefined
    ? undefined
    : hostCollectionSources.get(installed);
}

/**
 * The collection handlers `handlers` of a host definition, wrapped:
 * a collection handler (`at`, `iterator`, `count`, `contains`, …) is called
 * by library operators (`At`, `Sum`) and by the memos of collections, not
 * by the evaluation of the node of the host operator, so the check around
 * its `evaluate` handler does not see it.
 *
 * When `uncached()` is true (the definition does not state its purity),
 * each call counts as host code that no memo keeps a result across
 * (`noteUncachedHostEvaluation()`). Otherwise each call runs under
 * `withHostHandlerCall()`, which counts it only when it changed state. The
 * iterator that the `iterator` handler returns is wrapped too: each call of
 * its `next`, `return` and `throw` is a call of host code.
 *
 * The handlers that describe the collection (`isCollection`, `isLazy`,
 * `isEnumerable`, `eltsgn`, `elttype`) compute no value of it and are not
 * counted.
 *
 * The handlers are read by name, as properties: a handler can be a method
 * of a class, inherited or not enumerable. A handler is called with
 * `handlers` as `this`.
 */
export function withHostCollectionHandlers<T extends object>(
  engine: { readonly _persistentEvaluationVersion: number },
  handlers: T,
  uncached: () => boolean
): T;
export function withHostCollectionHandlers<T extends object>(
  engine: { readonly _persistentEvaluationVersion: number },
  handlers: T | undefined,
  uncached: () => boolean
): T | undefined;
export function withHostCollectionHandlers<T extends object>(
  engine: { readonly _persistentEvaluationVersion: number },
  handlers: T | undefined,
  uncached: () => boolean
): T | undefined {
  if (handlers === undefined) return undefined;
  const source = handlers as Record<string, unknown>;
  const run = <R>(f: () => R): R => {
    if (!uncached()) return withHostHandlerCall(engine, f);
    noteUncachedHostEvaluation(engine);
    return f();
  };
  const result: Record<string, unknown> = {};
  for (const key of COLLECTION_HANDLER_NAMES) {
    const handler = source[key];
    if (handler === undefined) continue;
    if (typeof handler !== 'function') {
      result[key] = handler;
      continue;
    }
    const call = handler as (...args: unknown[]) => unknown;
    if (DESCRIPTIVE_COLLECTION_HANDLERS.has(key)) {
      result[key] = (...args: unknown[]) => call.apply(handlers, args);
      continue;
    }
    result[key] =
      key === 'iterator'
        ? (...args: unknown[]) =>
            withHostIterator(
              run,
              run(() => call.apply(handlers, args)) as
                Iterator<unknown> | undefined
            )
        : (...args: unknown[]) => run(() => call.apply(handlers, args));
  }
  if (source.elementMemo !== undefined) result.elementMemo = source.elementMemo;
  return result as T;
}

/** `iterator`, with each call of its `next`, `return` and `throw` methods
 * run under `run`. */
function withHostIterator(
  run: <R>(f: () => R) => R,
  iterator: Iterator<unknown> | undefined
): Iterator<unknown> | undefined {
  if (iterator === undefined || iterator === null) return iterator;
  const wrapped: Iterator<unknown> & Iterable<unknown> = {
    next: (...args: [] | [unknown]) => run(() => iterator.next(...args)),
    [Symbol.iterator]() {
      return this;
    },
  };
  if (iterator.return !== undefined)
    wrapped.return = (value?: unknown) => run(() => iterator.return!(value));
  if (iterator.throw !== undefined)
    wrapped.throw = (e?: unknown) => run(() => iterator.throw!(e));
  return wrapped;
}

/** The result that `node` gave before in the current frame, when nothing
 * that can change it happened since; otherwise `undefined`. */
export function rememberedEvaluation<T>(
  memo: SharedEvaluationMemo<T>,
  engine: MemoEngine,
  node: object,
  numeric: boolean
): T | undefined {
  const frames = memo.frames;
  if (frames === undefined) return undefined;
  const frame = engine.context;
  if (frame === undefined) return undefined;
  const frameMemo = frames.get(frame);
  if (frameMemo === undefined) return undefined;
  const entry = (numeric ? frameMemo.numeric : frameMemo.exact).get(node);
  if (
    entry === undefined ||
    entry.version !== engine._evaluationVersion ||
    entry.impure !== memo.impure ||
    entry.precision !== engine.precision ||
    entry.requested !== engine._requestedPrecision ||
    entry.factsHidden !== engine._factsHidden() ||
    entry.angularUnit !== engine.angularUnit ||
    entry.randomFrame !== engine._randomFrame ||
    entry.verifying !== engine.isVerifying ||
    entry.effects !== (engine._evaluationEffects ?? engine.effects)
  )
    return undefined;
  return entry.value;
}

/**
 * Keep `value` as the result of `node` in the current frame, stamped with
 * the state at the end of its evaluation.
 *
 * The stamp is read at the end, not at the start: a pure node can change
 * state while it is evaluated, but only state that is local to it (the index
 * of a `Sum` that it holds, the parameters and locals of a call that it
 * makes), which no read outside the node can see. Evaluated again with no
 * change after its end, it gives the same result. A stamp read at the start
 * would make a node that holds a `Sum` or a call with a loop never kept, and
 * a tower of such nodes exponential again.
 */
export function rememberEvaluation<T>(
  memo: SharedEvaluationMemo<T>,
  engine: MemoEngine,
  node: object,
  numeric: boolean,
  value: T
): void {
  const frame = engine.context;
  if (frame === undefined) return;
  const frames = (memo.frames ??= new WeakMap());
  let frameMemo = frames.get(frame);
  if (frameMemo === undefined) {
    frameMemo = { exact: new WeakMap(), numeric: new WeakMap() };
    frames.set(frame, frameMemo);
  }
  (numeric ? frameMemo.numeric : frameMemo.exact).set(node, {
    value,
    version: engine._evaluationVersion,
    impure: memo.impure,
    precision: engine.precision,
    requested: engine._requestedPrecision,
    factsHidden: engine._factsHidden(),
    angularUnit: engine.angularUnit,
    randomFrame: engine._randomFrame,
    verifying: engine.isVerifying,
    effects: engine._evaluationEffects ?? engine.effects,
  });
}

/**
 * The sum of the process counters that move when a computation used a
 * provisional answer: a guarded query that failed closed on a cycle
 * (`cycle-guard.ts`), a stopped read of a sequence term
 * (`sequence-read-stops.ts`), a re-entrant read of a signature that is
 * being derived (`declared-parameter-result.ts`), and host code that no
 * memo may keep a result across (`host-handler-changes.ts`). Each counter only
 * increases, so the sum is the same after a computation only when no
 * counter moved. A result computed while the sum moved is not kept.
 */
export function failClosedCount(): number {
  return (
    cycleDetectionCount() +
    sequenceReadStopCount() +
    reentrantSignatureReadCount() +
    uncachedHostCallCount()
  );
}

/**
 * Can an evaluation with `options` use the memo? Only a plain evaluation
 * or a plain numeric approximation can: every other option (a
 * materialization, a held argument list, the context stack or the effects
 * of an asynchronous evaluation, a precision window, a cancellation signal)
 * can change the result or how it is computed, and is not in the key. An
 * option set to `undefined` or `false` is the same as no option.
 */
export function memoizableEvaluateOptions(
  options: { readonly [key: string]: unknown } | undefined
): boolean {
  if (options === undefined) return true;
  for (const key in options) {
    const value = options[key];
    if (value === undefined || value === false) continue;
    if (key === 'numericApproximation') continue;
    return false;
  }
  return true;
}
