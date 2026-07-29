# Effects Model — Effects in the Type System

**Status**: DRAFT v2 (2026-07-28). Design proposal, not implemented. v2
incorporates the findings of the 2026-07-28 dual review
(`docs/scratch/EFFECTS-MODEL_SPEC_REVIEW.md`) and three ratified decisions:
**(a)** application effects come from *projection with declared discharge*,
**(b)** `RandomExpression` migrates onto the seeded stream, **(c)**
unannotated function parameters keep the optimistic ruling — *annotation gets
the contract*. Stage 0 (assignment-time flag inference, `inferLambdaFlags`)
shipped in `503728ed` (implementation + pinning tests, verified). Companion to `RANDOMNESS-MODEL.md`, which owns the runtime
semantics of the `random` effect (frames, replay, lazy materialization);
this document owns how effects are *represented and checked*.

## Purpose and scope

Represent computational effects — today, drawing from the random stream and
writing engine state — in **function signature types**, so that:

- an **opaque declaration** (`ce.declare('f', …)`, a host-provided function,
  a serialized contract crossing the Tycho boundary) can state its effects
  where the engine cannot infer them from a body;
- effect information is **compositional**: any function value — inline
  literal, named reference, or opaque declaration — reports its effects to
  an enclosing application through one channel, its signature;
- there is **one source of truth**: the `pure` / `drawsRandom` definition
  flags become derived views of the signature.

Out of scope, deliberately: general algebraic effects and handlers, effect
*rows* and effect variables (see "Sets, not rows"). The *runtime accounting*
mechanisms are refined in one specified way (operand projection, below) but
otherwise unchanged (see "What does not change").

## Current state

Effects live entirely outside the type system today, in three mechanisms:

| Mechanism | Where | Behavior |
|---|---|---|
| Definition flags | `pure`, `drawsRandom` (`types-definitions.ts`) | Per-operator declarations; `pure` defaults `true`, `drawsRandom` defaults `false` |
| Expression recursion | `BoxedFunction.isPure` (`boxed-expression/boxed-function.ts`) | Application pure iff operator flag pure **and** every operand pure; unknown operator ⇒ impure (`?? false`); bare symbols always pure |
| Assignment-time inference | `inferLambdaFlags` (`boxed-expression/boxed-operator-definition.ts`) | When `Assign`/`Declare` binds a `Function` literal, flags derive from the heads its body applies, unless the caller stated them |

Consumers: `isConstant` and derived caches; `Add`/`Multiply` keeping impure
operands evaluated under `.N()` (`library/arithmetic.ts`); the `Map`
lowering gate (`isImpureHead`, `library/map-lowering.ts`); GPU compile
failing closed on impure seeds/endpoints (`compilation/gpu-target.ts`); and
`WithRandomSeed`'s pending-draw gate (`hasPendingImpureApplication`,
`library/core.ts`), keyed on `drawsRandom` specifically — proof the effect
structure is already a multi-label lattice, not one purity bit (a surviving
`Assign` is impure but owes the stream nothing and must not pin a frame).

Three known holes in the current mechanisms, each addressed by a specific
section below:

1. **Named callbacks are invisible** — `Map(xs, f)` with `f` bound to an
   impure function reports pure, because bare symbols are always pure and
   the conjunction never resolves through the binding. (→ "Projection and
   discharge".)
2. **Optimistic inference is unchecked** — `inferLambdaFlags` rules an
   unknown head pure (deliberately: treating unknowns as impure would
   forfeit `isConstant`, the `Map` lowering fast path, and the type/sgn
   caches for most user functions). The assumption is not a contract; a
   caller violating it propagates a wrong flag silently. (→ "Inference",
   ruling (c): an *annotated* parameter turns the assumption into a checked
   boundary; unannotated code keeps the ruling as-is.)
3. **Dependency-order inference is unsound** — `f() := g()` defined before
   `g` sees no definition for `g` and stays pure even after an impure `g`
   lands; only *reassigning `f` itself* re-runs inference. Ruled: keep, with
   the declared-signature escape hatch (declare `g`'s signature first);
   dependency tracking with re-inference is not worth its cost today.

## Design: effect sets on signatures

### Labels and lattice

An **effect set** is a subset of a closed, engine-versioned enumeration of
labels. Each label carries fixed metadata; consumers read the metadata, not
the label name:

| Label | Meaning | Impurity? | Owes seed frame? |
|---|---|---|---|
| `random` | May consume draws from the engine's seeded random stream | yes | yes |
| `write` | May mutate engine state (`Assign`, `Declare`, `Assume`, …) | yes | no |

- **`pure` means "no impurity label present"** — NOT literally
  `effects = ∅`. With only `random`/`write` the two definitions coincide,
  but the metadata form is normative: a future label that is not an
  impurity (e.g. `async`, which concerns *when* a value arrives, not
  referential transparency) must not break caching by mere set-nonemptiness.
- The order is powerset inclusion — a **diamond**, not a chain:
  `∅ ⊆ {random}`, `∅ ⊆ {write}`, both `⊆ {random, write}`, and `{random}`
  and `{write}` are **incomparable**. Neither implies the other.
- A distinguished **top**, written `any`, means "unknown effects" — the
  honest declaration for an opaque symbol that won't enumerate. For **every**
  derived view and every consumer, `any` behaves as if every label (current
  and future) were present — conservative in all directions: an
  `{any}`-declared function is uncacheable *and* pessimistically pins seed
  frames. Under union `any` absorbs; under intersection with a concrete set
  it yields the concrete set.
- `write` is included as an *initial* label on the same admission test that
  future labels must pass (see below): its distinguishing consumer is the
  pending-draw gate itself, which must treat "impure and NOT frame-owing"
  (a surviving `Assign`) differently from `random`. It is the explicit name
  for what is today the implicit `pure: false ∧ ¬drawsRandom` residue.
- An **unknown label** encountered while parsing a type is a type error
  (fail closed). Consequence for version skew at the serialization boundary:
  an older engine receiving a newer engine's type string hard-errors rather
  than silently weakening the contract. This is the accepted trade; senders
  targeting older engines must not emit labels the receiver lacks. Adding a
  label is a visible minor-version event.

### Grammar and AST

`FunctionSignature` (`src/common/type/types.ts`) gains an optional effect
set, attached to the arrow:

```
<signature> ::= <arguments> " ->" [<effects>] " " <type>
<effects>   ::= "{" ( "any" | <label> ("," <label>)* ) "}"
<label>     ::= "random" | "write"          // closed, versioned enumeration
```

```
(real) -> real              // pure (no effect set ≡ empty set)
(real) ->{random} real      // may draw
() ->{write} nothing        // may mutate state
(real) ->{random, write} real
(real) ->{any} real         // opaque: unknown effects
```

Normalization rules (normative):

- `->{}` is a **parse error** — the pure case is written as a bare arrow,
  and only one spelling round-trips.
- A **duplicate label** is a parse error.
- `any` is **exclusive** — `{any, random}` is a parse error.
- Canonical serialization orders labels alphabetically; parsing accepts any
  order. Whitespace inside braces is insignificant.
- In the AST, "no effect set" and "empty effect set" are the **same state**
  (a single optional field, absent = pure); there is no distinct
  empty-but-present representation.

`!` (negation) and `&` (intersection) are already taken in the type grammar;
braces on the arrow are unambiguous and keep the pure case visually
unchanged. Because types travel as strings in MathJSON (`{"str": …}`),
effect annotations round-trip through serialization wherever a **full
signature** is carried. (Where current encodings carry only a fragment — the
Cortex definition form's return-type ascription — the encoding must be
upgraded; see "Cortex surface".)

### The default: bare `->` means pure

The load-bearing ruling, safe in CE for reasons that don't hold in most
languages:

1. **Bodies are transparent.** Every function *defined* in the engine has an
   inspectable body, so inference — not annotation — is the primary source
   of effect facts. Annotations speak at opaque boundaries.
2. **It matches the existing defaults.** Operator definitions already
   default `pure: true`; every signature string in the library and every
   overload table remains valid, unchanged.
3. **The residual trust is one already accepted.** Only an opaque host
   declaration can lie under this default — the same trust class as
   declaring a wrong return type.

The polarity asymmetry with the runtime layer is deliberate and stays:
**optimistic in declared contracts, conservative in runtime accounting**
(the expression-level `?? false` default for unknown operators is correct
where no contract exists).

### Projection and discharge — how applications get their effects

*(Ratified decision (a).)* The effect of an **application** is:

```
effects(op(a₁ … aₙ)) = ownEffects(op) ∪ ⋃ᵢ contribution(aᵢ)
```

where the **contribution** of an operand is:

- for a non-function operand: its own expression-level effects (today's
  conjunction, unchanged);
- for a **function-valued operand** — an inline `Function` literal, a symbol
  bound to a function definition, or an opaque declared function — its
  **signature's effect set**, *minus any effects the operator declares
  discharged for that parameter position*.

Two independent facts per function parameter, both expressed on the
operator's definition:

1. **The bound** — the parameter's declared signature effects
   (`g: (real) ->{async} real`), enforced contravariantly at the call
   boundary: callers may pass anything *up to* the bound.
2. **The discharge set** — effects of that parameter the operator absorbs
   rather than re-emits, declared on the definition (e.g.
   `discharges: { g: ['async'] }`). A host function that awaits its callback
   internally accepts `{async}` and discharges it; its own arrow stays
   non-async. Constraint: the discharge set must be a subset of the
   parameter's bound (discharging what you don't accept is a definition
   error). **Default: discharge nothing** — propagation is the sound
   default, and it is what gives `Map(xs, f)` per-call-site precision
   (`Map` with a pure `f` is pure; with a `{random}` `f`, `{random}`).

`WithRandomSeed` is the canonical discharge operator: `WithRandomSeed(seed,
body)` is referentially transparent — same seed, same result — even when
`body` draws. Its contract-level description is "accepts a `{random}` body
and discharges `random`". Its *runtime* role (frame management, the
pending-draw walk) is a separate mechanism and keeps its own flag semantics;
the current `drawsRandom: true` on `WithRandomSeed` conflates the two roles,
and the split above is the disentanglement.

