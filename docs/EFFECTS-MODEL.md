# Effects Model — Effects in the Type System

**Status**: DRAFT v3 (2026-07-28). Design proposal, not implemented.
v3 incorporates the round-2 review
(`docs/scratch/EFFECTS-MODEL_SPEC_REVIEW-R2.md`). Ratified decisions:
**(a)** application effects come from *projection with declared discharge*
(v3 respecifies the mechanism per review findings 2–4);
**(b′ — supersedes v2's (b))** `RandomExpression` keeps raw `Math.random()`
and is represented by the new `entropy` label — the v2 ruling to migrate it
onto the seeded stream is **withdrawn**, deferring to
`docs/plans/2026-07-28-derived-substreams.md` §7 (see "Randomness shapes");
**(c)** unannotated function parameters keep the optimistic ruling —
*annotation gets the contract*. Stage 0 (assignment-time flag inference,
`inferLambdaFlags`) shipped in `503728ed` (implementation + pinning tests,
verified). Companions: `RANDOMNESS-MODEL.md` (frames, replay, lazy
materialization) and `docs/plans/2026-07-28-derived-substreams.md` (the
estimator sub-stream design this document defers to for Monte-Carlo
integration, `stochasticEqual`, and `RandomExpression`).

## Purpose and scope

Represent computational effects — randomness, unseeded entropy, and engine
state writes — in **function signature types**, so that:

- an **opaque declaration** (`ce.declare('f', …)`, a host-provided function,
  a serialized contract crossing the Tycho boundary) can state its effects
  where the engine cannot infer them from a body;
- effect information is **compositional**: any function value — inline
  literal, named reference, or opaque declaration — reports its effects to
  an enclosing application through one channel, its signature;
- there is **one source of truth**: the `pure` / `drawsRandom` definition
  flags become derived views of the signature plus one runtime field.

Out of scope, deliberately: general algebraic effects and handlers, effect
*rows* and effect variables (see "Sets, not rows"). The runtime accounting
mechanisms are refined in specified ways (the expression-level effect-set
computation; the frame-protocol field split) but their exception structure
(Hold, lazy views, value position) is unchanged.

## Current state

Effects live entirely outside the type system today, in three mechanisms:

| Mechanism | Where | Behavior |
|---|---|---|
| Definition flags | `pure`, `drawsRandom` (`types-definitions.ts`) | Per-operator declarations; `pure` defaults `true`, `drawsRandom` defaults `false` |
| Expression recursion | `BoxedFunction.isPure` (`boxed-expression/boxed-function.ts`) | Application pure iff operator flag pure **and** every operand pure; unknown operator ⇒ impure (`?? false`); bare symbols always pure |
| Assignment-time inference | `inferLambdaFlags` (`boxed-expression/boxed-operator-definition.ts`, `503728ed`) | When `Assign`/`Declare` binds a `Function` literal, flags derive from the heads its body applies, unless the caller stated them |

Consumers: `isConstant` and derived caches; `Add`/`Multiply` keeping impure
operands evaluated under `.N()` (`library/arithmetic.ts`); the `Map`
lowering gate (`isImpureHead`, `library/map-lowering.ts`); GPU compile
failing closed on impure seeds/endpoints (`compilation/gpu-target.ts`); and
`WithRandomSeed`'s pending-draw gate (`hasPendingImpureApplication`,
`library/core.ts`).

Three known holes, each addressed below:

1. **Named callbacks are invisible** — `Map(xs, f)` with `f` bound to an
   impure function reports pure: bare symbols are always pure and neither
   the `isPure` conjunction nor the pending-draw walk resolves through the
   binding. (→ "Projection and discharge", including its label-aware
   runtime channel.)
2. **Optimistic inference is unchecked** — `inferLambdaFlags` rules an
   unknown head pure (deliberately: treating unknowns as impure would
   forfeit `isConstant` and the fast paths for most user functions). The
   assumption is not a contract. (→ ruling (c): an *annotated* parameter
   turns the assumption into a checked boundary.)
