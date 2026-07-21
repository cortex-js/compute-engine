/**
 * Pure-number Levenberg–Marquardt core for bound-constrained nonlinear
 * least squares. No `BoxedExpression`/library dependencies — the public
 * `FindFit`/`FindRoot` operators lower to this.
 *
 * Minimizes `F(θ) = ½‖r(θ)‖²` subject to `lo ≤ θ ≤ hi`, given callbacks for
 * the residual vector `r(θ): number[]` and Jacobian `J(θ): number[][]`
 * (`J[i][j] = ∂rᵢ/∂θⱼ`).
 *
 * The step solves the Marquardt-scaled normal equations
 * `(JᵀJ + λ·diag(JᵀJ))·δ = −Jᵀr` (parameter-scale invariant), with `λ` adapted
 * by the gain ratio (Nielsen's update; Madsen/Nielsen, "Methods for Non-Linear
 * Least Squares Problems"). Box constraints are handled by projection: the
 * trial point `θ+δ` is clamped to `[lo, hi]` and convergence is tested on the
 * PROJECTED gradient, so a minimizer pressed against an active bound converges.
 */

export interface LMResult {
  theta: number[];
  converged: boolean;
  /** ‖r(θ̂)‖₂ at the returned point. */
  residualNorm: number;
  iterations: number;
}

export interface LMOptions {
  /** Lower bounds (−∞ allowed). Defaults to −∞ for every parameter. */
  lo?: number[];
  /** Upper bounds (+∞ allowed). Defaults to +∞ for every parameter. */
  hi?: number[];
  /** Maximum LM iterations (default 200). */
  maxIterations?: number;
  /** Projected-gradient ∞-norm tolerance (default 1e-8). */
  gradTol?: number;
  /** Relative step-size tolerance (default 1e-10). */
  stepTol?: number;
  /**
   * Called once at the top of each iteration with the (0-based) iteration
   * index. The caller uses this to check an evaluation deadline; throwing from
   * here aborts the solve and the exception propagates to the caller.
   */
  onIteration?: (iter: number) => void;
}

const clampScalar = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

/** Euclidean norm of a vector. */
function norm2(v: number[]): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

/**
 * Solve the SPD system `M·x = b` by dense Cholesky (`M = LLᵀ`). Returns the
 * solution, or `null` if `M` is not positive definite (non-positive pivot).
 * `M` is not modified.
 */
function choleskySolve(M: number[][], b: number[]): number[] | null {
  const n = b.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = M[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(sum > 0)) return null;
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  // Forward solve L·y = b
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= L[i][k] * y[k];
    y[i] = sum / L[i][i];
  }
  // Back solve Lᵀ·x = y
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= L[k][i] * x[k];
    x[i] = sum / L[i][i];
  }
  return x;
}

/**
 * Solve `M·x = b` for a symmetric (approximately SPD) `M`, retrying with an
 * inflated diagonal if the plain Cholesky hits a non-positive pivot. Returns
 * `null` only if even a heavily-inflated system fails.
 */
function solveWithInflation(M: number[][], b: number[]): number[] | null {
  const direct = choleskySolve(M, b);
  if (direct) return direct;

  const n = b.length;
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(M[i][i]));
  let alpha = scale > 0 ? scale * 1e-10 : 1e-10;
  for (let attempt = 0; attempt < 40; attempt++) {
    const inflated = M.map((row, i) =>
      row.map((v, j) => (i === j ? v + alpha : v))
    );
    const sol = choleskySolve(inflated, b);
    if (sol) return sol;
    alpha *= 10;
  }
  return null;
}

