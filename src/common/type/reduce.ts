import { makeNumericRangeType } from './numeric-range.js';
import { typeToDedupKey, typeToString } from './serialize.js';
import {
  asNumericRange,
  assertGroundType,
  couldMatch,
  isEmptyType,
  isSubtype,
  meetNumericRangeMembers,
  provablyDisjoint,
  meetPrimitiveTypes,
} from './subtype.js';
import type {
  Type,
  PrimitiveType,
  NumericType,
  AlgebraicType,
  CollectionType,
  ListType,
  SetType,
  BroadcastableType,
  TupleType,
  NamedElement,
  FunctionSignature,
  NegationType,
  DictionaryType,
  RecordType,
  ObjectType,
  TypeReference,
} from './types.js';
import { isValidPrimitiveType } from './primitive.js';
import { normalizeStatedEffectSet } from './effects.js';
import { unfoldAliasOnDescent, type AliasDescent } from './utils.js';
import { aliasDefinitionAt } from './instantiate.js';
import { declarationOf } from './reference.js';

/**
 * Reduce the input type
 *
 * For example:
 * - `number | integer` -> `number`
 * - `set<integer | integer>` -> `set<integer>`
 *
 * @param type
 * @returns
 */
export function reduceType(type: Type): Type {
  if (typeof type === 'string') {
    if (!isValidPrimitiveType(type as PrimitiveType)) return 'error';
    // Valid primitive types are already reduced
    return type;
  }

  switch (type.kind) {
    case 'union':
      return reduceUnionType(type);

    case 'intersection':
      return reduceIntersectionType(type);

    case 'negation':
      return reduceNegationType(type);

    case 'collection':
    case 'indexed_collection':
      return reduceCollectionType(type.kind, type);

    case 'list':
      return reduceListType(type);

    case 'set':
      return reduceSetType(type);

    case 'broadcastable':
      return reduceBroadcastableType(type);

    case 'tuple':
      return reduceTupleType(type);

    case 'record':
      return reduceRecordType(type);

    case 'object':
      return reduceObjectType(type);

    case 'dictionary':
      return reduceDictionaryType(type);

    case 'signature':
      return reduceSignatureType(type);

    case 'value':
      return type;

    case 'reference':
      return type;

    case 'numeric':
      // A bounded numeric range whose lower bound exceeds its upper bound is
      // empty. (`integer<0..10>` and friends predate this switch; without a
      // case here every number-set `contains` handler — reached via
      // `library/sets.ts` `typeIntersection` — crashed with "Unknown type
      // kind".)
      if (
        type.lower !== undefined &&
        type.upper !== undefined &&
        type.lower > type.upper
      )
        return 'never';
      return type;

    case 'symbol':
      return type;

    case 'expression':
      return type;

    // A type variable is ATOMIC and OPAQUE, like `broadcastable`: never
    // collapsed, never distributed, never merged with anything.
    case 'variable':
      return type;

    default:
      throw new Error(`Unknown type kind: ${type}`);
  }
}

/**
 * The type of a sum or a product, given the join `t` of its operands' types.
 *
 * Neither a sum nor a product is closed over `imaginary`: `i + (−i) = 0` and
 * `i · i = −1` are real, and `1 + i` (an integer plus an imaginary number) is
 * neither real nor imaginary. A join of the operand types that holds an
 * imaginary type therefore does not hold every result. This function replaces
 * each imaginary member of `t` with `complex`, which holds all of them:
 *
 * - `imaginary`, and any other type that is a subtype of `imaginary` (a
 *   literal imaginary value), becomes `complex`;
 * - in a union, each member that is a subtype of `imaginary` becomes
 *   `complex`, and the union is then reduced, so that a member which is now a
 *   subtype of `complex` is absorbed: `imaginary | integer` is `complex`,
 *   `imaginary | nan` is `complex | nan`, `imaginary | infinity` is
 *   `complex | infinity`;
 * - a transparent alias is replaced by its closed definition when the
 *   definition has an imaginary member: for `type alias imu = imaginary |
 *   integer`, `imu` becomes `complex`. The alias name is not kept, because
 *   it no longer describes the result.
 *
 * A union is reduced, not widened: `widen` would join `complex` and `nan` to
 * `number`, which also admits `±∞` and `~oo`.
 *
 * A type with no imaginary member is returned unchanged, as the same object.
 * The function does not descend into a collection, a tuple or a
 * `broadcastable<…>` type: the caller applies it to the scalar join of each
 * cell or component.
 *
 * An alias is unfolded under the descent guard (`unfoldAliasOnDescent`), so
 * that a self-referential alias (`type alias cyc = cyc | imaginary`) stops
 * when it reaches itself again. Such an occurrence is a bare arm of the
 * alias's own union, because the function does not enter a constructor, and
 * it adds no value of its own: it is kept unchanged. The other arms are
 * closed, so the result still holds every sum and every product.
 */
export function closeImaginaryUnderArithmetic(
  t: Type,
  seen: AliasDescent = undefined
): Type {
  if (typeof t === 'string') return t === 'imaginary' ? 'complex' : t;
  if (t.kind === 'union') {
    let changed = false;
    const members = t.types.map((m) => {
      const r = closeImaginaryUnderArithmetic(m, seen);
      if (r !== m) changed = true;
      return r;
    });
    return changed ? reduceType({ kind: 'union', types: members }) : t;
  }
  if (t.kind === 'reference' && t.alias === true && t.def !== undefined) {
    const unfolded = unfoldAliasOnDescent(t, seen);
    if (unfolded === undefined) return t;
    const closed = closeImaginaryUnderArithmetic(unfolded.type, unfolded.seen);
    return closed === unfolded.type ? t : closed;
  }
  // An open type variable stands for an unknown type, and `isSubtype` must
  // not see one: it is returned unchanged.
  if (t.kind === 'variable') return t;
  return isSubtype(t, 'imaginary') ? 'complex' : t;
}

/** The shape of a list as a comparison key: its lengths, with a dimension
 * variable's name standing in for the `-1` it rides on, so two patterns that
 * differ only in WHICH variable names an axis are not merged. */
function shapeKey(t: ListType): string {
  if (t.dimensions === undefined) return '';
  return t.dimensions
    .map((d, i) => t.dimensionVariables?.[i] ?? String(d))
    .join();
}

function decorate(t: Type): Type {
  if (typeof t !== 'object') return t;

  // Cached/shared types (e.g. memoized `parseType()` results) are frozen and
  // cannot be decorated; already-decorated types are left as-is (the
  // decoration is non-configurable, so redefining it would throw).
  if (Object.isFrozen(t) || Object.prototype.hasOwnProperty.call(t, 'toString'))
    return t;

  Object.defineProperty(t, 'toString', { value: () => typeToString(t) });

  return t;
}

/**
 * True when `t` carries a STATED-pure arrow (`effects: []`) anywhere in its
 * structure — exactly the case where its serialization differs from its
 * de-duplication key, since the key is what elides the ` pure` token.
 */
function carriesStatedPure(t: Type): boolean {
  if (typeof t === 'string') return false;
  return typeToString(t) !== typeToDedupKey(t);
}

/**
 * Record `member` into `result`, merging it with an equal member that was
 * already seen. `key` MUST be `typeToDedupKey(member)` — the tie-break below
 * reuses it instead of re-serializing.
 *
 * The two spellings of ∅ share a de-duplication key, so a bare arrow and its
 * stated-pure twin COLLIDE. Keeping "first seen" would make the reduced
 * serialization depend on member ORDER — contradicting the insertion-order
 * independence union reduction guarantees (SYM P2-20) — and would silently
 * erase an `effects: []`, and with it the `effectsDeclared` a declaration
 * derives from a reduced type.
 *
 * The deterministic tie-break: the member that CARRIES a stated `[]` wins, so
 * `(integer) pure -> integer` survives in either order. Residual, deliberately
 * accepted: when BOTH colliding members carry a marker (stated `[]` at
 * *different* positions inside the type) the first such member is kept — a
 * recursive per-arrow spelling merge is overkill for a pair that already
 * denotes the same type, and the rule stays deterministic either way.
 *
 * Collisions are the common case (`integer | integer`), so the tie-break is
 * ordered to cost nothing on the path that has no stated `pure` to preserve:
 * a primitive member exits on the `typeof` test, and any other member on the
 * key comparison, which re-uses the key already in hand. Only when the
 * INCOMING member carries a marker is the stored one serialized.
 */
function addDedupedMember(
  result: Type[],
  seen: Map<string, number>,
  key: string,
  member: Type
): void {
  const at = seen.get(key);
  if (at === undefined) {
    seen.set(key, result.length);
    result.push(member);
    return;
  }
  if (
    typeof member !== 'string' &&
    typeToString(member) !== key &&
    !carriesStatedPure(result[at])
  )
    result[at] = member;
}

function reduceNegationType(type: NegationType): Type {
  const reducedType = reduceType(type.type);

  // Complement of the bottom type `never` is the top type `any`.
  // (SYM P2-21: `!never → any` — previously left unreduced.)
  if (reducedType === 'never') return 'any';

  // Complement of the top type `any` is the bottom type `never`.
  // (SYM P2-21: this previously returned `nothing`, the *unit* type,
  // conflating "no value at all" (`never`, the bottom) with "the single
  // `Nothing` value" (`nothing`, the unit). The complement of *everything* is
  // *nothing at all* = `never`.)
  if (reducedType === 'any') return 'never';

  // Complement of the unit type `nothing` is "every value except `Nothing`".
  // That set is not representable as a single primitive, and widening it to
  // `any` (the previous behavior) is unsound — it would make
  // `nothing <: !nothing` hold. We instead keep it as an explicit negation so
  // the subtype machinery (`provablyDisjoint`) can still exclude the unit
  // value. (SYM P2-21.)

  return decorate({ kind: 'negation', type: reducedType });
}

