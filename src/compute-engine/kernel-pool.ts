/**
 * The kernel pool: worker threads that evaluate compiled functions over
 * batches of cells, and the `broadcastAsync()` driver that splits a batch
 * over them (design: `docs/plans/2026-10-20-worker-kernel-pool.md`, sections
 * 5.1 and 5.4).
 *
 * The engine creates no worker on its own. The host builds a pool with
 * `createKernelPool({ create, size, prewarm })`, where `create` returns a
 * browser `Worker` or a Node `worker_threads` `Worker` running the
 * `@cortex-js/compute-engine/kernel-worker` file, and gives the pool to one or
 * more engines (`new ComputeEngine({ workers: pool })`, or `ce.workers = pool`
 * later). The pool creates its workers on the first batch that needs one, or
 * on idle time right away when `prewarm` is set, and keeps them until
 * `dispose()`; a batch after `dispose()` creates them again.
 *
 * What a worker receives is text and numbers: the stored form of a
 * compilation result, which it rebuilds once and keeps under an id, and for
 * each task a slice of the batch's input arrays. What it returns is one
 * `Float64Array` per task. Both the main thread and the worker run the same
 * loop (`compilation/broadcast.ts`), so a cell computed on a worker holds the
 * value the main thread would have computed. A result whose code depends on
 * the main thread (a random draw, which follows the engine's random stream
 * and entropy handler; a function or variable given by the name of a host
 * global; a caller preamble) is not shippable and always runs inline: the
 * compile target says so (`CompileTarget.hostNames`, and the randomness
 * helpers the code names).
 *
 * `broadcastAsync()` runs a batch inline, in slices between yields to the
 * event loop, when there is no pool, when the result is not shippable, or
 * when the batch is too small to pay for the transfer; otherwise it splits the
 * cells into one slice per worker (or `chunk` cells per slice), sends each
 * worker one slice at a time, and commits the returned slices in order. The
 * result reports `done`, the number of leading cells that are valid: all of
 * them, or fewer when the `deadline` or the `signal` stopped the batch. The
 * cells after `done` are never written.
 *
 * The same queue carries the slices of grid points of a `FindFit` separable
 * scan (`runFitSlice`, used by `PoolFitExecutor` in `fit-executor.ts`): the
 * worker is sent the fit problem once (`fit-load`), then each slice
 * (`fit-run`). These methods are not part of the public `KernelPool`
 * interface; `fitSlicePool()` reaches them.
 */

import type {
  BroadcastInputs,
  BroadcastOptions,
  BroadcastAsyncOptions,
  BroadcastAsyncResult,
} from './compilation/types.js';
import {
  broadcastCellCount,
  type BroadcastSlice,
} from './compilation/broadcast.js';
import { RUNTIME_VERSION } from './compilation/javascript-runtime.js';
import { INTERVAL_RUNTIME_VERSION } from './interval/index.js';
import type {
  KernelKind,
  MainToWorkerMessage,
  StoredKernel,
  WireFitProblem,
  WireInputs,
  WorkerToMainMessage,
} from './kernel-protocol.js';
import type { FitScanRows } from './fit-scan.js';
import type { FitSlicePool } from './fit-executor.js';
import type {
  KernelPool,
  KernelPoolOptions,
  WorkerLike,
} from './kernel-pool-types.js';

export type { KernelPool, KernelPoolOptions, WorkerLike };

/** The default pool size: one core kept for the main thread, at most 8
 * (the measured gain flattens there), at least 1. */
export function defaultPoolSize(): number {
  // Read through `globalThis`: `navigator` is a browser global, which the
  // lint rule `no-restricted-globals` bans as a bare name. Node 21 and later
  // also define it.
  const cores = (
    globalThis as { navigator?: { hardwareConcurrency?: unknown } }
  ).navigator?.hardwareConcurrency;
  const n = typeof cores === 'number' ? cores : 4;
  return Math.max(1, Math.min(8, n - 1));
}