**Runtime counterpart (in scope, required).** The expression-level `isPure`
conjunction is amended to match: a symbol operand bound to a function
definition contributes that definition's effects (resolution by name, the
same load-bearing pattern as `isImpureHead` in `library/map-lowering.ts`) —
closing the named-callback hole (`Map(xs, f)` with impure `f` currently
reports pure, verified). Two implementation constraints: the memoized
`_isPure` must be invalidated when a referenced definition is reassigned
(participate in the existing `reset()`/rebind machinery), and the simple
rule "any function-typed operand contributes" is acceptable — it overcounts
when a function is passed as inert data, which errs conservative (lost
caching, never a wrong answer).

### Subtyping

In `subtype.ts`, the signature rule extends in the standard way:

- **Covariant in the effect set**: `(real) -> real` <:
  `(real) ->{random} real` <: `(real) ->{any} real`. A pure function is
  usable anywhere an effectful one is accepted.
- **Contravariant flip in argument position**: a function *accepting* an
  effectful callback is a subtype of one accepting only pure callbacks.

The flip is what makes parameter effect **constraints** ordinary subtyping:
`g: (real) -> real` *is* the requirement "callers must pass a pure
function", checked at the call boundary exactly as parameter types are today
(an `incompatible-type` error value, not a throw), with the same timing as
existing argument validation — including its non-strict/lazy carve-outs: an
operator whose arguments are validated at canonicalization checks effects
there too; one whose validation is deferred defers the effect check
identically. Effects introduce no *new* validation timing.

