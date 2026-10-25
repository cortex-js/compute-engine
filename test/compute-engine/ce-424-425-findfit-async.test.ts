import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ComputeEngine, createKernelPool } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { CancellationError } from '../../src/compute-engine';
import { checkDeadline } from '../../src/common/interruptible';

// `FindFit.evaluateAsync()` (`findFitAsync` and `solveSetupAsync` in
// src/compute-engine/nonlinear-fit.ts), after Tycho's feedback on CE 0.164.0
// (ROADMAP CE-424, CE-425.1 and CE-428):
//
// - CE-424: a `ce.withTimeLimit()` span around `evaluateAsync()` reaches the
//   handler. The asynchronous evaluation records the deadline frame when it
//   starts (`AsyncEvaluation.deadlineFrame`,
//   src/compute-engine/boxed-expression/evaluation-epoch.ts) and puts it back
//   in place for each synchronous part (`runWithEvaluationEffects`,
//   src/compute-engine/effects-registry.ts). The timeout is reported as by
//   `evaluate()`: in band, `timedOut: True`.
// - CE-425.1: on the calling thread the search gives the event loop a turn
//   about every 8 ms (`EventLoopPacer`, src/common/cooperative-steps.ts), so
//   a timer runs during the search and can abort it.
// - CE-428: the record of the asynchronous route has `route` (`"pool"` or
//   `"calling-thread"`) and, on the calling thread, `reason`.

const param = (rec: Expression, name: string): number =>
  Number(rec.get('parameters')?.get(name)?.re);
const residualNorm = (rec: Expression): number =>
  Number(rec.get('residualNorm')?.re);

/** `a cos(b x + c) + d x + e`, where `e` is Euler's number: it compiles, and
 * it is linear in `a` and `d`. */
const MODEL = [
  'Add',
  ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
  ['Multiply', 'd', 'x'],
  'ExponentialE',
];
const PARAMS = ['List', 'a', 'b', 'c', 'd'];

/** `a cos(b x + c) + d LogGamma(x + c)`: `LogGamma` does not compile, so
 * every function of the fit is interpreted (Tycho's case, 2.4 to 3.1 s on
 * its 5 rows). */
const SLOW_MODEL = [
  'Add',
  ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
  ['Multiply', 'd', ['LogGamma', ['Add', 'x', 'c']]],
];
const FIVE_X = [1, 3.22, 5.27, 10.49, 7.12];
const FIVE_Y = [4.3, 1.18, 0.01, 1.48, 3.44];

/** `n` points evenly spaced on `[0, 10]`, with no noise, from `a = 2`,
 * `b = 2.2`, `c = 0.5`, `d = 0.1`. */
function dense(n: number): { xs: number[]; ys: number[] } {
  const xs = Array.from({ length: n }, (_, i) => (10 * i) / (n - 1));
  const ys = xs.map((x) => 2 * Math.cos(2.2 * x + 0.5) + 0.1 * x + Math.E);
  return { xs, ys };
}

const fitCall = (
  xs: number[],
  ys: number[],
  ranges: Record<string, number[]> | undefined,
  model: unknown = MODEL
): unknown[] => [
  'FindFit',
  ['List', ...xs.map((x, i) => ['Tuple', x, ys[i]])],
  model,
  PARAMS,
  ['List', 'x'],
  ...(ranges ? [{ dict: { global: { dict: ranges } } }] : []),
];

/** The search of Tycho's case: 40 × 40 interpreted grid points and the
 * refinements, several seconds on this thread. */
const slowCall = () =>
  fitCall(FIVE_X, FIVE_Y, { b: [0.1, 6], c: [0, 6.28] }, SLOW_MODEL);

/** The same search, written in LaTeX (the parse route of the lazy
 * operator). */
const slowLatex = String.raw`\operatorname{FindFit}(\lbrack ${FIVE_X.map(
  (x, i) => `(${x}, ${FIVE_Y[i]})`
).join(
  ', '
)} \rbrack, a\cos(b x + c) + d\operatorname{LogGamma}(x + c), \lbrack a, b, c, d \rbrack, x, \operatorname{Dictionary}(\operatorname{KeyValuePair}(\text{global}, \operatorname{Dictionary}(\operatorname{KeyValuePair}(\text{b}, \lbrack 0.1, 6 \rbrack), \operatorname{KeyValuePair}(\text{c}, \lbrack 0, 6.28 \rbrack)))))`;

