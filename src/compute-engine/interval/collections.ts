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
 * as its result (`IntervalValue` in `compilation/types.ts`); `at` projects a
 * collection OPERAND back down to a single interval, which is the only value
 * the scalar kernels take.
 *
 * The target's numeric marker is the whole-NaN bare interval
 * `{ lo: NaN, hi: NaN }`, which `at` answers for an operand that is not
 * a collection. An `At` whose index
 * selects nothing answers the `empty` result, the spelling of an absent value
 * everywhere else on this target. `isAbsent` (`interval/comparison.ts`) reads
 * both as absent.
 *
 * @module interval/collections
 */

import type { Interval, IntervalResult } from './types.js';
import { rangeCount } from '../numerics/range-count.js';
import { undecided } from './comparison.js';
import {
  getValue,
  ok,
  point,
  unionResults,
  unwrapOrPropagate,
  liftJump,
} from './util.js';

/**
 * The band-less interval result a NON-ARRAY collection operand may be — an
 * `entire`, a `singular` pole, an `empty` — which `at` must PROPAGATE rather
 * than read as "not a collection": the value may exist and just could not be
 * bounded, and answering the absence marker there would let a plotter
 * exclude a region that has a value. Answers `undefined` for anything else (a
 * plain number, a bare interval, a record), which `at` then treats as an
 * operand that is not a collection at run time.
 */
function propagatedNonCollection(coll: unknown): IntervalResult | undefined {
  if (coll === null || typeof coll !== 'object' || !('kind' in coll))
    return undefined;
  const result = coll as IntervalResult;
  return getValue(result) === undefined ? result : undefined;
}

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
 * The value of an `At` whose index selects no element: the `empty` result,
 * the spelling of an absent value that compiled code of this target gives
 * everywhere else (a restriction whose condition fails, a written `Missing`).
 * The interpreter answers no value there either. Fresh for the reason
 * `absent()` is.
 */
function nothingSelected(): IntervalResult {
  return { kind: 'empty' };
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
 * reports as the `empty` result (`nothingSelected`).
 *
 * The index is an interval, so it stands for a SET of indices: the integers in
 * `[index.lo, index.hi]`. Only integers in `[-n, n]` (n = the collection's
 * length) can select anything, so the scan is clipped to that window and is
 * therefore bounded by `2n + 1` iterations however wide — even unbounded — the
 * index interval is. The result is the hull (union) of every element the
 * candidate indices select:
 *
 * - no candidate selects an element (a non-integer point index such as 2.5, an
 *   index of 0, or a range lying entirely outside `[-n, n]`) → `empty`;
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
  if (!Array.isArray(coll)) return propagatedNonCollection(coll) ?? absent();

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
  if (intLo > intHi) return nothingSelected();

  // Clip to the selectable window [-n, n]. A non-finite endpoint simply means
  // the index range extends past the array, which clips to the window edge.
  const clipLo = Math.max(intLo, -n);
  const clipHi = Math.min(intHi, n);

  // Candidates outside the window select nothing.
  let anyAbsent = intLo < clipLo || intHi > clipHi;
  if (clipLo > clipHi) return nothingSelected();

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

  if (hull === undefined) return nothingSelected();
  if (!anyAbsent) return hull;

  // The value exists for part of the index interval only. A hull with no
  // interval band (`empty`/`entire`/`singular`) cannot be marked partial, so
  // it is returned as it stands.
  const value = getValue(hull);
  if (value === undefined) return hull;
  return { kind: 'partial', value, domainClipped: 'both' };
}

/**
 * The point intervals of a constant list of numbers: the run-time value of a
 * `List` literal whose every element is a plain number literal.
 *
 * The interval target spells such a list as `_IA.points([4, 4.5, …])` over
 * the array of numbers, not as `[_IA.point(4), _IA.point(4.5), …]`
 * (`compilation/ir/print-interval.ts`). The
 * elementwise spelling made every element a constant of its own, which the
 * constant-table pass bound to a name before it bound the array: a list of N
 * numbers cost N + 1 declarations. The compact spelling is one constant,
 * evaluated once when the runner is built, and the value is the same array
 * of degenerate intervals the elementwise spelling built.
 */
export function points(values: readonly number[]): Interval[] {
  return values.map((v) => point(v));
}

// Every operation above is exported through `liftJump` so that a finite
// jump in an operand (a `singular` result carrying a `value`) is re-tagged
// on the result instead of being forgotten — see `liftJump` in `util.ts`.
export const at = liftJump(atRaw);

/**
 * The count of `Range(lo, hi, step)` of numbers, the length of a list of the
 * interval mode of the IR pipeline: the engine's `rangeCount()`. A count of
 * 2^32 or more (also an infinite one) is no length of an array, which has at
 * most 2^32 - 1 elements, and throws the error of `undecided()`, which
 * `run()` and `broadcast()` answer with `entire`.
 */
export function rangeCountOf(lo: number, hi: number, step: number): number {
  const n = rangeCount(lo, hi, step);
  if (n < 2 ** 32) return n;
  return undecided('A Range of 2^32 elements or more');
}
