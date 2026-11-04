/**
 * Preserve the creation context of lazy collections that invoke callbacks.
 *
 * Call frames stay shared with closures. Nested block and loop bindings are
 * snapshotted when a view is created, then copied only if a read can no longer
 * use the unchanged live scopes. An immediately consumed view can use the live stack.
 * An enumeration fixes its context at its first pull, including later pulls
 * after the creating call returns.
 *
 * Rebuilt views must carry their creation records. Held body nodes are shared
 * across calls, so adopting one requires a new node. A top-level view normally
 * uses its reader's context; an outward assignment records the scopes it leaves.
 *
 * See docs/SCOPING-MODEL.md, "Lazy view context lifetime", for retention,
 * escape boundaries, and the distinction between views and closures.
 */

import type {
  BoxedDefinition,
  Expression,
  IComputeEngine,
  Scope,
} from '../global-types.js';
import { isDictionary, isFunction, isSymbol } from './type-guards.js';

/** One frame of the engine's evaluation-context stack. */
type EvalContext = IComputeEngine['_evalContextStack'][number];

/** One binding of a nested scope that a record keeps: its name, its
 * definition at the creation of the view, and the value of that definition
 * at the creation. */
export type LazyViewScopeEntry = readonly [
  name: string,
  binding: BoxedDefinition,
  value: Expression | undefined,
];

/** The record of the creation context of a view (see the header). The
 * object is shared by the view and by its rebuilds. */
type LazyViewRecord = {
  /** The context stack up to and including the frame of the call. */
  contexts: ReadonlyArray<EvalContext>;
  /** The context on top of the stack when the view was created. */
  top: EvalContext;
  /** The scopes between the scope of `top` and the frame, innermost first,
   * with their bindings at the creation and the write version of each value
   * binding (`undefined` for a binding that is not a value). `undefined`
   * when the view was created in the frame itself, or when the chain of the
   * scope of `top` does not reach the frame (`top` is then the context of
   * the frame). */
  nested:
    | ReadonlyArray<{
        scope: Scope;
        entries: LazyViewScopeEntry[];
        versions: (number | undefined)[];
      }>
    | undefined;
  /** The call frames on the stack at the creation that the scope chain of
   * `top` reaches, innermost first: the frames that a read of the view can
   * resolve a name in. */
  frames: ReadonlyArray<Scope>;
  /** The stack that a read puts in place once the live stack cannot be
   * used, made once. */
  built: ReadonlyArray<EvalContext> | undefined;
  /** True for a record that an assignment made for a view created outside
   * every function call (`recordOutlivedLazyViewContexts`). Its frame can
   * be the local scope of a node (a loop, a block), which a later
   * assignment of the view to a variable further out outlives. */
  outlived?: boolean;
};

/** The copy of a nested scope that a record reads, made by
 * `function-utils.ts`, which owns the scope bookkeeping of closures: a
 * scope with the parent `parent` and the bindings `entries`, where each
 * value binding has a new definition that holds its value at the
 * creation. */
export type LazyViewNestedScopeCopier = (
  ce: IComputeEngine,
  source: Scope,
  parent: Scope,
  entries: ReadonlyArray<LazyViewScopeEntry>
) => Scope;

let copyNested: LazyViewNestedScopeCopier | undefined;

/** Install the copier of nested scopes (`function-utils.ts`, at module
 * load). */
export function setLazyViewNestedScopeCopier(
  c: LazyViewNestedScopeCopier
): void {
  copyNested = c;
}

/**
 * The record of each view. `null` records a view that was created outside
 * every function call, so that a later evaluation of that view inside a
 * call keeps it without a stack instead of recording the stack of that
 * call (see `recordLazyViewContext`).
 */
const RECORDS = new WeakMap<Expression, LazyViewRecord | null>();

/** For a view with the record `null`, the context on top of the stack when
 * it was created (`recordOutlivedLazyViewContexts`). A rebuild of the view
 * that takes its record takes this context too (`shareLazyViewRecord`).
 * The entry keeps the context, and through it the scope of the creation,
 * alive as long as the view: the scope is not freed after its block has
 * ended while the view can be read. A view that gets a record leaves the
 * map (`setRecord`). */
const CREATED_ON = new WeakMap<Expression, EvalContext>();

/** The call frames that a record, a function literal made in the call, or
 * a node of the value that the call returns (`retainScope`)
 * can read after their call has ended (see the header), and the local
 * scopes of nodes (a block, a loop, a comprehension, a big operator) that a
 * closure made in them can read after their pop (`retainScope`). */
