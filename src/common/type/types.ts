/**
 * A primitive type is a simple type that represents a concrete value.
 *
 * - `any`: the top type
 *    - `expression`
 *    - `error`: an invalid value, such as `["Error", "missing"]`
 *    - `nothing`: the type of the `Nothing` symbol, the unit type
 *    - `missing`: the type of the `Missing` symbol, the unit type of an
 *       absent-but-positioned value (Julia `missing`, R `NA`)
 *    - `never`: the bottom type
 *    - `unknown`: a value whose type is not known
 *
 * - `expression`:
 *    - a symbolic expression, such as `["Add", "x", 1]`
 *    - `<value>`
 *    - `symbol`: a symbol, such as `x`.
 *    - `function`: a function literal
 *      such as `["Function", ["Add", "x", 1], "x"]`.
 *
 * - `value`
 *    - `scalar`
 *      - `<number>`
 *      - `boolean`: a boolean value: `True` or `False`.
 *      - `character`: exactly one user-perceived character (grapheme cluster).
 *    - `collection`
 *       - `set`: a collection of unique expressions, e.g. `set<string>`.
 *       - `record`: a collection of specific key-value pairs,
 *          e.g. `record{x: number, y: boolean}`.
 *       - `dictionary`: a collection of arbitrary key-value pairs
 *          e.g. `dictionary<string, number>`.
 *       - `indexed_collection`: collections whose elements can be accessed
 *             by a numeric index
 *          - `list`: a collection of expressions, possibly recursive,
 *              with optional dimensions, e.g. `[number]`, `[boolean^32]`,
 *              `[number^(2x3)]`. Used to represent a vector, a matrix or a
 *              tensor when the type of its elements is a number
 *           - `tuple`: a fixed-size collection of named or unnamed elements,
 *              e.g. `tuple<number, boolean>`, `tuple<x: number, y: boolean>`.
 *           - `string`: a string of characters, i.e. an indexed collection of
 *              `character`. A sibling of `list<character>`, not a subtype.
 *
 *
 *
 */
export type PrimitiveType =
  | NumericPrimitiveType
  | 'collection'
  | 'indexed_collection'
  | 'list'
  // An INDEX SPAN: a contiguous, ascending, step-1 run of 1-based collection
  // indices, i.e. a `Range` whose bounds are provably finite integers with
  // `1 <= lower <= upper`. Not a mathematical range (that is `Interval`) and
  // not the statistical range of a data set (that is `Min`/`Max`). It exists
  // so span-consuming operators such as `Slice(xs, r)` can reject a
  // descending or stepped range at the type level instead of at runtime; see
  // `docs/STRING_ROADMAP.md` ("The `range` type"). Structurally it behaves as
  // `indexed_collection<integer>` (`RANGE_STRUCTURAL_TYPE` in `primitive.ts`,
  // which every site that destructures a parameterized collection expands it
  // to); it has no EMPTY inhabitant, which is why operations that can empty a
  // range report `list` instead.
  | 'range'
  | 'set'
  | 'dictionary'
  | 'record'
  | 'object'
  | 'tuple'
  | 'value'
  | 'scalar'
  | 'function'
  | 'symbol'
  | 'boolean'
  // A string of characters. Structurally an INDEXED COLLECTION of `character`
  // (`STRING_STRUCTURAL_TYPE` in `primitive.ts`, which every site that
  // destructures a parameterized collection expands it to): a string is
  // iterable, 1-based indexable and countable, with grapheme clusters as its
  // elements. It is NOT a `scalar` (that branch of `value` now holds numbers,
  // booleans and `character`), and it is a SIBLING of `list<character>`, not
  // a subtype of it — grapheme segmentation is a property of the whole
  // string, so joining two strings can merge their boundary characters while
  // list concatenation never merges elements. Strings stay ATOMIC under
  // broadcast and `Flatten`. See `docs/STRING_ROADMAP.md`.
  | 'string'
  // Exactly one user-perceived character: one NFC-normalized grapheme cluster
  // (UAX #29). A `scalar`, and a DISJOINT sibling of `string` — not a subtype,
  // because a subtype of a collection type would be statically iterable while
  // the runtime says a character has no elements. See
  // `docs/STRING_ROADMAP.md` ("The `character` value model").
  | 'character'
  // A compiled regular expression. An OPAQUE value, like `color`: neither a
  // `scalar` (it has no numeric or boolean reading, and nothing broadcasts
  // over it component-wise) nor a `collection` (a pattern is not a sequence
  // of anything the engine can index). It is disjoint from `string` for the
  // same reason `character` is: a pattern is not text, and `IsMatch(s, p)`
  // wants the two apart in its signature so a plain string cannot be passed
  // where a pattern is meant. See `docs/STRING_ROADMAP.md` (Phase 3) and
  // `docs/STRING_ROADMAP.md` (D1).
  | 'regexp'
  | 'color'
  // A type value: a type expression reified as a first-class runtime value
  // (`TypeFrom("list<integer>")`). An OPAQUE value like `regexp` and `color`:
  // not a `scalar`, not a `collection`, no hidden element type. In TYPE-STRING
  // syntax the bare name `type` before an identifier is the forward-reference
  // marker (`<type_reference> ::= ("type")? <identifier>`), so the parser
  // disambiguates by one token of lookahead: `type` followed by an identifier
  // is a forward reference, bare `type` otherwise is this primitive. See
  // `docs/TYPE-SYSTEM.md` (ruling R7).
  | 'type'
  | 'expression'
  | 'unknown'
  | 'error'
  | 'nothing'
  | 'missing'
  | 'never'
  | 'any';

