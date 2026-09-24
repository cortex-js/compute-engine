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

  let det = 0;
  for (let x = 0; x < n; x++) {
    // The minor of entry (0, x): the matrix without row 0 and column x. Each
    // row is created before it is filled.
    const subMatrix: number[][] = [];
    let subI = 0;
    for (let i = 1; i < n; i++) {
      subMatrix[subI] = [];
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

/**
 * The spectral norm of a finite `m × n` matrix, in machine precision: its
 * largest singular value, `√(λ_max(Aᴴ A))`.
 *
 * The matrix is given as the real parts `re` and the imaginary parts `im` of
 * its entries, both row-major arrays of the same shape. Every entry must be
 * finite: the caller decides infinite and NaN entries.
 *
 * The method: form the Gram matrix of the SMALLER side — `Aᴴ A` (`n × n`)
 * when `n ≤ m`, else `A Aᴴ` (`m × m`). The two have the same nonzero
 * eigenvalues. The Gram matrix `G = P + iQ` is Hermitian, and the real
 * symmetric matrix `[[P, −Q], [Q, P]]` has the eigenvalues of `G`, each one
 * twice. The cyclic Jacobi method finds the eigenvalues of that real
 * matrix. Jacobi converges for every symmetric matrix, also when the two
 * largest singular values are equal or near, where a power iteration
 * converges slowly.
 */
export function spectralNorm(re: number[][], im: number[][]): number {
  const gram = gramEigenvalues(re, im);
  if (gram === undefined) return 0;
  let lambdaMax = 0;
  for (const lambda of gram.eigenvalues)
    lambdaMax = Math.max(lambdaMax, lambda);
  return gram.scale * Math.sqrt(lambdaMax);
}

/**
 * The singular values of a finite `m × n` matrix, in machine precision,
 * sorted in descending order: `min(m, n)` values, zeros included.
 *
 * The input is the same as for `spectralNorm()`: the real parts `re` and the
 * imaginary parts `im` of the entries, row-major, every entry finite. The
 * singular values are the square roots of the eigenvalues of the Gram
 * matrix of the smaller side, which the same Jacobi run finds (see
 * `spectralNorm()`). For a complex matrix, the real symmetric embedding has
 * each eigenvalue of the Gram matrix twice, so the sorted list of its
 * eigenvalues is taken one value in two.
 *
 * The absolute error of each value is about `ε·σ_max` (`ε ≈ 2.2e-16`,
 * `σ_max` the largest singular value): a smaller singular value is not
 * resolved. An entry whose magnitude is below about `1e-154` times the
 * largest one underflows to 0 in the scaled Gram matrix, and the singular
 * values that depend on it can come back as 0. A caller that needs the
 * small singular values must decline such a matrix.
 */
export function singularValues(re: number[][], im: number[][]): number[] {
  const m = re.length;
  const n = m === 0 ? 0 : re[0].length;
  const count = Math.min(m, n);
  const gram = gramEigenvalues(re, im);
  if (gram === undefined) return new Array(count).fill(0);
  const sorted = gram.eigenvalues.slice().sort((a, b) => b - a);
  const step = gram.isReal ? 1 : 2;
  const result: number[] = [];
  for (let r = 0; r < count; r++)
    result.push(gram.scale * Math.sqrt(Math.max(0, sorted[r * step])));
  return result;
}

/**
 * The eigenvalues of the Gram matrix of the smaller side of a finite matrix,
 * scaled: the matrix is first divided by `scale`, the largest magnitude of
 * a real or imaginary part of its entries. `isReal` is true when every
 * imaginary part of the Gram matrix is zero: `eigenvalues` then has the
 * `min(m, n)` eigenvalues of the Gram matrix. Otherwise it has the `2·min(m,
 * n)` eigenvalues of the real symmetric embedding, each eigenvalue of the
 * Gram matrix twice. `undefined` when the matrix is empty or zero.
 */
function gramEigenvalues(
  re: number[][],
  im: number[][]
): { scale: number; eigenvalues: number[]; isReal: boolean } | undefined {
  const m = re.length;
  const n = m === 0 ? 0 : re[0].length;
  if (m === 0 || n === 0) return undefined;

  // Scale the matrix so that its largest real or imaginary part is 1, and
  // multiply the norm by the scale at the end. The Gram matrix squares the
  // entries, so without the scale an entry above about 1e154 overflows to
  // infinity and an entry below about 1e-154 underflows to zero.
  let scale = 0;
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++)
      scale = Math.max(scale, Math.abs(re[i][j]), Math.abs(im[i][j]));
  if (scale === 0) return undefined;
  re = re.map((row) => row.map((v) => v / scale));
  im = im.map((row) => row.map((v) => v / scale));

  // Gram matrix G = P + iQ of the smaller side. With `useColumns`,
  // G[j][k] = Σᵢ conj(a_ij) a_ik (that is, Aᴴ A); else
  // G[i][k] = Σⱼ a_ij conj(a_kj) (that is, A Aᴴ).
  const useColumns = n <= m;
  const k = useColumns ? n : m;
  const len = useColumns ? m : n;
  const at = (p: number, q: number): [number, number] =>
    useColumns ? [re[q][p], im[q][p]] : [re[p][q], im[p][q]];
  const P: number[][] = [];
  const Q: number[][] = [];
  for (let r = 0; r < k; r++) {
    P.push(new Array(k).fill(0));
    Q.push(new Array(k).fill(0));
  }
  for (let r = 0; r < k; r++)
    for (let c = r; c < k; c++) {
      let sr = 0;
      let si = 0;
      for (let t = 0; t < len; t++) {
        // With `useColumns`, the term is conj(a_tr) · a_tc. Else it is
        // a_rt · conj(a_ct). The two give conjugate values, and each one
        // makes G Hermitian with the same eigenvalues, so one formula
        // serves both: conj(x) · y with x = entry r, y = entry c.
        const [xr, xi] = at(r, t);
        const [yr, yi] = at(c, t);
        sr += xr * yr + xi * yi;
        si += xr * yi - xi * yr;
      }
      P[r][c] = sr;
      P[c][r] = sr;
      Q[r][c] = si;
      Q[c][r] = -si;
    }

  // The real symmetric embedding S = [[P, −Q], [Q, P]]. For a real matrix
  // Q is zero, and the eigenvalues of P are enough.
  const isReal = Q.every((row) => row.every((v) => v === 0));
  const size = isReal ? k : 2 * k;
  const S: number[][] = [];
  for (let r = 0; r < size; r++) {
    const row = new Array(size).fill(0);
    for (let c = 0; c < size; c++) {
      const rr = r % k;
      const cc = c % k;
      const top = r < k;
      const left = c < k;
      if (top === left) row[c] = P[rr][cc];
      else row[c] = top ? -Q[rr][cc] : Q[rr][cc];
    }
    S.push(row);
  }

  // Cyclic Jacobi: rotate away each off-diagonal entry in turn until the
  // off-diagonal mass is negligible relative to the whole matrix.
  let total = 0;
  for (const row of S) for (const v of row) total += v * v;
  if (total === 0) return undefined;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < size; p++)
      for (let q = p + 1; q < size; q++) off += S[p][q] * S[p][q];
    if (off <= 1e-30 * total) break;
    for (let p = 0; p < size; p++)
      for (let q = p + 1; q < size; q++) {
        const apq = S[p][q];
        if (apq === 0) continue;
        const theta = (S[q][q] - S[p][p]) / (2 * apq);
        const t =
          Math.sign(theta || 1) /
          (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let r = 0; r < size; r++) {
          const srp = S[r][p];
          const srq = S[r][q];
          S[r][p] = c * srp - s * srq;
          S[r][q] = s * srp + c * srq;
        }
        for (let r = 0; r < size; r++) {
          const spr = S[p][r];
          const sqr = S[q][r];
          S[p][r] = c * spr - s * sqr;
          S[q][r] = s * spr + c * sqr;
        }
      }
  }

  const eigenvalues: number[] = [];
  for (let r = 0; r < size; r++) eigenvalues.push(S[r][r]);
  return { scale, eigenvalues, isReal };
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
