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
 * The band-less interval result a NON-ARRAY collection operand may be — the
 * `entire` a run-time `range` answers for a wide bound, a `singular` pole, an
 * `empty` — which every accessor must PROPAGATE rather than read as "not a
 * collection": the value exists (a range with a wide bound has some length),
 * it just could not be bounded, and answering the absence marker there would
 * let a plotter exclude a region that has a value. Answers `undefined` for
 * anything else (a plain number, a bare interval, a record), which the
 * accessors then treat as an operand that is not a collection at run time.
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
 * absence marker rather than a fabricated count — unless it is a band-less
 * interval result (`propagatedNonCollection`), which is passed through.
 */
export function length(coll: unknown): Interval | IntervalResult {
  if (!Array.isArray(coll)) return propagatedNonCollection(coll) ?? absent();
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
  if (!Array.isArray(coll)) return propagatedNonCollection(coll) ?? absent();
  if (!Number.isInteger(k) || k < 0 || k >= coll.length) return absent();
  const element = normalizeElement(coll[k]);
  if (element === undefined) return { kind: 'entire' };
  return element;
}

/**
 * Is `cell` a single coordinate — a raw number, a bare interval or an
 * interval result — as opposed to a nested array (a point) or anything else?
 * The run-time counterpart of the JavaScript target's `isCoordinate` cell
 * test, for the value model of this target.
 */
function isCoordinateCell(cell: unknown): boolean {
  return normalizeElement(cell) !== undefined;
}

/**
 * The `k`-th coordinate (0-based) of a point OR of every point of a list of
 * points, decided from the run-time value — the interval counterpart of the
 * JavaScript target's `_SYS.pointComponent`, and of the interpreter's
 * `pointComponentAt` (`library/collections.ts`).
 *
 * The compiler emits this where the operand is a list of points, or where its
 * static type admits a list of points beside a single point (a
 * `tuple | list<tuple>` union, an untyped operand): both readings are arrays
 * at run time, and only the value tells them apart.
 *
 * - A non-array is not a collection and answers the absence marker — unless
 *   it is a band-less interval result (`propagatedNonCollection`), which is
 *   passed through.
 * - An EMPTY array is the one shape both readings spell the same way. The
 *   caller settles it from the declared element type and states the answer
 *   in `emptyBroadcasts`: the coordinate of zero points is the empty list
 *   (the interpreter's `PointX([])`), while an element-INDEXING operand has
 *   no coordinate there and answers the absence marker.
 * - An array whose first element is an array of coordinate cells is a list
 *   of points, and the coordinate is taken from every point: the array of
 *   `component(p, k)`, an element that is not a point answering the absence
 *   marker at its position. A row that holds a non-coordinate cell is not a
 *   point (the interpreter's `isPointLike` requires every cell to be a
 *   number), so the array is read as one point and element-indexes — unless
 *   the compiler PROVED a list of points from the static type and says so
 *   in `rows` (`list<tuple<string, number>>`: every element is a point by
 *   its type, whatever its other coordinates hold).
 * - The third coordinate of a two-component point, or of a list whose points
 *   have two components, is the interpreter's `incompatible-dimensions`
 *   error for the WHOLE application, projected to a single absence marker —
 *   never one marker per point.
 * - Otherwise the array is one point, and this is `component(coll, k)`.
 *
 * A nested array holds intervals or interval results, and `component`
 * answers each as it stands (an `IntervalResult` keeps its kind), so the
 * result is an `IntervalValue` array as a comprehension root builds one.
 */
export function pointComponent(
  coll: unknown,
  k: number,
  emptyBroadcasts = true,
  rows?: boolean
): unknown {
  if (!Array.isArray(coll)) return propagatedNonCollection(coll) ?? absent();
  if (coll.length === 0) return emptyBroadcasts ? [] : absent();
  const first: unknown = coll[0];
  rows ??= Array.isArray(first) && first.every(isCoordinateCell);
  const arity = rows && Array.isArray(first) ? first.length : coll.length;
  if (k === 2 && arity < 3) return absent();
  if (rows)
    return coll.map((p: unknown) =>
      Array.isArray(p) ? component(p, k) : absent()
    );
  return component(coll, k);
}

// Every operation above is exported through `liftJump` so that a finite
// jump in an operand (a `singular` result carrying a `value`) is re-tagged
// on the result instead of being forgotten — see `liftJump` in `util.ts`.
export const at = liftJump(atRaw);

/**
 * One collection ELEMENT as an interval operand for a kernel: a raw number
 * becomes the degenerate interval `[n, n]`, an interval or interval result is
 * passed as it stands, a nested array stays an array (the broadcast descends
 * into it), and a hole (`undefined`, a sparse array) is the absence marker.
 */
