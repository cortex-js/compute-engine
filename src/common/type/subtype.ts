import {
  COLLECTION_TYPES,
  COLLECTION_TYPES_SET,
  EXPRESSION_TYPES,
  NUMERIC_TYPES,
  NUMERIC_TYPES_SET,
  INDEXED_COLLECTION_TYPES,
  PRIMITIVE_TYPES,
  PRIMITIVE_TYPES_SET,
  SCALAR_TYPES,
  SCALAR_TYPES_SET,
  VALUE_TYPES,
} from './primitive.js';
import type {
  BroadcastableType,
  CollectionType,
  FunctionSignature,
  ListType,
  NumericPrimitiveType,
  PrimitiveType,
  SetType,
  Type,
  TypeCompatibility,
  TypeReference,
  TypeString,
} from './types.js';
import { parseType } from './parse.js';
import { deepEraseCallbackTypes, eraseCallbackType } from './callback.js';
import { isEffectSubset } from './effects.js';
import {
  _setTypeAlgebra,
  instantiatesTo,
  substituteTypeVariables,
} from './instantiate.js';
import { typeToDedupKey } from './serialize.js';
import { subtypingVarianceOf } from './variance.js';

/** For each key, *all* the primitive subtypes of the type corresponding to that key */
const PRIMITIVE_SUBTYPES: Record<PrimitiveType, PrimitiveType[]> = {
  number: NUMERIC_TYPES,
  non_finite_number: [], //  PositiveInfinity, NegativeInfinity
  finite_number: [
    'finite_complex',
    'finite_real',
    'finite_integer',
    'finite_rational',
  ],
  complex: [
    'finite_complex',
    'imaginary',
    // D10 (2026-07-02): `real ⊂ complex`, properly. `complex` admits ±∞ (it
    // already listed `non_finite_number`), so the infinity-admitting
    // `real`/`rational`/`integer` are genuine subtypes — the numeric tower is
    // `integer ⊂ rational ⊂ real ⊂ complex ⊂ number`. (`isReal` still admits
    // ±∞; D10 is about the LATTICE relation, not that predicate.)
    'real',
    'rational',
    'integer',
    'finite_real',
    'finite_rational',
    'finite_integer',
    'non_finite_number',
  ],
  finite_complex: [
    'imaginary',
    'finite_real',
    'finite_rational',
    'finite_integer',
  ],
  imaginary: [], // Pure, finite, imaginary number
  real: [
    'rational',
    'integer',
    'finite_real',
    'finite_rational',
    'finite_integer',
    'non_finite_number',
  ],
  finite_real: ['finite_rational', 'finite_integer'],
  rational: [
    'finite_rational',
    'finite_integer',
    'integer',
    'non_finite_number',
  ],
  finite_rational: ['finite_integer'],
  integer: ['finite_integer', 'non_finite_number'],
  finite_integer: [],
  any: PRIMITIVE_TYPES,
  unknown: [],
  nothing: [],
  missing: [],
  never: [],
  error: [],
  value: VALUE_TYPES,
  scalar: SCALAR_TYPES,
  collection: COLLECTION_TYPES,
  indexed_collection: INDEXED_COLLECTION_TYPES,
  list: [],
  set: [],
  tuple: [],
  record: [],
  // `record` is a `dictionary` with statically-known keys — the type tree in
  // `doc/08-guide-types.md` nests it under `dictionary`.
  dictionary: ['record'],
  function: [],
  symbol: [],
  boolean: [],
  string: [],
  color: [],
  expression: EXPRESSION_TYPES,
};

/**
 * For each primitive type, the *reflexive transitive closure* of its primitive
 * subtypes, as a `Set` for O(1) membership tests.
 *
 * Computed from `PRIMITIVE_SUBTYPES`. The closure repairs transitivity holes
 * in the hand-maintained table (e.g. `imaginary ⊑ finite_complex ⊑
 * finite_number`, but `imaginary` was missing from `finite_number`'s list).
 */
const PRIMITIVE_SUBTYPES_CLOSURE: Record<
  PrimitiveType,
  Set<PrimitiveType>
> = (() => {
  const closure = {} as Record<PrimitiveType, Set<PrimitiveType>>;

  const closeOver = (t: PrimitiveType): Set<PrimitiveType> => {
    if (closure[t]) return closure[t];
    const result = new Set<PrimitiveType>([t]);
    closure[t] = result; // Set first to guard against (unexpected) cycles
    for (const sub of PRIMITIVE_SUBTYPES[t]) {
      if (sub === t) continue;
      for (const s of closeOver(sub)) result.add(s);
    }
    return result;
  };

  for (const t of Object.keys(PRIMITIVE_SUBTYPES) as PrimitiveType[])
    closeOver(t);

  return closure;
})();

/** Return true if lhs is a subtype of rhs */
export function isPrimitiveSubtype(
  lhs: PrimitiveType,
  rhs: PrimitiveType
): boolean {
  // Mirror `isSubtype`'s special-type precedence EXACTLY so the two exported
  // functions agree on the whole primitive lattice (SYM P2-22). They
  // previously disagreed on `unknown`: `isPrimitiveSubtype` returned `false`
  // for `X <: unknown` while `isSubtype` treats `unknown` as a top type. The
  // ordering below (in particular `nothing` before `unknown`) reproduces
  // `isSubtype` cell-for-cell.

  // `any` is the top type
  if (rhs === 'any') return true;

  // `never` is the bottom type — a subtype of every type
  if (lhs === 'never') return true;
  // No other type is a subtype of `never`
  if (rhs === 'never') return false;

  // No type is a subtype of `error`, except itself
  if (rhs === 'error') return lhs === 'error';

  // `nothing` (unit type) is a subtype only of `any` (handled above) and
  // itself; nothing else is a subtype of `nothing`.
  if (rhs === 'nothing') return lhs === 'nothing';
  if (lhs === 'nothing') return false;

  // `missing` (unit type of an absent-but-positioned value) behaves like
  // `nothing`: a subtype only of `any` (handled above) and itself.
  if (rhs === 'missing') return lhs === 'missing';
  if (lhs === 'missing') return false;

  // `unknown` is a top type: every (remaining) type is a subtype of it, and it
  // is a subtype only of `any`/`unknown`.
  if (rhs === 'unknown') return true;
  if (lhs === 'unknown') return false;

  // Identity
  if (lhs === rhs) return true;

  return PRIMITIVE_SUBTYPES_CLOSURE[rhs].has(lhs);
}

/**
 * The *meet* (greatest lower bound) of two primitive types in the primitive
 * lattice: the maximal primitive types that are subtypes of both `a` and `b`.
 *
 * - If `a ⊑ b` (or `b ⊑ a`), the result is `[a]` (resp. `[b]`).
 * - For incomparable but overlapping types, the result is the set of maximal
 *   common subtypes, e.g. `meet(integer, finite_real)` = `[finite_integer]`
 *   (`integer` admits ±∞, so the overlap is the *finite* integers). Under D10
 *   the numeric tower is a chain (`integer ⊂ rational ⊂ real ⊂ complex ⊂
 *   number`), so `meet(real, complex)` = `[real]` (real is now below complex);
 *   the union-of-maximals case only arises for genuinely incomparable pairs
 *   such as `meet(imaginary, finite_real)` = `[]`.
 * - For disjoint types (e.g. `meet(string, integer)`), the result is `[]`.
 *
 * The special types `any`, `unknown`, `never`, `nothing` and `error` must be
 * handled by the caller (they are not meaningful operands here).
 */
export function meetPrimitiveTypes(
  a: PrimitiveType,
  b: PrimitiveType
): PrimitiveType[] {
  if (a === b) return [a];
  const sa = PRIMITIVE_SUBTYPES_CLOSURE[a];
  const sb = PRIMITIVE_SUBTYPES_CLOSURE[b];
  if (sa.has(b)) return [b];
  if (sb.has(a)) return [a];

  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  const cached = MEET_CACHE.get(key);
  if (cached) return cached;

  // Common subtypes of a and b...
  const common: PrimitiveType[] = [];
  for (const t of sa) if (sb.has(t)) common.push(t);

  // ... reduced to the maximal elements (those not below another common one)
  const maximals = common.filter(
    (t) => !common.some((u) => u !== t && PRIMITIVE_SUBTYPES_CLOSURE[u].has(t))
  );

  MEET_CACHE.set(key, maximals);
  return maximals;
}

const MEET_CACHE = new Map<string, PrimitiveType[]>();

/** True if a numeric type has both a finite lower and a finite upper bound. */
function hasFiniteBounds(t: { lower?: number; upper?: number }): boolean {
  return (
    t.lower !== undefined &&
    t.upper !== undefined &&
    Number.isFinite(t.lower) &&
    Number.isFinite(t.upper)
  );
}

/** The *finite* counterpart of a numeric primitive type (the ±∞-admitting
 *  types map to their finite subtype; already-finite types map to themselves). */
function finiteBaseType(t: NumericPrimitiveType): NumericPrimitiveType {
  switch (t) {
    case 'number':
      return 'finite_number';
    case 'complex':
      return 'finite_complex';
    case 'real':
      return 'finite_real';
    case 'rational':
      return 'finite_rational';
    case 'integer':
      return 'finite_integer';
    default:
      return t;
  }
}

