# EFFECTS-MODEL.md — Spec Review, Round 2 (DRAFT v2, 2026-07-28)

Reviewers: Codex (gpt-5.6, high reasoning) + Claude (Sonnet, sub-agent),
independent; merged and re-verified by the orchestrating session (all
load-bearing factual claims checked against source/git before inclusion).

Round-1 status: v2 genuinely resolved most of round 1 (stale inventories,
commit citation, lattice diamond, `{any}` getters, flag-getter model, pure ≙
"no impurity label", per-stage tests, blast-radius split). Of round 1's three
criticals: #3 (flagship contract unenforceable) is **resolved** by ruling (c)
+ literal-construction inference; #1 (named callbacks) is **partly resolved**
— the contract layer is fixed, the runtime channel is not (finding 4 below);
#2 (`RandomExpression`) is **resolved-on-paper but now live-disputed** by a
sibling staged spec (finding 1 below).

**17 findings — 2 critical, 9 high, 3 medium, 3 low · 2 open questions for
the author (1, 7)**

---

## Critical

### 1. [Claude] [consistency] Ruling (b) is contradicted by the same-day staged sibling spec `docs/plans/2026-07-28-derived-substreams.md`
**Location**: "`RandomExpression` — ruled: migrate onto the seeded stream"

Verified: `derived-substreams.md` §7 ("What stays outside the frame") rules
the exact opposite — *"`RandomExpression` … keeps bare `Math.random()` and
keeps `drawsRandom: false`. It is a fuzzer harness … it owes the seed frame
nothing and nothing in the model promises it replays. Bringing it in would
be scope creep with no consumer"* — and its "Not in scope" section names
`RandomExpression` explicitly. Neither doc cites the other; both are staged.
An implementer following EFFECTS-MODEL Stage 1 executes a change a
contemporaneous spec argues against. If the migration is dropped, round-1
finding 2 (the lattice cannot represent `RandomExpression`) **reopens**, and
the Stage 1 "write ops" audit procedure would silently sweep
`RandomExpression` into `{write}` (it is `pure: false`, not `drawsRandom`).

**Suggestion**: The author must pick a winner and reconcile: (a) ruling (b)
stands → amend `derived-substreams.md` §7; (b) `derived-substreams.md`
stands → EFFECTS-MODEL needs a label (or stated exception) for un-seeded
external nondeterminism after all, and the write-ops audit procedure must
exclude it explicitly. Cross-reference both docs either way, with a dated
resolution. **Open question for the author.**

### 2. [Codex] [consistency] `WithRandomSeed` cannot discharge its body under the model as specified
**Location**: "Projection and discharge" / "One source of truth"

Discharge is defined only for **function-valued** operands, but
`WithRandomSeed` is `lazy: true` and receives a held **expression** body
(`Random()`), not a callback — so the spec's own flagship discharge example
cannot use the mechanism; the non-function rule propagates the body's
`random` unchanged. Compounding: annotating `WithRandomSeed`'s own arrow
`{random}` re-adds the effect it discharges, while leaving the arrow pure
makes the derived `drawsRandom` getter `false` — breaking the pending-draw
marker the runtime requires. The projection, purity, one-source-of-truth,
and unchanged-runtime requirements cannot all hold simultaneously for this
operator as written.

**Suggestion**: Generalize discharge to named operand *positions* (including
held expression operands), with a per-position accepted-effects bound — a
held-expression position's bound plays the role the parameter signature
plays for callbacks. Separately, split the runtime frame-boundary marker
from the derived `drawsRandom` contract getter (the doc already names this
conflation; the design must actually specify the two fields), then state
`WithRandomSeed`'s exact signature, discharge declaration, metadata, and
pending-walk behavior.

---

## High

### 3. [Codex] [edge-case] Operand contribution conflates *producing* a function with *invoking* it
**Location**: "Projection and discharge" — "for a function-valued operand … its signature's effect set"

The rule **replaces** a function-valued operand's expression effects with
its signature's latent effects. For `Use(MakeCallback())` where evaluating
`MakeCallback()` draws or writes but returns a pure callback, the
application is computed pure — wrong. Conversely, discharge must subtract
only from the *latent* (invocation) effects, never from effects already
incurred producing the operand.

**Suggestion**: contribution(aᵢ) = effects(evaluating aᵢ) ∪
(latentEffects(aᵢ) − discharge(op, i)). Specify the lazy/held-parameter
variant, where operand evaluation happens inside or after the operator.

### 4. [Codex] [architecture-fit] The runtime counterpart is boolean-only — no label-aware channel; round-1 critical #1 only partly resolved
**Location**: "Projection and discharge" — "Runtime counterpart"; "What does not change"

The only concrete runtime amendment is to `BoxedFunction.isPure` — a
boolean that cannot distinguish projected `random` from `write`. The
pending-draw walk reads `expr.operatorDefinition?.drawsRandom` directly and
returns `false` for symbols, so a **named** random callback beneath a
surviving eager HOF application remains invisible to frame accounting even
after the `isPure` fix. "Types feed the walk … now also through projected
operands" asserts a channel the spec never specifies.

