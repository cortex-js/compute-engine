import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { CancellationError } from '../../common/interruptible.js';
import { isFunction, isSymbol } from './type-guards.js';
import {
  collectionSourceOperands,
  isRecordShapedType,
  isWalkableFiniteCollection,
} from '../collection-utils.js';
import {
  isAbstractCollectionTypeOf,
  isKindOpenOperandType,
} from './broadcast-lift-type.js';
import { hasAsyncOnlyApplication } from './async-only-descendants.js';
import { isOperatorDef, isValueDef } from './definition-guards.js';

//
// The listing of a finite lazy collection that a VALUE holds as an element:
// an element of a list or tuple literal, an element that a spread operand
// of a list literal enumerates (`snapshotListJoin` in
// `library/collections.ts`), and a cell that a broadcast collects into its
// result list (`boxed-function.ts`). Each such element is replaced by the
// list (or the set) of its elements, within one budget of
// `ce.maxCollectionSize` elements. The kind tests `producesSet` and
// `producesKeyed` are here because the budget check needs `producesSet`;
// `library/collections.ts` imports them from here.
//

/**
 * The number of elements that a snapshot of a `ListJoin` has created, at
 * every depth, and the most that it can create (`ce.maxCollectionSize`).
 * The elements that a walk created before it stopped stay counted, so the
 * work of the whole snapshot is bounded by `max`.
 */
export type SnapshotBudget = { used: number; max: number };

/**
 * True when the `count` of the collection `x` is known without a walk of its
 * elements: a collection that is not lazy (a `List`, a `Set`, a string), a
 * `Range`, a `Linspace`, or a list-producing `Map` whose sources have such a
 * count. Any other lazy collection can have a count that walks its elements
 * and calls its callbacks: the count of a `Filter` calls the predicate on
 * each element, and the count of a set-producing `Map` (a `Map` over a
 * `Set`) counts the DISTINCT results by walking `each()`, which calls the
 * callback on every element (`distinctCount`). Reading such a count before
 * the walk would call the callback twice per element, and a callback with a
 * side effect, such as a random draw, would take effect twice.
 */
export function hasConstantTimeCount(x: Expression): boolean {
  if (!x.isLazyCollection) return true;
  if (isFunction(x, 'Range') || isFunction(x, 'Linspace')) return true;
  if (isFunction(x, 'Map') && x.nops >= 2)
    return (
      !producesSet(x) &&
      x.ops.slice(1).every((source) => hasConstantTimeCount(source))
    );
  return false;
}

/**
 * An element of a `ListJoin` operand, as the snapshot of the literal holds
 * it: a finite lazy collection is replaced by the list (or the set) of its
 * elements, at every depth, and any other element is returned unchanged.
 * Each element that the listing creates uses one unit of `budget`.
 *
 * The rows of `take(iterate(nextRow, [1]), 4)` are lazy `Map` views. Kept
 * as views inside the `List`, they print as their recipes
 * (`[[1], Map((p) => …, Zip(…)), …]`), and each one reads the variables of
 * its callback again at each later read.
 *
 * An element is kept as it is when it is not known to be finite, when its
 * elements cannot be computed, when it is neither indexed nor a set (a
 * keyed view), when it is a held conditional (`When`, `Which`, `If`: a
 * restricted collection, not a view), when its elements would use more
 * than the rest of the budget, or when the walk throws.
 */
export function listedElement(
  ce: ComputeEngine,
  x: Expression,
  budget: SnapshotBudget
): Expression {
  if (!x.isValid || !x.isLazyCollection) return x;
  if (isFunction(x, 'When') || isFunction(x, 'Which') || isFunction(x, 'If'))
    return x;
  // A view whose callback applies an operator that has only an
  // `evaluateAsync` handler stays lazy: the walk below is synchronous and
  // would store the applications unevaluated (`holdsAsyncOnlyOperator`).
  if (holdsAsyncOnlyOperator(x)) return x;
  const elements: Expression[] = [];
  let isSet = false;
  try {
    if (!isWalkableFiniteCollection(x)) return x;
    isSet = !x.isIndexedCollection && x.type.matches('set<any>');
    if (!isSet && !x.isIndexedCollection) return x;
    if (hasConstantTimeCount(x)) {
      const count = x.count;
      if (count === undefined || count > budget.max - budget.used) return x;
    }
    for (const y of x.each()) {
      if (budget.used >= budget.max) return x;
      budget.used += 1;
      elements.push(listedElement(ce, y, budget));
    }
  } catch (e) {
    if (
      e instanceof CancellationError &&
      e.cause !== 'iteration-limit-exceeded'
    )
      throw e;
    return x;
  }
  return isSet ? ce.function('Set', elements) : ce._fn('List', elements);
}

