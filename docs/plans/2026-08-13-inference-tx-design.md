# Inference Rollback Frames (Provenance Phase 2)

**Date**: 2026-08-13 · **Revision 2** (post dual-spec-review; r1's findings
and their disposition are in
`docs/scratch/2026-08-13-inference-tx-design_SPEC_REVIEW.md`) ·
**Status**: DESIGN — for re-review before implementation · **Builds on**:
`docs/plans/2026-08-13-inference-provenance-journal.md` (phase 1, shipped)

## Goal

A rollback primitive for inference-driven engine state, so that code which
today must be **write-free by construction** can instead **try, observe, and
undo**. Consumers, both of which want *always-rollback* semantics:

- **Overload resolution** (primary): replace the drift-prone half of the arm
  filter (`operandAdmits`, `overload.ts`) — sixteen mirrored gate pairs,
  three standing "must mirror" comments, at least one already-stale
  cross-reference — with trial validation.
- **The static checking pass**: replace its bespoke
  `provisionalRegistryRollbackPoint` (which has a one-shot defect — it
  re-installs the snapshot's own `Set` objects, so a second rollback
  restores already-mutated state).

Naming: **rollback frame**, never "transaction" — the shipped
`_inferenceTxDepth` / `beginInferenceTransaction` machinery is a
*boxing-pass window counter* (it drives `_boxingEpoch` and the
`_freshlyInferred` lifecycle, with no undo semantics), and r1's overloaded
"tx" naming invited confusing the two. A rollback frame always nests
strictly inside one boxing-pass window; opening one outside a pass is a
contract violation (assert).

## The primitive

```ts
// Engine-internal. The ONLY consumer-facing form in phases 2b/2c:
ce._withRolledBackInference<T>(fn: () => T): T
// Runs fn with a rollback frame open; ALWAYS rolls the frame back — on
// normal return AND on throw (undo in finally, rethrow after). Returns
// fn's value.
```

Both known consumers are always-rollback (a trial's outcome is a
*decision*, not state; the static pass checks and then discards), so
**commit semantics are deliberately not specified** — no commit/abort
split, no inner-commit-merge question, no idempotence surface. If a future
consumer needs commit-on-success, that is a design extension with its own
review, not a latent mode of this primitive.

Re-entrancy: a frame stack. Nested calls push; an inner frame's rollback
unwinds exactly its own journal (strict LIFO — undo entries are replayed in
reverse order within the frame). The stack empty ⇒ every journaling hook is
one null check; a frame allocates its journal lazily on the first write
(consumer constraint: canonicalization-adjacent paths are hot).

Exceptions **during undo** are a broken-engine condition: undo entries
restore raw slots (below) and do not run user code, so a throw there is a
bug; it is allowed to propagate after the frame completes as much undo as
it can (best-effort unwind, then rethrow the first undo error).

### The escape rule (narrowed from r1)

An expression or definition **created inside a rolled-back frame must not
be evaluated, canonicalized against, or resolved for symbol lookup after
the rollback**. Retention for *rendering* (a diagnostic holding an
expression it will only `toString()`) is permitted — non-canonical
rendering resolves no bindings. This wording reconciles the static pass's
diagnostic-retention design: its two-site diagnostics are built from
expressions created in the pass-wide caller scope (which the pass pops
through its own existing lifecycle), NOT inside rollback frames — the
frames wrap only the per-statement *checking*, whose outputs are
decision-shaped. Enforcement: (a) by API shape — consumers should return
booleans/strings/verdicts, not expressions; (b) in debug builds
(`_debugBindings`), definitions removed by rollback are tombstoned and any
later resolution throws with both stacks; (c) the acceptance suite includes
a test that deliberately retains a frame-created expression and verifies
every supported access fails deterministically in debug mode.

## The journal: one entry variant per real mutation shape

r1's central defect was a single `{def, field, previousBoxedType}` shape
that cannot restore what the engine actually mutates. Each family below
names the exact hook that records it and the exact restore action. All
restores are **in-place and setter-bypassing**: they write private slots
directly through a small internal restore API, so no events fire, no
allocation happens, and object identity is preserved (`sameBindingDef` is
object identity plus one `_activationOf` hop — restoring fields on the same
object is the only identity-safe rollback; discard-and-recreate is
forbidden).

1. **Value-definition type slots** — recorded in `_noteInferenceWrite`
   (one added branch) and in the phase-2a repair-write helper (below).
   Entry: `{def, _type, _value, _defValue, inferredType}` — the FULL slot
   tuple, because the public `type` setter is a computed view: it always
   allocates, and writing `unknown` through it wipes `_value`/`_defValue`
   (this is precisely how the current fresh-matrix restore corrupts state).
   Restore: `def._restoreTypeSlots(entry)`, a new internal method writing
   the private fields verbatim. A pre-write `_type === null` (type derived
   from the value) round-trips exactly, which the setter cannot express.
