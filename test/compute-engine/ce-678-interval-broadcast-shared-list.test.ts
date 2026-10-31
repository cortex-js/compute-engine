/**
 * CE-678: the `broadcast()` of an `interval-js` result accepts a list input,
 * as `run()` does. With `L` declared `list<number>`, the code of
 * `x + Sum(L)` reads `L` as a list. `run({ x: { lo: 1, hi: 1 }, L: [1, 2] })`
 * gave the point 4, but `broadcast({ x: new Float64Array([1, 1, 2, 2]),
 * L: [1, 2] })` threw "the input for "L" must be a Float64Array or a number".
 *
 * Now such a variable is a shared input, as on the `javascript` target: it
 * is bound once for the whole batch, and its elements are converted to
 * intervals once, before the cell loop, as `run()` converts a list input
 * (`processInput`). The value is a plain array of numbers and `{ lo, hi }`
 * objects. A `Float64Array` throws, because an `interval-js` `Float64Array`
 * input is read as `lo, hi` pairs: `[1, 2]` would be one interval, not two
 * elements (user decision 2026-10-30, option (a)).
 */

import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ComputeEngine,
  createKernelPool,
  INTERVAL_KIND,
  type KernelPool,
} from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { createIntervalRuntime } from '../../src/interval';

const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));

function compiled(json: unknown, ce = new ComputeEngine()) {
  ce.declare('L', 'list<number>');
  const result = compile(ce.box(json as any), { to: 'interval-js' });
  expect(result.success).toBe(true);
  return result;
}

const SUM = ['Add', 'x', ['Sum', 'L']];

/** The `lo, hi, kind` triple of each cell of a batch. */
function triples(out: Float64Array): [number, number, number][] {
  const result: [number, number, number][] = [];
  for (let i = 0; i < out.length; i += 3)
    result.push([out[i], out[i + 1], out[i + 2]]);
  return result;
}

/** The `lo, hi, kind` triple of a `run()` result. */
function encode(v: any): [number, number, number] {
  if (v.kind === 'interval')
    return [v.value.lo, v.value.hi, INTERVAL_KIND.interval];
  if (v.kind === 'empty') return [NaN, NaN, INTERVAL_KIND.empty];
  throw new Error(`unexpected run() result ${JSON.stringify(v)}`);
}

