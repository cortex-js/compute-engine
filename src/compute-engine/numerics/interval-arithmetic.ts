/**
 * Interval arithmetic for arithmetic RESULT types.
 *
 * The `Add`/`Multiply`/`Abs`/`Power` type handlers compute a result range
 * from their operands' ranged types with the kernel in this module: the
 * type of `x + y` under `assume(x > 2); assume(y > 3)` is `real<5..>`,
 * and `|x|` for `x: real<-3..2>` is `real<0..3>`. This is the
 * interval-arithmetic half of the ROADMAP entry "Ranged types: interval
 * arithmetic and open bounds"; the design, the soundness rules and the
 * scope boundaries are in
 * `docs/plans/2026-08-27-interval-arithmetic-result-types.md`.
 *
 * The kernel NEVER replaces a type JOIN: joins stay strip-first
 * (`stripNumericRanges` — a join is a set union, and a sum does not lie in
 * the union of its terms' ranges). The interval fold is a SEPARATE
 * computation whose result is attached to the tier the existing machinery
 * chose.
 *
 * Model: a closed interval over the extended reals. An endpoint of `±∞`
 * means "unbounded on that side" — which also covers an operand that may
 * BE the infinity (`real<0..>` admits `+∞` under the pre-flip lattice), so
 * no finiteness analysis is needed. NaN is the one value outside the
 * model: an operand whose type admits NaN (`number`) has NO interval, and
 * an endpoint computation that yields NaN (an indeterminate form:
 * `∞ + (−∞)`, `0 · ∞`) drops the claim on that side. Callers must attach
 * a computed range only to a NaN-free result tier.
 */

import { BigDecimal } from '../../big-decimal/index.js';
import { nextDown, nextUp } from './numeric.js';
import type { NumericPrimitiveType, Type } from '../../common/type/types.js';
import { nonNegativeRangeType } from '../../common/type/utils.js';
import { makeNumericRangeType } from '../../common/type/numeric-range.js';

/** A closed interval over the extended reals. `lo ≤ hi`; `±Infinity`
 * means unbounded on that side. Never represents an empty set — a reader
 * that derives `lo > hi` answers `undefined` instead. */
export type Interval = {
  lo: number;
  hi: number;
  /** The lower endpoint is NOT attained (x > lo). Meaningful only for a
   * finite `lo`. Openness is an ATTAINABILITY fact per the rules in
   * `docs/plans/2026-08-28-open-bounds-in-ranged-types.md` §3.5. */
  loOpen?: boolean;
  hiOpen?: boolean;
};

const FULL: Interval = { lo: -Infinity, hi: Infinity };

/** How many significant digits a DERIVED bound keeps (user-ruled
 * 2026-08-27, plan §5 question 1). Coarser than full precision so
 * computed types stay readable (`real<0.33..1.341>`, not
 * seventeen-digit doubles); fine enough that the per-operation loss
 * (0.01–0.1% of the magnitude) is invisible at realistic expression
 * depth. Coarsening only ever moves a bound OUTWARD, so this is a
 * display/tightness trade, never a soundness knob. The literal
 * enclosures keep their own, coarser constant (`ENCLOSURE_DIGITS`,
 * `boxed-expression/boxed-number.ts`). */
const DERIVED_BOUND_DIGITS = 4;

/** The smallest NORMAL double, `2⁻¹⁰²²`. Below it double spacing is the
 * ABSOLUTE constant `5·10⁻³²⁴`, so every "projection error is relative"
 * argument dies: a bound that lands in the subnormal range is dropped
 * rather than projected (the same veto the literal enclosures apply —
 * see `literalEnclosureType` in `boxed-expression/boxed-number.ts`,
 * which imports this constant). */
export const MIN_NORMAL_DOUBLE = 2.2250738585072014e-308;

/** The numeric primitives whose values are totally ordered on the
 * extended real line and exclude NaN — the only tiers an interval can
 * describe, and the only tiers a computed range may attach to.
 * (`non_finite_number` is the signed pair `±∞`, ordered; the new
 * `infinity` primitive is NOT here — it admits the unordered complex
 * infinity `~oo` — and neither is `nan`.) */
const NAN_FREE_REAL_TIERS = new Set<string>([
  'integer',
  'rational',
  'real',
  'non_finite_number',
]);

