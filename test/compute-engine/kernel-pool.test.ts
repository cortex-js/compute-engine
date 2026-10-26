import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ComputeEngine,
  compile,
  createKernelPool,
  defaultPoolSize,
  INTERVAL_KIND,
  type KernelPool,
} from '../../src/compute-engine';
import { createIntervalRuntime } from '../../src/interval';
import { createJavaScriptRuntime } from '../../src/runtime';
import { RUNTIME_VERSION } from '../../src/compute-engine/compilation/javascript-runtime';
import { INTERVAL_RUNTIME_VERSION } from '../../src/compute-engine/interval';
import { fitSlicePool } from '../../src/compute-engine/kernel-pool';
import type { WireFitProblem } from '../../src/compute-engine/kernel-protocol';

// The worker pool behind `result.broadcastAsync()` (design:
// docs/plans/2026-10-20-worker-kernel-pool.md, sections 5.1 and 5.4;
// src/compute-engine/kernel-pool.ts, src/kernel-worker.ts). The workers are
// Node `worker_threads` running the worker entry from source through the tsx
// loader. Two workers at most: the shared box caps test workers.

const ce = new ComputeEngine();

// The worker entry, from source: the tsx loader of the worker thread compiles
// it. (A path string is refused by `Worker` for a `.ts` file; a URL is not.)
const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));

/** `n` interval cells tiling `[lo, hi]`. */
function cells(n: number, lo = -8, hi = 8): Float64Array {
  const xs = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    xs[2 * i] = lo + ((hi - lo) * i) / n;
    xs[2 * i + 1] = lo + ((hi - lo) * (i + 1)) / n;
  }
  return xs;
}

function samples(n: number, lo = -5, hi = 5): Float64Array {
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = lo + ((hi - lo) * i) / (n - 1);
  return xs;
}

const expectSame = (a: Float64Array, b: Float64Array): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++)
    if (!Object.is(a[i], b[i]))
      throw new Error(`cell value ${i}: ${a[i]} on the pool, ${b[i]} inline`);
};

describe('broadcastAsync without a pool', () => {
  test('gives the result of broadcast, in slices', async () => {
    const r = compile(ce.parse('\\sin(x^2)+\\cos(3x)/(1+x^2)'), {
      to: 'interval-js',
    });
    const xs = cells(5000);
    const { out, done } = await r.broadcastAsync!({ x: xs }, { chunk: 1000 });
    expect(done).toBe(5000);
    expectSame(out, r.broadcast!({ x: xs }));
  });

  test('a caller-owned output array is used', async () => {
    const r = compile(ce.parse('2x'));
    const out = new Float64Array(3);
    const back = await r.broadcastAsync!(
      { x: new Float64Array([1, 2, 3]) },
      { out }
    );
    expect(back.out).toBe(out);
    expect(Array.from(out)).toEqual([2, 4, 6]);
    expect(back.done).toBe(3);
  });

  test('an aborted signal stops the batch between slices', async () => {
    const r = compile(ce.parse('x^2'));
    const ctl = new AbortController();
    const p = r.broadcastAsync!(
      { x: samples(10_000) },
      { chunk: 1000, signal: ctl.signal }
    );
    ctl.abort();
    const { done } = await p;
    // The batch yields to the event loop before its first slice, so the
    // abort right after the call stops it before any cell.
    expect(done).toBe(0);
  });

  test('a deadline that has passed stops the loop before its first cell', async () => {
    const r = compile(ce.parse('\\sin(x)'));
    const { done, out } = await r.broadcastAsync!(
      { x: samples(100_000) },
      { deadline: -1 }
    );
    // The loop checks the clock at the first cell and every 1024 cells.
    expect(done).toBe(0);
    expect(out[0]).toBe(0);
  });

  test('a short deadline gives a valid prefix and leaves the rest untouched', async () => {
    const r = compile(ce.parse('\\sin(x)'));
    const out = new Float64Array(200_000).fill(-7);
    const { done } = await r.broadcastAsync!(
      { x: samples(200_000) },
      { deadline: 2, chunk: 4096, out }
    );
    // `done` can be 0: the loop checks the clock at its first cell, and on a
    // loaded machine 2 ms can pass before that check (the test above). What
    // holds in every case is that the cells before `done` are computed and
    // the cells after it are untouched.
    expect(done).toBeGreaterThanOrEqual(0);
    expect(done).toBeLessThanOrEqual(200_000);
    for (let i = 0; i < done; i++) expect(out[i]).not.toBe(-7);
    for (let i = done; i < 200_000; i += 997) expect(out[i]).toBe(-7);
  });

  test('a chunk that is not a positive integer throws', async () => {
    const r = compile(ce.parse('2x'));
    await expect(
      r.broadcastAsync!({ x: new Float64Array(10) }, { chunk: NaN })
    ).rejects.toThrow(/positive integer/);
    await expect(
      r.broadcastAsync!({ x: new Float64Array(10) }, { chunk: 1.5 })
    ).rejects.toThrow(/positive integer/);
    await expect(
      r.broadcastAsync!({ x: new Float64Array(10) }, { deadline: NaN })
    ).rejects.toThrow(/finite number/);
  });

  test('the grid layout and a per-batch scalar', async () => {
    const r = compile(ce.parse('x + 10 y + 100 a'));
    const { out, done } = await r.broadcastAsync!(
      { x: new Float64Array([1, 2]), y: new Float64Array([0, 1]), a: 1 },
      { layout: 'grid' }
    );
    expect(done).toBe(4);
    expect(Array.from(out)).toEqual([101, 102, 111, 112]);
  });
});

