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
 * each task a slice of the batch's input arrays. The shared inputs of a
 * `javascript` batch (arrays the compiled code reads by index, bound once for
 * the batch) go to each worker once per `broadcastAsync()` call, with the
 * first task of the call that the worker receives; the worker keeps them
 * under the call's batch id until the call ends (`release`). What it returns
 * is one `Float64Array` per task. Both the main thread and the worker run the same
 * loop (`compilation/broadcast.ts`), so a cell computed on a worker holds the
 * value the main thread would have computed. A result whose code depends on
 * the main thread (a random draw, which follows the engine's random stream
 * and entropy handler; a function or variable given by the name of a host
 * global; a caller preamble) is not shippable and always runs inline: the
 * compile target says so (`CompileTarget.hostNames`, and the randomness
 * helpers the code names).
 *
 * `broadcastAsync()` runs a batch inline, in slices between yields to the
 * event loop (the first yield comes before the first slice, so that no cell
 * runs before the call returns), when there is no pool, when the result is
 * not shippable, or when the batch is too small to pay for the transfer;
 * otherwise it splits the cells into one slice per worker (or `chunk` cells
 * per slice), sends each worker one slice at a time, and commits the returned
 * slices in order. The option `inline: false` refuses the inline route: the
 * batch then resolves at once with no cell done. The result reports `done`,
 * the number of leading cells that are valid: all of them, or fewer when the
 * `deadline` or the `signal` stopped the batch. The cells after `done` are
 * never written. It also reports `route` (`'pool'` or `'calling-thread'`)
 * and, when the pool did not take the whole batch, `reason`
 * (`offPoolReason()`, or `'pool-declined'` when a worker failed).
 *
 * An abort of the signal settles the batch's tasks at once. A task that a
 * worker runs at that time is cancelled through the worker's cancel flag
 * (shared memory, when the host has `SharedArrayBuffer`), which the worker
 * reads every 64 cells or at each grid point. A worker that has not answered
 * within the grace period after an abort, or after the deadline of its task,
 * is terminated and replaced (`cancelGrace`, default 250 ms); the tasks that
 * waited for it go to the new worker.
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
  BroadcastAsyncReason,
  BroadcastAsyncResult,
} from './compilation/types.js';
import {
  broadcastCellCount,
  broadcastSharedNames,
  broadcastStride,
  plainSharedArray,
  sharedInputsReadInPlace,
  type BroadcastSlice,
} from './compilation/broadcast.js';
import { RUNTIME_VERSION } from './compilation/javascript-runtime.js';
// The inline slices yield a macrotask between them (and before the first), so
// that rendering and input get their turn.
import { yieldToEventLoop } from '../common/cooperative-steps.js';
import { INTERVAL_RUNTIME_VERSION } from './interval/index.js';
import type {
  KernelKind,
  MainToWorkerMessage,
  StoredKernel,
  WireFitProblem,
  WireInputs,
  WireShared,
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
  /** The batch of the task when it has shared inputs: its id (one per
   * `broadcastAsync()` call) and the names of the shared inputs, which are
   * keys of `inputs`. */
  batch: SharedBatch | undefined;
  resolve: (r: SliceResult) => void;
  reject: (e: Error) => void;
}

/** The shared inputs of one `broadcastAsync()` call, as the pool ships them. */
export interface SharedBatch {
  id: number;
  names: readonly string[];
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
  /** The batches whose shared inputs the worker was sent and keeps, by
   * batch id, until `releaseBatch()`. */
  batches: Set<number>;
  /** Kernels and fit problems whose load the worker refused: their tasks are
   * rejected here. */
  refused: Map<number, string>;
  /** The tasks waiting for this worker, in order. */
  queue: QueuedTask[];
  /** The task the worker runs now, by job id, or none. `settled` is set when
   * the signal aborted the task while it ran: its caller has its answer, and
   * the job stays here until the worker replies, since the worker is busy
   * until then. `timer` is the watchdog of the task, set to fire at the
   * `Date.now()` time `at`: the grace period after an abort, or after the
   * task's deadline. When it fires and the worker still runs the task, the
   * pool terminates and replaces the worker (`replace()`). */
  running:
    | {
        job: number;
        task: QueuedTask;
        settled?: boolean;
        timer?: ReturnType<typeof setTimeout>;
        at?: number;
      }
    | undefined;
  /** The cancel flag of the worker, an `Int32Array` of one element over a
   * `SharedArrayBuffer`, or none when the host has no `SharedArrayBuffer`.
   * Each task carries it; the pool cancels a running task by writing its
   * job id into it, which the worker reads between cells or points. */
  cancel: Int32Array | undefined;
  /** Set when the worker is gone (failed, exited, disposed). */
  dead: boolean;
}

