import {
  widen,
  broadcastElementType,
  collectionElementType,
  resolveTypeForCompilation as resolveType,
  resolveTypeAlias,
  stripNumericRanges,
} from '../common/type/utils.js';
import { isSubtype, resolveTypeReference } from '../common/type/subtype.js';
import { reduceType } from '../common/type/reduce.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../common/type/primitive.js';
import { typeToString } from '../common/type/serialize.js';
import { Type } from '../common/type/types.js';
import { CancellationError, checkDeadline } from '../common/interruptible.js';
import { Expression, CollectionHandlers, Sign } from './global-types.js';
import type { MathJsonExpression } from '../math-json/types.js';
import {
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

export function isFiniteIndexedCollection(col: Expression): boolean {
  return (col.isFiniteCollection ?? false) && col.isIndexedCollection;
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
  isAcceptable: (ground: Expression) => boolean
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
 * Gated on the source being a definitively FINITE collection, mirroring those
 * operators' evaluate guards: on an infinite or unknown-finiteness source they
 * decline (or error), so there is no result to count and the honest answer is
 * `undefined` — not the source's `Infinity` (Tycho item-169 ruling: a count
 * nobody can walk is worse than no count).
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
  return xs.count;
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
 * A broadcast-eligible operand whose length is NOT a known-finite number: an
 * infinite collection (`Cycle`, whose `count` is `Infinity`), or one whose
 * count is statically unknown (`Filter`, or a symbolic-length `Range` whose
 * `isFiniteCollection` is `undefined`). These cannot be eagerly zipped or
 * materialized — the eager `zip`/`at` loops would truncate to a single element
 * (`zip` treats an undefined count as `1`) — so a broadcast over them must
 * produce the lazy `Map` form. Note that `Filter` reports `isFiniteCollection
 * === true` yet `count === undefined`, so the `count === undefined` clause is
 * load-bearing, not redundant.
 */
export function isUnknownLengthBroadcast(x: Expression): boolean {
  return (
    isBroadcastableCollection(x) &&
    (x.isFiniteCollection !== true || x.count === undefined)
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
  let first: number | undefined;
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
 * `isTuple`, which reads the type STRUCTURE and therefore sees neither the
 * bare `tuple` primitive nor a transparent alias for a tuple (`type pt =
 * tuple<number, number>`). Without that, a symbol declared `tuple` — which is
 * a collection, so it satisfies `isValuelessCollectionTyped` — would be
 * vetoed, and `[1, 2, 3] · r` would stop scaling the list by the tuple
 * component-wise the way it does for a tuple that has a value.
 */
function isUnresolvedCollectionShape(x: Expression): boolean {
  if (isTuple(x) || isTextAtom(x)) return false;
  const t = x.type.type;
  const resolved = resolveTypeReference(t) ?? t;
  if (isTupleShapedType(resolved)) return false;
  if (isValuelessCollectionTyped(x)) return true;
  return !x.isCollection && mayHoldAnIndexedCollection(resolved);
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
function mayHoldAnIndexedCollection(t: Type): boolean {
  if (typeof t === 'string') return false;
  if (t.kind === 'broadcastable') return true;
  if (t.kind !== 'union') return false;
  return t.types.some((branch) => {
    const b = resolveTypeReference(branch) ?? branch;
    if (isTupleShapedType(b) || isSubtype(b, 'string')) return false;
    return (
      isSubtype(b, INDEXED_COLLECTION_SHAPE_TYPE) ||
      mayHoldAnIndexedCollection(b)
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
 * A **numeric tuple** is a `Tuple`/`Pair`/`Triple` — type `tuple<number,…>` —
 * whose every element type is a subtype of `number`. These are treated as
 * points/vectors in ℝⁿ, semantically distinct from Lists (see
 * `docs/plans/2026-07-07-tuple-point-semantics.md`).
 *
 * Type-based, so it covers literal tuples AND symbols declared with a numeric
 * tuple type (e.g. `z: tuple<number, number>`).
 */
export function isNumericTuple(expr: Expression): boolean {
  // See `typeCouldBeNumericCollection` on why a transparent alias is unfolded
  // here and a nominal reference is not.
  const t = resolveTypeAlias(expr.type.type);
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
  // A union element COULD be numeric if any arm could (COULD-semantics).
  if (typeof el !== 'string' && el.kind === 'union')
    return el.types.some((t) => couldBeNumericElement(t));
  // Note: `signature`-kind elements deliberately do NOT qualify — a function
  // value is not a numeric component, and blessing its collection here would
  // leak numeric broadcast/tuple result types through the shared
  // `Add`/`Multiply` type handlers. The lenient treatment of a function
  // SYMBOL in numeric position (`2·N` stays symbolic) lives in
  // `checkNumericArgs`'s eager element walk instead (validate.ts).
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
export function typeCouldBeCollection(type: Type): boolean {
  // See `typeCouldBeNumericCollection` on why a transparent alias is unfolded
  // here and a nominal reference is not.
  type = resolveTypeAlias(type);
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
    return type.types.some((t) => typeCouldBeCollection(t));
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
export function typeCouldBeUnkeyedCollection(type: Type): boolean {
  // See `typeCouldBeNumericCollection` on why a transparent alias is unfolded
  // here and a nominal reference is not.
  type = resolveTypeAlias(type);
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
    return type.types.some((t) => typeCouldBeUnkeyedCollection(t));
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
export function typeCouldBeNumericCollection(type: Type): boolean {
  // A TRANSPARENT alias IS its definition, so unfold one before asking about
  // its kind: `isSubtype` unfolds an alias reference on both sides, and a
  // gate that reads `type.kind` directly must agree with it or an alias of a
  // collection is admitted at one layer and refused at the other. A NOMINAL
  // reference is left alone — it is deliberately not a subtype of its
  // definition, so it must keep failing this gate.
  type = resolveTypeAlias(type);
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
    return couldBeNumericElement(type.elements);
  // A `broadcastable<S>` operand COULD be a numeric indexed collection at
  // runtime. `broadcastable<any>`/`broadcastable<unknown>` qualify too; a
  // plainly non-numeric element (e.g. `broadcastable<string>`) does not.
  //
  // Decided by the SAME element predicate the collection kinds above use, for
  // the same reason: the base `S` is whatever the un-lifted expression typed,
  // and `broadcastable<S>` means "an `S`, or an indexed collection of `S`", so
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
    return couldBeNumericElement(type.elements);
  if (type.kind === 'union')
    return type.types.some((t) => typeCouldBeNumericCollection(t));
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
 * stay in lockstep. Used by `checkNumericArgs` (`validate.ts`) to reject a
 * statically non-numeric collection operand of a threadable numeric operator
 * (`Add`/`Multiply`/…) *without walking its elements* — the element type
 * already disproves numericity.
 */
export function typeIsProvablyNonNumericCollection(type: Type): boolean {
  // See `typeCouldBeNumericCollection` on why a transparent alias is unfolded
  // here and a nominal reference is not.
  type = resolveTypeAlias(type);
  if (typeof type === 'string') return false; // bare kind: could be numeric
  if (
    type.kind === 'collection' ||
    type.kind === 'indexed_collection' ||
    type.kind === 'list' ||
    type.kind === 'set'
  ) {
    const el = type.elements;
    if (el === 'any' || el === 'unknown') return false;
    return !couldBeNumericElement(el);
  }
  // Expressed as the exact negation of the companion so the two cannot drift:
  // the companion's broadcastable arm already returns `true` for
  // `any`/`unknown` elements and for a collection- or tuple-typed base.
  if (type.kind === 'broadcastable') return !typeCouldBeNumericCollection(type);
  // A union is provably non-numeric only if EVERY member is (any could-be-
  // numeric member keeps the whole union admissible).
  if (type.kind === 'union')
    return type.types.every((t) => typeIsProvablyNonNumericCollection(t));
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
  // See `typeCouldBeNumericCollection` on why a transparent alias is unfolded
  // here and a nominal reference is not.
  type = resolveTypeAlias(type);
  if (typeof type === 'string') return type === 'tuple';
  if (type.kind === 'tuple')
    return type.elements.every((el) => couldBeNumericElement(el.type));
  if (type.kind === 'union')
    return type.types.some((t) => typeCouldBeNumericTuple(t));
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
export function typeCouldBeNumericTupleCollection(type: Type): boolean {
  // See `typeCouldBeNumericCollection` on why a transparent alias is unfolded
  // here and a nominal reference is not.
  type = resolveTypeAlias(type);
  if (typeof type === 'string') return false;
  if (type.kind === 'union')
    return type.types.some((t) => typeCouldBeNumericTupleCollection(t));
  if (
    type.kind === 'list' ||
    type.kind === 'indexed_collection' ||
    type.kind === 'collection'
  )
    return typeCouldBeNumericTuple(type.elements);
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
  // See `typeCouldBeNumericCollection` on why a transparent alias is unfolded
  // here and a nominal reference is not.
  const t = resolveTypeAlias(expr.type.type);
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
  // An index span is dimensionless and its elements are finite positive
  // integers — a known element type, unlike the bare types above.
  if (t === 'range') return 'integer';
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
  if (typeof t === 'string' || t.kind !== 'union') return t as Type;
  const branches = t.types.filter(
    (b) => dimensionlessIndexedElement(b) !== undefined
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
 */
function rewrapCollectionBranch(branch: Type, elements: Type): Type {
  if (branch === 'list') return { kind: 'list', elements };
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
 * scalar `T` or an indexed collection of `T` — so it contributes an
 * `indexed_collection<T>` collection branch AND the scalar side. Keeping only
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
  if (typeof t === 'string' || t.kind !== 'union') return undefined;
  const collections: Type[] = [];
  let hasScalarBranch = false;
  for (const b of t.types) {
    if (dimensionlessIndexedElement(b) !== undefined) collections.push(b);
    else if (typeof b !== 'string' && b.kind === 'broadcastable') {
      collections.push({ kind: 'indexed_collection', elements: b.elements });
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
 * collection half is an indexed collection of `T`.
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
    for (const b of branches) wrapped.push(rewrapCollectionBranch(b, element));
  }
  if (wrapped.length === 0) return undefined;
  return reduceType({ kind: 'union', types: [element, ...wrapped] });
}

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
 * Deliberately EXCLUDES a bare **symbol** with a top type: an undeclared
 * symbol types `unknown` only until the surrounding arithmetic's
 * `checkNumericArgs` infers it scalar-numeric, so treating it as
 * possibly-a-collection is order-dependent (`2x` on a cold engine would type
 * `broadcastable<number>` while a warm one gives `number`) and
 * mis-routes the invisible-operator multiply-vs-Tuple gate (`6n`,
 * `(abc)(xyz)`). An application's top-typed result is never refined by
 * inference, so it genuinely may resolve to a collection at runtime. It also
 * excludes an inferred-`number` symbol: `Add(2, x)` stays `number` and
 * `Multiply(2, x)` stays `number` (see the "non-interference with
 * scalars" pins in `list-broadcast-typing.test.ts`). Statically-visible
 * collection/tuple/tensor operands are handled by the dedicated branches that
 * fire before this predicate is consulted.
 */
export function isPossiblyCollectionTyped(expr: Expression): boolean {
  // Resolve a transparent alias BEFORE the top-type test, so an alias whose
  // body is a top type takes the application check like the bare spelling.
  const t = resolveTypeAlias(expr.type.type);
  if (t === 'unknown' || t === 'any' || t === 'value') return isFunction(expr);
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
 * widened `imaginary` element becomes `complex`, because sums and
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
  // Strip range/sign decorations before the join: an arithmetic result
  // does not lie in the union of its operands' ranges (`stripNumericRanges`).
  let element = widen(...contributions.map((t) => stripNumericRanges(t)));
  if (element === 'imaginary') element = 'complex';
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
 * Shape exclusions must use this rather than `matches('tuple')`: since the
 * bare-synonym ruling (2026-08-17) bare `tuple` is values-only, so an
 * absence-slotted tuple (`tuple<integer, missing>`) does NOT match it — and
 * there is no `tuple<any>` family-top spelling (a `tuple<any>` is a 1-tuple
 * whose slot is `any`). A gate that means "tuples are atomic, never mapped
 * over" must therefore recognize the KIND, not the values-only subtype.
 */
export function isTupleShapedType(t: Type): boolean {
  return t === 'tuple' || (typeof t === 'object' && t.kind === 'tuple');
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
  return t === 'record' || (typeof t === 'object' && t.kind === 'record');
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
export function isShapedNumericType(t: Type): boolean {
  t = resolveTypeAlias(t);
  if (typeof t === 'string')
    return (
      t === 'tuple' ||
      t === 'list' ||
      t === 'collection' ||
      t === 'indexed_collection' ||
      t === 'set'
    );
  if (t.kind === 'union') return t.types.some((a) => isShapedNumericType(a));
  if (t.kind === 'broadcastable') return isShapedNumericType(t.elements);
  return (
    t.kind === 'tuple' ||
    t.kind === 'list' ||
    t.kind === 'collection' ||
    t.kind === 'indexed_collection' ||
    t.kind === 'set'
  );
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
  const elt = collectionElementType(resolveType(expr.type.type));
  // `'tuple'` (the bare, unparameterized type name) is a plain string, not a
  // `{ kind: 'tuple' }` node, and it is what a `list<tuple>` declaration
  // reports — both spellings must read as a point.
  if (
    elt !== undefined &&
    (elt === 'tuple' || (typeof elt !== 'string' && elt.kind === 'tuple'))
  )
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
    const len = c.count;
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
  if (allowLazy && n > MAX_SIZE_EAGER_COLLECTION)
    return lazyBroadcastMap(
      ce,
      operator,
      xs,
      isBroadcast,
      numericApproximation,
      strictLengths
    );

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
 * the body becomes `Apply(⟨literal⟩, …)` instead of `operator(…)`, and `Apply`
 * binds every argument WHOLE — so a nested-collection element is passed to the
 * function intact instead of re-entering the broadcast gate by name and
 * descending another rank. Without it a lazified declared broadcast would
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
      params.push(
        t === undefined
          ? p
          : ce._fn('Typed', [p, ce.string(typeToString(t))], {
              canonical: false,
            })
      );
      bodyArgs.push(p);
      cols.push(x);
    } else {
      bodyArgs.push(x);
    }
  }

  let body = callee
    ? ce._fn('Apply', [callee, ...bodyArgs], { canonical: false })
    : ce._fn(operator, bodyArgs, { canonical: false });
  // When a numeric approximation was requested (`.N()`), wrap each element's
  // body in `N(…)` so it floats on access — otherwise a lazy element would
  // evaluate EXACTLY (e.g. `Sin(Range(1,1e8)).N()` element 1 → symbolic
  // `sin(1)` instead of `0.841…`). The body is built fresh here, so there is
  // no risk of double-wrapping on re-evaluation of the returned `Map`.
  if (numericApproximation) body = ce._fn('N', [body], { canonical: false });
  const fn = ce.function('Function', [body, ...params]);
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
    if (
      x.isFiniteCollection === true &&
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
 * the body in `N` only when the broadcast is CONSTRUCTED under `.N()`).
 *
 * Return a `Map` over the same sources whose mapping-function body is wrapped
 * in `N(…)`, so every element numericizes on access — laziness preserved.
 * Returns `undefined` when `expr` is not such a `Map`, or its body is already
 * `N`-wrapped (idempotence: `x.N().N()` must not grow the wrapping).
 *
 * The rewrap is **memoized per original instance**: repeated `.N()` calls on
 * one logical `Map` return the *same* rewrapped instance, so any per-instance
 * state keyed on the rewrapped `Map` (the auto-compile cache in
 * `library/map-auto-compile.ts`) survives across top-level drains. The rewrap
 * is purely structural (built from `fn.json`), so the memo needs no
 * invalidation. Per-instance semantics stay as item 40 ratified: a `subs()`
 * or re-boxed copy is a new original and runs cold.
 */
const lazyMapNRewraps = new WeakMap<Expression, Expression>();

export function lazyMapNumericApproximation(
  ce: Expression['engine'],
  expr: Expression
): Expression | undefined {
  const memo = lazyMapNRewraps.get(expr);
  if (memo !== undefined) return memo;
  if (!isFunction(expr, 'Map')) return undefined;
  const fn = expr.op1;
  if (!isFunction(fn, 'Function') || fn.nops < 1) return undefined;

  // Wrap the body INSIDE the canonical `Block` wrapper: `Block` evaluates its
  // result without propagating the approximation flag, so `N(Block(sin(_)))`
  // stays exact — the `N` must sit directly on the returned expression.
  let body: Expression = fn.op1;
  if (isFunction(body, 'Block') && body.nops === 1) body = body.op1;
  // Idempotence: the body already numericizes.
  if (body.operator === 'N') return undefined;

  // Rebuild the function literal from MathJSON rather than re-hosting the
  // canonical body: a canonical body is bound into the ORIGINAL literal's
  // parameter scope, and grafting it under a new `Function` would split the
  // bindings between the old and new scopes.
  const fnJson = fn.json;
  if (!Array.isArray(fnJson)) return undefined;
  const wrappedFn = ce.box([
    'Function',
    ['N', body.json],
    ...fnJson.slice(2),
  ] as MathJsonExpression);
  if (!wrappedFn.isValid) return undefined;
  const rewrapped = ce.function('Map', [wrappedFn, ...expr.ops.slice(1)]);
  lazyMapNRewraps.set(expr, rewrapped);
  return rewrapped;
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
      const n = p.src.count;
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
      const n = p.src.count;
      if (n === undefined) return undefined;
      return windowCount(p, n) === 0;
    },
    at: (expr, index) => {
      if (typeof index !== 'number' || index < 1) return undefined;
      const p = getParams(expr);
      if (p === undefined) return undefined;
      const { src, size, step, keepPartial } = p;
      const n = src.count;
      if (n === undefined) return undefined;
      const start = (index - 1) * step + 1;
      const end = start + size - 1;
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
 */
function zipParticipates(x: Expression): boolean {
  return x.isCollection && !isTextAtom(x);
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

  // Get the length of the shortest collection
  const shortest = Math.min(
    ...items.map((x) => (zipParticipates(x) ? (x.count ?? 1) : Infinity))
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
function shapeIncludedIn(a: TypeSaturatedSet, b: TypeSaturatedSet): boolean {
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

  if (a.isFiniteCollection !== true) return undefined;
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
  // never-matching value in an infinite collection — aborts at the active
  // `withTimeLimit` span deadline, if any
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
  count: (expr: Expression) => number | undefined,
  expr: Expression
): number | undefined {
  try {
    return count(expr);
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
        return Number.isFinite(count);
      }),
    subsetOf: def.subsetOf ?? collectionSubset,
  };
  if (def.isCollection) result.isCollection = def.isCollection;
  if (def.isEnumerable) result.isEnumerable = def.isEnumerable;
  if (def.isLazy) result.isLazy = def.isLazy;
  if (def.elementMemo) result.elementMemo = def.elementMemo;
  if (def.eltsgn) result.eltsgn = def.eltsgn;
  if (def.elttype) result.elttype = def.elttype;
  if (def.at) {
    result.at = def.at;
    result.indexWhere = def.indexWhere ?? collectionIndexWhere;
  }
  return result;
}
