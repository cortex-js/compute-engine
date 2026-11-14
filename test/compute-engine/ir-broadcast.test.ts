import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ComputeEngine, createKernelPool } from '../../src/compute-engine';
import type { KernelPool } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { createJavaScriptRuntime } from '../../src/runtime';
import type { StoredJavaScript } from '../../src/runtime';
import type { BroadcastInputs } from '../../src/compute-engine/compilation/broadcast';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import { CancellationError } from '../../src/common/interruptible';
import { makeEngine } from './ir-slice-oracle';

// The batch and asynchronous members of a result of the profile `ir`
// (`ir/adapter.ts`): `broadcast()`, `broadcastAsync()`, `willUsePool()`,
// `runAsync()` and `willParallelize()`, built by the generic functions of
// the existing compiler. Each cell of a batch is the value of `run()` at that
// cell, and the batch has the shape and layout of the batch of the existing
// compiler for the same inputs.

type Json = unknown;
type JsResult = CompilationResult<'javascript'>;

const ce = makeEngine();
const box = (json: Json, engine: ComputeEngine = ce): Expression =>
  engine.box(json as never);

function ir(json: Json, options: Record<string, unknown> = {}): JsResult {
  const r = compile(box(json), {
    profile: 'ir',
    fallback: false,
    ...options,
  } as never) as JsResult;
  expect(r.profile).toBe('ir');
  return r;
}

const xs = new Float64Array([-1.5, 0, 0.5, 2]);
const ys = new Float64Array([0.25, -3]);
const D = [1.5, -2, 4];

// Each program, the inputs of a `cells` batch (or `undefined`) and of a
// `grid` batch, the options of `compile()` and those of `broadcast()`.
const PROGRAMS: [
  string,
  Json,
  BroadcastInputs | undefined,
  BroadcastInputs,
  object,
  { outputs?: number; indexes?: string[] },
][] = [
  [
    'a scalar of two inputs',
    ['Add', ['Power', 'x', 2], ['Multiply', ['Sin', 'y'], 'x']],
    { x: xs, y: new Float64Array([1, 2, 3, 4]) },
    { x: xs, y: ys },
    {},
    {},
  ],
  [
    'a shared list read by At',
    ['Add', ['At', 'D', 1], ['Multiply', 'x', ['At', 'D', 3]]],
    { x: xs, D },
    { x: xs, D: new Float64Array(D) },
    {},
    {},
  ],
  [
    'a reduction and the Length of a shared list',
    [
      'Add',
      ['Length', 'D'],
      ['Multiply', 'x', ['Sum', ['At', 'D', 'k'], ['Limits', 'k', 1, 3]]],
    ],
    { x: xs, D },
    { x: xs, D },
    {},
    {},
  ],
  [
    'an index axis',
    ['Add', ['At', 'D', ['Add', 'n', 1]], 'x'],
    undefined,
    { x: xs, n: 3, D },
    {},
    { indexes: ['n'] },
  ],
  [
    'a boolean column',
    ['If', 'p', 'x', ['Negate', 'x']],
    { x: xs, p: [true, false, false, true] },
    { x: xs, p: [true, false] },
    {},
    {},
  ],
  [
    'a list of two values, with two outputs per cell',
    ['List', 'x', ['Multiply', 2, 'y']],
    { x: xs, y: xs },
    { x: xs, y: ys },
    {},
    { outputs: 2 },
  ],
  [
    'a vars entry that reads the inputs object',
    ['Add', 'x', ['Multiply', 2, 'u']],
    { x: xs, u: new Float64Array([1, 2, 3, 4]) },
    { x: xs, u: ys },
    { vars: { u: '_.u' } },
    {},
  ],
  [
    'a complex input in the complex mode',
    ['Multiply', 'Z', 'x'],
    { x: xs, Z: new Float64Array([1, 2, 3, 4]) },
    { x: xs, Z: ys },
    { mode: 'complex' },
    {},
  ],
];

/** The inputs of cell `c` of a batch, as `broadcast()` reads them (`D` is
 * the shared list). */
function cellInputs(
  inputs: BroadcastInputs,
  layout: 'cells' | 'grid',
  c: number,
  indexes: string[] = []
): Record<string, unknown> {
  const vars: Record<string, unknown> = {};
  let rest = c;
  for (const [name, v] of Object.entries(inputs)) {
    if (name === 'D') {
      vars[name] = Array.from(v as ArrayLike<number>);
      continue;
    }
    if (indexes.includes(name)) {
      vars[name] = rest % (v as number);
      rest = Math.floor(rest / (v as number));
      continue;
    }
    const col = v as ArrayLike<number | boolean>;
    if (layout === 'cells') vars[name] = col[c];
    else {
      vars[name] = col[rest % col.length];
      rest = Math.floor(rest / col.length);
    }
  }
  return vars;
}