/**
 * Recursively flatten nested unions and reduce + structurally de-duplicate the
 * members. `(a | (b | c))` and `((a | b) | c)` yield the same flat member list,
 * so union reduction and its canonical member order (SYM P2-20) are
 * independent of how the union object was constructed.
 */
function flattenUnionMembers(types: Readonly<Type[]>): Type[] {
  const result: Type[] = [];
  const seen = new Map<string, number>();
  const add = (t: Type): void => {
    if (typeof t === 'object' && t.kind === 'union') {
      for (const m of t.types) add(m);
      return;
    }
    // De-duplicate by `typeToDedupKey`: `(integer) pure -> integer` and
    // `(integer) -> integer` are the same type (one is the stated spelling of
    // ∅), so they merge — order-independently, see `addDedupedMember`.
    addDedupedMember(result, seen, typeToDedupKey(t), t);
  };
  for (const t of types) add(reduceType(t));
  return result;
}

/**
 * Canonical total order over union members (SYM P2-20). We order members
 * lexicographically by their serialized form — a deterministic total order
 * that makes the reduced union's `.type` string independent of member
 * insertion order (so documented branch-on-`.type`-string usage is stable:
 * `[1, "a"]` and `["a", 1]` now infer the *same* union string). Chosen over a
 * lattice-rank order because it is total, cheap, and needs no tie-breaking.
 */
function sortUnionMembers(members: Type[]): Type[] {
  return members
    .map((t) => [typeof t === 'string' ? t : typeToString(t), t] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, t]) => t);
}

function reduceUnionType(type: AlgebraicType): Type {
  const reducedTypes = flattenUnionMembers(type.types);

  if (reducedTypes.length === 0) return 'never';

  if (reducedTypes.some((type) => type === 'error')) return 'error';

  if (reducedTypes.length === 1) return decorate(reducedTypes[0]!); // "boolean | boolean" -> "boolean"

  // A union keeps the *supertype* of any subtype-related pair, e.g.
  // `integer | number` reduces to `number`. If `current` is already
  // covered by an existing (super)type, drop it; otherwise drop any
  // existing types that `current` subsumes, then add `current`.
  const acc: Type[] = [];
  for (const current of reducedTypes) {
    const coveredBy = acc.findIndex((t) => isSubtype(current, t));
    if (coveredBy !== -1) continue;
    for (let i = acc.length - 1; i >= 0; i--)
      if (isSubtype(acc[i], current)) acc.splice(i, 1);
    acc.push(current);
  }

  if (acc.length === 1) return decorate(acc[0]);
  return decorate({ kind: 'union', types: sortUnionMembers(acc) });
}

/**
 * The *meet* (intersection) of two types.
 *
 * - For subtype-related pairs, the narrower type.
 * - For incomparable but overlapping *primitive* pairs, the meet in the
 *   primitive lattice (see `meetPrimitiveTypes`). When the maximal common
 *   subtypes are incomparable, the meet is their union. The numeric tower is
 *   a chain (`integer ⊂ rational ⊂ real ⊂ complex`), so `real ∧ complex` =
 *   `real`; a union-meet arises only for genuinely incomparable pairs, such
 *   as a collection type met with a scalar one.
 * - Unions (which can arise from previous meets) distribute:
 *   `(a | b) ∧ c` = `(a ∧ c) | (b ∧ c)`.
 * - Two applications of the same collection constructor meet ELEMENTWISE
 *   (see {@link meetCollections}); the pair is not empty, because the empty
 *   collection inhabits both.
 * - Collections of different kinds, and a list with dimensions beside one
 *   with none, meet elementwise too ({@link meetCollectionKinds},
 *   {@link meetShapedWithUnshapedList}), but a list whose length is fixed
 *   and not zero has no value when the element meet is empty.
 * - A pair no rule above applies to yields `undefined`, meaning "no meet
 *   rule, and not shown to be empty either": an overload pair
 *   ({@link isOverloadPair}), a pair that can share a matrix by different
 *   readings, a transparent alias that is cut on a recursion or beside
 *   another alias, and an operand that is itself a kept intersection, each
 *   unless {@link provablyDisjoint} refutes it. Everything else collapses
 *   to `never`. Callers
 *   decide what an irreducible pair becomes — {@link reduceIntersectionType}
 *   keeps both members, {@link meetUnion} keeps the pair as one union member.
 *
 * The `undefined` is what keeps "I have no rule" distinguishable from a
 * computed answer: an earlier design returned the irreducible pair as an
 * `{ kind: 'intersection' }` object and let callers detect it by kind, but
 * `meetUnion` can legitimately RETURN such an object (its single surviving
 * member), so callers read a fully-computed meet as a give-up marker and
 * discarded it — `(list<integer> | integer) & list<string>` came back with
 * the union never distributed.
 */
