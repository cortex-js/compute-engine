/**
 * Machine-precision kernels of the exponential integral Ei and of the sine,
 * cosine, hyperbolic sine and hyperbolic cosine integrals Si, Ci, Shi and
 * Chi, for a real argument.
 *
 * Methods, with a = |x|:
 * - a ≤ 2: the Maclaurin series (DLMF 6.6.5 and 6.6.6 for Si and Ci; the
 *   series of Shi and Chi have the same terms, all positive), with fixed
 *   coefficients. Ci and Chi contain γ + ln a. For Ci, and for Chi with
 *   0.3 < a < 0.65, ln a is more than twice the result (1.6 times at a = 2
 *   for Ci), so the error of `Math.log` would show: there the logarithm is
 *   a double-double (`logDD()`). Elsewhere in Chi it is `Math.log`, which
 *   is faster.
 * - a > 2, Si and Ci: the auxiliary functions f and g of DLMF 6.2.17–6.2.18,
 *   with Si(a) = π/2 − f(a)·cos a − g(a)·sin a and
 *   Ci(a) = f(a)·sin a − g(a)·cos a (DLMF 6.2.19–6.2.20).
 * - x ≥ 2, Ei: Ei(x) = e^x·S(x), with S(x) = e^{−x}·Ei(x).
 *   For 50 ≤ x ≤ 709 the computation uses plain doubles and `Math.exp`, for
 *   speed; elsewhere it is in double-double.
 * - a > 2, Shi and Chi: Shi(a) = (Ei(a) + E₁(a))/2 and
 *   Chi(a) = (Ei(a) − E₁(a))/2. E₁(a) is positive and less than Ei(a)/100,
 *   so the sum and the difference do not cancel, and the error of E₁ is
 *   divided by 100 or more in the result. E₁(a) is less than 10⁻²¹·Ei(a)
 *   past a = 25 and is not computed there.
 *
 * f, g and S are piecewise polynomials: Chebyshev interpolants of the
 * functions, computed with mpmath at 50 digits and written in powers of a
 * variable t in [−1, 1]. On 2 ≤ x < 16 (32 for S), each piece covers an
 * interval [2ᵏ, 2ᵏ⁺¹] and t is a linear function of x, exact in floating
 * point. Past 16 (32 for S) the variable is u = 1/x and the polynomials give
 * x·f(x), x²·g(x) and x·S(x). The approximation error of every polynomial
 * is below 2·10⁻¹⁸ relative. The two first coefficients of each polynomial
 * are double-doubles and the polynomial value is a double-double, so its
 * rounding error is a small fraction of a unit in the last place (ulp).
 * Past 16, g(x) is less than f(x)/16 and is a plain double, and so is f(x)
 * in Si, where f(x)·cos x is less than π/32.
 *
 * Below 50 and past 709, e^x is also computed in double-double
 * (`expSplit()`): `Math.exp` is up to 1.15 ulps from the correctly rounded
 * value, which shows directly in Ei, Shi and Chi from 50 to 709. The result
 * is scaled by a power of 2 only at the end, so Ei, Shi and Chi are finite
 * up to their overflow (x = 716.355 for Ei, 717.049 for Shi and Chi).
 *
 * The errors that remain are the final rounding (half an ulp) and, for Si
 * and Ci, the error of `Math.sin` and `Math.cos` (up to 0.8 ulp, measured).
 * Measured against mpmath at 40 digits on 6,400 points for Si and Ci in
 * [0.12, 10³⁰⁰] and 5,600 points for Shi, Chi and Ei in [0.12, 716] (a dense
 * grid and random points), and on 10,000 more random points for Chi below 2
 * and for Shi and Ei past 50, the largest error is:
 * - Si: 0.75 ulp;
 * - Ci: 1.5 ulps where |Ci(x)| is at least a quarter of its local amplitude
 *   √(f² + g²) (for x > 2), and 0.3 ulp of that amplitude next to a zero of
 *   Ci, where the relative error of any kernel is large;
 * - Shi, Chi and Ei: 0.97 ulp for 2 ≤ x < 50, and 2 ulps for x ≥ 50;
 * - Shi below 2: 0.65 ulp;
 * - Chi below 2: 1.6 ulps where |Chi(x)| ≥ 0.1, and an absolute error
 *   below 10⁻¹⁷ next to its zero at x = 0.5238.
 *
 * Ei for x < 2 uses its power series (x > 0) and the continued fraction of
 * E₁ (x < 0), which are a few ulps from the correctly rounded value.
 *
 * Reference: NIST Digital Library of Mathematical Functions (DLMF),
 * chapter 6, https://dlmf.nist.gov/6
 *
 * @module numerics/exponential-integrals
 */

/** The Euler–Mascheroni constant γ, and the part the double does not hold. */
const EULER_GAMMA = 0.5772156649015329;
const EULER_GAMMA_LO = -4.942915152430645e-18;
/** π/2, and the part the double does not hold. */
const HALF_PI = 1.5707963267948966;
const HALF_PI_LO = 6.123233995736766e-17;
/** 2⁹⁹⁶: past it, Dekker's product of a value and x overflows. */
const TWO_POW_996 = 6.696928794914171e299;

