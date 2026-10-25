import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ComputeEngine,
  createKernelPool,
  type KernelPool,
} from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { findFitAsync } from '../../src/compute-engine/nonlinear-fit';
import { fitSlicePool } from '../../src/compute-engine/kernel-pool';
import type { WireFitProblem } from '../../src/compute-engine/kernel-protocol';
import { RUNTIME_VERSION } from '../../src/compute-engine/compilation/javascript-runtime';
import { INTERVAL_RUNTIME_VERSION } from '../../src/compute-engine/interval';

// `FindFit.evaluateAsync()` with a kernel pool on the engine: the separable
// scan of the `global` option runs on the workers (`findFitAsync` in
// src/compute-engine/nonlinear-fit.ts, `PoolFitExecutor` in
// src/compute-engine/fit-executor.ts, the `fit-load`/`fit-run` messages of
// src/kernel-worker.ts; design: docs/plans/2026-10-20-findfit-global-grid.md,
// section 4). Each grid point is solved on a worker by the same code
// (`linearScanSolve()` in src/compute-engine/fit-scan.ts) on the same
// numbers, so the record is the record of `evaluate()`. The workers are Node
// `worker_threads` running the worker entry from source through the tsx
// loader; at most two per pool, as the shared box caps test workers.

const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));

const newWorker = () =>
  new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });

/** A pool whose workers are counted, with the types of the messages the
 * pool sent them, the `fit-load` messages per worker, the number of points
 * of each `fit-run` job, and the `fit-result` replies. `onSend` is called
 * after each message is posted. */
function countingPool(size = 2): {
  pool: KernelPool;
  created: () => number;
  sent: Map<string, number>;
  /** Per worker (in creation order), the `fit-load` ids it was sent. */
  loads: number[][];
  /** The number of points of each `fit-run` job. */
  runPoints: Map<number, number>;
  results: { job: number; done: number; out: Float64Array }[];
  onSend: ((type: string) => void) | undefined;
} {
  let created = 0;
  const sent = new Map<string, number>();
  const loads: number[][] = [];
  const runPoints = new Map<number, number>();
  const results: { job: number; done: number; out: Float64Array }[] = [];
  const counting = {
    pool: undefined as unknown as KernelPool,
    created: () => created,
    sent,
    loads,
    runPoints,
    results,
    onSend: undefined as ((type: string) => void) | undefined,
  };
  counting.pool = createKernelPool({
    create: () => {
      created++;
      const w = newWorker();
      const myLoads: number[] = [];
      loads.push(myLoads);
      return {
        postMessage: (m: unknown, t?: ArrayBuffer[]) => {
          const msg = m as {
            type: string;
            id?: number;
            job?: number;
            points?: Float64Array;
            width?: number;
          };
          sent.set(msg.type, (sent.get(msg.type) ?? 0) + 1);
          if (msg.type === 'fit-load') myLoads.push(msg.id!);
          if (msg.type === 'fit-run')
            runPoints.set(msg.job!, msg.points!.length / msg.width!);
          w.postMessage(m, t);
          counting.onSend?.(msg.type);
        },
        terminate: () => w.terminate(),
        on: (event, handler) =>
          w.on(
            event,
            event === 'message'
              ? (m: unknown) => {
                  const r = m as {
                    type: string;
                    job: number;
                    done: number;
                    out: Float64Array;
                  };
                  if (r.type === 'fit-result')
                    results.push({ job: r.job, done: r.done, out: r.out });
                  handler(m);
                }
              : handler
          ),
      };
    },
    size,
  });
  return counting;
}

const param = (rec: Expression, name: string): number =>
  Number(rec.get('parameters')?.get(name)?.re);
const residualNorm = (rec: Expression): number =>
  Number(rec.get('residualNorm')?.re);

/** `a cos(b x + c) + d x + e`, where `e` is Euler's number. */
const MODEL = [
  'Add',
  ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
  ['Multiply', 'd', 'x'],
  'ExponentialE',
];
const PARAMS = ['List', 'a', 'b', 'c', 'd'];

/** `n` points evenly spaced on `[0, 10]`, with no noise, from `a = 2`,
 * `c = 0.5`, `d = 0.1` and the frequency `b`. */
