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
    ['broadcast', { broadcast: true }],
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
