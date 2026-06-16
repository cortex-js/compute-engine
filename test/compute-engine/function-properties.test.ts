import { ComputeEngine } from '../../src/compute-engine';

// A fresh engine (the store caches per-engine; keep it isolated from the
// shared instance other suites mutate).
const ce = new ComputeEngine();

describe('ANALYTIC-PROPERTY METADATA STORE (ROADMAP item 7)', () => {
  describe('ce.functionProperties() — query API', () => {
    test('returns undefined for operators with no recorded properties', () => {
      expect(ce.functionProperties('NotARealFunction')).toBeUndefined();
      // A common arithmetic operator carries no analytic-property records.
      expect(ce.functionProperties('Add')).toBeUndefined();
    });

    test('poles are exposed as a boxed set', () => {
      // The pole set of Gamma/Digamma is the symbol `NonPositiveIntegers`.
      expect(ce.functionProperties('Gamma')?.poles?.symbol).toBe(
        'NonPositiveIntegers'
      );
      expect(ce.functionProperties('Digamma')?.poles?.symbol).toBe(
        'NonPositiveIntegers'
      );
    });

    test('an entire function records an empty pole set (not undefined)', () => {
      const exp = ce.functionProperties('Exp');
      expect(exp).toBeDefined();
      // Exp has a Poles record whose value is the empty set.
      expect(exp?.poles?.toString()).toBe('Set()');
    });

    test('zeros, holomorphic domain and meromorphy are exposed', () => {
      const gamma = ce.functionProperties('Gamma');
      // Gamma is non-vanishing: empty zero set.
      expect(gamma?.zeros?.toString()).toBe('Set()');

      const digamma = ce.functionProperties('Digamma');
      expect(digamma?.holomorphicDomain?.toString()).toBe(
        'SetMinus("ComplexNumbers", "NonPositiveIntegers")'
      );
      expect(digamma?.isMeromorphic).toBe(true);
    });

    test('all records are available via entries (incl. parametric ones)', () => {
      const beta = ce.functionProperties('Beta');
      expect(beta).toBeDefined();
      // Beta carries a (parametric) residue record.
      const residue = beta?.entries.find((e) => e.property === 'Residue');
      expect(residue).toBeDefined();
      expect(residue?.assumptions).not.toBeNull();
    });

    test('repeated queries return the cached view', () => {
      expect(ce.functionProperties('Gamma')).toBe(
        ce.functionProperties('Gamma')
      );
    });
  });

  describe('pole-aware N()', () => {
    test('fills in poles the kernel leaves as NaN (Digamma)', () => {
      // Before: Digamma(-2).N() and Digamma(0).N() returned NaN.
      expect(ce.expr(['Digamma', -2]).N().toString()).toBe('~oo');
      expect(ce.expr(['Digamma', 0]).N().toString()).toBe('~oo');
      expect(ce.expr(['Digamma', -5]).N().toString()).toBe('~oo');
    });

    test('does not override a finite value off the poles', () => {
      // Digamma(3) = -gamma + 1 + 1/2 ≈ 0.9227
      const v = ce.expr(['Digamma', 3]).N().re;
      expect(Math.abs(v - 0.9227843350984671)).toBeLessThan(1e-12);
    });

    test('preserves a kernel that already returns an infinity', () => {
      // Gamma already returns ComplexInfinity at its poles; unchanged.
      expect(ce.expr(['Gamma', -1]).N().toString()).toBe('~oo');
      expect(ce.expr(['Gamma', 0]).N().toString()).toBe('~oo');
      // Zeta returns a directed +oo at s = 1; the override must not touch it.
      expect(ce.expr(['Zeta', 1]).N().toString()).toBe('+oo');
    });

    test('non-pole arguments are unaffected', () => {
      expect(ce.expr(['Gamma', 5]).N().toString()).toBe('24');
      expect(
        Math.abs(ce.expr(['Zeta', 2]).N().re - 1.6449340668482264)
      ).toBeLessThan(1e-12);
    });

    test('a symbolic (non-numeric) argument never triggers an override', () => {
      // Membership is fail-closed: Digamma(x) with x free stays symbolic.
      const x = ce.symbol('x');
      const r = ce.expr(['Digamma', x]).N();
      expect(r.toString()).not.toBe('~oo');
    });
  });
});
