/**
 * Trigonometric interval functions
 *
 * @module interval/trigonometric
 */

import type { Interval, IntervalResult } from './types';
import { ok, containsExtremum } from './util';

const TWO_PI = 2 * Math.PI;
const PI = Math.PI;
const HALF_PI = Math.PI / 2;
const THREE_HALF_PI = (3 * Math.PI) / 2;

/**
 * Sine of an interval.
 *
 * Sin is bounded [-1, 1] and periodic with extrema at pi/2 + n*pi.
 */
export function sin(x: Interval): IntervalResult {
  // Wide interval spans full range
  if (x.hi - x.lo >= TWO_PI) {
    return ok({ lo: -1, hi: 1 });
  }

  // Endpoint values
  const sinLo = Math.sin(x.lo);
  const sinHi = Math.sin(x.hi);
  let lo = Math.min(sinLo, sinHi);
  let hi = Math.max(sinLo, sinHi);

  // Check for maximum at pi/2 + 2n*pi
  if (containsExtremum(x, HALF_PI, TWO_PI)) {
    hi = 1;
  }
  // Check for minimum at 3*pi/2 + 2n*pi
  if (containsExtremum(x, THREE_HALF_PI, TWO_PI)) {
    lo = -1;
  }

  return ok({ lo, hi });
}

/**
 * Cosine of an interval.
 *
 * Cos is bounded [-1, 1] and periodic with extrema at n*pi.
 */
