/**
 * A `Sum` or a `Product` with `Limits` whose term is a list, in the profile
 * `ir` (CE-1470; README of `src/compute-engine/compilation/ir/`, "Lists"):
 * the interpreter adds (multiplies) the terms element by element.
 *
 * The witnesses are the Tycho forms of CE-1470: a count per element of a
 * list, `Sum(Which(C = U[i], i, True, 0), Limits(i, 1, 20))`, and a sum of
 * an operation of a list, `Sum(2 Mod(10000 Sin(10000 (X + i)), 1) - 1,
 * Limits(i, 1, 40))`. JavaScript agrees with the interpreter; in the
 * interval mode a box contains the JavaScript value; GLSL compiles a list
 * of a stated length, whose value in WebGL2 agrees with JavaScript, and
 * declines a run-time length.
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
/** A value of an input; an array of arrays is a list of tuples. */
type Point = Record<string, number | number[] | number[][]>;

const ce = new ComputeEngine();
for (const name of ['C', 'U', 'A', 'X'])
  ce.declare(name, 'list<nan | real | signed_infinity>');
ce.declare('L', 'list<real^2>');
ce.declare('P', 'list<tuple<real, real>>');
ce.declare('N', 'real');
ce.declare('u', 'real');

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options });
const glsl = (json: Json) => compile(box(json), { ...IR, to: 'glsl' });
const interval = (json: Json) =>
  compile(box(json), { ...IR, to: 'interval-js' });

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

/** The interpreter's value: a list is an array. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  throw new Error(`no value: ${e.toString()}`);
}

function interpreted(json: Json, point: Point): unknown {
  const element = (x: number | number[]): Expression =>
    Array.isArray(x)
      ? ce.function(
          'Tuple',
          x.map((n) => ce.number(n))
        )
      : ce.number(x);
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? ce.function(
            'List',
            v.map((x) => element(x))
          )
        : ce.number(v),
    ])
  );
  return ce.withValues(values as never, () => read(box(json).evaluate().N()));
}

/** `v` and `w` have one shape and agree within `tolerance` (NaN is NaN). */
function agree(v: unknown, w: unknown, tolerance = 1e-9): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x, tolerance))
    );
  if (typeof w === 'number' && Number.isNaN(w))
    return typeof v === 'number' && Number.isNaN(v);
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    Math.abs(v - w) <= tolerance * Math.max(1, Math.abs(w))
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

type Box = { kind: string; value?: { lo: number; hi: number } };
/** The boxes of the interval mode contain the JavaScript values. */
function contains(got: unknown, want: unknown): boolean {
  if (Array.isArray(want))
    return (
      Array.isArray(got) &&
      got.length === want.length &&
      want.every((w, i) => contains(got[i], w))
    );
  const b = got as Box;
  if (typeof want === 'number' && Number.isNaN(want)) return true;
  return (
    b.kind === 'interval' &&
    b.value!.lo <= (want as number) &&
    (want as number) <= b.value!.hi
  );
}

const sum = (term: Json, lo: Json, hi: Json, index = 'i') => [
  'Sum',
  term,
  ['Limits', index, lo, hi],
];
const product = (term: Json, lo: Json, hi: Json) => [
  'Product',
  term,
  ['Limits', 'i', lo, hi],
];

/** A count per element of a list (the first witness of CE-1470). */
const COUNT = sum(
  ['Which', ['Equal', 'C', ['At', 'U', 'i']], 'i', 'True', 0],
  1,
  20
);
/** A sum of an operation of a list (the third witness of CE-1470). */
const NOISE = sum(
  [
    'Subtract',
    [
      'Multiply',
      2,
      [
        'Mod',
        ['Multiply', 10000, ['Sin', ['Multiply', 10000, ['Add', 'X', 'i']]]],
        1,
      ],
    ],
    1,
  ],
  1,
  40
);

const U = [3, 2, 1, 1, 2, 3, 5, 3, 4, 2, 1, 1, 1, 1, 1, 1, 1, 2, 2, 3];

