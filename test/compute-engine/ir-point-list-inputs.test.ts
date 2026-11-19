/**
 * Inputs that are lists of points in the profile `ir` (batch G14, README of
 * `src/compute-engine/compilation/ir/`, "Tuples"): an input of type
 * `list<tuple<…>>` of real or integer numbers is a list of points, the value
 * that `PointList` of lists makes; so are a parameter of a user function
 * declared such a list, or taking one at its first call, and a result
 * declared such a list. JavaScript only: GLSL declines.
 *
 * The witnesses are rows of Tycho's run over every Desmos document; the
 * functions they call are defined in the documents, so the definitions here
 * are stand-ins of the same shape. JavaScript agrees with the interpreter
 * within 1e-12.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import { ComputeEngine } from '../../src/compute-engine';
import {
  createJavaScriptRuntime,
  type StoredJavaScript,
} from '../../src/compute-engine/compilation/javascript-runtime';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Value = number | number[] | number[][];
type Point = Record<string, Value>;

const ce = new ComputeEngine();
const EXT = 'nan | real | signed_infinity';
for (const name of ['x', 'a', 'l', 't_1']) ce.declare(name, 'real');
ce.declare('M', 'tuple<real, real>');
ce.declare('M3', 'tuple<real, real, real>');
ce.declare('D', 'list<real>');
ce.declare('E', 'list<real>');
ce.declare('D3', 'list<real^3>');
// The inputs that are lists of points, and the scalar points.
const DECLARED: Record<string, string> = {
  P: 'list<tuple<real, real>>',
  P3: 'list<tuple<real, real, real>>',
  PI: 'list<tuple<integer, integer>>',
  S: 'list<tuple<real, real>^3>',
  // The witnesses' types.
  PE: `list<tuple<${EXT}, ${EXT}>>`,
  A_1: `list<tuple<${EXT}, ${EXT}, ${EXT}>>`,
  G_1: 'list<(tuple<integer, integer, real, integer> | tuple<integer, real, integer, integer>)^4>',
  G_2: 'list<tuple<integer, real, real, integer>^6>',
  C4: 'list<tuple<real, real, real, real>>',
};
for (const [name, type] of Object.entries(DECLARED)) ce.declare(name, type);
// A union of tuple types of one length: a point of two reals.
const UNION = 'tuple<real, integer> | tuple<integer, real>';
ce.declare('MU', UNION);
const TUPLES = new Set(['M', 'M3', 'MU']);

// User functions of a list-of-points parameter or result.
const define = (
  name: string,
  type: string | undefined,
  body: Json,
  ...params: string[]
) => {
  if (type !== undefined) ce.declare(name, type);
  ce.assign(name, ce.box(['Function', body, ...params] as never));
};
define('fp', '(list<tuple<real, real>>) -> real', ['Sum', ['Abs', 'L']], 'L');
define(
  'fs',
  '(list<tuple<real, real>^3>) -> real',
  ['Sum', ['PointY', 'L']],
  'L'
);
define(
  'fr',
  '(list<tuple<real, real>>, real) -> list<tuple<real, real>>',
  ['Add', ['Multiply', 'k', 'L'], ['Tuple', 1, -1]],
  'L',
  'k'
);
define(
  'fr3',
  '(list<tuple<real, real>^3>) -> list<tuple<real, real>^3>',
  ['Negate', 'L'],
  'L'
);
// Of no declared type: the argument of the first call decides.
define('gu', undefined, ['Sum', ['PointX', 'L']], 'L');
define('gd', undefined, ['Sum', ['Distance', 'q', 'L']], 'q', 'L');
define('fu', `(${UNION}) -> real`, ['Add', ['Abs', 'p'], ['PointY', 'p']], 'p');
define('ru', `(real) -> ${UNION}`, ['Tuple', ['Sin', 'z'], 3], 'z');
define('ga', undefined, ['Sum', ['Abs', 'L']], 'L');
// A list parameter of a run-time length next to an untyped one, whose
// arguments are lowered before the function.
define(
  'gm',
  '(list<tuple<real, real>>, unknown) -> real',
  ['Add', ['Sum', ['Abs', 'L']], ['PointX', 'q']],
  'L',
  'q'
);
define(
  'gn',
  '(list<real>, unknown) -> real',
  ['Add', ['Sum', 'L'], ['PointX', 'q']],
  'L',
  'q'
);
// A stand-in of `fill` of showcase/apollonian-gasket.
const C4T = DECLARED.C4;
define(
  'fill',
  `(integer, integer, integer, integer, ${C4T}) -> ${C4T}`,
  ['Add', 'L', ['Tuple', 'i', 'j', 'k', 'm']],
  'i',
  'j',
  'k',
  'm',
  'L'
);
// A stand-in of `generations`: a list of tuples grown in a loop.
// prettier-ignore
define('generations', `(${C4T}, integer, integer) -> list<tuple<number, number, number, integer>>`, ['Block',
  ['Declare', 'out', { str: 'list<tuple<number, number, number, integer>>' }, ['Dictionary', ['KeyValuePair', { str: 'value' }, ['List']]]],
  ['Loop', ['If', ['LessEqual', ['At', 'c', 1], 'n'], ['Assign', 'out', ['Append', 'out', ['Tuple', ['At', 'c', 1], ['At', 'c', 2], ['At', 'c', 3], 'm']]]], ['Element', 'c', 'L']],
  'out'], 'L', 'n', 'm');
// A function that reads a list of points that is an input (a capture).
define('cap', undefined, ['Add', 'x', ['Sum', ['PointX', 'P']]], 'x');

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options });

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

/** The value of `v` for the interpreter: a list of points is a `List` of
 *  `Tuple`s. */
