import { makeNumericRangeType } from './numeric-range.js';
import {
  typeToDedupKey,
  typeToIdentityKey,
  typeToString,
} from './serialize.js';
import {
  asNumericRange,
  assertGroundType,
  isEmptyType,
  broadcastCollectionArm,
  isSubtype,
  openSubtypePairs,
  closeSubtypePairs,
  listElementType,
  listShapeKey,
  meetListTypes,
  meetNumericRangeMembers,
  provablyDisjoint,
  meetPrimitiveTypes,
  registerCollectionKindsMeet,
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
import { TYPE_SIZE_LIMIT, typeSizeUpTo } from './size-cap.js';

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

  // Inside a question that unfolds an alias, each node is reduced once (see
  // `reducedInQuestion`).
  if (reducedInQuestion !== undefined) {
    const known = reducedInQuestion.get(type);
    if (known !== undefined) return known;
    const answer = reduceCompositeType(type);
    reducedInQuestion?.set(type, answer);
    return answer;
  }
  return reduceCompositeType(type);
}

function reduceCompositeType(type: Exclude<Type, string>): Type {
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
 * structure — exactly the case where its identity key (`typeToIdentityKey`,
 * the serialization with closed records marked) differs from its
 * de-duplication key, since the key is what elides the ` pure` token.
 */
function carriesStatedPure(t: Type): boolean {
  if (typeof t === 'string') return false;
  return typeToIdentityKey(t) !== typeToDedupKey(t);
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
    typeToIdentityKey(member) !== key &&
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
  //
  // An `unknown` arm (a type still to be inferred, which every type is a
  // subtype of: user decision D1, 2026-10-21) absorbs a value arm, as a top
  // does: `integer | unknown` is `unknown`, "to be inferred". It does not
  // absorb an absence arm: `missing | unknown` and `nothing | unknown` keep
  // both arms, so a read from an unresolved element that can miss keeps the
  // miss visible (`provablyAdmits` reads the marker arm as evidence; the
  // `unknown` arm alone is none). An `error` arm is the standing rule above:
  // the whole union is `error`. `any` covers `unknown` and `unknown` does not
  // cover `any`, in either member order: a contract that admits everything
  // has nothing left to infer. A transparent alias of one of these names is
  // read as the name it stands for.
  const spelled = (t: Type): Type => {
    if (typeof t === 'object' && t.kind === 'reference' && t.alias === true) {
      const def = aliasDefinitionAt(t);
      if (typeof def === 'string') return def;
    }
    return t;
  };
  const covers = (t: Type, by: Type): boolean => {
    if (t === 'never') return true;
    if (spelled(by) !== 'unknown') return isSubtype(t, by);
    const s = spelled(t);
    return s !== 'any' && s !== 'missing' && s !== 'nothing';
  };
  const acc: Type[] = [];
  for (const current of reducedTypes) {
    const coveredBy = acc.findIndex((t) => covers(current, t));
    if (coveredBy !== -1) continue;
    for (let i = acc.length - 1; i >= 0; i--)
      if (covers(acc[i], current)) acc.splice(i, 1);
    acc.push(current);
  }

  if (acc.length === 1) return decorate(acc[0]);
  return decorate({ kind: 'union', types: sortUnionMembers(acc) });
}

/** The answers of `meet2()` during one top-level question, by pair of
 * operands. `undefined` outside a question. */
let meetMemo: Map<Type, Map<Type, Type | undefined>> | undefined;

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
 * - Collections of different kinds meet elementwise too
 *   ({@link meetCollectionKinds}); a list is read by its elements, the rows
 *   of a matrix (`listElementType`).
 * - A pair no rule above applies to yields `undefined`, meaning "no meet
 *   rule, and not shown to be empty either": an overload pair
 *   ({@link isOverloadPair}), a plain list beside a tensor of rank 2 or
 *   more, or of unknown rank, whose rows are neither inside nor disjoint
 *   from the list's elements ({@link meetListTypes}), a transparent alias
 *   that is cut on a recursion or beside another alias, and an operand that
 *   is itself a kept intersection, each
 *   unless {@link provablyDisjoint} refutes it (or, for two aliases,
 *   {@link mayShareFiniteValue}). Everything else collapses
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
  // One question can meet the same pair on several paths: the arms of
  // `list<A^2> | list<A^3>` at each level of a chain of aliases, where the
  // operands are the same alias reference objects of the definitions. Each
  // answer is kept for the rest of the question, so the work grows with the
  // number of distinct pairs, not with the number of paths. An answer is
  // sound on any path (a pair cut by the unfold limit of an alias is kept
  // as written, never refuted without a proof), so reusing it on another
  // path never drops a value.
  const outer = meetMemo === undefined;
  const memo = (meetMemo ??= new Map());
  enterAliasQuestion();
  try {
    const row = memo.get(a);
    if (row?.has(b)) return row.get(b);
    const answer = meet2Uncached(a, b);
    if (row === undefined) memo.set(a, new Map([[b, answer]]));
    else row.set(b, answer);
    return answer;
  } finally {
    leaveAliasQuestion();
    if (outer) meetMemo = undefined;
  }
}