/**
 * The infinity-admitting numeric types, keyed by their *finite* counterpart.
 *
 * A union `finite_X | non_finite_number` covers exactly the same values as the
 * single type `X` (see the numeric tower in `types.ts`: `real = finite_real +
 * non_finite_number`, `integer = finite_integer + non_finite_number`, etc.).
 * Such unions still arise (e.g. from `finite_number ∧ real = finite_real`, or
 * directly-constructed unions), so recognizing the equivalence lets them
 * collapse to — and be seen as equal to — the single covering type `X`. (Under
 * D10 `real ⊂ complex`, so `real ∧ complex = real`; the covering-union map is
 * unchanged and still governs the finite/non-finite collapse.)
 */
export const COVERING_UNION_MAP: Record<string, NumericPrimitiveType> = {
  finite_number: 'number',
  finite_complex: 'complex',
  finite_real: 'real',
  finite_rational: 'rational',
  finite_integer: 'integer',
};

/**
 * If a union contains `non_finite_number` together with a finite numeric type
 * `finite_X`, it also covers the infinity-admitting `X`
 * (`finite_X | non_finite_number ≡ X`). Return the union's members augmented
 * with any such covered supertypes, so a member-wise subtype check can see
 * unions that *cover* a single type (e.g. `real <: finite_real |
 * non_finite_number`). Returns the input unchanged when there is nothing to
 * add.
 */
function unionCoveringMembers(types: Readonly<Type[]>): Readonly<Type[]> {
  if (!types.some((t) => t === 'non_finite_number')) return types;
  let extra: Type[] | undefined;
  for (const t of types) {
    if (typeof t !== 'string') continue;
    const covered = COVERING_UNION_MAP[t];
    if (covered) (extra ??= []).push(covered);
  }
  if (!extra) return types;
  return [...types, ...extra];
}

/**
 * The structural-alias reference records `isSubtype` / `provablyDisjoint` are
 * currently unfolding — one entry per live unfold frame.
 *
 * This is cycle DETECTION, not a depth cutoff. A `TypeReference` is the stable
 * record stored in the lexical scope (`engine-type-resolver.ts` hands the very
 * same object back for every occurrence of the name), so re-entering a record
 * that is already being unfolded means the alias graph has a cycle — either
 * self-referential (`type alias json = list<json> | integer`) or mutual
 * (`a = list<b>`, `b = list<a>`), where lhs/rhs unfolds alternate forever and
 * no same-name short-circuit ever fires. There we answer conservatively; an
 * ACYCLIC alias chain unfolds all the way to its body no matter how long.
 *
 * Module-level (not a parameter) so the recursive `isSubtype` calls made by
 * every other rule participate too — the cycle runs through them, and
 * `provablyDisjoint` shares the state because its unfolds interleave with
 * `isSubtype`'s.
 *
 * INVARIANTS
 * - Each unfold site adds ITS OWN record before recursing and deletes THAT
 *   record in a `finally` — never a wholesale clear. So the set is exactly the
 *   frames currently on the stack, and a nested question asked mid-unfold
 *   (e.g. a union arm's own subtype check) restores the set correctly on the
 *   way out.
 * - A record can never be present twice: `beginUnfold` refuses re-entry, so
 *   the matching `endUnfold` can never delete an entry an outer frame still
 *   owns.
 * - Allocation is lazy and released at depth zero, so the hot ground-type path
 *   (types with no reference in them at all) allocates nothing.
 */
let unfoldingRefs: Set<TypeReference> | null = null;

/** Enter an unfold frame for `ref`. Returns `false` when `ref` is already
 * being unfolded further up the stack — a cycle; the caller must then answer
 * conservatively rather than recurse. */
function beginUnfold(ref: TypeReference): boolean {
  if (unfoldingRefs === null) unfoldingRefs = new Set();
  else if (unfoldingRefs.has(ref)) return false;
  unfoldingRefs.add(ref);
  return true;
}

/** Leave the unfold frame for `ref` (pair with a successful `beginUnfold` in a
 * `finally`). */
function endUnfold(ref: TypeReference): void {
  unfoldingRefs!.delete(ref);
  if (unfoldingRefs!.size === 0) unfoldingRefs = null;
}

/**
 * True when `a` and `b` are *provably* disjoint (no value inhabits both).
 * Used for `A <: !B` (a subtype of a negation iff it is disjoint from the
 * negated type), and exposed to consumers as `BoxedType.isDisjointFrom()`.
 * Conservative: returns `false` (may overlap) whenever disjointness cannot be
 * established, so `isSubtype` never over-claims `A <: !B`.
 *
 * Note that this is *not* the negation of "one is a subtype of the other":
 * `integer | string` and `integer | boolean` are comparable in neither
 * direction, yet they share `integer`.
 */
export function provablyDisjoint(a: Type, b: Type): boolean {
  assertGroundType('provablyDisjoint', a);
  assertGroundType('provablyDisjoint', b);
  // Clause 1: `callback<S>` is the primitive `function` here too.
  a = eraseCallbackType(a);
  b = eraseCallbackType(b);
  if (a === 'never' || b === 'never') return true; // empty set
  if (a === 'any' || b === 'any') return false;

  // A STRUCTURAL alias IS its definition, on either side — the same rule as
  // the LHS unfold in `isSubtype`. Without it the category test below sees a
  // `reference` (no bucket) and falls through to the conservative "may
  // overlap", so `id` (an alias of `integer`) was not provably disjoint from
  // `string`. A NOMINAL reference keeps that conservative answer: its
  // inhabitants are not the definition's.
  //
  // Guarded by the same cycle detection as `isSubtype` (an alias whose
  // definition is another alias can cycle); on a cycle we answer `false` —
  // "may overlap" — which is this predicate's safe direction.
  if (typeof a === 'object' && a.kind === 'reference') {
    if (a.alias !== true || a.def === undefined) return false;
    if (!beginUnfold(a)) return false;
    try {
      return provablyDisjoint(a.def, b);
    } finally {
      endUnfold(a);
    }
  }
  if (typeof b === 'object' && b.kind === 'reference') {
    if (b.alias !== true || b.def === undefined) return false;
    if (!beginUnfold(b)) return false;
    try {
      return provablyDisjoint(a, b.def);
    } finally {
      endUnfold(b);
    }
  }
  // `unknown` absorbs every type, and its lattice entry has no subtypes — so
  // it must short-circuit before the category test below, which would
  // otherwise read that empty entry as "shares nothing".
  if (a === 'unknown' || b === 'unknown') return false;

  // The unit types `nothing` and `missing` need no special case: the subtype
  // check below reports the overlap when the other side contains them, the
  // union distribution reaches them inside a union, and the category test
  // separates them from everything else (and from each other). They USED to
  // short-circuit here as `a !== b`, which compared a string against a
  // composite `Type` object and so claimed `nothing` was disjoint from
  // `boolean | nothing` — refuted by the value `Nothing`, which inhabits both.

  // If either is a subtype of the other, they share values (overlap).
  if (isSubtype(a, b) || isSubtype(b, a)) return false;

  // A union is disjoint from `other` iff every one of its members is.
  // Distributing here is exact, and is what makes the common `A | B` vs
  // `B | C` shape answer "may overlap" instead of falling through to the
  // conservative `false` with no member ever examined.
  if (typeof a === 'object' && a.kind === 'union')
    return a.types.every((t) => provablyDisjoint(t, b));
  if (typeof b === 'object' && b.kind === 'union')
    return b.types.every((t) => provablyDisjoint(a, t));

  // `broadcastable<T>` is the union `T | indexed_collection<T>` (the same
  // expansion `isSubtype` uses on both sides), so it distributes exactly like
  // a union: disjoint from it iff disjoint from BOTH arms. Without this the
  // category test below finds no bucket for the `broadcastable` kind — it
  // spans two — and falls through to the conservative "may overlap". That
  // answer is safe for this predicate in isolation, but `box.ts` only KEEPS an
  // argument-type error when every candidate parameter is provably disjoint,
  // so a never-disjoint parameter kind silently admitted every operand with a
  // free variable: `f: (broadcastable<number>) -> number` accepted a
  // `function`, a `string` and a `boolean`, each of which the plain `(number)`
  // spelling correctly rejects (Tycho item 157(4), generalized).
  if (typeof b === 'object' && b.kind === 'broadcastable')
    return (
      provablyDisjoint(a, b.elements) &&
      provablyDisjoint(a, { kind: 'indexed_collection', elements: b.elements })
    );
  if (typeof a === 'object' && a.kind === 'broadcastable')
    return (
      provablyDisjoint(a.elements, b) &&
      provablyDisjoint({ kind: 'indexed_collection', elements: a.elements }, b)
    );

  // A value literal is a singleton `{v}`: having failed the subtype checks
  // above (it is not contained in the other type), it must be disjoint from it.
  if (
    (typeof a === 'object' && a.kind === 'value') ||
    (typeof b === 'object' && b.kind === 'value')
  )
    return true;

  // Two bounded numeric ranges: disjoint if their base types are disjoint or
  // their intervals do not overlap. Checked before the category test below,
  // which sees only the base types and so cannot separate two ranges.
  if (
    typeof a === 'object' &&
    a.kind === 'numeric' &&
    typeof b === 'object' &&
    b.kind === 'numeric'
  ) {
    if (meetPrimitiveTypes(a.type, b.type).length === 0) return true;
    const aLo = a.lower ?? -Infinity;
    const aHi = a.upper ?? Infinity;
    const bLo = b.lower ?? -Infinity;
    const bHi = b.upper ?? Infinity;
    return aHi < bLo || bHi < aLo;
  }

  // Category test: every type sits in a primitive "bucket" the lattice knows
  // about (`list`, `tuple`, `string`, `function`, …). If two buckets have an
  // empty meet, no value can be in both — a `list<integer>` is not a `string`,
  // a `tuple` is not a `list`, a `record` is not a `dictionary`. This
  // generalizes the primitive-vs-primitive and numeric-vs-non-numeric cases
  // that used to be spelled out separately: the lattice already places the
  // broad buckets (`value`, `scalar`, `expression`) above the narrow ones, so
  // `integer` vs `value` meets at `integer` and correctly reports "may
  // overlap" with no special-casing.
  const categoryA = typeCategory(a);
  const categoryB = typeCategory(b);
  if (
    categoryA !== undefined &&
    categoryB !== undefined &&
    meetPrimitiveTypes(categoryA, categoryB).length === 0
  )
    return true;

  // Conservative: assume they might overlap. Note in particular that two
  // same-category composites whose PARAMETERS cannot coincide (`list<integer>`
  // vs `list<string>`) are NOT disjoint, and this is not merely caution: the
  // empty list inhabits both. It types `list<never>`, which is a subtype of
  // every list type, so it is a witness against any such claim. Use
  // `couldMatch` for the element-shape question.
  return false;
}

