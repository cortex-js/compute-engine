/**
 * The work units of a `FindFit` global search, and the executor that runs
 * them.
 *
 * The global search of `FindFit` (`solveGlobal` in `nonlinear-fit.ts`) is
 * written as a PLAN: a generator that yields a batch of tasks, receives their
 * results, and goes on until it has an outcome. The plan knows the algorithm
 * (which grid to scan, which minima to refine, how to pick the winner); the
 * executor knows how to run a task. Each task is pure-number work: a start
 * vector in, a solver result out. That split is what lets the same plan run
 * on the calling thread today and on a pool of worker threads later (design:
 * `docs/plans/2026-10-20-worker-kernel-pool.md`, section 5.5), where the
 * tasks are shipped as numbers and the compiled model as text.
 *
 * Two rules keep the plan independent of the executor:
 *
 * - Every result carries the `index` of its task, and the plan reads results
 *   by index, never by arrival order. A pool returns them in any order.
 * - An executor may stop a batch early, after a task that hit the evaluation
 *   deadline or a separable-scan point that turned out nonlinear; the tasks
 *   after it then have no result. The plan treats a missing result as "not
 *   evaluated", which is what the serial loop it replaces did when it broke
 *   out at that point. After a nonlinear point the plan ignores every later
 *   index, so the outcome does not depend on which of them ran. After a
 *   deadline it uses every result that came back, so an executor that
 *   finished a different set of tasks before the deadline (a pool, which
 *   runs several at once) can report a different best point than the serial
 *   run; the design accepts that
 *   (`docs/plans/2026-10-20-worker-kernel-pool.md`, section 5.5).
 *
 * `InlineFitExecutor` runs the tasks on the calling thread, in order, and
 * stops at the first deadline or nonlinear point: exactly the loop of the
 * serial implementation, so the synchronous `evaluate()` route gives the same
 * record as before this module existed.
 */

import { isTimeoutCancellation } from '../common/interruptible.js';
import type { LMResult } from './numerics/levenberg-marquardt.js';

/** A point of the separable scan: the scanned parameters fixed at `point`,
 * the linear ones solved by least squares. With `allRows`, the solve uses
 * every data row even when the scan runs on a sample of the rows (the
 * re-scoring of the best points of a sampled scan). */
export interface LinearScanTask {
  kind: 'linear';
  index: number;
  point: number[];
  allRows?: boolean;
}

/**
 * A bounded Levenberg–Marquardt run from `theta0`. With `checkStart`, the
 * sum of squared residuals at the start is evaluated first and the run is
 * skipped when it is not finite (the multi-start); without it the run starts
 * unconditionally (the refinement of a scanned minimum).
 */
export interface StartTask {
  kind: 'start';
  index: number;
  theta0: number[];
  checkStart: boolean;
}

export type FitTask = LinearScanTask | StartTask;

/**
 * The result of a separable-scan point: the full parameter vector and its
 * sum of squared residuals; `null` when the normal equations have no
 * solution or the point is not finite; `'nonlinear'` when the model is not
 * linear in the parameters the scan assumed linear.
 */
export type LinearScanSolution =
  [theta: number[], rss: number] | null | 'nonlinear';

export interface LinearScanResult {
  kind: 'linear';
  index: number;
  solved: LinearScanSolution;
}

export interface StartResult {
  kind: 'start';
  index: number;
  /** The sum of squared residuals at the start when `checkStart` asked for
   * it (`Infinity` when not finite), `NaN` otherwise. */
  startRss: number;
  /** The solver result; absent when the start was not finite or the deadline
   * expired before the solver produced anything. */
  lm?: LMResult;
}

export type FitTaskResult = LinearScanResult | StartResult;

export interface FitBatchResult {
  /** One result per task that ran, in any order. */
  results: FitTaskResult[];
  /** True when the evaluation deadline expired during the batch: the results
   * are then partial, and the plan reports what it has. */
  timedOut: boolean;
}

/**
 * The pure-number operations a task needs. `solveGlobal` builds one from its
 * residual and Jacobian callbacks; a worker builds the same from the shipped
 * model text and rows. Each operation may throw the deadline's
 * `CancellationError`; `lm` may instead return a result with `timedOut`.
 */
export interface FitKernel {
  linearSolveAt: (point: number[], allRows: boolean) => LinearScanSolution;
  startRss: (theta0: number[]) => number;
  lm: (theta0: number[]) => LMResult;
}

export interface FitExecutor {
  /** Run a batch. May stop early (see the module comment). */
  run: (tasks: FitTask[]) => FitBatchResult;
}

/** Runs each task on the calling thread, in order. */
export class InlineFitExecutor implements FitExecutor {
  constructor(private readonly kernel: FitKernel) {}

  run(tasks: FitTask[]): FitBatchResult {
    const results: FitTaskResult[] = [];
    for (const task of tasks) {
      try {
        if (task.kind === 'linear') {
          const solved = this.kernel.linearSolveAt(
            task.point,
            task.allRows === true
          );
          results.push({ kind: 'linear', index: task.index, solved });
          // The structural test was wrong about this model: the plan falls
          // back to a multi-start, and the points after this one would be
          // wasted work.
          if (solved === 'nonlinear') break;
          continue;
        }
        let startRss = NaN;
        if (task.checkStart) {
          startRss = this.kernel.startRss(task.theta0);
          if (!Number.isFinite(startRss)) {
            results.push({ kind: 'start', index: task.index, startRss });
            continue;
          }
        }
        let lm: LMResult | undefined;
        try {
          lm = this.kernel.lm(task.theta0);
        } catch (e) {
          // The deadline expired before the solver produced anything (a
          // later expiry is caught inside the solver, which returns its best
          // point with `timedOut`).
          if (!isTimeoutCancellation(e)) throw e;
        }
        results.push({ kind: 'start', index: task.index, startRss, lm });
        if (lm === undefined || lm.timedOut) return { results, timedOut: true };
      } catch (e) {
        // A deadline expiring inside the scan or the start evaluation (the
        // residual callbacks check it per row).
        if (!isTimeoutCancellation(e)) throw e;
        return { results, timedOut: true };
      }
    }
    return { results, timedOut: false };
  }
}

/**
 * Drive a plan to its outcome on a synchronous executor: feed each batch the
 * plan yields to the executor and hand the results back, until the plan
 * returns.
 */
export function runFitPlanSync<T>(
  plan: Generator<FitTask[], T, FitBatchResult>,
  executor: FitExecutor
): T {
  let step = plan.next();
  while (!step.done) step = plan.next(executor.run(step.value));
  return step.value;
}
