/**
 * CE-1532: three groups of operators of the profile `ir` (README of
 * `src/compute-engine/compilation/ir/`, "Lists").
 *
 * - `Mode`, `Quartiles`, `InterquartileRange`, `Skewness` and `Kurtosis` of
 *   one list of real numbers, and `Covariance`, `PopulationCovariance` and
 *   `Correlation` of two, on JavaScript: the interpreter's kernels, so the
 *   compiled value is the interpreter's within 1e-12, and NaN where the
 *   interpreter gives an error (lists of two lengths, fewer than two pairs,
 *   a list of equal elements for `Correlation`). GLSL and the interval mode
 *   decline them.
 * - `Binomial` and `Choose` thread over a list, as the interpreter's, on
 *   JavaScript, in the interval mode and on GLSL (integers).
 * - `Equal` and `NotEqual` of two booleans, and of two lists or two tuples
 *   of real numbers, are one boolean, as the interpreter's: the same length
 *   and each element equal, with the exact equality of compiled code (no
 *   tolerance). They compile on the three targets; a list of a run-time
 *   length declines on GLSL, as everywhere. Lists and tuples of booleans
 *   decline.
 *
 * The GLSL values are read in WebGL2; without the headless Chromium those
 * tests are skipped.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
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
ce.declare('n', 'integer');
ce.declare('k', 'integer');
for (const name of ['L', 'M']) ce.declare(name, 'list<real>');
for (const name of ['X', 'Y'])
  ce.declare(name, 'list<nan | real | signed_infinity>');
for (const name of ['I', 'J']) ce.declare(name, 'list<integer>');
for (const name of ['L3', 'M3']) ce.declare(name, 'list<real^3>');
ce.declare('L2', 'list<real^2>');
ce.declare('N3', 'list<integer^3>');
for (const name of ['P', 'Q']) ce.declare(name, 'tuple<real, real>');
ce.declare('T', 'tuple<real, real, real>');
for (const name of ['PB', 'QB']) ce.declare(name, 'tuple<boolean, boolean>');
ce.declare('PL', 'list<tuple<real, real>>');
ce.declare('G', 'matrix<real^(2x2)>');
for (const name of ['a', 'b', 'c']) ce.declare(name, 'boolean');
for (const name of ['B', 'C']) ce.declare(name, 'list<boolean>');
for (const name of ['B3', 'C3']) ce.declare(name, 'list<boolean^3>');
ce.declare('z', 'complex');

/** The inputs that hold a tuple, or a list of tuples. */
const TUPLES = new Set(['P', 'Q', 'T', 'PB', 'QB']);

const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json, options: object = {}) =>
  compile(box(json), { fallback: false, ...options } as never);

/** The message of a compilation that throws, or `undefined`. */
function failure(json: Json, options: object = {}): string | undefined {
  try {
    js(json, options);
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

/** An input value as MathJSON. */
function literal(name: string, v: Value): Json {
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number')
    return Number.isFinite(v)
      ? v
      : { num: Number.isNaN(v) ? 'NaN' : v > 0 ? '+Infinity' : '-Infinity' };
  return [
    TUPLES.has(name) ? 'Tuple' : 'List',
    ...v.map((w) => literal('', w)),
  ];
}

/** The interpreter's value: a number, a boolean, an array for a list or a
 *  tuple, and NaN for an error or a form that stays unevaluated. */
function read(e: Expression): Value {
  if (isNumber(e)) return e.re;
  if (isSymbol(e, 'True')) return true;
  if (isSymbol(e, 'False')) return false;
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  return NaN;
}

function interpreted(json: Json, point: Point): Value {
  const values = Object.fromEntries(
    Object.entries(point).map(([name, v]) => [name, box(literal(name, v))])
  );
  return ce.withValues(values as never, () => read(box(json).evaluate().N()));
}

/** `v` and `w` have one shape and agree within `tolerance` (NaN is NaN). */
function agree(v: unknown, w: Value, tolerance = 1e-12): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((y, i) => agree(v[i], y, tolerance))
    );
  if (typeof w === 'boolean') return v === w;
  return (
    typeof v === 'number' &&
    (v === w ||
      (Number.isNaN(v) && Number.isNaN(w)) ||
      (Number.isFinite(v) &&
        Number.isFinite(w) &&
        Math.abs(v - w) <= tolerance * Math.max(1, Math.abs(w))))
  );
}

