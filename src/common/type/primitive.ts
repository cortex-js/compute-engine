import type { NumericPrimitiveType, PrimitiveType, Type } from './types.js';

/** All the types representing numeric values */
export const NUMERIC_TYPES: NumericPrimitiveType[] = [
  'number',
  'complex',
  'imaginary',
  'real',
  'rational',
  'integer',
  // A number of infinite magnitude, of any direction (`+∞`, `−∞`, `~∞`,
  // `∞ + i`), and the not-a-number marker. Together with `complex` they
  // partition `number`: see the numeric tree comment on
  // `NumericPrimitiveType` in `types.ts`.
  'infinity',
  'nan',
] as const as NumericPrimitiveType[];

export const INDEXED_COLLECTION_TYPES: PrimitiveType[] = [
  'indexed_collection',
  'list',
  'tuple',
  // An index span (see the `range` entry in `types.ts`). Since 2026-09-29 a
  // SUBTYPE of `list`: `range <: list<integer>` (the `list` entry of
  // `PRIMITIVE_SUBTYPES` in `subtype.ts` lists it, and its structural
  // reading `RANGE_STRUCTURAL_TYPE` below is `list<integer>`). It was a
  // sibling of `list` before; that placement refused `1..10` to a symbol
  // declared `list`, while every other lazy ordered producer (`Map`,
  // `Filter`, `Repeat`, `Cycle`, `Iterate`) already typed `list`.
  'range',
  // A string is an indexed collection of its grapheme clusters (see the
  // `string` entry in `types.ts`). A sibling of `list`, not a subtype: joining
  // two strings can merge their boundary characters, so a string's element
  // sequence is a property of the whole string rather than of its parts.
  'string',
];

/**
 * The structural reading of the unparameterized `range` type: an index span
 * is an indexed collection of integers.
 *
 * `range` is the only primitive that carries a hidden element type, so every
 * site that destructures a parameterized collection (subtype checks against
 * `indexed_collection<T>`, type-variable binding, element-type readers) has
 * to expand it — hence ONE shared constant rather than a literal repeated at
 * each site. The element type is `integer`. The kind is `list`: an index
 * span is a list of integers, so `range <: list<integer>` and a `Range`
 * value can be assigned to a symbol declared `list` (changed 2026-09-29; the
 * reading was `indexed_collection<integer>`, which refused that assignment).
 */
// Frozen because it is shared BY REFERENCE across every `range` subtype and
// pattern-match call in the process (`isSubtype`, `walkPattern`): in-place
// mutation by any future consumer would silently corrupt every subsequent
// `range` check for the lifetime of the process, with no error at the
// mutation site. Same rule as the cached types in `parse.ts`, which are
// deep-frozen for exactly this reason.
export const RANGE_STRUCTURAL_TYPE: Type = Object.freeze({
  kind: 'list',
  elements: 'integer',
}) as Type;

/**
 * The structural reading of the `string` type: a string is an indexed
 * collection of `character` (one grapheme cluster each).
 *
 * `string` is the second primitive carrying a hidden element type (the first
 * is `range`), so every site that destructures a parameterized collection
 * (subtype checks against `indexed_collection<T>`, type-variable binding,
 * element-type readers) has to expand it — hence ONE shared constant rather
 * than a literal repeated at each site. The BROADCAST admission sites are the
 * deliberate exception: strings are broadcast-atomic, so they must not expand
 * there (a string is not a list, so it is not in the collection arm of a
 * `broadcastable`; see the `broadcastable` rules of `subtype.ts`).
 *
 * Frozen for the same reason `RANGE_STRUCTURAL_TYPE` is: it is shared by
 * reference across every `string` subtype and pattern-match call in the
 * process, so an in-place mutation would silently corrupt every subsequent
 * `string` check for the lifetime of the process.
 */
export const STRING_STRUCTURAL_TYPE: Type = Object.freeze({
  kind: 'indexed_collection',
  elements: 'character',
}) as Type;

/**
 * Structural readings of bare collection families. A bare name constrains
 * the kind, not its contents: `list` and `list<any>` accept the same values.
 * The bare list has no dimensions, so its rank is unconstrained too.
 * Explicit element arguments remain represented explicitly.
 *
 * Frozen because subtype and inference calls share these by reference.
 */
export const BARE_LIST_STRUCTURAL_TYPE: Type = Object.freeze({
  kind: 'list',
  elements: 'any',
}) as Type;

