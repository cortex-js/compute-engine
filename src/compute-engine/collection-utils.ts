import { factsOf } from '../common/type/facts.js';
import {
  widenAll,
  broadcastCellType,
  broadcastElementType,
  broadcastShapedResultType,
  cellTypeMayCarryDimensions,
  collectionElementType,
  resolveTypeForCompilation as resolveType,
  resolveTypeAlias,
  stripMissingFromType,
  isPointElementType,
  unfoldAliasOnDescent,
  recordUnfoldOnDescent,
  descendIntoConstructor,
  isBareCutOnDescent,
  isCutOnDescent,
  type AliasDescent,
} from '../common/type/utils.js';
import {
  isInferredTypedParameter,
  markInferredTypeOperand,
} from './boxed-expression/inferred-annotations.js';
import {
  broadcastCollectionArm,
  cannotHoldAList,
  couldMatch,
  isSubtype,
  resolveTypeReference,
} from '../common/type/subtype.js';
import { declarationOf } from '../common/type/reference.js';
import { reduceType } from '../common/type/reduce.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../common/type/primitive.js';
import { numericStoreTiers } from './boxed-expression/literal-tier.js';
import {
  boxStoreElement,
  machineNumberOf,
} from './boxed-expression/machine-number.js';
import { machineBroadcast } from './boxed-expression/machine-broadcast.js';
import {
  literalMayEraseElement,
  literalWithErasureResolved,
} from './boxed-expression/nothing-erasure.js';
import { isTransitivelyPure } from './boxed-expression/transitive-purity.js';
import {
  isFiniteCount,
  normalizeCount,
  smallCount,
} from './boxed-expression/collection-count.js';
import {
  isOperatorDef,
  isValueDef,
} from './boxed-expression/definition-guards.js';
import { typeToString } from '../common/type/serialize.js';
import { Type } from '../common/type/types.js';
import type { Scope } from './types-evaluation.js';
import { CancellationError, checkDeadline } from '../common/interruptible.js';
import { incompleteWalkCount } from './boxed-expression/incomplete-walks.js';
import {
  Expression,
  CollectionHandlers,
  FunctionInterface,
  Sign,
} from './global-types.js';
import type { MathJsonExpression } from '../math-json/types.js';
import {
  isAbsentArithmeticOperand,
  isAbsentSymbol,
  isFunction,
  isNumber,
  isString,
  isSymbol,
  sym,
} from './boxed-expression/type-guards.js';

/** If a collection has fewer than this many elements, eagerly evaluate it.
 *
 * For example, evaluate the Union of two sets with 10 elements each will
 * result in a set with 20 elements.
 *
 * If the sum of the sizes of the two sets is greater than
 * `MAX_SIZE_EAGER_COLLECTION`, the result is a Union expression
 *
 */
export const MAX_SIZE_EAGER_COLLECTION = 100;

/**
 * True when `col` is a finite indexed collection whose elements can be
 * walked. A finite collection whose elements cannot be computed (see
 * {@link isWalkableFiniteCollection}) is excluded, because most callers of
 * this predicate read the elements with `at()` or `each()`, and they would
 * read such a collection as empty.
 *
 * Some callers do not walk `col` when this predicate is `false`: they keep
 * `col` as one element instead (`flattenToDepth()` keeps a scalar as a
 * leaf). Such a caller must not keep a finite collection with no computable
 * elements as a leaf, because it would give a list with the wrong elements
 * and the wrong count. It must test for that case itself and decline.
 */
export function isFiniteIndexedCollection(col: Expression): boolean {
  return isWalkableFiniteCollection(col) && col.isIndexedCollection;
}

/**
 * True when `col` is a finite collection whose elements can be walked.
 *
 * A finite collection can know its size and still have no computable
 * elements. `Linspace(a, 1, 3)` with a symbolic `a` has `count` 3 and
 * `isFiniteCollection === true`, but its elements are not numbers yet, so it
 * has no iterator and `isEnumerableCollection === false`. The ring
 * `QuotientRing(Integers, 5)` (ℤ/5ℤ) is the same: it has 5 elements, but they
 * are residue classes that the engine does not list. For such a collection
 * `each()` yields nothing, `at()` returns `undefined` and `tally()` is empty.
 * A consumer that gates only on `isFiniteCollection` and then walks the
 * elements reads the collection as EMPTY and gives a wrong answer with no
 * diagnostic (`Union(Linspace(a, 1, 3), Set(1))` gave `Set(1)`).
 *
 * Use this predicate, not `isFiniteCollection`, before a walk of the
 * elements (`each()`, `tally()`, an `at()` loop, a spread, a
 * materialization). When it is `false`, the operator must decline (stay
 * unevaluated). An `isEnumerableCollection` of `undefined` (an eager
 * collection operator that is not evaluated yet) does not decline: the walk
 * evaluates the source itself, which is the behavior these consumers always
 * had.
 *
 * A finite collection that is provably empty (`isEmptyCollection === true`)
 * is always walkable, even if `isEnumerableCollection` is `false`: the walk
 * yields no elements, and that is the correct answer. `Linspace(a, 1, 0)`
 * with a symbolic `a` has no elements, so `Union(Linspace(a, 1, 0), Set(1))`
 * is `Set(1)`.
 *
 * `isEmptyCollection` is read only when `isEnumerableCollection` is `false`.
 * For a lazy view, `isEmptyCollection` can compute the first element: the
 * `isEmpty` handler of `Filter` applies the predicate until one element
 * passes. This predicate is called while an expression is canonicalized
 * (`isFiniteIndexedCollection`, from the argument checks of a numeric
 * operator), where a predicate over a symbol without a value cannot answer
 * and throws. With `C := [1, 2, 3]`, the definition
 * `s(n) := Filter(C, Z ↦ n < |Z|) + s(n - 1)` then did not canonicalize.
 * A collection that cannot be enumerated (`Linspace(a, 1, 3)`) has no
 * elements to compute, so its `isEmptyCollection` is read from its count.
 *
 * This predicate is different from {@link isEnumerableSource}. This
 * predicate is cheap: it reads the `isFiniteCollection`,
 * `isEnumerableCollection` and, for a collection that cannot be enumerated,
 * `isEmptyCollection` flags, and never evaluates. It accepts an
 * `isEnumerableCollection` of `undefined`. `isEnumerableSource` evaluates
 * the source to decide that `undefined` case, so it can tell
 * `Characters("abc")` from `Characters(s)` with a valueless `s`. Use this
 * predicate in an evaluate handler, where the operands are already evaluated
 * and a walk of the source evaluates it again. Use `isEnumerableSource` in a
 * lazy collection handler, where the source can still be unevaluated and an
 * incorrect `true` gives an incorrect value.
 */
export function isWalkableFiniteCollection(col: Expression): boolean {
  if (col.isFiniteCollection !== true) return false;
  if (col.isEnumerableCollection !== false) return true;
  return col.isEmptyCollection === true;
}

/**
 * True when `mapped`, the result of the callback of a `FlatMap` for one
 * element, is a collection (or a symbol of a collection type) that cannot be
 * walked now, so that splicing it would miss elements. A string is one
 * element, and a scalar is one element. A collection that is provably empty
 * contributes nothing, and that is correct.
 */
export function innerCollectionCannotBeWalked(mapped: Expression): boolean {
  if (isString(mapped)) return false;
  if (!mapped.isCollection && !mapped.type.matches('collection<any>'))
    return false;
  if (mapped.isEnumerableCollection !== false) return false;
  return mapped.isEmptyCollection !== true;
}

/**
 * Whether a walk of `xs` is allowed to answer a read that needs the count of
 * `xs`: `xs` is known to be finite, and its elements can be enumerated.
 *
 * Some finite collections have no `count`. The count of
 * `FlatMap([1, 2, 3], x ↦ [x, x])` is known only after the callback is
 * applied to each element, and the `count` and `at` facets do not apply a
 * callback. A read that needs the count (`Count`, `Length`, `IsEmpty`,
 * `Last`, a negative index, and the views that read their source from the
 * end: `Reverse`, `Most`, `RotateLeft`, `RotateRight`) walks such a
 * collection instead, outside the facets.
 *
 * This is done only when the count is unknown because it waits for a
 * callback (`countWaitsForCallback()`). A finite collection can also have no
 * count because the count is too large to compute
 * (`Permutations(Permutations(Range(1, 10000)), 10000)`): such a collection
 * has many more than `maxCollectionSize` elements, so a walk cannot give an
 * answer, and only its cost is certain.
 */
function walkCanAnswerCount(xs: Expression): boolean {
  return (
    xs.isFiniteCollection === true &&
    xs.isEnumerableCollection === true &&
    countWaitsForCallback(xs)
  );
}

/**
 * Whether the collection `xs` is, or reads from, a `FlatMap`: the collection
 * operator whose count is known only after its callback is applied to each
 * element. A view over it (`Take`, `Map`, `Reverse`, …) has no count for the
 * same reason. Only the operands that are collections are read.
 */
function countWaitsForCallback(xs: Expression): boolean {
  if (!isFunction(xs)) return false;
  if (xs.operator === 'FlatMap') return true;
  return xs.ops.some((op) => op.isCollection && countWaitsForCallback(op));
}

/**
 * The elements of the finite collection `xs`, listed by ONE walk, for a read
 * that needs the count of `xs` when the `count` facet gives no answer (see
 * `walkCanAnswerCount()`). Each callback of the collection is applied once for
 * each element of the walk. A read that needs elements from the end of the
 * collection (`Reverse`) lists it with this function once, and then reads the
 * list. It does not read one index from the end at a time, because each such
 * read would walk the collection again.
 *
 * The answer is `undefined`, and the read stays unevaluated, when:
 * - `xs` is not known to be finite, or its elements cannot be enumerated;
 * - `xs` has more than `engine.maxCollectionSize` elements;
 * - the walk gives up with `iteration-limit-exceeded` (a `Filter` with a long
 *   run of rejected elements);
 * - the walk met an inner collection that it could not walk
 *   (`incomplete-walks.ts`), so the list would miss elements.
 *
 * An empty list is a correct answer: an enumerable collection whose walk is
 * complete and yields nothing is empty.
 */
export function listFiniteUncountedCollection(
  xs: Expression
): Expression[] | undefined {
  if (!walkCanAnswerCount(xs)) return undefined;
  const cap = xs.engine.maxCollectionSize;
  const before = incompleteWalkCount();
  const elements: Expression[] = [];
  try {
    for (const x of xs.each()) {
      if (elements.length >= cap) return undefined;
      elements.push(x);
    }
  } catch (e) {
    if (
      e instanceof CancellationError &&
      e.cause === 'iteration-limit-exceeded'
    )
      return undefined;
    throw e;
  }
  if (incompleteWalkCount() !== before) return undefined;
  return elements;
}

/**
 * The emptiness of the finite collection `xs`, decided by a walk, for an
 * `IsEmpty` read when the `isEmpty` facet gives no answer (see
 * `walkCanAnswerCount()`). The walk stops at the first element: the
 * collection is then not empty. A walk that ends with no element decides that
 * the collection is empty, because a collection that claims to be enumerable
 * yields all its elements, also when the count of its source is not known
 * (the contract of the views is stated at `walkDecidesEmptiness()`,
 * `boxed-expression/boxed-function.ts`).
 *
 * The answer is `undefined` when the walk met an inner collection that it
 * could not walk (`incomplete-walks.ts`), also when it found an element: the
 * iterator of `FlatMap` gives a symbol of a collection type with no value as
 * one element, and that symbol can hold an empty collection.
 */
export function finiteUncountedIsEmpty(xs: Expression): boolean | undefined {
  if (!walkCanAnswerCount(xs)) return undefined;
  const before = incompleteWalkCount();
  let empty = true;
  try {
    for (const _ of xs.each()) {
      empty = false;
      break;
    }
  } catch (e) {
    if (
      e instanceof CancellationError &&
      e.cause === 'iteration-limit-exceeded'
    )
      return undefined;
    throw e;
  }
  return incompleteWalkCount() === before ? empty : undefined;
}

/**
 * The views that read their source by a position computed from the count of
 * the source: `Reverse` reads it from the end, `Most` up to its count minus
 * one, the rotations from an offset taken modulo the count, and `Insert`,
 * `DeleteAt` and `ReplaceAt` at an index checked against the count. Over a
 * finite source with no count, the position cannot be computed, so such a
 * view reads the list of its source (see {@link viewOverListedSource} and
 * `walkOfListedSource()`, `library/collections.ts`).
 */
const VIEWS_THAT_NEED_THE_SOURCE_COUNT = new Set([
  'Reverse',
  'Most',
  'RotateLeft',
  'RotateRight',
  'Insert',
  'DeleteAt',
  'ReplaceAt',
]);

/**
 * True when `expr` is a view that reads its source by a position computed
 * from the count of the source (`VIEWS_THAT_NEED_THE_SOURCE_COUNT`), and its
 * source is a finite indexed collection with no
 * count whose walk can list it (see `walkCanAnswerCount()`). Such a view
 * reads its elements from the list of the source
 * ({@link viewOverListedSource}). The test does not walk the source.
 */
export function viewCanListSource(expr: Expression): boolean {
  if (!isFunction(expr) || expr.nops === 0) return false;
  if (!VIEWS_THAT_NEED_THE_SOURCE_COUNT.has(expr.operator)) return false;
  const source = expr.op1;
  if (source.count !== undefined) return false;
  if (!walkCanAnswerCount(source)) return false;
  return source.isIndexedCollection === true;
}

/**
 * For the materialization of a view that reads its source by a position
 * computed from the count of the source (`VIEWS_THAT_NEED_THE_SOURCE_COUNT`:
 * `Reverse`, `Most`, `RotateLeft`, `RotateRight`, `Insert`, `DeleteAt`,
 * `ReplaceAt`), over a finite indexed source with no count: the same view
 * over the LIST of the elements of the source, listed once by
 * `listFiniteUncountedCollection()`. So
 * `Reverse(FlatMap([1, 2, 3], x ↦ [x, x]))` materializes as
 * `Reverse([1, 1, 2, 2, 3, 3])`, which is `[3, 3, 2, 2, 1, 1]`.
 *
 * The answer is `undefined` when `expr` is not such a view, or when its source
 * has a count (the view then reads its source itself). It is `null` when the
 * source cannot be listed (see `listFiniteUncountedCollection()`): the view
 * must then stay in its lazy form.
 */
export function viewOverListedSource(
  expr: Expression
): Expression | null | undefined {
  if (!viewCanListSource(expr) || !isFunction(expr)) return undefined;
  const listed = listFiniteUncountedCollection(expr.op1);
  if (listed === undefined) return null;
  const ce = expr.engine;
  return ce._fn(expr.operator, [ce._fn('List', listed), ...expr.ops.slice(1)]);
}

/**
 * True when `xs`'s elements can actually be ENUMERATED — so that a walk of it
 * that yields nothing means the collection is EMPTY, rather than that there
 * was nothing to walk.
 *
 * `each()` answers with an empty sequence for a source it cannot see into: a
 * symbol with no value (`ce.declare('xs', 'list<integer>')` and no assignment,
 * or an undeclared symbol), and an application of an unknown operator
 * (`f(x)`). Neither has collection handlers, and neither is distinguishable
 * from an empty collection by the walk alone. Concluding from that walk is how
 * `Filter(xs, p)` used to answer `[]`, `Any(xs, p)` `False`, `All(xs, p)`
 * `True`, `Find(xs, p)` `Nothing` and `IndexWhere(xs, p)` `0` for such a
 * source — answers a later `xs := [1, 5]` contradicts, and which the rest of
 * the library (`Length`, `Total`, `Sort`, `Map`, `CountIf`, …) has always
 * declined to give by staying inert.
 *
 * An EAGER collection operator (`Characters(s)`, `Divisors(n)`, `Eigenvalues`,
 * … — 73 of them, against 47 with collection handlers) has no collection
 * handlers either until it is evaluated, and is the one case
 * `isEnumerableCollection` reports `undefined` for. The evaluated form is
 * consulted for exactly that case — off the hot path, since a source that is
 * already a collection answers on the first test.
 *
 * **On the discarded evaluation** (measured 2026-08-09, don't re-litigate):
 * the fallback fires only for a source that is not already a collection, and
 * only at the LEAF of a chain — an inner `Filter`/`Map`/`Take` answers `true`
 * on the first test. Measured at nesting depth 6 over `Characters(400)`: 12
 * calls, 2 fallbacks; it does not compound with depth. The evaluated form is
 * also what the subsequent walk materializes, and the lazy-collection evaluate
 * memo keeps that second pass cheap.
 *
 * **Why the dedicated facet, and not the emptiness ones.**
 * `isEmptyCollection`/`count` are HONEST about a valueless leaf (both
 * `undefined`), and so is a wrapper over one (`Take(xs, 2)`, `Reverse(xs)`),
 * where `isCollection` answers `true`. But reading them from here is
 * **exponential**: `Filter.isEmpty` would call this, which reads the source's
 * `isEmptyCollection`, which is the inner `Filter.isEmpty`, which calls this
 * again — measured at exactly 2^(d+1) − 2 calls (6/14/30/62/126/254 at depths
 * 2–7), the double-read shape-query class. `isEnumerableCollection` is the
 * O(1) propagating facet that answers instead: a wrapper reads only its
 * source's enumerability (never its own emptiness), so a depth-d chain costs
 * d calls.
 *
 * **On evaluating an IMPURE source.** The fallback evaluates `xs` and throws
 * the result away, so an eager IMPURE producer (`RandomShuffle`) runs one
 * extra time. That is a pre-existing property of these paths rather than
 * something this predicate introduced: counting handler invocations for a
 * 5-element source, `Map(f, RandomShuffle(xs))` — which never reaches this
 * function — evaluates the shuffle **8** times, `Filter(RandomShuffle(xs), p)`
 * 5 (of which this contributes 1), `Any(…)` 2. The results stay correct (a
 * filtered shuffle is still a filtered shuffle); what is not reproducible is
 * the number of draws consumed. Tracked in `ROADMAP.md` as its own defect —
 * fixing it here alone would not make the path reproducible.
 *
 * **Asymmetry with {@link isBroadcastableCollection}** — deliberate. That
 * predicate has no such fallback because it answers a different question at a
 * different place: it is consulted on operands that have ALREADY been
 * evaluated (the broadcast gates run post-evaluation), and it fails CLOSED —
 * a `false` means "do not broadcast", which leaves the expression symbolic.
 * This one is consulted inside LAZY collection handlers, where the source may
 * still be raw, and a wrong answer produces a definite wrong VALUE. Accuracy
 * is worth an evaluation here and is not needed there.
 */
export function isEnumerableSource(xs: Expression): boolean {
  // The facet answers structurally for everything that can be decided without
  // evaluating: a leaf collection (`true`), a symbolic-bounds `Range` or a
  // valueless symbol (`false`), and a wrapper over either (propagated).
  const enumerable = xs.isEnumerableCollection;
  if (enumerable !== undefined) return enumerable;

  // Undecidable structurally: an EAGER collection operator has no collection
  // handlers until it is evaluated, and its declared result type is the same
  // whether or not the elements are reachable — `Characters("abc")` and
  // `Characters(s)` for a valueless `s` are both `list<string>` with no
  // handlers.
  //
  // This evaluation does NOT enable the subsequent walk: `each()` materializes
  // such a source by itself, so dropping this branch still gives
  // `Filter(Characters("aab"), p)` the right answer. What it buys is
  // ATTRIBUTION — `each()` yields nothing for `Characters(s)` and three
  // elements for `Characters("abc")`, and never says which case it was in.
  // Without it, `Filter(Characters(s), p)` answers `[]` and
  // `Any(Divisors(n), p)` `False` (probed 2026-08-10), the very bug class this
  // predicate exists to prevent.
  //
  // It is the only branch that pays for an evaluation — see the note above on
  // its measured cost, and on the impure source it duplicates a draw for
  // (`each()` is about to evaluate the same expression again; computing the
  // evaluated form once and threading it through is the ROADMAP follow-up).
  return xs.evaluate().isCollection === true;
}

/**
 * Resolve an eager producer's operand for a `canEnumerate` handler, WITHOUT
 * evaluating — the tri-state at the heart of the adoption recipe
 * (`docs/COLLECTIONS-MODEL.md`):
 *
 * - an `Expression`: the operand's cheaply-readable ground form — a literal,
 *   or a symbol's assigned value (a symbol dereference is a scope lookup,
 *   not an evaluation).
 * - `null`: definitively unavailable NOW — a missing operand, or a valueless
 *   (or undeclared) symbol: evaluation would receive the bare symbol and
 *   decline. This is the state that maps to `canEnumerate: false`.
 * - `undefined`: undecidable without evaluating — an unevaluated compound
 *   (`Divisors(n + 1)`, `f(x)`) or a symbol whose assigned value is one.
 *   Evaluation may still produce a value, so a `canEnumerate` handler MUST
 *   answer `undefined` here, never `false`.
 *
 * The asymmetry with the evaluate handler's own guard is deliberate: that
 * guard sees the EVALUATED operand, where a still-compound value is a
 * definitive decline; this helper sees the CANONICAL operand, where it is
 * merely not-yet-known.
 */
export function groundEnumerationOperand(
  op: Expression | undefined
): Expression | null | undefined {
  if (op === undefined) return null;
  if (isSymbol(op)) {
    if (op.symbol === 'Nothing') return op; // an explicit "absent" operand
    const value = op.value;
    if (value === undefined) return null;
    return isFunction(value) ? undefined : value;
  }
  if (isFunction(op)) return undefined;
  return op; // a literal: number, string, tensor, dictionary
}

/**
 * The standard `canEnumerate` body for an eager producer with ONE
 * value-shaped operand: resolve the operand ({@link
 * groundEnumerationOperand}), then apply the operator's own acceptance test
 * — the same predicate that guards its `evaluate` handler — to the ground
 * form. Keeps the two handlers on a single source of truth (the
 * `hasSymbolicRangeBounds` pattern).
 */
export function canEnumerateOperand(
  op: Expression | undefined,
  isAcceptable: (ground: Expression) => boolean | undefined
): boolean | undefined {
  const ground = groundEnumerationOperand(op);
  if (ground === undefined) return undefined;
  if (ground === null) return false;
  return isAcceptable(ground);
}

/**
 * Conservative `canEnumerate` for an eager operator that CONSUMES a finite
 * collection source at `op1` (`Sort`, `Ordering`, `Unique`, `Tally`):
 * provable declines only. Their evaluate handlers require a finite, walkable
 * source — so a source that is definitively unwalkable or infinite decides
 * `false` — but success ALSO depends on work that is not cheaply decidable
 * (`sortedIndices`, the element walk), so per the `canEnumerate` contract
 * this never answers `true`; the `undefined` tier resolves by evaluating,
 * exactly as before adoption.
 */
export function canEnumerateFiniteSource(
  expr: Expression
): boolean | undefined {
  if (!isFunction(expr)) return undefined;
  const xs = expr.op1;
  if (xs === undefined) return undefined;
  if (xs.isEnumerableCollection === false) return false;
  if (xs.isFiniteCollection === false) return false;
  return undefined;
}

/**
 * The `elementCount` handler of a LENGTH-PRESERVING eager operator over a
 * finite source at `op1` (`Sort`, `Ordering`, `RandomShuffle`): its result has
 * exactly as many elements as its source.
 *
 * Gated on the source being a definitively FINITE collection, mirroring the
 * finiteness part of those operators' evaluate guards: on an infinite or
 * unknown-finiteness source they decline (or error), so there is no result to
 * count and the honest answer is `undefined` — not the source's `Infinity`
 * (Tycho item-169 ruling: a count nobody can walk is worse than no count).
 *
 * The evaluate guards also require that the elements can be walked
 * ({@link isWalkableFiniteCollection}), but this handler does not. A count
 * does not depend on the elements, so the count of a source whose elements
 * cannot be computed (`Linspace(a, 1, 3)` with a symbolic `a`) is still
 * correct.
 *
 * Evaluation-free and draw-free: `RandomShuffle` uses it without touching the
 * random stream.
 */
export function elementCountOfFiniteSource(
  expr: Expression
): number | undefined {
  if (!isFunction(expr)) return undefined;
  const xs = expr.op1;
  if (xs === undefined) return undefined;
  if (xs.isFiniteCollection !== true) return undefined;
  return smallCount(xs);
}

/**
 * The `isEnumerable` handler of a collection operator that wraps ONE source
 * collection at `op1` (`Take`, `Filter`, `Reverse`, `Map`, …): it can produce
 * elements exactly when its source can.
 *
 * This is the propagation step that keeps enumerability O(depth): it reads the
 * source's `isEnumerableCollection` only — never its own `count`/`isEmpty`,
 * which would re-enter this operator's emptiness handler (see
 * {@link isEnumerableSource}).
 */
export function enumerableFromSource(expr: Expression): boolean | undefined {
  if (!isFunction(expr)) return undefined;
  return expr.op1.isEnumerableCollection;
}

/**
 * The `isEnumerable` handler of a collection operator that draws from SEVERAL
 * sources (`Zip`, `Join`, `Union`, …): every collection-typed operand must be
 * enumerable. Three-valued — one `false` decides, an `undefined` with no
 * `false` leaves the verdict unknown.
 */
export function enumerableFromAllSources(
  expr: Expression
): boolean | undefined {
  if (!isFunction(expr)) return undefined;
  let unknown = false;
  for (const op of expr.ops) {
    // Skip non-collection operands (a `Join` may mix scalars in): they
    // contribute themselves as a single element, always available.
    if (!op.isCollection && !typeCouldBeCollection(op.type.type)) continue;
    const e = op.isEnumerableCollection;
    if (e === false) return false;
    if (e === undefined) unknown = true;
  }
  return unknown ? undefined : true;
}

/**
 * A broadcast-eligible indexed-collection operand: an indexed collection that
 * is not a tuple (tuples carry point/vector semantics and stay atomic). Unlike
 * `isFiniteIndexedCollection`, this covers finite, unknown-length AND infinite
 * indexed collections — the element-wise operators (`Add`/`Multiply`, `Sin`, a
 * scalar-parameter lambda) broadcast over all of them; the known-finite vs.
 * unknown/infinite split (below) decides eager materialization vs. the lazy
 * `Map` form.
 *
 * Purely structural, with no evaluated-form fallback, where
 * {@link isEnumerableSource} has one — see the note there. In short: every
 * caller of this consults it on an already-evaluated operand, and a `false`
 * answer only declines to broadcast (the expression stays symbolic), so an
 * un-evaluated eager collection operand costs nothing here.
 */
export function isBroadcastableCollection(x: Expression): boolean {
  return x.isIndexedCollection === true && !isTuple(x) && !isTextAtom(x);
}

/**
 * True when `expr` is TEXT — a `string` value, or an expression whose static
 * type is `string`.
 *
 * A string is an indexed collection of its grapheme clusters, so `string` now
 * matches `indexed_collection` and a `string`-typed SYMBOL reports
 * `isIndexedCollection === true`. But a string stays ATOMIC under broadcast
 * and threading: `f(s) = s < "m"` applied to `"a"` must compare the whole
 * string, not map over one character (`docs/STRING_ROADMAP.md`, design
 * constraint 5).
 *
 * Matches on the static TYPE as well as the value kind, and — again mirroring
 * {@link isTuple} — follows a symbol's runtime value binding. Both extra hops
 * are load-bearing. A `string`-typed symbol or an application returning
 * `string` is not a `BoxedString` node, so the value-level `isString` guard
 * alone lets it through. And a lambda parameter left `unknown` by inference
 * (`w(c) = c == " "`) is not `string`-TYPED either, yet it HOLDS a string at
 * call time — without the value hop, `w(" ")` broadcast the body over the one
 * grapheme cluster of `" "` and answered `["True"]` instead of `True`.
 */
export function isTextAtom(expr: Expression): boolean {
  if (isString(expr)) return true;
  if (expr.type.matches('string')) return true;
  if (isSymbol(expr)) {
    const v = expr.value;
    if (v !== undefined && !isSymbol(v)) return isString(v);
  }
  return false;
}

/**
 * A broadcast participant of KNOWN-FINITE length: the operands an eager,
 * element-wise broadcast zips over.
 *
 * This is `isFiniteIndexedCollection` narrowed by the same two atomicity
 * exclusions {@link isBroadcastableCollection} applies — tuples carry
 * point/vector semantics, and strings are atomic under broadcast (a
 * scalar-parameter operator applied to a string must receive the WHOLE
 * string, never one grapheme cluster at a time; `docs/STRING_ROADMAP.md`
 * design constraint 5). It exists so that rule lives in ONE place instead of
 * being re-spelled at every eager broadcast site.
 */
export function isFiniteBroadcastParticipant(x: Expression): boolean {
  return isFiniteIndexedCollection(x) && !isTuple(x) && !isTextAtom(x);
}

/**
 * A materialized TUPLE whose components an eager, component-wise broadcast
 * can zip over right now.
 *
 * The companion of {@link isFiniteBroadcastParticipant}, which excludes
 * tuples because at most broadcast sites a tuple is ONE atomic value (a point
 * or a vector), spliced whole into every cell. The component-wise application
 * of a scalar function is the one place where a tuple supplies the cells
 * instead: `Sin((1, 2))` is `(sin 1, sin 2)`, the same rule the arithmetic
 * operators already follow for `(1, 2) · 3` and the same one the compiled
 * kernels apply. Only that broadcast arm consults this predicate.
 */
export function isTupleBroadcastParticipant(x: Expression): boolean {
  return isTuple(x) && isFiniteIndexedCollection(x);
}

/**
 * A broadcast-eligible operand whose length is NOT a known-finite number: an
 * infinite collection (`Cycle`, whose `count` is `Infinity`), or one whose
 * count is statically unknown (`Filter`, or a symbolic-length `Range` whose
 * `isFiniteCollection` is `undefined`). These cannot be eagerly zipped or
 * materialized — the eager `zip`/`at` loops would truncate to a single element
 * (`zip` treats an undefined count as `1`) — so a broadcast over them must
 * produce the lazy `Map` form. Note that `Filter` reports `isFiniteCollection
 * === true` yet `count === undefined`, so the `count === undefined` clause is
 * load-bearing, not redundant. A finite collection whose elements cannot be
 * walked (`Linspace(a, 1, 3)` with a symbolic `a`, see
 * {@link isWalkableFiniteCollection}) is in this class too: it has a count,
 * but the eager loops would read it as empty.
 */
export function isUnknownLengthBroadcast(x: Expression): boolean {
  return (
    isBroadcastableCollection(x) &&
    (!isWalkableFiniteCollection(x) || x.count === undefined)
  );
}

/**
 * Length agreement across the operands that supply the CELLS of an element-wise
 * broadcast.
 *
 * RULING (user-ratified 2026-07-24): a length mismatch is an ERROR, never a
 * truncation. Zipping to the shortest operand silently dropped the tail of the
 * longer one (`Less([1,2,3],[2,2])` → `[True, False]`), which is the same data
 * loss whether it happens in the eager zip, in `broadcastOverIndexedCollections`,
 * or lazily inside the variadic `Map`. This is the single check all three
 * consult, so a shape cannot answer differently depending on which path it
 * takes — the bug the first implementation shipped, where `Add(Filter(…), L)`
 * truncated while `Less` on the same shape errored.
 *
 * Participation is `isBroadcastableCollection`, so an INFINITE operand counts
 * too: `count` is `Infinity` there, which mismatches any finite length (the
 * ruling's "an unbounded operand against a finite one errors on the count
 * comparison"). A scalar is a LIFT, not a participant, and never mismatches; an
 * operand whose count is not yet known (`undefined` — a `Filter` before
 * evaluation, a symbolic-length `Range`) is skipped, since there is nothing to
 * compare until it resolves.
 *
 * Returns the error expression, or `undefined` when the lengths agree.
 */
