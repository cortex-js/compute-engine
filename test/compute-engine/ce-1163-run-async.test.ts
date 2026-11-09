import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ComputeEngine,
  createKernelPool,
  type KernelPool,
  type WorkerLike,
} from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { setReconstructionDigits } from '../../src/compute-engine/compilation/javascript-runtime';
import type {
  ParallelLoopReport,
  RunAsyncOptions,
} from '../../src/compute-engine/compilation/types';

//
// CE-1163, steps 2 and 3 of
// `docs/plans/2026-11-08-ce1163-run-async-parallel-for.md`: `runAsync()`
// runs the asynchronous copy of a program, which sends each `parallel for`
// that can run on the pool to the workers of `ce.workers`, one sub-range of
// passes for each worker, and adds the sums of the sub-ranges to the
// accumulators. The workers are Node `worker_threads` that run the worker
// entry from source through the tsx loader, as in `kernel-pool.test.ts`. A
// pool has two or three workers: the shared machine caps test workers.
// `minPasses` sends the small ranges of these tests to the pool.
//

type Compiled = {
  success: boolean;
  code: string;
  run: (vars?: Record<string, unknown>) => unknown;
  runAsync: (
    vars?: Record<string, unknown>,
    options?: RunAsyncOptions
  ) => Promise<unknown>;
  willParallelize: (passes?: number) => boolean;
  parallelLoops?: ReadonlyArray<
    { route: 'pool' } | { route: 'in-order'; reason: string }
  >;
  parallelCode?: string;
};

/** Compile an Epsil expression to JavaScript, with no fallback. */
function compileEpsil(
  ce: ComputeEngine,
  source: string,
  options: Record<string, unknown> = {}
): Compiled {
  const [ast] = parseEpsil(source);
  const resolved = resolveLibraryNames(ast as never, source, ce);
  return compile(ce.box(resolved as never), {
    fallback: false,
    ...options,
  } as never) as never;
}

/** The routes of the loops of a result, as `route` or `in-order:reason`. */
function routes(result: Compiled): string[] {
  return (result.parallelLoops ?? []).map((l) =>
    l.route === 'pool' ? 'pool' : `in-order:${l.reason}`
  );
}

const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Every pool is disposed after its test, also when an assertion failed
// first: a live worker thread keeps jest from exiting.
const pools: KernelPool[] = [];
afterEach(() => {
  for (const pool of pools.splice(0)) pool.dispose();
});

/**
 * A pool of `size` worker threads. `log.calls` counts the `call` tasks
 * sent. With `failCalls`, a worker fails (an `error` event) instead of
 * running a `call` task.
 */
function workerPool(
  size: number,
  options: { cancelGrace?: number; failCalls?: boolean } = {}
): { pool: KernelPool; log: { calls: number } } {
  const log = { calls: 0 };
  const pool = createKernelPool({
    size,
    cancelGrace: options.cancelGrace,
    create: (): WorkerLike => {
      const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
      const errorHandlers: ((e: unknown) => void)[] = [];
      return {
        postMessage: (m: unknown, transfer?: ArrayBuffer[]) => {
          if ((m as { type: string }).type === 'call') {
            log.calls++;
            if (options.failCalls) {
              setTimeout(() =>
                errorHandlers.forEach((h) => h(new Error('worker failed')))
              );
              return;
            }
          }
          w.postMessage(m, transfer ?? []);
        },
        terminate: () => w.terminate(),
        on: (event, handler) => {
          if (event === 'error') errorHandlers.push(handler);
          w.on(event as 'message', handler);
        },
      };
    },
  });
  pools.push(pool);
  return { pool, log };
}

/** Run `result` with `runAsync()`, and give its value and the reports of
 * `onLoop`. */
async function runAsync(
  result: Compiled,
  vars: Record<string, unknown> | undefined,
  options: RunAsyncOptions = {}
): Promise<{ value: unknown; reports: ParallelLoopReport[] }> {
  const reports: ParallelLoopReport[] = [];
  const value = await result.runAsync(vars, {
    minPasses: 1,
    ...options,
    onLoop: (r) => reports.push(r),
  });
  return { value, reports };
}

