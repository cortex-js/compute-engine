/**
 * `Repeat(v, n)` in the profile `ir` (batch G31; README of
 * `src/compute-engine/compilation/ir/`, "Lists"): a list of `n` copies of
 * `v`. A pure value is lowered once; a value that is not pure (a draw) is
 * the body of the build, evaluated once per element as the interpreter
 * evaluates it (CE-1396). The count is the count of
 * `Range(1, n)`: 0 for a count below 1. A constant count gives a list of a
 * stated length, written out when it is short (JavaScript, the interval
 * mode) and required on GLSL; a run-time count gives a build, which GLSL
 * declines. `Repeat(v)` (an unbounded list) declines, as does a value whose
 * length is known at run time only.
 *
 * The values: against the interpreter on JavaScript at points, in the
 * interval mode at points and at boxes (containment), and on GLSL in WebGL2
 * (skipped without the headless browser).
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import {
  agrees,
  interpret,
  makeEngine,
  makeMachineEngine,
  type Point,
} from './ir-slice-oracle';

type Json = unknown;
type Kinded = { kind: string; value?: { lo: number; hi: number } };

const ce = makeEngine();
ce.declare('rep', '(real, integer) -> list<real>');
ce.assign('rep', ce.box(['Function', ['Repeat', 'a', 'k'], 'a', 'k']));

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
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

// The kinds of value: a real, an integer, a boolean, a point, a complex
// number, a list of a stated length, an input list of a stated length.
const VALUES: [string, Json][] = [
  ['a real', ['Add', ['Multiply', -0.06, ['Power', 'x', 2]], 4]],
  ['an integer', -1],
  ['a boolean', ['Greater', 'x', 0]],
  ['a point', ['Tuple', 'x', 1]],
  ['a complex number', ['Add', 'x', ['Multiply', 2, 'ImaginaryUnit']]],
  ['a list of two', ['List', 'x', 2]],
  ['an input of three', 'L'],
];
// Constant counts, and counts known at run time: `n` (an integer), `y` (a
// real), the length of a list input.
const COUNTS: Json[] = [3, 1, 0, -2, 20, 'n', 'y', ['Length', 'D']];
const POINTS: Point[] = [
  { x: 0.5, y: 2, n: 3, L: [1, 2, 3], D: [1, -3, 2] },
  { x: -1.5, y: 0, n: 0, L: [4, 5, 6], D: [] },
  { x: 2, y: -1, n: -2, L: [0, 0, 1], D: [7] },
  { x: 1, y: 1, n: 1, L: [1, 1, 1], D: [1, 2, 3, 4, 5] },
];
const run = (json: Json, r: { run: (p: Point) => unknown }) =>
  POINTS.map((p) => [r.run(p), interpret(ce, box(json), p)] as const);

describe('Repeat on JavaScript: the interpreter values', () => {
  for (const [what, v] of VALUES)
    test(`${what}, at each kind of count`, () => {
      for (const n of COUNTS) {
        const json = ['Repeat', v, n];
        for (const [got, want] of run(json, js(json))) {
          expect([json, Array.isArray(want)]).toEqual([json, true]);
          expect([json, got, agrees(got, want)]).toEqual([json, got, true]);
        }
      }
    });

  test('a complex value is a list of {re, im}, a point a list of pairs', () => {
    const z = js(['Repeat', ['Add', 'x', ['Multiply', 2, 'ImaginaryUnit']], 2]);
    expect(z.run({ x: 0.5 })).toEqual([
      { re: 0.5, im: 2 },
      { re: 0.5, im: 2 },
    ]);
    expect(js(['Repeat', ['Tuple', 'x', 1], 'n']).run({ x: 3, n: 2 })).toEqual([
      [3, 1],
      [3, 1],
    ]);
  });

  test('a short constant count is a written-out list, the value once', () => {
    const r = js(['Repeat', ['Sin', 'x'], 3]);
    expect(r.code.match(/Math\.sin/g)).toHaveLength(1);
    expect(r.code).not.toMatch(/for \(/);
    expect(js(['Repeat', -1, 2]).code).toMatch(/\[\(-1\), \(-1\)\]/);
  });

  test('a draw elsewhere in the program, beside a pure Repeat, under a seed', () => {
    const m = makeMachineEngine();
    for (const json of [
      ['WithRandomSeed', 3, ['Add', ['Repeat', 'x', 3], ['Random']]],
      [
        'WithRandomSeed',
        3,
        ['Add', ['Sum', ['Repeat', ['Add', 'x', 1], 'n']], ['Random']],
      ],
    ]) {
      const r = compile(m.box(json as never), IR);
      for (const p of POINTS) {
        const got = r.run(p);
        const want = interpret(m, m.box(json as never), p);
        expect([json, p, agrees(got, want)]).toEqual([json, p, true]);
      }
    }
  });

  test('a constant count folded from a real: its floor', () => {
    // Every non-integer constant written as a count is an error of the
    // canonical form; one folded from an `If` reaches the lowering. The
    // interpreter gives an error (`incompatible-type`): unspecified.
    const json = ['Repeat', 'x', ['If', ['Greater', 1, 0], 2.5, 3]];
    expect(js(json).run({ x: 1 })).toEqual([1, 1]);
  });

  test('a real count that is an integer; a non-integer one does not hang', () => {
    const r = js(['Repeat', 'x', 'y']);
    expect(r.run({ x: 1, y: 2 })).toEqual([1, 1]);
    // The interpreter gives an error (`incompatible-type`): unspecified.
    for (const y of [2.5, NaN, Infinity]) {
      try {
        r.run({ x: 1, y });
      } catch (e) {
        expect(e).toBeInstanceOf(RangeError);
      }
    }
  });

  test('a count of 2^53 or more throws at once, constant or at run time', () => {
    // The interpreter keeps the list lazy (more than `maxCollectionSize`).
    const start = Date.now();
    for (const n of [2 ** 53, 1e20])
      expect(() => js(['Repeat', 'x', n]).run({ x: 1 })).toThrow(RangeError);
    const r = js(['Sum', ['Repeat', 'x', 'n']]);
    for (const n of [2 ** 53, 2 ** 53 + 2, 2 ** 32])
      expect(() => r.run({ x: 1, n })).toThrow(RangeError);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

// Repeat as an operand, in a `Map` body and in a user function.
const OPERANDS: [string, Json][] = [
  ['element-wise', ['Add', ['Repeat', 'x', 3], 'L']],
  ['element-wise, a run-time count', ['Multiply', ['Repeat', 'x', 'n'], 2]],
  ['Sum, constant', ['Sum', ['Repeat', ['Sin', 'x'], 4]]],
  ['Sum, run-time', ['Sum', ['Repeat', 'x', 'n']]],
  ['At', ['At', ['Repeat', 'x', 3], 2]],
  ['At of a run-time count', ['At', ['Repeat', ['Tuple', 'x', 1], 'n'], 1]],
  ['Length', ['Length', ['Repeat', 'x', 'n']]],
  ['ListJoin', ['ListJoin', ['Repeat', 'x', 2], ['Repeat', 0, 'n']]],
  [
    'in a Map body',
    ['Map', ['Function', ['Sum', ['Repeat', 't', 3]], 't'], 'D'],
  ],
  [
    'a run-time count in a Map body',
    ['Map', ['Function', ['Length', ['Repeat', 'x', 't']], 't'], 'D'],
  ],
  ['in a user function', ['Sum', ['rep', 'x', 'n']]],
  [
    "Tycho's form, a count of a length",
    ['Repeat', 0, ['Add', ['Negate', ['Length', 'D']], 4]],
  ],
];

describe('Repeat as an operand on JavaScript', () => {
  for (const [what, json] of OPERANDS)
    test(what, () => {
      for (const [got, want] of run(json, js(json)))
        expect([got, agrees(got, want)]).toEqual([got, true]);
    });
});

describe('a value that is not pure (CE-1396)', () => {
  // The interpreter evaluates a value that is not pure once per element, in
  // order, and not at all for a count of 0: the value is the body of the
  // build, as the body of a `Map`.
  const m = makeMachineEngine();
  m.declare('c', 'integer');
  const R = (n: Json) => ['Repeat', ['Random'], n];
  const seeded = (x: Json) => ['WithRandomSeed', 3, x];
  const PROGRAMS: Json[] = [
    R(3),
    R('n'),
    ['Max', R(3)],
    ['Min', R('n')],
    ['Add', R(3), ['List', 1, 2, 3]],
    ['Add', R(3), 'L'],
    ['Add', R(3), 1],
    ['Multiply', R('n'), 2],
    ['Sum', R(3)],
    ['Sum', R('n')],
    ['Product', R(3)],
    ['Sin', R(3)],
    ['ListJoin', R(2), ['List', 9]],
    // A list of lists: the inner list has the constant length of its count.
    ['Repeat', R(3), 2],
    // The interpreter keeps a `Map` lazy, past the seed: its `Sum`.
    ['Sum', ['Map', ['Function', ['Multiply', 't', 10], 't'], R(3)]],
    // The draws after the list: none for a count of 0.
    ['Add', ['At', R(3), 2], ['Random']],
    ['Add', ['Length', R(3)], ['Random']],
    ['Add', ['Length', R(0)], ['Random']],
    ['Add', ['Sum', R('n')], ['Random']],
  ];

  test('on JavaScript: the values and the draws of the interpreter', () => {
    for (const json of PROGRAMS.map(seeded)) {
      const r = compile(m.box(json as never), IR);
      for (const p of POINTS) {
        const got = r.run(p);
        const want = interpret(m, m.box(json as never), p);
        expect([json, p, agrees(got, want)]).toEqual([json, p, true]);
      }
    }
  });

  test('three draws, as Map(_ ↦ Random(), Range(1, 3))', () => {
    const v = compile(m.box(seeded(R(3)) as never), IR).run({}) as number[];
    expect(new Set(v).size).toBe(3);
    const map = ['Map', ['Function', ['Random'], 'k'], ['Range', 1, 3]];
    expect(compile(m.box(seeded(map) as never), IR).run({})).toEqual(v);
    // A short list keeps the build: one draw site, in a loop.
    const code = compile(m.box(R(3) as never), IR).code;
    expect(code).toMatch(/for \(/);
  });

  test('in the interval mode: [0, 1] for each element', () => {
    for (const json of [R(3), ['Sum', R(3)]]) {
      const got = interval(json).run({});
      const want = interpret(m, m.box(seeded(json) as never), {});
      expect([json, got]).toEqual([
        json,
        Array.isArray(want)
          ? want.map(() => ({ kind: 'interval', value: { lo: 0, hi: 1 } }))
          : { kind: 'interval', value: { lo: 0, hi: 3 } },
      ]);
    }
  });

  test('the declines: GLSL, a write', () => {
    expect(failure(() => glsl(['Sum', R(3)]))).toMatch(/Random on glsl/);
    // A write to an outer local in the value declines, as in a Map body.
    const write = ['Block', ['Assign', 'c', ['Add', 'c', 1]], 'c'];
    const program = (list: Json) => [
      'Block',
      ['Declare', 'c', 'integer', 1],
      ['Declare', 'r', 'integer', ['Sum', list]],
      ['Add', 'r', ['Multiply', 100, 'c']],
    ];
    for (const list of [
      ['Repeat', write, 3],
      ['Map', ['Function', write, 'k'], ['Range', 1, 3]],
    ])
      for (const to of [js, glsl, interval])
        expect(failure(() => to(program(list)))).toMatch(
          /a write in a loop to a local declared outside/
        );
  });

  // The inner list is a build of a run-time length: the lane `rows`
  // (CE-1736), a draw for each element of each row, in order.
  test('a list of lists of run-time length: the values and the draws', () => {
    const json = seeded(['Repeat', R('n'), 2]);
    const r = compile(m.box(json as never), IR);
    expect(r.rows).toBe(true);
    for (const p of POINTS) {
      const got = r.run(p);
      const want = interpret(m, m.box(json as never), p);
      expect([json, p, agrees(got, want)]).toEqual([json, p, true]);
    }
  });
});

describe('the declines', () => {
  test('a complex count', () => {
    expect(failure(() => js(['Repeat', 'x', 'Z']))).toMatch(
      /a count of Repeat that is not a real number/
    );
  });

  test('Repeat(v): an unbounded list', () => {
    expect(failure(() => js(['Repeat', 'x']))).toMatch(
      /Repeat with no count \(an unbounded list\)/
    );
  });

  // A value of a run-time length: the lane `rows` (CE-1736).
  test('a value of a run-time length is the rows', () => {
    for (const n of [2, 'n']) {
      const json = ['Repeat', 'D', n];
      const r = js(json);
      expect(r.rows).toBe(true);
      for (const p of POINTS)
        expect([json, p, agrees(r.run(p), interpret(ce, box(json), p))]).toEqual(
          [json, p, true]
        );
    }
  });

  test('a value of a run-time length, on GLSL', () => {
    expect(failure(() => glsl(['Repeat', 'D', 2]))).toMatch(
      /a list of lists of run-time length/
    );
  });

  test('a constant count that is not an integer: an error of the canonical form', () => {
    expect(failure(() => js(['Repeat', 'x', 2.5]))).toMatch(
      /the static type error/
    );
  });

  test('on GLSL, an unbounded run-time count declines', () => {
    expect(failure(() => glsl(['Sum', ['Repeat', 'x', 'n']]))).toMatch(
      /rangecount \(the operation rangecount\) on glsl/
    );
  });

  test('on GLSL, the sum of zero repeats compiles', () => {
    expect(glsl(['Sum', ['Repeat', 'x', 0]]).success).toBe(true);
  });
});

describe('Repeat in the interval mode', () => {
  // The values whose elements are real numbers.
  const REAL = VALUES.filter(([what]) =>
    ['a real', 'an integer', 'a list of two', 'an input of three'].includes(
      what
    )
  ).map(([, x]) => x);
  /** Each element of the interpreter's value `want` is in the kinded
   *  result `got` (a list of kinded results). */
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

  test('at points: the interpreter value is in the result', () => {
    for (const v of REAL)
      for (const n of [3, 1, 0, -2, 20, 'n', ['Length', 'D']]) {
        const json = ['Repeat', v, n];
        const r = interval(json);
        for (const p of POINTS) {
          const want = interpret(ce, box(json), p);
          expect([json, p, inside(r.run(p), want)]).toEqual([json, p, true]);
        }
      }
  });

  test('at boxes: the values at points of the box are in the result', () => {
    for (const json of [
      ['Sum', ['Repeat', ['Sin', 'x'], 4]],
      ['Sum', ['Repeat', 'x', 'n']],
      ['At', ['Repeat', ['Multiply', 'x', 'x'], 'n'], 2],
      ['Repeat', ['Add', ['Multiply', -0.06, ['Power', 'x', 2]], 4], 4],
    ]) {
      const r = interval(json);
      const got = r.run({ x: { lo: -1, hi: 2 }, n: 3 });
      for (const x of [-1, -0.25, 0, 1.5, 2]) {
        const want = interpret(ce, box(json), { x, n: 3 });
        expect([json, x, inside(got, want)]).toEqual([json, x, true]);
      }
    }
  });

  test('a count of 2^53 does not hang', () => {
    const start = Date.now();
    const r = interval(['Repeat', 'x', 'n']);
    expect(r.run({ x: 1, n: 2 ** 53 })).toEqual({ kind: 'entire' });
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

//
// GLSL: the values in WebGL2
//

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** The fragment shader of a host (as in `ir-glsl-profile.test.ts`). */
function shader(r: ReturnType<typeof glsl>): string {
  const inputs = r.freeSymbols!;
  const type = (n: string) => r.freeSymbolTypes![n].lowered;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    ...inputs.map((n) => `uniform ${type(n)} u_${n};`),
    'out vec4 fragColor;',
    r.preamble ?? '',
    `float userFn(${inputs.map((n) => `${type(n)} ${n}`).join(', ')}) {`,
    body,
    '}',
    'void main() {',
    `  fragColor = vec4(float(userFn(${inputs.map((n) => `u_${n}`).join(', ')})), 0.0, 0.0, 0.0);`,
    '}',
  ].join('\n');
}

const GLSL_PROGRAMS: Json[] = [
  ['Sum', ['Repeat', 'x', 0]],
  ['Sum', ['Repeat', ['Add', ['Multiply', -0.06, ['Power', 'x', 2]], 4], 4]],
  ['Sum', ['Repeat', -1, 2]],
  ['At', ['Repeat', ['Sin', 'x'], 3], 2],
  ['Sum', ['Add', ['Repeat', 'x', 3], ['List', 1, 2, 3]]],
  ['Sum', ['Repeat', 'x', 20]],
  [
    'Sum',
    [
      'Map',
      ['Function', ['Sum', ['Repeat', 't', 2]], 't'],
      ['List', 'x', 2, 3],
    ],
  ],
  // The length of an input of a stated length is a constant.
  ['Sum', ['Repeat', 'x', ['Length', ['List', 'x', 1]]]],
  ['Length', ['Repeat', 'x', 5]],
  ['At', ['At', ['Repeat', ['Tuple', 'x', 1], 3], 2], 1],
];

(chromiumAvailable() ? describe : describe.skip)(
  'Repeat on GLSL: the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('the shaders give the interpreter values', async () => {
      const points = [{ x: 0.5 }, { x: -1.25 }];
      const items = GLSL_PROGRAMS.flatMap((json) => {
        const r = glsl(json);
        const source = shader(r);
        return points.map((p) => ({
          name: `${JSON.stringify(json)} at ${JSON.stringify(p)}`,
          source,
          uniforms: Object.fromEntries(
            r.freeSymbols!.map((n) => [`u_${n}`, p.x])
          ),
          expected: interpret(ce, box(json), p),
        }));
      });
      const values = await driver.evaluate(items as never);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        const e = expected as number;
        const tolerance = /Sin/.test(name) ? 1e-3 : 1e-5;
        if (!(Math.abs(v.value - e) <= tolerance * Math.max(1, Math.abs(e))))
          failures.push(`${name}: ${v.value} vs ${e}`);
      });
      expect(failures).toEqual([]);
    }, 120_000);
  }
);
