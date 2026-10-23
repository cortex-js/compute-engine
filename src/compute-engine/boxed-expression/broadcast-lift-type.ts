/**
 * The broadcast typing of an application over collection operands, shared by
 * the two type-derivation routes.
 *
 * A broadcastable operator applied to a collection operand evaluates
 * element-wise, so its value is a collection while its `type` handler
 * computed the SCALAR per-element result. The lift re-shapes that result:
 * arm 0 types the component-wise broadcast over numeric tuples, arm 1 the
 * element-wise broadcast over a definite collection (a materialized finite
 * collection, an operand typed as an unbounded list, a fixed-shape tensor
 * intermediate), and arm 2 an operand that MAY be a collection
 * (`broadcastable<R>`).
 *
 * The expression route (`BoxedFunction.type`, `boxed-function.ts`) used to
 * hold this logic inline over its operand EXPRESSIONS, and the descriptor
 * route (`deriveApplicationType`, `derive-application-type.ts`, the
 * `context.derive` a `type` handler calls to type a body over its operands)
 * had none: `derive('Power', [d, 2])` with `d` typed `list<integer^3>`
 * answered the scalar `number` where `v^2` for a `v` of that type typed
 * `vector<3>`. Every handler that derives a body over a collection operand —
 * a `Map` body over a collection element, a pipe stage — got a scalar type
 * for a collection value.
 *
 * The logic is written once over a {@link BroadcastOperandView}: the few
 * facts about an operand the arms read. An expression supplies them through
 * the value-level predicates it always used (`viewOfExpression` in
 * `boxed-function.ts`), so the expression route is unchanged; a descriptor
 * supplies them from its type, facts and structure
 * ({@link viewOfDescriptor}).
 */
import type {
  BroadcastableType,
  CollectionType,
  ListType,
  TupleType,
  Type,
} from '../../common/type/types.js';
import {
  COLLECTION_SHAPE_TYPE,
  DICTIONARY_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../../common/type/primitive.js';
import {
  absorbNumericAbsence,
  broadcastElementType,
  collectionElementType,
  isNumericScalarType,
  nestedBroadcastResultType,
  resolveTypeAlias,
  staticCollectionDims,
  stripMissingFromType,
  typeContainsMissing,
  collectionLevels,
  MAX_CELL_DEPTH,
  descendIntoConstructor,
  isBareCutOnDescent,
  topTypeBesideAbsence,
  blockLocalTypeMayHoldList,
  unfoldAliasOnDescent,
  type AliasDescent,
} from '../../common/type/utils.js';
import {
  broadcastCollectionArm,
  isSubtype,
  provablyAdmits,
  widen,
} from '../../common/type/subtype.js';
import { reduceType } from '../../common/type/reduce.js';
import type {
  BoxedOperatorDefinition,
  BroadcastExemption,
  OperandDescriptor,
} from '../global-types.js';
import {
  armwiseUnionBroadcastResultType,
  isArmedOperandType,
  isScalarUnionWithTupleArm,
  dimensionlessIndexedElement,
  isRecordShapedType,
  isTupleShapedType,
  loneUnionBroadcastResultType,
  scalarOrListUnionCellType,
  scalarOrCollectionUnionBranches,
  typeCouldBeCollection,
  mayCarryDimensions,
  shapedBroadcastResultType,
  shapedOrPlainListType,
  broadcastCellTypeOf,
  broadcastElementTypeOf,
} from '../collection-utils.js';

/** The facts about one operand the broadcast lift reads. Every member is a
 * getter or a plain value so that an expression-backed view can compute a
 * value-level predicate lazily, exactly when the arm that needs it runs. */
export interface BroadcastOperandView {
  /** The operand's handler-visible type. */
  readonly type: Type;
  /** A bare symbol (its type is read even when numeric-scalar-typed by the
   * tuple-arity arm). */
  readonly isSymbol: boolean;
  /** An application (a top-typed application MAY be a collection; a
   * top-typed literal is not). */
  readonly isApplication: boolean;
  /** A symbol the user declared `any` or `value` (not an inferred one): it
   * MAY be a collection, as a top-typed application may
   * (`isPossiblyCollectionTyped`, `collection-utils.ts`). */
  readonly declaredTopSymbol: boolean;
  /** A `Block` local typed by a top type: it MAY be a collection
   * (`isTopTypedBlockLocal`, `collection-utils.ts`). */
  readonly topTypedBlockLocal: boolean;
  /** The value-level capability: the operand IS a collection. */
  readonly isCollection: boolean;
  /** A materialized finite indexed collection that is neither a tuple nor a
   * text atom (`isFiniteBroadcastParticipant`). */
  readonly finiteBroadcastParticipant: boolean;
  /** A tuple value or a tuple-typed operand (`isTuple`). */
  readonly tuple: boolean;
  /** A string or character value, or a string-typed operand (`isTextAtom`). */
  readonly textAtom: boolean;
  /** A `List` literal whose shape can be read (`candidateShape`). */
  readonly tensorShape: boolean;
  /** The operand's type proves a matrix (`type.facts.matrix`). */
  readonly matrixFact: boolean;
  /** `type.isUnknown` of the boxed type. */
  readonly typeIsUnknown: boolean;
  /** The operand holds a collection value NOW whose kind is DECIDED as not
   * indexed: a symbol declared `collection<T>` that holds a set, or a `Map`
   * over such a symbol. An element-wise operator does not map over such a
   * value, so the application is typed as a scalar application, from the
   * value, the same way arm 1 types an operand that holds a list as a list.
   * `false` when the kind is not decided yet (a `Map` over a symbol that
   * holds no value): the value may still be a list. */
  readonly holdsUnindexedCollection: boolean;
}

/** A view over an operand descriptor, for the descriptor route. */
export function viewOfDescriptor(d: OperandDescriptor): BroadcastOperandView {
  const t = d.type;
  const structure = d.structureOf?.();
  const resolved = resolveTypeAlias(t);
  const tuple =
    structure?.kind === 'tuple' ||
    (structure?.kind !== 'number' && isTupleShapedType(resolved));
  const textAtom =
    structure?.kind === 'string' || isSubtype(resolved, 'string');
  const finiteIndexed =
    d.facts.indexed === true && d.facts.finiteCollection === true;
  const dims =
    typeof resolved !== 'string' && resolved.kind === 'list'
      ? resolved.dimensions
      : undefined;
  return {
    type: t,
    isSymbol: structure?.kind === 'symbol',
    isApplication: structure?.kind === 'application',
    declaredTopSymbol:
      structure?.kind === 'symbol' &&
      structure.inferred !== true &&
      (resolved === 'any' || resolved === 'value'),
    topTypedBlockLocal:
      structure?.kind === 'symbol' &&
      structure.local === true &&
      blockLocalTypeMayHoldList(t),
    isCollection: d.facts.collection === true,
    finiteBroadcastParticipant: finiteIndexed && !tuple && !textAtom,
    tuple,
    textAtom,
    tensorShape:
      structure?.kind === 'list-literal' && structure.shape !== undefined,
    // A matrix fact is a dimension list of length 2. A tensor of unknown
    // rank (`dimensions` is `null`) makes no shape claim, so it is not one.
    matrixFact: !!dims && dims.length === 2,
    typeIsUnknown: t === 'unknown',
    // A descriptor has no value channel that separates a symbol holding a
    // set from a valueless one (its `collection` fact is also read from the
    // type), so the application is typed from the declaration.
    holdsUnindexedCollection: false,
  };
}

/** `isBroadcastCollectionType` on a type: an unbounded 1-D list or indexed
 * collection, or a union with such a branch. */
export function isBroadcastCollectionTypeOf(t: Type): boolean {
  return dimensionlessIndexedElement(t) !== undefined;
}

/** `isFixedShapeCollection` on a type: a `list` with a dimension list. A
 * tensor of unknown rank (`dimensions` is `null`) has no fixed shape, and
 * broadcasts like an abstract collection. */
export function isFixedShapeCollectionTypeOf(t: Type): boolean {
  const r = resolveTypeAlias(t);
  if (typeof r !== 'string' && r.kind === 'list') return !!r.dimensions;
  // A union of such lists (`matrix<2x2> | vector<2>`, an index into a
  // `broadcastable<matrix<2x2>>`; `vector<2> | vector<3>`), with or without
  // a `missing` arm, is mapped as each of its lists is. Read as no
  // collection, the application was typed as one cell: `Sqrt` of it was
  // `number`, which the value, a list, is not.
  if (typeof r === 'string' || r.kind !== 'union') return false;
  const present = r.types.filter((arm) => resolveTypeAlias(arm) !== 'missing');
  return (
    present.length > 0 &&
    present.every((arm) => {
      const a = resolveTypeAlias(arm);
      return typeof a !== 'string' && a.kind === 'list' && !!a.dimensions;
    })
  );
}

/**
 * Whether a handler's answer `t` states the shape of a collection, so that
 * the broadcast wrapper keeps it instead of re-wrapping the cell result: a
 * list with a dimension list (`Negate` of a matrix IS the operand's
 * matrix), a tensor of unknown rank, or a plain list whose elements are
 * read down to a non-list type (`list<list<integer>>` is two list levels
 * of integers, its own shape). The element may also be a union whose arms
 * are lists or types that cannot be lists (`list<list<real> | real>`, the
 * sum of `L: list<list<integer> | integer>` and `0.5`): the handler typed
 * each arm of the operand's element, and wrapping its answer again nested
 * one list level too many (`list<list<list<real> | real> | list<real> |
 * real>`). A list arm of such a union is not read further: its elements
 * may be left open by the handler (`list<unknown>` for the deeper levels
 * of a self-referential alias) without making the answer shapeless. A
 * shapeless collection (`indexed_collection<…>` of `-Range(1, 5)`, a bare
 * `list`, a list of `any`) is not one, and the wrapper types it from the
 * operands.
 */
function handlerAnswerStatesShape(
  t: Type,
  seen?: AliasDescent,
  depth = 0
): boolean {
  if (depth > MAX_CELL_DEPTH) return false;
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  const r = unfolded.type;
  if (typeof r === 'string' || r.kind !== 'list') return false;
  if (r.dimensions !== undefined) return true;
  return elementStatesShape(r.elements, unfolded.seen, depth + 1);
}

/**
 * Whether the element type `el` of a plain list in a handler's answer is
 * read down to non-list types (`handlerAnswerStatesShape`): a type that
 * cannot be a list, a list that states its shape, or a union whose every
 * arm is a list or a type that cannot be a list (`inUnion` is true for an
 * arm). The alias unfold runs under the descent guard
 * (`unfoldAliasOnDescent`): a self-referential alias
 * (`type alias b = list<b | integer>`) that repeats on the path is the type
 * of an enclosing level, whose shape is the one being read, so it does not
 * decide the answer.
 */
function elementStatesShape(
  el: Type,
  seen: AliasDescent | undefined,
  depth: number,
  inUnion = false
): boolean {
  if (depth > MAX_CELL_DEPTH) return false;
  const unfolded = unfoldAliasOnDescent(el, seen);
  if (unfolded === undefined) return true;
  const r = unfolded.type;
  if (typeof r !== 'string' && r.kind === 'union')
    return r.types.every((arm) =>
      elementStatesShape(arm, unfolded.seen, depth, true)
    );
  if (typeof r !== 'string' && r.kind === 'list')
    return inUnion || handlerAnswerStatesShape(r, unfolded.seen, depth);
  // A plain list of `r` has the rank-1 reading exactly when `r` cannot be
  // a list (`staticCollectionDims`).
  return staticCollectionDims({ kind: 'list', elements: r }) !== null;
}

/**
 * The list type `r` with the cell type `cell`: the same shape when the
 * cells may carry its dimensions, nested plain lists of the same rank
 * otherwise (`shapedOrPlainListType`). A cell that gains a `missing` arm
 * keeps a numeric shape (`matrix<integer | missing^(2x2)>` is a tensor whose
 * cells may be absent, a spelling the parser reads back); a point cell does
 * not.
 */
function withCellType(
  r: ListType | CollectionType | BroadcastableType,
  cell: Type
): Type {
  if (r.kind === 'list' && r.dimensions !== undefined && !mayCarryDimensions(cell))
    return shapedOrPlainListType(cell, r.dimensions);
  return { ...r, elements: cell };
}

/** `isLinearAlgebraCollection` on a type. */
export function isLinearAlgebraCollectionTypeOf(t: Type): boolean {
  const r = resolveTypeAlias(t);
  if (
    r === 'list' ||
    r === 'collection' ||
    r === 'indexed_collection' ||
    r === 'range'
  )
    return true;
  return (
    typeof r !== 'string' &&
    (r.kind === 'list' ||
      r.kind === 'collection' ||
      r.kind === 'indexed_collection')
  );
}

/** `isPossiblyCollectionTyped` on a view: a `broadcastable<T>`-typed operand
 * (or a union with such a branch), a top-typed APPLICATION, or a symbol
 * declared `any` or `value`, or a `Block` local typed by a top type. An
 * application typed by a top type beside absence markers only
 * (`missing | unknown`, an index into a `list<unknown>`) is read as that
 * top type (`topTypeBesideAbsence`). */
export function isPossiblyCollectionTypedView(
  v: BroadcastOperandView
): boolean {
  if (v.topTypedBlockLocal) return true;
  const resolved = resolveTypeAlias(v.type);
  const t =
    (v.isApplication ? topTypeBesideAbsence(resolved) : undefined) ??
    resolved;
  if ((t === 'any' || t === 'value') && v.declaredTopSymbol) return true;
  if (t === 'unknown' || t === 'any' || t === 'value') return v.isApplication;
  if (typeof t === 'string') return false;
  if (t.kind === 'broadcastable') return true;
  if (t.kind !== 'union') return false;
  return t.types.some((branch) => {
    const b = resolveTypeAlias(branch);
    return typeof b !== 'string' && b.kind === 'broadcastable';
  });
}

/** Whether a type matches the absence-admitting collection top
 * `collection<any>`. */
function matchesCollectionShape(t: Type): boolean {
  return isSubtype(t, COLLECTION_SHAPE_TYPE);
}

/** The absence-admitting top of the set family, for the shape test in
 * {@link isAbstractCollectionTypeOf}. */
const SET_SHAPE_TYPE: Type = Object.freeze({
  kind: 'set',
  elements: 'any',
}) as Type;

/**
 * Whether `t` is an ABSTRACT collection type: it matches `collection<any>`,
 * but it is not an indexed collection, a set, a dictionary or a record. Such a
 * type does not fix the kind of its value: a symbol declared
 * `collection<number>` can hold a list, a range or a set. An element-wise
 * operator maps over the first two and does not map over the third, so its
 * application over such an operand may or may not be a collection.
 *
 * The bottom type `never` answers `false`. It is a subtype of every type, so
 * it matches `collection<any>`, but it is also a subtype of
 * `indexed_collection<any>`, so the tests below reject it; the explicit test
 * states the reason: a `never` operand has no value at all, so there is
 * nothing to map over.
 *
 * `isAbstractCollectionType()` in `boxed-function.ts` reads a boxed type and
 * delegates to this function.
 */
export function isAbstractCollectionTypeOf(t: Type): boolean {
  if (t === 'never') return false;
  return (
    matchesCollectionShape(t) &&
    !isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE) &&
    !isSubtype(t, SET_SHAPE_TYPE) &&
    !isSubtype(t, DICTIONARY_SHAPE_TYPE) &&
    !isRecordShapedType(t)
  );
}