function boxed(name: string, v: Value): Expression {
  if (!Array.isArray(v)) return ce.number(v);
  if (name in DECLARED)
    return ce.function(
      'List',
      (v as number[][]).map((p) =>
        ce.function(
          'Tuple',
          p.map((n) => ce.number(n))
        )
      )
    );
  return ce.function(
    TUPLES.has(name) ? 'Tuple' : 'List',
    (v as number[]).map((n) => ce.number(n))
  );
}

function interpreted(json: Json, point: Point): unknown {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, boxed(k, v)])
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

// Lengths 0, 1 and several; two and three coordinates; integer and real
// elements. `S`, `G_1` and `G_2` have a stated length.
// prettier-ignore
const POINTS: Point[] = [
  { x: 0.5, M: [1.5, -2], M3: [1, 2, 2], D3: [1, 2, 3], D: [], P: [], P3: [], PI: [], S: [[1, 2], [3, 4], [5, 6]] },
  { x: -1.25, M: [0.25, 3], M3: [0, -1, 0.5], D3: [0.5, -1, 4], D: [2], P: [[3, 4]], P3: [[1, -2, 0.5]], PI: [[2, -7]], S: [[0.5, -1], [2.5, 0], [-3, 1.25]] },
  { x: 2, M: [-3, 0.5], M3: [-0.5, 0.75, 4], D3: [2, 2, -7], D: [1, 4, -2.5], P: [[3, 5], [-1, 0.5], [2, 2]], P3: [[1, 2, 3], [0, 0.25, -1], [4, -4, 2]], PI: [[1, 2], [-3, 4], [0, 9]], S: [[7, 1], [-2, -2], [0.125, 3]] },
  { x: 0.75, M: [2, 2], M3: [3, 1, -2], D3: [0, 0.25, 9], D: [0.5, 1.5, 2.5, 3.5], P: [[0.1, 0.2], [0.3, -0.4], [-5, 6], [10, 0]], P3: [[1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4]], PI: [[5, 5], [6, -6], [-7, 7], [8, 8]], S: [[1, 1], [1, 1], [1, 1]] },
];

