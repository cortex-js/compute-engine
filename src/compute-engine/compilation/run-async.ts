import { callPool, isKernelPool } from '../kernel-pool.js';
import { setReconstructionDigits } from './javascript-runtime.js';
import type {
  CompilationResult,
  ParallelLoopReason,
  RunAsyncOptions,
} from './types.js';

//
// The runtime of `runAsync()` on a `javascript` result
// (`docs/plans/2026-11-08-ce1163-run-async-parallel-for.md`, section 4).
// It runs the asynchronous copy of the program (`parallelCode`, emitted by
// `pool-async.ts`) and gives it `_run`, the state of one run: the
// reconstruction digits of the caller and of the program, the run of a loop
// on the pool (`_run.loop`), and the addition of the sums of the sub-ranges
// to the accumulators.
//

/** The default of `RunAsyncOptions.minPasses`: the count of cells from which
 * `broadcastAsync()` starts to use the pool. */
const DEFAULT_MIN_PASSES = 20_000;

/** The most numbers that the private lists of all the workers hold together
 * for one loop. */
const MAX_PRIVATE_NUMBERS = 16_000_000;

/** What a `javascript` result gives `makeRunAsync()`. */
export interface RunAsyncSpec {
  /** The result itself: `runAsync()` reads its `parallelCode` and
   * `parallelLoops` when it is called, since the compiler sets them after it
   * builds the result. */
  readonly result: Pick<
    CompilationResult<'javascript'>,
    'parallelCode' | 'parallelLoops'
  >;
  /** The `_SYS` helpers of the result. */
  readonly sys: unknown;
  /** The check of the inputs of `run()` (`checkEntry()`): the arguments of
   * the compiled body for the arguments of a call. */
  readonly check: (args: unknown[]) => unknown[];
  /** The conversion of the value of the body, as `run()` makes it. */
  readonly finish: (value: unknown) => unknown;
  /** The error of the body, named as `run()` names it
   * (`namedEntryError()`). */
  readonly error: (args: unknown[], error: unknown) => unknown;
  /** The reconstruction digits of the result. */
  readonly digits: number | undefined;
  /** `run()`. */
  readonly run: (inputs: unknown) => unknown;
  /** The engine's worker pool and iteration limit, at the time of a call. */
  readonly workers: () => unknown;
  readonly iterationLimit: () => number | undefined;
}

type AsyncBody = (
  sys: unknown,
  vars: unknown,
  run: RunState
) => Promise<unknown>;

/** The state of one run of the asynchronous copy, its `_run`. */
type RunState = {
  /** Set the digits of the caller, and give `p` (the program leaves the
   * thread). */
  s: (p?: unknown) => unknown;
  /** Set the digits of the program, and give `v` (the program continues). */
  r: (v: unknown) => unknown;
  /** Set the digits of the program, as `r` does, and throw `error` (the
   * program continues after a wait whose promise rejected). */
  e: (error: unknown) => never;
  loop: (
    index: number,
    first: number,
    step: number,
    count: number,
    outer: unknown[],
    lengths: number[]
  ) => Promise<unknown[][]> | undefined;
  addNumber: (acc: number, sums: unknown[][], j: number) => number;
  addList: (
    list: ArrayLike<number>,
    sums: unknown[][],
    j: number,
    inPlace: boolean
  ) => ArrayLike<number>;
};

/** The constructor of an `async` function. */
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => AsyncBody;

/**
 * `acc` plus the sum of sub-range `j` of each sub-range of `sums`, added in
 * the order of the sub-ranges.
 */
function addNumber(acc: number, sums: unknown[][], j: number): number {
  let value = acc;
  for (const part of sums) value = value + (part[j] as number);
  return value;
}

/**
 * The list accumulator `list` plus the sums of the sub-ranges, list `j` of
 * each entry of `sums`, added element by element in the order of the
 * sub-ranges. With `inPlace`, the elements of `list` are written; otherwise
 * a new list is. An element whose sum is 0 is not written, so it keeps its
 * value (also `-0`).
 */
function addList(
  list: ArrayLike<number>,
  sums: unknown[][],
  j: number,
  inPlace: boolean
): ArrayLike<number> {
  const out = (inPlace ? list : Array.from(list)) as number[];
  for (const part of sums) {
    const values = part[j] as ArrayLike<number>;
    for (let i = 0; i < values.length; i++) {
      const x = values[i];
      if (x !== 0) out[i] = out[i] + x;
    }
  }
  return out;
}

/** A promise that rejects with `signal.reason` when `signal` is aborted
 * before `promise` settles. */
function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      }
    );
  });
}

/** The pool loops of `result`: the records with `route: 'pool'`. */
function poolRecords(result: RunAsyncSpec['result']): number {
  return (result.parallelLoops ?? []).filter((l) => l.route === 'pool').length;
}

/**
 * Build the `willParallelize` entry of a `javascript` result: whether
 * `runAsync()` would send a loop to the pool now (see its comment in
 * `types.ts`).
 */
export function makeWillParallelize(
  spec: RunAsyncSpec
): (passes?: number) => boolean {
  return (passes) =>
    spec.result.parallelCode !== undefined &&
    poolRecords(spec.result) > 0 &&
    callPool(spec.workers()) !== undefined &&
    (passes === undefined || passes >= DEFAULT_MIN_PASSES);
}