/**
 * Whether an operand of type `t` may hold a collection of any kind, so that
 * the kind of a node built over it is known only from the value the operand
 * holds: an abstract collection type (`isAbstractCollectionTypeOf`), or a
 * type that says nothing about the value (`unknown`, `any`, `value`), such
 * as the type of an unresolved call `f(x)` or of a symbol declared `any`.
 *
 * `Join` and `Append` type their result `collection<T>` over such an
 * operand (`joinResultTypeD`, `library/collections.ts`), and the predicates
 * that follow the held values read such an operand as a source whose value
 * decides the kind (`abstractSourcesHoldIndexedValues`, `boxed-function.ts`,
 * and `producesSet`, `boxed-expression/listed-element.ts`).
 */
export function isKindOpenOperandType(t: Type): boolean {
  return (
    t === 'unknown' ||
    t === 'any' ||
    t === 'value' ||
    isAbstractCollectionTypeOf(t)
  );
}

/**
 * How an operand whose type admits an abstract collection
 * (`isAbstractCollectionTypeOf`) takes part in an element-wise broadcast.
 */
export interface AbstractCollectionCell {
  /** The type one cell of the broadcast sees for the operand. A type handler
   * called with this type answers the per-cell result of the operator;
   * called with the collection type, it answers a type that no cell has,
   * such as `collection<number> | integer` for `P + 1`. */
  readonly cell: Type;
  /** The element type of the abstract collection when that element is
   * itself an indexed collection (`collection<list<number>>`), else
   * `undefined`. The runtime broadcast descends into such an element to its
   * leaves, so the per-cell result must be wrapped to the rank of the
   * element (`nestedBroadcastResultType`): `Sin` of a held
   * `[[1, 2], [3, 4]]` is `list<list<number>>`. */
  readonly nestedElement: Type | undefined;
}

/**
 * The broadcast cell of an operand of type `t` when `t` admits an abstract
 * collection, or `undefined` when it does not, or when no sound cell can be
 * given (then the application keeps the typing it had before abstract
 * collections were lifted).
 *
 * Three spellings admit an abstract collection:
 * - the abstract collection itself, `collection<T>`: the cell is `T`;
 * - the same with an absence arm, `collection<T> | missing` (a restricted
 *   collection): the `missing` arm is ignored here, and the caller adds the
 *   absence back to the result as it does for any absent operand
 *   (`absorbOperandAbsence`);
 * - a union of scalar arms and an abstract collection,
 *   `number | collection<number>`: the value is a scalar, which the operator
 *   applies to, or a collection, which it may map over. The cell is the
 *   union of the scalar arms and `T`.
 *
 * The element of a bare `collection` is the placeholder `unknown`. A type
 * handler reads an `unknown` operand as "no evidence yet" and can type the
 * result from the other operands alone: `Add` answers `integer` for
 * `unknown + 1`, which a cell holding `0.5` contradicts. The elements of a
 * bare collection are values (the bare name excludes absence markers), so
 * the cell is typed as the values-only top `value` instead.
 *
 * When the element is itself an indexed collection, the runtime broadcast
 * descends to its leaves, so the cell is the leaf type
 * (`broadcastCellType`) and the element is reported in `nestedElement` for
 * the rank wrap. A union with scalar arms has no single rank (a scalar cell
 * has none, a collection cell has the element's), and an element that is a
 * set, a dictionary, a record or another abstract collection is not mapped
 * over in a way a single cell type describes: in these cases the answer is
 * `undefined`. A string or a tuple element is a leaf of the broadcast.
 */
export function abstractCollectionCell(
  t: Type
): AbstractCollectionCell | undefined {
  const r = resolveTypeAlias(t);
  const arms =
    typeof r !== 'string' && r.kind === 'union' ? r.types : [r as Type];
  const scalars: Type[] = [];
  const collections: Type[] = [];
  for (const arm of arms) {
    const a = resolveTypeAlias(arm);
    if (a === 'missing' || a === 'never') continue;
    // A string is a collection of its characters in the lattice, and a tuple
    // is an indexed collection: neither is a scalar arm, and neither is an
    // abstract collection, so the union is not one this function types.
    if (isSubtype(a, 'string') || isTupleShapedType(a)) return undefined;
    if (matchesCollectionShape(a)) collections.push(a);
    else scalars.push(a);
  }
  if (collections.length === 0) return undefined;
  const collection =
    collections.length === 1 ? collections[0] : widen(...collections);
  if (!isAbstractCollectionTypeOf(collection)) return undefined;
  const raw = collectionElementType(collection);
  const element: Type = raw === undefined || raw === 'unknown' ? 'value' : raw;
  const e = resolveTypeAlias(element);
  if (
    !matchesCollectionShape(e) ||
    isSubtype(e, 'string') ||
    isTupleShapedType(e)
  ) {
    return {
      cell: scalars.length === 0 ? element : widen(...scalars, element),
      nestedElement: undefined,
    };
  }
  if (scalars.length > 0 || !isSubtype(e, INDEXED_COLLECTION_SHAPE_TYPE))
    return undefined;
  // The leaf of a bare `list` element is `unknown`, typed `value` for the
  // reason given above.
  const leaf = broadcastCellTypeOf(e);
  return { cell: leaf === 'unknown' ? 'value' : leaf, nestedElement: e };
}

/**
 * The present part of a GATED collection type, or `undefined` when `t` is not
 * one. A gated collection type is `missing | C`, where every arm of `C` is an
 * indexed collection that is not a string: a point, a list, or a union of
 * those. A restriction or a default-less `Which` gives this type:
 * `When(PointList(0, 1), 0 < t)` is typed `missing | tuple<integer, integer>`,
 * and its value is the point or `Missing`.
 *
 * The broadcast lift reads the present part: without it, the `missing` arm
 * hides the point or the list from every shape test, and `Sin` of a
 * restricted point typed as the scalar `number`. A nominal value is atomic
 * whatever its representation, so a union with a nominal arm is not a gated
 * collection. (The compile-side twin, over an expression, is
 * `gatedCollectionArms()` in `compilation/base-compiler.ts`.)
 */
export function gatedCollectionPresentType(t: Type): Type | undefined {
  const r = resolveTypeAlias(t);
  if (typeof r === 'string' || r.kind !== 'union') return undefined;
  let absent = false;
  const arms: Type[] = [];
  for (const branch of r.types) {
    if (
      typeof branch !== 'string' &&
      branch.kind === 'reference' &&
      branch.alias !== true
    )
      return undefined;
    const b = resolveTypeAlias(branch);
    if (b === 'missing') absent = true;
    else if (b === 'never') continue;
    else if (
      !isSubtype(b, 'string') &&
      isSubtype(b, INDEXED_COLLECTION_SHAPE_TYPE)
    )
      arms.push(b);
    else return undefined;
  }
  if (!absent || arms.length === 0) return undefined;
  return arms.length === 1 ? arms[0] : widen(...arms);
}

/** `v` with a gated collection type (`gatedCollectionPresentType`) replaced
 * by its present part. Every other fact is read from `v`. */
function presentView(v: BroadcastOperandView): BroadcastOperandView {
  const present = gatedCollectionPresentType(v.type);
  if (present === undefined) return v;
  return {
    type: present,
    get isSymbol() {
      return v.isSymbol;
    },
    get isApplication() {
      return v.isApplication;
    },
    get declaredTopSymbol() {
      return v.declaredTopSymbol;
    },
    get topTypedBlockLocal() {
      return v.topTypedBlockLocal;
    },
    get isCollection() {
      return v.isCollection;
    },
    get finiteBroadcastParticipant() {
      return v.finiteBroadcastParticipant;
    },
    get tuple() {
      return v.tuple;
    },
    get textAtom() {
      return v.textAtom;
    },
    get tensorShape() {
      return v.tensorShape;
    },
    get matrixFact() {
      return v.matrixFact;
    },
    typeIsUnknown: false,
    get holdsUnindexedCollection() {
      return v.holdsUnindexedCollection;
    },
  };
}

/** Whether `t` has a top-level `missing` arm: the whole value can be absent. */
function hasTopLevelMissing(t: Type): boolean {
  const r = resolveTypeAlias(t);
  if (r === 'missing') return true;
  return (
    typeof r !== 'string' &&
    r.kind === 'union' &&
    r.types.some((m) => resolveTypeAlias(m) === 'missing')
  );
}

/**
 * The operators whose result cell for an ABSENT cell of a collection operand
 * is `Missing`, whatever the type of the cell: the point-coordinate
 * accessors. They read the coordinate of each point of a list of points,
 * and the coordinate of an absent point (`Missing`, the masked cell of a
 * restriction whose condition is false) is itself `Missing`, as the masked
 * cell of a list is (`docs/ERROR-MODEL.md`: a masked list cell is `Missing`
 * and the list is typed `list<T | missing>`). The operators that COMPUTE a
 * number from each point (`Distance`, `Norm`, `Dot`) answer the numeric
 * marker `NaN` there instead, which the numeric absorption of
 * `absorbOperandAbsence` describes.
 */
export const ABSENT_CELLS_STAY_MISSING: ReadonlySet<string> = new Set([
  'PointX',
  'PointY',
  'PointZ',
]);

/**
 * The collection operators that do not compute a value from a cell
 * themselves: they reorder, select or index the cells of their collection operand (`Sort`,
 * `Reverse`, `Take`, `Filter`, …), put a new cell in among them (`Insert`,
 * `ReplaceAt`, `Append`), join or regroup the cells of their operands
 * (`Join`, `ListJoin`, `Partition`, `Zip`, `Union`, …), convert the kind of
 * the collection (`ListFrom`, `SetFrom`), answer one of the cells (`Find`,
 * `MaxBy`), answer positions (`Ordering`, `IndexOf`, `IndexWhere`,
 * `Position`, `ArgMax`), count cells (`Tally`, `Count`, `CountIf`), or test
 * that a cell is there (`Contains`). `Map` is here too, although it calls a
 * function on each cell: it gives the cell as it is to the function, and
 * what the function answers for that cell decides the result cell
 * (`Map(x ↦ x, L)` keeps an absent cell, `Map(x ↦ x + 1, L)` answers `NaN`
 * for it). An operator in this set that calls a function on a cell gets no
 * numeric absorption from the framework, so its `type` handler must widen
 * a result that it reads from a declared function type, which says nothing
 * about an absent cell (`withDeclaredCallbackAbsence`,
 * `library/collections.ts`: `Map(Sqrt, L)` is `list<number>`). An absent cell
 * does not make their answer absent: `IndexOf([1, Missing], 2)`
 * is `0`, typed `integer`, not `number`. An absent cell of
 * the operand (`[3, Missing, 1]`, typed `list<integer | missing>`) is then
 * an ordinary cell: it goes into the result as it is, or it only takes a
 * position in the order. `Sort([3, Missing, 1])` is `[1, 3, Missing]`.
 *
 * For these operators, an operand whose `missing` arm is only in its cells
 * is typed as it is (see `passesAbsentCellsThrough`). Its type binds the type
 * variables of the signature with the `missing` arm, so `Sort` of that list
 * is typed `list<integer | missing>`, and the numeric absorption of
 * `absorbOperandAbsence` is not applied, so `Ordering` of that list stays
 * `list<integer>`. Before, the operand gave no binding and the numeric
 * absorption applied: `Sort` was typed `list<unknown>`, `Reverse` `list` and
 * `Ordering` `list<number>`. A `type` handler gets the operand with the
 * `missing` arm too: before, `Join` and `ListJoin` got `list<integer | nan>`
 * for that list, and `Join(L, [2])` was typed `list<number>` although its
 * value holds the absent cell.
 *
 * An operand that can be absent AS A WHOLE (`Sort(Missing)`, a restricted
 * list) is not changed: the absence gate answers `Missing` for it.
 */
