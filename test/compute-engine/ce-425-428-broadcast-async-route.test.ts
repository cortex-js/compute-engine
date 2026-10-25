import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ComputeEngine,
  compile,
  createKernelPool,
  type KernelPool,
} from '../../src/compute-engine';

// `broadcastAsync()` and the calling thread (ROADMAP CE-425.2, CE-426,
// CE-427 and CE-428, from Tycho's feedback on CE 0.165.0):
// - no cell runs before the call returns: the inline route yields to the
//   event loop before its first slice;
// - `inline: false` refuses the calling thread;
// - `result.shippable` says whether the result can run on a worker, and
//   `result.willUsePool(cells)` whether a batch would go to the pool;
// - the result says where the batch ran (`route`) and why the pool did not
//   take it (`reason`).
// The workers are Node `worker_threads` running the worker entry from
// source through the tsx loader, as in `kernel-pool.test.ts`.

const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));

function samples(n: number, lo = -5, hi = 5): Float64Array {
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = lo + ((hi - lo) * i) / (n - 1);
  return xs;
}

describe('the inline route yields before its first slice (CE-425.2)', () => {
  const ce = new ComputeEngine();

  test('no cell is written before the call returns, nor in the microtasks after it', async () => {
    const r = compile(ce.parse('x^2 + 1'));
    const out = new Float64Array(5000).fill(-7);
    const p = r.broadcastAsync!({ x: samples(5000) }, { out });
    // Right after the call: the first slice has not run.
    expect(out[0]).toBe(-7);
    // A yield through microtasks only would have run the first slice by
    // now; the yield is a macrotask turn.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(out[0]).toBe(-7);
    const { done, route, reason } = await p;
    expect(done).toBe(5000);
    expect(out[0]).toBe(26);
    expect(route).toBe('calling-thread');
    expect(reason).toBe('no-pool');
  });

  test('an abort right after the call stops the batch before its first cell', async () => {
    const r = compile(ce.parse('x^2'));
    const ctl = new AbortController();
    const out = new Float64Array(10_000).fill(-7);
    const p = r.broadcastAsync!(
      { x: samples(10_000) },
      { chunk: 1000, signal: ctl.signal, out }
    );
    ctl.abort();
    const { done } = await p;
    expect(done).toBe(0);
    expect(out[0]).toBe(-7);
  });
});

describe('without a pool', () => {
  const ce = new ComputeEngine();

  test('`inline: false` resolves with no cell done and runs nothing', async () => {
    const r = compile(ce.parse('2x'));
    const out = new Float64Array(3).fill(-7);
    const back = await r.broadcastAsync!(
      { x: new Float64Array([1, 2, 3]) },
      { out, inline: false }
    );
    expect(back.done).toBe(0);
    expect(back.route).toBe('calling-thread');
    expect(back.reason).toBe('no-pool');
    expect(Array.from(out)).toEqual([-7, -7, -7]);
  });

  test('`willUsePool` is false', () => {
    const r = compile(ce.parse('2x'));
    expect(r.willUsePool!(1_000_000)).toBe(false);
    const i = compile(ce.parse('2x'), { to: 'interval-js' });
    expect(i.willUsePool!(1_000_000)).toBe(false);
  });

  test('`inline` that is not a boolean throws', async () => {
    const r = compile(ce.parse('2x'));
    await expect(
      r.broadcastAsync!({ x: new Float64Array(3) }, {
        inline: 'no',
      } as unknown as { inline: boolean })
    ).rejects.toThrow(/`inline` must be a boolean/);
  });
});

