/**
 * List operators of the profile `ir` (batch G17, README of
 * `src/compute-engine/compilation/ir/`, "Lists" and "Tuples"): `ListJoin`,
 * `Zip`, a `Comprehension` of several clauses, `Choose`, a seeded
 * `RandomChoice` of the unit interval and `RandomShuffle`, a list of points
 * times a list of numbers, and the missing arm of an `If` whose arm is a
 * boolean.
 *
 * The witnesses are rows of Tycho's run over every Desmos document; the
 * names they read are defined in the documents, so the definitions here are
 * stand-ins of the same shape. JavaScript agrees with the interpreter within
 * 1e-12, and a seeded program gives the interpreter's numbers. On GLSL the
 * boolean `If` runs in WebGL2 (the headless Chromium of
 * `scripts/glsl-check/glsl-driver.ts`); without the browser, that test is
 * skipped.
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
for (const name of ['x', 'y', 'R', 'o']) ce.declare(name, 'real');
for (const name of ['A', 'B', 'C', 'S1', 'S2', 'S3', 'S4', 'I', 'K', 'X', 'Y'])
  ce.declare(name, 'list<real>');
ce.declare('L3', 'list<real^3>');
ce.declare('n', 'integer');
ce.declare('N', 'integer<1..50>');

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options });
const glsl = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, to: 'glsl', ...options });

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
  if (e.symbol === 'True' || e.symbol === 'False') return e.symbol === 'True';
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  // A lazy collection (`Zip`, a `Comprehension`).
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

/** `v` and `w` have one shape and agree within `tolerance` (0: the same
 *  numbers). */
function agree(v: unknown, w: unknown, tolerance = 1e-12): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x, tolerance))
    );
  if (typeof w === 'boolean') return v === w;
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    (Math.abs(v - w) <= tolerance * Math.max(1, Math.abs(w)) ||
      (Number.isNaN(v) && Number.isNaN(w)))
  );
}

function check(json: Json, points: Point[], tolerance = 1e-12) {
  const r = js(json);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  for (const p of points) {
    const got = r.run!(p as never);
    const want = interpreted(json, p);
    if (!agree(got, want, tolerance))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
      );
  }
  return r;
}

// Lists of lengths 0, 1 and several.
// prettier-ignore
const LISTS: Point[] = [
  { x: 0.5, y: -1.25, A: [1, 2, 3], B: [10, 20], C: [-1.5], S1: [1, 2], S2: [], S3: [3], S4: [4, 5, 6], L3: [7, 8, 9] },
  { x: -2, y: 0.125, A: [], B: [4], C: [0.5, 0.25, 2, 8], S1: [], S2: [], S3: [], S4: [], L3: [0, -1, 1] },
  { x: 3.5, y: 2, A: [0.3], B: [-1, 2, -3, 4, -5], C: [], S1: [0.1, 0.2, 0.3], S2: [9], S3: [8, 7], S4: [6], L3: [1, 1, 1] },
];

const RC = (n: Json) => ['RandomChoice', ['Interval', 0, ['Open', 1]], n];

describe('IR profile, batch G17: ListJoin', () => {
  // prettier-ignore
  test.each([
    ['the join of four lists (the witness)', ['ListJoin', 'S1', 'S2', 'S3', 'S4']],
    ['two lists', ['ListJoin', 'A', 'B']],
    ['one list', ['ListJoin', 'C']],
    ['lists and scalars', ['ListJoin', 'x', 'A', ['Add', 'y', 1], 'L3']],
    ['a list of stated length and a Range', ['ListJoin', 'L3', ['Range', 1, 3]]],
    ['a join of a join', ['ListJoin', 'A', ['ListJoin', 'B', 'A'], 'C']],
    ['an element-wise operation of a join', ['Add', ['Multiply', 2, ['ListJoin', 'A', 'B']], 1]],
    ['Sum of a join', ['Sum', ['ListJoin', 'A', 'S4', 'C']]],
    ['lists of points', ['ListJoin', ['PointList', 'A', 'A'], ['PointList', 'B', ['Negate', 'B']]]],
  ])('%s', (_, json) => {
    check(json, LISTS);
  });

  test('a list and a list of points decline (the interpreter gives a list of both)', () => {
    expect(
      failure(() => js(['ListJoin', 'A', ['PointList', 'B', 'B']]))
    ).toMatch(/arms of a tuple and a list|arms of two types/);
  });

  test('GLSL declines it (a build)', () => {
    ce.declare('L4', 'list<real^4>');
    expect(failure(() => glsl(['Sum', ['ListJoin', 'L3', 'L4']]))).toMatch(
      /the region build/
    );
  });
});

