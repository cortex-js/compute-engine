import { getImaginaryFactor } from './utils.js';

import { flatten } from './flatten.js';
import { order, sortAddTerms } from './order.js';
import type {
  NamedElement,
  TupleType,
  Type,
} from '../../common/type/types.js';
import {
  broadcastResultType,
  collectionElementType,
  resolveTypeAlias,
  stripNumericRanges,
  widen,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  COLLECTION_SHAPE_TYPE,
  SIGNED_INFINITY_TYPE,
} from '../../common/type/primitive.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import type {
  Expression,
  Tensor,
  TensorDataType,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isTensorValue, packTensor } from './tensor-view.js';
import { provablyNonFiniteNumber } from './numerics.js';
import {
  addIntervals,
  attachInterval,
  foldIntervalsOfTypes,
} from '../numerics/interval-arithmetic.js';
import {
  isNumber,
  isFunction,
  isSymbol,
  isContinuationOperand,
} from './type-guards.js';
import {
  isLinearAlgebraCollection,
  isFixedShapeCollection,
  isBroadcastCollectionType,
  broadcastSiblingType,
  couldBeNumericTuple,
  isNumericTuple,
  isTuple,
  numericTupleArity,
  hasAccessibleComponents,
  isProvablyScalarNumber,
  isFiniteBroadcastParticipant,
  isBroadcastableCollection,
  isUnknownLengthBroadcast,
  hasUnresolvedCollectionOperand,
  broadcastLengthMismatch,
  lazyBroadcastMap,
  broadcastOverIndexedCollections,
  isPossiblyCollectionTyped,
  broadcastableResultTypeOf,
} from '../collection-utils.js';

import { MACHINE_PRECISION } from '../numerics/numeric.js';
import type {
  NumericValue,
  NumericValueFactory,
} from '../numeric-value/types.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { BigNumericValue } from '../numeric-value/big-numeric-value.js';
import { MachineNumericValue } from '../numeric-value/machine-numeric-value.js';

/**
 * Test whether `x` carries a `ContinuationPlaceholder` reachable through
 * additive structure (`Add`/`Subtract`/`Negate`). Used by the ellipsis fold
 * barrier to detect a subtraction-spelled ellipsis (`… - \dots`) whose
 * placeholder the parser buries inside a `Subtract` grouping.
 */
function hasAdditiveContinuation(x: Expression): boolean {
  if (isContinuationOperand(x)) return true;
  if (isFunction(x, 'Add') || isFunction(x, 'Subtract'))
    return x.ops.some((op) => hasAdditiveContinuation(op));
  if (isFunction(x, 'Negate')) return hasAdditiveContinuation(x.op1);
  return false;
}

/**
 * Expand `x` into a flat list of additive terms, decomposing `Add`/`Subtract`/
 * `Negate` structure WITHOUT folding numeric literals, so a notational sum's
 * visible samples are preserved. `negate` tracks the accumulated sign from
 * enclosing `Subtract`/`Negate`. Leaves are canonicalized individually (e.g.
 * `Negate(2)` → `-2`) but never combined with one another.
 */
function additiveTerms(
  x: Expression,
  negate: boolean,
  out: Expression[]
): void {
  if (isFunction(x, 'Add')) {
    for (const op of x.ops) additiveTerms(op, negate, out);
    return;
  }
  if (isFunction(x, 'Subtract')) {
    additiveTerms(x.op1, negate, out);
    additiveTerms(x.op2, !negate, out);
    return;
  }
  // Preserve `Negate(ContinuationPlaceholder)` as an atomic term; otherwise
  // descend through the negation.
  if (isFunction(x, 'Negate') && !isContinuationOperand(x)) {
    additiveTerms(x.op1, !negate, out);
    return;
  }
  out.push(negate ? x.engine._fn('Negate', [x]).canonical : x.canonical);
}

/**
 *
 * The canonical form of `Add`:
 * - canonicalize the arguments
 * - remove `0`
 * - capture complex numbers (`a + ib` or `ai + b`)
 * - sort the terms
 *
 */
