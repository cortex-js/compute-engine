/**
 * Utility functions for interval arithmetic
 *
 * @module interval/util
 */

import type { Interval, IntervalResult } from './types.js';

/**
 * Wrap a plain interval in an IntervalResult.
 *
 * This is the standard way to return successful interval results.
 */
export function ok(value: Interval): IntervalResult {
  return { kind: 'interval', value };
}

/**
 * Create a point interval from a single number.
 *
 * A point interval [n, n] represents the exact value n.
 */
export function point(n: number): Interval {
  return { lo: n, hi: n };
}

/**
 * Check if an interval contains a periodic extremum.
 *
 * Given an interval [x.lo, x.hi], checks if any point of the form
 * `extremum + n * period` (for some integer n) lies within the interval.
 *
 * Uses inclusive bounds with small epsilon tolerance for floating-point edge cases.
 *
 * @param x - The interval to check
 * @param extremum - The base extremum point (e.g., PI/2 for sin's maximum)
 * @param period - The period of the function (e.g., 2*PI for sin)
 * @returns true if the interval contains an extremum
 */
export function containsExtremum(
  x: Interval,
  extremum: number,
  period: number
): boolean {
  return extremumWithin(x, extremum, period) !== undefined;
}

/**
 * The first point `extremum + n·period` inside the interval `x`, or
 * `undefined`. The bounds are inclusive with a tolerance of `1e-15`, and the
 * search starts below the lower bound by that tolerance: a candidate just
 * below `x.lo` counts as inside, and a search that started at `x.lo` skipped
 * it, so `cot` of the point `π + 1 ulp` found no pole at `π` while the point
 * `π − 1 ulp` did. The kernels that report where a pole lies (`tan`, `cot`,
 * `sec`, `csc`) take the location from here, so that the pole they report is
 * the one that was found.
 */
export function extremumWithin(
  x: Interval,
  extremum: number,
  period: number
): number | undefined {
  const EPS = 1e-15;
  const n = Math.ceil((x.lo - EPS - extremum) / period);
  let candidate = extremum + n * period;
  // The point 0 is exact and has no rounding error, so the tolerance does
  // not apply to it: it is inside only when `x` contains 0. Otherwise the
  // interval `[10⁻¹⁶, 10⁻¹⁶]` would contain the pole of `cot` at 0, while
  // `cot(10⁻¹⁶)` is the finite value `10¹⁶`. The search then continues with
  // the next point above 0.
  if (candidate === 0 && !(x.lo <= 0 && 0 <= x.hi))
    candidate = extremum + (n + 1) * period;
  if (candidate >= x.lo - EPS && candidate <= x.hi + EPS) return candidate;
  return undefined;
}

/**
 * Compute the union (hull) of two interval results.
 *
 * The result contains all values that could result from either input.
 * Used for piecewise functions when the condition is indeterminate.
 */
export function unionResults(
  a: IntervalResult,
  b: IntervalResult
): IntervalResult {
  // Handle special cases
  if (a.kind === 'empty') return b;
  if (b.kind === 'empty') return a;
  // A pole on either side (a `singular` with no enclosure) makes the union
  // a pole, before `entire` gets a say: a pole is the sharper report (it
  // asks for subdivision), and this is the precedence the function always
  // had.
  if (
    (a.kind === 'singular' && a.value === undefined) ||
    (b.kind === 'singular' && b.value === undefined)
  )
    return { kind: 'singular' };
  if (a.kind === 'entire' || b.kind === 'entire') {
    return { kind: 'entire' };
  }
  if (a.kind === 'singular' || b.kind === 'singular') {
    // At least one side is a finite jump: the union is bounded by the hull
    // of the two enclosures and stays `singular`, located at the earliest
    // jump of the two.
    const jumps = [a, b].filter(isJump);
    // Neither side is a pole (ruled out above) nor `empty`/`entire`, so both
    // carry an enclosure.
    const aBound = getValue(a)!;
    const bBound = getValue(b)!;
    return {
      ...earliestJump(jumps),
      kind: 'singular',
      value: {
        lo: Math.min(aBound.lo, bBound.lo),
        hi: Math.max(aBound.hi, bBound.hi),
      },
    };
  }

  // Extract values and domain clip info
  const aVal = a.value;
  const bVal = b.value;
  const aDomainClip = a.kind === 'partial' ? a.domainClipped : null;
  const bDomainClip = b.kind === 'partial' ? b.domainClipped : null;

  const value = {
    lo: Math.min(aVal.lo, bVal.lo),
    hi: Math.max(aVal.hi, bVal.hi),
  };

  // Merge domain clipping info
  if (aDomainClip || bDomainClip) {
    const domainClipped = mergeDomainClip(aDomainClip, bDomainClip);
    return { kind: 'partial', value, domainClipped };
  }

  return { kind: 'interval', value };
}

