import { isCallbackType } from './callback.js';
import { typeToDedupKey, typeToString } from './serialize.js';
import {
  assertGroundType,
  COVERING_UNION_MAP,
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
 * - `set<any>` -> `set`
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

    // The contextual-callback wrapper is ATOMIC: it is never collapsed to the
    // `function` it means for admission (that erasure is the subtype layer's,
    // and collapsing here would lose the signature the contextual solve
    // reads). Its wrapped signature is reduced like any other.
    case 'callback': {
      const s = reduceSignatureType(type.signature);
      if (typeof s !== 'object' || s.kind !== 'signature') return type;
      return s === type.signature ? type : { kind: 'callback', signature: s };
    }

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

/**
 * Reduce and structurally de-duplicate the member types of an algebraic
 * type. The key of each member is computed once (a string for primitive
 * types, the serialized form otherwise) — no `typeToString` → `parseType`
 * round-trip. The key is `typeToDedupKey`, not the serialization: a
 * stated-pure arrow and a bare one are the same type and must merge, with the
 * order-independent tie-break of {@link addDedupedMember}.
 */
function reduceMembers(types: Readonly<Type[]>): Type[] {
  const result: Type[] = [];
  const seen = new Map<string, number>();
  for (const t of types) {
    const reduced = reduceType(t);
    addDedupedMember(result, seen, typeToDedupKey(reduced), reduced);
  }
  return result;
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
    if (coveredBy !== -1) {
      // Deterministic tie-break for a MUTUALLY-subtype pair, in the spirit of
      // `addDedupedMember`: `callback<S>` erases to the primitive `function`
      // for every admission question (clause 1), so `callback<S>` and
      // `function` absorb each other and plain "first seen wins" would make
      // `callback<S> | function` and `function | callback<S>` reduce
      // differently. The `callback<S>` member wins — it is the one carrying
      // the signature the contextual solve reads, and keeping the bare
      // `function` instead would silently stop the stamping.
      if (
        isCallbackType(current) &&
        !isCallbackType(acc[coveredBy]) &&
        isSubtype(acc[coveredBy], current)
      )
        acc[coveredBy] = current;
      continue;
    }
    for (let i = acc.length - 1; i >= 0; i--)
      if (isSubtype(acc[i], current)) acc.splice(i, 1);
    acc.push(current);
  }

  // Covering-union collapse: `finite_X | non_finite_number ≡ X` for the
  // infinity-admitting numeric tower (real, rational, integer, complex,
  // number). The meet of two incomparable numeric types produces exactly such
  // unions (e.g. `real ∧ complex = finite_real | non_finite_number`); collapse
  // them so the union simplifies to the single covering type at construction.
  // The `acc` members are now mutually incomparable, and the covering finite
  // types form a chain, so at most one is present — a single collapse is
  // deterministic and cannot leave a newly-subsumed sibling behind.
  if (acc.indexOf('non_finite_number' as Type) !== -1) {
    for (let i = 0; i < acc.length; i++) {
      const m = acc[i];
      if (typeof m !== 'string') continue;
      const covered = COVERING_UNION_MAP[m];
      if (covered) {
        acc[i] = covered;
        acc.splice(acc.indexOf('non_finite_number' as Type), 1);
        break;
      }
    }
  }

  if (acc.length === 1) return decorate(acc[0]);
  return decorate({ kind: 'union', types: sortUnionMembers(acc) });
}

/**
 * The *meet* (intersection) of two types.
 *
 * - For subtype-related pairs, the narrower type.
 * - For incomparable but overlapping *primitive* pairs, the meet in the
 *   primitive lattice (see `meetPrimitiveTypes`), e.g.
 *   `integer ∧ finite_real` = `finite_integer` (`integer` admits ±∞, so the
 *   overlap is the finite integers), `finite_number ∧ real` = `finite_real`.
 *   When the maximal common subtypes are incomparable, the meet is their
 *   union. Under D10 the numeric tower is a chain (`real ⊂ complex`), so
 *   `real ∧ complex` = `real`; a union-meet arises only for genuinely
 *   incomparable pairs (e.g. `finite_number ∧ real` = `finite_real`).
 * - Unions (which can arise from previous meets) distribute:
 *   `(a | b) ∧ c` = `(a ∧ c) | (b ∧ c)`.
 * - Incomparable non-primitive pairs are considered disjoint → `nothing`.
 */
