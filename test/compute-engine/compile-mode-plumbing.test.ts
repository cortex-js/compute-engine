import { ComputeEngine, compile } from '../../src/compute-engine';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { resetDeprecationWarnings } from '../../src/compute-engine/compilation/deprecation-warnings';
import {
  CompileDeclineError,
  LaneMismatchError,
  isCompileDeclineError,
  isLaneMismatchError,
} from '../../src/compute-engine/compilation/diagnostics';
import type {
  CompileTarget,
  CompileMode,
} from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';

/**
 * Compile-mode migration, step 1 — PLUMBING
 * (`docs/COMPILATION-MODEL.md`, step 1).
 *
 * What this step delivers, and what these tests pin:
 * - the `mode` option is accepted end to end (option → target →
 *   `BaseCompiler.mode`, latched once at the outermost compilation), with the
 *   effective-mode resolution of §5 and the unsupported-mode `capability`
 *   decline;
 * - the `LaneMismatchError` / `CompileDeclineError` classes and the
 *   `CompileDiagnostic` payload, and the `mode` / `promoted` / `diagnostic`
 *   result fields (`mode: 'strict'`, `promoted: false` until later steps);
 * - the D7 fixes in the shared interpreter fallback: a `{re, im}` `vars` value
 *   is declared complex, and the result follows the runner's convention;
 * - the result convention (§5): the transcendental `_SYS` kernels chop their
 *   own roundoff dust, and the runner tests `im !== 0` EXACTLY — a real value
 *   is a plain `number`, a `ComplexResult` always has `im !== 0`;
 * - the internal callers of the (since removed) `realOnly` option, migrated to
 *   a local numeric projection.
 *
 * Migration step 4 (2026-08-16) landed the `auto` default on `javascript` and
 * `python`: the pins below that used to read "accepted but compiled as
 * `strict`" now read the shipped behavior — `auto` promotes an unknown-sign
 * radical and escalates once to `complex` at a wide binding, and
 * `complexPromotion: true` is deprecated to `mode: 'complex'`. A test whose
 * subject is the non-promoting discipline passes `mode: 'strict'` explicitly.
 */

/** A minimal direct custom target (the RPN shape of `compile-plugin.test.ts`). */
function customTarget(
  extra: Partial<CompileTarget<Expression>> = {}
): CompileTarget<Expression> {
  return {
    language: 'custom-test',
    operators: (op) =>
      (
        ({
          Add: ['+', 11],
          Multiply: ['*', 12],
        }) as Record<string, [string, number]>
      )[op],
    functions: () => undefined,
    var: (id) => id,
    string: (s) => JSON.stringify(s),
    number: (n) => n.toString(),
    indent: 0,
    ws: (s?: string) => s ?? '',
    preamble: '',
    ...extra,
  };
}