function dense(n: number, b: number): { xs: number[]; ys: number[] } {
  const xs = Array.from({ length: n }, (_, i) => (10 * i) / (n - 1));
  const ys = xs.map((x) => 2 * Math.cos(b * x + 0.5) + 0.1 * x + Math.E);
  return { xs, ys };
}

const fitCall = (
  xs: number[],
  ys: number[],
  ranges: Record<string, number[]>,
  model: unknown = MODEL,
  params: unknown = PARAMS
) => [
  'FindFit',
  ['List', ...xs.map((x, i) => ['Tuple', x, ys[i]])],
  model,
  params,
  ['List', 'x'],
  { dict: { global: { dict: ranges } } },
];

/** The record of `evaluate()` on an engine with no pool and of
 * `evaluateAsync()` on `pooled` are the same. */
async function expectParity(
  pooled: ComputeEngine,
  call: unknown[],
  names = ['a', 'b', 'c', 'd']
): Promise<Expression> {
  const sync = new ComputeEngine().box(call as any).evaluate();
  const rec = await pooled.box(call as any).evaluateAsync();
  expect(rec.operator).toBe('Dictionary');
  for (const name of names)
    expect(Math.abs(param(rec, name) - param(sync, name))).toBeLessThanOrEqual(
      1e-9
    );
  expect(residualNorm(rec)).toBe(residualNorm(sync));
  expect(rec.get('converged')?.symbol).toBe(sync.get('converged')?.symbol);
  expect(rec.get('iterations')?.re).toBe(sync.get('iterations')?.re);
  return rec;
}

// The top of Tycho's frequency range on 200 points: `2π / (smallest gap)`.
const HI_200 = (2 * Math.PI) / (10 / 199);

