/**
 * Two compile regressions of 0.194.0 (README of
 * `src/compute-engine/compilation/ir/`, "Lists", the list operators):
 *
 * - CE-1465: `RotateLeft(S, N)` and `RotateRight(S, N)` of a count `N` of
 *   type `real` (a Desmos slider) compile with a run-time integer test,
 *   which throws where the interpreter gives `incompatible-type`.
 * - CE-1466: `Join` of lists compiles on JavaScript as `ListJoin`.
 *
 * The values are compared with the interpreter's: a rotation is a lazy
 * view there, read through `ListFrom`.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Value = number | boolean | Value[];
type Point = Record<string, Value>;

const ce = new ComputeEngine();
for (const name of ['S', 'L', 'M']) ce.declare(name, 'list<real>');
ce.declare('I', 'list<integer>');
ce.declare('B', 'list<boolean>');
ce.declare('P', 'list<tuple<real, real>>');
ce.declare('T', 'tuple<real, real>');
ce.declare('S3', 'list<real^3>');
ce.declare('s', 'string');
ce.declare('N', 'real');
ce.declare('n', 'integer');
ce.declare('x', 'real');

const IR = { fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options });

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
  if (e.symbol === 'True' || e.symbol === 'False') return e.symbol === 'True';
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  // A lazy collection (a rotation).
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  throw new Error(`no value: ${e.toString()}`);
}

const boxed = (v: Value): Expression =>
  Array.isArray(v)
    ? ce.function('List', v.map(boxed))
    : typeof v === 'boolean'
      ? ce.symbol(v ? 'True' : 'False')
      : ce.number(v);

function interpreted(json: Json, point: Point): Expression {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      k === 'P'
        ? ce.function(
            'List',
            (v as number[][]).map((p) => ce.function('Tuple', p.map((c) => ce.number(c))))
          )
        : k === 'T'
          ? ce.function('Tuple', (v as number[]).map((c) => ce.number(c)))
          : boxed(v),
    ])
  );
  return ce.withValues(values as never, () => box(json).evaluate().N());
}

function check(json: Json, points: Point[]) {
  const r = js(json);
  expect(r).toMatchObject({ success: true });
  for (const p of points) {
    const got = r.run!(p as never);
    const want = read(interpreted(json, p));
    expect([p, got]).toEqual([p, want]);
  }
  return r;
}

describe('CE-1465: a rotation of a real count', () => {
  const S = [1, 2, 3, 4];
  const counts = [2, -1, 0, 6, -5, 3];
  // prettier-ignore
  test.each([
    ['RotateLeft(S, N) (the witness)', ['RotateLeft', 'S', 'N']],
    ['RotateRight(S, N)', ['RotateRight', 'S', 'N']],
    ['the neighbour sum of the Game of Life', ['Add', ['RotateLeft', 'S', 'N'], ['RotateLeft', 'S', ['Negate', 'N']]]],
    ['At of a rotation', ['At', ['RotateLeft', 'S', 'N'], 1]],
  ])('%s', (_, json) => {
    check(json, [
      ...counts.map((N) => ({ S, N: 2 * N })),
      ...counts.map((N) => ({ S, N })),
      { S: [7], N: 3 },
      { S: [], N: 1 },
      // The largest safe counts: reduced modulo the length first, so the
      // index stays exact.
      { S, N: 9007199254740991 },
      { S, N: -9007199254740991 },
    ]);
  });

  test('a count computed from a real', () => {
    check(['RotateRight', 'S', ['Divide', 'N', 2]], [4, -2, 6].map((N) => ({ S, N })));
  });

  test('a list of a stated length', () => {
    check(['RotateLeft', 'S3', 'N'], [1, -2, 4].map((N) => ({ S3: [1, 2, 3], N })));
  });

  test('a count that is not an integer throws where the interpreter gives an error', () => {
    for (const h of ['RotateLeft', 'RotateRight']) {
      const json = [h, 'S', 'N'];
      const at = ['At', json, 1];
      const e = interpreted(at, { S, N: 2.4 });
      expect(e.operator).toBe('Error');
      expect(e.toString()).toContain('incompatible-type');
      const r = js(json);
      expect(() => r.run!({ S, N: 2.4 } as never)).toThrow(/incompatible-type/);
      expect(() => r.run!({ S, N: NaN } as never)).toThrow(/incompatible-type/);
      // Past the safe integers the interpreter leaves the rotation
      // unevaluated.
      expect(() => r.run!({ S, N: 1e20 } as never)).toThrow(/incompatible-type/);
    }
  });

  test('an integer count has no run-time test', () => {
    const r = check(['RotateLeft', 'S', 'n'], [{ S, n: 2 }, { S, n: -1 }]);
    expect(r.code).not.toContain('_count');
    expect(js(['RotateLeft', 'S', 'N']).code).toContain('_count');
  });

  test('a real count declines on GLSL and in the interval mode', () => {
    expect(failure(() => js(['RotateLeft', 'S3', 'N'], { to: 'glsl' }))).toMatch(
      /count\.int/
    );
    expect(failure(() => js(['RotateLeft', 'S', 'N'], { to: 'interval-js' }))).toMatch(
      /count\.int/
    );
  });

  // The interpreter rounds a real count of `Take` and `Drop` (`toInteger()`,
  // `Math.round`: 2.5 is 3, -2.5 is -2), CE-1531.
  test('a real count of Take and Drop is rounded', () => {
    for (const h of ['Take', 'Drop'])
      check(
        [h, 'S', 'N'],
        [2.4, 2.5, -2.5, -1.5, 0.4, 7.5, -9].map((N) => ({ S, N }))
      );
  });
});

describe('CE-1466: Join of lists', () => {
  // Lists of lengths 0, 1 and several.
  // prettier-ignore
  const POINTS: Point[] = [
    { L: [1, 2], M: [3], I: [4, 5], x: 0.5, n: 3 },
    { L: [], M: [3], I: [], x: -2, n: 0 },
    { L: [0.25, -1, 8], M: [], I: [7], x: 3, n: 1 },
  ];
  // prettier-ignore
  test.each([
    ['Join(L, M) (the witness)', ['Join', 'L', 'M']],
    ['three lists', ['Join', 'L', 'M', 'L']],
    ['one list', ['Join', 'L']],
    ['a list and a scalar', ['Join', 'L', 'x']],
    ['a scalar and a list', ['Join', 'x', 'L']],
    ['a list literal and a list', ['Join', ['List', 'x'], 'L']],
    ['reals and integers', ['Join', 'L', 'I']],
    ['a Range and a list', ['Join', ['Range', 1, 'n'], 'M']],
    ['Sum of a join', ['Sum', ['Join', 'L', 'M']]],
    ['an element-wise operation of a join', ['Multiply', 2, ['Join', 'M', 'L']]],
  ])('%s', (_, json) => {
    check(json, POINTS);
  });

  test('lists of booleans', () => {
    check(['Join', 'B', 'B'], [{ B: [true, false] }, { B: [] }]);
  });

  test('lists of points', () => {
    check(['Join', 'P', 'P'], [{ P: [[1, 2], [3, 4]] }, { P: [] }]);
  });

  // prettier-ignore
  test.each([
    ['a tuple (one element of the interpreter\'s list)', ['Join', 'L', 'T'], /Join of other than lists/],
    ['two tuples', ['Join', 'T', 'T'], /Join of other than lists/],
    ['strings (the interpreter concatenates them)', ['Join', 's', 's'], /Join of other than lists/],
    ['a set (the interpreter gives a set)', ['Join', 'L', ['Set', 1, 2]], /Join of other than lists/],
    ['numbers and booleans', ['Join', 'L', 'B'], /arms of two types/],
    ['numbers and points', ['Join', 'L', 'P'], /arms of two types/],
  ])('%s declines', (_, json, message) => {
    expect(failure(() => js(json))).toMatch(message);
  });

  test('GLSL declines (a build)', () => {
    expect(failure(() => js(['Join', 'S3', 'S3'], { to: 'glsl' }))).toMatch(
      /build/
    );
  });
});
