import { zetaNegativeInteger } from './bernoulli.js';
import { zeta } from './special-functions.js';

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

/** θ reduced into (−π, π]. */
function reduce(theta: number): number {
  const t = theta - TWO_PI * Math.round(theta / TWO_PI);
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
