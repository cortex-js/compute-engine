import { Tensor } from '../symbolic/tensors';

/** Calculate the determinant of matrix
 *  Test: determinant([[1,3,7],[2,-1,4],[5,0,2]]) === 81
 */
export function determinant(matrix: number[][]): number {
  const n = matrix.length;
  if (n === 1) return matrix[0][0];
  if (n === 2) return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];

  // m[0].reduce((r,e,i) =>
  // r+(-1)**(i+2)*e*determinant(m.slice(1).map(c =>
  // c.filter((_,j) => i != j))),0)

  const subMatrix: number[][] = [];
  let det = 0;
  for (let x = 0; x < n; x++) {
    let subI = 0;
    for (let i = 1; i < n; i++) {
      let subJ = 0;
      for (let j = 0; j < n; j++) {
        if (j === x) {
          continue;
        }
        subMatrix[subI][subJ] = matrix[i][j];
        subJ++;
      }
      subI++;
    }
    det = det + Math.pow(-1, x) * matrix[0][x] * determinant(subMatrix);
  }
  return det;
}

// 0 -> scalar
// 1 -> vector
// 2 -> 2D matrix
export function rank(tensor: Tensor): number {
  return tensor.shape.length;
}

// export function transpose(
//   tensor: Tensor,
//   axis1: number,
//   axis2: number
// ): Tensor {
//   if (!isFinite(axis1) || !isFinite(axis2)) {
//     throw new Error('Axis must be finite numbers');
//   }
//   if (axis1 === axis2) return tensor;

//   // Transpose axis1 and axis2 of tensor

//   // return matrix[0].map((_, i) => matrix.map((row) => row[i]));
// }

// export function inverse(matrix: any[]): any[] {
//   return matrix;
// }

// export function trace(matrix: any[]): number {
//   return matrix.reduce((r, e, i) => r + e[i], 0);
// }

// export function norm(matrix: any[]): number {
//   return Math.sqrt(matrix.reduce((r, e) => r + e * e, 0));
// }

// export function frobeniusNorm(matrix: any[]): number {
//   return Math.sqrt(
//     matrix.reduce((r, e) => r + e.reduce((r, e) => r + e * e, 0), 0)
//   );
// }

// export function add(matrix1: any[], matrix2: any[]): any[] {
//   return matrix1.map((row, i) => row.map((e, j) => e + matrix2[i][j]));
// }

// export function subtract(matrix1: any[], matrix2: any[]): any[] {
//   return matrix1.map((row, i) => row.map((e, j) => e - matrix2[i][j]));
// }

// export function multiply(matrix1: any[], matrix2: any[]): any[] {
//   return matrix1.map((row, i) =>
//     matrix2[0].map((_, j) => row.reduce((r, e, k) => r + e * matrix2[k][j], 0))
//   );
// }

// export function divide(matrix1: any[], matrix2: any[]): any[] {
//   return matrix1.map((row, i) => row.map((e, j) => e / matrix2[i][j]));
// }

// export function dot(matrix1: any[], matrix2: any[]): any[] {
//   return matrix1.map((row) =>
//     matrix2[0].map((_, i) => row.reduce((r, e, j) => r + e * matrix2[j][i], 0))
//   );
// }

// export function cross(matrix1: any[], matrix2: any[]): any[] {
//   return matrix1.map((row, i) =>
//     matrix2.map((_, j) => row.reduce((r, e, k) => r + e * matrix2[k][j], 0))
//   );
// }

// export function scale(matrix: any[], scalar: number): any[] {
//   return matrix.map((row) => row.map((e) => e * scalar));
// }

// export function power(matrix: any[], power: number): any[] {
//   return matrix;
// }

// export function identity(size: number): any[] {
//   return Array(size)
//     .fill(0)
//     .map((_, i) =>
//       Array(size)
//         .fill(0)
//         .map((_, j) => (i === j ? 1 : 0))
//     );
// }

// export function zeros(size: number): any[] {
//   return Array(size)
//     .fill(0)
//     .map((_) => Array(size).fill(0));
// }

// export function ones(size: number): any[] {
//   return Array(size)
//     .fill(0)
//     .map((_) => Array(size).fill(1));
// }

// export function random(size: number): any[] {
//   return Array(size)
//     .fill(0)
//     .map((_) => Array(size).fill(Math.random()));
// }

// export function diagonal(matrix: any[]): any[] {
//   return matrix.map((row, i) =>
//     row.map((e, j) => (i === j ? e : 0)).filter((e) => e !== 0)
//   );
// }

// export function diagonalize(matrix: any[]): any[] {
//   return matrix.map((row, i) =>
//     row.map((e, j) => (i === j ? e : 0)).filter((e) => e !== 0)
//   );
// }

// export function flatten(matrix: any[]): any[] {
//   return matrix.reduce((r, e) => r.concat(e), []);
// }

// export function reshape(matrix: any[], shape: number[]): any[] {
//   return matrix;
// }

// export function slice(matrix: any[], start: number[], end: number[]): any[] {
//   return matrix;
// }

// export function dataType(matrix: any[]): string {
//   return 'number';
// }

// export function isSquare(matrix: any[]): boolean {
//   return matrix.length === matrix[0].length;
// }

// export function isSymmetric(matrix: any[]): boolean {
//   return matrix.every((row, i) => row.every((e, j) => e === matrix[j][i]));
// }

// export function isSkewSymmetric(matrix: any[]): boolean {
//   return matrix.every((row, i) => row.every((e, j) => e === -matrix[j][i]));
// }

// export function isUpperTriangular(matrix: any[]): boolean {
//   return matrix.every((row, i) =>
//     row.every((e, j) => (i > j ? e === 0 : true))
//   );
// }

// export function isLowerTriangular(matrix: any[]): boolean {
//   return matrix.every((row, i) =>
//     row.every((e, j) => (i < j ? e === 0 : true))
//   );
// }

// export function isTriangular(matrix: any[]): boolean {
//   return isUpperTriangular(matrix) || isLowerTriangular(matrix);
// }

// export function isDiagonal(matrix: any[]): boolean {
//   return matrix.every((row, i) =>
//     row.every((e, j) => (i === j ? true : e === 0))
//   );
// }

// export function isIdentity(matrix: any[]): boolean {
//   return (
//     isDiagonal(matrix) &&
//     matrix.every((row, i) => row.every((e, j) => (i === j ? e === 1 : true)))
//   );
// }

// export function isZero(matrix: any[]): boolean {
//   return matrix.every((row) => row.every((e) => e === 0));
// }

// export function isSparse(matrix: any[]): boolean {
//   return (
//     matrix.reduce(
//       (r, e) => r + e.reduce((r, e) => r + (e === 0 ? 0 : 1), 0),
//       0
//     ) <
//     (matrix.length * matrix[0].length) / 2
//   );
// }

// export function isSingular(matrix: any[]): boolean {
//   return determinant(matrix) === 0;
// }

// export function isOrthogonal(matrix: any[]): boolean {
//   return matrix.every((row, i) => row.every((e, j) => e === (i === j ? 1 : 0)));
// }

// export function isPermutation(matrix: any[]): boolean {
//   return matrix.every(
//     (row) => row.reduce((r, e) => r + (e === 1 ? 1 : 0), 0) === 1
//   );
// }

// export function isStochastic(matrix: any[]): boolean {
//   return matrix.every((row) => row.reduce((r, e) => r + e, 0) === 1);
// }