describe('compile mode — option surface (step 1)', () => {
  const ce = new ComputeEngine();

  it('accepts every mode value and reports mode/promoted on the result', () => {
    for (const mode of ['strict', 'complex', 'auto'] as const) {
      const r = compile(ce.parse('2x + 1'), { mode });
      expect(r.success).toBe(true);
      // `2x + 1` has no promotable head, so `auto` reports the mode of its
      // first (strict) attempt; only an explicit `complex` reports 'complex'.
      expect(r.mode).toBe(mode === 'complex' ? 'complex' : 'strict');
      expect(r.promoted).toBe(false);
      expect(r.escalation).toBeUndefined();
      expect(r.diagnostic).toBeUndefined();
      expect(r.run!({ x: 3 })).toBe(7);
    }
  });

  it('strict and auto compile the same code when nothing promotes', () => {
    const plain = ce.parse('2x + 1');
    const plainStrict = compile(plain, { mode: 'strict' }).code;
    expect(compile(plain, { mode: 'auto' }).code).toBe(plainStrict);
    expect(compile(plain).code).toBe(plainStrict);
    // With a promotable head the two lanes part: the default `auto` promotes
    // the unknown-sign radical (compile-mode step 4, 2026-08-16), `strict`
    // keeps the real kernel.
    const expr = ce.parse('\\sqrt{x} + 2x');
    expect(compile(expr, { mode: 'strict' }).code).toContain('Math.sqrt');
    const auto = compile(expr, { mode: 'auto' });
    expect(auto.code).toContain('_SYS.csqrt');
    expect(auto.promoted).toBe(true);
    expect(compile(expr).code).toBe(auto.code);
    // Complex mode promotes the radical and lifts the wide `x`.
    expect(compile(expr, { mode: 'complex' }).code).toContain('_SYS.csqrt');
  });

  it('rejects an invalid mode value at option validation (thrown, not a fallback)', () => {
    expect(() =>
      compile(ce.parse('x'), { mode: 'real' as unknown as CompileMode })
    ).toThrow(/Invalid compilation option "mode"/);
  });

  it('a mode the target does not offer is a capability decline, never a silent coercion', () => {
    for (const to of ['glsl', 'wgsl', 'interval-js'] as const) {
      for (const mode of ['complex', 'auto'] as const) {
        const r = compile(ce.parse('x + 1'), { to, mode });
        expect(r.success).toBe(false);
        expect(r.diagnostic).toBeDefined();
        expect(r.diagnostic!.code).toBe('unsupported-mode');
        expect(r.diagnostic!.kind).toBe('capability');
        expect(r.diagnostic!.message).toContain(`'${mode}'`);
        // The human-readable `error` stays a string beside it.
        expect(typeof r.error).toBe('string');
        expect(r.error).toBe(r.diagnostic!.message);
        // …and the interpreter-backed fallback still runs.
        expect(r.run).toBeDefined();
      }
      // `strict` is offered everywhere.
      const ok = compile(ce.parse('x + 1'), { to, mode: 'strict' });
      expect(ok.success).toBe(true);
      expect(ok.mode).toBe('strict');
    }
  });

  it('with fallback: false the unsupported-mode decline is a thrown CompileDeclineError', () => {
    let caught: unknown;
    try {
      compile(ce.parse('x'), { to: 'glsl', mode: 'complex', fallback: false });
    } catch (e) {
      caught = e;
    }
    expect(isCompileDeclineError(caught)).toBe(true);
    expect((caught as CompileDeclineError).diagnostic.code).toBe(
      'unsupported-mode'
    );
    expect(isLaneMismatchError(caught)).toBe(false);
  });

  it('a generic fail-closed decline carries a capability diagnostic beside error', () => {
    const e = new ComputeEngine();
    e.declare('z', 'complex');
    // `Erf` has a real-only helper: a complex-typed operand fails closed (D6).
    // Pinned in `strict`: under the default `auto` a MAYBE-complex operand
    // takes the D2/D6 runtime rule and compiles (compile-mode step 4,
    // 2026-08-16); the compile-time decline is the strict-lane behavior.
    const r = compile(e.box(['Erf', 'z']), { mode: 'strict' });
    expect(r.success).toBe(false);
    expect(r.diagnostic).toEqual({
      code: 'compile-error',
      kind: 'capability',
      message: r.error,
    });
    expect(r.mode).toBe('strict');
    expect(r.promoted).toBe(false);
  });
});

