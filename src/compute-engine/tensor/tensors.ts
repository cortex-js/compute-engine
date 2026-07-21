import { Complex } from 'complex-esm';
import { getSupertype, makeTensorField } from './tensor-fields.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  DataTypeMap,
  TensorData,
  TensorDataType,
  NestedArray,
  Tensor,
  TensorField,
} from '../global-types.js';

// @todo: See also:
// - https://github.com/scalanlp/breeze/wiki/Linear-Algebra-Cheat-Sheet
// - https://mathjs.org/docs/datatypes/matrices.html
// - http://sylvester.jcoglan.com/api/matrix.html#random
// - https://www.statmethods.net/advstats/matrix.html
// https://ctan.math.illinois.edu/macros/latex/required/tools/array.pdf

// Abstract class for all tensors (vectors, matrices, tensors, etc.)
//
// The data is stored in a linear array, the shape indicates how to
// interpret the data as a tensor.
//
// - expression-dtype tensor: a general purpose tensor (lists of lists of lists ...) with arbitrary elements (Expression).
// Has limited support for operations.
// - Vector: a column vector (1D tensor) of scalars (numbers, boolean, Complex). Has full support for operations.
// - Matrix: a matrix (2D tensor) of scalars. Has full support for operations.
/** @category Tensors */
export abstract class AbstractTensor<
  DT extends keyof DataTypeMap,