/**
 * The elements of a `List` or `Tuple` literal after they were evaluated,
 * with each finite lazy element replaced by the list (or the set) of its
 * elements, or `undefined` when no element was replaced.
 *
 * A literal is a value. Without this, an element that evaluates to a lazy
 * collection stays a live view inside the literal: with `xs = [1, 2]`,
 * `[map(x => x + 1, xs)]` held the `Map`, printed as its recipe, and read
 * `xs` again at each later read; `[1..3, 4]` printed as `[1..3, 4]`. With
 * this, they are `[[2, 3]]` and `[[1, 2, 3], 4]`, as a spread of the same
 * element (`snapshotListJoin`) already gives.
 *
 * Each element is listed with `listedElement`, so the rules are those of a
 * spread: an element is kept as it is when it is not known to be finite
 * (`filter(1..oo, p)`), when it is neither indexed nor typed as a set (a
 * keyed view over a dictionary), when it is a held conditional, or when the
 * walk throws. An indexed element becomes a `List`, and an element typed as
 * a set becomes a `Set`.
 *
 * One budget of `ce.maxCollectionSize` elements is shared by all the
 * elements of the literal, at every depth. It counts only the elements
 * that the listing creates: the elements of the literal itself exist
 * already. An element whose elements would use more than the rest of the
 * budget stays lazy. When its count is cheap (`hasConstantTimeCount`), it
 * is compared with the budget before any walk, so no callback runs.
 * Otherwise (a `Filter`), the walk stops at the budget, and the callbacks
 * that the walk ran run again when the kept view is read, the same limit
 * as in `snapshotListJoin`.
 *
 * Under a numeric approximation, a listed element is approximated too, as
 * `List` approximates each of its elements.
 *
 * An element that holds an application of an operator with only an
 * `evaluateAsync` handler, or that names such an operator as a callback
 * (`holdsAsyncOnlyOperator`), stays as it is, on both routes: the listing is
 * synchronous, and the listed elements would hold that application
 * unevaluated.
 */
export function listedLiteralElements(
  ce: ComputeEngine,
  elements: ReadonlyArray<Expression>,
  numericApproximation: boolean
): Expression[] | undefined {
  let result: Expression[] | undefined;
  let budget: SnapshotBudget | undefined;
  for (let i = 0; i < elements.length; i++) {
    const x = elements[i];
    let listed = x;
    if (x.isValid && x.isLazyCollection && !holdsAsyncOnlyOperator(x)) {
      budget ??= { used: 0, max: ce.maxCollectionSize };
      listed = listedElement(ce, x, budget);
      if (listed !== x && numericApproximation)
        listed = listed.evaluate({ numericApproximation });
    }
    if (listed !== x && result === undefined) result = elements.slice(0, i);
    if (result !== undefined) result.push(listed);
  }
  return result;
}

/**
 * Whether the lazy view `x` holds an application of an operator that has
 * only an `evaluateAsync` handler (a user-declared asynchronous operator), or
 * names such an operator as a symbol. The synchronous iterator of the view
 * cannot run that operator: it applies the callback of `Map(AsyncOnly, xs)`
 * and gets `AsyncOnly(1)`, `AsyncOnly(2)` unevaluated. A listing would then
 * hold these applications unevaluated, so the view must stay lazy.
 *
 * `hasAsyncOnlyApplication` finds the applications only. This also finds a
 * callback given by name: a symbol whose operator definition has only an
 * `evaluateAsync` handler, and a symbol that holds a function literal (a
 * user function, or a value that is a `Function`) whose body holds or names
 * such an operator. The walk looks into the function literal of a symbol
 * only once: it does not look into the symbols that this body names in turn.
 * This bounds the walk, also for symbols that refer to each other. An
 * operand that an operator quotes (`Hold`) is data and is not examined.
 */
