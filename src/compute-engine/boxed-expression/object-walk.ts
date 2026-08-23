/**
 * The **structural walk** over object values: the single mechanism behind
 * every conversion of an object to immutable data.
 *
 * Two consumers share it, which is why it lives in its own module: the
 * `.json` serialization of a `BoxedObject` (which wraps the record this walk
 * produces in an `["Object", …, "'TypeName'"]` provenance head), and — once
 * they land — the `DictionaryFrom(object)` operator arm and the serializer's
 * `objects:` option, which must produce a byte-identical record.
 *
 * Three properties are contractual (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B,
 * "Serialization"):
 *
 * - **Stored fields only, and structural — never enumerative.** A stored
 *   field may legitimately hold a lazy or non-finite collection (`Append([1,
 *   2], 3)` stays an `Append` node; `Repeat(0, ∞)` is an evaluated value).
 *   Enumerating one would run user callbacks or never finish, so the walk
 *   treats such a value as any other expression: its recipe serializes as-is
 *   and its operands are walked structurally. The walk therefore executes no
 *   user code and terminates on every value, all of which are finite
 *   expression trees once objects are handled below.
 * - **Back-edges become `CircularReference` markers.** The walk keeps its own
 *   explicit ancestor stack — the objects on the current path, in order — so
 *   that a back-edge can report how many levels up the chain it points. (The
 *   shared value-walk guard in `cycle-guard.ts` is a flag-only bitmask with no
 *   path tracking, so it can answer "already in progress" but not "how far
 *   up"; detection-only walks such as printing use it instead.)
 * - **Cross-edges duplicate.** A shared but acyclic reference has a perfectly
 *   good tree representation and is simply walked twice: two references to one
 *   object come back as two unrelated records. Only true cycles collapse into
 *   markers. This is a documented loss, together with nominal identity (the
 *   record itself is structural; the type name survives only in the `Object`
 *   provenance head and in the markers).
 *
 * The result is never memoized by any consumer: an object is mutable, so a
 * frozen serialization would go stale at the next store.
 *
 * ## Cost, and the one memo inside a walk
 *
 * "Cross-edges duplicate" is a statement about the RESULT, and it is what
 * makes the result potentially huge: an object graph where each of n objects
 * holds two references to the same next object has 2^n records in its tree
 * form, by construction. Nothing here can make that output smaller without
 * changing the specified shape. What it must not do is pay 2^n TIME to build
 * it, which is what a plain recursive walk does — it re-walks a shared
 * subgraph once per path that reaches it.
 *
 * So a subwalk that completed WITHOUT CUTTING A CYCLE is memoized by object
 * identity for the duration of ONE top-level walk, and the memoized record is
 * ALIASED into every place the object is reached from, not copied. A DAG
 * therefore costs time linear in the number of distinct objects while still
 * SERIALIZING as the duplicated tree: the result is deep-equal to what the
 * naive walk produces, and only its in-memory sharing differs. Callers must
 * treat the MathJSON this module returns as immutable — mutating one
 * duplicated record in place would show up in its twins.
 *
 * Three costs remain, deliberately. The OUTPUT of a wide cross-edge graph is
 * still exponential once it is stringified or deep-copied (that is the
 * documented fidelity choice, not an implementation artifact). A very deep
 * chain of objects still recurses on the host stack — a few frames per level,
 * with no depth cap. And a subgraph that carries a cycle is re-walked at every
 * occurrence rather than memoized, because reuse there would not be faithful
 * (`WalkState.markers` explains why); only the acyclic parts of such a graph
 * get the memo. A future `DictionaryFrom(object)` arm and the serializer's
 * `objects:` option inherit all three, since they must produce a
 * byte-identical record.
 */

import type { MathJsonExpression } from '../../math-json/types.js';
import type { Expression, ObjectInterface } from '../global-types.js';

import { anyObjectExists } from './object-deps.js';
import { isDictionary, isFunction, isObject } from './type-guards.js';

/**
 * Does `expr` transitively hold an object reference?
 *
 * Used to decide whether a value can serialize through its own `.json` (the
 * common case, which preserves every kind's own serialization: number
 * shorthands, `Rational` forms, dictionary shorthands) or must be rebuilt
 * operand-by-operand by the walk below so that the objects inside it are
 * converted with the ancestor stack in hand.
 *
 * The scan stops AT an object rather than descending into it, so it always
 * terminates: everything it does descend into (function operands, dictionary
 * values) is a finite tree. Kinds that cannot contain an expression (numbers,
 * strings, symbols) answer `false` immediately.
 *
 * Also the containment test the object-exclusion cache rule needs ("a cache
 * payload that transitively contains an object is not memoized").
 */
