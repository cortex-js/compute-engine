import { BigDecimal } from '../../big-decimal/index.js';

/**
 * I_x(a, b) for a real x outside [0, 1], where the regularized incomplete
 * beta function is real only for an integer b (or, the other way round, an
 * integer a): then (1 − t)^(b−1) is a polynomial, and the integral
 * B_x(a, b) = ∫₀ˣ t^(a−1)(1 − t)^(b−1) dt is a finite sum (DLMF §8.17(ii)).
 *
 * - a and b both positive integers: I_x(a, b) is the polynomial
 *   Σ_{j=a}^{n} C(n, j) xʲ (1 − x)ⁿ⁻ʲ with n = a + b − 1, evaluated exactly
 *   from the digits of x, so any real x is valid, negative ones included.
 * - x > 1, a > 0 and b a positive integer: the alternating sum
 *   B_x(a, b) = Σⱼ C(b−1, j)(−1)ʲ x^(a+j)/(a+j), divided by
 *   B(a, b) = (b−1)!/(a(a+1)…(a+b−1)), with working digits added for the
 *   cancellation of the sum.
 *
 * Anything else (a non-integer b with x outside [0, 1] is complex) is NaN,
 * and so is a case too large to sum within the caps below.
 */

/** Largest n = a + b − 1 of the exact polynomial; its sum has n + 1 terms. */
const BETA_POLYNOMIAL_MAX_DEGREE = 200;

/** Largest b of the alternating sum, whose cancellation grows with b. */
const BETA_ALTERNATING_MAX_B = 30;

/** Most decimal digits of x read exactly. A longer x is rounded to this many. */
const BETA_POLYNOMIAL_MAX_X_DIGITS = 200;

/** Most digits a retry adds to cover the cancellation of the alternating sum. */
const BETA_ALTERNATING_MAX_EXTRA = 300;

/** An integer-valued BigDecimal in [1, `max`] as a number, else `undefined`. */
function smallPositiveInteger(x: BigDecimal, max: number): number | undefined {
  if (!x.isInteger() || !x.isPositive() || x.gt(max)) return undefined;
  return x.toNumber();
}

/** x as the rational p/q, rounded to `BETA_POLYNOMIAL_MAX_X_DIGITS` digits. */
function decimalAsRational(x: BigDecimal): [bigint, bigint] | undefined {
  const text = x
    .toPrecision(BETA_POLYNOMIAL_MAX_X_DIGITS)
    .toString()
    .toLowerCase();
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text);
  if (match === null) return undefined;
  const [, sign, whole, fraction = '', exponent = '0'] = match;
  const shift = Number(exponent) - fraction.length;
  const digits = BigInt(`${sign}${whole}${fraction}`);
  return shift >= 0
    ? [digits * 10n ** BigInt(shift), 1n]
    : [digits, 10n ** BigInt(-shift)];
}

/** Σ_{j=a}^{n} C(n, j) xʲ (1 − x)ⁿ⁻ʲ for x = p/q, as numerator and denominator. */
function binomialTail(
  p: bigint,
  q: bigint,
  a: number,
  n: number
): [bigint, bigint] {
  let binomial = 1n;
  let numerator = 0n;
  for (let j = 0; j <= n; j++) {
    if (j >= a)
      numerator += binomial * p ** BigInt(j) * (q - p) ** BigInt(n - j);
    binomial = (binomial * BigInt(n - j)) / BigInt(j + 1);
  }
  return [numerator, q ** BigInt(n)];
}

function withPrecision<T>(digits: number, fn: () => T): T {
  const saved = BigDecimal.precision;
  BigDecimal.precision = digits;
  try {
    return fn();
  } finally {
    BigDecimal.precision = saved;
  }
}

/** log₁₀|x| for x ≠ 0. */
function log10Abs(x: BigDecimal): number {
  const v = Math.abs(x.toNumber());
  return v > 0 && Number.isFinite(v)
    ? Math.log10(v)
    : x.abs().ln().toNumber() / Math.LN10;
}

/**
 * B_x(a, b)/B(a, b) for x > 1, a > 0 and an integer b in [1, `BETA_ALTERNATING_MAX_B`].
 * `undefined` when the cancellation is more than `BETA_ALTERNATING_MAX_EXTRA`
 * digits.
 */
function alternatingSum(
  x: BigDecimal,
  a: BigDecimal,
  b: number
): BigDecimal | undefined {
  const target = BigDecimal.precision;
  let extra = 15;
  for (;;) {
    const attempt = withPrecision(target + extra, () => {
      const xa = a.mul(x.ln()).exp();
      let binomial = BigDecimal.ONE;
      let power = xa;
      let sum = BigDecimal.ZERO;
      let largest = BigDecimal.ZERO;
      // a(a+1)…(a+b−1)/(b−1)!, the reciprocal of B(a, b)
      let scale = BigDecimal.ONE;
      for (let j = 0; j < b; j++) {
        const term = binomial.mul(power).div(a.add(j));
        sum = j % 2 === 0 ? sum.add(term) : sum.sub(term);
        if (term.gt(largest)) largest = term;
        scale = scale.mul(a.add(j));
        if (j > 0) scale = scale.div(j);
        binomial = binomial.mul(b - 1 - j).div(j + 1);
        power = power.mul(x);
      }
      if (sum.isZero()) return { value: sum, lost: Infinity };
      return {
        value: sum.mul(scale),
        lost: Math.max(0, log10Abs(largest) - log10Abs(sum)),
      };
    });
    if (attempt.lost <= extra - 5) return attempt.value.toPrecision(target);
    extra = Math.ceil(attempt.lost) + 15;
    if (!(extra <= BETA_ALTERNATING_MAX_EXTRA)) return undefined;
  }
}

/** I_x(a, b) for x < 0 or x > 1 at the working precision, or NaN. */
export function bigBetaRegularizedOutside(
  x: BigDecimal,
  a: BigDecimal,
  b: BigDecimal
): BigDecimal {
  const target = BigDecimal.precision;
  const na = smallPositiveInteger(a, BETA_POLYNOMIAL_MAX_DEGREE);
  const nb = smallPositiveInteger(b, BETA_POLYNOMIAL_MAX_DEGREE);
  if (
    na !== undefined &&
    nb !== undefined &&
    na + nb - 1 <= BETA_POLYNOMIAL_MAX_DEGREE
  ) {
    const rational = decimalAsRational(x);
    if (rational === undefined) return BigDecimal.NAN;
    const [numerator, denominator] = binomialTail(
      rational[0],
      rational[1],
      na,
      na + nb - 1
    );
    return withPrecision(target + 5, () =>
      new BigDecimal(numerator).div(new BigDecimal(denominator))
    ).toPrecision(target);
  }
  if (nb === undefined || nb > BETA_ALTERNATING_MAX_B || !x.gt(1))
    return BigDecimal.NAN;
  return alternatingSum(x, a, nb) ?? BigDecimal.NAN;
}

/** I_x(a, b) for x < 0 or x > 1, as a double, or NaN. */
export function betaRegularizedOutside(
  x: number,
  a: number,
  b: number
): number {
  if (!Number.isFinite(x) || !Number.isFinite(a) || !Number.isFinite(b))
    return NaN;
  // 30 digits in, one rounding out: the sum is not summed in doubles
  return withPrecision(30, () =>
    bigBetaRegularizedOutside(
      new BigDecimal(x),
      new BigDecimal(a),
      new BigDecimal(b)
    )
  ).toNumber();
}
