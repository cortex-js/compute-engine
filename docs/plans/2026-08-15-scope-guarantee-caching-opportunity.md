# Cashing in the scope guarantee — the caching opportunity the `!scope` ceiling does NOT open

**Status: assessed and CLOSED, 2026-08-15, after two rounds. The headline
proposal (opportunity A) was REFUTED by measurement; a follow-up sweep of every
remaining candidate (§ 4.6) also measured zero. Nothing here is implemented and
nothing here should be.** The scope guarantee is real, and its caching value was
already banked when it shipped — the effect arrows stamped at construction
exploit it in full. § 4A records the refutation, § 4.6 sweeps the rest, § 4.7
gives the structural reason every probe reads zero, § 4.5 records where the
measured caching waste actually is (a different axis, a different lever), and
§ 5 carries A in the "looks unlocked and is NOT" list.

Read § 4A before doing anything else with this document. The two-sentence
version: the ceiling constrains the code that PRODUCES a collection, while the
mid-drain writer that the target caches guard against is the code that CONSUMES
it — frequently host JavaScript calling `ce.assign()` between pulls, which the
ceiling does not govern at all.

It still exists so the next session can pick up the thread without re-deriving
the measurements, re-proposing approaches that are already ruled out, or
chasing the several gates that *look* like they should relax and demonstrably
do not (§ 5).

Prerequisite reading, in order: `docs/EFFECTS-MODEL.md` § "Scope writes" and
§ "Scope is opt-in" (what is guaranteed), then
`docs/plans/2026-08-09-state-event-invalidation-axes.md` (the axis machinery
this extends — especially § 7 "Ruled out"), then
`docs/plans/2026-08-02-dependency-precise-memo-invalidation.md` (the
dependency-snapshot pattern and the canary prior art).

---

## 0. Summary

The default-`!scope` ceiling (shipped in 0.110.0) established a property the
engine has never had: **code with no effect annotation cannot mutate a binding
while it evaluates.** The original text continued "Nothing exploits it yet",
and that turned out to be false — the effect arrows stamped at construction
(`effects-inference.ts`) already exploit it in full, which is why § 4.6 probe 5
finds locally-mutating function bodies reporting pure with no work left to do.

The leverage is narrower than it first appears, and aiming it at the wrong
axis wastes the session. Measured on the Epsil JSON-parser workload
(`vscode-epsil/examples/demo.epsil`, "workload C" of the invalidation round):

- The **`semantic` axis (87 bumps) and `world` axis (39 bumps) are driven
  100 % by `value-write` and `redefine`** — precisely the two event classes
  the ceiling now confines to `scope`-annotated code. In a program whose user
  code carries no `scope` annotation, **these two axes cannot move during
  evaluation at all.**
- The **`any` axis is not the opportunity *for the ceiling*.** Its 1 447 bumps
  are 92.4 % call-frame bookkeeping (`declare` 75.5 %, `scope-pop` 16.9 %) —
  name-binding and frame-teardown events that the ceiling leaves entirely
  untouched. Any plan premised on the ceiling letting `_type`/`_sgn` shed their
  generation key is wrong.
  **Amended 2026-08-15:** the original wording was "the `any` axis is not the
  opportunity", full stop, and that overreached. The ceiling cannot reach this
  traffic — but a *dependency key* can, and § 4.5 measures 99.8 % of the `type`
  cache's generation misses as provably spurious. Do not read this bullet as
  "nothing to win on `any`"; read it as "not winnable with this lever."

The original conclusion drawn from this — that **every cache keyed on
`semantic` or `world` can stop re-validating mid-evaluation** for the
unannotated majority — **is wrong, and § 4A shows why with probes.** The
re-validations in question guard against the *consumer* writing between pulls,
and the consumer is not the party the ceiling constrains.

The measured position after the refutation:

- **The `semantic`/`world` caches have no addressable waste.** A clean cold
  drain of 2 000 compiled elements escalates past the cheap version compare
  **zero** times. There is nothing there to hoist (§ 4A, probe 2).
- **The `any` axis has measured, provably-spurious waste** — the thing § 0
  originally waved away. On workload C the `type` cache takes 16 078 generation
  misses of which **16 042 (99.8 %) are wasted**: the recompute returned the
  same answer it already held. That is the metric § 8 names as the bound on
  what a finer axis could save (§ 4.5).
  **Size it before believing it (§ 4.5.1):** 99.8 % is a ratio, not a saving.
  In wall-clock it converts to a **~4.5 % ceiling** on one workload — smaller
  than that workload's run-to-run variance — so it is an architectural finding
  about invalidation being too coarse, not a performance emergency.

So there is a real inefficiency, but it is on the axis this document set out to
rule out, the ceiling is not the lever that reaches it, and it is modest.

§ 4 ranks the (now refuted) opportunities, § 4.5 records where the waste
actually is, § 4.6 sweeps every remaining ceiling-derived candidate to zero,
§ 4.7 explains why that is structural, § 5 lists what looks unlocked but is
not, § 6 withdraws the sequencing, § 7 records the traps.

---

## 1. What we may now assume — stated precisely

