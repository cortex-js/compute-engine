import { ComputeEngine, compile } from '../../src/compute-engine';
import { isLaneMismatchError } from '../../src/compute-engine/compilation/diagnostics';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';

/**
 * Route parity of the compile modes.
 *
 * There are two public routes into a compilation:
 *
 * - the standalone `compile(expr, options)` export, and
 * - a registered target obtained from `ce._getCompilationTarget(name)` and
 *   invoked through its own `.compile(expr, options)`.
 *
 * Both routes must give the same result. In `mode: 'strict'` (the default)
 * an unknown-sign radical stays on the real lane, and a lane mismatch is a
 * decline: a throw by default on the target route, a `success: false`
 * result with the `lane-mismatch` diagnostic under `fallback: true`.
 */

/**
 * The witness: `k` is left FREE (undeclared), so `\sqrt{2k}` has unknown sign.
 * In strict mode it stays on the real lane, so its value can reach `u`, the
 * wide (unannotated) parameter of the user function `Cwide`, which the
 * compilation shaped real, with no lane mismatch.
 * `Cwide(x√(2k) + k)·√(2π·2k)`.
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
});

describe('compile modes — standalone vs target-level route', () => {
  it('leaves `mode: strict` alone on either route', () => {
    const { ce, expr } = witness();
    const target = ce._getCompilationTarget('javascript')!;
    const standalone = compile(expr, {
      mode: 'strict',
      fallback: false,
    }) as CompilationResult<'javascript'>;
    const direct = target.compile(expr, { mode: 'strict', fallback: false });
    // The radical stays in the real lane and no mismatch arises: the
    // compilation succeeds under the strict discipline.
    expect(standalone.mode).toBe('strict');
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

  });
});

describe('the Python target route behaves like the JavaScript one', () => {
  it("the decline's interpreter fallback follows the runner's value convention", () => {
    // The Python target builds its own fallback in its catch, so the runner
    // contract has to be honored there and not only on the standalone route.
    // `scipy.special.loggamma` takes another branch than the interpreter off
    // the real axis, so `GammaLn` is real-only on the Python target and
    // `GammaLn(z)` with `z: complex` declines under strict. (The
    // JavaScript-route test in compile-mode-plumbing uses `Erf`, which is
    // real-only there; on Python `scipy.special.erf` takes a complex
    // argument.)
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    const r = ce
      ._getCompilationTarget('python')!
      .compile(ce.box(['Add', ['GammaLn', 'z'], 'z']), {
        fallback: true,
        mode: 'strict',
      });
    expect(r.success).toBe(false);
    // An exactly-real value comes back as a plain number: lnΓ(0.5) + 0.5.
    expect(r.run!({ z: { re: 0.5, im: 0 } as never })).toBeCloseTo(
      1.0723649429247001,
      12
    );
    // …and a genuinely complex one as a `{re, im}`: lnΓ(3 + 4i) + 3 + 4i,
    // with lnΓ the principal log (Im in (−π, π]).
    const c = r.run!({ z: { re: 3, im: 4 } as never }) as {
      re: number;
      im: number;
    };
    expect(typeof c).toBe('object');
    expect(c.re).toBeCloseTo(1.2433732153962191, 12);
    expect(c.im).toBeCloseTo(2.4594791308550716, 12);
  });
});