function meet2(a: Type, b: Type): Type | undefined {
  // Dev tripwire (§4.2): the algebra helpers never see an OPEN type.
  assertGroundType('meet', a);
  assertGroundType('meet', b);
  if (isSubtype(a, b)) return a;
  if (isSubtype(b, a)) return b;

  // A transparent alias is met through its definition, unfolded at most
  // once on a path. Two aliases are kept as written unless they are
  // provably disjoint: unfolding both, for aliases that name each other,
  // made the number of paths grow with each unfold (`set<V | X> &
  // collection<Y | Z>` for four such aliases did not finish).
  // Two aliases that are not recursive (`type alias A = X` and
  // `type alias B = Y`, with `X` and `Y` two nominal types, or a chain of
  // such aliases) are unfolded both, below, one after the other.
  if (
    isTransparentAlias(a) &&
    isTransparentAlias(b) &&
    (isRecursiveAlias(a) || isRecursiveAlias(b))
  )
    return provablyDisjoint(a, b) ? 'never' : undefined;
  const throughAlias = throughTransparentAlias(
    a,
    b,
    (x, y) => reduceType({ kind: 'intersection', types: [x, y] }),
    1
  );
  // A cut alias is kept as written unless the pair is provably disjoint.
  if (throughAlias !== NO_ALIAS)
    return throughAlias ?? (provablyDisjoint(a, b) ? 'never' : undefined);

  // `broadcastable<T>` denotes the union `T | list<T>` — the
  // same expansion `isSubtype` and `provablyDisjoint` use — so it is met by
  // expanding it and letting the union distribution just below do the work.
  //
  // Meeting two broadcastables elementwise instead is wrong, not merely
  // imprecise. That keeps `(A & B) | list<A & B>` and drops the
  // cross terms `A & list<B>` and `list<A> & B`,
  // which are inhabited whenever one side's element type is itself
  // collection-shaped — real usage, not a curiosity: `broadcastable<vector<n>>`
  // is what a vector-valued call produces (`library/arithmetic.ts`). A
  // `vector<3>` inhabits both `broadcastable<vector<3>>`, through its scalar
  // arm, and `broadcastable<number>`, through its collection arm, since a
  // vector of numbers is a collection of numbers — yet the elementwise answer
  // `broadcastable<never>` drops it. Being a subtype of both operands is
  // necessary for a meet but not sufficient; it admits any
  // under-approximation, `never` included.
  //
  // Placed after the subtype tests above, so a subtype-related pair keeps its
  // `broadcastable<…>` spelling rather than expanding into a union.
  const expandedA = expandBroadcastable(a);
  if (expandedA !== undefined) return meet2(expandedA, b);
  const expandedB = expandBroadcastable(b);
  if (expandedB !== undefined) return meet2(a, expandedB);

  // Distribute the meet over union members
  if (typeof a === 'object' && a.kind === 'union') return meetUnion(a.types, b);
  if (typeof b === 'object' && b.kind === 'union') return meetUnion(b.types, a);

  // Two negations meet by De Morgan: excluding `A` and excluding `B` is
  // excluding `A | B`. Without this the pair fell through to the refutation at
  // the end and reduced to `never`, losing every value that is neither — a
  // `boolean` is in both `!integer` and `!string`, and `provablyDisjoint`
  // says so, which is the same disagreement between the two predicates that
  // the rest of this function exists to remove.
  //
  const negA = typeof a === 'object' && a.kind === 'negation' ? a : undefined;
  const negB = typeof b === 'object' && b.kind === 'negation' ? b : undefined;

  if (negA !== undefined && negB !== undefined)
    return reduceType({
      kind: 'negation',
      type: { kind: 'union', types: [negA.type, negB.type] },
    });

  // A negation against an ordinary type. The pair is empty exactly when the
  // other side admits nothing outside the excluded type, i.e. when it is a
  // subtype of it: every `integer` is a `number`, so `!number & integer` has
  // no inhabitant.
  //
  // Anything else is NOT empty and must not be refuted. The wholly-outside
  // case already returned above, through `isSubtype(other, !excluded)`, which
  // holds when the two are provably disjoint. What reaches here is a partial
  // overlap, which is inhabited in general — `imaginary` is both a `number`
  // and provably disjoint from `integer`, so it inhabits `!integer & number`.
  // Returning `undefined` keeps that pair as the intersection it was written
  // as, rather than claiming it empty.
  if (negA !== undefined || negB !== undefined) {
    const excluded = (negA ?? negB!).type;
    const other = negA !== undefined ? b : a;
    if (isSubtype(other, excluded)) return 'never';
    // The open-bound normal form (`docs/plans/2026-08-28-open-bounds-in-
    // ranged-types.md` §3.2): a negated numeric VALUE meeting a range whose
    // closed endpoint is that value opens the endpoint — `real<0..> & !0`
    // IS `real<0<..>`. At an already-open endpoint, or outside the range,
    // the exclusion is vacuous and drops. Strictly inside the range it stays
    // an intersection member (no range spelling for an interior hole). The
    // pairwise fold re-offers a merged result to the remaining members, so
    // `real<0..1> & !0 & !1` reaches `real<0<..<1>` in either order.
    // The exclusion may name SEVERAL values at once: two adjacent `!k`
    // members merge by De Morgan into `!(k₁ | k₂)` BEFORE the range is
    // offered to them (the fold keeps written order), so reading only a
    // single negated value made the rewrite order-dependent — `!0 & !1 &
    // real<0..1>` stopped at `!(0 | 1) & real<0..1>` while the range-first
    // order reached `real<0<..<1>` (dual-review catch). Every excluded
    // value is applied; the ones that are neither endpoint stay excluded.
    const exs = excludedNumbers(excluded);
    const rng = asNumericRange(other);
    if (exs !== undefined && rng !== null && typeof other === 'object') {
      const lo = rng.lower ?? -Infinity;
      const hi = rng.upper ?? Infinity;
      let lowerOpen = rng.lowerOpen === true;
      let upperOpen = rng.upperOpen === true;
      const interior: number[] = [];
      for (const ex of exs) {
        if (ex < lo || ex > hi) continue; // vacuous
        if (ex === lo && ex === hi) return 'never';
        if (ex === lo) lowerOpen = true;
        else if (ex === hi) upperOpen = true;
        else interior.push(ex);
      }
      const range = makeNumericRangeType(
        rng.type,
        lo,
        hi,
        lowerOpen,
        upperOpen
      );
      if (interior.length === 0) return range;
      // Interior holes keep the intersection spelling (no range syntax
      // for them), with the endpoint exclusions already absorbed.
      const hole: Type =
        interior.length === 1
          ? { kind: 'negation', type: { kind: 'value', value: interior[0] } }
          : {
              kind: 'negation',
              type: {
                kind: 'union',
                types: interior.map((v) => ({ kind: 'value', value: v })),
              },
            };
      return { kind: 'intersection', types: [range, hole] };
    }
    return undefined;
  }

  if (typeof a === 'string' && typeof b === 'string') {
    const maximals = meetPrimitiveTypes(a as PrimitiveType, b as PrimitiveType);
    if (maximals.length === 0) return 'never';
    if (maximals.length === 1) return maximals[0];
    return { kind: 'union', types: maximals };
  }

  // Two bounded numeric ranges (or a range and a bare numeric primitive): the
  // meet is the intersection of their base kinds combined with the
  // intersection of their intervals. Overlapping ranges no longer annihilate
  // to the empty type (an unsound refutation); only genuinely disjoint ranges
  // do.
  if (
    (typeof a === 'object' && a.kind === 'numeric') ||
    (typeof b === 'object' && b.kind === 'numeric')
  ) {
    const an = asNumericRange(a);
    const bn = asNumericRange(b);
    if (an && bn) return meetNumericRanges(an, bn);
  }

  // A list with dimensions and a list with none.
  const shaped = meetShapedWithUnshapedList(a, b);
  if (shaped !== undefined) return shaped === 'keep' ? undefined : shaped;

  // Two applications of the SAME collection constructor meet ELEMENTWISE.
  const collection = meetCollections(a, b);
  if (collection !== undefined) return collection;

  // Collections of different kinds, one inside the other.
  const nested = meetCollectionKinds(a, b);
  if (nested !== undefined) return nested === 'keep' ? undefined : nested;

  // Tuples meet slot-wise and records meet by merging their keys.
  const structural = meetTuples(a, b) ?? meetRecords(a, b);
  if (structural !== undefined) return structural;

  // No meet rule applies. Two signatures are the one remaining pair that must
  // survive rather than collapse.
  if (isOverloadPair(a, b)) return undefined;

  // A transparent alias, and an intersection kept as written by a rule
  // above (`list<number> & collection<list<integer>>`, which integer
  // matrices inhabit), have no meet rule of their own. The pair is refuted
  // only when `provablyDisjoint()` proves it disjoint; otherwise it is kept
  // as written. Refuting it refused a value in both: with
  // `type alias Q = indexed_collection<integer>`, a `Q` holding `[1, 2]` is
  // a `list<number>`.
  if (isKeptOperand(a) || isKeptOperand(b))
    return provablyDisjoint(a, b) ? 'never' : undefined;

  return 'never';
}

/** `broadcastable<T>` as the union it denotes, `T | list<T>`, or
 *  `undefined` when `t` is not a broadcastable. */
function expandBroadcastable(t: Type): Type | undefined {
  if (typeof t !== 'object' || t.kind !== 'broadcastable') return undefined;
  return {
    kind: 'union',
    types: [t.elements, { kind: 'list', elements: t.elements }],
  };
}

/**
 * The meet of two applications of the SAME collection constructor, or
 * `undefined` when `a` and `b` are not such a pair.
 *
 * The meet is elementwise, and it is never empty: the EMPTY collection
 * inhabits both sides whatever their element types say, because `[]` is
 * `list<never>` and `never <: X` makes `list<never>` a subtype of every list.
 * So `list<integer> & list<string>` is `list<never>` — the type of the empty
 * list alone — and refuting the pair outright, as this used to, was unsound.
 *
 * A differing list SHAPE is not an elementwise question and takes no meet
 * here: no value is both a 2-vector and a 3-vector, so those stay refuted by
 * the caller.
 *
 * Doing this does NOT disturb the protocol-conformance ruling that counts two
 * collections with disjoint element types as non-overlapping (an empty
 * collection carries no element a conformance could dispatch on). That rule
 * lives in {@link typesOverlap}, which answers from `sameHeadArguments`
 * BEFORE it ever consults this meet.
 */
function meetCollections(a: Type, b: Type): Type | undefined {
  if (typeof a !== 'object' || typeof b !== 'object') return undefined;
  if (a.kind !== b.kind) return undefined;

  const meetElements = (x: Type, y: Type): Type =>
    reduceType({ kind: 'intersection', types: [x, y] });

  switch (a.kind) {
    case 'list': {
      const other = b as ListType;
      if (shapeKey(a) !== shapeKey(other)) return undefined;
      return decorate({
        ...a,
        elements: meetElements(a.elements, other.elements),
      });
    }

    case 'set':
    case 'collection':
    case 'indexed_collection':
      return decorate({
        ...a,
        elements: meetElements(
          a.elements,
          (b as SetType | CollectionType).elements
        ),
      });

    case 'dictionary':
      return decorate({
        ...a,
        values: meetElements(a.values, (b as DictionaryType).values),
      });

    default:
      return undefined;
  }
}

/** The answer of `throughTransparentAlias()` when neither operand is a
 * transparent alias. */
const NO_ALIAS: unique symbol = Symbol('no-alias');

/** How many times each alias is unfolding now, on the current path of
 * `throughTransparentAlias()`, by declaration (`declarationOf()`): two
 * declarations in nested scopes can share a name. */
const aliasUnfolds = new Map<TypeReference, number>();

/**
 * `f(definition, other)` when `a` or `b` is a transparent alias, with the
 * definition (`aliasDefinitionAt()`, which substitutes the type arguments
 * of a generic alias) in place of the alias. `NO_ALIAS` when neither is
 * one. `undefined` when the alias is cut: an alias unfolds at most
 * `maxUnfolds` times on one path (two, as in `unfoldAliasOnDescent()` in
 * `utils.ts`, by default), so a recursive alias
 * (`type alias json = list<json> | integer`) stops; the caller then keeps
 * the pair as written.
 */
function throughTransparentAlias<R>(
  a: Type,
  b: Type,
  f: (x: Type, y: Type) => R,
  maxUnfolds = 2
): R | undefined | typeof NO_ALIAS {
  const [alias, other, aliasFirst] = isTransparentAlias(a)
    ? [a, b, true]
    : isTransparentAlias(b)
      ? [b, a, false]
      : [undefined, undefined, false];
  if (alias === undefined || other === undefined) return NO_ALIAS;
  const decl = declarationOf(alias);
  const count = aliasUnfolds.get(decl) ?? 0;
  if (count >= maxUnfolds) return undefined;
  const def = withoutBareSelfArms(aliasDefinitionAt(alias), decl);
  if (def === undefined) return undefined;
  aliasUnfolds.set(decl, count + 1);
  try {
    return aliasFirst ? f(def, other) : f(other, def);
  } finally {
    if (count === 0) aliasUnfolds.delete(decl);
    else aliasUnfolds.set(decl, count);
  }
}

/** Whether the alias `t` names itself, directly or through other
 * transparent aliases, at any depth of its definition: `json` in
 * `type alias json = list<json> | integer`, and `A` and `B` in
 * `type alias A = B | integer` with `type alias B = A | string`. */
