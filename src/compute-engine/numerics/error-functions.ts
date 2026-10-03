/**
 * Machine-precision kernels of the error functions `erf`, `erfc` and `erfi`,
 * and of the Dawson function.
 *
 * The approximations are W. J. Cody's rational functions: `CALERF` for erf
 * and erfc, and `DAW` for the Dawson integral D(x) = e^{−x²}∫₀ˣ e^{t²} dt,
 * which gives erfi(x) = (2/√π)·e^{x²}·D(x). Their approximation error is
 * below 10⁻¹⁸, much smaller than the rounding of a double, so the error of a
 * result comes from its evaluation in floating point. The kernels evaluate
 * the rationals with compensated Horner (each step also computes its own
 * rounding error, with the Dekker and Knuth error-free transformations), keep
 * the part of each coefficient that a double does not hold, and multiply by
 * e^{±x²} last, with x² split so that its rounding does not show.
 *
 * Measured against mpmath at 40 digits on 7,100 points in [0, 30] and on
 * powers of ten down to 10⁻³⁰⁰: the result is at most 1 unit in the last
 * place (ulp) away from the correctly rounded value for erf, 2 for erfc, and
 * 2 for erfi below 26.46 (3 from 26.46 to the overflow at 26.71, where
 * e^{x²} is out of the double range and is scaled).
 *
 * References:
 * - W. J. Cody, "Rational Chebyshev approximations for the error function",
 *   Math. Comp. 23 (1969) 631–637; Fortran `CALERF`,
 *   https://www.netlib.org/specfun/erf
 * - W. J. Cody, K. A. Paciorek, H. C. Thacher, "Chebyshev approximations
 *   for Dawson's integral", Math. Comp. 24 (1970) 171–178; Fortran `DAW`,
 *   https://www.netlib.org/specfun/daw
 * - S. Graillat, P. Langlois, N. Louvet, "Compensated Horner scheme" (2005).
 *
 * @module numerics/error-functions
 */

/** 1/√π, rounded to a double, and the part the double does not hold. */
const INV_SQRT_PI = 0.5641895835477563;
const INV_SQRT_PI_LO = 7.66772980658294e-18;
/** 2/√π, rounded to a double, and the part the double does not hold. */
const TWO_INV_SQRT_PI = 1.1283791670955126;
const TWO_INV_SQRT_PI_LO = 1.533545961316588e-17;

//
// Error-free transformations.
//
// A function that computes a double-double value returns its high part and
// writes its low part to `lowPart[0]`. A typed array is used instead of a
// returned object, which is allocated, and instead of a module variable: a
// double written to a module variable is boxed on each write, which is
// slower.
//

/** 2^27 + 1: the factor that splits a double into two 26-bit halves. */
const SPLIT = 134217729;
const lowPart = new Float64Array(1);

/**
 * Value of the polynomial c[0]·yⁿ + c[1]·yⁿ⁻¹ + … + c[n] at `y`, with
 * compensated Horner. The coefficients are `c[i] + cLo[i]`: `cLo[i]` is the
 * part of the decimal coefficient that the double `c[i]` does not hold.
 * Returns the high part; the low part (the sum of the rounding errors and of
 * the low parts of the coefficients, carried through the scheme) is in
 * `lowPart[0]`.
 */
function compensatedHorner(
  c: readonly number[],
  cLo: readonly number[],
  y: number
): number {
  let t = SPLIT * y;
  const yHi = t - (t - y);
  const yLo = y - yHi;
  let s = c[0];
  let e = cLo[0];
  for (let i = 1; i < c.length; i++) {
    // p + pErr = s·y exactly (Dekker's product)
    const p = s * y;
    t = SPLIT * s;
    const sHi = t - (t - s);
    const sLo = s - sHi;
    const pErr = sHi * yHi - p + sHi * yLo + sLo * yHi + sLo * yLo;
    // r + rErr = p + c[i] exactly (Knuth's sum)
    const r = p + c[i];
    const b = r - p;
    const rErr = p - (r - b) + (c[i] - b);
    s = r;
    e = e * y + (pErr + rErr + cLo[i]);
  }
  lowPart[0] = e;
  return s;
}

/**
 * (nHi + nLo)/(dHi + dLo) as a double-double: the high part is returned and
 * the low part is in `lowPart[0]`.
 */
