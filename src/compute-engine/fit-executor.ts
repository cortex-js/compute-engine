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
 * on the calling thread and on a pool of worker threads (design:
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
 *
 * `AsyncInlineFitExecutor` runs the same tasks in the same order on the
 * calling thread for `FindFit`'s `evaluateAsync()`, and gives the event loop
 * a turn every few milliseconds: between two tasks, and between two
 * iterations of a solver run (`runSteps`, `runStepsAsync()` in
 * `common/cooperative-steps.ts`).
 *
 * `PoolFitExecutor` is the asynchronous executor of `FindFit`'s
 * `evaluateAsync()` when the engine has a kernel pool: it sends the
 * separable-scan points of a batch to the workers of the pool, in one slice
 * per worker, and runs the solver starts on the calling thread.
 * `runFitPlanAsync` drives a plan on either asynchronous executor.
 */

import {
  CancellationError,
  isTimeoutCancellation,
} from '../common/interruptible.js';
import type { LMResult } from './numerics/levenberg-marquardt.js';
import {
  runStepsAsync,
  runStepsSync,
  type EventLoopPacer,
  type Steps,
} from '../common/cooperative-steps.js';
import {
  readScanSolution,
  scanResultWidth,
  type LinearScanSolution,
} from './fit-scan.js';
import type { WireFitProblem } from './kernel-protocol.js';

export type { LinearScanSolution };

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
  /** `lm` as a step function that yields between two iterations of the
   * solver (`levenbergMarquardtSteps`), so that an asynchronous executor
   * can give the event loop a turn inside a long run. Without it, a run is
   * one step. */
  lmSteps?: (theta0: number[]) => Steps<LMResult>;
  /** `startRss` as a step function that yields between rows. */
  startRssSteps?: (theta0: number[]) => Steps<number>;
}

export interface FitExecutor {
  /** Run a batch. May stop early (see the module comment). */
  run: (tasks: FitTask[]) => FitBatchResult;
}

/** Runs each task on the calling thread, in order. */
export class InlineFitExecutor implements FitExecutor {
  constructor(private readonly kernel: FitKernel) {}

  run(tasks: FitTask[]): FitBatchResult {
    return runStepsSync(this.runSteps(tasks, false));
  }

