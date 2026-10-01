import { Complex } from 'complex-esm';
import { BigDecimal } from '../../big-decimal/index.js';
import type { IComputeEngine as ComputeEngine } from '../global-types.js';
import { bernoulliRational } from './bernoulli.js';
import { logGammaComplex } from './log-gamma.js';
import { bigZeta } from './special-functions.js';

/**
 * The Barnes G-function: G(z+1) = Γ(z)·G(z), G(1) = 1. G(n) is the
 * superfactorial Π_{k<n−1} k! at positive integers and G is entire with
 * zeros at 0, −1, −2, ….
 */

/** G(n) = Π_{k=0}^{n−2} k!, exact, for a positive integer n. */
export function superfactorial(n: number): bigint {
  let g = 1n;
  let f = 1n;
  for (let k = 1; k <= n - 2; k++) {
    f *= BigInt(k);
    g *= f;
  }
  return g;
}

//
// ---------------- Complex z, at double precision ----------------
//

/** Asymptotic coefficients B₂ₖ₊₂ / (4k(k+1)). */
const COEFF: number[] = (() => {
  const c = [0];
  for (let k = 1; k <= 12; k++) {
    const [num, den] = bernoulliRational(2 * k + 2);
    c[k] = Number(num) / Number(den) / (4 * k * (k + 1));
  }
  return c;
})();

/** ζ′(−1) = 1/12 − ln A, A Glaisher's constant. */
const ZETA_PRIME_MINUS_1 = -0.16542114370045094;
const HALF_LN_2PI = 0.5 * Math.log(2 * Math.PI);

/** Re z from which the 12-term asymptotic series is good to a double. */
const ASYMPTOTIC_FROM = 20;

/**
 * Steps of ln G(z) = ln G(z+n) − Σ lnΓ(z+k) allowed below `ASYMPTOTIC_FROM`.
 * The sum's terms grow like n² ln n while ln G(z) stays smaller, so the
 * relative error of G = exp(ln G) grows with n (about 1e-12 at n = 100,
 * measured against mpmath); past the cap the kernel declines.
 */
const MAX_SHIFT = 100;

/**
 * ln G(z+1) ~ (z²/2 − 1/12) ln z − 3z²/4 + (z/2) ln 2π + ζ′(−1)
 *   + Σ_{k≥1} B₂ₖ₊₂ / (4k(k+1) z^{2k}),
 * for Re z ≥ `ASYMPTOTIC_FROM` (Adamchik, "Contributions to the theory of the
 * Barnes function", eq. 22).
 */
function asymptotic(z: Complex): Complex {
  const lz = z.log();
  const z2 = z.mul(z);
  let r = z2.mul(0.5).sub(1 / 12).mul(lz);
  r = r.sub(z2.mul(0.75)).add(z.mul(HALF_LN_2PI)).add(ZETA_PRIME_MINUS_1);
  const inv2 = new Complex(1, 0).div(z2);
  let p = inv2;
  for (let k = 1; k < COEFF.length; k++) {
    r = r.add(p.mul(COEFF[k]));
    p = p.mul(inv2);
  }
  return r;
}

/**
 * ln G(z) with the `LogGamma` continuation (the branch Wolfram's `LogBarnesG`
 * takes: its imaginary part jumps by 2πk on the negative axis). NaN at the
 * zeros of G, for a non-finite z, and where the shift would pass `MAX_SHIFT`.
 */
export function logBarnesGComplex(z: Complex): Complex {
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im))
    return new Complex(NaN, NaN);
  if (z.im === 0 && z.re <= 0 && Number.isInteger(z.re))
    return new Complex(NaN, NaN);
  const n = Math.max(0, Math.ceil(ASYMPTOTIC_FROM - z.re));
  if (n > MAX_SHIFT) return new Complex(NaN, NaN);
  let shift = new Complex(0, 0);
  for (let k = 0; k < n; k++)
    shift = shift.add(logGammaComplex(new Complex(z.re + k, z.im)));
  // ln G((z+n−1) + 1)
  return asymptotic(new Complex(z.re + n - 1, z.im)).sub(shift);
}

/** G(z) = exp(ln G(z)); exactly 0 at the non-positive integers, NaN where it overflows a double. */
export function barnesGComplex(z: Complex): Complex {
  if (z.im === 0 && z.re <= 0 && Number.isInteger(z.re))
    return new Complex(0, 0);
  const v = logBarnesGComplex(z).exp();
  return Number.isFinite(v.re) && Number.isFinite(v.im)
    ? v
    : new Complex(NaN, NaN);
}

//
// ---------------- Real x, at the engine's precision ----------------
//

/**
 * With w = x − (m+1), |w| ≤ ½, both functions come from their Taylor series
 * about 1, whose coefficients are ζ(k) (|w| < 1):
 *   ln Γ(1+w) = −γw + Σ_{k≥2} (−1)^k ζ(k) w^k / k,
 *   ln G(1+w) = (w/2) ln 2π − (w + (1+γ)w²)/2 + Σ_{k≥2} (−1)^k ζ(k) w^{k+1} / (k+1).
 * Writing ζ(k) = 1 + (ζ(k) − 1) sums the 1s in closed form,
 *   Σ_{k≥2} (−1)^k w^k / k = w − ln(1+w),
 *   Σ_{k≥2} (−1)^k w^{k+1} / (k+1) = ln(1+w) − w + w²/2,
 * and leaves terms that shrink like (|w|/2)^k, as ζ(k) − 1 ≈ 2^{−k}. The
 * recurrence G(u+1) = Γ(u)·G(u) then walks 1+w to x, each Γ one
 * multiplication from the last: Γ(u+1) = u·Γ(u).
 *
 * The series is stopped once its tail is below the working precision:
 * ζ(k) − 1 = Σ_{n≥2} n^{−k} ≤ 2^{−k}(1 + 2/(k−1)), so past the Kth term both
 * series' terms are at most (1 + 2/K)(|w|/2)^k/(K+1) and their tails at most
 *   (1 + 2/K)(|w|/2)^{K+1} / ((K+1)(1 − |w|/2)).
 */

