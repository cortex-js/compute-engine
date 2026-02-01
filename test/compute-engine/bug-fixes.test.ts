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
});
