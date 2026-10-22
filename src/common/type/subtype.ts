import { COUNT_STATS } from '../cache-stats.js';
import { makeNumericRangeType } from './numeric-range.js';
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
import { isComplexInfinityValue, isIndeterminateValue } from './types.js';
import type {
  BroadcastableType,
  CollectionType,
  DictionaryType,
  FunctionSignature,
  ListType,
  NamedElement,
  NumericPrimitiveType,
  NumericType,
  ObjectType,
  PrimitiveType,
  RecordType,
  SetType,
  TupleType,
  Type,
  TypeCompatibility,
  TypeParameter,
  TypeReference,
  TypeString,
} from './types.js';
import { parseType } from './parse.js';
import { isEffectSubset } from './effects.js';
import {
  _setTypeAlgebra,
  aliasDefinitionAt,
  freeTypeVariables,
  instantiatesTo,
  substituteTypeVariables,
} from './instantiate.js';
import { typeToDedupKey } from './serialize.js';
import { declarationOf } from './reference.js';
import { subtypingVarianceOf } from './variance.js';

/**
 * The composite kinds no scalar (a numeric type, a boolean, a numeric or
 * boolean value) is ever a subtype of. Read by the fast negative at the top
 * of `isSubtype`; the kinds left out are the ones that can admit a scalar
 * (`union`, `intersection`, `negation`, `reference`, `broadcastable`,
 * `expression`, `variable`, `symbol`).
 */
const SCALAR_DISJOINT_KINDS: ReadonlySet<string> = new Set([
  'list',
  'set',
  'tuple',
  'record',
  'dictionary',
  'collection',
  'indexed_collection',
  'signature',
  'object',
]);

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
  // An index span is a list of integers (since 2026-09-29): `range <: list`
  // here, and `range <: list<integer>` through the structural expansion in
  // `isSubtype`. Before, `range` was a sibling of `list`, and a symbol
  // declared `list` refused `Range(1, 10)`.
  list: ['range'],
  // An index span has no primitive subtypes. It is a subtype of `list`
  // (and thence `indexed_collection` and `collection`) through the `list`
  // entry above, which lists it. Against a PARAMETERIZED rhs
  // (`list<integer>`, `indexed_collection<integer>`, `collection<number>`)
  // it is expanded structurally to `RANGE_STRUCTURAL_TYPE` (`list<integer>`,
  // defined in `primitive.ts`) in `isSubtype`.
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

  // `unknown` is an inference marker: a type still to be inferred. As a set
  // of values it restricts nothing, so every type is a subtype of it,
  // including `any`, `error` and the absence markers (user decision D1,
  // 2026-10-21, `docs/plans/2026-10-21-unknown-inference-marker.md`). Before
  // that decision `any`, `error`, `nothing` and `missing` were excluded, which
  // made `list<unknown>` a narrower contract than bare `list` and refused
  // `[1, Missing]` to a declaration that asked to infer its elements. `any`
  // and `unknown` are therefore mutual subtypes: two spellings of the same
  // set of values with different instructions (a contract, a request to
  // infer), exactly as bare `list` and `list<any>` are. The reverse direction
  // stays false (below): an unresolved type never proves a contract. This
  // rule comes before the unit-type rules so that `nothing <: unknown` and
  // `missing <: unknown` hold.
  if (rhs === 'unknown') return true;

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

  // `unknown` is a subtype only of `any` and itself (both handled above): an
  // unresolved type never proves a contract.
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

/**
 * The smallest stack index (in `subtypePairs.active`) of a question whose
 * state a cycle guard of `isSubtype` or `provablyDisjoint` used since the
 * current question of `subtypePairs` started: a pair assumed to hold by the
 * lhs unfold names the question it repeats. The other guards (a re-entry
 * refused by the rhs unfold, a reference met again, an assumed union arm)
 * do not name one, and set `-1`. An answer that used the state of a
 * question below it on the stack depends on where it was asked, so
 * `subtypePairs` does not keep it; an answer whose guards all named the
 * question itself, or one it asked, is exact and is kept (the lowlink rule
 * of Tarjan's algorithm). Without the second case, a chain of
 * self-recursive aliases was compared again on every path.
 */
let subtypeLow = Infinity;

/** Record that a cycle guard answered from the state of the stack (see
 * `subtypeLow`). */
function noteSubtypeAssumption(at = -1): void {
  if (at < subtypeLow) subtypeLow = at;
}

/**
 * The answers of `isSubtype` for the pairs of one question that reaches a
 * transparent alias, by the interning keys of the two types
 * (`cyclePairKey`). Created by the outermost `isSubtype` call whose lhs or
 * rhs is such an alias, or by the outermost `couldMatch` call, and dropped
 * when that call returns.
 *
 * Without it, a chain of aliases with two branches at each level
 * (`Aₙ = list<Aₙ₋₁^2> | list<Aₙ₋₁^3>`) asks the question `Aₙ₋₁ <: Bₙ₋₁`
 * twice for each `Aₙ <: Bₙ` (once for each arm of `Bₙ`), and the work
 * doubles at each level. The memo is limited to questions that reach an
 * alias because the other questions are short, and a memo on them cost
 * more than it saved (the measurement is recorded above
 * `dimensionsCouldMatch()`).
 */
let subtypePairs:
  { answers: Map<string, boolean>; active: Map<string, number> } | undefined;

/** Enter an unfold frame for `ref`. Returns `false` when `ref` is already
 * being unfolded further up the stack — a cycle; the caller must then answer
 * conservatively rather than recurse. */
function beginUnfold(ref: TypeReference, decides = true): boolean {
  if (unfoldingRefs === null) unfoldingRefs = new Set();
  else if (unfoldingRefs.has(ref)) {
    // A refusal decides an answer of `provablyDisjoint` (see
    // `subtypeLow`); the lhs unfold of `isSubtype` only registers the
    // record, and passes `decides: false`.
    if (decides) noteSubtypeAssumption();
    return false;
  }
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
 * The right-hand types each structural alias on the LEFT is being unfolded
 * against, one entry per live lhs unfold frame (paired with `beginUnfold`).
 *
 * A self-referential alias whose definition names itself as a bare union
 * arm (`type alias cyc = cyc | tuple<number, number>`) has the values of its
 * other arms only: the arm `cyc` adds no value of its own. So when the
 * question `cyc <: R` is asked while the same question is being answered
 * further up the stack, that arm is taken as a subtype of `R` and the union
 * is decided by its other arms (`isAssumedUnionArm`). Without this, the
 * re-entry was refused by `beginUnfold`, the arm answered `false`, and
 * `cyc` was a subtype of nothing, not even `tuple`. The assumption is made
 * only for the SAME `R` (compared by identity), so an alias reached again
 * through a constructor, where the question asked is about an element
 * type, is still refused as before.
 *
 * The rule: a self-referential alias that names itself as a bare union arm
 * is a subtype of what its other arms are subtypes of (user decision
 * 2026-10-19).
 */
let lhsUnfoldTargets: Map<TypeReference, Set<unknown>> | null = null;

/**
 * The right-hand types, by structural key, each structural alias on the LEFT
 * is being unfolded against: the pairs of the coinductive cycle rule of the
 * lhs unfold in `isSubtype`. One key per live frame; a frame adds its key and
 * removes it in a `finally`, so the map holds exactly the frames on the
 * stack. Allocated lazily and released at depth zero.
 */
let lhsUnfoldKeys: Map<TypeReference, Set<string>> | null = null;

/** The most pairs one alias may have on the lhs unfold stack at once. The
 * pairs are finite by construction; this bound only stops a rule that would
 * build an ever larger rhs. */
const MAX_LHS_UNFOLD_PAIRS = 32;

/** The number of unfolds of applications of generic aliases (with type
 * arguments) that `isSubtype` holds open now, on the lhs and the rhs. */
let openAliasUnfolds = 0;

/** The most unfolds of applications of generic aliases that `isSubtype`
 * holds open at once. The guards above are keyed by the alias node, and a
 * generic alias whose arguments grow at each unfold
 * (`A<T> = B<list<T>> | integer`, `B<T> = A<T>`) makes a new node at each
 * step, so without this bound the unfolds nested until the stack
 * overflowed. Past it, the answer is the conservative `false`. An alias
 * with no type argument is not counted: the guards above recognize its
 * repeats, and a long chain of such aliases is followed to its end. */
const MAX_OPEN_ALIAS_UNFOLDS = 256;

/** Whether `t` is an application of a generic alias, with type arguments. */
function isGenericApplication(t: TypeReference): boolean {
  return (t.args?.length ?? 0) > 0;
}

/** A number for each object met by {@link cyclePairKey} that it names by
 * identity: a reference DECLARATION record, so that a key names a reference
 * by its declaration and not by its name, and the object payload of a value
 * type. */
const cycleKeyObjectIds = new WeakMap<object, number>();
let nextCycleKeyObjectId = 0;

function cycleKeyObjectId(o: object): number {
  let id = cycleKeyObjectIds.get(o);
  if (id === undefined) {
    id = nextCycleKeyObjectId++;
    cycleKeyObjectIds.set(o, id);
  }
  return id;
}

/**
 * The key of a right-hand type in the pairs of the lhs unfold's cycle rule.
 * Two types with the same key are taken as the same question, and a repeated
 * question is assumed to hold, so the key must not merge two types that
 * differ. The de-dup key (`typeToDedupKey`) is not exact enough for that: it
 * prints a reference by its name, so two aliases of the same name declared in
 * nested scopes share it, and it drops the stated purity of a signature.
 *
 * The key is built by a walk that follows the structure of each type node,
 * so a field map (the fields of a record or an object type) is read as a
 * map, never as a node: a record with a field named `kind` is not mistaken
 * for another node. Every field is kept:
 * - a reference is named by the identity of its declaration record, with
 *   the keys of its arguments, and its definition is not entered (a
 *   recursive type reaches itself through it);
 * - the payload of a value type is written by its JavaScript kind: a number
 *   (`±Infinity` and `NaN` included), a big integer, a string or a boolean
 *   by its value, and an object or a function by its identity. An object
 *   payload can be any run-time value, a circular one included, and the
 *   value-subtype rule tells two objects apart by identity, so two
 *   equal-looking objects get two keys.
 *
 * Exported for the tests of the key (`type-relation-gaps.test.ts`); it has
 * no other use outside this module.
 */
export function cyclePairKey(t: Type | TypeString): string {
  if (typeof t === 'string') return t;
  return cycleTypeKey(t);
}

/**
 * The interning table of {@link cyclePairKey}: each composite node gets a
 * number, the same number for two nodes of the same structure. A node's
 * structure is written with the numbers of its children, so every key is
 * short, and a node shared between several places (`Uₙ = Uₙ₋₁ | Uₙ₋₁`) is
 * keyed once, through the identity cache, instead of once per path.
 *
 * The keys are compared only while an lhs-unfold frame of `isSubtype` or an
 * `inhabitation()` walk runs, so the table is dropped when the last of them
 * ends (`cycleKeyTableUsers`), and a new one starts with the next question.
 */
let cycleKeyTable: {
  byStructure: Map<string, number>;
  byNode: WeakMap<object, number>;
  /** A number for each `Symbol` payload of a value type, by identity. A
   * symbol is not a valid `WeakMap` key on every platform, so it is held
   * here, for the life of the table only. */
  bySymbol: Map<symbol, number>;
  /** The answer of `inhabitation()` for each node already asked, so that
   * the recursive probes of one `couldMatch` question walk each node once.
   * The answer of a walk from a node does not depend on where the node was
   * met, and no type changes during one question. */
  inhabitation: WeakMap<object, 'empty' | 'inhabited' | 'unknown'>;
} | null = null;

/** The interning table, created when it is first needed. */
function cycleKeys(): NonNullable<typeof cycleKeyTable> {
  cycleKeyTable ??= {
    byStructure: new Map(),
    byNode: new WeakMap(),
    bySymbol: new Map(),
    inhabitation: new WeakMap(),
  };
  return cycleKeyTable;
}

/** The number of computations that hold {@link cycleKeyTable}: each live
 * lhs-unfold frame of `isSubtype` and each `inhabitation()` walk. Their
 * keys stay comparable only while the table lives, and a walk can call
 * `isSubtype` (and the reverse), so the table is dropped only when the
 * count returns to zero, and always from a `finally` block. */
let cycleKeyTableUsers = 0;

function enterCycleKeys(): void {
  cycleKeyTableUsers += 1;
}

function leaveCycleKeys(): void {
  cycleKeyTableUsers -= 1;
  if (cycleKeyTableUsers === 0) cycleKeyTable = null;
}

/** The key of the type `t` as a child of another node: a primitive by its
 * name, a composite node by its interned number. */
function cycleTypeKey(t: Type): string {
  if (typeof t === 'string') return `p:${t}`;
  const table = cycleKeys();
  const cached = table.byNode.get(t);
  if (cached !== undefined) return `#${cached}`;
  const structure = cycleNodeStructure(t);
  let id = table.byStructure.get(structure);
  if (id === undefined) {
    id = table.byStructure.size;
    table.byStructure.set(structure, id);
  }
  table.byNode.set(t, id);
  return `#${id}`;
}

/** The structure of the composite type node `t`, with each child written by
 * {@link cycleTypeKey}. */
function cycleNodeStructure(t: Exclude<Type, string>): string {
  const types = (ts: ReadonlyArray<Type> | undefined) =>
    ts === undefined ? '-' : `[${ts.map(cycleTypeKey).join(',')}]`;
  const named = (e: NamedElement) =>
    `${JSON.stringify(e.name ?? null)}:${cycleTypeKey(e.type)}`;
  const namedList = (es: ReadonlyArray<NamedElement> | undefined) =>
    es === undefined ? '-' : `[${es.map(named).join(',')}]`;
  const fieldMap = (m: Readonly<Record<string, Type>>) => {
    const fields = Object.keys(m)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + cycleTypeKey(m[k]));
    return `{${fields.join(',')}}`;
  };
  const typeParam = (p: TypeParameter) =>
    [
      JSON.stringify(p.name),
      cycleDataKey(p.kind),
      cycleDataKey(p.variance),
      p.bound === undefined ? '-' : cycleTypeKey(p.bound),
    ].join(':');
  switch (t.kind) {
    case 'reference': {
      const id = cycleKeyObjectId(declarationOf(t));
      return `ref#${id}${types(t.args)}`;
    }
    case 'value': {
      const p: unknown = t.value;
      if (typeof p === 'symbol') {
        // Two symbols are two values, told apart by identity, as objects are.
        const symbols = cycleKeyTable!.bySymbol;
        let id = symbols.get(p);
        if (id === undefined) {
          id = symbols.size;
          symbols.set(p, id);
        }
        return `value${id}`;
      }
      return (typeof p === 'object' && p !== null) || typeof p === 'function'
        ? `value#${cycleKeyObjectId(p as object)}`
        : `value(${cycleDataKey(p)})`;
    }
    case 'record':
    case 'object':
      return `${t.kind}${fieldMap(t.elements)}`;
    case 'tuple':
      return `tuple${namedList(t.elements)}`;
    case 'signature':
      return [
        'signature',
        namedList(t.args),
        namedList(t.optArgs),
        t.variadicArg === undefined ? '-' : named(t.variadicArg),
        cycleDataKey(t.variadicMin),
        cycleDataKey(t.effects),
        t.typeParams === undefined
          ? '-'
          : `[${t.typeParams.map(typeParam).join(',')}]`,
        cycleTypeKey(t.result),
      ].join(';');
    case 'union':
    case 'intersection':
      return `${t.kind}${types(t.types)}`;
    case 'negation':
      return `negation(${cycleTypeKey(t.type)})`;
    case 'dictionary':
      return `dictionary(${cycleTypeKey(t.values)})`;
    case 'list':
      return `list(${cycleTypeKey(t.elements)};${cycleDataKey(t.dimensions)};${cycleDataKey(t.dimensionVariables)})`;
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return `${t.kind}(${cycleTypeKey(t.elements)})`;
    default:
      // `numeric`, `symbol`, `expression` and `variable` nodes hold data
      // only (bounds, names), no nested type.
      return `${t.kind}${cycleDataKey({ ...t, kind: undefined })}`;
  }
}

