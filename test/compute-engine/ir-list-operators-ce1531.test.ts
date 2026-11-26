/**
 * CE-1531: list operators that compiled in 0.193.0 and declined in 0.194.0,
 * on the IR compiler (README of `src/compute-engine/compilation/ir/`,
 * "Lists", the list operators): `Append`, `DeleteAt`, `Insert`, `Slice`,
 * `Linspace`, `Chunk`, `Partition`, `TakeWhile`, `DropWhile`, `FlatMap`,
 * `Scan`, `Tabulate` (and `Table`), `Reduce` by a function, `Element`,
 * `Identity`, `CountIf`, `Find`, `IndexWhere`, `Position`, `RandomSample`,
 * `ApplyWhole`, `StartsWith`, `EndsWith`, `ContainsSequence`, and a real
 * count of `Take` and `Drop`.
 *
 * JavaScript agrees with the interpreter within 1e-12 on lists of lengths
 * 0, 1 and several, at indices from the start, from the end, at the ends and
 * out of range. Where the interpreter gives no list (an index out of range,
 * an index that is not an integer), the compiled code throws.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Point = Record<string, number | number[] | number[][]>;

const ce = new ComputeEngine();
for (const name of ['x', 'y']) ce.declare(name, 'real');
ce.declare('n', 'integer');
for (const name of ['L', 'K']) ce.declare(name, 'list<real>');
ce.declare('J', 'list<integer>');
ce.declare('L6', 'list<real^6>');
ce.declare('P', 'list<tuple<real, real>>');
for (const name of ['X', 'Y'])
  ce.declare(name, 'list<nan | real | signed_infinity>');

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options });

/** The diagnostic message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

/** The interpreter's value: a tuple or a list is an array; a lazy
 *  collection is the list of its elements. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (e.symbol === 'True' || e.symbol === 'False') return e.symbol === 'True';
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  // A lazy `FlatMap` of rows of run-time lengths does not know that it is
  // finite: its elements.
  if (isFunction(e, 'FlatMap') && e.isCollection && !e.isFiniteCollection)
    return [...e.each()].map((x) => read(x.N()));
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  throw new Error(`no value: ${e.toString()}`);
}

function interpreted(json: Json, point: Point): unknown {
  const value = (v: number | number[] | number[][]): Expression =>
    Array.isArray(v)
      ? ce.function(
          'List',
          (v as (number | number[])[]).map((x) =>
            Array.isArray(x)
              ? ce.function(
                  'Tuple',
                  x.map((c) => ce.number(c))
                )
              : ce.number(x)
          )
        )
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

function check(json: Json, points: Point[]) {
  const r = js(json);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  for (const p of points) {
    const got = r.run!(p as never);
    const want = interpreted(json, p);
    if (!agree(got, want))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
      );
  }
  return r;
}

/** A predicate `t ↦ t op c`. */
const pred = (op: string, c: unknown) => ['Function', [op, 't', c], 't'];
const add2 = ['Function', ['Add', 't', 'u'], 't', 'u'];
const sub2 = ['Function', ['Subtract', 't', 'u'], 't', 'u'];

// Lists of lengths 0, 1 and several.
// prettier-ignore
const POINTS: Point[] = [
  { x: 0.7, y: 1.3, n: 3, L: [1.5, 2, 3, 4.5, 2], K: [3, 4.5], J: [1, 2, 3], L6: [1, 2, 3, 4, 5, 6] },
  { x: -1.5, y: 2.5, n: 1, L: [], K: [], J: [], L6: [0, -1, 0.5, 2, 2, 8] },
  { x: 2.5, y: -0.5, n: -1, L: [7], K: [7], J: [5], L6: [6, 5, 4, 3, 2, 1] },
  { x: 3, y: 0.25, n: 2, L: [-1, 3, 0.5, 3, 4.5], K: [0.5, 3], J: [4, 4, -2, 0], L6: [1, 1, 2, 2, 3, 3] },
];
/** The points where every list has at least `m` elements. */
const atLeast = (m: number) =>
  POINTS.filter((p) => (p.L as number[]).length >= m);