export function broadcastLengthMismatch(
  ce: Expression['engine'],
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  // A count can be a `bigint` (a finite count that is not a safe integer).
  // `!==` and the message template give the correct result for a `bigint`,
  // so such an operand takes part in the check like any other.
  let first: number | bigint | undefined;
  for (const op of ops) {
    if (!isBroadcastableCollection(op)) continue;
    const n = op.count;
    if (n === undefined || n < 0) continue;
    if (first === undefined) first = n;
    else if (n !== first)
      return ce.error('incompatible-dimensions', `${first} vs ${n}`);
  }
  return undefined;
}

/**
 * A broadcast-eligible operand whose finiteness is **statically settled** —
 * either provably finite (`isFiniteCollection === true`, including the uncountable
 * `Filter`) or provably infinite (`isFiniteCollection === false`, e.g. `Cycle`).
 * A collection whose `isFiniteCollection` is `undefined` is deliberately
 * EXCLUDED: that is a not-yet-resolved collection expression whose length only
 * becomes known at evaluation — a symbolic-length `Range` before its bound
 * resolves, or a raw operand held unevaluated by a lazy operator (e.g.
 * `Reverse(Characters(s))` held by `Equal`). Broadcasting such an operand now
 * would freeze its unresolved form into the lazy `Map` and rob the operator of
 * the chance to fold it (a whole-collection `Equal`) once its operands
 * evaluate.
 *
 * Used to gate the POST-evaluation broadcast (`_computeValue` step 4b /
 * `_computeValueAsync` step 3b), whose `tail` may still hold raw operands for a
 * lazy operator. The pre-evaluation sites (step 2/2b) instead gate on
 * `isFiniteIndexedCollection` (settled-finite only); the value-path arithmetic
 * (`add`/`mul`) operates on already-evaluated operands and uses the wider
 * `isUnknownLengthBroadcast` so a genuinely symbolic-length `Range` lazifies.
 */
export function isKnownFinitenessBroadcast(x: Expression): boolean {
  return isBroadcastableCollection(x) && x.isFiniteCollection !== undefined;
}

/**
 * Does an element-wise broadcast over `ops` have a NON-participant operand
 * that is collection-SHAPED but carries no collection value yet — a symbol
 * declared `list<number>` and not assigned, or an application such as
 * `PointX(P)` over a valueless `P: list<tuple<number, number>>`?
 *
 * Such an operand fails every participant predicate, because they all read
 * `isIndexedCollection` — the "can I enumerate this NOW" CAPABILITY, which is
 * `false` when there is nothing to walk (see
 * {@link isValuelessCollectionTyped}). The broadcast would therefore splice it
 * whole into every cell, as if it were a scalar, and commit an answer the SAME
 * expression contradicts once the symbol is assigned. With
 * `A = Map(_ ↦ _/n, Range(0, n))` and a valueless `s: list<number>`,
 * `Multiply(A, s)` stored `Map(_ ↦ _·s, A)` and materialized as the outer
 * product `[[0,0,0],[5,10,15],[10,20,30]]` once `s := [10,20,30]`, where a
 * fresh evaluation of the same product zips to `[0,10,30]`.
 *
 * RULING (Tycho item 221): a collection-typed operand that is not yet a
 * collection VALUE must zip, or stay symbolic — never be captured as a
 * per-element scalar. Zipping is impossible without a value, so the broadcast
 * gates consult this predicate and DECLINE, leaving the operator inert until
 * the operand resolves; re-evaluating the inert form then zips.
 *
 * Tuples and strings are exempt: they are atomic under broadcast in the first
 * place (the two exclusions {@link isBroadcastableCollection} applies), so
 * splicing them whole is their correct treatment, with a value or without.
 *
 * The veto requires an actual participant — with no collection to broadcast
 * over there is no splice to prevent, and an ordinary symbolic product such as
 * `2·s` must keep folding. That test runs first, so a scalar application pays
 * only the participant sweep it was already paying.
 */
export function hasUnresolvedCollectionOperand(
  ops: ReadonlyArray<Expression>,
  isParticipant: (x: Expression, i: number) => boolean
): boolean {
  if (!ops.some((x, i) => isParticipant(x, i))) return false;
  return ops.some(
    (x, i) => !isParticipant(x, i) && isUnresolvedCollectionOperand(x)
  );
}

/**
 * One operand's half of {@link hasUnresolvedCollectionOperand}: collection-
 * shaped — outright, or through a type that merely ADMITS a collection (see
 * {@link mayHoldAnIndexedCollection}) — valueless, and not one of the two
 * atomic-under-broadcast kinds (tuples, including a tuple reached through a
 * bare `tuple` declaration or an alias, and strings). Call this directly at a
 * site where the operand that
 * would be spliced is already singled out — `When`'s condition, say — and the
 * sweep over a whole operand list has nothing to add.
 *
 * The symbol's VALUE is consulted when its own type does not say
 * "collection" — the same hop {@link isTuple} and {@link isTextAtom} make, and
 * for the same reason: a lambda PARAMETER bound to a valueless `list<number>`
 * symbol is itself typed `number`, because the body's use (`a + b`) narrowed
 * it while there was no value to check against. Reading only the parameter's
 * type made `g([1,2,3], s)` bind `s` as a per-element scalar and answer
 * `[s+1, s+2, s+3]`, the very splice this veto exists to prevent.
 *
 * The hop is a single step, never a walk: a chain of symbols each holding the
 * next is not a shape this needs to see through, and one step cannot spin on a
 * symbol that holds itself.
 */
export function isUnresolvedCollectionOperand(x: Expression): boolean {
  if (isUnresolvedCollectionShape(x)) return true;
  if (!isSymbol(x)) return false;
  const v = x.value;
  if (v === undefined || isSymbol(v, x.symbol)) return false;
  return isUnresolvedCollectionShape(v);
}

/**
 * The shape half of {@link isUnresolvedCollectionOperand}, applied to ONE
 * expression with no symbol-value hop: collection-shaped, carrying no
 * collection value, and not one of the two kinds that are atomic under
 * broadcast.
 *
 * The tuple exclusion is asked of the RESOLVED static type as well as of
 * `isTuple`: `isTuple` sees the bare `tuple` primitive and a transparent
 * alias for a tuple (`type pt = tuple<number, number>`), but it does not
 * unfold a NOMINAL reference to a tuple type, which `resolveTypeReference`
 * does. Without the second test, a symbol declared with such a nominal type
 * — which is a collection, so it satisfies `isValuelessCollectionTyped` —
 * would be vetoed, and `[1, 2, 3] · r` would stop scaling the list by the
 * tuple component-wise the way it does for a tuple that has a value.
 */
function isUnresolvedCollectionShape(x: Expression): boolean {
  if (isTuple(x) || isTextAtom(x)) return false;
  const t = x.type.type;
  const resolved = resolveTypeReference(t) ?? t;
  // A union whose every arm is a tuple (`tuple<integer> | tuple<integer,
  // missing>`) holds a tuple, so it is atomic too.
  if (isTupleOrTupleUnionShapedType(resolved)) return false;
  if (isValuelessCollectionTyped(x)) return true;
  if (x.isCollection) return false;
  return (
    mayHoldAnIndexedCollection(resolved) ||
    (!hasInferredType(x) && declaredUnionMayHoldACollection(resolved))
  );
}

/**
 * Whether the type of `x` was inferred from its uses rather than declared: a
 * symbol whose value definition says so, or an application whose operator
 * signature was inferred. `Mean(q)` infers `q` as
 * `collection<any> | distribution | number`, from the parameter of `Mean`,
 * and such a type does not say that `q` will hold a collection.
 */
function hasInferredType(x: Expression): boolean {
  if (isSymbol(x)) return x.valueDefinition?.inferredType === true;
  if (isFunction(x)) return x.operatorDefinition?.inferredSignature === true;
  return false;
}

/**
 * Whether the DECLARED type `t` is a union with an arm that is a collection
 * of any kind other than a tuple or a string: an indexed collection, an
 * abstract `collection<T>`, a set or a dictionary. A tuple and a string are
 * used whole by a broadcast, so they are excluded, as in
 * {@link mayHoldAnIndexedCollection}.
 *
 * {@link mayHoldAnIndexedCollection} counts only the indexed arms, which a
 * broadcast would map over. But an abstract arm can hold a list, and a set
 * or a dictionary arm makes a broadcast an error, so a per-element
 * expansion made while the operand has no value is wrong for these arms too.
 * With `P` declared `number | collection<number>`, `P < [1, 2]` expanded to
 * `[P < 1, P < 2]`; after `P := [5, 6]` that gave lists of lists. With `T`
 * declared `number | set<number>`, `T < [1, 2]` expanded the same way, and
 * after `T := Set(5, 6)` a fresh evaluation is an `incompatible-type` error.
 * Only a declaration counts (see `hasInferredType`): the statistics
 * operators infer such a union for a free symbol that they read, and a later
 * `q + [1, 2]` must still broadcast as it does for any free symbol.
 */
function declaredUnionMayHoldACollection(
  t: Type,
  seen?: AliasDescent
): boolean {
  if (typeof t === 'string' || t.kind !== 'union') return false;
  return t.types.some((branch) => {
    let next = seen;
    if (typeof branch === 'object' && branch.kind === 'reference') {
      next = recordUnfoldOnDescent(declarationOf(branch), seen);
      if (next === undefined) return false;
    }
    const b = resolveTypeReference(branch) ?? branch;
    if (isTupleShapedType(b) || isSubtype(b, 'string')) return false;
    return (
      isSubtype(b, COLLECTION_SHAPE_TYPE) ||
      declaredUnionMayHoldACollection(b, next)
    );
  });
}

/**
 * Does this type ADMIT a value an element-wise broadcast would map over,
 * without saying outright that it is a collection — the `list<number>` inside
 * `number | list<number>`, or the collection half of `broadcastable<number>`?
 *
 * Neither spelling `matches` `collection<any>`, because that match asks
 * whether the type DEFINITELY is a collection and the scalar alternative
 * defeats it — so {@link isValuelessCollectionTyped} misses both. But
 * assigning the collection alternative is exactly the future value that
 * contradicts a per-element splice: `Add([1, 2], u)` for a valueless
 * `u: number | list<number>` stored `[u + 1, u + 2]`, which becomes the outer
 * product `[[11,21],[12,22]]` once `u := [10, 20]`, where evaluating the same
 * sum fresh zips to `[11, 22]`. Holding is right under either resolution: a
 * later `u := 5` re-evaluates the held sum to the lift `[6, 7]`.
 *
 * Alternatives that are atomic under broadcast are not counted — a tuple and a
 * string are spliced whole, which is their correct treatment — mirroring the
 * two exclusions {@link isBroadcastableCollection} applies. Nor is a top-typed
 * (`unknown`/`any`) operand reached from here: a union with a top branch
 * reduces to the top, which is neither a union nor an `indexed_collection`
 * subtype, so the deliberate exclusion of every undeclared symbol documented
 * on {@link isValuelessCollectionTyped} is preserved. A `broadcastable<T>`
 * that arises mid-expression rather than from a declaration is likewise
 * untouched in practice: canonical flattening dissolves it, so
 * `[1,2] + (2 + h(x))` still broadcasts to `[h(x) + 3, h(x) + 4]`.
 */
function mayHoldAnIndexedCollection(t: Type, seen?: AliasDescent): boolean {
  if (typeof t === 'string') return false;
  if (t.kind === 'broadcastable') return true;
  if (t.kind !== 'union') return false;
  return t.types.some((branch) => {
    // A reference — alias OR nominal, since a nominal collection type may
    // hold an indexed collection too — is unfolded under the descent guard:
    // a self-referential declaration (`type alias cyc = cyc | 0`) reaches
    // itself through a bare arm, and that occurrence contributes no members
    // (`recordUnfoldOnDescent`).
    let next = seen;
    if (typeof branch === 'object' && branch.kind === 'reference') {
      next = recordUnfoldOnDescent(declarationOf(branch), seen);
      if (next === undefined) return false;
    }
    const b = resolveTypeReference(branch) ?? branch;
    if (isTupleShapedType(b) || isSubtype(b, 'string')) return false;
    return (
      isSubtype(b, INDEXED_COLLECTION_SHAPE_TYPE) ||
      mayHoldAnIndexedCollection(b, next)
    );
  });
}

/**
 * Whether evaluating `expr` to read its elements by index is **draw-free** —
 * the evaluation itself cannot consume randomness, so a cached evaluation
 * serves `at()` reads that stay coherent with `each()` across generations.
 *
 * True for any pure expression. Also true for a broadcasting operator
 * (`operatorDefinition.broadcastable`) whose impurity is confined to SCALAR
 * (lifted) operands: the distribute is structural — the random family is
 * inert under `evaluate()` (draws happen at the consumer, `.N()` or compiled
 * code), so `[1, 2] + RandomInteger(1, 10)` evaluates to
 * `[1 + RandomInteger(1, 10), 2 + RandomInteger(1, 10)]` without a draw, and
 * re-evaluation yields the identical structure. An impure collection
 * PARTICIPANT (`RandomShuffle(xs) + 1`) fails the test: its evaluation draws
 * a fresh permutation each time, so per-index reads spanning generations
 * could mix draw sets — the incoherence `_materializedAt`'s purity gate
 * exists to prevent. (A whole `each()` walk is one evaluation and stays
 * coherent within itself, which is why the walk is not gated on this.)
 *
 * Tycho item-169 ruling (2026-08-12): this is the delivery precondition that
 * lets `isEnumerableCollection` answer `true` for a broadcast — `true` is a
 * promise every access route must honor, including `at()`.
 */
export function isDrawFreeBroadcast(expr: Expression): boolean {
  if (expr.isPure) return true;
  if (!isFunction(expr)) return false;
  if (expr.operatorDefinition?.broadcastable !== true) return false;
  return expr.ops.every(
    (op) => !typeCouldBeCollection(op.type.type) || isDrawFreeBroadcast(op)
  );
}

/** Operators that construct a tuple. All canonicalize to `Tuple`. */
const TUPLE_OPERATORS = new Set(['Tuple', 'Pair', 'Triple', 'Single']);

/**
 * Heads whose application has a tuple-shaped TYPE only when one of its
 * operands has one: the arithmetic and elementary numeric heads.
 *
 * Each of them declares a scalar result. The only two ways the type
 * derivation of such an application (`type()` in `boxed-function.ts`)
 * produces a tuple are the head's own component-wise handler (`Add`,
 * `Multiply`, `Negate`, `Subtract` and `Divide` combine points in their
 * type handlers) and the generic tuple broadcast (arm 0 of the derivation,
 * `tupleBroadcastArity`), and both find the tuple by reading the operand
 * TYPES — a transparent alias unfolded, a nominal reference left opaque,
 * which is also how `isTupleShapedType` reads them. A list operand lifts the
 * result to a `list`, a possibly-collection operand to a `broadcastable`;
 * neither is tuple-shaped.
 *
 * `isTuple` and `isNumericTuple` use this to answer `false` for such an
 * application WITHOUT deriving its type when no operand can be a tuple: the
 * `Add`/`Multiply` canonicalization asks the question of every operand it
 * builds, and a derivation costs a descriptor per operand, the facts and the
 * interval fold of the handler — a quarter of a `simplify` call was spent
 * deriving the types of intermediate products and sums that only this
 * question ever read.
 *
 * A head is listed here only if its type handler never builds a tuple from
 * non-tuple operands. A head that constructs tuples (`Tuple`, `Pair`) or
 * reads one out of a collection (`At`, `First`) must stay off the list, as
 * must user functions, which may return a tuple from a scalar. The name
 * alone is not the test: a user definition may shadow a built-in name
 * (`ce.declare('Sin', { signature: '(number) -> tuple<number, number>' })`
 * makes `Sin(1)` a tuple), so `isScalarLiftApplication` also requires the
 * node's definition to be the engine's own, by identity with the
 * system-scope binding.
 */
const SCALAR_LIFT_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Negate',
  'Multiply',
  'Divide',
  'Power',
  'Sqrt',
  'Root',
  'Square',
  'Exp',
  'Ln',
  'Log',
  'Lb',
  'Lg',
  'Abs',
  'Sin',
  'Cos',
  'Tan',
  'Cot',
  'Sec',
  'Csc',
  'Arcsin',
  'Arccos',
  'Arctan',
  'Sinh',
  'Cosh',
  'Tanh',
  'Arsinh',
  'Arcosh',
  'Artanh',
]);

/**
 * How many levels of `SCALAR_LIFT_HEADS` applications
 * `operandTypeCannotBeTuple` descends before it reads a type. A derived type
 * is memoized per node, so reading it keeps a shared subtree (`(x+x)+(x+x)`,
 * nested) linear; the structural descent has no memo and would visit a
 * shared node once per path. The budget bounds that at 2⁴ visits.
 */
const SCALAR_LIFT_DESCENT = 4;

/**
 * Is `expr` an application of a `SCALAR_LIFT_HEADS` head resolved to the
 * engine's OWN definition of it? A definition declared by the user under
 * the same name — in any scope (`ce.loadLibrary()` included, which installs
 * into the global scope), or through the constructor's `libraries` option,
 * which installs into the system scope and is recorded in
 * `_customLibraryOperators` — is a different object from the system-scope
 * binding and answers `false`, so its application is typed by derivation.
 * The same identity test gates the compiler's built-in callbacks
 * (`builtinOperatorDefinition`, `compilation/builtin-callback.ts`).
 */
function isScalarLiftApplication(
  expr: Expression
): expr is Expression & FunctionInterface {
  if (!isFunction(expr)) return false;
  const name = expr.operator;
  if (!SCALAR_LIFT_HEADS.has(name)) return false;
  const engine = expr.engine;
  if (engine._customLibraryOperators.has(name)) return false;
  const binding = engine.contextStack[0]?.lexicalScope.bindings.get(name);
  return (
    binding !== undefined &&
    'operator' in binding &&
    binding.operator === expr.operatorDefinition
  );
}

/**
 * True when the TYPE of `expr` is provably not tuple-shaped, decided without
 * deriving the type of a `SCALAR_LIFT_HEADS` application: a number literal
 * never is, such an application is not when none of its operands is, and
 * any other expression is read off its type (a symbol's type is a definition
 * lookup, an unlisted head's type is the derivation itself).
 */
function operandTypeCannotBeTuple(expr: Expression, depth: number): boolean {
  if (isNumber(expr)) return true;
  if (depth > 0 && isScalarLiftApplication(expr))
    return expr.ops.every((x) => operandTypeCannotBeTuple(x, depth - 1));
  return !isTupleShapedType(expr.type.type);
}

/**
 * A **numeric tuple** is a `Tuple`/`Pair`/`Triple` — type `tuple<number,…>` —
 * whose every element type is a subtype of `number`. These are treated as
 * points/vectors in ℝⁿ, semantically distinct from Lists (see
 * `docs/plans/2026-07-07-tuple-point-semantics.md`).
 *
 * Type-based, so it covers literal tuples AND symbols declared with a numeric
 * tuple type (e.g. `z: tuple<number, number>`).
 */
export function isNumericTuple(expr: Expression): boolean {
  // A number literal is never a tuple, and its `.type` is the literal type,
  // synthesized on first read (`BoxedNumber._literalType`) — a cost the
  // `Add`/`Multiply` canonicalization, which asks this of every operand,
  // need not pay to learn the answer. An arithmetic application over
  // operands that cannot be tuples is not one either, and its type
  // derivation is skipped for the same reason (`SCALAR_LIFT_HEADS`).
  if (isNumber(expr)) return false;
  if (
    isScalarLiftApplication(expr) &&
    operandTypeCannotBeTuple(expr, SCALAR_LIFT_DESCENT)
  )
    return false;
  // See `typeCouldBeNumericCollection` on why a transparent alias is unfolded
  // here and a nominal reference is not.
  const t = resolveTypeAlias(expr.type.type);
  if (typeof t === 'string') return false;
  if (t.kind !== 'tuple') return false;
  return t.elements.every((el) => isSubtype(el.type, 'number'));
}

/** Is `t` — already alias-resolved — a parameterized tuple whose every
 *  component type is a subtype of `number`? */
function isNumericTupleType(t: Type): boolean {
  if (typeof t === 'string') return false;
  if (t.kind !== 'tuple') return false;
  return t.elements.every((el) => isSubtype(el.type, 'number'));
}

/**
 * `isNumericTuple`, read through an absence arm and across a union of tuple
 * spellings: true when every value the operand can take, other than the
 * absent one, is a numeric tuple. `q: missing | tuple<number, number>` (a
 * gated point) and `w: tuple<integer, number> | tuple<number, integer>` are
 * both numeric tuples in every non-absent case, so `q + 2` and `w + 2` are
 * the same `scalar + tuple` mistake `p + 2` is for `p: tuple<number, number>`.
 * Used by the `canonicalAdd` rejection only; `isNumericTuple` itself keeps
 * its exact reading for the callers that build tuple arithmetic from
 * `t.elements`.
 */
export function isNumericTupleCarrier(expr: Expression): boolean {
  // The two early exits of `isNumericTuple`, for the reasons given there: a
  // number literal is never a tuple, and neither is a scalar-lift application
  // over operands that cannot be tuples.
  if (isNumber(expr)) return false;
  if (
    isScalarLiftApplication(expr) &&
    operandTypeCannotBeTuple(expr, SCALAR_LIFT_DESCENT)
  )
    return false;
  // The alias is unfolded BEFORE the absence arm is stripped:
  // `stripMissingFromType` leaves a reference node as it is, so an alias of
  // `missing | tuple<number, number>` would keep its `missing` arm and fail
  // the tuple test below, admitting the very `scalar + tuple` case this
  // predicate exists to reject.
  const t = resolveTypeAlias(
    stripMissingFromType(resolveTypeAlias(expr.type.type))
  );
  // An operand typed `missing` alone has no non-absent value to be a tuple.
  if (t === 'never') return false;
  if (typeof t === 'string') return false;
  if (t.kind === 'tuple') return isNumericTupleType(t);
  if (t.kind === 'union')
    return (
      t.types.length > 0 &&
      t.types.every((branch) => isNumericTupleType(resolveTypeAlias(branch)))
    );
  return false;
}

/**
 * True when `expr`'s TYPE is a tuple that **could** be a numeric tuple
 * (point/vector in ℝⁿ) at runtime: every element type could be numeric —
 * including `unknown`/`any` elements (e.g. `(S(x,y,0), S(x,y,1))` with
 * `S: (…) -> unknown`, typed `tuple<unknown, unknown>`) and numeric-collection
 * elements (a Desmos-style point-list component like `(-6, n)` with `n` a
 * list).
 *
 * COULD-semantics, delegating to `typeCouldBeNumericTuple` — the SAME
 * predicate `checkNumericArgs` (`validate.ts`) uses for operand admission,
 * so the two layers cannot diverge: the `Add`/`Multiply` type handlers and
 * the invisible-operator multiply-vs-`Tuple` gate use this so an
 * unknown-component tuple keeps its honest tuple type through arithmetic
 * instead of collapsing to `number` (Tycho item 30). It must NOT be used where
 * a *provable* numeric tuple is required (the `scalar + tuple` rejection guards
 * use the strict `isNumericTuple`: an unknown element is retractable evidence,
 * not proof).
 */
export function couldBeNumericTuple(expr: Expression): boolean {
  return typeCouldBeNumericTuple(expr.type.type);
}

/**
 * A tuple/collection element type that **could** be numeric at runtime:
 * `any`/`unknown`, a subtype or supertype of `number`, or itself a
 * could-be-numeric collection or tuple (a Desmos-style point-list component
 * like `(-6, n)` with `n` a list, or a nested point). A provably non-numeric
 * element (`string`, `list<string>`, …) does not qualify.
 *
 * Fixed-shape (dimensioned) collection elements — `vector<n>`, `matrix` —
 * DO qualify, matching what `checkNumericArgs` has always admitted (a
 * `tuple<matrix, integer>` operand participates in tuple arithmetic and keeps
 * its tuple type; pinned in `points-arithmetic.test.ts`). This deliberately
 * differs from `dimensionlessIndexedElement`, which excludes fixed shapes
 * because *broadcast* (not element-could-be-numeric) semantics leave those to
 * tensor typing.
 */
function couldBeNumericElement(el: Type, seen?: AliasDescent): boolean {
  // An alias element is judged by the body it names, so a union alias is
  // taken arm by arm below: `type alias nz = 0 | list<nz>` has numeric
  // elements because of its `0` arm, which only the unfold reveals. Under
  // the descent guard, a self-referential occurrence that has spent its
  // allowance contributes no members (`unfoldAliasOnDescent`).
  const unfolded = unfoldAliasOnDescent(el, seen);
  if (unfolded === undefined) return false;
  el = unfolded.type;
  seen = unfolded.seen;
  // A union element COULD be numeric if any arm could (COULD-semantics).
  if (typeof el !== 'string' && el.kind === 'union')
    return el.types.some((t) => couldBeNumericElement(t, seen));
  // Note: `signature`-kind elements deliberately do NOT qualify — a function
  // value is not a numeric component, and blessing its collection here would
  // leak numeric broadcast/tuple result types through the shared
  // `Add`/`Multiply` type handlers. The lenient treatment of a function
  // SYMBOL in numeric position (`2·N` stays symbolic) lives in
  // `checkNumericArgs`'s eager element walk instead (validate.ts).
  return (
    el === 'any' ||
    el === 'unknown' ||
    // An absent component (`Missing`, or `Undefined`, which a tuple literal
    // also types `missing`) reads as `NaN` in a numeric slot, so it does not
    // stop the tuple from being a point: `-(1, Missing)` negates to
    // `(-1, NaN)` and `(3, 4) - (1, Missing)` is `(2, NaN)`. Without this
    // both stayed inert.
    el === 'missing' ||
    isSubtype(el, 'number') ||
    isSubtype('number', el) ||
    typeCouldBeNumericCollection(el, seen) ||
    typeCouldBeNumericTuple(el, seen)
  );
}

/**
 * Return true if a type could be a collection — of ANY kind — at runtime.
 * `dictionary` and `record` qualify: both are subtypes of `collection` (a
 * dictionary is a collection of key–value pairs), even though neither is
 * indexed.
 *
 * This is the predicate for consumers that must not mistake an unresolved
 * collection-typed operand for a scalar datum: the eager materializers'
 * inertness gates (`ListFrom`/`SetFrom`/`TupleFrom` stay inert on a
 * collection-TYPED operand with no value yet, USER-RULED 2026-08-11) and the
 * enumerability probes over multi-source operators
 * (`enumerableFromAllSources`, `canEnumerateCollectionOperands`).
 *
 * For threadable/broadcast admission use `typeCouldBeUnkeyedCollection`
 * instead: the keyed collections (`dictionary`, `record`) hold key–value
 * pairs, not elements, so in a scalar position they get a loud
 * `incompatible-type` error rather than admission.
 */
export function typeCouldBeCollection(
  type: Type,
  seen?: AliasDescent
): boolean {
  // See `typeCouldBeNumericCollection` on why a transparent alias is unfolded
  // here and a nominal reference is not.
  // The unfold runs under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias (`type alias cyc = cyc | 0`,
  // `type alias nest = list<nest>`) stops at its first repeat, and that arm
  // contributes no members.
  const unfolded = unfoldAliasOnDescent(type, seen);
  if (unfolded === undefined) return false;
  type = unfolded.type;
  seen = unfolded.seen;
  if (typeof type === 'string') {
    return (
      type === 'collection' ||
      type === 'indexed_collection' ||
      type === 'list' ||
      // An index span is an indexed collection of integers.
      type === 'range' ||
      // A string is an indexed collection of its grapheme clusters. Admitted
      // HERE (this is the "do not mistake an unresolved collection-typed
      // operand for a scalar datum" predicate, and a valueless `string`-typed
      // symbol is exactly such a case) but deliberately NOT in
      // `typeCouldBeUnkeyedCollection` below, which is broadcast/threading
      // admission — strings are broadcast-atomic.
      type === 'string' ||
      type === 'set' ||
      type === 'tuple' ||
      type === 'dictionary' ||
      type === 'record' ||
      type === 'any'
    );
  }
  if (
    type.kind === 'collection' ||
    type.kind === 'indexed_collection' ||
    type.kind === 'list' ||
    type.kind === 'set' ||
    type.kind === 'tuple' ||
    type.kind === 'dictionary' ||
    type.kind === 'record' ||
    // A `broadcastable<T>` operand COULD be an indexed collection at runtime.
    type.kind === 'broadcastable'
  )
    return true;
  if (type.kind === 'union')
    return type.types.some((t) => typeCouldBeCollection(t, seen));
  return false;
}

/**
 * Return true if a type could be an UNKEYED collection at runtime — a
 * collection whose members are elements (`list`, `set`, `tuple`, a bare
 * `collection`), as opposed to the KEYED collections (`dictionary`,
 * `record`) whose members are key–value pairs. This is the admission
 * question for threadable/broadcastable functions accepting an argument in
 * a scalar position (e.g. `number | list`).
 *
 * The keyed/unkeyed line is the admission boundary, not indexability: a
 * `set` cannot be indexed, yet a set operand is deliberately admitted — it
 * binds WHOLE under generic lift admission and the call stays typed
 * symbolic (`Conjugate(Set(1, 2))` types as `set<integer>`; §5.3
 * D10, pinned in `generic-function-literals.test.ts` and
 * `type-variables-linalg.test.ts`), keeping image-of-a-set semantics
 * available. A keyed collection in a scalar position is instead a loud
 * `incompatible-type` error: its members are pairs, so element-wise or
 * image semantics do not apply.
 *
 * Unions qualify per-arm: `number | list` is admitted because its `list`
 * arm could broadcast. A union with NO unkeyed-collection arm
 * (`number | dictionary`) is not admitted here even though its scalar arm
 * is viable at runtime — such an operand's fate rests entirely with
 * ordinary argument validation. (Unchanged from before the keyed/unkeyed
 * split; recorded so the asymmetry is a documented choice, not an
 * accident.)
 */
export function typeCouldBeUnkeyedCollection(
  type: Type,
  seen?: AliasDescent
): boolean {
  // See `typeCouldBeNumericCollection` on why a transparent alias is unfolded
  // here and a nominal reference is not.
  // The unfold runs under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias (`type alias cyc = cyc | 0`,
  // `type alias nest = list<nest>`) stops at its first repeat, and that arm
  // contributes no members.
  const unfolded = unfoldAliasOnDescent(type, seen);
  if (unfolded === undefined) return false;
  type = unfolded.type;
  seen = unfolded.seen;
  if (typeof type === 'string') {
    return (
      type === 'collection' ||
      type === 'indexed_collection' ||
      type === 'list' ||
      // An index span is unkeyed and indexed — it broadcasts like a list.
      type === 'range' ||
      type === 'set' ||
      type === 'tuple' ||
      type === 'any'
    );
  }
  if (
    type.kind === 'collection' ||
    type.kind === 'indexed_collection' ||
    type.kind === 'list' ||
    type.kind === 'set' ||
    type.kind === 'tuple' ||
    // A `broadcastable<T>` operand COULD be an indexed collection at runtime.
    type.kind === 'broadcastable'
  )
    return true;
  if (type.kind === 'union')
    return type.types.some((t) => typeCouldBeUnkeyedCollection(t, seen));
  return false;
}