/** The compiled JavaScript of `json` gives the interpreter's value at each
 *  point. */
function expectInterpreted(json: Json, points: Point[], options: object = {}) {
  const r = js(json, options);
  expect(r.success).toBe(true);
  for (const p of points) {
    const got = r.run!(p as never);
    const want = interpreted(json, p);
    if (!agree(got, want))
      throw new Error(
        `at ${JSON.stringify(p)}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`
      );
  }
}

const L = [3, 1, 4, 1, 5, 9, 2, 6];
const M = [2, 7, 1, 8, 2, 8, 1, 8];

const UNIVARIATE = [
  'Mode',
  'Quartiles',
  'InterquartileRange',
  'Skewness',
  'Kurtosis',
];
const BIVARIATE = ['Covariance', 'PopulationCovariance', 'Correlation'];

// prettier-ignore
const ONE_LIST: [label: string, json: (h: string) => Json, points: Point[]][] = [
  ['of L', (h) => [h, 'L'], [
    { L },
    { L: [0.1, 0.2, 0.3, 0.3] },
    { L: [2, 2, 1, 1, 3] },
    { L: [5.5] },
    { L: [] },
    { L: [1, 2] },
    { L: [0.1, 0.1, 0.1] },
    { L: [1e8 + 0.125, 1e8 + 0.25, 1e8 + 0.5, 1e8 + 4] },
    { L: [-1e200, 1e200, 3e200, 3e200] },
  ]],
  ['of NaN and infinite elements', (h) => [h, 'X'], [
    { X: [1, NaN, 3] },
    { X: [1, 1, NaN] },
    { X: [NaN, NaN, 2] },
    { X: [1, Infinity, 3] },
    { X: [Infinity, Infinity] },
    { X: [-Infinity, 2, 2, Infinity] },
  ]],
  ['of integers', (h) => [h, 'I'], [{ I: [3, 1, 3] }, { I: [2, 7, 1, 8, 2, 8] }, { I: [4] }]],
  ['of a stated length', (h) => [h, 'L3'], [{ L3: [1.5, 2, 3] }, { L3: [2, 2, 2] }]],
  ['of a literal list', (h) => [h, ['List', 1, ['Sin', 'x'], 3, 1]], [{ x: 0.7 }, { x: Math.PI / 2 }]],
  ['of a built list', (h) => [h, ['Map', ['Function', ['Multiply', 't', 't'], 't'], 'L']], [{ L }, { L: [-1, 1, 2] }]],
  ['of a Range', (h) => [h, ['Range', 1, 'n']], [{ n: 10 }, { n: 1 }, { n: 4 }]],
  ['in arithmetic', (h) => ['Multiply', 2, [h, 'L']], [{ L }]],
];

// prettier-ignore
const TWO_LISTS: [label: string, json: (h: string) => Json, points: Point[]][] = [
  ['of L and M', (h) => [h, 'L', 'M'], [
    { L, M },
    { L: [1, 2, 3], M: [2, 4, 6] },
    { L: [1, 2, 3], M: [6, 4, 2] },
    { L: [1, 2], M: [5, 3] },
    { L: [1e8 + 1, 1e8 + 2, 1e8 + 4], M: [0.5, 0.25, 4] },
    { L: [1e200, 2e200, 4e200], M: [1e-150, 3e-150, 2e-150] },
    // An error of the interpreter, NaN in the compiled code: lists of two
    // lengths, fewer than two pairs.
    { L: [1, 2, 3], M: [1, 2] },
    { L: [1], M: [2] },
    { L: [], M: [] },
  ]],
  // A list of equal elements: 0 for a covariance; for `Correlation` an
  // error of the interpreter, NaN in the compiled code.
  ['of a constant list', (h) => [h, 'L', 'M'], [{ L: [2, 2, 2], M: [1, 5, 3] }]],
  ['of NaN and infinite elements', (h) => [h, 'X', 'Y'], [
    { X: [1, NaN, 3], Y: [1, 2, 4] },
    { X: [1, 2, 3], Y: [1, NaN, 4] },
    { X: [1, Infinity, 3], Y: [1, 2, 4] },
  ]],
  ['of integers', (h) => [h, 'I', 'J'], [{ I: [3, 1, 3, 7], J: [2, 7, 1, 8] }]],
  ['of a list of integers and a list of reals', (h) => [h, 'I', 'L'], [{ I: [3, 1, 3], L: [0.5, 0.25, 4] }]],
  ['of stated lengths', (h) => [h, 'L3', 'M3'], [{ L3: [3, 1, 4], M3: [2, 7, 1] }]],
  ['of a list and a literal list', (h) => [h, 'L3', ['List', 'x', 2, 5]], [{ L3: [3, 1, 4], x: 0.5 }]],
];

