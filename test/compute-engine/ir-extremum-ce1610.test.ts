/**
 * CE-1610: `ArgMax`, `ArgMin`, `MaxBy` and `MinBy` compile (README of
 * `src/compute-engine/compilation/ir/`, "Lists", the list operators).
 *
 * JavaScript agrees with the interpreter on lists of one element and of
 * several, with equal keys (the first one wins) and with infinite keys.
 * Where the interpreter leaves the form unevaluated (no element, a NaN key
 * among two elements or more), `ArgMax` and `ArgMin` are 0, and `MaxBy` and
 * `MinBy` are NaN.
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
ce.declare('a', 'real');
ce.declare('L', 'list<real>');
ce.declare('J', 'list<integer>');
ce.declare('X', 'list<nan | real | signed_infinity>');
ce.declare('L4', 'list<real^4>');
ce.declare('P', 'list<tuple<real, real>>');
ce.declare('P3', 'list<tuple<real, real>^3>');
ce.declare('S', 'list<string>');
ce.declare('z', 'complex');
ce.declare('g', '(real) -> real');
ce.assign(
  'g',
  ce.box(['Function', ['Square', ['Subtract', 't', 2]], 't'] as never)
);

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

/** The value of `json` in the interpreter with the inputs of `point`: a
 *  list of numbers is a `List`, a list of pairs a `List` of `Tuple`. */
function interpreted(json: Json, point: Point): Expression {
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
  return ce.withValues(values as never, () => box(json).evaluate().N());
}

/** A number, or the array of the elements of a tuple. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isFunction(e, 'Tuple')) return e.ops.map(read);
  throw new Error(`no value: ${e.toString()}`);
}

function check(json: Json, points: Point[]) {
  const r = js(json);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  for (const p of points)
    expect([p, r.run!(p as never)]).toEqual([p, read(interpreted(json, p))]);
}

/** `t ↦ |t − a|`, the distance to the input `a`. */
const distance = ['Function', ['Abs', ['Subtract', 't', 'a']], 't'];
const negate = ['Function', ['Negate', 't'], 't'];
/** `t ↦ √t`, which is not a real number of a negative element. */
const root = ['Function', ['Sqrt', 't'], 't'];
/** The coordinate `k` of a point. */
const coordinate = (k: number) => ['Function', ['At', 'p', k], 'p'];

// Lists of one element and of several, with equal keys.
// prettier-ignore
const POINTS: Point[] = [
  { a: 8, L: [3, 9, 2], J: [3, 9, 2], X: [1, Infinity, 3], P: [[1, 2], [3, 0], [5, 0]] },
  { a: 2.5, L: [3, 9, 9, 2, 2], J: [4, 4, -2, -2], X: [Infinity, Infinity], P: [[5, 1], [5, 7], [0, 7]] },
  { a: 0, L: [7], J: [5], X: [NaN], P: [[4, 4]] },
  { a: -1, L: [-1.5, -1.5, -0.5], J: [0, 0], X: [-Infinity, 2, -Infinity], P: [[0, 0], [0, 0]] },
];

describe('CE-1610: ArgMax, ArgMin, MaxBy and MinBy, the interpreter value', () => {
  // prettier-ignore
  test.each([
    ['ArgMax', ['ArgMax', 'L']],
    ['ArgMin', ['ArgMin', 'L']],
    ['ArgMax of integers', ['ArgMax', 'J']],
    ['ArgMin of integers', ['ArgMin', 'J']],
    ['ArgMax of infinities, and of one NaN', ['ArgMax', 'X']],
    ['ArgMin of infinities, and of one NaN', ['ArgMin', 'X']],
    ['ArgMin by a key', ['ArgMin', 'L', distance]],
    ['ArgMax by a key', ['ArgMax', 'L', distance]],
    ['ArgMax by a library operator', ['ArgMax', 'L', 'Abs']],
    ['ArgMin by a user function', ['ArgMin', 'L', 'g']],
    ['ArgMax of points by a coordinate', ['ArgMax', 'P', coordinate(1)]],
    ['ArgMin of points by a coordinate', ['ArgMin', 'P', coordinate(2)]],
    ['MaxBy', ['MaxBy', 'L', distance]],
    ['MinBy', ['MinBy', 'L', distance]],
    ['MaxBy of integers', ['MaxBy', 'J', negate]],
    ['MinBy of integers', ['MinBy', 'J', negate]],
    ['MaxBy of points: a point', ['MaxBy', 'P', coordinate(2)]],
    ['MinBy of points: a point', ['MinBy', 'P', coordinate(1)]],
    ['a coordinate of MinBy of points', ['At', ['MinBy', 'P', coordinate(2)], 1]],
    ['the element at ArgMin', ['At', 'L', ['ArgMin', 'L']]],
    ['ArgMax of a literal list of inputs', ['ArgMax', ['List', 'a', 2, ['Square', 'a']]]],
    ['ArgMax of a Range', ['ArgMax', ['Range', 1, 5]]],
    ['ArgMin of a Map', ['ArgMin', ['Map', distance, 'L']]],
  ] as [string, Json][])('%s', (_name, json) => {
    check(json, POINTS);
  });
});

