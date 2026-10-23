/**
 * Tensor view over the unified `List` representation (Phase C of
 * `docs/COLLECTIONS-MODEL.md`).
 *
 * Tensor-ness is a *view* on a canonical `List` value, not a distinct
 * representation:
 *
 * - `candidateShape` — O(rank) first-child-chain descent, for HOT dispatch
 *   sites only (§D4.2: never do O(cells) work per broadcast dispatch);
 * - `structuralShape` — the full O(cells) regularity walk, structural only;
 * - `isTensorValue` — the §D4.1 guard (an alias of `isTensor`): a `List`
 *   whose (generation-cached) honest type carries a shape claim. Because the
 *   type handler and this guard share one predicate, `isTensorValue`,
 *   `.shape`, `.rank` and `.type` can never disagree;
 * - `packTensor` — operation-local packing to an `AbstractTensor` for a
 *   kernel call. NEVER cached on the node: a pack made for one consumer
 *   (e.g. a lossy `float64` pack for `.N()`) must not leak into another.
 */

import type {
  IComputeEngine as ComputeEngine,
  Expression,
  Tensor,
  TensorDataType,
  TensorData,
  DataTypeMap,
} from '../global-types.js';

import { Complex } from 'complex.js';

import { isSubtype } from '../../common/type/subtype.js';
import {
  complexCellExpression,
  getExpressionDatatype,
  getSupertype,
  makeTensorField,
} from '../tensor/tensor-fields.js';
import { makeTensor } from '../tensor/tensors.js';

import { isFunction, isNumber, isSymbol, isTensor } from './type-guards.js';

/**
 * The value of a cell of a packed tensor (a value from `AbstractTensor.at()`
 * or `flatten()`) as an expression.
 *
 * A cell of a `complex128` tensor is a `Complex` computed in doubles: it is
 * a float, even when both its parts are integers
 * (`complexCellExpression()`). Any other cell (a double, a boolean, an
 * expression) is boxed by `ce.expr()`.
 *
 * `holdsFloat` is the flag of the tensor the cell comes from
 * (`TensorData.holdsFloat`). When it is true, a double or a real `Complex`
 * whose value is an integer is a float, not an exact integer: the tensor
 * was packed from a matrix with a float entry, or computed from such a
 * tensor.
 */
export function tensorCellExpression(
  ce: ComputeEngine,
  cell: unknown,
  holdsFloat: boolean = false
): Expression {
  if (cell instanceof Complex)
    return complexCellExpression(ce, cell, holdsFloat);
  if (holdsFloat && typeof cell === 'number' && Number.isInteger(cell))
    return ce.number(ce._inexactNumericValue(cell + 0));
  return ce.expr(cell as Parameters<ComputeEngine['expr']>[0]);
}

/**
 * For an element-wise operation (`Add`, `Multiply` over lists): which
 * elements of the list `x` are floats, in the row-major order of the cells
 * of `packed`, the tensor packed from `x`.
 *
 * Each element of the result of an element-wise operation follows its own
 * operands: a float element makes a float result, and an exact element
 * keeps an exact one (`[2.0, 1.5] + [1, 1]` is `[3.0, 2.5]`, and
 * `[1.5, 1] + [1, 1]` is `[2.5, 2]`). A cell of a packed tensor does not
 * record whether its element was exact, and the flag of the tensor
 * (`TensorData.holdsFloat`) applies to all its cells, so the elements are
 * read from `x`. Pass `mask[i]` as the `holdsFloat` argument of
 * `tensorCellExpression()` for the cell at index `i`.
 *
 * `undefined` when `packed` does not hold a float: then no element is a
 * float, and no walk is needed. A list of machine numbers (`ce.list()`)
 * gives `_numericStoreFloats` for every element: its integer values are
 * all floats or all exact.
 */
