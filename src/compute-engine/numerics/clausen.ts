import { BigDecimal } from '../../big-decimal/index.js';
import type { IComputeEngine as ComputeEngine } from '../global-types.js';
import { zetaNegativeInteger } from './bernoulli.js';
import { bigZeta, zeta } from './special-functions.js';

/**
 * Clausen functions Clₙ(θ) of integer order n ≥ 1 and real θ:
 *
 *   Cl₂ₘ(θ)   = Σ_{k≥1} sin(kθ)/k^{2m}   = Im Liₙ(e^{iθ})   (n even)
 *   Cl₂ₘ₊₁(θ) = Σ_{k≥1} cos(kθ)/k^{2m+1} = Re Liₙ(e^{iθ})   (n odd)
 *
 * Cl₂(θ) = −∫₀^θ ln|2 sin(t/2)| dt is the classical one, with Cl₂(π/2) equal
 * to Catalan's constant; Cl₁(θ) = −ln|2 sin(θ/2)|. These are mpmath's `clsin`
 * and `clcos`; Wolfram has no head and writes them as Im/Re `PolyLog[n, E^(I θ)]`.
 */

/** Orders above this overflow the (n−1)! of the singular term; they decline. */
export const CLAUSEN_MAX_ORDER = 170;

/** Terms of the expansion are summed to this index at most; ~60 reach a double. */
const CLAUSEN_MAX_TERMS = 400;

/**
 * |θ| beyond this is moved off π by the duplication formula, so a value that
 * vanishes at π (every even order) keeps its relative accuracy: the series
 * terms there are of size one and cancel to the result.
 */
const CLAUSEN_REFLECT_ABOVE = (3 * Math.PI) / 4;

const TWO_PI = 2 * Math.PI;

/** ζ(m) at an integer m ≠ 1; ζ(−j) = −B_{j+1}/(j+1) (DLMF 25.6.3). */
function zetaInteger(m: number): number {
  if (m >= 2) return zeta(m);
  if (m === 0) return -0.5;
  const [num, den] = zetaNegativeInteger(-m);
  return Number(num) / Number(den);
}

/**
 * θ reduced into (−π, π]. Past 2π the subtraction θ − 2πk loses about
 * log₁₀|θ| digits (2πk is rounded to a double), so a larger θ is reduced
 * with `Math.sin` and `Math.cos`, which reduce their argument exactly, and
 * `Math.atan2`: the error is then about 1e-16 at any |θ|.
 */
function reduce(theta: number): number {
  const t =
    Math.abs(theta) > TWO_PI
      ? Math.atan2(Math.sin(theta), Math.cos(theta))
      : theta - TWO_PI * Math.round(theta / TWO_PI);
  return t <= -Math.PI ? t + TWO_PI : t;
}

/** x · iᵏ as (re, im). */
function quadrant(k: number, x: number): [number, number] {
  switch (k & 3) {
    case 0:
      return [x, 0];
    case 1:
      return [0, x];
    case 2:
      return [-x, 0];
    default:
      return [0, -x];
  }
}

/**
 * Cₙ(θ) for n ≥ 2 and |θ| ≤ 3π/4, from the expansion of Liₙ(eᵘ) about u = 0
 * (DLMF 25.12.12) with u = iθ:
 *
 *   Liₙ(eᵘ) = uⁿ⁻¹/(n−1)! · (H_{n−1} − ln(−u)) + Σ_{k≠n−1} ζ(n−k) uᵏ/k!,
 *
 * convergent for |u| < 2π. The powers iᵏ cycle through the quadrants, so each
 * term lands in the real or the imaginary part only.
 */
function clausenExpansion(n: number, t: number): number {
  let re = 0;
  let im = 0;

  let harmonic = 0;
  let factorial = 1;
  for (let k = 1; k <= n - 1; k++) {
    harmonic += 1 / k;
    factorial *= k;
  }
  // ln(−iθ) = ln|θ| − i·sgn(θ)·π/2
  const cRe = harmonic - Math.log(Math.abs(t));
  const cIm = Math.sign(t) * (Math.PI / 2);
  const [pRe, pIm] = quadrant(n - 1, Math.pow(t, n - 1) / factorial);
  re += pRe * cRe - pIm * cIm;
  im += pRe * cIm + pIm * cRe;

  // Every other term past k = n is a trivial zero ζ(−2j) = 0, so convergence
  // is judged on the nonzero terms, several past the singular one.
  let power = 1; // θᵏ/k!
  for (let k = 0; k < CLAUSEN_MAX_TERMS; k++) {
    if (k > 0) power *= t / k;
    if (k === n - 1) continue;
    const c = zetaInteger(n - k) * power;
    if (c === 0) continue;
    const [qRe, qIm] = quadrant(k, c);
    re += qRe;
    im += qIm;
    if (
      k > n + 8 &&
      Math.abs(c) < 1e-17 * (Math.abs(re) + Math.abs(im) + 1e-300)
    )
      return n % 2 === 0 ? im : re;
  }
  return NaN;
}

