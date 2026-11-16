# Shared preparation replacement ledger and delivery decision

Status: source-based design and costing, 2026-11-15. Companion to the
[finite specification](2026-11-15-shared-preparation-spec.md). **Revise; do not
implement the combined delivery at this cost.** The conservative named removal
is 1,806 production code lines; estimated additions after bookkeeping removal are 1,980–3,200. Larger
historical deletion targets include retained policy and are not credited.

All removals below are requirements of a proposed delivery, not changes already
made. This assignment removes **zero** production lines and adds **zero**
production, test or experimental code. Only design documentation changes.

Follow-up: the [responsibility split and Program-only costing](2026-11-15-preparation-responsibility-split.md)
shows that the retained Tycho bucket includes generic analysis and CE
workarounds as well as dialect decisions. Retaining those analyses alongside
CE preparation preserves duplication; the combined delivery remains stopped.
The smaller Program-only alternative has its own removal set and cost.

## 1 Accounting and source identity

CE HEAD observed: `b9eda09df40a06b9c380deef25a331236aa69195`. Shared-tree files
can differ from HEAD; the hashes below identify the actual inputs counted.
Tycho paths are relative to `/Users/arno/dev/tycho`; no Tycho git command ran.

Two counts are kept separate. Physical lines run from TypeScript declaration
`getStart()` through `end`, excluding leading JSDoc. Code lines are physical
lines intersecting at least one nontrivia leaf token of the parsed TypeScript
AST; blank and comment-only lines are excluded. Multiline strings count as
code. AST leaves, rather than a context-free scanner, are necessary because
these files contain template substitutions. Counts are deduplicated within
each declaration. No nested function is counted again within a parent.

| Source | SHA-256 |
| --- | --- |
| CE `src/epsil/execute-epsil.ts` | `891212a4b6c71ce58b02452f6fbc5fb083c4bce0fbcd52f9b4e70005c389c552` |
| CE `src/epsil/static-diagnostics.ts` | `82fc5645c72c0e6b5324346beddc1f70da05c6ce742f1762f54bbbbbf7a88fe6` |
| CE `src/compute-engine/library/control-structures.ts` | `3ae6de53c5c97676712c7c24279e88aaf32d056824ee673588fa1eb1191589bc` |
| Tycho `src/graph-paper/graph/document-ce-manager.ts` | `ef9b166a701c944952487f9ec995574658a7dd4ad14d55fecadff0b7e16fef90` |
| Tycho `src/plot-core/prelude-runner.ts` | `84c144dd3c421575acd7f3a9f49c0296c8c8eb9a41ee326934a7aa5f1cb512e0` |

## 2 CE responsibilities and exact removal set

| Responsibility | Existing code reused | Code removed in the delivery | Replacement and callers |
| --- | --- | --- | --- |
| Top-level function preparation | Declaration parsing, function literal canonicalization and multi-clause validation | `prepareFunctionDeclarations` and its exclusive helpers listed below | Shared candidate head collection and approved Program canonical ordering. `executeEpsilSteps` consumes prepared statements rather than installing functions in a separate preliminary pass. |
| Top-level statement boxing | Existing body/declaration checks and diagnostic rendering | `boxTopLevelStatement` | Program preparation supplies top-level position and resolved use sites once. Both `executeEpsilSteps` and static diagnostics stop boxing the statement through this wrapper. |
| Identify a Program | Existing Block evaluator for nested blocks, statement error values and source hooks | `runsAsProgram`, `isProgramBlock`, `firstDeclarationIndex` | Explicit Program operator and canonical order. Change their call sites in `canonicalBlock`, `evaluateBlock` and `evaluateBlockAsync`; remove Program-only branches, but give those uncounted fragments no credit. |
| Static checking | Existing diagnostics, source ranges, type checker and occurrence analysis | No whole static checker or rollback deletion credited | `checkEpsil` uses preparation without namespace publication. Adapt its diagnostics path; shared rollback users and type/protocol registry handling remain until independently shown unnecessary. |
| Runtime values | Existing lexical activations, assignment admission, closure frames and evaluator | None credited | Prepared bindings point to fixed static records; instance frames hold values. Adapt source-bound type/effect projections and slot activation. This is new integration work. |
| Operator execution | `BoxedFunction` evaluation, library handlers, recursion limits, collection views, DAG and effect-sensitive memos | None | Ordinary bound bodies execute through CE. No experimental walker or replacement arithmetic dispatch. |
| Compilation | Existing compiler, `compile-blocks.ts`, `inputs`, scope adaptation and target implementations | None | Recognize Program using existing statement emission. Pass mutable transitive inputs at their prepared types. Keep direct compile distinct from the separate per-statement runner. |
| Numeric configuration | Setters/reset, transient precision/unit windows, requested/working precision keys | None | Immutable options description plus existing configuration entry and cache safeguards. No independent contexts or decimal-backend work. |

