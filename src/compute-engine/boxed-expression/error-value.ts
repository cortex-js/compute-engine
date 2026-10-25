import type { Expression, FunctionInterface } from '../global-types.js';
import { CancellationError } from '../../common/interruptible.js';
import { isFunction, isNumber, isString } from './type-guards.js';

/**
 * Structural containers whose contents are DATA, not the structure of a
 * failing computation, and which carry NO `collection` handler block (so
 * `isCollectionHead()` cannot derive them from the definition):
 *
 * - `Dictionary` has no operator definition at all — a dictionary literal
 *   canonicalizes to the engine's compact `BoxedDictionary` representation;
 * - `KeyValuePair` canonicalizes to a `Tuple` when both operands are valid, so
 *   the only `KeyValuePair` NODES that survive are the invalid ones — exactly
 *   the case this set has to cover.
 */
const STRUCTURAL_CONTAINERS = new Set(['Dictionary', 'KeyValuePair']);

/**
 * True if `expr`'s head denotes a COLLECTION — a container whose operands are
 * elements, not the structure of a computation.
 *
 * Derived from the DEFINITION (the `collection` handler block the engine uses
 * to decide collection-ness everywhere else), not from a name list; the
 * literal set above only fills in the two structural containers that have no
 * such block. Deliberately NOT `expr.isCollection`, which is `false` for
 * most invalid expressions (all but the literals of
 * `isIterableWithFailedCells()`) — the only case that reaches here.
 */
export function isCollectionHead(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  if (STRUCTURAL_CONTAINERS.has(expr.operator)) return true;
  return expr.baseDefinition?.collection !== undefined;
}

/**
 * True when `expr` is a `List` or a `Set` literal. Such a literal is a
 * collection that can be iterated also when it holds a failed cell (an
 * element that is, or embeds, an `Error`): the error is a failure of that
 * element, not of the container (`docs/ERROR-MODEL.md` §3). Its count is the
 * number of its operands, and a walk of its elements gives the failed cell as
 * the value of that element. A loop body, a `Map` callback or a comprehension
 * body then receives an `Error` value, and the ordinary error rules apply to
 * what it computes with it.
 *
 * The tree stays invalid (`isValid` is `false`, and `.errors` lists the
 * error), so this is a test of the HEAD only: the caller has already found
 * the tree invalid. A `Tuple` is not included: a tuple is one value (a
 * point), not a sequence of independent elements, so a failed coordinate
 * keeps the whole tuple frozen.
 */
export function isIterableWithFailedCells(expr: Expression): boolean {
  return (
    isFunction(expr) && (expr.operator === 'List' || expr.operator === 'Set')
  );
}

/**
 * True when `expr` is an invalid tree that is not a collection value: an
 * operator that reads `expr` as a collection must decline (or keep the error
 * in place), as for any other invalid operand.
 *
 * `false` for a valid tree, for a `List` or `Set` literal that holds a failed
 * cell (`isIterableWithFailedCells()`), and for a collection operator (a view
 * such as `Map`, `Take` or `Reverse`) whose only errors sit in the cells of
 * such literals: these are collections that can be iterated, and their
 * elements give the failed cell as a value.
 */
export function isInvalidNonCollection(expr: Expression): boolean {
  if (expr.isValid || isIterableWithFailedCells(expr)) return false;
  return !(isCollectionHead(expr) && failedCellsAreIterable(expr));
}

/**
 * True when every `Error` in the operands of `expr` sits in a cell of a
 * `List` or `Set` literal (`isIterableWithFailedCells()`), so that an
 * operator can read such an operand as a collection value: `Length([1, err,
 * 3])` counts it, `Map(f, [1, err, 3])` applies `f` to each cell.
 *
 * An error under a SELECTING operator (`If`, `Which`, `And`, …:
 * `defersErrorAbsorption()`) counts the same way: it is the value of an
 * element only when the selection demands it. So the view
 * `Map(u ↦ If(u = 2, 1/"a", u), Range(1, 5))` is a collection whose second
 * element is the error, as it is when the callback calls a function that
 * fails at run time. Before, such a view was neither a collection nor an
 * error: `Sum` over it answered the view itself, and `Length` stayed
 * unevaluated.
 *
 * Read only when the error walks have found no error that bubbles: the
 * errors that remain are inside collection literals or under a selecting
 * operator. When one of them is inside a `Tuple`, a `Dictionary` or a
 * `KeyValuePair` literal instead, the answer is `false`, and the node keeps
 * the failed value frozen in place.
 */
