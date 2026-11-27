/**
 * `runAsync()` sends a `parallel for` to the worker pool (CE-1462; design
 * note `docs/plans/2026-11-18-ir-parallel-for-and-list-locals.md`, section
 * 6; README of `src/compute-engine/compilation/ir/`, "Batches and
 * `runAsync()`"). The route of each loop is read from `onLoop`. The workers
 * are Node `worker_threads` running the worker entry from source through the
 * tsx loader, as in kernel-pool.test.ts; two at most, since the shared box
 * caps test workers.
 */

import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from '../../src/compile';
import {
  ComputeEngine,
  createKernelPool,
  type KernelPool,
} from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { callPool } from '../../src/compute-engine/kernel-pool';
import { numbersOf } from '../../src/compute-engine/compilation/run-async';
import { ParallelDispatchHistory } from '../../src/compute-engine/compilation/parallel-dispatch';
import {
  RUNTIME_VERSION,
  setReconstructionDigits,
} from '../../src/compute-engine/compilation/javascript-runtime';
import { sliceProgram } from '../../src/compute-engine/compilation/ir/index';
import { outline } from '../../src/compute-engine/compilation/ir/outline';
import { OPERATORS } from '../../src/compute-engine/compilation/ir/operators';
import { JS } from '../../src/compute-engine/compilation/ir/print-js';
import type {
  Instr,
  Program,
  Region,
} from '../../src/compute-engine/compilation/ir/ir';
import type {
  ParallelLoopFallbackReason,
  ParallelLoopReport,
  RunAsyncOptions,
} from '../../src/compute-engine/compilation/types';

const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Message = {
  type: string;
  job: number;
  args?: unknown[];
  value?: unknown;
  deadline?: number;
};

/** A pool of `size` worker threads, each wrapped to record the `call` tasks
 * sent (with their arguments) and the values answered. `onCall` can drop a
 * call (the worker never answers) or terminate the worker (it fails). */
