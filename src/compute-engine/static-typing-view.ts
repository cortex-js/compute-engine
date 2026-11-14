/**
 * Type computations read declared bindings, not a call's parameter values.
 * Lookup skips the active call frame of a body scope. Captured frames
 * reached through other chains remain visible.
 * The view belongs to one engine and follows its evaluation-context stack,
 * including suspended applications.
 *
 * Value-dependent caches must distinguish computations inside this view from
 * ordinary evaluation. Keep this module type-only to avoid dependency cycles.
 * See docs/TYPE-SYSTEM.md, "Static binding view", for lookup and cache rules.
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

/** Run `f` outside the static view, also inside a type computation. A
 * cache that is not keyed on the view is built this way (the fact index,
 * `getFactIndex()`). */
export function withoutStaticTypingView<T>(f: () => T): T {
  const outer = viewEngine;
  viewEngine = undefined;
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
 * engine of the applications (`noteBodyScopeApplied()`). The entry lives
 * from the start of the first application to the end of the last one, so
 * also while an application is suspended at an `await`. */
const appliedBodyScopes = new WeakMap<object, ViewEngine>();

/** For each engine, the number of body scopes that have an entry in
 * `appliedBodyScopes`: the static view of the engine can differ from the
 * bindings of an application while it is not 0 (`activationViewDiverges()`
 * has the other case). An exception thrown by an application after
 * `noteBodyScopeApplied()` and before its `try` leaves the count above 0.
 * The view is then counted as different for every later type computation of
 * the engine: a type that depends on the derivations in progress is kept
 * under a key of its own, which costs cache hits, not correctness. */
const appliedBodyScopeCount = new WeakMap<ViewEngine, number>();

/** The engine of the applications of the body scope `bodyScope` that are in
 * progress, or `undefined`. */
function applyingEngine(bodyScope: object): ViewEngine | undefined {
  return appliedBodyScopes.get(bodyScope);
}

/** Record that `frame` is the call frame of an application of the function
 * literal whose body scope is `bodyScope`. */
export function noteCallFrame(frame: object, bodyScope: object): void {
  frameBodyScopes.set(frame, bodyScope);
}

/** An application by `ce` of the literal whose body scope is `bodyScope`
 * started. */
export function noteBodyScopeApplied(ce: ViewEngine, bodyScope: object): void {
  if (appliedBodyScopes.has(bodyScope)) return;
  appliedBodyScopes.set(bodyScope, ce);
  appliedBodyScopeCount.set(ce, (appliedBodyScopeCount.get(ce) ?? 0) + 1);
}

/** The last application of the literal whose body scope is `bodyScope`
 * ended. */
export function forgetBodyScopeApplied(bodyScope: object): void {
  const ce = appliedBodyScopes.get(bodyScope);
  if (ce === undefined) return;
  appliedBodyScopes.delete(bodyScope);
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
 *
 * Only the frame of a literal that `ce` is applying counts: a lazy
 * collection made by a call that has returned pushes the frame of that call
 * again when an element is computed (`lazy-view-context.ts`), and the
 * static view reads such a frame as it reads it from outside
 * (`staticBindingIn()`, `staticParentOf()`). With a key of its own, a node
 * read at each element both from that frame and from the frame of its
 * reader was typed twice per element, each time to the same type.
 */
export function innermostCallFrameBody(ce: ViewEngine): object | undefined {
  const stack = ce._evalContextStack;
  const frame = innermostFrame(stack);
  if (frame === undefined) return undefined;
  const body = frameBodyScopes.get(frame);
  if (body !== undefined && applyingEngine(body) === ce) return body;
  for (let i = stack.length - 1; i >= 0; i--) {
    const outer = frameBodyScopes.get(stack[i].lexicalScope);
    if (outer !== undefined && applyingEngine(outer) === ce) return outer;
  }
  return undefined;
}

/** True while a type computation of `ce` runs. */
export function inStaticTypingView(ce: ViewEngine): boolean {
  return viewEngine === ce;
}

/**
 * Can a read in the static view answer something else than the same read
 * outside it? Yes, in every type computation of `ce`: a static type does not
 * depend on a value (decision D16), so in the view a variable, a parameter
 * and a block local have no value (`storedValue`,
 * `boxed-value-definition.ts`). A sign, a count, an evaluation or an
 * application read there is not the one read outside it.
 *
 * A memo of such an answer (a value-dependent memo) neither serves nor
 * stores an entry across the two views: it is keyed on the view
 * (`_cacheGeneration()` mints a key of its own inside the view), or it is
 * bypassed inside the view.
 */
export function staticViewDiverges(ce: ViewEngine): boolean {
  return viewEngine === ce;
}

/**
 * Is a type computation of `ce` running while an application of a function
 * literal by `ce` is in progress (or suspended at an `await`, or its frame is
 * on the current stack)? The static view then also reads no value of the
 * frame of that application.
 *
 * Only the key of a type that depends on the derivations in progress reads
 * this (`_typeCacheFallbackGeneration()`): a type does not depend on a value,
 * so outside an application one key serves a type computed in the view and
 * read outside it, and a provisional answer is retired by the same key the
 * reader outside the view uses.
 */
export function activationViewDiverges(ce: ViewEngine): boolean {
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
  return own.bindings.get(name);
}

/** The scope after `scope` in a walk of the chain: see `staticBindingIn()`. */
export function staticParentOf<B>(scope: Scope<B>): Scope<B> | null {
  const parent = scope.parent;
  if (viewEngine === undefined || parent === null) return parent;
  // The frame of an application of the literal whose body scope is `scope`
  // is skipped, when the engine of the view made the application. The body
  // scope has this frame as parent only while the application runs
  // (`makeLambda()`, `function-utils.ts`), also while it is
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