export function failedCellsAreIterable(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  let found = false;
  for (const op of expr.ops) {
    if (op.isValid) continue;
    if (isIterableWithFailedCells(op) || defersErrorAbsorption(op)) {
      found = true;
      continue;
    }
    if (isFunction(op, 'Error') || COLLECTION_OPERATORS.has(op.operator))
      return false;
    if (!failedCellsAreIterable(op)) return false;
    found = true;
  }
  return found;
}

/**
 * Operators that read only the number of cells of their one operand, never
 * the value of a cell: over a `List` or `Set` literal that holds a failed
 * cell they answer a value (`Length([1, <error>, 3])` is `3`,
 * `docs/ERROR-MODEL.md` §3). `Count` with a predicate applies the predicate
 * to each cell, so only its one-operand form is in this set.
 */
const CELL_COUNT_OPERATORS = new Set(['Length', 'Count', 'IsEmpty']);

/**
 * Collection views that keep or drop cells by their position, never by their
 * value: the number of cells of the view does not depend on the value of a
 * failed cell. A view that compares cells to get its cells (`Dedup`, `Union`,
 * `Intersection`, `Difference`, `Sort`, …) or applies a predicate to them
 * (`Filter`) is not in this set: over a failed cell, its count, and so the
 * value of `Length` over it, can be the error of that cell.
 *
 * `Map` keeps one cell for each cell of a list, but a `Map` over a set
 * removes the duplicate values of the callback, which compares them. So a
 * `Map` is accepted only when the literals under it are lists
 * (`countsCellsWithoutValues()`).
 */
const POSITIONAL_VIEW_OPERATORS = new Set([
  'Rest',
  'Most',
  'Reverse',
  'Take',
  'Drop',
  'Join',
  'Map',
]);

/**
 * True when the number of cells of the collection value `expr` does not
 * depend on the value of a failed cell: `expr` is valid, or a `List` or
 * `Set` literal, or a view of `POSITIONAL_VIEW_OPERATORS` whose operands are
 * such values. When `listsOnly` is true, a `Set` literal gives `false`.
 */
function countsCellsWithoutValues(
  expr: Expression,
  listsOnly = false
): boolean {
  if (expr.isValid) return true;
  if (isIterableWithFailedCells(expr))
    return !listsOnly || expr.operator === 'List';
  if (!isFunction(expr) || !POSITIONAL_VIEW_OPERATORS.has(expr.operator))
    return false;
  const lists = listsOnly || expr.operator === 'Map';
  return expr.ops.every((op) => countsCellsWithoutValues(op, lists));
}

/**
 * True when the value of the invalid application `expr` does not depend on
 * the value of a failed cell, so the evaluate handler answers the value it
 * gives over valid cells. The caller has already found that every error of
 * `expr` sits in a cell of a collection value (`failedCellsAreIterable()`).
 *
 * Each invalid operand must be one of:
 * - a collection value that holds a failed cell, read by an operator of
 *   `CELL_COUNT_OPERATORS` with one operand. The value must be a `List` or
 *   `Set` literal, or a view that keeps cells by position
 *   (`countsCellsWithoutValues()`). A view that compares the cells, such as
 *   `Length(Dedup([1, <error>, 3]))`, gives `false`: its count can be the
 *   error of the failed cell;
 * - an application for which this function is `true`, such as the
 *   `Length([1, <error>])` of `Length([1, <error>]) + 1`.
 *
 * An `Error` operand, or an operand under a selecting operator
 * (`defersErrorAbsorption()`), gives `false`. So does an operator that reads
 * the cells (`Sum([1, <error>])`, `First([1, <error>])`): its value can be
 * the error of a failed cell or a valid value, so `type()` in
 * `boxed-function.ts` types it `unknown`, or, for a broadcastable operator
 * whose result is a list (`Sin([1, <error>])`), as the list over the valid
 * cells.
 */
export function answersWithoutFailedCells(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  const countsCells =
    expr.nops === 1 && CELL_COUNT_OPERATORS.has(expr.operator);
  for (const op of expr.ops) {
    if (op.isValid) continue;
    if (!isInvalidNonCollection(op)) {
      if (!countsCells || !countsCellsWithoutValues(op)) return false;
      continue;
    }
    if (isFunction(op, 'Error') || defersErrorAbsorption(op)) return false;
    if (!answersWithoutFailedCells(op)) return false;
  }
  return true;
}

