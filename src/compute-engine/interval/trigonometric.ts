/**
 * Trigonometric interval functions
 *
 * @module interval/trigonometric
 */

import type { Interval, IntervalResult } from './types';
import { ok, containsExtremum, containsZero, unwrapOrPropagate } from './util';
import { div } from './arithmetic';

const TWO_PI = 2 * Math.PI;
const PI = Math.PI;
const HALF_PI = Math.PI / 2;
const THREE_HALF_PI = (3 * Math.PI) / 2;

/**
 * Sine of an interval.
 *
 * Sin is bounded [-1, 1] and periodic with extrema at pi/2 + n*pi.
 */
export function sin(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  // Wide interval spans full range
  if (xVal.hi - xVal.lo >= TWO_PI) {
    return ok({ lo: -1, hi: 1 });
  }

  // Endpoint values
  const sinLo = Math.sin(xVal.lo);
  const sinHi = Math.sin(xVal.hi);
  let lo = Math.min(sinLo, sinHi);
  let hi = Math.max(sinLo, sinHi);

  // Check for maximum at pi/2 + 2n*pi
  if (containsExtremum(xVal, HALF_PI, TWO_PI)) {
    hi = 1;
  }
  // Check for minimum at 3*pi/2 + 2n*pi
  if (containsExtremum(xVal, THREE_HALF_PI, TWO_PI)) {
    lo = -1;
  }

  return ok({ lo, hi });
}

/**
 * Cosine of an interval.
 *
 * Cos is bounded [-1, 1] and periodic with extrema at n*pi.
 */
export function cos(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  // Wide interval spans full range
  if (xVal.hi - xVal.lo >= TWO_PI) {
    return ok({ lo: -1, hi: 1 });
  }

  // Endpoint values
  const cosLo = Math.cos(xVal.lo);
  const cosHi = Math.cos(xVal.hi);
  let lo = Math.min(cosLo, cosHi);
  let hi = Math.max(cosLo, cosHi);

  // Check for maximum at 2n*pi (including 0)
  if (containsExtremum(xVal, 0, TWO_PI)) {
    hi = 1;
  }
  // Check for minimum at pi + 2n*pi
  if (containsExtremum(xVal, PI, TWO_PI)) {
    lo = -1;
  }

  return ok({ lo, hi });
}

/**
 * Tangent of an interval.
 *
 * Has singularities at pi/2 + n*pi. Within a single branch,
 * tan is monotonically increasing.
 */
export function tan(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  // Case 1: Interval spans a full period - certainly crosses a singularity
  if (xVal.hi - xVal.lo >= PI) {
    return { kind: 'singular' };
  }

  // Case 2: Check if interval contains a pole at pi/2 + n*pi
  if (containsExtremum(xVal, HALF_PI, PI)) {
    // Find the pole location for refinement hints
    const n = Math.ceil((xVal.lo - HALF_PI) / PI);
    const poleAt = HALF_PI + n * PI;
    return { kind: 'singular', at: poleAt };
  }

  // Case 3: Safe interval - tan is monotonic on this branch
  const tanLo = Math.tan(xVal.lo);
  const tanHi = Math.tan(xVal.hi);

  // Sanity check: if results have opposite signs with large magnitude,
  // we may have crossed a branch due to floating-point error
  if ((tanLo > 1e10 && tanHi < -1e10) || (tanLo < -1e10 && tanHi > 1e10)) {
    return { kind: 'singular' };
  }

  return ok({ lo: tanLo, hi: tanHi });
}

/**
 * Cotangent of an interval.
 *
 * cot(x) = cos(x)/sin(x), has singularities at n*pi.
 */
export function cot(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  // Check for poles at n*pi
  if (xVal.hi - xVal.lo >= PI) {
    return { kind: 'singular' };
  }

  if (containsExtremum(xVal, 0, PI)) {
    const n = Math.ceil(xVal.lo / PI);
    const poleAt = n * PI;
    return { kind: 'singular', at: poleAt };
  }

  // Safe interval - cot is monotonically decreasing within a branch
  const cotLo = 1 / Math.tan(xVal.lo);
  const cotHi = 1 / Math.tan(xVal.hi);

  // Note: cot is decreasing, so bounds are swapped
  return ok({ lo: Math.min(cotLo, cotHi), hi: Math.max(cotLo, cotHi) });
}

/**
 * Secant of an interval.
 *
 * sec(x) = 1/cos(x), has singularities at pi/2 + n*pi.
 */
export function sec(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  // Check for poles
  if (xVal.hi - xVal.lo >= PI) {
    return { kind: 'singular' };
  }

  if (containsExtremum(xVal, HALF_PI, PI)) {
    const n = Math.ceil((xVal.lo - HALF_PI) / PI);
    const poleAt = HALF_PI + n * PI;
    return { kind: 'singular', at: poleAt };
  }

  const secLo = 1 / Math.cos(xVal.lo);
  const secHi = 1 / Math.cos(xVal.hi);

  let lo = Math.min(secLo, secHi);
  let hi = Math.max(secLo, secHi);

  // Check for extrema at 2n*pi (sec = 1) and (2n+1)*pi (sec = -1)
  if (containsExtremum(xVal, 0, TWO_PI)) {
    lo = Math.min(lo, 1);
    hi = Math.max(hi, 1);
  }
  if (containsExtremum(xVal, PI, TWO_PI)) {
    lo = Math.min(lo, -1);
    hi = Math.max(hi, -1);
  }

  return ok({ lo, hi });
}