describe('CE-1531: list operators, the interpreter value', () => {
  // prettier-ignore
  test.each([
    // Append: each operand after the list is one element.
    ['Append', ['Append', 'L', 'x'], POINTS],
    ['Append of two elements', ['Append', 'L', 'x', 'y'], POINTS],
    ['Append of a real to integers', ['Append', 'J', 'x'], POINTS],
    ['Append of a literal list', ['Append', ['List', 1, 2], 'x'], POINTS],
    // DeleteAt and Insert: from 1, from the end when negative.
    ['DeleteAt of the first', ['DeleteAt', 'L', 1], atLeast(1)],
    ['DeleteAt of the last', ['DeleteAt', 'L', -1], atLeast(1)],
    ['DeleteAt of a stated length', ['DeleteAt', 'L6', 6], POINTS],
    ['DeleteAt from the end, of a stated length', ['DeleteAt', 'L6', -6], POINTS],
    ['DeleteAt at a run-time index', ['DeleteAt', 'L6', 'n'], POINTS],
    ['Insert at the front', ['Insert', 'L', 1, 'x'], POINTS],
    ['Insert at the end', ['Insert', 'L', -1, 'x'], POINTS],
    ['Insert past the last', ['Insert', 'L6', 7, 'x'], POINTS],
    ['Insert at a run-time index', ['Insert', 'L6', 'n', 'x'], POINTS],
    ['Insert of a real in integers', ['Insert', 'J', 1, 'x'], POINTS],
    // Slice: a negative index from the end; the start at least 1, the end at
    // least 0 and at most the length.
    ['Slice', ['Slice', 'L', 2, 3], POINTS],
    ['Slice from the end', ['Slice', 'L', -2, -1], POINTS],
    ['Slice from 0 (the first)', ['Slice', 'L', 0, 2], POINTS],
    ['Slice to 0 (empty)', ['Slice', 'L', 2, 0], POINTS],
    ['Slice from 0 to 0 (empty)', ['Slice', 'L', 0, 0], POINTS],
    ['Slice past the end', ['Slice', 'L', 2, 9], POINTS],
    ['Slice from before the start', ['Slice', 'L', -9, 2], POINTS],
    ['Slice to before the start (empty)', ['Slice', 'L', 1, -9], POINTS],
    ['Slice from a run-time 0', ['Slice', 'L', ['Subtract', 'n', 'n'], 2], POINTS],
    ['Slice empty', ['Slice', 'L', 3, 2], POINTS],
    ['Slice of rounded reals', ['Slice', 'L', 1.5, 3.5], POINTS],
    ['Slice of run-time reals', ['Slice', 'L', 'x', 'y'], POINTS],
    ['Slice of a run-time integer', ['Slice', 'L6', 'n', 4], POINTS],
    // Linspace.
    ['Linspace', ['Linspace', 0, 1, 5], POINTS],
    ['Linspace of inputs', ['Linspace', 'x', 'y', 5], POINTS],
    ['Linspace of a run-time count', ['Linspace', 'x', 'y', 'n'], POINTS],
    ['Linspace of a real count', ['Linspace', 0, 10, 'x'], POINTS],
    ['Linspace of one element', ['Linspace', 'x', 'y', 1], POINTS],
    ['Linspace of the default count', ['Linspace', 'x', 'y'], POINTS],
    ['Linspace of one operand', ['Linspace', 'y'], POINTS],
    ['Linspace of integer steps', ['Linspace', 2, 10, 5], POINTS],
    // Chunk and Partition: rows of one length.
    ['Chunk of a stated length', ['Chunk', 'L6', 2], POINTS],
    ['Chunk of three', ['Chunk', 'L6', 3], POINTS],
    ['Partition of a stated length', ['Partition', 'L6', 3], POINTS],
    ['Partition in windows', ['Partition', 'L', 2, 1], POINTS],
    ['Partition in windows of a step', ['Partition', 'L', 3, 2], POINTS],
    // TakeWhile, DropWhile.
    ['TakeWhile', ['TakeWhile', 'L', pred('Less', 2.5)], POINTS],
    ['DropWhile', ['DropWhile', 'L', pred('Less', 2.5)], POINTS],
    ['TakeWhile of all', ['TakeWhile', 'L', pred('Less', 9)], POINTS],
    ['DropWhile of all', ['DropWhile', 'L', pred('Less', 9)], POINTS],
    ['TakeWhile of an input', ['TakeWhile', 'L', pred('Less', 'x')], POINTS],
    ['Length of a TakeWhile', ['Length', ['TakeWhile', 'L', pred('Less', 2.5)]], POINTS],
    // FlatMap.
    ['FlatMap of a list', ['FlatMap', 'L', ['Function', ['List', 't', 't'], 't']], POINTS],
    ['FlatMap of a scalar', ['FlatMap', 'L', ['Function', ['Multiply', 't', 2], 't']], POINTS],
    ['FlatMap of three', ['FlatMap', 'L', ['Function', ['List', 't', ['Multiply', 't', 'x'], 1], 't']], POINTS],
    // Rows of run-time lengths: the lane `rows`, whose elements `rows.flat`
    // copies in order (CE-1736).
    ['FlatMap of rows of run-time lengths', ['FlatMap', 'J', ['Function', ['Range', 1, 't'], 't']], POINTS],
    // Scan.
    ['Scan', ['Scan', 'L', add2], POINTS],
    ['Scan from a value', ['Scan', 'L', sub2, 10], POINTS],
    ['Scan by a name', ['Scan', 'L', 'Add'], POINTS],
    ['Scan by Max from a value', ['Scan', 'L', 'Max', 3], POINTS],
    ['Scan of integers', ['Scan', 'J', 'Add'], POINTS],
    ['Scan of integers to reals', ['Scan', 'J', ['Function', ['Divide', 't', 'u'], 't', 'u']], POINTS],
    ['Scan reading an input', ['Scan', 'L', ['Function', ['Add', 't', 'u', 'x'], 't', 'u'], 'x'], POINTS],
    // Tabulate and Table.
    ['Tabulate', ['Tabulate', ['Function', ['Multiply', 'k', 'k'], 'k'], 5], POINTS],
    ['Tabulate of a run-time count', ['Tabulate', ['Function', ['Multiply', 'k', 'x'], 'k'], 'n'], POINTS],
    ['Tabulate of two dimensions', ['Tabulate', ['Function', ['Add', 'i', ['Multiply', 10, 'j']], 'i', 'j'], 2, 3], POINTS],
    ['Table', ['Table', ['Multiply', 'k', 'x'], ['Tuple', 'k', 1, 5]], POINTS],
    // Reduce by a function, from a value.
    ['Reduce by a literal', ['Reduce', 'L', add2, 0], POINTS],
    ['Reduce by Subtract, a left fold', ['Reduce', 'L', sub2, 10], POINTS],
    ['Reduce of integers', ['Reduce', 'J', ['Function', ['Add', 't', ['Multiply', 2, 'u']], 't', 'u'], 1], POINTS],
    ['Reduce of integers to reals', ['Reduce', 'J', ['Function', ['Divide', 't', 'u'], 't', 'u'], 1], POINTS],
    ['Reduce reading an input', ['Reduce', 'L', ['Function', ['Max', 't', ['Multiply', 'u', 'x']], 't', 'u'], 'x'], POINTS],
    // Element, Identity.
    ['Element of an input', ['Element', 'x', 'L'], POINTS],
    ['Element of a literal', ['Element', 2, 'L'], POINTS],
    ['Element of integers', ['Element', 'n', 'J'], POINTS],
    ['Identity', ['Identity', 'x'], POINTS],
    // The searches by a predicate.
    ['CountIf', ['CountIf', 'L', pred('Greater', 2)], POINTS],
    ['Find', ['Find', 'L', pred('Greater', 2)], POINTS],
    ['Find of integers', ['Find', 'J', pred('Greater', 1)], POINTS],
    ['Find by a library predicate', ['Find', 'L', 'IsPrime'], POINTS],
    ['IndexWhere', ['IndexWhere', 'L', pred('Greater', 2)], POINTS],
    ['Position', ['Position', 'L', pred('Greater', 2)], POINTS],
    ['Sum of a Position', ['Sum', ['Position', 'L', pred('Greater', 2)]], POINTS],
    // ApplyWhole binds the list whole.
    ['ApplyWhole of a literal', ['ApplyWhole', ['Function', ['Add', 't', 't'], 't'], 'L'], POINTS],
    ['ApplyWhole of a library operator', ['ApplyWhole', 'Sum', 'L'], POINTS],
    // The subsequences: NaN matches NaN.
    ['StartsWith', ['StartsWith', 'L', ['List', 1.5]], POINTS],
    ['StartsWith of an input', ['StartsWith', 'L', 'K'], POINTS],
    ['StartsWith of integers', ['StartsWith', 'J', ['List', 1, 2]], POINTS],
    ['EndsWith', ['EndsWith', 'L', ['List', 2]], POINTS],
    ['EndsWith of an input', ['EndsWith', 'L', 'K'], POINTS],
    ['ContainsSequence', ['ContainsSequence', 'L', ['List', 2, 3]], POINTS],
    ['ContainsSequence of an input', ['ContainsSequence', 'L', 'K'], POINTS],
    // A real count of Take and Drop is rounded (`Math.round`).
    ['Take of a real count', ['Take', 'L', 'x'], POINTS],
    ['Drop of a real count', ['Drop', 'L', 'x'], POINTS],
    ['Take of a constant real count', ['Take', 'L', 2.5], POINTS],
    ['Drop of a negative real count', ['Drop', 'L', -1.5], POINTS],
    ['Take of an infinite count', ['Take', 'L', 'PositiveInfinity'], POINTS],
    ['Drop of a negative infinite count', ['Drop', 'L', 'NegativeInfinity'], POINTS],
  ])('%s', (_, json, points) => {
    check(json, points as Point[]);
  });

  test('the subsequences: NaN matches NaN, as in the interpreter', () => {
    // prettier-ignore
    const points = [
      { X: [1, NaN, 3], Y: [NaN, 3] },
      { X: [NaN], Y: [NaN] },
      { X: [1, 2], Y: [NaN] },
      { X: [], Y: [] },
    ];
    for (const h of ['StartsWith', 'EndsWith', 'ContainsSequence'])
      check([h, 'X', 'Y'], points);
  });

  test('Append of a point to a list of points', () => {
    const points = [
      { x: 0.5, P: [] },
      { x: -1, P: [[1, 2]] },
      {
        x: 2,
        P: [
          [1, 2],
          [3, 4],
          [5, -6],
        ],
      },
    ];
    check(['Append', 'P', ['Tuple', 'x', 2]], points);
    check(['Append', 'P', ['Tuple', 'x', 2], ['Tuple', 3, 'x']], points);
  });

  test('RandomSample draws as the interpreter in a seeded frame', () => {
    for (const seed of [7, 42])
      for (const json of [
        ['WithRandomSeed', seed, ['RandomSample', 'L6', 2]],
        ['WithRandomSeed', seed, ['RandomSample', 'L6', 'n']],
        ['WithRandomSeed', seed, ['RandomSample', ['Range', 1, 20], 5]],
        ['WithRandomSeed', seed, ['RandomSample', 'L', 0]],
      ])
        check(
          json,
          POINTS.filter((p) => (p.n as number) >= 0)
        );
  });

  // A sample of a literal list is a draw at each run, not a value computed
  // at compile time.
  test('a reduction of a sample of a literal list draws at each run', () => {
    const sample = ['RandomSample', ['List', 1, 2, 3, 4, 5, 6, 7, 8], 2];
    const r = js(['Sum', sample]);
    const runs = new Set(
      Array.from({ length: 40 }, () => r.run!({} as never) as number)
    );
    expect(runs.size).toBeGreaterThan(1);
    for (const seed of [11, 42])
      check(['WithRandomSeed', seed, ['Sum', sample]], [{}]);
  });
});