describe('compile mode — effective-mode resolution (step 1)', () => {
  const ce = new ComputeEngine();

  /**
   * `BaseCompiler.mode` is the latched mode of the compilation in progress.
   * Observed from INSIDE a compilation through the function-form `operators`
   * option, which the JavaScript target consults for every operator head —
   * during the compilation proper (where the latch holds) and also outside
   * it (the CSE purity gate before, the reference analysis after, where the
   * static reads its resting value `'strict'`). The witness is therefore the
   * SET of modes observed for the `Add` head: the requested mode must appear
   * in it, and no third value may.
   */
  function observedModes(
    expr: Expression,
    options: Parameters<typeof compile>[1] = {}
  ): Set<CompileMode> {
    const seen = new Set<CompileMode>();
    const r = compile(expr, {
      ...options,
      operators: (op) => {
        if (op === 'Add') seen.add(BaseCompiler.mode);
        return undefined;
      },
    });
    expect(r.success).toBe(true);
    return seen;
  }

  it('javascript defaults to auto; an explicit mode is latched as requested', () => {
    const expr = ce.parse('x + 1');
    expect(observedModes(expr)).toEqual(new Set(['strict', 'auto']));
    expect(observedModes(expr, { mode: 'strict' })).toEqual(
      new Set(['strict'])
    );
    expect(observedModes(expr, { mode: 'complex' })).toEqual(
      new Set(['strict', 'complex'])
    );
    expect(observedModes(expr, { mode: 'auto' })).toEqual(
      new Set(['strict', 'auto'])
    );
  });

  it('an unsupported-mode decline leaves both latches restored (thrown before the try/finally)', () => {
    // The mode is resolved BEFORE `_complexPromotion`/`_mode` are written:
    // the decline throws outside the try/finally that restores them, so a
    // latch mutated ahead of the resolution would stay stuck.
    const glsl = ce._getCompilationTarget('glsl')!.createTarget();
    expect(() =>
      compile(ce.parse('x'), {
        target: glsl,
        mode: 'complex',
        complexPromotion: true,
        fallback: false,
      })
    ).toThrow(/not offered/);
    expect(BaseCompiler.mode).toBe('strict');
    expect(BaseCompiler.complexPromotion).toBe(false);
  });

  it('is strict outside any compilation, and restored after one', () => {
    expect(BaseCompiler.mode).toBe('strict');
    compile(ce.parse('x + 1'), { mode: 'complex' });
    expect(BaseCompiler.mode).toBe('strict');
  });

  it('a direct custom target with no declaration offers strict only', () => {
    const t = customTarget();
    const r = compile(ce.parse('x + 1'), { target: t });
    expect(r.success).toBe(true);
    expect(r.code).toBe('x + 1');
    expect(r.mode).toBe('strict');
    // Its resolved mode is stamped on the target per call.
    expect(t.mode).toBe('strict');
    // A requested mode it does not declare is the capability decline.
    const declined = compile(ce.parse('x + 1'), { target: t, mode: 'complex' });
    expect(declined.success).toBe(false);
    expect(declined.diagnostic!.code).toBe('unsupported-mode');
  });

  it("a direct target declaring 'auto' without reset() resolves auto to strict; with reset() it offers auto", () => {
    const hooks = {
      supportedModes: ['strict', 'complex', 'auto'] as const,
      complexLift: (c: string) => `lift(${c})`,
      complexIsReal: (c: string) => `isreal(${c})`,
    };
    const noReset = customTarget({ ...hooks });
    // Nothing requested: `auto` is declared but not offered → strict.
    compile(ce.parse('x + 1'), { target: noReset });
    expect(noReset.mode).toBe('strict');
    // Requested `auto`, declared but not offered → strict, not a decline.
    const r = compile(ce.parse('x + 1'), { target: noReset, mode: 'auto' });
    expect(r.success).toBe(true);
    expect(noReset.mode).toBe('strict');
    // `complex` needs only the two lowering hooks.
    compile(ce.parse('x + 1'), { target: noReset, mode: 'complex' });
    expect(noReset.mode).toBe('complex');

    const withReset = customTarget({ ...hooks, reset: () => {} });
    compile(ce.parse('x + 1'), { target: withReset });
    expect(withReset.mode).toBe('auto');
    // A reused direct target does NOT inherit the previous call's explicit
    // mode: an omitted option resets to the target's default (the
    // `constantFold`/`complexPromotion` stamping pattern).
    compile(ce.parse('x + 1'), { target: withReset, mode: 'strict' });
    expect(withReset.mode).toBe('strict');
    compile(ce.parse('x + 1'), { target: withReset });
    expect(withReset.mode).toBe('auto');
  });

  it("a direct target declaring 'complex' or 'auto' without the lowering hooks is rejected at option validation", () => {
    for (const declared of [
      ['strict', 'complex'],
      ['strict', 'auto'],
    ] as const) {
      const bad = customTarget({ supportedModes: declared });
      expect(() => compile(ce.parse('x + 1'), { target: bad })).toThrow(
        /complexLift\(\).*complexIsReal\(\)/
      );
    }
    // A malformed declaration is rejected too.
    expect(() =>
      compile(ce.parse('x + 1'), {
        target: customTarget({
          supportedModes: ['strict', 'real'] as unknown as CompileMode[],
        }),
      })
    ).toThrow(/supportedModes/);
  });

  it('a built-in target passed directly declares all three modes with its hooks, and defaults to strict there (no reset)', () => {
    const jsRaw = new JavaScriptTarget().createTarget();
    expect(jsRaw.supportedModes).toEqual(['strict', 'complex', 'auto']);
    expect(jsRaw.complexLift!('v')).toBe('_SYS.cplx(v)');
    expect(jsRaw.complexIsReal!('v')).toBe('_SYS.cisreal(v)');
    const r = compile(ce.parse('x + 1'), { target: jsRaw });
    expect(r.success).toBe(true);
    expect(jsRaw.mode).toBe('strict');
  });
});