/**
 * Merge two domain clip indicators.
 *
 * Returns the combined clip indicator when both branches
 * have domain restrictions.
 */
export function mergeDomainClip(
  a: 'lo' | 'hi' | 'both' | null,
  b: 'lo' | 'hi' | 'both' | null
): 'lo' | 'hi' | 'both' {
  if (a === 'both' || b === 'both') return 'both';
  if (a === null) return b!;
  if (b === null) return a;
  if (a === b) return a;
  return 'both'; // 'lo' + 'hi' = 'both'
}

/**
 * Check if an interval is a point interval (lo === hi).
 */
export function isPoint(x: Interval): boolean {
  return x.lo === x.hi;
}

/**
 * Check if an interval contains zero.
 */
export function containsZero(x: Interval): boolean {
  return x.lo <= 0 && x.hi >= 0;
}

/**
 * Check if an interval is entirely positive (lo > 0).
 */
export function isPositive(x: Interval): boolean {
  return x.lo > 0;
}

/**
 * Check if an interval is entirely negative (hi < 0).
 */
export function isNegative(x: Interval): boolean {
  return x.hi < 0;
}

/**
 * Check if an interval is entirely non-negative (lo >= 0).
 */
export function isNonNegative(x: Interval): boolean {
  return x.lo >= 0;
}

/**
 * Check if an interval is entirely non-positive (hi <= 0).
 */
export function isNonPositive(x: Interval): boolean {
  return x.hi <= 0;
}

/**
 * Get the width of an interval.
 */
export function width(x: Interval): number {
  return x.hi - x.lo;
}

/**
 * Get the midpoint of an interval.
 */
export function midpoint(x: Interval): number {
  return (x.lo + x.hi) / 2;
}

/**
 * Extract the enclosure carried by an IntervalResult, if it carries one.
 *
 * `interval` and `partial` results always do; a `singular` result does when
 * it is a finite jump (see `IntervalResult`). Returns undefined for `empty`,
 * `entire` and a pole.
 */
export function getValue(result: IntervalResult): Interval | undefined {
  if (result.kind === 'interval' || result.kind === 'partial') {
    return result.value;
  }
  if (result.kind === 'singular') return result.value;
  return undefined;
}

/**
 * Unwrap an interval from either a plain Interval or an IntervalResult.
 *
 * Used by arithmetic operations to accept both formats for convenience.
 * Returns undefined if the input is an IntervalResult without an enclosure
 * (empty, entire, or a pole).
 */
export function unwrap(input: Interval | IntervalResult): Interval | undefined {
  // Check if it's an IntervalResult
  if ('kind' in input) return getValue(input);
  // Plain interval
  return input;
}

/**
 * Unwrap and propagate errors from IntervalResult inputs.
 *
 * If any input has no enclosure (empty, entire, or a pole), returns that
 * result. Otherwise returns the unwrapped intervals. A finite jump (a
 * `singular` result that carries a `value`) is unwrapped to its enclosure so
 * the operation computes a bound over it; the caller is expected to be
 * wrapped in `liftJump`, which re-tags the operation's result as the same
 * jump.
 */
export function unwrapOrPropagate(
  ...inputs: Array<Interval | IntervalResult>
): Interval[] | IntervalResult {
  const result: Interval[] = [];
  for (const input of inputs) {
    if ('kind' in input) {
      // It's an IntervalResult
      if (input.kind === 'empty') return { kind: 'empty' };
      if (input.kind === 'entire') return { kind: 'entire' };
      if (input.kind === 'singular') {
        if (input.value === undefined) return input;
        result.push(input.value);
        continue;
      }
      // interval or partial - extract value
      result.push(input.value);
    } else {
      // Plain interval
      result.push(input);
    }
  }
  return result;
}

/**
 * A `singular` result for a jump discontinuity located at `at`.
 *
 * The result carries `value` as its enclosure only when that enclosure is
 * finite: a `singular` with a `value` promises a BOUNDED function (see
 * `IntervalResult`), so a step function over an infinite input (`floor` over
 * `[-∞, 3]`) is reported as a pole (no `value`) instead.
 *
 * `atOperand` is the index of the operand whose coordinate `at` is a value
 * in. It is left out for the first operand, which is where a one-operand
 * routine and every step function locate their jump; only a routine that can
 * jump along a LATER operand passes it (`atan2` along its `x` operand).
 */