describe('CE-1531: where the interpreter gives no list, the compiled code throws', () => {
  // prettier-ignore
  test.each([
    ['DeleteAt of an empty list', ['DeleteAt', 'L', 1], { L: [] }, /out-of-range/],
    ['DeleteAt at 0', ['DeleteAt', 'L', 'n'], { L: [1, 2], n: 0 }, /out-of-range/],
    ['DeleteAt past the end', ['DeleteAt', 'L', 'n'], { L: [1, 2], n: 3 }, /out-of-range/],
    ['DeleteAt at a real index', ['DeleteAt', 'L', 'x'], { L: [1, 2], x: 1.5 }, /out-of-range/],
    ['Insert past the end', ['Insert', 'L', 'n', 'x'], { L: [1, 2], n: 4, x: 1 }, /out-of-range/],
    ['Tabulate of a real count', ['Tabulate', ['Function', ['Multiply', 'k', 2], 'k'], 'x'], { x: 2.5 }, /incompatible-type/],
    ['RandomSample of more than the length', ['RandomSample', 'L', 3], { L: [1, 2] }, /RandomSample/],
    ['RandomSample of a negative count', ['RandomSample', 'L', 'n'], { L: [1, 2], n: -1 }, /RandomSample/],
  ])('%s', (_, json, point, error) => {
    const r = js(json);
    expect(() => r.run!(point as never)).toThrow(error);
  });
});

