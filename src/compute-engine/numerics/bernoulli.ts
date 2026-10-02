/**
 * Exact Bernoulli numbers and exact values of the Riemann zeta function at
 * integers, computed with bigint rationals.
 *
 * Used by the exact (non-numericApproximation) evaluation path of `Zeta`
 * in `library/arithmetic.ts`:
 *
 * - ζ(2k)  = (−1)^{k+1} · B₂ₖ · (2π)^{2k} / (2·(2k)!)  →  rational · π^{2k}
 * - ζ(−n)  = −Bₙ₊₁/(n+1)                               →  exact rational
 *
 * (The numeric approximation path uses the BigDecimal Bernoulli rationals in
 * `numerics/special-functions.ts`; this module is self-contained so that the
 * exact path has no dependency on the BigDecimal machinery.)
 */

function gcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function reduce(num: bigint, den: bigint): [bigint, bigint] {
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return g === 0n ? [0n, 1n] : [num / g, den / g];
}

function factorial(n: number): bigint {
  let f = 1n;
  for (let i = 2; i <= n; i++) f *= BigInt(i);
  return f;
}

// Memoized Bernoulli numbers B_0, B_1, B_2, … as reduced [num, den]
// rationals (B_1 = −1/2 convention). Grown on demand.
const BERNOULLI: [bigint, bigint][] = [
  [1n, 1n], // B_0 = 1
  [-1n, 2n], // B_1 = −1/2
];

/**
 * Bernoulli number Bₙ (B₁ = −1/2 convention) as a reduced bigint rational
 * `[numerator, denominator]`.
 *
 * Uses the defining recurrence Bₘ = −1/(m+1) · Σ_{k=0}^{m−1} C(m+1, k)·Bₖ
 * with exact bigint rational arithmetic. Suitable for moderate n (the Zeta
 * exact path caps |argument| at 100, i.e. at most B₁₀₁).
 */
export function bernoulliRational(n: number): [bigint, bigint] {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(`bernoulliRational: invalid index ${n}`);

  for (let m = BERNOULLI.length; m <= n; m++) {
    // Odd m > 1: B_m = 0
    if (m % 2 === 1) {
      BERNOULLI.push([0n, 1n]);
      continue;
    }

    // B_m = -1/(m+1) * sum_{k=0}^{m-1} C(m+1, k) * B_k
    const mp1 = BigInt(m + 1);
    let sumNum = 0n;
    let sumDen = 1n;
    let binom = 1n; // C(m+1, 0) = 1
    for (let k = 0; k < m; k++) {
      if (k > 0) binom = (binom * (mp1 - BigInt(k) + 1n)) / BigInt(k);
      const [bkNum, bkDen] = BERNOULLI[k];
      if (bkNum === 0n) continue;
      sumNum = sumNum * bkDen + binom * bkNum * sumDen;
      sumDen = sumDen * bkDen;
    }
    BERNOULLI.push(reduce(-sumNum, mp1 * sumDen));
  }

  return BERNOULLI[n];
}

/**
 * Bernoulli polynomial Bₙ(x) = Σ_{k=0}^n C(n,k)·Bₖ·x^{n−k}, for a rational
 * point x = xNum/xDen. Used for the exact closed form
 * ζ(−n,a) = −Bₙ₊₁(a)/(n+1) at a rational base point a (`library/arithmetic.ts`).
 *
 * With D·Bₙ(x) = Σ eⱼ xʲ (`bernoulliPolynomialInteger`), the value is
 * Σ eⱼ xNumʲ xDen^(n−j) / (D·xDenⁿ): the sum is an integer, computed by
 * Horner's rule in xNum with no gcd reduction, and the fraction is reduced
 * once at the end. A gcd reduction after every term instead costs 0.5 s at
 * n = 101, x = 10⁻³⁰ and 10 s at x = 10⁻¹⁰⁰, because the numbers grow with
 * n and with the digits of x.
 */
