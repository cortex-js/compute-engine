/**
 * Arithmetic on points in the profile `ir` (batch G11, README of
 * `src/compute-engine/compilation/ir/`, "Tuples"): the linear operations
 * of points, `Abs` of a point (its Euclidean norm), `Distance`, `PointX`,
 * `PointY` and `PointZ` of a point-valued expression or of a list of
 * points, a point added to each point of a list, a user function of no
 * stated result whose body is a point, and `PointList` of lists of
 * run-time lengths (as long as the shortest).
 *
 * The witnesses are rows of Tycho's run over every Desmos document; the
 * functions they call are defined in the documents, so the definitions here
 * are stand-ins of the same shape. JavaScript agrees with the interpreter
 * within 1e-12; each GLSL shader runs in WebGL2 (the headless Chromium of
 * `scripts/glsl-check/glsl-driver.ts`) and agrees with the profile's
 * JavaScript value within single-float precision. Without the browser, the
 * WebGL test is skipped.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Point = Record<string, number | number[]>;

const ce = new ComputeEngine();
for (const name of ['x', 'y', 'u', 'v', 'T']) ce.declare(name, 'real');
ce.declare('P', 'tuple<real, real>');
ce.declare('Q', 'tuple<real, real>');
ce.declare('P3', 'tuple<real, real, real>');
ce.declare('Q3', 'tuple<real, real, real>');
ce.declare('L2', 'list<real^2>');
ce.declare('A1', 'list<real>');
ce.declare('A2', 'list<real>');
ce.declare('A3', 'list<real>');
const TUPLES = new Set(['P', 'Q', 'P3', 'Q3']);

// `c_t` of art/2ki2hjsouf: no stated result, a body that is a point.
ce.declare('ct', 'function');
ce.assign(
  'ct',
  ce.box([
    'Function',
    [
      'Block',
      [
        'PointList',
        ['Sin', ['Multiply', 360, 'z']],
        ['Cos', ['Multiply', 360, 'z']],
      ],
    ],
    'z',
  ] as never)
);
// `X` of neyret/mqm2eamst1: a result `tuple<unknown, unknown>`.
ce.declare('X', '(real, real) -> tuple<unknown, unknown>');
ce.assign(
  'X',
  ce.box(['Function', ['Block', ['PointList', 'x', 'y']], 'x', 'y'] as never)
);
// The complex product and modulus of points, of no stated result.
ce.declare(
  'cmul',
  '(tuple<real, real>, tuple<real, real>) -> tuple<unknown, unknown>'
);
ce.assign(
  'cmul',
  ce.box([
    'Function',
    [
      'Tuple',
      [
        'Subtract',
        ['Multiply', ['PointX', 'a'], ['PointX', 'b']],
        ['Multiply', ['PointY', 'a'], ['PointY', 'b']],
      ],
      [
        'Add',
        ['Multiply', ['PointX', 'a'], ['PointY', 'b']],
        ['Multiply', ['PointY', 'a'], ['PointX', 'b']],
      ],
    ],
    'a',
    'b',
  ] as never)
);
ce.declare('cmod', '(tuple<real, real>) -> unknown');
ce.assign('cmod', ce.box(['Function', ['Abs', 'a'], 'a'] as never));
// `f` of neyret/emxg30gtiq, with a stand-in `H`.
ce.declare('H', '(real) -> real');
ce.assign(
  'H',
  ce.box(['Function', ['Sin', ['Multiply', 3, 's']], 's'] as never)
);
ce.declare('fe', '(tuple<real, real>) -> real');
ce.assign(
  'fe',
  ce.box([
    'Function',
    [
      'Abs',
      [
        'Add',
        'c',
        ['Multiply', -2, ['PointList', ['H', 0.2], ['H', 0.4]]],
        ['Negate', ['PointList', 4, 0]],
      ],
    ],
    'c',
  ] as never)
);
// `h_ash` of art/njncrg9fkv.
ce.declare('hsh', '(tuple<real, real, real>) -> real');
ce.assign(
  'hsh',
  ce.box([
    'Function',
    [
      'Sin',
      [
        'Add',
        ['Multiply', 12.9898, ['PointX', 'q']],
        ['Multiply', 78.233, ['PointY', 'q']],
        ['PointZ', 'q'],
      ],
    ],
    'q',
  ] as never)
);
// Of no stated result, with a body that is not a point.
ce.declare('lst', 'function');
ce.assign('lst', ce.box(['Function', ['List', 'z', 1], 'z'] as never));
// Functions assigned with no declaration whose inferred result is a tuple
// with an element of no stated type (`tuple<number, unknown>`, …).
// prettier-ignore
const INFERRED: Json[] = [
  ['PointList', ['Multiply', 2, 'a'], 'b'],
  ['Tuple', ['Negate', 'a'], 'b'],
  ['PointList', 'a', 1],
  ['PointList', 'a', 0.5],
  ['PointList', 'a', 'b', 0],
  ['Tuple', 'a', ['Add', 'b', 1]],
];
INFERRED.forEach((body, k) =>
  ce.assign(`g${k}`, ce.box(['Function', body, 'a', 'b'] as never))
);
// Tycho's `X`, `C_mul` and `C_mod` (neyret/mqm2eamst1), assigned with no
// declaration: the parameters have no declared type (`C_mod` infers
// `collection<any> | tuple`), and the results are unions.
ce.assign(
  'Xu',
  ce.box(['Function', ['Block', ['PointList', 'x', 'y']], 'x', 'y'] as never)
);
// prettier-ignore
ce.assign('Cmul', ce.box(['Function', ['PointList',
  ['Subtract', ['Multiply', ['PointX', 'p'], ['PointX', 'q']], ['Multiply', ['PointY', 'p'], ['PointY', 'q']]],
  ['Add', ['Multiply', ['PointX', 'p'], ['PointY', 'q']], ['Multiply', ['PointY', 'p'], ['PointX', 'q']]]], 'p', 'q'] as never));
// prettier-ignore
ce.assign('Cmod', ce.box(['Function', ['Sqrt', ['Add', ['Power', ['PointX', 'p'], 2], ['Power', ['PointY', 'p'], 2]]], 'p'] as never));
// A recursive function of a result `tuple<unknown, unknown>`.
ce.declare('Xr', '(real, real) -> tuple<unknown, unknown>');
// prettier-ignore
ce.assign('Xr', ce.box(['Function', ['If', ['Less', 'x', 0], ['PointList', 'x', 'y'], ['Xr', ['Subtract', 'x', 1], 'y']], 'x', 'y'] as never));
// A point held by a name, in the two spellings.
ce.assign('A', ce.box(['PointList', 0.7, -0.4] as never));
ce.assign('Ab', ce.box(['Tuple', 0.7, -0.4] as never));
// Functions of untyped parameters that pass a point on, or compute one: the
// shape of a parameter is the lowered argument of the first call, whatever
// the order of the calls.
const untyped = (name: string, body: Json, ...params: string[]) =>
  ce.assign(name, ce.box(['Function', body, ...params] as never));
untyped('nrm', ['Abs', 'p'], 'p');
untyped('aaa', ['nrm', 'p'], 'p');
untyped('zzz', ['nrm', 'p'], 'p');
// prettier-ignore
untyped('len', ['Sqrt', ['Add', ['Power', ['PointX', 'p'], 2], ['Power', ['PointY', 'p'], 2]]], 'p');
untyped('dst', ['len', ['Subtract', 'p', 'q']], 'p', 'q');
// prettier-ignore
untyped('lrp', ['Add', ['Multiply', ['Subtract', 1, 't'], 'a'], ['Multiply', 't', 'b']], 'a', 'b', 't');
untyped('mid', ['Divide', ['Add', 'p', 'q'], 2], 'p', 'q');
// Results inferred `broadcastable<unknown>` for `Negate(PointY(p))`.
untyped(
  'conj',
  ['PointList', ['PointX', 'p'], ['Negate', ['PointY', 'p']]],
  'p'
);
untyped('rot', ['Tuple', ['Negate', ['PointY', 'p']], ['PointX', 'p']], 'p');
untyped('neg1', ['Negate', ['PointX', 'p']], 'p');
// A mutual recursion of an untyped point parameter (declared results).
ce.declare('ev', '(unknown, integer) -> real');
ce.declare('od', '(unknown, integer) -> real');
// prettier-ignore
untyped('ev', ['If', ['LessEqual', 'n', 0], ['PointX', 'p'], ['od', 'p', ['Subtract', 'n', 1]]], 'p', 'n');
// prettier-ignore
untyped('od', ['If', ['LessEqual', 'n', 0], ['PointY', 'p'], ['ev', 'p', ['Subtract', 'n', 1]]], 'p', 'n');

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options });
const glsl = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, to: 'glsl', ...options });

/** The diagnostic of a compilation that throws, or `undefined`. */
function failure(
  f: () => unknown
): { code: string; message: string } | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { code: string; message: string } }).diagnostic;
  }
  return undefined;
}

