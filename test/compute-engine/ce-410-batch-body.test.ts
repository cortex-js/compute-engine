import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ComputeEngine,
  compile as compileExpression,
  createKernelPool,
} from '../../src/compute-engine';
import { createJavaScriptRuntime } from '../../src/runtime';

// ROADMAP CE-410, second part (user decision 2026-10-24): a `broadcast()`
// batch runs a second compiled body, the batch body, when each shared list
// it reads directly passes a check made once per batch (a plain array whose
// elements are all numbers, or a `Float64Array`). The batch body takes its
// inputs as arguments, reads a `Float64Array` in place, and reads
// `At(F, index)` with no per-read test when the static type of the index
// proves an integer of 1 or more. A batch whose check fails runs the
// ordinary body. For every input that respects its declared type, the values
// are those of the ordinary body (`run()`).
//
// The batch body is built only on request since ROADMAP CE-423 (user decision
// 2026-10-25): every compilation of this file asks for it.

/** `compile()` with the batch body requested. */
const compile = (
  expr: Parameters<typeof compileExpression>[0],
  options?: Parameters<typeof compileExpression>[1]
): ReturnType<typeof compileExpression> => compileExpression(expr, options);

/** The value of `f()`, or `undefined` when it throws. */
const attempt = (f: () => unknown): unknown => {
  try {
    return f();
  } catch {
    return undefined;
  }
};

/** The number `broadcast()` writes for a value `run()` gives. */
const numberOf = (r: unknown): number => {
  if (typeof r === 'number') return r;
  if (typeof r === 'boolean') return r ? 1 : 0;
  if (
    typeof r === 'object' &&
    r !== null &&
    typeof (r as { re?: unknown }).re === 'number' &&
    (r as { im?: unknown }).im === 0
  )
    return (r as { re: number }).re;
  return NaN;
};

const expectSame = (a: ArrayLike<number>, b: ArrayLike<number>): void => {
  expect(a.length).toBe(b.length);
  for (let n = 0; n < a.length; n++)
    if (!Object.is(a[n], b[n]))
      throw new Error(`value ${n}: ${a[n]} and ${b[n]}`);
};

type Result = ReturnType<typeof compile>;

/** Each cell of `r` through `run()` (the ordinary body), converted as
 * `broadcast()` converts it, `stride` values per cell. */
function viaRun(
  r: Result,
  stride: number,
  cellInputs: Record<string, unknown>[]
): number[] {
  return cellInputs.flatMap((vars) => {
    const v = attempt(() => r.run!(vars as never));
    if (stride === 1) return [Array.isArray(v) ? NaN : numberOf(v)];
    if (!Array.isArray(v)) return Array.from({ length: stride }, () => NaN);
    return Array.from({ length: stride }, (_, k) =>
      k < v.length ? numberOf(v[k]) : NaN
    );
  });
}

// The kernel of Tycho row 432: the case index and the crossing fraction of a
// marching cell, from two values of the shared list F.
const FRACTION = (a: string, b: string): unknown => [
  'If',
  ['LessEqual', a, 0],
  ['If', ['LessEqual', b, 0], 'NaN', ['Divide', a, ['Subtract', a, b]]],
  ['If', ['LessEqual', b, 0], ['Divide', b, ['Subtract', b, a]], 'NaN'],
];
const CASE = (a: string, b: string): unknown => [
  'Add',
  ['If', ['LessEqual', a, 0], 1, 0],
  ['If', ['LessEqual', b, 0], 2, 0],
];
const MARCH = [
  'Block',
  ['Declare', 'v0', 'real', ['At', 'F', ['Add', 'i', 1]]],
  ['Declare', 'v1', 'real', ['At', 'F', ['Add', 'i', 2]]],
  ['Tuple', CASE('v0', 'v1'), FRACTION('v0', 'v1')],
];

/** An engine with `F: list<number>` and `i` of the type `iType`. */
function engine(iType: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('F', 'list<number>');
  ce.declare('i', iType);
  return ce;
}

const F = [0.5, -1, 2, -0.25, 4, -3, 0, 1.5];