describe('CE-1531: declines', () => {
  // prettier-ignore
  test.each([
    // A list of lists whose rows can have two lengths, on GLSL (`Chunk` and
    // `Partition` of such rows are `ir-ragged-rows-ce1549.test.ts`).
    ['FlatMap of rows of run-time lengths, on GLSL', ['FlatMap', 'J', ['Function', ['Range', 1, 't'], 't']], 'glsl', 'a list of lists of run-time length'],
    ['FlatMap of a point', ['FlatMap', 'L', ['Function', ['Tuple', 't', 't'], 't']], 'javascript', 'a tuple'],
    // The interpreter's list is lazy: an effect declines.
    ['TakeWhile of a list with an effect', ['TakeWhile', ['Map', ['Function', ['Add', 't', ['Random']], 't'], 'L'], pred('Less', 2.5)], 'javascript', 'with an effect'],
    ['Scan from an initial value with an effect', ['Scan', 'L', 'Add', ['Random']], 'javascript', 'with an effect'],
    ['Reduce from an initial value with an effect', ['Reduce', 'L', add2, ['Random']], 'javascript', 'with an effect'],
    ['Partition in windows of a run-time step', ['Partition', 'L6', 2, 'n'], 'javascript', 'a step that is not a constant'],
    ['Tabulate with an effect', ['Tabulate', ['Function', ['Add', 'k', ['Random']], 'k'], 3], 'javascript', 'with an effect'],
    ['Find by a predicate with an effect', ['Find', 'L', ['Function', ['Less', 't', ['Random']], 't']], 'javascript', 'with an effect'],
    // Exact values of the interpreter.
    ['Element of an exact rational', ['Element', ['Rational', 1, 3], 'L'], 'javascript', 'may hold exactly'],
    ['StartsWith of an exact rational', ['StartsWith', 'L', ['List', ['Rational', 1, 2]]], 'javascript', 'may hold exactly'],
    // A constant index out of a stated length.
    ['DeleteAt out of a stated length', ['DeleteAt', 'L6', 7], 'javascript', 'the index 7 of DeleteAt'],
    ['Insert at 0', ['Insert', 'L', 0, 'x'], 'javascript', 'the index 0 of Insert'],
    ['Append of a list', ['Append', 'L', 'K'], 'javascript', 'an element of Append'],
    ['Append of a point of another dimension', ['Append', 'P', ['Tuple', 'x', 2, 3]], 'javascript', 'the same dimension'],
    // GLSL and the interval mode.
    ['RandomSample on GLSL', ['RandomSample', 'L6', 2], 'glsl', 'RandomSample on a target with no draw of a list'],
    ['Insert at a run-time index on GLSL', ['Insert', 'L6', 'n', 'x'], 'glsl', 'Insert at an index known at run time'],
    ['Linspace on interval-js', ['Linspace', 0, 1, 5], 'interval-js', 'Linspace on interval-js'],
    ['Find on interval-js', ['Find', 'L', pred('Greater', 2)], 'interval-js', 'Find on interval-js'],
    ['Scan on interval-js', ['Scan', 'L', 'Add'], 'interval-js', 'Scan on interval-js'],
    ['Reduce by a function on interval-js', ['Reduce', 'L', add2, 0], 'interval-js', 'Reduce by a function on interval-js'],
  ])('%s', (_, json, to, cause) => {
    expect(failure(() => js(json, { to }))).toContain(cause);
  });

  test('a parameter annotated with a type that its values have compiles', () => {
    for (const json of [
      [
        'CountIf',
        'L',
        ['Function', ['Greater', 't', 1], ['Typed', 't', { str: 'real' }]],
      ],
      [
        'CountIf',
        'J',
        ['Function', ['Greater', 't', 1], ['Typed', 't', { str: 'integer' }]],
      ],
      [
        'Tabulate',
        ['Function', ['Multiply', 2, 'k'], ['Typed', 'k', { str: 'integer' }]],
        3,
      ],
    ])
      expect(js(json)).toMatchObject({ success: true });
  });

  test('on GLSL, a constant index of a list of a stated length is written out', () => {
    for (const json of [
      ['DeleteAt', 'L6', 2],
      ['Slice', 'L6', 2, -1],
      ['Tabulate', ['Function', ['Multiply', 'k', 'k'], 'k'], 5],
    ])
      expect(js(json, { to: 'glsl' })).toMatchObject({ success: true });
  });
});