  /**
   * `run` as a step function: it yields after each task. With `stepped`
   * (the default), it uses the kernel's `lmSteps` and `startRssSteps` when
   * it has them, and so also yields inside a solver run and between rows.
   * `run` passes `false`: it runs to the end without stopping, and the
   * plain `lm` and `startRss` avoid the cost of resuming the generators
   * every few rows. The tasks that run and their results do not depend on
   * how it is run.
   */
  *runSteps(tasks: FitTask[], stepped = true): Steps<FitBatchResult> {
    const results: FitTaskResult[] = [];
    let first = true;
    for (const task of tasks) {
      if (!first) yield;
      first = false;
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
          startRss =
            stepped && this.kernel.startRssSteps !== undefined
              ? yield* this.kernel.startRssSteps(task.theta0)
              : this.kernel.startRss(task.theta0);
          if (!Number.isFinite(startRss)) {
            results.push({ kind: 'start', index: task.index, startRss });
            continue;
          }
        }
        let lm: LMResult | undefined;
        try {
          lm =
            stepped && this.kernel.lmSteps !== undefined
              ? yield* this.kernel.lmSteps(task.theta0)
              : this.kernel.lm(task.theta0);
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

//
// The asynchronous executor: the separable scan on a kernel pool
//

export interface AsyncFitExecutor {
  /** Run a batch. May stop early (see the module comment). */
  run: (tasks: FitTask[]) => Promise<FitBatchResult>;
}

/**
 * Runs each task on the calling thread, in order, as `InlineFitExecutor`
 * does, and waits for a macrotask turn of the event loop whenever the slice
 * of `pacer` is over: between two tasks, and between two iterations of a
 * solver run. A timer, and an abort of a signal by a timer, can then run
 * during a long search, and a page stays responsive. `inStep` wraps each
 * step of the work (see `runStepsAsync()`).
 */
export class AsyncInlineFitExecutor implements AsyncFitExecutor {
  private readonly inline: InlineFitExecutor;

  constructor(
    kernel: FitKernel,
    private readonly pacer: EventLoopPacer,
    private readonly inStep: <R>(f: () => R) => R = (f) => f()
  ) {
    this.inline = new InlineFitExecutor(kernel);
  }

  run(tasks: FitTask[]): Promise<FitBatchResult> {
    return runStepsAsync(this.inline.runSteps(tasks), this.pacer, this.inStep);
  }
}

/**
 * Drive a plan to its outcome on an asynchronous executor: as
 * `runFitPlanSync`, with an `await` on each batch.
 */
export async function runFitPlanAsync<T>(
  plan: Generator<FitTask[], T, FitBatchResult>,
  executor: AsyncFitExecutor
): Promise<T> {
  let step = plan.next();
  while (!step.done) step = plan.next(await executor.run(step.value));
  return step.value;
}

/**
 * What `PoolFitExecutor` needs of a kernel pool (`KernelPoolImpl` in
 * `kernel-pool.ts` has it): its number of workers, and a call that solves a
 * slice of grid points of `problem` on one worker.
 */
export interface FitSlicePool {
  readonly size: number;
  /**
   * Solve the points of `points` (flattened, `problem.gridIdx.length` values
   * per point) on a worker. The pool takes ownership of `points` (its buffer
   * is transferred). Resolves to the encoded solutions
   * (`writeScanSolution()` in `fit-scan.ts`) and the count of points solved:
   * all of them, or fewer when the deadline stopped the loop, the signal
   * aborted the task, or a point was nonlinear (it is then the last one
   * written). Rejects when the pool cannot take the task, the worker refused
   * the problem or failed. `iterationLimit` is the engine's iteration limit,
   * which the lazy-stream helpers of the compiled code read on the worker.
   */
  runFitSlice: (
    problem: WireFitProblem,
    points: Float64Array,
    allRows: boolean,
    deadline: number | undefined,
    iterationLimit: number | undefined,
    signal: AbortSignal | undefined
  ) => Promise<{ out: Float64Array; done: number }>;
}

/**
 * Runs the separable-scan points of a batch on a kernel pool, and the solver
 * starts on the calling thread.
 *
 * The points of a batch are cut into one slice per worker (at least one
 * point per slice), in index order, and each slice is sent with
 * `runFitSlice`. Each worker returns a prefix of its slice; every returned
 * prefix is committed, since the plan reads the results by index. A slice
 * that the pool rejects (a refused problem, a worker that failed) is solved
 * here, point by point, with the kernel. A slice cut short by the deadline
 * marks the batch `timedOut`, and the plan reports what it has, as it does
 * with the inline executor. A grid point with no value to ship (a scan whose
 * every scanned parameter is a phase solved by least squares) is solved
 * here.
 *
 * The solver starts (the refinements and the multi-start) are short and
 * few, and run here through `InlineFitExecutor`.
 *
 * With `signal`, an abort rejects the batch with a `CancellationError` whose
 * `cause` is the signal's reason, as the other asynchronous evaluations do.
 * A slice that a worker runs when the signal aborts is cancelled: the pool
 * tells the worker to stop at its next grid point (or within 256 rows), and
 * replaces a worker that does not answer within the pool's grace period
 * (`cancelGrace`). The worker's answer is dropped.
 * `deadline` is a `Date.now()` time sent to the workers; the kernel's own
 * functions check the deadline (and the signal) on this thread.
 * `iterationLimit` is the engine's iteration limit, sent to the workers.
 * With `pacer`, the work on this thread gives the event loop a turn as
 * `AsyncInlineFitExecutor` does; `inStep` wraps each step of that work.
 *
 * `slicesOnPool` and `slicesDeclined` count the slices a worker solved and
 * the slices the pool could not take (solved here instead): the record of
 * the fit reads them to say which route the scan took.
 */
export class PoolFitExecutor implements AsyncFitExecutor {
  private readonly inline: InlineFitExecutor | AsyncInlineFitExecutor;
  /** The slices that a worker solved (all or a prefix of their points). */
  slicesOnPool = 0;
  /** The slices that the pool rejected, solved on this thread. */
  slicesDeclined = 0;

  constructor(
    kernel: FitKernel,
    private readonly pool: FitSlicePool,
    private readonly problem: WireFitProblem,
    private readonly options: {
      deadline?: number;
      iterationLimit?: number;
      signal?: AbortSignal;
      pacer?: EventLoopPacer;
      inStep?: <R>(f: () => R) => R;
    } = {}
  ) {
    this.inline =
      options.pacer !== undefined
        ? new AsyncInlineFitExecutor(kernel, options.pacer, options.inStep)
        : new InlineFitExecutor(kernel);
  }

  async run(tasks: FitTask[]): Promise<FitBatchResult> {
    this.throwIfAborted();
    const linear = tasks.filter(
      (t): t is LinearScanTask => t.kind === 'linear'
    );
    const starts = tasks.filter((t): t is StartTask => t.kind === 'start');
    const results: FitTaskResult[] = [];
    let timedOut = false;
    if (linear.length > 0) {
      const batch = await this.runLinear(linear);
      results.push(...batch.results);
      timedOut = batch.timedOut;
    }
    this.throwIfAborted();
    if (starts.length > 0 && !timedOut) {
      const batch = await this.inline.run(starts);
      results.push(...batch.results);
      timedOut = batch.timedOut;
    }
    return { results, timedOut };
  }

  private throwIfAborted(): void {
    const signal = this.options.signal;
    if (signal?.aborted) throw new CancellationError({ cause: signal.reason });
  }

  private async runLinear(tasks: LinearScanTask[]): Promise<FitBatchResult> {
    const width = this.problem.gridIdx.length;
    const allRows = tasks[0].allRows === true;
    // A point with no value to ship, or a batch that mixes the sample and
    // every row (the plan never yields one), runs here.
    if (width === 0 || tasks.some((t) => (t.allRows === true) !== allRows))
      return await this.inline.run(tasks);
    const p = this.problem.start.length;
    const stride = scanResultWidth(p);
    const count = Math.min(Math.max(1, this.pool.size), tasks.length);
    const per = Math.ceil(tasks.length / count);
    const slices: LinearScanTask[][] = [];
    for (let from = 0; from < tasks.length; from += per)
      slices.push(tasks.slice(from, from + per));
    const settled = await Promise.allSettled(
      // An `async` callback: a synchronous throw of the pool (its worker
      // factory failed) becomes a rejected slice, which is solved here.
      slices.map(async (slice) => {
        const points = new Float64Array(slice.length * width);
        slice.forEach((t, i) => points.set(t.point, i * width));
        return this.pool.runFitSlice(
          this.problem,
          points,
          allRows,
          this.options.deadline,
          this.options.iterationLimit,
          this.options.signal
        );
      })
    );
    const results: FitTaskResult[] = [];
    let timedOut = false;
    // Set once a point was nonlinear: the plan ignores every later index.
    let nonlinear = false;
    for (let s = 0; s < slices.length; s++) {
      const slice = slices[s];
      const r = settled[s];
      if (r.status === 'fulfilled') {
        this.slicesOnPool += 1;
        const { out, done } = r.value;
        let last: LinearScanSolution | undefined;
        for (let i = 0; i < done; i++) {
          const solved = readScanSolution(out, i * stride, p);
          results.push({ kind: 'linear', index: slice[i].index, solved });
          last = solved;
        }
        if (last === 'nonlinear') nonlinear = true;
        // Fewer points than the slice holds and no nonlinear point to end
        // it: the deadline (or an abort) stopped the worker. A slice after a
        // nonlinear point does not count: the inline executor would have
        // stopped at that point, before the deadline.
        else if (done < slice.length && !nonlinear) timedOut = true;
        continue;
      }
      // The pool could not solve this slice: solve it here, with the same
      // stops as the inline executor. After a deadline, or after a
      // nonlinear point at a lower index, the plan reads no result of it.
      this.slicesDeclined += 1;
      if (timedOut || nonlinear) continue;
      const inline = await this.inline.run(slice);
      results.push(...inline.results);
      if (inline.timedOut) timedOut = true;
      if (
        inline.results.some(
          (x) => x.kind === 'linear' && x.solved === 'nonlinear'
        )
      )
        nonlinear = true;
    }
    return { results, timedOut };
  }
}