export function bernoulliPolynomialRational(
  n: number,
  x: [bigint, bigint]
): [bigint, bigint] {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(`bernoulliPolynomialRational: invalid degree ${n}`);
  const [xNum, xDen] = x[1] < 0n ? [-x[0], -x[1]] : x;
  const { e, d } = bernoulliPolynomialInteger(n);
  let acc = e[n];
  let denPower = 1n; // xDen^(n−j)
  for (let j = n - 1; j >= 0; j--) {
    denPower *= xDen;
    acc = acc * xNum + e[j] * denPower;
  }
  return reduce(acc, d * denPower);
}

/**
 * Coefficients of the Bernoulli polynomial Bₙ(x) = Σ_{k=0}^n C(n,k)·Bₖ·x^{n−k},
 * as exact reduced rationals ordered from the x^n term to the x^0 term
 * (Horner order, index k holds the coefficient of x^{n−k}).
 *
 * `bernoulliPolynomialRational` evaluates Bₙ(x) directly at a rational point
 * x; this returns the coefficients themselves, for building Bₙ(a) as a
 * compute-engine expression in `a` when `a` is not a rational point — a
 * symbolic, float, or complex base point
 * (`library/arithmetic.ts`'s `hurwitzZetaNegativeIntegerExpression`).
 */
export function bernoulliPolynomialCoefficients(n: number): [bigint, bigint][] {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(
      `bernoulliPolynomialCoefficients: invalid degree ${n}`
    );
  const coefficients: [bigint, bigint][] = [];
  let binom = 1n; // C(n, k), starts at k = 0 → C(n, 0) = 1
  for (let k = 0; k <= n; k++) {
    const [bNum, bDen] = bernoulliRational(k);
    coefficients.push(reduce(binom * bNum, bDen));
    // C(n, k+1) = C(n, k) · (n−k)/(k+1)
    if (k < n) binom = (binom * BigInt(n - k)) / BigInt(k + 1);
  }
  return coefficients;
}

/**
 * The exact rational c such that ζ(2k) = c·π^{2k}, for integer k ≥ 1.
 *
 * From ζ(2k) = (−1)^{k+1}·B₂ₖ·(2π)^{2k} / (2·(2k)!) and the sign alternation
 * of B₂ₖ, the coefficient is |B₂ₖ|·2^{2k−1}/(2k)! (always positive).
 *
 * ζ(2) = π²/6, ζ(4) = π⁴/90, ζ(6) = π⁶/945, ζ(8) = π⁸/9450, …
 */
export function zetaEvenCoefficient(k: number): [bigint, bigint] {
  if (!Number.isInteger(k) || k < 1)
    throw new RangeError(`zetaEvenCoefficient: invalid index ${k}`);
  const [bernoulliNumerator, den] = bernoulliRational(2 * k);
  const num =
    bernoulliNumerator < 0n ? -bernoulliNumerator : bernoulliNumerator;
  return reduce(num * 2n ** BigInt(2 * k - 1), den * factorial(2 * k));
}

/** Euler numbers E₀, E₂, E₄, … (E₂ₖ at index k), exact: Σⱼ C(2k, 2j) E₂ⱼ = 0. */
const EULER_EVEN_CACHE: bigint[] = [1n];
export function eulerEvenNumber(k: number): bigint {
  for (let m = EULER_EVEN_CACHE.length; m <= k; m++) {
    let sum = 0n;
    let binomial = 1n; // C(2m, 2j), stepped j → j + 1
    for (let j = 0; j < m; j++) {
      sum += binomial * EULER_EVEN_CACHE[j];
      binomial =
        (binomial * BigInt((2 * m - 2 * j) * (2 * m - 2 * j - 1))) /
        BigInt((2 * j + 1) * (2 * j + 2));
    }
    EULER_EVEN_CACHE[m] = -sum;
  }
  return EULER_EVEN_CACHE[k];
}

