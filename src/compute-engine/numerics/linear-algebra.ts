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
 * values come from `singularValueDecomposition()`, which does not form the
 * Gram matrix: a singular value much smaller than the largest one is
 * computed with a small relative error when the entries determine it (the
 * singular values of `[[1e20, 0.5], [0.5, 2.5]]` are about `1e20` and
 * `2.5`). The matrix is scaled so that its largest part is about 1, and an
 * entry below about `1e-300` times the largest one is lost to underflow.
 */
export function singularValues(re: number[][], im: number[][]): number[] {
  const m = re.length;
  const n = m === 0 ? 0 : re[0].length;
  const count = Math.min(m, n);
  const svd = singularValueDecomposition(re, im);
  if (svd === undefined) return new Array(count).fill(0);
  return svd.sigma;
}

/**
 * The singular value decomposition of a finite `m × n` matrix, in machine
 * precision: `A = U Σ Vᴴ`, with `k = min(m, n)` singular values.
 *
 * The input is the same as for `spectralNorm()`: the real parts `re` and the
 * imaginary parts `im` of the entries, row-major, every entry finite.
 *
 * The result has the singular values `sigma`, sorted in descending order
 * (zeros included), the `m × k` matrix of the left singular vectors
 * (`uRe`, `uIm`) and the `n × k` matrix of the right singular vectors
 * (`vRe`, `vIm`). The columns of each matrix are orthonormal, also for a
 * zero singular value. The result is `undefined` for an empty matrix or a
 * matrix with an entry that is not finite.
 *
 * The method does not form the Gram matrix `Aᴴ A`, which squares the
 * condition number: with the Gram matrix, a singular value below about
 * `ε·σ_max` (`ε ≈ 2.2e-16`) came back as 0, also when the entries determine
 * it accurately (the singular values of `[[1e20, 0.5], [0.5, 2.5]]` are
 * about `1e20` and `2.5`, not `1e20` and `0`). Instead:
 *
 * 1. When `m < n`, the method works on `B = Aᴴ`, else on `B = A`, so that
 *    `B` has at least as many rows as columns.
 * 2. `B` is divided by a power of two near its largest magnitude. This is
 *    exact, and prevents an overflow or an underflow.
 * 3. The rows of `B` are sorted by decreasing norm (permutation `Π`), and a
 *    Householder QR factorization with column pivoting gives
 *    `Π B P = Q R`, with `R` upper triangular (`n × n`).
 * 4. The one-sided Jacobi method (Hestenes) applies plane rotations `W` to
 *    the columns of `X = Rᴴ` until they are orthogonal: `X W = U_x Σ`.
 *    Then `R = W Σ U_xᴴ`, so `B = Πᵀ Q W Σ (P U_x)ᴴ`.
 *
 * The one-sided Jacobi method computes each singular value with a small
 * RELATIVE error when the matrix is a well-conditioned matrix with scaled
 * columns, and the QR preconditioning with sorted rows makes this true also
 * for scaled rows (Demmel and Veselić, "Jacobi's method is more accurate
 * than QR", 1992; Drmač and Veselić, "New fast and accurate Jacobi SVD
 * algorithm", 2008).
 */