function elementOperand(element: unknown): unknown {
  if (typeof element === 'number') return point(element);
  if (element === undefined || element === null) return absent();
  return element;
}

/**
 * The element count the run-time collection builders accept. A collection
 * wider than this has no array representation here: `range` answers
 * `entire` ("cannot bound this") instead of allocating it.
 */
const MAX_RUNTIME_COLLECTION_LENGTH = 1_000_000;

/**
 * Element-wise application of a scalar kernel over collection operands — the
 * interval counterpart of the JavaScript target's `_SYS.bcast`.
 *
 * `f` is the kernel over SCALAR intervals. Each argument is either a scalar
 * (an interval, an interval result, a raw number) or a run-time collection (a
 * JavaScript array). With no array among the arguments the kernel is applied
 * once. Otherwise every array must have one length, and the result is the
 * array of the kernel applied position by position, a scalar argument being
 * reused at every position; a nested array at a position recurses, so a list
 * of lists broadcasts to its leaves. This is the interpreter's element-wise
 * rule for a broadcastable operator (`sin([1, 2])` is `[sin 1, sin 2]`, and
 * `[1, 2] + [10, 20]` is `[11, 22]`).
 *
 * Two shapes have no element-wise value, and the answer for both is the
 * numeric ABSENCE marker rather than an enclosure:
 *
 * - arrays of different lengths, which the interpreter reports as the
 *   `incompatible-dimensions` error at every point of the plane (the lengths
 *   do not depend on the evaluation point), so "no value" is exact, and it is
 *   what the JavaScript target answers there (`NaN`);
 * - an EMPTY array, which the interpreter answers with `Nothing` for an
 *   operator position (`sin([])` evaluates to `Nothing`, not to `[]`).
 *
 * The compiler emits a call to this function only when every collection
 * argument's static type proves a list of numbers (`tryIntervalBroadcast`
 * in `compilation/interval-javascript-target.ts`); a wider operand keeps the
 * scalar-kernel gate, so a value that is not a list of intervals never
 * reaches here from compiled code.
 */
export function bcast(
  f: (...operands: unknown[]) => unknown,
  ...args: unknown[]
): unknown {
  return bcastWith(false, f, args);
}

/**
 * `bcast` for the application of a USER FUNCTION to its arguments (`f(L)`
 * with `f(x) := x²`): the same element-wise rule, except that an EMPTY list
 * argument answers the empty list — the interpreter zips zero elements into
 * `[]` there, where an operator over an empty list answers `Nothing`.
 */
export function bcastFn(
  f: (...operands: unknown[]) => unknown,
  ...args: unknown[]
): unknown {
  return bcastWith(true, f, args);
}

/** Shared implementation of `bcast` and `bcastFn`; `emptyIsList` selects
 *  what an empty position answers, and is carried into nested positions. */
function bcastWith(
  emptyIsList: boolean,
  f: (...operands: unknown[]) => unknown,
  args: unknown[]
): unknown {
  let n = -1;
  for (const a of args) {
    if (!Array.isArray(a)) continue;
    if (n < 0) n = a.length;
    else if (a.length !== n) return absent();
  }
  if (n < 0) return f(...args);
  if (n === 0) return emptyIsList ? [] : absent();
  const out: unknown[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let nested = false;
    const cell = args.map((a) => {
      const x = Array.isArray(a) ? elementOperand(a[i]) : a;
      if (Array.isArray(x)) nested = true;
      return x;
    });
    out[i] = nested ? bcastWith(emptyIsList, f, cell) : f(...cell);
  }
  return out;
}

/**
 * Element-wise application of a scalar kernel over operands of which some are
 * POINTS — the interval counterpart of the interpreter's point arithmetic
 * (point ± point, scalar × point, point / scalar, the negation of a point,
 * each coordinate-wise), and of its rule for a list beside a point: one point
 * per element of the list.
 *
 * `kinds` has one letter per argument, stated by the compiler from the static
 * types, because the run-time value cannot tell a point from a list of two
 * numbers:
 *
 * - `'p'`, an argument that is exactly ONE point: the array of its
 *   coordinates, never inspected further (a coordinate may itself be an
 *   array, the value of a `broadcastable<number>` coordinate, and is then
 *   zipped like any nested array);
 * - `'q'`, an argument that is a point OR a list of points (a
 *   `list<tuple<…>>`, a point-or-point-list union): an array whose first
 *   element is an array is a LIST of points, an empty array is the list of
 *   zero points, and any other array is one point. A single point whose first
 *   coordinate is an array reads as a list here; the compiler states `'q'`
 *   only where the type does not prove one point;
 * - `'s'`, a number-valued argument: an array is a LIST of numbers, anything
 *   else is one number.
 *
 * With no list among the arguments, the result is one point: `bcast` over the
 * arguments, which zips the coordinates of the points and reuses a number at
 * every coordinate. Otherwise every list must have one length `n`, and the
 * result is the list of `n` values obtained by taking element `i` of every
 * list and the whole of every other argument, and applying this same rule to
 * them — so a list of lists of points descends level by level and the point
 * keeps its identity at every level. `[1, 2]·(10, 20)` is
 * `[(10, 20), (20, 40)]`, which a plain zip of the two arrays would read as
 * the single point `(10, 40)`. Lists of different lengths have no value (the
 * interpreter's `incompatible-dimensions` error) and answer the absence
 * marker; zero points are the empty list, as the interpreter answers for
 * `[]·(10, 20)`.
 */