/**
 * A threadable operand that broadcasting or lift admission may consume as a
 * collection: either the *value* is an actual finite indexed collection
 * (regardless of how precise its static type is), or the static *type*
 * admits an UNKEYED collection at runtime (`list`, `number | list`, `set`,
 * `broadcastable<T>`, …) even though no value is materialized. Neither
 * check subsumes the other. Such an operand is admitted as-is and excluded
 * from scalar parameter-type inference. The KEYED collections
 * (`dictionary`, `record`) are deliberately NOT admitted — see
 * `typeCouldBeUnkeyedCollection` for the keyed/unkeyed rationale.
 *
 * Lives here, beside the sibling COULD-semantics predicates, so that argument
 * validation (`boxed-expression/validate.ts`), overload resolution
 * (`boxed-expression/overload.ts`) and result typing
 * (`boxed-expression/boxed-function.ts`) all share ONE definition. A private
 * copy in `validate.ts` would let the resolution used for validation and the
 * resolution used for result typing admit different arms.
 */
export function couldBeUnkeyedCollectionOperand(op: Expression): boolean {
  // A STRING never qualifies. This is threadable/broadcast admission, and
  // strings are broadcast-atomic: admitting one here would let a string
  // literal through EVERY scalar position of a threadable operator on the
  // strength of "it could be broadcast", which is exactly what must not
  // happen — `f(c: character)` has to refuse `"ab"`. The type half
  // (`typeCouldBeUnkeyedCollection`) already excludes `string` for the same
  // reason; this is the value half of the same rule.
  if (isTextAtom(op)) return false;
  return (
    isFiniteIndexedCollection(op) || typeCouldBeUnkeyedCollection(op.type.type)
  );
}

/**
 * Return true if a type could be a numeric collection at runtime — a `list`,
 * `set`, `collection`, or `indexed_collection` whose elements could be
 * numeric, or a `broadcastable<S>` with a numeric-ish element. COULD-
 * semantics: bare kinds (`list`, `collection`, …) and `any`/`unknown`
 * elements qualify; a statically non-numeric element type (`list<string>`)
 * does not.
 *
 * SINGLE SOURCE OF TRUTH shared by `checkNumericArgs` (`validate.ts`, the
 * operand-admission gate) and — via `couldBeNumericTuple` — the
 * `Add`/`Multiply` type handlers and the invisible-operator gate. The two
 * layers must never diverge: an operand admitted by validation but missed by
 * the type handlers collapses to `number` through the `isFinite === false`
 * path and lets the `Add` scalar-plus-tuple guard bake `incompatible-type`
 * (Tycho item 30).
 */
export function typeCouldBeNumericCollection(
  type: Type,
  seen?: AliasDescent
): boolean {
  // A TRANSPARENT alias IS its definition, so unfold one before asking about
  // its kind: `isSubtype` unfolds an alias reference on both sides, and a
  // gate that reads `type.kind` directly must agree with it or an alias of a
  // collection is admitted at one layer and refused at the other. A NOMINAL
  // reference is left alone — it is deliberately not a subtype of its
  // definition, so it must keep failing this gate.
  // The unfold runs under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias (`type alias cyc = cyc | 0`,
  // `type alias nest = list<nest>`) stops at its first repeat, and that arm
  // contributes no members.
  const unfolded = unfoldAliasOnDescent(type, seen);
  if (unfolded === undefined) return false;
  type = unfolded.type;
  seen = unfolded.seen;
  if (typeof type === 'string') {
    return (
      type === 'list' ||
      type === 'set' ||
      type === 'collection' ||
      type === 'indexed_collection' ||
      // An index span is a collection of integers, so it is admissible
      // wherever a numeric collection is. Omitting it made a symbol DECLARED
      // `range` fail `checkNumericArgs` with `incompatible-type` in a numeric
      // broadcast (`Multiply(r, 2)` for `r: range`), while the equivalent
      // `indexed_collection<integer>` declaration passed — a literal `Range`
      // call was rescued by the later finite-collection branch, so only the
      // declared-symbol route showed it.
      type === 'range'
    );
  }
  if (
    type.kind === 'collection' ||
    type.kind === 'indexed_collection' ||
    type.kind === 'list' ||
    type.kind === 'set'
  )
    return couldBeNumericElement(type.elements, seen);
  // A `broadcastable<S>` operand COULD be a numeric indexed collection at
  // runtime. `broadcastable<any>`/`broadcastable<unknown>` qualify too; a
  // plainly non-numeric element (e.g. `broadcastable<string>`) does not.
  //
  // Decided by the SAME element predicate the collection kinds above use, for
  // the same reason: the base `S` is whatever the un-lifted expression typed,
  // and `broadcastable<S>` means "an `S`, or a list of `S`", so
  // such an operand broadcasts elementwise exactly as a collection of `S`
  // does. This arm used to hand-roll a weaker copy of `couldBeNumericElement`
  // that tested only for a numeric SCALAR base, which had two consequences: a
  // collection or tuple base (`broadcastable<vector<n>>` — what applying a
  // vector-valued function to a declared-but-not-yet-assigned callee produces)
  // was refused, so a `Divide` numerator's parse validity depended on whether
  // its callees had been assigned yet (Tycho item 188, pinned in
  // `test/compute-engine/tycho-item-188-broadcastable-vector-divide.test.ts`);
  // and a mixed union base (`integer | string`) was refused here while
  // the identical `list<integer | string>` was admitted. Delegating
  // keeps this kind in lockstep with every other collection kind by
  // construction.
  if (type.kind === 'broadcastable')
    return couldBeNumericElement(type.elements, seen);
  if (type.kind === 'union')
    return type.types.some((t) => typeCouldBeNumericCollection(t, seen));
  return false;
}

/**
 * Return true when a type is a collection whose element type is **concrete and
 * provably non-numeric** — e.g. `indexed_collection<string>`,
 * `list<string>`, `broadcastable<boolean>`. This is the strict complement of
 * {@link typeCouldBeNumericCollection} restricted to concrete-element
 * collections: a bare kind (`list`) or an `any`/`unknown` element is NOT
 * provably non-numeric (it *could* be numeric at runtime), so it does not
 * qualify.
 *
 * Companion to {@link typeCouldBeNumericCollection}, kept next to it so the two
 * stay in lockstep. Used by `validateThreadableOperand` (`validate.ts`) to
 * reject a statically non-numeric collection operand of a threadable numeric
 * operator (`Add`/`Multiply`/`Ln`/…) at boxing *without walking its
 * elements* — the element type already disproves numericity.
 */
export function typeIsProvablyNonNumericCollection(
  type: Type,
  seen?: AliasDescent
): boolean {
  // See `typeCouldBeNumericCollection` on why a transparent alias is unfolded
  // here and a nominal reference is not.
  // The unfold runs under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias (`type alias cyc = cyc | 0`,
  // `type alias nest = list<nest>`) stops at its first repeat, and that arm
  // contributes no members, so
  // it is vacuously non-numeric.
  const unfolded = unfoldAliasOnDescent(type, seen);
  if (unfolded === undefined) return true;
  type = unfolded.type;
  seen = unfolded.seen;
  if (typeof type === 'string') return false; // bare kind: could be numeric
  if (
    type.kind === 'collection' ||
    type.kind === 'indexed_collection' ||
    type.kind === 'list' ||
    type.kind === 'set'
  ) {
    const el = type.elements;
    if (el === 'any' || el === 'unknown') return false;
    return !couldBeNumericElement(el, seen);
  }
  // Expressed as the exact negation of the companion so the two cannot drift:
  // the companion's broadcastable arm already returns `true` for
  // `any`/`unknown` elements and for a collection- or tuple-typed base.
  if (type.kind === 'broadcastable')
    return !typeCouldBeNumericCollection(type, seen);
  // A union is provably non-numeric only if EVERY member is (any could-be-
  // numeric member keeps the whole union admissible).
  if (type.kind === 'union')
    return type.types.every((t) => typeIsProvablyNonNumericCollection(t, seen));
  return false;
}

/**
 * Return true if a type *could* be a numeric tuple (point/vector in ℝⁿ) at
 * runtime — a `tuple` whose every element could be numeric (see
 * `couldBeNumericElement`; an `any`/`unknown` element, e.g. `(w.x, w.y)` on
 * an undeclared `w`, qualifies). Shared by `checkNumericArgs` and the
 * arithmetic type handlers — see `typeCouldBeNumericCollection` on why the
 * two layers must not diverge.
 */
export function typeCouldBeNumericTuple(
  type: Type,
  seen?: AliasDescent
): boolean {
  // See `typeCouldBeNumericCollection` on why a transparent alias is unfolded
  // here and a nominal reference is not.
  // The unfold runs under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias (`type alias cyc = cyc | 0`,
  // `type alias nest = list<nest>`) stops at its first repeat, and that arm
  // contributes no members.
  const unfolded = unfoldAliasOnDescent(type, seen);
  if (unfolded === undefined) return false;
  type = unfolded.type;
  seen = unfolded.seen;
  if (typeof type === 'string') return type === 'tuple';
  if (type.kind === 'tuple')
    return type.elements.every((el) => couldBeNumericElement(el.type, seen));
  if (type.kind === 'union')
    return type.types.some((t) => typeCouldBeNumericTuple(t, seen));
  return false;
}

/**
 * Return true if a type is an INDEXABLE COLLECTION whose ELEMENTS could be
 * numeric tuples at runtime — a point LIST such as
 * `list<tuple<number, number>>`, the shape a Desmos document carries for a
 * set of points.
 *
 * Only `list` and `indexed_collection` kinds qualify, plus the generic
 * `collection` kind: the elements of an unordered `set` are not scaled
 * position-wise by the arithmetic handlers, and a bare kind name (`'list'`)
 * carries no element type to inspect. A union qualifies when any arm does
 * (COULD-semantics, matching `typeCouldBeNumericTuple`).
 *
 * `broadcastable<…>` deliberately does NOT qualify: the `Divide` type handler
 * has a dedicated branch for a broadcast-lifted shaped numerator that must
 * keep the lift in the result, and blessing it here would strip it.
 */
export function typeCouldBeNumericTupleCollection(
  type: Type,
  seen?: AliasDescent
): boolean {
  // See `typeCouldBeNumericCollection` on why a transparent alias is unfolded
  // here and a nominal reference is not.
  // The unfold runs under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias (`type alias cyc = cyc | 0`,
  // `type alias nest = list<nest>`) stops at its first repeat, and that arm
  // contributes no members.
  const unfolded = unfoldAliasOnDescent(type, seen);
  if (unfolded === undefined) return false;
  type = unfolded.type;
  seen = unfolded.seen;
  if (typeof type === 'string') return false;
  if (type.kind === 'union')
    return type.types.some((t) => typeCouldBeNumericTupleCollection(t, seen));
  if (
    type.kind === 'list' ||
    type.kind === 'indexed_collection' ||
    type.kind === 'collection'
  )
    return typeCouldBeNumericTuple(type.elements, seen);
  return false;
}

/**
 * {@link typeCouldBeNumericTupleCollection}, read through the rows of a
 * nested collection too: a list of rows of points
 * (`list<list<tuple<number, number>>>`) qualifies, at any depth up to a
 * bound. The `Divide` type handler reads it: a quotient of such a list by a
 * scalar divides each point, so its cells stay points.
 */
export function typeCouldBeNestedNumericTupleCollection(
  type: Type,
  seen?: AliasDescent,
  depth = 0
): boolean {
  if (typeCouldBeNumericTupleCollection(type, seen)) return true;
  if (depth >= 8) return false;
  const unfolded = unfoldAliasOnDescent(type, seen);
  if (unfolded === undefined) return false;
  const t = unfolded.type;
  if (typeof t === 'string') return false;
  if (t.kind === 'union')
    return t.types.some((m) =>
      typeCouldBeNestedNumericTupleCollection(m, unfolded.seen, depth + 1)
    );
  if (
    t.kind === 'list' ||
    t.kind === 'indexed_collection' ||
    t.kind === 'collection'
  )
    return typeCouldBeNestedNumericTupleCollection(
      t.elements,
      descendIntoConstructor(unfolded.seen),
      depth + 1
    );
  return false;
}

/**
 * True when `expr`'s TYPE is a matrix/vector/list-style collection (a `list`,
 * `collection`, or `indexed_collection` kind) — i.e. the kind of collection
 * that participates in linear-algebra arithmetic (`Add`/`Multiply`). Numeric
 * tuples (points/vectors typed `tuple<…>`) are deliberately EXCLUDED: they are
 * handled separately (component-wise) by `isNumericTuple`.
 *
 * Used by the `Add`/`Multiply` type handlers so that a product or sum with a
 * declared-matrix (or -vector, -list) operand carries the collection type
 * instead of collapsing to a numeric type. Type-based, so it covers literal
 * collections AND symbols declared with a collection type (e.g. `X: matrix`).
 */
export function isLinearAlgebraCollection(expr: Expression): boolean {
  return typeIsLinearAlgebraCollection(expr.type.type);
}

/**
 * The type-level test behind `isLinearAlgebraCollection`, for a caller that
 * holds a TYPE rather than an expression — the invisible-operator gate reads
 * an operand's type with its absence marker stripped (`missing | list<…>`
 * scales as `list<…>` does).
 */
export function typeIsLinearAlgebraCollection(type: Readonly<Type>): boolean {
  // See `typeCouldBeNumericCollection` on why a transparent alias is unfolded
  // here and a nominal reference is not.
  const t = resolveTypeAlias(type);
  if (
    t === 'list' ||
    t === 'collection' ||
    t === 'indexed_collection' ||
    // An index span is a sequence of numbers, so it participates in linear
    // algebra exactly as it did before the `range` type existed (when a
    // qualifying `Range` typed as `indexed_collection<integer>`).
    t === 'range'
  )
    return true;
  return (
    typeof t !== 'string' &&
    (t.kind === 'list' ||
      t.kind === 'collection' ||
      t.kind === 'indexed_collection')
  );
}

/**
 * True when `expr`'s TYPE is a **fixed-shape (dimensioned)** list — a
 * `vector<n>`, `matrix`, or higher-rank tensor: a `list`-kind type carrying
 * `dimensions`. These are the un-evaluated linear-algebra intermediates (e.g.
 * `10^4·[1,2,3]` typed `vector<3>`) that broadcast to a `List` at evaluation,
 * but whose static type is not a plain dimensionless `list<E>` — so they are
 * NOT caught by `isBroadcastCollectionType` (which excludes fixed shapes) and
 * need their own trigger in the broadcast-typing arm.
 *
 * Deliberately NARROWER than `isLinearAlgebraCollection`: it does NOT match the
 * generic `collection`/`indexed_collection` kinds (nor a bare `list`). A
 * generic `collection<E>` operand may be a non-indexed `set` at runtime, which
 * the evaluator's broadcast paths (all `isFiniteIndexedCollection`-gated) never
 * broadcast — so admitting it here would type a `list<E>` the value path never
 * produces.
 */
export function isFixedShapeCollection(expr: Expression): boolean {
  // A transparent alias of a fixed shape IS that shape (see
  // `typeCouldBeNumericCollection`): a symbol declared with an alias of
  // `vector<2>` broadcasts exactly like one declared `vector<2>`, so the
  // trigger must see the shape, not the reference node.
  //
  // A tensor of unknown rank (`tensor<U>`, whose `dimensions` is `null`)
  // has no fixed shape: it broadcasts like an abstract collection, through
  // `isBroadcastCollectionType`, and never reaches a tensor handler.
  const t = resolveTypeAlias(expr.type.type);
  return typeof t !== 'string' && t.kind === 'list' && !!t.dimensions;
}

/**
 * Whether a list whose cells are of type `cell` may carry a dimension list,
 * that is, be typed as a `vector`, a `matrix` or a tensor rather than as a
 * plain list (or nested plain lists) of its elements. The rule is the type
 * system's (`cellTypeMayCarryDimensions`, `common/type/primitive.ts`): the
 * cells of a list with dimensions cannot be lists. So booleans, strings and
 * tuples keep their lengths: `[True, False]` is a `list<boolean^2>`, `M < 3`
 * over a 2×2 matrix `M` is a `matrix<boolean^(2x2)>`, and
 * `Map((x) => x > 1, [1, 2, 3])` is a `list<boolean^3>`. The names
 * `vector<U>`, `matrix<U>` and `tensor<U>` take the same cells, any cell
 * that cannot hold a list. Every site of the engine that attaches dimensions to a type it
 * builds asks here, so a change of the rule (for example to numeric cells
 * only, the rule of decision D3 in
 * `docs/plans/2026-10-21-list-element-tensor-cell.md`, which was measured
 * and not applied) is a change of this one function.
 */
export function mayCarryDimensions(cell: Readonly<Type>): boolean {
  return cellTypeMayCarryDimensions(cell as Type);
}

/**
 * The type one level toward the leaves of the collection type `t`, for a
 * walk that reads every level down to the scalar cells: the cells `U` of a
 * tensor of unknown rank (`tensor<U>`, whose `dimensions` is `null`), and
 * `collectionElementType(t)` for any other type. The element type of such
 * a tensor is `U | tensor<U>` (what one index returns: a cell, or a tensor
 * of lower rank), an element that contains the tensor itself, so a walk
 * that descended through it would never reach the cells.
 */
export function leafwardElementType(t: Readonly<Type>): Type | undefined {
  const r = resolveTypeAlias(t);
  if (typeof r !== 'string' && r.kind === 'list' && r.dimensions === null)
    return r.elements;
  return collectionElementType(t);
}

/**
 * The cell type a broadcast maps over for an operand of type `t`: the
 * operand's own type for a scalar, its cells for a collection of any rank
 * (`broadcastCellType`, `common/type/utils.ts`), read first for the two
 * spellings whose element type is not their cell type. A `broadcastable<T>`
 * is a `T` or a tensor of `T` cells, and a tensor of unknown rank
 * `tensor<U>` has `U` cells; for both, `collectionElementType` answers what
 * one index returns, `T | tensor<T>`, a union that the walk of
 * `broadcastCellType` cannot descend, so the cell it reported kept a
 * `tensor` arm (`2h(x) - 1` with `h: (number) -> unknown` was typed
 * `broadcastable<number | tensor>` instead of `broadcastable<number>`). A
 * union is read arm by arm and the arms are joined, as
 * `broadcastElementType` joins them.
 *
 * The alias unfold runs under the descent guard (`unfoldAliasOnDescent`,
 * `common/type/utils.ts`): an alias that names itself, as a union arm
 * (`type alias lcyc = lcyc | list<integer>`) or inside a cell type, is
 * returned unchanged at its first repeat on a path, and the cell type of
 * that occurrence is then read by `broadcastCellType`, which has its own
 * guard. Without the guard, each recursive call unfolded the alias again and
 * the walk never stopped.
 */
export function broadcastCellTypeOf(
  t: Readonly<Type>,
  seen?: AliasDescent
): Type {
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return broadcastCellType(t);
  const r = unfolded.type;
  if (typeof r !== 'string') {
    if (
      r.kind === 'broadcastable' ||
      (r.kind === 'list' && r.dimensions === null)
    )
      return broadcastCellTypeOf(r.elements, unfolded.seen);
    if (r.kind === 'union') {
      const arms = r.types.map((x) => broadcastCellTypeOf(x, unfolded.seen));
      if (arms.some((x, i) => x !== r.types[i])) return widenAll(arms) as Type;
    }
  }
  return broadcastCellType(t);
}

/**
 * The per-element type a broadcastable operator's answer contributes to
 * its broadcast result, ONE rank unwrapped (`broadcastElementType`,
 * `common/type/utils.ts`), with the same two spellings read first as in
 * `broadcastCellTypeOf`: a `broadcastable<S>` answer contributes `S`, and a
 * tensor of unknown rank contributes its cells. Through
 * `collectionElementType` both would contribute `S | tensor<S>`, and the
 * lift then wrapped that into `broadcastable<S | tensor<S>>`.
 *
 * The alias unfold runs under the descent guard (`unfoldAliasOnDescent`,
 * `common/type/utils.ts`): an alias that names itself as a union arm
 * (`type alias lcyc = lcyc | list<integer>`) is returned unchanged at its
 * first repeat on a path, as `broadcastElementType` returns it. Without the
 * guard, each union arm unfolded the alias again and the walk never stopped.
 */
export function broadcastElementTypeOf(
  t: Readonly<Type>,
  seen?: AliasDescent
): Type {
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return t as Type;
  const r = unfolded.type;
  if (typeof r !== 'string') {
    if (
      r.kind === 'broadcastable' ||
      (r.kind === 'list' && r.dimensions === null)
    )
      return r.elements;
    if (r.kind === 'union') {
      const arms = r.types.map((x) => broadcastElementTypeOf(x, unfolded.seen));
      if (arms.some((x, i) => x !== r.types[i])) return widenAll(arms) as Type;
    }
  }
  return broadcastElementType(t);
}

/**
 * The plain-list spelling of a list of rank `rank` whose cells are `cell`:
 * `rank` list levels around the cell, with no dimension list. It is the
 * type of a shaped value whose cells cannot carry dimensions
 * (`mayCarryDimensions`), that is, cells that may be lists: a 2 by 2
 * arrangement of `list<integer>` cells is a `list<list<list<integer>>>`.
 * Booleans, strings and tuples carry dimensions (`matrix<boolean^(2x2)>`).
 */
export function nestedPlainListType(cell: Type, rank: number): Type {
  let t: Type = cell;
  for (let k = 0; k < Math.max(rank, 1); k++) t = { kind: 'list', elements: t };
  return t;
}

/**
 * The type of a shaped list whose cells are `cell` and whose dimensions are
 * `dims` (`null` for a tensor of unknown rank): the dimensioned form when
 * the cells may carry dimensions (they cannot be lists: numbers, booleans,
 * strings, tuples), the nested plain form otherwise. A comparison over a
 * tensor of unknown rank is therefore a `tensor<boolean>`. For an unknown
 * rank with cells that may be lists there is no exact spelling (the depth
 * of the nesting is not known). An element of such a value is a cell (rank
 * 1) or a list (rank 2 or more), so the answer is `list<cell | list<any>>`.
 * The rank-1 reading, the plain `list<cell>`, does not hold a value of rank
 * 2 or more.
 */
export function shapedOrPlainListType(
  cell: Type,
  dims: ReadonlyArray<number> | null
): Type {
  if (mayCarryDimensions(cell))
    return {
      kind: 'list',
      elements: cell,
      dimensions: dims === null ? null : [...dims],
    };
  if (dims === null)
    return {
      kind: 'list',
      elements: reduceType({
        kind: 'union',
        types: [cell, { kind: 'list', elements: 'any' }],
      }),
    };
  return nestedPlainListType(cell, dims.length);
}

/**
 * `t` with every dimension list whose cells cannot carry one
 * (`mayCarryDimensions`) rewritten as nested plain lists
 * (`shapedOrPlainListType`). The walk enters unions and the elements of
 * lists; it stops at any other node.
 */
export function withoutUnspellableDimensions(t: Type): Type {
  if (typeof t === 'string') return t;
  if (t.kind === 'union') {
    const arms = t.types.map(withoutUnspellableDimensions);
    return arms.every((x, i) => x === t.types[i])
      ? t
      : { kind: 'union', types: arms };
  }
  if (t.kind !== 'list') return t;
  const elements = withoutUnspellableDimensions(t.elements);
  if (t.dimensions === undefined)
    return elements === t.elements ? t : { kind: 'list', elements };
  if (mayCarryDimensions(elements))
    return elements === t.elements ? t : { ...t, elements };
  return shapedOrPlainListType(elements, t.dimensions);
}

/**
 * The shape-aware result type of a broadcast (`broadcastShapedResultType`,
 * `common/type/utils.ts`) under the rule that the cells of a list with
 * dimensions cannot be lists (`mayCarryDimensions`): a broadcast over a
 * matrix keeps the matrix shape when its cells come out numbers
 * (`Sin(M)` is a `matrix<2x2>`), booleans (`M < 3` is a
 * `matrix<boolean^(2x2)>`) or tuples, and is spelled as nested plain lists
 * when its cells may be lists.
 */
export function shapedBroadcastResultType(
  operandTypes: ReadonlyArray<Readonly<Type>>,
  elementType: Readonly<Type>,
  absentCell?: Readonly<Type>
): Type {
  const shaped = broadcastShapedResultType(
    operandTypes,
    elementType,
    absentCell
  );
  return withoutUnspellableDimensions(shaped);
}

/**
 * True when `expr`'s TYPE is an **unbounded (dimensionless) 1-D** list or
 * indexed-collection — the exact shape the `Add`/`Multiply` value path folds
 * into a plain `List` (`broadcastOverIndexedCollections`, and the step-2/4b
 * broadcast in `_computeValue`) and materializes at evaluation. This is the
 * *type-level* companion to `isFiniteIndexedCollection` (a value-level check):
 * it catches operands that are not yet a materialized collection but whose
 * declared type guarantees they will broadcast once evaluated — a
 * symbolic-length `Range` (`indexed_collection<…>`, whose `isFiniteCollection`
 * is `undefined`) or an un-evaluated broadcast result (`R^2`, typed
 * `list<number>`).
 *
 * Fixed-shape tensors (`matrix` = `list` with `dimensions`, `vector<n>` = `[n]`)
 * are EXCLUDED: they carry dedicated component-wise typing via
 * `addTensors`/`mulTensors` and their operators' own handlers. Numeric tuples
 * (points/vectors typed `tuple<…>`) are likewise not matched — they are
 * handled component-wise by `isNumericTuple`.
 */
export function isBroadcastCollectionType(expr: Expression): boolean {
  return broadcastCollectionElementType(expr) !== undefined;
}

/**
 * The element type of a broadcast collection operand (see
 * `isBroadcastCollectionType`), or `undefined` when `expr`'s type is not an
 * unbounded 1-D list / indexed-collection. Descends into a union (an operand
 * typed `scalar | list<E>`) and returns the first collection branch's element.
 */
export function broadcastCollectionElementType(
  expr: Expression
): Type | undefined {
  return dimensionlessIndexedElement(expr.type.type);
}

/**
 * Whether a union has a branch that is a GENUINE scalar under broadcast: not
 * collection-shaped, not a tuple, not a string — a number, a boolean, a
 * symbol type. (A tuple and a string are atomic under broadcast and count on
 * the scalar side of `scalarOrCollectionUnionBranches`, but they are not
 * what a fixed-shape list branch broadcasts AGAINST — see
 * `dimensionlessIndexedElement`.) A non-union answers `false`.
 */
export function unionHasGenuineScalarBranch(t: Readonly<Type>): boolean {
  const u = resolveTypeAlias(t);
  if (typeof u === 'string' || u.kind !== 'union') return false;
  return u.types.some((branch) => {
    const b = resolveTypeAlias(branch);
    if (b === 'unknown' || b === 'any' || b === 'value' || b === 'never')
      return false;
    if (b === 'string' || isTupleShapedType(b)) return false;
    if (typeof b !== 'string' && b.kind === 'broadcastable') return false;
    return !isSubtype(b, COLLECTION_SHAPE_TYPE);
  });
}

/**
 * The element type of a broadcast-collection type: an unbounded 1-D `list`
 * or `indexed_collection`, a `range`, or a UNION holding such a branch.
 *
 * `inUnion` marks a call on one BRANCH of a union that has a GENUINE scalar
 * branch (`unionHasGenuineScalarBranch`). A fixed shape (`vector<n>`,
 * `matrix`) on its own is not a broadcast trigger — the tensor handlers type
 * it component-wise — but INSIDE such a union (`integer | vector<integer^2>`,
 * the type of a `Which` returning a 2-element list or `-1`) no tensor
 * handler ever sees it: the union is not a tensor type, so arithmetic over
 * it fell through to the scalar tiers and typed `2·u` and `sin(u)` as
 * `number` for a value that may be a vector. A dimensioned list branch of
 * such a union therefore counts, and contributes its element type; the
 * branch keeps its dimensions when it is re-wrapped
 * (`rewrapCollectionBranch`). A union with NO genuine scalar branch
 * (`tuple<number, number> | vector<number^2>`, `vector<2> | vector<3>`) is
 * left as it was: its fixed-shape branches do not broadcast against a
 * scalar, and typing them through the scalar lift would describe a tuple
 * value by a scalar cell.
 */
export function dimensionlessIndexedElement(
  t: Type,
  seen?: AliasDescent,
  inUnion = false
): Type | undefined {
  // A transparent alias of a list IS that list (see
  // `typeCouldBeNumericCollection`), so the trigger reads the body it
  // names. A nominal reference stays opaque and is not a broadcast trigger.
  // The unfold runs under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias (`type alias cyc = cyc | 0`) stops at its first
  // repeat, and that arm is not a broadcast trigger.
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return undefined;
  t = unfolded.type;
  seen = unfolded.seen;
  if (t === 'list' || t === 'indexed_collection') return 'any';
  // An index span is dimensionless and its elements are finite positive
  // integers — a known element type, unlike the bare types above.
  if (t === 'range') return 'integer';
  if (typeof t === 'string') return undefined;
  if (t.kind === 'indexed_collection') return t.elements;
  // A `list` broadcasts only when it is unbounded/dimensionless (a plain
  // `list<E>`). A fixed shape (`vector<n>`, `matrix`) carries `dimensions` and
  // is left to tensor typing — except as a branch of a union beside a
  // genuine scalar, see above. A tensor of unknown rank (`tensor<U>`, whose
  // `dimensions` is `null`) has no fixed shape for the tensor handlers to
  // read, so it broadcasts here too, over its cells `U`: `Sin(T)` maps
  // every cell of `T` whatever its rank.
  if (t.kind === 'list')
    return !t.dimensions || inUnion ? t.elements : undefined;
  if (t.kind === 'union') {
    const scalarSibling = unionHasGenuineScalarBranch(t);
    for (const b of t.types) {
      const e = dimensionlessIndexedElement(b, seen, scalarSibling);
      if (e !== undefined) return e;
    }
  }
  return undefined;
}

/**
 * The type a broadcast operand contributes when an element-wise `Add`/
 * `Multiply` widens its collection operands together. For every type but one
 * this is `t` itself; the exception is a UNION of a scalar branch and a
 * dimensionless collection branch (a symbol or call result typed
 * `number | list<number>`), which collapses to a single collection type whose
 * element widens each branch's per-CELL contribution — a collection branch
 * contributes its elements, a scalar branch contributes itself. So
 * `number | list<number>` contributes `list<number>` and
 * `integer | list<real>` contributes `list<real>`.
 *
 * The branches describe what the operand may be at RUNTIME, and every one of
 * them lands in the same cells: paired with a collection operand, the scalar
 * branch folds into every cell and the collection branch zips element-wise. So
 * the sum of `[1, 2]` with a `number | list<number>` operand has `number`
 * cells whichever branch holds. Widening the raw union into the result instead
 * pushes the collection branch INTO the cells (`list<number | list<number>>`,
 * a type no evaluated value has), and a scalar-plus-collection union also
 * makes `type.matches('collection')` answer a confident `false` on a value
 * that is always a collection.
 *
 * Only a DIMENSIONLESS list/indexed-collection branch collapses, and the
 * result keeps that branch's own kind: a fixed shape (`vector<n>`, `matrix`)
 * is typed component-wise by the tensor handlers, and an operand that may be a
 * non-list `indexed_collection` at runtime must not be claimed a `list`.
 */
export function broadcastSiblingType(t: Readonly<Type>): Type {
  // A transparent alias is unfolded so the sibling contributes the
  // collection type it names: the broadcast result is typed by the structure
  // it builds, never by an operand's alias name (the alias policy of the
  // broadcast lift, `test/compute-engine/alias-broadcast-lift.test.ts`).
  t = resolveTypeAlias(t);
  if (typeof t === 'string' || t.kind !== 'union') return t as Type;
  const scalarSibling = unionHasGenuineScalarBranch(t);
  const branches = t.types.filter(
    (b) =>
      dimensionlessIndexedElement(b, undefined, scalarSibling) !== undefined
  );
  if (branches.length === 0) return t as Type;
  const elements = broadcastElementType(t);
  if (branches.length === 1)
    return rewrapCollectionBranch(branches[0], elements);
  // Several collection branches: `indexed_collection` is the common spelling
  // that admits them all.
  return { kind: 'indexed_collection', elements };
}

