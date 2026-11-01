/**
 * The evaluation context in which a lazy collection view that calls a
 * callback was created, and the reads of the view that run in it.
 *
 * A lazy view such as `Map(f, xs)` computes its elements when it is read, not
 * when it is evaluated. A read can happen after the function whose body made
 * the view has returned. The call of the callback then took place in the
 * context of the reader, and a name that the call reads by its binding in
 * the context, such as the symbol default `d` of a parameter
 * `(x, k = d) => x * k` that the call fills, was read where the view was
 * read, not where `Map(f, xs)` was written. With
 * `g := (d, xs) => Map(f, xs)`, the elements of `g(10, [1, 2])` were `d` and
 * `2d`, while the compiled function and a read inside `g` give `[10, 20]`.
 *
 * The operators of such views set the flag `callsCallbackOnRead` of their
 * collection handlers (`Map`, `Filter`, `Scan`, `TakeWhile`, `DropWhile`,
 * `FlatMap`, `Tabulate`, `Iterate`, `Fill`, and an operator of the host that
 * sets the flag). A view of such an operator that is created during a
 * function call gets a record of the context of that call
 * (`recordLazyViewContext`):
 *
 * - the context stack up to and including the frame of the innermost call
 *   (the context named `call`);
 * - the context on top of the stack at the creation;
 * - when that context is a scope nested in the body between the top and the
 *   frame (a `Block`, the branch of an `If`, a loop body), the bindings of
 *   each nested scope, their values and their write versions at the
 *   creation. No scope is copied and no definition is made at the creation,
 *   so a view that the call reads at once (an operand of `ListFrom` or
 *   `Sum`, a view per loop iteration) costs little;
 * - the call frames on the stack that the scope chain of that context
 *   reaches (`frames`): the frame of the call, and the frame of each outer
 *   call whose closure the call runs.
 *
 * The frame of a call is not copied: a frame that a view can read after the
 * call stays alive. At the end of each call, before its pop, the frame is
 * marked as retained (`isRetainedScope`) when a view whose record names
 * it is reachable from the value that the call returns
 * (`retainCallFrameOfResult`; the walk also goes into the bodies and the
 * scopes of the closures of that value and into the scopes of the records
 * it meets). The
 * pop of a retained frame does not dispose its definitions and does not
 * tombstone them (`discardEvalContext`, `engine-scope.ts`), so a read after
 * the call has returned resolves the names of the frame to live definitions
 * with their declared type and their values. Each call has a new frame, and
 * no other call writes in it, so its values are those of the end of the
 * call, unless a closure that the call returned shares the frame and writes
 * in it. A call that reads its views at once (`ListFrom(Map(f, xs))`)
 * returns no view, and its frame is disposed at its pop, as any frame,
 * unless the call makes a function literal whose scope chain reaches the
 * frame, or returns a node whose chain reads it
 * (`retainScope`).
 *
 * The cost of a retained frame: its definitions are never marked
 * `disposed`, so the readers of that flag (`collectTypeContributions` in
 * `constraint-subject.ts`, `restoreAssumptions` in `checkpoint.ts`,
 * `assume.ts`) treat them as live, their
 * `_writeVersion` does not advance at the pop, and the debug check of dead
 * bindings (`ce._debugBindings`) does not cover them. The set of retained
 * frames is weak: a frame that no record and no closure holds any more is
 * freed. A view
 * that leaves a call by a way the walk does not follow (host code that keeps
 * it) does not retain the frame: a later read resolves names in disposed
 * definitions, which keep their values, so it gives the values of the call.
 * The debug check reports such a read only where it evaluates a symbol bound
 * to a disposed definition (`assertLiveBinding`, called by `boxed-symbol.ts`),
 * not where it resolves a name, such as the symbol default of a parameter.
 *
 * The nested scopes are different: they belong to the function body, which
 * every call shares, the next iteration of a loop writes another value in
 * its index, the pop of a block disposes its locals, and while another call
 * of the same function runs (a recursive call) the body scope has the frame
 * of that call as its parent. A view reads the bindings of the nested
 * scopes with their values at its creation. A read uses the live stack when
 * the context on top of the stack at the creation is still on the stack,
 * each nested scope has the parent that it had at the creation, and each of
 * its bindings is the one of the creation and was not written since
 * (`nestedScopesUnchanged`). Otherwise (the block has ended, the loop has
 * advanced, a local was assigned again, a recursive call is running, the
 * call has returned) the read uses a copy of the nested scopes, made once
 * per record by
 * `function-utils.ts` (`setLazyViewNestedScopeCopier`) and chained onto the
 * frame: each value binding gets a clone of its definition, with its
 * declared type and flags, that holds the value at the creation. A closure
 * differs here: it shares the `let` locals of a nested block
 * (`captureNestedLocals`, `function-utils.ts`), and sees a later write.
 *
 * Each read of a view with a record (its elements, an element by index, its
 * count, and the other collection facets that `BoxedFunction` dispatches to
 * the handlers) puts the stack of the record in place of the engine's stack
 * while it runs (`inLazyViewContext`, `eachInLazyViewContext`). An
 * enumeration chooses between the live stack and the copies once, when it
 * starts, and keeps the stack of its start for each step: a step that runs
 * after the call has returned reads the context of the call. An evaluation
 * of a view with a record runs in that context too (`BoxedFunction.evaluate`,
 * and `BoxedFunction.evaluateAsync` on a stack of its asynchronous
 * evaluation, `lazyViewContextStack`): the numeric pass of an outer call
 * evaluates a returned view again, and fills the default of a parameter of
 * its callback by name.
 *
 * The end of a call rebuilds the value that it returns (the re-rooting of
 * the closures, `captureClosures`, and the substitution of the parameter
 * values, `bindingKeyedSubs`), and the start of a call rewrites each
 * argument that reads locals of the caller (`bindLazyArgumentLocals`). A
 * rebuilt view takes the record of the view it replaces, also in the body
 * of a function literal (`carryLazyViewContexts`). A view that is never evaluated has
 * no record: a view of the function body that is an operand of a lazy
 * operator of the body (`Dedup(Map(f, xs))`), or a view canonicalized during
 * the call (`ReleaseHold(Hold(Dedup(Map(f, xs))))`, noted by
 * `noteLazyViewCanonicalized`). Before these rebuilds, the end of the call
 * gives such a view of its result a record of the call, on a new node,
 * because a held node of the body is shared by every call (`adoptLazyView`,
 * called by `adoptHeldLazyViews` in `function-utils.ts`). A view that the
 * call did not make (the value of a symbol that the body reads, made at the
 * top level or in another call) is not adopted.
 *
 * A view created outside every function call (at the top level, or in a
 * `Block` of the top level) has the record `null`: it is read in the context
 * of the reader, as before this record existed.
 *
 * The design is in `docs/plans/2026-10-31-parameter-default-values.md`
 * (§11, item 6).
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
 * Mark the call frame `frame` as retained: its pop does not dispose its
 * definitions and does not tombstone them (`discardEvalContext`,
 * `engine-scope.ts`). Call it when the call creates a function literal whose
 * scope chain reaches the frame, or at the end of the call, before its pop,
 * when the value that the call returns holds a closure (or another scoped
 * node) whose scope chain reaches the frame.
 *
 * Such a closure can read the names of the frame after the call has
 * returned, also by name and not only through a symbol of its body: the
 * symbol default of a parameter of a function that the closure applies
 * (`f := (x, k = d) => x * k` and `d ↦ (xs ↦ ListFrom(Map(f, xs)))`) is
 * resolved in the context of the application of `f`, whose chain goes
 * through the frame. The definitions of the frame are then still in use, and
 * the debug check of dead bindings (`ce._debugBindings`) reported the read of
 * `d` as a read of a discarded scope. Without the debug flag the value was
 * the same, because a disposed definition keeps its value. The cost is the
 * cost of a frame that a view retains (see the header).
 *
 * Two places in `function-utils.ts` call it:
 * - the creation of a closure in the body of a running call, when its chain
 *   reaches the frame of that call (`rerootOnCreatingFrame`, called by the
 *   `Function` handler through `captureAtCreation`). The closure can leave
 *   the call by a way that the end of the call does not see: an assignment
 *   to an outer variable (`o := d ↦ Block(g := (xs ↦ ListFrom(Map(f, xs))),
 *   0)`, then `g([1, 2])`), or a value stored in an outer collection. So
 *   each call that makes such a closure retains its frame, also when the
 *   closure does not leave the call (`ListFrom(Map(x ↦ x + d, xs))`): a
 *   simple rule that is sound, at the cost above;
 * - the end of a call, when the value that it returns holds a node whose
 *   chain reads the frame and that was not made by an evaluation of a
 *   function literal in the call (a held literal, a scoped node), counted by
 *   `nodesReadingLeftCall`.
 *
 * The local scope of a node (a block, a loop, a comprehension, a big
 * operator) is marked too, when a closure has a chain that reaches it
 * (`retainScopesReachedByLiteral` in `function-utils.ts`): the closure
 * reads an index through the binding of a symbol of its body, or a `let`
 * local of a block by name. The pop
 * of such a scope still disposes its definitions, as before, and only does
 * not tombstone them (`discardEvalContext`); see there for why.
 *
 * A closure that leaves a call without one of these steps does not retain
 * the frame: a function literal that host code builds around the scope of a
 * call and keeps in its own data, or a literal that a host operator holds
 * unevaluated and stores. A later read resolves names in disposed
 * definitions, which keep their values, so it gives the values of the call,
 * and the debug check of dead bindings reports it where it evaluates a
 * symbol bound to such a definition (`assertLiveBinding`).
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
  if (own !== undefined && !RECORDS.has(to)) setRecord(to, own);
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
  const frameContext = stack[frameIndex];
  const frame = frameContext.lexicalScope;
  let top = inFrame ? frameContext : stack[stack.length - 1];
  let nested: LazyViewRecord['nested'] = undefined;
  if (top.lexicalScope !== frame) {
    const scopes: NonNullable<LazyViewRecord['nested']>[number][] = [];
    let scope: Scope | null = top.lexicalScope;
    while (scope !== null && scope !== frame) {
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
    if (scope === null) top = frameContext;
    else nested = scopes;
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
  setRecord(result, own !== undefined ? own : newRecord(stack, false));
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