3. **Dependency-order inference is unsound** — `f() := g()` defined before
   an impure `g` keeps a falsely-pure installed signature; only reassigning
   `f` itself re-runs inference. Current ruling: keep, with the
   declared-signature escape hatch. A finer alternative is on the table and
   **awaits a ruling** (see Open Questions): infer `{any}` for an
   *unresolved named head* (global state that will change) while keeping
   optimism for *applied unannotated parameters* (caller-bound, closable by
   annotation).

## Randomness shapes — and why there are three labels, not two

The doc set contains **three** distinct randomness shapes (the third
surfaced by `derived-substreams.md`, which is authoritative for the
estimator and fuzzer rulings):

| Shape | Ambient frame draws? | Reproducible under a frame? | Example |
|---|---|---|---|
| Frame stream | yes — owes draws, replays | yes | `Random`, `RandomChoice`, `RandomPrime`, `RandomSample`, `RandomShuffle` |
| Derived sub-stream | no — frame-independent indices | yes | Monte-Carlo `Integrate` fallback, `stochasticEqual` (per `derived-substreams.md` §§2–6) |
| Unseeded entropy | no | no — nothing promises replay | `RandomExpression` (fuzzer harness, `derived-substreams.md` §7) |

Rulings adopted from `derived-substreams.md` (cross-referenced there):

- **`RandomExpression` keeps raw `Math.random()`** and gets the `entropy`
  label below. v2's migration ruling is withdrawn: a fuzzer owes the frame
  nothing, nothing promises it replays, and frame draws from a fuzzer would
  shift the replay indices of surrounding seeded code.
- **The sub-stream estimators are not effects.** Per `derived-substreams.md`
  §6, `Integrate` stays `pure: true` and not `drawsRandom`; this document
  adopts that as the **noise-floor convention**, stated normatively:
  *nondeterminism confined below the reported error bound of an
  approximation is approximation error, not an effect.* Consequence
  (accepted deliberately, as §6 notes): such results are cacheable, and
  under a frame a previously-flaky verdict becomes consistently — hence
  debuggably — wrong where sampling is too sparse. Any operator whose
  nondeterminism is *not* confined below a reported error bound does not
  qualify and must carry a label.

## Design: effect sets on signatures

### Labels and lattice

An **effect set** is a subset of a closed, engine-versioned enumeration.
Each label carries fixed metadata; consumers read the metadata, never the
label name:

| Label | Meaning | Impurity? | Owes seed frame? |
|---|---|---|---|
| `random` | May consume draws from the ambient seeded stream (replays under a frame) | yes | yes |
| `entropy` | Unseeded, non-replayable nondeterminism from the host environment (`Math.random()`, future clock reads) | yes | no |
| `write` | May mutate engine state (`Assign`, `Declare`, `Assume`, …) | yes | no |

- **`pure` means "no impurity label present"** — NOT literally
  `effects = ∅`. Normative because a future non-impurity label (e.g.
  `async`) must not break caching by mere set-nonemptiness.
- The order is powerset inclusion — a **partial order**, not a chain: the
  singletons `{random}`, `{entropy}`, `{write}` are pairwise
  **incomparable**; none implies another.
- Admission of `entropy` under the three-part test ("Future effect labels"):
  its distinguishing consumers are (i) the pending-draw gate, which must
  *not* pin frames for it (vs `random`), and (ii) re-evaluation policy,
  for which it is safe to re-run but non-reproducible (vs `write`, which
  must not be re-run casually at all). Serialized-contract truthfulness
  rides on (ii): stamping `RandomExpression` `{write}` would tell a
  consumer the opposite of the truth on both counts.
- A distinguished **top**, written `any`, means "unknown effects". For
  **every** derived view and every consumer, `any` behaves as if every
  label (current and future) were present — conservative in all
  directions. Under union `any` absorbs. (No intersection operation is
  defined: nothing in this model intersects effect sets — projection
  unions, discharge subtracts, subtyping subset-tests.)
- An **unknown label** while parsing a type is a type error (fail closed).
  Version-skew consequence at the serialization boundary: an older engine
  receiving a newer engine's type string hard-errors rather than silently
  weakening the contract — the accepted trade; adding a label is a visible
  minor-version event.

### Grammar and AST

`FunctionSignature` (`src/common/type/types.ts`) gains an optional effect
set, attached to the arrow:

```
<signature> ::= <arguments> " ->" [<effects>] " " <type>
<effects>   ::= "{" ( "any" | <label> ("," <label>)* ) "}"
<label>     ::= "random" | "entropy" | "write"   // closed, versioned
```

```
(real) -> real              // pure (no effect set ≡ empty set)
(real) ->{random} real      // may draw from the seeded stream
() ->{entropy} expression   // unseeded nondeterminism (RandomExpression)
() ->{write} nothing        // may mutate state
(real) ->{random, write} real
(real) ->{any} real         // opaque: unknown effects
```

Normalization (normative): `->{}` is a parse error (pure is spelled with a
bare arrow — one spelling round-trips); duplicate labels are a parse error;
`any` is exclusive (`{any, random}` errors); canonical serialization orders
labels alphabetically, parsing accepts any order; whitespace inside braces
is insignificant; in the AST, "no effect set" and "empty set" are the
**same state** (one optional field, absent = pure). **Reserved**: `!`
inside the braces is a parse error today, reserved for the complement form
(see "Requiring absence" under Subtyping) so it can be admitted later
without a breaking grammar change.

Syntax provenance: the arrow-attached brace set follows **Unison**'s
ability annotations (`a ->{IO} b`) exactly; **Koka** places its effect row
in the same position with angle brackets (`int -> <exc,div> int`), which
are taken here by type constructors, and **Eff**'s `A -> B ! Δ` postfix
uses `!`, taken here by negation. Among effect-typed languages the
arrow-attached set is the established convention; Unison's spelling is the
one whose tokens survive CE's existing grammar unchanged.

**The `function` primitive.** The bare primitive type `function` (used
today by e.g. `Map: '(collection, function) -> list'`) is
shape-unconstrained and **effect-top as a bound**: any callable of any
arity and any effect set satisfies it. It is not replaced by a variadic
signature (contravariance would reject fixed-arity callbacks). Projection
is unaffected by the looseness of the bound — it always reads the *actual*
operand's signature, so `Map(xs, pureF)` is still computed pure.

`!` and `&` are taken in the type grammar; braces on the arrow are
unambiguous. Types travel as strings in MathJSON, so effect annotations
round-trip wherever a **full signature** is carried (definition-form
encoding: see "Cortex surface").

### The default: bare `->` means pure

1. **Bodies are transparent** — inference, not annotation, is the primary
   source; annotations speak at opaque boundaries.
2. **It matches the existing defaults** — operator definitions already
   default `pure: true`; every library signature and overload table remains
   valid unchanged.
3. **The residual trust is already accepted** — only an opaque host
   declaration can lie, the same trust class as a wrong declared return
   type.

The polarity asymmetry with the runtime layer stays: **optimistic in
declared contracts, conservative in runtime accounting**.

### Projection and discharge — how applications get their effects

*(Decision (a), respecified in v3.)* The effect set of an **application**:

```
effects(op(a₁ … aₙ)) = ownEffects(op) ∪ ⋃ᵢ contribution(aᵢ)
```

The **contribution** of operand `aᵢ` separates *producing* the operand from
*invoking/evaluating* it:

- **Eager non-function operand**: its own expression-level effects
  (`effectsOf(aᵢ)`, below).
- **Eager function-valued operand** (inline literal, symbol bound to a
  function, opaque declared function):
  `effectsOf(aᵢ) ∪ (latent(aᵢ) − discharge(op, i))` — the effects of
  *producing* the value (e.g. `Use(MakeCallback())` where `MakeCallback`
  draws) are never discharged; only the **latent** set — the operand's
  signature arrow effects, which fire if the operator invokes it — is
  subject to discharge.
- **Held (lazy) operand position**: the operand is not evaluated at
  application time; its contribution is `(effectsOf(aᵢ) − discharge(op, i))`
  — the whole held evaluation happens *under* the operator, so the operator
  may discharge it.

**Discharge** is declared on the operator definition per operand
**position** (not only function parameters):

- Each position may declare an **accepted-effects bound** — for a function
  parameter, its signature arrow effects (contravariant check at the call
  boundary); for a held expression position, a declared bound on the held
  evaluation (default `{any}`).
- Each position may declare a **discharge set** ⊆ its bound: effects the
  operator absorbs rather than re-emits. Default: **discharge nothing** —
  propagation is the sound default and what gives `Map(xs, f)`
  per-call-site precision.