> implements Tensor<DT> {
  /**
   * Return a tuple of tensors that have the same dtype.
   * If necessary, one of the two input tensors is upcast.
   *
   * This harmonizes only the *dtype*; it does not reshape. Element-wise
   * callers (see `broadcast`) must ensure the shapes are compatible.
   *
   * @param lhs
   * @param rhs
   */
  static align<T1 extends TensorDataType, T2 extends TensorDataType>(
    lhs: AbstractTensor<T1>,
    rhs: AbstractTensor<T2>
  ): [AbstractTensor<T1>, AbstractTensor<T1>];
  static align<T1 extends TensorDataType, T2 extends TensorDataType>(
    lhs: AbstractTensor<T1>,
    rhs: AbstractTensor<T2>
  ): [AbstractTensor<T2>, AbstractTensor<T2>];
  static align<T1 extends TensorDataType, T2 extends TensorDataType>(
    lhs: AbstractTensor<T1>,
    rhs: AbstractTensor<T2>
  ):
    | [AbstractTensor<T1>, AbstractTensor<T1>]
    | [AbstractTensor<T2>, AbstractTensor<T2>]
    | undefined {
    // Same dtype? Return the tensors as is
    if ((lhs.dtype as T1) === (rhs.dtype as unknown as T1))
      return [lhs, rhs as unknown as AbstractTensor<T1>];

    const dtype = getSupertype(lhs.dtype, rhs.dtype);
    if (lhs.dtype === dtype)
      return [lhs, rhs.upcast(dtype) as AbstractTensor<T1>];
    return [lhs.upcast(dtype) as AbstractTensor<T2>, rhs];
  }

  /**
   * Apply a function to the elements of two tensors, or to a tensor
   * and a scalar.
   *
   * The tensors are aligned and broadcasted if necessary.
   *
   * @param fn
   * @param lhs
   * @param rhs
   * @returns
   */
  static broadcast<T extends TensorDataType>(
    fn: (lhs: DataTypeMap[T], rhs: DataTypeMap[T]) => DataTypeMap[T],
    lhs: AbstractTensor<T>,
    rhs: AbstractTensor<T> | DataTypeMap[T]
  ): AbstractTensor<T> {
    // If the rhs is a scalar, broadcast it to a tensor
    if (!(rhs instanceof AbstractTensor)) return lhs.map1(fn, rhs);

    // Harmonize the data types of the two tensors
    const [lhs_, rhs_] = AbstractTensor.align(lhs, rhs);

    // This helper performs an element-wise operation; it requires identical
    // shapes (it does not implement NumPy-style shape broadcasting). Mismatched
    // shapes previously produced silent garbage (e.g. `[2,2]` op `[3]` →
    // `[…, null]` with shape `[2,2]`); fail loudly instead. (Callers such as
    // the `Add`/`Multiply` handlers already reject incompatible dimensions
    // upstream, so this is a defensive guard.)
    if (
      lhs_.shape.length !== rhs_.shape.length ||
      lhs_.shape.some((d, i) => d !== rhs_.shape[i])
    ) {
      throw new Error(
        `Cannot broadcast tensors of incompatible shapes [${lhs_.shape}] and [${rhs_.shape}]`
      );
    }

    // Broadcast the data
    const data = lhs_.data.map((v, i) => fn(v, rhs_.data[i]));

    return makeTensor(lhs_.ce, {
      dtype: lhs_.dtype,
      shape: lhs_.shape,
      data,
    });
  }

  // The arithmetic operations that can be performed on the
  // elements of the tensor, based on the datatype
  readonly field: TensorField<DataTypeMap[DT]>;

  readonly shape: number[];
  readonly rank: number;

  private readonly _strides: number[];

  constructor(
    private ce: ComputeEngine,
    tensorData: TensorData<DT>
  ) {
    this.shape = tensorData.shape;
    this.rank = this.shape.length;
    this._strides = getStrides(this.shape);
    this.field = makeTensorField<DT>(ce, tensorData.dtype);
  }

  abstract get dtype(): DT;
  abstract get data(): DataTypeMap[DT][];

  // A Boxed Expression that represents the tensor
  get expression(): Expression {
    // Recursively fill the tensor with expressions
    // according to the shape

    // Base case: scalar
    // if (this.rank === 0) return ce.number(this.data[0]);

    // Recursive case: tensor
    const shape = this.shape;
    const rank = this.rank;
    const data = this.data;
    const index = this._index.bind(this);
    const expression = this.field.expression.bind(this.field);
    const fill = (indices: number[]): Expression => {
      if (indices.length === rank - 1) {
        // Base case: vector
        const idx = index(indices);
        return this.ce._fn(
          'List',
          data.slice(idx, idx + shape[rank - 1]).map((x) => expression(x))
        );
      } else {
        // Recursive case: tensor
        const list: Expression[] = [];
        for (let i = 1; i <= shape[indices.length]; i++)
          list.push(fill([...indices, i]));

        return this.ce._fn('List', list);
      }
    };
    return fill([]);
  }

  /**
   * Like expression(), but return a nested JS array instead
   * of a Expression
   */
  get array(): NestedArray<DataTypeMap[DT]> {
    const shape = this.shape;
    const rank = this.rank;
    const data = this.data;

    if (rank === 1) return data;
    if (rank === 2) {
      const [m, n] = shape;
      const array: DataTypeMap[DT][][] = new Array(m);
      for (let i = 0; i < m; i++) array[i] = data.slice(i * n, (i + 1) * n);
      return array;
    }

    const index = this._index.bind(this);
    const fill = (indices: number[]): NestedArray<DataTypeMap[DT]> => {
      if (indices.length === rank - 1) {
        // Base case: vector
        const idx = index(indices);
        return data.slice(idx, idx + shape[rank - 1]);
      } else {
        // Recursive case: tensor
        const list: NestedArray<DataTypeMap[DT]>[] = [];
        for (let i = 0; i < shape[indices.length]; i++)
          list.push(fill([...indices, i + 1]));

        return list;
      }
    };
    return fill([]);
  }

  /** Indices are 1-based, return a 0-based index in the data */
  private _index(indices: number[]): number {
    const strides = this._strides;
    return indices.reduce((acc, val, dim) => acc + (val - 1) * strides[dim], 0);
    // let index = 0;
    // for (let i = 0; i < indices.length; i++) {
    //   index += indices[i] * this._strides[i];
    // }
    // return index;
  }

  get isSquare(): boolean {
    const shape = this.shape;
    return shape.length === 2 && shape[0] === shape[1];
  }

  // A square matrix that is equal to its transpose. A^T = A
  get isSymmetric(): boolean {
    if (!this.isSquare) return false;
    const n = this.shape[0];
    const data = this.data;
    const eq = this.field.equals.bind(this.field);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (!eq(data[i * n + j], data[j * n + i])) return false;
    return true;
  }

  // Aka antisymmetric matrix, skew-symmetric matrix, or antimetric matrix
  // A square matrix whose transpose is also its negative. A^T = -A
  get isSkewSymmetric(): boolean {
    if (!this.isSquare) return false;
    const n = this.shape[0];
    const data = this.data;
    const eq = this.field.equals.bind(this.field);
    const neg = this.field.neg.bind(this.field);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (!eq(data[i * n + j], neg(data[j * n + i]))) return false;
    return true;
  }

  // All entries below the diagonal are zero.
  get isUpperTriangular(): boolean {
    if (!this.isSquare) return false;
    const n = this.shape[0];
    const data = this.data;
    const isZero = this.field.isZero.bind(this.field);
    for (let i = 1; i < n; i++)
      for (let j = 0; j < i; j++) if (!isZero(data[i * n + j])) return false;
    return true;
  }

  // All entries above the diagonal are zero.
  get isLowerTriangular(): boolean {
    // Check if the matrix is lower triangular
    if (!this.isSquare) return false;
    const n = this.shape[0];
    const data = this.data;
    const isZero = this.field.isZero.bind(this.field);
    for (let i = 0; i < n - 1; i++)
      for (let j = i + 1; j < n; j++)
        if (!isZero(data[i * n + j])) return false;
    return true;
  }

  get isTriangular(): boolean {
    // Triangular = upper-triangular or lower-triangular.
    return this.isUpperTriangular || this.isLowerTriangular;
  }

  get isDiagonal(): boolean {
    // Diagonal = every off-diagonal entry is zero (diagonal entries are free).
    if (!this.isSquare) return false;
    const n = this.shape[0];
    const data = this.data;
    const isZero = this.field.isZero.bind(this.field);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (i !== j && !isZero(data[i * n + j])) return false;
    return true;
  }

  get isIdentity(): boolean {
    if (!this.isSquare) return false;
    const [_m, n] = this.shape;
    const data = this.data;
    const isOne = this.field.isOne.bind(this.field);
    const isZero = this.field.isZero.bind(this.field);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (
          (i === j && !isOne(data[i * n + j])) ||
          (i !== j && !isZero(data[i * n + j]))
        )
          return false;
    return true;
  }

  get isZero(): boolean {
    const isZero = this.field.isZero.bind(this.field);
    return this.data.every((e) => isZero(e));
  }

  /**
   *  The number of indices should match the rank of the tensor.
   *
   * Note: the indices are 1-based
   * Note: the data is broadcast (wraps around) if the indices are out of bounds
   *
   * LaTeX notation `A\lbracki, j\rbrack` or `A_{i, j}`
   */
  at(...indices: number[]): DataTypeMap[DT] {
    const l = this.data.length;
    return this.data[this._index(indices) % l];
  }

  diagonal(axis1?: number, axis2?: number): undefined | DataTypeMap[DT][] {
    axis1 ??= 1;
    axis2 ??= 2;
    const rank = this.shape.length;
    if (axis1 === axis2) return undefined;
    if (axis1 <= 0 || axis1 > rank) return undefined;
    if (axis2 <= 0 || axis2 > rank) return undefined;

    const ax1 = axis1 - 1;
    const ax2 = axis2 - 1;
    if (this.shape[ax1] !== this.shape[ax2]) return undefined;

    // Step along the diagonal using the strides of the two requested axes
    // (the previous `data[i*n+i]` hard-coded a 2D, axes-(1,2) layout and gave
    // wrong values for rank > 2 or non-default axes). For rank > 2 this
    // returns the diagonal of the (axis1, axis2) plane at the origin of the
    // other axes.
    const n = this.shape[ax1];
    const strides = getStrides(this.shape);
    const step = strides[ax1] + strides[ax2];
    const diag: DataTypeMap[DT][] = new Array(n);
    const data = this.data;
    for (let i = 0; i < n; i++) diag[i] = data[i * step];
    return diag;
  }

  // Trace is the sum of the diagonal entries of a square matrix.
  // `\operatorname{tr}(A) = \sum_{i=1}^n a_{ii}`
  // For rank > 2, returns a tensor of traces over the last two axes (batch trace)
  trace(
    axis1?: number,
    axis2?: number
  ): undefined | DataTypeMap[DT] | AbstractTensor<DT> {
    const rank = this.rank;

    // For rank < 2, trace is not defined
    if (rank < 2) return undefined;

    // Default: trace over last two axes
    axis1 ??= rank - 1;
    axis2 ??= rank;

    // Convert to 0-based indices
    const ax1 = axis1 - 1;
    const ax2 = axis2 - 1;

    // Check that the two axes have the same size (required for trace)
    if (this.shape[ax1] !== this.shape[ax2]) return undefined;
    const traceSize = this.shape[ax1];

    // For rank 2, compute scalar trace
    if (rank === 2) {
      const data = this.data;
      const n = traceSize;
      const traceElements: DataTypeMap[DT][] = new Array(n);
      for (let i = 0; i < n; i++) traceElements[i] = data[i * n + i];
      return this.field.addn(...traceElements);
    }

    // For rank > 2, compute a tensor of traces
    // The result shape is the original shape with the two trace axes removed
    const resultShape = this.shape.filter((_, i) => i !== ax1 && i !== ax2);

    // Compute strides for the source tensor
    const srcStrides = getStrides(this.shape);

    // Number of elements in the result tensor
    const resultSize = resultShape.reduce((a, b) => a * b, 1);
    const resultData: DataTypeMap[DT][] = new Array(resultSize);

    // Compute strides for result shape (for iteration)
    const resultStrides = getStrides(resultShape);

    // For each element in the result tensor, compute the trace
    for (let resultIdx = 0; resultIdx < resultSize; resultIdx++) {
      // Convert flat result index to result multi-dimensional indices
      const resultIndices: number[] = new Array(resultShape.length);
      let remaining = resultIdx;
      for (let d = 0; d < resultShape.length; d++) {
        resultIndices[d] = Math.floor(remaining / resultStrides[d]);
        remaining = remaining % resultStrides[d];
      }

      // Map result indices to source indices (inserting 0s at ax1 and ax2)
      const srcIndices: number[] = new Array(rank);
      let rIdx = 0;
      for (let d = 0; d < rank; d++) {
        if (d === ax1 || d === ax2) {
          srcIndices[d] = 0; // Will be set in the trace loop
        } else {
          srcIndices[d] = resultIndices[rIdx++];
        }
      }

      // Compute trace: sum of diagonal elements
      const traceElements: DataTypeMap[DT][] = new Array(traceSize);
      for (let i = 0; i < traceSize; i++) {
        srcIndices[ax1] = i;
        srcIndices[ax2] = i;

        // Convert source indices to flat index
        let srcIdx = 0;
        for (let d = 0; d < rank; d++) {
          srcIdx += srcIndices[d] * srcStrides[d];
        }
        traceElements[i] = this.data[srcIdx];
      }
      resultData[resultIdx] = this.field.addn(...traceElements);
    }

    return makeTensor(this.ce, {
      dtype: this.dtype,
      shape: resultShape,
      data: resultData,
    });
  }

  /**
   * Change the shape of the tensor
   *
   * The data is reused (and shared) between the two tensors.
   */
  reshape(...shape: number[]): AbstractTensor<DT> {
    return makeTensor(this.ce, {
      dtype: this.dtype,
      shape,
      data: this.data,
    });
  }

  slice(index: number): AbstractTensor<DT> {
    if (index < 0) index = this.shape[0] + index + 1;

    if (this.rank === 0) return this;

    if (this.rank === 1) {
      const value = this.data[index - 1];
      return makeTensor(this.ce, {
        dtype: this.dtype,
        shape: [],
        data: [value],
      });
    }

    const _size = this.shape[1];
    const stride = this._strides[0];
    // `index` is 1-based (consistent with the rank-1 path above).
    const start = (index - 1) * stride;
    const end = start + stride;

    return makeTensor(this.ce, {
      dtype: this.dtype,
      shape: this.shape.slice(1),
      data: this.data.slice(start, end),
    });
  }

  flatten(): DataTypeMap[DT][] {
    return this.data;
  }

  upcast<DT extends keyof DataTypeMap>(dtype: DT): AbstractTensor<DT> {
    const data = this.field.cast(this.data, dtype);
    if (data === undefined) throw Error(`Cannot cast tensor to ${dtype}`);
    return makeTensor(this.ce, {
      dtype,
      shape: this.shape,
      data: data as DataTypeMap[DT][],
    });
  }

  /** Transpose the last two axes (default) */
  transpose(): undefined | AbstractTensor<DT>;
  /** Transpose two axes. */
  transpose(
    axis1: number,
    axis2: number,
    fn?: (v: DataTypeMap[DT]) => DataTypeMap[DT]
  ): undefined | AbstractTensor<DT>;
  transpose(
    axis1?: number,
    axis2?: number,
    fn?: (v: DataTypeMap[DT]) => DataTypeMap[DT]
  ): undefined | AbstractTensor<DT> {
    const rank = this.rank;

    // For rank 1 (vector), transpose is identity
    if (rank === 1) return this;

    // Default: swap last two axes
    axis1 ??= rank - 1;
    axis2 ??= rank;

    if (axis1 === axis2) return this;
    if (axis1 <= 0 || axis1 > rank) return undefined;
    if (axis2 <= 0 || axis2 > rank) return undefined;

    // Convert to 0-based indices
    const ax1 = axis1 - 1;
    const ax2 = axis2 - 1;

    // Calculate new shape (swap the two axes)
    const newShape = [...this.shape];
    [newShape[ax1], newShape[ax2]] = [newShape[ax2], newShape[ax1]];

    // Apply optional transformation function
    let data = this.data;
    if (fn) data = data.map((x) => fn(x));

    // For rank 2, use optimized path
    if (rank === 2) {
      const [m, n] = this.shape;
      let index = 0;
      const result: DataTypeMap[DT][] = new Array(m * n);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < m; j++) result[index++] = data[j * n + i];
      }
      return makeTensor(this.ce, {
        dtype: this.dtype,
        shape: newShape,
        data: result,
      });
    }

    // General case for rank > 2: compute transposed indices
    const totalSize = data.length;
    const result: DataTypeMap[DT][] = new Array(totalSize);

    // Compute strides for source and destination
    const srcStrides = getStrides(this.shape);
    const dstStrides = getStrides(newShape);

    // For each element in the result, find the corresponding source element
    for (let dstIdx = 0; dstIdx < totalSize; dstIdx++) {
      // Convert flat index to multi-dimensional indices in destination
      const dstIndices = new Array(rank);
      let remaining = dstIdx;
      for (let d = 0; d < rank; d++) {
        dstIndices[d] = Math.floor(remaining / dstStrides[d]);
        remaining = remaining % dstStrides[d];
      }

      // Swap the axes to get source indices
      const srcIndices = [...dstIndices];
      [srcIndices[ax1], srcIndices[ax2]] = [srcIndices[ax2], srcIndices[ax1]];

      // Convert source indices to flat index
      let srcIdx = 0;
      for (let d = 0; d < rank; d++) {
        srcIdx += srcIndices[d] * srcStrides[d];
      }

      result[dstIdx] = data[srcIdx];
    }

    return makeTensor(this.ce, {
      dtype: this.dtype,
      shape: newShape,
      data: result,
    });
  }

  // a^H or A^*, or A^\dagger : conjugate transpose, aka Hermitian transpose, aka adjoint
  // https://en.wikipedia.org/wiki/Conjugate_transpose
  // transpose, then apply the complex conjugate to each entry
  // (same as transpose if all entries are real)
  conjugateTranspose(
    axis1: number,
    axis2: number
  ): undefined | AbstractTensor<DT> {
    const conjugate = this.field.conjugate.bind(this.field);
    return this.transpose(axis1, axis2, conjugate);
  }

  determinant(): undefined | DataTypeMap[DT] {
    // Boolean tensors have no arithmetic field (`mul`/`add`/`div` are not
    // meaningful): bail out rather than crash. Reachable since overlap-
    // deferred validation (§D6.2) — a `list`-typed operand may evaluate to a
    // boolean tensor; the handler then declines (inert) instead of throwing.
    if (this.dtype === 'bool') return undefined;

    if (this.rank !== 2) return undefined;
    const [m, n] = this.shape;
    if (m !== n) return undefined;
    if (m === 1) return this.data[0];

    const add = this.field.add.bind(this.field);
    const mul = this.field.mul.bind(this.field);
    const neg = this.field.neg.bind(this.field);

    if (m === 2) {
      const [a, b, c, d] = this.data;
      return add(mul(a, d), neg(mul(b, c)));
    }

    const addn = this.field.addn.bind(this.field);
    const muln = this.field.muln.bind(this.field);

    if (m === 3) {
      const [a, b, c, d, e, f, g, h, i] = this.data;
      // Note: `addn`/`muln` are variadic — pass the terms as arguments, not as
      // a single array (an array argument would be string-concatenated).
      return addn(
        muln(a, e, i),
        muln(b, f, g),
        muln(c, d, h),
        neg(muln(c, e, g)),
        neg(muln(b, d, i)),
        neg(muln(a, f, h))
      );
    }

    // General case (n >= 4): fraction-free Bareiss elimination. Each division
    // is exact (the Bareiss identity), so integer matrices stay exact instead
    // of accumulating floating-point error. Operates on a mutable 2D copy of
    // the flat, row-major data (all indices 0-based).
    const div = this.field.div.bind(this.field);
    const sub = this.field.sub.bind(this.field);
    const isZero = this.field.isZero.bind(this.field);

    const M: DataTypeMap[DT][][] = [];
    for (let i = 0; i < m; i++) M.push(this.data.slice(i * m, (i + 1) * m));

    let sign = 1;
    let prev: DataTypeMap[DT] = this.field.one;
    for (let k = 0; k < m - 1; k++) {
      if (isZero(M[k][k])) {
        let pivotRow = -1;
        for (let r = k + 1; r < m; r++)
          if (!isZero(M[r][k])) {
            pivotRow = r;
            break;
          }
        // A zero column on/below the diagonal means the matrix is singular.
        if (pivotRow === -1) return this.field.zero;
        const tmp = M[k];
        M[k] = M[pivotRow];
        M[pivotRow] = tmp;
        sign = -sign;
      }
      const pivot = M[k][k];
      for (let i = k + 1; i < m; i++)
        for (let j = k + 1; j < m; j++)
          M[i][j] = div(sub(mul(M[i][j], pivot), mul(M[i][k], M[k][j])), prev);
      prev = pivot;
    }
    const det = M[m - 1][m - 1];
    return sign === -1 ? neg(det) : det;
  }

  inverse(): undefined | AbstractTensor<DT> {
    // Boolean tensors have no arithmetic field (`mul`/`add`/`div` are not
    // meaningful): bail out rather than crash. Reachable since overlap-
    // deferred validation (§D6.2) — a `list`-typed operand may evaluate to a
    // boolean tensor; the handler then declines (inert) instead of throwing.
    if (this.dtype === 'bool') return undefined;

    if (this.rank !== 2) return undefined;

    // Check it's a square matrix
    const [m, n] = this.shape;
    if (m !== n) return undefined;

    if (m === 2) {
      const [a, b, c, d] = this.data;
      const det = this.determinant();

      if (det === undefined || this.field.isZero(det)) return undefined;

      const div = this.field.div.bind(this.field);
      const neg = this.field.neg.bind(this.field);

      const inverseData = [
        div(d, det),
        neg(div(b, det)),
        neg(div(c, det)),
        div(a, det),
      ];

      return makeTensor(this.ce, {
        dtype: this.dtype,
        shape: [n, n],
        data: inverseData,
      });
    }

    // General case (n >= 3): Gauss-Jordan elimination on the augmented matrix
    // [A | I]. Operates on a mutable 2D copy (all indices 0-based). Returns
    // `undefined` if the matrix is singular.
    const div = this.field.div.bind(this.field);
    const sub = this.field.sub.bind(this.field);
    const mul = this.field.mul.bind(this.field);
    const isZero = this.field.isZero.bind(this.field);
    const one = this.field.one;
    const zero = this.field.zero;

    // Build [A | I]: each row has length 2n.
    const aug: DataTypeMap[DT][][] = [];
    for (let i = 0; i < m; i++) {
      const row = this.data.slice(i * m, (i + 1) * m);
      for (let j = 0; j < m; j++) row.push(i === j ? one : zero);
      aug.push(row);
    }

    for (let k = 0; k < m; k++) {
      // Ensure a non-zero pivot at (k, k), swapping a lower row up if needed.
      if (isZero(aug[k][k])) {
        let pivotRow = -1;
        for (let r = k + 1; r < m; r++)
          if (!isZero(aug[r][k])) {
            pivotRow = r;
            break;
          }
        if (pivotRow === -1) return undefined; // singular
        const tmp = aug[k];
        aug[k] = aug[pivotRow];
        aug[pivotRow] = tmp;
      }
      // Scale the pivot row so aug[k][k] === 1.
      const pivot = aug[k][k];
      for (let j = 0; j < 2 * m; j++) aug[k][j] = div(aug[k][j], pivot);
      // Clear the k-th column in every other row.
      for (let i = 0; i < m; i++) {
        if (i === k) continue;
        const factor = aug[i][k];
        if (isZero(factor)) continue;
        for (let j = 0; j < 2 * m; j++)
          aug[i][j] = sub(aug[i][j], mul(factor, aug[k][j]));
      }
    }

    // The right half of the reduced augmented matrix is the inverse.
    const inverseData: DataTypeMap[DT][] = [];
    for (let i = 0; i < m; i++)
      for (let j = m; j < 2 * m; j++) inverseData.push(aug[i][j]);

    return makeTensor(this.ce, {
      dtype: this.dtype,
      shape: [n, n],
      data: inverseData,
    });
  }

  // A^+ is the Moore-Penrose pseudoinverse of A. https://en.wikipedia.org/wiki/Moore%E2%80%93Penrose_inverse
  // Pseudoinverse can also be defined for scalars: the pseudoinverse of a scalar is its reciprocal if it is non-zero, and zero otherwise.
  pseudoInverse(): undefined | AbstractTensor<DT> {
    // Boolean tensors have no arithmetic field (`mul`/`add`/`div` are not
    // meaningful): bail out rather than crash. Reachable since overlap-
    // deferred validation (§D6.2) — a `list`-typed operand may evaluate to a
    // boolean tensor; the handler then declines (inert) instead of throwing.
    if (this.dtype === 'bool') return undefined;

    // @todo tensor
    return undefined;
  }

  // The adjugate, classical adjoint, or adjunct of a square matrix is the transpose of its cofactor matrix. https://en.wikipedia.org/wiki/Adjugate_matrix
  adjugateMatrix(): undefined | AbstractTensor<DT> {
    // Boolean tensors have no arithmetic field (`mul`/`add`/`div` are not
    // meaningful): bail out rather than crash. Reachable since overlap-
    // deferred validation (§D6.2) — a `list`-typed operand may evaluate to a
    // boolean tensor; the handler then declines (inert) instead of throwing.
    if (this.dtype === 'bool') return undefined;

    // @todo tensor
    return undefined;
  }

  // The determinant of the matrix obtained by deleting row i and column j from this matrix. https://en.wikipedia.org/wiki/Minor_(linear_algebra)
  minor(_i: number, _j: number): undefined | DataTypeMap[DT] {
    // @todo tensor
    return undefined;
  }

  map1(
    fn: (lhs: DataTypeMap[DT], rhs: DataTypeMap[DT]) => DataTypeMap[DT],
    scalar: DataTypeMap[DT]
  ): AbstractTensor<DT> {
    return makeTensor(this.ce, {
      dtype: this.dtype,
      shape: this.shape,
      data: this.data.map((v) => fn(v, scalar)),
    });
  }

  map2(
    fn: (lhs: DataTypeMap[DT], rhs: DataTypeMap[DT]) => DataTypeMap[DT],
    rhs: AbstractTensor<DT>
  ): AbstractTensor<DT> {
    const rhsData = rhs.data;
    return makeTensor(this.ce, {
      dtype: this.dtype,
      shape: this.shape,
      data: this.data.map((v, i) => fn(v, rhsData[i])),
    });
  }

  add(rhs: AbstractTensor<DT> | DataTypeMap[DT]): AbstractTensor<DT> {
    return AbstractTensor.broadcast(this.field.add.bind(this.field), this, rhs);
  }

  subtract(rhs: AbstractTensor<DT> | DataTypeMap[DT]): AbstractTensor<DT> {
    return AbstractTensor.broadcast(this.field.sub.bind(this.field), this, rhs);
  }

  // Hadamard product: \odot or \circ
  multiply(rhs: AbstractTensor<DT> | DataTypeMap[DT]): AbstractTensor<DT> {
    return AbstractTensor.broadcast(this.field.mul.bind(this.field), this, rhs);
  }

  divide(rhs: AbstractTensor<DT> | DataTypeMap[DT]): AbstractTensor<DT> {
    return AbstractTensor.broadcast(this.field.div.bind(this.field), this, rhs);
  }

  power(rhs: AbstractTensor<DT> | DataTypeMap[DT]): AbstractTensor<DT> {
    // `field.pow` takes the exponent as a `number`, while `broadcast` supplies
    // it as a tensor element (`DataTypeMap[DT]`). The exponent is numeric for
    // the tensor dtypes that support `power`, so adapt the signature here.
    const pow = (lhs: DataTypeMap[DT], exp: DataTypeMap[DT]): DataTypeMap[DT] =>
      this.field.pow(lhs, exp as number);
    return AbstractTensor.broadcast(pow, this, rhs);
  }

  // // aka inner product
  // dot(rhs: AbstractTensor<DT>): undefined | AbstractTensor<DT> {
  //   return undefined;
  // }

  // // aka matmul, \otimes or invisibleoperator
  // // generalization of the outer product
  // tensorProduct(rhs: AbstractTensor<DT>): AbstractTensor<DT>;

  // // generalization of kroneckerProduct
  // outerProduct(rhs: AbstractTensor<DT>): AbstractTensor<DT>;

  // // for 2d
  // kroneckerProduct(rhs: AbstractTensor<DT>): AbstractTensor<DT>;

  // // https://en.wikipedia.org/wiki/Frobenius_inner_product
  // // \langle A, B \rangle_F, Frobenius norm: \lVert A \rVert_F =
  // // \sqrt{\sum_{i,j} |a_{ij}|^2}
  // frobeniusProduct(rhs: AbstractTensor<DT>): DataTypeMap[DT];
  // crossProduct(rhs: AbstractTensor<DT>): AbstractTensor<DT>;
  // innerProduct(rhs: AbstractTensor<DT>): AbstractTensor<DT>;

  equals(rhs: AbstractTensor<DT>): boolean {
    if (this.rank !== rhs.rank) return false;
    if (!this.shape.every((x, i) => x === rhs.shape[i])) return false;
    const eq = this.field.equals.bind(this.field);
    const cast = this.field.cast.bind(this.field);
    const dtype = this.dtype;
    if (this.dtype !== rhs.dtype) {
      // Use cast if the types do not match
      if (
        !this.data.every((x, i) =>
          eq(x, cast(rhs.data[i], dtype) as DataTypeMap[DT])
        )
      )
        return false;

      return true;
    }
    return this.data.every((x, i) => eq(x, rhs.data[i]));
  }
}

