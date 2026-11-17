/**
 * `Break` and `Continue` in the body of a `Loop`, in the profile `ir`
 * (batch G23; README of `src/compute-engine/compilation/ir/`, "Loops and the
 * runtime").
 *
 * The witness is Tycho's escape-time showcases (`showcase/burning-ship`,
 * `showcase/multibrot`, `showcase/julia-set`): iterate `z := z² + c`, break
 * when `|z|² > 4`, the result is the count. JavaScript agrees with the
 * interpreter within 1e-12; on GLSL the programs run in WebGL2 (the headless
 * Chromium of `scripts/glsl-check/glsl-driver.ts`) and agree with
 * JavaScript; without the browser, those tests are skipped.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import type { Expression } from '../../src/compute-engine/global-types';
import { twoStageRunner } from '../../src/compute-engine/compilation/javascript-runtime';
import { runtimeOf } from '../../src/compute-engine/compilation/ir/print-js';

type Json = unknown;
type Point = Record<string, number | number[]>;

const ce = new ComputeEngine();
for (const name of ['x', 'y']) ce.declare(name, 'real');
ce.declare('n', 'integer');
ce.declare('L', 'list<real>');

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
type Result = {
  success: boolean;
  code: string;
  preamble?: string;
  warnings?: { code: string; message: string }[];
  run: (...a: unknown[]) => any;
};
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options } as never) as unknown as Result;
const glsl = (json: Json) =>
  compile(box(json), { ...IR, to: 'glsl' } as never) as unknown as Result;
/** `json` with the bound `n` replaced with 9: GLSL has no run-time length of
 *  a `Range`. */
const nine = (json: Json): Json =>
  JSON.parse(JSON.stringify(json).replaceAll('"n"', '9'));
const interval = (json: Json) =>
  compile(box(json), {
    ...IR,
    to: 'interval-js',
  } as never) as unknown as Result;

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

function interpreted(json: Json, point: Point): number {
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
  return ce.withValues(values as never, () => box(json).evaluate().N().re);
}