Exclusive helper references were checked in CE `src`. Their names may also
appear in comments or as unrelated private helpers in another module; only the
declarations listed here are counted.

| CE declaration | Source range | Physical | Code |
| --- | --- | ---: | ---: |
| `prepareFunctionDeclarations` | execute-epsil.ts 1206–1537 | 332 | 230 |
| `hasOuterDefinition` | execute-epsil.ts 1542–1550 | 9 | 8 |
| `outerDefinitionType` | execute-epsil.ts 1556–1564 | 9 | 9 |
| `statementWrites` | execute-epsil.ts 1600–1669 | 70 | 65 |
| `isSettledBefore` | execute-epsil.ts 1697–1704 | 8 | 8 |
| `functionLocalNames` | execute-epsil.ts 1714–1738 | 25 | 23 |
| `namesIn` | execute-epsil.ts 1742–1753 | 12 | 12 |
| `writtenNames` | execute-epsil.ts 1762–1782 | 21 | 21 |
| `boxTopLevelStatement` | static-diagnostics.ts 1713–1737 | 25 | 25 |
| `runsAsProgram` | control-structures.ts 4098–4112 | 15 | 15 |
| `isProgramBlock` | control-structures.ts 4917–4924 | 8 | 8 |
| `firstDeclarationIndex` | control-structures.ts 4928–4937 | 10 | 10 |
| Total | | 544 | 434 |

Retain `executeEpsilSteps`' diagnostic formatting, cancellation, per-statement
hooks, library resolution and nested error reporting. Adapt its iteration to
the prepared statement sequence; do not claim the 642-line generator disappears.
Retain reusable Block declaration and uninitialized-read machinery. The
approved Program spec's roughly 1,100-line estimate includes fragments/editor
routes not reverified here; it is not added to the exact 434-code-line credit.

## 3 Tycho responsibilities and removal set

All exact methods below are in `document-ce-manager.ts`.

| Responsibility | Existing code reused or retained | Exact method removal | Replacement and caller migration |
| --- | --- | --- | --- |
| Registration orchestration | Existing source discovery, policy lowerings, action recognition, classification products and diagnostics | `_registerDefinitions` | Extract retained policy into a normalization/publication adapter, with its full replacement cost counted. CE prepares the completed declarations. `evaluate()` no longer fills a live scope row by row or schedules retries. |
| Publish recursive function groups | Existing clause parsing, selection and lambda construction | `_registerRecursiveLambdas` | Normalizer submits the completed clause group before preparation. Its loop/publication obligation is counted in replacement policy code. |
| Avoid unnecessary registration | Source-entry IDs, existing setters and host change events | `_registrationFingerprint`, `_reuseRegistration` | `setCells`, prelude application and range/type setters submit grouped source/descriptors. The host submits structural source changes; an empty edit group is a no-op and value-only changes write slots. The old methods' random/override policy remains explicit host work. |
| Selectively rebind action-written literal readers | Existing action application, literal parsing and slot type admission | `_rebindWrittenLiterals`, `_bodyReads` | Writes update the instance. Live formulas read current slots through the evaluator. No host transitive dirty closure or reader re-registration. |
| Discover heads and normalize ambiguous syntax | `_preDeclareDefinitionHeads`, `_prepareDefinitionBodies`, `_declareSignatureAnalysisNames`, parser hooks and raw-source tables | None credited | Reuse as the normalizer's private analysis, detached from the live execution scope. Refactor their interfaces as needed; additions for this work are counted. The generic CE service does not magically replace Desmos interpretation. |
| Derive Desmos point/list, scalar mapping and recursion policy | `_deriveSignaturesInterprocedural`, `_deriveValueType`, `_deriveSignature`, `_deriveComplexParamSlots`, `_deriveRecursiveComplexSignature`, `computeElementwiseParamTable`, `analyzeBodyEvidence` | None credited | Retain policy annotations and the public `isElementwiseParam` query. Static metadata from CE supplies binding/type facts but does not replace these dialect rules in this delivery. |
| Shader list-width policy | `_callSiteAcceptedWidths`, `_refusedWidthParams` and current bounded policy trials | None credited | Keep trials private to normalization/preparation before publication. Do not replace them with runtime shape dispatch or a new target handler. Their removal would require another design. |
| Live override ownership | `_movedLiveOverrides`, live-owner checks and action baselines | None credited | Convert accepted writes to state-slot operations. Range/source edits explicitly request preservation. The host still decides what state survives and owns override policy. |
| Definition-dependent consumers | Inliner, macro policy, renderer caches, classification and `definitionsRevision`/`bindingEpoch` consumers | None credited | Queries use a revision view and value-sensitive execution keys. Keep per-pass notifications where they cover other inputs. No mutable revision scope escapes as `manager.ce`. |
| Prelude execution and transport | `prelude-runner.ts`, carrier conversion, admission policy, worker scheduling and transport records | None credited | Submit complete prelude source/descriptors to preparation, retain the existing runner for execution and source-level transport. Its future CE-runner replacement is a separate delivery. |

