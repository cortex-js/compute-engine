/**
 * `At(L, i)` of a scalar index known at run time only (batch G30; README of
 * `src/compute-engine/compilation/ir/`, "Lists"). On JavaScript the profile
 * `ir` compiles the read of a list of booleans and of a list of real points:
 * in range it gives the interpreter's value; out of range it gives the
 * absent value of `docs/COMPILATION-MODEL.md`: of booleans `undefined`
 * (`atu`, where the interpreter gives `Missing`), of points a point of NaN
 * coordinates (`atp`, the interpreter's value). No operation on a boolean
 * fails on `undefined`, so the read is pure. A real index that is not an
 * integer is out of range, as in the interpreter (no floor). A list of
 * complex numbers and another list of lists decline (a read of an absent
 * row must not fail), as do GLSL, the interval mode and the bigint mode.
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
type Point = Record<string, unknown>;

const ce = new ComputeEngine();
for (const name of ['x', 'i']) ce.declare(name, 'real');
ce.declare('n', 'integer');
ce.declare('X', 'list<real>');
ce.declare('B', 'list<boolean>');
ce.declare('P', 'list<tuple<real, real>>');
ce.declare('M', 'matrix<real^(2x3)>');
// A user function that reads a list of points, its parameter.
ce.declare('px', {
  type: '(list<tuple<real, real>>, real) -> real',
  value: ce.box(['Function', ['PointX', ['At', 'q', 'k']], 'q', 'k'] as never),
});

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json) => compile(box(json), IR);

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

/** The interpreter's value: a tuple or a list is an array, a complex number
 *  `{ re, im }`, `Missing` is `undefined`. */
function read(e: Expression): unknown {
  if (isNumber(e))
    return e.im === 0 || Number.isNaN(e.re) ? e.re : { re: e.re, im: e.im };
  if (isSymbol(e, 'True')) return true;
  if (isSymbol(e, 'False')) return false;
  if (isSymbol(e, 'Missing')) return undefined;
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  // A lazy collection (a `Map`).
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  throw new Error(`no value: ${e.toString()}`);
}

function literal(v: unknown, tuple: boolean): Json {
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (!Array.isArray(v)) return v;
  return [tuple ? 'Tuple' : 'List', ...v.map((w) => literal(w, false))];
}

function interpreted(json: Json, point: Point): unknown {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      box(
        k === 'P'
          ? ['List', ...(v as unknown[]).map((q) => literal(q, true))]
          : literal(v, false)
      ),
    ])
  );
  return ce.withValues(values as never, () => read(box(json).evaluate().N()));
}

/** `v` and `w` have one shape and agree within 1e-12 (NaN is NaN). */
function agree(v: unknown, w: unknown): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, k) => agree(v[k], x))
    );
  if (typeof w === 'object' && w !== null) {
    const [a, b] = [v as { re: number; im: number }, w as typeof a];
    return agree(a?.re, b.re) && agree(a?.im, b.im);
  }
  if (typeof w === 'number' && Number.isNaN(w))
    return typeof v === 'number' && Number.isNaN(v);
  if (typeof w === 'boolean') return v === w;
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    Math.abs(v - w) <= 1e-12 * Math.max(1, Math.abs(w))
  );
}

const VALUES: Point = {
  x: 0.5,
  X: [1, -3, 2],
  B: [true, false, false, true],
  P: [
    [1, 2],
    [3, 4],
    [-5, 0.5],
  ],
  M: [
    [1, 2, 3],
    [4, 5, 6],
  ],
};

// A list of complex numbers and one of lists made by the program, which
// decline; a list of booleans made by a comparison.
const Z = ['Add', 'X', ['Multiply', 'ImaginaryUnit', ['Add', 'X', 1]]];
const LL = [
  'List',
  ['List', 'x', 2],
  ['List', 3, 4],
  ['List', 5, ['Negate', 'x']],
];
const KINDS: [string, Json, number][] = [
  ['an input of booleans', ['At', 'B', 'i'], 4],
  ['booleans of a comparison', ['At', ['Less', ['Abs', 'X'], 2], 'i'], 3],
  ['points', ['At', 'P', 'i'], 3],
];
const DECLINED: [string, Json][] = [
  ['complex numbers', ['At', Z, 'i']],
  ['a matrix input', ['At', 'M', 'i']],
  ['a literal list of lists', ['At', LL, 'i']],
  ['the length of a row', ['Length', ['At', 'M', 'i']]],
  ['a row of a row', ['At', ['At', 'M', 'i'], 2]],
  ['a tuple of booleans', ['At', ['Tuple', 'True', 'False'], 'i']],
];
const MESSAGE =
  /an index that can be out of range, of a list of booleans, of complex numbers or of lists/;

describe('At of a run-time index, in range, on JavaScript', () => {
  for (const [what, json, n] of KINDS)
    test(`${what}: the interpreter's value at the first, the last and from the end`, () => {
      const r = js(json);
      for (const i of [1, 2, n, -1, -n]) {
        const want = interpreted(json, { ...VALUES, i });
        expect(want).not.toBeUndefined();
        expect([i, r.run({ ...VALUES, i })]).toEqual([i, want]);
        expect(agree(r.run({ ...VALUES, i }), want)).toBe(true);
      }
    });
});

