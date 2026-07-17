import { widen, broadcastElementType } from '../common/type/utils.js';
import { isSubtype } from '../common/type/subtype.js';
import { Type } from '../common/type/types.js';
import { checkDeadline } from '../common/interruptible.js';
import { Expression, CollectionHandlers } from './global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
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

export function isFiniteIndexedCollection(col: Expression): boolean {
  return (col.isFiniteCollection ?? false) && col.isIndexedCollection;
}

/** Operators that construct a tuple. All canonicalize to `Tuple`. */
const TUPLE_OPERATORS = new Set(['Tuple', 'Pair', 'Triple', 'Single']);

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
  const t = expr.type.type;
  if (typeof t === 'string') return false;
  if (t.kind !== 'tuple') return false;
  return t.elements.every((el) => isSubtype(el.type, 'number'));
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
function couldBeNumericElement(el: Type): boolean {
  return (
    el === 'any' ||
    el === 'unknown' ||
    isSubtype(el, 'number') ||
    isSubtype('number', el) ||
    typeCouldBeNumericCollection(el) ||
    typeCouldBeNumericTuple(el)
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
export function typeCouldBeNumericCollection(type: Type): boolean {
  if (typeof type === 'string') {
    return (
      type === 'list' ||
      type === 'set' ||
      type === 'collection' ||
      type === 'indexed_collection'
    );
  }
  if (
    type.kind === 'collection' ||
    type.kind === 'indexed_collection' ||
    type.kind === 'list' ||
    type.kind === 'set'
  )
    return couldBeNumericElement(type.elements);
  // A `broadcastable<S>` operand COULD be a numeric indexed collection at
  // runtime. `broadcastable<any>`/`broadcastable<unknown>` qualify too; a
  // plainly non-numeric element (e.g. `broadcastable<string>`) does not.
  if (type.kind === 'broadcastable') {
    const el = type.elements;
    return (
      el === 'any' ||
      el === 'unknown' ||
      isSubtype(el, 'number') ||
      isSubtype('number', el)
    );
  }
  if (type.kind === 'union')
    return type.types.some((t) => typeCouldBeNumericCollection(t));
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
export function typeCouldBeNumericTuple(type: Type): boolean {
  if (typeof type === 'string') return type === 'tuple';
  if (type.kind === 'tuple')
    return type.elements.every((el) => couldBeNumericElement(el.type));
  if (type.kind === 'union')
    return type.types.some((t) => typeCouldBeNumericTuple(t));
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
  const t = expr.type.type;
  if (t === 'list' || t === 'collection' || t === 'indexed_collection')
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
  const t = expr.type.type;
  return (
    typeof t !== 'string' && t.kind === 'list' && t.dimensions !== undefined
  );
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

function dimensionlessIndexedElement(t: Type): Type | undefined {
  if (t === 'list' || t === 'indexed_collection') return 'any';
  if (typeof t === 'string') return undefined;
  if (t.kind === 'indexed_collection') return t.elements;
  // A `list` broadcasts only when it is unbounded/dimensionless (a plain
  // `list<E>`). A fixed shape (`vector<n>`, `matrix`) carries `dimensions` and
  // is left to tensor typing.
  if (t.kind === 'list')
    return t.dimensions === undefined ? t.elements : undefined;
  if (t.kind === 'union') {
    for (const b of t.types) {
      const e = dimensionlessIndexedElement(b);
      if (e !== undefined) return e;
    }
  }
  return undefined;
}

/**
 * True when `expr`'s collection-ness is **not statically visible**, so an
 * element-wise numeric operator (`Add`/`Multiply`) over it must produce a
 * `broadcastable<T>` result — the operand might broadcast at runtime (a
 * list-returning call) or stay scalar. The two triggering shapes are:
 *
 * - an **application** (function expression) with a top type
 *   (`unknown`/`any`/`value`) — a call whose collection-ness is entirely
 *   unknown (e.g. an undeclared function call `h(x)`); or
 * - an already-`broadcastable<…>` type — propagation through nested arithmetic
 *   (`Add(Multiply(2, h(x)), -1)`), including a symbol *declared*
 *   `broadcastable<…>`.
 *
 * Deliberately EXCLUDES a bare **symbol** with a top type: an undeclared
 * symbol types `unknown` only until the surrounding arithmetic's
 * `checkNumericArgs` infers it scalar-numeric, so treating it as
 * possibly-a-collection is order-dependent (`2x` on a cold engine would type
 * `broadcastable<number>` while a warm one gives `finite_number`) and
 * mis-routes the invisible-operator multiply-vs-Tuple gate (`6n`,
 * `(abc)(xyz)`). An application's top-typed result is never refined by
 * inference, so it genuinely may resolve to a collection at runtime. It also
 * excludes an inferred-`number` symbol: `Add(2, x)` stays `number` and
 * `Multiply(2, x)` stays `finite_number` (see the "non-interference with
 * scalars" pins in `list-broadcast-typing.test.ts`). Statically-visible
 * collection/tuple/tensor operands are handled by the dedicated branches that
 * fire before this predicate is consulted.
 */
export function isPossiblyCollectionTyped(expr: Expression): boolean {
  const t = expr.type.type;
  if (t === 'unknown' || t === 'any' || t === 'value') return isFunction(expr);
  return typeof t !== 'string' && t.kind === 'broadcastable';
}

/**
 * The `broadcastable<T>` result type of an element-wise numeric operator
 * (`Add`/`Multiply`) when at least one operand `isPossiblyCollectionTyped`.
 *
 * Each operand contributes a scalar element type: a `broadcastable<S>`
 * contributes `S`; a top `unknown`/`any`/`value` contributes `number`
 * (`Add`/`Multiply` are numeric, so the element-wise result over any valid
 * runtime operand is a number); a collection type contributes its
 * unwrapped scalar element (`broadcastElementType` — unions and collections
 * contribute their element, scalars themselves). The
 * widened element becomes the `broadcastable` element, with one adjustment: a
 * widened `imaginary` element becomes `finite_complex`, because sums and
 * products of imaginaries can cancel to a real (`i + i` … `i·i = −1`).
 */
export function broadcastableResultTypeOf(
  ops: ReadonlyArray<Expression>
): Type {
  const contributions = ops.map((op): Type => {
    const t = op.type.type;
    if (typeof t !== 'string' && t.kind === 'broadcastable') return t.elements;
    if (t === 'unknown' || t === 'any' || t === 'value') return 'number';
    // `broadcastElementType`, not `collectionElementType`: a union-typed
    // operand (e.g. a declared `number | list<number>` return) must
    // contribute its unwrapped scalar element, not the raw union — otherwise
    // the collection branch leaks into the broadcastable element
    // (`broadcastable<number | list<number>>`).
    return broadcastElementType(t);
  });
  let element = widen(...contributions);
  if (element === 'imaginary') element = 'finite_complex';
  return { kind: 'broadcastable', elements: element };
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
 * `docs/plans/2026-07-07-honest-list-broadcast-typing.md`), so it is not a
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
    if (!expr.operatorDefinition) return false;
    if (expr.operatorDefinition.inferredSignature) return false;
    return true;
  }

  return false;
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
  const t = expr.type.type;
  if (typeof t !== 'string' && t.kind === 'tuple') return true;
  if (isSymbol(expr)) {
    const v = expr.value;
    if (v !== undefined && !isSymbol(v)) {
      const vt = v.type.type;
      return typeof vt !== 'string' && vt.kind === 'tuple';
    }
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
  numericApproximation: boolean
): Expression | undefined {
  const isBroadcast = (x: Expression): boolean =>
    isFiniteIndexedCollection(x) && !isTuple(x);

  const cols = xs.filter(isBroadcast);
  if (cols.length === 0) return undefined;

  // Broadcast length = shortest participating collection. Bail (stay inert) if
  // any length is not statically known.
  let n = Infinity;
  for (const c of cols) {
    const len = c.count;
    if (len === undefined || len < 0) return undefined;
    if (len < n) n = len;
  }
  if (!Number.isFinite(n)) return undefined;

  const options = { numericApproximation };
  const results: Expression[] = [];
  for (let i = 1; i <= n; i++) {
    const args = xs.map((x) => (isBroadcast(x) ? (x.at(i) ?? ce.Nothing) : x));
    results.push(ce._fn(operator, args).evaluate(options));
  }
  return ce._fn('List', results);
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
    const iter = item.each();
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

  // Get the length of the shortest collection
  const shortest = Math.min(
    ...items.map((x) => (x.isCollection ? (x.count ?? 1) : Infinity))
  );

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
  const iterators = items.map((x) => (x.isCollection ? x.each() : repeat(x)));
  let count = 0;

  // Return an iterator that zips the items
  return {
    next() {
      if (count >= shortest) {
        return { done: true, value: undefined };
      }
      const values = iterators.map((x) => x.next());
      count += 1;
      return { done: false, value: values.map((x) => x.value!) };
    },
  };
}

function collectionSubset(
  a: Expression,
  b: Expression,
  strict: boolean
): boolean | undefined {
  if (a.isFiniteCollection !== true || b.isFiniteCollection !== true)
    return undefined;

  // All elements of a must be in b
  for (const x of a.each()) if (b.contains(x) !== true) return false;

  // A strict subset (a ⊂ b) must have at least one element that is not in b
  if (strict) {
    // a must not be equal to b, therefore their size must be different
    const aSize = a.count;
    if (aSize === undefined) return false;
    const bSize = b.count;
    if (bSize === undefined) return false;
    if (aSize === bSize) return false;
  }
  return true;
}

function basicCollectionIndexWhere(
  expr: Expression,
  predicate: (element: Expression) => boolean
): number | undefined {
  if (!isFunction(expr)) return undefined;
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
  // never-matching value in an infinite collection — aborts at `ce.timeLimit`
  // with the usual timeout `CancellationError` instead of hanging forever.
  const deadline = expr.engine._deadline;
  let i = 0;
  for (const op of expr.each()) {
    i += 1;
    if ((i & 0x3ff) === 0) checkDeadline(deadline);
    if (predicate(op)) return i;
  }

  return undefined;
}

function collectionContains(
  expr: Expression,
  target: Expression
): boolean | undefined {
  if (expr.isFiniteCollection !== true) return undefined;

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
  return {
    isLazy: (_expr) => false,

    count: (expr) => (isFunction(expr) ? expr.nops : 0),

    isEmpty: (expr) => !isFunction(expr) || expr.nops === 0,

    isFinite: (_expr) => true,

    contains: (expr, target) =>
      isFunction(expr) ? expr.ops.some((x) => x.isSame(target)) : false,

    iterator: (expr) => {
      if (!isFunction(expr))
        return { next: () => ({ value: undefined, done: true as const }) };
      let index = 1;
      const last = expr.nops;

      return {
        next: () => {
          if (index === last + 1)
            return { value: undefined, done: true as const };
          index += 1;
          return { value: expr.ops[index - 1 - 1], done: false as const };
        },
      };
    },

    subsetOf: collectionSubset,

    at: (expr: Expression, index: number | string): undefined | Expression => {
      if (typeof index !== 'number' || !isFunction(expr)) return undefined;
      if (index < 0) index = expr.nops + index + 1;
      if (index < 1 || index > expr.nops) return undefined;
      return expr.ops[index - 1];
    },

    indexWhere: basicCollectionIndexWhere,

    eltsgn: (_expr) => undefined,

    elttype: (expr) => {
      if (!isFunction(expr) || expr.nops === 0) return 'unknown';
      if (expr.nops === 1) return expr.ops[0].type.type;
      return widen(...expr.ops.map((op) => op.type.type));
    },
  };
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
        const count = def.count(expr);
        if (count === undefined) return undefined;
        return def.count(expr) === 0;
      }),
    isFinite:
      def.isFinite ??
      ((expr) => {
        const count = def.count(expr);
        if (count === undefined) return undefined;
        return Number.isFinite(count);
      }),
    subsetOf: def.subsetOf ?? collectionSubset,
  };
  if (def.isLazy) result.isLazy = def.isLazy;
  if (def.eltsgn) result.eltsgn = def.eltsgn;
  if (def.elttype) result.elttype = def.elttype;
  if (def.at) {
    result.at = def.at;
    result.indexWhere = def.indexWhere ?? collectionIndexWhere;
  }
  return result;
}