describe('IR profile, batch G17: Zip', () => {
  // prettier-ignore
  test.each([
    ['Map over Zip(A, B) (the witness)', ['Map', ['Function', ['Block', ['Add', ['At', 'Z', 1], ['At', 'Z', 2]]], 'Z'], ['Zip', 'A', 'B']]],
    ['the value of Zip(A, B)', ['Zip', 'A', 'B']],
    ['three lists', ['Zip', 'A', 'B', 'C']],
    ['PointX of each point', ['Map', ['Function', ['PointX', 'Z'], 'Z'], ['Zip', 'A', 'C']]],
    ['a point added to each point', ['Add', ['Zip', 'A', 'B'], ['Tuple', 1, -1]]],
    ['the length', ['Length', ['Zip', 'A', 'B']]],
    ['a list of stated length', ['Zip', 'L3', 'A']],
  ])('%s', (_, json) => {
    check(json, LISTS);
  });

  test('is PointList of its lists', () => {
    const p = LISTS[0];
    expect(js(['Zip', 'A', 'B']).run!(p as never)).toEqual(
      js(['PointList', 'A', 'B']).run!(p as never)
    );
  });

  test('a list with an effect declines (the interpreter reads up to the shortest list)', () => {
    const drawing = ['Map', ['Function', ['Random'], '_1'], ['Range', 1, 1000]];
    expect(
      failure(() =>
        js(['Zip', ['Range', 1, 'n'], drawing], { constantFold: false })
      )
    ).toMatch(/Zip of a list with an effect/);
  });
});

describe('IR profile, batch G17: a Comprehension of several clauses', () => {
  // prettier-ignore
  const witness = ['Comprehension',
    ['Tuple',
      ['Add', ['Divide', ['Cos', ['Multiply', ['Rational', 1, 18], 'Pi', 'j']], ['At', 'K', 'k']], ['At', 'X', 'k']],
      ['Add', ['Divide', ['Sin', ['Multiply', ['Rational', 1, 18], 'Pi', 'j']], ['At', 'K', 'k']], ['At', 'Y', 'k']]],
    ['Element', 'k', ['Range', 1, 4]], ['Element', 'j', ['Range', 1, 36]]];

  test('the witness: circles of 36 points around 4 centres', () => {
    // prettier-ignore
    const points: Point[] = [
      { K: [1, 2, 3, 4], X: [0, 1, 2, 3], Y: [5, 6, 7, 8] },
      { K: [0.5, -2, 7, 0.25], X: [-1, 0, 1, 0], Y: [0, 0, 0, 1] },
    ];
    const r = check(witness, points);
    expect((r.run!(points[0] as never) as unknown[]).length).toBe(144);
  });

  // prettier-ignore
  test.each([
    ['two Ranges', ['Comprehension', ['Add', ['Multiply', 10, 'k'], 'j'], ['Element', 'k', ['Range', 1, 2]], ['Element', 'j', ['Range', 1, 3]]]],
    ['two lists (the last index the fastest)', ['Comprehension', ['Add', ['Multiply', 10, 'k'], 'j'], ['Element', 'k', 'A'], ['Element', 'j', 'B']]],
    ['three clauses', ['Comprehension', ['Add', ['Multiply', 100, 'i'], ['Multiply', 10, 'k'], 'j'], ['Element', 'i', 'C'], ['Element', 'k', 'A'], ['Element', 'j', ['Range', 1, 2]]]],
    ['a tuple body over lists', ['Comprehension', ['Tuple', 'k', ['Multiply', 'x', 'j']], ['Element', 'k', 'A'], ['Element', 'j', 'C']]],
    ['Sum of a comprehension', ['Sum', ['Comprehension', ['Multiply', 'k', 'j'], ['Element', 'k', 'A'], ['Element', 'j', 'B']]]],
    ['a Range of an input', ['Comprehension', ['Power', 'k', 'j'], ['Element', 'k', ['Range', 1, 'n']], ['Element', 'j', ['Range', 0, 2]]]],
    ['a later index named in an earlier list (that list reads the input)', ['Comprehension', 'k', ['Element', 'k', ['Range', 1, 'n']], ['Element', 'n', ['Range', 1, 2]]]],
  ])('%s', (_, json) => {
    check(json, LISTS.map((p, i) => ({ ...p, n: [0, 1, 4][i] })));
  });

  // prettier-ignore
  test.each([
    ['a list that reads an earlier index', ['Comprehension', ['Add', 'k', 'j'], ['Element', 'k', ['Range', 1, 3]], ['Element', 'j', ['Range', 1, 'k']]], /that reads no index/],
    ['a clause with a condition', ['Comprehension', ['Add', 'k', 'j'], ['Element', 'k', ['Range', 1, 3]], ['Element', 'j', ['Range', 1, 3], ['Less', 'j', 'k']]], /that reads no index/],
    ['a draw in the body', ['Comprehension', ['Add', 'k', ['Random']], ['Element', 'k', 'A'], ['Element', 'j', 'B']], /with an effect/],
  ])('%s declines', (_, json, cause) => {
    expect(failure(() => js(json))).toMatch(cause);
  });

  test('GLSL declines it (a build)', () => {
    const json = [
      'Sum',
      [
        'Comprehension',
        ['Multiply', 'k', 'j'],
        ['Element', 'k', ['Range', 1, 2]],
        ['Element', 'j', ['Range', 1, 3]],
      ],
    ];
    expect(failure(() => glsl(json))).toMatch(/the region build/);
  });
});

