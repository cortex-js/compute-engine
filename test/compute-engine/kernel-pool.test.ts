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
    // The first slice ran before the first yield; nothing after the abort.
    expect(done).toBe(1000);
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
    expect(done).toBeGreaterThan(0);
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
