# Interval arithmetic for arithmetic result types

Status: RULED and IMPLEMENTED 2026-08-27 (kernel: `src/compute-engine/numerics/interval-arithmetic.ts`; pins: `test/compute-engine/interval-result-types.test.ts`; full-suite blast radius: 2 test pins + 1 snapshot, all precision improvements) — design for the
interval-arithmetic HALF of the open ROADMAP entry "Ranged types:
interval arithmetic and open bounds". The open-bounds half (a grammar
for open endpoints, strictness propagation, retiring `facts.bounds`) is
NOT covered here and stays open under that entry. The two questions in
§5 were RULED by the user 2026-08-27: question 1 —
`DERIVED_BOUND_DIGITS = 4`; question 2 — scope as proposed (`Add`,
`Multiply`, `Abs`, positive-integer-exponent `Power`; `Divide` and
exponent ≤ 0 deferred with the lattice flip's pole story).

Revision 2 incorporates the dual spec review of 2026-08-27 (Claude +
Codex): the NaN/tier attachment rule (§3.2), reuse of `typeBounds`
(§3.1), the precise rounding algorithm (§3.4), the Power case table
restricted to positive exponents (§3.5), fold semantics (§3.6), and the
adversarial test matrix (§4).

## 1. What this is, in one example

Today, ranges on operand types are deliberately thrown away when the type
of a sum or product is computed:

- `ce.assume(x > 2); ce.assume(y > 3)` — the type of `x + y` is bare
  `real`, although every possible value is greater than 5.
- `|a| + |b|` has the type `real`, although it can never be negative.
- With the literal enclosure types (shipped 2026-08-27), `x + 1/3` with
  `x: real<0..1>` types bare `real`, although the value lies in
  `[0.33, 1.34]` (`1/3` carries the enclosure `[0.33, 0.34]`; the sum of
  the interval lower bounds is 0.33, of the upper bounds 1.34).

This plan makes the `Add`, `Multiply`, `Abs` and (partly) `Power` type
handlers COMPUTE a result range from the operand ranges with interval
arithmetic: the type of `x + y` above becomes `real<5..>`, `|a| + |b|`
becomes `real<0..>`, and `x + 1/3` becomes a range enclosing
`[0.33, 1.34]` (the exact printed bounds depend on the rounding ruling,
§5 question 1 — with the recommended 4-digit coarsening,
`finite_real<0.33..1.34>`).

Consumers already exist and need no change: `signOfType` reads signs off
ranges, and the bounded-inverse domain proofs (`typeBounds` and the
`provably*` helpers in `library/type-handlers-types.ts`) read bounds off
types; `Arcsin`/`Artanh`/`Log` and friends type their results from those
proofs. Today those proofs stop at the first arithmetic node; with this
plan they see through it.

## 2. Why the ranges are stripped today (and what stays)

The strips are NOT an accident. A type JOIN is a set union, and a sum
does not lie in the union of its terms' ranges: `assume(x > −1);
assume(y > −1)` once typed `x + y` as `real<-1..>` — refuted by
`x = y = −0.9` — because the join of the operand types leaked through.
The fix (2026-08-23) was `stripNumericRanges` applied to every join
input: `addType`'s widen tail, the `Add`/`Multiply` cell absorption
(`absorbScalarsIntoCells`), the broadcastable element join, and
`scaleTupleComponents` (see `common/type/utils.ts`, the
`stripNumericRanges` doc comment).

This plan does NOT remove those strips. Joins stay strip-first — that is
what makes them sound. The new bounds come from a SEPARATE computation
that runs next to the tier join: combine the operands' intervals with
interval arithmetic, then attach the resulting interval to the joined
tier (subject to the NaN rule, §3.2). The two must never be mixed: a
join unions sets, interval arithmetic combines them operation-wise.

`Negate` already works this way (`negateNumericType` REFLECTS a range:
`real<-1..>` → `real<..1>`). This plan extends the same idea to the
n-ary operations.

## 3. The mechanism

### 3.1 One interval reader, one kernel — no second `typeBounds`

`typeBounds(t: Type): { lo: number; hi: number }` ALREADY exists
(`library/type-handlers-types.ts`) and reads closed bounds off a type:
value nodes as points, ranges by their bounds, intersections by the
tightest bounds any member proves, unions by the hull, non-real bases
excluded. Introducing a second reader would let the two drift and let a
domain proof and a result range disagree about the same type — the dual
review flagged this as the plan's main architecture risk.

So: the kernel module HOUSES the reader, and `typeBounds` is refactored
to delegate to it. One implementation, two consumers. Placement
(corrected at implementation time): `src/compute-engine/numerics/
interval-arithmetic.ts` — every consumer (the arithmetic handlers,
`typeBounds`) lives in the compute-engine layer, and so do the helpers
the rounding pipeline needs (`nextUp`/`nextDown` in
`numerics/numeric.ts`, `BigDecimal`); placing the kernel in
`common/type` would make the LOWER layer import them upward, the actual
layering violation.

```ts
type Interval = { lo: number; hi: number };
// Closed. lo ≤ hi. Either endpoint may be ±Infinity, meaning "unbounded
// on that side". An Interval never represents an empty set — a reader
// that derives lo > hi (a contradictory intersection) answers
// `undefined` (no claim), never an inverted pair.
```

Reader rules (today's `typeBounds` behavior, restated as the contract):

- A numeric VALUE type reads as a point. Value types hold JavaScript
  doubles by construction, and the engine reads a double as the decimal
  its shortest representation spells (the `isSame` convention: `0.2`
  means 2/10) — the point interval is exact under that convention.
- A range reads its bounds; a missing bound is ±∞ on that side.
- A SINGLETON range (`finite_rational<0.2..0.2>`) is a point, exact
  under the same convention (the machine-exact-rational spelling of
  ruling O9).
- An intersection: the max of the members' lower bounds, the min of
  their upper bounds; members with no interval are IGNORED (sound — the
  intersection is a subset of every member). If that produces lo > hi
  (contradictory members), the reader answers `undefined`.
- A union: the hull; if ANY member has no interval, the union has none.
- `undefined` for anything else — in particular `number` (the only
  NaN-admitting tier: NaN has no place on the line) and the complex
  types.

Kernel operations: `addIntervals`, `negInterval`, `mulIntervals`,
`absInterval`, `powInterval` (positive integer exponents, §3.5). Each
follows the rounding algorithm of §3.4 and the NaN discipline of §3.2.

### 3.2 Infinities, NaN, and when bounds may attach at all

Until Phase 1 of the finite-by-default lattice flip, the bare tiers
`real`/`rational`/`integer` ADMIT `±∞`, and a half-bounded range on
them admits the infinity on its unbounded side (`real<0..>` contains
`+∞`; infinities compare as signed reals — `signOfType`'s existing
convention). The kernel's ±∞ endpoints model exactly that: `x: real<0..>`
reads as `[0, +∞]`, and `[0,+∞] + [2,+∞] = [2,+∞]` is sound whether or
not `x` is actually infinite.

NaN is the one value outside the model, and it is handled by TWO rules,
both mandatory:

- **Endpoint rule.** An endpoint computation that yields NaN in double
  arithmetic is an indeterminate form (`∞ + (−∞)`; `0 · ∞`, which
  `mulIntervals` meets when one interval contains 0 and the other is
  unbounded). The kernel drops the claim ON THAT SIDE. When every
  candidate for a side is NaN — `mulIntervals([0,0], [−∞,+∞])` produces
  NaN for all four endpoint products — BOTH sides are dropped and the
  operation answers `undefined` (no claim). Implementation warning from
  the review: never reduce endpoint candidates with `Math.min(...)` /
  `Math.max(...)` over a possibly-empty array — in JavaScript they
  answer `+Infinity` / `-Infinity` for an empty array, which is the
  WRONG-SIGNED bound; filter NaN first and special-case the empty set.
- **Attachment rule.** A computed interval attaches ONLY when the result
  TIER (computed by the existing, unchanged tier machinery) excludes
  NaN — i.e. never to `number`. A range on a NaN-admitting tier would
  claim an order relation about a value that has none.

The result tier itself is UNCHANGED by this plan (it comes from
`addType` / the `Multiply` handler as today), and this plan never turns
a possibly-infinite tier into a finite one or vice versa. One
pre-existing question the review surfaced is explicitly NOT this plan's
to solve: whether `real + real` (both operands admitting the two
opposite infinities) should already type `number` because `∞ + (−∞)` is
NaN — that is a TIER question about the pre-flip lattice, it exists
today without any bounds, and it belongs to the finite-by-default flip
(`docs/plans/2026-08-27-lattice-flip-implementation.md`). The attachment
rule keeps this plan sound either way: if the tier says `real`, the tier
machinery is on the hook for NaN, exactly as it is today.

### 3.3 Where the kernel is called, and the fallback floor

- **`Add`** (`addType`, `boxed-expression/arithmetic-add.ts`): scalar
  tail only. Collection/tuple/broadcast arms are OUT of scope for
  bounds (their joins stay strip-only, unchanged) — a per-cell bounds
  story rides the broadcast-widening design, not this one.
- **`Multiply`** (`library/arithmetic.ts`): same shape, scalar operands.
- **`Abs`** (`absFunctionType`): the existing claim `tier<0..>` is the
  FLOOR and is kept whenever the operand has no interval (including
  complex operands — `|z|` stays non-negative). When the operand has an
  interval, `absInterval` TIGHTENS it: `|x|` for `x: real<-3..2>`
  becomes `real<0..3>`.
- **`Power`**: positive integer literal exponents only — the case table
  in §3.5. Exponent 0 and negative exponents are deferred WITH `Divide`
  (below), because both need the pole story.
- **`Divide`**: OUT of scope in this round, and negative/zero `Power`
  exponents with it. A denominator (or base) interval that admits 0
  admits the poles, and the result-tier interplay with `~oo`/`nan` is
  exactly what the finite-by-default flip is reshaping — bounds for
  quotients would build on sand. This is a genuine boundary, not a
  convenience: the pole semantics CHANGE under the flip's later phases.

### 3.4 The rounding algorithm (precise, reusing the enclosure machinery)

"Round outward" is defined as this exact three-step pipeline per
computed endpoint, not left to the implementer:

1. **Double step.** Compute the endpoint in double arithmetic, then step
   one ulp outward with the existing `nextDown`/`nextUp`
   (`numerics/numeric.ts`): lower endpoints `nextDown`, upper endpoints
   `nextUp`. This absorbs the ≤ half-ulp rounding of the double
   operation itself. (`Math.pow` is NOT used anywhere: integer powers
   are computed by repeated directed multiplication, §3.5, so no
   correctly-rounded-`pow` assumption is needed.)
2. **Decimal coarsening.** Convert the stepped double to its exact
   decimal (`new BigDecimal(double)` — exact by the shortest-string
   convention) and round it outward to the display precision with the
   existing `BigDecimal.toPrecisionToward(DERIVED_BOUND_DIGITS,
   'floor' | 'ceiling')` (the directed rounding built for the literal
   enclosures). `DERIVED_BOUND_DIGITS` is §5 question 1.
3. **Projection guard.** Project back to a double with `toNumber()` and
   apply the SAME guards the literal enclosures learned the hard way
   (`literalEnclosureType`, `boxed-number.ts`): a non-finite projection
   drops the bound (that side becomes unbounded); a projection whose
   magnitude is below the smallest NORMAL double
   (`MIN_NORMAL_DOUBLE = 2.2250738585072014e-308`) drops the bound —
   subnormal spacing is absolute, so the "projection error is relative"
   argument dies there, the same unsoundness the enclosure round found
   and vetoed. Signed zero: an endpoint of `-0` is normalized to `0`
   before storage (range bounds are compared numerically, where
   `-0 === 0`).

Steps 1 and 3 make every intermediate sound at full precision; step 2
only ever moves a bound FURTHER out, so the pipeline is sound for any
`DERIVED_BOUND_DIGITS` — the ruling is a display/tightness trade, not a
soundness knob.

### 3.5 `powInterval` — the case table (positive integer exponents)

Implementation note (found the hard way): endpoint powers use
exponentiation by SQUARING, O(log n) directed products. A literal
exponent can be huge (`x^10000003` appears in the
`power-negative-base-branch` corpus), and the first implementation's
linear multiplication chain spun a full-suite jest worker at 100% CPU
for ~45 minutes. Bit operations are avoided (`%`/`floor`): a literal
exponent can exceed 2³², where JavaScript `&` silently truncates.


For `x^n` with `x ∈ [lo, hi]` and a literal integer `n ≥ 1`, all powers
computed by repeated directed multiplication (never `Math.pow`):

| Case | Result |
| --- | --- |
| `n` odd (any base sign) | `[lo^n, hi^n]` — `x^n` is monotone increasing on all of ℝ; no sign proof needed. |
| `n` even, `lo ≥ 0` | `[lo^n, hi^n]` (monotone on the non-negative half). |
| `n` even, `hi ≤ 0` | `[hi^n, lo^n]` (monotone decreasing on the non-positive half — the same-sign tightening the review asked for: `x: real<-3..-2>` squares to `[4, 9]`, not `[0, 9]`). |
| `n` even, interval crosses 0 | `[0, max(lo^n, hi^n)]`. |
| `n = 1` | The operand interval unchanged. |
| `n = 0`, `n < 0` | Not computed — deferred with `Divide` (§3.3). |

Infinite endpoints follow the double arithmetic (`(+∞)^n = +∞`, and
`(−∞)^odd = −∞`); no indeterminate form arises for `n ≥ 1`.

### 3.6 The n-ary fold

`Add` and `Multiply` are n-ary. The fold contract:

- If ANY operand has no interval (`intervalOfType` answers `undefined` —
  a `number` operand, a complex operand, a non-numeric), the whole claim
  is ABORTED: no bounds on the result. Skipping an operand would be
  unsound; there is no partial claim.
- Otherwise fold pairwise, left to right, in operand order, applying
  §3.4 step 1 (the ulp step) at each pair. Step 2 (decimal coarsening)
  and step 3 (projection) run ONCE, on the final fold result — per-step
  coarsening would compound a notch per operand for nothing.
- The fold of a single operand is that operand's interval (relevant for
  `Abs` and `n = 1` powers); there is no zero-operand case (canonical
  `Add`/`Multiply` have ≥ 2 operands after folding, and the handlers
  run on canonical forms).
- Per-pair ulp stepping makes the result mildly order-dependent (by
  ulps, not notches). This is accepted: operand order is canonical
  order, which is deterministic for a given expression.

### 3.7 What must NOT change

- The join strips stay (§2). The scope-boundary pin `|x| + |y|` → `real`
  in `ranged-result-types.test.ts` flips to `real<0..>` — that pin's
  comment marks it as the boundary this plan moves.
- Type handlers stay PURE (the O7 doctrine): the kernel reads types
  only, never values, never `.N()`.
- `widenValueTypes` and the storage-boundary rules are untouched: a
  computed result range is a handler claim, exactly like `Abs`'s today,
  and passes through the walker by design.
- Strictness (open endpoints) is not propagated: computed bounds are
  CLOSED, like every range in the grammar. Where an operand's
  strictness matters to a later domain proof, `facts.bounds` continues
  to carry it for symbols. The open-bounds half of the ROADMAP entry
  stays open (see the Status block).

## 4. Soundness and testing

- **Property tests** (the style that validated the literal enclosures):
  sample operand values inside declared ranges, evaluate numerically,
  assert the value lies inside the claimed result range — thousands of
  random cases per operation, with endpoint comparison done exactly
  (bigint cross-multiplication, as in `literal-handler-types.test.ts`'s
  enclosure-soundness block).
- **Deterministic adversarial matrix** (the review's list, each row
  asserting BOTH the claimed range and the result tier):
  - the `x > −1, y > −1` regression: `x + y` must claim `real<-2..>` or
    looser, never `real<-1..>`;
  - admitted infinities: `real<0..> + real<..0>` (the `∞ + (−∞)` NaN
    form — upper AND lower both undecidable → whichever sides survive
    must be sound; the attachment rule with the tier);
  - `mulIntervals` with a zero-containing operand times an unbounded
    one (`0 · ∞` — dropped side), and the all-NaN case
    `[0,0] × [−∞,+∞]` (no claim; also pins the empty-candidate-set
    hazard);
  - bounds at ±0 and crossing zero for `mul` (sign of the product of
    signed zeros);
  - magnitudes at the double-range edges: an endpoint that overflows
    (bound dropped), an endpoint in the subnormal range (bound dropped
    — the §3.4 step-3 veto);
  - every row of the `powInterval` case table (§3.5), including
    infinite endpoints and the same-sign even tightening;
  - a `number`-typed operand anywhere in the fold (claim aborted);
  - operand-order permutations of one fold (results differ by ulps at
    most — a regression guard on the §3.6 contract).
- **Pin migration:** the strip-boundary pins in
  `ranged-result-types.test.ts` move from "bare tier" to the computed
  range; measure the full-suite blast radius before landing (the
  enclosure round's radius was 11 tests / zero snapshots; this touches
  more expressions and needs its own measurement).
- **Withholding check** (the §5.7 method from the type-handlers plan):
  re-run with the computed bounds withheld to confirm no behavior
  DEPENDS on them except through the intended consumers.

## 5. Questions that need a ruling

**Question 1 — how many digits do computed bounds keep?**

Soundness does not depend on this (§3.4 — coarsening only moves bounds
outward); it is a display/tightness trade for `DERIVED_BOUND_DIGITS`:

- *(a) No coarsening (skip step 2).* Tightest. Bounds print as
  17-digit doubles (`finite_real<0.32999999999999996..1.3400000000000001>`
  for `x + 1/3`, `x: real<0..1>`).
- *(b) Match the literal enclosures (2 digits).* Most compact
  (`finite_real<0.32..1.4>`), but each nested operation can lose a
  notch of 1–10% of the magnitude — a 20-deep expression can inflate
  its interval visibly.
- **Recommendation: 4 significant digits** (`finite_real<0.33..1.341>`;
  a notch is 0.01–0.1%, invisible at realistic expression depth, and
  the printed types stay readable). Domain proofs — the real consumer —
  clear thresholds like 1 or 0 by margins far larger than 0.1%.
  If no ruling: implementation blocks — the constant appears in every
  kernel operation and every test pin.

**Question 2 — scope of the first round.**

Proposed: `Add`, `Multiply`, `Abs`, positive-integer-exponent `Power`
(§3.5's full case table, odd exponents on any base sign included) —
with `Divide`, exponent ≤ 0, transcendental composition, and
collection/tuple/broadcast arms explicitly deferred (§3.3). Saying yes
fixes the scope-boundary pins; saying "add Divide" pulls the
pole/lattice questions of the finite-by-default flip into this round;
deciding nothing leaves the ROADMAP entry's interval-arithmetic half
open as today.

(Revision 2 dropped the old question about running the kernel on
unfolded all-literal operands: the kernel does not distinguish operand
kinds, no special case exists to rule on.)

## 6. Out of scope (recorded so they are not re-litigated)

- Open bounds in the type grammar (`real<(0..>`), strictness
  propagation, retiring `facts.bounds` — the other half of the ROADMAP
  entry, unchanged by this plan.
- Division, `Power` with exponent ≤ 0, and general real-exponent
  `Power` (§3.3, §3.5).
- Bounds through collection cells, tuples and broadcasts (§3.3).
- The pre-flip tier question about `∞ + (−∞)` under bare `real`
  operands (§3.2) — the lattice flip's, not this plan's.
- Any change to VALUE arithmetic, folding, or the rule engine — this is
  a type-channel feature only.

## 7. Provenance

Continues the "Ranged types should carry sign (and a literal's value)
through type derivation" line: items 1–4 shipped 2026-08-22/23
(`ranged-declaration-sign.test.ts`, `ranged-result-types.test.ts`), the
literal enclosure types shipped 2026-08-27
(`literal-handler-types.test.ts`, "enclosure soundness" block). The
join-strip history and the `x > −1` regression are recorded in the
`stripNumericRanges` doc comment (`common/type/utils.ts`) and the
ROADMAP entry this plan partly implements. Revision 2 follows the dual
spec review of 2026-08-27 (both legs' findings incorporated; the
finding lists are in the session record, the load-bearing ones named in
the Status block).