const programs = (
  heads: string[],
  cases: [string, (h: string) => Json, Point[]][]
) =>
  heads.flatMap((h) =>
    cases.map(
      ([label, json, points]) => [`${h} ${label}`, json(h), points] as const
    )
  );

describe('IR statistics on JavaScript', () => {
  test('the witnesses of CE-1532', () => {
    expect(js(['Mode', 'L']).run!({ L } as never)).toBe(1);
    expect(js(['Quartiles', 'L']).run!({ L } as never)).toEqual([
      1.5, 3.5, 5.5,
    ]);
    expect(js(['InterquartileRange', 'L']).run!({ L } as never)).toBe(4);
    expect(js(['PopulationCovariance', 'L', 'M']).run!({ L, M } as never)).toBe(
      1.703125
    );
  });

  test.each(programs(UNIVARIATE, ONE_LIST))(
    '%s gives the interpreter value',
    (_label, json, points) => expectInterpreted(json, points)
  );

  test.each(programs(BIVARIATE, TWO_LISTS))(
    '%s gives the interpreter value',
    (_label, json, points) => expectInterpreted(json, points)
  );

  test('Quartiles is a tuple: At reads a quartile', () => {
    expectInterpreted(['At', ['Quartiles', 'L'], 3], [{ L }]);
    expectInterpreted(
      [
        'Subtract',
        ['At', ['Quartiles', 'L'], 3],
        ['At', ['Quartiles', 'L'], 1],
      ],
      [{ L }]
    );
  });

  test('a statistic of constants is computed at compile time', () => {
    const r = js(['Add', 'x', ['Skewness', ['List', 1, 2, 4, 8]]]);
    expect(r.code).not.toContain('skewness');
    expectInterpreted(
      ['Add', 'x', ['Skewness', ['List', 1, 2, 4, 8]]],
      [{ x: 0.5 }]
    );
  });
});

// prettier-ignore
const STATISTIC_DECLINES: [label: string, json: Json, options: object, cause: string][] = [
  ...[...UNIVARIATE, ...BIVARIATE].map((h): [string, Json, object, string] => [
    `${h} on interval-js`,
    BIVARIATE.includes(h) ? [h, 'L3', 'M3'] : [h, 'L3'],
    { to: 'interval-js' },
    `${h} on interval-js`,
  ]),
  ['Mode on GLSL', ['Mode', 'L3'], { to: 'glsl' }, 'the operation mode'],
  ['Quartiles on GLSL', ['Quartiles', 'L3'], { to: 'glsl' }, 'the operation quartile1'],
  ['Skewness on GLSL', ['Skewness', 'L3'], { to: 'glsl' }, 'the operation skewness'],
  ['Kurtosis on GLSL', ['Kurtosis', 'L3'], { to: 'glsl' }, 'the operation kurtosis'],
  ['Covariance on GLSL', ['Covariance', 'L3', 'M3'], { to: 'glsl' }, 'the operation covariance'],
  ['PopulationCovariance on GLSL', ['PopulationCovariance', 'L3', 'M3'], { to: 'glsl' }, 'the operation pcovariance'],
  ['Correlation on GLSL', ['Correlation', 'L3', 'M3'], { to: 'glsl' }, 'the operation correlation'],
  ['Mode of two operands', ['Mode', 'L', 'x'], {}, 'Mode of 2 operands is not supported by the compiler'],
  ['Skewness of a scalar', ['Skewness', 'x'], {}, 'Skewness of other than one list of real numbers'],
  ['Kurtosis of a tuple', ['Kurtosis', 'T'], {}, 'Kurtosis of other than one list of real numbers'],
  ['Mode of complex numbers', ['Mode', ['List', 'z', 1]], {}, 'Mode of other than one list of real numbers'],
  ['Covariance of one list of pairs', ['Covariance', 'PL'], {}, 'Covariance of 1 operands is not supported by the compiler'],
  ['Correlation of a list and a tuple', ['Correlation', 'L2', 'P'], {}, 'Correlation of other than two lists of real numbers'],
  ['Covariance of a tuple and a list', ['Covariance', 'P', 'L2'], {}, 'Covariance of other than two lists of real numbers'],
];