export function jump(
  at: number | undefined,
  continuity: 'left' | 'right' | undefined,
  value: Interval,
  atOperand?: number
): IntervalResult {
  const r: IntervalResult = { kind: 'singular' };
  if (at !== undefined) r.at = at;
  if (atOperand !== undefined && atOperand !== 0) r.atOperand = atOperand;
  if (continuity !== undefined) r.continuity = continuity;
  if (Number.isFinite(value.lo) && Number.isFinite(value.hi)) r.value = value;
  return r;
}

/** Whether a value is a `singular` result that carries an enclosure (a
 *  finite jump, as opposed to a pole). */
export function isJump(x: unknown): x is {
  kind: 'singular';
  at?: number;
  atOperand?: number;
  continuity?: 'left' | 'right';
  value: Interval;
} {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as { kind?: unknown }).kind === 'singular' &&
    (x as { value?: unknown }).value !== undefined
  );
}

type JumpLocation = {
  at?: number;
  atOperand?: number;
  continuity?: 'left' | 'right';
};

/**
 * The location of the earliest of several jumps: the smallest defined `at`,
 * with the `atOperand` that names its coordinate and its `continuity` — the
 * side omitted when two jumps sit at the same point of the same coordinate
 * and disagree on it (`floor(x) + ceil(x)` at an integer is neither left-
 * nor right-continuous). Two jumps at the same NUMBER in different
 * coordinates (`floor(y) · atan2(y, x)`, where `y = 0` and `x = 0` are both
 * written `0`) locate nothing at all, so no location is reported for that
 * number rather than one belonging to a coordinate the caller cannot name. A
 * jump that is genuinely earlier than such a pair still locates the break.
 */
function earliestJump(jumps: ReadonlyArray<JumpLocation>): JumpLocation {
  let first: JumpLocation | undefined;
  // Set while the earliest `at` seen so far is claimed by two jumps in
  // different coordinates.
  let ambiguous = false;
  for (const j of jumps) {
    if (
      first === undefined ||
      (j.at !== undefined && (first.at === undefined || j.at < first.at))
    ) {
      first = { at: j.at, atOperand: j.atOperand, continuity: j.continuity };
      ambiguous = false;
    } else if (j.at === first.at && !ambiguous) {
      if (j.atOperand !== first.atOperand) ambiguous = true;
      else if (j.continuity !== first.continuity)
        first = { at: first.at, atOperand: first.atOperand };
    }
  }
  const r: JumpLocation = {};
  if (ambiguous) return r;
  if (first?.at !== undefined) r.at = first.at;
  if (first?.atOperand !== undefined) r.atOperand = first.atOperand;
  if (first?.continuity !== undefined) r.continuity = first.continuity;
  return r;
}

/** Is `x` a domain-clipped (`partial`) interval result? */
function isPartial(x: unknown): x is {
  kind: 'partial';
  value: Interval;
  domainClipped: 'lo' | 'hi' | 'both';
} {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as { kind?: unknown }).kind === 'partial'
  );
}

/**
 * Make an operation's answer keep the domain-clip marker of its operands.
 *
 * `unwrapOrPropagate` hands an operation the VALUE of a `partial` operand,
 * so the operation answers a plain `interval` computed over that value — a
 * sound enclosure of the defined part, but one that has forgotten that the
 * input box is only partly inside the domain. Composed over an expression
 * tree the marker was therefore lost one level up: `√(x² − 0.01)` over
 * `x ∈ [−0.3, 0.3]` is `partial` (the radicand is negative on
 * `|x| < 0.1`), but `x + √(x² − 0.01)` answered a bounded `interval`, and a
 * consumer that reads a bounded `interval` as "defined and continuous on
 * the whole box" — an implicit-curve cell classifier — could not tell a
 * domain GAP between two defined ends from a continuous cell (Tycho item
 * 254). When any operand is `partial` and the operation answered an
 * `interval` (or a bare `{ lo, hi }`), the answer is re-tagged `partial`.
 * The clip side is reported as `'both'`, the conservative "some clipping
 * occurred" the `When` restriction also reports: which end of the RESULT
 * the domain edge maps to is not derivable through an arbitrary operation
 * (a negation swaps the ends). `empty`, `entire` and `singular` answers are
 * returned as they are — they were computed over the defined part and
 * already say what they say — and so is an absent-element marker (a bare
 * interval with `NaN` bounds, see `collections.ts`).
 */