describe('the kernel pool on worker threads', () => {
  let pool: KernelPool;
  const engine = new ComputeEngine();

  beforeAll(async () => {
    pool = createKernelPool({
      create: () => new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] }),
      size: 2,
    });
    engine.workers = pool;
    await pool.prewarm();
  }, 60_000);

  afterAll(() => {
    pool.dispose();
  });

  test('the default pool size is between 1 and 8', () => {
    const n = defaultPoolSize();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(8);
  });

  test('an interval batch over the pool gives the inline result, cell for cell', async () => {
    const r = compile(engine.parse('\\sin(x^2)+\\cos(3x)/(1+x^2)'), {
      to: 'interval-js',
    });
    const xs = cells(60_000);
    const { out, done } = await r.broadcastAsync!({ x: xs });
    expect(done).toBe(60_000);
    expectSame(out, r.broadcast!({ x: xs }));
    // Every kind the expression gives on this range is present.
    const kinds = new Set<number>();
    for (let i = 2; i < out.length; i += 3) kinds.add(out[i]);
    expect(kinds.has(INTERVAL_KIND.interval)).toBe(true);
  }, 30_000);

  test('a javascript batch over a grid with a scalar, through the pool', async () => {
    const r = compile(engine.parse('\\sin(x)\\cos(y) + a'));
    const gx = samples(300, -3, 3);
    const gy = samples(300, -2, 2);
    const inline = r.broadcast!({ x: gx, y: gy, a: 0.5 }, { layout: 'grid' });
    const { out, done } = await r.broadcastAsync!(
      { x: gx, y: gy, a: 0.5 },
      { layout: 'grid' }
    );
    expect(done).toBe(90_000);
    expectSame(out, inline);
  }, 30_000);

  test('a small batch stays inline and gives the same result', async () => {
    const r = compile(engine.parse('x^3 - x'), { to: 'interval-js' });
    const xs = cells(100);
    const { out, done } = await r.broadcastAsync!({ x: xs });
    expect(done).toBe(100);
    expectSame(out, r.broadcast!({ x: xs }));
  });

  test('a deadline that has passed gives a partial result', async () => {
    const r = compile(engine.parse('\\sin(x)'), { to: 'interval-js' });
    const { done } = await r.broadcastAsync!(
      { x: cells(200_000) },
      { deadline: -1 }
    );
    expect(done).toBe(0);
  }, 30_000);

  test('a result that draws randomness or names a host global never ships', async () => {
    let created = 0;
    const counting = createKernelPool({
      create: () => {
        created++;
        return new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
      },
      size: 1,
    });
    const own = new ComputeEngine({ workers: counting });
    const xs = samples(100_000);
    // `Random` follows the engine's random stream and entropy handler.
    const random = compile(own.box(['Add', 'x', ['Random']]));
    const a = await random.broadcastAsync!({ x: xs });
    expect(a.done).toBe(100_000);
    // A `vars` mapping to a host global exists only on this thread.
    const host = compile(own.parse('x + a'), { vars: { a: 'hostGlobal' } });
    (globalThis as { hostGlobal?: number }).hostGlobal = 3;
    try {
      const b = await host.broadcastAsync!({ x: xs });
      expect(b.done).toBe(100_000);
      expect(b.out[0]).toBe(xs[0] + 3);
    } finally {
      delete (globalThis as { hostGlobal?: number }).hostGlobal;
    }
    expect(created).toBe(0);
    // A plain result does ship.
    const plain = compile(own.parse('x^2'));
    const c = await plain.broadcastAsync!({ x: xs });
    expect(c.done).toBe(100_000);
    expect(created).toBe(1);
    counting.dispose();
  }, 30_000);

  test('a vars mapping that reads the vars object still ships', async () => {
    let created = 0;
    const counting = createKernelPool({
      create: () => {
        created++;
        return new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
      },
      size: 1,
    });
    const own = new ComputeEngine({ workers: counting });
    const r = compile(own.parse('x + a'), { vars: { a: '_.a' } });
    const { done } = await r.broadcastAsync!({ x: samples(100_000), a: 1 });
    expect(done).toBe(100_000);
    expect(created).toBe(1);
    counting.dispose();
  }, 30_000);

  test('a shared input ships once per worker per call; a stride of 2 lands in place', async () => {
    // Count the `run` messages, those that carry the shared inputs, and the
    // `release` messages, on the way to each worker.
    let runs = 0;
    let shippedShared = 0;
    let releases = 0;
    const counting = createKernelPool({
      create: () => {
        const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
        return {
          postMessage: (m: unknown, transfer?: ArrayBuffer[]) => {
            const type = (m as { type?: string }).type;
            if (type === 'run') {
              runs++;
              if ((m as { shared?: unknown }).shared !== undefined)
                shippedShared++;
            }
            if (type === 'release') releases++;
            w.postMessage(m, transfer ?? []);
          },
          terminate: () => w.terminate(),
          on: (event, handler) => w.on(event as 'message', handler),
        };
      },
      size: 2,
    });
    const own = new ComputeEngine({ workers: counting });
    own.declare('F', 'list<number>');
    own.declare('i', 'integer');
    const r = compile(own.parse('(F_{i+1} - F_i, 2F_{i+1})'));
    expect(r.broadcastOutputs).toBe(2);
    const F = new Float64Array(5000);
    for (let n = 0; n < 5000; n++) F[n] = Math.sin(n) * 10 + n / 7;
    const i = new Float64Array(40_000);
    for (let c = 0; c < 40_000; c++) i[c] = c % 4999;
    const inline = r.broadcast!({ i, F });
    const { out, done } = await r.broadcastAsync!({ i, F }, { chunk: 4000 });
    expect(done).toBe(40_000);
    expect(out.length).toBe(80_000);
    expectSame(out, inline);
    // Ten tasks over two workers: the shared array went to each worker
    // once, with its first task, and each worker was told to release it.
    expect(runs).toBe(10);
    expect(shippedShared).toBe(2);
    expect(releases).toBe(2);
    // A second call is a new batch: shipped once more to each worker.
    const again = await r.broadcastAsync!({ i, F }, { chunk: 4000 });
    expectSame(again.out, inline);
    expect(runs).toBe(20);
    expect(shippedShared).toBe(4);
    expect(releases).toBe(4);
    // The caller's arrays are untouched (the pool sends copies).
    expect(F[1]).toBe(Math.sin(1) * 10 + 1 / 7);
    counting.dispose();
  }, 60_000);

  test('a shared input that structured clone cannot copy does not block the pool', async () => {
    // Structured clone cannot copy a Proxy (a Vue `reactive()` array), nor
    // an array with a function-valued property. The pool copies a plain
    // shared array before it sends it, so the first two calls run on the
    // workers. An element that is a function still fails the clone: the
    // task is rejected and the call finishes inline, it does not wait
    // forever.
    engine.declare('G', 'list<number>');
    engine.declare('k', 'integer');
    const r = compile(engine.parse('G_{k+1}'));
    const k = new Float64Array(40_000);
    for (let c = 0; c < 40_000; c++) k[c] = c % 4;
    const expected = r.broadcast!({ k, G: [1, 2, 3, 4, 5] });
    const proxy = new Proxy([1, 2, 3, 4, 5], {});
    const a = await r.broadcastAsync!({ k, G: proxy }, { chunk: 4000 });
    expect(a.done).toBe(40_000);
    expectSame(a.out, expected);
    const withMeta = [1, 2, 3, 4, 5];
    (withMeta as unknown as { meta: () => number }).meta = () => 0;
    const b = await r.broadcastAsync!({ k, G: withMeta }, { chunk: 4000 });
    expect(b.done).toBe(40_000);
    expectSame(b.out, expected);
    const withFunction = [1, 2, 3, 4, () => 0] as unknown as number[];
    const c = await r.broadcastAsync!({ k, G: withFunction }, { chunk: 4000 });
    expectSame(c.out, r.broadcast!({ k, G: withFunction }));
  }, 20_000);

  test('an aborted batch reports what was done', async () => {
    const r = compile(engine.parse('\\sin(x)'), { to: 'interval-js' });
    const ctl = new AbortController();
    const p = r.broadcastAsync!({ x: cells(200_000) }, { signal: ctl.signal });
    ctl.abort();
    const { done } = await p;
    expect(done).toBe(0);
  }, 30_000);

  test('a disposed pool is replaced by inline evaluation, then recreated on use', async () => {
    const r = compile(engine.parse('x^2'), { to: 'interval-js' });
    const xs = cells(30_000);
    pool.dispose();
    // Disposed: the pool rejects, the slices run inline, the result is right.
    const after = await r.broadcastAsync!({ x: xs });
    expect(after.done).toBe(30_000);
    expectSame(after.out, r.broadcast!({ x: xs }));
    // The batch above may have created the workers of the disposed pool
    // again (a batch after `dispose()` does): terminate them, or they keep
    // the test process alive.
    pool.dispose();
    // A fresh pool for the remaining tests and `afterAll`.
    pool = createKernelPool({
      create: () => new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] }),
      size: 2,
    });
    engine.workers = pool;
    const again = await r.broadcastAsync!({ x: xs });
    expect(again.done).toBe(30_000);
    expectSame(again.out, r.broadcast!({ x: xs }));
  }, 60_000);
});