const ABSENT_CELLS_PASS_THROUGH: ReadonlySet<string> = new Set([
  'Sort',
  'Ordering',
  'Reverse',
  'Take',
  'Drop',
  'Rest',
  'Most',
  'Unique',
  'Dedup',
  'RandomShuffle',
  'RotateLeft',
  'RotateRight',
  'Cycle',
  'Filter',
  'TakeWhile',
  'DropWhile',
  'Slice',
  'Tally',
  'Insert',
  'ReplaceAt',
  'DeleteAt',
  'Append',
  'Join',
  'ListJoin',
  'Partition',
  'Chunk',
  'ChunkBy',
  'GroupBy',
  'Zip',
  'ListFrom',
  'SetFrom',
  'TupleFrom',
  'DictionaryFrom',
  'Values',
  'Union',
  'Intersection',
  'SetMinus',
  'Complement',
  'SymmetricDifference',
  'Map',
  'FlatMap',
  'Find',
  'MaxBy',
  'MinBy',
  'Contains',
  'IndexOf',
  'IndexWhere',
  'Position',
  'ArgMax',
  'ArgMin',
  'Count',
  'CountIf',
]);

/**
 * The collection operators whose `type` handler reads the absent cells of
 * the collection operand itself. `Reduce` computes from its cells, but with
 * no initial value it returns its only element unchanged
 * (`Reduce([Missing], Max)` is `Missing`), so its handler must see the
 * `missing` arm of the cells to put it in the result type. The handler also
 * does the numeric widening that the absorption of `absorbOperandAbsence`
 * does for the other operands.
 */
const ABSENT_CELLS_READ_BY_HANDLER: ReadonlySet<string> = new Set(['Reduce']);

/**
 * True when `operator` is one of the operators of
 * `ABSENT_CELLS_PASS_THROUGH` or `ABSENT_CELLS_READ_BY_HANDLER`, and an
 * operand of type `t` is absent only in its cells: `t` has a `missing` arm,
 * but not at the top level. Such an operand is typed as it is: its `missing`
 * arm is not stripped before the type variables are bound, and it does not
 * start the absorption of `absorbOperandAbsence`.
 */
export function passesAbsentCellsThrough(operator: string, t: Type): boolean {
  return (
    (ABSENT_CELLS_PASS_THROUGH.has(operator) ||
      ABSENT_CELLS_READ_BY_HANDLER.has(operator)) &&
    typeContainsMissing(t) &&
    !hasTopLevelMissing(t)
  );
}

/**
 * The present type of an operand of type `t` that can be absent as a whole,
 * at an operator of `ABSENT_CELLS_PASS_THROUGH` or
 * `ABSENT_CELLS_READ_BY_HANDLER`; `undefined` for any other operand or
 * operator. The caller asks only at a position that strips `missing` of an
 * operator that propagates absence.
 *
 * The present type is `t` without its top-level `missing` arm, with any
 * absent cells kept: `missing | list<integer | missing>` gives
 * `list<integer | missing>`, `missing | tuple<integer, missing>` gives
 * `tuple<integer, missing>`, and `missing | list<integer>` (or a restricted
 * list, `missing | vector<integer^2>`) gives the list. When the operand is
 * present, such an operator moves its cells into the result as they are,
 * exactly as for an operand that is absent only in its cells
 * (`passesAbsentCellsThrough`). So the type variables are bound from the
 * present type and the `type` handler is given the present type. The whole
 * absence is then added by the absorption of `absorbOperandAbsence`, as for
 * any operand that can be absent as a whole. Without this, the absent cells
 * were read as `NaN` and the operand bound no type variable: `Dedup(v)` with
 * `v: missing | list<integer | missing>` holding `[1, Missing]` was typed
 * `list<number> | missing`, and `Sort(v)` was typed `list<unknown> |
 * missing`, a type that does not hold the value.
 */
export function absentCellsPresentType(
  operator: string,
  t: Type
): Type | undefined {
  if (!movesAbsentCells(operator)) return undefined;
  if (!hasTopLevelMissing(t)) return undefined;
  const present = stripTopMissing(t);
  if (present === 'never') return undefined;
  // A structural alias is replaced by its definition (`missing | P`, with
  // `P` an alias of `tuple<integer, missing>`, gives the tuple), so that the
  // present type binds the type variables as its definition does.
  return resolveTypeAlias(present);
}

/**
 * True when `operator` is one of the operators of `ABSENT_CELLS_PASS_THROUGH`
 * or `ABSENT_CELLS_READ_BY_HANDLER`: the operators that move the cells of a
 * collection operand into their result without computing from them. A cheap
 * test, to ask before any walk of an operand type.
 */
export function movesAbsentCells(operator: string): boolean {
  return (
    ABSENT_CELLS_PASS_THROUGH.has(operator) ||
    ABSENT_CELLS_READ_BY_HANDLER.has(operator)
  );
}

/**
 * `absorbed`, the result type `result` after `absorbOperandAbsence`, with
 * the `missing` arm of `result` put back when the absorption removed it.
 *
 * For an application with an operand typed from its present type
 * (`absentCellsPresentType`), a `missing` arm of the result comes from an
 * absent cell that the operator answers as it is: `MaxBy` over
 * `[1, Missing]` can answer `Missing`. The absorption reads a numeric result
 * as `NaN` for the whole absence of the operand (`MaxBy(Missing, f)` is
 * `NaN`), and in doing so drops that arm: the result was typed `number`.
 * Both answers are possible, so the type is `number | missing`.
 */
export function withPresentCellAbsence(result: Type, absorbed: Type): Type {
  if (!provablyAdmits('missing', result) || provablyAdmits('missing', absorbed))
    return absorbed;
  return widen('missing', absorbed);
}

/**
 * The type of a THREADED operand without its top-level `missing` arm, or
 * `undefined` when it has none (or has nothing else).
 *
 * An operator that threads conditional values at a position (the
 * `threadsConditionals` flag of `types-definitions.ts`) applies itself to
 * the value of a restriction and moves the condition out: `f(When(v, c))` is
 * `When(f(v), c)`. Its type handler must then see the operand as the value
 * it is applied to, without the absent case (a restriction is typed
 * `missing | T`), and the absent case goes to the result. A `handle`
 * operator answers the absence marker of its result when the operand is
 * absent, so its result type gains the arm of that marker
 * (`withThreadedAbsence`). A `propagate` operator strips the arm with its
 * own machinery (`absorbOperandAbsence`).
 */
export function threadedPresentType(t: Type): Type | undefined {
  if (!hasTopLevelMissing(t)) return undefined;
  const present = stripTopMissing(t);
  return present === 'never' ? undefined : present;
}

/**
 * `t` with the absence arm of an application whose threaded operand can be
 * absent (`threadedPresentType`). The empty type and the error type are
 * kept as they are: they say the application has no value at all.
 *
 * The arm is the absence marker of the result's domain: `nan` when `t`,
 * less its `missing` arm, is a subtype of `number`, and `missing`
 * otherwise. An element read of an absent collection answers that marker
 * (user decision of 2026-09-26, `docs/ERROR-MODEL.md` §2): `First` of a
 * restricted pair of integers whose condition is false is `NaN`, typed
 * `integer | nan`, and `First` of a restricted list of points is `Missing`,
 * typed `missing | tuple<…>`. The evaluate handler reads the same marker
 * from this type (`absentScalarMarker()`, `validate.ts`).
 */
export function withThreadedAbsence(t: Type): Type {
  if (t === 'never' || t === 'error') return t;
  // `unknown` says nothing about the result yet, and `widen` treats it as
  // the empty case: `widen('missing', 'unknown')` is `missing`, which claims
  // the application is always absent. `At(At(m, 1), 2)` with `m` valueless
  // was typed `missing`, and the use of the result as a number then
  // inferred `m`'s elements as `real` instead of `number`. The result stays
  // `unknown`, which admits the absent case.
  if (t === 'unknown' || t === 'any') return t;
  // The arms are joined with `reduceType`, not with `widen`: widening climbs
  // the numeric ladder and answers a bare `number` for `integer ⊔ nan`,
  // which loses the element tier.
  const present = stripMissingFromType(t);
  if (present !== 'never' && isSubtype(present, 'number'))
    return reduceType({ kind: 'union', types: [t, 'nan'] });
  return widen('missing', t);
}

/** Whether `t` is a collection that is not a tuple and not a string: an
 * operand beside which an absent scalar broadcasts cell by cell. */
function isCellCollectionType(t: Type): boolean {
  return (
    isSubtype(t, COLLECTION_SHAPE_TYPE) &&
    !isSubtype(t, 'string') &&
    !isTupleShapedType(t)
  );
}

/**
 * The result type of a `propagate` application, adjusted for its operands
 * that can be absent (their type has a `missing` arm, at any depth). `t` is
 * the result the type handler, the signature or the broadcast lift computed
 * for the present operands.
 *
 * At run time, an operand that evaluates to `Missing` beside operands that
 * are not collections makes the whole application answer the codomain
 * marker of its own type (`absentScalarMarker()` in `validate.ts`): `NaN`
 * when the type, less its `missing` arm, is numeric, and `Missing`
 * otherwise. So when a whole-value absence reaches a result that is not
 * numeric, the type must keep a `missing` arm, or the marker is computed
 * from a type that says the value is always present. This function adds
 * the arm when an operand can be absent as a whole (a top-level `missing`
 * arm), no other operand is a collection that is not a tuple, and the
 * result, less its `missing` arm, is not a subtype of `number`. Examples:
 *
 * - A GATED collection operand (`gatedCollectionPresentType`: a restricted
 *   point or list). `Sin(When((0, 1), c))` is
 *   `missing | tuple<number, number>` and answers `Missing` when `c` is
 *   false; `Sin(When([1, 2, 3], c))` is `missing | list<number>` (the
 *   operand is `missing | list<integer | missing>`, absent as a whole or
 *   cell by cell, and both absences are absorbed).
 * - A point result. `2{c} · (0, 1)` is `missing | tuple<…>`, because an
 *   absent factor beside a point makes the whole point absent
 *   (`docs/ERROR-MODEL.md`, the section on `Missing` in a numeric slot).
 * - A result that is a number OR a collection. With `PointX(V)` typed
 *   `list<number> | missing | number | tuple<number, number>`,
 *   `PointX(V)^2` is `list<number> | missing | number`: when `PointX(V)` is
 *   `Missing` the application answers `Missing`, because its type is not
 *   provably numeric.
 *
 * The exception for an operand beside a list, for a BROADCASTABLE operator
 * (`broadcastable`): the absence broadcasts over the list's cells
 * (`[1, 2, 3] + 2{c}` is `[NaN, NaN, NaN]` when `c` is false). An operator
 * that threads its conditional operands whole, such as `Dot`, answers
 * `Missing` for an absent operand beside a list and keeps the `missing` arm.
 *
 * Every other absence takes the numeric absorption (`absorbNumericAbsence`):
 * every `missing` arm is removed and every numeric cell widens to `number`,
 * because an absent numeric cell contributes `NaN`. That is the case for a
 * `missing` cell inside a collection operand (`list<integer | missing>`), for
 * an absent operand beside a list, and for a numeric result
 * (`Sin(2{c})` is `number`).
 *
 * One exception to the numeric absorption: a result cell that is a POINT.
 * When an absence can replace a whole cell of an operand (a `missing` cell
 * in a list, or an absent operand beside a list) and the result is a
 * collection of points, an absent cell makes its point absent, so the cell
 * answers `Missing` and its type keeps a `missing` arm
 * (`withAbsentPointCells`): `Sin([P{c}, (2, 3)])` and `2 · [P{c}, (2, 3)]`
 * are `list<missing | tuple<…>>`. An absence inside a point's coordinate
 * (`tuple<integer | missing, integer>`) does not make the point absent.
 *
 * `absentCellsStayMissing` extends that exception to every result cell,
 * numeric ones included, for an operator that READS each cell rather than
 * computing a number from it (`ABSENT_CELLS_STAY_MISSING`): the coordinate
 * of an absent point of a list is `Missing`, as the masked cell is, so
 * `PointY([P{c}, (3, 4)])` is `list<number | missing>`. For such an
 * operator, an absent coordinate of a point (`tuple<integer, missing>`) is
 * not absorbed at all: the coordinate is read as it is, so
 * `PointY((1, Missing))` is typed `missing`.
 */