/** Start `expr.evaluateAsync()` inside a `withTimeLimit` span of `ms`
 * milliseconds; the span closes when the call returns its promise. */
function evaluateWithin(
  ce: ComputeEngine,
  expr: Expression,
  ms: number
): Promise<Expression> {
  let p: Promise<Expression> | undefined;
  ce.withTimeLimit({ ms, label: 'test:async-fit' }, () => {
    p = expr.evaluateAsync();
    return 0;
  });
  return p!;
}

describe('CE-424: a withTimeLimit span around FindFit.evaluateAsync()', () => {
  test.each([
    ['box route', (ce: ComputeEngine) => ce.box(slowCall() as any)],
    ['parse route', (ce: ComputeEngine) => ce.parse(slowLatex)],
  ])(
    '%s: the search stops at the limit with timedOut: True',
    async (_name, make) => {
      const ce = new ComputeEngine();
      const expr = make(ce);
      const t0 = Date.now();
      const r = await evaluateWithin(ce, expr, 150);
      const elapsed = Date.now() - t0;
      expect(r.operator).toBe('Dictionary');
      expect(r.get('timedOut')?.symbol).toBe('True');
      expect(r.get('converged')?.symbol).toBe('False');
      // The full search takes seconds; the limit stops it soon after 150 ms
      // (a step of the interpreted search can take a few tens of ms).
      expect(elapsed).toBeLessThan(1500);
      expect(r.get('route')?.string).toBe('calling-thread');
      expect(r.get('reason')?.string).toBe('no-pool');
    },
    30_000
  );

  test('a 20 ms span on the 1,000-row search answers close to 20 ms', async () => {
    const ce = new ComputeEngine();
    const { xs, ys } = dense(1000);
    const expr = ce.box(
      fitCall(xs, ys, { b: [0.3, 628], c: [0, 2 * Math.PI] }) as any
    );
    // A first call without a limit: the record of the whole search.
    const full = await expr.evaluateAsync();
    expect(full.get('timedOut')).toBeUndefined();
    const t0 = Date.now();
    const r = await evaluateWithin(ce, expr, 20);
    const elapsed = Date.now() - t0;
    expect(r.get('timedOut')?.symbol).toBe('True');
    expect(elapsed).toBeLessThan(150);
  }, 30_000);

  test('the limit also reaches an operator with only an evaluateAsync handler', async () => {
    // Not only `FindFit`: an asynchronous handler sees the limit of the call
    // at its start, and after an `await` in the evaluation context of its
    // options (`ce.withEvaluationContext`).
    const ce = new ComputeEngine();
    let atStart: number | undefined;
    let afterAwait: number | undefined;
    ce.declare('ReadDeadline', {
      signature: '(number) -> number',
      evaluateAsync: async (ops: unknown, options: any) => {
        atStart = ce._deadline;
        await new Promise((resolve) => setTimeout(resolve, 0));
        afterAwait = ce.withEvaluationContext(options, () => ce._deadline);
        return ce.Zero;
      },
    } as never);
    const before = Date.now();
    await evaluateWithin(ce, ce.box(['ReadDeadline', ['Add', 1, 2]]), 5000);
    for (const t of [atStart, afterAwait]) {
      expect(t).toBeGreaterThanOrEqual(before + 5000);
      expect(t).toBeLessThanOrEqual(Date.now() + 5000);
    }
    // Outside a span there is no deadline.
    atStart = afterAwait = 0;
    await ce.box(['ReadDeadline', ['Add', 1, 2]]).evaluateAsync();
    expect(atStart).toBeUndefined();
    expect(afterAwait).toBeUndefined();
  });
});