describe('cancelling the task that a worker runs', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Every pool of this block is disposed after its test, also when an
  // assertion failed first: a live worker thread keeps jest from exiting.
  const pools: KernelPool[] = [];
  const newPool = (
    options: Parameters<typeof createKernelPool>[0]
  ): KernelPool => {
    const pool = createKernelPool(options);
    pools.push(pool);
    return pool;
  };
  afterEach(() => {
    for (const pool of pools.splice(0)) pool.dispose();
  });

  /** Wait until `cond()` holds, polling every 5 ms. */
  async function until(cond: () => boolean): Promise<void> {
    while (!cond()) await sleep(5);
  }

  /** About 20 µs per cell: a slice of 100,000 cells runs for about 2 s. */
  const HEAVY = '\\sum_{k=1}^{2000}\\sin(kx)';

  /**
   * A pool of one worker thread, each worker wrapped to count the workers
   * created and terminated, the `run` tasks sent, and the `result` answers
   * (with the time each arrived). With `stripCancel`, the cancel flag is
   * removed from each task: the worker then runs every task to its end, as
   * a browser worker does on a page with no `SharedArrayBuffer`.
   */
  function watchedPool(options: {
    stripCancel?: boolean;
    cancelGrace?: number;
  }) {
    const log = {
      created: 0,
      terminated: 0,
      runs: 0,
      results: [] as { job: number; done: number; at: number }[],
    };
    const pool = newPool({
      size: 1,
      cancelGrace: options.cancelGrace,
      create: () => {
        log.created++;
        const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
        w.on('message', (m: { type: string; job: number; done: number }) => {
          if (m.type === 'result')
            log.results.push({ job: m.job, done: m.done, at: Date.now() });
        });
        return {
          postMessage: (m: unknown, transfer?: ArrayBuffer[]) => {
            let sent = m as { type: string; cancel?: Int32Array };
            if (sent.type === 'run') {
              log.runs++;
              if (options.stripCancel) {
                const { cancel: _cancel, ...rest } = sent;
                sent = rest;
              }
            }
            w.postMessage(sent, transfer ?? []);
          },
          terminate: () => {
            log.terminated++;
            return w.terminate();
          },
          on: (event, handler) => w.on(event as 'message', handler),
        };
      },
    });
    return { pool, log };
  }

  test('an abort stops the slice that the worker runs, at its next check of the cancel flag', async () => {
    // A grace period longer than the slice: the worker is never terminated,
    // so an early answer can only come from the cancel flag.
    const { pool, log } = watchedPool({ cancelGrace: 60_000 });
    const own = new ComputeEngine({ workers: pool });
    await pool.prewarm();
    const r = compile(own.parse(HEAVY));
    const n = 100_000;
    const ctl = new AbortController();
    const p = r.broadcastAsync!(
      { x: samples(n, 0, 1) },
      { signal: ctl.signal }
    );
    await until(() => log.runs === 1);
    await sleep(50);
    const t0 = Date.now();
    ctl.abort();
    // The caller has its answer at once.
    expect((await p).done).toBe(0);
    // The worker answered early, with the cells it did before it read the
    // flag (the pool drops that answer).
    await until(() => log.results.length === 1);
    expect(log.results[0].done).toBeLessThan(n);
    expect(log.results[0].at - t0).toBeLessThan(1000);
    expect(log.terminated).toBe(0);
    expect(log.created).toBe(1);
    // The same worker takes the next batch.
    const q = compile(own.parse('x^2'));
    const xs = samples(30_000);
    const again = await q.broadcastAsync!({ x: xs });
    expect(again.done).toBe(30_000);
    expectSame(again.out, q.broadcast!({ x: xs }));
    expect(log.runs).toBe(2);
    expect(log.created).toBe(1);
    pool.dispose();
  }, 60_000);

  test('a worker that does not stop is terminated after the grace period, and the task that waited for it runs on a new worker', async () => {
    const { pool, log } = watchedPool({ stripCancel: true, cancelGrace: 100 });
    const own = new ComputeEngine({ workers: pool });
    await pool.prewarm();
    const heavy = compile(own.parse(HEAVY));
    const light = compile(own.parse('x^2 + 1'));
    const ctl = new AbortController();
    const p = heavy.broadcastAsync!(
      { x: samples(100_000, 0, 1) },
      { signal: ctl.signal }
    );
    await until(() => log.runs === 1);
    // A second batch, with no signal, waits behind the first one on the
    // only worker.
    const xs = samples(30_000);
    const q = light.broadcastAsync!({ x: xs });
    await sleep(20);
    ctl.abort();
    expect((await p).done).toBe(0);
    const { out, done } = await q;
    expect(done).toBe(30_000);
    expectSame(out, light.broadcast!({ x: xs }));
    // The first worker was terminated before it answered, and the second
    // batch ran on its replacement, which was sent the kernel again.
    expect(log.terminated).toBe(1);
    expect(log.created).toBe(2);
    expect(log.runs).toBe(2);
    expect(log.results.length).toBe(1);
    expect(log.results[0].done).toBe(30_000);
    // A later batch runs on the pool.
    const again = await heavy.broadcastAsync!({ x: samples(20_000, 0, 1) }, {});
    expect(again.done).toBe(20_000);
    expect(log.runs).toBe(3);
    pool.dispose();
  }, 60_000);

  test('a worker that does not answer by the deadline is terminated after the grace period', async () => {
    // A worker that starts and then never answers a task.
    let created = 0;
    let terminated = 0;
    const pool = newPool({
      size: 1,
      cancelGrace: 50,
      create: () => {
        created++;
        const handlers: ((m: unknown) => void)[] = [];
        setTimeout(
          () =>
            handlers.forEach((h) =>
              h({
                type: 'ready',
                runtimeVersion: RUNTIME_VERSION,
                intervalRuntimeVersion: INTERVAL_RUNTIME_VERSION,
              })
            ),
          0
        );
        return {
          postMessage: () => undefined,
          terminate: () => {
            terminated++;
          },
          on: (event: string, handler: (m: unknown) => void) => {
            if (event === 'message') handlers.push(handler);
          },
        };
      },
    });
    const own = new ComputeEngine({ workers: pool });
    const r = compile(own.parse('x^2'));
    const t0 = Date.now();
    const { done } = await r.broadcastAsync!(
      { x: samples(30_000) },
      { deadline: 100 }
    );
    // Settled with no cells after the deadline and the grace period.
    expect(done).toBe(0);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
    expect(terminated).toBe(1);
    // No task waited for the worker: the replacement is created on the
    // next batch only.
    expect(created).toBe(1);
    pool.dispose();
  }, 30_000);

  test('a grace period that is not a number of milliseconds throws', () => {
    const create = () => {
      throw new Error('not called');
    };
    expect(() => createKernelPool({ create, cancelGrace: -1 })).toThrow(
      /cancelGrace/
    );
    expect(() => createKernelPool({ create, cancelGrace: NaN })).toThrow(
      /cancelGrace/
    );
    // A finite value longer than the longest delay of `setTimeout()`.
    expect(() => createKernelPool({ create, cancelGrace: 2 ** 31 })).toThrow(
      /cancelGrace/
    );
    expect(() =>
      createKernelPool({ create, cancelGrace: Infinity }).dispose()
    ).not.toThrow();
  });

  /** A worker that reports ready after `readyAfter` ms, with this engine's
   * versions, and hands each message to `onMessage`. */
  function fakeWorker(
    onMessage: (
      m: { type: string; job?: number; id?: number; cancel?: unknown },
      post: (m: unknown) => void
    ) => void,
    readyAfter = 0
  ) {
    const handlers: ((m: unknown) => void)[] = [];
    const post = (m: unknown) =>
      setTimeout(() => handlers.forEach((h) => h(m)), 0);
    setTimeout(
      () =>
        post({
          type: 'ready',
          runtimeVersion: RUNTIME_VERSION,
          intervalRuntimeVersion: INTERVAL_RUNTIME_VERSION,
        }),
      readyAfter
    );
    return {
      postMessage: (m: unknown) => onMessage(m as never, post),
      terminate: () => undefined,
      on: (event: string, handler: (m: unknown) => void) => {
        if (event === 'message') handlers.push(handler);
      },
    };
  }

  test('the slices of a batch whose deadline passed before they were sent are not sent, and no worker is replaced', async () => {
    // The worker is ready long after the deadline and the grace period:
    // each slice is settled on this thread when its turn comes.
    let created = 0;
    let runs = 0;
    const pool = newPool({
      size: 1,
      cancelGrace: 20,
      create: () => {
        created++;
        return fakeWorker((m) => {
          if (m.type === 'run') runs++;
        }, 200);
      },
    });
    const own = new ComputeEngine({ workers: pool });
    const r = compile(own.parse('x^2'));
    const { done } = await r.broadcastAsync!(
      { x: samples(30_000) },
      { deadline: 10, chunk: 5000 }
    );
    expect(done).toBe(0);
    expect(runs).toBe(0);
    expect(created).toBe(1);
    pool.dispose();
  }, 30_000);

  test('a heavy kernel stops at its deadline and keeps the cells it did', async () => {
    // About 1 ms per cell: the cell loop reads the clock every 1024 cells,
    // about 1 s apart, much later than the deadline and the grace period.
    // The worker reads it with the cancel check, every 64 cells, and
    // answers with the cells done before the pool replaces it.
    const { pool, log } = watchedPool({ cancelGrace: 400 });
    const own = new ComputeEngine({ workers: pool });
    await pool.prewarm();
    const r = compile(own.parse('\\sum_{k=1}^{100000}\\sin(kx)'));
    const xs = samples(20_000, 0, 1);
    const { out, done } = await r.broadcastAsync!({ x: xs }, { deadline: 200 });
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThan(20_000);
    expect(log.terminated).toBe(0);
    expectSame(
      out.subarray(0, done),
      r.broadcast!({ x: xs.subarray(0, done) })
    );
    pool.dispose();
  }, 60_000);

  test('a host that cannot send the cancel flag still runs batches on the worker', async () => {
    // A `create()` adapter that throws on a message carrying the flag, as
    // one that sends the messages across a process boundary would.
    let runs = 0;
    let refused = 0;
    const pool = newPool({
      size: 1,
      create: () => {
        const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
        return {
          postMessage: (m: unknown, transfer?: ArrayBuffer[]) => {
            const sent = m as { type: string; cancel?: unknown };
            if (sent.cancel !== undefined) {
              refused++;
              throw new Error('DataCloneError: the flag cannot be cloned');
            }
            if (sent.type === 'run') runs++;
            w.postMessage(m, transfer ?? []);
          },
          terminate: () => w.terminate(),
          on: (event, handler) => w.on(event as 'message', handler),
        };
      },
    });
    const own = new ComputeEngine({ workers: pool });
    const r = compile(own.parse('x^2 - x'));
    const xs = samples(30_000);
    for (let k = 0; k < 2; k++) {
      const { out, done } = await r.broadcastAsync!({ x: xs });
      expect(done).toBe(30_000);
      expectSame(out, r.broadcast!({ x: xs }));
    }
    // The first task was sent again without the flag, and so was the
    // second one.
    expect(refused).toBe(1);
    expect(runs).toBe(2);
    pool.dispose();
  }, 60_000);

  test('a fit slice whose message cannot be sent is rejected, not left waiting', async () => {
    // Every `fit-run` post throws, with or without the flag: the slice is
    // rejected (its caller then solves it inline), and the worker takes the
    // next slice.
    let posts = 0;
    const pool = newPool({
      size: 1,
      create: () =>
        fakeWorker((m) => {
          if (m.type === 'fit-run') {
            posts++;
            throw new Error('DataCloneError');
          }
        }),
    });
    const fitPool = fitSlicePool(pool)!;
    const problem: WireFitProblem = {
      units: [],
      paramFresh: [],
      linearIdx: [],
      gridIdx: [0],
      lo: [],
      hi: [],
      start: [],
      phases: [],
    };
    const slice = () =>
      fitPool.runFitSlice(
        problem,
        new Float64Array([1, 2]),
        false,
        undefined,
        undefined,
        undefined
      );
    await expect(slice()).rejects.toThrow(/DataCloneError/);
    await expect(slice()).rejects.toThrow(/DataCloneError/);
    // Each slice was posted with the flag, then without it.
    expect(posts).toBe(4);
    pool.dispose();
  }, 30_000);
});