//
// Error-free transformations.
//
// A function that computes a double-double value returns its high part and
// writes its low part to `out[LOW]`. The extra results of a function are in
// a typed array, not in module variables or a returned object: a double
// written to a module variable is boxed on each write, which makes these
// kernels about three times slower, and a returned object is allocated.
//

/** 2^27 + 1: the factor that splits a double into two 26-bit halves. */
const SPLIT = 134217729;

/** The extra results of the functions of this module, by index. */
const out = new Float64Array(7);
/** The low part of the last double-double result. */
const LOW = 0;
/** The power of 2 of the last `expSplit()` result. */
const EXP_SHIFT = 1;
/** The power of 2 of the last `eiScaled()` result. */
const EI_SHIFT = 2;
/** f(x) and g(x) as double-doubles, set by `auxiliary()`. */
const AUX_F = 3;
const AUX_F_LO = 4;
const AUX_G = 5;
const AUX_G_LO = 6;

/** a + b: returns the rounded sum; its rounding error is in `out[LOW]`. */
function twoSum(a: number, b: number): number {
  const s = a + b;
  const t = s - a;
  out[LOW] = a - (s - t) + (b - t);
  return s;
}

/**
 * a·b: returns the rounded product; its rounding error is in `out[LOW]`
 * (Dekker's product, exact for |a|, |b| < 2⁹⁹⁶ when no part underflows).
 */
function twoProduct(a: number, b: number): number {
  const p = a * b;
  let t = SPLIT * a;
  const aHi = t - (t - a);
  const aLo = a - aHi;
  t = SPLIT * b;
  const bHi = t - (t - b);
  const bLo = b - bHi;
  out[LOW] = aHi * bHi - p + aHi * bLo + aLo * bHi + aLo * bLo;
  return p;
}

/**
 * (aHi + aLo)·(bHi + bLo) as a double-double: the high part is returned and
 * the low part is in `out[LOW]`.
 */
function ddMultiply(
  aHi: number,
  aLo: number,
  bHi: number,
  bLo: number
): number {
  const p = twoProduct(aHi, bHi);
  const e = out[LOW] + (aHi * bLo + aLo * bHi);
  const hi = p + e;
  out[LOW] = e - (hi - p);
  return hi;
}

/**
 * (nHi + nLo)/(dHi + dLo) as a double-double: the high part is returned and
 * the low part is in `out[LOW]`. Requires |dHi| < 2⁹⁹⁶.
 */
function ddDivide(nHi: number, nLo: number, dHi: number, dLo: number): number {
  const q = nHi / dHi;
  const p = twoProduct(q, dHi);
  const c = (nHi - p - out[LOW] + nLo - q * dLo) / dHi;
  const hi = q + c;
  out[LOW] = c - (hi - q);
  return hi;
}

//
// 2ᵏ is the product of two table entries: `2 ** k` with a variable k calls
// the general power function, which costs about as much as an exponential.
//
/** POW2_LOW[i] = 2^i for i = 0…63, POW2_HIGH[j] = 2^(64·(j − 16)) for
 *  j = 0…31. The products of powers of two are exact. */
const POW2_LOW = new Float64Array(64);
const POW2_HIGH = new Float64Array(32);
for (let i = 0; i < 64; i++) POW2_LOW[i] = i === 0 ? 1 : 2 * POW2_LOW[i - 1];
for (let j = 0; j < 32; j++) POW2_HIGH[j] = Math.pow(2, 64 * (j - 16));

/** 2ᵏ for an integer k in [−1022, 1023]. */
function powerOfTwo(k: number): number {
  return POW2_LOW[k & 63] * POW2_HIGH[(k >> 6) + 16];
}

/**
 * v·2ᵏ for an integer |k| ≤ 2000. Exact unless the result is outside the
 * normal range of a double; then it rounds once (or overflows). 2ᵏ is a
 * normal double only for −1022 ≤ k ≤ 1023, so a large scaling is two steps.
 */
function scaleByPowerOfTwo(v: number, k: number): number {
  if (k > 1000) return v * powerOfTwo(1000) * powerOfTwo(k - 1000);
  if (k < -1000) return v * powerOfTwo(-1000) * powerOfTwo(k + 1000);
  return v * powerOfTwo(k);
}

/** c[0] + c[1]·t + … + c[n]·tⁿ with plain Horner. */
function polynomial(c: readonly number[], t: number): number {
  let s = c[c.length - 1];
  for (let i = c.length - 2; i >= 0; i--) s = s * t + c[i];
  return s;
}

/**
 * A polynomial c[0] + c[1]·t + … + c[n]·tⁿ for t in [−1, 1]. `lo` holds the
 * parts of c[0] and c[1] that the doubles do not hold.
 */
interface Polynomial {
  readonly lo: readonly [number, number];
  readonly c: readonly number[];
}

/**
 * The value of `p` at t as a double-double: the high part is returned and
 * the low part is in `out[LOW]`.
 *
 * The terms of degree 2 and more are evaluated with plain Horner: they are
 * less than about a tenth of the value, so their rounding is small next to
 * an ulp of the value. The two first terms, c[0] + t·(c[1] + t·q), are
 * computed in double-double.
 */
