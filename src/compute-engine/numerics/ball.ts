import { BigDecimal } from '../../big-decimal/index.js';

// Ball arithmetic: a real number known to lie within `rad` of `mid` -- a measurement with
// its error bar. Every operation returns a ball that contains every value the operation can
// take on its argument balls, so a kernel written in these operations ends with a ball that
// provably contains its true value, rounding and all .
//
// `mid` is carried at BigDecimal's working precision and rounded to nearest, as the point
// kernels round; the error that rounding makes is added to `rad`. BigDecimal's `+`, `−` and
// `×` are exact, so that error is itself computed exactly, never estimated. `rad` is a short
// decimal (`RAD_DIGITS`) that is only ever rounded up -- a radius needs to be safe, not
// precise -- and it can't be a double: at 1000 digits it is near 10⁻¹⁰⁰⁰.
//
// compute-engine's BigDecimal documents a bound for `div` and `sqrt` (`divToward`,
// `sqrtToward`) but none for `ln`, `exp` or `pow`, so those are ours: `exp` sums its Taylor
// series with the tail bounded, and `ln` takes compute-engine's `ln` as a guess and proves
// it with that `exp`, never trusting it.

/** `fn` run with BigDecimal's working precision set to `digits`, restored after. */
export function atDigits<T>(digits: number, fn: () => T): T {
  const saved = BigDecimal.precision;
  BigDecimal.precision = digits;
  try {
    return fn();
  } finally {
    BigDecimal.precision = saved;
  }
}

/** A real in `[mid − rad, mid + rad]`. */
export interface Ball {
  readonly mid: BigDecimal;
  readonly rad: BigDecimal;
}

/** Thrown where a ball can't be continued -- a division by a ball holding 0, a logarithm of
 * one reaching 0 -- and caught by `certify`, which answers undefined: no certificate. */
class NotCertified extends Error {}

/** `fn`'s ball, or undefined when it couldn't be certified. */
export function certify<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (error) {
    if (error instanceof NotCertified) return undefined;
    throw error;
  }
}

/** `x`, when a kernel a ball depends on gave one; otherwise no certificate. */
export function certain<T>(x: T | undefined): T {
  if (x === undefined) throw new NotCertified();
  return x;
}

/** Significant digits a radius keeps. */
const RAD_DIGITS = 8;

const ZERO = BigDecimal.ZERO;
const ONE = BigDecimal.ONE;
const HALF = BigDecimal.HALF;

/** A nonnegative `x`, rounded up to a radius's digits. */
const up = (x: BigDecimal): BigDecimal =>
  x.toPrecisionToward(RAD_DIGITS, 'ceiling');

/** `x ÷ y` for a nonnegative `x` and positive `y`, rounded up to a radius's digits. */
const upDiv = (x: BigDecimal, y: BigDecimal): BigDecimal =>
  atDigits(RAD_DIGITS, () => x.divToward(y, 'ceiling'));

/** The ball of an `exact` value rounded to the working precision, around an error `rad`. */
function settle(exact: BigDecimal, rad: BigDecimal): Ball {
  const mid = exact.toPrecision(BigDecimal.precision);
  return { mid, rad: up(rad.add(exact.sub(mid).abs())) };
}

/** An exact value, as a ball of radius 0. */
export const exact = (x: BigDecimal | number): Ball => ({
  mid: new BigDecimal(x),
  rad: ZERO,
});

/** `p/q` at the working precision. */
export function rational(p: bigint, q: bigint): Ball {
  const mid = new BigDecimal(p).div(new BigDecimal(q));
  // mid − p/q = (mid·q − p)/q, the numerator exact.
  const error = mid.mul(new BigDecimal(q)).sub(new BigDecimal(p)).abs();
  return { mid, rad: upDiv(error, new BigDecimal(q < 0n ? -q : q)) };
}

/** The ball's least value. */
export const lower = (x: Ball): BigDecimal => x.mid.sub(x.rad);

/** The ball's greatest value. */
export const upper = (x: Ball): BigDecimal => x.mid.add(x.rad);

/** The greatest |value| in the ball, rounded up. */
export const magnitude = (x: Ball): BigDecimal => up(x.mid.abs().add(x.rad));

