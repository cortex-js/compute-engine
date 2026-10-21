/**
 * The messages between a kernel pool (`kernel-pool.ts`, main thread) and a
 * kernel worker (`src/kernel-worker.ts`). Types only, shared by both ends.
 *
 * Everything that crosses the boundary is plain data: the text of a compiled
 * function (a stored compilation result), typed arrays of inputs, and a
 * typed array of results. The arrays are transferred, not copied (design:
 * `docs/plans/2026-10-20-worker-kernel-pool.md`, section 5.1).
 *
 * The pool sends a worker one task at a time and keeps the rest of its queue
 * on the main thread, so there is no cancel message: an aborted task that has
 * not been sent is dropped on the main thread, and a running one finishes on
 * the worker while the main thread has already settled its result. The
 * worker's reply to that task is dropped, and the pool then sends the
 * worker its next task.
 */

import type { FitScanProblemOf } from './fit-scan.js';

export type KernelKind = 'javascript' | 'interval-js';

/**
 * The fields of a compilation result that a worker needs to rebuild the
 * function: what `createJavaScriptRuntime().load()` and
 * `createIntervalRuntime().load()` read.
 */
export interface StoredKernel {
  kind: KernelKind;
  runtimeVersion?: string;
  code: string;
  calling?: 'expression' | 'lambda';
  preamble?: string;
  preambleOnce?: string;
  preamblePerCall?: string;
  /** The stored entry plan of a `javascript` result, as the result carries it. */
  entryPlan?: unknown;
  reconstructionDigits?: number;
  /** The default count of values per cell of a `javascript` result (the
   * arity of a tuple-of-numbers expression), as the result carries it;
   * absent means 1. */
  broadcastOutputs?: number;
}

/** The inputs of a batch in wire form: the names and, in the same order, a
 * `Float64Array` per array variable or a number per scalar variable. */
export interface WireInputs {
  names: string[];
  values: (Float64Array | number)[];
}

/** The shared inputs of a `javascript` batch in wire form: the names and, in
 * the same order, the arrays that the compiled code reads by index, bound
 * once for the whole batch. A `Float64Array` travels as a transferred copy;
 * a plain array is cloned. */
export interface WireShared {
  names: string[];
  values: (Float64Array | readonly number[])[];
}

/**
 * The problem of a `FindFit` separable scan (`fit-scan.ts`) in wire form:
 * the model and the derivative columns of each unit as stored `javascript`
 * compilation results (compiled from an expression, so `calling` is
 * `'expression'`), and the rows, every row and the scan's sample, as
 * `Float64Array`s.
 */
export type WireFitProblem = FitScanProblemOf<StoredKernel>;

export type MainToWorkerMessage =
  /** Rebuild the function of `kernel` under `id`; the worker keeps it. */
  | { type: 'load'; id: number; kernel: StoredKernel }
  /** Rebuild the functions of the fit `problem` under `id`; the worker
   * keeps it. The pool sends it once per worker and per fit. */
  | { type: 'fit-load'; id: number; problem: WireFitProblem }
  /** Solve the grid points `points` of the fit problem `id` (flattened,
   * `width` values per point, `width > 0`), on every row with `allRows` or
   * on the sample of the rows otherwise. */
  | {
      type: 'fit-run';
      job: number;
      id: number;
      points: Float64Array;
      width: number;
      allRows: boolean;
      /** `Date.now()` time after which the loop stops early. */
      deadline?: number;
      /** The engine's iteration limit at the time of the call, for the
       * lazy-stream helpers of the compiled-code runtime. */
      iterationLimit?: number;
    }
  /** Evaluate the cells `[from, to)` of the batch on kernel `id`. */
  | {
      type: 'run';
      job: number;
      id: number;
      inputs: WireInputs;
      layout: 'cells' | 'grid';
      from: number;
      to: number;
      /** `Date.now()` time after which the loop stops early. */
      deadline?: number;
      /** The engine's iteration limit at the time of the call, for the
       * lazy-stream helpers of the compiled-code runtime. */
      iterationLimit?: number;
      /** `javascript` only: the count of values written per cell. Absent
       * means the kernel's `broadcastOutputs`, or 1. */
      outputs?: number;
      /** The batch whose shared inputs the cells read, when the batch has
       * shared inputs. The worker keeps them under this id until `release`. */
      batch?: number;
      /** The shared inputs of `batch`: sent with the first task of the
       * batch that a worker receives, absent from its later tasks. */
      shared?: WireShared;
    }
  /** Forget kernel or fit problem `id`: its compilation result was
   * collected, or the fit is over. */
  | { type: 'unload'; id: number }
  /** Forget the shared inputs of batch `batch`: the batch is over. */
  | { type: 'release'; batch: number };

export type WorkerToMainMessage =
  | {
      type: 'ready';
      /** The version of the compiled-code runtime the worker holds. */
      runtimeVersion: string;
      /** The version of the interval library the worker holds. */
      intervalRuntimeVersion: string;
    }
  | { type: 'loaded'; id: number }
  /** The slice's results, one value per cell (`javascript`) or three
   * (`interval-js`), and the count of cells written: `to - from`, or fewer
   * when the deadline stopped the loop. */
  | { type: 'result'; job: number; out: Float64Array; done: number }
  /** The solutions of a `fit-run` slice, per point a code (0 solved, 1 no
   * solution, 2 nonlinear), the sum of squared residuals and the full
   * parameter vector (`writeScanSolution()` in `fit-scan.ts`), and the count
   * of points written: all of them, or fewer when the deadline stopped the
   * loop or a point was nonlinear (it is then the last one written). */
  | { type: 'fit-result'; job: number; out: Float64Array; done: number }
  /** A failure to load a kernel or a fit problem (`id`) or to run a task
   * (`job`). */
  | { type: 'error'; job?: number; id?: number; message: string };