/**
 * The error of a failed cell: the first `Error` at any depth of `cell`, or
 * `undefined` when `cell` is valid. An operator that demands the value of a
 * cell (`Sum`, `Max`, `Mean`, `Sort`) answers this error.
 *
 * Unlike `errorValue()`, this walk also goes into collection literals: the
 * cell `[1, <error>]` of the list of lists `[[1, <error>], 2]` gives
 * `<error>`. It never gives the cell itself, so `Mean([[1, <error>], 2])` is
 * the error, not the inner list. An error found by `errorValue()` keeps the
 * breadcrumb that `errorValue()` builds.
 */
export function failedCellError(cell: Expression): Expression | undefined {
  if (cell.isValid) return undefined;
  const err = errorValue(cell);
  if (err !== undefined) return err;
  if (isFunction(cell) && COLLECTION_OPERATORS.has(cell.operator)) {
    for (const op of cell.ops) {
      const inner = failedCellError(op);
      if (inner !== undefined) return inner;
    }
  }
  return cell.errors[0];
}

/**
 * The error of the first failed element of the collection `xs` (an element
 * that is, or holds, an `Error`: `failedCellError()`), `undefined` when `xs`
 * has none or cannot be walked, or `'incomplete'` when the walk stopped
 * before the end.
 *
 * An operator whose answer depends on the value of an element that it did
 * not match answers this error when no valid element decides the answer:
 * `Element(2, [1, <error>])` is the error (the failed cell could be `2`),
 * while `Element(1, [1, <error>])` is `True`. On `'incomplete'`, a failed
 * element may come after the elements that were read, so a definite answer
 * such as `False` is not known.
 *
 * Only a finite `xs` that can hold a failed element is walked
 * (`mayHoldFailedElement()`). A `List` or `Set` literal holds its elements
 * in memory and is walked in full. Any other collection (a lazy view) is
 * walked at most `maxCollectionSize` elements, and a walk that reaches that
 * bound or the iteration limit is `'incomplete'`. A collection that cannot
 * hold a failed element (a valid list literal, a `Range`, an `Interval`) is
 * not walked, so an arithmetic membership test such as
 * `Element(0.5, Range(1, 10^6))` stays a test with no walk.
 */
export function firstFailedElementError(
  xs: Expression
): Expression | 'incomplete' | undefined {
  if (!mayHoldFailedElement(xs) || xs.isFiniteCollection !== true)
    return undefined;
  const literal =
    (isFunction(xs, 'List') || isFunction(xs, 'Set')) &&
    xs.isLazyCollection !== true;
  const cap = xs.engine.maxCollectionSize;
  let n = 0;
  try {
    for (const x of xs.each()) {
      const failed = failedCellError(x);
      if (failed !== undefined) return failed;
      if (!literal && ++n >= cap) return 'incomplete';
    }
  } catch (e) {
    if (
      e instanceof CancellationError &&
      e.cause === 'iteration-limit-exceeded'
    )
      return 'incomplete';
    throw e;
  }
  return undefined;
}

/**
 * True when an element of the collection `xs` can be a failed cell:
 *
 * - `xs` is invalid: a `List` or `Set` literal that holds a failed cell, or
 *   a view over one (`Reverse([1, <error>])`);
 * - `xs` is a lazy view that computes its elements by evaluating something
 *   for each element (`Map`, `Filter`, a comprehension: the operators that
 *   set the `elementMemo` flag of their collection handlers), or a view
 *   over one (`Take(Map(h, xs), 2)`). With `h(2)` an error, `Map(h, [1, 2])`
 *   is valid but its second element is that error.
 *
 * A view that only reads the elements of valid sources (`Range`,
 * `Interval`, `Take`, `Reverse` over a valid list) cannot. A second walk of
 * an `elementMemo` view reads the memoized elements: it does not apply the
 * function again.
 */
export function mayHoldFailedElement(xs: Expression): boolean {
  if (!xs.isValid) return true;
  if (!isFunction(xs)) return false;
  if (xs.baseDefinition?.collection?.elementMemo === true) return true;
  return xs.ops.some(
    (op) => op.isLazyCollection === true && mayHoldFailedElement(op)
  );
}

