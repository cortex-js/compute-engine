import { getImaginaryFactor } from './utils.js';

import { flatten } from './flatten.js';
import { order, sortAddTerms } from './order.js';
import { Type } from '../../common/type/types.js';
import { widen } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import type {
  Expression,
  Tensor,
  TensorDataType,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isTensorValue, packTensor } from './tensor-view.js';
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
  couldBeNumericTuple,
  isNumericTuple,
  isTuple,
  numericTupleArity,
  hasAccessibleComponents,
  isDeclaredScalarNumber,
  isFiniteIndexedCollection,
  isBroadcastableCollection,
  isUnknownLengthBroadcast,
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
  // merely INFERRED — stay symbolic (inference is retractable evidence).
  if (
    ops.some((x) => isNumericTuple(x)) &&
    ops.some((x) => isDeclaredScalarNumber(x))
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

export function addType(args: ReadonlyArray<Expression>): Type | BoxedType {
  if (args.length === 0) return 'finite_integer'; // = 0
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
  if (args.some((x) => couldBeNumericTuple(x)))
    return widen(...args.map((x) => x.type.type));
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
    if (others.every((x) => !isLinearAlgebraCollection(x))) {
      // The scalar co-operands fold INTO the cells elementwise, so the
      // honest result cell type widens the tensor's cells with the scalar
      // types: `[1,2] + x` has `number` cells, not `finite_integer` — the
      // declared type must remain a sound UPPER bound of the evaluated
      // value (the honest literal cell type made verbatim propagation
      // over-narrow).
      const tt = tensors[0].type.type;
      if (typeof tt !== 'string' && tt.kind === 'list' && others.length > 0) {
        const cell = widen(tt.elements, ...others.map((x) => x.type.type));
        return { kind: 'list', elements: cell, dimensions: tt.dimensions };
      }
      return tt;
    }
  }
  // Collection-typed operands (declared matrix/vector/list symbols, OR a
  // `Multiply` etc. that the type handlers now type as a collection — e.g.
  // `2Y`, `-1·Y` for `X-Y`, `3X`) widen to the collection type. Hoisted above
  // the NaN/finiteness early-returns: a collection's `isFinite` is `false`
  // (like a tuple's), which would otherwise collapse the sum to `number`
  // (this is why `X-Y`/`3X+2Y` used to mis-type once their scaled terms
  // became collection-typed). The final `widen` still produces the honest
  // `finite_integer | matrix` union for a scalar-plus-matrix mix like `X+1`.
  if (args.some((x) => isLinearAlgebraCollection(x))) {
    // A BROADCAST-shaped collection operand (list-kind: `vector<n>`, `matrix`,
    // `list<E>`) absorbs scalar operands elementwise — `V+1`, `matrix+1`,
    // `2·[1,2,3]+a` all evaluate to the collection, never to a scalar. Widen
    // over the collection operands ONLY, so no unreachable scalar arm enters
    // the result. This matters beyond tidiness: union matching is all-members,
    // so a `finite_integer | vector<3>` makes `type.matches('collection')`
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
      const collected = widen(...shaped.map((x) => x.type.type));
      // The scalar operands fold INTO the cells elementwise (no scalar arm
      // in the result — item 67), so they widen the CELL type, keeping the
      // declared type a sound upper bound: `2·[1,2,3] + a` has `number`
      // cells (`vector<3>`), not `finite_integer` — the evaluated value's
      // elements include `a`.
      const scalars = args.filter((x) => !isBroadcastShaped(x));
      if (
        scalars.length > 0 &&
        typeof collected !== 'string' &&
        collected.kind === 'list'
      )
        return {
          kind: 'list',
          elements: widen(
            collected.elements,
            ...scalars.map((x) => x.type.type)
          ),
          dimensions: collected.dimensions,
        };
      return collected;
    }
    return widen(...args.map((x) => x.type.type));
  }
  // An operand whose collection-ness is not statically visible (a top
  // `unknown`/`any`/`value` leaf such as an undeclared `h(x)`, or an already-
  // `broadcastable<…>` inner node) makes the sum `broadcastable<T>`: it might
  // broadcast at runtime or stay scalar. Hoisted above the NaN/finiteness
  // early-returns for the same reason as the collection branch — a
  // broadcastable inner node has no meaningful `isFinite`, and an
  // `unknown`-typed leaf's `isNaN`/`isFinite` are `undefined`, so it would
  // otherwise fall through to the scalar `widen` tail and mis-type. The
  // `imaginary` → `finite_complex` closure is applied inside the helper.
  if (args.some((x) => isPossiblyCollectionTyped(x)))
    return broadcastableResultTypeOf(args);
  if (args.some((x) => x.isNaN)) return 'number';
  // (+∞) + (−∞) = NaN: two or more non-finite operands can cancel to NaN.
  const nonFinite = args.filter((x) => x.isFinite === false);
  if (nonFinite.length >= 2) return 'number';
  if (nonFinite.length === 1) {
    // Exactly one provably non-finite term (non-finite typing convention):
    // - a real ±∞ plus terms that are all real and not provably non-finite
    //   (unknown finiteness = generic point) is provably ±∞;
    // - a non-real non-finite term (`~oo`, `∞ + i`, …), or a non-real
    //   companion term, can produce `~oo`/NaN/non-finite complex values that
    //   only the top type `number` admits.
    const nf = nonFinite[0];
    if (nf.isReal === true && args.every((x) => x === nf || x.isReal === true))
      return 'non_finite_number';
    return 'number';
  }
  const t = widen(...args.map((x) => x.type.type));
  // `imaginary + imaginary` is not closed under addition: the imaginary parts
  // can cancel to 0, which is *real* (P0-13). 0 is `finite_integer` and the
  // non-cancelling sums stay `imaginary`, both covered by `finite_complex`.
  if (t === 'imaginary') return 'finite_complex';
  return t;
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
  if (xs.some(isUnknownLengthBroadcast))
    return lazyBroadcastMap(
      xs[0].engine,
      'Add',
      xs,
      isBroadcastableCollection,
      false
    );

  // Check if any operands are tensors
  const hasTensors = xs.some((x) => isTensorValue(x));
  if (hasTensors) {
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
  if (xs.some((x) => isFiniteIndexedCollection(x) && !isTuple(x))) {
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

  // Unknown/infinite-length indexed collection → lazy `Map` (see `add`, which
  // documents why this precedes the tensor branch); the `N`-wrap threads
  // through so elements float on access.
  if (xs.some(isUnknownLengthBroadcast))
    return lazyBroadcastMap(
      xs[0].engine,
      'Add',
      xs,
      isBroadcastableCollection,
      true
    );

  // Check if any operands are tensors
  const hasTensors = xs.some((x) => isTensorValue(x));
  if (hasTensors) {
    // Evaluate tensors numerically
    xs = xs.map((x) => (isTensorValue(x) ? x.evaluate() : x.N()));
    const r = addTensors(xs[0].engine, xs);
    if (r) return r;
  }

  // Broadcast over a non-tensor finite indexed collection (see `add` — checked
  // before the tuple branch so `List + Tuple` broadcasts; tuples excluded).
  if (xs.some((x) => isFiniteIndexedCollection(x) && !isTuple(x))) {
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
  let tupleInert = false;
  if (xs.some((x) => isTuple(x))) {
    const r = addTuples(xs[0].engine, xs, true);
    if (r.operator !== 'Add') return r;
    tupleInert = true;
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
    if (xs.some(isUnknownLengthBroadcast))
      return lazyBroadcastMap(
        xs[0].engine,
        'Add',
        xs,
        isBroadcastableCollection,
        true
      );
    if (xs.some((x) => isTensorValue(x))) {
      const rt = addTensors(xs[0].engine, xs);
      if (rt) return rt;
    }
    if (xs.some((x) => isFiniteIndexedCollection(x) && !isTuple(x))) {
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
  // `isDeclaredScalarNumber`), falling through to the symbolic `Add` below.
  if (ops.some((x) => isDeclaredScalarNumber(x)))
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
      if (term.type.is('complex') && term.isInfinity) {
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
