# Effects Model — Effects in the Type System

**Status**: DRAFT v5 (2026-07-31). Stages 0–2 implemented; Stages 3–4
remain proposal (see "Migration and sequencing").
v6 (2026-08-08) adds **no rulings and no roster change** — only one
recorded disposition: **`mutable`** is examined and deferred (it collides
with `scope` on all four metadata axes; the want it expresses is
per-argument and belongs in type position, not on the arrow; admissible
only if a confined-mutation `region` frame kind ever ships). See "Label
admission".
2026-08-14: the roster gains **`state`** (a minor-version event per
"Labels and lattice") — the v6 `mutable` deferral is **resolved** by it;
the distinguishing consumers arrived with mutable objects
(`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B). Inert until the object
phases emit it; see the resolution paragraph under "Label admission".
Same day, two **recorded dispositions** (no rulings, no roster or
grammar change): the **echo marker** — the sanctioned shape should the
reopen boundary of "Sets, not rows" ever be crossed — and **resource
frames** — lifetime management via delimited lifecycle frames, with the
settlement-vs-revocation fork for escaped lazy values named as the
decision to rule first (see "Resource frames") — plus one
**exploration** (weaker still): user-declared effect labels as
taxonomy-plus-bounds marker effects (see "Label admission").
A follow-up round the same day unified both threads into **Appendix A**
(the `with` frame + `effect` declaration) with three rulings: the
declaration fuses type/label/lifecycle registration; no `init`
(acquisition = evaluation); escape = static diagnostics + dynamic
revocation (settlement not chosen). A round-4 dual spec review of the
additions was folded the same day: resource lifecycle is a **separate dimension, not a
`frameProtocol` kind**, and handles ride a per-evaluation frame stack,
NOT the `ce.effects` snapshot (mechanism recorded as a lean pending
ratification); the round-4 review also respecified the label-emission rule
(intrinsic-to-the-consumer, ordinary projection); `finish`'s own
effects joined the `with` projection rule; resource types are
object-backed by definition; `with` is an expression, adding a third
static escape case.
A ruling round 2026-08-15 ratified the R4 leans: the tracking
mechanism is **scope-attached finalization** (the `with` scope's
evaluation context runs an optional `finish` handler at removal — no
new stack; the eval-context stack IS the frame stack); namespacing is
**builtin-wins**; `with`-as-expression and unconditional `finish`
effects stand; the declaration keyword is **`resource`** (protocol
stays `Resource`; `effect` reserved for a possible marker-label
route); object backing applies to the **handle wrapper**, the payload
`T` is unconstrained. The ambient-form declaration mechanism was
**reopened** the same day and **ruled 2026-08-17**: the
declared-ambient-symbol desugaring — `with random(seed)` ≡ the named
form over the delimiter-declared symbol, spelling by per-declarer
convention (`__ambient_<label>`, shadowing = deliberate
interposition). The discharge-surface open question is closed
(declaration-site only, never use sites).
v5 folds in the 16-finding round-3 dual review; every ruling was validated.
Headline v5 rulings, each specified in its section:
the seed frame has **three participation modes** (draws / delimits /
reads — `readsRandomFrame` survives as the third); the `random` kernel is
**index-addressed** (`draw(seed, n)`, compile fails closed on non-default
kernels); confinement is **inference-only** (runtime accounting stays
conservative); `any` **never pins frames**; per-position **`invokes`**
metadata; quote positions are **inert**; discharge from `any` yields an
**internal co-finite** result; the **dependency-order ruling is made**
(unresolved named head → `{any}`; explicit annotation → trusted);
**`effectsDeclared`** provenance; `ce.effects` is **snapshot-scoped** with
**`null` = denial**; `environment` pragmas stay parse-time.
v3 incorporated the round-2 review. Ratified decisions:
**(a)** application effects come from *projection with declared discharge*
(v3 respecifies the mechanism per review findings 2–4);
**(b′ — supersedes v2's (b))** `RandomExpression` keeps raw `Math.random()`
and is represented by the new `entropy` label — the v2 ruling to migrate it
onto the seeded stream is **withdrawn**, deferring to
`docs/RANDOMNESS-MODEL.md` §7 (see "Randomness shapes");
**(c)** unannotated function parameters keep the optimistic ruling —
*annotation gets the contract*.

v4 (2026-07-31) adds the capability round:
**(d)** the state label is renamed `write` → `scope` and narrowed to
*escaping* writes — mutation of a scope that outlives the application —
resolving v3's local/global open question by confinement inference (see
"Scope writes");
**(e)** six host-capability labels are admitted — `network`, `fs_read`,
`fs_write`, `time`, `environment`, `console` — their admission-test
consumer being the new `ce.effects` capability registry (see "Host
capabilities"); the speculative `host` label is superseded by this split
and `time` no longer folds into `entropy`;
**(f)** `assert` is examined and **rejected** as a label;
**(g)** syntax **ruled**: the Swift-style specifier slot — bare labels
between the argument list and the arrow, `(int) random -> int` — is
adopted; the v3 arrow-attached brace form `->{random}` is superseded
(see "Grammar and AST");
**(h)** the frame axis is generalized — `frameProtocol` names a **frame
kind** (sole kind today: `seed`; `clock` anticipated) — and `random` is
ruled **handler-backed** at the kernel boundary
(`ce.effects.random`), revising the earlier internal-only note (see
"Label kinds" and "Host capabilities").

Stage 0 (assignment-time flag inference,
`inferLambdaFlags`) shipped in `503728ed` (implementation + pinning tests,
verified). Companions: `RANDOMNESS-MODEL.md` (frames, replay, lazy
materialization) and `docs/RANDOMNESS-MODEL.md` (the
estimator sub-stream design this document defers to for Monte-Carlo
integration, `stochasticEqual`, and `RandomExpression`).

## Purpose and scope

Represent computational effects — randomness, unseeded entropy, scope
writes, and host-capability access (network, filesystem, clock,
environment, console) — in **function signature types**, so that:

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
| Definition flags | `pure`, `drawsRandom`, `readsRandomFrame` (`types-definitions.ts`) | Per-operator declarations; `pure` defaults `true`, the other two default `false`. `readsRandomFrame` (set by `Integrate`/`NIntegrate`, `library/calculus.ts`) marks frame-*reading* without drawing — the derived-sub-stream shape — and is consulted by the pending-draw walk with equal weight (`library/core.ts` ~172) |
| Expression recursion | `BoxedFunction.isPure` (`boxed-expression/boxed-function.ts`) | Application pure iff operator flag pure **and** every operand pure; unknown operator ⇒ impure (`?? false`); bare symbols always pure |
| Assignment-time inference | `inferLambdaFlags` (`boxed-expression/boxed-operator-definition.ts`, `503728ed`) | When `Assign`/`Declare` binds a `Function` literal, flags derive from the heads its body applies, unless the caller stated them |

Consumers: `isConstant` and derived caches; `Add`/`Multiply` keeping impure
operands evaluated under `.N()` (`library/arithmetic.ts`); the `Map`
lowering gate (`isImpureHead`, `library/map-broadcast-shape.ts` — note
the stale comment at `boxed-operator-definition.ts` ~616 citing
`map-lowering.ts`; fix in passing during Stage 1); GPU compile
failing closed on impure seeds/endpoints (`compilation/gpu-target.ts`); and
`WithRandomSeed`'s pending-draw gate (`hasPendingImpureApplication`,
`library/core.ts`).

Three known holes, each addressed below:

1. **Named callbacks are invisible** — `Map(f, xs)` with `f` bound to an
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
   `f` itself re-runs inference. **Ruled in v5** (see "Inference"): an
   *unresolved named head* infers `{any}` (sound; loses caching for
   forward references), while *applied unannotated parameters* keep
   optimism; an **explicit** annotation on a definition whose inference
   saw an unresolved head is installed as a *trusted* contract (same
   trust class as an opaque declaration), enabling mutual recursion with
   stated effects.

## Randomness shapes — three shapes, two labels

The doc set contains **three** distinct randomness shapes (the third
surfaced by `derived-substreams.md`, which is authoritative for the
estimator and fuzzer rulings). Only **two** of them carry a label — a
frame-stream operator carries `random`, unseeded entropy carries
`entropy`, and a derived sub-stream carries **no label at all** (it is
pure, by the noise-floor convention below):

| Shape | Label | Ambient frame draws? | Reproducible under a frame? | Example |
|---|---|---|---|---|
| Frame stream | `random` | yes — owes draws, replays | yes | `Random`, `RandomChoice`, `RandomPrime`, `RandomSample`, `RandomShuffle` |
| Derived sub-stream | — none (pure; noise-floor convention) — but carries the `readsRandomFrame` definition field (below) | no — frame-independent indices | yes | Monte-Carlo `Integrate` fallback, `stochasticEqual` (per `derived-substreams.md` §§2–6) |
| Unseeded entropy | `entropy` | no | no — nothing promises replay | `RandomExpression` (fuzzer harness, `derived-substreams.md` §7) |

A fourth fact about the frame stream is not a shape but a **boundary**: a
frame contains only the draws made during its dynamic extent. A lazy view
whose element work draws — `Map(x ↦ Random(), xs)`, a `Comprehension` body
— is a *completed value* that leaves the frame and draws at materialization
(`RANDOMNESS-MODEL.md` §6). The `random` label therefore survives
`WithRandomSeed` for such a body: see the frame-escape bullet under
"Projection and discharge" (direction A, ruled 2026-08-02, Tycho item 142).

Rulings adopted from `derived-substreams.md` (cross-referenced there):

- **`RandomExpression` keeps raw `Math.random()`** and gets the `entropy`
  label below. v2's migration ruling is withdrawn: a fuzzer owes the frame
  nothing, nothing promises it replays, and frame draws from a fuzzer would
  shift the replay indices of surrounding seeded code.
- **The sub-stream estimators are not effects — but they are frame
  participants** *(v5, review R3 finding 1)*. The seed frame has **three
  participation modes**: *draws* (the `random` label), *delimits* (the
  `frameProtocol: 'seed'` field, `WithRandomSeed`), and *reads without
  drawing* (the existing `readsRandomFrame: true` definition field, set
  by `Integrate`/`NIntegrate` — an **incomplete** estimator, e.g.
  `NIntegrate(f, 0, n)` with `n` unbound, must keep the frame alive even
  though it consumes no indices, per `derived-substreams.md` §6). The
  reading mode stays a **field, not a label**: estimators sit at
  (frame-participating: yes, impure: no), and the noise-floor convention
  deliberately keeps them contract-invisible. `inferLambdaFlags` already
  infers and propagates `readsRandomFrame` through user functions and
  continues to; the field is boolean today and becomes kind-valued if a
  second frame kind ever needs a reader mode.
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

## Scope writes — the `scope` label

*(v4 decision (d): renamed from v3's `write`. The filesystem labels made
the old name ambiguous — `write` vs `fs_write` — and the new name says
what it tracks: the ambient scope chain.)*

The label means: **may mutate a scope that outlives the application** —
`Assign`, `Declare`, `Assume` targeting a binding not declared within the
evaluated body itself.

**What it is not — binding structure.** An operator that *creates* a scope
to bind an index (`Sum`, `D`, `Integrate`) has binder structure, declared
by the `scoped:` definition flag with binding-site selectors (the binder
mechanism). That is statically known and observationally pure —
`Sum(i, 1, 10, i^2)` is a pure function of its operands, cacheable and
replayable — and no consumer distinguishes "creates an internal scope"
from "doesn't", so it fails the admission test. `Add` and `Sum` differ in
binding structure, not in effects; the `scoped:` flag and the `scope`
label are disjoint mechanisms.

**Confinement (resolves v3's local/global open question).** v3 left open
whether the state label should split local/global. v4 resolves it without
a second label: **inference does not emit `scope` for confined writes.** A
body whose writes provably target bindings the literal itself declares
infers pure — such a body is deterministic and observationally pure from
outside, so no consumer distinguishes it from pure and the label would
carry no information. Only *escaping* writes emit `scope`.

**The confinement rule is a dominance condition** *(v5, review R3
finding 6 — a bare containment check is not enough)*: an `Assign` is
confined iff **every static path from the literal's entry to the
`Assign` passes through a `Declare` of that symbol within the literal**,
**and** the symbol is not referenced by any nested `Function` literal
(closure capture ⇒ escaping — the closure may outlive the declaring
application). `Assume` is **never** confined. Destructuring and compound
targets are judged per target symbol; a `Field` target
(`Assign(Field(p, "name"), v)` — the property rebinding sugar
`p.name = v`) is judged on its **base symbol** *(amendment 2026-08-15:
the property SET on a tuple-backed nominal type returns a new value
that rebinds the base, so a dominated local base is as confined as
assigning the base itself; `Field` ONLY — a `Subscript` target is a
sequence definition, `L_0 := 1` registering a base case in engine-wide
pending-sequence state that outlives any application, an `At` target
has no assignment semantics at all today, and a future heap-semantics
object store must NOT ride this clause, per "Confinement does not apply
to `state`" below)*; any target the analysis cannot resolve ⇒ `scope`.
The explicit fallback, stated normatively: **not provably confined ⇒
`scope`.** Consequences:

- An opaque declaration cannot prove confinement, so it declares `scope`
  conservatively — consistent with annotation-gets-the-contract.
- The rule is written against `Assign`'s write-through semantics: an
  `Assign` to a symbol with an existing outer binding mutates that outer
  binding (pushing and popping a scope does not undo it) — hence the
  dominance requirement on the `Declare`, not mere lexical containment:
  `Block(If(flag, Declare(n, 0)), Assign(n, 5))` is **not** confined
  (on the `flag`-false path the `Assign` writes through).
- **Parameters seed the dominance frontier** *(amendment, 2026-08-15)*: a
  parameter is bound on every static path at the literal's entry, and a
  write to it is call-local — the binding lives in the call frame and dies
  with the application; the caller's variable never changes (verified
  empirically: with `f(x) := (x := x + 1; x)` and `a := 5`, `f(a)` is `6`
  and `a` stays `5`). So `f(x) := (x := x + 1; x)` infers **pure**. The
  closure-capture exclusion still applies: a parameter referenced by a
  nested literal is not confined, the same conservative rule as any
  captured binding.
- **No implicit-local exemption for `Assign`** *(tried and reverted,
  2026-08-15)*: treating an `Assign` to a name with no visible outer
  binding as confined (evaluation does create a call-local binding —
  probed) is unsound for a literal walked standalone: a closure writing a
  variable of its ENCLOSING literal (`makeCounter`'s
  `count := count + 1`) presents the same "no visible binding" as a
  genuine fresh temp, because an enclosing literal's lexical locals are
  not in the definition registry — and the closure's arrow then claimed
  pure while every call returned a different value. "Not provably
  confined ⇒ `scope`" stands; a fresh-temp body opts out with a `Declare`
  (`let`) or a `scope` annotation.
- **A nested `DefineFunction` is confined only through a local
  declaration** *(amendment, 2026-08-15)*: Epsil's one-step inner
  definition (`helper(x) = x + a` inside a body) lowers to
  `DefineFunction`. With a `let`-declared local name
  (`let sq; sq(m) = m * m`) it assigns that local, which dies with the
  call — confined, and the defining write is the initialization, so
  capture by the helper's own recursive body does not un-confine it.
  WITHOUT a local declaration it installs into the **global registry**
  (probed: the helper is callable at top level after the enclosing call
  returns, and overwrites an outer function of the same name) — an
  escaping write, so an enclosing bare definition using the bare
  one-step form is refused by the ceiling. (Judging it by a visibility
  lookup instead would also make the verdict flip when the
  provisional-dependents cascade re-walks the body after the runtime
  install has made the name globally visible.)

**Confinement does not apply to `state` — v1.** The confinement
analysis above is written entirely in terms of *bindings* (a `Declare`
dominating an `Assign` inside one literal); an object is *heap* state
reachable through any alias, and proving a store confined would take
escape analysis the engine does not have. So in v1 every object store
and every object construction emits `state` unconditionally — there is
no `state` analog of the confined-write exemption. (Amendment required
by `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Changes to shipped
documents" item 6.)

**Confinement is inference-only; runtime accounting stays conservative**
*(v5, finding 3)*. The runtime `effectsOf` walk contributes `{scope}`
for **every** writer application (`Assign`/`Declare`/`Assume`), with no
binding analysis — the projection formula's `ownEffects(op)` is a
constant, and it stays one. This is sound by direction: the runtime
channel may *over*-approximate what inference proved, never under- —
the polarity this document already commits to ("optimistic in declared
contracts, conservative in runtime accounting"). Concretely: a bare
`Block(Declare(n, 0), Assign(n, n+1), n)` reports `{scope}` from
`effectsOf`; the *same body as a function literal* infers a pure
signature, and every application of that function projects through the
pure arrow — so nothing downstream of a definition is pessimized. The
divergence is visible only on un-abstracted expressions, where
conservatism costs a cache, not correctness.

**Scope is opt-in — the default-`!scope` ceiling (ruled 2026-08-15).**
A **named definition with no effect annotation guarantees it does not
mutate the world**: installing a body with a *proven* escaping write is
refused unless the definition declares the `scope` effect (a `scope`
specifier, an `effects:` flag, or an `any` contract). This partially
reverses the bare-specifier fork ruling of 2026-08-01 for this one label —
every other label stays on the freely re-stamping inferred track;
escaping writes alone are a contract that must be chosen, because a write
to an outer binding is always a deliberate design decision by the author.
The pre-ruling census found 49 escaping writes in 18 of 493 test suites and
zero in the real-program corpus. Mechanics:

- **The trigger is the walk's proven-mutation bit** (`escapingWrite` on
  `InferredLiteralEffects`), set by an unconfined `Assign`, by `Assume`,
  and by applying a resolved callee or annotated callback parameter whose
  effect set *concretely* contains `scope`. It is **never** set by `{any}`
  conservatism: an unresolved forward-referenced head stays optimistic
  (the v5 dependency-order ruling), so forward references and mutual
  recursion install bare exactly as before. The bit also survives the
  `any` collapse, so a body that both writes and calls an unresolved head
  is still refused.
- **The gate sits at the operator-definition construction seam** (the
  single point where `inferFunctionLiteralEffects` stamps a definition).
  The violation is an `EffectContractError` with a dedicated rendering
  that names the fix; the `Assign`/`Declare` operator routes convert it to
  the `incompatible-type` error value, like every other contract
  violation.
- **Anonymous literals are not gated.** They have no annotation surface
  (the lambda specifier slot is deferred), and they are never installed
  through the seam; their arrows carry the inferred `scope` honestly, so
  every consumer that reads arrows still sees the truth. Consequence: a
  factory returning a writing closure (`makeCounter() { let c = 0;
  () ↦ { c := c + 1; c } }`) installs bare — producing a literal is pure;
  the `scope` lives on the *inner* arrow.
- **Declare-then-assign is gated too** *(closed by ruling, 2026-08-15,
  same day)*: `ce.declare(f, '(number) -> number')` — either spelling —
  followed by `ce.assign(f, writerLiteral)` runs the same refusal, via
  the `scopeDefault` branch of `assertDeclaredEffects`
  (`engine-declarations.ts`) on the two assignment-reconciliation
  callers. This supersedes the 2026-08-01 bare-specifier arc for the
  `scope` label on this route: a bare declared arrow still re-stamps
  freely for every other label (the arc's tests are retold with
  `random`), but an escaping writer is refused. **Known residual**: the
  declare-WITH-value route (`ce.declare(f, { type, value: literal })`)
  stays ungated — it shares its code path with block-local `let`
  bindings, whose writer closures must remain installable, and no
  global-vs-local discriminator exists at that seam. Tracked in
  `ROADMAP.md`.

**Reads of non-local scope are not an effect.** Every expression with a
free symbol reads the ambient scope; a label would infect essentially
every arrow while carrying no information (the checked-exceptions failure
mode, per the `error` rejection). The consumers that care — memo
invalidation, compile-time dependency tracking — already have
per-expression, precise channels (generation guards;
free-symbol/`symbolDeps` tracking); an arrow bit is per-function and
lossy.

## Host capabilities — the `ce.effects` registry

*(v4 decision (e).)* Six labels represent access to host capabilities:
`network`, `fs_read`, `fs_write`, `time`, `environment`, `console`. Their
admission-test consumer — the thing that *distinguishes* each from
generic impurity, which v3's single speculative `host` label lacked — is
a per-capability **handler registry** on the engine instance:

```ts
ce.effects.network      // { fetch(…): Promise<…> }
ce.effects.filesystem   // read methods (fs_read) and write methods (fs_write)
ce.effects.time         // { now(): … }
ce.effects.environment  // navigator/locale/env reads (#env(), #navigator())
ce.effects.console      // { log(…), … }  (future Print)
ce.effects.entropy      // unseeded randomness source; default Math.random
ce.effects.random       // seeded draw kernel: draw(seed, n); default PCG3D (RANDOMNESS-MODEL §4)
```

**This is dependency injection at the host seam, not algebraic effect
handlers.** Overriding an implementation is an engine-API operation —
assignment, or a scoped helper (`ce.withEffects({network: mock}, …)`) —
never an *expression form*. There is no `Handle(expr, handler)`: that
would be delimited-control algebraic effects, which this design scopes
out ("Sets, not rows"). Mocking for tests — e.g. a `network`
implementation returning predefined responses — needs only DI; it stays
at the API surface.

**Snapshot scoping (v5, findings 5/15).** The registry is an **immutable
object, swapped wholesale**; every evaluation (`evaluate`, `.N()`,
`evaluateAsync`) captures the current registry **at entry** and uses that
snapshot throughout. `ce.withEffects(overrides, fn)` installs a derived
snapshot for evaluations *started within* `fn` and restores on exit via
try/finally — for a Promise-returning `fn`, restoration happens after the
promise settles. Concurrent evaluations each hold their own snapshot, so
an override installed for one in-flight evaluation is never observable
from another — the frame-stack bleed hazard `RANDOMNESS-MODEL.md` §2
documents for concurrent async does **not** apply to capabilities
(engine state outside the registry still inherits that standing caveat).
**Denial**: an override value of **`null` is an explicit denial** — the
needing operator yields an error value, overriding even a present
default (`ce.withEffects({network: null, console: null}, …)` sandboxes
an untrusted sub-evaluation). Combined with snapshotting, denial is
race-free; this is the documented sandboxing primitive.

**Coupling rule (normative).** An operator implementation may call
`ce.effects.X` methods iff the corresponding label is in its declared
effect set (for `filesystem`, per method group: read methods require
`fs_read`, write methods `fs_write`). This is mechanically auditable —
grep handler-namespace usage against declared arrows — the same
one-source-of-truth discipline as the flag migration.

**Defaults fail closed for the dangerous capabilities.** `network` and
`filesystem` have **no default implementation**: evaluating an operator
that needs them without a host-granted handler yields an error value.
`console` defaults to the real console; `time` to the real clock;
`entropy` to `Math.random` (this is where `RandomExpression`'s raw
`Math.random()` lands — ruling (b′) unchanged, now behind a mockable
seam); `random` to the builtin PCG3D kernel (below). For `environment`
*(v5, finding 12)*: the existing `#env()`/`#navigator()` **pragmas stay
parse-time**, gated by `allowHostPragmas`, unchanged — the `environment`
label and `ce.effects.environment` gate only **evaluation-time**
surfaces (host-declared functions today; a possible future
`Environment(key)` operator), since a parse-time pragma lowers to a
value before any application exists for a label to attach to. The
registry thus doubles as the evaluation-time trust gate v3's `host`
sketch gestured at, and per-target compile policy stays fail-closed on
all six labels.

**The label↔handler mapping is deliberately not 1:1.** `scope` is an
internal-accounting label with no host handler, and a future `async` has
none either — its discharge is `await`.

**`random` — ruling revised (2026-07-31): handler-backed at the
draw-kernel boundary.** An earlier draft kept `random` internal on the
ground that swapping the seeded stream's PRNG breaks the replay
contract. That conflated the **stream machinery** with the **generator
beneath it**. The handler is the kernel, not a per-draw tap — and *(v5,
review R3 finding 2)* the kernel is **index-addressed to match the
ratified stream contract**: `RANDOMNESS-MODEL.md` §4 defines the *n*-th
framed draw as the stateless `hash(seed, n)`, so the interface is
`ce.effects.random = { draw(seed, n) }` — a **pure function of seed and
index** (no stream object, no mutable state), default PCG3D per §4. The
engine retains ownership of everything above it — frames, draw-index
accounting, sub-stream *seed derivation* (a derived sub-stream is a
derived seed fed to the same `draw`), and the pending-draw protocol.
Use cases: mocking (a constant kernel); **pinning** a stable generator
so replay archives stay valid across engine versions — an archive is
valid relative to the *(seed, kernel)* pair rather than to an engine
version's builtin; and compliance-mandated generators. Contract points:
a kernel that is not a pure function of `(seed, n)` forfeits replay —
the same trust class as a wrong declared type; the kernel is captured
**at frame entry**, so a swap affects only subsequently entered frames
(mid-frame swap is unrepresentable). **Compile fails closed** *(v1)*:
compiled targets (JS/GPU) inline the builtin PCG3D — when a non-default
kernel is installed, compiling any expression whose effect set includes
`random` declines with a diagnostic; custom kernels are
interpreted-only until a target learns to thread them. Distinct
interfaces for distinct labels: `ce.effects.entropy` is the *unseeded*
source, `ce.effects.random` the *seeded, deterministic* kernel beneath
the frame machinery.

**Sequencing.** The labels enter the grammar at Stage 1 — immediately
useful, since an opaque *host-declared* function that fetches can state
`(string) network -> string` before any builtin capability operator
exists. The registry itself ships with the first capability operator
(Stage 4). Standing consequence: a builtin `Fetch` is unavoidably
Promise-returning — the first genuinely *per-operator* asynchrony, i.e.
the admission-test consumer the `async` label has been waiting for (see
"`async` will be an effect"). `Fetch` would be
`(string) async network -> string`, rejected statically by sync entry
points, discharged by `evaluateAsync` at the boundary. **Interval
semantics** *(v5, finding 13)*: between Stage 1 (labels in the grammar)
and Stage 4 (the registry), capability annotations are **descriptive
contracts, not enforced gates** — no builtin carrier exists, and the
coupling rule and fail-closed defaults activate with the registry.

## Design: effect sets on signatures

### Labels and lattice

An **effect set** is a subset of a closed, engine-versioned enumeration.
Each label carries fixed metadata; consumers read the metadata, never the
label name:

| Label | Meaning | Impurity? | Frame kind | Safe to re-run? | Handler |
|---|---|---|---|---|---|
| `random` | May consume draws from the ambient seeded stream (replays under a frame) | yes | `seed` | yes (replays) | `ce.effects.random` — the draw kernel (see "Host capabilities") |
| `entropy` | Unseeded, non-replayable nondeterminism (`RandomExpression`) | yes | — | yes (non-reproducible) | `ce.effects.entropy` |
| `scope` | May mutate a scope that outlives the application (`Assign`, `Declare`, `Assume` to non-local bindings — see "Scope writes") | yes | — | no | — internal |
| `state` | Creates or mutates **object** state — a heap store through a reference, or an object construction (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Changing a field is an effect"). Distinct from `scope`, which is mutation of a *binding* on the ambient scope chain. Emitters, three of them. **Object construction** (`P(age: 42)`) spells the label on its own arrow: `mintTypeConstructor` puts `effects: ['state']` on an object type's constructor signature, because a construction mints a fresh identity that two otherwise-identical calls can tell apart. The other two cannot spell it, and are labelled per call site on both the inference channel (`effects-inference.ts`) and the runtime channel (`effects-of.ts`): an **object field store** (`p.age = 43`, `p.child.age = 3`, `xs[i].age = v` — an `Assign` whose target is a `Field` whose receiver's static type is an `object{…}` layout carrying that field) and a **property SET through a `readwrite` protocol property** (the four-operand `ProtocolProperty(P, name, receiver, value)`, which is how an implicit or authored setter is invoked). A constructor can spell its label because it spells exactly one operation; `Assign` spells both a binding write and a store, and `ProtocolProperty` spells both a read (three operands) and a set (four), so for those two one declared arrow cannot say both | yes | — | no | — internal |
| `network` | Host network I/O (future `Fetch`) | yes | — | no (a request may be a remote write) | `ce.effects.network` |
| `fs_read` | Reads the host filesystem | yes | — | yes (non-reproducible) | `ce.effects.filesystem` |
| `fs_write` | Writes the host filesystem | yes | — | no | `ce.effects.filesystem` |
| `time` | Reads the host clock | yes | — | yes (non-reproducible) | `ce.effects.time` |
| `environment` | Reads host environment data — navigator, locale, env vars (the `#env()`/`#navigator()` surface) | yes | — | yes (non-reproducible) | `ce.effects.environment` |
| `console` | Emits host console/diagnostic output (future `Print`) | yes | — | no (re-running duplicates output) | `ce.effects.console` |

- **`pure` means "no impurity label present"** — NOT literally
  `effects = ∅`. Normative because a future non-impurity label (e.g.
  `async`) must not break caching by mere set-nonemptiness.
- The order is powerset inclusion — a **partial order**, not a chain: the
  singleton labels are pairwise **incomparable**; none implies another. In
  particular `fs_write` does not imply `fs_read` (a log appender writes
  without reading); read/write filesystem access carries both labels
  (`fs_read fs_write` in the slot), and an authoring-surface sugar
  `effects: ['filesystem']` may expand to exactly that pair — the type
  grammar itself carries only the closed labels.
- Admission of `entropy` under the three-part test ("Label admission"):
  its distinguishing consumers are (i) the pending-draw gate, which must
  *not* pin frames for it (vs `random`), and (ii) re-evaluation policy,
  for which it is safe to re-run but non-reproducible (vs `scope`, which
  must not be re-run casually at all). Serialized-contract truthfulness
  rides on (ii): stamping `RandomExpression` `{scope}` would tell a
  consumer the opposite of the truth on both counts.
- Admission of the six capability labels (v4): their distinguishing
  consumer is the per-capability handler registry `ce.effects` (see "Host
  capabilities") together with evaluation-time trust policy and per-target
  compile fail-closed — v3's merged `host` sketch had no consumer that
  told its surfaces apart; the registry is precisely that consumer.
  `time` is the case v3 anticipated verbatim: it folds into `entropy`
  "unless a virtual-clock mechanism ever gives it its own consumer" — a
  mockable `ce.effects.time` is that mechanism.
- A distinguished **top**, written `any`, means "unknown effects". For
  **every** derived view and every consumer, `any` behaves as if every
  label (current and future) were present — conservative in all
  directions, **with one ruled exception** *(v5, review R3 finding 4)*:
  **frame participation requires explicit declaration** — `any` (and an
  unknown operator) never pins a seed frame. On every other axis
  over-approximation is the safe direction; for frames it inverts
  (pinning forever is the harm), and not-pinning matches the shipped
  explicit-flag semantics of the pending-draw walk (`?? false` /
  `library/core.ts` ~172): unknown is *impure* for `isPure` yet *not*
  frame-relevant for the walk. Under union `any` absorbs. (No
  intersection operation is defined: nothing in this model intersects
  effect sets — projection unions, discharge subtracts, subtyping
  subset-tests.)
- An **unknown label** while parsing a type is a type error (fail closed).
  Version-skew consequence at the serialization boundary: an older engine
  receiving a newer engine's type string hard-errors rather than silently
  weakening the contract — the accepted trade; adding a label is a visible
  minor-version event.

### Label kinds — the metadata axes

The labels are not homogeneous, and the split a reader may sense between
"purity-related" labels and others is real — but it is **metadata, not
structure**. There are **four independent axes**; every label declares
its position on each at admission (the columns of the table above), and
**consumers key on axis predicates, never on label names**. The one
apparent exception proves the rule: the pending-draw gate "keys on
`random`" only in the sense that `random` is currently the sole label
with a frame kind — the gate's true key is the axis.

| Axis | Predicate | "Yes" side today | Consumer |
|---|---|---|---|
| **Impurity** | breaks referential transparency | all ten current labels (`async`, when admitted, will be the first "no") | caching, `isConstant`, the derived `pure` getter ("no impurity label present") |
| **Observation vs action** | safe to re-run — an *observation* of the outside world; re-running merely re-asks | observations: `random`, `entropy`, `time`, `environment`, `fs_read`; actions: `scope`, `state`, `fs_write`, `console`, `network` (conservatively an action — a request may write) | re-evaluation policy |
| **Frame kind** | participates in a delimiting frame protocol — the metadata names *which*, and the mode: draws (label), delimits (`frameProtocol`), or reads (`readsRandomFrame`) | `random` → `seed` draws; `WithRandomSeed` delimits; `Integrate`/`NIntegrate` read (the sole kind today) | the frame kind's obligation protocol (for `seed`: the pending-draw gate, keyed on all three modes) |
| **Handler-backed** | has a `ce.effects` namespace | the six capability labels, `entropy`, and `random` (at the draw-kernel boundary — "Host capabilities"); internal: `scope`, `state` | the registry coupling rule; evaluation-time trust policy |

Why this split is sound — and why it must stay **out of the lattice**:
the axes are consumer-facing metadata, and different consumers care
about different axes, so no axis may privilege the subtype order. The
ordering stays uniform, axis-blind powerset inclusion: a bound excludes
a label the same way whether or not that label is an impurity. The
future `async` shows why folding them would be wrong: an async-but-pure
function caches soundly (the impurity axis says so), yet
`(real) async -> real` is still **not** a subtype of `(real) -> real` —
a sync-only entry point's bare-arrow bound must exclude it (the lattice
says so). One axis answers the caching consumer, the other the
scheduling one; merging them would answer one question by corrupting
the other. Likewise the labels bear **no implication relations to each
other** on any axis — kinds classify labels; they never order them.

**Frame kinds, generalized.** A frame kind bundles four things: the
label(s) it virtualizes, its discharging delimiter operator(s), its
runtime obligation protocol for partially-evaluated survivors, and its
**reader field** — the definition flag marking operators that read the
frame without consuming from it. `seed` = (`{random}`, `WithRandomSeed`,
the pending-draw walk, `readsRandomFrame`). The anticipated
second kind is `clock` — (`{time}`, a future `WithClock`, and whatever
obligation an *advancing* virtual clock declares; a frozen clock needs
none). Accordingly the definition field is **kind-valued, not boolean**:
`WithRandomSeed` carries `frameProtocol: 'seed'`, and a future delimiter
names its own kind — new kinds arrive without redefining the axis,
exactly as the admission test demands of metadata.

**Lifecycle is deliberately not a fifth axis.** Appendix A's resource
types give a label acquire/release/revocation behavior that none of the
four axes expresses — by design, not omission: the axes classify what
an **application** does (*use*), while lifecycle governs when a
**value** stops being usable (*retention*) — the use-vs-retention split
"Resource frames" opens with. Lifecycle therefore lives on the
resource *type* (conformance to the `Resource` protocol, Appendix A),
is consumed only by the `with` delimiter, and never appears as label
metadata this table must carry. The four-axes completeness claim above
is scoped to application semantics.

`any` is conservative on the impurity, action, and handler axes — but
**not** on the frame axis, where conservatism inverts (pinning frames
forever is the harm): frame participation requires explicit declaration,
and `any` never pins (ruled, v5 — see the `any` bullet under "Labels and
lattice").

### Grammar and AST

`FunctionSignature` (`src/common/type/types.ts`) gains an optional effect
set, attached to the arrow:

```
<signature> ::= <arguments> [" " <effects>] " -> " <type>
<effects>   ::= "pure" | "any" | <label> (" " <label>)*
<label>     ::= "console" | "entropy" | "environment" | "fs_read"
              | "fs_write" | "network" | "random" | "scope" | "state"
              | "time"                           // closed, versioned
```

```
(real) -> real                // pure (empty slot ≡ empty set), unstated
(real) pure -> real           // the SAME set, stated explicitly
(real) random -> real         // may draw from the seeded stream
() entropy -> expression      // unseeded nondeterminism (RandomExpression)
() scope -> nothing           // may mutate an enclosing scope
(string) network -> string    // host network I/O (opaque host function)
(real) random scope -> real
(real) any -> real            // opaque: unknown effects
```

Normalization (normative): pure has **two** spellings, an **empty slot**
(nothing between the argument list and the arrow) and the keyword `pure`;
the empty specifier *list* is unwritable, so no degenerate spelling
exists to outlaw. Duplicate labels are a parse error; `any` is exclusive
(`any random` errors); canonical serialization orders labels
alphabetically, separated by single spaces, and parsing accepts any
order.

**`pure` is the STATED empty set** *(ruled 2026-08-01)*: a keyword in the
slot, distinct from the label enumeration. It follows `any`'s grammar
rules — exclusive with every label and with `any` (`pure random`, `pure
any` are parse errors), not repeatable (`pure pure` errors) — and it
builds `effects: []` on the arrow. `[]` and an absent `effects` field are
**semantically one state**, the empty set ∅: every semantic operation
(subtyping, the `pure`/`drawsRandom` getters, union, `matches()`, the
call-boundary bounds) treats them identically, and `undefined ⊆ []` and
`[] ⊆ undefined` both hold. They are **serialization-distinct**: `[]`
prints ` pure`, an absent field prints nothing.

The reason the empty-but-stated set is representable at all is
**round-tripping**: `let f : (int) pure -> int` must survive parse →
serialize → re-declare. Erasing the keyword would delete a token the
author wrote and silently demote an explicit purity CONTRACT to the
inferred track — and `pure` was the only stated effect set whose spelling
was erased (labels and `any` always survived). An *inferred* pure arrow
still serializes as the empty slot, so every previously-expressible type
string is byte-identical to before.

The slot exists only between a **parenthesized argument list**
and its arrow — argument lists are already mandatorily parenthesized in
this grammar, so the slot is positionally isolated: an identifier there
can only be an effect label. Hence no collision with type names, current
or future; a typo diagnoses cleanly as "unknown effect label"; and
admitting a future label can never change the parse of an existing type
string. In the AST, "no effect set" and "empty set" denote the **same
set** — one optional field, absent = `[]` = pure — and differ only in how
they serialize (above). **Reserved**: `!` in the
slot is a parse error today, reserved for the complement form (see
"Requiring absence" under Subtyping) so it can be admitted later without
a breaking grammar change.

Syntax provenance — **ruled 2026-07-31: the Swift specifier slot.**
**Swift** places effect specifiers as bare keywords between the parameter
list and the arrow — `(Int) async throws -> Int`, order fixed by fiat
(SE-0296) — and CE adopts that placement, with alphabetical canonical
order and the closed, versioned label enumeration in place of Swift's
fixed keyword pair. The verified fact that makes it sound here: argument
lists are already **mandatorily parenthesized** (`real -> real` is a
parse error today), so the `)` … `->` slot is positionally isolated (see
Normalization above for the consequences), and the slot anchors
per-arrow, so the nested-bounds exhibit below reads fine. Beyond being
lighter, it leans on the most widely-known effect-annotation syntax in
existence — relevant to Epsil's LLM-friendliness goal. (Swift's
`rethrows`/`reasync` — effect *polymorphism* — is the corner "Sets, not
rows" deliberately gives up, and does not need, since projection always
sees the actual operand.)

**Superseded (the v3–v4.0 provisional form): Unison-style arrow-attached
braces**, `a ->{IO} b`, spelled here `(real) ->{random} real` — the
established convention among effect-typed languages (**Koka** uses the
same position with angle brackets, `int -> <exc,div> int`, taken here by
type constructors; **Eff**'s postfix `A -> B ! Δ` uses `!`, taken here
by negation). Both forms are sound; the braces' residual advantages —
visually explicit set-ness at three-plus labels, slightly tidier exotic
spellings (`->{any}`, `->{!random}` vs `(int) any -> int`,
`(int) !random -> int`) — were judged not worth the weight. The brace
spelling survives only in review artifacts and earlier drafts; it is not
part of the proposal.

**Considered and rejected (2026-07-29): a postfix separator**, e.g.
`(a: integer) -> boolean :: random` (the trailing-position shape of Flix's
`\ IO` and Eff's `! Δ`; `::` itself is unclaimed in both the type and
Epsil grammars). Rejected for three reasons, the first decisive:

1. **Postfix trailers don't nest, and CE's dominant use site is nested** —
   parameter bounds inside another signature. Compare:
   `(g: (real) random -> real, x: real) scope -> boolean` vs.
   `(g: ((real) -> real :: random), x: real) -> boolean :: scope` — the
   trailing form *requires* the inner parentheses (without them the
   annotation floats ambiguously to the enclosing signature), forfeiting
   its flat-case readability exactly where effects matter most. Flix gets
   away with trailing position because its effects annotate non-nesting
   top-level `def`s.
2. **Trailing position needs precedence rules the attached form makes
   unnecessary**: in `(a) -> (b) -> c :: random` or
   `(real) -> real | error :: random` the attachment point must be ruled,
   serialized, and remembered; with the specifier slot pinned between the
   argument list and its arrow, a misplaced effect annotation is
   unrepresentable rather than misparsed.
3. **`::` arrives pre-loaded with the wrong meaning** — "has type"
   (Haskell) or "namespace path" (Rust/C++) — where the specifier slot
   carries exactly the right intuition (Swift's).

**The `function` primitive.** The bare primitive type `function` (used
today by e.g. `Iterate: '(function, initial: any?) -> list'`) is
shape-unconstrained and **effect-top as a bound**: any callable of any
arity and any effect set satisfies it. It is not replaced by a variadic
signature (contravariance would reject fixed-arity callbacks). Projection
is unaffected by the looseness of the bound — it always reads the *actual*
operand's signature, so `Map(pureF, xs)` is still computed pure.

`!` and `&` are taken in the type grammar (negation, intersection); the
specifier slot is positionally isolated from both, so no collision
arises. Types travel as strings in MathJSON, so effect annotations
round-trip wherever a **full signature** is carried (definition-form
encoding: see "Epsil surface").

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

What a bare arrow *asserts* depends on whose it is, and that distinction
is provenance, not syntax (see "Annotation provenance"): on an **opaque**
declaration — a host function, or a symbol declared but not yet assigned
a body — it reads pure, which is the residual trust of point 3. On a
**defined** function it is the inferred track: the body walk owns the
slot and re-derives it on every assignment. `pure` in the slot is how an
author asks for the first meaning where the second would otherwise
apply.

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
  subject to discharge. *(v5, finding 7)* Whether the latent set counts
  at all is governed by per-position **`invokes` metadata**, default
  `true` (the conservative formula above, and the standing rule for
  every opaque operator). A position declared `invokes: false` — pure
  containers and constructors that only *store* the value (`List`,
  `Tuple`, the structural operators; audited at Stage 1) — contributes
  the production effects `effectsOf(aᵢ)` only, no latent: `List(randomF)`
  is pure to build; the effect surfaces at whatever application later
  invokes an element. *(Shipped shape)* the metadata is
  `boolean | { [operandIndex]: boolean }` — an **operand-index map**
  (missing indices default to `true`), mirroring `discharges`'
  convention, with the boolean as the uniform spelling; besides the
  containers it now also carries the **storing** writers (`Assign`,
  `Declare` — a stored callback's latent set drops, its *production*
  effects do not: `Assign(x, Random())` is still `{random, scope}`) and
  the **selecting** conditionals (`If`, `Which` — a branch is returned,
  never applied) and the **sequencer** (`Block` — the last value is
  returned, not applied; this also makes the two channels agree, the
  inference having always treated `Block` as non-projecting). All three
  classes are held may-evaluate positions, so the held-evaluation
  contribution below is unaffected: `Block(Assign(x, 1), Random())` is
  still `{random, scope}`.
- **Held (lazy) operand position** — two classes *(v5, finding 8)*:
  - **May-evaluate** (the default for `lazy` positions: a `Sum` body, the
    `WithRandomSeed` body): the operand is not evaluated at application
    time but the operator may evaluate it *under* itself; contribution
    `(effectsOf(aᵢ) − discharge(op, i))` — held evaluation happens under
    the operator, so the operator may discharge it.
  - **Quote/store** (`Hold`): the operator **never** evaluates the
    content; contribution **∅** — `effectsOf(Hold(Random())) = ∅`, and
    `isPure` holds, matching `RANDOMNESS-MODEL.md` §2's inert-content
    ruling. The effects resurface at forcing: `Release(h)` (or any
    evaluation of the held content) is itself an application, and
    `effectsOf` recurses into the content *there* — for a symbol-bound
    held value, resolving through the binding like any callback. A
    pleasant consequence: the pending-draw walk's Hold exception becomes
    a *derived* fact of this classification rather than a special case.

**Discharge** is declared on the operator definition per operand
**position** (not only function parameters):

- Each position may declare an **accepted-effects bound** — for a function
  parameter, its signature arrow effects (contravariant check at the call
  boundary); for a held expression position, a declared bound on the held
  evaluation (default `{any}`).
- Each position may declare a **discharge set** ⊆ its bound: effects the
  operator absorbs rather than re-emits. Default: **discharge nothing** —
  propagation is the sound default and what gives `Map(f, xs)`
  per-call-site precision.

`WithRandomSeed` — specified fully, as the canonical discharger:

- Signature: `(finite_real | string, any) -> expression`, body position
  held (`lazy: true`), bound `{any}`, **discharges `random`** on the body
  position. So `WithRandomSeed(42, Random())` computes `∅` — referentially
  transparent, as it truly is — while `WithRandomSeed(42, Block(Assign(x,1),
  Random()))` computes `{scope}`: the frame absorbs the draws, not the
  scope write. (Per the confinement rule of "Scope writes", this example
  assumes `x` resolves to a binding outside the block — an escaping
  write; a block-confined write would not surface at all.)
- **The `random` discharge stops at a frame ESCAPE** *(direction A, ruled
  2026-08-02, Tycho item 142)*. A frame contains only the draws made during
  its **dynamic extent**. A body that provably evaluates to a *lazy drawing
  view* — `WithRandomSeed(42, Map(x ↦ Random(), xs))`, and equally the
  `Comprehension` the `[… for k = …]` syntax parses to — is a **completed
  value** that strips the frame and draws at materialization, from whatever
  frame is active *then* (`RANDOMNESS-MODEL.md` §6, the ruling of
  2026-07-25, and the "completed values strip the frame" rule of §2). That
  runtime behavior is unchanged; what changes is that the discharge no
  longer *claims* it: the position's effective discharge is the declared
  set minus `random`, so the application reports `{random}`. The gate is
  **positive proof, optimistic otherwise** — the node must be a lazy
  collection view whose *element work* draws (the latent set of the
  callback it invokes per element, or, for a view that binds its own
  variables, its non-clause operands), reached through **value position**:
  §2 states the escape holds "whether the view is the result itself or a
  cell of a returned `List`/`Tuple`", so the literal containers are
  traversed — the same container set, defined once, that the pending-draw
  walk reads — as is the statement a `Block` returns (the walk needs no
  `Block` case: it runs on an evaluated body, where the block has already
  collapsed to that statement). A materializer around the view
  (`ListFrom`, an index, a reducer) asked for the draws *inside* the frame
  and keeps the discharge; so does a view whose only draw is in its
  **source** (`Map(k ↦ k, RandomShuffle(…))` draws when the view is built);
  so does an uncertain body. Both channels apply this rule through one
  shared `effectiveDischarge` — the runtime `effectsOf` and the
  construction-time inference must not disagree (the item-132 failure
  mode), so a lambda whose body is `WithRandomSeed(42, lazyDrawingView)`
  gets `random` on its own arrow too, while the per-site frame *inside* a
  callback (`(i) ↦ WithRandomSeed(42, Random())`) still discharges and
  stays pure.
- **The runtime frame-protocol role is a separate field**, not the arrow:
  the definition gains `frameProtocol: 'seed'` (kind-valued — see "Frame
  kinds" under Label kinds; this is today's conflated second meaning of
  `drawsRandom`), consumed by the pending-draw walk (a surviving nested
  `WithRandomSeed` owes the outer frame) exactly as today. The derived
  `drawsRandom` getter is
  `random ∈ ownEffects ∪ projected` **∨ `frameProtocol === 'seed'`**, so
  every current consumer keeps working. The `readsRandomFrame` field is
  a **peer runtime field, untouched by the flag migration** — neither
  translated to a label nor derived from one (see "Randomness shapes").

**Discharge from `any`** *(v5, finding 9)*: `any − D` is the
**co-finite set** ¬D — admitted as an **internal computed value only**,
never surface syntax (the reserved `!` stays unadmitted, and since
signatures are constants — application effects are never stored on an
arrow — nothing ever serializes a co-finite value). Subset tests on
co-finite values follow the stateless comparison rules already given
under "Complement form" (Subtyping). Payoff: `WithRandomSeed(42,
opaqueAnyBody)` computes ¬{random} — provably not-random, so the frame
gate can release — where a stays-`any` rule would make discharge around
any opaque body a no-op.

**Runtime counterpart — one label-aware channel (in scope, required).**
The runtime gains a single expression-level computation
`effectsOf(expr) → EffectSet` implementing the projection rule above,
resolving symbol operands through their bound definitions (the
`isImpureHead` by-name pattern, `library/map-broadcast-shape.ts`). Both
existing consumers become views of it:

- `isPure` ≙ no impurity label in `effectsOf(expr)` — a boolean projection,
  no longer independently computed;
- the pending-draw walk keys on **all three seed-frame participation
  modes**: `random ∈ effectsOf(…)` ∨ `frameProtocol === 'seed'` ∨
  `readsRandomFrame` *(v5 — the third term preserves frame retention for
  incomplete estimators, `derived-substreams.md` §6)*, **preserving its
  existing exception structure** — lazy views in value position and
  binder handling per `RANDOMNESS-MODEL.md` §2 and §6, with the Hold
  exception now *derived* from the quote-position rule above rather than
  special-cased. A third exception is likewise derived from the
  per-position `invokes` metadata: a `Function` **value** in a
  non-invoking position is a value boundary — the walk does not scan its
  body for pending draws (the head only stores/selects/returns it; the
  draws fire at a later application, outside the frame's obligation) —
  while an inline lambda in an *invoking* position (a `Map` callback)
  still pins, and application operands in non-invoking positions still
  scan (a surviving `If(c, Random(), 0)` owes its frame). Per the `any`
  ruling ("Labels and lattice"), `any` does
  **not** satisfy the first term — unknown operators never pin frames.

This closes hole 1 for *both* consumers (v2 fixed only the boolean).
Memoization: `effectsOf` results on `BoxedFunction` are cached with a
**generation guard** — validated against `ce._generation` exactly like the
two existing generation-checked memos in `boxed-function.ts` (~714, ~1242).
(`reset()` is currently an inert stub; it is *not* the invalidation
mechanism.)

### Worked examples

**1 — `Map(f, xs)` with `f` bound to an effectful function.** First, what
this is *not*: the operator's `type` handler. The **type** of
`Map(f, xs)` is `list` — unchanged whether `f` is pure or `random`.
Effects never appear in a *value* type; they live only on arrows, and an
application's result is a value — so there is nothing effect-shaped for
the `type` handler to compute, and it is unchanged by this design. The
place the effect *does* become visible in a type is one level up: the
literal `(xs) ↦ Map(f, xs)` has type `(list) random -> list` — the
application's effects, stamped onto the enclosing literal's own arrow by
the static walk. The application's effects flow through two channels, one
dynamic and one static:

- **Runtime — `effectsOf`, computed dynamically.**
  `effectsOf(Map(f, xs)) = ownEffects(Map) (= ∅) ∪ contribution(xs) ∪
  contribution(f)`. `f` is a symbol operand, so `effectsOf` resolves it
  **through its current binding** to a function value and reads that
  value's signature arrow — its latent set — *at query time*. `Map`
  declares no discharge, so the latent set is re-emitted: if `f` is
  currently bound to `(x: real) random -> real`, the application computes
  `{random}`. The generation-guarded memo is what makes "current" honest:
  reassigning `f` bumps `ce._generation` and invalidates the cached
  answer. This dynamic resolve-through-the-binding is precisely what
  closes hole 1 — today's `isPure` sees a bare symbol and stops.
- **Inference-time — the static walk.** When `Map(f, xs)` sits inside a
  `Function` literal's body, the effect walk performs the same projection
  with what is knowable at construction: an *annotated parameter* `f`
  contributes its declared arrow effects; an *unannotated parameter* is
  treated pure (ruling (c) — optimism, closable by annotation); a *named
  global* `f` is the dependency-order case — ruled in v5: unresolved at
  construction ⇒ `{any}`, resolved ⇒ its binding's arrow (see
  "Inference"). The static walk stamps the enclosing literal's arrow;
  the runtime channel answers for the expression as bound *now*.

**Does the signature vary with the arguments, then? No — signatures are
constants; variance lives at applications.** Two cases:

- When `f` is a **captured free symbol** (as above), the literal's
  signature is a **construction-time snapshot**: stamped once, from
  `f`'s then-current binding, when the literal's signature is built. It
  does not re-stamp when `f` is later reassigned — that staleness is
  exactly hole 3. The v5 dependency-order ruling closes its
  forward-reference half (an *unresolved* `f` snapshots as `{any}`,
  which later resolution can only improve on); reassignment of an
  already-resolved binding still leaves the installed signature stale —
  there, the runtime `effectsOf` channel, which does resolve through
  *current* bindings, keeps the accounting consumers honest.
- When the function arrives as a **parameter** — `(xs, g) ↦ Map(g, xs)`
  — the signature never varies per call site: unannotated `g` infers
  optimistically pure (ruling (c)); annotated `g` contributes its
  declared bound, fixed. There is no effect variable to instantiate per
  call — the sets-not-rows trade, made deliberately. Per-call-site
  precision is recovered **at the application, not the signature**:
  projection unions the *actual* operand's latent effects into each
  application expression's effect set (default discharge: nothing), so
  the expression `Map(pureF, xs)` computes `∅` and `Map(randomF, xs)`
  computes `{random}` while `Map`'s one signature stays fixed at its
  effect-top `function` bound.

**2 — `Sum(i, 1, 10, f(i))`: binding structure is not an effect.** `Sum`
creates a scope to bind `i` — that is the `scoped:` definition flag
(binder machinery), and it contributes **no label**: with `f` pure the
whole application is pure and cacheable despite the internal scope. With
`f` bound to `(n: integer) random -> real`, projection carries the
body's `{random}` through (`Sum` discharges nothing) — and *still* no
`scope` label: the index binding is internal, and nothing escapes.

**3 — confinement: three counters.**

```
f() := Block(Declare(n, 0), Assign(n, n + 1), n)
// Declare dominates the Assign inside the literal → confined.
// f : () -> integer — pure; no observer outside can see the mutation.

Declare(counter, 0)
g() := Block(Assign(counter, counter + 1), counter)
// counter's declaration is outside; Assign writes through to it.
// g : () scope -> integer — an escaping write.

h() := Block(If(flag, Declare(n, 0)), Assign(n, 5), n)
// The Declare does NOT dominate the Assign (flag-false path writes
// through) → not provably confined → h : () scope -> integer.
```

The distinction is static — dominance of the `Declare` over the
`Assign`, per "Scope writes" — so inference computes it without running
anything. Note the channel split (ruled, v5): these verdicts are the
**installed signatures**; the runtime `effectsOf` of a *bare*,
un-abstracted `Block(Declare(n,0), …)` expression is conservatively
`{scope}` — sound over-approximation, and invisible to any caller of
`f`, whose applications project through `f`'s pure arrow.

**4 — producing vs. invoking: `Use(MakeCallback())`.** Let
`MakeCallback : () random -> ((real) -> real)` — it *draws* in order to
*build* a pure callback. The operand's contribution to `Use(…)` is
`effectsOf(operand) ∪ (latent − discharge)`: producing the value
contributes `{random}` — **never dischargeable**, since the draw happens
when the operand is evaluated regardless of what `Use` does with the
result — while the produced value's latent set is `∅`. The mirror image:
`h : () -> ((real) random -> real)` produces a callback *purely*;
`Map(h(), xs)` is then `{random}` via the latent set — which a
discharging operator *could* absorb. Same shapes, opposite channels.

**5 — a bound at the call boundary.** `integrate(f: (real) -> real, a,
b)` declares a pure-callback bound (form 1 under "Requiring absence").
`integrate((x) ↦ Random(), 0, 1)` is rejected — an `incompatible-type`
error value, with the same timing as existing argument validation.
Contrast `Map`, whose parameter is the bare `function` primitive —
effect-top by definition — so `Map((x) ↦ Random(), xs)` keeps working,
projecting `{random}` instead of rejecting.

**6 — an incomplete estimator keeps the frame without any label.**
`WithRandomSeed(42, NIntegrate(f, 0, n))` with `n` unbound: the
Monte-Carlo estimator is a derived sub-stream — *pure*, no label, per
the noise-floor convention — so `effectsOf` of the whole expression is
`∅`. Yet the partially-evaluated survivor must keep the seed frame
pinned so a later completion (binding `n`) replays. That retention rides
`NIntegrate`'s `readsRandomFrame: true` — the pending-draw walk's third
key — not any effect label. This is the case that shows why the walk
cannot be a pure view of `effectsOf`: frame participation and impurity
are different axes, and the reading mode is deliberately
contract-invisible.

### Subtyping

- **Covariant in the effect set**: `(real) -> real` <:
  `(real) random -> real` <: `(real) any -> real`.
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
2. A positive bound listing what *is* tolerated: `g: (real) scope ->
   real` means "no probabilistic nondeterminism (`random` and `entropy`
   excluded); scope mutation tolerated" — which is usually what a
   replay-sensitive consumer actually wants, since `entropy` is
   nondeterministic too and excluding only `random` rarely matches real
   intent. Note *(v5, finding 14)*: this bound does **not** make the
   callback safe to re-run or cache — `scope` is on the *action* side of
   the observation/action axis; the bound only excludes the two
   randomness labels.
3. The literal complement, by enumerating the other labels — with the v4
   roster, "anything except `random`" is an **eight-label enumeration**
   (`console entropy environment fs_read fs_write network scope time`
   in the slot) — expressible because the enumeration is closed, but
   *extensional*: it does not auto-extend when a future label is admitted
   (an `{async}`-bearing callback would be rejected until the author
   widens the bound — fail-closed, safe, but the written bound drifts
   from the intent at each label addition, and the v4 label expansion
   makes this form markedly worse — strengthening the reserved
   complement below).

All three are ordinary contravariant subset checks; an `{any}` operand
fails every finite bound (an opaque function that won't state its effects
cannot prove absence — conservative, intended). Note the distinction from
**discharge**: a bound says "don't bring the effect"; a discharge says
"bring it, I contain it" (`WithRandomSeed`). Pick by whether the operator
has a containment mechanism.

**Complement form (designed, not admitted — syntax reserved).** The drift
in form 3 has a clean fix: a co-finite bound written `!random` in the
slot (`g: (real) !random -> real`) — "every label, current and future,
except those negated" — the closed-world analog of the row-literature
*lacks constraint*. It stays inside the sets-not-rows boundary: bounds
become finite sets, co-finite sets, or `any`, and every subtype test
remains a trivial stateless comparison (finite ⊆ co-finite(N) iff the
positives avoid N; co-finite(N₁) ⊆ co-finite(N₂) iff N₂ ⊆ N₁; co-finite
⊄ any finite set, since it is version-open). Mixing positive and negated
labels in one slot is a parse error; a bare `!` is not a spelling of
`any`. Admission trigger: the first real consumer of an "all but X"
bound — until then the `!` is merely reserved in the grammar, and forms
1–3 cover current needs.

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
one at saturation, for `random` and `scope`.

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
  | `false` | `false` / omitted | **`{any}`** — unclassified legacy impurity. NOT `{scope}`: the flag promises only "not pure" (an opaque host function may be entropy/IO; `RandomExpression` is the live counterexample). `{scope}` — and every capability label — is only ever assigned **explicitly**, via an effects-bearing signature or the new `effects:` authoring field, or by the audited Stage 1 list. |
  | `true` | `true` | **registration error** (contradiction) |

- A new explicit `effects:` authoring field (or an effect-annotated
  signature string, `pure` included) is the precise surface; if it and
  legacy flags are both given and disagree, **registration errors** —
  never silent precedence. `effects: []` and `pure` in the specifier slot
  are the same input: an explicitly stated empty set.
- **As readable state, the flags become derived getters**: `pure` ≙ no
  impurity label; `drawsRandom` ≙ `random` **explicitly** `∈ effects ∨
  frameProtocol`. `any` reports conservatively for `pure` (impure) but does
  **not** satisfy `drawsRandom`: frame participation requires explicit
  declaration, per the `any` ruling under "Labels and lattice" — unknown is
  *impure* for `isPure` yet *not* frame-relevant for the walk, which is the
  shipped `?? false` semantics. Every existing consumer keeps working.
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
  `() random -> …`. This **amends Stage 0's shipped behavior** — the
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
- **Dependency order — ruled (v5, review R3 finding 10).** The split is
  adopted: an **unresolved named head** infers `{any}` — sound; the cost
  is caching for forward references — while **applied unannotated
  parameters** keep the optimistic ruling (c). One refinement keeps
  mutual recursion workable: an **explicit** annotation on a definition
  whose inference saw an unresolved head is installed as a **trusted
  contract** — the head is effectively opaque at that moment, so this is
  the same residual trust class as an opaque host declaration — and is
  *not* revalidated when the head later resolves (no dependency
  tracking). So `f() := g()` before `g` exists: unannotated → `{any}`
  (honest); annotated → author-stated, trusted.
- **The declared-but-unassigned window stays optimistic** *(ruled
  2026-08-01)*. Between `ce.declare('fib', { type: '(number) -> number'
  })` and the first body assignment there is no body to walk, so the
  symbol reads **inferred pure**, and a forward reference compiled in
  that window snapshots that optimistically. This is the same residual
  optimism as an unannotated applied parameter, and it is bounded the
  same way: the runtime channel (`effectsOf`) recomputes through the
  CURRENT binding, so the accounting stays honest once a body is there.
  An operator that cannot tolerate the window has a second lever:
  **runtime enforcement is available per operator** — an evaluate handler
  may call `effectsOf()` on the operand it is about to invoke and reject
  at evaluation time. The static walk stays optimistic; an operator that
  needs certainty pays for it where it can actually observe the answer.
- **Definition-annotation check.** An explicit effect annotation on a
  defined function is a contract: accepted iff `inferred ⊆ declared`
  (over-declaring weakens, allowed). On violation the definition is **not
  installed** and the `Assign`/`Declare` yields an `incompatible-type`
  error value — same shape and channel as the call-boundary check.
  *(v5)* When inference saw an unresolved named head, the check cannot
  run and the annotation installs as **trusted** (previous bullet).
  The check is a **revision gate**, and it runs on every assignment, not
  only the first: re-assigning a body to a declared symbol re-checks the
  contract (which the new body must also satisfy) and leaves the declared
  set on the arrow. On the inferred track — `effectsDeclared` false —
  there is nothing to check, and the re-assignment simply re-stamps the
  newly inferred set, in either direction.
- **Annotation provenance** *(v5, finding 11; the inferred-effects model
  ruled 2026-08-01)*. Effects are a **second axis of the mechanism the
  type system already has for types**. A declaration's type axes carry
  `inferredSignature` / `inferredType` — inferred means *flexible*,
  revisable when better information arrives; explicit means an
  *enforceable contract*. Effects take the same polarity, on their own
  axis, through a **definition-level provenance bit,
  `effectsDeclared`** — the effects-axis analog of `inferredSignature`.
  Since the 2026-08-01 round-trip ruling the bit is **derived from the
  signature at the declare route** — `signatureEffects(type) !==
  undefined`, where an author-written `pure` (and the `effects: []`
  field) attaches the stated-empty `[]` — so the parse-time side channel
  that used to carry the keyword out of band is gone. The bit remains as
  the *stored* form of that read, so a definition can also be handed it
  directly.

  Provenance is therefore **per axis**. An ascribed full signature with
  an **empty specifier slot** — `ce.declare('fib', { type: '(number) ->
  number' })` — declares the TYPE axes (parameters, result: a contract,
  as before) while leaving EFFECTS on the **inferred track**:
  `effectsDeclared` stays false, and inference stamps, and freely
  RE-stamps, the effect set on every body assignment. The canonical arc:
  declare bare → inferred pure; assign a counter-writing body → revised
  to `{scope}`; reassign a pure body → revised back. No errors anywhere.
  *(This REPLACES the earlier reading of a bare slot as a declared-pure
  contract.)*

  An **explicit statement** is a contract: a non-empty specifier
  (`(number) scope -> number`), the `effects:` authoring field, or the
  `pure` keyword in the slot — an explicitly-stated *empty* set, `[]` on
  the arrow, and the exact twin of `effects: []`. Every assigned body
  must then satisfy
  `inferred ⊆ declared` (over-declaring is allowed: a pure body under a
  `scope` contract is fine); a violation is an `incompatible-type` error
  and the definition is not installed; and the stored arrow keeps the
  **declared** set — it is never re-stamped down to the tighter inferred
  one. The legacy `pure` / `drawsRandom` flags deliberately do NOT set
  the bit: they are an override ("not pure"), not a contract. A
  return-type-only `Typed(body, T)` ascription likewise remains
  return-type-only: it carries **no effect contract** and leaves
  inference in charge.

  The same per-axis split governs the assignment boundary's
  compatibility check (`matchesDeclaredTypeAxes`, shared by
  `engine-declarations.ts` and the value-definition constructor):
  parameters and result are judged against the declaration
  unconditionally; the effects axis is judged only where its own
  provenance says it was declared. Without that split every Stage 2
  literal — each one carrying its inferred specifier — would fail the
  covariant `matches()` against a bare-arrow declaration, rejecting
  shipped, pinned idioms (a mutable closure declared `(number) ->
  number`; see `scope.test.ts`, `lambda-capture.test.ts`).

## Sets, not rows

This design stops at effect **sets** — closed, ground, variable-free.

**What a "row" is.** In the effect-typing literature (Koka is the
canonical example) a function's effect is not a set but a **row**: a
list of labels that may end in a **row variable** — `⟨exc, div | e⟩`
reads "`exc`, `div`, and whatever `e` turns out to be". The row variable
is the point: signatures become **polymorphic over effects**, quantified
over `e`, so a higher-order function can state "my effect is my
callback's effect plus my own" — `map : (list<a>, a -> e b) -> e
list<b>` — and each call site *instantiates* `e` by unification. Rows
are thus *open terms* that participate in inference: unification state,
substitution, and (in Koka) duplicate/scoped labels with their own
equational theory. Sets, by contrast, are *closed values* that
participate only in subset tests. Everything this document calls an
effect set is ground — no variables, no unification, no per-call
instantiation; that entire apparatus is what is being declined, and
"variance lives at applications, not signatures" (Worked examples) is
what replaces it.

**Why rows exist elsewhere**: in separately-compiled languages a function
value is opaque at the use site; the type is the only channel for the
callback's effect. Effect variables are the price of opacity.

**Why CE does not need them**: projection-and-discharge covers both halves
of what rows buy, without variables —

- **Propagation**: a function-valued operand contributes its actual
  signature's latent effects, per call site. `Map(pureF, xs)` is pure;
  `Map(randomF, xs)` is `{random}`. No variable needed: the engine always
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
row rewriting; annotation-language complexity hostile to Epsil's
LLM-friendliness goals. Discharge declarations are deliberately not a
`rethrows` — they subtract declared constants, never bind variables.

**The boundary, written down**: reopen rows only if (a) opaque declared
HOFs with genuine effect polymorphism become common (a host/plugin ABI in
bodiless contracts), or (b) library operators need effect-parametric
signatures that projection over actual operands cannot cover. Neither is
foreseeable.

### If the boundary is crossed: the echo marker (disposition, 2026-08-14)

*Not a ruling — a recorded disposition, so that if either reopen
condition above ever materializes, the first design considered is not a
row system.*

The sanctioned shape is the **echo marker**: a declared signature may
mark its effects as "whatever the actual operand at position *k*
projects" — Swift's `rethrows` (which echoes `throws` from a closure
argument), generalized to every label. Written speculatively with a
placeholder spelling: `(function^, collection) ^ -> list` reads "my
application's effects are my callback's". No spelling is reserved (the
specifier slot reserves only `!`); `^` here is illustrative, not grammar.

What it is — a **projection instruction, not a type variable**:

- **Semantics.** At an application, a marked signature contributes the
  projected latent effects of the *actual* operand at the echoed
  position, in place of a declared constant set. The machinery already
  exists — invoking-operand projection ("Projection and discharge")
  walks actual operands today. The marker only lets a **bodiless**
  declaration opt into that walk instead of picking a pole (a pure
  bound, or accept-and-project `{any}`) — which is precisely the one
  corner "What sets give up" concedes.
- **What it is not.** It cannot be named, quantified, unified, or
  constrained; there is no substitution and no per-call instantiation
  state. Everything this section declines stays declined.
- **Subset ordering** treats a marked signature as if it declared
  `any` — sound, one line, no new lattice element. The marker's
  precision lives entirely at applications and at conformance ceilings:
  a protocol requirement marked this way would check an implementation
  per-dispatch against the effects of the callback it was actually
  handed, rather than forcing the pure-or-`any` pole.
- **Motivation drift, recorded honestly.** Protocol requirements *are*
  bodiless declared signatures — the corner this section called rare.
  The derived dispatcher effect unions built for mutable objects
  (`docs/TYPE-SYSTEM.md`
  Phase 0a: `_deriveEffects`, conformance-version memo keys, the
  widening-guard rollback) are projection extended to dispatch, paid
  for in cache-invalidation machinery rather than type machinery. If a
  second such seam appears, the echo marker is the first resort,
  before any variable-bearing design.

**Scope of this disposition, stated** *(round-4 review, finding 11)*:
the marker replaces only the head's **own-effects** term — the pole a
bodiless declaration must otherwise pick; every downstream mechanism
(`invokes`, held positions, discharge, what happens when the marked HOF
is itself stored, passed, or reassigned) stays governed by ordinary
projection and is deliberately *not* respecified here. Two consequences
to accept or design around at activation time: a marked signature,
being `any` for subset ordering, is rejected by every finite bound; and
a marked *protocol requirement* checked "per-dispatch" needs a rule for
conformance-registration time, when no callback exists yet. If
activated, the disposition graduates only with worked nested-HOF and
dispatch examples.

## Label admission — the test, the one future label, and dispositions

Admission test (all three must hold): (1) a **consumer must distinguish**
the label from the rest of impurity; (2) it is **inferable** or declarable
at an opaque boundary; (3) subset ordering stays meaningful. A new label
declares its position on **every metadata axis** ("Label kinds":
impurity, observation/action, frame protocol, handler-backed) so derived
views extend without redefinition.

**The only label still speculative is `async`:**

- **`async`** (application may suspend): fails criterion 1 today
  (asynchrony is engine-wide, `evaluateAsync`). Becomes real when an
  *operator* is inherently asynchronous — which the first capability
  operator (`Fetch`, Stage 4) will be, so this is no longer indefinitely
  deferred (see "Host capabilities"). Then sync entry points reject
  `{async}` statically, and an awaiting wrapper *discharges* it. Metadata:
  **not an impurity** — an async pure function's settled value caches
  soundly, which "pure ≙ no impurity label" accommodates. The
  representation question — effect vs. promise-typed value — is **ruled:
  effect** (see below).

**Dispositions of earlier candidates (v4) — no longer speculative:**

- **`time`** (clock reads) — **admitted**, now in the main roster: v3
  folded it into `entropy` "unless a virtual-clock mechanism
  (`WithClock`?) ever gives it its own consumer, the same way `random`
  earned its label". A mockable `ce.effects.time` is exactly that
  mechanism.
- **`host`** — **superseded** by the capability split (`network`,
  `fs_read`, `fs_write`, `environment`, `console`): the merged label
  failed criterion 1 in a subtle way — no consumer told its surfaces
  apart — until the `ce.effects` registry supplied a *per-surface*
  consumer, at which point the honest representation is one label per
  handler namespace (see "Host capabilities").

**Examined and deferred (v6, 2026-08-08) — not a ruling, a recorded
disposition so the question is not re-litigated:**

> **Resolution (2026-08-14): `state` is that label, admitted.** The v6
> deferral below rested on one hinge — no consumer could tell a
> heap-mutation label apart from `scope` on any metadata axis. The
> mutable-objects design (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B,
> "Changing a field is an effect") *specifies* exactly the distinguishing
> consumers the note found missing — they land with the object phases,
> while the label itself is admitted ahead of them so declared ceilings
> can be spelled: the B1 mutability gate keys on the label (a protocol
> with a *declared* `state` member is object-only — the gate arrives with
> protocol integration, Phase 2 of the implementation plan; until then a
> declared-`state` requirement is only an effect ceiling), per-object
> **version counters** give it an invalidation channel distinct from
> scope generations, and B3's cache exclusion consumes it (an expression
> carrying `state` is never constant-folded or served from evaluation
> caches). The reversal is deliberate and argued there,
> not a silent re-litigation; the name is `state`, not `mutable` —
> construction also carries it and creates state while mutating
> nothing. Finding 2 below (per-argument precision) stands unrefuted
> and unneeded: the label's admitted consumers are per-arrow ones.
> The label is in the roster and grammar now, **inert** until the
> object phases emit it.

- **`mutable`** (application may mutate the *contents* of a value, as
  opposed to a binding) — **deferred; probably never a label.** Three
  findings, in order of weight:

  1. **It collides with `scope` on every metadata axis** — impurity yes,
     observation/action *action*, no frame kind, internal (not
     handler-backed). Consumers key on axis predicates, never label names
     ("Label kinds"), so no derived view could tell the two apart: that is
     criterion 1, and it is the `host` failure mode before the registry
     rescued it. Nothing supplies an analogous per-surface consumer here.
     `scope`'s own wording — "may mutate a scope that outlives the
     application" — generalizes to *state* that outlives the application
     at no cost to the lattice, and the v4 `write` → `scope` rename was
     done to *remove* an ambiguity that re-splitting would reintroduce.
  2. **The consumers that would want it need per-argument precision, and
     a label is per-arrow.** The three candidates — copy-on-write /
     in-place update, memo invalidation, and compile fail-closed — want
     "may this callee mutate or retain **this** argument", "**which**
     memos are now stale", and (per the standing rejection of
     target-compilability) nothing new, respectively. An arrow-level set
     answers none of them; it says only "mutates *something*". This is
     the razor already applied to non-local *reads* under "Scope writes":
     the precise channels exist per-expression, and **an arrow bit is
     per-function and lossy**. The languages that make mutation sound put
     it in **type position, not on the arrow** (Rust `&mut`, Swift
     `inout`/`mutating`, linear types); `ST`'s soundness likewise comes
     from the rank-2 type on `runST`, not from an effect tag.
  3. **Inference could not back it.** `scope`'s confinement is a static
     dominance condition on `Declare`; confinement for value mutation is
     escape/alias analysis, which the engine has nowhere. The label would
     be declare-only with a conservative inference fallback — admissible
     under criterion 2, but buying markedly less than it appears to.

  **The one path to admission**, should it ever open: a confined-mutation
  *region* (a Clojure-transient / `ST`-style `Builder`) would give the
  label a **frame kind** — delimiter `Builder`, kind `region`, discharge
  `{mutable}` on exit, obligation protocol = the escape check — which is
  structurally the `WithRandomSeed`/`random` shape and exactly the
  distinguishing consumer criterion 1 demands. Frame kinds were
  generalized to admit new kinds without redefining the axis, so this is
  a supported extension rather than a special case. Precedent for
  deferring on a missing mechanism: `time` (awaited `ce.effects.time`),
  `async` (awaits `Fetch`).

  **Note the likely resolution makes the label unnecessary.** If the
  parameter discipline lands as copy-in/copy-out — the callee's write
  rebinding the caller's *binding* on return, in-place update demoted to
  an unobservable copy-on-write optimization — then the write is a
  **binding** write and is already `{scope}`. That parameter mode is
  invariant in its type (read *and* written: the ordinary in+out rule,
  not a special case).

  **The objection is to a semantics, not to a spelling** — the two were
  conflated in an earlier draft of this note. What is unsound here is
  **permission without uniqueness**: a mode meaning only "the callee may
  write through this reference", with no guarantee the reference is
  unaliased. Subexpression nodes are shared into multiple parents
  (`t.op1 === list` and `t.op1 === t.op2` both hold today), so such a mode
  lets a caller hand over a node aliased into five other expressions with
  the checker's blessing — the array-covariance hole. Uniqueness is what
  makes Rust's `&mut` sound, and it is not expressible in this rank-1
  system without linearity. Copy-in/copy-out sidesteps the whole question
  by never writing through anything.

  **Priority ruling (2026-08-08): the parameter mode is DEFERRED as
  sugar.** It expresses nothing that returning a tuple does not already
  express, and modified input arguments have a long field record of being
  surprising; it is convenient, not enabling. The *capability* ask it was
  standing in for is efficient functional update — `xs = Append(xs, x)`,
  `xs[i] = v`, `ds.key = v` — every one of which is a **rebinding** form
  needing no parameter mode, no new value semantics, and no effect label.
  See the naming and uniqueness material below only if the mode is ever
  revived.

  **Open naming question — `inout` vs `mutable`, no ruling.** Both spell
  the copy-in/copy-out mode; the trade is readability against
  mispredicted aliasing. The survey (Julia, Scala, Rust, Swift, Ada, C#,
  OCaml, C++, Pascal) splits by *which concept is being named*, and the
  split is independent of any memory model:

  | Concept | Vocabulary | Languages |
  |---|---|---|
  | Mutable **binding** | `mut` / `var` / `let` | Rust `let mut`, Scala `var`, Epsil `let` |
  | Value mutability, **in the type** | adjective or distinct type | Julia `mutable struct`, Scala `mutable.Map`, Rust `&mut T`, OCaml, C++ |
  | **Parameter mode** (property of a slot) | mode word | Ada `in out`, Swift `inout`, C# `ref`/`out`, Pascal `var` |

  No surveyed language uses a mutability adjective for a parameter mode —
  the third row is spelled with mode words everywhere. Two specific
  hazards for `mutable`: Julia's `mutable struct` means in-place mutation
  **with aliases observing it** (Julia can afford that because `===` is
  address-based for mutables — a redefinition unavailable here, where
  `isSame` must stay an unconditional equivalence relation to remain a
  safe dedup key); and Rust's `fn f(mut xs: Vec<_>)` — the form that most
  resembles `xs: mutable list` — is a **callee-local pattern binding**,
  not part of the function's type, invisible to callers, propagating
  nothing back. A reader carrying either prior mispredicts
  copy-in/copy-out on the one axis that matters. `inout` carries no such
  prior. The discriminating case, which docs must
  lead with under either spelling:

  ```
  let ys = xs
  f(inout xs)   // or: f(mutable xs)
  ys            // UNCHANGED — copy-in/copy-out never touches an alias
  ```

  A secondary, non-taste consequence: spelled as a *type qualifier*,
  `mutable` grammatically invites `list<mutable point>`,
  `let x: mutable list = …`, `-> mutable list` — all meaningless for what
  is a passing mode rather than a type constructor, so the grammar would
  have to reject a qualifier legal in exactly one position. `inout` does
  not invite that generalization.

  **Where the keyword goes.** The mode is part of `FunctionSignature` —
  it is what the call boundary checks against and it must serialize in
  the type string to survive the Tycho boundary — so the **declaration
  side is not optional**. Whether a **call-site marker** is *also*
  required is a separate ruling: Ada takes plain call syntax, Swift
  requires `&x`, C# requires `ref`/`out` at both sites. **Lean: require
  one.** A call that silently rebinds the caller's variable, spelled
  identically to an ordinary call, is the largest available hole in the
  language's "values are immutable, rebinding is explicit and visible"
  promise — the reason C# made the call-site keyword mandatory.
  Independently of that ruling, the **lvalue restriction is a call-site
  rule**: the argument must be a binding, so `f(inout Append(ys, 1))` is
  an error (nothing to write back into) while the declaration is fine.

  **Not yet ruled**: whether the parameter discipline is wanted at all.
  The cost asymmetry that framed this question — a parameter mode keyword
  lives in full-type position and must be reserved, whereas the effect
  specifier slot is positionally isolated and can admit a label without
  ever changing the parse of an existing type string ("Grammar and AST")
  — **no longer bears on the decision: both candidate words are already
  reserved.** `mutable` and `inout` are in `RESERVED_WORDS`
  (`src/epsil/reserved-words.ts`, both marked not-in-use and pointing
  here; `var` likewise). Claiming either is therefore no longer a compat
  event, and the naming question below is a pure readability trade with
  no land-grab deadline attached. Do not re-price this.

  **Implementing the optimization — two tiers, one guarantee** *(recorded
  2026-08-09; scoping notes for the efficient-functional-update work, not
  a ruling)*. The priority ruling above leaves the semantics fixed —
  every update form is a rebinding — so all that remains is making the
  rebuild cheap. The two execution tiers should do that by **different
  mechanisms**, which is sound precisely because the optimization is
  unobservable: they owe each other the same *guarantee* (an in-place
  update fires only where no live reference can see it), not the same
  machinery. Nothing here requires a semantic split or a behavioral
  difference to test for.

  - **Interpreted tier — dynamic, via reference counts.** In-place-iff-
    unique, the `isKnownUniquelyReferenced` discipline. Note the
    *direction*: the baseline here is already persistent, so this is not
    "copy on write" but *elide the copy when unique* — opportunistic
    destructive update, the Koka/Perceus and Clean/uniqueness-typing
    lineage. Three scoping facts, each verified against the tree:
    - **Which nodes carry a counter is narrower than "collection type."**
      Most collection-typed values have no spine to mutate: probed,
      `Append([1,2],3)` stays an `Append` node with `lazy=true`,
      `Range(1,1000000)` reports `count=1000000` without materializing.
      The gate is a *runtime representation* property (materialized
      `List`/`Dictionary` spines), not a static type. Edge to state
      explicitly rather than inherit: `string` is **not** `<: collection`
      in this lattice, so a type-keyed gate silently excludes it, while
      `dictionary`, `set`, `tuple` and `matrix` all are.
    - **Only spine nodes along the mutation path need counters**, not
      elements — an update rewrites a pointer slot and leaves the element
      shared. That is what keeps the counted set small.
    - **Maintaining the count is engine-wide and type-blind.** Every
      retention site is a reference whatever its own type — bindings,
      held operands, the per-node memo fields, rule captures, the
      serializer boundary, and any parent's `_ops`. The error asymmetry
      is the invariant to build against: a missed *decrement* costs an
      optimization; a missed *increment* is silent unsoundness. Hence
      increment-on-every-store, and unaccounted provenance ⇒ shared.
      Representation note: `BoxedFunction._ops` is `private readonly`
      today, so the materialized spine changes shape before any of this
      is expressible.

  - **Compiled tier — static, no counters.** This is the *favorable* case,
    not the harder one: finding 3's "escape/alias analysis, which the
    engine has nowhere" is a statement about the boxed-expression graph,
    where retention is unbounded and invisible. A compiled artifact is a
    closed world and the compiler sees every store. Two analyses carry
    it: **last-use/liveness** (`xs = Append(xs, v)` with the old `xs` dead
    after — the dominant idiom, decidable locally, linearity recovered
    from liveness rather than declared in types) and **escape analysis**
    (does the value reach a return, a closure capture, an outer binding,
    or an unseen callee?). The call boundary is the weak spot — a callee
    cannot know whether its argument is shared — with two exits:
    monomorphize/inline (viable, since `ensureUserFunctionEmitted`
    already emits bodies per artifact, closing the callee set) or put
    uniqueness in the signature, which is the deferred parameter-mode
    discussion above. Keep the tier's existing polarity: **prove
    uniqueness or copy.** Payoff is JS/Python only — GLSL/WGSL have
    fixed-size arrays and no dynamic collections.

  - **Interaction with CSE — sequence this deliberately.** CSE
    *manufactures* the aliasing a destructive-update pass must prove
    absent: `2026-07-28-compile-cse-design.md` §5.3 binds repeated
    non-scalar subtrees so every occurrence references **one shared
    runtime object**, and its highest-value candidates are exactly the
    `PointList`/`List` spines this optimization would target. That
    design's landing gate — "no JS/interval helper mutates its input or
    relies on input identity" — is the invariant in-place update
    violates by definition. Resolution is available (run the uniqueness
    analysis after CSE and treat every CSE temp as shared by
    construction, or have CSE decline candidates a later pass wants to
    mutate) but it must be chosen, not discovered; a cross-reference is
    recorded at that §.

Rejected as effects: **`diverge`/nontermination** (handled dynamically,
`TIMEOUT-MODEL.md`; not inferable; no consumer); **GPU/target
compilability** (a capability of an operator, not an effect of applying it);
**`assert`** (v4) — it fails the admission test on every prong: a
*failing* assert produces an `Error` value, which lives in the lattice
per the `error` rejection below; a *passing* assert is pure; and no
consumer distinguishes "may assert" from "total". The underlying want —
a test harness collecting assertion reports — is a reporting
*capability* (a `ce.effects` interface), not a label;
and **`error`/partiality** — expanded below, because the reasoning is
load-bearing for planned Epsil ergonomics.

### Exploration: user-declared effect labels (2026-08-14)

*An exploration — weaker than a disposition: no shape is sanctioned, no
decision is leaned into; this records that the question was examined,
what makes it cheap, and where the actual design work lies.*

Everything above treats the label roster as closed and engine-owned.
Scala 3 makes the opposite choice at zero cost: any trait can be a
capability, so a user defines a new "effect" (`Sql`, `Audit`, …) just by
defining a type and threading it. Could Epsil let a user declare a
label — `DeclareEffect("sql")` or similar — that then participates in
specifiers, inference, bounds, and discharge like a builtin?

**Mechanically it is cheap in the lattice — with a real representation
cost outside it.** A label is a string in a ground set: propagation
(union), bounds (subset), subtyping (the one covariant line),
projection, and declared discharge would all work unchanged for a label
the engine has never heard of; the sets-not-rows economy means no
per-label machinery to instantiate. But the *implementation* is
deliberately closed at every level today — `EffectLabel` is a closed
TypeScript union, `EFFECT_LABELS` a fixed array
(`src/common/type/types.ts`, `src/common/type/effects.ts`), and the
type parsers fail closed on unknown labels — so the registration step
(gate 1 below) is where the real work lives. It must define:
declaration ordering (Epsil parses a source batch before evaluating
declarations — when does `effect file` make a later `file` specifier
parse?); parser-registry updates and their cache invalidation; the
runtime representation of an engine-local label inside `EffectSet`
values; and cross-engine serialization — what a signature naming `file`
means to an engine without the declaration (a required declaration
bundle, or the existing unknown-label hard error).

**The design work is all in the admission discipline**, three questions:

1. **The roster is fail-closed by design.** `normalizeEffectSet` throws
   on unknown labels — a guard worth keeping. User declaration therefore
   needs an explicit registration step that opens the roster
   *per-engine* (a `DeclareEffect` operator or engine API), plus a
   namespacing rule so user labels can never collide with a future
   builtin admission (e.g. a required prefix or sigil — undecided).
2. **Axes must be stated at declaration.** Consumers key on axis
   predicates, never label names ("Label kinds"), so a user label must
   carry a position on every metadata axis. For a v1 the honest move is
   to *fix* them — impurity yes, action, no frame kind, not
   handler-backed — and not expose the exotic axes at all: a user label
   with a frame protocol or a handler namespace is a much bigger
   commitment (see 3).
3. **The admission test's consumer criterion, reread for user labels.**
   Criterion 1 demands a consumer that distinguishes the label from
   generic impurity. For a user label the consumer is **the user's own
   bounds and refusals**: a marker label like `sql` or `approximate`
   whose entire job is "let a caller exclude me with a signature bound"
   is exactly what a Scala user gets from a marker capability trait,
   and it is a legitimate reading of the criterion — the label is
   taxonomy plus enforcement hooks, nothing more. That is the honest v1
   scope: **taxonomy + bounds, not handler-backed capabilities.** If a
   user also wants the handler — a `ce.effects.sql` namespace their
   operators consult, with denial and snapshot semantics — that is a
   user-extensible capability registry, a separate and larger step,
   sequenced after Stage 4 if ever.

Nothing here is scheduled; the exploration exists so that when the want
first arrives (most likely as "let me tag my functions so callers can
refuse them"), the cheap shape and its three gates are already written
down.

### `async` will be an effect, not a promise type (ruled 2026-07-29)

The symmetric ruling to the `error` rejection below, decided by the same
razor and landing on the opposite side: **what a consumer inspects goes in
the lattice; what a scheduler handles goes on the arrow.** A failure *is*
the result — consumers `match` on it and narrow around it, so it lives in
the lattice. Suspension is a *circumstance of computing*, never a result:
nothing ever inspects a pending value mathematically — the only operation
on it is waiting — so there is nothing for the lattice to represent.

Why a `promise<T>` value type is rejected outright, not merely deferred:

1. **Promise values poison the rewrite machinery.** Canonicalization,
   simplification, and pattern matching assume operands are inspectable
   *now* and cannot await. `Simplify(p + 2)` with `p` pending is
   incoherent; either every operator must exclude promise operands (an
   infection across the whole library) or evaluation auto-awaits
   everywhere (at which point the value carries no information and the
   effect has been rebuilt, expensively). Languages that tolerate
   promises-as-values never subjected their values to algebraic
   rewriting; CE does.
2. **CE already reifies "computation not yet performed" — the expression
   itself.** An unevaluated expression is a description of a pending
   computation; `Hold(expr)` is the thunk; evaluation is the await. The
   combinator use-cases that motivate promise values elsewhere are
   operators over held operands — a future `Race(Hold(a), Hold(b))` or
   `Parallel(…)` evaluates operands concurrently and **discharges**
   `async` — with zero new value kinds. A `promise<T>` would be a second,
   redundant deferred-computation representation beside the one the
   engine is built on.
3. **The effect slots into the v3 machinery without extension**: static
   rejection by sync entry points *before* evaluation (the admission-test
   consumer); per-target compile policy (GPU refuses, JS lowers to
   `async`/`await`); **discharge is `await`** — the internally-awaiting
   host wrapper that motivated position-discharge, with `evaluateAsync`
   as the outermost discharger; and caching stays sound via "pure ≙ no
   impurity label" (a promise *value* would instead pose pending-handle
   identity questions to every cache).
4. **The function-color tax is already paid.** The classic objection to
   effect-async — every caller must be annotated — is priced for
   opaque-body languages. CE's transparency means inference stamps the
   color; only opaque boundaries annotate, the same bargain every other
   label makes.

Two boundaries of the ruling, stated so it is not over-read:

- **Promises stay at the host API seam.** `evaluateAsync()` returning a
  JS `Promise<Expression>` is correct and untouched — that is where CE's
  value space meets a runtime that genuinely has promise values. The
  doctrine is promise *at the boundary*, effect *inside the lattice*,
  entry points as the meeting seam.
- **Colorless remains the status quo.** Today's engine-wide
  `evaluateAsync` is the Go/Loom model — no annotation anywhere, the
  evaluation act is async as a whole — and it stands until a genuinely
  *per-operator* asynchrony (a host-call operator, a remote solver)
  supplies the admission-test consumer. Ranking: colorless (now) → the
  `async` effect with discharge-as-await (on demand) → promise values in
  the lattice (never).

### Rejected: `error`/partiality — failure is a value, and narrowing needs it that way

1. **An effect describes what happens *while* computing; a failure is the
   result.** Effect systems track errors where errors travel a channel
   *separate* from return values — exceptions, i.e. non-local control flow
   (Koka's `exc`, Swift's `throws`, Java's checked exceptions annotate the
   bypass path). CE has no bypass channel: an `Error` expression flows
   through the ordinary compositional value path. An `error` specifier
   would track a
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
The planned Epsil refutable binding (`if let x = parse(s) { … } else
{ … }` — see the "Refutable binding" item in `docs/epsil/ROADMAP.md`)
binds `x` at type `typeOf(scrutinee) & !error` via the existing
`NegationType`, and its `else` arm knows the scrutinee is `error` — all
expressible today because failure lives in the lattice. An effect bit has
nothing to narrow; representing errors as effects would foreclose exactly
these ergonomics. Corollary ruling: Rust/Swift-style `?` propagation is
declined — it requires early-return (non-local control flow), which
Epsil's expression-`Block` model deliberately lacks; deep chains are
`match`'s job.

## What does not change

- **`WithRandomSeed`'s pending-draw walk**: whether a partially-evaluated
  body still owes draws depends on *how far evaluation got* — a runtime
  fact no static annotation sees. The walk's inputs are upgraded (it keys
  on the label-aware `effectsOf`, `frameProtocol === 'seed'`, **and**
  `readsRandomFrame` — all three participation modes), but its exception
  structure — the value-position rulings of `RANDOMNESS-MODEL.md` **§2**,
  the lazy-materialization ruling of **§6** — stands untouched; the Hold
  ruling of §2 is now *derived* from the quote-position contribution rule
  rather than special-cased, with identical observable behavior.
- **The conservative unknown-operator default** in runtime accounting
  (`?? false`) — correct where no contract exists.
- **Broadcast draw-once semantics** (`BROADCAST-MODEL.md`).
- **The estimator rulings of `derived-substreams.md`** §§2–7 — this
  document defers to them (see "Randomness shapes").

## Epsil surface

Effects ride the type literal:

```epsil
let f: (real) random -> real             // opaque declaration
integrate(f: (real) -> real, a, b) = …   // pure-callback bound, checked at call
function roll(n) random -> integer { Random(Range(1, n)) }   // checked vs body
```

Scoping of the "no new grammar" claim:

- The `let`/`const` **declaration** form and **parameter annotations** sit
  in existing full-type positions — effects genuinely ride along.
- The block-form **definition** return annotation needs real (small)
  grammar and encoding work. **Normative encoding (resolving v2's
  either/or): the full signature.** The parser builds the complete
  `FunctionSignature` — parameter types from the parameter list, arrow
  effects from the post-parameter-list specifier slot, return type from the
  ascription — and the lowering carries that signature as the literal's
  declared type (the `Typed` ascription holds the full signature type, not
  a bare return type). `desugarSignatureString()` decomposition keeps
  working for parameters/return; arrow-level effects are **preserved onto
  the constructed signature**, not discarded. Existing bare `Typed(body,
  returnType)` ascriptions remain valid (return-type-only, pure arrow).
  Examples for anonymous literals, `Assign`, block-form definitions, and
  serialization belong in the Stage 3 test suite. `serialize-epsil.ts`
  updates in lockstep so definitions round-trip.

On a definition, an effect annotation is a contract per the
definition-annotation rule (installed iff `inferred ⊆ declared`,
`incompatible-type` error value otherwise) — unlike return types, which
remain retained-not-validated for now.

**Encoding rulings (implemented 2026-08-01, Stage 3):**

- **Decomposition predicate.** A §4.2 marker (the `Typed` wrapping the
  body Block's last statement, or the authoring-form body ascription)
  decomposes as the literal's declared full signature **iff its type
  parses to a signature CARRYING an effect set** — a non-empty specifier,
  or the stated-empty `[]` that `pure` builds. A signature type
  *without* an effect set keeps today's return-type-only reading (a
  function that returns a function). **Parentheses disambiguate the
  remaining case** (ruled 2026-08-01): to ascribe an *effect-bearing
  arrow* as a RETURN type, group it —
  `function mk(x) -> ((real) random -> real) { … }`. Grouping does not
  survive parsing, so the gate is textual (`isGroupedTypeText`,
  `common/type/utils.ts`, applied by both the engine's
  `functionLiteralDeclaredSignature` and the Epsil serializer): a
  fully parenthesized marker spelling is a grouped type, never the
  literal's own contract. The ungrouped spelling declares the contract.
- **Wide-result convention** (mirrors `desugarSignatureString`): a
  declared signature whose result is `unknown`/`any` declares no return
  type — the return stays inferred — so the block form supports
  effects-only annotations (`function tick() scope { … }`, lowered with
  result `unknown`).
- **The literal's own arrow** carries `declared ∪ inferred`: equal to
  the declared set whenever the contract holds (over-declaring included),
  and a sound over-approximation when it is violated — the violation
  itself surfaces at definition install, through the same
  `EffectContractError` → `incompatible-type` channel as the
  `declare`-then-assign routes (`assignValueAsOperatorDef` hands the
  declared set to the operator-definition constructor instead of
  stripping the arrow, which sets `effectsDeclared` and runs the check).
- **The marker's argument list is a cosmetic mirror.** The literal's
  parameter operands remain the parameters-of-record; nothing reads
  parameter types out of the marker signature. The Epsil lowering
  spells them named (`(n: unknown) random -> integer`), falling back to
  positional spelling when a parameter name is not a plain identifier.
- **Math-style definitions require the arrow** — `f(x) random ->
  integer = …` is claimed, `f(x) random = 5` stays an ordinary
  expression (the specifier run is only recognized when `->` follows;
  juxtaposition would otherwise be ambiguous). The block form has no
  such ambiguity (`{` follows) and supports both specifier-with-arrow
  and specifier-only.
- `desugarSignatureString()` **preserves arrow-level effects** by
  ascribing the *full* signature string onto the body whenever the sugar
  signature carries an effect set (the body's own explicit `Typed`
  ascription still wins); the effect-free path is unchanged.
- **Anonymous contract literals serialize losslessly** (option B, ruled
  2026-08-01): a specifier-carrying anonymous literal has no lambda
  spelling, so the Epsil serializer keeps the contract as an explicit
  `Typed(body, "‹sig›")` call inside the generic `Function(…)` form —
  which re-parses to the same MathJSON. Effect-free ascriptions and
  grouped (return-type) spellings stay transparent as before. A lambda
  specifier slot (`(x) random => …`) was considered and deferred until
  authoring demand exists — the declaration form (`let f: (real) random
  -> real = …`) covers authoring today.

## Migration and sequencing

Each stage is useful without the next; per-stage pinning tests named.

- **Stage 0 — shipped (`503728ed`)**: assignment-time flag inference
  (`inferLambdaFlags`), pinned by
  `test/compute-engine/user-function-purity.test.ts`. Amended by Stage 2:
  nested-literal boundary semantics (above).
- **Stage 1 — shipped (`9c1f4128`)**: representation — effect sets in
  `src/common/type/`
  (lexer/parser/serializer/`subtype.ts`/`reduce.ts`), `BoxedType`,
  effect-aware `matches()`; `function`-primitive bound semantics; flag
  truth-table translation + derived getters + `frameProtocol` field
  split (kind-valued: `'seed'`); annotate the current `drawsRandom`
  operators — authoritative list
  by grep (currently `Random`, `RandomChoice`, `RandomPrime`,
  `RandomSample`, `RandomShuffle`; `WithRandomSeed` becomes
  discharge + `frameProtocol`) — `RandomExpression` gets
  `() entropy -> expression`; `{scope}` assigned only by the **audited
  list** (`Assign`, `Declare`, `Assume`, and whatever the audit of
  `pure: false` residuals confirms as engine-state writers — everything
  unaudited translates to `{any}`, never `{scope}`). `Integrate`/
  `NIntegrate` keep `readsRandomFrame` **unchanged** — the field is
  outside the flag migration (v5). Audit the pure container/constructor
  positions for `invokes: false` (`List`, `Tuple`, structural
  operators). The lexer carries
  the full v4 nine-label enumeration — the capability labels have no
  library carriers yet but are declarable at opaque boundaries from day
  one. Tests:
  `test/common/type/effects.test.ts` (grammar round-trip incl. every
  malformed form; subtype partial order incl. pairwise-incomparable
  singletons), extension of `user-function-purity.test.ts` (getters,
  truth-table conflicts). *Mixed-body draws (resolved, 2026-07-31)*: a
  lambda body mixing an `{any}` head (legacy `pure: false` declaration)
  with an explicit draw still infers `{any}` — the top absorbs — but the
  inference RETAINS the frame participation it positively observed in an
  internal definition bit that survives the collapse, and the derived
  `drawsRandom` reads it. Such a body therefore pins its frame, at Stage 0
  parity. `{any}` alone still never pins: only an observed draw does. The
  bit is inference-only, is never set by a declaration, and dissolves into
  Stage 2's `effectsOf` — the lattice gains no carrier for "definitely
  draws *and* unknown else".
- **Stage 2 — implemented**: contracts + runtime channel — the shared
  literal-construction seam + guard test; literal-boundary inference;
  annotated-parameter contribution; call-boundary and definition-annotation
  checks; `effectsOf` runtime computation with generation-guarded memo;
  pending-draw walk re-keyed on it (all three seed-frame modes, incl.
  `readsRandomFrame`); discharge declarations (function parameters AND
  held positions, with the may-evaluate/quote split); internal co-finite
  results for discharge-from-`any`; purity-gated currying
  pre-evaluation; dominance-based confinement analysis for `scope`
  (inference-only, per "Scope writes"); the dependency-order split
  (unresolved head → `{any}`; trusted-annotation escape) and the
  `effectsDeclared` provenance bit.
  Tests: `test/compute-engine/effects-contracts.test.ts` (inline /
  assigned / opaque `{random}` callbacks, direct and through another HOF;
  named-callback pending-draw case; incomplete-estimator frame retention
  (worked example 6); `Hold` inertness + `Release` resurfacing;
  `invokes: false` container positions; discharge incl. `WithRandomSeed`
  `{scope}`-passthrough and the ¬{random} co-finite case; overload arms
  incl. incomparable-effects tie-break; partial-application effect
  timing; confined vs escaping vs conditional-declare `Assign`
  inference; forward-reference `{any}` + trusted-annotation install),
  with depth pinned by `effects-of.test.ts` (the projection rule),
  `effects-seam.test.ts` (the construction seam),
  `effects-call-boundary.test.ts` (bounds, blast-radius enumeration),
  `effects-currying.test.ts`, `user-function-purity.test.ts` (inference,
  confinement, provenance) and `overload-resolution.test.ts` (the effect
  tie-break). The bare-slot clause of "Annotation provenance" was ruled
  2026-08-01 (the inferred-effects model, plus `pure` in the slot) and
  is pinned by the inferred-track / declared-track describes in
  `user-function-purity.test.ts` and the `pure` grammar block in
  `test/common/type/effects.test.ts`.
- **Stage 3 — Epsil (implemented 2026-08-01)**: type-literal effects in
  the parser/serializer pair; the definition-form full-signature
  encoding, per the "Encoding rulings" of "Epsil surface" (decomposition
  predicate, wide-result convention, arrow-required math form,
  declared ∪ inferred arrow). The declaration form and parameter
  annotations rode along for free (the type subparser gained the
  specifier slot in Stage 1); the new grammar is the definition-form
  specifier slot only. Tests: `test/epsil/effects.test.ts` (round-trip
  of all three surface positions, execution-route contract checks) and
  the "STAGE 3 — full-signature `Typed` markers" block of
  `test/compute-engine/effects-contracts.test.ts` (engine encoding:
  box/`ce.function`/`Assign`/`ce.assign` routes, stated-pure
  round-trip, wide-result, violation channel, sugar-string
  preservation, pure-signature-not-decomposed control).
- **Stage 4 — capabilities (on demand)**: the `ce.effects` registry
  (interfaces, fail-closed defaults, `ce.withEffects` scoped override),
  shipping with the first capability operator (`Fetch` / `Print` / file
  surfaces); `async` admission rides the first Promise-returning
  operator per "Host capabilities". Tests: handler mock round-trip (mock
  `network` → predefined responses; mock `time` → frozen clock);
  coupling-rule audit (handler-namespace usage ⊆ declared labels);
  fail-closed defaults yield error values, not throws; snapshot
  isolation (two concurrent async evaluations, one under `withEffects`,
  no bleed; restoration after throw and after promise rejection);
  `null`-denial overriding a present default; `random` kernel swap
  (`draw(seed, n)` mock → deterministic interpreted replay; compile of a
  `random`-bearing expression declines while a non-default kernel is
  installed).

**Blast-radius protocol** — two audits, per the standing snapshot policy:

- *Stage 1*: types print in errors and serialization — run the full suite,
  measure snapshot churn; bare-arrow-is-pure predicts near-zero; verify.
- *Stage 2*: new **hard errors** where behavior was silent. Enumerate every
  library operator whose parameter is a *function signature* (not the bare
  `function` primitive — which is effect-top and never rejects) and confirm
  no currently-passing impure-callback idiom breaks
  (`Map(x ↦ Random(), xs)` keeps working: `Map`'s bound is the `function`
  primitive, effect-top by definition above). **Result** (pinned by
  `effects-call-boundary.test.ts`, "blast radius"): **zero** library
  operators declare a function-*signature* parameter, so the enumeration is
  green with zero behavior change and there is no bound to enforce
  anywhere. `Product` was the last entry: its body slot is a *held
  expression* — the multiplicand of `Product(k^2, (k, 1, 10))` — not a
  function value, and it is now declared `any` exactly as `Sum`'s is, the
  two big ops describing the same role with the same shape. The bound it
  used to carry was in any case **unenforced**: `Product` is `lazy: true`,
  so the non-strict/lazy carve-out deferred the check on its held body
  indefinitely, and an impure body is accepted there today rather than
  rejected. (`Iterate` was in this enumeration until its
  callback slot was returned to the `function` primitive: its contract is
  parametric — `((integer, T) -> T, T?) -> list<T>`, the accumulator type
  being the callback's own result type — which the grammar cannot express
  without type variables, so every concrete bound rejected a legitimate
  callback shape. The general lesson, recorded in
  `collection-callback-signatures.test.ts`: a signature parameter is also a
  *domain* narrowing, checked contravariantly, and it rejects three operand
  classes the `function` primitive admits — a narrower-domain callback such
  as a named library predicate `(number) -> boolean`, a `function`-typed
  symbol, and a callback whose result type is `unknown`.)

## Resource frames — lifetime as a frame kind (disposition, 2026-08-14)

*Not a ruling — food for thought, recorded so the gap and its candidate
shape are not rediscovered from scratch.*

**The gap.** This design tracks **use** — which effects an application
performs — never **retention** — which resources a value goes on
holding. Scala 3's capture checking tracks retention, and that is how it
manages resource lifetimes statically: a file handle cannot escape
`withFile`, because any escaping value's capture set would name it.
Nothing here answers "this file handle / db connection must be released,
and nothing may use it afterward". The `fs_read`/`fs_write`/`network`
labels gate *access*; they say nothing about *lifetime*.

**The precedent already in the design.** The seed frame is a delimited
resource protocol: entry/exit with a delimiter operator, participation
declared via `frameProtocol: 'seed'`, draw accounting across the frame's
dynamic extent. `frameProtocol` is kind-valued precisely to admit
siblings (`'clock'` is already anticipated for a future `WithClock`). A
**resource frame** would be a third kind: acquire the resource at frame
entry, expose it through the snapshot-scoped `ce.effects` registry —
inheriting for free the try/finally restoration (including async), the
per-evaluation isolation, and `null`-as-denial from "Host
capabilities" — and release it at frame exit. *(Since revised — round-4
review, Theme A: resource lifecycle is **not** a `frameProtocol` kind,
and handles are **not** exposed through `ce.effects` — the registry
snapshot is immutable for a whole evaluation, which per-frame bindings
would violate. The mechanism, ruled 2026-08-15, is **scope-attached
finalization** — the `with` scope's evaluation context runs `finish`
when it is removed; the registry's semantics are the design
**precedent to imitate**, not machinery inherited. See "The mechanism"
in Appendix A.)*

**Surface: one general delimiter, not a per-resource family.** Rather
than growing `WithFile`, `WithConnection`, … as separate operators, lean
toward a single general form — a `WithFrame(resource, body)` expression
at the API/MathJSON level, and/or an Epsil statement surface
(`with … finally`, or a `try`/`finally`). Whether the release clause is
user-visible (`finally`) or implied by the frame kind is part of the
same open question. *(Since answered — Appendix A: the Epsil surface is
a `with` binding block; release is implied, via the `Resource`
protocol's `finish`.)*

**The load-bearing decision — escaped lazy values.** Lazy collections
make this the central fork, and it is genuinely new: for the seed frame,
the ruled answer (frame-escape bullet under "Projection and discharge",
2026-08-02) is that an escaping lazy body **survives** — it draws at
materialization outside the frame and re-emits `random`. A finite
resource cannot take that option: a released handle cannot serve later
reads. Two candidate policies remain:

- **Settlement**: force pending uses at frame exit — a lazy `Map` over
  the lines of a file is materialized before the handle closes.
  Preserves the escaping value's meaning; may perform unbounded work at
  the exit boundary.
- **Revocation**: the handle is invalidated at exit; any use after exit
  yields an **error value** — the same observable semantics as
  capability denial, race-free under the snapshot rules. Sound and
  cheap; the cost is that an escape fails at forcing time, not at the
  frame boundary.

**Ruled 2026-08-14 (Appendix A): revocation**, with static diagnostics
layered on top for the escapes confinement inference can already detect
(outer-scope writes, syntactic closure capture); settlement is not
chosen.

**No discharge by default.** The seed frame discharges `random` because
delimiting *contains* the effect — seeded draws are deterministic in the
seed. Delimiting a *lifetime* contains nothing: a body that read a file
still read the file, so a resource frame does **not** discharge
`fs_read`. A specific mock-backed frame (a fixture filesystem) may
discharge via the ordinary declared-discharge mechanism; that is a
property of that frame's definition, not of the kind.

**What is not proposed**: retention tracking in the type system —
capture sets, escape analysis, second-class values. Same verdict, same
reasons as "Sets, not rows": dynamic settlement/revocation at the frame
boundary buys the guarantees that matter (release always happens;
use-after-release is a diagnosable error value, never undefined
behavior) with zero additions to the lattice, the grammar, or
`subtype.ts`.

**Sequencing.** After the mutable-objects object phases
(`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B): a handle is naturally a
mutable object — identity, a close operation, `state` effects — and
per-object version counters give use-after-revocation a natural
detection channel. It also intersects Stage 4: connection-like resources
are where per-operator asynchrony (`Fetch`, the `async` label) first
appears.

## Open questions

- Resource frames: the headline questions are ruled — settlement vs
  revocation and the delimiter surface (2026-08-14: revocation + static
  diagnostics; the `with` binding block with release implied by the
  `Resource` protocol), and the tracking mechanism (2026-08-15:
  scope-attached finalization — Appendix A, "The mechanism"), as is
  the ambient form (2026-08-17: declared-ambient-symbol desugaring,
  spelling by per-declarer convention). Still open: only Appendix A's
  "To pin before implementation" list.

Resolved since v3: the `write` local/global split (v4: confinement
inference, "Scope writes"); `host` vs `entropy` (v4: `host` superseded by
the capability split — `environment` reads data, `entropy` consumes
randomness, `time` reads the clock); the syntax final form (v4, ruled
2026-07-31: the Swift specifier slot; the brace form is superseded —
"Grammar and AST"); and **dependency order** (v5, ruled 2026-07-31:
unresolved named head → `{any}`, unannotated parameters stay optimistic,
explicit annotation over an unresolved head installs as trusted — see
"Inference"). Also resolved: the **discharge surface** (2026-08-15) —
no use-site syntax, ever; discharge metadata lives on the definition
for builtins and on the `resource`-type declaration for user resources,
per Appendix A's uniform rule.


## Appendix A — Resource lifetime and user-declared effects: the `with` frame

**Status: exploration, with three rulings (2026-08-14).** This appendix
unifies the "Resource frames" disposition and the user-declared-labels
exploration ("Label admission") into one construct. The user ruled:
**(a)** the `effect` declaration fuses **both** readings — lifecycle
protocol *and* label registration; **(b)** there is **no `init`** —
acquisition is ordinary evaluation of the initializer expression (an
earlier `init(sym, …)` sketch existed to serve the ambient case, which
the frame-kind metadata below covers instead); **(c)** the escape story
is **static diagnostics where detectable, dynamic revocation as the
backstop**. Everything else here is exploratory. *(A round-4 dual spec
review was folded in on 2026-08-14. A ruling round 2026-08-15 then ratified:
the tracking
mechanism — scope-attached finalization, "The mechanism" below; `with`
as an expression; unconditional `finish` effects; the builtin-wins
namespacing policy; and the `resource` keyword. The ambient-form
declaration mechanism was reopened the same day and **ruled
2026-08-17**: the declared-ambient-symbol desugaring, spelling by
per-declarer convention (`__ambient_<label>`) — see "Ambient form".)*

### The `resource` declaration — one form, three registrations

*(Keyword ruled 2026-08-15: **`resource`**, not `effect` — the fused
declaration is specifically the lifecycle-bearing case, and the word
matches the `Resource` protocol it conforms to. `effect` stays free for
a possible future lifecycle-less marker-label route — the "Exploration:
user-declared effect labels" territory.)*

```epsil
resource file : integer {
  finish(self: Self) { fs_close(self) }
}

function file(path: string) -> file {
  fs_open(path)   // an ordinary constructor — acquisition is just evaluation
}
```

One declaration performs three registrations:

1. A **nominal type** `file` (here over `integer`) — the handle type, in
   the engine-global type registry.
2. A **user effect label** `file` in this engine's roster. The label
   *is* the type name: the global type registry supplies
   collision-freedom among user labels, and declaration rejects names
   already in the builtin roster. That resolves collisions among user
   labels and against *current* builtins. For the harder half — a
   **future** builtin admission claiming a name a user already declared
   (builtin admission is a normal minor-version event) — the policy is
   **ruled (2026-08-15): builtin wins.** The user declaration errors on
   the newer engine version with a clear diagnostic and the user
   renames; no prefix or sigil is imposed. This matches the ratified
   version-skew posture for labels (an unknown label is a hard error;
   adding a label is a visible minor-version event). Axes are fixed
   per that exploration: impure, action, no
   frame kind, not handler-backed — lifecycle is carried by the
   *type*, not by an axis (see "The mechanism" below, and "Label
   kinds").
3. Conformance to the lifecycle protocol — spelled **`Resource`**, not
   `Effect`: the protocol governs *lifetime*, and "effect" stays
   reserved for the lattice.

```epsil
protocol Resource {
  finish(self: Self)
}
```

`finish` is the protocol's only member (ruling (b): no `init`).

**Object-backed, by definition — the handle, not the payload.** A
`resource X : T` declaration is **object-backed**: the *handle* — the
value the constructor returns and `with` binds — is a nominal *object*
(per `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B: reference identity,
per-object version counters) wrapping a private payload slot of type
`T`. `T` itself may be **any type** — the `integer` above, a tuple, a
string; nothing constrains the payload. What must be an object is the
wrapper, and that is load-bearing for ruling (c): revocation marks the
wrapper dead, so every alias observes it; a value-typed handle would
leave live copies after `finish` and make revocation unsound.
Consequence, consistent with the sequencing note below: `resource`
declarations cannot ship before the mutable-objects object phases.

### The mechanism — a lifecycle dimension on scopes, not a frame kind (ruled 2026-08-15)

The "Resource frames" section proposed a third `frameProtocol` kind
exposed through `ce.effects`. Both halves are revised:

- **Not a `frameProtocol` kind.** `frameProtocol` names
  label-virtualization frames: a delimiter that changes what a
  *label's* draws or reads mean inside its dynamic extent (`seed`
  today, `clock` anticipated), with a replay-obligation protocol for
  partially-evaluated survivors. Resource lifecycle changes nothing
  about what any label means; it governs when a *value* stops being
  usable. It is a separate dimension, carried by the resource
  **type's** `Resource` conformance, consumed only by `with` — and deliberately
  not a metadata axis (see "Label kinds"). `random` and a future
  `clock` keep `frameProtocol`; resource types never have one.
- **Not the `ce.effects` registry — scopes, with a finalization
  handler** *(ruled 2026-08-15)*. The registry is an immutable snapshot
  captured once per evaluation ("Host capabilities"); per-frame
  bindings appearing and vanishing mid-evaluation would violate exactly
  that contract. Instead `with` reuses the machinery it already needs
  as a scoped binder: its scope's **evaluation context** carries an
  optional **finalization handler**, run when that context is
  removed — which *is* frame exit. No new data structure exists: the
  eval-context stack is the frame stack, finish-ordering is context
  nesting, and the ambient "current frame" is a chain walk. Three
  precisions keep this sound against the engine's known scope
  behaviors:
  1. The handler belongs to the **dynamic activation**, never to the
     lexical scope object or its bindings — escaping closures copy and
     re-root scope objects (`captureClosures`,
     `src/compute-engine/function-utils.ts`), and a copied `with`
     scope must NOT carry the finalizer, or `finish` runs twice or at
     capture time.
  2. Async is correct by construction: async evaluation already
     removes its context **by identity** (`ce._removeEvalContext`),
     not by popping the top, precisely so interleaved frames unwind
     their own context when they settle — so `finish` runs when the
     `with` evaluation settles, not at its first suspension point.
  3. Context removal is a hot path (hundreds of thousands of pops in
     a large evaluation); the finalizer must be a cheap flag test,
     adding nothing to ordinary pops.
  The registry's semantics remain the design *precedents to imitate* —
  try/finally restoration including async, per-evaluation isolation —
  not machinery inherited.
- **Mock/deny gap, named.** Builtin capabilities are mockable and
  deniable via the registry; user resource types are not
  handler-backed, so they have no equivalent. Mocking works at the
  constructor seam (shadow `file(path)` with a fixture-returning
  function — ordinary definition machinery), and denial of the
  *underlying capability* (`fs_read`/`network` → `null`) blocks
  acquisition; but there is no per-resource-type denial ("this
  evaluation may not open files, though it may read them"). Recorded as
  a follow-up gap, not designed here.

### Label emission is signature-derivable

The label is **intrinsic to the consuming callable**, and it reaches
applications only through ordinary projection. Precisely: a callable
with a parameter of resource type `file` carries `file` in its **own
effect set**, derived from the signature and never annotated
(possession of a handle parameter is derivable information):

```epsil
function read(f: file) -> string { ... }   // arrow: (file) file -> string — derived
```

Everything downstream is the standard machinery of "Projection and
discharge", with **no new application rule**: `read(f)` carries `file`
(production); `Map(read, xs)` carries it (latent, invoked);
`List(read)` does **not** (container, `invokes: false`); a quote
position contributes nothing. In particular the label is *not* derived
from an operand's type at the application site — an earlier draft's
"carries the label iff an operand's type contains the effect type"
rule would have made `List(read)` emit through a non-invoking position
and left "contains" undefined across unions and nested arrows
(round-4 review, finding 4).

The conservative over-approximation — a function that receives a handle
without using it still carries the label — is accepted, like every
other inference in this document. Callers refuse a user label with
ordinary signature bounds (`(function) pure -> …` excludes file-touching
callbacks); user labels have no handler namespace, so there is nothing
to deny at the registry.

### The `with` frame

```epsil
with f = file("~/log.txt") {
  const t = read(f)    // emits `file` (derived) and `fs_read` (builtin)
  print(t)
}                       // finish(f) runs here — on normal AND abnormal exit
```

`with` is an **expression** (Epsil's general expression-`Block` model):
its value is the block's trailing value. That choice creates the third
static escape case ruled on below — a trailing value that names the
frame binding.

Every binding a `with` introduces must be of a resource type
(diagnostic otherwise). Multiple bindings finish in **reverse declaration order**,
and an error in a later initializer still finishes the earlier bindings
(try-with-resources semantics):

```epsil
with f = file("~/log.txt"), g = file("~/out.txt") {
  // ...
}   // finish(g), then finish(f)
```

### Discharge falls out uniformly

**A frame discharges exactly the label it delimits — the resource
type's label for a `with` binding, the frame-kind label for the ambient
form — and nothing else.**

- `with f = file(…)` discharges `file` — sound because revocation
  (below) guarantees nothing outside the frame can use the handle — but
  **not** `fs_read`/`fs_write`: the body still observed the filesystem.
  This is the "No discharge by default" point of "Resource frames",
  now stated positively.
- `with random(seed)` discharges `random` — the existing
  `WithRandomSeed` behavior recovered as an instance of the general
  rule rather than a special case.

**The full projection rule for `with`** — the finalizer term is part of
it (its absence from an earlier draft was round-4 review finding 5):

```
effects(with b₁ = e₁, …, bₙ = eₙ { body }) =
    ⋃ effects(eᵢ)                                      // acquisition
  ∪ (effects(body) − {labels of the delimited types})   // discharge
  ∪ ⋃ effects(finish of each bᵢ's type)                // finalization — NEVER discharged
```

`finish` runs unconditionally, so its effects are unconditional: a
`finish` body calling `fs_close` contributes its inferred set (host
capability use, `state` on the handle) to **every** `with` over that
type, even when the body never touches the handle. The finalizer's
effect set is statically knowable at `effect`-declaration time — its
body is right there, ordinary inference applies. A `with` is pure only
when acquisition, the label-subtracted body, and every `finish` are all
pure.

This also answers the standing discharge-surface open question (closed
2026-08-15 — see "Open questions"): discharge metadata lives on the
resource-type **declaration** (for builtins, on the definition as
today), never at use sites.

### The escape story (ruling (c))

Two layers, in order of preference:

- **Static diagnostics where detectable.** A `with` binding written to
  an outer scope, captured by a syntactically escaping closure, or
  named (or structurally contained) in the block's own trailing value —
  `with f = file(…) { f }` — is a diagnostic error at the frame:

  ```epsil
  let g;
  with f = file("~/log.txt") {
    g = f              // diagnostic error: frame binding escapes
  }
  ```

  The first two cases are what confinement inference already classifies
  for `scope` writes (closure capture ⇒ escaping); the third falls out
  of `with` being an expression. This layer is a
  quality-of-diagnosis feature, not the soundness mechanism: full
  static prevention would be retention tracking, declined in "Resource
  frames", and would over-reject lazy values forced inside the frame.
- **Dynamic revocation as the backstop.** `finish` runs at frame exit
  unconditionally; the handle is then dead, and any later use — a
  leaked lazy view forced afterward, a stored handle once mutable
  objects land — yields an **error value**, the same observable
  semantics as capability denial. Settlement (forcing pending uses at
  exit) is **not** chosen. The seed frame's escape-survives ruling
  (frame-escape bullet, "Projection and discharge") is unaffected: it
  remains correct for `random` and unavailable to finite resources.

### Ambient form — frame-participating effects only

```epsil
with random(seed) {
  let r = Random()    // draws from the ambient (innermost) frame
}
```

How a label declares itself a valid head of this unnamed form was
reopened 2026-08-15 and **ruled 2026-08-17**: the
**declared-ambient-symbol desugaring**, with the symbol's spelling
left to **convention, per declarer** (no enforced sigil, no
unspellable internal symbol — the spelling decision below):

- An ambient effect's **delimiter definition declares its ambient
  symbol** (`ambientSymbol` metadata on `random`'s definition). The
  declarer forms a collision-unlikely name; the recommended pattern is
  `__ambient_<label>` (`__ambient_random`). A `#` sigil is unavailable
  in any case — it is the parse-time pragma namespace of
  `#env()`/`#navigator()`.
- `with random(seed) { … }` desugars to the **named form over that
  symbol** — `with __ambient_random = random(seed) { … }` — so the
  assignment is performed by the `with` machinery against the declared
  symbol, never by user code receiving a raw binding site.
- Frame-participating operators resolve the well-known symbol up the
  scope chain — the same "current frame is a chain walk" clause as
  "The mechanism". One lookup path serves both forms: named `with`
  binds the symbol the user wrote; ambient `with` binds the symbol the
  effect declared.

**Worked example.** The declaration side is definition metadata on the
delimiter (builtin today — no user-facing declaration form is needed
until user-defined frame kinds exist, which nothing anticipates):

```ts
// definition of the `random` delimiter (builtin):
{
  frameProtocol: 'seed',              // the frame kind, as today
  ambientSymbol: '__ambient_random',  // NEW: what the unnamed form binds
  ...
}
```

With that one field declared, the unnamed form is pure desugaring:

```epsil
with random(seed) {
  let r = Random()
}

// desugars to the named form over the DECLARED symbol:
with __ambient_random = random(seed) {
  let r = Random()   // Random() resolves __ambient_random up the scope chain
}
```

`Random()` (and every operator whose label has this frame kind) reads
`__ambient_random` from the scope chain — the innermost binding *is*
the current frame; nesting and shadowing come free from ordinary scope
rules, and the finalization mechanism, escape rules, and lookup path
are all shared with the named resource form.

**The spelling decision (ruled 2026-08-17): convention, per
declarer.** The spelling matters only because it decides who can
name — and therefore shadow — the symbol; nothing else in the design
depends on it. Three options were on the table: an unspellable
internal symbol (frame invisible to user code except through its
operators), an enforced reserved spelling (sigil or reserved prefix),
and a **convention-formed ordinary identifier — ruled**. The declarer
forms a name unlikely to collide (recommended pattern:
`__ambient_<label>`, e.g. `__ambient_random`); the engine enforces
nothing. Two consequences, accepted deliberately:

- User code **can read** the current frame explicitly
  (`__ambient_random` is an ordinary symbol) — an observation,
  harmless.
- User code **can bind over** it — and that is not a hazard but the
  point: deliberately shadowing `__ambient_random` is frame
  *interposition*, exactly what a nested `with random(…)` does. The
  convention exists to make **accidental** collision unlikely, not to
  make shadowing impossible.

A `Resource.assign(symbol, any+)` protocol member was considered for
this (2026-08-15) and set aside for four reasons, recorded so the shape
is not re-proposed cold: ambient effects do not conform to `Resource`
(no `finish`), so a `Resource` member cannot reach them; routing the
*named* form through it would re-litigate ruling (b) while erasing the
constructor's typing (`any+` at the requirement level) for a default
implementation that is trivially derivable; the requirement has no
`Self` position, so conformance dispatch has nothing to key on, and a
raw symbol in user code is the improvised-binding trap the `scoped:`
binding-site framework exists to prevent; and it only fits
initializers that are syntactically constructor calls. The declared
symbol keeps the proposal's substance — declaration-performed
binding — inside the framework.

The standing semantic constraints hold regardless: no `Resource`
conformance, no `finish`, delimiting semantics from the frame kind's
own obligation protocol, and the existing ambient behavior preserved
exactly. An explicit handle (`rnd.next`) would turn the
frame into a first-class capability value — capability threading,
itself escapable, and a second way to draw with distinct replay
accounting — so the lean is: **ambient effects stay ambient; only
genuine resources get named handles.**

### To pin before implementation

- **The exit state machine** — one specification, not scattered
  leans, because revocation's soundness depends on it: when the handle
  is marked revoked relative to `finish`; finalizer ordering and
  continuation when one errors (without an ordering rule, an erroring
  `finish` could leave later aliases usable or suppress a later
  required cleanup); error aggregation into the block's result (lean:
  the error value replaces or wraps it; remaining finishes still run);
  and the abnormal paths — error-value propagation, timeout abort,
  async cancellation (imitate the registry's
  try/finally-including-async discipline).
- A per-resource-type deny/mock surface — or ratify
  constructor-shadowing plus underlying-capability denial as the
  answer ("The mechanism", third bullet).
- The `captureClosures` interaction: a copied `with` scope must not
  carry the finalization handler ("The mechanism", precision 1) —
  needs a pin test when built.
- Box-route representation: `with` is a scoped binder and belongs on
  the `scoped:` binding-site-selector framework, never an improvised
  binding.
- Whether a parameter typed as a variant containing a resource type
  (`file | string`) makes the callable carry the label (lean: yes,
  conservative).
- Sequencing unchanged from "Resource frames": after the
  mutable-objects object phases (object backing is definitional — see
  "The `resource` declaration"); intersects Stage 4 for connection-like
  resources.