function ddDivide(nHi: number, nLo: number, dHi: number, dLo: number): number {
  const q = nHi / dHi;
  let t = SPLIT * q;
  const qHi = t - (t - q);
  const qLo = q - qHi;
  t = SPLIT * dHi;
  const dHiHi = t - (t - dHi);
  const dHiLo = dHi - dHiHi;
  // p + pErr = q·dHi exactly
  const p = q * dHi;
  const pErr = qHi * dHiHi - p + qHi * dHiLo + qLo * dHiHi + qLo * dHiLo;
  const c = (nHi - p - pErr + nLo - q * dLo) / dHi;
  const hi = q + c;
  lowPart[0] = c - (hi - q);
  return hi;
}

/**
 * (aHi + aLo)·(bHi + bLo) as a double-double: the high part is returned and
 * the low part is in `lowPart[0]`.
 */
function ddMultiply(
  aHi: number,
  aLo: number,
  bHi: number,
  bLo: number
): number {
  const p = aHi * bHi;
  let t = SPLIT * aHi;
  const a1 = t - (t - aHi);
  const a2 = aHi - a1;
  t = SPLIT * bHi;
  const b1 = t - (t - bHi);
  const b2 = bHi - b1;
  const e = a1 * b1 - p + a1 * b2 + a2 * b1 + a2 * b2 + (aHi * bLo + aLo * bHi);
  const hi = p + e;
  lowPart[0] = e - (hi - p);
  return hi;
}

/**
 * e^{sign·y²}·(rHi + rLo) for y ≥ 0, with one rounding after the
 * exponential.
 *
 * y² is not computed: its rounding error, multiplied by y², would show in
 * the result (y² ≈ 700 makes it 700 units in the last place). Instead
 * y = a + f, where `a` keeps the bits of y down to 2⁻¹⁶. Then a² is exact
 * (a has at most 21 significant bits for y < 32), and
 * y² − a² = (y − a)(y + a) = del is at most about 10⁻³. So
 * e^{sign·y²} = e^{sign·a²}·(1 + m) with m = expm1(sign·del), which is
 * accurate to its last bit. The factor (rHi + rLo)(1 + m) is kept as a
 * double-double, and only its product with e^{sign·a²} rounds.
 *
 * When e^{sign·a²} itself is outside the normal range of a double (a² > 700)
 * but the product is not, the exponential is scaled by e^{∓40} and the
 * product scaled back.
 */
function expSquareTimes(
  sign: 1 | -1,
  y: number,
  rHi: number,
  rLo: number
): number {
  const a = Math.trunc(y * 65536) / 65536;
  const del = (y - a) * (y + a);
  const m = Math.expm1(sign * del);
  const t = rHi * m;
  const hi = rHi + t;
  const lo = t - (hi - rHi) + rLo * (1 + m);
  const exponent = sign * a * a;
  if (exponent < -700) {
    const e = Math.exp(exponent + 40);
    return (e * hi + e * lo) * Math.exp(-40);
  }
  if (exponent > 700) {
    const e = Math.exp(exponent - 40);
    return (e * hi + e * lo) * Math.exp(40);
  }
  const e = Math.exp(exponent);
  return e * hi + e * lo;
}

//
// CALERF: erf and erfc.
//
// Three bands of y = |x|:
// - y ≤ 0.46875: erf(y) = y·R₁(y²), R₁ a (4, 4) rational;
// - 0.46875 < y ≤ 4: erfc(y) = e^{−y²}·R₂(y), R₂ an (8, 8) rational;
// - y > 4: erfc(y) = (e^{−y²}/y)·(1/√π + y⁻²·R₃(y⁻²)), R₃ a (5, 5) rational.
//
// The coefficient arrays are in Horner order (highest power first), and each
// `…_LO` array holds the part of the decimal coefficient of Cody's table
// that the double does not hold.
//

const ERF_SMALL_THRESHOLD = 0.46875;

const ERF_SMALL_NUM = [
  1.85777706184603153e-1, 3.1611237438705656, 1.13864154151050156e2,
  3.77485237685302021e2, 3.20937758913846947e3,
];
const ERF_SMALL_NUM_LO = [
  5.416702813818119e-21, 1.0548186774540226e-16, -2.2479264470748604e-15,
  -3.6016967575997115e-15, 9.497032806277276e-14,
];
const ERF_SMALL_DEN = [
  1, 2.36012909523441209e1, 2.44024637934444173e2, 1.28261652607737228e3,
  2.84423683343917062e3,
];
const ERF_SMALL_DEN_LO = [
  0, -1.431396647496149e-15, 9.395336285233499e-16, -4.756335288286209e-14,
  -2.0311236299574375e-13,
];

