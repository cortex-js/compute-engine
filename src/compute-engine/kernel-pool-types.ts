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
  /** Build one worker running the kernel-worker file. Called lazily, up to
   * `size` times. */
  create: () => WorkerLike;
  /** The number of workers. Default: one less than the hardware concurrency
   * when known, at most 8, at least 1. */
  size?: number;
  /** Create the workers on idle time right after the pool is built, so that
   * the first batch does not pay the start-up (about 40 ms per worker). */
  prewarm?: boolean;
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
