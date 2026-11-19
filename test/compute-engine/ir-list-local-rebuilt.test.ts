/**
 * A list local that the program writes whole, `L = value`, whose length can
 * change at each write (CE-1481), on JavaScript: a list of numbers or of
 * points carried by a `Loop` and joined by an `if`. README of
 * `src/compute-engine/compilation/ir/`, "Lists"; `docs/COMPILATION-MODEL.md`,
 * "List updates". The witness is Tycho's showcase entry apollonian-gasket:
 * `allCirclesLocal = fillGap(…, allCirclesLocal)` in a loop, and
 * `out = [...take(out, i), c, ...drop(out, i)]` in `generations`.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Result = { success: boolean; run: (inputs: object) => unknown };

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

/** The interpreter's value: a list or a tuple is an array. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isSymbol(e, 'True')) return true;
  if (isSymbol(e, 'False')) return false;
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  if (e.isCollection)
    return [...(e as never as { each(): Generator<Expression> }).each()].map(
      read
    );
  throw new Error(`no value: ${e.toString()}`);
}

/** `v` and `w` have one shape and agree within `tolerance`. */
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
    Math.abs(v - w) <= tolerance * Math.max(1, Math.abs(w))
  );
}

/** The engine after the Epsil program `source`. */
function engine(source: string) {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return ce;
}

const compiled = (ce: ComputeEngine, json: unknown, options: object = {}) =>
  compile(ce.box(json as never), {
    to: 'javascript',
    fallback: false,
    ...options,
  } as never) as unknown as Result;

/** The compiled value of `call` (MathJSON) after the program `source`
 *  equals the interpreter's. */
