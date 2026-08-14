# State Events and Invalidation Axes

**Date:** 2026-08-09 · **Status: SHIPPED** (2026-08-11, migration steps
2a→5 complete). Live results: effects hit rate 53.9% → 73.5% on the
program workload, axis-driven waste 20,539 → 19 misses, recomputes −52%
(§6). Step 4 closed as measured-no (below); step 5 applied with one
evidence-driven amendment to R5 (§9). Companion instrumentation:
`CE_CACHE_STATS` (`src/common/cache-stats.ts`), the `CE_EFFECTS_PARANOID`
canary, and the pinned dispatch table
(`test/compute-engine/state-events.test.ts`) + effects matrix
(`test/compute-engine/effects-invalidation.test.ts`).

**Step 4 — CLOSED (measured-no, 2026-08-11).** The literal-refinement
check passed (`x=3` and `x=4` both infer `integer`; widening only on kind
change), so a `type-shape` axis is *viable* — but not worth it: it would
recover ~3,553 of 21,546 workload-C misses (+3pp on an 82% hit rate,
~177 recomputes/run) while adding a def-type comparison to every value
write. Revisit trigger: a workload where `type` misses dominate the
profile.

**Revision 5 (2026-08-09):** third (convergence) review round applied — all
findings targeted revision-4 additions, none the core design. The
`updateDef` emission model is corrected (callers emit their own
`declare`/`redefine` events post-return, with failure-path parity by
construction; `updateDef` emits `binding-repair` pre-repair — revision 4's
"callers add nothing" contradicted §2 and broke declaration parity); the
open §2b `set type` row is closed by **§2c**, a full 15-caller enumeration
(twelve enclosed, three emitting a new zero-mask
`type-write{callableBefore, callableAfter}` event — including the **public
`BoxedSymbol.type` setter**, found bare today); the parity gate's
dual-track now has independent state (legacy authoritative, dispatch
writes shadow counters + an event trace, comparison at public API
boundaries, explicit cutover); the tolerated-deltas list is replaced by a
structural rule (the `:482` instance was not unique — operator declares
double-bump G on every install); the §6 R1 no-op case is split to match
§4's identity-only rule; and commit 2a is pinned to a strict
topology-preserving rename with the grep-pin's scope stated.

**Revision 4 (2026-08-09):** second dual-review round applied (findings in
`docs/scratch/2026-08-09-state-event-invalidation-axes_SPEC_REVIEW.md`).
Material changes: the inventory's closure axis is corrected — §2 now has a
second table of **zero-mask mutation sites** (semantic mutations no counter
sees today: the operator→scalar swap, `BoxedSymbol.infer`'s value branch,
`def.value.type` writes, the clean transient pop), and `redefine` carries
`{callableBefore, callableAfter}` so the axis sees callability *leaving* a
binding, not just arriving; choke-point enforcement now names the real
surface (the `ComputeEngine` forwarding setters in `index.ts`, not the
lifecycle's own accessors); step 2 is re-scoped to pure transcription — the
no-op dispatch guard and R5 both move wholly to step 5, resolving the
purity contradictions; the parity gate specifies its mechanism (dual-track:
legacy bumps kept beside dispatch for the duration of step 2, plus
per-(kind,payload) dispatch-table unit tests); the no-op guard gains
per-event-kind predicates (identity-only for value writes; redefinitions
are never no-ops by signature equality alone; suppression suppresses local
stamps too, and only when provably state-identical); §6's matrix gains the
R1-shape, operator→scalar, binding-repair, zero-mask-inference, and no-op
cases; and the §1b claims are qualified to what the probe actually checked.

**Revision 3 (2026-08-09):** four pre-implementation probes ran (§1b):
the **shadow-key simulation** measured the proposed `_effects` re-key on
real traffic — would-be hit rate **78.0%** (from 53.9%), zero divergences
from today's behavior where today recomputed (qualified in revision 4);
R1 is **resolved against the cheap classifier** (a
live repro shows effects flowing through a *list*-typed binding, so the
classifier must deep-walk composite types for signature arms); R5 is
**narrowed** (`updateDef` bumps G internally for every callable-shaped
swap — the redefine family is not G-blind after all; repro confirms
invalidation works end-to-end); and the inventory hygiene sweep closed
(§2 derivation note).

**Revision 2 (2026-08-09):** revised after a dual-reviewer spec review
(Claude + Codex). Material changes: the §2 inventory is now derived
programmatically and exhaustive (the hand-built table had missed ten sites,
including an entire mask class that bumps mutation+epoch *without*
generation); §5's axes are no longer claimed to be clean predicates over
event kinds — parity comes from a transcribed dispatch table, and predicate
cleanups are separate, measured changes; the dirty-scope-pop classification
is normalized (it was self-contradictory across §4/§5/§6);
`shadowsCallable` is now **mandatory**, not a precision option (the
"conservative staleness" argument fails for head-position projections, which
move to `'any'` — an answer the conservative order does not cover); the
canary is a dedicated smoke + soak procedure with a hard failure signal, not
"full suite under canary" (per the A5 amendment of
`docs/plans/2026-08-02-dependency-precise-memo-invalidation.md`); and the
choke point is structurally enforced (private setters + a pinning test).
The inventory work also surfaced a **latent invalidation gap in today's
code** — see R5.

## 0. Summary

Unify the engine's invalidation counters (`_generation`,
`_mutationGeneration`, `_semanticEpoch`) behind a single **state-event**
choke point on `EngineConfigurationLifecycle`. Write sites report *what
happened* (a typed event); a single dispatch table maps events to counter
advancement. Caches key on the narrowest **axis** whose coverage includes
every event that can change their answer, optionally combined with the
existing **local stamps** (per-definition `_writeVersion`, ambient-scope
identity).

First consumer of the new machinery: re-key `BoxedFunction._effects` from
`_generation` onto a new `callable` axis plus a scope-identity stamp.
Measured motivation: in a program-style workload, **100.0% of the effects
cache's generation misses were spurious** (recompute produced the identical
answer), and **89% of all generation bumps were declares and scope pops** —
events that almost never change an effects answer. The re-key has been
**dry-run on real traffic** (shadow-key simulation, §1b): would-be hit rate
78.0% vs 53.9% today, with zero divergences from today's behavior on every
read where today recomputed.

Non-goals, ruled out with reasons in §7: per-scope generation counters,
push-based invalidation, per-node dependency recording for `_effects`.

## 1. Motivation: measurements

Instrumentation: `CE_CACHE_STATS=1` (see §10). Three workloads, 2026-08-09
working tree.

**A. Big-op loop** — `\sum_{i=1}^{1000}(i^2 + x·y + x/i)`, `x,y` assigned.
2,020 generation bumps (1,000 ephemeral index writes): **zero** generation
misses on any cache. The loop builds fresh nodes per iteration; per-node
caches are consulted within one generation window (87% of `type` reads were
same-generation fast-path hits, rest cold). The feared "loop in a Sum colds
everything" cost does not materialize — the ephemeral-write carve-out plus
per-iteration node construction already won this case.

