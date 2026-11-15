/**
 * The interval mode of the IR pipeline (`compile(expr, { to: 'interval-js',
 * profile: 'ir' })`), batches 1 and 2: the result contract, the declines,
 * the verdicts, the loops at run time, the representation of integers (the
 * pass `plain`), and the time of the compilation of large programs.
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
    const integral = ['Integrate', ['Sin', 't'], ['Limits', 't', 0, 'x']];
    const e = declineOf(() => mode(integral));
    expect(e.diagnostic.code).toBe('outside-profile');
    expect(e.message).toMatch(/the region integrate/);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = compile(ce.box(integral as never), IR as never) as unknown as Result;
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
      mode(['Add', 'x', ['Sin', 1]], { constantFold: false }).code
    ).toMatch(/_IA\.sin\(\{ lo: 1, hi: 1 \}\)/);
  });
});

describe('the interval mode: the declines', () => {
  test.each([
    // Lists compile since batch 3 (`ir-interval-lists.test.ts`); a Range of
    // a real operand declines.
    [['Range', 0.5, 'x'], /a Range of a real operand/],
    [['Add', 'Z', 'x'], /the lane complex/],
    [['fact', 3], /a recursive function \(.*fact.*\)/],
    [['Zeta', 'x'], /Zeta \(the operation zeta\)/],
    [['Integrate', ['Sin', 't'], ['Limits', 't', 0, 'x']], /the region integrate/],
    [
      ['Block', ['Declare', 's', 'real', 0], ['Loop', ['Assign', 's', ['Add', 's', 'e']], ['Element', 'e', ['Range', 1, 3]]], ['Multiply', 's', 'x']],
      /a Loop/,
    ],
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
    expect(mode(['Sum', ['Power', 'x', 'k'], ['Limits', 'k', 1, 3]]).code).toMatch(
      /_IA\.pow\(_\.x, v\d+\)/
    );
  });
  test('an integer that depends on an input stays on kernels', () => {
    expect(mode(['Add', ['Floor', 'x'], 1]).code).toBe(
      '_IA.add(_IA.floor(_.x), { lo: 1, hi: 1 })'
    );
  });
  test('a product of indexes whose bound reaches 2^53 is not plain', () => {
    const r = mode([
      'Sum',
      ['Sum', ['Multiply', 'j', 'k', 'x'], ['Limits', 'k', 1, 3]],
      ['Limits', 'j', 1, 3],
    ]);
    // 2^32 · 2^32: each index is made a point, and the kernel multiplies.
    expect(r.code).toMatch(/_IA\.mul\(\{ lo: v\d+, hi: v\d+ \}, \{ lo: v\d+, hi: v\d+ \}\)/);
    expect(r.run({ x: 1 })).toEqual({ kind: 'interval', value: { lo: 36, hi: 36 } });
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
