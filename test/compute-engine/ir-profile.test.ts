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
import {
  compileSlice,
  sliceProgram,
} from '../../src/compute-engine/compilation/ir';
import { ALL_PASSES } from '../../src/compute-engine/compilation/ir/passes';
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
      compile(box(['Add', 'x', 1]), { ...IR, to: 'wgsl' } as never)
    ).toThrow(
      /the profile "ir" is defined for the targets "javascript", "glsl" and "interval-js" only/
    );
  });
});

describe('a decline', () => {
  test('falls back to the interpreter with the diagnostic', () => {
    const r = quiet(() => compile(box(['Sinc', 'x']), IR));
    expect(r.success).toBe(false);
    expect(r.diagnostic).toMatchObject({
      code: 'outside-profile',
      kind: 'capability',
      operator: 'Sinc',
      value: 'Sinc(x)',
    });
    expect(r.run!({ x: 3 })).toBeCloseTo(Math.sin(3) / 3, 12);
  });
  test('with fallback: false is thrown', () => {
    const o = outcome(box(['Sinc', 'x']));
    expect('diagnostic' in o && o.diagnostic.code).toBe('outside-profile');
    expect('message' in o && o.message).toMatch(
      /^Could not compile with the profile 'ir': Sinc\(x\)/
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
    // `av`, not the `a` of the engine, which is declared `any`.
    engine.assign('av', 5);
    const r = compile(box(['Add', ['Multiply', 'av', 'av'], 'x'], engine), {
      ...IR,
      vars: { av: '_.b' },
      fallback: false,
    });
    // The engine value of `av` is not read; `_.b` is.
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
      // `$#0` is a placeholder of a spelling too (the length of a list).
      [['Add', 'q', 1], { q: "_['$#0']" }, /not a source text/],
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
            head: 'Sinc',
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
    const r = broken(() => quiet(() => compile(box(['Sinc', 'x']), IR)));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('compile-error');
    expect(r.diagnostic?.message).toMatch(/internal error/);
    expect(r.run!({ x: Math.PI / 2 })).toBeCloseTo(2 / Math.PI, 12);
  });
  test('with fallback: false is thrown as a compile-error', () => {
    const o = broken(() => outcome(box(['Sinc', 'x'])));
    expect('diagnostic' in o && o.diagnostic.code).toBe('compile-error');
  });
});

describe('a row whose head is the name of an IR operation', () => {
  // The lowering names some rows by their IR operation (`log2`, `div.q`,
  // `rangecount`); a `vars` name or an extension row with such a head is not
  // that operation.
  const programs: Json[] = [
    ['Log', 'x', 2],
    ['Multiply', 'x', ['Rational', 1, 3]],
    ['Length', ['Range', 1, 'x']],
    ['At', ['List', 'x', ['Sin', 'x'], 3], 2],
  ];
  const code = (json: Json, options: Record<string, unknown> = {}) =>
    compile(box(json), { ...IR, ...options, fallback: false }).code;
  const names = ['log2', 'elem', 'div.q', 'rangestep', 'rangecount', 'at'];
  test('a vars name', () => {
    const vars = Object.fromEntries(names.map((n) => [n, '1']));
    for (const json of programs)
      expect([json, code(json, { vars })]).toEqual([json, code(json)]);
  });
  test('an extension row', () => {
    const extension = {
      rows: names.map((head) => ({
        head,
        arity: 'variadic' as const,
        signatures: [[['real'], 'real', 'intercepted'] as const],
        threads: false,
        effect: 'pure' as const,
      })),
      spellings: { intercepted: '(-$0)' },
    };
    for (const json of programs) {
      const expected = code(json);
      expect([
        json,
        _withIrProfileTestExtension(extension as never, () => code(json)),
      ]).toEqual([json, expected]);
    }
  });
});

describe('a cancellation', () => {
  // A row whose fold is cancelled: `Length(L)` is the constant 3, so the
  // `fold` pass folds `Sinc(3)` with the row.
  test('propagates, with fallback', () => {
    const cancelled = {
      rows: [
        {
          head: 'Sinc',
          arity: 1,
          signatures: [[['real'], 'real', 'sinc']],
          threads: false,
          effect: 'pure',
          fold: () => {
            throw new CancellationError({ cause: 'aborted' });
          },
        },
      ],
      spellings: { sinc: '(Math.sin($0) / $0)' },
    } as const;
    let error: unknown;
    try {
      _withIrProfileTestExtension(cancelled, () =>
        quiet(() => compile(box(['Sinc', ['Length', 'L']]), IR))
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
    engine._jsProfile = {};
    const lambda = engine.box(['Function', ['Multiply', 'u', 2], 'u']);
    const admitted = implicitCompile(engine, lambda, 'nd');
    expect(admitted?.profile).toBe('ir');
    expect((admitted?.run as (u: number) => number)(3)).toBe(6);
    // A decline: the existing compiler compiles it.
    const declined = implicitCompile(
      engine,
      engine.box(['Function', ['Sinc', 'u'], 'u']),
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
    expect(code).toMatch(/vec3 in1_S/);
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
  test('a name that holds a value in a body is that value; a local of the name at the call declines', () => {
    const e = engine();
    // The value of the binding of the body, as at the entry (batch G6).
    const symbolDeps = new Set<string>();
    const value = againstInterpreter(
      e,
      ['F_s', 'x', 'y'],
      [
        { x: 2, y: 5 },
        { x: -1.5, y: 0.25 },
      ],
      { symbolDeps }
    );
    expect(value.freeSymbols).toEqual(['x', 'y']);
    expect([...symbolDeps].sort()).toEqual(['F_s', 'm_s']);
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
    // Under grad or turn, Degrees(h) is the angle in that unit.
    for (const unit of ['grad', 'turn'] as const) {
      const other = new ComputeEngine();
      other.angularUnit = unit;
      other.declare('h', 'real');
      againstInterpreter(other, ['Degrees', 'h'], [{ h: 30 }, { h: -127.5 }]);
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
    expect(code).toMatch(/float _fn_ir_u0_g\(float \w+, float \w+\)/);
    expect(code).toMatch(/_fn_ir_u0_g\(in0_x, in1_n\)/);
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
  test('a reduction of a List that is not the library one declines, not its elements', () => {
    const make = () => {
      const e = new ComputeEngine();
      e.declare('x', 'real');
      e.declare('y', 'real');
      return e;
    };
    for (const json of [
      ['Max', ['List', 'x', 'y']],
      ['Sum', ['List', 'x', 'y']],
    ]) {
      expect('result' in outcome(box(json, make()))).toBe(true);
      const host = make();
      (host.lookupDefinition('List')!.operator as { compile?: unknown }).compile =
        () => '0';
      const o = outcome(box(json, host));
      expect('message' in o && o.message).toMatch(
        /the definition of List has its own lowering/
      );
      // A user function named `List` is called: `Max(List(1, 2))` is
      // `Max(1 - 2)`, not the largest element.
      const user = make();
      user.assign(
        'List',
        user.box(['Function', ['Subtract', 'a', 'b'], 'a', 'b'] as never)
      );
      const u = outcome(box(json, user));
      expect('result' in u && u.result.run!({ x: 1, y: 2 } as never)).toBe(-1);
    }
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

describe('trigonometric rows under an angular unit other than radians', () => {
  const engine = (unit: 'deg' | 'grad' | 'turn'): ComputeEngine => {
    const e = new ComputeEngine();
    e.angularUnit = unit;
    e.declare('x', 'real');
    e.declare('y', 'real');
    e.declare('D', 'list<real>');
    e.declare('z', 'complex');
    return e;
  };
  const points = [
    { x: 0.7, y: 1.3 },
    // Not a whole number of turns: Cot has a pole there.
    { x: 37.3, y: -0.4 },
    { x: -2.2, y: 2 },
  ];
  for (const unit of ['deg', 'grad', 'turn'] as const)
    test(`${unit}: direct and inverse functions, a list, the complex lane`, () => {
      const e = engine(unit);
      for (const json of [
        ['Sin', 'x'],
        ['Cos', 'x'],
        ['Tan', 'x'],
        ['Cot', 'x'],
        ['Haversine', 'x'],
        ['Sin', ['Add', ['Multiply', 2, 'x'], 'y']],
        ['Cos', ['Multiply', 'x', 'y']],
        ['Tan', ['Subtract', 'x', 1]],
        ['Arcsin', ['Divide', 'x', 40]],
        ['Arccos', ['Divide', 'y', 3]],
        ['Arctan', 'x'],
        ['Arccot', 'y'],
        ['Arctan2', 'x', 'y'],
      ])
        againstInterpreter(e, json, points);
      againstInterpreter(e, ['Sin', 'D'], [{ D: [0.5, 30, -2] }]);
      // The complex lane: the interpreter converts the angle there too.
      for (const json of [
        ['Sin', 'z'],
        ['Cos', 'z'],
        ['Arcsin', 'z'],
        ['Arctan', 'z'],
        ['Argument', 'z'],
      ]) {
        const r = compile(box(json, e), {
          ...IR,
          fallback: false,
        } as never) as CompilationResult<'javascript'>;
        const z = { re: 0.3, im: 0.2 };
        const expected = interpret(e, box(json, e), { z: z as never });
        expect([
          json,
          agrees((r.run as (v: unknown) => unknown)({ z }), expected),
        ]).toEqual([json, true]);
      }
      // The complex mode: Arcsin(2) leaves the reals.
      const r = compile(box(['Arcsin', 'x'], e), {
        ...IR,
        fallback: false,
        mode: 'complex',
      } as never) as CompilationResult<'javascript'>;
      const expected = interpret(e, box(['Arcsin', 'x'], e), { x: 2 });
      expect(
        agrees((r.run as (v: unknown) => unknown)({ x: 2 }), expected)
      ).toBe(true);
    });
  test('GLSL: the factor of the unit is a multiplication', () => {
    const code = compileSlice(box(['Sin', 'x'], engine('deg')), {
      target: 'glsl',
    }).code;
    expect(code).toMatch(/sin\(\(in0_x \* 0\.017453292\d*\)\)/);
  });
  test('the unit set back to radians gives the code of radians', () => {
    const e = engine('deg');
    const json = ['Add', ['Sin', 'x'], ['Arctan', 'y']];
    const degrees = (
      compile(box(json, e), {
        ...IR,
        fallback: false,
      } as never) as CompilationResult<'javascript'>
    ).code;
    e.angularUnit = 'rad';
    const radians = (
      compile(box(json, e), {
        ...IR,
        fallback: false,
      } as never) as CompilationResult<'javascript'>
    ).code;
    expect(degrees).not.toEqual(radians);
    const plain = new ComputeEngine();
    plain.declare('x', 'real');
    plain.declare('y', 'real');
    expect(radians).toEqual(
      (
        compile(box(json, plain), {
          ...IR,
          fallback: false,
        } as never) as CompilationResult<'javascript'>
      ).code
    );
  });
});

describe('a literal value is read with no N() (CE-1065)', () => {
  /** The calls of `N()` on `value` and on every node under it while `run`
   *  runs (as `countEvaluations()` of `ce-1065-literal-fold-work.test.ts`). */
  function countEvaluations(value: Expression, run: () => void): number {
    let calls = 0;
    const nodes: Expression[] = [];
    const visit = (x: Expression) => {
      nodes.push(x);
      for (const op of x.ops ?? []) visit(op);
    };
    visit(value);
    for (const node of nodes) {
      const N = node.N.bind(node);
      Object.defineProperty(node, 'N', {
        configurable: true,
        value: () => {
          calls += 1;
          return N();
        },
      });
    }
    try {
      run();
      return calls;
    } finally {
      for (const node of nodes) delete (node as { N?: unknown }).N;
    }
  }

  const thousand = Array.from({ length: 1000 }, (_, k) => k / 8);
  test.each([
    [
      'a list of tuples',
      ['List', ['Tuple', 2, 0.5], ['Tuple', 3, -0.25]],
      [
        [2, 0.5],
        [3, -0.25],
      ],
    ],
    ['a tuple', ['Tuple', 2.64, 17], [2.64, 17]],
    ['a list of 1,000 numbers', ['List', ...thousand], thousand],
    [
      'a matrix',
      ['List', ['List', 1, 2.5], ['List', -3, 4]],
      [
        [1, 2.5],
        [-3, 4],
      ],
    ],
  ] as const)('%s', (_, json, expected) => {
    const ce = new ComputeEngine();
    ce.assign('pts', ce.box(json as never));
    const stored = ce._getSymbolValue('pts')!;
    let result: CompilationResult<'javascript'> | undefined;
    const calls = countEvaluations(stored, () => {
      result = compile(ce.box('pts'), {
        ...IR,
        fallback: false,
      } as never) as CompilationResult<'javascript'>;
    });
    expect(calls).toBe(0);
    expect(result!.profile).toBe('ir');
    expect((result!.run as (x: object) => unknown)({})).toEqual(expected);
  });

  test('a point value on GLSL, and a literal list written in the program', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.assign('P', ce.box(['Tuple', 2.64, 17]));
    const stored = ce._getSymbolValue('P')!;
    let code = '';
    expect(
      countEvaluations(stored, () => {
        code = compile(ce.box(['Multiply', 't', 'P']), {
          to: 'glsl',
          profile: 'ir',
          fallback: false,
        }).code;
      })
    ).toBe(0);
    expect(code).toMatch(/^vec2\(/);
    const literal = ce.box(['Add', 't', ['List', 1.5, 2, 3]]);
    const list = literal.ops![1];
    let r: CompilationResult<'javascript'> | undefined;
    expect(
      countEvaluations(list, () => {
        r = compile(literal, {
          ...IR,
          fallback: false,
        } as never) as CompilationResult<'javascript'>;
      })
    ).toBe(0);
    expect((r!.run as (x: object) => unknown)({ t: 1 })).toEqual([2.5, 3, 4]);
  });
});

describe('cse merges two calls of a user function with no effect', () => {
  /** The functions of the witness (Tycho's document `neyret/sc3azg0frd`):
   *  `a_1` and `a_2` each call the previous function five times with the
   *  same argument; `c_k` is a chain of 12 such functions. */
  const engine = (): ComputeEngine => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('y', 'real');
    e.declare('k', 'integer');
    e.declare('n', 'integer');
    const fn = (name: string, body: Json, ...params: string[]) =>
      e.assign(name, box(['Function', body, ...params], e));
    const five = (g: string): Json => [
      'Add',
      [
        'Divide',
        ['Add', ['Multiply', 'x', ['Cos', [g, 'x']]], ['Negate', ['Sin', [g, 'x']]]],
        ['Add', ['Multiply', 'x', ['Sin', [g, 'x']]], ['Cos', [g, 'x']]],
      ],
      [g, 'x'],
    ];
    fn(
      'a_0',
      ['Divide', ['Multiply', 'Pi', 'x'], ['Multiply', 2, ['Add', ['Abs', 'x'], ['Multiply', ['Rational', 1, 2], 'Pi']]]],
      'x'
    );
    fn('a_1', five('a_0'), 'x');
    fn('a_2', five('a_1'), 'x');
    fn('c_0', ['Add', ['Sin', 'x'], 1], 'x');
    for (let j = 1; j <= 12; j++) fn(`c_${j}`, five(`c_${j - 1}`), 'x');
    fn('f', ['Add', ['Sin', 'a'], ['Multiply', 'a', 'a']], 'a');
    // A draw, directly and through a call; a seeded frame (its draw).
    fn('D', ['Add', 'a', ['Random']], 'a');
    fn('E', ['Multiply', 2, ['D', 'a']], 'a');
    fn('S', ['WithRandomSeed', 1, ['Add', 'a', ['Random']]], 'a');
    e.declare('R', '(integer) -> real');
    fn('R', ['If', ['LessEqual', 'j', 0], 1.5, ['Add', 2, ['Multiply', 0.5, ['R', ['Subtract', 'j', 1]]]]], 'j');
    e.declare('P', '(integer) -> real');
    e.declare('Q', '(integer) -> real');
    fn('P', ['If', ['Greater', 'j', 0], ['Q', ['Subtract', 'j', 1]], 1], 'j');
    fn('Q', ['If', ['Greater', 'j', 0], ['P', ['Subtract', 'j', 1]], 2], 'j');
    // A list of a run-time length: a call with two results.
    e.declare('L', '(integer) -> list<integer>');
    fn('L', ['Map', ['Function', ['Multiply', 'i', 'i'], 'i'], ['Range', 1, 'm']], 'm');
    return e;
  };
  const e = engine();
  /** The number of calls of the function `name` in the text of `r`. */
  const calls = (r: { code: string; preambleOnce?: string }, name: string) =>
    ((r.preambleOnce ?? '') + r.code).match(
      new RegExp(`\\bu\\d+_${name.replace('_', '')}\\(`, 'g')
    )?.length ?? 0;
  const run = (json: Json, options: Record<string, unknown> = {}) =>
    compile(box(json, e), { ...IR, ...options, fallback: false } as never);
  /** The interval mode: the result for the point `x`, which contains the
   *  interpreter's value and equals the result with `cse: false`. */
  const interval = (json: Json, point: Record<string, number>) => {
    const r = run(json, { to: 'interval-js' });
    const at = Object.fromEntries(
      Object.entries(point).map(([k, v]) => [k, { lo: v, hi: v }])
    );
    const v = (r.run as (x: object) => any)(at);
    const plain = run(json, { to: 'interval-js', cse: false });
    expect(v).toEqual((plain.run as (x: object) => unknown)(at));
    const expected = interpret(e, box(json, e), point) as number;
    expect([point, v.value.lo <= expected && expected <= v.value.hi]).toEqual([
      point,
      true,
    ]);
    return r;
  };
  const points = [{ x: 0.3 }, { x: -2.5 }, { x: 7 }];

  test('the witness: a_2(x) calls a_1 once and a_1 calls a_0 once', () => {
    const json = ['Multiply', 1000, ['Add', ['Divide', ['Arctan', 'x'], ['a_2', 'x']], -1]];
    const r = againstInterpreter(e, json, points);
    expect([calls(r, 'a_1'), calls(r, 'a_0')]).toEqual([1, 1]);
    // The five calls are equal nodes: the lowering lowers them once.
    const plain = run(json, { cse: false });
    expect([calls(plain, 'a_1'), calls(plain, 'a_0')]).toEqual([1, 1]);
    for (const point of points) {
      const i = interval(json, point);
      expect([calls(i, 'a_1'), calls(i, 'a_0')]).toEqual([1, 1]);
    }
  });
  test('the same call twice in one expression, on each target', () => {
    const json = ['Add', ['f', 'x'], ['Multiply', 2, ['f', 'x']]];
    expect(calls(againstInterpreter(e, json, points), 'f')).toBe(1);
    expect(calls(interval(json, points[0]), 'f')).toBe(1);
    const glsl = run(json, { to: 'glsl' });
    expect(glsl.code.match(/_fn_ir_u\d+_f\(/g)).toHaveLength(1);
    // Two equal nodes, which the lowering lowers once; an argument of
    // another node with the same value is merged by `cse` only.
    expect(
      run(json, { to: 'glsl', cse: false }).code.match(/_fn_ir_u\d+_f\(/g)
    ).toHaveLength(1);
    // prettier-ignore
    const other = ['Add', ['f', 'x'], ['Multiply', 2, ['f', ['At', ['Tuple', 'x', 'y'], 1]]]];
    const at = points.map((p) => ({ ...p, y: 1 }));
    expect(calls(againstInterpreter(e, other, at), 'f')).toBe(1);
    expect(calls(run(other, { cse: false }), 'f')).toBe(2);
    expect(
      run(other, { to: 'glsl' }).code.match(/_fn_ir_u\d+_f\(/g)
    ).toHaveLength(1);
    expect(
      run(other, { to: 'glsl', cse: false }).code.match(/_fn_ir_u\d+_f\(/g)
    ).toHaveLength(2);
  });
  test('different arguments are two calls', () => {
    const r = againstInterpreter(e, ['Add', ['f', 'x'], ['f', 'y']], [
      { x: 0.3, y: 2 },
    ]);
    expect(calls(r, 'f')).toBe(2);
  });
  test('a function that draws, directly or through a call, is called each time', () => {
    const r = run(['Subtract', ['D', 'x'], ['D', 'x']]);
    expect(calls(r, 'D')).toBe(2);
    // Two draws: the difference is not 0 (a probability of about 2^-52).
    expect((r.run as (x: object) => number)({ x: 0.5 })).not.toBe(0);
    const through = run(['Subtract', ['E', 'x'], ['E', 'x']]);
    expect([calls(through, 'E'), calls(through, 'D')]).toEqual([2, 1]);
    expect((through.run as (x: object) => number)({ x: 0.5 })).not.toBe(0);
    const i = run(['Add', ['E', 'x'], ['E', 'x']], { to: 'interval-js' });
    expect(calls(i, 'E')).toBe(2);
  });
  test('a function with an effect (a seeded frame) is called each time', () => {
    const r = run(['Add', ['S', 'x'], ['S', 'x']]);
    expect(calls(r, 'S')).toBe(2);
    expect(calls(run(['Add', ['S', 'x'], ['S', 'x']], { to: 'interval-js' }), 'S')).toBe(2);
  });
  test('a recursive function and two mutually recursive ones are called each time', () => {
    const r = againstInterpreter(e, ['Add', ['R', 'k'], ['R', 'k']], [
      { k: 3 },
      { k: 0 },
    ]);
    expect(r.code.match(/\bu\d+_R\(/g)).toHaveLength(2);
    const pq = againstInterpreter(e, ['Add', ['P', 'k'], ['P', 'k']], [
      { k: 3 },
      { k: 4 },
    ]);
    expect(pq.code.match(/\bu\d+_P\(/g)).toHaveLength(2);
    // The interval mode declines a recursive function.
    for (const json of [['R', 'k'], ['P', 'k']]) {
      const o = outcome(box(json, e), { to: 'interval-js' });
      expect('message' in o && o.message).toMatch(/a recursive function/);
    }
  });
  test('a call in an arm or in a loop body is not read after it', () => {
    const arm = ['List', ['If', ['Greater', 'x', 0], ['f', 'x'], 0], ['f', 'x']];
    expect(calls(againstInterpreter(e, arm, points), 'f')).toBe(2);
    // The interval mode copies a function that its caller calls twice (the
    // pass `inline`): no call is left.
    expect(calls(run(arm, { to: 'interval-js' }), 'f')).toBe(0);
    const loop = [
      'List',
      ['Sum', ['Multiply', 'j', ['f', 'x']], ['Limits', 'j', 1, 'n']],
      ['f', 'x'],
    ];
    const r = againstInterpreter(e, loop, [
      { x: 0.3, n: 3 },
      { x: -1, n: 0 },
    ]);
    // The call in the loop body is a copy of the body of `f` (the pass
    // `inline`), computed before the loop: one call, after it. The interval
    // mode copies that call too, and `cse` merges the two copies.
    expect(calls(r, 'f')).toBe(1);
    expect(calls(run(loop, { to: 'interval-js' }), 'f')).toBe(0);
  });
  test('a call with two results, a list and its length', () => {
    const json = ['Add', ['Sum', ['L', 'n']], ['Length', ['L', 'n']], ['Max', ['L', 'n']]];
    const r = againstInterpreter(e, json, [{ n: 4 }, { n: 7 }, { n: 1 }]);
    expect(calls(r, 'L')).toBe(1);
    // Three equal nodes `L(n)`: the lowering lowers them once.
    expect(calls(run(json, { cse: false }), 'L')).toBe(1);
    expect((r.run as (x: object) => number)({ n: 4 })).toBe(50);
    const i = interval(json, { n: 4 });
    expect(calls(i, 'L')).toBe(1);
  });
  test('a chain of 12 functions, each calling the previous five times', () => {
    const r = run(['c_12', 'x']);
    // One call per function: 13 calls, not 5^12 at run time.
    expect(calls(r, 'c_[0-9]+')).toBe(13);
    // The value of a shorter chain against the interpreter.
    againstInterpreter(e, ['c_3', 'x'], points);
    expect(calls(run(['c_12', 'x'], { to: 'interval-js' }), 'c_[0-9]+')).toBe(13);
  });
  test('2,000 calls with distinct arguments are 2,000 calls', () => {
    const sum = box(
      ['Add', ...Array.from({ length: 2000 }, (_, j) => ['f', ['Add', 'x', j + 1]])],
      e
    );
    expect(calls(compile(sum, { ...IR, fallback: false }), 'f')).toBe(2000);
  });
});

describe('invariants: an instruction of a loop body that reads nothing of the body is computed before the loop', () => {
  const e = new ComputeEngine();
  e.precision = 'machine';
  e.declare('x', 'real');
  e.declare('y', 'real');
  e.declare('T', 'real<-10..10>');
  e.declare('n', 'integer');
  e.declare('L', 'list<real>');
  e.declare('V', 'list<real^3>');
  const fn = (name: string, body: Json, ...params: string[]) =>
    e.assign(name, box(['Function', body, ...params], e));
  // The functions of Tycho's document `showcase/voronoi-diagram` (its `n`
  // is `nj` here). `d2` is the squared distance of (a, b) to the seed j,
  // which F, B and nj compute.
  const sq = ['Sqrt', ['Add', 'j', -0.5]];
  const d2 = (a: Json, b: Json): Json => [
    'Add',
    ['Power', ['Add', a, ['Multiply', -0.14, ['Cos', ['Add', 'T', ['Multiply', 1.9, 'j']]]], ['Multiply', -0.3625, ['Cos', ['Multiply', 2.4, 'j']], sq]], 2],
    ['Power', ['Add', b, ['Multiply', -0.1, ['Sin', ['Add', ['Multiply', 2, 'T'], ['Multiply', 2.7, 'j']]]], ['Multiply', -0.2375, ['Sin', ['Multiply', 2.4, 'j']], sq]], 2],
  ];
  const sixteen = ['Limits', 'j', 1, 16];
  fn('F', ['Block', ['Min', ['Comprehension', d2('a', 'b'), ['Element', 'j', ['Range', 1, 16]]]]], 'a', 'b');
  fn('nj', ['Block', ['Power', 'ExponentialE', ['Multiply', -5000, ['Add', d2('a', 'b'), ['Negate', ['F', 'a', 'b']]]]]], 'a', 'b', 'j');
  fn('Z', ['Block', ['Sum', ['nj', 'a', 'b', 'j'], sixteen]], 'a', 'b');
  const root = ['Sqrt', ['Multiply', ['Rational', 1, 16], ['Add', 'j', -0.5]]];
  fn('q', ['Block', ['Add', ['Multiply', 0.1, ['Sin', ['Add', ['Multiply', 2, 'T'], ['Multiply', 2.7, 'j']]]], ['Multiply', 0.95, ['Sin', ['Multiply', 2.4, 'j']], root]]], 'j');
  fn('p', ['Block', ['Add', ['Multiply', 0.14, ['Cos', ['Add', 'T', ['Multiply', 1.9, 'j']]]], ['Multiply', 1.45, ['Cos', ['Multiply', 2.4, 'j']], root]]], 'j');
  const mean = (w: Json): Json => ['Block', ['Multiply', ['Divide', 1, ['Z', 'a', 'b']], ['Sum', ['Multiply', w, ['nj', 'a', 'b', 'j']], sixteen]]];
  fn('v', mean(['q', 'j']), 'a', 'b');
  fn('u', mean(['p', 'j']), 'a', 'b');
  fn('H', mean(['Mod', ['Multiply', 0.567, 'j'], 1]), 'a', 'b');
  fn('B', ['Block', ['Sum', ['Power', 'ExponentialE', ['Negate', ['Divide',
    ['Add', d2('a', 'b'), ['Negate', ['F', 'a', 'b']]],
    ['Multiply', 0.015, ['Sqrt', ['Add',
      ['Power', ['Add', ['Negate', ['v', 'a', 'b']], ['q', 'j']], 2],
      ['Power', ['Add', ['Negate', ['u', 'a', 'b']], ['p', 'j']], 2], 0.0004]]]]]], sixteen]], 'a', 'b');
  const voronoi = ['Which', ['Less', ['F', 'x', 'y'], 0.0008], 0, ['Less', 1.3, ['B', 'x', 'y']], 0, 'True', ['Add', ['Multiply', 0.8, ['H', 'x', 'y']], 0.12]];
  // A function that fails: a Loop of 100 passes, over a budget of 50.
  fn('f', ['Block', ['Declare', 's', 'real', 0], ['Loop', ['Assign', 's', ['Add', 's', 'w']], ['Element', 'i', ['Range', 1, 100]]], 's'], 'w');
  // A function that can fail (a loop) and that draws nothing.
  fn('g', ['Sum', ['Sin', ['Multiply', 'w', 'i']], ['Limits', 'i', 1, 4]], 'w');

  const run = (json: Json, options: Record<string, unknown> = {}) =>
    compile(box(json, e), { ...IR, ...options, fallback: false } as never);
  const textOf = (r: { code: string; preamble?: string }) =>
    `${r.preamble ?? ''}\n${r.code}`;
  /** The text of the user function `name` in the text `t`. */
  const functionText = (t: string, name: string) =>
    new RegExp(`const u\\d+_${name} = [\\s\\S]*?\\n};`).exec(t)![0];
  /** The compilation with the pass on and off: the same results. */
  const sameWithout = (json: Json, points: object[], options: object = {}) => {
    const slice = (invariants: boolean) =>
      compileSlice(box(json, e), {
        target: 'javascript',
        passes: { ...ALL_PASSES, invariants },
        ...options,
      } as never) as unknown as { run: (x: object) => unknown; warnings: unknown[] };
    const [on, off] = [slice(true), slice(false)];
    for (const point of points) expect(on.run(point)).toEqual(off.run(point));
    expect(on.warnings).toEqual(off.warnings);
    return on;
  };
  /** The instructions of the entry of `json`, and of its loops' bodies. */
  const entry = (json: Json, options: object = {}) =>
    sliceProgram(box(json, e), { target: 'javascript', ...options } as never)
      .functions[0].body.body;
  const ops = (body: { k: string; op?: string }[]) =>
    body.filter((i) => i.k === 'op').map((i) => i.op);
  /** The loops of `body`, also those in the arms of its conditionals (the
   *  test of the `iterationBudget`), not those in a loop body. */
  const loops = (body: { k: string }[]): {
    body: { body: { k: string; op?: string; fn?: string; then?: { body: { op?: string }[] } }[] };
  }[] =>
    body.flatMap((i) => {
      if (i.k === 'loop') return [i as never];
      const arms = i as { then?: { body: { k: string }[] }; else?: { body: { k: string }[] } };
      return i.k === 'if' ? [...loops(arms.then!.body), ...loops(arms.else!.body)] : [];
    });

  const points = [
    { x: 0.15, y: 0.35, T: 0.5 },
    { x: -0.4, y: 0.2, T: 1.3 },
    { x: 0.6, y: -0.5, T: -2 },
    { x: 0.05, y: 0.1, T: 0 },
  ];

  test('the voronoi witness: the calls of B that read no index are before its loop, on JavaScript and in the interval mode', () => {
    for (const json of [voronoi, ['B', 'x', 'y']]) {
      const old = compile(box(json, e), { fallback: false });
      const r = run(json);
      for (const point of points) {
        const want = (old.run as (x: object) => number)(point);
        expect([point, agrees((r.run as (x: object) => number)(point), want)]).toEqual([point, true]);
      }
      sameWithout(json, points);
      const oldInterval = compile(box(json, e), { to: 'interval-js', fallback: false });
      const interval = run(json, { to: 'interval-js' });
      const at = (p: Record<string, number>, h = 0) =>
        Object.fromEntries(Object.entries(p).map(([k, c]) => [k, { lo: c, hi: c + h }]));
      for (const point of points) {
        const scalar = (r.run as (x: object) => number)(point);
        const got = (interval.run as (x: object) => any)(at(point));
        const want = (oldInterval.run as (x: object) => any)(at(point));
        expect([point, got.value.lo <= scalar && scalar <= got.value.hi]).toEqual([point, true]);
        for (const end of ['lo', 'hi'])
          expect([point, end, Math.abs(got.value[end] - want.value[end]) <= 1e-9 * Math.max(1, Math.abs(want.value[end]))]).toEqual([point, end, true]);
        // A box: the same enclosure as the existing target, within rounding.
        const box2 = (interval.run as (x: object) => any)(at(point, 0.01));
        const old2 = (oldInterval.run as (x: object) => any)(at(point, 0.01));
        expect(box2.kind).toBe(old2.kind);
      }
    }
    // In B, the calls of F, v and u read no index: they are before the
    // loop; q and p read it, and are copies of their bodies (the pass
    // `inline`), whose sines and cosines `cse` merges with those of B's
    // own term. In the interval mode the sum of B is written
    // out (its bounds are constants): one call of each, and no loop.
    const written = functionText(textOf(run(['B', 'x', 'y'], { to: 'interval-js' })), 'B');
    expect(written).not.toMatch(/for \(/);
    for (const g of ['F', 'v', 'u'])
      expect([g, written.match(new RegExp(`u\\d+_${g}\\(`, 'g'))?.length]).toEqual([g, 1]);
    for (const r of [run(['B', 'x', 'y'])]) {
      const b = functionText(textOf(r), 'B');
      const [before, inside] = [b.slice(0, b.indexOf('for (')), b.slice(b.indexOf('for ('))];
      for (const g of ['F', 'v', 'u']) {
        expect([g, before.match(new RegExp(`u\\d+_${g}\\(`, 'g'))?.length]).toEqual([g, 1]);
        expect([g, new RegExp(`u\\d+_${g}\\(`).test(inside)]).toEqual([g, false]);
      }
      for (const g of ['q', 'p']) expect([g, new RegExp(`u\\d+_${g}\\(`).test(b)]).toEqual([g, false]);
    }
  });

  test("ce-compiler's witness: Max(L) is computed before the loop of a run-time count", () => {
    const json = ['Sum', ['Max', ['Max', 'L'], 'k'], ['Limits', 'k', 1, 'n']];
    const L = [0.5, -2, 3.25];
    const r = againstInterpreter(e, json, [{ L, n: 0 }, { L, n: 1 }, { L, n: 5 }]);
    const text = textOf(r);
    // The loop over L ends before the loop of k starts.
    expect(text.indexOf('_.L[')).toBeLessThan(text.indexOf('_.n'));
    expect(loops(entry(json))).toHaveLength(2);
    sameWithout(json, [{ L, n: 0 }, { L: [], n: 3 }, { L, n: 4 }]);
  });

  test('a loop of no pass at run time runs no call that can fail', () => {
    const budget = { iterationBudget: 50 };
    const json = ['Sum', ['Multiply', ['f', 'x'], 'k'], ['Limits', 'k', 1, 'n']];
    const r = run(json, budget);
    expect((r.run as (x: object) => number)({ x: 2, n: 0 })).toBe(0);
    expect(() => (r.run as (x: object) => number)({ x: 2, n: 1 })).toThrow(CancellationError);
    // The call stays in the loop.
    expect(loops(entry(json, budget))[0].body.body.some((i) => i.k === 'call')).toBe(true);
    // The interval mode: a call of a function whose Sum is over the budget.
    const interval = run(['Sum', ['Multiply', ['g', 'x'], 'k'], ['Limits', 'k', 1, 'n']], { to: 'interval-js', iterationBudget: 3 });
    const at = (n: number) => ({ x: { lo: 2, hi: 2 }, n: { lo: n, hi: n } });
    expect((interval.run as (x: object) => unknown)(at(0))).toEqual({ kind: 'interval', value: { lo: 0, hi: 0 } });
    expect((interval.run as (x: object) => unknown)(at(1))).toEqual({ kind: 'entire' });
  });

  test('a loop of constant bounds: a call that can fail is before it, and fails as before', () => {
    const json = ['Sum', ['Multiply', ['f', 'x'], 'k'], ['Limits', 'k', 1, 3]];
    const r = run(json, { iterationBudget: 50 });
    let thrown: unknown;
    try {
      (r.run as (x: object) => number)({ x: 2 });
    } catch (err) {
      thrown = err;
    }
    expect((thrown as CancellationError).cause).toBe('iteration-limit-exceeded');
    const body = entry(json, { iterationBudget: 50 });
    expect(body.some((i) => i.k === 'call')).toBe(true);
    expect(loops(body)[0].body.body.some((i) => i.k === 'call')).toBe(false);
    // The moved call counts its 100 passes once.
    expect((run(json, { iterationBudget: 150 }).run as (x: object) => number)({ x: 2 })).toBe(1200);
    againstInterpreter(e, ['Sum', ['Multiply', ['g', 'x'], 'k'], ['Limits', 'k', 1, 3]], [{ x: 0.3 }, { x: -2 }]);
  });

  test('draws before and after an invariant: the same draws and warnings', () => {
    // A draw, `k·sin(x)`, then a second draw and `g(x)`.
    const json = ['WithRandomSeed', 7, ['Sum', ['Block', ['Declare', 'r', 'real', ['Random']],
      ['Add', 'r', ['Multiply', 'k', ['Sin', 'x']], ['Multiply', ['Random'], ['g', 'x']]]], ['Limits', 'k', 1, 3]]];
    const on = sameWithout(json, [{ x: 0.5 }, { x: -1 }]);
    expect(on.warnings.length).toBeGreaterThan(0);
    const frame = entry(json).find((i) => i.k === 'region') as unknown as { regions: { body: { k: string }[] }[] };
    const [loop] = loops(frame.regions[0].body);
    // `sin` reads nothing of the body and moves; the call of `g`, which
    // can fail, is after a draw and stays.
    expect(ops(loop.body.body)).not.toContain('sin');
    expect(loop.body.body.some((i) => i.k === 'call')).toBe(true);
    // Without the first draw, the call is before every draw and moves.
    const first = ['WithRandomSeed', 7, ['Sum', ['Add', ['Multiply', 'k', ['g', 'x']], ['Random']], ['Limits', 'k', 1, 3]]];
    sameWithout(first, [{ x: 0.5 }]);
    const frame2 = entry(first).find((i) => i.k === 'region') as unknown as { regions: { body: { k: string }[] }[] };
    expect(frame2.regions[0].body.some((i) => i.k === 'call')).toBe(true);
  });

  test('a nested loop: an inner loop that reads nothing of the outer body moves as a whole', () => {
    const whole = ['Sum', ['Multiply', 'k', ['Product', ['Add', 'j', 'x'], ['Limits', 'j', 1, 3]]], ['Limits', 'k', 1, 4]];
    againstInterpreter(e, whole, [{ x: 0.5 }, { x: -2 }]);
    expect(loops(entry(whole))).toHaveLength(2);
    // sin(k·x) reads k: it moves out of the inner loop, not out of the outer.
    const inner = ['Sum', ['Sum', ['Multiply', 'j', ['Sin', ['Multiply', 'k', 'x']]], ['Limits', 'j', 1, 3]], ['Limits', 'k', 1, 'n']];
    againstInterpreter(e, inner, [{ x: 0.5, n: 0 }, { x: 0.5, n: 4 }]);
    const [outer] = loops(entry(inner));
    expect(ops(outer.body.body)).toContain('sin');
    expect(ops(loops(outer.body.body as { k: string }[])[0].body.body)).not.toContain('sin');
    sameWithout(inner, [{ x: 0.5, n: 4 }]);
  });

  test('an invariant in an arm, and a value of the previous pass, stay', () => {
    const arm = ['Sum', ['If', ['Greater', 'k', 2], ['Sin', 'x'], 0], ['Limits', 'k', 1, 'n']];
    againstInterpreter(e, arm, [{ x: 0.5, n: 4 }]);
    const [loop] = loops(entry(arm));
    const branch = loop.body.body.find((i) => i.k === 'if')!;
    expect(ops(branch.then!.body as { k: string; op?: string }[])).toContain('sin');
    // `sin(s)` reads the value of the previous pass.
    const carried = ['Block', ['Declare', 's', 'real', 1], ['Loop', ['Assign', 's', ['Add', ['Sin', 's'], 'x']], ['Element', 'k', ['Range', 1, 3]]], 's'];
    againstInterpreter(e, carried, [{ x: 0.5 }]);
    expect(ops(loops(entry(carried))[0].body.body)).toContain('sin');
  });

  test('the body of a build and of a filter', () => {
    e.declare('D', 'list<real>');
    const map = ['Map', ['Function', ['Multiply', 'z', ['Sin', 'x']], 'z'], 'D'];
    const filter = ['Filter', 'D', ['Function', ['Greater', 'z', ['Cos', 'x']], 'z']];
    for (const [json, op] of [[map, 'sin'], [filter, 'cos']] as const) {
      againstInterpreter(e, json, [{ x: 0.5, D: [] }, { x: 0.5, D: [1, -2, 3] }]);
      const body = entry(json);
      expect(ops(body)).toContain(op);
      const region = body.find((i) => i.k === 'region') as unknown as { regions: { body: { k: string; op?: string }[] }[] };
      expect(ops(region.regions[0].body)).not.toContain(op);
    }
    // A list read in a build that does not read its index (the shape of
    // `neyret/51a4237846`): PointList(P1, P2), as long as the shorter of
    // P1 and P2, its PointX and their Sum are computed before the Map.
    e.declare('P1', 'list<real>');
    e.declare('P2', 'list<real>');
    const list = ['Map', ['Function', ['Multiply', 'z', ['Sum', ['PointX', ['PointList', 'P1', 'P2']]]], 'z'], 'D'];
    const at = { D: [1, -2, 3], P1: [0.5, 2, -1], P2: [4, 5] };
    againstInterpreter(e, list, [at, { ...at, D: [] }, { ...at, P1: [] }]);
    sameWithout(list, [at, { ...at, D: [] }]);
    const body = entry(list);
    const regions = body.filter((i) => i.k === 'region') as unknown as { regions: { body: { k: string }[] }[] }[];
    // Two builds (the points, their x) and the loop of the Sum are out.
    expect([regions.length, loops(body).length]).toEqual([3, 1]);
    expect(regions[2].regions[0].body.some((i) => i.k === 'region' || i.k === 'loop')).toBe(false);
  });

  test('the interval mode: what can throw there stays in a loop of no pass', () => {
    e.declare('m', 'integer');
    e.declare('G3', 'list<real>');
    const zero = { kind: 'interval', value: { lo: 0, hi: 0 } };
    const G3 = [0.5, 0.2, 0.9];
    const cases: [Json, object, object][] = [
      // `rangestep` and `rangecount` read `_IA.number(m)`, which throws.
      [['Sum', ['Multiply', 'k', ['Length', ['Range', 1, 'm']]], ['Limits', 'k', 1, 'n']], { m: { lo: 1, hi: 5 } }, {}],
      // A filter of an undecided condition throws.
      [['Sum', ['Multiply', 'k', ['Length', ['Filter', 'G3', ['Function', ['Greater', 'z', 'x'], 'z']]]], ['Limits', 'k', 1, 'n']], { x: { lo: 0, hi: 1 }, G3 }, {}],
      // The loop of Max(G3) is refused by the limit of 2 passes.
      [['Sum', ['Max', ['Max', 'G3'], 'k'], ['Limits', 'k', 1, 'n']], { G3 }, { iterationBudget: 2 }],
    ];
    for (const [json, inputs, options] of cases) {
      const at = { ...inputs, n: { lo: 0, hi: 0 } };
      const r = run(json, { to: 'interval-js', ...options });
      expect([json, (r.run as (x: object) => unknown)(at)]).toEqual([json, zero]);
      const on = sameWithout(json, [at], { mode: 'interval', ...options });
      expect(on.run(at)).toEqual(zero);
    }
  });

  test('a Loop keeps a call that can fail; a loop of constant bounds and no pass runs no call', () => {
    const loop = ['Block', ['Declare', 's', 'real', 0], ['Loop', ['Assign', 's', ['Add', 's', ['g', 'x']]], ['Element', 'i', ['Range', 1, 3]]], 's'];
    againstInterpreter(e, loop, [{ x: 0.3 }]);
    expect(loops(entry(loop))[0].body.body.some((i) => i.k === 'call')).toBe(true);
    // 3..1 is no pass: f, over the budget of 50, is not called.
    const none = ['Sum', ['Multiply', ['f', 'x'], 'k'], ['Limits', 'k', 3, 1]];
    expect((run(none, { iterationBudget: 50 }).run as (x: object) => number)({ x: 2 })).toBe(0);
    expect(entry(none, { iterationBudget: 50 }).some((i) => i.k === 'call')).toBe(false);
  });

  test('a loop over the length of a list made in the same body stays', () => {
    e.declare('G4', 'list<real>');
    // The filter reads k, so its count, the bound of the inner Sum, stays.
    const json = ['Sum', ['Sum', 'i', ['Limits', 'i', 1, ['Length', ['Filter', 'G4', ['Function', ['Greater', 'z', 'k'], 'z']]]]], ['Limits', 'k', 1, 'n']];
    const G4 = [0.5, 1.5, 2.5, 3.5];
    againstInterpreter(e, json, [{ G4, n: 0 }, { G4, n: 3 }]);
    sameWithout(json, [{ G4, n: 0 }, { G4, n: 3 }]);
    const [outer] = loops(entry(json));
    expect(outer.body.body.some((i) => i.k === 'region')).toBe(true);
    expect(loops(outer.body.body as { k: string }[])).toHaveLength(1);
  });

  test('GLSL: a list and a conditional are declared before the for', () => {
    const list = run(['Sum', ['Multiply', 'k', ['Max', ['Add', 'V', 'x']]], ['Limits', 'k', 1, 4]], { to: 'glsl' });
    expect(list.code.indexOf('vec3 ')).toBeLessThan(list.code.indexOf('for ('));
    expect(list.code.match(/for \(/g)).toHaveLength(2);
    const cond = run(['Sum', ['Multiply', 'k', ['If', ['Less', 'x', 0], ['Sin', 'y'], ['Cos', 'y']]], ['Limits', 'k', 1, 'n']], { to: 'glsl' });
    expect(cond.code.indexOf('if (')).toBeLessThan(cond.code.indexOf('for ('));
  });
});

describe('equal sub-expressions written as separate nodes are lowered once', () => {
  // Tycho's document `neyret/51a4237846`: each level reads the points of the
  // level below five times, as five copies of its MathJSON, so the copies of
  // the innermost `PointList` are 5^levels separate nodes.
  // prettier-ignore
  const pointStep = (p: Json): Json => ['PointList', ['Subtract', 'D', ['Multiply', ['Add', ['Multiply', 'y', ['PointX', p]], ['Multiply', ['Subtract', 1, 'y'], ['PointY', p]]], ['PointY', p]]], ['Add', ['Multiply', ['Rational', 1, 100], ['Power', ['PointY', p], 2]], ['PointX', p]], 'D'];
  // The same recurrence on a point of two scalars, which every target
  // compiles.
  // prettier-ignore
  const tupleStep = (p: Json): Json => ['Tuple', ['Subtract', 'x', ['Multiply', ['Add', ['Multiply', 'y', ['At', p, 1]], ['Multiply', ['Subtract', 1, 'y'], ['At', p, 2]]], ['At', p, 2]]], ['Add', ['Multiply', ['Rational', 1, 100], ['Power', ['At', p, 2], 2]], ['At', p, 1]]];
  /** `levels` applications of `step` to `start`, with every operand a copy
   *  of its own (no two JSON arrays are shared, so no two nodes are). */
  const nest = (step: (p: Json) => Json, start: Json, levels: number): Json => {
    let p = start;
    for (let i = 0; i < levels; i++) p = step(JSON.parse(JSON.stringify(p)));
    return JSON.parse(JSON.stringify(p));
  };
  const tuples = (levels: number): Json => [
    'Add',
    ['At', nest(tupleStep, ['Tuple', 'x', 'y'], levels), 1],
    ['At', nest(tupleStep, ['Tuple', 'x', 'y'], levels), 2],
  ];
  /** The number of instructions, and of region instructions (a build, a
   *  reduction), in the entry of the IR with no pass. */
  const counts = (json: Json, options: Record<string, unknown> = {}) => {
    const c = { instrs: 0, regions: 0 };
    const walk = (r: { body: any[] }) => {
      for (const i of r.body) {
        c.instrs++;
        if (i.k === 'region') {
          c.regions++;
          i.regions.forEach(walk);
        }
        if (i.k === 'if') [i.then, i.else].forEach(walk);
        if (i.k === 'loop') walk(i.body);
      }
    };
    const p = sliceProgram(box(json), {
      target: 'javascript',
      passes: false,
      ...options,
    } as never);
    walk(p.functions.find((f) => f.name === p.entry)!.body);
    return c;
  };
  const point = { x: 0.3, y: 0.7, D: [0.1, 0.2, 0.5], E: [0.4, -0.3, 0.9] };

  test('the points of five levels: one build per distinct sub-tree', () => {
    const json = nest(pointStep, ['PointList', 'D', 'E', 'D'], 5);
    // The `PointList` of each level and its `PointX` and `PointY`, and the
    // innermost `PointList`: 16, where each copy was lowered (7,811).
    expect(counts(json).regions).toBe(16);
    againstInterpreter(ce, nest(pointStep, ['PointList', 'D', 'E', 'D'], 2), [
      point,
    ]);
    againstInterpreter(ce, json, [point]);
  });

  test('a recurrence of scalars: linear in its levels on every target', () => {
    // 5^5 copies of the innermost `Tuple`: more than 50,000 nodes to lower
    // when each copy is lowered.
    const json = tuples(5);
    expect(counts(json).instrs).toBeLessThan(100);
    expect(counts(json, { mode: 'interval' }).instrs).toBeLessThan(100);
    expect(counts(json, { target: 'glsl' }).instrs).toBeLessThan(100);
    againstInterpreter(ce, json, [point, { x: -0.8, y: 0.2 }]);
    const r = compile(box(json), {
      ...IR,
      to: 'interval-js',
      fallback: false,
    } as never);
    const v = (r.run as (x: object) => any)({
      x: { lo: 0.3, hi: 0.3 },
      y: { lo: 0.7, hi: 0.7 },
    });
    const expected = interpret(ce, box(json), { x: 0.3, y: 0.7 }) as number;
    expect(v.value.lo <= expected && expected <= v.value.hi).toBe(true);
    expect(
      compile(box(json), { ...IR, to: 'glsl', fallback: false } as never)
        .success
    ).toBe(true);
  });

  // The two tests below are kept apart by the frame check of the memo (the
  // names a copy reads, against their bindings), which sees the local and
  // the index; the definition in the id is a second guard there. Two equal
  // leaves that differ by their definition alone do not reach the lowering:
  // `compile()` refuses a name read with two definitions, and a function
  // body declines a capture of another definition than its own.
  test('a copy under a Block that declares a local of the name it reads (the frame check)', () => {
    // prettier-ignore
    const json = ['Add', ['Sin', ['Multiply', 2, 'x']], ['Block', ['Declare', 'x', "'real'", 5], ['Sin', ['Multiply', 2, 'x']]]];
    againstInterpreter(ce, json, [{ x: 0.3 }, { x: -2 }]);
    expect(
      (compile(box(json), IR).run as (x: object) => number)({ x: 0.3 })
    ).toBeCloseTo(Math.sin(0.6) + Math.sin(10), 14);
  });

  test('a call of a name that two scopes define with different bodies', () => {
    const engine = makeEngine();
    engine.assign('g', box(['Function', ['Add', 't', 1], 't'], engine));
    engine.pushScope();
    engine.declare('g', '(real) -> real');
    engine.assign('g', box(['Function', ['Multiply', 't', 10], 't'], engine));
    const inner = box(['g', ['Sin', 'x']], engine);
    engine.popScope();
    const outer = box(['g', ['Sin', 'x']], engine);
    const root = engine.function('Add', [outer, inner]);
    const r = compile(root, { ...IR, fallback: false } as never);
    for (const x of [0.3, -1.2]) {
      const want = Math.sin(x) + 1 + 10 * Math.sin(x);
      expect((r.run as (p: object) => number)({ x })).toBeCloseTo(want, 14);
      expect(
        agrees(
          (r.run as (p: object) => number)({ x }),
          interpret(engine, root, { x })
        )
      ).toBe(true);
    }
  });

  test('two equal draws are two draws, in the interpreter’s order', () => {
    const choice = ['Sum', ['RandomChoice', ['Interval', 0, ['Open', 1]], 3]];
    // prettier-ignore
    const json = ['WithRandomSeed', 5, ['List', ['Random'], ['Random'], choice, choice]];
    const r = compile(box(json), { ...IR, fallback: false } as never);
    const v = (r.run as () => number[])();
    expect(agrees(v, interpret(ce, box(json), {}))).toBe(true);
    expect(v[0]).not.toBe(v[1]);
    expect(v[2]).not.toBe(v[3]);
  });

  test('a copy in each arm of an If: each arm holds its own lowering', () => {
    const arm = (h: string) => [h, ['PointX', ['PointList', 'D', 'E']]];
    const json = ['If', ['Greater', 'x', 0], arm('Min'), arm('Max')];
    const p = sliceProgram(box(json), {
      target: 'javascript',
      passes: false,
    } as never);
    const branch = p.functions[0].body.body.find((i) => i.k === 'if') as {
      then: { body: { k: string }[] };
      else: { body: { k: string }[] };
    };
    for (const r of [branch.then, branch.else])
      expect(r.body.filter((i) => i.k === 'region').length).toBeGreaterThan(0);
    againstInterpreter(ce, json, [
      { x: 0.3, D: [1, 2, 3], E: [4, 5, 6] },
      { x: -0.3, D: [1, 2, 3], E: [4, 5, 6] },
    ]);
  });

  test('a copy inside a Sum whose index has the name that the copy outside reads (the frame check)', () => {
    // prettier-ignore
    const json = ['Add', ['Sin', ['Multiply', 2, 'n']], ['Sum', ['Sin', ['Multiply', 2, 'n']], ['Limits', 'n', 1, 3]]];
    againstInterpreter(ce, json, [{ n: 5 }, { n: -2 }]);
  });

  test('a rational and the decimal of the same double are two leaves in the interval mode', () => {
    // The interval mode encloses the exact 1/10, whose double is not its
    // value, and takes the decimal 0.1 as the point at its double: two
    // `exp` of two different sums.
    const x = (d: Json) => ['Exp', ['Add', 'x', d]];
    const json = ['Add', x(['Rational', 1, 10]), x(0.1)];
    const p = sliceProgram(box(json), {
      target: 'javascript',
      mode: 'interval',
      passes: false,
    } as never);
    const ops = p.functions[0].body.body.flatMap((i) =>
      i.k === 'op' ? [i.op] : []
    );
    expect(ops.filter((op) => op === 'exp')).toHaveLength(2);
    const r = compile(box(json), {
      ...IR,
      to: 'interval-js',
      fallback: false,
    } as never);
    for (const at of [0.3, -2.5]) {
      const v = (r.run as (x: object) => any)({ x: { lo: at, hi: at } });
      const expected = interpret(ce, box(json), { x: at }) as number;
      expect([at, v.value.lo <= expected && expected <= v.value.hi]).toEqual([
        at,
        true,
      ]);
    }
  });

  test('a call that a Sum binds again compiles: the copy is the first lowering', () => {
    // The body of `g` reads `x` where `g` is defined (the input `x`). The
    // copy of `g(1)` in the `Sum` is equal to the first one and reuses its
    // lowering, as one shared node does; lowered again in the `Sum`, where
    // `x` is the index, the call declined (a call of g, which reads the
    // input x, where x is a local or a parameter).
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    // prettier-ignore
    engine.assign('g', box(['Function', ['Add', 't', ['Multiply', 100, 'x']], 't'], engine));
    const json = ['List', ['g', 1], ['Sum', ['g', 1], ['Limits', 'x', 1, 3]]];
    const r = againstInterpreter(engine, json, [{ x: 0.5 }, { x: -2 }]);
    expect((r.run as (p: object) => number[])({ x: 0.5 })).toEqual([51, 153]);
    const i = compile(box(json, engine), {
      ...IR,
      to: 'interval-js',
      fallback: false,
    } as never);
    expect(
      (i.run as (p: object) => { value: { lo: number; hi: number } }[])({
        x: { lo: 0.5, hi: 0.5 },
      }).map((v) => [v.value.lo, v.value.hi])
    ).toEqual([
      [51, 51],
      [153, 153],
    ]);
  });

  test('two equal function literals are two, and their equal arguments one', () => {
    // The parameter of each literal has a definition of its own.
    const arg = ['PointX', ['PointList', 'D', 'E']];
    const lit = ['Function', ['Multiply', 'k', 2], 'k'];
    const json = [
      'Add',
      ['Sum', ['Map', lit, arg]],
      ['Max', ['Map', lit, arg]],
    ];
    // The builds: `PointList` and `PointX` once, and one `Map` each.
    expect(counts(json).regions).toBe(4);
    againstInterpreter(ce, json, [{ D: [1, 2, 3], E: [4, 5, 6] }]);
  });

  test('a decline in a copy is reported', () => {
    // prettier-ignore
    const json = ['Add', ['Sin', ['Multiply', 2, ['Foo', 'x']]], ['Sin', ['Multiply', 2, ['Foo', 'x']]]];
    const o = outcome(box(json));
    expect('message' in o && o.message).toMatch(/Foo is an unknown operator/);
  });
});

describe('a Sum or a Product of constant bounds written out (the internal switch unrollSums on JavaScript)', () => {
  const e = new ComputeEngine();
  e.declare('x', 'real');
  e.assign('g', e.box(['Function', ['Add', ['Power', 't', 2], 1], 't'] as never));
  e.declare('fact', '(integer) -> integer');
  e.assign(
    'fact',
    e.box([
      'Function',
      ['If', ['LessEqual', 'k', 0], 1, ['Multiply', 'k', ['fact', ['Subtract', 'k', 1]]]],
      'k',
    ] as never)
  );
  type Slice = { run: (x: object) => unknown; warnings: unknown[] };
  const slice = (json: Json, unrollSums: boolean, options: object = {}) =>
    compileSlice(box(json, e), {
      target: 'javascript',
      unrollSums,
      ...options,
    } as never) as unknown as Slice;
  /** The number of loops of the program, in every region. */
  const loopCount = (json: Json, options: object = {}): number => {
    const p = sliceProgram(box(json, e), {
      target: 'javascript',
      unrollSums: true,
      ...options,
    } as never);
    type R = { body: { k: string; body?: R; then?: R; else?: R; regions?: R[] }[] };
    const count = (r: R): number =>
      r.body.reduce(
        (n, i) =>
          n +
          (i.k === 'loop' ? 1 : 0) +
          [i.body, i.then, i.else, ...(i.regions ?? [])]
            .filter((x): x is R => x !== undefined)
            .reduce((m, x) => m + count(x), 0),
        0
      );
    return p.functions.reduce((n, f) => n + count(f.body as R), 0);
  };
  const points = Array.from({ length: 200 }, (_, k) => ({
    x: Math.sin(k * 12.9898 + 0.5) * 7,
  }));
  /** The same value as the loop, bit for bit, at every point. */
  const sameAsLoop = (json: Json, options: object = {}) => {
    const [on, off] = [slice(json, true, options), slice(json, false, options)];
    for (const point of points) expect(Object.is(on.run(point), off.run(point))).toBe(true);
    return on;
  };

  test('three sums, one of terms of mixed magnitude, and a product are the loop bit for bit', () => {
    const sums = [
      ['Sum', ['Divide', ['Sin', ['Multiply', 'k', 'x']], 'k'], ['Limits', 'k', 1, 3]],
      ['Sum', ['Divide', ['Power', 'x', 'k'], ['Factorial', 'k']], ['Limits', 'k', 0, 20]],
      ['Sum', ['Multiply', ['Divide', ['Power', -1, 'i'], 'i'], ['Sin', ['Multiply', 'i', 'x']]], ['Limits', 'i', 1, 100]],
      ['Product', ['Add', 'x', 'k'], ['Limits', 'k', 1, 5]],
    ];
    for (const json of sums) {
      sameAsLoop(json);
      expect(loopCount(json)).toBe(0);
    }
  });

  test('100 passes are written out, 101 are a loop; an empty range is the loop', () => {
    const sum = (hi: number, lo = 1) => ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', lo, hi]];
    expect(loopCount(sum(100))).toBe(0);
    expect(loopCount(sum(101))).toBe(1);
    expect(loopCount(sum(1, 3))).toBe(1);
    expect(slice(sum(1, 3), true).run({ x: 2 })).toBe(0);
    expect(loopCount(sum(3, 3))).toBe(0);
    for (const json of [sum(100), sum(101), sum(1, 3)]) sameAsLoop(json);
  });

  test('a term that reads no index is added once per pass', () => {
    const json = ['Sum', ['g', 'x'], ['Limits', 'i', 1, 3]];
    expect(loopCount(json)).toBe(0);
    expect(slice(json, true).run({ x: 2 })).toBe(15);
    sameAsLoop(json);
  });

  test('a condition on the index, a local of an enclosing Block, a call of the index', () => {
    for (const json of [
      ['Sum', ['If', ['Equal', ['Mod', 'i', 2], 0], ['Sin', 'x'], ['Cos', ['Multiply', 'i', 'x']]], ['Limits', 'i', 1, 4]],
      ['Block', ['Declare', 'c', 'real', ['Sin', 'x']], ['Sum', ['Multiply', 'c', 'k'], ['Limits', 'k', 1, 3]]],
      ['Sum', ['Multiply', ['g', 'k'], 'x'], ['Limits', 'k', 1, 3]],
    ]) {
      expect(loopCount(json)).toBe(0);
      sameAsLoop(json);
    }
  });

  test('a body with a draw keeps the loop, its draws and its warnings', () => {
    const json = ['WithRandomSeed', 7, ['Sum', ['Multiply', ['Random'], 'x'], ['Limits', 'k', 1, 3]]];
    expect(loopCount(json)).toBe(1);
    const [on, off] = [slice(json, true), slice(json, false)];
    for (const point of points.slice(0, 10)) expect(on.run(point)).toBe(off.run(point));
    expect(on.warnings).toEqual(off.warnings);
  });

  test('a body with a Loop, or a call of a function on a cycle of calls, keeps the loop', () => {
    const withLoop = [
      'Sum',
      [
        'Block',
        ['Declare', 's', 'real', 0],
        ['Loop', ['Assign', 's', ['Add', 's', 'j']], ['Element', 'j', ['Range', 1, 3]]],
        ['Multiply', 's', 'k', 'x'],
      ],
      ['Limits', 'k', 1, 3],
    ];
    expect(loopCount(withLoop)).toBe(2);
    sameAsLoop(withLoop);
    const recursive = ['Sum', ['Multiply', ['fact', 'k'], 'x'], ['Limits', 'k', 1, 3]];
    expect(loopCount(recursive)).toBe(1);
    sameAsLoop(recursive);
  });

  test('nested sums: the inner ones written out, and the outer when they all are', () => {
    const nest = (inner: number) => [
      'Sum',
      ['Sum', ['Multiply', 'i', 'j', 'x'], ['Limits', 'j', 1, inner]],
      ['Limits', 'i', 1, 100],
    ];
    // 100 inner sums of 100 terms would be 10,000 bodies, past the budget
    // of 4,096: the outer sum is a loop, its inner sum written out.
    expect(loopCount(nest(100))).toBe(1);
    sameAsLoop(nest(100));
    // 100 + 100 · 3 bodies.
    expect(loopCount(nest(3))).toBe(0);
    sameAsLoop(nest(3));
  });

  test('a Sum in the body of a user function is written out; a Sum over a Range is a loop', () => {
    e.assign('u', e.box(['Function', ['Sum', ['Multiply', 'k', 't'], ['Limits', 'k', 1, 3]], 't'] as never));
    const call = ['u', 'x'];
    expect(loopCount(call)).toBe(0);
    sameAsLoop(call);
    const range = ['Sum', ['Multiply', 'x', ['Range', 1, 5]]];
    expect(loopCount(range)).toBe(1);
    sameAsLoop(range);
  });

  test('an iterationBudget below the count keeps the NaN of the loop', () => {
    const json = ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 10]];
    expect(slice(json, true, { iterationBudget: 9 }).run({ x: 2 })).toBeNaN();
    sameAsLoop(json, { iterationBudget: 9 });
    // 10 passes within a budget of 10: written out.
    expect(loopCount(json, { iterationBudget: 10 })).toBe(0);
    expect(slice(json, true, { iterationBudget: 10 }).run({ x: 2 })).toBe(110);
  });

  test('a term that declines gives the loop: the If of a guarded Sqrt', () => {
    const json = ['Sum', ['If', ['Less', 'k', 0], 'x', ['Floor', ['Sqrt', 'k']]], ['Limits', 'k', -1, 3]];
    expect(loopCount(json)).toBe(1);
    sameAsLoop(json);
    for (const x of [-0.5, 0.5]) {
      const want = e.box(json as never).subs({ x }).N().re;
      expect(slice(json, true).run({ x })).toBe(want);
    }
  });

  test('a complex term of a constant index keeps the loop; an operation on it is written out', () => {
    // `Sqrt(-1)` of a constant is complex; the loop's real kernel is NaN.
    const direct = ['Sum', ['Multiply', ['Sqrt', 'k'], 'x'], ['Limits', 'k', -2, 1]];
    expect(loopCount(direct)).toBe(1);
    expect(slice(direct, true).run({ x: 0.5 })).toBeNaN();
    // A complex value inside a term whose value is real or boolean.
    for (const inner of [
      ['Sum', ['Multiply', ['Abs', ['Sqrt', 'k']], 'x'], ['Limits', 'k', -2, 1]],
      ['Sum', ['If', ['Greater', ['Abs', ['Arcsin', 'k']], 1], 'x', 1], ['Limits', 'k', 0, 3]],
      ['Sum', ['Abs', ['Add', 'x', ['Sqrt', 'k']]], ['Limits', 'k', -1, 1]],
    ]) {
      expect(loopCount(inner)).toBe(1);
      sameAsLoop(inner);
    }
    const shifted = ['Sum', ['Sqrt', ['Subtract', 'k', 2]], ['Limits', 'k', 1, 3]];
    expect(loopCount(shifted)).toBe(0);
    expect(slice(shifted, true).run({})).toBeNaN();
    sameAsLoop(shifted);
    // The complex mode keeps every loop: a real term there is complex in
    // the loop.
    const real = ['Sum', ['Sqrt', 'k'], ['Limits', 'k', 1, 3]];
    expect(loopCount(real, { mode: 'complex' })).toBe(1);
  });

  test('a decline after a user function began to be lowered is the program\'s', () => {
    e.assign('bad', e.box(['Function', ['Multiply', ['Foo', 't'], 2], 't'] as never));
    const json = ['Sum', ['Multiply', ['bad', 'k'], 'x'], ['Limits', 'k', 1, 3]];
    const message = (on: boolean) => {
      try {
        slice(json, on);
      } catch (error) {
        return (error as Error).message;
      }
      return undefined;
    };
    expect(message(true)).toMatch(/Foo is an unknown operator/);
    expect(message(true)).toBe(message(false));
  });

  test('the node limit reached in an attempt gives the loop, or the decline of the loop', () => {
    // A body of about 30,000 nodes: two of them pass the half of the limit.
    const big = (n: number) => [
      'Sum',
      ['Add', ...Array.from({ length: n }, (_, i) => ['Multiply', i + 2, 'k', ['Sin', ['Add', 'x', i + 1]]])],
      ['Limits', 'k', 1, 2],
    ];
    const fits = big(4000);
    expect(loopCount(fits)).toBe(1);
    const text = (json: Json) => compileSlice(box(json, e), { target: 'javascript', unrollSums: true } as never).code;
    expect(text(fits)).toBe(text(fits));
    // A body past the limit by itself: the loop's decline, on and off.
    const over = big(12000);
    const message = (on: boolean) => {
      try {
        slice(over, on);
      } catch (error) {
        return (error as Error).message;
      }
      return undefined;
    };
    expect(message(true)).toMatch(/more than 50000 nodes/);
    expect(message(true)).toBe(message(false));
  });

  test('a function lowered in a refused attempt keeps its bodies in the budget', () => {
    // Each helper holds a sum of 100 terms, first called in a sum with a
    // draw (a refused attempt): 45 helpers would be 4,500 bodies.
    const terms: Json[] = [];
    for (let i = 0; i < 45; i++) {
      e.assign(`hb${i}`, e.box(['Function', ['Sum', ['Multiply', 'j', ['Add', 't', i]], ['Limits', 'j', 1, 100]], 't'] as never));
      terms.push(['Sum', ['Add', [`hb${i}`, 'k'], ['Random']], ['Limits', 'k', 1, 3]]);
    }
    const json = ['Add', ...terms];
    const p = sliceProgram(box(json, e), { target: 'javascript', unrollSums: true } as never);
    const hasLoop = (r: { body: { k: string }[] }) => r.body.some((i) => i.k === 'loop');
    const helpers = p.functions.filter((f) => f.source?.startsWith('hb'));
    expect(helpers).toHaveLength(45);
    const looped = helpers.filter((f) => hasLoop(f.body)).length;
    // At most 4,096 bodies written out: 40 helpers of 100 terms.
    expect(looped).toBeGreaterThanOrEqual(5);
    expect(45 - looped).toBeLessThanOrEqual(40);
  });

  test('off by default on JavaScript, and never on GLSL', () => {
    const json = ['Sum', ['Divide', ['Sin', ['Multiply', 'k', 'x']], 'k'], ['Limits', 'k', 1, 3]];
    expect(compileSlice(box(json, e), { target: 'javascript' }).code).toMatch(/for \(/);
    expect(
      compileSlice(box(json, e), { target: 'glsl', unrollSums: true } as never).code
    ).toMatch(/for \(/);
  });
});
