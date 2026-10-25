/**
 * Pure-number Levenberg–Marquardt core for bound-constrained nonlinear
 * least squares. No `Expression`/library dependencies — the public
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
import { runStepsSync, type Steps } from '../../common/cooperative-steps.js';

export interface LMResult {
  theta: number[];
  /**
   * With `rootTolerance`: the returned point is a root, that is, every
   * residual is within the tolerance (`withinTolerance` below). With
   * `fitTolerance`: the solver's own stop test passed (`stationary`), or
   * every residual is within the tolerance (an exact fit). With neither:
   * `stationary`. Always false when the solve was cut short by a deadline
   * (`timedOut`), whatever the last point had reached.
   */
  converged: boolean;
  /**
   * The solver's own stop test passed at the returned point: the projected
   * gradient is below `gradTol`, or an accepted improving step was negligible
   * (`stepTol`), or every parameter is blocked at a bound, or the solve was
   * within its tolerance and an accepted step moved every parameter by less
   * than the precision the tolerance determines it to, with the cost at its
   * rounding floor (`toleranceStalled` in the loop). This is a stationary
   * point of the sum of squared residuals, which is a minimum of the misfit
   * for a least-squares fit, and a root only when the residual is zero
   * there. Only a solve with neither tolerance has `converged` equal to
   * `stationary`: a root solve is `converged` only at a root, and a fit
   * within its tolerance is `converged` before it is stationary.
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
   * scale is never a root. The relative part is a first-order claim: a
   * zero of the equation lies within that relative change of the
   * parameters. An equation whose residual needs the relative part (it is
   * above the absolute part) is a root only when the residual confirms the
   * claim. Each parameter is moved by `±2 · rootTolerance · max(1, |θⱼ|)`,
   * with the sign of `Jᵢⱼ` that lowers `|rᵢ|` for `+`. The central
   * difference of the residual over that step must be the change the
   * Jacobian predicts to within half of it, and the parabola through the
   * three values must reach the absolute part, cross 0, or touch 0 to
   * within the rounding of the parameters (a root of even multiplicity).
   * When one end of the step is outside the bounds, the end inside must
   * show the predicted change to within half, and the end toward the zero,
   * when it is inside, must reach the absolute part or cross 0. A linear
   * equation always passes (twice the change reaches past its zero); an
   * equation so steep that its Jacobian means nothing at that scale does
   * not: `2 − sin(10¹⁸ a) = 0` has no zero, and at every point its
   * Jacobian, up to 10¹⁸, made a residual of 3 pass the first-order test
   * (Tycho row 419). The check costs at most two residual evaluations per
   * such equation, and runs only where the solve would stop
   * (`zeroWithinReach` in the function). A stationary point of the sum of squares whose
   * residual is above the tolerance (a least-squares minimum that is not a
   * root, `a² + 1 = 0`) is reported `converged: false`, with `stationary:
   * true`. The projected-gradient test does not stop a root solve on its
   * own: with an absolute `gradTol` a residual scaled small
   * (`10⁻⁶ (a² − 4) = 0`) is "stationary" at every point, and the solve
   * must go on to the root. It stops at a root, when an accepted step is
   * negligible, when no step improves, or at `maxIterations`.
   * Without this option and without `fitTolerance`, `converged` is
   * `stationary`.
   */
  rootTolerance?: number;
  /**
   * The tolerance of a least-squares FIT (`FindFit`): the solver reports
   * `converged` at a stationary point of the sum of squared residuals (a
   * minimum of the misfit, which is not zero for noisy data), and also at a
   * point where every residual is within the tolerance of the terms its row
   * computes,
   *
   *     |rᵢ| ≤ fitTolerance · (1 + Σⱼ |Jᵢⱼ · θⱼ|)  for every i,
   *
   * an exact fit: the residual of each data point is within the relative
   * tolerance of the model value there (a linear model's value is a sum of
   * the terms `Jᵢⱼ · θⱼ`, and a nonlinear model's terms are of the order of
   * its value), with an absolute part for a value at 0. The scale is the
   * terms themselves, not the `max(1, |θⱼ|)` of a root solve: with the
   * latter a degree-10 polynomial over `x` in [10, 20] tolerates a residual
   * of 1 at data of magnitude 1, so an exit before stationarity would call
   * a fit that is not one `converged`. The stationarity tests alone miss an
   * exact fit when the problem is badly scaled: at a degree-10 polynomial
   * through 11 points the Jacobian columns reach 10¹⁰, so a residual at the
   * rounding floor still has a gradient far above `gradTol`, and a
   * parameter whose true value is 0 never takes a step that is small
   * relative to itself (`stepTol`). Such a fit went on to `maxIterations`
   * and was reported `converged: false` (Tycho row 418). A point within the
   * tolerance is still polished: the solve goes on until it is stationary,
   * or until an accepted step moves every parameter by less than the
   * tolerance of its own scale while the cost is at its rounding floor (see
   * `toleranceStalled` in the loop).
   */
  fitTolerance?: number;
  /**
   * Called once at the top of each iteration with the (0-based) iteration
   * index. The caller uses this to check an evaluation deadline; throwing from
   * here aborts the solve and the exception propagates to the caller.
   */
  onIteration?: (iter: number) => void;
  /**
   * `residual` and `jacobian` as step functions that yield between rows
   * (`makeCallbacks` in `nonlinear-fit.ts`), with the same results. When
   * given, `levenbergMarquardtSteps` uses them for the evaluations of its
   * main loop, so that a run driven in slices can stop inside a long
   * evaluation (many rows of an interpreted model).
   */
  residualSteps?: (theta: number[]) => Steps<number[]>;
  jacobianSteps?: (theta: number[]) => Steps<number[][]>;
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

