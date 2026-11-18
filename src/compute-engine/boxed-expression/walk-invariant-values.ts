import { cacheOff } from '../../common/cache-switches.js';
import type { Expression } from '../global-types.js';
import { staticViewDiverges } from '../static-typing-view.js';
import { boundVariableNames, readsActivationHalf } from './binders.js';
import { hiddenValuesKey } from './hidden-values.js';
import { beginStoreGuard } from './store-guard.js';
import { isDictionary, isFunction, isSymbol } from './type-guards.js';

/**
 * The values of the sub-expressions of a callback that do not depend on the
 * call, kept for one walk of a lazy collection operator (`Map`, `Filter`).
 *
 * The body of a callback is evaluated at each element
 * (`docs/SCOPING-MODEL.md`, "Callable resolution"). A sub-expression of the
 * body that reads no parameter and no other name bound in the callback has
 * the same value at each element, as long as the state does not change. In
 * `Map(j ↦ At(Abs(C), j), Range(1, n))`, `Abs(C)` was evaluated again at each
 * of the `n` elements, so the walk took a time that grows with the square of
 * `n` when `C` is a computed list.
 *
 * A walk wraps its callback with {@link walkInvariantApplicable}. While the
 * callback runs, the first evaluation of an invariant sub-expression keeps
 * its value, and each later evaluation of the same node in the same walk
 * gives that value ({@link walkInvariantValue}, called by
 * `BoxedFunction.evaluate()`).
 *
 * A sub-expression is invariant when:
 * - the body of the callback is pure, so that a call changes no state other
 *   than its own parameters and locals;
 * - it is a function expression and it is pure;
 * - none of its symbols, call heads and dictionary values included, is a
 *   name that a node of the callback binds (a parameter, a local of a
 *   block, the variable of a binder), and none reads an activation (a
 *   parameter or a local of an enclosing call), so that its names read the
 *   same definitions at each element.
 *
 * Only a value that is a collection is kept: this is the case that costs a
 * time that grows with the length of the collection at each element.
 *
 * A value is used only for a plain evaluation (no numeric approximation, no
 * materialization), and only while the state that it can depend on is the
 * one in which it was computed. The application of the callback writes its
 * parameters, which advances `_anyVersion` at each element, so the state is
 * compared between two calls: when a value write, a global change or a store
 * to the field of an object happened after the end of one call and before
 * the start of the next (a consumer of the walk that writes between two
 * elements), the values are discarded. Inside a call, the body is pure: it
 * writes only the names that it binds, which no kept value reads. A value is
 * served only in the precision, angular unit and visibility of the
 * assumptions in which it was computed, and no value is kept or served inside
 * a transient configuration window (`ce._atTransientConfiguration`): these
 * change with no version.
 *
 * A value computed while host code that does not state its purity ran (the
 * store guard, `store-guard.ts`) is not kept.
 *
 * The purity of a node can change when a callable that it calls is defined
 * again (`ce._callableVersion`): the invariant nodes are then found again,
 * also between two calls of a walk.
 */

type Walk = {
  /** The invariant nodes of the callback, found at `callableVersion`. */
  nodes: ReadonlySet<Expression>;
  callableVersion: number;
  /** The values kept, for each invariant node evaluated in this walk. */
  readonly values: Map<Expression, Kept>;
  /** The invariant nodes whose value in this walk is not a collection: they
   * are evaluated at each element, with no other work. */
  readonly skipped: Set<Expression>;
  /** The nodes whose first evaluation is in progress. */
  readonly computing: Set<Expression>;
  /** The versions at the end of the last call (`-1` before the first call). */
  anyVersion: number;
  worldVersion: number;
  objectStoreEpoch: number;
};

/** A kept value, with the inputs of an evaluation that change with no
 * version, as in the memo of shared nodes (`shared-evaluation-memo.ts`). A
 * handler of the body can open a bracket that changes them inside a call (a
 * transient precision or angular unit, a fact-blind bracket, a value
 * shield, a seed frame, a verification). */
type Kept = {
  value: Expression;
  precision: number;
  requested: unknown;
  angularUnit: string;
  factsHidden: boolean;
  randomFrame: unknown;
  hidden: unknown;
  verifying: boolean;
  effects: unknown;
};

