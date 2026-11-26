/**
 * A list of indexes into a list of points, and `If` and `Which` of a list
 * condition (CE-1464; README of `src/compute-engine/compilation/ir/`,
 * "Lists"). `At(P, I)` of a list of points `P` and a list of numbers `I` is
 * the list of the `At` of each index, as `Map(k ↦ At(P, k), I)`: a point of
 * NaN out of range. `Which(c1, a1, …, True, d)` whose first condition is a
 * list of booleans selects at each position, as the interpreter's
 * (`numpy.select`): the first arm whose condition is true there, a list arm
 * read at the position and a scalar or a point the same at every position,
 * NaN (a point of NaN) where none is. `If(c, a, b)` of a list condition is
 * `Which(c, a, True, b)`.
 * JavaScript agrees with the interpreter; GLSL compiles lists of stated
 * lengths; the interval mode declines the selection.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Value = number | boolean | Value[];
type Point = Record<string, Value>;

const ce = new ComputeEngine();
ce.declare('x', 'real');
for (const name of ['L', 'K', 'D']) ce.declare(name, 'list<real>');
ce.declare('B', 'list<boolean>');
ce.declare('Pp', 'list<tuple<real, real>>');
ce.declare('L3', 'list<real^3>');
ce.declare('K3', 'list<real^3>');
ce.declare('P3', 'list<tuple<real, real>^3>');

const OPTIONS = { fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json) => compile(box(json), OPTIONS);
const glsl = (json: Json) => compile(box(json), { ...OPTIONS, to: 'glsl' });
const interval = (json: Json) =>
  compile(box(json), { ...OPTIONS, to: 'interval-js' });

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

/** The interpreter's value: a tuple or a list is an array. */
function read(e: Expression): Value {
  if (isNumber(e)) return e.re;
  if (isSymbol(e, 'True')) return true;
  if (isSymbol(e, 'False')) return false;
  if (isSymbol(e, 'NaN')) return NaN;
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  throw new Error(`no value: ${e.toString()}`);
}

function boxed(v: Value): Expression {
  if (typeof v === 'boolean') return v ? ce.True : ce.False;
  if (Array.isArray(v))
    return ce.function(
      'List',
      v.map((x) => boxed(x))
    );
  return ce.number(v);
}

/** A list of points of the interpreter: a `List` of `Tuple`. */
const points = (ps: number[][]) =>
  ce.function(
    'List',
    ps.map((p) =>
      ce.function(
        'Tuple',
        p.map((c) => ce.number(c))
      )
    )
  );

function interpreted(json: Json, point: Point): Value {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      k.startsWith('P') ? points(v as number[][]) : boxed(v),
    ])
  );
  return ce.withValues(values as never, () => read(box(json).evaluate().N()));
}

/** `v` and `w` have one shape and agree (NaN is NaN). */
function agree(v: unknown, w: Value): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x))
    );
  if (typeof w === 'boolean') return v === w;
  if (Number.isNaN(w)) return typeof v === 'number' && Number.isNaN(v);
  return (
    typeof v === 'number' && Math.abs(v - w) <= 1e-12 * Math.max(1, Math.abs(w))
  );
}

/** The compiled value at each point is the interpreter's. */
function check(json: Json, at: Point[]) {
  const r = js(json);
  expect(r).toMatchObject({ success: true });
  for (const p of at) {
    const got = r.run!(p as never);
    const want = interpreted(json, p);
    if (!agree(got, want))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
      );
  }
  return r;
}

const PP = [
  [1, 2],
  [3, 4],
  [5, 6],
];

describe('the witnesses of CE-1464 on JavaScript', () => {
  test('At(Pp, L), a gather of points', () => {
    const r = check(['At', 'Pp', 'L'], [{ Pp: PP, L: [3, 1] }]);
    expect(r.run!({ Pp: PP, L: [3, 1] } as never)).toEqual([
      [5, 6],
      [1, 2],
    ]);
  });

  test('Which(3 < L, 1, True, 0), a selection at each position', () => {
    const r = check(['Which', ['Less', 3, 'L'], 1, 'True', 0], [{ L: [2, 5] }]);
    expect(r.run!({ L: [2, 5] } as never)).toEqual([0, 1]);
  });
});