function polynomialDD(p: Polynomial, t: number): number {
  const c = p.c;
  let q = c[c.length - 1];
  for (let i = c.length - 2; i >= 2; i--) q = q * t + c[i];
  const v = twoSum(c[1], t * q);
  const vLo = out[LOW] + p.lo[1];
  const w = twoProduct(t, v);
  const wLo = out[LOW] + t * vLo;
  const s = twoSum(c[0], w);
  out[LOW] = out[LOW] + wLo + p.lo[0];
  return s;
}

//
// The exponential and the logarithm in double-double.
//

/** ln(2)/4: the high part has 40 significant bits, so n·LN2_4 is exact for
 *  |n| < 2¹³. */
const LN2_4 = 0.17328679513980205;
const LN2_4_LO = 1.8427506412919497e-13;
const INV_LN2_4 = 5.7707801635558535;
/** 2^(j/4) for j = 0…3, and the parts the doubles do not hold. */
const POW2_4 = [1, 1.189207115002721, 1.4142135623730951, 1.681792830507429];
const POW2_4_LO = [
  0, 3.982015231465646e-17, -9.667293313452913e-17, 8.199010020581497e-17,
];
/** 1/k! for k = 2…11. */
const EXP_TAYLOR = [
  0.5, 0.16666666666666666, 0.041666666666666664, 0.008333333333333333,
  0.001388888888888889, 0.0001984126984126984, 2.48015873015873e-5,
  2.7557319223985893e-6, 2.755731922398589e-7, 2.505210838544172e-8,
];

/**
 * e^x = 2ᵏ·(hi + lo) for |x| ≤ 745, with a relative error below 10⁻¹⁹.
 * Returns hi; lo is in out[LOW] and k in out[EXP_SHIFT].
 *
 * With n = round(4x/ln 2), x = n·ln(2)/4 + r and |r| ≤ 0.0867. The high part
 * of r, x − n·LN2_4, is exact (the two terms are within a factor 2 of each
 * other). e^r = 1 + r + r²·P(r), with P the Taylor polynomial to the term in
 * r⁹ (the first term left out, r¹²/12!, is below 4·10⁻²²), and
 * e^x = 2^{(n − j)/4}·2^{j/4}·e^r with j = n mod 4.
 */
function expSplit(x: number): number {
  const n = Math.round(x * INV_LN2_4);
  const rHi = x - n * LN2_4;
  const rLo = -n * LN2_4_LO;
  const r = rHi + rLo;
  const s = twoSum(rHi, rLo + r * r * polynomial(EXP_TAYLOR, r));
  const sLo = out[LOW];
  // 1 + s as a double-double (|s| < 1, so the fast two-sum is exact)
  const m = 1 + s;
  const mLo = s - (m - 1) + sLo;
  const j = n & 3;
  out[EXP_SHIFT] = (n - j) / 4;
  return ddMultiply(POW2_4[j], POW2_4_LO[j], m, mLo);
}

/**
 * ln x for x > 0 (finite) as a double-double: the high part is returned and
 * the low part is in `out[LOW]`.
 *
 * y = Math.log(x) is corrected with one Newton step:
 * ln x = y + ln(x·e^{−y}) ≈ y + (x − e^y)/e^y, where e^y is the
 * double-double of `expSplit()` and x − e^y is exact. The error of y is
 * about 10⁻¹⁶ relative, so the term left out, of order 10⁻³², is negligible.
 */
function logDD(x: number): number {
  const y = Math.log(x);
  const m = expSplit(y);
  const mLo = out[LOW];
  const xs = scaleByPowerOfTwo(x, -out[EXP_SHIFT]);
  out[LOW] = (xs - m - mLo) / m;
  return y;
}

//
// a ≤ 2: the Maclaurin series.
//

/** (−1)^k/((2k + 1)·(2k + 1)!) for k = 1…12: the series of Si. */
const SI_SERIES = [
  -0.05555555555555555, 0.0016666666666666668, -2.834467120181406e-5,
  3.0619243582206544e-7, -2.27746439867652e-9, 1.2353110643708935e-11,
  -5.0981091545465446e-14, 1.6537983849091297e-16, -4.326650129802279e-19,
  9.32044812542441e-22, -1.6818131176655147e-24, 2.5787801137537893e-27,
];
/** 1/((2k + 1)·(2k + 1)!) for k = 1…12: the series of Shi. */
const SHI_SERIES = [
  0.05555555555555555, 0.0016666666666666668, 2.834467120181406e-5,
  3.0619243582206544e-7, 2.27746439867652e-9, 1.2353110643708935e-11,
  5.0981091545465446e-14, 1.6537983849091297e-16, 4.326650129802279e-19,
  9.32044812542441e-22, 1.6818131176655147e-24, 2.5787801137537893e-27,
];
/** (−1)^k/(2k·(2k)!) for k = 2…13: the series of Ci after its x² term. */
const CI_SERIES = [
  0.010416666666666666, -0.0002314814814814815, 3.1001984126984127e-6,
  -2.755731922398589e-8, 1.7397297489890083e-10, -8.193389712664089e-13,
  2.9871733327421158e-15, -8.677337204770125e-18, 2.0551588116560825e-20,
  -4.0439960874775335e-23, 6.715573212900493e-26, -9.53690870471076e-29,
];
/** 1/(2k·(2k)!) for k = 2…13: the series of Chi after its x² term. */
const CHI_SERIES = [
  0.010416666666666666, 0.0002314814814814815, 3.1001984126984127e-6,
  2.755731922398589e-8, 1.7397297489890083e-10, 8.193389712664089e-13,
  2.9871733327421158e-15, 8.677337204770125e-18, 2.0551588116560825e-20,
  4.0439960874775335e-23, 6.715573212900493e-26, 9.53690870471076e-29,
];

