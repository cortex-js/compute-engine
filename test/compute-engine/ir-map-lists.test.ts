/**
 * `Map` of several lists, `ListFrom` and `Clamp` in the profile `ir` (batch
 * G26; README of `src/compute-engine/compilation/ir/`, "Lists"), and a list
 * of indexes in `At`.
 *
 * The witnesses are the forms of the issues CE-1365 (a selection over lists
 * cut to the shortest list, `ListFrom(Map((a, b) ↦ Which(a < b, b, True,
 * NaN), W, V))`, in place and as a host function) and CE-1366 (the floored
 * index of a list of indexes, `At(L, Clamp(Floor(I), 0, +∞))`). JavaScript
 * agrees with the interpreter within 1e-12; on GLSL the programs run in
 * WebGL2 (the headless Chromium of `scripts/glsl-check/glsl-driver.ts`) and
 * agree with JavaScript within single-float precision; without the browser,
 * those tests are skipped. In the interval mode a box contains the
 * JavaScript value.
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
ce.declare('x', 'real');
ce.declare('n', 'integer');
for (const name of ['A', 'B', 'C', 'D', 'I']) ce.declare(name, 'list<real>');
ce.declare('L', 'list<real^3>');
ce.declare('M', 'list<real^2>');
ce.declare('g', 'function');
ce.assign('g', ce.box(['Function', ['Multiply', 2, 'u'], 'u'] as never));

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

/** The interpreter's value: a tuple or a list is an array. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  // A lazy collection (`Map` of an input).
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
            'List',
            v.map((n) => ce.number(n))
          )
        : ce.number(v),
    ])
  );
  return ce.withValues(values as never, () => read(box(json).evaluate().N()));
}

/** `v` and `w` have one shape and agree within `tolerance` (NaN is NaN). */
function agree(v: unknown, w: unknown, tolerance = 1e-12): boolean {
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

const fn = (body: Json, ...params: string[]) => ['Function', body, ...params];
const add2 = fn(['Add', 'a', 'b'], 'a', 'b');
const add3 = fn(
  ['Add', 'a', ['Multiply', 10, 'b'], ['Multiply', 100, 'c']],
  'a',
  'b',
  'c'
);
const pick = fn(['Which', ['Less', 'a', 'b'], 'b', 'True', 'NaN'], 'a', 'b');
const select = (w: Json, v: Json) => ['ListFrom', ['Map', pick, w, v]];

const LISTS: Point[] = [
  { x: 0.5, A: [1, 2, 3], B: [10, 20, 30], C: [5, 6, 7], D: [0.5, 3] },
  { x: -2, A: [1, 2, 3], B: [10, 20], C: [], D: [4, 1, 7, 0] },
  { x: 3, A: [], B: [10], C: [1, 2, 3, 4], D: [2] },
];

describe('IR profile, batch G26: Map of several lists', () => {
  test('the interpreter: the length of the shortest list', () => {
    expect(
      interpreted(['Map', add2, ['List', 1, 2, 3], ['List', 10, 20]], {})
    ).toEqual([11, 22]);
  });

  // prettier-ignore
  test.each([
    ['two inputs', ['Map', add2, 'A', 'B']],
    ['three inputs', ['Map', add3, 'A', 'B', 'C']],
    ['a library operator by its name', ['Map', 'Add', 'A', 'B']],
    ['a library operator of two operands by its name', ['Map', 'Power', 'A', 'C']],
    ['an input and a literal list', ['Map', add2, 'D', ['List', 'x', 2, 3]]],
    ['a Range and a list', ['Map', add2, ['Range', 1, 5], 'A']],
    ['a Range of a run-time length', ['Map', add2, ['Range', 1, ['Length', 'D']], 'B']],
    ['literal lists of equal lengths', ['Map', add2, ['List', 1, 'x'], ['List', 3, 4]]],
    ['literal lists of different lengths', ['Map', add3, ['List', 1, 'x', 4], ['List', 3, 4], ['List', 5, 6, 7, 8]]],
    ['a callback that reads an outer input', ['Map', fn(['Multiply', 'x', 'a', 'b'], 'a', 'b'), 'A', 'D']],
    ['a callback with a Which', select('D', 'A')],
    ['a nested Map', ['Map', add2, ['Map', fn(['Multiply', 'a', 'b'], 'a', 'b'), 'A', 'B'], 'C']],
    ['a Map inside a callback', ['Map', fn(['Sum', ['Map', add2, 'A', ['List', 'a', 'b']]], 'a', 'b'), 'C', 'D']],
    ['consumed by Sum', ['Sum', ['Map', add2, 'A', 'B']]],
    ['consumed by Length', ['Length', ['Map', add2, 'A', 'C']]],
    ['consumed by At', ['At', ['Map', add2, 'D', 'B'], 1]],
    ['consumed by an element-wise operation', ['Multiply', 2, ['Map', add2, 'A', 'C']]],
    ['consumed by a Map of one list', ['Map', fn(['Square', 'k'], 'k'), ['Map', add2, 'A', 'B']]],
  ])('%s: the interpreter’s values', (_, json) => {
    check(json, LISTS);
  });

  test('a callback with a draw: the interpreter’s draws, element by element', () => {
    // prettier-ignore
    const json = ['WithRandomSeed', 3, ['ListFrom', ['Map', fn(['Add', 'a', 'b', ['Random']], 'a', 'b'), 'A', ['List', 1, 2, 3]]]];
    const r = check(json, LISTS);
    expect((r.run!(LISTS[0] as never) as number[]).length).toBe(3);
  });

  // prettier-ignore
  test.each([
    ['a literal of another arity (an error of the canonical form)', ['Map', fn('a', 'a'), 'A', 'B'], /static type error/],
    ['a scalar source (an error of the interpreter)', ['Map', add2, 'A', 'x'], /static type error/],
    ['a tuple source', ['Map', add2, 'A', ['Tuple', 1, 'x']], /a tuple where a list is read/],
    ['a list with an effect', ['Map', add2, 'A', ['RandomShuffle', 'B']], /Map of a list with an effect/],
  ])('%s declines', (_, json, cause) => {
    expect(failure(() => js(json))).toMatch(cause);
  });

  test('GLSL: lists of stated lengths, the elements written out', () => {
    expect(glsl(['Map', add2, 'L', 'M']).code).toBe(
      'vec2((L[int(0.0)] + M[int(0.0)]), (L[int(1.0)] + M[int(1.0)]))'
    );
    for (const json of GLSL_PROGRAMS.map((p) => p[1]))
      expect(glsl(json)).toMatchObject({ success: true, profile: 'ir' });
    expect(failure(() => glsl(['Map', add2, 'A', 'L']))).toMatch(
      /run-time length/
    );
  });

  test('the interval mode: lists of stated lengths', () => {
    const points = [
      { x: 0.5, L: [1, 2, 3], M: [10, 20] },
      { x: -2, L: [-1, 0.25, 3], M: [4, -5] },
    ];
    // prettier-ignore
    for (const json of [
      ['Map', add2, 'L', 'M'],
      ['Sum', ['Map', fn(['Multiply', 'x', 'a', 'b'], 'a', 'b'), 'L', 'M']],
      select('L', 'M'),
    ]) {
      const r = interval(json);
      expect(r.success).toBe(true);
      for (const p of points)
        expect(contains(r.run!(p as never), js(json).run!(p as never))).toBe(
          true
        );
    }
    // Run-time lengths decline in the mode, as `Zip` does.
    expect(failure(() => interval(['Map', add2, 'A', 'B']))).toMatch(
      /a list whose length is not one number/
    );
  });
});

describe('IR profile, batch G26: ListFrom', () => {
  ce.declare('sq', {
    type: '(list<real>) -> list<real>',
    value: box(fn(['Multiply', 'w', 'w'], 'w')),
  });

  // prettier-ignore
  test.each([
    ['a Range', ['ListFrom', ['Range', 1, 4]]],
    ['a Range of a run-time length', ['ListFrom', ['Range', 1, ['Length', 'A']]]],
    ['a Map', ['ListFrom', ['Map', fn(['Add', 'k', 'x'], 'k'), 'A']]],
    ['a Filter', ['ListFrom', ['Filter', 'D', fn(['Greater', 'k', 1], 'k')]]],
    ['a Zip', ['ListFrom', ['Zip', 'A', 'B']]],
    ['a user function’s result', ['ListFrom', ['sq', 'D']]],
    ['an input', ['ListFrom', 'D']],
    ['a list of points', ['ListFrom', ['List', ['Tuple', 'x', 1], ['Tuple', 2, 3]]]],
  ])('of %s: the list, of the interpreter’s shape', (_, json) => {
    check(json, LISTS);
  });

  test('of a list is the list: the same code', () => {
    expect(js(['ListFrom', 'D']).code).toBe(js('D').code);
    expect(js(['ListFrom', ['Map', add2, 'A', 'B']]).code).toBe(
      js(['Map', add2, 'A', 'B']).code
    );
  });

  test('of a list of colours: the existing compiler’s value', () => {
    const json = ['ListFrom', ['Map', fn(['Hsv', 'k', 1, 1], 'k'), 'A']];
    const point = { A: [10, 200] };
    expect(js(json).run!(point as never)).toEqual(
      compile(box(json)).run!(point as never)
    );
  });

  // prettier-ignore
  test.each([
    ['a scalar (the interpreter: a list of one element)', ['ListFrom', 'x'], /ListFrom of other than one list/],
    ['a tuple (the interpreter: the list of its elements)', ['ListFrom', ['Tuple', 'x', 1]], /ListFrom of other than one list/],
    ['a string (the interpreter: a list of characters)', ['ListFrom', "'ab'"], /not a number, a symbol or a function/],
    ['two lists (the interpreter: their concatenation)', ['ListFrom', 'A', 'B'], /ListFrom of other than one list/],
  ])('of %s declines', (_, json, cause) => {
    expect(failure(() => js(json))).toMatch(cause);
  });
});

describe('IR profile, batch G26: Clamp', () => {
  // prettier-ignore
  const CASES: [string, Json, Point[]][] = [
    ['inside, below and above', ['Clamp', 'x', -1, 2], [{ x: 0.5 }, { x: -3 }, { x: 7 }]],
    ['lo > hi: hi', ['Clamp', 'x', 2, -1], [{ x: 0.5 }, { x: -3 }, { x: 7 }]],
    ['an infinite bound', ['Clamp', 'x', 0, 'PositiveInfinity'], [{ x: 0.5 }, { x: -3 }]],
    ['a bound that is -∞', ['Clamp', 'x', 'NegativeInfinity', 1], [{ x: 0.5 }, { x: 3 }]],
    ['integers', ['Clamp', 'n', 0, 10], [{ n: -4 }, { n: 4 }, { n: 40 }]],
    ['input bounds', ['Clamp', 'x', ['Floor', 'x'], ['Sin', 'x']], [{ x: 0.5 }, { x: -3 }]],
    ['NaN', ['Clamp', 'NaN', 0, 1], [{}]],
    ['a NaN bound', ['Clamp', 'x', 0, 'NaN'], [{ x: 0.5 }]],
    ['a list operand', ['Clamp', 'D', 0, 1], LISTS],
    ['lists of bounds', ['Clamp', 'L', ['List', 0, 1, 2], 'x'], [{ x: 1.5, L: [-1, 3, 1.75] }]],
  ];

  test.each(CASES)('%s: the interpreter’s value', (_, json, points) => {
    check(json, points);
  });

  test('integers stay integers: the bigint mode', () => {
    expect(
      js(['Clamp', 'n', 0, 10], { mode: 'bigint' }).run!({ n: 40n } as never)
    ).toBe(10n);
  });

  test('GLSL: min(max(x, lo), hi), defined for lo > hi', () => {
    expect(glsl(['Clamp', 'x', 2, -1]).code).toBe('min(max(x, 2.0), (-1.0))');
    expect(glsl(['Clamp', 'L', 0, 1]).success).toBe(true);
  });

  test('the interval mode: the box contains the value', () => {
    for (const [, json, points] of CASES.filter(
      ([, j]) =>
        !JSON.stringify(j).includes('NaN') && !JSON.stringify(j).includes('"D"')
    )) {
      const r = interval(json);
      for (const p of points)
        expect(contains(r.run!(p as never), js(json).run!(p as never))).toBe(
          true
        );
    }
  });
});

describe('IR profile, batch G26: the forms of CE-1365 and CE-1366', () => {
  ce.declare('sel', {
    type: '(list<real>, list<real>) -> list<real>',
    value: box(fn(select('w', 'v'), 'w', 'v')),
  });
  ce.declare('dat', { type: 'list<real>', value: box(['List', 10, 20, 30]) });

  test('the selection, cut to the shortest list (CE-1365)', () => {
    const r = check(select('A', 'B'), LISTS);
    expect(r.run!({ A: [0, 2], B: [3, 1, 4] } as never)).toEqual([3, NaN]);
  });

  test('the selection as a host function, called in a chain', () => {
    const json = ['sel', ['sel', 'A', 'B'], 'C'];
    // The interpreter's value with a NaN in the inner result is a type
    // error of the host function's signature (the element type `nan`):
    // the existing compiler's values there.
    const point = { A: [0, 2, 0, 5], B: [3, 1, 4], C: [9, 9] };
    expect(js(json).run!(point as never)).toEqual([9, NaN]);
    expect(js(json).run!(point as never)).toEqual(
      compile(box(json)).run!(point as never)
    );
    check(json, [{ A: [0, 1, 0, 5], B: [3, 4, 4], C: [9, 9] }]);
  });

  test('the floored index of a list of indexes (CE-1366)', () => {
    const json = [
      'At',
      'dat',
      ['Clamp', ['Floor', 'I'], 0, 'PositiveInfinity'],
    ];
    const I = [-1, 0, 0.5, 1, 1.5, 2.9, 3, 4];
    const r = check(json, [{ I }]);
    expect(r.run!({ I } as never)).toEqual([
      NaN,
      NaN,
      NaN,
      10,
      10,
      20,
      30,
      NaN,
    ]);
    const iv = interval(json).run!({ I } as never);
    expect(contains(iv, r.run!({ I } as never))).toBe(true);
  });

  // prettier-ignore
  test.each([
    ['a list of indexes', ['At', 'dat', 'I']],
    ['a literal list of indexes', ['At', 'D', ['List', 1, -1, 0, 2.5, 'x']]],
    ['a Range of indexes', ['At', 'A', ['Range', 1, 2]]],
  ])('At of %s: the interpreter’s values', (_, json) => {
    check(json, [{ I: [1, -1, 0, 2.5, 4], x: 2, D: [5, 6, 7], A: [1, 2, 3] }]);
  });

  test('lists of stated lengths: GLSL and the interval mode', () => {
    const forms = [
      select('L', 'M'),
      ['At', 'dat', ['Clamp', ['Floor', 'L'], 0, 'PositiveInfinity']],
    ];
    const point = { L: [1.5, 0.5, 4], M: [3, 0.25] };
    for (const json of forms) {
      expect(glsl(json)).toMatchObject({ success: true, profile: 'ir' });
      const want = js(json).run!(point as never);
      expect(contains(interval(json).run!(point as never), want)).toBe(true);
    }
  });

  test('At of a list of indexes into a list of points or of booleans declines', () => {
    expect(failure(() => js(['At', ['List', ['Tuple', 1, 2]], 'I']))).toMatch(
      /a list where a scalar is required/
    );
  });

  test('a boolean mask as the index is a filter (batch G29, ir-at-mask.test.ts)', () => {
    const engine = new ComputeEngine();
    engine.declare('A', 'list<real>');
    engine.declare('M', 'list<boolean>');
    const point = { A: [10, 20, 30], M: [true, false, true] };
    expect(
      compile(engine.box(['At', 'A', 'M'] as never), IR).run!(point as never)
    ).toEqual([10, 30]);
    expect(
      compile(engine.box(['At', 'A', ['Greater', 'A', 15]] as never), IR).run!(
        point as never
      )
    ).toEqual([20, 30]);
  });

  test('a callback that names a parameter twice declines', () => {
    // The interpreter binds the first: `[2, 4, 6]`; the later name would
    // give `[20, 40, 60]`.
    for (const f of [
      fn(['Add', 'a', 'a'], 'a', 'a'),
      fn(['Add', 'a', 'b'], 'a', 'b', 'a'),
    ])
      expect(
        failure(() =>
          js(['ListFrom', ['Map', f, 'A', 'B', ...(f.length > 4 ? ['A'] : [])]])
        )
      ).toMatch(/parameters of distinct names/);
  });
});

describe('IR profile, batch G26: robustness', () => {
  test('a Map of 8 lists', () => {
    const names = Array.from({ length: 8 }, (_, i) => `p${i}`);
    const json = [
      'Map',
      fn(['Add', ...names], ...names),
      'A',
      'B',
      'C',
      'D',
      'A',
      'B',
      'C',
      'D',
    ];
    check(json, LISTS);
  });

  test('a chain of 10 selections', () => {
    let json: Json = 'A';
    for (let i = 0; i < 10; i++) json = select(json, i % 2 ? 'B' : 'D');
    check(json, [{ A: [0, 1, 0, 5], B: [3, 4, 4], D: [9, 9, 9, 9] }]);
    expect(js(json).code.length).toBeLessThan(20_000);
  });
});

//
// WebGL2
//

// prettier-ignore
const GLSL_PROGRAMS: [string, Json][] = [
  ['the Sum of a Map of two lists', ['Sum', ['Map', fn(['Multiply', 'x', 'a', 'b'], 'a', 'b'), 'L', 'M']]],
  ['the selection', ['Sum', ['Map', fn(['Which', ['Less', 'a', 'b'], 'b', 'True', 0], 'a', 'b'), 'L', ['List', 'x', 1, 2]]]],
  ['a Clamp of a list', ['At', ['Clamp', 'L', 0, 'x'], 2]],
  ['the floored index of a list of indexes', ['At', ['At', ['List', 10, 20, 30], ['Clamp', ['Floor', 'L'], 0, 'PositiveInfinity']], 3]],
];

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, batch G26: Map of several lists and Clamp in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    const POINTS = [
      { x: 0.5, L: [1, 2, 3], M: [10, 20] },
      { x: 1.5, L: [-1, 0.25, 3], M: [4, -5] },
      { x: 2.5, L: [3, 0.5, 1], M: [0.5, 2] },
    ];

    test.each(GLSL_PROGRAMS)(
      '%s agrees with JavaScript',
      async (_, json) => {
        const r = glsl(json);
        const f = js(json);
        const source = (body: string) =>
          [
            '#version 300 es',
            'precision highp float;',
            'uniform float u_x;',
            'uniform float u_L[3];',
            'uniform float u_M[2];',
            'out vec4 fragColor;',
            r.preamble ?? '',
            'float userFn(float x, vec3 L, vec2 M) {',
            r.code.includes(';') ? body : `return ${body};`,
            '}',
            'void main() { fragColor = vec4(userFn(u_x, vec3(u_L[0], u_L[1], u_L[2]), vec2(u_M[0], u_M[1])), 0.0, 0.0, 0.0); }',
          ].join('\n');
        const items = POINTS.map((p) => ({
          name: JSON.stringify(p),
          source: source(r.code),
          uniforms: { u_x: p.x, u_L: p.L, u_M: p.M } as Record<
            string,
            number | number[]
          >,
          expected: f.run!(p as never) as number,
        }));
        const values = await driver.evaluate(items);
        for (const [i, v] of values.entries()) {
          if (!v.ok) throw new Error(v.log);
          expect(agree(v.value, items[i].expected, 1e-6)).toBe(true);
        }
      },
      120_000
    );
  }
);
