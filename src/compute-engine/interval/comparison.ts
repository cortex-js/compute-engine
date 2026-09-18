/**
 * Comparison and conditional interval operations
 *
 * @module interval/comparison
 */

import type { Interval, IntervalResult, BoolInterval } from './types.js';
import { unionResults, unwrapOrPropagate, liftJump } from './util.js';

/**
 * Normalize a value that may be a plain Interval or an IntervalResult.
 *
 * Exported because the compiled, closure-free lowering of a conditional calls
 * it on the arm a decided condition selected: `piecewise` normalizes its
 * answer, so the ternary chain that replaced it has to normalize the same way
 * or a conditional would answer a bare `{ lo, hi }` where it used to answer an
 * `{ kind: 'interval', value }`.
 */
export function asResult(x: Interval | IntervalResult): IntervalResult {
  if ('kind' in x) return x;
  return { kind: 'interval', value: x };
}

/** A tri-state verdict, as the relations and connectives answer one. */
function isVerdict(x: unknown): x is BoolInterval {
  return x === 'true' || x === 'false' || x === 'maybe';
}

/**
 * A value of this target's value model, as the compiled code passes one
 * around: an enclosure (bare or kinded), a tri-state verdict, or an array of
 * such values (a collection at a consuming position). The compiled call
 * sites are untyped source; this type is what the helpers below accept and
 * answer, so a caller inside the library sees the real domain.
 */
export type IntervalModelValue =
  | Interval
  | IntervalResult
  | BoolInterval
  | IntervalModelValue[];

/**
 * `asResult` over any value of this target's value model: an interval is
 * wrapped, while an ARRAY (a collection value at a consuming position) and a
 * VERDICT pass through unchanged — wrapping either would hand a consumer a
 * result whose `value` is not an enclosure. The compiled conditional
 * lowering spells `_IA.res(…)` around an arm it did not build itself.
 */
export function asValueResult(x: unknown): unknown {
  if (Array.isArray(x) || isVerdict(x) || x === null || typeof x !== 'object')
    return x;
  return asResult(x as Interval | IntervalResult);
}

/** Each element of a list marked as present over part of the cell only — the
 * list under an undecided restriction. */
function clipElements(list: unknown[]): IntervalModelValue[] {
  return list.map((el) => restrict('maybe', () => el));
}

/**
 * The hull of two values of this target's value model, what a conditional
 * answers when its condition is undecided: for two enclosures their union;
 * for two ARRAYS the elementwise hull, or the absence marker when their
 * lengths differ (the same answer a broadcast gives a length mismatch); for
 * two VERDICTS the verdict both agree on, else `'maybe'`. A mix of domains
 * (an array against a scalar) is the marker: no single value encloses both.
 */
export function hullValues(a: unknown, b: unknown): unknown {
  // `empty` contributes no value to a hull, whatever the other side is: a
  // default-less `Which` whose one arm is a list hulls that list with the
  // `empty` of no selection when its condition is undecided, and must keep
  // the list — element by element, each clipped, since the list is present
  // over part of the cell only.
  const isEmpty = (x: unknown): boolean =>
    x !== null &&
    typeof x === 'object' &&
    !Array.isArray(x) &&
    (x as IntervalResult).kind === 'empty';
  // A scalar keeps its kinded spelling, as the union always answered one.
  if (isEmpty(a)) return Array.isArray(b) ? clipElements(b) : asValueResult(b);
  if (isEmpty(b)) return Array.isArray(a) ? clipElements(a) : asValueResult(a);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return { lo: NaN, hi: NaN };
    return a.map((x, i) => hullValues(x, b[i]));
  }
  if (isVerdict(a) || isVerdict(b)) {
    if (!isVerdict(a) || !isVerdict(b)) return { lo: NaN, hi: NaN };
    return a === b ? a : 'maybe';
  }
  return unionResults(
    asResult(a as Interval | IntervalResult),
    asResult(b as Interval | IntervalResult)
  );
}