/** The number of `meet2()` and `typesOverlap()` calls on the stack now. */
let aliasQuestionDepth = 0;

/** Whether the outermost `meet2()` or `typesOverlap()` call on the stack
 * opened the memo of `isSubtype` (`openSubtypePairs()`), which it then
 * closes when it returns. */
let aliasQuestionOwnsSubtypePairs = false;

function enterAliasQuestion(): void {
  aliasQuestionDepth += 1;
}

function leaveAliasQuestion(): void {
  aliasQuestionDepth -= 1;
  if (aliasQuestionDepth > 0) return;
  reducedInQuestion = undefined;
  if (aliasQuestionOwnsSubtypePairs) {
    aliasQuestionOwnsSubtypePairs = false;
    closeSubtypePairs(true);
  }
}

/**
 * Keep the answers of `isSubtype` for the rest of the current `meet2()` or
 * `typesOverlap()` question, from the first unfold of an alias. Each level
 * of a chain of aliases asks `isSubtype` about the aliases of all the
 * levels below it, and each `isSubtype` call that is not inside another one
 * starts with an empty memo, so the same pairs were compared again at each
 * level (`A(n) = list<A(n-1)> | list<list<A(n-1)>>`: 10 s at depth 20).
 * An answer that the memo keeps does not depend on where it was asked, and
 * no type declaration changes during one question, so an answer stays
 * correct for the rest of the question. A question that unfolds no alias
 * does not open the memo, so it pays nothing for it.
 */
function keepSubtypeAnswersForQuestion(): void {
  if (aliasQuestionDepth > 0 && !aliasQuestionOwnsSubtypePairs)
    aliasQuestionOwnsSubtypePairs = openSubtypePairs();
  if (aliasQuestionDepth > 0) reducedInQuestion ??= new Map();
}

/**
 * The answers of `reduceType()` for the rest of the current `meet2()` or
 * `typesOverlap()` question, by node, from the first unfold of an alias.
 * `undefined` outside such a question.
 *
 * The meet of an alias with another type reduces the definition of the
 * alias, and the reduction of a union makes a new node. The memo of
 * `meet2()` is keyed by node, so without this memo the meets of the arms of
 * that new node were not found in it, and each level of a chain of aliases
 * met the arms of all the levels below it again
 * (`A(n) = tuple<A(n-1), A(n-1)> | list<A(n-1)>`: 10 s at depth 16). A
 * reduction does not depend on where it is asked in the question, for the
 * same reason that a meet does not (see `meet2()`).
 */
let reducedInQuestion: Map<Type, Type> | undefined;

