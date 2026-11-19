import { callPool, isKernelPool, type StoredResult } from '../kernel-pool.js';
import {
  CancellationError,
  type DeadlineFrame,
} from '../../common/interruptible.js';
import { setReconstructionDigits } from './javascript-runtime.js';
import type { ParallelLoopReason, RunAsyncOptions } from './types.js';

//
// The runtime of `runAsync()` on a `javascript` result (design:
// `docs/plans/2026-11-18-ir-parallel-for-and-list-locals.md`, section 6.4).
// It runs the asynchronous text of the program (`asyncCode` of the IR
// printer) and gives it `_run`, the state of one call: the reconstruction
// digits and the deadline frame of the caller and of the program, the run of
// a pool loop on the worker pool (`_run.loop`), and the addition of the
// partial sums of the sub-ranges to the accumulators.
//

/** The default of `RunAsyncOptions.minPasses`. */
export const DEFAULT_MIN_PASSES = 20_000;

/** The most numbers that the private lists of all the workers hold together
 * for one loop (the list accumulators and the lists that the body reads,
 * one copy per sub-range). */
const MAX_PRIVATE_NUMBERS = 16_000_000;

/** A pool loop of the program, as `runAsync()` runs it. */
export interface RunAsyncLoop {
  /** The worker program as stored code: a lambda of `i0`, `i1`, `lo` and
   * the values passed, which returns the partial sums, then the partial
   * arrays, of the passes `i0 <= i < i1`. */
  readonly stored: StoredResult;
  /** The worker program on the calling thread, over the engine's runtime
   * (a sub-range that the pool did not complete). */
  readonly run: (...args: unknown[]) => unknown;
}

/** The engine state that `runAsync()` reads and sets. */
interface RunAsyncEngine {
  _deadlineFrame?: DeadlineFrame | undefined;
  readonly iterationLimit: number;
  readonly workers?: unknown;
}

/** What a `javascript` result gives `makeRunAsync()`. */
export interface RunAsyncSpec {
  /** `run()`. */
  readonly run: (inputs: unknown) => unknown;
  /** The pool loops, by id: none when the program has none. */
  readonly loops: readonly RunAsyncLoop[];
  /** The function of the asynchronous text, built at the first call: its
   * arguments are the checked inputs object and `_run`. */
  readonly body?: () => (vars: unknown, run: RunState) => Promise<unknown>;
  /** The check of the inputs of `run()` (`checkEntry()`). */
  readonly check: (inputs: unknown) => unknown;
  /** The conversion of the value, as `run()` makes it. */
  readonly finish: (value: unknown) => unknown;
  /** The reconstruction digits of the result. */
  readonly digits: number | undefined;
  readonly engine: RunAsyncEngine;
}

/** The outcome of a wait, as `_run.ok` and `_run.fail` wrap it. */
type Outcome = { v: unknown } | { x: unknown };

/** The state of one call of the asynchronous text, its `_run`. */
export type RunState = {
  /** The program leaves the thread: set the caller's digits and frame,
   * and give `p`. */
  s: <T>(p: T) => T;
  /** The program continues: save the current digits and frame as the
   * caller's, set the program's, and give the value or throw the error. */
  r: (o: Outcome) => unknown;
  ok: (v: unknown) => Outcome;
  fail: (x: unknown) => Outcome;
  /** An `async` function of the text ends: set the caller's digits and
   * frame. */
  d: () => void;
  loop: (
    id: number,
    lo: number,
    hi: number,
    values: unknown[],
    lists: ArrayLike<number>[]
  ) => Promise<unknown[][]> | undefined;
  addNumber: (acc: number, sums: unknown[][], j: number) => number;
  addList: (
    list: number[],
    sums: unknown[][],
    j: number
  ) => ArrayLike<number>;
};

/** `acc` plus result `j` of each sub-range, in the order of the
 * sub-ranges. */
function addNumber(acc: number, sums: unknown[][], j: number): number {
  let value = acc;
  for (const part of sums) value = value + (part[j] as number);
  return value;
}

/** The list accumulator `list` plus the partial array `j` of each
 * sub-range, cell by cell, worker after worker, in place (the local owns
 * its array). A cell that no pass wrote holds `-0`, which adds nothing. */
function addList(list: number[], sums: unknown[][], j: number): number[] {
  for (const part of sums) {
    const values = part[j] as ArrayLike<number>;
    for (let i = 0; i < values.length; i++) list[i] = list[i] + values[i];
  }
  return list;
}

