import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { CancellationError } from '../../src/common/interruptible';
import { _withIrProfileTestExtension } from '../../src/compute-engine/compilation/ir/adapter';
import { _jsProfileStats } from '../../src/compute-engine/js-profile-switch';
import { implicitCompile } from '../../src/compute-engine/implicit-compile';
import type {
  CompilationResult,
  CompileDiagnostic,
} from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  COMPLEX_FUNCTIONS,
  createJavaScriptRuntime,
  createSysRuntime,
  floorMod,
  realPow,
  REAL_FUNCTIONS,
  RUNTIME_VERSION,
  type StoredJavaScript,
} from '../../src/compute-engine/compilation/javascript-runtime';
import { JS } from '../../src/compute-engine/compilation/ir/print-js';
import { compileSlice } from '../../src/compute-engine/compilation/ir';
import { hasOwnLowering } from '../../src/compute-engine/compilation/ir/lower-context';
import { rangeCount } from '../../src/compute-engine/numerics/range-count';
import {
  agrees,
  interpret,
  makeEngine,
  pointsFor,
  PROGRAMS,
} from './ir-slice-oracle';

// The profile `ir` of `compile()` (experimental): the IR compiler of
// `src/compute-engine/compilation/ir`, selected with `profile: 'ir'` on the
// `javascript` target (`ir/adapter.ts`, "Selecting the pipeline" in
// `ir/README.md`). Every test goes through the public `compile()`, except
// the internal error, which adds a spelling that does not parse with a
// test-only hook of the adapter.

const IR = { profile: 'ir' } as const;

const ce = makeEngine();

type Json = unknown;

const box = (json: Json, engine: ComputeEngine = ce): Expression =>
  engine.box(json as never);

/** `compile()` with the profile and `fallback: false`: the result, or the
 *  diagnostic of the decline that it throws. */
function outcome(
  expr: Expression,
  options: Record<string, unknown> = {}
):
  | { result: CompilationResult<'javascript'> }
  | { diagnostic: CompileDiagnostic; message: string } {
  try {
    return {
      result: compile(expr, {
        ...IR,
        ...options,
        fallback: false,
      } as never) as CompilationResult<'javascript'>,
    };
  } catch (e) {
    return {
      diagnostic: (e as { diagnostic: CompileDiagnostic }).diagnostic,
      message: (e as Error).message,
    };
  }
}

/** Run `f` with `console.warn` silenced (the warning of a fallback). */
function quiet<T>(f: () => T): T {
  const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    return f();
  } finally {
    spy.mockRestore();
  }
}

