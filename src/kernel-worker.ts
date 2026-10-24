// Entry point for the `@cortex-js/compute-engine/kernel-worker` file: the
// script of a worker thread that a kernel pool drives (`createKernelPool` in
// `src/compute-engine/kernel-pool.ts`; design:
// `docs/plans/2026-10-20-worker-kernel-pool.md`, section 5.2).
//
// The worker holds no engine. It holds the compiled-code runtime
// (`createJavaScriptRuntime`) and the interval runtime
// (`createIntervalRuntime`), rebuilds each compiled function it is sent from
// its stored text, keeps it under an id until told to forget it, and
// evaluates slices of batches with the same loop the main thread runs
// (`compilation/broadcast.ts`), so a cell computed here holds the value the
// main thread would compute. The pool sends one task at a time and ships the
// engine's iteration limit and the batch deadline with it, and the worker's
// cancel flag when the host has `SharedArrayBuffer`: the loop stops early
// when the pool writes the task's job id into the flag. The shared inputs
// of a batch (arrays the compiled code reads by index) come with the first
// task of the batch that this worker receives: the worker copies each into a
// plain array once, keeps it under the batch id, binds it in every later task
// of the batch, and forgets it on `release`.
//
// It also solves the grid points of the separable scan of a `FindFit` global
// search (`FindFit.evaluateAsync()` on an engine with a pool; design:
// `docs/plans/2026-10-20-findfit-global-grid.md`, section 4). `fit-load`
// sends the problem once per fit: the stored compiled code of the model and
// of its linear columns, and the rows. The worker rebuilds each function with
// `createJavaScriptRuntime().load()`, which refuses code compiled for another
// runtime version. Each `fit-run` is a slice of grid points, solved by
// `linearScanSolve()` (`src/compute-engine/fit-scan.ts`), the code the main
// thread runs for the points it solves itself, so a point solved here is the
// point the main thread would solve. The loop stops at the deadline it was
// sent and returns the points done.
//
// The file is built self-contained (no chunk imports) so that a host can copy
// it next to its own files and start it with
// `new Worker(url, { type: 'module' })`; in Node, with `worker_threads`. The
// messages are in `src/compute-engine/kernel-protocol.ts`.

import {
  createJavaScriptRuntime,
  RUNTIME_VERSION,
} from './compute-engine/compilation/javascript-runtime.js';
import { createIntervalRuntime } from './compute-engine/compilation/interval-runtime.js';
import { INTERVAL_RUNTIME_VERSION } from './compute-engine/interval/index.js';
import { isTimeoutCancellation } from './common/interruptible.js';
import type {
  BroadcastInputs,
  BroadcastOptions,
} from './compute-engine/compilation/types.js';
import {
  plainSharedArray,
  sharedInputsReadInPlace,
  type BroadcastSlice,
} from './compute-engine/compilation/broadcast.js';
import type {
  MainToWorkerMessage,
  StoredKernel,
  WireFitProblem,
  WorkerToMainMessage,
} from './compute-engine/kernel-protocol.js';
import {
  linearScanSolve,
  scanResultWidth,
  writeScanSolution,
  type FitScanProblem,
  type RecordFn,
} from './compute-engine/fit-scan.js';

export const version = '{{SDK_VERSION}}';

/** A loaded kernel: its slice loop and the values it writes per cell by
 * default (3 for `interval-js`; for `javascript`, the stored
 * `broadcastOutputs`, or 1, which the `outputs` of a `run` message
 * overrides). */
interface Kernel {
  slice: (
    inputs: BroadcastInputs,
    options: BroadcastOptions | undefined,
    out: Float64Array,
    slice: BroadcastSlice
  ) => number;
  interval: boolean;
  perCellOut: number;
  /** The shared inputs that the batch body of the kernel reads in place
   * and only in place (`sharedInputsReadInPlace`): a `Float64Array` is
   * passed as it is, not copied. */
  inPlace: Set<string>;
}