describe('the standalone runtimes rebuild stored results', () => {
  test('the interval runtime gives run() and broadcast() of the stored result', () => {
    const r = compile(ce.parse('\\sqrt{x} + \\cos(3x)'), { to: 'interval-js' });
    const stored = JSON.parse(
      JSON.stringify({
        runtimeVersion: r.runtimeVersion,
        code: r.code,
        preamble: r.preamble,
        preambleOnce: r.preambleOnce,
        preamblePerCall: r.preamblePerCall,
      })
    );
    const runtime = createIntervalRuntime();
    expect(runtime.runtimeVersion).toBe(r.runtimeVersion);
    const f = runtime.load(stored);
    expect(f({ x: { lo: 1, hi: 4 } })).toEqual(r.run({ x: { lo: 1, hi: 4 } }));
    expect(f({ x: { lo: -2, hi: -1 } })).toEqual({ kind: 'empty' });
    const xs = cells(500, 0, 10);
    expectSame(
      runtime.loadBroadcast(stored)({ x: xs }),
      r.broadcast!({ x: xs })
    );
  });

  test('the interval runtime refuses another version or no version', () => {
    const runtime = createIntervalRuntime();
    expect(() => runtime.load({ code: '_.x' })).toThrow(/runtimeVersion/);
    expect(() =>
      runtime.load({ code: '_.x', runtimeVersion: 'not-this-one' })
    ).toThrow(/compiled for runtime not-this-one/);
  });

  test('the JavaScript runtime gives broadcast() of the stored result', () => {
    const r = compile(ce.parse('x^3 - 2x + a'));
    const runtime = createJavaScriptRuntime({});
    const stored = JSON.parse(JSON.stringify(r));
    const xs = samples(1000);
    expectSame(
      runtime.loadBroadcast(stored)({ x: xs, a: 2 }),
      r.broadcast!({ x: xs, a: 2 })
    );
    const out = new Float64Array(10);
    const n = runtime.loadBroadcastSlice(stored)(
      { x: xs, a: 2 },
      undefined,
      out,
      { from: 100, to: 110 }
    );
    expect(n).toBe(10);
    expect(out[0]).toBe(r.run({ x: xs[100], a: 2 }));
  });

  test('the JavaScript runtime refuses a lambda for broadcast', () => {
    const r = compile(ce.parse('x \\mapsto 2x'));
    const runtime = createJavaScriptRuntime({});
    expect(() => runtime.loadBroadcast(JSON.parse(JSON.stringify(r)))).toThrow(
      /lambda/
    );
  });
});
