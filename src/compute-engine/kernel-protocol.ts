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
 * on the main thread: an aborted task that has not been sent is dropped on
 * the main thread. A running task is cancelled through shared memory, not
 * through a message: a worker runs its task synchronously, and a browser
 * worker cannot read a message before the task ends. When the host has
 * `SharedArrayBuffer` (Node, and a cross-origin isolated page), each task
 * carries the worker's cancel flag, an `Int32Array` of one element over a
 * `SharedArrayBuffer`. To cancel the task, the pool writes the task's job id
 * into the flag; the worker's loop reads the flag between cells or grid
 * points, stops, and answers with the cells or points done, as at a
 * deadline. The main thread has already settled the task: the answer is
 * dropped, and the pool then sends the worker its next task. Without
 * `SharedArrayBuffer`, the task runs to its end. In both cases, a worker
 * that does not answer within the pool's grace period is terminated and
 * replaced.
 *
 * A `call` task runs a stored `javascript` lambda (`calling: 'lambda'`)
 * once, with positional arguments, and answers with its value
 * (`call-result`). It is the task of a `parallel for` loop that
 * `runAsync()` gives to the pool: each worker runs the loop over one
 * sub-range of its passes (design:
 * `docs/plans/2026-11-08-ce1163-run-async-parallel-for.md`, section 4). The
 * arguments and the value are numbers, booleans, strings, nested plain
 * arrays of these, and `Float64Array`s. The arguments are copied, so the
 * caller keeps them. A `Float64Array` of the value, at the top level or as
 * an element of a top-level array, is transferred. The compiled function
 * does not read the cancel flag: the worker reads it only before the call
 * starts, and an aborted call that has started runs to its end, or until
 * the pool terminates the worker after the grace period.
 */

import type { FitScanProblemOf } from './fit-scan.js';
import type { StoredBatchBody } from './compilation/types.js';

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
  /** The batch body of a `javascript` result, as the result carries it
   * (`StoredBatchBody`). */
  batch?: StoredBatchBody;
  /** The free variables declared `boolean` of an `interval-js` result
   * (`CompilationResult.booleanInputs`). */
  booleanInputs?: string[];
  /** A `javascript` lambda with `preambleOnce`: `code` without the
   * once-only definitions (`CompilationResult.callCode`). */
  callCode?: string;
  /** The value kind types whose compiled representation the code reads or
   * makes (`CompilationResult.valueKinds`). The worker refuses such code,
   * as `createJavaScriptRuntime().load()` does. */
  valueKinds?: string[];
}

/** The inputs of a batch in wire form: the names and, in the same order, a
 * `Float64Array` per array variable or a number per scalar variable. */
export interface WireInputs {
  names: string[];
  /** A boolean and an array of booleans are the scalar and the column of a
   * boolean variable, for both targets. */
  values: (Float64Array | number | boolean | readonly boolean[])[];
}

/** The shared inputs of a batch in wire form: the names and, in the same
 * order, the lists that the compiled code reads, bound once for the whole
 * batch. A `Float64Array` travels as a transferred copy; a plain array is
 * cloned. A plain array of a `javascript` batch holds numbers; one of an
 * `interval-js` batch holds numbers and `{ lo, hi }` objects. The worker
 * reads the shared names of each task from its `shared` option, not from
 * the stored kernel. */
export interface WireShared {
  names: string[];
  values: (Float64Array | readonly unknown[])[];
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
      /** The worker's cancel flag: the task stops when the flag holds
       * `job` (as a 32-bit integer). */
      cancel?: Int32Array;
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
      /** `grid` layout: the inputs that are index axes (the
       * `indexes` option of `broadcast`); each value in `inputs` is the
       * axis length. */
      indexes?: string[];
      /** The batch whose shared inputs the cells read, when the batch has
       * shared inputs. The worker keeps them under this id until `release`. */
      batch?: number;
      /** The shared inputs of `batch`: sent with the first task of the
       * batch that a worker receives, absent from its later tasks. */
      shared?: WireShared;
      /** The worker's cancel flag: the task stops when the flag holds
       * `job` (as a 32-bit integer). */
      cancel?: Int32Array;
    }
  /** Call the lambda of kernel `id` (a `javascript` kernel with
   * `calling: 'lambda'`) once with `args`, and answer with its value. */
  | {
      type: 'call';
      job: number;
      id: number;
      args: unknown[];
      /** The engine's iteration limit at the time of the call, for the
       * lazy-stream helpers of the compiled-code runtime. */
      iterationLimit?: number;
      /** The worker's cancel flag: the worker does not start the call when
       * the flag holds `job` (as a 32-bit integer). The compiled function
       * does not read it once it runs. */
      cancel?: Int32Array;
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
   * (`interval-js`), the count of cells written: `to - from`, or fewer
   * when the deadline stopped the loop, and the count of those cells whose
   * evaluation threw (`BroadcastSlice.failures`). */
  | {
      type: 'result';
      job: number;
      out: Float64Array;
      done: number;
      failed: number;
    }
  /** The solutions of a `fit-run` slice, per point a code (0 solved, 1 no
   * solution, 2 nonlinear), the sum of squared residuals and the full
   * parameter vector (`writeScanSolution()` in `fit-scan.ts`), and the count
   * of points written: all of them, or fewer when the deadline stopped the
   * loop or a point was nonlinear (it is then the last one written). */
  | { type: 'fit-result'; job: number; out: Float64Array; done: number }
  /** The value that the lambda of a `call` task returned. */
  | { type: 'call-result'; job: number; value: unknown }
  /** A failure to load a kernel or a fit problem (`id`) or to run a task
   * (`job`). */
  | { type: 'error'; job?: number; id?: number; message: string };