**Overloads.** CE signatures can be intersections of arms (see
`docs/plans/2026-07-25-overload-resolution-design.md`). Two rules: a
**per-application** effect reading uses the *resolved arm*; the
**definition-wide** derived getters (below) use the **union (join) of all
arms' effect sets** — conservative for consumers that see only the
definition. Overload arms distinguishable *only* by effect set are a
definition error (they have identical applicability and could never be
selected apart). Effects otherwise participate in specificity as argument
subtyping does: fewer effects = more specific.

**Currying / partial application.** A partial application's resulting
signature carries the **full remaining effect set** on its arrow: effects
fire at saturated application, and until then the pending effects travel
with the remaining-parameters arrow. (`f: (a, b) ->{random} c` partially
applied to `a` yields `(b) ->{random} c`.)

`matches()` needs the effect-aware signature rule and **must stay
write-free**; effect sets compare by subset test — no unification, which is
one of the reasons for "sets, not rows".

### One source of truth — and the flag migration

Effects live on the signature. The migration for the existing writable
`pure` / `drawsRandom` fields (a documented, public authoring surface):

- **As authoring inputs, the flags remain valid sugar.** A definition may
  keep writing `pure: false`, `drawsRandom: true`; at registration they are
  translated **once** into the signature's effect set (`drawsRandom: true` →
  `random`; `pure: false` without `drawsRandom` → `write`). Library authors
  and hosts need not rewrite signature strings.
- **If both the flags and an effect-annotated signature are given and
  disagree, registration errors** — never silent precedence.
- **As readable state on a boxed definition, they become derived getters**:
  `pure` ≙ no impurity label present; `drawsRandom` ≙ `random ∈ effects`
  (with `any` reporting `true` for both impurity and frame-owing —
  conservative, per the `any` rule above). Every existing consumer keeps
  working unchanged.
- `inferLambdaFlags` stops writing `this.pure`/`this.drawsRandom` and stamps
  the inferred effect set on the definition's signature instead; the getters
  make that transparent to its current consumers.

### Inference

- **At `Function`-literal signature construction — wherever it happens.**
  The effect walk runs whenever a function literal's signature type is
  computed: inline in argument position, nested in a collection, returned,
  or bound by `Assign`/`Declare`. This closes the inline-callback gap
  (`integrate(x ↦ Random(), a, b)` must not get a bare pure arrow by
  omission). Assignment-time stamping (`inferLambdaFlags`) becomes a
  consumer of this one computation rather than a special case.
- **Applied parameters** *(ratified decision (c): annotation gets the
  contract)*. An **annotated** function parameter contributes its declared
  signature effects to body inference, and the call boundary enforces the
  bound — assumption upgraded to contract. An **unannotated** parameter is
  declared `unknown` (`function-utils.ts`) and keeps the optimistic Stage 0
  ruling: its application is treated pure by body inference, and no
  call-boundary check exists. This is a deliberate residual optimism —
  soundness is opt-in via annotation; the alternative defaults (synthesizing
  a pure contract from usage: breaking for existing impure-callback callers;
  synthesizing `{any}`: forfeits caching for every casual HOF, the very
  utility the optimistic ruling protects) were considered and rejected.
- **What inference does NOT do**: track definition dependencies. `f() :=
  g()` before `g` exists stays pure until `f` is reassigned (hole 3 above);
  redefining `f` re-runs inference, but defining `g` later does not reach
  back into `f`. The escape hatch is declaring `g`'s signature first.
- **Definition-annotation check.** An explicit effect annotation on a
  *defined* function (one with a body) is a contract: the definition is
  accepted iff `inferred ⊆ declared` (over-declaring is allowed — it
  weakens; under-declaring is the lie). On violation the definition is
  **not installed** and the `Assign`/`Declare` yields an
  `incompatible-type` error value — same shape and channel as the
  call-boundary check, replacing v1's undefined "diagnostic".