export function containsObject(expr: Expression | null | undefined): boolean {
  // One memo per question: a DAG-shared payload (operands referenced more
  // than once) must cost one visit per DISTINCT node, not one per path —
  // the cache commit points ask this about every payload they store, and an
  // unmemoized walk over a shared tree is exponential in its depth. The
  // allocation is skipped entirely in a session with no objects.
  if (!anyObjectExists()) return false;
  return containsObjectWith(expr, new Map());
}

/**
 * {@link containsObject} with an answer memo, keyed by expression identity and
 * valid for as long as the caller keeps the map.
 *
 * The walk below passes one so that asking about a node and then about each of
 * its children costs O(size) in total rather than O(size x depth): the
 * parent's scan already visited every descendant, and the memo is what lets
 * the children's queries reuse that visit. Callers that ask a single question
 * — the cache commit points — go through {@link containsObject} and allocate
 * nothing.
 */
function containsObjectWith(
  expr: Expression | null | undefined,
  memo: Map<Expression, boolean> | undefined
): boolean {
  // In a session that has never constructed an object, no value can contain
  // one, and the walk below can be skipped entirely. This matters because the
  // cache commit points call this on every payload they are about to store —
  // including materialized collections of arbitrary size — so without the
  // short-circuit the object rules would tax workloads that use no objects at
  // all. The flag is one-way (see `anyObjectExists`), so it can never hide a
  // containment that actually exists.
  if (!anyObjectExists()) return false;
  if (expr === null || expr === undefined) return false;

  const cached = memo?.get(expr);
  if (cached !== undefined) return cached;

  let result: boolean;
  if (isObject(expr)) result = true;
  else if (isFunction(expr))
    result = expr.ops.some((op) => containsObjectWith(op, memo));
  else if (isDictionary(expr))
    result = expr.values.some((v) => containsObjectWith(v, memo));
  else result = false;

  memo?.set(expr, result);
  return result;
}

/**
 * The state threaded through ONE top-level walk.
 *
 * `ancestors` is the objects on the current path, outermost first — the stack
 * a back-edge's depth is measured against. The rest is bookkeeping for the
 * memo described in the module header.
 */
type WalkState = {
  ancestors: ObjectInterface[];
  /** Subwalks already completed on this walk, by object identity. Only
   * CYCLE-FREE ones are entered — see `markers`. */
  done: Map<ObjectInterface, MathJsonExpression>;
  /** `containsObject` answers for the expressions this walk has scanned. */
  contains: Map<Expression, boolean>;
  /**
   * How many `CircularReference` markers this walk has emitted so far.
   * Sampled before and after each subwalk, and what decides whether that
   * subwalk may be reused: only one that emitted NO marker is memoized.
   *
   * The rule looks stricter than "the markers point below my own root" — and
   * is, deliberately. A subwalk of `x` that emitted no marker proves `x` sits
   * on no cycle, which in turn proves that no object inside it can ever be an
   * ANCESTOR at a later reuse site: an ancestor `y` inside `x`'s subtree would
   * mean both `x →* y` (it is in the subtree) and `y →* x` (the path runs
   * through it), i.e. a cycle through `x`, which the first walk would have cut
   * with a marker. That is what makes reuse exactly faithful — a fresh walk at
   * the reuse site would cut at that ancestor and produce a shallower tree,
   * and the memo would silently hand back a differently-unrolled one. A graph
   * that mixes cycles with sharing therefore keeps re-walking the subtrees
   * that carry the cycle; only its acyclic parts get the memo.
   */
  markers: number;
};

function newWalkState(ancestors: ObjectInterface[]): WalkState {
  return { ancestors, done: new Map(), contains: new Map(), markers: 0 };
}

/**
 * The full B5 serialization of an object:
 * `["Object", <record>, "'TypeName'"]`.
 *
 * The `Object` head is provenance, not an ascription: its static type is the
 * wrapped record's type and it evaluates transparently to that record. The
 * form is a **one-way door** — it parses back as a record under the
 * provenance head, never as an object; identity, sharing and conformances do
 * not survive.
 */
export function objectJson(obj: ObjectInterface): MathJsonExpression {
  return objectJsonWith(obj, newWalkState([]));
}

/** {@link objectJson} continuing an in-progress walk: a nested object must
 * inherit the walk state, or a back-edge deeper in the graph would be
 * measured against an empty path (and a cycle would not terminate). */
function objectJsonWith(
  obj: ObjectInterface,
  state: WalkState
): MathJsonExpression {
  const done = state.done.get(obj);
  if (done !== undefined) return done;

  const markersBefore = state.markers;

  const result = [
    'Object',
    objectRecordJsonWith(obj, state),
    `'${obj.typeName}'`,
  ] as MathJsonExpression;

  // Reusable only if this subwalk cut no cycle — see `WalkState.markers`. The
  // count is left as it is on the way out, so an enclosing subwalk that
  // contains this one inherits the fact.
  if (state.markers === markersBefore) state.done.set(obj, result);
  return result;
}

