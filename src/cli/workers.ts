import { createKernelPool } from '../compute-engine/kernel-pool.js';
import type { KernelPool } from '../compute-engine/kernel-pool-types.js';

import type { CliIo } from './io.js';

/** The host cannot start worker threads: `--workers` with a value above zero
 * is refused. */
export class WorkersUnavailableError extends Error {
  constructor() {
    super('The --workers option needs worker threads, which are unavailable.');
  }
}

/**
 * The kernel pool of `--workers <size>` (the command line, the REPL and the
 * MCP server), or `undefined` when `size` is `0`. The workers are created
 * lazily, by the first batch that the pool takes, from the factory of `io`;
 * the caller disposes of the pool when it ends, so that the worker threads
 * do not keep the process running.
 *
 * The pool is built by this bundle, and the engine is in the Epsil library
 * bundle. The engine recognizes the pool by a brand under a global symbol
 * (`isKernelPool()`, `compute-engine/kernel-pool.ts`), not by its class, so a
 * pool built here works with that engine.
 */
export function makeCliKernelPool(
  size: number,
  io: CliIo
): KernelPool | undefined {
  if (size <= 0) return undefined;
  const create = io.createWorker;
  if (create === undefined) throw new WorkersUnavailableError();
  return createKernelPool({ create, size });
}
