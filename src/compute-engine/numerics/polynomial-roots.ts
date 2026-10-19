import { Complex } from 'complex.js';
import { complexDivide } from './numeric-complex.js';

import { checkDeadline } from '../../common/interruptible.js';

/**
 * All complex roots of a polynomial via the Durand–Kerner (Weierstrass)
 * iteration.
 *
 * `coeffs` are in **ascending** order (a₀ … aₙ), with aₙ ≠ 0. Returns `null`
 * when the iteration does not converge (e.g. badly clustered roots).
 */
export function durandKernerRoots(
  coeffs: number[],
  deadline?: number
): Complex[] | null {
  const n = coeffs.length - 1;
  const an = coeffs[n];
  const c = coeffs.map((x) => x / an); // monic, ascending

  const evalP = (z: Complex): Complex => {
    // Horner on the monic polynomial, descending
    let r = new Complex(1, 0);
    for (let i = n - 1; i >= 0; i--) r = r.mul(z).add(c[i]);
    return r;
  };

  // Standard initial guesses: powers of a non-real point off the unit circle
  const seed = new Complex(0.4, 0.9);
  let roots: Complex[] = [];
  let p = new Complex(1, 0);
  for (let k = 0; k < n; k++) {
    p = p.mul(seed);
    roots.push(p);
  }

  for (let iter = 0; iter < 500; iter++) {
    checkDeadline(deadline);
    let maxDelta = 0;
    const next: Complex[] = [];
    for (let i = 0; i < n; i++) {
      let denom = new Complex(1, 0);
      for (let j = 0; j < n; j++)
        if (j !== i) denom = denom.mul(roots[i].sub(roots[j]));
      const delta = complexDivide(evalP(roots[i]), denom);
      next.push(roots[i].sub(delta));
      maxDelta = Math.max(maxDelta, delta.abs() / (1 + roots[i].abs()));
    }
    roots = next;
    if (maxDelta < 1e-14) return roots;
  }
  return null; // did not converge (e.g. badly clustered roots)
}

/**
 * All complex roots of a polynomial of high degree via the Aberth–Ehrlich
 * iteration, with machine numbers.
 *
 * `coeffs` are in **ascending** order (a₀ … aₙ), with aₙ ≠ 0 and n ≥ 1.
 * Returns `null` when the iteration does not converge in `maxIterations`
 * steps, or when the result fails the final check below.
 *
 * The start points are on a circle about the origin, with the radius
 * `max |aₖ/aₙ|^(1/(n−k))` (by Fujiwara's bound, each root has a modulus of
 * at most twice this radius) and an angle offset of 0.4 radians, which keeps
 * them away from a symmetry axis of a polynomial with real coefficients.
 * The Durand–Kerner start points of `durandKernerRoots()` (the powers of
 * `0.4 + 0.9i`) are all inside the unit circle and close together at a high
 * degree, and that iteration does not converge for `x⁶⁴ + x − 2`.
 *
 * Each step moves an approximation `zᵢ` by `w / (1 − w·Σⱼ 1/(zᵢ − zⱼ))`, with
 * `w = p(zᵢ)/p′(zᵢ)`, and uses the new values at once (Gauss–Seidel order).
 * When `|zᵢ| > 1`, `p` and `p′` are computed from the reversed polynomial
 * in `1/zᵢ`, so that `zᵢⁿ` does not overflow at a high degree.
 *
 * An approximation is accepted when its backward error
 * `|p(zᵢ)| / Σ|aₖ|·|zᵢ|ᵏ` is at most `4n·ε` (the rounding error of the
 * evaluation of `p` with Horner's method has this size), or when the step is
 * at most `4ε·|zᵢ|`. As a check that no approximation went to a root that
 * another approximation has, the sum of the approximations must be
 * `−aₙ₋₁/aₙ` (the sum of the roots), within `10⁻⁸·(1 + Σ|zᵢ|)`.
 */
