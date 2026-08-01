# Effects Model — Effects in the Type System

**Status**: DRAFT v5 (2026-07-31). Stages 0–2 implemented; Stages 3–4
remain proposal (see "Migration and sequencing").
v5 folds in the round-3 dual review
(`docs/scratch/EFFECTS-MODEL_SPEC_REVIEW-R3.md`, 16 findings — all 16
rulings validated). Headline v5 rulings, each specified in its section:
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
v3 incorporated the round-2 review
(`docs/scratch/EFFECTS-MODEL_SPEC_REVIEW-R2.md`). Ratified decisions:
**(a)** application effects come from *projection with declared discharge*
(v3 respecifies the mechanism per review findings 2–4);
**(b′ — supersedes v2's (b))** `RandomExpression` keeps raw `Math.random()`
and is represented by the new `entropy` label — the v2 ruling to migrate it
onto the seeded stream is **withdrawn**, deferring to
`docs/plans/2026-07-28-derived-substreams.md` §7 (see "Randomness shapes");
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
materialization) and `docs/plans/2026-07-28-derived-substreams.md` (the
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
targets are judged per target symbol; any target the analysis cannot
resolve ⇒ `scope`. The explicit fallback, stated normatively: **not
provably confined ⇒ `scope`.** Consequences:

- An opaque declaration cannot prove confinement, so it declares `scope`
  conservatively — consistent with annotation-gets-the-contract.
- The rule is written against `Assign`'s write-through semantics: an
  `Assign` to a symbol with an existing outer binding mutates that outer
  binding (pushing and popping a scope does not undo it) — hence the
  dominance requirement on the `Declare`, not mere lexical containment:
  `Block(If(flag, Declare(n, 0)), Assign(n, 5))` is **not** confined
  (on the `flag`-false path the `Assign` writes through).

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
| **Impurity** | breaks referential transparency | all nine current labels (`async`, when admitted, will be the first "no") | caching, `isConstant`, the derived `pure` getter ("no impurity label present") |
| **Observation vs action** | safe to re-run — an *observation* of the outside world; re-running merely re-asks | observations: `random`, `entropy`, `time`, `environment`, `fs_read`; actions: `scope`, `fs_write`, `console`, `network` (conservatively an action — a request may write) | re-evaluation policy |
| **Frame kind** | participates in a delimiting frame protocol — the metadata names *which*, and the mode: draws (label), delimits (`frameProtocol`), or reads (`readsRandomFrame`) | `random` → `seed` draws; `WithRandomSeed` delimits; `Integrate`/`NIntegrate` read (the sole kind today) | the frame kind's obligation protocol (for `seed`: the pending-draw gate, keyed on all three modes) |
| **Handler-backed** | has a `ce.effects` namespace | the six capability labels, `entropy`, and `random` (at the draw-kernel boundary — "Host capabilities"); internal: `scope` | the registry coupling rule; evaluation-time trust policy |

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
              | "fs_write" | "network" | "random" | "scope" | "time"
                                                 // closed, versioned
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
existence — relevant to Cortex's LLM-friendliness goal. (Swift's
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
Cortex grammars). Rejected for three reasons, the first decisive:

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
today by e.g. `Map: '(collection, function) -> list'`) is
shape-unconstrained and **effect-top as a bound**: any callable of any
arity and any effect set satisfies it. It is not replaced by a variadic
signature (contravariance would reject fixed-arity callbacks). Projection
is unaffected by the looseness of the bound — it always reads the *actual*
operand's signature, so `Map(xs, pureF)` is still computed pure.

`!` and `&` are taken in the type grammar (negation, intersection); the
specifier slot is positionally isolated from both, so no collision
arises. Types travel as strings in MathJSON, so effect annotations
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
  propagation is the sound default and what gives `Map(xs, f)`
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

**1 — `Map(xs, f)` with `f` bound to an effectful function.** First, what
this is *not*: the operator's `type` handler. The **type** of
`Map(xs, f)` is `list` — unchanged whether `f` is pure or `random`.
Effects never appear in a *value* type; they live only on arrows, and an
application's result is a value — so there is nothing effect-shaped for
the `type` handler to compute, and it is unchanged by this design. The
place the effect *does* become visible in a type is one level up: the
literal `(xs) ↦ Map(xs, f)` has type `(list) random -> list` — the
application's effects, stamped onto the enclosing literal's own arrow by
the static walk. The application's effects flow through two channels, one
dynamic and one static:

- **Runtime — `effectsOf`, computed dynamically.**
  `effectsOf(Map(xs, f)) = ownEffects(Map) (= ∅) ∪ contribution(xs) ∪
  contribution(f)`. `f` is a symbol operand, so `effectsOf` resolves it
  **through its current binding** to a function value and reads that
  value's signature arrow — its latent set — *at query time*. `Map`
  declares no discharge, so the latent set is re-emitted: if `f` is
  currently bound to `(x: real) random -> real`, the application computes
  `{random}`. The generation-guarded memo is what makes "current" honest:
  reassigning `f` bumps `ce._generation` and invalidates the cached
  answer. This dynamic resolve-through-the-binding is precisely what
  closes hole 1 — today's `isPure` sees a bare symbol and stops.
- **Inference-time — the static walk.** When `Map(xs, f)` sits inside a
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
- When the function arrives as a **parameter** — `(xs, g) ↦ Map(xs, g)`
  — the signature never varies per call site: unannotated `g` infers
  optimistically pure (ruling (c)); annotated `g` contributes its
  declared bound, fixed. There is no effect variable to instantiate per
  call — the sets-not-rows trade, made deliberately. Per-call-site
  precision is recovered **at the application, not the signature**:
  projection unions the *actual* operand's latent effects into each
  application expression's effect set (default discharge: nothing), so
  the expression `Map(xs, pureF)` computes `∅` and `Map(xs, randomF)`
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
`Map(xs, h())` is then `{random}` via the latent set — which a
discharging operator *could* absorb. Same shapes, opposite channels.

**5 — a bound at the call boundary.** `integrate(f: (real) -> real, a,
b)` declares a pure-callback bound (form 1 under "Requiring absence").
`integrate((x) ↦ Random(), 0, 1)` is rejected — an `incompatible-type`
error value, with the same timing as existing argument validation.
Contrast `Map`, whose parameter is the bare `function` primitive —
effect-top by definition — so `Map(xs, (x) ↦ Random())` keeps working,
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
load-bearing for planned Cortex ergonomics.

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

## Cortex surface

Effects ride the type literal:

```cortex
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
  serialization belong in the Stage 3 test suite. `serialize-cortex.ts`
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
  `functionLiteralDeclaredSignature` and the Cortex serializer): a
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
  parameter types out of the marker signature. The Cortex lowering
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
  spelling, so the Cortex serializer keeps the contract as an explicit
  `Typed(body, "‹sig›")` call inside the generic `Function(…)` form —
  which re-parses to the same MathJSON. Effect-free ascriptions and
  grouped (return-type) spellings stay transparent as before. A lambda
  specifier slot (`(x) random |-> …`) was considered and deferred until
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
- **Stage 3 — Cortex (implemented 2026-08-01)**: type-literal effects in
  the parser/serializer pair; the definition-form full-signature
  encoding, per the "Encoding rulings" of "Cortex surface" (decomposition
  predicate, wide-result convention, arrow-required math form,
  declared ∪ inferred arrow). The declaration form and parameter
  annotations rode along for free (the type subparser gained the
  specifier slot in Stage 1); the new grammar is the definition-form
  specifier slot only. Tests: `test/cortex/effects.test.ts` (round-trip
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
  (`Map(xs, x ↦ Random())` keeps working: `Map`'s bound is the `function`
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

## Open questions

- Should discharge declarations get Cortex surface syntax, or remain
  definition-API-only (sufficient for builtins/hosts, the only foreseeable
  dischargers)? Lean: API-only until a user-level handler story exists.

Resolved since v3: the `write` local/global split (v4: confinement
inference, "Scope writes"); `host` vs `entropy` (v4: `host` superseded by
the capability split — `environment` reads data, `entropy` consumes
randomness, `time` reads the clock); the syntax final form (v4, ruled
2026-07-31: the Swift specifier slot; the brace form is superseded —
"Grammar and AST"); and **dependency order** (v5, ruled 2026-07-31:
unresolved named head → `{any}`, unannotated parameters stay optimistic,
explicit annotation over an unresolved head installs as trusted — see
"Inference").
