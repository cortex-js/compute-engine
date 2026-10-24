/**
 * The linear solve at one point of the separable scan of a `FindFit` global
 * search, over plain numbers.
 *
 * The scan of `solveGlobal` (`nonlinear-fit.ts`) fixes the scanned
 * parameters at a grid point and solves the parameters the model is linear in
 * by least squares. This module holds that solve, with no engine behind it:
 * the model and its derivative columns are functions of a record of numbers,
 * and the rows are typed arrays. The main thread and a kernel worker
 * (`src/kernel-worker.ts`) both run `linearScanSolve()` on the same problem,
 * so a point solved on a worker is bit for bit the point the main thread
 * solves. The main thread builds the problem from its compiled (or
 * interpreted) functions; a worker builds it from the stored compiled code of
 * the same functions (`WireFitProblem` in `kernel-protocol.ts`).
 *
 * This module must not import the engine, the library or the boxed
 * expressions: the worker bundle is built from it.
 */

import { solveWithInflation } from './numerics/levenberg-marquardt.js';
import { runStepsSync, type Steps } from '../common/cooperative-steps.js';

/**
 * The result of a separable-scan point: the full parameter vector and its
 * sum of squared residuals; `null` when the normal equations have no
 * solution or the point is not finite; `'nonlinear'` when the model is not
 * linear in the parameters the scan assumed linear.
 */
export type LinearScanSolution =
  [theta: number[], rss: number] | null | 'nonlinear';

/** A numeric function of the fit variables and the parameters, read by their
 * fresh names from the record. */
export type RecordFn = (record: Record<string, number>) => number;

/** The rows of a unit: one array of values per fit variable (in the order of
 * the unit's `varFresh`), and the targets. All the arrays have one entry per
 * row. */
export interface FitScanRows {
  x: Float64Array[];
  y: Float64Array;
}

/** One model and its dataset, with the functions the scan evaluates. */
export interface FitScanUnitOf<F> {
  /** The fresh names of the fit variables. */
  varFresh: string[];
  /** Every row of the unit. */
  rows: FitScanRows;
  /** The rows the scan uses when it runs on a sample of the rows; absent
   * when the scan uses every row. */
  sample?: FitScanRows;
  /** The model. */
  model: F;
  /** The derivative of the model with respect to each linear parameter, in
   * the order of `linearIdx`: with the linear parameters at zero, the basis
   * column of that parameter. */
  columns: F[];
}

/**
 * An amplitude–phase pair that the scan solves by least squares: the model
 * holds `a · g(B + rate · c)` with `g` a sine or a cosine, `a` linear and `c`
 * scanned. `positive`: the amplitude is reported non-negative; otherwise
 * non-positive.
 */
export interface FitScanPhase {
  /** Index of the amplitude parameter `a` (one of `linearIdx`). */
  amplitude: number;
  /** Index of the phase parameter `c`. */
  phase: number;
  /** The derivative of the argument with respect to `c`, in radians. */
  rate: number;
  positive: boolean;
}

/**
 * The problem of a separable scan, with the functions of type `F`: a
 * `RecordFn` on the thread that solves, a stored compilation result in the
 * message that ships the problem to a worker.
 */
export interface FitScanProblemOf<F> {
  units: FitScanUnitOf<F>[];
  /** The fresh names of the parameters, shared by every unit. */
  paramFresh: string[];
  /** The indices of the parameters solved by least squares. */
  linearIdx: number[];
  /** The indices of the parameters a grid point gives values to, in the
   * order of the point's values. */
  gridIdx: number[];
  /** The bounds of each parameter, the global ranges included. */
  lo: number[];
  hi: number[];
  /** The parameter vector before the solve: the start of each parameter,
   * clamped to its bounds. */
  start: number[];
  /** The amplitude–phase pairs solved by least squares. */
  phases: FitScanPhase[];
}

export type FitScanProblem = FitScanProblemOf<RecordFn>;

/** Sum of squares of a residual vector, or `Infinity` for a non-finite one. */
export function sumOfSquares(r: number[]): number {
  let s = 0;
  for (const v of r) s += v * v;
  return Number.isFinite(s) ? s : Infinity;
}

const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

