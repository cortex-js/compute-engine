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
// engine's iteration limit and the batch deadline with it.
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
import type {
  BroadcastInputs,
  BroadcastOptions,
} from './compute-engine/compilation/types.js';
import type { BroadcastSlice } from './compute-engine/compilation/broadcast.js';
import type {
  MainToWorkerMessage,
  StoredKernel,
  WorkerToMainMessage,
} from './compute-engine/kernel-protocol.js';

export const version = '{{SDK_VERSION}}';

/** A loaded kernel: its slice loop and the values it writes per cell (1 for
 * `javascript`, 3 for `interval-js`). */
interface Kernel {
  slice: (
    inputs: BroadcastInputs,
    options: BroadcastOptions | undefined,
    out: Float64Array,
    slice: BroadcastSlice
  ) => number;
  perCellOut: 1 | 3;
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
    return { slice: intervalRuntime.loadBroadcastSlice(kernel), perCellOut: 3 };
  return {
    slice: jsRuntime.loadBroadcastSlice({
      ...kernel,
      entryPlan: kernel.entryPlan as Parameters<
        typeof jsRuntime.loadBroadcastSlice
      >[0]['entryPlan'],
    }),
    perCellOut: 1,
  };
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
    case 'unload':
      kernels.delete(m.id);
      return;
    case 'run': {
      const kernel = kernels.get(m.id);
      if (kernel === undefined) {
        port.post({
          type: 'error',
          job: m.job,
          message: `kernel ${m.id} is not loaded`,
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
        const out = new Float64Array(kernel.perCellOut * (m.to - m.from));
        const done = kernel.slice(inputs, { layout: m.layout }, out, {
          from: m.from,
          to: m.to,
          deadline: m.deadline,
        });
        // Only the written prefix travels back, and its buffer is
        // transferred, not copied.
        const sent =
          done === m.to - m.from ? out : out.slice(0, kernel.perCellOut * done);
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
