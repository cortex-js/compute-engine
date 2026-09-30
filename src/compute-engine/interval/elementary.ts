/**
 * Elementary interval functions (sqrt, pow, exp, ln, abs, floor, ceil, min, max, mod)
 *
 * @module interval/elementary
 */

import type { Interval, IntervalResult } from './types.js';
import {
  ok,
  point,
  getValue,
  containsZero,
  isNegative,
  unwrapOrPropagate,
  liftJump,
  jump,
} from './util.js';
import {
  add as addOutward,
  sub as subOutward,
  mul as mulOutward,
  div,
  subUnrounded,
  mulUnrounded,
  divUnrounded,
} from './arithmetic.js';
import {
  outward,
  outwardUnlessExact,
  eitherExact,
  exactInRange,
  exactSqrt,
  exactSquare,
  exactPow,
  exactPowInterval,
  exactIntegerGridPoint,
  exactAtOrigin,
  exactAtZeroBound,
  exactLog,
} from './rounding.js';
import { prodExact } from '../numerics/interval-arithmetic.js';
import {
  binomial as scalarBinomial,
  gamma as scalarGamma,
  gammaln as scalarGammaln,
  erf as scalarErf,
  erfc as scalarErfc,
} from '../numerics/special-functions.js';
import {
  factorial2 as scalarFactorial2,
  gcd as scalarGcd,
  lcm as scalarLcm,
  chop as scalarChop,
  nextDown,
  nextUp,
  roundHalfAway,
} from '../numerics/numeric.js';

/**
 * Square root of an interval (or IntervalResult).
 *
 * - Entirely negative: empty (no real values)
 * - Entirely non-negative: straightforward monotonic
 * - Straddles zero: partial result with lower bound clipped
 */
/**
 * A NaN bound propagates as a NaN interval (Contract B `propagate`, ratified
 * 2026-08-27) — the same value the plain arithmetic kernels produce for a NaN
 * input, and the compile target's numeric ABSENCE marker (`{ lo: NaN, hi:
 * NaN }`), which must stay absent through every kernel. Two families of
 * kernels have to check this first, because every comparison with NaN is
 * false and their branches then run as if the input straddled a boundary:
 * the step functions, whose `Math.floor`-style point rules answer NaN for NaN
 * and `NaN === NaN` is false, so they reported a discontinuity "at NaN" that
 * the input never touched; and the kernels that branch on the sign of the
 * input — `sqrt`, `ln`, `square`, `abs`, `gamma` — which fell through to
 * their "straddles zero" arm and widened the absent value to an enclosure
 * such as `[0, ∞)` behind a present-looking result.
 */
function isNaNInterval(x: Interval): boolean {
  return Number.isNaN(x.lo) || Number.isNaN(x.hi);
}
const NAN_INTERVAL: Interval = { lo: NaN, hi: NaN };

function sqrtRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (isNaNInterval(xVal)) return ok(NAN_INTERVAL);
  return _sqrt(xVal);
}

function _sqrt(x: Interval): IntervalResult {
  // Case 1: Entirely negative - no valid values
  if (x.hi < 0) {
    return { kind: 'empty' };
  }

  // Case 2: Entirely non-negative - straightforward
  if (x.lo >= 0) {
    return ok({ lo: Math.sqrt(x.lo), hi: Math.sqrt(x.hi) });
  }

  // Case 3: Straddles zero - valid for [0, x.hi], invalid for [x.lo, 0)
  return {
    kind: 'partial',
    value: { lo: 0, hi: Math.sqrt(x.hi) },
    domainClipped: 'lo',
  };
}

/**
 * Square an interval (or IntervalResult).
 *
 * Need to handle sign change at 0 since x^2 is not monotonic.
 */
function squareRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (isNaNInterval(xVal)) return ok(NAN_INTERVAL);
  if (xVal.lo >= 0) {
    // Entirely non-negative: monotonically increasing
    return ok({ lo: xVal.lo * xVal.lo, hi: xVal.hi * xVal.hi });
  } else if (xVal.hi <= 0) {
    // Entirely non-positive: monotonically decreasing, flip bounds
    return ok({ lo: xVal.hi * xVal.hi, hi: xVal.lo * xVal.lo });
  } else {
    // Interval contains 0 - minimum is 0
    return ok({ lo: 0, hi: Math.max(xVal.lo * xVal.lo, xVal.hi * xVal.hi) });
  }
}

/**
 * Integer power helper for non-negative integer exponents.
 */
function intPow(base: Interval, n: number): Interval {
  if (n === 0) return { lo: 1, hi: 1 };
  if (n === 1) return base;

  // For even powers, the function has a minimum at 0
  if (n % 2 === 0) {
    if (base.lo >= 0) {
      return { lo: Math.pow(base.lo, n), hi: Math.pow(base.hi, n) };
    } else if (base.hi <= 0) {
      return { lo: Math.pow(base.hi, n), hi: Math.pow(base.lo, n) };
    } else {
      // Contains zero - minimum is 0
      return {
        lo: 0,
        hi: Math.max(Math.pow(base.lo, n), Math.pow(base.hi, n)),
      };
    }
  }

  // For odd powers, the function is monotonically increasing
  return { lo: Math.pow(base.lo, n), hi: Math.pow(base.hi, n) };
}

/**
 * Power function for intervals.
 *
 * Handles integer and fractional exponents differently:
 * - Integer exponents: consider sign and parity
 * - Negative integer: x^(-n) = 1/x^n, singular if base contains 0
 * - Fractional: requires non-negative base for real result
 */
function powRaw(base: Interval | IntervalResult, exp: number): IntervalResult {
  const unwrapped = unwrapOrPropagate(base);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [baseVal] = unwrapped;
  if (Number.isInteger(exp)) {
    if (exp >= 0) {
      return ok(intPow(baseVal, exp));
    } else {
      // Negative integer: x^(-n) = 1/x^n - singularity if base contains 0
      if (containsZero(baseVal)) {
        return { kind: 'singular' };
      }
      const denom = intPow(baseVal, -exp);
      // 1 / [a, b] = [1/b, 1/a] when a, b have same sign
      return ok({ lo: 1 / denom.hi, hi: 1 / denom.lo });
    }
  } else {
    // Fractional exponent - requires non-negative base for real result
    if (isNegative(baseVal)) {
      // Entirely negative - no real values
      return { kind: 'empty' };
    }
    if (baseVal.lo < 0) {
      // Straddles zero - valid for [0, base.hi]
      const value =
        exp > 0
          ? { lo: 0, hi: Math.pow(baseVal.hi, exp) }
          : { lo: Math.pow(baseVal.hi, exp), hi: Infinity }; // x^(-0.5) etc
      return { kind: 'partial', value, domainClipped: 'lo' };
    }
    // Entirely non-negative - straightforward
    // Handle exp > 0 vs exp < 0 for monotonicity
    if (exp > 0) {
      return ok({
        lo: Math.pow(baseVal.lo, exp),
        hi: Math.pow(baseVal.hi, exp),
      });
    } else {
      // Decreasing function
      if (baseVal.lo === 0) {
        return {
          kind: 'partial',
          value: { lo: Math.pow(baseVal.hi, exp), hi: Infinity },
          domainClipped: 'hi',
        };
      }
      return ok({
        lo: Math.pow(baseVal.hi, exp),
        hi: Math.pow(baseVal.lo, exp),
      });
    }
  }
}

/**
 * Interval power where the exponent is also an interval.
 *
 * For simplicity, we evaluate at the four corners and take the hull.
 * This requires base to be positive for real results.
 */