export const BARE_SET_STRUCTURAL_TYPE: Type = Object.freeze({
  kind: 'set',
  elements: 'any',
}) as Type;

export const BARE_DICTIONARY_STRUCTURAL_TYPE: Type = Object.freeze({
  kind: 'dictionary',
  values: 'any',
}) as Type;

export const BARE_COLLECTION_STRUCTURAL_TYPE: Type = Object.freeze({
  kind: 'collection',
  elements: 'any',
}) as Type;

export const BARE_INDEXED_COLLECTION_STRUCTURAL_TYPE: Type = Object.freeze({
  kind: 'indexed_collection',
  elements: 'any',
}) as Type;

/**
 * Explicit structural tops for collection shape and capability gates.
 * They accept the same families as bare names and remain useful to callers
 * that destructure the element argument. Frozen for safe shared reuse.
 */
export const COLLECTION_SHAPE_TYPE: Type = Object.freeze({
  kind: 'collection',
  elements: 'any',
}) as Type;

export const INDEXED_COLLECTION_SHAPE_TYPE: Type = Object.freeze({
  kind: 'indexed_collection',
  elements: 'any',
}) as Type;

export const DICTIONARY_SHAPE_TYPE: Type = Object.freeze({
  kind: 'dictionary',
  values: 'any',
}) as Type;

/**
 * The extended real line: a finite real, or one of the two SIGNED
 * infinities `+∞`/`−∞`.
 *
 * The bare name `real` denotes the FINITE reals, so a gate that asks "is
 * this operand somewhere on the extended real line?" — the realness gates
 * of the hyperbolic, sinc, Fresnel, step and exponential-integral heads,
 * and the parameter of an operator that accepts an infinite argument —
 * cannot be spelled `real`: a `±∞` operand does not match it. Spell the
 * question with this union instead. Complex infinity (`~oo`) and NaN are
 * excluded: neither is a signed real, and both are members of `number`
 * only.
 *
 * The same union is also the honest RESULT claim of a head whose value on
 * the extended real line can be infinite (`li(1) = −∞`, `Ei(0) = −∞`).
 *
 * Frozen for the same sharing reason as the shape constants above.
 */
/**
 * Exactly the SIGNED pair `+∞`/`−∞`, as the union of the two value types.
 * The parser accepts the one-word spelling `signed_infinity` for this
 * union and the serializer prints a union containing both members under
 * that name, so `real | signed_infinity` round-trips. It replaced the
 * retired name `non_finite_number` (ruling L5 executed 2026-08-31; the
 * old name was misleading: `~∞` and `∞ + i` are non-finite numbers, yet
 * neither was a member). Use this where the sign-aware guarantee matters
 * (the `1/±∞ = 0` folds, sign-reading gates); use `infinity` where any
 * infinite value is acceptable.
 *
 * Frozen for the same sharing reason as the shape constants above.
 */
export const SIGNED_INFINITY_TYPE: Type = Object.freeze({
  kind: 'union',
  types: [
    { kind: 'value', value: Infinity },
    { kind: 'value', value: -Infinity },
  ],
}) as Type;

export const EXTENDED_REAL_TYPE: Type = Object.freeze({
  kind: 'union',
  types: [
    'real',
    { kind: 'value', value: Infinity },
    { kind: 'value', value: -Infinity },
  ],
}) as Type;

export const COLLECTION_TYPES: PrimitiveType[] = [
  ...INDEXED_COLLECTION_TYPES,
  'collection',
  'set',
  'record',
  'dictionary',
] as const as PrimitiveType[];

export const SCALAR_TYPES: PrimitiveType[] = [
  'scalar',
  ...NUMERIC_TYPES,
  'boolean',
  // `character` is a scalar; `string` is NOT (it moved to
  // `INDEXED_COLLECTION_TYPES` when strings became collections). Keeping
  // `string` in both would make `scalar` and `collection` overlap, and every
  // predicate that reads them as the two branches of `value` would carry a
  // hidden exception. See `docs/STRING_ROADMAP.md`
  // (decision D1).
  'character',
] as const as PrimitiveType[];

