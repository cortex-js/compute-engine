import {
  ComputeEngine,
  INTERVAL_KIND,
  compile,
} from '../../src/compute-engine';
import { createIntervalRuntime } from '../../src/interval';
import { createJavaScriptRuntime } from '../../src/runtime';

// Tycho ledger row 416: two additions to `broadcast()` and `broadcastAsync()`
// of a `javascript` result (design: docs/plans/2026-10-20-worker-kernel-pool.md,
// section 5.4.2; the loop is in src/compute-engine/compilation/broadcast.ts).
//
// - Shared inputs: an input bound once for the whole batch and read by index
//   by the compiled code (`F_{i+1}`), instead of one value per cell. A
//   variable declared with a list type is shared without being named; the
//   `shared` option names any other one.
// - Several outputs per cell: a tuple-valued expression writes `m` numbers
//   per cell into one output array, cell `c` at `[m·c, m·c + m)`. `m` is the
//   arity of a tuple-of-numbers type by default; the `outputs` option
//   overrides it.

const ce = new ComputeEngine();
ce.declare('F', 'list<number>');
ce.declare('i', 'integer');
ce.declare('k', 'integer');

const list = (a: Float64Array): number[] => Array.from(a);

const expectSame = (a: Float64Array, b: Float64Array): void => {
  expect(a.length).toBe(b.length);
  for (let n = 0; n < a.length; n++)
    if (!Object.is(a[n], b[n]))
      throw new Error(`value ${n}: ${a[n]} and ${b[n]}`);
};

/** The integers `0, 1, …, n − 1`, as one value per cell. */
const indices = (n: number): Float64Array => {
  const a = new Float64Array(n);
  for (let c = 0; c < n; c++) a[c] = c;
  return a;
};

/** `n` field values that are all different and not integers. */
const field = (n: number): number[] =>
  Array.from({ length: n }, (_, c) => Math.sin(c) * 10 + c / 7);

describe("Tycho's two probes", () => {
  test('a shared list read by index', () => {
    const r = compile(ce.parse('F_{i+1}'));
    const out = r.broadcast!(
      { i: new Float64Array([0, 1, 2]), F: [1, 2, 3, 4] },
      { layout: 'cells', shared: ['F'] }
    );
    expect(list(out)).toEqual([1, 2, 3]);
  });

  test('two outputs per cell', () => {
    const r = compile(ce.parse('(i, 2i)'));
    const out = r.broadcast!(
      { i: new Float64Array([1, 2, 3]) },
      { layout: 'cells', outputs: 2 }
    );
    expect(list(out)).toEqual([1, 2, 2, 4, 3, 6]);
  });
});