Retained policy analysis can build transient dependency tables and private
scratch scopes while normalizing a document. This is existing production code
reused and counted as retained, not a newly claimed simplification. There is no
second registration fallback after the prepared document is published.

| Tycho method removed | Range | Physical | Code |
| --- | --- | ---: | ---: |
| `_registrationFingerprint` | 4475–4531 | 57 | 33 |
| `_reuseRegistration` | 4554–4657 | 104 | 45 |
| `_rebindWrittenLiterals` | 4798–5048 | 251 | 210 |
| `_bodyReads` | 5055–5075 | 21 | 21 |
| `_registerDefinitions` | 8190–10327 | 2,138 | 1,051 |
| `_registerRecursiveLambdas` | 10353–10369 | 17 | 12 |
| Total | | 2,588 | 1,372 |

`evaluate()` calls the fingerprint, reuse, selective-write and full-registration
paths at 4343, 4346, 4359 and 4422. The selective method owns both `_bodyReads`
calls, at 4897 and 4940. `_registerDefinitions` calls recursive publication at
10294. Remove these calls with the methods. Other removed fields and branches
are uncounted, not an allowance to inflate savings.

The earlier 5,660-physical-line target contains 3,342 code lines. This delivery
retains 3,072 physical/1,970 code lines of that target: head/body analysis,
signature and point/mapping policy, width analysis and `_movedLiveOverrides`.
It credits only 2,588 physical/1,372 code lines. The entire 20,000-line manager,
2,711-line historical inliner inventory and unrelated already-deletable
workarounds are not part of the credit.

## 4 Callers and discontinued behavior

CE caller migration covers `executeEpsil`, `executeEpsilAsync`, their generator,
`checkEpsil`, direct boxing/evaluation and compilation of parser output, and
the consumers expecting parsed `Block`. Tycho's concrete parser consumers are
`prelude-runner.ts:topStatementsOf`, `notebook/cortex-analysis.ts` and
`notebook/ce-notebook-evaluator.ts:collectFunctionDefines`. The notebook evaluator
already calls exported `executeEpsil`; it must keep notebook scope, precision
and rerun policy while accepting Program syntax.

Document caller migration includes `setCells`, `setVariableRanges`, axis/type
setters, prelude-source application, `evaluate`, action/ticker/live writes,
`definitions`, `documentDefinitionBody`, expression expansion/classification
and all compilation consumers. `src/plot/ce-compile.ts`,
`src/plot/resolve-fn.ts`, `src/plot-core/ce-module-registry.ts` and series
inference must receive revision-bound queries/metadata rather than parse and
mutate a live document scope. Existing compiled caches still include target,
numeric configuration, value specialization and renderer-specific inputs.

