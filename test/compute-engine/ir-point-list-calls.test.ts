/**
 * A call of a user function with a list of points at a parameter declared as
 * a point (CE-1477; README of `src/compute-engine/compilation/ir/`, "User
 * functions"). The interpreter maps the function over the points, one point
 * per call (`pointListParamSlots()`): the compiled code is a build of the
 * calls of the point at each index, zipped with the other lists that the
 * interpreter maps (a list of points at another point parameter, a flat
 * list at a scalar parameter), each other argument bound whole. The result
 * of the function is a scalar or a point: the call is a list of numbers or
 * a list of points.
 *
 * Each case states the interpreter's value, which the test checks, and the
 * value of the code on JavaScript (or a decline). On GLSL a list of points
 * of a constant length is written out (CE-1474): a call with a literal list
 * of points or a `PointList` compiles there.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

type Json = unknown;
type Value = number | number[] | number[][];

const P = 'tuple<real, real>';
const E = 'nan | real | signed_infinity';
const B = [
  [1, 2],
  [3, 4],
];
const C = [
  [10, 20],
  [30, 40],
];

type Case = {
  name: string;
  setup: (ce: ComputeEngine) => void;
  /** The declarations of the inputs, also the `inputs` option. */
  decl?: Record<string, string>;
  expr: Json;
  inputs?: Record<string, Value>;
  /** The interpreter's value, as `toString()` prints it. */
  interpreted: string;
  /** The value of the code on JavaScript, or `undefined` for a decline. */
  js: Value | undefined;
  /** The cause of the decline on JavaScript. */
  cause?: RegExp;
};

/** `name` declared of the signature `sig` (none: not declared) and
 *  assigned the literal of `body` and `params`. */
const fn =
  (name: string, sig: string | undefined, body: Json, ...params: Json[]) =>
  (ce: ComputeEngine) => {
    if (sig !== undefined) ce.declare(name, { signature: sig } as never);
    ce.assign(name, ce.box(['Function', body, ...params] as never));
  };
const both =
  (...fs: ((ce: ComputeEngine) => void)[]) =>
  (ce: ComputeEngine) =>
    fs.forEach((f) => f(ce));

const SUM = ['Add', ['At', 'p', 1], ['At', 'p', 2]];
const sumOf = (sig = `(${P}) -> real`) => fn('f', sig, SUM, 'p');
const PQ = ['Add', ['At', 'p', 1], ['At', 'q', 2]];
const twoPoints = fn('f', `(${P}, ${P}) -> real`, PQ, 'p', 'q');
const pointAndReal = fn(
  'f',
  `(${P}, real) -> real`,
  ['Add', ['At', 'p', 1], 't'],
  'p',
  't'
);
const SHIFT = ['Tuple', ['Add', ['At', 'p', 1], 1], ['At', 'p', 2]];

// Tycho's D-358: `f(a) = (a.x + 1, a.y + 1)`, a list of points `P` of a
// value, `f(P) + (1, 1)`.
const D358 = both(
  fn(
    'f',
    `(tuple<${E}, ${E}>) -> unknown`,
    ['Tuple', ['Add', ['PointX', 'a'], 1], ['Add', ['PointY', 'a'], 1]],
    'a'
  ),
  (ce) =>
    ce.assign(
      'P',
      ce.box([
        'List',
        ['Tuple', 1, 2],
        ['Tuple', 3, 4],
        ['Tuple', 5, 6],
      ] as never)
    )
);
// Tycho's signature propagation: `C(D, d) = ((D − d)/2, 0)`,
// `n(q, D, d) = q + C(D, d)`.
const NQ = both(
  fn(
    'C',
    '(unknown, unknown) -> unknown',
    ['Tuple', ['Divide', ['Subtract', 'D', 'd'], 2], 0],
    'D',
    'd'
  ),
  fn(
    'n',
    `(tuple<${E}, ${E}>, unknown, unknown) -> unknown`,
    ['Add', 'q', ['C', 'D', 'd']],
    'q',
    'D',
    'd'
  ),
  (ce) => {
    ce.declare('x', 'real');
    ce.declare('y', 'real');
  }
);
const XY_LIST = ['List', ['Tuple', 1, 2], ['Tuple', 'x', 'y']];