export function absorbOperandAbsence(
  t: Type,
  operandTypes: ReadonlyArray<Type>,
  absentCellsStayMissing = false,
  broadcastable = true
): Type {
  let cells = false;
  let wholeCells = false;
  let absentCell = false;
  let whole = false;
  let notNumeric: boolean | undefined;
  // The depths at which an operand has an absent cell (1 for the cells of
  // the operand, 2 for the cells of those cells), one set per operand, read
  // by `withAbsentCellMarkers` below.
  const absentDepths: Array<Set<number> | undefined> = [];
  for (let i = 0; i < operandTypes.length; i++) {
    const ot = operandTypes[i];
    if (!typeContainsMissing(ot)) continue;
    const wholeAbsence = hasTopLevelMissing(ot);
    const present = wholeAbsence ? stripTopMissing(ot) : ot;
    const depths = new Set<number>();
    collectAbsentCellDepths(present, 0, depths);
    if (depths.size > 0) absentDepths[i] = depths;
    // Absent CELLS (`list<T | missing>`). An operand can carry both kinds
    // of absence, `missing | list<T | missing>` — a symbol declared with
    // that type, or a list of restricted cells that may itself be absent —
    // and both readings must count: reading the cells only lost the
    // whole-absence arm, so such an operand under `Sin` was typed
    // `list<number>` while it answers `Missing` when it is absent as a
    // whole. (A restricted list, `[1, 2]{c}`, is typed
    // `missing | vector<integer^2>`, whole absence only: it stays one held
    // `When` while its condition is undecided.)
    //
    // An absent COORDINATE (a `missing` component of a tuple) is not
    // absorbed for an operator that reads coordinates
    // (`absentCellsStayMissing`): its handler saw the component as it is and
    // typed the coordinate it answers, `Missing` included.
    if (typeContainsMissing(present)) {
      if (missingOutsideTuples(present)) {
        cells = true;
        wholeCells = true;
        absentCell = true;
      } else if (!absentCellsStayMissing) cells = true;
    }
    if (!wholeAbsence) continue;
    notNumeric ??= !isSubtype(stripMissingFromType(t), 'number');
    // Only a BROADCASTABLE operator spreads an absent operand over the cells
    // of a list beside it (`[1, 2, 3] + 2{c}` is `[NaN, NaN, NaN]`). An
    // operator that threads its conditional operands whole (`Dot`, a
    // `threadsConditionals` operator) computes on the present value and
    // answers `Missing` for an absent one, whatever stands beside it:
    // `Dot([P, Q]{c}, [R, S])` is `Missing` when `c` is false, so its type
    // keeps the `missing` arm.
    const besideCollection =
      broadcastable &&
      operandTypes.some(
        (other, j) =>
          j !== i &&
          isCellCollectionType(other) &&
          gatedCollectionPresentType(other) === undefined
      );
    if (!besideCollection && notNumeric) whole = true;
    else {
      cells = true;
      wholeCells = true;
    }
  }
  let result = cells ? absorbNumericAbsence(t) : t;
  if (wholeCells) result = withAbsentPointCells(result, absentCellsStayMissing);
  // An absent cell whose result cell is a collection (the `Missing` row of
  // `[[1, 2], Missing] + 1`) is not a numeric leaf, so the absorption above
  // does not describe it: the element-wise kernel answers `NaN` for it, or
  // `Missing` when the cells of the result are points
  // (`absentCellsArePoints`). The result cell at that depth gains the arm of
  // that marker. An absent cell that meets a row of another operand is not
  // marked: the kernel maps the absence over that row
  // (`[[1, 2], Missing] + [[1, 2], [3, 4]]` is `[[2, 4], [NaN, NaN]]`), and
  // the absorption above already gave the leaves of that row their marker.
  if (absentDepths.length > 0 && broadcastable && !absentCellsStayMissing) {
    const marked = new Set<number>();
    absentDepths.forEach((depths, i) => {
      if (depths === undefined) return;
      for (const d of depths)
        if (
          !operandTypes.some(
            (other, j) => j !== i && definiteRowDepths(other).has(d)
          )
        )
          marked.add(d);
    });
    if (marked.size > 0)
      result = withAbsentCellMarkers(
        result,
        marked,
        absentCellsArePoints(result) ? 'missing' : 'nan'
      );
  }
  // An operator that reads cells and answers ONE of them (`PointY([1,
  // Missing])` reads the flat point `[1, Missing]` and answers its second
  // cell) answers `Missing` when that cell is absent, so a result that is not
  // provably a collection keeps a `missing` arm too. This is for an absent
  // CELL of an operand only: an operand absent as a whole (`PointX(Missing)`)
  // is answered `NaN` by the absence gate.
  if (
    absentCell &&
    absentCellsStayMissing &&
    !isSubtype(result, COLLECTION_SHAPE_TYPE)
  )
    result = withMissingArm(result);
  if (!whole) return result;
  if (isSubtype(stripMissingFromType(result), 'number'))
    return absorbNumericAbsence(result);
  return withMissingArm(result);
}

/**
 * `t` with a `missing` arm. The general join `widen` ignores an `unknown`
 * operand (`widen('unknown', 'integer')` is `integer`), so
 * `widen('missing', 'unknown')` is `missing`, which says that the value is
 * always absent. For a result typed `unknown` the union is kept as it is:
 * `PointX(q)` with `q: missing | unknown` is typed `missing | unknown`, and
 * its value is a coordinate when `q` holds a point.
 */
function withMissingArm(t: Type): Type {
  return resolveTypeAlias(t) === 'unknown'
    ? reduceType({ kind: 'union', types: ['missing', t] })
    : widen('missing', t);
}

/** Whether `t` has a `missing` arm that can stand for a whole value or a
 * whole collection cell. A `missing` arm inside a tuple component is an
 * absent coordinate, not an absent cell, and does not count. */
function missingOutsideTuples(t: Type, seen?: AliasDescent): boolean {
  // The alias unfolds under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias (`type alias cyc = cyc | tuple<number, number>`)
  // stops when it reaches itself again, and that occurrence contributes no
  // members (`false`, the neutral answer for "some part has a `missing`
  // arm"). Without the guard the walk overflows the stack.
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  const r = unfolded.type;
  const walk = (x: Type) => missingOutsideTuples(x, unfolded.seen);
  if (r === 'missing') return true;
  if (typeof r === 'string') return false;
  switch (r.kind) {
    case 'union':
    case 'intersection':
      return r.types.some(walk);
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return walk(r.elements);
    default:
      return false;
  }
}

/**
 * `t` with a `missing` arm added to every collection cell whose type is a
 * point: a cell whose every arm, less `missing`, is a tuple. An absent operand
 * cell makes such a result cell absent, and an absent point is `Missing`
 * (`docs/ERROR-MODEL.md`, the section on `Missing` in a numeric slot).
 * `list<tuple<number, number>>` becomes
 * `list<missing | tuple<number, number>>`. A numeric cell, a whole tuple
 * that is not in a collection, and a cell with a non-tuple arm are kept as
 * they are.
 */
function withAbsentPointCells(
  t: Type,
  anyCell = false,
  seen?: AliasDescent
): Type {
  // The alias unfolds under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias stops when it reaches itself again. Without the
  // guard the walk overflows the stack. What the occurrence gives depends on
  // how it was reached:
  // - as a bare arm of its own union, with no constructor entered since the
  //   alias was last unfolded (`type alias cyc = cyc | tuple<number, number>
  //   | missing`), it adds no value of its own: it is returned unchanged, and
  //   the other arms, which are rewritten, hold every value;
  // - through a constructor (the inner `pts` of `type alias pts =
  //   list<pts> | list<tuple<number, number>>`), it stands for deeper cells,
  //   which this walk has not given their `missing` arm. Unchanged, it would
  //   claim those cells are present, so it gives `any`, which admits an
  //   absent cell at any depth.
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return isBareCutOnDescent(t, seen) ? t : 'any';
  const r = unfolded.type;
  if (typeof r === 'string') return t;
  switch (r.kind) {
    case 'union': {
      const arms = r.types.map((x) =>
        withAbsentPointCells(x, anyCell, unfolded.seen)
      );
      if (arms.every((x, i) => x === r.types[i])) return t;
      return widen(...arms);
    }
    case 'list':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable': {
      const cell = r.elements;
      if (isCellListKind(resolveTypeAlias(cell))) {
        const inner = withAbsentPointCells(
          cell,
          anyCell,
          descendIntoConstructor(unfolded.seen)
        );
        return inner === cell ? t : withCellType(r, inner);
      }
      return anyCell || isPointCellType(cell)
        ? withCellType(r, widen('missing', cell))
        : t;
    }
    default:
      return t;
  }
}

/** Whether every arm of `t`, less its `missing` arm, is a tuple. */
function isPointCellType(t: Type): boolean {
  const r = resolveTypeAlias(t);
  // The bare `tuple` is a point of no stated arity.
  if (r === 'tuple') return true;
  if (typeof r === 'string') return false;
  if (r.kind === 'tuple') return true;
  if (r.kind !== 'union') return false;
  let tuple = false;
  for (const arm of r.types) {
    const a = resolveTypeAlias(arm);
    if (a === 'missing') continue;
    if (a === 'tuple') {
      tuple = true;
      continue;
    }
    if (typeof a === 'string' || a.kind !== 'tuple') return false;
    tuple = true;
  }
  return tuple;
}

/** The list kinds whose `elements` are the cells of a broadcast. */
function isCellListKind(
  t: Type
): t is ListType | CollectionType | BroadcastableType {
  return (
    typeof t !== 'string' &&
    (t.kind === 'list' ||
      t.kind === 'collection' ||
      t.kind === 'indexed_collection' ||
      t.kind === 'broadcastable')
  );
}

/**
 * Add to `out` each depth at which `t` has a `missing` arm outside a tuple:
 * 1 for an absent cell of `t` (`list<list<integer> | missing>`), 2 for an
 * absent cell of a cell (`list<list<integer | missing>>`), and so on. A
 * `missing` component of a tuple is an absent coordinate, not an absent
 * cell, and is not read. A dimensioned list (`matrix<integer^(2x3)>`) holds its
 * leaf cells at the depth of its rank. The walk reads the same kinds as
 * `missingOutsideTuples`.
 *
 * A self-referential alias unfolds under the descent guard. Its occurrence
 * as a bare arm of its own union, with no constructor entered since it was
 * last unfolded, adds no value of its own, so it adds no depth. Reached
 * through a constructor, it stands for deeper cells that can be absent at
 * any depth, so every remaining depth is added.
 */
function collectAbsentCellDepths(
  t: Type,
  depth: number,
  out: Set<number>,
  seen?: AliasDescent
): void {
  if (depth > MAX_CELL_DEPTH) return;
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) {
    if (isBareCutOnDescent(t, seen)) return;
    for (let d = Math.max(depth, 1); d <= MAX_CELL_DEPTH; d++) out.add(d);
    return;
  }
  const r = unfolded.type;
  if (r === 'missing') {
    if (depth > 0) out.add(depth);
    return;
  }
  if (typeof r === 'string') return;
  if (r.kind === 'union' || r.kind === 'intersection') {
    for (const arm of r.types)
      collectAbsentCellDepths(arm, depth, out, unfolded.seen);
    return;
  }
  if (!isCellListKind(r) && r.kind !== 'set') return;
  collectAbsentCellDepths(
    r.elements,
    depth + collectionLevels(r),
    out,
    descendIntoConstructor(unfolded.seen)
  );
}

/**
 * The depths at which every cell of `t` is a collection: 1 when the cells
 * of `t` are lists, 2 when their cells are lists too, and so on
 * (`list<list<integer>>` and `matrix<2x2>` give `{1}`). The walk follows
 * the chain of list types and stops at the first cell that is not one, a
 * union included. An operand that can be absent as a whole has no such
 * depth.
 */
function definiteRowDepths(t: Type): Set<number> {
  const out = new Set<number>();
  let x = resolveTypeAlias(t);
  let depth = 0;
  for (let k = 0; k <= MAX_CELL_DEPTH && isCellListKind(x); k++) {
    const levels = collectionLevels(x);
    // The cells of a dimensioned list above its leaves are rows.
    for (let d = depth + 1; d < depth + levels; d++) out.add(d);
    depth += levels;
    const cell = resolveTypeAlias(x.elements);
    if (isCellListKind(cell)) out.add(depth);
    x = cell;
  }
  return out;
}

/** Whether `t` is the type of a point that can be absent: a union with a
 * `missing` arm whose other arms are all tuples (the bare `tuple` included,
 * a point of no stated arity). */
function isAbsentPointCellType(t: Type): boolean {
  const r = resolveTypeAlias(t);
  if (typeof r === 'string' || r.kind !== 'union') return false;
  return (
    r.types.some((a) => resolveTypeAlias(a) === 'missing') && isPointCellType(r)
  );
}

/**
 * Whether the leaf cells of the cell type `t` are points that can be absent
 * (`missing | tuple<…>`). The walk goes down through nested lists, and
 * through a row that can be absent (a union of ONE list arm and `missing`
 * arms, `list<missing | tuple<…>> | missing`), which is read as its list
 * arm. An alias unfolds under the descent guard; at a cut the answer is
 * `false`.
 */
function hasAbsentPointLeaves(t: Type): boolean {
  let cell: Type = t;
  let seen: AliasDescent | undefined;
  for (let d = 0; d <= MAX_CELL_DEPTH; d++) {
    const unfolded = unfoldAliasOnDescent(cell, seen);
    if (unfolded === undefined) return false;
    let r = unfolded.type;
    seen = unfolded.seen;
    if (typeof r !== 'string' && r.kind === 'union') {
      let row: Type | undefined;
      let rowSeen: AliasDescent | undefined;
      let onlyRow = true;
      for (const arm of r.types) {
        const a = unfoldAliasOnDescent(arm, seen);
        if (a === undefined) return false;
        if (a.type === 'missing') continue;
        if (row !== undefined || !isCellListKind(a.type)) {
          onlyRow = false;
          break;
        }
        row = a.type;
        rowSeen = a.seen;
      }
      if (onlyRow && row !== undefined) {
        r = row;
        seen = rowSeen;
      }
    }
    if (!isCellListKind(r)) return isAbsentPointCellType(r);
    cell = r.elements;
    seen = descendIntoConstructor(seen);
  }
  return false;
}

/**
 * Whether the element-wise kernel answers `Missing`, not `NaN`, for an
 * absent cell of a list whose type is `t`: the leaf cells are points that
 * can be absent (`hasAbsentPointLeaves`), and an absent point is `Missing`
 * (`docs/ERROR-MODEL.md`, the section on `Missing` in a numeric slot). For a
 * union type, every list arm must have such leaves, since the value can be
 * a list of any arm; the other arms (a `missing` arm, a scalar) do not hold
 * a list. `markAbsentPointCells` (`validate.ts`) replaces the `NaN` cells of
 * a list value by this predicate, and `absorbOperandAbsence` chooses the
 * marker of an absent cell by it, so the two cannot disagree.
 */
