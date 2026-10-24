// The worker of `test/compute-engine/ce-314-3-nested-pool.test.ts`
// (ROADMAP CE-314.3). It runs an engine inside a dedicated worker thread, as
// a host that moves its engine off the main thread does. The engine creates
// no worker on its own, so the code here makes a kernel pool whose factory
// starts workers of its own (nested workers) and sets `ce.workers`. It then
// runs a batch and a fit on that pool and on its own thread, and posts both
// results to the parent.

import { parentPort, Worker } from 'node:worker_threads';
import {
  ComputeEngine,
  compile,
  createKernelPool,
} from '../../../src/compute-engine';

const KERNEL_WORKER = new URL('../../../src/kernel-worker.ts', import.meta.url);

async function main(): Promise<void> {
  const pool = createKernelPool({
    create: () => new Worker(KERNEL_WORKER, { execArgv: ['--import', 'tsx'] }),
    size: 2,
  });
  const ce = new ComputeEngine();
  ce.workers = pool;
  try {
    // A batch: 200 000 cells of a compiled function, on the pool only.
    const f = compile(ce.parse('\\sin(x)\\cos(3x) + x^2'));
    const n = 200_000;
    const xs = Float64Array.from({ length: n }, (_, i) => -5 + (10 * i) / n);
    const onPool = await f.broadcastAsync!({ x: xs }, { inline: false });
    const inline = f.broadcast!({ x: xs });
    let sameBatch = onPool.done === n;
    for (let i = 0; sameBatch && i < n; i++)
      sameBatch = Object.is(onPool.out[i], inline[i]);

    // A fit whose separable scan compiles: the scan goes to the pool.
    const rowsX = Array.from({ length: 400 }, (_, i) => (10 * i) / 399);
    const call = [
      'FindFit',
      [
        'List',
        ...rowsX.map((x) => ['Tuple', x, 2 * Math.cos(2.2 * x + 0.5) + 0.1 * x]),
      ],
      [
        'Add',
        ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
        ['Multiply', 'd', 'x'],
      ],
      ['List', 'a', 'b', 'c', 'd'],
      ['List', 'x'],
      { dict: { global: { dict: { b: [0.3, 60], c: [0, 6.283] } } } },
    ];
    const fit = await ce.box(call as never).evaluateAsync();
    const sync = new ComputeEngine().box(call as never).evaluate();

    parentPort!.postMessage({
      batch: { route: onPool.route, done: onPool.done, same: sameBatch },
      fit: {
        route: fit.get('route')?.string,
        parameters: String(fit.get('parameters')),
        syncParameters: String(sync.get('parameters')),
        residualNorm: fit.get('residualNorm')?.re,
        syncResidualNorm: sync.get('residualNorm')?.re,
      },
    });
  } finally {
    pool.dispose();
  }
}

main().catch((e) => parentPort!.postMessage({ error: String(e) }));