//
// The witness: the `step` function of Tycho's `buddhabrot` showcase, as in
// `test/epsil/parallel-for.test.ts` (a smaller grid, lower ceilings, few
// samples).
//
const BUDDHABROT = `const N = 901
const H_0 = [0 for k in 1..N]
function step(H: list<number>, n: integer) {
  let L = H
  const r = H[901]
  parallel for k in 1..n {
    const p = 3 * fract(0.7548776662 * (r + k)) - 2
    const q = 3 * fract(0.5698402910 * (r + k)) - 1.5
    const x = p - 0.25
    const t = x^2 + q^2
    if t * (t + x) > q^2 / 4 && (p + 1)^2 + q^2 > 1/16 {
      let a = 0.0
      let b = 0.0
      let e = 0
      let sa = 0.0
      let sb = 0.0
      let s = 2
      for m in 1..200 {
        (a, b) := (a^2 - b^2 + p, 2*a*b + q)
        if a^2 + b^2 > 4 { e = m; break }
        if abs(a - sa) < 1e-12 && abs(b - sb) < 1e-12 { break }
        if m == s { sa = a; sb = b; s = 2*s }
      }
      if e > 0 {
        a = 0.0
        b = 0.0
        for m in 1..e {
          (a, b) := (a^2 - b^2 + p, 2*a*b + q)
          if a^2 + b^2 > 4 { break }
          const i = floor((b + 1.125) / 2.25 * 15)
          const j = floor((1 - a) / 3 * 20)
          if i >= 0 && i < 15 && j >= 0 && j < 20 {
            const c = 1 + i + 15*j
            const d = 15 - i + 15*j
            L[c] += 1
            L[d] += 1
            if e <= 50 {
              L[c + 300] += 1
              L[d + 300] += 1
            }
            if e <= 10 {
              L[c + 600] += 1
              L[d + 600] += 1
            }
          }
        }
      }
    }
  }
  L = replaceAt(L, 901, r + n)
  L
}
`;

describe('the witness: the buddhabrot step', () => {
  test('runAsync() gives the counts of run(), and the loop runs on the pool', async () => {
    const samples = 400;
    const ce = new ComputeEngine();
    ce.declare('H', 'list<number>');
    const result = compileEpsil(
      ce,
      `do {\n${BUDDHABROT}step(H, ${samples})\n}`
    );
    expect(result.success).toBe(true);
    expect(routes(result)).toEqual(['pool']);
    const { pool, log } = workerPool(3);
    ce.workers = pool;
    const H = new Array(901).fill(0);
    const expected = result.run({ H }) as number[];
    expect(expected.slice(0, 900).some((c) => c > 0)).toBe(true);
    const { value, reports } = await runAsync(result, { H });
    expect(value).toEqual(expected);
    expect(reports).toEqual([{ passes: samples, route: 'pool' }]);
    expect(log.calls).toBe(3);
    // A second step reads the counts of the first.
    const second = await runAsync(result, { H: expected });
    expect(second.value).toEqual(result.run({ H: expected }));
    // The input lists are not changed.
    expect(H).toEqual(new Array(901).fill(0));
  }, 120_000);
});