function powIntervalRaw(
  base: Interval | IntervalResult,
  exp: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(base, exp);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [baseVal, expVal] = unwrapped;

  // Special case: exponent is a point interval with an integer value.
  // For integer exponents, negative bases are well-defined (parity matters).
  // This is critical for patterns like (-1)^k in summations.
  // The RAW power is called here, not the exported `pow`. The export rounds
  // its answer outward, and this routine's own export rounds again, so going
  // through it would move the endpoint twice for a single computation. The
  // invariant across this library is that a routine's answer is stepped
  // outward ONCE, at that routine's own export, by a step count that covers
  // all the rounding its own computation performs — a routine built from
  // others composes their RAW kernels so that their exports never see the
  // intermediate values.
  if (expVal.lo === expVal.hi && Number.isInteger(expVal.lo)) {
    return powRaw(baseVal, expVal.lo);
  }

  // For real-valued results with non-integer exponents, base must be positive
  if (baseVal.hi <= 0) {
    // Special case: base is exactly -1 and exponent spans at least two
    // consecutive integers. (-1)^n alternates between -1 and 1, so the
    // tightest enclosure is [-1, 1].
    if (
      baseVal.lo === -1 &&
      baseVal.hi === -1 &&
      Math.floor(expVal.hi) > Math.floor(expVal.lo)
    ) {
      return ok({ lo: -1, hi: 1 });
    }
    return { kind: 'empty' };
  }
  if (baseVal.lo <= 0) {
    // The base reaches 0. Two situations were previously collapsed into one
    // `partial`, and only one of them is outside the domain.
    //
    // TOUCHING zero from the right (`lo === 0`) with a wholly POSITIVE
    // exponent is entirely INSIDE the domain: `0^e = 0` for every `e > 0`, so
    // the box has a value everywhere and the enclosure is exact. Reporting
    // `partial` here made a smooth field read as clipped on every box, and a
    // consumer that treats `partial` as a discontinuity saw a break in every
    // cell (Tycho item 260). The scalar-exponent sibling `powRaw` already gets
    // this right, which is why a constant exponent behaved and a symbolic one
    // did not.
    //
    // STRADDLING zero (`lo < 0`) is genuinely partial: a negative base has no
    // real value at a non-integer exponent, so the domain is clipped to the
    // non-negative part and the result says so.
    //
    // A base reaching 0 with an exponent that can be ZERO OR NEGATIVE has a
    // POLE there — `x^e → +∞` as `x → 0+` for `e < 0` — so the supremum is
    // infinite. The previous code substituted `Number.EPSILON` for the zero
    // endpoint and computed `EPSILON^e`, which answered an arbitrary finite
    // bound (`1.36e39` for `e = -2.5`) in place of `+∞`: an enclosure that does
    // NOT contain the true range, which is unsound rather than merely
    // imprecise, and could hide a pole from a consumer scanning for one.
    const clipped = baseVal.lo < 0;
    const hiCorners = [
      Math.pow(baseVal.hi, expVal.lo),
      Math.pow(baseVal.hi, expVal.hi),
    ];
    // Three readings of the exponent, over a base reaching 0. The split is on
    // whether a NEGATIVE exponent is present, because that alone creates the
    // pole: an exponent of exactly 0 does not, since `x^0 = 1` for every `x`
    // — including `x = 0`, which is this file's own convention (`intPow` with
    // an exponent of 0 answers `[1, 1]`).
    //
    // - NO negative exponent (`expVal.lo >= 0`): every value is defined and
    //   finite. 0 is the infimum — attained at `x = 0` for a positive
    //   exponent, approached as `x -> 0+` otherwise — and the supremum is at
    //   the far endpoint. Reading `expVal.lo === 0` as a pole instead answered
    //   `+∞` for `[0,2]^[0,1]`, whose true range is `[0,2]`: sound, but it
    //   throws away the bound and reports the very discontinuity this fix
    //   exists to stop reporting. (An exponent interval that is exactly
    //   `[0, 0]` never reaches here — it is an integer point, handled above.)
    // - SPANS zero (`expVal.lo < 0 < expVal.hi`): both limits are reached as
    //   `x -> 0+` — the positive exponents drive the value to 0 and the
    //   negative ones to `+∞` — so the enclosure is the whole non-negative
    //   line. Reading the infimum off the far endpoint alone would MISS the
    //   small values: `[0,2]^[-1,3]` contains `0.5^3 = 0.125`, well under the
    //   `2^-1 = 0.5` the endpoint corners suggest.
    // - wholly NEGATIVE-or-zero (`expVal.hi <= 0`, with `expVal.lo < 0`):
    //   `x^e` is non-increasing in `x` for each such `e`, so the infimum is at
    //   the far endpoint, and `x -> 0+` sends the supremum to `+∞`.
    const noNegativeExponent = expVal.lo >= 0;
    const value = noNegativeExponent
      ? { lo: 0, hi: Math.max(...hiCorners) }
      : expVal.hi > 0
        ? { lo: 0, hi: Infinity }
        : { lo: Math.min(...hiCorners), hi: Infinity };
    if (clipped) return { kind: 'partial', value, domainClipped: 'lo' };
    // Touching zero with no negative exponent: nothing is outside the domain.
    if (noNegativeExponent) return ok(value);
    // Touching zero with an exponent that can be negative: the point `x = 0`
    // is outside the domain, so the box is only partly covered.
    return { kind: 'partial', value, domainClipped: 'lo' };
  }

  // Both base values are positive
  const corners = [
    Math.pow(baseVal.lo, expVal.lo),
    Math.pow(baseVal.lo, expVal.hi),
    Math.pow(baseVal.hi, expVal.lo),
    Math.pow(baseVal.hi, expVal.hi),
  ];
  return ok({ lo: Math.min(...corners), hi: Math.max(...corners) });
}

/** The point interval 1, the dividend of the reciprocal in `powRationalRaw`.
 *  An operand is only read, never written, so one shared object is enough. */
const POINT_ONE: Interval = { lo: 1, hi: 1 };

/**
 * `base^(p/q)` on an interval, using the real-root convention for an ODD
 * denominator (e.g. `(-8)^(2/3) = 4`, `(-32)^(3/5) = -8`). For a non-negative
 * base this is the ordinary `base^(p/q)`; the extension only matters when the
 * base is (partly) negative, where `Math.pow` would return `NaN` even though a
 * real value exists. An EVEN denominator has no real value over a negative
 * base, and the root below reports the `empty` or domain-clipped answer.
 *
 * The value is built as `(x^(1/q))^p` — the q-th ROOT first, then the integer
 * power — rather than from `Math.pow(x, p/q)`. The direct form has to round the
 * exponent `p/q` to a double, and `x^(e+δ) = x^e·(1 + δ·ln x)`, so its error
 * grows with `|ln x|` and with `p/q`: no fixed number of ulps bounds it. The
 * three-ulp step this routine used to take at its export missed the true value
 * on about 5% of a random sweep over `x ∈ (0, 1000]`, `p ∈ [1, 5]`,
 * `q ∈ {3, 5, 7}`, by up to two further ulps. The composition rounds no
 * exponent at all.
 *
 * It also settles the parity and the origin on its own: the integer-exponent
 * branch of `pow` is what gives an even numerator its minimum of 0 at the
 * origin and an odd one its monotone increase, so this routine states no
 * endpoint rule of its own.
 *
 * This is the one routine of the library that takes NO outward step at its own
 * export. It composes the ROUNDED `nthRoot`, `pow` and `div`, each of which
 * encloses its own answer, because the integer power amplifies the width of the
 * root by the factor `p` — and so amplifies the root's error by the same
 * factor. A step taken at the export is a fixed number of ulps and cannot
 * account for that; composing the raw kernels under one such step is exactly
 * what was unsound. Exactness survives the composition, since each of the three
 * carries a prover: `8^(2/3)` is the point 4, `4^(3/2)` the point 8 and
 * `8^(-2/3)` the point 0.25.
 */
function powRationalRaw(
  base: Interval | IntervalResult,
  p: number,
  q: number
): IntervalResult {
  const unwrapped = unwrapOrPropagate(base);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [b] = unwrapped;

  // A negative exponent over a base that reaches BELOW 0 with an odd
  // denominator has a pole at the origin. The location is reported here
  // because the reciprocal below only sees a divisor that straddles 0, which
  // does not say where the pole is.
  if (q % 2 !== 0 && p < 0 && b.lo < 0 && b.hi >= 0)
    return { kind: 'singular', at: 0 };

  const root = nthRoot(ok(b), q);
  if (p >= 0) return pow(root, p);
  // A negative numerator is the reciprocal of the positive power. The division
  // is the rounded `div`, whose prover keeps an exact quotient exact, and it
  // reports the pole or the domain clip of a root that reaches 0.
  return div(POINT_ONE, pow(root, -p));
}

/**
 * An UPPER bound of `v^n` for a non-negative `v` and a positive integer `n`.
 *
 * The power is built by squaring, and every product that Dekker's TwoProduct
 * cannot certify as exact is moved one ulp up. A double multiplication is
 * correctly rounded, so the true product always lies between the two
 * neighbours of the computed one: one ulp is a proof here, and it is the only
 * arithmetic fact `rootEnclosure` rests on. A product that overflows answers
 * `Infinity`, which bounds the true value from above as well.
 */
function powChainUp(v: number, n: number): number {
  let acc = 1;
  let sq = v;
  let k = n;
  while (k > 0) {
    if (k % 2 === 1) {
      const p = acc * sq;
      acc = prodExact(acc, sq, p) ? p : nextUp(p);
    }
    k = Math.floor(k / 2);
    if (k > 0) {
      const p = sq * sq;
      sq = prodExact(sq, sq, p) ? p : nextUp(p);
    }
  }
  return acc;
}

/** A LOWER bound of `v^n`, by the same chain as `powChainUp` with every
 *  uncertified product moved one ulp down. An overflowed product answers
 *  `Number.MAX_VALUE`, which is below the true value it stands for. */
function powChainDown(v: number, n: number): number {
  let acc = 1;
  let sq = v;
  let k = n;
  while (k > 0) {
    if (k % 2 === 1) {
      const p = acc * sq;
      acc = prodExact(acc, sq, p) ? p : nextDown(p);
    }
    k = Math.floor(k / 2);
    if (k > 0) {
      const p = sq * sq;
      sq = prodExact(sq, sq, p) ? p : nextDown(p);
    }
  }
  return acc;
}

/** `v · 2^e`, in chunks because `2^e` is not a double for `|e| > 1023`. The
 *  scaling is exact for a normal result, and every chunk moves the value the
 *  same way, so no chunk can overflow or underflow when the answer is in
 *  range. */
function scalePow2(v: number, e: number): number {
  let r = v;
  let k = e;
  while (k > 1000) {
    r *= 2 ** 1000;
    k -= 1000;
  }
  while (k < -1000) {
    r *= 2 ** -1000;
    k += 1000;
  }
  return r * 2 ** k;
}

/** How many attempts an endpoint of `rootEnclosure` gets before the search
 *  gives up. The move DOUBLES at each attempt, so this covers 4095 ulps — and
 *  bounds the WORK at 4095 single-ulp moves, which is what keeps a degree
 *  whose product chain cannot be validated at all from stepping for hours.
 *  The scaled guess is within a few ulps of the root, so no ordinary operand
 *  uses more than three attempts; the fallback exists to make the loop
 *  provably finite. */
const MAX_ROOT_SEARCH_ATTEMPTS = 12;

/**
 * An enclosure of the real n-th root of a NON-NEGATIVE `v`, for a positive
 * integer degree `n`.
 *
 * `Math.pow(v, 1/n)` rounds the exponent `1/n` to a double, and
 * `v^(e+δ) = v^e·(1 + δ·ln v)`, so its error grows with `|ln v|`: at
 * `v = 10³⁰⁰` the cube root it answers is 65 ulps below the true one. No fixed
 * outward step bounds that. Two mechanisms replace the step:
 *
 * - The operand is first scaled to `|log₂ vs| ≤ n/2` by an exact power of two
 *   whose exponent is a MULTIPLE of the degree, so the root scales back by the
 *   exact `2^m`. Over that window the error of the rounded exponent is
 *   `|ln vs|/n ≤ 0.35` ulps whatever `n` and `v` were, so the guess is within
 *   an ulp or two of the root and the search below is short. The scaling also
 *   keeps the product chain away from the subnormals, where a product cannot
 *   be certified exact and every step of the chain would widen.
 * - Each endpoint is then VALIDATED rather than trusted: the lower one is
 *   moved down until an upper bound of `lo^n` is at or below `vs` (so
 *   `lo^n ≤ vs` and `lo` is at or below the true root), the upper one up until
 *   a lower bound of `hi^n` is at or above `vs`. The move doubles at each
 *   attempt, so an operand whose guess is far out is reached in a few
 *   attempts instead of one attempt per ulp.
 *
 * The validation accepts equality, which is what keeps an exact root exact:
 * the chain for `1³ = 1` is exact, so neither endpoint moves and
 * `nthRoot([8, 8], 3)` is the point 2.
 */
