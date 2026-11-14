import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ComputeEngine,
  compile,
  createKernelPool,
  type KernelPool,
} from '../../src/compute-engine';
import { RUNTIME_VERSION } from '../../src/compute-engine/compilation/javascript-runtime';
import {
  callPool,
  type CallPool,
  type StoredResult,
} from '../../src/compute-engine/kernel-pool';

// CE-1163, step 1: the `call` task of the kernel pool. A stored `javascript`
// lambda runs once on a worker with positional arguments, and the pool
// returns its value (`runCall`, reached through `callPool()`; design:
// docs/plans/2026-11-08-ce1163-run-async-parallel-for.md, sections 4 and 8).
// The workers are Node `worker_threads` running the worker entry from source
// through the tsx loader, as in kernel-pool.test.ts. Two workers at most:
// the shared box caps test workers.

const ce = new ComputeEngine();

const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));

const tag = (v: unknown): string => Object.prototype.toString.call(v);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until `cond()` holds, polling every 5 ms. */
async function until(cond: () => boolean): Promise<void> {
  while (!cond()) await sleep(5);
}

/** A stored lambda written by hand: the pool reads plain data, so it runs
 * what the compiler would emit for a function with these parameters. */
function storedLambda(code: string): StoredResult {
  return { code, calling: 'lambda', runtimeVersion: RUNTIME_VERSION };
}

/** A lambda that keeps its worker busy for `ms` milliseconds, then returns
 * `ms`. */
const BUSY = storedLambda(
  '(ms) => { const t = Date.now() + ms; while (Date.now() < t); return ms; }'
);

/** `n ↦ Length(TakeWhile(1..∞, k ↦ k < n))`: `n - 1` when the walk of
 * `TakeWhile` stays within the iteration limit, an iteration-limit error
 * otherwise. */
const takeWhile = () =>
  compile(
    ce.box([
      'Function',
      [
        'Length',
        [
          'TakeWhile',
          ['Range', 1, 'PositiveInfinity'],
          ['Function', ['Less', 'k', 'n'], 'k'],
        ],
      ],
      'n',
    ])
  );

// Every pool is disposed after its test, also when an assertion failed
// first: a live worker thread keeps jest from exiting.
const pools: KernelPool[] = [];
afterEach(() => {
  for (const pool of pools.splice(0)) pool.dispose();
});

/**
 * A pool of `size` worker threads, each wrapped to count the workers created
 * and terminated, and to record the `call` tasks sent (with the index of the
 * worker, in the order of creation) and the `call-result` answers.
 */
function watchedPool(options: { size: number; cancelGrace?: number }) {
  const log = {
    created: 0,
    terminated: 0,
    calls: [] as { worker: number; job: number }[],
    results: [] as { worker: number; job: number }[],
  };
  const pool = createKernelPool({
    size: options.size,
    cancelGrace: options.cancelGrace,
    create: () => {
      const index = log.created++;
      const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
      w.on('message', (m: { type: string; job: number }) => {
        if (m.type === 'call-result')
          log.results.push({ worker: index, job: m.job });
      });
      return {
        postMessage: (m: unknown, transfer?: ArrayBuffer[]) => {
          const sent = m as { type: string; job: number };
          if (sent.type === 'call')
            log.calls.push({ worker: index, job: sent.job });
          w.postMessage(m, transfer ?? []);
        },
        terminate: () => {
          log.terminated++;
          return w.terminate();
        },
        on: (event, handler) => w.on(event as 'message', handler),
      };
    },
  });
  pools.push(pool);
  const calls = callPool(pool);
  if (calls === undefined) throw new Error('not a usable pool');
  return { pool, calls, log };
}

