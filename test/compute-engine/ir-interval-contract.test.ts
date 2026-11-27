/**
 * The interval mode of the IR pipeline (`compile(expr, { to: 'interval-js',
 * profile: 'ir' })`), batches 1 and 2: the result contract, the declines,
 * the verdicts, the loops at run time, the representation of integers (the
 * pass `plain`), and the time of the compilation of large programs.
 */

import { ComputeEngine, INTERVAL_KIND } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { compile } from '../../src/compile';
import { compileSlice } from '../../src/compute-engine/compilation/ir/index';
import { createIntervalRuntime, IntervalArithmetic } from '../../src/interval';
import { CompileDeclineError } from '../../src/compute-engine/compilation/diagnostics';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('p', 'boolean');
ce.declare('q', 'boolean');
ce.declare('n', 'real');
ce.declare('Z', 'complex');
ce.declare('L', 'list<real^3>');
ce.assign(
  'g',
  ce.box(['Function', ['Add', ['Power', 't', 2], 1], 't'] as never)
);
ce.declare('fact', '(integer) -> integer');
ce.assign(
  'fact',
  ce.box([
    'Function',
    [
      'If',
      ['LessEqual', 'k', 0],
      1,
      ['Multiply', 'k', ['fact', ['Subtract', 'k', 1]]],
    ],
    'k',
  ] as never)
);

const IR = { to: 'interval-js', profile: 'ir' } as const;

/** The code of `r` with each constant of `preambleOnce` written where it is
 *  read. */
const inlined = (r: { code: string; preambleOnce?: string }): string =>
  [...(r.preambleOnce ?? '').matchAll(/^const (v\d+) = (.*);$/gm)].reduce(
    (code, [, name, text]) =>
      code.replace(new RegExp(`\\b${name}\\b`, 'g'), text),
    r.code
  );
type Result = {
  success: boolean;
  code: string;
  preambleOnce?: string;
  calling?: string;
  profile?: string;
  booleanInputs?: string[];
  shippable?: boolean;
  runtimeVersion?: string;
  run: (...args: unknown[]) => any;
  broadcast?: (inputs: unknown, options?: unknown) => Float64Array;
  broadcastAsync?: unknown;
  willUsePool?: unknown;
};

const mode = (json: unknown, options: object = {}) =>
  compile(ce.box(json as never), {
    ...IR,
    fallback: false,
    ...options,
  } as never) as unknown as Result;

/** The decline of `f`: its code and message. */
function declineOf(f: () => unknown): CompileDeclineError {
  try {
    f();
  } catch (e) {
    if (e instanceof CompileDeclineError) return e;
    throw e;
  }
  throw new Error('no decline');
}

/** The result `v` agrees with the interpreter's value of `json` on `engine`
 *  at each of `points`: a real value lies in the enclosure, and an `empty`
 *  result has no real value at any point. `entire` and a pole (`singular`
 *  with no value) admit every value. */
function agreesWithInterpreter(
  v: any,
  json: unknown,
  points: Record<string, number>[],
  engine: ComputeEngine = ce
): void {
  for (const point of points) {
    const n = engine
      .box(json as never)
      .subs(
        Object.fromEntries(
          Object.entries(point).map(([k, x]) => [k, engine.number(x)])
        )
      )
      .N();
    const real = n.im === 0 && Number.isFinite(n.re);
    if (v.kind === 'empty') expect([point, real]).toEqual([point, false]);
    else if (real && v.value !== undefined)
      expect([point, v.value.lo <= n.re && n.re <= v.value.hi]).toEqual([
        point,
        true,
      ]);
  }
}

const PROGRAMS: unknown[] = [
  ['Add', ['Power', 'x', 2], ['Power', 'y', 2], -1],
  ['Divide', 1, 'x'],
  ['Floor', 'x'],
  ['Ln', 'x'],
  ['Less', 'x', 'y'],
  ['And', 'p', ['Less', 'x', 0]],
  ['Add', ['g', 'x'], ['Sin', 'y']],
  'x',
  5,
];

const BOXES = [
  { x: { lo: -1, hi: 1 }, y: { lo: 0.5, hi: 2 }, p: true },
  { x: { lo: 0.5, hi: 1.5 }, y: { lo: -3, hi: -2 }, p: 'maybe' },
  { x: { lo: -2, hi: -1 }, y: { lo: 1, hi: 1 }, p: false },
  { x: 2, y: 3, p: true },
];

describe('the interval mode: the result contract', () => {
  test('the fields of the result', () => {
    const r = mode(['Add', ['Sin', 'x'], 'y']);
    expect(r).toMatchObject({
      target: 'interval-js',
      success: true,
      calling: 'expression',
      profile: 'ir',
      shippable: true,
    });
    expect(typeof r.runtimeVersion).toBe('string');
    expect(typeof r.broadcast).toBe('function');
    expect(typeof r.broadcastAsync).toBe('function');
    expect(typeof r.willUsePool).toBe('function');
    expect(r.code).toBe('_IA.add(_.y, _IA.sin(_.x))');
    expect(r.code).not.toMatch(/_SYS/);
    expect(mode(['Less', 'x', 0]).booleanInputs).toBeUndefined();
    expect(mode(['And', 'p', ['Less', 'x', 0]]).booleanInputs).toEqual(['p']);
  });

  test('a list of booleans is a list input, not a boolean input', () => {
    ce.declare('B', 'list<boolean>');
    const r = mode(['Add', ['Length', 'B'], 'x']) as Result & {
      listInputs?: string[];
    };
    expect(r.booleanInputs).toBeUndefined();
    expect(r.listInputs).toEqual(['B']);
    expect(r.run({ B: ['true', 'false'], x: 1 })).toEqual({
      kind: 'interval',
      value: { lo: 3, hi: 3 },
    });
  });

  test('a kinded result or a verdict, never a bare enclosure', () => {
    for (const json of PROGRAMS) {
      const r = mode(json);
      for (const b of BOXES) {
        const v = r.run(b);
        if (typeof v === 'string')
          expect(['true', 'false', 'maybe']).toContain(v);
        else {
          expect([
            'interval',
            'empty',
            'entire',
            'singular',
            'partial',
          ]).toContain(v.kind);
          expect('lo' in v).toBe(false);
        }
      }
    }
    expect(mode(5).run({})).toEqual({
      kind: 'interval',
      value: { lo: 5, hi: 5 },
    });
    expect(mode('x').run({ x: { lo: 1, hi: 2 } })).toEqual({
      kind: 'interval',
      value: { lo: 1, hi: 2 },
    });
    expect(mode(['Less', 'x', 1]).run({ x: { lo: 0, hi: 2 } })).toBe('maybe');
    expect(mode(['Less', 'x', 1]).run({ x: { lo: 2, hi: 3 } })).toBe('false');
    expect(mode(['Ln', 'x']).run({ x: { lo: -2, hi: -1 } })).toEqual({
      kind: 'empty',
    });
  });

  test('a number given for an input is a point', () => {
    expect(mode(['Power', 'x', 2]).run({ x: 3 })).toEqual({
      kind: 'interval',
      value: { lo: 9, hi: 9 },
    });
    expect(mode(['Not', 'p']).run({ p: true })).toBe('false');
  });

  test('a boolean name of vars is a boolean input', () => {
    const r = mode(['Not', 'p'], { vars: { p: '_.p' } });
    expect(r.profile).toBe('ir');
    expect(r.booleanInputs).toEqual(['p']);
    expect(r.broadcast!({ p: [] }).length).toBe(0);
    expect(r.run({ p: true })).toBe('false');
  });

  test('a root Function literal is a lambda', () => {
    const r = mode(['Function', ['Multiply', 2, ['g', 't']], 't']);
    expect(r.calling).toBe('lambda');
    expect(r.broadcast).toBeUndefined();
    expect(r.run(3)).toEqual({ kind: 'interval', value: { lo: 20, hi: 20 } });
    expect(r.run({ lo: 0, hi: 1 })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 4 },
    });
    const loaded = createIntervalRuntime().load(JSON.parse(JSON.stringify(r)));
    expect(loaded({ lo: -1, hi: 2 })).toEqual(r.run({ lo: -1, hi: 2 }));
  });

  test('the stored result loaded by the runtime gives the values of run()', () => {
    const runtime = createIntervalRuntime();
    for (const json of PROGRAMS) {
      const r = mode(json);
      const loaded = runtime.load(JSON.parse(JSON.stringify(r)));
      for (const b of BOXES) expect(loaded(b)).toEqual(r.run(b));
    }
  });

  test('broadcast() gives per cell what run() gives', () => {
    const code = (v: any): number =>
      typeof v === 'string'
        ? INTERVAL_KIND[
            v === 'true'
              ? 'boolTrue'
              : v === 'false'
                ? 'boolFalse'
                : 'boolMaybe'
          ]
        : v.kind === 'singular'
          ? v.value === undefined
            ? INTERVAL_KIND.singularPole
            : INTERVAL_KIND.singularJump
          : INTERVAL_KIND[v.kind as 'interval'];
    for (const json of PROGRAMS) {
      const r = mode(json);
      const x = new Float64Array(
        BOXES.flatMap((b) =>
          typeof b.x === 'number' ? [b.x, b.x] : [b.x.lo, b.x.hi]
        )
      );
      const y = new Float64Array(
        BOXES.flatMap((b) =>
          typeof b.y === 'number' ? [b.y, b.y] : [b.y.lo, b.y.hi]
        )
      );
      // A boolean column: the verdict of each cell (`'maybe'` read as true).
      const p = BOXES.map((b) => b.p !== false);
      const out = r.broadcast!({ x, y, p });
      BOXES.forEach((b, k) => {
        const v = r.run({ ...b, p: b.p !== false });
        expect(out[3 * k + 2]).toBe(code(v));
        if (typeof v !== 'string' && v.value !== undefined) {
          expect(out[3 * k]).toBe(v.value.lo);
          expect(out[3 * k + 1]).toBe(v.value.hi);
        }
      });
    }
  });

  test('a decline: outside-profile with fallback false', () => {
    // A `Loop` with no `Element` clause.
    const loop = [
      'Block',
      ['Declare', 's', 'real', 0],
      ['Loop', ['Block', ['If', ['Greater', 's', 3], ['Break']], ['Assign', 's', ['Add', 's', 1]]]],
      ['Multiply', 's', 'x'],
    ];
    const e = declineOf(() => mode(loop));
    expect(e.diagnostic.code).toBe('outside-profile');
    expect(e.message).toMatch(/a Loop with no Element clause/);
  });

  test('the options', () => {
    expect(
      mode(['Add', 'x', 'c'], { vars: { c: '_.c' } }).run({
        x: 1,
        c: { lo: 2, hi: 3 },
      })
    ).toEqual({
      kind: 'interval',
      value: { lo: 3, hi: 4 },
    });
    for (const [options, cause] of [
      [
        { vars: { c: 'Math.random()' } },
        /the vars entry of c, which is not a read of the inputs object/,
      ],
      [{ mode: 'complex' }, /the option `mode` with the value 'complex'/],
    ] as const)
      expect(declineOf(() => mode(['Add', 'x', 'c'], options)).message).toMatch(
        cause
      );
    // No effect.
    expect(
      mode(['Sin', 'x'], {
        entryChecks: false,
        iterationBudget: 10,
      }).success
    ).toBe(true);
    const deps = new Set<string>();
    const refs = new Set<string>();
    mode(['Add', ['g', 'x'], 'y'], { symbolDeps: deps, varsObjectRefs: refs });
    expect([...deps]).toEqual(['g']);
    expect([...refs].sort()).toEqual(['x', 'y']);
    const box = { x: { lo: 0, hi: 1 } };
    expect(
      mode(['Add', ['Sin', 'x'], ['Cos', 'x']], { cse: false }).run(box)
    ).toEqual(mode(['Add', ['Sin', 'x'], ['Cos', 'x']]).run(box));
    expect(
      mode(['Add', 'x', ['Sin', 1]], { constantFold: false }).preambleOnce
    ).toMatch(/_IA\.sin\(\{ lo: 1, hi: 1 \}\)/);
  });
});

describe('the interval mode: the declines', () => {
  test.each([
    // Lists compile since batch 3 (`ir-interval-lists.test.ts`); a Range of
    // a real operand declines.
    [['Range', 0.5, 'x'], /a Range of a real operand/],
    [['Add', 'Z', 'x'], /the lane complex/],
    // A recursive function compiles (the describe 'recursive functions').
    [['Zeta', 'x'], /Zeta \(the operation zeta\)/],
    // `_IA.gcd` and `_IA.lcm` round their operands to integers, where the
    // interpreter's `GCD(7.5, 2)` is 0.5.
    [['GCD', 'x', 'n'], /GCD \(the operation rgcd\)/],
    [['LCM', 'x', 'n'], /LCM \(the operation rlcm\)/],
    // Integrals compile since batch 6 (`ir-interval-integrals.test.ts`),
    // a `Loop` with no early exit too (`ir-interval-lists.test.ts`).
  ])('%j', (json, cause) => {
    const e = declineOf(() => mode(json));
    expect(e.diagnostic.code).toBe('outside-profile');
    expect(e.message).toMatch(cause);
    expect(e.message).toMatch(/ on interval-js$/);
  });

  test('a string seed: the lowering has no string', () => {
    const e = declineOf(() => mode(['WithRandomSeed', "'abc'", ['Random']]));
    expect(e.diagnostic.code).toBe('outside-profile');
    expect(e.message).toMatch(/"abc": a string: text compiles on javascript only/);
  });

  test('a vars text that is not a read of the inputs object', () => {
    expect(
      declineOf(() => mode(['Add', 'x', 'c'], { vars: { c: 'f()' } })).message
    ).toMatch(/the vars entry of c, which is not a read of the inputs object/);
  });
});