function rootEnclosure(v: number, n: number): Interval {
  // 0, +∞ and NaN are their own root, and the first degree is the identity.
  if (!(v > 0) || !Number.isFinite(v) || n === 1) return { lo: v, hi: v };

  // Scale the operand by `2^(n·m)`, which the root undoes by the exact `2^m`.
  // The window is `|log₂ vs| ≤ n/2`, so the scaled operand is a double for
  // every degree up to the bound below and the product chain stays normal. A
  // degree past it needs no scaling anyway: the error of the rounded exponent
  // is `|ln v|/n` ulps, which is under an ulp once the degree passes the 745
  // that the largest `|ln v|` of a double reaches.
  let m = 0;
  let vs = v;
  if (n <= 2000) {
    m = Math.round(Math.log2(v) / n);
    if (m !== 0) vs = scalePow2(v, -n * m);
  }

  const guess = Math.pow(vs, 1 / n);
  let lo = guess;
  let move = 1;
  for (let attempt = 0; powChainUp(lo, n) > vs; attempt++) {
    // Giving up is sound, not merely conservative: 0 is below every root of a
    // positive number, and `Infinity` is above every root.
    if (attempt >= MAX_ROOT_SEARCH_ATTEMPTS) {
      lo = 0;
      break;
    }
    for (let i = 0; i < move; i++) lo = nextDown(lo);
    move += move;
  }
  let hi = guess;
  move = 1;
  for (let attempt = 0; powChainDown(hi, n) < vs; attempt++) {
    if (attempt >= MAX_ROOT_SEARCH_ATTEMPTS) {
      hi = Infinity;
      break;
    }
    for (let i = 0; i < move; i++) hi = nextUp(hi);
    move += move;
  }
  if (m === 0) return { lo, hi };
  // One power of two for both endpoints. The exponent is at most half the
  // degree away from `log₂ v`, so it is a double, and the products are exact.
  const back = 2 ** m;
  return { lo: lo * back, hi: hi * back };
}

/** The lower end of the enclosure of the real n-th root of `x`, for an odd
 *  degree or a non-negative `x`. The root is an odd function of `x` for an odd
 *  degree, so a negative operand reads the OTHER end of the enclosure of its
 *  magnitude. */
function rootLow(x: number, n: number): number {
  return x < 0 ? -rootEnclosure(-x, n).hi : rootEnclosure(x, n).lo;
}

/** The upper end of the same enclosure. */
function rootHigh(x: number, n: number): number {
  return x < 0 ? -rootEnclosure(-x, n).lo : rootEnclosure(x, n).hi;
}

/**
 * Integer nth root on an interval (`Root(x, n)`).
 *
 * For ODD `n` the root is real for every real `x` and monotonically increasing,
 * so `[root(lo), root(hi)]` (matching the interpreter: `Root(-8, 3) = -2`). For
 * EVEN `n` it requires a non-negative base — a negative base has no real value
 * (`empty`/`partial`), as with `sqrt`.
 *
 * Each endpoint is a VALIDATED root (`rootEnclosure`), which is why this
 * routine takes no outward step at its export.
 */
function nthRootRaw(
  base: Interval | IntervalResult,
  n: number
): IntervalResult {
  const unwrapped = unwrapOrPropagate(base);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [b] = unwrapped;
  // A degree that is not a positive integer is not a root the validation can
  // certify: `v^(1/n)` is then an ordinary fractional power, and it goes to
  // the raw power for the one-outward-step-per-routine reason given in
  // `powIntervalRaw` above.
  if (!Number.isInteger(n) || n <= 0) return powRaw(ok(b), 1 / n);
  if (n % 2 === 0) {
    // Even degree: real only over the non-negative part of the base. The
    // shape of the answer is the one `pow` gives a fractional exponent.
    if (isNegative(b)) return { kind: 'empty' };
    if (b.lo < 0)
      return {
        kind: 'partial',
        value: { lo: 0, hi: rootHigh(b.hi, n) },
        domainClipped: 'lo',
      };
    return ok({ lo: rootLow(b.lo, n), hi: rootHigh(b.hi, n) });
  }
  // Odd degree: real everywhere, monotone increasing.
  return ok({ lo: rootLow(b.lo, n), hi: rootHigh(b.hi, n) });
}

/**
 * Exponential function (e^x).
 *
 * Always valid, monotonically increasing.
 */
function expRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  return ok({ lo: Math.exp(xVal.lo), hi: Math.exp(xVal.hi) });
}

/**
 * Natural logarithm.
 *
 * Domain: positive reals (x > 0)
 * - Entirely non-positive: empty
 * - Entirely positive: straightforward monotonic
 * - Contains/touches zero: partial with -Infinity lower bound
 */
function lnRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (isNaNInterval(xVal)) return ok(NAN_INTERVAL);
  // Case 1: Entirely non-positive - no valid values
  if (xVal.hi <= 0) {
    return { kind: 'empty' };
  }

  // Case 2: Entirely positive - straightforward
  if (xVal.lo > 0) {
    return ok({ lo: Math.log(xVal.lo), hi: Math.log(xVal.hi) });
  }

  // Case 3: Includes zero or negative values
  // ln(x) -> -Infinity as x -> 0+
  return {
    kind: 'partial',
    value: { lo: -Infinity, hi: Math.log(xVal.hi) },
    domainClipped: 'lo',
  };
}

/**
 * Base-10 logarithm.
 */
function log10Raw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (isNaNInterval(xVal)) return ok(NAN_INTERVAL);
  if (xVal.hi <= 0) {
    return { kind: 'empty' };
  }

  if (xVal.lo > 0) {
    return ok({ lo: Math.log10(xVal.lo), hi: Math.log10(xVal.hi) });
  }

  return {
    kind: 'partial',
    value: { lo: -Infinity, hi: Math.log10(xVal.hi) },
    domainClipped: 'lo',
  };
}

/**
 * Base-2 logarithm.
 */
function log2Raw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (isNaNInterval(xVal)) return ok(NAN_INTERVAL);
  if (xVal.hi <= 0) {
    return { kind: 'empty' };
  }

  if (xVal.lo > 0) {
    return ok({ lo: Math.log2(xVal.lo), hi: Math.log2(xVal.hi) });
  }

  return {
    kind: 'partial',
    value: { lo: -Infinity, hi: Math.log2(xVal.hi) },
    domainClipped: 'lo',
  };
}

/**
 * Absolute value of an interval.
 */
function absRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (isNaNInterval(xVal)) return ok(NAN_INTERVAL);
  if (xVal.lo >= 0) {
    return ok(xVal);
  }
  if (xVal.hi <= 0) {
    return ok({ lo: -xVal.hi, hi: -xVal.lo });
  }
  // Interval straddles zero - minimum is 0
  return ok({ lo: 0, hi: Math.max(-xVal.lo, xVal.hi) });
}

/**
 * Floor function (greatest integer <= x).
 *
 * Has jump discontinuities at every integer.
 */
function floorRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (isNaNInterval(xVal)) return ok(NAN_INTERVAL);
  const flo = Math.floor(xVal.lo);
  const fhi = Math.floor(xVal.hi);
  if (flo === fhi) return ok({ lo: flo, hi: fhi });
  // Interval spans an integer boundary — a finite jump. floor is
  // right-continuous: lim_{x→n+} floor(x) = floor(n) = n. Its values on the
  // interval lie in [floor(lo), floor(hi)], which is carried as the enclosure.
  return jump(flo + 1, 'right', { lo: flo, hi: fhi });
}

/**
 * Ceiling function (least integer >= x).
 *
 * Has jump discontinuities at every integer.
 */
function ceilRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (isNaNInterval(xVal)) return ok(NAN_INTERVAL);
  const clo = Math.ceil(xVal.lo);
  const chi = Math.ceil(xVal.hi);
  if (clo === chi) return ok({ lo: clo, hi: chi });
  // Interval spans an integer boundary — a finite jump. ceil is
  // left-continuous: lim_{x→n-} ceil(x) = ceil(n) = n. Its values on the
  // interval lie in [ceil(lo), ceil(hi)], which is carried as the enclosure.
  return jump(clo, 'left', { lo: clo, hi: chi });
}

// `isNaNInterval` and `NAN_INTERVAL` are defined near the top of this file:
// the domain-restricted kernels above the step functions use them too.

/**
 * Sound enclosure of a step-rounding function on an interval, given its
 * point-rounding rule. If both endpoints round to the same integer the function
 * is constant on the interval; otherwise it spans a half-integer jump and the
 * result is `singular` carrying the enclosure `[round(lo), round(hi)]`
 * (mirrors the Floor/Ceil enclosure discipline).
 *
 * The first jump is at `rlo + 0.5`. Continuity is derived from the rule itself
 * (`right` when the value at the jump matches the value just above it), so this
 * is correct for both half-away (Round) and half-toward-+∞ (Remainder) rules.
 */
function roundStep(
  x: Interval,
  pointRound: (n: number) => number
): IntervalResult {
  if (isNaNInterval(x)) return ok(NAN_INTERVAL);
  const rlo = pointRound(x.lo);
  const rhi = pointRound(x.hi);
  if (rlo === rhi) return ok({ lo: rlo, hi: rhi });
  const at = rlo + 0.5;
  return jump(at, pointRound(at) === rlo + 1 ? 'right' : 'left', {
    lo: Math.min(rlo, rhi),
    hi: Math.max(rlo, rhi),
  });
}

/**
 * Round to nearest integer, half away from zero.
 *
 * Matches the interpreter (Round(-2.5) = -3, Round(2.5) = 3), NOT JS
 * `Math.round` (half toward +∞). Round is a step function with jump
 * discontinuities at every half-integer (±0.5, ±1.5, …) and is continuous
 * through 0; an interval that stays within one step returns that constant
 * value, one that spans a half-integer returns `singular`.
 */
function roundRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  return roundStep(xVal, roundHalfAway);
}

