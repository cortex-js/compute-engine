/**
 * Complex-argument kernels for the Bessel functions of integer order
 * (`J_n`, `Y_n`, `I_n`, `K_n`) and for the Airy functions (`Ai`, `Bi`,
 * `Ai′`, `Bi′`).
 *
 * Every kernel computes in doubles and returns the pair `[re, im]`. A part
 * that is not finite means that the value is past the range of a double.
 * The real kernels of `special-functions.ts` compute every value at a real
 * argument that these kernels need; the complex kernels below compute the
 * rest.
 *
 * The Bessel functions are reduced to two kernels on the closed right
 * half-plane `Re z ≥ 0`: `besselIRight()` (I_n) and `besselKRight()` (K_n).
 * The other values come from identities, each verified with mpmath at 30
 * digits for orders 0 to 5 and points in the four quadrants:
 *
 * - `J_n(z) = iⁿ·I_n(−iz)` when `Im z ≥ 0`, `J_n(z) = (−i)ⁿ·I_n(iz)`
 *   otherwise (DLMF 10.27.6), so the argument of `I_n` has `Re ≥ 0`.
 * - `I_n(−z) = (−1)ⁿ·I_n(z)` (DLMF 10.27.1 with 10.11.1).
 * - `Y_n(w) = −i·((2/π)·i^(−n−1)·K_n(−iw) − iⁿ·I_n(−iw))` when `Re w ≥ 0`
 *   and `Im w ≥ 0` (from `Y = −i·(H⁽¹⁾ − J)` and DLMF 10.27.8), with
 *   `Y_n(w̄) = conj(Y_n(w))` for `Im w < 0`.
 * - In the left half-plane, `Y_n(z) = (−1)ⁿ·(Y_n(−z) ± 2i·J_n(−z))` and
 *   `K_n(z) = (−1)ⁿ·K_n(−z) ∓ iπ·I_n(−z)` (DLMF 10.11.2 and 10.34.2 for
 *   an integer order), upper sign for `Im z ≥ 0`. The branch cut is the
 *   negative real axis, and a point ON the cut takes the value from above
 *   (`Im z → 0⁺`), as `Ln(−2) = ln 2 + iπ` does: `Y₀(−2) = Y₀(2) + 2i·J₀(2)`.
 *   mpmath's `bessely` and `besselk` give the same values.
 * - A negative order: `J₋ₙ = (−1)ⁿ·J_n`, `Y₋ₙ = (−1)ⁿ·Y_n`, `I₋ₙ = I_n`,
 *   `K₋ₙ = K_n` (DLMF 10.4.1, 10.27.1).
 *
 * References: NIST DLMF chapters 9 and 10; I.J. Thompson and A.R. Barnett,
 * J. Comput. Phys. 64 (1986) 490 (the continued fraction CF2 for K_n).
 */

import {
  airyAi,
  airyAiPrime,
  airyBi,
  airyBiPrime,
  besselI,
  besselJ,
  besselK,
  besselY,
} from './special-functions.js';
import {
  type DD,
  ddAdd,
  ddDivD,
  ddMul,
  ddMulD,
  twoProd,
} from './double-double.js';

/** A complex number as the pair `[re, im]`. */
export type ComplexPair = [re: number, im: number];

const EULER_GAMMA = 0.5772156649015329;
const LN_2PI = 1.8378770664093453; // ln(2π)
const LN_SQRT_PI = 0.5723649429247001; // ln(√π)
const LN_2_SQRT_PI = 1.2655121234846454; // ln(2√π)

//
// Arithmetic on pairs
//

function cadd(a: ComplexPair, b: ComplexPair): ComplexPair {
  return [a[0] + b[0], a[1] + b[1]];
}

function csub(a: ComplexPair, b: ComplexPair): ComplexPair {
  return [a[0] - b[0], a[1] - b[1]];
}

function cmul(a: ComplexPair, b: ComplexPair): ComplexPair {
  return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}

function cscale(a: ComplexPair, s: number): ComplexPair {
  return [a[0] * s, a[1] * s];
}

function cabs(a: ComplexPair): number {
  return Math.hypot(a[0], a[1]);
}

function cconj(a: ComplexPair): ComplexPair {
  return [a[0], -a[1]];
}

/** a/b by Smith's method, which does not overflow in the intermediate
 *  products when the parts of `b` differ much in size. */
