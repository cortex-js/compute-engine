# Conditional values — producer emission & threading for `When`/`Which` (B15)

**Status:** design ratified 2026-07-12; **Phases 1–2 implemented
2026-07-12.** Phase 1 (threading algebra) — step-4c pre-pass in
`boxed-expression/boxed-function.ts` (`threadConditional`), decision-9 +
`When` options-threading fixes in `library/control-structures.ts`. Phase 2
(Solve adopter) — 14 trig/hyperbolic validity rules emit `When`-guarded
roots via templates, `conditionalRoot` chokepoint + pruning in
`findUnivariateRoots`/`validateRoots` (`boxed-expression/solve.ts`),
`benchmarks/audit/solve.ts` oracle grades guarded roots. Tests in
`test/compute-engine/conditional-values.test.ts`. Snapshot blast radius:
**zero** across both phases; solve benchmark held at 38/40 (= SymPy =
Mathematica). Phase 3 (Sum/Integrate adopters) demand-paced.
**Scope:** make operations able to *return* parameter-conditional results, by
(1) fixing the semantic split between the two existing conditional heads,
(2) adding the threading algebra that lets arithmetic and function application
flow through them, and (3) adopting `Solve` as the first producer. ROADMAP
item **B15**.

## Problem

The representation side of conditional values is done: `Which` stays inert
while its conditions are undecidable, resolves once `ce.assume()` decides one,
and serializes to a LaTeX `cases` environment; `When(e, cond)` (the D3
restriction head) gives `e` where the condition holds and `Undefined` outside.

But no operation ever *produces* a conditional result. Each producer today
either picks the generic branch, silently drops the validity condition, or
stays inert:

- **Solve:** `a·sin(x) + b = 0 → arcsin(−b/a)` is emitted without the
  `|b/a| ≤ 1` validity condition. The rule's own guard checks it for
  *numeric* ratios and then explicitly waves symbolic ratios through
  (`solve.ts` `solve.sine` / `solve.sine-second-branch`:
  `if (v === undefined) return true; // Allow symbolic ratios`). Same
  pattern for the extraneous-root conditions on radical equations.
- **Sum/Limit:** `Σ xⁿ = 1/(1−x)` holds only for `|x| < 1`; convergence
  conditions are dropped or block evaluation entirely.
- **Definite integration:** results genuinely piecewise in a free parameter
  stay inert — `∫_{−π}^{π} (1 − x·cos t)/(x² − 2x·cos t + 1) dt` = `2π` for
  `|x| < 1`, `0` for `|x| > 1`; CE returns the unevaluated integral.

And even if a producer emitted a conditional, nothing could consume it:
**no threading exists** (verified 2026-07-12):

```
When(x, x>0) + 1        → stays inert (Add of a When and 1)
sin(When(x, x>0))       → stays inert
Which(x>0,1, x<0,−1)+2  → stays inert
0 · When(x, x>0)        → stays inert (the 0·x → 0 fold does NOT fire — good)
When(v,c) / When(v,c)   → stays inert (the x/x → 1 fold does NOT fire — good)
Undefined + 1           → NaN (Undefined is absorbing in arithmetic)
```

A conditional that no operation can consume just moves the inertness one
level up — so the threading algebra is a prerequisite for any producer.

## The two heads — no new head needed