describe('CE-425.1: the calling-thread search gives the event loop a turn', () => {
  test('a timer runs while the search runs', async () => {
    const ce = new ComputeEngine();
    const controller = new AbortController();
    let searching = true;
    let ranDuringSearch = false;
    // A timer due in 30 ms: before the change it ran only after the search
    // ended. It then aborts the search, to keep the test short.
    setTimeout(() => {
      ranDuringSearch = searching;
      controller.abort('stop');
    }, 30);
    await ce
      .box(slowCall() as any)
      .evaluateAsync({ signal: controller.signal })
      .catch(() => undefined);
    searching = false;
    expect(ranDuringSearch).toBe(true);
  }, 30_000);

  test('an AbortController aborted by a timer stops the search', async () => {
    const ce = new ComputeEngine();
    const controller = new AbortController();
    const t0 = Date.now();
    setTimeout(() => controller.abort('stop'), 50);
    await expect(
      ce.box(slowCall() as any).evaluateAsync({ signal: controller.signal })
    ).rejects.toMatchObject({ name: 'CancellationError', cause: 'stop' });
    expect(Date.now() - t0).toBeLessThan(1500);
  }, 30_000);

  test('a fit with no global option is paced too', async () => {
    // One solver run over 2,000 rows of an interpreted model: the event
    // loop turns between two solver iterations.
    const ce = new ComputeEngine();
    const xs = Array.from({ length: 2000 }, (_, i) => 1 + i / 200);
    const ys = xs.map((x) => 2 * Math.cos(2.2 * x + 0.5) + 0.3 * x);
    const controller = new AbortController();
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
      if (ticks === 3) controller.abort('stop');
    }, 1);
    try {
      await ce
        .box(fitCall(xs, ys, undefined, SLOW_MODEL) as any)
        .evaluateAsync({ signal: controller.signal })
        .catch(() => undefined);
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThanOrEqual(3);
  }, 30_000);
});

describe('results do not change', () => {
  test.each([
    ['5 rows, a multi-start', FIVE_X, FIVE_Y, { b: [0.1, 6] }],
    [
      '200 rows, a separable scan',
      ...Object.values(dense(200)),
      { b: [0.3, 120], c: [0, 2 * Math.PI] },
    ],
    ['200 rows, no global option', ...Object.values(dense(200)), undefined],
  ] as [string, number[], number[], Record<string, number[]> | undefined][])(
    '%s: the record of evaluateAsync() is the record of evaluate()',
    async (_name, xs, ys, ranges) => {
      const call = fitCall(xs, ys, ranges);
      const sync = new ComputeEngine().box(call as any).evaluate();
      const rec = await new ComputeEngine().box(call as any).evaluateAsync();
      for (const name of ['a', 'b', 'c', 'd'])
        expect(param(rec, name)).toBe(param(sync, name));
      expect(residualNorm(rec)).toBe(residualNorm(sync));
      expect(rec.get('iterations')?.re).toBe(sync.get('iterations')?.re);
      expect(rec.get('converged')?.symbol).toBe(sync.get('converged')?.symbol);
      // The synchronous record has no route.
      expect(sync.get('route')).toBeUndefined();
      expect(sync.get('reason')).toBeUndefined();
      expect(rec.get('route')?.string).toBe('calling-thread');
      expect(rec.get('reason')?.string).toBe('no-pool');
    },
    30_000
  );
});

const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));