export function levenbergMarquardt(
  residual: (theta: number[]) => number[],
  jacobian: (theta: number[]) => number[][],
  theta0: number[],
  options: LMOptions = {}
): LMResult {
  const p = theta0.length;
  const lo = options.lo ?? new Array(p).fill(-Infinity);
  const hi = options.hi ?? new Array(p).fill(Infinity);
  const maxIterations = options.maxIterations ?? 200;
  const gradTol = options.gradTol ?? 1e-8;
  const stepTol = options.stepTol ?? 1e-10;
  const onIteration = options.onIteration;

  const clampVec = (t: number[]): number[] =>
    t.map((v, j) => clampScalar(v, lo[j], hi[j]));

  let theta = clampVec(theta0.slice());
  let r = residual(theta);
  const cost = (rr: number[]): number => {
    let s = 0;
    for (let i = 0; i < rr.length; i++) s += rr[i] * rr[i];
    return 0.5 * s;
  };
  let F = cost(r);

  // Best-so-far (lowest cost), returned on non-convergence.
  let bestTheta = theta.slice();
  let bestF = F;
  let bestR = r;

  // Jacobian, gradient g = Jᵀr, and normal matrix A = JᵀJ.
  let J = jacobian(theta);

  const gradient = (JJ: number[][], rr: number[]): number[] => {
    const g = new Array(p).fill(0);
    for (let i = 0; i < JJ.length; i++)
      for (let j = 0; j < p; j++) g[j] += JJ[i][j] * rr[i];
    return g;
  };
  const normalMatrix = (JJ: number[][]): number[][] => {
    const A: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < JJ.length; i++)
      for (let j = 0; j < p; j++)
        for (let k = j; k < p; k++) A[j][k] += JJ[i][j] * JJ[i][k];
    for (let j = 0; j < p; j++) for (let k = j + 1; k < p; k++) A[k][j] = A[j][k];
    return A;
  };

  let g = gradient(J, r);
  let A = normalMatrix(J);

  // Projected-gradient ∞-norm: components blocked by an active bound in the
  // descent (−g) direction are zeroed.
  const projGradNorm = (t: number[], gg: number[]): number => {
    let mx = 0;
    for (let j = 0; j < p; j++) {
      let c = gg[j];
      if (t[j] <= lo[j] && c > 0) c = 0;
      else if (t[j] >= hi[j] && c < 0) c = 0;
      mx = Math.max(mx, Math.abs(c));
    }
    return mx;
  };

  // λ is dimensionless: the damping term is λ·diag(A) (Marquardt scaling), so
  // λ carries no problem-scale factor — scaling it by max(diag A) would
  // double-count the residual scale (the damping would then grow quadratically
  // with the data scale, breaking parameter-scale invariance). Start at 1e-3.
  let lambda = 1e-3;
  let nu = 2;

  let converged = projGradNorm(theta, g) < gradTol;
  let iterations = 0;

  while (!converged && iterations < maxIterations) {
    if (onIteration) onIteration(iterations);
    iterations++;

    // Active-set projection: a parameter sitting on a bound whose descent
    // (−g) direction points outside is held fixed (δ=0) this step, and the
    // Marquardt system is solved over the remaining FREE parameters only.
    // Without this, a pinned parameter's coupling freezes the free ones.
    const free: number[] = [];
    for (let j = 0; j < p; j++) {
      if (theta[j] <= lo[j] && g[j] > 0) continue;
      if (theta[j] >= hi[j] && g[j] < 0) continue;
      free.push(j);
    }
    if (free.length === 0) {
      // Every parameter is blocked at a bound: a projected minimizer.
      converged = true;
      break;
    }

    // Reduced Marquardt-scaled system over the free set:
    //   (A + λ·diag(A))·δ = −g.
    const nf = free.length;
    const M: number[][] = Array.from({ length: nf }, () =>
      new Array(nf).fill(0)
    );
    const negG = new Array(nf).fill(0);
    for (let a = 0; a < nf; a++) {
      const ja = free[a];
      negG[a] = -g[ja];
      for (let b = 0; b < nf; b++) M[a][b] = A[ja][free[b]];
      M[a][a] += lambda * A[ja][ja];
    }

    const reduced = solveWithInflation(M, negG);
    if (!reduced) {
      // Give up on a linear-solve failure: return best-so-far, not converged.
      break;
    }
    const delta = new Array(p).fill(0);
    for (let a = 0; a < nf; a++) delta[free[a]] = reduced[a];

    // Projected trial step.
    const thetaNew = clampVec(theta.map((v, j) => v + delta[j]));
    const step = thetaNew.map((v, j) => v - theta[j]);
    const stepNorm = norm2(step);
    // Whether the (projected) step is negligible relative to θ. This is NOT a
    // convergence test on its own: it fires on the PROPOSED step, before the
    // trial point is evaluated or accepted, so on the rejection path (λ growing,
    // or the box projection zeroing the step) it would otherwise flag
    // `converged` at a point that never improved. It is used only as a
    // post-acceptance stall check (and a trust-region-collapse exit on
    // rejection), both below.
    const stepStalled = stepNorm < stepTol * (norm2(theta) + stepTol);

    const rNew = residual(thetaNew);
    const FNew = cost(rNew);

    // Predicted reduction of the quadratic model at the (projected) step:
    //   ½·δᵀ(λ·diag(A)·δ − g).
    let predicted = 0;
    for (let j = 0; j < p; j++)
      predicted += step[j] * (lambda * A[j][j] * step[j] - g[j]);
    predicted *= 0.5;

    const actual = F - FNew;
    const rho = Number.isFinite(FNew) && predicted > 0 ? actual / predicted : -1;

    if (rho > 0) {
      // Accept the step.
      theta = thetaNew;
      r = rNew;
      F = FNew;
      J = jacobian(theta);
      g = gradient(J, r);
      A = normalMatrix(J);

      if (F < bestF) {
        bestF = F;
        bestTheta = theta.slice();
        bestR = r;
      }

      // Primary convergence test: the projected gradient is stationary.
      if (projGradNorm(theta, g) < gradTol) {
        converged = true;
        break;
      }

      // Secondary (stall) convergence test — applied ONLY here, after an
      // accepted improving step: the step we just took, and accepted, is
      // negligible relative to θ, so we have settled at a (local) minimum.
      // Because this only fires post-acceptance, it can no longer report
      // convergence on the rejection path (where λ growth or the box projection
      // shrink the PROPOSED step at a point that never improved) — the original
      // bug.
      if (stepStalled) {
        converged = true;
        break;
      }

      lambda *= Math.max(1 / 3, 1 - (2 * rho - 1) ** 3);
      nu = 2;
    } else {
      // Reject: the trial point did not improve. If the step has already
      // collapsed (trust region underflow) we cannot find an acceptable step —
      // exit as NON-converged. Otherwise increase damping; λ overflow is the
      // same collapse and also exits non-converged.
      if (stepStalled) break;
      lambda *= nu;
      nu *= 2;
      if (!Number.isFinite(lambda)) break;
    }
  }

  // `bestR`/`bestTheta` hold the lowest-cost point seen; on convergence that is
  // the current point.
  return {
    theta: bestTheta,
    converged,
    residualNorm: norm2(bestR),
    iterations,
  };
}
