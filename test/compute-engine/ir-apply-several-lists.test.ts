/**
 * `Apply` of a function literal of several parameters to list arguments in
 * the profile `ir` (batch G32; README of
 * `src/compute-engine/compilation/ir/`, "User functions"). A literal whose signature
 * is scalar (`literalParamsMap()`) maps over its flat list arguments, as the
 * interpreter's `applyLiteralMapped()`: the lists are zipped and a scalar
 * argument is bound whole in every cell, each argument evaluated once, in
 * order, and the body once per cell. Lists of different stated lengths
 * (the interpreter's `incompatible-dimensions`), a tuple, a nested list and
 * a literal whose signature takes a collection (it binds the list whole)
 * decline.
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
ce.declare('P', 'list<real>');
ce.declare('R', 'list<real>');
ce.declare('K', 'list<integer>');
ce.declare('t', 'real');

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

/** The literal `(…params) ↦ Block(body)`, Tycho's form. */
const F = (body: Json, ...params: string[]): Json => [
  'Function',
  ['Block', body],
  ...params,
];
const apply = (f: Json, ...args: Json[]): Json => ['Apply', f, ...args];

const POINTS: Point[] = [
  {
    x: 0.5,
    t: 1,
    n: 3,
    P: [-1, 2, 5],
    R: [10, 20, 30],
    K: [1, -2, 3],
    L: [1, 2, 3],
  },
  { x: -1.5, t: -2.5, n: 0, P: [0.25], R: [4], K: [7], L: [-1, 0.5, 4] },
  { x: 2, t: 0, n: -2, P: [], R: [], K: [], L: [0, 0, 0] },
  {
    x: 1,
    t: 3,
    n: 1,
    P: [1, 1, 1, 1],
    R: [2, 3, 4, 5],
    K: [0, 0, 1, 1],
    L: [2, 2, 2],
  },
];
const run = (json: Json, r: { run: (p: Point) => unknown }) =>
  POINTS.map((p) => [r.run(p), interpret(ce, box(json), p)] as const);

const twoAB = ['Add', ['Multiply', 2, 'a'], 'b'];
const PROGRAMS: [string, Json][] = [
  ['2a + b, a list and a scalar', apply(F(twoAB, 'a', 'b'), 'P', 't')],
  ['2a + b, a scalar and a list', apply(F(twoAB, 'a', 'b'), 't', 'P')],
  [
    'Max(0, a - b): mapped, not the maximum of the list',
    apply(F(['Max', 0, ['Subtract', 'a', 'b']], 'a', 'b'), 'P', 't'),
  ],
  [
    'a + b of two lists: zipped',
    apply(F(['Add', 'a', 'b'], 'a', 'b'), 'P', 'R'),
  ],
  [
    'three parameters, two lists',
    apply(
      F(['Add', ['Multiply', 'a', 'c'], 'b'], 'a', 'b', 'c'),
      'P',
      't',
      'R'
    ),
  ],
  [
    'three parameters, three lists',
    apply(
      F(['Subtract', ['Multiply', 'a', 'b'], 'c'], 'a', 'b', 'c'),
      'P',
      'R',
      'K'
    ),
  ],
  [
    'stated lengths',
    apply(F(['Multiply', 'a', 'b'], 'a', 'b'), 'L', ['List', 'x', 2, 3]),
  ],
  [
    'a stated length and a scalar',
    apply(F(['Add', 'a', ['Sin', 'b']], 'a', 'b'), 'L', 'x'),
  ],
  // An empty list: `P` and `R` at the third point (`List()` declines on
  // its own, "an empty list").
  [
    'integer lanes',
    apply(F(['Add', ['Multiply', 'a', 'b'], 1], 'a', 'b'), 'K', 'n'),
  ],
  ['integer and real lanes', apply(F(['Add', 'a', 'b'], 'a', 'b'), 'K', 'P')],
  [
    'a body with If',
    apply(
      F(['If', ['Greater', 'a', 'b'], ['Subtract', 'a', 'b'], 0], 'a', 'b'),
      'P',
      't'
    ),
  ],
  [
    'a body with a Sum',
    apply(
      F(['Sum', ['Multiply', 'k', 'a', 'b'], ['Limits', 'k', 1, 3]], 'a', 'b'),
      'P',
      't'
    ),
  ],
  [
    'a body that calls a user function',
    apply(F(['f', 'a', 'b'], 'a', 'b'), 'P', 't'),
  ],
  ['Sum of the mapped Apply', ['Sum', apply(F(twoAB, 'a', 'b'), 'P', 't')]],
  [
    'Apply in a Sum body reading the index',
    [
      'Sum',
      ['Sum', apply(F(['Multiply', 'a', 'b'], 'a', 'b'), 'L', 'k')],
      ['Limits', 'k', 1, 3],
    ],
  ],
  [
    'Apply in a Map body reading the element',
    [
      'Map',
      [
        'Function',
        ['Sum', apply(F(['Add', 'a', 'b'], 'a', 'b'), 'R', 'u')],
        'u',
      ],
      'P',
    ],
  ],
  [
    'nested Apply',
    apply(
      F(apply(F(['Multiply', 'u', 'v'], 'u', 'v'), 'a', 'b'), 'a', 'b'),
      'P',
      't'
    ),
  ],
  [
    'nested Apply of a list in the body',
    apply(
      F(['Sum', apply(F(['Add', 'u', 'v'], 'u', 'v'), 'R', 'a')], 'a', 'b'),
      'P',
      't'
    ),
  ],
  ['one parameter: Map', apply(F(['Multiply', 'a', 3], 'a'), 'P')],
];

