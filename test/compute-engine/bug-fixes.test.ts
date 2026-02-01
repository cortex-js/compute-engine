import { ComputeEngine } from '../../src/compute-engine';
import '../utils';

describe('BUG FIXES', () => {
  describe('Bug #24: forget() should clear assumed values', () => {
    test('forget() clears values from evaluation context', () => {
      const ce = new ComputeEngine();
      ce.assume(ce.box(['Equal', 'x', 5]));
      expect(ce.box('x').evaluate().json).toEqual(5);
      
      ce.forget('x');
      expect(ce.box('x').evaluate().json).toEqual('x');
    });
  });

  describe('Bug #25: Scoped assumptions should clean up on popScope()', () => {
    test('popScope() removes values set by assumptions in that scope', () => {
      const ce = new ComputeEngine();
      expect(ce.box('y').evaluate().json).toEqual('y');
      
      ce.pushScope();
      ce.assume(ce.box(['Equal', 'y', 10]));
      expect(ce.box('y').evaluate().json).toEqual(10);
      
      ce.popScope();
      expect(ce.box('y').evaluate().json).toEqual('y');
    });
  });

  describe('Bug #178: division by expressions that simplify to 0', () => {
    test('0/(1-1) does not simplify to 0', () => {
      const ce = new ComputeEngine();
      const simp = ce.parse('\\frac{0}{1-1}', { canonical: false }).simplify();
      expect(simp.operator).toBe('Divide');
      expect(simp.op1?.is(0)).toBe(true);
    });

    test('(1-1)/(1-1) does not simplify to 1', () => {
      const ce = new ComputeEngine();
      const simp = ce
        .parse('\\frac{1-1}{1-1}', { canonical: false })
        .simplify();
      expect(simp.operator).toBe('Divide');
    });
  });

  describe('Bug #178: exp(log(x) ± y) should separate the log term', () => {
    test('exp(log(x)+y) has no remaining log()', () => {
      const ce = new ComputeEngine();
      const latex = ce.parse('\\exp(\\log(x)+y)', { canonical: false })
        .simplify().latex;
      expect(latex).toContain('\\exponentialE^{y}');
      expect(latex).toContain('x^{');
      expect(latex).not.toContain('\\log');
    });

    test('exp(log(x)-y) has no remaining log()', () => {
      const ce = new ComputeEngine();
      const latex = ce.parse('\\exp(\\log(x)-y)', { canonical: false })
        .simplify().latex;
      expect(latex).toContain('x^{');
      expect(latex).not.toContain('\\log');
    });
  });

  describe('Bug #178: xx should simplify to x^2', () => {
    test('xx -> x^2', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('xx', { canonical: false }).simplify().latex).toBe('x^2');
    });
  });
});
