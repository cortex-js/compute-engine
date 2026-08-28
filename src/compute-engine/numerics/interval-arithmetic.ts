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

/** A closed interval over the extended reals. `lo ≤ hi`; `±Infinity`
 * means unbounded on that side. Never represents an empty set — a reader
 * that derives `lo > hi` answers `undefined` instead. */
export type Interval = { lo: number; hi: number };

const FULL: Interval = { lo: -Infinity, hi: Infinity };

/** How many significant digits a DERIVED bound keeps (user-ruled
 * 2026-08-27, plan §5 question 1). Coarser than full precision so
 * computed types stay readable (`finite_real<0.33..1.341>`, not
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
  'finite_integer',
  'finite_rational',
  'finite_real',
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
    case 'numeric':
      if (!NAN_FREE_REAL_TIERS.has(t.type)) return undefined;
      return { lo: t.lower ?? -Infinity, hi: t.upper ?? Infinity };
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
      for (const m of t.types) {
        const b = intervalOfType(m, seen);
        if (b === undefined) continue;
        answered = true;
        if (b.lo > lo) lo = b.lo;
        if (b.hi < hi) hi = b.hi;
      }
      if (!answered || lo > hi) return undefined;
      return { lo, hi };
    }
    case 'union': {
      let lo = Infinity;
      let hi = -Infinity;
      for (const m of t.types) {
        const b = intervalOfType(m, seen);
        if (b === undefined) return undefined;
        if (b.lo < lo) lo = b.lo;
        if (b.hi > hi) hi = b.hi;
      }
      return lo > hi ? undefined : { lo, hi };
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
  const absP = Math.abs(p);
  if (
    absP < MIN_NORMAL_DOUBLE ||
    absP > 1e300 ||
    Math.abs(a) > 1e150 ||
    Math.abs(b) > 1e150 ||
    Math.abs(a) < MIN_NORMAL_DOUBLE ||
    Math.abs(b) < MIN_NORMAL_DOUBLE
  ) {
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

// ---------------------------------------------------------------------------
// Interval operations.
// ---------------------------------------------------------------------------

export function addIntervals(a: Interval, b: Interval): Interval {
  const lo = dirSum(a.lo, b.lo, -1);
  const hi = dirSum(a.hi, b.hi, 1);
  // A NaN endpoint (∞ + (−∞)) drops the claim on that side.
  return {
    lo: Number.isNaN(lo) ? -Infinity : lo,
    hi: Number.isNaN(hi) ? Infinity : hi,
  };
}

export function negInterval(a: Interval): Interval {
  return { lo: -a.hi, hi: -a.lo }; // exact
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
  for (const [x, y] of [
    [a.lo, b.lo],
    [a.lo, b.hi],
    [a.hi, b.lo],
    [a.hi, b.hi],
  ] as const) {
    const cLo = dirProd(x, y, -1);
    if (!Number.isNaN(cLo)) {
      loSeen = true;
      if (cLo < lo) lo = cLo;
    }
    const cHi = dirProd(x, y, 1);
    if (!Number.isNaN(cHi)) {
      hiSeen = true;
      if (cHi > hi) hi = cHi;
    }
  }
  return {
    lo: loSeen ? lo : -Infinity,
    hi: hiSeen ? hi : Infinity,
  };
}

export function absInterval(a: Interval): Interval {
  if (a.lo >= 0) return a;
  if (a.hi <= 0) return negInterval(a);
  return { lo: 0, hi: Math.max(-a.lo, a.hi) }; // exact operations only
}

/** `x^n` over an interval, for a LITERAL integer exponent `n ≥ 1` (the
 * ruled first-round scope; `n ≤ 0` is deferred with `Divide` — the pole
 * story). All powers are computed by repeated directed multiplication,
 * never `Math.pow`. */
export function powInterval(a: Interval, n: number): Interval | undefined {
  if (!Number.isInteger(n) || n < 1) return undefined;
  if (n === 1) return a;
  if (n % 2 === 1) {
    // Odd: monotone increasing on all of ℝ.
    return { lo: dirPow(a.lo, n, -1), hi: dirPow(a.hi, n, 1) };
  }
  // Even.
  if (a.lo >= 0) return { lo: dirPow(a.lo, n, -1), hi: dirPow(a.hi, n, 1) };
  if (a.hi <= 0)
    // Monotone DECREASING on the non-positive half: `real<-3..-2>` squares
    // to `[4, 9]`, not `[0, 9]`.
    return { lo: dirPow(a.hi, n, -1), hi: dirPow(a.lo, n, 1) };
  // Crosses zero.
  return { lo: 0, hi: Math.max(dirPow(a.lo, n, 1), dirPow(a.hi, n, 1)) };
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
  if (Number.isFinite(lo) && lo !== 0) {
    lo = new BigDecimal(lo)
      .toPrecisionToward(DERIVED_BOUND_DIGITS, 'floor')
      .toNumber();
    if (!Number.isFinite(lo) || Math.abs(lo) < MIN_NORMAL_DOUBLE)
      lo = -Infinity;
  } else if (lo === 0) lo = 0; // normalize -0
  if (Number.isFinite(hi) && hi !== 0) {
    hi = new BigDecimal(hi)
      .toPrecisionToward(DERIVED_BOUND_DIGITS, 'ceiling')
      .toNumber();
    if (!Number.isFinite(hi) || Math.abs(hi) < MIN_NORMAL_DOUBLE)
      hi = Infinity;
  } else if (hi === 0) hi = 0;
  return { lo, hi };
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
  const node: Extract<Type, { kind: 'numeric' }> = {
    kind: 'numeric',
    type: tier as NumericPrimitiveType,
  };
  if (hasLo) node.lower = iv.lo;
  if (hasHi) node.upper = iv.hi;
  return node;
}
