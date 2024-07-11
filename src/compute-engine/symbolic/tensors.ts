import Complex from 'complex.js';
import { BoxedExpression, IComputeEngine } from '../public';
import {
  DataTypeMap,
  TensorDataType,
  TensorField,
  getSupertype,
  makeTensorField,
} from './tensor-fields';

/**
 * @noInheritDoc
 */
export interface TensorData<DT extends keyof DataTypeMap = 'float64'> {
  dtype: DT;
  shape: number[]; // dimension of each axis
  data: DataTypeMap[DT][]; // flattened data, stored in row-major order
}

export type NestedArray<T> = NestedArray_<T>[];
export type NestedArray_<T> = T | NestedArray_<T>[];

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
// - BoxedTensor: a general purpose tensor (lists of lists of lists ...) with arbitrary elements (BoxedExpression).
// Has limited support for operations.
// - Vector: a column vector (1D tensor) of scalars (numbers, boolean, Complex). Has full support for operations.
// - Matrix: a matrix (2D tensor) of scalars. Has full support for operations.
export abstract class AbstractTensor<DT extends keyof DataTypeMap>
  implements TensorData<DT>
{
  /**
   * Return a tuple of tensors that have the same dtype.
   * If necessary, one of the two input tensors is upcast.
   *
   * The shape of the tensors is reshape to a compatible
   * shape. If the shape is not compatible, `undefined` is returned.
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

    // Harmonize the data types and shapes of the two tensors
    const [lhs_, rhs_] = AbstractTensor.align(lhs, rhs);

    // Broadcast the data
    const data = lhs_.data.map((v, i) => fn(v, rhs_.data[i]));

    return makeTensor(lhs_.ce, { dtype: lhs_.dtype, shape: lhs_.shape, data });
  }

  // The arithmetic operations that can be performed on the
  // elements of the tensor, based on the datatype
  readonly field: TensorField<DataTypeMap[DT]>;

  readonly shape: number[];
  readonly rank: number;

  private readonly _strides: number[];

  constructor(
    private ce: IComputeEngine,
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
  get expression(): BoxedExpression {
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
    const fill = (indices: number[]): BoxedExpression => {
      if (indices.length === rank - 1) {
        // Base case: vector
        const idx = index(indices);
        const result = this.ce._fn(
          'List',
          data.slice(idx, idx + shape[rank - 1]).map((x) => expression(x))
        );
        result.isCanonical = result.ops!.every((x) => x.isCanonical);
        return result;
      } else {
        // Recursive case: tensor
        const list: BoxedExpression[] = [];
        for (let i = 0; i <= shape[indices.length] - 1; i++)
          list.push(fill([...indices, i + 1]));

        const result = this.ce._fn('List', list);
        result.isCanonical = result.ops!.every((x) => x.isCanonical);
        return result;
      }
    };
    return fill([]);
  }

  /**
   * Like expression(), but return a nested JS array instead
   * of a BoxedExpression
   */
  get array(): NestedArray<DataTypeMap[DT]> {
    const shape = this.shape;
    const rank = this.rank;
    const data: DataTypeMap[DT][] = this.data as any as DataTypeMap[DT][];

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
      for (let j = 0; j < i; j++) if (isZero(data[i * n + j])) return false;
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
    if (!this.isSquare) return false;
    const n = this.shape[0];
    const data = this.data;
    const isZero = this.field.isZero.bind(this.field);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (
          (i < j && !isZero(data[i * n + j])) ||
          (i > j && !isZero(data[i * n + j]))
        )
          return false;
    return true;
  }

  get isDiagonal(): boolean {
    if (!this.isSquare) return false;
    const n = this.shape[0];
    const data = this.data;
    const isZero = this.field.isZero.bind(this.field);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (
          (i === j && !isZero(data[i * n + j])) ||
          (i !== j && !isZero(data[i * n + j]))
        )
          return false;
    return true;
  }

  get isIdentity(): boolean {
    if (!this.isSquare) return false;
    const [m, n] = this.shape;
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
    if (axis1 === axis2) return undefined;
    if (axis1 <= 0 || axis1 > this.shape.length) return undefined;
    if (this.shape[axis1 - 1] !== this.shape[axis2 - 1]) return undefined;

    const diag: DataTypeMap[DT][] = new Array(this.shape[axis1 - 1]);
    const data = this.data;
    const n = this.shape[axis1 - 1];
    for (let i = 0; i < n; i++) diag[i] = data[i * n + i];
    return diag;
  }

  // Trace is the sum of the diagonal entries of a square matrix.
  // `\operatorname{tr}(A) = \sum_{i=1}^n a_{ii}`
  trace(axis1?: number, axis2?: number): undefined | DataTypeMap[DT] {
    // @todo tensor: calculate for any axis
    // Calculate the trace of a square matrix
    if (this.rank !== 2) return undefined;
    const [m, n] = this.shape;
    if (m !== n) return undefined;

    const data = this.data;
    const trace: DataTypeMap[DT][] = new Array(m);
    for (let i = 0; i < m; i++) trace[i] = data[i * m + i];
    return this.field.addn(...trace);
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

  /** Transpose the first and second axis */
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
    if (this.rank !== 2) return undefined;

    axis1 ??= 1;
    axis2 ??= 2;

    if (axis1 === axis2) return this;
    if (axis1 <= 0 || axis1 > 2) return undefined;
    if (axis2 <= 0 || axis2 > 2) return undefined;

    // Transpose the two axes of the matrix
    const [m, n] = this.shape;
    let data = this.data;
    if (fn) data = data.map((x) => fn(x));

    let index = 0;
    const result: DataTypeMap[DT][] = new Array(m * n);
    const stride = n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) result[index++] = data[j * stride + i];
    }

    return makeTensor(this.ce, {
      dtype: this.dtype,
      shape: [n, m],
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
      return addn([
        muln(a, e, i),
        muln(b, f, g),
        muln(c, d, h),
        neg(muln(c, e, g)),
        neg(muln(b, d, i)),
        neg(muln(a, f, h)),
      ]);
    }

    // https://en.wikipedia.org/wiki/Bareiss_algorithm
    const rows = this.shape[0];
    let negated = false;
    const div = this.field.div.bind(this.field);
    const sub = this.field.sub.bind(this.field);
    const rowIndices = new Array(rows).fill(0).map((_, i) => i);
    const matrix = [...this.data];
    for (let k = 0; k < rows; k++) {
      let k_ = rowIndices[k - 1];
      if (this.at(k_, k) === 0) {
        let _k;
        for (_k = k + 1; _k < rows; _k++) {
          if (this.at(rowIndices[_k], k) !== 0) {
            k_ = rowIndices[_k];
            rowIndices[_k - 1] = rowIndices[k - 1];
            rowIndices[k - 1] = k_;
            negated = !negated;
            break;
          }
        }
        if (_k === rows) return this.at(k_, k);
      }
      const piv = this.at(k_, k);
      const piv_ = k === 0 ? 1 : this.at(rowIndices[k - 2], k - 2);
      for (let i = k + 1; i < rows; i++) {
        const i_ = rowIndices[i - 1];
        for (let j = k + 1; j < rows; j++) {
          matrix[i_][j] = div(
            sub(mul(matrix[i_][j], piv), mul(matrix[i_][k], matrix[k_][j])),
            piv_
          );
        }
      }
    }
    const det = matrix[rowIndices[rows - 1]][rows - 1];
    return negated ? this.field.neg(det) : det;
  }

  inverse(): undefined | AbstractTensor<DT> {
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

    // https://en.wikipedia.org/wiki/Gaussian_elimination
    const rows = this.shape[0];
    const div = this.field.div.bind(this.field);
    const sub = this.field.sub.bind(this.field);
    const mul = this.field.mul.bind(this.field);

    const matrix: DataTypeMap[DT][][] = this
      .array as unknown as DataTypeMap[DT][][];
    const identity = new Array(rows).fill(0).map((_, i) => {
      const row = new Array(rows).fill(0);
      row[i] = 1;
      return row;
    });
    const augmented = matrix.map((row, i) => [...row, ...identity[i]]);
    const rowIndices = new Array(rows).fill(0).map((_, i) => i);
    for (let k = 0; k < rows; k++) {
      let k_ = rowIndices[k - 1];
      if (this.at(k_, k) === 0) {
        let _k;
        for (_k = k + 1; _k < rows; _k++) {
          if (this.at(rowIndices[_k], k) !== 0) {
            k_ = rowIndices[_k];
            rowIndices[_k - 1] = rowIndices[k - 1];
            rowIndices[k - 1] = k_;
            break;
          }
        }
        if (_k === rows) return undefined;
      }
      const piv = this.at(k_, k);
      const piv_ = k === 0 ? 1 : this.at(rowIndices[k - 2], k - 2);
      for (let i = k + 1; i < rows; i++) {
        const i_ = rowIndices[i - 1];
        for (let j = k + 1; j < rows * 2; j++) {
          augmented[i_][j] = sub(
            augmented[i_][j],
            mul(div(mul(augmented[i_][k], augmented[k_][j]), piv), piv_)
          );
        }
      }
    }
    for (let k = rows - 1; k >= 0; k--) {
      const piv = augmented[(rowIndices[k], k)];
      for (let i = 0; i < k; i++) {
        const i_ = rowIndices[i];
        for (let j = rows; j < rows * 2; j++) {
          augmented[i_][j] = sub(
            augmented[i_][j],
            mul(div(mul(augmented[i_][k], augmented[k][j]), piv), piv)
          );
        }
      }
      for (let j = rows; j < rows * 2; j++) {
        augmented[k][j] = div(augmented[k][j], piv);
      }
    }
    const inverseData: DataTypeMap[DT][] = augmented.map((row) =>
      row.slice(rows)
    ) as unknown as DataTypeMap[DT][];
    return makeTensor(this.ce, {
      dtype: this.dtype,
      shape: [n, n],
      data: inverseData,
    });
  }

  // A^+ is the Moore-Penrose pseudoinverse of A. https://en.wikipedia.org/wiki/Moore%E2%80%93Penrose_inverse
  // Pseudoinverse can also be defined for scalars: the pseudoinverse of a scalar is its reciprocal if it is non-zero, and zero otherwise.
  pseudoInverse(): undefined | AbstractTensor<DT> {
    // @todo tensor
    return undefined;
  }

  // The adjugate, classical adjoint, or adjunct of a square matrix is the transpose of its cofactor matrix. https://en.wikipedia.org/wiki/Adjugate_matrix
  adjugateMatrix(): undefined | AbstractTensor<DT> {
    // @todo tensor
    return undefined;
  }

  // The determinant of the matrix obtained by deleting row i and column j from this matrix. https://en.wikipedia.org/wiki/Minor_(linear_algebra)
  minor(i: number, j: number): undefined | DataTypeMap[DT] {
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
    return AbstractTensor.broadcast(this.field.pow.bind(this.field), this, rhs);
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
      if (!this.data.every((x, i) => eq(x, cast(rhs.data[i], dtype))))
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

/**
 * @noInheritDoc
 */
class NumberTensor extends AbstractTensor<'float64'> {
  readonly dtype = 'float64' as const;
  readonly data: number[];

  constructor(ce: IComputeEngine, data: TensorData<'float64'>) {
    super(ce, data);
    this.data = data.data as number[];
  }

  get isZero(): boolean {
    return this.data.every((x) => x === 0);
  }
}

/**
 * @noInheritDoc
 */
class ComplexTensor extends AbstractTensor<'complex128'> {
  readonly dtype = 'complex128' as const;
  readonly data: Complex[];

  constructor(ce: IComputeEngine, data: TensorData<'complex128'>) {
    super(ce, data);
    this.data = data.data as Complex[];
  }
}

/**
 * @noInheritDoc
 */
class BooleanTensor extends AbstractTensor<'bool'> {
  readonly dtype = 'bool' as const;
  readonly data: boolean[];

  constructor(ce: IComputeEngine, data: TensorData<'bool'>) {
    super(ce, data);
    this.data = data.data as boolean[];
  }
}

/**
 * @noInheritDoc
 */
class GenericTensor extends AbstractTensor<'expression'> {
  readonly dtype = 'expression' as const;
  readonly data: BoxedExpression[];

  constructor(ce: IComputeEngine, data: TensorData<'expression'>) {
    super(ce, data);
    this.data = data.data as BoxedExpression[];
  }
}

export function makeTensor<T extends TensorDataType>(
  ce: IComputeEngine,
  data:
    | TensorData<T>
    | { head: string; ops: BoxedExpression[]; dtype: T; shape: number[] }
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