export const VALUE_TYPES: PrimitiveType[] = [
  'value',
  'color',
  // `regexp` sits here beside `color`, NOT in `SCALAR_TYPES`: it is an opaque
  // value with no numeric or boolean reading, and NOT in `COLLECTION_TYPES`:
  // a pattern is not a sequence of elements. It therefore has no hidden
  // element type, which keeps it clear of the parameterized-collection
  // machinery entirely (`walkPattern`, `mapResultType`, `liftedElementTypeOf`
  // — the sites where a hidden element type is easy to forget).
  'regexp',
  // `type` (a reified type expression, the value `TypeFrom(...)` constructs)
  // sits beside `regexp` for the same reasons: an opaque value with no
  // numeric/boolean reading and no hidden element type, clear of the
  // parameterized-collection machinery.
  'type',
  // `object` is a value, but deliberately NOT a collection: field access is
  // not element access, so it sits beside `record` rather than under
  // `collection` with it (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, ruling
  // B6). Keeping it out of `COLLECTION_TYPES` is what makes `object` and
  // `record` disjoint in the primitive lattice.
  'object',
  ...COLLECTION_TYPES,
  ...SCALAR_TYPES,
] as const as PrimitiveType[];

export const EXPRESSION_TYPES: PrimitiveType[] = [
  'expression',
  'symbol',
  'function',
  ...VALUE_TYPES,
] as const as PrimitiveType[];

export const PRIMITIVE_TYPES: PrimitiveType[] = [
  'any',
  'unknown',
  'nothing',
  'missing',
  'never',
  'error',
  ...EXPRESSION_TYPES,
] as const as PrimitiveType[];

//
// Set counterparts of the arrays above, for O(1) membership tests on hot
// paths (the arrays are kept for ordered iteration and backward
// compatibility).
//
export const NUMERIC_TYPES_SET: ReadonlySet<NumericPrimitiveType> = new Set(
  NUMERIC_TYPES
);
export const COLLECTION_TYPES_SET: ReadonlySet<PrimitiveType> = new Set(
  COLLECTION_TYPES
);
export const SCALAR_TYPES_SET: ReadonlySet<PrimitiveType> = new Set(
  SCALAR_TYPES
);
export const PRIMITIVE_TYPES_SET: ReadonlySet<PrimitiveType> = new Set(
  PRIMITIVE_TYPES
);

/**
 * The rule a function signature's parameter list must satisfy, whichever
 * route the type arrives by: it may declare OPTIONAL parameters or a VARIADIC
 * tail, never both.
 *
 * The reason is the consumption model. Argument validation fills every
 * optional slot before it starts feeding the variadic parameter, so in
 * `(number, number?, number+)` the optional slot is not optional at all — it
 * has to be supplied before the variadic tail can take anything. The two
 * spellings would contradict each other, so the combination is refused
 * instead of being given a surprising meaning.
 *
 * The type-STRING grammar enforces it at parse time (`parseFunctionSignature`
 * in `parser.ts`); a hand-built `Type` object is checked with
 * {@linkcode hasOptionalWithVariadic} when it is boxed (the `BoxedType`
 * constructor). Both report this message.
 */
export const VARIADIC_WITH_OPTIONAL_MESSAGE =
  'Variadic arguments cannot be used with optional arguments';

/**
 * Does `t` contain — at any depth — a function signature that combines
 * optional parameters with a variadic tail? See
 * {@linkcode VARIADIC_WITH_OPTIONAL_MESSAGE} for the rule such a signature
 * breaks.
 *
 * A signature nested inside another type (`list<(number, number?, number+) ->
 * number>`) is just as unspellable as a top-level one, so the check is a full
 * walk. A type REFERENCE is not resolved — what a name stands for was checked
 * when that name was declared — but the type ARGUMENTS applied to it are
 * walked, since they come from the same hand-built type.
 */
export function hasOptionalWithVariadic(t: Type): boolean {
  if (typeof t === 'string') return false;
  switch (t.kind) {
    case 'signature':
      if ((t.optArgs?.length ?? 0) > 0 && t.variadicArg !== undefined)
        return true;
      return (
        hasOptionalWithVariadic(t.result) ||
        (t.args?.some((a) => hasOptionalWithVariadic(a.type)) ?? false) ||
        (t.optArgs?.some((a) => hasOptionalWithVariadic(a.type)) ?? false) ||
        (t.variadicArg !== undefined &&
          hasOptionalWithVariadic(t.variadicArg.type)) ||
        // A polytype's `where`-clause bounds are full types too — a bound
        // that is itself such a signature would serialize into a `where`
        // clause the parser refuses to read back.
        (t.typeParams?.some(
          (p) => p.bound !== undefined && hasOptionalWithVariadic(p.bound)
        ) ??
          false)
      );
    case 'record':
    case 'object':
      return Object.values(t.elements).some(hasOptionalWithVariadic);
    case 'union':
    case 'intersection':
      return t.types.some(hasOptionalWithVariadic);
    case 'negation':
      return hasOptionalWithVariadic(t.type);
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return hasOptionalWithVariadic(t.elements);
    case 'dictionary':
      return hasOptionalWithVariadic(t.values);
    case 'tuple':
      return t.elements.some((e) => hasOptionalWithVariadic(e.type));
    case 'reference':
      return t.args?.some(hasOptionalWithVariadic) ?? false;
    default:
      return false;
  }
}