describe('At of a list of indexes into a list of points', () => {
  // An index that is not an integer, 0, negative, out of range: a point of
  // NaN, the interpreter's value, as for one index.
  const INDEXES = [[3, 1], [2.5], [0], [-1], [4], [-4], [1, 0, 5, -2], []];
  test.each(INDEXES.map((L) => [JSON.stringify(L), L]))(
    'the indexes %s',
    (_, L) => {
      check(['At', 'Pp', 'L'], [{ Pp: PP, L }]);
      check(['At', 'Pp', ['Add', 'L', 1]], [{ Pp: PP, L }]);
    }
  );

  test('a list of numbers keeps its gather', () => {
    for (const L of INDEXES) check(['At', 'D', 'L'], [{ D: [10, 20, 30], L }]);
  });

  test('a literal list of indexes and a list of points of a stated length', () => {
    check(['At', 'P3', ['List', 3, 1, 'x']], [{ P3: PP, x: 2 }]);
    check(['At', 'P3', 'L3'], [{ P3: PP, L3: [2, 0, 3] }]);
  });

  test('declines: a list of booleans, two index operands, GLSL, the interval mode', () => {
    expect(failure(() => js(['At', 'B', 'L']))).toMatch(
      /a list where a scalar is required/
    );
    const nested = ['List', ['List', 1, 2], ['List', 3, 4]];
    expect(failure(() => js(['At', nested, 'L', 1]))).toMatch(
      /At with an index for each level/
    );
    expect(failure(() => js(['At', nested, 1, 'L']))).toMatch(
      /At with an index for each level/
    );
    for (const f of [glsl, interval])
      expect(failure(() => f(['At', 'P3', ['List', 3, 1]]))).toMatch(
        /an index that can be out of range/
      );
  });
});

