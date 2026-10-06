import { Complex } from 'complex.js';
import { bernoulliRational } from './bernoulli.js';
import { cosSinPi, gammaln, logSinPi } from './numeric-complex.js';

/** ½ ln 2π. */
export const HALF_LN_2PI = 0.5 * Math.log(2 * Math.PI);

/**
 * ln Γ(z) for complex z as the analytic continuation Wolfram's `LogGamma`
 * and mpmath's `loggamma` use: holomorphic off (−∞, 0], continuous from
 * above on the cut. It is not the principal logarithm of Γ(z), which jumps
 * by 2πi across the zero set of Im Γ (`GammaLn(−2.5+1.5i)` is
 * −3.7175 − 1.4299i, the continuation is −3.7175 − 7.7131i).
 *
 * Three regimes, so that a small answer is never the difference of two
 * large ones:
 * - Re z ≥ `STIRLING_FROM`: Stirling's series (DLMF 5.11.1).
 * - ½ ≤ Re z < `STIRLING_FROM`: the Lanczos approximation of `gammaln` while
 *   |Im z| ≤ `LANCZOS_IM_LIMIT`; past that its error grows with |Im z|, and
 *   the recurrence lnΓ(z) = lnΓ(z+n) − Σ ln(z+k) into Stirling is used.
 * - Re z < ½: the reflection formula (DLMF 5.5.3) with the branch
 *   correction of `reflect`.
 */

/** Re z from which Stirling's 14 terms are good to a double. */
const STIRLING_FROM = 18;

/** Past this |Im z| the Lanczos error (about 4e-15 below it, measured against
 * mpmath for Re z ∈ [½, 18)) outgrows the recurrence's. */
const LANCZOS_IM_LIMIT = 3;

/** Stirling coefficients B₂ₖ / (2k(2k−1)). */
const STIRLING: number[] = (() => {
  const c = [0];
  for (let k = 1; k <= 14; k++) {
    const [num, den] = bernoulliRational(2 * k);
    c[k] = Number(num) / Number(den) / (2 * k * (2 * k - 1));
  }
  return c;
})();

const C_NAN = new Complex(NaN, NaN);

/** (z − ½) ln z − z + ½ ln 2π + Σ cₖ z^{1−2k}, for Re z ≥ `STIRLING_FROM`. */
function stirling(z: Complex): Complex {
  const lz = z.log();
  let r = z.sub(0.5).mul(lz).sub(z).add(HALF_LN_2PI);
  const inv = new Complex(1, 0).div(z);
  const inv2 = inv.mul(inv);
  let p = inv;
  for (let k = 1; k < STIRLING.length; k++) {
    r = r.add(p.mul(STIRLING[k]));
    p = p.mul(inv2);
  }
  return r;
}

/** lnΓ(z) = lnΓ(z+n) − Σ_{k<n} ln(z+k), with Re(z+n) ≥ `STIRLING_FROM`. */
function shiftedStirling(z: Complex): Complex {
  const n = Math.max(0, Math.ceil(STIRLING_FROM - z.re));
  let shift = new Complex(0, 0);
  for (let k = 0; k < n; k++)
    shift = shift.add(new Complex(z.re + k, z.im).log());
  return stirling(new Complex(z.re + n, z.im)).sub(shift);
}

/**
 * Re z < ½: lnΓ(z) = ln π − ln sin(πz) − lnΓ(1−z) + 2πik.
 *
 * The principal ln sin(πz) jumps by 2πi where sin(πz) crosses the negative
 * real axis, i.e. each time Re z passes an odd half-integer; lnΓ is smooth
 * there off the real axis, so `k` = sign(Im z)·⌊(Re z + ½)/2⌋ cancels the
 * jump. On the real axis the crossing is lnΓ's own cut and the value is the
 * limit from above, Im lnΓ(x) = π⌊x⌋ for non-integer x < 0.
 */
function reflect(z: Complex): Complex {
  const lg = logGammaComplex(new Complex(1 - z.re, -z.im));
  if (z.im === 0) {
    const sin = Math.abs(cosSinPi(z.re)[1]);
    return new Complex(
      Math.log(Math.PI) - Math.log(sin) - lg.re,
      z.re < 0 ? Math.PI * Math.floor(z.re) : 0
    );
  }
  let ls = logSinPi(z);
  // `logSinPi` is not principal for large |Im z|; the correction below assumes it is.
  if (Math.abs(z.im) > 7)
    ls = new Complex(ls.re, Math.atan2(Math.sin(ls.im), Math.cos(ls.im)));
  // On the crossing itself sin(πz) is exactly negative real, and the side the
  // correction `k` assumes is the sign of Im z.
  const [c, sin] = cosSinPi(z.re);
  if (c === 0 && sin < 0) ls = new Complex(ls.re, Math.sign(z.im) * Math.PI);
  const k = Math.sign(z.im) * Math.floor((z.re + 0.5) / 2);
  return new Complex(
    Math.log(Math.PI) - ls.re - lg.re,
    -ls.im - lg.im + 2 * Math.PI * k
  );
}

/** lnΓ(z), the continuation described above. NaN at the poles 0, −1, −2, … and for a non-finite z. */
export function logGammaComplex(z: Complex): Complex {
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return C_NAN;
  if (z.im === 0 && z.re <= 0 && Number.isInteger(z.re)) return C_NAN;
  if (z.re >= STIRLING_FROM) return stirling(z);
  if (z.re >= 0.5)
    return Math.abs(z.im) <= LANCZOS_IM_LIMIT ? gammaln(z) : shiftedStirling(z);
  return reflect(z);
}