/**
 * Si(x) (with SI_SERIES) or Shi(x) (with SHI_SERIES) for 0 < |x| ≤ 2:
 * x + x·v with v = x²·(c₁ + c₂x² + …). |x·v| is at most a quarter of the
 * result, so the error of v is reduced in the result; x·v and the sum are
 * computed in double-double.
 */
function oddSeries(series: readonly number[], x: number): number {
  const z = twoProduct(x, x);
  const w = polynomial(series, z);
  const v = z * w + out[LOW] * w;
  const p = twoProduct(x, v);
  const pLo = out[LOW];
  const s = twoSum(x, p);
  return s + (out[LOW] + pLo);
}

/**
 * Ci(a) (sign −1, with CI_SERIES) or Chi(a) (sign 1, with CHI_SERIES) for
 * 0 < a ≤ 2: γ + ln a ± a²/4 + a⁴·(c₂ + c₃a² + …). The four terms are
 * added in double-double. Next to a zero of the function they cancel, and
 * the result has a small absolute error, not a small relative error.
 *
 * ln a is a double-double for Ci, and for Chi with 0.3 < a < 0.65, where
 * |ln a| is more than twice |Chi(a)|. Elsewhere Chi uses `Math.log`, which
 * is faster and adds at most about 1 ulp.
 */
function evenSeries(series: readonly number[], sign: 1 | -1, a: number) {
  const z = twoProduct(a, a);
  const zLo = out[LOW];
  const tail = z * z * polynomial(series, z);
  let l: number;
  let lLo = 0;
  if (sign < 0 || (a > 0.3 && a < 0.65)) {
    l = logDD(a);
    lLo = out[LOW];
  } else l = Math.log(a);
  let s = twoSum(EULER_GAMMA, l);
  let lo = out[LOW] + EULER_GAMMA_LO + lLo;
  s = twoSum(s, sign * 0.25 * z);
  lo += out[LOW] + sign * 0.25 * zLo;
  s = twoSum(s, tail);
  return s + (out[LOW] + lo);
}

//
// a > 2: the auxiliary functions f and g of Si and Ci.
//
// AUX_F_POLYNOMIALS[k] and AUX_G_POLYNOMIALS[k], k = 0, 1, 2: f(x) and g(x)
// for 2^{k+1} ≤ x < 2^{k+2}, with t = (x − 3·2ᵏ)/2ᵏ. AUX_F_POLYNOMIALS[3]
// and AUX_G_POLYNOMIALS[3]: x·f(x) and x²·g(x) for x ≥ 16, with
// t = 32/x − 1.
//

const AUX_F_POLYNOMIALS: readonly Polynomial[] = [
  {
    lo: [8.328713194046464e-18, -4.599079160889352e-18],
    c: [
      0.29195771069207876, -0.07922152116436404, 0.02068781132062724,
      -0.0053149316577911655, 0.0013624354763690691, -0.0003515373677282116,
      9.175969534466715e-5, -2.4290589153273743e-5, 6.526565829673051e-6,
      -1.7795167423069912e-6, 4.9198462170666e-7, -1.3777764096572727e-7,
      3.904082367468134e-8, -1.1179636566424552e-8, 3.227001712562122e-9,
      -9.408954150056814e-10, 2.825160805085939e-10, -8.365552239860822e-11,
      2.0418572987553697e-11, -6.089506720021505e-12, 3.724243099522127e-12,
      -1.131455243281158e-12,
    ],
  },
  {
    lo: [-9.85012404061319e-19, 1.948029792822052e-18],
    c: [
      0.15930555357626336, -0.04904297415204928, 0.014722226180806543,
      -0.004341720935670829, 0.001265430779240294, -0.0003662237141013187,
      0.00010562431855173506, -3.0442603999113302e-5, 8.78566942834039e-6,
      -2.542516287464654e-6, 7.385299609771881e-7, -2.1545502688914884e-7,
      6.315592042221108e-8, -1.8601069601892415e-8, 5.495622863923975e-9,
      -1.6341364369455187e-9, 4.995604871262982e-10, -1.4998302443563611e-10,
      3.67267192406365e-11, -1.107430001008885e-11, 6.928053741697854e-12,
      -2.1189300969640515e-12,
    ],
  },
  {
    lo: [2.6051698502755104e-18, -1.1857340904880379e-18],
    c: [
      0.0822573623396378, -0.026748391178924278, 0.00860776794956421,
      -0.002745030930275837, 0.0008686550795933482, -0.000273111058252593,
      8.541413587799299e-5, -2.6599797995746404e-5, 8.25648764987658e-6,
      -2.5564780085911962e-6, 7.901917836751668e-7, -2.439687175235904e-7,
      7.528025841344408e-8, -2.32290505449401e-8, 7.168190333363102e-9,
      -2.2069185544364405e-9, 6.818777884030447e-10, -2.178611694205505e-10,
      6.747333218782975e-11, -1.6025567198332202e-11, 4.965135851670228e-12,
      -3.4992366836337837e-12, 1.091051772126028e-12,
    ],
  },
  {
    lo: [-3.4767830557821306e-17, 1.9913704816864838e-19],
    c: [
      0.9980691264342498, -0.0038184552809927544, -0.0018249502081602387,
      7.987987734063907e-5, 1.4873092442572665e-5, -2.5522028342540364e-6,
      -7.511026793736931e-8, 9.204065138595933e-8, -1.293940535341661e-8,
      -1.8439740392789868e-9, 1.1872497400779588e-9, -1.972656249909475e-10,
      -3.0700863276916936e-11, 2.7120006878500345e-11, -6.78736792737046e-12,
      -3.762912134776531e-13, 8.462287602822915e-13, -2.0249136040472284e-13,
    ],
  },
];