describe('CE-1610: no value in the interpreter', () => {
  // prettier-ignore
  test.each([
    ['ArgMax of no element', ['ArgMax', 'L'], { L: [] }, 0],
    ['ArgMin by a key of no element', ['ArgMin', 'L', distance], { a: 1, L: [] }, 0],
    ['ArgMax of a NaN among several', ['ArgMax', 'X'], { X: [1, NaN, 3] }, 0],
    ['ArgMin of a NaN first', ['ArgMin', 'X'], { X: [NaN, 1] }, 0],
    ['ArgMax of a NaN last', ['ArgMax', 'X'], { X: [1, NaN] }, 0],
    ['ArgMax by a key that is NaN at the first element', ['ArgMax', 'L', root], { L: [-1, 4, 2, 3] }, 0],
    ['ArgMax by a key that is NaN at an inner element', ['ArgMax', 'L', root], { L: [1, -4, 2, 3] }, 0],
    ['ArgMin by a key that is NaN at the last element', ['ArgMin', 'L', root], { L: [1, 4, 2, -3] }, 0],
    ['MaxBy by a key that is NaN at an inner element', ['MaxBy', 'L', root], { L: [1, -4, 2, 3] }, NaN],
    ['MaxBy of no element', ['MaxBy', 'L', distance], { a: 1, L: [] }, NaN],
    ['MinBy of a NaN key among several', ['MinBy', 'X', negate], { X: [1, NaN] }, NaN],
    ['MinBy of points of no element', ['MinBy', 'P', coordinate(1)], { P: [] }, [NaN, NaN]],
  ] as [string, Json, Point, unknown][])('%s', (_name, json, point, value) => {
    // The interpreter leaves the form unevaluated.
    const head = (json as string[])[0];
    expect(interpreted(json, point).operator).toBe(head);
    expect(js(json).run!(point as never)).toEqual(value);
  });
});

describe('CE-1610: targets', () => {
  // prettier-ignore
  test.each([
    ['ArgMax', ['ArgMax', 'L4']],
    ['ArgMin by a key', ['ArgMin', 'L4', distance]],
    ['MaxBy', ['MaxBy', 'L4', distance]],
    ['MinBy of points', ['MinBy', 'P3', coordinate(2)]],
  ] as [string, Json][])('%s of a stated length compiles to GLSL', (_name, json) => {
    expect(js(json, { to: 'glsl' })).toMatchObject({ success: true });
  });

  // prettier-ignore
  test.each([
    ['ArgMax of a run-time length on GLSL', ['ArgMax', 'L'], 'glsl', 'the list L has a run-time length: it needs a stated length (an input declared list<real^n>) on glsl'],
    ['ArgMax on interval-js', ['ArgMax', 'L4'], 'interval-js', 'ArgMax on interval-js'],
    ['MinBy on interval-js', ['MinBy', 'L4', distance], 'interval-js', 'MinBy on interval-js'],
  ] as [string, Json, string, string][])('%s declines', (_name, json, to, message) => {
    expect(failure(() => js(json, { to }))).toContain(message);
  });
});

describe('CE-1610: keys', () => {
  test('a key that reads a name of `vars` compiles', () => {
    const engine = new ComputeEngine();
    engine.declare('L', 'list<real>');
    engine.declare('T', 'real');
    engine.assign('T', 2);
    const json = [
      'ArgMin',
      'L',
      ['Function', ['Abs', ['Subtract', 't', 'T']], 't'],
    ];
    const r = compile(engine.box(json as never), {
      ...IR,
      vars: { T: 'T' },
      hideValues: ['T'],
    });
    expect(r).toMatchObject({ success: true });
    expect(r.code).toContain('T');
  });

  test('MaxBy of points compiles in the complex mode', () => {
    const r = js(['MaxBy', 'P', coordinate(1)], { mode: 'complex' });
    // prettier-ignore
    expect(r.run!({ P: [[1, 2], [5, 0], [5, 7]] } as never)).toEqual([5, 0]);
    expect(r.run!({ P: [] } as never)).toEqual([NaN, NaN]);
  });

  test('a key that draws compiles: each key is computed once, in order', () => {
    const json = ['ArgMax', 'L', ['Function', ['Add', 't', ['Random']], 't']];
    // The keys are 10 + a draw below 1, 20 + a draw and 30 + a draw.
    expect(js(json).run!({ L: [10, 30, 20] } as never)).toBe(2);
  });
});

describe('CE-1610: declines', () => {
  // prettier-ignore
  test.each([
    ['ArgMax of strings', ['ArgMax', 'S'], 'ArgMax of a list of other than real numbers'],
    ['ArgMin of points with no key', ['ArgMin', 'P'], 'ArgMin of a list of other than real numbers'],
    ['a boolean key', ['ArgMax', 'L', ['Function', ['Greater', 't', 1], 't']], 'ArgMax by a key that is not a real number'],
    ['a complex key', ['MaxBy', 'L', ['Function', ['Add', 't', 'z'], 't']], 'MaxBy by a key that is not a real number'],
    // The NaN of `MaxBy` stands for an unevaluated form, which is not absent.
    ['IsMissing of MaxBy', ['IsMissing', ['MaxBy', 'L', negate]], 'IsMissing of MaxBy (the interpreter leaves it unevaluated where it has no value)'],
    ['Coalesce of MinBy', ['Coalesce', ['MinBy', 'L', negate], -1], 'Coalesce of MinBy (the interpreter leaves it unevaluated where it has no value)'],
    ['MaxBy of strings', ['MaxBy', 'S', ['Function', 1, 't']], 'MaxBy of a list of other than real numbers or points'],
  ] as [string, Json, string][])('%s', (_name, json, message) => {
    expect(failure(() => js(json))).toContain(`: ${message}`);
  });

  test('IsMissing of MaxBy of points', () => {
    const json = ['IsMissing', ['MaxBy', 'P', coordinate(1)]];
    expect(failure(() => js(json))).toContain(': IsMissing of MaxBy (');
  });

  test('the locations of the maximum of a function over a set', () => {
    // `ArgMax(f, domain)`, which the interpreter does not evaluate.
    const json = ['ArgMax', ['Function', ['Square', 't'], 't'], 'RealNumbers'];
    expect(failure(() => js(json))).toContain('a function value');
  });
});
