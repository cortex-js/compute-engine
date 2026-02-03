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
export function pow(base: Interval, exp: number): IntervalResult {
  if (Number.isInteger(exp)) {
    if (exp >= 0) {
      return ok(intPow(base, exp));
    } else {
      // Negative integer: x^(-n) = 1/x^n - singularity if base contains 0
      if (containsZero(base)) {
        return { kind: 'singular' };
      }
      const denom = intPow(base, -exp);
      // 1 / [a, b] = [1/b, 1/a] when a, b have same sign
      return ok({ lo: 1 / denom.hi, hi: 1 / denom.lo });
    }
  } else {
    // Fractional exponent - requires non-negative base for real result
    if (isNegative(base)) {
      // Entirely negative - no real values
      return { kind: 'empty' };
    }
    if (base.lo < 0) {
      // Straddles zero - valid for [0, base.hi]
      const value =
        exp > 0
          ? { lo: 0, hi: Math.pow(base.hi, exp) }
          : { lo: Math.pow(base.hi, exp), hi: Infinity }; // x^(-0.5) etc
      return { kind: 'partial', value, domainClipped: 'lo' };
    }
    // Entirely non-negative - straightforward
    // Handle exp > 0 vs exp < 0 for monotonicity
    if (exp > 0) {
      return ok({ lo: Math.pow(base.lo, exp), hi: Math.pow(base.hi, exp) });
    } else {
      // Decreasing function
      if (base.lo === 0) {
        return {
          kind: 'partial',
          value: { lo: Math.pow(base.hi, exp), hi: Infinity },
          domainClipped: 'hi',
        };
      }
      return ok({ lo: Math.pow(base.hi, exp), hi: Math.pow(base.lo, exp) });
    }
  }
}

/**
 * Interval power where the exponent is also an interval.
 *
 * For simplicity, we evaluate at the four corners and take the hull.
 * This requires base to be positive for real results.
 */
