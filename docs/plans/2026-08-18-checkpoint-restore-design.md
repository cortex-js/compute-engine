# Design: engine checkpoint/restore for cell-boundary replay

**Date:** 2026-08-18 · **Status:** APPROVED FOR IMPLEMENTATION
(ratified by Arno 2026-08-18 with the rest of the linear-posture
initiative — see the decisions section of
`docs/plans/2026-08-18-linear-posture-tycho-questions.md`). Revision 2
applies the 18 findings of the dual spec review — record with
per-finding disposition in
the incorporated spec review ·
**Requirements source:** `docs/plans/2026-08-18-linear-posture-audit.md`
§3 (the global-state inventory — every coverage claim below traces to
it) · **Depends on:** nothing shipped; independent of the §4.4 rulings
in the audit · **Feeds:** workstream 3 (the Tycho feasibility
conversation).

## 1. What this is

A `ComputeEngine` primitive that lets a notebook client take a
**checkpoint** of engine state at a cell boundary and later **restore**
it, so that "the user edited cell k" is implemented as *restore the
checkpoint taken before cell k, replay cells k…n* — instead of relying on
the engine's in-place redefinition semantics.

This API has value under EITHER outcome of the strict-posture decision:

- Under the **strict posture**, it is the client-side mechanism that
  replaces cross-batch redefinition entirely.
- Under the **current posture**, it lets a client implement the
  whole-scope re-execution it has already committed to (the notebook
  host "re-executes the whole scope on edit" — recorded as an external
  product commitment in
  `docs/plans/2026-08-01-function-polymorphism-design.md:239-243`)
  without paying full replay from cell 1.

## 2. The correctness specification, first

**A restore followed by replay must be observationally indistinguishable
from a fresh engine running the corresponding linear program.**
Precisely: fix a **baseline state B** — the engine constructor options
plus a host initialization prelude (custom declarations, LaTeX
dictionary edits, compilation targets, integration provider, rule-store
edits) that the client declares once. For any statement sequence
`P1 … Pn` executed from B with a checkpoint taken after each `Pi`, and
any edit point `k` with replacement suffix `P'k … P'm`:

```
restore(cp[k-1]); run(P'k … P'm)   ≡   fresh engine at B; run(P1 … Pk-1, P'k … P'm)
```

where ≡ is observational equivalence on: evaluation results, declared
and inferred types, diagnostics, serialization output, and `About()` —
compared as specified in §10's comparator table, which is also where the
§8 non-guarantees (object identity, effect re-execution, wall clock) are
excluded. Host mutations OUTSIDE the declared prelude — in particular
LaTeX-dictionary edits made mid-session — are a violated precondition,
not a covered state family (§5.5a).

This specification is also the **test oracle**: the differential harness
(§10) runs both sides from the same B and compares. Fresh-engine replay
("Tier 0") is therefore not just a fallback — it is the semantic
definition of what restore must do, and it works today with zero engine
changes. Measured baseline (dev build, 2026-08-18, this machine): first
engine construction ~36 ms, subsequent engines in a warm process ~8 ms,
typical light cells 4–15 ms each. Tier 0 is viable for small notebooks;
the checkpoint tier exists for notebooks with expensive cells and for
typing-latency budgets. Tier 0 is also the documented remedy whenever
the checkpoint tier refuses or fails (§6a).

## 3. The client contract (what Tycho sees)

```ts
interface EngineCheckpoint {
  readonly id: number;
  /** False once invalidated by a restore to an EARLIER checkpoint
      or by discard(). */
  readonly live: boolean;
}

// At a quiescent cell boundary only (§5.1). Legal on a freshly
// constructed engine (before any cell) — clients take that as cp[0] so
// an edit of the FIRST cell gets checkpoint-tier treatment too.
ce.checkpoint(label?: string): EngineCheckpoint;

// Rewinds engine state to the moment cp was taken. Invalidates every
// checkpoint taken AFTER cp. cp itself stays live (restorable again).
ce.restore(cp: EngineCheckpoint): void;

// Releases cp's restore capability. Restoring PAST a discarded interior
// checkpoint remains possible via any earlier live one (§4b — its
// journal window is folded, not freed). Discarding the OLDEST live
// checkpoint frees its window outright: state before it becomes
// unreachable by restore.
ce.discard(cp: EngineCheckpoint): void;
```

**Error contract.** Every refusal is a typed error, thrown BEFORE any
live state is written (the call is then a no-op):

| Condition | Error | Thrown by |
|---|---|---|
| Quiescence (§5.1) not satisfied | `checkpoint-not-quiescent` | all three |
| `cp.live === false` (restored-past or discarded) | `checkpoint-dead` | restore, discard |
| `cp` belongs to a different engine | `checkpoint-foreign-engine` | restore, discard |
| A throw escaped restore's mutation phase | `checkpoint-restore-failed` (engine poisoned — §6a) | restore |