/**
 * Cosecant of an interval.
 *
 * csc(x) = 1/sin(x), has singularities at n*pi.
 */
export function csc(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (xVal.hi - xVal.lo >= PI) {
    return { kind: 'singular' };
  }

  if (containsExtremum(xVal, 0, PI)) {
    const n = Math.ceil(xVal.lo / PI);
    const poleAt = n * PI;
    return { kind: 'singular', at: poleAt };
  }

  const cscLo = 1 / Math.sin(xVal.lo);
  const cscHi = 1 / Math.sin(xVal.hi);

  let lo = Math.min(cscLo, cscHi);
  let hi = Math.max(cscLo, cscHi);

  // Check for extrema at pi/2 + 2n*pi (csc = 1) and 3pi/2 + 2n*pi (csc = -1)
  if (containsExtremum(xVal, HALF_PI, TWO_PI)) {
    lo = Math.min(lo, 1);
    hi = Math.max(hi, 1);
  }
  if (containsExtremum(xVal, THREE_HALF_PI, TWO_PI)) {
    lo = Math.min(lo, -1);
    hi = Math.max(hi, -1);
  }

  return ok({ lo, hi });
}

/**
 * Arc sine (inverse sine).
 *
 * Domain: [-1, 1], Range: [-pi/2, pi/2]
 */
export function asin(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  // Entirely outside domain
  if (xVal.lo > 1 || xVal.hi < -1) {
    return { kind: 'empty' };
  }

  // Clip to domain if needed
  if (xVal.lo < -1 || xVal.hi > 1) {
    const clippedLo = Math.max(xVal.lo, -1);
    const clippedHi = Math.min(xVal.hi, 1);
    return {
      kind: 'partial',
      value: { lo: Math.asin(clippedLo), hi: Math.asin(clippedHi) },
      domainClipped:
        xVal.lo < -1 && xVal.hi > 1 ? 'both' : xVal.lo < -1 ? 'lo' : 'hi',
    };
  }

  // Within domain - asin is monotonically increasing
  return ok({ lo: Math.asin(xVal.lo), hi: Math.asin(xVal.hi) });
}

/**
 * Arc cosine (inverse cosine).
 *
 * Domain: [-1, 1], Range: [0, pi]
 */
export function acos(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (xVal.lo > 1 || xVal.hi < -1) {
    return { kind: 'empty' };
  }

  if (xVal.lo < -1 || xVal.hi > 1) {
    const clippedLo = Math.max(xVal.lo, -1);
    const clippedHi = Math.min(xVal.hi, 1);
    // acos is monotonically decreasing, so bounds swap
    return {
      kind: 'partial',
      value: { lo: Math.acos(clippedHi), hi: Math.acos(clippedLo) },
      domainClipped:
        xVal.lo < -1 && xVal.hi > 1 ? 'both' : xVal.lo < -1 ? 'lo' : 'hi',
    };
  }

  // acos is monotonically decreasing
  return ok({ lo: Math.acos(xVal.hi), hi: Math.acos(xVal.lo) });
}

/**
 * Arc tangent (inverse tangent).
 *
 * Domain: all reals, Range: (-pi/2, pi/2)
 * Monotonically increasing.
 */
export function atan(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  return ok({ lo: Math.atan(xVal.lo), hi: Math.atan(xVal.hi) });
}

/**
 * Two-argument arc tangent.
 *
 * atan2(y, x) gives the angle of the point (x, y).
 * Handles all quadrants correctly.
 */