/**
 * Build the `runAsync` entry of a `javascript` result called with a vars
 * object.
 */
export function makeRunAsync(
  spec: RunAsyncSpec
): (inputs?: unknown, options?: RunAsyncOptions) => Promise<unknown> {
  // The asynchronous copy is compiled at its first run.
  let body: AsyncBody | undefined;
  return async (inputs, options = {}) => {
    const { signal, onLoop } = options;
    if (signal?.aborted) throw signal.reason;
    const minPasses = options.minPasses ?? DEFAULT_MIN_PASSES;
    if (!Number.isInteger(minPasses) || minPasses < 1)
      throw new TypeError(
        `runAsync: \`minPasses\` must be a positive integer (got ${String(minPasses)})`
      );
    const code = spec.result.parallelCode;
    const loops = spec.result.parallelLoops ?? [];
    if (code === undefined) return spec.run(inputs);
    body ??= new AsyncFunction('_SYS', '_', '_run', code);
    const args = spec.check(inputs === undefined ? [] : [inputs]);

    // The digits that were current when the program last started or
    // continued, set again each time it leaves the thread (see
    // `pool-async.ts`). A continuation runs in a later job, when the digits
    // of another frame can be current: those are saved again then.
    let caller = setReconstructionDigits(spec.digits);
    const state: RunState = {
      s: (p) => {
        setReconstructionDigits(caller);
        return p;
      },
      r: (v) => {
        caller = setReconstructionDigits(spec.digits);
        return v;
      },
      // A rejection also saves the current digits: the `finally` of each
      // `async` function of the copy sets `caller` when the error leaves
      // it, and without this save it would set the digits of an earlier job.
      e: (error) => {
        caller = setReconstructionDigits(spec.digits);
        throw error;
      },
      addNumber,
      addList,
      loop: (index, first, step, count, outer, lengths) => {
        // An abort while the calling thread ran statements is seen here.
        if (signal?.aborted) throw signal.reason;
        const record = loops[index];
        if (record?.route !== 'pool') return undefined;
        // `onLoop` is host code: it runs with the digits of the caller.
        // Here the program's digits are set, and `inProgram` false is for a
        // call after the wait, where they are not.
        const report = (
          route: 'pool' | 'calling-thread',
          reason?: ParallelLoopReason,
          inProgram = true
        ) => {
          if (onLoop === undefined) return;
          const own = inProgram ? setReconstructionDigits(caller) : undefined;
          try {
            onLoop({
              passes: count,
              route,
              ...(reason !== undefined ? { reason } : {}),
            });
          } finally {
            if (inProgram) setReconstructionDigits(own);
          }
        };
        const workers = spec.workers();
        const pool = callPool(workers);
        if (pool === undefined) {
          report(
            'calling-thread',
            isKernelPool(workers) ? 'pool-unusable' : 'no-pool'
          );
          return undefined;
        }
        if (!(count >= minPasses)) {
          report('calling-thread', 'below-threshold');
          return undefined;
        }
        const parts = Math.max(1, Math.min(pool.size, count));
        const numbers = lengths.reduce((a, b) => a + b, 0) * parts;
        if (numbers > MAX_PRIVATE_NUMBERS) {
          report('calling-thread', 'too-large');
          return undefined;
        }
        // One sub-range of pass indices for each worker, in order.
        const ranges: [number, number][] = [];
        for (let p = 0; p < parts; p++)
          ranges.push([
            Math.floor((count * p) / parts),
            Math.floor((count * (p + 1)) / parts) - 1,
          ]);
        const argsOf = ([from, to]: [number, number]) => [
          first,
          step,
          from,
          to,
          ...outer,
          ...lengths,
        ];
        const fn = record.fn;
        const iterationLimit = spec.iterationLimit();
        return (async () => {
          const settled = await abortable(
            Promise.allSettled(
              ranges.map((range) =>
                pool.runCall(fn, argsOf(range), iterationLimit, signal)
              )
            ),
            signal
          );
          if (signal?.aborted) throw signal.reason;
          const failed = settled.some((r) => r.status === 'rejected');
          report(
            failed ? 'calling-thread' : 'pool',
            failed ? 'pool-declined' : undefined,
            false
          );
          // A sub-range that a worker did not complete runs on the calling
          // thread with the same function, in the order of the sub-ranges:
          // the first one that throws there gives the error of the run.
          const run = fn.run as (...a: unknown[]) => unknown;
          return settled.map(
            (r, p) =>
              (r.status === 'fulfilled'
                ? r.value
                : run(...argsOf(ranges[p]))) as unknown[]
          );
        })();
      },
    };
    let pending: Promise<unknown>;
    try {
      pending = body(spec.sys, args[0], state);
    } finally {
      setReconstructionDigits(caller);
    }
    let value: unknown;
    try {
      value = await pending;
    } catch (error) {
      // The reason of an abort is the value of the rejection, as it is.
      if (signal?.aborted && error === signal.reason) throw error;
      throw spec.error(args, error);
    }
    return spec.finish(value);
  };
}
