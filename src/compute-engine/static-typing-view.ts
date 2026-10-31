/**
 * The static view of the bindings, which a type computation reads.
 *
 * The type of a node of the body of a function literal comes from the
 * declared (static) bindings only: a type computation never reads the values
 * that a call gives the parameters. (ROADMAP CE-689, option (A), user
 * decision 2026-10-30.)
 *
 * A call of a function literal makes a new scope, the call frame, and
 * declares in it the parameters with the values of the arguments, and the
 * assignment locals of the body. While the call runs, the parent of the
 * body scope (the scope of the body `Block`) is the frame, and the bindings
 * that the canonicalization made in the body scope for the parameters and
 * for the inferred, valueless names are taken out of it
 * (`hideBodyScopeParams()`, `function-utils.ts`). So a name that a node of
 * the body reads by name (`lookup()`, `function-utils.ts`, and
 * `bindingInContext()`, `boxed-expression/binders.ts`) finds the binding of
 * the call, and its value.
 *
 * While a type computation of an engine runs (`withStaticTypingView()`),
 * these walks of the scope chain read the bindings as they are outside every
 * call:
 *
 * - the body scope of a function literal that is being applied (also while
 *   the application is suspended at an `await`) answers its own bindings
 *   and the bindings that the application took out of it;
 * - the frame of the application, when it is the parent of that body scope,
 *   is skipped: the walk goes on to the parent of the frame, which is the
 *   scope where the literal was defined;
 * - a frame where the walk starts (the statements of a body run in the
 *   frame) answers what the body scope answers, when the frame is on the
 *   current evaluation-context stack of the engine.
 *
 * A type is then the same in every call, and outside every call. The type
 * cache of a function expression (`BoxedFunction.type`) is keyed on a
 * version that the declarations of a call and the pop of its frame do not
 * advance (`typeVersion`, `engine-configuration-lifecycle.ts`), so the
 * nodes of a function body are not typed again at each call.
 *
 * A frame that the walk reaches in another way (the parent of the scope of
 * a closure that a call made), or a frame that is not on the current stack
 * (the captured frame of a returned closure), is read as it is: the nodes of
 * such a closure are made by the call, and the frame does not change after
 * the call.
 *
 * The frames in progress are read from the current evaluation-context stack
 * of the engine (`_evalContextStack`), not from a list of pushes and pops:
 * the stack can be replaced (the `contextStack` setter, the copy of the
 * stack that an awaited application runs on), and a frame of a suspended
 * application is then not on the current stack.
 *
 * The view belongs to the engine of the type computation. The frames, the
 * body scopes and the bindings taken out of them are recorded with the
 * engine of the application that made them (`noteHiddenBodyBindings()`),
 * and the view changes a walk only at the scopes of its own engine. A walk
 * of the scopes of another engine (a type handler of one engine that reads
 * or evaluates an expression of a second engine while a call of the second
 * engine runs) reads the bindings of the second engine as they are, and the
 * second engine reads the values of its parameters. An evaluation of the
 * same engine inside a type computation stays in the view, so that a type
 * does not depend on the values of a call: an application of a function
 * literal there reads its parameters with no value. A type handler must not
 * evaluate, but only test runs enforce it (`guardedTypeHandlerCall()`,
 * `boxed-expression/operand-descriptor.ts`, refuses a handler that moves a
 * version of the engine when `NODE_ENV` is `test` or `CE_TYPE_PURITY_GUARD`
 * is set, and an application declares its parameters, which moves one). In
 * other runs such an evaluation gives a result computed in the view, and no
 * cache keeps it for an evaluation outside the view: the caches keyed on
 * `_cacheGeneration()` get a key of their own, and the application memo is
 * not used (`validApplicationMemo()`, `function-utils.ts`).
 *
 * The other caches (sign, value, evaluation memos, effects) depend on the
 * values of the parameters. A value that one of them computes inside a type
 * computation is computed in the static view, and is stored under a key of
 * its own, so that an evaluation never reads it (`staticViewDiverges()`,
 * `ComputeEngine._cacheGeneration()`, `BoxedFunction._effectsOf()`). The
 * view differs while an application of a function literal of the engine
 * runs, also when it is suspended on a stack of its own: a count for each
 * engine of the body scopes that are being applied tells it.
 *
 * This module imports types only, so that each module can import it with
 * no dependency cycle.
 */

import type { Scope } from './types-kernel-evaluation.js';

/** The part of an engine that the static view reads: its current
 * evaluation-context stack, innermost context last. */
type ViewEngine = {
  readonly _evalContextStack: ReadonlyArray<{ readonly lexicalScope: object }>;
};

/** The engine whose type computation is in progress, or `undefined` when
 * no type computation runs. */
let viewEngine: ViewEngine | undefined = undefined;

/** Run `f`, a type computation of `ce`, with the static view of the
 * bindings (see the module comment). */