**The guarantee.** A named definition installed with no effect annotation is
refused if the effect walk *proves* its body writes outside itself. So an
application whose transitive call graph contains no `scope`-annotated
definition cannot, while it evaluates, change any binding that outlives it.

**Mapped onto the event taxonomy** — this is the operative form:

| Event | Can an unannotated body still emit it? |
|---|---|
| `value-write` (non-ephemeral) | **No** — an escaping `Assign` now requires `scope` |
| `redefine`, `type-write` | **No** for the escaping-assignment route |
| `assumption` | **No** — `Assume` is never confined, so it requires `scope` |
| `value-write` (ephemeral) | **Yes** — loop-index installs, `_ephemeralWriteDepth` |
| `declare` | **Yes** — per-call parameters, `let`s, auto-declares |
| `scope-pop` | **Yes** — every frame teardown |
| `inference` | **Yes** — mid-canonicalization type derivation |
| `object-store` | **Yes** — but already zero-mask, on its own precise channel |

**What is deliberately *not* guaranteed.** An optimization assuming any of the
following is unsound:

- **The guarantee is about the code you classified, not about the wall-clock
  interval it runs in.** This is the trap the rest of this document fell into,
  so it is stated first (added 2026-08-15, after § 4A). "Expression E's call
  graph is `scope`-free" licenses "E does not write". It does NOT license "no
  write happens while E is in progress" — anything that suspends and returns
  control (a generator yield, an `await`) lets unrelated code run in the gap.
  For a lazy collection the code in that gap is the *consumer*, which is a
  different program from the one you classified, and is often **host
  JavaScript** calling `ce.assign()` — outside the ceiling's reach entirely,
  since the ceiling gates named definitions installed in the language. Any
  interval claim needs a **dynamic** gate (§ 4B), never a static classification.

- **`{any}` is not a proof.** An unresolved forward-referenced head infers
  `{any}`, which contains `scope` without proving a write; the ceiling
  deliberately does not fire on it (the v5 dependency-order ruling — mutual
  recursion must install bare). A classifier must treat `any` as *unknown ⇒
  assume mutating*, and must **not** reuse the ceiling's `escapingWrite` bit,
  which answers the opposite question ("did we prove a write").
- **Anonymous literals are not gated** — no annotation surface. Their arrows
  carry `scope` honestly, which is what a classifier must read.
- **Two residual install routes remain open** (both in `ROADMAP.md`): the
  declare-WITH-value route, and a suspected builtin write-through in
  `defineFunctionClause`. Both leave the arrow honest, so an arrow-reading
  classifier is safe — one keyed on "was it refused at install" is not.
- **The runtime channel is conservative by design**: `effectsOf` contributes
  `{scope}` for *every* writer application with no binding analysis. The
  precise channel is the inference walk. Which channel the classifier consults
  is the first design decision (§ 6, Step 0).
- **`isPure` does not become truer.** `isPure` is the negation of the whole
  impurity set, and a writing body still carries `scope` and still reports
  impure. The ceiling's leverage is on *invalidation*, not on per-node purity.

---

## 2. The measurements

Measured 2026-08-15 at the 0.110.0 tree on `demo.epsil`; reproduce with the
probes in § 8.

**Bumps per axis, and what drives them:**

| Axis | Bumps | Driven by | Confined to `scope` code post-ceiling? |
|---|---:|---|---|
| `semantic` | 87 | `value-write` 48, `redefine` 39 | **Yes — 100 %** |
| `world` | 39 | `redefine` 39 | **Yes — 100 %** |
| `callable` | 818 | `declare` 458, `inference` 258, `binding-repair` 63, `redefine` 39 | No — 95 % survives |
| `any` | 1 447 | `declare` 1 092, `scope-pop` 244, `binding-repair` 63, `value-write` 48 | No — 96.7 % survives |

**Population.** 591 pure operator definitions vs 8 `scope`-carrying (the eight
are builtins: `Assign`, `Declare`, `Assume` and kin). A real program is
essentially all-pure, so the "no `scope` in the call graph" precondition holds
almost everywhere.

**Per-call cost, for context.** A steady-state call to a pure user function
emits `declare` + `scope-pop` and costs exactly one `_anyVersion` bump; ten
calls cost ten. This is the cost the ceiling does **not** address — recorded
here so nobody re-measures it hoping otherwise. All 258 `inference` events in
the workload are the `valueType` variant, already zero-mask.

**Prior art — the shape of wins available in this family** (from the
invalidation round and the Tycho items): re-keying `_effects` onto the
`callable` axis took its hit rate 53.9 % → 73.5 % and axis misses 20 539 → 19;
Tycho 181 (zero-masking clean pops) turned 872 K pops and 1.85 M wasted
recomputes into 5; Tycho 182 (dependency-precise facet memo) took one span
from 10.4 s to 31 ms. Same family of change — narrowing what an invalidation
claims to have changed — returning one to four orders of magnitude each.

---

## 3. Why the `semantic`/`world` freeze looked worth something

**Retained as the inventory it is — the cache table below is accurate and
useful — but its argument is superseded by § 4A.** The freeze is not worth
something: the re-validations catalogued here defend against the *consumer*,
and the ceiling does not confine consumers.

