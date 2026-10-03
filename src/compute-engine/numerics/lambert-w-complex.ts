import { Complex } from 'complex-esm';

//
// ---------------- Lambert W function, every branch (complex) ----------------
//
// W_k(z) is the solution w of w·e^w = z on the branch k (an integer). The
// branch conventions are those of Corless, Gonnet, Hare, Jeffrey and Knuth,
// "On the Lambert W function" (1996), and of mpmath's `lambertw(z, k)`:
//   - W₀ has its branch cut on (−∞, −1/e]. W₀ is real on [−1/e, ∞).
//   - W₋₁ is real on [−1/e, 0). It has its branch cut on (−∞, 0).
//   - Every other branch has its branch cut on (−∞, 0) and is never real.
// On a branch cut, the value is the limit from above (Im z → 0⁺), the
// counter-clockwise continuity that mpmath uses: W₀(−2) = 0.1728 + 1.674i,
// W₋₁(−2) = 0.1728 − 1.674i, W₁(−2) = −1.361 + 7.679i, W₋₁(−0.1) = −3.577
// (real), W₁(−0.1) = −4.449 + 7.307i. This is also the convention of the
// engine for `Ln`: ln(−2) = ln 2 + iπ.
//

/** 1/e as the sum of two doubles, hi + lo, for z + 1/e near the branch
 *  point: a single double holds 1/e with an error of 1.2·10⁻¹⁷. */
const INV_E_HI = 0.36787944117144233;
const INV_E_LO = -1.2428753672788363e-17;

/**
 * The coefficients μ_l of the series of W about the branch point −1/e,
 * W = Σ μ_l·p^l with p = ±√(2(e·z + 1)) (Corless et al., eq. 4.22):
 * μ₀ = −1, μ₁ = 1, μ₂ = −1/3, μ₃ = 11/72, ... from their recurrence
 * (eq. 4.23 and 4.24). The series converges for |p| < √2.
 */
const BRANCH_POINT_SERIES: number[] = (() => {
  const n = 64;
  const u: number[] = [-1, 1];
  const a: number[] = [2, -1];
  for (let l = 2; l < n; l++) {
    let s = 0;
    for (let j = 2; j < l; j++) s += u[j] * u[l + 1 - j];
    a[l] = s;
    u[l] =
      ((l - 1) * (u[l - 2] / 2 + a[l - 2] / 4)) / (l + 1) -
      a[l] / 2 -
      u[l - 1] / (l + 1);
  }
  return u;
})();

/**
 * W₀ (`sign` = 1) or W₋₁ (`sign` = −1) at a real x next to the branch point,
 * 0 ≤ x + 1/e < 0.05, from the series about −1/e (the real case of the
 * series in `lambertWComplex()`). Returns `undefined` for an x outside that
 * interval.
 *
 * Near −1/e, Halley's iteration divides by e^w·(w + 1), which goes to 0,
 * and x + 1/e needs 1/e to more than double precision: the series with 1/e
 * in two doubles gives the value to about 1 unit in the last place.
 */
export function lambertWNearBranchPoint(
  x: number,
  sign: 1 | -1
): number | undefined {
  const d = x + INV_E_HI + INV_E_LO;
  if (!(d >= 0 && d < 0.05)) return undefined;
  const p = sign * Math.sqrt(2 * Math.E * d);
  let sum = BRANCH_POINT_SERIES[0];
  let power = 1;
  for (let l = 1; l < BRANCH_POINT_SERIES.length; l++) {
    power *= p;
    const term = BRANCH_POINT_SERIES[l] * power;
    sum += term;
    if (Math.abs(term) < 1e-17 * Math.abs(sum)) break;
  }
  return sum;
}

const C_NAN = new Complex(NaN, NaN);

/**
 * The Lambert W function W_k(z) for a complex z and an integer branch k: the
 * solution w of w·e^w = z on the branch k, with the branch cuts and the
 * values on the cuts described at the top of this file.
 *
 * Method (the method of mpmath's `lambertw`, in doubles):
 *   - Near the branch point (|z + 1/e| < 0.05, on the branches that meet
 *     there: W₀, W₋₁ for Im z ≥ 0, W₁ for Im z < 0), the series about the
 *     branch point, with z + 1/e computed with 1/e in two doubles. The
 *     series gives the value directly: there the Halley correction divides
 *     by e^w·(w + 1), which goes to 0, and would lose accuracy.
 *   - Elsewhere, Halley's iteration on w·e^w − z = 0, from the initial
 *     values of mpmath: a piecewise approximation of W₀ and W₋₁ near the
 *     origin, and otherwise the asymptotic series
 *     L₁ − L₂ + L₂/L₁ + L₂(L₂ − 2)/(2L₁²), with L₁ = ln z + 2πik and
 *     L₂ = ln L₁.
 *
 * Measured against mpmath (`lambertw`, 40 digits) on 31,000 points of the
 * branches −3 to 3: |z| from 10⁻¹² to 10³⁰⁰ in every direction, the
 * negative real axis, points 10⁻³⁰⁰ to 10⁻² above and below the cuts, and
 * points 10⁻¹⁵ to 1 from −1/e. The largest relative error (in the modulus)
 * is 6.6·10⁻¹⁶.
 *
 * Returns `NaN` parts when z is not finite, when z = 0 on a branch other
 * than 0 (the value is −∞ there; the caller answers it), or when the
 * iteration does not converge in 100 steps.
 */
