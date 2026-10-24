import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ComputeEngine,
  compile,
  createKernelPool,
} from '../../src/compute-engine';
import { createJavaScriptRuntime } from '../../src/runtime';
import {
  loadBatchBody,
  makeSysHelpers,
} from '../../src/compute-engine/compilation/javascript-runtime';
import {
  broadcastNumbers,
  type BroadcastBatchBody,
} from '../../src/compute-engine/compilation/broadcast';
import type { StoredBatchBody } from '../../src/compute-engine/compilation/types';

// ROADMAP CE-410, second part (user decision 2026-10-24): a `broadcast()`
// batch runs a second compiled body, the batch body, when each shared list
// it reads directly passes a check made once per batch (a plain array whose
// elements are all numbers, or a `Float64Array`). The batch body takes its
// inputs as arguments, reads a `Float64Array` in place, and reads
// `At(F, index)` with no per-read test when the static type of the index
// proves an integer of 1 or more. A batch whose check fails runs the
// ordinary body. For every input that respects its declared type, the values
// are those of the ordinary body (`run()`).

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

/**
 * The batch body of `r`, with its call counted, for `broadcastNumbers`
 * called directly: `count()` is the number of cells it ran.
 */
function countedBatch(r: Result): {
  batch: BroadcastBatchBody;
  count: () => number;
} {
  const loaded = loadBatchBody(
    makeSysHelpers({
      random: Math.random,
      frame: () => undefined,
      setFrame: () => {},
      iterationLimit: () => Infinity,
      deadline: () => undefined,
    } as never),
    r.batch
  )!;
  let n = 0;
  const call = loaded.call;
  return {
    batch: {
      ...loaded,
      call: (...args: unknown[]) => {
        n++;
        return call(...args);
      },
    },
    count: () => n,
  };
}