**Suggestion**: Specify one expression-level *effect-set* computation (not a
boolean) consumed by `isPure`, the pending-draw walk, and other consumers;
define exactly how `hasPendingImpureApplication` consults projected `random`
while preserving its Hold / lazy-view / value-position exceptions.

### 5. [Codex] [feasibility] The bare `function` primitive has no effect bound — `Map`'s claimed "effect-top bound" is unrepresentable
**Location**: "Blast-radius protocol" — "`Map`'s callback bound is effect-top, not pure"

Verified: `Map`'s signature is `(collection, function) -> list`
(`collections.ts:2751`) — the `function` *primitive*, which has no arrow to
carry an effect set; the spec defines bounds only on full signatures. Nor is
`(any*) ->{any} any` an equivalent replacement: under contravariant
subtyping a fixed-arity callback doesn't subtype an arbitrary-arity bound.

**Suggestion**: Define the `function` primitive's effect semantics
normatively — shape-unconstrained and effect-top as a *bound*, while
projection still reads the actual operand's signature — or introduce an
effect-only constraint orthogonal to arity. Add acceptance tests for unary /
binary / overloaded / untyped callbacks passed to `Map`.

### 6. [Codex] [architecture-fit] "Effects fire at saturated application" contradicts the actual currying runtime
**Location**: "Currying / partial application"

Verified: `makeLambda` partial application **evaluates the body** with the
supplied prefix before constructing the residual lambda
(`function-utils.ts` ~1266: "`newBody` is the evaluated body"). A draw or
write independent of the remaining parameter fires *during* partial
application. Copying the full effect set onto the residual arrow then
either reports an effect that already fired or double-fires it.

**Suggestion**: Either include the `makeLambda` semantic change in Stage 2
(capture arguments without executing the body) with evaluation-order tests
(zero effects at partial application, exactly one at saturation, for both
`random` and `write`), or specify the effect accounting for
evaluate-then-curry as it actually behaves.

### 7. [Codex] [scope/question] Dependency-order unsoundness is retained — and a middle option not previously considered exists
**Location**: "Current state" hole 3; "Inference"; "Open questions"

`f() := g()` before an impure `g` keeps a falsely-pure *installed
signature* driving caching/`.N()`/lowering/GPU/frame decisions; the escape
hatch requires the author to anticipate the problem. New option surfaced
this round, finer than the rejected alternatives: keep the ratified
optimistic rule for **applied unannotated parameters**, but infer `{any}`
for an **unresolved named head** (a name with no definition yet) until it
resolves. That splits the two cases `inferLambdaFlags` currently treats
identically — parameters are *bound by the caller* (the optimism is scoped
and closable by annotation), while an undeclared name is *global state that
will change*. Cost: functions referencing not-yet-defined names lose
caching until the name lands. **Open question for the author** — this
modifies a ruling, so it's yours to take or decline.

### 8. [Codex] [consistency] Translating every legacy `pure: false` residual to `{write}` misstates opaque host effects
**Location**: "One source of truth — and the flag migration"

`pure: false` promises only "not pure" — an opaque host function may read
time, do I/O, or use unseeded nondeterminism without touching engine state.
Auto-translating to `{write}` mints a false serialized contract (and
`RandomExpression` itself is a live example of a `pure: false` non-write
operator — see finding 1). A legacy flag on a *defined* lambda could also
become an explicit `{write}` bound that then *rejects* a body inferred to
have a different effect.

**Suggestion**: Translate unclassified legacy impurity to `{any}`; reserve
`{write}` for audited engine-state writers. Add a normative truth table for
all flag combinations, including contradictory ones
(`pure: true, drawsRandom: true` ⇒ registration error), and distinguish
compatibility sugar from an explicit effect contract.

### 9. [Codex] [completeness] The Monte-Carlo escape is an *observable contract decision*, not a mechanical audit item
**Location**: "`RandomExpression` — ruled" (audit paragraph)

Verified: `numerics/monte-carlo.ts` has 4 raw `Math.random()` sites and is
reachable through `Integrate` — so whether to seed it, mark `Integrate`
`{random}`, or replace with deterministic sampling changes public
signatures, caching, and `WithRandomSeed` behavior. An implementer cannot
settle that inside an "audit". (Note: this decision also interacts with
`derived-substreams.md`, whose entire scope is these estimator sites —
reconcile with finding 1.)

**Suggestion**: Rule each known observable escape in the spec: the random
source for Monte-Carlo integration, the resulting `Integrate` effect
contract, and seeded replay tests; give a precise criterion for the
stochastic-equality path to qualify as non-contract-visible.

### 10. [Codex] [ambiguity] The Cortex definition encoding is left as an unresolved either/or
**Location**: "Cortex surface" — "carries the **full signature** (or an effects-bearing ascription)"

"Full signature" and "effects-bearing ascription" are different MathJSON
representations with different behavior in the existing machinery:
`Typed(body, returnType)` expects a return type, and
`desugarSignatureString()` (`function-utils.ts`) decomposes a signature into
per-parameter/return annotations, discarding arrow-level information — so
Stage 2's explicit definition-effect contract has **no persistent
representation** until this is chosen.