/** The count of numbers in the value `v` passed to a worker: the product
 * of the lengths of its shape, read down the first elements (a list of the
 * IR has one length per axis). Exported for its test.
 * @internal */
export function numbersOf(v: unknown): number {
  if (!Array.isArray(v) && !(v instanceof Float64Array)) return 0;
  let n = 1;
  let x: unknown = v;
  while (Array.isArray(x) || x instanceof Float64Array) {
    n *= x.length;
    x = x[0];
  }
  return n;
}

/** Check `minPasses` as `runAsync()` and `willParallelize()` do. */
function checkMinPasses(
  where: string,
  minPasses: number | undefined
): number {
  const n = minPasses ?? DEFAULT_MIN_PASSES;
  if (!Number.isInteger(n) || n < 1)
    throw new TypeError(
      `${where}: \`minPasses\` must be a positive integer (got ${String(minPasses)})`
    );
  return n;
}

/** The frame holds a step budget (`ce.withStepBudget()`), which workers
 * cannot charge. */
const hasStepBudget = (frame: DeadlineFrame | undefined): boolean =>
  (frame?.budgets?.length ?? 0) > 0;

/**
 * Build the `willParallelize` entry of a `javascript` result: whether
 * `runAsync()` would send a loop to the pool now (see its comment in
 * `types.ts`).
 */
export function makeWillParallelize(
  spec: RunAsyncSpec
): (passes?: number, minPasses?: number) => boolean {
  return (passes, minPasses) => {
    const least = checkMinPasses('willParallelize', minPasses);
    return (
      spec.loops.length > 0 &&
      callPool(spec.engine.workers) !== undefined &&
      !hasStepBudget(spec.engine._deadlineFrame) &&
      (passes === undefined || passes >= least)
    );
  };
}

/**
 * Build the `runAsync` entry of a `javascript` result called with a vars
 * object.
 */