describe('FindFit.evaluateAsync on a kernel pool', () => {
  let counting: ReturnType<typeof countingPool>;
  let pooled: ComputeEngine;

  beforeAll(async () => {
    counting = countingPool(2);
    pooled = new ComputeEngine({ workers: counting.pool });
    await counting.pool.prewarm();
  }, 60_000);

  afterAll(() => counting.pool.dispose());

  test.each([
    ['deciding 1: n = 200, b = 2.2 over [0.3, 2π / gap]', 200, 2.2, HI_200],
    ['deciding 2: n = 200, b = 50 over [0.3, 2π / gap]', 200, 50, HI_200],
    ['deciding 3: n = 200, b = 2.2 over [0.3, 120]', 200, 2.2, 120],
    ['control 1: n = 200, b = 2.2 over [0.3, 60]', 200, 2.2, 60],
    ['1,000 rows, b = 2.2 over [0.3, 628]', 1000, 2.2, 628],
  ])(
    '%s gives the record of evaluate()',
    async (_name, n, b, hi) => {
      const before = counting.sent.get('fit-run') ?? 0;
      const unloadsBefore = counting.sent.get('unload') ?? 0;
      const loadsBefore = counting.loads.map((l) => l.length);
      const { xs, ys } = dense(n, b);
      const rec = await expectParity(
        pooled,
        fitCall(xs, ys, { b: [0.3, hi], c: [0, 2 * Math.PI] })
      );
      expect(residualNorm(rec) ** 2).toBeLessThanOrEqual(1e-12);
      // The scan ran on the workers.
      expect(counting.sent.get('fit-run') ?? 0).toBeGreaterThan(before);
      // Each worker was sent the problem at most once during the fit, and
      // told to forget it at the end.
      counting.loads.forEach((l, k) =>
        expect(l.length - (loadsBefore[k] ?? 0)).toBeLessThanOrEqual(1)
      );
      expect(counting.sent.get('unload') ?? 0).toBeGreaterThan(unloadsBefore);
    },
    60_000
  );

  test('control 2: the five 5hn1azxfc8 points, b over [0.1, 6] (a multi-start, inline)', async () => {
    const before = counting.sent.get('fit-run') ?? 0;
    const rec = await expectParity(
      pooled,
      fitCall([1, 3.22, 5.27, 10.49, 7.12], [4.3, 1.18, 0.01, 1.48, 3.44], {
        b: [0.1, 6],
      })
    );
    expect(residualNorm(rec) ** 2).toBeLessThanOrEqual(0.006);
    // The model is not linear in `c`, which is not searched: every start is
    // a solver run, on this thread.
    expect(counting.sent.get('fit-run') ?? 0).toBe(before);
  }, 60_000);

  test('a two-parameter grid (the phase range is less than a period)', async () => {
    const { xs, ys } = dense(200, 2.2);
    await expectParity(
      pooled,
      fitCall(xs, ys, { b: [0.3, HI_200], c: [0, 3] })
    );
  }, 60_000);

  test('a fit with no global option gives the record of evaluate()', async () => {
    const { xs, ys } = dense(50, 2.2);
    const call = fitCall(xs, ys, {}).slice(0, 5);
    await expectParity(pooled, call);
  }, 60_000);

  test.each([
    ['no reason', undefined],
    ['the reason "timeout"', 'timeout'],
    ['the reason "step-budget"', 'step-budget'],
  ])(
    'an abort after the first fit-run rejects with a CancellationError (%s)',
    async (_name, reason) => {
      const { xs, ys } = dense(1000, 2.2);
      const ctl = new AbortController();
      const runsBefore = counting.sent.get('fit-run') ?? 0;
      const jobsBefore = new Set(counting.runPoints.keys());
      // The `fit-run` jobs of this fit that had no answer when the signal
      // aborted.
      let running: number[] = [];
      counting.onSend = (type) => {
        if (type !== 'fit-run') return;
        counting.onSend = undefined;
        queueMicrotask(() => {
          ctl.abort(reason);
          running = [...counting.runPoints.keys()].filter(
            (job) =>
              !jobsBefore.has(job) &&
              !counting.results.some((r) => r.job === job)
          );
        });
      };
      const p = pooled
        .box(fitCall(xs, ys, { b: [0.3, 628], c: [0, 2 * Math.PI] }) as any)
        .evaluateAsync({ signal: ctl.signal });
      // A reason of "timeout" is the signal's, not the engine's deadline: the
      // evaluation rejects, it does not answer a timeout record.
      await expect(p).rejects.toMatchObject({ name: 'CancellationError' });
      expect(counting.sent.get('fit-run') ?? 0).toBeGreaterThan(runsBefore);
      // Each slice that ran when the signal aborted was cancelled: its
      // worker answered at its next grid point, with fewer points than the
      // slice holds.
      expect(running.length).toBeGreaterThan(0);
      while (
        !running.every((job) => counting.results.some((r) => r.job === job))
      )
        await new Promise((r) => setTimeout(r, 5));
      for (const job of running) {
        const answer = counting.results.find((r) => r.job === job)!;
        expect(answer.done).toBeLessThan(counting.runPoints.get(job)!);
      }
      counting.onSend = undefined;
      // The pool still works after the abort.
      const small = dense(200, 2.2);
      await expectParity(
        pooled,
        fitCall(small.xs, small.ys, { b: [0.3, 60], c: [0, 2 * Math.PI] })
      );
    },
    60_000
  );

  test('a slice that ends at a nonlinear point falls back to the multi-start', async () => {
    // `Floor(d)` has the derivative 0, so the structural test takes the model
    // as linear in `d`; the scan finds at its first point that it is not, a
    // worker slice ends there (code 2, fewer points than the slice holds),
    // and the plan runs the multi-start.
    const xs = Array.from({ length: 200 }, (_, i) => (10 * i) / 199);
    const ys = xs.map((x) => 2 * Math.cos(2.2 * x + 0.5) + 2.5 * x + 2);
    const model = [
      'Add',
      ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
      ['Multiply', 'd', 'x'],
      ['Floor', 'd'],
    ];
    const resultsBefore = counting.results.length;
    await expectParity(
      pooled,
      fitCall(xs, ys, { b: [0.3, 6], c: [0, 2 * Math.PI] }, model)
    );
    const stride = 2 + 4;
    const cut = counting.results
      .slice(resultsBefore)
      .filter(
        (r) =>
          r.done > 0 &&
          r.done < (counting.runPoints.get(r.job) ?? 0) &&
          r.out[(r.done - 1) * stride] === 2
      );
    expect(cut.length).toBeGreaterThan(0);
  }, 60_000);

  test('a deadline during the scan gives timedOut: True, as the inline route does', async () => {
    const { xs, ys } = dense(1000, 2.2);
    const ops = (
      pooled.box(
        fitCall(xs, ys, { b: [0.3, 628], c: [0, 2 * Math.PI] }) as any
      ) as any
    ).ops as Expression[];
    // `findFitAsync` is called directly inside the span: it captures the
    // frame armed when it is called (the public route, `evaluateAsync()`
    // inside a span, is tested in ce-424-425-findfit-async.test.ts). Raise
    // the budget until
    // the setup fits in it; the first such budget is far too short for the
    // scan of 2,000 grid points.
    const fit = (ms: number): Promise<Expression | undefined> => {
      let p: Promise<Expression | undefined> | undefined;
      pooled.withTimeLimit({ ms, label: 'test:pool-scan-budget' }, () => {
        p = findFitAsync(pooled, ops) as Promise<Expression | undefined>;
        return 0;
      });
      return p!;
    };
    let r: Expression | undefined;
    for (let ms = 10; ms < 5000; ms = Math.ceil(ms * 1.5)) {
      r = await fit(ms);
      if (r?.get('phase')?.string !== 'setup') break;
    }
    expect(r?.operator).toBe('Dictionary');
    expect(r!.get('timedOut')?.symbol).toBe('True');
    expect(r!.get('phase')?.string).toBe('solve');
    expect(r!.get('converged')?.symbol).toBe('False');
    for (const name of ['a', 'b', 'c', 'd'])
      expect(Number.isFinite(param(r!, name))).toBe(true);
    // A point of the sampled scan has no residual over every row (NaN); a
    // re-scored or refined point has a finite one.
    const norm = residualNorm(r!);
    expect(Number.isNaN(norm) || Number.isFinite(norm)).toBe(true);
  }, 60_000);
});

