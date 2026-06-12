import { ComputeEngine } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';
import { extrapolate } from '../../src/compute-engine/numerics/richardson';
import { monteCarloEstimate } from '../../src/compute-engine/numerics/monte-carlo';

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
        .expr(['Sum', 'k', ['Tuple', 'k', 1, 100]])
        .evaluate();
      expect(result.re).toBe(5050);
    });

    it('large sum throws CancellationError', () => {
      // Sum k^k for k=1..100000 — each iteration evaluates k^k which gets
      // expensive, and there are 100K of them
      expect(() =>
        ce
          .expr([
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
        .expr(['Product', 'k', ['Tuple', 'k', 1, 10]])
        .evaluate();
      // 10! = 3628800
      expect(result.re).toBe(3628800);
    });

    it('large product throws CancellationError', () => {
      expect(() =>
        ce
          .expr([
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
        .expr(['Loop', ['Function', ['Multiply', 'x', 2], 'x'], list])
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
          .expr([
            'Loop',
            ['Function', ['Power', 'x', 'x'], 'x'],
            list,
          ])
          .evaluate()
      ).toThrow(CancellationError);
    });
  });

  describe('Number theory divisor loops', () => {
    it('small Totient completes within timeout', () => {
      const result = ce.expr(['Totient', 100]).evaluate();
      expect(result.re).toBe(40);
    });

    it('huge Totient throws CancellationError', () => {
      expect(() => ce.expr(['Totient', 1_000_000_000]).evaluate()).toThrow(
        CancellationError
      );
    });

    it('huge Sigma0 throws CancellationError', () => {
      expect(() => ce.expr(['Sigma0', 10_000_000_000]).evaluate()).toThrow(
        CancellationError
      );
    });

    it('huge Sigma1 throws CancellationError', () => {
      expect(() => ce.expr(['Sigma1', 10_000_000_000]).evaluate()).toThrow(
        CancellationError
      );
    });

    it('huge IsPerfect throws CancellationError', () => {
      expect(() => ce.expr(['IsPerfect', 10_000_000_000]).evaluate()).toThrow(
        CancellationError
      );
    });

    it('exponential Eulerian recursion throws CancellationError', () => {
      expect(() => ce.expr(['Eulerian', 60, 30]).evaluate()).toThrow(
        CancellationError
      );
    });
  });

  describe('Collection enumeration', () => {
    it('small collection enumeration completes within timeout', () => {
      const result = ce
        .expr(['CountIf', ['Range', 100], ['Function', 'True']])
        .evaluate();
      expect(result.re).toBe(100);
    });

    it('enumeration of a huge Range throws CancellationError', () => {
      expect(() =>
        ce
          .expr(['CountIf', ['Range', 100_000_000], ['Function', 'True']])
          .evaluate()
      ).toThrow(CancellationError);
    });
  });

  describe('Numeric limit (Richardson extrapolation)', () => {
    it('extrapolate aborts when the deadline has passed', () => {
      expect(() =>
        extrapolate((x) => Math.sin(x) / x, 0, { deadline: Date.now() - 1 })
      ).toThrow(CancellationError);
    });

    it('extrapolate aborts mid-run with a slow integrand', () => {
      const deadline = Date.now() + 20;
      const slow = (x: number) => {
        const end = Date.now() + 5;
        while (Date.now() < end) {
          /* busy-wait to simulate an expensive function evaluation */
        }
        // A function with no limit at 0, so extrapolation cannot
        // converge and exit early
        return Math.sin(1 / x);
      };
      expect(() =>
        extrapolate(slow, 0, { deadline, breaktol: Infinity })
      ).toThrow(CancellationError);
    });

    it('NLimit completes within timeout for a well-behaved function', () => {
      const result = ce
        .expr(['NLimit', ['Function', ['Divide', ['Sin', 'x'], 'x'], 'x'], 0])
        .evaluate();
      expect(result.re).toBeCloseTo(1, 6);
    });
  });

  describe('Monte Carlo quadrature', () => {
    it('throws when the deadline passed before any sample was taken', () => {
      expect(() =>
        monteCarloEstimate((x) => x * x, 0, 1, 1e5, Date.now() - 1)
      ).toThrow(CancellationError);
    });

    it('returns a partial estimate when the deadline passes mid-run', () => {
      // 1e8 samples take well over 20ms: the deadline passes mid-run and
      // the estimate from the samples taken so far is still returned.
      const deadline = Date.now() + 20;
      const { estimate } = monteCarloEstimate(
        (x) => x * x,
        0,
        1,
        1e8,
        deadline
      );
      expect(estimate).toBeCloseTo(1 / 3, 1);
    });

    it('completes without a deadline', () => {
      const { estimate } = monteCarloEstimate((x) => x * x, 0, 1, 1e5);
      expect(estimate).toBeCloseTo(1 / 3, 1);
    });
  });

  describe('Symbolic differentiation', () => {
    it('first derivative of LambertW completes within timeout', () => {
      const r = ce
        .expr([
          'Apply',
          ['Derivative', ['Function', ['LambertW', 'z'], 'z'], 1],
          0.5,
        ])
        .evaluate()
        .N();
      // W'(x) = W(x)/(x(1+W(x))): at 0.5, ≈ 0.5204186421068739
      expect(r.re).toBeCloseTo(0.5204186421068739, 8);
    });

    it('high-order derivative is bounded (width blow-up, REVIEW.md G8)', () => {
      // The r-th symbolic derivative of LambertW grows combinatorially in
      // width (Fungrim 8e8a59 wedged Stage-2 at 100% CPU toward OOM).
      // It must either complete or throw CancellationError — within a
      // bounded multiple of the time limit, never unbounded.
      const start = Date.now();
      try {
        ce.expr([
          'Apply',
          ['Derivative', ['Function', ['LambertW', 'z'], 'z'], 9],
          0,
        ]).evaluate();
      } catch (e) {
        expect(e).toBeInstanceOf(CancellationError);
      }
      expect(Date.now() - start).toBeLessThan(5000);
    });
  });

  describe('Nested numeric integration', () => {
    it('double integral is bounded by the ambient deadline', () => {
      // ∫₀¹∫₀¹ 1/(1+x²y²) dx dy (= Catalan) — the inner integral runs via
      // compiled code with no engine access and previously sampled
      // unbounded (10⁷ × 10⁷ evaluations → OOM). It now inherits the outer
      // deadline. (Fungrim 5b31ee)
      const start = Date.now();
      try {
        ce.expr([
          'Integrate',
          [
            'Integrate',
            [
              'Divide',
              1,
              ['Add', 1, ['Multiply', ['Power', 'x', 2], ['Power', 'y', 2]]],
            ],
            ['Limits', 'x', 0, 1],
          ],
          ['Limits', 'y', 0, 1],
        ]).N();
      } catch (e) {
        expect(e).toBeInstanceOf(CancellationError);
      }
      expect(Date.now() - start).toBeLessThan(5000);
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