function numberOf(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const z = v as { re?: number; im?: number } | null;
  if (typeof z?.re === 'number' && z.im === 0) return z.re;
  return NaN;
}

const runOf = (r: JsResult) => r.run as (v: unknown) => unknown;

describe('broadcast() of the profile ir', () => {
  test.each(PROGRAMS)('%s', (_, json, cells, grid, options, bopts) => {
    const r = ir(json, options);
    const old = compile(box(json), { fallback: false, ...options } as never);
    expect(old.profile).not.toBe('ir');
    const m = bopts.outputs ?? 1;
    const batches: ['cells' | 'grid', BroadcastInputs][] = [['grid', grid]];
    if (cells !== undefined) batches.push(['cells', cells]);
    for (const [layout, inputs] of batches) {
      const got = r.broadcast!(inputs, { layout, ...bopts });
      expect(Array.from(got)).toEqual(
        Array.from(old.broadcast!(inputs, { layout, ...bopts }))
      );
      for (let c = 0; c < got.length / m; c++) {
        const value = runOf(r)(cellInputs(inputs, layout, c, bopts.indexes));
        const want = m === 1 ? [value] : (value as unknown[]);
        for (let k = 0; k < m; k++) {
          const w = numberOf(want[k]);
          if (Number.isNaN(w)) expect(got[m * c + k]).toBeNaN();
          else expect(got[m * c + k]).toBeCloseTo(w, 12);
        }
      }
      // No program of the list gives NaN in every cell.
      expect(got.some((v) => !Number.isNaN(v))).toBe(true);
      // With `out`: the same values, written into the caller's array.
      const out = new Float64Array(got.length + 2).fill(-7);
      expect(r.broadcast!(inputs, { layout, out, ...bopts })).toBe(out);
      expect(Array.from(out.subarray(0, got.length))).toEqual(Array.from(got));
      expect(Array.from(out.subarray(got.length))).toEqual([-7, -7]);
    }
  });

  test('a Loop over its iterationBudget is a NaN cell, and the count is reset per cell', () => {
    const json = [
      'Block',
      ['Declare', 's', { dict: { value: 0 } }],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', 'x']],
        ['Element', 'k', ['Range', 1, 'n']],
      ],
      's',
    ];
    const r = ir(json, { iterationBudget: 10 });
    const inputs = { x: 2, n: new Float64Array([5, 20, 10, 3]) };
    const got = Array.from(r.broadcast!(inputs));
    expect(got).toEqual([10, NaN, 20, 6]);
    expect(got).toEqual(
      Array.from(compile(box(json), { iterationBudget: 10 }).broadcast!(inputs))
    );
    expect(runOf(r)({ x: 2, n: 4 })).toBe(8);
  });

  test('a timeout in a cell stops the batch: broadcast() throws it, as run() does', () => {
    const r = ir(['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 'n']]);
    const inputs = { x: new Float64Array(2000).fill(1), n: 100_000 };
    expect(() => ce.withTimeLimit(5, () => r.broadcast!(inputs))).toThrow(
      CancellationError
    );
    expect(() => ce.withTimeLimit(5, () => runOf(r)({ x: 1, n: 1e9 }))).toThrow(
      CancellationError
    );
  });

  test('a cells batch with columns of different lengths throws as the existing one', () => {
    const json = ['Add', 'x', 'y'];
    const inputs = { x: xs, y: ys };
    expect(() => ir(json).broadcast!(inputs)).toThrow(
      (() => {
        try {
          compile(box(json)).broadcast!(inputs);
        } catch (e) {
          return (e as Error).message;
        }
        return 'no error';
      })()
    );
  });

  test('the option broadcast: true is admitted and builds the same members', () => {
    const r = ir(['Add', 'x', 1], { broadcast: true });
    expect(Array.from(r.broadcast!({ x: xs }))).toEqual([-0.5, 1, 1.5, 3]);
    expect(ir(['Add', 'x', 1]).broadcast).toBeDefined();
  });

  test("the mode 'bigint' refuses a batch with the existing error", async () => {
    const json = ['Add', 'n', 1];
    const r = ir(json, { mode: 'bigint' });
    const old = compile(box(json), { mode: 'bigint' });
    const message = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as Error).message;
      }
      return 'no error';
    };
    const inputs = { n: new Float64Array([1, 2]) };
    expect(message(() => r.broadcast!(inputs))).toBe(
      message(() => old.broadcast!(inputs))
    );
    expect(message(() => r.broadcast!(inputs))).toMatch(/mode 'bigint'/);
    await expect(r.broadcastAsync!(inputs)).rejects.toThrow(/mode 'bigint'/);
    expect(r.willUsePool!(1e6)).toBe(false);
  });

  test('a lambda has no batch member', () => {
    const r = ir(['Function', ['Add', 'u', 1], 'u']);
    expect(r.calling).toBe('lambda');
    expect(r.broadcast).toBeUndefined();
    expect(r.runAsync).toBeUndefined();
  });

  test('the stored result loads with loadBroadcast() and gives the same array', () => {
    const r = ir(['Add', ['At', 'D', 2], ['Multiply', 'x', 'y']]);
    const stored = JSON.parse(JSON.stringify(r)) as StoredJavaScript;
    const inputs = { x: xs, y: new Float64Array([1, 2, 3, 4]), D };
    const batch = createJavaScriptRuntime().loadBroadcast(stored);
    expect(Array.from(batch(inputs))).toEqual(Array.from(r.broadcast!(inputs)));
    expect(Array.from(batch({ x: xs, y: ys, D }, { layout: 'grid' }))).toEqual(
      Array.from(r.broadcast!({ x: xs, y: ys, D }, { layout: 'grid' }))
    );
  });
});