/**
 * ζ(−n) for integer n ≥ 1 as an exact reduced rational: ζ(−n) = −Bₙ₊₁/(n+1).
 *
 * ζ(−1) = −1/12, ζ(−3) = 1/120, and ζ(−2k) = 0 (the trivial zeros, since
 * the odd Bernoulli numbers B₃, B₅, … vanish).
 */
export function zetaNegativeInteger(n: number): [bigint, bigint] {
  if (!Number.isInteger(n) || n < 1)
    throw new RangeError(`zetaNegativeInteger: invalid index ${n}`);
  const [num, den] = bernoulliRational(n + 1);
  return reduce(-num, den * BigInt(n + 1));
}

/**
 * ζ(−n,a) for integer n ≥ 0 and rational base point a, as an exact reduced
 * rational: ζ(−n,a) = −Bₙ₊₁(a)/(n+1), the Bernoulli polynomial (DLMF
 * 25.11.14). Generalizes `zetaNegativeInteger` (a = 1) to a rational a. At
 * n = 0 it is ζ(0,a) = −B₁(a) = 1/2 − a, which needs the B₁ = −1/2
 * convention this module uses.
 */
export function hurwitzZetaNegativeInteger(
  n: number,
  a: [bigint, bigint]
): [bigint, bigint] {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(`hurwitzZetaNegativeInteger: invalid index ${n}`);
  const [num, den] = bernoulliPolynomialRational(n + 1, a);
  return reduce(-num, den * BigInt(n + 1));
}

/** A finite double as the exact rational [numerator, 2^k]. */
function doubleToRational(x: number): [bigint, bigint] {
  if (x === 0) return [0n, 1n];
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const biased = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exponent = -1074;
  if (biased !== 0) {
    mantissa |= 1n << 52n;
    exponent = biased - 1075;
  }
  if (hi >>> 31) mantissa = -mantissa;
  return exponent >= 0
    ? [mantissa << BigInt(exponent), 1n]
    : [mantissa, 1n << BigInt(-exponent)];
}

/**
 * num/den as a double. The quotient is formed with at least 64 significant
 * bits and then rounded once, so the result is within 1 ulp of the exact
 * value (it is ±Infinity past the range of a double).
 */
function rationalToDouble(num: bigint, den: bigint): number {
  if (num === 0n) return 0;
  const negative = num < 0n !== den < 0n;
  if (num < 0n) num = -num;
  if (den < 0n) den = -den;
  const shift = 64 - (num.toString(2).length - den.toString(2).length);
  const q =
    shift >= 0 ? (num << BigInt(shift)) / den : num / (den << BigInt(-shift));
  // Scale in two steps, so that neither factor overflows or underflows on
  // its own when the result is near the ends of the double range.
  const half = Math.trunc(shift / 2);
  const v = Number(q) * 2 ** -half * 2 ** -(shift - half);
  return negative ? -v : v;
}

// For N = n + 1: the integers eⱼ = D·C(N, j)·B_{N−j}, j = 0 … N, with D a
// common denominator of B₀ … B_N, so that D·B_N(x) = Σ eⱼ xʲ.
const BERNOULLI_POLY_INTEGER: Map<number, { e: bigint[]; d: bigint }> =
  new Map();

/** The integer coefficients eⱼ and the common denominator D of B_N(x), with
 * D·B_N(x) = Σ eⱼ xʲ (memoized in `BERNOULLI_POLY_INTEGER`). */
export function bernoulliPolynomialInteger(N: number): {
  e: bigint[];
  d: bigint;
} {
  let c = BERNOULLI_POLY_INTEGER.get(N);
  if (c === undefined) {
    let d = 1n;
    for (let k = 0; k <= N; k++) {
      const den = bernoulliRational(k)[1];
      d = (d / gcd(d, den)) * den;
    }
    const e: bigint[] = [];
    let binom = 1n; // C(N, j)
    for (let j = 0; j <= N; j++) {
      if (j > 0) binom = (binom * BigInt(N - j + 1)) / BigInt(j);
      const [bNum, bDen] = bernoulliRational(N - j);
      e.push((binom * bNum * d) / bDen);
    }
    c = { e, d };
    BERNOULLI_POLY_INTEGER.set(N, c);
  }
  return c;
}

