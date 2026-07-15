import { ComputeEngine } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';
import { extrapolate } from '../../src/compute-engine/numerics/richardson';
import { monteCarloEstimate } from '../../src/compute-engine/numerics/monte-carlo';
import { polynomialGCD } from '../../src/compute-engine/boxed-expression/polynomials';

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
      const result = ce.expr(['Sum', 'k', ['Tuple', 'k', 1, 100]]).evaluate();
      expect(result.re).toBe(5050);
    });

    it('large sum throws CancellationError', () => {
      // Sum k^k for k=1..100000 — each iteration evaluates k^k which gets
      // expensive, and there are 100K of them
      expect(() =>
        ce
          .expr(['Sum', ['Power', 'k', 'k'], ['Tuple', 'k', 1, 100_000]])
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
          .expr(['Product', ['Power', 'k', 2], ['Tuple', 'k', 1, 100_000]])
          .evaluate()
      ).toThrow(CancellationError);
    });
  });

  describe('Loop', () => {
    it('finite for-effect loop completes within timeout, evaluates to Nothing', () => {
      const list = ce.function(
        'List',
        Array.from({ length: 5 }, (_, i) => ce.number(i + 1))
      );
      // A `Loop` is imperative / for effect: it iterates the body over the
      // collection and evaluates to `Nothing`.
      const result = ce
        .expr(['Loop', ['Multiply', 'x', 2], ['Element', 'x', list]])
        .evaluate();
      expect(result.symbol).toBe('Nothing');
    });

    it('loop over large collection throws CancellationError', () => {
      const list = ce.function(
        'List',
        Array.from({ length: 50_000 }, (_, i) => ce.number(i))
      );
      // Body does expensive work per element
      expect(() =>
        ce
          .expr(['Loop', ['Power', 'x', 'x'], ['Element', 'x', list]])
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

  describe('Simplify', () => {
    it('fast simplify completes within timeout', () => {
      const result = ce.parse('\\frac{x^2-1}{x-1}').simplify();
      expect(result.toString()).toBe('x + 1');
    });

    it('runaway polynomial cancellation throws CancellationError', () => {
      // Divide of two expanded radical-coefficient polynomials: the
      // cancel-common-factors rule runs a Euclidean polynomialGCD whose
      // remainder coefficients (exact radicals) grow without bound —
      // observed running for minutes before the deadline check.
      const num = ce
        .expr([
          'Expand',
          ['Power', ['Add', ['Multiply', ['Sqrt', 2], 'x'], ['Sqrt', 3]], 9],
        ])
        .evaluate();
      const den = ce
        .expr([
          'Expand',
          ['Power', ['Add', ['Multiply', ['Sqrt', 2], 'x'], ['Sqrt', 5]], 8],
        ])
        .evaluate();
      const start = Date.now();
      expect(() => ce.function('Divide', [num, den]).simplify()).toThrow(
        CancellationError
      );
      // Interrupted near the 200ms time limit, not after minutes
      expect(Date.now() - start).toBeLessThan(5000);
    });

    it('deadline is reset after simplify timeout', () => {
      const num = ce
        .expr([
          'Expand',
          ['Power', ['Add', ['Multiply', ['Sqrt', 2], 'x'], ['Sqrt', 3]], 9],
        ])
        .evaluate();
      const den = ce
        .expr([
          'Expand',
          ['Power', ['Add', ['Multiply', ['Sqrt', 2], 'x'], ['Sqrt', 5]], 8],
        ])
        .evaluate();
      expect(() => ce.function('Divide', [num, den]).simplify()).toThrow(
        CancellationError
      );
      expect(ce._deadline).toBeUndefined();
      // Subsequent simplify still works
      expect(ce.parse('x+x').simplify().toString()).toBe('2x');
    });
  });

  describe('Substitution storm (nested user functions)', () => {
    // A user function whose body references its parameter several times
    // multiplies the expression tree at every nesting level: a symbolic
    // Newton-iteration chain s(y, s(y, … s(y, x_0))) is Θ(4^depth) nodes.
    // The per-node checkpoint in `_computeValue` must cancel it at the
    // deadline — before the fix, the allocation storm never hit a
    // checkpoint and ran to heap exhaustion (Tycho, 2026-07-14).
    const defineNewton = () => {
      ce.parse('f(x) := x + 0.95\\cos(x) + 1').evaluate();
      ce.parse("s(y, x_p) := \\frac{y - f(x_p)}{f'(x_p)} + x_p").evaluate();
      let chain = 'x_0';
      for (let i = 0; i < 15; i++) chain = `s(y, ${chain})`;
      return ce.parse(chain);
    };

    it('symbolic nested chain throws CancellationError (sync)', () => {
      expect(() => defineNewton().evaluate()).toThrow(CancellationError);
    });

    it('symbolic nested chain throws CancellationError (async)', async () => {
      await expect(defineNewton().evaluateAsync()).rejects.toThrow(
        CancellationError
      );
    });

    it('numeric nested chain completes (folds to a number per level)', () => {
      ce.timeLimit = 2000;
      ce.parse('f(x) := x + 0.95\\cos(x) + 1').evaluate();
      ce.parse("s(y, x_p) := \\frac{y - f(x_p)}{f'(x_p)} + x_p").evaluate();
      let chain = '1.5';
      for (let i = 0; i < 15; i++) chain = `s(2.7, ${chain})`;
      expect(ce.parse(chain).evaluate().isFinite).toBe(true);
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

describe('RECURSION LIMIT', () => {
  // Declare the function name first so the recursive call in its body parses
  // as a function application (not implicit multiplication), then bind it.
  const define = (name: string, latex: string) => {
    ce.declare(name, 'function');
    ce.parse(latex).evaluate();
  };

  it('bounded recursion completes', () => {
    define('g', 'g(x) := \\mathrm{If}(x \\le 1, 1, x \\cdot g(x-1))');
    expect(ce.box(['g', 5]).evaluate().toString()).toBe('120');
  });

  it('runaway recursion throws a CancellationError, not a native RangeError', () => {
    // A low limit fires well before any native stack limit, on any machine.
    ce.recursionLimit = 64;
    define('r', 'r(x) := r(x-1) + 1'); // no reachable base case
    let error: unknown;
    try {
      ce.box(['r', 5]).evaluate();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CancellationError);
    expect((error as CancellationError).cause).toBe('recursion-depth-exceeded');
  });

  it('respects a custom recursionLimit', () => {
    ce.recursionLimit = 16;
    define('g', 'g(x) := \\mathrm{If}(x \\le 1, 1, x \\cdot g(x-1))');
    expect(ce.box(['g', 8]).evaluate().toString()).toBe('40320'); // depth 8 < 16
    expect(() => ce.box(['g', 100]).evaluate()).toThrow(CancellationError);
  });

  it('recursion depth resets after a runaway error', () => {
    ce.recursionLimit = 64;
    define('r', 'r(x) := r(x-1) + 1');
    expect(() => ce.box(['r', 5]).evaluate()).toThrow(CancellationError);
    // A subsequent bounded recursion still works (depth counter not stuck).
    define('g', 'g(x) := \\mathrm{If}(x \\le 1, 1, x \\cdot g(x-1))');
    expect(ce.box(['g', 5]).evaluate().toString()).toBe('120');
  });

  it('iterating a user function is not counted as recursion', () => {
    // Each f(i) is a depth-1 call; summing 200 of them must not hit the limit.
    ce.recursionLimit = 32;
    define('f', 'f(x) := x^2');
    expect(ce.parse('\\sum_{i=1}^{200} f(i)').evaluate().re).toBe(2686700);
  });
});

describe('Symbolic polynomial GCD terminates', () => {
  // The Euclidean loop divided by a symbolic constant, which produced a
  // spurious nonzero constant remainder (never structurally 0), so the loop
  // spun forever building ever-larger coefficient expressions. This surfaced
  // as a definite integral hanging ~109 s under a 3 s `timeLimit`
  // (∫₀ˣ (u−a)/(b₂u²+b₁u+b₀) du). A nonzero constant remainder now correctly
  // resolves the GCD to 1 (coprime over the field); the test hanging at all
  // would fail via Jest's own timeout.
  it('coprime linear / symbolic-quadratic GCD returns 1 (was a hang)', () => {
    const engine = new ComputeEngine();
    const gcd = polynomialGCD(
      engine.parse('u - a'),
      engine.parse('b_2 u^2 + b_1 u + b_0'),
      'u'
    );
    expect(gcd.isSame(1)).toBe(true);
  });

  it('the symbolic-coefficient rational integral no longer hangs', () => {
    const engine = new ComputeEngine();
    engine.timeLimit = 3000;
    // Completes quickly now (stays inert without the Rubi rules); the point is
    // it returns rather than spinning past the deadline.
    const r = engine
      .parse('\\int_0^x \\frac{u-a}{b_2 u^2 + b_1 u + b_0}\\,du')
      .evaluate();
    expect(r.isValid).toBe(true);
  });
});