describe('the positions where a loop can wait', () => {
  const COUNT = `function count(H: list<integer>, n: integer) -> list<integer> {
    let L = H
    parallel for k in 1..n { L[k % 3 + 1] += 1 }
    L
  }`;
  // Each program calls `count` with `n = 9` once, or the loop runs once in
  // a position that can wait.
  test.each([
    ['the program is a call', `do { ${COUNT}; count(H, 9) }`],
    [
      'the loop is a statement of the program',
      'do { let L = H; parallel for k in 1..9 { L[k % 3 + 1] += 1 }; L }',
    ],
    [
      'inside an `if`',
      'do { let L = H; if L[1] >= 0 { parallel for k in 1..9 { L[k % 3 + 1] += 1 } }; L }',
    ],
    [
      'inside a `for`',
      'do { let L = H; for j in 1..1 { parallel for k in 1..9 { L[k % 3 + 1] += 1 } }; L }',
    ],
    [
      'inside a `while`',
      'do { let L = H; let j = 0; while j < 1 { j = j + 1; parallel for k in 1..9 { L[k % 3 + 1] += 1 } }; L }',
    ],
    [
      'a call inside an `if`',
      `do { ${COUNT}; let A = H; if A[1] > 0 { A = count(H, 9) }; A }`,
    ],
    [
      'a call inside a `for`, twice',
      `do { ${COUNT}; let A = H; for j in 1..2 { A = count(A, 9) }; A }`,
    ],
    [
      'two calls of a function of a block',
      `do { ${COUNT}; let A = count(H, 9); let B = count(A, 9); B }`,
    ],
    [
      'inside an `if` and a `for` of a function',
      `do {
        function f(H: list<integer>, n: integer) -> list<integer> {
          let L = H
          for j in 1..1 { if n > 0 { parallel for k in 1..n { L[k % 3 + 1] += 1 } } }
          L
        }
        f(H, 9)
      }`,
    ],
    [
      'in a second function, as the value of a declaration',
      `do { ${COUNT}
        function g(H: list<integer>) -> list<integer> { let A = count(H, 9); A }
        g(H) }`,
    ],
    [
      'in a second function, as the last value',
      `do { ${COUNT}
        function g(H: list<integer>) -> list<integer> { count(H, 9) }
        g(H) }`,
    ],
    [
      'the value of an assignment',
      `do { ${COUNT}; let A = H; A = count(H, 9); A }`,
    ],
    [
      'a call that is a statement, in a function that returns another value',
      `do {
        function total(H: list<integer>, n: integer) {
          let s = 0
          parallel for k in 1..n { s += H[k % 3 + 1] }
          s
        }
        function g(H: list<integer>) { total(H, 9); total(H, 9) }
        g(H)
      }`,
    ],
  ])('%s', async (_name, source) => {
    const ce = new ComputeEngine();
    ce.declare('H', 'list<integer>');
    const result = compileEpsil(ce, source);
    expect(result.success).toBe(true);
    expect(routes(result)).toEqual(['pool']);
    const { pool } = workerPool(2);
    ce.workers = pool;
    const H = [1, 2, 3, 4];
    const { value, reports } = await runAsync(result, { H });
    expect(value).toEqual(result.run({ H }));
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) expect(r).toEqual({ passes: 9, route: 'pool' });
    expect(H).toEqual([1, 2, 3, 4]);
  }, 60_000);

  test('a function of the engine that the program calls', async () => {
    const ce = new ComputeEngine();
    ce.declare('H', 'list<number>');
    const definition =
      'function total(L: list<number>, n: integer) { let s = 0; parallel for k in 1..n { s += L[k] * k }; s }';
    expect(executeEpsil(ce, definition).diagnostics).toEqual([]);
    const { pool } = workerPool(2);
    ce.workers = pool;
    const H = [5, 6, 7, 8];
    // The second program calls the function from two places: `run()` calls
    // it through the last-call memo, the asynchronous copy without it.
    for (const [source, runs] of [
      ['total(H, 4)', 1],
      ['do { let a = total(H, 4); a + 1 }', 1],
      ['do { let a = total(H, 4); let b = total(H, 4); a + b }', 2],
    ] as const) {
      const result = compileEpsil(ce, source);
      expect(routes(result)).toEqual(['pool']);
      const { value, reports } = await runAsync(result, { H });
      expect(value).toEqual(result.run({ H }));
      expect(reports).toEqual(
        new Array(runs).fill({ passes: 4, route: 'pool' })
      );
    }
  }, 60_000);

  // Each loop runs in order, with the reason `'position'`: `onLoop` is not
  // called, and the value is the value of `run()`.
  test.each([
    ['an operand', 'total(H, 4) + 1'],
    ['an argument of a call', 'max(total(H, 4), 1)'],
    ['a callback of `map`', 'map((x) => total(H, x), [1, 2])'],
    ['an argument of `WithRandomSeed`', 'WithRandomSeed(7, total(H, 4))'],
    [
      'two calls in one statement',
      'do { let a = total(H, 4) + total(H, 2); a }',
    ],
    [
      'a function of a block with a default value of a parameter',
      'do { function g(m: integer, c: integer = 2) { let s = 0; parallel for k in 1..m { s += k * c }; s }; g(4) }',
    ],
    [
      'a function of a block that is also called as an operand',
      'do { function g(m: integer) { let s = 0; parallel for k in 1..m { s += k }; s }; let a = g(4); a + max(g(2), 1) }',
    ],
    [
      'the body of another `parallel for`',
      'do { let s = 0; parallel for j in [1, 2] { parallel for k in 1..4 { s += k * j } }; s }',
    ],
  ])('%s', async (_name, source) => {
    const ce = new ComputeEngine();
    ce.declare('H', 'list<number>');
    const definition =
      'function total(L: list<number>, n: integer) { let s = 0; parallel for k in 1..n { s += L[k] * k }; s }';
    expect(executeEpsil(ce, definition).diagnostics).toEqual([]);
    const result = compileEpsil(ce, source);
    expect(result.success).toBe(true);
    expect(routes(result)).toContain('in-order:position');
    expect(routes(result)).not.toContain('pool');
    expect(result.parallelCode).toBeUndefined();
    const { pool, log } = workerPool(2);
    ce.workers = pool;
    expect(result.willParallelize()).toBe(false);
    const H = [5, 6, 7, 8];
    const { value, reports } = await runAsync(result, { H });
    expect(value).toEqual(result.run({ H }));
    expect(reports).toEqual([]);
    expect(log.calls).toBe(0);
  }, 60_000);

  // `g` is `async` in the copy only because it awaits `f`, and it has no
  // loop of its own. Its use as an operand is not a waited call, so the loop
  // of `f`, which `g` awaits, runs in order; the loop of the program waits.
  test.each([
    ['an argument of `sum`', 'let s = sum(g(H, n)); s + M[1]'],
    ['an operand of `+`', 'let a = g(H, n) + 1; a + M[1]'],
  ])(
    'a function that only awaits another function, as %s',
    async (_name, tail) => {
      const ce = new ComputeEngine();
      ce.declare('H', 'list<integer>');
      ce.declare('n', 'integer');
      const source = `do {
        function f(H: list<integer>, n: integer) -> list<integer> { let L = H; parallel for k in 1..n { L[k % 3 + 1] += 1 }; L }
        function g(H: list<integer>, n: integer) -> list<integer> { f(H, n) }
        let M = H
        parallel for k in 1..n { M[k % 3 + 1] += 1 }
        ${tail}
      }`;
      const result = compileEpsil(ce, source);
      expect(result.success).toBe(true);
      expect(routes(result)).toEqual(['in-order:position', 'pool']);
      const { pool } = workerPool(2);
      ce.workers = pool;
      const rejections: unknown[] = [];
      const onRejection = (e: unknown) => rejections.push(e);
      process.on('unhandledRejection', onRejection);
      try {
        const H = [1, 2, 3, 4];
        const { value, reports } = await runAsync(result, { H, n: 9 });
        expect(value).toEqual(result.run({ H, n: 9 }));
        expect(reports).toEqual([{ passes: 9, route: 'pool' }]);
        await sleep(20);
      } finally {
        process.off('unhandledRejection', onRejection);
      }
      expect(rejections).toEqual([]);
    },
    60_000
  );
});