/**
 * Clₙ(θ) for an integer n ≥ 1 and real θ, to double precision; `Infinity` for
 * Cl₁ at θ ≡ 0 and `NaN` where the kernel declines (n out of range, θ not
 * finite). For |θ| > 3π/4 (reduced mod 2π) the duplication formula
 * Liₙ(z) + Liₙ(−z) = 2¹⁻ⁿ Liₙ(z²) gives
 * Clₙ(θ) = 2¹⁻ⁿ Clₙ(2θ) − Clₙ(θ ∓ π), both arguments then within π/2 of 0.
 */
export function clausen(n: number, theta: number): number {
  if (!Number.isInteger(n) || n < 1 || n > CLAUSEN_MAX_ORDER) return NaN;
  if (!Number.isFinite(theta)) return NaN;
  const t = reduce(theta);
  if (n === 1)
    return t === 0 ? Infinity : -Math.log(Math.abs(2 * Math.sin(t / 2)));
  if (t === 0) return n % 2 === 0 ? 0 : zeta(n);
  if (Math.abs(t) <= CLAUSEN_REFLECT_ABOVE) return clausenExpansion(n, t);
  const shifted = t > 0 ? t - Math.PI : t + Math.PI;
  return Math.pow(2, 1 - n) * clausen(n, reduce(2 * t)) - clausen(n, shifted);
}

// --- Arbitrary precision ----------------------------------------------------
//
// The same expansion and duplication on `BigDecimal`, for a real θ at
// `ce.precision` digits. The ζ(n−k) with n−k ≥ 2 are bignum zeta values (at
// most n−2 of them); those with n−k ≤ 0 are exact Bernoulli rationals.

/** Orders above this decline: the expansion needs ζ(m) for each m = 2 … n−1. */
export const CLAUSEN_BIG_MAX_ORDER = 40;

/** |θ| beyond this declines: reducing θ mod 2π costs log₁₀|θ| digits of π. */
const CLAUSEN_BIG_MAX_ARGUMENT = 1e12;

/** Digits carried past the ones asked for. */
const CLAUSEN_GUARD_DIGITS = 20;

/**
 * Digits of cancellation tolerated between the largest term and the result;
 * more than this and the value is not trusted to the digits asked for.
 */
const CLAUSEN_CANCELLATION_DIGITS = CLAUSEN_GUARD_DIGITS - 6;

/** Consecutive terms below the tolerance that end the sum (the bound is geometric, ratio ≤ 3/8 per index). */
const CLAUSEN_BIG_CONSECUTIVE = 3;

/** A value and the size of the largest quantity that went into it. */
interface Scaled {
  value: BigDecimal;
  scale: BigDecimal;
}

/** ζ(m) for an integer m ≠ 1. */
function bigZetaInteger(ce: ComputeEngine, m: number): BigDecimal {
  if (m >= 2) return bigZeta(ce, new BigDecimal(m));
  if (m === 0) return BigDecimal.HALF.neg();
  if (m % 2 === 0) return BigDecimal.ZERO; // trivial zeros
  const [num, den] = zetaNegativeInteger(-m);
  return new BigDecimal(num).div(new BigDecimal(den));
}

/** x · iᵏ added into (re, im). */
function addQuadrant(
  acc: { re: BigDecimal; im: BigDecimal },
  k: number,
  x: BigDecimal
): void {
  switch (k & 3) {
    case 0:
      acc.re = acc.re.add(x);
      break;
    case 1:
      acc.im = acc.im.add(x);
      break;
    case 2:
      acc.re = acc.re.sub(x);
      break;
    default:
      acc.im = acc.im.sub(x);
  }
}

/**
 * Clₙ(t) for n ≥ 2 and 0 < |t| ≤ 3π/4 from the expansion of `clausenExpansion`,
 * summed until `CLAUSEN_BIG_CONSECUTIVE` nonzero terms in a row are below the
 * working precision; the terms shrink geometrically (|ζ(−j)| ≈ 2 j!/(2π)^{j+1}
 * against 1/k!), so that is the tail bound. `undefined` past the term cap.
 */