/**
 * The numeric tree is FINITE BY DEFAULT and DISJOINT: every numeric VALUE is a
 * finite number, a number of infinite magnitude, or the not-a-number marker,
 * and no value is two of those — `number = complex ⊔ infinity ⊔ nan` as a
 * partition of the values. Every bare name below `complex` contains only
 * finite values. A bare `real` result type is therefore a promise of
 * finiteness, and the extended real line is written out as
 * `real | non_finite_number` — `non_finite_number` being the SIGNED pair
 * `+∞`/`−∞`, so the union excludes the unsigned `~∞` that `infinity` would
 * bring in. That spelling is shared as the frozen `EXTENDED_REAL_TYPE`
 * constant in `common/type/primitive.ts`; use it rather than rebuilding the
 * union.
 *
 * The partition is a statement about values, NOT one the SUBTYPE RELATION
 * closes over. `isSubtype('complex | infinity | nan', 'number')` is true, but
 * the converse `isSubtype('number', 'complex | infinity | nan')` is FALSE: a
 * union is a supertype only of types below one of its members, and `number` is
 * above all three rather than inside any one of them. Deciding the converse
 * needs covering-union machinery that the type checker does not have. So do
 * not use a three-way union as a stand-in for `number` in a signature, and do
 * not read the `⊔` above as a subtyping identity.
 *
 * - `number`: any numeric value — a finite number, a number of infinite
 *   magnitude, or the not-a-number marker.
 * - `complex`: a FINITE complex number = `imaginary` + `real`.
 * - `imaginary`: a finite complex number with a real part of 0 (pure
 *   imaginary).
 * - `real`: a finite real number (imaginary part 0) = `rational` plus the
 *   finite irrationals.
 * - `rational`: a finite rational number (includes the integers).
 * - `integer`: a finite whole number.
 * - `infinity`: a number of infinite magnitude, of any direction — the signed
 *   `+∞` and `−∞`, the unsigned complex infinity `~∞`, and mixed directed
 *   values such as `∞ + i`. Disjoint from `complex`: an infinity is not a
 *   finite number.
 * - `non_finite_number`: exactly the SIGNED pair `+∞`, `−∞`. It sits under
 *   `infinity` alone and is the atom the sign-aware folds (`1/±∞ = 0`)
 *   consume; `infinity` itself admits the unsigned `~∞`, which has no sign.
 * - `nan`: the not-a-number marker. Its only supertype is `number`, so it is
 *   disjoint from `complex`, `infinity` and every type below them.
 *
 * RETIRED SPELLINGS. The five names that prefixed a tier with `finite_` are
 * no longer members of this union. Each denoted exactly the same set of values
 * as one of the bare names above, because every bare name under `number` is
 * finite: the four per-tier spellings each meant their own tier, and the
 * widest of them meant `complex` ("any finite number" IS the finite complex
 * type). The type PARSER still accepts all five as input aliases for one
 * release cycle and normalizes each to the name it denotes
 * (`RETIRED_NUMERIC_ALIASES` in `parser.ts`), but an alias never reaches a
 * `Type` node and is never serialized back out.
 */
