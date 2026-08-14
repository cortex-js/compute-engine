# Effects-axis provenance and rollback

**Date**: 2026-08-13 · **Revision 3** (two dual-spec-review rounds; r1: 6
findings — the W1 hook placement was wrong, both reviewers; r2: 5 findings —
the `declaredAt` threading targeted the wrong throw site, both reviewers;
all applied below) · **Status**: IMPLEMENTED 2026-08-13 (see "As
implemented" at the end) ·
**Builds on**: `docs/plans/2026-08-13-inference-provenance-journal.md`
(phase 1, shipped — which reserved `TypeProvenanceEntry.axis: 'effects'`
without recording it) and `docs/plans/2026-08-13-inference-tx-design.md`
(phases 2a–2c, shipped — rollback frames and trial-based overload
resolution). Motivated by upcoming work that will consume effects more
heavily: before effects drive more behavior, their provenance should be as
diagnosable, and their mutations as rollback-covered, as the type axis
already is.

## Goal

Three deliverables, all extensions of shipped machinery:

1. **Provenance**: activate the reserved `axis: 'effects'` — record an entry
   in the definition's `_typeProvenance` history whenever a
   post-construction write changes a definition's effects CONTRACT state,
   with the triggering expression as `cause`.
2. **History survival across redefinition**: a definition's provenance
   history currently DIES with the definition object on every reassignment
   (`updateDef` constructs a fresh half and discards the superseded one,
   `_typeProvenance` included). For a declaring site to be nameable after a
   later reassignment violates the contract, the history must ride the
   replacement. This also repairs the same loss on the TYPE axis, which
   phase 1 inherited silently.
3. **Rollback completeness**: close the one effects-state gap in the frame
   journal — `effectsDeclared` on value definitions is not in the
   `_typeSlotSnapshot` tuple.

Consumer: the effect-contract diagnostic gains the declaring site — the
effects twin of the phase-1 two-site `incompatible-type` note.

## The effects-state write inventory (verified empirically, 2026-08-13; r1
corrected W1)

State: `effectsDeclared` (both definition classes — annotation provenance:
"the author STATED the effects, they are a contract"), and on operator
definitions the cached `_effects` set, `_inferredDraws`, and the signature's
effect specifier (kept in lockstep by `_setEffects`/`_resyncEffects`).

**Construction-time writes — NOT recorded**, per the phase-1 rule (recording
in the constructors would tax the ~2000 library definitions per engine, and
the anchor is derivable: `effectsDeclared === true` with no history entry
means "stated at construction"):

- `_BoxedValueDefinition` constructor.
- `_BoxedOperatorDefinition.update()` **when reached from the constructor**
  — which, r1's critical finding established, includes EVERY reassignment:
  `assignFn` → `updateDef` builds a *fresh* `_BoxedOperatorDefinition`
  (whose constructor calls `update()`) and swaps it in; nothing ever calls
  `update()` in place on a pre-existing definition except the cascade (W2
  below). A hook inside `update()` therefore cannot distinguish
  "reassignment" from "library construction" and is the WRONG placement.
- The fresh-declaration literal in `declareOne` (`library/core.ts` ~2894).

**Post-construction writes on a PRE-EXISTING definition — the recording
sites**:

- **W1 — redefinition through `updateDef`** (`boxed-expression/utils.ts`) —
  the choke point every reassignment route already passes (and the site the
  rollback journal's family 3 already hooks). The hook runs at a PRECISE
  point (r2 finding 3): immediately after the swap commits, BEFORE the
  unregister/register calls and the `repairProvisionalDependents` cascade —
  the cascade can throw with the swap already committed, and the history
  transfer + entry must not be skipped in that case. It compares the
  SUPERSEDED half's effects state to the INSTALLED half's (both objects in
  hand): set spelling (`describeEffects` over the halves' effective effect
  sets — the same spelling comparison `_setEffects` uses) and the
  `effectsDeclared` bit. Records onto the INSTALLED definition. Covers
  operator→operator, value→operator and operator→value replacements
  uniformly; a swap with no effects-state change records nothing.
- **W2 — the provisional re-derivation cascade** (`installRebuiltLiteral` →
  `def.update({evaluate: rebuilt})`) — the one true in-place `update()` on
  a pre-existing definition. Recorded at the `installRebuiltLiteral` call
  site (which already snapshots the definition for rollback), by the same
  before/after comparison.
- **W3 — the typed-`let` upgrade** (`library/core.ts` ~2868):
  `existingValueDef.value.effectsDeclared = effectsDeclared` on an
  already-auto-declared binding, at canonicalization time. Recorded at the
  write site (it has `ce` in hand for `recordTypeProvenance`).

## History survival across `updateDef` (r1 critical, part 2)

When `updateDef` replaces a half, the installed half ADOPTS the superseded
half's `_typeProvenance` array by **copy** (a fresh array, same entry
objects), before the W1 entry is appended — but ONLY when the installed
half is one `updateDef` itself CONSTRUCTED (the spec-object branches, the
same discriminator the family-3 rollback journal already uses for its
disposal decision). A CALLER-SUPPLIED, already-boxed half is never written
to (r2 finding: it may pre-exist the frame and be shared — mutating its
history would both clobber provenance it legitimately carries and escape
rollback, since family 3 restores the record's pointer, not fields on the
orphaned instance). Those instance-passed routes (protocol plumbing,
multi-clause internals) forgo history continuity; a note at the branch
records why. For the transferred case, both axes ride along:

- Sound for the type axis's consumers: the first-boxing predicate compares
  `epoch`/`cause` per entry — transferred entries carry their ORIGINAL
  epochs, so nothing transferred can masquerade as "recorded by the pass
  running now".
- Rollback-safe: the copy happens on the frame-created installed half,
  which family 3's undo drops wholesale; the superseded half's own array is
  never mutated. Appends to the copied array are family-7-journaled as
  always.
- The transfer is UNCONDITIONAL on the replaced half being present —
  value→operator and operator→value swaps carry the record's single history
  thread across kinds, which is exactly what lets `f: (n) pure -> n`
  declared as a VALUE annotation still be named after `f` later becomes an
  operator definition.
- When BOTH halves existed... they cannot: a binding record holds one half
  at a time (`updateDef` deletes the other on swap), so "the superseded
  half" is unambiguous — the half present before the swap.

## Recording rule

Entry fields, per site:

- `kind: 'declared'` — the effects-contract state changed by declaration:
  `effectsDeclared` false→true, true→false (a redefinition that drops the
  contract — recorded, so the history shows the contract ENDING, not just
  starting), or a stated set replacing a differently-spelled one. W1 and
  W3 produce these.
- `kind: 'inferred'` — a body-inference re-stamp that changed the set
  spelling on the inferred track (`effectsDeclared` false on both sides).
  W1 and W2 produce these.
- `_inferredDraws`-only transitions record NOTHING — deliberately out of
  scope: it is frame-participation state, not contract state, and no
  consumer reads frame-participation provenance (the diagnostic consumes
  the declared set). Pinned by a same-spelling/different-draws no-record
  acceptance test (r1 finding 5).
- `type`: the definition's effective type AFTER the write (the operator
  half's `signature`, or the value half's `type`) — the arrow carries the
  effect specifier, so no new entry shape is needed.
- `cause`, **per site** (r1 finding 4 — one policy per site, no global
  precedence): W1 records the assigned function literal when the installed
  half carries one (`_lambdaLiteral` / the function-typed value), else the
  ambient `ce._inferenceCause`, else absent. W2 records the REBUILT
  literal, overriding any ambient cause — the re-derivation is about that
  literal, and an enclosing canonicalization would misattribute it. W3
  records the ambient cause or absent. `epoch`: `currentBoxingEpoch`, as on
  the type axis.
- Entries go into the SAME `_typeProvenance` array; the 8-entry cap stays
  **axis-blind** (accepted, consistent with phase 1's oldest-is-anchor
  policy; a mixed-axis eviction test pins the behavior — r1 finding 6),
  and family 7 of the rollback journal covers every append for free.

`_resyncEffects()` records nothing: it re-attaches the same set, and the
rollback families call it during undo, where journaling is forbidden.

## The consumer: the contract error names its site

`EffectContractError` today names the symbol and the two sets, but not
where the contract was stated. r2's critical finding: the error has FOUR
producers, and the ones a REASSIGNMENT hits are `assertDeclaredEffects`'
call sites in `engine-declarations.ts` (the value-slot and operator-slot
declared-signature reconciliations, plus the fresh-Declare check) — all of
which throw BEFORE `updateDef`/`update()` ever run. Any threading through
the definition spec is therefore dead on arrival. The mechanism instead:

- **One shared lookup helper**, `latestDeclaredEffectsSite(def)`
  (effects-inference.ts): the `cause` of the definition half's most recent
  `axis: 'effects'`, kind `'declared'` provenance entry, or `undefined`.