export function singularValueDecomposition(
  re: number[][],
  im: number[][]
):
  | {
      sigma: number[];
      uRe: number[][];
      uIm: number[][];
      vRe: number[][];
      vIm: number[][];
    }
  | undefined {
  const rowCount = re.length;
  const columnCount = rowCount === 0 ? 0 : re[0].length;
  if (rowCount === 0 || columnCount === 0) return undefined;

  // 1. B = A, or B = Aᴴ when A has fewer rows than columns.
  const transposed = rowCount < columnCount;
  const m = transposed ? columnCount : rowCount;
  const n = transposed ? rowCount : columnCount;
  const bRe: number[][] = [];
  const bIm: number[][] = [];
  for (let i = 0; i < m; i++) {
    bRe.push(new Array(n).fill(0));
    bIm.push(new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      bRe[i][j] = transposed ? re[j][i] : re[i][j];
      bIm[i][j] = transposed ? -im[j][i] : im[i][j];
    }
  }

  // 2. Divide by a power of two near the largest magnitude.
  let largest = 0;
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++) {
      const x = Math.abs(bRe[i][j]);
      const y = Math.abs(bIm[i][j]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
      largest = Math.max(largest, x, y);
    }
  const scale = largest === 0 ? 1 : 2 ** Math.floor(Math.log2(largest));
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++) {
      bRe[i][j] /= scale;
      bIm[i][j] /= scale;
    }

  // 3. Sort the rows by decreasing norm, then factor Π B P = Q R with
  // Householder reflections `H = I − 2 v vᴴ` (`v` a unit vector) and
  // column pivoting.
  const rowOrder = Array.from({ length: m }, (_, i) => i);
  const rowNorms = rowOrder.map((i) => complexNorm(bRe[i], bIm[i]));
  rowOrder.sort((a, b) => rowNorms[b] - rowNorms[a]);
  const aRe = rowOrder.map((i) => bRe[i].slice());
  const aIm = rowOrder.map((i) => bIm[i].slice());
  const columnOrder = Array.from({ length: n }, (_, j) => j);
  const column = (j: number, from: number): [number[], number[]] => [
    aRe.slice(from).map((row) => row[j]),
    aIm.slice(from).map((row) => row[j]),
  ];
  // The unit Householder vector of each step, with the entries of rows `k`
  // to `m − 1`, or `undefined` when the step needs no reflection.
  const reflectors: ([number[], number[]] | undefined)[] = [];
  for (let k = 0; k < n; k++) {
    // Pivot: the remaining column with the largest norm below row k.
    let pivot = k;
    let pivotNorm = -1;
    for (let j = k; j < n; j++) {
      const norm = complexNorm(...column(j, k));
      if (norm > pivotNorm) {
        pivot = j;
        pivotNorm = norm;
      }
    }
    if (pivot !== k) {
      for (let i = 0; i < m; i++) {
        [aRe[i][k], aRe[i][pivot]] = [aRe[i][pivot], aRe[i][k]];
        [aIm[i][k], aIm[i][pivot]] = [aIm[i][pivot], aIm[i][k]];
      }
      [columnOrder[k], columnOrder[pivot]] = [
        columnOrder[pivot],
        columnOrder[k],
      ];
    }
    if (pivotNorm === 0) {
      reflectors.push(undefined);
      continue;
    }
    // v = x − α e₁ with α = −phase(x₀)·‖x‖, so that H x = α e₁. Then
    // v₀ = phase(x₀)·(|x₀| + ‖x‖), a sum without cancellation.
    const [vRe, vIm] = column(k, k);
    const x0 = Math.hypot(vRe[0], vIm[0]);
    const phaseRe = x0 === 0 ? 1 : vRe[0] / x0;
    const phaseIm = x0 === 0 ? 0 : vIm[0] / x0;
    vRe[0] += phaseRe * pivotNorm;
    vIm[0] += phaseIm * pivotNorm;
    const vNorm = complexNorm(vRe, vIm);
    for (let i = 0; i < vRe.length; i++) {
      vRe[i] /= vNorm;
      vIm[i] /= vNorm;
    }
    reflectors.push([vRe, vIm]);
    applyReflector(aRe, aIm, k, k + 1, n, vRe, vIm);
    aRe[k][k] = -phaseRe * pivotNorm;
    aIm[k][k] = -phaseIm * pivotNorm;
    for (let i = k + 1; i < m; i++) {
      aRe[i][k] = 0;
      aIm[i][k] = 0;
    }
  }

  // Q, the first n columns of H₀ H₁ … H_{n−1}: the reflections applied in
  // reverse order to the first n columns of the identity.
  const qRe: number[][] = [];
  const qIm: number[][] = [];
  for (let i = 0; i < m; i++) {
    qRe.push(new Array(n).fill(0));
    qIm.push(new Array(n).fill(0));
    if (i < n) qRe[i][i] = 1;
  }
  for (let k = n - 1; k >= 0; k--) {
    const v = reflectors[k];
    if (v) applyReflector(qRe, qIm, k, 0, n, v[0], v[1]);
  }

  // 4. One-sided Jacobi on the columns of X = Rᴴ, with the rotations
  // accumulated in W (initially the identity).
  const xRe: number[][] = [];
  const xIm: number[][] = [];
  const wRe: number[][] = [];
  const wIm: number[][] = [];
  for (let i = 0; i < n; i++) {
    xRe.push(new Array(n).fill(0));
    xIm.push(new Array(n).fill(0));
    wRe.push(new Array(n).fill(0));
    wIm.push(new Array(n).fill(0));
    wRe[i][i] = 1;
    for (let j = 0; j <= i; j++) {
      xRe[i][j] = aRe[j][i];
      xIm[i][j] = -aIm[j][i];
    }
  }
  const columnOf = (M: number[][], j: number) => M.map((row) => row[j]);
  // Two columns count as orthogonal when the cosine of their angle is
  // below `tolerance`.
  const tolerance = Math.sqrt(n) * Number.EPSILON;
  // One-sided Jacobi converges quadratically, in well under 60 sweeps for
  // any matrix that reaches this point. If the columns are still not
  // orthogonal after 60 sweeps, U and V would not be orthonormal, so the
  // matrix is declined (`undefined`) rather than answered inaccurately.
  let converged = false;
  for (let sweep = 0; sweep < 60; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        const pRe = columnOf(xRe, p);
        const pIm = columnOf(xIm, p);
        const qRe = columnOf(xRe, q);
        const qIm = columnOf(xIm, q);
        const np = complexNorm(pRe, pIm);
        const nq = complexNorm(qRe, qIm);
        if (np === 0 || nq === 0) continue;
        // g = x_pᴴ x_q / (‖x_p‖ ‖x_q‖), the cosine of the angle of the two
        // columns, computed from the normalized columns so that it cannot
        // underflow.
        let gRe = 0;
        let gIm = 0;
        for (let i = 0; i < n; i++) {
          const ar = pRe[i] / np;
          const ai = pIm[i] / np;
          const br = qRe[i] / nq;
          const bi = qIm[i] / nq;
          gRe += ar * br + ai * bi;
          gIm += ar * bi - ai * br;
        }
        const g = Math.hypot(gRe, gIm);
        if (!(g > tolerance)) continue;
        // Multiply column q by conj(phase(g)), which makes x_pᴴ x_q real
        // and positive. Then apply the real rotation that makes the two
        // columns orthogonal: with ζ = (‖x_q‖² − ‖x_p‖²) / (2 x_pᴴ x_q),
        // t = tan θ is the root of t² + 2ζt − 1 = 0 of smaller magnitude.
        const cRe = gRe / g;
        const cIm = -gIm / g;
        const zeta = (nq / np - np / nq) / (2 * g);
        const t = (zeta < 0 ? -1 : 1) / (Math.abs(zeta) + Math.hypot(1, zeta));
        // When ζ overflows, t is 0 and the rotation does nothing. It does
        // not count as a rotation, so that the loop cannot spin on it until
        // the sweep limit.
        if (t !== 0) rotated = true;
        const c = 1 / Math.hypot(1, t);
        const s = c * t;
        for (const [MRe, MIm] of [
          [xRe, xIm],
          [wRe, wIm],
        ])
          for (let i = 0; i < n; i++) {
            const yr = MRe[i][q] * cRe - MIm[i][q] * cIm;
            const yi = MRe[i][q] * cIm + MIm[i][q] * cRe;
            const xr = MRe[i][p];
            const xi = MIm[i][p];
            MRe[i][p] = c * xr - s * yr;
            MIm[i][p] = c * xi - s * yi;
            MRe[i][q] = s * xr + c * yr;
            MIm[i][q] = s * xi + c * yi;
          }
      }
    if (!rotated) {
      converged = true;
      break;
    }
  }
  if (!converged) return undefined;

  // The singular values are the norms of the columns of X W, and the
  // columns of U_x are these columns, normalized.
  const values = Array.from({ length: n }, (_, j) =>
    complexNorm(columnOf(xRe, j), columnOf(xIm, j))
  );
  const order = Array.from({ length: n }, (_, j) => j).sort(
    (a, b) => values[b] - values[a]
  );
  const sigma = order.map((j) => values[j] * scale);

  // The left singular vectors of B: Πᵀ Q W (m × n), orthonormal.
  const leftRe: number[][] = [];
  const leftIm: number[][] = [];
  for (let i = 0; i < m; i++) {
    leftRe.push(new Array(n).fill(0));
    leftIm.push(new Array(n).fill(0));
  }
  for (let i = 0; i < m; i++)
    for (let c = 0; c < n; c++) {
      const j = order[c];
      let sr = 0;
      let si = 0;
      for (let k = 0; k < n; k++) {
        sr += qRe[i][k] * wRe[k][j] - qIm[i][k] * wIm[k][j];
        si += qRe[i][k] * wIm[k][j] + qIm[i][k] * wRe[k][j];
      }
      leftRe[rowOrder[i]][c] = sr;
      leftIm[rowOrder[i]][c] = si;
    }

  // The right singular vectors of B: P U_x (n × n). The column of a zero
  // singular value is 0 here, and is completed below.
  const rightRe: number[][] = [];
  const rightIm: number[][] = [];
  for (let i = 0; i < n; i++) {
    rightRe.push(new Array(n).fill(0));
    rightIm.push(new Array(n).fill(0));
  }
  for (let c = 0; c < n; c++) {
    const j = order[c];
    if (values[j] === 0) continue;
    for (let i = 0; i < n; i++) {
      rightRe[columnOrder[i]][c] = xRe[i][j] / values[j];
      rightIm[columnOrder[i]][c] = xIm[i][j] / values[j];
    }
  }
  completeOrthonormalColumns(rightRe, rightIm);

  // A pair of singular vectors is defined up to a common unit factor z:
  // `(z u) σ (z v)ᴴ = u σ vᴴ`. Choose z so that the entry of largest
  // magnitude of the right vector (the first one, on a tie) is real and
  // positive. The SVD of a diagonal matrix with positive entries then has
  // identity factors, not their negatives.
  for (let c = 0; c < n; c++) {
    let best = 0;
    let bestMagnitude = -1;
    for (let i = 0; i < n; i++) {
      const magnitude = Math.hypot(rightRe[i][c], rightIm[i][c]);
      if (magnitude > bestMagnitude) {
        best = i;
        bestMagnitude = magnitude;
      }
    }
    if (!(bestMagnitude > 0)) continue;
    // z = conj(v_best) / |v_best|
    const zRe = rightRe[best][c] / bestMagnitude;
    const zIm = -rightIm[best][c] / bestMagnitude;
    if (zRe === 1 && zIm === 0) continue;
    for (const [MRe, MIm] of [
      [leftRe, leftIm],
      [rightRe, rightIm],
    ])
      for (const [i, row] of MRe.entries()) {
        const xr = row[c];
        const xi = MIm[i][c];
        row[c] = xr * zRe - xi * zIm;
        MIm[i][c] = xr * zIm + xi * zRe;
      }
    rightIm[best][c] = 0;
  }

  // A = B, or A = Bᴴ = (right) Σ (left)ᴴ.
  return transposed
    ? { sigma, uRe: rightRe, uIm: rightIm, vRe: leftRe, vIm: leftIm }
    : { sigma, uRe: leftRe, uIm: leftIm, vRe: rightRe, vIm: rightIm };
}