describe('CE-428: the route of the search, with a kernel pool', () => {
  // At most two workers, as the shared box caps test workers.
  const pool = createKernelPool({
    create: () => {
      const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
      return {
        postMessage: (m: unknown, t?: ArrayBuffer[]) => w.postMessage(m, t),
        terminate: () => w.terminate(),
        on: (event, handler) => w.on(event, handler),
      };
    },
    size: 2,
  });
  const ce = new ComputeEngine({ workers: pool });

  beforeAll(() => pool.prewarm(), 60_000);
  afterAll(() => pool.dispose());

  const route = async (call: unknown[], engine = ce) => {
    const rec = await engine.box(call as any).evaluateAsync();
    return [rec.get('route')?.string, rec.get('reason')?.string, rec];
  };

  test('a separable search that compiles runs on the pool, with the record of evaluate()', async () => {
    const { xs, ys } = dense(1000);
    const call = fitCall(xs, ys, { b: [0.3, 628], c: [0, 2 * Math.PI] });
    const [r, reason, rec] = await route(call);
    expect(r).toBe('pool');
    expect(reason).toBeUndefined();
    const sync = new ComputeEngine().box(call as any).evaluate();
    expect(residualNorm(rec as Expression)).toBe(residualNorm(sync));
  }, 60_000);

  test('a multi-start stays on this thread: not-separable', async () => {
    expect(
      (await route(fitCall(FIVE_X, FIVE_Y, { b: [0.1, 6] }))).slice(0, 2)
    ).toEqual(['calling-thread', 'not-separable']);
  }, 60_000);

  test('a model that does not compile: not-compilable', async () => {
    const xs = Array.from({ length: 12 }, (_, i) => (10 * i) / 11);
    const ys = xs.map((x) => 2 * Math.cos(2.2 * x + 0.5) + 0.3 * x);
    const model = [
      'Add',
      ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
      ['Multiply', 'd', ['LogGamma', ['Add', 'x', 1]]],
    ];
    expect(
      (
        await route(
          fitCall(xs, ys, { b: [0.3, 6, 0.25], c: [0, 2 * Math.PI] }, model)
        )
      ).slice(0, 2)
    ).toEqual(['calling-thread', 'not-compilable']);
  }, 60_000);

  test('no global option: no-global-search', async () => {
    const { xs, ys } = dense(200);
    expect((await route(fitCall(xs, ys, undefined))).slice(0, 2)).toEqual([
      'calling-thread',
      'no-global-search',
    ]);
  }, 60_000);

  test('a pool that cannot start a worker: pool-declined', async () => {
    const failing = createKernelPool({
      create: () => {
        throw new Error('workers are blocked');
      },
      size: 2,
    });
    const { xs, ys } = dense(200);
    const call = fitCall(xs, ys, { b: [0.3, 120], c: [0, 2 * Math.PI] });
    const [r, reason, rec] = await route(
      call,
      new ComputeEngine({ workers: failing })
    );
    expect([r, reason]).toEqual(['calling-thread', 'pool-declined']);
    const sync = new ComputeEngine().box(call as any).evaluate();
    expect(residualNorm(rec as Expression)).toBe(residualNorm(sync));
    failing.dispose();
  }, 60_000);

  test('a time limit on the pool route gives timedOut: True', async () => {
    const { xs, ys } = dense(1000);
    const expr = ce.box(
      fitCall(xs, ys, { b: [0.3, 628], c: [0, 2 * Math.PI] }) as any
    );
    await expr.evaluateAsync();
    // Raise the budget until the setup fits in it; the first such budget is
    // far too short for the scan.
    let r: Expression | undefined;
    for (let ms = 5; ms < 5000; ms = Math.ceil(ms * 1.5)) {
      r = await evaluateWithin(ce, expr, ms);
      if (r.get('phase')?.string !== 'setup') break;
    }
    expect(r!.get('timedOut')?.symbol).toBe('True');
    expect(r!.get('phase')?.string).toBe('solve');
    expect(r!.get('route')?.string).toBe('pool');
  }, 60_000);
});