export function elementFloatMask(
  x: Expression,
  packed: Tensor<TensorDataType>
): readonly boolean[] | undefined {
  if (!packed.holdsFloat) return undefined;
  if (isFunction(x) && x._numericStore !== undefined)
    return new Array<boolean>(x._numericStore.length).fill(
      x._numericStoreFloats
    );
  const mask: boolean[] = [];
  const visit = (e: Expression): void => {
    if (isFunction(e, 'List')) {
      for (const op of e.ops) visit(op);
      return;
    }
    mask.push(isNumber(e) && !e.isExact);
  };
  visit(x);
  if (mask.length !== packed.data.length) return undefined;
  return mask;
}

/**
 * O(rank) candidate shape: descend the first-child chain of literal `List`
 * nodes — no row validation, no cell inspection, no type computation. The
 * ONLY level hot dispatch paths may consult (§D4.2). `null` when `x` is not
 * a `List`-operator expression.
 */
export function candidateShape(x: Expression): number[] | null {
  if (!isFunction(x, 'List')) return null;
  const dims: number[] = [];
  let cur: Expression = x;
  while (isFunction(cur, 'List')) {
    dims.push(cur.nops);
    if (cur.nops === 0) break;
    // A store-backed list (`ce.list()`) is a flat row of numbers: its
    // candidate shape ends here, and reading `ops[0]` would box it whole.
    if (cur._numericStore !== undefined) break;
    cur = cur.ops[0];
  }
  return dims;
}

/** The most elements of a finite collection that `numericCollectionAsList()`
 * reads. */
const MAX_COLLECTION_AS_LIST = 100_000;

/**
 * Is `x` a finite indexed collection of numbers that is not a list literal:
 * a `Range`, or a `Filter`, `Take` or `Reverse` view? In a product with a
 * matrix, such a collection is a vector, as the `List` of the same elements
 * is (`M·Range(1, 2)` is `M·[1, 2]`, the matrix-vector product). This reads
 * the type only and does not iterate.
 */
export function isNumericVectorSource(x: Expression): boolean {
  if (isTensorValue(x) || isFunction(x, 'List')) return false;
  if (x.isIndexedCollection !== true || x.isFiniteCollection !== true)
    return false;
  const t = x.type.type;
  if (!isSubtype(t, 'indexed_collection<number>')) return false;
  return !isSubtype(t, 'string') && !isSubtype(t, 'tuple');
}

/** The vector (a `List` literal) with the elements of `x` when
 * `isNumericVectorSource(x)` and it has at most 100 000 elements;
 * `undefined` otherwise. This iterates over `x`: call it only once a matrix
 * kernel is chosen. */
export function numericCollectionAsList(x: Expression): Expression | undefined {
  if (!isNumericVectorSource(x)) return undefined;
  const elements: Expression[] = [];
  for (const e of x.each()) {
    if (elements.length >= MAX_COLLECTION_AS_LIST) return undefined;
    elements.push(e);
  }
  return x.engine.function('List', elements);
}

/**
 * Whether the product of the factors `xs` is a product of tensors that the
 * `Multiply` handler computes (`mulTensors()` in `arithmetic-mul-div.ts`)
 * rather than the product of each entry: two or more factors are `List`
 * values (a `List` literal, or a symbol that holds one), one of them has
 * two axes or more, and they do not all have three axes or more.
 *
 * - With a matrix, the product is the matrix product.
 * - A tensor of rank 3 or more beside a vector or a matrix has no product:
 *   `mulTensors()` leaves it unevaluated, as for the same `List` literals.
 * - Tensors that all have rank 3 or more answer `false`: the broadcast
 *   pairs their elements, so two such tensors give the matrix product of
 *   each pair of matrices inside them, as `Power` gives the matrix power of
 *   each matrix inside such a tensor.
 *
 * The value that a symbol holds is read here, because the generic
 * element-wise broadcast and the broadcast of `mul()` see a symbol that holds
 * a list as a list, and multiplied two matrices entry by entry when they were
 * held by symbols typed `tensor<number>`, `list<list<number>>`, `list` or
 * `any`. A product of two vectors, or of a number and a matrix, answers
 * `false`: it stays the product of each entry.
 *
 * O(rank) for each factor (`candidateShape()`), so a hot dispatch site may
 * call it.
 */