`WithRandomSeed` — specified fully, as the canonical discharger:

- Signature: `(finite_real | string, any) -> expression`, body position
  held (`lazy: true`), bound `{any}`, **discharges `random`** on the body
  position. So `WithRandomSeed(42, Random())` computes `∅` — referentially
  transparent, as it truly is — while `WithRandomSeed(42, Block(Assign(x,1),
  Random()))` computes `{write}`: the frame absorbs the draws, not the
  write.
- **The runtime frame-protocol role is a separate field**, not the arrow:
  the definition gains `frameProtocol: true` (today's conflated second
  meaning of `drawsRandom`), consumed by the pending-draw walk (a surviving
  nested `WithRandomSeed` owes the outer frame) exactly as today. The
  derived `drawsRandom` getter is
  `random ∈ ownEffects ∪ projected` **∨ `frameProtocol`**, so every current
  consumer keeps working.

**Runtime counterpart — one label-aware channel (in scope, required).**
The runtime gains a single expression-level computation
`effectsOf(expr) → EffectSet` implementing the projection rule above,
resolving symbol operands through their bound definitions (the
`isImpureHead` by-name pattern, `library/map-lowering.ts`). Both existing
consumers become views of it:

- `isPure` ≙ no impurity label in `effectsOf(expr)` — a boolean projection,
  no longer independently computed;
- the pending-draw walk keys on `random ∈ effectsOf(…)` (plus
  `frameProtocol`), **preserving its existing exception structure
  unchanged** — Hold content, lazy views in value position, and binder
  handling per `RANDOMNESS-MODEL.md` §2 and §6.

This closes hole 1 for *both* consumers (v2 fixed only the boolean).
Memoization: `effectsOf` results on `BoxedFunction` are cached with a
**generation guard** — validated against `ce._generation` exactly like the
two existing generation-checked memos in `boxed-function.ts` (~714, ~1242).
(`reset()` is currently an inert stub; it is *not* the invalidation
mechanism.)

### Subtyping

- **Covariant in the effect set**: `(real) -> real` <:
  `(real) ->{random} real` <: `(real) ->{any} real`.
- **Contravariant flip in argument position**: a function accepting an
  effectful callback is a subtype of one accepting only pure callbacks.

An annotated parameter (`g: (real) -> real`) *is* the requirement "callers
pass a pure function", checked at the call boundary as parameter types are
today — an `incompatible-type` error value, with the **same timing** as
existing argument validation, including its non-strict/lazy carve-outs
(deferred validation defers the effect check identically; no new timing).

**Requiring absence.** A bound is how an operator requires an argument
*not* to have an effect; three forms, by strictness:

1. Bare arrow — the empty bound: no effects at all. The common case.
2. A positive bound listing what *is* tolerated: `g: (real) ->{write}
   real` means "deterministic; mutation tolerated" — which is usually what
   a replay- or cache-sensitive consumer actually wants, since `entropy`
   is nondeterministic too and excluding only `random` rarely matches real
   intent.
3. The literal complement, by enumerating the other labels:
   `->{entropy, write}` means "anything except `random`" — expressible
   because the enumeration is closed, but *extensional*: it does not
   auto-extend when a future label is admitted (a `{host}` callback would
   be rejected until the author widens the bound — fail-closed, safe, but
   the written bound drifts from the intent at each label addition).

All three are ordinary contravariant subset checks; an `{any}` operand
fails every finite bound (an opaque function that won't state its effects
cannot prove absence — conservative, intended). Note the distinction from
**discharge**: a bound says "don't bring the effect"; a discharge says
"bring it, I contain it" (`WithRandomSeed`). Pick by whether the operator
has a containment mechanism.

**Complement form (designed, not admitted — syntax reserved).** The drift
in form 3 has a clean fix: a co-finite bound written `->{!random}` — "every
label, current and future, except those negated" — the closed-world analog
of the row-literature *lacks constraint*. It stays inside the sets-not-rows
boundary: bounds become finite sets, co-finite sets, or `any`, and every
subtype test remains a trivial stateless comparison (finite ⊆ co-finite(N)
iff the positives avoid N; co-finite(N₁) ⊆ co-finite(N₂) iff N₂ ⊆ N₁;
co-finite ⊄ any finite set, since it is version-open). Mixing positive and
negated labels in one set is a parse error; `{!}` is not a spelling of
`any`. Admission trigger: the first real consumer of an "all but X" bound —
until then the `!` is merely reserved in the grammar, and forms 1–3 cover
current needs.

