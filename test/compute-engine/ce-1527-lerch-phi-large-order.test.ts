/**
 * Φ(z, s, a) = Σ zᵏ(k + a)^(−s) at a very large order s ends (CE-1527).
 *
 * Where the direct series declines (every term underflows or overflows), the
 * Lerch kernel tries the continuation, which calls the upper incomplete gamma
 * Γ(1 − s, x). For a large s, 1 − s is a double that is an integer, so the
 * direct series of that kernel (`upperGammaDirectSeriesComplex`,
 * `numerics/numeric-complex.ts`) computed the term (−1)ⁿ/n!·(ψ(n+1) − ln x)
 * at n = s − 1 with a loop of n steps: 1e300 steps. From n = 400 on, that
 * term is below the smallest double, and the kernel now leaves it out. A
 * stuck kernel blocks the test file until the runner's outer `timeout`
 * stops it.
 *
 * The routes still decline at such an order, so the expression stays
 * symbolic and compiled code gives NaN. The tests pin that decline only to
 * show that the call returned: a later change that gives the double value
 * (0 for a > 1, +∞ for a < 1) may update them.
 */
import { Complex } from 'complex.js';
import { ComputeEngine, compile } from '../../src/compute-engine';
import { incompleteGammaUpperComplexWithError } from '../../src/compute-engine/numerics/numeric-complex';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('w', 'real');

describe('LERCHPHI(Z, S, A) AT A VERY LARGE ORDER', () => {
  const cases: [number, number, number][] = [
    [0.5, 1e300, 2],
    [0.5, 1e300, 0.5],
    [0.5, 1e300, 1.5],
    [0.5, 1e20, 0.5],
    [0.5, 1e17, 2],
    [2, 1e300, 2],
    [0.99999999999, 1e300, 2],
  ];

  test.each(cases)('LerchPhi(%p, %p, %p) ends', (z, s, a) => {
    const expr = ce.box(['LerchPhi', z, s, a]);
    expect(expr.N().operator).toBe('LerchPhi');
    const saved = ce.precision;
    ce.precision = 'machine';
    try {
      expect(expr.N().operator).toBe('LerchPhi');
    } finally {
      ce.precision = saved;
    }
  });

  test('compiled', () => {
    const f = compile(ce.box(['LerchPhi', 'x', 'y', 'w']));
    expect(f.success).toBe(true);
    for (const [z, s, a] of cases)
      expect(f.run!({ x: z, y: s, w: a })).toBeNaN();
  });
});

describe('THE COMPLEX UPPER INCOMPLETE GAMMA AT A LARGE NEGATIVE INTEGER ORDER', () => {
  test('Γ(1 − 1e300, 2 ln 2) ends', () => {
    const r = incompleteGammaUpperComplexWithError(
      new Complex(1 - 1e300, 0),
      new Complex(2 * Math.LN2, 0)
    );
    expect(r.value.re === 0 || Number.isNaN(r.value.re)).toBe(true);
  });

  // Γ(a + 1, z) = a·Γ(a, z) + z^a·e^{−z} (DLMF 8.8.2), across n = 400, where
  // the kernel stops computing the term with 1/n!. This shows that the value
  // left is right on both sides; the term itself is about e^{−1995} at
  // n = 399, so the threshold rests on the bound at `LEAD_UNDERFLOW_ORDER`.
  // The sum cancels about 400/|z| ≈ 570 times, so the check keeps 1e−11 of
  // relative error.
  test.each([399, 400, 401, 1000])(
    'the recurrence holds from Γ(−%p, z) to Γ(−%p − 1, z)',
    (n) => {
      const z = new Complex(0.5, 0.5);
      const upper = incompleteGammaUpperComplexWithError(
        new Complex(-n, 0),
        z
      ).value;
      const lower = incompleteGammaUpperComplexWithError(
        new Complex(-n - 1, 0),
        z
      ).value;
      const a = -n - 1;
      const rhs = lower.mul(a).add(z.pow(a).mul(z.neg().exp()));
      expect(upper.isFinite()).toBe(true);
      expect(upper.sub(rhs).abs() / upper.abs()).toBeLessThan(1e-11);
    }
  );
});