The ROADMAP posed "emit `Which` directly vs. a dedicated wrapper head
(Mathematica's `ConditionalExpression`)". Resolution: **CE already has both
shapes; reuse them, introduce nothing.**

| Concept | Mathematica | CE head | Meaning |
|---|---|---|---|
| Case split | `Piecewise` | `Which(c₁,v₁, c₂,v₂, …)` | value depends on region; first-true-wins; `Undefined` in the gaps |
| Guarded value | `ConditionalExpression` | `When(e, cond)` | one value, valid only where `cond` holds; `Undefined` outside |

`When` already has `ConditionalExpression` semantics: `e` when True,
`Undefined` when False, holds when undecidable, and stacked guards
canonicalize by conjunction (`When(When(e,c₁),c₂) → When(e, c₁∧c₂)`) —
the same accumulation `ConditionalExpression` does
(`library/control-structures.ts`).

**Decision test for producers — what is the answer where the condition is
false?**

- A *different but genuine value* → `Which`. (The definite-integral case:
  `2π` here, `0` there.)
- *No value at all* — diverges, out of domain, no solution → `When`.
  (Solve validity conditions; Sum convergence regions.)

The operational reason to keep them distinct even though
`When(v,c) ≡ Which(c,v)` formally: they thread differently. `When` guards
combine by **conjunction**; `Which` regions combine by **cross-product of
branches**. Collapsing one into the other loses whichever algebra you didn't
pick.

## Decisions (2026-07-12, ratified)

1. **No new head.** `When` = guarded value, `Which` = case split. No
   `ConditionalExpression` alias (Mathematica-name policy per B14).
2. **Predicate threading is conservative.** Sign/comparison predicates on
   `When(v, c)` return `undefined` (unknown) unless the guard is decided
   True. Rationale: `Undefined` is not positive/negative/…, and the
   `undefined → false` collapse is the codebase's most recurring bug class —
   optimistic predicate threading into solve()'s root filtering would mint a
   new instance. Mathematica-style *conditional* predicate threading is a
   possible later upgrade, not v1.
3. **The `NaN` vs `Undefined` seam is noted and accepted.** Today
   `Undefined + 1` evaluates to `NaN`; a threaded `When(v+1, c)` with a
   false guard gives `Undefined`. Both mean "no value"; unification is out
   of scope. Threading may therefore change `NaN` outputs to `Undefined` in
   snapshot-visible ways — that is deliberate.
4. **`Solve` is the first adopter.** It exercises the hardest consumption
   rule (solution-set pruning) while needing zero region-splitting analysis.
   Sum and definite integration follow demand-paced.
5. **Guards are never dropped by generic folds.** CE's house convention
   (`x/x → 1`, `0·x → 0`) drops *measure-zero* caveats. A `When` guard like
   `|x| < 1` has a **fat complement** — dropping it changes the answer on an
   open region — so the genericity argument does not extend to guards.
   Threading must fire before (or instead of) any fold path. Empirically
   safe today: neither fold currently fires on `When` operands.
6. **Layering normal form: guard outermost.** A result both piecewise and
   guarded is `When(Which(…), guard)`. Per-branch guards
   (`Which(c₁, When(v₁,g₁), …)`) remain legal (branches may have different
   validity regions); flattening them into `Which(c₁∧g₁, v₁, …)` is sound
   **only when the cᵢ are pairwise disjoint** (first-true-wins would
   otherwise let a later region capture a `c₁∧¬g₁` point), so flattening is
   an optional disjointness-gated simplification, never a canonicalization.
7. **Emission goes through one helper.** Producers never construct `When`
   directly; a single `conditionalValue(value, guard)` chokepoint consults
   evaluation + the assumption store first and returns the bare value /
   `Undefined` / `When(value, guard)`. This enforces "emit only when
   genuinely undecidable" in exactly one place.
8. **Solution-set pruning contract.** In solution-list position, a `When`
   element whose guard resolves False **vanishes** (the list shrinks,
   possibly to `[]`) — it does not become an `Undefined` element. Guard
   True → element unwraps. Guard undecided → `When` element retained.
   (Mirrors Mathematica: a `ConditionalExpression` solution whose condition
   resolves False drops the rule.)
9. **`Undefined` as a `Which`/`When` condition falls through** (treated as
   not-True), instead of hitting the non-boolean throw in `evaluateWhich`.
   Needed once boolean-valued `When`s can reach condition position.
10. **Cross-product cost gate.** `Which ⊕ Which` threading with a resulting
    branch count above a threshold (16) stays inert rather than exploding.

## Design

### Threading rules

**`When` — guard algebra (conjunction accumulates):**

- **T1** `f(When(v, c)) → When(f(v), c)` — scalar function application.
- **T2** `When(v, c) ⊕ a → When(v ⊕ a, c)` — plain operand absorbed.
- **T3** `When(v, c) ⊕ When(w, d) → When(v ⊕ w, c ∧ d)`.
- **T4** Guard resolution (evaluation + assumption store): True → `v`;
  False → `Undefined` (or pruned, in solution-set position); undecided →
  hold.
- **T5** Nesting canonicalizes by `And`-fold (already shipped).

*Soundness:* outside the guard both sides are no-value — `When(…)` gives
`Undefined`, and threading's `f(Undefined)`/`Undefined ⊕ a` is
absorbing-to-`NaN` (verified above) — so T1–T3 agree with the unthreaded
form everywhere, modulo the accepted `NaN`/`Undefined` seam (decision 3).

**`Which` — region algebra (distribution over branches):**

- **T6** `f(Which(c₁,v₁, …)) → Which(c₁, f(v₁), …)` — conditions untouched.
- **T7** `Which(c₁,a₁,…) ⊕ Which(d₁,b₁,…) →` the **lexicographic**
  cross-product `Which(c₁∧d₁, a₁⊕b₁, c₁∧d₂, a₁⊕b₂, …)`, cost-gated
  (decision 10). Lexicographic order preserves first-true-wins *without* a
  disjointness requirement: for the selected pair (minimal i with cᵢ true,
  then minimal j with dⱼ true), every lexicographically earlier pair has a
  false conjunct. (Contrast with the flattening in decision 6, which does
  need disjointness — there the fallthrough value changes, here it doesn't.)

Mixed `When ⊕ Which`: thread the `Which` branches (T6/T7 shape), then the
`When` guard wraps the result (layering normal form, decision 6).

### Emission helper

```ts
/** Producer-side chokepoint for conditional results.
 * Returns `value` if `guard` is decidable-True (evaluation + assumptions),
 * `Undefined` (or null, for prune-style callers) if decidable-False,
 * and `When(value, guard)` only when genuinely undecidable. */
function conditionalValue(ce, value, guard): Expression;
```

Decidability is the same mechanism `evaluateWhich` already uses: evaluate
the boolean guard and test for literal `True`/`False` — `ce.assume()` facts
participate through evaluation, so the consumer side needs nothing new.

### First adopter: `Solve`

Target rules in `boxed-expression/solve.ts` (the trig cluster,
`solve.sine`/`solve.sine-second-branch`/cos/tan variants, ~line 540): where
`negatedRealRatio(b, a)` returns `undefined` (symbolic ratio), the rule
currently returns the root unconditionally. Change: keep the match, and wrap
the produced root via `conditionalValue(root, |−b/a| ≤ 1)`. Numeric ratios
keep today's behavior exactly (the helper resolves the guard immediately).

Consumption: the solution-assembly path (`findUnivariateRoots` callers and
the validation loop that already filters roots) implements the pruning
contract (decision 8). The `Solve` operator's result `List` may then contain
`When` elements; downstream `.N()`/substitution on such an element threads
by T1/T2.

Harness: the root-substitution oracle in `benchmarks/audit/solve.ts` must
learn to grade a `When`-wrapped root (substitute the value, check the guard
at the sample point). The solve benchmark score (38/40) must not regress.

Later adopters (demand-paced, not this change): radical extraneous-root
conditions (same helper, same contract); Sum convergence regions
(`When(closed_form, |x| < 1)`); definite integration (`Which` — and its
region-splitting analysis, locating where poles cross the contour, is the
hard part and stays deferred).

### Predicates (conservative, decision 2)

`When(v, c).isPositive` etc.: `undefined` unless the guard is decided True
(then delegate to `v`). Never collapse the unknown to `false` in filters —
the existing three-valued-predicate discipline applies.

### Implementation route — the broadcast-lift precedent

Threading a `When`/`Which` through an operator is structurally the same
lift as broadcasting over a `List`, and that retrofit already has a proven
playbook (`docs/plans/2026-07-11-broadcast-typing-lift-design.md`; the
`broadcastable` flag machinery in `boxed-operator-definition.ts` /
`boxed-function.ts`). Follow it: a generic pre-pass keyed on the operator
definition (broadcastable-like capability, or the same flag if the audit
shows the sets coincide), not N hand-edited evaluate handlers; Phase-1
zero-churn discipline; measure the snapshot blast radius before landing
(the `NaN → Undefined` seam of decision 3 is the expected source).

Hazards, from the codebase's own trap list:

- The internal `mul()` helper distributes over sums — `When` threading must
  go through canonical `Multiply` construction, never `mul()`.
- Threading must be positioned so canonical `Add`/`Multiply`/`Divide` see a
  `When` operand before any fold could strip it (decision 5). Today no fold
  fires on `When` operands; keep it that way with regression tests
  (`0·When`, `When/When`).
- `evaluateWhich`'s non-boolean throw: add the `Undefined`-falls-through
  case (decision 9) before threading can route one there.

### Serialization

Nothing new. `When` already round-trips via the D3 restriction notation
(`expr\left\{cond\right\}`); `Which` serializes to a `cases` environment.
A `When`-wrapped solve root therefore displays as the value with its
condition attached, which is the desired UX.

## Phased plan

1. **Threading algebra** (T1–T7, decisions 5/9/10, predicate conservatism):
   generic lift + regression tests; zero producer changes; snapshot blast
   radius measured and reviewed before landing. **Done 2026-07-12.**
   Implementation notes:
   - The inner `op(strippedTail)` application is **evaluated before
     wrapping** in the lifted `When`/`Which` — required so folds run inside
     the guard (`0·x → 0` giving `When(0, c)`) and an inner `Which`
     distributes (the guard-outermost layering).
   - En route, this fixed a pre-existing guard-dropping bug: evaluate-time
     like-term cancellation folded `When(x,c) − When(x,c)` to plain `0`
     (fat-complement drop); it now yields `When(0, c)` because `Add`/
     `Multiply` operands are threaded before the arithmetic handler runs.
   - **Known limitation (accepted):** the pre-pass gate checks *direct*
     operands only, so a conditional nested one level under a lazy
     operator's operand (`5 − When(x,c)` = `Add(5, Negate(When))`) is not
     lifted outermost in one pass — the result is `When(−x, c) + 5`, fully
     lifting on a second `evaluate()`. The guard is never dropped. Fixing
     it would require evaluating lazy operands before the gate on every
     `Add`/`Multiply` evaluation — rejected on the zero-churn/perf
     discipline; revisit only with evidence.
2. **Emission + Solve adopter**: `conditionalValue`, the trig-rule guards,
   the pruning contract, the audit-oracle update. Acceptance:
   `Solve(a·sin x + b = 0, x)` with symbolic `a, b` returns `When`-guarded
   roots; after `ce.assume(…)` decides the ratio bound, the same call
   returns bare roots or `[]`; solve benchmark stays 38/40. **Done
   2026-07-12.** Implementation notes:
   - The **template route worked**: a `When` head in a rule `replace`
     template boxes/evaluates correctly through the solve pipeline (the
     clean-scope rule pitfall did not bite); no per-rule metadata needed.
   - Wrapped all 14 `negatedRealRatio` validity rules: sin/cos
     (`|−b/a| ≤ 1`), cosh (`−b/a ≥ 1`), tanh (`|−b/a| < 1`, strict — open
     range excludes the pole). `tan`/`cot` have no validity bound and are
     untouched. Condition callbacks unchanged, so numeric decidable-False
     still never fires.
   - The chokepoint helper is `conditionalRoot` in `solve.ts`
     (module-local; lift to a shared location when Sum/Integrate adopt).
   - `validateRoots` verifies a guarded root by its **value** (`op1`) —
     substituting the `When` itself would thread a guard-wrapped residual.
   - The explain trace resolves decidable guards so numeric narratives
     match pre-Phase-2 output (symbolic traces surface the `When`).
3. **Demand-paced adopters**: radical extraneous roots, Sum convergence,
   definite-integral region splitting (each a separate reviewed step).
   **Phase 3a done 2026-07-12** — convergence conditions (the fat-region
   subset), per the policy split ratified for antiderivatives: measure-zero
   exceptional parameter points (`∫xⁿ`'s `n = −1`) keep the generic branch
   (matches Rubi's `NeQ`-style generic-by-default predicates, protects the
   D-verification pipeline); fat convergence regions emit `When`.
   Implementation:
   - `conditionalValue` lifted to `boxed-expression/conditional-value.ts`
     (shared chokepoint; `solve.ts`'s `conditionalRoot` is a thin alias).
   - Improper-integral endpoint guards (`library/calculus.ts`): FTC results
     are walked for parameter-dependent endpoint indeterminates (`0^p`,
     `(+∞)^p`, `e^{c·(±∞)}`), resolved to 0 under the convergence condition
     (`∫₀^∞e^(−ax)dx → 1/a {0 < a}`; `∫₀^1xⁿdx → 1/(n+1) {0 < n+1}`,
     previously **leaking `0^(n+1)`**; `∫₁^∞x^(−s)dx` previously leaked
     `∞^(1−s)`). Anything outside the table fails closed (inert, no leak).
     A local `c·e^{L}` antiderivative closes `e^{−a·x}`-shaped integrands
     for ±∞ bounds only (the general antiderivative misses the
     `Negate`-headed exponent — an antiderivative-table gap noted for a
     separate fix; indefinite results unchanged).
   - Geometric series (`library/utils.ts`): `Σ_{k=n₀}^∞ c·rᵏ` →
     `c·r^{n₀}/(1−r)` — exact for numeric `|r| < 1` (`Σ(1/2)ᵏ → 2`,
     `Σ(1/√2)ᵏ → 2+√2`), `When(…, |r| < 1)` for symbolic `r`, inert for
     decidable-divergent ratios.
   - Known cosmetic residual: `∫₀^∞xᵖdx → 0 {0 < p+1 ∧ p+1 < 0}` — an
     unsatisfiable guard (correct: the integral converges for no real `p`;
     a never-true `When` is `Undefined` everywhere), left undetected
     rather than adding contradiction analysis.
   Zero unexpected snapshot churn (one authorized inline-snapshot update:
   the `∫₀^1xⁿdx` leak fix in `calculus.test.ts`). Still demand-paced:
   radical extraneous roots, definite-integral region splitting (`Which`).

## Non-goals

- Mathematica-style conditional predicate threading (decision 2 upgrade).
- `NaN`/`Undefined` unification (decision 3).
- `Which` flattening without a disjointness proof (decision 6).
- The integration region-splitting analysis itself (deferred to that
  adopter).
- A `ConditionalExpression` head or alias (decision 1; B14 name policy).