export function withStaticTypingView<T>(ce: ViewEngine, f: () => T): T {
  const outer = viewEngine;
  viewEngine = ce;
  try {
    return f();
  } finally {
    viewEngine = outer;
  }
}

/** For each call frame of a function literal, the body scope of the
 * literal (`noteCallFrame()`). */
const frameBodyScopes = new WeakMap<object, object>();

/** For the body scope of a function literal that is being applied, the
 * engine of the applications, and the bindings that the applications took
 * out of it, by name: the binding that the first application took out
 * (`noteHiddenBodyBindings()`). The entry lives from the start of the first
 * application to the end of the last one, so also while an application is
 * suspended at an `await`. The parent of the body scope is the frame of an
 * application only while the entry lives (`hideBodyScopeParams()`,
 * `function-utils.ts`). */
const hiddenBodyBindings = new WeakMap<
  object,
  { readonly engine: ViewEngine; readonly byName: Map<string, unknown> }
>();

/** For each engine, the number of body scopes that have an entry in
 * `hiddenBodyBindings`: the static view of the engine can differ from the
 * bindings only while it is not 0 (`staticViewDiverges()`). An exception
 * thrown by an application after it hid the parameters and before its `try`
 * (`pushScope()`, the declaration of its assignment locals) leaves the count
 * above 0, as it leaves the body scope re-parented. The view is then counted
 * as different for every later type computation of the engine: the caches
 * keyed on `_cacheGeneration()` use keys of their own inside type
 * computations, which costs cache hits, not correctness. */
const appliedBodyScopeCount = new WeakMap<ViewEngine, number>();

/** The engine of the applications of the body scope `bodyScope` that are in
 * progress, or `undefined`. */
function applyingEngine(bodyScope: object): ViewEngine | undefined {
  return hiddenBodyBindings.get(bodyScope)?.engine;
}

/** Record that `frame` is the call frame of an application of the function
 * literal whose body scope is `bodyScope`. */
export function noteCallFrame(frame: object, bodyScope: object): void {
  frameBodyScopes.set(frame, bodyScope);
}

/** An application by `ce` of the literal whose body scope is `bodyScope`
 * took the `entries` out of it. A name that an earlier application still
 * running took out keeps the binding it took out. */
export function noteHiddenBodyBindings(
  ce: ViewEngine,
  bodyScope: object,
  entries: ReadonlyArray<readonly [string, unknown]>
): void {
  let record = hiddenBodyBindings.get(bodyScope);
  if (record === undefined) {
    record = { engine: ce, byName: new Map() };
    hiddenBodyBindings.set(bodyScope, record);
    appliedBodyScopeCount.set(ce, (appliedBodyScopeCount.get(ce) ?? 0) + 1);
  }
  const byName = record.byName;
  for (const [name, binding] of entries)
    if (!byName.has(name)) byName.set(name, binding);
}

/** The last application of the literal whose body scope is `bodyScope`
 * ended and put its bindings back. */
export function forgetHiddenBodyBindings(bodyScope: object): void {
  const record = hiddenBodyBindings.get(bodyScope);
  if (record === undefined) return;
  hiddenBodyBindings.delete(bodyScope);
  const ce = record.engine;
  appliedBodyScopeCount.set(ce, (appliedBodyScopeCount.get(ce) ?? 1) - 1);
}

/** For each evaluation-context stack, the result of the last scan of
 * `innermostFrame()`: the length of the stack and its innermost context
 * then, and the frame found. A context is a new object at each push, so a
 * stack with the same length and the same innermost context holds the same
 * contexts. */
const innermostFrameMemo = new WeakMap<
  object,
  { length: number; top: object; frame: object | undefined }
>();

/** The innermost call frame of a function literal on `stack` (the
 * `lexicalScope` of a context, registered with `noteCallFrame()`), or
 * `undefined`. */
function innermostFrame(
  stack: ReadonlyArray<{ readonly lexicalScope: object }>
): object | undefined {
  const length = stack.length;
  if (length === 0) return undefined;
  const top = stack[length - 1];
  const memo = innermostFrameMemo.get(stack);
  if (memo !== undefined && memo.length === length && memo.top === top)
    return memo.frame;
  let frame: object | undefined = undefined;
  for (let i = length - 1; i >= 0; i--) {
    const scope = stack[i].lexicalScope;
    if (frameBodyScopes.has(scope)) {
      frame = scope;
      break;
    }
  }
  if (memo === undefined) innermostFrameMemo.set(stack, { length, top, frame });
  else {
    memo.length = length;
    memo.top = top;
    memo.frame = frame;
  }
  return frame;
}

/** Is the call frame `frame` on the current stack of `ce`? */
function frameInProgress(ce: ViewEngine, frame: object): boolean {
  const stack = ce._evalContextStack;
  if (innermostFrame(stack) === frame) return true;
  for (let i = stack.length - 1; i >= 0; i--)
    if (stack[i].lexicalScope === frame) return true;
  return false;
}