describe('the loops that run in order', () => {
  // A condition of the compiler: `onLoop` is not called, and the value is
  // the value of `run()`.
  test.each([
    [
      'condition 2: a loop over a list',
      'do { let s = 0; parallel for x in [1, 2, 3] { s += x }; s }',
      'in-order:domain',
      {},
    ],
    [
      'condition 3: the complex mode',
      'do { let s = 0; parallel for k in 1..3 { s += k }; s }',
      'in-order:mode',
      { mode: 'complex' },
    ],
    [
      'condition 4: a read of an accumulator',
      'do { let L = [1, 2, 3]; parallel for k in 1..2 { L[k] += L[k + 1] }; L }',
      'in-order:accumulator-read',
      {},
    ],
    [
      'condition 6: a body that reads a function value',
      'do { let h = (x) => x + 1; let s = 0; parallel for k in 1..3 { s += h(k) }; s }',
      'in-order:function-value',
      {},
    ],
    [
      'condition 7: a pass that draws',
      'do { let s = 0; parallel for k in 1..3 { s += random() * 0 + k }; s }',
      'in-order:not-shippable',
      {},
    ],
    [
      'condition 8: a program compiled with `iterationBudget`',
      'do { let s = 0; parallel for k in 1..3 { s += k }; s }',
      'in-order:iteration-budget',
      { iterationBudget: 1000 },
    ],
  ])('%s', async (_name, source, route, options) => {
    const ce = new ComputeEngine();
    const result = compileEpsil(ce, source, options);
    expect(routes(result)).toEqual([route]);
    const { pool, log } = workerPool(2);
    ce.workers = pool;
    const { value, reports } = await runAsync(result, undefined);
    expect(value).toEqual(result.run());
    expect(reports).toEqual([]);
    expect(log.calls).toBe(0);
  }, 60_000);

  test('condition 5: an assignment to an outer variable, and a jump, built as MathJSON', async () => {
    const ce = new ComputeEngine();
    const declare = (name: string) => [
      'Declare',
      name,
      ['Dictionary', ['KeyValuePair', "'value'", 0]],
    ];
    const programs = [
      [
        'Block',
        declare('t'),
        declare('s'),
        [
          'ParallelLoop',
          ['Block', ['Assign', 't', 'k'], ['AddTo', 's', 'k']],
          ['Element', 'k', ['Range', 1, 4]],
        ],
        ['Add', ['Multiply', 't', 100], 's'],
      ],
      [
        'Block',
        declare('s'),
        [
          'ParallelLoop',
          [
            'Block',
            ['AddTo', 's', 'k'],
            ['If', ['Greater', 'k', 2], ['Break']],
          ],
          ['Element', 'k', ['Range', 1, 5]],
        ],
        's',
      ],
    ];
    const { pool, log } = workerPool(2);
    ce.workers = pool;
    for (const [program, route] of [
      [programs[0], 'in-order:outer-write'],
      [programs[1], 'in-order:jump'],
    ] as const) {
      const result = compile(ce.box(program as never), {
        fallback: false,
      } as never) as never as Compiled;
      expect(routes(result)).toEqual([route]);
      const { value, reports } = await runAsync(result, undefined);
      expect(value).toEqual(result.run());
      expect(reports).toEqual([]);
    }
    expect(log.calls).toBe(0);
  }, 60_000);

  test('a list of fixed width that the passes read is passed whole', async () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const result = compileEpsil(
      ce,
      'do { let v = [1.5, 2.5]; let s = 0; parallel for k in 1..n { s += v[1] * k + v[2] }; s }'
    );
    const { pool } = workerPool(2);
    ce.workers = pool;
    expect(routes(result)).toEqual(['pool']);
    const { value, reports } = await runAsync(result, { n: 4 });
    expect(value).toEqual(result.run({ n: 4 }));
    expect(value).toBe(1.5 * 10 + 2.5 * 4);
    expect(reports).toEqual([{ passes: 4, route: 'pool' }]);
  }, 60_000);

  const LOOP = 'do { let s = 0; parallel for k in 1..n { s += k }; s }';

  test('a program with no pool runs in order, with the reason `no-pool`', async () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const result = compileEpsil(ce, LOOP);
    expect(routes(result)).toEqual(['pool']);
    expect(result.willParallelize()).toBe(false);
    const { value, reports } = await runAsync(result, { n: 10 });
    expect(value).toBe(55);
    expect(reports).toEqual([
      { passes: 10, route: 'calling-thread', reason: 'no-pool' },
    ]);
  });

  test('a count under `minPasses` runs in order, with the reason `below-threshold`', async () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const result = compileEpsil(ce, LOOP);
    const { pool, log } = workerPool(2);
    ce.workers = pool;
    // The default threshold is 20 000 passes.
    const { value, reports } = await runAsync(
      result,
      { n: 100 },
      { minPasses: undefined }
    );
    expect(value).toBe(5050);
    expect(reports).toEqual([
      { passes: 100, route: 'calling-thread', reason: 'below-threshold' },
    ]);
    const second = await runAsync(result, { n: 100 }, { minPasses: 101 });
    expect(second.reports[0].reason).toBe('below-threshold');
    expect(log.calls).toBe(0);
  }, 60_000);

  test('private lists of more than 16 million numbers run in order, with the reason `too-large`', async () => {
    const ce = new ComputeEngine();
    ce.declare('H', 'list<integer>');
    const result = compileEpsil(
      ce,
      'do { let L = H; parallel for k in 1..3 { L[k] += 1 }; L }'
    );
    expect(routes(result)).toEqual(['pool']);
    const { pool, log } = workerPool(2);
    ce.workers = pool;
    // Two workers, each with a private list of 8 000 001 numbers.
    const H = new Array(8_000_001).fill(0);
    const { value, reports } = await runAsync(result, { H });
    expect(reports).toEqual([
      { passes: 3, route: 'calling-thread', reason: 'too-large' },
    ]);
    expect((value as number[]).slice(0, 4)).toEqual([1, 1, 1, 0]);
    expect(log.calls).toBe(0);
  }, 60_000);

  test('a pool whose workers hold another runtime version: the first run completes on the calling thread, then the pool is unusable', async () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const result = compileEpsil(ce, LOOP);
    const pool = createKernelPool({
      size: 2,
      create: () => {
        const handlers: ((m: unknown) => void)[] = [];
        setTimeout(() =>
          handlers.forEach((h) =>
            h({
              type: 'ready',
              runtimeVersion: '0.0.0',
              intervalRuntimeVersion: '0.0.0',
            })
          )
        );
        return {
          postMessage: () => undefined,
          terminate: () => undefined,
          on: (event: string, handler: (m: unknown) => void) => {
            if (event === 'message') handlers.push(handler);
          },
        };
      },
    });
    pools.push(pool);
    ce.workers = pool;
    expect(result.willParallelize()).toBe(true);
    const first = await runAsync(result, { n: 10 });
    expect(first.value).toBe(55);
    expect(first.reports).toEqual([
      { passes: 10, route: 'calling-thread', reason: 'pool-declined' },
    ]);
    expect(result.willParallelize()).toBe(false);
    const second = await runAsync(result, { n: 10 });
    expect(second.value).toBe(55);
    expect(second.reports).toEqual([
      { passes: 10, route: 'calling-thread', reason: 'pool-unusable' },
    ]);
  });
});