The intended flow: take `cp[0]` at session start, `cp[i]` after cell
*i*. On an edit of cell *k*: `ce.restore(cp[k-1])`, replay cells k…n,
taking fresh checkpoints as it goes. Checkpoints form a **stack**
(LIFO): restore targets any live checkpoint, and everything above it
dies. This is deliberately NOT a general time-travel/branching facility
— one linear history, rewound and re-extended.

Client-side responsibilities that the engine does NOT take on:

- **Deciding what to replay** (all cells after k, or a dependency cone —
  the engine is agnostic; replaying everything after k is always
  correct).
- **Caching cell OUTPUTS as serialized artifacts.** A live
  `BoxedExpression` retained across a restore is subject to the epoch
  rules of §8 — outputs a client wants to redisplay without re-running
  must be serialized (or otherwise detached) before the restore, never
  held as live boxed nodes from the discarded window.
- **The effectful-cell story**: `Print` re-prints, `Input` re-prompts,
  `Random()` re-draws on replay
  (`library/core.ts:6638-6647`, `:6869-6920`). The engine makes replay
  *possible*; presentation of re-executed effects is the client's.

## 4. Architecture: snapshot the bounded, journal the unbounded

Restore must rewrite existing records **in place** and advance monotone
counters — never swap registry or definition objects — because live
boxed expressions capture record identity (audit §3, structural facts 1
and 2; `index.ts:571-574`, `binders.ts:102-109`). This is also a
CONSUMER-FACING hard property, not just an internal constraint: Tycho
(2026-08-18 answers, Q2c) holds the design to pre-edit cells keeping
definition IDENTITY across a restore, because CE's collection element
memo validates dependencies by binding identity and a
full-re-registration gesture once made every memo cold on every pass at
Desmos scale (their D-203 / CE item 127). Identity preservation is what
makes restore-then-replay CHEAPER than their current full re-run, not
merely equivalent to it. Given that, each state family is covered one
of three ways:

**(a) Eager snapshot at `checkpoint()`** — for families whose size is
bounded and small at a cell boundary:

| Family | Mechanism |
|---|---|
| Type registry | `ce._typeRegistryRollbackPoint()` (`index.ts:564-692`) — reused as-is: per-record field snapshot, name-table add/delete tracking, conditional axis bumps |
| Protocol registry + conformance edges | `ce._protocolRegistryRollbackPoint()` (`index.ts:694-806`) — ditto |
| Assumptions | copy the current `EvalContext.assumptions` `ExpressionMap` per frame of the context stack (assumption counts are small; the 10 mutation sites are confined to `assume.ts`/`engine-assumptions.ts` — re-verified for this design). Scope pushes COPY the parent map (`engine-scope.ts:56`), so only the notebook's own scope level needs the snapshot; restore `_assumptionsDirty` and `assumptionBindings` with it |
| Host configuration | **structural copies, not references**, for the stores that mutate in place: the three rule stores (arrays — `push`/`splice` reachable), `_compilationTargets` (map contents), runtime limits, LaTeX OPTIONS. Scalar config: `precision`/`tolerance`/`angularUnit`, `strict`, `_jit`, `_cost`, `_integrationProvider` (references are fine for these). Restoration is ORDERED: precision before tolerance, because setting precision resets tolerance (`engine-numeric-configuration.ts:53-55`). LaTeX DICTIONARY mutations are a host-precondition exclusion (§5.5a), not a covered family |
| Sequence registries | snapshot the engine's `sequenceRegistry` and `pendingSequences` entries — per sequence: metadata, recurrence, the nested base-case maps (copied), and presence/absence — so a restore reinstates a REPLACED sequence and undoes additions to a pre-existing pending one, not merely deletes window-created names. Value memos are cleared wholesale on restore (unstamped; over-invalidation is a recompute). Bounded: sequence counts are small at a cell boundary |

**(b) Copy-on-write journal during the window** — for families that are
unbounded or high-volume.

**Window semantics (normative):** at most ONE journal window is ACTIVE
at any time. A window opens at `checkpoint()` and closes at the earlier
of: the next `checkpoint()` call, or a `restore()`/`discard()` involving
its checkpoint. Each closed window remains attached to its checkpoint.
So under the recommended flow the write path always records into exactly
one window — one Set lookup per write (the §7 cost model) — and the
first write to each (record, field) key **per window** records the prior
value; later writes to the same key in the same window are free.