/**
 * Separable step: with the scanned parameters fixed at `point` (the values of
 * the parameters `gridIdx`), solve the linear parameters by least squares.
 * The model is linear in them, so with them at zero the model is the offset
 * and each derivative column is the basis column of its parameter. A linear
 * parameter with a box constraint is solved by an active-set loop: a value
 * outside its bounds is fixed at the bound it crossed, its column moves to
 * the offset, and the free parameters are solved again, until every free
 * value is inside its bounds. The sum of squared residuals the linear system
 * predicts is then compared with the model's actual residual at the solved
 * point: a disagreement means the model is not linear in those parameters
 * after all (a step function the structural test did not see), and the
 * answer is `'nonlinear'` so the caller falls back to the multi-start.
 * Returns the full vector and its sum of squared residuals, or `null` when
 * the normal equations cannot be solved or the point is not finite.
 *
 * Each phase of `problem.phases` is solved here too: with the phase at 0,
 * the column of its amplitude is `g(B)`; with the phase at a quarter turn,
 * `g(B + π/2)`. Both columns go into the least-squares system with unbounded
 * coefficients `p` and `q`, and the amplitude and the phase are then
 * `√(p² + q²)` and `atan2(q, p) / rate`, the phase brought into its range.
 *
 * The solve uses the sample of the rows of each unit when it has one, or
 * every row with `allRows` (the re-scoring of the best sampled points).
 *
 * `checkDeadline` is called once per row of each pass over the rows, and
 * throws when the time is up: the main thread passes the check of the
 * engine's deadline, a worker a check of the deadline it was sent.
 *
 * A worker and the synchronous route run this function. The asynchronous
 * route on the calling thread runs its step form, `linearScanSolveSteps()`,
 * which gives the same result.
 */
export function linearScanSolve(
  problem: FitScanProblem,
  point: ArrayLike<number>,
  allRows: boolean,
  checkDeadline: () => void
): LinearScanSolution {
  return runStepsSync(
    linearScanSolveSteps(problem, point, allRows, checkDeadline, false)
  );
}

/** How many rows the step form of the scan solve walks between two checks
 * of the time. */
const SCAN_ROWS_PER_STEP = 8;

/** The step form of the scan solve yields at a check of the time only when
 * at least this many milliseconds passed since it started or last yielded:
 * for a compiled model, a yield every few rows would cost more than the
 * rows. */
const SCAN_MS_PER_STEP = 1;

/**
 * `linearScanSolve()` as a step function. With `rowSteps`, it can yield
 * inside each pass over the rows (every `SCAN_ROWS_PER_STEP` rows, when
 * `SCAN_MS_PER_STEP` milliseconds passed), so that the asynchronous route
 * gives the event loop a turn inside one grid point of an interpreted model
 * (one point of a model with 200 rows took about 110 ms, ROADMAP CE-429).
 * Without `rowSteps` it never yields. The result does not depend on
 * `rowSteps`: the record of the functions is local to the call.
 */
