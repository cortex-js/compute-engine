import { BoxedExpression, IComputeEngine } from '../public.js';

export interface Tensor {
  data: number[];
  shape: number[];
}

// @todo: See also:
// - https://github.com/scalanlp/breeze/wiki/Linear-Algebra-Cheat-Sheet
// - http://sylvester.jcoglan.com/api/matrix.html#random
// - https://www.statmethods.net/advstats/matrix.html
// https://ctan.math.illinois.edu/macros/latex/required/tools/array.pdf

// Based class for all arrays (vectors, matrices, tensors, etc.)
// - BoxedTensor: a general purpose tensor (lists of lists of lists ...). Has limited support for operations.
// - Vector: a column vector (1D tensor) of numbers. Has full support for operations.
// - Matrix: a matrix (2D tensor) of numbers. Has full support for operations.
// - Tensor: a tensor of numbers. Has limited support for operations,
// but could be extended in the future (with Tensorflow, for example).
export interface AbstractArray<T = number> {
  readonly rank: number;
  readonly size: number;

  readonly isSquare: boolean;
  readonly isSymmetric: boolean;
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

  // The number of indices should match the rank of the tensor.
  // Notation A[i, j] or A_{i, j} in math
  at(...indices: number[]): T;
  // The first axis is "1", the last axis is the rank of the tensor
  // For a matrix, axis(1) is the list of rows, axis(2) is the list of columns. Notation for third column: A_{\star, 3} in math, or A^T_3, for fourth row: A_{4} or A_{4, \star}
  axis(axis: number): AbstractArray<T>;
  diagonal(): AbstractArray<T>;

  transpose(axis1: number, axis2: number): AbstractArray<T>;
  // Transpose the first and second axis
  transpose(): AbstractArray<T>;

  // a^H or A^*, or A^\dagger : conjugate transpose, aka Hermitian transpose, aka adjoint
  // https://en.wikipedia.org/wiki/Conjugate_transpose
  // transpose, then apply the complex conjugate to each entry
  // (same aas transpose if all entries are real)
  conjugateTranspose(axis1: number, axis2: number): AbstractArray<T>;

  determinant(): T;
  inverse(): AbstractArray<T>;

  // A^+ is the Moore-Penrose pseudoinverse of A. https://en.wikipedia.org/wiki/Moore%E2%80%93Penrose_inverse
  // Pseudoinverse can also be defined for scalars: the pseudoinverse of a scalar is its reciprocal if it is non-zero, and zero otherwise.
  pseudoInverse(): AbstractArray<T>;
  adjoint(): AbstractArray<T>;
  cofactor(): AbstractArray<T>;
  // The determinant of the matrix obtained by deleting row i and column j from this matrix. https://en.wikipedia.org/wiki/Minor_(linear_algebra)
  minor(i: number, j: number): T;

  // Trace is the sum of the diagonal entries of a square matrix.
  trace(): AbstractArray<T>;

  add(rhs: AbstractArray<T>): AbstractArray<T>;
  subtract(rhs: AbstractArray<T>): AbstractArray<T>;

  // Hadamard product: \odot or \circ
  multiply(rhs: AbstractArray<T>): AbstractArray<T>;
  // hadamardProduct(rhs: AbstractArray<T>): AbstractArray<T>;

  divide(rhs: AbstractArray<T>): AbstractArray<T>;
  power(rhs: AbstractArray<T>): AbstractArray<T>;

  // aka matmul, \otimes or invisbleoperator
  tensorProduct(rhs: AbstractArray<T>): AbstractArray<T>;
  // \otimes
  kroneckerProduct(rhs: AbstractArray<T>): AbstractArray<T>;
  // https://en.wikipedia.org/wiki/Frobenius_inner_product
  // \langle A, B \rangle_F, Frobenius norm: \lVert A \rVert_F =
  // \sqrt{\sum_{i,j} |a_{ij}|^2}
  frobeniusProduct(rhs: AbstractArray<T>): T;
  dotProduct(rhs: AbstractArray<T>): AbstractArray<T>;
  crossProduct(rhs: AbstractArray<T>): AbstractArray<T>;
  outerProduct(rhs: AbstractArray<T>): AbstractArray<T>;
  innerProduct(rhs: AbstractArray<T>): AbstractArray<T>;
  matrixProduct(rhs: AbstractArray<T>): AbstractArray<T>;
  matrixDivision(rhs: AbstractArray<T>): AbstractArray<T>;
  matrixPower(rhs: AbstractArray<T>): AbstractArray<T>;
  matrixRoot(rhs: AbstractArray<T>): AbstractArray<T>;
  matrixSquareRoot(): AbstractArray<T>;
  matrixSquare(): AbstractArray<T>;
  matrixCube(): AbstractArray<T>;
  matrixInverse(): AbstractArray<T>;

  equals(rhs: AbstractArray<T>): boolean;
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

export function tensorToJSArray(tensor: Tensor): number[][] {
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