function cdiv(a: ComplexPair, b: ComplexPair): ComplexPair {
  const [c, d] = b;
  if (Math.abs(c) >= Math.abs(d)) {
    const r = d / c;
    const t = c + d * r;
    return [(a[0] + a[1] * r) / t, (a[1] - a[0] * r) / t];
  }
  const r = c / d;
  const t = c * r + d;
  return [(a[0] * r + a[1]) / t, (a[1] * r - a[0]) / t];
}

function cexp(a: ComplexPair): ComplexPair {
  const m = Math.exp(a[0]);
  // `e^{x}·cos(y)` with an infinite `e^{x}` and a zero `cos(y)` is `NaN`:
  // the value is past the range of a double either way, which the callers
  // detect with `Number.isFinite`.
  return [m * Math.cos(a[1]), m * Math.sin(a[1])];
}

/** The principal logarithm. */
function clog(a: ComplexPair): ComplexPair {
  return [Math.log(cabs(a)), Math.atan2(a[1], a[0])];
}

/** The principal square root (cut on the negative real axis). The formula
 *  avoids the cancellation of `√((|a| − re)/2)` when `re > 0`. */
function csqrt(a: ComplexPair): ComplexPair {
  const [x, y] = a;
  if (x === 0 && y === 0) return [0, 0];
  const m = cabs(a);
  if (x >= 0) {
    const t = Math.sqrt((m + x) / 2);
    return [t, y / (2 * t)];
  }
  const t = Math.sqrt((m - x) / 2);
  return [Math.abs(y) / (2 * t), y < 0 ? -t : t];
}

/** `cos(a)` and `sin(a)` of a complex `a`. */
function ccossin(a: ComplexPair): [cos: ComplexPair, sin: ComplexPair] {
  const [x, y] = a;
  const c = Math.cos(x);
  const s = Math.sin(x);
  const ch = Math.cosh(y);
  const sh = Math.sinh(y);
  return [
    [c * ch, -s * sh],
    [s * ch, c * sh],
  ];
}

/** `iᵏ·a` for an integer `k`, exactly: a quarter turn swaps the parts and
 *  changes one sign, with no rounding. */
function timesIPower(k: number, a: ComplexPair): ComplexPair {
  switch (((k % 4) + 4) % 4) {
    case 0:
      return [a[0], a[1]];
    case 1:
      return [-a[1], a[0]];
    case 2:
      return [-a[0], -a[1]];
    default:
      return [a[1], -a[0]];
  }
}

//
// I_n(z), Re z ≥ 0
//

/**
 * The power series (DLMF 10.25.2)
 * `I_n(z) = (z/2)ⁿ·Σ_k (z²/4)ᵏ/(k!·(n+k)!)`, for `n ≥ 0`.
 *
 * The terms are larger than the value by about `I_n(|z|)/|I_n(z)|`, which
 * is at most `e^{|z|}·√(2π|z|)` near the imaginary axis, so the caller uses
 * the series only for a small `|z|`.
 */
function besselISeries(n: number, z: ComplexPair): ComplexPair {
  const q = cscale(cmul(z, z), 0.25);
  let term: ComplexPair = [1, 0];
  let sum: ComplexPair = [1, 0];
  for (let k = 1; k <= 500; k++) {
    term = cscale(cmul(term, q), 1 / (k * (n + k)));
    sum = cadd(sum, term);
    const t = cabs(term);
    if (t < 1e-17 * cabs(sum) || t < 1e-300) break;
  }
  let p: ComplexPair = [1, 0];
  const h = cscale(z, 0.5);
  for (let i = 1; i <= n; i++) p = cscale(cmul(p, h), 1 / i);
  return cmul(sum, p);
}

/**
 * The large-argument expansion (DLMF 10.40.5, upper sign, valid for
 * `−π/2 < ph z < 3π/2`), for `Im z ≥ 0`:
 *
 * `I_n(z) ~ (e^{z}·Σ (−1)ᵏ a_k/zᵏ + i·(−1)ⁿ·e^{−z}·Σ a_k/zᵏ)/√(2πz)`,
 * `a_k/zᵏ = a_{k−1}/z^{k−1} · (4n² − (2k−1)²)/(8k·z)`.
 *
 * Both exponentials are kept: near the imaginary axis they have the same
 * size. The series diverge, so they are truncated at their smallest term.
 * Returns `undefined` when that term is above 10⁻¹⁶ (a small `|z|` or a
 * large order): the caller then uses the backward recurrence.
 */