function isRecursiveAlias(t: TypeReference): boolean {
  const self = declarationOf(t);
  const visitedAliases = new Set<TypeReference>();
  const seenNodes = new Set<Type>();
  const walk = (x: Type | undefined): boolean => {
    if (x === undefined || typeof x !== 'object' || seenNodes.has(x))
      return false;
    seenNodes.add(x);
    if (x.kind === 'reference') {
      if (x.alias === true) {
        const decl = declarationOf(x);
        if (decl === self) return true;
        if (!visitedAliases.has(decl)) {
          visitedAliases.add(decl);
          if (walk(x.def)) return true;
        }
      }
      return (x.args ?? []).some(walk);
    }
    return Object.values(x).some((v) =>
      Array.isArray(v)
        ? v.some((e) =>
            typeof e === 'object' && e !== null && 'type' in e
              ? walk((e as { type: Type }).type)
              : walk(e as Type)
          )
        : typeof v === 'object' && v !== null
          ? walk(v as Type)
          : false
    );
  };
  return walk(t.def);
}

/** Whether `t` is a transparent alias with a definition. */
function isTransparentAlias(t: Type): t is TypeReference {
  return (
    typeof t === 'object' &&
    t.kind === 'reference' &&
    t.alias === true &&
    t.def !== undefined
  );
}

/**
 * The definition `def` of the alias `name` without its bare recursive arms:
 * in `type alias C = C | integer` the arm `C` adds no value of its own (the
 * values of `C` are those of `integer`), so it is dropped, and the other
 * arms decide. An arm that names the alias inside a constructor
 * (`list<json>`) is kept. `undefined` when no arm is left.
 */
function withoutBareSelfArms(
  def: Type | undefined,
  self: TypeReference
): Type | undefined {
  if (def === undefined || typeof def !== 'object') return def;
  const isAliasRef = def.kind === 'reference' && def.alias === true;
  if (def.kind !== 'union' && !isAliasRef) return def;
  // The bare arms that are transparent aliases are expanded through each
  // other, also through a definition that is just another alias, and an
  // alias met again on that walk is dropped: with
  // `type alias A = B | integer` and `type alias B = A | string`, the
  // values of `A` are those of `integer | string`; with `type alias A = B`
  // and `type alias B = A | integer`, they are those of `integer`.
  const arms: Type[] = [];
  let changed = false;
  const visit = (t: Type, seen: ReadonlySet<TypeReference>): void => {
    if (typeof t === 'object' && t.kind === 'reference' && t.alias === true) {
      if (seen.has(declarationOf(t))) {
        changed = true;
        return;
      }
      const inner = aliasDefinitionAt(t);
      if (
        inner !== undefined &&
        typeof inner === 'object' &&
        (inner.kind === 'union' ||
          (inner.kind === 'reference' && inner.alias === true))
      ) {
        changed = true;
        const next = new Set([...seen, declarationOf(t)]);
        for (const u of inner.kind === 'union' ? inner.types : [inner])
          visit(u, next);
        return;
      }
    }
    arms.push(t);
  };
  for (const t of def.kind === 'union' ? def.types : [def])
    visit(t, new Set([self]));
  if (!changed) return def;
  if (arms.length === 0) return undefined;
  return arms.length === 1 ? arms[0] : { kind: 'union', types: arms };
}

/** `list<any>`, built as a literal node (the type parser is not yet
 * initialized when this module loads under jest) and frozen, because it is
 * shared. */
const LIST_ANY_TYPE: Type = Object.freeze({
  kind: 'list',
  elements: 'any',
}) as Type;

/**
 * Whether the element types `x` and `y` of two collections are at mixed
 * depth: one of them can be a list, and the other can be a value that is
 * not a list. A matrix can then be a value of both collections, by its
 * cells for one and by its rows for the other: an integer matrix is a
 * `list<number>` (its cells are numbers) and a `collection<list<integer>>`
 * (its rows are lists of integers), although `number` and `list<integer>`
 * share no value. The elementwise meet does not hold such a matrix, so the
 * callers keep the intersection as written for such a pair.
 */
function elementsAtMixedDepth(x: Type, y: Type, forMeet = false): boolean {
  return elementsCanNest(x, y, forMeet) || elementsCanNest(y, x, forMeet);
}

/**
 * The directed half of `elementsAtMixedDepth()`: the elements `rows` can be
 * lists whose cells are values that are not lists, of the type `cells`. A
 * list with fixed dimensions reads its elements as rows only (its shape is
 * fixed), so for such a list only this direction gives a matrix:
 * `list<list<integer>^3>` and `collection<number>` share an integer 3×2
 * matrix, but `list<integer^3>` and `collection<list<integer>>` share none.
 */
function elementsCanNest(rows: Type, cells: Type, forMeet = false): boolean {
  // When one element type contains the other, the elementwise meet already
  // holds such a matrix: its cells are in both element types
  // (`list<unknown> & indexed_collection<boolean>` is `list<boolean>`, and a
  // boolean matrix is a `list<boolean>`), or its rows are.
  // A matrix has cells, so both element types must hold a value:
  // `couldMatch(t, t)` also finds a type with no value that is not spelled
  // `never` (`tuple<list<never^1>>`).
  return (
    !isSubtype(cells, rows) &&
    !isSubtype(rows, cells) &&
    couldMatch(cells, cells) &&
    couldMatch(rows, rows) &&
    rowsCanHoldCells(rows, cells, forMeet)
  );
}

/** `collection<any>`, built as a literal node and frozen for the same
 * reasons as `LIST_ANY_TYPE`. */
const COLLECTION_ANY_TYPE: Type = Object.freeze({
  kind: 'collection',
  elements: 'any',
}) as Type;

/** How deep `rowsCanHoldCells()` looks into nested element types. The walk
 * follows the structure of the type, one level per step, so its cost grows
 * with the depth only; the limit stops a recursive alias. */
const NESTED_ROW_DEPTH = 64;

/** The empty set of aliases, for the first call of `rowsCanHoldCells()`. */
const NO_ALIASES: ReadonlySet<TypeReference> = new Set();

/**
 * Whether a value of `rows` can be a non-empty list whose cells, at some
 * depth, are of type `cells`: `list<integer>` holds number cells, and
 * `list<list<integer>>` holds them one level deeper (a 2×2×2 tensor), but
 * `list<string^2>` holds none, and neither does `list<never>`, whose only
 * value is `[]`. The walk follows the element types of collections and the
 * arms of unions; a row must have an element that can be a cell, or that
 * holds cells deeper. A top type (`any`, `unknown`) holds such a list.
 *
 * Past `NESTED_ROW_DEPTH` levels, and for a transparent alias or an
 * intersection, the answer is not known: for the meet (`forMeet`) it is
 * whether `rows` can be a list at all, which only keeps an intersection as
 * written; for the overlap test it is `false`, which claims no common
 * value.
 *
 * `couldMatch()` does not count an empty collection shared by two disjoint
 * element types, as the protocol rule of `typesOverlap()` requires. The
 * meet must count it, or it drops a value: a matrix of empty sets is a
 * `list<set<integer>>` and a `collection<list<set<string>>>`. So for the
 * meet, an element that can be a collection also matches cells that can be
 * collections.
 */
function rowsCanHoldCells(
  rows: Type,
  cells: Type,
  forMeet: boolean,
  depth = 0,
  unfolded: ReadonlySet<TypeReference> = NO_ALIASES,
  memo: Map<Type, boolean> = new Map()
): boolean {
  // One question can meet the same row type on several branches (the arms
  // of `list<R^2> | list<R^3>` at each level of a chain of aliases): the
  // answer for a row type is kept for the rest of this search, so the work
  // grows with the number of distinct row types, not with the number of
  // paths.
  const known = memo.get(rows);
  if (known !== undefined) return known;
  const answer = rowsCanHoldCellsUncached(
    rows,
    cells,
    forMeet,
    depth,
    unfolded,
    memo
  );
  memo.set(rows, answer);
  return answer;
}

function rowsCanHoldCellsUncached(
  rows: Type,
  cells: Type,
  forMeet: boolean,
  depth: number,
  unfolded: ReadonlySet<TypeReference>,
  memo: Map<Type, boolean>
): boolean {
  if (depth >= NESTED_ROW_DEPTH)
    return forMeet && couldMatch(rows, LIST_ANY_TYPE);
  const deeper = (t: Type, d: number, names = unfolded): boolean =>
    rowsCanHoldCells(t, cells, forMeet, d, names, memo);
  // For the overlap test, a cell matches by `typesOverlap()`, so the
  // protocol rule applies to the cells too (`list<list<set<never>>>` and
  // `collection<set<integer>>` share empty sets only).
  const elementMatches = (e: Type): boolean =>
    forMeet
      ? couldMatch(e, cells) ||
        (couldMatch(e, COLLECTION_ANY_TYPE) &&
          couldMatch(cells, COLLECTION_ANY_TYPE))
      : typesOverlap(e, cells);
  const holdsThrough = (e: Type): boolean =>
    elementMatches(e) || deeper(e, depth + 1);
  // A named type holds a non-empty list of any cells when it is a top type
  // or a bare collection name (the `<unknown>` form).
  if (typeof rows !== 'object')
    return (
      rows === 'any' ||
      rows === 'unknown' ||
      rows === 'list' ||
      rows === 'indexed_collection' ||
      rows === 'collection'
    );
  switch (rows.kind) {
    case 'union':
      return rows.types.some((t) => deeper(t, depth));
    case 'broadcastable':
      return deeper(rows.elements, depth) || holdsThrough(rows.elements);
    case 'list': {
      // The elements of a list with two or more dimensions are its sub-rows,
      // not its scalar cells: a `2×0` row holds two empty rows and no cell.
      const dims = rows.dimensions;
      if (dims?.[0] === 0) return false;
      return holdsThrough(
        dims !== undefined && dims.length > 1
          ? { kind: 'list', elements: rows.elements, dimensions: dims.slice(1) }
          : rows.elements
      );
    }
    case 'indexed_collection':
    case 'collection':
      return holdsThrough(rows.elements);
    case 'reference': {
      // A transparent alias is read as its definition, once on a path: a
      // chain of aliases with no cycle is followed to its end, and a
      // recursive alias stops at its first repeat. (A budget of unfolds for
      // the whole path stopped a long chain with no cycle.)
      const def =
        rows.alias === true &&
        rows.def !== undefined &&
        !unfolded.has(declarationOf(rows))
          ? aliasDefinitionAt(rows)
          : undefined;
      if (def !== undefined)
        return deeper(
          def,
          depth + 1,
          new Set([...unfolded, declarationOf(rows)])
        );
      return forMeet && couldMatch(rows, LIST_ANY_TYPE);
    }
    case 'intersection':
      return forMeet && couldMatch(rows, LIST_ANY_TYPE);
    default:
      return false;
  }
}