export function lambertWComplex(z: Complex, k: number): Complex {
  const x = z.re;
  // A zero imaginary part is +0: the value on the cut is the limit from
  // above, and `log`, `sqrt` read the sign of a zero imaginary part.
  const y = z.im === 0 ? 0 : z.im;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(k))
    return C_NAN;
  if (x === 0 && y === 0) return k === 0 ? new Complex(0, 0) : C_NAN;
  z = new Complex(x, y);

  // Near the branch point −1/e: the series about it.
  const dRe = x + INV_E_HI + INV_E_LO;
  if (
    Math.hypot(dRe, y) < 0.05 &&
    (k === 0 || (k === -1 && y >= 0) || (k === 1 && y < 0))
  ) {
    let p = new Complex(2 * Math.E * dRe, 2 * Math.E * y).sqrt();
    if (k !== 0) p = p.neg();
    // |p| < 0.52 here, so the terms decrease at least as fast as 0.37^l and
    // the 64 coefficients reach a relative size below 10⁻²⁶.
    let sum = new Complex(BRANCH_POINT_SERIES[0], 0);
    let power = new Complex(1, 0);
    for (let l = 1; l < BRANCH_POINT_SERIES.length; l++) {
      power = power.mul(p);
      const term = power.mul(BRANCH_POINT_SERIES[l]);
      sum = sum.add(term);
      if (term.abs() < 1e-17 * sum.abs()) break;
    }
    return sum;
  }

  // W₀ for a small |z|: the Maclaurin series Σ (−n)ⁿ⁻¹/n!·zⁿ, whose terms
  // decrease about e·|z| < 0.003 times at each step. Halley's iteration
  // would divide by w there, and `complex-esm` squares the size of a divisor.
  if (k === 0 && z.abs() < 2 ** -10) {
    let sum = new Complex(0, 0);
    let power = new Complex(1, 0);
    for (let n = 1; n <= 12; n++) {
      power = power.mul(z);
      let c = 1;
      for (let j = 1; j <= n; j++) c *= (j === n ? 1 : -n) / j;
      // c = (−n)ⁿ⁻¹/n!
      sum = sum.add(power.mul(c));
    }
    return sum;
  }

  let w = lambertWInitialValue(z, k);
  for (let i = 0; i < 100; i++) {
    const wn = halleyStep(w, z);
    if (wn.isNaN()) return C_NAN;
    const step = wn.sub(w).abs();
    w = wn;
    // The iteration converges cubically: one step after the change falls
    // below 10⁻¹² of |w|, the change is at the roundoff level.
    if (step <= 1e-12 * w.abs()) {
      const last = halleyStep(w, z);
      return last.isNaN() ? w : last;
    }
  }
  return C_NAN;
}

/**
 * One step of Halley's iteration for w·e^w = z, in the form of mpmath,
 * w − f/(w·e^w + e^w − (w + 2)·f/(2w + 2)) with f = w·e^w − z, with the
 * numerator and the denominator divided by w·e^w: with r = 1 − z·e^−w/w,
 * the step is r/(1 + 1/w − (w + 2)·r/(2w + 2)). The divided form does not
 * overflow: w·e^w has the size of z, and the complex division of
 * `complex-esm` squares the size of the divisor.
 */
function halleyStep(w: Complex, z: Complex): Complex {
  // z·e^−w is formed directly, as it is more accurate. For a tiny |z| on a
  // branch k ≠ 0 (W₁(10⁻³¹⁰) has a real part near −720), e^−w overflows
  // before the product: then exp(ln z − w), which is the same value.
  let zew = z.mul(w.neg().exp());
  if (
    !Number.isFinite(zew.re) ||
    !Number.isFinite(zew.im) ||
    (zew.re === 0 && zew.im === 0)
  )
    zew = log(z).sub(w).exp();
  const r = zew.div(w).neg().add(1);
  const denominator = w
    .inverse()
    .add(1)
    .sub(w.add(2).mul(r).div(w.mul(2).add(2)));
  return w.sub(r.div(denominator));
}