describe('FindFit.evaluateAsync: data from an asynchronous-only operator', () => {
  /** An engine with an operator `AsyncData` that has only an
   * `evaluateAsync` handler, which gives the rows of `call`. */
  function withAsyncData(
    ce: ComputeEngine,
    call: unknown[]
  ): { call: unknown[]; calls: () => number } {
    let calls = 0;
    ce.declare('AsyncData', {
      signature: '() -> list',
      evaluateAsync: async () => {
        calls++;
        return ce.box(call[1] as any);
      },
    } as never);
    return {
      call: [call[0], ['AsyncData'], ...call.slice(2)],
      calls: () => calls,
    };
  }

  test.each([
    ['with no pool', false],
    ['with a pool', true],
  ])(
    '%s, the record of evaluate() on the written-out data',
    async (_name, withPool) => {
      const counting = withPool ? countingPool(2) : undefined;
      const ce = new ComputeEngine(
        counting ? { workers: counting.pool } : undefined
      );
      const { xs, ys } = dense(200, 2.2);
      const written = fitCall(xs, ys, { b: [0.3, 120], c: [0, 2 * Math.PI] });
      const { call, calls } = withAsyncData(ce, written);
      const sync = new ComputeEngine().box(written as any).evaluate();
      const rec = await ce.box(call as any).evaluateAsync();
      expect(calls()).toBe(1);
      expect(rec.operator).toBe('Dictionary');
      for (const name of ['a', 'b', 'c', 'd'])
        expect(
          Math.abs(param(rec, name) - param(sync, name))
        ).toBeLessThanOrEqual(1e-9);
      expect(residualNorm(rec)).toBe(residualNorm(sync));
      if (counting) {
        expect(counting.sent.get('fit-run') ?? 0).toBeGreaterThan(0);
        counting.pool.dispose();
      }
    },
    60_000
  );
});