/**
 * Collection heads whose contents are DATA, not the structure of a failing
 * computation. `firstEmbeddedError()` does not descend into them.
 *
 * This is deliberately the rung-2 list, NOT `isCollectionHead()`: it governs
 * descent into an APPLICATION's arguments (`f([1, err])`), a landed contract,
 * whereas `isCollectionHead()` governs the rung-3 rule about a node bubbling
 * its OWN operands. The latter is a superset (it also covers `Take`, `Map`, …,
 * which produce collections); widening the descent set would silently change
 * rung-2 behavior.
 */
const COLLECTION_OPERATORS = new Set([
  'List',
  'Set',
  'Tuple',
  'Dictionary',
  'KeyValuePair',
]);

/**
 * True when `expr` is headed by an operator that DECIDES AT EVALUATION which
 * of its held operands to evaluate (`selectsOperands` — `If`, `Which`,
 * `And`/`Or`, `Coalesce`, …).
 *
 * An `Error` inside such a subtree is only POTENTIALLY a failure: it becomes
 * the value of the node when the operator selects that operand, and is dead
 * code when it does not (`docs/ERROR-MODEL.md` §3, the demanded-operands
 * rule). Nothing outside the node can tell which, so the error walks below
 * treat the whole subtree as opaque and let it evaluate; what its evaluation
 * RETURNS is what bubbles.
 *
 * Excluded, matching the absorption rungs in `boxed-function.ts`: an observer
 * (`inspectsErrors`), which is entitled to see the error and answer about it,
 * and a collection head, whose failed cell is frozen in place rather than
 * bubbled at all.
 */
export function defersErrorAbsorption(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  const def = expr.operatorDefinition;
  if (def === undefined || def.selectsOperands !== true) return false;
  if (def.inspectsErrors) return false;
  return !isCollectionHead(expr);
}

/**
 * One breadcrumb frame: the error sat in operand `index` (1-based) of an
 * application of `operator`.
 */
export type ErrorFrame = { operator: string; index: number };

/**
 * The error carried by a value, per `docs/LANGUAGE-MODEL.md`:
 *
 * - an `Error`-headed value **is** its own error;
 * - an INVALID value — a frozen tree that *embeds* a validation error, e.g.
 *   the canonical form of `"a" + 1` — yields its **first** embedded `Error`
 *   subexpression;
 * - anything else yields `undefined`.
 *
 * The returned error carries a **breadcrumb** (§2a): the chain of
 * `(operator, operand index)` frames from the failure site outwards, walked
 * here plus the optional `frame` describing the hop that CONSUMED `expr` (the
 * bubbling node itself). Frames already on the error — from an earlier hop —
 * are kept, with the new ones appended (innermost first).
 *
 * **Collections are not descended into.** An error inside a collection
 * literal is an error in one ELEMENT, not a failure of the collection: making
 * `f([1, "a" + 1])` bubble would discard the whole list (and every valid
 * element in it) to report one cell. Such an application reads the cells of
 * a `List` or `Set` literal (`failedCellsAreIterable()`), and freezes over a
 * `Tuple`, `Dictionary` or `KeyValuePair` literal. An invalid non-collection
 * tree (`Error(…) + 1`) still bubbles its first error. This is why the walk
 * here is a bounded mirror of `.errors`
 * (`getSubexpressions('Error')`, which descends everywhere) rather than a
 * call to it.
 *
 * **Selecting subtrees are not descended into either**, at any depth
 * including the root: an error under an `If`/`And`/`Coalesce` may be dead
 * code, and only that node's own evaluation can say
 * (`defersErrorAbsorption`). So `Sin(If(True, 5, <error>))` carries no error
 * value, while the `<error>` that `If(False, 5, <error>)` RETURNS does — it
 * is then an ordinary `Error` value in the operand position, and this walk
 * finds it there.
 *
 * `isValid` is `false` exactly when a tree contains an `Error` node (only
 * `BoxedFunction` overrides it), so the walk runs only on values already known
 * to carry one, and prunes on it at every level.
 *
 * A leaf module (types + type guards only): `boxed-function.ts`,
 * `function-utils.ts` and `library/core.ts` all need it, and it must sit
 * upstream of `function-utils.ts`.
 */
export function errorValue(
  expr: Expression | undefined | null,
  frame?: ErrorFrame
): Expression | undefined {
  if (!expr || expr.isValid) return undefined;
  const path: ErrorFrame[] = [];
  const err = firstEmbeddedError(expr, path, true);
  if (err === undefined) return undefined;
  // `path` is collected outermost-first on the way down; the breadcrumb reads
  // innermost (failure site) first.
  path.reverse();
  if (frame !== undefined) path.push(frame);
  return withErrorFrames(err, path);
}