/**
 * Less than comparison for intervals.
 *
 * Returns:
 * - 'true' if a is entirely less than b (a.hi < b.lo)
 * - 'false' if a is entirely greater than or equal to b (a.lo >= b.hi)
 * - 'maybe' if intervals overlap
 */
export function less(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): BoolInterval {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return 'maybe';
  const [aVal, bVal] = unwrapped;
  if (aVal.hi < bVal.lo) return 'true';
  if (aVal.lo >= bVal.hi) return 'false';
  return 'maybe';
}

/**
 * Less than or equal comparison for intervals.
 */
export function lessEqual(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): BoolInterval {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return 'maybe';
  const [aVal, bVal] = unwrapped;
  if (aVal.hi <= bVal.lo) return 'true';
  if (aVal.lo > bVal.hi) return 'false';
  return 'maybe';
}

/**
 * Greater than comparison for intervals.
 */
export function greater(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): BoolInterval {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return 'maybe';
  const [aVal, bVal] = unwrapped;
  if (aVal.lo > bVal.hi) return 'true';
  if (aVal.hi <= bVal.lo) return 'false';
  return 'maybe';
}

/**
 * Greater than or equal comparison for intervals.
 */
export function greaterEqual(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): BoolInterval {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return 'maybe';
  const [aVal, bVal] = unwrapped;
  if (aVal.lo >= bVal.hi) return 'true';
  if (aVal.hi < bVal.lo) return 'false';
  return 'maybe';
}

/**
 * Equality comparison for intervals.
 *
 * Returns:
 * - 'true' only if both are point intervals with same value
 * - 'false' if intervals don't overlap
 * - 'maybe' if intervals overlap
 */
export function equal(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): BoolInterval {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return 'maybe';
  const [aVal, bVal] = unwrapped;
  // Equal only if both are point intervals with same value
  if (aVal.lo === aVal.hi && bVal.lo === bVal.hi && aVal.lo === bVal.lo)
    return 'true';
  // Definitely not equal if intervals don't overlap
  if (aVal.hi < bVal.lo || bVal.hi < aVal.lo) return 'false';
  return 'maybe';
}

/**
 * Not equal comparison for intervals.
 */
export function notEqual(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): BoolInterval {
  const eq = equal(a, b);
  if (eq === 'true') return 'false';
  if (eq === 'false') return 'true';
  return 'maybe';
}

/**
 * Logical AND for boolean intervals.
 */
export function and(a: BoolInterval, b: BoolInterval): BoolInterval {
  if (a === 'false' || b === 'false') return 'false';
  if (a === 'true' && b === 'true') return 'true';
  return 'maybe';
}

/**
 * Logical OR for boolean intervals.
 */
export function or(a: BoolInterval, b: BoolInterval): BoolInterval {
  if (a === 'true' || b === 'true') return 'true';
  if (a === 'false' && b === 'false') return 'false';
  return 'maybe';
}

/**
 * Logical NOT for boolean intervals.
 */
export function not(a: BoolInterval): BoolInterval {
  if (a === 'true') return 'false';
  if (a === 'false') return 'true';
  return 'maybe';
}

/**
 * Piecewise (conditional) evaluation for intervals.
 *
 * When the condition is indeterminate ('maybe'), both branches
 * are evaluated and the union (hull) is returned.
 *
 * @param x - Input interval
 * @param condition - Function that evaluates the condition
 * @param trueBranch - Function for when condition is true
 * @param falseBranch - Function for when condition is false
 */
