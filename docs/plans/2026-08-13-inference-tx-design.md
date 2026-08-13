# Inference Transactions (Provenance Phase 2)

**Date**: 2026-08-13 · **Status**: DESIGN DRAFT — for review before
implementation · **Builds on**:
`docs/plans/2026-08-13-inference-provenance-journal.md` (phase 1, shipped)

## Goal

A rollback primitive for inference-driven engine state, so that code which
today must be **write-free by construction** can instead **try, observe, and
undo**. The primary consumer is overload resolution: its arm filter
(`operandAdmits`, `overload.ts`) exists solely because trial-validating an
arm would leak `infer()` writes from rejected arms, and it must therefore
MIRROR `validateArguments`' admission gates exactly — sixteen mirrored gate
pairs today, with three standing "must mirror" comments and at least one
already-stale cross-reference (`overload.ts:339` cites coordinates that have
drifted). Secondary consumer: the static checking pass's hand-rolled
provisional-registry rollback. (The first-boxing fix — Tycho 178 — shipped
WITHOUT needing a tx, via detect-and-rebuild in `EngineBoxingState`; its
recorded constraints still shaped this design.)

## What a trial validation actually writes (measured inventory, 2026-08-13)

An audit of `validateArguments` found every write it can commit before the
point where validation can still fail:

1. **Channel-visible inference writes** — `infer('narrow')` on symbol
   operands at three loop sites, plus signature narrowing on SHARED operator
   definitions. These flow through `_noteInferenceWrite`, so a journal sees
   them.
2. **A channel-INVISIBLE type write** — the fresh-matrix repair writes
   `def.value.type = ce.type('matrix')` directly (`validate.ts:1402`),
   bypassing `infer()` and therefore the journal, then hand-rolls its own
   restore. That restore is measurably unfaithful: it writes through the
   `type` setter (which WIPES the value when restoring `unknown`), allocates
   fresh `BoxedType`s on both legs (defeating identity-keyed caches), and
   does not undo anything the repair's internal re-box (`validate.ts:1409`)
   did transitively — declarations, inferences on other definitions,
   provisional registrations.
3. **Declarations** — the devolve-unapplied-operator repair declares a
   shadow (`validate.ts:176`) and flags an `EngineBoxingState` rebuild; the
   fresh-matrix re-box can auto-declare arbitrary free symbols.
4. **Monotone counters** — `_noteStateEvent` emissions, `_writeVersion`
   bumps. These are cache-invalidation axes and are NOT restorable by
   design.

## Design

### The primitive

```ts
ce._inferenceTx<T>(fn: () => T): { result: T; commit(): void; abort(): void }
// or, more likely as consumed:
ce._tryInference<T>(fn: () => T): T      // commit on return, abort on throw…
```

(Exact surface to be settled at implementation; the semantics below are the
contract.)

While a tx is open, three families of writes journal an **undo entry** at
the moment they land:

- **Type/signature writes**: `{def, field, previousBoxedType}` recorded in
  `_noteInferenceWrite` (one added branch) — plus the same recording in a
  new `_writeTypeForRepair` helper that the fresh-matrix repair MUST be
  migrated to first (see Prerequisite below).
- **Declarations**: `{scope, name}` recorded in `declareSymbolValue` /
  `declareSymbolOperator`. Undo removes the binding from the scope map and
  disposes the definition. Definitions are **never recreated**.
- **Provisional registry**: fold `provisionalRegistryRollbackPoint` into the
  tx frame, fixing its one-shot defect (the current rollback re-installs the
  snapshot's own `Set` objects rather than copies, so a second rollback
  restores already-mutated sets).

`inferredType` flips, `effectsDeclared`, and `_typeProvenance` appends made
inside the tx are journaled alongside the type writes (provenance entries
recorded during an aborted tx are popped — an aborted trial never happened,
so it must not leave history).

### The identity contract (the constraint consumers asked to have stated)

`sameBindingDef` is object identity plus one `_activationOf` hop — nothing
else. Therefore:

- **Pre-existing definitions are restored IN PLACE** — fields written back
  on the same object. Object identity survives; `isSame`, escaping-occurrence
  checks, and capture analysis are unaffected.
- **Definitions created inside an aborted tx are removed and never
  recreated.** This is identity-safe only under an escape rule: **no
  expression boxed inside an aborted tx may be retained by the caller.** A
  trial validation satisfies this trivially (its outputs are discarded on
  rejection); the rule is asserted in debug builds by tombstoning the
  removed definitions (`_debugBindings` machinery).

### What rollback deliberately does NOT restore

- **Monotone counters** (`_writeVersion`, state-event axes). Undoing them
  could resurrect stale cache entries; leaving them advanced merely causes
  over-invalidation — a recompute, never a wrong answer. Stated as a
  contract: a tx abort is *semantically* invisible but *cache-wise* visible.
- **`_freshlyInferred`**: entries added during an aborted tx ARE removed
  (the set drives repair eligibility, which must not see phantom evidence).

### Re-entrancy

A tx stack. Nested `begin` pushes a frame; an inner abort unwinds to its own
frame only. Journaling costs nothing when the stack is empty (one null
check), and a frame allocates its journal lazily on the first write —
per the recorded consumer constraint (canonicalization-adjacent paths are
hot).

### Interaction with `EngineBoxingState` (redo-based repair)

The rebuild machinery is **re-execution**, not undo, and its convergence
argument depends on repair-created bindings SURVIVING into the next build
pass. Two hard rules:

- A tx must be fully contained within one build pass: opening a tx that
  spans a `_withRepairFrame` rebuild boundary is a contract violation
  (assert).
- A tx abort must not remove a binding whose creation set `repairRequested`
  (the devolve shadow, a persistent-scope re-declaration). In practice trial
  validation under the overload consumer never triggers these — the devolve
  repair runs in the WINNING arm's real validation, not in trials — but the
  tx asserts rather than assumes.

## Prerequisite workstream: close the `validate.ts:1402` bypass

Before the tx primitive lands, migrate the fresh-matrix repair's direct type
writes to a channel-visible helper (and its hand-rolled restore to the tx,
once available). This is independently a bug fix: today those writes record
no provenance, no `_freshlyInferred` entry, and their restore can wipe an
assigned value. It also makes the journal complete — a tx built on an
incomplete journal silently fails to restore exactly the state the repair
touches.

## Retiring the overload mirror filter (§4.2 → trial validation)

With the tx in place:

1. Keep the CHEAP pre-filters: arity (`arityAdmits`) and the plain
   `type.matches(param)` test — they reject most arms without a trial and
   bound the perf cost.
2. Replace gates 6–13 of `operandAdmits` (value-component tri-state,
   inferred-narrowing, inferred-signature, broadcastable, strip, overlap,
   devolve precondition, fresh-matrix precondition) with: run
   `validateArguments` for the arm inside a tx; arm admitted iff it returns
   valid; abort the tx either way (the WINNING arm is re-validated for real
   afterwards, exactly once).
3. **§4.3 survives unchanged**: inference into operands still uses the JOIN
   over viable arms (`joinParamAt`), applied once after selection — the tx
   changes how viability is DECIDED, not what is inferred.
4. The three semantics the filter never mirrored (D8 absorbed-top admission,
   `deferredIdx`, the §4.3 join plumbing) need no mirroring at all under
   trial validation — they simply run.

**Perf gate**: trial validation costs a full validation per surviving arm
where the filter cost a per-operand predicate. The pre-filters bound this,
but the change lands only with a benchmark comparison on the overload-heavy
paths (the `benchmarks` harness has the machinery). If trials measure too
hot, the fallback is scoping trials to the arms the cheap gates cannot
decide — which still deletes the drift-prone gates 6–13.

## Phasing

- **2a**: close the 1402 bypass (independent bug fix, small).
- **2b**: the tx primitive + journal-undo + declaration/provisional folding;
  adopt in the static checking pass (replacing its bespoke rollback).
- **2c**: overload filter retirement behind the perf gate.

Each phase is separately land-able and separately reviewable.