function agrees(source: string, call: unknown[]) {
  const ce = engine(source);
  const code = compiled(ce, call);
  expect(code.success).toBe(true);
  const got = code.run({});
  const want = read(
    ce
      .box(call as never)
      .evaluate()
      .N()
  );
  if (!agree(got, want))
    throw new Error(
      `${JSON.stringify(call)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
    );
}

const declines = (source: string, call: unknown[], options: object = {}) =>
  failure(() => compiled(engine(source), call, options));

describe('A list local written whole (CE-1481)', () => {
  test('a list grown in a Loop, from a list or a declared empty list', () => {
    agrees(
      'function f(n: integer) { let L: list<integer> = []; for k in 1..n { L = [...L, k*k] }; L }',
      ['f', 4]
    );
    agrees(
      'function f(n: integer) { let L = [0]; for k in 1..n { L = [...L, k*k] }; L }',
      ['f', 4]
    );
    agrees(
      'function f(n: integer) { let L = [1.5]; for k in 1..n { for j in 1..k { L = [...L, j] } }; [Length(L), Sum(L)] }',
      ['f', 4]
    );
    agrees(
      'function f(n: integer) { let L = [true]; for k in 1..n { L = [...L, k > 2] }; L }',
      ['f', 4]
    );
    // A list of booleans of two lengths in the arms of an `if`.
    agrees(
      'function f(n: integer) { let L = [true]; if n > 2 { L = [...L, false] }; L }',
      ['f', 4]
    );
    agrees(
      'function f(n: integer) { let L = [true]; if n > 2 { L = [...L, false] }; L }',
      ['f', 1]
    );
    agrees(
      'function f(n: integer) { let L = [true]; for k in 1..n { if k % 2 == 0 { L = [...L, k > 3] } }; L }',
      ['f', 6]
    );
    // A list of the elements before it.
    agrees(
      'function f(n: integer) { let L = [1, 2]; for k in 1..n { L = [...L, L[-1] + L[-2]] }; L }',
      ['f', 6]
    );
    // An input copied, then grown: the input does not change.
    agrees(
      'function f(L: list<real>) { let M = L; M = [...M, 1]; [Length(L), Length(M)] }',
      ['f', ['List', 3, 4]]
    );
  });

  test('a list that shrinks, a map, a filter and an empty list', () => {
    agrees(
      'function f(n: integer) { let L = [1]; for k in 1..n { if k > 2 { if k > 3 { L = [...L, k] } else { L = take(L, 1) } } }; L }',
      ['f', 5]
    );
    agrees(
      'function f(n: integer) { let L = [1, 2, 3]; for k in 1..n { L = [x * 2 for x in L] }; L }',
      ['f', 3]
    );
    agrees(
      'function f(n: integer) { let L = [1, 2, 3]; for k in 1..n { L = [x for x in L if x > k] }; L }',
      ['f', 2]
    );
    agrees(
      'function f(n: integer) { let L = [1]; for k in 1..n { if k % 2 == 0 { L = [] } else { L = [...L, k] } }; L }',
      ['f', 5]
    );
  });

  test('a Break and a Continue in the Loop that carries the list', () => {
    agrees(
      'function f(n: integer) { let L = [1]; for k in 1..10 { if k > n { break }; L = [...L, k] }; L }',
      ['f', 4]
    );
    agrees(
      'function f(n: integer) { let L = [1]; for k in 1..n { L = [...L, k]; continue; L = [] }; L }',
      ['f', 3]
    );
  });

  test('value semantics: a read of the local keeps the value it read', () => {
    agrees(
      'function f(n: integer) { let L = [1, 2]; let M = L; L = [...L, n]; [Length(M), Length(L)] }',
      ['f', 4]
    );
    agrees(
      'function f(n: integer) { let L = [1]; for k in 1..n { let M = L; L = [...M, Length(M)] }; L }',
      ['f', 4]
    );
    agrees(
      'function f(n: integer) { let L = [1]; let s = 0; for k in 1..n { L = [...L, k]; s = s + Sum(L) }; [s, Length(L)] }',
      ['f', 4]
    );
  });

  test('a real list written to a list of integers of no stated type widens it', () => {
    agrees('function f(n: integer) { let L = [1, 2]; L = [0.5]; L }', ['f', 4]);
    agrees(
      'function f(n: integer) { let L = [1]; for k in 1..n { L = [...L, k / 2] }; L }',
      ['f', 3]
    );
  });

  test('a list of points', () => {
    agrees(
      'function p(n: integer) { let P: list<tuple<real, real>> = []; for k in 1..n { if k % 2 == 1 { P = [...P, (k, k/2)] } }; P }',
      ['p', 5]
    );
    agrees(
      'function p(n: integer) { let P = [(0.5, 1.5)]; for k in 1..n { P = [...P, (k, k/2)] }; P }',
      ['p', 3]
    );
    agrees(
      'function f(n: integer) { let P = [(1, 2)]; for k in 1..n { P = [...P, (P[-1][2], P[-1][1] + P[-1][2])] }; P }',
      ['f', 4]
    );
  });

  test('a recursive function that rebuilds its list', () => {
    agrees(
      'function g(L: list<real>, d: integer) { let out = L; if d > 0 { out = [...out, d]; out = g(out, d - 1) }; out }',
      ['g', ['List', 0.5], 3]
    );
  });

  test('an insertion with take and drop, as generations does', () => {
    // The interpreter's `count` with a predicate fails here (CE-1482): the
    // count is a loop.
    agrees(
      `function g(all: list<tuple<number, number, number, integer>>, first: integer, last: integer) {
        let out: list<tuple<number, number, number, integer>> = []
        for c in all {
          if c[4] >= first && c[4] <= last {
            let i: integer = 0
            for e in out { if e[4] < c[4] || (e[4] == c[4] && e[1] <= c[1]) { i = i + 1 } }
            out = [...take(out, i), c, ...drop(out, i)]
          }
        }
        out
      }
      const all: list<tuple<number, number, number, integer>> = [(3.5, 0.1, 0.2, 2), (2.5, 0.5, 0.0, 1), (1.5, 0.0, 0.0, 1), (0.5, 0.25, 0.0, 2)]`,
      ['g', 'all', 1, 2]
    );
  });

  test('a write in a random frame', () => {
    const ce = new ComputeEngine();
    // prettier-ignore
    const json = ['Block', ['Declare', 'L', ['Dictionary', ['KeyValuePair', { str: 'value' }, ['List', 1.5]]]], ['WithRandomSeed', 7, ['Loop', ['Assign', 'L', ['ListJoin', 'L', ['List', ['Random']]]], ['Element', 'k', ['Range', 1, 3]]]], 'L'];
    const got = compiled(ce, json).run({});
    expect(got).toEqual(
      read(
        ce
          .box(json as never)
          .evaluate()
          .N()
      )
    );
    expect((got as number[]).length).toBe(4);
  });

  test('the statement form of a prelude: a local copy of an input, rebuilt in a Loop', () => {
    const ce = engine(
      'function grow(p, d: integer, L: list<tuple<number, number>>) { let out = L; for k in 1..d { out = [...out, (p[1] * k, p[2] + d)] }; out }'
    );
    ce.declare('pts', 'list<tuple<real, real>>');
    // prettier-ignore
    const json = ['Block',
      ['Declare', 'ptsLocal', ['Dictionary', ['KeyValuePair', { str: 'value' }, 'pts']]],
      ['Loop', ['Assign', 'ptsLocal', ['grow', ['Tuple', 'k', 0.5], 'k', 'ptsLocal']], ['Element', 'k', ['Range', 1, 3]]],
      ['Tuple', 'ptsLocal']];
    const code = compiled(ce, json);
    for (const pts of [
      [],
      [[1, 2]],
      [
        [0.5, -1],
        [3, 4],
      ],
    ]) {
      const value = ce.function(
        'List',
        pts.map((p) =>
          ce.function(
            'Tuple',
            p.map((x) => ce.number(x))
          )
        )
      );
      const want = ce.withValues({ pts: value } as never, () =>
        read(
          ce
            .box(json as never)
            .evaluate()
            .N()
        )
      );
      expect(agree(code.run({ pts }), want)).toBe(true);
    }
  });

  test('declines', () => {
    const grow =
      'function f(n: integer) { let L = [1.5]; for k in 1..n { L = [...L, k] }; L }';
    // GLSL has no run-time length; the interval mode declines it.
    for (const to of ['glsl', 'interval-js'])
      expect(declines(grow, ['f', 3], { to })).toMatch(
        /a list local that its block writes whole \(JavaScript only\)/
      );
    // A constant, also a typed empty one: the interpreter refuses the write
    // ("Cannot assign a value to the constant"). Epsil refuses the program,
    // so it is MathJSON.
    for (const init of [['List'], ['List', 2]])
      expect(
        failure(() =>
          compiled(new ComputeEngine(), [
            'Block',
            [
              'Declare',
              'L',
              "'list<real>'",
              [
                'Dictionary',
                ['KeyValuePair', { str: 'value' }, init],
                ['KeyValuePair', { str: 'constant' }, 'True'],
              ],
            ],
            ['Assign', 'L', ['ListJoin', 'L', ['List', 1]]],
            'L',
          ])
        )
      ).toMatch(/a write to a constant list local/);
    // A write in place beside a whole write.
    expect(
      declines(
        'function f(n: integer) { let L = [1]; L = [...L, 2]; L[1] = 5; L }',
        ['f', 5]
      )
    ).toMatch(/or to a list local other than ReplaceAt or AddTo/);
    // The interpreter gives an `incompatible-type` error for both.
    expect(
      declines(
        'function f(n: integer) { let L: list<integer> = [1, 2]; L = [0.5]; L }',
        ['f', 4]
      )
    ).toMatch(/written to a list local of type list<integer>/);
    expect(
      declines(
        'function f(n: integer) { let P: list<tuple<real, real>> = []; P = [...P, (1, 2, 3)]; P }',
        ['f', 5]
      )
    ).toBeDefined();
    // An empty list of no stated type has no lane.
    expect(
      declines(
        'function f(n: integer) { let L = []; for k in 1..n { L = [...L, k*k] }; L }',
        ['f', 4]
      )
    ).toMatch(/an empty list/);
    // A point written whole.
    expect(
      declines('function f(n: integer) { let p = (1, 2); p = (n, 3); p }', [
        'f',
        4,
      ])
    ).toMatch(/a list local written whole/);
  });
});

describe('The apollonian-gasket prelude (CE-1481)', () => {
  // The functions of Tycho's showcase prelude, except that the parameter
  // `c` of `isNewCircle` is declared: of no stated type, it is inferred
  // `tuple<number>` from `1 / c[1]`, and the call with a circle of three
  // elements declines.
  const PRELUDE = `const MinRadius = 0.008
function complexSqrt(re, im) {
  let m = sqrt(re^2 + im^2)
  let a = sqrt(max(0, (m + re) / 2))
  let b = sqrt(max(0, (m - re) / 2))
  (a, b) if im >= 0 else (a, -b)
}
function fourthCircles(a, b, c) {
  let ka = a[1]; let kb = b[1]; let kc = c[1]
  let disc = 2 * sqrt(max(0, ka * kb + kb * kc + kc * ka))
  let ax = ka * a[2]; let ay = ka * a[3]
  let bx = kb * b[2]; let by = kb * b[3]
  let cx = kc * c[2]; let cy = kc * c[3]
  let sx = ax + bx + cx; let sy = ay + by + cy
  let px = (ax * bx - ay * by) + (bx * cx - by * cy) + (cx * ax - cy * ay)
  let py = (ax * by + ay * bx) + (bx * cy + by * cx) + (cx * ay + cy * ax)
  let (rx, ry) = complexSqrt(px, py)
  rx = 2 * rx; ry = 2 * ry
  let out: list<tuple<number, number, number>> = []
  for k in [ka + kb + kc + disc, ka + kb + kc - disc] {
    for (zx, zy) in [(sx + rx, sy + ry), (sx - rx, sy - ry)] {
      out = [...out, (k, zx / k, zy / k)]
    }
  }
  out
}
function touches(p, q) {
  let d = sqrt((p[2] - q[2])^2 + (p[3] - q[3])^2)
  let rp = 1 / p[1]; let rq = 1 / q[1]
  abs(d - abs(rp + rq)) < 1e-6 || abs(d - abs(rp - rq)) < 1e-6
}
function alreadyFound(found, c) {
  count(found, e => abs(e[1] - c[1]) < 1e-6 && sqrt((e[2] - c[2])^2 + (e[3] - c[3])^2) < 1e-6) > 0
}
function isNewCircle(p, q, r, c: tuple<number, number, number>) {
  c[1] > 0 && 1 / c[1] >= MinRadius && touches(c, p) && touches(c, q) && touches(c, r)
}
function fillGap(p, q, r, depth, found: list<tuple<number, number, number, integer>>) {
  let out = found
  for c in fourthCircles(p, q, r) {
    if isNewCircle(p, q, r, c) && !alreadyFound(out, c) {
      out = [...out, (c[1], c[2], c[3], depth)]
      out = fillGap(p, q, c, depth + 1, out)
      out = fillGap(p, r, c, depth + 1, out)
      out = fillGap(q, r, c, depth + 1, out)
    }
  }
  out
}
const OuterCircle = (-1, 0, 0)
const RightCircle = (2, 0.5, 0)
const LeftCircle = (2, -0.5, 0)
const TopCircle = (3, 0.0, 0.6666666666666666)
const BottomCircle = (3, 0.0, -0.6666666666666666)
let allCircles = [(RightCircle[1], RightCircle[2], RightCircle[3], 1), (LeftCircle[1], LeftCircle[2], LeftCircle[3], 1), (TopCircle[1], TopCircle[2], TopCircle[3], 1), (BottomCircle[1], BottomCircle[2], BottomCircle[3], 1)]
function generations(all: list<tuple<number, number, number, integer>>, first: integer, last: integer) {
  let out: list<tuple<number, number, number, integer>> = []
  for c in all {
    if c[4] >= first && c[4] <= last {
      let i = count(out, e => e[4] < c[4] || (e[4] == c[4] && e[1] <= c[1]))
      out = [...take(out, i), c, ...drop(out, i)]
    }
  }
  out
}`;
  const START = [
    [2, 0.5, 0, 1],
    [2, -0.5, 0, 1],
    [3, 0, 0.6666666666666666, 1],
    [3, 0, -0.6666666666666666, 1],
  ];

  test("fourthCircles and fillGap give the interpreter's circles", () => {
    const ce = engine(PRELUDE);
    for (const call of [
      ['fourthCircles', 'OuterCircle', 'RightCircle', 'TopCircle'],
      ['fillGap', 'OuterCircle', 'RightCircle', 'TopCircle', 2, 'allCircles'],
    ]) {
      const got = compiled(ce, call).run({});
      const want = read(
        ce
          .box(call as never)
          .evaluate()
          .N()
      );
      expect(agree(got, want, 1e-9)).toBe(true);
    }
  });

  test('the statement allCirclesLocal = fillGap(…, allCirclesLocal) in a Loop', () => {
    const ce = engine(PRELUDE);
    ce.declare('allCirclesIn', 'list<tuple<real, real, real, real>>');
    // The gaps of the prelude are tuples of circles (a tuple of tuples
    // declines): the loop reads them from three lists of circles.
    // prettier-ignore
    const json = ['Block',
      ['Declare', 'A', ['Dictionary', ['KeyValuePair', { str: 'value' }, ['List', 'OuterCircle', 'OuterCircle', 'RightCircle']]]],
      ['Declare', 'B', ['Dictionary', ['KeyValuePair', { str: 'value' }, ['List', 'RightCircle', 'LeftCircle', 'LeftCircle']]]],
      ['Declare', 'allCirclesLocal', ['Dictionary', ['KeyValuePair', { str: 'value' }, 'allCirclesIn']]],
      ['Loop', ['Assign', 'allCirclesLocal', ['fillGap', ['At', 'A', 'g'], ['At', 'B', 'g'], 'TopCircle', 2, 'allCirclesLocal']], ['Element', 'g', ['Range', 1, 3]]],
      ['Tuple', 'allCirclesLocal']];
    const got = compiled(ce, json).run({ allCirclesIn: START }) as number[][][];
    const want = read(
      ce
        .box([
          'Block',
          ...json.slice(1, 3),
          [
            'Declare',
            'L',
            ['Dictionary', ['KeyValuePair', { str: 'value' }, 'allCircles']],
          ],
          [
            'Loop',
            [
              'Assign',
              'L',
              [
                'fillGap',
                ['At', 'A', 'g'],
                ['At', 'B', 'g'],
                'TopCircle',
                2,
                'L',
              ],
            ],
            ['Element', 'g', ['Range', 1, 3]],
          ],
          ['Tuple', 'L'],
        ] as never)
        .evaluate()
        .N()
    );
    expect(agree(got, want, 1e-9)).toBe(true);
    expect(got[0].length).toBeGreaterThan(START.length);
  });

  test('generations sorts the circles of a generation', () => {
    const ce = engine(PRELUDE);
    const all = compiled(ce, [
      'fillGap',
      'OuterCircle',
      'RightCircle',
      'TopCircle',
      2,
      'allCircles',
    ]).run({}) as number[][];
    ce.declare('circles', 'list<tuple<real, real, real, real>>');
    ce.declare('g1', 'integer');
    ce.declare('g2', 'integer');
    const code = compiled(ce, ['generations', 'circles', 'g1', 'g2']);
    // The interpreter fails on `generations` (CE-1482): the reference is a
    // stable sort by generation, then curvature.
    for (const [g1, g2] of [
      [1, 1],
      [3, 3],
      [5, 1000],
    ]) {
      const want = all
        .filter((c) => c[3] >= g1 && c[3] <= g2)
        .sort((a, b) => a[3] - b[3] || a[0] - b[0]);
      expect(code.run({ circles: all, g1, g2 })).toEqual(want);
    }
  });
});