export type NumericPrimitiveType =
  | 'number'
  | 'complex'
  | 'imaginary'
  | 'real'
  | 'rational'
  | 'integer'
  | 'non_finite_number'
  // A number of infinite magnitude, of any direction: `+∞`, `−∞`, the
  // unsigned `~∞` and mixed values such as `∞ + i`. Supertype of
  // `non_finite_number` (the signed pair), and disjoint from `complex`.
  | 'infinity'
  // The not-a-number marker. Disjoint from every numeric type but `number`.
  | 'nan';

/**
 * The value carried by the type of the unsigned complex infinity `~oo`, which
 * has no JavaScript number to stand for it: `Infinity` and `-Infinity` are the
 * signed pair, and `NaN` is a different value altogether.
 *
 * A value-literal type holds an arbitrary runtime value (see {@linkcode
 * ValueType}), so this frozen tagged object is that value. Test for it with
 * {@linkcode isComplexInfinityValue}, which reads the TAG: a `Type` node can be
 * rebuilt or re-frozen on its way through the parser and the reducers, so
 * object identity is not a reliable test.
 */
export const COMPLEX_INFINITY_VALUE = Object.freeze({
  complexInfinity: true as const,
});

/** True if `v` is the {@linkcode COMPLEX_INFINITY_VALUE} sentinel, i.e. the
 * value of the `~oo` value-literal type. Reads the tag, never the identity. */
export function isComplexInfinityValue(
  v: unknown
): v is typeof COMPLEX_INFINITY_VALUE {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { complexInfinity?: unknown }).complexInfinity === true
  );
}

export type NamedElement = {
  name?: string;
  type: Type;
};

/**
 * An effect label: a member of a closed, engine-versioned enumeration.
 *
 * Each label carries fixed metadata (impurity, observation vs action, frame
 * kind, handler-backed); consumers key on that metadata, never on the label
 * name. See `docs/EFFECTS-MODEL.md`.
 *
 * The labels bear no implication relations to each other: the order on effect
 * sets is plain powerset inclusion, so the singletons are pairwise
 * incomparable (in particular `fs_write` does not imply `fs_read`).
 */
export type EffectLabel =
  | 'console'
  | 'entropy'
  | 'environment'
  | 'fs_read'
  | 'fs_write'
  | 'network'
  | 'random'
  | 'scope'
  | 'state'
  | 'time';

/**
 * The effect set carried by a signature's arrow.
 *
 * - `'any'` is the distinguished **top**: "unknown effects". Under union it
 *   absorbs, and no finite bound admits it.
 * - Otherwise a duplicate-free, alphabetically sorted list of labels, possibly
 *   **empty**.
 *
 * An absent (`undefined`) `effects` field and `[]` denote the **same set**, ∅:
 * every semantic operation — subtyping, `pure`, the label predicates, union,
 * `matches()` — treats them identically. They differ only in **serialization**
 * (ruled 2026-08-01): absent is an empty specifier slot (effects were never
 * stated, and stay on the inferred track), while `[]` is the author's `pure`
 * and serializes back as ` pure`, so an explicit purity contract survives a
 * parse → serialize → re-declare round trip.
 *
 * Build one with `normalizeEffectSet()` (inference: an empty result collapses
 * to `undefined`) or `normalizeStatedEffectSet()` (a stated set: an empty
 * result stays `[]`).
 */
export type EffectSet = 'any' | EffectLabel[];

/**
 * A universally quantified type variable (rank-1).
 *
 * Only legal inside a function signature; declared and scoped by its arm's
 * `where` clause (the `typeParams` field of {@link FunctionSignature}). A variable is
 * **atomic and opaque**: it is never reduced, distributed or collapsed, and it
 * is substituted away by instantiation at a call site.
 */
export type TypeVariable = { kind: 'variable'; name: string };

/** How a parameterized NOMINAL type relates two of its applications
 * (`docs/TYPE-SYSTEM.md`).
 *
 * Declared inside a type-parameter clause (`type tree<out T> = …`); the words
 * are contextual there and are never reserved. Only a nominal declaration
 * carries one — a transparent alias has no declaration-level variance, and a
 * `where` clause never does. */
export type TypeVariance = 'in' | 'out' | 'inout';

/**
 * One entry of a signature's `where` clause, or of a declared type's
 * type-parameter clause: the variable's name and its optional declared upper
 * bound.
 *
 * The bound must be **ground** (no type variables) — validated when the
 * declared type is boxed. An unbounded variable's implicit bound is `any`.
 */