describe('If and Which of a list condition on JavaScript', () => {
  // prettier-ignore
  const PROGRAMS: [string, Json, Point[]][] = [
    ['two list conditions', ['Which', ['Less', 3, 'L'], 1, ['Less', 'K', 0], 2, 'True', 0], [{ L: [2, 5, 1], K: [-1, 1, 1] }, { L: [], K: [] }]],
    ['no default: NaN where no clause holds', ['Which', ['Less', 3, 'L'], 1, ['Less', 'K', 0], 2], [{ L: [2, 5, 1], K: [-1, 1, 1] }]],
    ['a list arm, read at each position', ['Which', ['Less', 3, 'L'], 'K', 'True', 0], [{ L: [2, 5], K: [7, 8] }]],
    ['two list arms', ['Which', ['Less', 3, 'L'], ['Multiply', 2, 'L'], 'True', ['List', 9, 10]], [{ L: [2, 5] }]],
    ['scalar arms of an input', ['Which', ['Less', 3, 'L'], ['Multiply', 2, 'x'], 'True', ['Add', 'x', 1]], [{ L: [2, 5, 4], x: 3 }]],
    ['a scalar condition after the list one', ['Which', ['Less', 3, 'L'], 1, ['Less', 'x', 0], 2, 'True', 3], [{ L: [2, 5], x: -1 }, { L: [2, 5], x: 1 }]],
    ['a clause after True is not read', ['Which', ['Less', 3, 'L'], 1, 'True', 0, ['Less', 'x', 0], 2], [{ L: [2, 5], x: -1 }]],
    ['boolean arms with a default', ['Which', ['Less', 3, 'L'], 'True', 'True', 'False'], [{ L: [2, 5] }]],
    ['a condition that is an input', ['Which', 'B', 1, 'True', 0], [{ B: [true, false, true] }]],
    ['a comparison of two lists', ['Which', ['Less', 'K', 'L'], 1, 'True', 0], [{ L: [2, 5], K: [3, 3] }]],
    ['an empty list', ['Which', ['Less', 3, 'L'], 1, 'True', 0], [{ L: [] }]],
    ['If with an else', ['If', ['Less', 3, 'L'], 'L', 0], [{ L: [2, 5, 7] }]],
    ['If with no else, a scalar arm', ['If', ['Less', 3, 'L'], 1], [{ L: [2, 5, 7] }]],
    ['If with no else, a point arm', ['If', ['Less', 3, 'L'], ['Tuple', 1, 2]], [{ L: [2, 5, 7] }]],
    // With no else, a list arm is restricted to the mask, to the shorter of
    // the two lengths, as in the interpreter (CE-1564).
    ['If with no else, a list arm', ['If', ['Less', 3, 'L'], 'K'], [{ L: [5, 2, 5], K: [1, 2, 3] }, { L: [5, 5, 5], K: [1, 2] }, { L: [5, 2], K: [1, 2, 3] }, { L: [], K: [1] }]],
    ['If with no else, a list of points arm', ['If', ['Less', ['PointX', 'Pp'], 20], 'Pp'], [{ Pp: [[1, 2], [30, 4], [5, 6]] }]],
    ['a reduction of a selection', ['Sum', ['Which', ['Less', 3, 'L'], 'L', 'True', 0]], [{ L: [2, 5, 7] }]],
    ['stated lengths', ['If', ['Less', 3, 'L3'], 'K3', ['Multiply', 'x', 'L3']], [{ L3: [2, 5, 7], K3: [1, 2, 3], x: 2 }]],
    ['point arms', ['Which', ['Less', 3, 'L'], ['Tuple', 1, 2], 'True', ['Tuple', 'x', 4]], [{ L: [2, 5], x: 3 }]],
    ['point arms, no default: a point of NaN', ['Which', ['Less', 3, 'L'], ['Tuple', 1, 2]], [{ L: [2, 5] }]],
    ['a list of points as an arm', ['Which', ['Less', 3, 'L'], 'Pp', 'True', ['Tuple', 'x', 0]], [{ L: [2, 5], Pp: [[1, 2], [3, 4]], x: 9 }]],
    ['a coordinate of a selection of points', ['PointX', ['Which', ['Less', 3, 'L'], 'Pp']], [{ L: [2, 5], Pp: [[1, 2], [3, 4]] }]],
    // A list that an arm builds of the length of the first condition, or a
    // later condition of its own length, is built before the selection; a
    // `Range` arm is read at each position, never built (CE-1562).
    ['a Map arm of a list of indexes', ['Which', ['Equal', ['Mod', 'K', 2], 1], ['Map', ['Function', ['Multiply', 2, 'w'], 'w'], ['At', 'L', 'K']], 'True', 0], [{ L: [5, 6, 7], K: [1, 2, 3] }]],
    ['Range arms and a later Range condition', ['Which', ['Equal', ['Mod', ['Range', 1, 'x'], 3], 1], ['Range', 1, 'x'], ['Equal', ['Mod', ['Range', 1, 'x'], 3], 2], ['Range', 0, ['Add', 'x', -1]], 'True', 0], [{ x: 6 }, { x: 1 }]],
    ['a later condition that builds a list', ['Which', ['Less', 3, 'L'], 1, ['Less', 2, ['Range', 1, 'x']], 2, 'True', 0], [{ L: [5, 1, 1], x: 3 }]],
    ['a restriction to a Range', ['If', ['Less', 3, 'L'], ['Range', 1, 'x']], [{ L: [5, 1, 5], x: 2 }, { L: [5, 1], x: 4 }]],
  ];
  test.each(PROGRAMS)('%s', (_, json, at) => {
    check(json, at);
  });

  // A `Range` arm of another length than the mask is never built: its
  // length is compared with the mask's before the selection, and the check
  // throws also where no position selects the arm, where the interpreter
  // has a value (`docs/COMPILATION-MODEL.md`, the known limitations).
  test.each([
    [
      'of an infinite length',
      ['If', 'B', 0, ['Range', 1, ['Divide', 1, 'x']]],
      { B: [true], x: 0 },
      [0],
    ],
    [
      'of 2^32 elements',
      ['Which', ['Less', 3, 'L'], ['Range', 1, 'x'], 'True', 0],
      { L: [1, 2], x: 2 ** 32 },
      [0, 0],
    ],
  ])('a Range arm that no position selects, %s', (_, json, p, want) => {
    const r = js(json as Json);
    expect(r).toMatchObject({ success: true });
    expect(interpreted(json as Json, p as Point)).toEqual(want);
    expect(() => r.run!(p as never)).toThrow(
      /^incompatible-dimensions: lists of lengths \d+ and (\d+|Infinity)$/
    );
  });

  test('lists of two run-time lengths are compared (CE-1238)', () => {
    // The interpreter gives `incompatible-dimensions` for a later list
    // condition of another length than the first: the lengths are compared
    // before the selection (a `RangeError`), never an arm whole. A
    // comparison of two lists compares their lengths first.
    const r = js([
      'Which',
      ['Less', 3, 'L'],
      1,
      ['Less', 'K', 0],
      2,
      'True',
      0,
    ]);
    expect(() => r.run!({ L: [2, 5, 1], K: [-1, 1] } as never)).toThrow(
      /^incompatible-dimensions: lists of lengths 3 and 2$/
    );
    const s = js(['Which', ['Less', 'K', 'L'], 1, 'True', 0]);
    expect(() => s.run!({ L: [2, 5], K: [3, 3, 3] } as never)).toThrow(
      RangeError
    );
  });

  // prettier-ignore
  test.each([
    ['a scalar condition before the list one', ['Which', ['Less', 3, 'x'], 1, ['Less', 3, 'L'], 2, 'True', 0], /a scalar condition before a list condition/],
    ['an arm with an effect', ['Which', ['Less', 3, 'L'], ['Random'], 'True', 0], /whose arms or later conditions are not pure/],
    // The interpreter evaluates an arm only where the selection reaches it.
    ['an arm that can throw', ['Which', ['Less', 3, 'L'], ['AssertPresent', ['If', ['Less', 0, 'x'], 1]], 'True', 0], /whose arms or later conditions are not pure/],
    // An arm that builds a list of another length than the first condition
    // would fail where that length is 2^32 or more, also where no position
    // selects the arm (CE-1562).
    ['a scalar arm that builds a list', ['Which', ['Less', 3, 'L'], ['Max', ['Range', 1, 'x']], 'True', 0], /whose arms or later conditions are not pure/],
    // The interpreter does not evaluate a condition after a scalar one that
    // holds.
    ['a later condition that builds a list after a scalar condition', ['Which', ['Less', 3, 'L'], 1, ['Less', 1000, 'x'], 0, ['Less', 2, ['Range', 1, 'x']], 2, 'True', 0], /whose arms or later conditions are not pure/],
    ['a Range of literals of another stated length',['Which', ['Less', 3, 'L3'], ['Range', 1, 4], 'True', 0], /lists of two lengths/],
    ['an arm that maps a Range',['Which', ['Less', 3, 'L'], ['Map', ['Function', ['Multiply', 2, 'w'], 'w'], ['Range', 1, 'x']], 'True', 0], /whose arms or later conditions are not pure/],
    ['a Map arm of a function with an effect', ['Which', ['Less', 3, 'L'], ['Map', ['Function', ['Multiply', ['Random'], 'w'], 'w'], 'L'], 'True', 0], /whose arms or later conditions are not pure/],
    ['an arm that writes a local', ['Block', ['Declare', 'p', "'real'", 0], ['Which', 'B', ['Assign', 'p', 1], 'True', 0], 'p'], /a selection at each position that writes a name/],
    ['a number arm and a point arm (an error of the canonical form)', ['Which', ['Less', 3, 'L'], ['Tuple', 1, 2], 'True', 'x'], /an error of the canonical form/],
    ['points of two lengths', ['If', ['Less', 3, 'L'], ['Tuple', 1, 2], ['Tuple', 3, 4, 5]], /arms of two types/],
    ['booleans with no default', ['Which', 'B', 'True'], /booleans with no default/],
  ])('declines: %s', (_, json, message) => {
    expect(failure(() => js(json))).toMatch(message);
  });
});

describe('If and Which of a list condition on GLSL and in the interval mode', () => {
  test('GLSL compiles lists of stated lengths, written out', () => {
    for (const json of [
      ['Which', ['Less', 3, 'L3'], 1, 'True', 0],
      ['If', ['Less', 3, 'L3'], 'K3', 'x'],
      ['Sum', ['Which', ['Less', 3, 'L3'], 'L3', 'True', 0]],
    ])
      expect(glsl(json)).toMatchObject({ success: true });
  });

  test('GLSL declines a run-time length; the interval mode declines', () => {
    expect(
      failure(() => glsl(['Which', ['Less', 3, 'L'], 1, 'True', 0]))
    ).toMatch(/run-time length/);
    expect(
      failure(() => interval(['Which', ['Less', 3, 'L3'], 1, 'True', 0]))
    ).toMatch(/a selection at each position in the interval mode/);
    // A list of points is an array of vectors (CE-1538).
    expect(
      glsl([
        'Which',
        ['Less', 3, 'L3'],
        ['Tuple', 1, 2],
        'True',
        ['Tuple', 3, 4],
      ])
    ).toMatchObject({ success: true });
  });
});