function meet2Uncached(a: Type, b: Type): Type | undefined {
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
    return provablyDisjoint(a, b) || !mayShareFiniteValue(a, b)
      ? 'never'
      : undefined;
  const throughAlias = throughTransparentAlias(
    a,
    b,
    (x, y) => reduceType({ kind: 'intersection', types: [x, y] }),
    1
  );
  // A meet through an alias that has more than `TYPE_SIZE_LIMIT` nodes,
  // read as a tree, is kept as written. Along a chain of aliases, such a
  // meet is a graph whose tree size grows exponentially with the depth
  // (`tuple<X, X> | list<X>` met with `list<list<Y>> | tuple<Y, Y>`, where
  // `X` and `Y` are the aliases of the level below), and the members of a
  // union are compared and sorted by their serialization, which reads the
  // whole tree. The intersection kept as written has the same values as the
  // meet, so no value is added or dropped.
  if (
    throughAlias !== NO_ALIAS &&
    throughAlias !== undefined &&
    typeSizeUpTo(throughAlias, TYPE_SIZE_LIMIT) > TYPE_SIZE_LIMIT
  )
    return undefined;
  // A cut alias is kept as written unless the pair is provably disjoint, or
  // can share no finite value (a recursive alias).
  if (throughAlias !== NO_ALIAS)
    return (
      throughAlias ??
      (provablyDisjoint(a, b) || !mayShareFiniteValue(a, b)
        ? 'never'
        : undefined)
    );

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

  // A bare collection name is unrestricted. Read its `<any>` form when
  // the structural meet rules below need an explicit element contract.
  const nodeA = bareCollectionAsNode(a);
  const nodeB = bareCollectionAsNode(b);

  // Two applications of the SAME collection constructor meet ELEMENTWISE.
  const collection = meetCollections(nodeA, nodeB);
  if (collection !== undefined)
    return collection === 'keep' ? undefined : collection;

  // Collections of different kinds, one inside the other.
  const nested = meetCollectionKinds(a, b);
  if (nested !== undefined) return nested === 'keep' ? undefined : nested;

  // Tuples meet slot-wise and records meet by merging their keys.
  const structural =
    meetTuples(a, b) ??
    meetRecords(a, b) ??
    meetRecordDictionary(nodeA, nodeB);
  if (structural !== undefined) return structural;

  // No meet rule applies. Two signatures are the one remaining pair that must
  // survive rather than collapse.
  if (isOverloadPair(a, b)) return undefined;

  // A transparent alias, and an intersection kept as written by a rule
  // above (`list<number> & tensor<integer>`, which lists of integers
  // inhabit), have no meet rule of their own. The pair is refuted
  // only when `provablyDisjoint()` proves it disjoint; otherwise it is kept
  // as written. Refuting it refused a value in both: with
  // `type alias Q = indexed_collection<integer>`, a `Q` holding `[1, 2]` is
  // a `list<number>`.
  if (isKeptOperand(a) || isKeptOperand(b))
    return provablyDisjoint(a, b) ? 'never' : undefined;

  return 'never';
}

/** `broadcastable<T>` as the union it denotes: `T`, or its collection arm
 *  (`broadcastCollectionArm` in `subtype.ts`: a tensor of any rank whose
 *  cells are `T` when no value of `T` is a list, a plain `list<T>`
 *  otherwise), or
 *  `undefined` when `t` is not a broadcastable. */
function expandBroadcastable(t: Type): Type | undefined {
  if (typeof t !== 'object' || t.kind !== 'broadcastable') return undefined;
  return {
    kind: 'union',
    types: [t.elements, broadcastCollectionArm(t.elements)],
  };
}

/**
 * The meet of two applications of the SAME collection constructor, or
 * `undefined` when `a` and `b` are not such a pair.
 *
 * Two sets, two collections or two indexed collections meet elementwise.
 * Two lists meet by the rules of `meetListTypes` (`subtype.ts`): two plain
 * lists elementwise, two tensors cellwise with their axes met one by one, a
 * plain list and a rank-1 tensor as that tensor with the meet of the
 * elements and the cells; a plain list beside a tensor of rank 2 or more,
 * or of unknown rank, is the tensor when its rows are inside the elements
 * of the list, `never` when the two share no value, and otherwise `'keep'`,
 * the intersection as written. The meet of two lists is empty (`never`)
 * only when their shapes exclude each other: two plain lists whose element
 * types share no value meet to `list<never>`, the type of the empty list,
 * which is a value of both (`typesOverlap` still counts such a pair as not
 * overlapping, by the protocol rule stated there).
 */