export type TypeParameter = {
  name: string;
  bound?: Type;
  /** Declaration-level variance, on a parameterized NOMINAL type only.
   * Absent means the default (`out`, verified — §4.4). */
  variance?: TypeVariance;
  /** The `is` protocol-conformance slot of a `where` clause
   * (`where T: collection is Hashable`). Checked after S1-S3 have solved the
   * variable, against {@link TypeResolver.conformsTo} (protocols design P19);
   * a declaration route with no such oracle rejects the slot outright. */
  protocols?: string[];
};

/**
 * The `typeParams` option of a generic type declaration — an ALIAS
 * (`ce.declareType('Pair', 'tuple<T, T>', { alias: true, typeParams: ['T'] })`)
 * or a parameterized NOMINAL type
 * (`ce.declareType('tree', '…', { typeParams: [{ name: 'T', variance: 'out' }] })`).
 *
 * Either clause TEXT (`'T, U: number'`, also accepted one entry at a time) or
 * pre-built parameters whose bound may be a type string. Every TEXT spelling
 * goes through the shared clause parser (`parseTypeParameterClause`); the
 * object-array form is validated directly by `normalizeDeclaredTypeParams`
 * (same rules: reserved names, duplicates, ground bounds).
 */
export type TypeParamsOption =
  | string
  | ReadonlyArray<
      | string
      | { name: string; bound?: Type | TypeString; variance?: TypeVariance }
    >;

export type FunctionSignature = {
  kind: 'signature';
  args?: NamedElement[];
  optArgs?: NamedElement[];
  variadicArg?: NamedElement;
  variadicMin?: 0 | 1; // If variadicArg is present, this indicates whether it can be empty or not
  /** The latent effects of applying this function.
   *
   * Absent means **pure** (the empty set), and serializes with an empty
   * specifier slot, exactly as an unannotated signature always has. The
   * stated-pure `[]` is the same set, spelled ` pure`. See {@link EffectSet}. */
  effects?: EffectSet;
  /** The `where` clause quantifying this arm (order-preserving).
   *
   * Present only on a **polytype**: `(T, U) -> T where T, U: number`. Each
   * arm of an overload set carries its own clause; same-named variables in
   * different arms are unrelated.
   *
   * `typeParams` and `effects` are the signature's two optional adjuncts: any
   * code that REBUILDS a signature field-by-field must carry BOTH across the
   * rebuild (a `{...t}` spread does it for free). */
  typeParams?: TypeParameter[];
  result: Type;
};

export type AlgebraicType = {
  kind: 'union' | 'intersection';
  types: Type[];
};

export type NegationType = {
  kind: 'negation';
  type: Type;
};

export type ValueType = {
  kind: 'value';
  value: any;
};

/** A record is a collection of key-value pairs.
 *
 * The keys are strings. The set of keys is fixed.
 *
 * For a record type to be a subtype of another record type, it must contain
 * every key required by the other type, and all their types must match (width
 * subtyping). It may contain additional keys.
 *
 */
export type RecordType = {
  kind: 'record';
  elements: Record<string, Type>;
};

/** The stored-field layout of an **object** type — the engine's one mutable
 * value kind.
 *
 * Structurally this looks like {@link RecordType}, and the two are read the
 * same way (an ordered map from field name to field type), but they behave in
 * opposite ways, and the difference is deliberate:
 *
 * - An object type is **nominal**. This shape is only ever the definition
 *   (`def`) of a declared {@link TypeReference}: `type Person = object{…}`.
 *   Two object types with identical layouts are unrelated, because a store
 *   through one view would break the other's declared field types (write
 *   `1.5` into an `object{count: integer}` viewed as `object{count: number}`).
 *   The nominal reference is what supplies that opacity; this shape only
 *   carries the layout.
 * - Every field is a read/write position, so a field type is **invariant**:
 *   two object layouts relate only when every field type is mutually equal,
 *   and a type variable occurring in a field verifies only as `inout`.
 *
 * The bare primitive `'object'` means "any object" and is the one common
 * bound every declared object type is a subtype of. It sits BESIDE `record`
 * in the lattice and is disjoint from it — sibling categories, one
 * immutable/structural, one mutable/nominal — and is deliberately not a
 * collection.
 *
 * Spec: `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Declaring an object type",
 * "No subtyping between object types", "Generic object types" (ruling B13),
 * and the lattice bullet of "The rest of the system" (ruling B6).
 */
export type ObjectType = {
  kind: 'object';
  elements: Record<string, Type>;
};

/** A dictionary is a collection of key-value pairs.
 *
 * The keys are strings. The set of keys is also not defined as part of the
 * type and can be modified at runtime.
 *
 * A dictionary is suitable for use as cache or data storage.
 */