**Overloads.** Per-application effects use the **resolved arm**, obtained
by invoking the same (write-free) resolver used for typing at
effect-computation time with identical admission policies — the selection
is *recomputed, not stored* (`overload.ts` returns it transiently and
`BoxedFunction` stores no arm). Definition-wide derived getters use the
**union of all arms' effects** — conservative for consumers without an
application. Arms distinguishable *only* by effect set are a definition
error. **Specificity**: effect sets are consulted only to break ties among
arms already equally specific by argument type; a subset is more specific;
**incomparable effect sets are not compared** and fall through to the
existing tie-break.

**Currying / partial application.** The residual signature carries the
**full remaining effect set** on its arrow. Runtime alignment (today
`makeLambda` *evaluates the body* with the supplied prefix before currying
— `function-utils.ts` ~1266 — so effects could fire at partial
application): Stage 2 gates that pre-evaluation on purity — a body whose
`effectsOf` is pure keeps today's evaluate-then-curry optimization; an
effectful body is **captured without evaluation** and fires exactly once,
at saturation. Tests must pin: zero effects at partial application, exactly
one at saturation, for `random` and `write`.

`matches()` needs the effect-aware signature rule and **must stay
write-free**; subset tests are stateless.

### One source of truth — and the flag migration

Effects live on the signature (plus the `frameProtocol` runtime field). For
the existing writable `pure` / `drawsRandom` fields (a public authoring
surface):

- **As authoring inputs the flags remain valid sugar**, translated once at
  registration. Normative truth table:

  | `pure` | `drawsRandom` | Translated effects |
  |---|---|---|
  | `true` / omitted | `false` / omitted | ∅ (bare arrow) |
  | `false` | `true` | `{random}` |
  | omitted | `true` | `{random}` |
  | `false` | `false` / omitted | **`{any}`** — unclassified legacy impurity. NOT `{write}`: the flag promises only "not pure" (an opaque host function may be entropy/IO; `RandomExpression` is the live counterexample). `{write}` is only ever assigned **explicitly** — via an effects-bearing signature or the new `effects:` authoring field — or by the audited Stage 1 list. |
  | `true` | `true` | **registration error** (contradiction) |

- A new explicit `effects:` authoring field (or an effect-annotated
  signature string) is the precise surface; if it and legacy flags are both
  given and disagree, **registration errors** — never silent precedence.
- **As readable state, the flags become derived getters**: `pure` ≙ no
  impurity label; `drawsRandom` ≙ `random ∈ effects ∨ frameProtocol` (with
  `any` reporting conservatively for both). Every existing consumer keeps
  working.
- `inferLambdaFlags` stops writing `this.pure`/`this.drawsRandom` and
  stamps the inferred effect set on the definition's signature; the getters
  make that transparent.

### Inference

- **One choke point.** The effect walk runs where a `Function` literal's
  signature type is constructed. Since literal construction currently
  reaches through at least six call sites (`engine-declarations.ts`,
  `library/calculus.ts`, `library/core.ts`, `library/collections.ts`,
  `boxed-expression/match-dispatch.ts`, `boxed-expression/simplify.ts`),
  Stage 2 **must route them through a single shared construction seam**
  that performs the walk, plus a guard test that fails if a construction
  site bypasses it — a missed site silently reintroduces the
  inline-callback gap.
- **Literals are inference boundaries.** A nested `Function` literal's
  effects go on **its own arrow** (its latent set); the enclosing body adds
  them only where the body *applies* (or projects) the literal. So
  `makeCallback() := (() ↦ Random())` is itself pure with result type
  `() ->{random} …`. This **amends Stage 0's shipped behavior** — the
  current `inferLambdaFlags` recurses into nested literal bodies
  (conservative) — and `user-function-purity.test.ts` updates accordingly.