describe('the interval mode: recursive functions', () => {
  // prettier-ignore
  {
    ce.assign('rs', ce.box(['Function', ['Which', ['Equal', 'm', 1], ['Sin', 'z'], 'True', ['Sin', ['rs', 'z', ['Add', 'm', -1]]]], 'z', 'm'] as never));
    ce.assign('rg', ce.box(['Function', ['If', ['Greater', 'z', 0], ['Sin', ['rg', ['Subtract', 'z', 1]]], 'z'], 'z'] as never));
    ce.assign('rh', ce.box(['Function', ['If', ['Greater', 'z', 0], 1, 2], 'z'] as never));
    ce.assign('rt', ce.box(['Function', ['Which', ['Equal', 'm', 1], ['rh', 'z'], 'True', ['Add', ['rh', 'z'], ['rt', 'z', ['Add', 'm', -1]]]], 'z', 'm'] as never));
    ce.assign('rf', ce.box(['Function', ['Which', ['Equal', 'm', 0], 'z', 'True', ['Divide', 1, ['Mod', ['rf', 'z', ['Add', 'm', -1]], 1]]], 'z', 'm'] as never));
  }
  /** The interpreter's value of `json` at `point`. */
  const at = (json: unknown, point: Record<string, number>) =>
    ce.box(json as never).subs(point).N().re;
  const contains = (v: any, json: unknown, points: Record<string, number>[]) => {
    expect(v.kind).toBe('interval');
    for (const point of points) {
      const value = at(json, point);
      expect([point, v.value.lo <= value && value <= v.value.hi]).toEqual([
        point,
        true,
      ]);
    }
  };

  test('a counter that is a point: each guard is decided, the result encloses the values', () => {
    const json = ['rs', 'x', 'n'];
    const r = mode(json);
    expect(r.preambleOnce).toMatch(/if \(_IA\.decided\(_IA\.equal\(/);
    contains(r.run({ x: { lo: 0.1, hi: 0.4 }, n: 3 }), json, [
      { x: 0.1, n: 3 },
      { x: 0.25, n: 3 },
      { x: 0.4, n: 3 },
    ]);
    contains(r.run({ x: 0.7, n: 1 }), json, [{ x: 0.7, n: 1 }]);
    // A counter that is not a point: the first guard is undecided.
    expect(r.run({ x: 0.3, n: { lo: 2, hi: 3 } })).toEqual({ kind: 'entire' });
  });

  test('a guard that reads x: a box that straddles it at some depth is entire', () => {
    const json = ['rg', 'x'];
    const r = mode(json);
    contains(r.run({ x: { lo: 2.2, hi: 2.6 } }), json, [
      { x: 2.2 },
      { x: 2.6 },
    ]);
    contains(r.run({ x: { lo: -1, hi: -0.5 } }), json, [{ x: -1 }]);
    expect(r.run({ x: { lo: 1.5, hi: 2.5 } })).toEqual({ kind: 'entire' });
  });

  test('a recursion that never reaches its base case is entire', () => {
    // `m = 1` is decided false at every depth: the JavaScript stack ends,
    // and run() answers a RangeError with entire.
    const r = mode(['rs', 'x', 'n']);
    for (const n of [2.5, -1])
      expect(r.run({ x: 0.3, n })).toEqual({ kind: 'entire' });
  });

  test('a function not on a cycle keeps its three-way if, also when a recursive one calls it', () => {
    const r = mode(['rt', 'x', 2]);
    // `rh` is a call (not copied into `rt`), with its own three-way if.
    const rh = r.preambleOnce!.match(/const u\d+_rh = [\s\S]*?\n};/)![0];
    expect(rh).toMatch(/!== 'false'/);
    expect(rh).not.toMatch(/_IA\.decided/);
    const rt = r.preambleOnce!.match(/const u\d+_rt = [\s\S]*?\n};/)![0];
    expect(rt).toMatch(/_IA\.decided/);
    expect(rt).not.toMatch(/!== 'false'/);
    // The guard of `rt` reads the counter only: the hull of `rh`'s arms.
    expect(r.run({ x: { lo: -1, hi: 1 } })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 4 },
    });
  });

  test('a recursive function that reads an input passes it to its recursive call', () => {
    // prettier-ignore
    {
      ce.assign('rI', ce.box(['Function', ['Add', ['Multiply', 'y', 'u'], ['Sin', 'v']], 'u', 'v'] as never));
      ce.assign('rJ', ce.box(['Function', ['Which', ['Equal', 'm', 0], 'z', 'True', ['rI', 'z', ['rJ', ['Add', 'm', -1], 'z']]], 'm', 'z'] as never));
    }
    const json = ['rJ', 'n', 'x'];
    const r = mode(json);
    expect(r.preambleOnce).toMatch(
      /u\d+_rJ\(_IA\.add\(v\d+, v\d+\), v\d+, v\d+\)/
    );
    // The input y is not a parameter of the expression: give it a value.
    const read = (point: Record<string, number>) =>
      ce.withValues(
        Object.fromEntries(
          Object.entries(point).map(([k, v]) => [k, ce.number(v)])
        ),
        () => ce.box(json as never).evaluate().N().re
      );
    const v = r.run({
      n: 3,
      x: { lo: 0.1, hi: 0.4 },
      y: { lo: 0.5, hi: 0.7 },
    }) as any;
    expect(v.kind).toBe('interval');
    for (const [x, y] of [
      [0.1, 0.5],
      [0.4, 0.7],
      [0.25, 0.6],
      [0.1, 0.7],
    ]) {
      const value = read({ n: 3, x, y });
      expect([x, y, v.value.lo <= value && value <= v.value.hi]).toEqual([
        x,
        y,
        true,
      ]);
    }
    expect(r.run({ n: 0, x: 0.3, y: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 0.3, hi: 0.3 },
    });
    // A counter that is not a point: the first guard is undecided.
    expect(r.run({ n: { lo: 2, hi: 3 }, x: 0.3, y: 2 })).toEqual({
      kind: 'entire',
    });
  });

  test("an if of the entry runs both arms, the recursive call in one", () => {
    const json = ['If', ['Greater', 'x', 0], ['rs', 'x', 2], 0];
    const v = mode(json).run({ x: { lo: -0.5, hi: 0.5 } });
    contains(v, json, [{ x: -0.5 }, { x: 0.25 }, { x: 0.5 }]);
  });

  test('a recursive call of constant arguments is computed at the first call', () => {
    const r = mode(['Add', ['rf', 0.3, 2], 'x']) as Result & {
      preamblePerCall?: string;
    };
    expect(r.code).toMatch(/^_IA\.add\(_\.x, v\d+\)$/);
    expect(r.preamblePerCall).toMatch(/_once[\s\S]*u\d+_rf\(\{ lo: 0\.3/);
    contains(r.run({ x: 1 }), ['Add', ['rf', 0.3, 2], 'x'], [{ x: 1 }]);
    // One that never ends: the error of the first call, at each call.
    const never = mode(['Add', ['rf', 0.3, 2.5], 'x']);
    expect(never.run({ x: 1 })).toEqual({ kind: 'entire' });
    expect(never.run({ x: 2 })).toEqual({ kind: 'entire' });
  });
});

describe('the interval mode: large programs', () => {
  const time = (f: () => unknown): number => {
    const start = Date.now();
    try {
      f();
    } catch (e) {
      if (!(e instanceof CompileDeclineError)) throw e;
    }
    return Date.now() - start;
  };
  // Hang guards, far above the measured times.
  test('a shared graph of 2^20 paths', () => {
    let e: Expression = ce.box('x');
    for (let i = 0; i < 20; i++)
      e = ce.function('Add', [
        ce.function('Sin', [e]),
        ce.function('Cos', [e]),
      ]);
    expect(
      time(() => compile(e, { ...IR, fallback: false } as never))
    ).toBeLessThan(5000);
  });
  test('a chain of 1,000 operands', () => {
    const e = ce.box([
      'Add',
      ...Array.from({ length: 1000 }, (_, k) => [
        'Sin',
        ['Multiply', k + 1, 'x'],
      ]),
    ] as never);
    const r = mode([
      'Add',
      ...Array.from({ length: 1000 }, (_, k) => [
        'Sin',
        ['Multiply', k + 1, 'x'],
      ]),
    ]);
    expect(r.success).toBe(true);
    expect(
      time(() => compile(e, { ...IR, fallback: false } as never))
    ).toBeLessThan(5000);
  });
  test('a nested loop', () => {
    const e = ce.box([
      'Sum',
      ['Sum', ['Multiply', 'j', 'k', 'x'], ['Limits', 'k', 1, 1000]],
      ['Limits', 'j', 1, 1000],
    ] as never);
    expect(
      time(() => compile(e, { ...IR, fallback: false } as never))
    ).toBeLessThan(5000);
  });
});

describe('the interval mode: verdicts', () => {
  const V = ['true', 'false', 'maybe'] as const;
  const and = (a: string, b: string) =>
    a === 'false' || b === 'false'
      ? 'false'
      : a === 'true' && b === 'true'
        ? 'true'
        : 'maybe';
  const or = (a: string, b: string) =>
    a === 'true' || b === 'true'
      ? 'true'
      : a === 'false' && b === 'false'
        ? 'false'
        : 'maybe';
  const not = (a: string) =>
    a === 'maybe' ? 'maybe' : a === 'true' ? 'false' : 'true';
  test('the truth tables of And, Or and Not of boolean inputs (Kleene)', () => {
    const r = {
      and: mode(['And', 'p', 'q']),
      or: mode(['Or', 'p', 'q']),
      not: mode(['Not', 'p']),
      nand: mode(['Not', ['And', 'p', ['Not', 'q']]]),
    };
    for (const p of V) {
      expect(r.not.run({ p })).toBe(not(p));
      for (const q of V) {
        expect(r.and.run({ p, q })).toBe(and(p, q));
        expect(r.or.run({ p, q })).toBe(or(p, q));
        expect(r.nand.run({ p, q })).toBe(not(and(p, not(q))));
      }
    }
  });
  test('a chain and comparisons over boxes that decide and that do not', () => {
    const chain = mode(['Less', 0, 'x', 1]);
    expect(chain.run({ x: { lo: 0.25, hi: 0.75 } })).toBe('true');
    expect(chain.run({ x: { lo: 2, hi: 3 } })).toBe('false');
    expect(chain.run({ x: { lo: -2, hi: -1 } })).toBe('false');
    expect(chain.run({ x: { lo: 0.5, hi: 1.5 } })).toBe('maybe');
    expect(chain.run({ x: { lo: -0.5, hi: 0.5 } })).toBe('maybe');
    const both = mode(['And', ['Greater', 'x', 0], ['Greater', ['Divide', 1, 'x'], 2]]);
    expect(both.run({ x: { lo: -2, hi: -1 } })).toBe('false');
    expect(both.run({ x: { lo: 0.1, hi: 0.4 } })).toBe('true');
    expect(both.run({ x: { lo: -1, hi: 1 } })).toBe('maybe');
    const either = mode(['Or', ['Not', ['Less', 'x', 1]], ['Less', 'y', 0]]);
    expect(either.run({ x: { lo: 0, hi: 0.5 }, y: { lo: 1, hi: 2 } })).toBe('false');
    expect(either.run({ x: { lo: 0, hi: 0.5 }, y: { lo: -2, hi: -1 } })).toBe('true');
    expect(either.run({ x: { lo: 0, hi: 2 }, y: { lo: 1, hi: 2 } })).toBe('maybe');
  });
  test('an If whose condition is a boolean input given maybe', () => {
    const r = mode(['If', 'p', ['Add', 'x', 1], ['Negate', 'x']]);
    const box = { x: { lo: 1, hi: 2 } };
    expect(r.run({ ...box, p: true })).toEqual({ kind: 'interval', value: { lo: 2, hi: 3 } });
    expect(r.run({ ...box, p: 'false' })).toEqual({ kind: 'interval', value: { lo: -2, hi: -1 } });
    expect(r.run({ ...box, p: 'maybe' })).toEqual({ kind: 'interval', value: { lo: -2, hi: 3 } });
    // A missing arm under `'maybe'` is a value over part of the box.
    expect(mode(['If', 'p', 'x']).run({ ...box, p: 'maybe' }).kind).toBe('partial');
    expect(mode(['If', 'p', 'x']).run({ ...box, p: false })).toEqual({ kind: 'empty' });
  });
  test('the hull of two verdicts, and of a value with empty', () => {
    const r = mode(['If', ['Greater', 'x', 0], ['Less', 'y', 1], ['Less', 'y', 3]]);
    expect(r.run({ x: { lo: -1, hi: 1 }, y: { lo: 2, hi: 2 } })).toBe('maybe');
    expect(r.run({ x: { lo: -1, hi: 1 }, y: { lo: 0, hi: 0 } })).toBe('true');
    expect(r.run({ x: { lo: -1, hi: 1 }, y: { lo: 5, hi: 5 } })).toBe('false');
  });
  test('an If of a boolean arm with no else arm is the And of the condition and the arm', () => {
    // The interpreter gives `False` for the missing arm of a boolean.
    const r = mode(['If', ['Less', 0, 'x'], ['Less', 0, 'y']]);
    const boxes: [{ lo: number; hi: number }, string][] = [
      [{ lo: -2, hi: -1 }, 'false'],
      [{ lo: -1, hi: 1 }, 'maybe'],
      [{ lo: 1, hi: 2 }, 'true'],
    ];
    for (const [x, c] of boxes)
      for (const [y, a] of boxes) expect(r.run({ x, y })).toBe(and(c, a));
  });
});

describe('the interval mode: the lazy And and Or', () => {
  type Box = Record<string, { lo: number; hi: number }>;
  /** The interpreter's truth value at the points `t` of `box` (0 and 1 are
   *  its ends). */
  const truth = (json: unknown, box: Box, t: number) => {
    const at = Object.fromEntries(
      Object.entries(box).map(([n, b]) => [n, ce.number(b.lo + t * (b.hi - b.lo))])
    );
    return ce.box(json as never).subs(at).evaluate().json;
  };
  /** A decided verdict is the interpreter's value at 11 points of the box. */
  const agrees = (json: unknown, box: Box, verdict: string) => {
    expect(verdict).toMatch(/^(true|false|maybe)$/);
    if (verdict === 'maybe') return;
    for (let k = 0; k <= 10; k++)
      expect(truth(json, box, k / 10)).toBe(verdict === 'true' ? 'True' : 'False');
  };
  const I = (lo: number, hi: number) => ({ lo, hi });

  test('the arm runs in an if of the condition, not before it', () => {
    const r = mode([
      'If',
      ['Less', 0, 'x'],
      ['Less', 0, ['Multiply', 'y', ['Power', 'y', ['Floor', 'x']]]],
    ]);
    const code = inlined(r);
    expect(code).toMatch(/let (v\d+) = 'false', \1_y;\n\s*if \((v\d+) !== 'false'\) \{/);
    expect(code.indexOf('_IA.powReal')).toBeGreaterThan(code.indexOf("!== 'false'"));
    expect(code).not.toMatch(/_IA\.and\(_IA\.less/);
    expect(code).not.toContain('_IA.hull');
    const or = inlined(mode(['Or', ['Less', 'x', 0], ['Less', ['Sin', 'x'], 'y']]));
    expect(or).toMatch(/let (v\d+) = 'true', \1_y;\n\s*if \((v\d+) !== 'true'\) \{/);
    expect(or.indexOf('_IA.sin')).toBeGreaterThan(or.indexOf("!== 'true'"));
  });

  test('the verdicts of And, Or, a chain, If, Which and Not are the interpreter values', () => {
    const shapes: unknown[] = [
      ['And', ['Greater', 'x', 0], ['Greater', ['Ln', 'x'], 'y']],
      ['And', ['Greater', 'x', 0], ['Greater', 'y', 0], ['Greater', ['Sqrt', 'x'], 'y']],
      ['Less', 0, 'x', 1],
      ['Or', ['And', ['Less', 0, 'x'], ['Less', 'y', 1]], ['And', ['Greater', 'x', 2], ['Greater', ['Ln', 'y'], 0]]],
      ['If', ['Less', 0, 'x'], ['Less', ['Divide', 1, 'x'], 'y']],
      ['Which', ['Greater', 'x', 0], ['Less', 'y', 1], 'True', ['Greater', 'y', 2]],
      ['Not', ['And', ['Greater', 'x', 0], ['Greater', ['Ln', 'x'], 1]]],
      // Both arms are not constants: the three-way if, unchanged.
      ['If', ['Greater', 'x', 0], ['Less', 'y', 1], ['Less', 'y', 3]],
    ];
    const boxes: Box[] = [];
    for (const x of [I(-2, -1), I(0.5, 0.5), I(-1, 1), I(1.5, 3), I(3, 4)])
      for (const y of [I(-2, -1), I(0.25, 0.5), I(0, 2), I(1.5, 1.6), I(3, 3)])
        boxes.push({ x, y });
    let decided = 0;
    for (const json of shapes) {
      const r = mode(json);
      for (const box of boxes) {
        const verdict = r.run(box);
        if (verdict !== 'maybe') decided++;
        agrees(json, box, verdict);
      }
    }
    expect(decided).toBeGreaterThan(100);
    expect(inlined(mode(shapes[7]))).toContain('_IA.hull');
  });

  test('an arm with a pole or a domain error under a false condition: false, as the interpreter', () => {
    const ln = ['And', ['Greater', 'x', 0], ['Greater', ['Ln', 'x'], 0]];
    const div = ['And', ['Greater', 'x', 0], ['Greater', ['Divide', 1, 'x'], 2]];
    for (const json of [ln, div]) {
      expect(mode(json).run({ x: I(-2, -1) })).toBe('false');
      expect(mode(json).run({ x: I(0, 0) })).toBe('false');
      expect(truth(json, { x: I(0, 0) }, 0)).toBe('False');
    }
    // Where the condition is undecided the arm runs, at the pole too.
    expect(mode(div).run({ x: I(-1, 1) })).toBe('maybe');
  });

  test('an arm that throws the undecided error runs only where the condition does not decide', () => {
    const json = [
      'And',
      ['Greater', 'x', 0],
      ['Greater', ['Sum', 'k', ['Limits', 'k', 1, ['Floor', 'y']]], 1],
    ];
    const r = mode(json);
    expect(r.run({ x: I(-2, -1), y: I(1.5, 2.5) })).toBe('false');
    expect(r.run({ x: I(-1, 1), y: I(1.5, 2.5) })).toEqual({ kind: 'entire' });
    expect(r.run({ x: I(1, 2), y: I(2, 2) })).toBe('true');
  });

  test('in a function on a cycle of calls, a pure arm keeps the lazy form', () => {
    const local = new ComputeEngine();
    local.declare('x', 'real');
    local.declare('f', '(integer) -> boolean');
    local.assign(
      'f',
      local.box([
        'Function',
        ['If', ['LessEqual', 'k', 0], ['And', ['Less', 0, 'x'], ['Less', 'x', 1]], ['f', ['Subtract', 'k', 1]]],
        'k',
      ] as never)
    );
    const r = compile(local.box(['f', 3] as never), { ...IR, fallback: false } as never) as unknown as Result;
    expect(r.preambleOnce).toContain('_IA.decided(');
    expect(r.preambleOnce).toMatch(/= 'false', v\d+_y;/);
    // An undecided condition of the And does not throw: the other arm is a
    // constant, so no recursion runs both arms.
    expect(r.run({ x: I(0.5, 2) })).toBe('maybe');
    expect(r.run({ x: I(0.25, 0.5) })).toBe('true');
    expect(r.run({ x: I(-2, -1) })).toBe('false');
  });
});

describe('the interval mode: loops at run time', () => {
  const sum = ['Sum', ['Power', 'x', 'k'], ['Limits', 'k', 1, 'n']];
  test('a bound that is not a point is entire', () => {
    const r = mode(sum);
    expect(r.run({ x: 0.5, n: 3 })).toEqual({
      kind: 'interval',
      value: { lo: 0.875, hi: 0.875 },
    });
    expect(r.run({ x: 0.5, n: { lo: 2, hi: 4 } })).toEqual({ kind: 'entire' });
    // `Floor(n)` jumps in the box: no one count of passes.
    expect(r.run({ x: 0.5, n: { lo: 2.5, hi: 3.5 } })).toEqual({ kind: 'entire' });
    expect(r.run({ x: 0.5, n: { lo: 3.25, hi: 3.5 } })).toEqual({
      kind: 'interval',
      value: { lo: 0.875, hi: 0.875 },
    });
  });
  test('a sum over the budget is entire and runs no pass', () => {
    const big = mode(['Sum', ['Sin', ['Multiply', 'k', 'x']], ['Limits', 'k', 1, 1e9]], {
      iterationBudget: 1000,
    });
    expect(big.code).not.toMatch(/NaN|isNaN/);
    const start = Date.now();
    expect(big.run({ x: 1 })).toEqual({ kind: 'entire' });
    expect(Date.now() - start).toBeLessThan(200);
    const r = mode(sum, { iterationBudget: 5 });
    expect(r.run({ x: 0.5, n: 5 }).kind).toBe('interval');
    expect(r.run({ x: 0.5, n: 6 })).toEqual({ kind: 'entire' });
  });
  test('broadcast() gives entire for such a cell, and counts no failure', () => {
    const r = mode(sum, { iterationBudget: 5 });
    const inputs = {
      x: new Float64Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
      n: new Float64Array([5, 5, 2, 4, 9, 9]),
    };
    const out = r.broadcast!(inputs);
    expect(Array.from(out.subarray(0, 3))).toEqual([0.96875, 0.96875, INTERVAL_KIND.interval]);
    expect(out[5]).toBe(INTERVAL_KIND.entire);
    expect(out[8]).toBe(INTERVAL_KIND.entire);
    const failures = { count: 0 };
    const slice = createIntervalRuntime().loadBroadcastSlice(r as never);
    const into = new Float64Array(9);
    expect(slice(inputs as never, undefined, into, { from: 0, to: 3, failures })).toBe(3);
    expect(failures.count).toBe(0);
    expect(Array.from(into)).toEqual(Array.from(out));
  });
});

describe('the interval mode: plain integers', () => {
  test('an index and integer arithmetic on it are numbers', () => {
    const r = mode([
      'Sum',
      ['Divide', ['Sin', ['Multiply', 'x', ['Subtract', ['Multiply', 2, 'k'], 1]]], ['Subtract', ['Multiply', 2, 'k'], 1]],
      ['Limits', 'k', 1, ['Floor', 'n']],
    ]);
    // `2k − 1` with number arithmetic, made a point where a kernel reads it.
    expect(r.code).toMatch(/const (v\d+) = \(\(2 \* (v\d+)\) \+ \(-1\)\);/);
    expect(r.code).toMatch(/\{ lo: v\d+, hi: v\d+ \}/);
    expect(r.code).toMatch(/_IA\.number\(_IA\.floor\(_\.n\)\)/);
    expect(r.code).not.toMatch(/_IA\.(add|sub|mul)\(\{ lo: 2/);
    expect(r.run({ x: 0.5, n: 3 }).kind).toBe('interval');
  });
  test('an integer exponent is the number of _IA.pow', () => {
    expect(mode(['Power', 'x', 3]).code).toBe('_IA.pow(_.x, 3)');
    expect(mode(['Power', 'x', -2]).code).toBe('_IA.pow(_.x, (-2))');
    expect(mode(['Power', 'x', 2]).code).toBe('_IA.square(_.x)');
    expect(mode(['Sum', ['Power', 'x', 'k'], ['Limits', 'k', 1, 101]]).code).toMatch(
      /_IA\.pow\(_\.x, v\d+\)/
    );
  });
  test('an integer that depends on an input stays on kernels', () => {
    const r = mode(['Add', ['Floor', 'x'], 1]);
    expect(r.code).toMatch(/^_IA\.add\(_IA\.floor\(_\.x\), (v\d+)\)$/);
    expect(r.preambleOnce).toMatch(/^const v\d+ = \{ lo: 1, hi: 1 \};$/);
  });
  test('a product of indexes whose bound reaches 2^53 is not plain', () => {
    const r = mode([
      'Sum',
      ['Sum', ['Multiply', 'j', 'k', 'x'], ['Limits', 'k', 1, 101]],
      ['Limits', 'j', 1, 3],
    ]);
    // 2^32 · 2^32: each index is made a point, and the kernel multiplies.
    // (An inner sum of more than 100 passes is a loop, and so is the outer.)
    expect(r.code).toMatch(/_IA\.mul\(\{ lo: v\d+, hi: v\d+ \}, \{ lo: v\d+, hi: v\d+ \}\)/);
    expect(r.run({ x: 1 })).toEqual({ kind: 'interval', value: { lo: 30906, hi: 30906 } });
  });
  test('a product of an input integer by the constant 0 is not plain', () => {
    // The bound of `0 · Floor(x)` is 0, and `Floor(x)` is not one number.
    const r = mode(['Add', ['Multiply', ['Floor', 'x'], 0], 1]);
    expect(r.code).not.toMatch(/_IA\.number/);
    const value = r.run({ x: { lo: 0.5, hi: 1.5 } });
    expect(value.kind).not.toBe('entire');
    expect(value.value.lo <= 1 && 1 <= value.value.hi).toBe(true);
  });
});

describe('the interval mode: narrowing in a nest', () => {
  test('an inner conditional on the same value keeps the outer clamp', () => {
    // `Sqrt(x)` after the inner `If` reads `x` clamped to `x ≥ 0`: the
    // result has a value over the whole box.
    const r = mode([
      'If',
      ['Greater', 'x', 0],
      ['Add', ['If', ['Greater', 'x', 0], ['Sqrt', 'x'], 0], ['Sqrt', 'x']],
      0,
    ]);
    expect(r.run({ x: { lo: -1, hi: 1 } })).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 2 },
    });
  });
});

describe('the interval mode: the size of conditionals', () => {
  // A nest of `If`s in the first arm, each arm reading the shared `s`: each
  // arm is printed once, so the text grows with the program.
  const nest = (depth: number): unknown => {
    let e: unknown = ['Sin', 's'];
    for (let k = 0; k < depth; k++)
      e = ['If', ['Greater', 's', k], ['Add', e, 's'], ['Multiply', 's', k + 2]];
    return ['Block', ['Declare', 's', 'real', ['Exp', 'x']], e];
  };
  test('a nest of 12 Ifs has code linear in the program', () => {
    const [a, b] = [6, 12].map((d) => mode(nest(d)).code.length);
    expect(b / a).toBeLessThan(2.5);
    const r = mode(nest(12));
    expect(r.run({ x: { lo: -1, hi: 1 } }).kind).toBe('interval');
  });
  test('a chain of 100 Ifs and a triple nested sum compile', () => {
    // A `Which` of 100 clauses is a nest of 100 `if` instructions. The test
    // above bounds the size of the code.
    const which: unknown[] = ['Which'];
    for (let k = 0; k < 100; k++)
      which.push(['Less', 'x', k], ['Multiply', k, 'x']);
    which.push('True', 'x');
    expect(mode(which).run({ x: { lo: 10.5, hi: 12.5 } })).toEqual({
      kind: 'interval',
      value: { lo: 115.5, hi: 162.5 },
    });
    const triple = [
      'Sum',
      ['Sum', ['Sum', ['Sin', ['Multiply', 'i', 'j', 'k', 'x']], ['Limits', 'k', 1, 'j']], ['Limits', 'j', 1, 'i']],
      ['Limits', 'i', 1, 'n'],
    ];
    expect(mode(triple).run({ x: 0, n: 3 })).toEqual({ kind: 'interval', value: { lo: 0, hi: 0 } });
  });
});

describe('the interval mode: batch 4, results', () => {
  /** `f` of a fresh engine at machine precision, as Tycho's, with `x`, `y`
   *  and `a` declared `real`; then the process-global precision of the big
   *  decimals, which the engine writes, is the default engine's again. */
  const atMachine = <T>(f: (engine: ComputeEngine) => T): T => {
    const engine = new ComputeEngine();
    engine.precision = 'machine';
    for (const v of ['x', 'y', 'a']) engine.declare(v, 'real');
    try {
      return f(engine);
    } finally {
      BigDecimal.precision = ce.precision;
    }
  };
  const both = (engine: ComputeEngine, json: unknown) => {
    const expr = engine.box(json as never);
    return [
      compile(expr, { ...IR, fallback: false } as never),
      compile(expr, { to: 'interval-js' } as never),
    ] as unknown as [Result, Result];
  };
  const defaultEngine = () => {
    const engine = new ComputeEngine();
    for (const v of ['x', 'y', 'a']) engine.declare(v, 'real');
    return engine;
  };

  test.each([
    [['Add', 'x', 0.5], '_IA.add(_.x, { lo: 0.5, hi: 0.5 })'],
    [['Add', 'x', 1.8], '_IA.add(_.x, { lo: 1.8, hi: 1.8 })'],
  ])('a decimal literal is a point at its double: %j', (json, code) => {
    expect(inlined(both(defaultEngine(), json)[0])).toBe(code);
    expect(atMachine((m) => inlined(both(m, json)[0]))).toBe(code);
  });

  test.each(['CatalanConstant', 'EulerGamma'])(
    'a library constant that is not a double keeps its enclosure: %s',
    (name) => {
      // Its value is not the double that the engine holds for it, unlike a
      // decimal of the program: one ulp on each side.
      const json = ['Add', 'x', name];
      for (const engine of [defaultEngine, undefined]) {
        const [r] = engine
          ? both(engine(), json)
          : atMachine((m) => both(m, json));
        const got = r.run({ x: 0 }) as { value: { lo: number; hi: number } };
        expect(got.value.lo).toBeLessThan(got.value.hi);
      }
      // The JavaScript code reads the double, as before.
      const js = compile(defaultEngine().box(json as never), {
        profile: 'ir',
        fallback: false,
      } as never) as unknown as { run: (x: object) => number };
      const point = js.run({ x: 0 });
      const mode = both(defaultEngine(), json)[0].run({ x: 0 }) as {
        value: { lo: number; hi: number };
      };
      expect(mode.value.lo).toBeLessThan(point);
      expect(mode.value.hi).toBeGreaterThan(point);
    }
  );

  test('the values that stay points: a decimal held by a name of the program, and Half', () => {
    const engine = defaultEngine();
    engine.declare('g', 'real');
    engine.assign('g', 0.5772156649015329);
    const point = (v: number) => ({ kind: 'interval', value: { lo: v, hi: v } });
    expect(both(engine, ['Add', 'x', 'g'])[0].run({ x: 0 })).toEqual(
      point(0.5772156649015329)
    );
    expect(both(engine, ['Add', 'x', 'Half'])[0].run({ x: 0 })).toEqual(point(0.5));
    // `MachineEpsilon` is 2^-52 exactly, but the engine holds it as a
    // number that is not exact: an enclosure of one ulp.
    const [r] = both(engine, ['Add', 'x', 'MachineEpsilon']);
    const eps = r.run({ x: 0 }) as { value: { lo: number; hi: number } };
    expect(eps.value.lo).toBeLessThan(Number.EPSILON);
    expect(eps.value.hi).toBeGreaterThan(Number.EPSILON);
  });

  test('a decimal literal is a point: a pole of 1 / (0.5·Sin(2x) + 0.5) at the edge', () => {
    const json = ['Divide', 1, ['Add', ['Multiply', 0.5, ['Sin', ['Multiply', 2, 'x']]], 0.5]];
    const box = { x: { lo: -1.88, hi: 8.12 } };
    const expected = {
      kind: 'partial',
      value: { lo: 1, hi: Infinity },
      domainClipped: 'hi',
    };
    for (const results of [both(defaultEngine(), json), atMachine((m) => both(m, json))])
      expect(results[0].run(box)).toEqual(expected);
  });

  test('a decimal literal is a point: a decided comparison', () => {
    const json = [
      'Less',
      ['Add', ['Multiply', 0.5, ['Sin', ['Divide', ['Floor', 'x'], 6]], ['Sin', ['Divide', ['Floor', 'y'], 6]]], 0.5],
      ['Rational', 1, 2],
    ];
    const box = { x: { lo: 40.73, hi: 50.73 }, y: { lo: 0.72, hi: 10.72 } };
    expect(both(defaultEngine(), json)[0].run(box)).toBe('false');
    expect(atMachine((m) => both(m, json)[0].run(box))).toBe('false');
  });

  test("Tycho's guard: the clamp of a decimal bound is the point", () => {
    // `x ≥ 0.5` narrows `x` to `[0.5, 0.51]` in the first arm and to
    // `[0.49, 0.5]` in the second, where `Arccos(2x)` is in its domain.
    const guard = [
      'Which',
      ['GreaterEqual', 'x', 0.5],
      0,
      'True',
      ['Arccos', ['Multiply', 2, 'x']],
    ];
    const box = { x: { lo: 0.49, hi: 0.51 } };
    atMachine((m) => {
      const r = both(m, guard)[0];
      expect(r.run(box).kind).toBe('interval');
      const points = [0.49, 0.5, 0.51].map((x) => ({ x }));
      agreesWithInterpreter(r.run(box), guard, points, m);
    });
    // `1/3` has no double: its enclosure leaves `3x` above 1 at one ulp.
    const third = [
      'Which',
      ['GreaterEqual', 'x', ['Rational', 1, 3]],
      0,
      'True',
      ['Arccos', ['Multiply', 3, 'x']],
    ];
    const box3 = { x: { lo: 0.33, hi: 0.34 } };
    atMachine((m) => {
      const r3 = both(m, third)[0];
      expect(r3.run(box3)).toMatchObject({ kind: 'partial', domainClipped: 'hi' });
      const points = [0.33, 0.335, 0.34].map((x) => ({ x }));
      agreesWithInterpreter(r3.run(box3), third, points, m);
    });
  });

  test('a float exponent is its double: x^2.2 is |x|^e, not x^(11/5)', () => {
    // The interpreter at machine precision and the JavaScript code compute
    // `Math.pow(32, 2.2)`, `2048.0000000000014`; `x^(11/5)` at 32 is 2048.
    atMachine((m) => {
      const expr = m.box(['Power', 'x', 2.2] as never);
      const r = both(m, ['Power', 'x', 2.2])[0];
      for (const at of [32, 1e6]) {
        const v = r.run({ x: at }).value;
        const interpreter = expr.subs({ x: m.number(at) }).N().re;
        expect(interpreter).toBe(Math.pow(at, 2.2));
        expect(v.lo).toBeLessThanOrEqual(Math.pow(at, 2.2));
        expect(v.hi).toBeGreaterThanOrEqual(Math.pow(at, 2.2));
      }
      expect(r.run({ x: 32 }).value.lo).toBeGreaterThan(2048);
    });
  });

  test('a float exponent is read to the digits of the compiling engine', () => {
    // `0.333333333333333` (15 digits) is `1/3` when read to the 15 digits
    // of a machine-precision engine, and no rational of odd denominator
    // when read to 17. The containment test computes its reference at 21
    // digits, where a negative base has no real value, so it skips this
    // case: the reading at 15 digits is pinned here.
    const e = 0.333333333333333;
    atMachine((m) => {
      const r = both(m, ['Power', 'x', e])[0];
      expect(r.code).toContain('powRealBranch');
      const got = r.run({ x: -8 });
      expect(got.kind).toBe('interval');
      const root = -Math.pow(8, e);
      expect(got.value.lo).toBeLessThanOrEqual(root);
      expect(got.value.hi).toBeGreaterThanOrEqual(root);
      // The interpreter gives the real root, rounded to 15 digits.
      const v = m.box(['Power', 'x', e] as never).subs({ x: m.number(-8) }).N();
      expect(v.im === 0).toBe(true);
      expect(Math.abs(v.re - root)).toBeLessThan(1e-14 * Math.abs(root));
    });
    // At the default precision the same literal has no real root.
    const d = both(defaultEngine(), ['Power', 'x', e])[0];
    expect(d.code).not.toContain('powRealBranch');
    expect(d.run({ x: -8 })).toEqual({ kind: 'empty' });
  });

  test('a base that is provably non-negative: the principal power', () => {
    // Tycho's `neyret/dmibg1uaof`.
    const json = [
      'Power',
      ['Add', ['Power', ['Abs', ['Subtract', 'x', 1]], 0.2], ['Power', ['Abs', ['Add', ['Multiply', 2, 'x'], 1]], 0.2]],
      { num: '5.0' },
    ];
    atMachine((m) => {
      const r = both(m, json)[0];
      expect(r.code).not.toContain('powRealBranch');
      expect(r.code).not.toContain('nthRoot');
      for (const { lo, hi } of [
        { lo: -1.623107644263655, hi: -1.623107644263655 },
        { lo: -2, hi: 3 },
        { lo: 0.9, hi: 1.1 },
      ]) {
        const v = r.run({ x: { lo, hi } });
        expect(v.kind).toBe('interval');
        const points = [lo, (lo + hi) / 2, hi].map((x) => ({ x }));
        agreesWithInterpreter(v, json, points, m);
      }
    });
  });

  test('the principal power reads no value or assumption of an input', () => {
    // An assigned value that `vars` replaces: `x` is read from the inputs.
    const assigned = new ComputeEngine();
    assigned.declare('x', 'real');
    assigned.assign('x', 2);
    const r = compile(assigned.box(['Power', 'x', 0.2] as never), {
      ...IR,
      fallback: false,
      vars: { x: '_.x' },
    } as never) as unknown as Result;
    expect(r.code).toContain('powRealBranch');
    const v = r.run({ x: -32 }).value;
    expect(v.lo).toBeLessThanOrEqual(-2);
    expect(v.hi).toBeGreaterThanOrEqual(-2);
    // An assumption, which `forget()` removes after the compilation.
    const assumed = new ComputeEngine();
    assumed.declare('x', 'real');
    assumed.assume(assumed.box(['GreaterEqual', 'x', 0] as never) as never);
    const s = compile(assumed.box(['Power', 'x', 0.2] as never), {
      ...IR,
      fallback: false,
    } as never) as unknown as Result;
    assumed.forget('x');
    expect(s.code).toContain('powRealBranch');
    expect(s.run({ x: -32 }).value.hi).toBeGreaterThanOrEqual(-2);
    expect(s.run({ x: -32 }).value.lo).toBeLessThanOrEqual(-2);
    BigDecimal.precision = ce.precision;
  });

  test('a decimal literal is its double: Ceil(x - 1.8)', () => {
    // The caveat of the precision of the target. At `x` the double of 1.8,
    // `x - 1.8` is 0 in the mode, in the JavaScript code and in the
    // interpreter at machine precision, and about 4.4e-17 in the
    // interpreter at the default precision, which computes with the
    // decimal 1.8: `Ceil` is 0 against 1.
    const json = ['Ceil', ['Subtract', 'x', 1.8]];
    const [r] = both(defaultEngine(), json);
    expect(r.run({ x: 1.8 })).toEqual({ kind: 'interval', value: { lo: 0, hi: 0 } });
    const double = [BigInt(1.8 * 2 ** 52), 2n ** 52n];
    expect(
      atMachine((m) => m.box(json as never).subs({ x: m.number(double as never) }).N().re)
    ).toBe(0);
    expect(
      ce.box(json as never).subs({ x: ce.number(double as never) }).N().re
    ).toBe(1);
  });

  test('an exponent known at run time is read when it is a point', () => {
    const r = mode(['Power', 'x', 'y']);
    expect(r.code).toBe('_IA.powReal(_.x, _.y, 17)');
    const base = { lo: -8, hi: -1 };
    // `0.2` is `1/5`: the real root, as the interpreter gives at -8.
    const fifth = r.run({ x: base, y: 0.2 });
    expect(fifth.kind).toBe('interval');
    expect(fifth.value.lo).toBeLessThanOrEqual(
      ce.box(['Power', -8, 0.2] as never).N().re
    );
    expect(fifth.value.hi).toBeLessThan(-0.99);
    // `1.5` is `3/2`: no real value over a negative base.
    expect(r.run({ x: base, y: 1.5 })).toEqual({ kind: 'empty' });
    // The digits are those of the compilation: 15 at machine precision.
    expect(atMachine((m) => both(m, ['Power', 'x', 'a'])[0].code)).toBe(
      '_IA.powReal(_.x, _.a, 15)'
    );
  });

  test('a run-time exponent at an edge of the doubles gives a kinded result', () => {
    const r = mode(['Power', 'x', 'y']);
    for (const y of [NaN, Infinity, -Infinity, 0, -0, 5e-324, 2 ** 53, 2 ** 53 + 2])
      for (const x of [{ lo: -8, hi: -1 }, { lo: -2, hi: 3 }, { lo: 0.5, hi: 4 }]) {
        const v = r.run({ x, y });
        expect(typeof v.kind).toBe('string');
      }
  });

  test('a run-time exponent over a base whose enclosure is >= 0 is _IA.powInterval', () => {
    // The reading of `_IA.powReal` cannot apply there (`nonnegative()` with
    // `enclosed` in `ir/lower.ts`).
    expect(inlined(mode(['Power', 2, 'y']))).toBe(
      '_IA.powInterval({ lo: 2, hi: 2 }, _.y)'
    );
    expect(mode(['Power', ['Abs', 'x'], 'y']).code).toBe(
      '_IA.powInterval(_IA.abs(_.x), _.y)'
    );
    expect(mode(['Power', ['Power', 'x', 2], 'y']).code).toBe(
      '_IA.powInterval(_IA.square(_.x), _.y)'
    );
    // `sqrt` of any operand, and a `max` of one such operand (a ramp).
    expect(mode(['Power', ['Sqrt', 'x'], 'y']).code).toBe(
      '_IA.powInterval(_IA.sqrt(_.x), _.y)'
    );
    expect(inlined(mode(['Power', ['Max', 'x', 0], 'y']))).toBe(
      '_IA.powInterval(_IA.max(_.x, { lo: 0, hi: 0 }), _.y)'
    );
    // A real constant printed a few ulps wide around 0 can reach below 0.
    for (const base of [
      ['Rational', 1, ['Power', 10, 400]],
      ['Add', ['Abs', 'x'], ['Power', 10, -400]],
    ])
      expect(mode(['Power', base, 'y']).code).toContain('_IA.powReal(');
    // A real parameter that the loop index replaces after the lowering: the
    // pass `plain` makes the power `_IA.pow` of the number index.
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.declare('h', '(real) -> real');
    engine.assign('h', engine.box(['Function', ['Power', 2, 't'], 't'] as never));
    const loop = compile(
      engine.box(['Sum', ['Multiply', 'x', ['h', 'k']], ['Limits', 'k', 1, 200]] as never),
      { ...IR, fallback: false } as never
    ) as unknown as Result;
    expect(loop.code).toMatch(/_IA\.pow\(v\d+, v\d+\)/);
    expect(loop.code).not.toContain('powInterval');
    // A product can step its lower end below 0, and a base that is an input
    // can be negative: the reading stays. At -8, `0.2` is `1/5`, the real
    // root -1.5157…, as the interpreter gives.
    expect(mode(['Power', ['Multiply', 'x', 'x'], 'y']).code).toContain('_IA.powReal(');
    const r = mode(['Power', 'x', 'y']);
    expect(r.code).toBe('_IA.powReal(_.x, _.y, 17)');
    const root = r.run({ x: -8, y: 0.2 });
    const expected = ce.box(['Power', -8, 0.2] as never).N().re;
    expect(expected).toBeCloseTo(-1.5157165665103982, 15);
    expect(root.value.lo).toBeLessThanOrEqual(expected);
    expect(root.value.hi).toBeGreaterThanOrEqual(expected);
    expect(root.value.hi).toBeLessThan(-1.5);
  });

  test('a run-time exponent over a base whose enclosure is >= 0 contains the interpreter', () => {
    const bases = [
      2,
      0,
      ['Abs', 'x'],
      ['Power', 'x', 2],
      ['Exp', 'x'],
      ['Sqrt', ['Add', ['Power', 'x', 2], 1]],
      ['Sqrt', 'x'],
      ['Max', 'x', 0],
    ];
    const exponents = [0.2, 1.5, 3, -0.2, { lo: 0.1, hi: 0.3 }];
    for (const base of bases) {
      const json = ['Power', base, 'y'];
      const r = mode(json);
      for (const [lo, hi] of [[-2, 3], [0, 0], [0.5, 4], [-8, -8]])
        for (const y of exponents) {
          const got = r.run({ x: { lo, hi }, y });
          const ys = typeof y === 'number' ? [y] : [y.lo, (y.lo + y.hi) / 2, y.hi];
          for (const t of [0, 0.5, 1])
            for (const e of ys) {
              const at = lo + t * (hi - lo);
              const n = ce
                .box(json as never)
                .subs({ x: ce.number(at), y: ce.number(e) })
                .N();
              // No real value (`Sqrt(-2)^0.2` is complex): nothing to contain.
              const v = n.im === 0 ? n.re : NaN;
              if (!Number.isFinite(v)) continue;
              expect(['interval', 'partial', 'singular']).toContain(got.kind);
              expect(got.value.lo).toBeLessThanOrEqual(v);
              expect(got.value.hi).toBeGreaterThanOrEqual(v);
            }
        }
    }
  });

  test('Binomial and Choose of reals: _IA.binomial in the mode only', () => {
    for (const head of ['Binomial', 'Choose']) {
      const r = mode([head, 'x', 'y']);
      expect(r.code).toBe('_IA.binomial(_.x, _.y)');
      const point = { x: 5, y: 2.5 };
      expect(ce.box([head, 'x', 'y'] as never).subs(point).N().im).toBe(0);
      const got = r.run(point);
      expect(got.kind).toBe('interval');
      agreesWithInterpreter(got, [head, 'x', 'y'], [point]);
    }
    // The JavaScript target calls the interpreter's kernel of reals.
    expect(
      compile(ce.box(['Binomial', 'x', 'y'] as never), {
        to: 'javascript',
        profile: 'ir',
        fallback: false,
      } as never).code
    ).toContain('_SYS.binomial(_.x, _.y)');
  });
});

describe('the interval mode: decided comparisons', () => {
  test('a comparison whose type is a verdict is that verdict', () => {
    const square = ['Less', ['Power', ['Add', 'x', 1], 2], 0];
    for (const [json, verdict] of [
      [square, 'false'],
      [['Equal', 'x', 'x'], 'true'],
    ] as const) {
      expect(mode(json).code).toBe(`'${verdict}'`);
      expect(mode(json).run({ x: { lo: -3, hi: 2 } })).toBe(verdict);
    }
    // Not decided: computed.
    expect(mode(['Less', 'x', 'y']).code).toBe('_IA.less(_.x, _.y)');
    expect(mode(['Less', 'x', 'y']).run({ x: { lo: 0, hi: 2 }, y: 1 })).toBe(
      'maybe'
    );
    // A decided condition takes its arm; the other is not compiled.
    expect(mode(['If', square, 'x', ['Sqrt', 'x']]).code).toBe('_IA.sqrt(_.x)');
    // A false one with no other arm: the missing value has its arm's shape.
    const box = { x: { lo: 1, hi: 2 } };
    expect(mode(['If', square, ['Tuple', 'x', 1]]).run(box)).toEqual([
      { kind: 'empty' },
      { kind: 'empty' },
    ]);
    expect(mode(['If', square, 'x']).run(box)).toEqual({ kind: 'empty' });
  });
});

describe('the interval mode: values computed once', () => {
  ce.assign(
    'b',
    ce.box([
      'Function',
      ['Sum', ['Sin', ['Multiply', 'k', 't']], ['Limits', 'k', 1, 10]],
      't',
    ] as never)
  );
  ce.assign(
    'huge',
    ce.box([
      'Function',
      ['Sum', ['Sin', ['Multiply', 'k', 't']], ['Limits', 'k', 1, 1e12]],
      't',
    ] as never)
  );
  const count = (text: string, s: string) => text.split(s).length - 1;

  test('a constant read at each call is named once, in preambleOnce', () => {
    const r = mode([
      'Add',
      ['Multiply', 'Pi', 'x'],
      ['Multiply', 'Pi', 'y'],
      ['Multiply', 'Pi', ['Sin', 'x']],
    ]);
    const pi = '{ lo: 3.1415926535897927, hi: 3.1415926535897936 }';
    expect(r.code).not.toMatch(/\{ lo:/);
    expect(count(r.preambleOnce!, pi)).toBe(1);
    expect(r.preambleOnce).toMatch(/^const v\d+ = \{ lo: 3\.14/);
  });

  test('a call of constant arguments at the top level is computed once', () => {
    const r = mode(['Add', ['b', ['Multiply', 3, 'Pi']], 'x']) as Result & {
      preamblePerCall?: string;
    };
    // The call is in the code of the first call, and not in the code.
    expect(r.code).toMatch(/^_IA\.add\(_\.x, v\d+\)$/);
    expect(count(r.preamblePerCall!, '_b({')).toBe(1);
    // Its value is the value of the call computed at each call.
    const box = { x: { lo: 0, hi: 1 } };
    const v = r.run(box);
    expect(v.kind).toBe('interval');
    expect(r.run(box)).toEqual(v);
    const reference = mode(['Add', ['b', 'y'], 'x']).run({
      ...box,
      y: { lo: 3 * Math.PI, hi: 3 * Math.PI },
    });
    expect(v.value.lo).toBeCloseTo(reference.value.lo, 12);
    expect(v.value.hi).toBeCloseTo(reference.value.hi, 12);
    // In a function that the top level calls: its top level runs at every
    // call too, and its value is computed before the call of `w`.
    ce.assign(
      'w',
      ce.box(['Function', ['Multiply', ['b', 2], 't'], 't'] as never)
    );
    const w = mode(['Add', ['w', 3], 'x']) as Result & {
      preamblePerCall?: string;
    };
    const first = w.preamblePerCall!;
    expect(count(first, '_b(')).toBe(1);
    expect(count(first, '_w(')).toBe(1);
    expect(first.indexOf('_b(')).toBeLessThan(first.indexOf('_w('));
    expect(w.run(box).kind).toBe('interval');
  });

  test('a call is computed at the first call, not by compile() or the load', () => {
    // `b` computes 10 sines per call, and the rest of the program none.
    const sin = jest.spyOn(IntervalArithmetic, 'sin');
    try {
      const r = mode(['Add', ['b', ['Multiply', 3, 'Pi']], 'x']) as Result & {
        preamblePerCall?: string;
      };
      expect(r.preambleOnce).not.toMatch(/_b\(\{/);
      expect(count(r.preamblePerCall!, '_b({')).toBe(1);
      const loaded = createIntervalRuntime().load(
        JSON.parse(JSON.stringify(r))
      );
      expect(sin).toHaveBeenCalledTimes(0);
      for (let k = 0; k < 1000; k++) r.run({ x: k });
      expect(sin).toHaveBeenCalledTimes(10);
      // `broadcast()` and a stored copy are loads of their own: each
      // computes it at its first call.
      for (let k = 0; k < 3; k++)
        r.broadcast!({ x: new Float64Array([0, 0, 1, 2]) });
      expect(sin).toHaveBeenCalledTimes(20);
      loaded({ x: 0 });
      loaded({ x: 1 });
      expect(sin).toHaveBeenCalledTimes(30);
    } finally {
      sin.mockRestore();
    }
    // No value that can throw: no flag.
    const plain = mode(['Add', ['Multiply', 'Pi', 'x'], 1]) as Result & {
      preamblePerCall?: string;
    };
    expect(plain.preamblePerCall).toBeUndefined();
    expect(plain.preambleOnce).not.toMatch(/_once/);
  });

  test('a value that throws at its first call is entire at each call', () => {
    const r = mode(['Add', ['b', ['Multiply', 3, 'Pi']], 'x'], {
      iterationBudget: 5,
    }) as Result & { preamblePerCall?: string };
    expect(r.preamblePerCall).toMatch(/_once = e;/);
    // The load does not fail, and every call and cell is entire.
    const loaded = createIntervalRuntime().load(JSON.parse(JSON.stringify(r)));
    for (const f of [r.run, loaded])
      for (const x of [0, 1, { lo: -1, hi: 1 }])
        expect(f({ x })).toEqual({ kind: 'entire' });
    const out = r.broadcast!({ x: new Float64Array([0, 0, 1, 2]) });
    expect([out[2], out[5]]).toEqual([
      INTERVAL_KIND.entire,
      INTERVAL_KIND.entire,
    ]);
    // A loop of 10^12 passes at the load: refused before its first pass.
    const big = mode(['Add', ['huge', 1], 'x']);
    expect(big.run({ x: 0 })).toEqual({ kind: 'entire' });
  });

  test('a value that can fail in an arm is computed where it is read', () => {
    const r = mode(['If', ['Greater', 'x', 1.5], ['b', 2], 'y'], {
      iterationBudget: 5,
    }) as Result & { preamblePerCall?: string };
    expect(r.preamblePerCall).toBeUndefined();
    expect(r.code).toMatch(/_b\(v\d+\)/);
    expect(r.run({ x: { lo: 0, hi: 1 }, y: 3 })).toEqual({
      kind: 'interval',
      value: { lo: 3, hi: 3 },
    });
    expect(r.run({ x: { lo: 2, hi: 3 }, y: 3 })).toEqual({ kind: 'entire' });
  });

  test('a change of a returned value does not change the next result', () => {
    for (const json of [
      ['Multiply', 2, 'Pi'],
      ['List', 'Pi', 'x'],
      ['If', ['Greater', 'x', 0], 'Pi', ['Multiply', 2, 'Pi']],
    ]) {
      const r = mode(json);
      const box = { x: 1 };
      const first = JSON.stringify(r.run(box));
      const v = r.run(box);
      for (const w of Array.isArray(v) ? v : [v]) {
        if (w.value === undefined) continue;
        w.value.lo = 99;
        w.value.hi = 100;
      }
      expect(JSON.stringify(r.run(box))).toBe(first);
    }
  });

  test('2,000 constants and a constant list of 10,000 elements', () => {
    const many = mode([
      'Add',
      ...Array.from({ length: 2000 }, (_, k) => ['Sin', ['Add', 'x', k + 1]]),
    ]);
    // Each constant is named once.
    expect(count(many.preambleOnce!, '\n') + 1).toBe(2000);
    expect(many.code).not.toMatch(/\{ lo:/);
    expect(many.run({ x: 0 }).kind).toBe('interval');
    const elements = Array.from({ length: 10_000 }, (_, k) => [
      'Rational',
      k + 1,
      7,
    ]);
    const list = mode(['At', ['List', ...elements], ['Floor', 'x']]);
    // One declaration: the list, with its elements written in it.
    expect(count(list.preambleOnce!, '\n')).toBe(0);
    expect(list.code).toMatch(/^_IA\.at\(v\d+, _IA\.floor\(_\.x\)\)$/);
    const v = list.run({ x: 7 });
    expect(v.value.lo <= 1 && 1 <= v.value.hi).toBe(true);
  });
});

describe('the interval mode: batch 7, the order of a sum', () => {
  const ascending = /for \(let (v\d+) = \1_lo; \1 <= \1_hi; \1\+\+\) \{/;
  /** The indices of the terms of a sum written out (`term` matches a term
   *  and captures its index), in the order of the additions. */
  const terms = (r: Result, term: RegExp) =>
    [...inlined(r).matchAll(term)].map((m) => Number(m[1]));
  const upTo = (n: number) => Array.from({ length: n }, (_, k) => k + 1);

  // The README of `ir/`, "The interval mode": a sum is a loop from the
  // lower bound up, which contains the value of the scalar code adding
  // upward in doubles.
  describe('at machine precision', () => {
    let machine: ComputeEngine;
    beforeAll(() => {
      machine = new ComputeEngine();
      machine.precision = 'machine';
      machine.declare('x', 'real');
    });
    afterAll(() => {
      BigDecimal.precision = ce.precision;
    });
    test('a sum of constant bounds contains the value of the scalar code', () => {
      const json = ['Sum', ['Divide', ['Sin', ['Multiply', 'i', 'x']], 'i'], ['Limits', 'i', 1, 100]];
      const e = machine.box(json as never);
      const x = -11.491009020837964;
      const r = compile(e, { ...IR, fallback: false } as never) as unknown as Result;
      // Written out (at most 100 passes), from the first term: the identity
      // 0 is an exact zero, which `fold` removes.
      expect(r.code).not.toMatch(ascending);
      expect(inlined(r)).toMatch(
        /^[^]*?_IA\.add\(_IA\.div\(_IA\.sin\(_IA\.mul\(\{ lo: 1, hi: 1 \}, _\.x\)\), \{ lo: 1, hi: 1 \}\), /
      );
      expect(terms(r, /_IA\.div\(_IA\.sin\(_IA\.mul\(\{ lo: (\d+),/g)).toEqual(upTo(100));
      const want = machine.withValues({ x: machine.number(x) } as never, () =>
        e.evaluate().N()
      ).re;
      const scalar = (
        compile(e, { profile: 'ir', fallback: false } as never) as unknown as Result
      ).run({ x }) as number;
      expect(scalar).toBe(want);
      const { value } = r.run({ x });
      expect(value.lo <= want && want <= value.hi).toBe(true);
    });
  });

  test('a sum of two constant bounds is added from the lower bound up', () => {
    const r = mode(['Sum', ['Divide', 'x', 'i'], ['Limits', 'i', 1, 100]]);
    expect(terms(r, /_IA\.div\(_\.x, \{ lo: (\d+),/g)).toEqual(upTo(100));
    // Of more than 100 passes, a loop from the lower bound up.
    const loop = mode(['Sum', ['Divide', 'x', 'i'], ['Limits', 'i', 1, 101]]);
    expect(loop.code).toMatch(ascending);
    expect(loop.code).not.toMatch(/--\)/);
  });

  test('a sum of constant bounds of at most 100 passes is written out, on JavaScript and in the interval mode', () => {
    const json = ['Sum', ['Divide', ['Sin', ['Multiply', 'k', 'x']], 'k'], ['Limits', 'k', 1, 3]];
    const r = mode(json);
    expect(r.code).toBe(
      '_IA.add(_IA.add(_IA.div(_IA.sin(_IA.mul(v0, _.x)), v0), _IA.div(_IA.sin(_IA.mul(v8, _.x)), v8)), _IA.div(_IA.sin(_IA.mul(v1, _.x)), v1))'
    );
    expect(r.preambleOnce).toBe(
      'const v0 = { lo: 1, hi: 1 };\nconst v1 = { lo: 3, hi: 3 };\nconst v8 = { lo: 2, hi: 2 };'
    );
    // JavaScript writes it out too, added in the same order; GLSL keeps the
    // loop.
    const js = compile(ce.box(json as never), { profile: 'ir', fallback: false } as never) as unknown as Result;
    expect(js.code).toContain(
      '(((0 + (Math.sin((1 * _.x)) / 1)) + (Math.sin((2 * _.x)) / 2)) + (Math.sin((3 * _.x)) / 3))'
    );
    const glsl = compile(ce.box(json as never), { to: 'glsl', profile: 'ir', fallback: false } as never) as unknown as Result;
    expect(glsl.code).toContain('v13 = (v13 + (sin((v6 * x)) / v6));');
    // A part that reads only the index is computed once, in `preambleOnce`.
    const alt = mode(['Sum', ['Multiply', ['Divide', ['Power', -1, 'k'], 'k'], ['Sin', ['Multiply', 'k', 'x']]], ['Limits', 'k', 1, 3]]);
    expect(alt.code).toBe(
      '_IA.add(_IA.add(_IA.mul(v5, _IA.sin(_IA.mul(v0, _.x))), _IA.mul(v13, _IA.sin(_IA.mul(v11, _.x)))), _IA.mul(v19, _IA.sin(_IA.mul(v1, _.x))))'
    );
    expect(alt.preambleOnce).toContain('const v5 = _IA.div(v4, v0);');
    expect(alt.preambleOnce).toContain('const v18 = _IA.pow({ lo: -1, hi: -1 }, 3);');
    // Under an iterationBudget below the count, the loop, which refuses to
    // start: `entire`.
    const budget = mode(json, { iterationBudget: 2 });
    expect(budget.code).toMatch(ascending);
    expect(budget.run({ x: 0.5 }).kind).toBe('entire');
  });

  test('a term that declines or is complex keeps the loop of a sum of constant bounds', () => {
    // Codex's witness: at k = -1 both arms are lowered and Floor(Sqrt(-1))
    // declines; the loop guards the root at run time.
    const guarded = ['Sum', ['If', ['Less', 'k', 0], 'x', ['Floor', ['Sqrt', 'k']]], ['Limits', 'k', -1, 3]];
    const r = mode(guarded);
    expect(r.code).toMatch(ascending);
    for (const x of [-0.5, 0.5]) {
      const want = ce.box(guarded as never).subs({ x }).N().re;
      const { value } = r.run({ x });
      expect(value.lo <= want && want <= value.hi).toBe(true);
    }
    // `Sqrt(-2)` of a constant is complex; the loop's kernel gives `empty`,
    // as 101 passes do.
    const direct = mode(['Sum', ['Multiply', ['Sqrt', 'k'], 'x'], ['Limits', 'k', -2, 1]]);
    expect(direct.code).toMatch(ascending);
    expect(direct.run({ x: 0.5 })).toEqual(
      mode(['Sum', ['Multiply', ['Sqrt', 'k'], 'x'], ['Limits', 'k', -2, 98]]).run({ x: 0.5 })
    );
    expect(direct.run({ x: 0.5 }).kind).toBe('empty');
    // A complex value inside a term whose value is real or boolean: the
    // loop, which 101 passes give too. (The loop's real kernels give NaN
    // where the interpreter's value is complex: `Arcsin(2)` is no number,
    // so `If(Abs(Arcsin(k)) > 1, x, 1)` is 1 at k = 2 and 3.)
    const sum = (body: unknown, lo: number, hi: number) => ['Sum', body, ['Limits', 'k', lo, hi]];
    const abs = ['Multiply', ['Abs', ['Sqrt', 'k']], 'x'];
    const branch = ['If', ['Greater', ['Abs', ['Arcsin', 'k']], 1], 'x', 1];
    const shifted = ['Abs', ['Add', 'x', ['Sqrt', 'k']]];
    for (const [body, lo, hi] of [[abs, -2, 1], [branch, 0, 3], [shifted, -1, 1]] as const) {
      const r4 = mode(sum(body, lo, hi));
      expect(r4.code).toMatch(ascending);
      const r101 = mode(sum(body, lo, lo + 100));
      expect(r4.run({ x: 0.7 }).kind).toBe(r101.run({ x: 0.7 }).kind);
    }
    expect(mode(sum(abs, -2, 1)).run({ x: 0.7 })).toEqual({ kind: 'empty' });
    const { value } = mode(sum(branch, 0, 3)).run({ x: 0.7 });
    expect(value.lo <= 3.7 && 3.7 <= value.hi).toBe(true);
  });

  test('a sum of a list is added from the first element', () => {
    // `L` holds 3 elements, a short list: the sum is written out, in
    // ascending order from the first element (README, "Lists", the short
    // lists).
    const r = mode(['Sum', 'L']);
    expect(r.code).toBe('_IA.add(_IA.add(_.L[0], _.L[1]), _.L[2])');
    const { value } = r.run({ L: [0.1, 0.2, 0.3] });
    const want = ce.box(['Sum', ['List', 0.1, 0.2, 0.3]] as never).N().re;
    expect(value.lo <= want && want <= value.hi).toBe(true);
  });

  test('a reduction of a literal list of scalars is the reduction of its elements, with no array', () => {
    const json = ['Max', ['List', 'x', 'y', ['Multiply', 'x', 'y']]];
    const r = mode(json);
    expect(r.code).toBe('_IA.max(_IA.max(_.x, _.y), _IA.mul(_.x, _.y))');
    const box = { x: { lo: -1, hi: 2 }, y: 0.5 };
    expect(r.run(box)).toEqual({ kind: 'interval', value: { lo: 0.5, hi: 2 } });
    const sum = mode(['Sum', ['List', 'x', 'y', ['Multiply', 'x', 'y']]]);
    expect(inlined(sum)).toBe(
      '_IA.add(_IA.add(_.x, _.y), _IA.mul(_.x, _.y))'
    );
  });

  test('a literal list of one element', () => {
    expect(mode(['Max', ['List', 'x']]).code).toBe('_.x');
    expect(mode(['Max', ['List', 'x']]).run({ x: 0.5 })).toEqual({
      kind: 'interval',
      value: { lo: 0.5, hi: 0.5 },
    });
    expect(mode(['Sum', ['List', 'x']]).run({ x: { lo: -1, hi: 2 } })).toEqual({
      kind: 'interval',
      value: { lo: -1, hi: 2 },
    });
  });

  // A term written out whose `Block` reads the index only through the
  // attributes of a `Declare`: each term has its own value, not the value
  // of the first term (main `cc24cd740` gave 2.5 for the first sum).
  const dict = (value: unknown, more: object = {}) => [
    'Dictionary',
    ...Object.entries({ value, ...more }).map(([k, v]) => ['KeyValuePair', { str: k }, v]),
  ];
  const halved = (attributes: unknown, type?: string) => [
    'Block',
    ['Declare', 't', ...(type ? [type] : []), attributes],
    ['Assign', 't', ['Divide', 't', 2]],
    't',
  ];
  const sum = (body: unknown, hi: unknown = 5) => ['Sum', body, ['Limits', 'k', 1, hi]];
  const point = (v: number) => ({ kind: 'interval', value: { lo: v, hi: v } });

  test('a local declared with a value that reads the index has the value of each term', () => {
    expect(mode(sum(halved(dict('k')))).run({})).toEqual(point(7.5));
    expect(mode(sum(halved(dict('k'), "'real'"))).run({})).toEqual(point(7.5));
    expect(mode(sum(halved(dict('k', { constant: 'False' })))).run({})).toEqual(point(7.5));
    const constant = ['Block', ['Declare', 't', dict('k', { constant: 'True' })], ['Multiply', 't', 2]];
    expect(mode(sum(constant)).run({})).toEqual(point(30));
    // Terms of equal values (k = 1, 2) and of unequal ones: 1/2 + 1/2 + 1 + 1.
    expect(mode(sum(halved(dict(['Ceil', ['Divide', 'k', 2]])), 4)).run({})).toEqual(point(3));
    // A Product written out, and a Map over a short list.
    expect(mode(['Product', halved(dict('k')), ['Limits', 'k', 1, 4]]).run({})).toEqual(point(1.5));
    expect(
      mode(['Sum', ['Map', ['Function', halved(dict('k')), 'k'], ['List', 1, 2, 3, 4]]]).run({})
    ).toEqual(point(5));
    // A nested Block that declares the same name.
    const nested = [
      'Block',
      ['Declare', 't', dict('k')],
      ['Add', ['Block', ['Declare', 't', dict(['Multiply', 2, 'k'])], ['Assign', 't', ['Add', 't', 1]], 't'], 't'],
    ];
    expect(mode(sum(nested)).run({})).toEqual(point(50));
    // Not written out: a Loop, a Sum of a bound known at run time.
    const loop = [
      'Block',
      ['Declare', 's', "'real'", 0],
      ['Loop', ['Assign', 's', ['Add', 's', halved(dict('k'))]], ['Element', 'k', ['Range', 1, 5]]],
      's',
    ];
    expect(mode(loop).code).toMatch(/for \(/);
    expect(mode(loop).run({})).toEqual(point(7.5));
    const late = mode(sum(halved(dict('k')), ['Floor', 'n']));
    expect(late.code).toMatch(/for \(/);
    expect(late.run({ n: 5 })).toEqual(point(7.5));
  });

  test('a local declared with a value that reads the index and an input contains the value', () => {
    const json = sum(halved(dict(['Multiply', 'k', 'x'])));
    const r = mode(json);
    for (const [lo, hi] of [[0.5, 1.25], [-2, -0.5], [-1, 3], [0.7, 0.7]]) {
      const { value } = r.run({ x: { lo, hi } });
      for (const x of [lo, (lo + hi) / 2, hi]) {
        const want = ce.box(json as never).subs({ x }).N().re;
        expect(value.lo <= want && want <= value.hi).toBe(true);
      }
    }
    expect(r.run({ x: 0.5 })).toEqual(point(3.75));
  });
});

describe('the interval mode: a subtraction and a power of a rational exponent', () => {
  const text = (json: unknown, to: 'javascript' | 'glsl') =>
    (
      compile(ce.box(json as never), {
        to,
        profile: 'ir',
        fallback: false,
      } as never) as unknown as Result
    ).code;

  // The interval text, the JavaScript and the GLSL text, which the mode's
  // spellings do not change.
  // prettier-ignore
  test.each([
    // A negation read once is the subtrahend of `sub`, in either order.
    [['Subtract', 'x', 'y'], '_IA.sub(_.x, _.y)', '(_.x + (-_.y))', '(x + (-y))'],
    [['Add', ['Negate', 'x'], 'y'], '_IA.sub(_.y, _.x)', '((-_.x) + _.y)', '((-x) + y)'],
    [['Add', ['Negate', 'x'], ['Negate', 'y']], '_IA.sub(_IA.negate(_.x), _.y)', '((-_.x) + (-_.y))', '((-x) + (-y))'],
    [['Add', 'x', 'y', ['Negate', 'n']], '_IA.add(_IA.sub(_.x, _.n), _.y)', '(((-_.n) + _.x) + _.y)', '(((-n) + x) + y)'],
    // A negation read twice stays.
    [['Add', ['Exp', ['Negate', 'x']], ['Negate', 'x']], '(() => {\n  const v1 = _IA.negate(_.x);\n  return _IA.add(v1, _IA.exp(v1));\n})()', '(() => {\n  const v1 = (-_.x);\n  return (v1 + Math.exp(v1));\n})()', 'float v1 = (-x);\nreturn (v1 + exp(v1));'],
    // A denominator that is a power of 2: the principal power of the double.
    [['Power', ['Power', 'x', 2], ['Rational', 3, 2]], '_IA.pow(_IA.square(_.x), { lo: 1.5, hi: 1.5 }.lo)', '_SYS.ir.pow((_.x * _.x), 1.5)', '_gpu_ir_pow_nonnegative((x * x), 1.5)'],
    [['Power', 'x', ['Rational', -3, 2]], '_IA.pow(_.x, { lo: -1.5, hi: -1.5 }.lo)', '_SYS.ir.pow(_.x, (-1.5))', '_gpu_ir_pow(x, (-1.5))'],
    [['Power', 'x', ['Rational', 3, 4]], '_IA.pow(_.x, { lo: 0.75, hi: 0.75 }.lo)', '_SYS.ir.pow(_.x, 0.75)', '_gpu_ir_pow(x, 0.75)'],
    // Another denominator: the root, then the integer power.
    [['Power', 'x', ['Rational', 2, 3]], '_IA.pow(_IA.nthRootInterval(_.x, { lo: 3, hi: 3 }), 2)', '_SYS.ir.pow(_.x, 0.6666666666666666)', '_gpu_ir_pow(x, 0.6666667)'],
    [['Power', 'x', ['Rational', 5, 6]], '_IA.pow(_IA.nthRootInterval(_.x, { lo: 6, hi: 6 }), 5)', '_SYS.ir.pow(_.x, 0.8333333333333334)', '_gpu_ir_pow(x, 0.8333333)'],
  ])('%j', (json, interval, js, glsl) => {
    expect(inlined(mode(json))).toBe(interval);
    expect(text(json, 'javascript')).toBe(js);
    expect(text(json, 'glsl')).toBe(glsl);
  });

  test.each([
    [['Subtract', 'x', 'y'], { x: { lo: 1, hi: 2 }, y: { lo: 0.1, hi: 0.3 } }],
    [['Add', ['Negate', 'x'], 'y'], { x: { lo: 1, hi: 2 }, y: { lo: 0.1, hi: 0.3 } }],
    [['Power', 'x', ['Rational', 3, 2]], { x: { lo: -1, hi: 4 } }],
    [['Power', 'x', ['Rational', 3, 2]], { x: { lo: -4, hi: -1 } }],
    [['Power', 'x', ['Rational', -3, 2]], { x: { lo: 0, hi: 0 } }],
    [['Power', 'x', ['Rational', -3, 2]], { x: { lo: -1, hi: 1 } }],
  ])('the interpreter value at the ends and the midpoint: %j over %j', (json, box) => {
    const b = box as Record<string, { lo: number; hi: number }>;
    const points = [0, 0.5, 1].map((t) =>
      Object.fromEntries(
        Object.entries(b).map(([k, { lo, hi }]) => [k, lo + t * (hi - lo)])
      )
    );
    agreesWithInterpreter(mode(json).run(box), json, points);
  });

  test('the program that compileSlice() returns keeps its add and neg', () => {
    const s = compileSlice(ce.box(['Subtract', 'x', 'y'] as never), {
      target: 'javascript',
      mode: 'interval',
    });
    expect(s.code).toBe('_IA.sub(_.x, _.y)');
    const ops = s.program.functions[0].body.body.map((i) =>
      i.k === 'op' ? i.op : i.k
    );
    expect(ops).toEqual(['neg', 'add']);
    expect(text(['Subtract', 'x', 'y'], 'javascript')).toBe(
      '(_.x + (-_.y))'
    );
  });

  describe('integers, a loop and a negation read twice', () => {
    const engine = new ComputeEngine();
    for (const v of ['x', 'y', 'z']) engine.declare(v, 'real');
    for (const v of ['j', 'm']) engine.declare(v, 'integer');
    const within = (json: unknown) =>
      compile(engine.box(json as never), {
        ...IR,
        fallback: false,
      } as never) as unknown as Result;

    test('an integer subtraction is sub.int, spelled _IA.sub', () => {
      expect(inlined(within(['Subtract', 'j', 'm']))).toBe('_IA.sub(_.j, _.m)');
    });

    test('a negation in a loop body, and one outside the loop read in it', () => {
      // 101 passes: a sum of at most 100 is written out, and its negation is
      // then read once per term.
      const inLoop = within(['Sum', ['Add', ['Negate', ['Sin', 'x']], 'k'], ['Limits', 'k', 1, 101]]);
      // The pass `invariants` computes `sin(x)` before the loop, and the
      // negation with it: the subtraction reads it there.
      expect(inLoop.code).toContain('const v5 = _IA.sin(_.x);');
      expect(inLoop.code).toContain('_IA.sub({ lo: v3, hi: v3 }, v5)');
      expect(inLoop.code).not.toContain('negate');
      const outside = within([
        'Block',
        ['Declare', 't', "'real'", ['Negate', ['Sin', 'x']]],
        ['Sum', ['Add', 't', 'k'], ['Limits', 'k', 1, 101]],
      ]);
      expect(outside.code).toContain('const v1 = _IA.sin(_.x);');
      expect(outside.code).toContain('_IA.sub({ lo: v6, hi: v6 }, v1)');
      expect(outside.code).not.toContain('negate');
    });

    test('a negation read twice stays, and both adds', () => {
      const r = within([
        'Multiply',
        ['Add', ['Negate', ['Sin', 'x']], 'y'],
        ['Add', ['Negate', ['Sin', 'x']], 'z'],
      ]);
      expect(r.code).toBe(
        '(() => {\n  const v3 = _IA.negate(_IA.sin(_.x));\n  return _IA.mul(_IA.add(_.y, v3), _IA.add(_.z, v3));\n})()'
      );
    });
  });
});

describe('the interval mode: the references of the result', () => {
  ce.assign('hv', ce.box(['Function', ['Add', 't', 'n'], 't'] as never));
  /** The four fields of the result of `options`. */
  const fields = (json: unknown, options: object) => {
    const r = compile(ce.box(json as never), {
      to: 'interval-js',
      fallback: false,
      ...options,
    } as never) as unknown as Record<string, unknown>;
    return {
      freeSymbols: r.freeSymbols,
      freeSymbolTypes: r.freeSymbolTypes,
      unsupported: r.unsupported,
      mode: r.mode,
    };
  };
  // The rule of every target ("The report of the inputs", `ir/README.md`):
  // the names that the code reads, in the order the lowering first reads
  // them, each with its declared type.
  const real = { type: 'real', lowered: 'interval', provenance: 'declared' };
  test.each([
    [['Sin', 'x'], {}, ['x']],
    [['Add', ['Power', 'x', 2], 'y'], {}, ['x', 'y']],
    // The canonical `Add` puts `n` first.
    [['Add', 'x', 'n'], { vars: { n: '_.n' } }, ['n', 'x']],
    [['Add', 2, ['Sin', 1]], {}, []],
  ])('%j %j: the names the code reads', (json, options, names) => {
    const got = fields(json, { ...options, profile: 'ir' });
    expect(got).toEqual({
      freeSymbols: names,
      freeSymbolTypes: Object.fromEntries(names.map((n) => [n, real])),
      unsupported: [],
      mode: 'strict',
    });
  });

  test('the types of an input and of a list input', () => {
    const got = fields(['Add', ['Sum', 'L'], 'x'], { profile: 'ir' });
    expect(got.freeSymbols).toEqual(['x', 'L']);
    expect(got.freeSymbolTypes).toEqual({
      x: real,
      L: { type: 'vector<real^3>', lowered: 'array', provenance: 'declared' },
    });
    // A vars name that only the body of a user function reads is listed
    // after the names of the expression, where the call reads it.
    const vars = { vars: { n: '_.n' } };
    expect(fields(['hv', 'x'], { profile: 'ir', ...vars }).freeSymbols).toEqual(['x', 'n']);
    // A predicate that the mode decides reads no input.
    const abs = ['LessEqual', 0, ['Abs', 'x']];
    expect(fields(abs, { profile: 'ir' }).freeSymbols).toEqual([]);
  });
});

describe('the interval mode: three spellings', () => {
  /** The interpreter's value of `json` at the point `x`. */
  const at = (json: unknown, x: number) =>
    ce.box(json as never).subs({ x }).N().re;

  test('a rational times an inexact constant: the constant is computed once', () => {
    // Folded as a closed node: `N()` of `2π/3` and one ulp.
    const json = ['Multiply', ['Rational', 2, 3], 'Pi', 'x'];
    const r = mode(json);
    expect(r.code).toBe('_IA.mul(v2, _.x)');
    expect(r.preambleOnce).toBe(
      'const v2 = { lo: 2.0943951023931953, hi: 2.094395102393196 };'
    );
    // At machine precision a closed node is not folded: `(π / 3) · 2`.
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    machine.declare('x', 'real');
    const m = compile(machine.box(json as never), { ...IR, fallback: false } as never) as unknown as Result;
    expect(m.code).toBe('_IA.mul(v5, _.x)');
    expect(m.preambleOnce).toBe(
      'const v3 = _IA.div({ lo: 3.1415926535897927, hi: 3.1415926535897936 }, { lo: 3, hi: 3 });\nconst v5 = _IA.mul(v3, { lo: 2, hi: 2 });'
    );
    const k = (r: Result) => r.run({ x: 1 }).value;
    // Both contain 2π/3; the folded one is no wider (two ulps each).
    const want = at(['Multiply', ['Rational', 2, 3], 'Pi'], 0);
    for (const v of [k(r), k(m)]) expect(v.lo <= want && want <= v.hi).toBe(true);
    expect(k(r).hi - k(r).lo).toBeLessThanOrEqual(k(m).hi - k(m).lo);
    // A product of constants only keeps the division last (it is computed
    // once anyway): `Rational(1, 50)·π·i` of a term of a sum written out.
    const sum = ['Sum', ['Multiply', ['Cos', ['Multiply', ['Rational', 1, 50], 'Pi', 'i']], 'x'], ['Limits', 'i', 1, 2]];
    const pre = mode(sum).preambleOnce;
    expect(pre).toContain('_IA.mul({ lo: 3.1415926535897927, hi: 3.1415926535897936 }, { lo: 1, hi: 1 })');
    expect(pre).not.toMatch(/_IA\.div\(\{ lo: 3\.14/);
    // With no inexact constant the division stays last: the point 6 / 3 is
    // the point 2.
    const third = mode(['Multiply', ['Rational', 1, 3], 'x']);
    expect(third.code).toBe('_IA.div(_.x, v1)');
    expect(third.run({ x: 6 })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
    expect(mode(['Multiply', ['Rational', 1, 3], 'x', 'y']).code).toBe(
      '_IA.div(_IA.mul(_.x, _.y), v3)'
    );
  });

  describe.each(['default', 'machine'])('at the %s precision', (precision) => {
    const engine = new ComputeEngine();
    if (precision === 'machine') engine.precision = 'machine';
    engine.declare('x', 'real');
    engine.declare('y', 'real');
    test.each([
      [['Multiply', ['Rational', 2, 3], 'Pi', 'x']],
      [['Multiply', ['Rational', -5, 7], 'Pi', 'x']],
      [['Multiply', ['Rational', 1, 3], 'ExponentialE', 'x']],
      [['Sin', ['Multiply', ['Rational', 1, 3], 'Pi', ['Add', 'x', 1]]]],
      // A constant repeated is one value of the IR, placed twice.
      [['Multiply', ['Rational', 1, 3], 'Pi', 'Pi', 'x']],
      [['Multiply', ['Rational', 1, 3], 'Pi', 'x', 'Pi']],
      [['Multiply', ['Rational', 1, 3], 'ExponentialE', 'ExponentialE', 'x']],
      [['Multiply', ['Rational', 2, 5], 'Pi', 'ExponentialE', 'x', 'y']],
      [['Multiply', ['Rational', -5, 7], 'Pi', 2, 'x']],
      [['Multiply', ['Rational', 1, 3], 'Pi', ['List', 1, -2], 'x']],
    ])('%j contains the value of the interpreter', (json) => {
      for (const options of [{}, { constantFold: false }]) {
        const r = compile(engine.box(json as never), {
          ...IR,
          fallback: false,
          ...options,
        } as never) as unknown as Result;
        const boxes = [[0.5, 2], [-3, -1], [-1, 1], [0, 0], [-1e-300, 1e-300], [3, 3]];
        for (const [lo, hi] of boxes) {
          const got = r.run({ x: { lo, hi }, y: { lo: -1.5, hi: -1.5 } });
          for (const x of [lo, (lo + hi) / 2, hi]) {
            const n = engine.box(json as never).subs({ x, y: -1.5 }).N();
            // At x = 0 the interpreter's product with a list is the scalar 0.
            const want = n.ops ? n.ops.map((t) => t.re) : [n.re];
            const values = Array.isArray(got) ? got : [got];
            values.forEach(({ kind, value }, i) => {
              const w = want[i] ?? want[0];
              expect(kind).toBe('interval');
              expect(value.lo <= w && w <= value.hi).toBe(true);
            });
          }
        }
      }
    });
  });

  test('an addition of an exact zero is not written', () => {
    const forms: [unknown, unknown][] = [
      [['Sin', ['Subtract', 'x', ['At', ['List', 0, 1, 2], 1]]], ['Sin', 'x']],
      [['Add', ['Sqrt', 'x'], ['Divide', ['At', ['List', 0, 1], 1], 3]], ['Sqrt', 'x']],
      [['Add', ['Floor', 'x'], ['At', ['List', 0, 1.5], 1]], ['Floor', 'x']],
      [['Subtract', ['Divide', 1, 'x'], ['At', ['List', 0, 1], 1]], ['Divide', 1, 'x']],
    ];
    // A partial, a jump, a pole, an empty and an interval operand.
    const boxes = [
      { lo: -1, hi: 4 },
      { lo: 0.5, hi: 1.5 },
      { lo: -1, hi: 1 },
      { lo: -2, hi: -1 },
      { lo: 2, hi: 3 },
    ];
    for (const [json, alone] of forms) {
      const r = mode(json);
      expect(r.code).toBe(mode(alone).code);
      expect(r.code).not.toMatch(/_IA\.(add|sub)\(/);
      for (const x of boxes)
        expect(r.run({ x })).toEqual(mode(alone).run({ x }));
    }
    expect(mode(forms[1][0]).run({ x: { lo: -1, hi: 4 } }).kind).toBe('partial');
    expect(mode(forms[2][0]).run({ x: { lo: 0.5, hi: 1.5 } }).kind).toBe('singular');
    expect(mode(forms[1][0]).run({ x: { lo: -2, hi: -1 } }).kind).toBe('empty');
    // A product by an exact zero stays: `0·∞` is not 0.
    expect(mode(['Multiply', ['At', ['List', 0, 1], 1], 'x']).code).toBe(
      '_IA.mul(_.x, v1)'
    );
  });

  test('the kernel of an addition of an exact zero gives its operand, but for a sign of zero and the side of a clip', () => {
    const ia = IntervalArithmetic as unknown as Record<string, (...a: unknown[]) => unknown>;
    const ends = [-Infinity, -3, -0.5, -0, 0, 5e-324, 2, Infinity];
    const operands: unknown[] = [
      { kind: 'empty' },
      { kind: 'entire' },
      { kind: 'singular' },
      { kind: 'singular', at: 2 },
      { lo: NaN, hi: NaN },
    ];
    for (const lo of ends)
      for (const hi of ends) {
        if (lo > hi) continue;
        const value = { lo, hi };
        operands.push(value, { kind: 'interval', value }, { kind: 'partial', value, domainClipped: 'both' });
        if (lo !== hi && Number.isFinite(lo) && Number.isFinite(hi))
          operands.push({ kind: 'singular', at: 1, continuity: 'left', value });
      }
    const wrap = (r: any) => (r?.kind === undefined ? { kind: 'interval', value: r } : r);
    // `+0` turns an end -0 into +0; `-0` keeps every end.
    const unsigned = (r: unknown) =>
      JSON.parse(JSON.stringify(r, (_, x) => (Object.is(x, -0) ? 0 : x)));
    for (const x of operands) {
      expect(wrap(ia.add(x, { lo: -0, hi: -0 }))).toEqual(wrap(x));
      expect(wrap(ia.sub(x, { lo: 0, hi: 0 }))).toEqual(wrap(x));
      expect(unsigned(wrap(ia.add(x, { lo: 0, hi: 0 })))).toEqual(unsigned(wrap(x)));
    }
    // A partial clipped on one side is clipped on both after the kernel.
    expect(ia.add({ kind: 'partial', value: { lo: 0, hi: 1 }, domainClipped: 'lo' }, { lo: 0, hi: 0 })).toEqual({
      kind: 'partial',
      value: { lo: 0, hi: 1 },
      domainClipped: 'both',
    });
    // The quotient of ±0 by a finite nonzero point is [0, 0].
    for (const c of [-7, -0.5, 5e-324, 3, 1e308])
      for (const z of [0, -0])
        expect(ia.div({ lo: z, hi: z }, { lo: c, hi: c })).toEqual({
          kind: 'interval',
          value: { lo: 0, hi: 0 },
        });
  });

  test('a quotient of a negation is _IA.negDiv', () => {
    const json = ['Divide', ['Negate', 'x'], 'y'];
    expect(mode(json).code).toBe('_IA.negDiv(_.x, _.y)');
    const ends = ({ lo, hi }: { lo: number; hi: number }) => [lo, (lo + hi) / 2, hi];
    for (const y of [{ lo: 1, hi: 2 }, { lo: 0, hi: 1 }, { lo: -1, hi: 0 }, { lo: -1, hi: 1 }, { lo: 0, hi: 0 }])
      for (const x of [{ lo: 1, hi: 2 }, { lo: -2, hi: 3 }, { lo: -0, hi: 0 }]) {
        const points = ends(x).flatMap((a) => ends(y).map((b) => ({ x: a, y: b })));
        agreesWithInterpreter(mode(json).run({ x, y }), json, points);
      }
    // A negation read twice is computed once, and the quotient reads it.
    expect(mode(['Add', json, ['Negate', 'x']]).code).toMatch(
      /_IA\.div\(v1, _\.y\)/
    );
    // Not a negation of a quotient: its clipped end differs.
    expect(mode(['Negate', ['Divide', 'x', 'y']]).code).toBe(
      '_IA.negate(_IA.div(_.x, _.y))'
    );
  });

  test('the kernel _IA.negDiv(a, b) is _IA.div(_IA.negate(a), b)', () => {
    const ia = IntervalArithmetic as unknown as Record<string, (...a: unknown[]) => unknown>;
    const ends = [-Infinity, -1e308, -3, -0.5, -5e-324, -0, 0, 5e-324, 0.1, 2, 1e308, Infinity];
    const operands: unknown[] = [
      { kind: 'empty' },
      { kind: 'entire' },
      { kind: 'singular' },
      { kind: 'singular', at: 2 },
      { lo: NaN, hi: NaN },
    ];
    for (const lo of ends)
      for (const hi of ends) {
        if (lo > hi) continue;
        const value = { lo, hi };
        operands.push(value, { kind: 'interval', value });
        for (const domainClipped of ['lo', 'hi', 'both'])
          operands.push({ kind: 'partial', value, domainClipped });
        if (lo !== hi && Number.isFinite(lo) && Number.isFinite(hi))
          operands.push({ kind: 'singular', at: 0.5, continuity: 'right', value });
      }
    const key = (r: unknown) =>
      JSON.stringify(r, (_, x) => (Object.is(x, -0) ? '-0' : typeof x === 'number' && !Number.isFinite(x) ? String(x) : x));
    let differ = 0;
    for (const a of operands)
      for (const b of operands)
        if (key(ia.negDiv(a, b)) !== key(ia.div(ia.negate(a), b))) differ++;
    expect(differ).toBe(0);
  });
});

describe('the interval mode: zero to the power zero (CE-1372)', () => {
  // `0^0` has no value, as in the interpreter, and a box that is that point is `empty`.
  // A box that holds the point and others keeps its enclosure.
  const run = (json: unknown, b: Record<string, unknown>) =>
    (
      compile(ce.box(json as never), {
        to: 'interval-js',
        profile: 'ir',
        fallback: false,
      } as never) as unknown as { run: (b: unknown) => unknown }
    ).run(b);
  const point = (v: number) => ({ lo: v, hi: v });

  test('y^x at (0, 0) is empty, a wider box keeps its enclosure', () => {
    expect(run(['Power', 'y', 'x'], { x: point(0), y: point(0) })).toEqual({
      kind: 'empty',
    });
    expect(
      run(['Power', 'y', 'x'], { x: { lo: 0, hi: 1 }, y: point(0) })
    ).toEqual({ kind: 'interval', value: { lo: 0, hi: 1 } });
  });

  test('a comparison on 0^0 is not decided true', () => {
    const less = [
      'Less',
      0,
      ['Add', ['Multiply', 'y', ['Power', 'y', ['Floor', 'x']]], 1],
    ];
    expect(run(less, { x: point(0.5), y: point(0) })).toBe('false');
  });

  test('a written-out sum of x^k from k = 0 has no value at x = 0', () => {
    // The interpreter gives NaN there: its term x^0 is 0^0.
    const sum = ['Sum', ['Power', 'x', 'k'], ['Limits', 'k', 0, 3]];
    expect(ce.box(sum as never).subs({ x: 0 }).N().isNaN).toBe(true);
    expect(run(sum, { x: point(0) })).toEqual({ kind: 'empty' });
    expect(run(sum, { x: { lo: -1, hi: 1 } })).toEqual({
      kind: 'interval',
      value: { lo: -1, hi: 4 },
    });
    expect(run(sum, { x: point(2) })).toEqual({
      kind: 'interval',
      value: { lo: 15, hi: 15 },
    });
  });
});