/** `broadcastNumbers` over the ordinary body and the batch body `batch`. */
function runWith(
  r: Result,
  batch: BroadcastBatchBody,
  inputs: Record<string, unknown>,
  options?: Record<string, unknown>
): Float64Array {
  return broadcastNumbers(
    (r.run as unknown as { rawCall: (v: unknown) => unknown }).rawCall as never,
    r.entryPlan as never,
    inputs as never,
    options as never,
    r.broadcastOutputs,
    batch
  );
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
  ['Declare', 'v0', 'real'],
  ['Assign', 'v0', ['At', 'F', ['Add', 'i', 1]]],
  ['Declare', 'v1', 'real'],
  ['Assign', 'v1', ['At', 'F', ['Add', 'i', 2]]],
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

  test('a kernel that reads a shared list has one', () => {
    for (const r of [integer, natural]) {
      expect(r.success).toBe(true);
      expect(r.batch).toBeDefined();
      expect(r.batch!.code).not.toContain('_SYS.atNumeric');
      expect(r.batch!.code).not.toMatch(/(?<![\w$])_\./);
      expect(
        r.batch!.params.filter((p) => p.direct).map((p) => p.name)
      ).toEqual(['F']);
      // The ordinary body is unchanged.
      expect(r.code).toContain('_SYS.atNumeric(_.F');
    }
  });

  test('an index of type integer is read with the index rules of At', () => {
    expect(integer.batch!.code).toContain('_SYS.atChecked(');
  });

  test('an index of type integer<1..> is a direct read, NaN past the end', () => {
    expect(natural.batch!.code).not.toContain('_SYS.atChecked(');
    // `F_{i+1}` reads `F[i]`, `F_{i+2}` reads `F[i + 1]`.
    expect(natural.batch!.code).toMatch(/\(\w+\[\w+\] \?\? NaN\)/);
    expect(natural.batch!.code).toMatch(/\(\w+\[\(\w+\) \+ 1\] \?\? NaN\)/);
  });

  test('a kernel that reads no shared list has none', () => {
    const ce = engine('integer');
    expect(compile(ce.parse('\\sin(x) + i')).batch).toBeUndefined();
    // A literal list is not a shared input.
    expect(compile(ce.parse('[1, 2, 3]_{i+1}')).batch).toBeUndefined();
  });

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

  test('the values of the interpreter for a single read', () => {
    const ce = engine('integer');
    const r = compile(ce.parse('F_{i+1}'));
    expect(r.batch).toBeDefined();
    const cells = [-9, -8, -2, -1, 0, 1, 6, 7, 8];
    const out = r.broadcast!(
      { i: new Float64Array(cells), F },
      { shared: ['F'] }
    );
    const want = cells.map((i) =>
      numberOf(
        ce
          .box(['At', ['List', ...F], i + 1])
          .evaluate()
          .N().re
      )
    );
    expectSame(out, want);
  });

  test('a Float64Array shared list is read in place, not copied', () => {
    const list = Float64Array.from(F);
    const from = Array.from;
    let copies = 0;
    Array.from = ((x: unknown, ...rest: unknown[]) => {
      if (x === list) copies++;
      return (from as (...a: unknown[]) => unknown)(x, ...rest);
    }) as typeof Array.from;
    try {
      for (const r of [integer, natural])
        r.broadcast!(
          { i: new Float64Array([0, 1, 2]), F: list },
          { shared: ['F'] }
        );
    } finally {
      Array.from = from;
    }
    expect(copies).toBe(0);
  });

  test('a list that fails the check runs the ordinary body, with its values', () => {
    const cells = [0, 1, 2, 3, 4, 5];
    for (const r of [integer, natural]) {
      for (const bad of [
        [1, 'a', 3, 4, 5, 6, 7],
        [1, [2, 3], 3, 4, 5, 6, 7],
        [1, { re: 2, im: 0 }, 3, 4, 5, 6, 7],
        [1, undefined, 3, 4, 5, 6, 7],
      ]) {
        const { batch, count } = countedBatch(r);
        const out = runWith(
          r,
          batch,
          { i: new Float64Array(cells), F: bad },
          { shared: ['F'] }
        );
        expect(count()).toBe(0);
        expectSame(
          out,
          viaRun(
            r,
            2,
            cells.map((i) => ({ i, F: bad }))
          )
        );
        // The same values through the result's own `broadcast()`.
        expectSame(
          r.broadcast!(
            { i: new Float64Array(cells), F: bad as number[] },
            { shared: ['F'] }
          ),
          out
        );
      }
      // A list that passes runs the batch body for every cell.
      const { batch, count } = countedBatch(r);
      runWith(r, batch, { i: new Float64Array(cells), F }, { shared: ['F'] });
      expect(count()).toBe(cells.length);
    }
  });

  test('a declared length proves the reads in range: no conversion', () => {
    const ce = new ComputeEngine();
    ce.declare('G', 'list<number^5>');
    ce.declare('j', 'integer<0..4>');
    const r = compile(ce.parse('G_{j+1}'));
    expect(r.batch).toBeDefined();
    expect(r.batch!.code).not.toContain('??');
    expect(r.batch!.params.find((p) => p.direct)?.minLength).toBe(5);
    const G = [1, -2, 3.5, NaN, 7];
    const cells = [0, 1, 2, 3, 4];
    expectSame(
      r.broadcast!({ j: new Float64Array(cells), G }, { shared: ['G'] }),
      G
    );
    // A shorter array (it breaks the declared type) fails the check and
    // runs the ordinary body: NaN past the end, as `run()` gives.
    const short = [1, -2, 3];
    const { batch, count } = countedBatch(r);
    const out = runWith(
      r,
      batch,
      { j: new Float64Array(cells), G: short },
      { shared: ['G'] }
    );
    expect(count()).toBe(0);
    expectSame(out, [1, -2, 3, NaN, NaN]);
  });

  test('another read of the same list uses a plain copy, once', () => {
    const ce = engine('integer<0..>');
    const r = compile(ce.parse('F_{i+1} + \\operatorname{Length}(F)'));
    expect(r.batch).toBeDefined();
    const names = r.batch!.params.map((p) => [p.name, p.direct === true]);
    expect(names).toContainEqual(['F', true]);
    expect(names).toContainEqual(['F', false]);
    const cells = [0, 3, 7, 9];
    for (const list of [F, Float64Array.from(F)])
      expectSame(
        r.broadcast!(
          { i: new Float64Array(cells), F: list },
          { shared: ['F'] }
        ),
        viaRun(
          r,
          1,
          cells.map((i) => ({ i, F }))
        )
      );
  });

  test('a scalar input and an input that is not given', () => {
    const ce = engine('integer<0..>');
    ce.declare('a', 'real');
    const r = compile(ce.parse('F_{i+1} \\cdot a + F_{i+2}'));
    expect(r.batch).toBeDefined();
    const cells = [0, 1, 6, 7];
    expectSame(
      r.broadcast!({ i: new Float64Array(cells), F, a: 3 }, { shared: ['F'] }),
      viaRun(
        r,
        1,
        cells.map((i) => ({ i, F, a: 3 }))
      )
    );
    // `a` absent: the ordinary body reads `undefined`, and so does the
    // batch body.
    expectSame(
      r.broadcast!({ i: new Float64Array(cells), F }, { shared: ['F'] }),
      viaRun(
        r,
        1,
        cells.map((i) => ({ i, F }))
      )
    );
  });

  test('a grid layout', () => {
    const ce = engine('integer<0..>');
    ce.declare('j', 'integer<0..>');
    const r = compile(ce.parse('(F_{i+1} + 10 F_{j+1}, F_{i+j+1})'));
    expect(r.batch).toBeDefined();
    const is = [0, 2, 5, 7];
    const js = [1, 6, 9];
    for (const list of [F, Float64Array.from(F)]) {
      const out = r.broadcast!(
        { i: new Float64Array(is), j: new Float64Array(js), F: list },
        { layout: 'grid', shared: ['F'] }
      );
      const cellInputs: Record<string, unknown>[] = [];
      for (const j of js) for (const i of is) cellInputs.push({ i, j, F });
      expectSame(out, viaRun(r, 2, cellInputs));
    }
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
      expect(stored.batch).toEqual(r.batch);
      const batch = runtime.loadBroadcast(stored);
      for (const list of [F, Float64Array.from(F)])
        expectSame(
          batch({ i: cells, F: list }, { shared: ['F'] }),
          r.broadcast!({ i: cells, F }, { shared: ['F'] })
        );
    }
  });

  test('a stored batch body that cannot be built is ignored', () => {
    const runtime = createJavaScriptRuntime({});
    const cells = new Float64Array([0, 1, 5, 6, 7]);
    const want = natural.broadcast!({ i: cells, F }, { shared: ['F'] });
    const broken: StoredBatchBody[] = [
      { ...natural.batch!, params: [{ name: 'F', local: '1x', direct: true }] },
      { ...natural.batch!, code: '(' },
    ];
    for (const batch of broken) {
      expect(
        loadBatchBody((natural.run as unknown as { SYS: never }).SYS, batch)
      ).toBeUndefined();
      const stored = { ...JSON.parse(JSON.stringify(natural)), batch };
      expectSame(
        runtime.loadBroadcast(stored)({ i: cells, F }, { shared: ['F'] }),
        want
      );
    }
  });
});