/**
 * The primitive category a type inhabits — the coarse bucket the primitive
 * lattice knows about. Two types whose categories have an empty meet cannot
 * share a value.
 *
 * `undefined` for any type that does not sit in a single bucket, and about
 * which the caller must therefore draw no conclusion.
 */
function typeCategory(t: Type): PrimitiveType | undefined {
  assertGroundType('typeCategory', t);
  if (typeof t === 'string') return t as PrimitiveType;
  switch (t.kind) {
    case 'list':
      return 'list';
    case 'set':
      return 'set';
    case 'tuple':
      return 'tuple';
    case 'record':
      return 'record';
    case 'dictionary':
      return 'dictionary';
    case 'collection':
      return 'collection';
    case 'indexed_collection':
      return 'indexed_collection';
    case 'signature':
    // Clause 1: the constructor inhabits the `function` bucket, nothing else.
    case 'callback':
      return 'function';
    case 'symbol':
      return 'symbol';
    case 'expression':
      return 'expression';
    case 'numeric':
      return t.type;
    default:
      // `union` and `value` are handled by the caller. A `broadcastable<T>` is
      // `T | indexed_collection<T>` — it spans two buckets. A `negation` or
      // `intersection` is not a bucket at all, and a `reference`'s meaning is
      // resolver-dependent (`declareType` patches `.def` after construction).
      return undefined;
  }
}

// NOT memoized (perf review, P2-2 — measured 2026-07-18, do not re-attempt
// without a new profile): a resolver-safe memo (identity-keyed WeakMap on the
// interned `Type` objects, gated to pairs with no embedded `reference` type —
// references are the one mutable spot: `declareType` patches `.def` post-
// construction, and their meaning is resolver-dependent) was implemented and
// A/B-measured (interleaved, one process) at 0.85–0.91× on the boxing
// microloop across repeated clean runs: the hot call shapes (instrumented:
// mostly `primitive <: list/matrix/collection` against a small interned set
// of ~1.5k Type objects) resolve in a handful of branches in the walk, so
// cache machinery (WeakMap+Map lookups) costs more than the walk it skips.
// Differential over 2,724 type pairs was identical. The cheap wins here
// already exist: `parseType`'s resolver-less string cache and the
// `PRIMITIVE_SUBTYPES_CLOSURE` O(1) primitive lattice. Any future gain is in
// reducing CALL COUNT (checkNumericArgs / type handlers), not per-call cost.

/**
 * True when the dimensions of two lists could describe the same value.
 * A `-1` is a wildcard ("any size along this axis"), and an absent
 * `dimensions` is unconstrained.
 */
function dimensionsCouldMatch(
  a: number[] | undefined,
  b: number[] | undefined
): boolean {
  if (a === undefined || b === undefined) return true;
  if (a.length !== b.length) return false;
  return a.every((d, i) => d === -1 || b[i] === -1 || d === b[i]);
}

/**
 * True when *some* value inhabits both `a` and `b` — "could a value of type
 * `a` be a `b`?".
 *
 * This is the predicate to use when classifying a value by shape ("might this
 * be a point, a point list, a matrix"). `isSubtype` answers a different
 * question — "is EVERY value of `a` a `b`" — and the two diverge on unions,
 * which are the steady state for a variable declared with more than one
 * admissible shape. `A | B` is a subtype of `B` only if `A` is too, so the
 * subtype reading answers `false` for a union whose members include exactly
 * what was asked about.
 *
 * `couldMatch` distributes over unions at *every* depth, so it is not fooled
 * by a union nested inside a parameter (`list<integer | tuple<number,
 * number>>` could be a `list<tuple<number, number>>` — witness `[(1,2)]`).
 *
 * The relation is symmetric, and strictly more permissive than assignability
 * in either direction, with one deliberate exception: `never` has no
 * inhabitants, so nothing could be a `never` — where `isSubtype` treats it as
 * a subtype of everything.
 *
 * It also deliberately ignores the EMPTY collection as a witness. `[]` types
 * `list<never>` and so inhabits every list type, which on a purist reading
 * would make every pair of list types "could match" and render the predicate
 * useless for classification. `list<integer>.couldMatch('list<string>')` is
 * therefore `false` — the question being asked is about element shape. The
 * empty list's own type answers `true` against any list type, as it should.
 *
 * It is *not* the negation of {@linkcode provablyDisjoint}: that predicate is
 * conservative (unproven ⇒ "may overlap"), which makes it answer `true` for
 * shapes that plainly cannot coincide, such as a `tuple<number, number>` and a
 * `list<tuple<number, number>>`. `couldMatch` is decisive for the composite
 * shapes it models and falls back to assignability elsewhere.
 */
export function couldMatch(a: Type, b: Type): boolean {
  // Clause 1: `callback<S>` is the primitive `function` here too.
  a = eraseCallbackType(a);
  b = eraseCallbackType(b);

  // `never` is uninhabited: no value is one.
  if (a === 'never' || b === 'never') return false;

  // Distribute over unions, at any depth. This is the whole point of the
  // predicate.
  if (typeof a === 'object' && a.kind === 'union')
    return a.types.some((t) => couldMatch(t, b));
  if (typeof b === 'object' && b.kind === 'union')
    return b.types.some((t) => couldMatch(a, t));

  // Structural probe over same-kind composites. This only ever ADDS answers:
  // any shape it does not model falls through to the assignability check
  // below, so the result is never narrower than `matches()` in either
  // direction. Kinds are compared like-with-like — a `set<T>` and a
  // `list<T>` are different runtime shapes, and no value is both.
  if (typeof a === 'object' && typeof b === 'object') {
    if (a.kind === 'list' && b.kind === 'list') {
      if (
        dimensionsCouldMatch(a.dimensions, b.dimensions) &&
        couldMatch(a.elements, b.elements)
      )
        return true;
    } else if (a.kind === 'tuple' && b.kind === 'tuple') {
      const bElements = b.elements;
      if (
        a.elements.length === bElements.length &&
        a.elements.every((x, i) => {
          const y = bElements[i];
          // A name is erasable in the subtype direction, so a named and an
          // unnamed element can describe the same value — but two *different*
          // names cannot.
          if (x.name !== undefined && y.name !== undefined && x.name !== y.name)
            return false;
          return couldMatch(x.type, y.type);
        })
      )
        return true;
    } else if (
      a.kind === b.kind &&
      (a.kind === 'set' ||
        a.kind === 'collection' ||
        a.kind === 'indexed_collection' ||
        a.kind === 'broadcastable')
    ) {
      const elements = (b as SetType | CollectionType | BroadcastableType)
        .elements;
      if (couldMatch(a.elements, elements)) return true;
    }
  }

  // Fall back to assignability in either direction: `a` could be a `b` if
  // every `a` is a `b`, or if some `b`s are `a`s.
  return isSubtype(a, b) || isSubtype(b, a);
}

/** True when this signature carries a `forall` clause (is a polytype). */
function isPolytype(t: FunctionSignature): boolean {
  return t.typeParams !== undefined && t.typeParams.length > 0;
}

/**
 * α-equivalence of two polytype arms: the same shape up to a CONSISTENT
 * renaming of their quantified variables (§5 rule 3).
 *
 * The clauses are paired positionally — `forall T, U. (T, U) -> T` and
 * `forall U, T. (U, T) -> U` are equivalent — and their declared bounds are
 * compared STRUCTURALLY (differing bounds ⇒ not equivalent). The bodies are
 * compared by renaming the lhs's variables to the rhs's names (a simultaneous
 * substitution, so a swap does not capture) and comparing DEDUP KEYS, which is
 * the structural equality the rest of the type layer already keys on.
 *
 * The dedup key, not the plain serialization: `(T) pure -> T` and `(T) -> T`
 * are the two spellings of the same ∅ effect set (`isEffectSubset` already
 * treats them as equal on the ground path), and comparing serializations would
 * make the generic path gratuitously stricter than the ground one.
 *
 * The keys are computed on the CALLBACK-ERASED types (Design D §4 clause 1).
 * The dedup key deliberately PRESERVES `callback<S>` (clause 5, round-tripping)
 * — but this is an admission decision, and for admission `callback<S>` IS the
 * primitive `function`. Without the erasure, `forall T. (collection<T>,
 * callback<(T) -> boolean>) -> integer` and `forall T. (collection<T>,
 * function) -> integer` would be unrelated in BOTH directions, which is exactly
 * the equivalence clause 1 promises. Erasure is DEEP here: unlike the
 * structural walk in `isSubtype`, this path consumes the whole type as one
 * string.
 */
