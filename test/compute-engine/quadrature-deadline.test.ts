import { ComputeEngine } from '../../src/compute-engine';
import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';
import { withAmbientDeadline } from '../../src/common/interruptible';

/**
 * Tycho item 183: the adaptive Gauss–Kronrod kernel checks the span deadline
 * per panel and SALVAGES its partial result. Before the fix the kernel never
 * yielded: a nested oscillatory integral under a 1 s `withTimeLimit` ran
 * ≥298 s (killed externally) while a correctly-armed span sat on the frozen
 * stack — no JS-side budget could bound an integral-defined variable.
 *
 * The unit pins are DETERMINISTIC (an already-expired deadline plus an
 * integrand-evaluation budget), per the testing doctrine: never wall-clock
 * where a counter can pin the mechanism. One end-to-end probe keeps a
 * deliberately generous wall bound as the integration-level backstop.
 */
describe('item 183: quadrature honors the span deadline', () => {
  test('an expired explicit deadline stops after the single-panel fallback', () => {
    let calls = 0;
    const f = (x: number) => {
      calls += 1;
      return Math.sin(1 / (x + 0.0001));
    };
    const r = adaptiveQuadrature(f, 0.0001, 1, { deadline: Date.now() - 1 });
    // The initial-panel loop bails before building anything; the empty-panel
    // fallback evaluates ONE GK15 panel (15 nodes) so the caller still gets
    // a finite in-band estimate; the adaptive loop then bails immediately.
    expect(calls).toBe(15);
    expect(r.converged).toBe(false);
    expect(Number.isFinite(r.estimate)).toBe(true);
  });

  test('the AMBIENT deadline is inherited when no explicit one is given', () => {
    // This is the compiled-code path: `_SYS.integrate` has no engine access,
    // so a nested integral reached through a compiled integrand is bounded
    // only by ambient inheritance.
    let calls = 0;
    const f = (x: number) => {
      calls += 1;
      return Math.sin(1 / (x + 0.0001));
    };
    const r = withAmbientDeadline(Date.now() - 1, () =>
      adaptiveQuadrature(f, 0.0001, 1)
    );
    expect(calls).toBe(15);
    expect(r.converged).toBe(false);
  });

  test('no deadline: behavior unchanged, smooth integral converges', () => {
    const r = adaptiveQuadrature((x) => Math.exp(-x * x), 0, 1);
    expect(r.converged).toBe(true);
    // ∫₀¹ e^(−x²) dx = (√π/2)·erf(1)
    expect(r.estimate).toBeCloseTo(0.7468241328124271, 12);
  });

  test('a live (not yet expired) deadline still lets a fast integral finish', () => {
    const r = adaptiveQuadrature((x) => Math.exp(-x * x), 0, 1, {
      deadline: Date.now() + 60_000,
    });
    expect(r.converged).toBe(true);
    expect(r.estimate).toBeCloseTo(0.7468241328124271, 12);
  });

  test(
    'end-to-end: the nested oscillatory integral is bounded by withTimeLimit',
    () => {
      // The filing's repro: ran ≥298 s before the fix. After it, the span
      // terminates at ~the 1 s deadline — either a clean timeout
      // CancellationError (like the interpreted-sum control) or an in-band
      // salvage. The wall bound is a deliberately generous backstop (30×):
      // the pin is "bounded at all", not the exact latency.
      const ce = new ComputeEngine();
      const t0 = performance.now();
      let outcome: 'returned' | 'timeout' | 'other' = 'other';
      try {
        ce.withTimeLimit(1000, () =>
          ce
            .parse(
              '\\int_0^1\\left(\\int_{0.0001}^1\\sin\\left(\\frac{1}{xy+0.0001}\\right)dx\\right)dy'
            )
            .N()
        );
        outcome = 'returned';
      } catch (e) {
        outcome =
          (e as { cause?: string }).cause === 'timeout' ? 'timeout' : 'other';
      }
      expect(['returned', 'timeout']).toContain(outcome);
      expect(performance.now() - t0).toBeLessThan(30_000);
    },
    60_000
  );
});