export function powInterval(base: Interval, exp: Interval): IntervalResult {
  // For real-valued results, base must be positive
  if (base.hi <= 0) {
    return { kind: 'empty' };
  }
  if (base.lo <= 0) {
    // Straddles or touches zero - complex behavior
    // For safety, restrict to positive part
    const posBase = { lo: Math.max(base.lo, Number.EPSILON), hi: base.hi };
    const corners = [
      Math.pow(posBase.lo, exp.lo),
      Math.pow(posBase.lo, exp.hi),
      Math.pow(posBase.hi, exp.lo),
      Math.pow(posBase.hi, exp.hi),
    ];
    return {
      kind: 'partial',
      value: { lo: Math.min(...corners), hi: Math.max(...corners) },
      domainClipped: 'lo',
    };
  }

  // Both base values are positive
  const corners = [
    Math.pow(base.lo, exp.lo),
    Math.pow(base.lo, exp.hi),
    Math.pow(base.hi, exp.lo),
    Math.pow(base.hi, exp.hi),
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
export function ln(x: Interval): IntervalResult {
  // Case 1: Entirely non-positive - no valid values
  if (x.hi <= 0) {
    return { kind: 'empty' };
  }

  // Case 2: Entirely positive - straightforward
  if (x.lo > 0) {
    return ok({ lo: Math.log(x.lo), hi: Math.log(x.hi) });
  }

  // Case 3: Includes zero or negative values
  // ln(x) -> -Infinity as x -> 0+
  return {
    kind: 'partial',
    value: { lo: -Infinity, hi: Math.log(x.hi) },
    domainClipped: 'lo',
  };
}

/**
 * Base-10 logarithm.
 */
export function log10(x: Interval): IntervalResult {
  if (x.hi <= 0) {
    return { kind: 'empty' };
  }

  if (x.lo > 0) {
    return ok({ lo: Math.log10(x.lo), hi: Math.log10(x.hi) });
  }

  return {
    kind: 'partial',
    value: { lo: -Infinity, hi: Math.log10(x.hi) },
    domainClipped: 'lo',
  };
}

/**
 * Base-2 logarithm.
 */
export function log2(x: Interval): IntervalResult {
  if (x.hi <= 0) {
    return { kind: 'empty' };
  }

  if (x.lo > 0) {
    return ok({ lo: Math.log2(x.lo), hi: Math.log2(x.hi) });
  }

  return {
    kind: 'partial',
    value: { lo: -Infinity, hi: Math.log2(x.hi) },
    domainClipped: 'lo',
  };
}

/**
 * Absolute value of an interval.
 */
export function abs(x: Interval): IntervalResult {
  if (x.lo >= 0) {
    return ok(x);
  }
  if (x.hi <= 0) {
    return ok({ lo: -x.hi, hi: -x.lo });
  }
  // Interval straddles zero - minimum is 0
  return ok({ lo: 0, hi: Math.max(-x.lo, x.hi) });
}

/**
 * Floor function (greatest integer <= x).
 *
 * Note: Produces step-function discontinuities when floor(x.lo) != floor(x.hi).
 */
export function floor(x: Interval): IntervalResult {
  return ok({ lo: Math.floor(x.lo), hi: Math.floor(x.hi) });
}

/**
 * Ceiling function (least integer >= x).
 *
 * Note: Produces step-function discontinuities when ceil(x.lo) != ceil(x.hi).
 */
export function ceil(x: Interval): IntervalResult {
  return ok({ lo: Math.ceil(x.lo), hi: Math.ceil(x.hi) });
}

/**
 * Round to nearest integer.
 */
export function round(x: Interval): IntervalResult {
  return ok({ lo: Math.round(x.lo), hi: Math.round(x.hi) });
}

/**
 * Minimum of two intervals.
 */
export function min(a: Interval, b: Interval): IntervalResult {
  return ok({ lo: Math.min(a.lo, b.lo), hi: Math.min(a.hi, b.hi) });
}

/**
 * Maximum of two intervals.
 */
export function max(a: Interval, b: Interval): IntervalResult {
  return ok({ lo: Math.max(a.lo, b.lo), hi: Math.max(a.hi, b.hi) });
}

/**
 * Modulo (remainder) operation.
 *
 * Has discontinuities and is complex with interval divisor.
 * Conservative approach: if interval spans a period, return [0, |b|).
 */
export function mod(a: Interval, b: Interval): IntervalResult {
  // Division by zero in mod
  if (containsZero(b)) {
    return { kind: 'singular' };
  }

  const bAbs = Math.max(Math.abs(b.lo), Math.abs(b.hi));
  const aWidth = a.hi - a.lo;

  if (aWidth >= bAbs) {
    // Interval is wide enough to span all possible mod values
    return ok({ lo: 0, hi: bAbs });
  }

  // For narrow intervals, compute endpoint values
  // This may over-estimate due to wrap-around
  const modLo = ((a.lo % bAbs) + bAbs) % bAbs;
  const modHi = ((a.hi % bAbs) + bAbs) % bAbs;

  if (modLo <= modHi) {
    return ok({ lo: modLo, hi: modHi });
  } else {
    // Wrap-around occurred - result spans [0, bAbs)
    return ok({ lo: 0, hi: bAbs });
  }
}

/**
 * Sign function.
 *
 * Returns -1, 0, or 1 depending on the sign.
 */
export function sign(x: Interval): IntervalResult {
  if (x.lo > 0) return ok({ lo: 1, hi: 1 });
  if (x.hi < 0) return ok({ lo: -1, hi: -1 });
  if (x.lo === 0 && x.hi === 0) return ok({ lo: 0, hi: 0 });
  // Interval crosses zero
  if (x.lo < 0 && x.hi > 0) return ok({ lo: -1, hi: 1 });
  if (x.lo === 0) return ok({ lo: 0, hi: 1 });
  // x.hi === 0
  return ok({ lo: -1, hi: 0 });
}