/**
 * The `["Dictionary", ["KeyValuePair", { str: "field" }, value], …]` body of
 * the walk — the exact shape `DictionaryFrom(object)` returns.
 *
 * The head is `Dictionary`, not `Record`: a record value in this engine IS a
 * dictionary whose keys are identifiers, and `Dictionary` is the operator that
 * builds one — re-boxing this form yields a `BoxedDictionary` whose type is
 * derived from its keys (`record{name: string, age: finite_integer}`), which is
 * what makes the `Object` provenance head's contract ("its static type is the
 * wrapped record's type") say something. There is no `Record` operator
 * definition anywhere in the engine, so a `["Record", …]` body re-boxed as an
 * inert application typed `unknown`.
 *
 * Entries use the `{ str: key }` key spelling — the same one the dictionary
 * branch of {@link walkValue} emits and the same one `BoxedDictionary.json`
 * emits for its operator form — so a re-boxed snapshot with expression-valued
 * fields re-serializes to the identical MathJSON. (An all-plain-data
 * dictionary re-serializes through the `{ dict: … }` shorthand instead, so
 * byte-identity across a round trip holds for the operator form only.)
 *
 * `ancestors` are the objects on the current walk path, outermost first;
 * callers starting a fresh walk pass `[]`. Each call starts a fresh subwalk
 * memo (see the module header): the memo is scoped to one top-level walk
 * because it holds records built from live slots.
 */
export function objectRecordJson(
  obj: ObjectInterface,
  ancestors: ObjectInterface[]
): MathJsonExpression {
  return objectRecordJsonWith(obj, newWalkState(ancestors));
}

/** {@link objectRecordJson} continuing an in-progress walk. */
function objectRecordJsonWith(
  obj: ObjectInterface,
  state: WalkState
): MathJsonExpression {
  state.ancestors.push(obj);
  try {
    const entries: MathJsonExpression[] = [];
    // The slot map is read directly rather than through `_field()`, so this
    // walk reports no read to the object-version dependency collector
    // (`object-deps.ts`). That is deliberate and safe only because the walk's
    // result is never memoized by anyone: a serialization of a mutable value
    // would go stale at the next store, so every consumer walks the live slots
    // afresh and there is no entry for a dependency to protect. A future
    // consumer that DID memoize a walk result would have to go through
    // `_field()` (or record the reads itself).
    for (const [key, value] of obj._slots)
      entries.push([
        'KeyValuePair',
        { str: key },
        walkValue(value, state, containsObjectWith(value, state.contains)),
      ] as MathJsonExpression);
    return ['Dictionary', ...entries] as MathJsonExpression;
  } finally {
    state.ancestors.pop();
  }
}

/**
 * Serialize one slot value, converting every object it holds.
 *
 * `contains` is the caller's already-computed `containsObject(value)` answer.
 * It is a parameter rather than a call here because the caller had to ask the
 * question anyway when it scanned this value's parent: recomputing it at each
 * level would make the walk O(size x depth) on the object-bearing part.
 */
function walkValue(
  value: Expression,
  state: WalkState,
  contains: boolean
): MathJsonExpression {
  const ancestors = state.ancestors;
  if (isObject(value)) {
    // A BACK-EDGE — the value is an object already on the current path — is
    // the only cycle a tree representation cannot express. `n` counts how
    // many levels up the ancestor chain it points (1 = this very object), and
    // the type name makes the marker loss-free: a future inverse could
    // reconstruct the loop from depth + type alone.
    const up = ancestors.lastIndexOf(value);
    if (up >= 0) {
      // Every subwalk this marker sits inside cut a cycle, and none of them
      // may be memoized (see `WalkState.markers`).
      state.markers += 1;
      return [
        'CircularReference',
        ancestors.length - up,
        `'${value.typeName}'`,
      ] as MathJsonExpression;
    }
    return objectJsonWith(value, state);
  }

  // A container holding an object must be rebuilt here rather than delegated
  // to its own `.json`: the delegate would start a FRESH walk with an empty
  // ancestor stack at each nested object, which both loses the depth a
  // back-edge marker needs and would not terminate on a cycle that runs
  // through the container. Containers with no object inside keep their own
  // serialization, which is richer than anything this walk could rebuild.
  if (contains) {
    if (isFunction(value))
      return [
        value.operator,
        ...value.ops.map((op) =>
          walkValue(op, state, containsObjectWith(op, state.contains))
        ),
      ] as MathJsonExpression;
    if (isDictionary(value))
      // The operator form, with `{ str }` keys — byte-identical to what
      // `BoxedDictionary.json` emits for a dictionary holding expressions, so
      // a dictionary field serializes the same way whether or not an object
      // happens to sit inside it.
      return [
        'Dictionary',
        ...value.entries.map(
          ([k, v]) =>
            [
              'KeyValuePair',
              { str: k },
              walkValue(v, state, containsObjectWith(v, state.contains)),
            ] as const
        ),
      ] as MathJsonExpression;
  }

  return value.json;
}