- **Applied parameters** *(ruling (c))*: an **annotated** function
  parameter contributes its declared arrow effects to body inference and
  the boundary enforces the bound. An **unannotated** parameter (declared
  `unknown`, `function-utils.ts`) keeps the optimistic ruling: treated
  pure, no boundary check — deliberate residual optimism; soundness is
  opt-in via annotation. (Rejected: synthesizing a pure contract from
  usage — breaking; synthesizing `{any}` — forfeits the caching the
  optimistic ruling protects.)
- **Dependency order**: unchanged pending the open ruling (hole 3 above).
- **Definition-annotation check.** An explicit effect annotation on a
  defined function is a contract: accepted iff `inferred ⊆ declared`
  (over-declaring weakens, allowed). On violation the definition is **not
  installed** and the `Assign`/`Declare` yields an `incompatible-type`
  error value — same shape and channel as the call-boundary check.

## Sets, not rows

This design stops at effect **sets** — no effect *rows*, no effect
variables (Koka-style `map : (list<a>, a -> e b) -> e list<b>`, where the
variable `e` propagates the callback's effect by unification).

**Why rows exist elsewhere**: in separately-compiled languages a function
value is opaque at the use site; the type is the only channel for the
callback's effect. Effect variables are the price of opacity.

**Why CE does not need them**: projection-and-discharge covers both halves
of what rows buy, without variables —

- **Propagation**: a function-valued operand contributes its actual
  signature's latent effects, per call site. `Map(xs, pureF)` is pure;
  `Map(xs, randomF)` is `{random}`. No variable needed: the engine always
  holds the actual operand.
- **Handling**: a declared discharge set expresses "accepts, does not
  re-emit" (`WithRandomSeed` for `random`; an internally-awaiting host
  wrapper for a future `async`).

**What sets give up** — one corner: a *bodiless declared* HOF cannot say
"as effectful as my argument"; it picks a pole (require pure, or accept and
project `{any}`). Conservative, hence sound; the cost is caching pessimism
for opaque declared HOFs, a rare corner.

**What sets avoid**: effect variables in the lexer/parser/serializer;
unification state in `subtype.ts`/`matches()` (which must stay write-free);
row rewriting; annotation-language complexity hostile to Cortex's
LLM-friendliness goals. Discharge declarations are deliberately not a
`rethrows` — they subtract declared constants, never bind variables.

**The boundary, written down**: reopen rows only if (a) opaque declared
HOFs with genuine effect polymorphism become common (a host/plugin ABI in
bodiless contracts), or (b) library operators need effect-parametric
signatures that projection over actual operands cannot cover. Neither is
foreseeable.

## Future effect labels (speculative)

Admission test (all three must hold): (1) a **consumer must distinguish**
the label from the rest of impurity; (2) it is **inferable** or declarable
at an opaque boundary; (3) subset ordering stays meaningful. New labels
declare their metadata (impurity? frame-owing?) so derived views extend
without redefinition.

- **`host`** (I/O with the host environment): `#env()`/`#navigator()` —
  today parse-time pragmas gated by `allowHostPragmas` — and future
  `Print`/file/network surfaces. Consumer: the trust gate, generalized to
  an evaluation-time policy; compile targets fail closed. Metadata: impure,
  not frame-owing. Distinct from `entropy` (reading data vs consuming
  randomness); merge only if no consumer ever distinguishes them.
- **`async`** (application may suspend): fails criterion 1 today
  (asynchrony is engine-wide, `evaluateAsync`). Becomes real when an
  *operator* is inherently asynchronous; then sync entry points reject
  `{async}` statically, and an awaiting wrapper *discharges* it. Metadata:
  **not an impurity** — an async pure function's settled value caches
  soundly, which "pure ≙ no impurity label" accommodates.
- **`time`** (clock reads): unseeded nondeterminism — folds into
  **`entropy`** unless a virtual-clock mechanism (`WithClock`?) ever gives
  it its own consumer, the same way `random` earned its label.

Rejected as effects: **`diverge`/nontermination** (handled dynamically,
`TIMEOUT-MODEL.md`; not inferable; no consumer); **GPU/target
compilability** (a capability of an operator, not an effect of applying it);
and **`error`/partiality** — expanded below, because the reasoning is
load-bearing for planned Cortex ergonomics.

