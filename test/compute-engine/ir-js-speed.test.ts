/**
 * The JavaScript spelling of the loops and builds of the profile `ir`
 * (batch G15; "Loops and the runtime" in the README of
 * `src/compute-engine/compilation/ir/`):
 *
 * - A build is an array of its length filled by a `for` loop in index
 *   order; a chain of element-wise operations of one shape is one loop.
 * - A loop or a build adds its passes to the deadline count of the runtime
 *   (`_SYS.tick(n)`, on the deadline frame), which checks the deadline every
 *   1024 passes, across calls; the old spelling `_SYS.tick()` counts one.
 * - A loop counts its passes, so it ends for any bounds (`k++` does not
 *   advance from 2^53).
 * - A constant bound of a `Sum` or a `Product` beyond 2^53 − 1 declines.
 * - The three robustness tests.
 *
 * Speed is measured, not asserted: the only time limits are hang guards.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';
import type { Expression } from '../../src/compute-engine/global-types';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import {
  createJavaScriptRuntime,
  twoStageRunner,
  type StoredJavaScript,
} from '../../src/compute-engine/compilation/javascript-runtime';
import { runtimeOf } from '../../src/compute-engine/compilation/ir/print-js';

type Json = unknown;
type Point = Record<string, number | number[]>;

const ce = new ComputeEngine();
ce.declare('x', 'real');
for (const name of ['n', 'm']) ce.declare(name, 'integer');
ce.declare('L', 'list<real>');
ce.declare('V', 'list<real^4>');

const IR = { profile: 'ir', fallback: false } as const;
const js = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { ...IR, ...options });
const glsl = (json: Json) =>
  compile(ce.box(json as never), { ...IR, to: 'glsl' });

/** The text of a compilation, its helpers and user functions included. */
const textOf = (r: { code: string; preamble?: string }) =>
  `${r.preamble ?? ''}\n${r.code}`;

/** The message of the decline of `f`, or `undefined`. */
function declined(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as Error).message;
  }
  return undefined;
}

function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  // A lazy collection (a Map) is read element by element.
  if (e.isCollection) return Array.from(e.each(), (x) => read(x.N()));
  throw new Error(`no value: ${e.toString()}`);
}

const literal = (v: unknown): Expression =>
  Array.isArray(v)
    ? ce.function('List', v.map(literal))
    : ce.number(v as number);

/** The interpreter's value of `json` with the inputs of `point`. */
function interpreted(json: Json, point: Point): unknown {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, literal(v)])
  );
  return ce.withValues(values as never, () =>
    read(
      ce
        .box(json as never)
        .evaluate()
        .N()
    )
  );
}

function agree(v: unknown, w: unknown, tolerance = 1e-12): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x, tolerance))
    );
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    Math.abs(v - w) <= tolerance * Math.max(1, Math.abs(w))
  );
}

/** The value of each point agrees with the interpreter; the result. */
function check(json: Json, points: Point[]) {
  const r = js(json);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  for (const point of points) {
    const got = r.run!(point as never);
    expect(Array.isArray(got) ? Object.keys(got).length : 0).toBe(
      Array.isArray(got) ? got.length : 0
    );
    expect([point, agree(got, interpreted(json, point))]).toEqual([
      point,
      true,
    ]);
  }
  return r;
}

const list = (n: number) => Array.from({ length: n }, (_, i) => (i - 7) / 10);