/**
 * The norm of the complex vector with real parts `re` and imaginary parts
 * `im`. The parts are divided by the largest magnitude before they are
 * squared, so the sum of squares does not overflow or underflow.
 */
function complexNorm(re: readonly number[], im: readonly number[]): number {
  let largest = 0;
  for (let i = 0; i < re.length; i++)
    largest = Math.max(largest, Math.abs(re[i]), Math.abs(im[i]));
  if (largest === 0) return 0;
  let sum = 0;
  for (let i = 0; i < re.length; i++) {
    const x = re[i] / largest;
    const y = im[i] / largest;
    sum += x * x + y * y;
  }
  return largest * Math.sqrt(sum);
}

/**
 * Apply the Householder reflection `H = I − 2 v vᴴ` (`v` a unit vector) to
 * the rows `k` to `k + v.length − 1` of the columns `from` to `to − 1` of
 * the matrix (`mRe`, `mIm`), in place.
 */
function applyReflector(
  mRe: number[][],
  mIm: number[][],
  k: number,
  from: number,
  to: number,
  vRe: readonly number[],
  vIm: readonly number[]
): void {
  for (let j = from; j < to; j++) {
    // w = vᴴ y, then y −= 2 w v.
    let wr = 0;
    let wi = 0;
    for (let i = 0; i < vRe.length; i++) {
      const yr = mRe[k + i][j];
      const yi = mIm[k + i][j];
      wr += vRe[i] * yr + vIm[i] * yi;
      wi += vRe[i] * yi - vIm[i] * yr;
    }
    for (let i = 0; i < vRe.length; i++) {
      mRe[k + i][j] -= 2 * (wr * vRe[i] - wi * vIm[i]);
      mIm[k + i][j] -= 2 * (wr * vIm[i] + wi * vRe[i]);
    }
  }
}