export function isMatrixProductOfValues(
  xs: ReadonlyArray<Expression>
): boolean {
  let tensors = 0;
  let matrix = false;
  let belowRank3 = false;
  let vectorSources = 0;
  for (const x of xs) {
    const v = isSymbol(x) ? x.value : x;
    if (v === undefined) continue;
    const shape = candidateShape(v);
    if (shape === null) {
      // A `Range` or another finite collection of numbers is a vector. It is
      // classified by its type, without iterating over it: the iteration is
      // left to the matrix kernel (`numericCollectionAsList()`).
      if (isNumericVectorSource(v)) vectorSources += 1;
      continue;
    }
    tensors += 1;
    if (shape.length >= 2) matrix = true;
    if (shape.length < 3) belowRank3 = true;
  }
  if (matrix && vectorSources > 0) {
    tensors += vectorSources;
    belowRank3 = true;
  }
  return matrix && belowRank3 && tensors >= 2;
}

/**
 * Full structural regularity walk: every row length at every axis; mixed
 * leaf/nested levels, ragged rows, and empty levels → `null`. Purely
 * structural (no cell types).
 */
export function structuralShape(x: Expression): number[] | null {
  if (!isFunction(x, 'List')) return null;
  return structuralShapeOfOps(x.ops);
}

function structuralShapeOfOps(ops: ReadonlyArray<Expression>): number[] | null {
  if (ops.length === 0) return null; // empty level — never claimed
  let nested = 0;
  for (const op of ops) if (isFunction(op, 'List')) nested++;
  if (nested === 0) return [ops.length];
  if (nested !== ops.length) return null; // mixed leaf/nested
  const first = structuralShapeOfOps((ops[0] as any).ops);
  if (first === null) return null;
  for (let i = 1; i < ops.length; i++) {
    const s = structuralShapeOfOps((ops[i] as any).ops);
    if (s === null || s.length !== first.length) return null;
    for (let j = 0; j < s.length; j++) if (s[j] !== first[j]) return null;
  }
  return [ops.length, ...first];
}

/**
 * The §D4.1 tensor guard, retained under its historical name for the
 * (already-migrated) consumers. A thin alias of `isTensor` (`type-guards.ts`):
 * a canonical `List` whose honest type carries a shape claim (dimensions).
 * NOT for hot dispatch paths (reads `.type` on first access) — those use
 * `candidateShape`.
 *
 * Deliberately a plain-boolean wrapper (not a re-exported type predicate):
 * its consumers rely on `x` staying `Expression` in the negative branch —
 * because `Expression` already declares `shape`/`rank`, the predicate form's
 * `Expression & TensorInterface` collapses the else branch to `never`.
 */
export function isTensorValue(x: Expression): boolean {
  if (!isTensor(x)) return false;
  // A value with a zero extent (`[[], []]`, typed `matrix<never^(2x0)>`) has
  // no cell, so the tensor kernels have nothing to pack and decline it. The
  // consumers then take the route of a general collection: `Flatten([[],
  // []])` is `[]`, and `Trace` and `Norm` refuse the operand with an
  // `incompatible-type` error, as for any list that is not a tensor.
  const shape = tensorShape(x);
  return shape === null || !shape.includes(0);
}

/** The qualified shape of a tensor value, or `null` (see `isTensorValue`). */
export function tensorShape(x: Expression): number[] | null {
  if (!isFunction(x, 'List')) return null;
  const t = x.type.type;
  // The shape is the dimension list of the value's type. A `List` value is
  // typed from its cells, so it never carries the `null` dimensions of a
  // tensor of unknown rank; a type with no dimension list has no shape to
  // pack.
  if (typeof t !== 'string' && t.kind === 'list' && t.dimensions)
    return [...t.dimensions];
  return null;
}

/**
 * Operation-local packing: an `AbstractTensor` over the value's cells, for
 * one kernel call. `undefined` when the value is not a qualified tensor, or
 * its cells are not kernel-admissible. The result is NEVER cached on the node
 * (§D2.3b) — the List's ops remain the authoritative representation, so
 * packing is a per-operation decision, not a storage commitment.
 */
