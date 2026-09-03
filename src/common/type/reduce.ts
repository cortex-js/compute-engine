import { makeNumericRangeType } from './numeric-range.js';
import { typeToDedupKey, typeToString } from './serialize.js';
import {
  assertGroundType,
  isEmptyType,
  isSubtype,
  meetPrimitiveTypes,
} from './subtype.js';
import type {
  Type,
  PrimitiveType,
  NumericPrimitiveType,
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
import { isValidPrimitiveType, NUMERIC_TYPES_SET } from './primitive.js';
import { normalizeStatedEffectSet } from './effects.js';

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
 *   (see {@link meetCollections}); the pair is never empty, because the empty
 *   collection inhabits both.
 * - A pair no rule above applies to yields `undefined`, meaning "no meet
 *   rule, and not shown to be empty either". Only {@link isOverloadPair}
 *   currently reports that; everything else collapses to `never`. Callers
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

  // `broadcastable<T>` denotes the union `T | indexed_collection<T>` — the
  // same expansion `isSubtype` and `provablyDisjoint` use — so it is met by
  // expanding it and letting the union distribution just below do the work.
  //
  // Meeting two broadcastables elementwise instead is wrong, not merely
  // imprecise. That keeps `(A & B) | indexed_collection<A & B>` and drops the
  // cross terms `A & indexed_collection<B>` and `indexed_collection<A> & B`,
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
    // `(real<0..1>) & !0 & !1` reaches `real<0<..<1>` in either order.
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

  // Two applications of the SAME collection constructor meet ELEMENTWISE.
  const collection = meetCollections(a, b);
  if (collection !== undefined) return collection;

  // Tuples meet slot-wise and records meet by merging their keys.
  const structural = meetTuples(a, b) ?? meetRecords(a, b);
  if (structural !== undefined) return structural;

  // No meet rule applies. Two signatures are the one remaining pair that must
  // survive rather than collapse.
  if (isOverloadPair(a, b)) return undefined;

  return 'never';
}

/** `broadcastable<T>` as the union it denotes, `T | indexed_collection<T>`, or
 *  `undefined` when `t` is not a broadcastable. */
function expandBroadcastable(t: Type): Type | undefined {
  if (typeof t !== 'object' || t.kind !== 'broadcastable') return undefined;
  return {
    kind: 'union',
    types: [t.elements, { kind: 'indexed_collection', elements: t.elements }],
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
      if ((a.dimensions?.join() ?? '') !== (other.dimensions?.join() ?? ''))
        return undefined;
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

/** Coerce a numeric primitive string or numeric range object to a
 *  `NumericType`; return `null` for any non-numeric type. */
function asNumericRange(t: Type): NumericType | null {
  if (typeof t === 'object') return t.kind === 'numeric' ? t : null;
  if (NUMERIC_TYPES_SET.has(t as NumericPrimitiveType))
    return { kind: 'numeric', type: t as NumericPrimitiveType };
  return null;
}

/** The meet (intersection) of two bounded numeric types: the intersection of
 *  their base kinds over the intersection of their intervals. An empty
 *  interval or disjoint base kinds correctly yield `never`, the EMPTY type —
 *  never `nothing`, which is the unit type of the symbol `Nothing`. */
function meetNumericRanges(a: NumericType, b: NumericType): Type {
  const bases = meetPrimitiveTypes(a.type, b.type);
  if (bases.length === 0) return 'never';

  // The tighter endpoint wins; at EQUAL endpoints, OPEN wins (the meet of
  // "x ≥ 0" and "x > 0" is "x > 0").
  const aLo = a.lower ?? -Infinity;
  const bLo = b.lower ?? -Infinity;
  const aHi = a.upper ?? Infinity;
  const bHi = b.upper ?? Infinity;
  const lower = Math.max(aLo, bLo);
  const upper = Math.min(aHi, bHi);
  const lowerOpen =
    (aLo === lower && a.lowerOpen === true) ||
    (bLo === lower && b.lowerOpen === true);
  const upperOpen =
    (aHi === upper && a.upperOpen === true) ||
    (bHi === upper && b.upperOpen === true);
  if (lower > upper) return 'never';
  if (lower === upper && (lowerOpen || upperOpen)) return 'never';

  const finite = lower !== -Infinity || upper !== Infinity;
  const ranges: Type[] = [];
  for (const base of bases) {
    // No value of `infinity` (±∞ and the unsigned `~oo`) or `nan` is
    // finite, so neither can inhabit a finite interval. Without this, the
    // meet builds a range such as `infinity<0..10>` that has no members but
    // presents itself as a bounded real.
    if (finite && (base === 'infinity' || base === 'nan')) continue;
    // `bases` are the meet of two numeric primitives, hence numeric.
    ranges.push(
      makeNumericRangeType(
        base as NumericPrimitiveType,
        lower,
        upper,
        lowerOpen,
        upperOpen
      )
    );
  }

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
    for (let i = 0; i < members.length; ) {
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
export function typesOverlap(a: Type, b: Type): boolean {
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
  if (args !== null)
    return args[0].every((t, i) => typesOverlap(t, args[1][i]));

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
      const da = a.dimensions?.join() ?? '';
      const db = other.dimensions?.join() ?? '';
      if (da !== db) return null;
      return [[a.elements], [other.elements]];
    }

    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
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

  let dimensions = type.dimensions;
  if (dimensions) {
    // `-1` means "any size" — a valid, non-degenerate dimension (e.g. a bare
    // `matrix` is `list<list<...>^-1>^-1`). Only a literal `0` makes the list
    // empty; dropping `-1` here turned `matrix` into `nothing`, annihilating
    // any intersection it appeared in.
    dimensions = dimensions.filter((dim) => dim >= 1 || dim === -1);
    if (dimensions.length === 0) return 'nothing';
  }

  // Bare `list` is the canonical spelling of `list<unknown>` (user ruling
  // 2026-08-17) — but only when no dimensions constrain the rank, which the
  // bare form cannot express.
  if (reducedType === 'unknown' && dimensions === undefined) return 'list';

  return decorate({
    ...type,
    dimensions,
    elements: reducedType,
  });
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
  let reducedElements = type.elements.map((element) => ({
    ...element,
    type: reduceType(element.type),
  }));

  // The empty tuple is `nothing`
  if (reducedElements.length === 0) return 'nothing';

  // Note: a single element tuple is not reduced to the element
  // (any) ≠ any

  if (reducedElements.some((element) => element.type === 'error'))
    return 'error';

  // An uninhabited slot empties the whole tuple: every slot must hold a value,
  // so if one of them can hold none, no tuple exists. Note this is the
  // opposite of the `nothing` rule just below, and deliberately so — `nothing`
  // is the unit type, so its slot collapses, while `never` is the empty type,
  // so its slot can never be filled.
  if (reducedElements.some((element) => isEmptyType(element.type)))
    return 'never';

  reducedElements = reducedElements.filter(
    (element) => element.type !== 'nothing'
  );

  // A `nothing` slot collapses (mirroring the value-level rule: writing
  // `Nothing` into a positional slot deletes it), so a tuple whose every
  // slot was `nothing` is the empty tuple — and the empty tuple is
  // `nothing`, per the check above. Without this re-check, `tuple<nothing>`
  // reduced to a bare `tuple`, silently widening it to "any tuple".
  if (reducedElements.length === 0) return 'nothing';

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
