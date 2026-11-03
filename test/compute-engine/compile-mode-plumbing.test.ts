import { ComputeEngine, compile } from '../../src/compute-engine';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
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
 *   `CompileDiagnostic` payload, and the `mode` / `diagnostic` result
 *   fields;
 * - the D7 fixes in the shared interpreter fallback: a `{re, im}` `vars` value
 *   is declared complex, and the result follows the runner's convention;
 * - the result convention (§5): the transcendental `_SYS` kernels chop their
 *   own roundoff dust, and the runner tests `im !== 0` EXACTLY — a real value
 *   is a plain `number`, a `ComplexResult` always has `im !== 0`;
 * - the internal callers of the (since removed) `realOnly` option, migrated to
 *   a local numeric projection.
 *
 * `'strict'` is the default mode of every target: an unknown-sign radical
 * stays on the real lane, and only `mode: 'complex'` promotes it. The mode
 * `'auto'` was removed; a request for it is the `unsupported-mode` decline.
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

  it('accepts every mode value and reports the mode on the result', () => {
    for (const mode of ['strict', 'complex'] as const) {
      const r = compile(ce.parse('2x + 1'), { mode });
      expect(r.success).toBe(true);
      expect(r.mode).toBe(mode);
      expect(r.diagnostic).toBeUndefined();
      expect(r.run!({ x: 3 })).toBe(7);
    }
  });

  it('the default compiles the strict code', () => {
    const plain = ce.parse('2x + 1');
    const plainStrict = compile(plain, { mode: 'strict' }).code;
    expect(compile(plain).code).toBe(plainStrict);
    // The default `strict` keeps the real kernel of an unknown-sign radical.
    const expr = ce.parse('\\sqrt{x} + 2x');
    const strict = compile(expr, { mode: 'strict' });
    expect(strict.code).toContain('Math.sqrt');
    expect(compile(expr).code).toBe(strict.code);
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
        // `'auto'` is no longer a `CompileMode`; a host that does not
        // type-check its options can still pass it.
        const r = compile(ce.parse('x + 1'), {
          to,
          mode: mode as unknown as CompileMode,
        });
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
    // `Erf` has a real-only helper: a complex-typed operand fails closed.
    // The compile-time decline is the behavior of the strict lane.
    const r = compile(e.box(['Erf', 'z']), { mode: 'strict' });
    expect(r.success).toBe(false);
    expect(r.diagnostic).toEqual({
      code: 'compile-error',
      kind: 'capability',
      message: r.error,
    });
    expect(r.mode).toBe('strict');
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

  it('javascript defaults to strict; an explicit mode is latched as requested', () => {
    const expr = ce.parse('x + 1');
    expect(observedModes(expr)).toEqual(new Set(['strict']));
    expect(observedModes(expr, { mode: 'strict' })).toEqual(
      new Set(['strict'])
    );
    expect(observedModes(expr, { mode: 'complex' })).toEqual(
      new Set(['strict', 'complex'])
    );
  });

  it('an unsupported-mode decline leaves the mode latch restored (thrown before the try/finally)', () => {
    // The mode is resolved BEFORE `_mode` is written: the decline throws
    // outside the try/finally that restores it, so a latch mutated ahead of
    // the resolution would stay stuck.
    const glsl = ce._getCompilationTarget('glsl')!.createTarget();
    expect(() =>
      compile(ce.parse('x'), {
        target: glsl,
        mode: 'complex',
        fallback: false,
      })
    ).toThrow(/not offered/);
    expect(BaseCompiler.mode).toBe('strict');
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
    // The requested mode is stamped on the target per call: none here.
    expect(t.mode).toBeUndefined();
    // A requested mode it does not declare is the capability decline.
    const declined = compile(ce.parse('x + 1'), { target: t, mode: 'complex' });
    expect(declined.success).toBe(false);
    expect(declined.diagnostic!.code).toBe('unsupported-mode');
  });

  it("a direct target declaring 'complex' offers it; a reused target does not keep the previous call's mode", () => {
    const t = customTarget({
      supportedModes: ['strict', 'complex'] as const,
      complexLift: (c: string) => `lift(${c})`,
      complexIsReal: (c: string) => `isreal(${c})`,
    });
    // `complex` needs only the two lowering hooks.
    compile(ce.parse('x + 1'), { target: t, mode: 'complex' });
    expect(t.mode).toBe('complex');
    // An omitted option clears the stamped mode (the `constantFold`
    // stamping pattern), and the compilation is `strict`.
    const r = compile(ce.parse('x + 1'), { target: t });
    expect(t.mode).toBeUndefined();
    expect(r.mode).toBe('strict');
  });

  it("a direct target declaring 'complex' without the lowering hooks is rejected at option validation", () => {
    for (const declared of [['strict', 'complex']] as const) {
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

  it('a built-in target passed directly declares its three modes with its hooks, and defaults to strict there', () => {
    const jsRaw = new JavaScriptTarget().createTarget();
    expect(jsRaw.supportedModes).toEqual(['strict', 'complex', 'bigint']);
    expect(jsRaw.complexLift!('v')).toBe('_SYS.cplx(v)');
    expect(jsRaw.complexIsReal!('v')).toBe('_SYS.cisreal(v)');
    const r = compile(ce.parse('x + 1'), { target: jsRaw });
    expect(r.success).toBe(true);
    expect(r.mode).toBe('strict');
    expect(jsRaw.mode).toBeUndefined();
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
    for (const mode of ['strict', 'complex'] as const)
      expect(compile(ce.parse('x < 3'), { mode }).run!({ x: 5 })).toBe(false);
  });

  it('√4 is 2 and √(−2) is {re: 0, im: 1.414…}', () => {
    expect(compile(ce.parse('\\sqrt{x}')).run!({ x: 4 })).toBe(2);
    expect(compile(ce.parse('\\sqrt{-2}')).run!({})).toEqual({
      re: 0,
      im: Math.SQRT2,
    });
  });
});

describe('D7 — the shared interpreter fallback honors the runner contract in both directions', () => {
  it('a {re, im} vars value is declared complex and the result is a ComplexResult (or a number when real)', () => {
    const e = new ComputeEngine();
    e.declare('z', 'complex');
    // `Erf` fails closed on a complex-typed operand → interpreter fallback.
    // `strict`, the default, keeps that decline.
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