- `restore(cp)`: the undo set is the concatenation of every window
  YOUNGER than cp plus the active window, applied newest-window-first
  (within a window, entries are independent by construction —
  first-write-wins makes each entry carry the value at window open). A
  successful restore opens a FRESH active window for cp (with an empty
  dedup Set): cp remains restorable again.
- `discard(cp)`, cp not the oldest live checkpoint: cp's window is
  FOLDED into the next-older live checkpoint's window — cp's entries are
  appended, dropping any (record, field) key the older window already
  holds (the older window's prior-value is earlier in time and wins).
  Cost O(|cp's window|). This is what keeps "restore past a discarded
  interior checkpoint" sound.
- `discard(cp)`, cp the oldest live checkpoint: the window is freed
  outright — state older than the next-younger live checkpoint becomes
  unreachable by restore, which is the documented meaning of discarding
  the base.

Worked lifecycle (`cp1; w1; cp2; w2; cp3; w3` where wᵢ are writes):
`restore(cp2)` undoes w3, w2 (cp3 dies, cp2 live with a fresh window);
`discard(cp2)` instead folds w2's window into cp1's (cp3 unaffected;
`restore(cp1)` later undoes w3 + w2 + w1); `discard(cp1)` first frees
w1's undo data (cp1's state unreachable; cp2/cp3 unaffected).

Journaled families:

| Family | Hook points |
|---|---|
| Value-definition writes (the coupled tuple) | §5.2 funnels 1–2 |
| Operator-definition writes and half-swaps | §5.2 funnels 3 and 6 |
| Scope-map mutations (binding created, OVERWRITTEN, or removed in an existing scope) | §5.2 funnel 4 — journaled as `{scope, name, hadEntry, previousBinding}` and restored **by binding identity** (a name-only record cannot reinstate an overwritten binding — the shipped `journalDeclaration` saves the previous binding object for exactly this reason). Covers the generic declare path AND the direct set/delete sites for minted type constructors and protocol dispatchers |
| Enumerated bare-field writes | §5.2 funnel 5 |
| **Object slot writes** (`BoxedObject` `_store`) | §5.3. Easy to miss and REQUIRED: an object created in cell j &lt; k and mutated by the old cell k would otherwise carry the stale write into the replayed world, breaking §2 |
| Unstamped expression-keyed memos: `RESOLVED_TYPE_OPERANDS` (`function-literal.ts:54`) and `probeCache` (`symbolic/limit.ts:859`) | §5.2 funnel 7 — both audit-flagged as stale under in-place restore; a pre-checkpoint node first RESOLVED during the window retains a window-state entry across restore. Journal the two `.set` sites (key + prior absence), delete on restore |
| Forward-reference registry entries | already journal-shaped (`provisional-application.ts`, inference-rollback family 5) — the checkpoint window extends the same hooks |

**(c) Purge / bump / re-derive at `restore()`** — for derived state where
over-invalidation is safe and cheap (§6 steps 6–9): unversioned caches,
sequence memos, clause-provenance side channels, dispatcher re-sync,
version counters.

### Why the journal must NOT be an `InferenceRollbackFrame`

The effects derivers refuse to stamp their memos while
`ce._rollbackFrames.length > 0` (`engine-protocols.ts:3743-3763`,
`boxed-operator-definition.ts:734-765`), because an inference frame's
undo advances no counter — a memo stamped inside the frame would survive
the undo stale. A checkpoint window held open for a whole cell (or many
cells) under that rule would disable memo stamping engine-wide, a
performance disaster. The checkpoint journal is therefore a SEPARATE
mechanism, and it is exempt from that rule **because its restore does
advance the counters** (§6 step 8): every memo stamped during the window
is correctly invalidated by the restore's bumps. This exemption is a
load-bearing design point — reviewers should check it, and the
differential harness (§10) is its empirical guard.

## 5. Coverage details

### 5.1 The quiescence precondition

`checkpoint()`, `restore()`, and `discard()` are legal only at a cell
boundary in the engine's base state, and throw
`checkpoint-not-quiescent` otherwise. The precondition, exhaustively:
`_staticTypeCheckDepth === 0`, `_staticAssignmentEvidence === undefined`,
`_epsilDeclarationRoute === false`, `_epsilBatchId === undefined` (no
`executeEpsil` extent is open — audit §1 R4 territory),
`_rollbackFrames` empty, `_inferenceTxDepth === 0`, no open boxing
repair frames, **no in-flight evaluation** — including an async
evaluation suspended at an `await`, which holds its context across the
suspension (`engine-scope.ts`, `removeEvalContext` doc) and is NOT
reliably visible as stack depth alone, so the engine keeps an explicit
in-flight evaluation counter and the three calls refuse while it is
nonzero — and context-stack depth equal to the depth at cp's creation
(for restore/discard) or the session base (for checkpoint). This turns
the transient families from "must snapshot" into "must be absent", which
is both cheaper and a standing invariant check.

### 5.2 Definition-record writes — choke points (verified 2026-08-18)

**Verdict: a small closed set of funnels — no single funnel exists.** A
journal hooking only the value setter is silently incomplete. The
complete hook set:

1. **`_BoxedValueDefinition.set value`**
   (`boxed-value-definition.ts:336-390`) — the hot path. All
   user-reachable callers funnel through `setSymbolValue()`
   (`engine-declarations.ts:621`), plus `installRebuiltLiteral`
   (`function-utils.ts:798`), assumption install/forget
   (`assume.ts`/`engine-assumptions.ts`), and the ephemeral
   comprehension-index writes (`control-structures.ts:1674/1688` —
   bracketed by `_ephemeralWriteDepth`; the journal skips writes made
   at ephemeral depth, or tolerates them: first-write-wins restores
   correctly either way since the frame restores the saved value
   itself). **Hook records the whole coupled tuple, not just `_value`.**
2. **`_BoxedValueDefinition.set type`** (`:533`) and
   `_setElementRefinement` (`:567`) — the type setter is a hidden VALUE
   writer: an explicit write to `unknown` wipes `_defValue`/`_value`
   with no `value-write` event (`:552-560`; the
   `value-def-unknown-type-clears-value` trap). Same tuple hook.
3. **`updateDef()`** (`boxed-expression/utils.ts:1198-1387`) — the
   half-SWAP route (value→operator and back, `let f = …` → lambda).
   Fifteen call sites, one hook: record
   `{record, prevValueHalf, prevOperatorHalf, constructedHalves}` —
   `updateDef` already builds exactly this for the inference-rollback
   frame at `:1325-1342`, including the constructed-vs-caller-supplied
   discriminator §6 step 5 needs.
4. **The declare path** (`declareSymbolValue`/`declareSymbolOperator`,
   `engine-declarations.ts:504-515`, `:555-562`) — a FRESH declaration
   constructs the definition with its value already inside
   (`new _BoxedValueDefinition(ce, name, {value})`), so no setter ever
   fires. This carries the very first assignment of every new name —
   the most common notebook write. `journalDeclaration`
   (`engine-declarations.ts:453-476`) is the ready-made undo, and it
   already restores the PREVIOUS binding by identity when the declare
   overwrote one — the behavior §4(b)'s scope-map family generalizes.
5. **Enumerated bare-field writes**, routed through a small
   `journalDefField(def, field, oldValue)` helper at each site:
   `inferredType` (8 sites), `holdUntil` (`library/core.ts:4128/4161`),
   `effectsDeclared` (`library/core.ts:4118`,
   `multi-clause.ts:898/902`), `_typeProvenance` (3 sites),
   `_placeholderSkeleton` (via `_setElementRefinement`), and the
   `_isConstant` write-through-cast at `library/core.ts:4138-4142`
   (user-reachable via `let x = 5 { constant: True }` — a restore that
   misses it leaves the binding permanently frozen).
6. **`_BoxedOperatorDefinition._update`** (reached by
   `installRebuiltLiteral` and the first-definition upgrade routes) —
   an IN-PLACE operator-def mutation that can change `signature`,
   `inferredSignature`, `_lambdaLiteral`, handlers, `_effects`,
   `_deriveEffects` without any half-swap. The inference transaction
   covers it with `_rederivationSnapshot()`; the checkpoint journal
   reuses that snapshot as its entry.
7. **The two unstamped expression-keyed memos** (§4b table):
   `RESOLVED_TYPE_OPERANDS` and `probeCache` `.set` sites.

**Snapshot schemas are part of the deliverable.** "The full field set"
must exist as two concrete, exhaustive snapshot types — one per
definition class — with a review checklist rule: adding a mutable field
to either class requires extending its snapshot type and a test. The
existing `_typeSlotSnapshot()` (`boxed-value-definition.ts:399-445`)
captures 6 of the ~16 mutable value-def fields — not
`_placeholderSkeleton`, `_isConstant`, `holdUntil`, `_typeProvenance`,
`collection`. A probe (2026-08-18) of the most plausible harm scenario —
`let a: list`, then a static-check pass over an assignment — came back
NEGATIVE: the skeleton survives, because the shipped inference round
routes static-pass assignment effects through the
`_staticAssignmentEvidence` side map and the type setter deliberately
MAINTAINS the skeleton. So this is not a demonstrable defect today, but
the checkpoint tuple MUST be the full field set, not the 6-field
inference tuple.

**Integrity canary:** `ce._noteStateEvent`
(`engine-configuration-lifecycle.ts:314`) is a proven single choke
point (state-events.test.ts pins that no axis write exists outside it).
It cannot BE the journal (no old value, no record identity in the
payload), and raw event COUNTS cannot be compared against a
deduplicated journal (repeated writes to one key emit many events but
one entry — guaranteed false positives). The canary instead compares
KEY SETS: in test builds, each mutation hook records its (record, field)
key into a per-window pre-dedup set, and the harness checks that every
`value-write`/`declare`/`redefine`/`type-write`/`object-store` event in
the window has a corresponding hooked key. A surplus EVENT KIND with no
hooked key is a bypass (§10).

Sequences (`a_n := …`) bypass the binding model entirely into
module-level WeakMaps — covered by the §4(a) sequence snapshot, not by
this journal. The type-registry in-place mutation on redeclaration is
covered by the registry snapshot (§4a) — and becomes an error anyway
under the strict posture.

### 5.3 Object slot writes — choke points (verified 2026-08-18)

**Verdict: a single clean funnel.** `BoxedObject._store()`
(`boxed-object.ts:388-404`) is the ONLY writer of `_slots` in the tree
(the constructor aside), with exactly three callers — `objectFieldStore`
(`library/collections.ts:1466`) and the two `fieldSetter` branches
(`engine-protocols.ts:1535/1545`). An authored Epsil `set` accessor
reaches the slot only by executing `self.x = v` back through the same
funnel. The compiled tier CANNOT bypass it: `Assign(Field(…))` fails
closed ("objects have no compiled representation",
`base-compiler.ts:4537-4560`).

Hook placement: inside `_store`, after the identity no-op guard at
`:394` (the old value is already in hand there) and before the
`_slots.set` at `:401`. Two details:

- **Record `has(name)` alongside the old value** — `_store` can create
  a previously-absent slot (the unchecked no-layout branch), and
  `undefined` is ambiguous between "absent" and "present but
  undefined"; the undo needs `_slots.delete(name)` for the absent case.
- **`_version` is bumped on restore, never restored** — the same
  monotone-counter doctrine as everywhere else; `_store` bumps it
  unconditionally on every real write (`:402`), and §6 step 8 bumps
  each restored object once more after its slot undos.

Other containers need NO hooks: dictionaries are immutable
(`BoxedDictionary._keyValues` is written only at construction), lists
are copy-on-write (`Append` rebuilds; no `Push`/`Pop`/`SetAt` mutator
exists; `.ops` arrays are never index-assigned). Object CONSTRUCTION
after the checkpoint needs no journal either — the binding journal
drops the references, and `_serial` stays monotone (identity hashes;
§8).

### 5.4 Module-level engine-keyed state

- **Sequences**: covered by the §4(a) structural snapshot (registry +
  pending, nested base maps, presence/replacement state); all sequence
  value-memos cleared on restore.
- **Clause-provenance side channels** (`clause-identity.ts:50/73/74`):
  restore calls `clearClauseProvenance(def)` for every definition record
  the journal touched (the WeakMaps are keyed on record identity, which
  restore preserves).
- **Library-load idempotence markers** (`fungrim/loader.ts:664`,
  `rubi/loader.ts:49`): if a restore undoes declarations that a loader
  installed, the marker would skip a needed re-load. V1 policy: clear the
  engine's marker entry on restore (re-load is idempotent and rare).
- **`MUTABILITY_GATE_MEMO`** (`engine-protocols.ts:527`): keyed on
  `record.members` object identity; the protocol rollback restores the
  members FIELD to the prior object wholesale, so entries keyed on a
  replaced members object simply become unreachable. No action needed —
  but this depends on members being swapped, never mutated in content;
  noted as an invariant.

### 5.5 Process-global state

- **`BigDecimal.precision`**: restoring the engine's numeric
  configuration goes through the ordinary setter, which writes the
  process global (`engine-numeric-configuration.ts:53`) — so within a
  single-engine process, restore heals it. Multi-engine processes remain
  exposed exactly as today (audit §3 hazard 1) — and Tycho has told us
  (2026-08-18 answers, Q7a) that a multi-engine page is their NORMAL
  case (notebook engine + plot-element engines + validator engines
  simultaneously), so this is NOT an edge case to document away: it is
  a pre-existing hazard now tracked as its own ROADMAP item
  (engine-scoped precision), out of THIS design's scope but not out of
  scope generally.
- **`epsilBatchCounter`** (`execute-epsil.ts:116`): NEVER rewound —
  origin stamps hold its values, and a reused id would falsely merge two
  units. Monotone by design; nothing to do.
- The remainder of the audit's hazard shortlist (`_defaultEngine`,
  `_mapAutoCompileStats`, `_objectsExist`, compiler statics, Rubi
  `activeCaches`, `STEP_LABELS`, `TYPE_SATURATED_SETS`, GCD `budget`):
  documented as outside the checkpoint's contract. None of them affects
  §2's observational equivalence for mathematical results; the compiler
  statics and Rubi caches are bracketed per call today.