describe('IR statistics: declines', () => {
  test.each(STATISTIC_DECLINES)('%s declines', (_label, json, options, cause) =>
    expect(failure(json, options)).toContain(cause)
  );
});

// prettier-ignore
const BINOMIALS: [label: string, json: (h: string) => Json, points: Point[]][] = [
  ['of a list of integers and an integer', (h) => [h, 'N3', 'k'], [{ N3: [5, 6, 7], k: 2 }, { N3: [-3, 0, 4], k: 3 }, { N3: [5, 6, 7], k: -1 }]],
  ['of an integer and a list', (h) => [h, 'n', ['List', 1, 2, 3]], [{ n: 6 }, { n: 2 }]],
  ['of a list of reals and a real', (h) => [h, 'L3', 'x'], [{ L3: [3, 1, 4], x: 1.5 }, { L3: [2.5, 0.5, 7], x: 2 }]],
  ['of a list of a run-time length', (h) => [h, 'L', 2], [{ L }, { L: [] }]],
  ['of two lists', (h) => [h, 'N3', 'I'], [{ N3: [5, 6, 7], I: [1, 2, 3] }]],
  ['in a sum', (h) => ['Sum', [h, 'N3', 'k']], [{ N3: [5, 6, 7], k: 2 }]],
];

describe('IR Binomial and Choose over a list', () => {
  test.each(programs(['Binomial', 'Choose'], BINOMIALS))(
    '%s gives the interpreter value on JavaScript',
    (_label, json, points) => expectInterpreted(json, points)
  );

  test('the interval mode encloses the JavaScript values', () => {
    const json = ['Binomial', 'N3', 'k'];
    const r = js(json, { to: 'interval-js' }) as unknown as {
      run: (p: Point) => { kind: string; value: { lo: number; hi: number } }[];
    };
    const got = r.run({ N3: [5, 6, 7], k: 2 });
    expect(
      got.map((g) => g.value.lo <= g.value.hi && [g.value.lo, g.value.hi])
    ).toEqual([
      [10, 10],
      [15, 15],
      [21, 21],
    ]);
  });

  test('the bigint mode gives the exact integers', () => {
    const r = js(['Binomial', 'N3', 'k'], { mode: 'bigint' });
    expect(r.run!({ N3: [5n, 70n, 7n], k: 30n } as never)).toEqual([
      0n,
      55347740058143507128n,
      0n,
    ]);
  });

  test('a tuple and lists of two stated lengths decline', () => {
    expect(failure(['Binomial', 'P', 2])).toContain('Binomial of a tuple');
    expect(failure(['Binomial', 'N3', ['List', 1, 2]])).toContain(
      'lists of different lengths'
    );
  });
});

const p12 = { P: [1, 2], Q: [1, 2] };

