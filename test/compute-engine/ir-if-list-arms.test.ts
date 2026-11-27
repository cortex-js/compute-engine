/**
 * The arms of an `If` or a `Which` that are flat lists of reals or integers
 * of two lengths, in the profile `ir` (batch G33; README of
 * `src/compute-engine/compilation/ir/`, "Lists"): the value is the list of
 * the arm taken, of its own length. The `if` has that length as a result
 * before the list. A length value that is a constant equal to the other
 * arm's length is a stated length. GLSL and the interval mode decline lists
 * of two lengths; a list beside a scalar, tuples, lists of lists and lists
 * of two lanes that do not join decline on every target.
 *
 * The values: against the interpreter on JavaScript at points, and in the
 * interval mode at boxes (containment).
 */

import { compile } from '../../src/compile';
import { compileSlice } from '../../src/compute-engine/compilation/ir/index';
import { ALL_PASSES } from '../../src/compute-engine/compilation/ir/passes';
import { agrees, interpret, makeEngine, type Point } from './ir-slice-oracle';

type Json = unknown;
type Kinded = { kind: string; value?: { lo: number; hi: number } };

const ce = makeEngine();
ce.declare('twoLengths', '(real) -> list<real>');
ce.assign(
  'twoLengths',
  ce.box([
    'Function',
    ['If', ['Greater', 't', 0], ['List', 't', 2], ['List', 3, 4, 5]],
    't',
  ])
);

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json) => ce.box(json as never);
const js = (json: Json) => compile(box(json), IR);
const glsl = (json: Json) => compile(box(json), { ...IR, to: 'glsl' });
const interval = (json: Json) =>
  compile(box(json), { ...IR, to: 'interval-js' });

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    const message = (x as { diagnostic?: { message: string } }).diagnostic
      ?.message;
    // A decline, never a defect of the pipeline.
    expect(String(message ?? (x as Error).message)).not.toMatch(
      /internal error/
    );
    return message;
  }
  return undefined;
}

const gt = (a: Json, b: Json) => ['Greater', a, b];
// Two stated lengths (written-out lists), two run-time lengths, a stated
// length beside a run-time one (integers and reals).
const C = ['If', gt('x', 0), ['List', 'x', 2], ['List', 3, 4, 5]];
const R = ['If', gt('x', 0), 'D', 'E'];
const S = ['If', gt('x', 0), 'J', 'L'];
const POINTS: Point[] = [
  { x: 0.5, y: 2, D: [1, -2, 3, 4], E: [5, -6], J: [1, 2], L: [7, 8, 9] },
  { x: -1.5, y: -1, D: [1, -2, 3, 4], E: [5, -6], J: [1, 2, 3], L: [7, 8, 9] },
  { x: -0.5, y: 0, D: [], E: [2], J: [], L: [7, 8, 9] },
  { x: 2, y: 1, D: [3], E: [], J: [1, 2, 3, 4, 5], L: [0, 0, 1] },
];

/** The compiled values of `json` agree with the interpreter's values of
 *  `oracle` (by default `json`) at each point. */
function matches(json: Json, oracle: Json = json): void {
  const r = js(json);
  for (const p of POINTS) {
    const got = r.run(p);
    const want = interpret(ce, box(oracle), p);
    expect([json, p, got, agrees(got, want)]).toEqual([json, p, got, true]);
  }
}

describe('lists of two lengths on JavaScript: the interpreter values', () => {
  const FORMS: [string, Json][] = [
    ['two stated lengths', C],
    ['two run-time lengths', R],
    ['a stated length beside a run-time one, integers and reals', S],
    [
      'a Which of three arms',
      ['Which', gt('x', 1), 'D', gt('x', 0), ['List', 1, 2], 'True', 'E'],
    ],
    [
      'a nested conditional',
      ['If', gt('x', 0), 'D', ['If', gt(-1, 'x'), C, 'E']],
    ],
  ];
  for (const [what, json] of FORMS) test(what, () => matches(json));

  test('the result is the arm, of its own length', () => {
    const r = js(C);
    expect(r.run({ x: 1 })).toEqual([1, 2]);
    expect(r.run({ x: -1 })).toEqual([3, 4, 5]);
    // The arms are written out; the length is a result of the `if`.
    expect(r.code).toMatch(/\[3, 4, 5\]/);
  });
});

