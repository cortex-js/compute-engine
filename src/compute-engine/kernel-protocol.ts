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
 * the worker while the main thread has already settled its result.
 */

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
}

/** The inputs of a batch in wire form: the names and, in the same order, a
 * `Float64Array` per array variable or a number per scalar variable. */
export interface WireInputs {
  names: string[];
  values: (Float64Array | number)[];
}

export type MainToWorkerMessage =
  /** Rebuild the function of `kernel` under `id`; the worker keeps it. */
  | { type: 'load'; id: number; kernel: StoredKernel }
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
    }
  /** Forget kernel `id`: its compilation result was collected. */
  | { type: 'unload'; id: number };

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
  /** A failure to load a kernel (`id`) or to run a task (`job`). */
  | { type: 'error'; job?: number; id?: number; message: string };