function piecewiseRaw(
  xOrCond: Interval | IntervalResult | BoolInterval,
  conditionOrTrue:
    | ((x: Interval) => BoolInterval)
    | (() => Interval | IntervalResult),
  trueOrFalse:
    | ((x: Interval) => Interval | IntervalResult)
    | (() => Interval | IntervalResult),
  falseBranch?: (x: Interval) => Interval | IntervalResult
): IntervalResult {
  if (xOrCond === 'true' || xOrCond === 'false' || xOrCond === 'maybe') {
    const cond = xOrCond;
    const trueBranch = conditionOrTrue as () => Interval | IntervalResult;
    const falseBranchFn = trueOrFalse as () => Interval | IntervalResult;
    // The arms are values of the target's value model — an enclosure, an
    // array of them, a verdict — and pass through in their own domain.
    switch (cond) {
      case 'true':
        return asValueResult(trueBranch()) as IntervalResult;
      case 'false':
        return asValueResult(falseBranchFn()) as IntervalResult;
      case 'maybe':
        return hullValues(trueBranch(), falseBranchFn()) as IntervalResult;
    }
  }

  const x = xOrCond as Interval | IntervalResult;
  const condition = conditionOrTrue as (x: Interval) => BoolInterval;
  const trueBranch = trueOrFalse as (x: Interval) => Interval | IntervalResult;
  const falseBranchFn = falseBranch as (
    x: Interval
  ) => Interval | IntervalResult;

  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  const cond = condition(xVal);

  switch (cond) {
    case 'true':
      return asResult(trueBranch(xVal));
    case 'false':
      return asResult(falseBranchFn(xVal));
    case 'maybe':
      // Condition is indeterminate - must evaluate both branches
      // and return their union
      const t = asResult(trueBranch(xVal));
      const f = asResult(falseBranchFn(xVal));
      return unionResults(t, f);
  }
}

/**
 * The hull of the two branch values of a conditional whose condition is
 * undecided — what `piecewise` answers for `'maybe'`.
 *
 * The compiler calls it directly from the closure-free lowering of a
 * conditional: a ternary chain picks the arm for a decided condition and calls
 * this routine for an undecided one, so neither arm has to be wrapped in a
 * function the conditional would allocate on every evaluation.
 */
export function hull(a: unknown, b: unknown): IntervalModelValue {
  return hullValues(a, b) as IntervalModelValue;
}

/**
 * Domain restriction (the `When` operator): the value where the condition
 * holds, no value (`empty`) where it does not.
 *
 * The condition is a tri-state `BoolInterval` — a plain JS truthiness test
 * would be unsound, since the strings `'true'`, `'false'` and `'maybe'` are
 * all truthy.
 *
 * On `'maybe'` the input interval straddles the restriction boundary: the
 * value is only attained on part of the input, so report the value range as
 * domain-clipped (`partial`) rather than a clean interval (which would hide
 * the domain edge) or a hard branch pick. `domainClipped: 'both'` is a
 * conservative "some clipping occurred" — which end(s) of the input are
 * outside the condition is not derivable from the tri-state alone.
 */
export function restrict(
  cond: BoolInterval,
  value: () => unknown
): IntervalModelValue {
  if (cond === 'false') return { kind: 'empty' };
  const raw = value();
  // A restricted RELATION (`y ≤ K(x) {K(x) > 0}` as one row) is a verdict:
  // where the restriction fails the relation holds nowhere, where it is
  // undecided the relation holds at most where it held — the conjunction.
  // The JavaScript target reads the same way: its absent condition is
  // falsy.
  if (isVerdict(raw)) return and(cond, raw);
  // A restricted LIST is restricted element by element, so a consumer that
  // reads one element sees that element's own clipping, and `isAbsent` reads
  // the list's own presence off its elements.
  if (Array.isArray(raw)) {
    if (cond === 'true') return raw as IntervalModelValue[];
    return clipElements(raw);
  }
  const v = asResult(raw as Interval | IntervalResult);
  if (cond === 'true') return v;
  // 'maybe'
  if (v.kind === 'interval')
    return { kind: 'partial', value: v.value, domainClipped: 'both' };
  if (v.kind === 'partial') return { ...v, domainClipped: 'both' };
  return v; // empty / singular / entire propagate unchanged
}

/**
 * Is `v` the target's absent value? The compiled interval code spells absence
 * two ways: the whole-NaN bare interval `{ lo: NaN, hi: NaN }` (an
 * out-of-band collection read, a numeric absence handed in by the caller)
 * and the `empty` result (a restriction whose condition failed). A
 * `partial` result is a value that exists over only part of the cell, so the
 * answer there is `'maybe'`; a pole (`singular`) likewise. An array — a
 * collection value at a consuming position — is present, as is `entire` (a
 * value exists, its range is unknown).
 *
 * The answer is a tri-state verdict, not a JavaScript boolean, so it composes
 * with every other condition of this target (`restrict`, `piecewise`, `and`).
 */
