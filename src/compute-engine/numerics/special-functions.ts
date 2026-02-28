import type { IComputeEngine as ComputeEngine } from '../global-types';
import type { BigNum } from './types';
import { BigDecimal } from '../../big-decimal';

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

/**
 * Bignum log-Gamma via Stirling asymptotic series with runtime-computed
 * Bernoulli numbers.  Precision scales with BigDecimal.precision.
 *
 * Uses reflection for z < 0.5, exact formulas for positive integers and
 * half-integers, and for the general case shifts z upward so the asymptotic
 * series converges rapidly.
 */
export function bigGammaln(ce: ComputeEngine, z: BigNum): BigNum {
  if (!z.isFinite()) return BigDecimal.NAN;

  // Reflection: ln(Gamma(z)) = ln(pi) - ln(|sin(pi*z)|) - ln(Gamma(1-z))
  if (z.lt(BigDecimal.HALF)) {
    const pi = BigDecimal.PI;
    const sinPiZ = pi.mul(z).sin().abs();
    if (sinPiZ.isZero()) return BigDecimal.NAN;
    return pi.ln().sub(sinPiZ.ln()).sub(bigGammaln(ce, BigDecimal.ONE.sub(z)));
  }

  // Exact: positive integer z -> ln((z-1)!)
  if (z.isInteger() && z.isPositive()) {
    const n = z.toNumber();
    if (n <= 1) return BigDecimal.ZERO;
    let fact = 1n;
    for (let i = 2; i < n; i++) fact *= BigInt(i);
    return new BigDecimal(fact.toString()).ln();
  }

  // Exact: half-integer z = n + 1/2 -> ln((2n)! * sqrt(pi) / (4^n * n!))
  const zMinusHalf = z.sub(BigDecimal.HALF);
  if (zMinusHalf.isInteger() && !zMinusHalf.isNegative()) {
    const n = zMinusHalf.toNumber();
    if (n === 0) {
      // Gamma(1/2) = sqrt(pi), so ln(Gamma(1/2)) = ln(sqrt(pi)) = ln(pi)/2
      return BigDecimal.PI.ln().div(BigDecimal.TWO);
    }
    let fact2n = 1n;
    for (let i = 2; i <= 2 * n; i++) fact2n *= BigInt(i);
    let factN = 1n;
    for (let i = 2; i <= n; i++) factN *= BigInt(i);
    const fourN = 4n ** BigInt(n);
    return new BigDecimal(fact2n.toString())
      .ln()
      .add(BigDecimal.PI.ln().div(BigDecimal.TWO))
      .sub(new BigDecimal(fourN.toString()).ln())
      .sub(new BigDecimal(factN.toString()).ln());
  }

  // General: Stirling series with upward shift
  const p = BigDecimal.precision;
  const guard = 10;
  const shiftTarget = Math.ceil(0.37 * p);
  const zNum = z.toNumber();
  const m = Math.max(0, Math.ceil(shiftTarget - zNum));

  let logProduct = BigDecimal.ZERO;
  let w = z;
  for (let i = 0; i < m; i++) {
    logProduct = logProduct.add(w.ln());
    w = w.add(BigDecimal.ONE);
  }

  const maxTerms = Math.ceil(Math.PI * w.toNumber()) + 10;
  const bernoulliRationals = getBernoulliRationals(ce, maxTerms);

  // Stirling: (w - 1/2)*ln(w) - w + ln(2*pi)/2 + sum B_{2k}/(2k*(2k-1)*w^{2k-1})
  let result = w
    .sub(BigDecimal.HALF)
    .mul(w.ln())
    .sub(w)
    .add(BigDecimal.PI.mul(BigDecimal.TWO).ln().div(BigDecimal.TWO));

  const w2 = w.mul(w);
  let wPow = w; // w^1 -> w^3 -> w^5 -> ...
  const tol = new BigDecimal(10).pow(-(p + guard));
  const nTerms = Math.min(maxTerms, bernoulliRationals.length);
  for (let k = 0; k < nTerms; k++) {
    const twoK = 2 * (k + 1);
    const [bNum, bDen] = bernoulliRationals[k];
    const denom = BigInt(twoK) * BigInt(twoK - 1);
    const coeffNum = new BigDecimal(bNum.toString());
    const coeffDen = new BigDecimal((bDen * denom).toString());
    const term = coeffNum.div(coeffDen.mul(wPow));
    if (k > 0 && term.abs().lt(tol)) break;
    result = result.add(term);
    wPow = wPow.mul(w2);
  }

  return result.sub(logProduct);
}

/**
 * Bignum Gamma function.  Precision scales with BigDecimal.precision.
 *
 * Reflection for z < 0.5; general case delegates to exp(bigGammaln(z)).
 * Note: integer fast paths are in bigGammaln (returning exact ln(n!)).
 * bigGamma goes through exp(ln(...)) so the result is a full-precision float.
 */
export function bigGamma(ce: ComputeEngine, z: BigNum): BigNum {
  // Exact: positive integer → (z-1)!
  if (z.isInteger() && z.isPositive()) {
    const n = z.toNumber();
    let fact = 1n;
    for (let i = 2; i < n; i++) fact *= BigInt(i);
    return new BigDecimal(fact.toString());
  }

  // Reflection for z < 0.5: Gamma(z) = pi / (sin(pi*z) * Gamma(1-z))
  if (z.lt(BigDecimal.HALF)) {
    const pi = BigDecimal.PI;
    const sinPiZ = pi.mul(z).sin();
    if (sinPiZ.isZero()) return BigDecimal.NAN;
    return pi.div(sinPiZ.mul(bigGamma(ce, BigDecimal.ONE.sub(z))));
  }

  // General case
  return bigGammaln(ce, z).exp();
}

