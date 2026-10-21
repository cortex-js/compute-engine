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

import { isTimeoutCancellation } from '../../common/interruptible.js';

export interface LMResult {
  theta: number[];
  /**
   * Without `rootTolerance`: the solver's own stop test passed (`stationary`).
   * With `rootTolerance`: the returned point is a root, that is, its residual
   * norm is within the tolerance (`isRoot` below), and the solve was not cut
   * short by a deadline.
   */
  converged: boolean;
  /**
   * The solver's own stop test passed at the returned point: the projected
   * gradient is below `gradTol`, or an accepted improving step was negligible
   * (`stepTol`), or every parameter is blocked at a bound. This is a
   * stationary point of the sum of squared residuals, which is a minimum of
   * the misfit for a least-squares fit, and a root only when the residual is
   * zero there. Without `rootTolerance` this is `converged`.
   */
  stationary: boolean;
  /** ‖r(θ̂)‖₂ at the returned point. */
  residualNorm: number;
  iterations: number;
  /**
   * True when the solve was cut short by an evaluation deadline (a timeout
   * `CancellationError` thrown from `onIteration` or from inside a
   * `residual`/`jacobian` callback). `theta` then holds the best point seen
   * before the budget expired — a bounded re-solve keeps a usable
   * (`converged: false`) answer instead of nothing.
   */
  timedOut?: boolean;
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
   * The tolerance of a ROOT solve (`FindRoot`): the solver reports
   * `converged` only at a point where every equation's residual is within
   * it,
   *
   *     |rᵢ| ≤ rootTolerance · (1 + Σⱼ |Jᵢⱼ| · max(1, |θⱼ|))  for every i,
   *
   * an absolute part for a residual that is zero to within the tolerance,
   * and a relative part for the scale of that equation: `Σⱼ |Jᵢⱼ| ·
   * max(1, |θⱼ|)` is the change of its residual over a unit relative change
   * of the parameters it reads, so the relative part says those parameters
   * are determined to that relative precision. A non-finite residual or
   * scale is never a root. A stationary point of the sum of squares whose
   * residual is above the tolerance (a least-squares minimum that is not a
   * root, `a² + 1 = 0`) is reported `converged: false`, with `stationary:
   * true`. The projected-gradient test does not stop a root solve on its
   * own: with an absolute `gradTol` a residual scaled small
   * (`10⁻⁶ (a² − 4) = 0`) is "stationary" at every point, and the solve
   * must go on to the root. It stops at a root, when an accepted step is
   * negligible, when no step improves, or at `maxIterations`.
   * Without this option (a least-squares fit) `converged` is `stationary`.
   */
  rootTolerance?: number;
  /**
   * Called once at the top of each iteration with the (0-based) iteration
   * index. The caller uses this to check an evaluation deadline; throwing from
   * here aborts the solve and the exception propagates to the caller.
   */
  onIteration?: (iter: number) => void;
}

const clampScalar = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

/**
 * The relative reduction of the cost below which an accepted step gained
 * nothing: rounding noise of a sum of squares, a thousand times the machine
 * epsilon. Read only by a root solve that went on past the gradient test
 * (`rootTolerance`), to tell a least-squares minimum that is not a root
 * (nothing to gain) from a false stationary point far from the root (a
 * residual scaled small, where the next step gains most of the cost).
 */
const RELATIVE_IMPROVEMENT_FLOOR = 1e-13;

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
 *
 * Exported for the separable scan of `FindFit`'s `global` option
 * (`nonlinear-fit.ts`), which solves the normal equations of a linear
 * least-squares problem at each grid point with it.
 */