/** The interpreter's value: a tuple or a list is an array. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  // A lazy collection (a `Comprehension`).
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  throw new Error(`no value: ${e.toString()}`);
}

function interpreted(json: Json, point: Point): unknown {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? ce.function(
            TUPLES.has(k) ? 'Tuple' : 'List',
            v.map((n) => ce.number(n))
          )
        : ce.number(v),
    ])
  );
  return ce.withValues(values as never, () => read(box(json).evaluate().N()));
}

/** `v` and `w` have one shape and agree within `tolerance`. */
function agree(v: unknown, w: unknown, tolerance = 1e-12): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x, tolerance))
    );
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    (Math.abs(v - w) <= tolerance * Math.max(1, Math.abs(w)) ||
      (Number.isNaN(v) && Number.isNaN(w)))
  );
}

function check(json: Json, points: Point[], options: object = {}) {
  const r = js(json, options);
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

// prettier-ignore
const POINTS: Point[] = [
  { x: 0.5, y: -1.25, u: 0.3, v: -1.2, T: 0.25, P: [1.5, -2], Q: [0.25, 3], P3: [1, 2, 2], Q3: [-0.5, 0.75, 4], L2: [0.5, 7] },
  { x: -2, y: 0.125, u: 1.7, v: 0.4, T: 0.8, P: [-3, 0.5], Q: [2, 2], P3: [0, -1, 0.5], Q3: [3, 1, -2], L2: [-1, 2.5] },
  { x: 3.5, y: 2, u: -0.6, v: 2.2, T: -1.5, P: [0, 0], Q: [-4, 1.5], P3: [2, 2, 2], Q3: [1, 1, 1], L2: [0, 0] },
];

// Programs of a scalar value, on both targets.
// prettier-ignore
const SCALARS: [label: string, json: Json][] = [
  ['Abs of a point of inputs (the witness)', ['Abs', ['PointList', 'u', 'v']]],
  ['Abs of a tuple input', ['Abs', 'P']],
  ['Abs of a point of 3', ['Abs', 'P3']],
  ['Abs of a point of 5 (an array on GLSL)', ['Abs', ['Tuple', 'u', 'v', 'x', 1, 2]]],
  ['Abs of a sum of points', ['Abs', ['Add', 'P', ['Multiply', 'u', 'Q']]]],
  ['Distance of two points', ['Distance', 'P', 'Q']],
  ['Distance of two points of 3', ['Distance', 'P3', 'Q3']],
  ['Distance of a call of X and a constant point (the witness)', ['Add', ['Distance', ['X', 'x', 'y'], 'P'], ['Negate', ['Min', ['Distance', 'P', ['Tuple', 1.0000796326710732, 1.0999999682931834]], ['Distance', ['X', 'x', 'y'], ['Tuple', 1.0000796326710732, 1.0999999682931834]]]]]],
  ['PointX of a call of ct (the witness)', ['Add', ['Multiply', 'v', ['PointX', ['ct', 'u']]], ['PointY', ['ct', 'u']]]],
  ['PointY of a linear combination', ['PointY', ['Add', ['Multiply', 2, ['ct', 'u']], 'P']]],
  ['PointZ of a sum', ['PointZ', ['Add', 'P3', ['Negate', 'Q3']]]],
  ['PointX of a point divided by a scalar', ['PointX', ['Divide', 'P', 'u']]],
  ['PointX of a sum with a negated literal point', ['PointX', ['Add', 'P', ['Negate', ['PointList', 0, 0]]]]],
  ['PointY of a sum of points times scalars', ['PointY', ['Add', ['Multiply', 'P', ['Power', ['Add', ['Negate', 'T'], 1], 2]], ['Multiply', 'Q', ['Power', 'T', 2]], ['Multiply', 2, 'T', ['Add', ['Negate', 'T'], 1], ['Tuple', 'x', 'y']]]]],
  ['a complex product and modulus of points (the witness)', ['Add', ['cmod', ['cmul', 'P', ['X', 'x', 'y']]], -1]],
  ["Abs in a function of a point (the witness)", ['fe', ['PointList', 'x', 'y']]],
  ['a point and a list of the same length', ['Add', ['PointX', 'P'], ['At', 'L2', 2], ['Abs', 'P'], ['Sum', 'L2']]],
  ...INFERRED.map((_, k): [string, Json] => [`an inferred result ${JSON.stringify(INFERRED[k])}`, ['Add', ['PointX', [`g${k}`, 'u', 'v']], ['PointY', [`g${k}`, 'u', 'v']]]]),
  ['untyped parameters: C_mod(C_mul(A, X(x, y))) - 1 (the witness), A a PointList', ['Add', ['Cmod', ['Cmul', 'A', ['Xu', 'x', 'y']]], -1]],
  ['untyped parameters: C_mod(C_mul(A, X(x, y))) - 1 (the witness), A a Tuple', ['Add', ['Cmod', ['Cmul', 'Ab', ['Xu', 'x', 'y']]], -1]],
  ['a point passed on: nrm, then aaa', ['Add', ['nrm', 'P'], ['aaa', 'P']]],
  ['a point passed on: aaa, then nrm', ['Add', ['aaa', 'P'], ['nrm', 'P']]],
  ['a point passed on: nrm, then zzz', ['Add', ['nrm', 'P'], ['zzz', 'P']]],
  ['a point passed on: zzz, then nrm', ['Add', ['zzz', 'P'], ['nrm', 'P']]],
  ['a point passed on: aaa alone', ['aaa', 'P']],
  ['a computed point: dst alone', ['dst', 'P', 'Q']],
  ['a computed point: len, then dst', ['Add', ['len', 'P'], ['dst', 'P', 'Q']]],
  ['a computed point: dst, then len', ['Add', ['dst', 'P', 'Q'], ['len', 'P']]],
  ['nested lrp', ['nrm', ['lrp', ['lrp', 'P', 'Q', 'x'], ['lrp', 'Q', 'P', 'x'], 'x']]],
  ['nrm of mid', ['nrm', ['mid', 'P', 'Q']]],
  ['a result broadcastable<unknown>: conj', ['PointY', ['conj', 'P']]],
  ['a result broadcastable<unknown>: rot', ['PointX', ['rot', 'P']]],
  ['a result broadcastable<unknown>: neg1', ['neg1', 'P']],
  ['untyped parameters: a nested first call', ['Cmod', ['Cmul', 'P', ['Cmul', 'P', 'Q']]]],
];

// Programs of a point value, on JavaScript (their coordinates are
// `SCALARS` on GLSL).
// prettier-ignore
const VALUES: [label: string, json: Json][] = [
  ['a difference of points', ['Subtract', 'P', 'Q']],
  ['a negated point', ['Negate', 'P3']],
  ['a point divided by a scalar', ['Divide', 'P', 'u']],
  ['a sum of points times scalars', ['Add', ['Multiply', 'P', ['Power', ['Add', ['Negate', 'T'], 1], 2]], ['Multiply', 'Q', ['Power', 'T', 2]], ['Multiply', 2, 'T', ['Add', ['Negate', 'T'], 1], ['Tuple', 'x', 'y']]]],
  ['a call of ct', ['ct', 'u']],
  ['a call of X plus a point', ['Add', ['X', 'x', 'y'], 'P']],
  // The witness of neyret/3axesa5w68: a point added to each of a list of points.
  ['a point plus a list of points', ['Add', ['Multiply', 'P', ['Power', ['Add', ['Negate', 'T'], 1], 2]], ['Multiply', 'Q', ['Power', 'T', 2]], ['Multiply', ['Rational', 1, 3], ['List', ['PointList', 0, 0], ['Tuple', 'x', 'y']]]]],
  ['a point minus a list of points', ['Subtract', 'P', ['List', ['Tuple', 1, 2], ['Tuple', 'u', 'v']]]],
  ['Abs of a list of points', ['Abs', ['List', ['Tuple', 3, 4], ['Tuple', 'u', 'v']]]],
  ['Abs of a list of numbers, element by element', ['Abs', 'L2']],
  ['Distance of a point and a list of points', ['Distance', 'P', ['List', ['Tuple', 1, 2], ['Tuple', 'u', 'v']]]],
  ['Distance of two lists of points, pair by pair', ['Distance', ['List', ['Tuple', 1, 2], ['Tuple', 'u', 'v']], ['List', ['Tuple', 'x', 'y'], ['Tuple', 0, 'T']]]],
  ['an untyped function of points', ['Cmul', 'P', 'Q']],
  // The witness of art/njncrg9fkv.
  ['Abs in a condition, a local point', ['Block', ['Declare', 'p', "'unknown'", ['PointList', 'u', 'v', 0.01]], ['If', ['Less', ['Abs', ['PointList', 'u', 'v']], ['Multiply', 1.5, ['hsh', ['PointList', ['PointX', 'p'], ['PointY', 'p'], 0]]]], 'p']]],
];

// Lists of run-time lengths, on JavaScript.
// prettier-ignore
const LISTS: [label: string, json: Json][] = [
  ['PointList of three lists (the witness)', ['PointList', 'A1', 'A2', 'A3']],
  ['a Comprehension over it (the witness)', ['Comprehension', ['PointList', ['Add', ['Multiply', 'x', ['Cos', ['Add', ['Negate', 'T'], ['PointX', 'p']]]], ['PointX', 'p']], ['PointY', 'p'], ['PointZ', 'p']], ['Element', 'p', ['PointList', 'A1', 'A2', 'A3']]]],
  ['PointList of a list and a list of a stated length', ['PointList', 'A1', ['List', 1, 2]]],
  ['PointX of a list of points (the witness)', ['Add', ['Multiply', 'v', ['PointX', ['PointList', ['Sin', 'A1'], ['Cos', 'A1']]]], ['PointY', ['PointList', ['Sin', 'A1'], 'A1']]]],
];
// prettier-ignore
const LIST_POINTS: Point[] = [
  { x: 0.5, v: 2, T: 0.3, A1: [1, 2, 3], A2: [4, 5], A3: [7, 8, 9, 10] },
  { x: -1, v: -0.5, T: 1.1, A1: [0.5, -2, 3, 4], A2: [4, 5, 6, 7.5], A3: [1, 2, 3, 4, 5] },
  { x: 2, v: 1, T: 0, A1: [], A2: [1], A3: [2] },
];

describe('IR profile, batch G11: arithmetic on points', () => {
  test('the interpreter: the operations on points are component-wise, Abs is the norm', () => {
    const p = { P: [1.5, -2], Q: [0.25, 3], u: 2 };
    expect(interpreted(['Add', 'P', 'Q'], p)).toEqual([1.75, 1]);
    expect(interpreted(['Divide', 'P', 'u'], p)).toEqual([0.75, -1]);
    expect(interpreted(['Abs', 'P'], p)).toBe(2.5);
    expect(interpreted(['Distance', 'P', ['Tuple', 0, 0]], p)).toBe(2.5);
    expect(
      interpreted(['Add', 'P', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]], p)
    ).toEqual([
      [2.5, 0],
      [4.5, 2],
    ]);
    expect(
      interpreted(['PointList', ['List', 1, 2, 3], ['List', 4, 5]], {})
    ).toEqual([
      [1, 4],
      [2, 5],
    ]);
  });

  test.each(SCALARS)('%s: JavaScript against the interpreter', (_, json) => {
    check(json, POINTS);
  });

  test.each(VALUES)('%s: JavaScript against the interpreter', (_, json) => {
    check(json, POINTS);
  });

  test.each(LISTS)('%s: JavaScript against the interpreter', (_, json) => {
    check(json, LIST_POINTS);
  });

  test.each(SCALARS)('%s: GLSL compiles', (_, json) => {
    expect(glsl(json)).toMatchObject({ success: true, profile: 'ir' });
  });

  test('Abs of a point is the square root of the sum of squares, on both targets', () => {
    expect(js(['Abs', ['PointList', 'u', 'v']]).code).toMatch(
      /Math\.sqrt\(\(\(_\.u \* _\.u\) \+ \(_\.v \* _\.v\)\)\)/
    );
    expect(glsl(['Abs', ['PointList', 'u', 'v']]).code).toBe(
      'sqrt(((u * u) + (v * v)))'
    );
  });

  test('a function of no stated result whose body is a point returns a vec2 on GLSL', () => {
    expect(glsl(['PointX', ['ct', 'u']]).preamble).toMatch(
      /^vec2 _fn_ir_u\d+_ct\(float v\d+\) \{$/m
    );
    expect(glsl(['PointX', ['X', 'x', 'y']]).preamble).toMatch(
      /^vec2 _fn_ir_u\d+_X\(float v\d+, float v\d+\) \{$/m
    );
  });

  test('a function of no stated result whose body is a list takes its shape', () => {
    check(['At', ['lst', 'u'], 1], POINTS);
    expect(glsl(['At', ['lst', 'u'], 1]).success).toBe(true);
  });

  test('a mutual recursion of an untyped point parameter on JavaScript', () => {
    check(['ev', 'P', 5], POINTS);
    check(['Add', ['od', 'P', 2], ['ev', 'Q', 3]], POINTS);
  });

  test('untyped parameters: one definition for a nested first call', () => {
    const json = ['Cmod', ['Cmul', 'P', ['Cmul', 'P', 'Q']]];
    // JavaScript copies a function that its caller calls twice (the pass
    // `inline`): no definition is left. GLSL keeps the calls.
    check(json, POINTS);
    expect(js(json).preamble ?? '').not.toMatch(/u\d+_Cmul/);
    expect(
      glsl(json).preamble!.match(
        /^vec2 _fn_ir_u\d+_Cmul\(vec2 v\d+, vec2 v\d+\) \{$/gm
      )
    ).toHaveLength(1);
  });

  // prettier-ignore
  test.each([
    ['a product of points', ['Multiply', 'P', 'Q'], ['javascript', 'glsl'], /an error of the canonical form/],
    ['a quotient of points', ['Divide', 'P', 'Q'], ['javascript', 'glsl'], /an error of the canonical form/],
    ['a point plus a scalar', ['Add', 'P', 'u'], ['javascript', 'glsl'], /an error of the canonical form/],
    ['a point plus a list of numbers', ['Add', 'P', 'L2'], ['javascript', 'glsl'], /an error of the canonical form/],
    ['a sum of points of two lengths', ['Add', 'P', 'P3'], ['javascript', 'glsl'], /lists of different lengths/],
    ['Distance of points of two lengths', ['Distance', 'P', 'P3'], ['javascript', 'glsl'], /lists of different lengths/],
    ['Distance of a point and a list of numbers', ['Distance', 'P', 'L2'], ['javascript', 'glsl'], /Distance of a value that is not a point/],
    ['Distance of lists of points of two lengths', ['Distance', ['List', ['Tuple', 1, 2]], ['List', ['Tuple', 1, 2], ['Tuple', 'u', 'v']]], ['javascript'], /lists of different lengths/],
    ['an untyped parameter: a point, then a scalar', ['Add', ['Cmod', 'P'], ['Cmod', 'x']], ['javascript', 'glsl'], /x: an argument of Cmod of another shape than at its first call: the parameter p is a point of 2 numbers \(real here\)/],
    ['an untyped parameter: points of two lengths', ['Add', ['Cmod', 'P'], ['Cmod', 'P3']], ['javascript', 'glsl'], /an argument of Cmod of another shape than at its first call: the parameter p is a point of 2 numbers \(tuple<real, real, real> here\)/],
    ['an untyped parameter that is not a scalar, a scalar first', ['Cmod', 'x'], ['javascript', 'glsl'], /the parameter p of Cmod is not a scalar \(collection<any> \| tuple\)/],
    ['nrm of an empty tuple', ['nrm', ['Tuple']], ['javascript', 'glsl'], /Tuple\(\): an empty list/],
    ['a mutual recursion on GLSL', ['ev', 'P', 5], ['glsl'], /a recursive function/],
    ['a recursive call, a result tuple<unknown, unknown>', ['PointX', ['Xr', 'x', 'y']], ['javascript'], /a recursive call of Xr, a function with a list or tuple result/],
    ['a point plus a list of points on GLSL', ['Add', 'P', ['List', ['Tuple', 1, 2], ['Tuple', 'u', 'v']]], ['glsl'], /a list of rank 2/],
    ['PointList of lists on GLSL', ['PointList', 'L2', 'L2'], ['glsl'], /a list of rank 2/],
    // `PointX` of a `PointList` of a stated length compiles on GLSL
    // (CE-1474, `ir-glsl-point-lists.test.ts`).
    ['a list of points of two lengths', ['Add', ['List', ['Tuple', 1, 2]], ['List', ['Tuple', 1, 2], ['Tuple', 'u', 'v']], 'P'], ['javascript'], /lists of different lengths|another shape/],
  ])('%s declines, with the cause', (_, json, targets, cause) => {
    for (const to of targets) {
      const d = failure(() => compile(box(json), { ...IR, to } as never));
      expect(d?.code).toBe('outside-profile');
      expect(d?.message).toMatch(cause);
    }
  });
});

//
// Robustness
//

describe('IR profile, batch G11: robustness with point operations', () => {
  const P = ce.box('P');
  const point = ce.function('Tuple', [ce.box('x'), ce.box('u')]);

  test('a shared graph of 2^20 paths', () => {
    let e: Expression = point;
    for (let i = 0; i < 20; i++)
      e = ce.function('Add', [
        e,
        ce.function('Multiply', [
          ce.function('Sin', [ce.function('Distance', [e, P])]),
          e,
        ]),
      ]);
    const root = ce.function('Abs', [e]);
    for (const to of ['javascript', 'glsl'] as const) {
      const start = performance.now();
      const r = compile(root, { ...IR, to });
      expect(r.code.length + (r.preamble ?? '').length).toBeLessThan(40_000);
      // A guard against a walk by paths (a hang), not a measure.
      expect(performance.now() - start).toBeLessThan(30_000);
    }
    // The value, by the same recurrence in doubles.
    let [a, c] = [0.5, 0.3];
    for (let i = 0; i < 20; i++) {
      const s = Math.sin(Math.hypot(a - 1, c + 2));
      [a, c] = [a + s * a, c + s * c];
    }
    const value = compile(root, IR).run!({
      x: 0.5,
      u: 0.3,
      P: [1, -2],
    } as never);
    expect(value).toBeCloseTo(Math.hypot(a, c), 9);
    expect(value).toBeCloseTo(2.041873528264133, 9);
  });

  test('a chain of 1,000 points', () => {
    const sum = ce.function(
      'Add',
      Array.from({ length: 1_000 }, (_, i) =>
        ce.function('Multiply', [
          ce.function('Sin', [ce.function('Add', [ce.box('x'), ce.number(i)])]),
          P,
        ])
      )
    );
    const root = ce.function('Distance', [sum, P]);
    for (const to of ['javascript', 'glsl'] as const) {
      // A hang guard, not a measure.
      const start = performance.now();
      const r = compile(root, { ...IR, to });
      expect(r.code.length).toBeLessThan(200_000);
      expect(performance.now() - start).toBeLessThan(30_000);
    }
    const s = Array.from({ length: 1_000 }, (_, i) => Math.sin(0.5 + i)).reduce(
      (a, b) => a + b
    );
    expect(compile(root, IR).run!({ x: 0.5, P: [3, -4] } as never)).toBeCloseTo(
      Math.abs(s - 1) * 5,
      9
    );
  });

  test('a nested loop', () => {
    const loop = (n: number) => [
      'Block',
      ['Declare', 'k', { str: 'real' }, 0],
      [
        'Loop',
        [
          'Assign',
          'k',
          [
            'Add',
            'k',
            ['Distance', ['Tuple', ['Multiply', 'i', 'x'], 'j'], 'P'],
          ],
        ],
        ['Element', 'i', ['Range', 1, n]],
        ['Element', 'j', ['Range', 1, n]],
      ],
      'k',
    ];
    const p = { x: 0.3, P: [1, -2] };
    expect(js(loop(10)).run!(p as never)).toBeCloseTo(
      interpreted(loop(10), p) as number,
      9
    );
    expect(glsl(loop(10)).success).toBe(true);
    const d = failure(() => glsl(loop(200)));
    expect(d?.code).toBe('outside-profile');
    expect(d?.message).toMatch(/iterationBudget/);
  });
});

//
// WebGL2
//

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** A fragment shader that writes the value of `r`: a `float` uniform per
 *  scalar input, a `float[n]` uniform per point (passed as a `vecN`: the
 *  driver sets `float` uniforms only). */
function shader(r: ReturnType<typeof glsl>): string {
  const inputs = r.freeSymbols!;
  const type = (n: string) => r.freeSymbolTypes![n].lowered;
  const vec = (n: string) => Number(/^vec(\d)$/.exec(type(n))?.[1] ?? 0);
  const array = (n: string) => /^(\w+)\[(\d+)\]$/.exec(type(n));
  const uniform = (n: string) => {
    const m = array(n);
    if (m) return `uniform ${m[1]} u_${n}[${m[2]}];`;
    return vec(n) > 0
      ? `uniform float u_${n}[${vec(n)}];`
      : `uniform ${type(n)} u_${n};`;
  };
  const arg = (n: string) =>
    vec(n) > 0
      ? `${type(n)}(${Array.from({ length: vec(n) }, (_, i) => `u_${n}[${i}]`).join(', ')})`
      : `u_${n}`;
  const param = (n: string) => {
    const m = array(n);
    return m ? `${m[1]} ${n}[${m[2]}]` : `${type(n)} ${n}`;
  };
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    ...inputs.map(uniform),
    'out vec4 fragColor;',
    r.preamble ?? '',
    `float userFn(${inputs.map(param).join(', ')}) {`,
    body,
    '}',
    'void main() {',
    `  fragColor = vec4(userFn(${inputs.map(arg).join(', ')}), 0.0, 0.0, 0.0);`,
    '}',
  ].join('\n');
}

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, batch G11: the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test("each shader agrees with the profile's JavaScript value within single-float precision", async () => {
      const items = SCALARS.flatMap(([label, json]) => {
        const f = js(json);
        const r = glsl(json);
        return POINTS.map((p) => ({
          name: `${label} at ${JSON.stringify(p)}`,
          source: shader(r),
          uniforms: Object.fromEntries(
            r.freeSymbols!.map((n) => [`u_${n}`, p[n]])
          ),
          expected: f.run!(p as never) as unknown as number,
        }));
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        if (
          !(
            Math.abs(v.value - expected) <=
            1e-4 * Math.max(1, Math.abs(expected))
          )
        )
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBe(SCALARS.length * POINTS.length);
    }, 180_000);
  }
);
