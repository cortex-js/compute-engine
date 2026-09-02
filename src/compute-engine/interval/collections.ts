/**
 * Collection access for the interval arithmetic runtime.
 *
 * The interval target's scalar value model is "one interval per quantity". A
 * COLLECTION is represented, at run time only, as a JavaScript array whose
 * elements are `Interval`, `IntervalResult`, or (for a list of points) a
 * nested array. A bare `number` element is tolerated defensively and read as
 * the degenerate interval `[n, n]`, because a caller may hand the compiled
 * function a plain numeric array.
 *
 * A collection-valued EXPRESSION (a comprehension) compiles to such an array
 * as its result (`IntervalValue` in `compilation/types.ts`); these accessors
 * exist so that `At`, `Length`, `PointX`/`PointY`/`PointZ` can project a
 * collection OPERAND back down to a single interval, which is the only value
 * the scalar kernels take.
 *
 * The target's numeric ABSENCE marker is the whole-NaN bare interval
 * `{ lo: NaN, hi: NaN }` — see the `absence` capability in
 * `compilation/interval-javascript-target.ts`, whose `isAbsent` test reads
 * `.lo` directly. Absence must therefore be a bare `Interval`, never an
 * `IntervalResult` wrapper.
 *
 * @module interval/collections
 */

import type { Interval, IntervalResult } from './types.js';
import {
  getValue,
  ok,
  point,
  unionResults,
  unwrapOrPropagate,
  liftJump,
} from './util.js';

/**
 * A fresh copy of the target's numeric absence marker.
 *
 * Fresh rather than shared: the value flows into caller code that may treat an
 * interval as scratch space, and a shared singleton would leak that mutation
 * into every later absence.
 */
function absent(): Interval {
  return { lo: NaN, hi: NaN };
}

/**
 * Normalize one collection ELEMENT to an `IntervalResult`.
 *
 * Returns `undefined` when the element has no interval reading at all — a
 * nested array (a point inside a list of points, which is a collection and so
 * cannot be hulled into one interval) or any other unrecognized value. The
 * caller turns that into `{ kind: 'entire' }`, this target's "cannot bound
 * this" answer.
 */
function normalizeElement(element: unknown): IntervalResult | undefined {
  if (typeof element === 'number') return ok(point(element));
  if (Array.isArray(element)) return undefined;
  if (element !== null && typeof element === 'object') {
    if ('kind' in element) return element as IntervalResult;
    if ('lo' in element && 'hi' in element) return ok(element as Interval);
  }
  return undefined;
}

/**
 * Positional access into a collection, with an INTERVAL index.
 *
 * The index convention is the interpreter's `At`: 1-based, a negative index
 * counts from the end (`-1` is the last element), and an index of 0, an index
 * out of range, or a non-integer index selects nothing — which this target
 * reports as the numeric absence marker.
 *
 * The index is an interval, so it stands for a SET of indices: the integers in
 * `[index.lo, index.hi]`. Only integers in `[-n, n]` (n = the collection's
 * length) can select anything, so the scan is clipped to that window and is
 * therefore bounded by `2n + 1` iterations however wide — even unbounded — the
 * index interval is. The result is the hull (union) of every element the
 * candidate indices select:
 *
 * - no candidate selects an element (a non-integer point index such as 2.5, an
 *   index of 0, or a range lying entirely outside `[-n, n]`) → absence;
 * - every candidate selects an element → their hull;
 * - some candidates select and some do not → a `partial` result carrying the
 *   hull, marked `domainClipped: 'both'`: the value exists over only part of
 *   the index interval, and the conservative marker does not claim to know
 *   which end was cut.
 *
 * A non-array `coll` selects nothing and answers absence, matching the
 * compiled JavaScript target, whose `_SYS.at` yields its own absence marker
 * for a non-array base.
 *
 * @param coll The collection to index (an array at run time; anything else
 * answers absence).
 * @param index The 1-based index, as an interval or interval result.
 */
function atRaw(
  coll: unknown,
  index: Interval | IntervalResult
): Interval | IntervalResult {
  if (!Array.isArray(coll)) return absent();

  const unwrapped = unwrapOrPropagate(index);
  // An `empty`/`entire`/`singular` index says nothing about which element is
  // selected: propagate it rather than invent a selection.
  if (!Array.isArray(unwrapped)) return unwrapped;
  const iv = unwrapped[0];
  // A NaN endpoint is the absence marker (or an undefined index computation):
  // the integer-range arithmetic below cannot detect it, since every NaN
  // comparison is false.
  if (Number.isNaN(iv.lo) || Number.isNaN(iv.hi)) return absent();

  const n = coll.length;

  // The integers in [iv.lo, iv.hi]. An empty range means the index interval
  // straddles no integer at all (e.g. the point index 2.5).
  const intLo = Math.ceil(iv.lo);
  const intHi = Math.floor(iv.hi);
  if (intLo > intHi) return absent();

  // Clip to the selectable window [-n, n]. A non-finite endpoint simply means
  // the index range extends past the array, which clips to the window edge.
  const clipLo = Math.max(intLo, -n);
  const clipHi = Math.min(intHi, n);

  // Candidates outside the window select nothing.
  let anyAbsent = intLo < clipLo || intHi > clipHi;
  if (clipLo > clipHi) return absent();

  let hull: IntervalResult | undefined = undefined;
  for (let k = clipLo; k <= clipHi; k++) {
    // Index 0 is not a position in the 1-based convention.
    if (k === 0) {
      anyAbsent = true;
      continue;
    }
    const idx = k > 0 ? k - 1 : n + k;
    const element = normalizeElement(coll[idx]);
    // A nested array (a point in a list of points) is a collection, and a
    // collection has no single interval band: report "cannot bound this".
    if (element === undefined) return { kind: 'entire' };
    hull = hull === undefined ? element : unionResults(hull, element);
  }

  if (hull === undefined) return absent();
  if (!anyAbsent) return hull;

  // The value exists for part of the index interval only. A hull with no
  // interval band (`empty`/`entire`/`singular`) cannot be marked partial, so
  // it is returned as it stands.
  const value = getValue(hull);
  if (value === undefined) return hull;
  return { kind: 'partial', value, domainClipped: 'both' };
}

/**
 * The element count of a collection, as a point interval.
 *
 * A non-array operand is not a collection at run time and answers the numeric
 * absence marker rather than a fabricated count.
 */
export function length(coll: unknown): Interval | IntervalResult {
  if (!Array.isArray(coll)) return absent();
  return ok(point(coll.length));
}

/**
 * The `k`-th coordinate (0-based) of a single point.
 *
 * Used by the `PointX`/`PointY`/`PointZ` lowerings, where the operand is one
 * point — an array of coordinates. A coordinate index past the end of the
 * point, or a non-array operand, answers the numeric absence marker (the
 * interpreter yields no value there, and this target projects "no value" to
 * absence). A coordinate that is itself a collection (a nested array) has no
 * single interval band, so it answers `entire`.
 */
export function component(coll: unknown, k: number): Interval | IntervalResult {
  if (!Array.isArray(coll)) return absent();
  if (!Number.isInteger(k) || k < 0 || k >= coll.length) return absent();
  const element = normalizeElement(coll[k]);
  if (element === undefined) return { kind: 'entire' };
  return element;
}

// Every operation above is exported through `liftJump` so that a finite
// jump in an operand (a `singular` result carrying a `value`) is re-tagged
// on the result instead of being forgotten — see `liftJump` in `util.ts`.
export const at = liftJump(atRaw);