const CASES: Case[] = [
  {
    name: 'the witness: a point result, a list of points of a run-time length',
    setup: fn(
      'f',
      '(tuple<number, number>) -> tuple<number, number>',
      SHIFT,
      'p'
    ),
    decl: { P: `list<${P}>` },
    expr: ['f', 'P'],
    inputs: { P: B },
    interpreted: '[(2, 2),(4, 4)]',
    js: [
      [2, 2],
      [4, 4],
    ],
  },
  {
    name: 'Tycho D-358: f(P) + (1, 1) of a list of points of a value',
    setup: D358,
    expr: ['Add', ['f', 'P'], ['Tuple', 1, 1]],
    interpreted: '[(3, 4),(5, 6),(7, 8)]',
    js: [
      [3, 4],
      [5, 6],
      [7, 8],
    ],
  },
  {
    name: 'Tycho: n([(1, 2), (x, y)], 4, 2) + (1, 1)',
    setup: NQ,
    expr: ['Add', ['n', XY_LIST, 4, 2], ['Tuple', 1, 1]],
    inputs: { x: 3, y: 4 },
    interpreted: '[(3, 3),(5, 5)]',
    js: [
      [3, 3],
      [5, 5],
    ],
  },
  {
    name: 'Tycho: n([(1, 2), (x, y)], 4, 2) + [(10, 10), (20, 20)] zips',
    setup: NQ,
    expr: [
      'Add',
      ['n', XY_LIST, 4, 2],
      ['List', ['Tuple', 10, 10], ['Tuple', 20, 20]],
    ],
    inputs: { x: 3, y: 4 },
    interpreted: '[(12, 12),(24, 24)]',
    js: [
      [12, 12],
      [24, 24],
    ],
  },
  {
    name: 'a scalar result',
    setup: sumOf(),
    decl: { P: `list<${P}>` },
    expr: ['f', 'P'],
    inputs: { P: B },
    interpreted: '[3,7]',
    js: [3, 7],
  },
  {
    name: 'a scalar result, a list of points of a stated length',
    setup: sumOf(),
    decl: { P: `list<${P}^2>` },
    expr: ['f', 'P'],
    inputs: { P: B },
    interpreted: '[3,7]',
    js: [3, 7],
  },
  {
    name: 'a parameter annotated in the literal, not declared',
    setup: fn('f', undefined, SUM, ['Typed', 'p', `'${P}'`]),
    decl: { P: `list<${P}>` },
    expr: ['f', 'P'],
    inputs: { P: B },
    interpreted: '[3,7]',
    js: [3, 7],
  },
  {
    name: 'PointX of the parameter',
    setup: fn('f', `(${P}) -> real`, ['Multiply', 2, ['PointX', 'p']], 'p'),
    decl: { P: `list<${P}>` },
    expr: ['f', 'P'],
    inputs: { P: B },
    interpreted: '[2,6]',
    js: [2, 6],
  },
  {
    name: 'a literal list of points',
    setup: both(sumOf(), (ce) => ce.declare('x', 'real')),
    expr: ['f', ['List', ['Tuple', 'x', 1], ['Tuple', 2, 3]]],
    inputs: { x: 5 },
    interpreted: '[6,5]',
    js: [6, 5],
  },
  {
    name: 'the mapped call read in a Sum',
    setup: sumOf(),
    decl: { P: `list<${P}>` },
    expr: ['Sum', ['At', ['f', 'P'], 'i'], ['Limits', 'i', 1, 2]],
    inputs: { P: B },
    interpreted: '10',
    js: 10,
  },
  {
    name: 'a call with a point and a call with a list of points',
    setup: sumOf(),
    decl: { P: `list<${P}>` },
    expr: ['Add', ['f', ['Tuple', 1, 1]], ['At', ['f', 'P'], 2]],
    inputs: { P: B },
    interpreted: '9',
    js: 9,
  },
  {
    name: 'a point bound whole beside a list of points',
    setup: twoPoints,
    decl: { P: `list<${P}>` },
    expr: ['f', 'P', ['Tuple', 10, 20]],
    inputs: { P: B },
    interpreted: '[21,23]',
    js: [21, 23],
  },
  {
    name: 'two lists of points of one stated length zip',
    setup: twoPoints,
    decl: { P: `list<${P}^2>`, Q: `list<${P}^2>` },
    expr: ['f', 'P', 'Q'],
    inputs: { P: B, Q: C },
    interpreted: '[21,43]',
    js: [21, 43],
  },
  {
    name: 'one list of points at both parameters',
    setup: twoPoints,
    decl: { P: `list<${P}>` },
    expr: ['f', 'P', 'P'],
    inputs: { P: B },
    interpreted: '[3,7]',
    js: [3, 7],
  },
  {
    name: 'a scalar bound whole beside a list of points',
    setup: both(pointAndReal, (ce) => ce.declare('x', 'real')),
    decl: { P: `list<${P}>` },
    expr: ['f', 'P', 'x'],
    inputs: { P: B, x: 5 },
    interpreted: '[6,8]',
    js: [6, 8],
  },
  {
    name: 'a flat list of the same stated length zips',
    setup: pointAndReal,
    decl: { P: `list<${P}^2>`, L: 'list<real^2>' },
    expr: ['f', 'P', 'L'],
    inputs: { P: B, L: [10, 20] },
    interpreted: '[11,23]',
    js: [11, 23],
  },
  {
    name: 'a point result beside a scalar',
    setup: both(
      fn(
        'f',
        `(${P}, real) -> ${P}`,
        ['Tuple', ['Add', ['At', 'p', 1], 't'], ['At', 'p', 2]],
        'p',
        't'
      ),
      (ce) => ce.declare('x', 'real')
    ),
    decl: { P: `list<${P}>` },
    expr: ['f', 'P', 'x'],
    inputs: { P: B, x: 5 },
    interpreted: '[(6, 2),(8, 4)]',
    js: [
      [6, 2],
      [8, 4],
    ],
  },
  {
    // A flat list at a scalar parameter (`mapOver()`), whose result is a
    // point: the list of the points.
    name: 'a flat list at a scalar parameter, a point result',
    setup: fn(
      'f',
      `(${P}, real) -> ${P}`,
      ['Tuple', ['Add', ['At', 'p', 1], 't'], ['At', 'p', 2]],
      'p',
      't'
    ),
    decl: { L: 'list<real>' },
    expr: ['f', ['Tuple', 1, 2], 'L'],
    inputs: { L: [0, 1, 2] },
    interpreted: '[(1, 2),(2, 2),(3, 2)]',
    js: [
      [1, 2],
      [2, 2],
      [3, 2],
    ],
  },
  {
    name: 'a function of scalars mapped over a flat list, a point result',
    setup: fn('f', undefined, ['Tuple', 'u', ['Multiply', 2, 'u']], 'u'),
    decl: { L: 'list<real>' },
    expr: ['f', 'L'],
    inputs: { L: [1, 2] },
    interpreted: '[(1, 2),(2, 4)]',
    js: [
      [1, 2],
      [2, 4],
    ],
  },

  // Declined.
  {
    name: 'lists of points of two stated lengths',
    setup: twoPoints,
    decl: { P: `list<${P}^2>`, Q: `list<${P}^3>` },
    expr: ['f', 'P', 'Q'],
    inputs: { P: B, Q: [...C, [50, 60]] },
    interpreted: 'Error("incompatible-dimensions", "2 vs 3")',
    js: undefined,
    cause: /whose lengths are not one value/,
  },
  {
    // The lengths are not proved equal (as for flat lists, `h(D, G)`).
    name: 'lists of points of two run-time lengths',
    setup: twoPoints,
    decl: { P: `list<${P}>`, Q: `list<${P}>` },
    expr: ['f', 'P', 'Q'],
    inputs: { P: B, Q: C },
    interpreted: '[21,43]',
    js: undefined,
    cause: /whose lengths are not one value/,
  },
  {
    name: 'a list result (a list of lists)',
    setup: fn(
      'f',
      `(${P}) -> list<real>`,
      ['List', ['At', 'p', 1], ['At', 'p', 2], 0],
      'p'
    ),
    decl: { P: `list<${P}>` },
    expr: ['f', 'P'],
    inputs: { P: B },
    interpreted: '[[1,2,0],[3,4,0]]',
    js: undefined,
    cause: /whose result is not a scalar or a point/,
  },
  {
    // The interpreter maps to the numbers of the points.
    name: 'a parameter of no stated type',
    setup: (ce) => {
      ce.declare('f', 'function');
      fn('f', undefined, ['Multiply', 2, 'x'], 'x')(ce);
    },
    decl: { P: `list<${P}>` },
    expr: ['f', 'P'],
    inputs: { P: B },
    interpreted: '[(2, 4),(6, 8)]',
    js: undefined,
    cause:
      /would take whole \(the interpreter maps the function over the list\)/,
  },
  {
    name: 'a parameter declared broadcastable<tuple<real, real>>',
    setup: fn('f', undefined, SUM, ['Typed', 'p', `'broadcastable<${P}>'`]),
    decl: { P: `list<${P}>` },
    expr: ['f', 'P'],
    inputs: { P: B },
    interpreted: '[3,7]',
    js: undefined,
  },
];

