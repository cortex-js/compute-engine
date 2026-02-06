/**
 * Elementary interval functions (sqrt, pow, exp, ln, abs, floor, ceil, min, max, mod)
 *
 * @module interval/elementary
 */

import type { Interval, IntervalResult } from './types';
import {
  ok,
  containsZero,
  isNegative,
  isNonNegative,
  isPositive,
  unwrapOrPropagate,
} from './util';

/**
 * Square root of an interval (or IntervalResult).
 *
 * - Entirely negative: empty (no real values)
 * - Entirely non-negative: straightforward monotonic
 * - Straddles zero: partial result with lower bound clipped
 */
export function sqrt(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
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
export function square(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
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
export function pow(
  base: Interval | IntervalResult,
  exp: number
): IntervalResult {
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
export function powInterval(
  base: Interval | IntervalResult,
  exp: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(base, exp);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [baseVal, expVal] = unwrapped;
  // For real-valued results, base must be positive
  if (baseVal.hi <= 0) {
    return { kind: 'empty' };
  }
  if (baseVal.lo <= 0) {
    // Straddles or touches zero - complex behavior
    // For safety, restrict to positive part
    const posBase = {
      lo: Math.max(baseVal.lo, Number.EPSILON),
      hi: baseVal.hi,
    };
    const corners = [
      Math.pow(posBase.lo, expVal.lo),
      Math.pow(posBase.lo, expVal.hi),
      Math.pow(posBase.hi, expVal.lo),
      Math.pow(posBase.hi, expVal.hi),
    ];
    return {
      kind: 'partial',
      value: { lo: Math.min(...corners), hi: Math.max(...corners) },
      domainClipped: 'lo',
    };
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

/**
 * Exponential function (e^x).
 *
 * Always valid, monotonically increasing.
 */
export function exp(x: Interval | IntervalResult): IntervalResult {
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
export function ln(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
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
export function log10(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
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
export function log2(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
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
export function abs(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
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
export function floor(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  const flo = Math.floor(xVal.lo);
  const fhi = Math.floor(xVal.hi);
  if (flo === fhi) return ok({ lo: flo, hi: fhi });
  // Interval spans an integer boundary — discontinuity
  // floor is right-continuous: lim_{x→n+} floor(x) = floor(n) = n
  return { kind: 'singular', at: flo + 1, continuity: 'right' };
}

/**
 * Ceiling function (least integer >= x).
 *
 * Has jump discontinuities at every integer.
 */
export function ceil(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  const clo = Math.ceil(xVal.lo);
  const chi = Math.ceil(xVal.hi);
  if (clo === chi) return ok({ lo: clo, hi: chi });
  // Interval spans an integer boundary — discontinuity
  // ceil is left-continuous: lim_{x→n-} ceil(x) = ceil(n) = n
  return { kind: 'singular', at: clo, continuity: 'left' };
}

/**
 * Round to nearest integer.
 *
 * Has jump discontinuities at every half-integer.
 *
 * Note: JS `Math.round` uses round-half-up, while GLSL `round()` uses
 * IEEE 754 round-half-to-even. They differ only AT half-integer values.
 * For discontinuity detection this is safe because any interval spanning
 * a half-integer returns `singular` regardless of the rounding convention.
 */
export function round(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  const rlo = Math.round(xVal.lo);
  const rhi = Math.round(xVal.hi);
  if (rlo === rhi) return ok({ lo: rlo, hi: rhi });
  // Interval spans a half-integer boundary — discontinuity
  // round is right-continuous (with round-half-up convention)
  return { kind: 'singular', at: rlo + 0.5, continuity: 'right' };
}

/**
 * Fractional part: fract(x) = x - floor(x).
 *
 * Sawtooth function with discontinuities at every integer.
 */
export function fract(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  const flo = Math.floor(xVal.lo);
  const fhi = Math.floor(xVal.hi);
  if (flo === fhi) {
    // No integer crossing — fract is continuous (linear)
    return ok({ lo: xVal.lo - flo, hi: xVal.hi - flo });
  }
  // Interval spans an integer — sawtooth discontinuity
  // fract is right-continuous (inherits from floor)
  return { kind: 'singular', at: flo + 1, continuity: 'right' };
}

/**
 * Minimum of two intervals.
 */
export function min(
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
export function max(
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
export function mod(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [aVal, bVal] = unwrapped;
  // Division by zero in mod
  if (containsZero(bVal)) {
    return { kind: 'singular' };
  }

  const period = Math.abs(
    bVal.lo === bVal.hi
      ? bVal.lo
      : Math.max(Math.abs(bVal.lo), Math.abs(bVal.hi))
  );

  // Check if interval crosses a period boundary
  const flo = Math.floor(aVal.lo / period);
  const fhi = Math.floor(aVal.hi / period);

  if (flo !== fhi) {
    // Interval spans a multiple of the period — discontinuity
    // mod has sawtooth discontinuities, right-continuous
    return { kind: 'singular', at: (flo + 1) * period, continuity: 'right' };
  }

  // No discontinuity — mod is continuous (linear) on this interval
  const modLo = aVal.lo - period * flo;
  const modHi = aVal.hi - period * flo;
  return ok({ lo: Math.min(modLo, modHi), hi: Math.max(modLo, modHi) });
}

/**
 * Sign function.
 *
 * Returns -1, 0, or 1 depending on the sign.
 * Has a jump discontinuity at 0.
 */
export function sign(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (xVal.lo > 0) return ok({ lo: 1, hi: 1 });
  if (xVal.hi < 0) return ok({ lo: -1, hi: -1 });
  if (xVal.lo === 0 && xVal.hi === 0) return ok({ lo: 0, hi: 0 });
  // Interval spans zero — discontinuity
  return { kind: 'singular', at: 0 };
}