/**
 * The error `expr` MIGHT answer with once every selecting operator inside it
 * has decided — the answer `errorValue()` would give if the
 * demanded-operands rule did not exist.
 *
 * Its first use is to tell the two reasons `errorValue()` can decline apart.
 * That happens both for a tree whose errors are all under selecting heads
 * (where the node must be EVALUATED, because a selection may still demand the
 * failing operand) and for a tree whose errors are all inside collection
 * literals (where the node freezes with the failed cell in place). This walk
 * answers only the first of those, so the caller can pick the right one.
 *
 * Its second use is to locate the operand a returned error came from, for the
 * breadcrumb: the operand still holds the error as authored, whereas the copy
 * the handler returned may have grown frames on its way out.
 *
 * No breadcrumb is built here — the frames a caller wants are the ones on the
 * RETURNED error, not the ones this walk happens to cross.
 */
export function potentialErrorValue(expr: Expression): Expression | undefined {
  if (expr.isValid) return undefined;
  return firstEmbeddedError(expr, [], false);
}

/** The first `Error` node in `expr`, not descending into collection values —
 * nor, when `skipSelectors`, into a subtree whose evaluation decides for
 * itself whether that error is demanded (`defersErrorAbsorption`). `path`
 * accumulates the frames traversed to reach it, outermost first. */
function firstEmbeddedError(
  expr: Expression,
  path: ErrorFrame[],
  skipSelectors: boolean
): Expression | undefined {
  // The `Error` test comes first: a selecting operator that RETURNS the error
  // of an operand it demanded is answering with an error value, not hiding
  // one, and that value must be seen even though its own head defers.
  if (isFunction(expr, 'Error')) return expr;
  if (!isFunction(expr) || COLLECTION_OPERATORS.has(expr.operator))
    return undefined;
  if (skipSelectors && defersErrorAbsorption(expr)) return undefined;
  const ops = expr.ops;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op === undefined || op.isValid) continue;
    path.push({ operator: expr.operator, index: i + 1 });
    const err = firstEmbeddedError(op, path, skipSelectors);
    if (err !== undefined) return err;
    path.pop();
  }
  return undefined;
}

//
// ─── Breadcrumb (design §2a) ──────────────────────────────────────────────
//
// `["Error", code, where?, ["ErrorTrace", ["ErrorFrame", "'Add'", 2], …]]`
//
// The trace is the LAST operand and is identified by its `ErrorTrace` HEAD,
// never by position: an `Error` without a breadcrumb keeps its historical
// 1- and 2-operand shape byte for byte. Read `where` with `errorWhere()`.
//

/** The `ErrorTrace` operand of an `Error` value, if it carries one. */
export function errorTrace(
  err: Expression
): (Expression & FunctionInterface) | undefined {
  if (!isFunction(err, 'Error')) return undefined;
  const last = err.ops[err.nops - 1];
  return isFunction(last, 'ErrorTrace') ? last : undefined;
}

/** The breadcrumb frames of an `Error` value, innermost (failure site) first. */
export function errorFrames(err: Expression): ErrorFrame[] {
  const trace = errorTrace(err);
  if (trace === undefined) return [];
  const frames: ErrorFrame[] = [];
  for (const f of trace.ops) {
    if (!isFunction(f, 'ErrorFrame')) continue;
    const operator = isString(f.op1) ? f.op1.string : undefined;
    const index = isNumber(f.op2) ? f.op2.re : undefined;
    if (
      operator === undefined ||
      index === undefined ||
      !Number.isFinite(index)
    )
      continue;
    frames.push({ operator, index });
  }
  return frames;
}

/** The `Error` operands that are not the breadcrumb — `[code]` or
 * `[code, where]`, i.e. the historical shape. */
export function errorOpsWithoutTrace(
  err: Expression
): ReadonlyArray<Expression> {
  if (!isFunction(err)) return [];
  const ops = err.ops;
  if (ops.length === 0) return ops;
  const last = ops[ops.length - 1];
  return isFunction(last, 'ErrorTrace') ? ops.slice(0, -1) : ops;
}

/** The context/location operand of an `Error` (`["Error", code, where]`),
 * skipping a breadcrumb that may occupy the same position. */
export function errorWhere(err: Expression): Expression | undefined {
  return errorOpsWithoutTrace(err)[1];
}