const AUX_G_POLYNOMIALS: readonly Polynomial[] = [
  {
    lo: [4.515801474202268e-18, -3.3901225357198124e-18],
    c: [
      0.07922152116436404, -0.04137562264125456, 0.015944794973373543,
      -0.005449741905469922, 0.0017576868386381748, -0.0005505581722160713,
      0.00017003412413423686, -5.2212525068154965e-5, 1.601565005896817e-5,
      -4.919855284420248e-6, 1.5155575667019821e-6, -4.684586674434675e-7,
      1.4532325483252892e-7, -4.5244653981677044e-8, 1.4139241979735833e-8,
      -4.431878135422437e-9, 1.3871379140926802e-9, -4.3732641847267154e-10,
      1.4479311955556058e-10, -4.5908185183989227e-11, 1.0242234651562306e-11,
      -3.2498658613824327e-12, 2.688836214840112e-12, -8.606757743011235e-13,
    ],
  },
  {
    lo: [-1.0531385822165968e-18, -2.6694653155687326e-19],
    c: [
      0.02452148707602464, -0.014722226180806618, 0.006512581403506287,
      -0.0025308615584746035, 0.0009155592852505631, -0.00031687295579465317,
      0.00010654911405501765, -3.514267623559251e-5, 1.1441322704307625e-5,
      -3.692658342896582e-6, 1.1850059798916695e-6, -3.7890613267727833e-7,
      1.2089556171971423e-7, -3.853207651292501e-8, 1.228048084872016e-8,
      -3.913326980610005e-9, 1.241685758849335e-9, -3.9616241608069876e-10,
      1.327720161217345e-10, -4.2457937762057064e-11, 9.439835296975948e-12,
      -3.0181767785304143e-12, 2.5477109460392484e-12, -8.190897513968215e-13,
    ],
  },
  {
    lo: [-1.7059436435910483e-19, -1.6467524919069467e-19],
    c: [
      0.0066870977947310695, -0.0043038839747821045, 0.002058773197707001,
      -0.0008686550795934112, 0.0003413888228104223, -0.00012812120381463444,
      4.654964658146914e-5, -1.6512975336659443e-5, 5.752074762831668e-6,
      -1.97547915529482e-6, 6.709176990045867e-7, -2.2584224923284152e-7,
      7.548307422190058e-8, -2.5084191512803553e-8, 8.297864274564776e-9,
      -2.736246355935513e-9, 8.991477409566012e-10, -2.926754527949875e-10,
      9.577255819421081e-11, -3.3350583645522244e-11, 1.0883029185677828e-11,
      -2.2553909589414463e-12, 7.353209712044884e-13, -7.097735703431597e-13,
      2.3109027769997153e-13,
    ],
  },
  {
    lo: [-5.568522029662261e-18, -1.718558214319778e-19],
    c: [
      0.994250671153257, -0.011286810978306033, -0.005235210992458834,
      0.000379011879135476, 6.160444804192224e-5, -1.5763878656654e-5,
      1.1851268658983625e-7, 6.32810299726205e-7, -1.3305045518216013e-7,
      -6.568626208407771e-9, 1.0890019463790071e-8, -2.732174428092643e-9,
      -4.700529675917691e-11, 2.794932556982168e-10, -1.0688693376980085e-10,
      1.218082140102413e-11, 1.057920764959565e-11, -5.96061792401958e-12,
      9.425828579740963e-14, 4.868991796150036e-13,
    ],
  },
];

/**
 * Sets out[AUX_F] + out[AUX_F_LO] to f(x) and out[AUX_G] + out[AUX_G_LO] to
 * g(x), for 2 ≤ x < 2⁹⁹⁶. With `fullF` false, f(x) is a plain double past
 * 16.
 */