/**
 * Re-wrap a dimensionless collection branch around a new element type,
 * preserving the branch's own collection KIND: a `list` branch stays a `list`,
 * an `indexed_collection` branch stays an `indexed_collection`. A branch whose
 * element type is baked into its NAME (`range`, whose members are integers by
 * definition) cannot carry a rewritten element, so it — like the bare
 * `indexed_collection` — becomes an `indexed_collection<elements>`.
 *
 * `elements` replaces the `elements` field of the branch: for a branch with
 * no dimensions it is the type of one element of the result, for a branch
 * with dimensions the type of one cell. A caller with the result for one
 * leaf of a plain list whose elements are lists (`list<list<integer>>`)
 * shapes it with `shapedBroadcastResultType` instead (see
 * `loneUnionBroadcastResultType`).
 */
function rewrapCollectionBranch(branch: Type, elements: Type): Type {
  // An alias branch is re-wrapped as the collection kind it names.
  branch = resolveTypeAlias(branch);
  if (branch === 'list') return { kind: 'list', elements };
  // A tensor of unknown rank (`tensor<U>`, whose `dimensions` is `null`)
  // keeps its unknown rank when the new cells cannot be lists, and is a
  // list of any depth otherwise (`shapedOrPlainListType`): a tensor whose
  // cells are lists has no spelling.
  if (
    typeof branch !== 'string' &&
    branch.kind === 'list' &&
    branch.dimensions === null
  )
    return shapedOrPlainListType(elements, null);
  if (
    typeof branch !== 'string' &&
    (branch.kind === 'list' || branch.kind === 'indexed_collection')
  )
    return { ...branch, elements };
  return { kind: 'indexed_collection', elements };
}

/**
 * The dimensionless list / indexed-collection branches of a type that is a
 * union of at least one branch a broadcast treats as a SCALAR and at least one
 * such collection branch — the type of a symbol declared `number | list<number>`
 * and left valueless. `undefined` for every other type, including a union whose
 * non-collection branches are themselves collection-shaped (a fixed-shape
 * `vector<n>`, typed component-wise by the tensor handlers).
 *
 * This is the BROADCAST-side classification, so "scalar" here means "not lifted
 * element-wise", not "not a collection": a `tuple` branch and a `string` branch
 * are ATOMIC under broadcast — `2u` scales a tuple component-wise as one value
 * and never lifts over a string — and count on the scalar side rather than
 * disqualifying the union. Both nonetheless ENUMERATE, so an enumeration gate
 * (a big op folding its body) must ask `unionMayHoldACollection` instead.
 *
 * A `broadcastable<T>` branch is both halves at once — the operand may be the
 * scalar `T` or a list of `T` — so it contributes a
 * `list<T>` collection branch AND the scalar side. Keeping only
 * the scalar reading would let `list<T> | broadcastable<T>` type as a definite
 * list although it may hold a bare `T`.
 *
 * A value of such a type is not known to be a collection and not known to be a
 * scalar, so a gate that must decide "IS this a collection" cannot read the
 * presence of a collection branch as a yes.
 */
export function scalarOrCollectionUnionBranches(
  t: Readonly<Type>
): Type[] | undefined {
  // An alias of such a union is classified like the union it names, so a
  // valueless `j: json` (`type alias json = list<json> | integer`) carries
  // its scalar arm through the lift instead of claiming a definite list.
  t = resolveTypeAlias(t);
  if (typeof t === 'string' || t.kind !== 'union') return undefined;
  const collections: Type[] = [];
  let hasScalarBranch = false;
  const scalarSibling = unionHasGenuineScalarBranch(t);
  for (const b of t.types) {
    if (dimensionlessIndexedElement(b, undefined, scalarSibling) !== undefined)
      collections.push(b);
    else if (typeof b !== 'string' && b.kind === 'broadcastable') {
      // The collection half of `broadcastable<T>` is a tensor of any rank
      // for a numeric `T` and a plain `list<T>` otherwise
      // (`broadcastCollectionArm`, `common/type/subtype.ts`).
      collections.push(broadcastCollectionArm(b.elements));
      hasScalarBranch = true;
    } else if (isTupleShapedType(b) || b === 'string') hasScalarBranch = true;
    else if (isSubtype(b, COLLECTION_SHAPE_TYPE)) return undefined;
    else hasScalarBranch = true;
  }
  if (collections.length === 0 || !hasScalarBranch) return undefined;
  return collections;
}

/**
 * True when `t` is a UNION with at least one branch that a big op would
 * ENUMERATE rather than fold as a single term: a collection-shaped branch
 * (including the fixed shapes and the non-indexed `set`, which never
 * broadcast but do sum), a `tuple` branch, a `string` branch (a string
 * enumerates as its characters), or a `broadcastable<T>` branch, whose
 * collection half is a list of `T`.
 *
 * Such a union answers a confident `false` to `matches('collection<any>')` —
 * the scalar branch defeats the match — so a gate that reads only that match
 * takes its scalar path for an operand that may well hold a collection, and
 * commits an answer the same expression contradicts once the symbol is
 * assigned: `Sum(u)` folded to `u` for a valueless
 * `u: number | tuple<number, number>`, while `u := (1, 2)` makes the identical
 * expression `3`.
 *
 * This is deliberately WIDER than `scalarOrCollectionUnionBranches`, which
 * answers the BROADCAST-side question — where a tuple and a string are atomic
 * and a fixed shape is left to the tensor handlers.
 */
export function unionMayHoldACollection(t: Readonly<Type>): boolean {
  const resolved = resolveTypeAlias(t);
  if (typeof resolved === 'string' || resolved.kind !== 'union') return false;
  return resolved.types.some((branch) => {
    const b = resolveTypeAlias(branch);
    return (
      isTupleShapedType(b) ||
      b === 'string' ||
      (typeof b !== 'string' && b.kind === 'broadcastable') ||
      isSubtype(b, COLLECTION_SHAPE_TYPE)
    );
  });
}

/**
 * The result type of a broadcastable operator whose ONLY broadcast triggers
 * are scalar-or-collection unions — `2u` with `u` declared
 * `number | list<number>` and left valueless.
 *
 * Such an operand is not a collection: it is a symbol that may hold either a
 * scalar or a list, so typing the application as the definite `list<E>` states
 * something the very same expression contradicts once the symbol is assigned
 * (`u := 5` makes `2u` evaluate to the scalar `10`). The honest answer carries
 * the union through: the per-element result `E` unioned with `E` wrapped back
 * in each operand's collection branches, so `2u` types
 * `number | list<number>`. The declared union is carried through
 * rather than recruited into the `broadcastable<T>` family, which is reserved
 * for operands whose collection-ness is not statically visible at all.
 *
 * Returns `undefined` — leaving the definite `list<E>` typing in place — as
 * soon as any broadcasting operand is a DEFINITE collection. Paired with a
 * definite collection sibling (`Add([1, 2], u)`) every branch of the union
 * lands in that sibling's cells: the scalar branch folds into each cell and
 * the collection branch zips element-wise, so the result is a collection
 * whichever branch holds.
 */
export function loneUnionBroadcastResultType(
  operandTypes: ReadonlyArray<Type>,
  element: Type
): Type | undefined {
  const wrapped: Type[] = [];
  for (const t of operandTypes) {
    const branches = scalarOrCollectionUnionBranches(t);
    if (branches === undefined) return undefined;
    for (const b of branches) {
      // When no value of `element` is a list, `element` is the result for
      // one CELL (a leaf) of the branch. A list branch whose elements are
      // lists (`list<list<integer>>`, a matrix, a ragged
      // `list<vector<integer^1> | vector<integer^2>>`) holds its cells below
      // the first level, so the result is shaped from the structure of the
      // branch: `Sin u` with `u: integer | list<list<integer>>` is
      // `number | list<list<number>>`. One list level around the cell result
      // would not hold the nested value. An `element` that can be a list
      // (`integer | list<integer>`, the answer of a handler that types the
      // collection itself, as `Add` does) already describes one element of
      // the branch, and takes one list level. A branch of another kind
      // (`indexed_collection`, `range`) keeps its kind, with `element` as
      // its element.
      const r = resolveTypeAlias(b);
      wrapped.push(
        typeof r !== 'string' && r.kind === 'list' && cannotHoldAList(element)
          ? shapedBroadcastResultType([r], element)
          : rewrapCollectionBranch(b, element)
      );
    }
  }
  if (wrapped.length === 0) return undefined;
  return reduceType({ kind: 'union', types: [element, ...wrapped] });
}

/**
 * The type of one CELL of a broadcast over a scalar-or-list union operand: the
 * union of its scalar branches and the element types of its list branches.
 * With `u: real | signed_infinity | list<real>`, `2u` is either `2·u` for a
 * scalar `u` or `[2·u₁, 2·u₂, …]` for a list, so every value the operator
 * sees in one cell is `real | signed_infinity`. A type handler given that
 * cell type answers a narrow per-element result (`real | signed_infinity`),
 * where it answers `number` for the whole union, which is not a number type
 * (`loneUnionBroadcastResultType` then wraps the cell result).
 *
 * Only a union whose branches are extended numbers (`number`, `infinity`,
 * `nan`) or dimensionless lists of them qualifies. `undefined` otherwise,
 * in particular for a point-or-point-list union, which the arithmetic
 * handlers type branch by branch (see `broadcastLiftType`).
 */
export function scalarOrListUnionCellType(t: Readonly<Type>): Type | undefined {
  if (scalarOrCollectionUnionBranches(t) === undefined) return undefined;
  const resolved = resolveTypeAlias(t);
  if (typeof resolved === 'string' || resolved.kind !== 'union')
    return undefined;
  const isExtendedNumber = (x: Type): boolean =>
    x !== 'never' &&
    (isSubtype(x, 'number') || isSubtype(x, 'infinity') || isSubtype(x, 'nan'));
  const cells: Type[] = [];
  for (const branch of resolved.types) {
    const b = resolveTypeAlias(branch);
    const element = dimensionlessIndexedElement(b, undefined, true);
    const cell = element ?? b;
    if (!isExtendedNumber(cell)) return undefined;
    cells.push(cell);
  }
  return reduceType({ kind: 'union', types: cells });
}

/** One arm of a scalar-or-collection union operand, for an arm-by-arm
 * typing (`armwiseUnionBroadcastResultType`): the type the operator sees in
 * one cell when the value holds this arm, and how the per-cell result is
 * shaped back when the arm is a collection (`undefined` for a scalar arm). */
type UnionArm = {
  cell: Type;
  rewrap: ((element: Type) => Type) | undefined;
  /** Set on the arms split from ONE collection branch's element union: the
   * elements of one list each pick their arm on their own (`[1, (1, 2)]`
   * is one `list<number | tuple<…>>`), so the answers of these arms are
   * joined BEFORE the branch is wrapped back, where the arms of a union
   * OPERAND (one value, one arm) are wrapped apart. Shared by identity. */
  group?: object;
};

/** The arms of a collection branch `b` whose element type is `element`: one
 * arm per arm of the element (a `missing` arm, an absent cell of the list,
 * is not an arm; it is put back by the wrap), all in one group, all wrapped
 * back as the branch. `undefined` when an arm of the element is itself a
 * collection beside another arm (`list<tuple<…> | list<integer> | integer>`):
 * the broadcast maps into that cell, so the handler's answer for the cell is
 * not the result cell, and the caller types the list by its shape
 * (`broadcastShapedResultType`, which mirrors each arm of a ragged cell). */
function collectionBranchArms(b: Type, element: Type): UnionArm[] | undefined {
  // Only a `missing` ARM of the element is an absent cell. A `missing` arm
  // inside a tuple component (`tuple<number | missing, number>`, a point
  // with an absent coordinate) is a present point, and stays in its cell.
  const e = resolveTypeAlias(element);
  const members =
    typeof e !== 'string' && e.kind === 'union'
      ? e.types.map((m) => resolveTypeAlias(m))
      : [e];
  const cells = members.filter((m) => m !== 'missing');
  if (
    cells.length > 1 &&
    cells.some(
      (m) =>
        !isTupleShapedType(m) &&
        !isSubtype(m, 'string') &&
        isSubtype(m, COLLECTION_SHAPE_TYPE)
    )
  )
    return undefined;
  const group = {};
  // An element that is `missing` and nothing else (`list<missing>`, a list
  // of absent cells) is one arm as it stands, so the branch survives: with
  // no present cell there is nothing to split, and the handler answers for
  // the absent cell as it did before the split.
  if (cells.length === 0)
    return [{ cell: e, rewrap: (r) => rewrapCollectionBranch(b, r), group }];
  const absent = cells.length < members.length;
  const rewrap = (r: Type): Type =>
    rewrapCollectionBranch(
      b,
      absent ? reduceType({ kind: 'union', types: [r, 'missing'] }) : r
    );
  return cells.map((cell) => ({ cell, rewrap, group }));
}

/**
 * A union of broadcast-SCALAR arms, one of them a tuple, with no collection
 * arm: the type of a symbol declared `number | tuple<number, number>` (a
 * number or a 2-D point) and left valueless, or the element of a
 * `broadcastable<number | tuple>` operand. Such an operand is typed arm by
 * arm (`armwiseUnionBroadcastResultType`): a component-wise head applied to
 * its tuple arm answers a tuple, which the handler's one answer for the whole
 * union lost (`u^2` typed `number` for a `u` that may hold `(1, 2)`, whose
 * square is `(1, 4)`). A union with a collection arm is classified by
 * `scalarOrCollectionUnionBranches` instead; a union with a `broadcastable`
 * arm is neither.
 */
export function isScalarUnionWithTupleArm(t: Readonly<Type>): boolean {
  const resolved = resolveTypeAlias(t);
  if (typeof resolved === 'string' || resolved.kind !== 'union') return false;
  let tupleArm = false;
  for (const branch of resolved.types) {
    const b = resolveTypeAlias(branch);
    if (isTupleShapedType(b)) tupleArm = true;
    else if (typeof b !== 'string' && b.kind === 'broadcastable') return false;
    else if (isSubtype(b, COLLECTION_SHAPE_TYPE)) return false;
  }
  return tupleArm;
}

/** The arms of a union operand, or of a one-arm operand, for
 * `armwiseUnionBroadcastResultType`; `undefined` when the type is not armed.
 * A scalar-or-collection union is classified as
 * `scalarOrCollectionUnionBranches` classifies it, and a `broadcastable<T>`
 * arm of it is two arms, the scalar `T` and a list of `T`. A
 * union of scalar arms with a tuple arm (`isScalarUnionWithTupleArm`) is one
 * arm per branch. A type that is not a union is one arm: a tuple (the
 * element of `broadcastable<tuple<number, number>>`) or a scalar (`number`,
 * the element of a `broadcastable<number>` operand beside a union trigger).
 * A collection type is not an arm: a collection operand is typed by the
 * visible-collection lift, never arm by arm. */
function unionArms(t: Readonly<Type>): UnionArm[] | undefined {
  const resolved = resolveTypeAlias(t);
  if (typeof resolved === 'string' || resolved.kind !== 'union') {
    // A dimensionless list or indexed collection (`list<number | tuple<…>>`;
    // a `broadcastable<E>` operand that holds a list now, read as `list<E>`)
    // is one arm per arm of its element, each shaped back as the list.
    const element = dimensionlessIndexedElement(resolved);
    if (element !== undefined) return collectionBranchArms(resolved, element);
    if (
      !isTupleShapedType(resolved) &&
      isSubtype(resolved, COLLECTION_SHAPE_TYPE)
    )
      return undefined;
    return [{ cell: resolved, rewrap: undefined }];
  }
  if (
    scalarOrCollectionUnionBranches(resolved) === undefined &&
    !isScalarUnionWithTupleArm(resolved)
  )
    return undefined;
  const scalarSibling = unionHasGenuineScalarBranch(resolved);
  const arms: UnionArm[] = [];
  for (const branch of resolved.types) {
    const b = resolveTypeAlias(branch);
    const element = dimensionlessIndexedElement(b, undefined, scalarSibling);
    if (element !== undefined) {
      const branchArms = collectionBranchArms(b, element);
      if (branchArms === undefined) return undefined;
      arms.push(...branchArms);
    } else if (typeof b !== 'string' && b.kind === 'broadcastable') {
      arms.push({ cell: b.elements, rewrap: undefined });
      arms.push({
        cell: b.elements,
        // The collection half of `broadcastable<T>`: a tensor of any rank
        // for a result that cannot be a list (a number, a boolean, a
        // tuple), a plain list otherwise (`broadcastCollectionArm`,
        // `common/type/subtype.ts`).
        rewrap: (e) => broadcastCollectionArm(e),
      });
    } else arms.push({ cell: b, rewrap: undefined });
  }
  return arms;
}

/** Whether `armwiseUnionBroadcastResultType` can type an operand of type
 * `t` arm by arm: see `unionArms`. */
export function isArmedOperandType(t: Readonly<Type>): boolean {
  return unionArms(t) !== undefined;
}

/** The component-wise shape of one arm combination's answer `r` when some
 * of the `cells` (the trigger cells of the combination; `undefined` for an
 * operand that is not a trigger) is a tuple: see
 * `armwiseUnionBroadcastResultType`. `r` itself when no cell is a tuple, or
 * when the handler already answered a tuple or a collection. */
function tupleOfCells(cells: ReadonlyArray<Type | undefined>, r: Type): Type {
  let arity: number | undefined = undefined;
  let bare = false;
  for (const c of cells) {
    if (c === undefined) continue;
    const t = resolveTypeAlias(c);
    if (t === 'tuple') bare = true;
    else if (typeof t !== 'string' && t.kind === 'tuple') {
      if (arity !== undefined && arity !== t.elements.length) return 'error';
      arity = t.elements.length;
    }
  }
  if (arity === undefined && !bare) return r;
  const answered = resolveTypeAlias(r);
  if (
    typeof answered !== 'string' &&
    (answered.kind === 'tuple' ||
      (answered.kind === 'union' &&
        answered.types.some((m) => isTupleShapedType(m))))
  )
    return r;
  if (isSubtype(answered, COLLECTION_SHAPE_TYPE)) return r;
  if (bare || arity === undefined) return 'tuple';
  return {
    kind: 'tuple',
    elements: Array.from({ length: arity }, () => ({ type: r })),
  };
}

/** The most arm combinations `armwiseUnionBroadcastResultType` types: each
 * combination is one call of the type handler. Beyond it the caller keeps
 * its one-cell typing. Two operands of the Desmos parameter shape (a
 * number, a list of numbers, a 2-D point or a 3-D point: four arms each)
 * are sixteen combinations. */
const MAX_UNION_ARM_COMBINATIONS = 64;

/**
 * The result type of a broadcastable operator whose ONLY broadcast triggers
 * are scalar-or-collection unions, typed ARM BY ARM: the type handler is
 * called once per combination of arms, with each trigger typed as the cell
 * of its arm (the arm itself for a scalar arm, the element type for a list
 * arm), and the answer is wrapped back in the list arm's collection kind
 * when a list arm was taken. The result is the union of these answers.
 *
 * `loneUnionBroadcastResultType` types such an operand set from ONE cell,
 * the union of every arm's cell, and wraps that one answer in each list
 * arm. That is exact when every arm's cell is a number
 * (`scalarOrListUnionCellType`): the handler's answer is then one number
 * type. It is not when a scalar arm is a tuple: the arithmetic handlers
 * type a tuple-bearing cell arm by arm and answer a union, so the wrap put a
 * list around an answer that was already the lifted union, and a symbol
 * declared `tuple<number, number> | list<number>` typed `2V` as
 * `list<list<number> | tuple<…>> | list<number> | tuple<…>`; each further
 * operator added a list level (`b - c` over two symbols declared
 * `number | list<number> | tuple<number, number> | tuple<number, number,
 * number>`, the shape of a Desmos parameter that may hold a number, a point
 * or a list of either, nested three deep). Typed arm by arm, `2V` is
 * `list<number> | tuple<number, number>` and `b - c` keeps one list level.
 *
 * `operandTypes[i]` is the type of trigger `i`, or `undefined` for an
 * operand that is not a trigger (a number literal, a declared scalar): that
 * operand is described to the handler as for the main call. `cellResult`
 * calls the handler with the cells (`abstractCellResult` of
 * `broadcastLiftType`). `undefined` when some trigger is not a
 * scalar-or-collection union, when the combinations exceed
 * `MAX_UNION_ARM_COMBINATIONS`, or when the handler declines a combination:
 * the caller then keeps its one-cell typing. A combination the handler
 * answers `error` or `never` for (a point beside a number under `Add`,
 * which boxing rejects) contributes no arm: the value never holds it. When
 * every combination is such an answer, the application is `error`.
 *
 * A tuple arm is a cell of its own. Under an operator that broadcasts over
 * tuples component-wise (`options.componentwise`: `broadcastsOverTuples`,
 * `boxed-function.ts`; `Sin`, `Power`, `Sqrt`), the handler answers for one
 * component, and the combination's type is a tuple of that arity holding
 * the answer (`sin b` over the tuple arm `tuple<number, number>` is
 * `tuple<number, number>`), as arm 0 of `broadcastLiftType` shapes a tuple
 * operand; a handler that already answers a tuple or a collection for the
 * tuple cells is not reshaped. Tuple cells of two different arities have no
 * component-wise result (the value is an `incompatible-dimensions` error)
 * and contribute no arm; a bare `tuple` cell names no arity, and the
 * combination is the bare `tuple`. Under an operator whose own handler
 * types a tuple operand (`Add`, `Multiply`, `Divide`: the `'tuples'`
 * broadcast exemption), the handler's answer stands as it is.
 */
export function armwiseUnionBroadcastResultType(
  operandTypes: ReadonlyArray<Type | undefined>,
  cellResult: (cells: ReadonlyArray<Type | undefined>) => Type | undefined,
  options: { componentwise: boolean }
): Type | undefined {
  const armsPerOperand: (UnionArm[] | undefined)[] = [];
  let combinations = 1;
  for (const t of operandTypes) {
    if (t === undefined) {
      armsPerOperand.push(undefined);
      continue;
    }
    const arms = unionArms(t);
    if (arms === undefined) return undefined;
    combinations *= arms.length;
    if (combinations > MAX_UNION_ARM_COMBINATIONS) return undefined;
    armsPerOperand.push(arms);
  }
  if (armsPerOperand.every((a) => a === undefined)) return undefined;
  const results: Type[] = [];
  // The answers of the combinations that differ only in GROUPED arms (the
  // arms of one collection branch's element), keyed by the other arms
  // chosen: the elements of one list pick their arms on their own, so these
  // answers are one element type, joined before the wrap.
  const grouped = new Map<
    string,
    { rewrap: (e: Type) => Type; types: Type[] }
  >();
  let rejected = 0;
  const cells: (Type | undefined)[] = operandTypes.map(() => undefined);
  const chosen: string[] = [];
  const visit = (i: number, rewrap: UnionArm['rewrap']): boolean => {
    if (i === operandTypes.length) {
      const r0 = cellResult(cells);
      if (r0 === undefined) return false;
      const r =
        r0 === 'never' || r0 === 'error' || !options.componentwise
          ? r0
          : tupleOfCells(cells, r0);
      if (r === 'never' || r === 'error') {
        rejected += 1;
        return true;
      }
      if (rewrap === undefined) results.push(r);
      else {
        const key = chosen.join('|');
        const entry = grouped.get(key);
        if (entry === undefined) grouped.set(key, { rewrap, types: [r] });
        else entry.types.push(r);
      }
      return true;
    }
    const arms = armsPerOperand[i];
    if (arms === undefined) return visit(i + 1, rewrap);
    for (let j = 0; j < arms.length; j += 1) {
      const arm = arms[j];
      cells[i] = arm.cell;
      // A grouped arm is keyed by its group (one key for all the arms of
      // that element, and a different key for each collection branch of the
      // operand, so two list branches are not merged under the first one's
      // wrap); any other arm by its index.
      chosen[i] =
        arm.group === undefined
          ? `${i}:${j}`
          : `${i}:g${arms.findIndex((a) => a.group === arm.group)}`;
      // The first list arm taken gives the result its collection kind: two
      // list arms zip into one collection.
      if (!visit(i + 1, rewrap ?? arm.rewrap)) return false;
    }
    cells[i] = undefined;
    chosen[i] = '';
    return true;
  };
  if (!visit(0, undefined)) return undefined;
  for (const { rewrap, types } of grouped.values())
    results.push(rewrap(reduceType({ kind: 'union', types })));
  if (results.length === 0) return rejected > 0 ? 'error' : undefined;
  return reduceType({ kind: 'union', types: results });
}

/** The options of {@link isPossiblyCollectionTyped}. */
export type PossiblyCollectionTypedOptions = {
  /** `false` reads a symbol declared `any` or `value` as a scalar, and a
   * library element-wise application over scalars with it (the compiled
   * lanes; see the function's comment). */
  declaredSymbols?: boolean;
  /** The memo of one call's walk through library applications, keyed by
   * expression (a DAG is walked once per node). Set by the function. */
  seen?: Map<Expression, boolean>;
};

/**
 * True when `expr`'s collection-ness is **not statically visible**, so an
 * element-wise numeric operator (`Add`/`Multiply`) over it must produce a
 * `broadcastable<T>` result — the operand might broadcast at runtime (a
 * list-returning call) or stay scalar. The three triggering shapes are:
 *
 * - an **application** (function expression) with a top type
 *   (`unknown`/`any`/`value`) — a call whose collection-ness is entirely
 *   unknown (e.g. an undeclared function call `h(x)`);
 * - an already-`broadcastable<…>` type — propagation through nested arithmetic
 *   (`Add(Multiply(2, h(x)), -1)`), including a symbol *declared*
 *   `broadcastable<…>`; or
 * - a **union with a `broadcastable<…>` branch** (`number |
 *   broadcastable<number>`) — the operand may hold the collection half of
 *   the lift at runtime, so the scalar reading is not safe. A union whose
 *   collection branch is statically visible (`number | list<number>`) is
 *   NOT this predicate's case: the dedicated union lift
 *   (`scalarOrCollectionUnionBranches`) already types it per branch, more
 *   precisely than a `broadcastable` wrapper could.
 *
 * A bare **symbol** with a top type is admitted only when the user DECLARED
 * it `any` or `value` (user decision 2026-10-17, Tycho ledger row 379): such
 * a symbol is never refined by inference, and its value may be a list, a
 * point or a matrix (`2·(1, 2, 3)` evaluates to `(2, 4, 6)`), so an
 * element-wise operator over it answers the symbol's own type (the lift
 * reduces `broadcastable<any>` to `any`). An undeclared symbol is EXCLUDED:
 * it types `unknown` only until the surrounding arithmetic's
 * `checkNumericArgs` infers it scalar-numeric, so treating it as
 * possibly-a-collection would be order-dependent (`2x` on a cold engine would
 * type `broadcastable<number>` while a warm one gives `number`) and would
 * mis-route the invisible-operator multiply-vs-Tuple gate (`6n`,
 * `(abc)(xyz)`). An application's top-typed result is never refined by
 * inference, so it genuinely may resolve to a collection at runtime. The
 * predicate also excludes an inferred-`number` symbol: `Add(2, x)` stays
 * `number` and `Multiply(2, x)` stays `number` (see the "non-interference
 * with scalars" pins in `list-broadcast-typing.test.ts`). Statically-visible
 * collection/tuple/tensor operands are handled by the dedicated branches that
 * fire before this predicate is consulted.
 *
 * `options.declaredSymbols: false` restores the scalar reading of a declared
 * `any`/`value` symbol, and reads a top-typed application of a LIBRARY
 * element-wise operator through its operands (`2a + 1` with `a: any` is
 * typed `any` because `a` is, and is read as a scalar here). The compiled
 * lanes pass it: compiled code reads such a symbol as a scalar (`Abs(z)`
 * with `z: any` compiles to `_SYS.absAny(z)`, not to a broadcast of it), and
 * a consumer that declares every parameter `any` would otherwise pay a
 * broadcast wrapper at every arithmetic site. A call of a user function
 * typed `any` keeps its reading: its body may build a list.
 *
 * A top-typed SELECTION (`If`, `Which`) is as collection-shaped as its arms:
 * its value is the value of one arm, and its type is `unknown` as soon as
 * one arm is an undeclared symbol (the `If` type handler does not drop an
 * `unknown` branch from the join). So `If(d < 0, a, 5)` with an undeclared
 * `a` is read through its arms, `a` and `5`, as the bare `a` would be, and
 * `If(d < 0, a, 5) + z` still compiles.
 */
export function isPossiblyCollectionTyped(
  expr: Expression,
  options?: PossiblyCollectionTypedOptions
): boolean {
  // Resolve a transparent alias BEFORE the top-type test, so an alias whose
  // body is a top type takes the application check like the bare spelling.
  const t = resolveTypeAlias(expr.type.type);
  if ((t === 'any' || t === 'value') && isSymbol(expr))
    return (
      options?.declaredSymbols !== false &&
      expr.valueDefinition !== undefined &&
      expr.valueDefinition.inferredType !== true
    );
  if (
    (t === 'any' || t === 'value') &&
    options?.declaredSymbols === false &&
    isLibraryBroadcastableApplication(expr)
  ) {
    // The walk is memoized per call: the operands form a DAG (a shared
    // subexpression is one node reached from several parents), and without
    // the memo a chain `t₀ = a, tₙ = Beta(tₙ₋₁, tₙ₋₁)` was walked once per
    // path, which is exponential in its depth.
    const seen = options.seen ?? new Map<Expression, boolean>();
    const memo = seen.get(expr);
    if (memo !== undefined) return memo;
    const withSeen =
      options.seen === undefined ? { ...options, seen } : options;
    const result = expr.ops.some(
      (op) =>
        op.type.matches(COLLECTION_SHAPE_TYPE) ||
        unionMayHoldACollection(op.type.type) ||
        isPossiblyCollectionTyped(op, withSeen)
    );
    seen.set(expr, result);
    return result;
  }
  if (t === 'unknown' || t === 'any' || t === 'value') {
    if (!isFunction(expr)) return false;
    const arms = selectionArms(expr);
    return (
      arms === undefined ||
      arms.some((arm) => selectionArmMayBeCollection(arm, options))
    );
  }
  if (typeof t === 'string') return false;
  if (t.kind === 'broadcastable') return true;
  // A `broadcastable<…>` branch inside a union hides its collection-ness the
  // same way a bare `broadcastable<…>` does: a valueless `b: number |
  // broadcastable<number>` may hold a list at runtime, so `2b` typed as a
  // plain scalar was a lie (the enumeration side was already honest —
  // `Sum(b)` stays inert through `unionMayHoldACollection`). Only the
  // `broadcastable` branches count here: a statically-visible collection
  // branch (`number | list<number>`) is typed per branch by the dedicated
  // union lift instead, which is the sharper answer.
  if (t.kind !== 'union') return false;
  return t.types.some((branch) => {
    const b = resolveTypeAlias(branch);
    return typeof b !== 'string' && b.kind === 'broadcastable';
  });
}

/** An application of a `broadcastable` operator bound in the engine's
 * system scope (a library operator such as `Add`, `Sin` or `Abs`, not a
 * user function or a replaced library operator): its value over scalar
 * operands is a scalar, whatever its static type says. */
function isLibraryBroadcastableApplication(
  expr: Expression
): expr is Expression & FunctionInterface {
  if (!isFunction(expr)) return false;
  const def = expr.operatorDefinition;
  if (def === undefined || !def.broadcastable) return false;
  const engine = expr.engine;
  if (engine._customLibraryOperators.has(expr.operator)) return false;
  const binding = engine.contextStack[0]?.lexicalScope.bindings.get(
    expr.operator
  );
  return (
    binding !== undefined && 'operator' in binding && binding.operator === def
  );
}