const ERFC_MID_NUM = [
  2.15311535474403846e-8, 5.64188496988670089e-1, 8.88314979438837594,
  6.61191906371416295e1, 2.98635138197400131e2, 8.8195222124176909e2,
  1.71204761263407058e3, 2.05107837782607147e3, 1.23033935479799725e3,
];
const ERFC_MID_NUM_LO = [
  1.1924348055929413e-24, -4.053940047736978e-17, -8.786879024142399e-16,
  1.4691960141062737e-15, 6.773012172430754e-15, 3.7460106108337643e-14,
  -9.41757458075881e-14, -1.0350867055356502e-13, 4.730488546192646e-14,
];
const ERFC_MID_DEN = [
  1, 1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2,
  1.62138957456669019e3, 3.29079923573345963e3, 4.36261909014324716e3,
  3.43936767414372164e3, 1.23033935480374942e3,
];
const ERFC_MID_DEN_LO = [
  0, -7.983691024244763e-16, 2.235159965697676e-15, -2.409748174995184e-14,
  -8.124007698148489e-14, -5.1796375662088396e-14, -2.1654533237218857e-13,
  2.4890174493193628e-14, -1.093101528659463e-13,
];

const ERFC_LARGE_NUM = [
  1.63153871373020978e-2, 3.05326634961232344e-1, 3.60344899949804439e-1,
  1.25781726111229246e-1, 1.60837851487422766e-2, 6.58749161529837803e-4,
];
const ERFC_LARGE_DEN = [
  1, 2.56852019228982242, 1.87295284992346047, 5.27905102951428412e-1,
  6.05183413124413191e-2, 2.33520497626869185e-3,
];

/** Plain Horner: c[0]·yⁿ + … + c[n]. */
function horner(c: readonly number[], y: number): number {
  let s = c[0];
  for (let i = 1; i < c.length; i++) s = s * y + c[i];
  return s;
}

/** erf(x) for |x| ≤ 0.46875, to 1 ulp. */
function erfSmall(x: number): number {
  const y = Math.abs(x);
  // For |x| ≤ 1.11·10⁻¹⁶, erf(x) = (2/√π)·x to the last bit.
  if (y <= 1.11e-16) return x * TWO_INV_SQRT_PI;
  const s = y * y;
  const n = compensatedHorner(ERF_SMALL_NUM, ERF_SMALL_NUM_LO, s);
  const nLo = lowPart[0];
  const d = compensatedHorner(ERF_SMALL_DEN, ERF_SMALL_DEN_LO, s);
  return x * ddDivide(n, nLo, d, lowPart[0]);
}

/**
 * erfc(y) for y > 0.46875.
 *
 * With `accurate` false, for y ≤ 4 the rational is evaluated with plain
 * Horner: the result is then about 5 ulps from the correctly rounded value,
 * which is all `erf` needs when erfc(y) is small next to
 * erf(y) = 1 − erfc(y).
 */
function erfcPositive(y: number, accurate: boolean): number {
  if (y <= 4) {
    if (!accurate) {
      const r = horner(ERFC_MID_NUM, y) / horner(ERFC_MID_DEN, y);
      return expSquareTimes(-1, y, r, 0);
    }
    const n = compensatedHorner(ERFC_MID_NUM, ERFC_MID_NUM_LO, y);
    const nLo = lowPart[0];
    const d = compensatedHorner(ERFC_MID_DEN, ERFC_MID_DEN_LO, y);
    const r = ddDivide(n, nLo, d, lowPart[0]);
    return expSquareTimes(-1, y, r, lowPart[0]);
  }
  // erfc(y) is below half the smallest subnormal double, and rounds to 0,
  // past y = 27.23. Past 27.3, e^{-y²} alone is 0 even after the scaling
  // in `expSquareTimes()`.
  if (y > 27.3) return 0;
  const s = 1 / (y * y);
  // y⁻²·R₃(y⁻²) is at most 1/32 of 1/√π, so its own rounding hardly shows:
  // only the difference with 1/√π and the division by y are kept exact.
  const r = (s * horner(ERFC_LARGE_NUM, s)) / horner(ERFC_LARGE_DEN, s);
  const nHi = INV_SQRT_PI - r;
  const nLo = INV_SQRT_PI - nHi - r + INV_SQRT_PI_LO;
  const q = ddDivide(nHi, nLo, y, 0);
  return expSquareTimes(-1, y, q, lowPart[0]);
}

/**
 * The Gauss error function erf(x), at most 1 ulp from the correctly rounded
 * value (Cody's `CALERF`; see the module comment).
 */