export function absentCellsArePoints(t: Type): boolean {
  const unfolded = unfoldAliasOnDescent(t, undefined);
  if (unfolded === undefined) return false;
  const r = unfolded.type;
  if (isCellListKind(r)) return hasAbsentPointLeaves(r.elements);
  if (typeof r === 'string' || r.kind !== 'union') return false;
  let list = false;
  for (const arm of r.types) {
    const a = resolveTypeAlias(arm);
    if (!isCellListKind(a)) continue;
    if (!hasAbsentPointLeaves(a.elements)) return false;
    list = true;
  }
  return list;
}

/**
 * `t` with the absence marker `marker` added to each cell at a depth of
 * `depths` (`collectAbsentCellDepths`) that does not admit it. An absent
 * operand cell gives an absent result cell, and the element-wise kernel
 * answers `NaN` for it (`[[1, 2], Missing] + 1` is `[[2, 3], NaN]`), or
 * `Missing` when the cells of the result are points (`absentCellsArePoints`).
 * A numeric cell (`number`) already admits `NaN`, and a point cell already
 * has its `missing` arm (`withAbsentPointCells`); a collection cell had
 * neither, so `list<list<integer> | missing> + 1` was typed
 * `list<list<number>>`. With the marker it is `list<list<number> | nan>`.
 *
 * A dimensioned list type keeps its cells in one `elements` type
 * (`matrix` is `matrix<number^(?x?)>`): when a marker falls on an inner
 * depth, the list is written one level at a time, so the row can carry it
 * (`list<list<number> | nan>`). The walk unfolds an alias under the descent
 * guard, and keeps a cut as it is.
 */
function withAbsentCellMarkers(
  t: Type,
  depths: ReadonlySet<number>,
  marker: 'nan' | 'missing',
  depth = 0,
  seen?: AliasDescent
): Type {
  if (depth >= MAX_CELL_DEPTH) return t;
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return t;
  const r = unfolded.type;
  if (typeof r === 'string') return t;
  if (r.kind === 'union') {
    const arms = r.types.map((x) =>
      withAbsentCellMarkers(x, depths, marker, depth, unfolded.seen)
    );
    if (arms.every((x, i) => x === r.types[i])) return t;
    return { kind: 'union', types: arms };
  }
  if (!isCellListKind(r)) return t;
  const levels = collectionLevels(r);
  // A dimensioned list with a marker at one of its inner depths is written
  // as a list of rows, one level at a time.
  let list: ListType | CollectionType | BroadcastableType = r;
  // A tensor of unknown rank (`dimensions` is `null`) has one level here
  // (`collectionLevels`): its cells take the marker as the cells of a plain
  // list do, and the type stays a tensor of unknown rank
  // (`tensor<number | nan>`).
  if (levels > 1 && r.kind === 'list' && r.dimensions) {
    let inner = false;
    for (let d = depth + 1; d < depth + levels; d++)
      if (depths.has(d)) inner = true;
    if (inner) {
      const [outer, ...rest] = r.dimensions;
      // An open length of rank 1 (`[-1]`) adds nothing to a plain list.
      const row: ListType =
        rest.length === 1 && rest[0] === -1
          ? { kind: 'list', elements: r.elements }
          : { kind: 'list', elements: r.elements, dimensions: rest };
      list = {
        kind: 'list',
        elements: row,
        ...(outer === -1 ? {} : { dimensions: [outer] }),
      };
    }
  }
  const cellDepth = depth + collectionLevels(list);
  let cell = withAbsentCellMarkers(
    list.elements,
    depths,
    marker,
    cellDepth,
    descendIntoConstructor(unfolded.seen)
  );
  if (depths.has(cellDepth) && !isSubtype(marker, cell)) {
    const c = resolveTypeAlias(cell);
    cell =
      typeof c !== 'string' && c.kind === 'union'
        ? { kind: 'union', types: [...c.types, marker] }
        : { kind: 'union', types: [cell, marker] };
  }
  if (cell === list.elements) return list === r ? t : list;
  return withCellType(list, cell);
}

/** `t` without its top-level `missing` arm (cells are kept as they are). */
function stripTopMissing(t: Type): Type {
  const r = resolveTypeAlias(t);
  if (r === 'missing') return 'never';
  if (typeof r === 'string' || r.kind !== 'union') return r;
  const arms = r.types.filter((m) => resolveTypeAlias(m) !== 'missing');
  if (arms.length === 0) return 'never';
  return arms.length === 1 ? arms[0] : widen(...arms);
}

/**
 * Whether an operator's declared broadcast exemptions stand this application
 * down from the element-wise lift: a `'tensors'` operator over a tensor, a
 * `'tuples'` operator over a tuple, a `'whole-collection-compare'` operator
 * over two or more collections, a `'single-collection-join'` operator over
 * its one collection.
 */
export function skipBroadcastForVectorOpsOnViews(
  def: BoxedOperatorDefinition | undefined,
  hasTensors: boolean,
  views: ReadonlyArray<BroadcastOperandView>
): boolean {
  const exemptions = def?.broadcastExemptions;
  if (exemptions === undefined || exemptions.length === 0) return false;
  const exempt = (label: BroadcastExemption) => exemptions.includes(label);

  if (exempt('tensors')) {
    if (hasTensors) return true;
    if (views.some((v) => v.type !== 'never' && v.matrixFact)) return true;
  }

  if (exempt('tuples') && views.some((v) => v.tuple)) return true;

  if (
    exempt('whole-collection-compare') &&
    views.filter(
      (v) =>
        !v.textAtom &&
        (v.isCollection ||
          isPossiblyCollectionTypedView(v) ||
          matchesCollectionShape(v.type))
    ).length >= 2
  )
    return true;

  if (
    exempt('single-collection-join') &&
    views.length === 1 &&
    !views[0].textAtom &&
    (views[0].isCollection ||
      (!views[0].typeIsUnknown &&
        views[0].type !== 'any' &&
        views[0].type !== 'never' &&
        matchesCollectionShape(views[0].type)))
  )
    return true;
  return false;
}

/**
 * How many components the component-wise tuple broadcast of the operands
 * produces, read from their types, or `undefined` when the application does
 * not statically take that arm. `'unknown-components'` says the broadcast
 * happens but a tuple component is collection-shaped, so the per-component
 * types cannot be spelled and the wide bare `tuple` is claimed. See
 * `tupleBroadcastArity` in `boxed-function.ts` for the full contract.
 */
export function tupleBroadcastArityOnViews(
  views: ReadonlyArray<BroadcastOperandView>
): number | 'unknown-components' | undefined {
  let arity: number | undefined;
  let unknownComponents = false;
  let bareTuple = false;
  for (const v of views) {
    const t = resolveTypeAlias(v.type);
    if (!v.isSymbol && isNumericScalarType(t)) continue;
    if (t === 'tuple') {
      bareTuple = true;
      continue;
    }
    if (typeof t !== 'string' && t.kind === 'tuple') {
      if (t.elements.some((el) => isSubtype(el.type, COLLECTION_SHAPE_TYPE)))
        unknownComponents = true;
      if (arity === undefined) arity = t.elements.length;
      else if (t.elements.length !== arity) return undefined;
      continue;
    }
    if (
      v.finiteBroadcastParticipant ||
      isBroadcastCollectionTypeOf(v.type) ||
      isFixedShapeCollectionTypeOf(v.type) ||
      isPossiblyCollectionTypedView(v)
    )
      return undefined;
  }
  if (bareTuple) return 'unknown-components';
  if (arity === undefined || arity === 0) return undefined;
  return unknownComponents ? 'unknown-components' : arity;
}

/** The leaf arity of a point-list type: the tuple arity at the bottom of a
 * (nested) list type, with the nesting rank; `undefined` arity for a numeric
 * leaf (a scalar sibling); `null` when the type is not such a list. */
function pointLeafArity(
  t: Type,
  rank: number,
  seen?: AliasDescent
): { arity: number | undefined; rank: number } | null {
  // The alias unfolds under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias (`type alias cyc = cyc | list<integer>`,
  // `type alias nest = list<nest>`) stops when it reaches itself again.
  // Where the walk is cut it answers `null` (not a point list), except for a
  // union arm that reaches its own alias as a bare arm, with no constructor
  // entered since the alias was last unfolded: that arm is skipped, since
  // its values are those of the other arms. A cut reached through a list
  // element stands for deeper lists, whose rank this walk has not read, so
  // it keeps the answer `null`. Without the guard the walk overflows the
  // stack.
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return null;
  t = unfolded.type;
  seen = unfolded.seen;
  if (typeof t === 'string') return null;
  if (t.kind === 'union') {
    let result: { arity: number | undefined; rank: number } | null = null;
    for (const arm of t.types) {
      if (isBareCutOnDescent(arm, seen)) continue;
      // A `missing` arm is an absent cell (a restricted point inside a
      // list, `[P{c}, (2, 3)]`): it has no leaf of its own, and the cell
      // keeps the arity of the present arms. `absorbOperandAbsence` puts the
      // `missing` arm back on the result cell.
      const r = resolveTypeAlias(arm);
      if (r === 'missing') continue;
      // A tuple arm of a list CELL (`rank > 0`) is a point leaf, as a
      // tuple element is below. A number arm of a list cell is a number
      // leaf, as a number element is below: the cells of
      // `list<integer | missing>` are numbers or absent.
      const a =
        rank > 0 && typeof r !== 'string' && r.kind === 'tuple'
          ? tupleLeafArity(r, rank)
          : rank > 0 && r !== 'never' && isSubtype(r, 'number')
            ? { arity: undefined, rank }
            : pointLeafArity(arm, rank, seen);
      if (a === null) return null;
      if (result === null) result = a;
      else if (result.arity !== a.arity || result.rank !== a.rank) return null;
    }
    return result;
  }
  if (t.kind !== 'list' && t.kind !== 'indexed_collection') return null;
  // A tensor of unknown rank (`tensor<U>`, whose `dimensions` is `null`)
  // has no rank to count, so it is not a point list of a known rank.
  if (t.kind === 'list' && t.dimensions === null) return null;
  const dims = t.kind === 'list' ? (t.dimensions?.length ?? 1) : 1;
  const element = unfoldAliasOnDescent(
    t.elements,
    descendIntoConstructor(seen)
  );
  if (element === undefined) return null;
  const elt = element.type;
  if (typeof elt === 'string') {
    return isSubtype(elt, 'number')
      ? { arity: undefined, rank: rank + dims }
      : null;
  }
  if (
    elt.kind === 'list' ||
    elt.kind === 'indexed_collection' ||
    elt.kind === 'union'
  )
    return pointLeafArity(elt, rank + dims, element.seen);
  if (elt.kind === 'tuple') return tupleLeafArity(elt, rank + dims);
  // A numeric leaf that is an object type (a ranged number, `integer<2..3>`)
  // is a scalar sibling, as a primitive numeric leaf is above.
  return isSubtype(elt, 'number')
    ? { arity: undefined, rank: rank + dims }
    : null;
}

/** The point leaf of a tuple cell at nesting rank `rank`, or `null` when the
 * tuple is empty or has a component that could be a collection. */
function tupleLeafArity(
  t: TupleType,
  rank: number
): { arity: number; rank: number } | null {
  if (t.elements.length === 0) return null;
  if (t.elements.some((c) => typeCouldBeCollection(c.type))) return null;
  return { arity: t.elements.length, rank };
}

/** The tuple type at the bottom of a (nested) list type whose every level
 * has one element type (`list<list<tuple<integer, integer>>>` gives
 * `tuple<integer, integer>`), or `undefined` when `t` is not such a list. An
 * absent cell (a `missing` arm of an element) is not read: it has no point.
 * A union of other arms at any level gives `undefined`. The walk is bounded,
 * which also stops a self-referential alias. */
function pointLeafType(t: Type): TupleType | undefined {
  let x = resolveTypeAlias(t);
  for (let depth = 0; depth < 8; depth++) {
    if (typeof x === 'string') return undefined;
    if (x.kind !== 'list' && x.kind !== 'indexed_collection') return undefined;
    const element = resolveTypeAlias(
      stripMissingFromType(resolveTypeAlias(x.elements))
    );
    if (typeof element !== 'string' && element.kind === 'tuple')
      return element.elements.length === 0 ? undefined : element;
    x = element;
  }
  return undefined;
}

/** The common tuple arity of the point lists among the broadcasting operand
 * types, or `undefined` when they are not all point lists of one arity. A
 * scalar-leaf sibling (a collection of numbers) is admitted when its rank is
 * not higher than the rank of every point list: the broadcast then pairs
 * each point, or each row of points, with one number (`[[(1, 2)]]^[[2]]` is
 * `[[(1, 4)]]`, `[[(1, 2)]]^[2]` is `[[(1, 4)]]`), so each cell of the result
 * is a point. A collection of numbers deeper than a point list pairs a point
 * with a row of numbers (`pointsBesideDeeperNumbers`). */
export function pointListArityOfTypes(
  types: ReadonlyArray<Type>
): number | undefined {
  let arity: number | undefined = undefined;
  let pointRank = Infinity;
  let scalarRank = 0;
  for (const t of types) {
    const leaf = pointLeafArity(t, 0);
    if (leaf === null) return undefined;
    if (leaf.arity === undefined) {
      scalarRank = Math.max(scalarRank, leaf.rank);
      continue;
    }
    pointRank = Math.min(pointRank, leaf.rank);
    if (arity !== undefined && arity !== leaf.arity) return undefined;
    arity = leaf.arity;
  }
  if (arity === undefined) return undefined;
  if (scalarRank > pointRank) return undefined;
  return arity;
}