### 5.5a Host preconditions (excluded from §2, enforced by contract)

During a checkpointed session the host must not: mutate LaTeX
dictionaries (parse/serialize tables), swap the injected `LatexSyntax`,
or register/unregister compilation targets outside the declared prelude.
These are host-configuration acts, not cell semantics; the API cannot
observe all of them cheaply, so they are stated preconditions — violated
means §2 no longer holds, by contract rather than by bug. (Rule-store
edits and numeric-config changes ARE covered — §4a — because user
programs can reach them.)

## 6. The restore algorithm (ordered, two-phase)

**Phase 1 — validate and collect (no live writes).** Check `cp.live`,
engine ownership, quiescence (§5.1). Assemble the full undo plan: the
merged window list (§4b), the registry rollback thunks, the snapshot
set, the disposal list (every definition record and every
`updateDef`-CONSTRUCTED half created in the merged windows — the
constructed-vs-supplied discriminator rides in the funnel-3 journal
entries), and the purge list. A throw in this phase leaves the engine
untouched and the checkpoint stack unchanged (typed errors, §3 table).

**Phase 2 — mutate.** Designed not to throw: every step below is plain
field assignment, map surgery on collected entries, or a bump. `dispose`
calls are wrapped; a listener that throws is collected, not propagated.
If a throw nonetheless escapes, the engine is **poisoned**: the call
raises `checkpoint-restore-failed`, every subsequent
`checkpoint()`/`restore()`/`discard()` on this engine refuses with the
same code, and the documented remedy is Tier 0 — discard the engine,
rebuild from B by full replay. A poisoned engine is otherwise usable at
the caller's risk; the flag exists so the client can detect and rebuild
rather than trust §2.

