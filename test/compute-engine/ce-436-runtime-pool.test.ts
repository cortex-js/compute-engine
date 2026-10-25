import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ComputeEngine, compile } from '../../src/compute-engine';
import {
  createJavaScriptRuntime,
  createKernelPool,
  type KernelPool,
  type StoredJavaScript,
} from '../../src/runtime';

// CE-436 (Tycho row 445): a kernel loaded through the runtime entry, with no
// engine, runs its batches on a kernel pool. The runtime entry exports
// `createKernelPool`, and `runtime.loadBroadcastAsync(stored, { workers })`
// is the `broadcastAsync()` of the compilation result. The workers are Node
// `worker_threads` running the worker entry from source through the tsx
// loader, as in `kernel-pool.test.ts`.

const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));

function samples(n: number): Float64Array {
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = -5 + (10 * i) / (n - 1);
  return xs;
}

/** The compilation result as a host stores it: the JSON of its fields. */
function stored(latex: string): StoredJavaScript {
  const r = compile(new ComputeEngine().parse(latex));
  return JSON.parse(JSON.stringify(r)) as StoredJavaScript;
}

describe('loadBroadcastAsync without a pool', () => {
  test('a batch runs on the calling thread', async () => {
    const run = createJavaScriptRuntime().loadBroadcastAsync(stored('x^2+1'));
    expect(run.shippable).toBe(true);
    expect(run.willUsePool(100_000)).toBe(false);
    const xs = samples(1000);
    const res = await run({ x: xs });
    expect(res.done).toBe(1000);
    expect(res.route).toBe('calling-thread');
    expect(res.reason).toBe('no-pool');
    expect(res.out[3]).toBe(xs[3] ** 2 + 1);
  });

  test('`inline: false` evaluates no cell', async () => {
    const run = createJavaScriptRuntime().loadBroadcastAsync(stored('x^2+1'));
    const res = await run({ x: samples(10) }, { inline: false });
    expect(res.done).toBe(0);
    expect(res.reason).toBe('no-pool');
  });

  test('code that draws from the random stream is not shippable', () => {
    const run = createJavaScriptRuntime().loadBroadcastAsync(
      stored('x + \\operatorname{Random}()')
    );
    expect(run.shippable).toBe(false);
  });

  test('a stored result with another runtime version is refused', () => {
    const s = { ...stored('x+1'), runtimeVersion: '0.0.0' };
    expect(() => createJavaScriptRuntime().loadBroadcastAsync(s)).toThrow();
  });

  test('stored code without `shippable: true` is not shippable', () => {
    const { shippable: _, ...s } = stored('x+1');
    expect(createJavaScriptRuntime().loadBroadcastAsync(s).shippable).toBe(
      false
    );
  });

  test('`workers` that is not a kernel pool throws', () => {
    expect(() =>
      createJavaScriptRuntime().loadBroadcastAsync(stored('x+1'), {
        workers: {} as KernelPool,
      })
    ).toThrow(TypeError);
  });

  test('a change to the stored object after the load does not reach it', async () => {
    const s = stored('x+1');
    const run = createJavaScriptRuntime().loadBroadcastAsync(s);
    s.code = s.code.replace('+ 1', '+ 100');
    s.broadcastOutputs = 3;
    const res = await run({ x: new Float64Array([2]) });
    expect(Array.from(res.out)).toEqual([3]);
  });
});

describe('loadBroadcastAsync with a pool', () => {
  let pool: KernelPool;

  beforeAll(async () => {
    pool = createKernelPool({
      create: () => {
        const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
        return {
          postMessage: (m: unknown, transfer?: ArrayBuffer[]) =>
            w.postMessage(m, transfer ?? []),
          terminate: () => w.terminate(),
          on: (event, handler) => w.on(event as 'message', handler),
        };
      },
      size: 2,
    });
    await pool.prewarm();
  }, 60_000);

  afterAll(() => pool.dispose());

  test('a large batch goes to the pool, and writes into `out`', async () => {
    const run = createJavaScriptRuntime().loadBroadcastAsync(stored('x^2-x'), {
      workers: pool,
    });
    expect(run.willUsePool(100_000)).toBe(true);
    const xs = samples(100_000);
    const out = new Float64Array(100_000);
    const res = await run({ x: xs }, { out, deadline: 20_000 });
    expect(res.done).toBe(100_000);
    expect(res.route).toBe('pool');
    expect(res.out).toBe(out);
    expect(out[0]).toBe(xs[0] ** 2 - xs[0]);
    expect(out[99_999]).toBe(xs[99_999] ** 2 - xs[99_999]);
  }, 30_000);

  test('a small batch stays on the calling thread', async () => {
    const run = createJavaScriptRuntime().loadBroadcastAsync(stored('2x'), {
      workers: pool,
    });
    const res = await run({ x: samples(100) });
    expect(res.done).toBe(100);
    expect(res.route).toBe('calling-thread');
    expect(res.reason).toBe('below-threshold');
  });
});