/** Whether, among the broadcasting operand types, a collection of numbers
 * is deeper than a list of points. The broadcast then pairs a point with a
 * row of numbers, and a head that maps over the components of a point maps
 * each component over that row: `[(1, 2)]^[[1, 2]]` is `[[1, 4]]`. The cells
 * of the result are numbers, at the rank of the deepest operand. */
function pointsBesideDeeperNumbers(types: ReadonlyArray<Type>): boolean {
  let pointRank = Infinity;
  let scalarRank = 0;
  for (const t of types) {
    const leaf = pointLeafArity(t, 0);
    if (leaf === null) return false;
    if (leaf.arity === undefined) scalarRank = Math.max(scalarRank, leaf.rank);
    else pointRank = Math.min(pointRank, leaf.rank);
  }
  return pointRank !== Infinity && scalarRank > pointRank;
}

/** Whether the operand types are a list of points beside a deeper
 * collection of numbers (`pointsBesideDeeperNumbers`) and the handler's
 * answer `answer` is a list of points whose rank is the rank of the deepest
 * operand: the handler typed the pairing of each point with a row of
 * numbers itself, and its answer is the shape of the value. The ranks are
 * read down to the point or number leaves (`pointLeafArity`). */
function handlerTypedPointsBesideDeeperNumbers(
  answer: Type,
  types: ReadonlyArray<Type>
): boolean {
  if (!pointsBesideDeeperNumbers(types)) return false;
  const leaf = pointLeafArity(answer, 0);
  if (leaf === null || leaf.arity === undefined) return false;
  let deepest = 0;
  for (const t of types)
    deepest = Math.max(deepest, pointLeafArity(t, 0)?.rank ?? 0);
  return leaf.rank === deepest;
}

/** Whether every operand type has the same list rank down to its point or
 * number leaves (`pointLeafArity`). */
function sameLeafRank(types: ReadonlyArray<Type>): boolean {
  let rank: number | undefined;
  for (const t of types) {
    const leaf = pointLeafArity(t, 0);
    if (leaf === null) return false;
    if (rank !== undefined && leaf.rank !== rank) return false;
    rank = leaf.rank;
  }
  return true;
}

/** Whether a type is a tuple, or a union with a tuple branch (an alias is
 * unfolded first). */
/**
 * A scalar-or-collection union whose scalar side holds a tuple and whose
 * every dimensionless collection branch holds tuple-shaped elements — the
 * type of a valueless point-or-point-list symbol
 * (`tuple<…> | list<tuple<…>>`, with or without a mixed
 * `indexed_collection<number | tuple<…>>` arm).
 */
function isPointOrPointListUnion(t: Type): boolean {
  if (!hasTupleBranch(t)) return false;
  const branches = scalarOrCollectionUnionBranches(t);
  if (branches === undefined) return false;
  return branches.every((b) => {
    const element = dimensionlessIndexedElement(b);
    return element !== undefined && hasTupleBranch(element);
  });
}

function hasTupleBranch(t: Type, seen?: AliasDescent): boolean {
  // The alias unfolds under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias (`type alias cyc = cyc | tuple<number, number>`)
  // stops when it reaches itself again, and that arm contributes no members
  // (`false`, the neutral answer for "some arm is a tuple"), so the union is
  // decided by its other arms. Without the guard the walk overflows the
  // stack.
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  const r = unfolded.type;
  return (
    typeof r !== 'string' &&
    (r.kind === 'tuple' ||
      (r.kind === 'union' &&
        r.types.some((m) => hasTupleBranch(m, unfolded.seen))))
  );
}

export interface BroadcastLiftInput {
  /** The operator's definition. */
  readonly def: BoxedOperatorDefinition;
  /** One view per operand. */
  readonly views: ReadonlyArray<BroadcastOperandView>;
  /** The per-element result the handler (or the signature) computed. */
  readonly sigResult: Type;
  /** `true` when `sigResult` is the declared result of the signature (no
   * type handler answered). The signature is solved against the CELLS of a
   * collection operand (`threadable`), so its result is the result for one
   * element as it stands, a collection result included: `FactorInteger` of
   * one integer is a list. `false` or absent when a type handler answered:
   * the handler saw the whole collection operand and may have answered a
   * collection type for it (`Negate` echoes the operand's type), so a
   * collection answer is not taken as the result for one element without a
   * second call at the cells (`perElementCollection` in
   * `broadcastLiftType`). */
  readonly sigResultIsPerElement?: boolean;
  /** Whether slot `i` maps a collection argument element-wise. `undefined`
   * when the signature declares no `broadcastable<T>` slot (then every slot
   * maps). */
  readonly mappable: ((i: number) => boolean) | undefined;
  /** `broadcastsOverTuples(operator, def)`: the head broadcasts
   * component-wise over numeric tuples. */
  readonly broadcastsOverTuples: boolean;
  /** `typesTupleArmsAsCells(operator, def)`: a scalar-or-collection union
   * operand with a tuple arm beside a list of numbers is typed arm by arm,
   * the tuple arm as a cell of its own (`armwiseUnionBroadcastResultType`).
   * `false` or absent under a norm head, a relational operator, a lambda or
   * a user function. */
  readonly armwiseTupleArms?: boolean;
  /** Some operand is a `List` literal with a readable shape. */
  readonly hasTensors: boolean;
  /** The per-element result of the handler called again with each
   * scalar-or-list union operand typed as its cell
   * (`scalarOrListUnionCellType`), or `undefined` when no operand is such a
   * union or the handler declines. Read only when every broadcast trigger
   * is such a union. */
  readonly unionCellResult?: () => Type | undefined;
  /** The per-element result of the handler called again with the operands
   * that trigger the abstract-collection lift typed as their cell
   * (`abstractCollectionCell`). `cells[i]` is the cell type of operand `i`,
   * or `undefined` for an operand that is not such a trigger: that operand
   * is described exactly as for the main handler call. `undefined` when the
   * handler declines. Read by arm 2, when an abstract collection operand is
   * what makes the result possibly a collection, and by arms 0 and 1 when
   * the main answer is a collection type, with each trigger typed as its
   * leaf cell (`perElementCollection` in `broadcastLiftType`). */
  readonly abstractCellResult?: (
    cells: ReadonlyArray<Type | undefined>
  ) => Type | undefined;
  /** As `abstractCellResult`, but a retyped operand is described by its
   * cell type alone, without the operand's structure: `cells[i]` is one ARM
   * of a declared union (`armwiseUnionBroadcastResultType`), and states
   * what the value is in that arm. Read only by the arm-by-arm typing of a
   * scalar-or-collection union with a tuple arm. */
  readonly armCellResult?: (
    cells: ReadonlyArray<Type | undefined>
  ) => Type | undefined;
}

/**
 * The broadcast-lifted result type of an application, or `undefined` when no
 * lift applies and the caller's per-element result stands. The caller has
 * already decided that the operator is broadcastable (or declares
 * `broadcastable<T>` slots) and is not a lambda.
 */