The retained prelude runner is called by `plot-core/plot-prelude.ts`,
`graph/prelude/prelude-check-body.ts` and `agent-host/plot-host.ts`. It must not
prepare against a different library or source snapshot from the surrounding
document. Its execution adapter consumes shared prepared statements/metadata
and runs the prelude initialization prefix exactly once; it cannot publish a
second set of declarations during a preliminary check. This refactoring earns
no deletion credit and is included in the Tycho integration estimate. A
successful standalone prelude check does not replace full-document
preparation after source or prelude edits.

The delivery deliberately discontinues these behaviors for prepared containers:

- Later ambient declarations automatically changing old handles or their types.
- Renaming a declaration implicitly renaming readers.
- Assignments widening a prepared slot's type or replacing its declaration.
- Preserving arbitrary closures/lazy objects across revisions by copying engine
  bindings. The host explicitly recreates or resets them.
- Formula writes to state and effectful formula evaluation. Effects become
  explicit initialization/actions; seeded dialect behavior retains its existing
  normalization and controls.
- Re-registration as a way to refresh a formula's value, and retrying a body
  because an earlier row did not yet have its final declaration.

These are proposed Document/prepared-API rules, not silent changes to unrelated
CE APIs. Program's already approved route corrections remain the execution
contract. The specification separately proposes amendment A1: type/protocol
declarations prepared or directly boxed in a Program become externally visible
at execution, rather than during boxing. Later annotations inside the same
prepared Program still see them. A1 is pending explicit acceptance, justified
by eliminating caller-registry mutation/undo during preparation. It earns no
extra removal credit here. If an existing real document needs a
different rule, record the source and cost a normalization change or explicitly
revise this contract; do not insert a compatibility fallback.

## 5 Combined production cost

Estimates below are **code lines**, using the counting definition in section 1.
They are ranges for a design without an implementation patch, not measured
diffs. They include types, errors and adapters. Reused existing code is not
counted as a new implementation, and relocation earns no net savings.

| New or replacement production code | Low | High |
| --- | ---: | ---: |
| CE ordered source snapshots and grouped edits without global revision bookkeeping | 80 | 140 |
| CE shared preparation ordering, finalization, diagnostics/site metadata | 350 | 550 |
| CE fixed static projections and instance activation/formula bridge | 260 | 420 |
| CE Program operator and execute/check/compile integration | 230 | 360 |
| CE existing compiler/input and read-only query adapters | 110 | 190 |
| CE immutable options and existing numeric safeguards integration | 40 | 70 |
| CE subtotal | 1,070 | 1,730 |
| Tycho policy retained from removed registration methods | 550 | 850 |
| Tycho source/prelude/value transactions and explicit transfer | 190 | 300 |
| Tycho query/classification/compilation caller integration | 100 | 180 |
| Tycho retained analysis interface and scratch-scope refactoring | 70 | 140 |
| Tycho subtotal | 910 | 1,470 |
| Combined additions | 1,980 | 3,200 |
| Named removals, CE 434 plus Tycho 1,372 | 1,806 | 1,806 |
| Net production increase | 174 | 1,394 |

The source-snapshot row was reduced from 220–340 to 80–140 by removing
retired IDs, CE stale-base arbitration, position keys and draft memoization;
no new production deletion is credited. The low estimate still adds production code. Uncounted branch/field removals
cannot be assumed to cover it. Further solver work, compiler handler additions,
cross-worker execution redesign or broad rewriting of exposed `manager.ce`
callers would require recosting, likely upward. The report gives no credit for
removing any CE binding environment, effect memo, state-event axis or legacy
compiler scope adapter still used by ordinary expressions.

Tests and instruments are separate estimated additions: CE contract/regression
tests 600–1,000 code lines, Tycho migration controls 400–700, matched measurement
adapters 200–350. Existing tests rewritten rather than added must be counted
separately in an actual patch, along with changed snapshots and pinned code
emissions. No snapshot may be changed merely to hide a failure.

The prior isolated stable-batch experiment reports 1,823 tracked physical code
lines including implementation/tests/instruments after its bounded revision.
That is historical scaffolding, not this ledger's production-line metric. It
remains untouched and supplies no deletion credit or new evaluator to reuse.
No further experimental source is proposed here.

## 6 Correctness controls

These are required future validations, not passes from this design task.
Compare complete documents, not only extracted arithmetic kernels.