const RETAINED_SCOPES = new WeakSet<Scope>();

/** The local scopes of expression nodes (`noteNodeScope`). */
const NODE_SCOPES = new WeakSet<Scope>();

/** The call frames that the `frames` of a record name. The end of the call
 * of any other frame does not look for views that can outlive it
 * (`retainCallFrameOfResult`). */
const FRAMES_OF_RECORDS = new WeakSet<Scope>();

/** For a lazy callback view canonicalized while a function call is in
 * progress and that has no record yet, the frame of the innermost such call
 * (see `noteLazyViewCanonicalized`). A view leaves the map when it gets a
 * record (`setRecord`). */
const CANONICALIZED_IN = new WeakMap<Expression, Scope>();

/** For each call frame, the number of views that `CANONICALIZED_IN` holds
 * for it. */
const CANONICALIZED_COUNT = new WeakMap<Scope, number>();

/** Give `expr` the record `record`. A view that gets a record is no longer
 * a view to adopt (`noteLazyViewCanonicalized`). */
function setRecord(expr: Expression, record: LazyViewRecord | null): void {
  RECORDS.set(expr, record);
  if (record !== null) CREATED_ON.delete(expr);
  const frame = CANONICALIZED_IN.get(expr);
  if (frame === undefined) return;
  CANONICALIZED_IN.delete(expr);
  CANONICALIZED_COUNT.set(frame, (CANONICALIZED_COUNT.get(frame) ?? 1) - 1);
}

/** True when the pop of the call frame `scope` must keep its definitions
 * alive: a record of a lazy callback view holds the frame (see the header),
 * or a function literal made in the call, or a node of the value that the
 * call returned, has a chain that reaches it (`retainScope`). For the
 * local scope of a node (a block, a loop, a comprehension, a big operator),
 * true when a closure has a chain that reaches it.
 * Read by `discardEvalContext` in `engine-scope.ts`. */
export function isRetainedScope(scope: Scope): boolean {
  return RETAINED_SCOPES.has(scope);
}

/**
 * Keep a scope's definitions available to an escaping closure or lazy view.
 * Call frames remain live; node scopes may still dispose definitions but must
 * not tombstone them. The weak mark does not itself keep the scope reachable.
 * See docs/SCOPING-MODEL.md, "Lazy view context lifetime".
 */
export function retainScope(frame: Scope): void {
  RETAINED_SCOPES.add(frame);
}

/** Record that `scope` is the local scope of an expression node (a block, a
 * loop, a comprehension, a big operator, any other scoped node). The
 * constructor of the node calls it, once, so the creation of a closure in
 * the node finds the mark (`isNodeScope`). A scope that the host pushes
 * (`ce.pushScope()`) and the frame of a call are not the scope of a node. */
export function noteNodeScope(scope: Scope): void {
  NODE_SCOPES.add(scope);
}

/** True when `scope` is the local scope of an expression node
 * (`noteNodeScope`). */
export function isNodeScope(scope: Scope): boolean {
  return NODE_SCOPES.has(scope);
}

/** The number of records made so far. A call that sees the same number at
 * its end as at its start made no view, directly or in a call that it made,
 * and need not walk its result to carry records. */
let recordSerial = 0;

/** See `recordSerial`. */
export function lazyViewRecordSerial(): number {
  return recordSerial;
}

/** True when `expr` is a lazy collection view that calls a callback when it
 * is read (the flag `callsCallbackOnRead` of its collection handlers). */
export function isLazyCallbackView(expr: Expression): boolean {
  return (
    isFunction(expr) &&
    expr.operatorDefinition?.collection?.callsCallbackOnRead === true
  );
}

/** Whether `expr` has a record, also the record `null`. */
export function hasLazyViewRecord(expr: Expression): boolean {
  return RECORDS.has(expr);
}

/** Give `to` the record of `from`, if `from` has one. */
export function shareLazyViewRecord(from: Expression, to: Expression): void {
  const own = RECORDS.get(from);
  if (own === undefined || RECORDS.has(to)) return;
  setRecord(to, own);
  const created = own === null ? CREATED_ON.get(from) : undefined;
  if (created !== undefined) CREATED_ON.set(to, created);
}

/**
 * A record for a view created now on `stack`, or `null` when no function
 * call is in progress on `stack`. With `inFrame`, the view is recorded in
 * the frame of the call, not in the scope on top of the stack.
 */
