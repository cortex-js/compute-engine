import {
  BARE_COLLECTION_STRUCTURAL_TYPE,
  BARE_DICTIONARY_STRUCTURAL_TYPE,
  BARE_INDEXED_COLLECTION_STRUCTURAL_TYPE,
  BARE_LIST_STRUCTURAL_TYPE,
  BARE_SET_STRUCTURAL_TYPE,
  COLLECTION_TYPES,
  COLLECTION_TYPES_SET,
  EXPRESSION_TYPES,
  NUMERIC_TYPES,
  NUMERIC_TYPES_SET,
  INDEXED_COLLECTION_TYPES,
  PRIMITIVE_TYPES,
  PRIMITIVE_TYPES_SET,
  RANGE_STRUCTURAL_TYPE,
  SCALAR_TYPES,
  SCALAR_TYPES_SET,
  STRING_STRUCTURAL_TYPE,
  VALUE_TYPES,
} from './primitive.js';
import { isComplexInfinityValue } from './types.js';
import type {
  BroadcastableType,
  CollectionType,
  DictionaryType,
  FunctionSignature,
  ListType,
  NumericPrimitiveType,
  ObjectType,
  PrimitiveType,
  SetType,
  Type,
  TypeCompatibility,
  TypeReference,
  TypeString,
} from './types.js';
import { parseType } from './parse.js';
import { isEffectSubset } from './effects.js';
import {
  _setTypeAlgebra,
  aliasDefinitionAt,
  instantiatesTo,
  substituteTypeVariables,
} from './instantiate.js';
import { typeToDedupKey } from './serialize.js';
import { declarationOf } from './reference.js';
import { subtypingVarianceOf } from './variance.js';

/** For each key, *all* the primitive subtypes of the type corresponding to that key */
const PRIMITIVE_SUBTYPES: Record<PrimitiveType, PrimitiveType[]> = {
  // `number` is the top of a DISJOINT decomposition: every numeric value is a
  // finite number (`complex`), a value of infinite magnitude (`infinity`) or
  // the not-a-number marker (`nan`), and no value is two of those. It shares
  // `NUMERIC_TYPES` by reference, so it lists every numeric name.
  number: NUMERIC_TYPES,
  // A number of infinite magnitude, of any direction: the signed `+∞`/`−∞`
  // and the unsigned `~∞` are value literals placed under `infinity` by the
  // value-literal rules in `isSubtype`, and a mixed directed value such as
  // `∞ + i` is an anonymous further inhabitant with no name of its own. The
  // signed pair has no one-word name — spell it `+oo | -oo` (its former
  // name `non_finite_number` retired 2026-08-31, ruling L5 executed).
  // `infinity` is deliberately absent from the child list of every other
  // entry: the bare numeric names are finite, so `real ∩ infinity` is empty
  // (`meetPrimitiveTypes('real', 'infinity')` = `[]`).
  infinity: [],
  // The not-a-number marker: an atom with no subtypes, and — being listed by
  // no entry but `number` (through `NUMERIC_TYPES`) — disjoint from every other
  // numeric type.
  nan: [],
  // `complex` is the FINITE complex numbers, and so is the whole chain below
  // it: after the lattice flip every bare name under `number` admits only
  // finite values. `real ⊂ complex` properly, and the infinities are gone
  // from this subtree — they live under `infinity` alone, as value
  // literals — which is what makes `number` decompose disjointly.
  // `matches('complex')` is
  // therefore the engine's canonical finiteness test (`BoxedSymbol.isFinite`,
  // `factsFromType`, the `Re`/`Im`/`Arg`/`Abs` type handlers all ask it).
  complex: ['imaginary', 'real', 'rational', 'integer'],
  imaginary: [], // Pure, finite, imaginary number
  real: ['rational', 'integer'],
  rational: ['integer'],
  integer: [],
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
  // An index span has no primitive subtypes. It is a subtype of
  // `indexed_collection` (and thence `collection`) through the
  // `indexed_collection` entry above, which lists it. Against a
  // PARAMETERIZED rhs (`indexed_collection<integer>`, `collection<number>`)
  // it is expanded structurally to `RANGE_STRUCTURAL_TYPE`
  // (`indexed_collection<integer>`, defined in `primitive.ts`) in `isSubtype`.
  range: [],
  set: [],
  tuple: [],
  record: [],
  // Bare `object` ("any object") has no primitive subtypes and is a subtype of
  // no primitive but `value`/`expression`/`any`. In particular it is DISJOINT
  // from `record`, in both directions: the two are sibling categories, one
  // immutable and structural, one mutable and nominal, and a value of one is
  // never a value of the other (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B,
  // ruling B6). Declared object types reach `object` through the nominal rule
  // in `isSubtype`, not through this table.
  object: [],
  // A record is a dictionary with statically known keys.
  dictionary: ['record'],
  function: [],
  symbol: [],
  boolean: [],
  // A string has no primitive subtypes. It is a subtype of
  // `indexed_collection` (and thence `collection`) through the
  // `indexed_collection` entry above, which lists it. Against a PARAMETERIZED
  // rhs (`indexed_collection<character>`, `collection<character>`) it is
  // expanded structurally to `STRING_STRUCTURAL_TYPE` in `isSubtype`. In
  // particular `character` is NOT here: the two are disjoint siblings.
  string: [],
  // One grapheme cluster: an atom with no subtypes. Disjoint from `string`.
  character: [],
  color: [],
  // A compiled pattern: an atom with no subtypes, and disjoint from `string`
  // (a pattern is not text). Deliberately NOT reached by the structural
  // expansion `string`/`range` get in `isSubtype` — it has no element type to
  // expand to.
  regexp: [],
  // A type value: an atom with no subtypes, like `regexp` — a reified type
  // expression is not text, not a number, and not a collection of anything.
  type: [],
  expression: EXPRESSION_TYPES,
};

