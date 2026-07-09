import { Complex } from 'complex-esm';

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
      const delta = evalP(roots[i]).div(denom);
      next.push(roots[i].sub(delta));
      maxDelta = Math.max(maxDelta, delta.abs() / (1 + roots[i].abs()));
    }
    roots = next;
    if (maxDelta < 1e-14) return roots;
  }
  return null; // did not converge (e.g. badly clustered roots)
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
