/**
 * Interval enclosure of a definite integral.
 *
 * @module interval/integrate
 */

import { add, mul, sub } from './arithmetic.js';
import type { Interval, IntervalResult } from './types.js';
import { ok, point, unwrapOrPropagate, liftJump } from './util.js';

/**
 * Default number of subintervals the point-bound core partitions the
 * integration range into — the count a SINGLE (non-nested) integral uses.
 *
 * The enclosure this produces is a Riemann *bracket*: on each subinterval the
 * integrand's interval hull times the subinterval width brackets that piece's
 * contribution, so the accumulated result is an enclosure rather than an
 * estimate. Its width is O((q−p)·h·|f′|) with h = (q−p)/N — FIRST order in
 * h, not the near-machine-precision convergence the scalar target's adaptive
 * Gauss–Kronrod achieves — so N trades tightness against cost linearly: 256
 * subintervals bound a unit range with a smooth O(1)-derivative integrand to
 * roughly 4·10⁻³.
 */
export const INTERVAL_QUADRATURE_SUBDIVISIONS = 256;

/**
 * Total integrand-evaluation budget for one compiled `Integrate` node, however
 * deeply its limits nest.
 *
 * The inner `integrate` of a nested integral runs once per outer subinterval,
 * so with a fixed per-level count N a d-fold integral costs N^d evaluations —
 * 65 536 for a double integral at N = 256, and over four billion synchronous
 * evaluations for a quadruple one, which would lock the caller's thread. The
 * compiler therefore sizes each level's count from this budget:
 * `min(INTERVAL_QUADRATURE_SUBDIVISIONS, ⌊budget^(1/d)⌋)` — 256 for a single or
 * double integral, 40 per level for a triple, 16 for a quadruple — so the
 * total stays at or under this figure at every depth. A deeper integral gets
 * a coarser (wider) enclosure, never a runaway cost.
 */
export const INTERVAL_QUADRATURE_BUDGET = 65536;

/**
 * Subinterval count of the coarse scan `integrateClosed` runs over the
 * integration range before trusting a symbolic closed form — see there.
 */
export const INTERVAL_QUADRATURE_GUARD_SUBDIVISIONS = 16;

/**
 * Runtime integrand-evaluation budget for DYNAMICALLY nested integrals —
 * integrals entered from inside another integral's integrand at run time.
 *
 * The compile-time sizing above (`INTERVAL_QUADRATURE_BUDGET`) covers only the
 * nesting the compiler can see: the limits of one `Integrate` node. An
 * integral can also reach another integral through expression structure — a
 * distinct `Integrate` node inside the integrand, or a compiled user function
 * that computes one (e.g. a macro-expanded Newton iteration
 * `w − k·E(w)/d_E(w)` whose argument was substituted into `E`'s integrand:
 * six such levels emit 728 `_IA.integrate` calls nested inside each other's
 * integrands). Each such level multiplies the work by its own piece count —
 * 256^d integrand evaluations for d dynamic levels — and no compile-time
 * sizing can bound it, because the multiplication happens per RUNTIME call.
 *
 * So the runtime enforces its own cap: each outermost `integrate`/
 * `integrateClosed` entry (one with no integral already running) resets this
 * budget, and every integrand evaluation performed by a NESTED integral
 * consumes one unit. A nested integral that finds the budget exhausted —
 * on entry, or mid-accumulation — answers `entire`: sound (the entire line
 * contains every real value), so the enclosing enclosure widens to `entire`
 * instead of spinning, and the caller degrades to its non-interval fallback.
 *
 * Sized at 4× the compile-time budget so integrals the compiler DID size —
 * a double integral's inner level consumes 256·256 = 65 536 nested
 * evaluations, a triple's inner two ≈ 65 600 — complete untouched with
 * headroom, while a runaway dynamic composition is cut after ~a quarter
 * million evaluations rather than never. The cap is PER OUTERMOST INTEGRAL:
 * an expression with many top-level integrals over a runaway shape pays it
 * once per integral (the Tycho item-226 witness, ~12 top-level integrals
 * over heavy integrands, ran ~45 s per compiled-function call — bounded, but
 * far from free; the per-invocation scoping alternative is a ROADMAP item,
 * "Quadrature under dynamic integral composition").
 */
