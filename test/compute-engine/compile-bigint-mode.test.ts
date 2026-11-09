import { ComputeEngine, compile } from '../../src/compute-engine';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import * as diagnostics from '../../src/compute-engine/compilation/diagnostics';
import {
  bigintLaneError,
  isCompileDeclineError,
  isLaneMismatchError,
} from '../../src/compute-engine/compilation/diagnostics';
import type { StoredJavaScript } from '../../src/compute-engine/compilation/javascript-runtime';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import type {
  CompilationResult,
  CompileTarget,
  LanguageTarget,
} from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import { createJavaScriptRuntime } from '../../src/runtime';

/**
 * CE-715, step 1 of `docs/plans/2026-10-31-ce715-bigint-compile-mode.md`:
 * the plumbing of `mode: 'bigint'` on the JavaScript target.
 *
 * - `'bigint'` is a `CompileMode`, offered by the `javascript` target only;
 *   every other target declines it with `code: 'unsupported-mode'`.
 * - In the mode, the compiler latches the strict discipline
 *   (`BaseCompiler.mode` is `'strict'`, `strictLanes` is `true`,
 *   `complexDiscipline` is `false`) and the integer lane `'bigint'`
 *   (`BaseCompiler.integerLane`).
 * - An expression that the lane analysis (step 2,
 *   `compile-bigint-lane.test.ts`) rejects declines with `code:
 *   'bigint-lane'`, a `capability` decline. An expression that it accepts compiles to `bigint` code (step 3,
 *   `compile-bigint-emission.test.ts`).
 */

const ce = new ComputeEngine();
ce.declare('n', 'integer');

describe('bigint mode: targets other than javascript', () => {
  it.each(['interval-js', 'glsl', 'python'] as const)(
    "a requested 'bigint' on %s is the unsupported-mode decline",
    (to) => {
      const r = compile(ce.parse('x + 1'), { to, mode: 'bigint' });
      expect(r.success).toBe(false);
      expect(r.diagnostic!.code).toBe('unsupported-mode');
      expect(r.diagnostic!.kind).toBe('capability');
      expect(r.diagnostic!.message).toContain("'bigint'");
      expect(BaseCompiler.mode).toBe('strict');
      expect(BaseCompiler.integerLane).toBe('double');
    }
  );
});

describe('bigint mode: compilations on javascript', () => {
  it.each([
    ['an integer literal', ce.box(5), 5n],
    ['a symbol', ce.parse('n'), 3n],
    ['an integer expression', ce.parse('\\binom{2n}{n} + n!'), 26n],
  ])('%s compiles and reports the mode', (_, expr, expected) => {
    const r = compile(expr, { mode: 'bigint' });
    expect(r.success).toBe(true);
    expect(r.mode).toBe('bigint');
    expect(r.run!({ n: 3n } as never)).toBe(expected);
  });

  it('a function literal compiles', () => {
    const r = compile(
      ce.box(['Function', ['Factorial', 'k'], ['Typed', 'k', "'integer'"]]),
      { mode: 'bigint' }
    );
    expect(r.success).toBe(true);
    expect(r.mode).toBe('bigint');
    expect((r.run as unknown as (k: bigint) => bigint)(4n)).toBe(24n);
  });

  it('a decline falls back to the interpreter and reports the neutral mode', () => {
    const r = compile(ce.parse('\\sqrt{n}'), { mode: 'bigint' });
    expect(r.success).toBe(false);
    expect(r.diagnostic!.code).toBe('bigint-lane');
    expect(r.diagnostic!.kind).toBe('capability');
    expect(r.diagnostic!.message).toMatch(/mode 'bigint'/);
    // A decline reports the neutral mode: no code was emitted.
    expect(r.mode).toBe('strict');
    // The interpreter fallback still runs.
    expect(r.run).toBeDefined();
  });

  it('with fallback: false the decline is a thrown CompileDeclineError', () => {
    let caught: unknown;
    try {
      compile(ce.parse('\\sqrt{n}'), { mode: 'bigint', fallback: false });
    } catch (e) {
      caught = e;
    }
    expect(isCompileDeclineError(caught)).toBe(true);
    expect(isLaneMismatchError(caught)).toBe(false);
    expect((caught as diagnostics.CompileDeclineError).diagnostic.code).toBe(
      'bigint-lane'
    );
    expect(BaseCompiler.mode).toBe('strict');
    expect(BaseCompiler.integerLane).toBe('double');
  });

  it('an accepted expression compiles to bigint code', () => {
    const r = compile(ce.parse('n + 1'), { mode: 'bigint' });
    expect(r.success).toBe(true);
    // The wrapper of the entry converts a \`number\` input and catches a
    // pole (step 4, §3.4 and §3.5).
    expect(r.code).toBe(
      "(() => { const _tv1 = typeof _.n === 'number' ? _SYS.toBigint(_.n) : _.n; try { return (_tv1 + 1n); } catch (_tv2) { if (_tv2 instanceof _SYS.NonFiniteValue) return _tv2.value; throw _tv2; } })()"
    );
  });

  it('an expression that the lane analysis rejects declines with its reason', () => {
    const r = compile(ce.parse('\\sqrt{n}'), { mode: 'bigint' });
    expect(r.success).toBe(false);
    expect(r.diagnostic!.code).toBe('bigint-lane');
    expect(r.diagnostic!.value).toBe('sqrt(n)');
    expect(r.diagnostic!.message).toMatch(/is not on the integer lane/);
  });

  // The JavaScript target compiles an operator symbol (`Divide`) to
  // `(a, b) => a / b` without the core compiler, so it declines before
  // that shortcut. Without the decline, the code called with `5n, 2n`
  // gives `2n`. The lane analysis rejects it: it is not an integer binding.
  it('an operator symbol declines with bigint-lane', () => {
    const r = compile(ce.symbol('Divide'), { mode: 'bigint' });
    expect(r.success).toBe(false);
    expect(r.diagnostic!.code).toBe('bigint-lane');
    expect(r.diagnostic!.kind).toBe('capability');
    expect(r.diagnostic!.message).toMatch(/is not on the integer lane/);
  });

  it('an operator symbol with fallback: false throws the decline', () => {
    let caught: unknown;
    try {
      compile(ce.symbol('Divide'), { mode: 'bigint', fallback: false });
    } catch (e) {
      caught = e;
    }
    expect(isCompileDeclineError(caught)).toBe(true);
    expect((caught as diagnostics.CompileDeclineError).diagnostic.code).toBe(
      'bigint-lane'
    );
  });

  it('the operator symbol still compiles in the other modes', () => {
    const r = compile(ce.symbol('Divide'), { mode: 'strict' });
    expect(r.success).toBe(true);
    expect(r.code).toBe('(a, b) => a / b');
  });
});