export function bcastPoint(
  f: (...operands: unknown[]) => unknown,
  kinds: string,
  ...args: unknown[]
): unknown {
  const isList = args.map((a, i) => {
    if (!Array.isArray(a) || kinds[i] === 'p') return false;
    if (kinds[i] === 'q') return a.length === 0 || Array.isArray(a[0]);
    return true;
  });
  let n = -1;
  for (let i = 0; i < args.length; i++) {
    if (!isList[i]) continue;
    const length = (args[i] as unknown[]).length;
    if (n < 0) n = length;
    else if (length !== n) return absent();
  }
  if (n < 0) return bcast(f, ...args);
  const out: unknown[] = new Array(n);
  for (let i = 0; i < n; i++)
    out[i] = bcastPoint(
      f,
      kinds,
      ...args.map((a, j) =>
        isList[j] ? elementOperand((a as unknown[])[i]) : a
      )
    );
  return out;
}

/**
 * `Map(f, collection)` at run time: the array of `f` applied to each element
 * (a raw number element is lifted to a point interval first). A non-array
 * operand is not a collection at run time and answers the numeric absence
 * marker, as the accessors do — unless it is a band-less interval result
 * (`propagatedNonCollection`), which is passed through.
 */
export function map(f: (element: unknown) => unknown, coll: unknown): unknown {
  if (!Array.isArray(coll)) return propagatedNonCollection(coll) ?? absent();
  return coll.map((element) => f(elementOperand(element)));
}

/**
 * The scalar a run-time BOUND of a range stands for, or `undefined` when the
 * bound is not one number: a bound is an interval (bare, or wrapped in an
 * interval result), and only a POINT interval names one element count. A
 * wide bound would make the range's length depend on where in the bound the
 * true value lies, and a list of varying length has no array representation
 * on this target.
 */
function pointBound(bound: unknown): number | undefined {
  if (typeof bound === 'number')
    return Number.isFinite(bound) ? bound : undefined;
  const normalized = normalizeElement(bound);
  if (normalized === undefined) return undefined;
  const iv = getValue(normalized);
  if (iv === undefined) return undefined;
  if (!Number.isFinite(iv.lo) || iv.lo !== iv.hi) return undefined;
  return iv.lo;
}

/**
 * `Range(lo, hi, step)` at run time, as an array of point intervals — the
 * interpreter's contract, mirrored from `literalRange` (`library/
 * collections.ts`): `Range(hi)` counts from 1 in steps of 1; a two-operand
 * range infers step ±1 from the order of its bounds; the elements are
 * `lo + i·step` for `i` below the count `max(0, floor((hi − lo) / step) + 1)`
 * (a zero step is the empty range).
 *
 * Every bound must be a POINT interval at run time (`pointBound`): a wide
 * bound gives a range of varying length, which no array can hold, and the
 * answer is then `entire` — "cannot bound this" — never a range of some
 * length chosen from inside the bound. The same answer for a count past
 * `MAX_RUNTIME_COLLECTION_LENGTH`.
 */
export function range(
  first: unknown,
  second?: unknown,
  third?: unknown
): unknown {
  const a = pointBound(first);
  if (a === undefined) return { kind: 'entire' };
  let lo: number;
  let hi: number;
  let step: number;
  if (second === undefined) [lo, hi, step] = [1, a, 1];
  else {
    const b = pointBound(second);
    if (b === undefined) return { kind: 'entire' };
    if (third === undefined) [lo, hi, step] = [a, b, b >= a ? 1 : -1];
    else {
      const s = pointBound(third);
      if (s === undefined) return { kind: 'entire' };
      [lo, hi, step] = [a, b, s];
    }
  }
  if (step === 0) return [];
  const count = Math.max(0, Math.floor((hi - lo) / step) + 1);
  if (!Number.isFinite(count) || count > MAX_RUNTIME_COLLECTION_LENGTH)
    return { kind: 'entire' };
  const out: Interval[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = point(lo + i * step);
  return out;
}