function bigClausenExpansion(
  ce: ComputeEngine,
  n: number,
  t: BigDecimal
): Scaled | undefined {
  const working = BigDecimal.precision;
  const tolerance = new BigDecimal(`1e-${working}`);
  const maxTerms = Math.ceil(working / Math.log10(8 / 3)) + 4 * n + 40;
  const acc = { re: BigDecimal.ZERO, im: BigDecimal.ZERO };
  let scale = BigDecimal.ZERO;

  let power = BigDecimal.ONE; // tᵏ/k!
  let small = 0;
  for (let k = 0; k < maxTerms; k++) {
    if (k > 0) power = power.mul(t).div(k);
    if (k === n - 1) {
      // tⁿ⁻¹/(n−1)! · (H_{n−1} − ln|t| + i·sgn(t)·π/2), times iⁿ⁻¹
      let harmonic = BigDecimal.ZERO;
      for (let j = 1; j < n; j++)
        harmonic = harmonic.add(BigDecimal.ONE.div(j));
      const cRe = harmonic.sub(t.abs().ln());
      const cIm = BigDecimal.PI.div(2).mul(t.isNegative() ? -1 : 1);
      addQuadrant(acc, n - 1, power.mul(cRe));
      addQuadrant(acc, n, power.mul(cIm)); // i·iⁿ⁻¹
      // Only the part in iⁿ⁻¹ lands in the component returned (Im for an
      // even n, Re for an odd one); the part in iⁿ lands in the other one.
      const big = power.mul(cRe).abs();
      if (big.gt(scale)) scale = big;
      continue;
    }
    const m = n - k;
    if (m < 0 && m % 2 === 0) continue; // trivial zero
    const c = power.mul(bigZetaInteger(ce, m));
    addQuadrant(acc, k, c);
    const mag = c.abs();
    // The scale measures cancellation in the returned component only: the
    // terms with k + n odd. The others (ζ(n) at k = 0 for an even n, of
    // size 1 next to a value of size θ) do not cancel against it.
    if ((k + n) % 2 === 1 && mag.gt(scale)) scale = mag;
    if (k > n + 2 && mag.lt(tolerance.mul(scale))) {
      if (++small >= CLAUSEN_BIG_CONSECUTIVE)
        return { value: n % 2 === 0 ? acc.im : acc.re, scale };
    } else small = 0;
  }
  return undefined;
}

/** Clₙ(t) for t in (−π, π], by the expansion or, past 3π/4, the duplication formula. */
function bigClausenReduced(
  ce: ComputeEngine,
  n: number,
  t: BigDecimal,
  twoPi: BigDecimal
): Scaled | undefined {
  if (t.isZero()) {
    if (n % 2 === 0) return { value: BigDecimal.ZERO, scale: BigDecimal.ZERO };
    if (n === 1) return undefined;
    const value = bigZeta(ce, new BigDecimal(n));
    return { value, scale: value };
  }
  if (t.abs().lte(BigDecimal.PI.mul(3).div(4)))
    return bigClausenExpansion(ce, n, t);
  const wrap = (x: BigDecimal): BigDecimal => {
    const r = x.sub(twoPi.mul(x.div(twoPi).round()));
    return r;
  };
  const a = bigClausenReduced(ce, n, wrap(t.mul(2)), twoPi);
  const b = bigClausenReduced(
    ce,
    n,
    t.isPositive() ? t.sub(BigDecimal.PI) : t.add(BigDecimal.PI),
    twoPi
  );
  if (a === undefined || b === undefined) return undefined;
  const half = BigDecimal.TWO.pow(1 - n); // 2¹⁻ⁿ
  const scaledA = a.value.mul(half);
  const scale = [
    a.scale.mul(half),
    b.scale,
    scaledA.abs(),
    b.value.abs(),
  ].reduce((m, x) => (x.gt(m) ? x : m));
  return { value: scaledA.sub(b.value), scale };
}

/**
 * Clₙ(θ) at `BigDecimal.precision` digits for an integer 2 ≤ n ≤
 * `CLAUSEN_BIG_MAX_ORDER` (n = 1 is −ln|2 sin(θ/2)|) and a finite real θ with
 * |θ| ≤ 10¹²; `undefined` where the kernel cannot vouch for the digits: past
 * those bounds, at θ ≡ 0 for n = 1, or where the value cancels against its
 * own terms by more than `CLAUSEN_CANCELLATION_DIGITS` digits (n = 1 near
 * θ ≡ ±π/3, where Cl₁ crosses 0).
 */
export function bigClausen(
  ce: ComputeEngine,
  n: number,
  theta: BigDecimal
): BigDecimal | undefined {
  if (!Number.isInteger(n) || n < 1 || n > CLAUSEN_BIG_MAX_ORDER)
    return undefined;
  if (!theta.isFinite() || theta.abs().gt(CLAUSEN_BIG_MAX_ARGUMENT))
    return undefined;
  const digits = BigDecimal.precision;
  const guard =
    CLAUSEN_GUARD_DIGITS + Math.ceil(Math.log10(theta.abs().toNumber() + 1));
  BigDecimal.precision = digits + guard;
  try {
    const twoPi = BigDecimal.PI.mul(2);
    const t = theta.sub(twoPi.mul(theta.div(twoPi).round())); // (−π, π]
    let result: Scaled | undefined;
    if (n === 1) {
      if (t.isZero()) return undefined;
      const value = BigDecimal.TWO.mul(t.div(2).sin().abs()).ln().neg();
      result = { value, scale: BigDecimal.ONE };
    } else result = bigClausenReduced(ce, n, t, twoPi);
    if (result === undefined) return undefined;
    // The value must not have cancelled to below the digits carried.
    const floor = new BigDecimal(`1e-${CLAUSEN_CANCELLATION_DIGITS}`).mul(
      result.scale
    );
    if (result.value.abs().lt(floor)) return undefined;
    return result.value.toPrecision(digits);
  } finally {
    BigDecimal.precision = digits;
  }
}
