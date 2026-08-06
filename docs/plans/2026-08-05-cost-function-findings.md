# Cost-function measurement round — findings and proposal

**Status:** 2026-08-05/06. **All measured defects are now IMPLEMENTED** —
D1, D2, D3, D4, D6, D7. See "What was done".

## What was done

D2 (canonicalization invariance) landed, together with the `Negate` repricing
it implied:

- `powerCost(base, exp)` extracted from the `Power` branch, and `Square` /
  `Exp` routed through it — they canonicalize to a `Power`, so they must price
  identically. Was `Square(x)` 6 structural vs 1 canonical, `Exp(x)` 10 vs 1.
- `Negate` is now **context-sensitive**: cost 1 for a sign on a term, 4 when
  its operand is an `Add` (negating a sum forces delimiters). This is what
  makes `Subtract(a,b)` cost the same as its canonical `Add(a, Negate(b))`.

**Measured effect** — against the yardstick below:

| metric | before | after |
|---|---|---|
| canonicalization invariance | 3/6 | **9/9** (incl. compound bases) |
| preference corpus | 10/14 | **12/14** |
| tag-dependent rows the model gets right | 0/4 | **2/4** |
| integral cost inversions | 2/10 | **0/10** |
| `transform` tags retired | — | **1** (nested radical) |
| ad-hoc penalties removed | — | **3** (Sqrt +6/+10, Negate(Power) shortcut) |
| full suite | — | green, **9 snapshots changed** |

Both snapshot changes are improvements, and both are consistency fixes —
each brings an outlier into line with a sibling already in the same file:

- `∫√(x²−1)dx` now returns `½(x√(x²−1) − arcosh x)`, matching the two sibling
  trig-substitution snapshots. It had not flipped with them because the `−`
  made the factored form score worse under the old `Negate` price.
- `Σn²` now returns `⅙(2b³ + 3b² + b)` instead of `⅓b³ + ½b² + ⅙b`, matching
  the style of `Σn` → `½(b² + b)` on the line directly above it. (From D4:
  counting the coefficient's cost makes three separate fractions dearer than
  one.)

D4 (the coefficient cliff) landed next:

- The coefficient's OWN cost is now included, and the magnitude test dropped.
  Integer literals are already priced by digit count, which is continuous, so
  it does that job properly: `10x` 4→5, `11x` **10→5**, `1000x` 7. Base costs
  dropped by one so the two tuned behaviors stay put — `2x` is still 4 (below
  `x + x` at 5) and `n·ln(x)` keeps its extra discount.
- **Do not widen the branch to any numeric coefficient.** My first attempt did,
  and a radical coefficient getting the discount made `√3(x + √2x)` (13) beat
  the factored `√3·x(1+√2)` (16) — the discount applies to the unfactored
  form's outer `√3` too. Restricted to integer/rational, as before: 23 vs 16,
  factored wins.

D7 (new, from a user observation) landed alongside:

- **An unevaluated `Integrate` now carries a flat premium of 100.** This is a
  large finite weight, not a guarantee — a closed form more than ~100 units
  larger than its integral would still lose, and a lexicographic
  "fewer integrals first" gate would be needed for a true invariant. Nothing in
  the model weighed an integral at all before: `Integrate` fell
  into the generic bucket (11), and an antiderivative can be far larger than
  its integrand. Measured over 10 integrals, **2 inverted** — `∫sec³x dx` cost
  49 against a closed form of 78, and `∫1/(x⁴+1)dx` 62 against 145. After: 0/10.
- It is a FLAT premium so it cancels when comparing two expressions that each
  hold one integral (the integrand still decides), and an expression with fewer
  integrals still wins — which is what keeps `∫(f+g)` preferred over `∫f + ∫g`.
- **Honest scope:** this was latent, not the cause of an observed symptom.
  `simplify()` still leaves `∫sec³x dx` unresolved — not because the gate
  rejects the antiderivative, but because nothing offers one: integration runs
  in `evaluate()`, and no simplification rule produces a closed form. The
  premium is preventive, for when a rule does (e.g. Rubi rules loaded into the
  simplification set). Cost: zero test changes.
- The siblings were checked and are fine: `D(x²,x)` 13 vs `2x` 4, `lim` 55 vs
  1, `Sum` 26 vs 15 — all already ordered correctly. Only `Integrate` inverts,
  because only antiderivatives blow up relative to their input.

D3 (the ad-hoc `Sqrt` penalties) and D1 (`Power` ignoring its base) landed
last, and they turned out to be the same lesson twice:

- **D3 — penalties deleted, preference declared.** `Sqrt` carried +6 for a
  perfect-square argument and +10 for an odd power, "to encourage factoring out
  perfect squares". Measured: those rewrites (`√(x²y) → |x|√y` and the rest of
  the `|·|`-extraction family) ADD an `Abs`, so they genuinely grow the
  expression and no honest model will prefer them — `√(x²y)` is 14 against
  `|x|√y` at 19. The penalty existed to manufacture exactly the margin needed.
  It was not even sufficient: `√(x³)` (16) still beat `|x|√x` (19) with the +10
  applied. The family now carries `purpose: 'transform'` (they are real-domain
  correctness rewrites — `√(x²)` is `|x|`, not `x`). **Zero test changes.**
- **D1 — the base is now counted.** `(a+b+c+d)^20` went from 2 to 9. The
  documented intent survives: `2q²` (5) still beats `q·q·q·q` (11).
- **D1's real hazard was an inconsistency, not the base.** A `Negate(Power(…))`
  shortcut returned `3 + cost(exponent)`, discarding the base — so once `Power`
  counted its base, `-sin²x` cost 4 while `sin²x` cost 12: the same
  subexpression priced three-fold apart on nothing but a leading sign. That,
  not the base, is what broke `1 - sin²x → cos²x` (the negated form scored 8
  against the identity's 12). Removing the shortcut fixed it and cut the
  failures from 11 to 6.
- **Power distribution then needed declaring too.** `(ab)^n → a^n·b^n` is
  pinned by the POWER DISTRIBUTION GUARDS tests but is not the cheaper form
  (`a²b²` 11 vs `(ab)²` 10) once each factor pays for its own base. The old
  `Power` cost weighted a `Multiply` base specifically so this would win — a
  price standing in for a preference — so it is now `purpose: 'transform'`.

D1's residue is 3 snapshots: `(√2+√3)²` now reaches the closed form `5 + 2√6`
instead of staying unexpanded (an improvement), a DSolve solution returns the
factored `x(c₁+x)`, and one `checkJson` row label shifts.

**The negated-sum `transform` tag was tested for removal and kept.** With the
new pricing the distributed form wins outright up to FOUR terms (factored
`7+n` vs distributed `3+2n`); beyond that the per-term signs add up and it
loses again. The tag keeps the behavior consistent across sizes rather than
introducing an arbitrary term-count cutoff.

## The yardstick (reusable)

Two measurements, both cheap to re-run:

1. **Canonicalization invariance** — for each alias head (`Exp`, `Square`,
   `Subtract`, `Sqrt`, `Root`, `Negate`), assert `cost(structural) ===
   cost(canonical)`. Build the alias head DIRECTLY with
   `ce.function(op, args, { form: 'structural' })`; re-boxing canonical JSON
   cannot reproduce the defect, because that JSON is already rewritten.
2. **Preference corpus** — pairs of (preferred, dispreferred) forms where the
   ground truth is what THIS PROJECT has ratified (the snapshots it keeps), not
   generic taste. `(x+1)(x+2)` is deliberately EXPANDED here, so it belongs in
   that direction; an early version of the corpus got this backwards.

The four rewrites that currently need a `purpose: 'transform'` tag are exactly
the corpus rows the model gets wrong — so "retire a tag" and "fix the model"
are the same task, and the tag count is a fair scoreboard.

The default cost function (`src/compute-engine/cost-function.ts`) decides every
`simplify()` accept/reject through `isCheaper()`. After the cost gate was made
strict, ten rule families needed `purpose: 'transform'` to survive — which
raised the question of how many of those tags exist only because the cost model
is wrong. This round measured that, then implemented the three defects whose
fix was well-motivated and cheap to verify. Each remaining defect below should
still be ruled on separately — D1 in particular has a large blast radius.

Everything here was measured, not inferred. Claims that did not survive
measurement are recorded as refuted at the end.

## D1 — `Power` ignores its base entirely — **FIXED**

`costFunction` prices a `Power` as the cost of its **exponent** alone (plus the
base only when the base is a `Multiply` or `Negate`).

| expression | cost | leaf count |
|---|---|---|
| `x^2` | 1 | 3 |
| `x^10` | 2 | 4 |
| `x^20` | 2 | 4 |
| `x^1000` | 4 | 6 |
| `(a+b+c+d)^20` | **2** | 8 |

A four-term sum raised to the 20th power — which expands to 1,771 terms — is
priced the same as `x^20`, and barely above `x^2`.

**This is the root of the `(x^10-1)/(x-1)` vs `(x^20-1)/(x-1)` artifact** that
`SYMBOLIC_FINDINGS.md` P2-1 attributed to the gate threshold. Both go through
the same rule; the expansions cost 13 and 33 against a constant 21, so any
monotone gate separates them. The gate is not at fault — the cost model is.

**Why it is this way:** the comment says "we want `2q^2` to be less expensive
than `2qq`, so we mostly ignore the base when the base is simple". That goal is
achievable without discarding the base entirely (e.g. price a `Power` as
`cost(base) + cost(exponent)` and give repeated multiplication a higher name
cost).

**Risk:** this is the single most load-bearing constant in the model. Every
`Power`-involving comparison shifts. Measure the snapshot blast radius before
touching it.

## D6 — Exact radical literals are priced as plain floats — **FIXED**

`numericCostFunction` reduces a `NumericValue` to its `.re`, which is a machine
float — so the radical part of an exact value is invisible:

| literal | cost |
|---|---|
| `3` | 1 |
| `0.5` | 2 |
| `√3` | **2** |
| `2√3` | **2** |
| `√17` | **2** |

`√17` costs exactly what `0.5` costs. This is why `√(2√3)` (7) beats `⁴√12`
(8) and the "single radical" preference row still fails: the nested form hides
an entire radical inside a literal priced as if it were a plain number.

**Fixed** by pricing the radical explicitly when a value carries one
(`rational × √radical`). The premium is calibrated so a radical LITERAL costs
about what the equivalent expression costs: `Sqrt(y)` prices at 6, and `√3`
now prices at 6 too. `√17` is 7 (a bigger radicand costs more); plain integers,
floats and rationals are untouched.

The feared blast radius did not materialise: **4 snapshots**, all in
`calculus.test.ts` and all the same improvement — with a radical now costing
something, keeping ONE factored out beats distributing it across two terms:

    - arctan(2/3sqrt(3) * x + sqrt(3)/3)     (two radicals)
    + arctan(sqrt(3)/3 * (2x + 1))           (one, factored)

One of the four is a `pitfall-test-name-contradicts-snapshot` case: the test is
NAMED `∫1/√(x²+x+1) dx → arsinh((2x+1)/√3)` — the factored form — while its
snapshot pinned the distributed one. The new output moves toward the name.

**This retired a tag.** `sqrt(sqrt(x)) -> x^{1/4}` no longer needs
`purpose: 'transform'`: it was only ever tagged because a radical literal was
priced by its float value, making the nested `√(2√3)` (7) look cheaper than the
collapsed `⁴√12` (8). Now 11 vs 8, and the rewrite wins on its own merits.

## D2 — The cost function is not canonicalization-invariant — **FIXED**

The **same expression** prices differently depending on its representation:

| form | serialization | cost |
|---|---|---|
| canonical | `x * e^x` | **9** |
| structural | `x * exp(x)` | **18** |
| non-canonical | `x * exp(x)` | **18** |

`Exp` keeps its own head (name cost 9) until canonicalization rewrites it to
`Power(ExponentialE, x)`, whose base is then ignored per D1.

This matters because `isCheaper()` compares the incoming `expr` against a rule
result, and the two are not guaranteed to be in the same representation. A rule
returning a structural result is charged up to 2× for a value identical to the
canonical form. This is the likely explanation for a gate-telemetry row showing
`x * exp(x)` at cost 18 during the strict-gate round while the canonical form
measures 9.

**Proposal:** make the cost function canonicalization-invariant — either
canonicalize before costing, or give the alias heads (`Exp`, `Square`, `Sqrt`,
`Root`, `Subtract`) the same price as the canonical form they reduce to. This
is a correctness property of the model, not a tuning knob, and it is testable:
`cost(e) === cost(e.canonical)` for a corpus.

## D3 — Ad-hoc `Sqrt` penalties manufacture the margins they are judged by — **FIXED**

`Sqrt` carries `+6` when its argument is a perfect square and `+10` when it is
an odd power, explicitly "to encourage factoring out perfect squares".

| expression | cost |
|---|---|
| `√y` | 6 |
| `√(x²)` | 12 |
| `√(x³)` | 16 |
| `√(x²y)` | 20 |
| `\|x\|√y` | 19 |

The `√(x²y) → |x|√y` rewrite passes the gate by exactly **1 cost unit**, and
that margin is entirely manufactured by the `+6` penalty. This is a rewrite
preference encoded as a price — the mechanism the `purpose: 'transform'` tag now
exists to express properly.

**Proposal:** delete the penalties and tag the rewrites they were bullying
through. That converts an invisible thumb on the scale into a declared rule
property. Requires checking which rewrites currently depend on them.

## D4 — The `Multiply` coefficient threshold is a cliff

A 2-operand `Multiply` with a "small" numeric coefficient (integer `|c| ≤ 10`,
or *any* finite rational) is priced as an `Add` (3) instead of a `Multiply` (7).

| expression | cost |
|---|---|
| `10x` | 4 |
| `11x` | **10** |
| `(1/7)x` | 4 |
| `10·ln(x)` | 12 |
| `11·ln(x)` | **19** |

Crossing from 10 to 11 costs 2.5×. The threshold is arbitrary and unmotivated
in the source; `1/7` being "small" while `11` is not is hard to defend.

**Proposal:** either drop the magnitude test (any numeric coefficient is
"small") or replace the cliff with the digit-count pricing already used for
integer literals, which is continuous.

## D5 — Integer digit-count pricing: no defect found

`1`→1, `10`→2, `999`→3, `1000`→4, `-1000`→5. Continuous, monotone, and
inherited from Mathematica's `SimplifyCount`. Leave alone.

## What this means for the ten `transform` tags

Measured cost delta for each currently-tagged rewrite:

| rewrite | from | to | delta |
|---|---|---|---|
| exp-of-ln sum | 14 | 9 | **−5** |
| trig π-shift `sin(π+x) → −sin(x)` | 15 | 15 | **0** |
| power combination `2·2^x` | 4 | 5 | +1 |
| nested radical `√√12` | 7 | 8 | +1 |
| negated sum `−(x+1)` | 9 | 10 | +1 |
| `log_4(x³) → 3log_4 x` | 11 | 13 | +2 |
| `ln(x³) → 3ln x` | 10 | 12 | +2 |
| `√(x³) → \|x\|√x` | 16 | 19 | +3 |
| negated sum, 3 terms | 10 | 18 | +8 |
| negated sum, 6 terms | 13 | 33 | +20 |

Two tags look **redundant on the canonical forms measured here** — the
exp-of-ln sum (already cheaper) and the trig π-shift (delta 0, and the gate
accepts equal cost). Both were nonetheless load-bearing in the strict-gate run,
which points back at D2: the gate is not costing the canonical form. Worth
re-testing after D2 is fixed; if the tags then prove unnecessary, remove them.

**The negation tag is NOT a pricing artifact.** Distribution turns one `Negate`
+ one `Add` into one `Add` + n `Negate`s, so at any positive `Negate` price the
distributed form scores worse — measured at `Negate` = 4/3/2/1, the delta for
`−(a+b+c)` is +8/+6/+4/+2. Only a model where a leading sign on a term is free
would flip it. (An earlier note in `simplify-rules.ts` speculated the opposite;
it has been corrected.)

## Recommended order

1. ~~**D2 (canonicalization invariance)**~~ — **DONE.** Cost 1 snapshot.
2. ~~**D4 (coefficient cliff)**~~ — **DONE.** It did NOT rescue the "combined
   power" corpus row as hoped: combining `2·2^x → 2^(x+1)` moves structure into
   the exponent, where the `Add` is charged normally. D1 would not fix it
   either (it makes the comparison 5-vs-6, worse). That row and "log power"
   look like legitimate `transform` cases rather than model defects — both move
   structure into a position the model charges for, and the only way to prefer
   them is an ad-hoc penalty on the other side, which is exactly the D3
   anti-pattern.
3. ~~**D6 (radical literals)**~~ — **DONE.** Cost 4 snapshots, retired one tag.
4. ~~**D3 (Sqrt penalties)**~~ — **DONE.** They were NOT redundant after D6:
   `√(x²y)` is 14 against `|x|√y` at 19, because the rewrite adds an `Abs`. The
   penalty was manufacturing exactly that margin. Replaced with `transform`
   tags; zero test changes.
5. ~~**D1 (Power ignores base)**~~ — **DONE**, 3 snapshots. The churn came not
   from the base but from two OTHER places that discarded it — the
   `Negate(Power(…))` shortcut and the `Negate`-base branch of `powerCost`.
   Lesson: when you start charging for a construct, grep for every other branch
   that special-cases it.

The remaining corpus row, "log power" (`3ln x` 12 vs `ln(x³)` 10), is driven by
`Ln`'s name cost of 9 — the preferred form pays for a `Multiply` *and* a `Ln`
while the dispreferred pays for one `Ln`. No clean fix identified; it may
simply be a rewrite that deserves its tag.

## Verification protocol (learned the hard way)

**Never run two full suites concurrently.** Doing so produced 17 failures —
async-concurrency tests, "does not hang" timeouts, "stays fast" perf assertions
and five Rubi integration cases — every one of which passed in a single clean
run. A polluted run is worse than no run: it nearly got read as a regression.

## Refuted during measurement

- *"`Exp(x)` and `e^x` are priced differently"* — as written, no: `Exp`
  canonicalizes to `Power`, and both cost 9. The real defect is D2 (canonical
  vs structural), which is broader.
- *"Correcting `Negate`'s price would retire the negation tag"* — no, see
  above. Measured at four price points.
