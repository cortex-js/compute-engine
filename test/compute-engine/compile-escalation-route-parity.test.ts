import { ComputeEngine, compile } from '../../src/compute-engine';
import { isLaneMismatchError } from '../../src/compute-engine/compilation/diagnostics';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';

/**
 * Route parity for the `mode: 'auto'` escalation.
 *
 * There are two public routes into a compilation:
 *
 * - the standalone `compile(expr, options)` export, and
 * - a registered target obtained from `ce._getCompilationTarget(name)` and
 *   invoked through its own `.compile(expr, options)`.
 *
 * Under the default `auto` discipline a lane mismatch escalates: the
 * compilation is redone under `mode: 'complex'` and the result reports
 * `mode: 'complex'`, `promoted: true` and the failed strict attempt's
 * diagnostic in `escalation`. The escalation lives in the targets'
 * `compile()` (`compilation/auto-escalation.ts`), so both routes get it; when
 * it lived only in the standalone wrapper, the target-level route threw a
 * `LaneMismatchError` where the standalone route succeeded.
 *
 * `mode: 'strict'` is unaffected on either route: it never promotes, and a
 * mismatch it does raise is still a decline (a throw by default, a
 * `success: false` result with the `lane-mismatch` diagnostic under
 * `fallback: true`).
 */

/**
 * The witness: `k` is left FREE (undeclared), so `\sqrt{2k}` has unknown sign
 * and the promoting discipline lowers it through the complex kernel. The
 * promoted value then reaches `u`, the wide (unannotated) parameter of the
 * user function `Cwide`, which the compilation shaped real — the lane
 * mismatch. `Cwide(x√(2k) + k)·√(2π·2k)`.
 */
function witness(): {
  ce: ComputeEngine;
  expr: ReturnType<ComputeEngine['parse']>;
} {
  const ce = new ComputeEngine();
  ce.assign('Cwide', ce.parse('u \\mapsto u + 1'));
  return {
    ce,
    expr: ce.parse(
      '\\operatorname{Cwide}(x \\sqrt{2k} + k) \\cdot \\sqrt{2\\pi \\cdot 2k}'
    ),
  };
}

/** The strict-mode witness: a complex-TYPED argument into a wide parameter. */
function strictWitness(): {
  ce: ComputeEngine;
  expr: ReturnType<ComputeEngine['box']>;
} {
  const ce = new ComputeEngine();
  ce.declare('z', 'complex');
  ce.assign('b', ce.parse('x \\mapsto 2x'));
  return { ce, expr: ce.box(['b', 'z']) };
}

/** The fields the two routes must agree on. */
const shape = (r: CompilationResult<'javascript'>) => ({
  success: r.success,
  mode: r.mode,
  promoted: r.promoted,
  escalation: r.escalation,
});