describe('CE-410: the batch body on inline slices', () => {
  test('broadcastAsync without a pool: the same values, the list read in place', async () => {
    const r = compile(engine('integer<0..>').box(MARCH as never));
    const n = 10_000;
    const list = new Float64Array(3000).map((_, k) => Math.cos(k * 0.21));
    const i = new Float64Array(n).map((_, c) => c % 3004);
    const want = r.broadcast!({ i, F: Array.from(list) }, { shared: ['F'] });
    const from = Array.from;
    let copies = 0;
    Array.from = ((x: unknown, ...rest: unknown[]) => {
      if (x === list) copies++;
      return (from as (...a: unknown[]) => unknown)(x, ...rest);
    }) as typeof Array.from;
    try {
      const { out, done } = await r.broadcastAsync!(
        { i, F: list },
        { chunk: 1000, shared: ['F'] }
      );
      expect(done).toBe(n);
      expectSame(out, want);
    } finally {
      Array.from = from;
    }
    expect(copies).toBe(0);
  });

  test('a Float64Array list that is the output: read as given, in every slice', async () => {
    // Each cell reads F[1] and writes its own value of F. A slice must read
    // the values given, not those that an earlier slice wrote.
    const r = compile(engine('integer<0..>').parse('F_{i+1} + 1'));
    expect(r.batch).toBeDefined();
    const i = new Float64Array([0, 0]);
    const F1 = new Float64Array([10, 20]);
    r.broadcast!({ i, F: F1 }, { out: F1, shared: ['F'] });
    expectSame(F1, [11, 11]);
    const F2 = new Float64Array([10, 20]);
    const { out, done } = await r.broadcastAsync!(
      { i, F: F2 },
      { chunk: 1, out: F2, shared: ['F'] }
    );
    expect(done).toBe(2);
    expect(out).toBe(F2);
    expectSame(F2, [11, 11]);
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

  test('a worker runs the batch body: the same values, a Float64Array or a plain array', async () => {
    let shippedBatch = 0;
    const pool = createKernelPool({
      create: () => {
        const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
        return {
          postMessage: (m: unknown, transfer?: ArrayBuffer[]) => {
            const msg = m as { type?: string; kernel?: { batch?: unknown } };
            if (msg.type === 'load' && msg.kernel?.batch !== undefined)
              shippedBatch++;
            w.postMessage(m, transfer ?? []);
          },
          terminate: () => w.terminate(),
          on: (event, handler) => w.on(event as 'message', handler),
        };
      },
      size: 2,
    });
    const own = new ComputeEngine({ workers: pool });
    own.declare('F', 'list<number>');
    own.declare('i', 'integer<0..>');
    const r = compile(own.box(MARCH as never));
    expect(r.batch).toBeDefined();
    const n = 40_000;
    const list = new Float64Array(5000).map((_, k) => Math.sin(k * 0.37));
    const i = new Float64Array(n).map((_, c) => c % 5003);
    const inline = r.broadcast!({ i, F: list }, { shared: ['F'] });
    // The ordinary body, cell by cell, on a sample of the cells.
    const sample = [0, 1, 4997, 4998, 4999, 5000, 5002, 12345];
    const plainList = Array.from(list);
    expectSame(
      sample.flatMap((c) => [inline[2 * c], inline[2 * c + 1]]),
      viaRun(
        r,
        2,
        sample.map((c) => ({ i: i[c], F: plainList }))
      )
    );
    for (const F of [list, plainList]) {
      const { out, done } = await r.broadcastAsync!(
        { i, F },
        { chunk: 4000, shared: ['F'] }
      );
      expect(done).toBe(n);
      expectSame(out, inline);
    }
    expect(shippedBatch).toBeGreaterThan(0);
    pool.dispose();
  }, 60_000);

  test('a Float64Array list that is the output, with slices that end inline', async () => {
    // The worker takes the first slice and refuses the others, which then
    // run inline after the first slice was written to the output. Each cell
    // reads F[1]: the inline slices must read the value given, not the one
    // the first slice wrote.
    const { pool, runs } = poolThatRefusesAfterOneSlice();
    try {
      const own = new ComputeEngine({ workers: pool });
      own.declare('F', 'list<number>');
      own.declare('i', 'integer<0..>');
      const r = compile(own.parse('F_{i+1} + 1'));
      expect(r.batch).toBeDefined();
      const n = 24_000;
      const F = new Float64Array(n).fill(10);
      const { out, done } = await r.broadcastAsync!(
        { i: new Float64Array(n), F },
        { chunk: 4000, out: F, shared: ['F'] }
      );
      expect(runs()).toBeGreaterThan(1);
      expect(done).toBe(n);
      expect(out).toBe(F);
      expect(F.every((v) => v === 11)).toBe(true);
    } finally {
      pool.dispose();
    }
  }, 60_000);

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