export type DictionaryType = {
  kind: 'dictionary';
  values: Type;
};

/**
 * `CollectionType` is a generic collection of elements of a certain type.
 *
 * - Indexed collections: List, Tuple
 * - Non-indexed: Set, Record, Dictionary
 *
 */
export type CollectionType = {
  kind: 'collection' | 'indexed_collection';
  elements: Type;
};

/**
 * The elements of a list can be accessed by their one-based index.
 *
 * All elements of a list have the same type, but it can be a broad type,
 * up to `any`.
 *
 * The same element can be present in the list more than once.
 *
 * A list can be multi-dimensional. For example, a list of integers with
 * dimensions 2x3x4 is a 3D tensor with 2 layers, 3 rows and 4 columns.
 *
 */
export type ListType = {
  kind: 'list';
  elements: Type;
  dimensions?: number[];
};

export type SymbolType = {
  kind: 'symbol';
  name: string;
};

export type ExpressionType = {
  kind: 'expression';
  operator: string;
};

export type NumericType = {
  kind: 'numeric';
  type: NumericPrimitiveType;
  lower?: number;
  upper?: number;
  /** The lower bound is EXCLUDED: `real<0<..>` is x > 0 (open-bound
   * ranged types, `docs/plans/2026-08-28-open-bounds-in-ranged-types.md`).
   * Meaningful only when `lower` is a finite number; never set on the
   * discrete integer tiers, whose open bounds normalize to closed ones. */
  lowerOpen?: boolean;
  /** The upper bound is EXCLUDED: `real<..<3>` is x < 3. */
  upperOpen?: boolean;
};

/** Each element of a set is unique (is not present in the set more than once).
 * The elements of a set are not indexed.
 */
export type SetType = {
  kind: 'set';
  elements: Type;
};

/**
 * A `broadcastable<T>` is either a `T`, or an indexed collection of `T`
 * applied element-wise (runtime broadcasting). It is the static type of an
 * arithmetic result whose operand's collection-ness is not statically visible.
 *
 * A `T` (and any subtype of `T`) is a subtype of `broadcastable<T>`, and so is
 * any indexed collection whose elements are subtypes of `T`. It is *not* a
 * subtype of `T` (it may be a collection) nor of `list<T>` (it may be a
 * scalar). See `subtype.ts` for the full relation.
 */
export type BroadcastableType = {
  kind: 'broadcastable';
  elements: Type;
};

/** The elements of a tuple are indexed and may be named or unnamed.
 * If one element is named, all elements must be named.
 */
export type TupleType = {
  kind: 'tuple';
  elements: NamedElement[];
};