describe('runAsync() of the profile ir', () => {
  test('resolves to the value of run(), with no parallel loop', async () => {
    const r = ir(['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 10]]);
    expect(await r.runAsync!({ x: 2 })).toBe(
      (r.run as (v: unknown) => unknown)({ x: 2 })
    );
    expect(await r.runAsync!({ x: 2 })).toBe(110);
    expect(r.willParallelize!()).toBe(false);
    expect(r.willParallelize!(1e9)).toBe(false);
  });
});

const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));

describe('broadcastAsync() of the profile ir with a pool', () => {
  let pool: KernelPool;
  const engine = makeEngine();

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
      size: 1,
    });
    engine.workers = pool;
    await pool.prewarm();
  }, 60_000);

  afterAll(() => pool.dispose());

  const big = Float64Array.from({ length: 100_000 }, (_, i) => i / 1000 - 50);

  test('a shippable result runs on the pool and gives the array of broadcast()', async () => {
    const json = ['Add', ['At', 'D', 2], ['Multiply', ['Sin', 'x'], 'x']];
    const r = compile(box(json, engine), {
      profile: 'ir',
      fallback: false,
    }) as JsResult;
    expect(r.shippable).toBe(true);
    expect(r.willUsePool!(100_000)).toBe(true);
    const inputs = { x: big, D };
    const res = await r.broadcastAsync!(inputs);
    expect(res.route).toBe('pool');
    expect(res.done).toBe(100_000);
    expect(Array.from(res.out)).toEqual(Array.from(r.broadcast!(inputs)));
  }, 30_000);

  test('a result with a draw stays on the calling thread', async () => {
    const r = compile(box(['Add', 'x', ['Random']], engine), {
      profile: 'ir',
      fallback: false,
    }) as JsResult;
    expect(r.shippable).toBe(false);
    expect(r.willUsePool!(100_000)).toBe(false);
    const res = await r.broadcastAsync!({ x: big });
    expect(res.route).toBe('calling-thread');
    expect(res.reason).toBe('not-shippable');
    expect(res.done).toBe(100_000);
  }, 30_000);

  test('a vars text that reads the inputs object is shippable', async () => {
    const json = ['Add', 'x', ['Multiply', 2, 'u']];
    const ok = compile(box(json, engine), {
      profile: 'ir',
      fallback: false,
      vars: { u: '_.u' },
    }) as JsResult;
    expect(ok.shippable).toBe(true);
    const inputs = { x: big, u: 3 };
    const res = await ok.broadcastAsync!(inputs);
    expect(res.route).toBe('pool');
    expect(Array.from(res.out)).toEqual(Array.from(ok.broadcast!(inputs)));
    const host = compile(box(json, engine), {
      profile: 'ir',
      fallback: false,
      vars: { u: 'globalThis.u' },
    }) as JsResult;
    expect(host.shippable).toBe(false);
  }, 30_000);

  test('a timeout in a cell on a worker stops the batch: the cells before done are valid', async () => {
    const json = [
      'Block',
      ['Declare', 's', { dict: { value: 0 } }],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', 'x']],
        ['Element', 'k', ['Range', 1, 'n']],
      ],
      's',
    ];
    const r = compile(box(json, engine), {
      profile: 'ir',
      fallback: false,
    }) as JsResult;
    const n = new Float64Array(40_000).fill(200_000);
    const res = await r.broadcastAsync!({ x: 1, n }, { deadline: 60 });
    expect(res.route).toBe('pool');
    expect(res.done).toBeLessThan(40_000);
    expect(res.failed).toBe(0);
    expect(res.out.subarray(0, res.done).every((v) => v === 200_000)).toBe(
      true
    );
  }, 30_000);
});