describe('the call task of the kernel pool', () => {
  test('callPool() gives a usable pool of this module, and nothing else', () => {
    const { pool } = watchedPool({ size: 1 });
    expect(callPool(pool)).toBe(pool);
    expect(callPool({})).toBeUndefined();
    expect(callPool(undefined)).toBeUndefined();
  });

  test('the value is the value of a direct call, and the arguments are not changed', async () => {
    const { pool, calls } = watchedPool({ size: 1 });
    await pool.prewarm();
    const affine = compile(
      ce.parse('(a: real, b: real, L: list<real>) \\mapsto a L + b')
    );
    expect(affine.calling).toBe('lambda');
    const L = [1, 2, 3];
    const value = await calls.runCall(affine, [2, 1, L], undefined, undefined);
    expect(value).toEqual(affine.run!(2, 1, [1, 2, 3]));
    expect(value).toEqual([3, 5, 7]);
    expect(L).toEqual([1, 2, 3]);

    const pair = compile(ce.parse('(n: integer) \\mapsto [n, [n+1, 2n]]'));
    expect(await calls.runCall(pair, [4], undefined, undefined)).toEqual(
      pair.run!(4)
    );

    // A boolean and a string argument, and a value that holds a
    // `Float64Array` at the top level of an array and deeper.
    const mixed = storedLambda(
      '(f, s, n) => [f, s, new Float64Array(n).fill(2), [new Float64Array([n])]]'
    );
    const v = (await calls.runCall(
      mixed,
      [true, 'ab', 3],
      undefined,
      undefined
    )) as unknown[];
    expect(v[0]).toBe(true);
    expect(v[1]).toBe('ab');
    // Compared by tag: a message arrives in Node's realm, and jest runs the
    // test in a realm of its own, with another `Float64Array`.
    expect(tag(v[2])).toBe('[object Float64Array]');
    expect(Array.from(v[2] as Float64Array)).toEqual([2, 2, 2]);
    expect(tag((v[3] as Float64Array[])[0])).toBe('[object Float64Array]');
    expect(Array.from((v[3] as Float64Array[])[0])).toEqual([3]);

    // A `Float64Array` argument stays with the caller.
    const sum = storedLambda('(xs) => xs.reduce((a, b) => a + b, 0)');
    const xs = new Float64Array([1, 2, 3]);
    expect(await calls.runCall(sum, [xs], undefined, undefined)).toBe(6);
    expect(Array.from(xs)).toEqual([1, 2, 3]);
  }, 60_000);

  // The transfer of a buffer empties it in the worker. A view that covers
  // only a part of its buffer is copied: the function can hold the buffer
  // through another view between two calls.
  test('a returned view of a part of a buffer that the function keeps is copied, not transferred', async () => {
    const { pool, calls } = watchedPool({ size: 1 });
    await pool.prewarm();
    const kept = storedLambda(
      '(() => { const kept = new Float64Array([1, 2, 3, 4]); return (i) => { kept[i] += 10; return kept.subarray(0, 2); }; })()'
    );
    const first = await calls.runCall(kept, [0], undefined, undefined);
    expect(Array.from(first as Float64Array)).toEqual([11, 2]);
    const second = await calls.runCall(kept, [1], undefined, undefined);
    expect(Array.from(second as Float64Array)).toEqual([11, 12]);
  }, 60_000);

  test('two calls made at once on an idle pool of two workers run on two workers', async () => {
    const { pool, calls, log } = watchedPool({ size: 2 });
    await pool.prewarm();
    const values = await Promise.all([
      calls.runCall(BUSY, [200], undefined, undefined),
      calls.runCall(BUSY, [200], undefined, undefined),
    ]);
    expect(values).toEqual([200, 200]);
    expect(log.calls.length).toBe(2);
    expect(new Set(log.calls.map((c) => c.worker)).size).toBe(2);
  }, 60_000);

  test('a lambda that throws rejects with its message, and the worker takes the next call', async () => {
    const { pool, calls, log } = watchedPool({ size: 1 });
    await pool.prewarm();
    const r = takeWhile();
    expect(() => r.run!(5000)).toThrow(/Iteration limit of 1024 exceeded/);
    await expect(
      calls.runCall(r, [5000], undefined, undefined)
    ).rejects.toThrow(/Iteration limit of 1024 exceeded/);
    expect(await calls.runCall(r, [10], undefined, undefined)).toBe(9);
    expect(log.created).toBe(1);
    expect(log.terminated).toBe(0);
  }, 60_000);

  test('a kernel that the worker refuses rejects each call with the reason, and other kernels still run', async () => {
    const { pool, calls, log } = watchedPool({ size: 1 });
    await pool.prewarm();
    const other = { ...storedLambda('(x) => x'), runtimeVersion: '0.0.0' };
    await expect(calls.runCall(other, [1], undefined, undefined)).rejects.toThrow(
      /compiled for runtime 0\.0\.0/
    );
    // The second call is refused on the main thread: it is not sent.
    await expect(calls.runCall(other, [1], undefined, undefined)).rejects.toThrow(
      /compiled for runtime 0\.0\.0/
    );
    expect(log.calls.length).toBe(1);
    // A stored expression (not a lambda) cannot be called.
    const expr = compile(ce.parse('x + 1'));
    await expect(
      calls.runCall(expr, [1], undefined, undefined)
    ).rejects.toThrow(/not a lambda/);
    expect(await calls.runCall(BUSY, [1], undefined, undefined)).toBe(1);
    expect(log.created).toBe(1);
  }, 60_000);

  test('a signal aborted before the call rejects with its reason, and nothing is sent', async () => {
    const { calls, log } = watchedPool({ size: 1 });
    const ctl = new AbortController();
    const reason = new Error('stop');
    ctl.abort(reason);
    await expect(
      calls.runCall(BUSY, [1], undefined, ctl.signal)
    ).rejects.toBe(reason);
    expect(log.created).toBe(0);
    expect(log.calls.length).toBe(0);
  });

  test('an abort while the call waits in the queue drops it', async () => {
    const { pool, calls, log } = watchedPool({ size: 1 });
    await pool.prewarm();
    const first = calls.runCall(BUSY, [300], undefined, undefined);
    const ctl = new AbortController();
    const second = calls.runCall(BUSY, [1], undefined, ctl.signal);
    await until(() => log.calls.length === 1);
    ctl.abort('dropped');
    await expect(second).rejects.toBe('dropped');
    expect(await first).toBe(300);
    // The next call runs; the dropped one was never sent.
    expect(await calls.runCall(BUSY, [2], undefined, undefined)).toBe(2);
    expect(log.calls.length).toBe(2);
    expect(log.terminated).toBe(0);
  }, 60_000);

  test('an abort while a worker runs the call rejects at once; the worker is replaced after the grace period, and the pool works again', async () => {
    const { pool, calls, log } = watchedPool({ size: 1, cancelGrace: 100 });
    await pool.prewarm();
    const ctl = new AbortController();
    const reason = new Error('aborted');
    const long = calls.runCall(BUSY, [20_000], undefined, ctl.signal);
    await until(() => log.calls.length === 1);
    await sleep(50);
    const t0 = Date.now();
    ctl.abort(reason);
    await expect(long).rejects.toBe(reason);
    // Before a quarter of the 20 s call: a rejection that waits for the call
    // to end fails, and the load of the machine does not.
    expect(Date.now() - t0).toBeLessThan(5_000);
    // A call made now waits for the busy worker, then runs on its
    // replacement, which is sent the kernel again.
    expect(await calls.runCall(BUSY, [3], undefined, undefined)).toBe(3);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(log.terminated).toBe(1);
    expect(log.created).toBe(2);
    expect(log.results.length).toBe(1);
    expect(log.results[0].worker).toBe(1);
  }, 60_000);

  test('the iteration limit of the call reaches the worker', async () => {
    const { pool, calls } = watchedPool({ size: 1 });
    await pool.prewarm();
    const r = takeWhile();
    // Within the worker's default limit (1024).
    expect(await calls.runCall(r, [500], undefined, undefined)).toBe(
      r.run!(500)
    );
    await expect(calls.runCall(r, [500], 100, undefined)).rejects.toThrow(
      /Iteration limit of 100 exceeded/
    );
    // The limit holds for one task: the next call has the default again.
    expect(await calls.runCall(r, [500], undefined, undefined)).toBe(499);
  }, 60_000);

  test('a pool whose workers hold another runtime version rejects the call', async () => {
    const pool = createKernelPool({
      create: () => {
        const handlers: ((m: unknown) => void)[] = [];
        setTimeout(
          () =>
            handlers.forEach((h) =>
              h({
                type: 'ready',
                runtimeVersion: '0.0.0',
                intervalRuntimeVersion: '0.0.0',
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
    pools.push(pool);
    const calls = callPool(pool) as CallPool;
    expect(calls).toBe(pool);
    // A call made before the worker reports its version waits for it, and
    // is rejected with the reason.
    await expect(
      calls.runCall(BUSY, [1], undefined, undefined)
    ).rejects.toThrow(/holds runtime 0\.0\.0/);
    // Then the pool is unusable: `callPool()` no longer gives it, and a call
    // is rejected at once.
    expect(callPool(pool)).toBeUndefined();
    await expect(
      calls.runCall(BUSY, [1], undefined, undefined)
    ).rejects.toThrow(/holds runtime 0\.0\.0/);
  });
});
