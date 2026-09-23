import { ComputeEngine } from '../../src/compute-engine';
import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';
import { withAmbientDeadline } from '../../src/common/interruptible';

/**
 * Tycho item 183: the adaptive Gauss–Kronrod kernel checks the span deadline
 * per panel. Before that check the kernel never yielded: a nested oscillatory
 * integral under a 1 s `withTimeLimit` ran ≥298 s (killed externally) while a
 * correctly-armed span sat on the frozen stack — no JS-side budget could
 * bound an integral-defined variable.
 *
 * An expired deadline THROWS the timeout. It used to return the partial sum
 * of the panels built so far, a number with no mark that it was incomplete
 * (user decision 2026-09-23: the caller's deadline propagates, as
 * `docs/TIMEOUT-MODEL.md` §2 requires).
 *
 * The unit pins are DETERMINISTIC (an already-expired deadline plus an
 * integrand-evaluation budget), per the testing doctrine: never wall-clock
 * where a counter can pin the mechanism. One end-to-end probe keeps a
 * deliberately generous wall bound as the integration-level backstop.
 */
describe('item 183: quadrature honors the span deadline', () => {
  test('an expired explicit deadline throws before any evaluation', () => {
    let calls = 0;
    const f = (x: number) => {
      calls += 1;
      return Math.sin(1 / (x + 0.0001));
    };
    expect(() =>
      adaptiveQuadrature(f, 0.0001, 1, { deadline: Date.now() - 1 })
    ).toThrow(expect.objectContaining({ cause: 'timeout' }));
    expect(calls).toBe(0);
  });

  test('a smooth integrand with an expired deadline throws too', () => {
    // Before, one wide panel of a smooth integrand could meet the tolerance,
    // so the partial result reported `converged: true`.
    expect(() =>
      adaptiveQuadrature((x) => Math.exp(-x * x), 0, 1, {
        deadline: Date.now() - 1,
      })
    ).toThrow(expect.objectContaining({ cause: 'timeout' }));
  });

  test('a deadline frame gives the error the label of its span', () => {
    let error: unknown;
    try {
      adaptiveQuadrature((x) => x, 0, 1, {
        deadline: { at: Date.now() - 1, owner: 'plot', spans: ['plot'] },
      });
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ cause: 'timeout', attribution: 'plot' });
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
    expect(() =>
      withAmbientDeadline(Date.now() - 1, () =>
        adaptiveQuadrature(f, 0.0001, 1)
      )
    ).toThrow(expect.objectContaining({ cause: 'timeout' }));
    expect(calls).toBe(0);
  });

  test('a nested call that inherits the ambient frame keeps the label', () => {
    // An inner integral reached through compiled code gets its deadline from
    // the ambient channel, which carries the frame and so the span label.
    const frame = { at: Date.now() - 1, owner: 'plot', spans: ['plot'] };
    let error: unknown;
    try {
      withAmbientDeadline(frame, () => adaptiveQuadrature((x) => x, 0, 1));
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ cause: 'timeout', attribution: 'plot' });
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

  test.each([
    [
      'Integrate(...).N()',
      '\\int_0^1 \\sin\\left(\\frac{1}{x+0.0001}\\right)dx',
    ],
    [
      'NIntegrate',
      '\\operatorname{NIntegrate}(x \\mapsto \\sin(\\frac{1}{x+0.0001}), 0, 1)',
    ],
  ])('%s throws the labelled timeout of its span', (_, latex) => {
    const ce = new ComputeEngine();
    const expr = ce.parse(latex);
    let error: unknown;
    try {
      ce.withTimeLimit({ ms: 0, label: 'budget' }, () => expr.N());
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ cause: 'timeout', attribution: 'budget' });
  });

  test(
    'end-to-end: the nested oscillatory integral is bounded by withTimeLimit',
    () => {
      // The filing's repro: ran ≥298 s before the fix. After it, the span
      // terminates at ~the 1 s deadline with a timeout CancellationError.
      // The wall bound is a deliberately generous backstop (30×): the pin is
      // "bounded at all", not the exact latency.
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
      expect(outcome).toBe('timeout');
      expect(performance.now() - t0).toBeLessThan(30_000);
    },
    60_000
  );
});