2. **Operator signature writes** — entry `{operatorDef, signature}`;
   restore writes `operatorDef.signature` back and re-runs
   `_resyncEffects()` (the arrow and the cached effect set must stay in
   lockstep, per the phase-1 note on `BoxedFunction.infer`).
3. **Binding-half swaps** (`updateDef`: operator→value and value→operator
   replacements, reachable from `infer()`'s non-function-narrow branch and
   from redefinition sites) — recorded by a hook in `updateDef` itself
   whenever a frame is open, so every call site is covered without
   enumeration. Entry: `{binding, previousValueHalf, previousOperatorHalf,
   installedHalf}`. Restore: re-install the previous half objects on the
   SAME binding record via the same delete/assign mechanism `updateDef`
   uses, and hand the installed half to the same
   forward-reference-registry unregistration `updateDef` performs for
   superseded halves. The previous half objects still exist (nothing
   disposed them mid-frame — see family 4's ordering note), so identity is
   preserved for every expression that bound them before the frame opened.
4. **Declarations** — recorded in `declareSymbolValue` /
   `declareSymbolOperator`. Entry: `{scope, name, previousBinding | ABSENT,
   installedBinding}` — capturing the binding **replaced** by the declare
   (those routes unconditionally overwrite `scope.bindings[name]`), which
   r1's name-only deletion destroyed. Restore: put `previousBinding` back
   by identity (or delete the map entry when ABSENT), then dispose the
   installed binding. Repeated redeclarations of one name unwind correctly
   because entries are replayed strictly LIFO. Ordering note: **disposal
   happens only at rollback time, never during the frame**, so any entry
   recorded earlier that references the installed binding restores before
   it is disposed.
5. **Provisional registry** — fold `provisionalRegistryRollbackPoint` into
   the frame as a journal family (membership deltas per name, with
   prior-presence bits), fixing the one-shot set-aliasing defect. The
   existing standalone entry point remains until the static pass migrates
   (phase 2b), then is deleted.
6. **`_freshlyInferred`** — entry records the definition AND whether it was
   already a member (`.add()` is a silent no-op on present members, so
   "remove what was added" evicts pre-frame evidence — r1 finding 7).
   Restore: delete only when the prior-presence bit says absent.
7. **Provenance history** — appends are popped; a cap eviction
   (`recordTypeProvenance` displaces the second-oldest at 8) journals the
   displaced entry and its index, and rollback reinserts it. Without this,
   an aborted append at capacity permanently destroys a pre-existing entry.
8. **Narrowing sink** — entries recorded by `_recordNarrowing` during a
   frame are retracted on rollback (the sink's map keys by name; the entry
   restores the pre-frame `{from, to}` or is deleted if frame-created).
   A rejected trial must not leave `InspectableScope.narrowings()`
   reporting a narrowing that never took effect.

### Deliberately not restored

**Monotone counters only**: `_writeVersion` bumps and `_noteStateEvent`
axis advances. Undoing them could resurrect stale cache entries; leaving
them advanced causes over-invalidation — a recompute, never a wrong answer.
This is the complete list; everything else observable rolls back. (r1
listed `_freshlyInferred` here ambiguously; it is family 6 and DOES roll
back, presence-bit-correctly.)

## Repairs are not trialed: the repair-free validation mode

r1's worst finding: the devolve-unapplied-operator repair is REACHABLE from
trials (the current filter deliberately admits repairable-operator arms —
gate 12), and it entangles trial state with the redo-based
`EngineBoxingState` rebuild machinery, whose convergence depends on
repair-created bindings *surviving* into the next build pass. Rolling those
back breaks the rebuild; keeping them leaks trial state; asserting rejects
valid overloads (and `repairRequested` is an unattributed boolean — the
assert is unimplementable).

**Decision: trials never run repairs.** `validateArguments` gains an
internal `trial: true` mode in which the two construction-level repairs are
*admitted by precondition and not executed*:

- devolve-unapplied-operator: an operand satisfying
  `isRepairableOperatorSymbol` (already a write-free predicate, already
  shared code — one function, not a mirror) admits its slot; the repair
  itself does not run, `noteDevolvedShadow` is not called.
- fresh-matrix inference: an operand satisfying
  `couldRepairFreshMatrixInference` (already the write-free precondition)
  admits its slot; the repair does not run.

The WINNING arm is then re-validated for real — non-trial mode, no frame —
exactly once, and performs any repairs there, exactly as today. Guard rails:
`noteDevolvedShadow` and `noteDeclarationIn` assert that no rollback frame
is open (they are unreachable in trial mode by construction; the assert
catches drift), and a rollback frame asserts at open that it is inside a
single build pass and at close that no rebuild was requested during its
lifetime.

Consequence for r1's "cheap prefilter" defect: the prefilter rejects ONLY
what is provably impossible — arity (`arityAdmits`) and
provably-disjoint ground-type mismatch on non-lazy, non-collection,
non-generic slots. Everything else — lazy, invalid, unknown/`any`,
threadable-collection, generic-instantiated, named-permuted,
inferred-narrowing operands — is TRIALED with the arm's ground instance,
permuted operand order, and the full policy set (`lazy`, `threadable`,
`stripMissing`, repair preconditions, generic solutions), which reach the
trial because the trial IS `validateArguments`.

## No new import cycle: trials live on the validate side

`validate.ts` already imports and calls `resolveOverload`; the reverse call
(overload → validate) would close a cycle the overload design explicitly
avoided, in a repo with a zero-cycle budget. **The trial loop therefore
lives in `validate.ts`**: `resolveOverload` keeps only the cheap prefilter
and returns the surviving CANDIDATE arms; `validateArguments` (which owns
both the policies and the trial mode) trials candidates in declaration
order under `_withRolledBackInference`, selects the winner, re-validates it
for real, and applies §4.3's join (`joinParamAt`) over the arms whose
trials succeeded — the join survives unchanged; the frame changes how
viability is DECIDED, not what is inferred. `operandAdmits` gates 6–13 are
deleted; `overload.ts` never imports `validate.ts`.

## Phasing — each phase correct and landable on its own

- **2a — the slot-restore primitive + fresh-matrix fix.** Introduce
  `_restoreTypeSlots` and a channel-visible repair-write helper; migrate
  the fresh-matrix repair's writes (`validate.ts:1402`) AND its restore to
  them. This fixes, standalone, the three diagnosed defects: the
  channel-invisible write (no provenance, no `_freshlyInferred`), the
  value-wiping restore, and the identity-defeating re-allocation. 2a's
  acceptance tests: repair success and failure legs, an eligible symbol
  with an assigned value (survives a failed repair), `BoxedType` identity
  across the restore, and provenance entries now recorded for repair
  writes. No rollback frames yet — the restore is still repair-local, but
  it is CORRECT, discharging the discovered-defects rule immediately.
- **2b — rollback frames.** The frame stack, all eight journal families,
  the guard-rail asserts, and static-pass adoption (delete
  `provisionalRegistryRollbackPoint`). Acceptance suite (the r1 gap):
  per-family pre/post-state tests — abort after signature replacement;
  abort across a binding-half swap on a symbol bound pre-frame (identity
  asserted via `sameBindingDef` and `isSame`); overwritten and repeated
  declarations; nested frames touching one definition; provenance at cap;
  already-fresh `_freshlyInferred` member; sink retraction; throw paths
  (from `fn` and — simulated — from undo); the escape-rule debug test;
  route parity (box / `ce.function` / parse) on a static-pass-checked
  program.
- **2c — trial-based overload resolution**, behind a defined perf gate.
  New microbenchmark `benchmarks/` entry (registered in
  `benchmarks/README.md` per the benchmarks skill): calls against overload
  sets of 2/4/8 arms × operand categories (exact match, subtype,
  inferred-narrowing, generic, rejected), median of 5 runs. Gate, both
  required: the existing canonicalization corpus regresses **≤ 3%**
  (median, noise-bounded by the harness's run protocol) AND the
  microbenchmark's per-call cost stays **≤ 2×** the filter baseline.
  Decision owner: the user, shown the numbers. Fallback if the gate fails:
  keep trials for the arms the prefilter cannot decide **and** re-add
  cheap write-free gates ONLY where the benchmark shows they pay — each
  readded gate implemented by calling the SAME function the validator
  uses (shared code, per the gate-12 precedent), never a re-derived
  mirror. §4.3-preservation and blame tests from the overload design's
  §write-freedom suite are ported to the trial mechanism.

## Explicitly out of scope

- Commit-on-success frames (no consumer; extension needs its own review).
- The effects axis (`effectsDeclared`) — same shape, later phase, per the
  phase-1 doc.
- Reversible inference / conflict re-fold (phase 3 of the provenance doc —
  assignment-narrowing shipped separately and needs none of this).
