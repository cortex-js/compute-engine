/**
 * The matrix kernels of compiled JavaScript (`_SYS.matrix…`): the
 * determinant, the inverse, the integer power and the reduced row echelon
 * form of a matrix of numbers, held as an array of rows. The determinant,
 * the power and the row echelon form are the interpreter's kernels on
 * machine numbers (`determinant()` of `tensor/tensors.ts`, `rref()` and
 * `MatrixPower` of `library/linear-algebra.ts`), with the same operations in
 * the same order, so their value is the value of `.N()`. The inverse
 * differs from the interpreter's `inverse()` in its test of a singular
 * matrix and its pivots (`matrixInverse()`). The compiler settles the
 * shapes (`ir/lower-matrices.ts`): every matrix here is square, except the
 * operand of `matrixRowReduce`, which is rectangular.
 *
 * Where the interpreter has no value (a singular matrix, an exponent past
 * `MAX_MATRIX_POWER_EXPONENT`), the kernels give a matrix of `NaN` of the
 * shape of the result.
 */

import { MAX_MATRIX_POWER_EXPONENT } from '../numerics/value-scaled-caps.js';

/** The `n × n` matrix of `NaN`. */
function nanMatrix(n: number): number[][] {
  return Array.from({ length: n }, () => new Array<number>(n).fill(NaN));
}

/** The determinant of the `n × n` matrix whose entries, row by row, are
 *  `a`: the entry for `n = 1`, the products of the rule of Sarrus for
 *  `n <= 3`, and above the fraction-free elimination of Bareiss with
 *  partial pivoting (a NaN candidate is chosen, so that it reaches the
 *  result; a column of zeros gives 0). */
function matrixDeterminant(a: readonly number[], n: number): number {
  if (n === 1) return a[0];
  if (n === 2) return a[0] * a[3] + -(a[1] * a[2]);
  if (n === 3) {
    const [p, q, r, s, t, u, v, w, x] = a;
    return [
      p * t * x,
      q * u * v,
      r * s * w,
      -(r * t * v),
      -(q * s * x),
      -(p * u * w),
    ].reduce((y, z) => y + z, 0);
  }
  const m: number[][] = [];
  for (let i = 0; i < n; i++) m.push(a.slice(i * n, (i + 1) * n));
  let sign = 1;
  let prev = 1;
  for (let k = 0; k < n - 1; k++) {
    let pivotRow = k;
    for (let r = k; r < n; r++) {
      const size = Math.abs(m[r][k]);
      if (Number.isNaN(size)) {
        pivotRow = r;
        break;
      }
      if (size > Math.abs(m[pivotRow][k])) pivotRow = r;
    }
    if (m[pivotRow][k] === 0) return 0;
    if (pivotRow !== k) {
      [m[k], m[pivotRow]] = [m[pivotRow], m[k]];
      sign = -sign;
    }
    const pivot = m[k][k];
    for (let i = k + 1; i < n; i++)
      for (let j = k + 1; j < n; j++)
        m[i][j] = (m[i][j] * pivot - m[i][k] * m[k][j]) / prev;
    prev = pivot;
  }
  const det = m[n - 1][n - 1];
  return sign === -1 ? -det : det;
}

/** The inverse of the square matrix `m`, or a matrix of `NaN` where the
 *  interpreter leaves `Inverse` unevaluated: a singular matrix. For `2 × 2`
 *  the adjugate divided by the determinant, as the interpreter's; otherwise
 *  the elimination of Gauss and Jordan on `[m | I]` with partial pivoting.
 *
 *  The interpreter's numeric kernel tests a pivot for an exact 0, so an
 *  exactly singular matrix whose elimination in doubles leaves a rounding
 *  residue (`[[3, 2, 1], [1, 1, 1], [4, 3, 2]]`) gives entries of about
 *  1e15 there. Here an entry of the elimination is 0 when it is at most
 *  `1024ε` times its running bound (`bound`: the sum of the magnitudes of
 *  the terms that made it), and the matrix is singular when a pivot is: a
 *  residue was at most `261ε` of its bound over 9,000 random singular
 *  integer matrices of orders 3 to 6, where the pivots of the regular ones
 *  were at least `1.8e11·ε` of theirs. For `2 × 2` the determinant is 0
 *  at most `1024ε` times the larger of its two products. So a regular
 *  matrix as ill-conditioned as the Hilbert matrix of order 11 gives NaN. */