/** Run the Levenberg–Marquardt solve to its end (see
 * `levenbergMarquardtSteps`). */
export function levenbergMarquardt(
  residual: (theta: number[]) => number[],
  jacobian: (theta: number[]) => number[][],
  theta0: number[],
  options: LMOptions = {}
): LMResult {
  return runStepsSync(
    levenbergMarquardtSteps(residual, jacobian, theta0, options)
  );
}

/**
 * The Levenberg–Marquardt solve as a step function: it yields at the top of
 * each iteration, before `onIteration` is called, and returns the result.
 * `levenbergMarquardt` runs it without stopping; the asynchronous route of
 * `FindFit` runs it in slices and gives the event loop a turn between two of
 * them (`runStepsAsync()` in `common/cooperative-steps.ts`). The work and
 * the result do not depend on how it is run.
 */
export function* levenbergMarquardtSteps(
  residual: (theta: number[]) => number[],
  jacobian: (theta: number[]) => number[][],
  theta0: number[],
  options: LMOptions = {}
): Steps<LMResult> {
  const p = theta0.length;
  const lo = options.lo ?? new Array(p).fill(-Infinity);
  const hi = options.hi ?? new Array(p).fill(Infinity);
  const maxIterations = options.maxIterations ?? 200;
  const gradTol = options.gradTol ?? 1e-8;
  const stepTol = options.stepTol ?? 1e-10;
  const onIteration = options.onIteration;
  const rootTolerance = options.rootTolerance;
  const fitTolerance = options.fitTolerance;
  // The residual tolerance of the solve, whichever kind it is: a root solve
  // reports `converged` only within it, a fit also at a stationary point.
  const tolerance = rootTolerance ?? fitTolerance;

  const clampVec = (t: number[]): number[] =>
    t.map((v, j) => clampScalar(v, lo[j], hi[j]));

  // The scale of one equation or data row at a point, from its own row of
  // the Jacobian and the parameters it reads. A root solve reads
  // `Σⱼ |Jᵢⱼ| · max(1, |θⱼ|)`, the change of the residual over a unit
  // relative change of the parameters (see `rootTolerance`); a fit reads the
  // magnitude of the terms the row computes, `Σⱼ |Jᵢⱼ · θⱼ|` (see
  // `fitTolerance`). Each row has its own scale: one scale for the whole
  // system would let a steep equation, or a large parameter of another
  // equation, hide a residual that is not zero (`[a² + 1, 10¹² b]` at the
  // start has a residual of 1 and a system-wide scale of 10¹²).
  const rowScale = (row: number[], t: number[]): number => {
    let scale = 0;
    if (rootTolerance !== undefined) {
      for (let j = 0; j < p; j++)
        scale += Math.abs(row[j]) * Math.max(1, Math.abs(t[j]));
    } else {
      for (let j = 0; j < p; j++) scale += Math.abs(row[j] * t[j]);
    }
    return scale;
  };

  // The tolerance test of `rootTolerance`/`fitTolerance` at a point: its
  // residual, Jacobian and parameters (see the options). False when the
  // solve has no tolerance, where convergence is the stationarity test
  // alone. A residual or a scale that is not finite is not within the
  // tolerance: an infinite Jacobian entry (`√a` at `a = 0`) or an overflowed
  // square would otherwise pass as `Infinity ≤ Infinity`.
  const withinTolerance = (
    rr: number[],
    JJ: number[][],
    t: number[]
  ): boolean => {
    if (tolerance === undefined) return false;
    for (let i = 0; i < rr.length; i++) {
      const allowance = tolerance * (1 + rowScale(JJ[i], t));
      if (!Number.isFinite(allowance) || !(Math.abs(rr[i]) <= allowance))
        return false;
    }
    return true;
  };

  // For a root solve, whether each equation whose residual is above the
  // absolute part of its allowance has a zero within twice the relative
  // change that allowance grants (see `rootTolerance`): the first-order
  // test of `withinTolerance` says so, and this checks it with the residual
  // itself. Each parameter takes the step `±2 · rootTolerance · max(1,
  // |θⱼ|)`, with the sign of `Jᵢⱼ` that lowers `|rᵢ|` for `+` (a parameter
  // fixed by its bounds does not move), and the residual is evaluated at
  // both ends. Along that line, with the residual's sign at the point taken
  // as positive, the three values give a parabola `z(s) = z₀ + b s + c s²`
  // for `s` in [−1, 1]. The row has a zero within reach when:
  //
  // - `b`, a central difference, is the change the Jacobian predicts for
  //   the step to within half of it. Over a reach of 200 radians,
  //   `sin(10¹² a) = 0.5` near `a = 1` lands on values that are chance, so
  //   its parabola says nothing, and with the prediction off it is not a
  //   root at a residual of 0.18. `2 − sin(10¹⁸ a) = 0`, with no zero, is
  //   refused here too: its values lie between 1 and 3, so its central
  //   difference is at most 1, and the prediction is at least twice the
  //   residual, at least 2; the two agree to within half only at that
  //   limit, where the parabola's lowest value is 0.75.
  // - The lowest value of the parabola on [−1, 1] is within the absolute
  //   part, or below 0 (the residual changes sign), or within the rounding
  //   of a root of even multiplicity: at the double nearest to the root of
  //   `10²⁴ (a² − 2)² = 0` the residual is 2 · 10⁻⁷, and it touches 0
  //   without crossing it. That rounding is the parabola's rise over one
  //   unit in the last place of the parameters, at most `rootTolerance / ε`
  //   units over the step (`c · (ε / (2 · rootTolerance))²`, times 4).
  //
  // A linear equation always passes: twice its first-order reach goes past
  // its zero. When one end of the step is outside the bounds, the zero may
  // lie past the bound within reach (`eᵃ = 10³⁰` with an upper bound one
  // unit in the last place below its root): the end inside the bounds must
  // show the change the Jacobian predicts, to within half, and the end
  // toward the zero, when it is inside, must reach the absolute part or
  // cross 0. With both ends outside the bounds, the row is not a root.
  //
  // Rows with the same probe point share one evaluation. The last point
  // checked is remembered, since a solve can ask twice at one point.
  let probedPoint: number[] | undefined;
  let probedResult = false;
  const zeroWithinReach = (
    rr: number[],
    JJ: number[][],
    t: number[]
  ): boolean => {
    if (rootTolerance === undefined) return true;
    if (t === probedPoint) return probedResult;
    const tol = rootTolerance;
    const rel = Number.EPSILON / (2 * tol);
    const probes = new Map<string, number[]>();
    const residualAt = (point: number[]): number[] => {
      const key = point.join(',');
      let rp = probes.get(key);
      if (rp === undefined) {
        rp = residual(point);
        probes.set(key, rp);
      }
      return rp;
    };
    const inBounds = (point: number[]): boolean =>
      point.every((v, j) => v >= lo[j] && v <= hi[j]);
    let result = true;
    for (let i = 0; i < rr.length && result; i++) {
      const ri = rr[i];
      if (Math.abs(ri) <= tol) continue;
      const sign = Math.sign(ri);
      const row = JJ[i];
      const step = t.map((v, j) =>
        lo[j] === hi[j]
          ? 0
          : -sign * Math.sign(row[j]) * 2 * tol * Math.max(1, Math.abs(v))
      );
      // The change of `z` the Jacobian predicts for the step: negative.
      let predicted = 0;
      for (let j = 0; j < p; j++) predicted += sign * row[j] * step[j];
      const z0 = Math.abs(ri);
      const plus = t.map((v, j) => v + step[j]);
      const minus = t.map((v, j) => v - step[j]);
      const plusInside = inBounds(plus);
      const minusInside = inBounds(minus);
      const asPredicted = (change: number, expected: number): boolean =>
        Math.abs(change - expected) <= 0.5 * Math.abs(expected);
      if (plusInside && minusInside) {
        const zp = sign * residualAt(plus)[i];
        const zm = sign * residualAt(minus)[i];
        const b = (zp - zm) / 2;
        const c = (zp + zm) / 2 - z0;
        let lowest = Math.min(zp, zm);
        if (c > 0 && Math.abs(b) <= 2 * c) lowest = z0 - (b * b) / (4 * c);
        const rounding = c > 0 ? 4 * c * rel * rel : 0;
        result = asPredicted(b, predicted) && lowest <= tol + rounding;
      } else if (plusInside) {
        const zp = sign * residualAt(plus)[i];
        result = asPredicted(zp - z0, predicted) && zp <= tol;
      } else if (minusInside) {
        const zm = sign * residualAt(minus)[i];
        result = asPredicted(zm - z0, -predicted);
      } else {
        result = false;
      }
    }
    probedPoint = t;
    probedResult = result;
    return result;
  };

  // Whether the cost at a point is at its rounding floor: the sum of squares
  // of the first-order rounding of each residual's evaluation, a machine
  // epsilon of the magnitude of the terms its row computes, `Σⱼ |Jᵢⱼ · θⱼ|`
  // (the data value is of the same order at a fit). Below it the solver
  // is minimizing rounding, and the gains of its steps mean nothing: an
  // exact degree-10 polynomial fit at a cost of 2 · 10⁻²⁰ still gained
  // 10⁻²⁴ an accepted step. Read only by the tolerance stall below: a point
  // within the tolerance whose cost is still far above the floor is still
  // improving, and goes on (`1 + (10¹² a)² = 0` from `a = 10⁻¹¹` is within
  // the root tolerance of its steep equation at a residual of 101, and
  // reaches its minimum, a residual of 1, which is not a root).
  const costAtRoundingFloor = (
    JJ: number[][],
    t: number[],
    FF: number
  ): boolean => {
    let floor = 0;
    for (let i = 0; i < JJ.length; i++) {
      let terms = 0;
      const row = JJ[i];
      for (let j = 0; j < p; j++) terms += Math.abs(row[j] * t[j]);
      const rounding = Number.EPSILON * terms;
      floor += rounding * rounding;
    }
    return FF <= 0.5 * floor;
  };

  // Whether a point is `converged` (see `LMResult`): a root solve only
  // within its tolerance; a fit at a stationary point (`stat`, the solver's
  // own stop test there) or within its tolerance (an exact fit); a solve
  // with no tolerance at a stationary point. A root solve checks its
  // first-order test with the residual (`zeroWithinReach`, which costs
  // residual evaluations) only at a stationary point, where the solve would
  // stop; a point that fails the check is not converged, and the solve goes
  // on. The point a solve stops at for another reason is checked after the
  // loop.
  const isConverged = (
    rr: number[],
    JJ: number[][],
    t: number[],
    stat: boolean
  ): boolean =>
    rootTolerance !== undefined
      ? withinTolerance(rr, JJ, t) && (!stat || zeroWithinReach(rr, JJ, t))
      : stat || withinTolerance(rr, JJ, t);

  // The evaluations of the main loop, as steps when the caller gave the
  // step forms.
  const residualSteps = options.residualSteps;
  const jacobianSteps = options.jacobianSteps;
  const residualAt = function* (t: number[]): Steps<number[]> {
    return residualSteps ? yield* residualSteps(t) : residual(t);
  };
  const jacobianAt = function* (t: number[]): Steps<number[][]> {
    return jacobianSteps ? yield* jacobianSteps(t) : jacobian(t);
  };

  let theta = clampVec(theta0.slice());
  let r = yield* residualAt(theta);
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
  // the tolerance test (`isConverged`). With a tolerance, a root or an exact
  // fit is reported as soon as an accepted step reaches it, even when the
  // gradient test has not passed there.
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
    let J = yield* jacobianAt(theta);
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
    converged = isConverged(r, J, theta, stationary);

    // A solve that has reached a root or an exact fit goes on until the
    // point is also stationary (the gradient test, a negligible accepted
    // step, or a step within the tolerance of every parameter): the first
    // point within the tolerance of a steep equation can still be polished
    // (`10¹² x = 3 · 10¹²` is within its bound at a residual of 74, where
    // one more step reaches 0.002). Without a tolerance `converged` is
    // `stationary`, so the condition is the plain one.
    while (!(converged && stationary) && iterations < maxIterations) {
      yield;
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
        converged = isConverged(r, J, theta, true);
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
      // Whether the (projected) step moves every parameter by less than
      // the tolerance of its own scale, `tolerance · max(1, |θⱼ|)`, with a
      // parameter below 1 held to the absolute tolerance. Read only once the
      // point is within the tolerance AND its cost is at the rounding floor
      // (`costAtRoundingFloor`), as a post-acceptance stall check like
      // `stepStalled`: such a solve has nothing left to polish. Both parts
      // are needed. Without the floor, a point within the tolerance whose
      // residual is still dropping fast stops too early: `1 + (10¹² a)² = 0`
      // from `a = 10⁻¹¹` is within the root tolerance at a residual of 101
      // (its Jacobian is 2 · 10¹³), its first step is 5 · 10⁻¹², below the
      // absolute tolerance, and it would stop at a residual of 25 instead
      // of reaching the minimum, a residual of 1, which is not a root; and
      // `10¹² k = 1` from `k = 1` would stop at a relative error of 10⁻³ in
      // `k`, which `stepStalled`, relative to `k`, never allows. Without the
      // step part, a step that lands at the floor from far away would stop
      // before a stationarity test ran at the new point. `stepStalled`
      // alone cannot end such a solve when a parameter's true value is 0:
      // its steps shrink with it, and no step is ever small relative to the
      // parameter (the constant term of an exact polynomial fit through the
      // origin crept from 7 · 10⁻¹² toward 0 by 5 · 10⁻¹⁴ a step until
      // `maxIterations`, Tycho row 418).
      const toleranceStalled =
        tolerance !== undefined &&
        step.every(
          (s, j) => Math.abs(s) <= tolerance * Math.max(1, Math.abs(theta[j]))
        );

      const rNew = yield* residualAt(thetaNew);
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
        J = yield* jacobianAt(theta);
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

        // A root solve has converged at a root (see `rootTolerance`), a fit
        // at a stationary point or an exact fit (`fitTolerance`); the solve
        // stops once the point is also stationary (the loop condition), so
        // the first point within the bound of a steep equation is polished
        // by the steps that follow. A root solve that is not at a root goes
        // on past a stationary point: the gradient test is absolute, so a
        // residual scaled small passes it far from the root, and at a
        // least-squares minimum that is not a root the next steps are
        // rejected until the step collapses, which exits below.
        converged = isConverged(r, J, theta, stationary);
        if (converged && stationary) break;

        // A solve within its tolerance, at the rounding floor of its cost,
        // whose accepted step moved every parameter by less than the
        // precision the tolerance determines it to (`toleranceStalled`) has
        // settled: the point is stationary for the purpose of the record.
        // Judged on the step just taken, after it, so a point that the step
        // reached is not stopped at before a test ran there.
        if (converged && toleranceStalled && costAtRoundingFloor(J, theta, F)) {
          stationary = true;
          break;
        }

        // Secondary (stall) convergence test — applied ONLY here, after an
        // accepted improving step: the step we just took, and accepted, is
        // negligible relative to θ, so we have settled at a (local) minimum.
        // Because this only fires post-acceptance, it can no longer report
        // convergence on the rejection path (where λ growth or the box projection
        // shrink the PROPOSED step at a point that never improved) — the original
        // bug. A root solve that settles here keeps the root test's answer:
        // at a minimum above its tolerance `converged` stays false. A root
        // solve whose step, small relative to θ, still more than halved the
        // cost has not settled and goes on: on a steep equation the step to
        // the root is below `stepTol` relative to θ, and the solve stopped at
        // a residual the next steps remove (`a² = 10¹²` at a residual of
        // 0.14, one step from 0; `sin(10⁸ a) = 0.5` at 3 · 10⁻⁵, two steps
        // from 6 · 10⁻⁹).
        if (
          stepStalled &&
          !(rootTolerance !== undefined && actual > 0.5 * (F + actual))
        ) {
          stationary = true;
          converged = isConverged(r, J, theta, true);
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

    // A root solve that stopped at a point within the first-order test
    // without the residual check (a tolerance stall, a step that collapsed
    // on rejection, `maxIterations`) checks it now (see `isConverged`).
    if (converged && rootTolerance !== undefined)
      converged = zeroWithinReach(r, J, theta);
  } catch (e) {
    if (!isTimeoutCancellation(e)) throw e;
    timedOut = true;
    // A solve cut short is not converged, whatever its last point had
    // reached: a fit within its tolerance, or a root solve at a root, that
    // was still polishing would otherwise report `converged: true` beside
    // `timedOut: true`, which the record's contract (`LMResult`, the setup
    // timeout record of `nonlinear-fit.ts`) and the global search
    // (`best.converged && !timedOut`) both exclude.
    converged = false;
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