describe('IR profile: a Sum or a Product of list terms (CE-1470)', () => {
  test('the interpreter adds the terms element by element', () => {
    expect(interpreted(COUNT, { C: [1, 2, 3], U })).toEqual([105, 54, 35]);
    expect(
      interpreted(sum(['Add', 'X', 'i'], 1, 3), { X: [0.25, 0.5] })
    ).toEqual([6.75, 7.5]);
  });

  test('a count per element of a list: the interpreter’s value', () => {
    const r = check(COUNT, [
      { C: [1, 2, 3], U },
      { C: [5, 7], U },
      { C: [], U },
    ]);
    expect(r.run!({ C: [1, 2, 3], U } as never)).toEqual([105, 54, 35]);
  });

  test('a sum of an operation of a list: the interpreter’s value', () => {
    check(NOISE, [{ X: [0.1, 0.2, 0.3] }, { X: [-4.5] }, { X: [] }]);
  });

  // prettier-ignore
  test.each([
    ['a sum written out', sum(['Add', 'X', 'i'], 1, 3)],
    ['a product written out', product(['Add', 'X', 'i'], 1, 3)],
    ['a sum in a loop (200 terms)', sum(['Multiply', 'X', ['Sin', 'i']], 1, 200)],
    ['a product in a loop (200 terms)', product(['Add', 1, ['Divide', 'X', ['Square', 'i']]], 1, 200)],
    ['a term that adds a scalar', sum(['Add', ['Multiply', 'X', 'i'], ['Sum', 'X']], 1, 4)],
    ['a nested sum', sum(sum(['Multiply', 'X', 'i', 'j'], 1, 3, 'j'), 1, 3)],
    ['a list of a stated length over run-time bounds', sum(['Add', 'L', 'i'], 1, 'N')],
    ['a product of a stated length over run-time bounds', product(['Add', 'L', 'i'], 1, 'N')],
  ])('%s: the interpreter’s value', (_, json) => {
    check(json, [
      { X: [0.25, 0.5], L: [0.25, 0.5], N: 3 },
      { X: [-1, 2, 7.5], L: [-1, 2], N: 1 },
      { X: [], L: [3, 4], N: 0 },
      { X: [1], L: [3, 4], N: -2.5 },
    ]);
  });

  // `Length` is never negative, so a range from 0 (or below) to a length
  // holds a term (CE-1567).
  // prettier-ignore
  test.each([
    ['from 0 to a length', sum(['Multiply', 'i', 'X'], 0, ['Length', 'X'])],
    ['from -2 to a length', sum(['Add', 'X', 'i'], -2, ['Length', 'U'])],
    ['from 0 to a length plus 1', sum(['Multiply', 'i', 'X'], 0, ['Add', ['Length', 'X'], 1])],
    ['a product from 0 to a length', product(['Add', 'X', 'i'], 0, ['Length', 'X'])],
  ])('a range from at most 0 to a length, %s: the interpreter’s value', (_, json) => {
    check(json, [
      { X: [1, 2], U: [5] },
      { X: [-0.5, 2, 7.5], U: [] },
      { X: [], U: [1, 2, 3] },
    ]);
  });

  // A term that is a tuple or a list of tuples: the interpreter adds the
  // tuples element by element (CE-1568). The first case is the Tycho
  // spline of CE-1568: each term picks the points of `P` in turn.
  // prettier-ignore
  test.each([
    ['the spline of CE-1568', sum(['Multiply', ['At', 'P', ['Add', ['Mod', ['Add', 'i', ['Range', 0, 1]], 2], 1]], 'i'], 1, 4)],
    ['a tuple written out', sum(['Multiply', 'i', ['At', 'P', 'i']], 1, 2)],
    ['a tuple in a loop (200 terms)', sum(['Multiply', ['Sin', 'i'], ['At', 'P', 1]], 1, 200)],
    ['a tuple literal in a loop (200 terms)', sum(['Tuple', 'i', 'N'], 1, 200)],
    ['a list of tuples written out', sum(['Multiply', 'i', 'P'], 1, 3)],
    ['a list of tuples in a loop (200 terms)', sum(['Add', 'P', ['At', 'P', 1]], 1, 200)],
    ['a list of tuples from 0 to a length', sum(['Multiply', 'i', 'P'], 0, ['Length', 'P'])],
  ])('%s: the interpreter’s value', (_, json) => {
    check(json, [
      { P: [[1, 2], [3, 4]], N: 3 },
      { P: [[-0.5, 7.25], [2, 0], [1e3, -4]], N: -1 },
    ]);
  });

  test('past the iteration budget: a tuple of NaN, a list of tuples of NaN', () => {
    const options = { iterationBudget: 10 };
    const P = [[1, 2], [3, 4]];
    const point = js(sum(['Multiply', 'i', ['At', 'P', 1]], 1, 400), options);
    expect(point.run!({ P } as never)).toEqual([NaN, NaN]);
    const points = js(sum(['Multiply', 'i', 'P'], 1, 400), options);
    expect(points.run!({ P } as never)).toEqual([[NaN, NaN], [NaN, NaN]]);
  });

  test('over a range with no term: the list of the identity of a stated length', () => {
    expect(
      js(sum(['Add', 'L', 'i'], 1, 'N')).run!({ L: [1, 2], N: 0 } as never)
    ).toEqual([0, 0]);
    expect(
      js(product(['Add', 'L', 'i'], 1, 'N')).run!({ L: [1, 2], N: 0 } as never)
    ).toEqual([1, 1]);
  });

  test('past the iterationBudget: a list of NaN', () => {
    const r = js(sum(['Add', 'L', 'i'], 1, 'N'), { iterationBudget: 10 });
    expect(r.run!({ L: [1, 2], N: 5 } as never)).toEqual([20, 25]);
    expect(r.run!({ L: [1, 2], N: 50 } as never)).toEqual([NaN, NaN]);
  });

  // prettier-ignore
  test.each([
    // At N = 0 the interpreter gives the number 0, a list otherwise.
    ['a list of no stated length over run-time bounds', sum(['Add', 'X', 'i'], 1, 'N'), /over a range that can be empty/],
    ['the second witness of CE-1470', sum(['Which', ['Equal', ['Range', 1, 'u'], ['At', 'A', 'j']], 1, 'True', 0], 1, 'N', 'j'), /computed in each term|over a range that can be empty/],
    ['the corpus case of COMPILATION-MODEL.md, R3', sum(['Which', ['Equal', 'C', ['At', 'U', 'i']], 'i', 'True', 0], 1, ['Length', 'U']), /over a range that can be empty/],
    ['a range with no term', sum(['Add', 'X', 'i'], 3, 1), /over a range that can be empty/],
    // At Length(X) = 0 the range from 1 has no term.
    ['a range from 1 to a length', sum(['Multiply', 'i', 'X'], 1, ['Length', 'X']), /over a range that can be empty/],
    // The accumulator has one length.
    ['a length computed in each term', sum(['Range', 1, 'i'], 1, 200), /computed in each term/],
    // At N = 0 the interpreter gives the number 0, a tuple otherwise.
    ['a tuple over run-time bounds', sum(['Multiply', 'i', ['At', 'P', 1]], 1, 'N'), /over a range that can be empty/],
    ['a list of tuples over run-time bounds', sum(['Multiply', 'i', 'P'], 1, 'N'), /run-time length|over a range that can be empty/],
    // A product of two tuples is not element by element.
    ['a product of tuples', product(['Multiply', 'i', ['At', 'P', 1]], 1, 3), /Multiply of a tuple/],
  ])('%s declines', (_, json, cause) => {
    expect(failure(() => js(json))).toMatch(cause);
  });

  test('the interval mode: the box contains the JavaScript value', () => {
    // prettier-ignore
    const cases: [Json, Point[]][] = [
      [sum(['Add', 'X', 'i'], 1, 3), [{ X: [0.25, 0.5] }, { X: [-3] }]],
      [sum(['Multiply', 'X', ['Sin', 'i']], 1, 200), [{ X: [0.25, 0.5] }]],
      [NOISE, [{ X: [0.1, 0.2, 0.3] }]],
      [sum(['Add', 'L', 'i'], 1, 'N'), [{ L: [0.25, 0.5], N: 3 }, { L: [1, 2], N: 0 }]],
      [product(['Add', 'L', 'i'], 1, 'N'), [{ L: [0.25, 0.5], N: 3 }]],
    ];
    for (const [json, points] of cases) {
      const r = interval(json);
      expect(r.success).toBe(true);
      for (const p of points)
        expect(contains(r.run!(p as never), js(json).run!(p as never))).toBe(
          true
        );
    }
    // A selection at each position declines in the mode, as elsewhere.
    expect(failure(() => interval(COUNT))).toMatch(
      /a selection at each position in the interval mode/
    );
  });

  test('GLSL: a list of a stated length compiles, a run-time length declines', () => {
    for (const json of [
      sum(['Add', 'L', 'i'], 1, 'N'),
      sum(['Add', 'L', 'i'], 1, 20),
      product(['Add', 'L', 'i'], 1, 'N'),
    ])
      expect(glsl(json)).toMatchObject({ success: true, profile: 'ir' });
    expect(failure(() => glsl(NOISE))).toMatch(/run-time length/);
  });
});

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