function newRecord(
  stack: ReadonlyArray<EvalContext>,
  inFrame: boolean
): LazyViewRecord | null {
  let frameIndex = stack.length - 1;
  while (frameIndex >= 0 && stack[frameIndex].name !== 'call') frameIndex -= 1;
  if (frameIndex < 0) return null;
  return recordAt(
    stack,
    frameIndex,
    inFrame ? stack[frameIndex] : stack[stack.length - 1]
  );
}

/** The scopes of the chain from `from` up to `to`, `to` excluded, innermost
 * first, with their bindings now and the write version of each value
 * binding (`LazyViewRecord['nested']`). `undefined` when the chain does not
 * reach `to`. */
function snapshotScopes(
  from: Scope,
  to: Scope
): NonNullable<LazyViewRecord['nested']>[number][] | undefined {
  const scopes: NonNullable<LazyViewRecord['nested']>[number][] = [];
  let scope: Scope | null = from;
  while (scope !== null && scope !== to) {
    const entries: LazyViewScopeEntry[] = [];
    const versions: (number | undefined)[] = [];
    for (const [name, binding] of scope.bindings) {
      const value = 'value' in binding ? binding.value : undefined;
      entries.push([name, binding, value?.storedValue]);
      versions.push(value?._writeVersion);
    }
    scopes.push({ scope, entries, versions });
    scope = scope.parent;
  }
  return scope === null ? undefined : scopes;
}

/** A record whose frame is the context `stack[frameIndex]` and whose
 * context on top of the stack at the creation is `top` (see
 * `LazyViewRecord`). */
function recordAt(
  stack: ReadonlyArray<EvalContext>,
  frameIndex: number,
  top: EvalContext
): LazyViewRecord {
  const frameContext = stack[frameIndex];
  const frame = frameContext.lexicalScope;
  let nested: LazyViewRecord['nested'] = undefined;
  if (top.lexicalScope !== frame) {
    nested = snapshotScopes(top.lexicalScope, frame);
    if (nested === undefined) top = frameContext;
  }
  // The call frames that the scope chain of `top` reaches. The chain is
  // read now: the parent link of a function body changes with each call of
  // the function (`makeLambda`, `function-utils.ts`).
  const callFrames = new Set<Scope>();
  for (let i = frameIndex; i >= 0; i--)
    if (stack[i].name === 'call') callFrames.add(stack[i].lexicalScope);
  const frames: Scope[] = [];
  for (let s: Scope | null = top.lexicalScope; s != null; s = s.parent)
    if (callFrames.has(s)) {
      frames.push(s);
      FRAMES_OF_RECORDS.add(s);
    }
  recordSerial += 1;
  return {
    contexts: stack.slice(0, frameIndex + 1),
    top,
    nested,
    frames,
    built: undefined,
  };
}

/**
 * Record the creation context of `result`, the value of the evaluation of
 * `source` on the context stack `stack`, when `result` is a lazy callback
 * view that has no record yet.
 *
 * - A result that is `source` itself is left as it is: the node is the
 *   expression that was evaluated (a canonical node of a function body can
 *   be evaluated by several calls), not a new view.
 * - A result that already has a record keeps it: it was created by an inner
 *   evaluation (an inner call, a memo hit of the evaluation that created it).
 * - When `source` is itself a view with a record (the evaluation of a view
 *   value, which builds a new node from its evaluated operands), the result
 *   takes the record of `source`: it is the same view, read again.
 * - Otherwise the result is a new view. Outside every function call it
 *   records `null`. Inside a call it records the context of the call.
 */
export function recordLazyViewContext(
  source: Expression,
  result: Expression,
  stack: ReadonlyArray<EvalContext>
): void {
  if (result === source || !isLazyCallbackView(result)) return;
  if (RECORDS.has(result)) return;
  const own = RECORDS.get(source);
  if (own !== undefined) {
    shareLazyViewRecord(source, result);
    return;
  }
  const record = newRecord(stack, false);
  setRecord(result, record);
  if (record === null && stack.length > 0)
    CREATED_ON.set(result, stack[stack.length - 1]);
}

