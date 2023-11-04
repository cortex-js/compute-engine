import { BoxedExpression, IComputeEngine } from '../public.js';

export interface TensorData<T = number> {
  data: T[];
  shape: number[];
}

// @todo: See also:
// - https://github.com/scalanlp/breeze/wiki/Linear-Algebra-Cheat-Sheet
// - http://sylvester.jcoglan.com/api/matrix.html#random
// - https://www.statmethods.net/advstats/matrix.html
// https://ctan.math.illinois.edu/macros/latex/required/tools/array.pdf

// Based class for all tensors (vectors, matrices, tensors, etc.)
// - BoxedTensor: a general purpose tensor (lists of lists of lists ...) with arbitrary elements (BoxedExpression).
// Has limited support for operations.
// - Vector: a column vector (1D tensor) of scalars (numbers, boolean, Complex). Has full support for operations.
// - Matrix: a matrix (2D tensor) of scalars. Has full support for operations.
// - Tensor: a tensor of scalars. Has limited support for operations,
// but could be extended in the future (with Tensorflow, for example).
export interface AbstractTensor<T = number> {
  readonly rank: number;

  readonly isSquare: boolean;
  // a square matrix that is equal to its transpose. A^T = A
  readonly isSymmetric: boolean;
  // aka antisymmetric matrix, skew-symmetric matrix, or antimetric matrix
  // A square matrix whose transpose is also its negative. A^T = -A
  readonly isSkewSymmetric: boolean;
  readonly isUpperTriangular: boolean; // All entries below the diagonal are zero.
  readonly isLowerTriangular: boolean; // All entries above the diagonal are zero.
  readonly isTriangular: boolean;
  readonly isDiagonal: boolean;
  readonly isIdentity: boolean;
  readonly isZero: boolean;
  readonly isSparse: boolean;
  readonly isRegular: boolean;
  readonly isSingular: boolean;

  readonly dataType: 'number' | 'complex' | 'boolean' | 'any';

  // A Boxed Expression that represents the tensor
  expression(ce: IComputeEngine): BoxedExpression;

  // The number of indices should match the rank of the tensor.
  // Notation A[i, j] or A_{i, j} in math
  at(...indices: number[]): T;
  // The first axis is "1", the last axis is the rank of the tensor
  // For a matrix, axis(1) is the list of rows, axis(2) is the list of columns. Notation for third column: A_{\star, 3} in math, or A^T_3, for fourth row: A_{4} or A_{4, \star}
  axis(axis: number): AbstractTensor<T>;
  diagonal(): undefined | T[];

  // Change the shape of the tensor, broadcasting if necessary
  reshape(...shape: number[]): AbstractTensor<T>;

  // Flatten the tensor into an array of elements
  flatten(): T[];

  transpose(
    axis1: number,
    axis2: number,
    fn?: (v: T) => T
  ): undefined | AbstractTensor<T>;
  // Transpose the first and second axis
  transpose(): undefined | AbstractTensor<T>;

  // a^H or A^*, or A^\dagger : conjugate transpose, aka Hermitian transpose, aka adjoint
  // https://en.wikipedia.org/wiki/Conjugate_transpose
  // transpose, then apply the complex conjugate to each entry
  // (same as transpose if all entries are real)
  conjugateTranspose(
    axis1: number,
    axis2: number
  ): undefined | AbstractTensor<T>;

  determinant(): undefined | T;
  inverse(): undefined | AbstractTensor<T>;

  // A^+ is the Moore-Penrose pseudoinverse of A. https://en.wikipedia.org/wiki/Moore%E2%80%93Penrose_inverse
  // Pseudoinverse can also be defined for scalars: the pseudoinverse of a scalar is its reciprocal if it is non-zero, and zero otherwise.
  pseudoInverse(): undefined | AbstractTensor<T>;