describe('shared inputs', () => {
  test('a variable declared as a list is shared with no `shared` option', () => {
    const r = compile(ce.parse('F_{i+1}'));
    expect(
      list(r.broadcast!({ i: new Float64Array([0, 1, 2]), F: [1, 2, 3, 4] }))
    ).toEqual([1, 2, 3]);
  });

  test('a Float64Array shared input gives the same as the plain array', () => {
    const r = compile(ce.parse('F_{i+1} - F_{i+2}'));
    const i = new Float64Array([0, 1, 2]);
    const values = [1, 2, 4, 8, 16];
    const plain = r.broadcast!({ i, F: values });
    const typed = r.broadcast!({ i, F: new Float64Array(values) });
    expect(list(plain)).toEqual([-1, -2, -4]);
    expectSame(typed, plain);
  });

  test('`shared` names an undeclared symbol that the code reads by index', () => {
    const r = compile(ce.box(['At', 'G', ['Add', 'i', 1]]));
    const i = new Float64Array([0, 1, 2]);
    expect(list(r.broadcast!({ i, G: [5, 6, 7] }, { shared: ['G'] }))).toEqual([
      5, 6, 7,
    ]);
    expect(
      list(
        r.broadcast!({ i, G: new Float64Array([5, 6, 7]) }, { shared: ['G'] })
      )
    ).toEqual([5, 6, 7]);
  });

  test('a `shared` option given as a readonly array', () => {
    const r = compile(ce.box(['At', 'G', ['Add', 'i', 1]]));
    const shared = ['G'] as const;
    expect(
      list(
        r.broadcast!(
          { i: new Float64Array([0, 1, 2]), G: [5, 6, 7] },
          { shared }
        )
      )
    ).toEqual([5, 6, 7]);
  });

  test('a `shared` name that is not a key of the inputs throws', () => {
    const r = compile(ce.parse('F_{i+1}'));
    expect(() =>
      r.broadcast!({ i: new Float64Array([0]), F: [1] }, { shared: ['F', 'H'] })
    ).toThrow(/"H" is not a key of the inputs/);
  });

  test('a `shared` option that is not an array of strings throws', () => {
    const r = compile(ce.parse('F_{i+1}'));
    expect(() =>
      r.broadcast!(
        { i: new Float64Array([0]), F: [1] },
        { shared: 'F' as unknown as string[] }
      )
    ).toThrow(/`shared` must be an array/);
  });

  test('a plain array for a variable that is not shared throws', () => {
    const r = compile(ce.parse('F_{i+1}'));
    expect(() => r.broadcast!({ i: [0, 1, 2], F: [1, 2, 3, 4] })).toThrow(
      /"i" must be a Float64Array or a number; a plain array is accepted only for a shared input/
    );
  });

  test('a number for a shared input throws', () => {
    const r = compile(ce.parse('F_{i+1}'));
    expect(() => r.broadcast!({ i: new Float64Array([0]), F: 3 })).toThrow(
      /shared input "F" must be an array/
    );
  });

  test('the grid layout: a shared input is not an axis', () => {
    const r = compile(ce.parse('F_{i+1} + 10k'));
    // `F` sits between the two axes in key order; the cells are the
    // product of the axes `i` (fastest) and `k`.
    const out = r.broadcast!(
      {
        i: new Float64Array([0, 1, 2]),
        F: [1, 2, 3, 4],
        k: new Float64Array([0, 1]),
      },
      { layout: 'grid' }
    );
    expect(list(out)).toEqual([1, 2, 3, 11, 12, 13]);
  });
});