/**
 * The value `value`, that an assignment stores in a variable of the scope
 * `frame` or of a scope outside it, with a record of the scopes between the
 * context of their creation and `frame` for its views that were created
 * outside every function call, in a scope nested in `frame`: a loop
 * iteration or a block of the top level. Called by
 * `bindOutlivedLocalsOfLazyValue` (`function-utils.ts`) for the views that
 * outlive these scopes.
 *
 * Such a view has the record `null`, and its reads ran in the context of
 * the reader. A name that the call of its callback reads by its binding in
 * the context, such as the symbol default `d` of a parameter
 * `(x, k = d) => x * k` that the call fills, was then read after the loop
 * had ended, where `d` has no value: with
 * `let f = (x, k = d) => x * k; for d in [3, 6] { if d == 3 { h = Map(f, R) } }`,
 * the elements of `h` were `d` and `2d`. With the record, the read uses the
 * live stack while the scopes of the creation are unchanged, and otherwise
 * copies of these scopes with the values of the assignment
 * (`contextsForRead`), as for a view made in a function call: the elements
 * are `3` and `6`. The values are those of the assignment, as for the names
 * that the operands of the view name (`bindOutlivedLocalsOfLazyValue`).
 *
 * A view that has such a record already, and that is stored in a variable
 * further out than the frame of its record, gets a record extended to
 * `frame`: the scopes of the earlier record, with their values at the
 * earlier assignment, and the scopes from its frame up to `frame`, with
 * their values now. With
 * `for d in [3, 6] { let u = []; for j in [1] { if d == 3 { u = Map(f, R) } }; if d == 3 { h = u } }`,
 * the record of `u` has the loop body as its frame, and `h` reads `d = 3`
 * after the loop.
 *
 * The view that gets a record is a new node (`rebuild`), so the view of an
 * earlier target, or of a local of the same scope, keeps its record: a view
 * read in its own scope reads the current values. A view that was created
 * outside the scopes that the variable outlives (the value of a variable of
 * `frame`, assigned again in a loop) keeps the record `null`: it is read in
 * the context of its reader. A view that has a record of a call keeps it.
 * The walk goes into the operands of the nodes that can hold a view
 * (`Take(Map(f, R), 5)`) and into the values of a dictionary, not into a
 * function literal, and rebuilds the nodes above a new view.
 *
 * The record is made, or extended, only while the context of the creation,
 * or the frame of the earlier record, is on the stack above the frame of
 * the variable. A view that leaves its block as the value of the block has
 * lost that context, gets no record, and is read in the context of its
 * reader: with
 * `for d in [3, 6] { if d == 3 { h = do { let z = 0; Map(f, R) } } }`, the
 * elements of `h` are `d` and `2d`. The scope chain of the creation cannot
 * stand for the stack: the local scope of a block is one object for every
 * run of the block, and an ended scope can be entered again.
 */
export function recordOutlivedLazyViewContexts(
  value: Expression,
  stack: ReadonlyArray<EvalContext>,
  frame: Scope,
  rebuild: (e: Expression, ops: ReadonlyArray<Expression>) => Expression,
  skips: (e: Expression) => boolean
): Expression {
  let frameIndex = stack.length - 1;
  while (frameIndex >= 0 && stack[frameIndex].lexicalScope !== frame)
    frameIndex -= 1;
  if (frameIndex < 0) return value;
  const memo = new Map<Expression, Expression>();
  const visit = (e: Expression): Expression => {
    const hit = memo.get(e);
    if (hit !== undefined) return hit;
    if (isDictionary(e)) {
      const ce = e.engine;
      let changed = false;
      const entries = e.keys.map((k) => {
        const v = e.get(k)!;
        const next = visit(v);
        if (next !== v) changed = true;
        return ce.function('KeyValuePair', [ce.string(k), next]);
      });
      const node = changed ? ce.function('Dictionary', entries) : e;
      memo.set(e, node);
      return node;
    }
    // A node with a local scope is not entered and not rebuilt: a rebuild
    // on new operands would not keep its scope. A view in it, or a view
    // with a local scope, gets no record and is read in the context of its
    // reader. A node that is not a view and whose operands are not values
    // (`Hold`, `skips`) is not entered either, as in the rewrite of
    // `bindOutlivedLocalsOfLazyValue`.
    if (!isFunction(e) || !canHoldLazyView(e) || e.localScope !== undefined)
      return e;
    if (!e.isLazyCollection && skips(e)) return e;
    const ops = e.ops;
    const next = ops.map(visit);
    let node: Expression = e;
    if (!next.every((op, i) => op === ops[i])) {
      node = rebuild(e, next);
      shareLazyViewRecord(e, node);
    }
    const record = outlivedRecordOf(e, stack, frameIndex);
    if (record !== undefined) {
      if (node === e) node = rebuild(e, ops);
      setRecord(node, record);
    }
    memo.set(e, node);
    return node;
  };
  return visit(value);
}