export function cos(x: Interval): IntervalResult {
  // Wide interval spans full range
  if (x.hi - x.lo >= TWO_PI) {
    return ok({ lo: -1, hi: 1 });
  }

  // Endpoint values
  const cosLo = Math.cos(x.lo);
  const cosHi = Math.cos(x.hi);
  let lo = Math.min(cosLo, cosHi);
  let hi = Math.max(cosLo, cosHi);

  // Check for maximum at 2n*pi (including 0)
  if (containsExtremum(x, 0, TWO_PI)) {
    hi = 1;
  }
  // Check for minimum at pi + 2n*pi
  if (containsExtremum(x, PI, TWO_PI)) {
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
export function tan(x: Interval): IntervalResult {
  // Case 1: Interval spans a full period - certainly crosses a singularity
  if (x.hi - x.lo >= PI) {
    return { kind: 'singular' };
  }

  // Case 2: Check if interval contains a pole at pi/2 + n*pi
  if (containsExtremum(x, HALF_PI, PI)) {
    // Find the pole location for refinement hints
    const n = Math.ceil((x.lo - HALF_PI) / PI);
    const poleAt = HALF_PI + n * PI;
    return { kind: 'singular', at: poleAt };
  }

  // Case 3: Safe interval - tan is monotonic on this branch
  const tanLo = Math.tan(x.lo);
  const tanHi = Math.tan(x.hi);

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
export function cot(x: Interval): IntervalResult {
  // Check for poles at n*pi
  if (x.hi - x.lo >= PI) {
    return { kind: 'singular' };
  }

  if (containsExtremum(x, 0, PI)) {
    const n = Math.ceil(x.lo / PI);
    const poleAt = n * PI;
    return { kind: 'singular', at: poleAt };
  }

  // Safe interval - cot is monotonically decreasing within a branch
  const cotLo = 1 / Math.tan(x.lo);
  const cotHi = 1 / Math.tan(x.hi);

  // Note: cot is decreasing, so bounds are swapped
  return ok({ lo: Math.min(cotLo, cotHi), hi: Math.max(cotLo, cotHi) });
}

/**
 * Secant of an interval.
 *
 * sec(x) = 1/cos(x), has singularities at pi/2 + n*pi.
 */
export function sec(x: Interval): IntervalResult {
  // Check for poles
  if (x.hi - x.lo >= PI) {
    return { kind: 'singular' };
  }

  if (containsExtremum(x, HALF_PI, PI)) {
    const n = Math.ceil((x.lo - HALF_PI) / PI);
    const poleAt = HALF_PI + n * PI;
    return { kind: 'singular', at: poleAt };
  }

  const secLo = 1 / Math.cos(x.lo);
  const secHi = 1 / Math.cos(x.hi);

  let lo = Math.min(secLo, secHi);
  let hi = Math.max(secLo, secHi);

  // Check for extrema at 2n*pi (sec = 1) and (2n+1)*pi (sec = -1)
  if (containsExtremum(x, 0, TWO_PI)) {
    lo = Math.min(lo, 1);
    hi = Math.max(hi, 1);
  }
  if (containsExtremum(x, PI, TWO_PI)) {
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
export function csc(x: Interval): IntervalResult {
  if (x.hi - x.lo >= PI) {
    return { kind: 'singular' };
  }

  if (containsExtremum(x, 0, PI)) {
    const n = Math.ceil(x.lo / PI);
    const poleAt = n * PI;
    return { kind: 'singular', at: poleAt };
  }

  const cscLo = 1 / Math.sin(x.lo);
  const cscHi = 1 / Math.sin(x.hi);

  let lo = Math.min(cscLo, cscHi);
  let hi = Math.max(cscLo, cscHi);

  // Check for extrema at pi/2 + 2n*pi (csc = 1) and 3pi/2 + 2n*pi (csc = -1)
  if (containsExtremum(x, HALF_PI, TWO_PI)) {
    lo = Math.min(lo, 1);
    hi = Math.max(hi, 1);
  }
  if (containsExtremum(x, THREE_HALF_PI, TWO_PI)) {
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
export function asin(x: Interval): IntervalResult {
  // Entirely outside domain
  if (x.lo > 1 || x.hi < -1) {
    return { kind: 'empty' };
  }

  // Clip to domain if needed
  if (x.lo < -1 || x.hi > 1) {
    const clippedLo = Math.max(x.lo, -1);
    const clippedHi = Math.min(x.hi, 1);
    return {
      kind: 'partial',
      value: { lo: Math.asin(clippedLo), hi: Math.asin(clippedHi) },
      domainClipped: x.lo < -1 && x.hi > 1 ? 'both' : x.lo < -1 ? 'lo' : 'hi',
    };
  }

  // Within domain - asin is monotonically increasing
  return ok({ lo: Math.asin(x.lo), hi: Math.asin(x.hi) });
}

/**
 * Arc cosine (inverse cosine).
 *
 * Domain: [-1, 1], Range: [0, pi]
 */
export function acos(x: Interval): IntervalResult {
  if (x.lo > 1 || x.hi < -1) {
    return { kind: 'empty' };
  }

  if (x.lo < -1 || x.hi > 1) {
    const clippedLo = Math.max(x.lo, -1);
    const clippedHi = Math.min(x.hi, 1);
    // acos is monotonically decreasing, so bounds swap
    return {
      kind: 'partial',
      value: { lo: Math.acos(clippedHi), hi: Math.acos(clippedLo) },
      domainClipped: x.lo < -1 && x.hi > 1 ? 'both' : x.lo < -1 ? 'lo' : 'hi',
    };
  }

  // acos is monotonically decreasing
  return ok({ lo: Math.acos(x.hi), hi: Math.acos(x.lo) });
}

/**
 * Arc tangent (inverse tangent).
 *
 * Domain: all reals, Range: (-pi/2, pi/2)
 * Monotonically increasing.
 */
export function atan(x: Interval): IntervalResult {
  return ok({ lo: Math.atan(x.lo), hi: Math.atan(x.hi) });
}

/**
 * Two-argument arc tangent.
 *
 * atan2(y, x) gives the angle of the point (x, y).
 * Handles all quadrants correctly.
 */
export function atan2(y: Interval, x: Interval): IntervalResult {
  // If both intervals are point intervals, use standard atan2
  if (y.lo === y.hi && x.lo === x.hi) {
    const result = Math.atan2(y.lo, x.lo);
    return ok({ lo: result, hi: result });
  }

  // Conservative approach: evaluate at corners and extrema
  const angles: number[] = [];

  // Corner points
  angles.push(Math.atan2(y.lo, x.lo));
  angles.push(Math.atan2(y.lo, x.hi));
  angles.push(Math.atan2(y.hi, x.lo));
  angles.push(Math.atan2(y.hi, x.hi));

  // Check for discontinuity at negative x-axis
  if (x.lo < 0 && y.lo < 0 && y.hi > 0) {
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
export function sinh(x: Interval): IntervalResult {
  return ok({ lo: Math.sinh(x.lo), hi: Math.sinh(x.hi) });
}

/**
 * Hyperbolic cosine.
 *
 * Domain: all reals, minimum at x=0.
 */
export function cosh(x: Interval): IntervalResult {
  if (x.lo >= 0) {
    return ok({ lo: Math.cosh(x.lo), hi: Math.cosh(x.hi) });
  } else if (x.hi <= 0) {
    return ok({ lo: Math.cosh(x.hi), hi: Math.cosh(x.lo) });
  } else {
    // Contains zero - minimum is cosh(0) = 1
    return ok({ lo: 1, hi: Math.max(Math.cosh(x.lo), Math.cosh(x.hi)) });
  }
}

/**
 * Hyperbolic tangent.
 *
 * Domain: all reals, Range: (-1, 1), monotonically increasing.
 */
export function tanh(x: Interval): IntervalResult {
  return ok({ lo: Math.tanh(x.lo), hi: Math.tanh(x.hi) });
}

/**
 * Inverse hyperbolic sine.
 *
 * Domain: all reals, monotonically increasing.
 */
export function asinh(x: Interval): IntervalResult {
  return ok({ lo: Math.asinh(x.lo), hi: Math.asinh(x.hi) });
}

/**
 * Inverse hyperbolic cosine.
 *
 * Domain: [1, +Infinity)
 */
export function acosh(x: Interval): IntervalResult {
  if (x.hi < 1) {
    return { kind: 'empty' };
  }

  if (x.lo < 1) {
    return {
      kind: 'partial',
      value: { lo: 0, hi: Math.acosh(x.hi) },
      domainClipped: 'lo',
    };
  }

  return ok({ lo: Math.acosh(x.lo), hi: Math.acosh(x.hi) });
}

/**
 * Inverse hyperbolic tangent.
 *
 * Domain: (-1, 1)
 */
export function atanh(x: Interval): IntervalResult {
  if (x.lo >= 1 || x.hi <= -1) {
    return { kind: 'empty' };
  }

  if (x.lo <= -1 || x.hi >= 1) {
    const clippedLo = Math.max(x.lo, -1 + Number.EPSILON);
    const clippedHi = Math.min(x.hi, 1 - Number.EPSILON);
    return {
      kind: 'partial',
      value: { lo: Math.atanh(clippedLo), hi: Math.atanh(clippedHi) },
      domainClipped:
        x.lo <= -1 && x.hi >= 1 ? 'both' : x.lo <= -1 ? 'lo' : 'hi',
    };
  }

  return ok({ lo: Math.atanh(x.lo), hi: Math.atanh(x.hi) });
}