/** The key of a piece of data inside a type node: a number, a string, a
 * boolean, a big integer, `null`, `undefined`, or an array or a plain
 * object of those (its fields sorted, `undefined` fields left out). */
function cycleDataKey(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return `n:${String(v)}`;
  if (typeof v === 'boolean') return `b:${String(v)}`;
  if (typeof v === 'bigint') return `i:${v}`;
  if (Array.isArray(v)) return `[${v.map(cycleDataKey).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const fields = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + cycleDataKey(o[k]));
    return `{${fields.join(',')}}`;
  }
  return `#${typeof v}`;
}

/** Whether the union arm `arm` is a structural alias already being unfolded
 * against `rhs` further up the stack: see `lhsUnfoldTargets`. */
function isAssumedUnionArm(arm: Type, rhs: unknown): boolean {
  const assumed =
    typeof arm === 'object' &&
    arm.kind === 'reference' &&
    arm.alias === true &&
    lhsUnfoldTargets?.get(arm)?.has(rhs) === true;
  if (assumed) noteSubtypeAssumption();
  return assumed;
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
  } else if (seen.has(lhs)) {
    noteSubtypeAssumption();
    return false;
  }
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

  // A question that meets a reference keeps its answers in `disjointPairs`
  // (see there). A question with no reference does not open it, so it pays
  // nothing for it.
  const isReference = (t: Type): boolean =>
    typeof t === 'object' && t.kind === 'reference';
  if (disjointPairs === undefined && !isReference(a) && !isReference(b))
    return provablyDisjointRules(a, b);
  const owned = disjointPairs === undefined;
  if (owned) {
    enterCycleKeys();
    disjointPairs = new Map();
  }
  try {
    const key = `${cyclePairKey(a)}#${cyclePairKey(b)}`;
    const known = disjointPairs!.get(key);
    if (known !== undefined) return known;
    const outerLow = subtypeLow;
    subtypeLow = Infinity;
    try {
      const answer = provablyDisjointRules(a, b);
      if (subtypeLow === Infinity) disjointPairs!.set(key, answer);
      return answer;
    } finally {
      subtypeLow = Math.min(outerLow, subtypeLow);
    }
  } finally {
    if (owned) {
      disjointPairs = undefined;
      leaveCycleKeys();
    }
  }
}

/**
 * The answers of `provablyDisjoint` for the pairs of one question that
 * meets a reference, by the interning keys of the two types
 * (`cyclePairKey`). Created by the outermost call whose operand is a
 * reference, and dropped when it returns.
 *
 * Without it, a union of aliases that reach the same alias through two arms
 * (`Vₙ = Aₙ | Bₙ` with `Aₙ = Vₙ₋₁` and `Bₙ = Vₙ₋₁ | integer`) is
 * distributed again on each path, and the work doubles at each level. An
 * answer that a cycle guard decided (`subtypeLow`) depends on where it was
 * asked, and is not kept.
 */
let disjointPairs: Map<string, boolean> | undefined;