describe('willParallelize', () => {
  test('true for a loop inside a called function, false with no pool and under the threshold', () => {
    const ce = new ComputeEngine();
    ce.declare('H', 'list<number>');
    const definition =
      'function total(L: list<number>, n: integer) { let s = 0; parallel for k in 1..n { s += L[k] * k }; s }';
    expect(executeEpsil(ce, definition).diagnostics).toEqual([]);
    const result = compileEpsil(ce, 'do { let a = total(H, 4); a }');
    expect(result.willParallelize()).toBe(false);
    expect(result.willParallelize(1_000_000)).toBe(false);
    const { pool } = workerPool(2);
    ce.workers = pool;
    expect(result.willParallelize()).toBe(true);
    expect(result.willParallelize(20_000)).toBe(true);
    expect(result.willParallelize(19_999)).toBe(false);
    // A program with no loop that can wait.
    expect(compileEpsil(ce, 'total(H, 4) + 1').willParallelize()).toBe(false);
  });
});

describe('values', () => {
  // Each pass writes `k * k` to its own element, so each pass of a
  // sub-range must give the value of the same pass of `run()`.
  test.each([
    ['an integer range', 'Range(1, 7)', 1, 1, 7],
    ['a negative step', 'Range(4, -3, -1.5)', 4, -1.5, 5],
    ['bounds that are not integers', 'Range(0.25, 2.5, 0.375)', 0.25, 0.375, 7],
    ['a step that is not exact in binary', 'Range(0.1, 1.05, 0.1)', 0.1, 0.1, 10],
  ])('the passes of %s', async (_name, range, first, step, count) => {
    const ce = new ComputeEngine();
    const result = compileEpsil(
      ce,
      `do {
        let L = [0 for j in 1..${count}]
        parallel for k in ${range} {
          L[round((k - ${first}) / ${step}) + 1] += k * k
        }
        L
      }`
    );
    expect(routes(result)).toEqual(['pool']);
    const { pool } = workerPool(3);
    ce.workers = pool;
    const { value, reports } = await runAsync(result, undefined);
    expect(value).toEqual(result.run());
    expect(reports).toEqual([{ passes: count, route: 'pool' }]);
  }, 60_000);

  test('an accumulator of integers is equal to run(), one of real numbers is within the bound', async () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const result = compileEpsil(
      ce,
      `do {
        let c = 0
        let s = 0.0
        let L = [0, 0, 0]
        parallel for k in 1..n {
          c += k * k
          s += 1 / k
          L[k % 3 + 1] += k
        }
        [c, s, L[1], L[2], L[3]]
      }`
    );
    expect(routes(result)).toEqual(['pool']);
    const { pool } = workerPool(3);
    ce.workers = pool;
    const n = 30_000;
    const expected = result.run({ n }) as number[];
    const { value, reports } = await runAsync(result, { n });
    const v = value as number[];
    expect(reports).toEqual([{ passes: n, route: 'pool' }]);
    // The integers stay below 2^53: equal.
    expect([v[0], v[2], v[3], v[4]]).toEqual([
      expected[0],
      expected[2],
      expected[3],
      expected[4],
    ]);
    // The sum of `n` positive terms `1/k`. Each grouping makes at most
    // `n - 1` additions, each with a relative error of at most 2^-53 of a
    // partial sum, which is at most the whole sum S. So each computed sum is
    // within (n - 1) · 2^-53 · S of the exact sum, and the two computed sums
    // within 2 · n · 2^-53 · S of each other.
    const S = expected[1];
    expect(Math.abs(v[1] - S)).toBeLessThanOrEqual(2 * n * 2 ** -53 * S);
  }, 60_000);

  test('the input list, and a second variable that holds the list of the accumulator, are not changed', async () => {
    const ce = new ComputeEngine();
    ce.declare('H', 'list<integer>');
    const result = compileEpsil(
      ce,
      `do {
        function f(H: list<integer>, n: integer) {
          let L = H
          const before = L
          parallel for k in 1..n { L[k % 3 + 1] += 1 }
          [before, L]
        }
        f(H, 9)
      }`
    );
    expect(routes(result)).toEqual(['pool']);
    const { pool } = workerPool(2);
    ce.workers = pool;
    const H = [1, 2, 3, 4];
    const { value, reports } = await runAsync(result, { H });
    expect(reports).toEqual([{ passes: 9, route: 'pool' }]);
    expect(value).toEqual(result.run({ H }));
    expect(value).toEqual([
      [1, 2, 3, 4],
      [4, 5, 6, 4],
    ]);
    expect(H).toEqual([1, 2, 3, 4]);
  }, 60_000);

  test('the engine iteration limit, set below the default of the worker, makes the same pass throw as in run()', async () => {
    // Pass `k` walks `TakeWhile(1..∞, j ↦ j < 30 k)`, `30 k - 1` steps of
    // the lazy stream: under a limit of 100, pass 4 is the first to throw.
    const ce = new ComputeEngine();
    const program = ce.box([
      'Block',
      ['Declare', 's', ['Dictionary', ['KeyValuePair', "'value'", 0]]],
      [
        'ParallelLoop',
        [
          'AddTo',
          's',
          [
            'Length',
            [
              'TakeWhile',
              ['Range', 1, 'PositiveInfinity'],
              ['Function', ['Less', 'j', ['Multiply', 30, 'k']], 'j'],
            ],
          ],
        ],
        ['Element', 'k', ['Range', 1, 6]],
      ],
      's',
    ] as never);
    const result = compile(program, {
      fallback: false,
    } as never) as never as Compiled;
    expect(routes(result)).toEqual(['pool']);
    const { pool } = workerPool(2);
    ce.workers = pool;
    expect((await runAsync(result, undefined)).value).toBe(result.run());
    ce.iterationLimit = 100;
    expect(() => result.run()).toThrow(/Iteration limit of 100 exceeded/);
    const reports: ParallelLoopReport[] = [];
    await expect(
      result.runAsync(undefined, {
        minPasses: 1,
        onLoop: (r) => reports.push(r),
      })
    ).rejects.toThrow(/Iteration limit of 100 exceeded/);
    // The workers failed on a pass, and the calling thread ran the passes
    // of the failed sub-range again.
    expect(reports).toEqual([
      { passes: 6, route: 'calling-thread', reason: 'pool-declined' },
    ]);
  }, 60_000);

  test('the reconstruction digits are those of the program after a wait, and two pending calls do not disturb each other', async () => {
    // `(-8)^e` for the float `e = 0.333333333333333`: read to the 17 digits
    // that the compilation recorded, `e` is not 1/3, and the value is NaN.
    // Read to 15 digits (the precision set after the compilation, which
    // the helpers use when no compiled code sets the digits), `e` is 1/3,
    // and the value is about -2.
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    ce.declare('e', 'real');
    const result = compileEpsil(
      ce,
      'do { let s = 0; parallel for k in 1..n { s += k }; s + (-8)^e }'
    );
    expect(routes(result)).toEqual(['pool']);
    ce.precision = 15;
    const { pool } = workerPool(2);
    ce.workers = pool;
    const e = 0.333333333333333;
    const expected = result.run({ n: 10, e });
    const other = result.run({ n: 20, e });
    expect(expected).toBeNaN();
    // With no digits set, the value is real.
    expect(setReconstructionDigits(undefined)).toBeUndefined();
    expect(compileEpsil(ce, '(-8)^e').run({ e })).toBeCloseTo(-2, 10);
    const [a, b] = await Promise.all([
      runAsync(result, { n: 10, e }),
      runAsync(result, { n: 20, e }),
      // A `run()` while both calls wait.
      (async () => {
        await sleep(0);
        expect(result.run({ n: 10, e })).toEqual(expected);
      })(),
    ]);
    expect(a.value).toEqual(expected);
    expect(b.value).toEqual(other);
    expect(a.reports).toEqual([{ passes: 10, route: 'pool' }]);
    // The digits of the caller are set again when the calls end.
    expect(setReconstructionDigits(undefined)).toBeUndefined();
  }, 60_000);

  test('two pending calls of results with different digits each give the value of their run()', async () => {
    // The same program compiled with 17 digits (`(-8)^e` is NaN) and with
    // 15 digits (`(-8)^e` is about -2).
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    ce.declare('e', 'real');
    const source =
      'do { let s = 0; parallel for k in 1..n { s += k }; s + (-8)^e }';
    const a = compileEpsil(ce, source);
    ce.precision = 15;
    const b = compileEpsil(ce, source);
    const { pool } = workerPool(2);
    ce.workers = pool;
    const e = 0.333333333333333;
    const expectedA = a.run({ n: 10, e });
    const expectedB = b.run({ n: 20, e });
    expect(expectedA).toBeNaN();
    expect(expectedB).toBeCloseTo(210 - 2, 10);
    const [ra, rb] = await Promise.all([
      runAsync(a, { n: 10, e }),
      runAsync(b, { n: 20, e }),
    ]);
    expect(ra.value).toEqual(expectedA);
    expect(rb.value).toEqual(expectedB);
    expect(ra.reports).toEqual([{ passes: 10, route: 'pool' }]);
    expect(rb.reports).toEqual([{ passes: 20, route: 'pool' }]);
    expect(setReconstructionDigits(undefined)).toBeUndefined();
  }, 60_000);

  test('a runAsync() started from an onLoop callback of another result leaves the digits that were current before', async () => {
    const current = () => {
      const d = setReconstructionDigits(undefined);
      setReconstructionDigits(d);
      return d;
    };
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const source = 'do { let s = 0; parallel for k in 1..n { s += k }; s }';
    // 17 digits, then 15 digits.
    const a = compileEpsil(ce, source);
    ce.precision = 15;
    const b = compileEpsil(ce, source);
    const { pool } = workerPool(2);
    ce.workers = pool;
    expect(current()).toBeUndefined();
    const seen: (number | undefined)[] = [];
    let inner: Promise<unknown> | undefined;
    // The loop of `a` runs under the threshold: `onLoop` is called while the
    // program of `a` runs, and it starts `b`, whose loop runs on the pool.
    const value = await a.runAsync(
      { n: 10 },
      {
        minPasses: 1000,
        onLoop: () => {
          seen.push(current());
          inner ??= b.runAsync(
            { n: 20 },
            { minPasses: 1, onLoop: () => seen.push(current()) }
          );
        },
      }
    );
    expect(value).toBe(a.run({ n: 10 }));
    expect(await inner).toBe(b.run({ n: 20 }));
    // Each `onLoop` ran with the digits of its caller.
    expect(seen).toEqual([undefined, undefined]);
    expect(current()).toBeUndefined();
  }, 60_000);

  test('a variable named `_run` does not hide the state of the run', async () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const result = compileEpsil(
      ce,
      'do { let _run = 0; parallel for k in 1..n { _run += k }; _run }'
    );
    expect(routes(result)).toEqual(['pool']);
    const { pool } = workerPool(2);
    ce.workers = pool;
    const { value, reports } = await runAsync(result, { n: 10 });
    expect(value).toBe(result.run({ n: 10 }));
    expect(value).toBe(55);
    expect(reports).toEqual([{ passes: 10, route: 'pool' }]);
  }, 60_000);
});

