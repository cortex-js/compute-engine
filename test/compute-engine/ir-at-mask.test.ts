/**
 * A boolean mask as the index of `At` (batch G29; README of
 * `src/compute-engine/compilation/ir/`, "Lists"): `At(L, M)` is the list of
 * the elements `L[k]` for `k` from 1 to the shorter of the two lengths at
 * which `M[k]` is `True`. The same rule in the interpreter, in the existing
 * JavaScript compiler (`_SYS.at`) and in the profile `ir`, where it is a
 * `filter` region over the `Min` of the lengths. A `Missing` or `NaN` member
 * of a mask keeps nothing. `Equal` and `NotEqual` of a list and a scalar,
 * and `And`, `Or` and `Not` of lists, thread in the profile, as in the
 * interpreter, so that `L[K = 1]` compiles. JavaScript agrees with the
 * interpreter and with the existing compiler; in the interval mode a box
 * contains the JavaScript value; GLSL, which has no list of a run-time
 * length, declines.
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
type Point = Record<string, unknown>;

const ce = new ComputeEngine();
ce.declare('x', 'real');
for (const name of ['A', 'K']) ce.declare(name, 'list<real>');
ce.declare('N', 'list<integer>');
for (const name of ['M', 'W']) ce.declare(name, 'list<boolean>');
ce.declare('P', 'list<tuple<real, real>>');
ce.declare('L3', 'list<real^3>');
ce.declare('U', 'list<boolean> | list<real>');
ce.declare('X', 'list');
// A parameter of a user function is a list of numbers (a list of booleans
// declines), so the mask is made in the body.
ce.declare('sel', {
  type: '(list<real>, real) -> list<real>',
  value: ce.box([
    'Function',
    ['At', 'u', ['Greater', 'u', 'c']],
    'u',
    'c',
  ] as never),
});

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json) => compile(box(json), IR);
const existing = (json: Json) => compile(box(json));
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
  if (isSymbol(e, 'True')) return true;
  if (isSymbol(e, 'False')) return false;
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  // A lazy collection (`Map` of an input).
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  throw new Error(`no value: ${e.toString()}`);
}

/** An input value as MathJSON: `P` holds points. */
function literal(name: string, v: unknown): Json {
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (!Array.isArray(v)) return v;
  if (name === 'P') return ['List', ...v.map((p) => ['Tuple', ...p])];
  return ['List', ...v.map((w) => literal(name, w))];
}

function interpreted(json: Json, point: Point): unknown {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, box(literal(k, v))])
  );
  return ce.withValues(values as never, () => read(box(json).evaluate().N()));
}

/** `v` and `w` have one shape and agree within 1e-12 (NaN is NaN). */
function agree(v: unknown, w: unknown): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x))
    );
  if (typeof w === 'number' && Number.isNaN(w))
    return typeof v === 'number' && Number.isNaN(v);
  if (typeof w === 'boolean') return v === w;
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    Math.abs(v - w) <= 1e-12 * Math.max(1, Math.abs(w))
  );
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

const gt = (a: Json, b: Json) => ['Greater', a, b];
const fn = (body: Json, ...params: string[]) => ['Function', body, ...params];

// A mask shorter than the base, equal, longer, empty, all false.
const POINTS: Point[] = [
  {
    x: 2,
    A: [1, 2, 3, 4, 5],
    K: [1, 0, 1],
    N: [1, 2, 3],
    M: [true, false, true],
    W: [false, true, true, true, true, true, true],
    P: [
      [1, 2],
      [3, 4],
      [5, 6],
    ],
    L3: [7, 8, 9],
  },
  {
    x: 0.5,
    A: [1, 2, 3],
    K: [1, 0, 1, 1, 0, 1, 1],
    N: [4, 5, 6, 7, 8],
    M: [true, true, false],
    W: [true, false],
    P: [[1, 2]],
    L3: [-1, 0.25, 3],
  },
  {
    x: -1,
    A: [0.5, -3],
    K: [],
    N: [],
    M: [],
    W: [false, false, false],
    P: [],
    L3: [1, 2, 3],
  },
  {
    x: 9,
    A: [],
    K: [2],
    N: [-1],
    M: [false, false],
    W: [true],
    P: [
      [0, 0],
      [1, 1],
    ],
    L3: [0, 0, 0],
  },
];

