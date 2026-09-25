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
import type { TupleType, Type } from '../../common/type/types.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../../common/type/primitive.js';
import {
  absorbNumericAbsence,
  broadcastElementType,
  broadcastShapedResultType,
  isNumericScalarType,
  resolveTypeAlias,
  staticCollectionDims,
  stripMissingFromType,
  typeContainsMissing,
} from '../../common/type/utils.js';
import { isSubtype, widen } from '../../common/type/subtype.js';
import type {
  BoxedOperatorDefinition,
  BroadcastExemption,
  OperandDescriptor,
} from '../global-types.js';
import {
  dimensionlessIndexedElement,
  isTupleShapedType,
  loneUnionBroadcastResultType,
  scalarOrCollectionUnionBranches,
  typeCouldBeCollection,
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
   * top-typed symbol or literal is not). */
  readonly isApplication: boolean;
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
    isCollection: d.facts.collection === true,
    finiteBroadcastParticipant: finiteIndexed && !tuple && !textAtom,
    tuple,
    textAtom,
    tensorShape:
      structure?.kind === 'list-literal' && structure.shape !== undefined,
    matrixFact: dims !== undefined && dims.length === 2,
    typeIsUnknown: t === 'unknown',
  };
}

/** `isBroadcastCollectionType` on a type: an unbounded 1-D list or indexed
 * collection, or a union with such a branch. */
export function isBroadcastCollectionTypeOf(t: Type): boolean {
  return dimensionlessIndexedElement(t) !== undefined;
}