/** True when an arm of a top-typed selection may be a collection: an arm
 * that IS one (a list literal, a symbol declared `list<number>`), an arm
 * whose type is a union with a collection member (`number | list<number>`),
 * or an arm that is possibly a collection by the rule of
 * `isPossiblyCollectionTyped` (a top-typed application, a symbol declared
 * `any` or `value`, a `broadcastable` type). An undeclared top-typed symbol
 * is excluded, as that rule excludes it. */
function selectionArmMayBeCollection(
  arm: Expression,
  options?: PossiblyCollectionTypedOptions
): boolean {
  if (arm.isCollection || arm.type.matches(COLLECTION_SHAPE_TYPE)) return true;
  if (unionMayHoldACollection(arm.type.type)) return true;
  return isPossiblyCollectionTyped(arm, options);
}

/** The arms of a selection, or `undefined` when `expr` is not one: the two
 * branches of an `If` (`If(c, a, b)`), and the values of a `Which`
 * (`Which(c1, v1, c2, v2, …)`), which are its operands at the odd positions. */
function selectionArms(
  expr: Expression & FunctionInterface
): ReadonlyArray<Expression> | undefined {
  if (expr.operator === 'If') return expr.ops.slice(1, 3);
  if (expr.operator === 'Which') return expr.ops.filter((_, i) => i % 2 === 1);
  return undefined;
}

/**
 * True when `expr` is **definitely collection-shaped but carries no value
 * yet**: a symbol declared `list<number>`/`vector<2>` that has not been
 * assigned, or an application whose head returns a collection (`L(1)` under
 * `L: (number) -> vector<2>`).
 *
 * `isCollection` answers a CAPABILITY question — "can I enumerate this NOW" —
 * and is `false` for such an operand because there is nothing to walk. A site
 * that uses `isCollection` to ask the different question "is this operand
 * collection-SHAPED" therefore takes its scalar path for an operand that is
 * not a scalar, and commits an answer that the same expression contradicts
 * once the symbol is assigned. Reducing `Sum(L)` to `L`, promoting `L` to the
 * singleton `Set(L)` inside a `Union`, and excluding nothing for a `SetMinus`
 * whose exclusion operand is `L` are all that mistake.
 *
 * The test is `type.matches('collection')` — the type DEFINITELY is a
 * collection — not `typesOverlap(…, 'collection')`, which would also catch a
 * top-typed (`unknown`/`any`) operand. Widening that far reclassifies every
 * undeclared symbol and is a different, much larger change; the narrow test is
 * the one the comparison operators (`undecidedCollectionComparison`,
 * `library/relational-operator.ts`) and the compiled paths
 * (`compilation/interval-javascript-target.ts`) already use, so this keeps one
 * convention across the interpreter and the emitters.
 *
 * A caller that also wants the possibly-collection operands should spell it
 * `isValuelessCollectionTyped(x) || isPossiblyCollectionTyped(x)`.
 */
export function isValuelessCollectionTyped(expr: Expression): boolean {
  return !expr.isCollection && expr.type.matches('collection<any>');
}

/**
 * True when `expr` is provably a **scalar** number — a subtype of `number`
 * that is not a numeric tuple — established by one of three shapes:
 *
 * - a number **literal**; or
 * - a **symbol** with an explicitly DECLARED (non-inferred) number type; or
 * - a **function call** whose operator has a declared (non-inferred) numeric
 *   result.
 *
 * The `isSubtype(…, 'number')` gate already excludes list-broadcast results:
 * a broadcastable operator over a finite indexed collection (e.g.
 * `Multiply([0,0,1], x)`) is now honestly typed `list<…>` / `vector<n>` (see
 * `docs/COLLECTIONS-MODEL.md`), so it is not a
 * subtype of `number` and never reaches the function-call clause.
 *
 * Everything else stays symbolic (the guards defer to evaluation). Inferred
 * types are deliberately treated as *not* proof: a symbol or user function
 * whose numeric type was merely *inferred* from earlier use might still turn
 * out to be a tuple (Desmos forward references make this common).
 */
export function isDeclaredScalarNumber(expr: Expression): boolean {
  if (isNumericTuple(expr)) return false;
  if (!isSubtype(expr.type.type, 'number')) return false;

  // A number literal is unconditionally a provable scalar.
  if (isNumber(expr)) return true;

  // A symbol counts only when its number type was explicitly declared, not
  // merely inferred from earlier use.
  if (isSymbol(expr)) return !expr.valueDefinition?.inferredType;

  // A function call counts only when its operator has a declared (non-inferred)
  // numeric result. A genuinely scalar-typed call (e.g. `Length([1,2])`)
  // qualifies even with a collection operand; a list-broadcast call is already
  // excluded by the `isSubtype(…, 'number')` gate above (its type is `list<…>`).
  if (isFunction(expr)) {
    const opDef = expr.operatorDefinition;
    if (opDef) return !opDef.inferredSignature;

    // A head declared with a function TYPE rather than a signature —
    // `ce.declare('H', '(number) -> number')` — carries a VALUE definition, so
    // there is no operator definition to consult. The declaration is proof
    // just the same; a function type merely INFERRED from earlier use
    // (`inferredType`) is not, matching the `inferredSignature` rule above.
    // Read the definition this call was BOUND to, not a fresh lookup of the
    // name: `_bind()` resolves the head through `lookupApplicable`, which can
    // walk past an inner non-applicable shadow, and the call may carry its own
    // local scope. Re-resolving in the engine's current scope could read
    // `inferredType` off a different binding entirely.
    const valueDef = expr.valueDefinition;
    return valueDef !== undefined && !valueDef.inferredType;
  }

  return false;
}

/**
 * Is `expr` PROVABLY a scalar number — proof enough to REJECT a sum of it
 * with a tuple at canonicalization, where the error is baked into the
 * expression for good?
 *
 * `isDeclaredScalarNumber` is the typing-grade reading: a call whose operator
 * declares a numeric result counts, whatever its operands, which is what the
 * `Multiply` type handler wants when it combines a scalar factor's tier into
 * a tuple's component types (an inferred tier there is harmless — if the
 * inference is later retracted the product is invalid anyway). Rejection
 * needs more. A BROADCASTABLE operator maps over a tuple operand
 * component-wise (`Negate((1, 2))` is `(-1, -2)`, `2·(1, 2)` is `(2, 4)`),
 * so its declared `number` result describes only the scalar reading, and the
 * call is proven scalar exactly when every operand is. `Negate(q)` with `q`
 * an untyped function-literal parameter is not: rejecting `-q + (1, 2)` at
 * boxing committed `q` to a number on evidence the enclosing sum contradicts,
 * while `q + (1, 2)` stayed symbolic and bound (Tycho item 241).
 */
export function isProvablyScalarNumber(expr: Expression): boolean {
  if (!isDeclaredScalarNumber(expr)) return false;
  if (isFunction(expr) && expr.operatorDefinition?.broadcastable)
    return expr.ops.every((op) => isProvablyScalarNumber(op));
  return true;
}

/**
 * Is `expr` PROVABLY a non-empty list of scalar numbers — proof enough to
 * REJECT a sum of it with a point at canonicalization?
 *
 * A sum of a point and a list broadcasts the point over the elements, so
 * `(0, 1) + [10, 20, 30]` is `[(0,1) + 10, (0,1) + 20, (0,1) + 30]`, and
 * each element is the `tuple + number` mistake `canonicalAdd` rejects. Desmos
 * rejects the whole sum ("Cannot add a point and a list of numbers"), also
 * when the list or the point is restricted.
 *
 * Recognized: a `List` literal whose every element is a provable scalar
 * (`isProvablyScalarNumber`), the same list restricted by a condition
 * (`When([10, 20, 30], c)`: an absent element is `Missing`, and a present one
 * is a number), and a symbol whose DECLARED (not inferred) type, without its
 * absence arm, is a list of numbers. Anything else — an unknown-typed operand,
 * a list of points, a list whose element type was only inferred — is not
 * proof.
 */
export function isProvablyNumberList(expr: Expression): boolean {
  if (isFunction(expr, 'List'))
    return expr.nops > 0 && expr.ops.every((op) => isProvablyScalarNumber(op));
  if (isFunction(expr, 'When') && expr.nops === 2)
    return isProvablyNumberList(expr.op1);
  // The negation of a list of numbers is a list of numbers. A difference is
  // canonicalized to a sum with the negated subtrahend, so without this
  // `(1, 2) - [1, 2]` was not rejected while `(1, 2) + [1, 2]` was.
  if (isFunction(expr, 'Negate')) return isProvablyNumberList(expr.op1);
  if (isSymbol(expr)) {
    const def = expr.valueDefinition;
    if (def === undefined || def.inferredType) return false;
    const t = stripMissingFromType(resolveTypeAlias(expr.type.type));
    if (typeof t === 'string' || t.kind !== 'list') return false;
    const el = resolveTypeAlias(t.elements);
    return el !== 'never' && isSubtype(el, 'number');
  }
  return false;
}

/**
 * Is `expr` PROVABLY a number or a list of numbers, without saying which —
 * proof enough to REJECT a sum of it with a point at canonicalization?
 *
 * Recognized: a symbol whose DECLARED (not inferred) type, without its
 * absence arm, is a union whose every arm is a number or a list of numbers,
 * with at least one list arm (`u: number | list<number>`), and the negation
 * of such an operand. A point plus a number is an `incompatible-type` error,
 * and so is a point plus a list of numbers (`isProvablyNumberList`), so the
 * sum is an error whichever arm the value holds. The definite cases are
 * `isProvablyScalarNumber` and `isProvablyNumberList`.
 */
export function isProvablyNumberOrNumberList(expr: Expression): boolean {
  if (isFunction(expr, 'Negate')) return isProvablyNumberOrNumberList(expr.op1);
  if (!isSymbol(expr)) return false;
  const def = expr.valueDefinition;
  if (def === undefined || def.inferredType) return false;
  const t = resolveTypeAlias(
    stripMissingFromType(resolveTypeAlias(expr.type.type))
  );
  if (typeof t === 'string' || t.kind !== 'union') return false;
  let list = false;
  for (const arm0 of t.types) {
    const arm = resolveTypeAlias(arm0);
    if (arm === 'never') return false;
    if (typeof arm !== 'string' && arm.kind === 'list') {
      const el = resolveTypeAlias(arm.elements);
      if (el === 'never' || !isSubtype(el, 'number')) return false;
      list = true;
      continue;
    }
    if (!isSubtype(arm, 'number')) return false;
  }
  return list;
}

/**
 * Is `x` an operand that makes an application ELEMENT-WISE, read from its
 * TYPE rather than its value — so the answer is known before the operand is
 * evaluated, and a `list<boolean>`-typed call, a symbol bound to a list, and a
 * literal list all answer the same way (as does a declared but still
 * valueless `list<T>` symbol). A tuple is atomic (a point, a pair), never
 * mapped over — the same exclusion the driver's broadcast makes with
 * `isTuple`. An `unknown`/`any`-typed operand (an undeclared function call)
 * is NOT collection-shaped: `unknown` does not match `collection`.
 *
 * Used by the short-circuit operators (`And`/`Or`/`Nand`/`Nor`/`Implies` in
 * `library/logic.ts`, the relational chains in
 * `library/relational-operator.ts`) to decide, before evaluating anything,
 * whether the application is element-wise — in which case every operand is
 * evaluated once and the result is a list — or scalar, in which case
 * evaluation stops at the first deciding operand.
 */
export function isCollectionShaped(x: Expression): boolean {
  return x.type.matches('collection<any>') && !isTupleShapedType(x.type.type);
}

/**
 * Is this type a TUPLE, structurally — the bare `tuple` primitive or any
 * composite tuple, regardless of its slot types?
 *
 * This checks tuple kind directly, including transparent aliases. Bare
 * `tuple` admits every arity and slot type; `tuple<any>` is a one-slot tuple.
 */
export function isTupleShapedType(t: Type): boolean {
  // A transparent alias of a tuple IS a tuple (see
  // `typeCouldBeNumericCollection`); a nominal reference stays opaque.
  return factsOf(t).tupleShaped;
}

/**
 * Is this type a TUPLE, structurally, or a union whose every arm is one
 * (`tuple<integer> | tuple<integer, missing>`)? Every value of such a type
 * is a tuple, whatever its slot types.
 *
 * This is the shape twin of `matches('tuple')` for a gate that treats a
 * tuple as one atomic value (a spread operand, a `Join` operand, a listed
 * element): `matches('tuple')` admits a union of value-slotted tuples but
 * rejects an absence-slotted tuple, and {@link isTupleShapedType} admits an
 * absence-slotted tuple but does not see the arms of a union.
 */
export function isTupleOrTupleUnionShapedType(
  t: Type,
  seen?: AliasDescent
): boolean {
  return everyArmIsShaped(t, isTupleShapedType, seen);
}

/**
 * Is this type a RECORD, structurally, or a union whose every arm is one
 * (`record{a: integer} | record{b: integer}`), possibly through a
 * transparent alias? Every value of such a type is a record, whatever its
 * field types. {@link isRecordShapedType} does not see the arms of a union,
 * and `isSubtype(t, 'record')` rejects a record with an absence-typed
 * field: a gate that excludes records needs both.
 */
export function isRecordOrRecordUnionShapedType(
  t: Type,
  seen?: AliasDescent
): boolean {
  return everyArmIsShaped(t, isRecordShapedType, seen);
}

/**
 * True when `shaped` holds for `t` or, when `t` is a union (directly or
 * through a transparent alias), for every arm of it. An intersection has the
 * shape when one of its members that is not a negation has it: every value of
 * `tuple<integer, integer> & !tuple<0, 0>` is a tuple. A negation member
 * establishes nothing (`!list<integer>` is not a list).
 *
 * The alias unfolds under the descent guard (`unfoldAliasOnDescent`), so a
 * self-referential alias (`type alias cyc = cyc | tuple<number, number>`)
 * stops when it reaches itself again. An arm cut there contributes no
 * members of its own: the values of `cyc` are the values of its other arms.
 * So the cut arm answers `true`, the neutral answer for "every arm", and the
 * union is decided by its other arms. Without the guard each recursive call
 * unfolds the alias again and the walk overflows the stack.
 */
function everyArmIsShaped(
  t: Type,
  shaped: (t: Type) => boolean,
  seen: AliasDescent
): boolean {
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return true;
  const r = unfolded.type;
  if (typeof r === 'object' && r.kind === 'union')
    return (
      r.types.length > 0 &&
      r.types.every((arm) => everyArmIsShaped(arm, shaped, unfolded.seen))
    );
  // A cut member of an intersection is skipped: the neutral answer of "some
  // member" is `false`.
  if (
    typeof r === 'object' &&
    r.kind === 'intersection' &&
    r.types.some(
      (member) =>
        (typeof member !== 'object' || member.kind !== 'negation') &&
        !isCutOnDescent(member, unfolded.seen) &&
        everyArmIsShaped(member, shaped, unfolded.seen)
    )
  )
    return true;
  return shaped(r);
}

/**
 * Could a value of type `t` be a TUPLE? True for a tuple type (whatever its
 * slot types, so `tuple<integer, missing>` too), for a union with an arm
 * that could be one, and for a type whose values include tuples: a top type
 * (`unknown`, `any`, `value`, `expression`), the bare or composite
 * `collection` and `indexed_collection`, and `broadcastable<T>`. A
 * reference to a type that is not declared yet is opaque, so it could be a
 * tuple as well. False for a type that excludes every tuple: a scalar,
 * `missing`, a list, a set, a string, a dictionary, a record, a function, and
 * a NOMINAL type. A value of a nominal type is tagged with its type name,
 * even when the declaration is a tuple (`type point = tuple<x: number, y:
 * number>`), so it is never equal to the structural tuple with the same
 * components: `point(1, 2) = (1, 2)` is `False` (pinned in
 * `test/compute-engine/type-constructors.test.ts`).
 *
 * `couldMatch(t, 'tuple')` is not this test: the bare `tuple` admits values
 * only, so it rejects `tuple<integer, missing>`, and it rejects
 * `indexed_collection<integer>` although a tuple of integers is one.
 *
 * The alias unfolds under the descent guard (`unfoldAliasOnDescent`): a
 * self-referential alias stops when it reaches itself again, and that arm
 * contributes no members (`false`), so the union is decided by its other
 * arms.
 */
export function typeCouldBeTuple(t: Type, seen?: AliasDescent): boolean {
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  const r = unfolded.type;
  if (typeof r === 'string') return couldMatch(r, 'tuple');
  switch (r.kind) {
    case 'union':
      return r.types.some((arm) => typeCouldBeTuple(arm, unfolded.seen));
    case 'intersection':
      // A value of an intersection is a value of every member that is not a
      // negation, so each of them must be able to hold a tuple.
      return r.types.every(
        (member) =>
          (typeof member === 'object' && member.kind === 'negation') ||
          typeCouldBeTuple(member, unfolded.seen)
      );
    case 'variable':
    case 'negation':
      // A type variable can be bound to a tuple type, and a negation holds
      // every value outside a type: both could be a tuple.
      return true;
    case 'reference':
      return r.def === undefined;
    case 'tuple':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return true;
    default:
      return couldMatch(r, 'tuple');
  }
}

/**
 * Could a value of type `t` be a LIST, that is an indexed collection that
 * is not a tuple and not a string? True for a list type (a vector, a matrix,
 * a `range`), for a union with an arm that could be one, and for a type
 * whose values include lists: a top type (`unknown`, `any`, `value`,
 * `expression`), the bare or composite `collection` and
 * `indexed_collection`, and `broadcastable<T>`. A reference to a type that
 * is not declared yet is opaque, so it could be a list as well. False for a
 * type that excludes every list: a scalar, `missing`, a tuple (whatever its
 * slot types), a set, a string, a dictionary, a record, a function, and a
 * NOMINAL type, whose values are tagged with the type name (see
 * {@link typeCouldBeTuple}).
 *
 * A string is excluded because a string is never equal to a collection of
 * another kind (`eq()`, `boxed-expression/compare.ts`).
 *
 * The alias unfolds under the descent guard (`unfoldAliasOnDescent`): a
 * self-referential alias stops when it reaches itself again, and that arm
 * contributes no members (`false`), so the union is decided by its other
 * arms.
 */
export function typeCouldBeList(t: Type, seen?: AliasDescent): boolean {
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  const r = unfolded.type;
  if (typeof r === 'string') return couldMatch(r, 'list');
  switch (r.kind) {
    case 'union':
      return r.types.some((arm) => typeCouldBeList(arm, unfolded.seen));
    case 'intersection':
      // A value of an intersection is a value of every member that is not a
      // negation, so each of them must be able to hold a list.
      return r.types.every(
        (member) =>
          (typeof member === 'object' && member.kind === 'negation') ||
          typeCouldBeList(member, unfolded.seen)
      );
    case 'variable':
    case 'negation':
      // A type variable can be bound to a list type, and a negation holds
      // every value outside a type: both could be a list.
      return true;
    case 'reference':
      return r.def === undefined;
    case 'list':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return true;
    default:
      return couldMatch(r, 'list');
  }
}

/**
 * How a component of type `t` of a point takes part in the norm of the
 * point:
 *
 * - `'list'`: the component is an indexed collection that is not a tuple
 *   (a list), so the point is one point per element and its norm is one
 *   number per element: `‖(x + [1, 2], y)‖` is two norms.
 * - `'gated-list'`: the component is a list or the absent value. This is
 *   the type `list<real> | missing` of a restricted list `L {c}`. When the
 *   list is present, the norm is one number per element, as for `'list'`.
 *   When it is absent, the component is an absent coordinate and the norm
 *   is `NaN`.
 * - `undefined`: the component is not a list. It is a number, a nested
 *   point (a tuple is an indexed collection in the type lattice, but a
 *   point is one coordinate of the norm), or a value with no list arm.
 *
 * The `missing` arm is removed before the shape test. Without this, the
 * union `list<real> | missing` is not a subtype of the collection top, and
 * a restricted list read as a scalar coordinate: the compiled norm put the
 * whole list into one vector and answered one number where the interpreter
 * answers one number per element.
 */
export function broadcastingComponentKind(
  t: Type
): 'list' | 'gated-list' | undefined {
  const present = stripMissingFromType(t);
  if (present === 'never' || isTupleShapedType(present)) return undefined;
  if (!isSubtype(present, INDEXED_COLLECTION_SHAPE_TYPE)) return undefined;
  return isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE) ? 'list' : 'gated-list';
}

/**
 * Is this type a RECORD, structurally — the bare `record` primitive or any
 * composite record, regardless of its field types? Same rationale as
 * {@link isTupleShapedType}: `record<any>` is not a spellable type, so a
 * record shape gate cannot be widened the way the `dictionary<any>` gates
 * were, and `matches('record')` wrongly excludes a record with an
 * absence-typed field.
 */
export function isRecordShapedType(t: Type): boolean {
  t = resolveTypeAlias(t);
  return t === 'record' || (typeof t === 'object' && t.kind === 'record');
}

/**
 * Whether the type `t`, or any arm of it when it is a union, is a TUPLE (a
 * point) or a STRING. A value of such a type can be one atomic value under a
 * restriction by a list of conditions, which never aligns its components
 * with the conditions. A tuple and a string are indexed collections in the
 * type lattice, so a union such as `tuple<number, number> |
 * list<tuple<number, number>>` (a point or a point list) is a subtype of
 * `indexed_collection<any>` although the value it holds can be a point:
 * reading that union as an ordered collection would split the point into
 * its coordinates. `isTupleShapedType` alone does not see the arms of a
 * union, so a gate that must exclude such values tests this predicate.
 *
 * Used by the `When` operator (`isOrderedCarrierType`,
 * `library/control-structures.ts`) and by the JavaScript compilation of a
 * restriction (`base-compiler.ts`), which declines such a union.
 */
export function hasTupleOrStringArm(t: Type, seen?: AliasDescent): boolean {
  // The alias unfolds under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias (`type alias cyc = cyc | list<integer>`) stops
  // when it reaches itself again, and that arm contributes no members
  // (`false`), so the union is decided by its other arms.
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  const r = unfolded.type;
  if (typeof r !== 'string' && r.kind === 'union')
    return r.types.some((arm) => hasTupleOrStringArm(arm, unfolded.seen));
  return isTupleShapedType(r) || (r !== 'never' && isSubtype(r, 'string'));
}

/**
 * True when a type statically carries a SHAPE an arithmetic result must
 * preserve: a tuple, a list/collection kind, or a broadcast lift of one.
 * `broadcastable<number>` is NOT shaped — its runtime value may be a plain
 * scalar, which is precisely why the lift exists. A transparent alias is
 * unfolded first: it IS its definition, so an alias of a list is shaped. A
 * nominal reference stays opaque and is not shaped.
 *
 * Used by the `Divide` type handler on both sides — a shaped (or
 * broadcast-lifted shaped) NUMERATOR keeps its structure with widened
 * components, while a shaped or possibly-shaped DENOMINATOR disqualifies that
 * claim — and by {@link typeMayCarryQuotientShape}, the gate of the
 * degenerate-divisor rules in `arithmetic-mul-div.ts`.
 */
export function isShapedNumericType(t: Type, seen?: AliasDescent): boolean {
  // The unfold runs under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias (`type alias cyc = cyc | 0`) stops at its first
  // repeat, and that arm carries no shape.
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  t = unfolded.type;
  seen = unfolded.seen;
  if (typeof t === 'string')
    return (
      t === 'tuple' ||
      t === 'list' ||
      t === 'collection' ||
      t === 'indexed_collection' ||
      t === 'set'
    );
  if (t.kind === 'union')
    return t.types.some((a) => isShapedNumericType(a, seen));
  if (t.kind === 'broadcastable') return isShapedNumericType(t.elements, seen);
  return (
    t.kind === 'tuple' ||
    t.kind === 'list' ||
    t.kind === 'collection' ||
    t.kind === 'indexed_collection' ||
    t.kind === 'set'
  );
}

/**
 * `t` with a transparent alias of a SHAPE unfolded, and every other type
 * unchanged.
 *
 * This is the alias policy of the broadcast lift and of the handlers that
 * scale or negate a collection cell by cell: a result built from an aliased
 * shaped operand is typed by the structure it builds (`Negate(L)` for
 * `L: nums`, an alias of `list<number>`, is `list<number>`), never by the
 * operand's alias name — the evaluated value carries the structure and no
 * name either. A SCALAR alias is a different case and keeps its name: `-m`
 * for `m: meters` (an alias of `number`) is the same kind of value as `m`,
 * and the scalar arithmetic handlers echo it (`m + 1` is `meters`). The
 * split lets a handler that echoes its operand's type (`Negate`) apply the
 * lift policy to shaped operands only. A nominal reference is never
 * unfolded ({@link resolveTypeAlias}).
 *
 * Pinned in `test/compute-engine/alias-broadcast-lift.test.ts`.
 */
export function resolveShapedTypeAlias(t: Type): Type {
  const resolved = resolveTypeAlias(t);
  return resolved !== t && isShapedNumericType(resolved) ? resolved : t;
}

/**
 * True when a numerator of this type must be EXEMPT from the scalar
 * degenerate-divisor rules (`a/0 = ~oo`, `a/∞ = 0`) in `canonicalDivide` and
 * `div()` (`arithmetic-mul-div.ts`): the type either IS a shape
 * ({@link isShapedNumericType}) or MAY present an indexed collection at
 * runtime without promising one — the collection half of
 * `broadcastable<number>`, or the `list<number>` branch of
 * `number | list<number>`.
 *
 * In either case the quotient stays an inert `Divide` instead of collapsing
 * to one scalar at canonicalization. Once a value is present, evaluation
 * settles it: a collection value broadcasts the division over its elements
 * (`[1,2]/0` answers `[~oo, ~oo]`, like `[1,2]·(1/0)`), while a scalar value
 * reaches `div()` again and takes the scalar degenerate answer there.
 * Collapsing earlier would destroy the collection alternative before the
 * value is seen.
 */
export function typeMayCarryQuotientShape(t: Type): boolean {
  const resolved = resolveTypeAlias(t);
  return isShapedNumericType(resolved) || mayHoldAnIndexedCollection(resolved);
}

/**
 * True when `x` is a SCALAR absent term of a sum or product: an absence symbol
 * (`Missing`, `Undefined`), or a negation, product, quotient or power of one
 * (`-Missing`, `2·Missing`) whose type cannot be a collection. Beside a point,
 * such a term makes the whole point absent (`Missing`). A term that may be a
 * collection (`Missing·L`, with `L` a list) is not a scalar absence: it
 * broadcasts, and the absence lands in each cell.
 */
export function isAbsentScalarTerm(x: Expression): boolean {
  if (isAbsentSymbol(x)) return true;
  return (
    isAbsentArithmeticOperand(x) && !typeMayCarryQuotientShape(x.type.type)
  );
}

/**
 * True when `expr` is a `tuple` — a point/vector in ℝⁿ *or* a Desmos-style
 * point-list (a tuple with a finite-collection component, e.g. `(-6, n)` with
 * `n` a list). Broader than `isNumericTuple`, which requires every element to
 * be a subtype of `number`: `isTuple` also matches a tuple whose components
 * include lists/collections. Used by the `Add`/`Multiply` dispatch and the
 * broadcast steps so a tuple is treated as an **atomic** value (scaled/added
 * component-wise, never broadcast as a list); the transpose to a `List` of
 * point-tuples happens at evaluation (the `Tuple` evaluate handler), not here.
 *
 * Matches on the static type first, then — mirroring the value-level
 * `isFiniteIndexedCollection` — follows a symbol's runtime value binding. A
 * lambda parameter inferred scalar (`number`) from its body (`2x`) but applied
 * to a point has type `number` yet a tuple *value*; without the value check the
 * body's arithmetic would broadcast the point into a list.
 */
export function isTuple(expr: Expression): boolean {
  // A number literal is never a tuple (see `isNumericTuple` on why the type
  // is not read for one), and neither is an arithmetic application over
  // operands that cannot be tuples (`SCALAR_LIFT_HEADS`): an application
  // has no value binding of its own, so the symbol arm below does not apply
  // to it, and its type arm is what the pre-check decides.
  if (isNumber(expr)) return false;
  if (
    isScalarLiftApplication(expr) &&
    operandTypeCannotBeTuple(expr, SCALAR_LIFT_DESCENT)
  )
    return false;
  // The bare `tuple` primitive counts: a symbol declared `w: tuple` has no
  // component types to read, but every value it can hold IS a tuple, so a
  // product `2w` must be scaled component-wise and typed as a tuple, never
  // as a scalar. `isTupleShapedType` is the same test on a type alone.
  if (isTupleShapedType(expr.type.type)) return true;
  if (isSymbol(expr)) {
    const v = expr.value;
    if (v !== undefined && !isSymbol(v)) return isTupleShapedType(v.type.type);
  }
  return false;
}

/**
 * `isTuple`, read through an absence arm and across a union of tuple
 * spellings: true when every value the operand can take, other than the
 * absent one, is a tuple. A restricted point `When((0, 1), c)` and a
 * `Which` with point branches and no default are typed
 * `missing | tuple<…>`: when present they are points, and when absent they
 * are `Missing`. So a product of two of them, or a division by one, is the
 * same mistake it is for a bare point, and the `Multiply` and `Divide`
 * canonical forms reject it with the same error. This matches Desmos, which
 * rejects `P Q`, `t/P` and `P/Q` for a restricted `P = (0,1)\{0<t\}` whatever
 * the value of the condition.
 *
 * `isTuple` itself keeps its exact reading for the callers that scale or add
 * tuples component-wise, which need a value that is a tuple, not one that may
 * be absent.
 */
export function isTupleCarrier(expr: Expression): boolean {
  if (isTuple(expr)) return true;
  // The early exits of `isTuple`, for the reasons given there.
  if (isNumber(expr)) return false;
  if (
    isScalarLiftApplication(expr) &&
    operandTypeCannotBeTuple(expr, SCALAR_LIFT_DESCENT)
  )
    return false;
  if (tupleCarrierType(expr.type.type)) return true;
  if (isSymbol(expr)) {
    const v = expr.value;
    if (v !== undefined && !isSymbol(v)) return tupleCarrierType(v.type.type);
  }
  return false;
}

/**
 * The component count of an operand typed `missing | tuple<…>` (a restricted
 * point), read from the tuple arm, or `undefined` when the type without its
 * absence arm is not a single parameterized tuple.
 */
export function tupleCarrierArity(expr: Expression): number | undefined {
  const s = resolveTypeAlias(
    stripMissingFromType(resolveTypeAlias(expr.type.type))
  );
  if (typeof s === 'string' || s.kind !== 'tuple') return undefined;
  return s.elements.length;
}

/** Is every non-absent arm of `t` a tuple? A type that is `missing` alone
 *  has no non-absent arm and does not qualify. */
function tupleCarrierType(t: Type): boolean {
  // The alias is unfolded BEFORE the absence arm is stripped, as in
  // `isNumericTupleCarrier`: `stripMissingFromType` leaves a reference node
  // as it is.
  const s = resolveTypeAlias(stripMissingFromType(resolveTypeAlias(t)));
  if (s === 'never') return false;
  if (typeof s === 'object' && s.kind === 'union')
    return s.types.length > 0 && s.types.every((arm) => isTupleShapedType(arm));
  return isTupleShapedType(s);
}