/**
 * Fractional part: fract(x) = x - floor(x).
 *
 * Sawtooth function with discontinuities at every integer.
 */
function fractRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (isNaNInterval(xVal)) return ok(NAN_INTERVAL);
  const flo = Math.floor(xVal.lo);
  const fhi = Math.floor(xVal.hi);
  if (flo === fhi) {
    // No integer crossing — fract is continuous (linear)
    return ok({ lo: xVal.lo - flo, hi: xVal.hi - flo });
  }
  // Interval spans an integer — a sawtooth jump. fract is right-continuous
  // (inherits from floor). Across a jump the sawtooth takes every value in
  // [0, 1), so the enclosure is [0, 1].
  return jump(flo + 1, 'right', { lo: 0, hi: 1 });
}

/**
 * Truncate toward zero: trunc(x) = floor(x) for x >= 0, ceil(x) for x < 0.
 *
 * Has jump discontinuities at every non-zero integer.
 * Continuous at zero (unlike floor/ceil).
 * For positive values: right-continuous at discontinuities (like floor).
 * For negative values: left-continuous at discontinuities (like ceil).
 */
function truncRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (isNaNInterval(xVal)) return ok(NAN_INTERVAL);
  const tlo = Math.trunc(xVal.lo);
  const thi = Math.trunc(xVal.hi);
  if (tlo === thi) return ok({ lo: tlo, hi: thi });
  // Interval spans a jump. trunc is monotone, so its values on the interval
  // lie in [trunc(lo), trunc(hi)] — carried as the enclosure in every arm.
  const value = { lo: tlo, hi: thi };
  if (xVal.lo >= 0) {
    // Entirely non-negative: behaves like floor (right-continuous)
    return jump(tlo + 1, 'right', value);
  }
  // First integer in range (toward zero)
  const firstInt = Math.ceil(xVal.lo);
  if (firstInt !== 0) {
    // The first jump is at a negative integer, where trunc behaves like
    // ceil (left-continuous). This also covers an interval that spans zero
    // from at or below -1: its first jump is still the negative one.
    return jump(firstInt, 'left', value);
  }
  // Starts inside (-1, 0) and spans zero: trunc is continuous at 0, so the
  // first discontinuity is at +1 (right-continuous like floor)
  return jump(1, 'right', value);
}

/**
 * Minimum of two intervals.
 */
function minRaw(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [aVal, bVal] = unwrapped;
  return ok({
    lo: Math.min(aVal.lo, bVal.lo),
    hi: Math.min(aVal.hi, bVal.hi),
  });
}

/**
 * Maximum of two intervals.
 */
function maxRaw(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [aVal, bVal] = unwrapped;
  return ok({
    lo: Math.max(aVal.lo, bVal.lo),
    hi: Math.max(aVal.hi, bVal.hi),
  });
}

/**
 * Modulo (remainder) operation.
 *
 * Has sawtooth discontinuities at multiples of the modulus.
 * Uses Euclidean (mathematical) convention: result is non-negative for
 * positive modulus, even with negative dividends.
 *
 * Note: For non-point modulus intervals, uses `max(|lo|, |hi|)` as
 * a conservative approximation of the period. This may produce bounds
 * that are too narrow for wide modulus intervals.
 */
function modRaw(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [aVal, bVal] = unwrapped;
  if (isNaNInterval(aVal) || isNaNInterval(bVal)) return ok(NAN_INTERVAL);
  // Division by zero in mod
  if (containsZero(bVal)) {
    return { kind: 'singular' };
  }

  // Degenerate point dividend and divisor: return the exact floored value
  // (sign-of-divisor, D1). Handled up front so a point that sits exactly on a
  // period multiple of a *negative* divisor — where `Mod` is well-defined (0),
  // not spanning a jump — is not misreported as `singular` by the machinery
  // below.
  if (aVal.lo === aVal.hi && bVal.lo === bVal.hi) {
    const a0 = aVal.lo;
    const b0 = bVal.lo;
    // A non-finite operand has no floored modulo. The compiled scalar `Mod`
    // (`((a % b) + b) % b`) answers NaN for one, and this must answer the
    // same value.
    if (!Number.isFinite(a0) || !Number.isFinite(b0)) return ok(NAN_INTERVAL);
    // `a % b` is the IEEE remainder operation, which is exact — its result
    // needs no more bits than `a` has. When it already carries the sign of the
    // divisor it IS the floored modulo, and `+ 0` normalizes JS's `-0` (e.g.
    // `-3 % -3`) to `+0`.
    const r = a0 % b0;
    if (r === 0 || Math.sign(r) === Math.sign(b0))
      return ok({ lo: r + 0, hi: r + 0 });
    // Otherwise the sign correction `r + b` is the floored modulo, and THAT
    // addition can round: `-1e-20 % 1` is `-1e-20`, and `-1e-20 + 1` rounds
    // up to exactly 1, so the previous `((a % b) + b) % b` finished with
    // `1 % 1` and answered the point 0 for a true value of `1 - 1e-20`. No
    // outward step covers a miss that large. Knuth's TwoSum gives the exact
    // rounding error, and the enclosure is the computed sum together with the
    // neighbour it rounded away from.
    const s = r + b0;
    const bPart = s - r;
    const err = r - (s - bPart) + (b0 - bPart);
    if (err === 0) return ok({ lo: s, hi: s });
    return err < 0
      ? ok({ lo: nextDown(s), hi: s })
      : ok({ lo: s, hi: nextUp(s) });
  }

  const period = Math.abs(
    bVal.lo === bVal.hi
      ? bVal.lo
      : Math.max(Math.abs(bVal.lo), Math.abs(bVal.hi))
  );

  // The compiled scalar `Mod` (`((a % b) + b) % b`) uses the floored
  // (sign-of-divisor) convention: the result is in `[0, b)` for `b > 0` and
  // `(b, 0]` for `b < 0`. The divisor sign is determinate here (a `b`
  // straddling 0 returned `singular` above). The interval result must enclose
  // that scalar value — the previous `[0, |b|)` result did not for `b < 0`.
  const divisorNegative = bVal.hi < 0;

  // Check if interval crosses a period boundary
  const flo = Math.floor(aVal.lo / period);
  const fhi = Math.floor(aVal.hi / period);

  // Across a period boundary the sawtooth takes every value of one period:
  // [0, b) for a positive divisor, (b, 0] for a negative one. The closed hull
  // is the enclosure a jump carries.
  const wrapValue = divisorNegative
    ? { lo: -period, hi: 0 }
    : { lo: 0, hi: period };

  if (flo !== fhi) {
    // Interval spans a multiple of the period — a finite jump. mod has
    // sawtooth discontinuities, right-continuous.
    return jump((flo + 1) * period, 'right', wrapValue);
  }

  // No discontinuity — mod is continuous (linear) on this interval.
  // `modLo`/`modHi` are the Euclidean ([0, period)) values.
  const modLo = aVal.lo - period * flo;
  const modHi = aVal.hi - period * flo;

  if (divisorNegative) {
    // floored(a, b<0) = Euclidean(a, |b|) − |b|, except it is 0 at multiples
    // of |b| (a right-discontinuity). If `aVal.lo` sits on a multiple
    // (`modLo === 0`), the interval straddles that jump.
    if (modLo === 0) return jump(aVal.lo, 'right', wrapValue);
    return ok({ lo: modLo - period, hi: modHi - period });
  }

  return ok({ lo: Math.min(modLo, modHi), hi: Math.max(modLo, modHi) });
}

/**
 * IEEE remainder: remainder(a, b) = a - b * round(a / b).
 *
 * Composes division, rounding, multiplication, and subtraction.
 * Discontinuities arise from the `round` step when `a/b` spans
 * a half-integer boundary.
 */
function remainderRaw(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  // The UNROUNDED arithmetic kernels, so the three operations of the
  // composition are not each stepped outward before this routine's own export
  // steps its answer. `round` performs no rounding of its own, so the exported
  // form of it is used as it is — and it is the source of this routine's
  // discontinuities, which the unrounded kernels still propagate.
  return subUnrounded(a, mulUnrounded(b, round(divUnrounded(a, b))));
}

/**
 * Heaviside step function on an interval.
 *
 * H(x) = 0 for x < 0, 1/2 for x = 0, 1 for x > 0.
 * Has a jump discontinuity at 0.
 */
function heavisideRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  // A NaN bound propagates as a NaN interval (Contract B `propagate`,
  // ratified 2026-08-27) — the same value the plain arithmetic kernels
  // produce for a NaN input. Without this arm every comparison below is
  // false for NaN and the answer was `{ kind: 'singular', at: 0 }`, which
  // claims a discontinuity the input never touched.
  if (Number.isNaN(xVal.lo) || Number.isNaN(xVal.hi))
    return ok({ lo: NaN, hi: NaN });
  if (xVal.lo > 0) return ok({ lo: 1, hi: 1 });
  if (xVal.hi < 0) return ok({ lo: 0, hi: 0 });
  if (xVal.lo === 0 && xVal.hi === 0) return ok({ lo: 0.5, hi: 0.5 });
  // Interval reaches zero — a finite jump. Which values it takes depends on
  // the side it reaches zero from: an input with no negative part takes only
  // 1/2 and 1, one with no positive part only 0 and 1/2, and one that spans
  // zero all three. The two one-sided enclosures follow the engine's
  // convention that H(0) is 1/2 — the value the interpreter and every
  // compiled target answer — and would have to change with it; an engine
  // where H(0) were 1 would make the enclosures [1, 1] and [0, 1]. The
  // endpoints are exact doubles, so they need no outward step. A `lo` of -0
  // is the real zero and counts as "no negative part", which is what the
  // comparisons below already say.
  if (xVal.lo >= 0) return jump(0, undefined, { lo: 0.5, hi: 1 });
  if (xVal.hi <= 0) return jump(0, undefined, { lo: 0, hi: 0.5 });
  return jump(0, undefined, { lo: 0, hi: 1 });
}

/**
 * Sign function.
 *
 * Returns -1, 0, or 1 depending on the sign.
 * Has a jump discontinuity at 0.
 */
function signRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  // A NaN bound propagates, exactly as in `heaviside` above: every
  // comparison below is false for NaN, and the fall-through answered a
  // discontinuity at 0 that the input never touched.
  if (Number.isNaN(xVal.lo) || Number.isNaN(xVal.hi))
    return ok({ lo: NaN, hi: NaN });
  if (xVal.lo > 0) return ok({ lo: 1, hi: 1 });
  if (xVal.hi < 0) return ok({ lo: -1, hi: -1 });
  if (xVal.lo === 0 && xVal.hi === 0) return ok({ lo: 0, hi: 0 });
  // Interval reaches zero — a finite jump. Which values it takes depends on
  // the side it reaches zero from: an input with no negative part takes only
  // 0 and 1, one with no positive part only -1 and 0, and one that spans
  // zero all three. The three enclosures are exact integers, so they need no
  // outward step. A `lo` of -0 is the real zero and counts as "no negative
  // part", which is what the comparisons below already say.
  if (xVal.lo >= 0) return jump(0, undefined, { lo: 0, hi: 1 });
  if (xVal.hi <= 0) return jump(0, undefined, { lo: -1, hi: 0 });
  return jump(0, undefined, { lo: -1, hi: 1 });
}

// x coordinate of gamma's minimum: the positive root of digamma(x) = 0
const GAMMA_MIN_X = 1.4616321449683622;
// gamma(GAMMA_MIN_X) ≈ 0.8856031944108887
const GAMMA_MIN_Y = 0.8856031944108887;

// The scalar Γ, ln Γ and binomial kernels are not correctly rounded: their
// error is many ulps, more than the one-ulp outward step of `outward()`.
// Every scalar value an enclosure uses is therefore widened here by a bound
// on the kernel's relative error, in units of `Number.EPSILON`. The bounds
// were set against 50-digit values of `Gamma`/`Binomial` (`.N()` with
// `ce.precision = 50`) on 400 random points each (2026-09-30), and have a
// margin of at least 4 over the largest error measured:
// - `gamma(x)` for `x ≥ 0.5` (Lanczos and a product of up to 170 factors):
//   up to 311 ulps at `x ≈ 148.6`, roughly `2|x|`.
// - `gamma(x)` for `x < 0.5` goes through the reflection formula
//   `π / (sin(πx)·Γ(1 − x))`. Rounding `πx` moves the sine by about
//   `ε·π|x|`, a relative error of `ε·π|x| / |sin(πx)|`, which is large close
//   to a pole.
// - `binomial(n, k)`: up to 2611 ulps at `C(1043.1, 607.6)`, about 3.7 ulps
//   per unit of `|ln C|` (the log-Γ route), plus the error of the three Γ
//   values on the Γ-ratio route.
const GAMMA_SAFE_INTEGER_LIMIT = 19;

// A kernel value below this magnitude is treated as underflowed: its digits
// are not reliable, but the true value is known to be below this bound.
const UNDERFLOW_BOUND = 1e-280;

/** Bound on the relative error of `scalarGamma(x)`, in ulps. */
function gammaErrorUlps(x: number): number {
  const base = 256 + 8 * Math.abs(x);
  if (x >= 0.5) return base;
  return base + (16 * Math.PI * Math.abs(x)) / Math.abs(Math.sin(Math.PI * x));
}

/** `[v − r·|v|, v + r·|v|]` with `r = ulps·ε`, rounded outward. A
 *  non-finite `v` is returned as a point. */
function widenRelative(v: number, ulps: number): Interval {
  if (!Number.isFinite(v)) return { lo: v, hi: v };
  // `ulps · ε` first: `|v| · ulps` overflows for a `v` near the largest
  // double.
  const d = Math.abs(v) * (ulps * Number.EPSILON);
  return { lo: nextDown(v - d), hi: nextUp(v + d) };
}

/** An enclosure of `Γ(x)` at a point that is not a pole. `Γ` of a positive
 *  integer up to 19 is exact: the kernel multiplies integers below 2^53. */
function gammaPointEnclosure(x: number): Interval {
  const v = scalarGamma(x);
  if (Number.isInteger(x) && x > 0 && x <= GAMMA_SAFE_INTEGER_LIMIT)
    return { lo: v, hi: v };
  // Below about x = −171.6 the reflection formula divides by `Γ(1 − x)`,
  // which overflows, so the kernel returns `0` or a subnormal value with
  // no correct digits. The true value is still below `1e-280` there:
  // `|Γ(x)| = π / (|sin(πx)|·Γ(1 − x))` with `Γ(1 − x) > 1.7e308`, and
  // `|sin(πx)| > 1e-13` at every double this far from zero, because doubles
  // near 172 are 2.8e-14 apart. The enclosure keeps the sign of `Γ` on
  // the strip.
  if (x < 0 && Math.abs(v) < UNDERFLOW_BOUND)
    return Math.floor(x) % 2 === 0
      ? { lo: 0, hi: UNDERFLOW_BOUND }
      : { lo: -UNDERFLOW_BOUND, hi: 0 };
  return widenRelative(v, gammaErrorUlps(x));
}

/** An enclosure of `ln|Γ(x)|` at a point that is not a pole. The relative
 *  error of `Γ` becomes an absolute error of its logarithm, and the
 *  logarithm itself adds a relative error. */
function gammalnPointEnclosure(x: number): Interval {
  // `scalarGammaln` is defined for `x > 0` only. A negative `x` uses the
  // reflection formula `ln|Γ(x)| = ln π − ln|sin(πx)| − ln Γ(1 − x)`.
  const v =
    x > 0
      ? scalarGammaln(x)
      : Math.log(Math.PI) -
        Math.log(Math.abs(Math.sin(Math.PI * x))) -
        scalarGammaln(1 - x);
  if (!Number.isFinite(v)) return { lo: v, hi: v };
  const d = (gammaErrorUlps(x) + 16 * Math.abs(v)) * Number.EPSILON;
  return { lo: nextDown(v - d), hi: nextUp(v + d) };
}

/** An enclosure of `C(n, k)` at a point. A result at integer `n` and `k`
 *  below 2^53 is exact: the product loop of `binomial()` never forms an
 *  intermediate larger than its result. A `0` where a denominator `Γ`
 *  factor is on a pole (`k` or `n − k` a negative integer) is exact; any
 *  other `0` is a tiny value that underflowed. */
function binomialPointEnclosure(n: number, k: number): Interval {
  const v = scalarBinomial(n, k);
  if (v === 0) {
    const denominatorPole =
      (Number.isInteger(k) && k < 0) || (Number.isInteger(n - k) && n - k < 0);
    return denominatorPole ? { lo: 0, hi: 0 } : { lo: -1e-300, hi: 1e-300 };
  }
  if (Number.isInteger(n) && Number.isInteger(k) && Number.isSafeInteger(v))
    return { lo: v, hi: v };
  const ulps =
    512 +
    16 * Math.abs(Math.log(Math.abs(v))) +
    gammaErrorUlps(n + 1) +
    gammaErrorUlps(k + 1) +
    gammaErrorUlps(n - k + 1);
  return widenRelative(v, ulps);
}

/**
 * Gamma function on an interval.
 *
 * Gamma has poles at non-positive integers (0, -1, -2, ...) and
 * a unique minimum at x ≈ 1.4616 for positive x. Between consecutive
 * negative integers it is monotonic (but alternates direction).
 */
function gammaRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (isNaNInterval(xVal)) return ok(NAN_INTERVAL);
  return _gamma(xVal);
}

// Locations of the local extrema of gamma on the negative strips — the zeros
// of the digamma function. The extremum in strip (n, n+1) (n a negative
// integer) is at index (−n − 1). Gamma is NOT monotonic across a strip: it
// runs from ±∞ at one pole, through this interior extremum (the value closest
// to 0), back to ±∞ at the other pole — so the endpoints alone do not enclose
// the range.
const GAMMA_NEG_EXTREMA_X = [
  -0.504083008264455, -1.573498473162391, -2.610720868444145,
  -3.635293366436901, -4.653163765628266, -5.667162441556885,
  -6.678418213073426, -7.687788325031709, -8.695764163640955,
  -9.702672540001863,
];

/** Local-extremum location of gamma in the strip containing the negative,
 * pole-free interval [lo, hi], or `null` for strips past the table. */
function gammaNegStripExtremum(lo: number): number | null {
  const n = Math.floor(lo); // negative integer: the strip is (n, n+1)
  const idx = -n - 1;
  return idx >= 0 && idx < GAMMA_NEG_EXTREMA_X.length
    ? GAMMA_NEG_EXTREMA_X[idx]
    : null;
}

function _gamma(x: Interval): IntervalResult {
  // Check for poles: gamma has poles at every non-positive integer.
  // If the interval contains any non-positive integer, report singular.
  if (x.hi >= 0 && x.lo <= 0) {
    // The interval crosses or touches zero. `at` names the first pole: the
    // smallest non-positive integer in the interval.
    return { kind: 'singular', at: x.lo < 0 ? Math.ceil(x.lo) : 0 };
  }
  if (x.lo < 0) {
    // Entirely negative: check if interval spans a negative integer
    const ceilLo = Math.ceil(x.lo);
    const floorHi = Math.floor(x.hi);
    // If any integer in [ceil(lo), floor(hi)] is <= 0, there's a pole
    if (ceilLo <= floorHi) {
      return { kind: 'singular', at: ceilLo };
    }
    // No pole in interval, but gamma has one interior extremum on the strip.
    const gLo = gammaPointEnclosure(x.lo);
    const gHi = gammaPointEnclosure(x.hi);
    let lo = Math.min(gLo.lo, gHi.lo);
    let hi = Math.max(gLo.hi, gHi.hi);
    const xStar = gammaNegStripExtremum(x.lo);
    if (xStar !== null) {
      // Include the extremum if it lies within the interval.
      if (xStar >= x.lo && xStar <= x.hi) {
        const g = gammaPointEnclosure(xStar);
        lo = Math.min(lo, g.lo);
        hi = Math.max(hi, g.hi);
      }
    } else {
      // Past the table: the extremum value (closest to 0) has magnitude < 1e-3
      // and shrinks toward 0. Conservatively extend the near-zero bound to 0
      // (gamma keeps a constant sign on the strip, so only one side moves).
      const stripEven = Math.floor(x.lo) % 2 === 0; // gamma > 0 on even strips
      if (stripEven) lo = Math.min(lo, 0);
      else hi = Math.max(hi, 0);
    }
    return ok({ lo, hi });
  }

  // x.lo > 0: entirely positive

  // Case 1: Entirely above the minimum — monotonically increasing
  if (x.lo >= GAMMA_MIN_X) {
    return ok({
      lo: gammaPointEnclosure(x.lo).lo,
      hi: gammaPointEnclosure(x.hi).hi,
    });
  }

  // Case 2: Entirely below the minimum — monotonically decreasing
  if (x.hi <= GAMMA_MIN_X) {
    return ok({
      lo: gammaPointEnclosure(x.hi).lo,
      hi: gammaPointEnclosure(x.lo).hi,
    });
  }

  // Case 3: Interval crosses the minimum. The double `GAMMA_MIN_Y` is the
  // minimum rounded to nearest, so the double below it is a lower bound.
  return ok({
    lo: nextDown(GAMMA_MIN_Y),
    hi: Math.max(gammaPointEnclosure(x.lo).hi, gammaPointEnclosure(x.hi).hi),
  });
}