/**
 * A compilation result as the pool reads it: the stored form a worker
 * rebuilds (`StoredKernel` without its `kind`, which the target names), and
 * an object identity the pool keys its kernel ids and calibration on.
 */
export type StoredResult = Omit<StoredKernel, 'kind'> & object;

/** The per-slice result a worker hands back. */
interface SliceResult {
  out: Float64Array;
  done: number;
}

/** A task queued for a worker: one slice of one batch. */
interface Task {
  type: 'cells';
  kind: KernelKind;
  stored: StoredResult;
  inputs: BroadcastInputs;
  options: BroadcastOptions | undefined;
  slice: BroadcastSlice;
  iterationLimit: number | undefined;
  signal: AbortSignal | undefined;
  resolve: (r: SliceResult) => void;
  reject: (e: Error) => void;
}

/** A task queued for a worker: one slice of the grid points of a `FindFit`
 * separable scan (`runFitSlice`). */
interface FitSliceTask {
  type: 'fit';
  problem: WireFitProblem;
  /** Owned by the task: its buffer is transferred to the worker. */
  points: Float64Array;
  allRows: boolean;
  deadline: number | undefined;
  iterationLimit: number | undefined;
  signal: AbortSignal | undefined;
  resolve: (r: SliceResult) => void;
  reject: (e: Error) => void;
}

type QueuedTask = Task | FitSliceTask;

interface Slot {
  worker: WorkerLike;
  ready: Promise<void>;
  /** Settles `ready` with an error: a worker that failed to start, a version
   * mismatch, or `dispose()` while starting. */
  failReady: (e: Error) => void;
  /** Kernels and fit problems the worker was sent (`load`, `fit-load`), by
   * id. */
  loaded: Set<number>;
  /** Kernels and fit problems whose load the worker refused: their tasks are
   * rejected here. */
  refused: Map<number, string>;
  /** The tasks waiting for this worker, in order. */
  queue: QueuedTask[];
  /** The task the worker runs now, by job id, or none. `settled` is set when
   * the signal aborted the task while it ran: its caller has its answer, and
   * the job stays here until the worker replies, since the worker is busy
   * until then. */
  running: { job: number; task: QueuedTask; settled?: boolean } | undefined;
  /** Set when the worker is gone (failed, exited, disposed). */
  dead: boolean;
}

/**
 * The brand of a pool this module built. A property with a registered
 * symbol, not `instanceof`: the `compile` entry and the main entry are
 * separate bundles, each with its own copy of the class, and a pool built by
 * one must work with results compiled by the other.
 */
const POOL_BRAND = Symbol.for('@cortex-js/compute-engine/kernel-pool');

/**
 * The helpers of the compiled-code runtime that read the engine's random
 * stream or entropy handler: the `_SYS` members that `makeRandomHelpers`
 * (`compilation/javascript-runtime.ts`) builds over the live source, the two
 * integrals that sample live, and the interval library's seeded choice. Code
 * that names one of them is not shippable: a worker has its own stream, so
 * its draws would not be the engine's.
 */
const RANDOM_HELPERS =
  /\b_SYS\.(drawNextRandomNumber|withRandomSeed|domainInterval|domainRange|domainList|randomPick|randomChoice|randomSample|shuffle|integrate|integrateMC)\b|\b_IA\.seededChoice\b/;

/** Whether the text of a compiled result can run on a worker. */
export function isShippableCode(text: string): boolean {
  return !RANDOM_HELPERS.test(text);
}

class KernelPoolImpl implements KernelPool, FitSlicePool {
  readonly [POOL_BRAND] = true;
  readonly size: number;
  private slots: (Slot | undefined)[];
  private nextJob = 1;
  private nextKernelId = 1;
  private kernelIds = new WeakMap<object, number>();
  /** Bumped by `dispose()`: a prewarm scheduled before it does nothing. */
  private generation = 0;
  /** Set when a worker reported runtime versions other than this engine's:
   * the pool then takes no task, and every batch runs inline. */
  unusable: string | undefined = undefined;
  /** Tells every worker that loaded a kernel to forget it once its
   * compilation result has been collected. */
  private readonly finalization =
    typeof FinalizationRegistry === 'function'
      ? new FinalizationRegistry<number>((id) => this.unloadEverywhere(id))
      : undefined;