export const INTERVAL_NESTED_QUADRATURE_BUDGET = 4 * INTERVAL_QUADRATURE_BUDGET;

/** Number of `integrate`/`integrateClosed` activations currently on the call
 *  stack. Zero at every outermost entry — module state is safe here because
 *  compiled interval code runs synchronously on one thread. */
let activeIntegrals = 0;

/** Remaining nested-integrand-evaluation budget for the current outermost
 *  integral — see {@link INTERVAL_NESTED_QUADRATURE_BUDGET}. */
let nestedEvalsLeft = 0;

/**
 * `f` wrapped so that each evaluation made on behalf of a NESTED integral
 * (one running inside another integral's integrand) consumes budget, and
 * answers `entire` once the budget is exhausted — which `propagatedKind`
 * then promotes to the whole nested integral's answer, ending its
 * accumulation early.
 */
function budgetedIntegrand(
  f: (t: Interval) => Interval | IntervalResult
): (t: Interval) => Interval | IntervalResult {
  return (t) => {
    if (activeIntegrals > 1 && --nestedEvalsLeft < 0) return { kind: 'entire' };
    return f(t);
  };
}

/**
 * Open one integral activation: reset the nested budget at an outermost
 * entry, or refuse (with `entire`) a nested entry whose budget is already
 * gone. Returns `undefined` when the caller may proceed (and must then run
 * its work inside `try { … } finally { activeIntegrals--; }`).
 */
function enterIntegral(): IntervalResult | undefined {
  if (activeIntegrals === 0)
    nestedEvalsLeft = INTERVAL_NESTED_QUADRATURE_BUDGET;
  else if (nestedEvalsLeft <= 0) return { kind: 'entire' };
  activeIntegrals++;
  return undefined;
}

/** Whether both endpoints of an interval are finite numbers (no ±∞, no NaN). */
function isFiniteInterval(x: Interval): boolean {
  return Number.isFinite(x.lo) && Number.isFinite(x.hi);
}

/**
 * The non-interval kind of an integrand result that must be propagated as the
 * whole integral's answer, or `undefined` when the result carries a usable
 * interval (kind `interval` or `partial`).
 *
 * - `singular` without a `value`: the range crosses a pole, so no finite
 *   enclosure exists. A `singular` WITH a `value` is a finite jump (`floor`
 *   across an integer): the integrand is bounded there, so the piece is
 *   integrated over the enclosure the jump carries like any other. The
 *   integral of a jump in the integration variable is continuous, so the
 *   result is a plain interval. A jump the integrand inherits from a
 *   captured parameter (`∫₀¹ floor(x) dt`, `x` an interval across an
 *   integer) is integrated the same way: the bound is sound, but the result
 *   no longer says that it jumps in `x`. Telling the two apart would need
 *   the jump to record which variable it came from.
 * - `empty`: the integrand is undefined somewhere on the range, so the
 *   integral is undefined.
 * - `entire`: the integrand is unbounded on the range.
 */
function propagatedKind(
  v: Interval | IntervalResult
): IntervalResult | undefined {
  // Not an interval value at all — a JS array from a collection-valued
  // integrand whose type the compiler could not see (a free symbol inside
  // the integral's own scope types `unknown`), or `undefined` from a missing
  // input. Reading `.lo`/`.hi` off it would accumulate NaN behind a
  // well-formed result; `entire` is the honest "cannot bound this".
  if (v === null || typeof v !== 'object' || Array.isArray(v))
    return { kind: 'entire' };
  if (!('kind' in v)) {
    if (typeof v.lo !== 'number' || typeof v.hi !== 'number')
      return { kind: 'entire' };
    return undefined;
  }
  if (v.kind === 'singular') return v.value === undefined ? v : undefined;
  if (v.kind === 'empty' || v.kind === 'entire') return { kind: v.kind };
  return undefined;
}

/** Whether an integrand result reports a domain-clipped (partial) value. */
function isPartial(v: Interval | IntervalResult): boolean {
  return 'kind' in v && v.kind === 'partial';
}

/** The interval carried by an integrand result known to carry one (kind
 *  `interval` or `partial`, a jump, or a bare interval). */
function valueOf(v: Interval | IntervalResult): Interval {
  return 'kind' in v ? (v as { value: Interval }).value : v;
}

/** The largest magnitude an interval's endpoints reach. */
function magnitude(x: Interval): number {
  return Math.max(Math.abs(x.lo), Math.abs(x.hi));
}