/** `isFixedShapeCollection` on a type: a `list` with dimensions. */
export function isFixedShapeCollectionTypeOf(t: Type): boolean {
  const r = resolveTypeAlias(t);
  return (
    typeof r !== 'string' && r.kind === 'list' && r.dimensions !== undefined
  );
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
 * (or a union with such a branch), or a top-typed APPLICATION. */
export function isPossiblyCollectionTypedView(
  v: BroadcastOperandView
): boolean {
  const t = resolveTypeAlias(v.type);
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
 * The type of a THREADED operand without its top-level `missing` arm, or
 * `undefined` when it has none (or has nothing else).
 *
 * An operator that threads conditional values at a position (the
 * `threadsConditionals` flag of `types-definitions.ts`) applies itself to
 * the value of a restriction and moves the condition out: `f(When(v, c))` is
 * `When(f(v), c)`. Its type handler must then see the operand as the value
 * it is applied to, without the absent case (a restriction is typed
 * `missing | T`), and the absent case goes to the result. A `handle`
 * operator answers `Missing` when the operand is, so its result type gains
 * a `missing` arm (`withThreadedAbsence`). A `propagate` operator strips the
 * arm with its own machinery (`absorbOperandAbsence`).
 */
export function threadedPresentType(t: Type): Type | undefined {
  if (!hasTopLevelMissing(t)) return undefined;
  const present = stripTopMissing(t);
  return present === 'never' ? undefined : present;
}

/**
 * `t` with the `missing` arm of an application whose threaded operand can be
 * absent (`threadedPresentType`). The empty type and the error type are
 * kept as they are: they say the application has no value at all.
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
 * `PointY([P{c}, (3, 4)])` is `list<number | missing>`.
 */
export function absorbOperandAbsence(
  t: Type,
  operandTypes: ReadonlyArray<Type>,
  absentCellsStayMissing = false,
  broadcastable = true
): Type {
  let cells = false;
  let wholeCells = false;
  let whole = false;
  let notNumeric: boolean | undefined;
  for (let i = 0; i < operandTypes.length; i++) {
    const ot = operandTypes[i];
    if (!typeContainsMissing(ot)) continue;
    const wholeAbsence = hasTopLevelMissing(ot);
    const present = wholeAbsence ? stripTopMissing(ot) : ot;
    // Absent CELLS (`list<T | missing>`). A restricted list carries both
    // kinds of absence: its type is `missing | list<T | missing>`
    // (`restrictedValueType`, `library/control-structures.ts`), because it
    // is absent as a whole when its condition is false and a list of
    // restricted cells while the condition is undecided. Both readings must
    // count. Reading the cells only lost the whole-absence arm:
    // `Sin([1, 2]{c})` was typed `list<number>` while it answers `Missing`
    // when `c` is false.
    if (typeContainsMissing(present)) {
      cells = true;
      if (missingOutsideTuples(present)) wholeCells = true;
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
  if (!whole) return result;
  if (isSubtype(stripMissingFromType(result), 'number'))
    return absorbNumericAbsence(result);
  return widen('missing', result);
}

/** Whether `t` has a `missing` arm that can stand for a whole value or a
 * whole collection cell. A `missing` arm inside a tuple component is an
 * absent coordinate, not an absent cell, and does not count. */
function missingOutsideTuples(t: Type): boolean {
  const r = resolveTypeAlias(t);
  if (r === 'missing') return true;
  if (typeof r === 'string') return false;
  switch (r.kind) {
    case 'union':
    case 'intersection':
      return r.types.some(missingOutsideTuples);
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return missingOutsideTuples(r.elements);
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
function withAbsentPointCells(t: Type, anyCell = false): Type {
  const r = resolveTypeAlias(t);
  if (typeof r === 'string') return t;
  switch (r.kind) {
    case 'union': {
      const arms = r.types.map((x) => withAbsentPointCells(x, anyCell));
      if (arms.every((x, i) => x === r.types[i])) return t;
      return widen(...arms);
    }
    case 'list':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable': {
      const cell = r.elements;
      const e = resolveTypeAlias(cell);
      if (
        typeof e !== 'string' &&
        (e.kind === 'list' ||
          e.kind === 'collection' ||
          e.kind === 'indexed_collection' ||
          e.kind === 'broadcastable')
      ) {
        const inner = withAbsentPointCells(cell, anyCell);
        return inner === cell ? t : { ...r, elements: inner };
      }
      return anyCell || isPointCellType(cell)
        ? { ...r, elements: widen('missing', cell) }
        : t;
    }
    default:
      return t;
  }
}

/** Whether every arm of `t`, less its `missing` arm, is a tuple. */
function isPointCellType(t: Type): boolean {
  const r = resolveTypeAlias(t);
  if (typeof r === 'string') return false;
  if (r.kind === 'tuple') return true;
  if (r.kind !== 'union') return false;
  let tuple = false;
  for (const arm of r.types) {
    const a = resolveTypeAlias(arm);
    if (a === 'missing') continue;
    if (typeof a === 'string' || a.kind !== 'tuple') return false;
    tuple = true;
  }
  return tuple;
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
  rank: number
): { arity: number | undefined; rank: number } | null {
  t = resolveTypeAlias(t);
  if (typeof t === 'string') return null;
  if (t.kind === 'union') {
    let result: { arity: number | undefined; rank: number } | null = null;
    for (const arm of t.types) {
      // A `missing` arm is an absent cell (a restricted point inside a
      // list, `[P{c}, (2, 3)]`): it has no leaf of its own, and the cell
      // keeps the arity of the present arms. `absorbOperandAbsence` puts the
      // `missing` arm back on the result cell.
      const r = resolveTypeAlias(arm);
      if (r === 'missing') continue;
      // A tuple arm of a list CELL (`rank > 0`) is a point leaf, as a
      // tuple element is below.
      const a =
        rank > 0 && typeof r !== 'string' && r.kind === 'tuple'
          ? tupleLeafArity(r, rank)
          : pointLeafArity(arm, rank);
      if (a === null) return null;
      if (result === null) result = a;
      else if (result.arity !== a.arity || result.rank !== a.rank) return null;
    }
    return result;
  }
  if (t.kind !== 'list' && t.kind !== 'indexed_collection') return null;
  const dims = t.kind === 'list' ? (t.dimensions?.length ?? 1) : 1;
  const elt = resolveTypeAlias(t.elements);
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
    return pointLeafArity(elt, rank + dims);
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

/** The common tuple arity of the point lists among the broadcasting operand
 * types, or `undefined` when they are not all point lists of one arity (a
 * scalar-leaf sibling is admitted at rank 1 only). */
export function pointListArityOfTypes(
  types: ReadonlyArray<Type>
): number | undefined {
  let arity: number | undefined = undefined;
  let scalarSibling = false;
  let maxRank = 0;
  for (const t of types) {
    const leaf = pointLeafArity(t, 0);
    if (leaf === null) return undefined;
    maxRank = Math.max(maxRank, leaf.rank);
    if (leaf.arity === undefined) {
      scalarSibling = true;
      continue;
    }
    if (arity !== undefined && arity !== leaf.arity) return undefined;
    arity = leaf.arity;
  }
  if (arity === undefined) return undefined;
  if (scalarSibling && maxRank > 1) return undefined;
  return arity;
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

function hasTupleBranch(t: Type): boolean {
  t = resolveTypeAlias(t);
  return (
    typeof t !== 'string' &&
    (t.kind === 'tuple' ||
      (t.kind === 'union' && t.types.some((m) => hasTupleBranch(m))))
  );
}

export interface BroadcastLiftInput {
  /** The operator's definition. */
  readonly def: BoxedOperatorDefinition;
  /** One view per operand. */
  readonly views: ReadonlyArray<BroadcastOperandView>;
  /** The per-element result the handler (or the signature) computed. */
  readonly sigResult: Type;
  /** Whether slot `i` maps a collection argument element-wise. `undefined`
   * when the signature declares no `broadcastable<T>` slot (then every slot
   * maps). */
  readonly mappable: ((i: number) => boolean) | undefined;
  /** `broadcastsOverTuples(operator, def)`: the head broadcasts
   * component-wise over numeric tuples. */
  readonly broadcastsOverTuples: boolean;
  /** Some operand is a `List` literal with a readable shape. */
  readonly hasTensors: boolean;
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

  // Arm 0 (tuple): the typing twin of the component-wise tuple broadcast.
  // The value is a `Tuple` of one per-component result, so the type is a
  // tuple of that many copies of the per-component type. A tuple whose
  // components are collection-shaped is broadcast all the same but cannot
  // name its components: the wide bare `tuple` is claimed.
  if (input.broadcastsOverTuples) {
    const arity = tupleBroadcastArityOnViews(views);
    if (arity === 'unknown-components') return 'tuple';
    if (arity !== undefined) {
      const element = broadcastElementType(sigResult);
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
    : broadcastElementType(sigResult);
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
    const types = broadcasting.map((v) => v.type);
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
    // Every trigger a LONE scalar-or-collection union (a valueless
    // `u: number | list<number>`): the result carries the union through
    // instead of claiming the definite `list<E>` that `u := 5` contradicts.
    const loneUnionResult = loneUnionBroadcastResultType(types, cellResult);
    if (loneUnionResult !== undefined) return loneUnionResult;

    // A handler that owns its collection typing and answered a SHAPED
    // collection (`Negate` of a matrix IS the operand's matrix) is not
    // re-wrapped; a shapeless collection result (`indexed_collection<…>` of
    // `-Range(1,5)`) is upgraded by the wrapper below.
    if (
      deferToHandler &&
      isSubtype(sigResult, COLLECTION_SHAPE_TYPE) &&
      staticCollectionDims(sigResult) !== null
    )
      return resolveTypeAlias(sigResult);

    // A list of points under a tuple-broadcasting head: each cell is a
    // tuple of the per-component result.
    if (
      input.broadcastsOverTuples &&
      !hasTupleBranch(cellResult) &&
      !isSubtype(cellResult, COLLECTION_SHAPE_TYPE)
    ) {
      const arity = pointListArityOfTypes(types);
      if (arity !== undefined)
        return broadcastShapedResultType(types, {
          kind: 'tuple',
          elements: Array.from({ length: arity }, () => ({
            type: cellResult as Type,
          })),
        });
    }

    return broadcastShapedResultType(types, cellResult);
  }

  // Arm 2 (possibly a collection): the operand's collection-ness is not
  // statically knowable — it might broadcast at runtime or stay scalar, so
  // the honest result is `broadcastable<E>`.
  if (views.some((v, i) => mappable(i) && isPossiblyCollectionTypedView(v)))
    return { kind: 'broadcastable', elements: cellResult };

  return undefined;
}