/**
 * The interval a numeric type claims, or `undefined` when the type makes
 * no real-line claim (a NaN-admitting or complex base, a non-numeric
 * type, a contradictory intersection).
 *
 * This is THE bounds reader: `typeBounds`
 * (`library/type-handlers-types.ts`) delegates to it, so a domain proof
 * and a computed result range can never disagree about the same type.
 *
 * - A numeric VALUE type reads as a point. Value types hold JavaScript
 *   doubles by construction, and the engine reads a double as the decimal
 *   its shortest representation spells (the `isSame` convention), so the
 *   point is exact under that convention. A `±Infinity` value is a
 *   genuine point at the infinity (the closed extended-real reading).
 * - A range reads its bounds; a missing bound is `±∞` on that side. A
 *   range whose BASE admits NaN or a complex value claims nothing.
 * - An intersection ignores members with no interval (sound: the
 *   intersection is a subset of every member — and therefore NaN-free as
 *   soon as one member is) and takes the tightest surviving bounds;
 *   contradictory bounds (`lo > hi`) answer `undefined`.
 * - A union needs EVERY member to answer, and takes the hull.
 * - A transparent alias unfolds (with a cycle guard); a nominal
 *   reference stays opaque.
 */
export function intervalOfType(
  t: Type,
  seen?: Set<object>
): Interval | undefined {
  if (typeof t === 'string')
    return NAN_FREE_REAL_TIERS.has(t) ? FULL : undefined;
  switch (t.kind) {
    case 'value':
      return typeof t.value === 'number' && !Number.isNaN(t.value)
        ? { lo: t.value, hi: t.value }
        : undefined;
    case 'numeric': {
      if (!NAN_FREE_REAL_TIERS.has(t.type)) return undefined;
      const iv: Interval = { lo: t.lower ?? -Infinity, hi: t.upper ?? Infinity };
      if (t.lowerOpen) iv.loOpen = true;
      if (t.upperOpen) iv.hiOpen = true;
      return iv;
    }
    case 'reference': {
      if (!t.alias || t.def === undefined) return undefined;
      seen ??= new Set();
      if (seen.has(t)) return undefined;
      seen.add(t);
      return intervalOfType(t.def, seen);
    }
    case 'intersection': {
      let lo = -Infinity;
      let hi = Infinity;
      let answered = false;
      // Meet: at an equal endpoint OPEN wins.
      let loOpen = false;
      let hiOpen = false;
      for (const m of t.types) {
        const b = intervalOfType(m, seen);
        if (b === undefined) continue;
        answered = true;
        if (b.lo > lo) {
          lo = b.lo;
          loOpen = b.loOpen === true;
        } else if (b.lo === lo && b.loOpen) loOpen = true;
        if (b.hi < hi) {
          hi = b.hi;
          hiOpen = b.hiOpen === true;
        } else if (b.hi === hi && b.hiOpen) hiOpen = true;
      }
      if (!answered || lo > hi) return undefined;
      if (lo === hi && (loOpen || hiOpen)) return undefined;
      return withFlags({ lo, hi }, loOpen, hiOpen);
    }
    case 'union': {
      // Hull: an endpoint is open only if EVERY member reaching it is open.
      let lo = Infinity;
      let hi = -Infinity;
      let loOpen = true;
      let hiOpen = true;
      for (const m of t.types) {
        const b = intervalOfType(m, seen);
        if (b === undefined) return undefined;
        if (b.lo < lo) {
          lo = b.lo;
          loOpen = b.loOpen === true;
        } else if (b.lo === lo && !b.loOpen) loOpen = false;
        if (b.hi > hi) {
          hi = b.hi;
          hiOpen = b.hiOpen === true;
        } else if (b.hi === hi && !b.hiOpen) hiOpen = false;
      }
      return lo > hi ? undefined : withFlags({ lo, hi }, loOpen, hiOpen);
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Directed endpoint arithmetic.
//
// Each endpoint operation is computed in doubles and made OUTWARD-sound
// immediately: an error-free transformation (TwoSum for +, Dekker's
// two-product for ×) detects whether the double result rounded past the
// true value, and only then is an ulp-step applied — so exact endpoint
// arithmetic (`2 + 3`, `4 · 5`, the common case for assume-derived integer
// bounds) keeps its exact result instead of acquiring a spurious
// `4.999999999999999`. An overflowed endpoint falls back to the sound
// extreme (`±MAX_VALUE` toward the inside, `±∞` toward the outside), and
// an underflowed-to-zero product steps to `±MIN_VALUE` on the side the
// true sign requires. NaN (an indeterminate form) is returned as NaN for
// the caller to drop.
// ---------------------------------------------------------------------------

/** Directed sum: `dir < 0` returns a value ≤ the exact `a + b`, `dir > 0`
 * a value ≥ it (over the extended reals; NaN for `∞ + (−∞)`). */
function dirSum(a: number, b: number, dir: -1 | 1): number {
  const s = a + b;
  if (Number.isNaN(s)) return NaN;
  if (s === Infinity)
    return Number.isFinite(a) && Number.isFinite(b) && dir < 0
      ? Number.MAX_VALUE
      : Infinity;
  if (s === -Infinity)
    return Number.isFinite(a) && Number.isFinite(b) && dir > 0
      ? -Number.MAX_VALUE
      : -Infinity;
  // TwoSum (Knuth): exact rounding error of the double addition. Exact for
  // every finite input, subnormals included (the error of a double sum is
  // always representable).
  const bb = s - a;
  const err = a - (s - bb) + (b - bb);
  if (dir < 0) return err < 0 ? nextDown(s) : s;
  return err > 0 ? nextUp(s) : s;
}

/** Where Dekker's split is trustworthy: away from overflow of the
 * `2²⁷+1` scaling and from subnormal products. Outside the window the
 * caller uses an unconditional ulp-step, which is always sound. */
const SPLITTER = 134217729; // 2^27 + 1

function productError(a: number, b: number, p: number): number {
  const aS = SPLITTER * a;
  const aHi = aS - (aS - a);
  const aLo = a - aHi;
  const bS = SPLITTER * b;
  const bHi = bS - (bS - b);
  const bLo = b - bHi;
  return aLo * bLo - (p - aHi * bHi - aLo * bHi - aHi * bLo);
}

/** Directed product: `dir < 0` returns a value ≤ the exact `a · b`,
 * `dir > 0` a value ≥ it (extended reals; NaN for `0 · ∞`). */
function dirProd(a: number, b: number, dir: -1 | 1): number {
  const p = a * b;
  if (Number.isNaN(p)) return NaN;
  if (p === Infinity)
    return Number.isFinite(a) && Number.isFinite(b) && dir < 0
      ? Number.MAX_VALUE
      : Infinity;
  if (p === -Infinity)
    return Number.isFinite(a) && Number.isFinite(b) && dir > 0
      ? -Number.MAX_VALUE
      : -Infinity;
  if (p === 0) {
    // A true zero only when a factor is zero; otherwise the product
    // underflowed and the true value is a nonzero number of known sign
    // within one subnormal ulp of zero.
    if (a === 0 || b === 0) return 0;
    const positive = a > 0 === b > 0;
    if (dir < 0) return positive ? 0 : -Number.MIN_VALUE;
    return positive ? Number.MIN_VALUE : 0;
  }
  if (!inDekkerWindow(a, b, p)) {
    // Outside Dekker's validity window: unconditional outward step. The
    // window excludes subnormal OPERANDS too, not just a subnormal
    // product — a subnormal times a large factor can land back in the
    // normal range, but the Veltkamp split's exactness proof assumes
    // normal inputs (dual-review catch).
    return dir < 0 ? nextDown(p) : nextUp(p);
  }
  const err = productError(a, b, p);
  if (dir < 0) return err < 0 ? nextDown(p) : p;
  return err > 0 ? nextUp(p) : p;
}

/** Is `x` an exact power of two? The IEEE-754 bit test — a zero
 * significand for a normal double, a one-hot significand for a subnormal
 * one — read through a `BigUint64Array` view. This is the exactness test
 * for the reciprocal (`1/x` is representable iff `x` is a power of two).
 * `Number.isInteger(Math.log2(x))` is NOT that test: the float logarithm
 * rounds to an integer on 4,080 of 4,092 near-neighbors of powers of two
 * (measured 2026-08-29), which would suppress the outward step and claim
 * an exact bound that is not. */
const F64 = new Float64Array(1);
const U64 = new BigUint64Array(F64.buffer);
function isPowerOfTwo(x: number): boolean {
  if (!Number.isFinite(x) || x === 0) return false;
  F64[0] = Math.abs(x);
  const bits = U64[0];
  const mant = bits & ((1n << 52n) - 1n);
  const exp = (bits >> 52n) & 0x7ffn;
  if (exp === 0n) return mant !== 0n && (mant & (mant - 1n)) === 0n;
  return mant === 0n;
}

/** Directed reciprocal: `dir < 0` returns a value ≤ the exact `1/x`,
 * `dir > 0` a value ≥ it, for a NONZERO finite or infinite `x`. Never
 * called with 0 — `recip()` handles the zero-side endpoint of an
 * open-at-0 divisor as a LIMIT, before any reciprocal is taken.
 *
 * `1/±∞` is exactly 0. Overflow is gated on the computed RESULT, never on
 * the operand's magnitude class: the subnormal `2e-308` has the finite
 * reciprocal `5e307` and must not saturate (saturating a lower bound to
 * `MAX_VALUE` would EXCEED the true reciprocal). `1/x` overflows exactly
 * when `|x| < 2⁻¹⁰²³` (measured), which reaches into the bottom normal
 * binade — hence the result gate. An exact reciprocal (power-of-two `x`)
 * is returned as is; otherwise one ulp outward. */
function dirRecip(x: number, dir: -1 | 1): number {
  if (x === Infinity || x === -Infinity) return 0;
  const q = 1 / x;
  if (q === Infinity) return dir < 0 ? Number.MAX_VALUE : Infinity;
  if (q === -Infinity) return dir > 0 ? -Number.MAX_VALUE : -Infinity;
  if (isPowerOfTwo(x)) return q;
  return dir < 0 ? nextDown(q) : nextUp(q);
}

function withFlags(iv: Interval, loOpen: boolean, hiOpen: boolean): Interval {
  if (loOpen && Number.isFinite(iv.lo)) iv.loOpen = true;
  if (hiOpen && Number.isFinite(iv.hi)) iv.hiOpen = true;
  return iv;
}

/** Was the directed result EXACT — the true value itself, not a stepped or
 * saturated neighbor? Only an exact endpoint may carry openness: a stepped
 * bound has moved strictly outward, is no longer the true extreme, and is
 * always closed (§3.5 demotion rule). Exactness is read back from the
 * plain double op: the directed op returns exactly `a op b` iff the double
 * op was exact, and every inexact case stepped away from it. */
function sumExact(a: number, b: number, r: number): boolean {
  return Number.isFinite(r) && r === a + b && exactSum(a, b);
}
function exactSum(a: number, b: number): boolean {
  const s = a + b;
  if (!Number.isFinite(s)) return false;
  const bb = s - a;
  return a - (s - bb) + (b - bb) === 0;
}
function prodExact(a: number, b: number, r: number): boolean {
  if (!Number.isFinite(r) || r !== a * b) return false;
  if (r === 0) return a === 0 || b === 0;
  if (!inDekkerWindow(a, b, r)) return false;
  return productError(a, b, r) === 0;
}

/** Where Dekker's two-product split is proven exact: NORMAL operands and
 * product, away from overflow of the `2²⁷+1` scaling. ONE predicate for
 * both the directed product (which steps unconditionally outside it) and
 * the exactness test (which answers "not exact" outside it), so the two
 * can never disagree about the same operands. */
function inDekkerWindow(a: number, b: number, p: number): boolean {
  const absP = Math.abs(p);
  return (
    absP >= MIN_NORMAL_DOUBLE &&
    absP <= 1e300 &&
    Math.abs(a) <= 1e150 &&
    Math.abs(b) <= 1e150 &&
    Math.abs(a) >= MIN_NORMAL_DOUBLE &&
    Math.abs(b) >= MIN_NORMAL_DOUBLE
  );
}

// ---------------------------------------------------------------------------
// Interval operations.
// ---------------------------------------------------------------------------

export function addIntervals(a: Interval, b: Interval): Interval {
  const lo = dirSum(a.lo, b.lo, -1);
  const hi = dirSum(a.hi, b.hi, 1);
  // A NaN endpoint (∞ + (−∞)) drops the claim on that side. ADD has one
  // candidate per side, attained iff both contributing endpoints are: the
  // bound is open iff either input endpoint is — and only when the sum was
  // computed exactly (§3.5).
  const r: Interval = {
    lo: Number.isNaN(lo) ? -Infinity : lo,
    hi: Number.isNaN(hi) ? Infinity : hi,
  };
  return withFlags(
    r,
    (a.loOpen || b.loOpen) === true && sumExact(a.lo, b.lo, lo),
    (a.hiOpen || b.hiOpen) === true && sumExact(a.hi, b.hi, hi)
  );
}

export function negInterval(a: Interval): Interval {
  return withFlags({ lo: -a.hi, hi: -a.lo }, a.hiOpen === true, a.loOpen === true); // exact
}

export function mulIntervals(a: Interval, b: Interval): Interval {
  // Min/max over the four endpoint products, each computed at the
  // direction of the extreme it may become; NaN candidates (`0 · ∞`) are
  // dropped per side. Never `Math.min(...)`/`Math.max(...)` over the raw
  // array: for an all-NaN side the empty survivor set must yield
  // "unbounded", and the JS empty-spread answers the WRONG-signed
  // infinity.
  let lo = Infinity;
  let hi = -Infinity;
  let loSeen = false;
  let hiSeen = false;
  // Openness by ATTAINABILITY (§3.5): a corner is attained iff both its
  // endpoints are — EXCEPT a corner through a CLOSED zero, which attains 0
  // for every point of the other operand and is therefore attained
  // whatever the other flag says; a corner through an OPEN zero never
  // attains 0. On a TIE between corners reaching the same extreme, a
  // closed (attained) corner wins. A corner whose product was not exact
  // cannot carry openness.
  let loOpen = true;
  let hiOpen = true;
  const cornerOpen = (x: number, xo: boolean, y: number, yo: boolean) => {
    // A zero endpoint attains 0 for EVERY point of the other operand; so
    // when both endpoints are 0 the product 0 is attained if EITHER is
    // closed (dual-review catch: `(0, ∞) × {0}` must be the closed {0},
    // not an empty open singleton).
    if (x === 0 && y === 0) return xo && yo;
    if (x === 0) return xo;
    if (y === 0) return yo;
    return xo || yo;
  };
  for (const [x, xo, y, yo] of [
    [a.lo, a.loOpen === true, b.lo, b.loOpen === true],
    [a.lo, a.loOpen === true, b.hi, b.hiOpen === true],
    [a.hi, a.hiOpen === true, b.lo, b.loOpen === true],
    [a.hi, a.hiOpen === true, b.hi, b.hiOpen === true],
  ] as const) {
    const open = cornerOpen(x, xo, y, yo);
    const cLo = dirProd(x, y, -1);
    if (!Number.isNaN(cLo)) {
      loSeen = true;
      const o = open && prodExact(x, y, cLo);
      if (cLo < lo) {
        lo = cLo;
        loOpen = o;
      } else if (cLo === lo && !o) loOpen = false;
    }
    const cHi = dirProd(x, y, 1);
    if (!Number.isNaN(cHi)) {
      hiSeen = true;
      const o = open && prodExact(x, y, cHi);
      if (cHi > hi) {
        hi = cHi;
        hiOpen = o;
      } else if (cHi === hi && !o) hiOpen = false;
    }
  }
  return withFlags(
    { lo: loSeen ? lo : -Infinity, hi: hiSeen ? hi : Infinity },
    loSeen && loOpen,
    hiSeen && hiOpen
  );
}

/** Does the interval EXCLUDE zero — the precondition for a reciprocal?
 * True for a range strictly on one side of 0, or touching 0 only at an
 * OPEN endpoint (`real<0<..>`, the canonical "positive"). */
export function intervalExcludesZero(b: Interval): boolean {
  if (b.lo > 0 || b.hi < 0) return true;
  if (b.lo === 0 && b.loOpen === true) return true;
  if (b.hi === 0 && b.hiOpen === true) return true;
  return false;
}

/**
 * The reciprocal interval `{ 1/x : x ∈ b }` of a divisor interval that
 * EXCLUDES zero (`intervalExcludesZero`; `undefined` otherwise — the
 * caller attaches no bounds). `1/x` is monotone decreasing on each side
 * of zero, so the endpoints swap. Two limit cases are handled without a
 * reciprocal (`dirRecip` is never called with 0):
 * - a divisor endpoint AT zero (open, by the precondition) maps to the
 *   unbounded side: `(0, h]` → `[1/h, +∞)`, `[l, 0)` → `(−∞, 1/l]`;
 * - an infinite divisor endpoint maps to an OPEN 0: `[l, +∞)` → `(0, 1/l]`.
 *   That openness is a hard-coded limit, sound because the divisor's
 *   tier is finite-only under the post-flip lattice (no `real` value IS
 *   `±∞`, so `1/x` is never exactly 0); an extension of interval
 *   attachment to a tier that attains `±∞` must revisit it.
 * A finite nonzero endpoint follows the general attainability rule
 * (`docs/plans/2026-08-28-open-bounds-in-ranged-types.md` §3.5): open iff
 * the divisor endpoint is open AND the reciprocal was exact (a stepped
 * reciprocal is closed, like every stepped bound).
 */
export function recipInterval(b: Interval): Interval | undefined {
  if (!intervalExcludesZero(b)) return undefined;
  // Lower endpoint of the reciprocal comes from the divisor's UPPER one.
  let lo: number;
  let loOpen: boolean;
  if (b.hi === Infinity) {
    lo = 0;
    loOpen = true;
  } else if (b.hi === 0) {
    lo = -Infinity;
    loOpen = false;
  } else {
    lo = dirRecip(b.hi, -1);
    // The flag is decided by the divisor endpoint alone, without knowing
    // whether `dirRecip` SATURATED (a power of two below 2⁻¹⁰²³ overflows
    // and returns ±MAX_VALUE/±∞). That stays sound: saturation happens
    // only when the true reciprocal strictly exceeds MAX_VALUE, so at a
    // saturated bound BOTH the closed (≥) and the open (>) claim hold.
    loOpen = b.hiOpen === true && isPowerOfTwo(b.hi);
  }
  let hi: number;
  let hiOpen: boolean;
  if (b.lo === -Infinity) {
    hi = 0;
    hiOpen = true;
  } else if (b.lo === 0) {
    hi = Infinity;
    hiOpen = false;
  } else {
    hi = dirRecip(b.lo, 1);
    hiOpen = b.loOpen === true && isPowerOfTwo(b.lo);
  }
  return withFlags({ lo, hi }, loOpen, hiOpen);
}

/** Quotient interval: `a / b = a × (1/b)`, through `mulIntervals`, which
 * already handles every sign combination, corner ties, the closed-zero
 * corner (`0 / y` attains 0 when `a` does) and NaN-dropping. The only
 * zero endpoint `recipInterval` can carry is the OPEN 0 of an infinite
 * divisor endpoint, and `mulIntervals`' zero-corner rule reads the FLAG,
 * not a sign — so no signed zero is needed anywhere. `undefined` when
 * the divisor admits zero. */
export function divIntervals(a: Interval, b: Interval): Interval | undefined {
  const r = recipInterval(b);
  return r === undefined ? undefined : mulIntervals(a, r);
}

export function absInterval(a: Interval): Interval {
  if (a.lo >= 0) return a;
  if (a.hi <= 0) return negInterval(a);
  // Crosses zero: the lower bound 0 is an INTERIOR point of the operand —
  // always attained, so always closed. The upper bound is attained iff
  // the winning endpoint is; a tie between |lo| and hi is closed if
  // either is.
  const l = -a.lo;
  const h = a.hi;
  let hiOpen: boolean;
  if (l > h) hiOpen = a.loOpen === true;
  else if (h > l) hiOpen = a.hiOpen === true;
  else hiOpen = a.loOpen === true && a.hiOpen === true;
  return withFlags({ lo: 0, hi: Math.max(l, h) }, false, hiOpen); // exact operations only
}

/** `x^n` over an interval, for a LITERAL integer exponent `n ≥ 1`. All
 * powers are computed by repeated directed multiplication, never
 * `Math.pow`. Negative exponents go through `powIntervalSigned`. */
export function powInterval(a: Interval, n: number): Interval | undefined {
  if (!Number.isInteger(n) || n < 1) return undefined;
  if (n === 1) return a;
  // Monotone arms: one candidate per side; openness carries iff the
  // contributing endpoint is open AND its power was computed exactly
  // (§3.5). `mono(x, xo, dir)` computes the directed power and its flag.
  const mono = (x: number, xo: boolean, dir: -1 | 1): [number, boolean] => {
    const v = dirPow(x, n, dir);
    return [v, xo && powExact(x, n, v)];
  };
  if (n % 2 === 1) {
    // Odd: monotone increasing on all of ℝ.
    const [lo, lof] = mono(a.lo, a.loOpen === true, -1);
    const [hi, hif] = mono(a.hi, a.hiOpen === true, 1);
    return withFlags({ lo, hi }, lof, hif);
  }
  // Even.
  if (a.lo >= 0) {
    const [lo, lof] = mono(a.lo, a.loOpen === true, -1);
    const [hi, hif] = mono(a.hi, a.hiOpen === true, 1);
    return withFlags({ lo, hi }, lof, hif);
  }
  if (a.hi <= 0) {
    // Monotone DECREASING on the non-positive half: `real<-3..-2>` squares
    // to `[4, 9]`, not `[0, 9]`.
    const [lo, lof] = mono(a.hi, a.hiOpen === true, -1);
    const [hi, hif] = mono(a.lo, a.loOpen === true, 1);
    return withFlags({ lo, hi }, lof, hif);
  }
  // Crosses zero: the lower bound 0 is an INTERIOR point — always attained,
  // always closed. The upper bound follows the winning (or tied) endpoint.
  const [pl, plf] = mono(a.lo, a.loOpen === true, 1);
  const [ph, phf] = mono(a.hi, a.hiOpen === true, 1);
  let hiOpen: boolean;
  if (pl > ph) hiOpen = plf;
  else if (ph > pl) hiOpen = phf;
  else hiOpen = plf && phf;
  return withFlags({ lo: 0, hi: Math.max(pl, ph) }, false, hiOpen);
}

/** Was `x^n` (as computed by `dirPow`) exact? Re-multiplies by squaring
 * with exactness tracking: every partial product must be exact. */
function powExact(x: number, n: number, v: number): boolean {
  if (!Number.isFinite(v)) return false;
  let result = 1;
  let b = Math.abs(x);
  let e = n;
  while (e > 0) {
    if (e % 2 === 1) {
      const r = result * b;
      if (!prodExact(result, b, r) && !(result === 1 || b === 1)) return false;
      result = r;
    }
    e = Math.floor(e / 2);
    if (e > 0) {
      const sq = b * b;
      if (!prodExact(b, b, sq) && b !== 1) return false;
      b = sq;
    }
  }
  return Math.abs(v) === result;
}

/** `x^n` over an interval for ANY nonzero literal integer exponent:
 * `n ≥ 1` is `powInterval`; `n ≤ -1` is `1 / x^|n|` — the power first,
 * then `recipInterval`, which answers `undefined` when the COMPUTED power
 * admits zero. The gate is on the computed power, not the base: a base
 * that mathematically excludes zero (`real<1e-300..>`, closed) squares to
 * a lower bound that UNDERFLOWS to a closed 0 (dual-review catch), and
 * that 0 must not reach a reciprocal. `n = 0` answers `undefined` (the
 * `0^0` pole is the handler's business). */
export function powIntervalSigned(
  a: Interval,
  n: number
): Interval | undefined {
  if (!Number.isInteger(n) || n === 0) return undefined;
  if (n > 0) return powInterval(a, n);
  const p = powInterval(a, -n);
  return p === undefined ? undefined : recipInterval(p);
}

/** `x^n` for one endpoint, `n ≥ 1` integer, directed. Negative bases are
 * routed through the magnitude so the directed rounding never has to
 * alternate direction with the sign: `(−x)^odd = −(x^odd)` with the
 * direction reflected. No indeterminate form arises for `n ≥ 1`
 * (`(±∞)^n` is the signed infinity). */
function dirPow(x: number, n: number, dir: -1 | 1): number {
  if (x >= 0) return dirPowAbs(x, n, dir);
  const m = dirPowAbs(-x, n, n % 2 === 0 ? dir : ((-dir) as -1 | 1));
  return n % 2 === 0 ? m : -m;
}

function dirPowAbs(x: number, n: number, dir: -1 | 1): number {
  // Exponentiation by squaring, O(log n) directed products — a literal
  // exponent can be huge (`x^10000003` appears in real corpora), and a
  // linear chain of directed multiplications spun a full-suite worker for
  // the better part of an hour. `x ≥ 0` and every partial is ≥ 0, so one
  // rounding direction is monotone through the whole chain, squarings
  // included. (`%`/`floor`, not bitwise ops: a literal exponent can
  // exceed 2³², where `&` silently truncates.)
  let result = 1;
  let b = x;
  let e = n;
  while (e > 0) {
    if (e % 2 === 1) result = dirProd(result, b, dir);
    e = Math.floor(e / 2);
    if (e > 0) b = dirProd(b, b, dir);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Finalization and attachment.
// ---------------------------------------------------------------------------

/**
 * Coarsen a computed interval's finite bounds to `DERIVED_BOUND_DIGITS`
 * significant digits (outward: floor for the lower, ceiling for the
 * upper) and re-project onto doubles, applying the guards the literal
 * enclosures established: a non-finite projection, or one in the
 * subnormal range, drops that side. `-0` normalizes to `0`. The endpoint
 * arithmetic above already made each bound sound at full precision, and
 * the directed decimal rounding only moves it further out, so the result
 * is sound for any digit budget. The projection cannot cross the bound:
 * an unchanged ≤-4-digit decimal round-trips to the same double, and a
 * coarsened one moved a whole grid notch (≥ 0.01% of the magnitude),
 * dwarfing the ~10⁻¹⁶ relative projection error — for a NORMAL double,
 * which the subnormal veto guarantees.
 */
export function finalizeInterval(iv: Interval): Interval {
  let { lo, hi } = iv;
  // A bound the coarsening MOVES is no longer the true extreme, so its
  // openness (an attainability fact about that extreme) is demoted to
  // closed; an untouched bound keeps its flag (§3.5 demotion rule).
  let loOpen = iv.loOpen === true;
  let hiOpen = iv.hiOpen === true;
  if (Number.isFinite(lo) && lo !== 0) {
    const c = new BigDecimal(lo)
      .toPrecisionToward(DERIVED_BOUND_DIGITS, 'floor')
      .toNumber();
    if (c !== lo) loOpen = false;
    lo = c;
    if (!Number.isFinite(lo) || Math.abs(lo) < MIN_NORMAL_DOUBLE) {
      lo = -Infinity;
      loOpen = false;
    }
  } else if (lo === 0) lo = 0; // normalize -0
  if (Number.isFinite(hi) && hi !== 0) {
    const c = new BigDecimal(hi)
      .toPrecisionToward(DERIVED_BOUND_DIGITS, 'ceiling')
      .toNumber();
    if (c !== hi) hiOpen = false;
    hi = c;
    if (!Number.isFinite(hi) || Math.abs(hi) < MIN_NORMAL_DOUBLE) {
      hi = Infinity;
      hiOpen = false;
    }
  } else if (hi === 0) hi = 0;
  return withFlags({ lo, hi }, loOpen, hiOpen);
}

/**
 * Fold the intervals of the given operand TYPES with `op`, finalized. If
 * ANY operand has no interval (a NaN-admitting `number`, a complex type,
 * a non-numeric), the whole claim is aborted — there is no partial
 * claim. Pairwise, left to right, in the given (canonical) order;
 * coarsening happens once, at the end.
 */
export function foldIntervalsOfTypes(
  types: ReadonlyArray<Type>,
  op: (a: Interval, b: Interval) => Interval
): Interval | undefined {
  let acc: Interval | undefined;
  for (const t of types) {
    const iv = intervalOfType(t);
    if (iv === undefined) return undefined;
    acc = acc === undefined ? iv : op(acc, iv);
  }
  return acc === undefined ? undefined : finalizeInterval(acc);
}

/**
 * The `Abs` result range for a chosen tier: the operand's interval put
 * through `absInterval` when one exists, and the plain non-negative
 * range `tier<0..>` otherwise. Both `absFunctionType` shapes (the
 * Expression shape in `library/type-handlers.ts` and the descriptor
 * twin in `library/type-handlers-types.ts`) call this, so their claims
 * cannot diverge. The lower bound is clamped at 0 AFTER finalization:
 * `|x| ≥ 0` holds independently of the interval, so a bound the
 * subnormal veto dropped must not lose the sign fact the old
 * `tier<0..>` claim carried.
 */
export function absRange(tier: NumericPrimitiveType, operandType: Type): Type {
  const iv = intervalOfType(operandType);
  if (iv !== undefined) {
    const a = finalizeInterval(absInterval(iv));
    a.lo = Math.max(a.lo, 0);
    const r = attachInterval(tier, a);
    if (typeof r !== 'string') return r;
  }
  return nonNegativeRangeType(tier);
}

/**
 * Attach a finalized interval to a result TIER. The tier must be one of
 * the NaN-free real tiers (callers guarantee it — a range on a
 * NaN-admitting tier would claim an order relation about a value that
 * has none); anything else, an unbounded-on-both-sides interval, or a
 * degenerate `lo > hi` returns the tier unchanged.
 */
export function attachInterval(
  tier: Type,
  iv: Interval | undefined
): Type {
  if (iv === undefined) return tier;
  if (typeof tier !== 'string' || !NAN_FREE_REAL_TIERS.has(tier)) return tier;
  const hasLo = Number.isFinite(iv.lo);
  const hasHi = Number.isFinite(iv.hi);
  if (!hasLo && !hasHi) return tier;
  if (hasLo && hasHi && iv.lo > iv.hi) return tier;
  return makeNumericRangeType(
    tier as NumericPrimitiveType,
    iv.lo,
    iv.hi,
    iv.loOpen === true,
    iv.hiOpen === true
  );
}