/**
 * Replace each zero column of the matrix (`mRe`, `mIm`) with a unit vector
 * orthogonal to the other columns, in place. The nonzero columns must be
 * orthonormal, and there must be no more columns than rows. For each zero
 * column, every standard basis vector is orthogonalized twice against the
 * columns already set (Gram-Schmidt), and the one with the largest
 * remaining norm is used. That norm is at least `1/√rows`, because the
 * squared norms of the projections of all the basis vectors add up to the
 * number of missing columns.
 */
export function completeOrthonormalColumns(
  mRe: number[][],
  mIm: number[][]
): void {
  const rows = mRe.length;
  const columns = rows === 0 ? 0 : mRe[0].length;
  const isZero = (j: number) =>
    mRe.every((row, i) => row[j] === 0 && mIm[i][j] === 0);
  const missing: number[] = [];
  const done: number[] = [];
  for (let j = 0; j < columns; j++) (isZero(j) ? missing : done).push(j);
  for (const j of missing) {
    let bestRe: number[] = [];
    let bestIm: number[] = [];
    let bestNorm = -1;
    for (let candidate = 0; candidate < rows; candidate++) {
      const vRe = new Array(rows).fill(0);
      const vIm = new Array(rows).fill(0);
      vRe[candidate] = 1;
      for (let pass = 0; pass < 2; pass++)
        for (const d of done) {
          // v −= (u_dᴴ v) u_d
          let sr = 0;
          let si = 0;
          for (let i = 0; i < rows; i++) {
            sr += mRe[i][d] * vRe[i] + mIm[i][d] * vIm[i];
            si += mRe[i][d] * vIm[i] - mIm[i][d] * vRe[i];
          }
          for (let i = 0; i < rows; i++) {
            vRe[i] -= sr * mRe[i][d] - si * mIm[i][d];
            vIm[i] -= sr * mIm[i][d] + si * mRe[i][d];
          }
        }
      const norm = complexNorm(vRe, vIm);
      if (norm > bestNorm) {
        bestRe = vRe;
        bestIm = vIm;
        bestNorm = norm;
      }
    }
    if (bestNorm <= 0) continue;
    for (let i = 0; i < rows; i++) {
      mRe[i][j] = bestRe[i] / bestNorm;
      mIm[i][j] = bestIm[i] / bestNorm;
    }
    done.push(j);
  }
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