function meet2(a: Type, b: Type): Type {
  // Dev tripwire (§4.2): the algebra helpers never see an OPEN type.
  assertGroundType('meet', a);
  assertGroundType('meet', b);
  if (isSubtype(a, b)) return a;
  if (isSubtype(b, a)) return b;

  // Distribute the meet over union members
  if (typeof a === 'object' && a.kind === 'union') return meetUnion(a.types, b);
  if (typeof b === 'object' && b.kind === 'union') return meetUnion(b.types, a);

  if (typeof a === 'string' && typeof b === 'string') {
    const maximals = meetPrimitiveTypes(a as PrimitiveType, b as PrimitiveType);
    if (maximals.length === 0) return 'nothing';
    if (maximals.length === 1) return maximals[0];
    return { kind: 'union', types: maximals };
  }

  // Two bounded numeric ranges (or a range and a bare numeric primitive): the
  // meet is the intersection of their base kinds combined with the
  // intersection of their intervals. Overlapping ranges no longer annihilate
  // to `nothing` (an unsound refutation); only genuinely disjoint ranges do.
  if (
    (typeof a === 'object' && a.kind === 'numeric') ||
    (typeof b === 'object' && b.kind === 'numeric')
  ) {
    const an = asNumericRange(a);
    const bn = asNumericRange(b);
    if (an && bn) return meetNumericRanges(an, bn);
  }

  return 'nothing';
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
 *  interval or disjoint base kinds correctly yield `nothing`. */
function meetNumericRanges(a: NumericType, b: NumericType): Type {
  const bases = meetPrimitiveTypes(a.type, b.type);
  if (bases.length === 0) return 'nothing';

  const lower = Math.max(a.lower ?? -Infinity, b.lower ?? -Infinity);
  const upper = Math.min(a.upper ?? Infinity, b.upper ?? Infinity);
  if (lower > upper) return 'nothing';

  const finite = lower !== -Infinity || upper !== Infinity;
  const ranges: Type[] = [];
  for (const base of bases) {
    // A `non_finite_number` (±∞) cannot inhabit a finite interval.
    if (base === 'non_finite_number' && finite) continue;
    // `bases` are the meet of two numeric primitives, hence numeric.
    ranges.push(makeNumericRange(base as NumericPrimitiveType, lower, upper));
  }

  if (ranges.length === 0) return 'nothing';
  if (ranges.length === 1) return ranges[0];
  return reduceUnionType({ kind: 'union', types: ranges });
}

/** Build a numeric range, collapsing an unbounded range to its base type. */
function makeNumericRange(
  type: NumericPrimitiveType,
  lower: number,
  upper: number
): Type {
  if (lower === -Infinity && upper === Infinity) return type;
  return { kind: 'numeric', type, lower, upper };
}

function meetUnion(types: Readonly<Type[]>, b: Type): Type {
  const members = types.map((t) => meet2(t, b)).filter((t) => t !== 'nothing');
  if (members.length === 0) return 'nothing';
  if (members.length === 1) return members[0];
  return reduceUnionType({ kind: 'union', types: members });
}

function reduceIntersectionType(type: AlgebraicType): Type {
  const reducedTypes = reduceMembers(type.types);

  if (reducedTypes.length === 0) return 'nothing';

  // If the intersection contains an `error`, return `error`
  if (reducedTypes.some((type) => type === 'error')) return 'error';

  // Fold the members pairwise through the meet. Overlapping numeric
  // primitives intersect to their lattice meet (e.g. `integer & finite_real`
  // = `finite_integer`) instead of collapsing to `nothing`; genuinely
  // disjoint types (e.g. `number & boolean`) still annihilate to `nothing`.
  let result: Type = reducedTypes[0];
  for (let i = 1; i < reducedTypes.length; i++) {
    result = meet2(result, reducedTypes[i]);
    if (result === 'nothing') return 'nothing';
  }

  return decorate(result);
}

/**
 * Do the two types have an INHABITED meet, i.e. is there a value that both
 * admit?
 *
 * The predicate protocol conformance uses to decide whether two conformance
 * targets collide (`docs/plans/2026-08-12-protocols-design.md` P4/P9). It is
 * built on the intersection REDUCTION above — `meet2`/`meetNumericRanges`/
 * `meetUnion` — deliberately NOT on `subtype.ts`'s `narrow()`, which
 * short-circuits incomparable pairs to `never` without consulting the numeric
 * ranges and so cannot decide `integer<1..10>` vs `integer<5..20>` (meet
 * `integer<5..10>`, inhabited).
 *
 * The bottom type has TWO spellings here — `reduceIntersectionType` returns
 * `'nothing'` for a disjoint pair while an empty numeric range reduces to
 * `'never'` — and both mean "no value", so both count as empty.
 */
export function typesOverlap(a: Type, b: Type): boolean {
  // Same-head applications are decided ARGUMENT-WISE, not by the reduction:
  // `meet2` treats an incomparable non-primitive pair as disjoint, so
  // `list<integer<1..10>>` and `list<integer<5..20>>` would reduce to
  // `nothing` even though `[7]` inhabits both. Only this predicate takes the
  // shortcut — `meet2`/`reduceType` keep their semantics for every other
  // caller.
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
  return meet !== 'nothing' && meet !== 'never';
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

  // A collection of `any` is a collection
  if (reducedType === 'any') return kind;

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

  // A list of `any` is a list
  if (reducedType === 'any') return 'list';

  let dimensions = type.dimensions;
  if (dimensions) {
    // `-1` means "any size" — a valid, non-degenerate dimension (e.g. a bare
    // `matrix` is `list<list<...>^-1>^-1`). Only a literal `0` makes the list
    // empty; dropping `-1` here turned `matrix` into `nothing`, annihilating
    // any intersection it appeared in.
    dimensions = dimensions.filter((dim) => dim >= 1 || dim === -1);
    if (dimensions.length === 0) return 'nothing';
  }

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

  // A set of `any` is a set
  if (reducedType === 'any') return 'set';

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
  reducedElements = reducedElements.filter(
    (element) => element.type !== 'nothing'
  );

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
  if (reducedValues === 'nothing') return 'error';
  if (reducedValues === 'any' || reducedValues === 'unknown') return 'any';

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
