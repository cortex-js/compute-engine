import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';

/** Compile a parsed LaTeX definite integral to a real-valued runner. */
function compileReal(latex: string, options?: { quadrature?: 'monte-carlo' }) {
  const r = compile(ce.parse(latex), { realOnly: true, ...options });
  expect(r.success).toBe(true);
  return r;
}

describe('COMPILE Integrate — adaptive Gauss–Kronrod', () => {
  describe('accuracy vs closed form', () => {
    // ∫_0^x 0.1·√(1+t²) dt = 0.05·(x·√(1+x²) + asinh(x))
    test.each([0.5, 2, 5])('arc-length integrand at x=%p', (x) => {
      const r = compileReal('\\int_0^x 0.1\\sqrt{1+t^2}\\,dt');
      const got = r.run({ x }) as number;
      const closed = 0.05 * (x * Math.sqrt(1 + x * x) + Math.asinh(x));
      expect(Math.abs(got - closed) / Math.abs(closed)).toBeLessThan(1e-8);
    });

    test('∫_0^π sin(t) dt = 2 (constant bounds)', () => {
      const r = compileReal('\\int_0^{\\pi} \\sin(t)\\,dt');
      expect(r.run({}) as number).toBeCloseTo(2, 8);
    });
  });

  test('determinism — successive calls are bit-identical (vs stochastic MC)', () => {
    const r = compileReal('\\int_0^x 0.1\\sqrt{1+t^2}\\,dt');
    const a = r.run({ x: 2 }) as number;
    const b = r.run({ x: 2 }) as number;
    expect(a).toBe(b); // ===, not just close
  });

  describe('infinite bounds via variable transform', () => {
    // Standard normal CDF Φ(x) = 1/√(2π) ∫_{-∞}^x e^{-t²/2} dt
    test('Gaussian CDF Φ(0) = 0.5', () => {
      const r = compileReal(
        '\\frac{1}{\\sqrt{2\\pi}}\\int_{-\\infty}^{x} e^{-t^2/2}\\,dt'
      );
      expect(r.run({ x: 0 }) as number).toBeCloseTo(0.5, 8);
    });

    test('Gaussian CDF Φ(1) ≈ 0.8413447460685429', () => {
      const r = compileReal(
        '\\frac{1}{\\sqrt{2\\pi}}\\int_{-\\infty}^{x} e^{-t^2/2}\\,dt'
      );
      expect(r.run({ x: 1 }) as number).toBeCloseTo(0.8413447460685429, 8);
    });

    test('χ²-type tail ∫_x^∞ y^{3/2} e^{-y/2} dy at x=2', () => {
      const r = compileReal('\\int_x^{\\infty} y^{3/2} e^{-y/2}\\,dy');
      // Reference value verified independently by a fine composite Simpson
      // rule on [2, 200] (tail beyond negligible): 6.385472870122. The
      // engine's interpreter (`.N()`) uses Monte-Carlo here and returns a
      // stochastic ~6.33 (error ~0.06 — far larger than a 1e-4 typical), so it
      // is unusable as a tight reference; compare against the trusted value.
      expect(r.run({ x: 2 }) as number).toBeCloseTo(6.385472870122, 6);
    });
  });

  test('oscillatory integrand ∫_{-π}^{π} e^{-t²} cos(6π t) dt', () => {
    const r = compileReal(
      '\\int_{-\\pi}^{\\pi} e^{-t^2} \\cos(2\\pi \\cdot 3 \\cdot t)\\,dt'
    );
    const got = r.run({}) as number;
    expect(Number.isFinite(got)).toBe(true);
    expect(got).toBe(r.run({}) as number); // deterministic
    // Trusted reference: fine composite Simpson (N = 2·10⁶) over [-π, π] gives
    // 3.7408935992e-6; verified to agree with an independent GK computation to
    // ~1e-15. (The integral is dominated by truncation — the doubly-infinite
    // value √π·e^{-9π²} ≈ 3e-39 is negligible.)
    expect(Math.abs(got - 3.7408935992e-6)).toBeLessThan(1e-6);
  });

  test('piecewise integrand ∫_0^2 f, f = 1 for t<1 else 2 → 3', () => {
    // Built via Which (jump discontinuity at t = 1).
    const expr = ce.box([
      'Integrate',
      ['Which', ['Less', 'x', 1], 1, 'True', 2],
      ['Limits', 'x', 0, 2],
    ]);
    const r = compile(expr, { realOnly: true });
    expect(r.success).toBe(true);
    expect(r.run() as number).toBeCloseTo(3, 6);
  });

  describe('quadrature option', () => {
    // A piecewise (Which) integrand has no elementary antiderivative, so the
    // antiderivative-first path declines and the quadrature emitter is exercised
    // (∫_0^2 of {1 for t<1, else 2} = 3).
    const piecewise = () =>
      ce.box([
        'Integrate',
        ['Which', ['Less', 'x', 1], 1, 'True', 2],
        ['Limits', 'x', 0, 2],
      ]);

    test("quadrature: 'monte-carlo' emits integrateMC and runs", () => {
      const r = compile(piecewise(), { realOnly: true, quadrature: 'monte-carlo' });
      expect(r.code).toContain('integrateMC');
      expect(r.run() as number).toBeCloseTo(3, 2); // MC: ~1e-2 tolerance
    });

    test('default emits _SYS.integrate, not integrateMC', () => {
      const r = compile(piecewise(), { realOnly: true });
      expect(r.code).toContain('_SYS.integrate(');
      expect(r.code).not.toContain('integrateMC');
    });
  });

  describe('antiderivative-first (symbolic resolution before quadrature)', () => {
    // A resolvable integral compiles to its closed form — no quadrature call at
    // all — so each sample is straight-line arithmetic, not an integration loop.
    test('resolvable integral emits no quadrature call', () => {
      const r = compileReal('\\int_0^x 0.1\\sqrt{1+t^2}\\,dt');
      expect(r.code).not.toContain('_SYS.integrate');
      expect(r.code).not.toContain('integrateMC');
      // Exact closed form (0.05·(x·√(1+x²) + asinh x)), deterministic.
      const got = r.run({ x: 5 }) as number;
      expect(got).toBeCloseTo(0.05 * (5 * Math.sqrt(26) + Math.asinh(5)), 10);
      expect(got).toBe(r.run({ x: 5 }) as number);
    });

    test('Gaussian CDF resolves to an Erf closed form (no quadrature)', () => {
      const r = compileReal(
        '\\frac{1}{\\sqrt{2\\pi}}\\int_{-\\infty}^{x} e^{-t^2/2}\\,dt'
      );
      expect(r.code).not.toContain('_SYS.integrate');
      expect(r.run({ x: 1 }) as number).toBeCloseTo(0.8413447460685429, 10);
    });

    // Precedence: the closed form (an `Add`) is spliced into a larger
    // expression; it must be parenthesized so surrounding operators bind
    // correctly. `2·∫_0^x t dt + 1 = x² + 1`.
    test('closed form is parenthesized inside a larger expression', () => {
      const r = compile(ce.parse('2\\int_0^x t\\,dt + 1'), { realOnly: true });
      expect(r.run({ x: 3 }) as number).toBeCloseTo(10, 10);
    });

    // Non-resolvable integrand falls back to quadrature.
    test('non-elementary integrand falls back to quadrature', () => {
      const r = compileReal('\\int_0^2 e^{\\sin t}\\,dt');
      expect(r.code).toContain('_SYS.integrate(');
      expect(r.run() as number).toBeCloseTo(4.236531, 3);
    });

    // A `vars`-mapped symbol must not be folded into a baked closed form, so
    // antiderivative-first is skipped when the integral references one — the
    // quadrature emitter (which honors the vars mapping) is used instead.
    // Contrast: the same integral WITHOUT the vars mapping resolves to a closed
    // form (k²/2), proving the gate is what forces quadrature.
    test('vars-mapped symbol skips antiderivative-first (keeps quadrature)', () => {
      const withVars = compile(ce.parse('\\int_0^k t\\,dt'), {
        realOnly: true,
        vars: { k: '_.k' },
      });
      expect(withVars.code).toContain('_SYS.integrate(');

      const noVars = compile(ce.parse('\\int_0^k t\\,dt'), { realOnly: true });
      expect(noVars.code).not.toContain('_SYS.integrate');
      expect(noVars.run({ k: 4 }) as number).toBeCloseTo(8, 10); // k²/2
    });
  });

  test('performance smoke — 50 calls under 2 s', () => {
    const r = compileReal('\\int_0^x 0.1\\sqrt{1+t^2}\\,dt');
    const start = Date.now();
    for (let i = 0; i < 50; i++) r.run({ x: 1 + (i % 5) });
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('adaptiveQuadrature (unit)', () => {
  test('finite smooth: ∫_0^1 x² dx = 1/3', () => {
    const r = adaptiveQuadrature((x) => x * x, 0, 1);
    expect(r.converged).toBe(true);
    expect(r.estimate).toBeCloseTo(1 / 3, 12);
  });

  test('reversed bounds negate the result', () => {
    const fwd = adaptiveQuadrature(Math.sin, 0, Math.PI);
    const rev = adaptiveQuadrature(Math.sin, Math.PI, 0);
    expect(rev.estimate).toBeCloseTo(-fwd.estimate, 14);
  });

  test('a === b → 0', () => {
    const r = adaptiveQuadrature(Math.sin, 1, 1);
    expect(r.estimate).toBe(0);
    expect(r.converged).toBe(true);
  });

  test('[a, ∞) exponential decay: ∫_0^∞ e^{-x} dx = 1', () => {
    const r = adaptiveQuadrature((x) => Math.exp(-x), 0, Infinity);
    expect(r.converged).toBe(true);
    expect(r.estimate).toBeCloseTo(1, 8);
  });

  test('NaN bound → non-converged NaN', () => {
    const r = adaptiveQuadrature(Math.sin, NaN, 1);
    expect(Number.isNaN(r.estimate)).toBe(true);
    expect(r.converged).toBe(false);
  });
});