describe('the option selects the IR compiler', () => {
  test('the code differs from the default route for a program both compile', () => {
    const expr = box(['Add', 'x', ['Sin', 'x']]);
    const plain = compile(expr);
    const ir = compile(expr, IR);
    expect(plain.success && ir.success).toBe(true);
    expect(ir.code).not.toBe(plain.code);
    expect(ir.code).toMatch(/^\(\(\) => \{/);
    expect(ir.profile).toBe('ir');
    expect(plain.profile).toBeUndefined();
    expect(ir.run!({ x: 1 })).toBe(plain.run!({ x: 1 }));
  });
  test('the result has the fields of a JavaScript result', () => {
    const r = compile(box(['Add', 'x', ['Multiply', 2, 'y']]), IR);
    expect(r).toMatchObject({
      target: 'javascript',
      success: true,
      calling: 'expression',
      freeSymbols: ['x', 'y'],
      unsupported: [],
      preamble: '',
      mode: 'strict',
      profile: 'ir',
      shippable: true,
      runtimeVersion: RUNTIME_VERSION,
    });
    expect(r.run!({ x: 1, y: 2 })).toBe(5);
  });
  test('the out-parameters are filled: free names and user functions', () => {
    const symbolDeps = new Set<string>();
    const varsObjectRefs = new Set<string>();
    const r = compile(box(['Add', ['h2', 'x'], 'y']), {
      ...IR,
      symbolDeps,
      varsObjectRefs,
    });
    expect(r.success).toBe(true);
    expect([...varsObjectRefs].sort()).toEqual(['x', 'y']);
    expect([...symbolDeps].sort()).toEqual(['f', 'g', 'h2']);
  });
  test('the option is an error with another target', () => {
    expect(() =>
      compile(box(['Add', 'x', 1]), { ...IR, to: 'glsl' } as never)
    ).toThrow(/the profile "ir" is defined for the target "javascript" only/);
  });
});

describe('a decline', () => {
  test('falls back to the interpreter with the diagnostic', () => {
    const r = quiet(() => compile(box(['Sinh', 'x']), IR));
    expect(r.success).toBe(false);
    expect(r.diagnostic).toMatchObject({
      code: 'outside-profile',
      kind: 'capability',
      operator: 'Sinh',
      value: 'Sinh(x)',
    });
    expect(r.run!({ x: 3 })).toBeCloseTo(Math.sinh(3), 12);
  });
  test('with fallback: false is thrown', () => {
    const o = outcome(box(['Sinh', 'x']));
    expect('diagnostic' in o && o.diagnostic.code).toBe('outside-profile');
    expect('message' in o && o.message).toMatch(
      /^Could not compile with the profile 'ir': Sinh\(x\)/
    );
  });

  const OPTIONS: [string, Record<string, unknown>][] = [
    ['functions', { functions: { g: 'Math.sin' } }],
    ['operators', { operators: { Add: ['+', 11] } }],
    ['operators', { operators: () => undefined }],
    ['imports', { imports: [() => 1] }],
    ['preamble', { preamble: 'const k = 1;' }],
    ['quadrature', { quadrature: 'monte-carlo' }],
    ['strictTypes', { strictTypes: true }],
  ];
  test.each(OPTIONS)('of the option %s names it', (name, options) => {
    const o = outcome(box(['Add', ['At', 'L', 1], 'x']), options);
    expect('diagnostic' in o && o.diagnostic.code).toBe('outside-profile');
    expect('message' in o && o.message).toContain(`the option \`${name}\``);
  });
  test('iterationBudget follows the public rule: a Sum over it is NaN, a Loop over it throws', () => {
    const o = outcome(box(['Sum', 'k', ['Limits', 'k', 1, 'n']]), {
      iterationBudget: 10,
    });
    expect('result' in o && o.result.run!({ n: 10 })).toBe(55);
    expect('result' in o && o.result.run!({ n: 11 })).toBeNaN();
    const loop = box([
      'Block',
      ['Declare', 's', { dict: { value: 0 } }],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', 'k']],
        ['Element', 'k', ['Range', 1, 'n']],
      ],
      's',
    ]);
    const l = outcome(loop, { iterationBudget: 10 });
    expect('result' in l && l.result.run!({ n: 10 })).toBe(55);
    expect(() => 'result' in l && l.result.run!({ n: 11 })).toThrow(
      CancellationError
    );
    const r = outcome(box(['Add', 'x', 1]), { iterationBudget: 10 });
    expect('result' in r && r.result.run!({ x: 1 })).toBe(2);
  });
  test('options that the profile maps are admitted', () => {
    for (const options of [
      { cse: false },
      { cse: true },
      { constantFold: true },
      { mode: 'strict' },
      { mode: 'complex' },
      { broadcast: false },
      { broadcast: true },
      { entryChecks: false },
      { quadrature: 'adaptive' },
      // The JavaScript target ignores `storage` (`CompilationOptions.storage`).
      { storage: { x: 'sampler2D' } },
      { constantFold: false },
      { functions: {} },
      { vars: {} },
      { preamble: '  ' },
    ]) {
      const o = outcome(box(['Add', 'x', 1]), options);
      expect([options, 'result' in o]).toEqual([options, true]);
    }
  });
  test('a vars name is the host text, read at each use, never folded', () => {
    const engine = makeEngine();
    engine.assign('a', 5);
    const r = compile(box(['Add', ['Multiply', 'a', 'a'], 'x'], engine), {
      ...IR,
      vars: { a: '_.b' },
      fallback: false,
    });
    // The engine value of `a` is not read; `_.b` is.
    expect(r.run!({ x: 1, b: 3 } as never)).toBe(10);
    expect(r.freeSymbols).toEqual(['x']);
    const n = compile(box(['Add', 'y', 1]), {
      ...IR,
      vars: { y: '-8' },
      fallback: false,
    });
    expect(n.run!({})).toBe(-7);
    // Each read is evaluated, in program order.
    let calls = 0;
    const draw = () => ++calls;
    const twice = compile(box(['Subtract', 'w', 'w']), {
      ...IR,
      vars: { w: '_.draw()' },
      fallback: false,
    });
    expect(twice.run!({ draw } as never)).toBe(-1);
    expect(calls).toBe(2);
  });
  test('a vars text is one parenthesised operand, also with a line comment', () => {
    const run = (json: Json, vars: Record<string, string>) =>
      compile(box(json), { ...IR, vars, fallback: false }).run!({
        y: 7,
      } as never);
    expect(run(['Multiply', 'x', 2], { x: '5 - 3' })).toBe(4);
    expect(run(['Add', 'x', 1], { x: '_.y // c' })).toBe(8);
    // An entry named `__proto__` is an entry, not a prototype.
    const proto = JSON.parse('{"__proto__": "_.y"}') as Record<string, string>;
    expect(run(['Add', '__proto__', 1], proto)).toBe(8);
  });
  test('a vars name in a function, as a call, or of a list type declines', () => {
    for (const [json, vars, cause] of [
      [['Function', ['Add', 'a', 't'], 't'], { a: '2' }, /in a function/],
      [['g', 'x'], { g: '((t) => t)' }, /a call of the vars name g/],
      [['Add', 'q', 1], { q: '$1' }, /not a source text/],
    ] as [Json, Record<string, string>, RegExp][]) {
      const o = outcome(box(json), { vars });
      expect('message' in o && o.message).toMatch(cause);
    }
  });
});

describe('the result', () => {
  test('a warning of a random frame is in the public shape', () => {
    const r = compile(
      box(['WithRandomSeed', 1, ['Add', ['Random'], ['Random']]]),
      IR
    );
    expect(r.success).toBe(true);
    expect(r.warnings).toEqual([
      expect.objectContaining({
        code: 'seeded-draw-order',
        kind: 'correctness',
      }),
    ]);
  });
  test('a root function literal runs with positional arguments', () => {
    const r = compile(
      box(['Function', ['Add', ['Multiply', 'a', 'a'], 'b'], 'a', 'b']),
      IR
    );
    expect(r.calling).toBe('lambda');
    expect(r.freeSymbols).toEqual([]);
    expect((r.run as (a: number, b: number) => number)(3, 1)).toBe(10);
  });
  test('a root function literal with a list parameter of run-time length', () => {
    const r = compile(
      box([
        'Function',
        ['Add', ['Multiply', 'a', ['Sum', 'L']], 'b'],
        'a',
        ['Typed', 'L', "'list<real>'"],
        'b',
      ]),
      IR
    );
    expect(r.calling).toBe('lambda');
    const run = r.run as (a: number, l: unknown, b: number) => number;
    expect(run(2, [1, 2.5], 1)).toBe(8);
    expect(run(2, [], 1)).toBe(1);
    expect(run(2, [4], 0)).toBe(8);
    // The entry check names the list by its argument.
    expect(() => run(2, '12', 1)).toThrow(
      /argument 2 is compiled as a JavaScript array/
    );
    expect(() => run({ re: 1, im: 1 } as never, [1], 1)).toThrow(
      /argument 1 was compiled as a real number/
    );
  });
  test('a root function literal that reads a free name declines', () => {
    // The engine calls the code with the arguments only: `Solve` would read
    // `x > a` as false for every candidate.
    const o = outcome(box(['Function', ['Add', 'a', 'x'], 'a']));
    expect('diagnostic' in o && o.diagnostic).toMatchObject({
      code: 'outside-profile',
      binding: 'x',
    });
  });
  test('with constantFold: false the lowering evaluates no closed sub-expression', () => {
    const folded = compile(box(['Add', 'x', ['Sin', 2]]), IR);
    const kept = compile(box(['Add', 'x', ['Sin', 2]]), {
      ...IR,
      constantFold: false,
    });
    expect(folded.code).not.toMatch(/Math\.sin/);
    expect(kept.code).toMatch(/Math\.sin\(2\)/);
    expect(kept.run!({ x: 1 })).toBeCloseTo(1 + Math.sin(2), 15);
  });
  test('a root function literal of no parameter is a lambda', () => {
    for (const json of [
      ['Function', 42],
      ['Function', ['Sqrt', 2]],
    ]) {
      const r = compile(box(json), IR);
      expect([json, r.calling]).toEqual([json, 'lambda']);
      expect((r.run as () => number)()).toBeCloseTo(
        json[1] === 42 ? 42 : Math.SQRT2,
        15
      );
    }
    const o = outcome(box(['Function', ['Add', 'x', 1]]));
    expect('diagnostic' in o && o.diagnostic).toMatchObject({
      code: 'outside-profile',
      binding: 'x',
    });
  });
  test('the free names of a declined literal are in varsObjectRefs', () => {
    const varsObjectRefs = new Set<string>();
    expect(() =>
      compile(box(['Function', ['Add', 'a', 'x'], 'a']), {
        ...IR,
        varsObjectRefs,
        fallback: false,
      })
    ).toThrow(/free name/);
    expect([...varsObjectRefs]).toEqual(['x']);
  });
  test('the entry check refuses a string for a list input', () => {
    const r = compile(box(['At', 'L', 1]), IR);
    expect(r.run!({ L: [5, 6, 7] } as never)).toBe(5);
    expect(() => r.run!({ L: '12' } as never)).toThrow(
      /"L" is compiled as a JavaScript array/
    );
  });
  test('an operator with no definition is named as unknown', () => {
    const o = outcome(box(['Quotient', 'n', 3]));
    expect('message' in o && o.message).toMatch(/unknown operator/);
  });
  test('the entry check refuses a complex value for a real input', () => {
    const r = compile(box(['Add', 'x', 1]), IR);
    expect(() => r.run!({ x: { re: 1, im: 2 } } as never)).toThrow(
      /"x" was compiled as a real number/
    );
    const off = compile(box(['Add', 'x', 1]), { ...IR, entryChecks: false });
    expect(() => off.run!({ x: { re: 1, im: 2 } } as never)).not.toThrow();
  });
});

describe('values against the interpreter', () => {
  // The first 40 programs of the slice's hand-chosen set that the profile
  // compiles, through the public `compile()`.
  const programs = PROGRAMS.map((json) => box(json)).filter(
    (e) => 'result' in outcome(e)
  );
  test('at least 40 programs compile', () =>
    expect(programs.length).toBeGreaterThanOrEqual(40));
  test.each(programs.slice(0, 40).map((e) => [e.toString(), e]))(
    '%s',
    (_, expr) => {
      const r = compile(expr as Expression, IR);
      for (const point of pointsFor(expr as Expression)) {
        const expected = interpret(ce, expr as Expression, point);
        if (expected === 'engine-error') continue;
        let value: unknown;
        try {
          value = r.run!(point as never);
        } catch {
          value = undefined;
        }
        expect([point, agrees(value, expected)]).toEqual([point, true]);
      }
    }
  );
});

describe('an internal error', () => {
  // A row whose spelling does not parse: the printer's check fails.
  const broken = <T>(f: () => T): T =>
    _withIrProfileTestExtension(
      {
        rows: [
          {
            head: 'Sinh',
            arity: 1,
            signatures: [[['real'], 'real', 'broken']],
            threads: false,
            effect: 'pure',
          },
        ],
        spellings: { broken: '($0 +' },
      },
      f
    );

  test('is a compile-error and falls back', () => {
    const r = broken(() => quiet(() => compile(box(['Sinh', 'x']), IR)));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('compile-error');
    expect(r.diagnostic?.message).toMatch(/internal error/);
    expect(r.run!({ x: 0 })).toBe(0);
  });
  test('with fallback: false is thrown as a compile-error', () => {
    const o = broken(() => outcome(box(['Sinh', 'x'])));
    expect('diagnostic' in o && o.diagnostic.code).toBe('compile-error');
  });
});

describe('a cancellation', () => {
  // A row whose fold is cancelled: `Length(L)` is the constant 3, so the
  // `fold` pass folds `Sinh(3)` with the row.
  test('propagates, with fallback', () => {
    const cancelled = {
      rows: [
        {
          head: 'Sinh',
          arity: 1,
          signatures: [[['real'], 'real', 'sinh']],
          threads: false,
          effect: 'pure',
          fold: () => {
            throw new CancellationError({ cause: 'aborted' });
          },
        },
      ],
      spellings: { sinh: 'Math.sinh($0)' },
    } as const;
    let error: unknown;
    try {
      _withIrProfileTestExtension(cancelled, () =>
        quiet(() => compile(box(['Sinh', ['Length', 'L']]), IR))
      );
    } catch (e) {
      error = e;
    }
    expect((error as Error | undefined)?.name).toBe('CancellationError');
  });
});

describe('stored code', () => {
  /** The fields of `r` that a host stores, through JSON. */
  const stored = (r: CompilationResult<'javascript'>): StoredJavaScript =>
    JSON.parse(
      JSON.stringify({
        code: r.code,
        preamble: r.preamble,
        preambleOnce: r.preambleOnce,
        preamblePerCall: r.preamblePerCall,
        callCode: r.callCode,
        reconstructionDigits: r.reconstructionDigits,
        calling: r.calling,
        entryPlan: r.entryPlan,
        mode: r.mode,
        runtimeVersion: r.runtimeVersion,
        shippable: r.shippable,
        profile: r.profile,
      })
    );
  const rt = createJavaScriptRuntime();
  test('a stored result loads and gives the values of run()', () => {
    const cases: [Json, Record<string, unknown>[]][] = [
      [
        ['Add', ['Sin', 'x'], ['Power', 'x', 0.5]],
        [{ x: 2 }, { x: 0.25 }],
      ],
      // A helper and a user function: `preambleOnce`.
      [['Add', ['At', 'L', 2], ['h2', 'x']], [{ L: [1, 2, 3], x: 0.5 }]],
      [
        ['Sum', ['Mod', 'k', 3], ['Limits', 'k', 1, 'n']],
        [{ n: 10 }, { n: 0 }],
      ],
      [['Map', ['Function', ['Gamma', 'u'], 'u'], 'L'], [{ L: [0.5, 3] }]],
    ];
    for (const [json, points] of cases) {
      const r = compile(box(json), IR);
      expect([json, r.profile]).toEqual([json, 'ir']);
      const f = rt.load(stored(r));
      for (const p of points) expect([json, f(p)]).toEqual([json, r.run!(p)]);
    }
  });
  test('a stored lambda and a stored complex result load', () => {
    const lambda = compile(box(['Function', ['Multiply', 'u', 'u'], 'u']), IR);
    expect(lambda.calling).toBe('lambda');
    expect(rt.load(stored(lambda))(3)).toBe(9);
    const z = compile(box(['Sqrt', 'x']), { ...IR, mode: 'complex' });
    expect(rt.load(stored(z))({ x: -4 })).toEqual({ re: 0, im: 2 });
    expect(rt.load(stored(z))({ x: 4 })).toBe(2);
  });
  test('run() and the loaded code agree: a complex list result, a {re, im} value for a real input', () => {
    /** The value of `f(...args)`, or the class of the error it throws. */
    const outcomeOf = (f: (...a: unknown[]) => unknown, ...args: unknown[]) => {
      try {
        return { value: f(...args) };
      } catch (e) {
        return { error: (e as Error).constructor.name };
      }
    };
    // A list whose cells are complex, some of imaginary part 0.
    const list = compile(box(['Map', ['Function', ['Sqrt', 'u'], 'u'], 'D']), {
      ...IR,
      mode: 'complex',
    });
    expect(list.profile).toBe('ir');
    const point = { D: [4, -9, 0.25] };
    const local = outcomeOf(list.run as never, point);
    expect(local).toEqual({ value: [2, { re: 0, im: 3 }, 0.5] });
    expect(outcomeOf(rt.load(stored(list)), point)).toEqual(local);
    // A `{re, im}` value for a real input.
    const real = compile(box(['Add', 'x', 1]), IR);
    const bad = { x: { re: 1, im: 2 } };
    const thrown = outcomeOf(real.run as never, bad);
    expect(thrown).toEqual({ error: 'TypeError' });
    expect(outcomeOf(rt.load(stored(real)), bad)).toEqual(thrown);
  });
  test('a stored result with an iteration budget counts the passes of a call', () => {
    const r = compile(
      box([
        'Block',
        ['Declare', 's', { dict: { value: 0 } }],
        [
          'Loop',
          ['Assign', 's', ['Add', 's', 'k']],
          ['Element', 'k', ['Range', 1, 'n']],
        ],
        's',
      ]),
      { ...IR, iterationBudget: 5 }
    );
    expect(r.profile).toBe('ir');
    const f = rt.load(stored(r));
    expect(f({ n: 5 })).toBe(15);
    // A second call starts with a count of 0.
    expect(f({ n: 5 })).toBe(15);
    expect(() => f({ n: 6 })).toThrow(CancellationError);
  });
  test('a batch loader reads a list of booleans as a shared list, and a boolean input as a column', () => {
    const engine = new ComputeEngine();
    engine.declare('B3', 'list<boolean^3>');
    engine.declare('x', 'real');
    engine.declare('p', 'boolean');
    const r = compile(box(['If', ['At', 'B3', 1], 'x', 0], engine), IR);
    expect(r.profile).toBe('ir');
    const B3 = [true, false, true];
    const cells = [5, 6, 7].map((x) => r.run!({ B3, x } as never));
    expect(cells).toEqual([5, 6, 7]);
    const batch = rt.loadBroadcast(stored(r))({
      B3: B3 as never,
      x: new Float64Array([5, 6, 7]),
    });
    expect([...batch]).toEqual(cells);
    // An empty column of booleans is an empty batch.
    const q = compile(box(['If', 'p', 'x', 1], engine), IR);
    expect(q.profile).toBe('ir');
    const empty = rt.loadBroadcast(stored(q))({
      p: [] as never,
      x: new Float64Array([]),
    });
    expect([...empty]).toEqual([]);
  });
  test('the deadline count of a loop is on the frame: a step budget is not charged by earlier calls', () => {
    const engine = makeEngine();
    const r = compile(
      box(
        [
          'Block',
          ['Declare', 's', { dict: { value: 0 } }],
          [
            'Loop',
            ['Assign', 's', ['Add', 's', 'k']],
            ['Element', 'k', ['Range', 1, 'n']],
          ],
          's',
        ],
        engine
      ),
      IR
    );
    expect(r.profile).toBe('ir');
    for (let call = 0; call < 6; call++)
      expect(
        engine.withStepBudget({ steps: 0 }, () => r.run!({ n: 600 }))
      ).toBe(180300);
  });
  test('a negative base reads its exponent to the same digits in run() and in loaded code', () => {
    const engine = new ComputeEngine();
    engine.precision = 'machine';
    engine.declare('Z', 'complex');
    engine.declare('W', 'real');
    const r = compile(box(['Power', 'Z', 'W'], engine), IR);
    expect(r.profile).toBe('ir');
    expect(r.reconstructionDigits).toBeDefined();
    const point = { Z: -8, W: 0.333333333333333 };
    expect(rt.load(stored(r))(point)).toEqual(r.run!(point as never));
  });
  test('a stored lambda with helpers loads from code alone', () => {
    const r = compile(
      box(['Function', ['Add', ['h2', 'u'], ['Round', 'u']], 'u']),
      IR
    );
    expect([r.profile, r.calling]).toEqual(['ir', 'lambda']);
    expect(r.callCode).toBeDefined();
    const subset = JSON.parse(
      JSON.stringify({
        code: r.code,
        preamble: r.preamble,
        calling: r.calling,
        runtimeVersion: r.runtimeVersion,
      })
    );
    const run = r.run as unknown as (u: number) => unknown;
    expect(rt.load(subset)(1.5)).toBe(run(1.5));
    expect(rt.load(stored(r))(1.5)).toBe(run(1.5));
  });
  test('a draw and an integral are not shippable', () => {
    for (const json of [
      ['Add', 'x', ['Random']],
      ['NIntegrate', ['Function', ['Sin', 't'], 't'], 0, 'x'],
    ]) {
      const r = compile(box(json), IR);
      expect([json, r.profile, r.shippable]).toEqual([json, 'ir', false]);
    }
    expect(compile(box(['Sin', 'x']), IR).shippable).toBe(true);
  });
  test('every member of the runtime that the code calls is a member of _SYS', () => {
    const sys = createSysRuntime() as unknown as Record<string, unknown>;
    const names = new Set<string>();
    const spellings = [
      ...Object.values(JS.ops).map((s) => (typeof s === 'string' ? s : s.text)),
      ...Object.values(JS.helpers),
      ...Object.values(JS.regions).flatMap((region) => {
        const s = region({
          outs: ['o', 'p'],
          types: [],
          args: ['a', 'b'],
          params: ['k'],
        });
        return [...s.open, ...s.close(['y', 'z'])];
      }),
      ...JS.loopOpen('k', '1', '2', true),
    ];
    for (const text of spellings)
      for (const [, path] of text.matchAll(/_SYS\.([\w.]+)\(/g))
        names.add(path);
    expect(names.size).toBeGreaterThan(40);
    for (const path of names) {
      const [head, member] = path.split('.');
      const value =
        member === undefined
          ? sys[head]
          : (sys[head] as Record<string, unknown>)[member];
      expect([path, typeof value]).toEqual([path, 'function']);
    }
    // `_SYS.ir` holds the functions that the folds compute.
    const ir = sys.ir as Record<string, unknown>;
    for (const [k, f] of Object.entries({
      ...REAL_FUNCTIONS,
      ...COMPLEX_FUNCTIONS,
    }))
      expect([k, ir[k] === f]).toEqual([k, true]);
    expect([ir.pow, ir.mod, sys.rangeCount]).toEqual([
      realPow,
      floorMod,
      rangeCount,
    ]);
  });
});

describe('the switch of the engine', () => {
  test('the engine tries the profile ir for its own compilations', () => {
    const engine = new ComputeEngine();
    engine._jsProfile = { profile: 'ir' };
    const lambda = engine.box(['Function', ['Multiply', 'u', 2], 'u']);
    const admitted = implicitCompile(engine, lambda, 'nd');
    expect(admitted?.profile).toBe('ir');
    expect((admitted?.run as (u: number) => number)(3)).toBe(6);
    // A decline: the existing compiler compiles it.
    const declined = implicitCompile(
      engine,
      engine.box(['Function', ['Sinh', 'u'], 'u']),
      'nd'
    );
    expect(declined?.success).toBe(true);
    expect(declined?.profile).toBeUndefined();
    expect(_jsProfileStats(engine).nd).toMatchObject({
      attempts: 2,
      admitted: 1,
      declined: 1,
      failed: 0,
    });
  });
});

describe('the default route', () => {
  // The code of the default route is pinned by "the default route does
  // not change" of compile-javascript-profile.test.ts.
  test('a compilation with no option reports no profile', () => {
    for (const json of PROGRAMS.slice(0, 20)) {
      const r = quiet(() => compile(box(json)));
      expect(r.profile).toBeUndefined();
    }
  });
});

//
// Coverage from Tycho's corpus audit: inputs of an extended-real type, a
// constant local, a user function that reads an input, Degrees and Cot
//

/** Compile `json` with the profile and `options`, and compare its value
 *  with the interpreter's (within 1e-12) at each point, where the
 *  interpreter gives a number. */
function againstInterpreter(
  engine: ComputeEngine,
  json: Json,
  points: Record<string, number | number[]>[],
  options: Record<string, unknown> = {}
): CompilationResult<'javascript'> {
  const expr = box(json, engine);
  const r = compile(expr, {
    ...IR,
    ...options,
    fallback: false,
  } as never) as CompilationResult<'javascript'>;
  expect(r.profile).toBe('ir');
  for (const point of points) {
    const expected = interpret(engine, expr, point);
    expect(typeof expected === 'number' || Array.isArray(expected)).toBe(true);
    const v = (r.run as (x: unknown) => unknown)(point);
    expect([point, agrees(v, expected)]).toEqual([point, true]);
  }
  return r;
}

describe('an input of an extended-real type is on the real lane', () => {
  test('a list and a scalar of nan | real | signed_infinity (the witnesses)', () => {
    const engine = new ComputeEngine();
    engine.declare('S', 'list<nan | real | signed_infinity>');
    engine.declare('J', 'integer');
    engine.declare('L', 'real');
    engine.declare('sigma', 'nan | real | signed_infinity');
    const points = [
      { S: [0.5, 2, -1.25], J: 2, L: 3 },
      { S: [1.5, -0.75, 4], J: 3, L: 0.7 },
    ];
    againstInterpreter(
      engine,
      ['Cos', ['Divide', ['Multiply', 2, 'Pi', ['At', 'S', 'J']], 'L']],
      points
    );
    againstInterpreter(
      engine,
      [
        'List',
        ['Multiply', 'sigma', ['Subtract', ['At', 'S', 2], ['At', 'S', 1]]],
        ['Multiply', 'sigma', ['Subtract', ['At', 'S', 3], ['At', 'S', 2]]],
      ],
      points.map((p, i) => ({ ...p, sigma: [10, -2.5][i] }))
    );
  });
  test('the option inputs, real | signed_infinity | ~oo, and an integer union with nan', () => {
    const engine = new ComputeEngine();
    const r = compile(box(['Add', ['Multiply', 'w', 'k'], 'q'], engine), {
      ...IR,
      fallback: false,
      inputs: {
        w: 'real | signed_infinity | ~oo',
        k: 'integer | nan',
        q: 'nan | real<0..1>',
      },
    } as never) as CompilationResult<'javascript'>;
    expect([...r.freeSymbols!].sort()).toEqual(['k', 'q', 'w']);
    expect((r.run as (x: unknown) => number)({ w: 1.5, k: 3, q: 0.25 })).toBe(
      4.75
    );
    engine.declare('k2', 'integer | nan');
    // On the real lane, not the integer lane: a real Mod, and k2 / 2 is real.
    againstInterpreter(
      engine,
      ['Add', ['Mod', 'k2', 3], ['Divide', 'k2', 2]],
      [{ k2: 7 }, { k2: -4 }]
    );
  });
  test('the GLSL target reads the type by the same rule', () => {
    const engine = new ComputeEngine();
    engine.declare('sigma', 'nan | real | signed_infinity');
    engine.declare('S', 'list<(real | signed_infinity)^3>');
    const code = compileSlice(
      box(['Multiply', 'sigma', ['At', 'S', 2]], engine),
      { target: 'glsl' }
    ).code;
    expect(code).toMatch(/float in0_sigma/);
    expect(code).toMatch(/float in1_S\[3\]/);
  });
});

describe('a Declare with the attribute constant', () => {
  test('a constant local read twice; constant: False is a local', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    const constant = (c: boolean, value: number) => ({
      dict: { value, constant: c },
    });
    againstInterpreter(
      engine,
      [
        'Block',
        ['Declare', 'K', constant(true, 240)],
        ['Add', ['Multiply', 'K', 'x'], ['Divide', 'K', 7]],
      ],
      [{ x: 0.5 }, { x: -3.25 }]
    );
    againstInterpreter(
      engine,
      [
        'Block',
        ['Declare', 't', constant(false, 1)],
        ['Assign', 't', ['Add', 't', 'x']],
        't',
      ],
      [{ x: 2.5 }, { x: -1 }]
    );
  });
  test('an Assign to a constant local declines (the interpreter refuses it)', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    const o = outcome(
      box(
        [
          'Block',
          ['Declare', 'K', { dict: { value: 240, constant: true } }],
          ['Assign', 'K', 'x'],
          'K',
        ],
        engine
      )
    );
    expect('message' in o && o.message).toMatch(/a write to a constant/);
  });
});