export const neg = (x: Ball): Ball => ({ mid: x.mid.neg(), rad: x.rad });

export const add = (x: Ball, y: Ball): Ball =>
  settle(x.mid.add(y.mid), x.rad.add(y.rad));

export const sub = (x: Ball, y: Ball): Ball =>
  settle(x.mid.sub(y.mid), x.rad.add(y.rad));

/** `x·y`: (m + δ)(n + ε) − mn = mε + nδ + δε. */
export const mul = (x: Ball, y: Ball): Ball =>
  settle(
    x.mid.mul(y.mid),
    x.mid.abs().mul(y.rad).add(y.mid.abs().mul(x.rad)).add(x.rad.mul(y.rad))
  );

/** `x/y`, for a `y` that keeps away from 0. */
export function div(x: Ball, y: Ball): Ball {
  const below = y.mid.abs().sub(y.rad); // the least |y|
  if (!below.isPositive()) throw new NotCertified();
  const floor = x.mid.divToward(y.mid, 'floor');
  const ceiling = x.mid.divToward(y.mid, 'ceiling');
  // (m + δ)/(n + ε) − m/n = (δ − (m/n)ε)/(n + ε), at most (|δ| + |m/n|·|ε|)/(|n| − |ε|).
  const quotient = floor.abs().gt(ceiling.abs()) ? floor.abs() : ceiling.abs();
  const spread = upDiv(up(x.rad.add(quotient.mul(y.rad))), below);
  return { mid: floor, rad: up(ceiling.sub(floor).add(spread)) };
}

/** `x`ⁿ for an integer n, by repeated squaring. */
export function powInt(x: Ball, n: number): Ball {
  if (n < 0) return div(exact(1), powInt(x, -n));
  let result = exact(1);
  let square = x;
  for (let k = n; k > 0; k = Math.floor(k / 2)) {
    if (k % 2 === 1) result = mul(result, square);
    if (k > 1) square = mul(square, square);
  }
  return result;
}

/** `x^s` for an `x` that keeps above 0: e^{s ln x}, or repeated squaring for an exact integer `s`. */
export function pow(x: Ball, s: Ball): Ball {
  if (s.rad.isZero() && s.mid.isInteger() && s.mid.abs().lte(1_000_000)) {
    return powInt(x, s.mid.toNumber());
  }
  return exp(mul(s, ln(x)));
}

/** The smallest ball holding both. */
function hull(x: Ball, y: Ball): Ball {
  const least = lower(x).lt(lower(y)) ? lower(x) : lower(y);
  const greatest = upper(x).gt(upper(y)) ? upper(x) : upper(y);
  return settle(least.add(greatest).mul(HALF), greatest.sub(least).mul(HALF));
}

/** eˣ. */
export function exp(x: Ball): Ball {
  // A wide ball through its ends -- e is increasing -- where the derivative bound below
  // would be loose.
  if (x.rad.gte(HALF)) return hull(expExact(lower(x)), expExact(upper(x)));
  const e = expExact(x.mid);
  // e^{m+δ} − e^m = e^m (e^δ − 1), and |e^δ − 1| ≤ e^r − 1 ≤ r/(1 − r) for |δ| ≤ r < 1.
  const spread = upDiv(up(upper(e).mul(x.rad)), ONE.sub(x.rad));
  return { mid: e.mid, rad: up(e.rad.add(spread)) };
}

/** Past this |x|, eˣ over- or underflows anything worth certifying. */
const EXP_LIMIT = 1e6;

/** e^m for an exact m, in fixed point: integers counting units of 2^−bits, as Arb and mpmath
 * compute it. A product or quotient of them is truncated, erring by less than a unit, so the
 * error is kept as a count of units rather than a ball per step.
 *
 * m is halved j times to t, |t| ≤ ¼, and e^t summed by its Taylor series:
 *   - t itself is truncated to a unit, T, and e^t's slope is below 2 there: 2 units.
 *   - The kth term Aₖ, Aₖ₋₁·T truncated to units and then divided by k, truncated again,
 *     errs by Eₖ ≤ Eₖ₋₁|t|/k + 2 < 3 units.
 *   - The loop stops at the first Aₖ = 0, when |tᵏ/k!| < 3 units, and the terms after it sum
 *     to less than that again.
 * So K terms err by less than 3K + 5 units. Then e^t is squared j times: S ± E squares to
 * S² ± E(2S + E), and truncating that to units adds one more. Each squaring doubles the
 * relative error, and a negative m's small result has fewer units to its name, so the units
 * are sized for both. */
