/**
 * Tensor view over the unified `List` representation (Phase C of
 * `docs/plans/2026-07-20-tensor-unification-design.md`, §D2/§D4).
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

import { isSubtype } from '../../common/type/subtype.js';
import {
  getExpressionDatatype,
  getSupertype,
  makeTensorField,
} from '../tensor/tensor-fields.js';
import { makeTensor } from '../tensor/tensors.js';

import { isFunction, isTensor } from './type-guards.js';

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
    cur = cur.ops[0];
  }
  return dims;
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
  return isTensor(x);
}

/** The qualified shape of a tensor value, or `null` (see `isTensorValue`). */
export function tensorShape(x: Expression): number[] | null {
  if (!isFunction(x, 'List')) return null;
  const t = x.type.type;
  if (typeof t !== 'string' && t.kind === 'list' && t.dimensions !== undefined)
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
  if (!isFunction(x, 'List') || !isTensor(x)) return undefined;

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
  return makeTensor(ce, td as any);
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
    }
  | undefined {
  let dtype: TensorDataType | undefined = undefined;
  const shape: number[] = [];
  let valid = true;

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
      }
    }
  };

  visit(rows);
  return valid ? { shape, dtype: dtype! } : undefined;
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