function gcdBigint(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function absBigint(x: bigint): bigint {
  return x < 0n ? -x : x;
}

/**
 * Compute even Bernoulli numbers B_2, B_4, ..., B_{2n} as exact rationals.
 * Returns [numerator, denominator] bigint pairs reduced to lowest terms.
 *
 * Uses the identity: sum_{k=0}^{m-1} C(m,k) * B_k = 0  (for m >= 2)
 * i.e. B_m = -1/(m+1) * sum_{k=0}^{m-1} C(m+1,k) * B_k
 *
 * Since all odd Bernoulli numbers except B_1 = -1/2 are zero, we compute
 * all B_k (k=0,1,2,...,2n) but only return the even ones.
 */
export function computeBernoulliEven(n: number): [bigint, bigint][] {
  // Store all Bernoulli numbers B_0..B_{2n} as [num, den] rationals
  const all: [bigint, bigint][] = [
    [1n, 1n],   // B_0 = 1
    [-1n, 2n],  // B_1 = -1/2
  ];

  for (let m = 2; m <= 2 * n; m++) {
    // Odd m > 1: B_m = 0
    if (m % 2 === 1) {
      all.push([0n, 1n]);
      continue;
    }

    // B_m = -1/(m+1) * sum_{k=0}^{m-1} C(m+1,k) * B_k
    const mp1 = BigInt(m + 1);
    let sumNum = 0n;
    let sumDen = 1n;
    let binom = 1n; // C(m+1, 0) = 1

    for (let k = 0; k < m; k++) {
      if (k > 0) {
        // C(m+1, k) = C(m+1, k-1) * (m+1 - k + 1) / k = C(m+1, k-1) * (m+2-k) / k
        binom = binom * (mp1 - BigInt(k) + 1n) / BigInt(k);
      }
      const [bkNum, bkDen] = all[k];
      if (bkNum === 0n) continue; // skip zero Bernoulli numbers
      // sum += binom * B_k
      sumNum = sumNum * bkDen + binom * bkNum * sumDen;
      sumDen = sumDen * bkDen;
      // Periodically reduce to keep numbers manageable
      if (k % 8 === 7) {
        const g = gcdBigint(absBigint(sumNum), sumDen);
        sumNum /= g;
        sumDen /= g;
      }
    }

    // B_m = -sum / (m+1)
    let num = -sumNum;
    let den = mp1 * sumDen;
    const g = gcdBigint(absBigint(num), absBigint(den));
    num /= g;
    den /= g;
    if (den < 0n) { num = -num; den = -den; }
    all.push([num, den]);
  }

  // Return only even-indexed: B_2, B_4, ..., B_{2n}
  const result: [bigint, bigint][] = [];
  for (let i = 1; i <= n; i++) {
    result.push(all[2 * i]);
  }
  return result;
}

function getBernoulliRationals(
  ce: ComputeEngine,
  minTerms: number
): [bigint, bigint][] {
  return ce._cache<[bigint, bigint][]>(
    'bernoulli-even-rationals',
    () => computeBernoulliEven(minTerms),
    (existing) => {
      if (existing.length >= minTerms) return existing;
      return computeBernoulliEven(minTerms);
    }
  );
}


/**
 * Bignum Digamma function ψ(z) = d/dz ln(Γ(z))
 * Same algorithm as machine `digamma`: reflection for negative z,
 * recurrence to shift z > 7, then asymptotic expansion with Bernoulli numbers.
 */
export function bigDigamma(ce: ComputeEngine, z: BigNum): BigNum {
  if (!z.isFinite()) return BigDecimal.NAN;

  // Reflection formula for negative values: ψ(1-z) = ψ(z) + π·cot(πz)
  if (z.isNegative()) {
    if (z.isInteger()) return BigDecimal.NAN; // poles at non-positive integers
    const pi = BigDecimal.PI;
    const piZ = pi.mul(z);
    const cotPiZ = piZ.cos().div(piZ.sin());
    return bigDigamma(ce, BigDecimal.ONE.sub(z)).sub(pi.mul(cotPiZ));
  }

  if (z.isZero()) return BigDecimal.NAN; // pole

  const p = BigDecimal.precision;
  const guard = 10;
  const shift = Math.max(7, Math.ceil(0.37 * p));

  // Recurrence: ψ(z+1) = ψ(z) + 1/z — shift z up until z > shift
  let result = new BigDecimal(0);
  let w = z;
  while (w.lt(shift)) {
    result = result.sub(BigDecimal.ONE.div(w));
    w = w.add(BigDecimal.ONE);
  }

  const maxTerms = Math.ceil(Math.PI * w.toNumber()) + 10;
  const bernoulli = getBernoulliRationals(ce, maxTerms);

  // Asymptotic expansion: ψ(w) ~ ln(w) - 1/(2w) - Σ B_{2k}/(2k·w^{2k})
  result = result.add(w.ln()).sub(BigDecimal.ONE.div(w.mul(2)));
  let w2k = w.mul(w); // w^2
  const w2 = w2k;
  const tol = new BigDecimal(10).pow(-(p + guard));
  const nTerms = Math.min(maxTerms, bernoulli.length);
  for (let k = 0; k < nTerms; k++) {
    const [bNum, bDen] = bernoulli[k];
    const twoK = BigInt(2 * (k + 1));
    const term = new BigDecimal(bNum.toString()).div(
      new BigDecimal((bDen * twoK).toString()).mul(w2k)
    );
    if (k > 0 && term.abs().lt(tol)) break;
    result = result.sub(term);
    w2k = w2k.mul(w2);
  }

  return result;
}

/**
 * Bignum Trigamma function ψ₁(z) = d/dz ψ(z) = d²/dz² ln(Γ(z))
 * Same recurrence/asymptotic structure as digamma but for the second derivative.
 */
export function bigTrigamma(ce: ComputeEngine, z: BigNum): BigNum {
  if (!z.isFinite()) return BigDecimal.NAN;

  // Reflection formula: ψ₁(1-z) + ψ₁(z) = π²/sin²(πz)
  if (z.isNegative()) {
    if (z.isInteger()) return BigDecimal.NAN;
    const pi = BigDecimal.PI;
    const s = pi.mul(z).sin();
    return pi
      .mul(pi)
      .div(s.mul(s))
      .sub(bigTrigamma(ce, BigDecimal.ONE.sub(z)));
  }

  if (z.isZero()) return BigDecimal.NAN; // pole

  const p = BigDecimal.precision;
  const guard = 10;
  const shift = Math.max(7, Math.ceil(0.37 * p));

  // Recurrence: ψ₁(z+1) = ψ₁(z) - 1/z²
  let result = new BigDecimal(0);
  let w = z;
  while (w.lt(shift)) {
    result = result.add(BigDecimal.ONE.div(w.mul(w)));
    w = w.add(BigDecimal.ONE);
  }

  const maxTerms = Math.ceil(Math.PI * w.toNumber()) + 10;
  const bernoulli = getBernoulliRationals(ce, maxTerms);

  // Asymptotic: ψ₁(w) ~ 1/w + 1/(2w²) + Σ B_{2k}/w^{2k+1}
  result = result.add(BigDecimal.ONE.div(w));
  result = result.add(BigDecimal.ONE.div(w.mul(w).mul(2)));
  let w2kp1 = w.mul(w).mul(w); // w^3
  const w2 = w.mul(w);
  const tol = new BigDecimal(10).pow(-(p + guard));
  const nTerms = Math.min(maxTerms, bernoulli.length);
  for (let k = 0; k < nTerms; k++) {
    const [bNum, bDen] = bernoulli[k];
    const term = new BigDecimal(bNum.toString()).div(
      new BigDecimal(bDen.toString()).mul(w2kp1)
    );
    if (k > 0 && term.abs().lt(tol)) break;
    result = result.add(term);
    w2kp1 = w2kp1.mul(w2);
  }

  return result;
}

/**
 * Bignum Polygamma function ψₙ(z) = dⁿ/dzⁿ ψ(z)
 * Delegates to bigDigamma/bigTrigamma for n=0,1.
 * For n ≥ 2, uses recurrence + asymptotic expansion.
 */
export function bigPolygamma(ce: ComputeEngine, n: BigNum, z: BigNum): BigNum {
  const nNum = n.toNumber();
  if (!Number.isInteger(nNum) || nNum < 0) return BigDecimal.NAN;
  if (nNum === 0) return bigDigamma(ce, z);
  if (nNum === 1) return bigTrigamma(ce, z);
  if (!z.isFinite() || z.isZero()) return BigDecimal.NAN;

  // Bignum factorial helper (small n, simple loop)
  const bigFactorial = (m: number): BigNum => {
    let r: BigNum = BigDecimal.ONE;
    for (let i = 2; i <= m; i++) r = r.mul(i);
    return r;
  };

  const p = BigDecimal.precision;
  const guard = 10;
  const shift = Math.max(7, Math.ceil(0.37 * p));

  // Handle negative z via recurrence shift
  let w = z;
  let result = new BigDecimal(0);
  const sign = nNum % 2 === 0 ? -1 : 1;

  if (w.isNegative()) {
    if (w.isInteger()) return BigDecimal.NAN;
    const negSign = nNum % 2 === 0 ? 1 : -1;
    while (w.lt(1)) {
      result = result.add(
        new BigDecimal(negSign)
          .mul(bigFactorial(nNum))
          .div(w.pow(nNum + 1))
      );
      w = w.add(BigDecimal.ONE);
    }
  }

  // Recurrence: ψₙ(z+1) = ψₙ(z) + (-1)^n n! / z^{n+1}
  while (w.lt(shift)) {
    result = result.add(
      new BigDecimal(sign)
        .mul(bigFactorial(nNum))
        .div(w.pow(nNum + 1))
    );
    w = w.add(BigDecimal.ONE);
  }

  const maxTerms = Math.ceil(Math.PI * w.toNumber()) + 10;
  const bernoulli = getBernoulliRationals(ce, maxTerms);

  // Asymptotic: ψₙ(w) ~ (-1)^{n+1} [(n-1)!/w^n + n!/(2w^{n+1}) + Σ ...]
  const signA = nNum % 2 === 0 ? -1 : 1;
  result = result.add(
    new BigDecimal(signA)
      .mul(bigFactorial(nNum - 1))
      .div(w.pow(nNum))
  );
  result = result.add(
    new BigDecimal(signA)
      .mul(bigFactorial(nNum))
      .div(w.pow(nNum + 1).mul(2))
  );

  // Higher-order terms using Bernoulli numbers
  let wPow = w.pow(nNum + 2);
  const w2 = w.mul(w);
  const tol = new BigDecimal(10).pow(-(p + guard));
  const nTerms = Math.min(maxTerms, bernoulli.length);
  for (let k = 0; k < nTerms; k++) {
    const m = 2 * (k + 1);
    const [bNum, bDen] = bernoulli[k];
    // Rising factorial: (n)(n+1)...(n+2k-1) = Π_{j=0}^{2k-1} (n+j)
    let coeff = 1n;
    for (let j = 0; j < m; j++) coeff *= BigInt(nNum + j);
    // (2k)! as bigint
    let factM = 1n;
    for (let j = 2; j <= m; j++) factM *= BigInt(j);
    // term = signA * B_{2k} * coeff / (factM * w^{n+2k})
    const term = new BigDecimal((BigInt(signA) * bNum * coeff).toString()).div(
      new BigDecimal((bDen * factM).toString()).mul(wPow)
    );
    if (k > 0 && term.abs().lt(tol)) break;
    result = result.add(term);
    wPow = wPow.mul(w2);
  }

  return result;
}

/**
 * Bignum Beta function B(a, b) = Γ(a)Γ(b)/Γ(a+b)
 * Uses bigGamma directly.
 */
export function bigBeta(ce: ComputeEngine, a: BigNum, b: BigNum): BigNum {
  return bigGamma(ce, a)
    .mul(bigGamma(ce, b))
    .div(bigGamma(ce, a.add(b)));
}

/**
 * Bignum Riemann zeta function ζ(s)
 * Uses Cohen-Villegas-Zagier acceleration (same algorithm as machine version).
 */
export function bigZeta(ce: ComputeEngine, s: BigNum): BigNum {
  if (!s.isFinite()) return BigDecimal.NAN;
  if (s.eq(1)) return new BigDecimal(Infinity); // pole

  const pi = BigDecimal.PI;

  // Special value: ζ(0) = -1/2
  if (s.isZero()) return BigDecimal.HALF.neg();

  // Special values for positive even integers: ζ(2k) = (-1)^{k+1} B_{2k} (2π)^{2k} / (2(2k)!)
  if (s.isInteger() && s.isPositive()) {
    const sn = s.toNumber();
    if (sn % 2 === 0 && sn >= 2) {
      const k = sn / 2;
      const bernoulli = getBernoulliRationals(ce, k);
      const [bNum, bDen] = bernoulli[k - 1];
      const bernAbs = new BigDecimal(absBigint(bNum).toString()).div(
        new BigDecimal(bDen.toString())
      );
      const twoPi = pi.mul(2);
      let factVal: BigNum = BigDecimal.ONE;
      for (let i = 2; i <= sn; i++) factVal = factVal.mul(i);
      return bernAbs.mul(twoPi.pow(sn)).div(factVal.mul(2));
    }
  }

  // Functional equation for s < 0:
  // ζ(s) = 2^s π^{s-1} sin(πs/2) Γ(1-s) ζ(1-s)
  if (s.isNegative()) {
    return new BigDecimal(2)
      .pow(s)
      .mul(pi.pow(s.sub(1)))
      .mul(pi.mul(s).div(2).sin())
      .mul(bigGamma(ce, BigDecimal.ONE.sub(s)))
      .mul(bigZeta(ce, BigDecimal.ONE.sub(s)));
  }

  // Cohen-Villegas-Zagier acceleration for the Dirichlet eta function
  // Use more terms for higher precision
  const n = Math.max(22, Math.ceil(ce.precision * 1.3));
  const d = bigZetaCoefficients(ce, n);
  const dn = d[n];
  let sum = new BigDecimal(0);
  for (let k = 0; k <= n; k++) {
    const sign = k % 2 === 0 ? 1 : -1;
    sum = sum.add(
      new BigDecimal(sign)
        .mul(d[k].sub(dn))
        .div(new BigDecimal(k + 1).pow(s))
    );
  }
  const eta = BigDecimal.ONE.sub(new BigDecimal(2).pow(BigDecimal.ONE.sub(s)));
  return sum.div(dn.mul(eta)).neg();
}

/** Bignum Cohen-Villegas-Zagier coefficients */
function bigZetaCoefficients(_ce: ComputeEngine, n: number): BigNum[] {
  const d = new Array<BigNum>(n + 1);
  d[0] = BigDecimal.ONE;
  // Compute d[k] = d[k-1] + C(n, k) using bignum binomial coefficients
  let binom: BigNum = BigDecimal.ONE; // C(n, 0)
  for (let i = 1; i <= n; i++) {
    binom = binom.mul(n - i + 1).div(i);
    d[i] = d[i - 1].add(binom);
  }
  return d;
}

/**
 * Bignum Lambert W function W₀(x): principal branch satisfying W(x)·e^{W(x)} = x.
 * Uses Halley's method with adaptive precision tolerance.
 */
export function bigLambertW(ce: ComputeEngine, x: BigNum): BigNum {
  if (!x.isFinite()) return x; // ±Infinity, NaN
  if (x.isZero()) return new BigDecimal(0);

  const invE = BigDecimal.ONE.div(BigDecimal.ONE.exp()); // 1/e
  const negInvE = invE.neg();

  // Branch point: W(-1/e) = -1
  // Use a tolerance that accounts for machine-precision inputs
  const tol = new BigDecimal(10).pow(-ce.precision);
  const branchTol = new BigDecimal(10).pow(-15); // machine precision tolerance
  if (x.sub(negInvE).abs().lt(branchTol)) return BigDecimal.NEGATIVE_ONE;

  // W is defined for x >= -1/e
  if (x.lt(negInvE)) return BigDecimal.NAN;

  // Initial guess using machine precision
  let w: BigNum;
  const xNum = x.toNumber();
  if (xNum < 0) {
    const p = Math.sqrt(2 * (Math.E * xNum + 1));
    w = new BigDecimal(-1 + p - (p * p) / 3 + (11 / 72) * p * p * p);
  } else if (xNum <= 1) {
    w = new BigDecimal(xNum * (1 - xNum * (1 - 1.5 * xNum)));
  } else if (xNum < 100) {
    const lnx = Math.log(xNum);
    w = new BigDecimal(lnx - Math.log(lnx));
  } else {
    const l1 = x.ln();
    const l2 = l1.ln();
    w = l1.sub(l2).add(l2.div(l1));
  }

  // Halley's method: converges cubically
  for (let i = 0; i < 100; i++) {
    const ew = w.exp();
    const wew = w.mul(ew);
    const f = wew.sub(x);
    const fp = ew.mul(w.add(1));
    const fpp = ew.mul(w.add(2));
    const delta = f.div(fp.sub(f.mul(fpp).div(fp.mul(2))));
    w = w.sub(delta);
    if (delta.abs().lt(tol.mul(w.abs().add(1)))) break;
  }

  return w;
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
    result -= BERNOULLI_2K[k] / (2 * (k + 1) * z2k);
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
      result += (sign * factorial(n)) / Math.pow(z, n + 1);
      z += 1;
    }
    return result + polygamma(n, z);
  }

  // Recurrence: ψₙ(x+1) = ψₙ(x) + (-1)^n n! / x^{n+1}
  let result = 0;
  let z = x;
  const sign = n % 2 === 0 ? -1 : 1;
  while (z < 7) {
    result += (sign * factorial(n)) / Math.pow(z, n + 1);
    z += 1;
  }

  // Asymptotic: ψₙ(z) ~ (-1)^{n+1} [ (n-1)!/z^n + n!/(2z^{n+1}) + Σ ... ]
  const signA = n % 2 === 0 ? -1 : 1;
  result += (signA * factorial(n - 1)) / Math.pow(z, n);
  result += (signA * factorial(n)) / (2 * Math.pow(z, n + 1));

  // Higher-order terms using Bernoulli numbers
  let zPow = Math.pow(z, n + 2);
  for (let k = 0; k < Math.min(BERNOULLI_2K.length, 6); k++) {
    const m = 2 * (k + 1);
    let coeff = 1;
    for (let j = 0; j < m; j++) coeff *= n + j;
    result += (signA * BERNOULLI_2K[k] * coeff) / (factorial(m) * zPow);
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
  if (s === 4) return Math.PI ** 4 / 90;
  if (s === 6) return Math.PI ** 6 / 945;
  if (s === 8) return Math.PI ** 8 / 9450;

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
    sum += ((k % 2 === 0 ? 1 : -1) * (d[k] - dn)) / Math.pow(k + 1, s);
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
    w = -1 + p - (p * p) / 3 + (11 / 72) * p * p * p;
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

/**
 * Bessel function of the first kind J_n(x) for integer order n.
 *
 * Uses power series for small |x|, asymptotic expansion for large |x|,
 * and Miller's backward recurrence for intermediate values.
 *
 * Reference: Abramowitz & Stegun, Ch. 9; NIST DLMF 10.2, 10.17
 */
export function besselJ(n: number, x: number): number {
  if (!isFinite(x) || !Number.isInteger(n)) return NaN;
  if (x === 0) return n === 0 ? 1 : 0;

  // J_{-n}(x) = (-1)^n J_n(x) for integer n
  if (n < 0) {
    n = -n;
    return n % 2 === 0 ? besselJ(n, x) : -besselJ(n, x);
  }

  // J_n(-x) = (-1)^n J_n(x)
  if (x < 0) return n % 2 === 0 ? besselJ(n, -x) : -besselJ(n, -x);

  // For large x, use asymptotic expansion
  if (x > 25 + (n * n) / 2) return besselJAsymptotic(n, x);

  // For small x relative to order, use power series
  if (x < 5 + n) return besselJSeries(n, x);

  // Intermediate: Miller's backward recurrence
  return besselJMiller(n, x);
}

/** Power series: J_n(x) = (x/2)^n Σ_{k=0}^∞ (-x²/4)^k / (k! (n+k)!) */
function besselJSeries(n: number, x: number): number {
  const halfX = x / 2;
  const negQuarter = -(x * x) / 4;
  let term = 1;
  // Compute 1/n! as initial denominator factor
  for (let i = 1; i <= n; i++) term /= i;

  let sum = term;
  for (let k = 1; k <= 60; k++) {
    term *= negQuarter / (k * (n + k));
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
  }
  return sum * Math.pow(halfX, n);
}

/** Hankel asymptotic expansion for large x.
 *  Computes the P and Q polynomials used by both J_n and Y_n asymptotics.
 *  P(n,x) = 1 - (μ-1)(μ-9)/(2!(8x)²) + ...
 *  Q(n,x) = (μ-1)/(1!(8x)) - (μ-1)(μ-9)(μ-25)/(3!(8x)³) + ...
 *  where μ = 4n²
 */
function hankelPQ(n: number, x: number): [number, number] {
  const mu = 4 * n * n;
  let P = 1;
  let Q = 0;

  // a_k = Π_{j=1}^{k} (μ - (2j-1)²)
  let ak = 1;
  const e8x = 8 * x;
  for (let k = 1; k <= 20; k++) {
    ak *= mu - (2 * k - 1) * (2 * k - 1);
    // Denominators: k! * (8x)^k
    const denom = factorial(k) * Math.pow(e8x, k);
    const contrib = ak / denom;
    if (k % 2 === 1) Q += (k % 4 === 1 ? 1 : -1) * contrib;
    else P += (k % 4 === 2 ? -1 : 1) * contrib;
    if (Math.abs(contrib) < 1e-15) break;
  }
  return [P, Q];
}

/** J_n(x) ~ sqrt(2/(πx)) [P cos(χ) - Q sin(χ)] where χ = x - nπ/2 - π/4 */
function besselJAsymptotic(n: number, x: number): number {
  const chi = x - (n / 2 + 0.25) * Math.PI;
  const [P, Q] = hankelPQ(n, x);
  return Math.sqrt(2 / (Math.PI * x)) * (P * Math.cos(chi) - Q * Math.sin(chi));
}

/** Miller's backward recurrence for J_n(x).
 *  Start from a large index M, recur downward using J_{k-1} = (2k/x)J_k - J_{k+1},
 *  then normalize using J_0 + 2J_2 + 2J_4 + ... = 1.
 */
function besselJMiller(n: number, x: number): number {
  const M = Math.max(n + 20, Math.ceil(x) + 30);
  let jp1 = 0; // J_{M+1}
  let jk = 1; // J_M (arbitrary nonzero start)
  const vals = new Array(M + 1);
  vals[M] = jk;

  for (let k = M; k >= 1; k--) {
    const jm1 = ((2 * k) / x) * jk - jp1;
    jp1 = jk;
    jk = jm1;
    vals[k - 1] = jk;
  }

  // Normalize: J_0 + 2(J_2 + J_4 + ...) = 1
  let norm = vals[0];
  for (let k = 2; k <= M; k += 2) norm += 2 * vals[k];
  const scale = 1 / norm;

  return vals[n] * scale;
}

/**
 * Bessel function of the second kind Y_n(x) for integer order n.
 *
 * Y_0 and Y_1 computed directly via series/integrals, higher orders via
 * forward recurrence: Y_{n+1}(x) = (2n/x)Y_n(x) - Y_{n-1}(x).
 *
 * Reference: NIST DLMF 10.8, 10.17
 */
export function besselY(n: number, x: number): number {
  if (!isFinite(x) || !Number.isInteger(n)) return NaN;
  if (x <= 0) return NaN; // Y_n is undefined for x <= 0 (real-valued)

  // Y_{-n}(x) = (-1)^n Y_n(x) for integer n
  if (n < 0) {
    n = -n;
    return n % 2 === 0 ? besselY(n, x) : -besselY(n, x);
  }

  // For large x, use asymptotic expansion.
  // The series for Y_n suffers from catastrophic cancellation at large x,
  // so we switch to asymptotic earlier than for J_n.
  if (x > 12 + (n * n) / 4) return besselYAsymptotic(n, x);

  // Compute Y_0 and Y_1 via series, then recur forward
  const y0 = besselY0(x);
  if (n === 0) return y0;
  const y1 = besselY1(x);
  if (n === 1) return y1;

  let ym1 = y0;
  let yk = y1;
  for (let k = 1; k < n; k++) {
    const yp1 = ((2 * k) / x) * yk - ym1;
    ym1 = yk;
    yk = yp1;
  }
  return yk;
}

/** Y_0(x) via Neumann series:
 *  Y_0(x) = (2/π)[J_0(x)(ln(x/2)+γ) + Σ_{k=1}^∞ (-1)^{k+1} H_k (x/2)^{2k} / (k!)²]
 *  where H_k = 1 + 1/2 + ... + 1/k
 */
function besselY0(x: number): number {
  const halfX = x / 2;
  const x2over4 = halfX * halfX;
  const j0 = besselJ(0, x);
  let sum = 0;
  let term = 1;
  let Hk = 0;
  for (let k = 1; k <= 60; k++) {
    Hk += 1 / k;
    term *= -x2over4 / (k * k);
    sum -= term * Hk; // (-1)^{k+1} = -(-1)^k
    if (Math.abs(term * Hk) < Math.abs(sum) * 1e-16) break;
  }
  return (2 / Math.PI) * (j0 * (Math.log(halfX) + EULER_MASCHERONI) + sum);
}

/** Y_1(x) via DLMF 10.8.3 for n=1:
 *  Y_1(x) = -2/(πx) + (2/π) ln(x/2) J_1(x)
 *           - (x/2)/π Σ_{k=0}^∞ (-1)^k [ψ(k+1)+ψ(k+2)] (x²/4)^k / (k!(k+1)!)
 *  where ψ(n) = -γ + H_{n-1}
 */
function besselY1(x: number): number {
  const halfX = x / 2;
  const x2over4 = halfX * halfX;
  const j1 = besselJ(1, x);

  let sum = 0;
  let x2k = 1; // (x²/4)^k
  let factK = 1; // k!
  for (let k = 0; k <= 60; k++) {
    if (k > 0) {
      factK *= k;
      x2k *= x2over4;
    }
    const factKp1 = factK * (k + 1);
    // ψ(k+1) = -γ + H_k, ψ(k+2) = -γ + H_{k+1}
    let Hk = 0;
    for (let j = 1; j <= k; j++) Hk += 1 / j;
    const Hkp1 = Hk + 1 / (k + 1);
    const psiKp1 = -EULER_MASCHERONI + Hk;
    const psiKp2 = -EULER_MASCHERONI + Hkp1;
    const sign = k % 2 === 0 ? 1 : -1;
    const termVal = (sign * (psiKp1 + psiKp2) * x2k) / (factK * factKp1);
    sum += termVal;
    if (k > 3 && Math.abs(termVal) < 1e-16 * Math.abs(sum)) break;
  }

  return (
    -2 / (Math.PI * x) +
    (2 / Math.PI) * Math.log(halfX) * j1 -
    (halfX / Math.PI) * sum
  );
}

/** Y_n(x) ~ sqrt(2/(πx)) [P sin(χ) + Q cos(χ)] where χ = x - nπ/2 - π/4 */
function besselYAsymptotic(n: number, x: number): number {
  const chi = x - (n / 2 + 0.25) * Math.PI;
  const [P, Q] = hankelPQ(n, x);
  return Math.sqrt(2 / (Math.PI * x)) * (P * Math.sin(chi) + Q * Math.cos(chi));
}

/**
 * Modified Bessel function of the first kind I_n(x) for integer order n.
 *
 * I_n(x) = i^{-n} J_n(ix) — uses power series for small |x|,
 * scaled Miller's recurrence for intermediate, asymptotic for large |x|.
 *
 * Reference: NIST DLMF 10.25, 10.40
 */
export function besselI(n: number, x: number): number {
  if (!isFinite(x) || !Number.isInteger(n)) return NaN;
  if (x === 0) return n === 0 ? 1 : 0;

  // I_{-n}(x) = I_n(x) for integer n
  if (n < 0) n = -n;

  // I_n(-x) = (-1)^n I_n(x)
  if (x < 0) return n % 2 === 0 ? besselI(n, -x) : -besselI(n, -x);

  // For large x, use asymptotic: I_n(x) ~ e^x / sqrt(2πx)
  if (x > 40) return besselIAsymptotic(n, x);

  // Power series: I_n(x) = (x/2)^n Σ_{k=0}^∞ (x²/4)^k / (k! (n+k)!)
  return besselISeries(n, x);
}

/** Power series for I_n(x) = (x/2)^n Σ (x²/4)^k / (k!(n+k)!) */
function besselISeries(n: number, x: number): number {
  const halfX = x / 2;
  const quarter = (x * x) / 4;
  let term = 1;
  for (let i = 1; i <= n; i++) term /= i;

  let sum = term;
  for (let k = 1; k <= 80; k++) {
    term *= quarter / (k * (n + k));
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
  }
  return sum * Math.pow(halfX, n);
}

/** Asymptotic expansion: I_n(x) ~ e^x/sqrt(2πx) [1 - (μ-1)/(8x) + ...]
 *  where μ = 4n² */
function besselIAsymptotic(n: number, x: number): number {
  const mu = 4 * n * n;
  let term = 1;
  let sum = 1;
  for (let k = 1; k <= 12; k++) {
    const f = mu - (2 * k - 1) * (2 * k - 1);
    term *= f / (k * 8 * x); // Note: no negation for I (vs J)
    sum += term;
    if (Math.abs(term) < 1e-15) break;
  }
  return (Math.exp(x) / Math.sqrt(2 * Math.PI * x)) * sum;
}

/**
 * Modified Bessel function of the second kind K_n(x) for integer order n.
 *
 * K_0 and K_1 computed via series, higher orders via forward recurrence:
 * K_{n+1}(x) = (2n/x)K_n(x) + K_{n-1}(x).
 *
 * Reference: NIST DLMF 10.31, 10.40
 */
export function besselK(n: number, x: number): number {
  if (!isFinite(x) || !Number.isInteger(n)) return NaN;
  if (x <= 0) return NaN; // K_n only defined for x > 0

  // K_{-n}(x) = K_n(x) for integer n
  if (n < 0) n = -n;

  // For large x, use asymptotic expansion
  if (x > 40) return besselKAsymptotic(n, x);

  // Compute K_0 and K_1 via series
  const k0 = besselK0(x);
  if (n === 0) return k0;
  const k1 = besselK1(x);
  if (n === 1) return k1;

  // Forward recurrence: K_{n+1} = (2n/x) K_n + K_{n-1}
  let km1 = k0;
  let kk = k1;
  for (let k = 1; k < n; k++) {
    const kp1 = ((2 * k) / x) * kk + km1;
    km1 = kk;
    kk = kp1;
  }
  return kk;
}

/** K_0(x) = -(ln(x/2) + γ) I_0(x) + Σ_{k=1}^∞ H_k (x/2)^{2k} / (k!)² */
function besselK0(x: number): number {
  const halfX = x / 2;
  const x2over4 = halfX * halfX;
  const i0 = besselI(0, x);
  let sum = 0;
  let term = 1;
  let Hk = 0;
  for (let k = 1; k <= 60; k++) {
    Hk += 1 / k;
    term *= x2over4 / (k * k);
    sum += term * Hk;
    if (Math.abs(term * Hk) < Math.abs(sum) * 1e-16 && k > 3) break;
  }
  return -(Math.log(halfX) + EULER_MASCHERONI) * i0 + sum;
}

/** K_1(x) via DLMF 10.31.2 for n=1:
 *  K_1(x) = 1/x + (ln(x/2)+γ) I_1(x) [with sign correction]
 *           + (x/2) Σ_{k=0}^∞ [ψ(k+1)+ψ(k+2)] (x²/4)^k / (2 k!(k+1)!)
 *  We use the Wronskian: I_0(x)K_1(x) + I_1(x)K_0(x) = 1/x
 *  => K_1(x) = (1/x - I_1(x)K_0(x)) / I_0(x)
 */
function besselK1(x: number): number {
  const i0 = besselI(0, x);
  const i1 = besselI(1, x);
  const k0 = besselK0(x);
  return (1 / x - i1 * k0) / i0;
}

/** Asymptotic expansion: K_n(x) ~ sqrt(π/(2x)) e^{-x} [1 + (μ-1)/(8x) + ...]
 *  where μ = 4n² */
function besselKAsymptotic(n: number, x: number): number {
  const mu = 4 * n * n;
  let term = 1;
  let sum = 1;
  for (let k = 1; k <= 12; k++) {
    const f = mu - (2 * k - 1) * (2 * k - 1);
    term *= f / (k * 8 * x);
    sum += term;
    if (Math.abs(term) < 1e-15) break;
  }
  return Math.sqrt(Math.PI / (2 * x)) * Math.exp(-x) * sum;
}

/**
 * Airy function of the first kind Ai(x).
 *
 * For x < 0 and small |x|, uses power series.
 * For large positive x, uses asymptotic: Ai(x) ~ e^{-ξ}/(2√π x^{1/4})
 * For large negative x, uses asymptotic oscillatory form.
 * For moderate x, uses power series with sufficient terms.
 *
 * Reference: NIST DLMF 9.2, 9.7
 */
export function airyAi(x: number): number {
  if (!isFinite(x)) return NaN;

  // For large positive x, use asymptotic to avoid series convergence issues
  if (x > 5) {
    const xi = (2 / 3) * Math.pow(x, 1.5);
    return airyAiAsymptotic(x, xi);
  }

  // For large negative x, use asymptotic oscillatory form
  if (x < -5) {
    const absX = -x;
    const xi = (2 / 3) * Math.pow(absX, 1.5);
    return airyAiNegAsymptotic(absX, xi);
  }

  // Power series: Ai(x) = c1 f(x) - c2 g(x)
  // where f(x) = Σ 3^k x^{3k} / (3k)!  (scaled)
  //       g(x) = Σ 3^k x^{3k+1} / (3k+1)!
  // c1 = Ai(0) = 1/(3^{2/3} Γ(2/3)), c2 = -Ai'(0) = 1/(3^{1/3} Γ(1/3))
  const c1 = 1 / (Math.pow(3, 2 / 3) * gamma(2 / 3)); // Ai(0)
  const c2 = 1 / (Math.pow(3, 1 / 3) * gamma(1 / 3)); // -Ai'(0)

  let f = 1;
  let g = x;
  let termF = 1;
  let termG = x;
  for (let k = 1; k <= 80; k++) {
    const k3 = 3 * k;
    termF *= (x * x * x) / ((k3 - 1) * k3);
    termG *= (x * x * x) / (k3 * (k3 + 1));
    f += termF;
    g += termG;
    if (Math.abs(termF) + Math.abs(termG) < 1e-16 * (Math.abs(f) + Math.abs(g)))
      break;
  }

  return c1 * f - c2 * g;
}

/** Asymptotic Ai(x) for large positive x:
 *  Ai(x) ~ e^{-ξ} / (2√π x^{1/4}) where ξ = (2/3)x^{3/2} */
function airyAiAsymptotic(x: number, xi: number): number {
  const x14 = Math.pow(x, 0.25);
  let sum = 1;
  let term = 1;
  // Asymptotic series coefficients: u_k/((-ξ)^k) ... simplified
  const ck = [1, 5 / 72, 385 / 10368, 85085 / 2239488, 37182145 / 644972544];
  for (let k = 1; k < ck.length; k++) {
    term = ck[k] / Math.pow(xi, k);
    sum += (k % 2 === 0 ? 1 : -1) * term;
  }
  return (Math.exp(-xi) / (2 * Math.sqrt(Math.PI) * x14)) * sum;
}

/** Asymptotic Ai(x) for large negative x (oscillatory):
 *  Ai(-x) ~ sin(ξ + π/4) / (√π x^{1/4}) */
function airyAiNegAsymptotic(absX: number, xi: number): number {
  const x14 = Math.pow(absX, 0.25);
  return Math.sin(xi + Math.PI / 4) / (Math.sqrt(Math.PI) * x14);
}

/**
 * Airy function of the second kind Bi(x).
 *
 * Similar structure to Ai(x) but with different coefficients
 * and asymptotic behavior (Bi grows for positive x).
 *
 * Reference: NIST DLMF 9.2, 9.7
 */
export function airyBi(x: number): number {
  if (!isFinite(x)) return NaN;

  // For large positive x: Bi(x) ~ e^ξ / (√π x^{1/4})
  if (x > 5) {
    const xi = (2 / 3) * Math.pow(x, 1.5);
    return airyBiAsymptotic(x, xi);
  }

  // For large negative x: Bi(-x) ~ cos(ξ + π/4) / (√π x^{1/4})
  if (x < -5) {
    const absX = -x;
    const xi = (2 / 3) * Math.pow(absX, 1.5);
    return airyBiNegAsymptotic(absX, xi);
  }

  // Power series: Bi(x) = √3 [c1 f(x) + c2 g(x)]
  // Same f, g as Ai but with √3 factor and + sign
  const c1 = 1 / (Math.pow(3, 2 / 3) * gamma(2 / 3)); // same as Ai
  const c2 = 1 / (Math.pow(3, 1 / 3) * gamma(1 / 3));

  let f = 1;
  let g = x;
  let termF = 1;
  let termG = x;
  for (let k = 1; k <= 80; k++) {
    const k3 = 3 * k;
    termF *= (x * x * x) / ((k3 - 1) * k3);
    termG *= (x * x * x) / (k3 * (k3 + 1));
    f += termF;
    g += termG;
    if (Math.abs(termF) + Math.abs(termG) < 1e-16 * (Math.abs(f) + Math.abs(g)))
      break;
  }

  return Math.sqrt(3) * (c1 * f + c2 * g);
}

/** Asymptotic Bi(x) for large positive x: Bi(x) ~ e^ξ / (√π x^{1/4}) */
function airyBiAsymptotic(x: number, xi: number): number {
  const x14 = Math.pow(x, 0.25);
  let sum = 1;
  let term = 1;
  const ck = [1, 5 / 72, 385 / 10368, 85085 / 2239488, 37182145 / 644972544];
  for (let k = 1; k < ck.length; k++) {
    term = ck[k] / Math.pow(xi, k);
    sum += term; // All positive for Bi
  }
  return (Math.exp(xi) / (Math.sqrt(Math.PI) * x14)) * sum;
}

/** Asymptotic Bi(x) for large negative x (oscillatory):
 *  Bi(-x) ~ cos(ξ + π/4) / (√π x^{1/4}) */
function airyBiNegAsymptotic(absX: number, xi: number): number {
  const x14 = Math.pow(absX, 0.25);
  return Math.cos(xi + Math.PI / 4) / (Math.sqrt(Math.PI) * x14);
}

// ──────────────────────────────────────────────────────────────────
// Fresnel integrals
//
// S(x) = ∫₀ˣ sin(π t²/2) dt
// C(x) = ∫₀ˣ cos(π t²/2) dt
//
// Rational Chebyshev approximation from Cephes / scipy.
// Three regions: |x|<1.6, 1.6≤|x|<36, |x|≥36.
// ──────────────────────────────────────────────────────────────────

// Region 1 (|x| < 1.6): S(x) = x³ P(x⁴)/Q(x⁴)
// Coefficients from Cephes (π/2 factor is baked into the coefficients)
const SN = [
  -2.99181919401019853726e3, 7.08840045257738576863e5,
  -6.29741486205862506537e7, 2.54890880573376359104e9,
  -4.42979518059697779103e10, 3.18016297876567817986e11,
];
const SD = [
  1.0, 2.81376268889994315696e2, 4.55847810806532581675e4,
  5.1734388877009640073e6, 4.19320245898111231129e8, 2.2441179564534092094e10,
  6.07366389490084914091e11,
];

// Region 1 (|x| < 1.6): C(x) = x P(x⁴)/Q(x⁴)
const CN = [
  -4.98843114573573548651e-8, 9.50428062829859605134e-6,
  -6.45191435683965050962e-4, 1.88843319396703850064e-2,
  -2.05525900955013891793e-1, 9.99999999999999998822e-1,
];
const CD = [
  3.99982968972495980367e-12, 9.15439215774657478799e-10,
  1.25001862479598821474e-7, 1.22262789024179030997e-5,
  8.68029542941784300606e-4, 4.12142090722199792936e-2, 1.00000000000000000118,
];

// Region 2 (1.6 ≤ |x| < 36): auxiliary f(x), g(x) as rational approx of u=1/(π²x⁴)
const FN = [
  4.21543555043677546506e-1, 1.43407919780758885261e-1,
  1.15220955073585758835e-2, 3.450179397825740279e-4, 4.63613749287867322088e-6,
  3.05568983790257605827e-8, 1.02304514164907233465e-10,
  1.72010743268161828879e-13, 1.34283276233062758925e-16,
  3.76329711269987889006e-20,
];
const FD = [
  1.0, 7.51586398353378947175e-1, 1.16888925859191382142e-1,
  6.44051526508858611005e-3, 1.55934409164153020873e-4,
  1.8462756734893054587e-6, 1.12699224763999035261e-8,
  3.60140029589371370404e-11, 5.8875453362157841001e-14,
  4.52001434074129701496e-17, 1.25443237090011264384e-20,
];

// Region 2: auxiliary g(x)
const GN = [
  5.04442073643383265887e-1, 1.97102833525523411709e-1,
  1.87648584092575249293e-2, 6.84079380915393090172e-4,
  1.15138826111884280931e-5, 9.82852443688422223854e-8,
  4.45344415861750144738e-10, 1.08268041139020870318e-12,
  1.37555460633261799868e-15, 8.36354435630677421531e-19,
  1.86958710162783235106e-22,
];
const GD = [
  1.0, 1.47495759925128324529, 3.37748989120019970451e-1,
  2.53603741420338795122e-2, 8.14679107184306179049e-4,
  1.27545075667729118702e-5, 1.04314589657571990585e-7,
  4.60680728515232032307e-10, 1.10273215066240270757e-12,
  1.38796531259578871258e-15, 8.39158816283118707363e-19,
  1.86958710162783236342e-22,
];

/** Horner form polynomial evaluation (highest degree coefficient first) */
function polevl(x: number, coef: number[]): number {
  let ans = coef[0];
  for (let i = 1; i < coef.length; i++) ans = ans * x + coef[i];
  return ans;
}

/**
 * Fresnel sine integral: S(x) = ∫₀ˣ sin(π t²/2) dt
 *
 * S is odd, S(∞) → 1/2.
 */
export function fresnelS(x: number): number {
  if (!isFinite(x)) {
    if (x !== x) return NaN; // NaN
    return x > 0 ? 0.5 : -0.5; // ±Infinity
  }
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  if (x < 1.6) {
    const x2 = x * x;
    const t = x2 * x2; // x⁴
    return (sign * x * x2 * polevl(t, SN)) / polevl(t, SD);
  }

  if (x < 36) {
    const x2 = x * x;
    const t = Math.PI * x2; // πx²
    const u = 1 / (t * t); // 1/(π²x⁴)
    const f = 1 - (u * polevl(u, FN)) / polevl(u, FD);
    const g = ((1 / t) * polevl(u, GN)) / polevl(u, GD);
    const z = (Math.PI / 2) * x2; // πx²/2
    const c = Math.cos(z);
    const s = Math.sin(z);
    return sign * (0.5 - (f * c + g * s) / (Math.PI * x));
  }

  // Asymptotic: |x| >= 36
  return sign * 0.5;
}

/**
 * Fresnel cosine integral: C(x) = ∫₀ˣ cos(π t²/2) dt
 *
 * C is odd, C(∞) → 1/2.
 */
export function fresnelC(x: number): number {
  if (!isFinite(x)) {
    if (x !== x) return NaN; // NaN
    return x > 0 ? 0.5 : -0.5; // ±Infinity
  }
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  if (x < 1.6) {
    const x2 = x * x;
    const t = x2 * x2; // x⁴
    return (sign * x * polevl(t, CN)) / polevl(t, CD);
  }

  if (x < 36) {
    const x2 = x * x;
    const t = Math.PI * x2; // πx²
    const u = 1 / (t * t); // 1/(π²x⁴)
    const f = 1 - (u * polevl(u, FN)) / polevl(u, FD);
    const g = ((1 / t) * polevl(u, GN)) / polevl(u, GD);
    const z = (Math.PI / 2) * x2; // πx²/2
    const c = Math.cos(z);
    const s = Math.sin(z);
    return sign * (0.5 + (f * s - g * c) / (Math.PI * x));
  }

  // Asymptotic: |x| >= 36
  return sign * 0.5;
}

/** Unnormalized cardinal sine: sinc(x) = sin(x)/x, sinc(0) = 1. */
export function sinc(x: number): number {
  return x === 0 ? 1 : Math.sin(x) / x;
}