export function isValidPrimitiveType(s: any): s is PrimitiveType {
  if (typeof s !== 'string') return false;
  return PRIMITIVE_TYPES_SET.has(s as PrimitiveType);
}

export function isValidType(t: any): t is Readonly<Type> {
  if (typeof t === 'string') return PRIMITIVE_TYPES_SET.has(t as PrimitiveType);
  if (typeof t !== 'object') return false;
  if (!('kind' in t)) return false;
  return (
    t.kind === 'signature' ||
    t.kind === 'union' ||
    t.kind === 'intersection' ||
    t.kind === 'negation' ||
    t.kind === 'value' ||
    t.kind === 'tuple' ||
    t.kind === 'list' ||
    t.kind === 'record' ||
    t.kind === 'object' ||
    t.kind === 'dictionary' ||
    t.kind === 'set' ||
    t.kind === 'broadcastable' ||
    t.kind === 'symbol' ||
    t.kind === 'expression' ||
    t.kind === 'numeric' ||
    t.kind === 'collection' ||
    t.kind === 'indexed_collection' ||
    t.kind === 'variable' ||
    t.kind === 'reference'
  );
}

/**
 * The primitive names of the list families: a value of one of these is, or
 * can be, a list. A list whose cells could be lists does not carry
 * dimensions (`cellTypeMayCarryDimensions`): its shape is spelled in one
 * place, on the outer head.
 */
const LIST_FAMILY_NAMES: ReadonlySet<string> = new Set([
  'list',
  'collection',
  'indexed_collection',
  // An index span is a list of integers.
  'range',
]);

/**
 * Whether a list whose cells have the type `t` may carry dimensions, that
 * is, be spelled `list<t^n>`, `vector<t>`, `matrix<t>` or `tensor<t>` by
 * the type builder, or be typed with a shape by the engine's literal
 * typing.
 *
 * The rule in force (user decision of 2026-10-21, after the measurement
 * recorded in `docs/plans/2026-10-21-list-element-tensor-cell.md`): the
 * cells of a list with dimensions cannot themselves be lists. A shape is
 * spelled in one place, on the outer head (`matrix<T^(2x3)>`), never nested
 * (`list<list<T^3>^2>`), so that one value has one spelling. Accepted: every
 * primitive name that is not a list family name (the numeric names,
 * `boolean`, `string`, `symbol`, `color`, `missing`, `nothing`, `error`,
 * `never`, `value`, `expression`, `scalar`), the tops `any` and `unknown`
 * (which stand for a cell), tuples, records, objects, dictionaries, sets,
 * signatures, symbol and expression types, numeric literals and ranges,
 * type variables, references to declared types, negations, a string that
 * is not a primitive type name (a type variable that a resolver returned
 * by name, as `cellTypeCanHoldANumber` explains), and a union or
 * intersection whose arms are all accepted. Refused: a list of any form (a
 * plain list, a tensor), `collection`, `indexed_collection`,
 * `broadcastable`, the bare names of those families (`list`, `collection`,
 * `indexed_collection`, `range`), and a union or intersection with such an
 * arm. The test is syntactic, on the type tree, and does not consult the
 * subtype relation (this module is a leaf that the type builder can
 * import).
 *
 * Every head applies this one rule to its cells (user decision of
 * 2026-10-22, option U of
 * `docs/plans/2026-10-22-list-lengths-and-tensor-shapes.md`):
 * `matrix<boolean>`, `vector<string^2>`, `tensor<boolean>` and
 * `tensor<tuple<number, number>>` are accepted; `matrix<list<integer>>` and
 * `tensor<list<integer>>` are not. Only the bare names `vector`, `matrix`
 * and `tensor` mean number cells.
 *
 * The subtype relation asks the semantic form of this question,
 * `cannotHoldAList` in `subtype.ts`: `value` and `any` pass the syntactic
 * test here, but some of their values are lists.
 *
 * The alternative rule the plan measured first, "the cells must be able to
 * hold a number" (under which `[True, False]` types `list<boolean>`), is a
 * one-line change here: `return cellTypeCanHoldANumber(t);`. Every site
 * asks this question through this function.
 */