describe('CE-678: interval-js broadcast() reads a shared list input', () => {
  test('a list of numbers: each cell is the point interval of run()', () => {
    const r = compiled(SUM);
    expect(r.run!({ x: { lo: 1, hi: 1 }, L: [1, 2] })).toEqual({
      kind: 'interval',
      value: { lo: 4, hi: 4 },
    });
    const out = r.broadcast!({ x: new Float64Array([1, 1, 2, 2]), L: [1, 2] });
    expect(triples(out)).toEqual([
      [4, 4, INTERVAL_KIND.interval],
      [5, 5, INTERVAL_KIND.interval],
    ]);
    expect(triples(out)).toEqual([
      encode(r.run!({ x: { lo: 1, hi: 1 }, L: [1, 2] })),
      encode(r.run!({ x: { lo: 2, hi: 2 }, L: [1, 2] })),
    ]);
  });

  test('a list of { lo, hi } objects, and a list that mixes both forms', () => {
    const r = compiled(SUM);
    const L = [
      { lo: 1, hi: 2 },
      { lo: -1, hi: 0 },
    ];
    const out = r.broadcast!({ x: new Float64Array([0, 1, 10, 10]), L });
    expect(triples(out)).toEqual([
      encode(r.run!({ x: { lo: 0, hi: 1 }, L })),
      encode(r.run!({ x: { lo: 10, hi: 10 }, L })),
    ]);
    expect(triples(out)[1]).toEqual([10, 12, INTERVAL_KIND.interval]);
    const mixed = [3, { lo: 0, hi: 1 }];
    expect(
      triples(r.broadcast!({ x: new Float64Array([1, 1]), L: mixed }))
    ).toEqual([encode(r.run!({ x: 1, L: mixed }))]);
  });

  test('a list read by index in each cell', () => {
    const r = compiled(['Multiply', 'x', ['At', 'L', 2]]);
    const out = r.broadcast!({ x: new Float64Array([1, 1, 2, 3]), L: [5, 7] });
    expect(triples(out)).toEqual([
      encode(r.run!({ x: 1, L: [5, 7] })),
      encode(r.run!({ x: { lo: 2, hi: 3 }, L: [5, 7] })),
    ]);
    expect(triples(out)[1]).toEqual([14, 21, INTERVAL_KIND.interval]);
  });

  test('an absent list: each cell is empty, as run() gives', () => {
    const r = compiled(SUM);
    expect(r.run!({ x: 1 })).toEqual({ kind: 'empty' });
    const out = r.broadcast!({ x: new Float64Array([1, 1, 2, 2]) });
    expect(out[2]).toBe(INTERVAL_KIND.empty);
    expect(out[5]).toBe(INTERVAL_KIND.empty);
  });

  test('an empty list', () => {
    const r = compiled(SUM);
    const out = r.broadcast!({ x: new Float64Array([1, 1, 2, 3]), L: [] });
    expect(triples(out)).toEqual([
      encode(r.run!({ x: 1, L: [] })),
      encode(r.run!({ x: { lo: 2, hi: 3 }, L: [] })),
    ]);
  });

  test('a Float64Array for a shared list throws and asks for a plain array', () => {
    const r = compiled(SUM);
    expect(() =>
      r.broadcast!({
        x: new Float64Array([1, 1]),
        L: new Float64Array([1, 2]),
      })
    ).toThrow(/plain array .*not a Float64Array/);
    expect(() => r.broadcast!({ x: new Float64Array([1, 1]), L: 3 })).toThrow(
      /must be a plain array/
    );
  });

  test('the `shared` option names a list the code does not read as a list', () => {
    // `y` has no list type: with the `shared` option, the plain array is
    // bound once for the batch, as `run()` binds it.
    const ce = new ComputeEngine();
    const r = compiled(['Add', 'x', 'y'], ce);
    expect(() =>
      r.broadcast!({ x: new Float64Array([1, 1]), y: [1, 2] })
    ).toThrow(/plain array is accepted only for a shared input/);
    const out = r.broadcast!(
      { x: new Float64Array([1, 1]), y: [1, 2] },
      { shared: ['y'] }
    );
    // `x + y` over a list is not an interval: `run()` gives `empty`.
    expect(triples(out)).toEqual([encode(r.run!({ x: 1, y: [1, 2] }))]);
    // The list `L` of `SUM`, also named in the option.
    const s = compiled(SUM);
    expect(
      triples(
        s.broadcast!(
          { x: new Float64Array([1, 1]), L: [1, 2] },
          { shared: ['L'] }
        )
      )
    ).toEqual([[4, 4, INTERVAL_KIND.interval]]);
    expect(() =>
      s.broadcast!({ x: new Float64Array([1, 1]) }, { shared: ['L'] })
    ).toThrow(/not a key of the inputs/);
  });

  test('the `outputs` option stays refused', () => {
    const r = compiled(SUM);
    expect(() =>
      r.broadcast!({ x: new Float64Array([1, 1]), L: [1] }, { outputs: 2 })
    ).toThrow(/`outputs` option is not supported by an interval-js result/);
  });

  test('a grid layout with a shared list', () => {
    const r = compiled(['Add', 'x', ['Multiply', 'y', ['Sum', 'L']]]);
    const out = r.broadcast!(
      {
        x: new Float64Array([0, 0, 1, 1]),
        y: new Float64Array([1, 1, 2, 2]),
        L: [1, 2],
      },
      { layout: 'grid' }
    );
    expect(triples(out).map((t) => t[0])).toEqual([3, 4, 6, 7]);
  });

  test('a runtime that loads the stored result reads the list the same way', () => {
    const r = compiled(SUM);
    expect(r.listInputs).toEqual(['L']);
    const rt = createIntervalRuntime();
    const stored = JSON.parse(JSON.stringify(r));
    const inputs = { x: new Float64Array([1, 1, 2, 2]), L: [1, 2] };
    expect(Array.from(rt.loadBroadcast(stored)(inputs))).toEqual(
      Array.from(r.broadcast!(inputs))
    );
  });

  test('broadcastAsync on the calling thread, in several slices', async () => {
    const r = compiled(SUM);
    const n = 3000;
    const xs = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) xs[2 * i] = xs[2 * i + 1] = i;
    const inputs = { x: xs, L: [1, { lo: 2, hi: 3 }] };
    const { out, done, route } = await r.broadcastAsync!(inputs, {
      chunk: 1000,
    });
    expect(done).toBe(n);
    expect(route).toBe('calling-thread');
    expect(Array.from(out)).toEqual(Array.from(r.broadcast!(inputs)));
    expect(triples(out)[7]).toEqual([10, 11, INTERVAL_KIND.interval]);
    await expect(
      r.broadcastAsync!({ x: xs, L: new Float64Array([1, 2]) })
    ).rejects.toThrow(/not a Float64Array/);
  });
});

describe('CE-678: a shared list reaches every worker of the pool', () => {
  let pool: KernelPool;
  const engine = new ComputeEngine();
  // One compilation for the block: `compiled` declares `L` on the engine.
  let sum: ReturnType<typeof compiled>;

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

  test('each slice on the pool gives the inline cells', async () => {
    const r = (sum ??= compiled(SUM, engine));
    expect(r.shippable).toBe(true);
    const n = 40_000;
    const xs = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      xs[2 * i] = i / 100;
      xs[2 * i + 1] = i / 100 + 0.5;
    }
    const inputs = { x: xs, L: [1, { lo: 2, hi: 3 }, -0.5] };
    const { out, done, route } = await r.broadcastAsync!(inputs, {
      chunk: 5000,
    });
    expect(route).toBe('pool');
    expect(done).toBe(n);
    expect(Array.from(out)).toEqual(Array.from(r.broadcast!(inputs)));
  }, 30_000);

  test('an element whose bounds are getters keeps its bounds on a worker', async () => {
    // Structured clone copies only own data properties: sent as it is, this
    // element arrived on the worker as `{}`.
    class Bounds {
      get lo() {
        return 2;
      }
      get hi() {
        return 3;
      }
    }
    const r = (sum ??= compiled(SUM, engine));
    const n = 40_000;
    const xs = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) xs[2 * i] = xs[2 * i + 1] = i;
    const inputs = {
      x: xs,
      L: [1, new Bounds() as unknown as { lo: number; hi: number }],
    };
    const { out, route } = await r.broadcastAsync!(inputs, { chunk: 5000 });
    expect(route).toBe('pool');
    expect(Array.from(out)).toEqual(Array.from(r.broadcast!(inputs)));
    // The last cell: x = n - 1, plus 1 + [2, 3].
    expect(Array.from(out.slice(3 * (n - 1)))).toEqual([n + 2, n + 3, 0]);
  }, 30_000);
});