/** The two ends of the message channel, in a browser worker or a Node
 * `worker_threads` worker. */
interface Port {
  post: (message: WorkerToMainMessage, transfer?: ArrayBuffer[]) => void;
  on: (handler: (message: MainToWorkerMessage) => void) => void;
}

async function openPort(): Promise<Port> {
  const g = globalThis as {
    postMessage?: (m: unknown, t?: ArrayBuffer[]) => void;
    addEventListener?: (
      type: string,
      h: (e: { data: unknown }) => void
    ) => void;
  };
  const isNode =
    typeof process !== 'undefined' &&
    typeof (process as { versions?: { node?: string } }).versions?.node ===
      'string';
  // A browser worker: `self.postMessage` and `self.addEventListener`.
  if (!isNode && typeof g.postMessage === 'function' && g.addEventListener) {
    const post = g.postMessage;
    const listen = g.addEventListener;
    return {
      post: (m, t) => post(m, t ?? []),
      on: (h) => listen('message', (e) => h(e.data as MainToWorkerMessage)),
    };
  }
  // Node: the module specifier is kept out of the bundler's reach (a browser
  // build never resolves it) by importing it through a variable.
  const specifier = 'node:worker_threads';
  const { parentPort } = (await import(specifier)) as {
    parentPort: {
      postMessage: (m: unknown, t?: ArrayBuffer[]) => void;
      on: (event: 'message', h: (m: unknown) => void) => void;
    } | null;
  };
  if (!parentPort)
    throw new Error('kernel-worker: not running as a worker thread');
  return {
    post: (m, t) => parentPort.postMessage(m, t ?? []),
    on: (h) => parentPort.on('message', (m) => h(m as MainToWorkerMessage)),
  };
}

const port = await openPort();
const jsRuntime = createJavaScriptRuntime({});
const defaultIterationLimit = jsRuntime.iterationLimit;
const intervalRuntime = createIntervalRuntime();
const kernels = new Map<number, Kernel>();

function loadKernel(kernel: StoredKernel): Kernel {
  if (kernel.kind === 'interval-js')
    return {
      slice: intervalRuntime.loadBroadcastSlice(kernel),
      interval: true,
      perCellOut: 3,
      inPlace: new Set(),
    };
  return {
    // `loadBroadcastSlice` refuses a stored `broadcastOutputs` that is not a
    // positive integer.
    slice: jsRuntime.loadBroadcastSlice({
      ...kernel,
      entryPlan: kernel.entryPlan as Parameters<
        typeof jsRuntime.loadBroadcastSlice
      >[0]['entryPlan'],
    }),
    interval: false,
    perCellOut: kernel.broadcastOutputs ?? 1,
    inPlace: sharedInputsReadInPlace(kernel.batch?.params),
  };
}

/** The shared inputs of each batch this worker was sent, by batch id, until
 * `release`: each as it was sent (`raw`), and its copy into a plain array,
 * made once per batch the first time a kernel that does not read it in
 * place needs it (`plain`). */
const batches = new Map<
  number,
  Map<
    string,
    { raw: Float64Array | readonly number[]; plain?: readonly number[] }
  >
>();

const fits = new Map<number, FitScanProblem>();

/**
 * The fit problem with its functions rebuilt from the stored code. Each
 * function gives a number, or `NaN` for any other value, as the main thread's
 * compiled functions do (`implicitCompileNumeric()` in
 * `implicit-compile.ts`). `load()` refuses a stored result compiled for
 * another runtime version.
 */
function loadFit(problem: WireFitProblem): FitScanProblem {
  const numeric = (kernel: StoredKernel): RecordFn => {
    const f = jsRuntime.load({
      ...kernel,
      entryPlan: kernel.entryPlan as Parameters<
        typeof jsRuntime.load
      >[0]['entryPlan'],
    });
    return (record) => {
      const v = f(record);
      return typeof v === 'number' ? v : NaN;
    };
  };
  return {
    ...problem,
    units: problem.units.map((u) => ({
      ...u,
      model: numeric(u.model),
      columns: u.columns.map(numeric),
    })),
  };
}