describe('a user function that reads an input of the compilation', () => {
  /** An engine with `x`, `y`, `n` and `m_s` declared real (`m_s` holds
   *  3), and the functions of the witnesses. */
  const engine = (): ComputeEngine => {
    const e = new ComputeEngine();
    for (const name of ['x', 'y', 'n', 'm_s', 'N', 'h', 'r', 't', 'u', 'v'])
      e.declare(name, 'real');
    e.assign('m_s', 3);
    e.assign(
      'TychoCertificate55',
      box(['Function', ['Multiply', 'n', 2.5]], e)
    );
    e.assign(
      'F_s',
      box(['Function', ['Add', ['Multiply', 'a', 'm_s'], 'b'], 'a', 'b'], e)
    );
    return e;
  };
  const symbolic = ['x', 'y', 'N', 'n', 'h', 'r', 't', 'u', 'v'];

  test('the witnesses: TychoCertificate55() reads n, F_s reads m_s', () => {
    const e = engine();
    const r = againstInterpreter(
      e,
      ['TychoCertificate55'],
      [{ n: 2 }, { n: -0.3 }],
      {
        symbolic,
      }
    );
    expect(r.freeSymbols).toEqual(['n']);
    const s = againstInterpreter(
      e,
      ['Floor', ['Divide', ['F_s', 'x', 'y'], 6.3]],
      [
        { x: 2, y: 5, m_s: 7 },
        { x: -1.5, y: 40, m_s: 2.25 },
      ],
      { symbolic: [...symbolic, 'm_s'] }
    );
    expect(s.freeSymbols).toEqual(['x', 'y', 'm_s']);
  });
  test('through two levels of calls, and one definition called twice', () => {
    const e = engine();
    e.assign('G', box(['Function', ['Multiply', 2, ['F_s', 'c', 1]], 'c'], e));
    const r = againstInterpreter(
      e,
      ['Add', ['G', 'x'], ['F_s', 'y', 'x'], ['F_s', 1, 2]],
      [
        { x: 2, y: 0.5, m_s: 4 },
        { x: -3, y: 7, m_s: 0.5 },
      ],
      { symbolic: ['m_s'] }
    );
    expect(r.freeSymbols).toEqual(['x', 'm_s', 'y']);
    // One function per definition, and each call passes m_s.
    expect(r.preambleOnce.match(/const u\d+_Fs =/g)).toHaveLength(1);
    expect(r.code.match(/_Fs\([^)]*_\.m_s\)/g)).toHaveLength(2);
  });
  test('a recursive function that reads an input declines; with no input it compiles', () => {
    const e = engine();
    e.declare('k', 'integer');
    const recursive = (name: string, base: Json, step: Json) => {
      e.declare(name, '(integer) -> real');
      e.assign(
        name,
        box(
          [
            'Function',
            [
              'If',
              ['LessEqual', 'j', 0],
              base,
              ['Add', step, ['Multiply', 0.5, [name, ['Subtract', 'j', 1]]]],
            ],
            'j',
          ],
          e
        )
      );
    };
    recursive('R', 'n', 'n');
    const o = outcome(box(['R', 'k'], e));
    expect('message' in o && o.message).toMatch(
      /a recursive call of R, which reads the input n/
    );
    recursive('R0', 1.5, 2);
    againstInterpreter(e, ['R0', 'k'], [{ k: 4 }, { k: 0 }]);
  });
  test('a cycle whose input is read after the recursive call declines', () => {
    const e = engine();
    e.declare('k', 'integer');
    e.declare('P', '(integer) -> real');
    e.declare('Q', '(integer) -> real');
    // The arm of P that calls Q, which calls P, is lowered before P reads n.
    const step = (other: string, base: Json) =>
      box(
        [
          'Function',
          ['If', ['Greater', 'j', 0], [other, ['Subtract', 'j', 1]], base],
          'j',
        ],
        e
      );
    e.assign('P', step('Q', 'n'));
    e.assign('Q', step('P', 1));
    const o = outcome(box(['P', 'k'], e));
    expect('message' in o && o.message).toMatch(
      /a recursive call of P, which reads the input n/
    );
  });
  test('a name that holds a value in a body declines, as a local of the name at the call', () => {
    const e = engine();
    const value = outcome(box(['F_s', 'x', 'y'], e));
    expect('message' in value && value.message).toMatch(
      /F_s reads m_s, which is not a parameter \(a capture\)/
    );
    const local = outcome(
      box(['Block', ['Declare', 'n', 'real', 5], ['TychoCertificate55']], e),
      { symbolic: ['n'] }
    );
    expect('message' in local && local.message).toMatch(
      /reads the input n, where n is a local or a parameter/
    );
  });
});

