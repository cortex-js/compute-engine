import type { IComputeEngine as ComputeEngine } from '../global-types';
import type { BigNum } from './types';

const gammaG = 7;
const lanczos_7_c = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

// const gammaGLn = 607 / 128;
// const gammaPLn = [
//   0.999999999999997, 57.156235665862923, -59.59796035547549, 14.13609797474174,
//   -0.4919138160976202, 0.3399464998481188e-4, 0.4652362892704857e-4,
//   -0.9837447530487956e-4, 0.1580887032249125e-3, -0.21026444172410488e-3,
//   0.2174396181152126e-3, -0.16431810653676389e-3, 0.8441822398385274e-4,
//   -0.261908384015814e-4, 0.3689918265953162e-5,
// ];

export function gammaln(z: number): number {
  // From WikiPedia:
  // \ln \Gamma (z)=z\ln z-z-{\tfrac {1}{2}}\ln z+{\tfrac {1}{2}}\ln 2\pi +{\frac {1}{12z}}-{\frac {1}{360z^{3}}}+{\frac {1}{1260z^{5}}}+o\left({\frac {1}{z^{5}}}\right)

  if (z < 0) return NaN;
  const pi = Math.PI;
  const z3 = z * z * z;
  return (
    z * Math.log(z) -
    z -
    0.5 * Math.log(z) +
    0.5 * Math.log(2 * pi) +
    1 / (12 * z) -
    1 / (360 * z3) +
    1 / (1260 * z3 * z * z)
  );

  // Spouge approximation (suitable for large arguments)
  // if (z < 0) return NaN;
  // let x = gammaPLn[0];
  // for (let i = gammaPLn.length - 1; i > 0; --i) x += gammaPLn[i] / (z + i);
  // const t = z + gammaGLn + 0.5;
  // return (
  //   0.5 * Math.log(2 * Math.PI) +
  //   (z + 0.5) * Math.log(t) -
  //   t +
  //   Math.log(x) -
  //   Math.log(z)
  // );
}

// From https://github.com/substack/gamma.js/blob/master/index.js
export function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  if (z > 100) return Math.exp(gammaln(z));

  z -= 1;
  let x = lanczos_7_c[0];
  for (let i = 1; i < gammaG + 2; i++) x += lanczos_7_c[i] / (z + i);

  const t = z + gammaG + 0.5;

  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

/**
 * Inverse Error Function.
 *
 */
export function erfInv(x: number): number {
  // From https://en.wikipedia.org/wiki/Error_function#Numerical_approximations
  // {\displaystyle \operatorname {erf} ^{-1}z={\frac {\sqrt {\pi }}{2}}\left(z+{\frac {\pi }{12}}z^{3}+{\frac {7\pi ^{2}}{480}}z^{5}+{\frac {127\pi ^{3}}{40320}}z^{7}+{\frac {4369\pi ^{4}}{5806080}}z^{9}+{\frac {34807\pi ^{5}}{182476800}}z^{11}+\cdots \right).}

  const pi = Math.PI;
  const pi2 = pi * pi;
  const pi3 = pi2 * pi;
  const x2 = x * x;
  const x3 = x * x2;
  const x5 = x3 * x2;
  const x7 = x5 * x2;

  return (
    (Math.sqrt(pi) / 2) *
    (x +
      (pi / 12) * x3 +
      ((7 * pi2) / 480) * x5 +
      ((127 * pi3) / 40320) * x7 +
      ((4369 * pi2 * pi2) / 5806080) * x7 * x2 +
      ((34807 * pi3 * pi2) / 182476800) * x7 * x2 * x2)
  );

  // const a = 0.147;
  // const b = 2 / (Math.PI * a) + Math.log(1 - x ** 2) / 2;
  // const sqrt1 = Math.sqrt(b ** 2 - Math.log(1 - x ** 2) / a);
  // const sqrt2 = Math.sqrt(sqrt1 - b);
  // return sqrt2 * Math.sign(x);
}

/**
 * Trivial function, used when compiling.
 */
export function erfc(x: number): number {
  return 1 - erf(x);
}

/**
 * An approximation of the gaussian error function, Erf(), using
 * Abramowitz and Stegun approximation.
 * 
 * Thoughts for future improvements:
 * - https://math.stackexchange.com/questions/321569/approximating-the-error-function-erf-by-analytical-functions
 * - https://en.wikipedia.org/wiki/Error_function#Approximation_with_elementary_functions

 * 
 * References:
 * - NIST: https://dlmf.nist.gov/7.24#i
 */