describe('bigint mode: custom targets', () => {
  const jsTarget = () => new JavaScriptTarget().createTarget();

  // The declared mode is valid, so the target passes validation and compiles
  // in its other modes; a `'bigint'` request on it declines.
  it("a custom target that declares 'bigint' compiles in strict and declines 'bigint'", () => {
    const target = () =>
      ({
        ...jsTarget(),
        supportedModes: ['strict', 'bigint'],
      }) as CompileTarget<Expression>;
    const strict = compile(ce.parse('n + 1'), {
      target: target(),
      mode: 'strict',
    });
    expect(strict.success).toBe(true);
    const r = compile(ce.parse('n + 1'), { target: target(), mode: 'bigint' });
    expect(r.success).toBe(false);
    expect(r.diagnostic!.code).toBe('unsupported-mode');
  });

  // A copy of the built-in target made with object spread keeps its
  // emitters. When the copy replaces `operators` or `functions`, the
  // replaced emitters compute with doubles, so the copy does not offer
  // `'bigint'`.
  it.each([
    ['operators', { operators: () => undefined }],
    ['functions', { functions: () => undefined }],
  ])(
    "a spread of the built-in target with replaced %s declines 'bigint' with unsupported-mode",
    (_, replaced) => {
      const target = {
        ...jsTarget(),
        ...replaced,
      } as CompileTarget<Expression>;
      const r = compile(ce.parse('n + 1'), { target, mode: 'bigint' });
      expect(r.success).toBe(false);
      expect(r.diagnostic!.code).toBe('unsupported-mode');
    }
  );

  it("a plain spread of the built-in target compiles 'bigint'", () => {
    const target = { ...jsTarget() } as CompileTarget<Expression>;
    const r = compile(ce.parse('n + 1'), { target, mode: 'bigint' });
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      "(() => { const _tv1 = typeof n === 'number' ? _SYS.toBigint(n) : n; try { return (_tv1 + 1n); } catch (_tv2) { if (_tv2 instanceof _SYS.NonFiniteValue) return _tv2.value; throw _tv2; } })()"
    );
  });

  // A per-call `operators` or `functions` option replaces the emission of a
  // head with caller code that computes with doubles. The built-in target
  // still offers `'bigint'`; the lane analysis declines only an expression
  // that uses a replaced head.
  it.each([
    ['operators', { operators: { Add: ['+', 11] } }],
    ['operators (function form)', { operators: (op: string) => (op === 'Add' ? ['+', 11] : undefined) }],
    ['functions', { functions: { Add: (a: number, b: number) => a + b } }],
  ] as const)(
    "a per-call %s option that replaces a head of the expression declines with bigint-lane",
    (_, replaced) => {
      const r = compile(ce.parse('n + 1'), {
        mode: 'bigint',
        ...(replaced as object),
      });
      expect(r.success).toBe(false);
      expect(r.diagnostic!.code).toBe('bigint-lane');
      expect(r.diagnostic!.message).toMatch(
        /the caller replaced the compilation of `Add`/
      );
    }
  );

  it('a per-call operators option that replaces another head keeps the mode', () => {
    const r = compile(ce.parse('n + 1'), {
      mode: 'bigint',
      operators: { Multiply: ['*', 12] },
    });
    expect(r.success).toBe(true);
    expect(r.mode).toBe('bigint');
    expect(r.run!({ n: 2n } as never)).toBe(3n);
  });

  // A `vars` entry that names a user function is given as a `functions`
  // entry (`withVarsMappedUserFunctionHeads`): a call of that function
  // declines, and an expression that does not call it keeps the mode.
  it('a vars entry mapped to a user function head declines only its calls', () => {
    const engine = new ComputeEngine();
    engine.declare('n', 'integer');
    engine.declare('g', '(integer) -> integer');
    engine.box(['Assign', 'g', ['Function', ['Add', 'x', 1], 'x']]).evaluate();
    const calls = compile(engine.box(['g', 'n']), {
      mode: 'bigint',
      vars: { g: '_.g' },
    });
    expect(calls.diagnostic!.code).toBe('bigint-lane');
    expect(calls.diagnostic!.message).toMatch(
      /the caller replaced the compilation of `g`/
    );
    const other = compile(engine.parse('n + 1'), {
      mode: 'bigint',
      vars: { g: '_.g' },
    });
    expect(other.success).toBe(true);
    expect(other.mode).toBe('bigint');
  });

  // A custom compilation target registered on the engine builds its own
  // targets in its `compile()`, so the option validator never sees them.
  // `resolveCompileMode` refuses `'bigint'` for them: the `supportedModes`
  // array that lists it is not the array of a target that the built-in
  // JavaScript target registered.
  it("a registered custom target that lists 'bigint' gives unsupported-mode", () => {
    const engine = new ComputeEngine();
    const builtIn = new JavaScriptTarget();
    const custom: LanguageTarget<Expression> = {
      getOperators: () => builtIn.getOperators(),
      getFunctions: () => builtIn.getFunctions(),
      createTarget: (o = {}) => ({
        ...jsTarget(),
        ...o,
        supportedModes: ['strict', 'bigint'],
      }),
      compile(expr, options = {}) {
        const target = this.createTarget({ mode: options.mode });
        return {
          target: 'bigint-test',
          success: true,
          code: BaseCompiler.compileRoot(expr, target),
        } as CompilationResult;
      },
    };
    engine.registerCompilationTarget('bigint-test', custom);
    let caught: unknown;
    try {
      compile(engine.parse('n + 1'), {
        to: 'bigint-test',
        mode: 'bigint',
        fallback: false,
      });
    } catch (e) {
      caught = e;
    }
    expect(isCompileDeclineError(caught)).toBe(true);
    expect((caught as diagnostics.CompileDeclineError).diagnostic.code).toBe(
      'unsupported-mode'
    );
    // The message does not list 'bigint' among the offered modes.
    expect((caught as Error).message).toContain("(offered: 'strict')");
    expect(BaseCompiler.integerLane).toBe('double');
  });

  it("the built-in javascript target passed directly with mode 'bigint' compiles", () => {
    const r = compile(ce.parse('n + 1'), {
      target: jsTarget(),
      mode: 'bigint',
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      "(() => { const _tv1 = typeof n === 'number' ? _SYS.toBigint(n) : n; try { return (_tv1 + 1n); } catch (_tv2) { if (_tv2 instanceof _SYS.NonFiniteValue) return _tv2.value; throw _tv2; } })()"
    );
  });
});