/**
 * Natural logarithm of the absolute value of the gamma function.
 *
 * gammaln(x) = ln(|gamma(x)|)
 *
 * Has the same poles as gamma (at non-positive integers), and approaches
 * +Infinity near each of them. For positive x, gammaln decreases up to the
 * minimum of Γ at `GAMMA_MIN_X` and increases after it.
 */
function gammalnRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (isNaNInterval(xVal)) return ok(NAN_INTERVAL);
  return _gammaln(xVal);
}

function _gammaln(x: Interval): IntervalResult {
  // Check for poles: gammaln has poles at every non-positive integer.
  if (x.hi >= 0 && x.lo <= 0) {
    // The interval crosses or touches zero. `at` names the first pole: the
    // smallest non-positive integer in the interval.
    return { kind: 'singular', at: x.lo < 0 ? Math.ceil(x.lo) : 0 };
  }
  if (x.lo < 0) {
    // Entirely negative: check if interval spans a negative integer
    const ceilLo = Math.ceil(x.lo);
    const floorHi = Math.floor(x.hi);
    // If any integer in [ceil(lo), floor(hi)] is <= 0, there's a pole
    if (ceilLo <= floorHi) {
      return { kind: 'singular', at: ceilLo };
    }
    // No pole in interval, but gammaln = ln|gamma| has one interior extremum
    // (a minimum, where |gamma| is smallest) on the strip.
    const gLo = gammalnPointEnclosure(x.lo);
    const gHi = gammalnPointEnclosure(x.hi);
    let lo = Math.min(gLo.lo, gHi.lo);
    const hi = Math.max(gLo.hi, gHi.hi);
    const xStar = gammaNegStripExtremum(x.lo);
    if (xStar !== null) {
      if (xStar >= x.lo && xStar <= x.hi)
        lo = Math.min(lo, gammalnPointEnclosure(xStar).lo);
    } else {
      // Past the table: |gamma| at the extremum → 0, so ln|gamma| → −∞.
      lo = -Infinity;
    }
    return ok({ lo, hi });
  }

  // x.lo > 0: entirely positive. ln Γ decreases up to `GAMMA_MIN_X` and
  // increases after it.
  const eLo = gammalnPointEnclosure(x.lo);
  const eHi = gammalnPointEnclosure(x.hi);
  if (x.lo >= GAMMA_MIN_X) return ok({ lo: eLo.lo, hi: eHi.hi });
  if (x.hi <= GAMMA_MIN_X) return ok({ lo: eHi.lo, hi: eLo.hi });
  // The interval contains the minimum. `ln` of the lower bound of Γ there
  // is a lower bound of ln Γ, widened for the rounding of `Math.log`.
  return ok({
    lo: nextDown(nextDown(Math.log(nextDown(GAMMA_MIN_Y)))),
    hi: Math.max(eLo.hi, eHi.hi),
  });
}

/**
 * Factorial on an interval, as `x! = Γ(x + 1)`. This is the real extension
 * the interpreter uses (`Factorial(2.5)` is `Γ(3.5) ≈ 3.323`), so a plot of
 * `x!` follows the Γ curve between the integers instead of rounding `x`.
 *
 * `Γ` has a pole at every non-positive integer, so `x!` has one at every
 * negative integer. The `Γ` enclosure (`gammaRaw()`) reports an interval that
 * contains a pole as `singular`; its `at` is moved back by 1 to name the
 * pole's location in `x`.
 */
function factorialRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  // `x + 1` rounded outward, so the shifted interval holds every `x + 1`.
  const result = gammaRaw(addOutward(xVal, point(1)));
  if (result.kind === 'singular' && result.at !== undefined)
    return { ...result, at: result.at - 1 };
  return result;
}

/**
 * Double factorial on an interval.
 */
function factorial2Raw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (xVal.lo < 0) return { kind: 'empty' };
  const fLo = scalarFactorial2(Math.round(xVal.lo));
  const fHi = scalarFactorial2(Math.round(xVal.hi));
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi))
    return ok({ lo: Math.min(fLo, fHi), hi: Math.max(fLo, fHi) });
  return ok({ lo: fLo, hi: fHi });
}

// Cap on the number of integer grid points enumerated for the integer-valued
// interval functions below. Plotting subdivides domains finely, so the rounded
// integer width of an interval is normally tiny; this bound only guards against
// pathologically wide inputs.
const MAX_INT_ENUM_POINTS = 4096;