export function broadcastLiftType(input: BroadcastLiftInput): Type | undefined {
  const { def, sigResult, hasTensors } = input;
  // A gated collection operand (a restricted point or list) lifts as its
  // present part. The caller adds the `missing` arm back
  // (`absorbOperandAbsence`).
  const views = input.views.map(presentView);
  const mappable = (i: number) =>
    input.mappable === undefined || input.mappable(i);

  // An operator with the `'whole-collection-compare'` exemption over two or
  // more definite collections applies whole-value semantics — a scalar
  // `boolean`, never a broadcast. The value-level skip tests `isCollection`,
  // which an unevaluated intermediate typed `vector<n>` does not satisfy, so
  // the same ≥2 rule is mirrored at the type level here.
  const typeLevelWholeCompareSkip =
    def.broadcastExemptions.includes('whole-collection-compare') &&
    views.filter(
      (v) => v.isCollection || isLinearAlgebraCollectionTypeOf(v.type)
    ).length >= 2;
  if (typeLevelWholeCompareSkip) return undefined;
  if (skipBroadcastForVectorOpsOnViews(def, hasTensors, views))
    return undefined;

  // A handler that answers `error` for its operands (a `Multiply` of two
  // tensors whose lengths do not agree) answers for the whole application:
  // the value is the error, not a collection of errors.
  if (sigResult === 'error' && input.sigResultIsPerElement !== true)
    return undefined;

  // A handler declared with the `'collection-result'` exemption computes
  // its own collection typing (`matrix + scalar` is `matrix`); its
  // collection-bearing result is not re-wrapped.
  const handlerOwnsCollectionTyping =
    def.broadcastExemptions.includes('collection-result');
  const deferToHandler =
    handlerOwnsCollectionTyping &&
    (isSubtype(sigResult, COLLECTION_SHAPE_TYPE) ||
      (typeof sigResult !== 'string' &&
        sigResult.kind === 'union' &&
        sigResult.types.some((m) => isSubtype(m, COLLECTION_SHAPE_TYPE))));

  // The result for ONE element, when that result is itself a collection
  // (or a tuple): `ComplexRoots(8, 3)` is a list of three roots, so
  // `ComplexRoots([1, 8], 3)` is a list of two such lists. `undefined` when
  // the per-element result is not a collection, or when that cannot be
  // shown, and the lift then unwraps one rank of `sigResult` as before.
  // A collection answer of a type handler is ambiguous: the handler saw
  // the whole collection operand, and some handlers answer the operand's
  // collection type (`Negate` echoes it). So the handler is called again
  // with each trigger (`isTrigger`) typed as its leaf cell
  // (`broadcastCellType`), and only a collection answer of that call is
  // the result for one element. A declared result
  // (`sigResultIsPerElement`) is solved against the cells already.
  const perElementCollection = (
    isTrigger: (v: BroadcastOperandView, i: number) => boolean
  ): Type | undefined => {
    if (deferToHandler) return undefined;
    const points = pointCellTypes(isTrigger);
    // A handler can answer a scalar for a list of points that it does not
    // type (`Divide` of a list of rows of points by a matrix), while its
    // answer for the point cells is a point. So the cells are asked even then.
    const scalarResult = broadcastElementType(sigResult) === sigResult;
    if (scalarResult && points === undefined) return undefined;
    if (!scalarResult && input.sigResultIsPerElement === true)
      return resolveTypeAlias(sigResult);
    // An operand that is not retyped but MAY be a collection (an
    // application typed `unknown`, a `broadcastable<E>` operand) can make
    // the answer at the cells a collection too (`broadcastable<number>`),
    // and that collection is not the result for one element.
    if (
      views.some(
        (v, i) =>
          !isTrigger(v, i) &&
          (isPossiblyCollectionTypedView(v) ||
            abstractCollectionCell(v.type) !== undefined)
      )
    )
      return undefined;
    let answer = input.abstractCellResult?.(
      points?.cells ??
        views.map((v, i) =>
          isTrigger(v, i) ? broadcastCellTypeOf(v.type) : undefined
        )
    );
    // A cell of a collection of numbers beside the points may be zero, and
    // the answer for such a cell is part of the cell type: a point divided
    // by a zero cell of `[[0]]` is `(~oo, ~oo)`. The `Divide` handler types
    // a point divided by an `integer` cell with coordinates that hold `~oo`
    // and `NaN` (`real | infinity | nan`). The handler is also asked with
    // each such cell typed `number`, which admits every quotient, so that
    // the cell type holds the quotient by zero for any handler, not only for
    // one that applies that rule.
    if (answer !== undefined && points?.zeroCells !== undefined) {
      const zero = input.abstractCellResult?.(points.zeroCells);
      if (zero !== undefined && zero !== 'error' && zero !== 'never')
        answer = reduceType({ kind: 'union', types: [answer, zero] });
    }
    if (answer === undefined || broadcastElementType(answer) === answer)
      return undefined;
    // After a scalar answer for the whole operand, only a point answer for
    // the point cells is read: a collection answer there comes from the
    // structure of the operand, which the cells carry, not from one cell.
    if (scalarResult && !isTupleShapedType(resolveTypeAlias(answer)))
      return undefined;
    return resolveTypeAlias(answer);
  };

  // The cells of the triggers when a list of points is one of them, under a
  // head that does not broadcast over the components of a point: such a
  // head types a point whole (`Divide` scales it), so the cell of a list of
  // points, at any depth, is the point and not one of its components, and
  // the handler answers a point for it: `[[(1, 2)]] / 2` is `[[(1/2, 1)]]`,
  // a list of lists of points. A trigger that is a collection of numbers of
  // the same rank is paired cell by cell with the points, and its cell is a
  // number: each point of `[[(1, 2), (3, 4)]] / [[1, 2]]` is divided by one
  // number, and the cells of the result are points. A collection of numbers
  // of a lower rank is paired with rows of points, and each point of a row
  // is divided by the one number of the row: `[[(1, 2), (3, 4)]] / [2]` is
  // `[[(1/2, 1), (3/2, 2)]]`, so its cell is a number too, and the cells of
  // the result are points. `undefined` when no trigger is a list of points,
  // when a trigger is neither, when two lists of points have different
  // ranks, or when a collection of numbers is deeper than the points (a
  // list of points beside a matrix pairs each point with a row; the handler
  // types that pairing itself).
  //
  // `zeroCells` are the same cells with each number cell that may be zero
  // replaced by `number`, or `undefined` when no number cell may be zero.
  function pointCellTypes(
    isTrigger: (v: BroadcastOperandView, i: number) => boolean
  ):
    | {
        cells: (Type | undefined)[];
        zeroCells: (Type | undefined)[] | undefined;
      }
    | undefined {
    if (input.broadcastsOverTuples) return undefined;
    // `rank` is the rank of the lists of points, `numberRank` the largest
    // rank of the collections of numbers.
    let rank: number | undefined;
    let numberRank = 0;
    let point = false;
    let mayBeZero = false;
    const cells: (Type | undefined)[] = [];
    const zeroCells: (Type | undefined)[] = [];
    for (let i = 0; i < views.length; i++) {
      const v = views[i];
      if (!isTrigger(v, i)) {
        cells.push(undefined);
        zeroCells.push(undefined);
        continue;
      }
      const leaf = pointLeafArity(v.type, 0);
      if (leaf === null) return undefined;
      if (leaf.arity === undefined) {
        numberRank = Math.max(numberRank, leaf.rank);
        const cell = broadcastCellTypeOf(v.type);
        cells.push(cell);
        if (isSubtype({ kind: 'value', value: 0 }, cell)) {
          mayBeZero = true;
          zeroCells.push('number');
        } else zeroCells.push(cell);
        continue;
      }
      if (rank !== undefined && leaf.rank !== rank) return undefined;
      rank = leaf.rank;
      const p = pointLeafType(v.type);
      if (p === undefined) return undefined;
      point = true;
      cells.push(p);
      zeroCells.push(p);
    }
    if (!point || rank === undefined || numberRank > rank) return undefined;
    return { cells, zeroCells: mayBeZero ? zeroCells : undefined };
  }

  // Arm 0 (tuple): the typing twin of the component-wise tuple broadcast.
  // The value is a `Tuple` of one per-component result, so the type is a
  // tuple of that many copies of the per-component type. A tuple whose
  // components are collection-shaped is broadcast all the same but cannot
  // name its components: the wide bare `tuple` is claimed.
  if (input.broadcastsOverTuples) {
    const arity = tupleBroadcastArityOnViews(views);
    if (arity === 'unknown-components') return 'tuple';
    if (arity !== undefined) {
      // The cells of the component-wise broadcast are the components of the
      // tuple operands; a scalar operand is the same in every cell.
      const element =
        perElementCollection((v) => isTupleShapedType(v.type)) ??
        broadcastElementTypeOf(sigResult);
      return {
        kind: 'tuple',
        elements: Array.from({ length: arity }, () => ({
          type: element as Type,
        })),
      };
    }
  }

  // The per-cell result the lift re-shapes. `broadcastElementType` unwraps
  // ONE rank — a handler-leaked `list<E>` or `scalar | list<E>` union — but
  // a declared TUPLE result is the structured value each cell holds
  // (`AbsArg([1, 2])` is `[(1, 0), (2, 0)]`), so a tuple result, or a union
  // with a tuple branch, stays the cell.
  const cellResult = hasTupleBranch(sigResult)
    ? resolveTypeAlias(sigResult)
    : broadcastElementTypeOf(sigResult);

  // Arm 1 (statically-visible collection): a materialized finite indexed
  // collection, an operand typed as an unbounded list / indexed collection,
  // or — unless the handler owns its collection typing — a fixed-shape
  // (dimensioned) intermediate such as `10^4·[1,2,3]`.
  const broadcasting = views.filter(
    (v, i) =>
      mappable(i) &&
      (v.finiteBroadcastParticipant ||
        isBroadcastCollectionTypeOf(v.type) ||
        (!deferToHandler && isFixedShapeCollectionTypeOf(v.type)))
  );
  if (broadcasting.length > 0) {
    // An operand of an abstract collection type whose element is itself an
    // indexed collection (`collection<list<number>>`) takes part here
    // because it holds a list now, and the broadcast descends into that
    // list to its leaves. Its declared type has no rank (no dimensions), so
    // it is shaped as the list of its element that it holds: `Sin` of a held
    // `[[1, 2], [3, 4]]` is a list of lists, not a list of numbers.
    const types = broadcasting.map((v) => {
      const nested = abstractCollectionCell(v.type)?.nestedElement;
      return nested === undefined
        ? v.type
        : ({ kind: 'list', elements: nested } as Type);
    });
    // A head that maps over the components of a point, over a list of
    // points beside a deeper collection of numbers: each point is paired
    // with a row of numbers, and each component with one number of the row,
    // so the cells of the result are numbers at the rank of the deepest
    // operand (`pointsBesideDeeperNumbers`). The one-cell and arm-by-arm
    // typings below read the cells as points.
    if (
      input.broadcastsOverTuples &&
      !hasTupleBranch(cellResult) &&
      !isSubtype(cellResult, COLLECTION_SHAPE_TYPE) &&
      pointsBesideDeeperNumbers(types)
    )
      return nestedBroadcastResultType(types, cellResult);
    // A head that types a point whole (`Divide` scales a point), over a list
    // of points beside a deeper collection of numbers: the broadcast pairs
    // each point with a row of numbers and applies the head to the point and
    // to each number of the row, so the cells of the result are points, at
    // the rank of the deepest operand. A handler that types this pairing
    // itself (`pointListOverMatrixQuotientType` for `Divide`) answers a list
    // of points of that rank, with the matrix's dimensions when they are
    // known, and that answer is the result. The typing below reads the cell
    // of that answer and gives one list level around it for operands of
    // different ranks, `list<tuple<…>>`, which does not hold the value: a
    // list is read by its elements, and the elements of the value are rows
    // of points.
    if (
      !input.broadcastsOverTuples &&
      handlerTypedPointsBesideDeeperNumbers(sigResult, types)
    )
      return resolveTypeAlias(sigResult);
    // A point-or-point-list operand (a symbol declared
    // `tuple<number, number> | list<tuple<number, number>>` and left
    // valueless) is a lone scalar-or-collection union whose scalar branch is
    // a TUPLE. The arithmetic handlers type such an operand branch by branch
    // — `Add` widens the operands' unions, `Divide` maps the quotient over
    // each arm, `Negate` echoes the operand — so their answer already
    // carries the operand's list branch. Re-wrapping that answer around the
    // list branch below would nest it: `P / 2` typed
    // `list<list<tuple<…>> | tuple<…>> | tuple<…>`, and every further
    // operator added a rank (`P - Q` nested twice), a type no evaluated
    // value has. When every trigger is such a union and the handler answered
    // a union holding both a tuple branch and a collection branch, the
    // handler's answer IS the result, arms kept as the handler spelled them
    // (a declared three-arm union stays three arms, not the widest arm that
    // absorbs the others). The test is on the SHAPE of both sides: every
    // collection branch of the operands and of the answer holds points, so
    // the answer's list branch can only be the operand's list branch carried
    // through. A declared per-element result that merely has a tuple branch
    // beside a list of numbers (`tuple<…> | list<number>` applied to a
    // `number | list<number>` operand) is a cell like any other and still
    // takes the wrap below, as does a handler that answered a plain cell
    // (`number`, a tuple, a definite `list<E>`).
    if (
      isPointOrPointListUnion(sigResult) &&
      types.every((t) => isPointOrPointListUnion(t))
    )
      return resolveTypeAlias(sigResult);
    // Every trigger a lone scalar-or-collection union, and some trigger has
    // a TUPLE scalar arm beside a collection arm that does not hold points
    // (`tuple<number, number> | list<number>`; the Desmos parameter shape
    // `number | list<number> | tuple<…> | tuple<…>`): the one-cell typing
    // below cannot describe such an operand (`scalarOrListUnionCellType`
    // declines a tuple arm), and wrapping the handler's answer for the
    // whole union nested a list level per operator. Each combination of
    // arms is typed as its own cell instead
    // (`armwiseUnionBroadcastResultType`): `2V` is
    // `list<number> | tuple<number, number>`, not the operand's union
    // wrapped once more. Only under a head whose handler types a tuple
    // operand, or that broadcasts over tuples component-wise
    // (`armwiseTupleArms`): under a norm head (`|b|`) or a relational
    // operator the tuple is one value, and the one-cell typing below
    // stands. A union with no tuple arm (a recursive alias
    // `list<json> | integer`) keeps the one-cell typing too.
    if (
      input.armwiseTupleArms === true &&
      input.armCellResult !== undefined &&
      types.some((t) => hasTupleBranch(t)) &&
      types.every((t) => scalarOrCollectionUnionBranches(t) !== undefined)
    ) {
      const armwise = armwiseUnionBroadcastResultType(
        views.map((v) => {
          const k = broadcasting.indexOf(v);
          return k === -1 ? undefined : types[k];
        }),
        input.armCellResult,
        { componentwise: input.broadcastsOverTuples }
      );
      if (armwise !== undefined) return armwise;
    }
    // A trigger whose CELL has a tuple arm: a list of numbers or points
    // (`list<number | tuple<number, number>>`, alone or as the list branch
    // of a `number | list<…>` union), or a symbol declared
    // `broadcastable<E>` that holds a list now, whose cell is `E`
    // (`broadcastable<tuple<number, number>>` holding `[(1, 2), (3, 4)]`).
    // The handler's one answer over the whole operand type lost the tuple
    // arm (`q^2` typed `list<number>` for a list of points, whose squares
    // are points), so each arm of the cell is typed as its own cell, the
    // answers of one element's arms are joined, and the list is shaped back
    // once (`[1, (1, 2)]` squared is one `list<number | tuple<…>>`), under
    // the same heads as above. Every trigger must be typed arm by arm for
    // the combination to be typed at all; a trigger of a fixed shape
    // (`vector<2>`) is not, and keeps the typing below. When every arm is
    // rejected (`L + 1` for a list of points) the application is `error`,
    // as the one-cell typing already answered for such a list: the empty
    // list, whose sum is `[]`, is left out on purpose, as it was.
    if (input.armwiseTupleArms === true && input.armCellResult !== undefined) {
      // A `broadcastable<E>` trigger that holds a collection now holds the
      // collection arm of the broadcastable (`broadcastCollectionArm`):
      // `tensor<E>`, of any rank, when `E` cannot hold a list (a tuple, a
      // number), so that `P` declared `broadcastable<tuple<number, number>>`
      // can hold `[[(3, 4)], [(6, 8)]]`. A rank-1 `list<E>` does not hold
      // that value.
      const armedTypes = types.map((t) => {
        const elements = broadcastableElementsOf(t);
        return elements === undefined
          ? t
          : (broadcastCollectionArm(elements) as Type);
      });
      if (
        armedTypes.some((t) => hasTupleCell(t)) &&
        armedTypes.every((t) => isArmedOperandType(t))
      ) {
        const armwise = armwiseUnionBroadcastResultType(
          views.map((v) => {
            const k = broadcasting.indexOf(v);
            return k === -1 ? undefined : armedTypes[k];
          }),
          input.armCellResult,
          { componentwise: input.broadcastsOverTuples }
        );
        if (armwise !== undefined) return armwise;
      }
    }
    // Every trigger a LONE scalar-or-collection union (a valueless
    // `u: number | list<number>`): the result carries the union through
    // instead of claiming the definite `list<E>` that `u := 5` contradicts.
    // The handler typed the cell from the whole union, which is not a
    // number type, so it answered a wide cell (`2u` gave `number` for
    // `u: real | list<real>`). Typed again from the union's cell, it answers
    // the narrow one (`real`).
    // A per-element result that is a collection is the cell as it stands,
    // and is not unwrapped (`perElementCollection`).
    const elementCollection = perElementCollection((v) =>
      broadcasting.includes(v)
    );
    const unionCell =
      elementCollection === undefined &&
      input.unionCellResult !== undefined &&
      types.every((t) => scalarOrListUnionCellType(t) !== undefined)
        ? input.unionCellResult()
        : undefined;
    const loneUnionResult = loneUnionBroadcastResultType(
      types,
      elementCollection ??
        (unionCell === undefined
          ? cellResult
          : // A tuple result is the structured value of one cell, as for
            // `cellResult` above: it is not unwrapped.
            hasTupleBranch(unionCell)
            ? resolveTypeAlias(unionCell)
            : broadcastElementTypeOf(unionCell))
    );
    if (loneUnionResult !== undefined) return loneUnionResult;

    // A handler that owns its collection typing and answered a SHAPED
    // collection (`Negate` of a matrix IS the operand's matrix) is not
    // re-wrapped; a shapeless collection result (`indexed_collection<…>` of
    // `-Range(1,5)`) is upgraded by the wrapper below.
    if (
      deferToHandler &&
      isSubtype(sigResult, COLLECTION_SHAPE_TYPE) &&
      handlerAnswerStatesShape(sigResult)
    )
      return resolveTypeAlias(sigResult);

    // A list of points under a tuple-broadcasting head: each cell is a
    // tuple of the per-component result. A per-component result that is a
    // collection or a tuple is such a component too
    // (`perElementCollection`); a collection or tuple `cellResult` is not
    // known to be one, and is not wrapped.
    const perComponent = elementCollection ?? cellResult;
    // For an operator that propagates absence, the result is shaped from
    // the PRESENT cells of the operands: an absent cell is given the marker
    // of its result cell afterwards (`absorbOperandAbsence`). Read with its
    // `missing` arm, the cell type `list<integer> | missing` is a union that
    // has no rank, and the shaping gave the scalar `list<R>` for a list of
    // rows, or mirrored the absent cell as a cell of `R`
    // (`list<list<R> | R>`) instead of a cell of the marker.
    const propagates = def.resolvedMissingBehavior === 'propagate';
    const absentCells = types.some((t) => typeContainsMissing(t));
    const shapeTypes =
      propagates && absentCells
        ? types.map((t) =>
            typeContainsMissing(t) ? stripMissingFromType(t, 'keep') : t
          )
        : types;
    // For an operator that does not propagate absence, the result for an
    // absent cell is what its handler answers for a `missing` cell: `Missing`
    // for `Less` (`Less(Missing, 2)` is `Missing`), a boolean for `And`
    // (`And(Missing, False)` is `False`). The shaping mirrors an absent cell
    // of a ragged list as that answer (`broadcastShapedResultType`).
    const absentCell =
      !propagates && absentCells
        ? input.abstractCellResult?.(
            views.map((v) => (broadcasting.includes(v) ? 'missing' : undefined))
          )
        : undefined;
    if (
      input.broadcastsOverTuples &&
      (elementCollection !== undefined ||
        (!hasTupleBranch(cellResult) &&
          !isSubtype(cellResult, COLLECTION_SHAPE_TYPE)))
    ) {
      const arity = pointListArityOfTypes(types);
      if (arity !== undefined) {
        const point: Type = {
          kind: 'tuple',
          elements: Array.from({ length: arity }, () => ({
            type: perComponent,
          })),
        };
        // Operands of different ranks (rows of points beside a list of
        // numbers): the result has the rank of the deepest operand, which
        // the shaped form, one list level for a rank mismatch, does not
        // give.
        return sameLeafRank(shapeTypes)
          ? shapedBroadcastResultType(shapeTypes, point, absentCell)
          : nestedBroadcastResultType(shapeTypes, point);
      }
    }

    // The operands' shape is kept when the per-element result may carry
    // dimensions, that is, when it cannot be a list (`Sin(M)` is a
    // `matrix<2x2>`, `M < 3` is a `matrix<boolean^(2x2)>`), and spelled as
    // nested plain lists otherwise.
    return shapedBroadcastResultType(shapeTypes, perComponent, absentCell);
  }

  // Arm 2 (possibly a collection): the operand's collection-ness is not
  // statically knowable — it might broadcast at runtime or stay scalar, so
  // the honest result is `broadcastable<E>`.
  //
  // An operand of an ABSTRACT collection type (`collection<T>`, see
  // `isAbstractCollectionTypeOf`) is such an operand too, and so is an
  // operand whose type is such a collection with an absence arm or with
  // scalar arms (`abstractCollectionCell` lists the spellings). The declaration
  // admits a list or a range, over which the operator maps (the value is a
  // list), and a set, over which it does not map. So neither the scalar
  // result nor a list type is true for every value the declaration admits,
  // and `broadcastable<E>` (the scalar `E` or a list of `E`)
  // is. An operand that holds a list or a range NOW is a
  // `finiteBroadcastParticipant`, and arm 1 above has already typed the
  // application as a list from that value, as it does for any symbol. An
  // operand that holds a set NOW (`holdsUnindexedCollection`) is not mapped
  // over, and the application keeps the scalar type the handler computed
  // over it: for such an operand `broadcastable<E>` can be wrong, because
  // the result is not an element-wise result (`Abs` of a set is not the
  // absolute value of an element). Arm 1
  // also wins when another operand is an indexed collection (`P + [1, 2]`).
  // That is sound: the element-wise map then either gives a list or does not
  // apply at all (a set against a list gives an error value, not a scalar),
  // so the result is never the scalar `E`.
  //
  // The handler typed the cell from the COLLECTION type of the abstract
  // operand, which is not the type of any cell, so the cell is typed again
  // with each trigger typed as its cell (`abstractCellResult`). Only the
  // triggers are retyped: an operand at a slot that takes the whole
  // collection, and an operand that holds a set now, keep their own type.
  //
  // The predicates are tested in order of cost: the slot, then the type,
  // and only then the value-level predicates, which are getters over the
  // operand's value.
  const abstractCells = views.map((v, i) => {
    if (!mappable(i)) return undefined;
    const cell = abstractCollectionCell(v.type);
    if (cell === undefined) return undefined;
    if (v.finiteBroadcastParticipant || v.holdsUnindexedCollection)
      return undefined;
    return cell;
  });
  const abstractTrigger = abstractCells.some((c) => c !== undefined);
  if (
    abstractTrigger ||
    views.some((v, i) => mappable(i) && isPossiblyCollectionTypedView(v))
  ) {
    // A top-typed trigger (a symbol declared `any`, a call typed `any`) may
    // hold a point or a matrix as well as a list, and a NUMERIC application
    // over it is then a point or a matrix too (`\sin (1, 2)` is `(\sin 1,
    // \sin 2)`), which no `broadcastable<T>` admits: the application takes
    // the top type (user decision 2026-10-17, Tycho ledger row 379). A
    // result that is not numeric (a comparison, a predicate) is never a
    // point, and keeps the `broadcastable<T>` reading. The cell of an
    // abstract collection declared `collection<any>` is such a trigger too:
    // it may be a point, and `P + 1` already answers `any` for it.
    const top = topTypeOfTriggers(
      [
        ...views.filter(
          (v, i) => mappable(i) && isPossiblyCollectionTypedView(v)
        ),
        ...abstractCells.flatMap((c) =>
          c === undefined ? [] : [{ type: c.cell }]
        ),
      ],
      cellResult
    );
    if (top !== undefined) return top;
    // Every trigger typed `broadcastable<E>` (a declared parameter, a symbol
    // declared `broadcastable<number | tuple>`), and some `E` — or a plain
    // tuple-arm union operand beside them (`isScalarUnionWithTupleArm`) —
    // has a TUPLE arm: the per-element result is typed arm by arm over the
    // elements, as the visible-collection lift types a union with a tuple
    // arm, and wrapped once. The handler's one answer for the whole element
    // union lost the tuple arm: `p^2` for `p: broadcastable<number | tuple>`
    // typed `broadcastable<number>`, a type the value `(1, 4)` (the square
    // of a point `p`) does not have, since a tuple is not an indexed
    // collection. Arm by arm it types `broadcastable<number | tuple>`. Only
    // under a head whose tuple arm is a cell of its own (`armwiseTupleArms`):
    // a norm (`|p|`) or a comparison reads a point as one value, and keeps
    // the one answer. An arm combination the handler rejects contributes
    // nothing (`p + 1` is `broadcastable<number>`: a point plus a number is
    // refused at boxing), and when every combination is rejected the
    // application is an error whatever the value, not a broadcast of one.
    // An abstract collection trigger (`collection<E>`) keeps the typing
    // below, which shapes its nested element.
    if (
      input.armwiseTupleArms === true &&
      input.armCellResult !== undefined &&
      !abstractTrigger
    ) {
      const armed = views.map((v, i) =>
        mappable(i) ? armedOperandType(v) : undefined
      );
      if (
        armed.some((t) => t !== undefined && hasTupleArm(t)) &&
        views.every(
          (v, i) =>
            !mappable(i) ||
            !isPossiblyCollectionTypedView(v) ||
            broadcastableElementsOf(v.type) !== undefined
        )
      ) {
        const armwise = armwiseUnionBroadcastResultType(
          armed,
          input.armCellResult,
          { componentwise: input.broadcastsOverTuples }
        );
        // Every arm rejected (`d + 1` for `d: broadcastable<tuple<…> |
        // tuple<…>>`): `error`, as a list of points plus a number is typed
        // (arm 1); the empty collection is left out on purpose there too.
        if (armwise === 'error' || armwise === 'never') return armwise;
        if (armwise !== undefined) return broadcastableOf(armwise);
      }
    }
    const abstractCell = abstractTrigger
      ? input.abstractCellResult?.(abstractCells.map((c) => c?.cell))
      : undefined;
    // The handler typed `abstractCell` at the leaf cells, so a collection or
    // a tuple answer is the result for one element and is not unwrapped. A
    // declared per-element result that is a collection is kept the same way
    // (`perElementCollection`, which calls no handler when no operand is
    // retyped).
    let elements =
      abstractCell === undefined
        ? (perElementCollection(() => false) ?? cellResult)
        : broadcastElementType(abstractCell) === abstractCell
          ? abstractCell
          : resolveTypeAlias(abstractCell);
    // A trigger whose element is itself an indexed collection is mapped to
    // its leaves, so the per-leaf result is wrapped back to the rank of that
    // element (`AbstractCollectionCell.nestedElement`).
    const nested = abstractCells.flatMap((c) =>
      c?.nestedElement === undefined ? [] : [c.nestedElement]
    );
    if (nested.length > 0)
      elements = nestedBroadcastResultType(nested, elements);
    return broadcastableOf(elements);
  }

  // No collection trigger, visible or possible, and some operand a union of
  // scalar arms with a TUPLE arm (a symbol declared
  // `number | tuple<number, number>` and left valueless): typed arm by arm,
  // for the same reason as a `broadcastable<E>` trigger above. The handler's
  // one answer for the whole union lost the tuple arm: `u^2` typed `number`,
  // which the value `(1, 4)` (the square of a point `u`) does not have. Arm
  // by arm it types `number | tuple<number, number>`.
  if (
    input.armwiseTupleArms === true &&
    input.armCellResult !== undefined &&
    views.some((v, i) => mappable(i) && isScalarUnionWithTupleArm(v.type))
  ) {
    const armwise = armwiseUnionBroadcastResultType(
      views.map((v, i) =>
        mappable(i) && isScalarUnionWithTupleArm(v.type) ? v.type : undefined
      ),
      input.armCellResult,
      { componentwise: input.broadcastsOverTuples }
    );
    if (armwise !== undefined) return armwise;
  }

  return undefined;
}