/** Nominal typing */
export type TypeReference = {
  kind: 'reference';
  name: string;
  alias: boolean;
  def: Type | undefined;
  /** The `where`-like clause of a GENERIC type declaration — an ALIAS
   * (`type alias Pair<T> = tuple<T, T>`) or a parameterized NOMINAL type
   * (`type tree<out T> = …`) — in declaration order.
   *
   * A record-level field, never part of a `Type`: it lives on the declaration
   * record held in a scope, not on an applied reference.
   *
   * For an ALIAS an applied reference (`Pair<integer>`) is EAGERLY EXPANDED
   * into the substituted body when the type is built, so no downstream
   * consumer ever meets an unexpanded alias application. A parameterized
   * NOMINAL application is the opposite: it is opaque, so it KEEPS its
   * arguments (see `args`).
   *
   * See `docs/TYPE-SYSTEM.md`. */
  typeParams?: TypeParameter[];

  /** The type ARGUMENTS of an applied reference to a parameterized nominal
   * type (`tree<integer>`), in declaration order.
   *
   * Present only on an APPLICATION, never on a declaration record, and never
   * on a generic ALIAS (which is expanded away instead). An applied nominal
   * reference is never expanded for subtyping — `tree<A>` and `tree<B>` are
   * related by name plus an argument-wise comparison — which is what makes a
   * recursive parametric type expressible at all (§1 of the design).
   *
   * An application delegates `def` to its declaration record, so a recursive
   * body (`tree<T>` inside `tree`) sees the definition once it is set. */
  args?: Type[];

  /** Whether this declaration's variance has been VERIFIED against its body
   * (parameterized-nominal design §4.2, ruling C). On the DECLARATION record
   * only — absent on aliases, on non-parameterized nominals, and on an applied
   * reference (which reads its record's state through `declarationOf`).
   *
   * `'deferred'` means the body reaches an unfulfilled forward reference, so
   * the declaration was accepted provisionally: until fulfilment completes the
   * group check, every subtype judgment reads its parameters as `inout`, which
   * is sound whatever variance fulfilment reveals. */
  _varianceState?: 'deferred' | 'verified';

  /** The unfulfilled forward-reference names a `'deferred'` verification waits
   * on. Cleared when the record reaches `'verified'`. */
  _varianceBlockedOn?: string[];

  /** SUM-TYPE SUGAR bookkeeping — on a VARIANT's declaration record, the name
   * of the sum that declared it
   * (`docs/plans/2026-08-12-sum-type-sugar-and-compilation.md` §A6).
   *
   * Set only by `declareSumType`: a hand-assembled union of nominals has no
   * sum identity and carries neither field. Metadata about the DECLARATION, so
   * it never rides an applied reference and never participates in a type's
   * structure, its serialization or its comparison. */
  _sumOf?: string;

  /** SUM-TYPE SUGAR bookkeeping — on the SUM's own declaration record, its
   * variants in declaration order, each with the subset of the sum's type
   * parameters it was declared with (A4). The companion of {@link _sumOf};
   * same non-structural status. */
  _sumVariants?: { name: string; typeParams: string[] }[];

  /** REDEFINITION DISCIPLINE bookkeeping — which declaring STATEMENT, of which
   * compilation unit, this record came from
   * (`docs/TYPE-SYSTEM.md`). Present only on a
   * record registered through an Epsil `type` STATEMENT while a batch was
   * live; the box route and the host `ce.declareType()` API leave it absent,
   * which is what makes their records freely replaceable. Metadata about the
   * DECLARATION, like {@link _sumOf}: never part of a type's structure,
   * serialization or comparison. */
  _declOrigin?: DeclarationOrigin;
};

/**
 * Which compilation unit and which declaring statement a registry record came
 * from — the runtime half of the redefinition discipline
 * (`docs/TYPE-SYSTEM.md`, "Mechanics").
 *
 * A second declaration of a name with the SAME `batch` and a DIFFERENT
 * `statementId` is a within-unit redefinition and is refused; the same
 * `statementId` re-registering is the same statement declaring itself again
 * (one statement registers up to three times per batch — the static pre-pass
 * canonicalizes it, then the evaluation loop canonicalizes and evaluates it)
 * and is accepted.
 *
 * `statementId` is an opaque IDENTITY token, compared with `!==` and never
 * inspected: the raw (uncanonicalized) name operand the `Declare*` handlers
 * thread from their canonical handler into their evaluate handler. It is typed
 * `unknown` so this engine-free module needs no expression type.
 */
export type DeclarationOrigin = {
  /** The Epsil batch (`ce._epsilBatchId`) the declaration ran under. */
  batch: number;
  /** Opaque per-statement identity; see the type's documentation. */
  statementId: unknown;
  /** The declaring name's source range, when the operand carried one — the
   * "first declared here" site a redefinition diagnostic points at. */
  firstRange?: [start: number, end: number];
};

export type Type =
  | PrimitiveType
  | AlgebraicType
  | NegationType
  | CollectionType
  | ListType
  | SetType
  | BroadcastableType
  | RecordType
  | ObjectType
  | DictionaryType
  | TupleType
  | SymbolType
  | ExpressionType
  | NumericType
  | NumericPrimitiveType
  | FunctionSignature
  | ValueType
  | TypeVariable
  | TypeReference;