  // The adjugate, classical adjoint, or adjunct of a square matrix is the transpose of its cofactor matrix. https://en.wikipedia.org/wiki/Adjugate_matrix
  adjugateMatrix(): undefined | AbstractTensor<T>;

  // The determinant of the matrix obtained by deleting row i and column j from this matrix. https://en.wikipedia.org/wiki/Minor_(linear_algebra)
  minor(i: number, j: number): undefined | T;

  // Trace is the sum of the diagonal entries of a square matrix.
  // \operatorname{tr}(A) = \sum_{i=1}^n a_{ii}
  trace(): undefined | AbstractTensor<T>;

  add(rhs: AbstractTensor<T>): AbstractTensor<T>;
  subtract(rhs: AbstractTensor<T>): AbstractTensor<T>;

  // Hadamard product: \odot or \circ
  multiply(rhs: AbstractTensor<T>): AbstractTensor<T>;
  // hadamardProduct(rhs: AbstractArray<T>): AbstractArray<T>;

  divide(rhs: AbstractTensor<T>): AbstractTensor<T>;
  power(rhs: AbstractTensor<T>): AbstractTensor<T>;

  // aka inner product
  dot(rhs: AbstractTensor<T>): AbstractTensor<T>;

  // aka matmul, \otimes or invisibleoperator
  // generalization of the outer product
  tensorProduct(rhs: AbstractTensor<T>): AbstractTensor<T>;

  // generalization of kroneckerProduct
  outerProduct(rhs: AbstractTensor<T>): AbstractTensor<T>;

  // for 2d
  kroneckerProduct(rhs: AbstractTensor<T>): AbstractTensor<T>;

  // https://en.wikipedia.org/wiki/Frobenius_inner_product
  // \langle A, B \rangle_F, Frobenius norm: \lVert A \rVert_F =
  // \sqrt{\sum_{i,j} |a_{ij}|^2}
  frobeniusProduct(rhs: AbstractTensor<T>): T;
  crossProduct(rhs: AbstractTensor<T>): AbstractTensor<T>;
  innerProduct(rhs: AbstractTensor<T>): AbstractTensor<T>;
  matrixProduct(rhs: AbstractTensor<T>): AbstractTensor<T>;

  equals(rhs: AbstractTensor<T>): boolean;
}

// export function createTensor(data: unknown[]): Tensor {
//   // Assume data is an array (of numbers or arrays of numbers or
//   // arrays of arrays ...)
//   // Extract the shape of the tensor
//   const shape: number[] = [];
//   let d = data;
//   while (Array.isArray(d)) {
//     shape.push(d.length);
//     d = d[0];
//   }

//   // Flatten the data
//   const flatData: number[] = [];
//   const flatten = (d: unknown[]) => {
//     d.forEach((e) => (Array.isArray(e) ? flatten(e) : flatData.push(e)));
//   };
//   flatten(data);
//   return { data: flatData, shape };
// }

export function tensorToJSArray(tensor: TensorData): number[][] {
  const { data, shape } = tensor;
  const array: number[][] = [];
  let index = 0;
  const fill = (s: number[], i: number) => {
    if (i === s.length) {
      array.push(data.slice(index, index + s[i]));
      index += s[i];
    } else {
      array.push([]);
      for (let j = 0; j < s[i]; j++) fill(s, i + 1);
    }
  };
  fill(shape, 0);
  return array;
}

// export function tensorToExpression(
//   ce: IComputeEngine,
//   tensor: Tensor
// ): BoxedExpression {
//   const { data, shape } = tensor;
//   const array: BoxedExpression[][] = [];
//   let index = 0;
//   const fill = (s: number[], i: number) => {
//     if (i === s.length) {
//       array.push(data.slice(index, index + s[i]).map((e) => ce.number(e)));
//       index += s[i];
//     } else {
//       array.push([]);
//       for (let j = 0; j < s[i]; j++) fill(s, i + 1);
//     }
//   };
//   fill(shape, 0);
//   return ce.list(array.map((row) => ce.list(row)));
// }