  constructor(private readonly options: KernelPoolOptions) {
    this.size = Math.max(1, Math.floor(options.size ?? defaultPoolSize()));
    this.slots = new Array(this.size).fill(undefined);
    if (options.prewarm) {
      const generation = this.generation;
      const run = (): void => {
        if (generation !== this.generation) return;
        this.prewarm().catch(() => undefined);
      };
      const idle = (
        globalThis as {
          requestIdleCallback?: (cb: () => void) => unknown;
        }
      ).requestIdleCallback;
      if (typeof idle === 'function') idle(run);
      else setTimeout(run, 0);
    }
  }

  async prewarm(): Promise<void> {
    if (this.unusable !== undefined) return;
    await Promise.allSettled(
      Array.from({ length: this.size }, (_, k) => this.slot(k).ready)
    );
  }

  dispose(): void {
    this.generation++;
    for (const slot of this.slots)
      if (slot) this.fail(slot, new Error('The kernel pool was disposed'));
    this.slots.fill(undefined);
  }

  /** The kernel id of a stored result or a fit problem, assigned on first
   * use. */
  private kernelId(stored: object): number {
    let id = this.kernelIds.get(stored);
    if (id === undefined) {
      id = this.nextKernelId++;
      this.kernelIds.set(stored, id);
      this.finalization?.register(stored, id);
    }
    return id;
  }

  private unloadEverywhere(id: number): void {
    for (const slot of this.slots) {
      if (!slot || slot.dead || !slot.loaded.has(id)) continue;
      slot.loaded.delete(id);
      slot.worker.postMessage({
        type: 'unload',
        id,
      } satisfies MainToWorkerMessage);
    }
  }

  /** Take a slot down: settle its start-up, its running task and its queue
   * with `error`, terminate the worker, and free the slot for a new worker. */
  private fail(slot: Slot, error: Error): void {
    if (slot.dead) return;
    slot.dead = true;
    slot.failReady(error);
    if (slot.running) {
      slot.running.task.reject(error);
      slot.running = undefined;
    }
    for (const task of slot.queue) task.reject(error);
    slot.queue.length = 0;
    try {
      slot.worker.terminate();
    } catch {
      // A worker that is already gone.
    }
    const k = this.slots.indexOf(slot);
    if (k >= 0) this.slots[k] = undefined;
  }