/**
 * The type of a boxed expression indicates the kind of expression it is and
 * the value it represents.
 *
 * The type is represented either by a primitive type (e.g. number, complex, collection, etc.), or a compound type (e.g. tuple, function signature, etc.).
 *
 * Types are described using the following BNF grammar:
 *
 * ```bnf
 * <type> ::= <union_type> | "(" <type> ")"
 *
 * <union_type> ::= <intersection_type> (" | " <intersection_type>)*
 *
 * <intersection_type> ::= <primary_type> (" & " <primary_type>)*
 *
 * <primary_type> ::=  <primitive>
 *                | <tuple_type>
 *                | <signature>
 *                | <list_type>
 *                | <set>
 *                | <broadcastable>
 *                | <collection>
 *                | <type_reference>
 *
 * (A reference to a user-declared type. The optional argument list applies a
 * GENERIC type alias (`Pair<integer>`); it is expanded eagerly into the
 * substituted alias body when the type is built, so an applied reference never
 * appears in a `Type`. The authoritative grammar lives with the parser in
 * `./parser.ts`.)
 *
 * <type_reference> ::= ( "type" )? <identifier> ( "<" <type> ("," <type>)* ">" )?
 *
 * <primitive> ::= "any" | "unknown" | <value-type> | <symbolic-type> | <numeric-type>
 *
 * <numeric-type> ::= "number" | "complex" | "imaginary" | "real" | "rational" | "integer"
 *
 * <value-type> ::= "value" | <numeric-type> | "collection" | "boolean" | "string"
 *
 * <symbolic-type> ::= "expression" | "function" | "symbol"
 *
 * <tuple_type> ::= "tuple<" (<name> <type> "," <named_tuple_elements>*) ">"
 *            | "tuple<" (<type> "," <unnamed_tuple_elements>*) ">" |
 *            | "tuple<" <tuple_elements> ">"
 *
 * <tuple_elements> ::= <unnamed_tuple_elements> | <named_tuple_elements>
 *
 * <unnamed_tuple_elements> ::= <type> ("," <type>)*
 *
 * <named_tuple_elements> ::= <name> <type> ("," <name> <type>)*
 *
 * <signature> ::=  <arguments> (" " <effects>)? " -> " <type>
 *
 * <effects> ::= "pure" | "any" | <effect-label> (" " <effect-label>)*
 *
 * (`pure` is the STATED empty set: the same set as an empty slot, and the
 * spelling that round-trips through serialization. See {@link EffectSet}.)
 *
 * <effect-label> ::= "console" | "entropy" | "environment" | "fs_read"
 *            | "fs_write" | "network" | "random" | "scope" | "time"
 *
 * <arguments> ::= "()"
 *            | "(" <argument-list> ")"
 *
 * <argument> ::= <type>
 *            | <name> <type>
 *
 * <rest_argument> ::= "..." <type>
 *            | <name> "..." <type>
 *
 * <optional_argument> ::= <argument> "?"
 *
 * <optional_arguments> ::= <optional_argument> ("," <optional_argument>)*
 *
 * <required_arguments> ::= <argument> ("," <argument>)*
 *
 * <argument-list> ::= <required_arguments> ("," <rest_argument>)?
 *            | <required_arguments> <optional_arguments>?
 *            | <optional_arguments>?
 *            | <rest_argument>
 *
 * <list_type> ::= "list<" <type> <dimensions>? ">"
 *            | "vector<" (<type> <dimensions>? | <dimensions>) ">"
 *            | "matrix<" (<type> <dimensions>? | <dimensions>) ">"
 *            | "tensor<" <type> ">"
 *   Note: there is no `[type]` bracket shorthand; a list is always written with
 *   one of the `list`/`vector`/`matrix`/`tensor` heads. The authoritative
 *   grammar lives with the parser in `./parser.ts`.
 *
 * <dimensions> ::= "^" <fixed_size>
 *            | "^(" <multi_dimensional_size> ")"
 *
 * <fixed_size> ::= <positive-integer_literal>
 *
 * <multi_dimensional_size> ::= <positive-integer_literal> "x" <positive-integer_literal> ("x" <positive-integer_literal>)*
 *
 * (The `callback<…>` constructor of Design D was RETIRED by Design E
 * (`docs/TYPE-SYSTEM.md`): callback
 * slots are ordinary arrow types, admitted by COMPATIBILITY rather than
 * subtyping. The spelling now fails to parse, with a migration hint.)
 *
 * <set> ::= "set<" <type> ">"
 *
 * <broadcastable> ::= "broadcastable" ( "<" <type> ">" )?
 *
 * <collection> ::= ( "collection" | "indexed_collection" ) ( "<" <type> ">" )?
 *
 * <name> ::= <identifier> ":"
 *
 * <identifier> ::= [a-zA-Z_][a-zA-Z0-9_]*
 *
 * <positive-integer_literal> ::= [1-9][0-9]*
 *```
 *
 * Examples of types strings:
 * - `"number"`    -- a simple type primitive
 * - `"(number, boolean)"` -- a tuple type
 * - `"(x: number, y:boolean)"` -- a named tuple/record type. Either all arguments are named, or none are
 * - `"collection<any>"` -- an arbitrary collection type, with no length or element type restrictions
 * - `"collection<integer>"` -- a collection type where all the elements are integers
 * - `"collection<(number, boolean)>"` -- a collection of tuples
 * - `"collection<(value:number, seen:boolean)>"` -- a collection of named tuples
 * - `"vector<boolean^32>"` -- a list type with a fixed size of 32 elements
 * - `"matrix<integer^(2x3)>"` -- an integer matrix of 2 columns and 3 rows
 * - `"list<integer^(2x3x4)>"` -- a tensor of dimensions 2x3x4
 * - `"number -> number"` -- a signature with a single argument
 * - `"(x: number, number) -> number"` -- a signature with a named argument
 * - `"(number, y:number?) -> number"` -- a signature with an optional named argument (can have several optional arguments, at the end)
 * - `"(number, number+) -> number"` -- a signature with a rest argument (can have only one, and no optional arguments if there is a rest argument).
 * - `"() -> number"` -- a signature with an empty argument list
 * - `"(number) random -> number"` -- a signature that may draw from the seeded random stream
 * - `"(number) random scope -> number"` -- a signature with two effect labels
 * - `"(number) any -> number"` -- a signature with unknown effects
 * - `"number | boolean"` -- a union type
 * - `"(x: number) & (y: number)"` -- an intersection type
 * - `"number | ((x: number) & (y: number))"` -- a union type with an intersection type
 * - `"(number -> number) | number"` -- a union type with a signature and a primitive type
 */

