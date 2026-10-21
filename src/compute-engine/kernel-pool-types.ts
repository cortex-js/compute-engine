/**
 * The public types of the kernel pool (`kernel-pool.ts`): what a host gives
 * `createKernelPool()` and what an engine holds as `ce.workers`. They live in
 * this leaf module, which imports nothing, because `types-engine.ts` names
 * `KernelPool` and must not reach the pool's implementation (that import
 * closed a cycle through the compiled-code runtime and the numerics).
 */

/**
 * What the pool needs of a worker: a browser `Worker` (`addEventListener`)
 * and a Node `worker_threads` `Worker` (`on`) both fit. `postMessage` takes
 * the message and the list of buffers to transfer in both.
 */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  terminate(): unknown;
  on?(
    event: 'message' | 'error' | 'exit',
    handler: (data: unknown) => void
  ): unknown;
  addEventListener?(
    type: 'message' | 'error',
    handler: (event: unknown) => void
  ): void;
}

export interface KernelPoolOptions {
  /** Build one worker running the kernel-worker file. Called lazily, once
   * per worker; called again to replace a worker that failed, did not stop
   * within `cancelGrace`, or after `dispose()`. */
  create: () => WorkerLike;
  /** The number of workers. Default: one less than the hardware concurrency
   * when known, at most 8, at least 1. */
  size?: number;
  /** Create the workers on idle time right after the pool is built, so that
   * the first batch does not pay the start-up (about 40 ms per worker). */
  prewarm?: boolean;
  /** The time, in milliseconds, that a worker has to answer after the pool
   * cancels its running task (the task's signal aborted, or its deadline
   * passed). A worker that has not answered by then is terminated and
   * replaced by a new one from `create`, and the tasks that waited for it
   * go to the new worker. `Infinity` never terminates a worker; a finite
   * value must be at most 2147483647, the longest delay of `setTimeout()`
   * (a larger one throws a `TypeError`). Default:
   * 250, a few times the start-up of a worker (about 40 ms), so that a
   * worker that stops at its next check is never replaced. */
  cancelGrace?: number;
}

export interface KernelPool {
  readonly size: number;
  /** Create every worker now and resolve when each has reported ready or
   * failed to start. */
  prewarm(): Promise<void>;
  /** Terminate the workers and settle every task in flight (its batch then
   * finishes inline). A later batch creates the workers again. */
  dispose(): void;
}
