import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ROADMAP CE-314.3 (Tycho row 441, part 2): an engine inside a dedicated
// worker gets a kernel pool when the code in that worker calls
// `createKernelPool()` with a factory that starts nested workers, and sets
// `ce.workers`. The worker `fixtures/nested-pool-worker.ts` does that, runs
// a batch and a fit, and reports the route and the values. Two kernel
// workers, as the shared box caps test workers.

const NESTED = pathToFileURL(join(__dirname, 'fixtures/nested-pool-worker.ts'));

type Report = {
  error?: string;
  batch: { route: string; done: number; same: boolean };
  fit: {
    route: string;
    parameters: string;
    syncParameters: string;
    residualNorm: number;
    syncResidualNorm: number;
  };
};

test('an engine inside a worker thread runs a batch and a fit on its own pool', async () => {
  const outer = new Worker(NESTED, { execArgv: ['--import', 'tsx'] });
  try {
    const report = await new Promise<Report>((resolve, reject) => {
      outer.once('message', resolve);
      outer.once('error', reject);
    });
    expect(report.error).toBeUndefined();
    expect(report.batch).toEqual({ route: 'pool', done: 200_000, same: true });
    expect(report.fit.route).toBe('pool');
    expect(report.fit.parameters).toBe(report.fit.syncParameters);
    expect(report.fit.residualNorm).toBe(report.fit.syncResidualNorm);
  } finally {
    await outer.terminate();
  }
}, 60_000);
