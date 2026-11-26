/**
 * CE-1549: `Chunk(L, k)`, `Partition(L, n)` and `Partition(L, p)` whose
 * rows can have different lengths, on the IR compiler (README of
 * `src/compute-engine/compilation/ir/`, "The rows lane" and "Lists", the
 * list operators).
 *
 * As the result of the program, on JavaScript, the value is the lane
 * `rows`: an array of plain arrays, read by no other operation, with no batch
 * form (`rows: true`). A consumer that reduces a row (`Map` of a row
 * reducer, `Length`, `At` of a constant index) reads the rows one by one.
 * The list must be an input or a literal list; a count known at run time is
 * checked by the compiled code, which throws a `RangeError` where the
 * interpreter leaves the form unevaluated. Every other case declines.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { createJavaScriptRuntime } from '../../src/runtime';
import type { Expression } from '../../src/compute-engine/global-types';
import type { StoredJavaScript } from '../../src/compute-engine/compilation/javascript-runtime';
import { compileSlice } from '../../src/compute-engine/compilation/ir/index';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Point = Record<string, number | boolean | (number | boolean)[]>;

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('k', 'integer');
ce.declare('n', 'integer');
ce.declare('L', 'list<real>');
ce.declare('J', 'list<integer>');
ce.declare('B', 'list<boolean>');
ce.declare('L6', 'list<real^6>');
ce.declare('P', 'list<tuple<real, real>>');
ce.declare('id', 'function');
ce.assign('id', ce.box(['Function', 't', 't']));
ce.declare('one', 'function');
ce.assign('one', ce.box(['Function', 1, 't']));

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options });

/** The diagnostic message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (
      (x as { diagnostic?: { message: string } }).diagnostic?.message ??
      (x as Error).message
    );
  }
  return undefined;
}

/** The interpreter's value: a tuple or a list is an array. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (e.symbol === 'True' || e.symbol === 'False') return e.symbol === 'True';
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  // A lazy `FlatMap` does not know that it is finite: its elements.
  if (isFunction(e, 'FlatMap') && e.isCollection)
    return [...e.each()].map((x) => read(x.N()));
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  throw new Error(`no value: ${e.toString()}`);
}

function interpreted(json: Json, point: Point): unknown {
  const value = (v: Point[string]): Expression =>
    Array.isArray(v)
      ? ce.function(
          'List',
          v.map((x) =>
            typeof x === 'boolean'
              ? ce.symbol(x ? 'True' : 'False')
              : ce.number(x)
          )
        )
      : typeof v === 'boolean'
        ? ce.symbol(v ? 'True' : 'False')
        : ce.number(v);
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, value(v)])
  );
  return ce.withValues(values as never, () => read(box(json).evaluate().N()));
}

/** `v` and `w` have one shape and agree within 1e-12. */
function agree(v: unknown, w: unknown): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x))
    );
  if (typeof w === 'boolean') return v === w;
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    (Math.abs(v - w) <= 1e-12 * Math.max(1, Math.abs(w)) ||
      (Number.isNaN(v) && Number.isNaN(w)))
  );
}