function alphaEquivalentSignatures(
  a: FunctionSignature,
  b: FunctionSignature
): boolean {
  const ap = a.typeParams!;
  const bp = b.typeParams!;
  if (ap.length !== bp.length) return false;

  // A type variable may legally be named `__proto__`, so the renaming map must
  // have no prototype to assign through.
  const renaming: Record<string, Type> = Object.create(null);
  for (let i = 0; i < ap.length; i++) {
    const aBound = ap[i].bound;
    const bBound = bp[i].bound;
    if ((aBound === undefined) !== (bBound === undefined)) return false;
    if (
      aBound !== undefined &&
      erasedDedupKey(aBound) !== erasedDedupKey(bBound!)
    )
      return false;
    renaming[ap[i].name] = { kind: 'variable', name: bp[i].name };
  }

  // Substituting every quantified name also strips the (now fully
  // instantiated) clause, so both sides are compared clause-free.
  const renamed = substituteTypeVariables(a, renaming);
  const stripped: FunctionSignature = { ...b };
  delete stripped.typeParams;
  return erasedDedupKey(renamed) === erasedDedupKey(stripped);
}

/** {@linkcode typeToDedupKey} of `t` with every `callback<S>` erased to
 * `function`, at any depth — the key to compare on an ADMISSION path. */
function erasedDedupKey(t: Type): string {
  return typeToDedupKey(deepEraseCallbackTypes(t));
}