/** The default `cancelGrace` of a pool, in milliseconds: a few times the
 * start-up of a worker (about 40 ms, measured 2026-10-20), so that a worker
 * that stops at its next check of the cancel flag is never replaced, and
 * one that does not check it is free again within a quarter of a second. */
const DEFAULT_CANCEL_GRACE = 250;

/** The longest delay `setTimeout()` takes: a longer one fires at once. */
const MAX_TIMER_DELAY = 0x7fffffff;

/** Whether the deadline of `task` has passed, with the comparison the
 * worker makes before its first cell or point: the cell loop stops when
 * `Date.now()` is after the deadline, the fit loop when it reaches it. */
function deadlinePassed(task: QueuedTask): boolean {
  const deadline = task.type === 'fit' ? task.deadline : task.slice.deadline;
  if (deadline === undefined) return false;
  return task.type === 'fit' ? Date.now() >= deadline : Date.now() > deadline;
}

/**
 * A new cancel flag for a worker, or `undefined` when the host has no
 * `SharedArrayBuffer`. A browser page that is not cross-origin isolated has
 * none (or, in older browsers, has one that `postMessage()` refuses to
 * send): its workers are not cancelled, only terminated after the grace
 * period.
 */
function newCancelFlag(): Int32Array | undefined {
  const g = globalThis as { crossOriginIsolated?: boolean };
  if (
    typeof SharedArrayBuffer !== 'function' ||
    g.crossOriginIsolated === false
  )
    return undefined;
  return new Int32Array(new SharedArrayBuffer(4));
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
  private nextBatchId = 1;
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

  /** The `cancelGrace` option, in milliseconds. */
  private readonly grace: number;

  constructor(private readonly options: KernelPoolOptions) {
    this.size = Math.max(1, Math.floor(options.size ?? defaultPoolSize()));
    const grace = options.cancelGrace ?? DEFAULT_CANCEL_GRACE;
    // A finite grace period longer than `setTimeout()` takes would never
    // arm the watchdog: it is refused rather than read as `Infinity`.
    if (
      typeof grace !== 'number' ||
      !(grace >= 0) ||
      (Number.isFinite(grace) && grace > MAX_TIMER_DELAY)
    )
      throw new TypeError(
        'createKernelPool: `cancelGrace` must be a number of milliseconds from 0 to 2147483647, or Infinity'
      );
    this.grace = grace;
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
      this.endRunning(slot);
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

  /** The slot is no longer running a task: stop the task's watchdog. */
  private endRunning(slot: Slot): void {
    const timer = slot.running?.timer;
    if (timer !== undefined) clearTimeout(timer);
    slot.running = undefined;
  }

  /**
   * Arm the watchdog of the slot's running task to fire at the `Date.now()`
   * time `at`, unless it is already armed to fire earlier. A time too far
   * ahead for `setTimeout()` arms nothing: an abort arms it again later.
   */
  private arm(slot: Slot, at: number): void {
    const running = slot.running;
    if (running === undefined || !Number.isFinite(at)) return;
    if (running.at !== undefined && running.at <= at) return;
    const delay = Math.max(0, at - Date.now());
    if (delay > MAX_TIMER_DELAY) return;
    if (running.timer !== undefined) clearTimeout(running.timer);
    running.at = at;
    running.timer = setTimeout(() => this.overrun(slot, running), delay);
  }

  /** Cancel the slot's running task: its caller has its answer
   * (`settled`). The worker reads the cancel flag between cells or points
   * and answers early; if it has not answered within the grace period, the
   * watchdog replaces it. */
  private cancelRunning(slot: Slot): void {
    const running = slot.running;
    if (running === undefined) return;
    running.settled = true;
    if (slot.cancel !== undefined) Atomics.store(slot.cancel, 0, running.job);
    this.arm(slot, Date.now() + this.grace);
  }

  /** The watchdog of `running` fired: if the worker still runs that task,
   * settle the task with no cells done (its deadline passed and the worker
   * did not answer), and replace the worker. */
  private overrun(slot: Slot, running: NonNullable<Slot['running']>): void {
    if (slot.dead || slot.running !== running) return;
    if (!running.settled) {
      running.settled = true;
      running.task.resolve({ out: new Float64Array(0), done: 0 });
    }
    this.replace(slot);
  }

  /**
   * Terminate the worker of `slot`, which does not answer, and give the
   * tasks that wait for it to a new worker from the host's factory, in the
   * same place of the pool. The new worker holds no kernel, fit problem or
   * shared input: each is sent again with the first task that needs it, as
   * for any new worker (`slot.loaded` and `slot.batches` start empty). If
   * the factory throws, the waiting tasks are rejected, and their callers
   * finish inline.
   */
  private replace(slot: Slot): void {
    const k = this.slots.indexOf(slot);
    // A waiting task whose deadline has passed is settled here, so that a
    // batch whose deadline has passed does not create a new worker.
    const waiting = slot.queue.splice(0).filter((task) => {
      if (!deadlinePassed(task)) return true;
      task.resolve({ out: new Float64Array(0), done: 0 });
      return false;
    });
    // The running task was settled: `fail()` then rejects nothing.
    this.endRunning(slot);
    this.fail(slot, new Error('The kernel worker did not stop'));
    if (k < 0 || waiting.length === 0) return;
    let fresh: Slot;
    try {
      fresh = this.slot(k);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      for (const task of waiting) task.reject(error);
      return;
    }
    fresh.queue.push(...waiting);
    void this.pump(fresh);
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
      batches: new Set(),
      refused: new Map(),
      queue: [],
      running: undefined,
      cancel: newCancelFlag(),
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
          this.endRunning(slot);
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
          this.endRunning(slot);
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
   * kernel or failed; the caller then finishes inline. `batch` names the
   * shared inputs of the call (`newBatch()`); the caller releases them with
   * `releaseBatch()` once every slice of the call has settled.
   */
  runSlice(
    kind: KernelKind,
    stored: StoredResult,
    inputs: BroadcastInputs,
    options: BroadcastOptions | undefined,
    slice: BroadcastSlice,
    iterationLimit: number | undefined,
    signal: AbortSignal | undefined,
    batch?: SharedBatch
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
        batch,
        resolve,
        reject,
      })
    );
  }

  /** A new batch id for the shared inputs `names` of one `broadcastAsync()`
   * call. */
  newBatch(names: readonly string[]): SharedBatch {
    return { id: this.nextBatchId++, names };
  }

  /** Tell every worker that holds the shared inputs of `batch` to forget
   * them: every slice of the call has settled. A worker still running an
   * aborted slice of the call reads the message after that slice ends, as
   * a worker handles its messages in order. */
  releaseBatch(batch: SharedBatch): void {
    for (const slot of this.slots) {
      if (!slot || slot.dead || !slot.batches.has(batch.id)) continue;
      slot.batches.delete(batch.id);
      slot.worker.postMessage({
        type: 'release',
        batch: batch.id,
      } satisfies MainToWorkerMessage);
    }
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
    // the next task of the queue. The worker is told to stop through its
    // cancel flag, and is replaced if it does not answer within the grace
    // period (`cancelRunning()`).
    const signal = task.signal;
    if (signal !== undefined) {
      const onAbort = (): void => {
        // The task may have moved to another slot since it was queued: a
        // slot whose worker was replaced gives its queue to the new one.
        const owner =
          this.slots.find(
            (s) =>
              s !== undefined &&
              (s.running?.task === task || s.queue.includes(task))
          ) ?? slot;
        const q = owner.queue.indexOf(task);
        if (q >= 0) owner.queue.splice(q, 1);
        else if (owner.running?.task === task) this.cancelRunning(owner);
        task.resolve({ out: new Float64Array(0), done: 0 });
        // The aborted task may be the one a pending `pump()` waits to send:
        // that call then stops, and this one sends the next task.
        void this.pump(owner);
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
    this.armDeadline(slot, task.deadline);
    // A message that cannot be sent gets no reply: the task is settled
    // here, as on the `run` route of `pump()`, and the caller solves the
    // points inline.
    try {
      this.postTask(
        slot,
        {
          type: 'fit-run',
          job,
          id,
          points: task.points,
          width: task.problem.gridIdx.length,
          allRows: task.allRows,
          deadline: task.deadline,
          iterationLimit: task.iterationLimit,
          ...(slot.cancel !== undefined ? { cancel: slot.cancel } : {}),
        },
        [task.points.buffer as ArrayBuffer]
      );
    } catch (e) {
      this.endRunning(slot);
      task.reject(e instanceof Error ? e : new Error(String(e)));
      void this.pump(slot);
    }
  }

  /**
   * Post a `run` or `fit-run` message to the slot's worker. A host can have
   * `SharedArrayBuffer` and still fail to clone the cancel flag (a `create()`
   * adapter that sends the messages across a process boundary, or an older
   * browser that does not report `crossOriginIsolated`): when the post
   * throws and the message carries the flag, it is posted again without
   * it. If that post succeeds, the worker's tasks carry no flag from now on
   * (they are then stopped only by the termination after the grace period).
   * If it throws too, the error is not the flag's, and is thrown. A failed
   * post transfers no buffer, so the second post can transfer them.
   */
  private postTask(
    slot: Slot,
    message: MainToWorkerMessage & { type: 'run' | 'fit-run' },
    transfer: ArrayBuffer[]
  ): void {
    try {
      slot.worker.postMessage(message, transfer);
    } catch (e) {
      if (message.cancel === undefined) throw e;
      slot.worker.postMessage({ ...message, cancel: undefined }, transfer);
      slot.cancel = undefined;
    }
  }

  /** A task with a deadline stops on the worker at the deadline: arm its
   * watchdog to replace a worker that has not answered within the grace
   * period after it. The period starts no earlier than now, the time the
   * task is sent, so that the worker always has a full grace period to
   * receive the task, load what it needs and answer. */
  private armDeadline(slot: Slot, deadline: number | undefined): void {
    if (deadline !== undefined)
      this.arm(slot, Math.max(deadline, Date.now()) + this.grace);
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
    // An aborted task, or one whose deadline has passed (the worker would
    // stop before its first cell or point), is settled here and not sent.
    if (task.signal?.aborted || deadlinePassed(task)) {
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
        broadcastOutputs: task.stored.broadcastOutputs,
        batch: task.stored.batch,
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
    const batch = task.batch;
    const sharedNames = new Set(batch?.names);
    // The arrays travel as copies that are then transferred: for the
    // `cells` layout only the slice's own cells, which the worker reads as
    // its cells `[0, n)`; for the `grid` layout the whole axes, which are
    // small, and the slice's range. The shared inputs are not here.
    const wire: WireInputs = { names: [], values: [] };
    const transfer: ArrayBuffer[] = [];
    const { from, to } = task.slice;
    // `makeBroadcastAsync()` validated the inputs (`broadcastCellCount()`)
    // before it made any task, so a wrong input here is a caller that
    // changed `inputs` during the batch: the task is rejected, and the
    // caller finishes the batch inline, where the loop throws.
    let invalid: string | undefined;
    for (const name of Object.keys(task.inputs)) {
      if (sharedNames.has(name)) continue;
      const v = task.inputs[name];
      wire.names.push(name);
      if (typeof v === 'number') {
        wire.values.push(v);
        continue;
      }
      if (!(v instanceof Float64Array)) {
        invalid = `broadcast: the input for "${name}" must be a Float64Array or a number`;
        break;
      }
      const copy =
        layout === 'cells' ? v.slice(perCell * from, perCell * to) : v.slice();
      wire.values.push(copy);
      transfer.push(copy.buffer as ArrayBuffer);
    }
    // The shared inputs travel with the first task of the batch that this
    // worker receives, and the worker keeps them until `releaseBatch()`:
    // each worker gets its own copy of a `Float64Array`, transferred, and a
    // clone of a plain array. A plain array is first copied with
    // `Array.from()`: `Array.isArray()` is also true for a Proxy of an array
    // (a Vue `reactive()` or MobX observable array), and structured clone
    // cannot copy a Proxy, nor an extra property of the array that holds a
    // function or a symbol. The copy keeps only the elements, in a plain
    // array, so the worker's `plainSharedArray()` does not copy it again.
    let shared: WireShared | undefined;
    if (
      invalid === undefined &&
      batch !== undefined &&
      !slot.batches.has(batch.id)
    ) {
      shared = { names: [], values: [] };
      for (const name of batch.names) {
        const v = task.inputs[name];
        shared.names.push(name);
        if (v instanceof Float64Array) {
          const copy = v.slice();
          shared.values.push(copy);
          transfer.push(copy.buffer as ArrayBuffer);
        } else if (Array.isArray(v)) shared.values.push(Array.from(v));
        else {
          invalid = `broadcast: the shared input "${name}" must be an array of numbers or a Float64Array`;
          break;
        }
      }
      if (invalid === undefined) slot.batches.add(batch.id);
    }
    if (invalid !== undefined) {
      task.reject(new TypeError(invalid));
      void this.pump(slot);
      return;
    }
    slot.running = { job, task };
    this.armDeadline(slot, task.slice.deadline);
    // `postMessage()` throws a `DataCloneError` when structured clone cannot
    // copy a value of the message: for example a shared array element that
    // is a function. No worker reply then comes for this task, so the task
    // must be settled here: otherwise `slot.running` stays set and blocks
    // every later task of this slot, and the caller waits forever. The task
    // is rejected, and the caller finishes the batch inline. When this task
    // carried the shared inputs of its batch, the worker did not receive
    // them, so the slot no longer records the batch, and the next task of
    // the batch on this slot sends them again.
    try {
      this.postTask(
        slot,
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
          ...(task.options?.outputs !== undefined
            ? { outputs: task.options.outputs }
            : {}),
          ...(task.options?.indexes !== undefined
            ? { indexes: [...task.options.indexes] }
            : {}),
          ...(batch !== undefined ? { batch: batch.id } : {}),
          ...(shared !== undefined ? { shared } : {}),
          ...(slot.cancel !== undefined ? { cancel: slot.cancel } : {}),
        } satisfies MainToWorkerMessage,
        transfer
      );
    } catch (e) {
      this.endRunning(slot);
      if (shared !== undefined && batch !== undefined)
        slot.batches.delete(batch.id);
      task.reject(e instanceof Error ? e : new Error(String(e)));
      void this.pump(slot);
    }
  }
}

/** Whether `pool` is a pool this module (in any bundle) built. */
export function isKernelPool(pool: unknown): pool is KernelPoolImpl {
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

/** What a compile target gives `makeBroadcastAsync` for one result. */
export interface BroadcastAsyncSpec {
  kind: KernelKind;
  /** The compilation result itself: the stored form a worker rebuilds, and
   * the identity the pool keys its kernel ids and calibration on. */
  stored: StoredResult;
  /** `javascript` only: the variables the compiled code reads as lists (the
   * `lists` of the result's entry plan). Each is a shared input of a batch,
   * with the variables the `shared` option names. */
  lists?: readonly string[];
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

/**
 * Why `broadcastAsync()` keeps a batch of `count` cells off the pool, or
 * `undefined` when it sends the batch to the pool. The checks read the pool
 * and the calibrated threshold at the time of the call, in the order of the
 * `BroadcastAsyncReason` type. A `count` that is not a number is below the
 * threshold.
 */
function offPoolReason(
  spec: BroadcastAsyncSpec,
  count: number
): BroadcastAsyncReason | undefined {
  const pool = spec.workers();
  if (!isKernelPool(pool)) return 'no-pool';
  if (pool.unusable !== undefined) return 'pool-unusable';
  if (!spec.shippable) return 'not-shippable';
  if (!(count >= thresholdCells(spec.stored))) return 'below-threshold';
  return undefined;
}

/**
 * Build the `willUsePool` entry of a compilation result: whether
 * `broadcastAsync()` would send a batch of `cells` cells to the pool now.
 */
export function makeWillUsePool(
  spec: BroadcastAsyncSpec
): (cells: number) => boolean {
  return (cells) => offPoolReason(spec, cells) === undefined;
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
  const isInterval = spec.kind === 'interval-js';
  const perCellIn = isInterval ? 2 : 1;
  return async (inputs, options) => {
    // Validates the inputs, the `shared` option, and refuses `shared` and
    // `outputs` on an interval result.
    const count = broadcastCellCount(inputs, options, perCellIn, spec.lists);
    const sharedNames = isInterval
      ? []
      : broadcastSharedNames(spec.lists, inputs, options);
    // The values per cell: the `lo, hi, kind` triple of an interval, or the
    // stride of a `javascript` result (the `outputs` option, or the default
    // the result stores, read at call time as the worker reads it).
    const perCellOut = isInterval
      ? 3
      : broadcastStride(options, spec.stored.broadcastOutputs);
    const needed = perCellOut * count;
    const out = options?.out ?? new Float64Array(needed);
    if (out.length < needed)
      throw new TypeError(
        `broadcast: the output array holds ${out.length} values, ${needed} are needed`
      );
    // A `Float64Array` input, per-cell or shared, that shares its memory
    // with `out` is copied once, before the first slice. The slices write
    // `out` one after the other, so a later slice that read such an input,
    // directly or through a copy made for that slice, would read the values
    // that earlier slices wrote, not the values given. The synchronous
    // `broadcast()` runs one slice and copies such an input before its cell
    // loop.
    let callInputs = inputs;
    for (const name of Object.keys(inputs)) {
      const v = inputs[name];
      if (v instanceof Float64Array && v.buffer === out.buffer) {
        if (callInputs === inputs) callInputs = { ...inputs };
        callInputs[name] = v.slice();
      }
    }
    const chunkOption = positiveInteger(options?.chunk, 'chunk');
    if (
      options?.deadline !== undefined &&
      !(
        typeof options.deadline === 'number' &&
        Number.isFinite(options.deadline)
      )
    )
      throw new TypeError('broadcastAsync: `deadline` must be a finite number');
    if (options?.inline !== undefined && typeof options.inline !== 'boolean')
      throw new TypeError('broadcastAsync: `inline` must be a boolean');
    const allowInline = options?.inline !== false;
    const signal = options?.signal;
    const deadline =
      options?.deadline !== undefined
        ? Date.now() + options.deadline
        : undefined;
    // The options of each slice: the layout, and for `javascript` the
    // resolved stride and the shared names, so that the main thread and a
    // worker lay the cells out the same way.
    const indexOptions =
      options?.indexes !== undefined ? { indexes: options.indexes } : {};
    const layoutOptions: BroadcastOptions | undefined = isInterval
      ? options?.layout !== undefined
        ? { layout: options.layout, ...indexOptions }
        : undefined
      : {
          ...(options?.layout !== undefined ? { layout: options.layout } : {}),
          ...indexOptions,
          outputs: perCellOut,
          ...(sharedNames.length > 0 ? { shared: sharedNames } : {}),
        };
    const pastDeadline = (): boolean =>
      deadline !== undefined && Date.now() > deadline;

    // The inputs of the inline slices: the ordinary compiled body reads
    // plain arrays only, so a `Float64Array` shared input is copied into one
    // once for the whole call, not once per slice. A shared input that the
    // batch body of the result reads in place, and only in place, is not
    // copied (`sharedInputsReadInPlace`). Built on the first inline slice.
    let inlineInputs: BroadcastInputs | undefined;
    const plainInputs = (): BroadcastInputs => {
      if (inlineInputs !== undefined) return inlineInputs;
      if (sharedNames.length === 0) return (inlineInputs = callInputs);
      const inPlace = sharedInputsReadInPlace(spec.stored.batch?.params);
      const copy: BroadcastInputs = { ...callInputs };
      for (const name of sharedNames) {
        const v = callInputs[name];
        if (typeof v !== 'number' && !inPlace.has(name))
          copy[name] = plainSharedArray(v);
      }
      return (inlineInputs = copy);
    };

    /** Run the cells from `start` inline, in slices with a yield before
     * each slice; returns the count of leading valid cells from `start`.
     * The yield before the first slice is a macrotask turn too: without it,
     * the first slice (up to `INLINE_SLICE` cells) would run before
     * `broadcastAsync()` returns, since an async function runs on the
     * caller's stack until its first `await`. */
    const inline = async (start: number): Promise<number> => {
      const chunk = chunkOption ?? INLINE_SLICE;
      let done = start;
      let sliceMs = 0;
      while (done < count) {
        // Checked before and after the yield: the abort usually arrives
        // while the batch waits for the event loop.
        if (signal?.aborted || pastDeadline()) break;
        await yieldToEventLoop();
        if (signal?.aborted || pastDeadline()) break;
        const from = done;
        const to = Math.min(count, from + chunk);
        const t0 = Date.now();
        const n = spec.slice(
          plainInputs(),
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

    const reason = offPoolReason(spec, count);
    if (reason !== undefined)
      return {
        out,
        done: allowInline ? await inline(0) : 0,
        route: 'calling-thread',
        reason,
      };
    // `offPoolReason()` returned `undefined`: the pool is a usable
    // `KernelPoolImpl`.
    const pool = spec.workers() as KernelPoolImpl;

    // One slice per worker, or `chunk` cells per slice, in order. Each
    // worker takes one slice at a time; the rest wait on the main thread.
    const chunk = Math.max(1024, chunkOption ?? Math.ceil(count / pool.size));
    const slices: BroadcastSlice[] = [];
    for (let from = 0; from < count; from += chunk)
      slices.push({ from, to: Math.min(count, from + chunk), deadline });
    const iterationLimit = spec.iterationLimit();
    // One batch id per call: each worker receives the shared inputs once,
    // with the first slice of this call it runs, and forgets them below.
    const batch =
      sharedNames.length > 0 ? pool.newBatch(sharedNames) : undefined;
    // The slices' results are kept aside and committed in order, so that no
    // cell after `done` is written when an earlier slice stopped short.
    const results = await Promise.allSettled(
      slices.map((slice) =>
        pool.runSlice(
          spec.kind,
          spec.stored,
          callInputs,
          layoutOptions,
          slice,
          iterationLimit,
          signal,
          batch
        )
      )
    );
    if (batch !== undefined) pool.releaseBatch(batch);
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
    if (!failed) return { out, done, route: 'pool' };
    // A worker could not take a slice (a refused kernel, a failed worker):
    // the rest of the batch runs inline, with its yields, from the end of
    // the valid prefix, unless `inline: false` refused the calling thread.
    if (allowInline && done < count && !signal?.aborted && !pastDeadline()) {
      done += await inline(done);
      return { out, done, route: 'calling-thread', reason: 'pool-declined' };
    }
    return { out, done, route: 'pool', reason: 'pool-declined' };
  };
}