/**
 * An accumulated enclosure together with the data its rounding bound needs:
 * `mag` is Σ max|fₖ|·wₖ over the accumulated terms and `ops` the number of
 * floating-point operations the accumulation performed — see `widen`.
 */
interface Accumulation {
  value: Interval;
  clipped: boolean;
  mag: number;
  ops: number;
}

/**
 * Widen an accumulated enclosure by a bound on the rounding error of its own
 * arithmetic.
 *
 * This library computes in round-to-nearest doubles and rounds nothing
 * outward, so the products and partial sums the bracket accumulates can each
 * err by half an ulp in either direction — enough, on a degenerate case such
 * as a constant integrand with point bounds, for a result that misses the
 * exact value by a few ulps. The accumulation is a dot product of the
 * per-piece hull magnitudes against the piece widths, and the standard forward
 * error bound for a dot product of n terms is `γₙ·Σ|termₖ|` with
 * `γₙ ≈ n·u` for unit roundoff `u` (Higham, *Accuracy and Stability of
 * Numerical Algorithms*, §3.1). `Number.EPSILON` is 2u, so `ops·EPSILON·mag`
 * carries a factor-two margin over that bound; one extra `EPSILON·mag` covers
 * the subinterval widths, each rounded once when computed from its endpoints.
 *
 * This accounts for the accumulation's rounding only. What the integrand's
 * own interval extension returns is taken as given: it is as rigorous as the
 * rest of this library, which does not round outward either.
 */
function widen(acc: Accumulation): Interval {
  const delta = (acc.ops + 1) * Number.EPSILON * acc.mag;
  return { lo: acc.value.lo - delta, hi: acc.value.hi + delta };
}

/**
 * Wrap an accumulated enclosure over a FINITE integration range, reporting a
 * non-finite one as `singular` instead.
 *
 * Over a finite range the integral of a bounded integrand is finite, so an
 * infinite (or NaN) accumulated bound says the integrand is unbounded
 * somewhere on the range — a pole. Reporting that as `singular` also removes a
 * partition artifact: `_IA.div` answers `singular` only when a subinterval
 * STRICTLY contains the pole, and `partial` with an infinite bound when the
 * pole falls exactly on a subinterval endpoint, so without this check
 * `∫₋₁¹ dt/t` would answer `singular` or `partial` depending on whether the
 * partition happens to put an endpoint at 0.
 *
 * `clipped` records that some subinterval's integrand result was `partial` —
 * its domain did not cover that piece. The enclosure is then the hull over the
 * part it does cover, clipped at both ends because a gap anywhere inside the
 * range bounds the result from both directions.
 */
function enclosure(acc: Accumulation): IntervalResult {
  if (!isFiniteInterval(acc.value)) return { kind: 'singular' };
  const value = widen(acc);
  if (acc.clipped) return { kind: 'partial', value, domainClipped: 'both' };
  return ok(value);
}

/**
 * Accumulate one term `v · w` (an integrand hull times a non-negative width)
 * into `acc`, or return the non-interval kind that ends the accumulation.
 * `ops` counts the width computation, the product and the addition.
 */
function accumulate(
  acc: Accumulation,
  v: Interval | IntervalResult,
  w: Interval
): IntervalResult | undefined {
  const propagated = propagatedKind(v);
  if (propagated !== undefined) return propagated;
  if (isPartial(v)) acc.clipped = true;
  const term = add(acc.value, mul(v, w));
  // `add`/`mul` answer `interval` for interval operands, or a jump carrying
  // its bound when `v` is one; the propagation check above ruled the others
  // out.
  acc.value = valueOf(term);
  acc.mag += magnitude(valueOf(v)) * w.hi;
  acc.ops += 3;
  return undefined;
}

/**
 * Bracket of ∫ₚ^q f for POINT bounds p ≤ q, as a raw accumulation (not yet
 * widened for rounding — `integrate` widens once over everything it adds).
 *
 * Partitions [p, q] uniformly into `n` subintervals and accumulates
 * `f(subinterval) · width`. Each term encloses its piece of the integral (the
 * mean-value form: the piece equals its width times a mean of f on it, and
 * that mean lies in f's hull over the piece), so the sum encloses the whole.
 *
 * Subinterval endpoints are computed in closed form (`p + k·(q−p)/n`) rather
 * than by accumulating `+h`, so rounding does not drift across the range, and
 * adjacent pieces share the SAME computed endpoint, so the pieces tile [p, q]
 * exactly with no gap; the final endpoint is pinned to `q`, since `p + (q−p)`
 * need not round back to `q`. Each term uses its own width rather than a
 * nominal `h`, so the widths telescope to the true range length.
 */