function check(json: Json, points: Point[], options: object = {}) {
  const r = js(json, options);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  for (const p of points) {
    const got = r.run(p);
    const want = interpreted(json, p);
    if (!(Math.abs(got - want) <= 1e-12 * Math.max(1, Math.abs(want))))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${got}, the interpreter ${want}`
      );
  }
  return r;
}

const range = (k: string, ...bounds: Json[]) => [
  'Element',
  k,
  ['Range', ...bounds],
];
const add = (name: string, v: Json) => ['Assign', name, ['Add', name, v]];
/** The locals `s`, `c`, `t` (0), the statement `loop`, then `result`. */
const locals = (loop: Json, result: Json = 's') => [
  'Block',
  ['Declare', 's', 'real', 0],
  ['Declare', 'c', 'real', 0],
  ['Declare', 't', 'real', 0],
  loop,
  result,
];

/** The escape-time loop of the showcases: the count of passes before
 *  `|z|² > 4`, of at most `passes`. */
const escape = (passes: Json = 50) => [
  'Block',
  ['Declare', 'a', 'real', 'x'],
  ['Declare', 'b', 'real', 'y'],
  ['Declare', 'm', 'integer', 0],
  ['Declare', 'q', 'real', 0],
  ['Declare', 'u', 'real', 0],
  [
    'Loop',
    [
      'Block',
      ['Assign', 'q', ['Add', ['Square', 'a'], ['Square', 'b']]],
      ['If', ['Greater', 'q', 4], ['Block', ['Break']]],
      add('m', 1),
      [
        'Assign',
        'u',
        ['Add', ['Square', 'a'], ['Negate', ['Square', 'b']], 'x'],
      ],
      ['Assign', 'b', ['Add', ['Multiply', 2, 'a', 'b'], 'y']],
      ['Assign', 'a', 'u'],
    ],
    range('k', 1, passes),
  ],
  'm',
];

const GRID: Point[] = [];
for (let i = -8; i <= 4; i++)
  for (let j = -4; j <= 4; j++) GRID.push({ x: i / 4, y: j / 4 });
// Points that escape at pass 1.
GRID.push({ x: 3, y: 3 }, { x: -2.5, y: 0 });

const POINTS: Point[] = [
  { x: -1, y: 0, n: 0, L: [] },
  { x: 2.5, y: 1, n: 1, L: [1] },
  { x: 4, y: 2, n: 5, L: [1, 2, 3] },
  { x: 7.5, y: -1, n: 9, L: [3, 1, 4, 1, 5] },
  { x: 100, y: 3, n: 12, L: [2, 7, 1, 8, 2, 8] },
];

// prettier-ignore
const PROGRAMS: [string, Json][] = [
  ['a Break as the first statement',
    locals(['Loop', ['Block', ['Break'], add('s', 'k')], range('k', 1, 'n')])],
  ['a Break as the last statement',
    locals(['Loop', ['Block', add('s', 'k'), ['Break']], range('k', 1, 'n')])],
  ['a Break in both arms of an If',
    locals(['Loop', ['Block', add('s', 'k'),
      ['If', ['Greater', 's', 'x'], ['Block', ['Assign', 't', 1], ['Break']], ['Block', ['Assign', 't', 2], ['Break']]]],
      range('k', 1, 'n')], ['Add', 's', ['Multiply', 100, 't']])],
  ['a Break in a Which',
    locals(['Loop', ['Which',
      ['Greater', 'k', 'x'], ['Block', ['Assign', 't', 'k'], ['Break']],
      ['Greater', 's', 'y'], ['Block', ['Assign', 't', -1], ['Break']],
      'True', add('s', 'k')], range('k', 1, 'n')], ['Add', 's', ['Multiply', 100, 't']])],
  ['the statements after the If that breaks do not run in its pass',
    locals(['Loop', ['Block', add('s', 'k'), ['If', ['Greater', 's', 'x'], ['Break']], add('c', 1)],
      range('k', 1, 'n')], ['Add', 's', ['Multiply', 1000, 'c']])],
  ['each local keeps its value at the break',
    locals(['Loop', ['Block', ['Assign', 't', 'k'], ['If', ['GreaterEqual', 'k', 'x'], ['Break']], ['Assign', 'c', 'k'], add('s', ['Square', 'k'])],
      range('k', 1, 'n')], ['Add', ['Multiply', 10000, 't'], ['Multiply', 100, 'c'], 's'])],
  ['a Break in the inner of two Loops',
    locals(['Loop', ['Loop', ['Block', ['If', ['Greater', 'j', 'k'], ['Break']], add('s', ['Multiply', 'j', 'k'])],
      range('j', 1, 'n')], range('k', 1, 'n')])],
  ['a Break in the outer of two Loops',
    locals(['Loop', ['Block', ['Loop', add('s', 'j'), range('j', 1, 'k')], ['If', ['Greater', 's', 'x'], ['Break']], add('c', 1)],
      range('k', 1, 'n')], ['Add', 's', ['Multiply', 1000, 'c']])],
  ['a Break in a Loop of two clauses ends both',
    locals(['Loop', ['Block', ['If', ['Greater', 's', 'x'], ['Break']], add('s', ['Multiply', 'j', 'k'])],
      range('k', 1, 'n'), range('j', 1, 3)])],
  ['a Continue skips the rest of the pass',
    locals(['Loop', ['Block', ['If', ['Equal', ['Mod', 'k', 2], 0], ['Continue']], add('s', 'k'), add('c', 1)],
      range('k', 1, 'n')], ['Add', 's', ['Multiply', 1000, 'c']])],
  ['a Continue and a later Break',
    locals(['Loop', ['Block', ['If', ['Equal', ['Mod', 'k', 3], 0], ['Continue']], ['If', ['Greater', 's', 'x'], ['Break']], add('s', 'k')],
      range('k', 1, 'n')])],
  ['a Continue as the last statement of an arm',
    locals(['Loop', ['If', ['Greater', 'k', 'y'], ['Block', add('c', 1), ['Continue']], add('s', 'k')],
      range('k', 1, 'n')], ['Add', 's', ['Multiply', 1000, 'c']])],
  ['a Loop over a list input',
    locals(['Loop', ['Block', ['If', ['Greater', ['Add', 's', 'e'], 'x'], ['Break']], add('s', 'e')], ['Element', 'e', 'L']])],
  ['a Loop of a constant count',
    locals(['Loop', ['Block', add('s', 'k'), ['If', ['Greater', 's', 'x'], ['Break']]], range('k', 1, 10)])],
  ['a Loop of one pass',
    locals(['Loop', ['Block', ['If', ['Greater', 'x', 3], ['Break']], add('s', 'x')], range('k', 1, 1)])],
];

describe('IR profile, batch G23: Break and Continue against the interpreter', () => {
  test('the escape-time loop', () => {
    const r = check(escape(), GRID);
    expect(r.code).toMatch(/&& !v\d+/);
    // A point that never escapes: every pass runs; one that escapes at once.
    expect(r.run({ x: 0, y: 0 })).toBe(50);
    expect(r.run({ x: 3, y: 3 })).toBe(0);
  });
  test('a Break under a run-time bound, with zero passes', () => {
    check(escape('n'), [
      { x: 0, y: 0, n: 0 },
      { x: 0, y: 0, n: 1 },
      { x: 0.3, y: 0.5, n: 30 },
      { x: 0.3, y: 0.5, n: 3 },
    ]);
  });
  test.each(PROGRAMS)('%s', (_, json) => {
    check(json, POINTS);
  });
});

describe('IR profile, batch G23: what declines', () => {
  test.each([
    [
      locals([
        'Loop',
        ['If', ['Greater', 's', 3], ['Return', 's'], add('s', 'k')],
        range('k', 1, 9),
      ]),
      /Return/,
    ],
    [
      ['If', ['Greater', 'x', 3], ['Break'], 'x'],
      /a Break that is not a statement of a Loop body/,
    ],
    [
      ['Block', ['If', ['Greater', 'x', 3], ['Break']], 'x'],
      /a Break that is not a statement of a Loop body/,
    ],
    [
      locals([
        'Loop',
        ['Assign', 's', ['If', ['Greater', 'k', 'x'], ['Break'], 'k']],
        range('k', 1, 9),
      ]),
      /a Break that is not a statement of a Loop body/,
    ],
    [
      locals([
        'Loop',
        ['Apply', ['Function', ['Block', ['Break'], 'j'], 'j'], 'k'],
        range('k', 1, 9),
      ]),
      /a Break or a Continue in a function literal in a Loop/,
    ],
  ] as [Json, RegExp][])('%j', (json, cause) => {
    expect(failure(() => js(json))).toMatch(cause);
  });
});

describe('IR profile, batch G23: the iteration budget', () => {
  const stop = (k: number) =>
    locals([
      'Loop',
      ['Block', add('s', 'k'), ['If', ['GreaterEqual', 'k', k], ['Break']]],
      range('k', 1, 1_000_000),
    ]);
  test('a Loop that exits at pass 3 under a budget of 100 gives its value', () => {
    expect(js(stop(3), { iterationBudget: 100 }).run({})).toBe(6);
    expect(interpreted(stop(3), {})).toBe(6);
  });
  test('a Loop that does not exit within the budget throws, as the interpreter', () => {
    let error: unknown;
    try {
      js(stop(500), { iterationBudget: 100 }).run({});
    } catch (e) {
      error = e;
    }
    expect((error as { cause?: string }).cause).toBe(
      'iteration-limit-exceeded'
    );
    const limit = ce.iterationLimit;
    ce.iterationLimit = 100;
    try {
      expect(() => box(stop(500)).evaluate()).toThrow();
    } finally {
      ce.iterationLimit = limit;
    }
  });
  // An open search: a large bound and a `Break`. The guard before the first
  // pass is 2^53 passes for a loop with an exit.
  const search = (bound: Json) =>
    locals([
      'Loop',
      ['Block', add('s', 'k'), ['If', ['GreaterEqual', 'k', 5], ['Break']]],
      range('k', 1, bound),
    ]);
  test('a bound of 1e12, 2^32 or 2^53 with a Break at pass 5 gives its value', () => {
    expect(js(search(1e12)).run({})).toBe(15);
    expect(interpreted(search(1e12), {})).toBe(15);
    const r = js(search('n'));
    for (const n of [1e12, 2 ** 32, 2 ** 53]) expect(r.run({ n })).toBe(15);
    expect(() => r.run({ n: 2 ** 60 })).toThrow(/2\^53/);
  });
  test('the bigint mode, at n = 2^40', () => {
    const json = [
      'Block',
      ['Declare', 'm', 'integer', 0],
      [
        'Loop',
        ['Block', add('m', 'k'), ['If', ['GreaterEqual', 'k', 5], ['Break']]],
        range('k', 1, 'n'),
      ],
      'm',
    ];
    expect(js(json, { mode: 'bigint' }).run({ n: 2 ** 40 })).toBe(15n);
  });
  test('a large bound that never breaks throws past the budget', () => {
    const never = locals([
      'Loop',
      ['Block', add('s', 'k'), ['If', ['Less', 'k', 0], ['Break']]],
      range('k', 1, 1e12),
    ]);
    let error: unknown;
    try {
      js(never, { iterationBudget: 100 }).run({});
    } catch (e) {
      error = e;
    }
    expect((error as { cause?: string }).cause).toBe(
      'iteration-limit-exceeded'
    );
  });
});

describe('IR profile, batch G23: no count of passes that cannot reach the budget', () => {
  const counts = (r: Result) =>
    /countLoopPass/.test(
      r.code + ((r as { preambleOnce?: string }).preambleOnce ?? '')
    );
  const cancelled = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      return (e as { cause?: string }).cause;
    }
    return undefined;
  };
  test('a Loop of a constant count within the budget has no count', () => {
    const r = js(escape(), { iterationBudget: 100 });
    expect(counts(r)).toBe(false);
    expect(r.run({ x: 0, y: 0 })).toBe(50);
  });
  test('a run-time count keeps the count and throws past the budget', () => {
    const r = js(locals(['Loop', add('s', 'k'), range('k', 1, 'n')]), {
      iterationBudget: 100,
    });
    expect(counts(r)).toBe(true);
    expect(r.run({ n: 100 })).toBe(5050);
    expect(cancelled(() => r.run({ n: 101 }))).toBe('iteration-limit-exceeded');
  });
  test('nested Loops whose product exceeds the budget keep the count', () => {
    const nested = locals([
      'Loop',
      ['Loop', add('s', 1), range('j', 1, 20)],
      range('k', 1, 20),
    ]);
    // 20 outer passes and 400 inner ones.
    expect(counts(js(nested, { iterationBudget: 420 }))).toBe(false);
    const r = js(nested, { iterationBudget: 300 });
    expect(counts(r)).toBe(true);
    expect(cancelled(() => r.run({}))).toBe('iteration-limit-exceeded');
  });
  test('a Loop in a user function called in a Sum', () => {
    const engine = new ComputeEngine();
    engine.declare('f', 'function');
    engine.assign(
      'f',
      engine.box([
        'Function',
        locals(['Loop', add('s', ['Multiply', 'k', 'u']), range('k', 1, 100)]),
        'u',
      ] as never)
    );
    const sum = engine.box(['Sum', ['f', 'j'], ['Limits', 'j', 1, 3]] as never);
    const run = (budget: number) =>
      compile(sum, {
        ...IR,
        iterationBudget: budget,
      } as never) as unknown as Result;
    // The sum of 3 passes is written out (no pass of its own): the 100
    // passes of each of the 3 calls.
    expect(counts(run(300))).toBe(false);
    expect(run(300).run({})).toBe(5050 * 6);
    expect(counts(run(299))).toBe(true);
  });
});

describe('IR profile, batch G23: a Loop that runs once per element keeps its count', () => {
  // A `Loop` of 10 passes in a function mapped over 50 elements runs 500
  // passes: the bound of the passes does not know the number of elements.
  const body = (e: string): Json =>
    locals(['Loop', add('s', ['Multiply', 'k', e]), range('k', 1, 10)]);
  const cause = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      return (e as { cause?: string }).cause;
    }
    return undefined;
  };
  const M = Array.from({ length: 50 }, (_, i) => i + 1);
  test('in the callback of a Map, in a function of a scalar called with a list, in an integrand', () => {
    const engine = new ComputeEngine();
    engine.declare('M', 'list<real^50>');
    engine.declare('f', '(real) -> real');
    engine.assign('f', engine.box(['Function', body('a'), 'a'] as never));
    const run = (json: Json, budget: number) =>
      compile(engine.box(json as never), {
        ...IR,
        iterationBudget: budget,
      } as never) as unknown as Result;
    const mapped: Json = ['Max', ['Map', ['Function', body('e'), 'e'], 'M']];
    for (const json of [mapped, ['Max', ['f', 'M']]]) {
      const r = run(json, 100);
      expect(cause(() => r.run({ M }))).toBe('iteration-limit-exceeded');
      expect(run(json, 1000).run({ M })).toBe(2750);
    }
    const integral: Json = ['NIntegrate', ['Function', body('e'), 'e'], 0, 1];
    expect(cause(() => run(integral, 100).run({}))).toBe(
      'iteration-limit-exceeded'
    );
  });
});

describe('IR profile, batch G23: the deadline count of a loop that exits', () => {
  /** The arguments of each `_SYS.tick()` call of one run of `r`. */
  const ticksOf = (r: Result, inputs: object): number[] => {
    const calls: number[] = [];
    const sys = Object.create(runtimeOf(ce));
    sys.tick = (n = 1) => void calls.push(n);
    twoStageRunner(sys, '', ['_'], `return ${r.code};`)(inputs);
    return calls;
  };
  const json = locals([
    'Loop',
    ['Block', add('s', 'k'), ['If', ['GreaterEqual', 'k', 'x'], ['Break']]],
    range('k', 1, 5000),
  ]);
  test('the passes run are charged, the breaking one included', () => {
    const r = js(json);
    expect(ticksOf(r, { x: 3 })).toEqual([3]);
    expect(ticksOf(r, { x: 1500 })).toEqual([1024, 476]);
    expect(ticksOf(r, { x: 10_000 })).toEqual([1024, 1024, 1024, 1024, 904]);
  });
  test('a loop with no exit charges whole blocks', () => {
    const r = js(locals(['Loop', add('s', 'k'), range('k', 1, 1500)]));
    expect(r.code).toMatch(/_SYS\.tick\(v\d+_i_e - v\d+_i_b\)/);
    expect(ticksOf(r, {})).toEqual([1024, 476]);
  });
});

describe('IR profile, batch G23: a seeded draw in the loop', () => {
  const seeded = (withBreak: boolean) => [
    'WithRandomSeed',
    7,
    locals(
      [
        'Loop',
        [
          'Block',
          add('s', ['Random']),
          ...(withBreak ? [['If', ['Greater', 's', 'x'], ['Break']]] : []),
          add('c', ['Random']),
        ],
        range('k', 1, 20),
      ],
      ['Add', 's', ['Multiply', 1000, 'c']]
    ),
  ];
  test('the interpreter draws, and the warnings of the loop without a Break', () => {
    const r = check(seeded(true), [{ x: 2 }, { x: 4.5 }, { x: 100 }]);
    const plain = js(seeded(false));
    expect(r.warnings).toEqual(plain.warnings);
    // With no break, the two agree.
    expect(r.run({ x: 100 })).toBe(plain.run({ x: 100 }));
  });
});

describe('IR profile, batch G23: GLSL and the interval mode', () => {
  test('the GLSL text of the escape-time loop', () => {
    const r = glsl(escape());
    expect(r.code).toMatch(/^bool v\d+ = false;$/m);
    expect(r.code).toMatch(
      /for \(int (\w+) = int\(clamp\(0\.0, [^;]*\); \1 <= \w+ && !v\d+; \1\+\+\) \{/
    );
  });
  // A list input, and an inner `Range` of a run-time bound, need run-time
  // lengths, which GLSL has not.
  test.each(
    PROGRAMS.filter(
      ([, json]) => !/"L"|"Range",1,"k"/.test(JSON.stringify(json))
    )
  )('GLSL compiles %s', (_, json) => {
    expect(glsl(nine(json)).success).toBe(true);
  });
  test('interval-js: a point box is the JavaScript value', () => {
    const r = interval(escape());
    expect(r.code).toMatch(/&& !_IA\.decided\(v\d+\)/);
    const f = js(escape());
    for (const p of [
      { x: 0, y: 0 },
      { x: 0.3, y: 0.5 },
      { x: 3, y: 3 },
      { x: -0.75, y: 0.25 },
    ])
      expect(
        r.run({ x: { lo: p.x, hi: p.x }, y: { lo: p.y, hi: p.y } })
      ).toEqual({
        kind: 'interval',
        value: { lo: f.run(p), hi: f.run(p) },
      });
  });
  test('interval-js: a box with points that escape and points that do not', () => {
    const r = interval(escape());
    const f = js(escape());
    for (const [x0, x1, y0, y1] of [
      [-0.5, 0.5, -0.5, 0.5],
      [0.2, 0.4, 0.4, 0.6],
      [1, 3, 1, 3],
    ]) {
      const v = r.run({ x: { lo: x0, hi: x1 }, y: { lo: y0, hi: y1 } });
      if (v.kind === 'entire') continue;
      for (let i = 0; i <= 4; i++)
        for (let j = 0; j <= 4; j++) {
          const w = f.run({
            x: x0 + ((x1 - x0) * i) / 4,
            y: y0 + ((y1 - y0) * j) / 4,
          });
          expect(v.value.lo <= w && w <= v.value.hi).toBe(true);
        }
    }
    // A box of points that never escape, and one of points that escape at once.
    expect(r.run({ x: { lo: 0, hi: 0.01 }, y: { lo: 0, hi: 0.01 } })).toEqual({
      kind: 'interval',
      value: { lo: 50, hi: 50 },
    });
    // A box whose points escape at several passes: the whole range.
    expect(
      r.run({ x: { lo: 0.2, hi: 0.6 }, y: { lo: 0.2, hi: 0.6 } }).kind
    ).toBe('entire');
    expect(r.run({ x: { lo: 3, hi: 4 }, y: { lo: 3, hi: 4 } })).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 0 },
    });
  });
  test.each(
    PROGRAMS.filter(([, json]) => !JSON.stringify(json).includes('"L"'))
  )('interval-js compiles %s', (_, json) => {
    expect(interval(json).success).toBe(true);
  });
});

describe('IR profile, batch G23: an exit undecided at the last pass', () => {
  // The flag is undecided only at pass 3, after which the loop ends by its
  // bound: `decided()` is not called again, and the code after the loop
  // reads the hull of both arms of that pass.
  const json = locals(
    [
      'Loop',
      [
        'Block',
        add('s', 'x'),
        ['If', ['Greater', 's', 2.5], ['Break']],
        add('c', 1),
      ],
      range('k', 1, 3),
    ],
    ['Add', 's', ['Multiply', 100, 'c']]
  );
  test('the result encloses the value of every point of the box', () => {
    const f = check(json, [{ x: 0.8 }, { x: 0.9 }]);
    expect([f.run({ x: 0.8 }), f.run({ x: 0.9 })]).toEqual([302.4, 202.7]);
    const v = interval(json).run({ x: { lo: 0.8, hi: 0.9 } });
    expect(v.kind).toBe('interval');
    for (let i = 0; i <= 10; i++) {
      const w = f.run({ x: 0.8 + i / 100 });
      expect(v.value.lo <= w && w <= v.value.hi).toBe(true);
    }
  });
});

describe('IR profile, batch G23: programs that the existing compilers decline', () => {
  // `compile-loop-destructuring.test.ts`: the existing JavaScript compiler
  // declines a `Break` in a Loop of two clauses; the interpreter stops both.
  const twoClauses = (body: Json) => [
    'Block',
    ['Declare', 's', ['Dictionary', ['KeyValuePair', 'value', 0]]],
    ['Loop', body, range('i', 1, 3), range('j', 1, 3)],
    's',
  ];
  test.each([
    [twoClauses(['Block', add('s', 1), ['Break']]), 1],
    [
      twoClauses([
        'Block',
        ['If', ['Less', 's', 0], ['Continue']],
        add('s', 1),
        ['Break'],
      ]),
      1,
    ],
    [
      twoClauses([
        'Block',
        add('s', 1),
        ['If', ['GreaterEqual', 's', 2], ['Break']],
        ['If', ['Less', 's', 0], ['Continue']],
      ]),
      2,
    ],
  ] as [Json, number][])('%j is %d', (json, value) => {
    expect(js(json).run({})).toBe(value);
    expect(interpreted(json, {})).toBe(value);
  });
  // `compile-gpu-loop-jumps.test.ts`: the existing GLSL target declines a
  // `Break` beside an else branch and a `Continue`.
  const counter = (first: Json) => [
    'Block',
    ['Declare', 'a', "'unknown'", 0],
    ['Declare', 'm', "'unknown'", 0],
    ['Loop', ['Block', first, add('a', 'x'), add('m', 1)], range('k', 1, 8)],
    'm',
  ];
  const escaped = ['Greater', 'a', 4];
  test.each([
    ['If(c, Break(), Nothing)', ['If', escaped, ['Break'], 'Nothing']],
    [
      'a Break beside an else branch',
      ['If', escaped, ['Break'], ['Assign', 'm', 100]],
    ],
    ['If(c, Continue())', ['If', escaped, ['Continue']]],
  ])('%s', (_, first) => {
    check(counter(first), [{ x: 0.5 }, { x: 1 }, { x: 3 }]);
    expect(glsl(counter(first)).success).toBe(true);
  });
});

describe('IR profile, batch G23: robustness', () => {
  test('a body with 30 conditional breaks', () => {
    const body = [
      'Block',
      ...Array.from({ length: 30 }, (_, i) => [
        'Block',
        ['If', ['Greater', 's', ['Add', 'x', i]], ['Break']],
        add('s', ['Multiply', 'k', i + 1]),
      ]),
    ];
    const json = locals(['Loop', body, range('k', 1, 'n')]);
    check(json, POINTS);
    expect(glsl(nine(json)).success).toBe(true);
  });
  test('three nested loops, each with a break', () => {
    const json = locals([
      'Loop',
      [
        'Block',
        [
          'Loop',
          [
            'Block',
            [
              'Loop',
              [
                'Block',
                ['If', ['Greater', 'i', 'j'], ['Break']],
                add('s', ['Multiply', 'i', 'j', 'k']),
              ],
              range('i', 1, 'n'),
            ],
            ['If', ['Greater', 'j', 'k'], ['Break']],
          ],
          range('j', 1, 'n'),
        ],
        ['If', ['Greater', 's', ['Multiply', 10, 'x']], ['Break']],
      ],
      range('k', 1, 'n'),
    ]);
    check(json, POINTS);
    expect(glsl(nine(json)).success).toBe(true);
    expect(interval(json).success).toBe(true);
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

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, batch G23: Break in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    const programs: [string, Json, Point[]][] = [
      ['the escape-time loop', escape(), GRID.slice(0, 40)],
      ['a Continue and a later Break', nine(PROGRAMS[10][1]), POINTS],
      ['a Break in a Which', nine(PROGRAMS[3][1]), POINTS],
    ];

    test.each(programs)(
      '%s agrees with JavaScript',
      async (_, json, points) => {
        const r = glsl(json);
        const f = js(json);
        const source = (body: string) =>
          [
            '#version 300 es',
            'precision highp float;',
            'uniform float u_x;',
            'uniform float u_y;',
            'uniform float u_n;',
            'out vec4 fragColor;',
            r.preamble ?? '',
            'float userFn(float x, float y, float n) {',
            body,
            '}',
            'void main() { fragColor = vec4(userFn(u_x, u_y, u_n), 0.0, 0.0, 0.0); }',
          ].join('\n');
        const items = points.map((p) => ({
          name: JSON.stringify(p),
          source: source(r.code),
          uniforms: { u_x: p.x, u_y: p.y, u_n: p.n ?? 0 } as Record<
            string,
            number
          >,
          expected: f.run(p) as number,
        }));
        const values = await driver.evaluate(items);
        for (const [i, v] of values.entries()) {
          if (!v.ok) throw new Error(v.log);
          expect(Math.abs(v.value - items[i].expected)).toBeLessThanOrEqual(
            1e-5 * Math.max(1, Math.abs(items[i].expected))
          );
        }
      },
      120_000
    );
  }
);