describe('CE-410: the batch body', () => {
  const integer = compile(engine('integer').box(MARCH as never));
  const natural = compile(engine('integer<0..>').box(MARCH as never));

  test.each([
    ['a plain array', F],
    ['a Float64Array', Float64Array.from(F)],
  ])(
    'i: integer, F %s: in range, past the end, zero and negative',
    (_, list) => {
      // i + 1 and i + 2 run past the end, are zero, and count from the end.
      const cells = [0, 1, 2, 5, 6, 7, 8, 30, -1, -2, -3, -9, -10, -40];
      const out = integer.broadcast!(
        { i: new Float64Array(cells), F: list },
        { shared: ['F'] }
      );
      expectSame(
        out,
        viaRun(
          integer,
          2,
          cells.map((i) => ({ i, F }))
        )
      );
      // Spot values: cell 0 reads F[1] = 0.5 and F[2] = -1.
      expect(out[0]).toBe(2);
      expect(out[1]).toBe(-1 / (-1 - 0.5));
      // Cell -2: i + 1 = -1 is the last element, i + 2 = 0 reads NaN.
      expect(Array.from(out.slice(18, 20))).toEqual([0, NaN]);
    }
  );

  test.each([
    ['a plain array', F],
    ['a Float64Array', Float64Array.from(F)],
  ])('i: integer<0..>, F %s: in range and past the end', (_, list) => {
    const cells = [0, 1, 3, 5, 6, 7, 8, 100, 2 ** 31, 2 ** 40];
    const out = natural.broadcast!(
      { i: new Float64Array(cells), F: list },
      { shared: ['F'] }
    );
    expectSame(
      out,
      viaRun(
        natural,
        2,
        cells.map((i) => ({ i, F }))
      )
    );
    // Cell 6: i + 1 = 7 is the last element (1.5), i + 2 = 8 is past the
    // end: NaN, and NaN <= 0 is false.
    expect(Array.from(out.slice(12, 14))).toEqual([0, NaN]);
  });

  test('a Float64Array list that shares its memory with the output', () => {
    // The list starts where the output starts: a cell writes a value that a
    // later cell reads. The batch body reads a copy, as the ordinary body
    // does, so the values are those of separate arrays.
    const ce = engine('integer<0..>');
    const r = compile(ce.parse('F_{i+1} + 1'));
    const values = [3, 1, 4, 1, 5, 9, 2, 6];
    const buffer = new ArrayBuffer(8 * values.length);
    const list = new Float64Array(buffer);
    list.set(values);
    const out = new Float64Array(buffer, 0, values.length - 1);
    const cells = new Float64Array([1, 2, 3, 4, 5, 6, 0]);
    r.broadcast!({ i: cells, F: list }, { shared: ['F'], out });
    expectSame(out, [2, 5, 2, 6, 10, 3, 4]);
  });

  test('a slice stops at a multiple of 64 cells, and at a past deadline', () => {
    const runtime = createJavaScriptRuntime({});
    const slice = runtime.loadBroadcastSlice(natural as never);
    const n = 1000;
    const cells = new Float64Array(n).map((_, c) => c % 7);
    const list = Float64Array.from(F);
    const out = new Float64Array(2 * n);
    let calls = 0;
    const written = slice({ i: cells, F: list }, { shared: ['F'] }, out, {
      from: 100,
      to: n,
      stop: () => ++calls > 3,
    });
    // Checked before cells 100, 164, 228 and 292: the fourth call stops.
    expect(written).toBe(192);
    const want = viaRun(
      natural,
      2,
      Array.from(cells.slice(100, 292), (i) => ({ i, F }))
    );
    expectSame(out.slice(0, 2 * 192), want);
    expect(
      slice({ i: cells, F: list }, { shared: ['F'] }, out, {
        from: 0,
        to: n,
        deadline: Date.now() - 1000,
      })
    ).toBe(0);
  });

  test('a runtime that loads the stored result runs the batch body', () => {
    const runtime = createJavaScriptRuntime({});
    const cells = new Float64Array([0, 1, 5, 6, 7, 40]);
    for (const r of [integer, natural]) {
      const stored = JSON.parse(JSON.stringify(r)) as Parameters<
        typeof runtime.loadBroadcast
      >[0];
      const batch = runtime.loadBroadcast(stored);
      for (const list of [F, Float64Array.from(F)])
        expectSame(
          batch({ i: cells, F: list }, { shared: ['F'] }),
          r.broadcast!({ i: cells, F }, { shared: ['F'] })
        );
    }
  });
});