/**
 * For each primitive type, the *reflexive transitive closure* of its primitive
 * subtypes, as a `Set` for O(1) membership tests.
 *
 * Computed from `PRIMITIVE_SUBTYPES`. The closure repairs transitivity holes
 * in the hand-maintained table — an entry that lists a child but not that
 * child's own children still relates to the whole subtree.
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

  // `unknown` is the top of the VALUE types: every remaining type is a
  // subtype of it, and it is a subtype only of `any`/`unknown`. `any` itself
  // is NOT below `unknown`: `any` additionally admits the absence markers
  // (`nothing`, `missing`), which `unknown` excludes, so `any` sits strictly
  // above. (When `any <: unknown` was granted here, the two were mutual
  // subtypes while disagreeing on `nothing`, so the relation was not
  // transitive: `list<nothing> <: list<any> <: list<unknown>` both held
  // while `list<nothing> <: list<unknown>` did not.) `error` is excluded for
  // the same reason: it is not a value, and it is a subtype only of itself
  // and `any` (the rule above says so) — letting it ride the blanket rule
  // put `list<error>` inside the values-only bare `list`.
  if (rhs === 'unknown') return lhs !== 'any' && lhs !== 'error';
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
 *   common subtypes. The numeric tower is a chain (`integer ⊂ rational ⊂ real
 *   ⊂ complex ⊂ number`), so `meet(real, complex)` = `[real]`; the
 *   union-of-maximals case only arises for genuinely incomparable pairs such
 *   as `meet(imaginary, real)` = `[]`.
 * - The three children of `number` are disjoint, so `meet(real, infinity)`,
 *   `meet(complex, nan)` and `meet(infinity, nan)` are all `[]`.
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
 * The RHS unfold's cycle guard, keyed on the PAIR — the alias record together
 * with the identity of the left-hand type it is being unfolded against.
 *
 * Keying on the record alone (what `beginUnfold` does for the lhs) is wrong on
 * this side: an equirecursive alias reaches itself through a CONSTRUCTOR
 * (`type alias json = … | list<type json>`), so answering `json` for a list
 * legitimately unfolds `json` once per level, each time against a smaller lhs.
 * A record-keyed guard cuts that off at the first repeat and reports a
 * non-subtype — it broke every recursive-JSON test when tried.
 *
 * Re-entering with the SAME lhs object is the case that makes no progress: an
 * alias chain that cycles through bare references or union arms
 * (`type alias a = b`, `type alias b = a`) hands the identical lhs down
 * forever and overflows the stack. Identity is the exact discriminator,
 * because the shrinking case rebuilds the lhs on the way down and the
 * looping case does not — and it costs a `Set` probe, not a structural key.
 */
let unfoldingPairs: Map<TypeReference, Set<unknown>> | null = null;

// `lhs` is compared by IDENTITY only, never read, so it is typed `unknown`:
// the call site holds a widened union at this point, and narrowing it back to
// `Type` would be a cast that buys nothing.
function beginUnfoldAgainst(ref: TypeReference, lhs: unknown): boolean {
  if (unfoldingPairs === null) unfoldingPairs = new Map();
  let seen = unfoldingPairs.get(ref);
  if (seen === undefined) {
    seen = new Set();
    unfoldingPairs.set(ref, seen);
  } else if (seen.has(lhs)) return false;
  seen.add(lhs);
  return true;
}

function endUnfoldAgainst(ref: TypeReference, lhs: unknown): void {
  const seen = unfoldingPairs!.get(ref)!;
  seen.delete(lhs);
  if (seen.size === 0) unfoldingPairs!.delete(ref);
  if (unfoldingPairs!.size === 0) unfoldingPairs = null;
}

/**
 * True when `t` is the EMPTY type — the one no value inhabits.
 *
 * `never` is that type. `nothing` is NOT: it is the unit type, whose single
 * member is the symbol `Nothing`. The two are a standing trap because "nothing"
 * reads like emptiness in English, and the meet algebra used to return
 * `nothing` for a refuted intersection — so `number & boolean` produced a type
 * that still admitted a value, which then survived into a union
 * (`(number & boolean) | integer` kept a `| nothing` arm) and deleted tuple
 * slots (a `nothing` slot collapses, by the value-level rule that writing
 * `Nothing` into a positional slot removes it).
 *
 * Use this wherever the question is "did this meet come back empty?", so the
 * distinction is asked for by name rather than by an `=== 'never'` literal
 * that the next reader has to weigh against `=== 'nothing'`.
 */