function besselIAsymptotic(n: number, z: ComplexPair): ComplexPair | undefined {
  const mu = 4 * n * n;
  const inv8z = cdiv([1, 0], cscale(z, 8));
  let t: ComplexPair = [1, 0];
  let sPlus: ComplexPair = [1, 0];
  let sMinus: ComplexPair = [1, 0];
  let prev = Infinity;
  let smallest = 1;
  for (let k = 1; k <= 200; k++) {
    t = cscale(cmul(t, inv8z), (mu - (2 * k - 1) * (2 * k - 1)) / k);
    const at = cabs(t);
    if (at >= prev) break;
    prev = at;
    smallest = at;
    sPlus = cadd(sPlus, t);
    sMinus = k % 2 === 0 ? cadd(sMinus, t) : csub(sMinus, t);
    if (at < 1e-17) break;
  }
  if (smallest > 1e-16) return undefined;
  // The factors e^{±z}/√(2πz) are formed as one exponential, so that a value
  // in range does not overflow in an intermediate step.
  const halfLog = cscale(cadd([LN_2PI, 0], clog(z)), 0.5);
  const a = cmul(cexp(csub(z, halfLog)), sMinus);
  const b = cmul(cexp(csub([-z[0], -z[1]], halfLog)), sPlus);
  return cadd(a, timesIPower(n % 2 === 0 ? 1 : 3, b));
}

/**
 * Miller's backward recurrence (DLMF 3.6(iii)) with
 * `I_{k−1}(z) = (2k/z)·I_k(z) + I_{k+1}(z)`, from a start index `M` well
 * past `max(n, |z|)`, where `I_k` decays fast. The values are scaled by the
 * sum rule `e^{z} = I₀(z) + 2·Σ_{k≥1} I_k(z)` (DLMF 10.35.5). `I_k` is the
 * minimal solution of the recurrence, so the backward direction is stable
 * in the whole plane. The terms of the sum have about the size of the value
 * when `Re z ≥ 0`.
 */
function besselIMiller(n: number, z: ComplexPair): ComplexPair {
  const N = Math.max(n, Math.ceil(cabs(z)));
  const M = N + 30 + Math.ceil(Math.sqrt(60 * N));
  const twoOverZ = cdiv([2, 0], z);
  let fNext: ComplexPair = [0, 0]; // f_{k+1}
  let f: ComplexPair = [1, 0]; // f_k
  let fn: ComplexPair = n === M ? f : [0, 0];
  let sum: ComplexPair = [0, 0];
  for (let k = M; k >= 1; k--) {
    sum = cadd(sum, cscale(f, 2));
    const fPrev = cadd(cscale(cmul(twoOverZ, f), k), fNext);
    fNext = f;
    f = fPrev;
    if (k - 1 === n) fn = f;
    if (cabs(f) > 1e200) {
      f = cscale(f, 1e-200);
      fNext = cscale(fNext, 1e-200);
      fn = cscale(fn, 1e-200);
      sum = cscale(sum, 1e-200);
    }
  }
  sum = cadd(sum, f);
  // e^{z}/sum as one exponential: e^{z} alone overflows for Re z > 709.
  return cmul(fn, cexp(csub(z, clog(sum))));
}

/** `I_n(z)` for `n ≥ 0` and `Re z ≥ 0`. */
function besselIRight(n: number, z: ComplexPair): ComplexPair {
  if (z[1] === 0) return [besselI(n, z[0]), 0];
  // I_n(z̄) = conj(I_n(z)): the expansion below is written for Im z ≥ 0.
  if (z[1] < 0) return cconj(besselIRight(n, cconj(z)));
  const r = cabs(z);
  if (r <= 2) return besselISeries(n, z);
  if (r >= 17) {
    const v = besselIAsymptotic(n, z);
    if (v !== undefined) return v;
  }
  return besselIMiller(n, z);
}

//
// K_n(z), Re z ≥ 0
//

/**
 * `K₀(z)` and `K₁(z)` by the series with the logarithm (DLMF 10.31.1),
 * with `h = z/2`, `q = h²`:
 *
 * `K₀(z) = −(ln h + γ)·I₀(z) + Σ_{k≥1} H_k·qᵏ/(k!)²`
 * `K₁(z) = 1/z + ln(h)·I₁(z) − (h/2)·Σ_{k≥0} (ψ(k+1) + ψ(k+2))·qᵏ/(k!·(k+1)!)`
 *
 * where `H_k` is the harmonic number and `ψ(k+1) = H_k − γ`. Used for
 * `|z| ≤ 2`, where the terms are at most about 10 times the value.
 */
