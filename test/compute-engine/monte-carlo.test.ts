import { monteCarloEstimate } from '../../src/compute-engine/numerics/monte-carlo';
import { foldSeed, frameDraw } from '../../src/compute-engine/numerics/random';

// Monte Carlo is stochastic, but this suite is NOT: every estimate draws from
// a fixed-seed PCG3D substream (the engine's own counter-based generator, the
// same one `WithRandomSeed` uses), so a failure here means a regression in the
// estimator, never sampling luck. Unseeded, the heavy-tailed semi-infinite
// cases could red-flag any commit's gate at random (observed 2026-08-17:
// ∫_1^∞ 1/x² dx off by 0.63 once, then 3 consecutive passes).
//
// The tolerances still reflect the estimator's statistical accuracy at the
// pinned seeds — with n=1e6, standard error is typically ~1e-3 for
// well-behaved integrands — so they stay meaningful if a seed changes.
const N = 1e6;
const TOL = 0.05; // 5% relative tolerance for most tests
const ABS_TOL = 0.1; // absolute tolerance for values near zero

/** A deterministic uniform-[0,1) stream, seeded per test by a tag string. */
function seededDraw(tag: string): () => number {
  const [lo, hi] = foldSeed(tag);
  let n = 0;
  return () => frameDraw(lo, hi, n++);
}

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
      const { estimate } = monteCarloEstimate(
        (x) => x * x,
        0,
        1,
        N,
        undefined,
        seededDraw('x^2')
      );
      expectApprox(estimate, 1 / 3);
    });

    test('∫_0^π sin(x) dx = 2', () => {
      const { estimate } = monteCarloEstimate(
        (x) => Math.sin(x),
        0,
        Math.PI,
        N,
        undefined,
        seededDraw('sin')
      );
      expectApprox(estimate, 2);
    });

    test('∫_0^1 1 dx = 1', () => {
      const { estimate } = monteCarloEstimate(
        () => 1,
        0,
        1,
        N,
        undefined,
        seededDraw('one')
      );
      expectApprox(estimate, 1);
    });
  });

  describe('semi-infinite intervals [a, +∞)', () => {
    test('∫_0^∞ e^(-x) dx = 1', () => {
      const { estimate } = monteCarloEstimate(
        (x) => Math.exp(-x),
        0,
        Infinity,
        N,
        undefined,
        seededDraw('exp(-x)')
      );
      expectApprox(estimate, 1);
    });

    test('∫_1^∞ 1/x² dx = 1', () => {
      // Heavy-tailed integrand — higher variance, needs wider tolerance
      const { estimate } = monteCarloEstimate(
        (x) => 1 / (x * x),
        1,
        Infinity,
        N,
        undefined,
        seededDraw('1/x^2')
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
        N,
        undefined,
        seededDraw('exp(x)')
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
        N,
        undefined,
        seededDraw('gaussian')
      );
      expectApprox(estimate, Math.sqrt(Math.PI));
    });

    test('∫_{-∞}^{∞} 1/(1+x²) dx = π', () => {
      const { estimate } = monteCarloEstimate(
        (x) => 1 / (1 + x * x),
        -Infinity,
        Infinity,
        N,
        undefined,
        seededDraw('lorentzian')
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
        N,
        undefined,
        seededDraw('error-finite')
      );
      expect(error).toBeGreaterThanOrEqual(0);
      expect(isFinite(error)).toBe(true);
    });

    test('estimate is finite for improper integrals', () => {
      const { estimate } = monteCarloEstimate(
        (x) => Math.exp(-x * x),
        -Infinity,
        Infinity,
        N,
        undefined,
        seededDraw('improper-finite')
      );
      expect(isFinite(estimate)).toBe(true);
    });
  });

  describe('determinism', () => {
    test('the same seed replays the same estimate exactly', () => {
      const run = () =>
        monteCarloEstimate(
          (x) => Math.sin(x),
          0,
          Math.PI,
          1e4,
          undefined,
          seededDraw('replay')
        );
      expect(run()).toEqual(run());
    });
  });
});