/**
 * The body scope of the function literal whose call frame is the innermost
 * one on the current evaluation-context stack of `ce`, or `undefined`
 * outside every call of a function literal.
 *
 * The type cache of a function expression (`BoxedFunction.type`) keys on
 * it, beside the type version. Some type computations read the bindings
 * from the scope of the reader, not from the scope of the node: the
 * effects of a function literal resolve the names of the functions it
 * calls with `lookupDefinition()`, and a symbol reads its binding in the
 * current context. The same node then has one type when it is read inside
 * a call of the literal that holds it, and another type when it is read
 * outside the call (a block local function is found in the first case
 * only). Two calls of the same literal have the same body scope, so they
 * share the entries.
 */
export function innermostCallFrameBody(ce: ViewEngine): object | undefined {
  const frame = innermostFrame(ce._evalContextStack);
  return frame === undefined ? undefined : frameBodyScopes.get(frame);
}

/**
 * Can a read in the static view answer something else than the same read
 * outside it? Only while a type computation of `ce` runs and an application
 * of a function literal by `ce` is in progress: the static view differs
 * only at the body scope of a literal that is being applied and at its
 * frame. An application suspended at an `await` counts too: its body scope
 * keeps the frame as parent and its bindings taken out, and a read of a
 * node of its body from any stack goes through them. A frame on the current
 * stack also counts. A cache that is not keyed on the type version keeps an
 * answer computed then under a key of its own.
 */
export function staticViewDiverges(ce: ViewEngine): boolean {
  if (viewEngine !== ce) return false;
  if ((appliedBodyScopeCount.get(ce) ?? 0) > 0) return true;
  return innermostFrame(ce._evalContextStack) !== undefined;
}

/**
 * The binding of `name` in `scope` in the static view. `start` is true for
 * the first scope of the walk. Outside a type computation, this is
 * `scope.bindings.get(name)`. The next scope of the walk is
 * `staticParentOf(scope)`.
 */
export function staticBindingIn<B>(
  scope: Scope<B>,
  name: string,
  start: boolean
): B | undefined {
  const ce = viewEngine;
  if (ce === undefined) return scope.bindings.get(name);
  // A frame in progress of the engine of the view where the walk starts
  // answers what the body scope answers.
  let own = scope;
  if (start) {
    const body = frameBodyScopes.get(scope) as Scope<B> | undefined;
    if (
      body !== undefined &&
      applyingEngine(body) === ce &&
      frameInProgress(ce, scope)
    )
      own = body;
  }
  const found = own.bindings.get(name);
  if (found !== undefined) return found;
  // The bindings taken out of a body scope by an application of the engine
  // of the view. An application of another engine is read as it is.
  const record = hiddenBodyBindings.get(own);
  if (record === undefined || record.engine !== ce) return undefined;
  return record.byName.get(name) as B | undefined;
}

/** The scope after `scope` in a walk of the chain: see `staticBindingIn()`. */
export function staticParentOf<B>(scope: Scope<B>): Scope<B> | null {
  const parent = scope.parent;
  if (viewEngine === undefined || parent === null) return parent;
  // The frame of an application of the literal whose body scope is `scope`
  // is skipped, when the engine of the view made the application. The body
  // scope has this frame as parent only while the application runs
  // (`hideBodyScopeParams()`, `function-utils.ts`), also while it is
  // suspended on a stack of its own.
  if (
    frameBodyScopes.get(parent) === scope &&
    applyingEngine(scope) === viewEngine
  )
    return parent.parent;
  return parent;
}

/**
 * The number of answers, since the engine module loaded, that depend on the
 * computations in progress and not only on the bindings: a re-entrant read
 * of a cached value that is being computed (`cachedValue()`,
 * `boxed-expression/cache.ts`) or of the effects of a node
 * (`BoxedFunction._effectsOf()`), and a derivation of the result of a call
 * declined because the same function literal was already being derived
 * (`literalBodyResultType()`, `boxed-expression/call-result-type.ts`).
 *
 * A type computed from such an answer is not the same in every call: it
 * depends on what was being computed when it was read. The type cache
 * (`BoxedFunction.type`) compares the count before and after a computation,
 * and keeps a type that read such an answer under the `any` axis, which
 * every call advances (`_typeCacheFallbackGeneration()`).
 */
let stackDependentAnswers = 0;

/** Count an answer that depends on the computations in progress. */
export function noteStackDependentAnswer(): void {
  stackDependentAnswers += 1;
}

/** See `noteStackDependentAnswer()`. */
export function stackDependentAnswerCount(): number {
  return stackDependentAnswers;
}

/** Take back `n` answers counted by `noteStackDependentAnswer()`: the
 * answers of the empty-cell terminator of a cell that its outermost
 * computation read (`cachedValue()`, `boxed-expression/cache.ts`). */
export function forgetStackDependentAnswers(n: number): void {
  stackDependentAnswers -= n;
}
