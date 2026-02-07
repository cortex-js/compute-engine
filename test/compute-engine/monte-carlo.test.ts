import { monteCarloEstimate } from '../../src/compute-engine/numerics/monte-carlo';

// Monte Carlo is stochastic — use generous tolerances.
// With n=1e6, standard error is typically ~1e-3 for well-behaved integrands.
const N = 1e6;
const TOL = 0.05; // 5% relative tolerance for most tests
const ABS_TOL = 0.1; // absolute tolerance for values near zero

function expectApprox(
  actual: number,
  expected: number,
  tolerance = TOL,
  absTolerance = ABS_TOL
) {
  if (Math.abs(expected) < 1e-10) {
    expect(Math.abs(actual)).toBeLessThan(absTolerance);
  } else {
    const relError = Math.abs((actual - expected) / expected);
    expect(relError).toBeLessThan(tolerance);
  }
}

describe('Monte Carlo integration', () => {
  describe('finite intervals', () => {
    test('∫_0^1 x² dx = 1/3', () => {
      const { estimate } = monteCarloEstimate((x) => x * x, 0, 1, N);
      expectApprox(estimate, 1 / 3);
    });

    test('∫_0^π sin(x) dx = 2', () => {
      const { estimate } = monteCarloEstimate(
        (x) => Math.sin(x),
        0,
        Math.PI,
        N
      );
      expectApprox(estimate, 2);
    });

    test('∫_0^1 1 dx = 1', () => {
      const { estimate } = monteCarloEstimate(() => 1, 0, 1, N);
      expectApprox(estimate, 1);
    });
  });

  describe('semi-infinite intervals [a, +∞)', () => {
    test('∫_0^∞ e^(-x) dx = 1', () => {
      const { estimate } = monteCarloEstimate(
        (x) => Math.exp(-x),
        0,
        Infinity,
        N
      );
      expectApprox(estimate, 1);
    });

    test('∫_1^∞ 1/x² dx = 1', () => {
      // Heavy-tailed integrand — higher variance, needs wider tolerance
      const { estimate } = monteCarloEstimate(
        (x) => 1 / (x * x),
        1,
        Infinity,
        N
      );
      expectApprox(estimate, 1, 0.15);
    });
  });

  describe('semi-infinite intervals (-∞, b]', () => {
    test('∫_{-∞}^0 e^x dx = 1', () => {
      const { estimate } = monteCarloEstimate(
        (x) => Math.exp(x),
        -Infinity,
        0,
        N
      );
      expectApprox(estimate, 1);
    });
  });

  describe('doubly-infinite intervals (-∞, +∞)', () => {
    test('∫_{-∞}^{∞} e^{-x²} dx = √π', () => {
      const { estimate } = monteCarloEstimate(
        (x) => Math.exp(-x * x),
        -Infinity,
        Infinity,
        N
      );
      expectApprox(estimate, Math.sqrt(Math.PI));
    });

    test('∫_{-∞}^{∞} 1/(1+x²) dx = π', () => {
      const { estimate } = monteCarloEstimate(
        (x) => 1 / (1 + x * x),
        -Infinity,
        Infinity,
        N
      );
      expectApprox(estimate, Math.PI);
    });
  });

  describe('error estimates', () => {
    test('error is finite and non-negative', () => {
      const { error } = monteCarloEstimate(
        (x) => Math.exp(-x),
        0,
        Infinity,
        N
      );
      expect(error).toBeGreaterThanOrEqual(0);
      expect(isFinite(error)).toBe(true);
    });

    test('estimate is finite for improper integrals', () => {
      const { estimate } = monteCarloEstimate(
        (x) => Math.exp(-x * x),
        -Infinity,
        Infinity,
        N
      );
      expect(isFinite(estimate)).toBe(true);
    });
  });
});