describe('bigint mode: the latches during and after a compilation', () => {
  afterEach(() => jest.restoreAllMocks());

  // The latches are observed from inside the compilation: the bigint
  // emitter declines the constant `Fibonacci(10^9)`, which the interpreter
  // leaves unevaluated, with `bigintLaneError` after the latches are
  // written, and the spy reads them there.
  it('is the strict discipline plus the bigint integer lane', () => {
    const original = diagnostics.bigintLaneError;
    const seen: Array<Record<string, unknown>> = [];
    jest.spyOn(diagnostics, 'bigintLaneError').mockImplementation((p) => {
      seen.push({
        mode: BaseCompiler.mode,
        strictLanes: BaseCompiler.strictLanes,
        complexDiscipline: BaseCompiler.complexDiscipline,
        promotionActive: BaseCompiler.promotionActive,
        integerLane: BaseCompiler.integerLane,
      });
      return original(p);
    });
    const r = compile(ce.box(['Fibonacci', ['Power', 10, 9]]), {
      mode: 'bigint',
    });
    expect(r.success).toBe(false);
    expect(seen).toEqual([
      {
        mode: 'strict',
        strictLanes: true,
        complexDiscipline: false,
        promotionActive: false,
        integerLane: 'bigint',
      },
    ]);
    // Restored after the decline.
    expect(BaseCompiler.mode).toBe('strict');
    expect(BaseCompiler.integerLane).toBe('double');
  });

  it('a later compilation in another mode does not see the bigint lane', () => {
    compile(ce.parse('n + 1'), { mode: 'bigint' });
    const seen = new Set<string>();
    for (const mode of [undefined, 'strict', 'complex'] as const) {
      const r = compile(ce.parse('x + 1'), {
        mode,
        operators: (op) => {
          if (op === 'Add') seen.add(BaseCompiler.integerLane);
          return undefined;
        },
      });
      expect(r.success).toBe(true);
    }
    expect(seen).toEqual(new Set(['double']));
  });
});