function expExact(m: BigDecimal): Ball {
  if (m.isZero()) return exact(1);
  const x = m.toNumber();
  if (!(Math.abs(x) < EXP_LIMIT)) throw new NotCertified();
  const j = x === 0 ? 0 : Math.max(0, Math.ceil(Math.log2(Math.abs(x))) + 2);
  const digits =
    BigDecimal.precision +
    Math.ceil(j * Math.log10(2) + Math.max(0, -x) * Math.LOG10E) +
    4;
  const bits = Math.ceil(digits * Math.log2(10)) + 8;
  const one = 1n << BigInt(bits);
  const T = fixed(m, bits - j);
  let term = one;
  let sum = one;
  let k = 1n;
  for (; term !== 0n; k++) {
    term = (term * T) / one / k;
    sum += term;
  }
  let error = 3n * k + 5n;
  for (let i = 0; i < j; i++) {
    error = (error * (2n * sum + error)) / one + 2n;
    sum = (sum * sum) / one;
  }
  const unit = unitOf(bits);
  return settle(
    new BigDecimal(sum).mul(unit),
    up(new BigDecimal(error).mul(unit))
  );
}

const units = new Map<number, BigDecimal>();

/** 2^−bits = 5^bits / 10^bits, exactly. */
function unitOf(bits: number): BigDecimal {
  let unit = units.get(bits);
  if (unit === undefined) {
    unit = new BigDecimal(5n ** BigInt(bits)).mul(new BigDecimal(`1e-${bits}`));
    units.set(bits, unit);
  }
  return unit;
}

/** ⌊x·2^bits⌋, give or take a unit, for an exact x. */
function fixed(x: BigDecimal, bits: number): bigint {
  const scaled =
    bits >= 0 ? x.significand << BigInt(bits) : x.significand >> BigInt(-bits);
  return x.exponent >= 0
    ? scaled * 10n ** BigInt(x.exponent)
    : scaled / 10n ** BigInt(-x.exponent);
}

/** Newton steps `ln` will take to correct a poor guess before giving up. */
const MAX_NEWTON = 8;

/** ln x, for an `x` that keeps above 0. */
export function ln(x: Ball): Ball {
  const least = lower(x);
  if (!least.isPositive()) throw new NotCertified();
  const l = lnExact(x.mid);
  // |ln(m + δ) − ln m| ≤ r / (m − r): ln's slope is at most 1/(m − r) on the ball.
  const spread = upDiv(x.rad, least);
  return { mid: l.mid, rad: up(l.rad.add(spread)) };
}

/** ln m for an exact m > 0. With y any guess, ln m = y + ln w for w = m·e^{−y}; when y is
 * close, w − 1 = v is tiny and ln(1 + v) = v within v² (|v| ≤ ½). So compute-engine's `ln`
 * supplies y, our `exp` proves it, and a poor y is corrected by Newton's step y + v. Near
 * m = 1, ln m is about m − 1, and forming w − 1 cancels the digits it starts with, so they
 * are carried as well. */
function lnExact(m: BigDecimal): Ball {
  const gap = Math.abs(m.sub(1).toNumber());
  const cancelled = gap === 0 ? 0 : Math.max(0, Math.ceil(-Math.log10(gap)));
  const l = atDigits(BigDecimal.precision + cancelled, () => {
    const working = BigDecimal.precision;
    const close = new BigDecimal(`1e-${Math.ceil(working / 2) + 2}`);
    let y = m.ln().toPrecision(working);
    for (let step = 0; step < MAX_NEWTON; step++) {
      const v = sub(mul(exact(m), exp(exact(y.neg()))), exact(1));
      const size = magnitude(v);
      if (size.lt(close))
        return settle(y.add(v.mid), v.rad.add(size.mul(size)));
      y = y.add(v.mid).toPrecision(working);
    }
    throw new NotCertified();
  });
  return settle(l.mid, l.rad);
}