/** Return true if lhs is a subtype of rhs */
export function isSubtype(
  lhs: Type | TypeString,
  rhs: Type | TypeString
): boolean {
  if (typeof lhs === 'string' && !PRIMITIVE_TYPES_SET.has(lhs as PrimitiveType))
    lhs = parseType(lhs);
  if (typeof rhs === 'string' && !PRIMITIVE_TYPES_SET.has(rhs as PrimitiveType))
    rhs = parseType(rhs);

  // Design D §4, contract clause 1: `callback<S>` IS the primitive `function`
  // for every subtyping decision, in both directions. `S` is contextual-typing
  // information, never an admission constraint — erasing it here is what keeps
  // a converted operator's callback slot admitting exactly what the bare
  // `function` slot admitted (a narrower named predicate, a `function`-typed
  // symbol, an unknown-result literal). Shallow: the STRUCTURAL walk below
  // recurses through this same entry point, so a nested occurrence reaching it
  // as a child is erased in turn. It does NOT cover the paths that consume a
  // type whole — notably `alphaEquivalentSignatures`, which compares dedup-key
  // STRINGS (and the key preserves `callback<S>` by clause 5); that path erases
  // deeply for itself.
  lhs = eraseCallbackType(lhs as Type);
  rhs = eraseCallbackType(rhs as Type);

  //
  // A structural alias reference on the LHS unfolds to its definition
  //
  // A `{alias: true}` type IS its definition, so it must behave like it in
  // operand position: `meters <: number` when `type alias meters = number`.
  // Without this, an alias-typed operand is rejected everywhere structure is
  // required (`m + 1`, `First(p)`) — the rhs unfold below only makes alias
  // types *assignable*, not *usable*.
  //
  // A NOMINAL reference (`alias === false`) stays OPAQUE: a nominal type is
  // deliberately not a subtype of its definition.
  //
  // Placed first so it also applies against a primitive rhs (`number`), which
  // the block below short-circuits. Skipped when the rhs is a reference with
  // the SAME name, so the reference-vs-reference reflexivity check further
  // down (`lhs.name === rhs.name`) still answers first — that short-circuit is
  // what terminates a self-referential alias
  // (`type alias json = list<json> | integer`).
  //
  if (
    typeof lhs !== 'string' &&
    lhs.kind === 'reference' &&
    lhs.alias === true &&
    lhs.def !== undefined &&
    !(
      typeof rhs !== 'string' &&
      rhs.kind === 'reference' &&
      rhs.name === lhs.name
    )
  ) {
    // Conservative cycle cutoff. MUTUALLY recursive aliases (`a = list<b>`,
    // `b = list<a>`) alternate lhs and rhs unfolds forever, and no same-name
    // short-circuit ever fires. Re-entering a reference record already on the
    // unfold stack is exactly that situation; we answer `false` ("not provably
    // a subtype") instead of looping. This is a cycle guard, not a coinductive
    // decision procedure, so a subtype relation that only holds *coinductively*
    // (through the cycle) is under-reported — but an acyclic alias chain of any
    // length is answered exactly.
    if (!beginUnfold(lhs)) return false;
    try {
      return isSubtype(lhs.def, rhs);
    } finally {
      endUnfold(lhs);
    }
  }

  // Every type is a subtype of `any`, the top type
  if (rhs === 'any') return true;

  // `never` is the bottom type — a subtype of every type (including itself).
  // This must precede the `rhs === 'never'` check below so `never <: never`
  // is true (reflexivity).
  if (lhs === 'never') return true;

  // `never` is the bottom type, no other type is a subtype of `never`
  if (rhs === 'never') return false;

  // No type is a subtype of `error`, except itself
  if (rhs === 'error') return lhs === 'error';

  // No type is a subtype of `nothing` (unit type), except itself
  if (rhs === 'nothing') return lhs === 'nothing';

  // Nothing is the unit type, it is only a subtype of itself.
  // Gate on a primitive (string) rhs: a composite rhs (e.g. a union that
  // *contains* `nothing`) must fall through to its own handler below so
  // `nothing <: nothing | integer` is true (union-self-membership fix,
  // 2026-07-22). The relative order of these unit-type checks is load-bearing.
  if (lhs === 'nothing' && typeof rhs === 'string') return false;

  // No type is a subtype of `missing` (unit type), except itself
  if (rhs === 'missing') return lhs === 'missing';

  // `Missing` is a unit type, it is only a subtype of itself; gate on a
  // primitive rhs so a composite rhs (e.g. `integer | missing`) falls through.
  if (lhs === 'missing' && typeof rhs === 'string') return false;

  // Every type is a subtype of `unknown`
  if (rhs === 'unknown') return true;
  // 'unknown' is only a subtype of `any` (handled above); gate on a primitive
  // rhs so `unknown <: unknown | integer` falls through to the union handler.
  if (lhs === 'unknown' && typeof rhs === 'string') return false;

  //
  // Handle other subtype of primitive types
  //
  if (typeof rhs === 'string') {
    // Primitive type subtype of another primitive type
    if (typeof lhs === 'string')
      return isPrimitiveSubtype(lhs as PrimitiveType, rhs as PrimitiveType);

    // `broadcastable<T> <: R` (R a primitive) iff `T <: R` and
    // `indexed_collection<T> <: R` (it may be a scalar *or* an indexed
    // collection, so it is a subtype of `R` only when both branches are).
    if (lhs.kind === 'broadcastable') {
      return (
        isSubtype(lhs.elements, rhs) &&
        isSubtype({ kind: 'indexed_collection', elements: lhs.elements }, rhs)
      );
    }

    if (lhs.kind === 'value') {
      if (typeof lhs.value === 'boolean') return rhs === 'boolean';
      if (typeof lhs.value === 'number') {
        // Each numeric literal claims its PRINCIPAL type: NaN inhabits the
        // wide `number` and nothing narrower (`nan ⊄ real` — a boxed NaN
        // types as `number`); ±∞ inhabit `non_finite_number` (⊂ real, per
        // the lattice); a *finite* literal claims the finite base type
        // (`value 0 <: finite_integer`, not merely `integer`). Matches the
        // value-vs-bounded-numeric path.
        if (Number.isNaN(lhs.value))
          return isPrimitiveSubtype('number', rhs as PrimitiveType);
        if (!Number.isFinite(lhs.value))
          return isPrimitiveSubtype('non_finite_number', rhs as PrimitiveType);
        if (Number.isInteger(lhs.value))
          return isPrimitiveSubtype('finite_integer', rhs as PrimitiveType);
        // A non-integer number literal (e.g. 3.5) is a real number, not just
        // `number` — `number ⊄ real`, so the old `'number'` made it fail
        // `value 3.5 <: real`. Matches the symmetric path below.
        return isPrimitiveSubtype('finite_real', rhs as PrimitiveType);
      }
      if (typeof lhs.value === 'string')
        return isPrimitiveSubtype('string', rhs as PrimitiveType);
      return false;
    }

    // A union is a subtype of a type if all of its types is a subtype of the type
    if (lhs.kind === 'union') return lhs.types.every((t) => isSubtype(t, rhs));

    // An intersection is a subtype of a type if any of its types is a subtype of the type
    if (lhs.kind === 'intersection') {
      return lhs.types.some((t) => isSubtype(t, rhs));
    }

    if (lhs.kind === 'negation') {
      // `!A` is the complement of `A` — everything *not* in `A`. It is a
      // subtype of a concrete primitive `S` only when `S` is a top type
      // (`any`/`unknown`), both already handled above. For any other primitive
      // the complement spills outside `S`, so the answer is `false`. (The old
      // `!isSubtype(lhs.type, rhs)` conflated "A ⊄ S" with "!A ⊆ S", making
      // `!string <: integer` — hence `x:!string` `isInteger` — spuriously true.)
      return false;
    }

    if (lhs.kind === 'numeric') {
      // A range with finite numeric bounds cannot be ±∞, so it is a subtype of
      // the *finite* counterpart of its base type even though the base type
      // itself admits ±∞ (e.g. `integer<0..10> ⊑ finite_integer ⊑
      // finite_real`). Without this, `Element(x:integer<0..10>, Integers)`
      // (ℤ = `finite_integer`) was refuted.
      const base = hasFiniteBounds(lhs) ? finiteBaseType(lhs.type) : lhs.type;
      if (!isSubtype(base, rhs)) return false;
      // The bounds always match, since the bounds of the rhs are -∞ and +∞
      return true;
    }

    if (rhs === 'number') return isNumeric(lhs);

    if (rhs === 'symbol') return isSymbol(lhs);

    if (rhs === 'expression') return isExpression(lhs);

    if (rhs === 'function') return isFunction(lhs);

    if (rhs === 'scalar') return isScalar(lhs);

    if (rhs === 'value') return isValue(lhs);

    if (rhs === 'indexed_collection') return isIndexedCollection(lhs);

    if (rhs === 'collection') return isCollection(lhs);

    // A tuple is a subtype of `tuple`
    if (rhs === 'tuple') return lhs.kind === 'tuple';

    // A list is a subtype of `list`
    if (rhs === 'list') return lhs.kind === 'list';

    // A set is a subtype of `set`
    if (rhs === 'set') return lhs.kind === 'set';

    // A record is a subtype of `record`
    if (rhs === 'record') return lhs.kind === 'record';

    // A dictionary is a subtype of `dictionary`. So is a record: a record is
    // a dictionary with statically-known keys (`doc/08-guide-types.md`, the
    // type tree places `record` under `dictionary`).
    if (rhs === 'dictionary')
      return lhs.kind === 'dictionary' || lhs.kind === 'record';

    // Other composite types are not subtypes of primitive types
    return false;
  }

  // A type is a subtype of a union if it is a subtype of any of the types in
  // the union. The member-wise check is incomplete for *covering* unions
  // (e.g. `real <: finite_real | non_finite_number`, where `real` is a subtype
  // of neither member individually), so augment the rhs members with any
  // single type they jointly cover before probing.
  if (rhs.kind === 'union') {
    const rhsMembers = unionCoveringMembers(rhs.types);
    // A broadcastable lhs is the union `T | indexed_collection<T>`, so it fits
    // a union rhs iff BOTH branches are covered — possibly by *different*
    // members (`broadcastable<number> <: number | indexed_collection<number>`).
    // The member-wise probe below would require a single member to cover the
    // whole broadcastable and wrongly reject exactly that case.
    const broadcastableFitsUnion = (b: BroadcastableType) =>
      isSubtype(b.elements, rhs) &&
      isSubtype({ kind: 'indexed_collection', elements: b.elements }, rhs);
    if (typeof lhs !== 'string' && lhs.kind === 'broadcastable')
      return broadcastableFitsUnion(lhs);
    if (typeof lhs !== 'string' && lhs.kind === 'union') {
      // lhs is a union, rhs is a union
      return lhs.types.every((lhsType) =>
        typeof lhsType !== 'string' && lhsType.kind === 'broadcastable'
          ? broadcastableFitsUnion(lhsType)
          : rhsMembers.some((rhsType) => isSubtype(lhsType, rhsType))
      );
    }
    return rhsMembers.some((t) => isSubtype(lhs, t));
  }

  //
  // Handle rhs negation: `A <: !B ⟺ A and B are disjoint` (no common value).
  // This must precede the primitive fall-through below (a string `lhs` would
  // otherwise short-circuit to `false`), and it handles the contravariant
  // `!A <: !B ⟺ B <: A` case.
  //
  if (rhs.kind === 'negation') {
    if (typeof lhs !== 'string' && lhs.kind === 'negation')
      return isSubtype(rhs.type, lhs.type);
    // `lhs` has been reduced to a `Type` (primitive string or object) at the
    // top of the function.
    return provablyDisjoint(lhs as Type, rhs.type);
  }

  //
  // Handle expressions
  //
  if (rhs.kind === 'expression') {
    // A symbol is a subtype of `expression<Op>` only when `Op` is `Symbol` — a
    // symbol is an `expression<Symbol>`, not an `expression<Add>`. (Both symbol
    // branches previously returned `true` for *every* operator, so any symbol
    // matched `expression<Add>`, `expression<Limits>`, etc.)
    if (lhs === 'symbol') return rhs.operator === 'Symbol';
    if (typeof lhs === 'string') return false;
    if (lhs.kind === 'expression') {
      if (rhs.operator === 'Symbol') return isSymbol(lhs);
      return lhs.operator === rhs.operator;
    }
    if (lhs.kind === 'symbol') return rhs.operator === 'Symbol';
  }

  //
  // Handle broadcastable on the rhs: `broadcastable<T>` = a `T`, or an indexed
  // collection of `T` applied element-wise. This must precede the
  // `typeof lhs === 'string'` fall-through below (a string `lhs` such as
  // `integer` would otherwise short-circuit to `false`).
  //
  if (rhs.kind === 'broadcastable') {
    // BOTH broadcastable: covariant in the element type. Checked *before* the
    // scalar branch so `broadcastable<integer> <: broadcastable<number>`
    // matches on the element types rather than falling into the scalar branch.
    if (typeof lhs !== 'string' && lhs.kind === 'broadcastable')
      return isSubtype(lhs.elements, rhs.elements);

    // A union is broadcastable iff each of its members is.
    if (typeof lhs !== 'string' && lhs.kind === 'union')
      return lhs.types.every((t) => isSubtype(t, rhs));

    // Scalar branch: `S <: T ⟹ S <: broadcastable<T>`.
    if (isSubtype(lhs, rhs.elements)) return true;

    // Collection branch: an indexed collection of `S` with `S <: T`. Tuples
    // are excluded (a runtime broadcast binds points atomically) and sets are
    // not indexed, so both — and every non-collection — fail here.
    const elem = broadcastableCollectionElementType(lhs as Type);
    if (elem !== undefined) return isSubtype(elem, rhs.elements);

    return false;
  }

  //
  // Handle broadcastable on the lhs (rhs is a non-broadcastable object):
  // `broadcastable<T> <: R ⟺ T <: R and indexed_collection<T> <: R`.
  //
  if (typeof lhs !== 'string' && lhs.kind === 'broadcastable') {
    return (
      isSubtype(lhs.elements, rhs) &&
      isSubtype({ kind: 'indexed_collection', elements: lhs.elements }, rhs)
    );
  }

  //
  // Handle type references
  //
  // Note: we support both nominal and structural subtyping
  //
  // Checked BEFORE the primitive fall-through below: a primitive lhs must
  // still unfold a structural-alias rhs (`integer <: id` for
  // `type alias id = integer`), which is the mirror of the LHS unfold at the
  // top of this function.
  //
  if (rhs.kind === 'reference') {
    if (typeof lhs !== 'string' && lhs.kind === 'reference')
      return sameTypeApplication(lhs, rhs);
    if (rhs.alias === true && rhs.def) {
      // The rhs is a structural type, so we need to check if the lhs is a subtype of the rhs definition
      return isSubtype(lhs, rhs.def);
    }
  }

  // A primitive type is not a subtype of a composite type (except a union)
  if (typeof lhs === 'string') return false;

  //
  // Handle algebraic types (union or intersection)
  //

  // A value of type `A | B` is a member of exactly ONE arm, but which one is
  // not known, so it is a subtype of `R` only when EVERY arm is — the dual of
  // the intersection rule below. `some` was unsound and, because the
  // primitive-rhs branch above already uses `every`, made the answer depend on
  // the SHAPE of the rhs: `list<tuple<3>> | tuple<3>` matched the composite
  // `tuple<number, number, number>` (any-branch) while `number | list<number>`
  // failed the primitive `number` (all-branch). Tycho item 92.
  if (lhs.kind === 'union') return lhs.types.every((t) => isSubtype(t, rhs));

  if (lhs.kind === 'intersection' && rhs.kind === 'intersection') {
    return rhs.types.every((rhsType) =>
      lhs.types.some((lhsType) => isSubtype(lhsType, rhsType))
    );
  }

  // Handle intersection types with other types
  if (lhs.kind === 'intersection') {
    // lhs is an intersection, rhs is not an intersection.
    //
    // A value of type `A & B` is a member of BOTH arms, so it is a subtype of
    // `R` as soon as ANY arm is (`A & B <: A <: R`). Requiring EVERY arm was
    // sound but so incomplete that an overload set — an intersection of
    // function signatures — was not a subtype of its own members, which in
    // turn broke the `inferredSignature` reconciliation in
    // `boxed-operator-definition.ts`. Matches the primitive-rhs branch above,
    // which already uses `some`.
    return lhs.types.some((lhsType) => isSubtype(lhsType, rhs));
  }

  if (rhs.kind === 'intersection') {
    // lhs is not necessarily an intersection, rhs is an intersection
    return rhs.types.every((rhsType) => isSubtype(lhs, rhsType));
  }

  //
  // Handle function signatures
  //
  if (lhs.kind === 'signature' && rhs.kind === 'signature') {
    //
    // Polytypes (§5 of the type-variables design). The three rules are
    // arm-local: an overload set is an intersection, and the branches above
    // have already reduced it to a per-arm question.
    //
    const lhsPoly = isPolytype(lhs);
    const rhsPoly = isPolytype(rhs);
    if (lhsPoly || rhsPoly) {
      // Rule 3: `Poly <: Poly` is α-equivalence only in v1 (same shape up to
      // consistent renaming, declared bounds compared structurally), plus
      // reflexivity.
      if (lhsPoly && rhsPoly) return alphaEquivalentSignatures(lhs, rhs);
      // Rule 2: `Ground <: Poly` is FALSE. A polytype promises EVERY
      // instantiation; no single ground signature delivers that.
      if (rhsPoly) return false;
      // Rule 1: `Poly <: Ground` — true iff SOME instantiation is a subtype.
      // Instantiate-and-check: solve the ground params against the poly params
      // contravariantly, then run the COMPLETE signature check on the
      // substituted arm (instantiation alone is not acceptance).
      return instantiatesTo(lhs, rhs);
    }

    // Covariant in the effect set, by subset inclusion: `(real) -> real` <:
    // `(real) random -> real` <: `(real) any -> real`. Absent is the empty
    // set (pure), below everything; `any` is the top. Singletons are pairwise
    // incomparable. The contravariant flip in argument position falls out of
    // the argument rules below, which already flip. Stateless — `matches()`
    // stays write-free.
    if (!isEffectSubset(lhs.effects, rhs.effects)) return false;

    // Check the result match covariantly
    if (!isSubtype(lhs.result, rhs.result)) return false;

    if (lhs.optArgs || lhs.variadicArg) {
      //
      // If lhs has optional or variadic arguments, rhs must have them as well
      //

      // Check all the required arguments match contravariantly
      if (rhs.args) {
        if (!lhs.args) return false;
        if (lhs.args.length !== rhs.args.length) return false;
        for (let i = 0; i < rhs.args.length; i++) {
          if (!isSubtype(rhs.args[i].type, lhs.args[i].type)) return false;
        }
      } else if (lhs.args) {
        return false;
      }

      // Check all the optional arguments match contravariantly
      if (rhs.optArgs) {
        if (!lhs.optArgs) return false;
        if (lhs.optArgs.length !== rhs.optArgs.length) return false;
        for (let i = 0; i < lhs.optArgs.length; i++) {
          if (!isSubtype(rhs.optArgs[i].type, lhs.optArgs[i].type))
            return false;
        }
      } else if (lhs.optArgs) {
        return false;
      }

      // Check the rest argument match contravariantly
      if (rhs.variadicArg) {
        if (!lhs.variadicArg) return false;
        if (lhs.variadicMin != rhs.variadicMin) return false;
        if (!isSubtype(rhs.variadicArg.type, lhs.variadicArg.type))
          return false;
      } else if (lhs.variadicArg) {
        return false;
      }
    } else {
      //
      // lhs did not have optional or variadic arguments, so check the arguments that lhs does have against both the required and optional arguments of rhs
      //
      if (rhs.args && !lhs.args) {
        // If rhs has required arguments, lhs must have them as well
        return false;
      }

      let i = 0;
      // A nullary signature has no `args` field at all: treat it as an
      // empty list rather than crashing on `lhs.args!` (a nullary lhs vs a
      // variadic rhs used to throw here).
      const lhsArgs = lhs.args ?? [];
      if (rhs.args) {
        // If lhs doesn't have enough arguments, it is not a subtype
        if (lhsArgs.length < rhs.args.length) return false;
        // Check all the required arguments match contravariantly
        while (i < rhs.args!.length) {
          if (!isSubtype(rhs.args[i].type, lhsArgs[i].type)) return false;
          i += 1;
        }
      }
      if (rhs.optArgs) {
        if (i >= lhsArgs.length) return true;
        // Check all the optional arguments match contravariantly
        for (let j = 0; j < rhs.optArgs.length; j++) {
          if (!isSubtype(rhs.optArgs[j].type, lhsArgs[i].type)) return false;
          i += 1;
          if (i >= lhsArgs.length) return true;
        }
      }
      if (rhs.variadicArg) {
        if (i >= lhsArgs.length && rhs.variadicMin === 0) return true;
        // Check the remaining arguments match the variadic argument contravariantly
        if (rhs.variadicMin! > 0 && i + rhs.variadicMin! > lhsArgs.length)
          return false;
        while (i < lhsArgs.length) {
          if (!isSubtype(rhs.variadicArg.type, lhsArgs[i].type)) return false;
          i += 1;
        }
      }
    }

    return true;
  }

  //
  // Handle Record Type
  //
  // All the fields in the rhs must be present in the lhs
  // but there may be additional fields in the lhs (width subtyping)
  //
  if (lhs.kind === 'record' && rhs.kind === 'record') {
    for (const key of Object.keys(rhs.elements)) {
      if (!(key in lhs.elements)) return false;
      // Depth subtyping
      if (!isSubtype(lhs.elements[key], rhs.elements[key])) return false;
    }
    return true;
  }

  //
  // Handle dictionaries
  //

  if (lhs.kind === 'dictionary' && rhs.kind === 'dictionary') {
    // Check that the type of values match
    return isSubtype(lhs.values, rhs.values);
  }

  // A record is a dictionary whose keys are statically known: it is a subtype
  // of `dictionary<T>` when every one of its field types is a subtype of `T`.
  // (`doc/08-guide-types.md` §Dictionary and Record, "Compatibility".)
  if (lhs.kind === 'record' && rhs.kind === 'dictionary')
    return Object.values(lhs.elements).every((t) => isSubtype(t, rhs.values));

  //
  // Handle collections
  //
  if (rhs.kind === 'indexed_collection') {
    if (lhs.kind === 'indexed_collection')
      return isSubtype(lhs.elements, rhs.elements);

    if (lhs.kind === 'list')
      return (
        isSubtype(lhs.elements, rhs.elements) ||
        peeledRowMatches(lhs, rhs.elements)
      );

    if (lhs.kind === 'tuple') {
      // A tuple is a subtype of a collection if all its elements are subtypes of the collection elements
      return lhs.elements.every((x) => isSubtype(x.type, rhs.elements));
    }
    return false;
  }

  if (rhs.kind === 'collection') {
    if (lhs.kind === 'collection' || lhs.kind === 'indexed_collection')
      return isSubtype(lhs.elements, rhs.elements);

    if (lhs.kind === 'list')
      return (
        isSubtype(lhs.elements, rhs.elements) ||
        peeledRowMatches(lhs, rhs.elements)
      );

    if (lhs.kind === 'tuple')
      return lhs.elements.every((x) => isSubtype(x.type, rhs.elements));

    if (lhs.kind === 'set') return isSubtype(lhs.elements, rhs.elements);

    if (lhs.kind === 'dictionary')
      return isSubtype(
        { kind: 'tuple', elements: [{ type: 'string' }, { type: lhs.values }] },
        rhs.elements
      );

    if (lhs.kind === 'record') {
      return isSubtype(
        {
          kind: 'tuple',
          elements: [
            { type: 'string' },
            { type: widen(...Object.values(lhs.elements)) },
          ],
        },
        rhs.elements
      );
    }
  }

  //
  // Handle tuples
  //
  if (lhs.kind === 'tuple' && rhs.kind === 'tuple') {
    // Check they have the same number of elements
    if (lhs.elements.length !== rhs.elements.length) return false;

    // Check that all the elements match by type (covariantly) and name.
    // Names are erasable in the subtype direction: a *named* tuple is a
    // subtype of a same-shape *unnamed* tuple (`tuple<x: integer, y: integer>
    // <: tuple<integer, integer>`), but not the reverse — the unnamed tuple
    // lacks the field names the named supertype guarantees. So only require a
    // matching name when the rhs (supertype) element is itself named.
    for (let i = 0; i < lhs.elements.length; i++) {
      const a = lhs.elements[i];
      const b = rhs.elements[i];
      if (!isSubtype(a.type, b.type)) return false;
      if (b.name !== undefined && a.name !== b.name) return false;
    }
    return true;
  }

  //
  // Handle lists
  //
  if (rhs.kind === 'list' && lhs.kind === 'list') {
    // Encoding bridge (tensor-unification Phase C): a dimensioned rank-n
    // list IS a list of rank-(n-1) lists — `matrix<E^2x2>` ⊆
    // `list<vector<2>>` (peel the outer dimension, recurse). Only needed
    // when the rhs element is itself list-kind and the direct element check
    // would fail (`E ⊄ vector<2>`); the peeled outer length is bounded by
    // the rhs's outer dimension when it has one.
    const elementsMatch = isSubtype(lhs.elements, rhs.elements);
    if (
      !elementsMatch &&
      lhs.dimensions !== undefined &&
      lhs.dimensions.length >= 2 &&
      typeof rhs.elements !== 'string' &&
      rhs.elements.kind === 'list'
    ) {
      const inner: Type = {
        kind: 'list',
        elements: lhs.elements,
        dimensions: lhs.dimensions.slice(1),
      };
      if (isSubtype(inner, rhs.elements)) {
        // Outer length: rhs unbounded (no dims) always accepts; a
        // dimensioned rhs must accept the peeled outer length.
        if (!rhs.dimensions) return true;
        if (
          rhs.dimensions.length === 1 &&
          (rhs.dimensions[0] === -1 || rhs.dimensions[0] === lhs.dimensions[0])
        )
          return true;
      }
    }

    // Check that the element types match
    if (!elementsMatch) return false;

    // Check that the dimensions match
    if (rhs.dimensions) {
      // If rhs has some dimensions, lhs must have dimensions as well
      if (!lhs.dimensions) return false;
      // The shape (number of dimensions) must match
      if (lhs.dimensions.length !== rhs.dimensions.length) return false;

      for (let i = 0; i < lhs.dimensions.length; i++) {
        // A dimension of -1 means any size is allowed
        if (rhs.dimensions[i] !== -1 && lhs.dimensions[i] !== rhs.dimensions[i])
          return false;
      }
    }

    return true;
  }

  //
  // Handle symbols
  //
  if (lhs.kind === 'symbol' && rhs.kind === 'symbol') {
    return lhs.name === rhs.name;
  }

  //
  // Handle numeric subsets
  //

  // A numeric *value literal* is a subtype of a bounded numeric type when the
  // value satisfies the base kind and lies within the bounds. (Without this,
  // `value 7 <: integer<5..10>` fell through to the value fallback below,
  // which tested `integer <: integer<5..10>` — always `false`.)
  if (rhs.kind === 'numeric' && lhs.kind === 'value') {
    if (typeof lhs.value !== 'number') return false;
    // NaN is unordered: it inhabits no bounded range. (Without the explicit
    // check, `NaN < lower` and `NaN > upper` are both false and the range
    // would ADMIT it.) ±∞ claim their principal `non_finite_number`; the
    // ordinary bound checks then reject them from any finite-bounded range.
    if (Number.isNaN(lhs.value)) return false;
    const baseKind: NumericPrimitiveType = !Number.isFinite(lhs.value)
      ? 'non_finite_number'
      : Number.isInteger(lhs.value)
        ? 'finite_integer'
        : 'finite_real';
    if (!isPrimitiveSubtype(baseKind, rhs.type)) return false;
    if (lhs.value < (rhs.lower ?? -Infinity)) return false;
    if (lhs.value > (rhs.upper ?? Infinity)) return false;
    return true;
  }

  if (lhs.kind === 'numeric' && rhs.kind === 'numeric') {
    // Check that the types match
    if (!isSubtype(lhs.type, rhs.type)) return false;
    // Check that the bounds match
    if ((lhs.lower ?? -Infinity) < (rhs.lower ?? -Infinity)) return false;
    if ((lhs.upper ?? Infinity) > (rhs.upper ?? Infinity)) return false;
    return true;
  }

  if (rhs.kind === 'set' && lhs.kind === 'set') {
    // Check that the element types match
    if (!isSubtype(lhs.elements, rhs.elements)) return false;
    return true;
  }

  // Note: negation on the rhs (including the both-negation `!A <: !B ⟺ B <: A`
  // case) is handled earlier, before the primitive fall-through.

  // Value types (strings, boolean, number). `===` plus an explicit NaN
  // case: the value type `nan` must be a subtype of ITSELF (`NaN === NaN`
  // is false, which made every signature containing `nan` fail its own
  // validation). Not `Object.is` — that would also distinguish ±0, and
  // `-0`/`0` value types denote the same singleton (the engine normalizes
  // both zeros to the exact integer `0` at boxing).
  if (rhs.kind === 'value' && lhs.kind === 'value')
    return (
      rhs.value === lhs.value ||
      (typeof rhs.value === 'number' &&
        Number.isNaN(rhs.value) &&
        typeof lhs.value === 'number' &&
        Number.isNaN(lhs.value))
    );

  if (lhs.kind === 'value') {
    if (typeof lhs.value === 'boolean') return isSubtype('boolean', rhs);
    if (typeof lhs.value === 'number') {
      // Principal-type claims, matching the value-vs-primitive path above:
      // NaN → `number`, ±∞ → `non_finite_number`, finite literals → the
      // finite base type (`value 0 <: finite_integer`).
      if (Number.isNaN(lhs.value)) return isSubtype('number', rhs);
      if (!Number.isFinite(lhs.value))
        return isSubtype('non_finite_number', rhs);
      if (Number.isInteger(lhs.value)) return isSubtype('finite_integer', rhs);
      return isSubtype('finite_real', rhs);
    }
    if (typeof lhs.value === 'string') return isSubtype('string', rhs);
  }

  // If no conditions matched, return false
  return false;
}

