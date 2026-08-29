# Interval arithmetic for quotients: `Divide` and `Power` with exponent ≤ 0

Status: RULED and IMPLEMENTED 2026-08-29 (kernel: `recipInterval`/`divIntervals`/`powIntervalSigned` in `numerics/interval-arithmetic.ts`; handlers in `library/arithmetic.ts`; pins: `test/compute-engine/interval-division.test.ts`) — design for ROADMAP "Interval kernel: `Divide` and `Power` with
exponent ≤ 0" (deferred by ruling from the 2026-08-27 interval round;
unblocked by lattice-flip Phase 1). The §6 question was RULED by the
user 2026-08-29: option (a) — a zero-admitting divisor gets NO bounds and
a SOUND tier. The tier's spelling was refined the same day, on the
lattice-flip session's recommendation and verified against the code:
`real | infinity | nan`, not bare `number` (§3.5). Written against the post-codemod lattice (Phase 2
landed 2026-08-28, commit 817da2ea): the numeric tiers are the bare
`integer`/`rational`/`real` (finite-only), the signed infinities are
`non_finite_number`, NaN is `nan`, and a generic numeric claim is
spelled `number`.

Implementation is sequenced AFTER the lattice flip's Phase 3 conformance
round (in flight, touches `library/arithmetic.ts`); the design runs now.

Revision 2 incorporates the dual spec review of 2026-08-29 (both legs
converged on three defects) and the empirical checks that settled them:
the zero-side endpoint of an open-at-0 divisor is handled WITHOUT a
reciprocal (§3.2); overflow is gated on the computed result, with the
true threshold measured (§3.1); the power-of-two exactness test is a
significand bit test, since `Math.log2` is integral on 4,080 of 4,092
near-neighbors of powers of two (§3.1); the negative-`Power` gate checks
the COMPUTED power's zero-exclusion, not the base's (§3.3); the tier a
zero-admitting divisor claims is a pre-existing unsoundness now owned by
this plan (§3.5, §6); route parity and the n-ary structural `Divide`
are stated (§3.4).

## 1. What this is, in one example

Today every quotient of ranged operands types its bare tier:

- `x: real<2<..<3>`, `y: real<1<..<2>` — `x / y` types `real`, although
  every value lies strictly between 1 and 3.
- `1 / y` for the same `y` types `real`, although it lies in (0.5, 1).
- `x^-2` types `real<0<..>` (the positive-base arm's sign claim), not
  the range `(1/9, 1/4)`.

This plan gives the `Divide` type handler (and the `Power` arms for
`n ≤ -2`) a quotient interval from the kernel: `x / y` above types
`real<1<..<3>`, `1 / y` types `real<0.5<..<1>`, `x^-2` types
`real<0.1111<..<0.25>` (4 significant digits, the ruled derived-bound
precision; the coarsened bounds demote to closed per the demotion rule,
so the exact printed form is `real<0.1111..0.25>`).

The two consumer channels (`signOfType`, the bounded-inverse domain
proofs via `typeBounds`) need no change: `Arcsin(x / y)` with suitably
bounded operands proves its domain from the computed range.

## 2. Code facts that shape the design

Verified empirically 2026-08-29:

- **`Power(x, -1)` canonicalizes to `Divide(1, x)` on every route** —
  parse (`x^{-1}`, `\frac{1}{x}`), `ce.box`, `ce.function`. The
  reciprocal never reaches `Power`'s type handler on those routes, so
  the quotient path is the path for `n = -1`; `Power` keeps `n ≤ -2`
  (`x^{-2}` stays a `Power`). The one exception is a STRUCTURAL
  construction (`{ form: 'structural' }`), which is not rewritten —
  §3.4 requires the two paths to agree there.
- **The `Divide` handler's scalar tail** (`library/arithmetic.ts`, after
  the tuple/collection/broadcast/NaN/non-finite arms) claims the tier
  from two rungs — `den.isInteger && num.isInteger → rational`,
  `isExtendedReal both → real` — then the imaginary/complex arms. The
  literal-zero divisor is caught earlier (`den.isSame(0) → number`).
