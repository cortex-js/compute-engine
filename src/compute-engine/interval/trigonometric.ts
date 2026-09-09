/**
 * Trigonometric interval functions
 *
 * @module interval/trigonometric
 */

import type { Interval, IntervalResult } from './types.js';
import {
  ok,
  containsExtremum,
  containsZero,
  unwrapOrPropagate,
  liftJump,
  jump,
} from './util.js';
import { divUnrounded } from './arithmetic.js';
import {
  outward,
  outwardUnlessExact,
  eitherExact,
  exactAtOrigin,
  exactAtPoint,
  exactInRange,
} from './rounding.js';
import {
  fresnelS as scalarFresnelS,
  fresnelC as scalarFresnelC,
} from '../numerics/special-functions.js';
import { nextDown, nextUp } from '../numerics/numeric.js';

const TWO_PI = 2 * Math.PI;
const PI = Math.PI;
const HALF_PI = Math.PI / 2;
const THREE_HALF_PI = (3 * Math.PI) / 2;

/**
 * Sine of an interval.
 *
 * Sin is bounded [-1, 1] and periodic with extrema at pi/2 + n*pi.
 */
function sinRaw(x: Interval | IntervalResult): IntervalResult {
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
function cosRaw(x: Interval | IntervalResult): IntervalResult {
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
function tanRaw(x: Interval | IntervalResult): IntervalResult {
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
function cotRaw(x: Interval | IntervalResult): IntervalResult {
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
function secRaw(x: Interval | IntervalResult): IntervalResult {
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
function cscRaw(x: Interval | IntervalResult): IntervalResult {
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
function asinRaw(x: Interval | IntervalResult): IntervalResult {
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
function acosRaw(x: Interval | IntervalResult): IntervalResult {
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
function atanRaw(x: Interval | IntervalResult): IntervalResult {
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
function atan2Raw(
  y: Interval | IntervalResult,
  x: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(y, x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [yVal, xVal] = unwrapped;

  // An interval is a set of REAL numbers, and +0 and −0 are the same real
  // number, so an endpoint of −0 stands for the same point of the plane as
  // an endpoint of +0. IEEE gives the two zeros different angles —
  // `Math.atan2(-0, -1)` is −π where `Math.atan2(0, -1)` is +π, and
  // `Math.atan2(0, -0)` is π where `Math.atan2(0, 0)` is 0 — so reading the
  // endpoints as they come would make the answer depend on which zero an
  // operand happens to hold. Every zero endpoint is therefore made positive
  // below, which picks the PRINCIPAL angle: the argument of a negative real
  // is +π (the range of the principal argument is (−π, π]) and the argument
  // at the origin is 0.
  const yLo = yVal.lo === 0 ? 0 : yVal.lo;
  const yHi = yVal.hi === 0 ? 0 : yVal.hi;
  const xLo = xVal.lo === 0 ? 0 : xVal.lo;
  const xHi = xVal.hi === 0 ? 0 : xVal.hi;

  // If both intervals are point intervals, use standard atan2
  if (yLo === yHi && xLo === xHi) {
    const result = Math.atan2(yLo, xLo);
    return ok({ lo: result, hi: result });
  }

  // Conservative approach: evaluate at corners and extrema
  const angles: number[] = [];

  // Corner points
  angles.push(Math.atan2(yLo, xLo));
  angles.push(Math.atan2(yLo, xHi));
  angles.push(Math.atan2(yHi, xLo));
  angles.push(Math.atan2(yHi, xHi));

  // The angle is discontinuous on the branch cut — the closed negative
  // x-axis, the points with y = 0 and x ≤ 0 — and the three tests below are
  // the three ways a box can meet the cut on a side the function does not
  // extend across. Each is reported as every jump is (the item-239
  // contract): `singular` WITH an enclosure, which bounds every value the
  // function takes on the box, so a consumer that only needs a bound — an
  // implicit-curve sign test, a range estimate — can use it and keep
  // refining, while a consumer that draws the curve still sees the break. A
  // plain bounded `interval` on the cut let an implicit-curve classifier
  // read the sign change of `atan2(y, x) − 3` across the cut as a crossing
  // (Tycho item 255). Every enclosure written here is spelled from the
  // DOUBLE `Math.PI`, which is below the real π that the angle attains on
  // the cut, so a written endpoint is stepped one ulp outward at the point
  // it is written and the hull encloses the value even before the outward
  // decorator sees it.

  // The cut crossed in y: the box has some x < 0 and its y range reaches 0
  // from below. The angle jumps there from +π, the value at y = 0, to −π,
  // the limit from y < 0. `at` is the location of the jump in the FIRST
  // operand's coordinate, y = 0, and `continuity: 'right'` says that the
  // value at the cut belongs to the upper side. A box that only touches
  // y = 0 from above with x < 0 throughout is continuous there, because the
  // angle runs up to π, and it takes the corner evaluation below.
  if (xLo < 0 && yLo < 0 && yHi >= 0)
    return jump(0, 'right', { lo: nextDown(-PI), hi: nextUp(PI) });

  // The cut crossed in x: the box sits on y = 0, or on y = 0 and the strip
  // above it, and its x range reaches both sides of zero. Along y = 0 the
  // angle is π for x < 0 and 0 for x ≥ 0, so it jumps at x = 0 — a jump in
  // the SECOND operand's coordinate, which `atOperand: 1` reports. The value
  // at the jump is `Math.atan2(0, 0)`, which is 0, the limit from x > 0,
  // hence `continuity: 'right'`. Every point of the box has y ≥ 0, so its
  // angle is in [0, π], and both ends are attained on y = 0 (0 at x > 0 and
  // π at x < 0), which makes that interval the exact range.
  if (yLo === 0 && xLo < 0 && xHi >= 0)
    return jump(0, 'right', { lo: 0, hi: nextUp(PI) }, 1);

  // The box is a segment of the line x = 0 that reaches the origin: the
  // angle is +π/2 above the origin, −π/2 below it and 0 at the origin
  // itself, so it takes two or three values and nothing in between. The jump
  // is at y = 0, in the first operand's coordinate. No side is reported,
  // because the value at the origin is neither the limit from above nor the
  // limit from below.
  if (xLo === 0 && xHi === 0 && yLo <= 0 && yHi >= 0)
    return jump(0, undefined, {
      lo: yLo < 0 ? nextDown(-HALF_PI) : 0,
      hi: yHi > 0 ? nextUp(HALF_PI) : 0,
    });

  return ok({ lo: Math.min(...angles), hi: Math.max(...angles) });
}

/**
 * Hyperbolic sine.
 *
 * Domain: all reals, monotonically increasing.
 */
function sinhRaw(x: Interval | IntervalResult): IntervalResult {
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
function coshRaw(x: Interval | IntervalResult): IntervalResult {
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
function tanhRaw(x: Interval | IntervalResult): IntervalResult {
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
function asinhRaw(x: Interval | IntervalResult): IntervalResult {
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
function acoshRaw(x: Interval | IntervalResult): IntervalResult {
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
function atanhRaw(x: Interval | IntervalResult): IntervalResult {
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
        xVal.lo <= -1 && xVal.hi >= 1 ? 'both' : xVal.lo <= -1 ? 'lo' : 'hi',
    };
  }

  return ok({ lo: Math.atanh(xVal.lo), hi: Math.atanh(xVal.hi) });
}

/**
 * Inverse cotangent (interval).
 *
 * Uses the continuous (0, π) convention that matches the interpreter
 * (`Arccot(-2) = 2.678`, `Arccot(0) = π/2`): acot(x) = π/2 − atan(x). This is
 * monotone DECREASING and continuous over ALL reals — there is NO singularity
 * at 0 (unlike the `atan(1/x)` form, which is on (−π/2, π/2)\{0} and jumps at
 * 0). Because it is decreasing, the endpoints swap.
 */
function acotRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  return ok({
    lo: HALF_PI - Math.atan(xVal.hi),
    hi: HALF_PI - Math.atan(xVal.lo),
  });
}

/**
 * Inverse cosecant: acsc(x) = asin(1/x).
 *
 * Domain: |x| >= 1. Has a singularity at x = 0.
 */
function acscRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return asinRaw(divUnrounded(ok({ lo: 1, hi: 1 }), ok(xVal)));
}

/**
 * Inverse secant: asec(x) = acos(1/x).
 *
 * Domain: |x| >= 1. Has a singularity at x = 0.
 */
function asecRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return acosRaw(divUnrounded(ok({ lo: 1, hi: 1 }), ok(xVal)));
}

/**
 * Hyperbolic cotangent: coth(x) = cosh(x)/sinh(x).
 *
 * Has a singularity at x = 0.
 */
function cothRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return divUnrounded(coshRaw(xVal), sinhRaw(xVal));
}

/**
 * Hyperbolic cosecant: csch(x) = 1/sinh(x).
 *
 * Has a singularity at x = 0.
 */
function cschRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return divUnrounded(ok({ lo: 1, hi: 1 }), sinhRaw(xVal));
}

/**
 * Hyperbolic secant: sech(x) = 1/cosh(x).
 *
 * Always valid since cosh(x) >= 1.
 */
function sechRaw(x: Interval | IntervalResult): IntervalResult {
  return divUnrounded(ok({ lo: 1, hi: 1 }), coshRaw(x));
}

/**
 * Inverse hyperbolic cotangent: acoth(x) = atanh(1/x).
 *
 * Domain: |x| > 1. Has a singularity at x = 0.
 */
function acothRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return atanhRaw(divUnrounded(ok({ lo: 1, hi: 1 }), ok(xVal)));
}

/**
 * Inverse hyperbolic cosecant: acsch(x) = asinh(1/x).
 *
 * Domain: x != 0.
 */
function acschRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return asinhRaw(divUnrounded(ok({ lo: 1, hi: 1 }), ok(xVal)));
}

/**
 * Inverse hyperbolic secant: asech(x) = acosh(1/x).
 *
 * Domain: (0, 1]. Has a singularity at x = 0.
 */
function asechRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  if (containsZero(xVal)) {
    return { kind: 'singular', at: 0 };
  }
  return acoshRaw(divUnrounded(ok({ lo: 1, hi: 1 }), ok(xVal)));
}

/**
 * Cardinal sine (unnormalized): sinc(x) = sin(x)/x, sinc(0) = 1.
 *
 * sinc is an even function bounded roughly in [-0.2172, 1].
 * Its local extrema occur at the roots of cos(x) - sin(x)/x = 0,
 * i.e. where tan(x) = x. We evaluate sinc at both endpoints, at 0
 * (if in range), and at known extrema locations.  For intervals
 * extending beyond the last tabulated extremum we fall back to the
 * global bounds [-0.2172, 1] to guarantee a correct enclosure.
 */

// Approximate locations of the first 10 positive local extrema of sinc(x)
// (solutions of tan(x) = x, alternating max/min).
const SINC_EXTREMA = [
  4.49341, 7.72525, 10.90412, 14.06619, 17.22076, 20.3713, 23.51945, 26.66605,
  29.8116, 32.95639,
];

function sincRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;

  const sincVal = (t: number): number => (t === 0 ? 1 : Math.sin(t) / t);

  // Collect candidate values at endpoints
  let lo = sincVal(xVal.lo);
  let hi = lo;
  const update = (v: number) => {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  };
  update(sincVal(xVal.hi));

  // If the interval contains 0, sinc(0) = 1 (the global maximum)
  if (xVal.lo <= 0 && xVal.hi >= 0) {
    update(1);
  }

  // Check known extrema within the interval
  const lastExtremum = SINC_EXTREMA[SINC_EXTREMA.length - 1];
  for (const e of SINC_EXTREMA) {
    if (e >= xVal.lo && e <= xVal.hi) update(sincVal(e));
    if (-e >= xVal.lo && -e <= xVal.hi) update(sincVal(-e));
  }

  // For the portion of the interval beyond the last tabulated extremum, the
  // local extrema are not enumerated — and they are NOT all captured by the
  // endpoints (the previous code widened only `lo`, letting the true max
  // escape, e.g. on [38, 40]). There |sinc(x)| = |sin(x)/x| ≤ 1/|x|, so bound
  // that portion by ±1/m, where m is its closest approach to 0.
  let minBeyondAbs = Infinity;
  if (xVal.hi > lastExtremum)
    minBeyondAbs = Math.min(minBeyondAbs, Math.max(xVal.lo, lastExtremum));
  if (xVal.lo < -lastExtremum)
    minBeyondAbs = Math.min(minBeyondAbs, -Math.min(xVal.hi, -lastExtremum));
  if (Number.isFinite(minBeyondAbs) && minBeyondAbs > 0) {
    update(1 / minBeyondAbs);
    update(-1 / minBeyondAbs);
  }

  return ok({ lo, hi });
}

// ──────────────────────────────────────────────────────────────────
// Fresnel integrals
// ──────────────────────────────────────────────────────────────────

// Approximate positive locations of local extrema of FresnelS.
// Extrema occur where sin(πx²/2)=0, i.e. x=√(2n) for positive integers n.
const FRESNEL_S_EXTREMA: number[] = [];
const FRESNEL_C_EXTREMA: number[] = [];
for (let n = 1; n <= 20; n++) {
  FRESNEL_S_EXTREMA.push(Math.sqrt(2 * n));
  FRESNEL_C_EXTREMA.push(Math.sqrt(2 * n - 1));
}

/**
 * Fresnel sine integral (interval): S(x) = ∫₀ˣ sin(πt²/2) dt
 *
 * Conservative approach: evaluate at endpoints and known extrema,
 * take min/max. S is bounded (|S(x)| ≤ ~0.7139).
 */
function fresnelSRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;

  let lo = scalarFresnelS(xVal.lo);
  let hi = lo;
  const update = (v: number) => {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  };
  update(scalarFresnelS(xVal.hi));

  // S(0) = 0
  if (xVal.lo <= 0 && xVal.hi >= 0) update(0);

  // Check known extrema (and their negatives, since S is odd)
  for (const e of FRESNEL_S_EXTREMA) {
    if (e >= xVal.lo && e <= xVal.hi) update(scalarFresnelS(e));
    if (-e >= xVal.lo && -e <= xVal.hi) update(scalarFresnelS(-e));
  }

  // Beyond the last tabulated extremum the oscillation amplitude only
  // decreases, so bound that portion by the convergence band 0.5 ± A, where A
  // is the deviation at the last extremum (S(±∞) = ±0.5; S is odd).
  fresnelConvergenceBound(xVal, FRESNEL_S_EXTREMA, scalarFresnelS, update);

  return ok({ lo, hi });
}

// Fresnel integrals converge to ±0.5 as x → ±∞, with monotonically decreasing
// oscillation amplitude. For the part of `xVal` beyond the last tabulated
// extremum, the value lies in 0.5 ± A (positive side) or −0.5 ± A (negative
// side), where A is the deviation from 0.5 at the last extremum — a guaranteed
// upper bound on the remaining amplitude. Without this, the table had no
// fallback past x ≈ 6.2 and the enclosure was not conservative.
function fresnelConvergenceBound(
  xVal: Interval,
  extrema: number[],
  scalar: (x: number) => number,
  update: (v: number) => void
): void {
  const lastE = extrema[extrema.length - 1];
  const amp = Math.abs(scalar(lastE) - 0.5);
  if (xVal.hi > lastE) {
    update(0.5 + amp);
    update(0.5 - amp);
  }
  if (xVal.lo < -lastE) {
    update(-0.5 - amp);
    update(-0.5 + amp);
  }
}

/**
 * Fresnel cosine integral (interval): C(x) = ∫₀ˣ cos(πt²/2) dt
 *
 * Conservative approach: evaluate at endpoints and known extrema,
 * take min/max. C is bounded (|C(x)| ≤ ~0.7799).
 */
function fresnelCRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;

  let lo = scalarFresnelC(xVal.lo);
  let hi = lo;
  const update = (v: number) => {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  };
  update(scalarFresnelC(xVal.hi));

  // C(0) = 0
  if (xVal.lo <= 0 && xVal.hi >= 0) update(0);

  // Check known extrema (and their negatives, since C is odd)
  for (const e of FRESNEL_C_EXTREMA) {
    if (e >= xVal.lo && e <= xVal.hi) update(scalarFresnelC(e));
    if (-e >= xVal.lo && -e <= xVal.hi) update(scalarFresnelC(-e));
  }

  // Same convergence-band fallback as fresnelS (C(±∞) = ±0.5, C is odd).
  fresnelConvergenceBound(xVal, FRESNEL_C_EXTREMA, scalarFresnelC, update);

  return ok({ lo, hi });
}

// Every operation above is exported through `liftJump` so that a finite
// jump in an operand (a `singular` result carrying a `value`) is re-tagged
// on the result instead of being forgotten — see `liftJump` in `util.ts`.
//
// Every operation is also exported through `outward`, which moves each finite
// endpoint one ulp outward so the answer is an enclosure rather than a
// round-to-nearest approximation — see `rounding.ts`. These are
// approximations of transcendental functions, so one ulp is the minimum
// outward step, not a proof. The odd functions through the origin carry
// `exactAtOrigin` instead, which keeps `f([0, 0])` the exact point 0.
//
// The routines built from other routines — `acsc`, `asec`, `coth`, `csch`,
// `sech`, `acoth`, `acsch`, `asech` — compose the RAW kernels above and the
// unrounded `divUnrounded` (`arithmetic.ts`), not the exported forms. Each
// routine takes exactly ONE outward step, at its own export. Composing the
// exported forms instead took a step per composed operation on top of that,
// which cost `sech([0, 0])` the exact value 1 and made `acsc([2, 2])` four
// ulps wide for one division and one arc sine.
export const sin = liftJump(
  outwardUnlessExact(sinRaw, eitherExact(exactAtOrigin, exactInRange(-1, 1)))
);
export const cos = liftJump(outwardUnlessExact(cosRaw, exactInRange(-1, 1)));
export const tan = liftJump(outwardUnlessExact(tanRaw, exactAtOrigin));
export const cot = liftJump(outward(cotRaw));
export const sec = liftJump(outward(secRaw));
export const csc = liftJump(outward(cscRaw));
export const asin = liftJump(outwardUnlessExact(asinRaw, exactAtOrigin));
export const acos = liftJump(
  outwardUnlessExact(acosRaw, exactInRange(0, Infinity))
);
export const atan = liftJump(outwardUnlessExact(atanRaw, exactAtOrigin));
export const atan2 = liftJump(outward(atan2Raw));
export const sinh = liftJump(outwardUnlessExact(sinhRaw, exactAtOrigin));
export const cosh = liftJump(
  outwardUnlessExact(coshRaw, exactInRange(1, Infinity))
);
export const tanh = liftJump(
  outwardUnlessExact(tanhRaw, eitherExact(exactAtOrigin, exactInRange(-1, 1)))
);
export const asinh = liftJump(outwardUnlessExact(asinhRaw, exactAtOrigin));
export const acosh = liftJump(
  outwardUnlessExact(acoshRaw, exactInRange(0, Infinity))
);
export const atanh = liftJump(outwardUnlessExact(atanhRaw, exactAtOrigin));
export const acot = liftJump(outward(acotRaw));
export const acsc = liftJump(outward(acscRaw));
export const asec = liftJump(outward(asecRaw));
export const coth = liftJump(outward(cothRaw));
export const csch = liftJump(outward(cschRaw));
// `sech` reaches its maximum of 1 at x = 0, where `cosh(0)` is exactly 1 and
// the reciprocal of 1 is exactly 1: at the degenerate operand [0, 0] both
// endpoints of the answer are that exact value, which `exactInRange` alone
// cannot say (it certifies only an upper bound that reads 1).
export const sech = liftJump(
  outwardUnlessExact(
    sechRaw,
    eitherExact(exactInRange(0, 1), exactAtPoint(0, 1))
  )
);
export const acoth = liftJump(outward(acothRaw));
export const acsch = liftJump(outward(acschRaw));
export const asech = liftJump(outward(asechRaw));
export const sinc = liftJump(
  outwardUnlessExact(sincRaw, exactInRange(-Infinity, 1))
);
export const fresnelS = liftJump(
  outwardUnlessExact(fresnelSRaw, exactAtOrigin)
);
export const fresnelC = liftJump(
  outwardUnlessExact(fresnelCRaw, exactAtOrigin)
);