| Control | Witness and required observation |
| --- | --- |
| Program approved semantics | Every example in the approved Program spec, including a forward function versus a later lambda variable, duplicate declarations, constant writes, top-level type/protocol statements, outer writes and invalid siblings. Exercise execute, async execute, check, direct Program evaluation and compilation within each route's contract. |
| Source/revision operations | Grouped add/replace/delete and final order vector, rename without reader rewrite, duplicate live IDs/invalid order, delete-and-readd with old handles unchanged, empty edits, invalid sibling with valid sibling, mixed-prepared-object refusal and dropped old roots. Concurrency acceptance belongs to the host. |
| State versus formulas | Initializer executes once; prepare executes no initializer; formula sees same-type writes directly and through functions; input missing and failed initializer stay uninitialized; a later independent initializer runs; transfer skips state initializer but not constants; incompatible write leaves the value unchanged. |
| Cycles and effects | Direct/through-function formula cycles diagnosed; typed function recursion allowed; unresolved recursion declines compile; formula writes/unknown effects refused; effectful initializers preserve source order; callable-slot type/effect bounds and separate closure frames retain existing semantics. |
| Forward typed bodies | Complete `tests/fixtures/documents/desmos/37c316659d.json`; associated `signature-propagation.test.ts` controls for forward `G/H/X/Y/g`, a parameter shadowing a document head/axis/library constant, and stored versus inlined results. No retry scheduler may remain to pass the case. |
| Point/list and macros | Complete `hpr2q4kles.json` and `62urmx2dcm.json` fixtures, existing point-type/scalar-parameter/signature-propagation tests. Preserve call-site point evidence, whole-list versus scalar mapping, normalized macro bodies, capture and compilation decisions. |
| Prelude and compiled plots | Existing `showcase-prelude-parity.test.ts`: Burning Ship and Multibrot numeric samples and JS/GLSL acceptance; Game of Life seed and 60 action generations. Use its pre-conversion LaTeX controls as a separate oracle. |
| Large list state | Existing `prelude/prelude-lanes.test.ts` Buddhabrot step against `stepReference`, including all 90,001 result entries. Keep the full showcase's large initialization as a separate first-open workload; do not label a reduced setup as complete document coverage. |
| Interactive documents | Full `heat-spread` and `othello` showcase sources; identical existing action sequences, accepted state, compiled/interpreted routes and rendering/classification. Existing selective-rebind tests supply additional synthetic contracts, not real-document evidence. |
| Complete edits | For each selected document, replace a real definition and then its complete prelude in separate revisions. Include full normalization, preparation, value transfer/recreation, required initialization, compilation and first rendered/query result. Old execution retains its old source; explicitly transferred state survives. |
| Numeric safeguards | Exact versus approximate requests, precision/rounding/angle changes, transient precision/radian windows, shared DAGs and seeded effects. Retain documented global decimal precision behavior; test cache separation rather than claiming independent contexts. |

Relevant Tycho test files also include `ui/document-ce-manager-recursive-clauses.test.ts`,
`ui/document-ce-manager-point-type.test.ts`, `graph-paper/scalar-parameter-signature.test.ts`,
`graph-paper/prelude/prelude-edit-application.test.ts` and
`graph-paper/prelude/prelude-const-reads.test.ts`. Full adoption uses the pinned
CORE render audit, classification census and codegen audit as required by
Tycho's `docs/COMPUTE_ENGINE_CHECKLIST.md`, with explicit baseline artifacts.

Real-source pins at this design audit:

| Tycho source | SHA-256 |
| --- | --- |
| `tests/fixtures/documents/desmos/37c316659d.json` | `8a53410d8c236c28a53e06ae97ee9767b6c97bf59d76ed028851e970ff9bc86f` |
| `tests/fixtures/documents/desmos/hpr2q4kles.json` | `6faff313366e77c671eaf5f948d1884498260eda690d01aa3ca53c851ffe7975` |
| `tests/fixtures/documents/desmos/62urmx2dcm.json` | `5bec162334721222b80cf88bb5f0054dd20d59e3641a6ad6662415dc49780640` |
| `src/graph-paper/onboarding/showcase-heat.js` | `861e82cc3e7d609b7e15a53e03626fd7ee9f039efd07dd142641fe47a9af9892` |
| `src/graph-paper/onboarding/showcase-othello.js` | `d0ba21e221b6ffef402a19bfd32dd2428aba55207b94e71fbb2a4c67a99cd001` |