function besselK01Series(z: ComplexPair): [ComplexPair, ComplexPair] {
  const h = cscale(z, 0.5);
  const q = cmul(h, h);
  const lnh = clog(h);
  let i0: ComplexPair = [1, 0]; // Σ qᵏ/(k!)²
  let i1: ComplexPair = [1, 0]; // Σ qᵏ/(k!(k+1)!)
  let s0: ComplexPair = [0, 0];
  let s1: ComplexPair = [1 - 2 * EULER_GAMMA, 0]; // k = 0: ψ(1) + ψ(2)
  let t0: ComplexPair = [1, 0]; // qᵏ/(k!)²
  let t1: ComplexPair = [1, 0]; // qᵏ/(k!(k+1)!)
  let hk = 0;
  for (let k = 1; k <= 200; k++) {
    hk += 1 / k;
    t0 = cscale(cmul(t0, q), 1 / (k * k));
    t1 = cscale(cmul(t1, q), 1 / (k * (k + 1)));
    i0 = cadd(i0, t0);
    i1 = cadd(i1, t1);
    s0 = cadd(s0, cscale(t0, hk));
    // ψ(k+1) + ψ(k+2) = 2H_k + 1/(k+1) − 2γ
    s1 = cadd(s1, cscale(t1, 2 * hk + 1 / (k + 1) - 2 * EULER_GAMMA));
    if (cabs(t0) < 1e-18 && cabs(t1) < 1e-18) break;
  }
  const I1 = cmul(i1, h);
  const k0 = cadd(cmul(cadd(lnh, [EULER_GAMMA, 0]), cscale(i0, -1)), s0);
  const k1 = csub(
    cadd(cdiv([1, 0], z), cmul(lnh, I1)),
    cmul(cscale(h, 0.5), s1)
  );
  return [k0, k1];
}

/**
 * `K₀(z)` and `K₁(z)` by Steed's continued fraction CF2 with the
 * Thompson–Barnett recurrences, the method of the real kernel `besselK`
 * written in complex arithmetic:
 * `K₀(z) = √(π/(2z))·e^{−z}/S` and `K₁(z) = K₀(z)·(z + ½ − h)/z`. Used for
 * `|z| > 2` with `Re z ≥ 0`. The number of steps grows as `|z|` decreases
 * (about 60 at `|z| = 2`).
 */
function besselK01CF2(z: ComplexPair): [ComplexPair, ComplexPair] {
  const a1 = 0.25;
  let b: ComplexPair = [2 * (1 + z[0]), 2 * z[1]];
  let d = cdiv([1, 0], b);
  let h = d;
  let delh = d;
  let q1: ComplexPair = [0, 0];
  let q2: ComplexPair = [1, 0];
  let a = -a1;
  let c = a1;
  let q: ComplexPair = [a1, 0];
  let s = cadd([1, 0], cscale(delh, a1));
  for (let i = 2; i <= 20000; i++) {
    a -= 2 * (i - 1);
    c = (-a * c) / i;
    const qnew = cscale(csub(q1, cmul(b, q2)), 1 / a);
    q1 = q2;
    q2 = qnew;
    q = cadd(q, cscale(qnew, c));
    b = [b[0] + 2, b[1]];
    d = cdiv([1, 0], cadd(b, cscale(d, a)));
    delh = cmul(csub(cmul(b, d), [1, 0]), delh);
    h = cadd(h, delh);
    const dels = cmul(q, delh);
    s = cadd(s, dels);
    if (cabs(dels) < 1e-17 * cabs(s)) break;
  }
  h = cscale(h, a1);
  // √(π/(2z))·e^{−z} as one exponential, so that it underflows only when
  // the value does.
  const lnPref = csub(
    cscale(csub([Math.log(Math.PI / 2), 0], clog(z)), 0.5),
    z
  );
  const k0 = cdiv(cexp(lnPref), s);
  const k1 = cdiv(cmul(k0, csub(cadd(z, [0.5, 0]), h)), z);
  return [k0, k1];
}