describe('review (deadline frames)', () => {
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  /** Declare `name`, an operator whose asynchronous handler waits `pause`
   * ms at a time, and checks the deadline frame of its evaluation after
   * each wait, until `checks` checks have passed or a check throws.
   * `wrap` runs around each check (default: nothing). Returns the record of
   * the last run. */
  function declarePoller(
    ce: ComputeEngine,
    name: string,
    pause: number,
    checks: number,
    wrap: (fn: () => void) => void = (fn) => fn()
  ) {
    const run = { checks: 0, stopped: false, elapsed: 0, end: 0 };
    ce.declare(name, {
      signature: '() -> number',
      evaluateAsync: async (_ops: unknown, options: any) => {
        const t0 = Date.now();
        run.checks = 0;
        run.stopped = false;
        try {
          for (let i = 0; i < checks; i++) {
            await sleep(pause);
            wrap(() =>
              ce.withEvaluationContext(options, () =>
                checkDeadline(ce._deadlineFrame)
              )
            );
            run.checks += 1;
          }
        } catch (e) {
          run.stopped = true;
          throw e;
        } finally {
          run.end = Date.now();
          run.elapsed = run.end - t0;
        }
        return ce.Zero;
      },
    } as never);
    return run;
  }

  test('a nested withTimeLimit around an inner evaluateAsync(options) stops the inner work at its own limit, not a sibling', async () => {
    const ce = new ComputeEngine();
    const inner = declarePoller(ce, 'InnerWork', 5, 80);
    const sibling = declarePoller(ce, 'SiblingWork', 5, 30);
    let innerError: unknown;
    let limitStart = 0;
    ce.declare('OuterWork', {
      signature: '() -> number',
      evaluateAsync: async (_ops: unknown, options: any) => {
        let p: Promise<Expression> | undefined;
        limitStart = Date.now();
        ce.withTimeLimit({ ms: 50, label: 'test:inner' }, () => {
          p = ce.box(['InnerWork']).evaluateAsync(options);
          return 0;
        });
        const q = ce.box(['SiblingWork']).evaluateAsync(options);
        await p!.catch((e) => {
          innerError = e;
        });
        await q;
        return ce.Zero;
      },
    } as never);
    // The evaluation itself has a longer limit: the inner limit ends sooner.
    await evaluateWithin(ce, ce.box(['OuterWork']), 10_000);
    expect(inner.stopped).toBe(true);
    expect(innerError).toMatchObject({ name: 'CancellationError' });
    // Stopped after at least one `await`, near its 50 ms limit (80 checks
    // of 5 ms would take 400 ms or more). The limit counts from the entry
    // into `withTimeLimit`, not from the start of the handler, which a
    // loaded machine can delay: measure from the entry.
    expect(inner.checks).toBeGreaterThan(0);
    expect(inner.end - limitStart).toBeGreaterThanOrEqual(45);
    expect(inner.elapsed).toBeLessThan(300);
    // The sibling of the same evaluation ran all its checks.
    expect(sibling.stopped).toBe(false);
    expect(sibling.checks).toBe(30);
  }, 30_000);

  test('a withStepBudget around evaluateAsync() is counted in slices inside an unrelated finite-time frame', async () => {
    const ce = new ComputeEngine();
    // Each check runs inside a time-limit span that has nothing to do with
    // the budget: the budget frame (with no time limit) must still count.
    const run = declarePoller(ce, 'BudgetWork', 0, 1000, (fn) => {
      ce.withTimeLimit(60_000, () => {
        fn();
        return 0;
      });
    });
    let p: Promise<Expression> | undefined;
    ce.withStepBudget({ steps: 10, label: 'test:budget' }, () => {
      p = ce.box(['BudgetWork']).evaluateAsync();
      return 0;
    });
    await expect(p!).rejects.toMatchObject({ name: 'CancellationError' });
    expect(run.stopped).toBe(true);
    expect(run.checks).toBeLessThanOrEqual(11);
  }, 30_000);

  test('the enclosing frame is restored after a slice that throws', async () => {
    const ce = new ComputeEngine();
    let enclosing: unknown;
    let during: unknown;
    let after: unknown;
    ce.declare('ThrowingSlice', {
      signature: '() -> number',
      evaluateAsync: async (_ops: unknown, options: any) => {
        await sleep(0);
        ce.withTimeLimit({ ms: 60_000, label: 'test:enclosing' }, () => {
          enclosing = ce._deadlineFrame;
          try {
            ce.withEvaluationContext(options, () => {
              during = ce._deadlineFrame;
              throw new Error('slice failed');
            });
          } catch {}
          after = ce._deadlineFrame;
          return 0;
        });
        return ce.Zero;
      },
    } as never);
    await evaluateWithin(ce, ce.box(['ThrowingSlice']), 5000);
    expect(enclosing).toBeDefined();
    // The slice ran under the merged frame (the 5 s limit is the earlier).
    expect(during).not.toBe(enclosing);
    expect((during as { at: number }).at).toBeLessThan(
      (enclosing as { at: number }).at
    );
    expect(after).toBe(enclosing);
  });
});