export function aberthRoots(
  coeffs: number[],
  deadline?: number,
  maxIterations = 500
): Complex[] | null {
  const n = coeffs.length - 1;
  const a = coeffs;
  const abs = a.map((c) => Math.abs(c));
  let radius = 0;
  for (let k = 0; k < n; k++)
    if (a[k] !== 0)
      radius = Math.max(radius, Math.pow(abs[k] / abs[n], 1 / (n - k)));
  if (radius === 0) radius = 1;
  const re: number[] = [];
  const im: number[] = [];
  for (let k = 0; k < n; k++) {
    const angle = (2 * Math.PI * k) / n + 0.4;
    re.push(radius * Math.cos(angle));
    im.push(radius * Math.sin(angle));
  }

  // The Newton step `p(z)/p′(z)` (real and imaginary parts) and the
  // backward error at `z`.
  const newtonStep = (zr: number, zi: number): [number, number, number] => {
    const m2 = zr * zr + zi * zi;
    if (m2 <= 1) {
      const az = Math.sqrt(m2);
      let pr = a[n];
      let pi = 0;
      let dr = 0;
      let di = 0;
      let s = abs[n];
      for (let k = n - 1; k >= 0; k--) {
        const ndr = dr * zr - di * zi + pr;
        di = dr * zi + di * zr + pi;
        dr = ndr;
        const npr = pr * zr - pi * zi + a[k];
        pi = pr * zi + pi * zr;
        pr = npr;
        s = s * az + abs[k];
      }
      const d2 = dr * dr + di * di;
      return [
        (pr * dr + pi * di) / d2,
        (pi * dr - pr * di) / d2,
        Math.hypot(pr, pi) / s,
      ];
    }
    // With `y = 1/z` and `q(y) = Σ aₖ·yⁿ⁻ᵏ = p(z)/zⁿ`:
    // `p(z)/p′(z) = z·q(y) / (n·q(y) − y·q′(y))`.
    const yr = zr / m2;
    const yi = -zi / m2;
    const ay = 1 / Math.sqrt(m2);
    let qr = a[0];
    let qi = 0;
    let dr = 0;
    let di = 0;
    let s = abs[0];
    for (let k = 1; k <= n; k++) {
      const ndr = dr * yr - di * yi + qr;
      di = dr * yi + di * yr + qi;
      dr = ndr;
      const nqr = qr * yr - qi * yi + a[k];
      qi = qr * yi + qi * yr;
      qr = nqr;
      s = s * ay + abs[k];
    }
    const denr = n * qr - (yr * dr - yi * di);
    const deni = n * qi - (yr * di + yi * dr);
    const numr = zr * qr - zi * qi;
    const numi = zr * qi + zi * qr;
    const d2 = denr * denr + deni * deni;
    return [
      (numr * denr + numi * deni) / d2,
      (numi * denr - numr * deni) / d2,
      Math.hypot(qr, qi) / s,
    ];
  };

  const eps = 4 * Number.EPSILON;
  const done: boolean[] = new Array(n).fill(false);
  let converged = false;
  for (let iter = 0; iter < maxIterations && !converged; iter++) {
    checkDeadline(deadline);
    converged = true;
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      const [wr, wi, backwardError] = newtonStep(re[i], im[i]);
      // At the size of the rounding error, one more step is taken (it often
      // makes the approximation more accurate) and the root is then final.
      const final = backwardError <= eps * n;
      if (!Number.isFinite(wr) || !Number.isFinite(wi)) {
        if (final) {
          done[i] = true;
          continue;
        }
        return null;
      }
      if (final) done[i] = true;
      else converged = false;
      let sr = 0;
      let si = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dr = re[i] - re[j];
        const di = im[i] - im[j];
        const d2 = dr * dr + di * di;
        sr += dr / d2;
        si -= di / d2;
      }
      // The step `w / (1 − w·s)`.
      const denr = 1 - (wr * sr - wi * si);
      const deni = -(wr * si + wi * sr);
      const dd = denr * denr + deni * deni;
      const cr = (wr * denr + wi * deni) / dd;
      const ci = (wi * denr - wr * deni) / dd;
      if (!Number.isFinite(cr) || !Number.isFinite(ci)) return null;
      re[i] -= cr;
      im[i] -= ci;
      if (Math.hypot(cr, ci) <= eps * Math.hypot(re[i], im[i])) done[i] = true;
    }
  }
  if (!converged) return null;

  let sumRe = 0;
  let sumIm = 0;
  let sumAbs = 0;
  for (let i = 0; i < n; i++) {
    sumRe += re[i];
    sumIm += im[i];
    sumAbs += Math.hypot(re[i], im[i]);
  }
  const expected = -a[n - 1] / a[n];
  if (Math.hypot(sumRe - expected, sumIm) > 1e-8 * (1 + sumAbs)) return null;
  return re.map((r, i) => new Complex(r, im[i]));
}

/**
 * Distinct **real** roots of a polynomial with real coefficients, in ascending
 * order. `coeffs` are ascending (a₀ … aₙ).
 *
 * Zero roots are deflated first, low degrees are solved in closed form, and
 * degree ≥ 3 goes through {@link durandKernerRoots}; complex roots are dropped
 * and near-equal real roots are de-duplicated. Returns `null` if the numeric
 * root finder does not converge.
 */
export function realPolynomialRoots(
  coeffs: number[],
  deadline?: number
): number[] | null {
  let c = coeffs.slice();
  // Drop any all-zero or constant tail.
  while (c.length > 1 && c[c.length - 1] === 0) c = c.slice(0, -1);
  if (c.length <= 1) return [];

  const roots: number[] = [];
  // Deflate zero roots: a trailing run of zero low-order coefficients means 0
  // is a root with that multiplicity. (`x³ → x²·x` etc.)
  while (c.length > 1 && c[0] === 0) {
    roots.push(0);
    c = c.slice(1);
  }

  const deg = c.length - 1;
  if (deg === 1) {
    roots.push(-c[0] / c[1]);
  } else if (deg === 2) {
    const disc = c[1] * c[1] - 4 * c[2] * c[0];
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      roots.push((-c[1] + s) / (2 * c[2]), (-c[1] - s) / (2 * c[2]));
    }
  } else if (deg >= 3) {
    const cr = durandKernerRoots(c, deadline);
    if (cr === null) return null;
    for (const z of cr)
      if (Math.abs(z.im) <= 1e-8 * (1 + Math.abs(z.re))) roots.push(z.re);
  }

  // De-duplicate near-equal real roots (clustered/multiple roots).
  const unique: number[] = [];
  for (const r of roots)
    if (!unique.some((u) => Math.abs(u - r) <= 1e-7 * (1 + Math.abs(r))))
      unique.push(r);
  unique.sort((a, b) => a - b);
  return unique;
}