/** Integer points in [round(lo), round(hi)], or `null` if wider than `cap`. */
function integerPoints(lo: number, hi: number, cap: number): number[] | null {
  const a = Math.round(lo);
  const b = Math.round(hi);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // Past the safe-integer range `i++` cannot advance (`2^53 + 1 === 2^53`),
  // so the enumeration below would never end.
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return null;
  if (b - a + 1 > cap) return null;
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/**
 * Tight enclosure of an integer-valued binary function over the integer grid
 * spanned by two intervals, by enumerating every grid point. Returns `null`
 * when the grid is too large to enumerate (caller supplies a conservative
 * fallback). Corner sampling is unsound here: these functions are not monotone
 * in their arguments, so interior points (e.g. `C(10, 5)`) are the extrema.
 */
function enumerateInteger2(
  a: Interval,
  b: Interval,
  f: (x: number, y: number) => number
): IntervalResult | null {
  const xs = integerPoints(a.lo, a.hi, MAX_INT_ENUM_POINTS);
  const ys = integerPoints(b.lo, b.hi, MAX_INT_ENUM_POINTS);
  if (!xs || !ys || xs.length * ys.length > MAX_INT_ENUM_POINTS) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of xs)
    for (const y of ys) {
      const v = f(x, y);
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  if (lo === Infinity) return null;
  return ok({ lo, hi });
}

/**
 * Largest literal integer `k` for which `binomialRaw()` encloses
 * `C(n, k)` over an `n` interval below `k − 1` with the falling factorial.
 * Each factor is one outward-rounded interval product, so the cost grows
 * with `k`; the limit is the same as `MAX_INT_ENUM_POINTS`, the largest
 * number of scalar evaluations the other kernels of this file do. Above it,
 * the `Γ` product is used, which has no bound where `Γ` overflows or where
 * the `n` interval contains a negative integer.
 */
const BINOMIAL_FALLING_FACTORIAL_LIMIT = 4096;

/**
 * An enclosure of `1/Γ(x)` over the interval `x`, or `undefined` when it
 * has no bound. `1/Γ` is an entire function: it has no pole, and it is `0`
 * at each non-positive integer, where `Γ` has its poles.
 *
 * - Where the `Γ` enclosure (`_gamma()`) has one sign, the reciprocal of
 *   its bounds. An upper bound of `Γ` that overflowed is replaced by the
 *   largest double, and a lower bound that overflowed means `1/Γ` is below
 *   `1e-300`.
 * - Otherwise (the interval contains a pole of `Γ`, or the `Γ` enclosure
 *   reaches `0`): `|1/Γ(x)|` is below `1/0.8856` for `x > 0`, because the
 *   smallest value of `Γ` on the positive axis is `0.8856` at `x ≈ 1.4616`.
 *   For `x < 0`, the reflection formula `1/Γ(x) = sin(πx)·Γ(1 − x)/π`
 *   bounds it by `Γ(1 − x)/π`. On `[1, 1 − lo]`, `Γ` is largest at an end:
 *   `Γ(1) = 1` or `Γ(1 − lo)`.
 */
function reciprocalGammaEnclosure(x: Interval): Interval | undefined {
  const g = _gamma(x);
  if (g.kind === 'interval' && (g.value.lo > 0 || g.value.hi < 0)) {
    const { lo, hi } = g.value;
    return {
      lo: Number.isFinite(hi) ? nextDown(1 / hi) : lo > 0 ? 0 : -1e-300,
      hi: Number.isFinite(lo) ? nextUp(1 / lo) : hi < 0 ? 0 : 1e-300,
    };
  }
  let m = nextUp(1 / nextDown(GAMMA_MIN_Y));
  if (x.lo < 0) {
    const reflected = gammaPointEnclosure(nextUp(1 - x.lo)).hi;
    if (!Number.isFinite(reflected)) return undefined;
    m = Math.max(m, nextUp(Math.max(1, reflected) / Math.PI) * (1 + 1e-15));
  }
  return { lo: -m, hi: m };
}

/**
 * `C(n, k) = Γ(n+1) · (1/Γ(k+1)) · (1/Γ(n−k+1))` over the intervals `n` and
 * `k`, with each factor enclosed separately. The arguments are formed with
 * outward rounding. Sound for every `n` and `k`, but wider than the true
 * range, because `k` appears in two factors; a plot refines it by splitting
 * the interval.
 *
 * - A pole of `Γ(n+1)` inside the `n` interval, at a negative integer
 *   `n = −m`: when `k` is not an integer point, the box holds a point
 *   `(−m, k)` with a non-integer `k`, where `Γ(k+1)` and `Γ(n−k+1)` are
 *   finite and `C` has a pole. The result is `singular` at the first pole.
 *   With an integer point `k` the poles cancel to a finite value
 *   (`C(−3, 2) = 6`); the product has no bound for that, and the result is
 *   the whole real line (`binomialRaw()` uses the falling factorial for
 *   an integer `k` up to `BINOMIAL_FALLING_FACTORIAL_LIMIT`).
 * - `Γ(n+1)` that overflows, or a `1/Γ` with no bound: the whole real line.
 */
function binomialGammaProduct(nVal: Interval, kVal: Interval): IntervalResult {
  const nPlus1 = addOutward(nVal, point(1));
  const numerator = gammaRaw(nPlus1);
  if (numerator.kind === 'singular') {
    if (kVal.lo === kVal.hi && Number.isInteger(kVal.lo))
      return { kind: 'entire' };
    return numerator.at === undefined
      ? { kind: 'singular' }
      : { kind: 'singular', at: numerator.at - 1 };
  }
  const g = getValue(numerator);
  if (!g || !Number.isFinite(g.lo) || !Number.isFinite(g.hi))
    return { kind: 'entire' };
  const kPlus1 = getValue(addOutward(kVal, point(1)));
  const nkPlus1 = getValue(subOutward(nPlus1, kVal));
  if (!kPlus1 || !nkPlus1) return { kind: 'entire' };
  const rk = reciprocalGammaEnclosure(kPlus1);
  const rnk = reciprocalGammaEnclosure(nkPlus1);
  if (!rk || !rnk) return { kind: 'entire' };
  return mulOutward(mulOutward(g, rk), rnk);
}

/**
 * Binomial coefficient `C(n, k) = Γ(n+1)/(Γ(k+1)·Γ(n−k+1))` on intervals,
 * for real operands, as the interpreter and the JS target define it
 * (`binomial()` in `numerics/special-functions.ts`).
 *
 * - Both operands a point: the scalar value. At a pole of `Γ(n+1)` (a
 *   negative integer `n` with a non-integer `k`) the result is `singular`.
 * - `k` a point at a non-negative integer: `C(n, k)` is the polynomial
 *   `n(n−1)⋯(n−k+1)/k!` in `n`. For `n ≥ k − 1` it increases with `n`, and
 *   the values at the two ends enclose it. Below that, it is enclosed by
 *   interval arithmetic on the factors `(n − i)/(i + 1)`. Each step rounds
 *   outward, so the enclosure is sound; it is wider than the true range when
 *   the interval contains a root of the polynomial, because `n` appears in
 *   every factor.
 * - `k` a point at a negative integer: `C(n, k)` is `0` for every non-integer
 *   `n`. At a negative integer `n ≥ k` the poles of `Γ(n+1)` and `Γ(k+1)`
 *   cancel and the value is not `0` (`C(−3, −5) = 6`), so the result is a
 *   jump whose value encloses `0` and the values at those integers.
 * - `k` a point that is not an integer: where `n + 1` and `n − k + 1` are
 *   positive, the values at the two ends of `n` (`C` is monotone in `n`
 *   there); elsewhere the `Γ` product below.
 * - `k` an interval, with `n > −1`, `k > −1` and `n − k > −1` over the box:
 *   `C` is monotone in `n` and log-concave in `k`, so a few point values
 *   give its range (see the comment in the code).
 * - Any other case: the product `Γ(n+1) · (1/Γ(k+1)) · (1/Γ(n−k+1))` of
 *   interval enclosures (`binomialGammaProduct()`). It is sound but wider
 *   than the true range, because `k` appears in two factors.
 *
 * Every scalar value is widened by a bound on the kernel's error
 * (`binomialPointEnclosure()`).
 */
function binomialRaw(
  n: Interval | IntervalResult,
  k: Interval | IntervalResult
): IntervalResult {
  const uN = unwrapOrPropagate(n);
  if (!Array.isArray(uN)) return uN;
  const uK = unwrapOrPropagate(k);
  if (!Array.isArray(uK)) return uK;
  const [nVal] = uN;
  const [kVal] = uK;
  if (isNaNInterval(nVal) || isNaNInterval(kVal)) return ok(NAN_INTERVAL);
  if (kVal.lo !== kVal.hi) {
    // Where `n > −1`, `k > −1` and `n − k > −1` over the whole box, the three
    // `Γ` arguments are positive and `C(n, k)` is positive. Two facts give
    // its range from a few point values:
    // - For a fixed `n`, `ln Γ` is convex, so `ln C(n, k)` is concave in `k`:
    //   `C` is smallest at an end of the `k` interval and largest at the `k`
    //   nearest `n/2`, where it is symmetric.
    // - For a fixed `k`, `d/dn ln C(n, k) = ψ(n+1) − ψ(n−k+1)` has the sign
    //   of `k`, because the digamma function `ψ` increases. So for `k ≥ 0`,
    //   `C` is largest at the top of the `n` interval and smallest at the
    //   bottom; for `k < 0` the other way round.
    // The `k` interval is split at `0` and the two parts are joined. The
    // `1e-9` margin keeps the rounded differences away from the boundary.
    if (
      nVal.lo > -1 + 1e-9 &&
      kVal.lo > -1 + 1e-9 &&
      nVal.lo - kVal.hi > -1 + 1e-9
    ) {
      let lo = Infinity;
      let hi = -Infinity;
      const part = (nMax: number, nMin: number, kLo: number, kHi: number) => {
        const kPeak = Math.min(Math.max(nMax / 2, kLo), kHi);
        hi = Math.max(hi, binomialPointEnclosure(nMax, kPeak).hi);
        lo = Math.min(
          lo,
          binomialPointEnclosure(nMin, kLo).lo,
          binomialPointEnclosure(nMin, kHi).lo
        );
      };
      if (kVal.hi >= 0) part(nVal.hi, nVal.lo, Math.max(kVal.lo, 0), kVal.hi);
      if (kVal.lo < 0) part(nVal.lo, nVal.hi, kVal.lo, Math.min(kVal.hi, 0));
      // An overflow is a finite value above the largest double.
      return ok({ lo: lo === Infinity ? Number.MAX_VALUE : lo, hi });
    }
    return binomialGammaProduct(nVal, kVal);
  }
  const kPoint = kVal.lo;

  if (nVal.lo === nVal.hi) {
    const nPoint = nVal.lo;
    if (Number.isInteger(nPoint) && nPoint < 0 && !Number.isInteger(kPoint))
      return { kind: 'singular', at: nPoint };
    const v = binomialPointEnclosure(nPoint, kPoint);
    // An infinite value is an overflow (a finite value above the largest
    // double) or the limit at an infinite operand; the enclosures below hold
    // both.
    if (v.hi === Infinity) return ok({ lo: Number.MAX_VALUE, hi: Infinity });
    if (v.lo === -Infinity) return ok({ lo: -Infinity, hi: -Number.MAX_VALUE });
    return ok(v);
  }

  if (!Number.isInteger(kPoint)) {
    // Where `n + 1` and `n − k + 1` are both positive over the interval,
    // `d/dn ln|C(n, k)| = ψ(n+1) − ψ(n−k+1)` has the sign of `k` because the
    // digamma function `ψ` increases, and the sign of `C(n, k)` is the sign
    // of `Γ(k+1)`. So `C(n, k)` is monotone in `n` and the values at the two
    // ends enclose it. The scalar kernel computes large values in log form,
    // where the `Γ` values below overflow. The `1e-9` margin keeps the
    // rounded differences away from the boundary `−1`.
    if (nVal.lo > -1 + 1e-9 && nVal.lo - kPoint > -1 + 1e-9) {
      const atLo = binomialPointEnclosure(nVal.lo, kPoint);
      const atHi = binomialPointEnclosure(nVal.hi, kPoint);
      return ok({
        lo: Math.min(atLo.lo, atHi.lo),
        hi: Math.max(atLo.hi, atHi.hi),
      });
    }
    return binomialGammaProduct(nVal, kVal);
  }

  if (kPoint >= 0) {
    // For `n ≥ k − 1` every factor `n − i` (`i < k`) is non-negative and
    // increases with `n`, so `C(n, k)` increases with `n` and the values at
    // the two ends enclose it. The scalar kernel computes them in log form,
    // with no overflow in the partial products of the loop below.
    if (nVal.lo >= kPoint - 1) {
      const atLo = binomialPointEnclosure(nVal.lo, kPoint);
      const atHi = binomialPointEnclosure(nVal.hi, kPoint);
      // An overflow is a finite value above the largest double.
      return ok({
        lo: atLo.lo === Infinity ? Number.MAX_VALUE : atLo.lo,
        hi: atHi.hi,
      });
    }
    if (kPoint > BINOMIAL_FALLING_FACTORIAL_LIMIT)
      return binomialGammaProduct(nVal, kVal);
    let product: IntervalResult = ok({ lo: 1, hi: 1 });
    for (let i = 0; i < kPoint; i++) {
      const factor = div(subOutward(nVal, point(i)), point(i + 1));
      product = mulOutward(product, factor);
      // A partial product `C(n, i + 1)` can be far larger than `C(n, k)`.
      // Once a bound overflows, the later factors (below 1 in size) cannot
      // bring it back, and the result would exclude the true value. An
      // infinite bound that comes from an infinite `n` is not an overflow.
      const v = getValue(product);
      if (
        Number.isFinite(nVal.lo) &&
        Number.isFinite(nVal.hi) &&
        (!v || !Number.isFinite(v.lo) || !Number.isFinite(v.hi))
      )
        return { kind: 'entire' };
    }
    return product;
  }

  // A negative integer `k`: `0`, plus the values at the negative integers
  // `n` with `k ≤ n ≤ −1`, where the two poles cancel.
  const lo = Math.max(Math.ceil(nVal.lo), kPoint);
  const hi = Math.min(Math.floor(nVal.hi), -1);
  let min = 0;
  let max = 0;
  let firstNonZero: number | undefined;
  if (hi - lo > MAX_INT_ENUM_POINTS) return { kind: 'entire' };
  for (let m = lo; m <= hi; m++) {
    const v = binomialPointEnclosure(m, kPoint);
    if (v.lo === 0 && v.hi === 0) continue;
    firstNonZero ??= m;
    if (v.lo < min) min = v.lo;
    if (v.hi > max) max = v.hi;
  }
  // The values at those integers are isolated points of a function that is
  // `0` around them: a discontinuity, reported as a jump at the first one.
  if (firstNonZero === undefined) return ok({ lo: 0, hi: 0 });
  return jump(firstNonZero, undefined, { lo: min, hi: max });
}

/**
 * GCD on intervals. Both arguments rounded to nearest integer.
 *
 * gcd is not monotone (e.g. gcd(6, 5) = 1 sits between gcd(6, 6) = 6 and
 * gcd(6, 4) = 2), so the enclosure enumerates the integer grid.
 */
function gcdRaw(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const uA = unwrapOrPropagate(a);
  if (!Array.isArray(uA)) return uA;
  const uB = unwrapOrPropagate(b);
  if (!Array.isArray(uB)) return uB;
  const [aVal] = uA;
  const [bVal] = uB;
  const enumerated = enumerateInteger2(aVal, bVal, scalarGcd);
  if (enumerated) return enumerated;
  // Conservative fallback: 0 ≤ gcd(a, b) ≤ max(|a|, |b|).
  const m = Math.max(
    Math.abs(Math.round(aVal.lo)),
    Math.abs(Math.round(aVal.hi)),
    Math.abs(Math.round(bVal.lo)),
    Math.abs(Math.round(bVal.hi))
  );
  return ok({ lo: 0, hi: m });
}

/**
 * LCM on intervals. Both arguments rounded to nearest integer.
 *
 * lcm is not monotone (e.g. lcm(2, 5) = 10 exceeds lcm(2, 6) = 6), so the
 * enclosure enumerates the integer grid.
 */
function lcmRaw(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const uA = unwrapOrPropagate(a);
  if (!Array.isArray(uA)) return uA;
  const uB = unwrapOrPropagate(b);
  if (!Array.isArray(uB)) return uB;
  const [aVal] = uA;
  const [bVal] = uB;
  const enumerated = enumerateInteger2(aVal, bVal, scalarLcm);
  if (enumerated) return enumerated;
  // Conservative fallback: 0 ≤ lcm(a, b) ≤ |a|·|b|.
  const ma = Math.max(
    Math.abs(Math.round(aVal.lo)),
    Math.abs(Math.round(aVal.hi))
  );
  const mb = Math.max(
    Math.abs(Math.round(bVal.lo)),
    Math.abs(Math.round(bVal.hi))
  );
  return ok({ lo: 0, hi: ma * mb });
}

/**
 * Chop: replace small values with zero.
 * Monotonic (identity except near zero), so endpoint evaluation yields the
 * exact hull of the pointwise image and containment is preserved.
 * `tolerance` is baked in by the compile target (the engine's configured
 * `ce.tolerance`, matching the interpreter's `Chop`); it defaults to the
 * scalar chop's static default.
 */
function chopRaw(
  x: Interval | IntervalResult,
  tolerance?: number
): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  return ok({
    lo: scalarChop(xVal.lo, tolerance),
    hi: scalarChop(xVal.hi, tolerance),
  });
}