/**
 * ζ(−n, a) = −Bₙ₊₁(a)/(n+1) for integer n ≥ 0 at a double a, within 1 ulp:
 * a double is the exact rational p/2^q, so the Bernoulli polynomial is
 * evaluated exactly (Horner's rule over one common denominator, with no gcd
 * reductions) and rounded once. At n = 0 it is 1/2 − a. The cost is about
 * 50 µs at n = 210 and a few µs for n up to 30.
 */
export function hurwitzZetaNegativeIntegerAt(n: number, a: number): number {
  const N = n + 1;
  const c = bernoulliPolynomialInteger(N);
  const [p, den] = doubleToRational(a);
  const q = BigInt(den.toString(2).length - 1); // den = 2^q
  // Σ eⱼ (p/2^q)ʲ · 2^{qN} = Σ eⱼ pʲ 2^{q(N−j)}, by Horner in p.
  let acc = c.e[N];
  for (let j = N - 1; j >= 0; j--)
    acc = acc * p + (c.e[j] << (q * BigInt(N - j)));
  return rationalToDouble(-acc, c.d * (1n << (q * BigInt(N))) * BigInt(N));
}

/**
 * ζ(−n, a) for an integer n >= 0 and a complex a given by two doubles, as
 * the real and imaginary parts of the exact value −Bₙ₊₁(a)/(n + 1), each
 * rounded once to a double. The doubles are read exactly
 * (`doubleToRational`), and the polynomial is evaluated in exact integer
 * arithmetic (`hurwitzZetaNegativeIntegerGaussianParts`): in doubles, the
 * complex powers of a negative base gave a real a an imaginary part, and
 * Horner's rule loses digits for |a| > 1. The cost grows with n times the
 * number of binary digits of a.
 */
export function hurwitzZetaNegativeIntegerAtComplex(
  n: number,
  re: number,
  im: number
): [number, number] {
  const parts = hurwitzZetaNegativeIntegerGaussianParts(n, {
    re: doubleToRational(re),
    im: doubleToRational(im),
  });
  return [
    rationalToDouble(parts.re, parts.den),
    rationalToDouble(parts.im, parts.den),
  ];
}

/** A complex value with exact bigint-rational real and imaginary parts. */
export interface GaussianRational {
  re: [bigint, bigint];
  im: [bigint, bigint];
}

/**
 * ζ(−n,a) for integer n ≥ 0 and a Gaussian rational base point
 * a = p/q + i·r/s, as an exact reduced Gaussian rational: ζ(−n,a) =
 * −Bₙ₊₁(a)/(n+1), the Bernoulli polynomial (DLMF 25.11.14). Generalizes
 * `hurwitzZetaNegativeInteger` (real a) to a complex base point.
 *
 * Evaluating the same polynomial in floating point instead loses several
 * digits at these orders: Horner's intermediate terms grow like aⁿ⁺¹, which
 * for |a| > 1 is far past the polynomial's own magnitude — at n = 40,
 * a = 2.7, a BigDecimal Horner evaluation at the engine's working precision
 * is off from the 11th significant digit on (#374). Exact integer
 * arithmetic has no working precision to lose it from.
 *
 * With N = n + 1, a = (P + i·R)/Q over the common denominator Q = lcm(q, s)
 * (the variables `p`, `r`, `q` below) and D·B_N(x) = Σ eⱼ xʲ
 * (`bernoulliPolynomialInteger`), the value is
 * −Σ eⱼ (P + i·R)ʲ Q^(N−j) / (D·Q^N·N). The sum is an integer, computed by
 * Horner's rule in P + i·R with no gcd reduction, and the fraction is
 * reduced once at the end. A gcd reduction at every step instead costs more
 * than a minute at n = 100, a = 1e−300, because the numbers grow with n and
 * with the digits of a.
 *
 * The size of the result grows like N times the digit count of Q, P and R:
 * the caller bounds that product before it calls this function.
 */