export function cellTypeMayCarryDimensions(t: Type): boolean {
  if (typeof t === 'string') return !LIST_FAMILY_NAMES.has(t);
  switch (t.kind) {
    case 'list':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return false;
    case 'union':
    case 'intersection':
      return t.types.every(cellTypeMayCarryDimensions);
    default:
      // A tuple, record, object, dictionary, set, signature, symbol,
      // expression, numeric range, literal, type variable, reference or
      // negation holds no list.
      return true;
  }
}

/**
 * The primitive names, other than the numeric names, whose values include
 * numbers: the tops, the bottom, and the names that `number` is below in the
 * primitive lattice. A cell type spelled with one of these could still be
 * numeric, so a rank-1 list of it prints with the `vector` head
 * (`cellTypeCanHoldANumber`).
 */
const PRIMITIVES_THAT_CAN_HOLD_A_NUMBER: ReadonlySet<string> = new Set([
  'any',
  'unknown',
  'never',
  'value',
  'scalar',
  'expression',
]);

/**
 * Whether the cell type `t` could hold a number. Only the printer
 * (`typeToString` in `serialize.ts`) asks this question: a list of rank 1
 * prints as `vector<…>` when its cells can hold a number and as `list<…^n>`
 * otherwise (`vector<integer^3>`, `list<boolean^2>`). The parser does not
 * ask it: every head accepts every cell type that is not a list
 * (`cellTypeMayCarryDimensions`), so `vector<string^2>` parses (and prints
 * `list<string^2>`) and `matrix<boolean>` parses. User decision of
 * 2026-10-22, option U of
 * `docs/plans/2026-10-22-list-lengths-and-tensor-shapes.md`; until then the
 * parser refused `vector` and `matrix` cells that cannot hold a number.
 *
 * It answers `false` only for a type that
 * provably holds no number: a non-numeric primitive name (`string`,
 * `boolean`, `symbol`, a collection name), a string or boolean literal
 * type, a composite that is not a number (a list, a tuple, a record, a
 * dictionary, a set, a signature, an object), a union of such types, or an
 * intersection with such an arm. A numeric name, a range, a numeric
 * literal, a top (`any`, `unknown`), `never`, `value`, `scalar`,
 * `expression` (an expression can stand for a number), `expression<Op>`, a
 * type variable, a reference to a declared type, a negation, and a
 * `broadcastable<T>` with an accepted `T` are accepted. The test is
 * syntactic, on the type tree.
 *
 * A string that is not a primitive type name is accepted too. It is a name
 * that a type resolver returned as the name itself, not as a type node: the
 * Epsil parser's resolver does this for a type variable that the `where`
 * clause of a definition binds, because it checks the parameter annotations
 * (`a: matrix<T^(MxN)>` in
 * `function mm(a: matrix<T^(MxN)>, …) -> … where T, M, N, P`) before the
 * clause is parsed. Such a name says nothing about the cells, as a
 * `variable` node does not, so `vector<T^N>` prints with the `vector` head
 * on that route as it does from `parseType` with the clause.
 */
export function cellTypeCanHoldANumber(t: Type): boolean {
  if (typeof t === 'string')
    return (
      NUMERIC_TYPES_SET.has(t as NumericPrimitiveType) ||
      PRIMITIVES_THAT_CAN_HOLD_A_NUMBER.has(t) ||
      !PRIMITIVE_TYPES_SET.has(t as PrimitiveType)
    );
  switch (t.kind) {
    case 'numeric':
      return true;
    case 'value':
      // A number, or one of the sentinel values (`~oo`, `Indeterminate`);
      // not a string or a boolean literal.
      return typeof t.value !== 'string' && typeof t.value !== 'boolean';
    case 'union':
      return t.types.some(cellTypeCanHoldANumber);
    case 'intersection':
      return t.types.every(cellTypeCanHoldANumber);
    case 'broadcastable':
      return cellTypeCanHoldANumber(t.elements);
    case 'negation':
    case 'variable':
    case 'reference':
    case 'expression':
      return true;
    default:
      // A list, tuple, record, object, dictionary, set, collection, symbol
      // or function signature holds no number.
      return false;
  }
}