export function erf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const y = Math.abs(x);
  if (y <= ERF_SMALL_THRESHOLD) return erfSmall(x);
  // erfc(y) < 2⁻⁵⁴ for y ≥ 6: erf(y) rounds to 1. Below y = 1.5, erfc(y) is
  // more than 1/16 of erf(y), so its error shows in erf(y) and the accurate
  // evaluation is used.
  const r = y >= 6 ? 1 : 0.5 - erfcPositive(y, y < 1.5) + 0.5;
  return x < 0 ? -r : r;
}

/**
 * The complementary error function erfc(x) = 1 − erf(x), at most 2 ulps from
 * the correctly rounded value (Cody's `CALERF`; see the module comment).
 * There is no cancellation for large x: erfc is computed directly, and
 * underflows to 0 only past x = 27.23.
 */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return 0;
  if (x === -Infinity) return 2;
  const y = Math.abs(x);
  if (y <= ERF_SMALL_THRESHOLD) return 1 - erfSmall(x);
  const r = erfcPositive(y, true);
  return x < 0 ? 2 - r : r;
}

//
// DAW: the Dawson integral D(x) = e^{−x²}∫₀ˣ e^{t²} dt.
//
// Four bands of x²:
// - x² < 6.25: D(x) = x·R(x²), R a (9, 9) rational;
// - 6.25 ≤ x² < 12.25 and 12.25 ≤ x² < 25: D(x) = (p₉ + F(x²))/x, F a
//   continued fraction of 9 terms;
// - x² ≥ 25: D(x) = (1/2 + (1/2)·x⁻²·(p₉ + F(x²)))/x.
//
// In the three outer bands the continued fraction is a correction smaller
// than about 1/20 of p₉ (it is the part beyond the asymptotic 1/(2x)), so its
// own rounding hardly shows; p₉/x and the sum are kept as double-doubles.
//

const DAW_SMALL_NUM = [
  -2.6902039878870478241e-12, 4.18572065374337710778e-10,
  -1.34848304455939419963e-8, 9.28264872583444852976e-7,
  -1.23877783329049120592e-5, 4.07205792429155826266e-4,
  -2.84388121441008500446e-3, 4.70139022887204722217e-2,
  -1.38868086253931995101e-1, 1.00000000000000000004,
];
const DAW_SMALL_NUM_LO = [
  -1.3292981879558372e-28, -1.1017245452043868e-26, 4.324966833478948e-25,
  -3.6999754291122635e-23, 3.097892877853147e-22, 2.09405091484488e-21,
  9.43881798964358e-20, -2.165540244595887e-18, -6.862281013605185e-18, 4e-20,
];
const DAW_SMALL_DEN = [
  1.71257170854690554214e-10, 1.19266846372297253797e-8,
  4.32287827678631772231e-7, 1.03867633767414421898e-5,
  1.7891096528424624934e-4, 2.26061077235076703171e-3,
  2.07422774641447644725e-2, 1.32212955897210128811e-1,
  5.27798580412734677256e-1, 1.0,
];
const DAW_SMALL_DEN_LO = [
  -1.0894252485801562e-26, -1.5418445875272673e-26, 1.8864206417622874e-23,
  -8.39869526021408e-22, -9.496381437973274e-21, -2.1435388509641875e-19,
  2.461829918621879e-19, -3.8276194841688844e-18, 3.5835486473900036e-17, 0,
];

// Continued fractions: P[0..8] and Q[0..8] are the terms, P[9] the constant.
const DAW_P2 = [
  -1.7095380470085549493, -3.79258977271042880786e1, 2.61935631268825992835e1,
  1.25808703738951251885e1, -2.27571829525075891337e1, 4.56604250725163310122,
  -7.3308008989640287075, 4.65842087940015295573e1, -1.73717177843672791149e1,
  5.00260183622027967838e-1,
];
const DAW_Q2 = [
  1.82180093313514478378, 1.10067081034515532891e3, -7.08465686676573000364,
  4.53642111102577727153e2, 4.06209742218935689922e1, 3.02890110610122663923e2,
  1.70641269745236227356e2, 9.51190923960381458747e2, 2.06522691539642105009e-1,
];
const DAW_P2_CONSTANT_LO = 1.3751224974356125e-17;
const DAW_P3 = [
  -4.55169503255094815112, -1.86647123338493852582e1, -7.36315669126830526754,
  -6.68407240337696756838e1, 4.8450726508149145213e1, 2.69790586735467649969e1,
  -3.35044149820592449072e1, 7.50964459838919612289, -1.48432341823343965307,
  4.99999810924858824981e-1,
];
const DAW_Q3 = [
  4.47820908025971749852e1, 9.98607198039452081913e1, 1.40238373126149385228e1,
  3.48817758822286353588e3, -9.18871385293215873406, 1.24018500009917163023e3,
  -6.88024952504512254535e1, -2.3125157538514514307, 2.50041492369922381761e-1,
];
const DAW_P3_CONSTANT_LO = -2.0170419473040732e-17;
const DAW_P4 = [
  -8.11753647558432685797, -3.8404388247745445343e1, -2.23787669028751886675e1,
  -2.88301992467056105854e1, -5.99085540418222002197, -1.13867365736066102577e1,
  -6.5282872752698074159, -4.50002293000355585708, -2.50000000088955834952,
  5.000000000000004884e-1,
];
const DAW_Q4 = [
  2.69382300417238816428e2, 5.04198958742465752861e1, 6.11539671480115846173e1,
  2.08210246935564547889e2, 1.97325365692316183531e1, -1.22097010558934838708e1,
  -6.99732735041547247161, -2.49999970104184464568, 7.49999999999027092188e-1,
];