export function packTensor(
  ce: ComputeEngine,
  x: Expression,
  { numeric = false }: { numeric?: boolean } = {}
): Tensor<TensorDataType> | undefined {
  if (!isFunction(x, 'List') || !isTensorValue(x)) return undefined;

  // Kernel admissibility gate (§D5 retirement, type-based): only number- or
  // boolean-celled lists may enter a packed kernel. `isTensor` guarantees a
  // homogeneous, union-free dimensioned cell type, so a single element-type
  // check pre-vets admission — no per-cell walk, and the old
  // `CONTAINER_OPERATORS` blocklist is gone. Anything else (tuple/color/
  // string/… cells) declines here without walking, and arithmetic falls back
  // to the generic elementwise broadcast path.
  const t = x.type.type;
  const elements =
    typeof t !== 'string' && t.kind === 'list' ? t.elements : undefined;
  if (elements === undefined) return undefined;
  if (!isSubtype(elements, 'number') && !isSubtype(elements, 'boolean'))
    return undefined;

  // A store-backed list (`ce.list()`) packs from its numbers without boxing
  // an element: a `float64` tensor over a copy of the store. Under EXACT
  // evaluation the policy below still applies, so the fast path is taken
  // only when a float pack is what the operand walk would give too: not for
  // an all-integer store (an `expression` pack, boxed arithmetic), and not
  // for a store holding an integer outside the safe range, which the cell
  // classifier (`getExpressionDatatype`, `tensor-fields.ts`) packs as
  // `expression` so its products stay exact. Those cases fall through and
  // box the elements as the operand walk does.
  //
  // The tensor is a float tensor when an element of the store is a float:
  // the integer values of the store are floats (`_numericStoreFloats`), or
  // a finite value is not an integer. An infinity is boxed as an exact value,
  // and a NaN does not make the tensor a float tensor (see
  // `expressionTensorInfo()`).
  const store = x._numericStore;
  if (
    store !== undefined &&
    (numeric ||
      (!isSubtype(elements, 'integer') &&
        !store.some((v) => Number.isInteger(v) && !Number.isSafeInteger(v))))
  )
    return makeTensor(ce, {
      shape: [store.length],
      rank: 1,
      data: store.slice(),
      dtype: 'float64',
      holdsFloat:
        x._numericStoreFloats ||
        store.some((v) => Number.isFinite(v) && !Number.isInteger(v)),
    });

  const info = expressionTensorInfo(x.ops);
  if (!info?.dtype) return undefined;
  // Exactness (design §D2.3 policy): integer-classified cells are EXACT
  // values, and the int-backed kernels do JS-number arithmetic whose
  // intermediates (determinant products, large sums) can exceed 2^53 even
  // when every cell is safe — `det [[2^53−1,0],[0,3]]` rounded off-by-one.
  // Under exact `evaluate()`, pack them as `expression` (exact boxed
  // arithmetic). Under `.N()` (`numeric: true`), a float result is the
  // contract — pack `float64` (fast, lossy-by-nature, and it floats the
  // result: `Inverse([[2,1],[1,3]]).N()` → `[[0.6,…]]`, not rationals).
  const dtype =
    info.dtype === 'uint8' || info.dtype === 'int32'
      ? numeric
        ? ('float64' as const)
        : ('expression' as const)
      : info.dtype;
  const td = expressionAsTensor(ce, x.ops, info.shape, dtype);
  if (!td) return undefined;
  // A matrix with a float entry is a float tensor: every cell, and every
  // result computed from it, is read back as a float (`TensorData.holdsFloat`).
  // So `\det([[1.5, 0], [0, 2]])` is the float `3`, not the exact `3`.
  return makeTensor(ce, { ...td, holdsFloat: info.holdsFloat } as any);
}

/**
 * Structural packing (§D2.2 consumers — the model's shape-regularity, which
 * "applies to any cell type"): an `expression`-dtype tensor over any
 * STRUCTURALLY regular list, with NO cell-type qualification. For
 * structure-only operations (`Transpose`, `ConjugateTranspose`, `Reshape`,
 * …) that permute or relabel cells without numeric kernels — e.g. the
 * conjugate transpose of `[[1, 2+3i], [f(4-5i), 6]]`, whose application
 * cell blocks the *type* shape claim but not the *structural* one. Kernel
 * consumers (`Determinant`, `Inverse`, …) must use `packTensor`, never this.
 */