/** The inputs of `Kept` in the current state of `ce`, with `value`. */
function keptNow(ce: Expression['engine'], value: Expression): Kept {
  return {
    value,
    precision: ce.precision,
    requested: ce._requestedPrecision,
    angularUnit: ce.angularUnit,
    factsHidden: ce._factsHidden(),
    randomFrame: ce._randomFrame,
    hidden: hiddenValuesKey(),
    verifying: ce.isVerifying,
    effects: ce._evaluationEffects ?? ce.effects,
  };
}

/** True when the inputs recorded in `kept` are those of the current state. */
function keptStillValid(ce: Expression['engine'], kept: Kept): boolean {
  return (
    kept.precision === ce.precision &&
    kept.requested === ce._requestedPrecision &&
    kept.angularUnit === ce.angularUnit &&
    kept.factsHidden === ce._factsHidden() &&
    kept.randomFrame === ce._randomFrame &&
    kept.hidden === hiddenValuesKey() &&
    kept.verifying === ce.isVerifying &&
    kept.effects === (ce._evaluationEffects ?? ce.effects)
  );
}

/** The walk whose callback is running, or `undefined`. */
let active: Walk | undefined;

/** The invariant nodes of each function literal, with the callable
 * version they were found at. */
const INVARIANT_NODES = new WeakMap<
  Expression,
  { callableVersion: number; nodes: ReadonlySet<Expression> }
>();

/**
 * `f`, the application of the callback `fn` (`applicable(fn)`), wrapped so
 * that the invariant sub-expressions of `fn` are evaluated once in the walk
 * that calls the result. Call this once per walk. When `fn` has no invariant
 * sub-expression, `f` itself.
 *
 * `fn` can also be the callbacks of the levels of a lowered chain of `Map`s
 * (`map-lowering.ts`), whose runner `f` evaluates the operands of each body.
 */
export function walkInvariantApplicable<O>(
  fn: Expression | ReadonlyArray<Expression>,
  f: (xs: ReadonlyArray<Expression>, options?: O) => Expression | undefined
): (xs: ReadonlyArray<Expression>, options?: O) => Expression | undefined {
  if (cacheOff('walkinvariant')) return f;
  const fns = Array.isArray(fn) ? fn : [fn as Expression];
  if (fns.length === 0) return f;
  const nodes = invariantNodesOf(fns);
  if (nodes.size === 0) return f;
  const ce = fns[0].engine;
  const walk: Walk = {
    nodes,
    callableVersion: ce._callableVersion,
    values: new Map(),
    skipped: new Set(),
    computing: new Set(),
    anyVersion: -1,
    worldVersion: -1,
    objectStoreEpoch: -1,
  };
  return (xs, options) => {
    if (
      walk.anyVersion !== ce._anyVersion ||
      walk.worldVersion !== ce._worldVersion ||
      walk.objectStoreEpoch !== ce._objectStoreEpoch
    ) {
      walk.values.clear();
      walk.skipped.clear();
      if (walk.callableVersion !== ce._callableVersion) {
        walk.nodes = invariantNodesOf(fns);
        walk.callableVersion = ce._callableVersion;
      }
    }
    const saved = active;
    active = walk;
    try {
      return f(xs, options);
    } finally {
      active = saved;
      walk.anyVersion = ce._anyVersion;
      walk.worldVersion = ce._worldVersion;
      walk.objectStoreEpoch = ce._objectStoreEpoch;
    }
  };
}

/**
 * The value of `expr` in the walk in progress, when `expr` is an invariant
 * node of its callback: the value kept, or the value of
 * `expr.evaluate(options)`, which is then kept when it can be. `undefined`
 * when `expr` is not such a node: the caller evaluates it.
 *
 * The caller calls this only for a plain evaluation (no numeric
 * approximation, no materialization).
 */