/**
 * The errors that an `evaluate` handler made for its own node with the frame
 * of that node already in the breadcrumb, each mapped to that node.
 *
 * The evaluation of a SELECTING operator (`If`, `Which`, `And`, …) adds a
 * frame to an `Error` that its handler returns (`_resultError()` in
 * `boxed-function.ts`): it looks for the operand whose evaluation returned
 * the error, then for the operand that holds it, and when neither is found,
 * it records operand 1. That is wrong for an error
 * that the handler made about another operand and that already names it, such
 * as the `unexpected-argument` error of {@link surplusOperandError}. A handler
 * records such an error here with its own node, and the evaluation of that
 * node then adds no frame. The record is for one node only: when the error
 * goes up through an enclosing node (an `If` in the condition of another
 * `If`), the enclosing node is a different node and adds its frame as usual.
 * The map holds its keys weakly, so a record goes away with its error.
 */
const errorsFramedByNode = new WeakMap<Expression, Expression>();

/** Record that `err`, an error that the `evaluate` handler of `node` made,
 * already has the frame of `node` in its breadcrumb. See
 * {@link errorsFramedByNode}. */
export function markErrorFramedByNode(err: Expression, node: Expression): void {
  errorsFramedByNode.set(err, node);
}

/** True if the `evaluate` handler of `node` made `err` with the frame of
 * `node` already in its breadcrumb ({@link markErrorFramedByNode}). The
 * evaluation of `node` must then not add another frame. */
export function isErrorFramedByNode(
  err: Expression,
  node: Expression
): boolean {
  return errorsFramedByNode.get(err) === node;
}

/**
 * The error for the first surplus operand of a call to a built-in operator
 * whose `evaluate` handler reads at most `max` operands, or `undefined` for
 * a call with `max` operands or fewer.
 *
 * Some `canonical` handlers build the call with `engine._fn`, which does no
 * arity check, and keep every operand. `Numerator`, `Denominator` and
 * `NumeratorDenominator` (one operand) keep them on purpose: a user
 * definition that extends one of them with options reads the extra operands
 * in its own handler (issue #442). `If` (at most three operands) does the
 * same. The built-in `evaluate` handler refuses the call the way a declared
 * function refuses a surplus argument: the `unexpected-argument` error names
 * the first surplus operand and carries the frame of the operator at that
 * operand's 1-based position.
 *
 * `node` is the node that is evaluated (the `expression` option of the
 * handler). The error is recorded with it ({@link markErrorFramedByNode}),
 * so that the evaluation of a selecting operator such as `If` does not add a
 * second frame, for operand 1, to an error that already names its operand.
 */
export function surplusOperandError(
  ce: Expression['engine'],
  operator: string,
  ops: ReadonlyArray<Expression>,
  node: Expression | undefined,
  max = 1
): Expression | undefined {
  if (ops.length <= max) return undefined;
  const err = withErrorFrames(
    ce.error('unexpected-argument', ops[max].toString()),
    [{ operator, index: max + 1 }]
  );
  if (node !== undefined) markErrorFramedByNode(err, node);
  return err;
}

/** `err` with `frames` appended to its breadcrumb (a no-op for an empty
 * chain). The historical operands are preserved untouched. */
export function withErrorFrames(
  err: Expression,
  frames: ReadonlyArray<ErrorFrame>
): Expression {
  if (frames.length === 0) return err;
  if (!isFunction(err, 'Error')) return err;
  const ce = err.engine;
  const trace = errorTrace(err);
  const items = [
    ...(trace?.ops ?? []),
    ...frames.map((f) =>
      ce._fn('ErrorFrame', [ce.string(f.operator), ce.number(f.index)], {
        canonical: false,
      })
    ),
  ];
  // `Error` holds its operands raw (see `box.ts`), so the trace is built
  // non-canonically — `ErrorTrace`/`ErrorFrame` are pure data heads with no
  // operator definition.
  return ce._fn('Error', [
    ...errorOpsWithoutTrace(err),
    ce._fn('ErrorTrace', items, { canonical: false }),
  ]);
}