// prettier-ignore
const EQUALITIES: [label: string, json: (h: string) => Json, points: Point[]][] = [
  ['of two booleans', (h) => [h, 'b', 'c'], [
    { b: true, c: true }, { b: true, c: false }, { b: false, c: true }, { b: false, c: false },
  ]],
  ['of a boolean and itself', (h) => [h, 'b', 'b'], [{ b: true }, { b: false }]],
  ['of a boolean and a comparison', (h) => [h, 'b', ['Less', 'x', 1]], [{ b: true, x: 0 }, { b: true, x: 2 }]],
  ['of a list of booleans and a boolean (threads)', (h) => [h, 'B', 'b'], [{ B: [true, false, true], b: true }, { B: [], b: false }]],
  ['of two lists', (h) => [h, 'L', 'M'], [
    { L: [1, 2, 3], M: [1, 2, 3] },
    { L: [1, 2, 3], M: [1, 2, 4] },
    { L: [1, 2, 3], M: [1, 2] },
    { L: [1, 2], M: [1, 2, 3] },
    { L: [], M: [] },
    { L: [], M: [1] },
    { L: [0], M: [-0] },
  ]],
  ['of a list and itself', (h) => [h, 'L', 'L'], [{ L: [1, 2, 3] }, { L: [] }]],
  ['of lists with a NaN or an infinite element', (h) => [h, 'X', 'Y'], [
    { X: [1, NaN], Y: [1, NaN] },
    { X: [1, NaN], Y: [1, 2] },
    { X: [Infinity, 1], Y: [Infinity, 1] },
    { X: [Infinity, 1], Y: [-Infinity, 1] },
  ]],
  ['of lists of stated lengths', (h) => [h, 'L3', 'M3'], [{ L3: [3, 1, 4], M3: [3, 1, 4] }, { L3: [3, 1, 4], M3: [3, 1, 5] }]],
  ['of lists of two stated lengths', (h) => [h, 'L3', ['List', 'x', 2]], [{ L3: [1, 2, 3], x: 1 }]],
  ['of a list and a literal list', (h) => [h, 'L', ['List', 1, 'x', 3]], [{ L: [1, 2, 3], x: 2 }, { L: [1, 2, 3], x: 5 }, { L: [1, 2], x: 2 }]],
  ['of a list of integers and a list of reals', (h) => [h, 'I', 'L'], [{ I: [1, 2], L: [1, 2] }, { I: [1, 2], L: [1, 2.5] }]],
  ['of a computed list', (h) => [h, ['Multiply', 2, 'L'], 'M'], [{ L: [1, 2, 3], M: [2, 4, 6] }, { L: [1, 2, 3], M: [2, 4, 7] }]],
  ['of two tuples', (h) => [h, 'P', 'Q'], [p12, { P: [1, 2], Q: [1, 3] }, { P: [0, 2], Q: [1, 2] }]],
  ['of a tuple and itself', (h) => [h, 'P', 'P'], [{ P: [1, 2] }]],
  ['of tuples of two lengths', (h) => [h, 'P', 'T'], [{ P: [1, 2], T: [1, 2, 3] }]],
  ['of a tuple and a literal tuple', (h) => [h, 'P', ['Tuple', 'x', 2]], [{ P: [1, 2], x: 1 }, { P: [1, 2], x: 3 }]],
  ['of a computed tuple', (h) => [h, ['Multiply', 2, 'P'], ['Tuple', 2, 4]], [{ P: [1, 2] }, { P: [1, 3] }]],
  ['as a condition', (h) => ['If', [h, 'P', 'Q'], 'x', 0], [{ ...p12, x: 3 }, { P: [1, 2], Q: [2, 2], x: 3 }]],
  ['under And', (h) => ['And', [h, 'L', 'M'], ['Less', 'x', 1]], [{ L: [1], M: [1], x: 0 }, { L: [1], M: [2], x: 0 }]],
];