describe('the consumers of the list', () => {
  const CONSUMERS: [string, (c: Json) => Json][] = [
    ['Sum', (c) => ['Sum', c]],
    ['Length', (c) => ['Length', c]],
    ['At in range', (c) => ['At', c, 2]],
    ['At past the shorter arm', (c) => ['At', c, 3]],
    ['At out of range', (c) => ['At', c, 6]],
    ['At from the end', (c) => ['At', c, -1]],
    ['a mask', (c) => ['At', c, gt(c, 0)]],
    ['an element-wise operation with a scalar', (c) => ['Add', c, 'y']],
    ['an element-wise operation with itself', (c) => ['Multiply', c, c]],
    ['ListJoin', (c) => ['ListJoin', c, ['If', gt(0, 'y'), 'D', ['List', 7]]]],
    ['Max', (c) => ['Max', c]],
  ];
  for (const [what, f] of CONSUMERS)
    test(what, () => {
      for (const c of [C, R, S]) matches(f(c));
    });

  test('Map', () => {
    // The interpreter's `Map` of an `If` is `[]` (the `If` is read as a
    // collection unevaluated): the oracle is the `Map` of each arm.
    const f = ['Function', ['Power', 't', 2], 't'];
    for (const [, cond, a, b] of [C, R, S] as Json[][])
      matches(
        ['Map', f, ['If', cond, a, b]],
        ['If', cond, ['Map', f, a], ['Map', f, b]]
      );
  });
});