/**
 * The readings of the elements of a list with two or more dimensions: its
 * cells, and its rows of every rank (list subtyping can peel any number of
 * outer dimensions). An element of a collection that holds the list is one
 * of these. `list<integer^(2x3)>` gives `integer` and `list<integer^3>`.
 */
function matrixReadings(t: ListType): Type[] {
  const dims = t.dimensions ?? [];
  const readings: Type[] = [t.elements];
  for (let k = 1; k < dims.length; k++)
    readings.push({
      kind: 'list',
      elements: t.elements,
      dimensions: dims.slice(k),
    });
  return readings;
}

/**
 * The meet of a list with two or more dimensions with a collection whose
 * elements are `elements`: `never` when no reading of the list
 * (`matrixReadings()`) can be such an element and the list is not empty
 * (`list<integer^(2x3)> & collection<string>`), otherwise `'keep'`, the
 * intersection as written.
 */
function meetMatrixWith(matrix: ListType, elements: Type): 'never' | 'keep' {
  const dims = matrix.dimensions ?? [];
  // The elements of the list can themselves be lists, which give deeper
  // readings: `list<list<integer^2>^(2x3)>` and `collection<number>` share
  // a 2×3×2 integer tensor.
  if (elementsCanNest(matrix.elements, elements, true)) return 'keep';
  if (
    dims.every((d) => d > 0) &&
    matrixReadings(matrix).every((r) => provablyDisjoint(r, elements))
  )
    return 'never';
  return 'keep';
}

/**
 * Whether a matrix can be in the collection `narrow` and in a collection of
 * `elements`, by different readings (`elementsAtMixedDepth()`). A list with
 * one fixed dimension reads its elements as rows only
 * (`elementsCanNest()`). A list with two or more dimensions is read by
 * `meetMatrixWith()` and `matrixReadings()` instead.
 */
function mayShareMatrix(
  narrow: ListType | CollectionType | SetType | TupleType,
  elements: Type,
  forMeet = false
): boolean {
  if (narrow.kind === 'list' && narrow.dimensions !== undefined)
    return elementsCanNest(narrow.elements, elements, forMeet);
  if (narrow.kind === 'list' || narrow.kind === 'indexed_collection')
    return elementsAtMixedDepth(narrow.elements, elements, forMeet);
  return false;
}

/** Whether `t` is a list whose outer dimension is zero: it holds `[]` only. */
function isZeroLengthList(t: Type): boolean {
  return typeof t === 'object' && t.kind === 'list' && t.dimensions?.[0] === 0;
}

/** Whether `t` is a transparent alias or an intersection: an operand that
 * `meet2()` keeps as written when it cannot refute the pair. */
function isKeptOperand(t: Type): boolean {
  if (typeof t !== 'object') return false;
  if (t.kind === 'intersection') return true;
  return t.kind === 'reference' && t.alias === true;
}

/**
 * The meet of a list with dimensions and a list with none, or `undefined`
 * when `a` and `b` are not such a pair. A list with no dimensions has any
 * shape, so the meet has the shape of the other list and the meet of the
 * elements: `list<number^2> & list<integer>` is `list<integer^2>`. The rule
 * for two lists, `meetCollections()`, refutes two different shapes. That is
 * a known gap even for two fixed shapes: `list<number^(2x2)>` and
 * `list<list<integer>^2>` share `list<integer^(2x2)>` (see ROADMAP.md).
 *
 * The answer is `'keep'`, the intersection as written, when the list with
 * dimensions has two or more of them (an element of the other list is then
 * a cell or a row of it), or when the element types are at mixed depth
 * (`elementsAtMixedDepth()`), unless `provablyDisjoint()` refutes the pair.
 * With no common element, a list whose length is fixed and not zero has no
 * value: `list<string> & list<integer^2>` is `never`.
 */
function meetShapedWithUnshapedList(
  a: Type,
  b: Type
): Type | 'keep' | undefined {
  if (typeof a !== 'object' || typeof b !== 'object') return undefined;
  if (a.kind !== 'list' || b.kind !== 'list') return undefined;
  if ((a.dimensions === undefined) === (b.dimensions === undefined))
    return undefined;
  const shaped = a.dimensions !== undefined ? a : b;
  const unshaped = shaped === a ? b : a;
  const dims = shaped.dimensions!;
  if (dims.length > 1) return meetMatrixWith(shaped, unshaped.elements);
  if (elementsCanNest(shaped.elements, unshaped.elements, true))
    return provablyDisjoint(a, b) ? 'never' : 'keep';
  const elements = reduceType({
    kind: 'intersection',
    types: [a.elements, b.elements],
  });
  if (isEmptyType(elements) && dims[0] > 0) return 'never';
  return decorate({ ...shaped, elements });
}

/**
 * `[narrow, wide]` when `a` and `b` are collection types of different kinds
 * and one kind is inside the other, and `undefined` otherwise. A list and a
 * tuple are indexed collections, an indexed collection and a set are
 * collections. A bare `list`, `indexed_collection` or `collection` is read
 * as its `<unknown>` form.
 */
function collectionKindPair(
  a: Type,
  b: Type
):
  | [ListType | CollectionType | SetType | TupleType, CollectionType]
  | undefined {
  const asNode = (t: Type): Type =>
    t === 'list' ||
    t === 'indexed_collection' ||
    t === 'collection' ||
    t === 'set'
      ? ({ kind: t, elements: 'unknown' } as Type)
      : t;
  const x = asNode(a);
  const y = asNode(b);
  if (typeof x !== 'object' || typeof y !== 'object') return undefined;
  const depth = (t: Type): number | undefined => {
    if (typeof t !== 'object') return undefined;
    if (t.kind === 'list' || t.kind === 'tuple') return 0;
    if (t.kind === 'indexed_collection') return 1;
    if (t.kind === 'set') return 1.5;
    if (t.kind === 'collection') return 2;
    return undefined;
  };
  const dx = depth(x);
  const dy = depth(y);
  if (dx === undefined || dy === undefined || dx === dy) return undefined;
  const [narrow, wide] = dx < dy ? [x, y] : [y, x];
  // A set is inside `collection` only; a list or a tuple is not a set.
  if (wide.kind === 'set') return undefined;
  if (narrow.kind === 'set' && wide.kind !== 'collection') return undefined;
  return [
    narrow as ListType | CollectionType | SetType | TupleType,
    wide as CollectionType,
  ];
}

/**
 * The meet of two collection types of different kinds, one inside the
 * other (`collectionKindPair()`), or `undefined` when `a` and `b` are not
 * such a pair. The meet is the narrower kind with the meet of the elements:
 * `list<number> & indexed_collection<integer>` is `list<integer>`,
 * `set<number> & collection<integer>` is `set<integer>`, and
 * `tuple<number, number> & indexed_collection<integer>` is
 * `tuple<integer, integer>`. Without this rule the meet of such a pair was
 * `never`, which refused a value in both: a parameter typed
 * `broadcastable<number> | string` refused an argument typed
 * `indexed_collection<integer>` that holds a list.
 *
 * The answer is `'keep'`, the intersection as written, when a matrix can be
 * in both: the narrow one is a list with two or more dimensions, or a list
 * or an indexed collection whose elements are at mixed depth with the wide
 * one's (`elementsAtMixedDepth()`), unless `provablyDisjoint()` refutes the
 * pair. An empty element meet leaves the empty collection, except for a
 * list whose length is fixed and not zero, and for a tuple, whose every
 * slot must hold a value: those give `never`.
 */