describe('Degrees and Cot', () => {
  test('Degrees on both targets (the witness Sin(Degrees(h_0)))', () => {
    const engine = new ComputeEngine();
    engine.declare('h_0', 'real');
    const json = ['Sin', ['Degrees', 'h_0']];
    againstInterpreter(engine, json, [
      { h_0: 30 },
      { h_0: -127.5 },
      { h_0: 1e3 },
    ]);
    expect(compileSlice(box(json, engine), { target: 'glsl' }).code).toMatch(
      /sin\(radians\(/
    );
    // Under grad or turn the row declines (Degrees(h) is in that unit).
    for (const unit of ['grad', 'turn'] as const) {
      const other = new ComputeEngine();
      other.angularUnit = unit;
      other.declare('h', 'real');
      const o = outcome(box(['Degrees', 'h'], other));
      expect([unit, 'message' in o && o.message]).toEqual([
        unit,
        expect.stringMatching(
          /Degrees with a angularUnit other than the default/
        ),
      ]);
    }
  });
  test('Cot on the real lane and the complex lane', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.declare('z', 'complex');
    againstInterpreter(engine, ['Cot', 'x'], [{ x: 0.7 }, { x: -2.3 }]);
    const r = compile(box(['Tan', ['Cot', 'z']], engine), {
      ...IR,
      fallback: false,
      mode: 'complex',
    } as never) as CompilationResult<'javascript'>;
    const z = { re: 0.4, im: -0.9 };
    const expected = interpret(engine, box(['Tan', ['Cot', 'z']], engine), {
      z: z as never,
    });
    expect(expected).toMatchObject({
      re: expect.any(Number),
      im: expect.any(Number),
    });
    expect(agrees((r.run as (x: unknown) => unknown)({ z }), expected)).toBe(
      true
    );
  });
});

describe('a lifted input: its type, the other modes and targets', () => {
  /** `f(t) := a t` with `a` not declared. */
  const engine = (): ComputeEngine => {
    const e = new ComputeEngine();
    e.assign('f', box(['Function', ['Multiply', 'a', 't'], 't'], e));
    return e;
  };
  test('the type of the input is the one the scope of the compilation gives: each order agrees or declines', () => {
    const cases: [Json, Record<string, string>, Record<string, unknown>][] = [
      [
        ['List', ['f', 2], ['Multiply', 'a', 'a']],
        { a: 'complex' },
        { a: { re: 1, im: 2 } },
      ],
      [
        ['List', ['Multiply', 'a', 'a'], ['f', 2]],
        { a: 'complex' },
        { a: { re: 1, im: 2 } },
      ],
      [['f', 2], { a: 'complex' }, { a: { re: 1, im: 2 } }],
      [
        ['List', ['f', 2], ['Add', 'a', 1]],
        { a: 'list<real^3>' },
        { a: [1, 2, 3] },
      ],
      [
        ['List', ['Add', 'a', 1], ['f', 2]],
        { a: 'list<real^3>' },
        { a: [1, 2, 3] },
      ],
    ];
    for (const [json, inputs, point] of cases) {
      const o = outcome(box(json, engine()), { inputs });
      if ('message' in o) {
        expect([json, o.diagnostic.code]).toEqual([json, 'outside-profile']);
        continue;
      }
      const e = engine();
      for (const [k, t] of Object.entries(inputs)) e.declare(k, t);
      const expected = interpret(e, box(json, e), point as never);
      expect([json, agrees(o.result.run!(point), expected)]).toEqual([
        json,
        true,
      ]);
    }
    // An integer input for a real parameter compiles.
    const r = outcome(box(['f', 2], engine()), { inputs: { a: 'integer' } });
    expect('result' in r && r.result.run!({ a: 3 })).toBe(6);
  });
  test('an occurrence of another type than the input declines', () => {
    // A is boxed where a is not declared, B where a is complex.
    const e = new ComputeEngine();
    e.assign('A', box(['Function', ['Multiply', 'a', 't'], 't'], e));
    e.pushScope();
    e.declare('a', 'complex');
    e.assign(
      'B',
      box(['Function', ['Divide', ['A', 't'], ['Multiply', 'a', 'a']], 't'], e)
    );
    // compile() refuses the two definitions of a; compileSlice() reads
    // the bodies as they are.
    const o = outcome(box(['B', 2], e));
    expect('message' in o && o.message).toMatch(/different definitions/);
    expect(() =>
      compileSlice(box(['B', 2], e), { target: 'javascript' })
    ).toThrow(/a read with two types/);
    e.popScope();
  });
  test('in mode bigint a lifted input is exact at 10^20', () => {
    const e = new ComputeEngine();
    e.declare('n', 'integer');
    e.declare('k', 'integer');
    e.declare('g', '(integer) -> integer');
    e.assign(
      'g',
      box(['Function', ['Add', ['Multiply', 'n', 'j'], 1], 'j'], e)
    );
    const r = compile(box(['g', 'k'], e), {
      ...IR,
      mode: 'bigint',
      fallback: false,
    } as never) as CompilationResult<'javascript'>;
    expect(r.freeSymbols).toEqual(['k', 'n']);
    expect(r.run!({ k: 3n, n: 10n ** 20n })).toBe(3n * 10n ** 20n + 1n);
  });
  test('stored code with a lifted call loads after a JSON round trip; the entry check refuses a complex value', () => {
    const e = new ComputeEngine();
    e.declare('n', 'real');
    e.declare('x', 'real');
    e.assign(
      'g',
      box(['Function', ['Add', ['Multiply', 'n', 'j'], 1], 'j'], e)
    );
    const r = compile(box(['Add', ['g', 'x'], ['g', 2]], e), {
      ...IR,
      fallback: false,
    }) as CompilationResult<'javascript'>;
    const copy = JSON.parse(
      JSON.stringify({
        code: r.code,
        preamble: r.preamble,
        preambleOnce: r.preambleOnce,
        callCode: r.callCode,
        reconstructionDigits: r.reconstructionDigits,
        calling: r.calling,
        entryPlan: r.entryPlan,
        mode: r.mode,
        runtimeVersion: r.runtimeVersion,
        shippable: r.shippable,
        profile: r.profile,
      })
    ) as StoredJavaScript;
    const f = createJavaScriptRuntime().load(copy);
    expect(f({ x: 1.5, n: 4 })).toBe(r.run!({ x: 1.5, n: 4 }));
    expect(r.run!({ x: 1.5, n: 4 })).toBe(16);
    expect(() => r.run!({ x: 1.5, n: { re: 1, im: 2 } })).toThrow(TypeError);
  });
  test('the GLSL text of a function with a lifted parameter', () => {
    const e = new ComputeEngine();
    e.declare('n', 'real');
    e.declare('x', 'real');
    e.assign(
      'g',
      box(['Function', ['Add', ['Multiply', 'n', 'j'], 1], 'j'], e)
    );
    const code = compileSlice(box(['g', 'x'], e), { target: 'glsl' }).code;
    expect(code).toMatch(/float u0_g\(float \w+, float \w+\)/);
    expect(code).toMatch(/u0_g\(in0_x, in1_n\)/);
  });
});

describe('a Sum with iterationBudget whose arm narrows the type (Tycho corpus run 2)', () => {
  const S3 = ['Sum', 'k', ['Limits', 'k', 1, 3]];
  const Sn = ['Sum', 'k', ['Limits', 'k', 1, 'n']];
  // The witness: a lambda whose body rebinds its parameter `k` as the index
  // of the `Sum`; the fold of the budget test gave the build an integer
  // body where its result was a real list (an internal error).
  const WITNESS = [
    'Min',
    ['Map', ['Function', ['Block', S3], 'k'], ['List', 10, 20]],
  ];
  test.each(['parse', 'canonical', 'raw', 'structural'])(
    'the witness in the box form %s, with and without the budget',
    (form) => {
      for (const iterationBudget of [1000000, undefined]) {
        const e = new ComputeEngine();
        e.declare('x', 'real');
        const expr =
          form === 'parse'
            ? e.parse(
                String.raw`\min\left(\mathrm{Map}\left(k\mapsto \sum_{k=1}^{3}k, \left[10,20\right]\right)\right)`
              )
            : e.box(
                WITNESS as never,
                form === 'canonical' ? {} : { form: form as never }
              );
        const o = outcome(expr, {
          mode: 'strict',
          inputs: { x: 'real' },
          iterationBudget,
        });
        expect('result' in o && o.result.run!({ x: 0 })).toBe(6);
      }
    }
  );
  test('next to it: a Map body, a Filter predicate, an If arm, a List element', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('n', 'integer');
    for (const json of [
      ['Min', ['Map', ['Function', ['Add', 'j', Sn], 'j'], ['List', 10, 20]]],
      ['At', ['Map', ['Function', ['Add', 'j', S3], 'j'], ['List', 10, 20]], 2],
      [
        'Length',
        [
          'Filter',
          ['List', 1, 2, 3, 4],
          ['Function', ['Greater', ['Add', 'j', S3], 8], 'j'],
        ],
      ],
      ['If', ['Greater', 'x', 0], S3, 2],
      ['Add', 'x', ['If', 'True', S3, 2]],
      ['Min', ['List', S3, 2]],
      ['At', ['List', S3, 2, 'n'], 1],
      [
        'Max',
        ['Map', ['Function', ['Multiply', 'j', 2], 'j'], ['List', S3, 2]],
      ],
    ])
      for (const iterationBudget of [1000000, undefined]) {
        const r = againstInterpreter(e, json, [{ x: 0.5, n: 4 }], {
          iterationBudget,
        });
        expect(r.success).toBe(true);
      }
  });
  test('a fold keeps the lane: an integer list cell and a pow of exponent 1 in a real result', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('K', 'list<integer^3>');
    for (const json of [
      ['Map', ['Function', ['At', ['List', 'j', 'x'], 1], 'j'], 'K'],
      [
        'Map',
        [
          'Function',
          ['Power', 'j', ['Multiply', 2, ['If', 'True', 0.5, 'x']]],
          'j',
        ],
        'K',
      ],
    ]) {
      const r = compile(box(json, e), { ...IR, fallback: false });
      expect(r.run!({ x: 0.25, K: [1, 2, 3] })).toEqual([1, 2, 3]);
    }
  });
  test('next to it: an integer local and a function declared -> integer decline', () => {
    const e = new ComputeEngine();
    e.declare('n', 'integer');
    e.declare('f', '(integer) -> integer');
    e.assign(
      'f',
      box(['Function', ['Sum', 'k', ['Limits', 'k', 1, 'm']], 'm'], e)
    );
    for (const json of [
      ['Block', ['Declare', 't', 'integer', Sn], ['Add', 't', 1]],
      ['Add', ['f', 3], 1],
    ]) {
      const o = outcome(box(json, e), { iterationBudget: 1000000 });
      expect('diagnostic' in o && o.diagnostic.code).toBe('outside-profile');
      expect(outcome(box(json, e)).hasOwnProperty('result')).toBe(true);
    }
  });
});