function matrixInverse(m: readonly (readonly number[])[]): number[][] {
  const n = m.length;
  const tiny = 1024 * Number.EPSILON;
  if (n === 2) {
    const [[a, b], [c, d]] = m;
    const det = a * d + -(b * c);
    if (Math.abs(det) <= tiny * Math.max(Math.abs(a * d), Math.abs(b * c)))
      return nanMatrix(2);
    return [
      [d / det, -(b / det)],
      [-(c / det), a / det],
    ];
  }
  const aug = m.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  const bound = m.map((row) => row.map(Math.abs));
  for (let k = 0; k < n; k++) {
    let pivotRow = k;
    for (let r = k + 1; r < n; r++)
      if (Math.abs(aug[r][k]) > Math.abs(aug[pivotRow][k])) pivotRow = r;
    if (pivotRow !== k) {
      [aug[k], aug[pivotRow]] = [aug[pivotRow], aug[k]];
      [bound[k], bound[pivotRow]] = [bound[pivotRow], bound[k]];
    }
    const pivot = aug[k][k];
    if (Math.abs(pivot) <= tiny * bound[k][k]) return nanMatrix(n);
    for (let j = 0; j < 2 * n; j++) aug[k][j] = aug[k][j] / pivot;
    for (let j = 0; j < n; j++) bound[k][j] = bound[k][j] / Math.abs(pivot);
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const factor = aug[i][k];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++)
        aug[i][j] = aug[i][j] - factor * aug[k][j];
      for (let j = 0; j < n; j++) {
        bound[i][j] = bound[i][j] + Math.abs(factor) * bound[k][j];
        // A residue of the rounding is 0: a column whose remaining
        // entries are all residues gives a pivot of 0.
        if (Math.abs(aug[i][j]) <= tiny * bound[i][j]) aug[i][j] = 0;
      }
    }
  }
  return aug.map((row) => row.slice(n));
}

/** The product of two square matrices of `n` rows, each entry the sum
 *  from 0 of the products in the order of the inner index. */
function squareProduct(
  a: readonly (readonly number[])[],
  b: readonly (readonly number[])[]
): number[][] {
  const n = a.length;
  return a.map((row) =>
    Array.from({ length: n }, (_, j) => {
      let s = 0;
      for (let k = 0; k < n; k++) s += row[k] * b[k][j];
      return s;
    })
  );
}

/** The power `m^p` of the square matrix `m` by the integer `p`, as the
 *  interpreter's `MatrixPower`: the identity for 0; else the power by
 *  squaring of `|p|`, the first factor `m` itself (so `m^1` is `m`), then
 *  the inverse of that power for a negative `p`. A matrix of `NaN` past
 *  `MAX_MATRIX_POWER_EXPONENT`, where the interpreter keeps the power. */
function matrixPower(m: readonly (readonly number[])[], p: number): number[][] {
  const n = m.length;
  if (p === 0)
    return Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
    );
  if (!Number.isInteger(p) || Math.abs(p) > MAX_MATRIX_POWER_EXPONENT)
    return nanMatrix(n);
  let result: readonly (readonly number[])[] | undefined = undefined;
  let base: readonly (readonly number[])[] = m;
  for (let e = Math.abs(p); e > 0; e = Math.floor(e / 2)) {
    if (e % 2 === 1)
      result = result === undefined ? base : squareProduct(result, base);
    if (e > 1) base = squareProduct(base, base);
  }
  return p < 0 ? matrixInverse(result!) : result!.map((row) => row.slice());
}

/** The reduced row echelon form of the matrix `m` by the elimination of
 *  Gauss and Jordan with partial pivoting, a pivot or a factor of at most
 *  `1e-10` in magnitude read as 0, and the entries of at most `tolerance`
 *  in magnitude made 0 at the end: the interpreter's numeric `RowReduce`
 *  (`rref()`, then `ce.chop()` at the engine's tolerance). */
function matrixRowReduce(
  m: readonly (readonly number[])[],
  tolerance: number
): number[][] {
  const small = 1e-10;
  const rowCount = m.length;
  const colCount = m[0]?.length ?? 0;
  const out = m.map((row) => [...row]);
  let pivotRow = 0;
  for (let col = 0; col < colCount && pivotRow < rowCount; col++) {
    let maxRow = pivotRow;
    let maxVal = Math.abs(out[pivotRow][col] ?? 0);
    for (let row = pivotRow + 1; row < rowCount; row++) {
      const v = Math.abs(out[row][col] ?? 0);
      if (v > maxVal) {
        maxVal = v;
        maxRow = row;
      }
    }
    if (maxVal <= small) continue;
    if (maxRow !== pivotRow)
      [out[pivotRow], out[maxRow]] = [out[maxRow], out[pivotRow]];
    const pivot = out[pivotRow][col];
    for (let j = col; j < colCount; j++) out[pivotRow][j] /= pivot;
    for (let row = 0; row < rowCount; row++) {
      if (row === pivotRow) continue;
      const factor = out[row][col];
      if (Math.abs(factor) <= small) {
        out[row][col] = 0;
        continue;
      }
      for (let j = col; j < colCount; j++)
        out[row][j] -= factor * out[pivotRow][j];
    }
    pivotRow++;
  }
  for (const row of out)
    for (let j = 0; j < colCount; j++) {
      if (Math.abs(row[j]) <= small) row[j] = 0;
      if (Math.abs(row[j]) <= tolerance) row[j] = 0;
    }
  return out;
}

export const MATRIX_HELPERS = {
  matrixDeterminant,
  matrixInverse,
  matrixPower,
  matrixRowReduce,
};
