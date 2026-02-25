import { ComputeEngine } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';

// Use a dedicated engine with a short timeout for all tests
let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
  ce.timeLimit = 200; // 200ms — short enough to catch hangs, long enough for CI
});

describe('TIMEOUT', () => {
  describe('Factorial', () => {
    it('normal factorial completes within timeout', () => {
      const result = ce.parse('700!').evaluate();
      expect(result.isFinite).toBe(true);
    });

    it('nested factorial (700!)! throws CancellationError (sync)', () => {
      expect(() => ce.parse('(700!)!').evaluate()).toThrow(CancellationError);
    });

    it('nested factorial (700!)! throws CancellationError (async)', async () => {
      await expect(ce.parse('(700!)!').evaluateAsync()).rejects.toThrow(
        CancellationError
      );
    });
  });

  describe('Factorial2', () => {
    it('normal double factorial completes within timeout', () => {
      const result = ce.parse('10!!').evaluate();
      expect(result.re).toBe(3840);
    });

    it('large double factorial in bignum mode throws CancellationError', () => {
      ce.precision = 200; // enable bignum path
      ce.timeLimit = 5; // very short — 5ms
      expect(() => ce.parse('100000!!').evaluate()).toThrow(CancellationError);
    });
  });

  describe('Sum', () => {
    it('small sum completes within timeout', () => {
      const result = ce
        .box(['Sum', 'k', ['Tuple', 'k', 1, 100]])
        .evaluate();
      expect(result.re).toBe(5050);
    });

    it('large sum throws CancellationError', () => {
      // Sum k^k for k=1..100000 — each iteration evaluates k^k which gets
      // expensive, and there are 100K of them
      expect(() =>
        ce
          .box([
            'Sum',
            ['Power', 'k', 'k'],
            ['Tuple', 'k', 1, 100_000],
          ])
          .evaluate()
      ).toThrow(CancellationError);
    });
  });

  describe('Product', () => {
    it('small product completes within timeout', () => {
      const result = ce
        .box(['Product', 'k', ['Tuple', 'k', 1, 10]])
        .evaluate();
      // 10! = 3628800
      expect(result.re).toBe(3628800);
    });

    it('large product throws CancellationError', () => {
      expect(() =>
        ce
          .box([
            'Product',
            ['Power', 'k', 2],
            ['Tuple', 'k', 1, 100_000],
          ])
          .evaluate()
      ).toThrow(CancellationError);
    });
  });

  describe('Loop', () => {
    it('finite loop completes within timeout', () => {
      const list = ce.function(
        'List',
        Array.from({ length: 5 }, (_, i) => ce.number(i + 1))
      );
      // Loop applies body (a lambda) to each element, returns the last result
      const result = ce
        .box(['Loop', ['Function', ['Multiply', 'x', 2], 'x'], list])
        .evaluate();
      expect(result.re).toBe(10); // last element 5 * 2 = 10
    });

    it('loop over large collection throws CancellationError', () => {
      const list = ce.function(
        'List',
        Array.from({ length: 50_000 }, (_, i) => ce.number(i))
      );
      // Body does expensive work per element
      expect(() =>
        ce
          .box([
            'Loop',
            ['Function', ['Power', 'x', 'x'], 'x'],
            list,
          ])
          .evaluate()
      ).toThrow(CancellationError);
    });
  });

  describe('deadline cleanup', () => {
    it('deadline is reset after timeout so subsequent evaluations work', () => {
      // First: trigger a timeout
      expect(() => ce.parse('(700!)!').evaluate()).toThrow(CancellationError);

      // Second: a normal evaluation should still work (deadline was cleaned up)
      const result = ce.parse('10!').evaluate();
      expect(result.re).toBe(3628800);
    });

    it('deadline is reset after successful evaluation', () => {
      ce.parse('100!').evaluate();

      // _deadline should be undefined after completion
      expect(ce._deadline).toBeUndefined();
    });
  });
});