describe('review (fit)', () => {
  // Fixes from the review of the asynchronous route of `FindFit`
  // (`solveSetupAsync` and `findFitAsync`, src/compute-engine/nonlinear-fit.ts).
  const separableCall = () => {
    const { xs, ys } = dense(200);
    return fitCall(xs, ys, { b: [0.3, 120], c: [0, 2 * Math.PI] });
  };

  test('a step budget keeps the scan on the calling thread: step-budget', async () => {
    // A worker does not count the steps of a `withStepBudget` span, so a
    // scan sent to the pool would not be bounded by the budget.
    const pool = createKernelPool({
      create: () => {
        const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
        return {
          postMessage: (m: unknown, t?: ArrayBuffer[]) => w.postMessage(m, t),
          terminate: () => w.terminate(),
          on: (event, handler) => w.on(event, handler),
        };
      },
      size: 1,
    });
    try {
      await pool.prewarm();
      const ce = new ComputeEngine({ workers: pool });
      const call = separableCall();
      // Without a budget the pool takes the scan.
      const pooled = await ce.box(call as any).evaluateAsync();
      expect(pooled.get('route')?.string).toBe('pool');
      let p: Promise<Expression> | undefined;
      ce.withStepBudget({ steps: 1e12, label: 'test:fit-budget' }, () => {
        p = ce.box(call as any).evaluateAsync();
        return 0;
      });
      const rec = await p!;
      expect(rec.get('route')?.string).toBe('calling-thread');
      expect(rec.get('reason')?.string).toBe('step-budget');
      const sync = new ComputeEngine().box(call as any).evaluate();
      expect(residualNorm(rec)).toBe(residualNorm(sync));
    } finally {
      pool.dispose();
    }
  }, 60_000);

  test('a timeout while the data is evaluated: the record has route and reason', async () => {
    const ce = new ComputeEngine();
    ce.declare('TimedOutData', {
      signature: '() -> list',
      evaluateAsync: async () => {
        throw new CancellationError({ cause: 'timeout', message: 'timeout' });
      },
    } as never);
    const call = fitCall(FIVE_X, FIVE_Y, undefined);
    call[1] = ['TimedOutData'];
    const rec = await ce.box(call as any).evaluateAsync();
    expect(rec.get('timedOut')?.symbol).toBe('True');
    expect(rec.get('route')?.string).toBe('calling-thread');
    expect(rec.get('reason')?.string).toBe('setup-timeout');
  });

  test('workers that hold another runtime version: pool-unusable', async () => {
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
    try {
      await pool.prewarm();
      const ce = new ComputeEngine({ workers: pool });
      const call = separableCall();
      const rec = await ce.box(call as any).evaluateAsync();
      expect(rec.get('route')?.string).toBe('calling-thread');
      expect(rec.get('reason')?.string).toBe('pool-unusable');
      const sync = new ComputeEngine().box(call as any).evaluate();
      expect(residualNorm(rec)).toBe(residualNorm(sync));
      // With no `global` option too: the pool is the first reason.
      const { xs, ys } = dense(200);
      const single = await ce
        .box(fitCall(xs, ys, undefined) as any)
        .evaluateAsync();
      expect(single.get('reason')?.string).toBe('pool-unusable');
    } finally {
      pool.dispose();
    }
  });

  test('an interpreted fit whose evaluations yield: evaluate() and evaluateAsync() agree', async () => {
    // The synchronous route runs the solver without the row steps; the
    // asynchronous route yields inside each evaluation of this interpreted
    // model. The records are the same.
    const xs = Array.from({ length: 60 }, (_, i) => 1 + i / 6);
    const ys = xs.map((x) => 2 * Math.cos(2.2 * x + 0.5) + 0.3 * x);
    const call = fitCall(xs, ys, undefined, SLOW_MODEL);
    const sync = new ComputeEngine().box(call as any).evaluate();
    const rec = await new ComputeEngine().box(call as any).evaluateAsync();
    for (const name of ['a', 'b', 'c', 'd'])
      expect(param(rec, name)).toBe(param(sync, name));
    expect(residualNorm(rec)).toBe(residualNorm(sync));
    expect(rec.get('iterations')?.re).toBe(sync.get('iterations')?.re);
  }, 30_000);
});