function getStrides(shape: number[]): number[] {
  const strides = new Array(shape.length);
  for (let i = shape.length - 1, stride = 1; i >= 0; i--) {
    strides[i] = stride;
    stride *= shape[i];
  }
  return strides;
}

class NumberTensor extends AbstractTensor<'float64'> {
  readonly dtype = 'float64' as const;
  readonly data: number[];

  constructor(ce: ComputeEngine, data: TensorData<'float64'>) {
    super(ce, data);
    this.data = data.data as number[];
  }

  get isZero(): boolean {
    return this.data.every((x) => x === 0);
  }
}

class ComplexTensor extends AbstractTensor<'complex128'> {
  readonly dtype = 'complex128' as const;
  readonly data: Complex[];

  constructor(ce: ComputeEngine, data: TensorData<'complex128'>) {
    super(ce, data);
    this.data = data.data as Complex[];
  }
}

class BooleanTensor extends AbstractTensor<'bool'> {
  readonly dtype = 'bool' as const;
  readonly data: boolean[];

  constructor(ce: ComputeEngine, data: TensorData<'bool'>) {
    super(ce, data);
    this.data = data.data as boolean[];
  }
}

class GenericTensor extends AbstractTensor<'expression'> {
  readonly dtype = 'expression' as const;
  readonly data: Expression[];

  constructor(ce: ComputeEngine, data: TensorData<'expression'>) {
    super(ce, data);
    this.data = data.data as Expression[];
  }
}

/** @category Tensors */
export function makeTensor<T extends TensorDataType>(
  ce: ComputeEngine,
  data: TensorData<T>
): AbstractTensor<T> {
  const dtype: T = data.dtype;
  if (
    dtype === 'float64' ||
    dtype === 'float32' ||
    dtype === 'uint8' ||
    dtype === 'int32'
  )
    return new NumberTensor(
      ce,
      data as TensorData<'float64'>
    ) as AbstractTensor<T>;

  if (dtype === 'bool')
    return new BooleanTensor(
      ce,
      data as TensorData<'bool'>
    ) as AbstractTensor<T>;

  if (dtype === 'complex64' || dtype === 'complex128')
    return new ComplexTensor(
      ce,
      data as TensorData<'complex128'>
    ) as AbstractTensor<T>;

  return new GenericTensor(
    ce,
    data as TensorData<'expression'>
  ) as AbstractTensor<T>;
}

// 0 -> scalar
// 1 -> vector
// 2 -> 2D matrix
// export function rank(tensor: TensorData): number {
//   return tensor.shape.length;
// }