// Programs over lists of points of any length.
// prettier-ignore
const VALUES: [label: string, json: Json][] = [
  ['the input itself', 'P'],
  ['Length', ['Length', 'P']],
  ['PointX', ['PointX', 'P']],
  ['PointY of integer points', ['PointY', 'PI']],
  ['PointZ of points of three', ['PointZ', 'P3']],
  ['Abs, point by point', ['Abs', 'P']],
  ['Sum of the norms', ['Sum', ['Abs', 'P3']]],
  ['a point plus a list of points', ['Add', 'M', 'P']],
  ['a list of points minus a point', ['Subtract', 'P3', 'M3']],
  ['integer points plus a point', ['Add', 'PI', 'M']],
  ['Distance of a point and a list of points', ['Distance', 'M', 'P']],
  ['a sum of two lists of points', ['Add', 'P', ['Multiply', 2, 'P']]],
  ['a negated list of points', ['Negate', 'P3']],
  ['a list of points divided by a scalar', ['Divide', 'P', 'x']],
  ['Sin of a list of points', ['Sin', 'P']],
  ['a list of points scaled by its norms', ['Multiply', 'P', ['Abs', 'P']]],
  ['a list of points divided by a list of numbers of its length', ['Divide', ['Subtract', 'M', 'P'], ['Add', 1, ['Power', ['PointX', 'P'], 2]]]],
  ['Map over the points', ['Map', ['Function', ['Add', ['PointX', 'q'], ['Abs', 'q']], 'q'], 'P']],
  ['Filter of the points', ['Filter', 'P', ['Function', ['Greater', ['PointX', 'q'], 0], 'q']]],
  ['a Comprehension of points', ['Comprehension', ['Tuple', ['PointY', 'q'], ['Multiply', 'x', ['PointX', 'q']]], ['Element', 'q', 'P']]],
  ['a Comprehension with a condition', ['Comprehension', ['Abs', 'q'], ['Element', 'q', 'P3', ['Less', ['PointZ', 'q'], 2]]]],
  ['a Loop over the points', ['Block', ['Declare', 's', { str: 'real' }, 0], ['Loop', ['Assign', 's', ['Add', 's', ['Multiply', ['PointX', 'q'], ['PointY', 'q']]]], ['Element', 'q', 'PI']], 's']],
  ['At of a stated length, a constant index', ['At', 'S', 2]],
  ['PointX of the last point of a stated length', ['PointX', ['At', 'S', -1]]],
  ['a list of points of a stated length plus a point', ['Add', 'S', 'M']],
  // User functions.
  ['a parameter declared a list of points', ['fp', 'P']],
  ['a declared run-time parameter, a stated-length argument', ['Add', ['fp', 'S'], ['fp', 'P']]],
  ['a parameter declared a list of points of a stated length', ['fs', 'S']],
  ['a result declared a list of points', ['fr', 'P', 'x']],
  ['a result of a stated length', ['fr3', 'S']],
  ['an untyped parameter that takes a list of points', ['gu', 'P']],
  ['an untyped parameter, then a list of a stated length', ['Add', ['gu', 'P'], ['gu', 'S']]],
  ['an untyped parameter, a stated length first', ['Add', ['gu', 'S'], ['gu', 'P']]],
  ['untyped parameters, a point and a list of points', ['gd', 'M', 'P']],
  ['an untyped parameter, integer points first', ['Add', ['gu', 'PI'], ['gu', 'P']]],
  ['a result passed to a parameter', ['fp', ['fr', 'P', 2]]],
  // The order of the calls does not change what compiles.
  ['a stated length, then a run-time length, next to an untyped parameter', ['List', ['gm', 'S', 'M'], ['gm', 'P', 'M']]],
  ['a run-time length, then a stated length, next to an untyped parameter', ['List', ['gm', 'P', 'M'], ['gm', 'S', 'M']]],
  ['a list of a stated length, then of a run-time length', ['List', ['gn', 'D3', 'M'], ['gn', 'D', 'M']]],
  ['a list of a run-time length, then of a stated length', ['List', ['gn', 'D', 'M'], ['gn', 'D3', 'M']]],
];