describe('At of a run-time index, out of range, on JavaScript', () => {
  // The interpreter gives `Missing` (booleans) or a point of NaN (points);
  // `atu` gives `undefined`, `atp` a point of NaN coordinates. A real index
  // that is not an integer is out of range in both.
  for (const [what, json, n] of KINDS)
    test(`${what}: undefined or a point of NaN, no hang`, () => {
      const r = js(json);
      for (const i of [0, n + 1, -n - 1, 1.5, 2 ** 53]) {
        const got = r.run({ ...VALUES, i });
        const want = interpreted(json, { ...VALUES, i });
        if (what === 'points') {
          expect(got).toEqual([NaN, NaN]);
          expect(want).toEqual([NaN, NaN]);
        } else {
          expect(got).toBeUndefined();
          expect(want).toBeUndefined();
        }
      }
    });

  test('the example of the README: a comparison of a list of three, at 5', () => {
    const json = ['At', ['Greater', 'X', 0], 5];
    expect(js(json).run(VALUES)).toBeUndefined();
    expect(interpreted(json, VALUES)).toBeUndefined();
  });

  test('an operation on a boolean read out of range: no throw', () => {
    // `undefined` under `!`, `&&`, `||`, `if`, a ternary, `Which`, a list,
    // a tuple and as the value of the program.
    for (const json of [
      ['Not', ['At', 'B', 'i']],
      ['And', ['At', 'B', 'i'], ['Greater', 'x', 0]],
      ['Or', ['At', 'B', 'i'], ['Less', 'x', 0]],
      ['If', ['At', 'B', 'i'], 1, 2],
      ['Which', ['At', 'B', 'i'], 1, 'True', 2],
      ['List', ['At', 'B', 'i'], ['At', 'B', 1]],
      ['Tuple', ['At', 'B', 'i'], ['Greater', 'x', 0]],
      ['Not', ['At', ['Greater', 'X', 0], 'i']],
    ]) {
      const r = js(json);
      expect(
        agree(
          r.run({ ...VALUES, i: 1 }),
          interpreted(json, { ...VALUES, i: 1 })
        )
      ).toBe(true);
      // Out of range: unspecified, but no throw.
      for (const i of [0, 9, 1.5])
        expect(() => r.run({ ...VALUES, i })).not.toThrow();
    }
  });

  test('two equal reads are one, and a read invariant in a loop', () => {
    const r = js([
      'Add',
      ['If', ['At', 'B', 'i'], 1, 0],
      ['If', ['At', 'B', 'i'], 2, 0],
    ]);
    expect(String(r.code).match(/_atu\(/g)).toHaveLength(1);
    const json = [
      'Sum',
      ['If', ['At', 'B', 'i'], 'k', 0],
      ['Limits', 'k', 1, 3],
    ];
    for (const i of [1, 2, 9])
      expect(js(json).run({ ...VALUES, i })).toBe(i === 1 ? 6 : 0);
  });
});

describe('a guarded read keeps its guard', () => {
  // The read and what is computed from it are evaluated only in the arm
  // that the condition selects.
  const cases: Json[] = [
    [
      'If',
      ['LessEqual', 'i', ['Length', 'P']],
      ['PointX', ['At', 'P', 'i']],
      0,
    ],
    ['If', ['LessEqual', 'i', 4], ['If', ['At', 'B', 'i'], 1, 2], 0],
  ];
  for (const json of cases)
    test(JSON.stringify(json), () => {
      const r = js(json);
      for (const i of [1, 2, 3, 5, 9]) {
        const want = interpreted(json, { ...VALUES, i });
        if (typeof want === 'number' && Number.isFinite(want))
          expect([i, r.run({ ...VALUES, i })]).toEqual([i, want]);
      }
      expect(r.run({ ...VALUES, i: 9 })).toBe((json as Json[])[3] as number);
    });
});

describe('a read in a loop body and in a user function', () => {
  test('Sum of a read of booleans, of points', () => {
    for (const json of [
      [
        'Sum',
        ['If', ['At', ['Greater', 'X', 0], 'k'], 1, 0],
        ['Limits', 'k', 1, ['Length', 'X']],
      ],
      ['Sum', ['PointY', ['At', 'P', 'k']], ['Limits', 'k', 1, 3]],
    ]) {
      const want = interpreted(json, VALUES);
      expect(want).toEqual(expect.any(Number));
      expect(agree(js(json).run(VALUES), want)).toBe(true);
    }
  });

  test('a Sum past the end: no hang', () => {
    const json = [
      'Sum',
      ['PointY', ['At', 'P', 'k']],
      ['Limits', 'k', 1, ['Add', ['Length', 'P'], 2]],
    ];
    expect(js(json).run(VALUES)).toBeNaN();
  });

  test('a user function that reads its list parameter', () => {
    for (const json of [['px', 'P', 'i']]) {
      const r = js(json);
      for (const i of [1, 2, 3, -1]) {
        const want = interpreted(json, { ...VALUES, i });
        expect([i, r.run({ ...VALUES, i })]).toEqual([i, want]);
      }
      expect(r.run({ ...VALUES, i: 4 })).toBeNaN();
    }
  });
});

describe('the other kinds and the other targets decline', () => {
  for (const [what, json] of DECLINED)
    test(`JavaScript: ${what}`, () => {
      expect(failure(() => js(json))).toMatch(MESSAGE);
    });
  const message = MESSAGE;
  for (const [what, json] of [...KINDS, ...DECLINED.slice(0, 3)]) {
    test(`GLSL: ${what}`, () => {
      expect(failure(() => compile(box(json), { ...IR, to: 'glsl' }))).toMatch(
        what === 'an input of booleans' ? /./ : message
      );
    });
    test(`the interval mode: ${what}`, () => {
      expect(
        failure(() => compile(box(json), { ...IR, to: 'interval-js' }))
      ).toMatch(what === 'an input of booleans' ? /./ : message);
    });
  }
  test('the bigint mode', () => {
    expect(
      failure(() => compile(box(['At', 'B', 'n']), { ...IR, mode: 'bigint' }))
    ).toMatch(message);
  });
});