export function* linearScanSolveSteps(
  problem: FitScanProblem,
  point: ArrayLike<number>,
  allRows: boolean,
  checkDeadline: () => void,
  rowSteps: boolean
): Steps<LinearScanSolution> {
  let rowCount = 0;
  let last = rowSteps ? Date.now() : 0;
  /** True when the walk should yield before the next row. */
  const due = (): boolean => {
    if (!rowSteps || ++rowCount % SCAN_ROWS_PER_STEP !== 0) return false;
    const now = Date.now();
    if (now - last < SCAN_MS_PER_STEP) return false;
    last = now;
    return true;
  };
  const { units, paramFresh, linearIdx, gridIdx, lo, hi, phases } = problem;
  const p = paramFresh.length;
  const theta = problem.start.slice();
  gridIdx.forEach((j, k) => (theta[j] = point[k]));
  for (const j of linearIdx) theta[j] = 0;
  for (const ph of phases) theta[ph.phase] = 0;
  const nl = linearIdx.length;
  // The unknowns of the system: one per linear parameter, then one per
  // phase (the coefficient `q` of its quarter-turn column). The amplitude
  // of a phase and its `q` are unbounded: the bounds of the amplitude were
  // checked when the phase was chosen (`linearPhases()` in
  // `nonlinear-fit.ts`).
  const ns = nl + phases.length;
  const amplitudeSlots = phases.map((ph) => linearIdx.indexOf(ph.amplitude));
  const amplitudeSet = new Set(amplitudeSlots);
  const slotLo: number[] = [];
  const slotHi: number[] = [];
  for (let a = 0; a < ns; a++) {
    const bounded = a < nl && !amplitudeSet.has(a);
    slotLo.push(bounded ? lo[linearIdx[a]] : -Infinity);
    slotHi.push(bounded ? hi[linearIdx[a]] : Infinity);
  }
  const quarterTurns = phases.map((ph) => Math.PI / (2 * ph.rate));

  /** The rows a pass reads, per unit. */
  const rowsOf = (unit: FitScanUnitOf<RecordFn>): FitScanRows =>
    allRows ? unit.rows : (unit.sample ?? unit.rows);
  /** The record of the functions: every parameter at `theta`; the variables
   * are written per row. */
  const record: Record<string, number> = {};
  for (let j = 0; j < p; j++) record[paramFresh[j]] = theta[j];

  // Per data row: the offset (the model with the linear parameters at zero)
  // and the basis column values, kept for the active-set loop and the check.
  const offsets: number[] = [];
  const targets: number[] = [];
  const columns: number[][] = [];
  for (const unit of units) {
    const rows = rowsOf(unit);
    const nv = unit.varFresh.length;
    const n = rows.y.length;
    for (let i = 0; i < n; i++) {
      if (due()) yield;
      checkDeadline();
      for (let k = 0; k < nv; k++) record[unit.varFresh[k]] = rows.x[k][i];
      const offset = unit.model(record);
      const phi = unit.columns.map((column) => column(record));
      phases.forEach((ph, m) => {
        const name = paramFresh[ph.phase];
        record[name] = quarterTurns[m];
        phi.push(unit.columns[amplitudeSlots[m]](record));
        record[name] = 0;
      });
      if (!Number.isFinite(offset) || phi.some((v) => !Number.isFinite(v)))
        return null;
      offsets.push(offset);
      targets.push(rows.y[i]);
      columns.push(phi);
    }
  }

  // Active-set loop over the unknowns: `fixed[a]` holds the value an
  // unknown is pinned at (a bound it crossed), or NaN while it is free.
  const values: number[] = new Array(ns).fill(0);
  const fixed: number[] = new Array(ns).fill(NaN);
  // An unknown whose column is zero, or nearly a combination of the
  // columns before it, is pinned at 0 (or the bound nearest 0) first. At
  // such a point (`b x` a whole number of turns at every row, so the sine
  // column vanishes and the cosine column is constant) the normal equations
  // are singular, and solving them anyway gives two huge coefficients that
  // cancel: the model at those values then loses its precision and fails
  // the linearity check below. The test is an incremental Cholesky
  // factorization of the Gram matrix of the columns: a column is dependent
  // when its squared distance from the span of the kept columns is at most
  // `1e-12` times its squared norm. The two columns of a phase have the
  // same scale (the amplitude's coefficient times `g(B)` and `g(B + π/2)`),
  // so one of them is also dropped when its squared norm is at most
  // `1e-12` times their sum: rounding leaves such a column at about 1e-14
  // instead of 0, which is not dependent on the others but carries no
  // information either.
  {
    const gram: number[][] = Array.from({ length: ns }, () =>
      new Array(ns).fill(0)
    );
    for (const phi of columns)
      for (let u = 0; u < ns; u++)
        for (let v = 0; v <= u; v++) gram[u][v] += phi[u] * phi[v];
    phases.forEach((_ph, m) => {
      const u = amplitudeSlots[m];
      const v = nl + m;
      const total = gram[u][u] + gram[v][v];
      if (gram[v][v] <= 1e-12 * total) fixed[v] = 0;
      else if (gram[u][u] <= 1e-12 * total) fixed[u] = 0;
    });
    const kept: number[] = [];
    const factor: number[][] = [];
    for (let i = 0; i < ns; i++) {
      if (!Number.isNaN(fixed[i])) continue;
      const l: number[] = [];
      for (let t = 0; t < kept.length; t++) {
        let s = gram[i][kept[t]];
        for (let u = 0; u < t; u++) s -= l[u] * factor[t][u];
        l.push(s / factor[t][t]);
      }
      let d = gram[i][i];
      for (const v of l) d -= v * v;
      if (!(d > 1e-12 * gram[i][i])) {
        fixed[i] = clamp(0, slotLo[i], slotHi[i]);
        continue;
      }
      l.push(Math.sqrt(d));
      factor.push(l);
      kept.push(i);
    }
  }
  for (let pass = 0; pass <= ns; pass++) {
    const free: number[] = [];
    for (let a = 0; a < ns; a++) if (Number.isNaN(fixed[a])) free.push(a);
    const nf = free.length;
    const A: number[][] = Array.from({ length: nf }, () =>
      new Array(nf).fill(0)
    );
    const b: number[] = new Array(nf).fill(0);
    for (let r = 0; r < columns.length; r++) {
      const phi = columns[r];
      let target = targets[r] - offsets[r];
      for (let a = 0; a < ns; a++)
        if (!Number.isNaN(fixed[a])) target -= phi[a] * fixed[a];
      for (let u = 0; u < nf; u++) {
        b[u] += phi[free[u]] * target;
        for (let v = 0; v < nf; v++) A[u][v] += phi[free[u]] * phi[free[v]];
      }
    }
    const sol = nf > 0 ? solveWithInflation(A, b) : [];
    if (!sol) return null;
    let crossed = false;
    free.forEach((a, u) => {
      if (sol[u] < slotLo[a]) {
        fixed[a] = slotLo[a];
        crossed = true;
      } else if (sol[u] > slotHi[a]) {
        fixed[a] = slotHi[a];
        crossed = true;
      } else values[a] = sol[u];
    });
    if (!crossed) break;
  }
  for (let a = 0; a < ns; a++)
    if (!Number.isNaN(fixed[a])) values[a] = fixed[a];
  for (let a = 0; a < nl; a++) theta[linearIdx[a]] = values[a];
  phases.forEach((ph, m) => {
    const pc = values[amplitudeSlots[m]];
    const qc = values[nl + m];
    let amplitude = Math.hypot(pc, qc);
    let angle = Math.atan2(qc, pc);
    // `−A · g(t + π) = A · g(t)` for a sinusoid `g`: a non-positive
    // amplitude when its bounds ask for one.
    if (!ph.positive) {
      amplitude = -amplitude;
      angle += Math.PI;
    }
    theta[ph.amplitude] = amplitude;
    theta[ph.phase] = wrapPhase(angle / ph.rate, ph, lo, hi);
  });

  // The linear prediction against the model itself at the solved point.
  let predicted = 0;
  for (let r = 0; r < columns.length; r++) {
    let value = offsets[r];
    for (let a = 0; a < ns; a++) value += columns[r][a] * values[a];
    predicted += (value - targets[r]) ** 2;
  }
  for (let j = 0; j < p; j++) record[paramFresh[j]] = theta[j];
  const residuals: number[] = [];
  for (const unit of units) {
    const rows = rowsOf(unit);
    const nv = unit.varFresh.length;
    const n = rows.y.length;
    for (let i = 0; i < n; i++) {
      if (due()) yield;
      checkDeadline();
      for (let k = 0; k < nv; k++) record[unit.varFresh[k]] = rows.x[k][i];
      residuals.push(unit.model(record) - rows.y[i]);
    }
  }
  const rss = sumOfSquares(residuals);
  if (!Number.isFinite(rss)) return null;
  if (Math.abs(rss - predicted) > 1e-8 * (1 + rss + predicted))
    return 'nonlinear';
  return [theta, rss];
}

