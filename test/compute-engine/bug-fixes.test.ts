import { ComputeEngine } from '../../src/compute-engine';
import '../utils';

describe('BUG FIXES', () => {
  describe('Bug #24: forget() should clear assumed values', () => {
    test('forget() clears values from evaluation context', () => {
      const ce = new ComputeEngine();
      ce.assume(ce.expr(['Equal', 'x', 5]));
      expect(ce.expr('x').evaluate().json).toEqual(5);
      
      ce.forget('x');
      expect(ce.expr('x').evaluate().json).toEqual('x');
    });
  });

  describe('Bug #25: Scoped assumptions should clean up on popScope()', () => {
    test('popScope() removes values set by assumptions in that scope', () => {
      const ce = new ComputeEngine();
      expect(ce.expr('y').evaluate().json).toEqual('y');
      
      ce.pushScope();
      ce.assume(ce.expr(['Equal', 'y', 10]));
      expect(ce.expr('y').evaluate().json).toEqual(10);
      
      ce.popScope();
      expect(ce.expr('y').evaluate().json).toEqual('y');
    });
  });

  describe('Bug #178: division by expressions that simplify to 0', () => {
    test('0/(1-1) simplifies to NaN, not 0', () => {
      const ce = new ComputeEngine();
      const simp = ce.parse('\\frac{0}{1-1}', { form: 'raw' }).simplify();
      expect(simp.isNaN).toBe(true);
    });

    test('(1-1)/(1-1) simplifies to NaN, not 1', () => {
      const ce = new ComputeEngine();
      const simp = ce
        .parse('\\frac{1-1}{1-1}', { form: 'raw' })
        .simplify();
      expect(simp.isNaN).toBe(true);
    });

  });

  describe('Bug #178: exp(log(x) ± y) should separate the log term', () => {
    // exp(log₁₀ x) = x^(1/ln 10), which CE may render either as a power
    // `x^{1/\ln(10)}` or as the ln(10)-th root `\sqrt[\ln(10)]{x}` (the latter
    // now that `ln(10)` stays the exact symbol rather than a float). The bug is
    // about separating the log term: no `\log` should remain, and the `\ln(10)`
    // factor (from the base-10 → natural-log conversion) must appear.
    test('exp(log(x)+y) has no remaining log()', () => {
      const ce = new ComputeEngine();
      const latex = ce.parse('\\exp(\\log(x)+y)', { form: 'raw' })
        .simplify().latex;
      expect(latex).toContain('\\exponentialE^{y}');
      expect(latex).toContain('\\ln(10)');
      expect(latex).not.toContain('\\log');
    });

    test('exp(log(x)-y) has no remaining log()', () => {
      const ce = new ComputeEngine();
      const latex = ce.parse('\\exp(\\log(x)-y)', { form: 'raw' })
        .simplify().latex;
      expect(latex).toContain('\\ln(10)');
      expect(latex).not.toContain('\\log');
    });
  });

  describe('Bug #178: xx should simplify to x^2', () => {
    test('xx -> x^2', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('xx', { form: 'raw' }).simplify().latex).toBe('x^2');
    });
  });
});