**B. Slider ticks** — 200 bindings, 100 slider-independent + 20 dependent
expressions, 100 ticks of assign + re-evaluate. 938K `type` reads, 95.3%
hits, again **zero** generation misses (all misses cold, on the fresh result
nodes each evaluation builds). Re-`evaluate()` of a parsed tree does not
re-consult per-node type/sgn caches across ticks.

**C. Epsil JSON parser** (`vscode-epsil/examples/demo.epsil`, 20 runs) — the
first workload with real generation waste, and it is stark:

| cache       | reads   | hit rate | generation misses | wasted (same answer) |
|-------------|---------|----------|-------------------|----------------------|
| `effects`   | 60,158  | 53.9%    | 20,539            | **20,539 (100.0%)**  |
| `type`      | 120,958 | 82.2%    | 3,553             | 3,545 (99.8%)        |
| `lazyValue` | 4,140   | 67.1%    | 1,240             | **0 (0.0%)**         |

The `lazyValue` row is the control: its generation gating does genuine work,
validating the dual-key design it shipped with. The `effects` row is the
target: every single generation miss was a wasted recompute. `sgn` had zero
reads in all three workloads.

**Bump attribution for C** (patched `_generation` setter, caller sampling;
27,307 bumps total):

| share | site | event |
|-------|------|-------|
| 64.6% | `engine-declarations.ts:434` | declaration (incl. per-call `let` re-declares in block bodies) |
| 24.5% | `engine-scope.ts:116` | scope pop (assumption-revert guard) |
| 4.0%  | `boxed-value-definition.ts:303` | value write (setter) |
| 4.0%  | `engine-declarations.ts:482` | declare-then-assign value store |
| 2.8%  | `boxed-expression/utils.ts:1239` | callable-swap repair (committed def swap) |
| 0.0%  | assumptions / config / inference | — |

Two consequences drive the design:

1. **Declares and pops dominate** (89%). An effects axis that excludes only
   scalar *writes* would reclaim ~8% of the bumps; the win lives in
   classifying declares and neutralizing pops.
2. **Declares are hot at runtime**, not just at parse time: `let j = i`
   inside a function body re-declares per call frame. The axis predicate
   must therefore classify declarations by payload (callable vs not), the
   same way it classifies writes — a blanket "declares bump" predicate
   degenerates to today's `_generation`.

## 1b. Pre-implementation probes (revision 3)

Four probes de-risked the design before implementation; all numbers from the
2026-08-09 working tree.

**Shadow-key simulation (the headline).** The proposed `_effects` key —
shadow `callable` counter per §5's predicate + ambient-scope identity stamp
— ran *alongside* the real `_generation` key over all three workloads,
changing no behavior. On every settled recompute, a would-be shadow hit was
checked against the freshly computed answer:

| metric | value |
|--------|-------|
| effects reads (aggregated A+B+C; A and B contribute 8) | 60,166 |
| real hits (generation key) | 32,422 (53.9%) |
| saved recomputes (shadow hit, real miss, same answer) | 14,500 |
| **divergences (shadow hit, recompute produced a different answer)** | **0** |
| would-be hit rate | **78.0%** |

**What the zero means — precisely.** Divergence was checked on every read
where the real key missed and a fresh answer existed to compare against
(the 14.5K shadow-hit/real-miss reads — exactly the behavioral delta the
re-key introduces relative to today). The ~32K real hits were served
without re-validation, and blind spots shared by *both* keys (the
zero-mask mutations of §2b) pass silently. The defensible claim is
therefore: **the re-key never behaves worse than today's key on any read
where today recomputed** — soundness relative to the current key, not
absolute. Absolute validation is the step-3 paranoid canary's job (§6),
which recomputes on every proposed-key hit.