/**
 * The number of values per point in the encoded solutions of a slice of
 * points (`p` parameters): a code, the sum of squared residuals, and the
 * parameter vector.
 */
export function scanResultWidth(p: number): number {
  return 2 + p;
}

/**
 * Write the solution `s` of a point at `offset` of `out`, as the code (0
 * solved, 1 `null`, 2 `'nonlinear'`), the sum of squared residuals and the
 * `p` parameters (`NaN` when there is no vector).
 */
export function writeScanSolution(
  out: Float64Array,
  offset: number,
  s: LinearScanSolution,
  p: number
): void {
  if (s === null || s === 'nonlinear') {
    out[offset] = s === null ? 1 : 2;
    out.fill(NaN, offset + 1, offset + 2 + p);
    return;
  }
  out[offset] = 0;
  out[offset + 1] = s[1];
  for (let j = 0; j < p; j++) out[offset + 2 + j] = s[0][j];
}

/** Read the solution that `writeScanSolution` wrote at `offset`. */
export function readScanSolution(
  out: Float64Array,
  offset: number,
  p: number
): LinearScanSolution {
  const code = out[offset];
  if (code === 1) return null;
  if (code === 2) return 'nonlinear';
  return [
    Array.from(out.subarray(offset + 2, offset + 2 + p)),
    out[offset + 1],
  ];
}

/**
 * The value of the phase of `ph` brought into its range `[lo, hi]` modulo
 * its period `2π / |rate|`: `lo + ((value − lo) mod period)`, at most `hi`.
 * The range is at least one period wide (the phase is solved by least
 * squares only then), so every phase has a value in it.
 */
export function wrapPhase(
  value: number,
  ph: { phase: number; rate: number },
  lo: number[],
  hi: number[]
): number {
  const period = (2 * Math.PI) / Math.abs(ph.rate);
  const phLo = lo[ph.phase];
  return Math.min(
    hi[ph.phase],
    phLo + ((((value - phLo) % period) + period) % period)
  );
}