  /** The slot `k`, its worker created on first use. */
  private slot(k: number): Slot {
    const existing = this.slots[k];
    if (existing) return existing;
    const worker = this.options.create();
    let failReady: (e: Error) => void = () => undefined;
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      failReady = reject;
    });
    // A worker that never becomes ready must not leave an unhandled
    // rejection behind: the task that awaits `ready` sees the error.
    ready.catch(() => undefined);
    const slot: Slot = {
      worker,
      ready,
      failReady,
      loaded: new Set(),
      refused: new Map(),
      queue: [],
      running: undefined,
      dead: false,
    };
    const onMessage = (data: unknown): void => {
      const m = data as WorkerToMainMessage;
      switch (m.type) {
        case 'ready': {
          if (
            m.runtimeVersion !== RUNTIME_VERSION ||
            m.intervalRuntimeVersion !== INTERVAL_RUNTIME_VERSION
          ) {
            const message = `The kernel worker holds runtime ${m.runtimeVersion} and interval runtime ${m.intervalRuntimeVersion}; this engine is ${RUNTIME_VERSION} and ${INTERVAL_RUNTIME_VERSION}`;
            this.unusable = message;
            this.fail(slot, new Error(message));
            return;
          }
          resolveReady();
          return;
        }
        case 'result':
        case 'fit-result': {
          const running = slot.running;
          if (!running || running.job !== m.job) return;
          slot.running = undefined;
          // A late result of a task the main thread settled on abort is
          // dropped; the worker is free again either way.
          if (!running.settled)
            running.task.resolve({ out: m.out, done: m.done });
          void this.pump(slot);
          return;
        }
        case 'error': {
          if (m.job === undefined && m.id !== undefined) {
            slot.refused.set(m.id, m.message);
            return;
          }
          const running = slot.running;
          if (!running || running.job !== m.job) return;
          slot.running = undefined;
          if (!running.settled) running.task.reject(new Error(m.message));
          void this.pump(slot);
          return;
        }
        default:
          return;
      }
    };
    const onError = (e: unknown): void => {
      const message =
        typeof e === 'object' && e !== null && 'message' in e
          ? String((e as { message: unknown }).message)
          : String(e);
      this.fail(slot, new Error(`kernel worker failed: ${message}`));
    };
    if (typeof worker.on === 'function') {
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', (code) => {
        if (!slot.dead)
          this.fail(
            slot,
            new Error(`kernel worker exited (code ${String(code)})`)
          );
      });
    } else if (typeof worker.addEventListener === 'function') {
      worker.addEventListener('message', (ev) =>
        onMessage((ev as { data: unknown }).data)
      );
      worker.addEventListener('error', onError);
    } else {
      throw new TypeError(
        'createKernelPool: the worker has neither on() nor addEventListener()'
      );
    }
    this.slots[k] = slot;
    return slot;
  }

  /** The slot with the shortest queue. */
  private pickSlot(): Slot {
    let best: Slot | undefined;
    for (let k = 0; k < this.size; k++) {
      const s = this.slot(k);
      const load = s.queue.length + (s.running ? 1 : 0);
      if (
        best === undefined ||
        load < best.queue.length + (best.running ? 1 : 0)
      )
        best = s;
    }
    return best as Slot;
  }

  /**
   * Evaluate the cells of `slice` on a worker. Resolves to the slice's output
   * and the count of cells written (`done: 0` when the signal aborted before
   * the task ran). Rejects when the pool is unusable, the worker refused the
   * kernel or failed; the caller then finishes inline.
   */
  runSlice(
    kind: KernelKind,
    stored: StoredResult,
    inputs: BroadcastInputs,
    options: BroadcastOptions | undefined,
    slice: BroadcastSlice,
    iterationLimit: number | undefined,
    signal: AbortSignal | undefined
  ): Promise<SliceResult> {
    if (this.unusable !== undefined)
      return Promise.reject(new Error(this.unusable));
    const slot = this.pickSlotOrReject();
    if (slot instanceof Promise) return slot;
    return new Promise<SliceResult>((resolve, reject) =>
      this.enqueue(slot, {
        type: 'cells',
        kind,
        stored,
        inputs,
        options,
        slice,
        iterationLimit,
        signal,
        resolve,
        reject,
      })
    );
  }

  /**
   * Solve a slice of the grid points of a `FindFit` separable scan on a
   * worker (`FitSlicePool.runFitSlice` in `fit-executor.ts`). The worker is
   * sent the problem once (`fit-load`), then the points (`fit-run`); the
   * buffer of `points` is transferred. Resolves to the encoded solutions and
   * the count of points solved (`done: 0` when the signal aborted before
   * the task ran). Rejects when the pool is unusable, the worker refused the
   * problem or failed; the caller then solves the points inline.
   */
  runFitSlice(
    problem: WireFitProblem,
    points: Float64Array,
    allRows: boolean,
    deadline: number | undefined,
    iterationLimit: number | undefined,
    signal: AbortSignal | undefined
  ): Promise<SliceResult> {
    if (this.unusable !== undefined)
      return Promise.reject(new Error(this.unusable));
    const slot = this.pickSlotOrReject();
    if (slot instanceof Promise) return slot;
    return new Promise<SliceResult>((resolve, reject) =>
      this.enqueue(slot, {
        type: 'fit',
        problem,
        points,
        allRows,
        deadline,
        iterationLimit,
        signal,
        resolve,
        reject,
      })
    );
  }

  /** The slot `pickSlot()` gives, or a rejected promise when it throws (the
   * host's worker factory failed, for example because the page may not
   * create workers): the caller then finishes inline. */
  private pickSlotOrReject(): Slot | Promise<never> {
    try {
      return this.pickSlot();
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /** Tell every worker that loaded the fit problem to forget it: the fit
   * is over. A later slice of the same problem loads it again. */
  releaseFit(problem: WireFitProblem): void {
    const id = this.kernelIds.get(problem);
    if (id === undefined) return;
    this.unloadEverywhere(id);
    for (const slot of this.slots) slot?.refused.delete(id);
  }

  /** Queue `task` on `slot` and send it when the worker is free. */
  private enqueue(slot: Slot, task: QueuedTask): void {
    slot.queue.push(task);
    // An abort settles the task here, whether it waits in the queue or
    // runs on the worker. A queued task leaves the queue. A running task
    // stays the slot's running job until the worker replies (the worker is
    // busy until then), and its late reply is dropped; the reply then sends
    // the next task of the queue.
    const signal = task.signal;
    if (signal !== undefined) {
      const onAbort = (): void => {
        const q = slot.queue.indexOf(task);
        if (q >= 0) slot.queue.splice(q, 1);
        else if (slot.running?.task === task) slot.running.settled = true;
        task.resolve({ out: new Float64Array(0), done: 0 });
        // The aborted task may be the one a pending `pump()` waits to send:
        // that call then stops, and this one sends the next task.
        void this.pump(slot);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      // The listener holds the task, and a fit task holds every row of the
      // problem: remove it when the task settles, so that a long-lived
      // signal shared by many evaluations does not keep their data alive.
      const { resolve, reject } = task;
      task.resolve = (r) => {
        signal.removeEventListener('abort', onAbort);
        resolve(r);
      };
      task.reject = (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      };
    }
    void this.pump(slot);
  }

  /** Send a fit task to the slot's worker, the problem first if the worker
   * does not hold it. */
  private sendFit(slot: Slot, task: FitSliceTask): void {
    const id = this.kernelId(task.problem);
    const refusal = slot.refused.get(id);
    if (refusal !== undefined) {
      task.reject(new Error(refusal));
      void this.pump(slot);
      return;
    }
    if (!slot.loaded.has(id)) {
      slot.loaded.add(id);
      // Each worker gets its own copy of the rows, transferred: several
      // workers load the same problem.
      const transfer: ArrayBuffer[] = [];
      const copyRows = (rows: FitScanRows): FitScanRows => {
        const x = rows.x.map((a) => a.slice());
        const y = rows.y.slice();
        for (const a of x) transfer.push(a.buffer as ArrayBuffer);
        transfer.push(y.buffer as ArrayBuffer);
        return { x, y };
      };
      const problem: WireFitProblem = {
        ...task.problem,
        units: task.problem.units.map((u) => ({
          ...u,
          rows: copyRows(u.rows),
          ...(u.sample ? { sample: copyRows(u.sample) } : {}),
        })),
      };
      slot.worker.postMessage(
        { type: 'fit-load', id, problem } satisfies MainToWorkerMessage,
        transfer
      );
    }
    const job = this.nextJob++;
    slot.running = { job, task };
    slot.worker.postMessage(
      {
        type: 'fit-run',
        job,
        id,
        points: task.points,
        width: task.problem.gridIdx.length,
        allRows: task.allRows,
        deadline: task.deadline,
        iterationLimit: task.iterationLimit,
      } satisfies MainToWorkerMessage,
      [task.points.buffer as ArrayBuffer]
    );
  }

  /** Send the slot's next queued task once the worker is ready and idle. */
  private async pump(slot: Slot): Promise<void> {
    if (slot.running || slot.queue.length === 0 || slot.dead) return;
    const task = slot.queue[0];
    try {
      await slot.ready;
    } catch {
      // The slot failed while this task waited: `fail()` rejected it.
      return;
    }
    if (slot.dead || slot.running || slot.queue[0] !== task) return;
    slot.queue.shift();
    if (task.signal?.aborted) {
      task.resolve({ out: new Float64Array(0), done: 0 });
      void this.pump(slot);
      return;
    }
    if (task.type === 'fit') {
      this.sendFit(slot, task);
      return;
    }
    const id = this.kernelId(task.stored);
    const refusal = slot.refused.get(id);
    if (refusal !== undefined) {
      task.reject(new Error(refusal));
      void this.pump(slot);
      return;
    }
    if (!slot.loaded.has(id)) {
      slot.loaded.add(id);
      const kernel: StoredKernel = {
        kind: task.kind,
        runtimeVersion: task.stored.runtimeVersion,
        code: task.stored.code,
        calling: task.stored.calling,
        preamble: task.stored.preamble,
        preambleOnce: task.stored.preambleOnce,
        preamblePerCall: task.stored.preamblePerCall,
        entryPlan: task.stored.entryPlan,
        reconstructionDigits: task.stored.reconstructionDigits,
      };
      slot.worker.postMessage({
        type: 'load',
        id,
        kernel,
      } satisfies MainToWorkerMessage);
    }
    const job = this.nextJob++;
    const layout = task.options?.layout ?? 'cells';
    const perCell = task.kind === 'interval-js' ? 2 : 1;
    // The arrays travel as copies that are then transferred: for the
    // `cells` layout only the slice's own cells, which the worker reads as
    // its cells `[0, n)`; for the `grid` layout the whole axes, which are
    // small, and the slice's range.
    const wire: WireInputs = { names: [], values: [] };
    const transfer: ArrayBuffer[] = [];
    const { from, to } = task.slice;
    for (const name of Object.keys(task.inputs)) {
      const v = task.inputs[name];
      wire.names.push(name);
      if (typeof v === 'number') {
        wire.values.push(v);
        continue;
      }
      const copy =
        layout === 'cells' ? v.slice(perCell * from, perCell * to) : v.slice();
      wire.values.push(copy);
      transfer.push(copy.buffer as ArrayBuffer);
    }
    slot.running = { job, task };
    slot.worker.postMessage(
      {
        type: 'run',
        job,
        id,
        inputs: wire,
        layout,
        from: layout === 'cells' ? 0 : from,
        to: layout === 'cells' ? to - from : to,
        deadline: task.slice.deadline,
        iterationLimit: task.iterationLimit,
      } satisfies MainToWorkerMessage,
      transfer
    );
  }
}

/** Whether `pool` is a pool this module (in any bundle) built. */
function isKernelPool(pool: unknown): pool is KernelPoolImpl {
  return (
    typeof pool === 'object' &&
    pool !== null &&
    (pool as { [POOL_BRAND]?: unknown })[POOL_BRAND] === true
  );
}

/**
 * The pool `pool` as the `FindFit` scan uses it (`PoolFitExecutor` in
 * `fit-executor.ts`), or `undefined` when it is not a pool this module built
 * or it is unusable (its workers hold another runtime version). The fit
 * methods are not part of the public `KernelPool` interface.
 */
export function fitSlicePool(
  pool: unknown
): (FitSlicePool & { releaseFit(problem: WireFitProblem): void }) | undefined {
  return isKernelPool(pool) && pool.unusable === undefined ? pool : undefined;
}

export function createKernelPool(options: KernelPoolOptions): KernelPool {
  if (typeof options?.create !== 'function')
    throw new TypeError('createKernelPool: `create` must be a function');
  return new KernelPoolImpl(options);
}

//
// `broadcastAsync()`
//

/** Cells per inline slice between two yields to the event loop. */
const INLINE_SLICE = 16_384;

/**
 * Before any measurement, a batch under this many cells runs inline: about
 * 10 ms of serial work for a medium expression (measured 2026-10-20,
 * `benchmarks/workers/interval-parallel.mts`).
 */
const DEFAULT_THRESHOLD_CELLS = 20_000;

/** The serial work, in milliseconds, under which a batch stays inline. */
const INLINE_BUDGET_MS = 10;

/** Cells per millisecond measured for a kernel on the main thread, from the
 * slices of its inline batches (the yields between slices are not counted). */
const calibration = new WeakMap<object, number>();

function thresholdCells(stored: object): number {
  const cellsPerMs = calibration.get(stored);
  if (cellsPerMs === undefined) return DEFAULT_THRESHOLD_CELLS;
  return Math.max(1024, Math.round(cellsPerMs * INLINE_BUDGET_MS));
}

function recordCalibration(stored: object, cells: number, ms: number): void {
  // A measurement under 2 ms is mostly timer noise.
  if (ms < 2 || cells < 256) return;
  calibration.set(stored, cells / ms);
}

/**
 * Yield to the event loop between two inline slices: a macrotask, so that
 * rendering and input get their turn, through the fastest channel there is.
 * Nested `setTimeout(0)` calls are delayed to 4 ms by browsers; a
 * `MessageChannel` is not.
 */
const yieldToEventLoop: () => Promise<void> = (() => {
  const g = globalThis as {
    setImmediate?: (cb: () => void) => unknown;
    MessageChannel?: new () => {
      port1: { onmessage: ((e: unknown) => void) | null };
      port2: { postMessage: (m: unknown) => void };
    };
  };
  if (typeof g.setImmediate === 'function') {
    const setImmediate = g.setImmediate;
    return () => new Promise((resolve) => setImmediate(resolve));
  }
  if (typeof g.MessageChannel === 'function') {
    const channel = new g.MessageChannel();
    const waiting: (() => void)[] = [];
    channel.port1.onmessage = () => waiting.shift()?.();
    return () =>
      new Promise((resolve) => {
        waiting.push(resolve);
        channel.port2.postMessage(undefined);
      });
  }
  return () => new Promise((resolve) => setTimeout(resolve, 0));
})();

/** What a compile target gives `makeBroadcastAsync` for one result. */
export interface BroadcastAsyncSpec {
  kind: KernelKind;
  /** The compilation result itself: the stored form a worker rebuilds, and
   * the identity the pool keys its kernel ids and calibration on. */
  stored: StoredResult;
  /** Whether the result can run on a worker at all (see the module
   * comment); a result that cannot always runs inline. */
  shippable: boolean;
  /** Evaluate the cells of `slice` on the calling thread, writing them at the
   * start of `out`; returns the count written (the `*Slice` functions of
   * `compilation/broadcast.ts` over the result's raw call). */
  slice: (
    inputs: BroadcastInputs,
    options: BroadcastOptions | undefined,
    out: Float64Array,
    slice: BroadcastSlice
  ) => number;
  /** The pool at call time, or none. */
  workers: () => KernelPool | undefined;
  /** The engine's iteration limit at call time, shipped to the worker. */
  iterationLimit: () => number | undefined;
}

/** A positive integer option, or a `TypeError` naming it. */
function positiveInteger(
  value: number | undefined,
  name: string
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1)
    throw new TypeError(
      `broadcastAsync: \`${name}\` must be a positive integer (got ${String(value)})`
    );
  return value;
}

/**
 * Build the `broadcastAsync` entry of a compilation result.
 */
export function makeBroadcastAsync(
  spec: BroadcastAsyncSpec
): (
  inputs: BroadcastInputs,
  options?: BroadcastAsyncOptions
) => Promise<BroadcastAsyncResult> {
  const perCellIn = spec.kind === 'interval-js' ? 2 : 1;
  const perCellOut = spec.kind === 'interval-js' ? 3 : 1;
  return async (inputs, options) => {
    const count = broadcastCellCount(inputs, options, perCellIn);
    const needed = perCellOut * count;
    const out = options?.out ?? new Float64Array(needed);
    if (out.length < needed)
      throw new TypeError(
        `broadcast: the output array holds ${out.length} values, ${needed} are needed`
      );
    const chunkOption = positiveInteger(options?.chunk, 'chunk');
    if (
      options?.deadline !== undefined &&
      !(
        typeof options.deadline === 'number' &&
        Number.isFinite(options.deadline)
      )
    )
      throw new TypeError('broadcastAsync: `deadline` must be a finite number');
    const signal = options?.signal;
    const deadline =
      options?.deadline !== undefined
        ? Date.now() + options.deadline
        : undefined;
    const layoutOptions: BroadcastOptions | undefined =
      options?.layout !== undefined ? { layout: options.layout } : undefined;
    const pastDeadline = (): boolean =>
      deadline !== undefined && Date.now() > deadline;

    /** Run the cells from `start` inline, in slices with a yield between
     * two; returns the count of leading valid cells from `start`. */
    const inline = async (start: number): Promise<number> => {
      const chunk = chunkOption ?? INLINE_SLICE;
      let done = start;
      let sliceMs = 0;
      let first = true;
      while (done < count) {
        // Checked before and after the yield: the abort usually arrives
        // while the batch waits for the event loop.
        if (signal?.aborted || pastDeadline()) break;
        if (!first) await yieldToEventLoop();
        if (signal?.aborted || pastDeadline()) break;
        first = false;
        const from = done;
        const to = Math.min(count, from + chunk);
        const t0 = Date.now();
        const n = spec.slice(
          inputs,
          layoutOptions,
          out.subarray(perCellOut * from, perCellOut * to),
          { from, to, deadline }
        );
        sliceMs += Date.now() - t0;
        done += n;
        // Fewer cells than the slice holds: the deadline stopped the loop.
        if (n < to - from) break;
      }
      recordCalibration(spec.stored, done - start, sliceMs);
      return done - start;
    };

    const pool = spec.workers();
    if (
      !spec.shippable ||
      !isKernelPool(pool) ||
      pool.unusable !== undefined ||
      count < thresholdCells(spec.stored)
    )
      return { out, done: await inline(0) };

    // One slice per worker, or `chunk` cells per slice, in order. Each
    // worker takes one slice at a time; the rest wait on the main thread.
    const chunk = Math.max(1024, chunkOption ?? Math.ceil(count / pool.size));
    const slices: BroadcastSlice[] = [];
    for (let from = 0; from < count; from += chunk)
      slices.push({ from, to: Math.min(count, from + chunk), deadline });
    const iterationLimit = spec.iterationLimit();
    // The slices' results are kept aside and committed in order, so that no
    // cell after `done` is written when an earlier slice stopped short.
    const results = await Promise.allSettled(
      slices.map((slice) =>
        pool.runSlice(
          spec.kind,
          spec.stored,
          inputs,
          layoutOptions,
          slice,
          iterationLimit,
          signal
        )
      )
    );
    let done = 0;
    let failed = false;
    for (let s = 0; s < slices.length; s++) {
      const r = results[s];
      const slice = slices[s];
      if (r.status === 'rejected') {
        failed = true;
        break;
      }
      out.set(
        r.value.out.subarray(0, perCellOut * r.value.done),
        perCellOut * slice.from
      );
      done += r.value.done;
      if (r.value.done < slice.to - slice.from) break;
    }
    // A worker could not take a slice (a refused kernel, a failed worker):
    // the rest of the batch runs inline, with its yields, from the end of
    // the valid prefix.
    if (failed && done < count && !signal?.aborted && !pastDeadline())
      done += await inline(done);
    return { out, done };
  };
}