export function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  // Save the sign of x
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  // Abramowitz and Stegun approximation
  // https://personal.math.ubc.ca/~cbm/aands/page_299.htm
  const t = 1.0 / (1.0 + p * x);
  const y = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;

  return sign * (1 - y * Math.exp(-x * x));
}

// Spouge approximation (suitable for large arguments)
export function bigGammaln(ce: ComputeEngine, z: BigNum): BigNum {
  if (z.isNegative()) return ce._BIGNUM_NAN;

  const GAMMA_P_LN = ce._cache<BigNum[]>('gamma-p-ln', () => {
    return [
      '0.99999999999999709182',
      '57.156235665862923517',
      '-59.597960355475491248',
      '14.136097974741747174',
      '-0.49191381609762019978',
      '0.33994649984811888699e-4',
      '0.46523628927048575665e-4',
      '-0.98374475304879564677e-4',
      '0.15808870322491248884e-3',
      '-0.21026444172410488319e-3',
      '0.2174396181152126432e-3',
      '-0.16431810653676389022e-3',
      '0.84418223983852743293e-4',
      '-0.2619083840158140867e-4',
      '0.36899182659531622704e-5',
    ].map((x) => ce.bignum(x));
  });

  let x = GAMMA_P_LN[0];
  for (let i = GAMMA_P_LN.length - 1; i > 0; --i) {
    x = x.add(GAMMA_P_LN[i].div(z.add(i)));
  }

  const GAMMA_G_LN = ce._cache('gamma-g-ln', () => ce.bignum(607).div(128));

  const t = z.add(GAMMA_G_LN).add(ce._BIGNUM_HALF);
  return ce._BIGNUM_NEGATIVE_ONE
    .acos()
    .mul(ce._BIGNUM_TWO)
    .log()
    .mul(ce._BIGNUM_HALF)
    .add(
      t.log().mul(z.add(ce._BIGNUM_HALF)).minus(t).add(x.log()).minus(z.log())
    );
}

// From https://github.com/substack/gamma.js/blob/master/index.js
export function bigGamma(ce: ComputeEngine, z: BigNum): BigNum {
  if (z.lessThan(ce._BIGNUM_HALF)) {
    const pi = ce._BIGNUM_NEGATIVE_ONE.acos();
    return pi.div(
      pi
        .mul(z)
        .sin()
        .mul(bigGamma(ce, ce._BIGNUM_ONE.sub(z)))
    );
  }

  if (z.greaterThan(100)) return bigGammaln(ce, z).exp();

  z = z.sub(1);

  // coefficients for gamma=7, kmax=8  Lanczos method
  // Source: GSL/specfunc/gamma.c
  const LANCZOS_7_C = ce._cache<BigNum[]>('lanczos-7-c', () => {
    return [
      '0.99999999999980993227684700473478',
      '676.520368121885098567009190444019',
      '-1259.13921672240287047156078755283',
      '771.3234287776530788486528258894',
      '-176.61502916214059906584551354',
      '12.507343278686904814458936853',
      '-0.13857109526572011689554707',
      '9.984369578019570859563e-6',
      '1.50563273514931155834e-7',
    ].map((x) => ce.bignum(x));
  });

  let x = LANCZOS_7_C[0];
  for (let i = 1; i < gammaG + 2; i++) x = x.add(LANCZOS_7_C[i].div(z.add(i)));

  const t = z.add(gammaG).add(ce._BIGNUM_HALF);
  return ce._BIGNUM_NEGATIVE_ONE
    .acos()
    .times(ce._BIGNUM_TWO)
    .sqrt()
    .mul(x.mul(t.neg().exp()).mul(t.pow(z.add(ce._BIGNUM_HALF))));
}

// Euler-Mascheroni constant
const EULER_MASCHERONI = 0.5772156649015329;

// Bernoulli numbers B_{2k} for k=1..10 (used in asymptotic expansions)
const BERNOULLI_2K = [
  1 / 6, // B_2
  -1 / 30, // B_4
  1 / 42, // B_6
  -1 / 30, // B_8
  5 / 66, // B_10
  -691 / 2730, // B_12
  7 / 6, // B_14
  -3617 / 510, // B_16
  43867 / 798, // B_18
  -174611 / 330, // B_20
];

/**
 * Digamma function ψ(x) = d/dx ln(Γ(x)) = Γ'(x)/Γ(x)
 * Uses recurrence to shift x > 7 then asymptotic expansion.
 */
