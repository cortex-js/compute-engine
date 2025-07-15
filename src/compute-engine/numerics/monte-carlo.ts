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
  n = 1e5
): { estimate: number; error: number } {
  let sum = 0;
  let sumSq = 0;

  if (a === -Infinity && b === Infinity) {
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const x = Math.tan(Math.PI * (u - 0.5));
      const jacobian = Math.PI * (1 + x * x);
      const val = f(x) / jacobian;
      sum += val;
      sumSq += val * val;
    }
  } else if (a === -Infinity) {
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const x = b - Math.log(1 - u);
      const jacobian = 1 / (1 - u);
      const val = f(x) / jacobian;
      sum += val;
      sumSq += val * val;
    }
  } else if (b === Infinity) {
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const x = a + Math.log(u);
      const jacobian = 1 / u;
      const val = f(x) / jacobian;
      sum += val;
      sumSq += val * val;
    }
  } else {
    // Proper integral
    for (let i = 0; i < n; i++) {
      const val = f(a + Math.random() * (b - a));
      sum += val;
      sumSq += val * val;
    }
  }

  const mean = sum / n;
  const variance = (sumSq - n * mean * mean) / (n - 1);
  const stdError = Math.sqrt(variance / n);
  const scale = b - a;

  const estimate = mean * scale;
  const error = stdError * scale;

  const rounded = roundEstimateToError(estimate, error);
  return rounded;
}