/** Thrown by the deadline check of a `fit-run` loop. */
const DEADLINE = new Error('deadline');

/**
 * The cancel check of a task: true once the pool has written the task's job
 * id into the worker's cancel flag (an `Int32Array` over a
 * `SharedArrayBuffer`). The id is compared as a 32-bit integer, as
 * `Atomics.store()` writes it. A flag that names an earlier job does not
 * stop this one. Without a flag (a host with no `SharedArrayBuffer`), the
 * task cannot be cancelled: the pool terminates the worker instead.
 */
function cancelCheck(
  flag: Int32Array | undefined,
  job: number
): (() => boolean) | undefined {
  if (flag === undefined) return undefined;
  const id = job | 0;
  return () => Atomics.load(flag, 0) === id;
}

const messageOf = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

port.on((m) => {
  switch (m.type) {
    case 'load':
      try {
        kernels.set(m.id, loadKernel(m.kernel));
        port.post({ type: 'loaded', id: m.id });
      } catch (e) {
        port.post({ type: 'error', id: m.id, message: messageOf(e) });
      }
      return;
    case 'fit-load':
      try {
        fits.set(m.id, loadFit(m.problem));
        port.post({ type: 'loaded', id: m.id });
      } catch (e) {
        port.post({ type: 'error', id: m.id, message: messageOf(e) });
      }
      return;
    case 'unload':
      kernels.delete(m.id);
      fits.delete(m.id);
      return;
    case 'release':
      batches.delete(m.batch);
      return;
    case 'fit-run': {
      const problem = fits.get(m.id);
      if (problem === undefined) {
        port.post({
          type: 'error',
          job: m.job,
          message: `fit problem ${m.id} is not loaded`,
        });
        return;
      }
      try {
        // The runtime state the compiled code's helpers read, as for `run`.
        jsRuntime.iterationLimit = m.iterationLimit ?? defaultIterationLimit;
        jsRuntime.deadline = m.deadline;
        const p = problem.start.length;
        const stride = scanResultWidth(p);
        const count = m.width > 0 ? m.points.length / m.width : 0;
        const out = new Float64Array(stride * count);
        const deadline = m.deadline;
        const stop = cancelCheck(m.cancel, m.job);
        // The clock and the cancel flag are read before each point and
        // every 256 rows of a pass over the rows, which bounds the overrun
        // to a few rows' work. A cancelled slice ends as at the deadline:
        // with the points done.
        let ticks = 0;
        const check =
          deadline === undefined && stop === undefined
            ? (): void => undefined
            : (): void => {
                if (
                  (++ticks & 0xff) === 0 &&
                  ((deadline !== undefined && Date.now() >= deadline) ||
                    stop?.() === true)
                )
                  throw DEADLINE;
              };
        let done = 0;
        try {
          for (let i = 0; i < count; i++) {
            if (deadline !== undefined && Date.now() >= deadline) break;
            if (stop?.() === true) break;
            const s = linearScanSolve(
              problem,
              m.points.subarray(i * m.width, (i + 1) * m.width),
              m.allRows,
              check
            );
            writeScanSolution(out, i * stride, s, p);
            done = i + 1;
            // The main thread reads no point after a nonlinear one.
            if (s === 'nonlinear') break;
          }
        } catch (e) {
          // The scan's own deadline check, or the deadline check of a loop
          // in a helper of the compiled code (`jsRuntime.deadline`), which
          // throws a timeout `CancellationError`: either way the slice ends
          // here and the points done are sent.
          if (e !== DEADLINE && !isTimeoutCancellation(e)) throw e;
        }
        const sent = done === count ? out : out.slice(0, stride * done);
        port.post({ type: 'fit-result', job: m.job, out: sent, done }, [
          sent.buffer as ArrayBuffer,
        ]);
      } catch (e) {
        port.post({ type: 'error', job: m.job, message: messageOf(e) });
      }
      return;
    }
    case 'run': {
      // The shared inputs are kept first, before the kernel is checked, so
      // that the later tasks of the batch find them even when this one
      // fails. Each is kept as it was sent; the ordinary compiled body reads
      // plain arrays only, so a `Float64Array` is copied into one once per
      // batch, when a kernel that does not read it in place first needs it.
      const wireShared = m.shared;
      if (m.batch !== undefined && wireShared !== undefined) {
        const kept = new Map<
          string,
          { raw: Float64Array | readonly number[]; plain?: readonly number[] }
        >();
        wireShared.names.forEach((name, k) =>
          kept.set(name, { raw: wireShared.values[k] })
        );
        batches.set(m.batch, kept);
      }
      const kernel = kernels.get(m.id);
      if (kernel === undefined) {
        port.post({
          type: 'error',
          job: m.job,
          message: `kernel ${m.id} is not loaded`,
        });
        return;
      }
      const shared = m.batch === undefined ? undefined : batches.get(m.batch);
      if (m.batch !== undefined && shared === undefined) {
        port.post({
          type: 'error',
          job: m.job,
          message: `the shared inputs of batch ${m.batch} are not loaded`,
        });
        return;
      }
      try {
        // The runtime state the compiled code's helpers read, as the engine
        // had it at the call: the iteration limit of the lazy-stream helpers
        // and the batch deadline that their loops check.
        jsRuntime.iterationLimit = m.iterationLimit ?? defaultIterationLimit;
        jsRuntime.deadline = m.deadline;
        const inputs: BroadcastInputs = Object.create(null);
        m.inputs.names.forEach(
          (name, k) => (inputs[name] = m.inputs.values[k])
        );
        if (shared !== undefined)
          for (const [name, entry] of shared)
            inputs[name] = kernel.inPlace.has(name)
              ? entry.raw
              : (entry.plain ??= plainSharedArray(entry.raw));
        const perCellOut = kernel.interval
          ? kernel.perCellOut
          : (m.outputs ?? kernel.perCellOut);
        const options: BroadcastOptions = kernel.interval
          ? { layout: m.layout }
          : {
              layout: m.layout,
              outputs: perCellOut,
              ...(shared !== undefined ? { shared: [...shared.keys()] } : {}),
            };
        const out = new Float64Array(perCellOut * (m.to - m.from));
        // The loop reads `stop` every 64 cells and the clock only every
        // 1024 cells. `stop` reads the clock too: a heavy kernel then stops
        // within 64 cells of the deadline and sends the cells it did, before
        // the pool's grace period after the deadline ends (after which the
        // pool would replace the worker and drop those cells).
        const cancelled = cancelCheck(m.cancel, m.job);
        const deadline = m.deadline;
        const stop =
          deadline === undefined
            ? cancelled
            : () => Date.now() > deadline || cancelled?.() === true;
        const done = kernel.slice(inputs, options, out, {
          from: m.from,
          to: m.to,
          deadline,
          stop,
        });
        // Only the written prefix travels back, and its buffer is
        // transferred, not copied.
        const sent =
          done === m.to - m.from ? out : out.slice(0, perCellOut * done);
        port.post({ type: 'result', job: m.job, out: sent, done }, [
          sent.buffer as ArrayBuffer,
        ]);
      } catch (e) {
        port.post({ type: 'error', job: m.job, message: messageOf(e) });
      }
      return;
    }
  }
});

port.post({
  type: 'ready',
  runtimeVersion: RUNTIME_VERSION,
  intervalRuntimeVersion: INTERVAL_RUNTIME_VERSION,
});