export type TypeString = string;

export type TypeCompatibility =
  | 'covariant' // A <: B
  | 'contravariant' // A :> B
  | 'bivariant' // A <: B and A :>B, A := B
  | 'invariant'; // Neither A <: B, nor A :> B

/** A type resolver should return a definition for a given type name.
 */
export type TypeResolver = {
  /** Return a list of all type names that are defined in the resolver. This is
   * used to display error messages when a type is not found. */
  get names(): string[];
  forward: (name: string) => TypeReference | undefined;
  resolve: (name: string) => TypeReference | undefined;
  /**
   * The CONFORMANCE oracle — the `where T is Comparable` slot's only window
   * onto the protocol registry (protocols design P19).
   *
   * `common/type` may not import the engine (zero-cycle budget), so
   * conformance reaches the type layer exactly the way name resolution does:
   * through the resolver. `conformsTo(t, p)` answers "does the GROUND type `t`
   * conform to the protocol named `p`", inheritance included (a conformance
   * registered for a supertype answers for its subtypes).
   *
   * OPTIONAL: a resolver without it has no protocol registry to consult, and a
   * declared type carrying an `is` slot is rejected outright
   * (`protocol-conformance-unsupported`) rather than silently unchecked.
   */
  conformsTo?: (type: Type, protocol: string) => boolean;
};

/**
 * Parametric polymorphism is IMPLEMENTED: a signature may be quantified by a
 * trailing `where` clause with ground upper bounds
 * (`(T) -> T where T: indexed_collection`), rank-1 (quantifiers top-level
 * only), solved by
 * local inference at each call site. See `src/epsil/docs/types.md` for the
 * language model and `docs/TYPE-SYSTEM.md` for the
 * design record.
 *
 * ### Future considerations:
 * - Add support for generic function literals and the `function f<T>(…)`
 *   definition form (today a generic declaration requires an `evaluate`
 *   handler; a function-literal body is rejected),
 * - Add support for dimension variables (e.g. `(matrix<T^(MxN)>,
 *   matrix<T^(NxP)>) -> matrix<T^(MxP)> where T, M, N, P`) -- dimensions are
 *   integers, not types, so they need their own variable kind and solver,
 * - Add support for type packs / variadic correlation (the `Map`-class
 *   contract: n independently-typed collections with an n-ary callback),
 * - Add support for F-bounded and variable-referencing bounds
 *   (e.g. `where T: comparable<T>`, `where T: list<U>`) -- bounds are ground,
 * - Add support for type variables in unions, intersections and negations,
 *   each of which needs its own inference rule,
 * - Add support for higher-rank and higher-kinded types, and for variance
 *   annotations,
 * - Add support for type variants (e.g. a la Rust enums)
 *     Maybe something like
 *      `variant<Square, Circle>` or
 *      `variant<Square(side: integer), Circle(radius: integer)>`
 *      `variant<Square: {side: integer}, Circle: {radius: integer}>`
 * - Add support for dependent types, with type-level computations
 * - Add support for integers, booleans, symbols and strings, i.e. "T = "red" | "green" | "blue""
 * - Add support for conditional types (e.g. `T extends U ? X : Y`)
 *
 *
 */
