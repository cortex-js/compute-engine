import { Complex } from 'complex.js';
import { complexDivide } from './numeric-complex.js';

/** The inverse of the square matrix `m` of complex machine numbers, or
 *  `undefined` when the matrix is singular. This is `numberMatrixInverse()`
 *  of `linear-algebra.ts` for complex entries, with the modulus `|z|` where
 *  that kernel has the absolute value: the elimination of Gauss and Jordan
 *  on `[m | I]` with partial pivoting. This is the kernel of `Inverse` on a
 *  matrix with an inexact complex entry. Order 2 takes the elimination too,
 *  not the adjugate divided by the determinant: the products of the
 *  determinant underflow for entries below about 1e-154, and the
 *  elimination divides by the pivot before it multiplies.
 *
 *  A test of a pivot for an exact 0 does not see a singular matrix whose
 *  elimination in doubles leaves a rounding residue
 *  (`[[3 + i, 2, 1], [1, 1, 1], [4 + i, 3, 2]]` gives entries of about
 *  5e15). Here an entry of the elimination is a residue when its modulus is
 *  at most `1024ε` times its running scale (`bound`, which tracks the sizes
 *  of the terms that made it). A residue is not a pivot, and the matrix is
 *  singular when every candidate for a pivot is a residue: a residue pivot
 *  was at most `43ε` of its bound over 45,000 random singular matrices of
 *  orders 3 to 6 (Gaussian integers, and the same multiplied by a real
 *  factor), where the pivots of the regular ones were at least `8e12·ε` of
 *  theirs. So a regular matrix as ill-conditioned as the Hilbert matrix of
 *  order 11 is singular here.
 *
 *  A residue keeps its value. `numberMatrixInverse()` sets it to 0, which
 *  changes the matrix when the entry is small and not a residue: for
 *  `d = 2⁻⁴⁴`, `[[1, 1, 0], [1, 1 + d, 1], [0, d, 2]]` is regular, and the
 *  0 in place of `d` gives the inverse of another matrix (CE-1825).
 *
 *  The result is also `undefined` when an entry of `m` is infinite or NaN,
 *  or when an entry of the inverse is (an intermediate value was out of the
 *  range of a double): the elimination has no test for these values, and
 *  its result for them is not the inverse. The running scale adds terms with
 *  no cancellation, so it can be infinite where the entry is finite; the
 *  pivot is then refused, and a regular matrix with entries near the top of
 *  the range of a double (`[[1e308, 1e308], [1e308·i, -1e308]]`) has no
 *  result though its inverse is in range. */
export function complexMatrixInverse(
  m: readonly (readonly Complex[])[]
): Complex[][] | undefined {
  const n = m.length;
  const tiny = 1024 * Number.EPSILON;
  if (!m.every((row) => row.every(isFiniteComplex))) return undefined;
  const aug = m.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) =>
      i === j ? Complex.ONE : Complex.ZERO
    ),
  ]);
  const bound = m.map((row) => row.map((z) => z.abs()));
  for (let k = 0; k < n; k++) {
    // The pivot: the largest candidate that is not a residue.
    let pivotRow = -1;
    let pivotSize = 0;
    for (let r = k; r < n; r++) {
      const size = aug[r][k].abs();
      if (size > pivotSize && size > tiny * bound[r][k]) {
        pivotRow = r;
        pivotSize = size;
      }
    }
    if (pivotRow === -1) return undefined;
    if (pivotRow !== k) {
      [aug[k], aug[pivotRow]] = [aug[pivotRow], aug[k]];
      [bound[k], bound[pivotRow]] = [bound[pivotRow], bound[k]];
    }
    const pivot = aug[k][k];
    for (let j = 0; j < 2 * n; j++) aug[k][j] = complexDivide(aug[k][j], pivot);
    for (let j = 0; j < n; j++) bound[k][j] = bound[k][j] / pivotSize;
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const factor = aug[i][k];
      if (factor.isZero()) continue;
      const factorSize = factor.abs();
      const factorBound = bound[i][k];
      const factorIsResidue = factorSize <= tiny * factorBound;
      for (let j = k + 1; j < n; j++) {
        // A residue cannot create a pivot in a cell that was zero or
        // already a residue. A significant entry keeps its own scale.
        const scale =
          factorIsResidue && aug[i][j].abs() <= tiny * bound[i][j]
            ? factorBound
            : factorSize;
        bound[i][j] = bound[i][j] + scale * bound[k][j];
      }
      for (let j = 0; j < 2 * n; j++)
        aug[i][j] = aug[i][j].sub(factor.mul(aug[k][j]));
    }
  }
  return finiteOrUndefined(aug.map((row) => row.slice(n)));
}

function isFiniteComplex(z: Complex): boolean {
  return Number.isFinite(z.re) && Number.isFinite(z.im);
}

/** The matrix `m`, or `undefined` when an entry is infinite or NaN. */
function finiteOrUndefined(m: Complex[][]): Complex[][] | undefined {
  return m.every((row) => row.every(isFiniteComplex)) ? m : undefined;
}