describe('IR profile, batch G14: inputs that are lists of points', () => {
  test('the interpreter reads a list of points point by point', () => {
    const p = {
      P: [
        [3, 5],
        [-1, 0.5],
      ],
      D: [2, 4],
      M: [1, 2],
    };
    expect(interpreted(['Divide', 'P', 'D'], p)).toEqual([
      [1.5, 2.5],
      [-0.25, 0.125],
    ]);
    expect(interpreted(['Add', 'M', 'P'], p)).toEqual([
      [4, 7],
      [0, 2.5],
    ]);
    expect(interpreted(['Length', 'P'], p)).toBe(2);
  });

  test.each(VALUES)('%s: JavaScript against the interpreter', (_, json) => {
    check(json, POINTS);
  });

  test('the value is an array of arrays, read in place', () => {
    const r = js(['PointX', 'P']);
    expect(r.code).toMatch(/_\.P\[v\d+\]\[0\]/);
    expect(
      r.run!({
        P: [
          [1, 2],
          [3, 4],
        ],
      } as never)
    ).toEqual([1, 3]);
  });
});

//
// The witnesses
//

// prettier-ignore
const NEYRET: Json = ['Add', ['Multiply', -10, ['Divide', ['Add', 'M', ['Negate', ['PointList', 0, 0]]], ['Power', ['Add', ['Power', ['Add', ['Negate', ['PointY', 'M']], ['PointY', ['PointList', 0, 0]]], 2], ['Power', ['Add', ['Negate', ['PointX', 'M']], ['PointX', ['PointList', 0, 0]]], 2]], ['Rational', 3, 2]]]], ['Multiply', 10, ['Divide', ['Add', 'M', ['Negate', 'PE']], ['Power', ['Add', ['Power', ['Add', ['Negate', ['PointY', 'M']], ['PointY', 'PE']], 2], ['Power', ['Add', ['Negate', ['PointX', 'M']], ['PointX', 'PE']], 2]], ['Rational', 3, 2]]]]];
// prettier-ignore
const ART: Json = ['Comprehension', ['PointList', ['Add', ['Multiply', 'a', ['Cos', ['Add', ['Negate', 't_1'], ['Multiply', ['Divide', ['Multiply', 2, 'Pi'], 'l'], ['PointX', 'p']]]], ['Power', 'ExponentialE', ['Divide', ['PointZ', 'p'], ['Multiply', 0.2, 'l']]]], ['PointX', 'p']], ['PointY', 'p'], ['Add', ['Multiply', 'a', ['Sin', ['Add', ['Negate', 't_1'], ['Multiply', ['Divide', ['Multiply', 2, 'Pi'], 'l'], ['PointX', 'p']]]], ['Power', 'ExponentialE', ['Divide', ['PointZ', 'p'], ['Multiply', 0.2, 'l']]]], ['PointZ', 'p']]], ['Element', 'p', 'A_1']];
const gasket = (name: string): Json => [
  'Block',
  [
    'Declare',
    'X',
    [
      'Dictionary',
      [
        'KeyValuePair',
        { str: 'value' },
        ['Comprehension', ['At', 'c', 2], ['Element', 'c', name]],
      ],
      ['KeyValuePair', { str: 'constant' }, 'True'],
    ],
  ],
  ['Tuple', 'X'],
];
const rows = (n: number, f: (k: number) => number[]) =>
  Array.from({ length: n }, (_, k) => f(k));