describe('LaneMismatchError / CompileDeclineError (step 1: the classes)', () => {
  it('carries the structured payload with kind correctness and a default message naming the fix', () => {
    const e = new LaneMismatchError({
      boundary: 'user-function parameter',
      binding: 'the parameter `x` of `b`',
      value: 'z',
    });
    expect(e.name).toBe('LaneMismatchError');
    expect(e.diagnostic.code).toBe('lane-mismatch');
    expect(e.diagnostic.kind).toBe('correctness');
    expect(e.diagnostic.boundary).toBe('user-function parameter');
    expect(e.diagnostic.binding).toBe('the parameter `x` of `b`');
    expect(e.diagnostic.value).toBe('z');
    expect(e.message).toContain("mode: 'complex'");
    expect(e.message).toBe(e.diagnostic.message);
    expect(isCompileDeclineError(e)).toBe(true);
    expect(isLaneMismatchError(e)).toBe(true);
  });

  it('identity is name-keyed, never instanceof (cross-bundle safe)', () => {
    const lookalike = Object.assign(new Error('x'), {
      name: 'LaneMismatchError',
      diagnostic: { code: 'lane-mismatch', kind: 'correctness', message: 'x' },
    });
    expect(lookalike instanceof LaneMismatchError).toBe(false);
    expect(isLaneMismatchError(lookalike)).toBe(true);
    expect(isCompileDeclineError(new Error('plain'))).toBe(false);
  });
});