// prettier-ignore
const PROGRAMS: [string, Json][] = [
  ['a mask that is an input', ['At', 'A', 'M']],
  ['a mask longer than the base', ['At', 'A', 'W']],
  ['a comparison of the base with a number', ['At', 'A', gt('A', 2)]],
  ['a comparison of another list', ['At', 'A', gt('K', 0)]],
  ['a comparison of another list, the other way', ['At', 'K', gt('A', 'x')]],
  ['a mask from a Map', ['At', 'A', ['Map', fn(gt('k', 0), 'k'), 'K']]],
  ['a literal mask', ['At', 'A', ['List', 'True', 'False', 'True', 'True']]],
  ['an all-false literal mask', ['At', 'A', ['List', 'False', 'False']]],
  ['a literal base', ['At', ['List', 'x', 2, 3, 4], 'W']],
  ['a Range base', ['At', ['Range', 1, 10], 'M']],
  ['a Range base of a run-time length', ['At', ['Range', 1, ['Length', 'A']], 'W']],
  ['a list of integers', ['At', 'N', 'W']],
  ['a list of points', ['At', 'P', 'W']],
  ['a list of points by a coordinate', ['At', 'P', gt(['PointX', 'P'], 2)]],
  ['a list of a stated length', ['At', 'L3', gt('L3', 'x')]],
  ['consumed by Sum', ['Sum', ['At', 'A', 'M']]],
  ['consumed by Length', ['Length', ['At', 'A', 'W']]],
  ['consumed by an element-wise operation', ['Add', 1, ['Multiply', 2, ['At', 'A', 'M']]]],
  ['consumed by another mask', ['At', ['At', 'A', 'W'], 'M']],
  ['consumed by At', ['At', ['At', 'A', gt('A', 0)], 1]],
  ['consumed by a Map', ['Map', fn(['Square', 'k'], 'k'), ['At', 'A', 'W']]],
  ['inside a user function', ['Sum', ['sel', 'A', 'x']]],
  ['inside a user function called twice', ['Add', ['Length', ['sel', 'A', 'x']], ['Sum', ['sel', 'K', 0]]]],
  ['inside a Sum body', ['Sum', ['Sum', ['At', 'A', gt('A', 'k')]], ['Limits', 'k', 1, 3]]],
  ['a list of numbers is a gather (batch G26)', ['At', ['List', 10, 20, 30], ['List', 1, -1, 0]]],
  ['a list of 0 and 1 is not a mask', ['At', 'A', ['List', 1, 0, 1]]],
  // Round 2: the comparisons and the boolean operators that make a mask.
  ['the host’s ground truth L[K = 1]', ['At', 'A', ['Equal', 'K', 1]]],
  ['a scalar = a list', ['At', 'A', ['Equal', 1, 'K']]],
  ['a list = an input', ['At', 'A', ['Equal', 'K', 'x']]],
  ['a NotEqual', ['At', 'A', ['NotEqual', 'K', 0]]],
  ['a list = NaN (all false)', ['At', 'A', ['Equal', 'K', 'NaN']]],
  ['a Not of a mask', ['At', 'A', ['Not', 'M']]],
  ['an And of two comparisons', ['At', 'A', ['And', gt('A', 1), ['Less', 'A', 5]]]],
  ['an Or with a Not', ['At', 'A', ['Or', gt('A', 3), ['Not', gt('A', 1)]]]],
  ['an And of a mask and a scalar', ['At', 'A', ['And', 'M', gt('x', 0)]]],
  ['an And of a scalar and a mask', ['At', 'A', ['And', gt('x', 0), 'M']]],
  ['an Or of three', ['At', 'A', ['Or', ['Equal', 'A', 1], ['Equal', 'A', 3], ['Equal', 'A', 'x']]]],
];