export function isCompatible(
  lhs: PrimitiveType,
  rhs: PrimitiveType,
  compatibility: TypeCompatibility
): boolean {
  if (compatibility === 'invariant') return lhs === rhs;

  if (compatibility === 'covariant') return isPrimitiveSubtype(lhs, rhs);

  if (compatibility === 'contravariant') return isPrimitiveSubtype(rhs, lhs);

  return isPrimitiveSubtype(lhs, rhs) && isPrimitiveSubtype(rhs, lhs);
}

function isNumeric(type: Type): boolean {
  if (typeof type === 'string')
    return NUMERIC_TYPES_SET.has(type as NumericPrimitiveType);
  if (type.kind === 'value') return typeof type.value === 'number';
  if (type.kind === 'numeric') return true;
  return false;
}

function isScalar(type: Type): boolean {
  if (isNumeric(type)) return true;
  if (typeof type === 'string')
    return SCALAR_TYPES_SET.has(type as PrimitiveType);
  if (type.kind === 'value')
    return ['string', 'boolean', 'number'].includes(typeof type.value);
  return false;
}

function isCollection(type: Type): boolean {
  if (isIndexedCollection(type)) return true;
  if (typeof type === 'string')
    return COLLECTION_TYPES_SET.has(type as PrimitiveType);
  return ['collection', 'set', 'record', 'dictionary'].includes(type.kind);
}