## 7 Matched performance and retention acceptance

Use a pinned current-production CE/Tycho control and a candidate built from the
same source with the proposed replacement; record complete commits, patches,
fixture hashes, Node/V8, production build flags and bundle hashes. The
historical pre-binding commit `c4856e003557e367d4a2272d37d1567e9dd7a9b3`
is an additional CE construction comparator, not a substitute for a matched
Tycho control. Preserve the existing stable-batch construction gate separately;
these measurements do not waive its unmet result.

| Measurement | Work included |
| --- | --- |
| Cold open | Engine/library startup, normalization, full prelude/source preparation, initialization, compile and first query/render; report components and total |
| Construction only | Box-only CE cases and document preparation without executing initializers; also measure preparation plus first execution |
| Repeated execution | Preboxed evaluate and N, shared DAG, closure/function calls, retained document queries, unchanged and relevant/unrelated value writes |
| Value edits | Real slider/action sequences, slot admission, downstream query/compile behavior and rendering; preparation count must remain zero for same-type writes |
| Source edits | Entire normalization and preparation, including unchanged entries and prelude, explicit state snapshot/transfer/recreation, initialization, compilation and first output |
| Prelude edits | Complete replacement prelude and document; no excluded prelude setup, cached old runtime or partial registration arm |
| Memory | Allocated bytes/operation, GC time and post-GC live bytes for cold open, queries and complete revision replacement |

Run the CE-1210 eleven cases separately from the real-document workloads.
Record JIT policy and verify interpreter-attributed runs have implicit
compilation off outside the timer. Use identical worker/parallel policies and
budgets, respect the shared-box lock and certify exact inputs. Alternate AB/BA
process rounds, establish control repeatability before candidate timing, and
report medians/spread and absolute times per workload. A compile decline or
unsupported document is not a successful fast sample.

Preserved-performance acceptance is per workload: no reproducible regression
outside the premeasured control noise envelope in construction, first execution,
steady execution or complete edit cost. Existing stricter accepted margins
remain binding. A tradeoff requires an explicit decision naming the affected
workload; faster repeated execution cannot hide a slower complete source edit.
This is a future measurement rule, not a new claimed numerical pass budget.

Retention runs keep eight full prepared documents and perform 100 complete
source/prelude revision replacements in each of four equal windows. Separately
hold twenty obsolete handles as a positive control, then drop them. Verify the
old revision/instance families fall back to the deliberately retained count and
to zero after all roots are dropped. Compare post-GC live-byte plateaus and
allocation against the matched control's measured noise; report RSS separately.
Value recreation, formula caches, lazy-view/closure retention and pending async
jobs remain in the totals. The plateau trace replaces fixed entry IDs; a
separate add/delete/reuse trace verifies no deleted source/runtime is retained
by a container-global history or retired-ID set, because neither exists. Run GC/snapshots
outside timing. No code-byte or
harness subtraction can turn a failing total-heap result into a pass.

## 8 Recommendation and limits

**Revise.** Explicit source revisions and separate Program/Document execution
rules remain a useful boundary. The first complete production migration costed
here does not yet pay for itself: +174 to +1,394 estimated code lines, with
Desmos policy analysis, width trials, prelude runner and ordinary CE binding
machinery still present. Independent decimal contexts are not the blocker.

The cost can become credible only through a concrete cheaper reuse plan or
additional same-delivery removals with their retained obligations and callers
accounted for. A separate, smaller Program-only delivery may be considered on
its own approved contract; its hypothetical success is not credit for Document.
Do not authorize incremental inference, another evaluator or a broad importer
rewrite to rescue this ledger. Stop the combined path if a bounded revision
still cannot yield conservative net production reduction and preserve the named
performance controls.

This task used read-only source/AST counts and documentation checks. It ran no
implementation, prototype expansion, corpus execution, performance experiment,
typecheck or source tests. No git index or Tycho file was changed. Worktrees,
agents and builds were omitted because the deliverable is design and costing.
Gomoku support is excluded throughout.