## Sets, not rows

This design stops at effect **sets**: a signature carries a concrete subset
of the label enumeration (or `any`). It deliberately excludes effect
**rows** — the Koka/Eff/Links-style discipline where effect annotations
contain *variables*, so a higher-order function is effect-*polymorphic* in
its type:

```
// Koka-style — NOT this design
map : (list<a>, a -> e b) -> e list<b>
```

`e` is an effect variable: `map`'s effect *is its callback's effect*,
propagated by unification.

**Why rows exist elsewhere.** In separately-compiled languages a function
value is opaque at the use site — `map` cannot look inside the closure it
receives, so the type is the only channel through which the callback's
effect can flow. Effect variables are the price of opacity.

**Why CE does not need them.** The projection-and-discharge rule covers both
halves of what rows buy, without variables:

- **Propagation** (rows' main job): a function-valued operand contributes
  its signature effects to the application — per call site, using the
  *actual* operand's signature. `Map(xs, pureF)` is pure;
  `Map(xs, randomF)` is `{random}`. No variable needed, because the engine
  always holds the actual operand: inline literals and named references get
  their signatures from inference, opaque declarations from annotation.
- **Handling** (rows' dual): a declared discharge set expresses "accepts the
  effect, does not re-emit it" (`WithRandomSeed` for `random`, an
  internally-awaiting host function for a future `async`).

**What sets still give up** — one corner: a *bodiless declared*
higher-order function cannot express "as effectful as my argument"
(`let g: ((real) ->{any} real) -> ??? real` must pick a pole: require a pure
callback, or take `{any}` operands and, absent a discharge declaration,
project `{any}`). The fallback is conservative, hence sound; the cost is
pessimism about caching for opaque declared HOFs — a rare corner.

**What sets avoid.** Effect variables in the lexer/parser/serializer;
unification state inside `subtype.ts` and `matches()` (which must remain
write-free — subset tests are stateless, unification is not); row rewriting
in `reduce.ts`; and an annotation language hostile to the LLM-friendliness
goals of Cortex. Swift's `rethrows` is the cautionary middle path — a
special-cased one-variable row that had to be replaced anyway; discharge
declarations are deliberately *not* that (they subtract declared constants,
never bind variables).

**The boundary, written down** so a future revisit is a decision, not an
accident: reopen rows only if (a) opaque declared higher-order functions
with genuine effect polymorphism become common (a host/plugin ABI
trafficking in bodiless function contracts), or (b) standard-library
operators need effect-parametric *signatures* that projection over actual
operands cannot cover. Neither is foreseeable.

## Future effect labels (speculative)

The `drawsRandom` lesson is the admission test. A label earns existence only
when **all three** hold:

1. **A consumer must distinguish it** from the rest of impurity (as the
   pending-draw gate distinguishes `random` from `write`).
2. **It is inferable** from definitions, or declarable at an opaque
   boundary.
3. **Subset ordering stays meaningful** — "may do X" weakens to a superset
   without changing meaning.

New labels also declare their metadata (impurity? frame-owing?) so the
derived views extend without redefinition.

Candidates, in rough order of likelihood:

- **`host`** (I/O with the host environment): `#env()` / `#navigator()` —
  today parse-time pragmas gated by `allowHostPragmas` — and any future
  `Print`/file/network capability in the Cortex CLI/MCP surface. The
  consumer half-exists: the trust gate, generalized from a parse-time switch
  to an evaluation-time policy ("this engine refuses `{host}`
  applications"); compile targets fail closed on it. Metadata: impure, not
  frame-owing. Likely the first addition.
- **`async`** (application may suspend): today asynchrony is engine-wide
  (`evaluateAsync`), not per-operator, so criterion 1 fails. It becomes real
  the day an operator is inherently asynchronous (a host call, a remote
  solver): synchronous entry points could statically reject `{async}`
  expressions, compile targets refuse them, and an awaiting wrapper
  *discharges* it. Metadata: **not an impurity** — an async pure function's
  settled value caches soundly, which the "no impurity label" definition of
  `pure` accommodates and the literal-∅ definition would not. That
  orthogonality is exactly why the one-bit `pure` flag could never absorb
  it.
- **`time`** (reading the clock): nondeterministic like `random` but not
  replayable — no frame, no counter. Fold into `host` unless a virtual-clock
  mechanism (`WithClock`?) ever gives it its own consumer, the same way
  `random` earned its label.

Considered and **rejected as effects**:

- **`error` / partiality** — errors are *values* in CE (`Error`
  expressions, `NaN`), fully expressible in return types; a
  checked-exception-style effect taxes every annotation for a distinction no
  consumer reads.
- **`diverge` / nontermination** — handled dynamically by time budgets
  (`TIMEOUT-MODEL.md`); not meaningfully inferable; no consumer.
- **GPU/target compilability** — a *capability* of an operator, not an
  effect of applying it; stays in the per-operator compile handlers.

## `RandomExpression` — ruled: migrate onto the seeded stream

*(Ratified decision (b).)* `RandomExpression` (`library/core.ts`) is today
`pure: false` and deliberately **not** `drawsRandom` — it samples
`Math.random()` directly and owes no `WithRandomSeed` frame. That shape has
no honest home in the label set (`∅` wrongly caches it; `{random}` would
wrongly pin frames *while it bypasses them*; `{write}` is a lie; `{any}`
discards precision).

Ruling: change `randomExpression()` to draw from the engine's seeded PCG3D
stream. The operator becomes an honest `{random}`; frame-pinning becomes
*correct* rather than wrong; and `WithRandomSeed(seed, RandomExpression())`
becomes reproducible — a feature for its fuzzing/test-corpus use, and a
CHANGELOG-worthy behavior change. Before Stage 1 lands, **audit every raw
`Math.random()` call site in the evaluation path** for the same shape (known
remaining escapes beyond `RandomExpression`: the Monte-Carlo integration
fallback and stochastic-equality probes) — each either migrates to the
stream or is explicitly ruled internal (not surfaced through any operator's
effect contract).

## What does not change

- **`WithRandomSeed`'s pending-draw walk** (`hasPendingImpureApplication`):
  whether a partially-evaluated body still owes draws depends on *how far
  evaluation got* — a runtime fact no static annotation sees. Types feed the
  walk (via the derived `drawsRandom` view, now also through projected
  operands); they cannot replace it. The Hold and value-position rulings of
  `RANDOMNESS-MODEL.md` §2/§5, and the lazy-materialization ruling of §6,
  stand untouched.
- **The conservative unknown-operator default** in the expression recursion
  (`?? false`) — correct where no contract exists. (The recursion itself
  *is* amended in one specified way: operand projection, above.)
- **Broadcast draw-once semantics** (`BROADCAST-MODEL.md`): a broadcast
  operand is evaluated once regardless of its effect set.

## Cortex surface

Effects ride the type literal — no new *declaration* or *parameter* syntax:

```cortex
let f: (real) ->{random} real            // opaque declaration
integrate(f: (real) -> real, a, b) = …   // pure-callback bound, checked at call
function roll(n) ->{random} integer { Random(Range(1, n)) }  // checked vs body
```

Honest scoping of the "no new grammar" claim (v1 overclaimed):

- The `let`/`const` **declaration** form and **parameter annotations** sit
  in existing full-type positions — effects genuinely ride along.
- The block-form **definition** return annotation (`function f(...) ->
  Type`) is today a bare return-type ascription: `src/cortex/parser.ts`
  encodes it as `["Typed", body, returnType]`, which cannot carry an effect
  set or a full signature. Stage 3 therefore includes real (small) grammar
  and encoding work: the post-parameter-list position parses an optional
  `{effects}` after the arrow, and the lowering carries the **full
  signature** (or an effects-bearing ascription), not a bare return type —
  with `serialize-cortex.ts` updated in lockstep so definitions round-trip.

On a definition, an effect annotation is a contract checked against the
body's inferred set per the definition-annotation rule above (installed iff
`inferred ⊆ declared`, `incompatible-type` error value otherwise) — unlike
return types, which remain retained-not-validated for now.

## Migration and sequencing

Each stage is useful without the next. Per-stage pinning tests are named —
the contract-per-test convention of `RANDOMNESS-MODEL.md`.

- **Stage 0 — shipped (`503728ed`)**: assignment-time flag inference
  (`inferLambdaFlags`), pinned by
  `test/compute-engine/user-function-purity.test.ts` (both verified present
  in that commit).
- **Stage 1 — representation**: effect sets in
  `src/common/type/` (lexer/parser/serializer/`subtype.ts`/`reduce.ts`),
  `BoxedType`, effect-aware `matches()`; flags become
  registration-translated inputs + derived getters (see migration rules);
  `RandomExpression` stream migration + `Math.random()` audit; annotate the
  current `drawsRandom` operators — authoritative list by grep, currently
  `Random`, `RandomChoice`, `RandomPrime`, `RandomSample`, `RandomShuffle`,
  `WithRandomSeed` — and the write ops, enumerated by the audit procedure
  *"every operator with `pure: false` not in the `drawsRandom` set"* (do not
  trust any inline list, including this one, over the grep). Tests:
  `test/common/type/effects.test.ts` (grammar round-trip incl. every
  malformed form; subtype diamond incl. incomparability), extension of
  `user-function-purity.test.ts` (derived getters, flag-translation
  conflicts).
- **Stage 2 — contracts**: effect walk at literal-signature construction
  (all positions); annotated-parameter contribution to body inference;
  call-boundary and definition-annotation checks; runtime operand
  projection + discharge declarations, including the `_isPure`
  memo-invalidation hook. Tests: `test/compute-engine/effects-contracts.test.ts`
  (inline / assigned / opaque `{random}` callbacks, passed directly and
  through another HOF; discharge; overload arms; partial application).
- **Stage 3 — Cortex**: type-literal effects in the Cortex
  parser/serializer pair, plus the definition-form signature encoding.
  Tests: `test/cortex/effects.test.ts` (parse/serialize round-trip of all
  three surface positions).

**Blast-radius protocol** — two distinct audits, per the standing snapshot
policy:

- *Stage 1*: types print in error messages and serialization — run the full
  suite, measure snapshot churn. Bare-arrow-is-pure predicts near-zero;
  verify rather than assume.
- *Stage 2*: this stage introduces new **hard errors** where behavior was
  previously silent. Before landing, enumerate every library operator whose
  parameter is typed as a *function signature* (as opposed to the bare
  `function` primitive) — only those acquire the new contravariant effect
  check — and confirm no currently-passing impure-callback idiom breaks
  (`Map(xs, x ↦ Random())` must keep working: `Map`'s callback bound is
  effect-top, not pure).

## Open questions

- Should `write` split local/global — a `Block`-scoped `Assign` whose
  binding cannot escape the block is observationally pure from outside?
  No consumer distinguishes today; leave unified until one does. (A ready
  test case exists: the pending-draw gate + `Block`-scoped `Assign`.)
- Should discharge declarations get Cortex surface syntax, or remain
  definition-API-only (sufficient for builtins and host functions, which
  are the only foreseeable dischargers)? Current lean: API-only until a
  user-level handler story exists.
- Dependency-order inference (hole 3): is the declared-signature escape
  hatch sufficient permanently, or should callee-definition events
  eventually trigger dependent re-inference? Ruled "keep" for now; revisit
  if inference staleness shows up in practice.