/** Digits carried past the ones asked for, against rounding in the series and the recurrence. */
const GUARD_DIGITS = 10;

/** Steps of the recurrence allowed; farther from 1 the double kernel is the better trade. */
const MAX_BIG_SHIFT = 60;

/** Terms allowed per digit asked for; the terms shrink by at least 4 each, 1.7 per digit. */
const TERMS_PER_DIGIT = 2;

const zetaMinusOneCache = new Map<number, BigDecimal>();
let zetaCacheDigits = 0;

/** ζ(k) − 1 at the working precision, cached per precision. */
function zetaMinusOne(ce: ComputeEngine, k: number): BigDecimal {
  if (zetaCacheDigits !== BigDecimal.precision) {
    zetaMinusOneCache.clear();
    zetaCacheDigits = BigDecimal.precision;
  }
  let z = zetaMinusOneCache.get(k);
  if (z === undefined) {
    z = bigZeta(ce, new BigDecimal(k)).sub(1);
    zetaMinusOneCache.set(k, z);
  }
  return z;
}

/**
 * G(x) to the working precision (`BigDecimal.precision`), undefined at the
 * zeros of G and where x is more than `MAX_BIG_SHIFT` from 1.
 */
export function bigBarnesG(
  ce: ComputeEngine,
  x: BigDecimal
): BigDecimal | undefined {
  if (!x.isFinite()) return undefined;
  if (x.isInteger() && !x.isPositive()) return undefined;
  const m = Math.round(x.toNumber() - 1);
  if (Math.abs(m) > MAX_BIG_SHIFT) return undefined;
  const digits = BigDecimal.precision;
  const saved = digits;
  BigDecimal.precision = digits + GUARD_DIGITS + Math.ceil(Math.log10(Math.abs(m) + 1));
  try {
    return series(ce, x.sub(m + 1), m, digits)?.toPrecision(digits);
  } finally {
    BigDecimal.precision = saved;
  }
}

function series(
  ce: ComputeEngine,
  w: BigDecimal,
  m: number,
  digits: number
): BigDecimal | undefined {
  const working = BigDecimal.precision;
  const gamma = BigDecimal.EULER_GAMMA;
  const ln1pw = w.add(1).ln();
  const w2 = w.mul(w);
  let lnGamma = w.sub(gamma.mul(w)).sub(ln1pw); // −γw + w − ln(1+w)
  let lnG = w
    .mul(BigDecimal.PI.mul(2).ln())
    .div(2) // (w/2) ln 2π
    .sub(w.add(gamma.add(1).mul(w2)).div(2)) // (w + (1+γ)w²)/2
    .add(ln1pw.sub(w).add(w2.div(2))); // ln(1+w) − w + w²/2

  const half = w.abs().div(2); // |w|/2 ≤ ¼
  const threshold = new BigDecimal(`1e-${working + 1}`);
  const maxTerms = TERMS_PER_DIGIT * digits + 50;
  let wPower = w2; // w^k, from k = 2
  let halfPower = half.mul(half).mul(half); // (|w|/2)^{k+1}, from k = 2
  for (let k = 2; k <= maxTerms; k++) {
    const c = wPower.mul(zetaMinusOne(ce, k));
    const signed = k % 2 === 0 ? c : c.neg();
    lnGamma = lnGamma.add(signed.div(k));
    lnG = lnG.add(signed.mul(w).div(k + 1));
    // Tail past the kth term: (1 + 2/k)(|w|/2)^{k+1} / ((k+1)(1 − |w|/2)).
    const tail = halfPower
      .mul(k + 2)
      .div(k * (k + 1))
      .div(BigDecimal.ONE.sub(half));
    if (tail.lt(threshold)) return walk(lnG, lnGamma, w, m);
    wPower = wPower.mul(w);
    halfPower = halfPower.mul(half);
  }
  return undefined; // not converged within the cap: decline
}

/** exp(ln G(1+w)) and exp(ln Γ(1+w)) walked by the recurrence to G(m+1+w). */
function walk(
  lnG: BigDecimal,
  lnGamma: BigDecimal,
  w: BigDecimal,
  m: number
): BigDecimal {
  let g = lnG.exp();
  let gammaU = lnGamma.exp(); // Γ(u+1), u = w
  if (m > 0) {
    // G(u+2) = Γ(u+1)·G(u+1), from u+1 = 1+w up to x.
    for (let j = 0; j < m; j++) {
      g = g.mul(gammaU);
      gammaU = gammaU.mul(w.add(j + 1));
    }
  } else {
    // G(u) = G(u+1) / Γ(u), Γ(u) = Γ(u+1)/u, from u+1 = 1+w down to x.
    for (let j = 0; j < -m; j++) {
      gammaU = gammaU.div(w.sub(j));
      g = g.div(gammaU);
    }
  }
  return g;
}