function expectAgree(json: Json, got: unknown, p: Point) {
  const want = interpreted(json, p);
  if (!agree(got, want))
    throw new Error(
      `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
    );
}

function check(json: Json, points: Point[], options: object = {}) {
  const r = js(json, options);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  for (const p of points) expectAgree(json, r.run!(p as never), p);
  return r;
}

const range = (m: number) => Array.from({ length: m }, (_, i) => i + 1.5);
// Lists of lengths 0, 1, 4, 5, 6 and 7.
const POINTS: Point[] = [0, 1, 4, 5, 6, 7].map((m) => ({
  L: range(m),
  x: m - 2.5,
  L6: [1, 2, 3, 4, 5, 6],
}));
const pred = (op: string, c: unknown) => ['Function', [op, 't', c], 't'];
const sum = ['Function', ['Sum', 'r'], 'r'];
const size = ['Function', ['Length', 'r'], 'r'];

describe('CE-1549: the rows as the result of the program', () => {
  // prettier-ignore
  test.each([
    ['Chunk in 2', ['Chunk', 'L', 2]],
    ['Chunk in 3', ['Chunk', 'L', 3]],
    ['Chunk in 5', ['Chunk', 'L', 5]],
    ['Chunk of a stated length in 4', ['Chunk', 'L6', 4]],
    ['Partition by 2', ['Partition', 'L', 2]],
    ['Partition by 10', ['Partition', 'L', 10]],
    ['Partition by a predicate true on none', ['Partition', 'L', pred('Less', 0)]],
    ['Partition by a predicate true on some', ['Partition', 'L', pred('Less', 3)]],
    ['Partition by a predicate true on all', ['Partition', 'L', pred('Less', 100)]],
    ['Chunk of a literal list', ['Chunk', ['List', 1, 2, 3], 2]],
    ['Chunk in a Block', ['Block', ['Declare', 'c', 'integer', 2], ['Chunk', 'L', 'c']]],
    ['Chunk as the value of a local', ['Block', ['Declare', 'c', 'unknown', ['Chunk', 'L', 2]], 'c']],
    ['a Tuple of the rows and a list', ['Tuple', ['Chunk', 'L', 2], 'L']],
  ])('%s', (_, json) => {
    const r = check(json, POINTS);
    expect(r).toMatchObject({ rows: true, shippable: false });
  });

  test('Chunk of a list of 3 in 5: the last rows are empty', () => {
    check(['Chunk', 'L', 5], [{ L: [1, 2, 3] }]);
  });

  test('of booleans and integers', () => {
    check(['Chunk', 'B', 2], [{ B: [] }, { B: [true, false, true] }]);
    check(
      ['Partition', 'J', pred('Greater', 1)],
      [{ J: [] }, { J: [0, 3, 1, 2] }]
    );
  });

  test('each row is a plain array, also of a Float64Array input', () => {
    const r = js(['Chunk', 'L', 2], { entryChecks: false });
    const v = r.run!({ L: new Float64Array([1, 2, 3]) } as never) as unknown[];
    expect(v.every((row) => Array.isArray(row))).toBe(true);
    expect(v).toEqual([[1, 2], [3]]);
  });

  test('past maxCollectionSize, the rows of an input agree', () => {
    const p = { L: range(10_001) };
    check(['Chunk', 'L', 2], [p]);
    check(['Partition', 'L', pred('Less', 5000)], [p]);
  });

  test('a count known at run time', () => {
    for (const json of [
      ['Chunk', 'L', 'k'],
      ['Partition', 'L', 'k'],
      ['Map', sum, ['Chunk', 'L', 'k']],
      ['Length', ['Partition', 'L', 'k']],
    ])
      check(
        json,
        [1, 2, 7].flatMap((k) => POINTS.map((p) => ({ ...p, k })))
      );
  });

  test('where the interpreter leaves it unevaluated, a count known at run time throws', () => {
    for (const json of [
      ['Chunk', 'L', 'k'],
      ['Length', ['Chunk', 'L', 'k']],
      ['Map', sum, ['Chunk', 'L', 'k']],
    ]) {
      const r = js(json);
      for (const k of [0, -1, 10_001])
        expect(() => r.run!({ L: [1, 2], k } as never)).toThrow(RangeError);
    }
    for (const json of [
      ['Partition', 'L', 'k'],
      ['Length', ['Partition', 'L', 'k']],
    ]) {
      const r = js(json);
      for (const k of [0, -1])
        expect(() => r.run!({ L: [1, 2], k } as never)).toThrow(RangeError);
    }
  });
});

describe('CE-1549: the consumers read the rows one by one', () => {
  // prettier-ignore
  test.each([
    ['the sum of each chunk', ['Map', sum, ['Chunk', 'L', 3]]],
    ['the length of each part', ['Map', size, ['Partition', 'L', 2]]],
    ['the sum of each chunk, in a Comprehension', ['Comprehension', ['Sum', 'r'], ['Element', 'r', ['Chunk', 'L', 3]]]],
    ['the chunks of more than one element', ['CountIf', ['Chunk', 'L', 3], ['Function', ['Greater', ['Length', 'r'], 1], 'r']]],
    ['Length of Chunk', ['Length', ['Chunk', 'L', 3]]],
    ['Length of Partition', ['Length', ['Partition', 'L', 2]]],
    ['Length of Partition by a predicate', ['Length', ['Partition', 'L', pred('Less', 3)]]],
    ['the first group', ['At', ['Partition', 'L', pred('Less', 3)], 1]],
    ['the second group', ['At', ['Partition', 'L', pred('Less', 3)], 2]],
    ['the last chunk', ['At', ['Chunk', 'L', 3], -1]],
  ])('%s', (_, json) => {
    const r = check(json, POINTS);
    expect(r.rows).toBeUndefined();
  });

  // A consumer whose value holds a row (CE-1736): the rows of the lane
  // `rows` that the program makes, each a copy of a row of the chunks.
  // prettier-ignore
  test.each([
    ['a consumer that yields a row', ['Map', ['Function', 'r', 'r'], ['Chunk', 'L', 3]]],
    ['a consumer that keeps rows', ['Any', ['Chunk', 'L', 3], ['Function', ['Greater', ['Length', 'r'], 1], 'r']]],
  ])('%s', (_, json) => {
    check(json, POINTS);
  });

  test('on GLSL, rows of constant lengths', () => {
    expect(
      js(['Map', sum, ['Partition', 'L6', 4]], { to: 'glsl' }).success
    ).toBe(true);
  });
});

describe('CE-1549: declines', () => {
  // prettier-ignore
  test.each([
    ['a consumer that yields a row, on GLSL', ['Map', ['Function', 'r', 'r'], ['Chunk', 'L', 3]], 'glsl', ''],
    ['Map of the groups of a predicate (the interpreter leaves it unevaluated)', ['Map', size, ['Partition', 'L', pred('Less', 3)]], 'javascript', 'a group of Partition by a predicate read one by one'],
    ['At of a run-time count of rows', ['At', ['Partition', 'L', 2], 1], 'javascript', 'At of a Chunk or a Partition'],
    ['a Range', ['Chunk', ['Range', 1, 10001], 2], 'javascript', 'Chunk of a computed list'],
    ['a Map', ['Chunk', ['Map', pred('Add', 1), 'L'], 2], 'javascript', 'Chunk of a computed list'],
    ['a count of 0', ['Chunk', 'L', 0], 'javascript', 'Chunk of a count below 1'],
    ['a count above the cap', ['Chunk', 'L', 10_001], 'javascript', 'Chunk of a count above 10000'],
    ['a count above the cap, of rows of one length', ['Chunk', ['List', ...range(10_001).map((_, i) => i)], 10_001], 'javascript', 'Chunk of a count above 10000'],
    ['a size of 0', ['Partition', 'L', 0], 'javascript', 'Partition of a count below 1'],
    ['windows of a size known at run time', ['Partition', 'L', 'n', 1], 'javascript', 'Partition in windows of a size that is not a constant'],
    ['a list of points', ['Chunk', 'P', 2], 'javascript', 'Chunk of a list of other than numbers or booleans'],
    ['a list of complex numbers', ['Chunk', ['List', 1, 'ImaginaryUnit', 2], 2], 'javascript', 'Chunk of a list of other than numbers or booleans'],
    ['a literal list of rows of two lengths, on GLSL', ['List', ['List', 'x', 1], ['List', 'x']], 'glsl', 'elements of two types'],
    ['on GLSL', ['Chunk', 'L', 2], 'glsl', ''],
    ['on interval-js', ['Chunk', 'L', 2], 'interval-js', 'Chunk on interval-js'],
  ])('%s', (_, json, to, cause) => {
    const message = failure(() => js(json, { to }));
    expect(message).toBeDefined();
    expect(message).toContain(cause);
  });

  test('a literal list of rows of two lengths is a record on JavaScript (CE-1652)', () => {
    const json: Json = ['List', ['List', 'x', 1], ['List', 'x']];
    expect(js(json).run!({ x: 2 } as never)).toEqual([[2, 1], [2]]);
    expect(box(json).subs({ x: 2 }).evaluate().json).toEqual([
      'List',
      ['List', 2, 1],
      ['List', 2],
    ]);
  });

  test('in the bigint mode', () => {
    expect(failure(() => js(['Chunk', 'J', 2], { mode: 'bigint' }))).toContain(
      'rows.chunk (the operation rows.chunk) on javascript in the bigint mode'
    );
  });
});

describe('CE-1549: every other use of the rows gives the interpreter value or declines', () => {
  const rows = ['Chunk', 'L', 2];
  const row = ['At', ['Chunk', 'L', 3], 1];
  const groups = ['Partition', 'L', pred('Less', 3)];
  // prettier-ignore
  const uses: Json[] = [
    ['IsMissing', rows],
    ['Coalesce', rows],
    ['AssertPresent', rows],
    ['Rank', rows],
    ['Shape', rows],
    ['Flatten', rows],
    ['Transpose', rows],
    ['ListJoin', rows, 'L'],
    ['Max', rows],
    ['Mean', rows],
    ['PointList', rows],
    ['First', rows],
    ['Sum', rows],
    ['Block', ['Declare', 'c', 'unknown', rows], 'c'],
    ['Block', ['Declare', 'c', 'unknown', rows], ['Length', 'c']],
    ['Any', rows, ['Function', ['Greater', ['Length', 'r'], 1], 'r']],
    ['Filter', rows, ['Function', ['Greater', ['Length', 'r'], 1], 'r']],
    ['Reverse', rows],
    ['Take', rows, 1],
    ['id', rows],
    ['one', rows],
    ['If', ['Greater', 'x', 0], rows, ['Chunk', 'L', 3]],
    ['If', 'True', rows, ['Chunk', 'L', 3]],
    ['Tuple', rows, 'x'],
    ['Tuple', rows, rows, 'L'],
    ['List', rows],
    // The consumers that read the rows one by one, in a branch or a loop.
    ['ListJoin', rows, rows],
    ['ListJoin', ['Partition', 'L', 2], ['Partition', 'L', 3]],
    ['ListJoin', rows, 'L'],
    ['ListJoin', groups, groups],
    ['Join', ['Chunk', 'L', 'k'], ['Chunk', 'L', 'k']],
    ['Length', ['ListJoin', rows, ['Chunk', 'L', 3]]],
    ['Map', size, ['ListJoin', ['Partition', 'L', 'k'], ['Partition', 'L', 'k']]],
    ['Sum', ['Map', size, ['ListJoin', rows, rows]]],
    ['Append', rows, 'x'],
    ['Insert', rows, 1, 'x'],
    ['Reverse', ['Chunk', 'L', 3]],
    ['Most', ['Chunk', 'L', 3]],
    ['RotateLeft', ['Chunk', 'L', 3]],
    ['FlatMap', ['Chunk', 'L', 3], ['Function', 'r', 'r']],
    ['FlatMap', ['Chunk', 'L', 3], sum],
    ['Scan', ['Chunk', 'L', 3], ['Function', ['Add', 'a', ['Sum', 'b']], 'a', 'b'], 0],
    ['Find', ['Chunk', 'L', 3], ['Function', ['Greater', ['Length', 'r'], 1], 'r']],
    ['Comprehension', ['Sum', 'r'], ['Element', 'r', ['Chunk', 'L', 3], ['Greater', ['Length', 'r'], 1]]],
    ['Comprehension', ['Sum', 'r'], ['Element', 'r', ['Chunk', 'L', 3]], ['Element', 'j', ['Range', 1, 2]]],
    ['Map', ['Function', ['Add', ['Sum', 'r'], ['Sum', 's']], 'r', 's'], ['Chunk', 'L', 3], rows],
    ['Map', ['Function', ['If', ['Greater', ['Length', 'r'], 1], ['Sum', 'r'], 0], 'r'], ['Chunk', 'L', 3]],
    ['Map', ['Function', ['Take', 'r', 1], 'r'], ['Chunk', 'L', 3]],
    ['Map', ['Function', ['At', 'r', 1], 'r'], ['Chunk', 'L', 3]],
    ['Tuple', row, ['At', ['Chunk', 'L', 3], 2]],
    ['Tuple', row, 'x'],
    ['If', ['Greater', 'x', 0], row, 'L'],
    ['If', ['Greater', 'x', 0], row, ['At', ['Chunk', 'L', 3], 2]],
    ['If', ['Greater', 'x', 0], ['At', groups, 1], ['At', groups, 2]],
    ['Sum', ['If', ['Greater', 'x', 0], row, ['At', ['Chunk', 'L', 3], 2]]],
    ['Add', row, ['At', ['Chunk', 'L', 3], 2]],
    ['Dot', row, row],
    ['Block', ['Declare', 'q', 'unknown', row], ['Sum', 'q']],
    ['Flatten', ['Chunk', 'L', 3]],
  ];
  const points = POINTS.filter((p) => (p.L as number[]).length > 0).map(
    (p) => ({ ...p, k: 2 })
  );
  /** The compiled value, or `undefined` for a decline (not an internal
   *  error). */
  const compiled: string[] = [];
  const run = (f: () => { run?: (p: never) => unknown }, p: Point) => {
    let r: { run?: (p: never) => unknown };
    try {
      r = f();
    } catch (x) {
      const message =
        (x as { diagnostic?: { message: string } }).diagnostic?.message ??
        (x as Error).message;
      if (/internal|verifier/i.test(message)) throw x;
      return undefined;
    }
    try {
      return { value: r.run!(p as never) };
    } catch (x) {
      // The run-time comparison of two lengths (rows of two lengths added)
      // throws a `RangeError`, where the interpreter gives an error.
      if (!(x instanceof RangeError)) throw x;
      return { value: x as unknown };
    }
  };
  afterAll(() => {
    // The sweep reaches the uses that compile, with and without the passes.
    expect(compiled.length).toBeGreaterThan(5);
  });
  test.each(uses.map((json) => [JSON.stringify(json), json]))(
    '%s',
    (_, json) => {
      const ways = [
        () => js(json),
        () => js(json, { inline: false }),
        () => compileSlice(box(json), { target: 'javascript', passes: false }),
      ];
      for (const way of ways)
        for (const p of points) {
          const got = run(way as never, p);
          if (got === undefined) continue;
          compiled.push(JSON.stringify(json));
          // Where the interpreter gives `Missing` or an error (an element
          // of an empty row, rows of two lengths added), the compiled value
          // is within the caveats of compiled code.
          if (
            /no value: ("Missing"|Error\()/.test(
              failure(() => interpreted(json, p)) ?? ''
            )
          )
            continue;
          expectAgree(json, got.value, p);
        }
    }
  );
});

describe('CE-1549: no batch form', () => {
  const MESSAGE = /rows of different lengths cannot be broadcast/;
  const r = js(['Chunk', 'L', 2]);
  /** The fields of a compilation result that a host stores, as plain data. */
  const stored = (): StoredJavaScript => {
    const {
      run: _run,
      broadcast: _b,
      broadcastAsync: _ba,
      willUsePool: _w,
      runAsync: _ra,
      willParallelize: _wp,
      ...data
    } = r as unknown as Record<string, unknown>;
    return JSON.parse(JSON.stringify(data)) as StoredJavaScript;
  };

  test('broadcast(), broadcastAsync() and willUsePool()', async () => {
    expect(r).toMatchObject({ rows: true, shippable: false });
    expect(() => r.broadcast!({ L: [1, 2, 3] } as never)).toThrow(MESSAGE);
    await expect(r.broadcastAsync!({ L: [1, 2, 3] } as never)).rejects.toThrow(
      MESSAGE
    );
    expect(r.willUsePool!({ L: [1, 2, 3] } as never)).toBe(false);
  });

  test('the stored loaders', () => {
    const data = stored();
    expect(data.rows).toBe(true);
    const rt = createJavaScriptRuntime();
    expect(() => rt.loadBroadcast(data)).toThrow(MESSAGE);
    expect(() => rt.loadBroadcastSlice(data)).toThrow(MESSAGE);
    expect(() => rt.loadBroadcastAsync(data)).toThrow(MESSAGE);
  });

  test('run(), load() and runAsync() return the rows', async () => {
    const want = [[1, 2], [3]];
    expect(r.run!({ L: [1, 2, 3] } as never)).toEqual(want);
    expect(createJavaScriptRuntime().load(stored())({ L: [1, 2, 3] })).toEqual(
      want
    );
    expect(await r.runAsync!({ L: [1, 2, 3] } as never)).toEqual(want);
  });
});