export function holdsAsyncOnlyOperator(x: Expression): boolean {
  if (!x.engine._hasAsyncOnlyOperator) return false;
  return hasAsyncOnlyApplication(x) || namesAsyncOnlyOperator(x, true);
}

/** Whether `x` names an operator that has only an `evaluateAsync` handler
 * (see `holdsAsyncOnlyOperator`). When `followValues` is true, the function
 * literal that a symbol holds is examined too, with `followValues` false. */
function namesAsyncOnlyOperator(x: Expression, followValues: boolean): boolean {
  if (isSymbol(x)) {
    // The callback of a lazy view can be a symbol that is not bound (the
    // symbol `AsyncOnly` in `Map(AsyncOnly, xs)` has no definition): its
    // definition is then looked up by name in the current scope.
    const binding =
      x.baseDefinition === undefined
        ? x.engine.lookupDefinition(x.symbol)
        : undefined;
    const def =
      x.operatorDefinition ??
      (isOperatorDef(binding) ? binding.operator : undefined);
    if (def?.evaluateAsync !== undefined && def.evaluate === undefined)
      return true;
    if (!followValues) return false;
    const valueDef =
      x.valueDefinition ?? (isValueDef(binding) ? binding.value : undefined);
    const literal = def?._lambdaLiteral ?? valueDef?.value;
    return (
      literal !== undefined &&
      isFunction(literal, 'Function') &&
      (hasAsyncOnlyApplication(literal) ||
        namesAsyncOnlyOperator(literal, false))
    );
  }
  if (!isFunction(x)) return false;
  if (x.operatorDefinition?.holdClass === 'quote') return false;
  return x.ops.some((op) => namesAsyncOnlyOperator(op, followValues));
}

/** Does this node promise a SET?
 *
 * Three operators reach here, by two different mechanisms: `Join` and
 * `Append` ADOPT the set kind from a set operand (`joinResultType`,
 * `appendResultType`), while `Map` PRESERVES its source's kind
 * (`mapResultType`). Either way the answer is read off the node's OWN type
 * rather than re-derived from the operands, so the two mechanisms need no
 * distinction here.
 *
 * The distinction does matter to the callers, and in one place: `Join`/
 * `Append` pass their operands' elements through UNCHANGED, so an infinite
 * SET operand keeps infinitely many distinct elements, whereas `Map` applies
 * a callback that may collapse them all onto one value. See the infinite-
 * operand branches of their `count`/`isFinite` handlers.
 *
 * A node typed with an ABSTRACT collection type (`collection<T>`: not
 * indexed, not a set, not keyed) is built over a source whose type admits
 * several kinds, such as a symbol declared `collection<number>`. Its kind is
 * then the kind of the values its SOURCES hold now (the operands in the
 * source positions of the operator, `collectionSourceOperands`: the appended
 * elements of an `Append` and the seed of a `Scan` are not sources), the
 * rule `BoxedFunction.isIndexedCollection` applies. The node is indexed when
 * every such source holds an indexed value. It is keyed when one of them
 * holds a dictionary or a record (see `producesKeyed`). Otherwise it is a
 * set when one of them holds a value that is not indexed (a set, or a lazy
 * view over one). This is the precedence the static type of `Join` and
 * `Append` gives to the kinds of their operands (`joinResultTypeD`): a keyed
 * operand before a set operand, a set operand before a list. Without this,
 * `Join(P, [5, 3])` with `P` holding `Set(3, 1)` enumerated the repeated `3`
 * although its value is the set `Set(3, 1, 5)`.
 *
 * A source that holds no value yet (a valueless symbol, which cannot be
 * enumerated) does not make the node a set: its kind is not known, and the
 * facts the handlers derive then are the ones that hold for a list. The
 * count of `Join(Range(1, ∞), xs)` stays `∞`, which is true whatever `xs`
 * holds. */