describe('IR profile, batch G17: Choose', () => {
  test('Choose(N, Floor(x)) · v^Floor(x) (the witness), N in 1..50', () => {
    const json = [
      'Multiply',
      ['Choose', 'N', ['Floor', 'x']],
      ['Power', 'y', ['Floor', 'x']],
    ];
    const points: Point[] = [];
    for (const N of [1, 7, 33, 50])
      for (const x of [-1.5, 0, 2.7, 25.2, 49.9, 50, 60.5])
        points.push({ N, x, y: 0.75 });
    check(json, points);
    // Exact below 2^53: C(50, 25).
    expect(
      js(['Choose', 'N', ['Floor', 'x']]).run!({ N: 50, x: 25.5 } as never)
    ).toBe(126410606437752);
  });

  test('integer operands of any sign, and Binomial', () => {
    ce.declare('m', 'integer');
    const points: Point[] = [
      [5, 2],
      [5, 7],
      [5, -1],
      [-3, 2],
      [-3, -5],
      [0, 0],
    ].map(([n, m]) => ({ n, m }));
    check(['Choose', 'n', 'm'], points);
    check(['Binomial', 'n', 'm'], points);
  });

  test('real operands and GLSL decline', () => {
    expect(failure(() => js(['Choose', 'x', 'y']))).toMatch(
      /Choose of real, real/
    );
    expect(failure(() => js(['Binomial', 'x', 'y']))).toMatch(
      /Binomial of real, real/
    );
    expect(failure(() => glsl(['Choose', 'N', ['Floor', 'x']]))).toMatch(
      /the operation binomial/
    );
  });
});