### Rejected: `error`/partiality — failure is a value, and narrowing needs it that way

1. **An effect describes what happens *while* computing; a failure is the
   result.** Effect systems track errors where errors travel a channel
   *separate* from return values — exceptions, i.e. non-local control flow
   (Koka's `exc`, Swift's `throws`, Java's checked exceptions annotate the
   bypass path). CE has no bypass channel: an `Error` expression flows
   through the ordinary compositional value path. `->{error}` would track a
   channel that does not exist.
2. **The type lattice already represents it — strictly better.** `error`
   and `nothing` are primitive types, and the lattice has unions and
   negations. `(string) -> real | error` is opt-in, position-precise, and
   distinguishes failure kinds (`real | nothing | error` separates
   "failed" from "absent"). An effect is one bit on the arrow: it cannot
   say which position, which kind, or participate in `match`.
3. **The admission test fails on every prong.** A may-fail function is
   still *pure* — same input, same `Error` value: deterministic, cacheable,
   safely re-evaluable. No consumer (caching, frame gate, compile
   fail-closed) distinguishes "may error" from "total"; compile targets
   handle `NaN`/error as data.
4. **The checked-exceptions failure mode.** In a CAS nearly every operator
   is partial somewhere (`Divide`, `Sqrt` over reals, out-of-range,
   non-convergence). An honest `{error}` label would infect essentially
   every arrow (carrying no information) or demand discharge ceremony at
   every call — the ergonomic collapse that made Java's checked exceptions
   the cautionary tale. Union return types stay local to the boundaries
   where partiality is part of the contract.

The forward-looking reason is the strongest: failure-handling ergonomics
are **narrowing** operations, and only the value representation narrows.
The planned Cortex refutable binding (`if let x = parse(s) { … } else
{ … }` — see the "Refutable binding" item in `roadmap/cortex/README.md`)
binds `x` at type `typeOf(scrutinee) & !error` via the existing
`NegationType`, and its `else` arm knows the scrutinee is `error` — all
expressible today because failure lives in the lattice. An effect bit has
nothing to narrow; representing errors as effects would foreclose exactly
these ergonomics. Corollary ruling: Rust/Swift-style `?` propagation is
declined — it requires early-return (non-local control flow), which
Cortex's expression-`Block` model deliberately lacks; deep chains are
`match`'s job.

## What does not change

- **`WithRandomSeed`'s pending-draw walk**: whether a partially-evaluated
  body still owes draws depends on *how far evaluation got* — a runtime
  fact no static annotation sees. The walk's inputs are upgraded (it keys
  on the label-aware `effectsOf` plus `frameProtocol`), but its exception
  structure — the Hold and value-position rulings of `RANDOMNESS-MODEL.md`
  **§2**, the lazy-materialization ruling of **§6** — stands untouched.
- **The conservative unknown-operator default** in runtime accounting
  (`?? false`) — correct where no contract exists.
- **Broadcast draw-once semantics** (`BROADCAST-MODEL.md`).
- **The estimator rulings of `derived-substreams.md`** §§2–7 — this
  document defers to them (see "Randomness shapes").

## Cortex surface

Effects ride the type literal:

```cortex
let f: (real) ->{random} real            // opaque declaration
integrate(f: (real) -> real, a, b) = …   // pure-callback bound, checked at call
function roll(n) ->{random} integer { Random(Range(1, n)) }  // checked vs body
```

Scoping of the "no new grammar" claim:

- The `let`/`const` **declaration** form and **parameter annotations** sit
  in existing full-type positions — effects genuinely ride along.
- The block-form **definition** return annotation needs real (small)
  grammar and encoding work. **Normative encoding (resolving v2's
  either/or): the full signature.** The parser builds the complete
  `FunctionSignature` — parameter types from the parameter list, arrow
  effects from the post-parameter-list `{effects}`, return type from the
  ascription — and the lowering carries that signature as the literal's
  declared type (the `Typed` ascription holds the full signature type, not
  a bare return type). `desugarSignatureString()` decomposition keeps
  working for parameters/return; arrow-level effects are **preserved onto
  the constructed signature**, not discarded. Existing bare `Typed(body,
  returnType)` ascriptions remain valid (return-type-only, pure arrow).
  Examples for anonymous literals, `Assign`, block-form definitions, and
  serialization belong in the Stage 3 test suite. `serialize-cortex.ts`
  updates in lockstep so definitions round-trip.