/** The record that the view `e`, stored in a variable of the scope of
 * `stack[frameIndex]`, gets (`recordOutlivedLazyViewContexts`), or
 * `undefined` when it keeps its record.
 *
 * `null` when `e` has a record of an earlier assignment whose frame is no
 * longer on the stack: the view has left that frame as the value of a
 * block (`w = do { let v = []; do { v = Map(f, R) }; v }`). Its record would
 * read the scope chain of that frame, whose bindings are those of the
 * reader's time (the `d` of a later loop iteration), so the stored view is
 * read in the context of its reader instead. Also `null` when the frame of
 * the earlier record is on the stack but its scope chain does not reach the
 * frame of the variable. */
function outlivedRecordOf(
  e: Expression,
  stack: ReadonlyArray<EvalContext>,
  frameIndex: number
): LazyViewRecord | null | undefined {
  const record = RECORDS.get(e);
  if (record === null) {
    const created = CREATED_ON.get(e);
    if (created === undefined || stack.lastIndexOf(created) <= frameIndex)
      return undefined;
    return { ...recordAt(stack, frameIndex, created), outlived: true };
  }
  if (record?.outlived !== true) return undefined;
  const oldFrame = record.contexts[record.contexts.length - 1];
  const oldIndex = stack.lastIndexOf(oldFrame);
  if (oldIndex < 0) return null;
  if (oldIndex <= frameIndex) return undefined;
  const outer = snapshotScopes(
    oldFrame.lexicalScope,
    stack[frameIndex].lexicalScope
  );
  // The chain from the earlier frame does not reach the frame of the
  // variable (on the asynchronous route, a parent link can lead to the
  // template of an activation): the earlier record would read the scopes
  // between live, with the values of the reader's time. The view is read in
  // the context of its reader instead.
  if (outer === undefined) return null;
  recordSerial += 1;
  return {
    contexts: stack.slice(0, frameIndex + 1),
    // A record whose chain did not reach its frame has the frame as `top`
    // and no nested scopes: the scopes from that frame out are then all
    // the nested scopes.
    top: record.top,
    nested: [...(record.nested ?? []), ...outer],
    frames: record.frames,
    built: undefined,
    outlived: true,
  };
}

/**
 * Give the view `view`, a node of the value that a call returns that was
 * never evaluated (a lazy operator of the body holds it), a record of the
 * call on `stack`, in its frame. The caller (`adoptHeldLazyViews`,
 * `function-utils.ts`) passes a new node: the held node is a node of the
 * function body that every call shares, and a record on it would be read by
 * the views of the other calls.
 */
export function adoptLazyView(
  view: Expression,
  stack: ReadonlyArray<EvalContext>
): void {
  if (!RECORDS.has(view)) setRecord(view, newRecord(stack, true));
}

/**
 * Note that the lazy callback view `view` was just canonicalized on the
 * context stack `stack` (the constructor of `BoxedFunction` calls this for
 * a canonical node of an operator that sets `callsCallbackOnRead`). When a
 * function call is in progress, the view is a node made by that call, and
 * the end of the call adopts it if it is in the value that the call returns
 * and was never evaluated (`adoptHeldLazyViews`, `function-utils.ts`):
 * `ReleaseHold(Hold(Dedup(Map(f, xs))))` returns a `Dedup` whose `Map` is
 * canonicalized during the call, and is not a node of the function body.
 * A view canonicalized outside every call (the value of a symbol assigned
 * at the top level) is never adopted.
 *
 * The nodes of the body of a function literal that a call canonicalizes (a
 * closure that the call makes) are noted too, with the frame of that call.
 * The adoption does not walk into a function literal, so they are adopted
 * only by a call of that literal, as nodes of its body.
 */
export function noteLazyViewCanonicalized(
  view: Expression,
  stack: ReadonlyArray<EvalContext>
): void {
  if (RECORDS.has(view) || CANONICALIZED_IN.has(view)) return;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].name !== 'call') continue;
    const frame = stack[i].lexicalScope;
    CANONICALIZED_IN.set(view, frame);
    CANONICALIZED_COUNT.set(frame, (CANONICALIZED_COUNT.get(frame) ?? 0) + 1);
    return;
  }
}

/** Whether the call of the frame `frame` canonicalized a lazy callback view
 * that has no record yet (see `noteLazyViewCanonicalized`). Most of the
 * views that a call canonicalizes are the results of evaluations, which get
 * a record (`recordLazyViewContext`): for a call that has only such views,
 * the answer is `false`. */
export function canonicalizedLazyViewsIn(frame: Scope): boolean {
  return (CANONICALIZED_COUNT.get(frame) ?? 0) > 0;
}

