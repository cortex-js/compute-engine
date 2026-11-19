/**
 * A `Loop` over a literal list of tuples of tuples (CE-1488), on
 * JavaScript: `for gap in [(A, B, C), …]`, where `A`, `B` and `C` are
 * tuples. The loop runs over an index into a list per position of the
 * tuples, and `gap[j]` of a constant `j` is the element at that position.
 * README of `src/compute-engine/compilation/ir/`, "Tuples". The witness is
 * Tycho's showcase entry apollonian-gasket: the loop of its prelude over
 * the six gaps between the start circles.
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

const compiled = (ce: ComputeEngine, json: unknown) =>
  compile(ce.box(json as never), {
    to: 'javascript',
    fallback: false,
  } as never) as unknown as Result;

const CIRCLES = `const A = (-1, 0, 0)
const B = (2, 0.5, 0)
const C = (3, 0.0, 0.6666666666666666)
`;

/** The compiled value of `call` after the program `source` equals the
 *  interpreter's, for each argument `n`. */
function agrees(source: string, ns: number[] = [1, 2, 3]) {
  const ce = engine(CIRCLES + source);
  const code = compiled(ce, ['f', 'n']);
  expect(code.success).toBe(true);
  for (const n of ns) {
    const got = code.run({ n });
    const want = read(ce.box(['f', n]).evaluate().N());
    if (!agree(got, want))
      throw new Error(
        `f(${n}): ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
      );
  }
}

const declines = (source: string) =>
  failure(() => compiled(engine(CIRCLES + source), ['f', 'n']));

describe('A Loop over a literal list of tuples of tuples (CE-1488)', () => {
  test('an element of the tuple at a constant index', () => {
    agrees(
      'function f(n: integer) { let t = 0; for g in [(A, B, C), (B, C, A), (C, A, B)] { t = t + n * g[1][2] * g[2][1] + g[3][3] }; t }'
    );
    // From the end.
    agrees(
      'function f(n: integer) { let t = 0; for g in [(A, B, C), (B, C, A)] { t = t + g[-1][1] - n * g[-3][2] }; t }'
    );
    // A pattern of names, and a pattern of a pattern.
    agrees(
      'function f(n: integer) { let t = 0; for (p, q, r) in [(A, B, C), (B, C, A)] { t = t + n * p[1] + q[2] + r[3] }; t }'
    );
    agrees(
      'function f(n: integer) { let t = 0; for ((k, x, y), q) in [(A, B), (C, A)] { t = t + n * k + x * y + q[1] }; t }'
    );
    // A list of points as the value of each pass.
    agrees(
      'function f(n: integer) { let L: list<tuple<real, real, real>> = []; for g in [(A, B), (C, A)] { L = [...L, g[1] + n * g[2]] }; L }'
    );
  });

  test('a user function of the tuples, a nested clause and a Break', () => {
    agrees(
      `function dist(p, q) { sqrt((p[2] - q[2])^2 + (p[3] - q[3])^2) }
function f(n: integer) { let t = 0; for g in [(A, B, C), (B, C, A)] { t = t + n * dist(g[1], g[2]) + dist(g[2], g[3]) }; t }`
    );
    agrees(
      'function f(n: integer) { let t = 0; for g in [(A, B), (C, A)] { for k in 1..n { t = t + k * g[2][1] } }; t }'
    );
    agrees(
      'function f(n: integer) { let t = 0; for g in [(A, B), (C, A), (B, C)] { if t > n { break }; t = t + g[1][1] + g[2][1] }; t }',
      [0, 3, 10]
    );
    // A read in a function literal and in a comprehension.
    agrees(
      'function f(n: integer) { let t = 0; for g in [(A, B), (C, A)] { t = t + count([1, 2, 3], e => e < g[1][1] + n) }; t }'
    );
    agrees(
      'function f(n: integer) { let t = 0; for g in [(A, B), (C, A)] { t = t + sum([g[1][1] * k for k in 1..n]) }; t }'
    );
  });

  test('declines', () => {
    // A read of the whole tuple (the interpreter's `Length(g)` is 3).
    expect(
      declines(
        'function f(n: integer) { let t = 0; for g in [(A, B, C), (B, C, A)] { t = t + Length(g) }; t }'
      )
    ).toMatch(/a tuple of tuples/);
    // An index that is not a constant (the interpreter reads it).
    expect(
      declines(
        'function f(n: integer) { let t = 0; for g in [(A, B, C), (B, C, A)] { t = t + g[n][1] }; t }'
      )
    ).toMatch(/not a constant/);
    expect(
      declines(
        'function f(n: integer) { let t = 0; for g in [(A, B, C), (B, C, A)] { t = t + g[4][1] }; t }'
      )
    ).toMatch(/out of range/);
    // A pattern of another length.
    expect(
      declines(
        'function f(n: integer) { let t = 0; for (p, q) in [(A, B, C), (B, C, A)] { t = t + p[1] }; t }'
      )
    ).toMatch(/a pattern of 2 names/);
    // Tuples of two lengths at one position.
    expect(
      declines(
        'function f(n: integer) { let t = 0; for g in [(A, B), ((1, 2), C)] { t = t + g[1][1] }; t }'
      )
    ).toMatch(/elements of two types/);
    // An effect in the list: the interpreter reads the elements once, in
    // order; a random draw, directly or in a call.
    expect(
      declines(
        'function f(n: integer) { let t = 0; for g in [((random(), 0, 0), B), (B, A)] { t = t + g[1][1] }; t }'
      )
    ).toMatch(/a list of tuples of tuples with an effect/);
    expect(
      declines(
        'function mk(n) { (random() + n, 0, 0) }\nfunction f(n: integer) { let t = 0; for g in [(mk(n), B), (B, A)] { t = t + g[1][1] }; t }'
      )
    ).toMatch(/a list of tuples of tuples with an effect/);
  });

  test('GLSL declines it', () => {
    const ce = engine(
      CIRCLES +
        'function f(n: integer) { let t = 0; for g in [(A, B), (B, A)] { t = t + g[1][1] }; t }'
    );
    expect(
      failure(() =>
        compile(ce.box(['f', 'n'] as never), {
          to: 'glsl',
          fallback: false,
        } as never)
      )
    ).toMatch(/a tuple of tuples/);
  });
});

describe('The apollonian-gasket prelude: the loop over the gaps (CE-1488)', () => {
  // The functions of Tycho's showcase prelude; the parameter `c` of
  // `isNewCircle` has no stated type, as in the prelude (CE-1489).
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
function isNewCircle(p, q, r, c) {
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
let allCircles = [(RightCircle[1], RightCircle[2], RightCircle[3], 1), (LeftCircle[1], LeftCircle[2], LeftCircle[3], 1), (TopCircle[1], TopCircle[2], TopCircle[3], 1), (BottomCircle[1], BottomCircle[2], BottomCircle[3], 1)]`;
  const START = [
    [2, 0.5, 0, 1],
    [2, -0.5, 0, 1],
    [3, 0, 0.6666666666666666, 1],
    [3, 0, -0.6666666666666666, 1],
  ];
  // The loop of the prelude, its list local `L` declared with the value
  // `init`.
  const program = (init: string) =>
    // prettier-ignore
    ['Block',
      ['Declare', 'L', ['Dictionary', ['KeyValuePair', { str: 'value' }, init]]],
      ['Loop',
        ['Assign', 'L', ['fillGap', ['At', 'gap', 1], ['At', 'gap', 2], ['At', 'gap', 3], 2, 'L']],
        ['Element', 'gap', ['List',
          ['Tuple', 'OuterCircle', 'RightCircle', 'TopCircle'],
          ['Tuple', 'OuterCircle', 'LeftCircle', 'TopCircle'],
          ['Tuple', 'RightCircle', 'LeftCircle', 'TopCircle'],
          ['Tuple', 'OuterCircle', 'RightCircle', 'BottomCircle'],
          ['Tuple', 'OuterCircle', 'LeftCircle', 'BottomCircle'],
          ['Tuple', 'RightCircle', 'LeftCircle', 'BottomCircle']]]],
      ['Tuple', 'L']];

  test("for gap in [(OuterCircle, RightCircle, TopCircle), …] gives the interpreter's circles", () => {
    const ce = engine(PRELUDE);
    ce.declare('allCirclesIn', 'list<tuple<real, real, real, real>>');
    const got = compiled(ce, program('allCirclesIn')).run({
      allCirclesIn: START,
    }) as number[][][];
    const want = read(
      ce
        .box(program('allCircles') as never)
        .evaluate()
        .N()
    );
    expect(agree(got, want, 1e-9)).toBe(true);
    // The six gaps fill the circles of radius at least MinRadius.
    expect(got[0].length).toBeGreaterThan(200);
  });
});

describe('The elements of a list of tuples of tuples are read in order (CE-1488)', () => {
  test('an element that writes a local reads as the interpreter does', () => {
    // Each row writes `s` in its second part, after its first part reads
    // it: rows are read in order, then by column.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const row = [
      'Tuple',
      ['Tuple', 's', 'x'],
      ['Block', ['AddTo', 's', 1], ['Tuple', 's', 0]],
    ];
    const json = [
      'Block',
      ['Declare', 's', ['Dictionary', ['KeyValuePair', { str: 'value' }, 0]]],
      ['Declare', 't', ['Dictionary', ['KeyValuePair', { str: 'value' }, 0]]],
      [
        'Loop',
        [
          'Assign',
          't',
          ['Add', 't', ['At', ['At', 'g', 1], 1], ['At', ['At', 'g', 2], 1]],
        ],
        ['Element', 'g', ['List', row, row]],
      ],
      't',
    ];
    const code = compile(ce.box(json as never), {
      fallback: false,
    } as never) as unknown as { run: (i: object) => number };
    const want = ce
      .box(json as never)
      .subs({ x: ce.number(0.5) })
      .evaluate().re;
    expect(want).toBe(4);
    expect(code.run({ x: 0.5 })).toBe(want);
  });
});