On a definition, an effect annotation is a contract per the
definition-annotation rule (installed iff `inferred ⊆ declared`,
`incompatible-type` error value otherwise) — unlike return types, which
remain retained-not-validated for now.

## Migration and sequencing

Each stage is useful without the next; per-stage pinning tests named.

- **Stage 0 — shipped (`503728ed`)**: assignment-time flag inference
  (`inferLambdaFlags`), pinned by
  `test/compute-engine/user-function-purity.test.ts`. Amended by Stage 2:
  nested-literal boundary semantics (above).
- **Stage 1 — representation**: effect sets in `src/common/type/`
  (lexer/parser/serializer/`subtype.ts`/`reduce.ts`), `BoxedType`,
  effect-aware `matches()`; `function`-primitive bound semantics; flag
  truth-table translation + derived getters + `frameProtocol` field
  split; annotate the current `drawsRandom` operators — authoritative list
  by grep (currently `Random`, `RandomChoice`, `RandomPrime`,
  `RandomSample`, `RandomShuffle`; `WithRandomSeed` becomes
  discharge + `frameProtocol`) — `RandomExpression` gets
  `() ->{entropy} expression`; `{write}` assigned only by the **audited
  list** (`Assign`, `Declare`, `Assume`, and whatever the audit of
  `pure: false` residuals confirms as engine-state writers — everything
  unaudited translates to `{any}`, never `{write}`). Tests:
  `test/common/type/effects.test.ts` (grammar round-trip incl. every
  malformed form; subtype partial order incl. pairwise-incomparable
  singletons), extension of `user-function-purity.test.ts` (getters,
  truth-table conflicts).
- **Stage 2 — contracts + runtime channel**: the shared literal-
  construction seam + guard test; literal-boundary inference;
  annotated-parameter contribution; call-boundary and definition-annotation
  checks; `effectsOf` runtime computation with generation-guarded memo;
  pending-draw walk re-keyed on it; discharge declarations (function
  parameters AND held positions); purity-gated currying pre-evaluation.
  Tests: `test/compute-engine/effects-contracts.test.ts` (inline /
  assigned / opaque `{random}` callbacks, direct and through another HOF;
  named-callback pending-draw case; discharge incl. `WithRandomSeed`
  `{write}`-passthrough; overload arms incl. incomparable-effects
  tie-break; partial-application effect timing).
- **Stage 3 — Cortex**: type-literal effects in the parser/serializer
  pair; the definition-form full-signature encoding. Tests:
  `test/cortex/effects.test.ts` (round-trip of all three surface
  positions).

**Blast-radius protocol** — two audits, per the standing snapshot policy:

- *Stage 1*: types print in errors and serialization — run the full suite,
  measure snapshot churn; bare-arrow-is-pure predicts near-zero; verify.
- *Stage 2*: new **hard errors** where behavior was silent. Enumerate every
  library operator whose parameter is a *function signature* (not the bare
  `function` primitive — which is effect-top and never rejects) and confirm
  no currently-passing impure-callback idiom breaks
  (`Map(xs, x ↦ Random())` keeps working: `Map`'s bound is the `function`
  primitive, effect-top by definition above).

## Open questions

- **Dependency-order refinement (awaiting ruling)**: adopt the split —
  unresolved *named head* infers `{any}` until it resolves (sound, loses
  caching for forward references), while applied unannotated *parameters*
  keep optimism? Or keep the current uniform optimism + escape hatch?
- Should `write` split local/global — a `Block`-scoped `Assign` that
  cannot escape is observationally pure from outside? No consumer
  distinguishes today; leave unified until one does. (Ready test case: the
  pending-draw gate + `Block`-scoped `Assign`.)
- Should discharge declarations get Cortex surface syntax, or remain
  definition-API-only (sufficient for builtins/hosts, the only foreseeable
  dischargers)? Lean: API-only until a user-level handler story exists.
- `host` vs `entropy`: kept distinct on the reading-data vs
  consuming-randomness axis; merge if, by the time `host` is admitted, no
  consumer distinguishes them.