describe('errors and abort', () => {
  test('an error of a pass rejects with the error of run()', async () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const result = compileEpsil(
      ce,
      'do { let L = [0, 0, 0, 0, 0]; parallel for k in 1..n { L[k] += 1 }; L }'
    );
    expect(routes(result)).toEqual(['pool']);
    const { pool } = workerPool(2);
    ce.workers = pool;
    let message = '';
    try {
      result.run({ n: 8 });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe('');
    await expect(runAsync(result, { n: 8 })).rejects.toThrow(message);
  }, 60_000);

  test('a worker that fails: its sub-range runs on the calling thread', async () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const result = compileEpsil(
      ce,
      'do { let s = 0; parallel for k in 1..n { s += k }; s }'
    );
    const { pool, log } = workerPool(2, { failCalls: true });
    ce.workers = pool;
    const { value, reports } = await runAsync(result, { n: 100 });
    expect(value).toBe(5050);
    expect(log.calls).toBe(2);
    expect(reports).toEqual([
      { passes: 100, route: 'calling-thread', reason: 'pool-declined' },
    ]);
  }, 60_000);

  test('a signal aborted before the call rejects with its reason, and runs no statement', async () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const result = compileEpsil(
      ce,
      'do { let s = 0; parallel for k in 1..n { s += k }; s }'
    );
    const ctl = new AbortController();
    const reason = new Error('stop');
    ctl.abort(reason);
    const reports: ParallelLoopReport[] = [];
    await expect(
      result.runAsync(
        { n: 10 },
        { signal: ctl.signal, onLoop: (r) => reports.push(r) }
      )
    ).rejects.toBe(reason);
    expect(reports).toEqual([]);
  });

  test('an abort during the wait rejects with its reason', async () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    // Each pass runs an inner loop of 200 000 steps.
    const result = compileEpsil(
      ce,
      'do { let s = 0; parallel for k in 1..n { let t = 0; for j in 1..200000 { t = t + j % 7 }; s += t }; s }'
    );
    expect(routes(result)).toEqual(['pool']);
    const { pool, log } = workerPool(2, { cancelGrace: 100 });
    ce.workers = pool;
    await pool.prewarm();
    const ctl = new AbortController();
    const reason = new Error('aborted');
    const pending = result.runAsync(
      { n: 100_000 },
      { signal: ctl.signal, minPasses: 1 }
    );
    while (log.calls < 2) await sleep(5);
    await sleep(50);
    const t0 = Date.now();
    ctl.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(Date.now() - t0).toBeLessThan(1000);
  }, 60_000);

  // The program leaves the thread with the digits of its caller. When the
  // wait rejects, the digits that are current when it continues (here set
  // by the host while the program waits) are the ones that it leaves.
  test('a rejected wait leaves the reconstruction digits that are current when the program continues', async () => {
    const current = () => {
      const d = setReconstructionDigits(undefined);
      setReconstructionDigits(d);
      return d;
    };
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    expect(current()).toBeUndefined();

    // An abort during the wait.
    const slow = compileEpsil(
      ce,
      'do { let s = 0; parallel for k in 1..n { let t = 0; for j in 1..200000 { t = t + j % 7 }; s += t }; s }'
    );
    expect(routes(slow)).toEqual(['pool']);
    const { pool, log } = workerPool(2, { cancelGrace: 100 });
    ce.workers = pool;
    await pool.prewarm();
    const ctl = new AbortController();
    const reason = new Error('aborted');
    const aborted = slow.runAsync(
      { n: 100_000 },
      { signal: ctl.signal, minPasses: 1 }
    );
    while (log.calls < 2) await sleep(5);
    setReconstructionDigits(12);
    ctl.abort(reason);
    try {
      await expect(aborted).rejects.toBe(reason);
      expect(current()).toBe(12);
    } finally {
      setReconstructionDigits(undefined);
    }

    // A pass that throws: the sub-ranges run again on the calling thread,
    // and the first one throws.
    const failing = compileEpsil(
      ce,
      'do { let L = [0, 0, 0, 0, 0]; parallel for k in 1..n { L[k] += 1 }; L }'
    );
    expect(routes(failing)).toEqual(['pool']);
    const thrown = failing.runAsync({ n: 8 }, { minPasses: 1 });
    setReconstructionDigits(12);
    try {
      await expect(thrown).rejects.toThrow();
      expect(current()).toBe(12);
    } finally {
      setReconstructionDigits(undefined);
    }
  }, 60_000);

  test('the check of the inputs of run() rejects a complex value of a real input', async () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    ce.declare('e', 'real');
    const result = compileEpsil(
      ce,
      'do { let s = 0; parallel for k in 1..n { s += k }; s + e }'
    );
    const vars = { n: 2, e: { re: 3, im: 4 } };
    let message = '';
    try {
      result.run(vars);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe('');
    await expect(result.runAsync(vars)).rejects.toThrow(message);
  });
});

describe('run() does not change', () => {
  test('the code of run() has no wait, and a program with no loop that can wait runs run()', async () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const result = compileEpsil(
      ce,
      'do { let s = 0; parallel for k in 1..n { s += k }; s }'
    );
    expect(result.code).not.toContain('_run');
    expect(result.code).not.toContain('await');
    expect(result.parallelCode).toContain('await _run.s(');
    const plain = compileEpsil(ce, 'n + 1');
    expect(plain.parallelCode).toBeUndefined();
    expect(await plain.runAsync({ n: 2 })).toBe(3);
  });
});