function meetCollectionKinds(a: Type, b: Type): Type | 'keep' | undefined {
  // A bare `tuple` has no fixed number of slots, so it has no slot-wise
  // meet: it is kept as written beside an indexed collection or a
  // collection (`tuple & indexed_collection<integer>` holds `(1, 2)`).
  const isWideKind = (t: Type): boolean =>
    t === 'indexed_collection' ||
    t === 'collection' ||
    (typeof t === 'object' &&
      (t.kind === 'indexed_collection' || t.kind === 'collection'));
  if ((a === 'tuple' && isWideKind(b)) || (b === 'tuple' && isWideKind(a)))
    return provablyDisjoint(a, b) ? 'never' : 'keep';
  const pair = collectionKindPair(a, b);
  if (pair === undefined) return undefined;
  const [narrow, wide] = pair;
  const meetElements = (x: Type): Type =>
    reduceType({ kind: 'intersection', types: [x, wide.elements] });
  if (narrow.kind === 'tuple') {
    const elements = narrow.elements.map((e) => ({
      ...e,
      type: meetElements(e.type),
    }));
    if (elements.some((e) => isEmptyType(e.type))) return 'never';
    return { ...narrow, elements };
  }
  if (narrow.kind === 'list' && (narrow.dimensions?.length ?? 0) > 1)
    return meetMatrixWith(narrow, wide.elements);
  if (mayShareMatrix(narrow, wide.elements, true))
    return provablyDisjoint(a, b) ? 'never' : 'keep';
  const elements = meetElements(narrow.elements);
  if (
    isEmptyType(elements) &&
    narrow.kind === 'list' &&
    narrow.dimensions !== undefined &&
    narrow.dimensions[0] > 0
  )
    return 'never';
  return decorate({ ...narrow, elements } as Type);
}

/**
 * The meet of two TUPLE types, or `undefined` when `a` and `b` are not both
 * tuples.
 *
 * Tuples meet slot-wise, and — unlike a collection — the meet can be empty:
 * every slot of a tuple must hold a value, so one uninhabited slot leaves the
 * whole tuple with no inhabitant. That is why `tuple<integer> & tuple<string>`
 * is `never` and not `tuple<never>`, even though `tuple<never>` is a subtype
 * of both: no value inhabits it, and every consumer of this meet is asking
 * whether a value could. Differing arity is empty for the same reason —
 * nothing is both a 2-tuple and a 3-tuple. (Ruled in `ROADMAP.md`, "The meet
 * had no structural rule for same-kind composites".)
 *
 * Slot names must agree where both sides name one: a slot cannot be called
 * both `x` and `y`. An unnamed slot takes the other side's name, mirroring
 * `isSubtype`, where a named tuple is a subtype of the same-shape unnamed one.
 */
function meetTuples(a: Type, b: Type): Type | undefined {
  if (typeof a !== 'object' || typeof b !== 'object') return undefined;
  if (a.kind !== 'tuple' || b.kind !== 'tuple') return undefined;
  if (a.elements.length !== b.elements.length) return 'never';

  const elements: NamedElement[] = [];
  for (let i = 0; i < a.elements.length; i++) {
    const x = a.elements[i];
    const y = b.elements[i];
    if (x.name !== undefined && y.name !== undefined && x.name !== y.name)
      return 'never';
    const type = reduceType({ kind: 'intersection', types: [x.type, y.type] });
    if (isEmptyType(type)) return 'never';
    const name = x.name ?? y.name;
    elements.push(name === undefined ? { type } : { name, type });
  }

  return decorate({ kind: 'tuple', elements });
}

/**
 * The meet of two RECORD types, or `undefined` when `a` and `b` are not both
 * records.
 *
 * Records are width-subtyped — a record with more keys is a subtype of one
 * with fewer — so the meet carries the union of both key sets: the value
 * inhabiting both `record{a: integer}` and `record{b: string}` is
 * `record{a: integer, b: string}`. A key both sides declare takes the meet of
 * its two types, and an uninhabited key empties the whole record, since a
 * declared key must hold a value: `record{a: integer} & record{a: string}` is
 * `never`, not `record{a: never}`. (Ruled in `ROADMAP.md`, "The meet had no
 * structural rule for same-kind composites".)
 *
 * `object` is deliberately absent: object layouts are exact and their fields
 * invariant (`isSubtype`), so two object types that are not already
 * subtype-related share no value and the caller's refutation is right.
 */
function meetRecords(a: Type, b: Type): Type | undefined {
  if (typeof a !== 'object' || typeof b !== 'object') return undefined;
  if (a.kind !== 'record' || b.kind !== 'record') return undefined;

  const elements: Record<string, Type> = { ...a.elements };
  for (const [key, type] of Object.entries(b.elements)) {
    // Presence must be an own-property test. `Object.prototype` member names
    // are valid record keys — `record{toString: string}` parses and
    // serializes — so a plain `elements[key]` lookup finds the inherited
    // function for those names and hands it to `reduceType` as if it were a
    // type, which throws "Unknown type kind". It also made the meet
    // order-dependent, since the crash only happened when the prototype name
    // arrived from the right-hand side.
    if (!Object.prototype.hasOwnProperty.call(elements, key)) {
      elements[key] = type;
      continue;
    }
    const meet = reduceType({
      kind: 'intersection',
      types: [elements[key], type],
    });
    if (isEmptyType(meet)) return 'never';
    elements[key] = meet;
  }

  return decorate({ kind: 'record', elements });
}

/**
 * True when `a` and `b` are two function signatures, whose intersection is an
 * OVERLOAD SET — the way this type system spells "inhabited by a function
 * answering to both shapes". `isSubtype` already reports such an intersection
 * as a subtype of each of its arms, so collapsing it here contradicted the
 * subtype relation and erased every overload set written as a type.
 *
 * A positive witness like this one is required, rather than the absence of a
 * disjointness proof (`!provablyDisjoint(a, b)`). That oracle answers the
 * conservative "may overlap" for a NOMINAL reference — its inhabitants are not
 * its definition's, so it cannot rule on them — while two distinct nominal
 * types do share no value, and the protocol-conformance overlap gate
 * (`engine-protocols.ts`, reached through `typesOverlap`) depends on their
 * meet being empty. Reading that conservative answer as "keep the
 * intersection" made every unrelated nominal pair collide.
 *
 * Same-kind composites are not decided here, because kind alone is not a
 * witness of a shared value: two lists always share the empty one, two records
 * merge only if every key they both declare can agree, and two tuples must
 * match on arity and slot names. Admitting a whole kind on the strength of the
 * kind — which an earlier version of this function did — makes `typesOverlap`
 * report tuples of different arity, and records whose common key has disjoint
 * types, as overlapping, and the conformance gate then rejects legitimately
 * disjoint conformances. Each of those kinds carries its own rule instead:
 * {@link meetCollections}, {@link meetRecords} and {@link meetTuples}, all
 * consulted by `meet2` before it reaches this function.
 */
function isOverloadPair(a: Type, b: Type): boolean {
  return (
    typeof a === 'object' &&
    typeof b === 'object' &&
    a.kind === 'signature' &&
    b.kind === 'signature'
  );
}

/**
 * Recursively flatten nested intersections and reduce + de-duplicate the
 * members, so `(a & (b & c))` and `((a & b) & c)` yield the same flat member
 * list. De-duplication uses `typeToDedupKey` with the order-independent
 * tie-break of {@link addDedupedMember}, so a stated-pure arrow and its bare
 * twin merge to the spelling that carries the marker.
 *
 * The union counterpart is {@link flattenUnionMembers}; unlike that one the
 * member ORDER is preserved rather than canonicalized, because an intersection
 * of signatures is an overload set and its arm order is dispatch-significant
 * (`overload.ts` breaks ranking ties by declaration order).
 */
function flattenIntersectionMembers(types: Readonly<Type[]>): Type[] {
  const result: Type[] = [];
  const seen = new Map<string, number>();
  const add = (t: Type): void => {
    if (typeof t === 'object' && t.kind === 'intersection') {
      for (const m of t.types) add(m);
      return;
    }
    addDedupedMember(result, seen, typeToDedupKey(t), t);
  };
  for (const t of types) add(reduceType(t));
  return result;
}

/** The meet (intersection) of two bounded numeric types, as one type: the
 *  ranges of {@link meetNumericRangeMembers}, reduced to a union when the
 *  base kinds meet in more than one kind. */
function meetNumericRanges(a: NumericType, b: NumericType): Type {
  const ranges = meetNumericRangeMembers(a, b);
  if (ranges.length === 0) return 'never';
  if (ranges.length === 1) return ranges[0];
  return reduceUnionType({ kind: 'union', types: ranges });
}

/** The machine numbers a `!…` exclusion names: one for `!k`, several for
 * the De Morgan merge `!(k₁ | k₂)`; `undefined` when the excluded type is
 * anything but numeric value types (a whole union must be values). */
function excludedNumbers(t: Type): number[] | undefined {
  if (typeof t !== 'object') return undefined;
  if (t.kind === 'value')
    return typeof t.value === 'number' && !Number.isNaN(t.value)
      ? [t.value]
      : undefined;
  if (t.kind === 'union') {
    const out: number[] = [];
    for (const m of t.types) {
      const v = excludedNumbers(m);
      if (v === undefined) return undefined;
      out.push(...v);
    }
    return out;
  }
  return undefined;
}

function meetUnion(types: Readonly<Type[]>, b: Type): Type {
  const members: Type[] = [];
  for (const t of types) {
    const m = meet2(t, b);
    if (m !== undefined && isEmptyType(m)) continue;
    // No meet rule for this member: the distribution still happened, and this
    // member's share of it is the irreducible pair itself.
    members.push(m === undefined ? { kind: 'intersection', types: [t, b] } : m);
  }
  if (members.length === 0) return 'never';
  if (members.length === 1) return members[0];
  return reduceUnionType({ kind: 'union', types: members });
}