/**
 * Error function on an interval.
 * erf is monotonically increasing, so evaluate at endpoints.
 */
function erfRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  return ok({ lo: scalarErf(xVal.lo), hi: scalarErf(xVal.hi) });
}

/**
 * Complementary error function on an interval.
 * erfc is monotonically decreasing, so swap endpoints.
 */
function erfcRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  // erfc is decreasing: erfc(lo) >= erfc(hi)
  return ok({ lo: scalarErfc(xVal.hi), hi: scalarErfc(xVal.lo) });
}

/**
 * 2^x on an interval. Monotonically increasing.
 */
function exp2Raw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  return ok({ lo: Math.pow(2, xVal.lo), hi: Math.pow(2, xVal.hi) });
}

/**
 * Hypot(x, y) = sqrt(x^2 + y^2) on intervals.
 * Always non-negative, evaluate four corners.
 */
function hypotRaw(
  x: Interval | IntervalResult,
  y: Interval | IntervalResult
): IntervalResult {
  const uX = unwrapOrPropagate(x);
  if (!Array.isArray(uX)) return uX;
  const uY = unwrapOrPropagate(y);
  if (!Array.isArray(uY)) return uY;
  const [xVal] = uX;
  const [yVal] = uY;
  const vals = [
    Math.hypot(xVal.lo, yVal.lo),
    Math.hypot(xVal.lo, yVal.hi),
    Math.hypot(xVal.hi, yVal.lo),
    Math.hypot(xVal.hi, yVal.hi),
  ];
  // Hypot can be smaller at interior points if intervals straddle zero
  let lo = Math.min(...vals);
  if (xVal.lo <= 0 && xVal.hi >= 0)
    lo = Math.min(lo, Math.abs(yVal.lo), Math.abs(yVal.hi));
  if (yVal.lo <= 0 && yVal.hi >= 0)
    lo = Math.min(lo, Math.abs(xVal.lo), Math.abs(xVal.hi));
  if (xVal.lo <= 0 && xVal.hi >= 0 && yVal.lo <= 0 && yVal.hi >= 0) lo = 0;
  return ok({ lo, hi: Math.max(...vals) });
}

// Every operation above is exported through `liftJump` so that a finite
// jump in an operand (a `singular` result carrying a `value`) is re-tagged
// on the result instead of being forgotten — see `liftJump` in `util.ts`.
//
// Every operation that ROUNDS is also exported through an outward decorator,
// so the enclosure it answers contains the true range instead of a
// round-to-nearest approximation of it — see `rounding.ts`. `sqrt`, `square`
// and the powers carry a prover, so an exact result (`√4`, `2²`, `(−1)^k`)
// stays the point it is. The routines that only select, negate or truncate
// endpoints compute no new real number and are exported unwrapped: `abs`,
// `floor`, `ceil`, `round`, `trunc`, `fract` (`x − floor(x)` has fewer
// significant bits than `x`, so a double holds it), `min`, `max`, `sign`,
// `heaviside` and `chop`.
export const sqrt = liftJump(outwardUnlessExact(sqrtRaw, exactSqrt));
export const square = liftJump(outwardUnlessExact(squareRaw, exactSquare));
export const pow = liftJump(outwardUnlessExact(powRaw, exactPow));
export const powInterval = liftJump(
  outwardUnlessExact(powIntervalRaw, exactPowInterval)
);
// `nthRoot` and `powRational` take NO step at their export, and are the two
// exceptions to the one-step-per-routine rule. Both answer an enclosure that
// is already a proof:
//
// - `nthRoot` VALIDATES each endpoint against the operand instead of trusting
//   `Math.pow(|x|, 1/n)`, whose error grows with `|ln x|` and which no fixed
//   step bounds (see `rootEnclosure`). An exact root is reproduced exactly by
//   the validation, so `nthRoot([4, 4], 2)` is the point 2 and the exact lower
//   bound 0 of `nthRoot([0, 8], 3)` stays 0.
// - `powRational` is built from the ROUNDED `nthRoot`, `pow` and `div` — see
//   the comment on `powRationalRaw` for why a step at its export cannot bound
//   its error.
export const powRational = liftJump(powRationalRaw);
export const nthRoot = liftJump(nthRootRaw);
export const exp = liftJump(
  outwardUnlessExact(expRaw, exactInRange(0, Infinity))
);
// A logarithm of 1 is exactly 0, and an integer-base logarithm of an exact
// power of its base is exactly that power. Widening those endpoints turned
// `ln([1, 1])` into `[-5e-324, 5e-324]`, which a later `sqrt` reports as a
// domain-clipped `partial`, and lost the integer points of `log2` and
// `log10`.
export const ln = liftJump(outwardUnlessExact(lnRaw, exactLog()));
export const log10 = liftJump(outwardUnlessExact(log10Raw, exactLog(10)));
export const log2 = liftJump(outwardUnlessExact(log2Raw, exactLog(2)));
export const abs = liftJump(absRaw);
export const floor = liftJump(floorRaw);
export const ceil = liftJump(ceilRaw);
export const round = liftJump(roundRaw);
export const fract = liftJump(fractRaw);
export const trunc = liftJump(truncRaw);
export const min = liftJump(minRaw);
export const max = liftJump(maxRaw);
export const mod = liftJump(
  outwardUnlessExact(
    modRaw,
    eitherExact(exactIntegerGridPoint, exactAtZeroBound)
  )
);
// `remainder` composes a division, a rounding, a multiplication and a
// subtraction. The `round` is exact, the other three each round once, so three
// ulps is the step for the whole chain.
export const remainder = liftJump(
  outwardUnlessExact(remainderRaw, exactIntegerGridPoint, 3)
);
export const heaviside = liftJump(heavisideRaw);
export const sign = liftJump(signRaw);
export const gamma = liftJump(outward(gammaRaw));
export const gammaln = liftJump(outward(gammalnRaw));
export const factorial = liftJump(
  outwardUnlessExact(factorialRaw, exactIntegerGridPoint)
);
export const factorial2 = liftJump(
  outwardUnlessExact(factorial2Raw, exactIntegerGridPoint)
);
export const binomial = liftJump(
  outwardUnlessExact(binomialRaw, exactIntegerGridPoint)
);
export const gcd = liftJump(outwardUnlessExact(gcdRaw, exactIntegerGridPoint));
export const lcm = liftJump(outwardUnlessExact(lcmRaw, exactIntegerGridPoint));
export const chop = liftJump(chopRaw);
export const erf = liftJump(
  outwardUnlessExact(erfRaw, eitherExact(exactAtOrigin, exactInRange(-1, 1)))
);
export const erfc = liftJump(outwardUnlessExact(erfcRaw, exactInRange(0, 2)));
export const exp2 = liftJump(
  outwardUnlessExact(
    exp2Raw,
    eitherExact(exactIntegerGridPoint, exactInRange(0, Infinity))
  )
);
// `Math.hypot` is allowed by the language specification to be approximated,
// and it scales, sums and takes a root internally, so one ulp would not cover
// it.
export const hypot = liftJump(
  outwardUnlessExact(hypotRaw, exactInRange(0, Infinity), 2)
);