export function producesSet(expr: Expression): boolean {
  if (expr.type.matches('set<any>')) return true;
  if (!isAbstractCollectionTypeOf(expr.type.type) || expr.isIndexedCollection)
    return false;
  if (producesKeyed(expr)) return false;
  return collectionSourceOperands(expr).some(
    (op) =>
      isKindOpenOperandType(op.type.type) &&
      op.isCollection &&
      op.isEnumerableCollection !== false &&
      op.isIndexedCollection === false
  );
}

/** Does this node promise a KEYED collection — a `record` or a `dictionary`?
 *
 * `Join` and `Append` adopt those kinds from an operand exactly as they adopt
 * `set` (`joinResultType`, `appendResultType`), and a keyed collection owes
 * its keys the same distinctness a set owes its elements.
 *
 * A `Join` or an `Append` typed with an ABSTRACT collection type (see
 * `producesSet`) is keyed when one of its abstract-typed sources holds a
 * dictionary or a record now. The node then enumerates merged entries, and
 * its `elttype` handler answers the entry tuple, so that `materialize()`
 * rebuilds a `Dictionary`. Without this, `Join(a, b)` with `a` and `b`
 * declared `collection` and holding dictionaries was a dictionary when
 * evaluated (the evaluation rebuilds the join over the values, whose type is
 * a dictionary), but a `Set` of entry tuples when evaluated with
 * `materialization: true`. The rule reads the held values of `Join` and
 * `Append` only: they are the operators that adopt the kind of their
 * operands. */
export function producesKeyed(expr: Expression): boolean {
  return producesKeyedAt(expr, 0);
}

/** `producesKeyed` at a depth of the descent through the values of symbols
 * and nested joins (see `holdsKeyedValue`). */
function producesKeyedAt(expr: Expression, depth: number): boolean {
  if (
    isRecordShapedType(expr.type.type) ||
    expr.type.matches('dictionary<any>')
  )
    return true;
  if (!isFunction(expr, 'Join') && !isFunction(expr, 'Append')) return false;
  if (!isAbstractCollectionTypeOf(expr.type.type)) return false;
  return collectionSourceOperands(expr).some(
    (op) =>
      isKindOpenOperandType(op.type.type) && holdsKeyedValue(op, depth + 1)
  );
}

/** Whether `op` holds a keyed collection (a dictionary or a record) now: its
 * type is keyed, or it is a symbol whose value holds one, or it is a `Join`
 * or an `Append` that is keyed by the values its own sources hold. The
 * descent through symbol values and nested joins is bounded: a chain deeper
 * than the bound, or a cycle of symbols that hold each other
 * (`a := Append(b, 1)` with `b := a`), answers `false`. */
function holdsKeyedValue(op: Expression, depth: number): boolean {
  if (depth > 16) return false;
  if (isRecordShapedType(op.type.type) || op.type.matches('dictionary<any>'))
    return true;
  if (isSymbol(op)) {
    const value = op.value;
    return value !== undefined && holdsKeyedValue(value, depth + 1);
  }
  return producesKeyedAt(op, depth + 1);
}

/**
 * The cells that an eager broadcast collected into its result list (or into
 * its result tuple, for a map over the components of a tuple), with
 * each finite lazy cell replaced by its listing (`listedLiteralElements`,
 * one budget of `ce.maxCollectionSize` elements for the whole result).
 *
 * The result of a broadcast is a value, as a list literal is. With
 * `f(s) = [q + 1 for q in [1, 2]]`, each cell of `f([0, 1])` is a lazy
 * comprehension. Kept as it is, the result printed as
 * `[Comprehension(…), Comprehension(…)]`; listed, it is `[[2, 3], [2, 3]]`,
 * the value of the literal `[f(0), f(1)]`.
 */
export function listedBroadcastCells(
  ce: ComputeEngine,
  cells: ReadonlyArray<Expression>,
  numericApproximation: boolean | undefined
): ReadonlyArray<Expression> {
  return (
    listedLiteralElements(ce, cells, numericApproximation ?? false) ?? cells
  );
}