function reduceIntersectionType(type: AlgebraicType): Type {
  const reducedTypes = flattenIntersectionMembers(type.types);

  // An intersection of NO types constrains nothing, so every value satisfies
  // it vacuously: the answer is the TOP type. It is neither `never` (which no
  // value inhabits) nor `nothing` (the unit type of the symbol `Nothing`) —
  // the same false friend `narrow()` documents for its own zero-arity case.
  if (reducedTypes.length === 0) return 'any';

  // If the intersection contains an `error`, return `error`
  if (reducedTypes.some((type) => type === 'error')) return 'error';

  // Fold the members pairwise through the meet. Overlapping numeric
  // primitives intersect to their lattice meet (e.g. `integer & real` =
  // `integer`) instead of collapsing; genuinely disjoint types (e.g.
  // `number & boolean`) annihilate to `never`, the EMPTY type.
  //
  // A pair `meet2` can neither merge nor prove disjoint stays as it was
  // written, so each member is offered to the accumulated ones and appended
  // when none of them absorbs it. The surviving list is the intersection —
  // for signatures, the overload set. Members keep their written order: it is
  // the tie-break `overload.ts` uses when ranking equally-good arms.
  //
  // A member that merges keeps being offered to the REST of the accumulated
  // list, because the merged result is narrower than either side and may now
  // absorb members that neither side did. Stopping at the first merge left
  // reduction non-idempotent: `((number) -> number) & ((integer) -> integer) &
  // ((any) -> integer)` settled to a two-arm intersection that reducing again
  // collapsed to one arm — and settling a canonical type text is required to
  // reproduce it (`settleTypeText`, `library/type-value-utils.ts`).
  const members: Type[] = [];
  for (const t of reducedTypes) {
    let merged: Type = t;
    // Where the merged result goes back, so a merge cannot reorder the arms:
    // the slot of the FIRST member it absorbed, or the end if it absorbed none.
    let at = -1;
    for (let i = 0; i < members.length;) {
      const m = meet2(members[i], merged);
      if (m !== undefined && isEmptyType(m)) return 'never';
      if (m === undefined) {
        i += 1;
        continue;
      }
      if (at === -1) at = i;
      members.splice(i, 1);
      merged = m;
    }
    if (at === -1) members.push(merged);
    else members.splice(at, 0, merged);
  }

  if (members.length === 1) return decorate(members[0]);

  return decorate({ ...type, types: members });
}

/**
 * Do the two types have an INHABITED meet, i.e. is there a value that both
 * admit?
 *
 * The predicate protocol conformance uses to decide whether two conformance
 * targets collide (`docs/TYPE-SYSTEM.md`). It is
 * built on the intersection REDUCTION above — `meet2`/`meetNumericRanges`/
 * `meetUnion` — deliberately NOT on `subtype.ts`'s `narrow()`, which
 * short-circuits incomparable pairs to `never` without consulting the numeric
 * ranges and so cannot decide `integer<1..10>` vs `integer<5..20>` (meet
 * `integer<5..10>`, inhabited).
 *
 * Emptiness has ONE spelling: `never`, tested through `isEmptyType`. A meet
 * that comes back `nothing` is NOT empty — that is the unit type, inhabited by
 * the symbol `Nothing` — which is why `typesOverlap('nothing', 'nothing')` is
 * true.
 */
/** The answers of `typesOverlap()` during one top-level question, by pair
 * of operands. `undefined` outside a question. */
let overlapMemo: Map<Type, Map<Type, boolean>> | undefined;

export function typesOverlap(a: Type, b: Type): boolean {
  // One question can meet the same pair on several branches (the arms of
  // `list<A^2> | list<A^3>` at each level of a chain of aliases): each
  // answer is kept for the rest of the question, so the work grows with
  // the number of distinct pairs, not with the number of paths.
  const outer = overlapMemo === undefined;
  const memo = (overlapMemo ??= new Map());
  try {
    const known = memo.get(a)?.get(b);
    if (known !== undefined) return known;
    const answer = typesOverlapUncached(a, b);
    let row = memo.get(a);
    if (row === undefined) memo.set(a, (row = new Map()));
    row.set(b, answer);
    return answer;
  } finally {
    if (outer) overlapMemo = undefined;
  }
}

function typesOverlapUncached(a: Type, b: Type): boolean {
  // A transparent alias is compared through its definition, so that the
  // rules below apply to it: with `type alias A = list<integer>`,
  // `list<A>` and `list<list<string>>` do not overlap, as `list<list<integer>>`
  // and `list<list<string>>` do not. An alias cut on a recursion falls to the
  // meet, which keeps it as written.
  const throughAlias = throughTransparentAlias(a, b, typesOverlap);
  if (throughAlias !== NO_ALIAS) return throughAlias ?? !provablyDisjoint(a, b);

  // A union overlaps when one of its arms does, each arm with the rules
  // below.
  if (typeof a === 'object' && a.kind === 'union')
    return a.types.some((t) => typesOverlap(t, b));
  if (typeof b === 'object' && b.kind === 'union')
    return b.types.some((t) => typesOverlap(a, t));

  // Same-head applications are decided ARGUMENT-WISE, not by the reduction:
  // `meet2` meets two lists elementwise, so `list<integer<1..10>>` and
  // `list<integer<5..20>>` reduce to `list<integer<5..10>>` — inhabited, but
  // by way of a reduction this predicate would then have to inspect. Deciding
  // argument-wise answers directly. Only this predicate takes the shortcut —
  // `meet2`/`reduceType` keep their semantics for every other caller.
  //
  // Residual, deliberately accepted (protocols design P4): two same-head
  // COLLECTIONS with disjoint element types still share the EMPTY value
  // (`[]`), so strictly they are not disjoint. The ruling counts them as
  // non-overlapping — an empty collection carries no element a conformance
  // could ever dispatch on.
  const args = sameHeadArguments(a, b);
  if (args !== null) {
    if (args[0].every((t, i) => typesOverlap(t, args[1][i]))) return true;
    // Two collections of the same kind with no fixed shape can share a
    // tensor through elements at different depths (`elementsAtMixedDepth()`):
    // a rank-3 tensor of reals is a `list<list<list<real>>>` and a
    // `list<number>`, whose elements do not overlap.
    const unshaped = (t: Type): t is ListType | CollectionType =>
      typeof t === 'object' &&
      ((t.kind === 'list' && t.dimensions === undefined) ||
        t.kind === 'indexed_collection' ||
        t.kind === 'collection');
    return (
      unshaped(a) && unshaped(b) && elementsAtMixedDepth(a.elements, b.elements)
    );
  }

  // A broadcastable is `T | list<T>`: its arms are compared one by one, with
  // the rule above for each pair, so the cross terms are read
  // (`broadcastable<integer>` and `broadcastable<list<integer>>` share
  // `[1, 2]`) and a pair that shares the empty list only is not counted
  // (`broadcastable<integer>` and `broadcastable<string>`).
  const ea = expandBroadcastable(a);
  const eb = expandBroadcastable(b);
  if (ea !== undefined || eb !== undefined) {
    const arms = (t: Type | undefined, orig: Type): Type[] =>
      t !== undefined && typeof t === 'object' && t.kind === 'union'
        ? t.types
        : [orig];
    return arms(ea, a).some((x) => arms(eb, b).some((y) => typesOverlap(x, y)));
  }

  // The same argument-wise rule for collections of different kinds
  // (`collectionKindPair()`), and for a list with dimensions beside a list
  // with none: `list<integer>` and `collection<string>` share the empty
  // collection only, as `list<integer>` and `list<string>` do. A pair that
  // can share a matrix (a list with two or more dimensions, or elements at
  // mixed depth) is decided by the meet below instead.
  const kinds = collectionKindPair(a, b);
  const shapes =
    typeof a === 'object' &&
    typeof b === 'object' &&
    a.kind === 'list' &&
    b.kind === 'list' &&
    (a.dimensions === undefined) !== (b.dimensions === undefined)
      ? ([
          a.dimensions !== undefined ? a : b,
          a.dimensions !== undefined ? b : a,
        ] as const)
      : undefined;
  const narrow = kinds?.[0] ?? shapes?.[0];
  const wide = kinds?.[1] ?? shapes?.[1];
  if (narrow !== undefined && wide !== undefined) {
    if (isZeroLengthList(narrow)) return false;
    if (narrow.kind === 'tuple')
      return narrow.elements.every((e) => typesOverlap(e.type, wide.elements));
    // A list with two or more dimensions: an element of the other is one of
    // its readings (`matrixReadings()`).
    if (narrow.kind === 'list' && (narrow.dimensions?.length ?? 0) > 1) {
      if (!elementsCanNest(narrow.elements, wide.elements))
        return matrixReadings(narrow).some((r) =>
          typesOverlap(r, wide.elements)
        );
    } else if (!mayShareMatrix(narrow, wide.elements))
      return typesOverlap(narrow.elements, wide.elements);
  }

  const meet = reduceType({ kind: 'intersection', types: [a, b] });
  return !isEmptyType(meet);
}

/**
 * The type ARGUMENTS of two applications of the SAME head constructor, or
 * `null` when `a` and `b` are not such a pair (different heads, a non-applied
 * type, or a mismatched argument count — all of which fall back to the
 * reduction path).
 */
