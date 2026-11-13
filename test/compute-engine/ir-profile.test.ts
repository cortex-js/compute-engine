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
    expect(ir.code).toMatch(/^\(_\) => \{/);
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
      shippable: false,
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
    ['vars', { vars: { x: '_.y' } }],
    ['operators', { operators: { Add: ['+', 11] } }],
    ['operators', { operators: () => undefined }],
    ['imports', { imports: [() => 1] }],
    ['preamble', { preamble: 'const k = 1;' }],
    ['mode', { mode: 'bigint' }],
    ['broadcast', { broadcast: true }],
    ['strictTypes', { strictTypes: true }],
  ];
  test.each(OPTIONS)('of the option %s names it', (name, options) => {
    const o = outcome(box(['Add', ['At', 'L', 1], 'x']), options);
    expect('diagnostic' in o && o.diagnostic.code).toBe('outside-profile');
    expect('message' in o && o.message).toContain(`the option \`${name}\``);
  });
  test('of iterationBudget with a Sum names it, and without a loop the option is admitted', () => {
    const o = outcome(box(['Sum', 'k', ['Limits', 'k', 1, 'n']]), {
      iterationBudget: 10,
    });
    expect('message' in o && o.message).toContain(
      'the option `iterationBudget` with a counted loop'
    );
    // A reduction of a list is a counted loop too.
    const m = outcome(box(['Max', ['Range', 1, 'n']]), { iterationBudget: 10 });
    expect('message' in m && m.message).toContain('a counted loop');
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
    expect(() => run(2, 3, 1)).toThrow(/The input `L` is not an array/);
    expect(() => run({ re: 1, im: 1 } as never, [1], 1)).toThrow(
      /The input `a` is not a real/
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
  test('the entry check refuses a value that is not an array for a list input', () => {
    const r = compile(box(['At', 'L', 1]), IR);
    expect(r.run!({ L: [5, 6, 7] } as never)).toBe(5);
    expect(() => r.run!({ L: '12' } as never)).toThrow(/`L` is not an array/);
  });
  test('an integer of 2^53 or more in an exact operation declines', () => {
    // In doubles 2^60 + 1 is 2^60, so `Mod` gives 1; the interpreter gives 2.
    const o = outcome(box(['Mod', ['Add', ['Power', 2, 60], 'n'], 3]));
    expect('message' in o && o.message).toMatch(/2\^53 or more/);
    // Closed, it is the interpreter's value.
    const closed = compile(box(['Mod', ['Add', ['Power', 2, 60], 1], 3]), IR);
    expect(closed.run!({})).toBe(2);
  });
  test('an operator with no definition is named as unknown', () => {
    const o = outcome(box(['Quotient', 'n', 3]));
    expect('message' in o && o.message).toMatch(/unknown operator/);
  });
  test('the entry check refuses a complex value for a real input', () => {
    const r = compile(box(['Add', 'x', 1]), IR);
    expect(() => r.run!({ x: { re: 1, im: 2 } } as never)).toThrow(
      /`x` is not a real number/
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