function bracket(
  f: (t: Interval) => Interval | IntervalResult,
  p: number,
  q: number,
  n: number
): Accumulation | IntervalResult {
  const acc: Accumulation = { value: point(0), clipped: false, mag: 0, ops: 0 };
  if (p === q) return acc;
  const span = q - p;
  for (let k = 0; k < n; k++) {
    const t0 = k === 0 ? p : p + (k * span) / n;
    const t1 = k === n - 1 ? q : p + ((k + 1) * span) / n;
    // `lo <= hi` is the `Interval` invariant. The closed-form endpoints are
    // increasing in k by construction, but the pinned final endpoint is not
    // derived from the same expression, so order them rather than assume it.
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    const ended = accumulate(acc, f({ lo, hi }), point(hi - lo));
    if (ended !== undefined) return ended;
  }
  return acc;
}

/**
 * Interval enclosure of ∫ₐᵇ f, for interval-valued bounds.
 *
 * This is an ENCLOSURE, not an estimate: the returned interval contains ∫ₐᵇ f
 * for every a ∈ `a`, b ∈ `b` and every function whose values the supplied
 * interval extension `f` encloses — including the rounding of this
 * function's own accumulation (`widen`), and taking `f`'s results as given.
 *
 * **Infinite bounds are declined.** An infinite endpoint admits no finite
 * partition, so there is no Riemann bracket to accumulate; the answer is
 * `entire` ("cannot bound this"). The scalar JavaScript target handles such a
 * range by mapping it through a smooth variable transform onto a finite one —
 * sound for a numeric estimate, but that transform's interval extension is not
 * tight enough to yield a useful enclosure, so the interval target declines
 * instead of returning a bound it cannot justify.
 *
 * **Interval bounds.** For A = [a₁, a₂] and B = [b₁, b₂], additivity of the
 * oriented integral gives
 *
 * ```
 * ∫ₐᵇ f = ∫_{a₁}^{b₁} f  +  ∫_{b₁}^{b} f  −  ∫_{a₁}^{a} f
 * ```
 *
 * The first term is the point-bound bracket (negated when b₁ < a₁, since the
 * oriented integral reverses with its bounds). Each correction term is a
 * range times a mean value: ∫_{b₁}^{b} f = (b − b₁)·(mean of f on [b₁, b]),
 * where b − b₁ ∈ [0, b₂ − b₁] and the mean lies in f's hull over [b₁, b₂]. So
 * the corrections are `[0, b₂−b₁]·f([b₁, b₂])` and `[0, a₂−a₁]·f([a₁, a₂])`,
 * both of which vanish when the corresponding bound is a point.
 *
 * `n` is the number of subintervals of the point-bound bracket; the compiler
 * sizes it from `INTERVAL_QUADRATURE_BUDGET` by nesting depth.
 */
function integrateRaw(
  f: (t: Interval) => Interval | IntervalResult,
  a: Interval | IntervalResult,
  b: Interval | IntervalResult,
  n: number = INTERVAL_QUADRATURE_SUBDIVISIONS
): IntervalResult {
  const refused = enterIntegral();
  if (refused !== undefined) return refused;
  try {
    return integrateCore(budgetedIntegrand(f), a, b, n);
  } finally {
    activeIntegrals--;
  }
}

/** The enclosure itself — see {@link integrate}, which wraps it in the
 *  nested-budget accounting. `f` arrives already budget-wrapped. */