function sameHeadArguments(a: Type, b: Type): [Type[], Type[]] | null {
  if (typeof a !== 'object' || typeof b !== 'object') return null;
  if (a.kind !== b.kind) return null;

  switch (a.kind) {
    case 'list': {
      const other = b as ListType;
      // A differing shape is not an argument-wise question.
      if (shapeKey(a) !== shapeKey(other)) return null;
      return [[a.elements], [other.elements]];
    }

    // Two broadcastables are not compared argument-wise: `T | list<T>`
    // meets `U | list<U>` in the cross terms too (`broadcastable<integer>`
    // and `broadcastable<list<integer>>` share `[1, 2]`), which the meet
    // reads.
    case 'set':
    case 'collection':
    case 'indexed_collection':
      return [[a.elements], [(b as SetType | CollectionType).elements]];

    case 'dictionary':
      return [[a.values], [(b as DictionaryType).values]];

    case 'reference': {
      const other = b as TypeReference;
      if (a.name !== other.name) return null;
      // A parameterized NOMINAL application keeps its arguments; a bare
      // reference has none to compare, so it takes the reduction path.
      if (a.args === undefined || other.args === undefined) return null;
      if (a.args.length !== other.args.length) return null;
      return [a.args, other.args];
    }

    default:
      return null;
  }
}

function reduceCollectionType(
  kind: 'collection' | 'indexed_collection',
  type: CollectionType
): Type {
  const reducedType = reduceType(type.elements);

  if (reducedType === 'error') return 'error';

  // A collection of `nothing` is an empty collection
  if (reducedType === 'nothing') return decorate({ kind, elements: 'nothing' });

  // The bare constructor is the canonical spelling of the `<unknown>` form
  // (user ruling 2026-08-17: bare `collection` IS `collection<unknown>`). An
  // explicit `<any>` is the strictly wider, absence-admitting contract and
  // survives — collapsing it here (as this function once did) would silently
  // narrow it to the values-only bare reading.
  if (reducedType === 'unknown') return kind;

  return decorate({
    ...type,
    elements: reducedType,
  });
}

function reduceListType(type: ListType): Type {
  const reducedType = reduceType(type.elements);

  if (reducedType === 'error') return 'error';

  // A list of `nothing` is an empty list
  if (reducedType === 'nothing')
    return decorate({ kind: 'list', elements: 'nothing' });

  // Every axis is kept, a zero-length axis too. `list<integer^(2x0)>` is two
  // empty rows: a value the engine can hold, of rank 2 and with 0 elements.
  // Dropping the zero axis changed the rank of the type (it became
  // `vector<integer^2>`, a list of two integers), and an all-zero shape is
  // the type of an empty list with its axes, not the type `nothing`.
  // `-1` ("any size", the axis a dimension variable rides on) is kept too.
  const dimensions = type.dimensions;
  const dimensionVariables = type.dimensionVariables;

  // Bare `list` is the canonical spelling of `list<unknown>` (user ruling
  // 2026-08-17) — but only when no dimensions constrain the rank, which the
  // bare form cannot express.
  if (reducedType === 'unknown' && dimensions === undefined) return 'list';

  const reduced: ListType = {
    ...type,
    dimensions,
    elements: reducedType,
  };
  if (dimensionVariables === undefined) delete reduced.dimensionVariables;
  else reduced.dimensionVariables = dimensionVariables;
  return decorate(reduced);
}

function reduceSetType(type: SetType): Type {
  const reducedType = reduceType(type.elements);

  if (reducedType === 'error') return 'error';

  // A set of `nothing` is an empty set
  if (reducedType === 'nothing')
    return decorate({ kind: 'set', elements: 'nothing' });

  // Bare `set` is the canonical spelling of `set<unknown>` (user ruling
  // 2026-08-17); an explicit `<any>` is wider and survives.
  if (reducedType === 'unknown') return 'set';

  return decorate({
    ...type,
    elements: reducedType,
  });
}

function reduceBroadcastableType(type: BroadcastableType): Type {
  // A `broadcastable<T>` is OPAQUE: it is never collapsed to `T` or to a
  // union, even for `broadcastable<any>`. Only its element type is reduced and
  // an `error` element propagates.
  const reducedType = reduceType(type.elements);

  if (reducedType === 'error') return 'error';

  return decorate({
    ...type,
    elements: reducedType,
  });
}

function reduceTupleType(type: TupleType): Type {
  const reducedElements = type.elements.map((element) => ({
    ...element,
    type: reduceType(element.type),
  }));

  // The empty tuple is `nothing`
  if (reducedElements.length === 0) return 'nothing';

  // Note: a single element tuple is not reduced to the element
  // (any) ≠ any

  if (reducedElements.some((element) => element.type === 'error'))
    return 'error';

  // Every slot must be inhabited. Nothing occupies a slot; never cannot.
  if (reducedElements.some((element) => isEmptyType(element.type)))
    return 'never';

  return decorate({
    ...type,
    elements: reducedElements,
  });
}

function reduceRecordType(type: RecordType): Type {
  let reducedElements: Record<string, Type> = {};
  for (const [key, value] of Object.entries(type.elements))
    reducedElements[key] = reduceType(value);

  if (Object.values(reducedElements).some((type) => type === 'error'))
    return 'error';

  // An uninhabited key empties the whole record, for the same reason a tuple
  // slot does: a declared key must hold a value.
  if (Object.values(reducedElements).some((type) => isEmptyType(type)))
    return 'never';

  // If the type of any key is 'nothing', remove it from the record
  reducedElements = Object.fromEntries(
    Object.entries(reducedElements).filter(([_, value]) => value !== 'nothing')
  );

  // An empty record is `record`
  if (Object.keys(reducedElements).length === 0) return 'record';

  return decorate({
    ...type,
    elements: reducedElements,
  });
}

/**
 * Reduce an object layout — every field type reduced, and NOTHING ELSE.
 *
 * Deliberately not `reduceRecordType`: a record's reduction drops `nothing`
 * fields and collapses an emptied record to the bare `record` primitive, both
 * of which are sound for a structural type read only for its contents. An
 * object's field set is its LAYOUT — what its constructor requires and what
 * its stores may write — so dropping a field would silently change the type's
 * meaning, and collapsing to the bare `object` primitive would turn a specific
 * layout into "any object". An `'error'` field still poisons the whole type,
 * as everywhere else.
 */
function reduceObjectType(type: ObjectType): Type {
  const reducedElements: Record<string, Type> = {};
  for (const [key, value] of Object.entries(type.elements))
    reducedElements[key] = reduceType(value);

  if (Object.values(reducedElements).some((t) => t === 'error')) return 'error';

  return decorate({ ...type, elements: reducedElements });
}

function reduceDictionaryType(type: DictionaryType): Type {
  // We have a `dictionary<V>`

  const reducedValues = reduceType(type.values);
  if (reducedValues === 'error') return 'error';

  // A dictionary of `nothing` is an EMPTY dictionary — writing `Nothing`
  // into an entry deletes it (the same slot-collapse rule lists have), so
  // the only inhabitant is `{->}`. Preserved like `list<nothing>` /
  // `set<nothing>`; this used to reduce to `error`, which was inconsistent
  // with its siblings (user-confirmed 2026-08-18).
  if (reducedValues === 'nothing')
    return decorate({ kind: 'dictionary', values: 'nothing' });

  // Bare `dictionary` is the canonical spelling of `dictionary<unknown>`
  // (user ruling 2026-08-17). Collapsing to the bare NAME is safe where the
  // historical collapse to the top type `any` was not: that one made a
  // `dictionary<unknown>` accept — and be accepted by — every other type,
  // and poisoned any union containing one (`number | dictionary<unknown>`
  // reduced to `any`, after which `string` was a subtype of it). An explicit
  // `<any>` value type is the wider, absence-admitting contract and is
  // preserved exactly as `list<any>` and `set<any>` preserve theirs.
  if (reducedValues === 'unknown') return 'dictionary';

  return decorate({ kind: 'dictionary', values: reducedValues });
}

function reduceSignatureType(type: FunctionSignature): Type {
  const reducedArgs = type.args?.map((arg) => ({
    ...arg,
    type: reduceType(arg.type),
  }));
  let reducedOptArgs = type.optArgs?.map((arg) => ({
    ...arg,
    type: reduceType(arg.type),
  }));
  let reducedVarArg = type.variadicArg
    ? {
        ...type.variadicArg,
        type: reduceType(type.variadicArg.type),
      }
    : undefined;
  const reducedResult = reduceType(type.result);

  if (reducedArgs?.some((arg) => arg.type === 'error')) return 'error';
  if (reducedOptArgs?.some((arg) => arg.type === 'error')) return 'error';
  if (reducedVarArg?.type === 'error') return 'error';
  if (reducedResult === 'error') return 'error';

  reducedOptArgs = reducedOptArgs?.filter((arg) => arg.type !== 'nothing');

  if (reducedArgs?.length === 0) reducedOptArgs = undefined;
  if (reducedOptArgs?.length === 0) reducedOptArgs = undefined;
  if (reducedVarArg?.type === 'nothing') reducedVarArg = undefined;

  return decorate({
    ...type,
    args: reducedArgs,
    optArgs: reducedOptArgs,
    variadicArg: reducedVarArg,
    variadicMin: reducedVarArg ? type.variadicMin : undefined,
    // Canonicalize the effect set (sorted, de-duplicated). A STATED empty set
    // stays `[]` — reduction must not rewrite `(int) pure -> int` into
    // `(int) -> int`, which would delete a token the author wrote (ruled
    // 2026-08-01). Nothing is allocated for an absent specifier — the
    // overwhelmingly common case.
    effects:
      type.effects === undefined
        ? undefined
        : normalizeStatedEffectSet(type.effects),
    result: reducedResult,
  });
}