/** Whether the view `view` was canonicalized during the call of the frame
 * `frame`, and not during a call that it made (see
 * `noteLazyViewCanonicalized`). */
export function wasCanonicalizedIn(view: Expression, frame: Scope): boolean {
  return CANONICALIZED_IN.get(view) === frame;
}

/**
 * At the end of the call of the frame `frame`, before its pop, mark the
 * frame as retained when a view whose record names it (the `frames` of the
 * record) can be read after the call: the view is reachable from `result`,
 * the value that the call returns. `stack` is the context stack of the
 * call, with `frame` in it.
 *
 * The walk goes into the operands of each node that can hold a view, the
 * values of a dictionary, the value of a symbol, the body of a function
 * literal and the bindings of its scope chain (a closure reads them when it
 * is called), and,
 * for a view with a record, the bindings of the scope chain of the record
 * (its callback reads them). It stops at a scope of the stack below the
 * frame (the context of the caller, which outlives the call) and at the
 * root scope. Each node and each scope is visited once.
 *
 * A view that is reachable only by a way that the walk does not follow
 * (host code that keeps the view in its own data) does not retain the
 * frame: a read of it after the call resolves names in definitions that
 * were disposed. The values of a disposed definition are kept, so the read
 * gives the values of the call. The debug check of dead bindings reports
 * the read only where it evaluates a symbol bound to a disposed definition
 * (`assertLiveBinding`, called by `boxed-symbol.ts`), not where it resolves
 * a name, such as the symbol default of a parameter.
 */
export function retainCallFrameOfResult(
  frame: Scope,
  results: ReadonlyArray<Expression | undefined>,
  stack: ReadonlyArray<EvalContext>
): void {
  if (!FRAMES_OF_RECORDS.has(frame) || RETAINED_SCOPES.has(frame)) return;
  const below = new Set<Scope>();
  for (const context of stack) {
    if (context.lexicalScope === frame) break;
    below.add(context.lexicalScope);
  }
  const seenNodes = new Set<Expression>();
  const seenScopes = new Set<Scope>();
  const pending: Expression[] = [];
  for (const result of results) if (result !== undefined) pending.push(result);
  const visitScope = (start: Scope | null | undefined): void => {
    for (let scope = start; scope != null; scope = scope.parent) {
      if (scope.parent == null || below.has(scope)) return;
      if (seenScopes.has(scope)) return;
      seenScopes.add(scope);
      for (const binding of scope.bindings.values())
        if ('value' in binding) {
          const value = binding.value.storedValue;
          if (value !== undefined) pending.push(value);
        }
    }
  };
  while (pending.length > 0) {
    const expr = pending.pop()!;
    if (seenNodes.has(expr)) continue;
    seenNodes.add(expr);
    if (isDictionary(expr)) {
      for (const key of expr.keys) {
        const value = expr.get(key);
        if (value !== undefined) pending.push(value);
      }
      continue;
    }
    if (isSymbol(expr)) {
      const value = expr.valueDefinition?.storedValue;
      if (value !== undefined) pending.push(value);
      continue;
    }
    if (!isFunction(expr)) continue;
    if (expr.operator === 'Function') {
      visitScope(expr.op1.localScope);
      // The body of the literal can hold a view that has a record (a view
      // passed to the call and put in the closure that the call returns, or
      // a literal that host code built around a view).
      pending.push(expr.op1);
      continue;
    }
    if (expr._numericStore !== undefined) continue;
    const record = RECORDS.get(expr);
    if (record) {
      if (record.frames.includes(frame)) {
        RETAINED_SCOPES.add(frame);
        return;
      }
      visitScope(record.top.lexicalScope);
      for (const { entries } of record.nested ?? [])
        for (const [, , value] of entries)
          if (value !== undefined) pending.push(value);
    }
    for (const op of expr.ops) pending.push(op);
  }
}

/** Whether `expr` is a node whose operands can hold a view: a function
 * node that is not a function literal (its body is evaluated when it is
 * applied) and not a numeric store (it holds numbers only, and reading its
 * operands would box them). */
export function canHoldLazyView(expr: Expression): boolean {
  return (
    isFunction(expr) &&
    expr.operator !== 'Function' &&
    expr._numericStore === undefined
  );
}