/**
 * Is `expr` PROVABLY a list of points — proof enough to REJECT, at
 * canonicalization, the arithmetic shapes that have no meaning for a list of
 * points?
 *
 * Arithmetic with a list of points applies to each point, so a product of a
 * list of points and a point (`[(1,2),(3,4)]·(1,1)`) is a list of
 * point-by-point products, and a division by a list of points
 * (`2/[(1,2),(3,4)]`) is a list of divisions by a point. Each element is then
 * the same mistake as for a single point. Desmos rejects the whole
 * expression ("Cannot multiply a list of points by a point", "Cannot divide a
 * number by a list of points", "Cannot add a list of points and a number")
 * whatever the value of a condition on the list, so `Multiply`, `Divide` and
 * `Add` reject it with the error of the single-point case.
 *
 * Recognized from the TYPE, without its absence arm: a list whose every
 * element, other than an absent one, is a tuple. This includes a list
 * literal of points (`list<tuple<…>>`), a restricted list of points
 * (`When([(0,1),(4,5)], c)`, typed `missing | list<tuple<…>>`, or
 * `list<missing | tuple<…>>` when the condition is a list), and a symbol
 * declared or assigned such a list (through its value, as `isTupleCarrier`
 * does). A list literal whose elements are all `isTupleCarrier` also
 * qualifies, whatever its inferred type. A type that only MAY be a list of
 * points (`unknown`, `list<any>`, `list<number | tuple<…>>`) is not proof.
 *
 * A tuple whose components are lists (`(-6, n)` with `n` a list) is a
 * `tuple`, not a list, and does not qualify here.
 */
export function isPointListCarrier(expr: Expression): boolean {
  if (isNumber(expr)) return false;
  if (isFunction(expr, 'List'))
    if (expr.nops > 0 && expr.ops.every((op) => isTupleCarrier(op)))
      return true;
  if (pointListElementType(expr.type.type) !== undefined) return true;
  if (isSymbol(expr)) {
    const v = expr.value;
    if (v !== undefined && !isSymbol(v))
      return pointListElementType(v.type.type) !== undefined;
  }
  return false;
}

/**
 * The component count of the points of a list of points
 * (`isPointListCarrier`), or `undefined` when it is not statically known.
 */
export function pointListCarrierArity(expr: Expression): number | undefined {
  let el = pointListElementType(expr.type.type);
  if (el === undefined && isSymbol(expr)) {
    const v = expr.value;
    if (v !== undefined && !isSymbol(v)) el = pointListElementType(v.type.type);
  }
  if (el === undefined && isFunction(expr, 'List') && expr.nops > 0)
    el = expr.ops[0].type.type;
  if (el === undefined) return undefined;
  const s = resolveTypeAlias(stripMissingFromType(resolveTypeAlias(el)));
  if (typeof s === 'string' || s.kind !== 'tuple') return undefined;
  return s.elements.length;
}

/**
 * When `t`, without its absence arm, is a list whose every non-absent
 * element is a tuple, the element type. Otherwise `undefined`.
 *
 * A list whose every non-absent element is itself such a list (a list of
 * rows of points, `list<list<tuple<…>>>`, or rows of different types,
 * `list<list<tuple<…>^1> | list<tuple<…>^2>>`) counts too, and the result
 * is then the type of the points: arithmetic maps over the rows to each
 * point, so a sum of such a list and a number is a sum of a point and a
 * number for each point, as for a flat list of points. A dimensioned list
 * of points (`matrix<tuple<…>>`) already has tuple elements. `depth` bounds
 * the walk, which also stops a self-referential alias.
 */
function pointListElementType(t: Type, depth = 0): Type | undefined {
  const s = resolveTypeAlias(stripMissingFromType(resolveTypeAlias(t)));
  if (typeof s === 'string' || s.kind !== 'list') return undefined;
  if (tupleCarrierType(s.elements)) return s.elements;
  if (depth >= 8) return undefined;
  const rows = resolveTypeAlias(
    stripMissingFromType(resolveTypeAlias(s.elements))
  );
  if (typeof rows === 'string') return undefined;
  if (rows.kind === 'list') return pointListElementType(rows, depth + 1);
  if (rows.kind !== 'union' || rows.types.length === 0) return undefined;
  const points: Type[] = [];
  for (const arm of rows.types) {
    const p = pointListElementType(arm, depth + 1);
    if (p === undefined) return undefined;
    points.push(p);
  }
  // Rows of one point type (`list<tuple<…>^1> | list<tuple<…>^2>`) give that
  // point type once, so a reader of a single tuple (`pointListCarrierArity`)
  // finds its arity.
  return reduceType({ kind: 'union', types: points });
}

/**
 * The element type that a test for a list of points reads from the
 * collection type `t`: the `T` of a `broadcastable<T>`, and
 * `collectionElementType(t)` for any other type.
 *
 * `broadcastable<T>` is `T` or a tensor of `T` cells, so its element type
 * through `collectionElementType` is `T | tensor<T>`. For a point `T`
 * (`broadcastable<tuple<number, number>>`, a point or a list of points)
 * that union is not a point type, and every point-list test that read it
 * answered "not a list of points", where the operand is read as a point or
 * a list of points everywhere else. The broadcast reads the cells of the
 * operand, and the cells are `T`.
 */
export function pointCollectionElementType(
  t: Readonly<Type>
): Type | undefined {
  const r = resolveTypeAlias(t);
  if (typeof r !== 'string' && r.kind === 'broadcastable') return r.elements;
  return collectionElementType(t);
}

/**
 * True when `t` is `broadcastable<P>` and `P` is a point type (a tuple, or a
 * union of tuples). A value of that type is ONE point, or a tensor of points
 * of any rank (`broadcastable<P>` is `P | tensor<P>`). The type does not say
 * which, so a consumer that reads points (`PointX`, `Norm`, `Abs`, `Dot`)
 * must decide at the value: reading the operand as a list of points is wrong
 * for one point. {@link pointCollectionElementType} reads such a type by its
 * `P`, which is right for the element of a list of points only.
 */
export function isBroadcastablePointType(t: Readonly<Type>): boolean {
  const r = resolveTypeAlias(t);
  return (
    typeof r !== 'string' &&
    r.kind === 'broadcastable' &&
    isPointElementType(resolveTypeAlias(r.elements))
  );
}

/**
 * True when `t` is a collection of points at more than one level, or at a
 * number of levels the type does not fix: a tensor whose cells are points,
 * of unknown rank (`tensor<tuple<number, number>>`) or of rank 2 or more
 * (`matrix<tuple<number, number>^(2x2)>`), or a list whose elements are such
 * collections or lists of points (`list<list<tuple<number, number>>>`). A
 * list of points of rank 1 (`list<tuple<…>>`, `list<tuple<…>^3>`) answers
 * `false`.
 *
 * The point accessors map over the points of such a value at every level
 * (`pointComponentAt`, `library/collections.ts`), so a consumer compiled
 * for a list of points of rank 1 (a per-point map) is wrong for it, and a
 * consumer that reads it as a matrix is wrong too: its cells are points,
 * not numbers. An alias is unfolded under the descent guard.
 */
export function isNestedPointCollectionType(
  t: Readonly<Type>,
  seen?: AliasDescent
): boolean {
  return nestedPointCollection(t, true, seen);
}

function nestedPointCollection(
  t: Readonly<Type>,
  top: boolean,
  seen: AliasDescent
): boolean {
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  const r = unfolded.type;
  if (typeof r === 'string') return false;
  if (!top && r.kind === 'union')
    return r.types.every((arm) => nestedPointCollection(arm, false, unfolded.seen));
  if (r.kind !== 'list') return false;
  const dims = r.dimensions;
  if (dims !== undefined) {
    if (!isPointElementType(resolveTypeAlias(r.elements))) return false;
    return !top || dims === null || dims.length >= 2;
  }
  if (isPointElementType(resolveTypeAlias(r.elements))) return !top;
  return nestedPointCollection(
    r.elements,
    false,
    descendIntoConstructor(unfolded.seen)
  );
}

/**
 * True when `expr` is a LIST OF POINTS — a finite indexed collection whose
 * elements are tuples (`[(0,0),(3,4)]`).
 *
 * Used where a point binds ATOMICALLY inside a collection, so the operation
 * applies per POINT rather than per coordinate: `Norm`/`Abs` of a point list
 * is the list of point norms, on both the evaluate and the compile route
 * (Tycho item 138).
 *
 * DELIBERATELY NARROW: a list of numeric LISTS (`[[0,0],[3,4]]`) is a MATRIX
 * here, and the matrix semantics of `Norm` (Frobenius) and `Abs`
 * (element-wise) win over the point reading. The point-ONLY operators
 * (`Distance`, `PointX`/`PointY`/`PointZ`) admit that spelling too — they
 * have no competing matrix meaning — through their own predicates.
 */
export function isPointListValue(expr: Expression): boolean {
  // A nominal `type`/`type alias` for a point list is a point list.
  // A `broadcastable<T>` is read by its `T` (`pointCollectionElementType`).
  const elt = pointCollectionElementType(resolveType(expr.type.type));
  // The bare `tuple` (what a `list<tuple>` declaration reports), a
  // parameterized tuple, and a union of tuple spellings (what a list literal
  // of two differently typed points infers) all read as a point element —
  // the same test the point accessors use (`isPointElementType`), so `Abs`
  // over a point list and `PointX` over it agree on what a point list is.
  // A point cell that may be absent, `missing | tuple<…>`, is a point cell:
  // a restricted list of points is typed `missing | list<missing | tuple<…>>`
  // (the `When` type handler, `library/control-structures.ts`), and a symbol
  // declared `list<missing | tuple<…>>` with no value is a point list too.
  // Without this `Dot(R, (1, 1))` for such a symbol was an `incompatible-type`
  // error at evaluation, where a valueless point list stays symbolic.
  if (elt !== undefined && isPointElementType(stripMissingFromType(elt)))
    return true;
  // A literal collection is often mis-typed (a list of 2-tuples types as a
  // matrix), so fall back to the runtime evidence of its first element.
  if (expr.isFiniteCollection === true && expr.isIndexedCollection === true) {
    for (const first of expr.each()) return isTuple(first);
  }
  return false;
}

/** The element count of a tuple-typed expression when statically known. */
export function numericTupleArity(expr: Expression): number | undefined {
  const t = expr.type.type;
  if (typeof t === 'string' || t.kind !== 'tuple') return undefined;
  return t.elements.length;
}

/**
 * True when `expr` is a literal tuple expression whose components are directly
 * accessible as operands, so component-wise arithmetic can be computed now. A
 * tuple-typed *symbol* has no accessible components and must stay symbolic.
 */
export function hasAccessibleComponents(expr: Expression): boolean {
  return (
    isFunction(expr) &&
    TUPLE_OPERATORS.has(expr.operator) &&
    (expr.ops?.length ?? 0) > 0
  );
}

/**
 * Broadcast an element-wise `operator` (`Add`/`Multiply`/…) over the finite
 * indexed-collection operands in `xs` — e.g. the `List` a broadcast `Power`
 * produced (`L^2`), or a lazy `Range`. Every *other* operand — scalars AND
 * numeric tuples (which carry point/vector semantics, not collection
 * semantics) — is kept whole and repeated across the elements. So
 * `Multiply(Range(-2,2), Tuple(2,3))` broadcasts the range and yields a `List`
 * of 5 `Tuple`s, mirroring the eager-`List` (`mulTensors`) behavior.
 *
 * Returns the eager `List` of per-element results, or `undefined` when there is
 * no finite indexed collection to broadcast over, or a broadcastable operand's
 * length is not statically known (the caller then stays inert). This is the
 * post-evaluation counterpart to the pre-evaluation broadcast in
 * `BoxedFunction._computeValue` (step 2): the lazy `Add`/`Multiply` operators
 * only see their collection-shaped operands *after* evaluating them, so their
 * `evaluate` handlers dispatch through here to keep `evaluate` idempotent.
 */
export function broadcastOverIndexedCollections(
  ce: Expression['engine'],
  operator: string,
  xs: ReadonlyArray<Expression>,
  numericApproximation: boolean,
  allowLazy = false,
  strictLengths = true
): Expression | undefined {
  const isBroadcast = (x: Expression): boolean =>
    isFiniteBroadcastParticipant(x);

  const cols = xs.filter(isBroadcast);
  if (cols.length === 0) return undefined;

  // Length-mismatch ruling (2026-07-24), applied here as well as at the
  // `BoxedFunction` broadcast steps: `Add`/`Multiply` reach their element-wise
  // path through this function, so without it a mismatch that `addTensors`
  // does not catch (a `Filter` source, say — not a tensor value) would still
  // zip-to-shortest, and the SAME shape would error under `Less` but truncate
  // under `Add`.
  //
  // `strictLengths: false` is the deliberate exception, not a default:
  // strictness governs an operator LIFTED over collections, while an explicit
  // PAIRING constructor (`Zip`, the variadic `Map`, the `PointList`
  // construction) defines its length as the shortest input — see
  // `docs/BROADCAST-MODEL.md` (ruling 2026-07-27). `PointList` is the one
  // caller that opts out; its shortest-zip is a ratified consumer contract
  // (Tycho item 52, `PointList([1,2,3],[10,20])` → 2 points). The default is
  // strict so a future caller inherits the ruling instead of silently
  // truncating.
  if (strictLengths) {
    const mismatch = broadcastLengthMismatch(ce, xs);
    if (mismatch) return mismatch;
  }

  // Broadcast length = the participating collections' common length. Bail
  // (stay inert) if any length is not statically known.
  let n = Infinity;
  for (const c of cols) {
    const len = smallCount(c);
    if (len === undefined || len < 0) return undefined;
    if (len < n) n = len;
  }
  if (!Number.isFinite(n)) return undefined;

  // Hybrid laziness (OPT-IN via `allowLazy`): past the eager threshold, return
  // the lazy `Map` form instead of materializing the whole result. `Add(Range(
  // 1,1e8), 1)` becomes `Map(_1 ↦ Add(_1, 1), Range(1,1e8))` — consumable via
  // `at`/`Take`/`count` without building 1e8 elements. Below/at the threshold
  // the eager loop below runs unchanged, so small collections stay
  // byte-identical. Callers that require an eager `List` shape at any finite
  // size (e.g. `PointList`, whose `List<Tuple>` shape is a consumer contract)
  // leave `allowLazy` false and always get the eager materialization.
  if (allowLazy && n > MAX_SIZE_EAGER_COLLECTION) {
    // Lists of machine numbers are computed at once, on doubles, as in
    // `lazyBroadcastMapIfNeeded`.
    const eager = machineBroadcast(ce, operator, xs, numericApproximation);
    if (eager !== undefined) return eager;
    return lazyBroadcastMap(
      ce,
      operator,
      xs,
      isBroadcast,
      numericApproximation,
      strictLengths
    );
  }

  const options = { numericApproximation };
  // Stream the broadcast operands with hoisted `each()` iterators instead of
  // indexing `x.at(i)` per element: `at()` re-resolves the accessor chain on
  // every call — for a lazy `Map` source it re-instantiates the mapping
  // lambda per access — so an n-element zip paid O(n) lambda constructions
  // and O(n·ops) collection-type checks (Tycho item 52: a 4001-element
  // `PointList` transpose ground for ~300 ms per consumer).
  const broadcast = xs.map((x) => isBroadcast(x));
  const iters = xs.map((x, k) => (broadcast[k] ? x.each() : undefined));
  const results: Expression[] = [];
  for (let i = 1; i <= n; i++) {
    const args: Expression[] = [];
    for (let k = 0; k < xs.length; k++) {
      const it = iters[k];
      if (it === undefined) {
        args.push(xs[k]);
        continue;
      }
      const { value, done } = it.next();
      args.push(done || value === undefined ? ce.Nothing : value);
    }
    results.push(ce._fn(operator, args).evaluate(options));
  }
  return ce._fn('List', results);
}

/**
 * Build the lazy `Map` form of an element-wise broadcast of `operator` over the
 * broadcast operands of `ops` (those for which `isBroadcastOperand` is true).
 * Every broadcast operand becomes a source collection of the `Map` and a fresh,
 * non-capturing parameter in the mapping-function body; every other operand
 * (scalars, tuples) is spliced whole into the body. So:
 * - `Add(Range(1,N), 1)` → `Map(_1 ↦ Add(_1, 1), Range(1,N))`
 * - `Add(Range(1,N), Range(1,N))` → `Map((_1,_2) ↦ Add(_1,_2), Range(1,N), Range(1,N))`
 * - `Multiply(Range(1,N), Tuple(2,3))` → `Map(_1 ↦ Multiply(_1, Tuple(2,3)), Range(1,N))`
 *
 * The mapping function is a proper canonical `Function` literal (position-bound
 * by `Map`), so the shortest-input / `at` / `count` / lazy-iterator semantics of
 * the multi-collection `Map` carry through. Parameter names are chosen to avoid
 * every free symbol of a spliced operand, so a spliced scalar can never be
 * captured by a parameter.
 *
 * Length-mismatch ruling (`docs/BROADCAST-MODEL.md`): this is the lazify
 * funnel, and the `addN`/`mulN` value paths reach it DIRECTLY (the
 * `isUnknownLengthBroadcast` branch), with no earlier mismatch check — so
 * without the check here, `Add([1,2,3], Cycle(5,6))` zipped to the shortest
 * while `Less` on the same operands errored `3 vs Infinity`. An INFINITE
 * operand has a KNOWN count (`Infinity`) that agrees with no finite sibling;
 * only a count that is genuinely `undefined` is skipped (nothing to compare
 * until it resolves — the ROADMAP "broadcast semantics residue").
 * `strictLengths: false` is for pairing callers only (`PointList`, via
 * `broadcastOverIndexedCollections`), whose shortest-zip is their contract.
 *
 * `callee` is the one-rank ARREST hook for a DECLARED `broadcastable<T>`
 * parameter (`docs/plans/2026-08-08-broadcastable-param-semantics.md`, rule 2):
 * the body becomes `ApplyWhole(⟨literal⟩, …)` instead of `operator(…)`, and
 * `ApplyWhole` binds every argument WHOLE — so a nested-collection element is
 * passed to the function intact instead of re-entering the broadcast gate by
 * name and descending another rank. (`Apply` would not do: it maps a function
 * literal with scalar parameters over a collection argument.) Without it a lazified declared broadcast would
 * disagree with the eager one purely because of the source's SIZE.
 *
 * `paramTypes` is the same declaration's rule 3, per element: the mapping
 * function's parameter for operand `i` is DECLARED that type (`_1: number`),
 * so the ordinary application check rejects a violating element loudly —
 * eagerly at the `Map`'s own element evaluation, lazily at access. The check
 * must live on the PARAMETER, not inside the body: an `incompatible-type`
 * raised inside the spliced `Apply(…)` is swallowed by the surrounding
 * application (it degrades to `NaN`/`Missing`), while a parameter violation
 * surfaces as the element's value.
 */
export function lazyBroadcastMap(
  ce: Expression['engine'],
  operator: string,
  ops: ReadonlyArray<Expression>,
  isBroadcastOperand: (x: Expression, i: number) => boolean,
  numericApproximation = false,
  strictLengths = true,
  callee?: Expression,
  paramTypes?: (i: number) => Type | undefined
): Expression {
  if (strictLengths) {
    const mismatch = broadcastLengthMismatch(ce, ops);
    if (mismatch) return mismatch;
  }
  // Parameter names must not shadow a free symbol of a spliced (whole) operand
  // once the body is canonicalized in the function-literal scope.
  const avoid = new Set<string>();
  for (const [k, x] of ops.entries())
    if (!isBroadcastOperand(x, k)) for (const s of x.symbols) avoid.add(s);
  if (callee) for (const s of callee.symbols) avoid.add(s);

  const cols: Expression[] = [];
  const params: Expression[] = [];
  const bodyArgs: Expression[] = [];
  let i = 0;
  for (const [k, x] of ops.entries()) {
    if (isBroadcastOperand(x, k)) {
      let name: string;
      do {
        i += 1;
        name = `_${i}`;
      } while (avoid.has(name));
      const p = ce.symbol(name, { canonical: false });
      const t = paramTypes?.(k);
      if (t === undefined) params.push(p);
      else {
        // The engine, not an author, wrote this annotation (the element type
        // of the source at this call), so it is marked as inferred and left
        // out of the serialized form, exactly as a callback annotation the
        // element-type inference writes (`annotateFunctionLiteralParams`).
        const typeOperand = ce.string(typeToString(t));
        markInferredTypeOperand(typeOperand);
        params.push(ce._fn('Typed', [p, typeOperand], { canonical: false }));
      }
      bodyArgs.push(p);
      cols.push(x);
    } else {
      bodyArgs.push(x);
    }
  }

  // The per-element call of a `callee` binds its element WHOLE (the one-rank
  // arrest): `ApplyWhole`, since `Apply` maps a function literal with scalar
  // parameters over a collection element (`applyLiteralMaps`,
  // `library/core.ts`).
  let body = callee
    ? ce._fn('ApplyWhole', [callee, ...bodyArgs], { canonical: false })
    : ce._fn(operator, bodyArgs, { canonical: false });
  // When a numeric approximation was requested (`.N()`), wrap each element's
  // body in the numeric marker `NumericApproximation(…)` so it floats on
  // access — otherwise a lazy element would evaluate EXACTLY (e.g.
  // `Sin(Range(1,1e8)).N()` element 1 → symbolic `sin(1)` instead of
  // `0.841…`). The marker is not the `N` operator: it gives the result of the
  // `.N()` method, which keeps an integer exact, while `N` makes it a float.
  // The body is built fresh here, so there is no risk of double-wrapping on
  // re-evaluation of the returned `Map`.
  if (numericApproximation)
    body = ce._fn('NumericApproximation', [body], { canonical: false });
  // A bare parameter (no `paramTypes` annotation) is pre-declared at the
  // element type of its source, as an INFERRED type. Canonicalizing the body
  // otherwise declares the parameter `unknown` and its use narrows it (a
  // value-type inference), and the deferred settling of that inference
  // advances the `any` axis once per lazy map, which retires the cached
  // type of every expression in the engine: the lazy maps that one
  // evaluation builds re-typed the trees it held once per map (about twenty
  // advances per level of the chain of Tycho ledger row 380). The element
  // type of the source is what the use would have inferred, so the literal
  // and its printed form are unchanged; an inferred type is not an
  // annotation, nothing is enforced at apply time. A source whose element
  // type says nothing (`unknown`, `any`), or is the bottom `never`, keeps the
  // inference.
  const inferredParamTypes = new Map<string, Type>();
  for (const [j, p] of params.entries()) {
    if (!isSymbol(p)) continue;
    const t = collectionElementType(cols[j].type.type);
    if (t === undefined || t === 'unknown' || t === 'any' || t === 'never')
      continue;
    inferredParamTypes.set(p.symbol, t);
  }
  // The canonicalizer is called directly to pass the hint. On the box route
  // (`ce.function`) a `canonical` handler that throws is caught, logged, and
  // the literal boxed non-canonical; the direct call has no such catch, so a
  // throw falls back to the box route, and both routes then give the same
  // literal for the same body.
  let fn: Expression | undefined;
  if (inferredParamTypes.size > 0) {
    try {
      fn = ce._canonicalFunctionLiteralOperands([body, ...params], {
        inferredParamTypes,
      });
    } catch {
      fn = undefined;
    }
  }
  fn ??= ce.function('Function', [body, ...params]);
  return ce.function('Map', [fn, ...cols]);
}

/**
 * Return the lazy `Map` form ({@link lazyBroadcastMap}) of the element-wise
 * broadcast of `operator` over `ops` (broadcast operands identified by
 * `isBroadcastOperand`) when the broadcast should be lazified, otherwise
 * `undefined` so the caller runs its existing eager loop. It is lazified when
 * either:
 * - some broadcast operand is of **unknown or infinite** length (`Cycle`,
 *   `Filter`, a symbolic-length `Range`): these cannot be eagerly zipped —
 *   `zip` would truncate to a single element — so the lazy `Map` is the only
 *   sound result; or
 * - every broadcast operand is known-finite but the **shortest** length is
 *   past `MAX_SIZE_EAGER_COLLECTION`: materialize lazily instead of building
 *   the whole result.
 *
 * When every broadcast operand is known-finite and small (≤ threshold), returns
 * `undefined` so the caller's eager loop runs byte-identically. If any operand
 * is unknown/infinite, `isBroadcastOperand` MUST admit finite operands too
 * (e.g. `isBroadcastableCollection`), so a mixed finite+infinite broadcast maps
 * all collections as `Map` sources and the variadic `Map` enforces
 * shortest-input semantics at iteration time.
 */
export function lazyBroadcastMapIfNeeded(
  ce: Expression['engine'],
  operator: string,
  ops: ReadonlyArray<Expression>,
  isBroadcastOperand: (x: Expression, i: number) => boolean,
  numericApproximation = false,
  options?: {
    strictLengths?: boolean;
    callee?: Expression;
    paramTypes?: (i: number) => Type | undefined;
  }
): Expression | undefined {
  let minKnown = Infinity;
  let hasBroadcast = false;
  let hasUnknownOrInfinite = false;
  for (const [k, x] of ops.entries()) {
    if (!isBroadcastOperand(x, k)) continue;
    hasBroadcast = true;
    const c = x.count;
    // A finite collection whose elements cannot be walked
    // (`Linspace(a, 1, 3)` with a symbolic `a`) counts as unknown: the eager
    // zip would read it as empty, so the broadcast takes the lazy form.
    if (
      isWalkableFiniteCollection(x) &&
      typeof c === 'number' &&
      Number.isFinite(c) &&
      c >= 0
    )
      minKnown = Math.min(minKnown, c);
    else hasUnknownOrInfinite = true;
  }
  if (!hasBroadcast) return undefined;
  if (!hasUnknownOrInfinite && minKnown <= MAX_SIZE_EAGER_COLLECTION)
    return undefined;
  // Lists of machine numbers are in memory already: their element-wise
  // arithmetic is computed at once, on doubles, when that gives the values
  // the interpreter gives (`machineBroadcast`). The lazy form below is for a
  // source that is itself lazy, or that is not made of machine numbers. A
  // declared function (`callee`) has its own element function and is never
  // computed this way.
  if (!hasUnknownOrInfinite && options?.callee === undefined) {
    const eager = machineBroadcast(ce, operator, ops, numericApproximation);
    if (eager !== undefined) return eager;
  }
  return lazyBroadcastMap(
    ce,
    operator,
    ops,
    isBroadcastOperand,
    numericApproximation,
    options?.strictLengths ?? true,
    options?.callee,
    options?.paramTypes
  );
}

/**
 * `.N()` of an already-evaluated lazy `Map` — typically the hybrid-laziness
 * broadcast form (`Sin(Range(1, 10^8)).evaluate()`) — would otherwise be an
 * identity: the `Map` is already evaluated, it has no `evaluate` handler, and
 * without one the `numericApproximation` flag never reaches the elements, so
 * `each()`/`at()` keep producing EXACT values (`sin(1)`, `sin(2)`, …). This
 * breaks the `x.evaluate().N()` ≡ `x.N()` contract (`lazyBroadcastMap` wraps
 * the body in the numeric marker `NumericApproximation` only when the
 * broadcast is CONSTRUCTED under `.N()`).
 *
 * Return a `Map` over the same sources whose mapping-function body is wrapped
 * in the numeric marker `NumericApproximation(…)`, so every element
 * numericizes on access — laziness preserved. The marker gives the result of
 * the `.N()` method (an integer stays exact), not of the `N` operator.
 * Returns `undefined` when `expr` is not such a `Map`, or its body is already
 * wrapped in the marker or in `N` (idempotence: `x.N().N()` must not grow the
 * wrapping; a body in `N` is already numeric).
 *
 * The rewrap is **memoized per original instance**: repeated `.N()` calls on
 * one logical `Map` return the *same* rewrapped instance, so any per-instance
 * state keyed on the rewrapped `Map` (the auto-compile cache in
 * `library/map-auto-compile.ts`) survives across top-level drains. The rewrap
 * is purely structural (built from `fn.json`, or around `fn` itself for a
 * closure), so the memo needs no invalidation — with one exception: a rewrap
 * whose callback is the function literal that a value-bound SYMBOL holds at
 * this moment (see `boundLiteral` below) depends on the frame it was made
 * in, and is not memoized. The body `Map(h, [1, 2, 3])` of `f(h) := …` is one
 * instance for every application of `f`; a memoized rewrap would map the
 * callback of the first application in all later ones. Per-instance
 * semantics stay as item 40 ratified: a `subs()` or re-boxed copy is a new
 * original and runs cold.
 */
const lazyMapNRewraps = new WeakMap<Expression, Expression>();

/** A literal collection with fewer elements is searched element by element:
 * an index costs more than it saves. */
const ELEMENTS_BY_HASH_MIN_SIZE = 32;

/** The index of each large literal collection, built the first time a
 * membership is asked. An expression does not change, so the index stays
 * valid. */
const ELEMENTS_BY_HASH = new WeakMap<Expression, Map<number, Expression[]>>();

/**
 * The elements of the literal collection `expr`, grouped by their hash. Two
 * `isSame` elements always have the same hash, so a membership test by
 * `isSame` reads only the elements that have the hash of the target: its cost
 * does not grow with the size of the collection, where a comparison with
 * every element made a walk that asks for the membership of each element of
 * another collection (the elements of a held `Union`) quadratic.
 */
function elementsByHash(
  expr: Expression & { ops: ReadonlyArray<Expression> }
): Map<number, Expression[]> {
  let index = ELEMENTS_BY_HASH.get(expr);
  if (index === undefined) {
    index = new Map();
    for (const op of expr.ops) {
      const bucket = index.get(op.hash);
      if (bucket === undefined) index.set(op.hash, [op]);
      else bucket.push(op);
    }
    ELEMENTS_BY_HASH.set(expr, index);
  }
  return index;
}