function watchedPool(
  options: {
    size?: number;
    cancelGrace?: number;
    onCall?: () => 'drop' | 'fail' | undefined;
    delayCallPastDeadline?: boolean;
  } = {}
) {
  const log = {
    created: 0,
    terminated: 0,
    calls: [] as unknown[][],
    results: [] as unknown[],
  };
  const pool = createKernelPool({
    size: options.size ?? 2,
    cancelGrace: options.cancelGrace,
    create: () => {
      log.created++;
      const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
      w.on('message', (m: Message) => {
        if (m.type === 'call-result') log.results.push(m.value);
      });
      return {
        postMessage: (m: unknown, transfer?: ArrayBuffer[]) => {
          const sent = m as Message;
          if (sent.type === 'call') {
            log.calls.push(sent.args!);
            const act = options.onCall?.();
            if (act === 'drop') return;
            if (act === 'fail') {
              void w.terminate();
              return;
            }
            if (options.delayCallPastDeadline && sent.deadline !== undefined) {
              setTimeout(
                () => w.postMessage(m, transfer ?? []),
                Math.max(0, sent.deadline + 10 - Date.now())
              );
              return;
            }
          }
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
  return { pool, log };
}

// The shared pool of the tests that do not change the workers.
let shared: ReturnType<typeof watchedPool>;
const pools: KernelPool[] = [];
beforeAll(async () => {
  shared = watchedPool();
  await shared.pool.prewarm();
}, 60_000);
afterAll(() => shared.pool.dispose());
afterEach(() => {
  for (const pool of pools.splice(0)) pool.dispose();
});
beforeEach(() => {
  shared.log.calls.length = 0;
  shared.log.results.length = 0;
});

type Result = {
  success: boolean;
  run: (inputs: object) => unknown;
  runAsync: (inputs: object, options?: RunAsyncOptions) => Promise<unknown>;
  willParallelize: (passes?: number, minPasses?: number) => boolean;
  parallelLoopFallbacks?: readonly ParallelLoopFallbackReason[];
};

/** The Epsil function `f` of `source`, on an engine of its own with the
 * pool `pool`, compiled for a call of it with the inputs of `types` (their
 * declared types). `diagnostics`: the errors of the static check. */
function program(
  source: string,
  types: Record<string, string>,
  options: {
    compile?: object;
    pool?: KernelPool | undefined;
    diagnostics?: string[];
    ce?: ComputeEngine;
  } = {}
) {
  const ce = options.ce ?? new ComputeEngine();
  const r = executeEpsil(ce, source);
  expect(
    r.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => (d.message as string[])[0])
  ).toEqual(options.diagnostics ?? []);
  for (const [name, type] of Object.entries(types)) ce.declare(name, type);
  ce.workers = 'pool' in options ? options.pool : shared.pool;
  const code = compile(ce.box(['f', ...Object.keys(types)] as never), {
    fallback: false,
    ...options.compile,
  } as never) as unknown as Result;
  expect(code.success).toBe(true);
  return { ce, code };
}

/** The value of `runAsync()` and the reports of `onLoop`. */
async function routed(
  code: Result,
  inputs: object,
  options: RunAsyncOptions = {}
): Promise<{ value: unknown; reports: ParallelLoopReport[] }> {
  const reports: ParallelLoopReport[] = [];
  const value = await code.runAsync(inputs, {
    minPasses: 20_000,
    ...options,
    onLoop: (r) => {
      reports.push(r);
      options.onLoop?.(r);
    },
  });
  return { value, reports };
}

/** `runAsync()` gives the value of `run()` and the reports `expected`. */
async function agrees(
  code: Result,
  inputs: object,
  expected: ParallelLoopReport[],
  options: RunAsyncOptions = {}
) {
  const { value, reports } = await routed(code, inputs, options);
  expect(value).toEqual(code.run(inputs));
  expect(reports).toEqual(expected);
  return value;
}

const pool = (passes: number): ParallelLoopReport => ({
  passes,
  route: 'pool',
});
const off = (
  passes: number,
  reason: ParallelLoopReport['reason']
): ParallelLoopReport => ({ passes, route: 'calling-thread', reason });

const HISTOGRAM = `function f(H: list<integer>, n: integer) -> list<integer> {
  let L = H
  let s: integer = 0
  parallel for k in 1..n {
    const c = 1 + (k * k - 7 * floor(k * k / 7))
    L[c] += 1
    s += k
    if c > 3 { L[c + 7] += k }
  }
  L[1] += s
  L
}`;

/** A loop of about `n` times 1000 passes, for the waits that the test
 * stops: at `n = 10^6`, several seconds on a worker. */
const LONG = `function f(n: integer) -> integer {
  let s: integer = 0
  parallel for k in 1..n { for m in 1..1000 { s += Mod(m * k, 7) } }
  s
}`;

describe('Automatic dispatch', () => {
  test('keeps a cheap loop serial and distinguishes pool and kernel warm-up', async () => {
    const workers = watchedPool();
    pools.push(workers.pool);
    const cheap = program(
      `function f(n: integer) -> integer {
        let s: integer = 0
        parallel for k in 1..n { s += k }
        s
      }`,
      { n: 'integer' },
      { pool: workers.pool }
    ).code;
    const cold = await routed(cheap, { n: 20_000 }, { minPasses: undefined });
    expect(cold.value).toBe(200_010_000);
    expect(cold.reports).toEqual([{
      ...off(20_000, 'estimated-cost'),
      dispatch: { warmth: 'cold-pool', basis: 'estimate' },
    }]);
    expect(workers.log.created).toBe(0);
    await workers.pool.prewarm();
    const heavy = program(LONG, { n: 'integer' }, { pool: workers.pool }).code;
    const inputs = { n: 10_000 };
    const first = await routed(heavy, inputs, { minPasses: undefined });
    const second = await routed(heavy, inputs, { minPasses: undefined });
    expect(first.value).toBe(heavy.run(inputs));
    expect(second.value).toBe(first.value);
    expect(first.reports[0]).toMatchObject({
      route: 'pool',
      dispatch: { warmth: 'cold-kernel', basis: 'estimate' },
    });
    expect(second.reports[0]).toMatchObject({ dispatch: { warmth: 'warm' } });
    workers.pool.dispose();
    const disposed = await routed(cheap, { n: 20_000 }, { minPasses: undefined });
    expect(disposed.reports[0].dispatch?.warmth).toBe('cold-pool');
  }, 60_000);

  test('cold samples stay separate and near-threshold calls explore without changing preflight', () => {
    const history = new ParallelDispatchHistory();
    const choose = (warmth: 'cold-kernel' | 'warm', explore = false) =>
      history.choose(4_000, 4, 0, 200, warmth, explore);
    history.observe('serial', 4_000, 0.8);
    history.observe('cold-kernel', 4_000, 7);
    expect(choose('cold-kernel')).toEqual({ usePool: false, basis: 'measured' });
    expect(choose('warm')).toEqual({ usePool: true, basis: 'measured' });
    history.observe('warm', 4_000, 0.72);
    for (let k = 0; k < 15; k++) {
      expect(choose('warm', true)).toEqual({ usePool: false, basis: 'measured' });
      expect(choose('warm')).toEqual({ usePool: false, basis: 'measured' });
    }
    expect(choose('warm', true)).toEqual({ usePool: true, basis: 'sample' });
  });
});

describe('A parallel for on the pool', () => {
  test('the witness-shaped step: a histogram list local and a scalar sum', async () => {
    const { code } = program(HISTOGRAM, {
      H: 'list<integer>',
      n: 'integer',
    });
    const H = new Array(15).fill(0);
    await agrees(code, { H, n: 30_000 }, [pool(30_000)]);
    expect(H.every((x) => x === 0)).toBe(true);
    expect(shared.log.calls.length).toBe(2);
  }, 60_000);

  test('each sub-range gives the partial of its passes, also for a range with a step and bounds that are not integers', async () => {
    const { code } = program(
      `function f(n: integer) -> integer {
        let s: integer = 0
        parallel for k in Range(0.5, 10.7, 1.5) { s += floor(10 * k) + n }
        s
      }`,
      { n: 'integer' }
    );
    const term = (i: number) => Math.floor(10 * (0.5 + 1.5 * i)) + 3;
    await agrees(code, { n: 3 }, [pool(7)], { minPasses: 1 });
    // The sub-ranges [0, 3) and [3, 7) of the 7 passes 0.5, 2, …, 9.5.
    expect(shared.log.calls.map((a) => a.slice(0, 2))).toEqual([
      [0, 3],
      [3, 7],
    ]);
    const partial = (i0: number, i1: number) => {
      let s = 0;
      for (let i = i0; i < i1; i++) s += term(i);
      return s;
    };
    // The answers come in the order the workers end.
    expect(
      shared.log.results.map((r) => (r as number[])[0]).sort((a, b) => a - b)
    ).toEqual([partial(0, 3), partial(3, 7)].sort((a, b) => a - b));
  }, 60_000);

  test('a scalar += under an if, in an inner for and twice in a pass; a second accumulator that changes only inside an if or an inner loop', async () => {
    const { code } = program(
      `function f(n: integer) -> list<integer> {
        let s: integer = 0
        let t: integer = 0
        let u: integer = 0
        parallel for k in 1..n {
          if Mod(k, 3) == 0 { s += k }
          for m in 1..3 { t += m * k }
          s += 1
          s += 2
          if Mod(k, 2) == 0 { u += k } else { u += 1 }
        }
        [s, t, u]
      }`,
      { n: 'integer' }
    );
    await agrees(code, { n: 30_001 }, [pool(30_001)]);
    const second = program(
      `function f(n: integer) -> list<integer> {
        let s: integer = 0
        let t: integer = 0
        parallel for k in 1..n {
          s += 1
          if Mod(k, 2) == 0 { t += k }
          for m in 1..2 { t += m }
        }
        [s, t]
      }`,
      { n: 'integer' }
    ).code;
    await agrees(second, { n: 25_000 }, [pool(25_000)]);
  }, 60_000);

  test('a list accumulator over a list domain', async () => {
    const { code } = program(
      `function f(xs: list<integer>, H: list<integer>) -> list<integer> {
        let L = H
        parallel for x in xs { L[x] += 1 }
        L
      }`,
      { xs: 'list<integer>', H: 'list<integer>' }
    );
    const xs = Array.from({ length: 25_000 }, (_, i) => 1 + ((i * 7) % 10));
    const out = await agrees(code, { xs, H: new Array(10).fill(0) }, [
      pool(25_000),
    ]);
    expect((out as number[]).reduce((a, b) => a + b, 0)).toBe(25_000);
  }, 60_000);

  test('two pool loops in one program each report the pool', async () => {
    const { code } = program(
      `function f(n: integer) -> list<integer> {
        let s: integer = 0
        parallel for k in 1..n { s += k }
        let t: integer = 0
        parallel for k in 1..n { t += 2 * k + s }
        [s, t]
      }`,
      { n: 'integer' },
      { diagnostics: [] }
    );
    await agrees(code, { n: 20_000 }, [pool(20_000), pool(20_000)]);
  }, 60_000);

  test('fewer passes than workers: one pass per sub-range; an empty range sends nothing', async () => {
    const { code } = program(HISTOGRAM, {
      H: 'list<integer>',
      n: 'integer',
    });
    const H = new Array(15).fill(0);
    await agrees(code, { H, n: 1 }, [pool(1)], { minPasses: 1 });
    expect(shared.log.calls.map((a) => a.slice(0, 2))).toEqual([[0, 1]]);
    shared.log.calls.length = 0;
    // `1..0` is `[1, 0]`: an empty list is the empty domain.
    const list = program(
      `function f(xs: list<integer>, H: list<integer>) -> list<integer> {
        let L = H
        parallel for x in xs { L[x] += 1 }
        L
      }`,
      { xs: 'list<integer>', H: 'list<integer>' }
    ).code;
    await agrees(list, { xs: [], H }, [off(0, 'below-threshold')], {
      minPasses: 1,
    });
    expect(shared.log.calls).toEqual([]);
  }, 60_000);

  test('a real accumulator is within 1e-12 of run(), with the same bits at each run', async () => {
    const { code } = program(
      `function f(n: integer) -> real {
        let s = 0.0
        parallel for k in 1..n { s += 1 / k }
        s
      }`,
      { n: 'integer' }
    );
    const exact = code.run({ n: 40_000 }) as number;
    const { value, reports } = await routed(code, { n: 40_000 });
    expect(reports).toEqual([pool(40_000)]);
    expect(Math.abs((value as number) - exact) / exact).toBeLessThan(1e-12);
    const again = await code.runAsync({ n: 40_000 }, { minPasses: 20_000 });
    expect(Object.is(again, value)).toBe(true);
  }, 60_000);

  test('the input list and a name that holds a copy are unchanged', async () => {
    const { code } = program(
      `function f(H: list<integer>, n: integer) -> list<integer> {
        let L = H
        const M = H
        parallel for k in 1..n { L[1 + Mod(k, 3)] += 1 }
        [L[1], L[2], L[3], M[1], M[2], H[1]]
      }`,
      { H: 'list<integer>', n: 'integer' }
    );
    const H = [0, 0, 0];
    const v = await agrees(code, { H, n: 30_000 }, [pool(30_000)]);
    expect(v).toEqual([10_000, 10_000, 10_000, 0, 0, 0]);
    expect(H).toEqual([0, 0, 0]);
  }, 60_000);

  test('a loop in a function called from an if arm, a for body and a second function; in order from a callback position', async () => {
    // The comprehension is over more than 16 elements, so that it keeps its
    // loop (a callback position): a shorter one is written out.
    const { code } = program(
      `function g(n: integer) -> integer {
        let s: integer = 0
        parallel for k in 1..n { s += k }
        s
      }
      function h(n: integer) -> integer { g(n) + 1 }
      function f(n: integer) -> list<integer> {
        let t: integer = 0
        if n > 0 { t = g(n) }
        for j in 1..2 { t += g(n) }
        t += h(n)
        const c = [g(i) for i in 1..17]
        [t, c[1], c[2]]
      }`,
      { n: 'integer' }
    );
    expect(code.parallelLoopFallbacks).toEqual(['unsupported-position']);
    await agrees(code, { n: 20_000 }, [
      pool(20_000),
      pool(20_000),
      pool(20_000),
      pool(20_000),
    ]);
  }, 60_000);

  test('willParallelize(), with and without minPasses', () => {
    const { ce, code } = program(HISTOGRAM, {
      H: 'list<integer>',
      n: 'integer',
    });
    expect(code.willParallelize()).toBe(true);
    expect(code.willParallelize(1)).toBe(false);
    expect(code.willParallelize(20_000, 20_000)).toBe(true);
    expect(code.willParallelize(19_999, 20_000)).toBe(false);
    expect(code.willParallelize(10, 10)).toBe(true);
    expect(code.willParallelize(9, 10)).toBe(false);
    expect(() => code.willParallelize(10, 0)).toThrow(TypeError);
    expect(() => code.willParallelize(10, 1.5)).toThrow(TypeError);
    expect(
      ce.withStepBudget({ steps: 1e9 }, () => code.willParallelize())
    ).toBe(false);
    ce.workers = undefined;
    expect(code.willParallelize()).toBe(false);
  });

  test('a minPasses that is not a positive integer rejects with a TypeError', async () => {
    const { code } = program(HISTOGRAM, {
      H: 'list<integer>',
      n: 'integer',
    });
    await expect(
      code.runAsync({ H: [0], n: 1 }, { minPasses: 0 })
    ).rejects.toThrow(TypeError);
  });
});

describe('A loop that runs in order', () => {
  test('a read of an accumulator, scalar or list', async () => {
    const scalar = program(
      `function f(n: integer) -> list<integer> {
        let s: integer = 0
        let t: integer = 0
        parallel for k in 1..n { s += k; t += s }
        [s, t]
      }`,
      { n: 'integer' },
      { diagnostics: ['parallel-accumulator-read'] }
    ).code;
    await agrees(scalar, { n: 30_000 }, []);
    expect(scalar.willParallelize()).toBe(false);
    expect(scalar.parallelLoopFallbacks).toEqual(['accumulator-dependency']);
    const list = program(
      `function f(H: list<integer>, n: integer) -> list<integer> {
        let L = H
        parallel for k in 1..n { L[1 + Mod(k, 3)] += L[1] }
        L
      }`,
      { H: 'list<integer>', n: 'integer' },
      { diagnostics: ['parallel-accumulator-read'] }
    ).code;
    await agrees(list, { H: [1, 0, 0], n: 30 }, [], { minPasses: 1 });
    expect(list.parallelLoopFallbacks).toEqual(['accumulator-dependency']);
  }, 60_000);

  test('an inner loop that reads an outer accumulator', async () => {
    const { code } = program(
      `function f(n: integer) -> integer {
        let s: integer = 0
        parallel for k in 1..n {
          let t: integer = 0
          for m in 1..2 { t = s + m }
          s += t
        }
        s
      }`,
      { n: 'integer' },
      { diagnostics: ['parallel-accumulator-read'] }
    );
    await agrees(code, { n: 20 }, [], { minPasses: 1 });
  }, 60_000);

  test('a loop with no accumulator, and a loop inside another parallel for', async () => {
    const none = program(
      `function f(H: list<integer>, n: integer) -> integer {
        parallel for k in 1..n { const u = H[1] + k }
        n
      }`,
      { H: 'list<integer>', n: 'integer' }
    ).code;
    await agrees(none, { H: [1], n: 30 }, [], { minPasses: 1 });
    expect(none.parallelLoopFallbacks).toBeUndefined();
    // The inner loop runs in order, on the worker that runs the outer one.
    const nested = program(
      `function f(n: integer) -> integer {
        let s: integer = 0
        parallel for j in 1..n { parallel for k in 1..3 { s += j * k } }
        s
      }`,
      { n: 'integer' }
    ).code;
    await agrees(nested, { n: 20 }, [pool(20)], { minPasses: 1 });
    expect(nested.parallelLoopFallbacks).toEqual(['unsupported-position']);
  }, 60_000);

  test('the bigint and complex modes, and an iterationBudget', async () => {
    const source = `function f(n: integer) -> integer {
      let s: integer = 0
      parallel for k in 1..n { s += k }
      s
    }`;
    for (const compileOptions of [
      { mode: 'complex' },
      { iterationBudget: 1e9 },
    ]) {
      const { code } = program(
        source,
        { n: 'integer' },
        { compile: compileOptions }
      );
      await agrees(code, { n: 30_000 }, []);
      expect(code.willParallelize()).toBe(false);
      expect(code.parallelLoopFallbacks).toEqual([
        'mode' in compileOptions ? 'numeric-mode' : 'iteration-budget',
      ]);
    }
    const big = program(source, { n: 'integer' }, { compile: { mode: 'bigint' } })
      .code;
    expect(await big.runAsync({ n: 30_000 })).toEqual(big.run({ n: 30_000 }));
    expect(big.parallelLoopFallbacks).toEqual(['numeric-mode']);
  }, 60_000);

  test('a body that reads a name of vars, and a body that is not shippable', async () => {
    const ce = new ComputeEngine();
    ce.workers = shared.pool;
    ce.declare('n', 'integer');
    const loop = (body: unknown) =>
      ce.box([
        'Block',
        ['Declare', 's', { dict: { value: 0 } }],
        ['ParallelLoop', body, ['Element', 'k', ['Range', 1, 'n']]],
        's',
      ] as never);
    const host = compile(loop(['AddTo', 's', ['Multiply', 'k', 'w']]), {
      fallback: false,
      vars: { w: '_.w' },
    } as never) as unknown as Result;
    expect(host.success).toBe(true);
    expect(host.parallelLoopFallbacks).toEqual(['host-input']);
    await agrees(host, { n: 30_000, w: 2 }, []);
    const integral = compile(
      loop([
        'AddTo',
        's',
        ['Integrate', ['Exp', ['Sin', ['Multiply', 'x', 'k']]], ['Limits', 'x', 0, 1]],
      ]),
      { fallback: false } as never
    ) as unknown as Result;
    expect(integral.success).toBe(true);
    expect(integral.parallelLoopFallbacks).toEqual(['unshippable-body']);
    await agrees(integral, { n: 30 }, [], { minPasses: 1 });
  }, 60_000);

  test('the reasons of the calling thread: no pool, below the threshold, too large, a step budget', async () => {
    const noPool = program(
      HISTOGRAM,
      { H: 'list<integer>', n: 'integer' },
      { pool: undefined }
    ).code;
    const H = new Array(15).fill(0);
    await agrees(noPool, { H, n: 30_000 }, [off(30_000, 'no-pool')]);

    const { ce, code } = program(HISTOGRAM, {
      H: 'list<integer>',
      n: 'integer',
    });
    await agrees(code, { H, n: 19_999 }, [off(19_999, 'below-threshold')]);
    // Two copies of a list of 8 000 001 numbers: more than 16 million.
    const big = new Array(8_000_001).fill(0);
    const { value, reports } = await routed(code, { H: big, n: 30_000 });
    expect(reports).toEqual([off(30_000, 'too-large')]);
    expect((value as number[])[0]).toBeGreaterThan(0);
    // Inside a step budget, the loop runs in order and charges the budget.
    const budgeted = await ce.withStepBudget(
      { steps: 1e9 },
      () => routed(code, { H, n: 30_000 }) as never
    );
    expect(budgeted).toEqual({
      value: code.run({ H, n: 30_000 }),
      reports: [off(30_000, 'step-budget')],
    });
    await expect(
      ce.withStepBudget(
        { steps: 2 },
        () => code.runAsync({ H, n: 30_000 }) as never
      )
    ).rejects.toMatchObject({ cause: 'step-budget' });
  }, 60_000);

  test('the limit of private numbers counts every axis of a list that is passed', () => {
    // No compiled program passes a long list of rank 3 today (an input of
    // that rank, and a build of lists of a run-time length, decline): the
    // count is tested alone. 10 000 × 30 × 30 numbers.
    const plane = Array.from({ length: 30 }, () => new Array(30).fill(1));
    expect(numbersOf(new Array(10_000).fill(plane))).toBe(9_000_000);
    expect(numbersOf([[1, 2], [3, 4], [5, 6]])).toBe(6);
    expect(numbersOf(new Float64Array(7))).toBe(7);
    expect(numbersOf([])).toBe(0);
    expect(numbersOf(3)).toBe(0);
  });

  test('the label rules on the IR: a swap of two accumulators in an if runs in order', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const expr = ce.box([
      'Block',
      ['Declare', 's', { dict: { value: 0 } }],
      ['Declare', 't', { dict: { value: 0 } }],
      [
        'ParallelLoop',
        [
          'If',
          ['Greater', 'k', 3],
          ['Block', ['AddTo', 's', 1], ['AddTo', 't', 2]],
        ],
        ['Element', 'k', ['Range', 1, 'n']],
      ],
      ['List', 's', 't'],
    ] as never);
    const p = sliceProgram(expr, { target: 'javascript' });
    expect(outline(p, OPERATORS, JS)?.loops.length).toBe(1);
    // The arms of the `if` give the accumulators at swapped positions: the
    // IR of `if k > 3 { (s, t) := (t + 2, s + 1) }`.
    const find = (r: Region): (Instr & { k: 'if' }) | undefined => {
      for (const i of r.body) {
        if (i.k === 'if' && i.outs.length === 2) return i;
        for (const x of i.k === 'loop' ? [i.body] : []) {
          const found = find(x);
          if (found) return found;
        }
      }
      return undefined;
    };
    const arms = find((p as Program).functions[0].body)!;
    arms.then.yields.reverse();
    expect(outline(p, OPERATORS, JS)).toBeUndefined();
  });
});

describe('A numeric parallel comprehension', () => {
  test('builds ordered slices from a range and from a captured input list', async () => {
    const range = program(
      'function f(n: integer) -> list<integer> { [k^2 parallel for k in 1..n] }',
      { n: 'integer' }
    ).code;
    const squares = [1, 4, 9, 16, 25];
    expect(range.run({ n: 5 })).toEqual(squares);
    expect(
      await agrees(range, { n: 5 }, [pool(5)], { minPasses: 1 })
    ).toEqual(squares);
    expect(shared.log.results).toHaveLength(2);
    expect(shared.log.results).toEqual(
      expect.arrayContaining([[[1, 4]], [[9, 16, 25]]])
    );
    expect(await agrees(range, { n: 5 }, [off(5, 'below-threshold')])).toEqual(
      squares
    );
    expect(await agrees(range, { n: 0 }, [off(0, 'below-threshold')])).toEqual(
      []
    );

    const list = program(
      'function f(L: list<real>, x: real) -> list<real> { [k + x parallel for k in L] }',
      { L: 'list<real>', x: 'real' }
    ).code;
    const inputs = { L: [3, -2, 1.5], x: 0.25 };
    expect(await agrees(list, inputs, [pool(3)], { minPasses: 1 })).toEqual([
      3.25, -1.75, 1.75,
    ]);
  });

  test('reuses the same slice on the calling thread when a worker fails', async () => {
    const workers = watchedPool({ onCall: () => 'fail' });
    pools.push(workers.pool);
    const { code } = program(
      'function f(n: integer) -> list<integer> { [k + 1 parallel for k in 1..n] }',
      { n: 'integer' },
      { pool: workers.pool }
    );
    expect(
      await agrees(code, { n: 5 }, [off(5, 'pool-declined')], { minPasses: 1 })
    ).toEqual([2, 3, 4, 5, 6]);
  });

  test('MathJSON takes the same route and guards and random bodies decline', async () => {
    const ce = new ComputeEngine({ workers: shared.pool });
    ce.declare('n', 'integer');
    const domain = ['Range', 1, 'n'];
    const clause = ['Element', 'k', domain];
    const expression = ce.box([
      'ParallelComprehension',
      ['Multiply', 'k', 2],
      clause,
    ]);
    const result = compile(expression, {
      fallback: false,
    }) as unknown as Result;
    expect(await agrees(result, { n: 3 }, [pool(3)], { minPasses: 1 })).toEqual([
      2, 4, 6,
    ]);
    for (const unsupported of [
      ['ParallelComprehension', 'k', [...clause, ['Greater', 'k', 1]]],
      ['ParallelComprehension', ['Random'], clause],
      ['ParallelComprehension', ['List', 'k', 'k'], clause],
    ]) {
      expect(compile(ce.box(unsupported as never)).success).toBe(false);
    }
    expect(compile(expression, { to: 'glsl' }).success).toBe(false);
    expect(compile(expression, { to: 'interval-js' }).success).toBe(false);
  });
});

describe('Errors and cancellation', () => {
  test('a pass that throws on a worker: the calling thread runs the sub-range again and gives the error of run()', async () => {
    const { code } = program(
      `function f(H: list<integer>, n: integer) -> list<integer> {
        let L = H
        parallel for k in 1..n { L[k - 20] += 1 }
        L
      }`,
      { H: 'list<integer>', n: 'integer' }
    );
    const inputs = { H: new Array(30_000).fill(0), n: 30_000 };
    let error: unknown;
    try {
      code.run(inputs);
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toMatch(/out-of-range/);
    const reports: ParallelLoopReport[] = [];
    const rejected = await code
      .runAsync(inputs, { minPasses: 20_000, onLoop: (r) => reports.push(r) })
      .catch((e) => e);
    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toBe((error as Error).message);
    expect(reports).toEqual([off(30_000, 'pool-declined')]);
  }, 60_000);

  test('a worker that fails: the sub-range runs again on the calling thread', async () => {
    let first = true;
    const failing = watchedPool({
      onCall: () => {
        const act = first ? 'fail' : undefined;
        first = false;
        return act;
      },
    });
    pools.push(failing.pool);
    await failing.pool.prewarm();
    const { code } = program(
      HISTOGRAM,
      { H: 'list<integer>', n: 'integer' },
      { pool: failing.pool }
    );
    await agrees(code, { H: new Array(15).fill(0), n: 30_000 }, [
      off(30_000, 'pool-declined'),
    ]);
  }, 60_000);

  test('a signal aborted before the call, during the wait, and while the calling thread runs statements', async () => {
    const { code } = program(LONG, { n: 'integer' });
    const before = new AbortController();
    before.abort('before');
    const reports: ParallelLoopReport[] = [];
    await expect(
      code.runAsync(
        { n: 1e6 },
        { signal: before.signal, onLoop: (r) => reports.push(r) }
      )
    ).rejects.toBe('before');
    expect(reports).toEqual([]);
    expect(shared.log.calls).toEqual([]);

    const during = new AbortController();
    const t0 = Date.now();
    const pending = code.runAsync({ n: 1e6 }, { signal: during.signal });
    await sleep(100);
    during.abort('during');
    await expect(pending).rejects.toBe('during');
    expect(Date.now() - t0).toBeLessThan(20_000);

    const two = program(
      `function f(n: integer) -> list<integer> {
        let s: integer = 0
        parallel for k in 1..n { s += k }
        let t: integer = 0
        parallel for k in 1..n { t += 2 * k }
        [s, t]
      }`,
      { n: 'integer' }
    ).code;
    const between = new AbortController();
    const seen: ParallelLoopReport[] = [];
    await expect(
      two.runAsync(
        { n: 20_000 },
        {
          minPasses: 20_000,
          signal: between.signal,
          onLoop: (r) => {
            seen.push(r);
            between.abort('between');
          },
        }
      )
    ).rejects.toBe('between');
    expect(seen).toEqual([pool(20_000)]);
  }, 120_000);

  /** `runAsync()` of `code` at `inputs` inside a time limit of `ms`
   * labelled `'outer'`, and its rejection. */
  const timed = async (
    ce: ComputeEngine,
    code: Result,
    inputs: object,
    ms: number
  ) => {
    const reports: ParallelLoopReport[] = [];
    const t0 = Date.now();
    const e = await ce
      .withTimeLimit(
        { ms, label: 'outer' },
        () =>
          code.runAsync(inputs, {
            minPasses: 20_000,
            onLoop: (r) => reports.push(r),
          }) as never
      )
      .then(
        () => undefined,
        (x: unknown) => x
      );
    return { e: e as Record<string, unknown>, reports, elapsed: Date.now() - t0 };
  };

  test('a deadline that passes in a running worker, and with a sub-range still queued', async () => {
    const { ce, code } = program(LONG, { n: 'integer' });
    const running = await timed(ce, code, { n: 1e6 }, 200);
    expect(running.e).toMatchObject({
      name: 'CancellationError',
      cause: 'timeout',
      attribution: 'outer',
    });
    expect(running.reports).toEqual([]);
    expect(running.elapsed).toBeLessThan(20_000);
    // One worker is busy: the second sub-range waits in its queue.
    const busy = callPool(shared.pool)!.runCall(
      {
        code: '(ms) => { const t = Date.now() + ms; while (Date.now() < t); return ms; }',
        calling: 'lambda',
        runtimeVersion: RUNTIME_VERSION,
      },
      [1500],
      undefined,
      undefined
    );
    await sleep(50);
    const queued = await timed(ce, code, { n: 1e6 }, 200);
    expect(queued.e).toMatchObject({
      name: 'CancellationError',
      cause: 'timeout',
      attribution: 'outer',
    });
    expect(queued.elapsed).toBeLessThan(20_000);
    await busy;
  }, 120_000);

  test('a deadline with a worker that does not answer: the frame’s error, and no rerun', async () => {
    const silent = watchedPool({ cancelGrace: 100, onCall: () => 'drop' });
    pools.push(silent.pool);
    await silent.pool.prewarm();
    const { ce, code } = program(LONG, { n: 'integer' }, { pool: silent.pool });
    const r = await timed(ce, code, { n: 1e6 }, 200);
    expect(r.e).toMatchObject({
      name: 'CancellationError',
      cause: 'timeout',
      attribution: 'outer',
    });
    expect(r.reports).toEqual([]);
    expect(r.elapsed).toBeLessThan(20_000);
  }, 60_000);

  test('a short range delivered after its deadline rejects without replay (CE-1902)', async () => {
    const delayed = watchedPool({
      size: 1,
      cancelGrace: 5000,
      delayCallPastDeadline: true,
    });
    pools.push(delayed.pool);
    await delayed.pool.prewarm();
    const { ce, code } = program(
      `function f(n: integer) -> integer {
        let s: integer = 0
        parallel for k in 1..n { s += k }
        s
      }`,
      { n: 'integer' },
      { pool: delayed.pool }
    );
    const reports: ParallelLoopReport[] = [];
    const pending = ce.withTimeLimit({ ms: 250, label: 'plot' }, () =>
      code.runAsync({ n: 4 }, { minPasses: 1, onLoop: (r) => reports.push(r) })
    );
    await expect(pending).rejects.toMatchObject({
      name: 'CancellationError',
      cause: 'timeout',
      attribution: 'plot',
    });
    expect(delayed.log.calls).toHaveLength(1);
    expect(reports).toEqual([]);
  }, 60_000);

  test('a pass error in one sub-range and a deadline in another give the frame’s error', async () => {
    const { ce, code } = program(
      `function f(H: list<integer>, n: integer) -> list<integer> {
        let L = H
        parallel for k in 1..n {
          if k == 1 { L[0] += 1 }
          for m in 1..1000 { L[1 + Mod(m * k, 3)] += 1 }
        }
        L
      }`,
      { H: 'list<integer>', n: 'integer' }
    );
    const r = await timed(ce, code, { H: [0, 0, 0], n: 1e6 }, 300);
    expect(r.e).toMatchObject({
      name: 'CancellationError',
      cause: 'timeout',
      attribution: 'outer',
    });
    expect(r.reports).toEqual([]);
  }, 60_000);

  test('a worker that fails before the deadline, and a rerun that crosses it', async () => {
    const failing = watchedPool({ onCall: () => 'fail' });
    pools.push(failing.pool);
    await failing.pool.prewarm();
    const { ce, code } = program(LONG, { n: 'integer' }, { pool: failing.pool });
    const r = await timed(ce, code, { n: 1e6 }, 300);
    expect(r.e).toMatchObject({
      name: 'CancellationError',
      cause: 'timeout',
      attribution: 'outer',
    });
    // The rerun reported the route before it ran.
    expect(r.reports).toEqual([off(1e6, 'pool-declined')]);
    expect(r.elapsed).toBeLessThan(20_000);
  }, 60_000);
});

describe('The state of a call', () => {
  // `b^x` of a negative base reads the exponent to the reconstruction
  // digits of the program: 15 digits read 0.333333333333333 as 1/3, 17 do
  // not (NaN). Each program computes it after it waits for the pool, in a
  // function that waits for another one that holds the loop.
  const NESTED = `function g(n: integer) -> real {
    let s = 0.0
    parallel for k in 1..n { s += k }
    s
  }
  function h(n: integer) -> real { g(n) + 1 }
  function f(n: integer, b: real, x: real) -> real {
    const t = h(n)
    if t >= 0 { b^x } else { 0 }
  }`;
  const types = { n: 'integer', b: 'real', x: 'real' };
  const at = (precision: number) => {
    const ce = new ComputeEngine();
    ce.precision = precision;
    return program(NESTED, types, { ce });
  };
  const inputs = { n: 20_000, b: -8, x: 0.333333333333333 };
  const current = () => {
    const digits = setReconstructionDigits(undefined);
    setReconstructionDigits(digits);
    return digits;
  };

  test('two pending calls with other digits, through nested waiting functions', async () => {
    const fifteen = at(15).code;
    const seventeen = at(300).code;
    expect(fifteen.run(inputs)).toBeCloseTo(-2, 10);
    expect(seventeen.run(inputs)).toBeNaN();
    const before = current();
    const [a, b] = await Promise.all([
      routed(fifteen, inputs),
      routed(seventeen, inputs),
    ]);
    expect(a.reports).toEqual([pool(20_000)]);
    expect(b.reports).toEqual([pool(20_000)]);
    expect(a.value).toBe(fifteen.run(inputs));
    expect(b.value).toBeNaN();
    expect(current()).toBe(before);
    // The reject path: an abort during both waits.
    const ctl = new AbortController();
    const pending = [
      fifteen.runAsync(inputs, { signal: ctl.signal, minPasses: 20_000 }),
      seventeen.runAsync(inputs, { signal: ctl.signal, minPasses: 20_000 }),
    ];
    ctl.abort('stop');
    await expect(Promise.all(pending)).rejects.toBe('stop');
    await Promise.allSettled(pending);
    expect(current()).toBe(before);
  }, 60_000);

  test('another evaluation installs its own deadline frame during the wait: each keeps its own', async () => {
    const { ce, code } = program(
      `function f(n: integer) -> integer {
        let s: integer = 0
        parallel for k in 1..n { s += k }
        let t: integer = 0
        for k in 1..5000 { t += k }
        s + t
      }`,
      { n: 'integer' }
    );
    // An expired frame: if the program ticked it after the wait, its loop
    // of 5000 passes would throw.
    const other = { at: 0, spans: ['other'] };
    const expected = code.run({ n: 20_000 });
    const pending = ce.withTimeLimit(
      { ms: 60_000, label: 'mine' },
      () => code.runAsync({ n: 20_000 }, { minPasses: 20_000 }) as never
    ) as Promise<unknown>;
    ce._deadlineFrame = other;
    const value = await pending;
    expect(value).toBe(expected);
    expect(ce._deadlineFrame).toBe(other);
    // The reject path: an error after the wait.
    const failing = program(
      `function f(H: list<integer>, n: integer) -> list<integer> {
        let L = H
        parallel for k in 1..n { L[1] += 1 }
        L[n] += 1
        L
      }`,
      { H: 'list<integer>', n: 'integer' },
      { ce: new ComputeEngine() }
    );
    const p2 = failing.code.runAsync({ H: [0], n: 20_000 }, { minPasses: 20_000 });
    failing.ce._deadlineFrame = other;
    await expect(p2).rejects.toThrow(/out-of-range/);
    expect(failing.ce._deadlineFrame).toBe(other);
    ce._deadlineFrame = undefined;
  }, 60_000);

  test('two waits that reject in the same turn, with a microtask between them', async () => {
    const fifteen = at(15).code;
    const seventeen = at(300).code;
    const before = current();
    const [c1, c2] = [new AbortController(), new AbortController()];
    const p1 = fifteen.runAsync(inputs, { signal: c1.signal, minPasses: 20_000 });
    const p2 = seventeen.runAsync(inputs, { signal: c2.signal, minPasses: 20_000 });
    let between: number | undefined;
    c1.abort('one');
    queueMicrotask(() => (between = current()));
    c2.abort('two');
    const [r1, r2] = await Promise.allSettled([p1, p2]);
    expect(r1).toEqual({ status: 'rejected', reason: 'one' });
    expect(r2).toEqual({ status: 'rejected', reason: 'two' });
    expect(between).toBe(before);
    expect(current()).toBe(before);
  }, 60_000);
});