describe('bigint mode: the strict default is unchanged', () => {
  it("a plain compile resolves to 'strict' and reports mode 'strict'", () => {
    const modes = new Set<string>();
    const r = compile(ce.parse('2x + 1'), {
      operators: (op) => {
        if (op === 'Add') modes.add(BaseCompiler.mode);
        return undefined;
      },
    });
    expect(r.success).toBe(true);
    // The default mode `'strict'` is latched during the compilation proper,
    // and it is also the resting value of the static outside it.
    expect(modes).toEqual(new Set(['strict']));
    expect(r.mode).toBe('strict');
    expect(r.run!({ x: 3 })).toBe(7);
  });
});

describe('the bigint-lane diagnostic', () => {
  it('has the code bigint-lane, the kind capability, and names the node', () => {
    const e = bigintLaneError({
      node: 'Sqrt(n)',
      type: 'complex',
      reason: 'its type is not an integer type',
    });
    expect(isCompileDeclineError(e)).toBe(true);
    expect(e.name).toBe('CompileDeclineError');
    expect(e.diagnostic).toEqual({
      code: 'bigint-lane',
      kind: 'capability',
      message:
        "Could not compile in mode 'bigint': `Sqrt(n)` (type `complex`) is not on the integer lane: its type is not an integer type.",
      value: 'Sqrt(n)',
    });
    expect(e.message).toBe(e.diagnostic.message);
  });

  it('is not a lane mismatch', () => {
    const e = bigintLaneError({ node: 'n', type: 'integer', reason: 'test' });
    expect(isLaneMismatchError(e)).toBe(false);
  });
});

describe('the stored artifact records the mode', () => {
  it('the result mode is a field of the stored code, kept by a copy', () => {
    const r = compile(ce.parse('2x + 1'));
    expect(r.success).toBe(true);
    const stored: StoredJavaScript = JSON.parse(JSON.stringify(r));
    expect(stored.mode).toBe('strict');
    const f = createJavaScriptRuntime().load(stored);
    expect(f({ x: 3 })).toBe(7);
    // The field is recorded whatever the entry checks are.
    const unchecked = compile(ce.parse('2x + 1'), { entryChecks: false });
    expect(unchecked.mode).toBe('strict');
    const complex = compile(ce.parse('2x + 1'), { mode: 'complex' });
    const storedComplex: StoredJavaScript = JSON.parse(
      JSON.stringify(complex)
    );
    expect(storedComplex.mode).toBe('complex');
  });

  it("the stored field admits 'bigint'", () => {
    const stored: StoredJavaScript = { code: '1n', mode: 'bigint' };
    expect(stored.mode).toBe('bigint');
  });

  it('code compiled in the bigint mode runs the same after load()', () => {
    const r = compile(ce.parse('\\binom{2n}{n} + n!'), { mode: 'bigint' });
    const stored: StoredJavaScript = JSON.parse(JSON.stringify(r));
    expect(stored.mode).toBe('bigint');
    const f = createJavaScriptRuntime().load(stored);
    expect(f({ n: 30n } as never)).toBe(r.run!({ n: 30n } as never));
  });
});