describe('IR profile, batch G14: the witnesses', () => {
  test('neyret/3eiljfuzoa: a force field over a list of points', () => {
    // prettier-ignore
    const points: Point[] = [
      { M: [1, 2], PE: [] },
      { M: [1, 2], PE: [[3, 5]] },
      { M: [-0.5, 0.25], PE: [[3, 5], [-1, 0.5], [2, 2], [0.1, -4]] },
    ];
    check(NEYRET, points, { symbolic: ['M', 'PE'] });
  });

  test('art/akrhs3cb8z: a Comprehension of points over a list of points of three extended reals', () => {
    const points: Point[] = [0, 1, 5].map((n) => ({
      a: 0.4,
      l: 3,
      t_1: 0.7,
      A_1: rows(n, (k) => [k * 0.5, 1 - k, -0.25 * k]),
    }));
    check(ART, points, { symbolic: ['a', 'l', 't_1', 'A_1'] });
  });

  test('showcase/apollonian-gasket: At of each point of a union of tuple types, and of tuples of integers and reals', () => {
    const g1 = rows(4, (k) => [k, k + 0.5, 2 * k, -k]);
    check(gasket('G_1'), [{ G_1: g1 }], { symbolic: ['G_1'] });
    for (const n of [6]) {
      const g2 = rows(n, (k) => [k, k / 3, -k, 1]);
      check(gasket('G_2'), [{ G_2: g2 }], { symbolic: ['G_2'] });
    }
  });

  test('a union of tuple types of one length is a tuple of reals where they differ', () => {
    const r = js(['At', ['At', 'G_1', 2], 3], { symbolic: ['G_1'] });
    expect(r.run!({ G_1: rows(4, (k) => [k, k, k + 0.5, k]) } as never)).toBe(
      1.5
    );
  });

  test('showcase/apollonian-gasket: fill on a list of points of four reals', () => {
    check(
      ['fill', 1, 2, 3, 4, 'C4'],
      [
        { C4: [] },
        { C4: [[1, 2, 3, 4]] },
        { C4: rows(5, (k) => [k, -k, 0.5 * k, 2]) },
      ]
    );
  });

  // The two records that write a list local. A list local written whole
  // (CE-1481) is the interpreter's value.
  test('circlesLocal, assigned in a Loop', () => {
    // prettier-ignore
    check(
      ['Block', ['Declare', 'cl', ['Dictionary', ['KeyValuePair', { str: 'value' }, 'C4']]], ['Loop', ['Block', ['Assign', 'cl', ['fill', ['At', 'gap', 1], ['At', 'gap', 2], ['At', 'gap', 3], 2, 'cl']]], ['Element', 'gap', ['List', ['Tuple', 1, 2, 3], ['Tuple', 3, 2, 1]]]], ['Tuple', 'cl']],
      [{ C4: [] }, { C4: [[1, 2, 3, 4]] }, { C4: rows(3, (k) => [k, -k, 0.5 * k, 2]) }],
      { symbolic: ['C4'] }
    );
  });
  // prettier-ignore
  test.each([
    ['generations, a local list of tuples grown in a Loop', ['Block', ['Declare', 'G', ['Dictionary', ['KeyValuePair', { str: 'value' }, ['generations', 'C4', 1, 1]], ['KeyValuePair', { str: 'constant' }, 'True']]], ['Tuple', 'G']], /the operator Append is not supported/],
  ])('%s declines, with the cause', (_, json, cause) => {
    const d = failure(() => js(json, { symbolic: ['C4'] }));
    expect(d?.code).toBe('outside-profile');
    expect(d?.message).toMatch(cause);
  });
});

//
// The entry, stored code, batches
//