Caches keyed on those two axes, and what they re-validate today:

| Cache | Location | Key |
|---|---|---|
| element memo | `collection-element-memo.ts` | `worldVersion` + `memoDepsStillValid` + object deps |
| collection-facet memo (`count`/`isEmpty`/`isFinite`) | `boxed-function.ts` `_memoizedFacet` | `worldVersion` + `snapshotMemoDeps` |
| lazy-collection value memo | `boxed-function.ts` | `_lazyValueEpoch === worldVersion` (+ `any`, + scope stamp) |
| `Map` spine lowering | `library/map-lowering.ts` | `semanticVersion` + type-key fallback |
| `Map` exact-tier proof | `library/map-exact-proof.ts` | `semanticVersion` + `dynamic` + type-key |
| `Map` auto-compile | `library/map-auto-compile.ts` `validCompiled` | `semanticVersion` + `worldVersion` + tolerance + angularUnit + per-dep `_writeVersion` walk |

The re-validation is not free and it is not once-per-evaluation — it is
per-element and per-yield. Three concrete sites, quoted:

- **Element memo, walk-suspension detector** (`collection-element-memo.ts`):
  samples `_semanticVersion`/`_worldVersion` around **every yield**, sets
  `suspendedWrite`/`suspendedEpochChange`, and `commitRecordedWalk` declines
  the commit unless `depsUnmoved`. Its whole purpose is "a consumer might have
  assigned between pulls".
  **Correction (§ 4A):** the original text continued "— which, for an
  unannotated consumer, is now impossible", and that is false. The consumer of
  a lazy collection is frequently host JavaScript, which carries no annotation
  and is not subject to the ceiling; probe 3 exhibits exactly that write. It is
  also worth noting this particular sampling costs four integer comparisons per
  yield, so it was never the expense the section implies.
- **`Map` auto-compile** (`map-auto-compile.ts`): *"Every compiled invocation
  is preceded by the cheap validation (D3), so a mid-drain mutation is
  honored: the element after an interleaved reassignment sees the new
  value."* That is a `validCompiled()` call **per element**, escalating to a
  full dependency walk on any `semanticVersion` mismatch.
- **CSE callee admission** (`compilation/cse.ts`, `calleeBodyClean`): *"Fresh
  semantic purity: `body.isPure` is re-derived per level — the application
  node's own `isPure` consults the caller's INSTALLED signature, which goes
  stale one level removed (`h` calling a `k` later reassigned to draw…)."*
  The staleness it guards against is a callee **reassignment**, i.e. a
  `value-write {callable}` — now confined to annotated code.

---

## 4. Opportunities, ranked — as originally proposed, with outcomes

Ranking as written on 2026-08-15, each item now carrying what measurement did
to it: **A refuted, B zero-traffic, C surviving but unmeasured, D a
simplification only.** Nothing here should be built.

### A. Hoist per-element / per-yield re-validation to per-evaluation — **REFUTED 2026-08-15**

This was the direct cash-in. It rested on the claim:

> For a drain whose element lambda and its transitive callees are `scope`-free,
> the `semantic`/`world` axes provably cannot move during the drain.

**That claim is false.** It classifies the wrong party. The re-validation it
proposes to remove exists to catch the code that CONSUMES the collection
writing between two pulls; the classifier of § 6 Step 0 inspects the code that
PRODUCES it. Those are different pieces of code, and a `scope`-free producer
says nothing about the consumer. Worse, the consumer is routinely **host
JavaScript** — a JS loop calling `ce.assign()` while it iterates — and the
default-`!scope` ceiling governs named definitions installed *in the language*,
never the embedding host. No strengthening of the ceiling can close that route.

Four probes, all against the 0.110.0 tree:

**Probe 1 — the classifier says YES on the dangerous case.** With `k := 2` and
the element lambda `x ↦ k·x` (its body READS the outer binding `k` and writes
nothing), both the lambda and the drained application report the strongest
possible "scope-free":

| Expression | `effectsOf` | `isPure` |
|---|---|---|
| `x ↦ k·x` | `undefined` | `true` |
| `Map(f3, Range(1, 500))` | `undefined` | `true` |

**Probe 2 — where A is sound, there is no traffic.** A cold drain of 2 000
compiled elements with no consumer write: **0** `validCompiled` escalations
against 2 006 compiled hits. The `_semanticVersion` fast path never misses, so
hoisting removes nothing.

**Probe 3 — where there is traffic, A is unsound.** The same drain with the
consumer assigning an unrelated symbol between pulls: **2 005 escalations, one
per element** — and the `semantic` axis moves 500 times across a 500-element
drain. The producer is provably pure throughout (probe 1). A classifier keyed
on the producer says "skip" in precisely the case where skipping is wrong.

**Probe 4 — hoisting would break a pinned semantic.** Reassigning the
dependency `k` at element 250 of a 500-element drain is honored on the next
element today (element 251 reads `25 100 = 251 × 100`, not `502 = 251 × 2`) at
a cost of exactly one escalation and one recompile. That is the
interpreter-parity pin § 9 Q2 flags. Hoisting validation to once-per-drain on
a producer-purity YES turns element 251 back into `502`. The pin does not
survive A, and § 9 Q3 cannot rescue it: closing the two residual install routes
addresses in-language writers, while this writer is the host.