/** The continued fraction F(y) = Q[8]/(P[8] + y + Q[7]/(P[7] + y + …)). */
function dawsonFraction(p: readonly number[], q: readonly number[], y: number) {
  let f = 0;
  for (let i = 0; i < 9; i++) f = q[i] / (p[i] + y + f);
  return f;
}

/**
 * The Dawson integral D(x) for x ≥ 0 as a double-double: the high part is
 * returned and the low part is in `lowPart[0]`.
 */
function dawsonPositive(x: number): number {
  if (x < 1.05e-8) {
    lowPart[0] = 0;
    return x;
  }
  const y = x * x;
  if (y < 6.25) {
    const n = compensatedHorner(DAW_SMALL_NUM, DAW_SMALL_NUM_LO, y);
    const nLo = lowPart[0];
    const d = compensatedHorner(DAW_SMALL_DEN, DAW_SMALL_DEN_LO, y);
    const r = ddDivide(n, nLo, d, lowPart[0]);
    return ddMultiply(x, 0, r, lowPart[0]);
  }
  if (y >= 25) {
    // D(x) = 1/(2x) for x > 9.49·10⁷, to the last bit, and the fraction
    // would overflow past 1.3·10¹⁵⁴. The quotient is computed directly:
    // `ddDivide()` splits its divisor with a product that overflows past
    // 1.3·10³⁰⁰.
    if (x > 9.49e7) {
      lowPart[0] = 0;
      return 0.5 / x;
    }
    const f = DAW_P4[9] + dawsonFraction(DAW_P4, DAW_Q4, y);
    return ddDivide(0.5 + (0.5 / y) * f, 0, x, 0);
  }
  const [p, q, constantLo] =
    y < 12.25
      ? [DAW_P2, DAW_Q2, DAW_P2_CONSTANT_LO]
      : [DAW_P3, DAW_Q3, DAW_P3_CONSTANT_LO];
  const h = ddDivide(p[9], constantLo, x, 0);
  const hLo = lowPart[0];
  const correction = dawsonFraction(p, q, y) / x;
  const hi = h + correction;
  lowPart[0] = correction - (hi - h) + hLo;
  return hi;
}

/** The Dawson integral D(x) = e^{−x²}∫₀ˣ e^{t²} dt (Cody's `DAW`). */
export function dawson(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (!Number.isFinite(x)) return 0;
  if (x === 0) return x;
  const r = dawsonPositive(Math.abs(x));
  return x < 0 ? -r : r;
}

/**
 * The imaginary error function erfi(x) = −i·erf(ix) = (2/√π)∫₀ˣ e^{t²} dt,
 * computed as (2/√π)·e^{x²}·D(x) with the Dawson integral D. At most 2 ulps
 * from the correctly rounded value for |x| < 26.46, 3 above. Odd; it
 * overflows to ±∞ past |x| = 26.71.
 */
export function erfi(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return x;
  const y = Math.abs(x);
  // erfi(y) ≈ e^{y²}/(y√π) is larger than the largest double (e^{709.78})
  // past y = 26.71. Past 27 the split of y² in `expSquareTimes()` would also
  // reach an infinite product, so the answer is given here.
  let r: number;
  if (y > 27) r = Infinity;
  else {
    const d = dawsonPositive(y);
    const p = ddMultiply(TWO_INV_SQRT_PI, TWO_INV_SQRT_PI_LO, d, lowPart[0]);
    r = expSquareTimes(1, y, p, lowPart[0]);
  }
  return x < 0 ? -r : r;
}
