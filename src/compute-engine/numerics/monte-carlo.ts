/**
 * Return a numerical approximation of the integral
 * of the function `f` from `a` to `b` using Monte Carlo integration.
 *
 * Thoughts for future improvements:
 * - use a MISER algorithm to improve the accuracy
 * - use a stratified sampling to improve the accuracy
 * - use a quasi-Monte Carlo method to improve the accuracy
 * - use a Markov Chain Monte Carlo method to improve the accuracy
 * - use a Metropolis-Hastings algorithm to improve the accuracy
 * - use a Hamiltonian Monte Carlo algorithm to improve the accuracy
 * - use a Gibbs sampling algorithm to improve the accuracy
 *
 *
 * See:
 * - https://64.github.io/monte-carlo/
 *
 */
import {
  CancellationError,
  checkDeadline,
  getAmbientDeadline,
  withAmbientDeadline,
} from '../../common/interruptible';

/**
 * Rounds the error to 2 significant digits, and rounds the estimate
 * to the same decimal place as the error.
 * Returns an object with the rounded estimate and error.
 */
function roundEstimateToError(
  estimate: number,
  error: number
): { estimate: number; error: number } {
  if (error === 0) return { estimate, error };
  // Get the order of magnitude of the error
  const absError = Math.abs(error);
  const order = Math.floor(Math.log10(absError));
  // We want two significant digits for error
  const errorSigDigits = 2;
  const factor = Math.pow(10, order - (errorSigDigits - 1));
  // Round error to 2 significant digits
  const roundedError = Math.round(error / factor) * factor;
  // Now, round estimate to the same decimal place as the error
  // Find how many decimal places are needed
  const decimals = Math.max(0, -(order - (errorSigDigits - 1)));
  const roundedEstimate = Number(estimate.toFixed(decimals));
  return { estimate: roundedEstimate, error: roundedError };
}

export function monteCarloEstimate(
  f: (x: number) => number,
  a: number,
  b: number,
  n = 1e5,
  deadline?: number
): { estimate: number; error: number } {
  // Nested integration: a call reached through compiled code (e.g. the
  // inner integral of a double integral, via `_SYS.integrate`) has no
  // deadline of its own — inherit the ambient one so the whole nest stays
  // bounded.
  deadline ??= getAmbientDeadline();

  let sampler: () => number;
  if (a === -Infinity && b === Infinity) {
    // Transform: x = tan(π(u - 1/2)), u ∈ (0,1) → x ∈ (-∞, +∞)
    // |dx/du| = π(1 + x²)
    // Estimator: f(x) * |dx/du| = f(x) * π(1 + x²)
    sampler = () => {
      const u = Math.random();
      const x = Math.tan(Math.PI * (u - 0.5));
      return f(x) * Math.PI * (1 + x * x);
    };
  } else if (a === -Infinity) {
    // Transform: x = b + ln(u), u ∈ (0,1) → x ∈ (-∞, b]
    // |dx/du| = 1/u
    // Estimator: f(x) * |dx/du| = f(x) / u
    sampler = () => {
      const u = Math.random();
      return f(b + Math.log(u)) / u;
    };
  } else if (b === Infinity) {
    // Transform: x = a - ln(u), u ∈ (0,1) → x ∈ [a, +∞)
    // |dx/du| = 1/u
    // Estimator: f(x) * |dx/du| = f(x) / u
    sampler = () => {
      const u = Math.random();
      return f(a - Math.log(u)) / u;
    };
  } else {
    // Finite interval [a, b]: standard uniform sampling
    sampler = () => f(a + Math.random() * (b - a));
  }

  let sum = 0;
  let sumSq = 0;
  let taken = 0;
  withAmbientDeadline(deadline, () => {
    for (let i = 0; i < n; i++) {
      // Check every 64 samples: cheap integrands pay ~Date.now()/64 per
      // sample; expensive integrands (e.g. nested integrals) overshoot the
      // deadline by at most 64 samples — and a nested deadline-aware call
      // aborts the very next sample anyway via the ambient deadline.
      if ((i & 0x3f) === 0 && deadline !== undefined && Date.now() >= deadline) {
        // Out of time. Monte Carlo degrades gracefully: an estimate from
        // the samples taken so far (with its larger error) is more useful
        // than an error — but with no samples at all, give up.
        if (i === 0) checkDeadline(deadline);
        break;
      }
      let val: number;
      try {
        val = sampler();
      } catch (err) {
        // A nested deadline-aware routine (e.g. an inner integral) ran out
        // of time: stop sampling and use what we have. With no samples at
        // all, propagate the cancellation.
        if (err instanceof CancellationError && taken > 0) break;
        throw err;
      }
      sum += val;
      sumSq += val * val;
      taken++;
    }
  });

  const mean = sum / taken;
  const variance = (sumSq - taken * mean * mean) / (taken - 1);
  const stdError = Math.sqrt(variance / taken);

  // Only the finite-interval case needs (b - a) scaling.
  // The transformed cases already incorporate the measure via Jacobian.
  const scale = isFinite(a) && isFinite(b) ? b - a : 1;

  const estimate = mean * scale;
  const error = stdError * scale;

  const rounded = roundEstimateToError(estimate, error);
  return rounded;
}