function isIndexedCollection(type: Type): boolean {
  if (typeof type === 'string') return false;
  return ['indexed_collection', 'list', 'tuple'].includes(type.kind);
}

/**
 * The element type of an indexed collection eligible for broadcasting (a
 * `list` or an `indexed_collection`), or `undefined` for anything else. Tuples
 * are deliberately excluded (a runtime broadcast binds points atomically) and
 * sets are not indexed. Mirrors `collectionElementType` (utils.ts) for the
 * list/indexed-collection cases without importing it (which would reintroduce
 * the subtype ↔ utils cycle).
 */
function broadcastableCollectionElementType(type: Type): Type | undefined {
  if (typeof type === 'string') {
    if (type === 'indexed_collection' || type === 'list') return 'any';
    return undefined;
  }
  if (type.kind === 'indexed_collection') return type.elements;
  if (type.kind === 'list') {
    const dims = type.dimensions;
    // A multi-dimensional list indexed by one index yields a sub-tensor with
    // one fewer dimension, not its scalar element (see `collectionElementType`).
    if (dims && dims.length > 1)
      return {
        kind: 'list',
        elements: type.elements,
        dimensions: dims.slice(1),
      };
    return type.elements;
  }
  return undefined;
}

/**
 * A dimensioned rank-n list (n ≥ 2) has TWO consistent readings as a
 * collection: the flat scalar-dtype reading (`matrix<integer^(2x3)>` is a
 * collection of `integer`) and the peeled reading — the one the runtime uses,
 * where indexing yields a sub-tensor with one fewer dimension ("the first
 * element of a matrix is its first row"). `collectionElementType` (utils.ts)
 * and `broadcastableCollectionElementType` above both report the PEELED row;
 * membership in `collection<E>` / `indexed_collection<E>` must accept it too,
 * or a signature instantiated from the element type (`forall T.
 * (indexed_collection<T>, …)` solving `T = vector<integer^3>`) rejects the very
 * operand that produced it.
 *
 * Additive only: the caller checks the scalar reading first and consults this
 * one afterwards, so both readings are admitted and no previously-accepted
 * membership is lost.
 */
function peeledRowMatches(lhs: ListType, elements: Type): boolean {
  const dims = lhs.dimensions;
  if (!dims || dims.length <= 1) return false;
  return isSubtype(
    { kind: 'list', elements: lhs.elements, dimensions: dims.slice(1) },
    elements
  );
}

function isValue(type: Type): boolean {
  return isScalar(type) || isCollection(type);
}

function isFunction(type: Type): boolean {
  return (
    type === 'function' ||
    (typeof type !== 'string' && type.kind === 'signature')
  );
}

function isExpression(type: Type): boolean {
  if (
    typeof type === 'string' &&
    ['expression', 'symbol', 'function'].includes(type)
  )
    return true;
  if (isValue(type) || isFunction(type) || isSymbol(type)) return true;
  if (typeof type === 'string') return false;
  if (type.kind === 'expression') return true;
  return false;
}

function isSymbol(type: Type): boolean {
  if (type === 'symbol') return true;
  if (typeof type === 'string') return false;
  if (type.kind === 'symbol') return true;
  if (type.kind === 'expression') return type.operator === 'Symbol';
  return false;
}

//
// widen/narrow functions — moved here from utils.ts because they depend on
// isSubtype (breaking the subtype ↔ utils cycle). Re-exported from utils.ts
// for backward compatibility.
//

/** Given two types a and b, return the narrowest type common to a and b */
function narrow2(a: Readonly<Type>, b: Readonly<Type>): Readonly<Type> {
  if (a === b) return a;

  if (a === 'nothing' || b === 'nothing') return 'nothing';

  if (a === 'any') return b;
  if (b === 'any') return a;

  if (a === 'never') return b;
  if (b === 'never') return a;

  if (a === 'unknown') return b;
  if (b === 'unknown') return a;

  if (isSubtype(a, b)) return a;
  if (isSubtype(b, a)) return b;

  // Disjoint types have no common subtype: the narrowest common type is the
  // bottom type `never`. (Returning `superType` would *widen* — the opposite
  // of narrowing, e.g. `narrow('integer', 'string')` → `scalar`.)
  return 'never';
}

/** Given two types, return the broadest  */
function widen2(a: Readonly<Type>, b: Readonly<Type>): Readonly<Type> {
  if (a === b) return a;
  if (a === 'any' || b === 'any') return 'any';

  if (a === 'never') return b;
  if (b === 'never') return a;

  if (a === 'unknown') return b;
  if (b === 'unknown') return a;

  if (a === 'nothing') return b;
  if (b === 'nothing') return a;

  if (isSubtype(a, b)) return b;
  if (isSubtype(b, a)) return a;

  // Two types that are not subtypes of each other. Try the common
  // supertype: this works well for related numeric types (e.g.
  // integer/real → real). But if the supertype collapses to a generic
  // category that loses information (e.g. 'scalar' for number+string,
  // or 'tuple' for two tuples of different shape), surface the
  // heterogeneity as an explicit union so downstream consumers (e.g.
  // the List operator's type handler) can detect mixed-kind content.
  const sup = superType(a, b);
  if (LOSSY_SUPERTYPE.has(sup as string)) return unionTypes(a, b);
  return sup;
}