describe('`shippable` (CE-427)', () => {
  const ce = new ComputeEngine();

  test('a plain result is shippable, on both targets', () => {
    expect(compile(ce.parse('\\sin(x) + x^2')).shippable).toBe(true);
    expect(
      compile(ce.parse('\\sin(x) + x^2'), { to: 'interval-js' }).shippable
    ).toBe(true);
  });

  test('a random draw is not shippable', () => {
    expect(compile(ce.box(['Add', 'x', ['Random']])).shippable).toBe(false);
  });

  test('a variable given by the name of a host global is not shippable', () => {
    expect(
      compile(ce.parse('x + a'), { vars: { a: 'hostGlobal' } }).shippable
    ).toBe(false);
  });

  test('a variable read from the vars object is shippable', () => {
    expect(compile(ce.parse('x + a'), { vars: { a: '_.a' } }).shippable).toBe(
      true
    );
  });
});

describe('with a pool (CE-426, CE-428)', () => {
  let pool: KernelPool;
  let runs = 0;
  const engine = new ComputeEngine();

  beforeAll(async () => {
    pool = createKernelPool({
      create: () => {
        const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
        return {
          postMessage: (m: unknown, transfer?: ArrayBuffer[]) => {
            if ((m as { type?: string }).type === 'run') runs++;
            w.postMessage(m, transfer ?? []);
          },
          terminate: () => w.terminate(),
          on: (event, handler) => w.on(event as 'message', handler),
        };
      },
      size: 1,
    });
    engine.workers = pool;
    await pool.prewarm();
  }, 60_000);

  afterAll(() => pool.dispose());

  test('a large batch of a shippable result goes to the pool', async () => {
    const r = compile(engine.parse('x^2 - x'));
    expect(r.willUsePool!(100_000)).toBe(true);
    const before = runs;
    const xs = samples(100_000);
    const res = await r.broadcastAsync!({ x: xs });
    expect(res.done).toBe(100_000);
    expect(res.route).toBe('pool');
    expect(res.reason).toBeUndefined();
    expect(runs).toBeGreaterThan(before);
    expect(res.out[0]).toBe(xs[0] ** 2 - xs[0]);
  }, 30_000);

  test('`inline: false` still runs a batch that goes to the pool', async () => {
    const r = compile(engine.parse('3x'));
    const res = await r.broadcastAsync!(
      { x: samples(50_000) },
      { inline: false }
    );
    expect(res.done).toBe(50_000);
    expect(res.route).toBe('pool');
    expect(res.reason).toBeUndefined();
  }, 30_000);

  test('a small batch stays on the calling thread: below the threshold', async () => {
    const r = compile(engine.parse('x + 1'));
    expect(r.willUsePool!(100)).toBe(false);
    const before = runs;
    const res = await r.broadcastAsync!({ x: samples(100) });
    expect(res.done).toBe(100);
    expect(res.route).toBe('calling-thread');
    expect(res.reason).toBe('below-threshold');
    expect(runs).toBe(before);
  });

  test('`inline: false` refuses a small batch: no cell done, nothing sent', async () => {
    const r = compile(engine.parse('x + 2'));
    const before = runs;
    const out = new Float64Array(100).fill(-7);
    const res = await r.broadcastAsync!(
      { x: samples(100) },
      { inline: false, out }
    );
    expect(res.done).toBe(0);
    expect(res.route).toBe('calling-thread');
    expect(res.reason).toBe('below-threshold');
    expect(out[0]).toBe(-7);
    expect(runs).toBe(before);
    // A refused batch did not calibrate the threshold.
    expect(r.willUsePool!(20_000)).toBe(true);
    expect(r.willUsePool!(19_999)).toBe(false);
  });

  test('a result that is not shippable stays on the calling thread', async () => {
    const r = compile(engine.box(['Add', 'x', ['Random']]));
    expect(r.shippable).toBe(false);
    expect(r.willUsePool!(100_000)).toBe(false);
    const before = runs;
    const res = await r.broadcastAsync!({ x: samples(30_000) });
    expect(res.done).toBe(30_000);
    expect(res.route).toBe('calling-thread');
    expect(res.reason).toBe('not-shippable');
    const refused = await r.broadcastAsync!(
      { x: samples(30_000) },
      { inline: false }
    );
    expect(refused.done).toBe(0);
    expect(refused.reason).toBe('not-shippable');
    expect(runs).toBe(before);
  });
});