/**
 * The initial value of the Halley iteration for W_k(z), z not near the
 * branch point on a branch that meets it: the choices of mpmath
 * (`_lambertw_series` and `_lambertw_approx_hybrid`), which put the initial
 * value in the basin of the root on the branch k, also on the cuts.
 */
function lambertWInitialValue(z: Complex, k: number): Complex {
  const x = z.re;
  const y = z.im;
  // The sign of the imaginary part: 0 on the real axis.
  const imagSign = y > 0 ? 1 : y < 0 ? -1 : 0;
  const mag = z.abs();
  const r = -0.367879441171442;

  // For moderate |z|, a piecewise approximation of W₀ and W₋₁.
  if (mag > 2 ** -10 && mag < 2 ** 900) {
    if (k === 0) {
      if (y > -4 && y < 4 && x > -1 && x < 2.5) {
        if (imagSign !== 0) {
          // Taylor series in the upper and lower half-planes.
          if (y > 1) return taylor(0.876, 0.645, 0.118, -0.174, 0.75, 2.5, z);
          if (y > 0.25)
            return taylor(0.505, 0.204, 0.375, -0.132, 0.75, 0.5, z);
          if (y < -1) return taylor(0.876, -0.645, 0.118, 0.174, 0.75, -2.5, z);
          if (y < -0.25)
            return taylor(0.505, -0.204, 0.375, 0.132, 0.75, -0.5, z);
        }
        // Taylor series about z = −1.
        if (x < -0.5) {
          return imagSign >= 0
            ? taylor(-0.318, 1.34, -0.697, -0.593, -1, 0, z)
            : taylor(-0.318, -1.34, -0.697, 0.593, -1, 0, z);
        }
        // Near the branch point −1/e.
        if (x < -0.2) {
          const d = z.sub(r);
          return d
            .sqrt()
            .mul(2.33164398159712)
            .sub(d.mul(1.81218788563936))
            .add(-1);
        }
        // Taylor series about 0, and a linear approximation.
        if (x < 0.5) return z;
        return z.mul(0.3).add(0.2);
      }
      return asymptoticW(z, 0);
    }
    if (k === -1) {
      if (imagSign >= 0 && y < 0.1 && x > -0.6 && x < -0.2) {
        const d = z.sub(r);
        return d
          .sqrt()
          .mul(-2.33164398159712)
          .sub(d.mul(1.81218788563936))
          .add(-1);
      }
      if (imagSign === 0 && x >= -0.2 && x < 0) {
        const l1 = Math.log(-x);
        return new Complex(l1 - Math.log(-l1), 0);
      }
      return asymptoticW(z, -1);
    }
  }
  // W₋₁ on (−1/e, 0) is real: the asymptotic series about 0⁻ of the real
  // branch.
  if (k === -1 && imagSign === 0 && x > -0.36787944117144 && x < 0) {
    const l1 = Math.log(-x);
    return new Complex(l1 - Math.log(-l1), 0);
  }
  return asymptoticW(z, k);
}

/** The principal logarithm. The `log` of `complex-esm` squares the modulus
 *  and overflows for |z| > 10¹⁵⁴ (or underflows for |z| < 10⁻¹⁵⁴). */
function log(z: Complex): Complex {
  return new Complex(Math.log(Math.hypot(z.re, z.im)), Math.atan2(z.im, z.re));
}

/** a + b·(z − z₀), the first-order Taylor approximations of mpmath. */
function taylor(
  aRe: number,
  aIm: number,
  bRe: number,
  bIm: number,
  z0Re: number,
  z0Im: number,
  z: Complex
): Complex {
  return new Complex(aRe, aIm).add(
    new Complex(bRe, bIm).mul(new Complex(z.re - z0Re, z.im - z0Im))
  );
}

/**
 * The asymptotic series of W_k(z) for z → ∞ and for z → 0 (k ≠ 0):
 * L₁ − L₂ + L₂/L₁ + L₂(L₂ − 2)/(2L₁²), with L₁ = ln z + 2πik and
 * L₂ = ln L₁ (Corless et al., eq. 4.20). Its relative error is O(1/ln z).
 */
function asymptoticW(z: Complex, k: number): Complex {
  const l1 = log(z).add(new Complex(0, 2 * Math.PI * k));
  const l2 = log(l1);
  return l1
    .sub(l2)
    .add(l2.div(l1))
    .add(l2.mul(l2.sub(2)).div(l1.mul(l1).mul(2)));
}