describe('several outputs per cell', () => {
  test('the stride is inferred from a tuple-of-numbers type', () => {
    const r = compile(ce.parse('(i, 2i)'));
    expect(r.broadcastOutputs).toBe(2);
    expect(list(r.broadcast!({ i: new Float64Array([1, 2, 3]) }))).toEqual([
      1, 2, 2, 4, 3, 6,
    ]);
  });

  test('a tuple of undeclared symbols (elements typed `unknown`) has a stride', () => {
    // A separate engine, so that no use of `x` or `y` elsewhere in this file
    // narrows their type away from `unknown`.
    const ce2 = new ComputeEngine();
    const e = ce2.parse('(x, y)');
    expect(e.type.toString()).toBe('tuple<unknown, unknown>');
    const r = compile(e);
    expect(r.broadcastOutputs).toBe(2);
    const out = r.broadcast!({
      x: new Float64Array([1, 2]),
      y: new Float64Array([3, 4]),
    });
    expect(list(out)).toEqual([1, 3, 2, 4]);
    // An element that cannot be a number gives one value per cell.
    const s = compile(ce2.box(['Tuple', 'x', { str: 'a' }]));
    expect('broadcastOutputs' in s).toBe(false);
  });

  test('a scalar result carries no stride', () => {
    const r = compile(ce.parse('2i'));
    expect('broadcastOutputs' in r).toBe(false);
  });

  test('`outputs: 3` on a pair: the third value of each cell is NaN', () => {
    const r = compile(ce.parse('(i, 2i)'));
    const out = r.broadcast!({ i: new Float64Array([1, 2]) }, { outputs: 3 });
    expect(list(out)).toEqual([1, 2, NaN, 2, 4, NaN]);
  });

  test('`outputs: 2` on a scalar expression: NaN in every slot', () => {
    const r = compile(ce.parse('2i'));
    const out = r.broadcast!({ i: new Float64Array([1, 2]) }, { outputs: 2 });
    expect(list(out)).toEqual([NaN, NaN, NaN, NaN]);
  });

  test('`outputs: 1` on a tuple: NaN per cell, as without a stride', () => {
    const r = compile(ce.parse('(i, 2i)'));
    const out = r.broadcast!({ i: new Float64Array([1, 2]) }, { outputs: 1 });
    expect(list(out)).toEqual([NaN, NaN]);
  });

  test('an output array too short for the stride throws', () => {
    const r = compile(ce.parse('(i, 2i)'));
    expect(() =>
      r.broadcast!(
        { i: new Float64Array([1, 2, 3]) },
        { out: new Float64Array(5) }
      )
    ).toThrow(/holds 5 values, 6 are needed/);
    // Long enough: filled from the start.
    const out = new Float64Array(7).fill(-1);
    r.broadcast!({ i: new Float64Array([1, 2, 3]) }, { out });
    expect(list(out)).toEqual([1, 2, 2, 4, 3, 6, -1]);
  });

  test('`outputs` that is not a positive integer throws', () => {
    const r = compile(ce.parse('(i, 2i)'));
    const i = new Float64Array([1]);
    expect(() => r.broadcast!({ i }, { outputs: 0 })).toThrow(
      /`outputs` must be a positive integer/
    );
    expect(() => r.broadcast!({ i }, { outputs: 1.5 })).toThrow(
      /`outputs` must be a positive integer/
    );
  });

  test('a stencil: broadcast gives run(), cell for cell', () => {
    const r = compile(ce.parse('(F_{i+1} - F_i, F_{i+2})'));
    expect(r.broadcastOutputs).toBe(2);
    const values = field(502);
    const i = indices(500);
    const out = r.broadcast!({ i, F: values });
    expect(out.length).toBe(1000);
    for (let c = 0; c < 500; c++) {
      const v = r.run({ i: c, F: values as unknown as number }) as number[];
      expect(Object.is(out[2 * c], v[0])).toBe(true);
      expect(Object.is(out[2 * c + 1], v[1])).toBe(true);
    }
    // The values are real ones, not NaN everywhere.
    expect(out[1]).toBe(values[1]);
  });
});

describe('an input that shares the buffer of the output', () => {
  // The cell loop writes cell `c` at `[m·c, m·c + m)`; without a copy of
  // the input, an earlier cell would overwrite a value a later cell reads.
  test('two outputs per cell', () => {
    const a = new Float64Array([1, 3, 5, 0, 0, 0]);
    const r = compile(ce.parse('(x, 2x)'));
    r.broadcast!({ x: a.subarray(0, 3) }, { out: a });
    expect(list(a)).toEqual([1, 2, 3, 6, 5, 10]);
  });

  test('the grid layout reads an axis once per row', () => {
    const a = new Float64Array([1, 2, 3, 0, 0, 0]);
    const r = compile(ce.parse('2x + 10y'));
    r.broadcast!(
      { x: a.subarray(0, 3), y: new Float64Array([0, 1]) },
      { layout: 'grid', out: a }
    );
    expect(list(a)).toEqual([2, 4, 6, 12, 14, 16]);
  });

  test('interval-js: a `lo, hi` pair in, three values out per cell', () => {
    const a = new Float64Array([1, 1, 2, 2, 3, 3, 0, 0, 0]);
    const r = compile(ce.parse('x^2'), { to: 'interval-js' });
    r.broadcast!({ x: a.subarray(0, 6) }, { out: a });
    const kind = INTERVAL_KIND.interval;
    expect(list(a)).toEqual([1, 1, kind, 4, 4, kind, 9, 9, kind]);
  });
});