function engine(c: Case): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [k, t] of Object.entries(c.decl ?? {})) ce.declare(k, t);
  c.setup(ce);
  return ce;
}

function boxed(x: Value, point = false): Json {
  if (typeof x === 'number') return x;
  if (point) return ['Tuple', ...x];
  return ['List', ...x.map((y) => boxed(y as Value, typeof y !== 'number'))];
}

/** The compiled result on `to`, or the message of its decline. */
function compiled(c: Case, to = 'javascript'): any {
  try {
    return compile(engine(c).box(c.expr as never), {
      to,
      fallback: false,
      ...(c.decl ? { inputs: c.decl } : {}),
    } as never);
  } catch (x) {
    return (x as Error).message;
  }
}

const leaves = (x: unknown): number[] =>
  Array.isArray(x) ? x.flatMap(leaves) : [x as number];

describe('CE-1477: a call with a list of points at a point parameter maps', () => {
  test.each(CASES.map((c) => [c.name, c] as const))('%s', (_, c) => {
    // The interpreter.
    const ce = engine(c);
    for (const [k, v] of Object.entries(c.inputs ?? {}))
      ce.assign(k, ce.box(boxed(v) as never));
    expect(
      ce
        .box(c.expr as never)
        .evaluate()
        .toString()
    ).toBe(c.interpreted);

    // JavaScript: the interpreter's value, or a decline.
    const js = compiled(c);
    if (c.js === undefined) {
      expect(typeof js).toBe('string');
      if (c.cause) expect(js).toMatch(c.cause);
      return;
    }
    expect(typeof js).not.toBe('string');
    expect(js.run(c.inputs ?? {})).toEqual(c.js);

    // The interval mode compiles (the same lowering), and each interval
    // holds the value.
    const iv = compiled(c, 'interval-js');
    expect(typeof iv).not.toBe('string');
    const out = iv.run(c.inputs ?? {});
    const boxes = leaves(
      (Array.isArray(out) ? out : [out]).map((b: any) =>
        Array.isArray(b) ? b.map((x: any) => x.value) : b.value
      )
    ) as unknown as { lo: number; hi: number }[];
    const expected = leaves(c.js);
    expect(boxes.length).toBe(expected.length);
    boxes.forEach((b, i) => {
      expect(b.lo).toBeLessThanOrEqual(expected[i]);
      expect(b.hi).toBeGreaterThanOrEqual(expected[i]);
    });
  });
});