export function atan2(
  y: Interval | IntervalResult,
  x: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(y, x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [yVal, xVal] = unwrapped;
  // If both intervals are point intervals, use standard atan2
  if (yVal.lo === yVal.hi && xVal.lo === xVal.hi) {
    const result = Math.atan2(yVal.lo, xVal.lo);
    return ok({ lo: result, hi: result });
  }

  // Conservative approach: evaluate at corners and extrema
  const angles: number[] = [];

  // Corner points
  angles.push(Math.atan2(yVal.lo, xVal.lo));
  angles.push(Math.atan2(yVal.lo, xVal.hi));
  angles.push(Math.atan2(yVal.hi, xVal.lo));
  angles.push(Math.atan2(yVal.hi, xVal.hi));

  // Check for discontinuity at negative x-axis
  if (xVal.lo < 0 && yVal.lo < 0 && yVal.hi > 0) {
    // The interval crosses the negative x-axis where atan2 jumps from pi to -pi
    // Return entire range
    return ok({ lo: -PI, hi: PI });
  }

  return ok({ lo: Math.min(...angles), hi: Math.max(...angles) });
}

/**
 * Hyperbolic sine.
 *
 * Domain: all reals, monotonically increasing.
 */
export function sinh(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  return ok({ lo: Math.sinh(xVal.lo), hi: Math.sinh(xVal.hi) });
}

/**
 * Hyperbolic cosine.
 *
 * Domain: all reals, minimum at x=0.
 */
export function cosh(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (xVal.lo >= 0) {
    return ok({ lo: Math.cosh(xVal.lo), hi: Math.cosh(xVal.hi) });
  } else if (xVal.hi <= 0) {
    return ok({ lo: Math.cosh(xVal.hi), hi: Math.cosh(xVal.lo) });
  } else {
    // Contains zero - minimum is cosh(0) = 1
    return ok({
      lo: 1,
      hi: Math.max(Math.cosh(xVal.lo), Math.cosh(xVal.hi)),
    });
  }
}

/**
 * Hyperbolic tangent.
 *
 * Domain: all reals, Range: (-1, 1), monotonically increasing.
 */
export function tanh(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  return ok({ lo: Math.tanh(xVal.lo), hi: Math.tanh(xVal.hi) });
}

/**
 * Inverse hyperbolic sine.
 *
 * Domain: all reals, monotonically increasing.
 */
export function asinh(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  return ok({ lo: Math.asinh(xVal.lo), hi: Math.asinh(xVal.hi) });
}

/**
 * Inverse hyperbolic cosine.
 *
 * Domain: [1, +Infinity)
 */
export function acosh(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (xVal.hi < 1) {
    return { kind: 'empty' };
  }

  if (xVal.lo < 1) {
    return {
      kind: 'partial',
      value: { lo: 0, hi: Math.acosh(xVal.hi) },
      domainClipped: 'lo',
    };
  }

  return ok({ lo: Math.acosh(xVal.lo), hi: Math.acosh(xVal.hi) });
}

/**
 * Inverse hyperbolic tangent.
 *
 * Domain: (-1, 1)
 */
export function atanh(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (xVal.lo >= 1 || xVal.hi <= -1) {
    return { kind: 'empty' };
  }

  if (xVal.lo <= -1 || xVal.hi >= 1) {
    const clippedLo = Math.max(xVal.lo, -1 + Number.EPSILON);
    const clippedHi = Math.min(xVal.hi, 1 - Number.EPSILON);
    return {
      kind: 'partial',
      value: { lo: Math.atanh(clippedLo), hi: Math.atanh(clippedHi) },
      domainClipped:
        xVal.lo <= -1 && xVal.hi >= 1
          ? 'both'
          : xVal.lo <= -1
            ? 'lo'
            : 'hi',
    };
  }

  return ok({ lo: Math.atanh(xVal.lo), hi: Math.atanh(xVal.hi) });
}

/**
 * Inverse cotangent: acot(x) = atan(1/x).
 *
 * Has a discontinuity at x = 0.
 */
export function acot(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return atan(div(ok({ lo: 1, hi: 1 }), ok(xVal)));
}

/**
 * Inverse cosecant: acsc(x) = asin(1/x).
 *
 * Domain: |x| >= 1. Has a singularity at x = 0.
 */
export function acsc(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return asin(div(ok({ lo: 1, hi: 1 }), ok(xVal)));
}

/**
 * Inverse secant: asec(x) = acos(1/x).
 *
 * Domain: |x| >= 1. Has a singularity at x = 0.
 */
export function asec(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return acos(div(ok({ lo: 1, hi: 1 }), ok(xVal)));
}

/**
 * Hyperbolic cotangent: coth(x) = cosh(x)/sinh(x).
 *
 * Has a singularity at x = 0.
 */
export function coth(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return div(cosh(xVal), sinh(xVal));
}

/**
 * Hyperbolic cosecant: csch(x) = 1/sinh(x).
 *
 * Has a singularity at x = 0.
 */
export function csch(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return div(ok({ lo: 1, hi: 1 }), sinh(xVal));
}

/**
 * Hyperbolic secant: sech(x) = 1/cosh(x).
 *
 * Always valid since cosh(x) >= 1.
 */
export function sech(x: Interval | IntervalResult): IntervalResult {
  return div(ok({ lo: 1, hi: 1 }), cosh(x));
}

/**
 * Inverse hyperbolic cotangent: acoth(x) = atanh(1/x).
 *
 * Domain: |x| > 1. Has a singularity at x = 0.
 */
export function acoth(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return atanh(div(ok({ lo: 1, hi: 1 }), ok(xVal)));
}

/**
 * Inverse hyperbolic cosecant: acsch(x) = asinh(1/x).
 *
 * Domain: x != 0.
 */
export function acsch(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return asinh(div(ok({ lo: 1, hi: 1 }), ok(xVal)));
}

/**
 * Inverse hyperbolic secant: asech(x) = acosh(1/x).
 *
 * Domain: (0, 1]. Has a singularity at x = 0.
 */
export function asech(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return acosh(div(ok({ lo: 1, hi: 1 }), ok(xVal)));
}