The residual gap to 100% of the waste (14.5K of 20.5K wasted recomputes
eliminated, ~71%) comes from true `callable`-axis advances (Epsil's
function declares route through `updateDef`'s callable branch) and
ambient-scope misses. Probe caveats: the classifier was probe-grade (deep
`'->'` string test, one-level value scan) and `shadowsCallable` was not
simulated — its omission produced no divergences *in this workload*, but
the head-position argument (§5.3) still mandates it.

**R1 repro — the cheap classifier has a real hole.** With
`cbs := [x ↦ x + RandomInteger(1,6), x ↦ 2x]`, the def types as
`list<(unknown) any -> …>` and `Apply(At(cbs,1), 3)` is **impure through
`cbs`** — a binding whose writes the revision-2 classifier ("function
literal ∨ `couldBeCallable(def.type)`") classifies non-callable, since
`couldBeCallable` rejects `list`. The projection reaches the arrow through
*types only* (`hasSignatureArm` explicitly handles the union an `At` over a
callback list produces), so the classifier must match that reach: **deep
signature-arm containment over composite types** (list elements, tuple
members, dict values, unions/intersections), with the mandatory type-walk
cycle guard. R1 is resolved accordingly (§9).

**R5 repro — the redefine family is not G-blind.** `ce.assign('f', <fn>)`
over a node with cached `_type`/`_effects` invalidates correctly, because
`updateDef` itself bumps `_generation` at `utils.ts:1239` whenever the swap
result has an operator half or a function-typed value — a conditional bump
*inside* `updateDef` that the caller-site masks in §2's table don't show
(revision 2's "updateDef bumps nothing" note was wrong). Attribution of the
redefining assign: `G ← utils.ts:1239`, `M+E ← engine-declarations` caller.
The genuinely G-blind residue shrinks to: `BoxedSymbol.infer` (M+E only),
the `inScope` dirty teardown (M+E only), and non-callable `updateDef`
swaps. (Revision 3 believed no caller produced one; the round-2 review
found the **operator→scalar assignment** — `updateDef(…, {value})` over an
operator def — whose result is non-callable so the internal bump skips it.
Today the follow-up value-setter write still advances G; the design
consequence for the `callable` axis is handled in §2b/§4.) R5 is narrowed
accordingly (§9).

**Inventory hygiene.** The counters are written **only** via `+= 1` at the
§2 sites — no plain assignments, `++`, or other increments anywhere in
`src` (the lifecycle's own initializers/setters aside), no touches outside
`src/compute-engine` + `src/common`, none in tests. The §2 derivation is
closed under the grep it states.

## 2. Current mechanism, inventoried

Three global counters plus two local-stamp mechanisms:

- `_generation` (**G**) — the broadest counter; keys per-node `_sgn`,
  `_type`, `_effects`.
- `_mutationGeneration` (**M**) — semantic mutations; excludes ephemeral
  loop-index writes and clean scope pops.
- `_semanticEpoch` (**E**) — rare global events; keys the element memo and
  the lazy-collection memo (with local stamps).
- Per-definition `_writeVersion` — dependency-precise; used by the element
  memo (`collection-element-memo.ts`) with fill-time dep snapshots.
- Ambient-scope identity stamp — `_lazyValueScope` on the lazy-collection
  memo (`boxed-function.ts`).

**Derivation.** The table below is derived programmatically —
`grep -rn "_generation += 1|_mutationGeneration += 1|_semanticEpoch += 1"`
over `src/compute-engine` (excluding the lifecycle and instrumentation
files) — then classified by reading each site. It supersedes the hand-built
inventory of revision 1, which had missed ten sites. Migration step 2 pins
this list with a test that fails when a new direct counter write appears
(§8).

| site | mask today | event (§4) |
|------|-----------|------------|
| `boxed-value-definition.ts:303/309` (`set value`) | G, +M if not ephemeral | `value-write {ephemeral, callable}` |
| `engine-declarations.ts:434/455` (declare fresh symbol/operator) | G — **G×2 when the installed def is callable-shaped** (`updateDef`'s internal gate fires first: always for `:455` operator declares, when function-typed for `:434`) | `declare {callable, shadowsCallable}` |
| `engine-declarations.ts:482` (declared-signature value store; runs the value setter, then bumps G again — a collapsible double-bump, see parity note §8) | G×2 + M | `value-write {callable}` |
| `engine-declarations.ts:943` (variance settle / type-record replace on fwd-ref fulfillment) | ~~G~~ → **G+M+E** (widened by the 2026-08-11 type-statement work, post-inventory) | `config` (type-redefinition class) |
| `index.ts` type-statement rollback (~:590; NEW site, 2026-08-11 type-statement work) | G+M+E | `config` (type-redefinition class) |
| `boxed-expression/utils.ts:1239` (callable-swap repair) | G | `binding-repair` |
| `type-constructors.ts:162` (minted-constructor removal) | G | `binding-repair` |
| `engine-scope.ts:116/124-125` (`popEvalContext`) | G, +M+E if assumptions dirty | `scope-pop {assumptionsDirty}` |
| `engine-scope.ts:153-154` (`inScope` teardown, dirty only) | **M+E (no G)** | `scope-pop {assumptionsDirty: true, transient: true}` |
| `engine-assumptions.ts:413/459/499` (assume / forget) | G+M+E | `assumption` |
| `boxed-function.ts:443-447` (`BoxedFunction.infer`) | G+M+E | `inference` |
| `boxed-expression/boxed-symbol.ts:521-522` (`BoxedSymbol.infer`, signature narrowing) | **M+E (no G)** | `inference {symbolSignature: true}` |
| `boxed-expression/validate.ts:1366-8/1386-8` (matrix-inference freeze/restore) | G+M+E | `inference` |
| `engine-declarations.ts:1768/1807/1864` (assign-driven operator redefinition via `updateDef`) | **M+E (no G)** | `redefine` |
| `library/core.ts:1613/1753` (minted-constructor override via `updateDef`) | **M+E (no G)** | `redefine` |
| `sequence.ts:643` (`subscriptEvaluate` install on existing def) | **M+E (no G)** | `redefine` |
| `multi-clause.ts:684` (multi-clause def install) | **M+E (no G)** | `redefine` |
| `type-constructors.ts:851` (nominal-ctor override via `updateDef`) | **M+E (no G)** | `redefine` |
| `index.ts:664-6` (`set jit`), `index.ts:1102-4` (`set tolerance`) | G+M+E | `config` |
| `EngineConfigurationLifecycle.reset()` (precision/angularUnit path) | G+M+E | `config` |

(The masks above are the sites' **direct** writes. `updateDef`
(`boxed-expression/utils.ts`) additionally bumps G internally — at `:1239`,
conditional on the swap **result** having an operator half or a
function-typed value — so every callable-*producing* declare or
redefinition routed through it gets a G bump the caller's mask doesn't
show. Verified by repro, §1b. The gate is one-sided: a swap whose result is
non-callable skips it even when the *superseded* half was callable — the
operator→scalar assignment (§2b). The parity transcription must model
`updateDef`'s conditional bump as its own emission, not fold it into the
callers'.)

Three observations this table forces:

1. **`G` is not "all events."** `BoxedSymbol.infer` and the `inScope` dirty
   teardown advance M+E without G (the `redefine` family *appears* to as
   well, but `updateDef`'s internal conditional bump covers its
   callable-shaped swaps — §1b). The revision-1 model ("`any` = all events,
   others are filters") was wrong; parity must come from transcription, not
   from clean predicates (§5).
2. **Latent invalidation gap — narrower than revision 2 claimed (→ R5).**
   Revision 2 asserted the whole `redefine` family leaves G-keyed caches
   stale; the §1b repro refutes that for callable-*producing* redefinitions
   (`updateDef:1239` bumps G). The residue is §2b's zero-mask list:
   `BoxedSymbol.infer` (both branches), the `inScope` teardown, and the
   operator→scalar swap (whose G today comes only from the follow-up value
   write). The `callable` axis selects all of these, so the re-keyed
   `_effects` is strictly better covered than today.
3. **Same conceptual event, different masks.** `BoxedFunction.infer` bumps
   G+M+E; `BoxedSymbol.infer` bumps M+E. Whether to normalize such pairs is
   an explicit post-parity decision (R5), never a silent side effect of the
   refactor.

The maintenance problem the table demonstrates: each site hand-picks
counters, every new axis means revisiting every row, and the per-counter doc
comments are prose restatements that had already drifted (revision 1 of this
document, written from those comments plus a partial grep, missed ten rows).

### 2b. Zero-mask mutation sites (round-2 review; the corrected closure axis)

The §2 grep is closed under **existing counter writes** — necessary but not
sufficient. The event system's inventory must be closed under a different
axis: **semantic mutations any subscribed projection reads**, including
mutations that today bump *nothing*. Sites found so far (each verified in
source):

| site | today's mask | why it must emit |
|------|--------------|------------------|
| operator→scalar assignment: `updateDef(…, {value})` over an operator def (`engine-declarations.ts`, scalar branch of `assign`) | zero at the swap itself (the follow-up `_setSymbolValue` write bumps G+M) | callability **left** the binding: a cached head-position `f(…)` must refresh to `'any'` (§5.3), but the follow-up write is scalar-to-scalar — classifier-invisible — and could itself be suppressed as a same-value no-op. Emit `redefine{callableBefore: true, callableAfter: false}` from the swap. |
| `BoxedSymbol.infer`, value-definition branch: `def.value.type = inferred` (`boxed-symbol.ts` ~:489) | **zero** (the type setter bumps only the def's `_writeVersion`) | a binding can go `unknown` → effect-bearing function signature; `valueBindingEffects` reads exactly this type. Today's G key is equally blind — a shared blind spot the §1b shadow probe could not see. Emit `inference{valueType: true}`. |
| `BoxedValueDefinition.set type` in general (`boxed-value-definition.ts`) | `_writeVersion` only | a def retype can add or remove a signature arm the projection reads. All 15 callers enumerated and classified in **§2c** — two need a new `type-write` event; the rest are enclosed. |
| `inScope` teardown, clean pop (`engine-scope.ts`) | zero (only the dirty branch bumps M+E) | the `scope-pop{transient}` event of §4 exists for axis subscribers even when its parity mask is empty. |

Step 2's conversion therefore has **two** site lists: the §2 table
(transcribed masks) and this one (zero-mask emissions). The pinning test
covers both: no direct counter writes outside the choke point, and — harder
— a regression test per zero-mask site asserting the event fires (the §6
matrix pins the effects-visible ones).

### 2c. `def.value.type` writer enumeration (round-3 review; closes §2b's open row)

All 15 writers of `def.value.type` (grep `\.value\.type =`, working tree
2026-08-09), each classified by its **enclosing operation's** event — a
site is "enclosed" when the same user-visible operation already emits an
event the `callable` axis selects, so no separate emission is needed:

| site(s) | classification |
|---------|----------------|
| `assume.ts:401/459/795/1030/1034/1223` | enclosed by `assumption` (all six run inside `assume()`/`forget()`, whose event the axis selects wholesale). |
| `validate.ts:1378/1399` | enclosed by `inference` (the matrix freeze/restore rows of §2). |
| `boxed-symbol.ts:489` | is the `inference{valueType}` emission itself (§2b). |
| `boxed-symbol.ts:707` — the **public `BoxedSymbol.type` setter**, direct branch ("changing the type of a symbol") | **BARE today** (no counter advances; `_writeVersion` only) — a user can retype a binding across a signature-arm boundary (`list<sig>` → `integer`) invisibly. Emits the new **`type-write{callableBefore, callableAfter}`** event (§4), zero legacy mask. The setter's other two branches route through `updateDef` and are covered by its caller context. |
| `engine-declarations.ts:1482` | enclosed: the recursive-lambda placeholder typing inside `assign`, whose operation ends in a declare/redefine emission. |
| `engine-declarations.ts:1853` | **emits `type-write`** when arm-containment changes: the D11 adopt-value-type branch can *remove* a `function` guess before the follow-up value write classifies (the write's classifier would see scalar-to-scalar and miss the callability loss); the ordinary widen branch is arm-preserving and emits nothing. |
| `library/core.ts:1545/1704` | enclosed: the loosen-to-`function` step precedes the same statement's def install, which emits `declare`/`redefine` with `callableAfter: true`. |
| `library/core.ts:2168` | **emits `type-write`**: the auto-declare upgrade can install a declared type with no accompanying value write (a typed `let` with no initializer), leaving no other event in the operation. |

Net: **one new event kind (`type-write`), three emitting sites**, twelve
enclosed. §6 pins the public-setter route.

**2b-implementation addenda (2026-08-11):** the conversion found a FOURTH
bare route this enumeration missed — the public `BoxedSymbol.type` setter's
in-place `operator.signature` write (the §2c sweep covered `.value.type`
writers only; `operator.signature` writers are a second family). It emits
`type-write{true, true}`. The swap-shaped `type-write` emitters (see the
§4 parity-regime amendment) additionally cover: the setter's two
`updateDef` branches, `BoxedSymbol.infer`'s operator→value narrowing, the
operator→scalar assignment, and the declared-signature value-slot
reconciliation swap.

## 3. The model

**One choke point, enforced — at the right layer.** The counters have two
layers: the lifecycle's own accessors (already effectively encapsulated)
and the **forwarding `get/set _generation` / `_mutationGeneration` /
`_semanticEpoch` pair on `ComputeEngine` itself** (`index.ts:535–579`) —
the surface every §2 site actually writes through. Enforcement targets the
latter: after migration step 2, the three **setters are removed from
`IComputeEngine`/`ComputeEngine`** (the *getters* stay — cache keys read
them constantly), sites call `ce._noteStateEvent(e)` (a thin forwarder to
`EngineConfigurationLifecycle.noteStateEvent`, where the dispatch table
lives), and a pinning test asserts no direct counter writes — neither
`+= 1` forms nor setter assignments — exist outside
`engine-configuration-lifecycle.ts` (mirroring the regime-inventory pin of
the lazy-collection design). A site constructs its event locally — it
always knows what happened, and that classification is stable over time.

**One dispatch table, two regimes.**

- *Parity regime (step 2):* the table maps each (kind, payload) combination
  to exactly the legacy mask recorded in §2 — a transcription, making parity
  true by construction. **No semantic choice is exercised in this step**:
  sites that already carry a no-op skip today (the `jit` early-return, the
  big-op index-write skip, `BoxedSymbol.infer`'s `isUnknown` skip)
  transcribe as-is, and no *new* suppression is introduced. The §2b
  zero-mask emissions are added here too — they advance no legacy counter,
  so parity is unaffected; they exist for future axis subscribers.
- *Axis regime (step 3+):* **new** axes (starting with `callable`) are
  defined by predicates over event kinds — they have no legacy to match.
  Cleanups of legacy-mask inconsistencies (R5) and the rollout of the
  no-op dispatch guard (§4) are separate, individually measured diffs,
  never bundled with the refactor.

**Axes and the soundness rule.** Each axis is a monotone integer advanced by
the events its table row selects:

> An axis is valid for a cache **iff** the events that advance it include
> every event that can change what that cache's computation reads.

**Two tiers, stated explicitly.** Global axes cannot spare *instances*: any
matching event colds every subscribed cache. Instance-level precision is the
job of the existing local stamps — per-def `_writeVersion` (reads through a
pinned definition), scope identity (reads resolved by name through the
ambient chain). A cache key is: one axis (or two) + optional local stamps.
No framework is built around the tuple — the lazy-memo design round refuted
two "obvious" key simplifications with repros
(`docs/plans/2026-08-09-lazy-collection-evaluate-design.md`), so keys stay
bespoke per cache, each documenting its subscription: *axes + stamps + why
that covers its reads*.

**Costs.** Read path: unchanged — one integer compare per axis. Event path:
a handful of predicate branches per event; events are ~40× rarer than cache
reads in workload C (27K events, ~1M instrumented cache reads). Write-site
classification costs O(1) for the boolean flags (`ephemeral?`, one lookup
for `shadowsCallable?`) and **O(size of the traversed type/value
fragment)** for `callable?` (the deep signature-arm walk, §4) — still paid
per *event*, not per read: the ephemeral-write carve-out precedent, **pay
for precision at write sites (classification), never at read sites
(proof)**.

## 4. Event taxonomy

```ts
type StateEvent =
  | { kind: 'value-write'; ephemeral: boolean; callable: boolean }
  | { kind: 'declare'; callable: boolean; shadowsCallable: boolean }
  | { kind: 'binding-repair' }  // variance settle, callable-swap repair, minted-ctor removal
  | { kind: 'redefine'; callableBefore: boolean; callableAfter: boolean }
  | { kind: 'type-write'; callableBefore: boolean; callableAfter: boolean }
  | { kind: 'scope-pop'; assumptionsDirty: boolean; transient?: boolean }
  | { kind: 'assumption' }      // assume / forget
  | { kind: 'inference'; symbolSignature?: boolean; valueType?: boolean }
  | { kind: 'config' }          // precision, tolerance, angularUnit, jit, reset
```

Kinds are semantic; payload flags exist for two reasons only: axis
classification (`ephemeral`, `callable`, `shadowsCallable`,
`assumptionsDirty`, `callableBefore`/`callableAfter`) and legacy-mask
transcription in the parity regime (`transient`, `symbolSignature`,
`valueType` — the flags that distinguish same-kind sites with different
masks in §2/§2b).

**Who emits what around `updateDef`** (round-3 correction — revision 4's
"`updateDef` emits `redefine`, the callers add nothing" contradicted §2 and
broke declaration parity, since the declare paths route through `updateDef`
too):

- **Callers emit their own operation event** — `declare{callable,
  shadowsCallable}` from the declaration paths (`shadowsCallable` captured
  **before** the placeholder/binding is installed, while the ambient chain
  still shows the shadowed binding), `redefine{callableBefore,
  callableAfter}` from the redefinition paths — *after* `updateDef`
  returns, exactly where their legacy M+E/G bumps sit today. The caller
  holds both the superseded definition and the replacement, so both sides
  classify there; the operator→scalar assignment emits
  `redefine{callableBefore: true, callableAfter: false}` from its own
  branch. Failure-path parity is preserved by construction: if the repair
  inside `updateDef` throws, the caller's emission is skipped — exactly as
  the caller-side bumps are skipped today.
- **`updateDef` emits `binding-repair`** for its internal conditional bump
  (`utils.ts:1239`), pre-repair, matching §2's table row and today's
  behavior (the bump fires even when the repair then throws). It carries no
  callability payload — the `callable` axis selects `binding-repair`
  wholesale.

`type-write{callableBefore, callableAfter}` is the direct def-retype event
(zero legacy mask; the emitting sites are enumerated in §2c).
`inference{valueType}` is the zero-mask value-branch emission of §2b.

**Parity-regime amendment (2b implementation, 2026-08-11).** `redefine` is
emitted ONLY by the callers that bump M+E today — all of which install an
operator half, so `callableAfter` is true at every emitting site and the
kind's M+E mask never misfires. The **swap sites whose callers bump
nothing** — the operator→scalar assignment, the public `BoxedSymbol.type`
setter's two `updateDef` branches, and `BoxedSymbol.infer`'s
operator→value narrowing — emit **`type-write`** instead: a `redefine`
with a computed `callableAfter: true` at such a site (a `list<sig>` value
assigned over an operator, say) would advance the shadow M+E with no
legacy counterpart and trip the gate. Axis-wise the two kinds are
interchangeable (the `callable` axis selects either on the same
either-side rule); reclassifying the swaps as `redefine` — with M+E
semantics — is a step-5 normalization decision, not a transcription
choice.

Classification at the sites:

- `callable` on a write: old **or** new value is (or contains) a function
  literal, or the definition's effective type **contains a signature arm
  anywhere**. The containment test is an **exhaustive switch over the
  `Type` union** (`src/common/type/types.ts`), not an allowlist of a few
  composite kinds: signature → yes; every kind with child types (list,
  tuple, record, dictionary, set, collection/indexed-collection,
  broadcastable, union, intersection, negation, callback/reference
  arguments) → recurse; nominal references → expand one level through the
  definition with the mandatory type-walk cycle guard; any kind the switch
  does not recognize, and opaque `unknown`/`any` → **classify callable**
  (fail-conservative: dispatch). `couldBeCallable()` alone is NOT
  sufficient: it rejects `list<…>`, and the §1b R1 repro shows effects
  flowing through a list-typed binding (the projection's own
  `hasSignatureArm` reaches arrows inside unions an `At` over a callback
  list produces — the classifier must match that reach). Conservative in
  both directions of the swap.
- `callable` on a declare: the declared value/type, same test.
- `shadowsCallable` on a declare: the name currently resolves (ambient
  chain) to a callable binding — one lookup at declare time. **Mandatory**,
  not optional; see §5.3.
- `ephemeral` reads `_ephemeralWriteDepth`, exactly as the value setter does
  today. The depth counter is *context* for classification, not an event.

**No-op writes dispatch nothing** (rolled out in **step 5**, not step 2 —
see §3's regime split). An event reports a *state change*; a write that
leaves the state it describes unchanged must not dispatch — a re-inference
deriving the type the definition already has, a value write storing the
identical value. Dispatching such events colds caches for nothing, and in
repeated-canonicalization paths (inference re-derivation, provisional
repair) the same no-op can fire per pass. Precedents already in the code —
and they are per-site, which is the model: the `jit` setter early-returns
on an unchanged value, the big-op loop skips no-op index writes
(`control-structures.ts`), `BoxedSymbol.infer` skips an `unknown`
inference. Rules:

- **Per-event-kind predicates, explicitly specified.** Suppression is legal
  only under a written, field-complete equality for that kind:
  - `value-write`: **object identity** of old and new value only.
    Structural equality (`.isSame()`) is NOT sufficient — it is syntactic,
    not binding-identity (CLAUDE.md): two structurally equal expressions
    can resolve differently.
  - `inference`: the derived type equals the current type (`BoxedType`
    equality) — the existing `isUnknown` skip is a special case.
  - `redefine`: **never a no-op by signature equality alone.** A
    same-signature redefinition can change the evaluate body, own effects,
    `invokes`/`discharges` metadata, or hold behavior — all projection
    inputs. Only installing the *identical definition objects* is a no-op.
  - `config`: same-value early-return (the existing `jit` pattern).
  - When equality is not cheaply decidable for a kind: dispatch. A spurious
    event is a lost optimization; a suppressed real event is a stale cache.
- **Suppression is total or absent.** A suppressed write advances *nothing*
  — no global axis and no local stamp (`_writeVersion` included): the
  legality condition is precisely that the state is identical, in which
  case dependency-precise consumers (the element memo) must not refill
  either. If the state changed at all, the event dispatches and every
  stamp advances. There is no middle state.
- **Verification:** §6 gains the acceptance cases (identity re-write →
  no dispatch, hit; same-signature/different-body redefine → dispatch,
  miss). Each suppression lands as its own post-parity commit with the
  suite run against it (§8 step 5) — never folded into the step-2 site
  conversion, whose gate needs no tolerance for it.

**Scope-pop normalization** (fixing the revision-1 contradiction): there is
exactly one pop event per pop, `scope-pop {assumptionsDirty}`. Its parity
mask is conditional (G always for `popEvalContext`; +M+E when dirty; the
`inScope` teardown is the `transient` variant, M+E-when-dirty only). Dirty
pops do **not** additionally emit an `assumption` event — instead, every
axis that must see assumption reverts (including `callable`, §5) selects
`scope-pop{assumptionsDirty: true}` in its predicate. One event, counted
once, on every axis that cares.

**AMENDMENT 2026-08-14 (Tycho item 181, clean-bracket pops):** the
"G always for `popEvalContext`" half above is now conditional on a
cleanliness proof. Each eval context records ALL THREE axis versions at
push (`_anyVersionAtPush`/`_semanticVersionAtPush`/`_worldVersionAtPush`);
if at pop none has advanced AND the context's assumptions are clean, the
pop is emitted as `scope-pop {clean: true}`, whose mask is zero on `any`
(dirty pops are unaffected — assume/forget advance the axes, so a dirty
context can never prove cleanliness). Rationale: the G-bump exists to
retire answers computed under interior writes/declares/redefines/
assumption changes, and every such interior change advances at least one
axis itself when it happens — so a bracket that advanced none has nothing
to retire, exactly the argument that already made clean `transient` pops
zero-mask under R5. All three axes must be in the proof, not `any` alone:
`redefine` advances `semantic`+`world` without `any`, yet a scoped
operator redefinition ends the local operator's visibility at the pop, so
an `any`-keyed cache filled inside the bracket (the operator-name pool)
must not survive it (dual-review finding, 2026-08-14). Corollary: every
zero-mask row in §4's table (`redefine {callableAfter: false}`,
`inference {valueType}`, clean transient pops) is now a CORRECTNESS
precondition of the proof — such an event must be genuinely unobservable
to version-keyed caches across a scope boundary, or atomically paired
with an axis-advancing companion event. Without this, the push/pop-per-probe
reads of lazy collections (`Comprehension` count/finiteness scans,
`Filter` emptiness walks) invalidated the `_type`/`_sgn` caches the
enclosing type derivation was filling: canonically boxing one row that
references a comprehension-bound name emitted 872K clean pops and 1.85M
type recomputes (measured 100% wasted — identical results), ~7–17 s for
the box and ~60–170 s for the first `.type` read. With the amendment the
same pipeline is ~50 ms. Pinned by the `scope-pop (proven clean bracket)`
row in `state-events.test.ts` and the version-advance budget in
`test/compute-engine/tycho-item-181-comprehension-boxing.test.ts`.

## 5. Axes

**Existing three: defined by transcription, not by predicate.** Revision 1
restated `G`/`M`/`E` as clean predicates over kinds and claimed bit-for-bit
parity; §2's table falsifies that (declares are G-only, `redefine` is
M+E-only, `inference` has two masks). In the parity regime the three legacy
counters are defined as *whatever §2's table says, transcribed row by row*.
Clean restatements of the legacy axes are a possible **later** cleanup,
taken axis-by-axis with measurement and its own review (R5) — explicitly not
part of this design's deliverables.

**New axis `callable`** (first consumer: `_effects`, §6). Selected events:

```
assumption
inference                              (all variants, incl. the zero-mask valueType)
redefine{callableBefore OR callableAfter}
type-write{callableBefore OR callableAfter}
binding-repair
config
scope-pop{assumptionsDirty}            (either variant)
value-write{callable}
declare{callable OR shadowsCallable}
```

Not selected: `value-write{!callable}` (scalar assigns — the slider case),
`declare{!callable && !shadowsCallable}` (the per-call `let j = i` class —
64.6% of workload C's bumps), `scope-pop{clean}` (24.5%; neutralized by the
scope stamp instead, §6).

Soundness argument, against the effects projection as implemented
(`effects-of.ts` — write-free, resolves **by name** through
`ce.lookupDefinition`):

1. **Operator/signature semantics** (own effects, discharge metadata,
   arrows, multi-clause rows) — changed only by `assumption | inference |
   redefine | binding-repair | config` — all selected. This is *stronger*
   than today where today is blind: the zero-mask mutations of §2b
   (`BoxedSymbol.infer` both branches, the operator→scalar swap's
   callability loss) advance no G, so today's G-keyed `_effects` misses
   them; the axis selects them all.
2. **Values the projection dereferences** — it only extracts effects from
   *callable-shaped* bindings (`valueBindingEffects`, `latentEffectsOf`); a
   scalar binding contributes nothing. A write is relevant iff old or new
   value is callable-shaped — covered by `value-write{callable}`.
3. **Name resolution.** A declare can change what a name resolves to. Three
   sub-cases:
   - declaring a **callable** where the name was unbound flips an
     optimistic "contributes nothing" answer — covered by
     `declare{callable}`;
   - declaring a **non-callable that shadows a callable**: for an *operand*
     position the answer moves toward pure and a stale entry merely
     over-reports; but for a **head** position the projection moves to
     `'any'` (`operatorDefinitionOf` finds nothing, `valueHeadEffects`
     reports not-callable → fail-closed `{any}`), and **`'any'` is not
     comparable in the conservative order** — serving a stale `{random}`
     asserts the absence of every other label, an assertion no longer
     justified. Hence `declare{shadowsCallable}` is **mandatory**
     (revision-1's R2 "precision option" framing was wrong);
   - all other declares cannot change any effects answer and do not bump.
4. **Scope pops** — clean pops are handled by the scope-identity **stamp**
   (§6); assumption-dirty pops are selected via
   `scope-pop{assumptionsDirty}` directly (§4 normalization).

**Deferred axis** (measure after effects lands):

- **`type-shape`** (for `_type`): the `callable`-style world events plus
  writes that changed the definition's *effective type* (compare `def.type`
  before/after at the setter). Blocked on an empirical check: if the boxed
  types of `3` and `4` differ (value-refined literals), the predicate
  degenerates to "every write" and the axis is worthless. `type`'s wasted
  volume is also 6× smaller than effects' and its `_typeGeneration` fast
  path absorbs most reads.

**Explicit non-subscriber:** `sgn` stays on `G`. It reads numeric values
resolved by name; the broadest axis is its *correct* subscription. This
becomes a documented decision instead of a default.

## 6. Re-keying `_effects`

New key: **`callable` axis equality + ambient-scope identity stamp**
(`engine.context?.lexicalScope` at fill time, identity-compared on read —
the `_lazyValueScope` mechanics and argument, verbatim: re-pushing the same
scope object restores the same bindings, so an identity hit is correct; a
genuinely different chain misses).

Everything else about `_effectsOf` is untouched: the cycle-safe
stamp-after-compute order, the provisional-read gate, `'any'` on re-entry.

**Why clean pops can leave the key** — the pop-bump on G exists to kill
answers computed under a popped scope's *assumptions* and to prevent
dead-binding serves. For effects: assumption-dirty pops are selected by the
axis directly (§4/§5); for dead bindings, the re-run projection would
re-resolve by name under the *current* ambient chain, which the scope stamp
distinguishes by identity. The stamp is therefore also a soundness *repair*:
today's `_effects` has no scope stamp and relies on declare/pop G-bumps to
approximate ambient-chain sensitivity — the same latent-hole shape
`_lazyValueScope` was added to fix for the lazy memo.

**Verification — canary with a hard failure signal.** The revision-1 plan
("run the full suite under a `console.assert` canary") fails on two counts
recorded by prior art: `console.assert` only logs, giving no automatable
go/no-go signal, and the A5 amendment of
`docs/plans/2026-08-02-dependency-precise-memo-invalidation.md` records that
a re-evaluate-on-hit canary makes count-asserting suites fail *by
construction* — the paranoid mode is for smoke + soak, not the full suite.
Replaced with:

1. **Deterministic classifier tests** (ordinary, non-canary): one per
   transition, asserting both the refreshed `.effects`/`isPure` value and
   the expected hit-or-miss —
   callable→scalar write · scalar→callable write · callable declare over
   unbound · non-callable declare shadowing a callable, **head** position
   (expect refreshed `'any'`) · same, operand position · clean pop +
   re-pushed same scope (expect hit) · pop to a different chain (expect
   miss) · dirty pop (expect miss) · `redefine`-family operator swap (expect
   miss — the R5 gap, pinned as fixed for effects) ·
   **operator→scalar assignment** (expect miss + refreshed `'any'` at head
   position — the §2b swap, including the variant where the follow-up
   value write is same-value) · **R1 shape**: write to a list-typed binding
   holding callables changing one element's arrow (expect miss) ·
   re-assigning the **exact same collection object** (expect no dispatch +
   hit once the step-5 no-op guard lands; dispatch + miss before it) · a
   **distinct** collection object with identical elements (expect dispatch
   + miss always — §4's identity-only rule; structural equality never
   suppresses) · **`type-write` via the public setter**: retype a binding
   across a signature-arm boundary with `symbol.type = …` (the §2c bare
   route; expect miss + refreshed answer) · **zero-mask inference**: cache
   effects while a binding is unknown-typed, infer an effect-bearing
   signature onto it (expect miss + refreshed answer) · a `binding-repair`
   transition distinct from `redefine` (minted-constructor removal, expect
   miss) · config change · inference on a consulted signature · **no-op
   pair** (step 5): identity re-write of the same value object (expect no
   dispatch, hit) vs. same-signature/different-body redefine (expect
   dispatch, miss).
2. **Canary smoke + soak** (`CE_EFFECTS_PARANOID`, own flag): on every
   new-key hit, recompute and compare; on divergence **throw** (or increment
   a counter asserted in suite teardown — either way a hard failure, not a
   log line). Run a dedicated smoke suite plus the three workloads and the
   Epsil examples under it. Re-entrancy latch per the element-memo canary.
3. Only after 1–2 pass: delete the old G key, re-measure A/B/C with
   `CE_CACHE_STATS`, and record before/after here.

**STEP 3 SHIPPED (2026-08-11) — measured live results, workload C:**

| workload C, effects cache | BEFORE step 3 (old `_generation` key) | AFTER step 3 (`callable` axis + scope stamp) |
|--------|--------------------------|------------------------------|
| effects reads | 60,158 | 49,918 (hits avoid child re-reads — the win compounds) |
| hit rate | 53.9% | **73.5%** |
| axis-driven misses (all same-answer recomputes) | 20,539 | **19** |
| total settled recomputes | ≈27,740 | 13,240 (−52%) |

The axis waste is eliminated to within noise (20,539 → 19, 99.9% — better
than the shadow simulation's 71% projection, which measured against the
old, larger read stream). Residual misses: 7,201 colds (unavoidable) and
6,020 scope-stamp misses (ambient-chain changes — the price of by-name
soundness). Validation: the full suite ran green under
`CE_EFFECTS_PARANOID=1` (recompute-on-every-hit, throw-on-divergence) with
**zero stale serves**, plus the three workloads and the Epsil examples
under the canary; the §6 matrix below is implemented as
`test/compute-engine/effects-invalidation.test.ts` (17 tests). One §5.3
refinement discovered by the matrix: a **bound** head resolves through its
pinned definition, so a shadowing declare (correctly) does not change a
bound application's effects — the by-name `'any'` flip applies to unbound
(held/raw) heads, which is exactly `operatorDefinitionOf`'s documented
fallback; `shadowsCallable` remains necessary for those.

**Pre-implementation estimate** (shadow-key simulation, §1b): would-be hit
rate 78.0% (from 53.9%); zero divergences from today's behavior on every
read where today recomputed. The residual is
true callable-axis advances (Epsil's function declares) plus scope misses —
not reclaimable without per-instance precision (§7). The projection is one
of the pricier per-node facts (resolves overloads, forces stored arrows),
so this is wall-clock, not vanity; the step-3 implementation should
reproduce or beat these numbers with the real classifier.

## 7. Ruled out (with reasons)

- **Per-scope generation counters** — wrong axis. Writes are per-binding,
  reads resolve through a chain: validation becomes O(chain) per read or
  rebuilds dependency tracking coarser than `_writeVersion`; a scope's
  counter dies with the scope (re-introducing the dead-binding hazard the
  pop-bump exists for); and the motivating loop case is already won by the
  ephemeral carve-out (workloads A/B: zero generation misses).
- **Push invalidation** (defs hold back-refs to dependent caches) — nodes
  are ephemeral and numerous; back-ref bookkeeping and weak-ref churn cost
  more than the recomputes; pull + stamps is the house model.
- **Per-node dependency recording for `_effects`** — the element memo
  affords dep snapshots because instances are few and recomputes expensive;
  effects reads are ~60K per short workload across every application node.
  Escalation trigger, should it ever fire: a workload class that hot-swaps
  lambdas per frame (frequent `callable` events would cold everything
  again); only then, and only for that class.

## 8. Migration plan

1. **Attribution & inventory** — done, revision 2 (§1, §2; programmatic
   derivation). Remains open until the pinning test of step 2 exists.
2. **Choke point, parity-gated.** Two commits: **(2a)** the axis rename per
   R4 — a strict **field-for-field rename preserving today's topology**
   (engine forwarding accessors stay forwarding accessors, lifecycle fields
   stay flat fields): `_generation` → `_anyVersion`, `_mutationGeneration`
   → `_semanticVersion`, `_semanticEpoch` → `_worldVersion` (and the
   lifecycle accessors likewise); behavior-free, suite-green,
   `IComputeEngine`/`types-engine.ts` updated in the same commit. The
   old-spelling pin covers **TypeScript identifiers under `src/` only** —
   comments are updated best-effort; this plan, `docs/`, and the
   `cache-stats` metric names are exempt. Any `_axes.{…}` record refactor
   is a separate post-parity commit, not 2a. Then
   **(2b)** add `StateEvent` + `noteStateEvent()`
   with the dispatch table transcribed from §2 (parity regime); convert
   every site in **both** lists — §2's mask table and §2b's zero-mask
   emissions. Then (a) remove the forwarding counter *setters* from
   `ComputeEngine` (`index.ts:535–579` — the surface sites actually write
   through; the getters stay for cache-key reads), routing sites through
   `ce._noteStateEvent(e)`; and (b) add the pinning test: no direct
   counter writes — `+= 1` or setter assignment — outside
   `engine-configuration-lifecycle.ts` (this is what closes §2's
   "hand-picked counters" failure mode structurally, and what finally
   marks step 1 done).
   **Parity gate — mechanism specified.** Two layers:
   - *Per-row unit tests:* one test per (kind, payload) combination in the
     dispatch table asserting exactly the §2 legacy mask — this is what
     catches a misclassified emission that an operation-level check would
     mask behind another event advancing the same counter.
   - *Dual-track run — with independent state:* during 2b the legacy
     `+= 1` lines remain **authoritative** (they alone advance the live
     axes); each `noteStateEvent()` dispatch writes only **shadow derived
     counters** plus an ordered `(event, mask)` trace — the §1b probe
     technique, so the two tracks never mutate the same state. A temporary
     comparison hook compares live-vs-shadow advancement at each
     **top-level engine operation boundary** (the public API entry points:
     `box`/`parse`/`evaluate`/`assign`/`declare`/`assume`/`forget`/config
     setters — nested internal operations are compared only through their
     enclosing entry point). After zero discrepancies across the full
     suite plus the three workloads, the **cutover commit** makes dispatch
     authoritative, deletes the legacy lines and the shadow scaffolding,
     and lands the pinning test.
   Tolerated deltas — one **structural rule**, not a site list: *a caller
   that re-bumps a counter `updateDef`'s internal gate already bumped in
   the same operation collapses to one semantic advance.* Known instances:
   `engine-declarations.ts:482` (G×2 + M), and the `:434`/`:455` declares
   whenever the installed def is callable-shaped (always, for operator
   declares — see the §2 row annotation). Advancement is what cache keys
   test, so magnitude collapse is invisible to every consumer. Nothing
   else: step 2 introduces no new suppressions (§3), so the gate needs no
   no-op tolerance, and any other discrepancy is a transcription bug by
   definition.
3. **`callable` axis + effects re-key**, verified per §6 (classifier tests,
   then canary smoke + soak, then delete the old key and re-measure).
4. **Re-measure `type`**, decide `type-shape` (§5) with the literal-type
   check resolved.
5. **Post-parity semantic diffs** — each a separate, measured commit with
   its own blast-radius check per CLAUDE.md, never bundled into steps 2–4:
   (a) the R5 normalization (ruled: bump `any` at the zero-mask sites,
   §9); (b) the no-op dispatch guard
   rollout (§4), site by site, with the §6 no-op acceptance pair run
   against each.
6. **Documentation**: the three counter doc-comments in `index.ts` collapse
   to pointers at the dispatch table; each cache's key comment states its
   subscription (axes + stamps + covering argument).

## 9. Open rulings

- **R1 — RESOLVED (revision 3, by repro).** The cheap test is
  insufficient: `Apply(At(cbs,1), 3)` is impure through the list-typed
  binding `cbs` (§1b), so the classifier must use deep signature-arm
  containment over composite types (with a type-walk cycle guard), plus the
  function-literal check on values (including one level inside stored
  collections). Adopted in §4.
- **R3 — RATIFIED (2026-08-09, user ruling).** The staleness asymmetry
  ("serving impure-when-actually-pure is acceptable;
  pure-when-actually-impure never is") holds only between answers ordered
  by label inclusion, and **`'any'` is not in that order** — a transition
  to `'any'` (head-position shadow, §5.3; operator→scalar swap, §2b)
  invalidates like any other change. Doctrine; every predicate choice in
  §5 preserves it.
- **R4 — RULED (2026-08-09, user ruling): rename all now.** The axes are
  named `any` / `semantic` / `world` / `callable` in code as well as in
  this document — the legacy spellings (`_generation`,
  `_mutationGeneration`, `_semanticEpoch`) do not survive the migration.
  Execution constraints: the rename lands as a **dedicated, mechanical,
  behavior-free commit immediately before the transcription commit**, so
  the parity diff stays reviewable (rename noise and semantics never mix);
  the renamed members land on `IComputeEngine`/`types-engine.ts` in the
  same commit (the public-type-unification convention); and the old
  spellings are grep-pinned absent afterward (TypeScript identifiers under
  `src/` only — see §8 2a for the pin's exact scope) so no stray site
  writes a resurrected name. Commit 2a is a strict field-for-field rename
  preserving today's topology; an `_axes.{any,…}` record refactor, if ever
  wanted, is a separate post-parity commit (§8 2a).
- **R5 — legacy-mask normalization (NARROWED, revision 3).** The §1b repro
  cleared the `redefine` family: `updateDef:1239` bumps G for every
  callable-shaped swap, and end-to-end invalidation works
  (`ce.assign('f', …)` over cached `_type`/`_effects`/`isPure` refreshes
  correctly). The remaining G-blind writes are: `BoxedSymbol.infer`
  signature narrowing (`boxed-symbol.ts:521`, M+E only — its
  `BoxedFunction` twin bumps G) and the `inScope` dirty teardown
  (`engine-scope.ts:153`, M+E only — its `popEvalContext` twin bumps G),
  plus the operator→scalar swap's zero-mask callability loss (§2b — the
  `callable` axis covers it via `redefine{callableBefore}`; the G question
  for `_sgn`/`_type` remains). **RULED (2026-08-09, user ruling):
  normalize** — these sites bump the `any` axis too, matching each site's
  twin and closing the latent `_sgn`/`_type` staleness gap. Lands in
  **step 5** (§8) as its own measured commit, never during the step-2
  transcription.

  **APPLIED WITH ONE AMENDMENT (2026-08-11, blast-radius evidence).**
  Normalized to `any`: `type-write` (all), `inference{symbolSignature}`,
  and the assumption-dirty transient pop. **NOT normalized —
  `inference{valueType}` stays zero-mask on `any`, by necessity:**
  value-branch inference is a side effect of type computation itself
  (canonicalization infers operand types mid-walk), so advancing the axis
  `_type`/`_sgn` read makes the type system invalidate its own footing.
  Measured fallout of trying: a stack-overflow in assumption-driven sign
  reasoning (`assumptions.test.ts` Wester 21/22) and inference-outcome
  drift in two typing suites. The pre-design zero-mask on this branch was
  load-bearing, not a gap — the residual `_sgn`/`_type` staleness across a
  value-branch inference remains, mitigated by the identity no-op skips
  (a re-inference of the same type writes nothing) and bounded by the
  `world`-axis events that accompany any real signature settlement. Cost
  of the applied rows (workload C): `type` +413 misses per 20 runs
  (~21/run) — accepted. The `callable` axis is unaffected throughout (its
  predicate selects all `inference` variants regardless of mask).

(Revision-1's R2 — `shadowsCallable` optionality — is closed: mandatory,
per §5.3.)

## 10. Instrumentation appendix

`CE_CACHE_STATS=1` (working tree, 2026-08-09): `src/common/cache-stats.ts`,
hooks in `engine-configuration-lifecycle.ts`, `boxed-value-definition.ts`,
`boxed-function.ts` (`_sgn`, `_type` incl. fast path, `_effectsOf`, lazy
memo), `collection-element-memo.ts`. Per-cache events include miss *cause*
(cold / generation / epoch / scope / key-shape / dependency) and
`missGenerationWasted` — a generation miss whose recompute produced the same
answer (subset of `missGeneration`). Zero-cost when unset (single branch on
a module constant); verified no-perturbation (suites pass flag-on and
flag-off). The **shadow callable-axis simulation** (§1b) also lives here:
`bumpShadowCallable()` called from the epoch setter, `updateDef`'s callable
branch, the two binding-repair sites, and the classified value setter;
`shadowEffectsOnHit`/`shadowEffectsOnRecompute` wired into `_effectsOf`.
Runner scripts for workloads A/B/C and the bump-attribution sampler are
preserved as `docs/scratch/cache-stats-workloads.ts` and
`docs/scratch/cache-stats-bump-attribution.ts` (run from the repo root with
`CE_CACHE_STATS=1 npx tsx <path>`); promote to `benchmarks/` if these
measurements become recurring.

After step 2 lands, bump attribution comes free from the event stream and
the sampler is obsolete.