describe('CE-1477 on GLSL', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  sumOf()(ce);
  fn('g', `(${P}) -> ${P}`, SHIFT, 'p')(ce);
  // A literal list with a constant point (`[(1, 2), (x, y)]`) declines on
  // GLSL, under `Abs` too.
  const XY_GLSL = ['List', ['Tuple', 'x', 1], ['Tuple', 2, 'y']];
  const glsl = (json: Json) =>
    compile(ce.box(json as never), { to: 'glsl', fallback: false });

  test.each<[string, Json]>([
    ['f of a literal list of points', ['f', XY_GLSL]],
    [
      'f of a PointList of a constant length',
      ['f', ['PointList', ['Subtract', 'x', ['List', 0.5, 1]], 'y']],
    ],
    ['Min of f of a literal list of points', ['Min', ['f', XY_GLSL]]],
    // An array of vectors (CE-1538).
    ['a list of points as the result', ['g', XY_GLSL]],
  ])('%s compiles', (_, json) => {
    expect(glsl(json).success).toBe(true);
  });

  test('a list of points of a run-time length declines', () => {
    const ce = new ComputeEngine();
    ce.declare('P', `list<${P}>`);
    sumOf()(ce);
    expect(() =>
      compile(ce.box(['f', 'P'] as never), { to: 'glsl', fallback: false })
    ).toThrow(/Could not compile/);
  });
});