**Suggestion**: Pick one normative encoding with examples (anonymous
literal, `Assign`, block-form Cortex definition, serialization), define
backward compatibility for existing `Typed` return ascriptions, and
re-sequence so the representation exists before the checks that need it.

### 11. [Claude] [consistency] Incomparable effect sets break "fewer effects = more specific"
**Location**: "Subtyping" — Overloads, vs. the (correctly fixed) diamond lattice

v2's own diamond fix creates this: two arms distinguishable by argument
types but carrying `{random}` vs `{write}` have no "fewer" — neither is a
subset. The spec doesn't say how effect specificity combines with
argument-type specificity, or what happens when the effect signal is
inconclusive.

**Suggestion**: "Effect specificity is consulted only to break ties among
arms already equally specific by argument type; incomparable effect sets
are not compared and fall through to the existing tie-break." Add a test
with incomparable, otherwise equally-applicable arms.

---

## Medium

### 12. [Codex] [architecture-fit] Per-application "resolved arm" effects have no storage or recomputation story
**Location**: "Subtyping" — Overloads

Verified: `overload.ts` treats arm selection as typing-only and transient;
`BoxedFunction` stores no selected arm. The spec doesn't say whether effect
computation stores the selection, re-runs resolution (with identical
admission policies for lazy operands and deferred validation), or falls
back to the definition-wide union — which would contradict the promised
per-call precision. (Clusters with finding 11.)

### 13. [Codex] [edge-case] Nested function literals need an inference *boundary* rule
**Location**: "Inference" — literal-signature construction

`inferLambdaFlags` recurses into nested `Function` subtrees (verified in
source), so `makeCallback() := (() ↦ Random())` is inferred `{random}` even
though *constructing* the callback draws nothing — the effect belongs on
the returned literal's own arrow (its *latent* set, per finding 3's
producing/invoking split). As written this can reject a valid explicit-pure
annotation on the outer definition.

**Suggestion**: Function literals are inference boundaries: compute the
nested literal's arrow effects separately; add them to the enclosing body
only where the body *applies* (or projects) the literal. Tests: returned,
collection-contained, immediately-applied, and HOF-passed nested literals.

### 14. [Claude] [feasibility] "Wherever a literal's signature is computed" is not one seam
**Location**: "Inference" — "At `Function`-literal signature construction — wherever it happens"

`canonicalFunctionLiteral`/`makeLambda` construction reaches from at least
six call sites (`engine-declarations.ts`, `library/calculus.ts`,
`library/core.ts`, `library/collections.ts`,
`boxed-expression/match-dispatch.ts`, `boxed-expression/simplify.ts`) with
no shared choke point; a missed site silently reintroduces the
inline-callback gap.

**Suggestion**: Introduce (or identify) a single choke point all sites
funnel through before adding the walk, or enumerate the sites in the spec
and add a lint/test that fails when a new construction site bypasses it.

---

## Low

### 15. [Claude] [consistency] The RANDOMNESS-MODEL citation is *still* wrong after two rounds — "§2/§5" should be "§2" (Hold and value-position both live in §2; §5 is the draw-consumption contract, unrelated). §6 for lazy materialization is correct. Verify citations against the file, not memory — this exact citation has now been wrong two different ways.

### 16. [Claude] [testability] Effect-set **intersection** is specified for `{any}` but no operation in the spec ever intersects effect sets (projection unions, discharge subtracts, subtyping subsets). Name the consumer or drop the clause.

### 17. [Claude] [ambiguity] "Participate in the existing `reset()`/rebind machinery" points at an inert stub — verified: `BoxedFunction.reset()` is a no-op (its invalidation is commented out). The live pattern is the `ce._generation` counter already guarding two other memoized fields in the same file (~714, ~1244); `_isPure` (~310) has no generation guard today. Point the spec at the generation-guard pattern explicitly.

---

## Suggested revisions

- **Decision required first — finding 1** (and its interaction with 9):
  which doc owns `RandomExpression` and the estimator sites — EFFECTS-MODEL
  ruling (b) or `derived-substreams.md` §7? Everything in the "labels" and
  "migration" sections downstream of ruling (b) waits on this.
- **Theme B — the discharge/projection mechanism needs a v3 pass:** 2, 3,
  4, 13 — held-expression discharge positions, producing-vs-latent operand
  effects, a label-aware runtime channel, literal inference boundaries.
  These four are one coherent redesign of the same section.
- **Theme C — missing representations:** 5 (`function` primitive bound),
  10 (definition-signature encoding), 16 (intersection consumer).
- **Theme D — spec vs. actual runtime:** 6 (currying), 17 (generation
  guard).
- **Theme E — migration precision:** 8 (truth table, `{any}` default), 9
  (estimator rulings).
- **Theme F — overloads:** 11, 12.
- **Theme G — inference seams:** 13, 14.
- **Open questions for the author:** 1, 7.