//
// ─── Element-wise (broadcast) context ─────────────────────────────────────
//
// A user function with scalar parameters is auto-broadcast over an indexed
// collection argument (the vectorization default). When that fires
// unexpectedly, an element's failure reads as a bare error with no hint that
// a broadcast was in flight. The context is recorded as an extra entry in the
// SAME `ErrorTrace` breadcrumb (§2a):
//
//   ["ErrorBroadcast", "'skipWs'", index, length]
//
// A distinct head — not `ErrorFrame`, whose index means an ARGUMENT position.
// Readers that only understand `ErrorFrame` skip it, so an error that never
// went through a broadcast keeps its historical shape byte for byte.
//

/**
 * One breadcrumb entry recording an ELEMENT-WISE application: the failure
 * happened while `operator` was broadcast over a collection of `length`
 * elements, at 1-based element `index` (collections are 1-indexed).
 */
export type BroadcastFrame = {
  operator: string;
  index: number;
  length: number;
};

/** A human-readable rendering of a broadcast breadcrumb entry. Also used for
 * the message of an error THROWN out of an element evaluation, which never
 * becomes an `Error` value and so cannot carry a breadcrumb. */
export function broadcastContextMessage(
  operator: string,
  length: number | undefined,
  index?: number
): string {
  const over =
    length === undefined
      ? ''
      : ` over ${length} element${length === 1 ? '' : 's'}`;
  const at = index === undefined ? '' : ` (element ${index})`;
  // A frame recorded by `Apply` comes from an anonymous function literal
  // (`Apply(x ↦ √x, list)`, or the pipe `list |> x => sqrt(x)`): the user
  // never wrote `Apply`, so the literal is named by what it is.
  const applied =
    operator === 'Apply' ? 'the function literal' : `'${operator}'`;
  return `while applying ${applied} element-wise${over}${at}`;
}

/** The broadcast entries of an `Error` value's breadcrumb, outermost
 * broadcast last. Empty for an error that never went through one. */
export function broadcastFrames(err: Expression): BroadcastFrame[] {
  const trace = errorTrace(err);
  if (trace === undefined) return [];
  const frames: BroadcastFrame[] = [];
  for (const f of trace.ops) {
    if (!isFunction(f, 'ErrorBroadcast')) continue;
    const operator = isString(f.op1) ? f.op1.string : undefined;
    const index = isNumber(f.op2) ? f.op2.re : undefined;
    const length = isNumber(f.ops[2]) ? f.ops[2].re : undefined;
    if (
      operator === undefined ||
      !Number.isFinite(index) ||
      !Number.isFinite(length)
    )
      continue;
    frames.push({ operator, index: index!, length: length! });
  }
  return frames;
}

/**
 * `expr` with `frame` recorded on the `Error` value(s) it carries.
 *
 * Only the invalid spine is rebuilt — `isValid` prunes at every level, and a
 * valid `expr` is returned untouched — so a successful element pays nothing
 * beyond the `isValid` test the surrounding `List` performs anyway. As in
 * `firstEmbeddedError()`, collection literals are not descended into: an error
 * in a nested collection belongs to an inner element (and an inner broadcast
 * has already annotated it).
 *
 * The VALUE is unchanged: an error element stays an error element with the
 * same code and `where`; only the breadcrumb grows.
 */
export function withBroadcastFrame(
  expr: Expression,
  frame: BroadcastFrame
): Expression {
  if (expr.isValid) return expr;
  if (isFunction(expr, 'Error')) return withBroadcastTrace(expr, frame);
  if (!isFunction(expr) || COLLECTION_OPERATORS.has(expr.operator)) return expr;
  let changed = false;
  const ops = expr.ops.map((op) => {
    if (op.isValid) return op;
    const rewritten = withBroadcastFrame(op, frame);
    if (rewritten !== op) changed = true;
    return rewritten;
  });
  if (!changed) return expr;
  // Rebuilt non-canonically: this is a frozen invalid tree, and
  // re-canonicalizing it would re-run validation on the error it carries.
  return expr.engine._fn(expr.operator, ops, { canonical: false });
}

/** `err` with a broadcast entry appended to its breadcrumb. */
function withBroadcastTrace(
  err: Expression,
  frame: BroadcastFrame
): Expression {
  const ce = err.engine;
  const trace = errorTrace(err);
  const items = [
    ...(trace?.ops ?? []),
    ce._fn(
      'ErrorBroadcast',
      [
        ce.string(frame.operator),
        ce.number(frame.index),
        ce.number(frame.length),
      ],
      { canonical: false }
    ),
  ];
  return ce._fn('Error', [
    ...errorOpsWithoutTrace(err),
    ce._fn('ErrorTrace', items, { canonical: false }),
  ]);
}
