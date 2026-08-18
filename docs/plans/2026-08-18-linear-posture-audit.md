# Audit: the deletion dividend of a strict "linear" posture

**Date:** 2026-08-18 · **Status:** workstream 1 (this audit) COMPLETE;
workstream 2 (checkpoint API design) and 3 (Tycho feasibility questions)
not started ·
**Decision this feeds:** whether the engine should drop in-place cross-batch
redefinition (the notebook "re-run an edited cell" gesture) in favor of a
strict single-regime semantics, with notebook clients (Tycho) doing
checkpoint/restore + replay instead.

## Background

The engine currently supports two regimes, selected by the batch boundary
(`ce._epsilBatchId`, one `executeEpsil` = one compilation unit):

- **Within one unit**, redefinition of a `type` / `protocol` / sum-variant
  name, and same-parameter-list function-clause replacement, are ERRORS —
  the redefinition discipline, shipped 0.108.0
  (`docs/plans/2026-08-14-redefinition-discipline.md`).
- **Across units** (separate `executeEpsil` / `ce.parse().evaluate()`
  calls), a redefinition REPLACES the previous definition, and the engine
  propagates the replacement in place: conformance edges are re-settled
  (work package 2D, `resettleTypeConformances`), stale receivers are
  guarded via pinned layouts, stored values are retyped on alias
  redefinition, version axes are bumped, memos invalidated.

A prior ruling (2026-08-14, recorded in the redefinition-discipline plan)
REJECTED a global "interactive vs compile" mode flag, because the static
pre-pass runs inside interactive evaluation; the batch became the regime
selector. The proposal audited here is not a mode flag — it removes one of
the two regimes, so the selector collapses: across-unit redefinition would
error exactly like within-unit redefinition, and the notebook gesture would
be implemented by the client as "restore the checkpoint taken before the
edited cell, replay from there".

## What this audit answers

1. **Deletion dividend** — every mechanism whose only purpose is (a)
   distinguishing within-unit from across-unit, or (b) propagating an
   in-place replacement; with LOC and pinning tests. (Machinery serving the
   linear path — forward-reference fulfillment, the static pre-pass
   registry transaction — is explicitly out of the dividend.)
2. **Global-state inventory** — everything a checkpoint/restore primitive
   must cover for client-side replay to be sound: engine-instance state,
   module-level mutable state, process-global hazards, and memo soundness
   under restore.
3. **Blast radius** — tests that pin across-unit replacement (they flip to
   error pins), open ROADMAP items mooted by the strict posture, and
   documentation that promises the current semantics.

Out of scope here (workstreams 2 and 3): the checkpoint API design, and the
feasibility questions to put to Tycho (replay cost, effectful cells —
`Random()` / `Input()` / `Print` / object mutation make replay
non-transparent and need a client-side story).

## 1. Batch-boundary and redefinition-discipline machinery

**Headline (this inverts a premise of the proposal):** the batch
distinction itself is a **~46-line dividend (~60 with batch-only comment
prose), not a subsystem**. The bulk of the discipline's apparatus is
statement identity and two-tier diagnostic plumbing, and that part is
load-bearing on the LINEAR path: one `Declare*` / `DefineFunction`
statement registers **2–3 times per run** (static-pre-pass
canonicalization, eval-loop canonicalization, evaluation — see the paired
canonical/evaluate handler registrations in `library/core.ts`), with no
rollback between the last two. Under "name already declared = error,
period" with the stamps deleted, a lone `type Foo = integer` would report
`type-redefinition` against **itself**. Self-registration immunity
(`statementId`, `sameStatement()` source-range matching, P47's `block`
identity) must survive any posture.

Classification used throughout this audit: **S** = exists solely for the
across-unit regime (dead under the strict posture) · **P** = partial ·
**K** = keep regardless.

### Strictly-S inventory (dies with the batch)

| Item | Location | LOC |
|---|---|---|
| `DeclarationOrigin.batch` field | `src/common/type/types.ts:557-558` | 2 |
| The two batch compares | `src/compute-engine/declaration-origin.ts:68`, `:101` | 2 |
| `IComputeEngine._epsilBatchId` + doc | `src/compute-engine/types-engine.ts:554-564` | 11 |
| `ComputeEngine._epsilBatchId` | `src/compute-engine/index.ts:554-555` | 2 |
| `epsilBatchCounter` + mint/restore window | `src/epsil/execute-epsil.ts:113-136` | 22 |
| `statementOrigin`'s batch read/guard | `src/compute-engine/library/core.ts:1255-1256` | 2 |
| P47's batch half (`_implOrigin.batch`) | `src/compute-engine/engine-protocols.ts:944` area, `types-engine.ts:306` | ~5 |
| **Total** | | **≈ 46** |

`ce._epsilBatchId` has exactly three consumers engine-wide (verified by
grep): `statementOrigin` (`core.ts:1255`), the P47 implementation-block
duplicate check (`engine-protocols.ts:944`), and `executeEpsil`'s own
mint/restore. The end-of-batch `protocol-implementation-pending` warning
does NOT read it — it depends on the batch *extent* (the `executeEpsil`
call), not the id.

### P/K machinery that stays either way

