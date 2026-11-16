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

  test('a boolean name of vars is a boolean input, as in the existing target', () => {
    const options = { to: 'interval-js', vars: { p: '_.p' } };
    const old = compile(
      ce.box(['Not', 'p'] as never),
      options as never
    ) as unknown as Result;
    const r = mode(['Not', 'p'], { vars: { p: '_.p' } });
    expect(r.profile).toBe('ir');
    expect(old.booleanInputs).toEqual(['p']);
    expect(r.booleanInputs).toEqual(['p']);
    expect(r.broadcast!({ p: [] })).toEqual(old.broadcast!({ p: [] }));
    expect(r.broadcast!({ p: [] }).length).toBe(0);
    expect(r.run({ p: true })).toBe('false');
    expect(old.run({ p: true })).toBe('false');
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

  test('a decline: outside-profile with fallback false, the existing target with it', () => {
    // A `Loop` with no `Element` clause, which the existing target compiles.
    const loop = [
      'Block',
      ['Declare', 's', 'real', 0],
      ['Loop', ['Block', ['If', ['Greater', 's', 3], ['Break']], ['Assign', 's', ['Add', 's', 1]]]],
      ['Multiply', 's', 'x'],
    ];
    const e = declineOf(() => mode(loop));
    expect(e.diagnostic.code).toBe('outside-profile');
    expect(e.message).toMatch(/a Loop with no Element clause/);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = compile(ce.box(loop as never), IR as never) as unknown as Result;
      expect(r.success).toBe(true);
      expect(r.profile).toBeUndefined();
      expect(r.run({ x: { lo: 1, hi: 2 } }).kind).toBe('interval');
    } finally {
      warn.mockRestore();
    }
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
      [{ functions: { f: () => 1 } }, /the option `functions`/],
      [{ preamble: 'const a = 1;' }, /the option `preamble`/],
      [{ strictTypes: true }, /the option `strictTypes`/],
    ] as const)
      expect(declineOf(() => mode(['Add', 'x', 'c'], options)).message).toMatch(
        cause
      );
    // No effect.
    expect(
      mode(['Sin', 'x'], {
        entryChecks: false,
        broadcast: true,
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
    expect(e.message).toMatch(/"abc": not a number/);
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
    // and run() answers a RangeError with entire, as the existing target.
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
    // The existing target gives the same kinds.
    const old = compile(ce.box(sum as never), {
      to: 'interval-js',
      iterationBudget: 5,
    } as never) as unknown as Result;
    expect(old.run({ x: 0.5, n: 6 })).toEqual({ kind: 'entire' });
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
  // arm is printed once (the existing target writes the first arm twice),
  // so the text grows with the program.
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
  const time = (f: () => unknown): number => {
    const start = Date.now();
    try {
      f();
    } catch (e) {
      if (!(e instanceof CompileDeclineError)) throw e;
    }
    return Date.now() - start;
  };
  test('a chain of 1,000 Ifs and a triple nested sum compile in under a second or decline', () => {
    // A `Which` of 1,000 clauses is a nest of 1,000 `if` instructions (a
    // nest of 1,000 `If` expressions exceeds the call stack of the
    // canonical form, before the compiler).
    const which: unknown[] = ['Which'];
    for (let k = 0; k < 1000; k++)
      which.push(['Less', 'x', k], ['Multiply', k, 'x']);
    which.push('True', 'x');
    expect(time(() => mode(which))).toBeLessThan(1000);
    expect(mode(which).run({ x: { lo: 10.5, hi: 12.5 } })).toEqual({
      kind: 'interval',
      value: { lo: 115.5, hi: 162.5 },
    });
    const triple = [
      'Sum',
      ['Sum', ['Sum', ['Sin', ['Multiply', 'i', 'j', 'k', 'x']], ['Limits', 'k', 1, 'j']], ['Limits', 'j', 1, 'i']],
      ['Limits', 'i', 1, 'n'],
    ];
    expect(time(() => mode(triple))).toBeLessThan(1000);
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
      // decimal of the program: one ulp on each side, as the existing target.
      const json = ['Add', 'x', name];
      for (const engine of [defaultEngine, undefined]) {
        const [r, old] = engine
          ? both(engine(), json)
          : atMachine((m) => both(m, json));
        const got = r.run({ x: 0 }) as { value: { lo: number; hi: number } };
        expect(got.value.lo).toBeLessThan(got.value.hi);
        expect(got).toEqual(old.run({ x: 0 }));
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
    // number that is not exact: an enclosure of one ulp, where the existing
    // target, which names it, gives the point.
    const [r, old] = both(engine, ['Add', 'x', 'MachineEpsilon']);
    const eps = r.run({ x: 0 }) as { value: { lo: number; hi: number } };
    expect(eps.value.lo).toBeLessThan(Number.EPSILON);
    expect(eps.value.hi).toBeGreaterThan(Number.EPSILON);
    expect(old.run({ x: 0 })).toEqual(point(Number.EPSILON));
  });

  test('a decimal literal is a point: a pole of 1 / (0.5·Sin(2x) + 0.5) at the edge', () => {
    const json = ['Divide', 1, ['Add', ['Multiply', 0.5, ['Sin', ['Multiply', 2, 'x']]], 0.5]];
    const box = { x: { lo: -1.88, hi: 8.12 } };
    const expected = {
      kind: 'partial',
      value: { lo: 1, hi: Infinity },
      domainClipped: 'hi',
    };
    for (const results of [both(defaultEngine(), json), atMachine((m) => both(m, json))]) {
      expect(results[0].run(box)).toEqual(expected);
      expect(results[1].run(box)).toEqual(expected);
    }
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
    const [r, old] = atMachine((m) => both(m, guard));
    const box = { x: { lo: 0.49, hi: 0.51 } };
    expect(r.run(box).kind).toBe('interval');
    expect(r.run(box)).toEqual(old.run(box));
    // `1/3` has no double: its enclosure leaves `3x` above 1 at one ulp.
    const third = [
      'Which',
      ['GreaterEqual', 'x', ['Rational', 1, 3]],
      0,
      'True',
      ['Arccos', ['Multiply', 3, 'x']],
    ];
    const [r3, old3] = atMachine((m) => both(m, third));
    const box3 = { x: { lo: 0.33, hi: 0.34 } };
    expect(r3.run(box3)).toMatchObject({ kind: 'partial', domainClipped: 'hi' });
    expect(r3.run(box3)).toEqual(old3.run(box3));
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

  test('a base that is provably non-negative: the principal power, as the existing target', () => {
    // Tycho's `neyret/dmibg1uaof`.
    const json = [
      'Power',
      ['Add', ['Power', ['Abs', ['Subtract', 'x', 1]], 0.2], ['Power', ['Abs', ['Add', ['Multiply', 2, 'x'], 1]], 0.2]],
      { num: '5.0' },
    ];
    const [r, old] = atMachine((m) => both(m, json));
    expect(r.code).not.toContain('powRealBranch');
    expect(r.code).not.toContain('nthRoot');
    for (const box of [
      { x: { lo: -1.623107644263655, hi: -1.623107644263655 } },
      { x: { lo: -2, hi: 3 } },
      { x: { lo: 0.9, hi: 1.1 } },
    ])
      expect(r.run(box)).toEqual(old.run(box));
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
    // `x - 1.8` is 0 in the mode, on the existing target, in the
    // JavaScript code and in the interpreter at machine precision, and
    // about 4.4e-17 in the interpreter at the default precision, which
    // computes with the decimal 1.8: `Ceil` is 0 against 1.
    const json = ['Ceil', ['Subtract', 'x', 1.8]];
    const [r, old] = both(defaultEngine(), json);
    expect(r.run({ x: 1.8 })).toEqual({ kind: 'interval', value: { lo: 0, hi: 0 } });
    expect(old.run({ x: 1.8 })).toEqual({ kind: 'interval', value: { lo: 0, hi: 0 } });
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

  test('Binomial and Choose of reals: _IA.binomial in the mode only', () => {
    for (const head of ['Binomial', 'Choose']) {
      const r = mode([head, 'x', 'y']);
      expect(r.code).toBe('_IA.binomial(_.x, _.y)');
      expect(r.run({ x: 5, y: 2.5 })).toEqual(
        (compile(ce.box([head, 'x', 'y'] as never), { to: 'interval-js' } as never) as unknown as Result).run({ x: 5, y: 2.5 })
      );
    }
    // The JavaScript target keeps the integer signature.
    expect(() =>
      compile(ce.box(['Binomial', 'x', 'y'] as never), {
        to: 'javascript',
        profile: 'ir',
        fallback: false,
      } as never)
    ).toThrow(CompileDeclineError);
  });
});

describe('the interval mode: decided comparisons', () => {
  test('a comparison whose type is a verdict is that verdict, as on the existing target', () => {
    const existing = (json: unknown) =>
      (
        compile(ce.box(json as never), {
          to: 'interval-js',
          fallback: false,
        } as never) as unknown as Result
      ).code;
    const square = ['Less', ['Power', ['Add', 'x', 1], 2], 0];
    for (const [json, verdict] of [
      [square, 'false'],
      [['Equal', 'x', 'x'], 'true'],
    ] as const) {
      expect(mode(json).code).toBe(`'${verdict}'`);
      expect(existing(json)).toBe(`'${verdict}'`);
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
    for (const json of [
      ['If', square, ['Tuple', 'x', 1]],
      ['If', square, 'x'],
    ]) {
      const old = compile(ce.box(json as never), {
        to: 'interval-js',
        fallback: false,
      } as never) as unknown as Result;
      expect(mode(json).run(box)).toEqual(old.run(box));
    }
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
  const old = (json: unknown, engine = ce) =>
    compile(engine.box(json as never), {
      to: 'interval-js',
      fallback: false,
    } as never) as unknown as Result;
  const ascending = /for \(let (v\d+) = \1_lo; \1 <= \1_hi; \1\+\+\) \{/;
  /** The indices of the terms of a sum written out (`term` matches a term
   *  and captures its index), in the order of the additions. */
  const terms = (r: Result, term: RegExp) =>
    [...inlined(r).matchAll(term)].map((m) => Number(m[1]));
  const upTo = (n: number) => Array.from({ length: n }, (_, k) => k + 1);

  // The README of `ir/`, "The interval mode": a sum is a loop from the
  // lower bound up, which contains the value of the scalar code adding
  // upward in doubles; the existing target adds from the last term.
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
    test('a sum of constant bounds contains the value of the scalar code, where the existing target does not', () => {
      const json = ['Sum', ['Divide', ['Sin', ['Multiply', 'i', 'x']], 'i'], ['Limits', 'i', 1, 100]];
      const e = machine.box(json as never);
      const x = -11.491009020837964;
      const r = compile(e, { ...IR, fallback: false } as never) as unknown as Result;
      // Written out (at most 100 passes), from the identity and the first
      // term.
      expect(r.code).not.toMatch(ascending);
      expect(inlined(r)).toMatch(/^[^]*?_IA\.add\(\{ lo: 0, hi: 0 \}, /);
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
      // The stated difference: the existing target's sum, added from the
      // last term, is narrower and leaves the value out.
      const was = old(json, machine).run({ x });
      expect(was.kind).toBe('interval');
      expect(was.value.lo <= want && want <= was.value.hi).toBe(false);
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

  test('a sum of constant bounds of at most 100 passes is written out, on the interval mode only', () => {
    const json = ['Sum', ['Divide', ['Sin', ['Multiply', 'k', 'x']], 'k'], ['Limits', 'k', 1, 3]];
    const r = mode(json);
    expect(r.code).toBe(
      '_IA.add(_IA.add(_IA.add(v2, _IA.div(_IA.sin(_IA.mul(v0, _.x)), v0)), _IA.div(_IA.sin(_IA.mul(v8, _.x)), v8)), _IA.div(_IA.sin(_IA.mul(v1, _.x)), v1))'
    );
    expect(r.preambleOnce).toBe(
      'const v0 = { lo: 1, hi: 1 };\nconst v1 = { lo: 3, hi: 3 };\nconst v2 = { lo: 0, hi: 0 };\nconst v8 = { lo: 2, hi: 2 };'
    );
    // The JavaScript and GLSL code keep the loop.
    const js = compile(ce.box(json as never), { profile: 'ir', fallback: false } as never) as unknown as Result;
    expect(js.code).toContain('v10 = (v10 + (Math.sin((v3 * _.x)) / v3));');
    const glsl = compile(ce.box(json as never), { to: 'glsl', profile: 'ir', fallback: false } as never) as unknown as Result;
    expect(glsl.code).toContain('v13 = (v13 + (sin((v6 * x)) / v6));');
    // A part that reads only the index is computed once, in `preambleOnce`.
    const alt = mode(['Sum', ['Multiply', ['Divide', ['Power', -1, 'k'], 'k'], ['Sin', ['Multiply', 'k', 'x']]], ['Limits', 'k', 1, 3]]);
    expect(alt.code).toBe(
      '_IA.add(_IA.add(_IA.add(v2, _IA.mul(v5, _IA.sin(_IA.mul(v0, _.x)))), _IA.mul(v13, _IA.sin(_IA.mul(v11, _.x)))), _IA.mul(v19, _IA.sin(_IA.mul(v1, _.x))))'
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

  test('a sum of a list is added from the first element, as the existing target', () => {
    // `L` holds 3 elements, a short list: the sum is written out, in
    // ascending order from the first element (README, "Lists", the short
    // lists).
    const r = mode(['Sum', 'L']);
    expect(r.code).toBe('_IA.add(_IA.add(_.L[0], _.L[1]), _.L[2])');
    expect(r.run({ L: [0.1, 0.2, 0.3] })).toEqual(
      old(['Sum', 'L']).run({ L: [0.1, 0.2, 0.3] })
    );
  });

  test('a reduction of a literal list of scalars is the reduction of its elements, with no array', () => {
    const json = ['Max', ['List', 'x', 'y', ['Multiply', 'x', 'y']]];
    const r = mode(json);
    expect(r.code).toBe('_IA.max(_IA.max(_.x, _.y), _IA.mul(_.x, _.y))');
    const box = { x: { lo: -1, hi: 2 }, y: 0.5 };
    expect(r.run(box)).toEqual({ kind: 'interval', value: { lo: 0.5, hi: 2 } });
    expect(old(json).run(box)).toEqual(r.run(box));
    const sum = mode(['Sum', ['List', 'x', 'y', ['Multiply', 'x', 'y']]]);
    expect(inlined(sum)).toBe(
      '_IA.add(_IA.add(_IA.add({ lo: 0, hi: 0 }, _.x), _.y), _IA.mul(_.x, _.y))'
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
});

describe('the interval mode: a subtraction and a power of a rational exponent', () => {
  const old = (json: unknown) =>
    compile(ce.box(json as never), {
      to: 'interval-js',
      fallback: false,
    } as never) as unknown as Result;
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
    // A negation read once is the subtrahend of `sub`, in either order, as
    // the existing target writes it.
    [['Subtract', 'x', 'y'], '_IA.sub(_.x, _.y)', '(() => {\n  return (_.x + (-_.y));\n})()', '(x + (-y))'],
    [['Add', ['Negate', 'x'], 'y'], '_IA.sub(_.y, _.x)', '(() => {\n  return ((-_.x) + _.y);\n})()', '((-x) + y)'],
    [['Add', ['Negate', 'x'], ['Negate', 'y']], '_IA.sub(_IA.negate(_.x), _.y)', '(() => {\n  return ((-_.x) + (-_.y));\n})()', '((-x) + (-y))'],
    [['Add', 'x', 'y', ['Negate', 'n']], '_IA.add(_IA.sub(_.x, _.n), _.y)', '(() => {\n  return (((-_.n) + _.x) + _.y);\n})()', '(((-n) + x) + y)'],
    // A negation read twice stays.
    [['Add', ['Exp', ['Negate', 'x']], ['Negate', 'x']], '(() => {\n  const v1 = _IA.negate(_.x);\n  return _IA.add(v1, _IA.exp(v1));\n})()', '(() => {\n  const v1 = (-_.x);\n  return (v1 + Math.exp(v1));\n})()', 'float v1 = (-x);\nreturn (v1 + exp(v1));'],
    // A denominator that is a power of 2: the principal power of the double.
    [['Power', ['Power', 'x', 2], ['Rational', 3, 2]], '_IA.pow(_IA.square(_.x), { lo: 1.5, hi: 1.5 }.lo)', '(() => {\n  return _SYS.ir.pow((_.x * _.x), 1.5);\n})()', '_gpu_ir_pow((x * x), 1.5)'],
    [['Power', 'x', ['Rational', -3, 2]], '_IA.pow(_.x, { lo: -1.5, hi: -1.5 }.lo)', '(() => {\n  return _SYS.ir.pow(_.x, (-1.5));\n})()', '_gpu_ir_pow(x, (-1.5))'],
    [['Power', 'x', ['Rational', 3, 4]], '_IA.pow(_.x, { lo: 0.75, hi: 0.75 }.lo)', '(() => {\n  return _SYS.ir.pow(_.x, 0.75);\n})()', '_gpu_ir_pow(x, 0.75)'],
    // Another denominator: the root, then the integer power.
    [['Power', 'x', ['Rational', 2, 3]], '_IA.pow(_IA.nthRootInterval(_.x, { lo: 3, hi: 3 }), 2)', '(() => {\n  return _SYS.ir.pow(_.x, 0.6666666666666666);\n})()', '_gpu_ir_pow(x, 0.6666667)'],
    [['Power', 'x', ['Rational', 5, 6]], '_IA.pow(_IA.nthRootInterval(_.x, { lo: 6, hi: 6 }), 5)', '(() => {\n  return _SYS.ir.pow(_.x, 0.8333333333333334);\n})()', '_gpu_ir_pow(x, 0.8333333)'],
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
  ])('the result of the existing target: %j over %j', (json, box) => {
    expect(mode(json).run(box)).toEqual(old(json).run(box));
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
      '(() => {\n  return (_.x + (-_.y));\n})()'
    );
  });

  describe('integers, a loop and a negation read twice', () => {
    const engine = new ComputeEngine();
    for (const v of ['x', 'y', 'z']) engine.declare(v, 'real');
    for (const v of ['j', 'm']) engine.declare(v, 'integer');
    const both = (json: unknown) => {
      const expr = engine.box(json as never);
      return [
        compile(expr, { ...IR, fallback: false } as never),
        compile(expr, { to: 'interval-js', fallback: false } as never),
      ] as unknown as [Result, Result];
    };
    const boxes = [
      { x: { lo: 0.1, hi: 0.4 }, y: { lo: 1, hi: 2 }, z: { lo: -1, hi: 0 }, j: 3, m: -2 },
      { x: { lo: -2, hi: 1 }, y: 0.5, z: 3, j: { lo: 5, hi: 5 }, m: 7 },
    ];
    /** The result of the mode is the existing target's, or inside it. */
    const within = (json: unknown) => {
      const [r, was] = both(json);
      for (const b of boxes) {
        const [a, o] = [r.run(b), was.run(b)];
        expect(a.kind).toBe(o.kind);
        expect(a.value.lo >= o.value.lo && a.value.hi <= o.value.hi).toBe(true);
      }
      return r;
    };

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
  test.each([
    [['Sin', 'x'], {}],
    [['Add', ['Power', 'x', 2], 'y'], {}],
    [['Add', 'x', 'n'], { vars: { n: '_.n' } }],
    [['Add', ['Sum', 'L'], 'x'], {}],
    [['Add', 2, ['Sin', 1]], {}],
  ])('%j %j: those of the existing target', (json, options) => {
    const got = fields(json, { ...options, profile: 'ir' });
    expect(got).toEqual(fields(json, options));
    expect(got.unsupported).toEqual([]);
    expect(got.mode).toBe('strict');
  });

  test('the types of an input and of a list input', () => {
    const got = fields(['Add', ['Sum', 'L'], 'x'], { profile: 'ir' });
    expect(got.freeSymbols).toEqual(['x', 'L']);
    expect(got.freeSymbolTypes).toEqual({
      x: { type: 'real', lowered: 'interval', provenance: 'declared' },
      L: { type: 'vector<real^3>', lowered: 'array', provenance: 'declared' },
    });
    // A vars name that only the body of a user function reads is listed
    // after the names of the expression; the existing target, which writes
    // the body in place first, lists it before them.
    const vars = { vars: { n: '_.n' } };
    expect(fields(['hv', 'x'], { profile: 'ir', ...vars }).freeSymbols).toEqual(['x', 'n']);
    expect(fields(['hv', 'x'], vars).freeSymbols).toEqual(['n', 'x']);
    expect(fields(['Add', 2, ['Sin', 1]], { profile: 'ir' }).freeSymbols).toEqual([]);
  });
});
