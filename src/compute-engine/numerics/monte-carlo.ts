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
export function monteCarloEstimate(
  f: (x: number) => number,
  a: number,
  b: number,
  n = 1e5
): number {
  let sum = 0;

  if (a === -Infinity && b === Infinity) {
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const x = Math.tan(Math.PI * (u - 0.5));
      const jacobian = Math.PI * (1 + x * x);
      sum += f(x) / jacobian;
    }
  } else if (a === -Infinity) {
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const x = b - Math.log(1 - u);
      const jacobian = 1 / (1 - u);
      sum += f(x) / jacobian;
    }
  } else if (b === Infinity) {
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const x = a + Math.log(u);
      const jacobian = 1 / u;
      sum += f(x) / jacobian;
    }
  } else {
    // Proper integral
    for (let i = 0; i < n; i++) sum += f(a + Math.random() * (b - a));
  }

  return (sum / n) * (b - a);
}