describe('IR profile, batch G14: the entry of a list of points', () => {
  test('the entry plan holds the input as a list', () => {
    const r = js(['Sum', ['Abs', 'P']]);
    expect(r.entryPlan).toMatchObject({ lists: ['P'] });
  });

  test('the entry check refuses a string and a typed array for the list, and reads no row', () => {
    const r = js(['Sum', ['Abs', 'P']]);
    expect(() => r.run!({ P: 'ab' } as never)).toThrow(TypeError);
    expect(() => r.run!({ P: new Float64Array([1, 2]) } as never)).toThrow(
      /typed array/
    );
    // A row of another length is outside the declared type: no check reads
    // it, and the result is unspecified (no throw from the entry).
    expect(() => r.run!({ P: [[3, 4], [6]] } as never)).not.toThrow();
    expect(() =>
      r.run!({
        P: [
          [3, 4],
          [6, 8, 1],
        ],
      } as never)
    ).not.toThrow();
    // With `entryChecks: false`, the string is not refused at the entry.
    const unchecked = js(['Length', 'P'], { entryChecks: false });
    expect(unchecked.run!({ P: 'ab' } as never)).toBe(2);
  });

  const stored = (r: CompilationResult<'javascript'>): StoredJavaScript =>
    JSON.parse(
      JSON.stringify({
        code: r.code,
        preamble: r.preamble,
        preambleOnce: r.preambleOnce,
        reconstructionDigits: r.reconstructionDigits,
        calling: r.calling,
        entryPlan: r.entryPlan,
        mode: r.mode,
        runtimeVersion: r.runtimeVersion,
        shippable: r.shippable,
        profile: r.profile,
      })
    );

  test('stored code loads and gives the values of run()', () => {
    const rt = createJavaScriptRuntime();
    for (const json of [
      ['Distance', 'M', 'P'],
      ['fr', 'P', 'x'],
      ['gu', 'S'],
      ART,
    ]) {
      const r = js(json, { symbolic: ['A_1', 'a', 'l', 't_1'] });
      const f = rt.load(stored(r));
      const p = {
        ...POINTS[2],
        a: 0.4,
        l: 3,
        t_1: 0.7,
        A_1: [
          [1, 2, 3],
          [0, -1, 0.5],
        ],
      };
      expect([json, f(p)]).toEqual([json, r.run!(p as never)]);
    }
    expect(() => rt.load(stored(js(['Length', 'P'])))({ P: 'ab' })).toThrow(
      TypeError
    );
  });

  test('broadcast(): a list of points is shared by the cells', () => {
    const r = js(['Multiply', 'x', ['Sum', ['Abs', 'P']]]);
    const got = r.broadcast!({
      x: new Float64Array([1, 2, -0.5]),
      P: [
        [3, 4],
        [6, 8],
      ],
    } as never);
    expect(Array.from(got)).toEqual([15, 30, -7.5]);
  });

  test('broadcast() shares a list input also with entryChecks: false', () => {
    const x = new Float64Array([1, 2, -0.5]);
    const rank1 = js(['Multiply', 'x', ['Sum', 'D']], { entryChecks: false });
    expect(Array.from(rank1.broadcast!({ x, D: [1, 2, 3] } as never))).toEqual([
      6, 12, -3,
    ]);
    const points = js(['Multiply', 'x', ['Sum', ['Abs', 'P']]], {
      entryChecks: false,
    });
    const P = [
      [3, 4],
      [6, 8],
    ];
    expect(Array.from(points.broadcast!({ x, P } as never))).toEqual([
      15, 30, -7.5,
    ]);
  });
});

//
// Declines
//