const LOSSY_SUPERTYPE = new Set<string>([
  'scalar',
  'value',
  'function',
  'expression',
  'collection',
  'indexed_collection',
  'list',
  'set',
  'tuple',
  'record',
  'dictionary',
  'map',
  'any',
]);

/**
 * Two type references relate iff they name the same type AND, when
 * parameterized, agree argument by argument according to the DECLARED variance
 * of each parameter (§4.3):
 *
 * ```
 * out    → Aᵢ <: Bᵢ
 * in     → Bᵢ <: Aᵢ
 * inout  → Aᵢ ≡ Bᵢ   (mutual subtyping)
 * ```
 *
 * The zero-parameter case is the pre-existing nominal rule, unchanged: `point
 * <: point` by name. A declaration whose variance is not yet verified reads as
 * `inout` (ruling C) — see {@link subtypingVarianceOf}.
 *
 * Two APPLICATIONS must additionally be applications of the SAME declaration
 * record. Relating them by NAME alone made shadowed same-name types in nested
 * scopes relate ASYMMETRICALLY: the per-parameter variance was read off the
 * RHS declaration and then applied to the LHS's body, so an outer `box<inout
 * T>` was a subtype of an inner `box<out T>` while the reverse was false — one
 * side's variance granting a relation the other side's body never promised.
 * The record is identity-stable, so this costs nothing legitimate: an in-place
 * redeclaration (N12) keeps it, and a `typeToString`/re-parse round trip
 * resolves back to the same record.
 *
 * When either side has no `decl` back-pointer — a structurally-built node, or
 * one that reached us from outside the resolver — there is no record to
 * compare, so the name comparison stands. That fallback is the PERMISSIVE
 * direction, deliberately: those nodes predate the back-pointer and refusing
 * them would break relations that work today, whereas the asymmetry above only
 * arises between two resolver-built applications.
 *
 * No body is consulted, so no cycle guard is needed at this site: the
 * recursion lives in the arguments, and those are finite.
 */
function sameTypeApplication(
  lhs: Readonly<TypeReference>,
  rhs: Readonly<TypeReference>
): boolean {
  if (lhs.name !== rhs.name) return false;
  const a = lhs.args;
  const b = rhs.args;
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;

  const lhsDecl = (lhs as { decl?: TypeReference }).decl;
  const rhsDecl = (rhs as { decl?: TypeReference }).decl;
  if (lhsDecl !== undefined && rhsDecl !== undefined && lhsDecl !== rhsDecl)
    return false;

  return a.every((x, i) => {
    switch (subtypingVarianceOf(rhs, i)) {
      case 'out':
        return isSubtype(x, b[i]);
      case 'in':
        return isSubtype(b[i], x);
      default:
        return isSubtype(x, b[i]) && isSubtype(b[i], x);
    }
  });
}

/** `JSON.stringify` replacer for the de-dup key below: drop a type reference's
 * resolved `def`.
 *
 * A RECURSIVE type reaches itself through that field — `type tree =
 * tuple<value: any, children: list<tree>>` has `tree.def` containing the very
 * record being serialized — so an unfiltered `JSON.stringify` throws
 * "Converting circular structure to JSON". `def` is also redundant in a key: a
 * reference is identified by its `name` (plus `alias`, both kept), and two
 * references with the same name in the same scope resolve to the same
 * definition. Dropping it is therefore both cycle-safe and lossless — and it
 * is the only back edge, since a cycle can only re-enter through a reference.
 */
function dedupKeyReplacer(key: string, value: unknown): unknown {
  return key === 'def' ? undefined : value;
}

/** Build a union of two types, flattening if either is already a union and
 *  de-duplicating identical members. Returns the simpler type if reducible.
 */
function unionTypes(a: Readonly<Type>, b: Readonly<Type>): Readonly<Type> {
  const members: Type[] = [];
  // de-dup by structural equality: each member's key is computed once
  const keys = new Set<string>();
  const push = (t: Readonly<Type>) => {
    if (typeof t === 'object' && t.kind === 'union') {
      for (const m of t.types) push(m);
      return;
    }
    const key = typeof t === 'string' ? t : JSON.stringify(t, dedupKeyReplacer);
    if (!keys.has(key)) {
      keys.add(key);
      members.push(t as Type);
    }
  };
  push(a);
  push(b);
  if (members.length === 1) return members[0];
  return { kind: 'union', types: members };
}

/** Convert two or more types into a more specific type that is a subtype of
 *  all the input types. The resulting type is usually more constrained and
 *  only encompasses values that belong to both input types.
 */
export function narrow(...types: Readonly<Type>[]): Type {
  assertGroundInputs('narrow', types);
  // The meet of NO types is the top type: nothing has been constrained yet.
  // (`nothing` — the unit type of the value `Nothing` — is neither the top nor
  // the bottom of the lattice; using it here was a false friend for languages
  // whose `Nothing` *is* the bottom type.)
  if (types.length === 0) return 'any';
  if (types.length === 1) return types[0];

  return types.reduce((a, b) => narrow2(a, b));
}

/** Convert two or more types into a broader, more general type that can
 *  accommodate all the input types. The resulting type is usually a supertype
 *  that encompasses the possible values of the input types.
 */
export function widen(...types: Readonly<Type>[]): Readonly<Type> {
  assertGroundInputs('widen', types);
  // The join of NO types is the bottom type — the element type of an EMPTY
  // collection, whose elements are drawn from the empty set. This is what
  // makes `[]` type as `list<never>` and, by covariance, a member of every
  // list type: `never <: X` gives `list<never> <: list<X>`. Returning
  // `nothing` here (the unit type of the value `Nothing`) made `[]` a member
  // of NO list type — `[] <: list<integer>` was false.
  if (types.length === 0) return 'never';
  if (types.length === 1) return types[0];

  return types.reduce((a, b) => widen2(a, b));
}

/**
 * The candidate common supertypes probed by `superType`, ordered from most
 * specific to most general.
 */
const SUPERTYPE_PROBE_ORDER: PrimitiveType[] = [
  'non_finite_number',
  'finite_integer',
  'integer',
  'finite_rational',
  'rational',
  'finite_real',
  'real',
  'imaginary',
  'finite_complex',
  'complex',
  'finite_number',
  'number',
  'list',
  'record',
  'dictionary',
  'set',
  'tuple',
  'indexed_collection',
  'collection',
  'scalar',
  'value',
  'function',
  'expression',
];

/** Memoized results of `superType` for pairs of primitive types */
const PRIMITIVE_SUPERTYPE_CACHE = new Map<string, PrimitiveType>();

function superType(a: Readonly<Type>, b: Readonly<Type>): Type {
  // Return the common super type of a and b
  if (a === b) return a;
  if (a === 'any' || b === 'any') return 'any';
  if (a === 'never') return b;
  if (b === 'never') return a;
  if (a === 'unknown') return b;
  if (b === 'unknown') return a;
  if (a === 'nothing') return b;
  if (b === 'nothing') return a;

  // Fast path: for a pair of primitive types, use a direct lookup table
  // (computed on demand from the closure sets, then memoized)
  if (typeof a === 'string' && typeof b === 'string') {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    let result = PRIMITIVE_SUPERTYPE_CACHE.get(key);
    if (result === undefined) {
      result = 'any';
      for (const ancestor of SUPERTYPE_PROBE_ORDER) {
        const subtypes = PRIMITIVE_SUBTYPES_CLOSURE[ancestor];
        if (
          subtypes.has(a as PrimitiveType) &&
          subtypes.has(b as PrimitiveType)
        ) {
          result = ancestor;
          break;
        }
      }
      PRIMITIVE_SUPERTYPE_CACHE.set(key, result);
    }
    return result;
  }

  // Check in order from most specific to most general
  for (const ancestor of SUPERTYPE_PROBE_ORDER)
    if (isSubtype(a, ancestor) && isSubtype(b, ancestor)) return ancestor;

  return 'any';
}

//
// ── Type variables: dev tripwires and the solver's algebra ───────────────────
//

/**
 * Dev-time tripwire (§4.2): the algebra helpers never see an OPEN type. The
 * production defense is the skip/ground-projection rules in `validate.ts` and
 * the solver's ground-only bound joins — not a throw. `console.assert` is
 * stripped in the minified production build (CLAUDE.md), so this costs nothing
 * where it matters and is loud where a leak would otherwise be silent.
 */
function assertGroundInputs(who: string, types: ReadonlyArray<Type>): void {
  for (const t of types) assertGroundType(who, t);
}

/** @internal — exported for the sibling tripwires in `reduce.ts`.
 *
 * The message is built only on FAILURE: these helpers sit on the hottest path
 * in the type layer, and an eagerly interpolated template per call would be a
 * measurable cost for a dev-only check. */
export function assertGroundType(who: string, t: Type): void {
  if (typeof t === 'object' && t.kind === 'variable')
    console.assert(
      false,
      `${who}() received an open type variable \`${t.name}\` — the ground-type invariant (§4.2) leaked`
    );
}

// Hand the solver (`instantiate.ts`) the three algebra primitives it needs.
// Registered here, unconditionally at module load, because `subtype.ts`
// already depends on `instantiate.ts` and the reverse import would be a cycle
// (zero-cycle budget, CLAUDE.md). Anything that can reach `isSubtype` has
// therefore loaded this module and armed the solver.
_setTypeAlgebra({ isSubtype, widen: widen as (...t: Type[]) => Type, narrow });