export function solveWithInflation(
  M: number[][],
  b: number[]
): number[] | null {
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
  const rootTolerance = options.rootTolerance;

  const clampVec = (t: number[]): number[] =>
    t.map((v, j) => clampScalar(v, lo[j], hi[j]));

  // The root test of `rootTolerance` at a point: its residual, Jacobian and
  // parameters (see the option). Always true for a least-squares fit, where
  // convergence is the stationarity test alone. Each equation is tested
  // against its own scale, from its own row of the Jacobian and the
  // parameters it reads: one scale for the whole system would let a steep
  // equation, or a large parameter of another equation, hide a residual
  // that is not zero (`[a² + 1, 10¹² b]` at the start has a residual of 1
  // and a system-wide scale of 10¹²). A residual or a scale that is not
  // finite is not a root: an infinite Jacobian entry (`√a` at `a = 0`) or an
  // overflowed square would otherwise pass as `Infinity ≤ Infinity`.
  const isRoot = (rr: number[], JJ: number[][], t: number[]): boolean => {
    if (rootTolerance === undefined) return true;
    for (let i = 0; i < rr.length; i++) {
      let scale = 0;
      const row = JJ[i];
      for (let j = 0; j < p; j++)
        scale += Math.abs(row[j]) * Math.max(1, Math.abs(t[j]));
      const allowance = rootTolerance * (1 + scale);
      if (!Number.isFinite(allowance) || !(Math.abs(rr[i]) <= allowance))
        return false;
    }
    return true;
  };

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
    for (let j = 0; j < p; j++)
      for (let k = j + 1; k < p; k++) A[k][j] = A[j][k];
    return A;
  };

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

  // `stationary` is the solver's own stop test at the current point; it is
  // cleared by every accepted step, which moves the point. `converged` adds
  // the root test of `rootTolerance` (always true for a least-squares fit).
  // With a root tolerance, a root is reported as soon as an accepted step
  // reaches it, even when the gradient test has not passed there.
  let stationary = false;
  let converged = false;
  let iterations = 0;
  let timedOut = false;

  // The solve proper runs under a deadline-abort net: a timeout
  // `CancellationError` thrown by `onIteration` — or from INSIDE a
  // `residual`/`jacobian` callback (the per-row deadline checks in
  // `nonlinear-fit.ts`) — ends the solve and returns best-so-far with
  // `converged: false` and `timedOut: true`, rather than propagating. A
  // bounded re-solve then keeps a usable answer (the caller's ask in Tycho
  // item 118). Every other throw — an abort signal, an iteration-limit
  // breach, a genuine error — propagates unchanged: only an expired time
  // budget licenses fabricating a partial result. Identified by name, not
  // `instanceof` (cross-bundle identity hazard).
  try {
    // Jacobian, gradient g = Jᵀr, and normal matrix A = JᵀJ.
    let J = jacobian(theta);
    let g = gradient(J, r);
    let A = normalMatrix(J);

    // λ is dimensionless: the damping term is λ·diag(A) (Marquardt scaling),
    // so λ carries no problem-scale factor — scaling it by max(diag A) would
    // double-count the residual scale (the damping would then grow
    // quadratically with the data scale, breaking parameter-scale
    // invariance). Start at 1e-3.
    let lambda = 1e-3;
    let nu = 2;

    stationary = projGradNorm(theta, g) < gradTol;
    converged = rootTolerance === undefined ? stationary : isRoot(r, J, theta);

    // A root solve that has reached a root goes on until the point is also
    // stationary (the gradient test, or a negligible accepted step): the
    // first point within the root tolerance of a steep equation can still
    // be polished (`10¹² x = 3 · 10¹²` is within its bound at a residual of
    // 74, where one more step reaches 0.002). For a fit `converged` is
    // `stationary`, so the condition is the plain one.
    while (!(converged && stationary) && iterations < maxIterations) {
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
        // Every parameter is blocked at a bound: a projected minimizer. For
        // a root solve it is a root only when its residual is within the
        // tolerance; the bounds keep the solver from moving further anyway.
        stationary = true;
        converged = isRoot(r, J, theta);
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
      // Whether the (projected) step is negligible relative to θ, component
      // by component: a step of 1 in a parameter near 2 is not negligible
      // because another parameter is 10¹¹ (the stall measured against the
      // norm of the whole vector stopped `[a² = 4, b = 10¹¹]` after one
      // step, at `a = 2.5`). This is NOT a convergence test on its own: it
      // fires on the PROPOSED step, before the trial point is evaluated or
      // accepted, so on the rejection path (λ growing, or the box projection
      // zeroing the step) it would otherwise flag `converged` at a point
      // that never improved. It is used only as a post-acceptance stall
      // check (and a trust-region-collapse exit on rejection), both below.
      const stepStalled = step.every(
        (s, j) => Math.abs(s) < stepTol * (Math.abs(theta[j]) + stepTol)
      );

      const rNew = residual(thetaNew);
      const FNew = cost(rNew);

      // Predicted reduction of the quadratic model at the (projected) step:
      //   ½·δᵀ(λ·diag(A)·δ − g).
      let predicted = 0;
      for (let j = 0; j < p; j++)
        predicted += step[j] * (lambda * A[j][j] * step[j] - g[j]);
      predicted *= 0.5;

      const actual = F - FNew;
      const rho =
        Number.isFinite(FNew) && predicted > 0 ? actual / predicted : -1;

      if (rho > 0) {
        // A root solve that went on past the gradient test (below) and
        // gained nothing from this step, to within rounding, is at a
        // least-squares minimum that is not a root: it stops there, with
        // the point still stationary. A step that gains more (the gradient
        // test passed far from the root, on a residual scaled small) moves
        // the point, which is no longer stationary.
        if (stationary && actual <= RELATIVE_IMPROVEMENT_FLOOR * F) break;

        // Accept the step.
        theta = thetaNew;
        r = rNew;
        F = FNew;
        J = jacobian(theta);
        g = gradient(J, r);
        A = normalMatrix(J);
        stationary = false;

        if (F < bestF) {
          bestF = F;
          bestTheta = theta.slice();
          bestR = r;
        }

        // Primary convergence test: the projected gradient is stationary.
        // It is read at every accepted point, so that a root reported below
        // carries the stationarity of the point it was found at.
        stationary = projGradNorm(theta, g) < gradTol;

        // A root solve has converged at a root (see `rootTolerance`); it
        // stops once the point is also stationary (the loop condition), so
        // the first point within the bound of a steep equation is polished
        // by the steps that follow. A least-squares fit stops at a
        // stationary point. A root solve that is not at a root goes on past
        // one: the gradient test is absolute, so a residual scaled small
        // passes it far from the root, and at a least-squares minimum that
        // is not a root the next steps are rejected until the step
        // collapses, which exits below.
        converged =
          rootTolerance === undefined ? stationary : isRoot(r, J, theta);
        if (converged && stationary) break;

        // Secondary (stall) convergence test — applied ONLY here, after an
        // accepted improving step: the step we just took, and accepted, is
        // negligible relative to θ, so we have settled at a (local) minimum.
        // Because this only fires post-acceptance, it can no longer report
        // convergence on the rejection path (where λ growth or the box projection
        // shrink the PROPOSED step at a point that never improved) — the original
        // bug. A root solve that settles here keeps the root test's answer:
        // at a minimum above its tolerance `converged` stays false.
        if (stepStalled) {
          stationary = true;
          if (rootTolerance === undefined) converged = true;
          break;
        }

        lambda *= Math.max(1 / 3, 1 - (2 * rho - 1) ** 3);
        nu = 2;
      } else {
        // Reject: the trial point did not improve. If the step has already
        // collapsed (trust region underflow) we cannot find an acceptable step —
        // exit as NON-converged. Otherwise increase damping; λ overflow is the
        // same collapse and also exits non-converged. A root solve that was
        // polishing a root it had reached (`converged` holds) has settled:
        // the point is reported stationary.
        if (stepStalled || !Number.isFinite(lambda * nu)) {
          if (converged) stationary = true;
          break;
        }
        lambda *= nu;
        nu *= 2;
      }
    }
  } catch (e) {
    if (!isTimeoutCancellation(e)) throw e;
    timedOut = true;
  }

  // `bestR`/`bestTheta` hold the lowest-cost point seen; on convergence that is
  // the current point.
  return {
    theta: bestTheta,
    converged,
    stationary,
    residualNorm: norm2(bestR),
    iterations,
    ...(timedOut ? { timedOut } : {}),
  };
}