describe('IR Equal and NotEqual of booleans, lists and tuples', () => {
  test.each(programs(['Equal', 'NotEqual'], EQUALITIES))(
    '%s gives the interpreter value on JavaScript',
    (_label, json, points) => expectInterpreted(json, points)
  );

  test('a chain of booleans is the conjunction of its pairs', () =>
    expectInterpreted(
      ['Equal', 'a', 'b', 'c'],
      [
        { a: true, b: true, c: true },
        { a: false, b: false, c: false },
        { a: true, b: true, c: false },
        { a: false, b: true, c: true },
      ]
    ));

  test('the elements are compared with no tolerance', () => {
    // The interpreter compares two numbers within its tolerance; compiled
    // code compares the doubles (`docs/COMPILATION-MODEL.md`, the
    // compiled-equality ruling).
    const json = ['Equal', ['Multiply', 'x', 'L'], ['List', 0.1, 0.2, 0.3]];
    const p = { x: 0.1, L: [1, 2, 3] };
    expect(interpreted(json, p)).toBe(true);
    expect(js(json).run!(p as never)).toBe(false);
    expect(js(['NotEqual', 'P', 'Q']).run!(p12 as never)).toBe(false);
  });

  test('the bigint mode compares lists of integers, and booleans', () => {
    const r = js(['Equal', 'I', 'J'], { mode: 'bigint' });
    expect(r.run!({ I: [1n, 2n], J: [1n, 2n] } as never)).toBe(true);
    expect(r.run!({ I: [1n, 2n], J: [1n, 3n] } as never)).toBe(false);
    expect(r.run!({ I: [1n], J: [1n, 3n] } as never)).toBe(false);
    const p = js(['NotEqual', 'b', 'c'], { mode: 'bigint' });
    expect(p.run!({ b: true, c: false } as never)).toBe(true);
  });

  test('stated lengths give a conjunction of comparisons, with no loop', () => {
    expect(js(['Equal', 'P', 'Q']).code).toContain(
      '((_.P[0] === _.Q[0]) && (_.P[1] === _.Q[1]))'
    );
    expect(js(['Equal', 'b', 'c']).code).toContain(
      '((_.b && _.c) || ((!_.b) && (!_.c)))'
    );
  });

  test('the interval mode gives the verdict', () => {
    const run = (json: Json, p: object) =>
      (
        js(json, { to: 'interval-js' }) as unknown as {
          run: (p: object) => unknown;
        }
      ).run(p);
    const B = { lo: 1, hi: 3 };
    expect(run(['Equal', 'P', 'Q'], p12)).toBe('true');
    expect(run(['Equal', 'P', 'Q'], { P: [1, 2], Q: [1, 5] })).toBe('false');
    expect(run(['Equal', 'P', 'Q'], { P: [1, B], Q: [1, 2] })).toBe('maybe');
    expect(run(['Equal', 'P', 'Q'], { P: [7, B], Q: [1, 2] })).toBe('false');
    expect(run(['NotEqual', 'P', 'Q'], { P: [7, B], Q: [1, 2] })).toBe('true');
    expect(run(['Equal', 'P', 'T'], { P: [1, 2], T: [1, 2, 3] })).toBe('false');
    expect(run(['Equal', 'L3', 'M3'], { L3: [1, 2, 3], M3: [1, 2, 3] })).toBe(
      'true'
    );
    expect(run(['Equal', 'L', 'M'], { L: [1, 2], M: [1, 2, 3] })).toBe('false');
    expect(run(['Equal', 'L', 'M'], { L: [1, B], M: [1, 2] })).toBe('maybe');
    expect(run(['Equal', 'b', 'c'], { b: 'true', c: 'true' })).toBe('true');
    expect(run(['Equal', 'b', 'c'], { b: 'false', c: 'false' })).toBe('true');
    expect(run(['Equal', 'b', 'c'], { b: 'true', c: 'false' })).toBe('false');
    expect(run(['Equal', 'b', 'c'], { b: 'maybe', c: 'true' })).toBe('maybe');
    expect(run(['NotEqual', 'b', 'c'], { b: 'true', c: 'false' })).toBe('true');
  });

  // prettier-ignore
  test.each([
    ['a tuple and a list', ['Equal', 'P', 'L2'], /Equal of a tuple/, {}],
    ['a tuple and a scalar', ['Equal', 'P', 'x'], /Equal of a tuple/, {}],
    ['two lists of points', ['NotEqual', 'PL', 'PL'], /NotEqual of a tuple/, {}],
    ['two lists of lists', ['Equal', 'G', 'G'], /Equal of a list/, {}],
    ['a list of booleans and a list of numbers', ['Equal', 'B', 'L'], /Equal of a list/, {}],
    ['two lists of booleans', ['Equal', 'B', 'C'], /Equal of a list/, {}],
    ['two lists of booleans of a stated length', ['NotEqual', 'B3', 'C3'], /NotEqual of a list/, {}],
    ['two tuples of booleans', ['Equal', 'PB', 'QB'], /Equal of a tuple/, {}],
    ['lists of complex numbers', ['Equal', ['List', 'z', 1], ['List', 'z', 1]], /Equal of a list/, {}],
    ['a chain of three lists', ['Equal', 'L', 'M', 'L'], /a chain of three or more operands with a list/, {}],
    ['a chain of three tuples', ['Equal', 'P', 'Q', 'P'], /a chain of three or more operands with a list/, {}],
    ['a boolean and a number', ['Equal', 'b', 1], /Equal of boolean, integer/, {}],
    ['a tuple of booleans and a boolean', ['Equal', 'PB', 'b'], /Equal of a tuple/, {}],
    ['lists of a run-time length on GLSL', ['Equal', 'L', 'M'], /run-time length/, { to: 'glsl' }],
  ] as [string, Json, RegExp, object][])('%s declines', (_label, json, cause, options) =>
    expect(failure(json, options)).toMatch(cause)
  );
});

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** A fragment shader whose first channel is the host's function
 *  `float userFn(<inputs>)`, with each input made from `float` uniforms (a
 *  boolean is a uniform that is not 0). */