describe('CE-410: the batch body on inline slices', () => {
  test('broadcastAsync without a pool: the same values', async () => {
    const r = compile(engine('integer<0..>').box(MARCH as never));
    const n = 10_000;
    const list = new Float64Array(3000).map((_, k) => Math.cos(k * 0.21));
    const i = new Float64Array(n).map((_, c) => c % 3004);
    const want = r.broadcast!({ i, F: Array.from(list) }, { shared: ['F'] });
    const { out, done } = await r.broadcastAsync!(
      { i, F: list },
      { chunk: 1000, shared: ['F'] }
    );
    expect(done).toBe(n);
    expectSame(out, want);
  });

  test('a per-cell input that is part of the output: read as given, in every slice', async () => {
    // Cell c reads x[c] and writes out[2c] and out[2c + 1]; x is the first
    // half of the output, so the first slices write values of x that later
    // slices read.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const r = compile(
      ce.box(['Tuple', ['Add', 'x', 1], ['Multiply', 'x', 10]] as never)
    );
    const make = () => {
      const buffer = new Float64Array(8);
      const x = buffer.subarray(0, 4);
      x.set([1, 2, 3, 4]);
      return { buffer, x };
    };
    const want = [2, 10, 3, 20, 4, 30, 5, 40];
    const a = make();
    r.broadcast!({ x: a.x }, { out: a.buffer });
    expectSame(a.buffer, want);
    const b = make();
    const { out, done } = await r.broadcastAsync!(
      { x: b.x },
      { chunk: 1, out: b.buffer }
    );
    expect(done).toBe(4);
    expect(out).toBe(b.buffer);
    expectSame(b.buffer, want);
  });
});

describe('CE-410: the batch body on worker slices', () => {
  const WORKER_URL = pathToFileURL(
    join(__dirname, '../../src/kernel-worker.ts')
  );

  /** A pool of one worker that runs the first slice it is sent and answers
   * an error for every later one, so that the rest of the batch runs inline
   * after the first slice was written to the output. `runs()` is the number
   * of slices sent. */
  function poolThatRefusesAfterOneSlice() {
    let runs = 0;
    const pool = createKernelPool({
      create: () => {
        const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
        const handlers: ((m: unknown) => void)[] = [];
        w.on('message', (m) => handlers.forEach((h) => h(m)));
        return {
          postMessage: (m: unknown, transfer?: ArrayBuffer[]) => {
            const msg = m as { type?: string; job?: number };
            if (msg.type === 'run' && runs++ > 0) {
              setTimeout(() =>
                handlers.forEach((h) =>
                  h({ type: 'error', job: msg.job, message: 'refused' })
                )
              );
              return;
            }
            w.postMessage(m, transfer ?? []);
          },
          terminate: () => w.terminate(),
          on: (event, handler) => {
            if (event === 'message') handlers.push(handler);
            else w.on(event as 'error', handler);
          },
        };
      },
      size: 1,
    });
    return { pool, runs: () => runs };
  }

  test('a per-cell input that is part of the output, with slices that end inline', async () => {
    // Cell c reads x[c] and writes out[2c] and out[2c + 1]; x is the first
    // half of the output. The slices that run inline after the first slice
    // (done on the worker) must read the values given.
    const { pool, runs } = poolThatRefusesAfterOneSlice();
    try {
      const own = new ComputeEngine({ workers: pool });
      own.declare('x', 'real');
      const r = compile(
        own.box(['Tuple', ['Add', 'x', 1], ['Multiply', 'x', 10]] as never)
      );
      const n = 24_000;
      const given = new Float64Array(n).map((_, c) => (c % 7) + 1);
      const want = r.broadcast!({ x: given });
      const buffer = new Float64Array(2 * n);
      const x = buffer.subarray(0, n);
      x.set(given);
      const { out, done } = await r.broadcastAsync!(
        { x },
        { chunk: 4000, out: buffer }
      );
      expect(runs()).toBeGreaterThan(1);
      expect(done).toBe(n);
      expect(out).toBe(buffer);
      expectSame(buffer, want);
    } finally {
      pool.dispose();
    }
  }, 60_000);
});