export function lazyMapNumericApproximation(
  ce: Expression['engine'],
  expr: Expression
): Expression | undefined {
  const memo = lazyMapNRewraps.get(expr);
  if (memo !== undefined) return memo;
  if (!isFunction(expr, 'Map')) return undefined;
  const fn = expr.op1;
  if (!isSymbol(fn) && !(isFunction(fn, 'Function') && fn.nops >= 1))
    return undefined;

  // Wrap the body INSIDE the canonical `Block` wrapper: `Block` evaluates its
  // result without propagating the approximation flag, so `N(Block(sin(_)))`
  // stays exact — the `N` must sit directly on the returned expression.
  let body: Expression | undefined = undefined;
  if (isFunction(fn, 'Function')) {
    body = fn.op1;
    if (isFunction(body, 'Block') && body.nops === 1) body = body.op1;
    // Idempotence: the body already numericizes.
    if (body.operator === 'NumericApproximation' || body.operator === 'N')
      return undefined;
  }

  let wrappedFn: Expression;
  // The function literal a value-bound symbol callback holds in the current
  // frame, when that is what the rewrap applies (closure branch below).
  let boundLiteral: Expression | undefined = undefined;
  // A bare symbol bound in the GLOBAL scope (`h` declared with
  // `ce.declare`, or assigned at the top level) survives every frame: its
  // name resolves to the same definition wherever the lazy result is read.
  // It takes the symbol branch below, whose callback APPLIES THE NAME, so
  // the application is checked against the definition's declared parameter
  // types (`h` declared `(x: integer) -> integer`: `Map(h, [1, 2.5])` under
  // `.N()` answered `[2, 5]` through the literal the symbol holds, which
  // carries no annotation, where `evaluate()` answers an error at the second
  // element) and broadcasts a collection element as a direct application
  // does. The closure branch is for a callback bound in a frame that the
  // reader of the lazy result does not see (a parameter, a block local).
  const globalCallback = isSymbol(fn) && isGlobalBinding(ce, fn.symbol);
  if (!globalCallback && readsOtherBindings(ce, fn)) {
    // A callback that reads a name that the current scope binds to another
    // definition (a closure, such as `x ↦ x/c` for a `c` local to a `Block`)
    // is not made again from MathJSON: a callback made again reads `c` in
    // the current scope. The new callback applies the callback as it is:
    // `(_1, …, _k) ↦ NumericApproximation(Apply(f, _1, …, _k))`. Its
    // parameters are not symbols of `f`, so that they do not bind a symbol
    // that `f` reads.
    //
    // A parameter type that inference wrote (`isInferredTypedParameter()`)
    // is removed from `f`: it is the type of the exact elements of the
    // source (`rational` for a source of halves), and the marker applies `f`
    // to a float. The body of `f` is kept as it is, with its scope.
    //
    // A bare symbol callback that the current scope binds to a VALUE that is
    // a function literal (the parameter `h` of `f(h) := Map(h, [1, 2, 3])`
    // while `f` is applied, or a local `h := z ↦ 2z` of a `Block`) is
    // replaced by that literal. The elements of the lazy result are read
    // after the frame that binds `h` is gone, and the symbol does not
    // survive the canonicalization of the new callback as an operand:
    // `Apply(h, _1)` canonicalizes to the application `h(_1)`, whose head is
    // a NAME, resolved in the scope of the reader (a global function of the
    // same name, or nothing). The parameter substitution that runs when the
    // application returns rewrites symbol operands only
    // (`bindingKeyedSubs`, `function-utils.ts`), so it does not reach that
    // head either. The literal itself has no name to lose.
    //
    // The assignment of a function literal to a local of a `Block` can make
    // an OPERATOR definition, which keeps the literal it applies
    // (`_lambdaLiteral`). That literal is read too: without it,
    // `Block(h := x ↦ 2·Numerator(x), Map(h, [3/7])).N()` was
    // `[h(3/7)]`, where `evaluate()` gives `[6]`. A literal that is not
    // canonical (an `evaluate` handler written in MathJSON) is not read: it
    // is not bound to the scope where it was defined.
    boundLiteral = (() => {
      if (!isSymbol(fn)) return undefined;
      const def = ce.lookupDefinition(fn.symbol);
      const value = isValueDef(def)
        ? def.value.value
        : isOperatorDef(def) && def.operator._lambdaLiteral?.isCanonical
          ? def.operator._lambdaLiteral
          : undefined;
      return value !== undefined && isFunction(value, 'Function')
        ? value
        : undefined;
    })();
    const callee =
      isFunction(fn, 'Function') &&
      fn.ops.slice(1).some(isInferredTypedParameter)
        ? ce._fn('Function', [
            fn.op1,
            ...fn.ops
              .slice(1)
              .map((p) =>
                isFunction(p) && isInferredTypedParameter(p) ? p.op1 : p
              ),
          ])
        : (boundLiteral ?? fn);
    const symbols = new Set(fn.symbols);
    const params: Expression[] = [];
    let k = 0;
    for (let i = 1; i < expr.nops; i++) {
      do k += 1;
      while (symbols.has(`_${k}`));
      params.push(ce.symbol(`_${k}`, { canonical: false }));
    }
    const applied = ce._fn(
      'NumericApproximation',
      [ce._fn('Apply', [callee, ...params], { canonical: false })],
      { canonical: false }
    );
    wrappedFn = ce.function('Function', [applied, ...params]);
  } else if (isSymbol(fn)) {
    // A bare symbol callback (`Map(Sin, xs)`, `Map(f, xs, ys)`) has no body
    // to wrap. Build the function literal
    // `(_1, …, _k) ↦ NumericApproximation(f(_1, …, _k))` instead, with one
    // parameter per source, so that the elements numericize on access as
    // they do for a function literal callback.
    const params = expr.ops.slice(1).map((_, i) => `_${i + 1}`);
    wrappedFn = ce.box([
      'Function',
      ['NumericApproximation', [fn.symbol, ...params]],
      ...params,
    ] as MathJsonExpression);
  } else {
    // Rebuild the function literal from MathJSON rather than re-hosting the
    // canonical body: a canonical body is bound into the ORIGINAL literal's
    // parameter scope, and grafting it under a new `Function` would split
    // the bindings between the old and new scopes. The callback reads no
    // name that the current scope binds to another definition
    // (`readsOtherBindings()`), so the literal made again reads the same
    // definitions.
    const fnJson = fn.json;
    if (body === undefined || !Array.isArray(fnJson)) return undefined;
    wrappedFn = ce.box([
      'Function',
      ['NumericApproximation', body.json],
      ...fnJson.slice(2),
    ] as MathJsonExpression);
  }
  if (!wrappedFn.isValid) return undefined;
  const rewrapped = ce.function('Map', [wrappedFn, ...expr.ops.slice(1)]);
  // A rewrap around the literal a symbol holds NOW is valid for this frame
  // only (see the memo note in the JSDoc).
  if (boundLiteral === undefined) lazyMapNRewraps.set(expr, rewrapped);
  return rewrapped;
}

/**
 * True when `name` is bound in the GLOBAL scope of `ce` as seen from the
 * current scope: the scope that binds it is the root of the scope chain
 * (the library's definitions) or the root's child (the engine's global
 * scope, where `ce.declare` and a top-level assignment bind). A parameter
 * of an enclosing function or a local of a block is bound in a scope below
 * those, which a reader outside the frame does not see.
 */
function isGlobalBinding(ce: Expression['engine'], name: string): boolean {
  let scope: Scope | null = ce.context.lexicalScope;
  let holder: Scope | null = null;
  let top: Scope | null = scope;
  while (scope) {
    if (holder === null && scope.bindings.has(name)) holder = scope;
    top = scope;
    scope = scope.parent;
  }
  if (holder === null || top === null) return false;
  return holder === top || holder.parent === top;
}

/**
 * True when the callback `fn` of a `Map` (a symbol, or a function literal)
 * reads a name that the current scope of `ce` binds to a definition that is
 * not the definition that `fn` is bound to. Such a callback is a closure: it
 * reads a variable of another scope (`Block(c := 5, Map(x ↦ x/c, …))`, read
 * after the `Block` returned), and a callback made again from MathJSON in the
 * current scope does not read that variable.
 *
 * The parameters of a function literal are not checked: they are bound by
 * the literal. A name of a scope inside the body (a local of a `Block`, the
 * index of a `Sum`, the parameter of a nested function) is bound to that
 * scope, and it makes the result `true`. The result is then `true` for a
 * callback that is not a closure, which is safe: the callback is applied as
 * it is (see `lazyMapNumericApproximation()`).
 */
function readsOtherBindings(ce: Expression['engine'], fn: Expression): boolean {
  const current = (name: string): unknown => {
    const def = ce.lookupDefinition(name);
    return isValueDef(def)
      ? def.value
      : isOperatorDef(def)
        ? def.operator
        : undefined;
  };
  const params = new Set<string>();
  if (isFunction(fn, 'Function'))
    for (const p of fn.ops.slice(1)) {
      const name = sym(p) ?? (isFunction(p, 'Typed') ? sym(p.op1) : undefined);
      if (name !== undefined) params.add(name);
    }
  const visit = (e: Expression): boolean => {
    if (isSymbol(e))
      return !params.has(e.symbol) && e.baseDefinition !== current(e.symbol);
    if (!isFunction(e)) return false;
    // A call is bound to the operator definition of its operator, or to the
    // value definition of a symbol whose value is a function: `h(x)` for a
    // local `h := z ↦ 2z` of a `Block` has no operator definition. A call
    // that is bound to no definition is also taken as a closure: the
    // current scope can bind its operator to another definition.
    const def = e.baseDefinition;
    if (def === undefined || def !== current(e.operator)) return true;
    return e.ops.some(visit);
  };
  return isFunction(fn, 'Function') ? visit(fn.op1) : visit(fn);
}

/**
 * Window geometry extracted from a windowing operator expression by
 * {@link windowedCollectionOps}.
 * - `src`: the source collection being windowed.
 * - `size`: window length.
 * - `step`: distance between consecutive window starts.
 * - `keepPartial`: whether the trailing partial window is emitted (chunk form)
 *   or dropped (complete-windows-only form).
 */
export interface WindowedParams {
  src: Expression;
  size: number;
  step: number;
  keepPartial: boolean;
}

/**
 * A parameterized builder for the lazy `collection` handlers shared by the
 * windowing operators — `Partition` (chunk form `Partition(xs, n)` and
 * sliding-window form `Partition(xs, n, step)`) and `SlidingWindow(xs, k,
 * step?)`. `getParams(expr)` extracts the window geometry from a given operator
 * expression, or returns `undefined` for a form that has no lazy view (e.g.
 * `Partition`'s predicate form) or has invalid parameters (`size <= 0`,
 * `step <= 0`, non-integer) — in which case EVERY facet returns `undefined`,
 * leaving the expression fully inert.
 *
 * Forms (mirror the eager evaluate paths exactly):
 * - Chunk (`Partition(xs, n)`): consecutive size-`n` chunks; the trailing
 *   partial chunk is KEPT → `size = step = n`, `keepPartial = true`.
 * - Sliding window (`Partition(xs, n, step)`, `SlidingWindow(xs, k, step?)`):
 *   only COMPLETE windows are emitted → `keepPartial = false`.
 */
export function windowedCollectionOps(
  getParams: (collection: Expression) => WindowedParams | undefined
): CollectionHandlers {
  // Number of windows produced from a source of length `n`.
  const windowCount = (p: WindowedParams, n: number): number => {
    if (!Number.isFinite(n)) return Infinity;
    if (p.keepPartial) return Math.ceil(n / p.size);
    return n >= p.size ? Math.floor((n - p.size) / p.step) + 1 : 0;
  };

  return {
    isLazy: () => true,
    count: (expr) => {
      const p = getParams(expr);
      if (p === undefined) return undefined;
      const n = smallCount(p.src);
      if (n === undefined) return undefined;
      return windowCount(p, n);
    },
    isFinite: (expr) => {
      const p = getParams(expr);
      if (p === undefined) return undefined;
      return p.src.isFiniteCollection;
    },
    isEnumerable: (expr) => {
      const p = getParams(expr);
      if (p === undefined) return undefined;
      // Windows are cut from the source's elements: no source walk, no
      // windows (`count` reports 0 for an unknown-length source, which a
      // consumer would otherwise read as an empty result).
      return p.src.isEnumerableCollection;
    },
    isEmpty: (expr) => {
      const p = getParams(expr);
      if (p === undefined) return undefined;
      const n = smallCount(p.src);
      if (n === undefined) return undefined;
      return windowCount(p, n) === 0;
    },
    at: (expr, index) => {
      if (typeof index !== 'number' || index < 1) return undefined;
      const p = getParams(expr);
      if (p === undefined) return undefined;
      const { src, size, step, keepPartial } = p;
      const n = smallCount(src);
      const start = (index - 1) * step + 1;
      const end = start + size - 1;
      if (n === undefined) {
        // The count of the source is not known (`FlatMap([1, 2, 3], x ↦
        // [x, x])`), or it is a `bigint` (`Permutations(Range(1, 25))`).
        // The view claims to be enumerable, and `Take`, `Drop` and `Rest`
        // read it by position, so a window at a positive position must be
        // given also with no count: when this returned `undefined`,
        // `Take(Partition(FlatMap(…), 2), 1)` was `[]`.
        //
        // The source is read with ONE walk: the first `start − 1` elements
        // are skipped, and the next `size` elements are the window. A read
        // of each element by position is a walk from the start for such a
        // source, so `First(Partition(Permutations(Range(1, 25)), 10000))`
        // took 78 s. A walk that ends before the start means that the
        // window is past the end.
        if (!Number.isSafeInteger(end)) return undefined;
        if (src.isIndexedCollection !== true) return undefined;
        const iter = src.each();
        try {
          for (let j = 1; j < start; j++)
            if (iter.next().done === true) return undefined;
          const items: Expression[] = [];
          for (let j = start; j <= end; j++) {
            const step = iter.next();
            if (step.done === true) {
              // An incomplete window is kept only by the chunk form, as its
              // trailing partial chunk.
              if (j === start || !keepPartial) return undefined;
              break;
            }
            items.push(step.value);
          }
          return expr.engine.function('List', items);
        } finally {
          iter.return?.(undefined);
        }
      }
      let last = end;
      if (Number.isFinite(n)) {
        if (keepPartial) {
          if (start > n) return undefined; // past the last (partial) chunk
          if (last > n) last = n; // clamp the trailing partial chunk
        } else if (end > n) return undefined; // incomplete window: out of range
      }
      const items: Expression[] = [];
      for (let j = start; j <= last; j++) {
        const el = src.at(j);
        if (el === undefined) return undefined; // non-indexed source
        items.push(el);
      }
      return expr.engine.function('List', items);
    },
    iterator: (expr) => {
      const p = getParams(expr);
      if (p === undefined) return undefined;
      const { src, size, step, keepPartial } = p;
      const ce = expr.engine;
      const source = src.each();
      const buffer: Expression[] = [];
      let skip = 0; // leading source elements still to discard (when step > size)
      let done = false;
      return {
        next: () => {
          if (done) return { value: undefined, done: true };
          // Discard elements skipped between windows (only when step > size).
          while (skip > 0) {
            const r = source.next();
            if (r.done) {
              done = true;
              return { value: undefined, done: true };
            }
            skip -= 1;
          }
          // Fill the buffer up to a full window.
          while (buffer.length < size) {
            const r = source.next();
            if (r.done) {
              done = true;
              // Trailing partial: only the chunk form keeps it (step === size,
              // so any buffered elements are un-emitted).
              if (keepPartial && buffer.length > 0) {
                const w = buffer.splice(0, buffer.length);
                return { value: ce.function('List', w), done: false };
              }
              return { value: undefined, done: true };
            }
            buffer.push(r.value);
          }
          // Emit a complete window (a copy of the buffered elements).
          const window = buffer.slice(0, size);
          if (step < size)
            buffer.splice(0, step); // retain the overlap
          else {
            buffer.length = 0;
            skip = step - size;
          }
          return { value: ce.function('List', window), done: false };
        },
      };
    },
  };
}

export function repeat(
  value: Expression,
  count?: number
): Iterator<Expression> {
  if (typeof count === 'number') {
    if (count < 0) count = 0;
    return {
      next() {
        if (count === 0) return { done: true, value: undefined };
        count!--;
        return { done: false, value };
      },
    };
  }
  // Infinite iterator
  return {
    next() {
      return { done: false, value };
    },
  };
}

/**
 * Does `x` supply CELLS to a zip, or is it lifted whole into every cell?
 *
 * A collection supplies cells; anything else is repeated. A STRING is the
 * exception: it is an indexed collection of its characters, yet it stays
 * ATOMIC under broadcast, so `String("x=", [1, 2])` must lift `"x="` into both
 * cells rather than pair `"x"` with `1` and `"="` with `2`. Same rule as
 * `isBroadcastableCollection`, applied at the zip.
 *
 * Wider than `isBroadcastableCollection` in one respect: it accepts a
 * collection that is not INDEXED, such as a set, which that predicate rejects.
 * A broadcast arm that decides which operands supply cells and then hands the
 * operands to `zip` must therefore gate on THIS predicate, or an operand it
 * meant to lift whole silently supplies cells instead.
 *
 * A finite collection whose elements cannot be walked (`QuotientRing(Integers,
 * 5)`, see {@link isWalkableFiniteCollection}) does not supply cells either:
 * it would supply none, and the zip would end at once with no rows. It is
 * lifted whole instead.
 */
export function zipParticipates(x: Expression): boolean {
  if (x.isFiniteCollection === true && !isWalkableFiniteCollection(x))
    return false;
  return x.isCollection && !isTextAtom(x);
}

/**
 * True when `x` is a collection that is not indexed: a set, an interval, a
 * dictionary, or a symbol whose value is one of these. Such a collection has
 * no positions, so the element-wise broadcast of a built-in operator must not
 * pair its elements with the cells of a list. {@link zip} accepts it (see
 * {@link zipParticipates}), so a broadcast arm must test for it before it
 * calls {@link zip}.
 *
 * When such an operand is at a number parameter, the broadcast arm declines,
 * and the evaluate handler of the operator gets the whole operand, as it does
 * when the other operands are scalars. A numeric operator then answers the
 * `incompatible-type` error for the set: `Power([1, 2, 3], Set(1, 2))` is the
 * same error as `Power(Set(1, 2), 2)`. At another parameter, the operand is
 * used whole in every cell (`String([1, 2], Set(3, 4))`).
 *
 * The test reads the value of `x`, not its type: an eager producer that is
 * not evaluated yet (`Unique([1, 2])`) has `isCollection === false`, so it
 * is not refused here, and it broadcasts when it is evaluated to a list.
 */
export function isUnindexedCollectionOperand(x: Expression): boolean {
  return x.isCollection === true && x.isIndexedCollection === false;
}

/**
 * True when the type of `x` is a set or a string. Then `|x|` (the operator
 * `Abs`) is the number of elements of `x`, that is `Count(x)`: the
 * cardinality of a set, and the length of a string.
 *
 * Examples of such operands: a `Set` literal, `EmptySet`, an `Interval`, a
 * number set such as `Integers`, `QuotientRing(Integers, 5)`, `Union(A, B)`,
 * a symbol declared as a set, a string literal.
 *
 * The test reads the TYPE, so that a set-typed symbol with no value (`S`
 * declared as `set<integer>`) is a cardinality too. A list, a tuple or a
 * dictionary is not: `Abs` of a list or a tuple is the absolute value of each
 * element or the norm of a point, and `Abs` of a dictionary is an error.
 */
export function isCardinalityOperand(x: Expression): boolean {
  const type = x.type;
  return type.matches('set<any>') || type.matches('string');
}

/**
 * The rows of a broadcast over `items`: the items for which `participates`
 * is true are zipped (shortest length wins, as in {@link zip}), and every
 * other item is repeated WHOLE in each row, a tuple included. {@link zip}
 * iterates every non-text collection, so a tuple beside a list was zipped
 * too, and `f([1, 2, 3], (10, 20))` for a scalar-parameter `f` gave two rows
 * `(1, 10), (2, 20)` instead of three rows each holding the whole point.
 */
export function zipBroadcast(
  items: ReadonlyArray<Expression>,
  participates: (x: Expression) => boolean
): Iterator<Expression[]> {
  const columns = items.filter(participates);
  const inner = zip(columns);
  return {
    next() {
      const { done, value } = inner.next();
      if (done) return { done: true, value: undefined };
      let k = 0;
      return {
        done: false,
        value: items.map((x) => (participates(x) ? value[k++] : x)),
      };
    },
  };
}

/**
 * Zips together multiple collections into a single iterator.
 *
 * Example:
 * ```typescript
 * const a = ce.expr(['List', 1, 2, 3]);
 * const b = ce.expr(['List', 4, 5, 6]);
 * const zipped = zip([a, b]);
 * for (const [x, y] of zipped) {
 *   console.log(x, y); // 1 4, 2 5, 3 6
 * }
 * ```
 */
export function zip(items: ReadonlyArray<Expression>): Iterator<Expression[]> {
  if (items.length === 0) {
    return {
      next() {
        return { done: true, value: undefined };
      },
    };
  }

  if (items.length === 1) {
    const item = items[0];
    // A STRING is atomic under broadcast — see `zipParticipates` above.
    const iter = zipParticipates(item) ? item.each() : undefined;
    if (!iter) {
      // Return the value, then be done
      let done = false;
      return {
        next() {
          if (done) return { done, value: undefined };
          done = true;
          return { done: false, value: [item] };
        },
      };
    }
    return {
      next() {
        const next = iter.next();
        if (next.done) return { done: true, value: undefined };
        return { done: false, value: [next.value] };
      },
    };
  }

  // Get the length of the shortest collection. A count can be a `bigint` (a
  // finite count that is not a safe integer), so the minimum uses `<`, which
  // compares a `bigint` and a `number` correctly; `Math.min()` throws for a
  // `bigint`. Reading such a count as unknown gave it the fallback length 1,
  // and the zip stopped after one row.
  const shortest = items.reduce<number | bigint>((min, x) => {
    const n = zipParticipates(x) ? (x.count ?? 1) : Infinity;
    return n < min ? n : min;
  }, Infinity);

  // When no item supplies cells, every item is repeated and the zip would
  // never end. Yield one row that holds each item whole, as for a single
  // item that does not supply cells.
  if (shortest === Infinity) {
    let done = false;
    return {
      next() {
        if (done) return { done, value: undefined };
        done = true;
        return { done: false, value: [...items] };
      },
    };
  }

  // If the shortest collection is empty, return an empty iterator
  if (shortest === 0) {
    return {
      next() {
        return { done: true, value: undefined };
      },
    };
  }

  // Get iterators for each item
  // If an item is not a collection, repeat it
  const iterators = items.map((x) =>
    zipParticipates(x) ? x.each() : repeat(x)
  );
  let count = 0;

  // Return an iterator that zips the items
  return {
    next() {
      if (count >= shortest) {
        return { done: true, value: undefined };
      }
      const values = iterators.map((x) => x.next());
      // An iterator that runs dry BEFORE the advertised `shortest` — a lazy
      // view whose `count` is knowable while its `at`/`iterator` cannot answer
      // (a `RotateLeft` with an unresolved offset) — ends the zip here. The
      // previous `x.value!` trusted `count` and spliced `undefined` into the
      // result, building a `List` whose cells were `undefined`: every later
      // reader of that list (`.toString()` first) crashed on a raw
      // `TypeError`, far from the cause. Ending early is the documented
      // shortest-zip semantics and cannot change a well-formed zip, where
      // every iterator yields `shortest` elements.
      if (values.some((x) => x.done === true || x.value === undefined))
        return { done: true, value: undefined };
      count += 1;
      return { done: false, value: values.map((x) => x.value!) };
    },
  };
}

/**
 * Describes a collection that contains EVERY value of an element type that
 * satisfies a sign constraint. The mathematical number sets are all of this
 * shape: `Integers` is every value of type `integer` with no sign
 * constraint, `PositiveNumbers` every value of type `real` whose sign is
 * `positive`, and so on.
 *
 * Saturation is what makes the shape usable for inclusion: because such a set
 * omits no value of its description, any collection whose own element type and
 * sign fit inside the description is a subset of it — no enumeration, and the
 * answer holds for an infinite or oversized candidate subset too. A collection
 * that merely HAPPENS to have those elements (`Set(1, 2)`, whose element type
 * is also `integer`) carries no such guarantee, which is why membership
 * in this table is declared, not inferred from `elttype`/`eltsgn`.
 */
export interface TypeSaturatedSet {
  /** The type every value of the set has, and every value of which is in it */
  elementType: Type;
  /** The sign every element has, or `undefined` for no sign constraint */
  sign: Sign | undefined;
}

/**
 * The type-saturated sets, keyed by the symbol that names them. Populated by
 * `declareTypeSaturatedSet()` as the number-set definitions are built
 * (`library/sets.ts`), so the table cannot drift from the definitions it
 * describes.
 */
const TYPE_SATURATED_SETS = new Map<string, TypeSaturatedSet>();

/**
 * Record that the set named `name` contains every value matching `shape`, and
 * return the shape so a definition can keep using it. See
 * {@linkcode TypeSaturatedSet}.
 */
export function declareTypeSaturatedSet(
  name: string,
  shape: TypeSaturatedSet
): TypeSaturatedSet {
  TYPE_SATURATED_SETS.set(name, shape);
  return shape;
}

/** The shape of `expr` if it is a declared type-saturated set, else `undefined` */
export function typeSaturatedShape(
  expr: Expression
): TypeSaturatedSet | undefined {
  const name = sym(expr);
  if (name === undefined) return undefined;
  return TYPE_SATURATED_SETS.get(name);
}

/**
 * Does the sign constraint `a` IMPLY the sign constraint `b` — i.e. is every
 * value whose sign is `a` also of sign `b`?
 *
 * `undefined` means "no constraint" on the `b` side (everything implies it)
 * and "constraint unknown" on the `a` side (it implies nothing but the absence
 * of a constraint). Both readings coincide with the lattice order, so one
 * function serves both.
 */
function signImplies(a: Sign | undefined, b: Sign | undefined): boolean {
  if (b === undefined) return true;
  if (a === undefined) return false;
  if (a === b) return true;
  if (a === 'zero') return b === 'non-negative' || b === 'non-positive';
  if (a === 'positive') return b === 'non-negative' || b === 'not-zero';
  if (a === 'negative') return b === 'non-positive' || b === 'not-zero';
  // `unsigned` is NOT the top of this lattice: it is the specific claim that a
  // value has an imaginary part or is NaN (`Sign` in `types-definitions.ts`),
  // so no real-signed constraint implies it. "No constraint" is spelled
  // `undefined`, handled above.
  return false;
}

/**
 * Is every value described by `a` also described by `b`? Both describe a set
 * of values as an element type plus a sign constraint — see
 * {@linkcode TypeSaturatedSet}.
 */
export function shapeIncludedIn(
  a: TypeSaturatedSet,
  b: TypeSaturatedSet
): boolean {
  return isSubtype(a.elementType, b.elementType) && signImplies(a.sign, b.sign);
}

/**
 * The `subsetOf` handler shared by every type-saturated set: decides
 * `self ⊆ other` by comparing descriptions, with no enumeration.
 *
 * Answering `false` (rather than "undecided") when the descriptions do not fit
 * is sound because these sets are non-empty: if `self`'s element type is not a
 * subtype of `other`'s, or its sign constraint is looser, then `self` holds a
 * value `other` does not.
 */
export function typeSaturatedSubsetOf(
  self: TypeSaturatedSet
): (
  collection: Expression,
  other: Expression,
  strict: boolean
) => boolean | undefined {
  return (_collection, other, strict) => {
    const target = typeSaturatedShape(other);
    if (target === undefined) {
      // `other` is described some other way. A type-saturated set is infinite
      // — every element type these sets are built on has infinitely many
      // values — so a FINITE `other` demonstrably cannot contain it. For an
      // infinite `other` the descriptions cannot be compared and the relation
      // is left undecided: a collection with an element type wide enough may
      // still omit values (the even integers omit the odd ones), so a `false`
      // here would be a claim this handler cannot support.
      return other.isFiniteCollection === true ? false : undefined;
    }
    if (!shapeIncludedIn(self, target)) return false;
    // A strict subset must not be the same set. Two descriptions denote the
    // same set exactly when each includes the other.
    if (strict && shapeIncludedIn(target, self)) return false;
    return true;
  };
}

/**
 * Default `subsetOf` handler: decide `a ⊆ b` by testing every element of `a`
 * for membership in `b`.
 *
 * Per the handler contract (`types-definitions.ts`), the receiver is the
 * candidate SUBSET.
 */
export function collectionSubset(
  a: Expression,
  b: Expression,
  strict: boolean
): boolean | undefined {
  // Fast path: when `b` contains every value of an element type and sign, `a`
  // is a subset of it as soon as `a`'s own element type and sign fit that
  // description — no walk, so it also answers for an infinite or oversized
  // `a` (`Range(1, 10^9) ⊆ Integers`).
  const bShape = typeSaturatedShape(b);
  if (bShape) {
    const handlers = a.baseDefinition?.collection;
    // The `elttype` handler is preferred over the type: it is never wider
    // than the type, and it can be narrower where the head knows more than
    // its declared element type says. The type is the fallback for a
    // collection with no such handler, and is an upper bound on the elements
    // either way. (A `Range` types `indexed_collection<integer>` and its
    // handler reports `integer`; the two now denote the same set,
    // since the bare name `integer` is itself finite and an infinite
    // endpoint marks extent rather than naming a member.)
    const elementType =
      handlers?.elttype?.(a) ?? collectionElementType(a.type.type);
    if (
      elementType !== undefined &&
      elementType !== 'unknown' &&
      shapeIncludedIn({ elementType, sign: handlers?.eltsgn?.(a) }, bShape)
    ) {
      // `b` is infinite (see `typeSaturatedSubsetOf`), so a finite `a` is a
      // proper subset. An infinite `a` may still equal `b`, so leave `strict`
      // to the walk below.
      if (!strict || a.isFiniteCollection === true) return true;
    }
    // A miss proves nothing: `elttype`/`eltsgn` are widenings of what `a`
    // actually holds. Fall through to the elementwise walk.
  }

  if (!isWalkableFiniteCollection(a)) return undefined;
  // Walking an enormous `a` (`Range(1, 10^9)`) would cost more than the answer
  // is worth; leave it undecided rather than spend unbounded time.
  const aSize = a.count;
  if (aSize === undefined || aSize > MAX_SIZE_EAGER_COLLECTION)
    return undefined;

  // All elements of a must be in b
  for (const x of a.each()) {
    const inB = b.contains(x);
    if (inB === undefined) return undefined;
    if (inB === false) return false;
  }

  // A strict subset (a ⊂ b) must have at least one element of `b` that is not
  // in `a`.
  if (strict) {
    // An infinite `b` cannot be exhausted by a finite `a`.
    if (b.isFiniteCollection === false) return true;
    if (!isWalkableFiniteCollection(b)) return undefined;
    const bSize = b.count;
    if (bSize === undefined || bSize > MAX_SIZE_EAGER_COLLECTION)
      return undefined;
    // Look for that element rather than comparing SIZES. A collection's
    // elements may repeat — `List` admits duplicates where `Set` does not — so
    // size is not a stand-in for extensional equality in either direction:
    // `List(1, 1)` and `List(1)` have different sizes and the same elements,
    // while `List(1, 1)` and `List(1, 2)` have the same size and different
    // ones.
    for (const y of b.each()) {
      const inA = a.contains(y);
      if (inA === undefined) return undefined;
      if (inA === false) return true;
    }
    return false;
  }
  return true;
}

/**
 * The value of the `List` literal `expr` when it has an element
 * that may evaluate to `Nothing` (`literalMayEraseElement()`), and `undefined`
 * otherwise.
 *
 * The literal erases an element that evaluates to `Nothing`, so its operands
 * are not its elements: with `c` false, `[If(c, 1, Nothing), 2]` holds one
 * element. A consumer that walks the literal without evaluating it (a lazy
 * `Map` or `Filter` over it, a count) read two elements, and
 * `Map(Sin, [If(c, 1, Nothing), 2])` was `[Sin(Nothing), Sin(2)]`. The
 * collection handlers of such a literal read its value instead, computed when
 * they are called, as the elements of a lazy view are.
 *
 * The literal is evaluated only when it is pure, so that a count or a walk
 * consumes no random draw. The answer is also `undefined` when the value
 * still has such an element (a condition with no value yet): the handlers
 * then read the operands, as before.
 *
 * The evaluation follows the numeric request of the evaluation that calls
 * the handler (`IComputeEngine._numericRequest`). Without one, the value is
 * the exact value of the literal, so that a handler that compares elements
 * (`contains`, `indexWhere`) reads values. Under `.N()`, only the elements
 * that may erase are evaluated, and the other elements are kept as written
 * (`literalWithErasureResolved`): the caller approximates what it reads, as
 * it does for a literal with no such element, and an exact evaluation of
 * every element could cost much more. With `H = Sum(1/k, k, 1, 6000)`, an
 * exact rational of about 2 600 digits, `Count(Map(Sin, [If(c, 1, Nothing),
 * H])).N()` took 11 s, for two exact evaluations of `H`, where it takes
 * less than 0.1 s without the element that may erase.
 */
function erasedLiteralValue(
  expr: Expression
): (Expression & FunctionInterface) | undefined {
  if (!isFunction(expr) || expr._numericStore !== undefined) return undefined;
  if (expr.operator !== 'List') return undefined;
  if (!literalMayEraseElement(expr)) return undefined;
  if (!isTransitivelyPure(expr)) return undefined;
  const value = expr.engine._numericRequest
    ? literalWithErasureResolved(expr)
    : expr.evaluate();
  if (value === undefined || !isFunction(value, expr.operator))
    return undefined;
  if (literalMayEraseElement(value)) return undefined;
  return value;
}