- **`EffectContractError` gains `declaredAt?: Expression`** (constructor
  parameter; string-name identification per the cross-bundle rule stays
  unchanged). Every producer passes what it can see:
  - `assertDeclaredEffects` gains a `declaredAt` parameter; its callers
    pass `latestDeclaredEffectsSite` of the PRIOR half they are already
    reading the contract bit from.
  - `update()`'s internal check (the constructor-time and W2 producer):
    for W2 — the one in-place `update()` — the definition IS its own prior
    half, so it reads its own history; a constructor-time throw (fresh
    half, empty history) passes `undefined`, which is also the correct
    answer for a construction-stated contract.
- **Rendering, both routes**: the JS error message appends
  ``… (declared at `<site>`)`` when `declaredAt` is present, rendered by
  `toString()` — rendering only, per the escape rule.
  **The Epsil route needs real plumbing** (r1 finding 2), but not an API
  change (r2 finding 2 — `ce.error`'s public `where` is `string`-typed):
  `effectContractErrorValue` passes `e.declaredAt?.toString()` as the
  existing STRING `where` — the legacy string-context slot of the phase-1
  error shape, whose dedup key is site-less by that round's design, so
  diagnostic deduplication is unchanged and no interface widens. The
  effects note renders a site; it never resolves bindings, so the
  binding-accurate machinery of the phase-1 `incompatible-type` note is
  deliberately NOT involved.
- A contract stated at CONSTRUCTION has no entry and no site; messages are
  unchanged there (same graceful degradation as phase 1's ambient-cause
  fallback).

## Rollback completeness

- **Value definitions**: add `effectsDeclared` to the `_typeSlotSnapshot` /
  `_restoreTypeSlots` tuple (coupled state on the same object; the snapshot
  is opaque — no interface change, but the tuple's doc comments in the
  class and `types-definitions.ts` must be updated). Classification
  (re-verified against r1's challenge): today W3 is the only
  post-construction `effectsDeclared` write on value definitions, and it
  reads `currentScope.bindings.get(name)` — the CURRENT scope only, never
  the chain — so inside the static pass it can only reach bindings the
  pass itself created (family 4 removes those wholesale on rollback). A
  previous cell's binding lives in an outer scope and is not reachable by
  that lookup. So: defense-in-depth for future frame consumers, not a live
  leak — pinned by the cross-pass regression test below rather than
  asserted.
- **Operator definitions**: already covered — the cascade (W2) snapshots
  `effectsDeclared`/`_effects`/`_inferredDraws`/signature via
  `_rederivationSnapshot`; W1 installs a frame-created half that family 3
  drops on rollback (and the history COPY leaves the superseded original
  untouched, so its restore-by-identity is exact).
- Nothing else: monotone counters stay non-restored, per 2b.

## Explicitly out of scope

- Recording construction-time effects provenance (the constructor-tax rule;
  the anchor is derivable from `effectsDeclared` alone).
- Recording `_inferredDraws`-only transitions (no consumer; pinned by
  test).
- An effects-axis analog of the narrowing sink (no consumer).
- Any change to effect SEMANTICS — inference, contracts, checking, and
  `docs/EFFECTS-MODEL.md` truth tables are untouched; this is
  observability and undo coverage only.
- `assume.ts` (no effects writes exist there).

## Acceptance tests

- W1: reassigning an operator-bound symbol with an effects-state change
  records `'declared'`/`'inferred'` per the rule, on the INSTALLED half,
  with the prior history present (transfer); a reassignment with no
  effects-state change appends nothing (but still transfers). **Two
  successive reassignments under a contract stated post-construction: the
  second violation's error still names the ORIGINAL declaring site**
  (r1's acceptance demand — this is the test the old hook placement could
  never pass).
- Contract violation: body inferring uncovered effects → the JS error's
  message names the declaring site; the Epsil static diagnostic carries it
  through the sited error value; a construction-stated contract yields the
  unchanged siteless message in both routes.
- W2: the cascade re-derivation records an `'inferred'` entry whose cause
  is the REBUILT literal even when an ambient canonicalization cause is
  active; aborting the enclosing rollback frame leaves the pre-frame
  history byte-identical (family 7 + family 3).
- W3: a typed `let` whose type carries an EXPLICIT effect specifier (r2
  finding 4 — a bare typed `let` writes `effectsDeclared` false→false and
  must record nothing, pinned by a paired negative test) upgrading an
  auto-declared binding records the `'declared'` false→true transition
  with its cause; a static-check pass whose program does this leaves no
  trace after rollback (cross-pass regression: check the same program
  twice, second pass identical — pins the "current-scope-only"
  reachability argument).
- W1 ordering: a redefinition whose repair cascade THROWS still leaves the
  installed half with the transferred history and the W1 entry (the hook
  precedes the cascade).
- Route coverage for the site (r2 critical): value-slot retention,
  operator-slot retention, and a W2 rejection each name the declaring
  site; the instance-passed `updateDef` branches transfer nothing (shared
  caller-supplied object untouched).
- Slot tuple: `effectsDeclared` survives a
  `_typeSlotSnapshot`/`_restoreTypeSlots` round-trip.
- No-record pins: `_resyncEffects`, a no-change re-attach, and a
  same-spelling/different-`_inferredDraws` reassignment each leave the
  history length unchanged.
- Cap: a mixed type/effects write sequence past 8 entries evicts
  second-oldest regardless of axis (pins the axis-blind cap).
- Type-axis side effect of the history transfer: a symbol's type-axis
  history survives a redefinition (new behavior, pinned as intended).

## As implemented (2026-08-13)

Landed as specified in revision 3, same day. Notes and verified behaviors:

- The recorders live in their own module,
  `boxed-expression/effects-provenance.ts` (`EffectsContractState`,
  `effectsContractStateOf`, `recordEffectsTransition`,
  `latestDeclaredEffectsSite`) — leaf imports only, no new cycles. NOT in
  `effects-inference.ts`: that module is the Function-literal construction
  SEAM, guarded by an importer allowlist
  (`effects-seam.test.ts`), and the mutation sites that consume the
  recorders (`updateDef`, the cascade, the typed-`let` upgrade) must not
  need seats on that allowlist. `EffectContractError` (which gained
  `declaredAt`) stays in the seam module with the walk that throws it.
- **Route findings, pinned in
  `test/compute-engine/effects-provenance.test.ts` (16 tests):**
  - `ce.declare('f', '(number) pure -> number')` installs a VALUE
    definition (declared function TYPE, no body) — the entry and the
    contract bit live on the value half; the W1 hook records it because
    the declare route swaps the placeholder through `updateDef`.
  - The legacy `pure: true` sugar records nothing — it never sets
    `effectsDeclared` (it is an override, not a contract, per
    `docs/EFFECTS-MODEL.md`), so reassignment under it re-stamps freely
    and there is no contract state to record. Pinned.
  - The history transfer is visible in the wild: the `'auto-declared'`
    TYPE anchor recorded on a symbol's pre-assignment value half now
    survives onto the operator half `g(t) := …` installs. Pinned as
    intended new behavior.
  - W2's cause is the rebuilt literal (`(t) |-> 2a(t)`), verified with an
    effectful callee (`a(t) := RandomInteger(1, t)` flips the cascaded
    definition's inferred set); the no-movement cascade records nothing;
    an enclosing rollback frame leaves the pre-frame history
    byte-identical.
  - W3 verified end-to-end through Epsil (`let q: (number) pure ->
    number` over an auto-declared `q` records the `'declared'`
    transition; a bare typed `let` records nothing).
  - The declare-API routes record entries with an ABSENT cause (nothing
    to point at — no literal in hand, no ambient cause at API time), so
    their violations render siteless; the site-naming path is pinned with
    a seeded cause. Routes that carry a literal (W1-with-lambda, W2)
    record real sites — pinned by the annotated-literal test (`Typed`
    marker stating `pure`).
  - **Reachability finding (staged-review round):** the fully-genuine
    sited-violation chain — a real caused `'declared'` entry that later
    GATES a violation — is not reachable through today's routes: the
    contracts that gate reassignment are symbol-declared (causeless by
    the above), and the declared-signature reconciliation ascribes the
    declaration OVER a literal's own effects annotation (pre-existing
    "declaration is authoritative" semantics), so an annotated literal
    cannot smuggle a caused contract under a declared type. All
    reachable violations therefore render the siteless message today;
    both halves of the chain (caused recording, sited rendering) are
    pinned separately, and a future route that declares a contract with
    an expression in hand lights the message up with no further work.
- The mixed-axis cap test pins axis-blind eviction, and the
  `effectsDeclared` slot-tuple ride is pinned by a snapshot/restore
  round-trip.