describe('a library operator whose definition the host changed in place', () => {
  // `0 < At(S, x + N·Floor(y) + 1)`: Tycho's `At` reads a list at the floor
  // of a real index; the profile's row would give the stock value.
  const PROGRAM = [
    'Less',
    0,
    ['At', 'S', ['Add', 'x', ['Multiply', 'N', ['Floor', 'y']], 1]],
  ];
  const engine = () => {
    const e = new ComputeEngine();
    e.declare('S', 'list<real>');
    e.declare('x', 'real');
    e.declare('y', 'real');
    e.declare('N', 'integer');
    return e;
  };
  test('a compile handler or compileHelpers set on the definition of At declines', () => {
    const plain = outcome(box(PROGRAM, engine()));
    expect('result' in plain).toBe(true);
    for (const change of [
      (d: Record<string, unknown>) => (d.compile = () => '0'),
      (d: Record<string, unknown>) => (d.compileHelpers = { h: () => 1 }),
    ]) {
      const e = engine();
      change(e.lookupDefinition('At')!.operator as never);
      const o = outcome(box(PROGRAM, e));
      expect('message' in o && o.message).toMatch(
        /the definition of At has its own lowering/
      );
    }
  });
  test('a Range read as a list source with a host compile handler declines', () => {
    const programs = [
      ['Sum', ['Range', 1, 'n']],
      ['Length', ['Range', 1, 'n']],
      [
        'Max',
        ['Map', ['Function', ['Multiply', 'j', 'x'], 'j'], ['Range', 1, 'n']],
      ],
    ];
    const ranged = () => {
      const e = engine();
      e.declare('n', 'integer');
      return e;
    };
    for (const json of programs) {
      expect('result' in outcome(box(json, ranged()))).toBe(true);
      const e = ranged();
      (e.lookupDefinition('Range')!.operator as { compile?: unknown }).compile =
        () => '(-777)';
      const o = outcome(box(json, e));
      expect('message' in o && o.message).toMatch(
        /the definition of Range has its own lowering/
      );
    }
  });
  test('PointList in the pipeline: its standard handler compiles, a host handler declines', () => {
    const json = [
      'PointList',
      'D',
      ['Map', ['Function', ['Sin', 'z'], 'z'], 'D'],
    ];
    const points = () => {
      const e = new ComputeEngine();
      e.declare('D', 'list<real>');
      return e;
    };
    const o = outcome(box(json, points()));
    expect('result' in o && o.result.run!({ D: [1, 2] } as never)).toEqual([
      [1, Math.sin(1)],
      [2, Math.sin(2)],
    ]);
    const e = points();
    (
      e.lookupDefinition('PointList')!.operator as { compile?: unknown }
    ).compile = () => '0';
    const h = outcome(box(json, e));
    expect('message' in h && h.message).toMatch(
      /the definition of PointList has its own lowering/
    );
  });
  test('a host Range declines under Comprehension and PointList too', () => {
    for (const json of [
      [
        'Length',
        [
          'Comprehension',
          ['Multiply', 2, 'k'],
          ['Element', 'k', ['Range', 1, 'n']],
        ],
      ],
      ['PointList', ['Range', 1, 3], ['Range', 1, 3]],
    ]) {
      const make = () => {
        const e = new ComputeEngine();
        e.declare('n', 'integer');
        return e;
      };
      expect('result' in outcome(box(json, make()))).toBe(true);
      const e = make();
      (e.lookupDefinition('Range')!.operator as { compile?: unknown }).compile =
        () => '(-777)';
      const o = outcome(box(json, e));
      expect('message' in o && o.message).toMatch(
        /the definition of Range has its own lowering/
      );
    }
  });
  test("the standard compile handler of PointList (and Field, ListFrom) is not the host's", () => {
    const e = new ComputeEngine();
    for (const name of ['PointList', 'Field', 'ListFrom']) {
      const def = e.lookupDefinition(name)!.operator as { compile?: unknown };
      expect(typeof def.compile).toBe('function');
      expect(hasOwnLowering(name, def)).toBe(false);
    }
    expect(hasOwnLowering('PointList', { compile: () => '0' })).toBe(true);
    expect(hasOwnLowering('At', e.lookupDefinition('At')!.operator)).toBe(
      false
    );
  });
});