function meetCollections(a: Type, b: Type): Type | 'keep' | undefined {
  if (typeof a !== 'object' || typeof b !== 'object') return undefined;
  if (a.kind !== b.kind) return undefined;

  const meetElements = (x: Type, y: Type): Type =>
    reduceType({ kind: 'intersection', types: [x, y] });

  switch (a.kind) {
    case 'list': {
      const meet = meetListTypes(a, b as ListType, meetElements);
      return meet === 'keep' || meet === 'never' ? meet : decorate(meet);
    }

    case 'collection':
    case 'indexed_collection':
      return decorate({
        ...a,
        elements: meetElements(a.elements, (b as CollectionType).elements),
      });

    case 'set':
      return decorate({
        ...a,
        elements: meetElements(a.elements, (b as SetType).elements),
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
  keepSubtypeAnswersForQuestion();
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

/** How deep `mayShareFiniteValue()` follows the structure of two types
 * before it answers `true`, "may share". A generic alias gives a new
 * definition at each unfold, which the pair guard cannot recognize. */
const SHARED_VALUE_DEPTH = 64;

/** How many pairs `mayShareFiniteValue()` compares before it answers
 * `true`, "may share". An answer reached through a pair met again is not
 * kept, so aliases that name each other can be compared on many paths. */
const SHARED_VALUE_STEPS = 100_000;

/**
 * Whether a finite value can be in both `a` and `b`. `false` is a proof
 * that no value is in both; `true` means "may share" (the answer whenever
 * the test is not sure). The empty collection counts as a shared value, as
 * it does for the meet: `list<A>` and `list<B>` share `[]`.
 *
 * It decides pairs of recursive aliases, which `provablyDisjoint()` does
 * not resolve: with `type alias A = tuple<A> | integer` and
 * `type alias B = tuple<B> | string`, a shared value would be a tuple whose
 * slot is a smaller shared value, so no finite value is in both.
 *
 * The walk unfolds the transparent aliases, takes the arms of the unions,
 * and compares tuples slot by slot and records field by field. Any other
 * pair is decided by `provablyDisjoint()`. A pair met again while it is
 * being answered answers `false` on that path: a finite value of the pair
 * that goes through the pair again contains a smaller value of the same
 * pair, so the smallest one does not go through it. Such a `false` holds
 * for that path only when the pair met again is below the current pair on
 * the stack: the answer of a pair is kept when it is `true`, or when every
 * pair met again is the pair itself or one above it (the lowlink rule of
 * Tarjan's algorithm).
 *
 * The test reads a recursive alias by its finite values, while `isSubtype`
 * reads it coinductively. So a type with no finite value can be a subtype
 * of both operands of a meet that this test refutes: with
 * `type alias V = tuple<V>`, `V` is a subtype of `A` and of `B` above, and
 * `A & B` is `never`. No value is lost: `V` has none.
 */
function mayShareFiniteValue(a: Type, b: Type): boolean {
  // A reference is identified by its declaration (two reference objects
  // that name the same non-generic alias are one type); any other node by
  // its identity.
  const id = (t: Type): Type | TypeReference =>
    typeof t === 'object' &&
    t.kind === 'reference' &&
    (t.args === undefined || t.args.length === 0)
      ? declarationOf(t)
      : t;
  const answers = new Map<unknown, Map<unknown, boolean>>();
  // The pairs being answered, with their depth on the stack.
  const active = new Map<unknown, Map<unknown, number>>();
  let open = 0;
  // The smallest depth of an active pair met again since the current pair
  // started.
  let low = Infinity;
  let steps = 0;
  const walk = (x: Type, y: Type, depth: number): boolean => {
    if (isEmptyType(x) || isEmptyType(y)) return false;
    if (depth > SHARED_VALUE_DEPTH || ++steps > SHARED_VALUE_STEPS) return true;
    const kx = id(x);
    const ky = id(y);
    const known = answers.get(kx)?.get(ky);
    if (known !== undefined) return known;
    const activeAt = active.get(kx)?.get(ky);
    if (activeAt !== undefined) {
      low = Math.min(low, activeAt);
      return false;
    }
    let row = active.get(kx);
    if (row === undefined) active.set(kx, (row = new Map()));
    const index = open++;
    row.set(ky, index);
    const outerLow = low;
    low = Infinity;
    try {
      const answer = walkPair(x, y, depth);
      if (answer || low >= index) {
        let known = answers.get(kx);
        if (known === undefined) answers.set(kx, (known = new Map()));
        known.set(ky, answer);
      }
      return answer;
    } finally {
      row.delete(ky);
      open -= 1;
      low = Math.min(outerLow, low < index ? low : Infinity);
    }
  };
  const walkPair = (x: Type, y: Type, depth: number): boolean => {
    if (isTransparentAlias(x)) {
      const def = aliasDefinitionAt(x);
      return def === undefined || walk(def, y, depth + 1);
    }
    if (isTransparentAlias(y)) {
      const def = aliasDefinitionAt(y);
      return def === undefined || walk(x, def, depth + 1);
    }
    if (typeof x === 'object' && x.kind === 'union')
      return x.types.some((t) => walk(t, y, depth + 1));
    if (typeof y === 'object' && y.kind === 'union')
      return y.types.some((t) => walk(x, t, depth + 1));
    if (
      typeof x === 'object' &&
      typeof y === 'object' &&
      x.kind === 'tuple' &&
      y.kind === 'tuple'
    ) {
      if (x.elements.length !== y.elements.length) return false;
      return x.elements.every((e, i) => {
        const f = y.elements[i];
        if (e.name !== undefined && f.name !== undefined && e.name !== f.name)
          return false;
        return walk(e.type, f.type, depth + 1);
      });
    }
    if (
      typeof x === 'object' &&
      typeof y === 'object' &&
      x.kind === 'record' &&
      y.kind === 'record'
    ) {
      // Records are open: a value of both has the fields of both, and a
      // field that both declare holds a value of both types.
      return Object.keys(x.elements).every(
        (k) =>
          !Object.prototype.hasOwnProperty.call(y.elements, k) ||
          walk(x.elements[k], y.elements[k], depth + 1)
      );
    }
    return !provablyDisjoint(x, y);
  };
  return walk(a, b, 0);
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
  //
  // The arms are a set, so an alias with no type argument is expanded once
  // for the whole walk (`expanded`): expanding it again on each path that
  // reaches it doubled the work at each level of a union of aliases that
  // reach one alias through two arms (`Vₙ = Aₙ | Bₙ`, `Aₙ = Vₙ₋₁`,
  // `Bₙ = Vₙ₋₁ | integer`). An application of a generic alias is checked
  // on its path only (`seen`): two applications of one declaration can have
  // different arms.
  const arms: Type[] = [];
  let changed = false;
  const expanded = new Set<TypeReference>([self]);
  const visit = (t: Type, seen: ReadonlySet<TypeReference>): void => {
    if (typeof t === 'object' && t.kind === 'reference' && t.alias === true) {
      const decl = declarationOf(t);
      const generic = (t.args?.length ?? 0) > 0;
      if (seen.has(decl) || (!generic && expanded.has(decl))) {
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
        if (!generic) expanded.add(decl);
        const next = new Set([...seen, decl]);
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

/** Whether `t` is a transparent alias or an intersection: an operand that
 * `meet2()` keeps as written when it cannot refute the pair. */
function isKeptOperand(t: Type): boolean {
  if (typeof t !== 'object') return false;
  if (t.kind === 'intersection') return true;
  return t.kind === 'reference' && t.alias === true;
}

/** A bare `list`, `indexed_collection`, `collection` or `set` as its
 * `<any>` form (`list<any>`), which it means; any other type
 * unchanged. */
function bareCollectionAsNode(t: Type): Type {
  return t === 'list' ||
    t === 'indexed_collection' ||
    t === 'collection' ||
    t === 'set'
    ? ({ kind: t, elements: 'any' } as Type)
    : t;
}

/**
 * `[narrow, wide]` when `a` and `b` are collection types of different kinds
 * and one kind is inside the other, and `undefined` otherwise. A list and a
 * tuple are indexed collections, an indexed collection and a set are
 * collections. A bare `list`, `indexed_collection` or `collection` is read
 * as its `<any>` form.
 */
function collectionKindPair(
  a: Type,
  b: Type
):
  | [ListType | CollectionType | SetType | TupleType, CollectionType]
  | undefined {
  const x = bareCollectionAsNode(a);
  const y = bareCollectionAsNode(b);
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
 * A list is read by its elements (`listElementType`): the cells of a rank-1
 * tensor, the rows of a deeper one. The meet of a tensor with a dimension
 * list and a `collection<F>` is the tensor whose rows are the meet of its
 * rows with `F`: `matrix<number> & collection<vector<integer>>` is
 * `matrix<integer>`, and `matrix<integer> & collection<number>` is `never`
 * (no row of a matrix is a number). When the meet of the rows is not a
 * tensor of the lower rank with the same cells, the pair is kept as
 * written. A tensor of unknown rank beside a collection is read at rank 1
 * (its elements are cells) and at rank 2 or more (its elements are
 * tensors), and is kept as written when the two readings give different
 * cells (see the comment in the function). An empty element meet
 * leaves the empty collection, except for a tensor whose length is fixed
 * and not zero, and for a tuple, whose every slot must hold a value: those
 * give `never`.
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
  if (narrow.kind === 'list' && narrow.dimensions === null) {
    // A tensor of unknown rank `tensor<U>` beside a `collection<E>` or an
    // `indexed_collection<E>`. A value of both is a tensor each of whose
    // elements is in `E`. At rank 1 its elements are cells, in `U & E`
    // (`cells` below). At rank 2 or more its elements are tensors of cells
    // `U`, in `tensor<U> & E` (`rows` below), and its cells are the cells
    // of those rows. So:
    // - when no row can be in `E` (`rows` is empty, or `tensor<U>` is
    //   provably disjoint from `E`), only the rank-1 reading remains:
    //   `vector<U & E>`, the lists of cells in both, and `list<never>` (the
    //   empty list, in both) when the cells meet to `never`;
    // - `tensor<U & E>` when it is in both (its elements, `C | tensor<C>`
    //   with `C = U & E`, are in `E`) and it holds every value of rank 2 or
    //   more (the rows are a `tensor<C>`): `tensor<number> &
    //   collection<integer | tensor<integer>>` is `tensor<integer>`. `meet2`
    //   answers the case `U | tensor<U> <: E` before reaching here.
    // - otherwise the intersection is kept as written. The two readings can
    //   give different cells: `tensor<number> & collection<tensor<integer>>`
    //   holds the integer matrices, but its rank-1 values are only the empty
    //   list, so neither `tensor<never>` nor `tensor<integer>` is the meet.
    const cells = meetElements(narrow.elements);
    const cellTensor: ListType = {
      kind: 'list',
      elements: cells,
      dimensions: null,
    };
    const tensorOfU: ListType = {
      kind: 'list',
      elements: narrow.elements,
      dimensions: null,
    };
    const rows = reduceType({
      kind: 'intersection',
      types: [tensorOfU, wide.elements],
    });
    if (isEmptyType(rows) || provablyDisjoint(tensorOfU, wide.elements)) {
      if (isEmptyType(cells))
        return decorate({ kind: 'list', elements: 'never' });
      return decorate({ kind: 'list', elements: cells, dimensions: [-1] });
    }
    if (
      isSubtype(listElementType(cellTensor), wide.elements) &&
      isSubtype(rows, cellTensor)
    )
      return decorate(cellTensor);
    return 'keep';
  }
  if (
    narrow.kind === 'list' &&
    narrow.dimensions &&
    narrow.dimensions.length > 1
  ) {
    const dims = narrow.dimensions;
    const rows = meetElements(listElementType(narrow));
    if (isEmptyType(rows)) return 'never';
    // The rows met to a tensor of the lower rank: the result has the outer
    // axis of the narrow tensor before the axes of that meet.
    if (
      typeof rows === 'object' &&
      rows.kind === 'list' &&
      rows.dimensions &&
      rows.dimensions.length === dims.length - 1 &&
      rows.dimensionVariables === undefined
    )
      return decorate({
        kind: 'list',
        elements: rows.elements,
        dimensions: [dims[0], ...rows.dimensions],
      });
    return 'keep';
  }
  const elements = meetElements(narrow.elements);
  if (
    isEmptyType(elements) &&
    narrow.kind === 'list' &&
    narrow.dimensions &&
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

  // A closed record (the type of a dictionary value) has exactly its listed
  // keys. A value of both types has every key of both, so a closed side that
  // does not list a key of the other side shares no value with it.
  const hasKeysOf = (x: RecordType, y: RecordType) =>
    Object.keys(y.elements).every((k) =>
      Object.prototype.hasOwnProperty.call(x.elements, k)
    );
  if (a.closed === true && !hasKeysOf(a, b)) return 'never';
  if (b.closed === true && !hasKeysOf(b, a)) return 'never';

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

  if (a.closed === true || b.closed === true)
    return decorate({ kind: 'record', elements, closed: true });
  return decorate({ kind: 'record', elements });
}

/**
 * The meet of a RECORD type and a DICTIONARY type, or `undefined` when `a`
 * and `b` are not such a pair.
 *
 * A value of `dictionary<V>` holds a `V` under each of its keys. A value of
 * the record type has every field of the record, and an open record also
 * allows other fields of any type. So a value of both has the fields of the
 * record, each field holds a value of the field type and of `V`, and every
 * other field also holds a `V`. The meet is the CLOSED record whose fields
 * are the record fields, each met with `V`: `record{a: integer} &
 * dictionary<number>` is the closed `record{a: integer}`, the type of
 * `{a: 1}`. The closed record does not describe the values with more fields
 * (`{a: 1, b: 2}`): no type spells "these fields, and others of type `V`",
 * and the closed record is the nearest type below both operands. The meet is
 * `never` only when a field cannot hold a `V`, since a field must hold a
 * value: `record{a: string} & dictionary<integer>` is `never`.
 */
function meetRecordDictionary(a: Type, b: Type): Type | undefined {
  if (typeof a !== 'object' || typeof b !== 'object') return undefined;
  let record: RecordType;
  let dictionary: DictionaryType;
  if (a.kind === 'record' && b.kind === 'dictionary') {
    record = a;
    dictionary = b;
  } else if (a.kind === 'dictionary' && b.kind === 'record') {
    record = b;
    dictionary = a;
  } else return undefined;

  const elements: Record<string, Type> = {};
  for (const [key, type] of Object.entries(record.elements)) {
    const meet = reduceType({
      kind: 'intersection',
      types: [type, dictionary.values],
    });
    if (isEmptyType(meet)) return 'never';
    elements[key] = meet;
  }
  return decorate({ kind: 'record', elements, closed: true });
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
  enterAliasQuestion();
  try {
    const known = memo.get(a)?.get(b);
    if (known !== undefined) return known;
    const answer = typesOverlapUncached(a, b);
    let row = memo.get(a);
    if (row === undefined) memo.set(a, (row = new Map()));
    row.set(b, answer);
    return answer;
  } finally {
    leaveAliasQuestion();
    if (outer) overlapMemo = undefined;
  }
}

function typesOverlapUncached(a: Type, b: Type): boolean {
  // A transparent alias is compared through its definition, so that the
  // rules below apply to it: with `type alias A = list<integer>`,
  // `list<A>` and `list<list<string>>` do not overlap, as `list<list<integer>>`
  // and `list<list<string>>` do not. An alias cut on a recursion overlaps
  // unless a proof refutes the pair: `provablyDisjoint()`, or
  // `mayShareFiniteValue()` for a recursive alias with no finite value in
  // common (`type alias A = tuple<A> | integer` and
  // `type alias B = tuple<B> | string`). `couldMatch()` is not such a proof:
  // its last test is assignability, which misses many overlapping pairs, and
  // a pair called disjoint here refuses an argument. So two aliases that
  // share empty lists only (`type alias A = list<A> | integer` and
  // `type alias B = list<B> | string`) overlap here, the safe answer.
  const throughAlias = throughTransparentAlias(a, b, typesOverlap);
  if (throughAlias !== NO_ALIAS)
    return (
      throughAlias ?? (!provablyDisjoint(a, b) && mayShareFiniteValue(a, b))
    );

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
  // COLLECTIONS with disjoint element types still share the EMPTY value,
  // so strictly they are not disjoint. The ruling counts them as
  // non-overlapping — an empty collection carries no element a conformance
  // could ever dispatch on. Two PLAIN LISTS are the exception since
  // 2026-10-21: their meet is `list<never>` (the empty list, a value of
  // both, `meetListTypes`), and this predicate agrees with the meet, as
  // `couldMatch` does: `list<integer>` and `list<list<integer>>` overlap.
  // So do two tensors of unknown rank, or one beside a plain list: their
  // meet holds the empty list too (`tensor<integer> & tensor<string>` is
  // `tensor<never>`, and `broadcastable<integer>` and
  // `broadcastable<string>` share it through their tensor arms).
  if (
    typeof a === 'object' &&
    typeof b === 'object' &&
    a.kind === 'list' &&
    b.kind === 'list' &&
    !a.dimensions &&
    !b.dimensions
  )
    return true;
  const args = sameHeadArguments(a, b);
  if (args !== null)
    return args[0].every((t, i) => typesOverlap(t, args[1][i]));

  // Two list types of different shapes, by the rules of the meet
  // (`meetListTypes`, which answers `never` only when the shapes exclude
  // each other). Two tensors with dimension lists share a value when their
  // ranks are the same, each axis is open on one side or the same length
  // on both, and their cells overlap, or when both admit the empty shape
  // (a first axis that is open or zero); a tensor of unknown rank shares a
  // value with any tensor whose cells overlap its own, and the empty list
  // with any of them. A plain list and a rank-1 tensor share the empty
  // list unless the tensor's length is fixed and positive, in which case
  // their elements must overlap. A plain list and a tensor of rank 2 or
  // more share a value when the elements of the list overlap the rows of
  // the tensor (`listElementType`): `list<list<integer>>` and
  // `matrix<number>` share integer matrices, `list<number>` and
  // `matrix<integer>` share none (the empty list is not a matrix).
  if (
    typeof a === 'object' &&
    typeof b === 'object' &&
    a.kind === 'list' &&
    b.kind === 'list'
  ) {
    const emptyAdmitted = (t: ListType): boolean =>
      t.dimensions === undefined ||
      t.dimensions === null ||
      (t.dimensions.length === 1 && t.dimensions[0] <= 0);
    if (a.dimensions !== undefined && b.dimensions !== undefined) {
      const da = a.dimensions;
      const db = b.dimensions;
      if (da && db) {
        if (da.length !== db.length) return false;
        for (let i = 0; i < da.length; i++)
          if (da[i] !== -1 && db[i] !== -1 && da[i] !== db[i]) return false;
        if (da[0] <= 0 && db[0] <= 0) return true;
      } else {
        // A tensor of unknown rank holds the empty list `[]`, as does
        // another tensor of unknown rank, a tensor whose first axis has
        // length 0, and a rank-1 tensor with an open length (the subtype
        // rule for `list<never>`): `tensor<integer>` and `tensor<string>`
        // share `[]` although their cells do not overlap.
        const other = da ?? db;
        if (
          other === null ||
          other === undefined ||
          other[0] === 0 ||
          (other.length === 1 && other[0] === -1)
        )
          return true;
      }
      if (da?.[0] === 0 || db?.[0] === 0) return false;
      return typesOverlap(a.elements, b.elements);
    }
    const tensor = a.dimensions === undefined ? b : a;
    if (emptyAdmitted(tensor)) return true;
    if (tensor.dimensions![0] === 0) return false;
    return typesOverlap(listElementType(a), listElementType(b));
  }

  // A broadcastable is `T` or its collection arm (`tensor<T>`, or
  // `list<T>` when `T` can hold a list): its arms are compared one by one,
  // with the rule above for each pair, so the cross terms are read
  // (`broadcastable<integer>` and `broadcastable<list<integer>>` share
  // `[1, 2]`), and two collection arms share the empty list
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
  // (`collectionKindPair()`): `list<integer>` and `collection<string>`
  // share the empty collection only, as `list<integer>` and `list<string>`
  // do. A list is read by its elements (`listElementType`), so
  // `matrix<integer>` and `collection<number>` share no value, while
  // `matrix<integer>` and `collection<list<integer>>` share every integer
  // matrix.
  const kinds = collectionKindPair(a, b);
  if (kinds !== undefined) {
    const [narrow, wide] = kinds;
    if (narrow.kind === 'tuple')
      return narrow.elements.every((e) => typesOverlap(e.type, wide.elements));
    if (narrow.kind === 'list') {
      // A plain list beside an abstract collection shares the empty list,
      // as two plain lists do (its meet is a list of the element meet,
      // never empty).
      if (narrow.dimensions === undefined) return true;
      if (narrow.dimensions?.[0] === 0) return false;
      return typesOverlap(listElementType(narrow), wide.elements);
    }
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
      // A differing shape is not an argument-wise question. A plain list
      // and a tensor of unknown rank are different shapes (`listShapeKey`).
      if (listShapeKey(a) !== listShapeKey(other)) return null;
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

  // Preserve explicit contents; bare names have unrestricted contents.

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

  // Every axis is kept, a zero-length axis too. `matrix<integer^(2x0)>` is two
  // empty rows: a value the engine can hold, of rank 2 and with 0 elements.
  // Dropping the zero axis changed the rank of the type (it became
  // `vector<integer^2>`, a list of two integers), and an all-zero shape is
  // the type of an empty list with its axes, not the type `nothing`.
  // `-1` ("any size", the axis a dimension variable rides on) is kept too.
  const dimensions = type.dimensions;
  const dimensionVariables = type.dimensionVariables;

  // Preserve explicit contents; bare names have unrestricted contents.

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

  // Preserve explicit contents; bare names have unrestricted contents.

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
  const count = Object.keys(reducedElements).length;
  reducedElements = Object.fromEntries(
    Object.entries(reducedElements).filter(([_, value]) => value !== 'nothing')
  );

  // An empty record is `record`
  if (Object.keys(reducedElements).length === 0) return 'record';

  // A closed record (the type of a dictionary value) lists every key of its
  // values. When a key was removed above, the values still have that key, so
  // the result is the open record.
  if (type.closed === true && Object.keys(reducedElements).length !== count) {
    const { closed: _closed, ...open } = type;
    return decorate({ ...open, elements: reducedElements });
  }

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

  // Preserve explicit contents; bare names have unrestricted contents.

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

// `narrow()` (`subtype.ts`) cannot import this file (it would be a cycle), so
// it reads this rule through a registration.
registerCollectionKindsMeet(meetCollectionKinds);