- **`declaration-origin.ts`** (157 lines, minus the 2 batch compares):
  `RedefinitionError`, `sameStatement()` (K — distinguishes "this
  statement's second boxing" from "a second statement", not units),
  `firstSite()` (K — the runtime tier's only way to render *where* the
  first declaration was; the registry has no source text).
- **`clause-identity.ts`** (188 lines): `sameParameterDomain` and
  `clauseSignatureOf` are clause-install/dispatch semantics (2 of 3
  callers exist regardless of posture); `CANON_INSTALL_SKIPPED` is the
  canonical route's own invariant; `SINGLE_CLAUSE_ORIGIN` survives minus
  the batch half; `clearClauseProvenance` is D6 assignment hygiene.
- **The static pre-pass collectors** (`src/epsil/static-diagnostics.ts`,
  ~355 lines around `:500-1047`): NOT deleted — **re-keyed**. They are
  pass-local because `epsil check` runs with no batch; under the strict
  posture the static tier must ALSO flag collisions against names declared
  by previous units, i.e. consult the live registries plus a pass-local
  overlay. Net LOC change plausibly zero or negative (see risk R6).
- **The route marker** `_epsilDeclarationRoute` + `withStatementRoute` +
  `statementOrigin` (~90–150 LOC across `types-engine.ts:579-600`,
  `core.ts:1212-1293` + 8 call sites, `execute-epsil.ts:258-272`,
  `static-diagnostics.ts:537-544`, `isDeclarationStatement`):
  **conditionally S** — it answers "which ROUTE is declaring" (statement
  vs re-entrant box vs host), which is orthogonal to units. Whether it
  dies depends on an unmade decision: if box-route `Declare*` also errors
  on redeclaration, it is dividend but re-entrant/looping host
  declarations break (risk R3); if box-route keeps replace semantics, it
  stays.
- **The three diagnostic codes** (`type-redefinition`,
  `protocol-redefinition`, `function-redefinition`) survive — the
  condition still exists; only its scope widens. What changes is
  **wording**: the CLI templates (`src/cli/format.ts:460-467`) and runtime
  messages (`declaration-origin.ts:73`, `:106`) all end by promising the
  notebook gesture ("to redefine it interactively, re-run it as a separate
  program") and must be rewritten to point at checkpoint/restore.
- **Both registries' rollback-tuple stamp entries**
  (`index.ts:595-603/665-672` types, `:736-742/758-762` protocols, ~29
  lines): K — the pre-pass transaction is check-without-commit machinery,
  needed in all regimes.

### Risks — where deleting the batch would change LINEAR-path behavior

- **R1 (severe). Self-collision on the second registration.** Each
  `Declare*` operator registers from both its canonical handler and its
  evaluate handler (`core.ts:4323/4337` DeclareType, `:4376/4383`
  DeclareSumType, `:4411/4418` DeclareProtocol; `:3216/:3269`
  DefineFunction). Drop the origin stamp and every declaration statement
  errors against itself. Pinned:
  `test/epsil/redefinition-discipline.test.ts:189`.
- **R2 (severe). Clause self-collision across boxings** — worse than R1
  because the failure mode is documented as SILENT (an install refused
  without an error surfacing). `sameStatement`'s range fallback is the
  only guard.
- **R3 (high). Re-entrant and host-API declarations.** A host operator
  that declares a type on every call (unstamped box route, replaces
  freely today) would break on its second call if the route distinction
  collapses. Pinned: `redefinition-discipline.test.ts:436`, `:540`;
  `test/compute-engine/protocols.test.ts:1095`.
- **R4 (high). Nested `executeEpsil` becomes a collision.** An inner run
  redeclaring an outer name is exempt today by fresh batch id
  (`execute-epsil.ts:127-135`; "a choice, not an oversight" per the design
  doc). Pinned: `redefinition-discipline.test.ts:567-620`. The strict
  posture must decide what a nested run's namespace is.
- **R5 (medium). Assignment/clause interaction.**
  `f(n)=1; f = x↦42; f(m)=2` is legal today because assignment clears
  clause provenance (`engine-declarations.ts:2042`,
  `static-diagnostics.ts:950-960`). "Is a bare assignment a
  re-declaration?" must be answered explicitly. Pinned:
  `redefinition-discipline.test.ts:850`, `:870`.
- **R6 (medium). The static tier must be re-keyed onto live registries**
  — and must then distinguish "declared by a previous unit" from
  "declared by this pass a moment ago" (the pre-pass registers under a
  transaction that rolls its own registrations back), a hazard the
  pass-local design deliberately avoided.
- **R7 (low). `firstRange` is the only "first declared here"** the
  runtime tier has; drop the stamp entirely and the error degrades to
  "already declared" with no site.
- **R8 (documentation). Every message/doc-comment promising the notebook
  gesture becomes false** — `format.ts:461/465/467`,
  `declaration-origin.ts:73/106`, `src/epsil/diagnostics.ts:34-37`,
  `types-engine.ts:296/336/560-562`, plus the design doc's own tables.

### The across-unit semantics being audited (consolidated table)

From `docs/plans/2026-08-14-redefinition-discipline.md:255-271` — what
"across-unit redefinition" means today, per construct; under the strict
posture every row becomes an error and the behavior moves to
client-side checkpoint/replay:

| Construct | Across-unit redefinition today |
|---|---|
| `type X = …` (non-object) | Registry record replaced in place |
| `type X = object<…>` | New type generation; existing instances keep their PINNED type/layout/conformances |
| Sum declaration | Replaces wholesale (all N+1 names); dropped variants stay ordinary nominal types |
| `protocol P { … }` | Protocol replaced; conformances re-validated; dispatchers re-synced |
| Conformance impl block | Replaces the stored block (P47) |
| Function clause, same parameter list | Replaces that clause |
| Function clause, new parameter list | Adds a clause (also legal within a unit) |
| Plain assignment | Rebinds (presumably KEPT under any posture — ordinary mutation) |

### Side finding (fixed during this audit)

`clause-identity.ts:69` and `:110` claimed `clearClauseProvenance` is
called from `updateDef()` (`boxed-expression/utils.ts`) — contradicting
`engine-declarations.ts:2037-2041`, which records that the `updateDef`
hook was deliberately REJECTED (recursion-knot retype wiped the stamp
mid-definition), and `boxed-expression/utils.ts` does not import
`clause-identity.ts` at all. Both comments rewritten in place to state the
actual caller (the assignment path, `engine-declarations.ts:2042`) and the
rejection rationale.

## 2. Replacement-propagation machinery

**Headline: ≈ 1,384 source lines classified strictly-S** (about 60%
comment/doc — this code is unusually heavily documented, but the doc goes
with the mechanism), plus **≈ 1,891 test lines** that are S in their
entirety (`protocol-type-redefinition.test.ts`, 45 tests / 1,428 lines;
`protocol-resettle-invariants.test.ts`, 13 tests / 463 lines).

**Blocking prerequisite (R1), before any deletion:** a declaration
statement takes the replace path **once per statement even with zero
cross-batch redefinition**. `DeclareType` registers from both its
canonical and evaluate handlers (`library/core.ts:4313-4342`); the second
registration passes the discipline check via statement-identity immunity
(`declaration-origin.ts:69`), is not a forward-ref fulfilment
(`existing.def !== undefined`, `engine-declarations.ts:832-833`), so
`replacesInPlace === true` (`engine-declarations.ts:881`) and the full
replace flow runs — including `resettleTypeConformances`. The resettle's
own perf note (`engine-protocols.ts:1922-1930`, verified) states it: a
plain `type` statement pays the sweep on "the two `declareType` calls a
plain `type` statement makes", and a sum type pays it N+1 times per pass.
Consequence: making cross-unit replacement an error is NOT sufficient and
not even safe on its own — same-statement re-registration must first
become an idempotent no-op (or the earlier registration rolled back).
Corollary upside: fixing that alone removes a measured ~1.2 ms per batch
(8 protocols × 1 authored edge) from every `type` statement, **regardless
of the posture decision**.

### S inventory (by area, with LOC)

| Area | Key spans | LOC |
|---|---|---|
| **2D resettle family**: `resettleTypeConformances` (261), `refuseWideningReactivations` greedy hitting set (115), `failedInheritanceSource` (38), the `resettled` half of `noteEdgePendingReason` (36) | `engine-protocols.ts:1894-2270`, `:1767-1892` | 450 |
| **`declareProtocolImpl` replacement branch** (in-place member swap, per-edge revalidation, dispatcher re-sync, effect-contract re-derivation with undo) | `engine-protocols.ts:252-361` | 110 |
| **Pinned-layout guards**: `pinnedLayoutRefusal` (120) + 4 call sites (~55), `valueOutOfContract` (67), `memoizedRequirementType` + memo (84), `fieldGetter` pinned-slot guard (17), `fieldSetter` missing-slot arm (26) | `engine-protocols.ts:4722-4994`, `:1464-1542` | 369 |
| **`declareType` replace-only fragments**: statement-replace gate, `replacesInPlace`, `prior` field snapshot + rollback branch, the `resettleTypeConformances` call | `engine-declarations.ts:857-968`, `:1214-1227` | ~95 |
| **`settleVarianceGroup`'s dependent re-verification** (`if (replaced)` block: re-check every dependent's arity/bounds/variance against the new declaration) + sole-caller helper `mentionsOf` | `engine-declarations.ts:1640-1784`, `:1527-1591` | 220 |
| **Sum-type re-declaration bookkeeping**: dropped-variant `_sumOf` clearing + `ownerSumOf` orphan guard (read by the compile tier's erasure policy — R8) | `engine-declarations.ts:1405-1501`, `sum-representation.ts:137-161` | 39 |
| **Object pinning**: `detachNominalType` (63), `detachDefinitionBody` (10), `_type`/`_fieldType` doc machinery | `boxed-expression/boxed-object.ts:119-129`, `:300-319`, `:501-574` | 101 |
| **Total** | | **≈ 1,384** |

### What stays (K) — easy to mistake for dividend

- **Forward-reference fulfilment** shares `declareType`'s in-place record
  re-open (`engine-declarations.ts:929-935`) and drives
  `settleVarianceGroup`'s fixpoint (`:1786-1815`). In-place record reuse
  itself is K — captures hold the record object.
- **`settleFieldBacking` / `refreshInheritedPending` / the top of
  `noteEdgePendingReason`** are ordinary conformance-registration path;
  only their `resettled` parameters/halves are S.
- **The widening-violation helpers** (`conformanceWideningViolations`,
  `contractViolation`, `exceededContract`,
  `engine-protocols.ts:1090-1244`) are shared with the three registration
  routes; only `refuseWideningReactivations` dies.
- **`updateDef`** (`boxed-expression/utils.ts:1198-1387`) and the
  `redefine` state-event kind: all six `redefine` emitters are
  WITHIN-unit first-definition upgrades (auto-minted constructor →
  function, auto-declared symbol → sequence handler, multi-clause
  install, `ce.assign` onto an existing def) — none is cross-batch
  statement replacement. The axis dispatch table survives.
- **`ConformanceRecord._authored`** — its stated reason is the
  empty-block-vs-no-block distinction, not redefinition (though the S
  machinery rebuilds from it).
- **Version axes** — the five axes and `noteStateEvent` survive; the
  S bump sites are the resettle's step-1/step-5 bumps, the widening
  walk's per-apply/undo bumps, and the protocol-replacement-branch bump.

### `_typeRegistryRollbackPoint` — the checkpoint seed (K)

`index.ts:564-692` (types) + `:694-806` (protocols mirror), 8 call
sites. Snapshots per-record FIELDS (not the name table) because records
mutate in place; deletes names added since, restores fields, re-inserts a
vanished-but-captured record. Two subtleties a checkpoint API must
inherit: conditional axis bumps (only when something was restored —
unconditional bumps would cold every mutation-keyed cache on every
`executeEpsil`), and deliberately silent restores for provenance fields
no boxed expression could have read (`_declOrigin`, `_authored`,
`_implOrigin`, `_pendingReason`).

**What it does NOT cover today** (the gap list for a public checkpoint
API): (1) the protocol registry is a separate thunk — callers must take
both; (2) lexical-scope bindings — minted constructors, masking shells,
`ce.declare` placeholders (callers snapshot by hand today); (3) protocol
dispatchers installed in scope (`syncProtocolDispatchers` re-synced
explicitly after restore); (4) definition records (`updateDef` halves,
`_typeProvenance`, `effectsDeclared`) — covered only by the separate
inference-rollback frame (`boxed-expression/utils.ts:1325-1342`); (5)
multi-clause side registries (`MULTI_CLAUSE` marker,
`SINGLE_CLAUSE_ORIGIN`, `CANON_INSTALL_SKIPPED` WeakMaps); (6)
assumptions; (7) symbol values; (8) object instances
(`BoxedObject._slots`/`_version`/pinned `_type`) — not rollback-able by
design; (9) the monotone version counters (restored forward, never
backward).

### What a redefinition writes to (the full propagation surface)

1. `ce._typeRegistry[name]` — def, alias, typeParams, `_varianceState`,
   `_varianceBlockedOn`, `_declaredByStatement`, `_forwardArity`,
   `_sumOf`, `_sumVariants`, `_declOrigin`
2. Other records' `_varianceState`/`_varianceBlockedOn` (variance-group
   fixpoint)
3. `ce._protocolRegistry[p]` — members, conformances,
   declaredByStatement, `_declOrigin`; per-edge impl, `_authored`,
   `_implOrigin`, pending, `_pendingReason`
4. Lexical-scope bindings — minted constructors, masking shells, protocol
   dispatchers
5. Definition records — `updateDef` half-swap, `_typeProvenance`,
   `effectsDeclared`, `_deriveEffects`, multi-clause markers
6. Side registries — `SINGLE_CLAUSE_*`, `CANON_INSTALL_SKIPPED`,
   provisional-dependent registry
7. Version axes — `config` selects `_anyVersion`/`_semanticVersion`/
   `_worldVersion`/`_callableVersion`; plus `_conformanceVersion`
8. Memo families keyed on those axes
9. NOT touched: assumptions, symbol values, object instances

### Additional risks from this slice

- **R1 (blocking)** — same-statement second registration takes the
  replace path (above). Resolve before anything else.
- **R5' (uncertain)** — `pinnedLayoutRefusal`'s "no introspectable
  layout" exemption and `pinned === undefined` arm may also cover an
  object built through `makeObject`'s unresolved-nominal fallback
  (`boxed-object.ts:473-481`); not proven unreachable under strict
  declaration-before-use.
- **R6'** — `makeObject`'s `pinnedType` override must stay even if
  pinning-for-redefinition dies: a parameterized object type must carry
  the applied reference (`Cell<integer>`), not the bare record.
- **R4'** — the `protocol-implementation-pending` warning loses its
  third operand (`_pendingReason`); degradation is graceful
  (`execute-epsil.ts:400` defaults to `''`) but `diagnostics.ts:42` and
  host formatters need updating.

## 3. Global-state inventory for a checkpoint primitive

**Two structural facts govern the whole checkpoint design** (both verified
against code, both already stated as doctrine in the codebase):

1. **Symbol values live in definition records, not in scopes.**
   `index.ts:505-508` states it verbatim ("Symbol values are stored in
   their definitions, not here"); assignment walks the scope chain and
   mutates the FOUND definition in place
   (`engine-declarations.ts:613-616`). **A per-cell `pushScope` therefore
   does NOT isolate re-assignment of an outer symbol** — only new
   declarations and assumptions (assumptions ARE copied on push,
   `engine-scope.ts:56`).
2. **Record identity is load-bearing.** `BoxedSymbol._def` is a readonly
   pointer; `sameBindingDef` is object identity (`binders.ts:102-109`);
   type-registry records are "REPLACED IN PLACE … captures hold the
   record object" (`index.ts:571-574`). **A restore strategy that swaps
   fresh registry/record objects is structurally wrong** — every live
   boxed expression keeps answering from the old objects. The only viable
   strategy is: rewrite record fields in place, bump monotone counters.
   Two hard invariants, both already codebase doctrine: *monotone
   counters only advance, never rewind*
   (`boxed-value-definition.ts:421-425` — `_writeVersion` "deliberately
   bumped, not restored"; the scope clean-pop check compares against live
   counters, `engine-scope.ts:147-151`), and *every rewritten definition
   record needs its own `_writeVersion` bump*, not just the engine axes
   (the element memo and map-auto-compile key on it).

Also: `hidePrivateProperties(this)` at the end of the constructor
(`index.ts:1279`) makes every `_`-prefixed engine field non-enumerable — a
snapshot built from `Object.keys`/spread/structuredClone silently captures
none of the state below.

**The composite transaction that already exists** — and the template to
copy — is the Epsil static pre-pass (`static-diagnostics.ts:215-292`):
`_typeRegistryRollbackPoint()` + `_protocolRegistryRollbackPoint()` +
depth marker + `pushScope` (which is what covers the minted constructors —
the registry rollback does NOT) + evidence swap +
`_withBoxingPassWindow(_withRolledBackInference(…))`. The
`InferenceRollbackFrame` (`inference-rollback.ts:39-104`) is an
already-shipped in-place undo journal with 8 families — but it journals
no VALUE writes; it is an inference transaction, not a program
transaction. Partial prior art for value-def fields:
`_typeSlotSnapshot`/`_restoreTypeSlots`
(`boxed-value-definition.ts:399-445`) covers 6 of ~16 value-def fields
and nothing on operator defs.

### Process-global mutable hazards (the shortlist)

1. **`BigDecimal.precision`** (`big-decimal.ts:34`; written
   `engine-numeric-configuration.ts:27`, `:53`) — a user program raises
   it via `N(x, 200)` (`library/core.ts:5111-5119`) and it stays raised,
   for every engine in the process.
2. **`_defaultEngine`** (`free-functions.ts:21-22`) — a hidden
   process-wide engine behind the free functions; anything declared there
   lives for the process.
3. **`epsilBatchCounter`** (`execute-epsil.ts:116`) — origin stamps hold
   values of a PROCESS counter; a restore must never allow id reuse.
4. **`_mapAutoCompileStats`** (`map-auto-compile-stats.ts:48`) —
   process-global counters behind a per-engine-looking accessor
   (`index.ts:1505-1507`).
5. **`_objectsExist`** (`object-deps.ts:157`) — one-way, never resets.
6. **`BaseCompiler` private statics** (mode/promotion/lastReport/depth
   and frame stacks, `base-compiler.ts:1364-8406` various) — shared by
   all engines, depth-0-bracketed only. _(partially verified)_
7. **`activeCaches`** (Rubi, `rubi-utils.ts:448`) — cross-engine,
   string-keyed simplify cache. _(unverified whether every install is
   finally-unwound)_
8. **`STEP_LABELS`** (`explain-labels.ts:26`, publicly exported) and
   **`TYPE_SATURATED_SETS`** (`collection-utils.ts:1808`) —
   last-writer-wins global registries.
9. **`budget`** (`multivariate-gcd.ts:101`) — reset at entry but not in a
   `finally`; not re-entrant.
10. **Strong-keyed dynamic-extent stacks** (`cycle-guard.ts:99/168`,
    `boxed-symbol.ts:105`, `effects-of.ts:584`,
    `provisional-application.ts:76`) — balanced by `finally` today; pin
    engine-owned records if a bracket is ever bypassed.

### Engine state NOT covered by the existing rollback points

The actual program state a cell-boundary checkpoint must add coverage
for:

1. **Lexical-scope bindings + every mutable field of every definition
   record** — value defs (~16 mutable fields incl. `_value`, `_type`,
   `inferredType`, `_typeProvenance`, `_placeholderSkeleton`,
   `holdUntil`, `collection`) and operator defs (`_effects`,
   `inferredSignature`, `_isMultiClause`, … — no snapshot helper exists).
2. **The minted type constructor** (`engine-declarations.ts:1135-1180`)
   — the pre-pass covers it with a pushed scope, not the rollback point.
3. **Assumptions** — covered by scope push/pop only.
4. **The forward-reference registry** (`provisional-application.ts:147,
   157`) — engine-keyed module WeakMaps; scope pop does not touch them.
5. **Clause-identity side channels** (`clause-identity.ts:50/73/74`).
6. **Sequence registries + their value memos** (`sequence.ts:67`, `:508`
   — mutable memo Maps with NO version stamp; the clearest stale-memo
   hazard).
7. **`EngineCacheStore`** (`engine-cache.ts:37-77`) — NO version key at
   all; restore must explicitly purge (and `getOrBuild` captures the
   first build closure — a purge re-runs a stale closure).
8. **Library-load idempotence markers** (`fungrim/loader.ts:664`,
   `rubi/loader.ts:49`).
9. **Host configuration** — precision/tolerance/angularUnit, `strict`,
   `jit` (incl. its CSP latch), the three rule stores, `_cost`,
   `_compilationTargets`, `_integrationProvider`, LaTeX
   syntax/options, runtime limits.
10. **`_conformanceVersion`** — bumped only by
    `_noteConformanceRegistryChange()`, NOT by `_noteStateEvent`; a
    restore must bump it explicitly.
11. **The configuration-change listener set**
    (`common/configuration-change.ts:17-23`) — every CONSTANT definition
    subscribes on construction and must be `dispose()`d
    (`discardEvalContext` does this); a restore that abandons
    definitions without disposing leaks listeners for the engine's
    lifetime.
12. **Object identity across replay** — `_serialCounters`
    (`boxed-object.ts:53`): replayed object constructions get NEW
    serials, so object identity is not stable across a rebuild (fine for
    wipe-and-replay semantics; worth stating in the client contract).

### Memo soundness under in-place restore

- **Safe (version-keyed)**: the `cachedValue()` family, boxed-function
  `_typeGeneration`/`_effects`/`_facetMemo`/`_lazyValueEpoch`,
  `_revisionVersion`, the collection element memo and map-auto-compile
  (both also keyed on per-def `_writeVersion` — hence the per-record bump
  requirement), `factIndexCache`, `requirementTypeMemo`. The
  engine-independent type-system caches (`TYPE_CACHE`, `MEET_CACHE`) are
  safe: resolver-dependent parses are not cached, `isSubtype` is
  deliberately unmemoized.
- **Stale under in-place restore — needs explicit handling**:
  `EngineCacheStore` (purge), `MUTABILITY_GATE_MEMO`
  (`engine-protocols.ts:527` — keyed on `record.members` object identity
  BECAUSE records mutate in place; a restore rewriting members' contents
  must assign a NEW members object), the clause-provenance trio (call
  `clearClauseProvenance` per rewritten record), sequence registries,
  `RESOLVED_TYPE_OPERANDS` (`function-literal.ts:54`), `probeCache`
  (`symbolic/limit.ts:859`, unstamped compiled closures), and the two
  effects derivers (`engine-protocols.ts:3743`,
  `boxed-operator-definition.ts:700`) — which already refuse to stamp
  while a rollback frame is open; a checkpoint restore must either open
  a frame or bump BOTH `_conformanceVersion` and `_callableVersion`.
- **Flagged, unresolved**: the `undefined`-key fast-path entries of
  `_type`/`_sgn`/`_eagerSource` on all-constant pure nodes
  (`boxed-function.ts:1802-1806`) — no counter reaches them; whether a
  restore can change such a node's answer is the top item to settle
  empirically in workstream 2.

### Replay is not semantically transparent (confirmed in code)

`Print` writes through `globalThis.console.log`
(`library/core.ts:6638-6647`); `Input` consumes process stdin
irreversibly (`library/core.ts:6869-6920`). A replay re-prints and
re-reads; `Random()` re-draws. This is a client-contract question
(cache clean cells; replay only the dirty cone; an explicit story for
effectful cells), not an engine checkpoint question.

### Side observation from this slice (triaged: not a defect)

`static-diagnostics.ts:247-256` mutates the engine (depth++, `pushScope`,
evidence swap) BEFORE its `try`. Triaged during this audit:
`pushScope` → `pushEvalContext` (`engine-scope.ts:17-64`) has no
realistic throw path (plain object construction, assumptions copy, array
push; `reviveBindings` only under debug mode), and even a hypothetical
throw would leave only a leaked `_staticTypeCheckDepth` increment, which
WEAKENS the anti-forgery depth gate without changing behavior (the
surrogate check also requires the frame name, and no frame was pushed).
Theoretical hardening opportunity at most; no action taken.

## 4. Tests, open items, and documentation blast radius

### 4.1 Tests

Classification: **FLIP** = asserts an across-unit redeclaration is
accepted (becomes an error pin or is deleted); **REWRITE** = fixture is an
across-unit redeclaration but already asserts an error for a different
reason (assertion changes); everything else survives.

**Total: 92 source test blocks FLIP (94 runtime), + 8 REWRITE, + 10
route-policy-uncertain. Worst case if the strict posture also covers the
box/host `Declare*` route: 110.** If host-route re-assignment
(`ce.assign` twice, `parse().evaluate()` twice) were also in scope —
which the shipped discipline explicitly does NOT treat as a unit —
a further estimated 30–60 tests enter; that family was excluded.

| File | FLIP | Survives / total | Note |
|---|---|---|---|
| `protocol-type-redefinition.test.ts` | 41 | 4 / 45 | read in full; survivors are fresh-edge controls |
| `protocol-resettle-invariants.test.ts` | 12 | 1 / 13 | whole file mooted with `resettleTypeConformances` |
| `test/epsil/redefinition-discipline.test.ts` | 9 (+5 route-uncertain) | 43 / 57 | all within-unit error pins survive; `:105`/`:800` use fresh-engine `checkSource` and survive |
| `test/epsil/declare-type.test.ts` | 10 (+6 rewrite) | 116 / 132 | rewrites = dependent-revalidation machinery |
| `test/epsil/protocols.test.ts` | 3 | 82 / 85 | scanner-swept; lower bound |
| `test/compute-engine/protocols.test.ts` | 1 (+1 rewrite, +5 route-uncertain) | ~111 / 118 | scanner-swept; lower bound |
| `protocol-field-backed.test.ts` | 4 | 32 / 36 | the "replacement re-settles field backing" describe |
| `protocol-mutability-gate.test.ts` | 4 | 21 / 25 | the "REPLACING a protocol into a gating one" describe |
| `sum-declaration-sugar.test.ts` | 4 | 36 / 40 | |
| `object-store.test.ts` | 1 | 42 / 43 | |
| `test/epsil/multi-clause.test.ts` | 1 | 40 / 41 | the "notebook re-run" clause replacement |
| `effects-contracts.test.ts` | 1 (+1 rewrite) | 118 / 120 | `:1594` is the widening-redefinition pin |
| `constructor-functions.test.ts` | 1 | 28 / 29 | |

Correction to a premise given to the sweep: the "CONTRACT 4" family is in
`test/compute-engine/pipeline-contracts.test.ts:518-614` (not
scope.test.ts) and is about SHADOWING (fresh binding in a child scope)
and host `ce.assign` re-binding, not redefinition — zero flips there.
Host re-binding is exempt by the shipped discipline (host API is a
route, not a unit). NOTE: if the posture were ever extended to VALUE
rebinding (consolidated-table row "plain assignment rebinds"), a
materially larger test family enters that this audit deliberately did
NOT count (state-events, effects-invalidation, map-auto-compile,
inference-rollback, and others) — the ~30-60 figure above covers only
host-route DECLARATION replacement, and value-rebinding strictness is
not being proposed.

### 4.2 Open items

| Item | Location | Verdict |
|---|---|---|
| Widening an effect annotation by redefinition (the "widening-redefinition package") | `ROADMAP.md:3597-3610` | **MOOTED** — its own remedy cites the "Across units" clause that would cease to exist |
| Pinned layouts are SHALLOW | `ROADMAP.md:3612-3625` | **MOOTED** — with no re-declaration the registry layout is immutable; the shallow-copy defect is unreachable and pinning loses its motivating scenario |
| Re-declared alias RETYPES stored values (ruled 08-16) | `ROADMAP.md:3627-3637` | **MOOTED** — answers a question that only arises on re-declaration |
| Mixed-generation objects | mutable-objects plan `:143-146` | **MOOTED, by the plan's own words** — "the mixed-generation surface exists only across notebook cells" |
| Work package 2D (cross-batch re-settle) | plan `:409-429`, `ROADMAP.md:3514-3530` | **MOOTED as machinery** — no trigger remains |
| `protocol-conditional-member-effects` | `ROADMAP.md:3883-3894` | **SURVIVES** — semantic need independent of redefinition; but its identity-stability obstacle comes from re-registration, so strict posture LOWERS its cost |
| `readonly` protocol view vs holder writes | `ROADMAP.md:3996` | **SURVIVES** — no redefinition in it |
| Dictionary-key merge | `ROADMAP.md:635-665` | **SURVIVES / unaffected** — value-level `Join`/`Append` collision, FIXED 08-17; NOT a redefinition item (corrects a stale session note) |
| Sum-name conformance | `ROADMAP.md:4055-4064` | **PARTIALLY MOOTED** — the P47-premised "does a later variant re-run conformance" sub-question disappears |

### 4.3 Documentation blast radius

- **The load-bearing table**:
  `docs/plans/2026-08-14-redefinition-discipline.md:255-271` — rows
  264–269 (type/object-type/sum/protocol/impl-block/same-clause) collapse
  to a single error row; only "new parameter list adds a clause" and
  "plain assignment rebinds" survive. Also `:222-235` (route/origin
  matrix — the whole "later unit: replaces" column) and the acceptance
  criteria `:304-316`.
- **User-facing Epsil reference** (`src/epsil/docs/`, checked in):
  `types.md:517` (a section literally titled "Types are global, and
  re-running a cell"), `:544-552`, `:590-593`, `:811-813`;
  `protocols.md:43-45` ("the notebook pattern — replaces"), `:112-113`;
  `control-flow.md:122-125`, `:192`.
- **`docs/TYPE_SYSTEM_ROADMAP.md`**: `:50-51`, `:766-777` (Appendix A
  "Statement re-run replaces" ruling — would be RETRACTED, not
  re-scoped), `:795-796`, `:958-963`, `:1583-1598` (Appendix B, 2D's
  contract), `:1615-1621` (the prescribed user remedy "re-run the type
  declaration" stops existing), `:3010-3011`; `:2594-2600` is a deferral
  justified by protocol replacement — strict posture makes the deferred
  feature MORE feasible.
- **`doc/` guides** (gitignored): `85-reference-core.md:156-161` (the
  strongest sentence: replacement exists "so re-running a program on the
  same engine works"), `08-guide-types.md:2062-2065/2227-2229/2324-2325`,
  `06-guide-augmenting.md:1074-1076`.
- **Superseded design rulings** (`docs/plans/`): global-type-registry
  `:87-95`, `:294-295` (D4's type-removal deferral justification
  collapses); protocols-design `:64-69` (P5), `:280-291` (P24/P47);
  object-representation-decision `:117-128` (the entire motivating
  scenario for pinning); nominal-types `:425-432`;
  function-polymorphism `:200-211`, `:239-243` — see §5;
  generic-type-aliases `:105-107` etc.
- **CHANGELOG**: ~12 shipped-behavior announcements (0.100.0 → 0.114.0)
  are historical record — superseded, not rewritten.
- **Clean**: `ARCHITECTURE.md`, `docs/SIMPLIFY.md`,
  `docs/architecture/*` — zero hits.

### 4.4 Two policy questions the sweep surfaced (need explicit rulings)

1. **Cross-unit COMPLETION vs cross-unit REDEFINITION.**
   `TYPE_SYSTEM_ROADMAP.md:906-915` and `src/epsil/docs/protocols.md:99-100`
   promise monotone accumulation across cells (declare a conformance in
   one cell, implement it in the next). A strict posture plausibly KEEPS
   monotone addition (nothing is redefined) — but it rests on the same
   incremental-session framing, and the ruling decides whether
   `protocol-conditional.test.ts:205` and the later-batch
   protocol-constraints tests are in scope.
2. **Does strictness reach the box route?** Today box-route `Declare*` is
   "a statement without a batch" (replaces, unstamped) and the host API
   always throws. Extending strictness to the box route is a design
   choice, not a consequence — it breaks re-entrant host operators that
   declare types per call (risk R3) and adds ~18 test flips.

## 5. Findings summary

**The deletion dividend is real, and it lives almost entirely in
replacement PROPAGATION, not in batch bookkeeping:**

| | Amount |
|---|---|
| Strictly-S source lines — propagation (§2) | ≈ 1,384 |
| Strictly-S source lines — batch bookkeeping (§1) | ≈ 46–60 |
| Conditionally-S (route marker, if box route goes strict too) | ≈ 90–150 |
| Test blocks that flip to error pins (§4.1) | 92 (worst case 110) |
| Test lines mooted wholesale (the two 2D suites) | ≈ 1,891 |
| ROADMAP/plan open items mooted (§4.2) | 5 (incl. the widening-redefinition package and mixed-generation objects) |
| Per-batch runtime recovered (measured, resettle doc) | ~1.2 ms per `type` statement in a modest engine; ×(N+1) for sums |

**Finding F1 — the pivotal precedent.**
`docs/plans/2026-08-01-function-polymorphism-design.md:239-243` records,
as an *external product commitment*: "The notebook host defines scopes
and **re-executes the whole scope on edit** … Under it, cross-edit
staleness does not arise in the primary workflow, and the engine does
**not** grow reset-on-new-run heuristics." If that commitment still holds
for Tycho, the primary notebook workflow is ALREADY replay-shaped, and
the cross-batch replacement machinery serves a secondary path
(re-evaluation without scope rebuild). Workstream 3's first question to
Tycho is whether this commitment stands — the answer largely decides
feasibility.

**Finding F2 — the blocking prerequisite (R1).** The same statement's
second registration flows through the replace path today (§2). Any
strictness change must first make same-statement re-registration an
idempotent no-op. This also removes the measured resettle cost from every
`type` statement — worth doing REGARDLESS of the posture decision.

**Finding F3 — the checkpoint primitive is buildable but is the real
engineering cost.** The seed exists (the two registry rollback points;
the Epsil static pre-pass as the composite-transaction template; the
inference-rollback journal; `_typeSlotSnapshot`), and the design is
constrained to in-place field rewrite + monotone counter bumps (§3).
What's missing is coverage for definition-record state (values,
inferred types, operator defs), minted constructors/dispatchers,
assumptions beyond scope push/pop, the engine-keyed module WeakMaps
(sequences, forward references, clause provenance), unversioned caches
(`EngineCacheStore`), and the process-global hazard list (§3, headed by
`BigDecimal.precision`). None of this is research-grade the way the 2D
resettle was — it is enumeration and journaling — but the enumeration
must be COMPLETE, and §3 is that enumeration.

**Finding F4 — strictness has genuine semantic edges** (§1 risks, §4.4):
nested `executeEpsil`, re-entrant host/box-route declarations,
assignment-vs-clause interaction, cross-unit monotone COMPLETION
(conformance declared in one cell, implemented in the next), and the
static checker's source of truth. These are decisions, not mechanics —
they belong in the workstream-2 design and the Tycho conversation.

**Net assessment:** the audit supports proceeding to workstream 2. The
dividend (~1.4k source lines of the hardest-won machinery in the engine,
5 open items, a per-statement runtime cost, and a whole class of
"works-interactively-fails-compiled" divergence) is substantial, and the
one already-recorded product commitment (F1) suggests the client-side
cost may be smaller than assumed. The honest counterweights: ~92–110
tests to flip, a checkpoint primitive whose state enumeration must be
airtight (§3), the semantic edge decisions (F4), and a documentation
sweep across two shipped reference guides, TYPE_SYSTEM_ROADMAP appendices
A/B, and six design docs.

## 6. Risks and non-dividends

Consolidated from §1–§4; the wrong deletion changes LINEAR-path behavior.

**Must survive any posture** (easy to mistake for dividend):
statement-identity immunity (`statementId`, `sameStatement`, P47's
`block`); in-place record reuse and forward-reference fulfilment;
`settleFieldBacking`/`refreshInheritedPending`/`noteEdgePendingReason`'s
registration halves; the widening-violation helpers; `updateDef` and the
`redefine` state-event kind (all six emitters are within-unit
first-definition upgrades); `_authored`; the version axes; both registry
rollback points; the static tier (re-keyed, not deleted);
`makeObject`'s `pinnedType` override for parameterized object types; the
three diagnostic codes (rewording only).

**Ordered blocking items before any deletion:**
1. R1 — make same-statement re-registration idempotent (§2).
2. The rulings of §4.4 (box-route scope; monotone completion) and §1
   risks R3–R5 (host re-entrancy, nested `executeEpsil`,
   assignment-vs-clause).
3. The static-tier re-keying design (§1 R6).
4. The checkpoint primitive's coverage list (§3) — with the
   process-global hazards either engine-scoped or documented as
   process-level (precision foremost).

**Uncertainties flagged, not resolved:** the all-constant-pure
`undefined`-key memo entries under restore (§3, top empirical question
for workstream 2); `pinnedLayoutRefusal`'s unresolved-nominal fallback
arm (§2 R5'); Rubi `activeCaches` and `BaseCompiler` statics bracket
hygiene (§3); scanner-swept test counts in the two big protocol suites
are lower bounds (§4.1).