describe('IR profile, batch G14: declines', () => {
  // prettier-ignore
  test.each([
    ['Length on GLSL', ['Length', 'P'], 'glsl', /a list of rank 2 on glsl/],
    ['At of a stated length on GLSL', ['PointX', ['At', 'S', 2]], 'glsl', /a list of rank 2 on glsl/],
    ['a parameter declared a list of points on GLSL', ['fs', 'S'], 'glsl', /a list of rank 2 on glsl/],
    ['a parameter of a run-time length on GLSL', ['fp', 'S'], 'glsl', /a list of rank 2 on glsl/],
    ['an untyped parameter on GLSL', ['gu', 'S'], 'glsl', /a list of rank 2 on glsl/],
    ['an untyped parameter of a run-time length on GLSL', ['gu', 'P'], 'glsl', /a list of rank 2 on glsl|run-time length/],
    ['Sum of a list of points (a point)', ['Sum', 'P'], 'javascript', /a term that is not a number/],
    ['a list of points scaled by a list of another length', ['Multiply', 'P', 'D'], 'javascript', /another shape/],
    ['a list of points read by a function body (a capture)', ['cap', 1], 'javascript', /reads the input P of type list<tuple<real, real>>/],
    ['an untyped parameter, a list of points and a point', ['Add', ['gu', 'P'], ['gu', 'M']], 'javascript', /an argument of gu of another shape than at its first call/],
    ['a scalar after a list of points', ['List', ['ga', 'P'], ['ga', 'x']], 'javascript', /x: an argument of ga of another shape than at its first call: the parameter L is a list of points of 2 numbers \(real here\)/],
    ['a call of the result of the same function', ['ga', ['ga', 'P']], 'javascript', /the parameter L is a list of points of 2 numbers \(real here\)/],
    ['an integer after a list of points', ['Add', ['ga', 'P'], ['ga', ['Length', 'P']]], 'javascript', /the parameter L is a list of points of 2 numbers \(integer here\)/],
    ['a scalar after a PointList of lists', ['List', ['ga', ['PointList', 'D', 'E']], ['ga', 'x']], 'javascript', /the parameter L is a list of points of 2 numbers \(real here\)/],
    ['a list of points of 3 for a parameter declared of 2', ['fp', 'P3'], 'javascript', /"P3": an argument of fp that is not list<tuple<real, real>>$/],
    ['a list of numbers for a parameter declared a list of points', ['fp', 'D'], 'javascript', /D: an argument of fp that is not list<tuple<real, real>>$/],
    ['an untyped parameter, a point and then a list of points', ['Add', ['gu', 'M'], ['gu', 'P']], 'javascript', /the parameter L is a point of 2 numbers \(list<tuple<real, real>> here\)/],
  ])('%s declines, with the cause', (_, json, to, cause) => {
    const d = failure(() => compile(box(json), { ...IR, to } as never));
    expect(d?.code).toBe('outside-profile');
    expect(d?.message).toMatch(cause);
  });

  // Batch G30: on JavaScript an index that can be out of range reads a
  // point of NaN coordinates there, the interpreter's value; GLSL and the
  // interval mode decline.
  test('At of a run-time length, and with a run-time index', () => {
    const S = [
      [1, 2],
      [3, 4],
      [5, 6],
    ];
    const cases: [Json, Point][] = [
      [['At', 'P', 2], { P: [[1, 2]] }],
      [['At', 'P', 2], { P: S }],
      ...[0.5, 1, 3.5, 4, -2].map((x): [Json, Point] => [
        ['At', 'S', ['Floor', 'x']],
        { S, x },
      ]),
    ];
    for (const [json, point] of cases) {
      const want = interpreted(json, point);
      expect(Array.isArray(want) && want.length === 2).toBe(true);
      expect([json, point, js(json).run(point)]).toEqual([json, point, want]);
      for (const to of ['glsl', 'interval-js'])
        expect(
          failure(() => compile(box(json), { ...IR, to } as never))?.message
        ).toMatch(/an index that can be out of range|a list of rank 2 on glsl/);
    }
  });

  test('a list of tuples of booleans, and of points of two lengths, decline as inputs', () => {
    const e = new ComputeEngine();
    e.declare('B', 'list<tuple<boolean, boolean>>');
    e.declare('U', 'list<tuple<real, real> | tuple<real, real, real>>');
    for (const name of ['B', 'U']) {
      const d = failure(() =>
        compile(e.box(['Length', name] as never), IR as never)
      );
      expect(d?.code).toBe('outside-profile');
      expect(d?.message).toMatch(new RegExp(`the input ${name} of type`));
    }
  });
});

//
// Robustness
//

