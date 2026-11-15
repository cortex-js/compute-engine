/**
 * The interval mode of the IR pipeline (`compile(expr, { to: 'interval-js',
 * profile: 'ir' })`), batch 1: the result contract, the declines of the
 * batch, and the time of the compilation of large programs.
 */

import { ComputeEngine, INTERVAL_KIND } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { createIntervalRuntime } from '../../src/interval';
import { CompileDeclineError } from '../../src/compute-engine/compilation/diagnostics';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('p', 'boolean');
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
    const e = declineOf(() => mode(['If', ['Greater', 'x', 0], 'x', 0]));
    expect(e.diagnostic.code).toBe('outside-profile');
    expect(e.message).toMatch(
      /a conditional: the interval mode does not compile it yet/
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = compile(
        ce.box(['If', ['Greater', 'x', 0], 'x', 0] as never),
        IR as never
      ) as unknown as Result;
      expect(r.success).toBe(true);
      expect(r.profile).toBeUndefined();
      expect(r.run({ x: { lo: 1, hi: 2 } })).toEqual({
        kind: 'interval',
        value: { lo: 1, hi: 2 },
      });
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
      mode(['Add', 'x', ['Sin', 1]], { constantFold: false }).code
    ).toMatch(/_IA\.sin\(\{ lo: 1, hi: 1 \}\)/);
  });
});

describe('the interval mode: the declines of batch 1', () => {
  test.each([
    [
      ['If', ['Greater', 'x', 0], 'x', 0],
      /a conditional: the interval mode does not compile it yet/,
    ],
    [
      ['Sum', ['Power', 'x', 'k'], ['Limits', 'k', 1, 3]],
      /a loop: the interval mode does not compile it yet/,
    ],
    [['Add', ['At', 'L', 1], 'x'], /a list|At/],
    [['List', 'x', 'y'], /a list of rank 1/],
    [['Add', 'Z', 'x'], /the lane complex/],
    [['Add', ['Random'], 'x'], /Random/],
    [['fact', 3], /a recursive function \(.*fact.*\)/],
    [['Zeta', 'x'], /Zeta \(the operation zeta\)/],
  ])('%j', (json, cause) => {
    const e = declineOf(() => mode(json));
    expect(e.diagnostic.code).toBe('outside-profile');
    expect(e.message).toMatch(cause);
    expect(e.message).toMatch(/ on interval-js$/);
  });

  test('a vars text that is not a read of the inputs object', () => {
    expect(
      declineOf(() => mode(['Add', 'x', 'c'], { vars: { c: 'f()' } })).message
    ).toMatch(/the vars entry of c, which is not a read of the inputs object/);
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
