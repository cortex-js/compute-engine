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
import type { Type } from '../../common/type/types.js';
import { COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import {
  broadcastElementType,
  broadcastShapedResultType,
  isNumericScalarType,
  resolveTypeAlias,
  staticCollectionDims,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import type {
  BoxedOperatorDefinition,
  BroadcastExemption,
  OperandDescriptor,
} from '../global-types.js';
import {
  dimensionlessIndexedElement,
  isTupleShapedType,
  loneUnionBroadcastResultType,
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
      const a = pointLeafArity(arm, rank);
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
  if (elt.kind === 'tuple') {
    if (elt.elements.length === 0) return null;
    if (elt.elements.some((c) => typeCouldBeCollection(c.type))) return null;
    return { arity: elt.elements.length, rank: rank + dims };
  }
  // A numeric leaf that is an object type (a ranged number, `integer<2..3>`)
  // is a scalar sibling, as a primitive numeric leaf is above.
  return isSubtype(elt, 'number')
    ? { arity: undefined, rank: rank + dims }
    : null;
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
  const { def, views, sigResult, hasTensors } = input;
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