export function digamma(x: number): number {
  if (!isFinite(x)) return NaN;

  // Reflection formula for negative values: ψ(1-x) = ψ(x) + π·cot(πx)
  if (x < 0) {
    if (Number.isInteger(x)) return NaN; // poles at non-positive integers
    return digamma(1 - x) - Math.PI / Math.tan(Math.PI * x);
  }

  // Special value
  if (x === 0) return NaN; // pole

  // Recurrence: ψ(x+1) = ψ(x) + 1/x — shift x up until x > 7
  let result = 0;
  let z = x;
  while (z < 7) {
    result -= 1 / z;
    z += 1;
  }

  // Asymptotic expansion: ψ(z) ~ ln(z) - 1/(2z) - Σ B_{2k}/(2k·z^{2k})
  result += Math.log(z) - 1 / (2 * z);
  let z2k = z * z; // z^2
  for (let k = 0; k < BERNOULLI_2K.length; k++) {
    result -= BERNOULLI_2K[k] / ((2 * (k + 1)) * z2k);
    z2k *= z * z;
  }

  return result;
}

/**
 * Trigamma function ψ₁(x) = d/dx ψ(x) = d²/dx² ln(Γ(x))
 * Uses recurrence + asymptotic expansion.
 */
export function trigamma(x: number): number {
  if (!isFinite(x)) return NaN;

  // Reflection formula: ψ₁(1-x) + ψ₁(x) = π²/sin²(πx)
  if (x < 0) {
    if (Number.isInteger(x)) return NaN;
    const s = Math.sin(Math.PI * x);
    return (Math.PI * Math.PI) / (s * s) - trigamma(1 - x);
  }

  if (x === 0) return NaN; // pole

  // Recurrence: ψ₁(x+1) = ψ₁(x) - 1/x²
  let result = 0;
  let z = x;
  while (z < 7) {
    result += 1 / (z * z);
    z += 1;
  }

  // Asymptotic: ψ₁(z) ~ 1/z + 1/(2z²) + Σ B_{2k}/z^{2k+1}
  result += 1 / z + 1 / (2 * z * z);
  let z2kp1 = z * z * z; // z^3
  for (let k = 0; k < BERNOULLI_2K.length; k++) {
    result += BERNOULLI_2K[k] / z2kp1;
    z2kp1 *= z * z;
  }

  return result;
}

/**
 * Polygamma function ψₙ(x) = dⁿ/dxⁿ ψ(x)
 * PolyGamma(0, x) = Digamma(x), PolyGamma(1, x) = Trigamma(x)
 * For n ≥ 2, uses recurrence + asymptotic expansion.
 */