export function isEmptyType(t: Type): boolean {
  return t === 'never';
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
  if (a === 'never' || b === 'never') return true; // empty set
  if (a === 'any' || b === 'any') return false;

  // A reference is answered from the type it names, on either side. Without
  // this the category test below sees a `reference` (no bucket) and falls
  // through to the conservative "may overlap", so `id` (an alias of `integer`)
  // was not provably disjoint from `string`.
  //
  // A STRUCTURAL alias IS its definition — the same rule as the LHS unfold in
  // `isSubtype`.
  //
  // A NOMINAL reference is deliberately NOT a subtype of its definition
  // (`isSubtype` keeps it opaque, so a value of the same shape but of another
  // name is refused), yet every value of the nominal type does have the
  // definition's shape. Disjointness is therefore inherited in the one
  // direction this predicate needs: if no value inhabits both the definition
  // and `b`, none inhabits both the reference and `b`. The reverse is never
  // claimed — a definition that overlaps `b` gives `false`, "may overlap",
  // which is the safe answer, so two distinct names over the same body stay
  // non-disjoint. Before this arm resolved nominal references, a parameter
  // typed by a declared object type (`type Outer = object{…}`) was never
  // proven disjoint from `infinity`/`nan` while the same type spelled
  // structurally was, and the lambda-body finiteness widening
  // (`boxed-expression/effects-inference.ts`) then fired for one spelling and
  // not the other.
  //
  // `resolveTypeReference` (this file) follows the chain and instantiates an
  // applied reference at its arguments — a nominal body left uninstantiated
  // would hand the recursion a bare type variable, which this predicate's
  // ground-input contract forbids. It answers `undefined` for an unfulfilled
  // forward reference and for a chain that cycles.
  //
  // The recursion is guarded by the same cycle detection as `isSubtype`, keyed
  // on the DECLARATION record (an application is a fresh object each time it
  // is instantiated, so the node itself is not a stable key); on a cycle we
  // answer `false` — "may overlap" — which is this predicate's safe direction.
  if (typeof a === 'object' && a.kind === 'reference') {
    const def = resolveTypeReference(a);
    if (def === undefined) return false;
    const frame = declarationOf(a);
    if (!beginUnfold(frame)) return false;
    try {
      return provablyDisjoint(def, b);
    } finally {
      endUnfold(frame);
    }
  }
  if (typeof b === 'object' && b.kind === 'reference') {
    const def = resolveTypeReference(b);
    if (def === undefined) return false;
    const frame = declarationOf(b);
    if (!beginUnfold(frame)) return false;
    try {
      return provablyDisjoint(a, def);
    } finally {
      endUnfold(frame);
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

  // An intersection is disjoint from `other` as soon as ANY member is: the
  // intersection's inhabitants are inside every member, so one disjoint member
  // leaves them nowhere to overlap `other`. Only the positive direction is
  // proven — no disjoint member means "may overlap", the safe answer, not
  // "overlaps". Without this case an intersection fell through to the category
  // test, which has no bucket for the kind, so `!integer & number` was not
  // provably disjoint from `integer` and `isSubtype(!integer & number,
  // !integer)` wrongly failed.
  if (typeof a === 'object' && a.kind === 'intersection')
    return a.types.some((t) => provablyDisjoint(t, b));
  if (typeof b === 'object' && b.kind === 'intersection')
    return b.types.some((t) => provablyDisjoint(a, t));

  // A negation `!T` is disjoint from `other` exactly when `other` lies wholly
  // inside `T`: everything `!T` excludes is everything `other` has. This is
  // what makes `!integer` provably disjoint from `integer` itself — the
  // subtype tests above cannot see it, since neither side is a subtype of the
  // other. A failed containment stays the conservative "may overlap": two
  // negations, or a partial overlap like `!integer` vs `number`, are not
  // refuted here.
  if (typeof a === 'object' && a.kind === 'negation' && isSubtype(b, a.type))
    return true;
  if (typeof b === 'object' && b.kind === 'negation' && isSubtype(a, b.type))
    return true;

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

  // `string` is a primitive with a HIDDEN element type (`character`), so the
  // coarse category test below cannot separate it from a PARAMETERIZED
  // collection: `string <: indexed_collection`, so the two share that bucket
  // and the test reports "may overlap" for `string` vs
  // `indexed_collection<number>`. Decide on the ELEMENT instead — every string
  // value's elements are characters, so a string inhabits
  // `indexed_collection<E>` exactly when `character <: E`.
  //
  // The "an empty collection inhabits both" caveat at the bottom of this
  // function does NOT apply here: `string` is one monomorphic type, not a
  // family, so there is no `string<never>` analogue of `list<never>` for the
  // empty string to inhabit — the empty string is a `string`, whose element
  // type is `character` whether or not it has any elements.
  //
  // Load-bearing beyond tidiness: `box.ts` keeps an argument-type error only
  // when every candidate parameter is provably disjoint from the operand, so
  // without this a `(broadcastable<number>) -> number` parameter silently
  // admitted a string argument that the plain `(number)` spelling refuses
  // (the generalized Tycho item 157(4) contract).
  const stringVsParameterized = (
    text: Type,
    other: Type
  ): boolean | undefined => {
    if (text !== 'string') return undefined;
    if (typeof other === 'string') return undefined;
    if (other.kind !== 'collection' && other.kind !== 'indexed_collection')
      return undefined;
    return !isSubtype('character', other.elements);
  };
  const stringDisjoint =
    stringVsParameterized(a, b) ?? stringVsParameterized(b, a);
  if (stringDisjoint !== undefined) return stringDisjoint;

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
    case 'object':
      return 'object';
    case 'dictionary':
      return 'dictionary';
    case 'collection':
      return 'collection';
    case 'indexed_collection':
      return 'indexed_collection';
    case 'signature':
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
/** The `<unknown>` structural synonym of each bare collection constructor
 * (user ruling 2026-08-17), used by `couldMatch` to give a bare name its
 * element reading before the structural overlap probes. */
// Null-prototype, matching the module convention for string-keyed lookups
// (`Object.create(null)` — see `readTypeVariablesAsBounds`'s bindings): the
// keys reaching it are parser-produced primitive names today, but an `in`
// probe on a plain literal would also answer `true` for `'__proto__'`.
const BARE_COLLECTION_EXPANSIONS: Partial<Record<string, Type>> = Object.assign(
  Object.create(null),
  {
    list: BARE_LIST_STRUCTURAL_TYPE,
    set: BARE_SET_STRUCTURAL_TYPE,
    dictionary: BARE_DICTIONARY_STRUCTURAL_TYPE,
    collection: BARE_COLLECTION_STRUCTURAL_TYPE,
    indexed_collection: BARE_INDEXED_COLLECTION_STRUCTURAL_TYPE,
  }
);

export function couldMatch(a: Type, b: Type): boolean {
  // `never` is uninhabited: no value is one.
  if (a === 'never' || b === 'never') return false;

  // Distribute over unions, at any depth. This is the whole point of the
  // predicate.
  if (typeof a === 'object' && a.kind === 'union')
    return a.types.some((t) => couldMatch(t, b));
  if (typeof b === 'object' && b.kind === 'union')
    return b.types.some((t) => couldMatch(a, t));

  // `broadcastable<T>` is the union `T | indexed_collection<T>` (the same
  // expansion `isSubtype` and `provablyDisjoint` use), so it distributes
  // like one: it could match iff EITHER arm could. Without this a
  // broadcastable subject fell to the containment fallback, which answered
  // `broadcastable<number>` vs `collection<any>` with `false` even though
  // the collection arm inhabits it. Both sides gain the expansion together
  // and the recursion is on strictly smaller types, so it terminates.
  if (typeof a === 'object' && a.kind === 'broadcastable')
    return (
      couldMatch(a.elements, b) ||
      couldMatch({ kind: 'indexed_collection', elements: a.elements }, b)
    );
  if (typeof b === 'object' && b.kind === 'broadcastable')
    return (
      couldMatch(a, b.elements) ||
      couldMatch(a, { kind: 'indexed_collection', elements: b.elements })
    );

  // The bare collection constructors are their `<unknown>` synonyms (user
  // ruling 2026-08-17); expand them so the structural overlap probes below
  // see the element type. Without this, a bare subject fell straight to the
  // containment fallback, which answered `indexed_collection` vs
  // `collection<number>` with `false` even though the two overlap in
  // `indexed_collection<number>` — while the SAME subject against the more
  // specific `list<tuple<…>>` answered `true` (that pair happens to satisfy
  // containment), an asymmetry reported from the field.
  if (typeof a === 'string' && a in BARE_COLLECTION_EXPANSIONS)
    a = BARE_COLLECTION_EXPANSIONS[a]!;
  if (typeof b === 'string' && b in BARE_COLLECTION_EXPANSIONS)
    b = BARE_COLLECTION_EXPANSIONS[b]!;

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
      // `broadcastable` is absent: the early distribution above intercepts
      // every broadcastable operand before this probe is reached.
      (a.kind === 'set' ||
        a.kind === 'collection' ||
        a.kind === 'indexed_collection')
    ) {
      const elements = (b as SetType | CollectionType).elements;
      if (couldMatch(a.elements, elements)) return true;
    } else if (a.kind !== b.kind) {
      // CROSS-KIND overlap within the collection families: a generic
      // `collection<A>` is inhabited by every specific collection kind, so
      // it overlaps a `list<B>`/`set<B>`/`indexed_collection<B>` whenever
      // the elements could match (`collection<number>` ∩
      // `indexed_collection<unknown>` ⊇ `indexed_collection<number>`); an
      // `indexed_collection<A>` overlaps a `list<B>` the same way (lists
      // are indexed). A dictionary iterates as key–value entry tuples, so
      // against a generic `collection<E>` its overlap question is whether
      // its ENTRY type `tuple<string, V>` could match `E` — containment
      // alone misses it (`dictionary<number>` overlaps
      // `collection<tuple<string, integer>>` at
      // `dictionary<integer>` with neither containing the other).
      const kinds = [a.kind, b.kind];
      const genericPlusSpecific =
        kinds.includes('collection') &&
        (kinds.includes('list') ||
          kinds.includes('set') ||
          kinds.includes('indexed_collection'));
      const indexedPlusList =
        kinds.includes('indexed_collection') && kinds.includes('list');
      if (genericPlusSpecific || indexedPlusList) {
        const ea = (a as CollectionType | SetType | ListType).elements;
        const eb = (b as CollectionType | SetType | ListType).elements;
        if (couldMatch(ea, eb)) return true;
      } else if (kinds.includes('collection') && kinds.includes('dictionary')) {
        const dict = (a.kind === 'dictionary' ? a : b) as DictionaryType;
        const coll = (a.kind === 'collection' ? a : b) as CollectionType;
        const entry: Type = {
          kind: 'tuple',
          elements: [{ type: 'string' }, { type: dict.values }],
        };
        if (couldMatch(entry, coll.elements)) return true;
      }
    }
  }

  // Fall back to assignability in either direction: `a` could be a `b` if
  // every `a` is a `b`, or if some `b`s are `a`s.
  return isSubtype(a, b) || isSubtype(b, a);
}

/**
 * The inclusive range of argument counts `sig` accepts; `max` is `Infinity`
 * for a variadic tail.
 *
 * A `+` tail's mandatory occurrences stack on TOP of the optional parameters,
 * because a call fills the optional slots before the variadic one ever
 * receives anything: `(a, b?, c+)` needs three arguments before `c` is
 * satisfied. A `*` tail (`variadicMin` 0) imposes nothing, so the optional
 * parameters stay optional.
 *
 * Mirrors `arityBounds()` in
 * `compute-engine/boxed-expression/overload.ts`, which is the same reading for
 * the overload filter; the two cannot share code because this module sits
 * below the compute-engine layer.
 */
/**
 * The parameter type a signature binds at supplied position `i`, walking
 * required → optional → variadic; `undefined` past a non-variadic signature's
 * last parameter.
 *
 * Mirrors `paramAt()` in `common/type/instantiate.ts`; kept local so this
 * module adds no import edge (the package holds a zero-circular-dependency
 * budget, runtime and type-only alike).
 */
function signatureParamAt(sig: FunctionSignature, i: number): Type | undefined {
  const required = sig.args?.length ?? 0;
  if (i < required) return sig.args![i].type;
  const optional = sig.optArgs?.length ?? 0;
  if (i < required + optional) return sig.optArgs![i - required].type;
  return sig.variadicArg?.type;
}

function signatureArity(sig: FunctionSignature): { min: number; max: number } {
  const required = sig.args?.length ?? 0;
  const optional = sig.optArgs?.length ?? 0;
  if (sig.variadicArg) {
    const variadicMin = sig.variadicMin ?? 0;
    return {
      min: variadicMin > 0 ? required + optional + variadicMin : required,
      max: Infinity,
    };
  }
  return { min: required, max: required + optional };
}

/** True when this signature carries a `where` clause (is a polytype). */
function isPolytype(t: FunctionSignature): boolean {
  return t.typeParams !== undefined && t.typeParams.length > 0;
}

/**
 * α-equivalence of two polytype arms: the same shape up to a CONSISTENT
 * renaming of their quantified variables (§5 rule 3).
 *
 * The clauses are paired positionally — `(T, U) -> T where T, U` and
 * `(U, T) -> U where U, T` are equivalent — and their declared bounds are
 * compared STRUCTURALLY (differing bounds ⇒ not equivalent). The bodies are
 * compared by renaming the lhs's variables to the rhs's names (a simultaneous
 * substitution, so a swap does not capture) and comparing DEDUP KEYS, which is
 * the structural equality the rest of the type layer already keys on.
 *
 * The dedup key, not the plain serialization: `(T) pure -> T` and `(T) -> T`
 * are the two spellings of the same ∅ effect set (`isEffectSubset` already
 * treats them as equal on the ground path), and comparing serializations would
 * make the generic path gratuitously stricter than the ground one.
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
      typeToDedupKey(aBound) !== typeToDedupKey(bBound!)
    )
      return false;
    renaming[ap[i].name] = { kind: 'variable', name: bp[i].name };
  }

  // Substituting every quantified name also strips the (now fully
  // instantiated) clause, so both sides are compared clause-free.
  const renamed = substituteTypeVariables(a, renaming);
  const stripped: FunctionSignature = { ...b };
  delete stripped.typeParams;
  return typeToDedupKey(renamed) === typeToDedupKey(stripped);
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
      const def = aliasDefinitionAt(lhs);
      return def === undefined ? false : isSubtype(def, rhs);
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

  // Every type is a subtype of `unknown` — except `any`, which additionally
  // admits the absence markers (`nothing`, `missing`) that `unknown`
  // excludes, and therefore sits STRICTLY above `unknown`. (Granting
  // `any <: unknown` made the two mutual subtypes while they disagreed on
  // `nothing`, so the relation was not transitive.)
  if (rhs === 'unknown') {
    if (lhs === 'any') return false;
    // `error` is not a value either: it is a subtype only of itself and
    // `any`, so it must not ride the blanket rule (mirrors
    // `isPrimitiveSubtype`).
    if (lhs === 'error') return false;
    // A union fits `unknown` only when every arm does: an absence arm must
    // not ride under the blanket rule (`integer | missing ⊄ unknown`, which
    // is what keeps a `list<integer|missing>` out of the values-only bare
    // `list`). The absence PRIMITIVES themselves (`nothing`, `missing`)
    // returned false above, before this rule.
    if (typeof lhs !== 'string' && lhs.kind === 'union')
      return lhs.types.every((t) => isSubtype(t, 'unknown'));
    return true;
  }
  // 'unknown' is only a subtype of `any` (handled above); gate on a primitive
  // rhs so `unknown <: unknown | integer` falls through to the union handler.
  //
  // ⚠️ Do NOT make this bidirectional. TRIED AND REVERTED (2026-08-15). The
  // structural reason comes first because no downstream patch can route
  // around it: if `unknown <: T` and `T <: unknown` both held for every `T`,
  // antisymmetry is gone — `unknown` becomes lattice-EQUIVALENT to every
  // type, and union subsumption and `meet2`'s subtype-based tie-breaks stop
  // being order-independent. That is not a bug to fix in the callers; it is
  // the partial order ceasing to be one. The empirical witness, for scale:
  // `matches()` doubles as the engine's dispatch predicate, and within one
  // probe of the flip an element access typed `unknown` "matched" `matrix`,
  // so `P[1]^2` canonicalized as `MatrixPower`, broadcast decisions flipped,
  // and even undeclared-function definitions went inert. A bidirectional
  // "compatible with everything" reading of `unknown` therefore cannot live
  // in this relation at all. The placeholder semantics users actually need
  // lives at the DECLARATION boundary instead: `refineDeclaredPlaceholders`
  // (compute-engine/boxed-expression/effects-inference.ts) replaces declared
  // `unknown` slots with the definition's inferred slots. Full record: the
  // placeholder-signature entry in ROADMAP.md (ruled 2026-08-15).
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
      // The unsigned complex infinity `~oo` claims `infinity`: it has no
      // sign, so it is neither real nor complex. Tested before the numeric
      // branches because the sentinel is an object, not a number.
      if (isComplexInfinityValue(lhs.value))
        return isPrimitiveSubtype('infinity', rhs as PrimitiveType);
      if (typeof lhs.value === 'number') {
        // Each numeric literal claims its PRINCIPAL type: NaN inhabits `nan`,
        // the marker type that names exactly that singleton; ±∞ inhabit
        // `infinity`, which sits apart from `real` (a signed-pair claim needs
        // the union `+oo | -oo`, which the value-vs-union path covers by
        // value equality); a *finite* literal claims the bare tier it belongs
        // to, which is already a finite type (`value 0 <: integer`).
        // Matches the value-vs-bounded-numeric path.
        if (Number.isNaN(lhs.value))
          return isPrimitiveSubtype('nan', rhs as PrimitiveType);
        if (!Number.isFinite(lhs.value))
          return isPrimitiveSubtype('infinity', rhs as PrimitiveType);
        if (Number.isInteger(lhs.value))
          return isPrimitiveSubtype('integer', rhs as PrimitiveType);
        // A non-integer number literal (e.g. 3.5) is a real number, not just
        // `number` — `number ⊄ real`, so the old `'number'` made it fail
        // `value 3.5 <: real`. Matches the symmetric path below.
        return isPrimitiveSubtype('real', rhs as PrimitiveType);
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
      // A range relates to `rhs` exactly as its BASE type does: the bounds
      // only ever narrow the set of values, never widen it. Finiteness needs
      // no separate treatment now that every bare name under `number` admits
      // only finite values — `integer<0..10>`, the half-bounded `integer<1..>`
      // that `nonNegativeRangeType` and the assumption channel produce, and
      // the unbounded `integer` all sit below `complex` alike.
      if (!isSubtype(lhs.type, rhs)) return false;
      // The bounds always match, since the bounds of the rhs are -∞ and +∞
      return true;
    }

    if (rhs === 'number') return isNumeric(lhs);

    if (rhs === 'symbol') return isSymbol(lhs);

    if (rhs === 'expression') return isExpression(lhs);

    if (rhs === 'function') return isFunction(lhs);

    if (rhs === 'scalar') return isScalar(lhs);

    if (rhs === 'value') return isValue(lhs);

    // The bare collection constructors are synonyms for their `<unknown>`
    // parameterization (user ruling 2026-08-17): `list` IS `list<unknown>` —
    // "a list of values, element type not stated" — and likewise `set`,
    // `dictionary`, `collection` and `indexed_collection`. So a composite
    // lhs matches the bare name only when its element type fits `unknown`,
    // i.e. contains no absence markers: `list<integer> <: list` but
    // `list<any> ⊄ list` and `list<nothing> ⊄ list`. The explicit `<any>`
    // forms are the strictly wider, absence-admitting contracts.
    if (rhs === 'indexed_collection')
      return isSubtype(lhs, BARE_INDEXED_COLLECTION_STRUCTURAL_TYPE);

    if (rhs === 'collection')
      return isSubtype(lhs, BARE_COLLECTION_STRUCTURAL_TYPE);

    // A tuple is a subtype of `tuple` when its slots hold values. The
    // values-only reading extends to every bare collection-family name, not
    // just the five `<unknown>` synonyms: bare `tuple` sits below bare
    // `indexed_collection` in the primitive closure, and that one IS
    // `indexed_collection<unknown>`, so an absence-slotted tuple
    // (`tuple<integer, missing>`) matching bare `tuple` would recreate the
    // intransitivity the synonym ruling removed.
    if (rhs === 'tuple')
      return (
        lhs.kind === 'tuple' &&
        lhs.elements.every((e) => isSubtype(e.type, 'unknown'))
      );

    // A list is a subtype of `list` = `list<unknown>` when its elements are
    // values (see the synonym note above); its dimensions are unconstrained.
    if (rhs === 'list')
      return lhs.kind === 'list' && isSubtype(lhs.elements, 'unknown');

    // A set is a subtype of `set` = `set<unknown>` (synonym note above)
    if (rhs === 'set')
      return lhs.kind === 'set' && isSubtype(lhs.elements, 'unknown');

    // A record is a subtype of `record` when its fields hold values — the
    // same values-only reading as bare `tuple` above (bare `record` sits
    // below bare `dictionary` = `dictionary<unknown>` in the closure).
    if (rhs === 'record')
      return (
        lhs.kind === 'record' &&
        Object.values(lhs.elements).every((t) => isSubtype(t, 'unknown'))
      );

    // Bare `object` means "any object", and it is the ONE common bound every
    // declared object type has. Relating each of them to it does not
    // contradict "no subtyping between object types": it relates them to a
    // single top, never to each other (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix
    // B, ruling B6).
    if (rhs === 'object') return isObjectType(lhs);

    // A dictionary is a subtype of `dictionary` = `dictionary<unknown>` when
    // its values are values (synonym note above). So is a record: a record
    // is a dictionary with statically known keys; the record-to-dictionary
    // rule below checks every field the same way.
    if (rhs === 'dictionary')
      return isSubtype(lhs, BARE_DICTIONARY_STRUCTURAL_TYPE);

    // Other composite types are not subtypes of primitive types
    return false;
  }

  // A type is a subtype of a union if it is a subtype of any of the types in
  // the union. The probe is member-wise: the numeric tree is disjoint, so a
  // union of numeric names never covers a single name that none of its members
  // covers on its own. (Before the finite-by-default flip it could — the
  // doubled tower made `finite_X | non_finite_number` cover `X` — and the
  // members had to be augmented first.)
  if (rhs.kind === 'union') {
    const rhsMembers = rhs.types;
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
      // lhs is a union, rhs is a union. A member that is ITSELF a union (a
      // nested, unreduced union is a legal Type value) must be probed
      // against the WHOLE rhs union — its own members may be covered by
      // DIFFERENT rhs members (`(integer | +oo | -oo) | nan` against the
      // flat `integer | +oo | -oo | nan`); requiring a single covering rhs
      // member wrongly rejected exactly that case.
      return lhs.types.every((lhsType) => {
        if (typeof lhsType !== 'string') {
          if (lhsType.kind === 'broadcastable')
            return broadcastableFitsUnion(lhsType);
          if (lhsType.kind === 'union') return isSubtype(lhsType, rhs);
        }
        return rhsMembers.some((rhsType) => isSubtype(lhsType, rhsType));
      });
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
    if (typeof lhs !== 'string' && lhs.kind === 'reference') {
      // Same name (and compatible arguments) settles it — this is also what
      // terminates a self-referential alias, so it must be asked first.
      if (sameTypeApplication(lhs, rhs)) return true;
      // Otherwise FALL THROUGH to the unfold below. A reference lhs is not
      // exempt from it: a NOMINAL `lit` is a member of the structural alias
      // `type alias node = lit | plus`, and answering `sameTypeApplication`
      // here made membership depend on which side the alias sat — `node <:
      // lit` unfolded on the lhs and held, `lit <: node` did not. That broke
      // every sum reached through a variant payload or a fulfilled forward
      // reference, so a recursive sum declared but could not be constructed.
    }
    if (rhs.alias === true && rhs.def) {
      // A STRUCTURAL alias IS its definition, on this side too — the mirror of
      // the lhs unfold at the top of this function. Guarded on the PAIR, not
      // the record: see `beginUnfoldAgainst` for why this side cannot use the
      // record-keyed guard the lhs uses.
      if (!beginUnfoldAgainst(rhs, lhs)) return false;
      try {
        const def = aliasDefinitionAt(rhs);
        return def === undefined ? false : isSubtype(lhs, def);
      } finally {
        endUnfoldAgainst(rhs, lhs);
      }
    }
  }

  // A type is a subtype of an intersection exactly when it is a subtype of
  // EVERY arm. This must precede the primitive-lhs fall-through below:
  // intersections are object-shaped in the type AST, so returning `false`
  // for a string lhs first would make every bare primitive fail even a
  // reflexive intersection (`number ⪯ number & number`). Recursing through
  // this entry point preserves all arm-specific rules (aliases, negations,
  // unions, and the structural readings of `string` and `range`).
  if (rhs.kind === 'intersection')
    return rhs.types.every((rhsType) => isSubtype(lhs, rhsType));

  // `range` is the only primitive with a structural reading: an index span is
  // an indexed collection of finite positive integers, so it must satisfy a
  // PARAMETERIZED collection rhs (`range <: indexed_collection<integer>`,
  // `range <: collection<number>`) that the primitive-vs-primitive table
  // above cannot express. Expanding here, just before the fall-through,
  // keeps every other primitive on the fast path. The element type is
  // `integer` (see `RANGE_STRUCTURAL_TYPE`), matching what a qualifying
  // `Range` reported before this type existed, so the narrowing perturbs no
  // downstream element-type inference.
  // Note this does NOT make a range a `list` — `indexed_collection<T>` is not
  // a subtype of `list<T>`, so `range <: list<integer>` stays false, which is
  // the intent (they are sibling kinds).
  if (lhs === 'range') return isSubtype(RANGE_STRUCTURAL_TYPE, rhs);

  // `string` is the other primitive with a structural reading: a string is an
  // indexed collection of `character`, so it must satisfy a PARAMETERIZED
  // collection rhs (`string <: indexed_collection<character>`,
  // `string <: collection<character>`) that the primitive-vs-primitive table
  // above cannot express. As with `range`, this does NOT make a string a
  // `list` — `string <: list<character>` stays false, which is the intent
  // (they are sibling kinds, because joining strings can merge their boundary
  // characters while joining lists never merges elements).
  if (lhs === 'string') return isSubtype(STRING_STRUCTURAL_TYPE, rhs);

  // The bare collection constructors are synonyms for their `<unknown>`
  // parameterization (user ruling 2026-08-17), so against a composite rhs
  // they expand and recurse exactly like `range` and `string` above. This is
  // what gives the bare spelling its element reading on the LEFT:
  // `list <: list<any>` (unknown ⊑ any), `list ⊄ list<integer>`,
  // `list <: collection<unknown>`. The expansion carries no dimensions — the
  // bare form's rank is unconstrained, so a dimensioned rhs still rejects.
  if (lhs === 'list') return isSubtype(BARE_LIST_STRUCTURAL_TYPE, rhs);
  if (lhs === 'set') return isSubtype(BARE_SET_STRUCTURAL_TYPE, rhs);
  if (lhs === 'dictionary')
    return isSubtype(BARE_DICTIONARY_STRUCTURAL_TYPE, rhs);
  if (lhs === 'collection')
    return isSubtype(BARE_COLLECTION_STRUCTURAL_TYPE, rhs);
  if (lhs === 'indexed_collection')
    return isSubtype(BARE_INDEXED_COLLECTION_STRUCTURAL_TYPE, rhs);
  if (lhs === 'record') {
    // Bare `record` is "some record, field types not stated" — the same
    // `<unknown>` reading as the constructors above, expressed against the
    // dictionary family it belongs to (a record is a dictionary with
    // statically-known keys): it fits any rhs that `dictionary<unknown>`
    // fits. It has no field list to compare, so a rhs with a specific field
    // layout still rejects.
    return isSubtype(BARE_DICTIONARY_STRUCTURAL_TYPE, rhs);
  }
  if (lhs === 'tuple') {
    // Bare `tuple` is "some tuple of values, arity not stated". Its arity is
    // unknown, so it can never match a composite tuple rhs (which fixes an
    // arity) — but element-wise it is an indexed collection of values, so it
    // fits any rhs that `indexed_collection<unknown>` fits.
    return isSubtype(BARE_INDEXED_COLLECTION_STRUCTURAL_TYPE, rhs);
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

    // ARITY: the lhs must accept EVERY call the rhs's type permits, so the
    // lhs's admissible range must CONTAIN the rhs's. A declared type is a
    // contract in both directions — it tells callers which calls are legal,
    // and it constrains what may be stored under that name — so a function
    // stored where `(integer, string+) -> string` was declared must serve
    // `f(1, "a", "b")`, a call that declaration permits. Assignment checks
    // against the contract; it never rewrites it.
    //
    // Both bounds matter: too high a minimum fails the rhs's SHORTEST
    // permitted call, too low a maximum fails its LONGEST. A variadic rhs has
    // no longest call, so only a variadic lhs can satisfy it — and a `*` lhs
    // does satisfy a `+` rhs, since `[0, ∞)` covers `[1, ∞)`.
    const lhsArity = signatureArity(lhs);
    const rhsArity = signatureArity(rhs);
    if (lhsArity.min > rhsArity.min || lhsArity.max < rhsArity.max)
      return false;

    // PARAMETERS, contravariantly, at every position the rhs can supply an
    // argument. Positions are compared through both signatures' own
    // required → optional → variadic walk, so the two shapes need not match
    // structurally: `(number*) -> T` covers `(number, number) -> T` by
    // answering `number` at positions 0 and 1.
    const namedPositions = Math.max(
      (lhs.args?.length ?? 0) + (lhs.optArgs?.length ?? 0),
      (rhs.args?.length ?? 0) + (rhs.optArgs?.length ?? 0)
    );
    for (let i = 0; i < namedPositions; i++) {
      const rhsParam = signatureParamAt(rhs, i);
      // Beyond the rhs's last parameter there is no call to satisfy.
      if (rhsParam === undefined) break;
      const lhsParam = signatureParamAt(lhs, i);
      // The arity check above guarantees a parameter here, but a signature
      // with fewer positions than its own arity range would slip through.
      if (lhsParam === undefined) return false;
      if (!isSubtype(rhsParam, lhsParam)) return false;
    }

    // A variadic rhs also supplies arguments PAST its named positions, all of
    // its tail type; the lhs's own tail is what receives them.
    if (rhs.variadicArg) {
      const lhsTail = lhs.variadicArg?.type;
      if (lhsTail === undefined) return false;
      if (!isSubtype(rhs.variadicArg.type, lhsTail)) return false;
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
      // An own-property test, not `key in`: `Object.prototype` member names
      // are valid record keys (`record{toString: string}` parses and
      // serializes), and `in` finds those on the prototype of a record that
      // does not declare them. That made `record{a: integer}` a subtype of
      // `record{toString: any}` — width subtyping satisfied by a key the
      // record does not have — because the inherited function was then
      // compared against the declared type instead of reporting the key
      // missing.
      if (!Object.prototype.hasOwnProperty.call(lhs.elements, key))
        return false;
      // Depth subtyping
      if (!isSubtype(lhs.elements[key], rhs.elements[key])) return false;
    }
    return true;
  }

  //
  // Handle Object Type
  //
  // Every stored field is a read/write position, so field types are
  // INVARIANT: two layouts relate only when they have exactly the same field
  // names and each pair of field types is mutually a subtype of the other.
  // Width subtyping is unsound for the same reason depth subtyping is — a
  // store through the narrower view would write a value the wider view's
  // declared type forbids (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "No
  // subtyping between object types", the Counter/Gauge example).
  //
  // This is a backstop, not the rule authors meet: an `object{…}` layout is
  // only ever the definition of a NOMINAL reference, and nominal references
  // never unfold to their definitions, so two declared object types are
  // unrelated even when their layouts are identical.
  //
  if (lhs.kind === 'object' && rhs.kind === 'object') {
    const lhsKeys = Object.keys(lhs.elements);
    const rhsKeys = Object.keys(rhs.elements);
    if (lhsKeys.length !== rhsKeys.length) return false;
    for (const key of rhsKeys) {
      // Own-property test, for the same reason as the record case above.
      if (!Object.prototype.hasOwnProperty.call(lhs.elements, key))
        return false;
      if (!isSubtype(lhs.elements[key], rhs.elements[key])) return false;
      if (!isSubtype(rhs.elements[key], lhs.elements[key])) return false;
    }
    return true;
  }

  // An object is never a record, and a record is never an object: the two are
  // sibling categories in the lattice, not refinements of one another (ruling
  // B6). Stated explicitly so neither falls through to a structural rule that
  // reads the two layouts as the same shape.
  if (lhs.kind === 'object' || rhs.kind === 'object') return false;

  //
  // Handle dictionaries
  //

  if (lhs.kind === 'dictionary' && rhs.kind === 'dictionary') {
    // Check that the type of values match
    return isSubtype(lhs.values, rhs.values);
  }

  // A record is a dictionary whose keys are statically known: it is a subtype
  // of `dictionary<T>` when every field type is a subtype of `T`.
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
    // The unsigned `~oo` is refused for the same reason NaN is below: it is
    // unordered against any bound, so no bounded range admits it.
    if (isComplexInfinityValue(lhs.value)) return false;
    if (typeof lhs.value !== 'number') return false;
    // NaN is unordered: it inhabits no bounded range. (Without the explicit
    // check, `NaN < lower` and `NaN > upper` are both false and the range
    // would ADMIT it.) ±∞ claim their principal `infinity`, which sits apart
    // from every bare (finite) numeric name, so the base-kind test below
    // already refuses them for every range over a bare name; the ordinary
    // bound checks then reject them from any finite-bounded range as well.
    if (Number.isNaN(lhs.value)) return false;
    const baseKind: NumericPrimitiveType = !Number.isFinite(lhs.value)
      ? 'infinity'
      : Number.isInteger(lhs.value)
        ? 'integer'
        : 'real';
    if (!isPrimitiveSubtype(baseKind, rhs.type)) return false;
    // An OPEN endpoint excludes its own value: `0` is not a member of
    // `real<0<..>` (x > 0).
    const lo = rhs.lower ?? -Infinity;
    const hi = rhs.upper ?? Infinity;
    if (lhs.value < lo || (lhs.value === lo && rhs.lowerOpen === true))
      return false;
    if (lhs.value > hi || (lhs.value === hi && rhs.upperOpen === true))
      return false;
    return true;
  }

  if (lhs.kind === 'numeric' && rhs.kind === 'numeric') {
    // The base types are compared as they are written. A range whose base is
    // one of the NON-finite names, such as `number<0..10>`, is deliberately
    // not re-read as a finite type just because its bounds are finite, so it
    // is not a subtype of `complex` or of `real<0..10>`. Bounds constrain the
    // REAL part alone, and `number` admits NaN and the infinities, neither of
    // which a bound rules out. Such a type can only be built by hand: the
    // type parser refuses bounds on `number`.
    // Check that the types match
    if (!isSubtype(lhs.type, rhs.type)) return false;
    // Interval inclusion with strictness: at a SHARED endpoint a closed
    // side is not inside an open one (`real<0..>` ⊄ `real<0<..>`: it has
    // the 0), while open ⊂ closed.
    const lLo = lhs.lower ?? -Infinity;
    const rLo = rhs.lower ?? -Infinity;
    const lHi = lhs.upper ?? Infinity;
    const rHi = rhs.upper ?? Infinity;
    if (lLo < rLo) return false;
    if (lLo === rLo && rhs.lowerOpen === true && lhs.lowerOpen !== true)
      return false;
    if (lHi > rHi) return false;
    if (lHi === rHi && rhs.upperOpen === true && lhs.upperOpen !== true)
      return false;
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
  // case: the `NaN` value type must be a subtype of ITSELF (`NaN === NaN`
  // is false, which made every signature containing `nan` fail its own
  // validation). Not `Object.is` — that would also distinguish ±0, and
  // `-0`/`0` value types denote the same singleton (the engine normalizes
  // both zeros to the exact integer `0` at boxing).
  // The `~oo` sentinel needs the same treatment as NaN: two occurrences of the
  // complex-infinity value type denote the same singleton, but they can be
  // distinct objects (a `Type` node is rebuilt by the parser and the reducers),
  // so `===` alone would make `~oo` fail its own validation.
  if (rhs.kind === 'value' && lhs.kind === 'value')
    return (
      rhs.value === lhs.value ||
      (typeof rhs.value === 'number' &&
        Number.isNaN(rhs.value) &&
        typeof lhs.value === 'number' &&
        Number.isNaN(lhs.value)) ||
      (isComplexInfinityValue(rhs.value) && isComplexInfinityValue(lhs.value))
    );

  if (lhs.kind === 'value') {
    if (typeof lhs.value === 'boolean') return isSubtype('boolean', rhs);
    // `~oo` claims `infinity` — see the value-vs-primitive path above.
    if (isComplexInfinityValue(lhs.value)) return isSubtype('infinity', rhs);
    if (typeof lhs.value === 'number') {
      // Principal-type claims, matching the value-vs-primitive path above:
      // NaN → `nan`, ±∞ → `infinity`, finite literals → the bare tier
      // they belong to, which is already finite (`value 0 <: integer`).
      if (Number.isNaN(lhs.value)) return isSubtype('nan', rhs);
      if (!Number.isFinite(lhs.value)) return isSubtype('infinity', rhs);
      if (Number.isInteger(lhs.value)) return isSubtype('integer', rhs);
      return isSubtype('real', rhs);
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
  // The unsigned `~oo` sentinel is a numeric value literal, but it is not a
  // JavaScript number, so it needs its own test to agree with the subtype path.
  if (type.kind === 'value')
    return typeof type.value === 'number' || isComplexInfinityValue(type.value);
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

/**
 * Is `type` an **object** type — the bare `object` primitive, a stored-field
 * layout, or a nominal reference declared as one?
 *
 * The nominal case is what makes `Person <: object` hold: a nominal reference
 * is otherwise opaque and never unfolds to its definition, so without this it
 * would be a subtype of nothing but itself. Reading only the DEFINITION (never
 * the field types) keeps the answer independent of the layout, which is what
 * "every declared object type is a subtype of bare `object` and of nothing
 * else" requires.
 *
 * The `seen` set guards a definition chain that cycles through references
 * (`type A = B` where `B` resolves back to `A`), which the resolver admits
 * while a forward reference is unfulfilled.
 */
/**
 * Follow a chain of nominal/alias type REFERENCES down to the type they
 * define, instantiating a parameterized reference at its arguments on the way.
 * A type that is not a reference is returned unchanged.
 *
 * `undefined` for a chain that cannot be followed: an unfulfilled forward
 * reference (no `def` yet), or one that cycles back on itself (`type A = B`
 * where `B` resolves to `A`), which the resolver admits while a forward
 * reference is outstanding.
 *
 * The body is read from the REFERENCE's own `def`, never from the type
 * registry's current record for the name. That is what lets a *pinned* type —
 * a detached copy captured when a mutable object was constructed — answer with
 * the layout that object actually has, rather than with whatever a later
 * redeclaration made of the name. Type PARAMETERS still come from the
 * declaration record, whose back-pointer a parameterized pin deliberately
 * keeps live: they are the parameter list, which a redeclaration cannot change
 * without minting a different type.
 *
 * One substitution, one level deep: a nested `tree<T>` inside the body stays an
 * unexpanded reference, so the walk terminates.
 */
export function resolveTypeReference(t: Type): Type | undefined {
  // Keyed on the DECLARATION record, not on `t`: instantiating an applied
  // reference mints a fresh body object each step, so an identity guard on `t`
  // itself would go blind on a cycle. The record is identity-stable.
  const seen = new Set<TypeReference>();
  while (typeof t === 'object' && t.kind === 'reference') {
    const decl = declarationOf(t);
    if (t.def === undefined || seen.has(decl)) return undefined;
    seen.add(decl);
    const params = decl.typeParams;
    if (t.args !== undefined && params !== undefined) {
      const bindings: Record<string, Type> = Object.create(null);
      const n = Math.min(params.length, t.args.length);
      for (let i = 0; i < n; i++) bindings[params[i].name] = t.args[i];
      t = substituteTypeVariables(t.def, bindings);
    } else t = t.def;
  }
  return t;
}

/**
 * The stored-field LAYOUT a type denotes: the `object{…}` body reached through
 * any chain of nominal references, or `undefined` for anything else.
 *
 * `undefined` covers the bare `object` primitive too, which promises that
 * fields exist without naming them — a caller that needs to know whether a
 * particular field is present must therefore treat `undefined` as "cannot
 * tell", not as "no such field".
 */
export function objectLayoutOfType(t: Type): ObjectType | undefined {
  const resolved = resolveTypeReference(t);
  if (typeof resolved === 'object' && resolved.kind === 'object')
    return resolved;
  return undefined;
}

export function isObjectType(type: Type, seen?: Set<TypeReference>): boolean {
  if (type === 'object') return true;
  if (typeof type === 'string') return false;
  if (type.kind === 'object') return true;
  if (type.kind === 'reference') {
    const decl = declarationOf(type);
    if (seen === undefined) seen = new Set();
    if (seen.has(decl)) return false;
    seen.add(decl);
    const def = decl.def;
    return def === undefined ? false : isObjectType(def, seen);
  }
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
    // A bare `indexed_collection`/`list` is the `<unknown>` synonym (user
    // ruling 2026-08-17), so its broadcast element is `unknown`, not `any`.
    if (type === 'indexed_collection' || type === 'list') return 'unknown';
    // An index span carries a known element type (finite positive integers),
    // so it broadcasts as `integer`, not as an opaque `unknown`.
    if (type === 'range') return 'integer';
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
 * or a signature instantiated from the element type
 * (`(indexed_collection<T>, …) … where T` solving `T = vector<integer^3>`) rejects the very
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

/**
 * An object is a value: it is inert data, not an operator or a symbol, so it
 * inherits `value` (and through it `expression`) exactly as scalars and
 * collections do. Admitting object types here is what lets an object satisfy a
 * `value`- or `expression`-typed parameter or binding, which most library
 * signatures and many annotations use. Note that objects reach this predicate
 * only through `isObjectType`, which does NOT relate two object types to each
 * other — the single common bound stays bare `object`
 * (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, ruling B6).
 */
function isValue(type: Type): boolean {
  return isScalar(type) || isCollection(type) || isObjectType(type);
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

  if (a === 'any') return b;
  if (b === 'any') return a;

  // `nothing`, `never` and `unknown` deliberately have NO short-circuit here;
  // the subtype tests below give each the right answer, and the short-circuits
  // they used to have gave the wrong one.
  //
  // `nothing` is the UNIT type (its one member is the symbol `Nothing`), not
  // the bottom, so it does not absorb the other side: `narrow('nothing',
  // 'integer')` shares no value and is `never`, which is what the disjoint
  // fallback returns. `never` IS the bottom, so it absorbs rather than yields
  // — `isSubtype('never', b)` holds for every `b`, so the first test below
  // returns it. And `unknown` excludes the absence types by ruling (absence is
  // opt-in), so `narrow('nothing', 'unknown')` is likewise `never`; every
  // ordinary type still narrows through `isSubtype(b, 'unknown')`.
  //
  // Placeholder semantics for a declared `unknown` slot deliberately do NOT
  // live in this relation — they are applied by `refineDeclaredPlaceholders`
  // (`boxed-expression/effects-inference.ts`), because `meet2` and
  // `reduceUnionType` call `isSubtype` directly and would otherwise become
  // operand-order-dependent.
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

  // `nothing` is absorbed rather than joined: `widen('nothing', 'integer')` is
  // `integer`, not `integer | nothing`. As pure lattice algebra that is wrong
  // — the join must be a supertype of both sides, and `integer` is not a
  // supertype of `nothing` — so this looks like the same unit-vs-empty
  // confusion `narrow2` above had, and it is not. It is deliberate and ruled;
  // see `ROADMAP.md`, "An empty meet was spelled `nothing`, the UNIT type".
  //
  // The reason is that absence is OPT-IN in this type system: `nothing` and
  // `missing` are excluded from `unknown`, and a type admits them only by
  // saying so (`integer | nothing`). Joining them in would contradict that at
  // every inference site that widens a series of observed types — most
  // visibly element-type inference, where `[1, Nothing, 3]` is meant to infer
  // `list<integer>` rather than `list<integer | nothing>`.
  //
  // Do not "fix" this to match `narrow2`. The two are asymmetric on purpose.
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
  // Widening two unrelated object types to bare `object` loses everything the
  // types said, so `widen` prefers an explicit union — the same call the other
  // container categories make.
  'object',
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
 *
 * The numeric rungs are the bare tower, from `integer` up to `number`: one
 * rung per name now that the `finite_*` spellings are retired.
 *
 * `infinity` leads, and `nan` sits immediately before `number`. Their exact
 * position does not interact with the finite rungs: the three children of
 * `number` are disjoint, so a pair drawn from two of them joins at `number`
 * whatever the order in between.
 */
const SUPERTYPE_PROBE_ORDER: PrimitiveType[] = [
  'infinity',
  'integer',
  'rational',
  'real',
  'imaginary',
  'complex',
  'nan',
  'number',
  'list',
  'record',
  'object',
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