/** `K_n(z)` for `n ≥ 0` and `Re z ≥ 0`: `K₀` and `K₁` from the series or
 *  CF2, then the forward recurrence `K_{k+1} = (2k/z)·K_k + K_{k−1}`
 *  (DLMF 10.29.1), stable because `K_k` is the dominant solution. */
function besselKRight(n: number, z: ComplexPair): ComplexPair {
  if (z[1] === 0) return [besselK(n, z[0]), 0];
  const [k0, k1] = cabs(z) <= 2 ? besselK01Series(z) : besselK01CF2(z);
  if (n === 0) return k0;
  let prev = k0;
  let cur = k1;
  const twoOverZ = cdiv([2, 0], z);
  for (let k = 1; k < n; k++) {
    const next = cadd(cscale(cmul(twoOverZ, cur), k), prev);
    prev = cur;
    cur = next;
  }
  return cur;
}

//
// The four Bessel functions
//

/** `I_n(z)` for an integer `n` and a complex `z`. */
export function besselIComplex(n: number, z: ComplexPair): ComplexPair {
  n = Math.abs(n);
  if (z[0] < 0) {
    const v = besselIRight(n, [-z[0], -z[1]]);
    return n % 2 === 0 ? v : cscale(v, -1);
  }
  return besselIRight(n, z);
}

/** `J_n(z)` for an integer `n` and a complex `z`. */
export function besselJComplex(n: number, z: ComplexPair): ComplexPair {
  const sign = n < 0 && n % 2 !== 0 ? -1 : 1;
  n = Math.abs(n);
  if (z[1] === 0) return [sign * besselJ(n, z[0]), 0];
  const v =
    z[1] > 0
      ? timesIPower(n, besselIRight(n, [z[1], -z[0]]))
      : timesIPower(-n, besselIRight(n, [-z[1], z[0]]));
  return cscale(v, sign);
}

/** `K_n(z)` for an integer `n` and a complex `z` (the value on the
 *  negative real axis is the limit from above). */
export function besselKComplex(n: number, z: ComplexPair): ComplexPair {
  n = Math.abs(n);
  if (z[0] >= 0) return besselKRight(n, z);
  const w: ComplexPair = [-z[0], -z[1]];
  const k = besselKRight(n, w);
  const i = cscale(besselIRight(n, w), Math.PI);
  const t = n % 2 === 0 ? k : cscale(k, -1);
  // ∓ iπ·I_n(−z), upper sign for Im z ≥ 0
  return z[1] >= 0 ? csub(t, timesIPower(1, i)) : cadd(t, timesIPower(1, i));
}

/** `Y_n(w)` for `n ≥ 0`, `Re w ≥ 0`, `Im w > 0`. */
function besselYFirstQuadrant(n: number, w: ComplexPair): ComplexPair {
  const u: ComplexPair = [w[1], -w[0]]; // −iw, Re u ≥ 0
  const k = cscale(besselKRight(n, u), 2 / Math.PI);
  const i = besselIRight(n, u);
  return timesIPower(-1, csub(timesIPower(-n - 1, k), timesIPower(n, i)));
}

/** `Y_n(z)` for an integer `n` and a complex `z` (the value on the
 *  negative real axis is the limit from above). */
export function besselYComplex(n: number, z: ComplexPair): ComplexPair {
  const sign = n < 0 && n % 2 !== 0 ? -1 : 1;
  n = Math.abs(n);
  let v: ComplexPair;
  if (z[0] >= 0) {
    if (z[1] === 0) v = [besselY(n, z[0]), 0];
    else if (z[1] > 0) v = besselYFirstQuadrant(n, z);
    else v = cconj(besselYFirstQuadrant(n, cconj(z)));
  } else {
    const w: ComplexPair = [-z[0], -z[1]];
    const y = besselYComplex(n, w);
    const j = cscale(besselJComplex(n, w), 2);
    // ± 2i·J_n(−z), upper sign for Im z ≥ 0
    const t =
      z[1] >= 0 ? cadd(y, timesIPower(1, j)) : csub(y, timesIPower(1, j));
    v = n % 2 === 0 ? t : cscale(t, -1);
  }
  return cscale(v, sign);
}

//
// Airy functions
//

// Ai(0) = 3^{−2/3}/Γ(2/3) and −Ai′(0) = 3^{−1/3}/Γ(1/3) (DLMF 9.2.3–9.2.6)
// and √3, correctly rounded to double-double (mpmath at 60 digits).
const AIRY_C1: DD = [0.3550280538878172, 2.05233632436212e-17];
const AIRY_C2: DD = [0.2588194037928068, -2.522243111610832e-17];
const SQRT3_DD: DD = [1.7320508075688772, 1.0035084221806903e-16];