describe('mode strict: a radical or a logarithm of an operand proved negative', () => {
  const NEG = ['Subtract', ['Negate', ['Square', 'x']], 1];
  const check = (type: string, json: Json, xs: number[], complex: boolean) => {
    const e = new ComputeEngine();
    e.declare('x', type);
    const expr = box(json, e);
    const r = compile(expr, {
      ...IR,
      fallback: false,
    }) as CompilationResult<'javascript'>;
    for (const x of xs) {
      const v = r.run!({ x });
      expect([json, x, agrees(v, interpret(e, expr, { x }))]).toEqual([
        json,
        x,
        true,
      ]);
      expect(typeof v === 'object').toBe(complex);
    }
  };
  test('Sqrt, Ln, Log, Power and Root of -x^2 - 1 are complex', () => {
    for (const json of [
      ['Sqrt', NEG],
      ['Ln', NEG],
      ['Log', NEG],
      ['Power', NEG, ['Rational', 1, 2]],
      ['Power', NEG, 0.3],
      ['Root', NEG, 2],
      ['Multiply', 2, ['Sqrt', NEG]],
    ])
      check('real', json, [0, 1.5], true);
  });
  test('a real root of odd index stays real; Sqrt(x) by the declared type', () => {
    check('real', ['Root', NEG, 3], [0, 1.5], false);
    check('real', ['Power', NEG, ['Rational', 1, 3]], [0, 1.5], false);
    check('real<..-1>', ['Sqrt', 'x'], [-4, -1], true);
    // `x: real` is the real lane: NaN at -4.
    const r = compile(box(['Sqrt', 'x']), { ...IR, fallback: false });
    expect(r.run!({ x: -4 })).toBeNaN();
    expect(r.run!({ x: 4 })).toBe(2);
  });
});