describe('broadcastAsync without a pool', () => {
  test('a shared input and a stride of 2 give the result of broadcast', async () => {
    const r = compile(ce.parse('(F_{i+1} - F_i, F_{i+2})'));
    const inputs = { i: indices(1000), F: new Float64Array(field(1002)) };
    const { out, done } = await r.broadcastAsync!(inputs, { chunk: 100 });
    expect(done).toBe(1000);
    expectSame(out, r.broadcast!(inputs));
  });

  test('a deadline that has passed gives done: 0', async () => {
    const r = compile(ce.parse('(F_{i+1} - F_i, F_{i+2})'));
    const { done } = await r.broadcastAsync!(
      { i: indices(1000), F: field(1002) },
      { chunk: 100, deadline: -1 }
    );
    expect(done).toBe(0);
  });

  test('the options are validated', async () => {
    const r = compile(ce.parse('(i, 2i)'));
    await expect(
      r.broadcastAsync!({ i: new Float64Array(4) }, { outputs: 0 })
    ).rejects.toThrow(/`outputs` must be a positive integer/);
    await expect(
      r.broadcastAsync!({ i: new Float64Array(4) }, { shared: ['F'] })
    ).rejects.toThrow(/"F" is not a key of the inputs/);
    await expect(
      r.broadcastAsync!(
        { i: new Float64Array(4) },
        { out: new Float64Array(7) }
      )
    ).rejects.toThrow(/holds 7 values, 8 are needed/);
  });
});

describe('the standalone runtime rebuilds the stored result', () => {
  test('loadBroadcast and loadBroadcastSlice default to the stored stride and shared inputs', () => {
    const r = compile(ce.parse('(F_{i+1} - F_i, F_{i+2})'));
    const stored = JSON.parse(JSON.stringify(r));
    expect(stored.broadcastOutputs).toBe(2);
    const runtime = createJavaScriptRuntime({});
    const inputs = { i: indices(300), F: new Float64Array(field(302)) };
    const expected = r.broadcast!(inputs);
    expectSame(runtime.loadBroadcast(stored)(inputs), expected);
    const out = new Float64Array(20);
    const n = runtime.loadBroadcastSlice(stored)(inputs, undefined, out, {
      from: 100,
      to: 110,
    });
    expect(n).toBe(10);
    expectSame(out, expected.subarray(200, 220));
  });

  test('a thrown cell and a short array answer give NaN', () => {
    const runtime = createJavaScriptRuntime({});
    const run = runtime.loadBroadcast({
      code: '_.i > 1 ? (() => { throw new Error("no value"); })() : _.i > 0 ? [_.i] : [_.i, true]',
      calling: 'expression',
      runtimeVersion: runtime.runtimeVersion,
      broadcastOutputs: 2,
    });
    expect(list(run({ i: new Float64Array([0, 1, 2]) }))).toEqual([
      0,
      1,
      1,
      NaN,
      NaN,
      NaN,
    ]);
  });

  test('a stored stride that is not a positive integer throws', () => {
    const runtime = createJavaScriptRuntime({});
    expect(() =>
      runtime.loadBroadcast({
        code: '[_.i, _.i]',
        calling: 'expression',
        runtimeVersion: runtime.runtimeVersion,
        broadcastOutputs: 0,
      })
    ).toThrow(/broadcastOutputs must be a positive integer/);
  });
});

describe('an interval-js result refuses both options', () => {
  test('broadcast, broadcastAsync and the interval runtime throw', async () => {
    const r = compile(ce.parse('x^2'), { to: 'interval-js' });
    const x = new Float64Array([0, 1]);
    expect(() => r.broadcast!({ x }, { outputs: 2 })).toThrow(
      /`outputs` option is not supported by an interval-js result/
    );
    expect(() => r.broadcast!({ x, F: [1, 2] }, { shared: ['F'] })).toThrow(
      /`shared` option is not supported by an interval-js result/
    );
    await expect(r.broadcastAsync!({ x }, { outputs: 1 })).rejects.toThrow(
      /not supported by an interval-js result/
    );
    const stored = JSON.parse(JSON.stringify(r));
    expect(() =>
      createIntervalRuntime().loadBroadcast(stored)({ x }, { shared: [] })
    ).toThrow(/not supported by an interval-js result/);
    // A plain array is refused for an interval input.
    expect(() =>
      r.broadcast!({ x: [0, 1] as unknown as Float64Array })
    ).toThrow(/plain array is not accepted/);
  });
});