function auxiliary(x: number, fullF: boolean): void {
  if (x < 16) {
    let k: number;
    let t: number;
    if (x < 4) {
      k = 0;
      t = x - 3;
    } else if (x < 8) {
      k = 1;
      t = (x - 6) / 2;
    } else {
      k = 2;
      t = (x - 12) / 4;
    }
    out[AUX_F] = polynomialDD(AUX_F_POLYNOMIALS[k], t);
    out[AUX_F_LO] = out[LOW];
    out[AUX_G] = polynomialDD(AUX_G_POLYNOMIALS[k], t);
    out[AUX_G_LO] = out[LOW];
    return;
  }
  // Past 16, g(x) < f(x)/16 and f(x) < 1/16: the rounding of g in Si and
  // Ci, and of f in Si, is a small fraction of an ulp of the result, and
  // they are computed with plain doubles.
  const t = 32 / x - 1;
  out[AUX_G] = polynomial(AUX_G_POLYNOMIALS[3].c, t) / x / x;
  out[AUX_G_LO] = 0;
  if (!fullF) {
    out[AUX_F] = polynomial(AUX_F_POLYNOMIALS[3].c, t) / x;
    out[AUX_F_LO] = 0;
    return;
  }
  const xf = polynomialDD(AUX_F_POLYNOMIALS[3], t);
  out[AUX_F] = ddDivide(xf, out[LOW], x, 0);
  out[AUX_F_LO] = out[LOW];
}

/**
 * Sine integral Si(x) = ∫₀ˣ sin t / t dt. Odd, Si(±∞) = ±π/2. At most 1 ulp
 * from the correctly rounded value (see the module comment).
 */
export function sinIntegral(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return x;
  const a = Math.abs(x);
  if (a <= 2) return oddSeries(SI_SERIES, x);
  let r: number;
  // Past 2⁹⁹⁶, |f·cos a + g·sin a| < 1/a is less than 10⁻²⁹⁹ and π/2 is the
  // rounded value.
  if (a >= TWO_POW_996) r = HALF_PI;
  else {
    auxiliary(a, false);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const p = twoProduct(out[AUX_F], c);
    const pLo = out[LOW] + out[AUX_F_LO] * c;
    const q = twoProduct(out[AUX_G], s);
    const qLo = out[LOW] + out[AUX_G_LO] * s;
    const sum = twoSum(p, q);
    const sumLo = out[LOW] + pLo + qLo;
    const d = twoSum(HALF_PI, -sum);
    r = d + (out[LOW] + HALF_PI_LO - sumLo);
  }
  return x < 0 ? -r : r;
}

/**
 * Cosine integral Ci(x) = γ + ln x + ∫₀ˣ (cos t − 1)/t dt, Ci(0) = −∞,
 * Ci(∞) = 0. For x < 0 the function is complex (Ci(−a) = Ci(a) + iπ); this
 * returns the real part, Ci(|x|). Away from the zeros of Ci, at most
 * 1.5 ulps from the correctly rounded value (see the module comment).
 */
export function cosIntegral(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const a = Math.abs(x);
  if (a === 0) return -Infinity;
  if (a <= 2) return evenSeries(CI_SERIES, -1, a);
  if (a === Infinity) return 0;
  // Past 2⁹⁹⁶, f(a) is 1/a and g(a)/f(a) < 10⁻²⁹⁹.
  if (a >= TWO_POW_996) return Math.sin(a) / a;
  auxiliary(a, true);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const p = twoProduct(out[AUX_F], s);
  const pLo = out[LOW] + out[AUX_F_LO] * s;
  const q = twoProduct(out[AUX_G], c);
  const qLo = out[LOW] + out[AUX_G_LO] * c;
  const d = twoSum(p, -q);
  return d + (out[LOW] + pLo - qLo);
}

//
// x ≥ 2: Ei(x) = e^x·S(x).
//
// EI_SCALED[k], k = 0…3: S(x) = e^{−x}·Ei(x) for 2^{k+1} ≤ x < 2^{k+2}, with
// t = (x − 3·2ᵏ)/2ᵏ. EI_SCALED[4]: x·S(x) for x ≥ 32, with t = 64/x − 1.
//