export function packStructural(
  ce: ComputeEngine,
  x: Expression
): Tensor<TensorDataType> | undefined {
  // A qualified tensor packs normally (may yield a faster numeric dtype).
  const packed = packTensor(ce, x);
  if (packed !== undefined) return packed;

  if (!isFunction(x, 'List')) return undefined;
  const shape = structuralShape(x);
  if (shape === null) return undefined;
  const td = expressionAsTensor(ce, x.ops, [...shape], 'expression');
  if (!td) return undefined;
  return makeTensor(ce, td as any);
}

// ---------------------------------------------------------------------------
// Packing implementation (moved from the deleted `boxed-tensor.ts` in Phase
// C). Shape/dtype classification and cell packing over a `List`'s ops. Cell
// admission is pre-vetted by the type gate in `packTensor`, so these do not
// re-check for container/string cells.
// ---------------------------------------------------------------------------

function expressionTensorInfo(rows: ReadonlyArray<Expression>):
  | {
      shape: number[];
      dtype: TensorDataType;
      /**
       * Is an entry a float: a number literal that is not exact, and is not
       * `NaN`? A `NaN` entry is not a float value. It reads back as `NaN`
       * from any cell, and the other cells keep their exactness:
       * `[1, NaN] / 2` is `[1/2, NaN]`.
       */
      holdsFloat: boolean;
    }
  | undefined {
  let dtype: TensorDataType | undefined = undefined;
  const shape: number[] = [];
  let valid = true;
  let holdsFloat = false;

  const visit = (t: ReadonlyArray<Expression>, axis = 0) => {
    if (!valid) return;
    const len = t.length;
    if (len === 0) return;

    // 1. shape check
    if (shape[axis] === undefined) {
      shape[axis] = len;
    } else if (shape[axis] !== len) {
      valid = false;
      return;
    }

    // 2. classify items
    let nestedCount = 0;
    for (const item of t) if (isFunction(item, 'List')) nestedCount++;
    const leafCount = len - nestedCount;

    // 3. mixed leaf + nested → invalid
    if (nestedCount > 0 && leafCount > 0) {
      valid = false;
      return;
    }

    // 4a. all nested → recurse
    if (nestedCount === len) {
      for (const item of t) {
        if (isFunction(item, 'List')) {
          visit(item.ops, axis + 1);
          if (!valid) return;
        }
      }
    }
    // 4b. all leaves → accumulate dtype.
    else {
      for (const item of t) {
        dtype = getSupertype(dtype, getExpressionDatatype(item));
        if (
          !holdsFloat &&
          isNumber(item) &&
          !item.isExact &&
          item.isNaN !== true
        )
          holdsFloat = true;
      }
    }
  };

  visit(rows);
  return valid ? { shape, dtype: dtype!, holdsFloat } : undefined;
}

function expressionAsTensor<T extends TensorDataType = 'expression'>(
  ce: ComputeEngine,
  rows: ReadonlyArray<Expression>,
  shape: number[],
  dtype: T
): TensorData<T> | undefined {
  let isValid = true;
  const data: DataTypeMap[T][] = [];
  const f = makeTensorField(ce, 'expression');
  const cast = f.cast.bind(f);
  const visit = (t: ReadonlyArray<Expression>, axis = 0) => {
    if (t.length === 0) return;

    if (shape[axis] === undefined) {
      shape[axis] = t.length;
    } else if (shape[axis] !== t.length) {
      isValid = false;
      return;
    }

    for (const item of t) {
      if (!isValid) return;
      if (isFunction(item, 'List')) visit(item.ops, axis + 1);
      else {
        const v = cast(item, dtype) as DataTypeMap[T] | undefined;
        if (v === undefined) {
          isValid = false;
          return;
        }
        data.push(v);
      }
    }
  };
  visit(rows);
  if (!isValid) return undefined;
  return { shape, rank: shape.length, data, dtype: dtype as T };
}
