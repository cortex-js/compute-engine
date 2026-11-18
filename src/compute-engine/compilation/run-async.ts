import type { RunAsyncOptions } from './types.js';

//
// The runtime of `runAsync()` on a `javascript` result. In this release a
// `parallel for` runs in order on the calling thread: `runAsync()` runs
// `run()`. A later release sends such loops to the worker pool
// (`docs/plans/2026-11-08-ce1163-run-async-parallel-for.md`).
//

/** What a `javascript` result gives `makeRunAsync()`. */
export interface RunAsyncSpec {
  /** `run()`. */
  readonly run: (inputs: unknown) => unknown;
}

/**
 * Build the `willParallelize` entry of a `javascript` result: whether
 * `runAsync()` would send a loop to the pool now, `false` in this release.
 */
export function makeWillParallelize(
  _spec: RunAsyncSpec
): (passes?: number) => boolean {
  return () => false;
}

/**
 * Build the `runAsync` entry of a `javascript` result called with a vars
 * object.
 */
export function makeRunAsync(
  spec: RunAsyncSpec
): (inputs?: unknown, options?: RunAsyncOptions) => Promise<unknown> {
  return async (inputs, options = {}) => {
    const { signal } = options;
    if (signal?.aborted) throw signal.reason;
    const minPasses = options.minPasses;
    if (
      minPasses !== undefined &&
      (!Number.isInteger(minPasses) || minPasses < 1)
    )
      throw new TypeError(
        `runAsync: \`minPasses\` must be a positive integer (got ${String(minPasses)})`
      );
    return spec.run(inputs);
  };
}