- **A divisor that merely MAY be zero claims `real` today**: `1 / z`
  with `z: real<-1..1>` types `real`, while `1 / 0` EVALUATES to `~oo`
  and `0 / 0` to `NaN` — neither inhabits `real`. That is a pre-existing
  unsoundness of the handler (its comment even says so: "possibly-zero
  denominators are treated like the real/real branch"). Both review legs
  flagged that a bounds-only plan cannot leave it standing; §3.5 fixes
  it.
- **Reciprocal exactness**: `1/x` is exactly representable iff `x` is a
  power of two — verified exactly (200,000 random doubles across 2,000
  binary orders of magnitude, bigint cross-multiplication, 0
  mismatches). `Math.log2(x)` being integral is NOT that test (false
  positives at 4,080 of 4,092 near-neighbors of powers of two); the
  significand bit test is exact across every exponent, subnormals
  included.
- **Reciprocal overflow**: `1/x` is finite iff `|x| ≥ 2⁻¹⁰²³`
  (`1.1125e-308`, inside the NORMAL range); everything below — the
  whole subnormal range AND the bottom binade of the normals, including
  `1/MAX_VALUE` itself — overflows to `±∞`. Subnormality is not the
  predicate.

## 3. The kernel

### 3.1 `dirRecip` — the directed reciprocal

Beside `dirSum`/`dirProd`, one more directed primitive:
`dirRecip(x, dir)` returns a double ≤ (dir < 0) or ≥ (dir > 0) the exact
`1/x`, for a NONZERO finite or infinite `x`. It is never called with 0
(§3.2 handles the zero-side endpoint of an open-at-0 divisor
explicitly, before any reciprocal is taken).

- `x = ±∞`: the exact `1/x` is `0`, returned as `0` (the sign is
  immaterial: §3.2 records the limit's side through the OPEN flag and
  the mirrored endpoint, never through a signed zero — the constructor
  normalizes `-0` away, so no design may depend on it).
- Finite nonzero `x`: compute `q = 1 / x`.
  - **Overflow, gated on the RESULT** (mirroring `dirProd`, which
    branches on `p === ±Infinity`, never on operand class): if `q` is
    `±Infinity`, the true reciprocal exceeds the double range; return
    `±MAX_VALUE` when `dir` points INWARD (toward zero) and `±∞` when it
    points outward, with the sign of `x`. (The subnormal `2e-308` has
    the finite reciprocal `5e307` and must NOT saturate — the review's
    counterexample.)
  - **Exactness**: `q` is exact iff `x` is a power of two, decided by
    the IEEE-754 bit test — a zero significand for a normal `x`, a
    one-hot significand for a subnormal `x` (both via a
    `Float64Array`/`BigUint64Array` view; the subnormal powers of two
    whose reciprocals are representable, `2⁻¹⁰²³` and above, are
    exactly the ones the bit test admits and the overflow gate did not
    catch). An exact `q` is returned as is.
  - Otherwise one ulp outward: `nextDown(q)` for `dir < 0`, `nextUp(q)`
    for `dir > 0`.

### 3.2 `recip(b)` and `divIntervals(a, b)`

`recip(b)` is defined only for a divisor interval `b` that EXCLUDES zero:
`b.lo > 0`, or `b.hi < 0`, or `b.lo === 0 && b.loOpen`, or
`b.hi === 0 && b.hiOpen` (an open endpoint AT 0 — the canonical
"positive" `real<0<..>` and "negative" `real<..<0>` since open bounds).
`1/x` is monotone decreasing on each side of zero, so the endpoints
SWAP:

- `recip(b).lo` comes from `b.hi`, `recip(b).hi` from `b.lo`.
- **The zero-side endpoint is a limit, computed WITHOUT `dirRecip`
  (both legs' first finding):** if `b.lo === 0` (open, positive side),
  `recip(b).hi = +∞`; if `b.hi === 0` (open, negative side),
  `recip(b).lo = −∞`. The infinite endpoint is "unbounded on that side"
  — the general model's meaning — and the flag on an infinite endpoint
  is not set (flags are meaningful for finite endpoints only).
- **An infinite divisor endpoint maps to the OPEN 0**: `b.hi = +∞` gives
  `recip(b).lo = 0` open; `b.lo = −∞` gives `recip(b).hi = 0` open.
  This is a hard-coded limit case, not an instance of the general
  attainability rule (an infinite endpoint carries no flag to apply it
  to). It is sound HERE because the divisor's tier is finite-only under
  the post-flip lattice — no `real` value IS `±∞`, so `1/x` is never
  exactly 0 — and a future extension of interval attachment to a tier
  that can attain `±∞` (`non_finite_number`) must revisit it.
- **Finite nonzero endpoints** follow the general rule (open-bounds plan
  §3.5): the reciprocal endpoint is open iff the divisor endpoint it
  comes from is open AND the reciprocal was exact; an inexact
  (ulp-stepped) reciprocal is CLOSED, like every stepped bound. (This is
  the same demotion rule the §4 example `1/x` for `x > 3` →
  `<0<..0.3334>` shows: the coarsened upper bound closes.)

Then `divIntervals(a, b) = mulIntervals(a, recip(b))`, which already
handles every sign combination, corner ties, the closed-zero corner
(`0 / y` attains 0 when `a` attains 0), and NaN-dropping. **No signed
zero is needed for the composition** (the review's concern): the only
zero endpoint `recip(b)` can carry is the OPEN 0 from an infinite
divisor endpoint, and `mulIntervals`' zero-corner rule reads the flag
(`x === 0 ? xo`), not the sign — an open zero never attains, whichever
side it came from; the side is already encoded by which endpoint (lo or
hi) holds it.

For a divisor that ADMITS zero — `b.lo ≤ 0 ≤ b.hi` with a closed
touching endpoint, or `b` straddling 0 — `divIntervals` answers
`undefined`: no bounds (§6). What the TIER then claims is §3.5.

### 3.3 `Power` with `n ≤ -2`

`x^n = 1 / x^|n|` for a literal integer `n ≤ -2`:

1. `p = powInterval(x, |n|)` (exists; note `|n|`, the magnitude —
   `powInterval` rejects `n < 1`).
2. **Gate on the COMPUTED `p` excluding zero** (the review's third
   converged finding), by the same test §3.2 applies to any divisor —
   NOT on the base excluding zero. The two are not equivalent in double
   arithmetic: `x: real<1e-300..>` (closed, mathematically excludes 0)
   squares to a lower bound that UNDERFLOWS to a closed 0, and feeding
   that to `recip` would violate its precondition. When `p` admits zero
   → no claim; the pre-existing sign arms answer (`x^-2 ≥ 0`, positive
   base → positive), as `refinePow`'s `??` fallbacks do for `n ≥ 1`.
3. `recip(p)`, attached to the tier the arm chose.

The `Power` handler's `powN` gate widens from `n ≥ 1` to `n ≠ 0` with
`|n|` a safe integer; `n = 0` stays out (`0^0` is indeterminate; the
pole guard above the arms keeps its `number` claim). **`refinePow` needs
a real restructuring, not just the gate** (the review's fourth
finding): today it calls `powInterval(bIv, powN)` directly, which
returns `undefined` for every negative `powN`, so widening the gate
alone would make the feature a silent no-op. The new shape:

```
refinePow(tier, opts):
  if powN > 0: iv = powInterval(bIv, powN)              // as today
  else:        p = powInterval(bIv, -powN)
               if p undefined or p admits zero → undefined
               iv = recip(p)
  … then the existing finalize / clamp / requirePositive / attach steps
```

Call-site audit (the same finding): of the three arm families, the
`base.isRational && exp.isInteger` arm already calls `refinePow` for
every exponent sign; the `base.isExtendedReal` sub-arms do too. The
`base.isInteger && exp.isInteger` arm's NEGATIVE-exponent branch does
NOT (it returns the sign claim directly), so `x: integer<2<..<3>`,
`x^-2` gets no refinement until that branch gains a
`refinePow('rational', { clampNonNegative: even }) ?? …` call. All
three arms are in scope.

### 3.4 Attachment, tiers, arity and route parity

`attachInterval` is unchanged: the fold attaches only to a NaN-free
real tier the handler chose. Two rungs receive the fold in the `Divide`
handler — `den.isInteger && num.isInteger → rational` and
`isExtendedReal both → real` — each attaching `divIntervals` of the two
operands' `intervalOfType` results, aborting (no bounds) when either is
`undefined`, the same abort rule as `Add`/`Multiply`. A negative integer
divisor needs nothing special: `recip` and `mulIntervals` carry signs.

**Arity.** The `Divide` signature is `(number, number+)`, and the
handler reads only `[num, den]`. On the canonical route a `Divide` node
is exactly binary by construction (`canonicalDivide` folds n-ary
pairwise), so the two-operand call is exact there. A STRUCTURAL
`Divide(a, b, c)` reaches the handler with three operands and, today,
silently types from the first two. Bounds computed from `a / b` alone
would be WRONG for the true quotient `a / (b·c)` (a further division
can land anywhere), so the handler must NOT attach bounds when
`ops.length > 2`: guard on the arity, and leave the pre-existing
two-operand tier claim as is (accepted pre-existing behavior, out of
this plan's scope to change — §5).

**Route parity for `n = -1`.** A structural `Power(x, -1)` reaches
`Power`'s handler (no `Divide` rewrite) and, with the widened gate,
`refinePow` computes `recip(powInterval(x, 1)) = recip(x)` — the same
interval `Divide(1, x)` computes through `mulIntervals([1,1],
recip(x))`. A test constructs both and asserts equal types.

### 3.5 The tier a zero-admitting divisor claims — owned here

Pre-existing (§2): `1 / z` with `z: real<-1..1>` claims `real`, which
excludes the `~oo` that `1/0` evaluates to and the `NaN` of `0/0`.
Attaching no bounds does not repair the tier, so this plan repairs it
in the two scalar rungs: when the divisor's interval ADMITS zero (the
§3.2 test fails) and the divisor is not provably non-zero by sign
(`operandSgn` ∉ {positive, negative, not-zero}), the rung claims
**`real | infinity | nan`** instead of `rational`/`real`.

Why that spelling and not bare `number` (the refinement, verified
2026-08-29): a real ÷ real quotient can only be a finite real, the
projective `~oo` of `1/0` (whose type is `~oo <: infinity`), or the
`NaN` of `0/0` — it can never be a non-real finite complex, which
`number` would over-admit (`complex` is NOT a subtype of the union;
the union IS a subtype of `number`). This follows the ratified lattice
direction — ruling L3 in
`docs/plans/2026-08-26-numeric-lattice-ratification-brief.md`:
over-admit only within the `infinity` branch, with `| nan` carrying
the 0/0 case — and it is exactly what storage keeps anyway (the O9
handler-result widening sends the `~oo` value to `infinity`). The
compiler's real lane is unaffected: `isComplexValued` reads the FINITE
part of the type, which strips the `infinity`/`nan` branches and leaves
`real`. (The flip's "spell generic claims `number`, never `complex`"
convention is about the generic unknown-operand claim, not about pole
unions, which should spell their branches.) A divisor with NO interval
(a bare `real` symbol reads as unbounded, so it admits zero) therefore
also claims `real | infinity | nan` unless its sign proves otherwise —
the honest answer for `1 / r`, `r: real`.

This IS a behavior change visible to users and pins (`1 / z` no longer
types `real`), so it is measured with the full suite, and it is the
part of this plan most likely to intersect the lattice flip's Phase 3
conformance round (which is reworking pole claims in the same
handler); the implementation rebases on that commit before touching
the rungs.

## 4. Soundness and testing

- **`dirRecip` exact endpoint checks**: random nonzero doubles across
  all magnitudes, bigint cross-multiplication of the dyadic bound
  against the exact `1/x`; power-of-two divisors come back EXACT
  (`dirRecip(8, ±1) === 0.125`, no step), including subnormal powers of
  two at and above `2⁻¹⁰²³`.
- **Named boundary cases (the review's list)**: `dirRecip(Number.MIN_VALUE,
  ±1)` and `dirRecip(1/Number.MAX_VALUE, ±1)` (true overflow — saturate
  by direction); `dirRecip(2e-308, ±1)` (subnormal, FINITE reciprocal —
  must not saturate, must be correctly directed); `dirRecip` around
  `2⁻¹⁰²³` on both sides of the threshold; `nextUp`/`nextDown`
  neighbors of powers of two across the exponent range (the `log2`
  false-positive class — must NOT be classed exact).
- **`recip` special cases**: `(0, 1]`, `[−1, 0)`, `(0, +∞)`, `(−∞, 0)`,
  `[3, +∞)` → `(0, 0.3334]`-class (open 0 from the infinite endpoint;
  closed coarsened upper).
- **Attainability battery** for `divIntervals` over small-integer
  intervals with every flag combination, divisors on either side of
  zero and one-sided-unbounded (the exhaustive style of
  `open-bounds.test.ts`): a bound claimed open is never produced by
  attained pairs; every attained quotient lies inside the claim.
- **Underflow gate**: `x: real<1e-300..>` (closed), `x^-2` — the
  computed square admits 0, so no bounds; the sign arm's `≥ 0` claim
  survives.
- **Zero-admitting divisors**, all shapes (`real<-1..1>`, `real<0..1>`,
  `real<..0>`, bare `real`): no bounds AND tier `real | infinity | nan`
  (§3.5) — plus a pin that `complex` does NOT match it and that the
  compiler still picks the real lane for such a quotient;
  `assume(y > 0)` restores `real` with bounds.
- **Route parity**: structural `Power(x, -1)` vs `Divide(1, x)` — equal
  types; structural `Divide(a, b, c)` — no bounds attached.
- **Consumers**: `Arcsin(x / y)` with `x: real<0..1>`, `y: real<2..4>`
  proves `real`; `Power(x, -2)` for `x: real<2<..<3>` types
  `real<0.1111..0.25>`; `x: integer<2<..<3>`, `x^-2` gets its bounds
  through the integer arm.
- **Blast radius**: full suite + snapshot count before landing — the
  quotient rungs are hot, and §3.5's tier change reaches every
  possibly-zero symbolic divisor; the measurement is the size gate.

## 5. Out of scope

- Splitting a quotient around a pole into a union of ranges — the
  refinement §6 option (b) describes; needs the bounds reader to treat
  a `non_finite_number` union member as an infinite endpoint first.
- `Power` with a non-literal or non-integer negative exponent
  (`x^-y`, `x^-0.5`) — transcendental composition, deferred since the
  first interval round.
- Quotients through collection/tuple/broadcast cells — those arms keep
  their shape logic and get no bounds, like `Add`/`Multiply`.
- Making a structural n-ary `Divide` type from ALL its operands
  (pre-existing two-operand read; this plan only guards its bounds).

## 6. The question that needs a ruling

**What does a quotient claim when the divisor range ADMITS zero?**

- *(a) No bounds, sound tier — RULED.* `divIntervals` answers
  `undefined`; the rung claims `real | infinity | nan` (§3.5) unless the
  divisor's sign proves it non-zero. Sound; needs no new representation; every
  zero-excluding divisor (the common case after `assume(y > 0)`, an
  open-at-0 range, or a literal) gets full bounds. Cost: `1 / z` for a
  possibly-zero `z` now prints `number` where it printed the unsound
  `real` — a visible, measured change. If nothing is decided,
  implementation blocks here.
- *(b) Split around the pole and claim the hull.* For a two-sided
  divisor the hull is the full line (no gain); for a one-sided one
  (`y: real<0..1>`, `x > 1`) the quotient is `> 1` OR `+∞`, so the
  claim would be `real<1<..> | non_finite_number` — a union with the
  pole tier that no current consumer reads bounds from
  (`intervalOfType` needs every member to answer, and
  `non_finite_number` reads as unbounded). Real gain only after the
  reader learns to treat the pole member as an infinite endpoint; a
  follow-up, not this round.

## 7. Provenance

Continues the interval kernel (`numerics/interval-arithmetic.ts`,
2026-08-27) and the open-bounds round (2026-08-28) whose attainability
rules §3.2 reuses. The canonicalization facts, today's quotient types,
the reciprocal-exactness equivalence, the `Math.log2` false-positive
rate and the overflow threshold were all verified empirically on
2026-08-29. Revision 2 follows the dual spec review of 2026-08-29; both
legs independently found the `dirRecip(0)` invariant violation, the
result-vs-operand overflow gate, and the `powInterval` underflow gate.