1. **Invalidate and merge**: mark every checkpoint above `cp` dead;
   merge their windows plus the active window into the undo sequence
   (newest-first, §4b).
2. **Journal undo**: rewrite journaled (record, field) pairs back to
   their prior values, in place; scope-map entries reinstate the
   PREVIOUS binding object by identity (or delete, per `hadEntry`);
   object-slot entries restore or delete per their `has` bit; the two
   expression-keyed memos drop window-created entries.
3. **Registry rollbacks**: run cp's type- and protocol-registry rollback
   thunks (they conditionally bump; their `_declOrigin`-family restores
   stay silent, as shipped).
4. **Snapshot restores**: sequence registries (§4a), host configuration
   through the ordinary setters in dependency order — precision BEFORE
   tolerance (setting precision resets tolerance) — rule stores and
   compilation targets from their structural copies.
5. **Dispose created definition state**: every definition record created
   in the merged windows, AND every `updateDef`-constructed half
   orphaned by step 2's half restores, is `dispose()`d exactly once so
   constant config-listeners unsubscribe
   (`boxed-value-definition.ts:577-582`; audit §3 gap 11 — skipping
   this leaks listeners for the engine's lifetime). Caller-supplied and
   pre-existing halves are never disposed.
6. **Assumptions restore**: replace each context frame's assumptions
   contents from the snapshot (mutating the existing `ExpressionMap`),
   with `_assumptionsDirty` and `assumptionBindings`.
7. **Purges**: `_cacheStore.purgeValues()` (it has no version key —
   audit §3; note the `getOrBuild` first-closure trap:
   `numerics/special-functions.ts:782-795` — purge semantics must
   re-run the ORIGINAL registered builder, verify per call site);
   sequence memos (§5.4); `clearClauseProvenance` per touched record;
   clear the engine's library-load markers touched in the window.
8. **Bump**: `_noteStateEvent({kind:'config'})` (all four axes),
   `_noteConformanceRegistryChange()` (the fifth axis — NOT covered by
   state events, audit §3 gap 10), `_writeVersion += 1` on every
   definition record the journal rewrote (the element memo and
   map-auto-compile key on per-record versions, audit §3), and
   `_version += 1` once on every `BoxedObject` whose slots step 2
   touched — after all of that object's slot undos.
9. **Re-sync derived scope state**: `syncProtocolDispatchers` against the
   restored registry (the registry thunk restores the registry only —
   `engine-protocols.ts:348-351`).
10. **Reopen**: cp becomes the live top of the stack with a fresh,
    empty journal window; restorable again.

Order rationale: journal undo before registry rollback is safe because
the two touch disjoint fields (definitions vs registry records); both
before disposal so a disposed def is not written afterward; bumps after
all writes so nothing recomputes against half-restored state; dispatcher
re-sync last because it reads the final registry.

### 6a. Failure summary

Phase-1 throws: no-op, recoverable, typed. Phase-2 throws: engine
poisoned, `checkpoint-restore-failed`, remedy is Tier 0. The
differential harness includes restore-failure injection (§10) to pin
that phase-1 refusals really are no-ops and that poisoning is detected.

## 7. Cost model

- `checkpoint()`: O(|type registry| + |protocol registry| + assumptions
  + sequences + config copies) for the snapshots, O(1) journal setup.
  The registry snapshots dominate; if profiling shows it matters for
  large registries, v2 moves the registries into the copy-on-write
  journal too (making `checkpoint()` O(assumptions)) — the audit's
  per-record field lists make that mechanical. Not v1.
- During the window: one Set lookup per definition/object write against
  the single ACTIVE window (§4b — windows never overlap); a journal
  entry on first touch of each (record, field).
- `restore()`: O(merged journals + registries + purges). `discard()`:
  O(|discarded window|) for the fold. All bounded by state actually
  touched since the checkpoint — a cheap cell restores cheaply.

## 8. Non-guarantees and expression epochs (part of the client contract)

- **Object identity across replay**: replayed constructions get fresh
  serials (`boxed-object.ts:53`); `===`-style identity and identity
  hashes differ from the original run. Values compare equal.
- **Expression epochs.** A `BoxedExpression` created BEFORE `cp` remains
  valid across `restore(cp)` — its definitions were rewritten in place
  back to their cp-state, which is exactly §2's contract. A boxed
  expression created DURING a discarded window is **invalid after the
  restore**: it may reference disposed definition halves, and
  evaluating, typing, or serializing it is undefined behavior (not
  memory-unsafe, but not covered by §2). Clients cache cell outputs as
  serialized artifacts, not as live nodes (§3).
- **Effects**: `Random()` re-draws; `Print`/`Input` re-execute; wall
  clock differs. (§3; audit §3 "replay is not semantically
  transparent".)
- **Process-global residue** in multi-engine processes (§5.5) and host
  precondition violations (§5.5a).
- **No branching**: restoring invalidates later checkpoints; there is no
  fork.

## 9. Prerequisites and sequencing

1. **R1 first** (audit §2): make same-statement re-registration
   idempotent. Independent value (removes a measured ~1.2 ms resettle
   sweep per `type` statement) and required before ANY posture change;
   the checkpoint work does not strictly depend on it, but landing R1
   first keeps the differential harness's baselines clean.
2. **Stage C1 — journal infrastructure**: the copy-on-write journal, the
   §5.2/§5.3 hooks, window lifecycle (§4b), first-write dedup, unit
   tests per family. **SHIPPED 2026-08-19** —
   `src/compute-engine/checkpoint-journal.ts` (a leaf module),
   `ce._checkpointWindow` as the active window, and
   `test/compute-engine/checkpoint-journal.test.ts`.

   One departure from §5.2 worth recording: funnel 5's per-field
   `journalDefField(def, field, oldValue)` was NOT built. Since the same
   section requires the snapshot tuple to be the FULL mutable field set,
   one whole-record snapshot per record per window covers funnels 1, 2,
   5 and 6 together, and a per-field key would take more snapshots to
   cover the same state while restoring it no more faithfully. The hook
   is `journalDefinitionRecord(ce, def, kind)`; `kind` classifies the
   write for the bypass canary only. The completeness the design asks
   for is enforced rather than documented: a drift-guard test compares
   each snapshot's key set against the record's own property names and
   fails on any field that is neither captured nor listed as excluded.

   **C1 exit criterion — SETTLED, and it reproduced.** With
   `f(x) = x + 1`, reading `ce.box(['f', 2]).type` (`number`), then
   redefining `f(x) = "hello"`: the same node kept answering `number`
   while a freshly boxed one answered `string`, permanently. The premise
   the `undefined` key rested on — "nothing can change an all-constant
   pure node's answer" — holds for the OPERANDS and not for the
   OPERATOR, and this is a live staleness defect independent of
   checkpoint/restore; a restore reaches the same entries the same way.
   Contingency taken: the first of the two named options — `_type`,
   `_sgn` and the `_eagerSource` slot in `at()` key on `_anyVersion`
   unconditionally. Measured cost: none (full suite 250.1 s → 242.4 s,
   identical test and snapshot counts; the only regression is a
   synthetic loop re-reading six constant nodes across 300 generation
   bumps, +6 ms over 1800 reads). The lazy-collection evaluate memo
   (`_lazyCollectionMemoKey`) KEEPS its constant key: a hit there also
   requires `_lazyValueEpoch === _worldVersion`, and a redefinition
   advances the world version, so its entries do expire — and a restore
   bumps `config`, which advances it too.
3. **Stage C2 — `EngineCheckpoint`**: compose journal + the two registry
   rollback points + snapshots + the §6 algorithm behind the §3 API,
   including the error table and poisoning semantics.
4. **Stage C3 — differential harness** (§10) + the audit's targeted
   stale-memo probes + the lifecycle/failure matrix.
5. **Then** the strict-posture flip itself (the audit's §6 ordered list)
   can proceed, gated on the Tycho ruling (workstream 3) — the
   checkpoint API ships first so the client migration has something to
   migrate TO.

Explicitly NOT blocked on the audit-§4.4 rulings (box-route scope,
monotone completion): the checkpoint semantics are identical under every
answer to those.

## 10. Testing strategy

- **Differential oracle** (the §2 equation, run both sides from the
  same baseline B): randomized cell sequences over a vocabulary
  covering every journaled and snapshotted family — assignments,
  type/protocol/conformance declarations, function clauses, object
  construction + slot mutation, sequences, assumptions, precision and
  rule-store changes — with restore-and-replay at random edit points,
  including REPEATED restores of one checkpoint and interleaved
  discards.

  **Comparator table** (how ≡ is checked per artifact, excluding the §8
  non-guarantees):

  | Artifact | Comparison |
  |---|---|
  | Evaluation result | canonical MathJSON `.json` equality after stripping identity-bearing fields (object serials/hashes); numeric literals via `.isSame` |
  | Types | `type.toString()` equality (declared and inferred both) |
  | Diagnostics | code + source-range + `where` operand |
  | Serialization | string equality of `toString()` and LaTeX output |
  | `About()` | dictionary equality minus identity-bearing entries |

- **Lifecycle/failure matrix**: every §3 error condition (non-quiescent
  calls incl. a SUSPENDED async evaluation, dead checkpoint, foreign
  checkpoint, double discard), restore-failure injection (phase-1
  refusal is a no-op; a forced phase-2 throw poisons detectably),
  checkpoint on a fresh engine (cp[0]), discard of top/middle/oldest,
  and history re-extension after restore.
- **Targeted probes** from the audit's flagged uncertainties: ~~the
  all-constant-pure `undefined`-key memo entries~~ RESOLVED 2026-08-19 —
  it reproduced, and the entries now key on the generation (§9); what
  remains for the harness is the lazy-collection memo, whose constant
  key survives behind its `_lazyValueEpoch` gate,
  the `getOrBuild` first-closure trap, a REPLACED sequence and a
  pre-existing pending sequence extended in the window, dispatcher
  effects memoized mid-window, and a pre-checkpoint expression whose
  `RESOLVED_TYPE_OPERANDS`/`probeCache` entry was created in the
  window.
- **Leak checks**: listener count stable across
  checkpoint/mutate/restore cycles (including `updateDef`-constructed
  halves); journal windows freed on discard; no scope map growth.
- **Bypass canary in CI**: per window, every counted
  `value-write`/`declare`/`redefine`/`type-write`/`object-store` state
  event must have a corresponding entry in the hooks' pre-dedup KEY set
  (§5.2) — an event kind with no hooked key is a write the journal
  missed. (Raw counts are NOT compared — first-write dedup makes them
  incomparable by design.)

## 11. Open questions

1. ~~Choke-point verification~~ RESOLVED 2026-08-18 — results in
   §5.2/§5.3. Two defects found during verification were fixed the same
   day (see `symbol-value-setter.test.ts`): the `BoxedSymbol.value`
   setter's input dispatch converted any boxed non-numeric value to a
   complex NaN (the `'re' in value` sniff matched BoxedExpression
   getters), and its function branch installed a raw object literal
   instead of routing through `updateDef`.
2. ~~LaTeX dictionary~~ RESOLVED as a host precondition (§5.5a).
3. ~~Whether `checkpoint()` at depth &gt; session-base should be
   supported~~ RESOLVED 2026-08-18 by Tycho's answers (Q7b): their
   cells ALWAYS evaluate inside a host-pushed scope, but between passes
   their engines sit at session base — so v1's session-base restriction
   covers their correctness use ("checkpoint the initialized base once;
   restore before a pass when engine-global residue needs reset").
   Per-cell checkpoints — their deferred incremental-recompute
   optimization (their spec's D13/D18) and this design's latency story
   — REQUIRE in-scope checkpoints. **In-scope checkpoints are therefore
   a COMMITTED v2 item, not a revisit-if-needed**: v1 ships
   session-base; v2 extends the quiescence/depth rules to a
   host-declared checkpoint scope depth.
4. Naming: `checkpoint`/`restore`/`discard` vs `mark`/`rewind`. Cosmetic;
   decide at implementation review.