describe('Apply of a literal to lists on JavaScript: the interpreter values', () => {
  for (const [what, json] of PROGRAMS)
    test(what, () => {
      for (const [got, want] of run(json, js(json))) {
        expect(want).not.toBe('engine-error');
        expect([json, got, agrees(got, want)]).toEqual([json, got, true]);
      }
    });

  test('the four forms of the task: values', () => {
    const p = { P: [-1, 2, 5], R: [10, 20, 30], t: 1 };
    expect(js(apply(F(twoAB, 'a', 'b'), 'P', 't')).run(p)).toEqual([-1, 5, 11]);
    expect(
      js(apply(F(['Max', 0, ['Subtract', 'a', 'b']], 'a', 'b'), 'P', 't')).run(
        p
      )
    ).toEqual([0, 1, 4]);
    expect(js(apply(F(['Add', 'a', 'b'], 'a', 'b'), 'P', 'R')).run(p)).toEqual([
      9, 22, 35,
    ]);
  });

  test('lists of different run-time lengths: the shortest', () => {
    // The interpreter gives `incompatible-dimensions`, which the static
    // type does not show: unspecified (docs/COMPILATION-MODEL.md).
    const r = js(apply(F(['Add', 'a', 'b'], 'a', 'b'), 'P', 'R'));
    expect(r.run({ P: [-1, 2, 5], R: [10, 20] })).toEqual([9, 22]);
  });

  test('a scalar argument is lowered once, outside the build', () => {
    const r = js(apply(F(['Add', 'a', 'b'], 'a', 'b'), 'P', ['Sin', 'x']));
    expect(r.code.match(/Math\.sin/g)).toHaveLength(1);
  });

  test('effects: a draw in an argument, in the body, beside, under a seed', () => {
    const m = makeMachineEngine();
    m.declare('P', 'list<real>');
    const draw = ['Multiply', ['Random'], 'b'];
    for (const json of [
      ['WithRandomSeed', 3, apply(F(['Add', 'a', draw], 'a', 'b'), 'P', 'x')],
      [
        'WithRandomSeed',
        3,
        apply(F(['Add', 'a', 'b'], 'a', 'b'), 'P', ['Random']),
      ],
      [
        'WithRandomSeed',
        3,
        ['Sum', apply(F(['Add', 'a', draw], 'a', 'b'), 'P', 'x')],
      ],
      [
        'WithRandomSeed',
        3,
        [
          'Add',
          apply(F(['Add', 'a', ['Random']], 'a', 'b'), 'L', ['Random']),
          ['Random'],
        ],
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

  test('a list of 2^20 elements does not hang', () => {
    const P = Array.from({ length: 2 ** 20 }, (_, k) => k);
    const start = Date.now();
    const r = js(['Sum', apply(F(twoAB, 'a', 'b'), 'P', 't')]);
    expect(r.run({ P, t: 1 })).toBe(
      2 * ((2 ** 20 * (2 ** 20 - 1)) / 2) + 2 ** 20
    );
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('the declines', () => {
  test('lists of different stated lengths', () => {
    const json = apply(F(['Add', 'a', 'b'], 'a', 'b'), 'L', ['List', 1, 2]);
    // The interpreter: `incompatible-dimensions`.
    expect(interpret(ce, box(json), {})).toBe('none');
    for (const to of [js, glsl, interval])
      expect(failure(() => to(json))).toMatch(
        /Apply of lists of different lengths/
      );
  });

  const MESSAGE =
    /a list or a tuple argument of Apply \(the interpreter may map the function over it\)/;

  test('a tuple, a nested list, a list of booleans', () => {
    for (const arg of [
      ['Tuple', 1, 2],
      'Q',
      ['List', ['Greater', 'x', 0], ['Less', 'x', 1]],
    ])
      expect(
        failure(() => js(apply(F(['Add', 'a', 'b'], 'a', 'b'), arg, 't')))
      ).toMatch(MESSAGE);
  });

  test('a literal whose signature takes a collection: the list bound whole', () => {
    const json = apply(F(['Add', ['Length', 'a'], 'b'], 'a', 'b'), 'P', 't');
    expect(interpret(ce, box(json), { P: [-1, 2, 5], t: 1 })).toBe(4);
    expect(js(json).run!({ P: [-1, 2, 5], t: 1 } as never)).toBe(4);
  });

  test('on GLSL, a list of a run-time length', () => {
    expect(
      failure(() => glsl(['Sum', apply(F(twoAB, 'a', 'b'), 'P', 'x')]))
    ).toMatch(/on glsl/);
  });
});

describe('Apply of a literal to lists in the interval mode', () => {
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
  // Lists of a stated length (a list of a run-time length is not a value
  // of the interval mode).
  const REAL: Json[] = [
    apply(F(twoAB, 'a', 'b'), 'L', 't'),
    apply(F(['Max', 0, ['Subtract', 'a', 'b']], 'a', 'b'), 'L', 'x'),
    apply(F(['Add', 'a', 'b'], 'a', 'b'), 'L', ['List', 'x', 2, 't']),
    apply(F(['Add', 'a', 'b', 'c'], 'a', 'b', 'c'), 'L', 'x', [
      'List',
      1,
      2,
      3,
    ]),
    apply(F(['If', ['Greater', 'a', 'b'], 'a', 'b'], 'a', 'b'), 'L', 'x'),
    ['Sum', apply(F(['Multiply', 'a', 'b'], 'a', 'b'), 'L', ['Sin', 'x'])],
    [
      'Sum',
      apply(
        F(['Sum', apply(F(['Add', 'u', 'v'], 'u', 'v'), 'L', 'a')], 'a', 'b'),
        'L',
        't'
      ),
    ],
  ];

  test('at points: the interpreter value is in the result', () => {
    for (const json of REAL) {
      const r = interval(json);
      for (const p of POINTS) {
        const want = interpret(ce, box(json), p);
        expect([json, p, inside(r.run(p), want)]).toEqual([json, p, true]);
      }
    }
  });

  test('at boxes: the values at points of the box are in the result', () => {
    for (const json of [
      ['Sum', apply(F(twoAB, 'a', 'b'), 'L', 'x')],
      apply(F(['Max', 0, ['Subtract', 'a', 'b']], 'a', 'b'), 'L', 'x'),
      apply(F(['Multiply', 'a', 'b'], 'a', 'b'), ['List', 'x', 2, 'x'], 'L'),
    ]) {
      const r = interval(json);
      const L = [1, -2, 0.5];
      const got = r.run({ x: { lo: -1, hi: 2 }, L });
      for (const x of [-1, -0.25, 0, 1.5, 2]) {
        const want = interpret(ce, box(json), { x, L });
        expect([json, x, inside(got, want)]).toEqual([json, x, true]);
      }
    }
  });
  // The row that `ir-interval-lists.test.ts` held as a decline: three boxes
  // of `x`, one of them a point, with a list of a stated length and with a
  // list of a run-time length.
  test('Apply((j, k) ↦ j + k, list, x): containment at three boxes', () => {
    for (const [name, list] of [
      ['L', [1, -2, 0.5]],
      ['P', [4, 0.25, -3, 7]],
    ] as const) {
      const json = apply(F(['Add', 'j', 'k'], 'j', 'k'), name, 'x');
      const r = interval(json);
      for (const [lo, hi] of [
        [0.5, 0.5],
        [-1, 2],
        [3, 3.5],
      ]) {
        const got = r.run({ x: { lo, hi }, [name]: list } as never);
        for (const x of [lo, (lo + hi) / 2, hi]) {
          const want = interpret(ce, box(json), { x, [name]: list } as never);
          expect([name, lo, hi, x, inside(got, want)]).toEqual([
            name,
            lo,
            hi,
            x,
            true,
          ]);
        }
      }
    }
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

const ABC = ['List', 'x', 2, -3];
const GLSL_PROGRAMS: Json[] = [
  ['Sum', apply(F(twoAB, 'a', 'b'), ABC, 'x')],
  ['At', apply(F(['Max', 0, ['Subtract', 'a', 'b']], 'a', 'b'), ABC, 1), 2],
  ['Sum', apply(F(['Multiply', 'a', 'b'], 'a', 'b'), ABC, ['List', 1, 'x', 3])],
  [
    'Sum',
    apply(
      F(['Add', 'a', 'b', 'c'], 'a', 'b', 'c'),
      ABC,
      ['Sin', 'x'],
      ['List', 1, 2, 3]
    ),
  ],
  [
    'Sum',
    apply(
      F(['If', ['Greater', 'a', 'b'], 'a', 'b'], 'a', 'b'),
      ['List', 'x', 0.5],
      0
    ),
  ],
];

(chromiumAvailable() ? describe : describe.skip)(
  'Apply of a literal to lists on GLSL: the values in WebGL2',
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