describe('IR profile, batch G17: RandomChoice and RandomShuffle', () => {
  /** The compiled value is the interpreter's numbers (within `tolerance`
   *  of an element that is computed, not drawn), with no warning. */
  const exact = (json: Json, point: Point, tolerance = 0) => {
    const r = js(json);
    expect(r).toMatchObject({ success: true });
    expect(r.warnings ?? []).toEqual([]);
    const got = r.run!(point as never);
    const want = interpreted(json, point);
    if (!agree(got, want, tolerance))
      throw new Error(
        `${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
      );
    expect(r.shippable).toBe(false);
    return r;
  };

  test('RandomChoice of the unit interval (the witness), three seeds', () => {
    const values = [453446, 1, 2].map((seed) => {
      const json = ['WithRandomSeed', seed, RC('n')];
      for (const n of [0, 1, 4]) exact(json, { n });
      return js(json).run!({ n: 4 } as never);
    });
    expect(new Set(values.map((v) => JSON.stringify(v))).size).toBe(3);
    expect(values[0]).toEqual([
      0.9133729848655281, 0.5791351382106329, 0.3382706792854191,
      0.4743113650323001,
    ]);
  });

  test('RandomChoice: a real count is rounded, as in the interpreter', () => {
    const json = ['WithRandomSeed', 7, RC('x')];
    for (const x of [2.5, 0.4, -0.4, 3]) exact(json, { x });
    // Over the bounds, the interpreter gives an error; the code throws.
    expect(() => js(json).run!({ x: -1 } as never)).toThrow(
      /a count in 0\.\.1000000/
    );
  });

  test('RandomShuffle (the witness): inner frames in the shuffled list, three seeds', () => {
    for (const seed of [753345, 1, 2]) {
      // prettier-ignore
      const json = ['WithRandomSeed', seed, ['RandomShuffle', ['Multiply', 'R', ['Sin', ['Add', ['Multiply', ['Add', 'n', 0.5], ['WithRandomSeed', 198074, ['Random']]], ['Multiply', 'o', ['WithRandomSeed', 530981, ['Random']]], ['Range', 1, 'n']]]]]];
      // The elements are within 1e-12 (the interpreter computes the sines
      // in big decimals); the permutation is the interpreter's.
      for (const n of [0, 1, 6]) exact(json, { R: 2, n, o: 0.3 }, 1e-12);
    }
  });

  test('RandomShuffle of a list input, of lengths 0, 1 and several', () => {
    for (const seed of [753345, 1, 2])
      for (const p of LISTS)
        exact(['WithRandomSeed', seed, ['RandomShuffle', 'A']], p);
    // The input is not changed.
    const A = [1, 2, 3, 4];
    js(['WithRandomSeed', 1, ['RandomShuffle', 'A']]).run!({ A } as never);
    expect(A).toEqual([1, 2, 3, 4]);
  });

  test('another draw in the same frame: a warning, and here the interpreter’s order', () => {
    // prettier-ignore
    const programs: [Json, Point][] = [
      [['WithRandomSeed', 1, ['Add', ['Random'], ['Sum', RC(3)]]], {}],
      [['WithRandomSeed', 1, ['Add', RC(3), ['Random']]], {}],
      [['WithRandomSeed', 1, ['Block', ['Declare', 'a', { str: 'real' }, ['Random']], ['Add', RC(3), 'a']]], {}],
      [['WithRandomSeed', 1, ['RandomShuffle', ['Add', 'A', ['Random']]]], { A: [0, 10, 20, 30] }],
      [['WithRandomSeed', 7, ['RandomShuffle', RC('n')]], { n: 5 }],
    ];
    for (const [json, p] of programs) {
      const r = js(json);
      expect(r.warnings?.map((w) => w.message).join()).toMatch(/2 draw sites/);
      expect(agree(r.run!(p as never), interpreted(json, p))).toBe(true);
    }
  });

  // prettier-ignore
  test.each([
    ['RandomChoice of a list', ['RandomChoice', 'A', 2], /another domain than Interval\(0, 1\)/],
    ['RandomChoice of another interval', ['RandomChoice', ['Interval', 0, 2], 2], /another domain than Interval\(0, 1\)/],
    ['RandomShuffle of a list of points', ['RandomShuffle', ['PointList', 'A', 'B']], /not a list of numbers/],
    ['RandomShuffle of a tuple', ['RandomShuffle', ['Tuple', 'x', 'y']], /not a list of numbers/],
  ])('%s declines', (_, json, cause) => {
    expect(failure(() => js(json))).toMatch(cause);
  });

  test('a RandomChoice node read twice draws twice, as in the interpreter', () => {
    // One boxed node at two places: the lowering does not share a draw.
    const rc = box(RC(3));
    const e = ce.function('WithRandomSeed', [
      ce.number(9),
      ce.function('ListJoin', [rc, rc]),
    ]);
    const got = compile(e, IR).run!() as number[];
    expect(got).toHaveLength(6);
    expect(got.slice(3)).not.toEqual(got.slice(0, 3));
    expect(got).toEqual(read(e.evaluate().N()));
  });

  // prettier-ignore
  test.each([
    ['Zip of a RandomChoice', ['Zip', 'A', RC('n')], /Zip of a list with an effect/],
    ['a Comprehension whose body draws a list', ['Comprehension', ['Sum', RC(2)], ['Element', 'k', ['Range', 1, 3]]], /a Comprehension with an effect/],
    ['a later clause list that draws', ['Comprehension', 'j', ['Element', 'k', ['Range', 1, 3]], ['Element', 'j', ['List', ['Random']]]], /several clauses with an effect/],
    ['a later clause list that is a RandomChoice', ['Comprehension', 'j', ['Element', 'k', ['Range', 1, 2]], ['Element', 'j', RC('n')]], /several clauses with an effect/],
    ['a later clause list that is shuffled', ['Comprehension', ['Add', ['Multiply', 10, 'k'], 'j'], ['Element', 'k', ['Range', 1, 3]], ['Element', 'j', ['RandomShuffle', ['Range', 1, 4]]]], /several clauses with an effect/],
    ['an integrand that draws a list', ['Integrate', ['Multiply', 't', ['Sum', RC(2)]], ['Limits', 't', 0, 1]], /an integrand with an effect/],
    ['an interval that is the unit interval within the tolerance only', ['RandomChoice', ['Interval', ['Rational', 1, 100000000000], 1], 2], /another domain than Interval\(0, 1\)/],
    ['ListJoin with no operand', ['ListJoin'], /ListJoin with no operand/],
  ])('%s declines', (_, json, cause) => {
    expect(failure(() => js(json))).toMatch(cause);
  });

  test('GLSL declines them', () => {
    expect(failure(() => glsl(['Sum', ['RandomShuffle', 'L3']]))).toMatch(
      /the operation shuffle/
    );
    expect(failure(() => glsl(['Sum', ['WithRandomSeed', 1, RC(3)]]))).toMatch(
      /WithRandomSeed/
    );
  });
});

describe('IR profile, batch G17: a list of points times a list of numbers', () => {
  test('Sqrt(I/n) · PointList(Cos(2.4 I), Sin(2.4 I)) (the witness, admitted by batch G14)', () => {
    const json = [
      'Multiply',
      ['Sqrt', ['Divide', 'I', 'n']],
      [
        'PointList',
        ['Cos', ['Multiply', 2.4, 'I']],
        ['Sin', ['Multiply', 2.4, 'I']],
      ],
    ];
    const points: Point[] = [
      { I: [0, 1, 2, 3], n: 3 },
      { I: [], n: 50 },
      { I: [7], n: 50 },
      { I: Array.from({ length: 51 }, (_, k) => k), n: 50 },
    ];
    check(json, points);
    check(
      ['Multiply', ['PointList', 'I', ['Negate', 'I']], ['Sqrt', 'I']],
      points
    );
  });
});

describe('IR profile, batch G17: If with a boolean arm and no else', () => {
  // prettier-ignore
  const json = ['If', ['Less', 0, 'x'], ['Less', 0, ['Add', ['Negate', ['Multiply', 'R', ['Divide', ['Add', ['Negate', ['Power', 'o', ['Floor', 'x']]], 1], ['Add', ['Negate', 'o'], 1]]]], ['Multiply', 'y', ['Power', 'o', ['Floor', 'x']]]]]];
  const points: Point[] = [-2, -0.5, 0, 0.5, 3.5].flatMap((x) =>
    [-1, 2].map((y) => ({ x, y, R: 0.7, o: 0.5 }))
  );

  test('the witness: False where the condition is false, as in the interpreter', () => {
    const r = check(json, points);
    expect(r.run!({ x: -1, y: 1, R: 0.7, o: 0.5 } as never)).toBe(false);
    check(['Not', ['If', ['Less', 0, 'x'], ['Less', 0, 'y']]], points);
    check(['If', ['If', ['Less', 0, 'x'], ['Less', 0, 'y']], 1, 2], points);
  });

  test('a number arm stays NaN, a Which with no True clause declines', () => {
    expect(
      js(['If', ['Less', 0, 'x'], 'y']).run!({ x: -1, y: 2 } as never)
    ).toBeNaN();
    expect(
      failure(() => js(['Which', ['Less', 0, 'x'], ['Less', 0, 'y']]))
    ).toMatch(/arms of two types/);
  });

  test('GLSL compiles it', () => {
    expect(glsl(['If', ['Less', 0, 'x'], ['Less', 0, 'y']]).code).toBe(
      '((0.0 < x) && (0.0 < y))'
    );
  });
});

describe('IR profile, batch G17: robustness', () => {
  test('a shared graph of 2^20 paths through ListJoin, of 2^8 through Zip', () => {
    // The canonical form of `Zip` walks every path of a shared graph
    // (CE-1345), so the graph of `Zip` is smaller.
    const x = ce.box('x');
    let j: Expression = ce.function('ListJoin', [ce.box('A')]);
    for (let i = 0; i < 20; i++) {
      const s = ce.function('Sum', [j]);
      j = ce.function('ListJoin', [ce.function('Multiply', [x, s]), s]);
    }
    let z: Expression = ce.box('A');
    for (let i = 0; i < 8; i++)
      // prettier-ignore
      z = ce.function('Map', [ce.box(['Function', ['Add', ['At', 'Z', 1], ['At', 'Z', 2]], 'Z'] as never), ce.function('Zip', [z, ce.function('Multiply', [x, z])])]);
    for (const [root, levels] of [
      [ce.function('Sum', [j]), 20],
      [ce.function('Sum', [z]), 8],
    ] as const) {
      const r = compile(root, IR);
      expect(r.code.length).toBeLessThan(40_000);
      // 3·(1 + x)^levels for A = [1, 2].
      expect(r.run!({ x: 0.1, A: [1, 2] } as never)).toBeCloseTo(
        3 * 1.1 ** levels,
        9
      );
    }
  }, 30_000);

  test('a chain of 1,000 operands of ListJoin', () => {
    const root = ce.function(
      'ListJoin',
      Array.from({ length: 1_000 }, (_, i) =>
        ce.function('Multiply', [ce.number(i), ce.box('A')])
      )
    );
    const r = compile(root, IR);
    const v = r.run!({ A: [1, 2] } as never) as number[];
    expect(v.length).toBe(2_000);
    expect(v[1_999]).toBe(1_998);
    expect(v[1_000]).toBe(500);
  }, 30_000);

  test('nested loops: a comprehension of three clauses under a Sum, and Choose in a Sum', () => {
    // prettier-ignore
    const json = ['Sum', ['Comprehension', ['Multiply', 'i', 'j', 'k'], ['Element', 'i', ['Range', 1, 'n']], ['Element', 'j', ['Range', 1, 'n']], ['Element', 'k', ['Range', 1, 'n']]]];
    expect(js(json).run!({ n: 40 } as never)).toBe(((40 * 41) / 2) ** 3);
    const sum = ['Sum', ['Choose', 'N', 'k'], ['Limits', 'k', 0, 'N']];
    expect(js(sum).run!({ N: 50 } as never)).toBe(2 ** 50);
  }, 30_000);

  test('a build past 2^32 elements throws at once', () => {
    // prettier-ignore
    const comprehension = ['Comprehension', ['Add', 'k', 'j'], ['Element', 'k', ['Range', 1, 'n']], ['Element', 'j', ['Range', 1, 'n']]];
    expect(() => js(comprehension).run!({ n: 1e5 } as never)).toThrow(/2\^32/);
    const join = ['ListJoin', ['Range', 1, 'n'], ['Range', 1, 'n']];
    expect(() => js(join).run!({ n: 2 ** 31 } as never)).toThrow(/2\^32/);
    expect(() => js(join).run!({ n: 2 ** 53 } as never)).toThrow(/2\^32/);
    const zip = ['Zip', ['Range', 1, 'n'], ['Range', 1, 'n']];
    expect(() => js(zip).run!({ n: 2 ** 53 } as never)).toThrow(/2\^32/);
    expect(() =>
      js(['WithRandomSeed', 1, ['RandomShuffle', ['Range', 1, 'n']]]).run!({
        n: 2 ** 40,
      } as never)
    ).toThrow(/2\^32/);
    expect(() =>
      js(['WithRandomSeed', 1, RC('n')]).run!({ n: 2 ** 40 } as never)
    ).toThrow(/a count in/);
  }, 30_000);
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

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, batch G17: the boolean If in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('agrees with JavaScript', async () => {
      const json = ['If', ['If', ['Less', 0, 'x'], ['Less', 0, 'y']], 1, 2];
      const r = glsl(json);
      const f = js(json);
      const points = [-1, 1].flatMap((x) => [-1, 1].map((y) => ({ x, y })));
      const source = (body: string) =>
        [
          '#version 300 es',
          'precision highp float;',
          'uniform float u_x;',
          'uniform float u_y;',
          'out vec4 fragColor;',
          r.preamble ?? '',
          'float userFn(float x, float y) {',
          r.code.includes(';') ? body : `return ${body};`,
          '}',
          'void main() { fragColor = vec4(userFn(u_x, u_y), 0.0, 0.0, 0.0); }',
        ].join('\n');
      const items = points.map((p) => ({
        name: JSON.stringify(p),
        source: source(r.code),
        uniforms: { u_x: p.x, u_y: p.y },
        expected: f.run!(p as never) as number,
      }));
      const values = await driver.evaluate(items);
      expect(values.map((v) => (v.ok ? v.value : v.log))).toEqual(
        items.map((i) => i.expected)
      );
      expect(items.map((i) => i.expected)).toEqual([2, 2, 2, 1]);
    }, 120_000);
  }
);