describe('result convention (design §5) — exact im !== 0 at the boundary, kernels chop their own dust', () => {
  const ce = new ComputeEngine();

  it('arcsin(0.5) is the NUMBER 0.5235…, not {re, im: 5.55e-17}', () => {
    // The bounded inverse-trig heads type complex for a REAL-typed argument
    // of unknown magnitude, so an in-domain call goes through `_SYS.casin`,
    // whose raw result carries `im: 5.55e-17` of formulation dust. (An
    // untyped `x` keeps `Math.asin` — its type is wide, not real.)
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const r = compile(ce.parse('\\arcsin(x)'));
    expect(r.code).toContain('_SYS.casin(');
    const v = r.run!({ x: 0.5 });
    expect(typeof v).toBe('number');
    expect(v).toBeCloseTo(Math.asin(0.5), 15);
    // …and an out-of-domain call is a genuine complex value.
    const w = r.run!({ x: 2 }) as { re: number; im: number };
    expect(typeof w).toBe('object');
    expect(w.im).not.toBe(0);
  });

  it('1 + 1e-12i stays {re: 1, im: 1e-12}: no chop in ring arithmetic', () => {
    const r = compile(
      ce.box(['Add', 1, ['Multiply', 1e-12, 'ImaginaryUnit']]),
      { constantFold: false }
    );
    expect(r.run!({})).toEqual({ re: 1, im: 1e-12 });
  });

  it('a returned ComplexResult always has im !== 0; a real value is never {re, im: 0}', () => {
    // A complex-typed input whose value happens to be real.
    const e = new ComputeEngine();
    e.declare('z', 'complex');
    const r = compile(e.parse('z^2 + z'));
    expect(r.run!({ z: { re: 2, im: 0 } })).toBe(6);
    expect(r.run!({ z: { re: 1, im: 2 } })).toEqual({ re: -2, im: 6 });
    // (A plain NUMBER handed to a complex-typed symbol is the D3 entry lift
    // of migration step 2, not this step.)
    // Element by element for a collection result.
    const l = compile(e.parse('[z, 2z]'));
    expect(l.run!({ z: { re: 1, im: 0 } })).toEqual([1, 2]);
    expect(l.run!({ z: { re: 0, im: 1 } })).toEqual([
      { re: 0, im: 1 },
      { re: 0, im: 2 },
    ]);
  });

  it('booleans are never coerced', () => {
    expect(compile(ce.parse('x < 3')).run!({ x: 1 })).toBe(true);
    for (const mode of ['strict', 'complex', 'auto'] as const)
      expect(compile(ce.parse('x < 3'), { mode }).run!({ x: 5 })).toBe(false);
  });

  it('√4 is 2 and √(−2) is {re: 0, im: 1.414…}', () => {
    expect(compile(ce.parse('\\sqrt{x}')).run!({ x: 4 })).toBe(2);
    expect(compile(ce.parse('\\sqrt{-2}')).run!({})).toEqual({
      re: 0,
      im: Math.SQRT2,
    });
  });

  it('the removed realOnly option no longer projects the result', () => {
    const e = new ComputeEngine();
    // The removal warning fires once per PROCESS, so an earlier case (here or
    // in another file sharing this module registry) would otherwise starve the
    // assertion below of its message.
    resetDeprecationWarnings();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // The default `auto` promotes the unknown-sign radical (compile-mode
      // step 4, 2026-08-16). The projection that used to turn the promoted
      // `√(−4)` into `NaN` and the boolean `x < 3` into `NaN` is gone: both
      // now come back in the runner's own convention.
      // @ts-expect-error — `realOnly` was removed from the compile options.
      const r = compile(e.parse('\\sqrt{x}'), { realOnly: true });
      expect(r.run({ x: 4 })).toBe(2);
      expect(r.run({ x: -4 })).toEqual({ re: 0, im: 2 });
      // @ts-expect-error — `realOnly` was removed from the compile options.
      expect(compile(e.parse('x < 3'), { realOnly: true }).run({ x: 1 })).toBe(
        true
      );
      // …and the caller is told, once, rather than silently losing it.
      expect(
        warn.mock.calls.filter((c) => String(c[0]).includes('realOnly')).length
      ).toBeGreaterThan(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('complexPromotion still promotes, now as the deprecated spelling of mode: complex', () => {
    const e = new ComputeEngine();
    const r = compile(e.parse('\\sqrt{x}'), { complexPromotion: true });
    expect(r.code).toContain('csqrt');
    expect(r.run!({ x: -4 })).toEqual({ re: 0, im: 2 });
    // …and a promoted real value comes back as a number (dust chopped).
    expect(r.run!({ x: 4 })).toBe(2);
    // `complexPromotion: true` now maps to `mode: 'complex'` (compile-mode
    // step 4, 2026-08-16), so the wide `x` is lifted at run time and the
    // report names the complex lane.
    expect(r.code).toContain('_SYS.cplx(_.x)');
    expect(r.mode).toBe('complex');
  });
});

describe('D7 — the shared interpreter fallback honors the runner contract in both directions', () => {
  it('a {re, im} vars value is declared complex and the result is a ComplexResult (or a number when real)', () => {
    const e = new ComputeEngine();
    e.declare('z', 'complex');
    // `Erf` fails closed on a complex-typed operand → interpreter fallback.
    // `strict` keeps that decline: under the default `auto` the operand is
    // only MAYBE complex and the D2/D6 runtime rule compiles it instead
    // (compile-mode step 4, 2026-08-16).
    const r = compile(e.box(['Add', ['Erf', 'z'], 'z']), {
      fallback: true,
      mode: 'strict',
    });
    expect(r.success).toBe(false);
    expect(r.diagnostic!.kind).toBe('capability');
    // A real value handed as `{re, im: 0}` and as a number: erf(0.5) + 0.5.
    const real = r.run!({ z: { re: 0.5, im: 0 } });
    expect(typeof real).toBe('number');
    expect(real).toBeCloseTo(1.0204998778130465, 12);
    expect(r.run!({ z: 0.5 })).toBeCloseTo(1.0204998778130465, 12);
    // A genuinely complex value: erf(i) + i has a non-zero imaginary part.
    const c = r.run!({ z: { re: 0, im: 1 } }) as { re: number; im: number };
    expect(typeof c).toBe('object');
    expect(c.im).toBeCloseTo(1 + 1.650425758797543, 6);
  });

  it('a boolean-valued decline runs to a boolean, not NaN', () => {
    const e = new ComputeEngine();
    e.declare('z', 'complex');
    // `Erf(z)` declines in `strict`; the comparison over it is boolean-valued.
    const r = compile(e.box(['Less', ['Erf', 'z'], 1]), {
      fallback: true,
      mode: 'strict',
    });
    expect(r.success).toBe(false);
    expect(r.run!({ z: 0.2 })).toBe(true);
  });

  it('a lambda decline boxes a {re, im} positional argument as a complex number', () => {
    const e = new ComputeEngine();
    // Bodies with an unbound free symbol are declined on the lambda route
    // (there is no vars object to bind it to) → interpreter fallback with the
    // positional calling convention.
    const r = compile(e.box(['Function', ['Add', 'q', 'w'], 'q']), {
      fallback: true,
    });
    expect(r.success).toBe(false);
    expect(r.calling).toBe('lambda');
    e.assign('w', 1);
    expect(r.run!({ re: 1, im: 2 } as never)).toEqual({ re: 2, im: 2 });
    expect(r.run!(3 as never)).toBe(4);
  });
});

describe('internal realOnly callers migrated to a local numeric projection', () => {
  // The full behavior is pinned by `find-fit.test.ts` and
  // `differential-equations.test.ts`; this is the smoke witness that the
  // migrated call site (`implicitCompileNumeric`) still drives a fit.
  it('nonlinear fit still fits through the compiled numeric projection', () => {
    const e = new ComputeEngine();
    const r = e
      .box([
        'FindFit',
        [
          'List',
          ['Tuple', 0, 1],
          ['Tuple', 1, 3],
          ['Tuple', 2, 5],
          ['Tuple', 3, 7],
        ],
        ['Add', ['Multiply', 'a', 'x'], 'b'],
        ['List', 'a', 'b'],
        'x',
      ] as never)
      .evaluate();
    const s = r.toString();
    expect(s).toContain('"converged" -> "True"');
    expect(s).toMatch(/"a" -> 1\.99999/);
  });
});