export function walkInvariantValue(
  expr: Expression,
  options: Parameters<Expression['evaluate']>[0]
): Expression | undefined {
  const walk = active;
  if (walk === undefined || !walk.nodes.has(expr)) return undefined;
  if (walk.computing.has(expr) || walk.skipped.has(expr)) return undefined;
  const ce = expr.engine;
  // Inside a type computation a variable has no value, so a value computed
  // outside it is not the value there (`eager-source-values.ts`). Inside a
  // transient configuration window, a value is neither kept nor served, as
  // in the element memo (`collection-element-memo.ts`).
  if (staticViewDiverges(ce) || ce._atTransientConfiguration) return undefined;
  const kept = walk.values.get(expr);
  if (kept !== undefined && keptStillValid(ce, kept)) return kept.value;
  // The inputs at the start of the evaluation, as the shared memo records
  // them.
  const inputs = keptNow(ce, expr);
  walk.computing.add(expr);
  const guard = beginStoreGuard();
  let value: Expression;
  try {
    value = expr.evaluate(options);
  } finally {
    walk.computing.delete(expr);
  }
  if (!value.isCollection) walk.skipped.add(expr);
  else if (guard.allowsStore() && keptStillValid(ce, inputs))
    walk.values.set(expr, { ...inputs, value });
  return value;
}

/** The invariant nodes of the callbacks `fns`. */
function invariantNodesOf(
  fns: ReadonlyArray<Expression>
): ReadonlySet<Expression> {
  const nodes = invariantNodes(fns[0]);
  if (fns.length === 1) return nodes;
  const all = new Set(nodes);
  for (const other of fns.slice(1))
    for (const node of invariantNodes(other)) all.add(node);
  return all;
}

/** The invariant nodes of the function literal `fn` (see the head of this
 * module), the nodes inside an invariant node too. Empty when `fn` is not
 * a function literal with a body, or when its body is not pure. */
function invariantNodes(fn: Expression): ReadonlySet<Expression> {
  const callableVersion = fn.engine._callableVersion;
  const known = INVARIANT_NODES.get(fn);
  if (known !== undefined && known.callableVersion === callableVersion)
    return known.nodes;
  const nodes = computeInvariantNodes(fn);
  INVARIANT_NODES.set(fn, { callableVersion, nodes });
  return nodes;
}

const NO_NODES: ReadonlySet<Expression> = new Set();

function computeInvariantNodes(fn: Expression): ReadonlySet<Expression> {
  if (!isFunction(fn, 'Function') || fn.nops < 2) return NO_NODES;
  const body = fn.op1;
  if (!body.isPure) return NO_NODES;

  // Every name that a node of the literal binds, the literal included.
  const bound = new Set<string>();
  const collectBound = (expr: Expression): void => {
    for (const name of boundVariableNames(expr)) bound.add(name);
    if (isFunction(expr)) for (const op of expr.ops) collectBound(op);
  };
  collectBound(fn);

  const closed = new Map<Expression, boolean>();
  // A name, or a call head (`g()` with `g` a parameter that holds a
  // function), that reads the same definition at each element.
  const isFreeName = (
    name: string,
    def: Expression['valueDefinition']
  ): boolean =>
    !bound.has(name) && (def === undefined || !readsActivationHalf(def));
  const isClosed = (expr: Expression): boolean => {
    const known = closed.get(expr);
    if (known !== undefined) return known;
    let result: boolean;
    if (isSymbol(expr)) {
      result = isFreeName(expr.symbol, expr.valueDefinition);
    } else if (isFunction(expr)) {
      result =
        expr.operator !== 'Function' &&
        expr.localScope === undefined &&
        isFreeName(expr.operator, expr.valueDefinition) &&
        expr.ops.every(isClosed);
    } else if (isDictionary(expr)) {
      result = expr.values.every(isClosed);
    } else result = true;
    closed.set(expr, result);
    return result;
  };

  // Every closed pure node, not only the largest: a node whose value is not
  // a collection is skipped (`Max(Abs(C))` in `At(C, j) / Max(Abs(C))`), and
  // its operands are then kept (`Abs(C)`). A kept node is not evaluated, so
  // the nodes inside it are not reached.
  const found = new Set<Expression>();
  const visit = (expr: Expression): void => {
    if (!isFunction(expr)) return;
    if (isClosed(expr) && expr.isPure) found.add(expr);
    for (const op of expr.ops) visit(op);
  };
  visit(body);
  return found.size === 0 ? NO_NODES : found;
}