export function isAbsent(v: unknown): BoolInterval {
  // A verdict is a present value of the boolean domain.
  if (isVerdict(v)) return 'false';
  // A list reads its presence off its elements: absent when every element
  // is, present over part of the cell when every element is at most that
  // (the list under an undecided restriction), present otherwise. An empty
  // list carries no element to read and counts as present.
  if (Array.isArray(v)) {
    if (v.length === 0) return 'false';
    const verdicts = v.map(isAbsent);
    if (verdicts.every((x) => x === 'true')) return 'true';
    if (verdicts.every((x) => x !== 'false')) return 'maybe';
    return 'false';
  }
  if (v === null || typeof v !== 'object') return 'true';
  if ('kind' in v) {
    const r = v as IntervalResult;
    if (r.kind === 'empty') return 'true';
    if (r.kind === 'entire') return 'false';
    // A NaN enclosure is the marker whatever wrapper carries it: an absent
    // value that flowed through a restriction comes out as a `partial` whose
    // value is the marker.
    if (r.kind !== 'singular' && Number.isNaN(r.value.lo)) return 'true';
    if (r.kind === 'partial' || r.kind === 'singular') return 'maybe';
    return 'false';
  }
  return Number.isNaN((v as Interval).lo) ? 'true' : 'false';
}

/**
 * `v` unless it is absent, else `fallback()`. Where `v` is `partial` — present
 * over part of the cell — either branch may be selected, so the answer is the
 * hull of the value and the fallback, a present interval. The fallback is
 * evaluated only when it can be selected.
 */
export function coalesce(v: unknown, fallback: () => unknown): unknown {
  const verdict = isAbsent(v);
  if (verdict === 'false') return v;
  if (verdict === 'true') return fallback();
  // Present over part of the cell. The fallback fills the rest only when it
  // is itself present there: an absent fallback leaves the value as it is,
  // clipping included — hulling with the marker would wipe every present
  // value, and hulling with `empty` would claim presence everywhere.
  const f = fallback();
  if (isAbsent(f) === 'true') return v;
  // A list present over part of the cell: element by element against a
  // fallback list of the same length, else the hull of the two.
  if (Array.isArray(v)) {
    if (Array.isArray(f) && f.length === v.length)
      return v.map((el, i) => coalesce(el, () => f[i]));
    return hullValues(v, f);
  }
  const r = v as IntervalResult;
  if (r.kind === 'partial') return hullValues(r.value, f);
  return hullValues(r, f);
}

/**
 * Clamp an interval to a range.
 *
 * clamp(x, lo, hi) returns x clamped to [lo, hi].
 */
function clampRaw(
  x: Interval | IntervalResult,
  lo: Interval | IntervalResult,
  hi: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(x, lo, hi);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal, loVal, hiVal] = unwrapped;
  // clamp(x, lo, hi) = min(max(x, lo), hi), applied elementwise to the
  // interval bounds. The previous implementation computed the *intersection*
  // (max of los, min of his), which returns `empty` when x lies entirely
  // outside [lo, hi] — but clamping maps such an x onto the nearer bound, it
  // never produces an empty result.
  const lowered = {
    lo: Math.max(xVal.lo, loVal.lo),
    hi: Math.max(xVal.hi, loVal.hi),
  };
  const resultLo = Math.min(lowered.lo, hiVal.lo);
  const resultHi = Math.min(lowered.hi, hiVal.hi);

  return { kind: 'interval', value: { lo: resultLo, hi: resultHi } };
}

// Every operation above is exported through `liftJump` so that a finite
// jump in an operand (a `singular` result carrying a `value`) is re-tagged
// on the result instead of being forgotten — see `liftJump` in `util.ts`.
export const piecewise = liftJump(piecewiseRaw);
export const clamp = liftJump(clampRaw);