/** The rules of {@link provablyDisjoint}. */
function provablyDisjointRules(a: Type, b: Type): boolean {
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

  // `broadcastable<T>` is the union of `T` and its collection arm
  // (`broadcastCollectionArm`: `tensor<T>` when no value of `T` is a list,
  // `list<T>` otherwise), the same expansion `isSubtype` uses on both
  // sides, so it distributes exactly like a union: disjoint from it iff disjoint from
  // BOTH arms. Without this the
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
      provablyDisjoint(a, broadcastCollectionArm(b.elements))
    );
  if (typeof a === 'object' && a.kind === 'broadcastable')
    return (
      provablyDisjoint(a.elements, b) &&
      provablyDisjoint(broadcastCollectionArm(a.elements), b)
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

  // Two tuple types. A tuple value has exactly as many components as its
  // type has elements (`isSubtype` requires the same length), so two tuple
  // types of different lengths share no value, and neither do two tuple
  // types with a pair of disjoint components at the same position. The
  // "an empty collection inhabits both" caveat at the bottom of this
  // function does not apply: the empty tuple inhabits `tuple<>` only.
  //
  // `box.ts` keeps an argument-type error only when every candidate
  // parameter is provably disjoint from the operand
  // (`keepProvisionalOperands`). Without this rule, a symbol typed
  // `tuple<boolean>` was accepted at a `tuple<number, number>` parameter,
  // which a tuple literal `(True)` of the same type is not.
  if (
    typeof a === 'object' &&
    a.kind === 'tuple' &&
    typeof b === 'object' &&
    b.kind === 'tuple'
  ) {
    if (a.elements.length !== b.elements.length) return true;
    if (a.elements.some((e, i) => provablyDisjoint(e.type, b.elements[i].type)))
      return true;
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
      // `T | list<T>` — it spans two buckets. A `negation` or
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
/**
 * Whether two dimension lists admit a common shape: the same rank, and on
 * each axis an open length (`-1`) or the same length. A tensor of unknown
 * rank (`null`) admits every shape.
 */
function dimensionsCouldMatch(
  a: number[] | null,
  b: number[] | null
): boolean {
  if (a === null || b === null) return true;
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
 * Two PLAIN lists could always match: `[]` types `list<never>`, a value of
 * both, and their meet is `list<never>`, which is not empty
 * (`meetListTypes`; user decision of 2026-10-21, which aligned this
 * predicate with the meet). So `list<integer>.couldMatch('list<string>')`
 * and `list<integer>.couldMatch('list<list<integer>>')` are `true`. A tensor
 * with a fixed, positive first axis holds no empty list, so against a plain
 * list its cells must match the list's elements; two tensors could match
 * when their shapes could be equal and their cells could match, or when
 * both admit the empty shape. Other collection kinds (`set`, `collection`,
 * `indexed_collection`) keep the element-wise reading.
 *
 * It is *not* the negation of {@linkcode provablyDisjoint}: that predicate is
 * conservative (unproven ⇒ "may overlap"), which makes it answer `true` for
 * shapes that plainly cannot coincide, such as a `tuple<number, number>` and a
 * `list<tuple<number, number>>`. `couldMatch` is decisive for the composite
 * shapes it models and falls back to assignability elsewhere.
 */
/** The unrestricted structural expansion of each bare collection family,
 * used by `couldMatch` before the structural overlap probes. */
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

/** Whether every field that the record type `r` requires is shown to hold a
 * value. A record type with a field of the empty type (`record{a: never}`)
 * has no value, so it overlaps nothing; a field whose answer is unknown
 * proves no overlap either, and the record probes of `couldMatch` then add
 * no answer. */
function recordFieldsInhabited(r: RecordType): boolean {
  return Object.values(r.elements).every(
    (t) => inhabitation(t) === 'inhabited'
  );
}

/** The deepest level of structural nesting that {@link inhabitation}
 * reads. Alias hops do not count: an acyclic alias chain is followed to its
 * end. */
const MAX_INHABITATION_DEPTH = 8;

/** The most nodes that {@link inhabitation} visits in one question. */
const MAX_INHABITATION_STEPS = 512;

/**
 * Whether the type `t` has a value, as far as its structure shows:
 * `'empty'` (no value: `never`, an alias of an empty type, a record with a
 * required field of an empty type, a tuple with an empty slot, a list with
 * fixed positive lengths and empty cells, a union of empty arms),
 * `'inhabited'` (a value is shown to exist), or `'unknown'` (the walk cannot
 * decide: a cycle of aliases, a negation, an intersection, a type variable,
 * a structure deeper than {@link MAX_INHABITATION_DEPTH}).
 *
 * An `'unknown'` answer must never be read as either of the other two: a
 * caller that needs a proof of a value, or of no value, does not get one.
 */
function inhabitation(t: Type): 'empty' | 'inhabited' | 'unknown' {
  // The walk keys references with the interning table of `cyclePairKey`,
  // so it holds the table while it runs (`enterCycleKeys`).
  if (typeof t === 'string') return t === 'never' ? 'empty' : 'inhabited';
  enterCycleKeys();
  try {
    const memo = cycleKeys().inhabitation;
    const known = memo.get(t);
    if (known !== undefined) return known;
    const answer = inhabitationWalk(t, 0, undefined, undefined, {
      left: MAX_INHABITATION_STEPS,
    });
    memo.set(t, answer);
    return answer;
  } finally {
    leaveCycleKeys();
  }
}

/** The walk of {@link inhabitation}. `steps.left` is the number of nodes it
 * may still visit in this question: a node shared by several fields or
 * arms (`record{a: R, b: R, …}` at each of 8 levels) is visited at each
 * place, and without the budget the walk could take exponentially many
 * steps. When it runs out, the answer is `'unknown'`. */
function inhabitationWalk(
  t: Type,
  depth: number,
  seen: ReadonlySet<string> | undefined,
  unguarded: ReadonlySet<string> | undefined,
  steps: { left: number }
): 'empty' | 'inhabited' | 'unknown' {
  if (typeof t === 'string') return t === 'never' ? 'empty' : 'inhabited';
  if (depth > MAX_INHABITATION_DEPTH || --steps.left < 0) return 'unknown';
  const walk = inhabitationWalk;
  // The answer for a type that holds a value of EACH of `parts` (a record,
  // a tuple): empty when one part is, inhabited when all parts are.
  const all = (parts: Type[]): 'empty' | 'inhabited' | 'unknown' => {
    let result: 'inhabited' | 'unknown' = 'inhabited';
    for (const part of parts) {
      const r = walk(part, depth + 1, seen, undefined, steps);
      if (r === 'empty') return 'empty';
      if (r === 'unknown') result = 'unknown';
    }
    return result;
  };
  switch (t.kind) {
    case 'reference': {
      // An alias IS its definition, and the values of a nominal type are
      // values of its definition. A chain of references is followed with no
      // depth cost; a reference met again on the same path is a cycle.
      //
      // `unguarded` holds the references entered since the last
      // constructor (a record, a tuple, a list) on the path. A reference met
      // again before any constructor is an UNPRODUCTIVE cycle (`R = R`,
      // `R = S` with `S = R`, the arm `R` of `R = R | S`): no value is built
      // through it, so it adds none, and that path is `'empty'`. A cycle
      // through a constructor (`R = list<R>`) can build values, and the
      // walk does not decide it (`'unknown'`).
      //
      // A reference is identified by its declaration AND its arguments
      // (`cycleTypeKey`): two applications of one generic type
      // (`Wrap<Wrap<integer>>` reaches `Wrap<integer>`) are different types,
      // not a cycle.
      if (t.def === undefined) return 'unknown';
      const key = cycleTypeKey(t);
      if (unguarded?.has(key)) return 'empty';
      if (seen?.has(key)) return 'unknown';
      const def = aliasDefinitionAt(t);
      if (def === undefined) return 'unknown';
      return walk(
        def,
        depth,
        new Set(seen).add(key),
        new Set(unguarded).add(key),
        steps
      );
    }
    case 'record':
      return all(Object.values(t.elements));
    case 'tuple':
      return all(t.elements.map((e) => e.type));
    case 'list':
      // A list holds at least one cell only when every axis has a fixed,
      // positive length (`list<never^1>`); a list with no dimensions, a
      // tensor of unknown rank (`dimensions` is `null`), or a list with an
      // open (`-1`) or zero-length axis, holds the empty list (`list<never>`
      // is the type of `[]`).
      if (
        t.dimensions &&
        t.dimensions.length > 0 &&
        t.dimensions.every((d) => d > 0)
      )
        return walk(t.elements, depth + 1, seen, undefined, steps);
      return 'inhabited';
    case 'union': {
      let result: 'empty' | 'unknown' = 'empty';
      for (const arm of t.types) {
        const r = walk(arm, depth + 1, seen, unguarded, steps);
        if (r === 'inhabited') return 'inhabited';
        if (r === 'unknown') result = 'unknown';
      }
      return result;
    }
    case 'numeric': {
      const lower = t.lower ?? -Infinity;
      const upper = t.upper ?? Infinity;
      if (lower > upper) return 'empty';
      // Every tier but `number` and `infinity` holds finite numbers only, so
      // a range whose lower bound is `+∞` or whose upper bound is `−∞`
      // (`integer<oo..>`) holds none.
      if (
        t.type !== 'number' &&
        t.type !== 'infinity' &&
        (lower === Infinity || upper === -Infinity)
      )
        return 'empty';
      if (t.type === 'integer') {
        const first =
          Math.ceil(lower) + (t.lowerOpen && Number.isInteger(lower) ? 1 : 0);
        const last =
          Math.floor(upper) - (t.upperOpen && Number.isInteger(upper) ? 1 : 0);
        return first <= last ? 'inhabited' : 'empty';
      }
      if (lower < upper) return 'inhabited';
      if (t.lowerOpen || t.upperOpen) return 'empty';
      // A closed range with equal finite endpoints holds its endpoint
      // (`real<0..0>` holds 0), on every tier that holds a finite real.
      return Number.isFinite(lower) &&
        (t.type === 'real' ||
          t.type === 'rational' ||
          t.type === 'complex' ||
          t.type === 'number')
        ? 'inhabited'
        : 'unknown';
    }
    case 'intersection': {
      // An intersection has no value when one member has none, or when two
      // members are provably disjoint (`integer & string`).
      const members = t.types;
      if (
        members.some(
          (m) => walk(m, depth + 1, seen, unguarded, steps) === 'empty'
        )
      )
        return 'empty';
      // Each pair is charged to the budget, with the size of its two members
      // (`typeTreeSize`, which counts a shared node at each place): the
      // disjointness test follows every path of its operands, and a small
      // intersection whose members share one node (`Iₙ = Iₙ₋₁ & Iₙ₋₁`) has
      // exponentially many. A pair the budget cannot cover proves nothing.
      for (let i = 0; i < members.length; i++)
        for (let j = i + 1; j < members.length; j++) {
          steps.left -= 1;
          if (steps.left < 0) return 'unknown';
          const size =
            typeTreeSize(members[i], steps.left) +
            typeTreeSize(members[j], steps.left);
          if (size > steps.left) return 'unknown';
          steps.left -= size;
          if (provablyDisjoint(members[i], members[j])) return 'empty';
        }
      return 'unknown';
    }
    case 'negation':
      // `!any` holds nothing: `any` holds every value.
      return t.type === 'any' ? 'empty' : 'unknown';
    case 'value':
    case 'symbol':
    case 'expression':
    case 'signature':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'dictionary':
    case 'broadcastable':
      // Each holds a value: the literal, a symbol, an expression, a function,
      // the empty collection.
      return 'inhabited';
    default:
      return 'unknown';
  }
}

/**
 * `couldMatch` for a bare `tuple` or bare `record` (`bare`) against a
 * composite `other` of the same family. Bare names accept every slot or
 * field type. `false` means the general overlap probes should continue.
 */
function bareTupleOrRecordCouldMatch(bare: Type, other: Type): boolean {
  if (typeof other !== 'object') return false;
  if (bare === 'tuple') {
    if (other.kind === 'tuple')
      return other.elements.every((x) => couldMatchWithin('any', x.type));
    if (other.kind === 'indexed_collection' || other.kind === 'collection')
      return couldMatchWithin('any', other.elements);
    return false;
  }
  if (bare === 'record') {
    if (other.kind === 'record')
      return Object.values(other.elements).every((t) =>
        couldMatchWithin('any', t)
      );
    if (other.kind === 'dictionary')
      return couldMatchWithin('any', other.values);
    if (other.kind === 'collection')
      return couldMatchWithin(
        {
          kind: 'tuple',
          elements: [{ type: 'string' }, { type: 'any' }],
        },
        other.elements
      );
  }
  return false;
}

/**
 * The state of `couldMatch()` for the pairs of one question, created when
 * the question first unfolds a transparent alias, and dropped when the
 * outermost `couldMatch()` call returns. The pairs are keyed by the
 * interning keys of their two types (`cycleTypeKey()`).
 *
 * - `answers`: the answer for each pair already decided. A question can
 *   meet one pair on many paths (each level of a chain of aliases with two
 *   branches doubles them), so the work grows with the number of distinct
 *   pairs, not with the number of paths.
 * - `active`: the pairs being answered now, with their depth on the stack.
 *   A pair met again while it is being answered (a recursive alias,
 *   `json = list<json> | integer`) adds no value on that path, because a
 *   value is finite: that path answers `false`, and the other arms decide.
 * - `low`: the smallest depth of an active pair met again since the current
 *   pair started. A `false` that relied on meeting a pair below the current
 *   one (a smaller depth) holds on that path only, so it is not kept in
 *   `answers`. When every pair met again is the current pair or one above
 *   it, the `false` is exact and is kept: without this, a chain of
 *   self-recursive aliases was compared again on every path (the lowlink
 *   rule of Tarjan's algorithm). A `true` is a value found, and is kept.
 * - `steps`: the pairs compared so far. Past `MAX_COULD_MATCH_STEPS`, or
 *   past `MAX_COULD_MATCH_DEPTH` open pairs, the answer is `true`, "may
 *   match": a generic alias whose arguments grow at each unfold
 *   (`A<T> = B<list<T>> | integer`, `B<T> = A<T>`) never meets a pair
 *   again.
 */
let couldMatchPairs:
  | {
      answers: Map<string, boolean>;
      active: Map<string, number>;
      low: number;
      steps: number;
      /** Whether this question created `subtypePairs`. */
      ownsSubtypePairs: boolean;
    }
  | undefined;

/** The most pairs one `couldMatch()` question compares once it unfolds an
 * alias (see `couldMatchPairs`). */
const MAX_COULD_MATCH_STEPS = 100_000;

/** The most pairs one `couldMatch()` question holds open at once: a generic
 * alias whose arguments grow at each unfold nests without end. Past it,
 * the answer is `true`, "may match". */
const MAX_COULD_MATCH_DEPTH = 512;

export function couldMatch(a: Type, b: Type): boolean {
  // The question holds the interning table, and with it the memo of
  // `inhabitation()`, for all its recursive probes: the emptiness test
  // below runs at each of them, and each node is walked once.
  const outer = couldMatchPairs === undefined;
  enterCycleKeys();
  try {
    return couldMatchWithin(a, b);
  } finally {
    if (outer && couldMatchPairs !== undefined) {
      closeSubtypePairs(couldMatchPairs.ownsSubtypePairs);
      couldMatchPairs = undefined;
    }
    leaveCycleKeys();
  }
}

/** Whether `t` is a reference to a transparent alias with a definition. */
function isTransparentAliasReference(t: Type | TypeString): t is TypeReference {
  return (
    typeof t === 'object' &&
    t.kind === 'reference' &&
    t.alias === true &&
    t.def !== undefined
  );
}

/** The body of {@link couldMatch}, run while the question holds the
 * interning table. */
function couldMatchWithin(a: Type, b: Type): boolean {
  // `never` is uninhabited: no value is one.
  if (a === 'never' || b === 'never') return false;
  const aliasA = isTransparentAliasReference(a);
  if (
    !aliasA &&
    !isTransparentAliasReference(b) &&
    couldMatchPairs === undefined
  )
    return couldMatchStructure(a, b);
  // The memo of `isSubtype` (`subtypePairs`) is opened with this state and
  // stays open for the rest of the question: the fallback of
  // `couldMatchStructure()` asks `isSubtype` for many pairs, and each answer
  // that memo keeps does not depend on where it was asked. A question that
  // meets no alias does not open it, so it pays nothing for it.
  const pairs = (couldMatchPairs ??= {
    answers: new Map(),
    active: new Map(),
    low: Infinity,
    steps: 0,
    ownsSubtypePairs: openSubtypePairs(),
  });
  const key = `${cycleTypeKey(a)}&${cycleTypeKey(b)}`;
  const known = pairs.answers.get(key);
  if (known !== undefined) return known;
  const activeAt = pairs.active.get(key);
  if (activeAt !== undefined) {
    pairs.low = Math.min(pairs.low, activeAt);
    return false;
  }
  if (
    ++pairs.steps > MAX_COULD_MATCH_STEPS ||
    pairs.active.size >= MAX_COULD_MATCH_DEPTH
  )
    return true;
  const index = pairs.active.size;
  const outerLow = pairs.low;
  pairs.low = Infinity;
  pairs.active.set(key, index);
  let answer = false;
  try {
    if (aliasA || isTransparentAliasReference(b)) {
      // A transparent alias IS its definition (`aliasDefinitionAt()`
      // substitutes the arguments of a generic alias), so it is compared
      // through it: with `type alias json = list<json> | integer`, `json`
      // and `number` share every integer.
      const alias = (aliasA ? a : b) as TypeReference;
      const def = aliasDefinitionAt(alias);
      answer =
        def === undefined
          ? couldMatchStructure(a, b)
          : aliasA
            ? couldMatchWithin(def, b)
            : couldMatchWithin(a, def);
    } else answer = couldMatchStructure(a, b);
    if (answer || pairs.low >= index) pairs.answers.set(key, answer);
    return answer;
  } finally {
    pairs.active.delete(key);
    // A pair met again below this one is still open for the caller.
    pairs.low = Math.min(outerLow, pairs.low < index ? pairs.low : Infinity);
  }
}

/** The rules of {@link couldMatch} for two types that are not transparent
 * aliases. */
function couldMatchStructure(a: Type, b: Type): boolean {
  // Distribute over unions, at any depth. This is the whole point of the
  // predicate.
  if (typeof a === 'object' && a.kind === 'union')
    return a.types.some((t) => couldMatchWithin(t, b));
  if (typeof b === 'object' && b.kind === 'union')
    return b.types.some((t) => couldMatchWithin(a, t));

  // `broadcastable<T>` is the union of `T` and its collection arm
  // (`broadcastCollectionArm`: `tensor<T>` when no value of `T` is a list,
  // `list<T>` otherwise), the same expansion `isSubtype` and `provablyDisjoint` use,
  // so it distributes like one: it could match iff EITHER arm could. Without this a
  // broadcastable subject fell to the containment fallback, which answered
  // `broadcastable<number>` vs `collection<any>` with `false` even though
  // the collection arm inhabits it. Both sides gain the expansion together
  // and the recursion is on strictly smaller types, so it terminates.
  if (typeof a === 'object' && a.kind === 'broadcastable')
    return (
      couldMatchWithin(a.elements, b) ||
      couldMatchWithin(broadcastCollectionArm(a.elements), b)
    );
  if (typeof b === 'object' && b.kind === 'broadcastable')
    return (
      couldMatchWithin(a, b.elements) ||
      couldMatchWithin(a, broadcastCollectionArm(b.elements))
    );

  // Neither is any other type shown to have no value (`record{a: never}`,
  // `tuple<never>`, an alias of `never`). Without this test, the
  // assignability fallback below answered `true` for such a type, since an
  // empty type is a subtype of many others. An `'unknown'` answer of the
  // walk proves nothing, and the other tests decide. It runs after the
  // distribution over union arms: an empty union is met at its arms, and a
  // union shared by its own arms (`Uₙ = Uₙ₋₁ | Uₙ₋₁`) costs no more than
  // its distribution.
  if (inhabitation(a) === 'empty' || inhabitation(b) === 'empty') return false;

  // Bare collection constructors have unrestricted contents; expand them
  // so the structural overlap probes below
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

  // No fixed tuple arity or record field list spells the whole family.
  // Check their overlap with parameterized collections separately.
  if (bareTupleOrRecordCouldMatch(a, b) || bareTupleOrRecordCouldMatch(b, a))
    return true;

  // Two numeric ranges that overlap share a value although neither contains
  // the other: `integer<1..10>` and `integer<5..20>` share `5`. The
  // containment check below misses that, so a range pair is decided by its
  // meet (`meetNumericRangeMembers()`): it can share a value when a range of
  // the meet can hold one. A meet range with no value (`integer` between
  // `0.5` and `0.7`, or `real<0..<1>` met with `real<1..2>`) does not count.
  {
    const an = asNumericRange(a);
    const bn = asNumericRange(b);
    if (
      an !== null &&
      bn !== null &&
      meetNumericRangeMembers(an, bn).some((m) => inhabitation(m) !== 'empty')
    )
      return true;
  }

  // Structural probe over same-kind composites. This only ever ADDS answers:
  // any shape it does not model falls through to the assignability check
  // below, so the result is never narrower than `matches()` in either
  // direction. Kinds are compared like-with-like — a `set<T>` and a
  // `list<T>` are different runtime shapes, and no value is both.
  if (typeof a === 'object' && typeof b === 'object') {
    if (a.kind === 'list' && b.kind === 'list') {
      // The rules of the meet (`meetListTypes`), which answers `never` only
      // when the shapes exclude each other. Two plain lists always share
      // the empty list. Two tensors (a dimension list, or an unknown rank)
      // share a value when their shapes can agree and their cells can, or
      // when both admit the empty shape (a first axis that is open or
      // zero). A plain list and a rank-1 tensor share the empty list unless
      // the tensor's length is fixed and positive. Otherwise the elements
      // of the plain list are compared with the elements of the tensor
      // (`listElementType`: the cells of a rank-1 tensor, the rows of a
      // deeper one, a cell or a tensor for an unknown rank): a matrix of
      // integers is a `list<vector<integer>>`, not a `list<integer>`.
      const emptyAdmitted = (t: ListType): boolean =>
        t.dimensions === undefined ||
        t.dimensions === null ||
        (t.dimensions.length === 1 && t.dimensions[0] <= 0);
      if (a.dimensions === undefined && b.dimensions === undefined) return true;
      if (a.dimensions !== undefined && b.dimensions !== undefined) {
        if (dimensionsCouldMatch(a.dimensions, b.dimensions)) {
          if (couldMatchWithin(a.elements, b.elements)) return true;
          if (emptyAdmitted(a) && emptyAdmitted(b)) return true;
        }
      } else {
        const tensor = a.dimensions === undefined ? b : a;
        if (emptyAdmitted(tensor)) return true;
        if (couldMatchWithin(listElementType(a), listElementType(b)))
          return true;
      }
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
          return couldMatchWithin(x.type, y.type);
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
      if (couldMatchWithin(a.elements, elements)) return true;
    } else if (a.kind === 'dictionary' && b.kind === 'dictionary') {
      if (couldMatchWithin(a.values, b.values)) return true;
    } else if (a.kind === 'record' && b.kind === 'record') {
      // Width subtyping: a record with the fields of BOTH sides is below
      // both, so the fields they share must agree, and every other required
      // field must be able to hold a value (`record{a: never}` has no value).
      const bElements = b.elements;
      if (
        recordFieldsInhabited(a) &&
        recordFieldsInhabited(b) &&
        Object.keys(a.elements).every(
          (key) =>
            !Object.prototype.hasOwnProperty.call(bElements, key) ||
            couldMatchWithin(a.elements[key], bElements[key])
        )
      )
        return true;
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
        // A plain list beside an abstract collection: the empty list is a
        // value of both, as it is of two plain lists, and their meet
        // (`meetCollectionKinds`) is the list of the element meet, never
        // empty.
        const plainList = (t: Type): boolean =>
          typeof t === 'object' && t.kind === 'list' && t.dimensions === undefined;
        if (plainList(a) || plainList(b)) return true;
        // The elements of a list are what one index returns
        // (`listElementType`): the rows of a matrix, not its cells.
        const elementsOf = (t: CollectionType | SetType | ListType): Type =>
          t.kind === 'list' ? listElementType(t) : t.elements;
        const ea = elementsOf(a as CollectionType | SetType | ListType);
        const eb = elementsOf(b as CollectionType | SetType | ListType);
        if (couldMatchWithin(ea, eb)) return true;
      } else if (kinds.includes('collection') && kinds.includes('dictionary')) {
        const dict = (a.kind === 'dictionary' ? a : b) as DictionaryType;
        const coll = (a.kind === 'collection' ? a : b) as CollectionType;
        const entry: Type = {
          kind: 'tuple',
          elements: [{ type: 'string' }, { type: dict.values }],
        };
        if (couldMatchWithin(entry, coll.elements)) return true;
      } else if (
        kinds.includes('tuple') &&
        (kinds.includes('indexed_collection') || kinds.includes('collection'))
      ) {
        // A tuple is an indexed collection of its slots: it overlaps
        // `indexed_collection<E>` / `collection<E>` when every slot could
        // hold an `E` (`tuple<integer, any>` and `indexed_collection<integer>`
        // share `tuple<integer, integer>`).
        const tuple = (a.kind === 'tuple' ? a : b) as TupleType;
        const coll = (a.kind === 'tuple' ? b : a) as CollectionType;
        if (
          tuple.elements.every((x) => couldMatchWithin(x.type, coll.elements))
        )
          return true;
      } else if (kinds.includes('record') && kinds.includes('dictionary')) {
        // A record is a dictionary with known keys: it overlaps
        // `dictionary<V>` when every field could hold a `V`.
        const rec = (a.kind === 'record' ? a : b) as RecordType;
        const dict = (a.kind === 'record' ? b : a) as DictionaryType;
        if (
          recordFieldsInhabited(rec) &&
          Object.values(rec.elements).every((t) =>
            couldMatchWithin(t, dict.values)
          )
        )
          return true;
      } else if (kinds.includes('record') && kinds.includes('collection')) {
        // A record iterates as key–value entry tuples, as a dictionary does.
        // Each entry the record type requires is probed with its own key, the
        // string literal type of the field name: `record{a: integer}` and
        // `collection<tuple<"b", integer>>` share no value, since the entry
        // `("a", …)` is not a `tuple<"b", integer>`. Records are open, but a
        // value with only the required fields exists, so the other fields
        // add no constraint here.
        const rec = (a.kind === 'record' ? a : b) as RecordType;
        const coll = (a.kind === 'record' ? b : a) as CollectionType;
        if (
          recordFieldsInhabited(rec) &&
          Object.entries(rec.elements).every(([key, t]) =>
            couldMatchWithin(
              {
                kind: 'tuple',
                elements: [
                  { type: { kind: 'value', value: key } },
                  { type: t },
                ],
              },
              coll.elements
            )
          )
        )
          return true;
      }
    }
  }

  // A negation `!B` holds every value outside `B`, so it overlaps `a` when
  // some part of `a` is provably outside `B` (`value` and `!integer` share
  // `string`). The assignability fallback below cannot see this: neither side
  // is a subtype of the other. The overlap needs a positive witness
  // (`hasPartOutside`): `a ⊄ B` is not enough, because the subtype test is
  // conservative and can answer `false` for a containment it cannot prove
  // (`number` is covered by `complex | infinity | nan`, arm by arm). Without
  // a witness, the fallback answers.
  if (
    typeof b === 'object' &&
    b.kind === 'negation' &&
    hasPartOutside(a, b.type)
  )
    return true;
  if (
    typeof a === 'object' &&
    a.kind === 'negation' &&
    hasPartOutside(b, a.type)
  )
    return true;

  // Fall back to assignability in either direction: `a` could be a `b` if
  // every `a` is a `b`, or if some `b`s are `a`s. For a type whose
  // inhabitation is unknown (`inhabitation()`), this keeps the answer
  // `couldMatch` gave before the empty-type test above existed.
  if (isSubtype(a, b) || isSubtype(b, a)) return true;

  // A list type can also share a dimensioned list (a matrix, a tensor) with
  // a type that reads it another way: `matrix<integer>` is a `list<integer>`
  // (its scalar cells) and a `list<list<integer>>` (its rows), so those two
  // types overlap although their element types do not.
  return sharesDimensionedListSubtype(a, b);
}

/**
 * Whether some value of `a` is provably not a `b`: `a` itself, or a primitive
 * type below `a`, is inhabited and provably disjoint from `b`. This is the
 * witness `couldMatch` needs to answer that `a` overlaps the negation `!b`.
 * `provablyDisjoint` answers `true` only for a proven disjointness, so a
 * witness found here is real; `false` means "not shown" (`number` against
 * `complex | infinity | nan`, which covers it, has no witness).
 */
function hasPartOutside(a: Type, b: Type): boolean {
  // The probes below follow every path of their operands, and a small type
  // can have exponentially many (`Iₙ = Iₙ₋₁ & Iₙ₋₁` with shared nodes).
  // Past this size bound, no witness is looked for, and `couldMatch` gives
  // the answer of its fallback.
  if (
    typeTreeSize(a, MAX_WITNESS_CANDIDATES) +
      typeTreeSize(b, MAX_WITNESS_CANDIDATES) >
    MAX_WITNESS_CANDIDATES
  )
    return false;
  if (inhabitation(a) === 'inhabited' && provablyDisjoint(a, b)) return true;
  return PRIMITIVE_TYPES.some(
    (p) =>
      p !== a && !isEmptyType(p) && isSubtype(p, a) && provablyDisjoint(p, b)
  );
}

/**
 * The number of nodes of the type tree of `t`, where a node shared between
 * several places is counted at each place, as a walk that follows every
 * path meets it. The count stops once it exceeds `limit` (the answer is then
 * `limit + 1`), so a small type with exponentially many paths costs no more
 * than `limit` steps. A reference counts with its arguments and with its
 * definition (an alias or a nominal type), once per declaration on a path.
 */
function typeTreeSize(t: Type, limit: number): number {
  let count = 0;
  // The aliases being unfolded on the current path of the walk.
  const onPath = new Set<TypeReference>();
  const visit = (u: Type): boolean => {
    if (++count > limit) return false;
    if (typeof u === 'string') return true;
    switch (u.kind) {
      case 'list':
      case 'set':
      case 'collection':
      case 'indexed_collection':
      case 'broadcastable':
        return visit(u.elements);
      case 'dictionary':
        return visit(u.values);
      case 'union':
      case 'intersection':
        return u.types.every(visit);
      case 'negation':
        return visit(u.type);
      case 'tuple':
        return u.elements.every((e) => visit(e.type));
      case 'record':
      case 'object':
        return Object.values(u.elements).every(visit);
      case 'signature':
        return (
          [...(u.args ?? []), ...(u.optArgs ?? [])].every((e) =>
            visit(e.type)
          ) &&
          (u.variadicArg === undefined || visit(u.variadicArg.type)) &&
          visit(u.result)
        );
      case 'reference': {
        if (!(u.args ?? []).every(visit)) return false;
        // The operations that read this size unfold a reference: `narrow`
        // and the subtype tests unfold a structural alias, and
        // `provablyDisjoint` unfolds a nominal type too. So the definition
        // counts, once per declaration on a path.
        if (u.def === undefined) return true;
        const record = declarationOf(u);
        if (onPath.has(record)) return true;
        const def = aliasDefinitionAt(u);
        if (def === undefined) return true;
        onPath.add(record);
        try {
          return visit(def);
        } finally {
          onPath.delete(record);
        }
      }
      default:
        return true;
    }
  };
  visit(t);
  return Math.min(count, limit + 1);
}

/** The deepest rank of a dimensioned list that
 * {@link sharesDimensionedListSubtype} tries. */
const MAX_WITNESS_RANK = 4;

/** The most candidate lists that {@link sharesDimensionedListSubtype} tests
 * in one call. */
const MAX_WITNESS_CANDIDATES = 256;

/** `list<any>`: a type disjoint from it cannot hold a list. */
const LIST_OF_ANY_TYPE: Type = Object.freeze({ kind: 'list', elements: 'any' });

/**
 * `tensor<U>`: a tensor of unknown rank (1 or more) whose cells are `U`.
 */
export function tensorOf(cells: Type): ListType {
  return { kind: 'list', elements: cells, dimensions: null };
}

/**
 * Whether no value of the type `t` is a list: `t` is a subtype of `number`,
 * or it is provably disjoint from `list<any>` (a boolean, a string, a
 * tuple, a record, a set, a function, `integer | missing`, the markers).
 * A top (`any`, `unknown`), `value`, `expression`, a negation such as
 * `!integer`, and a type with a free type variable can hold a list, and
 * answer `false`.
 *
 * This is the semantic form of the syntactic test
 * `cellTypeMayCarryDimensions` (`primitive.ts`), which the type parser
 * applies to the cells of `tensor<U>` and `list<U^dims>`. The subtype
 * relation needs the semantic form: `value` passes the syntactic test, but
 * a `list<value>` holds matrices, so reading it as a rank-1
 * `tensor<value>` would make the relation intransitive
 * (`matrix<integer> <: list<value>`, and `matrix<integer>` is not a rank-1
 * tensor).
 */
export function cannotHoldAList(t: Type): boolean {
  if (isSubtype(t, 'number')) return true;
  if (freeTypeVariables(t).size > 0) return false;
  return provablyDisjoint(t, LIST_OF_ANY_TYPE);
}

/**
 * The collection arm of `broadcastable<T>`, which denotes `T` or this arm
 * (`BroadcastableType` in `types.ts`): `tensor<T>`, a tensor of any rank
 * whose cells are `T`, when no value of `T` is a list (`cannotHoldAList`:
 * a number, a boolean, a string, a tuple, `integer | missing`), so that a
 * matrix of numbers is a `broadcastable<number>` and a matrix of booleans
 * is a `broadcastable<boolean>`; the plain list `list<T>`, read by its
 * elements, when `T` can hold a list (`any`, `value`, a type variable), so
 * that a `list<any>` is a `broadcastable<any>`. Every rule that expands a
 * broadcastable (the subtype relation, `couldMatch`, `provablyDisjoint`,
 * the reducer's `expandBroadcastable`, the element type of
 * `collectionElementType`) builds its arm here.
 */
export function broadcastCollectionArm(elements: Type): ListType {
  if (cannotHoldAList(elements)) return tensorOf(elements);
  return { kind: 'list', elements };
}

/**
 * The type of the elements of the list type `t`: what one index into a
 * value of `t` returns.
 *
 * - A plain list, `list<E>` (no dimensions): `E`.
 * - A tensor with a dimension list, `vector<U>`, `matrix<U>`,
 *   `list<U^dims>`: the cells `U` at rank 1, and the rows, a tensor of the
 *   remaining axes with the same cells, at rank 2 or more (`matrix<U>`
 *   gives `vector<U>`, `list<U^(2x3x4)>` gives `matrix<U^(3x4)>`).
 * - A tensor of unknown rank, `tensor<U>`: a cell or a tensor of lower
 *   rank, `U | tensor<U>`.
 *
 * The same reading as `collectionElementType` in `utils.ts`, which calls
 * this function for a list. (Section 3.2 of
 * `docs/plans/2026-10-21-list-element-tensor-cell.md`.)
 */
export function listElementType(t: Readonly<ListType>): Type {
  const dims = t.dimensions;
  if (dims === undefined) return t.elements;
  if (dims === null)
    return { kind: 'union', types: [t.elements, tensorOf(t.elements)] };
  if (dims.length <= 1) return t.elements;
  return { kind: 'list', elements: t.elements, dimensions: dims.slice(1) };
}

/**
 * The questions `tensor<U> <: list<E>` open on the stack, keyed by the
 * interning keys of the two types (`cyclePairKey`).
 */
let openTensorListQuestions: Set<string> | null = null;

/**
 * Whether the tensor of unknown rank `lhs` (`tensor<U>`) is a subtype of
 * the plain list `rhs` (`list<E>`): whether its elements, `U | tensor<U>`,
 * are `E`.
 *
 * The elements of `tensor<U>` contain `tensor<U>` itself, so the question
 * can come back with the same two types when `E` is recursive: with
 * `type alias nest = list<nest | integer>`, `tensor<integer> <: nest` asks
 * `integer | tensor<integer> <: nest | integer`, then
 * `tensor<integer> <: nest` again, without end. The rule is coinductive: a
 * question that is open further up the stack is assumed to hold. This is
 * sound because each repeat passes through this function, which goes one
 * list level down into the value, and every value is finite: a value that
 * is not in `E` fails at a finite depth, on a branch that does not repeat.
 * The answer is recorded as an assumption (`noteSubtypeAssumption`), so
 * the memo of `isSubtype` does not keep an answer that depends on it above
 * the question it repeats.
 */
function tensorFitsPlainList(
  lhs: Readonly<ListType>,
  rhs: Readonly<ListType>
): boolean {
  enterCycleKeys();
  try {
    const key = `${cyclePairKey(lhs)}<:${cyclePairKey(rhs)}`;
    if (openTensorListQuestions?.has(key)) {
      noteSubtypeAssumption(subtypePairs?.active.get(key) ?? -1);
      return true;
    }
    openTensorListQuestions ??= new Set();
    openTensorListQuestions.add(key);
    try {
      return isSubtype(listElementType(lhs), rhs.elements);
    } finally {
      openTensorListQuestions.delete(key);
      if (openTensorListQuestions.size === 0) openTensorListQuestions = null;
    }
  } finally {
    leaveCycleKeys();
  }
}

/**
 * The meet of two list types, or `'keep'` when the pair has no spelling
 * and the caller keeps the intersection as written. `meet` is the meet of
 * two element or cell types: the intersection reducer's, or `narrow`'s.
 *
 * A list type is a plain list (`list<E>`, elements `E`), a tensor with a
 * dimension list (cells `U`, one length per axis, `-1` an open length), or
 * a tensor of unknown rank (`tensor<U>`, cells `U`). The rules:
 *
 * - Two plain lists: `list<E1 & E2>`, always. When the element meet is
 *   empty the answer is `list<never>`, the type of the empty list `[]`,
 *   which is a value of both: `list<integer> & list<string>` is
 *   `list<never>`, not `never`.
 * - Two tensors with dimension lists: the cell meet, with the axes met one
 *   by one (an open axis meets a fixed one as the fixed one, two different
 *   fixed lengths give `never`); different ranks give `never`. The answer
 *   is `never` only when the shapes exclude each other: an empty cell meet
 *   gives `never` when every axis is fixed and positive (no value has the
 *   shape and no cell), and a tensor of `never` cells otherwise (it holds
 *   the empty list). A pattern with dimension variables is kept as written
 *   unless the two shapes are spelled the same.
 * - Two tensors of unknown rank: `tensor<U & V>`. A tensor of unknown rank
 *   and a tensor with a dimension list: that dimension list with the cell
 *   meet.
 * - A plain list and a tensor of rank 1: the rank-1 tensor with the meet of
 *   the elements and the cells; `never` only when that meet is empty and
 *   the length is fixed and positive. With an open length this is the rule
 *   that `list<U>` and `vector<U>` denote the same values for a numeric `U`.
 * - A plain list and a tensor of rank 2 or more: the elements of the tensor
 *   are its rows `R`. The tensor itself when `R` is a subtype of the
 *   elements of the plain list, `never` when the meet of the two is empty
 *   (the empty list is not a tensor of rank 2 or more, so no value is in
 *   both), and `'keep'` otherwise.
 * - A plain list and a tensor of unknown rank: `'keep'`, except that the
 *   tensor is the answer when its elements (a cell or a tensor) are a
 *   subtype of the list's elements, and `list<never>` (the empty list, a
 *   rank-1 tensor of length 0) when the elements of the list can be
 *   neither a cell nor a tensor.
 *
 * (Section 3.4 of `docs/plans/2026-10-21-list-element-tensor-cell.md`.)
 */
export function meetListTypes(
  a: Readonly<ListType>,
  b: Readonly<ListType>,
  meet: (x: Type, y: Type) => Type
): Type | 'keep' {
  const da = a.dimensions;
  const db = b.dimensions;
  if (da === undefined && db === undefined)
    return { kind: 'list', elements: meet(a.elements, b.elements) };
  if (da === undefined || db === undefined) {
    const plain = da === undefined ? a : b;
    const tensor = plain === a ? b : a;
    const dims = tensor.dimensions;
    if (dims === null) {
      const rows = listElementType(tensor);
      if (isSubtype(rows, plain.elements)) return tensor;
      if (
        provablyDisjoint(plain.elements, tensor.elements) &&
        provablyDisjoint(plain.elements, tensor)
      )
        return { kind: 'list', elements: 'never' };
      return 'keep';
    }
    if (dims!.length <= 1) {
      const cells = meet(plain.elements, tensor.elements);
      if (isEmptyType(cells) && dims!.length === 1 && dims![0] > 0)
        return 'never';
      return { ...tensor, elements: cells };
    }
    const rows = listElementType(tensor);
    if (isSubtype(rows, plain.elements)) return tensor;
    if (isEmptyType(meet(rows, plain.elements))) return 'never';
    return 'keep';
  }
  if (da === null || db === null) {
    const cells = meet(a.elements, b.elements);
    const shaped = da === null ? b : a;
    if (isEmptyType(cells) && shaped.dimensions?.every((d) => d > 0))
      return 'never';
    return { ...shaped, elements: cells };
  }
  // Two tensors with dimension lists.
  if (listShapeKey(a) === listShapeKey(b)) {
    const cells = meet(a.elements, b.elements);
    if (isEmptyType(cells) && da.every((d) => d > 0)) return 'never';
    return { ...a, elements: cells };
  }
  if (a.dimensionVariables !== undefined || b.dimensionVariables !== undefined)
    return 'keep';
  if (da.length !== db.length) return 'never';
  const dimensions: number[] = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] === -1) dimensions.push(db[i]);
    else if (db[i] === -1 || da[i] === db[i]) dimensions.push(da[i]);
    else return 'never';
  }
  const cells = meet(a.elements, b.elements);
  if (isEmptyType(cells) && dimensions.every((d) => d > 0)) return 'never';
  return { kind: 'list', elements: cells, dimensions };
}