/** Whether a type has a tuple arm the arm-by-arm typing can shape: a
 * structural tuple (`tuple<number, number>`) whose components are scalars,
 * the bare `tuple` (a point of unknown arity), or a union with such an arm.
 * `hasTupleBranch` reads structural tuples only, which is what the cell
 * result and the point-or-point-list bypass need; the arm-by-arm typing
 * treats a bare `tuple` arm as a cell too. A tuple with a component that
 * could be a collection (`tuple<number, number | list<number>>`) is not
 * such an arm: the component-wise broadcast would then hold a collection
 * in a component the shaped tuple type does not admit, so the one-cell
 * typing stands for it (as the point-list lift declines it,
 * `pointLeafArity`). */
function hasTupleArm(t: Type, seen?: AliasDescent): boolean {
  // The alias unfolds under the descent guard (`unfoldAliasOnDescent`): a
  // self-referential alias (`type alias cyc = cyc | tuple<number, number>`)
  // stops when it reaches itself again, and that arm contributes no members
  // (`false`, the neutral answer for "some arm is a tuple"). Without the
  // guard the walk overflows the stack.
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  const r = unfolded.type;
  if (r === 'tuple') return true;
  if (typeof r === 'string') return false;
  if (r.kind === 'tuple')
    return !r.elements.some((c) => typeCouldBeCollection(c.type));
  return (
    r.kind === 'union' && r.types.some((m) => hasTupleArm(m, unfolded.seen))
  );
}

/** Whether a trigger of the visible-collection lift has a tuple arm in its
 * CELL: a dimensionless list whose element has one, a union with a tuple
 * arm or with such a list branch, or a tuple itself. */
function hasTupleCell(t: Type, seen?: AliasDescent): boolean {
  // The alias unfolds under the descent guard (`unfoldAliasOnDescent`), as in
  // `hasTupleArm`: a self-referential alias stops when it reaches itself
  // again, and that arm answers `false`, the neutral answer for "some arm".
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  const element = dimensionlessIndexedElement(unfolded.type);
  if (element !== undefined) return hasTupleArm(element, unfolded.seen);
  const r = unfolded.type;
  if (typeof r !== 'string' && r.kind === 'union')
    return r.types.some((m) => hasTupleCell(m, unfolded.seen));
  return hasTupleArm(r, unfolded.seen);
}

/** The element type of a `broadcastable<E>` type, `undefined` for any other
 * type. */
function broadcastableElementsOf(t: Type): Type | undefined {
  const r = resolveTypeAlias(t);
  return typeof r !== 'string' && r.kind === 'broadcastable'
    ? r.elements
    : undefined;
}

/** The type an operand of the possibly-a-collection lift is typed arm by arm
 * from: the element of a `broadcastable<E>` operand (the arms of `E`, or `E`
 * itself as one arm), or a union of scalar arms with a tuple arm as it
 * stands. `undefined` for an operand typed neither way, which the handler
 * sees as it is. */
function armedOperandType(v: BroadcastOperandView): Type | undefined {
  const elements = broadcastableElementsOf(v.type);
  if (elements !== undefined) return elements;
  return isScalarUnionWithTupleArm(v.type) ? v.type : undefined;
}

/**
 * The widest top type (`any`, else `value`) among the operands whose type is
 * one, when the per-element result of the application is numeric or a top
 * type; `undefined` otherwise. It is the type of an element-wise numeric
 * application over such an operand (see the use in `broadcastLiftType`).
 */
export function topTypeOfTriggers(
  triggers: ReadonlyArray<{ readonly type: Type }>,
  cellResult: Type
): 'any' | 'value' | undefined {
  const r = resolveTypeAlias(cellResult);
  if (r !== 'any' && r !== 'value' && !isSubtype(r, 'number')) return undefined;
  let result: 'any' | 'value' | undefined = undefined;
  for (const v of triggers) {
    const t = resolveTypeAlias(v.type);
    if (t === 'any') return 'any';
    if (t === 'value') result = 'value';
  }
  return result;
}

/**
 * `broadcastable<T>` for a per-element result `T`, or `T` itself when it is
 * a top type: `broadcastable<any>` is `any | list<any>`, which
 * is `any`, and `broadcastable<value>` is `value`. A top-typed element comes
 * from a top-typed operand (a symbol declared `any`, a call typed `any`),
 * whose value may be a point or a matrix as well as a list, and the bare top
 * type is the one that admits them all (user decision 2026-10-17, Tycho
 * ledger row 379).
 */
export function broadcastableOf(elements: Type): Type {
  const r = resolveTypeAlias(elements);
  if (r === 'any' || r === 'value') return r;
  return { kind: 'broadcastable', elements };
}