const EI_SCALED: readonly Polynomial[] = [
  {
    lo: [9.198520328455743e-18, -1.3073373289139075e-17],
    c: [
      0.4945764013486412, -0.16124306801530788, 0.025065978452098393,
      0.003990352861645742, -0.0040840079684978225, 0.0016398468612015612,
      -0.0005019314956159244, 0.00013702555220213199, -3.618016778148875e-5,
      9.665048886403958e-6, -2.660013880855047e-6, 7.549999845917102e-7,
      -2.1972211624855174e-7, 6.51599974903551e-8, -1.959071281937554e-8,
      5.934998922970028e-9, -1.8185177779506082e-9, 5.811585441593576e-10,
      -1.805050491263656e-10, 4.224216664606253e-11, -1.317450820723751e-11,
      9.76404930545579e-12, -3.0901455749123374e-12,
    ],
  },
  {
    lo: [3.669350547549724e-18, 3.639318835808857e-18],
    c: [
      0.2131473100815936, -0.09296128682985387, 0.03740573127429832,
      -0.012591475170520424, 0.003209317832173689, -0.0004606818653652154,
      -7.506306362514044e-5, 8.67676424082928e-5, -4.074388437529083e-5,
      1.4699226954886736e-5, -4.633354303692348e-6, 1.355607847435378e-6,
      -3.827403238573852e-7, 1.071433885190667e-7, -3.024219190504799e-8,
      8.657862701064793e-9, -2.5303345214572298e-9, 7.756635496728378e-10,
      -2.34014284306261e-10, 5.470788410880659e-11, -1.6697201743015067e-11,
      1.179638740827087e-11, -3.688867679519359e-12,
    ],
  },
  {
    lo: [5.92660726156912e-18, 1.9985640304200732e-18],
    c: [
      0.09191454540889658, -0.034324848302253026, 0.013094141048950472,
      -0.005113175719588305, 0.0020267559665028646, -0.0007983595057120973,
      0.00030361598504262383, -0.00010817379562525056, 3.503492420463102e-5,
      -9.926048130412739e-6, 2.2769094684151785e-6, -3.1478265890891566e-7,
      -5.187520890101969e-8, 6.420972919232481e-8, -3.3288096602318185e-8,
      1.3523246334513003e-8, -4.819338636094315e-9, 1.5885891991538051e-9,
      -5.102355382649802e-10, 1.5390845494717488e-10, -3.61604579085564e-11,
      1.0516846724350152e-11, -6.625418759064172e-12, 1.9770166400232402e-12,
    ],
  },
  {
    lo: [1.798054742134815e-18, -7.082221063296175e-19],
    c: [
      0.043569408838540574, -0.015221937374991274, 0.005332193944409528,
      -0.001873504839413093, 0.0006605899257404674, -0.0002338986136942823,
      8.324113283204679e-5, -2.9811670269391127e-5, 1.0759696612739523e-5,
      -3.919145450735831e-6, 1.4418068504697244e-6, -5.354024715251504e-7,
      2.0013124261756565e-7, -7.490931922145723e-8, 2.7865161786360523e-8,
      -1.0215417525676879e-8, 3.6655770307421935e-9, -1.269879058356172e-9,
      4.109152225012455e-10, -1.2685936908777279e-10, 4.29023239408387e-11,
      -1.2580645672863672e-11, 7.935017825218838e-13, 5.25344893819654e-13,
    ],
  },
  {
    lo: [-8.551278791140563e-17, -1.2055679227317844e-18],
    c: [
      1.0161377234943254, 0.01667658014249527, 0.0005668325989430853,
      2.998768421527738e-5, 2.2000508588235373e-6, 2.1041210459308884e-7,
      2.526455253612522e-8, 3.716860589988584e-9, 6.59253810357495e-10,
      1.3977665738590096e-10, 3.570732171299298e-11, 1.038585033176976e-11,
      2.7686810726821306e-12, 1.8524228127431005e-12, 2.2357686948990566e-12,
      7.218660312302156e-13, -5.248231506115083e-13, -2.9200061867476107e-13,
    ],
  },
];

/**
 * x·S(x) for x ≥ 50, with t = 100/x − 1, in powers of t (a Chebyshev
 * interpolant with an approximation error below 3·10⁻¹⁸ relative, computed
 * like EI_SCALED), and the part of c[0] that the double does not hold.
 */
const EI_LARGE = [
  1.0102062527748357, 0.010419024708735411, 0.00021957198624975512,
  7.096425414240018e-6, 3.1290119162102733e-7, 1.7661385400238597e-8,
  1.2262339066705218e-9, 1.0192074937607376e-10, 9.932188425832395e-12,
  1.1204473313441142e-12, 1.565007736783102e-13, 2.3434580020859675e-14,
];
const EI_LARGE_LO = 4.2447218222574187e-17;

/**
 * Ei(x)·2⁻ᵏ for 2 ≤ x ≤ 720 as a double-double, with k in out[EI_SHIFT]:
 * the high part is returned and the low part is in `out[LOW]`.
 */
function eiScaled(x: number): number {
  if (x >= 50 && x <= 709) {
    // For speed, this band uses plain doubles and `Math.exp` (up to 1.15
    // ulps from the correctly rounded value): the double-double evaluation
    // is about three times slower here. Past 709, e^x overflows.
    // x·S(x) = c[0] + t·q(t) with |t·q(t)| < 0.011·c[0]: only the last sum
    // is exact.
    const c = EI_LARGE;
    const t = 100 / x - 1;
    let q = c[c.length - 1];
    for (let i = c.length - 2; i >= 1; i--) q = q * t + c[i];
    const r = twoSum(c[0], t * q);
    const y = Math.exp(x) / x;
    out[EI_SHIFT] = 0;
    out[LOW] = y * (out[LOW] + EI_LARGE_LO);
    return y * r;
  }
  const e = expSplit(x);
  const eLo = out[LOW];
  out[EI_SHIFT] = out[EXP_SHIFT];
  if (x < 32) {
    let k: number;
    let t: number;
    if (x < 4) {
      k = 0;
      t = x - 3;
    } else if (x < 8) {
      k = 1;
      t = (x - 6) / 2;
    } else if (x < 16) {
      k = 2;
      t = (x - 12) / 4;
    } else {
      k = 3;
      t = (x - 24) / 8;
    }
    const s = polynomialDD(EI_SCALED[k], t);
    return ddMultiply(e, eLo, s, out[LOW]);
  }
  const xs = polynomialDD(EI_SCALED[4], 64 / x - 1);
  const s = ddDivide(xs, out[LOW], x, 0);
  return ddMultiply(e, eLo, s, out[LOW]);
}