function integrateCore(
  f: (t: Interval) => Interval | IntervalResult,
  a: Interval | IntervalResult,
  b: Interval | IntervalResult,
  n: number
): IntervalResult {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [lower, upper] = unwrapped;

  if (!isFiniteInterval(lower) || !isFiniteInterval(upper))
    return { kind: 'entire' };

  // The point-bound core ∫_{a₁}^{b₁}, oriented.
  const reversed = upper.lo < lower.lo;
  const core = reversed
    ? bracket(f, upper.lo, lower.lo, n)
    : bracket(f, lower.lo, upper.lo, n);
  if ('kind' in core) return core;
  if (reversed) {
    core.value = { lo: -core.value.hi, hi: -core.value.lo };
  }

  // ∫_{b₁}^{b} f, bounded by [0, b₂−b₁]·f([b₁, b₂]).
  if (upper.hi > upper.lo) {
    const ended = accumulate(core, f(upper), {
      lo: 0,
      hi: upper.hi - upper.lo,
    });
    if (ended !== undefined) return ended;
  }

  // ∫_{a₁}^{a} f, bounded by [0, a₂−a₁]·f([a₁, a₂]), SUBTRACTED — the same
  // accumulation with the term's sign flipped.
  if (lower.hi > lower.lo) {
    const v = f(lower);
    const propagated = propagatedKind(v);
    if (propagated !== undefined) return propagated;
    if (isPartial(v)) core.clipped = true;
    const w: Interval = { lo: 0, hi: lower.hi - lower.lo };
    core.value = valueOf(sub(core.value, mul(v, w)));
    core.mag += magnitude(valueOf(v)) * w.hi;
    core.ops += 3;
  }

  return enclosure(core);
}

/**
 * The value of a definite integral that CLOSED symbolically, guarded at run
 * time against a closed form the symbolic step should not have produced.
 *
 * The antiderivative-first step differences an antiderivative at the bounds
 * without checking that the integrand is bounded between them: `∫₋₁¹ dt/t²`
 * closes to `−2` although the integral diverges at the interior pole. On the
 * scalar target that is a wrong number; on this target it would be a
 * zero-width "enclosure" of a divergent integral — the one thing an interval
 * target must never produce. So before the closed form is trusted, the
 * integrand's interval extension is scanned over the whole range the bounds
 * can span (the hull of `a` and `b`) with a coarse bracket of
 * `INTERVAL_QUADRATURE_GUARD_SUBDIVISIONS` pieces. Interval arithmetic
 * encloses, so a pole, an undefined stretch or an unbounded stretch inside the
 * range cannot hide from the scan: the bracket answers `singular`, `empty` or
 * `entire` (or `partial`, for a domain gap) rather than an interval. A clean
 * scan returns the closed form, evaluated as interval code — tight and
 * cheap. Anything else hands the integral to the full `integrate`, which
 * decides with its finer partition (the coarse scan can over-report — interval
 * arithmetic over-approximates a dependent expression — so it is never the
 * final word; it only withholds the closed form).
 *
 * With an infinite bound there is no range to scan, and the closed form is
 * the only answer available (the enclosure declines such bounds): it is
 * returned as is, exactly as the scalar target does.
 *
 * `closed` is a thunk so the closed form is evaluated only when it is used.
 */
function integrateClosedRaw(
  closed: () => Interval | IntervalResult,
  f: (t: Interval) => Interval | IntervalResult,
  a: Interval | IntervalResult,
  b: Interval | IntervalResult,
  n: number = INTERVAL_QUADRATURE_SUBDIVISIONS
): Interval | IntervalResult {
  const refused = enterIntegral();
  if (refused !== undefined) return refused;
  try {
    const g = budgetedIntegrand(f);
    const unwrapped = unwrapOrPropagate(a, b);
    if (!Array.isArray(unwrapped)) return unwrapped;
    const [lower, upper] = unwrapped;
    if (!isFiniteInterval(lower) || !isFiniteInterval(upper)) return closed();

    const lo = Math.min(lower.lo, upper.lo);
    const hi = Math.max(lower.hi, upper.hi);
    const scan = bracket(g, lo, hi, INTERVAL_QUADRATURE_GUARD_SUBDIVISIONS);
    if (!('kind' in scan) && !scan.clipped && isFiniteInterval(scan.value))
      return closed();
    return integrateCore(g, a, b, n);
  } finally {
    activeIntegrals--;
  }
}

// Both are exported through `liftJump` so that a jump in a BOUND (`∫ from
// floor(x) to 5`) is re-tagged on the result — the integral is continuous in
// its bounds, so it inherits the bound's discontinuity. The integrand's own
// jumps are handled in `propagatedKind` above.
export const integrate = liftJump(integrateRaw);
export const integrateClosed = liftJump(integrateClosedRaw);