// An element of the list sum, so that the shader writes one float: the
// loop that carries a `vec2` accumulator runs in WebGL2 (the headless
// Chromium of `scripts/glsl-check/glsl-driver.ts`) and agrees with
// JavaScript within single-float precision. Without the browser, skipped.
(chromiumAvailable() ? describe : describe.skip)(
  'IR profile: a Sum or a Product of list terms in WebGL2 (CE-1470)',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    // prettier-ignore
    const PROGRAMS: [string, Json][] = [
      ['a sum over run-time bounds, element 1', ['At', sum(['Add', 'L', 'i'], 1, 'N'), 1]],
      ['a sum over run-time bounds, element 2', ['At', sum(['Divide', 'L', 'i'], 1, 'N'), 2]],
      ['a product over run-time bounds', ['At', product(['Add', 1, ['Divide', 'L', 'i']], 1, 'N'), 2]],
      ['a sum of constant bounds', ['At', sum(['Add', 'L', ['Sqrt', 'i']], 0, 6), 1]],
    ];
    // No `Sin` or `Cos` in the terms: WebGL's `sin` is accurate to about
    // 1e-4 only, which would test the GPU, not the loop.
    const POINTS = [
      { L: [0.25, 0.5], N: 3 },
      { L: [-1, 2], N: 0 },
      { L: [3, -0.75], N: 7.5 },
    ];

    test.each(PROGRAMS)(
      '%s agrees with JavaScript',
      async (_, json) => {
        const r = glsl(json);
        expect(r).toMatchObject({ success: true, profile: 'ir' });
        const f = js(json);
        const source = [
          '#version 300 es',
          'precision highp float;',
          'uniform float u_N;',
          'uniform float u_L[2];',
          'out vec4 fragColor;',
          r.preamble ?? '',
          'float userFn(float N, vec2 L) {',
          r.code.includes(';') ? r.code : `return ${r.code};`,
          '}',
          'void main() { fragColor = vec4(userFn(u_N, vec2(u_L[0], u_L[1])), 0.0, 0.0, 0.0); }',
        ].join('\n');
        const items = POINTS.map((p) => ({
          name: JSON.stringify(p),
          source,
          uniforms: { u_N: p.N, u_L: p.L },
          expected: f.run!(p as never) as number,
        }));
        const values = await driver.evaluate(items);
        for (const [i, v] of values.entries()) {
          if (!v.ok) throw new Error(v.log);
          expect(agree(v.value, items[i].expected, 1e-5)).toBe(true);
        }
      },
      120_000
    );
  }
);