/**
 * Give the views of `after` the records of the views of `before`, when
 * `after` is a rebuild of `before` made by a function call: the re-rooting
 * of the closures of the result (`captureClosures`), the substitution of the
 * parameter values (`bindingKeyedSubs`), and the rewrite of an argument that
 * reads locals of the caller (`bindLazyArgumentLocals`), all in
 * `function-utils.ts`. These rebuilds keep the operator and the number of
 * operands of each node they rebuild, and the keys of a dictionary, so the
 * two trees are walked in step. The walk goes into the body of a function
 * literal, which these rebuilds make again with new nodes. A node of `after` that already has a record
 * keeps it. A subtree that the rebuild left as it is (the same object) is
 * not walked, and a pair of nodes is walked once (a value can share a node
 * between several of its operands).
 *
 * Other rebuilds of a view (`subs()` of the host, `ce.function()` with new
 * operands, a serialization parsed again) make a new view that has no
 * record: it is read in the context of its reader, as a view made at the
 * top level is.
 */
export function carryLazyViewContexts(
  before: Expression,
  after: Expression
): void {
  const visited = new Map<Expression, Set<Expression>>();
  const visit = (b: Expression, a: Expression): void => {
    if (b === a) return;
    let seen = visited.get(b);
    if (seen === undefined) {
      seen = new Set();
      visited.set(b, seen);
    }
    if (seen.has(a)) return;
    seen.add(a);
    if (isDictionary(b) && isDictionary(a)) {
      for (const key of b.keys) {
        const bv = b.get(key);
        const av = a.get(key);
        if (bv !== undefined && av !== undefined) visit(bv, av);
      }
      return;
    }
    if (!isFunction(b) || !isFunction(a)) return;
    // The body of a function literal can hold a view that was made by the
    // call or passed to it (`(v) => () => ListFrom(v)` applied to
    // `Map(f, xs)`): the rebuild of the literal makes new nodes of its body.
    if (b.operator === 'Function' || a.operator === 'Function') {
      if (b.operator === a.operator && b.nops === a.nops) visit(b.op1, a.op1);
      return;
    }
    if (!canHoldLazyView(b) || !canHoldLazyView(a)) return;
    if (b.operator !== a.operator || b.nops !== a.nops) return;
    shareLazyViewRecord(b, a);
    for (let i = 0; i < b.nops; i++) visit(b.ops[i], a.ops[i]);
  };
  visit(before, after);
}

/**
 * Whether the nested scopes of `record` are still those of the creation:
 * each scope has the parent that it had then (the next nested scope, or the
 * frame for the outermost one), and each of its bindings is the one of the
 * creation and was not written since (its `_writeVersion`).
 *
 * The parent links are tested because a nested scope belongs to the body of
 * a function, which every call of the function shares: while a call of the
 * same function runs (a recursive call), the body scope has the frame of
 * that call as its parent (`makeLambda`, `function-utils.ts`), and the live
 * chain reads the bindings of that call.
 */
function nestedScopesUnchanged(record: LazyViewRecord): boolean {
  const nested = record.nested;
  if (nested === undefined) return true;
  const frame = record.contexts[record.contexts.length - 1].lexicalScope;
  for (let i = 0; i < nested.length; i++) {
    const { scope, entries, versions } = nested[i];
    if (scope.parent !== (nested[i + 1]?.scope ?? frame)) return false;
    if (scope.bindings.size !== entries.length) return false;
    for (let j = 0; j < entries.length; j++) {
      const [name, binding] = entries[j];
      if (scope.bindings.get(name) !== binding) return false;
      if ('value' in binding && binding.value._writeVersion !== versions[j])
        return false;
    }
  }
  return true;
}

/** The stack of `record` with the copies of its nested scopes (see the
 * header). */
function buildContexts(
  ce: IComputeEngine,
  record: LazyViewRecord
): ReadonlyArray<EvalContext> {
  if (record.nested === undefined) return record.contexts;
  let parent = record.contexts[record.contexts.length - 1].lexicalScope;
  for (let i = record.nested.length - 1; i >= 0; i--) {
    const { scope, entries } = record.nested[i];
    parent = copyNested!(ce, scope, parent, entries);
  }
  // A record context is never pushed or popped, so it has no parent link
  // to restore when it is popped (an ambient frame, `pushEvalContext`).
  const top: EvalContext = {
    ...record.top,
    lexicalScope: parent,
    name: 'lazy-view',
  };
  delete top._restoreParentOnPop;
  return [...record.contexts, top];
}

/**
 * The stack that a read of `expr` puts in place of the engine's stack, or
 * `undefined` when the read runs in the current context.
 *
 * When the context on top of the stack at the creation is still on the
 * stack and the nested scopes are unchanged (`nestedScopesUnchanged`), the
 * read uses the live stack up to that context (the reader is in that
 * context, or in a context above it, such as the frame of a function that
 * the view was passed to). Otherwise it uses the stack of the record
 * (`buildContexts`), from then on.
 *
 * With `concrete`, the live choice gives a copy of the live stack up to that
 * context also when the reader is in that context: an enumeration keeps the
 * stack of its start for each of its steps, and a later step can run after
 * the reader has left that context (`eachInLazyViewContext`).
 */