/** A complex number in double-double: real and imaginary parts. */
type ComplexDD = [re: DD, im: DD];

function cddAdd(a: ComplexDD, b: ComplexDD): ComplexDD {
  return [ddAdd(a[0], b[0]), ddAdd(a[1], b[1])];
}

function cddMul(a: ComplexDD, b: ComplexDD): ComplexDD {
  const re = ddAdd(ddMul(a[0], b[0]), ddMul(ddNeg(a[1]), b[1]));
  const im = ddAdd(ddMul(a[0], b[1]), ddMul(a[1], b[0]));
  return [re, im];
}

function cddDivD(a: ComplexDD, d: number): ComplexDD {
  return [ddDivD(a[0], d), ddDivD(a[1], d)];
}

function cddScaleDD(a: ComplexDD, s: DD): ComplexDD {
  return [ddMul(a[0], s), ddMul(a[1], s)];
}

function ddNeg(a: DD): DD {
  return [-a[0], -a[1]];
}

function cddNeg(a: ComplexDD): ComplexDD {
  return [ddNeg(a[0]), ddNeg(a[1])];
}

function cddAbs(a: ComplexDD): number {
  return Math.hypot(a[0][0], a[1][0]);
}

/** z³ in double-double, from the exact products of the parts of z. */
function cddCube(z: ComplexPair): ComplexDD {
  const [x, y] = z;
  const re2 = ddAdd(twoProd(x, x), ddNeg(twoProd(y, y)));
  const im2 = ddMulD(twoProd(x, y), 2);
  return [
    ddAdd(ddMulD(re2, x), ddNeg(ddMulD(im2, y))),
    ddAdd(ddMulD(re2, y), ddMulD(im2, x)),
  ];
}

/**
 * The Maclaurin series of the Airy functions (DLMF 9.4.1–9.4.4) at a complex
 * `z`, in double-double:
 * `Ai = c₁·f − c₂·g`, `Bi = √3·(c₁·f + c₂·g)`, and the same with `f′`, `g′`
 * for the derivatives, where
 * `f = Σ aₖ z^{3k}` (`a₀ = 1`, `aₖ = aₖ₋₁/((3k−1)·3k)`) and
 * `g = Σ bₖ z^{3k+1}` (`b₀ = 1`, `bₖ = bₖ₋₁/(3k·(3k+1))`).
 *
 * The terms are larger than the value by up to `e^{2|ζ|}` (`ζ = ⅔z^{3/2}`),
 * about 10¹⁶ at `|z| = 9`, the largest radius where the caller uses the
 * series. Double-double keeps about 32 digits, so about 16 remain.
 */
function airySeries(
  z: ComplexPair,
  derivative: boolean
): [f: ComplexDD, g: ComplexDD] {
  const z3 = cddCube(z);
  let tf: ComplexDD;
  let tg: ComplexDD;
  if (!derivative) {
    tf = [
      [1, 0],
      [0, 0],
    ];
    tg = [
      [z[0], 0],
      [z[1], 0],
    ];
  } else {
    // f′ starts at k = 1 with 3·a₁·z² = z²/2; g′ starts at k = 0 with 1.
    const x = z[0];
    const y = z[1];
    tf = [ddDivD(ddAdd(twoProd(x, x), ddNeg(twoProd(y, y))), 2), twoProd(x, y)];
    tg = [
      [1, 0],
      [0, 0],
    ];
  }
  let f = tf;
  let g = tg;
  for (let k = 1; k <= 300; k++) {
    const k3 = 3 * k;
    if (!derivative) {
      tf = cddDivD(cddMul(tf, z3), (k3 - 1) * k3);
      tg = cddDivD(cddMul(tg, z3), k3 * (k3 + 1));
    } else {
      // f′: the term of index k+1 from the term of index k;
      // g′: the term of index k from the term of index k−1.
      tf = cddDivD(cddMul(tf, z3), k3 * (k3 + 2));
      tg = cddDivD(cddMul(tg, z3), (k3 - 2) * k3);
    }
    f = cddAdd(f, tf);
    g = cddAdd(g, tg);
    if (cddAbs(tf) + cddAbs(tg) < 1e-34 * (cddAbs(f) + cddAbs(g) + 1e-300))
      break;
  }
  return [f, g];
}