describe('IR profile, batch G15: builds', () => {
  test('an element-wise chain of one shape is one loop over an array of its length', () => {
    const json = ['Add', ['Multiply', 2, 'L'], 1];
    const r = check(json, [{ L: [] }, { L: [3] }, { L: list(1000) }]);
    const text = textOf(r);
    expect(text).not.toMatch(/Array\.from\(\{ length/);
    expect(text.match(/new Array\(/g)).toHaveLength(1);
    expect(text).toMatch(/_r\[i0\] = \(\(2 \* _\.L\[i0\]\) \+ 1\)/);
    // Blocks of at most 1024 passes, one call of the runtime after each.
    expect(text).toMatch(
      /for \(let i0_b = 0, i0_e = Math\.min\(1024, _n\); i0_b < _n; _SYS\.tick\(i0_e - i0_b\), i0_b = i0_e, i0_e = Math\.min\(i0_b \+ 1024, _n\)\) for \(let i0 = i0_b; i0 < i0_e; i0\+\+\) \{ _r\[i0\]/
    );
    expect(text.match(/_SYS\.tick/g)).toHaveLength(1);
  });

  test('a Map and a build over a Range fill an array of their length', () => {
    const map = check(
      ['Map', ['Function', ['Sin', 'u'], 'u'], 'L'],
      [{ L: [] }, { L: [0.5] }, { L: list(1000) }]
    );
    expect(textOf(map)).toMatch(/= new Array\(v\d+_n\);/);
    expect(textOf(map)).not.toMatch(/\.push\(/);
    check(
      ['Multiply', 2, ['Range', 1, 'n']],
      [{ n: 0 }, { n: 1 }, { n: 1000 }]
    );
    // A Filter pushes the elements it keeps.
    const filter = check(
      ['Filter', 'L', ['Function', ['Greater', 'u', 0], 'u']],
      [{ L: [] }, { L: [-1] }, { L: list(1000) }]
    );
    expect(textOf(filter)).toMatch(/\.push\(/);
  });

  test('a nested build: a list of points and the rows of a rank-2 operation', () => {
    ce.declare('P', 'list<tuple<real, real>>');
    // The norm of each point (the interpreter's `Abs` of a point).
    const points = js(['Abs', 'P']);
    const P = Array.from({ length: 1000 }, (_, i) => [i, i / 2]);
    expect(points.run!({ P: [] } as never)).toEqual([]);
    expect(points.run!({ P: [[3, 4]] } as never)).toEqual([5]);
    expect(
      agree(
        points.run!({ P } as never),
        P.map(([u, v]) => Math.sqrt(u * u + v * v))
      )
    ).toBe(true);
    expect(textOf(points)).not.toMatch(/Array\.from\(\{ length/);
    ce.declare('Q', 'list<list<real^2>>');
    const rows = js(['Add', ['Multiply', 2, 'Q'], 1]);
    expect(
      rows.run!({
        Q: [
          [1, 2],
          [3, 4],
        ],
      } as never)
    ).toEqual([
      [3, 5],
      [7, 9],
    ]);
    expect(rows.run!({ Q: [] } as never)).toEqual([]);
    // Two loops, one inside the other, and one array per level.
    expect(textOf(rows).match(/for \(let i\d = /g)).toHaveLength(2);
  });

  test('seeded draws in a build and in a loop give the interpreter sequence', () => {
    // The interpreter keeps a Map with a draw unevaluated: its Sum reads
    // the elements in order.
    const map = ['Map', ['Function', ['Add', 'u', ['Random']], 'u'], 'L'];
    const sum = ['WithRandomSeed', 7, ['Sum', map]];
    const point = { L: list(20) };
    const want = interpreted(sum, point) as number;
    expect(agree(js(sum).run!(point as never), want)).toBe(true);
    const elements = js(['WithRandomSeed', 7, map]).run!(
      point as never
    ) as number[];
    expect(elements).toHaveLength(20);
    expect(
      agree(
        elements.reduce((a, b) => a + b, 0),
        want
      )
    ).toBe(true);
    const loop = [
      'WithRandomSeed',
      7,
      ['Sum', ['Multiply', 'k', ['Random']], ['Limits', 'k', 1, 'n']],
    ];
    const got = js(loop).run!({ n: 50 } as never) as number;
    expect(agree(got, interpreted(loop, { n: 50 }))).toBe(true);
  });
});

describe('IR profile, batch G15: the deadline', () => {
  /** `f` throws a cancellation of `cause` within the hang guard. */
  const stops = (f: () => unknown, cause = 'timeout') => {
    const start = performance.now();
    let thrown: unknown;
    try {
      f();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CancellationError);
    expect((thrown as CancellationError).cause).toBe(cause);
    // A hang guard, not a measure.
    expect(performance.now() - start).toBeLessThan(30_000);
  };
  const sum = js([
    'Sum',
    ['Sin', ['Multiply', 'k', 'x']],
    ['Limits', 'k', 1, 'n'],
  ]);

  test('a long loop, a long build and a nest of short loops stop', () => {
    stops(() =>
      ce.withTimeLimit(50, () => sum.run!({ x: 0.5, n: 2 ** 31 } as never))
    );
    // A build of 2^31 elements: the deadline stops it before it ends.
    const build = js([
      'Map',
      ['Function', ['Sin', 'u'], 'u'],
      ['Range', 1, 'n'],
    ]);
    stops(() =>
      ce.withTimeLimit(50, () => build.run!({ n: 2 ** 31 } as never))
    );
    const nested = js([
      'Sum',
      [
        'Sum',
        ['Sum', ['Multiply', 'i', 'j', 'k'], ['Limits', 'k', 1, 1000]],
        ['Limits', 'j', 1, 1000],
      ],
      ['Limits', 'i', 1, 1000],
    ]);
    stops(() => ce.withTimeLimit(50, () => nested.run!({} as never)));
  });

  test('short calls add up: a batch, repeated calls, a user function', () => {
    // 2e5 cells of 500 passes each.
    stops(() =>
      ce.withTimeLimit(50, () =>
        sum.broadcast!({ x: new Float64Array(200_000).fill(0.5), n: 500 })
      )
    );
    stops(() =>
      ce.withTimeLimit(50, () => {
        for (let i = 0; i < 200_000; i++) sum.run!({ x: 0.5, n: 500 } as never);
      })
    );
    const engine = new ComputeEngine();
    engine.declare('g', '(real) -> real');
    engine.assign(
      'g',
      engine.box([
        'Function',
        ['Sum', ['Sin', ['Multiply', 'k', 'u']], ['Limits', 'k', 1, 100]],
        'u',
      ] as never)
    );
    engine.declare('n', 'integer');
    const calls = compile(
      engine.box(['Sum', ['g', 'i'], ['Limits', 'i', 1, 'n']] as never),
      IR
    );
    expect(calls.profile).toBe('ir');
    stops(() =>
      engine.withTimeLimit(50, () => calls.run!({ n: 2 ** 31 } as never))
    );
  });

  test('a re-entrant call through a vars text counts on the same frame', () => {
    const r = compile(
      ce.box(['Sum', ['Multiply', 'k', 'w'], ['Limits', 'k', 1, 'n']] as never),
      { ...IR, vars: { w: '_.f()' } }
    );
    // Each pass of the outer loop calls the same code for 3 passes.
    const f = () => (r.run!({ n: 3, f: () => 0 } as never) as number) * 0;
    stops(() => ce.withTimeLimit(50, () => r.run!({ n: 2 ** 31, f } as never)));
  });

  test('a loaded copy stops at the deadline of its runtime', () => {
    const runtime = createJavaScriptRuntime();
    const f = runtime.load({
      code: sum.code,
      preamble: sum.preamble,
      runtimeVersion: sum.runtimeVersion,
      calling: sum.calling,
    } as StoredJavaScript);
    expect(f({ x: 0.5, n: 10 })).toBe(sum.run!({ x: 0.5, n: 10 } as never));
    runtime.deadline = Date.now() + 50;
    stops(() => f({ x: 0.5, n: 2 ** 31 }));
    runtime.deadline = undefined;
  });

  test('a step budget counts the passes of every call in its span', () => {
    const r = js(['Sum', 'k', ['Limits', 'k', 1, 'n']]);
    // 600 passes: no multiple of 1024 is crossed in a span of one call.
    for (let call = 0; call < 6; call++)
      expect(
        ce.withStepBudget({ steps: 0 }, () => r.run!({ n: 600 } as never))
      ).toBe(180300);
    // 100 calls of 600 passes cross 58 multiples of 1024.
    stops(
      () =>
        ce.withStepBudget({ steps: 3 }, () => {
          for (let i = 0; i < 100; i++) r.run!({ n: 600 } as never);
        }),
      'step-budget'
    );
    // 58 steps are enough.
    expect(
      ce.withStepBudget({ steps: 58 }, () => {
        for (let i = 0; i < 100; i++) r.run!({ n: 600 } as never);
        return 'done';
      })
    ).toBe('done');
  });

  test('with no limit nothing throws', () => {
    expect(typeof sum.run!({ x: 0.5, n: 3_000_000 } as never)).toBe('number');
    for (let i = 0; i < 10_000; i++) sum.run!({ x: 0.5, n: 500 } as never);
  });

  test('code of the old spelling, a tick() of no argument per pass, counts one pass per call', () => {
    const runner = twoStageRunner(
      runtimeOf(ce),
      '',
      ['_'],
      'let s = 0; for (let k = 0; k < _.n; k++) { _SYS.tick(); s += k; } return s;'
    );
    expect(ce.withStepBudget({ steps: 0 }, () => runner({ n: 1023 }))).toBe(
      (1023 * 1022) / 2
    );
    stops(
      () => ce.withStepBudget({ steps: 0 }, () => runner({ n: 1024 })),
      'step-budget'
    );
  });
});

describe('IR profile, batch G15: the count of the passes', () => {
  /** The arguments of each `_SYS.tick()` call of one run of `r` at
   *  `inputs`, in a runtime whose `tick` records them. */
  const ticksOf = (
    r: { code: string; preambleOnce?: string },
    inputs: object
  ): number[] => {
    const calls: number[] = [];
    const sys = Object.create(runtimeOf(ce));
    sys.tick = (n = 1) => void calls.push(n);
    twoStageRunner(
      sys,
      r.preambleOnce ?? '',
      ['_'],
      `return ${r.code};`
    )(inputs);
    return calls;
  };
  const programs: [string, Json, object, (p: number) => object, number][] = [
    ['a sum', ['Sum', 'k', ['Limits', 'k', 1, 'n']], {}, (p) => ({ n: p }), 1],
    [
      'a build',
      ['Map', ['Function', ['Sin', 'u'], 'u'], 'L'],
      {},
      (p) => ({ L: list(p) }),
      1,
    ],
    [
      'a filter',
      ['Filter', 'L', ['Function', ['Greater', 'u', 0], 'u']],
      {},
      (p) => ({ L: list(p) }),
      1,
    ],
    // Each pass of the outer loop runs 101 passes of the inner one (a sum
    // of at most 100 passes is written out, with no loop).
    [
      'a nest',
      [
        'Sum',
        ['Sum', ['Multiply', 'i', 'j'], ['Limits', 'j', 1, 101]],
        ['Limits', 'i', 1, 'n'],
      ],
      {},
      (p) => ({ n: p }),
      102,
    ],
    [
      'the bigint mode',
      ['Sum', ['Multiply', 'k', 'm'], ['Limits', 'k', 1, 'n']],
      { mode: 'bigint' },
      (p) => ({ n: p, m: 2 }),
      1,
    ],
  ];
  test.each(programs)(
    '%s counts every pass, at most 1024 at a call',
    (_label, json, options, inputs, factor) => {
      const r = js(json, options);
      for (const p of [0, 1, 1023, 1024, 1025, 2048, 5000]) {
        const calls = ticksOf(r, inputs(p));
        expect([p, calls.reduce((a, b) => a + b, 0)]).toEqual([p, factor * p]);
        expect(calls.every((n) => n > 0 && n <= 1024)).toBe(true);
      }
    }
  );

  test('the count of the runtime stays modulo 1024: from 2^53 it still advances', () => {
    const sys = runtimeOf(ce);
    expect(
      ce.withStepBudget({ steps: 0 }, () => {
        (
          ce as unknown as { _deadlineFrame: { tick?: number } }
        )._deadlineFrame.tick = 2 ** 53;
        for (let i = 0; i < 1023; i++) sys.tick();
        return 'no step';
      })
    ).toBe('no step');
    expect(() =>
      ce.withStepBudget({ steps: 0 }, () => {
        (
          ce as unknown as { _deadlineFrame: { tick?: number } }
        )._deadlineFrame.tick = 2 ** 53;
        for (let i = 0; i < 1024; i++) sys.tick();
      })
    ).toThrow(CancellationError);
    // A count of more than 1024 at one call checks once.
    expect(() => ce.withStepBudget({ steps: 0 }, () => sys.tick(5000))).toThrow(
      CancellationError
    );
    expect(
      ce.withStepBudget({ steps: 1 }, () => {
        sys.tick(5000);
        return 'one step';
      })
    ).toBe('one step');
  });
});

describe('IR profile, batch G15: loops end', () => {
  test('one definition of each loop index, as lo + i of a count of passes', () => {
    const r = check(
      ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 'n']],
      [
        { x: 0.5, n: 0 },
        { x: 0.5, n: 1 },
        { x: 0.5, n: 1000 },
      ]
    );
    const text = textOf(r);
    expect(text).toMatch(
      /for \(let (v\d+)_i = \1_i_b; \1_i < \1_i_e; \1_i\+\+\) \{\n\s+const \1 = \1_lo \+ \1_i;/
    );
    expect(text).not.toMatch(/for \(let (v\d+) = \1_lo/);
  });

  test('a Sum with run-time bounds 2^53 and 2^53 + 2 returns', () => {
    const json = [
      'Sum',
      ['Sin', ['Add', 'x', 'k']],
      ['Limits', 'k', 'n', ['Add', 'n', 2]],
    ];
    const start = performance.now();
    const got = js(json).run!({ x: 0.5, n: 2 ** 53 } as never);
    // The value from 2^53 is unspecified; the loop ends.
    expect(typeof got).toBe('number');
    // The Loop of a carried value, and a Loop over a Range.
    const loop = js([
      'Block',
      ['Declare', 's', { dict: { value: 0 } }],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', 1]],
        ['Element', 'k', ['Range', 'n', ['Add', 'n', 2]]],
      ],
      's',
    ]);
    expect(typeof loop.run!({ n: 2 ** 53 } as never)).toBe('number');
    // A hang guard, not a measure.
    expect(performance.now() - start).toBeLessThan(30_000);
  });

  test('a constant bound beyond 2^53 - 1 declines on both targets', () => {
    const json = [
      'Sum',
      ['Sin', ['Add', 'x', 'k']],
      ['Limits', 'k', 9007199254740992, 9007199254740994],
    ];
    // The interpreter's error.
    expect(
      ce
        .box(json as never)
        .evaluate()
        .toString()
    ).toMatch(/out-of-range/);
    expect(declined(() => js(json))).toMatch(
      /a bound that is a constant beyond 2\^53 - 1/
    );
    expect(declined(() => glsl(json))).toMatch(
      /a bound that is a constant beyond 2\^53 - 1/
    );
    expect(
      declined(() =>
        js(['Product', 'k', ['Limits', 'k', -9007199254740994, 1]])
      )
    ).toMatch(/a bound that is a constant beyond 2\^53 - 1/);
    // 2^53 - 1 compiles.
    expect(
      js(['Sum', 'k', ['Limits', 'k', 9007199254740991, 9007199254740991]])
        .run!({} as never)
    ).toBe(9007199254740991);
  });

  test('the bigint mode counts with a bigint and gives exact values', () => {
    const json = [
      'Sum',
      ['Multiply', 'k', 'm'],
      ['Limits', 'k', 'n', ['Add', 'n', 2]],
    ];
    const r = js(json, { mode: 'bigint' });
    expect(textOf(r)).toMatch(
      /for \(let (v\d+)_i_b = 0n, .* for \(let \1_i = \1_i_b; \1_i < \1_i_e; \1_i\+\+\)/
    );
    const n = 2n ** 60n;
    expect(r.run!({ m: 3, n } as never)).toBe(3n * (3n * n + 3n));
    // A constant bound beyond 2^53 - 1 compiles in this mode, exactly.
    const big = js(
      [
        'Sum',
        ['Multiply', 'k', 'm'],
        ['Limits', 'k', 9007199254740990, 9007199254740992],
      ],
      { mode: 'bigint' }
    );
    expect(big.run!({ m: 3 } as never)).toBe(3n * 27021597764222973n);
    const build = js(
      ['Map', ['Function', ['Multiply', 'u', 'u'], 'u'], ['Range', 1, 'n']],
      { mode: 'bigint' }
    );
    expect(build.run!({ n: 4 } as never)).toEqual([1n, 4n, 9n, 16n]);
    // Range(1, 0) is [1, 0], as in the interpreter.
    expect(build.run!({ n: 0 } as never)).toEqual([1n, 0n]);
  });

  test('GLSL loops count with a clamped int', () => {
    const r = glsl([
      'Sum',
      ['Sin', ['Add', 'x', 'k']],
      ['Limits', 'k', 'n', ['Add', 'n', 2]],
    ]);
    expect(r.code).toMatch(/for \(int v\d+_i = int\(clamp\(/);
  });
});

describe('IR profile, batch G15: robustness', () => {
  const x = ce.box('x');

  test('a shared graph of 2^20 paths of element-wise operations', () => {
    let e: Expression = ce.box('V');
    for (let i = 0; i < 20; i++)
      e = ce.function('Add', [
        ce.function('Multiply', [ce.number(0.5), e]),
        ce.function('Sin', [e]),
      ]);
    for (const to of ['javascript', 'glsl'] as const) {
      const start = performance.now();
      const r = compile(e, { ...IR, to });
      expect(textOf(r).length).toBeLessThan(40_000);
      // A guard against a walk by paths (a hang), not a measure.
      expect(performance.now() - start).toBeLessThan(30_000);
    }
    const want = (v: number) => {
      for (let i = 0; i < 20; i++) v = 0.5 * v + Math.sin(v);
      return v;
    };
    const V = [0.5, -1, 2, 0];
    const got = compile(e, IR).run!({ V } as never) as number[];
    expect(agree(got, V.map(want))).toBe(true);
  });

  test('a chain of 1,000 element-wise operands', () => {
    const sum = ce.function(
      'Add',
      Array.from({ length: 1_000 }, (_, i) =>
        ce.function('Multiply', [
          ce.number(i + 1),
          ce.function('Add', [ce.box('L'), x]),
        ])
      )
    );
    const start = performance.now();
    const r = compile(sum, IR);
    expect(textOf(r).length).toBeLessThan(400_000);
    expect(performance.now() - start).toBeLessThan(30_000);
    const got = r.run!({ L: [1, 2], x: 0.5 } as never) as number[];
    const total = 500 * 1001;
    expect(agree(got, [1.5 * total, 2.5 * total])).toBe(true);
  });

  test('nested loops and builds', () => {
    const json = [
      'Sum',
      [
        'Sum',
        ['Multiply', ['Sin', 'i'], ['Max', ['Add', 'L', 'j']]],
        ['Limits', 'j', 1, 'n'],
      ],
      ['Limits', 'i', 1, 'n'],
    ];
    const start = performance.now();
    check(json, [
      { n: 0, L: [1] },
      { n: 3, L: [0.5, 2] },
      { n: 30, L: list(10) },
    ]);
    expect(performance.now() - start).toBeLessThan(30_000);
  });
});