describe('compile escalation — standalone vs target-level route', () => {
  it('escalates identically on both routes under the default mode', () => {
    const { ce, expr } = witness();
    const target = ce._getCompilationTarget('javascript')!;

    const standalone = compile(expr) as CompilationResult<'javascript'>;
    const direct = target.compile(expr);

    expect(standalone.success).toBe(true);
    expect(standalone.mode).toBe('complex');
    expect(standalone.promoted).toBe(true);
    expect(standalone.escalation?.code).toBe('lane-mismatch');
    expect(standalone.escalation?.boundary).toBe('user-function parameter');
    expect(standalone.escalation?.binding).toBe('the parameter `u` of `Cwide`');

    expect(shape(direct)).toEqual(shape(standalone));
    expect(direct.code).toBe(standalone.code);

    // …and the compiled code computes the same values. At `k = 2` everything
    // is real (`Cwide(4)·√(8π) = 5·5.0133…`); at `k = -1` the radicals are
    // imaginary and their product is real again
    // (`i√2 · i√(4π) = -√2·√(4π) = -5.0133…`).
    expect(direct.run!({ x: 1, k: 2 })).toEqual(
      standalone.run!({ x: 1, k: 2 })
    );
    expect(direct.run!({ x: 1, k: 2 })).toBeCloseTo(25.0663, 4);
    expect(direct.run!({ x: 1, k: -1 })).toEqual(
      standalone.run!({ x: 1, k: -1 })
    );
    expect(direct.run!({ x: 1, k: -1 })).toBeCloseTo(-5.0133, 4);
  });

  it('escalates on the target route with `auto` requested, and with `fallback` either way', () => {
    const { ce, expr } = witness();
    const target = ce._getCompilationTarget('javascript')!;
    for (const options of [
      { mode: 'auto' as const },
      { fallback: false },
      { fallback: true },
    ]) {
      const r = target.compile(expr, options);
      expect(r.success).toBe(true);
      expect(r.mode).toBe('complex');
      expect(r.promoted).toBe(true);
      expect(r.escalation?.code).toBe('lane-mismatch');
    }
  });

  it('leaves `mode: strict` alone: no promotion, no escalation, on either route', () => {
    const { ce, expr } = witness();
    const target = ce._getCompilationTarget('javascript')!;
    const standalone = compile(expr, {
      mode: 'strict',
      fallback: false,
    }) as CompilationResult<'javascript'>;
    const direct = target.compile(expr, { mode: 'strict', fallback: false });
    // Strict never promotes, so the radical stays in the real lane and no
    // mismatch arises: the compilation succeeds under the strict discipline.
    expect(standalone.mode).toBe('strict');
    expect(standalone.promoted).toBe(false);
    expect(standalone.escalation).toBeUndefined();
    expect(shape(direct)).toEqual(shape(standalone));
    expect(direct.code).toBe(standalone.code);
  });

  it('a strict-mode lane mismatch still declines per each route’s contract', () => {
    const { ce, expr } = strictWitness();
    const target = ce._getCompilationTarget('javascript')!;

    // The low-level contract: the target-level route throws by default.
    expect(() => target.compile(expr, { mode: 'strict' })).toThrow();
    try {
      target.compile(expr, { mode: 'strict' });
    } catch (e) {
      expect(isLaneMismatchError(e)).toBe(true);
    }
    // …and the standalone route with `fallback: false` throws the same error.
    try {
      compile(expr, { mode: 'strict', fallback: false });
      throw new Error('expected a LaneMismatchError');
    } catch (e) {
      expect(isLaneMismatchError(e)).toBe(true);
    }

    // With `fallback: true` both routes report the decline instead.
    const direct = target.compile(expr, { mode: 'strict', fallback: true });
    const standalone = compile(expr, {
      mode: 'strict',
    }) as CompilationResult<'javascript'>;
    expect(direct.success).toBe(false);
    expect(direct.diagnostic?.code).toBe('lane-mismatch');
    expect(direct.diagnostic?.kind).toBe('correctness');
    expect(standalone.success).toBe(false);
    expect(standalone.diagnostic?.code).toBe('lane-mismatch');
    expect(standalone.diagnostic?.kind).toBe('correctness');

    // The same mismatch under the default `auto` escalates on both routes.
    const autoDirect = target.compile(expr);
    const autoStandalone = compile(expr) as CompilationResult<'javascript'>;
    expect(shape(autoDirect)).toEqual(shape(autoStandalone));
    expect(autoDirect.mode).toBe('complex');
    expect(autoDirect.escalation?.binding).toBe('the parameter `x` of `b`');
    expect(autoDirect.run!({ z: { re: 1, im: 2 } })).toEqual({ re: 2, im: 4 });
  });
});

describe('the Python target route behaves like the JavaScript one', () => {
  it('promotes under the default mode; strict does not (source-only)', () => {
    // The escalation call site is duplicated per target (each target's
    // compile() applies compileWithAutoEscalation itself), so the Python
    // wiring needs its own pin — a JavaScript-only suite would let the two
    // call sites silently diverge. The JavaScript witness cannot run here:
    // lane mismatches arise at USER-FUNCTION parameters, and the Python
    // target has no lowering for user functions, so no Python-reachable
    // mismatch witness exists today and the retry itself is exercised on
    // the JavaScript route above. What IS measurable on this target — and
    // what this pins — is the mode plumbing the helper wraps: `auto`
    // promotes an unknown-sign radical on the FIRST attempt and reports the
    // resolved discipline; `strict` never promotes.
    const ce = new ComputeEngine();
    const expr = ce.parse('\\sqrt{k} + k');
    const auto = ce._getCompilationTarget('python')!.compile(expr, {});
    expect(auto.success).toBe(true);
    expect(auto.mode).toBe('complex');
    expect(auto.promoted).toBe(true);
    expect(typeof auto.code).toBe('string');
    const strict = ce
      ._getCompilationTarget('python')!
      .compile(expr, { mode: 'strict' });
    expect(strict.mode).toBe('strict');
    expect(strict.promoted).toBe(false);
    expect(strict.escalation).toBeUndefined();
  });

  it("forwards `realOnly` to the interpreter fallback on a decline", () => {
    // The Python target's catch used to build its fallback WITHOUT
    // forwarding `options.realOnly` (the standalone route forwarded it), so
    // the interpreter-backed `run` returned an unprojected `{re, im}` where
    // the caller had asked for the real-only projection. Same decline
    // fixture as compile-mode-plumbing's JavaScript-route test: `Erf` is
    // real-only, so `Erf(z)` with `z: complex` declines under strict.
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    const r = ce._getCompilationTarget('python')!.compile(
      ce.box(['Add', ['Erf', 'z'], 'z']),
      { fallback: true, realOnly: true, mode: 'strict' }
    );
    expect(r.success).toBe(false);
    expect(r.run!({ z: { re: 0.5, im: 0 } as never })).toBeCloseTo(
      1.0204998778130465,
      12
    );
    expect(r.run!({ z: { re: 0, im: 1 } as never })).toBeNaN();
  });
});