/**
 * The shape of a list type as a comparison key: `''` for a plain list,
 * `'tensor'` for a tensor of unknown rank, and otherwise its lengths, with a
 * dimension variable's name standing in for the `-1` it rides on, so two
 * patterns that differ only in which variable names an axis are not read
 * as the same shape. A plain list and a tensor of unknown rank are
 * different types, so their keys differ.
 */
export function listShapeKey(t: Readonly<ListType>): string {
  if (t.dimensions === undefined) return '';
  if (t.dimensions === null) return 'tensor';
  return t.dimensions
    .map((d, i) => t.dimensionVariables?.[i] ?? String(d))
    .join();
}

/**
 * Whether a dimensioned list type of rank 2 or more — a matrix or a tensor
 * whose element type is inhabited — is a subtype of both `a` and `b`, where
 * at least one of the two is a list type.
 *
 * The subtype rule for lists (the encoding bridge of the `list` case of
 * `isSubtype`) reads a rank-n list `list<E^(d₁x…xdₙ)>` in two ways: by its
 * scalar element `E` (a list type with no dimensions admits any shape, and
 * one with m dimensions admits rank m), and as a list of its rank-(n−k)
 * sub-lists, peeling the k outer axes. Two list types that each read such a
 * value in a different way overlap at it, and the element-wise probe of
 * `couldMatch` does not see that.
 *
 * The candidate values are built from the two types and each is tested with
 * `isSubtype`, so this answers as the subtype rule does:
 * - the element: each non-list leaf type of `a` and of `b` (the element type
 *   below every list level, each arm of a union), and the meet of each pair
 *   of leaves, when it is not empty;
 * - the rank: 2 up to the number of list levels of the deeper side;
 * - each axis: any length (`-1`), or a length that either side fixes on that
 *   axis (a list type with fixed lengths admits only those lengths).
 */