function airySeriesValue(
  z: ComplexPair,
  kind: 'Ai' | 'Bi',
  derivative: boolean
): ComplexPair {
  const [f, g] = airySeries(z, derivative);
  const cf = cddScaleDD(f, AIRY_C1);
  const cg = cddScaleDD(g, AIRY_C2);
  const v =
    kind === 'Ai'
      ? cddAdd(cf, cddNeg(cg))
      : cddScaleDD(cddAdd(cf, cg), SQRT3_DD);
  return [v[0][0], v[1][0]];
}

/** The ratio `u_k/u_{k−1} = (6k−5)(6k−3)(6k−1)/(216·k·(2k−1))` of the
 *  coefficients of the Airy expansions (DLMF 9.7.2). */
function airyURatio(k: number): number {
  return ((6 * k - 5) * (6 * k - 3) * (6 * k - 1)) / (216 * k * (2 * k - 1));
}

/**
 * The terms `c_k/ζᵏ` of the Airy expansions, with `c_k = u_k` or, for the
 * derivatives, `c_k = v_k = u_k·(6k+1)/(1−6k)` (DLMF 9.7.2), truncated at
 * the smallest term (the series diverge). The terms are returned in order,
 * the term of index 0 (1) included.
 */
function airyTerms(zeta: ComplexPair, derivative: boolean): ComplexPair[] {
  const invZeta = cdiv([1, 0], zeta);
  const terms: ComplexPair[] = [[1, 0]];
  let u: ComplexPair = [1, 0]; // u_k/ζᵏ
  let prev = Infinity;
  for (let k = 1; k <= 100; k++) {
    u = cscale(cmul(u, invZeta), airyURatio(k));
    const t = derivative ? cscale(u, (6 * k + 1) / (1 - 6 * k)) : u;
    const at = cabs(t);
    if (at >= prev) break;
    prev = at;
    terms.push(t);
    if (at < 1e-18) break;
  }
  return terms;
}

/** ζ = ⅔·z^{3/2} with the principal branch of the power. */
function airyZeta(z: ComplexPair): ComplexPair {
  return cscale(cmul(z, csqrt(z)), 2 / 3);
}

/**
 * `Ai(z)` (or `Ai′(z)`) for `|z| > 9`, from the expansions of DLMF 9.7:
 *
 * - `|ph z| ≤ 2π/3`: `Ai(z) ~ e^{−ζ}/(2√π·z^{1/4})·Σ (−1)ᵏ u_k/ζᵏ` and
 *   `Ai′(z) ~ −z^{1/4}·e^{−ζ}/(2√π)·Σ (−1)ᵏ v_k/ζᵏ` (9.7.5, 9.7.6).
 * - otherwise, with `w = −z` and `ζ = ⅔·w^{3/2}`, `A = ζ − π/4`:
 *   `Ai(−w) ~ (cos A·P_u + sin A·Q_u)/(√π·w^{1/4})` and
 *   `Ai′(−w) ~ w^{1/4}·(sin A·P_v − cos A·Q_v)/√π` (9.7.9, 9.7.10), where
 *   `P = Σ (−1)ᵏ c_{2k}/ζ^{2k}` and `Q = Σ (−1)ᵏ c_{2k+1}/ζ^{2k+1}`.
 *
 * Both forms hold in the sector where they are used; the switch at
 * `|ph z| = 2π/3` is the Stokes line of `Ai`, where the term that the first
 * form leaves out is smallest (relative size `e^{−2|ζ|}`, below 10⁻¹⁵ for
 * `|z| > 9`).
 */
