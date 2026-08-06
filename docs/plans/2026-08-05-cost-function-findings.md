# Cost-function measurement round — findings and proposal

**Status:** measurement complete, no code change made. 2026-08-05.

The default cost function (`src/compute-engine/cost-function.ts`) decides every
`simplify()` accept/reject through `isCheaper()`. After the cost gate was made
strict, ten rule families needed `purpose: 'transform'` to survive — which
raised the question of how many of those tags exist only because the cost model
is wrong. This round measured that. **It is a measurement, not a rewrite:** the
snapshot blast radius of changing the model is large and each defect below
should be ruled on separately.

Everything here was measured, not inferred. Claims that did not survive
measurement are recorded as refuted at the end.

## D1 — `Power` ignores its base entirely (highest severity)

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

## D2 — The cost function is not canonicalization-invariant

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

## D3 — Ad-hoc `Sqrt` penalties manufacture the margins they are judged by

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

1. **D2 (canonicalization invariance)** — a correctness property, testable with
   a corpus assertion, and it may retire two tags. Do this first.
2. **D4 (coefficient cliff)** — small, self-contained, easy to bound.
3. **D3 (Sqrt penalties)** — medium; needs the dependent rewrites tagged first.
4. **D1 (Power ignores base)** — highest value, highest risk. Do last, with a
   measured snapshot blast radius, and expect churn.

## Refuted during measurement

- *"`Exp(x)` and `e^x` are priced differently"* — as written, no: `Exp`
  canonicalizes to `Power`, and both cost 9. The real defect is D2 (canonical
  vs structural), which is broader.
- *"Correcting `Negate`'s price would retire the negation tag"* — no, see
  above. Measured at four price points.