export function polygamma(n: number, x: number): number {
  if (!Number.isInteger(n) || n < 0) return NaN;
  if (n === 0) return digamma(x);
  if (n === 1) return trigamma(x);
  if (!isFinite(x) || x === 0) return NaN;

  // Reflection formula for negative x
  if (x < 0) {
    if (Number.isInteger(x)) return NaN;
    // ψₙ(1-x) + (-1)^{n+1} ψₙ(x) = (-1)^n π dⁿ/dxⁿ cot(πx)
    // This is complex for general n, so use recurrence to shift to positive
    let result = 0;
    let z = x;
    const sign = n % 2 === 0 ? 1 : -1;
    while (z < 1) {
      // ψₙ(x) = ψₙ(x+1) + (-1)^{n+1} n! / x^{n+1}
      result += sign * factorial(n) / Math.pow(z, n + 1);
      z += 1;
    }
    return result + polygamma(n, z);
  }

  // Recurrence: ψₙ(x+1) = ψₙ(x) + (-1)^n n! / x^{n+1}
  let result = 0;
  let z = x;
  const sign = n % 2 === 0 ? -1 : 1;
  while (z < 7) {
    result += sign * factorial(n) / Math.pow(z, n + 1);
    z += 1;
  }

  // Asymptotic: ψₙ(z) ~ (-1)^{n+1} [ (n-1)!/z^n + n!/(2z^{n+1}) + Σ ... ]
  const signA = n % 2 === 0 ? -1 : 1;
  result += signA * factorial(n - 1) / Math.pow(z, n);
  result += signA * factorial(n) / (2 * Math.pow(z, n + 1));

  // Higher-order terms using Bernoulli numbers
  let zPow = Math.pow(z, n + 2);
  for (let k = 0; k < Math.min(BERNOULLI_2K.length, 6); k++) {
    const m = 2 * (k + 1);
    let coeff = 1;
    for (let j = 0; j < m; j++) coeff *= (n + j);
    result += signA * BERNOULLI_2K[k] * coeff / (factorial(m) * zPow);
    zPow *= z * z;
  }

  return result;
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/**
 * Beta function B(a, b) = Γ(a)Γ(b)/Γ(a+b)
 * Uses gamma directly for small args (more accurate) and gammaln for large.
 */
export function beta(a: number, b: number): number {
  // For large arguments, use gammaln to avoid overflow
  if (a > 100 || b > 100 || a + b > 100) {
    return Math.exp(gammaln(a) + gammaln(b) - gammaln(a + b));
  }
  // Direct computation: more accurate for small arguments
  return (gamma(a) * gamma(b)) / gamma(a + b);
}

/**
 * Riemann zeta function ζ(s) = Σ_{n=1}^∞ 1/n^s
 * Uses Borwein's algorithm for convergence acceleration.
 */
export function zeta(s: number): number {
  if (!isFinite(s)) return NaN;
  if (s === 1) return Infinity; // pole

  // Special values for positive even integers
  if (s === 0) return -0.5;
  if (s === 2) return (Math.PI * Math.PI) / 6;
  if (s === 4) return (Math.PI ** 4) / 90;
  if (s === 6) return (Math.PI ** 6) / 945;
  if (s === 8) return (Math.PI ** 8) / 9450;

  // Functional equation for Re(s) < 0:
  // ζ(s) = 2^s π^{s-1} sin(πs/2) Γ(1-s) ζ(1-s)
  if (s < 0) {
    return (
      Math.pow(2, s) *
      Math.pow(Math.PI, s - 1) *
      Math.sin((Math.PI * s) / 2) *
      gamma(1 - s) *
      zeta(1 - s)
    );
  }

  // Cohen-Villegas-Zagier acceleration for the Dirichlet eta function
  // ζ(s) = -1/(d_{n}(1-2^{1-s})) Σ_{k=0}^{n} (-1)^k (d_k - d_n) / (k+1)^s
  const n = 22;
  const d = zetaCoefficients(n);
  const dn = d[n];
  let sum = 0;
  for (let k = 0; k <= n; k++) {
    sum += (k % 2 === 0 ? 1 : -1) * (d[k] - dn) / Math.pow(k + 1, s);
  }
  return (-1 / (dn * (1 - Math.pow(2, 1 - s)))) * sum;
}

/** Cohen-Villegas-Zagier coefficients for zeta function acceleration.
 * d_k = Σ_{i=0}^{k} C(n,i) for the partial sums of binomial coefficients. */
function zetaCoefficients(n: number): number[] {
  const d = new Array(n + 1);
  d[0] = 1;
  for (let i = 1; i <= n; i++) {
    // C(n, i) = C(n, i-1) * (n-i+1) / i
    // d[i] = d[i-1] + C(n, i)
    d[i] = d[i - 1] + binomialCoeff(n, i);
  }
  return d;
}

function binomialCoeff(n: number, k: number): number {
  if (k > n - k) k = n - k;
  let r = 1;
  for (let i = 0; i < k; i++) {
    r = (r * (n - i)) / (i + 1);
  }
  return r;
}

/**
 * Lambert W function W₀(x): the principal branch satisfying W(x)·e^{W(x)} = x.
 * Uses Halley's method with appropriate initial guesses.
 */
export function lambertW(x: number): number {
  if (!isFinite(x)) return x; // ±Infinity, NaN
  if (x === 0) return 0;

  const e1 = 1 / Math.E; // 1/e ≈ 0.3679

  // W is defined for x >= -1/e
  if (x < -e1) return NaN;

  // Branch point: W(-1/e) = -1
  if (Math.abs(x + e1) < 1e-15) return -1;

  // Initial guess
  let w: number;
  if (x < 0) {
    // Near -1/e: use series expansion around branch point
    const p = Math.sqrt(2 * (Math.E * x + 1));
    w = -1 + p - p * p / 3 + (11 / 72) * p * p * p;
  } else if (x <= 1) {
    w = x * (1 - x * (1 - 1.5 * x)); // Padé-like initial guess for small x
  } else if (x < 100) {
    const lnx = Math.log(x);
    w = lnx - Math.log(lnx);
  } else {
    const l1 = Math.log(x);
    const l2 = Math.log(l1);
    w = l1 - l2 + l2 / l1;
  }

  // Halley's method: converges cubically
  for (let i = 0; i < 30; i++) {
    const ew = Math.exp(w);
    const wew = w * ew;
    const f = wew - x;
    const fp = ew * (w + 1);
    const fpp = ew * (w + 2);
    const delta = f / (fp - (f * fpp) / (2 * fp));
    w -= delta;
    if (Math.abs(delta) < 1e-15 * (1 + Math.abs(w))) break;
  }

  return w;
}