describe('FindFit.evaluateAsync without the pool', () => {
  /** A signal that reports an abort from its `n`-th read of `aborted` on,
   * with `reason`: an abort that arrives while the fit runs on this thread,
   * which a timer cannot do. Counts the reads after the abort. */
  function abortAfterReads(n: number, reason: unknown) {
    let reads = 0;
    const signal = {
      get aborted() {
        reads++;
        return reads >= n;
      },
      reason,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    return { signal: signal as unknown as AbortSignal, reads: () => reads };
  }

  test.each([
    ['a separable global fit', { b: [0.3, 120], c: [0, 2 * Math.PI] }],
    ['a fit with no global option', undefined],
  ])(
    '%s on this thread stops within a row of an abort, and rejects (reason "timeout")',
    async (_name, ranges) => {
      const ce = new ComputeEngine();
      const { xs, ys } = dense(200, 2.2);
      const call = ranges
        ? fitCall(xs, ys, ranges)
        : fitCall(xs, ys, {}).slice(0, 5);
      const ops = (ce.box(call as any) as any).ops as Expression[];
      // A fit with a signal that never aborts: the count of reads of the
      // signal (one per row of each pass over the rows, and per iteration).
      const probe = abortAfterReads(Infinity, 'timeout');
      await findFitAsync(ce, ops, { signal: probe.signal });
      const total = probe.reads();
      expect(total).toBeGreaterThan(1000);
      // The abort arrives in the middle of the fit.
      const n = Math.floor(total / 2);
      const { signal, reads } = abortAfterReads(n, 'timeout');
      await expect(findFitAsync(ce, ops, { signal })).rejects.toMatchObject({
        name: 'CancellationError',
        cause: 'timeout',
      });
      // The fit read the signal again only a few times after the abort: the
      // check of the row that threw, and the checks of the catch blocks on
      // the way out.
      expect(reads()).toBeLessThan(n + 10);
    },
    60_000
  );

  test('with no pool, the record of evaluate()', async () => {
    const ce = new ComputeEngine();
    const { xs, ys } = dense(200, 2.2);
    await expectParity(
      ce,
      fitCall(xs, ys, { b: [0.3, 120], c: [0, 2 * Math.PI] })
    );
  }, 60_000);

  test('a model that does not compile runs inline and creates no worker', async () => {
    // `LogGamma` has no compiled form: the model and its column for `d` are
    // interpreted, which a worker cannot run.
    const counting = countingPool(2);
    const ce = new ComputeEngine({ workers: counting.pool });
    const xs = Array.from({ length: 12 }, (_, i) => (10 * i) / 11);
    const ys = xs.map(
      (x) => 2 * Math.cos(2.2 * x + 0.5) + 0.3 * logGamma(x + 1)
    );
    const model = [
      'Add',
      ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
      ['Multiply', 'd', ['LogGamma', ['Add', 'x', 1]]],
    ];
    // A caller-given step keeps the interpreted scan short (24 points).
    const rec = await expectParity(
      ce,
      fitCall(xs, ys, { b: [0.3, 6, 0.25], c: [0, 2 * Math.PI] }, model)
    );
    expect(residualNorm(rec)).toBeLessThan(1e-6);
    expect(counting.created()).toBe(0);
    counting.pool.dispose();
  }, 60_000);
});

describe('FindFit.evaluateAsync falls back inline when a worker fails', () => {
  /** A worker that starts with this engine's versions (or `versions`), and
   * answers `onMessage`. */
  function fakeWorker(
    onMessage: (
      m: { type: string; id?: number; job?: number },
      post: (m: unknown) => void
    ) => void,
    versions = {
      runtimeVersion: RUNTIME_VERSION,
      intervalRuntimeVersion: INTERVAL_RUNTIME_VERSION,
    }
  ) {
    const handlers: ((m: unknown) => void)[] = [];
    const post = (m: unknown) =>
      setTimeout(() => handlers.forEach((h) => h(m)), 0);
    setTimeout(() => post({ type: 'ready', ...versions }), 0);
    return {
      postMessage: (m: unknown) => onMessage(m as never, post),
      terminate: () => undefined,
      on: (event: string, handler: (m: unknown) => void) => {
        if (event === 'message') handlers.push(handler);
      },
    };
  }

  const call = () => {
    const { xs, ys } = dense(1000, 2.2);
    return fitCall(xs, ys, { b: [0.3, 628], c: [0, 2 * Math.PI] });
  };

  test('a worker that answers every fit-run with an error', async () => {
    let runs = 0;
    const pool = createKernelPool({
      create: () =>
        fakeWorker((m, post) => {
          if (m.type === 'fit-load') post({ type: 'loaded', id: m.id });
          if (m.type === 'fit-run') {
            runs++;
            post({ type: 'error', job: m.job, message: 'no' });
          }
        }),
      size: 2,
    });
    await expectParity(new ComputeEngine({ workers: pool }), call());
    expect(runs).toBeGreaterThan(0);
    pool.dispose();
  }, 60_000);

  test('a worker that refuses the problem', async () => {
    const pool = createKernelPool({
      create: () =>
        fakeWorker((m, post) => {
          if (m.type === 'fit-load')
            post({ type: 'error', id: m.id, message: 'refused' });
          if (m.type === 'fit-run')
            post({ type: 'error', job: m.job, message: 'not loaded' });
        }),
      size: 2,
    });
    await expectParity(new ComputeEngine({ workers: pool }), call());
    pool.dispose();
  }, 60_000);

  test('a pool whose worker factory throws', async () => {
    let attempts = 0;
    const pool = createKernelPool({
      create: () => {
        attempts++;
        throw new Error('workers are blocked');
      },
      size: 2,
    });
    await expectParity(new ComputeEngine({ workers: pool }), call());
    expect(attempts).toBeGreaterThan(0);
    pool.dispose();
  }, 60_000);

  test('an abort of the running slice sends the next slice of the same worker', async () => {
    // A pool of one worker that answers each fit-run after 20 ms, with every
    // point solved. The first slice runs when its signal aborts; the second
    // slice, with no signal, waits behind it on the same worker.
    const runs: number[] = [];
    const pool = createKernelPool({
      create: () =>
        fakeWorker((m, post) => {
          if (m.type === 'fit-load') post({ type: 'loaded', id: m.id });
          if (m.type === 'fit-run') {
            runs.push(m.job!);
            const { points, width } = m as unknown as {
              points: Float64Array;
              width: number;
            };
            const done = points.length / width;
            setTimeout(
              () =>
                post({
                  type: 'fit-result',
                  job: m.job,
                  out: new Float64Array(6 * done),
                  done,
                }),
              20
            );
          }
        }),
      size: 1,
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
    const ctl = new AbortController();
    const first = fitPool.runFitSlice(
      problem,
      new Float64Array([1, 2]),
      false,
      undefined,
      undefined,
      ctl.signal
    );
    const second = fitPool.runFitSlice(
      problem,
      new Float64Array([3]),
      false,
      undefined,
      undefined,
      undefined
    );
    while (runs.length === 0) await new Promise((r) => setTimeout(r, 1));
    ctl.abort();
    expect((await first).done).toBe(0);
    expect((await second).done).toBe(1);
    expect(runs.length).toBe(2);
    pool.dispose();
  }, 60_000);

  test('a worker of another runtime version', async () => {
    const pool = createKernelPool({
      create: () =>
        fakeWorker(() => undefined, {
          runtimeVersion: 'not-this-one',
          intervalRuntimeVersion: INTERVAL_RUNTIME_VERSION,
        }),
      size: 2,
    });
    const ce = new ComputeEngine({ workers: pool });
    await expectParity(ce, call());
    // Once a worker has reported another version, the pool is not used.
    await expectParity(ce, call());
    pool.dispose();
  }, 60_000);

  test('a worker terminated while it runs a slice', async () => {
    let killed = 0;
    const pool = createKernelPool({
      create: () => {
        const w = newWorker();
        let done = false;
        return {
          postMessage: (m: unknown, t?: ArrayBuffer[]) => {
            w.postMessage(m, t);
            if (!done && (m as { type: string }).type === 'fit-run') {
              done = true;
              killed++;
              void w.terminate();
            }
          },
          terminate: () => w.terminate(),
          on: (event, handler) => w.on(event, handler),
        };
      },
      size: 2,
    });
    await expectParity(new ComputeEngine({ workers: pool }), call());
    expect(killed).toBeGreaterThan(0);
    pool.dispose();
  }, 60_000);
});

/** `ln Γ(x)` for `x > 0` (Lanczos, g = 7), to generate the data of the
 * `LogGamma` model independently of the engine. */
function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return (
    0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
  );
}