function propagatePartial(args: unknown[], result: unknown): unknown {
  if (!args.some(isPartial)) return result;
  if (typeof result !== 'object' || result === null) return result;
  const r = result as Partial<Interval> & { kind?: string; value?: Interval };
  const bound: Interval | undefined =
    r.kind === undefined
      ? (r as Interval)
      : r.kind === 'interval'
        ? r.value
        : undefined;
  if (bound === undefined) return result;
  if (Number.isNaN(bound.lo) || Number.isNaN(bound.hi)) return result;
  return { kind: 'partial', value: bound, domainClipped: 'both' };
}

/**
 * Make an interval operation propagate a finite jump.
 *
 * `unwrapOrPropagate` hands an operation the ENCLOSURE of a jump operand, so
 * the operation answers a plain `interval` computed over that enclosure — a
 * sound bound, but one that has forgotten the discontinuity. This wrapper
 * restores it: when any operand was a jump and the operation answered a
 * finite, non-constant `interval`, the result is re-tagged `singular` with
 * the operation's bound as its `value`, located at the earliest jump among
 * the operands (`earliestJump`). Every other answer is returned as is:
 * - `empty`, `entire` and `singular` were computed over the enclosure, so
 *   they already account for every value the jump can take, and a
 *   `singular` answer is a discontinuity the operation found on its own;
 * - a `partial` keeps its domain-clip marker, which a `singular` cannot
 *   carry (`sqrt(sign(x))` across 0 is clipped below, and `integrate` reads
 *   that marker) — the jump is the information given up there;
 * - a point result (`floor(x)^0`) means the operation is constant over the
 *   whole enclosure, so there is no discontinuity to report;
 * - a non-finite bound is not a finite jump. It is returned untouched rather
 *   than degraded to a pole, so the collection accessors' numeric marker (a
 *   bare `{ lo: NaN, hi: NaN }`, see `collections.ts`) survives
 *   `at(v, floor(x))` over an operand `v` that is not a collection, and a
 *   division that reaches an infinite bound
 *   keeps the `partial` shape `div` gives it.
 *
 * Every exported operation that takes interval operands and returns an
 * `IntervalResult` is wrapped, so a jump survives an arbitrary expression
 * tree: `2·floor(x) + 1` over `[0.5, 1.5]` is `singular` with
 * `value: [1, 3]`. Operands that are not interval results (a number
 * exponent, a callback, a collection) pass through untouched.
 */
export function liftJump<F extends (...args: never[]) => unknown>(fn: F): F {
  const raw = fn as unknown as (...a: unknown[]) => unknown;
  const lifted = (...args: unknown[]) => {
    const jumps = args.filter(isJump);
    const result = propagatePartial(args, raw(...args));
    if (jumps.length === 0) return result;
    if (typeof result !== 'object' || result === null) return result;
    // A bare `{ lo, hi }` (the collection accessors answer one) or an
    // `interval` result: both carry the bound to re-tag.
    const r = result as Partial<Interval> & { kind?: string; value?: Interval };
    const bound: Interval | undefined =
      r.kind === undefined
        ? (r as Interval)
        : r.kind === 'interval'
          ? r.value
          : undefined;
    if (bound === undefined) return result;
    if (!Number.isFinite(bound.lo) || !Number.isFinite(bound.hi)) return result;
    if (bound.lo === bound.hi) return result;
    return { ...earliestJump(jumps), kind: 'singular', value: bound };
  };
  return lifted as unknown as F;
}

/**
 * The set of values that a declared parameter type admits, as the compiled
 * call of a user function tests it (`checkedCall`): the integers when
 * `integer` is true, between the bounds `lower` and `upper` when they are
 * given. A bound is inclusive, unless `lowerOpen` or `upperOpen` excludes
 * it (`real<0<..>` is `{ lower: 0, lowerOpen: true }`). Every such set holds
 * finite values only.
 */
export type ParameterDomain = {
  integer?: boolean;
  lower?: number;
  upper?: number;
  lowerOpen?: boolean;
  upperOpen?: boolean;
};

/**
 * The argument `x` restricted to the values of `domain`, or `undefined`
 * when `x` has none of them.
 *
 * A point interval is the value it holds: it is kept when the value is in
 * the domain. A wider interval is clipped to the part the domain admits
 * (`[0.5, 3.5]` at an integer parameter is `[1, 3]`), so the function is
 * evaluated only where the interpreter gives a value (at an excluded bound,
 * the clipped interval keeps the bound itself, as a closed interval must). An argument with no
 * enclosure (`empty`, `entire`, a pole), an argument with a `NaN` bound, and
 * a value that is not an interval are passed through unchanged: the
 * interpreter admits a `NaN` at every numeric parameter.
 *
 * `partly` is true when the domain does not hold every value of `x`: the
 * interval was clipped, or it is wider than a point at an integer
 * parameter, which has no value between two integers.
 */