export function makeRunAsync(
  spec: RunAsyncSpec
): (inputs?: unknown, options?: RunAsyncOptions) => Promise<unknown> {
  // The asynchronous text is compiled at its first run.
  let body: ((vars: unknown, run: RunState) => Promise<unknown>) | undefined;
  const engine = spec.engine;
  return async (inputs, options = {}) => {
    const { signal, onLoop } = options;
    if (signal?.aborted) throw signal.reason;
    const minPasses = checkMinPasses('runAsync', options.minPasses);
    if (spec.loops.length === 0 || spec.body === undefined)
      return spec.run(inputs);
    body ??= spec.body();
    const vars = spec.check(inputs);
    // The state of the call: the deadline frame current at the call, and
    // the digits of the result; the caller's, saved each time the program
    // continues, and set again each time it leaves the thread or one of its
    // `async` functions ends.
    const frame = engine._deadlineFrame;
    const iterationLimit = engine.iterationLimit;
    let caller = {
      digits: setReconstructionDigits(spec.digits),
      frame: engine._deadlineFrame,
    };
    const leave = (): void => {
      setReconstructionDigits(caller.digits);
      engine._deadlineFrame = caller.frame;
    };
    const enter = (): void => {
      caller = {
        digits: setReconstructionDigits(spec.digits),
        frame: engine._deadlineFrame,
      };
      engine._deadlineFrame = frame;
    };
    /** `f` with the caller's state, from the program's (host code). */
    const asCaller = <T>(f: () => T): T => {
      const own = {
        digits: setReconstructionDigits(caller.digits),
        frame: engine._deadlineFrame,
      };
      engine._deadlineFrame = caller.frame;
      try {
        return f();
      } finally {
        setReconstructionDigits(own.digits);
        engine._deadlineFrame = own.frame;
      }
    };
    /** `f` with the program's state, from any (a rerun). */
    const asProgram = <T>(f: () => T): T => {
      const own = {
        digits: setReconstructionDigits(spec.digits),
        frame: engine._deadlineFrame,
      };
      engine._deadlineFrame = frame;
      try {
        return f();
      } finally {
        setReconstructionDigits(own.digits);
        engine._deadlineFrame = own.frame;
      }
    };
    const deadline =
      frame !== undefined && Number.isFinite(frame.at) ? frame.at : undefined;

    const state: RunState = {
      s: (p) => {
        leave();
        return p;
      },
      r: (o) => {
        enter();
        if ('x' in o) throw o.x;
        return o.v;
      },
      ok: (v) => ({ v }),
      fail: (x) => ({ x }),
      d: leave,
      addNumber,
      addList,
      loop: (id, lo, hi, values, lists) => {
        // An abort while the calling thread ran statements is seen here.
        if (signal?.aborted) throw signal.reason;
        const record = spec.loops[id];
        // The count of passes of `run()`'s loop; past its guard, the loop
        // runs in order and throws as `run()` does.
        const n = Math.floor(hi - lo) + 1;
        if (!(n - 1 < 2 ** 32)) return undefined;
        const count = Math.max(0, n);
        const report = (
          route: 'pool' | 'calling-thread',
          reason?: ParallelLoopReason
        ): void => {
          if (onLoop === undefined) return;
          onLoop({
            passes: count,
            route,
            ...(reason !== undefined ? { reason } : {}),
          });
        };
        // Here the program's state is set: the host's `onLoop` runs with
        // the caller's.
        const off = (reason: ParallelLoopReason): undefined => {
          asCaller(() => report('calling-thread', reason));
          return undefined;
        };
        const workers = engine.workers;
        const pool = callPool(workers);
        if (pool === undefined)
          return off(isKernelPool(workers) ? 'pool-unusable' : 'no-pool');
        if (hasStepBudget(frame)) return off('step-budget');
        if (count < minPasses) return off('below-threshold');
        const parts = Math.min(pool.size, count);
        const numbers =
          (lists.reduce((a, l) => a + l.length, 0) +
            values.reduce<number>((a, v) => a + numbersOf(v), 0)) *
          parts;
        if (numbers > MAX_PRIVATE_NUMBERS) return off('too-large');
        // One sub-range of pass counts for each worker, in order.
        const ranges: [number, number][] = [];
        for (let p = 0; p < parts; p++)
          ranges.push([
            Math.floor((count * p) / parts),
            Math.floor((count * (p + 1)) / parts),
          ]);
        const argsOf = ([i0, i1]: [number, number]) => [i0, i1, lo, ...values];
        // The error of the frame's deadline, one object for the loop: a
        // task rejected with it is a deadline answer.
        let frameError: CancellationError | undefined;
        const deadlineError = (): CancellationError =>
          (frameError ??= new CancellationError({
            cause: 'timeout',
            message: 'Timeout exceeded',
            attribution: frame?.owner,
            spans: frame?.spans,
          }));
        // The tasks stop on the host's abort and on the first deadline
        // answer; the wait rejects then.
        const internal = new AbortController();
        let stop: ((e: unknown) => void) | undefined;
        const onAbort = (): void => {
          internal.abort(signal!.reason);
          stop?.(signal!.reason);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        type Settled = { ok: true; v: unknown } | { ok: false };
        const tasks = ranges.map((range) =>
          pool.runCall(
            record.stored,
            argsOf(range),
            iterationLimit,
            internal.signal,
            deadline,
            deadlineError
          )
        );
        return (async () => {
          try {
            // Every task settles, unless a deadline answer or an abort comes
            // first.
            const settled = await new Promise<Settled[]>((resolve, reject) => {
              const out: Settled[] = [];
              let left = tasks.length;
              stop = reject;
              if (signal?.aborted) reject(signal.reason);
              tasks.forEach((task, p) =>
                task.then(
                  (v) => {
                    out[p] = { ok: true, v };
                    if (--left === 0) resolve(out);
                  },
                  (e) => {
                    if (e === frameError && e !== undefined) {
                      internal.abort(e);
                      reject(e);
                      return;
                    }
                    out[p] = { ok: false };
                    if (--left === 0) resolve(out);
                  }
                )
              );
            });
            if (signal?.aborted) throw signal.reason;
            const failed = settled.some((s) => !s.ok);
            // No rerun once the deadline has passed.
            if (failed && deadline !== undefined && Date.now() >= deadline)
              throw deadlineError();
            report(
              failed ? 'calling-thread' : 'pool',
              failed ? 'pool-declined' : undefined
            );
            // A sub-range that a worker did not complete runs on the calling
            // thread with the worker program, in the order of the
            // sub-ranges: the first one that throws gives the error of the
            // first failing pass. It ticks the frame of the call.
            return settled.map(
              (s, p) =>
                (s.ok
                  ? s.v
                  : asProgram(() => record.run(...argsOf(ranges[p])))) as unknown[]
            );
          } finally {
            signal?.removeEventListener('abort', onAbort);
          }
        })();
      },
    };
    let pending: Promise<unknown>;
    try {
      pending = body(vars, state);
    } finally {
      leave();
    }
    return spec.finish(await pending);
  };
}