function contextsForRead(
  ce: IComputeEngine,
  expr: Expression,
  concrete = false,
  stack: ReadonlyArray<EvalContext> = ce._evalContextStack
): ReadonlyArray<EvalContext> | undefined {
  const record = RECORDS.get(expr);
  if (record == null) return undefined;
  if (record.built !== undefined) return record.built;
  const index = stack.lastIndexOf(record.top);
  if (index >= 0 && nestedScopesUnchanged(record)) {
    if (index === stack.length - 1 && !concrete) return undefined;
    return stack.slice(0, index + 1);
  }
  record.built = buildContexts(ce, record);
  return record.built;
}

/**
 * Run `fn`, a read of the view `expr`, with the creation context of the view
 * in place of the engine's context stack, and put the engine's stack back
 * when it ends (also when it throws). A view with no recorded stack runs
 * `fn` in the current context.
 *
 * The read runs on a copy of the recorded stack: a frame that the read
 * pushes (the call frame of the callback) never stays on the record, even
 * when the read throws. The frames of the record are not pushed again, so
 * their bindings are not disposed a second time.
 */
export function inLazyViewContext<T>(expr: Expression, fn: () => T): T {
  const ce = expr.engine as unknown as IComputeEngine;
  return inContexts(ce, contextsForRead(ce, expr), fn);
}

/**
 * The context stack on which an asynchronous evaluation of the view `expr`
 * runs, when the current stack of the evaluation is `stack`: a new array
 * that holds the creation context of the view, or `undefined` when the
 * evaluation runs on `stack` (the view has no record, or the reader is in
 * the context on top of the stack at the creation). The choice is the one
 * of a synchronous read (`inLazyViewContext`), made against `stack` and not
 * against the engine's stack: an asynchronous evaluation keeps its contexts
 * on its own array (`BoxedFunction.evaluateAsync`). The caller makes the
 * array a stack of its evaluation (`contextStackLike`,
 * `evaluation-epoch.ts`).
 */
export function lazyViewContextStack(
  expr: Expression,
  stack: ReadonlyArray<EvalContext>
): EvalContext[] | undefined {
  const ce = expr.engine as unknown as IComputeEngine;
  const recorded = contextsForRead(ce, expr, false, stack);
  return recorded === undefined ? undefined : [...recorded];
}

/** Run `fn` on a copy of `recorded` in place of the engine's stack, or in
 * the current context when `recorded` is `undefined` (see
 * `inLazyViewContext`). */
function inContexts<T>(
  ce: IComputeEngine,
  recorded: ReadonlyArray<EvalContext> | undefined,
  fn: () => T
): T {
  if (recorded === undefined) return fn();
  const saved = ce._evalContextStack;
  ce._evalContextStack = [...recorded];
  try {
    return fn();
  } finally {
    ce._evalContextStack = saved;
  }
}

/**
 * The elements of the view `expr`, as `make` enumerates them, with each step
 * of the enumeration run in the creation context of the view (see
 * `inLazyViewContext`). The enumeration is lazy: the context is in place
 * only while a step runs, not between two steps, when the reader runs. The
 * choice between the live stack and the copies (`contextsForRead`) is made
 * once, when the enumeration starts, and holds for each of its steps. When
 * the live stack is chosen, the enumeration keeps a copy of the live stack
 * of its start, up to the context on top of the stack at the creation. A
 * reader that takes one element, returns the view from the call that made
 * it, and takes the next element after that call has returned, gets the
 * next element in the context of that call, not in its own context.
 */
export function eachInLazyViewContext(
  expr: Expression,
  make: () => Generator<Expression>
): Generator<Expression> {
  if (!RECORDS.get(expr)) return make();
  return (function* () {
    const ce = expr.engine as unknown as IComputeEngine;
    const recorded = contextsForRead(ce, expr, true);
    const inner = inContexts(ce, recorded, make);
    try {
      while (true) {
        const step = inContexts(ce, recorded, () => inner.next());
        if (step.done) return;
        yield step.value;
      }
    } finally {
      // A reader that stops early (`break`) closes the inner enumeration
      // too, in the same context as its steps.
      inContexts(ce, recorded, () => inner.return(undefined));
    }
  })();
}