function airyAiAsymptotic(z: ComplexPair, derivative: boolean): ComplexPair {
  const ph = Math.atan2(z[1], z[0]);
  if (Math.abs(ph) <= (2 * Math.PI) / 3) {
    const zeta = airyZeta(z);
    const terms = airyTerms(zeta, derivative);
    let sum: ComplexPair = [0, 0];
    for (let k = terms.length - 1; k >= 0; k--)
      sum = k % 2 === 0 ? cadd(sum, terms[k]) : csub(sum, terms[k]);
    // e^{−ζ}·z^{∓1/4}/(2√π) as one exponential
    const lnz = clog(z);
    const quarter = cscale(lnz, derivative ? 0.25 : -0.25);
    const pref = cexp(
      cadd(csub([-zeta[0], -zeta[1]], [LN_2_SQRT_PI, 0]), quarter)
    );
    const v = cmul(pref, sum);
    return derivative ? cscale(v, -1) : v;
  }
  const w: ComplexPair = [-z[0], -z[1]];
  const zeta = airyZeta(w);
  const terms = airyTerms(zeta, derivative);
  let P: ComplexPair = [0, 0];
  let Q: ComplexPair = [0, 0];
  for (let j = terms.length - 1; j >= 0; j--) {
    // (−1)ᵏ for c_{2k} in P and c_{2k+1} in Q: +, +, −, − over j mod 4
    const t = j % 4 === 0 || j % 4 === 1 ? terms[j] : cscale(terms[j], -1);
    if (j % 2 === 0) P = cadd(P, t);
    else Q = cadd(Q, t);
  }
  const [cosA, sinA] = ccossin(csub(zeta, [Math.PI / 4, 0]));
  const lnw = clog(w);
  const pref = cexp(
    csub(cscale(lnw, derivative ? 0.25 : -0.25), [LN_SQRT_PI, 0])
  );
  const s = derivative
    ? csub(cmul(sinA, P), cmul(cosA, Q))
    : cadd(cmul(cosA, P), cmul(sinA, Q));
  return cmul(pref, s);
}

// ω = e^{2πi/3}, and the factors of the connection formulas below
const OMEGA: ComplexPair = [-0.5, Math.sqrt(3) / 2];
const OMEGA_BAR: ComplexPair = [-0.5, -Math.sqrt(3) / 2];
const E_PI_6: ComplexPair = [Math.sqrt(3) / 2, 0.5]; // e^{πi/6}
const E_5PI_6: ComplexPair = [-Math.sqrt(3) / 2, 0.5]; // e^{5πi/6}

/**
 * `Bi(z)` (or `Bi′(z)`) for `|z| > 9` from the connection formula
 * (DLMF 9.2.10) `Bi(z) = e^{πi/6}·Ai(ωz) + e^{−πi/6}·Ai(ω̄z)`, and its
 * derivative `Bi′(z) = e^{5πi/6}·Ai′(ωz) + e^{−5πi/6}·Ai′(ω̄z)`, with
 * `ω = e^{2πi/3}` (both verified with mpmath). Each `Ai` is computed in a
 * sector where its expansion holds, so there is no Stokes line to handle
 * for `Bi`.
 */
function airyBiAsymptotic(z: ComplexPair, derivative: boolean): ComplexPair {
  const f = derivative ? E_5PI_6 : E_PI_6;
  const a = airyAiAsymptotic(cmul(OMEGA, z), derivative);
  const b = airyAiAsymptotic(cmul(OMEGA_BAR, z), derivative);
  return cadd(cmul(f, a), cmul(cconj(f), b));
}

function airyComplex(
  kind: 'Ai' | 'Bi',
  derivative: boolean,
  z: ComplexPair
): ComplexPair {
  if (z[1] === 0) {
    const x = z[0];
    if (kind === 'Ai') return [derivative ? airyAiPrime(x) : airyAi(x), 0];
    return [derivative ? airyBiPrime(x) : airyBi(x), 0];
  }
  if (cabs(z) <= 9) return airySeriesValue(z, kind, derivative);
  return kind === 'Ai'
    ? airyAiAsymptotic(z, derivative)
    : airyBiAsymptotic(z, derivative);
}

/**
 * `Ai(z)` for a complex `z`: the Maclaurin series in double-double for
 * `|z| ≤ 9`, the expansions of DLMF 9.7 beyond.
 */
export function airyAiComplex(z: ComplexPair): ComplexPair {
  return airyComplex('Ai', false, z);
}

/** `Bi(z)` for a complex `z`: see `airyAiComplex()` and
 *  `airyBiAsymptotic()`. */
export function airyBiComplex(z: ComplexPair): ComplexPair {
  return airyComplex('Bi', false, z);
}

/** `Ai′(z)` for a complex `z`: see `airyAiComplex()`. */
export function airyAiPrimeComplex(z: ComplexPair): ComplexPair {
  return airyComplex('Ai', true, z);
}

/** `Bi′(z)` for a complex `z`: see `airyBiComplex()`. */
export function airyBiPrimeComplex(z: ComplexPair): ComplexPair {
  return airyComplex('Bi', true, z);
}