**Sizing, for the record — the ceiling on A had it been sound.** Cold drain,
2 000 elements, consumer writing per element: 2 005 escalations at **0.92 µs
each = 1.85 ms**, or **8.8 %** of a 21.06 ms drain — in a workload where the
consumer's own `ce.assign` calls cost 8.11 ms, more than four times the
escalation they provoke. Against the clean drain the addressable cost is zero.

**The element-memo half was never a cost at all.** The "per-yield
re-validation" in `elementMemoRecordingStream` is four integer comparisons
against `ce._semanticVersion` and `ce._worldVersion`
(`collection-element-memo.ts`, the post-`yield` boundary samples). Any
classifier call is more expensive than what it would replace. The genuinely
expensive parts of that mechanism — `snapshotDeps` and `depsUnmoved` — already
run once per walk, not per yield.

**And the headline workload never reaches one of the two target sites.** Twenty
runs of `demo.epsil`, the program all of § 2 is measured on, produce 0 compile
attempts, 0 compiled elements and 0 re-validations: the `Map` auto-compile path
does not execute there at all.

For completeness, had A been pursued, both mechanisms would also have had to
retain their **ephemeral** `value-write` handling: loop-index installs still
fire, and `memoDepsStillValid`'s per-dependency loop carries an explicit "do not
optimize this away" note about exactly that.

### B. Evaluation-scoped stability for the semantic/world-keyed caches — **not worth building**

Generalization of A: a `semantic`/`world`-keyed entry filled during an
evaluation stays valid for the remainder of that evaluation when no
`scope`-annotated code is reachable.

B does NOT inherit A's soundness bug, and that is worth stating precisely,
because the distinction is the whole lesson of § 4A. A "current evaluation"
boundary is **dynamic** — it asks "can an unconfined writer run between now and
the end of this evaluation?", which is a question about whatever code actually
runs, host included. A host-driven drain has no enclosing evaluation at all, so
the boundary simply never opens and the pessimistic path is kept. That is the
correct shape for any future attempt in this family: **gate on a dynamic
"nothing that can write is able to run", never on a static classification of
the producer's call graph.**

It is nonetheless not worth building, for the reason A is not: probe 2 of § 4A
measured the addressable traffic on these caches at **zero** on a clean drain.
A correct mechanism that saves nothing is still nothing.

### C. CSE per-level purity re-derivation — **premise does not match the code**

Replace `calleeBodyClean`'s per-level re-derivation with a single check when
the call graph is `scope`-free. Smaller and confined to the compile path, but
it is the compile path's most expensive purity conservatism and the motivation
is squarely a callee reassignment.

**C is not touched by the § 4A refutation** — a compile walk runs to completion
synchronously, so there is no suspension point at which a consumer, host or
otherwise, can interleave a write. The absent ingredient in A (a yield boundary
handing control back to arbitrary code) is what made A unsound, and C has none.

**But C is not an opportunity either, and the § 3 description of it is wrong.**
Corrected on inspection, round 2:

- `calleeBodyClean` is **not a mutation guard**. It is an *emission-purity*
  scan, and its gates are compilability concerns — string-`vars` symbols,
  overridden operators, caller compile handlers, unbound applications, opaque
  callable operands. Not one of them is about a write. § 3 characterised its
  motivation as "squarely a callee reassignment"; that is a
  misreading. `body.isPure` at its call site is a separate conjunct, and *that*
  is the only write-sensitive part.
- **There is no per-level re-derivation to remove.** Both `calleeBodyCleanMemo`
  (per node) and `calleeVerdictMemo` (per name) already memoize, with a
  documented provisional-verdict rule for re-entrant cycles. `isPure` is
  itself memoized behind the `callable` axis plus the scope stamp.

So C's premise — an expensive per-level purity re-derivation motivated by
possible reassignment — does not describe the code. Nothing to do.

### D. `Map` auto-compile upward-write eligibility

The gate declines a body that assigns upward to an ambient binding, deriving
that from a body walk. Post-ceiling such a body must carry `scope`, so the
gate could read the annotation instead. This is a **simplification, not a
win** — the same programs stay eligible. Worth doing only while already in
that file. Note this gate deliberately has no randomness clause any more, so
it is the one place where the existing predicate and the ceiling's predicate
coincide exactly.

---

## 4.5. Where the caching waste actually is (measured 2026-08-15)

Added after the § 4A refutation, to answer the question the refutation raises:
if not here, then where? This section is the useful residue of the round — the
opportunity is real, it is large, and **the scope guarantee is not the lever
that reaches it.**

Run `CE_CACHE_STATS=1 npx tsx docs/scratch/cache-stats-workloads.ts`. On
workload C (the Epsil JSON parser, 20 runs) the § 8 headline metric reads:

| Cache | Reads | Hit rate | Generation misses | …of which WASTED |
|---|---:|---:|---:|---:|
| `type` | 165 485 | 73.1 % | 16 078 | **16 042 (99.8 %)** |
| `effects` | 50 452 | 73.1 % | 78 | 78 (100 %) — plus **6 020 scope misses** |
| `lazyValue` | 4 140 | 67.1 % | 1 240 | 0 (0 %) |
| `collectionFacet` | 8 268 | **11.9 %** | 0 | — (7 288 of 8 268 reads are COLD) |

A *wasted* generation miss is one where the key moved, the entry was dropped,
the value was recomputed — and the recomputed value was **identical** to the
one thrown away (`src/common/cache-stats.ts` defines it, and names this exact
ratio as the bound on what a finer invalidation axis could save).

Three readings, in descending order of value:

1. **`type` is losing 16 042 provably-pointless recomputations per workload,
   and the bound on fixing it is 99.8 %.** This is on the `any` axis — the axis
   § 0 originally dismissed as "not the opportunity" because the ceiling cannot
   confine its drivers. That inference was backwards: the ceiling not being the
   lever is a fact about the *ceiling*, not about the *waste*. The drivers are
   `declare` (1 092 per run) and `scope-pop` (244) — per-call frame
   bookkeeping — and § 2's own "per-call cost, for context" paragraph already
   measured them, then filed them as out of scope.
2. **`collectionFacet` sits at an 11.9 % hit rate, and it is not an
   invalidation problem** — 7 288 of 8 268 reads are COLD, meaning the entry
   was never filled in the first place. That is a keying or instance-identity
   question, not an axis question, and it wants its own diagnosis before
   anyone proposes a fix.
3. **`effects` loses 6 020 entries to the scope-identity stamp**, versus 78 to
   the axis. The `callable` re-key already did its job (§ 2 prior art: axis
   misses 20 539 → 19, and the 78 above confirm it held); what remains is the
   `_effectsScope` stamp, a different mechanism entirely.

The prior art in § 2 is the right family for (1): re-keying `_effects` onto
`callable` took its hit rate 53.9 % → 73.5 %, Tycho 181 turned 872 K pops and
1.85 M wasted recomputes into 5, Tycho 182 took one span from 10.4 s to 31 ms.
All three narrowed *what an invalidation claims to have changed*. A dependency
key for the `type` cache is that same move. **None of it requires the scope
guarantee**, which is why this document closes rather than continues.

### 4.5.1. What 99.8 % is NOT — the wall-clock conversion

**Do not read 99.8 % as the size of a win.** It is a *ratio* — of the
invalidations that occur, almost all are pointless — and it says nothing about
whether those invalidations are expensive. Converted to time on the same
workload (`.type` getter instrumented with a depth guard so nested recursion is
counted once):

| Quantity | Measured |
|---|---:|
| Total run, `demo.epsil` × 20 | ~6 500 ms |
| Time inside type computation | 809 ms — **16.8 %** of the run |
| `type` reads | 165 436 (80 026 top-level, rest nested) |
| Generation misses as a share of all `type` misses | 16 078 of 44 555 — **36 %** |
| **Rough ceiling on a perfect dependency key** | **~292 ms ≈ 4.5 % of the run** |

Four things that estimate assumes away, all in the optimistic direction:

- it credits a **perfect, zero-cost** dependency key. Real dependency tracking
  is not free — the element memo's `snapshotDeps`/`depsUnmoved` are the
  in-repo precedent for what it costs — so the realized figure is lower;
- **cold misses are the bigger bucket** (28 477 vs 16 078) and no invalidation
  scheme touches them: nothing was cached to invalidate;
- it is **one workload**. Workloads A and B record *zero* `type` generation
  misses — the `_typeGeneration` fast path absorbs everything — so this is a
  property of the Epsil program shape, not of the engine generally;
- **run-to-run variance exceeds the projected win by an order of magnitude.**
  Seven consecutive runs: 5 822 / 5 835 / 6 437 / 6 473 / 8 003 / 8 017 /
  9 973 ms — a 64 % spread against a 4.5 % target. (That sample was taken under
  a concurrent full jest suite, load average 13–19, so it overstates the true
  noise; re-measure on a quiet machine before trusting any A/B here. It does
  not change the order-of-magnitude conclusion.)

**Honest summary: this is an architectural finding, not a performance
emergency.** The invalidation really is far coarser than it needs to be, and
99.8 % is the right number to quote for *that* claim. As an optimization it is a
sub-5 % ceiling on one workload, currently below the measurement floor, sitting
behind the `inference {valueType}` self-invalidation hazard (§ 5, § 7). Worth
doing when the type cache is on the critical path for an actual complaint;
not worth doing on the strength of the ratio alone.

Caution before anyone starts: `inference {valueType}`'s zero mask is in § 5 for
a hard reason (self-invalidation of the type system, with measured fallout),
and the `type` cache is exactly the cache that reads it. Any dependency-keying
of `type` runs straight at that hazard — see § 7's self-invalidation note,
which records three separate incidents.

---

## 4.6. The ceiling's whole surface, swept (round 2, 2026-08-15)