describe('the passes keep a list with its length', () => {
  test('a constant condition takes its arm', () => {
    for (const json of [
      ['If', gt(3, 2), ['List', 'x', 2], 'D'],
      ['If', gt(2, 3), ['List', 'x', 2], 'D'],
      ['Sum', ['If', gt(2, 3), ['List', 'x', 2], 'D']],
    ]) {
      matches(json);
      expect(js(json).code).not.toMatch(/\} else \{/);
    }
  });

  test('in a loop body', () => {
    matches([
      'Sum',
      ['Sum', ['If', gt('k', 2), 'D', ['List', 'k', 1]]],
      ['Limits', 'k', 1, 4],
    ]);
  });

  test('in a Map body', () => {
    matches([
      'Map',
      ['Function', ['Sum', ['If', gt('t', 0), ['List', 't', 1], 'D']], 't'],
      'E',
    ]);
  });

  test('the result of a user function, inlined or called', () => {
    matches(['Sum', ['twoLengths', 'x']]);
    matches(['At', ['twoLengths', 'x'], 2]);
  });

  test('a length value that is a constant beside the same stated length', () => {
    // `Repeat(x, 400)` is a build of the length value 400: the result is a
    // list of 400, as in `neyret/7vqnkhdhoj`.
    const json = [
      'If',
      ['Less', 'x', 'y'],
      ['Repeat', 'x', 400],
      ['Multiply', 'x', ['Range', 1, 400]],
    ];
    matches(json);
    matches(['Sum', json]);
    expect(js(['Length', json]).code).toBe('400');
  });

  test('a list of 2^20 elements in one arm does not hang', () => {
    const start = Date.now();
    const r = js(['Sum', ['If', gt('x', 0), ['Range', 1, 2 ** 20], 'D']]);
    expect(r.run({ x: 1, D: [1, 2] })).toBe(2 ** 19 * (2 ** 20 + 1));
    expect(r.run({ x: -1, D: [1, 2] })).toBe(3);
    const n = js(['Length', ['If', gt('x', 0), ['Repeat', 'x', 'n'], 'D']]);
    expect(n.run({ x: 1, n: 2 ** 20, D: [] })).toBe(2 ** 20);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe('the result position: a list with no consumer', () => {
  // The taken arm's length (3) is no literal of the list, and the condition
  // folds in each of three ways: a literal, a name holding a value (`h` is
  // 2.5), a comparison of constants.
  const arm = ['List', 'x', 5, 7];
  const FOLDED: Json[] = [
    ['If', 'True', arm, 'D'],
    ['If', gt('h', 2), arm, 'D'],
    ['If', gt(3, 2), arm, 'D'],
    ['If', gt(2, 3), 'D', arm],
    ['If', gt(['Length', 'L'], 2), arm, 'D'],
    ['If', gt('h', 2), arm, ['List', 1, 2]],
    ['Which', gt(1, 2), 'D', 'True', arm],
  ];
  const fn = (json: Json) => ['Function', json, 'x'];
  ce.declare('foldedArm', '(real) -> list<real>');
  ce.assign('foldedArm', box(fn(['If', gt('h', 2), arm, ['List', 1, 2]])));
  ce.declare('twoArms', '(real) -> list<real>');
  ce.assign('twoArms', box(fn(['If', gt('x', 0), arm, ['List', 1, 2]])));
  const P = { ...ALL_PASSES };
  const CONFIGS: [string, unknown][] = [
    ['all passes', P],
    ['no pass', false],
    ['no cse', { ...P, cse: false }],
    ['no dce', { ...P, dce: false }],
    ['fold and dce only', { fold: true, dce: true }],
    ['no inline', { ...P, inline: false }],
  ];
  const forms = (): Json[] => [
    ...FOLDED,
    ...FOLDED.map((f) => ['Tuple', ['Length', f], 1]),
    ['foldedArm', 'x'],
    ['twoArms', 'x'],
    ['Sum', ['twoArms', 'x']],
  ];

  test('on JavaScript, under each set of passes', () => {
    for (const [what, passes] of CONFIGS)
      for (const json of forms()) {
        const r = compileSlice(box(json), {
          target: 'javascript',
          passes,
        } as never);
        for (const p of POINTS) {
          const got = r.run(p);
          const want = interpret(ce, box(json), p);
          expect([what, json, p, got, agrees(got, want)]).toEqual([
            what,
            json,
            p,
            got,
            true,
          ]);
        }
      }
    expect(js(['If', gt('h', 2), arm, 'D']).run({ x: 1.5, D: [] })).toEqual([
      1.5, 5, 7,
    ]);
  });

  test('on GLSL and in the interval mode: a value or a decline', () => {
    for (const json of forms())
      for (const to of [glsl, interval]) failure(() => to(json));
  });
});

describe('arms of the constant length 0', () => {
  const FORMS: Json[] = [
    ['If', ['Less', 'x', 'y'], ['Repeat', 'x', 0], ['Repeat', 'y', 0]],
    ['If', ['Less', 'x', 'y'], ['Repeat', 'x', -1], ['Repeat', 'y', -1]],
    ['If', ['Less', 'x', 'y'], ['Repeat', 'x', 0], ['Repeat', 'y', -3]],
    ['If', ['Less', 'x', 'y'], ['Repeat', 'x', 0], ['List', 'x', 5, 7]],
  ];
  test('on JavaScript: the empty list', () => {
    for (const json of FORMS)
      for (const f of [json, ['Sum', json], ['Length', json]]) matches(f);
    expect(js(FORMS[0]).run({ x: 1, y: 2 })).toEqual([]);
  });
  test('on GLSL and in the interval mode: a decline', () => {
    for (const json of FORMS)
      for (const to of [glsl, interval])
        expect(failure(() => to(json))).toMatch(
          /arms that are lists of two lengths/
        );
  });
});

describe('the declines', () => {
  test('GLSL and the interval mode: lists of two lengths', () => {
    for (const json of [C, ['Sum', C], ['If', gt('x', 0), 'L', ['List', 1, 2]]])
      for (const to of [glsl, interval])
        expect(failure(() => to(json))).toMatch(
          /arms that are lists of two lengths/
        );
  });

  test('out of scope: arms of two types on every target', () => {
    for (const json of [
      ['If', ['Less', 'x', 0], 'L', 1],
      ['If', gt('x', 0), ['Tuple', 'x', 1], ['Tuple', 1, 2, 3]],
      ['If', gt('x', 0), 'Q', ['List', ['List', 1, 2, 3]]],
      ['If', gt('x', 0), gt('D', 0), 'E'],
    ])
      for (const to of [js, glsl, interval])
        expect(failure(() => to(json))).toMatch(/arms of two types/);
  });
});

describe('the interval mode', () => {
  /** Each element of the interpreter's value `want` is in the kinded
   *  result `got`. */
  const inside = (got: unknown, want: unknown): boolean => {
    if (Array.isArray(want))
      return (
        Array.isArray(got) &&
        got.length === want.length &&
        want.every((w, k) => inside(got[k], w))
      );
    const g = got as Kinded;
    return (
      g.kind === 'interval' &&
      g.value!.lo <= (want as number) &&
      (want as number) <= g.value!.hi
    );
  };

  test('a constant condition is decided in the lowering', () => {
    const json = ['Sum', ['If', gt(2, 3), ['List', 'x', 2], 'D']];
    const got = interval(json).run({ x: { lo: -1, hi: 2 }, D: [1, 2, 3] });
    expect(inside(got, 6)).toBe(true);
  });

  test('one length through a constant: boxes decided true, false, undecided', () => {
    // Where the condition is undecided the result is the hull of the two
    // arms, element by element: it holds the value of the arm taken at each
    // point of the box.
    const json = [
      'If',
      ['Less', 'x', 'y'],
      ['Repeat', 'x', 400],
      ['Multiply', 'x', ['Range', 1, 400]],
    ];
    for (const json2 of [json, ['Sum', json], ['At', json, 7]]) {
      const r = interval(json2);
      for (const [lo, hi] of [
        [1, 2],
        [6, 7],
        [4, 6],
      ]) {
        const got = r.run({ x: { lo, hi }, y: 5 });
        for (const x of [lo, (lo + hi) / 2, hi]) {
          const want = interpret(ce, box(json2), { x, y: 5 });
          expect([json2, x, inside(got, want)]).toEqual([json2, x, true]);
        }
      }
    }
  });
});