describe('a pool that cannot take the batch (CE-428)', () => {
  test('a worker factory that throws: the pool declines', async () => {
    const pool = createKernelPool({
      create: () => {
        throw new Error('no workers on this page');
      },
      size: 1,
    });
    const own = new ComputeEngine({ workers: pool });
    const r = compile(own.parse('x^2'));
    expect(r.willUsePool!(30_000)).toBe(true);
    const xs = samples(30_000);
    const res = await r.broadcastAsync!({ x: xs });
    expect(res.done).toBe(30_000);
    expect(res.route).toBe('calling-thread');
    expect(res.reason).toBe('pool-declined');
    expect(res.out[1]).toBe(xs[1] ** 2);
    // With `inline: false`, the cells the workers did not do stay undone.
    // A result of its own: the inline run above can record a calibration of
    // `r` (when its 30,000 cells took 2 ms or more, on a loaded machine),
    // which raises the threshold of `r` above 30,000 cells, and the call
    // then stays off the pool as `below-threshold`.
    const fresh = compile(own.parse('x^2'));
    const out = new Float64Array(30_000).fill(-7);
    const refused = await fresh.broadcastAsync!(
      { x: xs },
      { inline: false, out }
    );
    expect(refused.done).toBe(0);
    expect(refused.route).toBe('pool');
    expect(refused.reason).toBe('pool-declined');
    expect(out[0]).toBe(-7);
    pool.dispose();
  });

  test('workers that hold another runtime version: the pool is unusable', async () => {
    const pool = createKernelPool({
      create: () => {
        const handlers: ((m: unknown) => void)[] = [];
        setTimeout(
          () =>
            handlers.forEach((h) =>
              h({
                type: 'ready',
                runtimeVersion: -1,
                intervalRuntimeVersion: -1,
              })
            ),
          0
        );
        return {
          postMessage: () => undefined,
          terminate: () => undefined,
          on: (event: string, handler: (m: unknown) => void) => {
            if (event === 'message') handlers.push(handler);
          },
        };
      },
      size: 1,
    });
    await pool.prewarm();
    const own = new ComputeEngine({ workers: pool });
    const r = compile(own.parse('x^2'));
    expect(r.willUsePool!(100_000)).toBe(false);
    const res = await r.broadcastAsync!({ x: samples(30_000) });
    expect(res.done).toBe(30_000);
    expect(res.route).toBe('calling-thread');
    expect(res.reason).toBe('pool-unusable');
    pool.dispose();
  });

  // CE-434 (Tycho, 0.166.0): a task that waited for a worker that never
  // posts `ready` (and fails only when it gets a message) never settled,
  // because the watchdog of the deadline is armed only when a task is sent.
  test('workers that never become ready: the deadline settles the batch', async () => {
    const pool = createKernelPool({
      create: () => {
        const errors: ((e: unknown) => void)[] = [];
        return {
          postMessage: () => {
            setTimeout(() => errors.forEach((h) => h({ message: 'no' })), 0);
          },
          terminate: () => undefined,
          addEventListener: (event: string, h: (e: unknown) => void) => {
            if (event === 'error') errors.push(h);
          },
        };
      },
      size: 2,
      cancelGrace: 10,
    });
    const own = new ComputeEngine({ workers: pool });
    const r = compile(own.parse('x^2'));
    const xs = samples(40_000);
    expect(r.willUsePool!(xs.length)).toBe(true);
    const start = Date.now();
    const res = await r.broadcastAsync!(
      { x: xs },
      { deadline: 200, inline: false }
    );
    expect(Date.now() - start).toBeLessThan(2_000);
    expect(res.done).toBe(0);
    pool.dispose();
  });
});