function basicCollectionIndexWhere(
  expr: Expression,
  predicate: (element: Expression) => boolean
): number | undefined {
  const erased = erasedLiteralValue(expr);
  if (erased !== undefined) return basicCollectionIndexWhere(erased, predicate);
  if (!isFunction(expr)) return undefined;
  const store = expr._numericStore;
  if (store !== undefined) {
    for (let i = 0; i !== store.length; i += 1)
      if (
        predicate(
          boxStoreElement(expr.engine, store[i], expr._numericStoreFloats)
        )
      )
        return i + 1;
    return undefined;
  }
  for (let i = 0; i !== expr.nops; i += 1)
    if (predicate(expr.ops[i]!)) return i + 1;

  return undefined;
}

function collectionIndexWhere(
  expr: Expression,
  predicate: (element: Expression) => boolean
): number | undefined {
  if (expr.isIndexedCollection !== true) return undefined;

  // Stream via `each()` rather than probing `at(1), at(2), …`: for a lazy
  // collection with an O(n) `at()` (e.g. `Comprehension`) the repeated-`at`
  // walk is O(k²); a single stream is linear. A deadline checkpoint (strided
  // to amortize `Date.now()`) means an unbounded search — `IndexOf` of a
  // never-matching value in an infinite collection — aborts at the active
  // `withTimeLimit` span deadline, if any
  // with the usual timeout `CancellationError` instead of hanging forever.
  //
  // The walk over a source that is not known to be finite is capped at
  // `ce.iterationLimit` elements, with or without a deadline (the deadline is
  // a wall-clock backstop, the cap bounds the work), and reports the
  // `iteration-limit-exceeded` cancellation, as the `Filter` iterator does:
  // `IndexOf(Repeat(6), 5)` walked forever (found 2026-09-29 with issue
  // #368). The index-search operators turn that cancellation into "no
  // answer" (`searchIndex`, `library/collections.ts`); the other consumer of
  // this handler, the default `contains`, only reaches it for a finite
  // source. A finite source is never capped, since the default limit (1024)
  // is far below an ordinary list or range (`IndexOf(Range(1, 5000), 4000)`
  // must answer).
  const deadline = expr.engine._deadline;
  const limit =
    expr.isFiniteCollection === true ? Infinity : expr.engine.iterationLimit;
  let i = 0;
  for (const op of expr.each()) {
    i += 1;
    if ((i & 0x3ff) === 0) checkDeadline(deadline);
    if (predicate(op)) return i;
    if (i >= limit)
      throw new CancellationError({
        cause: 'iteration-limit-exceeded',
        message: `Iteration limit of ${limit} exceeded while searching ${expr.operator}()`,
      });
  }

  return undefined;
}

/**
 * The default `contains` facet: whether an element of a finite collection
 * that can be walked is the same as `target` (`isSame()`), by a walk of the
 * collection. A collection with its own `contains` facet calls it when the
 * facet cannot answer without a walk.
 */
export function collectionContains(
  expr: Expression,
  target: Expression
): boolean | undefined {
  if (!isWalkableFiniteCollection(expr)) return undefined;

  // For indexed collections, we can use the indexWhere method
  if (expr.isIndexedCollection)
    return expr.indexWhere((x) => x.isSame(target)) !== undefined;

  // For non-indexed collections, we check if the element is in the collection
  for (const x of expr.each()) if (x.isSame(target)) return true;

  return false;
}

/**
 * Default collection handlers suitable for collections that store their
 * elements as operands.
 *
 * This is the case for List, Tuple, etc.
 */
export function basicIndexedCollectionHandlers(): CollectionHandlers {
  // A `List` built by `ce.list()` carries a numeric store instead of boxed
  // operands (`FunctionInterface._numericStore`). The handlers below answer
  // from the store when there is one, and box only the element they hand
  // out, so a 40 000-element list is never boxed whole by a count, an
  // indexed read or an iteration. Only a `List` can carry a store, so the
  // `Set` and `Tuple` definitions that share this factory never take these
  // branches. `nops` itself is store-aware on `BoxedFunction`.
  return {
    isLazy: (_expr) => false,

    count: (expr) => {
      const erased = erasedLiteralValue(expr);
      if (erased !== undefined) return erased.nops;
      return isFunction(expr) ? expr.nops : 0;
    },

    isEmpty: (expr) => {
      const erased = erasedLiteralValue(expr);
      if (erased !== undefined) return erased.nops === 0;
      return !isFunction(expr) || expr.nops === 0;
    },

    isFinite: (_expr) => true,

    contains: (expr, target) => {
      if (!isFunction(expr)) return false;
      const erased = erasedLiteralValue(expr);
      if (erased !== undefined) expr = erased;
      if (!isFunction(expr)) return false;
      const store = expr._numericStore;
      if (store !== undefined) {
        const x = machineNumberOf(target);
        if (x !== undefined) return storeContains(store, x);
      }
      if (expr.nops < ELEMENTS_BY_HASH_MIN_SIZE)
        return expr.ops.some((x) => x.isSame(target));
      return (
        elementsByHash(expr)
          .get(target.hash)
          ?.some((x) => x.isSame(target)) === true
      );
    },

    iterator: (expr) => {
      const erased = erasedLiteralValue(expr);
      if (erased !== undefined) expr = erased;
      if (!isFunction(expr))
        return { next: () => ({ value: undefined, done: true as const }) };
      let index = 1;
      const last = expr.nops;
      const store = expr._numericStore;

      return {
        next: () => {
          if (index === last + 1)
            return { value: undefined, done: true as const };
          index += 1;
          const i = index - 1 - 1;
          return {
            value:
              store !== undefined
                ? boxStoreElement(
                    expr.engine,
                    store[i],
                    expr._numericStoreFloats
                  )
                : expr.ops[i],
            done: false as const,
          };
        },
      };
    },

    subsetOf: collectionSubset,

    at: (expr: Expression, index: number | string): undefined | Expression => {
      // A fractional or `NaN` index names no element: the operand array read
      // below gives `undefined` for it, and the store branch must give the
      // same rather than box `store[NaN]`.
      if (
        typeof index !== 'number' ||
        !Number.isInteger(index) ||
        !isFunction(expr)
      )
        return undefined;
      const erased = erasedLiteralValue(expr);
      if (erased !== undefined) return erased.at(index);
      if (index < 0) index = expr.nops + index + 1;
      if (index < 1 || index > expr.nops) return undefined;
      const store = expr._numericStore;
      if (store !== undefined)
        return boxStoreElement(
          expr.engine,
          store[index - 1],
          expr._numericStoreFloats
        );
      return expr.ops[index - 1];
    },

    indexWhere: basicCollectionIndexWhere,

    eltsgn: (_expr) => undefined,

    elttype: (expr) => {
      if (!isFunction(expr) || expr.nops === 0) return 'unknown';
      if (expr.operator === 'Tuple')
        return collectionElementType(expr.type.type) ?? 'unknown';
      const store = expr._numericStore;
      if (store !== undefined) {
        // Parity with the operand walk below: one element answers its own
        // literal type; more widen. `widen` over the literal types of the
        // elements equals `widen` over their tiers, so the tiers are
        // collected once (`numericStoreTiers`) instead of boxing a literal
        // per element.
        if (store.length === 1) return expr.engine.number(store[0]).type.type;
        return widenAll(numericStoreTiers(store));
      }
      // The `Undefined` symbol is an absent element, as `Missing` is
      // (`isAbsentSymbol`), but it is declared `unknown`, which the widening
      // drops: `[1, Undefined]` answered `integer`, and `Zip` of two such
      // lists was typed `list<tuple<integer, integer>>` although its second
      // element is `Missing`. It is a `missing` element here, as in the type
      // of the literal (`classifyCellD`, `library/collections.ts`).
      const elementType = (op: Expression): Type =>
        isSymbol(op, 'Undefined') ? 'missing' : op.type.type;
      if (expr.nops === 1) return elementType(expr.ops[0]);
      return widenAll(expr.ops.map(elementType));
    },
  };
}

/** Membership of a machine number in a numeric store: `NaN` is found by a
 * `NaN` entry (as `isSame` finds it), any other value by `===`. */
function storeContains(store: readonly number[], x: number): boolean {
  if (Number.isNaN(x)) return store.some((v) => Number.isNaN(v));
  return store.includes(x);
}

/**
 * Call a collection's `count` handler, treating an `iteration-limit-exceeded`
 * cancellation as "unknown count" (`undefined`) rather than letting it escape.
 * Any other cancellation (deadline/timeout) or error propagates.
 *
 * Used by the synthesized `isEmpty`/`isFinite` defaults: those derive their
 * answer from `count`, whose walk may enforce `ce.iterationLimit` on a large
 * source and throw during canonicalization.
 */
function countOrUndefinedOnIterationLimit(
  count: (expr: Expression) => number | bigint | undefined,
  expr: Expression
): number | bigint | undefined {
  try {
    // The handler result is not normalized yet: a handler can return a small
    // `bigint` such as `0n`, which would fail the `=== 0` test below.
    return normalizeCount(count(expr));
  } catch (e) {
    if (
      e instanceof CancellationError &&
      e.cause === 'iteration-limit-exceeded'
    )
      return undefined;
    throw e;
  }
}

export function defaultCollectionHandlers(
  def: undefined | CollectionHandlers
): CollectionHandlers | undefined {
  if (!def) return undefined;

  if (!def.count || !def.iterator)
    throw new Error(
      'A collection must have at least an "iterator" and a "count" handler'
    );

  if (def.indexWhere && def.at === undefined) {
    throw new Error(
      'A collection with an "indexWhere" handler must also have an "at" handler'
    );
  }

  const result: CollectionHandlers = {
    iterator: def.iterator,
    count: def.count,
    contains: def.contains ?? collectionContains,
    isEmpty:
      def.isEmpty ??
      ((expr) => {
        const count = countOrUndefinedOnIterationLimit(def.count, expr);
        if (count === undefined) return undefined;
        return count === 0;
      }),
    isFinite:
      def.isFinite ??
      ((expr) => {
        const count = countOrUndefinedOnIterationLimit(def.count, expr);
        if (count === undefined) return undefined;
        return isFiniteCount(count);
      }),
    subsetOf: def.subsetOf ?? collectionSubset,
  };
  if (def.isCollection) result.isCollection = def.isCollection;
  if (def.isEnumerable) result.isEnumerable = def.isEnumerable;
  if (def.isLazy) result.isLazy = def.isLazy;
  if (def.elementMemo) result.elementMemo = def.elementMemo;
  if (def.eltsgn) result.eltsgn = def.eltsgn;
  if (def.elttype) result.elttype = def.elttype;
  if (def.countOf) result.countOf = def.countOf;
  if (def.at) {
    result.at = def.at;
    result.indexWhere = def.indexWhere ?? collectionIndexWhere;
    if (def.atBigint) result.atBigint = def.atBigint;
    if (def.indexOf) result.indexOf = def.indexOf;
  }
  return result;
}

/**
 * Whether an operand of a parenthesized LaTeX list `(a, b, …)` makes that
 * list a LIST OF POINTS rather than one point: the operand is a finite indexed
 * collection (a list, a vector, a `Range`) whose elements are NUMBERS. The
 * decision reads the operand's TYPE, so a symbol declared or assigned a
 * `list<real>` counts and a symbol of unknown type does not.
 *
 * A `missing` arm is removed from the operand's type and from its element
 * type first: a restricted list `A\{0 < t\}` (typed `list<real> | missing`)
 * is a source, and its absence makes the whole point list absent (see the
 * `PointList` evaluate handler).
 *
 * - A tuple or a string operand is one coordinate, never a source: the same
 *   exclusions as the `PointList` type handler.
 * - A collection whose elements are not known to be numbers is not a source:
 *   a matrix, a list of points, a list of strings or of booleans, and a list
 *   whose element type is `unknown` or `any` (a symbol declared a bare
 *   `list`, which could later hold a matrix). The list stays a plain `Tuple`.
 * - A collection known to be infinite (`Range(1, +oo)`) is not a source: a
 *   point list of it has no value.
 */
export function isPointListCoordinateSource(op: Expression): boolean {
  if (op.isFiniteCollection === false) return false;
  return isListCoordinateType(op.type.type);
}

/**
 * The type-level half of {@link isPointListCoordinateSource}: whether `type`,
 * with its `missing` arm removed, is a finite-shaped indexed collection (not a
 * tuple, not a string) whose element type, with its `missing` arm removed, is
 * a subtype of `number`.
 */
export function isListCoordinateType(type: Type): boolean {
  const stripped = stripMissingFromType(type);
  const t = resolveTypeReference(stripped) ?? stripped;
  if (t === 'string' || t === 'never') return false;
  if (typeof t !== 'string' && t.kind === 'tuple') return false;
  if (!isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE)) return false;
  const element = collectionElementType(t);
  if (element === undefined) return false;
  const e = stripMissingFromType(element);
  if (e === 'never') return false;
  return isSubtype(e, 'number');
}

/**
 * Whether the operands of a parenthesized LaTeX list `(a, b, …)` make it a
 * LIST OF POINTS: at least one operand is a list coordinate
 * ({@link isPointListCoordinateSource}), and every other operand is a number
 * coordinate. A number coordinate is an operand whose type, with its
 * `missing` arm removed, is a subtype of `number`, or is `unknown` (a symbol
 * with no declared type, which may hold a number).
 *
 * A list with another coordinate, such as a string, a set, a boolean or a
 * matrix (`(A, "hi")`, `(A, {1, 2})`), stays a plain `Tuple`: it has no
 * reading as a list of points.
 */
export function isPointListReading(ops: ReadonlyArray<Expression>): boolean {
  let source = false;
  for (const op of ops) {
    if (isPointListCoordinateSource(op)) {
      source = true;
      continue;
    }
    const t = stripMissingFromType(op.type.type);
    if (t !== 'unknown' && !isSubtype(t, 'number')) return false;
  }
  return source;
}

/**
 * Whether `x` is a `Tuple` with at least one LIST coordinate: a coordinate
 * that {@link isPointListCoordinateSource} accepts (a finite indexed
 * collection of scalars, such as `([1, 2, 3], [10, 20, 30])`).
 *
 * Such a tuple is data: operators such as `Tally`, `Eigen` and `LU`, and Epsil
 * tuple literals, use it to hold several results side by side. It is not a
 * point, and it is not a list of points either (a list of points is written
 * `PointList(A, B)`, or `(A, B)` in LaTeX). So arithmetic over it (`+`, `-`,
 * `·`, `/`, negation, a power) has no value any consumer can use, and the
 * arithmetic operators report an error for it instead of combining the lists
 * coordinate by coordinate. Operators that only read the tuple (`PointX`,
 * `Norm`, `Dot`, `Length`) are not affected.
 *
 * Only a literal `Tuple` expression is recognized, which is what an
 * evaluated operand is. A coordinate that is a matrix or a list of points is
 * not a list coordinate (see `isPointListCoordinateSource`).
 */
export function isTupleWithListCoordinate(x: Expression): boolean {
  return isFunction(x, 'Tuple') && x.ops.some(isPointListCoordinateSource);
}

/**
 * The type-level twin of {@link isTupleWithListCoordinate}: whether `type`,
 * with its `missing` arm removed, is a tuple type with at least one LIST
 * coordinate ({@link isListCoordinateType}), such as
 * `tuple<list<real>, list<real>>`.
 *
 * A value of such a type evaluates to a `Tuple` with a list coordinate, so
 * arithmetic over it, and every function that applies to each coordinate of
 * a tuple, always evaluates to an `incompatible-type` error. The static type
 * of such an application is `error` for the same reason. A union with another
 * arm (`tuple<list<real>, real> | real`) is not recognized: it may hold a
 * value that is not such a tuple.
 */
export function isListCoordinateTupleType(type: Type): boolean {
  const stripped = stripMissingFromType(type);
  const t = resolveTypeReference(stripped) ?? stripped;
  if (typeof t === 'string' || t.kind !== 'tuple') return false;
  return t.elements.some((el) => isListCoordinateType(el.type));
}

/** The arithmetic operators whose evaluate handlers report an error for a
 * `Tuple` operand with a list coordinate (`listCoordinateTupleOperandError`
 * in `boxed-expression/validate.ts`). */
const LIST_COORDINATE_TUPLE_ARITHMETIC = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Sqrt',
  'Root',
]);

/**
 * Whether an application of `operator` to operands of the types
 * `operandTypes` always evaluates to an error, so that its static type is
 * `error`. This is true for the arithmetic operators, and for an operator
 * that applies to each coordinate of a tuple (`overTuples`, the
 * `broadcastsOverTuples` predicate of `boxed-function.ts`: `Sin`, `Ln`,
 * `Floor`, …), when an operand is:
 * - a tuple with a list coordinate ({@link isListCoordinateTupleType}): the
 *   application evaluates to an `incompatible-type` error;
 * - typed `error`, such as `Sin(Tuple(A, B))` with `A`, `B` lists: the
 *   operand evaluates to an error, and the numeric-argument check lets that
 *   operand through unchanged (`checkNumericArgs` in `validate.ts`), so the
 *   application evaluates to that same error. Without this rule, the type of
 *   the enclosing application depended on the operator: `1 + E` was
 *   `error | integer`, `2E` was `number` and `-E` was `error`.
 */
export function appliesToListCoordinateTuple(
  operator: string,
  overTuples: boolean,
  operandTypes: ReadonlyArray<Type>
): boolean {
  if (!overTuples && !LIST_COORDINATE_TUPLE_ARITHMETIC.has(operator))
    return false;
  return operandTypes.some(
    (t) => t === 'error' || isListCoordinateTupleType(t)
  );
}

/**
 * Whether a sum (`Add`, `Subtract`) of operands of the types `operandTypes`
 * always evaluates to a collection of `incompatible-type` errors, so that its
 * static type is `error`. This is true when one operand is a point (a type
 * whose every non-absent arm is a tuple) or a list of points, and another
 * operand is a collection of numbers ({@link isNumberCollectionType}).
 *
 * The sum maps over the collection of numbers, and each element of the map is
 * the sum of a number and a point, which evaluates to an `incompatible-type`
 * error. For example, with `L := [0, 1, 2, 3]`, `L + (1, 1)` evaluates to a
 * list of four such errors. Without this rule, its type was the union
 * `tuple<integer, integer> | vector<integer^4>`, which says that the value is
 * a point or a list of integers, and no evaluation gives either.
 *
 * `canonicalAdd` (`boxed-expression/arithmetic-add.ts`) rejects the same sums
 * when the list is a list literal or a symbol with a DECLARED list type. It
 * does not reject a symbol whose type is only inferred or comes from its
 * value, because a later assignment can make it a list of points. The type is
 * read again after such an assignment, so this rule reads the operand types
 * as they are now.
 *
 * The static type is `error`, not `list<error>`: it is the type that the sum
 * of a list literal and a string (`[1, 2] + "a"`) has.
 */
export function addsPointToNumberCollection(
  operator: string,
  operandTypes: ReadonlyArray<Type>
): boolean {
  if (operator !== 'Add' && operator !== 'Subtract') return false;
  let point = false;
  let numbers = false;
  for (const t of operandTypes) {
    if (tupleCarrierType(t) || pointListElementType(t) !== undefined)
      point = true;
    else if (isNumberCollectionType(t)) numbers = true;
  }
  return point && numbers;
}

/**
 * Whether an application of `operator` to operands of `operandTypes` is one
 * of the point-arithmetic mistakes that `canonicalAdd` and `canonicalDivide`
 * reject at boxing, read from the operand types: a sum or difference of a
 * point (or a list of points) and a SCALAR number (`(1, 2) + 3` is an
 * `incompatible-type` error), and a quotient whose divisor is a point or a
 * list of points (`3 / (1, 2)` is the `no-division-by-point` error).
 *
 * Canonicalization rejects a scalar only when it is provably a number (a
 * literal or a declared symbol, not an inferred one), so the caller says
 * which operands count as scalars (`isScalar`). Used by the derivation from
 * argument types (`deriveApplicationType`), which types an application it
 * never canonicalizes and so must give the refusal that canonicalization
 * gives.
 */
export function isPointArithmeticError(
  operator: string,
  operandTypes: ReadonlyArray<Type>,
  isScalar: (i: number) => boolean
): boolean {
  const isPointOrPointList = (t: Type) =>
    tupleCarrierType(t) || pointListElementType(t) !== undefined;
  if (operator === 'Divide')
    return operandTypes.slice(1).some(isPointOrPointList);
  if (operator !== 'Add' && operator !== 'Subtract') return false;
  return (
    operandTypes.some(isPointOrPointList) &&
    operandTypes.some((t, i) => !isPointOrPointList(t) && isScalar(i))
  );
}

/**
 * Whether `type`, with its `missing` arm removed, is a list or an indexed
 * collection whose leaf elements are numbers: `list<integer>`,
 * `vector<integer^4>`, `matrix<real^(2x2)>`, `list<list<number>>` or
 * `indexed_collection<integer>`. A collection whose elements can be a tuple
 * (`list<number | tuple<…>>`), are unknown, or are `never` (an empty list)
 * does not qualify.
 */
function isNumberCollectionType(type: Type, seen?: AliasDescent): boolean {
  // The alias unfolds under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias (`type alias cyc = cyc | tuple<number, number>`,
  // `type alias nest = list<nest>`) stops when it reaches itself again.
  // Where the walk is cut it answers `false`, except for a union arm that
  // reaches its alias as a bare arm, with no constructor entered since the
  // alias was last unfolded: that arm is left out of the union, since its
  // values are those of the other arms. Without the guard the walk
  // overflows the stack.
  const unfolded = unfoldAliasOnDescent(type, seen);
  if (unfolded === undefined) return false;
  return isPresentNumberCollectionType(
    stripMissingFromType(unfolded.type, 'strip', unfolded.seen),
    unfolded.seen
  );
}

/**
 * {@link isNumberCollectionType} for a type `s` whose `missing` arms are
 * already removed. The walk below does not strip again: the strip unfolds
 * an alias with a `missing` arm in place, so a type stripped again at each
 * step of the walk would unfold a self-referential alias anew at each step,
 * and the descent guard would never count it. Only an alias reference that
 * the strip left in place is unfolded (and stripped) again, under the
 * guard.
 */
function isPresentNumberCollectionType(s: Type, seen: AliasDescent): boolean {
  if (typeof s === 'object' && s.kind === 'reference' && s.alias === true)
    return isNumberCollectionType(s, seen);
  // A type that is only `missing` leaves `never` once the `missing` arm is
  // removed. `never` is a subtype of every type, `list<number>` included, so
  // it must be excluded here: `Missing - (1, 2)` is an absent operand beside a
  // point, typed `missing | tuple<…>`, not a list of numbers beside a point.
  if (s === 'never') return false;
  // A union of numbers and collections of numbers with at least one
  // collection arm (`number | list<number>`): beside a point, every arm is
  // an error (a point plus a number, or a point plus a collection of
  // numbers), so the union counts. A union with no collection arm is a
  // plain number, which this predicate does not cover.
  if (typeof s === 'object' && s.kind === 'union') {
    const arms = s.types.filter((arm) => !isBareCutOnDescent(arm, seen));
    return (
      arms.some((arm) => isPresentNumberCollectionType(arm, seen)) &&
      arms.every(
        (arm) =>
          isPresentNumberCollectionType(arm, seen) ||
          (resolveTypeAlias(arm) !== 'never' && isSubtype(arm, 'number'))
      )
    );
  }
  // A bare spelling that names a list of numbers (`range`, a subtype of
  // `list<integer>`; not the bare `list`, whose elements are unknown).
  if (typeof s === 'string') return isSubtype(s, 'list<number>');
  if (s.kind !== 'list' && s.kind !== 'indexed_collection') return false;
  const element = unfoldAliasOnDescent(
    s.elements,
    descendIntoConstructor(seen)
  );
  if (element === undefined) return false;
  let el = stripMissingFromType(element.type, 'strip', element.seen);
  let elSeen = element.seen;
  // The strip keeps an alias with no `missing` arm by its name
  // (`lst | missing` strips to `lst`): read its definition.
  if (typeof el === 'object' && el.kind === 'reference' && el.alias === true) {
    const named = unfoldAliasOnDescent(el, elSeen);
    if (named === undefined) return false;
    el = named.type;
    elSeen = named.seen;
  }
  if (el === 'never') return false;
  if (
    typeof el !== 'string' &&
    (el.kind === 'list' || el.kind === 'indexed_collection')
  )
    return isPresentNumberCollectionType(el, elSeen);
  return isSubtype(el, 'number');
}

/**
 * Whether `param`, the declared type of a user-function parameter, declares a
 * POINT: a plain tuple type such as `tuple<real, real>` or
 * `tuple<broadcastable<number>, broadcastable<number>>`. A union (`tuple<…> |
 * list<tuple<…>>`) is not a point parameter: it already says what it admits.
 */
export function isPointParameterType(param: Type): boolean {
  const t = resolveTypeReference(param) ?? param;
  return typeof t !== 'string' && t.kind === 'tuple';
}

/**
 * Whether an argument of type `arg` is a LIST OF POINTS that a user function
 * whose parameter is declared as the point type `param` maps over: `arg` is a
 * finite-shaped indexed collection (a list, not a tuple) whose element type is
 * a subtype of `param`. For example, `list<tuple<real, real>>` (the type of
 * `PointList(x, y)` with `x` a list of reals and `y` a real) conforms to the
 * parameter `tuple<real, real>`.
 *
 * Such a call answers the list of the function's values at each point: the
 * application maps over the points, and each point is bound whole to the
 * parameter (user decision 2026-09-25). A list whose elements are not known
 * to be points (`list<real>`, `list<unknown>`) does not conform, and neither
 * does a type alone of `list<never>`: those are bound whole. A literal
 * empty `List` is recognized separately by argument validation and evaluation;
 * it maps to an empty result without invoking the function.
 *
 * A `missing` arm is removed from `arg` and from its element type first, as
 * the broadcast typing does: a restricted list of points (`(A, B)\{0 < t\}`,
 * typed `list<tuple<real, real>> | missing`) and a list that holds a
 * restricted point (`[(3, 4)\{0 < t\}, (6, 8)]`, typed
 * `list<missing | tuple<integer, integer>>`) conform. The map absorbs the
 * absence: an absent list makes the call `Missing`, and an absent point makes
 * that cell `Missing`.
 */
export function isPointListArgumentType(arg: Type, param: Type): boolean {
  if (!isPointParameterType(param)) return false;
  const stripped = stripMissingFromType(arg);
  const a = resolveTypeReference(stripped) ?? stripped;
  if (typeof a === 'string') return false;
  if (a.kind === 'tuple') return false;
  if (!isSubtype(a, INDEXED_COLLECTION_SHAPE_TYPE)) return false;
  // A `broadcastable<T>` is read by its `T` (`pointCollectionElementType`).
  const element = pointCollectionElementType(a);
  if (element === undefined) return false;
  const e = stripMissingFromType(element);
  if (e === 'never') return false;
  return isSubtype(e, param);
}

/**
 * True when `x` is a conditional value (`When`, `Which`, `If`), or a `List`,
 * `Tuple` or `Set` that holds one at any depth.
 *
 * The search operators (`Contains`, `IndexOf`, `Count`, `Element`,
 * `NotElement`) use it on the value they search for. If that value holds a
 * conditional value whose condition is not decided, the search stays
 * unevaluated, and gives the correct answer once the condition is decided
 * (user decision 2026-09-26). An `If` stays in an evaluated value only when
 * its condition is not decided, as a `When` and a `Which` do. Before `If` was
 * included, `IndexOf([1, 2], If(0 < t, 1, 3))` with `t` not known compared
 * the `If` node with the elements and gave `0`, and stayed `0` when `t`
 * became positive.
 */
export function holdsConditionalValue(x: Expression): boolean {
  if (!isFunction(x)) return false;
  const h = x.operator;
  if (h === 'When' || h === 'Which' || h === 'If') return true;
  if (h !== 'List' && h !== 'Tuple' && h !== 'Set') return false;
  return x.ops.some((op) => holdsConditionalValue(op));
}

/**
 * True when a "not a member" answer about `value` and the collection `xs` is
 * not settled yet, because an unknown could still make them match: `x ∈
 * [1, 2]` is true when `x` becomes 1. A structural match is always settled,
 * and an absent element (`Missing`, `Undefined`) matches only the same
 * marker, which is a structural match, so it never keeps the answer open.
 *
 * - A literal `List`, `Set` or `Tuple`: an element that is not the same
 *   expression as `value`, where either side has unknowns, keeps the answer
 *   open.
 * - A set named by a symbol (`EmptySet`, `Integers`), a `Range` and an
 *   `Interval` answer membership mathematically, so their "not a member" is
 *   settled.
 * - Any other collection (a lazy view such as `Take`, `Reverse`, `Filter`)
 *   compares structurally, so the answer stays open while `value` or the
 *   collection expression has unknowns (`1 ∈ Reverse([x, 2])`). Its elements
 *   are not read: walking a lazy collection again would run its callbacks
 *   again.
 *
 * This is for mathematical membership (`Element`). The search operators
 * `Contains`, `IndexOf` and `Count` compare structurally, like `===`, so an
 * unknown there is simply a different expression.
 */
export function searchMayStillMatch(
  xs: Expression,
  value: Expression
): boolean {
  if (
    isFunction(xs, 'List') ||
    isFunction(xs, 'Set') ||
    isFunction(xs, 'Tuple')
  )
    return xs.ops.some(
      (x) =>
        !isAbsentElement(x) &&
        !x.isSame(value) &&
        (x.unknowns.length > 0 || value.unknowns.length > 0)
    );
  if (isSymbol(xs) || isFunction(xs, 'Range') || isFunction(xs, 'Interval'))
    return false;
  // The unknowns of the collection expression are read from its structure;
  // the view is not walked.
  return value.unknowns.length > 0 || xs.unknowns.length > 0;
}

function isAbsentElement(x: Expression): boolean {
  return isSymbol(x, 'Missing') || isSymbol(x, 'Undefined');
}

/**
 * The operands of `expr` that are the SOURCES of the collection it produces:
 * the operands whose elements become (or decide) the elements of the result.
 * The other operands are not collections the result is built from: the
 * appended ELEMENTS of `Append`, the callback of `Map`, the predicate of
 * `Filter`, the callback and the seed of `Scan`.
 *
 * When the static type of a node is an abstract collection
 * (`collection<T>`, which admits a list, a set and a range), the kind of the
 * value of the node follows the values its abstract-typed SOURCES hold now.
 * Two predicates read that: `BoxedFunction.isIndexedCollection` (through
 * `abstractSourcesHoldIndexedValues`, `boxed-function.ts`) and the kind
 * predicates of `Join` and `Append` (`producesSet` and `producesKeyed`,
 * `boxed-expression/listed-element.ts`). They must read the same operands, so the
 * source positions are in this one table. For example `Append(acc, s)` with
 * `acc` holding `[[1], [1]]` and `s` holding `Set(2, 3)` is a list with the
 * set as its last element: `s` is an element, not a source, so it must not
 * make the result a set.
 *
 * An operator that is not in the table has every operand as a source. This
 * is correct for `Join` and `ListJoin`: every operand that is not atomic is
 * spliced, and an atomic (tuple) operand is typed as a tuple, never as an
 * abstract collection, so it is never read by the predicates.
 */
export function collectionSourceOperands(
  expr: Expression
): ReadonlyArray<Expression> {
  if (!isFunction(expr)) return [];
  switch (expr.operator) {
    // The source is the first operand. The other operands are elements
    // (`Append`), a predicate (`Filter`), or the callback and the seed
    // (`Scan`).
    case 'Append':
    case 'Filter':
    case 'Scan':
      return expr.ops.slice(0, 1);
    // The first operand of `Map` is the callback, and every other operand is
    // a mapped collection.
    case 'Map':
      return expr.ops.slice(1);
    // `Reduce` and `Fold` are not in the table: their value is the final
    // accumulator, whose kind the collection they walk does not decide.
    default:
      return expr.ops;
  }
}