function parameterDomainValue(
  x: unknown,
  domain: ParameterDomain
): { value: unknown; partly: boolean } | undefined {
  let v: Interval | undefined;
  if (typeof x === 'number') v = point(x);
  else if (typeof x === 'object' && x !== null && !Array.isArray(x)) {
    v =
      'kind' in x
        ? getValue(x as IntervalResult)
        : typeof (x as Interval).lo === 'number' &&
            typeof (x as Interval).hi === 'number'
          ? (x as Interval)
          : undefined;
  }
  if (v === undefined || Number.isNaN(v.lo) || Number.isNaN(v.hi))
    return { value: x, partly: false };
  // A point at an infinity is not a finite value. An infinite bound of a
  // wider interval only says that the interval is unbounded.
  if (v.lo === v.hi && !Number.isFinite(v.lo)) return undefined;
  let lo = v.lo;
  let hi = v.hi;
  if (domain.lower !== undefined) lo = Math.max(lo, domain.lower);
  if (domain.upper !== undefined) hi = Math.min(hi, domain.upper);
  if (domain.integer === true) {
    lo = Math.ceil(lo);
    hi = Math.floor(hi);
  }
  if (!(lo <= hi)) return undefined;
  // An excluded bound: an interval that reaches past it only AT the bound
  // holds no admitted value. Otherwise the clipped interval keeps the bound
  // as its endpoint, which still encloses every admitted value.
  if (domain.lowerOpen === true && hi <= domain.lower!) return undefined;
  if (domain.upperOpen === true && lo >= domain.upper!) return undefined;
  const partly = domain.integer === true && lo < hi;
  if (lo === v.lo && hi === v.hi) return { value: x, partly };
  return { value: { lo, hi }, partly: true };
}

/**
 * The result `r` of a call whose arguments the domains of the parameters
 * did not hold whole (`checkedCall`): the function has a value on a part
 * of the input box only, which a `partial` result says. An `interval`
 * result, or a bare `{ lo, hi }` (the collection accessors answer one),
 * becomes `partial`, and the clip side of a `partial` result becomes
 * `'both'`: which end of the result the edge of the domain maps to is not
 * known (see `propagatePartial`). A list result is changed element by
 * element. Any other result (`empty`, `entire`, `singular`, a boolean
 * answer, an absent element with `NaN` bounds) is returned as it is.
 */
function partialResult(r: unknown): unknown {
  if (Array.isArray(r)) return r.map(partialResult);
  if (typeof r !== 'object' || r === null) return r;
  const x = r as Partial<Interval> & { kind?: string; value?: Interval };
  const bound: Interval | undefined =
    x.kind === undefined
      ? typeof x.lo === 'number' && typeof x.hi === 'number'
        ? (x as Interval)
        : undefined
      : x.kind === 'interval' || x.kind === 'partial'
        ? x.value
        : undefined;
  if (bound === undefined) return r;
  if (Number.isNaN(bound.lo) || Number.isNaN(bound.hi)) return r;
  return { kind: 'partial', value: bound, domainClipped: 'both' };
}

/**
 * The call `f(...args)` of a compiled user function whose parameters have
 * declared types that the static types of the arguments do not prove.
 *
 * `domains[i]` lists the domains (`ParameterDomain`) of the declared types
 * of parameter `i`, or is `null` when the parameter is not tested. Each
 * tested argument is restricted to its domains before the call. When an
 * argument has no value in a domain, the interpreter gives an
 * `incompatible-type` error for the call, and the call is `empty`: the
 * function has no value there. When a domain holds a part of an argument
 * only, the function has a value on that part of the input box only, and
 * the result is `partial` (`partialResult`).
 */
export function checkedCall(
  f: (...args: unknown[]) => unknown,
  domains: ReadonlyArray<ReadonlyArray<ParameterDomain> | null>,
  ...args: unknown[]
): unknown {
  const passed = args.slice();
  let partly = false;
  for (let i = 0; i < passed.length; i++) {
    const ds = domains[i];
    if (ds === null || ds === undefined) continue;
    for (const d of ds) {
      const r = parameterDomainValue(passed[i], d);
      if (r === undefined) return { kind: 'empty' };
      passed[i] = r.value;
      if (r.partly) partly = true;
    }
  }
  const result = f(...passed);
  return partly ? partialResult(result) : result;
}