function shader(r: ReturnType<typeof compile>): string {
  const type = (n: string) => r.freeSymbolTypes![n].lowered!;
  const size = (n: string) =>
    Number(
      /^b?vec(\d)$|\[(\d+)\]$/.exec(type(n))?.find((x, k) => k > 0 && x) ?? 1
    );
  const uniform = (n: string, j: number) =>
    type(n).startsWith('b') ? `(u_${n}_${j} != 0.0)` : `u_${n}_${j}`;
  const value = (n: string) =>
    !/vec|\[/.test(type(n))
      ? uniform(n, 0)
      : `${type(n)}(${Array.from({ length: size(n) }, (_, j) => uniform(n, j)).join(', ')})`;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    ...r.freeSymbols!.flatMap((n) =>
      Array.from({ length: size(n) }, (_, j) => `uniform float u_${n}_${j};`)
    ),
    'out vec4 fragColor;',
    r.preamble ?? '',
    `float userFn(${r.freeSymbols!.map((n) => `${type(n)} ${n}`).join(', ')}) {`,
    body,
    '}',
    'void main() {',
    `  fragColor = vec4(userFn(${r.freeSymbols!.map(value).join(', ')}), 0.0, 0.0, 0.0);`,
    '}',
  ].join('\n');
}

const boole = (json: Json): Json => ['Boole', json];
// Each program is a number: a boolean through `Boole`, a list through `Sum`.
// prettier-ignore
const SHADERS: [label: string, json: Json, points: Point[]][] = [
  ['Equal of two tuples', boole(['Equal', 'P', 'Q']), [p12, { P: [1, 2], Q: [1, 3] }, { P: [0, 2], Q: [1, 2] }]],
  ['NotEqual of two tuples', boole(['NotEqual', 'P', 'Q']), [p12, { P: [1, 2], Q: [1, 3] }]],
  ['Equal of tuples of two lengths', boole(['Equal', 'P', 'T']), [{ P: [1, 2], T: [1, 2, 3] }]],
  ['Equal of two booleans', boole(['Equal', 'b', 'c']), [
    { b: true, c: true }, { b: true, c: false }, { b: false, c: true }, { b: false, c: false },
  ]],
  ['NotEqual of two booleans', boole(['NotEqual', 'b', 'c']), [{ b: true, c: false }, { b: false, c: false }]],
  ['Equal of lists of a stated length', boole(['Equal', 'L3', 'M3']), [{ L3: [3, 1, 4], M3: [3, 1, 4] }, { L3: [3, 1, 4], M3: [3, 1, 5] }]],
  ['Binomial over a list of integers', ['Sum', ['Binomial', 'N3', 'k']], [{ N3: [5, 6, 7], k: 2 }, { N3: [5, 6, 7], k: 0 }]],
  ['Choose of an integer and a list', ['Sum', ['Choose', 'n', ['List', 1, 2, 3]]], [{ n: 6 }]],
];

(chromiumAvailable() ? describe : describe.skip)(
  'IR Equal of tuples and booleans, and Binomial over a list, on GLSL in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('each shader gives the interpreter value', async () => {
      const items = SHADERS.flatMap(([label, json, points]) => {
        const r = js(json, { to: 'glsl' });
        expect(r.success).toBe(true);
        return points.map((p) => ({
          name: `${label} at ${JSON.stringify(p)}`,
          source: shader(r),
          uniforms: Object.fromEntries(
            r.freeSymbols!.flatMap((n) =>
              [p[n]].flat().map((v, j) => [`u_${n}_${j}`, Number(v)])
            )
          ),
          expected: interpreted(json, p),
        }));
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, i) => {
        const { name, expected } = items[i];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        if (!agree(v.value, expected, 1e-5))
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
    }, 60_000);
  }
);