describe('a vars name that reads the inputs object, in a function body', () => {
  const engine = () => {
    const e = new ComputeEngine();
    for (const name of ['P', 'Q', 'x']) e.declare(name, 'real');
    e.assign(
      'TychoCertificate18',
      box(['Function', ['Add', ['Multiply', 2, 'P'], 'Q']], e)
    );
    return e;
  };
  const WITNESS = [
    'Add',
    ['TychoCertificate18'],
    ['Multiply', 'x', ['TychoCertificate18']],
  ];
  test('the witness: a function of no parameter reads two vars names, called twice', () => {
    const e = engine();
    const r = againstInterpreter(
      e,
      WITNESS,
      [
        { P: 1.5, Q: -0.25, x: 3 },
        { P: -2, Q: 7, x: 0.5 },
      ],
      {
        vars: { P: '_.P', Q: "_['Q']" },
        inputs: { P: 'real', Q: 'real', x: 'real' },
      }
    );
    expect(r.shippable).toBe(true);
    expect(r.freeSymbols).toEqual(['x']);
    // Each call reads the texts at the call.
    expect(r.code.match(/_\.P/g)).toHaveLength(2);
  });
  test('another vars text in a function declines', () => {
    const o = outcome(box(WITNESS, engine()), {
      vars: { P: 'Math.PI', Q: '_.Q' },
    });
    expect('message' in o && o.message).toMatch(
      /the vars name P in a function/
    );
  });
});