export function hurwitzZetaNegativeIntegerGaussian(
  n: number,
  a: GaussianRational
): GaussianRational {
  const { re, im, den } = hurwitzZetaNegativeIntegerGaussianParts(n, a);
  return { re: reduce(re, den), im: reduce(im, den) };
}

/**
 * The value of `hurwitzZetaNegativeIntegerGaussian(n, a)` as
 * (re + i·im)/den, NOT reduced: den > 0 and the three integers can share a
 * common factor. The gcd of the final reduction costs about as much as the
 * whole evaluation when the numbers are large, so a caller that only
 * rounds the value to a decimal (one division of re and im by den) uses
 * this form directly.
 */
export function hurwitzZetaNegativeIntegerGaussianParts(
  n: number,
  a: GaussianRational
): { re: bigint; im: bigint; den: bigint } {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(
      `hurwitzZetaNegativeIntegerGaussian: invalid index ${n}`
    );
  const N = n + 1;
  const { e, d } = bernoulliPolynomialInteger(N);
  const [reNum, reDen] = a.re[1] < 0n ? [-a.re[0], -a.re[1]] : a.re;
  const [imNum, imDen] = a.im[1] < 0n ? [-a.im[0], -a.im[1]] : a.im;
  const q = (reDen / gcd(reDen, imDen)) * imDen;
  const p = reNum * (q / reDen);
  const r = imNum * (q / imDen);
  // Horner's rule: acc ← acc·(p + i·r) + eⱼ·q^(N−j), for j = N−1 … 0.
  let accRe = e[N];
  let accIm = 0n;
  let qPower = 1n;
  for (let j = N - 1; j >= 0; j--) {
    qPower *= q;
    const nextRe = accRe * p - accIm * r + e[j] * qPower;
    accIm = accRe * r + accIm * p;
    accRe = nextRe;
  }
  return { re: -accRe, im: -accIm, den: d * qPower * BigInt(N) };
}

/**
 * Wolfram's generalized `Zeta[−n, a]` for integer n ≥ 0 and rational a, as an
 * exact reduced rational: the terms with k + a < 0 are |k + a|ⁿ, the term
 * with k + a = 0 is dropped, and the rest is the Hurwitz ζ(−n, a₀) of the
 * first base point a₀ ≥ 0 reached by steps of 1 (a₀ = 1 when that point is
 * 0). This is the exact form of `zetaGeneralizedComplex`
 * (`numeric-complex.ts`). Returns `undefined` when a is so negative that
 * more than 1000 terms precede the positive axis.
 */
export function generalizedZetaNegativeInteger(
  n: number,
  a: [bigint, bigint]
): [bigint, bigint] | undefined {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(`generalizedZetaNegativeInteger: invalid index ${n}`);
  // eslint-disable-next-line prefer-const
  let [num, den] = reduce(a[0], a[1]);
  const power = BigInt(n);
  let sumNum = 0n;
  let sumDen = 1n;
  let steps = 0;
  while (num < 0n) {
    if (++steps > 1000) return undefined;
    const termNum = (-num) ** power;
    const termDen = den ** power;
    [sumNum, sumDen] = reduce(
      sumNum * termDen + termNum * sumDen,
      sumDen * termDen
    );
    num += den;
  }
  if (num === 0n) num = den; // drop the (k + a) = 0 term: continue at a₀ = 1
  const [hNum, hDen] = hurwitzZetaNegativeInteger(n, [num, den]);
  return reduce(sumNum * hDen + hNum * sumDen, sumDen * hDen);
}