§ 4A refuted the document's headline proposal. This section answers the
follow-up it invites — *"fine, but then what DOES the ceiling unlock?"* — by
enumerating the remaining candidates and probing each. **All of them measure
zero, and § 4.7 explains why that is structural rather than coincidental.**

**Probe 5 — confined writes inside a function body are ALREADY cashed in.**
The lambda `x ↦ Block(Declare t, t := 2x, t)`, whose only write is to a local
declared inside its own body, reports `effectsOf = undefined`, `isPure = true`.
Installing it as a bare (unannotated) named definition is admitted, and the
application `acc(3)` also reports pure and evaluates to 6. Nothing to win:
`applicationEffects` stops at a `Function` literal and reads its stamped arrow,
and the construction seam in `effects-inference.ts` already did the confinement
analysis. The control confirms the ceiling is live — the escaping twin
`x ↦ Block(outer := x, x)` is refused at install with "the body writes outside
the function".

**Probe 6 — one genuine imprecision, in the runtime channel.** A *bare* block,
not wrapped in a lambda — `Block(Declare t, t := 5, t)` — reports
`effectsOf = ["scope"]`, `isPure = false`, even though `t` is declared inside
that same block and provably cannot escape. This is `effects-of.ts` contributing
the writer operators' `{scope}` unconditionally ("confinement analysis is
inference-only, and the runtime channel stays a sound over-approximation"). It
is a real over-approximation and it would be fixable by having the runtime
channel consult confinement the way the inference channel does.

**Probe 7 — but that imprecision costs nothing.** Instrumenting the `isPure`
getter across 5 runs of `demo.epsil` — a program dense with exactly this
pattern (`let j = i`, `sign = -1`, `j = j + 1`, `n = n + f / 10^(j - start)`):

| Measure | Result |
|---|---:|
| `isPure` consulted | 10 303 |
| verdicts FALSE | **0** |
| impure-due-to-`scope` | **0** |

Corroborated by `CE_CACHE_STATS`, where `declineStore` — the counter for "a
purity gate suppressed a cache write" — is **0 on all three workloads**. The
reason is probe 5: real mutation lives inside function bodies, which are
inference boundaries, so the bare-block shape barely occurs. Fixing probe 6
would be correct and would change no measured outcome. Do not spend the session
on it; if it is ever fixed, fix it for honesty of the channel, not for speed,
and say so.

**Probe 8 — inferring `isConstant` does not work, for A's reason.** The most
valuable thing the ceiling could plausibly buy is constness: `isConstant` is
`ops.every(isConstant) && isPure`, and a constant expression takes a
**generation-independent** cache key — it dodges the `any` bumps that § 4.5
measures as 99.8 % wasted. On workload C only 11 938 of 165 485 `type` reads
(7 %) hit a constant key, so the headroom is large. But `BoxedSymbol.isConstant`
reads `def.value.isConstant`, a **declaration flag** (`Pi` and kin), with no
inference path — and inferring it from "no `scope`-annotated code can write
this" is unsound, because `ce.assign()` from the host can write any binding at
any moment. There is no engine seal/freeze mode that would close that.

## 4.7. Why every probe reads zero — the structural reason

Six independent probes across two rounds return zero. That is not bad luck, and
recording the reason is the most useful thing this document can leave behind:

> **The ceiling constrains named definitions installed in the language. Every
> cache in the engine must additionally survive the HOST, which can write any
> binding at any instant through `ce.assign()`. So the ceiling cannot license
> any cache to stop watching for writes.**

What the ceiling *can* license is a decision about a specific, nameable piece of
code — "does THIS body write outside itself?" — and that question is already
answered, precisely and cheaply, by the effect arrow that
`effects-inference.ts` stamps at construction. Probe 5 is that mechanism
working. The ceiling's caching value was therefore banked at the moment it
shipped; there is no second dividend to collect.

Two corollaries worth keeping:

- **A future engine-seal mode would change this answer.** If an embedding could
  declare "no further host writes to these bindings", probe 8's constness
  inference becomes sound and points straight at the § 4.5 waste. That is a
  language/API design question, not a caching one, and it is the only route by
  which this document's premise could be revived.
- **Judge a proposed optimization by which PARTY it constrains, not by which
  property it proves.** Both dead ends here (opportunity A, probe 8) proved a
  true property of the producer and then applied it to an interval in which the
  host could act.

---

## 5. What looks unlocked and is NOT

Recorded so the next session does not spend a day here. Every one of these
`isPure`/impurity refusals is caused by something other than binding mutation:

- **The per-yield and per-element re-validation of the element memo and the
  `Map` auto-compile guard** — this document's own opportunity A, refuted in
  § 4A. Caused by the possibility of a write from the code CONSUMING the
  collection, which the `!scope` ceiling does not constrain (the consumer is
  often host JavaScript calling `ce.assign()` between pulls, and the ceiling
  governs only named definitions installed in the language). A producer-side
  purity classifier answers YES on exactly the cases where hoisting is wrong,
  and the clean case it answers YES on correctly has zero measured traffic.