// The lists of booleans themselves (not a mask index).
// prettier-ignore
const BOOLEANS: [string, Json][] = [
  ['Equal of a list and a number', ['Equal', 'K', 1]],
  ['Equal of a number and a list', ['Equal', 1, 'K']],
  ['NotEqual of a number and a list', ['NotEqual', 'x', 'K']],
  ['Not of a list', ['Not', 'M']],
  ['And of a list and a scalar', ['And', 'False', 'M']],
  ['Or of a list and a scalar', ['Or', 'M', 'True']],
  ['a Filter by Equal', ['Filter', 'K', fn(['Equal', 'k', 1], 'k')]],
];

describe('IR profile, batch G29: the interpreter', () => {
  const L = ['List', 1, 2, 3, 4, 5];
  test('the host’s ground truth: L[K = 1] of L = [1..5], K = [1, 0, 1]', () => {
    expect(interpreted(['At', L, ['Equal', ['List', 1, 0, 1], 1]], {})).toEqual(
      [1, 3]
    );
  });

  // prettier-ignore
  test.each([
    ['shorter', ['True', 'False', 'True'], [1, 3]],
    ['equal', ['True', 'False', 'True', 'False', 'True'], [1, 3, 5]],
    ['longer', ['False', 'True', 'False', 'False', 'True', 'True', 'True'], [2, 5]],
    ['all false', ['False', 'False'], []],
  ])('a mask %s than the list', (_, mask, want) => {
    expect(interpreted(['At', L, ['List', ...mask]], {})).toEqual(want);
  });

  test('a list of points: the kept points unchanged', () => {
    const points = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];
    expect(
      interpreted(['At', points, ['List', 'False', 'True', 'True']], {})
    ).toEqual([[3, 4]]);
  });

  test('a lazy base is read up to the mask’s length', () => {
    for (const base of [
      ['Range', 1, 1e9],
      ['Range', 1, 'PositiveInfinity'],
    ])
      expect(
        interpreted(['At', base, ['List', 'True', 'False', 'True']], {})
      ).toEqual([1, 3]);
  });

  test('a Missing or NaN member keeps nothing, as False', () => {
    for (const m of ['Missing', 'NaN'])
      expect(interpreted(['At', L, ['List', 'True', m, 'True']], {})).toEqual([
        1, 3,
      ]);
    // A mask whose undefined members come from a Which with no default.
    const which = ['Map', fn(['Which', gt('k', 2), 'True'], 'k'), L];
    expect(box(which).evaluate().toString()).toBe(
      '["Missing","Missing","True","True","True"]'
    );
    expect(interpreted(['At', L, which], {})).toEqual([3, 4, 5]);
  });

  test('a comparison with NaN or Missing is False, not an undefined member', () => {
    for (const m of ['NaN', 'Missing']) {
      expect(
        box(gt(['List', 1, m, 3], 0))
          .evaluate()
          .toString()
      ).toBe('["True","False","True"]');
      expect(
        box(['Equal', ['List', 1, m, 3], 1])
          .evaluate()
          .toString()
      ).toBe('["True","False","False"]');
    }
  });

  test('undefined members only: a gather (an absence marker per entry)', () => {
    expect(interpreted(['At', L, ['List', 'Missing', 'NaN']], {})).toEqual([
      NaN,
      NaN,
    ]);
  });

  test('another member (a number): not a mask, At stays unevaluated', () => {
    const e = box(['At', L, ['List', 'True', 2]]).evaluate();
    expect(e.operator).toBe('At');
  });

  test('Equal of a list and a number threads; of two lists it compares', () => {
    expect(
      box(['Equal', ['List', 1, 0, 1], 1])
        .evaluate()
        .toString()
    ).toBe('["True","False","True"]');
    expect(
      box(['Equal', 1, ['List', 1, 0, 1]])
        .evaluate()
        .toString()
    ).toBe('["True","False","True"]');
    expect(
      box(['Equal', ['List', 1, 0, 1], ['List', 1, 0, 1]]).evaluate().symbol
    ).toBe('True');
  });

  test('And, Or and Not of lists thread, with a scalar broadcast', () => {
    const TF = ['List', 'True', 'False'];
    expect(
      box(['And', TF, ['List', 'True', 'True']])
        .evaluate()
        .toString()
    ).toBe('["True","False"]');
    expect(box(['And', 'False', TF]).evaluate().toString()).toBe(
      '["False","False"]'
    );
    expect(box(['Not', TF]).evaluate().toString()).toBe('["False","True"]');
    expect(
      box(['And', ['List', 'True', 'False', 'True'], TF]).evaluate().operator
    ).toBe('Error');
  });

  test('the result type: a list of the element type, with no stated length', () => {
    const e = box(['At', 'A', 'M']);
    expect(e.type.toString()).toBe('list<real>');
    expect(e.count).toBeUndefined();
  });
});

