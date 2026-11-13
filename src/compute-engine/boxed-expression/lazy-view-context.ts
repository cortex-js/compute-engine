/**
 * The activation of a lazy collection.
 *
 * A lazy collection (a `Map` or a `Filter` of an endless range, a lazy
 * comprehension) is made by an evaluation, and it computes its elements
 * later, when they are read. It keeps the activation it was made in, as a
 * function value does: a read of the collection runs with that activation as
 * the lexical scope, so a parameter, a binder variable or a block local of
 * the evaluation that made it is read through it, and a global is read when
 * the element is computed.
 *
 * See docs/SCOPING-MODEL.md, "Lazy view context lifetime".
 */

import type { Expression, IComputeEngine, Scope } from '../global-types.js';
import { isDictionary, isFunction, isSymbol } from './type-guards.js';
import { holdsActivation, isActivatedDefinition } from './ambient-chain.js';

/** One frame of the engine's evaluation-context stack. */
type EvalContext = IComputeEngine['_evalContextStack'][number];

/**
 * The activation of each lazy collection. `null` records a collection made
 * outside every activation: it is read in the context of its reader, which
 * resolves the same names (rule 1: a name resolves from its home scope).
 */
const RECORDS = new WeakMap<Expression, Scope | null>();

/** The local scopes of expression nodes (`noteNodeScope`). */
const NODE_SCOPES = new WeakSet<Scope>();

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
function setRecord(expr: Expression, record: Scope | null): void {
  RECORDS.set(expr, record);
  recordSerial += 1;
  const frame = CANONICALIZED_IN.get(expr);
  if (frame === undefined) return;
  CANONICALIZED_IN.delete(expr);
  CANONICALIZED_COUNT.set(frame, (CANONICALIZED_COUNT.get(frame) ?? 1) - 1);
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
 * its end as at its start made no lazy collection, directly or in a call
 * that it made, and need not walk its result to carry records. */
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

/** The activation that the lazy collection `expr` keeps, or `undefined`. */
export function lazyViewActivationOf(expr: Expression): Scope | undefined {
  return RECORDS.get(expr) ?? undefined;
}

/** Give `to` the record of `from`, if `from` has one. */
export function shareLazyViewRecord(from: Expression, to: Expression): void {
  const own = RECORDS.get(from);
  if (own === undefined || RECORDS.has(to)) return;
  setRecord(to, own);
}

/** The activation of the evaluation whose context stack is `stack`: the
 * lexical scope on top of it when its chain holds an activation, or `null`. */
function activationOf(stack: ReadonlyArray<EvalContext>): Scope | null {
  const scope = stack[stack.length - 1]?.lexicalScope;
  return scope !== undefined && holdsActivation(scope) ? scope : null;
}

/**
 * The value `result` of the evaluation of `source` on the context stack
 * `stack`, with the record of its activation when it is a lazy collection
 * made now.
 *
 * - A result that is not a lazy collection, or that keeps an activation
 *   (made by an inner evaluation, or a memo hit), is returned as it is.
 * - When `source` is a lazy collection with a record (a stored collection
 *   read again), the result takes that record: it is the same collection.
 * - When `source` is not a lazy collection, the evaluation did not make the
 *   result (the value of a variable), which is returned as it is.
 * - Otherwise the result keeps the activation on top of `stack`. A result
 *   that is `source` itself (a node of a function body, which every call of
 *   the function evaluates), or a node made outside every activation (a memo
 *   hit of an evaluation made then), is copied first, so that each
 *   evaluation has its own record.
 */
export function recordLazyViewContext(
  source: Expression,
  result: Expression,
  stack: ReadonlyArray<EvalContext>
): Expression {
  if (!isFunction(result) || !result.isLazyCollection) return result;
  const known = RECORDS.get(result);
  if (known != null) return result;
  const own = RECORDS.get(source);
  if (known === undefined && own !== undefined) {
    if (result !== source) setRecord(result, own);
    return result;
  }
  // A collection that the evaluation did not make (the value of a
  // variable, a result that an `If` selects) keeps what it has.
  if (!isFunction(source) || !source.isLazyCollection) return result;
  const activation = activationOf(stack);
  if (activation === null || !readsActivatedName(result)) {
    if (known === undefined && result !== source) setRecord(result, null);
    return result;
  }
  const made = withActivatedOperandValues(result);
  if (made !== result) {
    if (!isFunction(made) || !made.isLazyCollection) return made;
    setRecord(made, readsActivatedName(made) ? activation : null);
    return made;
  }
  const node =
    result === source || known === null
      ? result.engine._fn(result.operator, [...result.ops], {
          scope: result.localScope,
        })
      : result;
  setRecord(node, activation);
  return node;
}

/**
 * The lazy collection `e` made now, with each operand that is a variable
 * whose value an activation holds replaced with that value, as the
 * arguments of a call are, or `e` when it has none. An operand that is
 * itself a lazy collection gets the same replacement. A name that the
 * scope of `e` binds (the index of a comprehension) is not an operand
 * value. The collection is boxed again, so the checks of its operands run
 * on their values: `Map((t: real) ↦ 2t, L)` with `L = [[1, 2]]` is an
 * `incompatible-type` error.
 */
function withActivatedOperandValues(e: Expression): Expression {
  if (!isFunction(e) || !e.isLazyCollection) return e;
  let changed = false;
  const ops = e.ops.map((op) => {
    if (isFunction(op)) {
      const value = withActivatedOperandValues(op);
      if (value !== op) changed = true;
      return value;
    }
    if (!isSymbol(op) || e.localScope?.bindings.has(op.symbol)) return op;
    const def = op.valueDefinition;
    if (def === undefined || def.isConstant || !isActivatedDefinition(def))
      return op;
    const value = op.evaluate();
    if (!value.isValid || value === op) return op;
    changed = true;
    return value;
  });
  return changed ? e.engine.function(e.operator, ops) : e;
}

/** The collections that read a name whose value an activation holds
 * (`readsActivatedName`). Only `true` is kept: a definition is marked
 * activated at the first evaluation of its scope, so a `false` can change. */
const READS_ACTIVATED_NAME = new WeakSet<Expression>();

/** Whether the collection `expr` reads, in an operand or in the body of a
 * callback, a name that it does not bind itself and whose value an
 * activation holds: a parameter, a binder variable or a block local
 * (`isActivatedDefinition`). A symbol with no definition (held content)
 * may be such a name. A collection that reads none needs no activation. */
function readsActivatedName(expr: Expression): boolean {
  if (READS_ACTIVATED_NAME.has(expr)) return true;
  const visited = new Set<Expression>();
  // The definitions that a scope of `expr` binds: an occurrence of one is
  // not a read of a name outside `expr`. A scope is met before the
  // occurrences of its names.
  const bound = new Set<object>();
  const visit = (e: Expression): boolean => {
    if (visited.has(e)) return false;
    visited.add(e);
    if (isSymbol(e)) {
      const def = e.valueDefinition;
      if (def === undefined) return e.operatorDefinition === undefined;
      return isActivatedDefinition(def) && !bound.has(def);
    }
    if (isDictionary(e)) return e.values.some(visit);
    if (!isFunction(e) || e._numericStore !== undefined) return false;
    noteOwnNames(e, bound);
    const def = e.valueDefinition;
    if (def !== undefined && isActivatedDefinition(def) && !bound.has(def))
      return true;
    return e.ops.some(visit);
  };
  const reads = visit(expr);
  if (reads) READS_ACTIVATED_NAME.add(expr);
  return reads;
}

/** Add to `bound` the definitions of the names that the node `e` binds: the
 * parameters of a function literal, and the binder variables and the block
 * locals of its scope. Its scope can also hold the binding of a parameter of
 * an enclosing literal that its body reads, which `e` does not bind. */
function noteOwnNames(e: Expression, bound: Set<object>): void {
  if (isFunction(e, 'Function'))
    for (const param of e.ops.slice(1)) {
      const name = isFunction(param, 'Typed') ? param.op1 : param;
      const def = name?.valueDefinition;
      if (def !== undefined) bound.add(def);
    }
  const scope = e.localScope;
  if (scope === undefined) return;
  for (const [name, binding] of scope.bindings) {
    if (!('value' in binding)) continue;
    const def = binding.value as { _blockLocal?: boolean };
    if (def._blockLocal === true || scope.binderNames?.has(name) === true)
      bound.add(binding.value);
  }
}

/**
 * Give the view `view`, a node of the value that a call returns that was
 * never evaluated (a lazy operator of the body holds it), the activation of
 * the call on `stack`. The caller (`adoptHeldLazyViews`,
 * `function-utils.ts`) passes a new node: the held node is a node of the
 * function body that every call shares, and a record on it would be read by
 * the views of the other calls.
 */
export function adoptLazyView(
  view: Expression,
  stack: ReadonlyArray<EvalContext>
): void {
  if (RECORDS.has(view)) return;
  for (let i = stack.length - 1; i >= 0; i--)
    if (stack[i].name === 'call') {
      setRecord(view, stack[i].lexicalScope);
      return;
    }
  setRecord(view, null);
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
 * that has no record yet (see `noteLazyViewCanonicalized`). */
export function canonicalizedLazyViewsIn(frame: Scope): boolean {
  return (CANONICALIZED_COUNT.get(frame) ?? 0) > 0;
}

/** Whether the view `view` was canonicalized during the call of the frame
 * `frame`, and not during a call that it made (see
 * `noteLazyViewCanonicalized`). */
export function wasCanonicalizedIn(view: Expression, frame: Scope): boolean {
  return CANONICALIZED_IN.get(view) === frame;
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
 * of the closures of the result (`captureClosures`) and the substitution of
 * the parameter values (`bindingKeyedSubs`), in `function-utils.ts`. These
 * rebuilds keep the operator and the number of operands of each node they
 * rebuild, and the keys of a dictionary, so the two trees are walked in
 * step. The walk goes into the body of a function literal, which these
 * rebuilds make again with new nodes. A node of `after` that already has a
 * record keeps it. A subtree that the rebuild left as it is (the same
 * object) is not walked, and a pair of nodes is walked once.
 *
 * Other rebuilds of a view (`subs()` of the host, `ce.function()` with new
 * operands, a serialization parsed again) make a new view that has no
 * record: it is read in the context of its reader.
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

/** The context that a read of `expr` pushes, or `undefined` when the read
 * runs in the current context: `expr` has no activation, or the reader is
 * in it. */
function readContext(
  expr: Expression,
  stack: ReadonlyArray<EvalContext>
): EvalContext | undefined {
  const scope = RECORDS.get(expr);
  if (scope == null) return undefined;
  const top = stack[stack.length - 1];
  if (top === undefined || top.lexicalScope === scope) return undefined;
  return {
    lexicalScope: scope,
    name: 'lazy-view',
    assumptions: top.assumptions,
    assumedValues: top.assumedValues,
    _uncounted: true,
  } as EvalContext;
}

/**
 * Run `fn`, a read of the collection `expr`, with the activation of `expr`
 * as the lexical scope. A collection with no activation runs `fn` in the
 * current context.
 */
export function inLazyViewContext<T>(expr: Expression, fn: () => T): T {
  const ce = expr.engine as unknown as IComputeEngine;
  const context = readContext(expr, ce._evalContextStack);
  if (context === undefined) return fn();
  const stack = ce._evalContextStack;
  stack.push(context);
  try {
    return fn();
  } finally {
    const i = stack.lastIndexOf(context);
    if (i >= 0) stack.splice(i, 1);
  }
}

/**
 * The context stack on which an asynchronous evaluation of the collection
 * `expr` runs, when the current stack of the evaluation is `stack`: a new
 * array with the activation of `expr` on top, or `undefined` when the
 * evaluation runs on `stack`.
 */
export function lazyViewContextStack(
  expr: Expression,
  stack: ReadonlyArray<EvalContext>
): EvalContext[] | undefined {
  const context = readContext(expr, stack);
  return context === undefined ? undefined : [...stack, context];
}

/**
 * The elements of the collection `expr`, as `make` enumerates them, with
 * each step of the enumeration run in the activation of `expr` (see
 * `inLazyViewContext`). The activation is in place only while a step runs,
 * not between two steps, when the reader runs.
 */
export function eachInLazyViewContext(
  expr: Expression,
  make: () => Generator<Expression>
): Generator<Expression> {
  if (!RECORDS.get(expr)) return make();
  return (function* () {
    const inner = inLazyViewContext(expr, make);
    try {
      while (true) {
        const step = inLazyViewContext(expr, () => inner.next());
        if (step.done) return;
        yield step.value;
      }
    } finally {
      // A reader that stops early (`break`) closes the inner enumeration
      // too, in the same context as its steps.
      inLazyViewContext(expr, () => inner.return(undefined));
    }
  })();
}