- **`Add`/`Multiply` keeping a pure operand raw under `.N()`**
  (`library/arithmetic.ts`) — motivated by *exactness* (late rounding) and by
  a *self-referential frame binding cycle* (`t → t + 1`, Tycho item 46); the
  impure branch is motivated by the **draw-consumption contract**.
- **`_lazyCollectionMemoKey`'s purity gate**, **`_materializedAt` /
  `isDrawFreeBroadcast`**, **the element memo's partial-entry purity gate** —
  all **randomness / draw coherence** (`docs/RANDOMNESS-MODEL.md` § 6):
  `Take(RandomShuffle(xs), 2)` must not mix two shuffles.
- **`inference {valueType}`'s zero mask** — **self-invalidation of the type
  system**, amended by blast-radius evidence. Never "normalize" it.
- **The facet memo's move off `any`** — caused by declares and dirty scope
  pops from the probe cascade itself, not by writes.
- **`tryConstantFold`'s `symbolDeps` decline** — read-tracking completeness.
- **`TYPE_CACHE`'s clear-all eviction** — bounded-size management (and it has
  its own open `ROADMAP.md` entry).
- **All `declineCycle` / settled-only gates** — re-entrancy, not mutation.

---

## 6. Sequencing — WITHDRAWN

The original Steps 0–3 built a producer-side classifier ("is this application's
transitive call graph free of `scope`?") and then implemented A behind a canary.
**Do not build it.** § 4A shows the classifier answers YES on the cases where
acting on it is wrong, and the case where it is right carries no traffic. The
steps are withdrawn rather than deleted, because two of their design notes
survive the refutation and are worth keeping:

- **Step 1's discipline was correct and is what closed this document.** "Measure
  the addressable fraction before building… if the skip rate is low, or any
  divergence appears, stop." Both stopping conditions fired: the skip rate on a
  clean drain is zero and the divergence is a semantic break (probe 4). The
  shadow-simulation habit that de-risked the `callable` axis — predicted 78.0 %,
  delivered 73.5 % — is the reason this cost probes rather than a landed
  regression. **Keep doing this.**
- **Step 0's polarity rule is still right for any future effect classifier**:
  `undefined`/`[]` ⇒ provably `scope`-free; `'any'`, co-finite sets and
  unresolved heads ⇒ *unknown ⇒ assume mutating*. Note the § 4A probes also
  settle Step 0's open *channel* question, in the opposite direction to the
  guess recorded there: runtime `effectsOf` is **not** too conservative to be
  useful — it reads each callee's inference-stamped arrow rather than walking
  the body, so it returned `undefined` (provably pure) for both the lambda and
  the `Map` application. It was precise enough. Precision was never the problem;
  classifying the wrong party was.

**What to do instead:** § 4.5. The measured waste is on the `type` cache
(99.8 % of its generation misses are provably spurious), reachable by the
dependency-keying family of § 2's prior art, and not by anything in this
document. Anyone starting there should first read § 7's self-invalidation note
and § 5's entry on `inference {valueType}` — the `type` cache is the cache that
hazard is about.

---

## 7. Traps, and what is already ruled out

**Do not re-propose** (2026-08-09 plan § 7): per-scope generation counters
(wrong axis — a scope's counter dies with the scope, re-introducing the
dead-binding hazard the pop-bump exists for); push invalidation via back-refs
(nodes are ephemeral and numerous); per-node dependency recording for
`_effects` (~60 K effects reads per short workload; the escalation trigger is a
workload that hot-swaps lambdas per frame, and only for that class).

**Self-invalidation is the recurring failure mode here — three recorded
incidents.** Bumping an axis from inside a computation that reads it makes the
computation invalidate its own footing, and it surfaces as stack overflows and
inference drift, not as a clean error. See `CLAUDE.md` on
`inference{valueType}`, the `pitfall-axis-self-invalidation` note, and
Tycho 181.

**The effects memo is re-entrancy-sensitive.** `_effectsOf` deliberately avoids
the shared `cachedValue` helper: that helper stamps the generation *before*
computing, and the projection follows bindings, so a self-recursive body's
re-entrant read returned the previous generation's value as fresh. A new
generation-guarded memo that can recurse through bindings must not use bare
`cachedValue`.

**Object stores are a separate, live channel.** `object-store` advances no
axis; invalidation rides the per-object stamps in `object-deps.ts`. Anything
built here must leave that channel intact — mutable objects are precisely the
workload that cannot afford a coarse bump.

**Bound heads are shadow-immune**; by-name `any` flips affect unbound/raw heads
only. Measure snapshot blast radius before landing canonicalization or
serialization churn, and never `-u` a snapshot marked `@fixme`.

---

## 8. How to validate

**Instrumentation that already exists.** `src/common/cache-stats.ts`
(`CE_CACHE_STATS`): cache classes `sgn`, `type`, `effects`, `lazyValue`,
`elementMemo`, `collectionFacet`, `typeParse`; events including
`missGeneration`, `missGenerationWasted`, `missDependency`, `declineCycle`,
`declineStore`, `evictClear`; bump kinds `generation`, `mutationGeneration`,
`semanticEpoch`, `valueWrite`, `ephemeralValueWrite`. The headline metric for
this work is **`missGenerationWasted / missGeneration`** per class. Runner:
`docs/scratch/cache-stats-workloads.ts` (three workloads: big-op loop, slider
ticks, Epsil JSON parser). `_mapAutoCompileStats` counts `attempts`,
`revalidations`, `recompiles` — the direct measure of A's target.

**Reproducing § 2.** Wrap `ce._noteStateEvent` with a proxy that calls
`axisMaskOf(e)` and `callableAxisSelects(e)` and tallies per axis and kind,
then run `executeEpsil` over `vscode-epsil/examples/demo.epsil`. For per-call
cost, declare a pure operator, call once to reach steady state, then measure
`ce._anyVersion` across further calls.

**Canaries worth copying.** `CE_EFFECTS_PARANOID` (recompute-on-hit + throw,
latched), `CE_OBJECT_STORE_BUMPS_ANY` (force pessimism back on for bisection),
`CE_MEMO_PARANOID` (cross-check a served element memo against a live re-walk,
pure bodies only), `CE_DEBUG_DEPS` (which gate declared an instance
ineligible).

**Wall-clock.** Per-release A/B is available through the benchmarks harness's
`CE published` column (`benchmarks/README.md` § "Release baseline"). Note the
whole invalidation-axis round has **never** had a wall-clock A/B — it has been
the "natural next-release check" since 0.103.0. This work is the occasion to
establish that baseline rather than adding another unmeasured layer.

**Correctness gates.** Full suite with zero snapshot churn; the Step-2 canary
clean over all three workloads plus a real Epsil program; `npm run typecheck`;
`npx madge --circular --extensions ts src/compute-engine`. (Moot for this
document — nothing landed. Retained for whoever picks up § 4.5.)

**Reproducing § 4A.** Four probes, all read-only, no engine changes:

1. *Classifier polarity.* `ce.assign('k', 2)`; box `['Function', ['Multiply',
   'k', 'x'], 'x']`; assign it to `f3`; evaluate `['f3', ['Range', 1, 500]]`.
   Read `effectsOf(…)` (`boxed-expression/effects-of.ts`) and `.isPure` on both
   the lambda and the application — both report provably pure.
2. *Clean-drain traffic.* `_resetMapAutoCompileStats()`, drain
   `ce.box(['fc', ['Range', 1, 2000]]).evaluate().N()` with a numeric body, read
   `revalidations` — zero. Use a FRESH instance per repetition: a re-drain of
   the same instance is served by the element memo and never reaches the
   compiled path, which silently turns the measurement into a different one.
3. *Consumer-write traffic.* Same drain, with `ce.assign('accum', n++)` inside
   the `for…of` — one escalation per element, and `ce._semanticVersion` moves
   once per element.
4. *The semantic break.* Body `['Multiply', 'k', 'x']`; reassign `k` to 100 at
   element 250; element 251 must read 25 100. That is the § 9 Q2 pin.

---

## 9. Open questions — ANSWERED by measurement, 2026-08-15

All three are settled; no ruling is outstanding. Kept with their answers
because the reasoning is what a future round needs.

1. **Is this the right next investment? — No, and the sub-question it was
   really asking has flipped.** The question assumed the choice was "this
   performance play vs. the open `ROADMAP.md` correctness entries". The
   measurements removed the first option: opportunity A is unsound (§ 4A), and
   B/C/D are, respectively, zero-traffic, unmeasured-and-small, and explicitly
   "a simplification, not a win". Nothing in this document is worth doing.
   The genuinely open performance question is now § 4.5 — and note it inverts
   this document's premise: the `any` axis was dismissed in § 0 for carrying
   traffic the ceiling cannot confine, but it is precisely where the measured
   waste is (99.8 % of `type`'s generation misses are provably spurious). "The
   ceiling cannot reach it" was never a reason to think the waste was not there.

2. **How much semantic latitude does the guarantee buy? — Less than assumed,
   and the `Map` pin is the proof.** The question anticipated the right hazard
   and drew the wrong conclusion from it. It reasoned that hoisting validation
   for `scope`-free graphs preserves the "a mid-drain reassignment is honored on
   the next element" pin *because no such reassignment can occur*. Probe 3 of
   § 4A shows one occurring, with a provably `scope`-free graph, 500 times in a
   500-element drain. The reassignment comes from the consumer, not the
   producer. So: the guarantee buys **no** latitude for anything measured
   against a suspension point where control returns to arbitrary code — which
   is every per-element and per-yield mechanism in § 3. It does buy latitude
   for synchronous, non-suspending walks (which is why C survives, § 4C).

3. **Should the two residual install routes be closed first? — Not for this
   reason.** Q3 asked whether closing them would make the `Map` parity argument
   airtight. It would not, and cannot: both routes are about definitions
   installed *in the language*, whereas the writer that breaks the parity
   argument is host JavaScript calling `ce.assign()` between pulls. No amount of
   in-language tightening reaches it. The routes remain worth closing on their
   own merits — the user-facing statement of the guarantee, which is what
   `ROADMAP.md` already tracks them for — but that is a documentation-honesty
   argument, not a caching one, and it should not be sequenced as a prerequisite
   to anything here.
