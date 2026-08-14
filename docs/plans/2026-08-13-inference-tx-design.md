# Inference Rollback Frames (Provenance Phase 2)

**Date**: 2026-08-13 · **Revision 2** (post dual-spec-review; r1's findings
and their disposition are in
`docs/scratch/2026-08-13-inference-tx-design_SPEC_REVIEW.md`) ·
**Status**: phases 2a, 2b AND 2c IMPLEMENTED (see the "As implemented"
sections below; 2c's perf gate awaits the user's sign-off on the recorded
numbers) · **Builds on**:
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

Exceptions, the precise contract (r2 asked for one): a throw from `fn`
triggers rollback and is rethrown — the BODY error is what the caller
sees. A throw **during undo** is a broken-engine condition (undo restores
raw slots and runs no user code): the unwind continues best-effort past
it, the failure is reported via `console.assert` (visible in dev, stripped
in production), and in debug builds (`_debugBindings`) it is then thrown
with the body error attached as `cause`. The body error is never masked by
an undo error in release — a JS `finally`-throw would do exactly that, so
the implementation must catch around each undo entry.

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

1. **Value-definition type slots** — recorded by a **pre-mutation** hook:
   `_noteInferenceWrite` fires AFTER the write (its event carries only
   `from`/`to` types), so it cannot snapshot the private slots. Instead,
   every in-frame type write goes through `def._journalAndWriteType(...)`
   (equivalently: the write sites call `frame.journalTypeSlots(def)`
   immediately BEFORE mutating — one call added at each of the write
   sites the phase-1 channel already enumerates, plus the 2a repair
   helper). Entry: `{def, _type, _value, _defValue, inferredType,
   _isSelfReferential}` — the FULL coupled-slot tuple: the public `type`
   setter is a computed view (always allocates; `unknown` wipes
   `_value`/`_defValue` — precisely how the current fresh-matrix restore
   corrupts state), and `_isSelfReferential` is recomputed on every value
   write, so a verbatim `_value` restore without it leaves the
   recursion-guard flag stale. Restore: `def._restoreTypeSlots(entry)`,
   writing the private fields verbatim. A pre-write `_type === null`
   (type derived from the value) round-trips exactly, which the setter
   cannot express. `_noteInferenceWrite` remains the unchanged POST-write
   observer channel.
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
   uses; unregister the installed half from the forward-reference
   registry; and — the r2 gap — **re-register the restored previous half**
   when it was callable and had a live registration before the frame
   (the forward write's own `unregisterProvisionalDependent` severed it).
   Registry membership AND its `REGISTRATIONS` reverse-index metadata are
   journaled by hooks on `registerProvisionalDependents` /
   `unregisterProvisionalDependent` themselves (family 5 covers both
   directions), so the restore is index-consistent. The
   `repairProvisionalDependents` cascade that a newly-callable name can
   trigger re-derives OTHER definitions **through `updateDef`** — the
   implementation must verify this routing (it is what makes the cascade's
   rebuilds captured automatically by this same family) and the 2b
   acceptance suite includes the cascade-abort test: a provisional literal
   re-derived because a symbol became callable inside a frame must be back
   to its pre-frame form after rollback. The previous half objects still
   exist (nothing disposed them mid-frame — see family 4's ordering note),
   so identity is preserved for every expression that bound them before
   the frame opened.
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
exactly once, and performs any repairs there. **A precondition is not a
proof**: `couldRepairFreshMatrixInference` is documented as conservative,
so the winner's real validation can fail where its trial passed. The rule
is **no fallback**: that failure surfaces as the call's error — which is
byte-identical to TODAY's behavior (the current filter admits by the same
precondition, ranks, selects once, and a failed repair errors with no
second chance), so a trial-passing runner-up going unused is pre-existing
semantics, not a regression of this design. Stated as an acceptance test:
an arm whose trial passes via the repair precondition but whose real
repair fails, with a lower-ranked cleanly-validating arm, must produce
the same error before and after this change.

Guard rails, precisely scoped (r2 caught the blanket version breaking the
static-pass consumer, whose ORDINARY declarations inside its frame are
exactly what family 4 exists for): the asserts live in the two REPAIR
helpers (`devolveUnappliedOperator`, `repairFreshMatrixInference`) — each
asserts no rollback frame is open when it runs — never in
`noteDeclarationIn`/`noteDevolvedShadow` themselves. Additionally a
rollback frame records `EngineBoxingState._frames.length` at open and, at
close, asserts `repairRequested` is unset on every frame pushed at or
above that depth during its lifetime (a repair frame that was pushed AND
popped inside the rollback frame's lifetime has already been consumed by
its own rebuild loop — that rebuild ran inside the rollback frame and is
covered by the open-time containment assert, so the close-time scan only
needs the still-live frames).

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
avoided, in a repo with a zero-cycle budget. **Mechanism: dependency
inversion, not a split.** `resolveOverload` KEEPS its fused loop —
instantiation (`instantiateArm`), ranking (`isMoreSpecific`/`outranks`,
D11 tie-break), and named-permutation bookkeeping all stay where they are
— but its admission step becomes a caller-supplied callback:
`resolveOverload(..., {admit: (arm, ground, permutedOps) => boolean})`.
`validate.ts` passes a trial closure (run `validateArguments` in trial
mode under `_withRolledBackInference`); nothing in `overload.ts` imports
`validate.ts`. Trials therefore run in ranking order inside the existing
loop, the selected arm and its ground instance come out exactly as today,
and §4.3's join (`joinParamAt`) applies over the arms whose trials
succeeded — unchanged.

Three consumers the r2 review found dangling, resolved:

- **Result typing** (`resolvedArm` in `boxed-function.ts` re-derives the
  resolution independently): the resolution computed at validation time is
  CACHED on the call (the same per-expression slot pattern the match plan
  uses), and `resolvedArm` reads the cache when present. Its cold path
  (reached on expressions that never validated) passes NO admit callback,
  and `resolveOverload` then falls back to the cheap prefilter alone —
  typing-only resolution needs no writes and tolerates the wider candidate
  set (result types JOIN over candidates there, per its existing
  docblock).
- **`diagnoseNoMatch`** (blame diagnostics when no arm fits): switches to
  the same admit callback, scoring refutations by which trial failed at
  which operand — its per-position `operandAdmits` probing is deleted with
  the gates. Runs only on the already-failing path, so trial cost is not a
  perf concern there.
- **All trials fail**: the existing no-match path (`diagnoseNoMatch` →
  blamed operands) — unchanged in shape, now fed by trial outcomes.

`operandAdmits` gates 6–13 are then deleted.

## Phasing — each phase correct and landable on its own

- **2a — the slot-restore primitive + fresh-matrix fix.** Introduce
  `_restoreTypeSlots` and a channel-visible repair-write helper; migrate
  the fresh-matrix repair's writes (`validate.ts:1402`) AND its restore to
  them. This fixes, standalone, the three diagnosed defects: the
  channel-invisible write (no provenance, no `_freshlyInferred`), the
  value-wiping restore, and the identity-defeating re-allocation. Because
  the now-channel-visible write appends provenance, the repair's FAILURE
  leg must also reverse that append (and reinsert a cap-displaced entry,
  and remove any fresh `_freshlyInferred` membership it created) — a
  repair-local record, since 2b's journal does not exist yet; an aborted
  repair must leave provenance byte-identical (r2 finding). 2a's
  acceptance tests: repair success and failure legs, an eligible symbol
  with an assigned value (survives a failed repair), `BoxedType` identity
  across the restore, provenance recorded on success and byte-identical
  history on failure, and a self-referential value surviving the
  round-trip (`_isSelfReferential` in the tuple). No rollback frames yet —
  the restore is still repair-local, but it is CORRECT, discharging the
  discovered-defects rule immediately.
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

## As implemented (2b, 2026-08-13)

Phase 2b shipped: `ce._withRolledBackInference` (`index.ts`), the frame
class and journaling gate in `src/compute-engine/inference-rollback.ts` (a
zero-import leaf module, so every layer can hook into it without a cycle),
all eight families, the static-pass adoption, and the acceptance suites
(`test/compute-engine/inference-rollback.test.ts`,
`test/epsil/static-check-rollback.test.ts`). Deviations from the text
above, each verified empirically:

- **The repair cascade does NOT route through `updateDef`** — family 3's
  "must verify this routing" check FAILED. `installRebuiltLiteral`
  (`function-utils.ts`) mutates a pre-existing dependent IN PLACE:
  `def.update({evaluate: rebuilt})` on an operator definition, or
  `def.value = rebuilt` on a value definition — neither passes through
  `updateDef`. The implementation journals that site directly: the operator
  kind snapshots exactly the fields an `{evaluate}`-only `update()` can
  touch (`_rederivationSnapshot`/`_restoreRederivationSnapshot` on
  `_BoxedOperatorDefinition` — signature, `_isLambda`, `_lambdaLiteral`,
  `evaluate`, `evaluateAsync`, `readsRandomFrame`, `effectsDeclared`,
  `_effects`, `_inferredDraws`), the value kind reuses the family-1 slot
  snapshot. The cascade-abort acceptance test passes with the specified
  semantics (in-frame re-derivation reverts; a later real definition still
  re-derives, i.e. the registry rolled back too).
- **The repair-helper guard asserts are TRIAL-scoped, not
  any-frame-scoped.** The literal "asserts no rollback frame is open"
  contradicts this spec's own family 1 ("plus the 2a repair helper" — the
  repair's writes are journaled precisely so an in-frame run rolls back)
  and its close-time containment note (which contemplates repair frames
  consumed inside a rollback frame's lifetime) — and it would fire on
  legitimate checking: the static pass's frame wraps full canonicalization,
  which runs `devolveUnappliedOperator` for any `M = N + 1`-shaped
  statement. The helpers therefore assert
  `!repairsForbiddenByRollbackFrame(ce)`: a frame carries a
  `forbidsRepairs` bit, false for every 2b frame, to be set by 2c's trial
  validation mode — the mode the assert was designed to police. If the
  literal reading is preferred, the flip is one default in
  `InferenceRollbackFrame`.
- **Family 5 hooks all three registry mutators** — `register…`,
  `unregister…`, AND `takeProvisionalDependents` (the spec named the first
  two; `take` also mutates membership and the reverse index, and the
  cascade calls it inside frames).
- **The frame-in-window contract needed a window opener**: the static pass
  is not inside `box()`/`parse()`, so `ce._withBoxingPassWindow` (a
  begin/end`InferenceTransaction` bracket) was added and the pass opens one
  window around its single pass-wide frame; the per-statement `box()`
  windows nest inside it. The pass keeps its own scope push/pop and the
  type/protocol registry rollbacks (different registries, not journal
  families); `provisionalRegistryRollbackPoint` and
  `IComputeEngine._provisionalRegistryRollbackPoint` are deleted.
- **Static-pass behavior change (deliberate)**: inference the checking
  writes onto PRE-EXISTING outer definitions — which the pushed scope never
  shielded, per the pass's own doc comment — now rolls back at pass end.
  Later statements of one checked program still see it (one frame spans the
  pass, so a `function` defined by statement 1 checks statement 2's call);
  the whole epsil suite (31 suites / 1324 tests) passes unchanged.
- **Family 3 disposes only a half `updateDef` itself constructed** (the
  `isValidValueDef` branch): such a half is frame-created by construction,
  so releasing a constant's configuration-change subscription is safe; a
  caller-supplied already-boxed definition may pre-exist the frame and is
  dropped without disposal, per the text above.
- **`recordTypeProvenance` gained a leading `ce` parameter** (family 7
  journals inside the function itself, covering every caller — the
  channel, `assume.ts`, the auto-declare sites, `assignFn`, the 2a
  repair).
- **Review round (dual, 2026-08-13) added two family-1 sites and one
  boundary note.** The `DefineFunction`/`Assign` canonical handlers'
  recursion-knot retype (`library/core.ts` — `def.value.type =
  ce.type('function')` on a possibly PRE-EXISTING inferred binding) is
  frame-reachable through the static pass and is now journaled (Codex
  finding, regression-tested in `static-check-rollback.test.ts`).
  Remaining DIRECT type-slot writes are deliberately unhooked because no
  2b frame can reach them — they run only at EVALUATE time, and both 2b
  consumers only canonicalize: the `assume.ts` writes, `assignFn`'s
  adopted-type write (`engine-declarations.ts`), and the bare route of
  `BoxedSymbol`'s public `type` setter. Phase 2c must re-audit this
  boundary if trial validation ever evaluates (it should not — trials run
  `validateArguments` only). The matrix repair's failure-leg composition
  with an open frame (repair-local restore first, frame replay second:
  idempotent slots, no-op set delete, pop on a detached provenance array)
  is documented at the write site and pinned by tests.

## As implemented (2c, 2026-08-13)

Trial-based overload resolution shipped as specified — dependency inversion
(`resolveOverload(..., trial)`, the closure supplied by `validateArguments`
running itself in trial mode under a repair-forbidding rollback frame inside
its own boxing window), the repair-free trial mode (preconditions admit,
repairs don't run, winner re-validates for real exactly once, no fallback),
the minimal prefilter, the per-call resolution cache
(`BoxedFunction._resolvedOverload`, attached by the three `box.ts`
construction sites via `validateArguments`' `resolutionOut`), trial-fed
`diagnoseNoMatch`, and the deletion of the mirror gates. Deviations and
boundary notes:

- **The prefilter keeps one non-trivial rejection beyond
  `provablyDisjoint`: value-membership refutation** (`hasValueComponent(param)
  && admissionOf(op, param) === 'refute'` — the old gate 6's refuting half,
  via the SAME shared function the runtime clause dispatch uses). It is a
  genuine proof of impossibility the type-level disjointness test cannot
  see (`1` overlaps the TYPE of the parameter `0`), and the named-argument
  faithfulness check (`plainCallIsFaithful`, which resolves WITHOUT a trial)
  depends on it: without it, a value-refuted clause re-entered the candidate
  set and the seam lowered plain calls to `Apply` forms
  (named-arguments.test.ts caught it).
- **The trial returns refuted operand INDICES, not a boolean**
  (`ArmTrialFn: ... => number[] | null`): admission consumes the null bit,
  `diagnoseNoMatch` consumes the positions — one closure serves both, per
  the "same admit callback" clause.
- **Trial-less `resolveOverload` consumers**: `resolvedArm`'s cold path (as
  specified), `effects-of.ts`'s per-application arm selection, and the two
  `named-arguments.ts` seam resolutions (a concurrent workstream's file,
  deliberately untouched) all run prefilter-only. The named seam is
  protected by the value-membership rejection above; the effects projection
  tolerates the wider set the way result typing does (fallback = the
  definition-wide union).
- **The resolution cache is deliberately NOT generation-guarded**: it
  records how the call was resolved when it was validated — a decision, not
  a recomputable view — and a re-canonicalization builds a fresh expression
  and a fresh cache entry.
- **The 2b guard asserts' `forbidsRepairs` bit is now live**: the trial
  closure passes `{ forbidsRepairs: true }` to `_withRolledBackInference`,
  arming the repair-helper asserts exactly as the 2b "As implemented" note
  anticipated.
- **Acceptance**: `test/compute-engine/overload-trials.test.ts`
  (write-freedom via rollback, §4.3 join preservation, per-arm blame,
  select-once/no-fallback pinned mechanically with a counting stub trial,
  cache-vs-cold consistency — a declared `number` operand types `number`,
  not the prefilter's `integer` pick — and trial nesting inside an
  enclosing rollback frame). The spec's repair-fails-after-trial-passes
  error-parity scenario could not be made to SURFACE AN ERROR through a
  declared overload set, and the reason is structural, not one failed
  construction: in `validateArguments`' admission order the fresh-matrix
  repair runs BEFORE overlap-deferred validation, and when the repair
  fails, the operand that reached it types as a collection-shaped value
  (the repair's plan only fires on matrix-ish algebra — `A·v` re-boxes to
  a `list<number>`-shaped term), which the overlap-deferral gate then
  admits — in the arm's trial and in the winner's real validation ALIKE,
  so the two verdicts agree and no error exists to compare (verified
  end-to-end: `q(A·v)` resolves to the matrix arm, defers, and leaves `A`
  untouched — the "repair-precondition admission agrees" test). The
  no-fallback property the spec's scenario targets is pinned structurally
  instead (one trial per prefilter-surviving arm, no retry loop —
  counting-stub test), and the plain-signature repair legs (where
  `checkType`-based operators like `Determinant` DO surface the failed
  repair as an error) stay pinned by `matrix-operator-typing.test.ts`.
- **Perf gate** (microbenchmark `benchmarks/overload-resolution.ts`,
  registered in `benchmarks/README.md`; corpus =
  `benchmarks/effects-registration.ts`): baseline measured at committed
  pre-2c HEAD in a worktree, same machine session, full 2/4/8 ×
  exact/subtype/inferred/rejected/generic matrix. Median per-call ratio
  ≈1.4×; generic rows ≈1.1× (instantiation dominates, trials add little);
  worst row 8-arm exact at 1.86× raw — inside the ≤2× gate raw, right at
  ≈2.0× after normalizing by the untouched-control drift (the two control
  rows disagree by ±15%, which bounds the measurement's resolution). The
  corpus (no overload sets on its paths) moved within run-to-run noise,
  structurally ≈0% — nominally within the ≤3% gate. Decision owner: the
  user; the recorded fallback if ruled over-budget is re-adding specific
  cheap gates where the benchmark shows they pay, via the shared
  validator functions.

## Explicitly out of scope

- Commit-on-success frames (no consumer; extension needs its own review).
- The effects axis (`effectsDeclared`) — same shape, later phase, per the
  phase-1 doc.
- Reversible inference / conflict re-fold (phase 3 of the provenance doc —
  assignment-narrowing shipped separately and needs none of this).