describe('IR profile, batch G14: robustness over a list of points', () => {
  const P = ce.box('P');
  const value = {
    x: 0.5,
    P: [
      [3, 4],
      [-1, 0.5],
      [0.25, 2],
    ],
  };
  const norms = (q: number[][]) =>
    q.reduce((s, [u, v]) => s + Math.hypot(u, v), 0);

  test('a shared graph of 2^20 paths', () => {
    let e: Expression = P;
    for (let i = 0; i < 20; i++)
      e = ce.function('Add', [
        e,
        ce.function('Multiply', [
          ce.function('Sin', [
            ce.function('Divide', [
              ce.function('Sum', [ce.function('Abs', [e])]),
              ce.number(1000),
            ]),
          ]),
          e,
        ]),
      ]);
    const root = ce.function('Sum', [ce.function('Abs', [e])]);
    const start = performance.now();
    const r = compile(root, IR);
    expect(r.code.length + (r.preamble ?? '').length).toBeLessThan(60_000);
    // A guard against a walk by paths (a hang), not a measure.
    expect(performance.now() - start).toBeLessThan(30_000);
    // The value, by the same recurrence in doubles: each level scales the
    // list by 1 + sin(the sum of its norms / 1000).
    let n = norms(value.P);
    for (let i = 0; i < 20; i++) n *= 1 + Math.sin(n / 1000);
    expect(r.run!(value as never)).toBeCloseTo(n, 9);
  });

  test('a chain of 1,000 operands', () => {
    const sum = ce.function(
      'Add',
      Array.from({ length: 1_000 }, (_, i) =>
        ce.function('Multiply', [
          ce.function('Sin', [ce.function('Add', [ce.box('x'), ce.number(i)])]),
          P,
        ])
      )
    );
    const root = ce.function('Sum', [ce.function('Abs', [sum])]);
    // A hang guard, not a measure.
    const start = performance.now();
    const r = compile(root, IR);
    // Linear in the operands: one element-wise product of each.
    expect(r.code.length).toBeLessThan(400_000);
    expect(performance.now() - start).toBeLessThan(30_000);
    const s = Array.from({ length: 1_000 }, (_, i) => Math.sin(0.5 + i)).reduce(
      (a, b) => a + b
    );
    expect(r.run!(value as never)).toBeCloseTo(Math.abs(s) * norms(value.P), 9);
  });

  test('a nested loop over the points', () => {
    const json = [
      'Block',
      ['Declare', 'k', { str: 'real' }, 0],
      [
        'Loop',
        ['Assign', 'k', ['Add', 'k', ['Distance', 'p', 'q']]],
        ['Element', 'p', 'P'],
        ['Element', 'q', 'P'],
      ],
      'k',
    ];
    const start = performance.now();
    const r = js(json);
    expect(performance.now() - start).toBeLessThan(30_000);
    const q = value.P;
    const want = q.reduce(
      (s, [a, b]) =>
        s + q.reduce((t, [c, d]) => t + Math.hypot(a - c, b - d), 0),
      0
    );
    expect(r.run!(value as never)).toBeCloseTo(want, 9);
    expect(r.run!(value as never)).toBeCloseTo(
      interpreted(json, value) as number,
      9
    );
  });
});

//
// A union of tuple types on GLSL, in WebGL2
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
 *  scalar input, a `float[n]` uniform per point (passed as a `vecN`). */
function shader(r: CompilationResult<'glsl'>): string {
  const inputs = r.freeSymbols!;
  const type = (n: string) => r.freeSymbolTypes![n].lowered;
  const vec = (n: string) => Number(/^vec(\d)$/.exec(type(n))?.[1] ?? 0);
  const uniform = (n: string) =>
    vec(n) > 0
      ? `uniform float u_${n}[${vec(n)}];`
      : `uniform ${type(n)} u_${n};`;
  const arg = (n: string) =>
    vec(n) > 0
      ? `${type(n)}(${Array.from({ length: vec(n) }, (_, i) => `u_${n}[${i}]`).join(', ')})`
      : `u_${n}`;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    ...inputs.map(uniform),
    'out vec4 fragColor;',
    r.preamble ?? '',
    `float userFn(${inputs.map((n) => `${type(n)} ${n}`).join(', ')}) {`,
    body,
    '}',
    'void main() {',
    `  fragColor = vec4(userFn(${inputs.map(arg).join(', ')}), 0.0, 0.0, 0.0);`,
    '}',
  ].join('\n');
}

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, batch G14: a union of tuple types in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test("an input, a parameter and a result of a union of tuples are a vec2, with the interpreter's values", async () => {
      const programs: Json[] = [
        ['Abs', 'MU'],
        ['fu', 'MU'],
        ['Add', ['fu', ['Tuple', 'x', 1]], ['PointX', ['ru', 'x']]],
      ];
      const points: Point[] = [
        { x: 0.5, MU: [1.5, -2] },
        { x: -1.25, MU: [3, 4] },
      ];
      const items = programs.flatMap((json) => {
        const r = compile(box(json), { ...IR, to: 'glsl' });
        expect(r.success).toBe(true);
        return points.map((p) => ({
          name: `${JSON.stringify(json)} at ${JSON.stringify(p)}`,
          source: shader(r),
          uniforms: Object.fromEntries(
            r.freeSymbols!.map((n) => [`u_${n}`, p[n]])
          ),
          expected: interpreted(json, p) as number,
        }));
      });
      expect(
        compile(box(['Abs', 'MU']), { ...IR, to: 'glsl' }).freeSymbolTypes!.MU
          .lowered
      ).toBe('vec2');
      const values = await driver.evaluate(items as never);
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
    }, 180_000);
  }
);