describe('IR profile, batch G29: JavaScript', () => {
  test.each(PROGRAMS)(
    '%s: the interpreter’s and the existing compiler’s values',
    (_, json) => {
      const r = js(json);
      expect(r).toMatchObject({ success: true, profile: 'ir' });
      const old = existing(json);
      for (const p of POINTS) {
        const got = r.run!(p as never);
        const want = interpreted(json, p);
        if (!agree(got, want) || !agree(old.run!(p as never), want))
          throw new Error(
            `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${JSON.stringify(got)}, the existing compiler ${JSON.stringify(old.run!(p as never))}, the interpreter ${JSON.stringify(want)}`
          );
      }
    }
  );

  test('the elements of the base are integers: the result’s lane', () => {
    expect(
      js(['At', 'N', 'W']).run!({ N: [4, 5, 6], W: [false, true] } as never)
    ).toEqual([5]);
  });

  test('a mask is one filter, read once', () => {
    const code = js(['At', 'A', 'M']).code;
    expect(code).toContain('Math.min(_.A.length, _.M.length)');
    expect(code.match(/\.push\(/g)?.length).toBe(1);
  });

  test('a base or a mask with an effect declines (the interpreter reads a lazy base at the kept positions)', () => {
    const drawn = ['Map', fn(['Add', 'k', ['Random']], 'k'), 'A'];
    for (const json of [
      ['WithRandomSeed', 3, ['At', drawn, 'M']],
      ['WithRandomSeed', 3, ['At', ['RandomShuffle', 'A'], gt('A', 2)]],
      ['WithRandomSeed', 3, ['At', 'A', gt(['RandomShuffle', 'A'], 2)]],
    ])
      expect(failure(() => js(json))).toMatch(
        /a mask or a base of a mask with an effect/
      );
  });

  test('a pure base and a pure mask next to a draw elsewhere compile', () => {
    const json = [
      'WithRandomSeed',
      3,
      ['Add', ['Sum', ['At', 'A', gt('A', 2)]], ['Random']],
    ];
    for (const p of POINTS)
      expect(agree(js(json).run!(p as never), interpreted(json, p))).toBe(true);
  });

  test.each(BOOLEANS)('%s: the interpreter’s booleans', (_, json) => {
    for (const p of POINTS) {
      const got = js(json).run!(p as never);
      expect(agree(got, interpreted(json, p))).toBe(true);
      expect(agree(existing(json).run!(p as never), got)).toBe(true);
    }
  });

  test('the ground truth of the host: [1, 3]', () => {
    const json = ['At', 'A', ['Equal', 'K', 1]];
    expect(
      js(json).run!({ A: [1, 2, 3, 4, 5], K: [1, 0, 1] } as never)
    ).toEqual([1, 3]);
  });

  // No compiled form of the profile carries an undefined mask member: a
  // list on the boolean lane holds only true and false. The existing
  // compiler compiles `Missing` to `undefined`, a hole, and agrees with the
  // interpreter; the profile declines these forms.
  // prettier-ignore
  test.each([
    ['a Which with no default', ['At', 'A', ['Map', fn(['Which', gt('k', 2), 'True'], 'k'), 'A']], /arms of two types/],
    ['a literal Missing member', ['At', 'A', ['List', 'True', 'Missing', 'True']], /elements of two types/],
    ['a literal NaN member', ['At', 'A', ['List', 'True', 'NaN', gt('x', 1)]], /elements of two types/],
  ])('an undefined member, %s: the existing compiler’s value is the interpreter’s; the profile declines', (_, json, cause) => {
    for (const p of POINTS)
      expect(agree(existing(json).run!(p as never), interpreted(json, p))).toBe(true);
    expect(failure(() => js(json))).toMatch(cause);
  });

  // prettier-ignore
  test.each([
    ['Equal of two lists of points (the interpreter compares them)', ['If', ['Equal', 'P', 'P'], 1, 2], /Equal of a tuple/],
    ['a chain of Equal with a list', ['At', 'A', ['Equal', 'K', 1, 1]], /a chain of three or more operands with a list/],
    ['Equal of a list of points and a point', ['Equal', 'P', ['Tuple', 1, 2]], /Equal of a tuple/],
    ['an And of a list with an effect', ['At', 'A', ['And', 'M', gt(['Random'], 0.5)]], /And of a list with an effect/],
    ['an index typed as a union', ['At', 'A', 'U'], /the input U of type/],
    ['an untyped index', ['At', 'A', 'X'], /the input X of type/],
  ])('%s declines', (_, json, cause) => {
    expect(failure(() => js(json))).toMatch(cause);
  });
});

describe('IR profile, batch G29: the interval mode', () => {
  test.each(PROGRAMS.filter(([name]) => !name.includes('0 and 1')))(
    '%s: the boxes contain the JavaScript values',
    (_, json) => {
      const r = interval(json);
      expect(r.success).toBe(true);
      for (const p of POINTS)
        expect(contains(r.run!(p as never), js(json).run!(p as never))).toBe(
          true
        );
    }
  );

  test('a mask element undecided over the box: the whole range', () => {
    const r = interval(['At', 'A', gt('A', 'x')]);
    expect(r.run!({ A: [1, 2, 3], x: { lo: 1.5, hi: 2.5 } } as never)).toEqual({
      kind: 'entire',
    });
    expect(
      contains(
        r.run!({ A: [1, 2, 3], x: { lo: 1.5, hi: 1.75 } } as never),
        [2, 3]
      )
    ).toBe(true);
  });
});

describe('IR profile, batch G29: GLSL', () => {
  test('a mask declines: GLSL has no list of a run-time length', () => {
    expect(failure(() => glsl(['At', 'L3', gt('L3', 'x')]))).toMatch(
      /the region filter/
    );
    expect(
      failure(() => glsl(['At', 'L3', ['List', 'True', 'False', 'True']]))
    ).toMatch(/the region filter/);
    expect(failure(() => glsl(['At', 'A', 'M']))).toMatch(/run-time length/);
  });

  test('Equal of a list of a stated length threads', () => {
    expect(glsl(['Equal', 'L3', 1]).code).toBe(
      'bvec3((L3[int(0.0)] == 1.0), (L3[int(1.0)] == 1.0), (L3[int(2.0)] == 1.0))'
    );
  });
});

describe('IR profile, batch G29: Not of a tuple, a list And inside a lazy If', () => {
  const engine = new ComputeEngine();
  for (const name of ['p', 'q', 'c', 'd']) engine.declare(name, 'boolean');
  engine.declare('M', 'list<boolean>');
  engine.declare('L', 'list<real>');
  const run = (json: Json, to: string, point: Point) =>
    compile(engine.box(json as never), { ...IR, to } as never).run!(
      point as never
    );
  const value = (json: Json, point: Point) => {
    const values = Object.fromEntries(
      Object.entries(point).map(([k, v]) => [
        k,
        engine.box(literal(k, v) as never),
      ])
    );
    return engine.withValues(values as never, () =>
      read(
        engine
          .box(json as never)
          .evaluate()
          .N()
      )
    );
  };

  test('Not of a tuple of booleans: the interpreter’s values', () => {
    const json = ['Not', ['Tuple', 'p', 'q']];
    for (const [p, q] of [
      [true, false],
      [false, false],
    ])
      expect(run(json, 'javascript', { p, q })).toEqual(value(json, { p, q }));
  });

  // The list `And(c, M)` threads; the `If` around it is lazy in `d`.
  const json = ['If', 'd', ['Sum', ['At', 'L', ['And', 'c', 'M']]], 0];
  const POINTS: Point[] = [
    { d: true, c: true, M: [true, false, true], L: [1, 2, 3] },
    { d: true, c: false, M: [true, false, true], L: [1, 2, 3] },
    { d: false, c: true, M: [true, true], L: [1, 2, 3] },
    { d: true, c: true, M: [false, true, true, true], L: [10, 20] },
  ];

  test('on JavaScript: the interpreter’s values', () => {
    for (const p of POINTS)
      expect(run(json, 'javascript', p)).toEqual(value(json, p));
  });

  test('in the interval mode, d false, true and undecided: the boxes contain the values', () => {
    for (const p of POINTS) {
      const want = value(json, p) as number;
      const verdict = (b: boolean) => (b ? 'true' : 'false');
      const got = run(json, 'interval-js', {
        ...p,
        d: verdict(p.d as boolean),
        c: verdict(p.c as boolean),
      });
      expect(contains(got, want)).toBe(true);
      // Undecided `d`: the box holds both arms.
      const either = run(json, 'interval-js', {
        ...p,
        d: 'maybe',
        c: verdict(p.c as boolean),
      }) as Box;
      const truth = value(json, { ...p, d: true }) as number;
      expect(
        either.kind === 'entire' ||
          (contains(either, truth) && contains(either, 0))
      ).toBe(true);
    }
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

// A list of booleans of a stated length compiles on GLSL (`bvec3`). The
// harness draws a float, so the list is read through a scalar:
// `If(At(Or(…), k), 1, 0)`; the inputs are numbers (a comparison makes the
// booleans: `Equal(L3, 1)` and `Greater(L3, x)`).
(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, batch G29: boolean lists in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    const POINTS = [
      { x: 0.5, L3: [1, 0.25, 3] },
      { x: 2, L3: [-1, 1, 2.5] },
      { x: 5, L3: [1, 1, 0] },
    ];

    // The second form holds the list in a variable (`bvec3 v; if (…) { v =
    // bvec3(…); } else { … }`); the first is scalar code after the fold of
    // the constant index.
    const FORMS: [string, (k: number) => unknown, RegExp][] = [
      [
        'If(At(Or(Equal(L3, 1), Greater(L3, x)), k), 1, 0)',
        (k) => [
          'If',
          ['At', ['Or', ['Equal', 'L3', 1], gt('L3', 'x')], k],
          1,
          0,
        ],
        /==/,
      ],
      [
        'If(At(If(x > 1, Or(Equal(L3, 1), Greater(L3, x)), Not(Equal(L3, 1))), k), 1, 0)',
        (k) => [
          'If',
          [
            'At',
            [
              'If',
              gt('x', 1),
              ['Or', ['Equal', 'L3', 1], gt('L3', 'x')],
              ['Not', ['Equal', 'L3', 1]],
            ],
            k,
          ],
          1,
          0,
        ],
        /bvec3 \w+;[^]*= bvec3\(/,
      ],
    ];
    test.each(
      FORMS.flatMap((f) => [1, 2, 3].map((k) => [f[0], k, f] as const))
    )(
      '%s at k = %i agrees with JavaScript',
      async (_name, k, [, form, text]) => {
        const json = form(k);
        const r = glsl(json);
        expect(r).toMatchObject({ success: true, profile: 'ir' });
        expect(r.code).toMatch(text);
        const source = [
          '#version 300 es',
          'precision highp float;',
          'uniform float u_x;',
          'uniform float u_L3[3];',
          'out vec4 fragColor;',
          r.preamble ?? '',
          'float userFn(float x, vec3 L3) {',
          r.code.includes(';') ? r.code : `return ${r.code};`,
          '}',
          'void main() { fragColor = vec4(userFn(u_x, vec3(u_L3[0], u_L3[1], u_L3[2])), 0.0, 0.0, 0.0); }',
        ].join('\n');
        const items = POINTS.map((p) => ({
          name: JSON.stringify(p),
          source,
          uniforms: { u_x: p.x, u_L3: p.L3 } as Record<
            string,
            number | number[]
          >,
          expected: js(json).run!(p as never) as number,
        }));
        const values = await driver.evaluate(items);
        for (const [i, v] of values.entries()) {
          if (!v.ok) throw new Error(v.log);
          expect(v.value).toBe(items[i].expected);
        }
        expect(items.map((it) => it.expected)).toEqual(
          POINTS.map((p) => interpreted(json, p))
        );
      },
      120_000
    );
  }
);