function sharesDimensionedListSubtype(a: Type, b: Type): boolean {
  // Tested inline, before any helper function is built: this runs at the
  // end of every `couldMatch` question that the earlier probes leave open.
  if (
    !(typeof a === 'object' && a.kind === 'list') &&
    !(typeof b === 'object' && b.kind === 'list')
  )
    return false;
  // The witness is a list, so both sides must be able to hold one
  // (`boolean` cannot, whatever the other side is). A primitive side is
  // tested first, in constant time, since a union distributes its leaves
  // here one by one.
  if (
    (typeof a === 'string' &&
      !isPrimitiveSubtype('list', a as PrimitiveType)) ||
    (typeof b === 'string' && !isPrimitiveSubtype('list', b as PrimitiveType))
  )
    return false;
  if (
    provablyDisjoint(a, LIST_OF_ANY_TYPE) ||
    provablyDisjoint(b, LIST_OF_ANY_TYPE)
  )
    return false;

  // Expand bare collection names so their unconstrained contents and axes
  // participate in the same overlap calculation as explicit contracts.
  const expand = (t: Type): Type =>
    typeof t === 'string' && t in BARE_COLLECTION_EXPANSIONS
      ? BARE_COLLECTION_EXPANSIONS[t]!
      : t;
  const isLevel = (t: Type): t is ListType | CollectionType =>
    typeof t === 'object' &&
    (t.kind === 'list' ||
      t.kind === 'collection' ||
      t.kind === 'indexed_collection');

  // One budget bounds the whole search: the size of the two types, the
  // meets of the leaf pairs, the comparisons that remove a repeated
  // element, and the candidate lists. When it runs out, the search stops
  // with no witness, which is the answer `couldMatch` gave before this
  // search. The size counts a node shared between union arms each time it
  // is reached (`typeTreeSize`): `Uₙ = Uₙ₋₁ | Uₙ₋₁` is small in memory but
  // has exponentially many paths, and the walks below and the subtype tests
  // of the candidates follow every path. Two unions of many crossing ranges
  // would otherwise give a number of meets, and of comparisons between
  // them, that grows with a high power of their size.
  let budget = MAX_WITNESS_CANDIDATES;
  budget -= typeTreeSize(a, budget);
  if (budget < 0) return false;
  budget -= typeTreeSize(b, budget);
  if (budget < 0) return false;

  // The leaf types of `t`: the types below every list or abstract collection
  // level, with each union arm taken on its own. The size test above bounds
  // this walk.
  const leaves = (t0: Type, depth: number, out: Type[]): Type[] => {
    const t = expand(t0);
    if (depth > MAX_WITNESS_RANK + 2) return out;
    if (isLevel(t)) return leaves(t.elements, depth + 1, out);
    if (typeof t === 'object' && t.kind === 'union') {
      for (const arm of t.types) leaves(arm, depth, out);
      return out;
    }
    out.push(t);
    return out;
  };
  // Each path of axes along the list levels of `t`, outermost first: the
  // length of each axis (`-1` when it has no fixed length). A union gives
  // one path per arm. The size test above bounds this walk.
  const axisPaths = (t0: Type, prefix: number[], out: number[][]): void => {
    const t = expand(t0);
    if (prefix.length <= MAX_WITNESS_RANK) {
      if (isLevel(t)) {
        const own = t.kind === 'list' ? (t.dimensions ?? [-1]) : [-1];
        axisPaths(t.elements, [...prefix, ...own], out);
        return;
      }
      if (typeof t === 'object' && t.kind === 'union') {
        for (const arm of t.types) axisPaths(arm, prefix, out);
        return;
      }
    }
    out.push(prefix);
  };

  const leavesA = leaves(a, 0, []);
  const leavesB = leaves(b, 0, []);
  const pairs = leavesA.length * leavesB.length;
  if (pairs + leavesA.length + leavesB.length > budget) return false;
  budget -= pairs;
  // The cell of a witness must be shown to hold a value: a matrix of an
  // empty cell type holds only empty matrices, which `couldMatch` does not
  // count as a shared value.
  const elements: Type[] = [];
  const addElement = (t: Type): boolean => {
    if (inhabitation(t) !== 'inhabited') return true;
    budget -= elements.length + 1;
    if (budget < 0) return false;
    if (elements.some((e) => isSubtype(e, t) && isSubtype(t, e))) return true;
    elements.push(t);
    return true;
  };
  for (const x of leavesA)
    for (const y of leavesB) if (!addElement(narrow(x, y))) return false;
  for (const x of [...leavesA, ...leavesB]) if (!addElement(x)) return false;
  if (elements.length === 0) return false;

  const paths: number[][] = [];
  axisPaths(a, [], paths);
  axisPaths(b, [], paths);
  const maxRank = Math.min(
    MAX_WITNESS_RANK,
    Math.max(...paths.map((p) => p.length))
  );
  for (let rank = 2; rank <= maxRank; rank++) {
    // The candidate lengths of each axis.
    const choices: number[][] = [];
    for (let i = 0; i < rank; i++) {
      const lengths = [-1];
      for (const path of paths) {
        const d = path[i];
        // A length of 0 is left out: an axis of length 0 holds only empty
        // lists, which are not a shared value.
        if (d !== undefined && d > 0 && !lengths.includes(d)) lengths.push(d);
      }
      choices.push(lengths);
    }
    // Every combination of the candidate lengths, one per axis. Past the
    // budget the search stops with no witness, which is the answer
    // `couldMatch` gave before this search: a union of many fixed shapes
    // would otherwise give a product of thousands of candidates.
    const count =
      choices.reduce((n, lengths) => n * lengths.length, 1) * elements.length;
    if (count > budget) return false;
    budget -= count;
    let shapes: number[][] = [[]];
    for (const lengths of choices)
      shapes = shapes.flatMap((s) => lengths.map((d) => [...s, d]));
    for (const dimensions of shapes)
      for (const e of elements) {
        const witness: Type = { kind: 'list', elements: e, dimensions };
        if (isSubtype(witness, a) && isSubtype(witness, b)) return true;
      }
  }
  return false;
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
 * Whether a function whose parameter is typed `accepting` accepts an
 * argument of type `supplied`: the contravariant step of the signature
 * subtype rule, `supplied <: accepting`, with one reading for an
 * unresolved parameter.
 *
 * A parameter typed `unknown` is a lambda parameter that is not inferred
 * yet (`x ↦ x^2` is `(unknown) -> number`). Under the subtype relation every
 * type is a subtype of `unknown` (user decision D1, 2026-10-21), so the
 * plain step would read such a function as satisfying `(any) -> number`,
 * and a declared signature would then be callable under a contract that
 * nothing proved (the types guide: a declared function signature keeps
 * refusing an `unknown` value). The parameter is therefore read as what the
 * body will be refined to accept, a value of some kind: the function
 * accepts a value, a function or a symbol, and does not promise to accept
 * absence, an error or `any`. This is the reading the relation gave before
 * D1, when `unknown` excluded exactly those. A supplied `unknown` (the
 * other signature's own unresolved parameter) is accepted, which keeps the
 * rule reflexive: `(unknown*) -> unknown` is a subtype of itself, as every
 * library definition's self-check requires.
 *
 * The reading applies to an `unknown` ARM too, spelled directly or through
 * a transparent alias: a parameter `unknown | missing` (a read from an
 * unresolved element that can miss) accepts a marker only when one of its
 * other arms states it, so `(unknown | missing) -> number` does not satisfy
 * `(any) -> number` either.
 */
function acceptsParameter(accepting: Type, supplied: Type): boolean {
  const unfold = (t: Type): Type =>
    isTransparentAliasReference(t) ? (aliasDefinitionAt(t) ?? t) : t;
  const resolved = unfold(accepting);
  const arms = (
    typeof resolved === 'object' && resolved.kind === 'union'
      ? resolved.types
      : [resolved]
  ).map(unfold);
  if (!arms.some((a) => a === 'unknown')) return isSubtype(supplied, accepting);
  if (supplied === 'unknown') return true;
  if (supplied === 'any') return false;
  const others = arms.filter((a) => a !== 'unknown');
  const markerStated = (m: 'nothing' | 'missing' | 'error'): boolean =>
    !provablyAdmits(m, supplied) || others.some((o) => isSubtype(m, o));
  return markerStated('nothing') && markerStated('missing') && markerStated('error');
}

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

/**
 * The number of `isSubtype` queries answered since the module loaded — a
 * measurement counter for the load-immune cost pins in
 * `test/compute-engine/composite-type-synthesis.test.ts`, which count the
 * type-structure walks typing a list of tuples costs per element (a timing
 * bound would depend on the load of the machine, a count does not). The
 * pins read it through the module export because an ES-module export cannot
 * be spied on. Incremented only under `COUNT_STATS` (the test runner, or
 * `CE_CACHE_STATS`), never reset.
 */
export const subtypeStats = { queries: 0 };

/**
 * Whether the type `t` STATES that it admits a value of the marker type
 * `marker` (`nothing`, `missing` or `error`): some arm of `t` other than the
 * inference marker `unknown` is a supertype of `marker`.
 *
 * `isSubtype(marker, t)` answers a different question, "could a value of
 * type `t` be a `marker`?", and since `unknown` is a type still to be
 * inferred that every type is a subtype of (user decision D1, 2026-10-21,
 * `docs/plans/2026-10-21-unknown-inference-marker.md`), that answer is
 * `true` through an `unknown` arm. A site that reads the answer as EVIDENCE
 * (a `Tuple` slot that may hold `Nothing`, a callback that may return
 * `Nothing`, a compiler refusal of an omission-capable source) must not
 * take an unresolved type for a proof: an unresolved type proves nothing
 * either way. Such a site asks this function. `any` is evidence: a contract
 * that admits everything admits the marker. A transparent alias is read
 * through its definition; a recursive alias (`cyc = cyc | list<integer>`)
 * is opened once on each descent, and its second occurrence is no evidence
 * (`seen` holds the declarations opened so far, as `resolveTypeAlias` in
 * `utils.ts` does), so the walk ends.
 */
export function provablyAdmits(
  marker: 'nothing' | 'missing' | 'error',
  t: Type | TypeString,
  seen?: ReadonlySet<unknown>
): boolean {
  if (typeof t === 'string') {
    if (t === 'unknown') return false;
    if (!PRIMITIVE_TYPES_SET.has(t as PrimitiveType)) t = parseType(t);
  }
  if (typeof t === 'object') {
    if (t.kind === 'union')
      return t.types.some((arm) => provablyAdmits(marker, arm, seen));
    // A `broadcastable<T>` is the union of `T` and a collection of `T`, and
    // is read arm by arm as a union is: `broadcastable<unknown>` states
    // nothing about the markers, as `unknown` does not.
    if (t.kind === 'broadcastable')
      return (
        provablyAdmits(marker, t.elements, seen) ||
        isSubtype(marker, broadcastCollectionArm(t.elements))
      );
    if (isTransparentAliasReference(t)) {
      const decl: unknown = declarationOf(t) ?? t;
      if (seen?.has(decl)) return false;
      const def = aliasDefinitionAt(t);
      if (def !== undefined && def !== t)
        return provablyAdmits(marker, def, new Set(seen).add(decl));
    }
  }
  return isSubtype(marker, t);
}

/** Return true if lhs is a subtype of rhs */
export function isSubtype(
  lhs: Type | TypeString,
  rhs: Type | TypeString
): boolean {
  if (COUNT_STATS) subtypeStats.queries++;
  if (typeof lhs === 'string' && !PRIMITIVE_TYPES_SET.has(lhs as PrimitiveType))
    lhs = parseType(lhs);
  if (typeof rhs === 'string' && !PRIMITIVE_TYPES_SET.has(rhs as PrimitiveType))
    rhs = parseType(rhs);

  // Two fast paths for the most frequent query shapes. Both give the answer
  // the general rules below give; they only reach it first.
  //
  // Primitive against primitive: a string here is a primitive name (any
  // other string was parsed above), and `isPrimitiveSubtype` applies the
  // unit-type rules (`any`, `never`, `error`, `nothing`, `missing`,
  // `unknown`) in the same order as the general path.
  if (typeof lhs === 'string' && typeof rhs === 'string')
    return isPrimitiveSubtype(lhs as PrimitiveType, rhs as PrimitiveType);
  // A numeric or boolean scalar against a structural composite (a list, a
  // tuple, a signature, …): never a subtype. The composite kinds that admit
  // a scalar — a union arm, a negation, a reference to an alias, a
  // `broadcastable<T>` (a scalar IS a `T`), an `expression` — are not in
  // the set. A `string` is not a scalar here: in the lattice it is a
  // collection of its characters.
  if (typeof rhs !== 'string' && SCALAR_DISJOINT_KINDS.has(rhs.kind)) {
    if (
      typeof lhs === 'string'
        ? lhs === 'boolean' ||
          NUMERIC_TYPES_SET.has(lhs as NumericPrimitiveType)
        : lhs.kind === 'numeric' ||
          (lhs.kind === 'value' && typeof lhs.value !== 'string')
    )
      return false;
  }

  if (
    subtypePairs === undefined &&
    !isTransparentAliasReference(lhs) &&
    !isTransparentAliasReference(rhs)
  )
    return isSubtypeRules(lhs, rhs);
  const owned = openSubtypePairs();
  const pairs = subtypePairs!;
  try {
    const key = `${cyclePairKey(lhs)}<:${cyclePairKey(rhs)}`;
    const known = pairs.answers.get(key);
    if (known !== undefined) return known;
    // The same question asked again while it is open, by a route that is
    // not a cycle guard: answered by the rules, and not kept.
    const openAt = pairs.active.get(key);
    if (openAt !== undefined) {
      noteSubtypeAssumption(openAt);
      return isSubtypeRules(lhs, rhs);
    }
    const index = pairs.active.size;
    const outerLow = subtypeLow;
    subtypeLow = Infinity;
    pairs.active.set(key, index);
    try {
      const answer = isSubtypeRules(lhs, rhs);
      if (subtypeLow >= index) pairs.answers.set(key, answer);
      return answer;
    } finally {
      pairs.active.delete(key);
      // A guard that used a question below this one is still open for the
      // caller.
      subtypeLow = Math.min(
        outerLow,
        subtypeLow < index ? subtypeLow : Infinity
      );
    }
  } finally {
    closeSubtypePairs(owned);
  }
}

/** Create `subtypePairs` when no question holds it, and return whether
 * this call created it (pass the result to {@link closeSubtypePairs}). */
function openSubtypePairs(): boolean {
  if (subtypePairs !== undefined) return false;
  enterCycleKeys();
  subtypePairs = { answers: new Map(), active: new Map() };
  subtypeLow = Infinity;
  return true;
}

/** Drop `subtypePairs` when `owned`, the result of
 * {@link openSubtypePairs}, says this question created it. */
function closeSubtypePairs(owned: boolean): void {
  if (!owned) return;
  subtypePairs = undefined;
  subtypeLow = Infinity;
  leaveCycleKeys();
}

/** The rules of {@link isSubtype}, after its fast paths. */
function isSubtypeRules(
  lhs: Type | TypeString,
  rhs: Type | TypeString
): boolean {
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
    // `any` is the top type, so no unfold is needed.
    rhs !== 'any' &&
    !(
      typeof rhs !== 'string' &&
      rhs.kind === 'reference' &&
      rhs.name === lhs.name
    )
  ) {
    // Coinductive cycle rule, keyed on the PAIR (alias, rhs). A recursive
    // alias reaches itself again through its body: `R = list<R>` asks
    // `R <: unknown` while answering `R <: list<unknown>`, and mutually
    // recursive aliases (`a = list<b>`, `b = list<a>`) alternate lhs and rhs
    // unfolds. When the SAME pair is met again further down, the question
    // is already being answered, and it is assumed to hold: a relation that
    // fails fails at some finite depth, in a branch that does not cycle. A
    // pair with a different rhs is a new question and unfolds the alias
    // again (`R <: unknown` is decided by the body `list<R>`). The rhs is
    // compared by structure, because the rules build fresh rhs objects, with
    // each reference in it identified by its declaration (`cyclePairKey`). With
    // `A = B` and `B = list<A> | missing`, `A <: list<unknown> | missing`
    // then reaches `A <: unknown`, a new pair, which the `missing` arm of `B`
    // refutes. An alias whose definition names itself as a bare union arm
    // (`cyc = cyc | tuple<number, number>`) is a subtype of what its other
    // arms are subtypes of (user decision 2026-10-19), which this rule
    // gives too.
    //
    // The rhs types met are parts of the original rhs and of the alias
    // definitions, so the set of pairs is finite. The bound below is a
    // safety net only: past it the answer is the conservative `false`.
    // The pairs are keyed with the interning table of `cyclePairKey`, held
    // while this frame runs (`enterCycleKeys`).
    enterCycleKeys();
    try {
      const rhsKey = cyclePairKey(rhs);
      const activeKeys = lhsUnfoldKeys?.get(lhs);
      if (activeKeys?.has(rhsKey)) {
        // The question repeated is `lhs <: rhs` itself, open further up.
        noteSubtypeAssumption(
          subtypePairs?.active.get(`${cyclePairKey(lhs)}<:${rhsKey}`) ?? -1
        );
        return true;
      }
      const generic = isGenericApplication(lhs);
      if (
        (activeKeys !== undefined && activeKeys.size >= MAX_LHS_UNFOLD_PAIRS) ||
        (generic && openAliasUnfolds >= MAX_OPEN_ALIAS_UNFOLDS)
      ) {
        noteSubtypeAssumption();
        return false;
      }
      // The record is also entered in the record-keyed set that
      // `provablyDisjoint` reads, when it is not there yet.
      const entered = beginUnfold(lhs, false);
      const keys = activeKeys ?? new Set<string>();
      keys.add(rhsKey);
      lhsUnfoldKeys ??= new Map();
      lhsUnfoldKeys.set(lhs, keys);
      lhsUnfoldTargets ??= new Map();
      let targets = lhsUnfoldTargets.get(lhs);
      if (targets === undefined) {
        targets = new Set();
        lhsUnfoldTargets.set(lhs, targets);
      }
      const addedTarget = !targets.has(rhs);
      if (addedTarget) targets.add(rhs);
      if (generic) openAliasUnfolds += 1;
      try {
        const def = aliasDefinitionAt(lhs);
        return def === undefined ? false : isSubtype(def, rhs);
      } finally {
        if (generic) openAliasUnfolds -= 1;
        if (addedTarget) targets.delete(rhs);
        if (targets.size === 0) lhsUnfoldTargets!.delete(lhs);
        if (lhsUnfoldTargets!.size === 0) lhsUnfoldTargets = null;
        keys.delete(rhsKey);
        if (keys.size === 0) lhsUnfoldKeys!.delete(lhs);
        if (lhsUnfoldKeys!.size === 0) lhsUnfoldKeys = null;
        if (entered) endUnfold(lhs);
      }
    } finally {
      leaveCycleKeys();
    }
  }

  // Every type is a subtype of `any`, the top type
  if (rhs === 'any') return true;

  // Every type is a subtype of `unknown`, `any`, `error` and the absence
  // markers included: `unknown` is a type still to be inferred, and as a set
  // of values it restricts nothing (user decision D1, 2026-10-21,
  // `docs/plans/2026-10-21-unknown-inference-marker.md`; the same rule as
  // `isPrimitiveSubtype`). A union therefore fits too, whatever its arms.
  // Until that decision `any`, `error`, `nothing` and `missing` were
  // excluded, so that `list<integer | missing>` was not a `list<unknown>`
  // while it was a bare `list`: the explicit request to infer was the
  // narrowest of the three spellings. The rule comes before the unit-type
  // rules below so that `nothing <: unknown` and `missing <: unknown` hold.
  if (rhs === 'unknown') return true;

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

  // 'unknown' is only a subtype of `any` (handled above) and of itself; gate
  // on a primitive rhs so `unknown <: unknown | integer` falls through to the
  // union handler. An unresolved type never proves a contract: `unknown <:
  // integer` is false, and the engine admits an `unknown` operand by its own
  // gate (`validateArguments`), decided when the program runs.
  //
  // ⚠️ Do NOT make this true for every rhs. TRIED AND REVERTED (2026-08-15).
  // If `unknown <: T` and `T <: unknown` both held for every `T`,
  // antisymmetry is gone — `unknown` becomes lattice-EQUIVALENT to every
  // type, and union subsumption and `meet2`'s subtype-based tie-breaks stop
  // being order-independent. That is not a bug to fix in the callers; it is
  // the partial order ceasing to be one. The empirical witness, for scale:
  // `matches()` doubles as the engine's dispatch predicate, and within one
  // probe of the flip an element access typed `unknown` "matched" `matrix`,
  // so `P[1]^2` canonicalized as `MatrixPower`, broadcast decisions flipped,
  // and even undeclared-function definitions went inert. (`unknown` and `any`
  // being mutual subtypes is a different, harmless thing: they are the same
  // set of values, so the order merges two spellings of one point, as it
  // does for bare `list` and `list<any>`.) The placeholder semantics users
  // need lives at the DECLARATION boundary instead: `refineDeclaredPlaceholders`
  // (compute-engine/boxed-expression/effects-inference.ts) replaces declared
  // `unknown` slots with the definition's inferred slots, and
  // `refineConstructorPlaceholder` (boxed-value-definition.ts) does the same
  // for an element slot. Full record: the placeholder-signature entry in
  // ROADMAP.md (ruled 2026-08-15).
  if (lhs === 'unknown' && typeof rhs === 'string') return false;

  //
  // Handle other subtype of primitive types
  //
  if (typeof rhs === 'string') {
    // Primitive type subtype of another primitive type
    if (typeof lhs === 'string')
      return isPrimitiveSubtype(lhs as PrimitiveType, rhs as PrimitiveType);

    // `broadcastable<T> <: R` (R a primitive) iff `T <: R` and the
    // collection arm of the broadcastable (`broadcastCollectionArm`:
    // `tensor<T>` when no value of `T` is a list, `list<T>` otherwise) is a subtype of
    // `R`: the value may be a scalar or a collection, so it is a subtype of
    // `R` only when both branches are.
    if (lhs.kind === 'broadcastable') {
      return (
        isSubtype(lhs.elements, rhs) &&
        isSubtype(broadcastCollectionArm(lhs.elements), rhs)
      );
    }

    if (lhs.kind === 'value') {
      if (typeof lhs.value === 'boolean') return rhs === 'boolean';
      // The unsigned complex infinity `~oo` claims `infinity`: it has no
      // sign, so it is neither real nor complex. Tested before the numeric
      // branches because the sentinel is an object, not a number.
      if (isComplexInfinityValue(lhs.value))
        return isPrimitiveSubtype('infinity', rhs as PrimitiveType);
      // The `Indeterminate` literal claims `nan`, as the `NaN` literal does.
      if (isIndeterminateValue(lhs.value))
        return isPrimitiveSubtype('nan', rhs as PrimitiveType);
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
    if (lhs.kind === 'union')
      return lhs.types.every(
        (t) => isAssumedUnionArm(t, rhs) || isSubtype(t, rhs)
      );

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

    // Bare collection names constrain kind only; absence-bearing contents
    // are accepted exactly as for explicit <any> parameterizations.
    if (rhs === 'indexed_collection')
      return isSubtype(lhs, BARE_INDEXED_COLLECTION_STRUCTURAL_TYPE);
    if (rhs === 'collection')
      return isSubtype(lhs, BARE_COLLECTION_STRUCTURAL_TYPE);
    if (rhs === 'tuple') return lhs.kind === 'tuple';
    if (rhs === 'list') return lhs.kind === 'list';
    if (rhs === 'set') return lhs.kind === 'set';
    if (rhs === 'record') return lhs.kind === 'record';

    // Bare `object` means "any object", and it is the ONE common bound every
    // declared object type has. Relating each of them to it does not
    // contradict "no subtyping between object types": it relates them to a
    // single top, never to each other (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix
    // B, ruling B6).
    if (rhs === 'object') return isObjectType(lhs);

    // The bare dictionary family has unrestricted values.
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
    // A broadcastable lhs is the union of `T` and its collection arm
    // (`broadcastCollectionArm`), so it fits a union rhs iff BOTH branches
    // are covered — possibly by *different* members
    // (`broadcastable<number> <: number | tensor<number>`). The member-wise
    // probe below would require a single member to cover the whole
    // broadcastable and wrongly reject exactly that case.
    const broadcastableFitsUnion = (b: BroadcastableType) =>
      isSubtype(b.elements, rhs) &&
      isSubtype(broadcastCollectionArm(b.elements), rhs);
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
        if (isAssumedUnionArm(lhsType, rhs)) return true;
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
  // Handle broadcastable on the rhs: `broadcastable<T>` = a `T`, or its
  // collection arm (`broadcastCollectionArm`: a tensor of any rank whose
  // cells are `T` when no value of `T` is a list, a plain list of `T`
  // otherwise), to
  // which an element-wise operation applies (user decision D4 of
  // 2026-10-21, `docs/plans/2026-10-21-list-element-tensor-cell.md`). This
  // must precede the `typeof lhs === 'string'` fall-through below (a string
  // `lhs` such as `integer` would otherwise short-circuit to `false`).
  //
  if (rhs.kind === 'broadcastable') {
    // BOTH broadcastable: the elements and the collection arms must both
    // fit, since each side is the union of the two. The arms are compared
    // as well as the elements because the arm depends on whether the
    // element type can hold a list: `broadcastable<integer>` holds tensors
    // of every rank (its arm is `tensor<integer>`), while
    // `broadcastable<integer | list<integer>>` (arm
    // `list<integer | list<integer>>`, read by its elements) holds no
    // tensor of rank 3, so the first is not a subtype of the second
    // although `integer` is an `integer | list<integer>`.
    // Checked *before* the scalar branch so `broadcastable<integer> <:
    // broadcastable<number>` matches on the element types rather than
    // falling into the scalar branch.
    if (typeof lhs !== 'string' && lhs.kind === 'broadcastable')
      return (
        isSubtype(lhs.elements, rhs.elements) &&
        isSubtype(
          broadcastCollectionArm(lhs.elements),
          broadcastCollectionArm(rhs.elements)
        )
      );

    // A union is broadcastable iff each of its members is.
    if (typeof lhs !== 'string' && lhs.kind === 'union')
      return lhs.types.every(
        (t) => isAssumedUnionArm(t, rhs) || isSubtype(t, rhs)
      );

    // Scalar branch: `S <: T ⟹ S <: broadcastable<T>`.
    if (isSubtype(lhs, rhs.elements)) return true;

    // Collection branch: every subtype of the collection arm is in it. For
    // a `T` that cannot hold a list the arm is `tensor<T>`: by the rules
    // for lists, a tensor with a dimension list fits when its cells are `T`
    // (`matrix<integer>` is a `broadcastable<number>`, and
    // `list<boolean^(2x2)>` a `broadcastable<boolean>`), and a plain list
    // fits when its elements are `T`, the rank-1 reading (`list<integer>`
    // is a `broadcastable<number>`; `list<list<integer>>` is not, since a
    // list of integers is not a number). For a `T` that can hold a list
    // the arm is the plain `list<T>`, read by its elements. Tuples, strings and the
    // abstract `indexed_collection<T>` are not lists, so they fail here (a
    // runtime broadcast binds a point atomically), and sets are not
    // indexed.
    return isSubtype(lhs, broadcastCollectionArm(rhs.elements));
  }

  //
  // Handle broadcastable on the lhs (rhs is a non-broadcastable object):
  // `broadcastable<T> <: R ⟺ T <: R and the collection arm <: R`.
  //
  if (typeof lhs !== 'string' && lhs.kind === 'broadcastable') {
    return (
      isSubtype(lhs.elements, rhs) &&
      isSubtype(broadcastCollectionArm(lhs.elements), rhs)
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
      const generic = isGenericApplication(rhs);
      if (generic && openAliasUnfolds >= MAX_OPEN_ALIAS_UNFOLDS) {
        noteSubtypeAssumption();
        return false;
      }
      if (!beginUnfoldAgainst(rhs, lhs)) return false;
      // An assumption `A <: rhs` held for a live lhs unfold
      // (`lhsUnfoldTargets`) holds for the definition of `rhs` as well, since
      // the alias IS its definition. It is recorded for the definition while
      // it is read, so that the arm `cyc` of `type alias cyc = cyc |
      // tuple<number, number>` is still taken as a subtype of `pt` when `pt`
      // is an alias of `tuple<number, number>`.
      const extended: Set<unknown>[] = [];
      const def = aliasDefinitionAt(rhs);
      if (generic) openAliasUnfolds += 1;
      try {
        if (def === undefined) return false;
        for (const targets of lhsUnfoldTargets?.values() ?? [])
          if (targets.has(rhs) && !targets.has(def)) {
            targets.add(def);
            extended.push(targets);
          }
        return isSubtype(lhs, def);
      } finally {
        if (generic) openAliasUnfolds -= 1;
        for (const targets of extended) targets.delete(def);
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
  // a list of finite positive integers, so it must satisfy a PARAMETERIZED
  // collection rhs (`range <: list<integer>`,
  // `range <: indexed_collection<integer>`, `range <: collection<number>`)
  // that the primitive-vs-primitive table above cannot express. Expanding
  // here, just before the fall-through, keeps every other primitive on the
  // fast path. The element type is `integer` (see `RANGE_STRUCTURAL_TYPE`),
  // matching what a qualifying `Range` reported before this type existed, so
  // the narrowing perturbs no downstream element-type inference. The kind is
  // `list` since 2026-09-29: a `Range` value can be assigned to a symbol
  // declared `list<integer>`.
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

  // Expand a bare kind to its unrestricted structural contract. No rank is
  // supplied, so a dimensioned target still needs separate shape evidence.
  if (lhs === 'list') return isSubtype(BARE_LIST_STRUCTURAL_TYPE, rhs);
  if (lhs === 'set') return isSubtype(BARE_SET_STRUCTURAL_TYPE, rhs);
  if (lhs === 'dictionary')
    return isSubtype(BARE_DICTIONARY_STRUCTURAL_TYPE, rhs);
  if (lhs === 'collection')
    return isSubtype(BARE_COLLECTION_STRUCTURAL_TYPE, rhs);
  if (lhs === 'indexed_collection')
    return isSubtype(BARE_INDEXED_COLLECTION_STRUCTURAL_TYPE, rhs);
  if (lhs === 'record') return isSubtype(BARE_DICTIONARY_STRUCTURAL_TYPE, rhs);
  // No fixed-arity tuple spells the whole family. Its elements nevertheless
  // satisfy the unrestricted indexed-collection contract.
  if (lhs === 'tuple')
    return isSubtype(BARE_INDEXED_COLLECTION_STRUCTURAL_TYPE, rhs);

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
  if (lhs.kind === 'union')
    return lhs.types.every(
      (t) => isAssumedUnionArm(t, rhs) || isSubtype(t, rhs)
    );

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
      if (!acceptsParameter(lhsParam, rhsParam)) return false;
    }

    // A variadic rhs also supplies arguments PAST its named positions, all of
    // its tail type; the lhs's own tail is what receives them.
    if (rhs.variadicArg) {
      const lhsTail = lhs.variadicArg?.type;
      if (lhsTail === undefined) return false;
      if (!acceptsParameter(lhsTail, rhs.variadicArg.type)) return false;
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

    // A list is an indexed collection of its elements (`listElementType`):
    // a matrix of integers is an `indexed_collection<vector<integer>>`,
    // not an `indexed_collection<integer>`, and a `tensor<integer>` is an
    // `indexed_collection<integer | tensor<integer>>`.
    if (lhs.kind === 'list')
      return isSubtype(listElementType(lhs), rhs.elements);

    if (lhs.kind === 'tuple') {
      // A tuple is a subtype of a collection if all its elements are subtypes of the collection elements
      return lhs.elements.every((x) => isSubtype(x.type, rhs.elements));
    }
    return false;
  }

  if (rhs.kind === 'collection') {
    if (lhs.kind === 'collection' || lhs.kind === 'indexed_collection')
      return isSubtype(lhs.elements, rhs.elements);

    // A list is a collection of its elements (`listElementType`), as for
    // an indexed collection above.
    if (lhs.kind === 'list')
      return isSubtype(listElementType(lhs), rhs.elements);

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
    // A list type is one of three things (`ListType` in `types.ts`): a
    // plain list `list<E>` whose ELEMENTS are `E` (no dimensions); a tensor
    // with a dimension list (`vector<U>`, `matrix<U>`, `list<U^dims>`)
    // whose CELLS are `U` and whose elements are its rows; a tensor of
    // unknown rank `tensor<U>` (dimensions `null`) whose cells are `U`.
    // The rules (section 3.3 of
    // `docs/plans/2026-10-21-list-element-tensor-cell.md`):
    //
    // - Toward a plain list `list<E2>`: the elements of the lhs
    //   (`listElementType`: `E1` for a plain list, the cells of a rank-1
    //   tensor, the rows of a deeper one, `U | tensor<U>` for an unknown
    //   rank) must be `E2`. So `matrix<integer>` is a
    //   `list<vector<integer>>` and not a `list<integer>`, and
    //   `vector<integer>` is a `list<integer>`.
    //   A tensor of unknown rank is decided by `tensorFitsPlainList`, which
    //   answers a repeated question coinductively (see there).
    // - Toward a tensor of unknown rank `tensor<V>`: the cells of the lhs
    //   must be `V`. A plain list `list<E>` is read at rank 1, so it fits
    //   when its elements are `V` and no element is a list
    //   (`cannotHoldAList`): every list of numbers, of booleans or of
    //   tuples is a rank-1 tensor. A `list<value>` is not a `tensor<value>`:
    //   its elements can be matrices, and reading them as cells would make
    //   the relation intransitive (`matrix<integer> <: list<value>`, while
    //   `matrix<integer>` is not a `tensor<value>` of rank 1).
    // - Toward a tensor with a dimension list: a tensor of unknown rank
    //   never fits (its rank is not known); a plain list fits only a
    //   rank-1 tensor with an open length, `list<U^?>` (`vector<U>`), when
    //   its elements are numbers that are `U` (user decision D5: `list<U>`
    //   and `vector<U>` denote the same values for a numeric `U`). The
    //   elements must be numeric: a `list<value>` holds matrices, which a
    //   `vector<value>` (rank 1) does not, and without the restriction the
    //   relation was not transitive (`matrix<integer> <: list<value>`, and
    //   `list<value>` would be a `vector<value>`). A tensor with a
    //   dimension list fits when it has the same rank, its cells are `V`,
    //   and each axis of the rhs is open or equal to the axis of the lhs.
    //
    // The cells of a tensor are compared whatever they are, so an
    // internally built tensor of non-numeric cells is read soundly, and
    // the relation is covariant in the cells (`vector<value>` is a
    // `vector<any>`).
    const lhsDims = lhs.dimensions;
    const rhsDims = rhs.dimensions;

    if (rhsDims === undefined) {
      if (lhsDims === null) return tensorFitsPlainList(lhs, rhs);
      return isSubtype(listElementType(lhs), rhs.elements);
    }

    if (rhsDims === null) {
      if (lhsDims === undefined && !cannotHoldAList(lhs.elements)) return false;
      return isSubtype(lhs.elements, rhs.elements);
    }

    if (lhsDims === null) return false;

    if (lhsDims === undefined) {
      // The type of the empty list literal, `list<never>`, has no dimensions,
      // and its only value `[]` has length 0. So it is a subtype of a list
      // type whose first axis has length 0: `[]` is a value of
      // `list<integer^0>`, and of `list<integer^(0x2)>` (a matrix with no
      // rows). A one-axis list of any length (`list<integer^?>`, the `-1`
      // wildcard) admits the length 0 as well.
      if (
        lhs.elements === 'never' &&
        (rhsDims[0] === 0 || (rhsDims[0] === -1 && rhsDims.length === 1))
      )
        return true;
      if (rhsDims.length === 1 && rhsDims[0] === -1)
        return (
          isSubtype(lhs.elements, 'number') &&
          isSubtype(lhs.elements, rhs.elements)
        );
      return false;
    }

    if (lhsDims.length !== rhsDims.length) return false;
    if (!isSubtype(lhs.elements, rhs.elements)) return false;
    for (let i = 0; i < lhsDims.length; i++) {
      // A dimension of -1 means any size is allowed
      if (rhsDims[i] !== -1 && lhsDims[i] !== rhsDims[i]) return false;
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
    // `Indeterminate` has no value to order, as NaN below.
    if (isIndeterminateValue(lhs.value)) return false;
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
      (isComplexInfinityValue(rhs.value) &&
        isComplexInfinityValue(lhs.value)) ||
      (isIndeterminateValue(rhs.value) && isIndeterminateValue(lhs.value))
    );

  if (lhs.kind === 'value') {
    if (typeof lhs.value === 'boolean') return isSubtype('boolean', rhs);
    // `~oo` claims `infinity` — see the value-vs-primitive path above.
    if (isComplexInfinityValue(lhs.value)) return isSubtype('infinity', rhs);
    // `Indeterminate` claims `nan`, as the `NaN` literal does.
    if (isIndeterminateValue(lhs.value)) return isSubtype('nan', rhs);
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
    return (
      typeof type.value === 'number' ||
      isComplexInfinityValue(type.value) ||
      isIndeterminateValue(type.value)
    );
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
 * Whether `lhs` is a `T` (`T` is `elements`), or a list or an ABSTRACT
 * `indexed_collection` whose elements fit the same test. When `elements` is
 * itself a `broadcastable<U>`, the elements are tested with this function
 * again, one level down, so each level of a nested spelling also admits an
 * abstract indexed collection.
 *
 * This is the relation that `isSubtype(lhs, broadcastable<T>)` gave when
 * `broadcastable<T>` meant `T | indexed_collection<T>`. Now that it means
 * `T | tensor<T>`, a value typed only `indexed_collection<T>` is no longer in
 * it, because such a value can be a tuple. Some engine checks ask the older
 * question on purpose: "is this operand a number, or a collection of numbers
 * that broadcast reaches", where an operand whose type does not say whether
 * it is a list or a tuple must still pass. Those checks call this function.
 *
 * A list is read by its elements (`listElementType`: the cells of a rank-1
 * tensor, the rows of a deeper one, the elements of a plain list), as the
 * subtype relation reads it. There is no flat reading of a plain list of
 * lists: `list<list<number>>` does not fit `number`.
 *
 * A tuple and a string are refused here, as they were before: the type of
 * such an operand says that it is not a list.
 */
export function isSubtypeOfBroadcastOrIndexed(
  lhs: Type,
  elements: Type
): boolean {
  // The alias keys of the walk (`cycleTypeKey()`) must stay comparable
  // until it ends, so the walk holds the key table: an inner `isSubtype()`
  // that also uses the table does not drop it then.
  enterCycleKeys();
  try {
    return fitsBroadcastOrIndexed(lhs, elements, new Map());
  } finally {
    leaveCycleKeys();
  }
}

/**
 * `active` holds, for each alias being unfolded on the current descent, the
 * element types it is being tested against. An alias is keyed by
 * `cycleTypeKey()`, not by identity: the reference inside the definition of
 * a recursive alias can be another object for the same alias.
 */
function fitsBroadcastOrIndexed(
  lhs: Type,
  elements: Type,
  active: Map<string, Set<Type>>
): boolean {
  const fits = (t: Type): boolean =>
    typeof elements !== 'string' && elements.kind === 'broadcastable'
      ? fitsBroadcastOrIndexed(t, elements.elements, active)
      : isSubtype(t, elements);
  if (isSubtype(lhs, { kind: 'broadcastable', elements })) return true;
  if (lhs === 'indexed_collection') return fits('any');
  if (typeof lhs === 'string') return fits(lhs);
  switch (lhs.kind) {
    case 'reference': {
      // A structural alias is its definition. `aliasDefinitionAt()` gives
      // it with the type arguments of an applied generic alias substituted
      // (`Seq<integer>` with `type alias Seq<T> = indexed_collection<T>`).
      if (lhs.alias !== true) return fits(lhs);
      // The same alias against the same element type again, on the current
      // descent: the question is already being answered, so it is assumed
      // true (the coinductive rule that `isSubtype` applies to a recursive
      // alias). The other arms decide: `type alias C = C | list<number>`
      // fits `number` because its `list<number>` arm does. The entry is
      // removed when its descent returns, so the next arm of a union can
      // unfold the same alias (`list<Colors^2> | list<Colors^3>`).
      const key = cycleTypeKey(lhs);
      const targets = active.get(key);
      if (targets?.has(elements)) return true;
      const def = aliasDefinitionAt(lhs);
      if (def === undefined) return fits(lhs);
      const set = targets ?? new Set<Type>();
      set.add(elements);
      active.set(key, set);
      try {
        return fitsBroadcastOrIndexed(def, elements, active);
      } finally {
        set.delete(elements);
        if (set.size === 0) active.delete(key);
      }
    }
    case 'union':
      return lhs.types.every((t) =>
        fitsBroadcastOrIndexed(t, elements, active)
      );
    case 'broadcastable':
    case 'indexed_collection':
      return fits(lhs.elements);
    case 'list':
      return fits(listElementType(lhs));
    default:
      return fits(lhs);
  }
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

/** Coerce a numeric primitive string or numeric range object to a
 *  `NumericType`; return `null` for any non-numeric type. */
export function asNumericRange(t: Readonly<Type>): NumericType | null {
  if (typeof t === 'object') return t.kind === 'numeric' ? t : null;
  if (NUMERIC_TYPES_SET.has(t as NumericPrimitiveType))
    return { kind: 'numeric', type: t as NumericPrimitiveType };
  return null;
}

/** The meet (intersection) of two bounded numeric types, as the list of its
 *  ranges: the intersection of their base kinds over the intersection of
 *  their intervals, one range per base kind. An empty interval or disjoint
 *  base kinds give no range (the meet is `never`, the EMPTY type, never
 *  `nothing`, which is the unit type of the symbol `Nothing`). Used by
 *  `narrow` here and by the intersection reducer (`reduce.ts`), which reduces
 *  a list of several ranges to a union. */
export function meetNumericRangeMembers(
  a: NumericType,
  b: NumericType
): Type[] {
  const bases = meetPrimitiveTypes(a.type, b.type);
  if (bases.length === 0) return [];

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
  if (lower > upper) return [];
  if (lower === upper && (lowerOpen || upperOpen)) return [];

  const finite = lower !== -Infinity || upper !== Infinity;
  const ranges: Type[] = [];
  for (const base of bases) {
    // No value of `infinity` (±∞ and the unsigned `~oo`) or `nan` is
    // finite, so neither can inhabit a finite interval. Without this, the
    // meet builds a range such as `infinity<0..10>` that has no members but
    // presents itself as a bounded real.
    if (finite && (base === 'infinity' || base === 'nan')) continue;
    // `bases` are the meet of two numeric primitives, hence numeric.
    const range = makeNumericRangeType(
      base as NumericPrimitiveType,
      lower,
      upper,
      lowerOpen,
      upperOpen
    );
    if (range !== 'never') ranges.push(range);
  }
  return ranges;
}

/** Given two types a and b, return the narrowest type common to a and b */
function narrow2(a: Readonly<Type>, b: Readonly<Type>): Readonly<Type> {
  if (a === b) return a;

  if (a === 'any') return b;
  if (b === 'any') return a;

  // A meet with `unknown` (a type still to be inferred) resolves it: the
  // constraint is the answer, so `narrow('unknown', 'integer')` is `integer`
  // and `narrow('unknown', 'missing')` is `missing`. Stated as a
  // short-circuit rather than left to the subtype tests below so that the
  // answer does not depend on the operand order: `unknown` and `any` are
  // mutual subtypes (user decision D1, 2026-10-21), and the first subtype
  // test would otherwise return whichever came first.
  if (a === 'unknown') return b;
  if (b === 'unknown') return a;

  // `nothing` and `never` deliberately have NO short-circuit here; the
  // subtype tests below give each the right answer, and the short-circuits
  // they used to have gave the wrong one.
  //
  // `nothing` is the UNIT type (its one member is the symbol `Nothing`), not
  // the bottom, so it does not absorb the other side: `narrow('nothing',
  // 'integer')` shares no value and is `never`, which is what the disjoint
  // fallback returns. `never` IS the bottom, so it absorbs rather than yields
  // — `isSubtype('never', b)` holds for every `b`, so the first test below
  // returns it.
  //
  // Placeholder semantics for a declared `unknown` slot deliberately do NOT
  // live in this relation — they are applied by `refineDeclaredPlaceholders`
  // (`boxed-expression/effects-inference.ts`), because `meet2` and
  // `reduceUnionType` call `isSubtype` directly and would otherwise become
  // operand-order-dependent.
  if (isSubtype(a, b)) return a;
  if (isSubtype(b, a)) return b;

  // Two list types meet by the rules of `meetListTypes` (two plain lists
  // elementwise, two tensors cellwise with their axes met, a plain list
  // and a rank-1 tensor as that tensor), with this function as the meet of
  // the elements, so the answer agrees with the intersection reducer
  // (`reduce.ts`) for these pairs. A pair the rules keep as an
  // intersection has no spelling here and answers `never`, as every other
  // incomparable composite pair does (a known divergence from the reducer,
  // recorded in `ROADMAP.md`).
  if (
    typeof a === 'object' &&
    typeof b === 'object' &&
    a.kind === 'list' &&
    b.kind === 'list'
  ) {
    const m = meetListTypes(a, b, (x, y) => narrow2(x, y) as Type);
    return m === 'keep' ? 'never' : m;
  }

  // A union meets arm by arm: `(A | B) ∧ C` is `(A ∧ C) | (B ∧ C)`, with the
  // empty arms dropped. Without this a union was tested only as a whole, so
  // `narrow('missing | vector<real^4>', 'indexed_collection | dictionary')`
  // was `never` although the vector arm fits: a block local typed from an
  // element read (`let e = circles[j]`, whose type admits absence) was then
  // narrowed to `never` by its first indexed use, and the comparison built on
  // it became a type error. The same rule is the one `meet2`
  // (`common/type/reduce.ts`) applies for the intersection reducer.
  const armsOf = (t: Readonly<Type>): ReadonlyArray<Readonly<Type>> | null =>
    typeof t === 'object' && t.kind === 'union' ? t.types : null;
  const armsA = armsOf(a);
  const armsB = armsOf(b);
  if (armsA !== null || armsB !== null) {
    const left = armsA ?? [a];
    const right = armsB ?? [b];
    const kept: Type[] = [];
    for (const x of left)
      for (const y of right) {
        const m = narrow2(x, y);
        if (m !== 'never') kept.push(m as Type);
      }
    if (kept.length === 0) return 'never';
    if (kept.length === 1) return kept[0];
    return kept.reduce((u, t) => unionTypes(u, t));
  }

  // Two numeric types, at least one of them a bounded range, that are not
  // subtype-related can still share values: `integer<-5..5>` and
  // `integer<1..>` share `integer<1..5>`. Their meet is the intersection of
  // the intervals, as the intersection reducer computes it.
  if (
    (typeof a === 'object' && a.kind === 'numeric') ||
    (typeof b === 'object' && b.kind === 'numeric')
  ) {
    const an = asNumericRange(a);
    const bn = asNumericRange(b);
    if (an !== null && bn !== null) {
      const ranges = meetNumericRangeMembers(an, bn);
      if (ranges.length === 0) return 'never';
      return ranges.reduce((u, t) => unionTypes(u, t));
    }
  }

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

  // `nothing` is absorbed rather than joined: `widen('nothing', 'integer')` is
  // `integer`, not `integer | nothing`. As pure lattice algebra that is wrong
  // — the join must be a supertype of both sides, and `integer` is not a
  // supertype of `nothing` — so this looks like the same unit-vs-empty
  // confusion `narrow2` above had, and it is not. It is deliberate and ruled;
  // see `ROADMAP.md`, "An empty meet was spelled `nothing`, the UNIT type".
  //
  // The reason is that absence is OPT-IN in this type system: a type admits
  // `nothing` or `missing` only by saying so (`integer | nothing`). Joining
  // them in would contradict that at every inference site that widens a
  // series of observed types — most visibly element-type inference, where
  // `[1, Nothing, 3]` is meant to infer `list<integer>` rather than
  // `list<integer | nothing>`.
  //
  // Do not "fix" this to match `narrow2`. The two are asymmetric on purpose.
  if (a === 'nothing') return b;
  if (b === 'nothing') return a;

  // `unknown` is NEUTRAL in this join, like `never`: `widen('unknown',
  // 'integer')` is `integer`. The engine's inference joins read `unknown` as
  // "no information yet" (the seed of a recursion fixpoint, the result of a
  // call whose callee is not derived yet, a lambda parameter before its
  // first use), and a join that kept it as an arm spread `| unknown`
  // through every derived signature (measured 2026-10-21: about 60 tests
  // in 20 suites). A join of types DERIVED FROM A VALUE, where an `unknown`
  // slot is a cell whose contents are not resolved, keeps the arm instead:
  // `joinUnresolvedArm()` below, used by `collectionElementType` for tuple
  // slots and by the `ListJoin` element join (user decision D4, 2026-10-21,
  // `docs/plans/2026-10-21-unknown-inference-marker.md`, narrowed to the
  // value-derived joins by that measurement).
  if (a === 'unknown') return b;
  if (b === 'unknown') return a;

  if (isSubtype(a, b)) return b;
  if (isSubtype(b, a)) return a;

  // The join of a tensor (a dimension list, or an unknown rank) and a plain
  // list is a plain list of the join of their elements: the rows of the
  // tensor (`listElementType`) beside the elements of the list.
  // `widen(matrix<integer>, list<string>)` is `list<vector<integer> |
  // string>`, a type that holds both. Two plain lists, and two tensors,
  // keep the union below (`list` is a lossy supertype).
  if (
    typeof a === 'object' &&
    typeof b === 'object' &&
    a.kind === 'list' &&
    b.kind === 'list' &&
    (a.dimensions === undefined) !== (b.dimensions === undefined)
  )
    return {
      kind: 'list',
      elements: widen2(listElementType(a), listElementType(b)) as Type,
    };

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
  return widenAll(types);
}

/**
 * The join of types DERIVED FROM A VALUE, where an `unknown` member is a
 * cell whose contents are not resolved rather than "no information yet":
 * `widenAll` of the members, with an `unknown` member kept as an arm of the
 * result (user decision D4, 2026-10-21,
 * `docs/plans/2026-10-21-unknown-inference-marker.md`). The ordinary
 * `widen` drops it, as the inference joins need (see `widen2`), so the
 * slots of `tu: tuple<unknown, missing>` joined to `missing` and `Filter(tu,
 * p)` was typed `list<missing>` for the value `[1]`; here they join to
 * `missing | unknown`. A top (`any`) absorbs the arm: a contract that
 * admits everything has nothing left to infer. The union is built without
 * reduction, as the other unions of this join are; the reducer absorbs a
 * value arm into `unknown` and keeps an absence arm beside it
 * (`reduceUnionType`, `reduce.ts`), so a reduced result is `unknown` or
 * `missing | unknown`. A union with an `error` arm reduces to `error` (the
 * reducer's standing rule), so an `error` member absorbs the arm too.
 *
 * With `besideMarkersOnly`, the arm is kept only when the other members
 * are all absence markers. The slots of a tuple literal are read that way:
 * a free symbol in a point, `(1, x)`, is an `unknown` slot, and the
 * engine's generic-symbol convention reads such a point as numeric
 * (`Third((1, x))` out of range is `NaN`, the numeric marker), which the
 * arm would turn into a non-numeric domain. Beside markers only, as in
 * `tuple<unknown, missing>`, the arm is kept, since `missing` alone would
 * claim that every cell is absent.
 */
export function joinUnresolvedArm(
  types: ReadonlyArray<Readonly<Type>>,
  besideMarkersOnly = false
): Readonly<Type> {
  const joined = widenAll(types);
  if (
    joined === 'unknown' ||
    joined === 'any' ||
    joined === 'error' ||
    !types.includes('unknown')
  )
    return joined;
  if (besideMarkersOnly) {
    const arms =
      typeof joined === 'object' && joined.kind === 'union'
        ? joined.types
        : [joined];
    if (!arms.every((t) => t === 'missing' || t === 'nothing')) return joined;
  }
  return unionTypes(joined, 'unknown');
}

/**
 * `widen` over a list of types. Use this form for a list whose length the
 * source does not bound — the operands of a flattened sum or product, the
 * elements of a literal collection: spreading such a list into `widen(...)`
 * passes every element as a call argument, and a few hundred thousand
 * arguments overflow the call stack (a DAG-shared value written out as a
 * tree reaches that size).
 */
export function widenAll(types: ReadonlyArray<Readonly<Type>>): Readonly<Type> {
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
 * The element type of a literal collection: `widenAll` of the element types,
 * except when every element type is on the extended real line, with or
 * without NaN, and one of them is infinite or NaN (`[1, ∞]`, `[1.5, NaN]`).
 * Then the join is the union of the widened finite tier, each signed
 * infinity present, and `nan` when present (`list<real | signed_infinity>`,
 * not `list<number>`). `widen` joins `integer` and `+oo`, or `real` and
 * `nan`, to their common supertype `number`, which a host reads as possibly
 * complex (user decision 2026-09-25).
 */
export function widenElementTypes(
  types: ReadonlyArray<Readonly<Type>>
): Readonly<Type> {
  const plusInf: Type = { kind: 'value', value: Infinity };
  const minusInf: Type = { kind: 'value', value: -Infinity };
  const members = types.flatMap((t) =>
    typeof t === 'object' && t.kind === 'union' ? t.types : [t as Type]
  );
  let hasPlus = false;
  let hasMinus = false;
  let hasNaN = false;
  const finite: Type[] = [];
  for (const m of members) {
    if (m === 'nan') hasNaN = true;
    else if (isSubtype(m, plusInf)) hasPlus = true;
    else if (isSubtype(m, minusInf)) hasMinus = true;
    else if (isSubtype(m, 'real')) finite.push(m);
    else return widenAll(types);
  }
  if (!hasPlus && !hasMinus && !hasNaN) return widenAll(types);
  const result: Type[] = [];
  if (finite.length > 0) result.push(widenAll(finite) as Type);
  if (hasPlus) result.push(plusInf);
  if (hasMinus) result.push(minusInf);
  if (hasNaN) result.push('nan');
  return result.length === 1 ? result[0] : { kind: 'union', types: result };
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
  if (a === 'nothing') return b;
  if (b === 'nothing') return a;
  if (a === 'unknown') return b;
  if (b === 'unknown') return a;

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