/**
 * Exponential integral E₁(x) = ∫ₓ^∞ e^{−t}/t dt for x > 0 (Numerical
 * Recipes §6.3 `expint`, specialised to n = 1): the power series for x ≤ 1,
 * Lentz's continued fraction for x > 1. A few ulps from the correctly
 * rounded value.
 */
function expInt1(x: number): number {
  const EPS = 1e-16;
  const MAXIT = 200;
  if (x <= 0) return NaN;
  if (x <= 1) {
    // E₁(x) = −γ − ln x − Σ_{n≥1} (−x)ⁿ/(n·n!)
    let sum = -Math.log(x) - EULER_GAMMA;
    let fact = 1;
    for (let n = 1; n <= MAXIT; n++) {
      fact *= -x / n;
      const del = -fact / n;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * EPS) break;
    }
    return sum;
  }
  // Lentz continued fraction: E₁(x) = e^{−x}·(1/(x+1−) 1²/(x+3−) 2²/(x+5−) …)
  const BIG = 1e30;
  let b = x + 1;
  let c = BIG;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= MAXIT; i++) {
    const a = -i * i;
    b += 2;
    d = 1 / (a * d + b);
    c = b + a / c;
    const del = c * d;
    h *= del;
    if (Math.abs(del - 1) <= EPS) break;
  }
  return h * Math.exp(-x);
}

/**
 * Exponential integral Ei(x) = PV ∫_{−∞}^x e^t/t dt, for real x ≠ 0.
 *   Ei(0) = −∞, Ei(+∞) = +∞, Ei(−∞) = 0.
 * For x ≥ 2: e^x·S(x) (see the module comment), at most 1 ulp from the
 * correctly rounded value below 50 and 2 ulps above, and finite up to
 * x = 716.355. For 0 < x < 2: the
 * power series Ei(x) = γ + ln x + Σ_{n≥1} xⁿ/(n·n!) (DLMF 6.6.1). For x < 0:
 * Ei(x) = −E₁(−x).
 */
export function expIntegralEi(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return -Infinity;
  if (!Number.isFinite(x)) return x > 0 ? Infinity : 0;
  if (x < 0) return -expInt1(-x);
  if (x >= 2) {
    if (x > 720) return Infinity;
    const v = eiScaled(x);
    return scaleByPowerOfTwo(v + out[LOW], out[EI_SHIFT]);
  }
  // Power series (all terms positive for x > 0 — no cancellation).
  const EPS = 1e-16;
  let sum = 0;
  let fact = 1;
  for (let k = 1; k <= 200; k++) {
    fact *= x / k;
    const term = fact / k;
    sum += term;
    if (term < EPS * sum) break;
  }
  return sum + Math.log(x) + EULER_GAMMA;
}

/**
 * Hyperbolic sine integral Shi(x) = ∫₀ˣ sinh(t)/t dt. Odd and entire, so it
 * is real for every real x. At most 1 ulp from the correctly rounded value
 * for |x| < 50 and 2 ulps above (see the module comment); it overflows to
 * ±∞ past |x| = 717.049.
 */
export function sinhIntegral(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return x;
  const a = Math.abs(x);
  if (a <= 2) return oddSeries(SHI_SERIES, x);
  let r: number;
  if (a > 720) r = Infinity;
  else {
    const v = eiScaled(a);
    let lo = out[LOW];
    if (a < 25) lo += scaleByPowerOfTwo(expInt1(a), -out[EI_SHIFT]);
    r = scaleByPowerOfTwo(v + lo, out[EI_SHIFT] - 1);
  }
  return x < 0 ? -r : r;
}

/**
 * Hyperbolic cosine integral Chi(x) = γ + ln|x| + ∫₀ˣ (cosh t − 1)/t dt.
 * For real x < 0 the function is complex (Chi(−a) = Chi(a) + iπ); like the
 * cosine-integral kernel, this returns the real part Chi(|x|). At most
 * 2 ulps from the correctly rounded value away from its zero at 0.5238 (see
 * the module comment); it overflows to +∞ past |x| = 717.049.
 */
export function coshIntegral(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const a = Math.abs(x);
  if (a === 0) return -Infinity;
  if (a <= 2) return evenSeries(CHI_SERIES, 1, a);
  if (a > 720) return Infinity;
  const v = eiScaled(a);
  let lo = out[LOW];
  if (a < 25) lo -= scaleByPowerOfTwo(expInt1(a), -out[EI_SHIFT]);
  return scaleByPowerOfTwo(v + lo, out[EI_SHIFT] - 1);
}
