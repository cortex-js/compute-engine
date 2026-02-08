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