export function canonicalAdd(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression {
  // Ellipsis fold barrier: an `Add` carrying a `ContinuationPlaceholder`
  // (from `\dots`/`\cdots` in a sum) is a *notational* object, not an
  // arithmetic one. Do not remove zeros, fold numerics, or sort — preserve
  // the source samples so the elided pattern reads correctly, e.g.
  // `1 + 2 + … + n` stays `Add(1, 2, …, n)`.
  //
  // A subtraction-spelled ellipsis buries the placeholder inside the `Subtract`
  // groupings the parser emits: `1 - 2 + 4 - \dots + x` parses to
  // `Add(Subtract(1,2), Subtract(4, …), x)`. Detect the continuation through
  // that additive structure and expand into flat signed terms *without*
  // folding, so `1` and `-2` stay distinct samples rather than collapsing to
  // `-1`. Checked before `flatten` so nested anchors (`2n`) are not lifted.
  if (ops.some((x) => hasAdditiveContinuation(x))) {
    const terms: Expression[] = [];
    for (const op of ops) additiveTerms(op, false, terms);
    return ce._fn('Add', terms);
  }

  // Make canonical, flatten, and lift nested expressions (associative)
  ops = flatten(ops, 'Add');

  // A continuation-bearing inner `Add` may have been lifted by `flatten`
  // (e.g. `x + (1 + 2 + … + n)`); if a placeholder surfaced, stay inert and
  // skip the fold/sort below. (Operand order for the nested case is not
  // guaranteed to match the source.)
  if (ops.some((x) => isContinuationOperand(x))) return ce._fn('Add', ops);

  // A numeric tuple (point/vector in ℝⁿ) cannot be added to a scalar. Reject
  // `scalar + tuple` at canonicalization when provable: some operand is a
  // numeric tuple and another is a *declared/literal* scalar number (not a
  // tuple). Unknown/`any`-typed operands — and operands whose numeric type was
  // merely INFERRED, or that a broadcastable operator computed from one —
  // stay symbolic (inference is retractable evidence; `isProvablyScalarNumber`).
  if (
    ops.some((x) => isNumericTuple(x)) &&
    ops.some((x) => isProvablyScalarNumber(x))
  )
    return ce.error(['incompatible-type', 'tuple', 'number']);

  // Remove literal 0
  ops = ops.filter((x) => !isNumber(x) || !x.isSame(0));

  if (ops.length === 0) return ce.Zero;
  if (ops.length === 1 && !ops[0].isIndexedCollection) return ops[0];

  //
  // Fold exact numeric operands (integers, rationals, radicals, exact
  // complex values and Gaussian integers)
  // e.g. Add(2, x, 5) → Add(x, 7), Add(√2, x, √2) → Add(x, 2√2),
  //      Add(2, 3i, x) → Add(x, 2+3i) — with `2+3i` a single EXACT literal
  //
  {
    const exactNumerics: NumericValue[] = [];
    const rest: Expression[] = [];
    for (const op of ops) {
      if (isNumber(op) && !op.isInfinity && !op.isNaN) {
        const nv = op.numericValue;
        if (typeof nv === 'number' || nv.isExact) {
          exactNumerics.push(
            typeof nv === 'number' ? ce._numericValue(nv) : nv
          );
          continue;
        }
        // A machine/big Gaussian integer (e.g. the literal `3i`, whose
        // NumericValue lives in the inexact lane) is exactly representable:
        // fold it as an exact value so `Add(2, 3i)` stays exact (CORR #11).
        if (
          nv.im !== 0 &&
          Number.isSafeInteger(nv.re) &&
          Number.isSafeInteger(nv.im)
        ) {
          exactNumerics.push(
            ce._numericValue({
              rational: [nv.re, 1],
              imRational: [nv.im, 1],
            })
          );
          continue;
        }
      }
      rest.push(op);
    }
    if (exactNumerics.length >= 2) {
      const summed = nvSum(ce, exactNumerics);
      for (const nv of summed) {
        if (!nv.isZero) rest.push(ce.number(nv));
      }
      ops = rest;
      if (ops.length === 0) return ce.Zero;
      if (ops.length === 1 && !ops[0].isIndexedCollection) return ops[0];
    }
    // else: 0 or 1 exact numerics — ops is unchanged, no folding needed
  }

  // Combine pure-real and pure-imaginary BoxedNumber operands into complex numbers.
  // Exact complex literals (already folded above) are NOT captured: routing
  // them through the float `im` accessor would degrade them to inexact.
  const isExactComplexLiteral = (op: Expression): boolean => {
    if (!isNumber(op)) return false;
    const nv = op.numericValue;
    return typeof nv !== 'number' && nv.im !== 0 && nv.isExact;
  };

  // First pass: check if there are any imaginary terms (otherwise skip entirely)
  const xs: Expression[] = [];
  {
    let imSum = 0;
    let hasIm = false;

    for (const op of ops) {
      if (isNumber(op) && !isExactComplexLiteral(op)) {
        const facExpr = getImaginaryFactor(op);
        if (facExpr !== undefined && isNumber(facExpr)) {
          const f = facExpr.numericValue;
          const im = typeof f === 'number' ? f : f.re;
          if (im !== 0 && typeof im === 'number') {
            imSum += im;
            hasIm = true;
          }
        }
      }
    }

    if (hasIm) {
      // We have imaginary terms: find the first real float/integer to pair with
      let realVal: number | undefined;
      let realFound = false;

      for (const op of ops) {
        if (isNumber(op) && !isExactComplexLiteral(op)) {
          // Skip pure imaginary terms (already summed above)
          const facExpr = getImaginaryFactor(op);
          if (isNumber(facExpr)) {
            const f = facExpr.numericValue;
            const im = typeof f === 'number' ? f : f.re;
            if (im !== 0 && typeof im === 'number') continue;
          }

          // Take only the first real to combine with imaginary
          if (!realFound) {
            const nv = op.numericValue;
            if (
              typeof nv === 'number' ||
              (isSubtype(nv.type, 'real') && !nv.isExact) ||
              isSubtype(nv.type, 'integer')
            ) {
              const re = typeof nv === 'number' ? nv : nv.re;
              if (typeof re === 'number') {
                realVal = re;
                realFound = true;
                continue;
              }
            }
          }
        }
        xs.push(op);
      }

      if (realFound)
        xs.push(ce.number(ce._numericValue({ re: realVal!, im: imSum })));
      else if (imSum !== 0)
        xs.push(ce.number(ce._numericValue({ re: 0, im: imSum })));
    } else {
      // No imaginary terms — nothing to combine
      xs.push(...ops);
    }
  }

  if (xs.length === 1) return xs[0];

  // Commutative: sort
  return ce._fn('Add', sortAddTerms(xs));
}

/**
 * The result type of an elementwise arithmetic operation whose single shaped
 * COLLECTION operand absorbs scalar co-operands into its cells: the
 * collection's structure with its element type widened by the scalar types.
 *
 * This keeps the declared type a sound upper bound of the evaluated value.
 * Echoing the collection operand's type verbatim claimed `integer` cells for
 * `(1..4)·1/2`, whose values are `1/2, 1, 3/2, 2` — and a comprehension
 * binder declared from that element type then rejected its own first value.
 *
 * Structure is preserved wherever the type can carry it: a `list` kind keeps
 * its dimensions, a parameterized `collection`/`indexed_collection`/`set`
 * keeps its kind. A collection spelling whose element type is baked into the
 * NAME cannot carry a widened element — `range`'s members are integers by
 * definition — so those degrade to `indexed_collection<E>`.
 *
 * A cell that is ITSELF a collection (`list<list<number>>`, whose inner shape
 * lives in `elements` rather than in `dimensions`) absorbs the scalars one
 * level further down, recursively: the scalar joins the innermost cells, never
 * the collection cell itself. A union of a scalar and a collection would be a
 * type no evaluated value ever has, and union matching is all-members, so it
 * also makes `type.matches('collection')` answer a confident `false`.
 *
 * Returns `collectionType` unchanged when there is nothing to sharpen: no
 * scalars, an element type that already covers them, a type whose element
 * type is unknown (`any`, or a non-collection), or a collection cell this
 * function cannot rebuild (`tuple`, `record`, `dictionary`, or a reference to
 * a type alias).
 */
export function absorbScalarsIntoCells(
  collectionType: Readonly<Type>,
  scalarTypes: ReadonlyArray<Type>
): Type {
  // A transparent alias of a collection is unfolded FIRST, so the scalars
  // fold into the cells it names and the result is the structure, never the
  // alias name: `0.5 · L` for `L: myints` (an alias of `list<integer>`) is
  // `list<real>`, which the name `myints` no longer describes. This holds
  // with no scalars too (`L + L` is `list<integer>`): the alias policy of
  // the broadcast lift types every cell-wise result by what it builds.
  // Only the operand itself is unfolded; an alias in the CELLS is left to
  // the `reference` exclusion below, which is what keeps this recursion
  // terminating.
  collectionType = resolveTypeAlias(collectionType);
  if (scalarTypes.length === 0) return collectionType as Type;
  // A `broadcastable<S>` co-operand is either a scalar `S` or an indexed
  // collection of `S` that zips with these cells (a length mismatch is an
  // `incompatible-dimensions` error, not a wider result), so its per-CELL
  // contribution is `S`. Widening the wrapper itself into the cells nested it
  // inside the collection (`list<broadcastable<number>^2>`), a type no
  // evaluated value has.
  // Range/sign decorations are stripped before any cell JOIN below: a join
  // is a set union, and neither a sum nor a product of a cell and a scalar
  // lies in the union of their ranges (see `stripNumericRanges`).
  const scalars = scalarTypes.map((t) =>
    stripNumericRanges(
      typeof t !== 'string' && t.kind === 'broadcastable' ? t.elements : t
    )
  );
  // The cell type ONE level down, not the type one index yields. On a `list`
  // kind a multi-dimensional shape lives in `dimensions` rather than in nested
  // `elements`, so read `elements` directly: `collectionElementType` would
  // answer a `matrix`'s ROW type (`vector`), and widening a scalar into that
  // produced the nonsense `list<list<integer | vector>>` for `2Y`.
  const elt =
    typeof collectionType !== 'string' && collectionType.kind === 'list'
      ? collectionType.elements
      : collectionElementType(collectionType);
  if (elt === undefined || elt === 'any') return collectionType as Type;
  // `elements` is the LEAF only when it is a scalar. A DIMENSIONLESS nested
  // collection (`list<list<number>>`, the type of `List(L, L)` for
  // `L: list<number>`) carries its inner shape in `elements` instead, so the
  // scalar folds into the INNER cells: recurse. Widening a scalar against a
  // collection cell would produce `list<integer | list<number>>` — a
  // union of a scalar and a collection, which is never inhabited by the
  // evaluated value (every element stays a list) and makes
  // `type.matches('collection')` answer a confident `false`.
  let cell: Type;
  if (isSubtype(elt, COLLECTION_SHAPE_TYPE)) {
    // A TUPLE cell is a point/vector, and a scalar scales each of its
    // COMPONENTS: `[(3,4)] · 0.5` is `[(1.5, 2)]`, so a
    // `list<tuple<integer, integer>>` scaled by a real has REAL components and
    // echoing the integer ones would claim a type the value contradicts.
    // Rebuild the tuple with each component widened, one arity-preserving
    // level — unlike the kinds excluded below, whose parts are not uniformly
    // scaled.
    if (typeof elt !== 'string' && elt.kind === 'tuple')
      return {
        ...(collectionType as Extract<Type, { kind: string }>),
        elements: {
          kind: 'tuple',
          elements: elt.elements.map((e) => ({
            ...e,
            type: widen(stripNumericRanges(e.type), ...scalars),
          })),
        },
      } as Type;
    // Only the kinds whose `elements` is a single rebuildable cell type can be
    // recursed into. A `record`/`dictionary` cell, or a `reference` to a
    // (possibly recursive) alias, keeps the collection type unchanged: sound
    // but imprecise, and never a scalar-plus-collection union. Not following
    // `reference.def` here is also what keeps this recursion terminating — a
    // type cycle can only close through that edge.
    if (
      typeof elt === 'string' ||
      (elt.kind !== 'list' &&
        elt.kind !== 'collection' &&
        elt.kind !== 'indexed_collection' &&
        elt.kind !== 'set')
    )
      return collectionType as Type;
    cell = absorbScalarsIntoCells(elt, scalars);
  } else {
    cell = widen(stripNumericRanges(elt), ...scalars);
    // Neither sum nor product is closed over `imaginary`: `i + (-i) = 0` and
    // `i · i = -1` are both real. `complex` covers the closure — the
    // same repair the scalar tail of `addType` applies to its final widen.
    if (cell === 'imaginary') cell = 'complex';
  }
  // Nothing was sharpened (the new cell type is equivalent to the element
  // type, either because the widen added nothing or because the nested recursion
  // came back unchanged): hand back the original spelling so `2·(1..4)` still
  // types as it did.
  if (isSubtype(cell, elt)) return collectionType as Type;
  // Rebuild in place only for the kinds whose `elements` IS a single cell
  // type. A `tuple` keeps an ARRAY there, a `record` a field map and a
  // `dictionary` none at all, so writing a cell type into those would produce
  // a malformed type; they keep their own spelling.
  if (typeof collectionType !== 'string') {
    if (
      collectionType.kind === 'list' ||
      collectionType.kind === 'collection' ||
      collectionType.kind === 'indexed_collection' ||
      collectionType.kind === 'set'
    )
      return { ...collectionType, elements: cell };
    return collectionType as Type;
  }
  return { kind: 'indexed_collection', elements: cell };
}

/** The tuple ELEMENT type of `x` when `x` is statically a list of points —
 *  a `list`/`indexed_collection` whose element type is a tuple — or
 *  `undefined`. The type must be DEFINITELY a rank-1 list: a union with a
 *  scalar branch (`number | list<tuple<…>>`) is not one, since that branch
 *  produces no list at run time. A literal point list carries a length
 *  (`list<tuple<integer, integer>^2>`); it qualifies like a dimensionless
 *  one, which is why this does not use `broadcastCollectionElementType`
 *  (that helper leaves every dimensioned list to tensor typing). */
function pointListElementType(x: Expression): Type | undefined {
  const t = resolveTypeAlias(x.type.type);
  if (typeof t === 'string') return undefined;
  if (t.kind !== 'list' && t.kind !== 'indexed_collection') return undefined;
  if (t.kind === 'list' && (t.dimensions?.length ?? 0) > 1) return undefined;
  const elt = t.elements;
  return typeof elt !== 'string' && elt.kind === 'tuple' ? elt : undefined;
}

/**
 * The component-wise sum type of operands that are ALL tuples of one arity
 * when at least one component is a list-shaped collection, or `undefined`
 * when the operands are not that shape (a non-tuple operand, tuples of
 * different arities, or all-scalar components, which `widen` types exactly).
 *
 * At each position the component types combine the way `addType` combines
 * whole operands: a list-shaped component absorbs the scalar components at
 * that position into its cells (`number + list<number>` is `list<number>`),
 * and scalar-only positions widen. The result keeps the tuple kind, with the
 * component names dropped: a sum has no field names to preserve.
 */
function tupleComponentwiseAddType(
  args: ReadonlyArray<Expression>
): Type | undefined {
  const tuples: TupleType[] = [];
  for (const x of args) {
    const t = resolveTypeAlias(x.type.type);
    if (typeof t === 'string' || t.kind !== 'tuple') return undefined;
    tuples.push(t);
  }
  const arity = tuples[0].elements.length;
  if (tuples.some((t) => t.elements.length !== arity)) return undefined;
  const isListShaped = (t: Type): boolean => {
    const r = resolveTypeAlias(t);
    return (
      r === 'list' ||
      (typeof r !== 'string' &&
        (r.kind === 'list' || r.kind === 'indexed_collection'))
    );
  };
  if (!tuples.some((t) => t.elements.some((e) => isListShaped(e.type))))
    return undefined;
  const elements: NamedElement[] = [];
  for (let i = 0; i < arity; i++) {
    const components = tuples.map((t) => stripNumericRanges(t.elements[i].type));
    const lists = components.filter(isListShaped);
    if (lists.length === 0) {
      // A sum is not closed over `imaginary` (`i + (−i) = 0` is real):
      // `complex` covers the closure — the same repair the scalar tail of
      // `addType` applies, and `absorbScalarsIntoCells` applies to a cell.
      const scalar = widen(...components);
      elements.push({ type: scalar === 'imaginary' ? 'complex' : scalar });
      continue;
    }
    const scalars = components.filter((c) => !isListShaped(c));
    elements.push({ type: absorbScalarsIntoCells(widen(...lists), scalars) });
  }
  return { kind: 'tuple', elements };
}

export function addType(args: ReadonlyArray<Expression>): Type | BoxedType {
  if (args.length === 0) return 'integer'; // = 0
  if (args.length === 1) return args[0].type;
  // Numeric tuples (points/vectors) add component-wise, preserving the tuple
  // type. Handle ANY tuple presence before the NaN/finiteness early-returns: a
  // tuple's `isFinite` is `false`, which would otherwise collapse the result to
  // `number`. When every operand is a tuple the widened tuple type is exact;
  // when a tuple is mixed with an unknown/scalar operand, `widen` reports the
  // honest heterogeneous type (e.g. `any`) rather than claiming `number`.
  // COULD-semantics (`couldBeNumericTuple`): a tuple whose elements type
  // `unknown` (e.g. `(S(x,y,0), S(x,y,1))` with `S: (…) -> unknown`) is still
  // statically a tuple, so its sums keep a tuple type too (Tycho item 30).
  if (args.some((x) => couldBeNumericTuple(x))) {
    // A point BROADCAST over a list of points: `[(0,0),(3,4)] + (1,2)` adds
    // the point to every element, so the sum is a list of points, not the
    // union `list<tuple<…>> | tuple<…>` the widen below would report. That
    // union is not merely loose: a consumer that routes on the type — the
    // `PointX`/`PointY` lowering of the JavaScript compile target — reads a
    // non-list type as ONE point and indexes the list's first element
    // (Tycho item 234). The result keeps the list kind and widens the point's
    // component types with the list's element tuple. Only a list whose
    // ELEMENT type is provably a tuple qualifies: a list of scalars plus a
    // point is a per-element `incompatible-type` error in the value path
    // and keeps the honest union.
    const pointLists = args.filter(
      (x) => !couldBeNumericTuple(x) && pointListElementType(x) !== undefined
    );
    if (
      pointLists.length > 0 &&
      args.every(
        (x) => couldBeNumericTuple(x) || pointListElementType(x) !== undefined
      )
    )
      return broadcastResultType(
        widen(
          ...args.map((x) =>
            stripNumericRanges(
              couldBeNumericTuple(x) ? x.type.type : pointListElementType(x)!
            )
          )
        )
      );
    // Tuples of the same arity add COMPONENT-WISE, and a component that is a
    // list broadcasts against the other operands' components at that
    // position: `(g_x, g_y) + (L, L₂)` evaluates to the tuple
    // `(g_x + L, g_y + L₂)` — a tuple of two lists. `widen` does not see
    // positions, so it reported the union
    // `tuple<list<number>, list<number>> | tuple<number, number>`, a type no
    // evaluated value ever has; a consumer that routes on the type (a layout
    // classifier over the JavaScript compile target's output) cannot admit a
    // union of two layouts (Tycho item 246). Only a tuple with a list-shaped
    // component takes this branch: for all-scalar tuples `widen` already
    // answers the exact component-wise type.
    const componentwise = tupleComponentwiseAddType(args);
    if (componentwise !== undefined) return componentwise;
    return widen(...args.map((x) => stripNumericRanges(x.type.type)));
  }
  // Element-wise sum of a single tensor (vector/matrix) with scalars keeps the
  // tensor's shape/type. The list-broadcast wrapper is skip-listed for tensor
  // Add (addTensors handles the value), so the honest list type must come from
  // here — this also removes the `number | vector<n>` union artifact that the
  // final `widen` used to produce.
  const tensors = args.filter((x) => isTensorValue(x));
  if (tensors.length === 1) {
    const others = args.filter((x) => !isTensorValue(x));
    // Only SCALAR co-operands fold into the cells: a collection-TYPED
    // co-operand (an unevaluated matrix-valued `Multiply`, a declared
    // matrix symbol) is a sibling collection, not a cell contributor —
    // fall through to the collection branch below for those.
    // `isBroadcastCollectionType` is asked as well because it is the only one
    // of the two that descends a UNION: an operand typed
    // `number | list<number>` is a sibling collection too, and folding its raw
    // union into the cells claimed `list<number | list<number>>` for a sum
    // whose every branch has plain `number` cells.
    if (
      others.every(
        (x) => !isLinearAlgebraCollection(x) && !isBroadcastCollectionType(x)
      )
    ) {
      // The scalar co-operands fold INTO the cells elementwise, so the
      // honest result cell type widens the tensor's cells with the scalar
      // types: `[1,2] + x` has `number` cells, not `integer` — the
      // declared type must remain a sound UPPER bound of the evaluated
      // value (the honest literal cell type made verbatim propagation
      // over-narrow).
      return absorbScalarsIntoCells(
        tensors[0].type.type,
        others.map((x) => x.type.type)
      );
    }
  }
  // Collection-typed operands (declared matrix/vector/list symbols, OR a
  // `Multiply` etc. that the type handlers now type as a collection — e.g.
  // `2Y`, `-1·Y` for `X-Y`, `3X`) widen to the collection type. Hoisted above
  // the NaN/finiteness early-returns: a collection's `isFinite` is `false`
  // (like a tuple's), which would otherwise collapse the sum to `number`
  // (this is why `X-Y`/`3X+2Y` used to mis-type once their scaled terms
  // became collection-typed). The final `widen` still produces the honest
  // `integer | matrix` union for a scalar-plus-matrix mix like `X+1`.
  if (args.some((x) => isLinearAlgebraCollection(x))) {
    // A BROADCAST-shaped collection operand (list-kind: `vector<n>`, `matrix`,
    // `list<E>`) absorbs scalar operands elementwise — `V+1`, `matrix+1`,
    // `2·[1,2,3]+a` all evaluate to the collection, never to a scalar. Widen
    // over the collection operands ONLY, so no unreachable scalar arm enters
    // the result. This matters beyond tidiness: union matching is all-members,
    // so a `integer | vector<3>` makes `type.matches('collection')`
    // answer a confident `false` on a value that is always a collection
    // (Tycho item 67 — consumers route on exactly that query; it also made
    // `MatrixMultiply(row, aM₁+M₂)` reject a valid matrix operand).
    // Generic `collection`/`indexed_collection`-kind operands are NOT included
    // in the trigger: they may be a non-indexed `set` at runtime, which the
    // value path never broadcasts, so those keep the honest widen.
    const isBroadcastShaped = (x: Expression) =>
      isFixedShapeCollection(x) || isBroadcastCollectionType(x);
    const shaped = args.filter(isBroadcastShaped);
    if (
      shaped.length > 0 &&
      args.every(
        (x) => isBroadcastShaped(x) || isSubtype(x.type.type, 'number')
      )
    ) {
      // `broadcastSiblingType` collapses a `scalar | list<E>` operand to the
      // one collection type its every branch produces here; without it the
      // raw union widened into the result and its collection branch ended up
      // inside the cells.
      // Strip range decorations from every contribution: with NO scalar
      // co-operands the cell absorption below returns immediately, and a
      // sum of two `list<real<-1..>>` operands must not keep the `-1`
      // bound its cells can cross (see `stripNumericRanges`).
      const collected = widen(
        ...shaped.map((x) =>
          stripNumericRanges(broadcastSiblingType(x.type.type))
        )
      );
      // The scalar operands fold INTO the cells elementwise (no scalar arm
      // in the result — item 67), so they widen the CELL type, keeping the
      // declared type a sound upper bound: `2·[1,2,3] + a` has `number`
      // cells (`vector<3>`), not `integer` — the evaluated value's
      // elements include `a`.
      const scalars = args.filter((x) => !isBroadcastShaped(x));
      return absorbScalarsIntoCells(
        collected,
        scalars.map((x) => x.type.type)
      );
    }
    return widen(...args.map((x) => stripNumericRanges(x.type.type)));
  }
  // An operand whose collection-ness is not statically visible (a top
  // `unknown`/`any`/`value` leaf such as an undeclared `h(x)`, or an already-
  // `broadcastable<…>` inner node) makes the sum `broadcastable<T>`: it might
  // broadcast at runtime or stay scalar. Hoisted above the NaN/finiteness
  // early-returns for the same reason as the collection branch — a
  // broadcastable inner node has no meaningful `isFinite`, and an
  // `unknown`-typed leaf's `isNaN`/`isFinite` are `undefined`, so it would
  // otherwise fall through to the scalar `widen` tail and mis-type. The
  // `imaginary` → `complex` closure is applied inside the helper.
  if (args.some((x) => isPossiblyCollectionTyped(x)))
    return broadcastableResultTypeOf(args);
  if (args.some((x) => x.isNaN)) return 'number';
  // A provably non-finite operand may be visible only in its static TYPE:
  // `Ln(0)`, `Artanh(1)` and a symbol declared `+oo | -oo` have no
  // value to probe before evaluation; `provablyNonFiniteNumber` reads that
  // type path (see `BoxedFunction`/`BoxedSymbol` `isInfinity`). Its
  // `matches('number')` qualifier also keeps a non-number operand the shape
  // branches above did not take — a `set`-typed operand, a union — out of
  // the non-finite arm (`isFinite === false` alone would admit it, since
  // `isFinite` answers `false` for any non-number type).
  // (+∞) + (−∞) = NaN: two or more non-finite operands can cancel to NaN.
  const nonFinite = args.filter((x) => provablyNonFiniteNumber(x));
  if (nonFinite.length >= 2) return 'number';
  if (nonFinite.length === 1) {
    // Exactly one provably non-finite term (non-finite typing convention):
    // - a real ±∞ plus terms that are all real and not provably non-finite
    //   (unknown finiteness = generic point) is provably ±∞;
    // - a non-real non-finite term (`~oo`, `∞ + i`, …), or a non-real
    //   companion term, can produce `~oo`/NaN/non-finite complex values that
    //   only the top type `number` admits.
    const nf = nonFinite[0];
    if (
      nf.isExtendedReal === true &&
      args.every((x) => x === nf || x.isExtendedReal === true)
    )
      return SIGNED_INFINITY_TYPE;
    return 'number';
  }
  // Ranges and sign exclusions are stripped from the join inputs: a sum
  // does not lie in the union of its terms' ranges (`x, y > −1` does not
  // put `x + y` above −1; `−|x| + |y|` is not non-negative). The bare tiers
  // ARE closed under addition, so the join drops the unsound bound — and
  // the SOUND bound is then recomputed separately, below, by interval
  // arithmetic over the operands.
  const t = widen(...args.map((x) => stripNumericRanges(x.type.type)));
  // `imaginary + imaginary` is not closed under addition: the imaginary parts
  // can cancel to 0, which is *real* (P0-13). 0 is `integer` and the
  // non-cancelling sums stay `imaginary`, both covered by `complex`.
  if (t === 'imaginary') return 'complex';
  // Interval refinement (the interval-arithmetic half of ROADMAP "Ranged
  // types…", plan doc `docs/plans/2026-08-27-interval-arithmetic-result-
  // types.md`): fold the operands' intervals with interval ADDITION — a
  // different computation from the join above, and sound where the join
  // is not (`x, y > 2` puts `x + y` above 4). The claim attaches only to
  // a NaN-free real tier, and aborts if any operand carries no interval.
  return attachInterval(
    t,
    foldIntervalsOfTypes(
      args.map((x) => x.type.type),
      addIntervals
    )
  );
}

export function add(...xs: ReadonlyArray<Expression>): Expression {
  console.assert(xs.length > 0);
  if (!xs.every((x) => x.isValid)) return xs[0].engine._fn('Add', xs);

  // Ellipsis fold barrier: a direct `ContinuationPlaceholder` operand makes
  // this a notational sum; stay inert (do not fold via `Terms`).
  if (xs.some((x) => isContinuationOperand(x)))
    return xs[0].engine._fn(
      'Add',
      xs.map((x) => x.canonical)
    );

  // A term that is collection-TYPED but has no collection value yet (a
  // declared-but-unassigned `list<number>` symbol) is not a broadcast
  // participant, so each branch below would splice it whole into every cell as
  // if it were a scalar — freezing an outer sum into the stored form. Decline
  // the element-wise dispatch and leave the sum inert; once the operand
  // resolves, re-evaluating that sum zips.
  const unresolvedTerm = hasUnresolvedCollectionOperand(
    xs,
    isBroadcastableCollection
  );
  // The one thing that outranks the veto: a length disagreement among the terms
  // that DO have values. No assignment to the unresolved term can reconcile 2
  // elements against 3, so the sum is reported as an error instead of held —
  // the same error `Add([1,2], [3,4,5])` gives without the unresolved term.
  if (unresolvedTerm) {
    const mismatch = broadcastLengthMismatch(xs[0].engine, xs);
    if (mismatch) return mismatch;
  }

  // An unknown/infinite-length indexed collection (a `Cycle`, a `Filter`, a
  // symbolic-length `Range`) can't be materialized or eagerly zipped without
  // truncating — return the lazy `Map` form. Checked BEFORE the tensor and
  // finite-broadcast branches so a mixed finite+infinite sum (`Add(List(…),
  // Cycle(…))`, where the finite `List` is a rank-1 tensor) maps ALL
  // collections as `Map` sources rather than routing to `addTensors`, which
  // would broadcast over the finite operand and splice the infinite one whole.
  // A finite tensor never triggers this (its `count` is known-finite), so pure
  // tensor sums fall through unchanged. Tuples stay atomic
  // (`isBroadcastableCollection` excludes them).
  if (!unresolvedTerm && xs.some(isUnknownLengthBroadcast))
    return lazyBroadcastMap(
      xs[0].engine,
      'Add',
      xs,
      isBroadcastableCollection,
      false
    );

  // Check if any operands are tensors
  const hasTensors = xs.some((x) => isTensorValue(x));
  if (!unresolvedTerm && hasTensors) {
    const r = addTensors(xs[0].engine, xs);
    if (r) return r;
  }

  // Broadcast over a non-tensor finite indexed collection that only became a
  // collection through evaluation — e.g. `L^2 - 2` = `Add(-2, List(1,4,9))`,
  // where `Power(L, 2)` already evaluated to a plain (non-tensor) List. The
  // pre-evaluation broadcast in `_computeValue` misses these (the raw operand
  // was still a `Power`), and `Add` is lazy, so the shape only surfaces here.
  // Checked BEFORE the tuple branch (mirroring `mul`) so a collection wins the
  // dispatch and a mixed `List + Tuple` (point-list + point) broadcasts the
  // tuple over the list instead of falling inert in `addTuples`. Tuples
  // themselves are excluded — they add component-wise, never broadcast.
  if (!unresolvedTerm && xs.some((x) => isFiniteBroadcastParticipant(x))) {
    const r = broadcastOverIndexedCollections(
      xs[0].engine,
      'Add',
      xs,
      false,
      true
    );
    if (r) return r;
  }

  // Tuples (points/vectors, incl. a tuple with a collection component such as
  // `(-6, n)` with `n` a list) add component-wise (never broadcast).
  if (xs.some((x) => isTuple(x))) return addTuples(xs[0].engine, xs, false);

  return new Terms(xs[0].engine, xs).asExpression();
}

export function addN(...xs: ReadonlyArray<Expression>): Expression {
  console.assert(xs.length > 0);
  if (!xs.every((x) => x.isValid)) return xs[0].engine._fn('Add', xs);

  // Ellipsis fold barrier: stay inert for a notational sum.
  if (xs.some((x) => isContinuationOperand(x)))
    return xs[0].engine._fn(
      'Add',
      xs.map((x) => x.canonical)
    );

  // A collection-TYPED but valueless term vetoes the element-wise dispatch
  // here exactly as it does on the exact route (see `add`).
  let unresolvedTerm = hasUnresolvedCollectionOperand(
    xs,
    isBroadcastableCollection
  );
  // A definite length disagreement outranks the veto here too (see `add`).
  if (unresolvedTerm) {
    const mismatch = broadcastLengthMismatch(xs[0].engine, xs);
    if (mismatch) return mismatch;
  }

  // Unknown/infinite-length indexed collection → lazy `Map` (see `add`, which
  // documents why this precedes the tensor branch); the `N`-wrap threads
  // through so elements float on access.
  if (!unresolvedTerm && xs.some(isUnknownLengthBroadcast))
    return lazyBroadcastMap(
      xs[0].engine,
      'Add',
      xs,
      isBroadcastableCollection,
      true
    );

  // Check if any operands are tensors
  const hasTensors = xs.some((x) => isTensorValue(x));
  if (!unresolvedTerm && hasTensors) {
    // Evaluate tensors numerically
    xs = xs.map((x) => (isTensorValue(x) ? x.evaluate() : x.N()));
    const r = addTensors(xs[0].engine, xs);
    if (r) return r;
  }

  // Broadcast over a non-tensor finite indexed collection (see `add` — checked
  // before the tuple branch so `List + Tuple` broadcasts; tuples excluded).
  if (!unresolvedTerm && xs.some((x) => isFiniteBroadcastParticipant(x))) {
    const r = broadcastOverIndexedCollections(
      xs[0].engine,
      'Add',
      xs,
      true,
      true
    );
    if (r) return r;
  }

  // Tuples (points/vectors) add component-wise (never broadcast). An INERT
  // result (still an `Add`) falls through: a raw sibling operand (an
  // unevaluated `Multiply` that yields a tuple, say) blocks the combine
  // here, but becomes visible to the post-evaluation re-dispatch below,
  // whose tuple branch returns unconditionally (Tycho item 52).
  // A collection-TYPED co-operand that is not yet a collection by capability
  // (a pure raw operand, evaluated once by the `.N()` map below) would be
  // mis-combined here as a point component; the post-evaluation re-dispatch
  // sees it as the collection it becomes — see the matching guard in `mulN`.
  let tupleInert = false;
  if (xs.some((x) => isTuple(x))) {
    if (xs.some((x) => !isTuple(x) && isBroadcastCollectionType(x)))
      tupleInert = true;
    else {
      const r = addTuples(xs[0].engine, xs, true);
      if (r.operator !== 'Add') return r;
      tupleInert = true;
    }
  }

  // Don't N() the number literals (fractions) to avoid losing precision
  xs = xs.map((x) => (isNumber(x) ? x.evaluate() : x.N()));

  // Post-evaluation re-dispatch (Tycho item 52): an operand may only have
  // BECOME a collection through the numeric evaluation above (`Mod(L,11)`
  // over a list `L` → a lazy `Map`) — the raw-operand dispatches missed it
  // and the sum was left inert (`0.2·collection + k` unreduced). Mirrors the
  // pre-evaluation branches; linear (no re-entry), so a non-broadcastable
  // fall-through can't loop. Gated on a function-headed mapped operand so
  // the hot all-numeric path (every element of a broadcast drain) pays a
  // single cheap `isFunction` sweep, not per-operand type computations.
  if (tupleInert || xs.some((x) => isFunction(x))) {
    // Recomputed over the numericized operands: `.N()` can turn a raw operand
    // into a collection, which changes who the participants are.
    unresolvedTerm = hasUnresolvedCollectionOperand(
      xs,
      isBroadcastableCollection
    );
    if (unresolvedTerm) {
      const mismatch = broadcastLengthMismatch(xs[0].engine, xs);
      if (mismatch) return mismatch;
    }
    if (!unresolvedTerm && xs.some(isUnknownLengthBroadcast))
      return lazyBroadcastMap(
        xs[0].engine,
        'Add',
        xs,
        isBroadcastableCollection,
        true
      );
    if (!unresolvedTerm && xs.some((x) => isTensorValue(x))) {
      const rt = addTensors(xs[0].engine, xs);
      if (rt) return rt;
    }
    if (!unresolvedTerm && xs.some((x) => isFiniteBroadcastParticipant(x))) {
      const r = broadcastOverIndexedCollections(
        xs[0].engine,
        'Add',
        xs,
        true,
        true
      );
      if (r) return r;
    }
    if (xs.some((x) => isTuple(x))) return addTuples(xs[0].engine, xs, true);
  }

  return new Terms(xs[0].engine, xs).N();
}

/**
 * Add numeric tuples (points/vectors in ℝⁿ) component-wise.
 * - All operands literal tuples of equal arity → a component-wise `Tuple`.
 * - A scalar operand mixed in → `incompatible-type` (defensive; T2 rejects
 *   most `scalar + tuple` at canonicalization).
 * - Statically-known unequal arity → `incompatible-type` at evaluation.
 * - A symbolic tuple operand (no accessible components) → symbolic `Add`.
 */
function addTuples(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  numericApproximation: boolean
): Expression {
  // A declared/literal scalar cannot be added to a point. A merely-inferred
  // scalar stays symbolic (inference is retractable — see
  // `isProvablyScalarNumber`), falling through to the symbolic `Add` below.
  if (ops.some((x) => isProvablyScalarNumber(x)))
    return ce.error(['incompatible-type', 'tuple', 'number']);

  // Enforce equal arity when statically known.
  const arities = ops.map((x) => numericTupleArity(x));
  const arity = arities[0];
  if (
    arity !== undefined &&
    arities.every((a) => a !== undefined) &&
    !arities.every((a) => a === arity)
  )
    return ce.error(['incompatible-type', 'tuple', 'tuple']);

  // Compute now only when every tuple exposes its components; otherwise stay
  // symbolic (e.g. `z + (1,2)` with `z` a tuple-typed symbol).
  if (!ops.every((x) => hasAccessibleComponents(x) && isFunction(x)))
    return ce._fn('Add', ops);

  const n = isFunction(ops[0]) ? ops[0].nops : 0;
  const components: Expression[] = [];
  for (let i = 0; i < n; i++) {
    // Evaluate each part first: a raw component like `0.3n` with `n` a list
    // must materialize before the sum, or the recursive `add`/`addN` sees a
    // non-iterable operand and stays inert.
    const parts = ops.map((x) => {
      const c = isFunction(x) ? x.ops[i] : x;
      return numericApproximation ? c.N() : c.evaluate();
    });
    components.push(numericApproximation ? addN(...parts) : add(...parts));
  }
  return ce.tuple(...components);
}

/**
 * Add tensors element-wise, with scalar broadcasting support.
 * - Tensor + Tensor: element-wise addition (shapes must match)
 * - Scalar + Tensor: broadcast scalar to all elements
 */
function addTensors(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  // Separate tensors and scalars. Pack each tensor operand once, here at
  // entry (not per element access below).
  const tensors: Tensor<TensorDataType>[] = [];
  const scalars: Expression[] = [];

  for (const op of ops) {
    const evaluated = op.evaluate();
    if (isTensorValue(evaluated)) {
      const packed = packTensor(ce, evaluated);
      // A tensor-VALUED operand that fails to pack (non-kernel-admissible
      // cells — colors, tuples, …) must NOT fall into the scalar bucket:
      // "adding" a whole collection to every cell would produce a wrong,
      // nested result. Decline the entire kernel; the caller falls through
      // to the generic elementwise broadcast path.
      if (!packed) return undefined;
      tensors.push(packed);
    } else {
      // A COLLECTION that is not a tensor value (a `Range`, a `Filter`/
      // `Take`/`Reverse` view, or the lazy `Map` that a broadcast over more
      // than `MAX_SIZE_EAGER_COLLECTION` elements produces) must NOT fall
      // into the scalar bucket: the loops below start each cell's sum at the
      // combined SCALAR sum, so a collection there makes every cell of the
      // result a whole collection — `[1,2,3] + [4,5,6] + Range(1,3)` became
      // `[[6,7,8],[8,9,10],[10,11,12]]` instead of the element-wise
      // `[6,9,12]`, with only the diagonal correct. Decline the kernel so the
      // caller falls through to `broadcastOverIndexedCollections`, which zips
      // it. The `tensors.length < 2` decline below does NOT cover this: two
      // plain lists plus one collection view leaves exactly two tensors.
      // Tuples are excluded by `isBroadcastableCollection` — they add
      // component-wise by design (`addTuples`).
      if (isBroadcastableCollection(evaluated)) return undefined;
      scalars.push(evaluated);
    }
  }

  // A lone tensor combined only with scalars is an *elementwise* broadcast
  // (scalar added to every cell). Per the tensor-view design that case uses
  // the generic broadcast path (no packing), which preserves the honest cell
  // type of the result; `addTensors` re-boxes to a literal `List` that takes
  // the legacy numeric-lift type. Decline here so the caller falls through to
  // `broadcastOverIndexedCollections`. Also covers the "nothing packed"
  // case (every tensor-valued operand was non-kernel-admissible, e.g. a
  // point-list of tuples). Genuine tensor⊗tensor sums stay on this path.
  if (tensors.length < 2) return undefined;

  // Get the reference shape from the first tensor
  const referenceShape = tensors[0].shape;

  // Validate all tensors have the same shape
  for (let i = 1; i < tensors.length; i++) {
    const shape = tensors[i].shape;
    if (
      shape.length !== referenceShape.length ||
      !shape.every((dim, j) => dim === referenceShape[j])
    ) {
      return ce.error(
        'incompatible-dimensions',
        `${referenceShape.join('x')} vs ${shape.join('x')}`
      );
    }
  }

  // Compute scalar sum (to add to each element)
  let scalarSum: Expression = ce.Zero;
  for (const s of scalars) {
    scalarSum = scalarSum.add(s);
  }

  // For vectors (rank 1)
  if (referenceShape.length === 1) {
    const n = referenceShape[0];
    const result: Expression[] = [];
    for (let i = 0; i < n; i++) {
      let sum = scalarSum;
      for (const tensor of tensors) {
        // tensor.at() uses 1-based indexing for vectors
        const val = tensor.at(i + 1) ?? ce.Zero;
        sum = sum.add(ce.expr(val));
      }
      result.push(sum.evaluate());
    }
    return ce.expr(['List', ...result]);
  }

  // For matrices (rank 2)
  if (referenceShape.length === 2) {
    const [m, n] = referenceShape;
    const rows: Expression[] = [];
    for (let i = 0; i < m; i++) {
      const row: Expression[] = [];
      for (let j = 0; j < n; j++) {
        let sum = scalarSum;
        for (const tensor of tensors) {
          // tensor.at(row, col) uses 1-based indexing
          const val = tensor.at(i + 1, j + 1) ?? ce.Zero;
          sum = sum.add(ce.expr(val));
        }
        row.push(sum.evaluate());
      }
      rows.push(ce.expr(['List', ...row]));
    }
    return ce.expr(['List', ...rows]);
  }

  // For higher-rank tensors, return unevaluated for now
  return ce._fn('Add', [...ops]);
}

//
// Terms class — represents a sum of terms with coefficients
//

// Represent a sum of terms
export class Terms {
  private engine: ComputeEngine;
  private terms: { coef: NumericValue[]; term: Expression }[] = [];

  constructor(ce: ComputeEngine, terms: ReadonlyArray<Expression>) {
    this.engine = ce;
    let posInfinityCount = 0;
    let negInfinityCount = 0;
    // We're going to keep track of numeric values in an array, so that we can
    // sum them exactly at the end (some inexact values may cancel each other,
    // for example (0.1 - 0.1 + 1/4) -> 1/4.
    // If we added as we go, we would get 0.25.
    const numericValues: NumericValue[] = [];
    for (const term of terms) {
      // `~oo` absorbs the whole sum: adding anything to the single undirected
      // point at infinity leaves it there, and it must be caught HERE, before
      // the signed-infinity counters below — those track only real ±∞ and
      // would otherwise return `+oo` for `∞ + ~oo`, silently dropping the
      // `~oo` term.
      //
      // The test is on the VALUE, not the type: `~oo` types `number` (the
      // non-finite typing convention admits an undirected infinity at the top
      // type only), so a `complex` type test — which is what this guard used —
      // no longer selects it. An infinity with a non-zero imaginary part is
      // exactly the undirected one: a real ±∞ has `im === 0`.
      if (term.isInfinity && isNumber(term) && term.im !== 0) {
        this.terms = [{ term: ce.ComplexInfinity, coef: [] }];
        return;
      }
      if (term.isNaN || isSymbol(term, 'Undefined')) {
        this.terms = [{ term: ce.NaN, coef: [] }];
        return;
      }

      const [coef, rest] = term.toNumericValue();
      if (coef.isPositiveInfinity) posInfinityCount += 1;
      else if (coef.isNegativeInfinity) negInfinityCount += 1;

      if (rest.isSame(1)) {
        if (!coef.isZero) numericValues.push(coef);
      } else this._add(coef, rest);
    }

    if (posInfinityCount > 0 && negInfinityCount > 0) {
      this.terms = [{ term: ce.NaN, coef: [] }];
      return;
    }
    if (posInfinityCount > 0) {
      this.terms = [{ term: ce.PositiveInfinity, coef: [] }];
      return;
    }
    if (negInfinityCount > 0) {
      this.terms = [{ term: ce.NegativeInfinity, coef: [] }];
      return;
    }
    if (numericValues.length === 1) {
      this._add(numericValues[0], ce.One);
    } else if (numericValues.length > 0) {
      // We're doing an exact sum, we may have multiple terms: a
      // rational and a radical. We need to sum them separately.
      nvSum(ce, numericValues).forEach((x) => this._add(x, ce.One));
    }
  }

  private _add(coef: NumericValue, term: Expression): void {
    if (term.isSame(0) || coef.isZero) return;
    if (term.isSame(1)) {
      // We have a numeric value. Keep it in the terms,
      // so that "1+sqrt(3)" remains exact.
      const ce = this.engine;
      this.terms.push({ coef: [], term: ce.number(coef) });
      return;
    }

    if (isFunction(term, 'Add')) {
      for (const x of term.ops) {
        const [c, t] = x.toNumericValue();
        this._add(coef.mul(c), t);
      }
      return;
    }

    if (isFunction(term, 'Negate')) {
      this._add(coef.neg(), term.op1);
      return;
    }

    // Try to find a like term, i.e. if "2x", look for "x"
    const i = this.find(term);
    if (i >= 0) {
      // There was an existing term matching: add the coefficients
      this.terms[i].coef.push(coef);
      return;
    }

    // This is a new term: just add it
    console.assert(!isNumber(term) || term.isSame(1));
    this.terms.push({ coef: [coef], term });
  }

  private find(term: Expression): number {
    return this.terms.findIndex((x) => x.term.isSame(term));
  }

  N(): Expression {
    const ce = this.engine;

    const terms = this.terms;

    if (terms.length === 0) return ce.Zero;

    const rest: Expression[] = [];
    const numericValues: NumericValue[] = [];

    // Gather all the numericValues and the rest
    for (const { coef, term } of terms) {
      if (coef.length === 0) {
        if (isNumber(term)) {
          if (typeof term.numericValue === 'number')
            numericValues.push(ce._numericValue(term.numericValue));
          else numericValues.push(term.numericValue);
        } else rest.push(term);
      } else {
        const sum = coef.reduce((acc, x) => acc.add(x)).N();

        if (sum.isZero) continue;

        if (sum.eq(1)) rest.push(term.N());
        else if (sum.eq(-1)) rest.push(term.N().neg());
        else rest.push(term.N().mul(ce.expr(sum)));
      }
    }

    const sum = nvSumN(ce, numericValues);
    if (!sum.isZero) {
      if (rest.length === 0) return ce.expr(sum);
      rest.push(ce.expr(sum));
    }
    return canonicalAdd(ce, rest);
  }

  asExpression(): Expression {
    const ce = this.engine;

    const terms = this.terms;

    if (terms.length === 0) return ce.Zero;

    return canonicalAdd(
      ce,
      terms.map(({ coef, term }) => {
        // Add the coefficients
        if (coef.length === 0) return term;

        const coefs = nvSum(ce, coef);
        if (coefs.length === 0) return term;
        if (coefs.length > 1) {
          const coefSum = canonicalAdd(
            ce,
            coefs.map((x) => ce.expr(x))
          );
          if (term.isSame(1)) return coefSum;
          return ce._fn('Multiply', [coefSum, term].sort(order));
        }
        const sum = coefs[0];
        if (sum.isNaN) return ce.NaN;
        if (sum.isZero) return ce.Zero;
        if (sum.eq(1)) return term;
        if (sum.eq(-1)) return term.neg();
        if (term.isSame(1)) return ce.expr(sum);

        return term.mul(ce.expr(sum));
      })
    );
  }
}

function nvSum(
  ce: ComputeEngine,
  numericValues: NumericValue[]
): NumericValue[] {
  const factory: NumericValueFactory =
    ce.precision > MACHINE_PRECISION
      ? (x) => new BigNumericValue(x)
      : (x) => new MachineNumericValue(x);
  return ExactNumericValue.sum(numericValues, factory);
}

function nvSumN(
  ce: ComputeEngine,
  numericValues: NumericValue[]
): NumericValue {
  const makeExact = (x: ConstructorParameters<typeof ExactNumericValue>[0]) =>
    new ExactNumericValue(x, factory);
  const factory: NumericValueFactory =
    ce.precision > MACHINE_PRECISION
      ? (x) => new BigNumericValue(x)
      : (x) => new MachineNumericValue(x);
  const result = ExactNumericValue.sum(numericValues, factory);

  if (result.length === 0) return makeExact(0);
  if (result.length === 1) return result[0].N();

  return result.reduce((acc, x) => acc.add(x).N());
}
