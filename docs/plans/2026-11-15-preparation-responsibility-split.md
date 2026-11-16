# Preparation responsibilities and a Program only replacement

Status: design and source costing, 2026-11-15. Follow-up to the
[shared specification](2026-11-15-shared-preparation-spec.md) and
[combined ledger](2026-11-15-shared-preparation-ledger.md). No implementation or
prototype extension is part of this report.

**Recommendation: proceed with the Program-only boundary as the candidate for
a separately authorized replacement; keep the combined Document migration
stopped.** Program can replace two independently implemented top-level binding
routes using the existing evaluator. Its named removal set is 538 production
code lines against an estimated 313–448 additions, a reduction of 90–225.
Document still preserves a duplicate generic analysis path in Tycho if the
previous plan is followed. Calling that entire path dialect policy was too broad.

## 1 Classification and evidence

All Tycho ranges below refer to
`src/graph-paper/graph/document-ce-manager.ts`, SHA-256
`ef9b166a701c944952487f9ec995574658a7dd4ad14d55fecadff0b7e16fef90`.
The CE sources counted in the preceding ledger still match its hashes. CE HEAD
observed in this follow-up is `b5fb3e563cc86de269edff6837b7b32df4359b05`;
hashes identify counted shared-tree content more precisely than HEAD.

The categories classify responsibilities, not entire methods:

- **Dialect decision:** a host meaning, interpretation or admission rule that
  a generic CE analysis service cannot choose for Tycho.
- **Generic analysis:** lexical resolution, dependency ordering, constraints,
  call-site evidence or propagation that can serve more than one dialect.
- **CE workaround:** repeated parsing, declarations or conservative encoding
  needed because the current CE interface does not expose the required stable
  analysis, or because a target needs a particular declared type. This does
  not assert a current CE defect or prove that an old workaround is obsolete.

A method may contain all three. Ranges identify concrete sections; they are
not a disjoint partition to sum as additional deletion credit. The witness
programs below are source/test controls, not new executions in this audit.

### Head discovery and body preparation

| Method and source range | Category and responsibility | Concrete witness and disposition |
| --- | --- | --- |
| `_preDeclareDefinitionHeads` 11195–11337 | Dialect: first head wins across kinds; choose definition versus relation; identify named/composite actions and atomic subscript names | `h(x)=x` with `h(x)=2` makes the latter an equation, not another definition. `O=PointList(O_x,O_y)` must preserve O_x/O_y as names; source comments name `yn6f098lu7` and `oeupgr064p`. Retain the decisions in Tycho. |
| Same method 11347–11374 | Generic: collect complete recursive clause groups and request interprocedural analysis | `R(0,Q)=Q` beside `R(k,Q)=...` must be analyzed with both clauses present. CE should own grouping/checking once Tycho has identified the clauses; staging the source is not a reason to repeat inference. |
| Same method 11377–11440, 11515–11540 | CE workaround: predeclare function/value types, then reparse authored rows and bodies under final declarations | `L=[1,2]` followed by `q=L_1`: a discovery-time atomic subscript cannot be repaired by reboxing its already chosen AST. Head arity also distinguishes f(x) from a product. Replace only with a service that owns source resolution; retaining this parse-and-type prepass alongside CE preparation duplicates it. |
| Same method 11461–11473, 11500–11510 | Dialect declaration plus target workaround: atomic subscript names and real sampling parameters | O_x is a scalar solver name; t/u/v are real sampling inputs. The declaration of real sampling parameters is also retained for indexed-call compilation after CE 0.183.0 (`signature-propagation.test.ts` FIX PIN cases; `2ki2hjsouf`). The host supplies the declaration; CE need not rediscover that policy. |
| `_prepareDefinitionBodies` 11551–11608 | Generic dependency ordering with one dialect interpretation at 11590–11596 | Resolve `A=B`, `B=[1,2]` independently of row order. Deciding whether B_s means a name or an access is a syntax rule; constructing a dependency queue after that decision is generic. Do not label the queue permanent Desmos policy. |
| Same method 11614–11627 | Generic transitive analysis seeded by host state policy | `a=1`, `L=[a,1,2,3,4]`, action `a -> [1,2]`: action/live ownership comes from Tycho, but propagating possible shape changes to readers is generic. An explicit fixed state type can deliberately forbid the type-changing write; otherwise the analysis obligation remains. |
| Same method 11629–11751 | CE workaround around generic body analysis: disposable declarations, speculative type setters, parameter shadows, unknown/any distinction and final reparse | `f(P)=P[1]+P[2]` must bind its own P, not a sibling document P or library name. Cyclic functions must not erase an independently evident outer list shape. This is another analysis of the same bodies, not merely syntax normalization. |
| `_declareSignatureAnalysisNames` 11764–11789 | CE workaround: recreate all heads in every scratch analysis scope | `(unknown,...) -> unknown` heads plus derived value types make body and width probes agree. Reuse one resolved declaration set rather than independently rebuilding it in a future CE preparation path. Both signature analysis and width probes currently call this helper. |

### Signature inference and target encodings

| Method and source range | Category and responsibility | Concrete witness and disposition |
| --- | --- | --- |
| `_deriveSignaturesInterprocedural` 12133–12148 | Generic type evidence: retrieve point dimensions from known value types and collect recursion call-site candidates | `h(P)=P.x+P.y` and a point-preserving recursive base clause. CE can collect these facts once names and calls are resolved; the later host policy decides how to use them. |
| Same method 12277–12360 | Dialect decisions applied to generic evidence: list-branch piecewise policy and the raw inner-product override | Flagged `f(n)={n<3:[1,2],-1}` takes `[1,5]` whole in the Desmos mode. `scalarProductParamEvidence` at 12320–12341 can retract an otherwise generic scalar constraint. Preserve these decisions or explicitly change their meaning. |
| Same method 12155–12269 | CE workaround: declare every parameter as any, build structural and canonical projections, then run the elementwise oracle | Real witness `37c316659d`: `l(P)=sqrt(P[1]^2+P[2]^2)` beside a document function P. Tests also cover x/i collisions. The any spelling avoids usage narrowing during evidence collection. A correct lexical resolver is generic; repeating boxing to obtain it is the workaround. |
| Same method 12410–12431, 12435–12462, 12532–12642 | Generic algorithms: detect recursion, propagate parameter/return evidence and contradictions along calls | `g(x)=f(x)+f(2x)` inherits evidence from f. The Bézier and `hpr2q4kles` shapes in `signature-propagation.test.ts` need point evidence through callees. The point/list/scalar rule being propagated is dialect-sensitive; the call graph and convergence algorithm are generic. |
| Same method 12368–12390, 12589–12611, 12787–12868 | CE/target workaround: probe accepted fixed widths, propagate refusals and spell engine-facing signatures separately from classification types | `f(a)=a[3]+g(a)`, `g(b)=b[1]+b[2]`: a maximum index proves a lower bound, not an exact length; contradictory width commitments must be withdrawn. C_div/C_pow helper chains have no direct indexed evidence. Retain required target evidence, but do not count width retries as removed by a container wrapper. |
| Same method 12695–12778, 12900–12957 | Dialect: scalar-versus-whole-list mapping, recursive exclusions and piecewise union parameters | `g(L)=L-mean(L)` must subtract one whole-list mean. `scalar-parameter-signature.test.ts` 178–191 and 518–562 distinguishes this from ordinary scalar mapping and pins the flagged piecewise behavior. A generic service may report types/effects; it cannot select this host rule. |
| Same method 12958–13040 | Target encoding and recursion support | `dnz1jlbvnn`'s point recursion needs its merged clauses and point-return declaration; the historical union declaration inhibited compilation. The `recursion-point-base-case.test.ts` witness materializes 41 gradient-path points. This is not a promise that unannotated recursive inference disappears for free. |
| `_deriveSignature` 16672–16694 | CE workaround plus dialect fallback | A scratch parameter scope and canonical body feed `deriveDefinitionSignatureFromBody`; point component access selects a tuple contract, other parameters remain open. It cannot be independently retained as a second signature derivation after a replacement claims to own that analysis. |
| `_deriveComplexParamSlots` 16791–16834, 16902–16944 | Generic call-site evidence and fixed-point propagation | `f(z)=z^2`, calls at x+iy and at real x. All-complex and mixed call sites must remain distinguishable. Site collection/propagation is generic specialization analysis. |
| Same method 16775–16784, 16843–16896 and its signature emission at 12900–12919 | Dialect and CE/GLSL encoding | Whether bare i is the imaginary unit is host mode/name policy. Reparsing bodies under shadows and choosing complex versus unknown parameter spellings avoids passing vec2 to float and preserves mixed real/complex callers. `complex-parameter-slot.test.ts` pins D-263 and mixed-site cases. |
| `_deriveRecursiveComplexSignature` 16948–17044 | Generic recursion evidence wrapped in CE compilation workaround | Source witness `J(n,z)=J(n-1,z)^2+z_0`, and the c062d54000 Mandelbrot shape seeded by x+iy. Collecting self-calls and carried parameters is generic; declaring carried slots complex and the result complex is the target contract. Repeated scratch boxing is interface machinery. |

### Value typing and the elementwise oracle

| Method and source range | Category and responsibility | Concrete witness and disposition |
| --- | --- | --- |
| `_deriveValueType` 16130–16134 and 16656–16662 | CE workaround: shadow open bindings and query in a disposable scope with conservative fallback | Speculative shape inspection must not narrow the document's real binding. Keep the safety while current probes exist; a future source-wide analysis must remove those probes rather than add another private scope around them. |
| Same method 16135–16340 | Generic result typing plus conservative CE early-typing encoding; host point-carrier classification consumes the result | `P=([1,2,3],[4,5,6])`, `([],[])`, and a point over an unresolved Y_0. Choosing the source PointList constructor is dialect normalization upstream. Typing that constructor and Tuple is CE work; admitting a union because early and later CE boxing see different facts is workaround machinery, rather than a second dialect decision. `ui/document-ce-manager-point-type.test.ts` distinguishes the cases. |
| Same method 16353–16438 | Generic propagation of existing CE type results, with host point-carrier spellings | `C=(6,0)+.2(cos(T),sin(T))` and arithmetic over point lists. CE already knows arithmetic result types; Tycho maps them into its point/list declarations. Source witnesses include `ifnnzttcqg`, `jxp04v86wb`, `z2g6us1vqh`. Ownership can move only if classification consumes the same result. |
| Same method 16502–16592 | Generic width/element evidence with host mutation exclusions and target encoding | `L=[1,2,3]` accepting a live `[7,8]` override, an empty list later grown by an action, and `woeywky0kj`'s list-to-point carrier chain. The host identifies writable values; generic analysis determines what remains sound; GLSL determines why exact width is useful. |
| Same method 16610–16656 | Generic result-type propagation plus host value/macro classification | Arithmetic-wrapped range (`cvwtsabmtb`), complex constant `z_0=-.524-.566i`, and `d_2=x^2+y^2`. The last is an axis-dependent formula rather than an initialized scalar, even when its numeric result type is real. That distinction is host policy, not a type-inference defect. |
| `computeElementwiseParamTable` 18785–18847 | CE workaround: box the body with any, and sometimes again with unknown | List-branch `k(n)={n<3:[1,2],[10,20]}` can look broadcastable under the any reading while the unknown reading exposes its list shape. This is a concrete duplicate body-preparation path, not a dialect decision. |
| Same function 18849–18946 | Generic greatest-fixed-point algorithm executing a dialect broadcast predicate | `f(L)=L-mean(L)` must not be classified as elementwise in L; every recursive/base clause must agree. `isElementwiseParam` at 2262–2297 is an additional caller, outside initial signature derivation. Moving the algorithm without migrating this caller would retain duplication. |
| `analyzeBodyEvidence` 20760–20787, 20888–20918 | Generic lexical filtering and resolved call/argument collection | A local or parameter spelled like a document function must not produce an edge to that function. `g(m)=m([1,2,3,4]+1)` calls its parameter m. The complete binder rules must be reused rather than mirrored in another walk. |
| Same function 20789–20886, 20920–21011 | Generic type constraints over the resolved CE operators, with geometric evidence consumed by host classification | Component access implies point dimension; indexed access gives only a minimum width; scalar arithmetic constrains operands; a unique nonscalar product factor may be a point carrier. `hpr2q4kles` and point/list tests exercise the facts. The raw Desmos inner-product override is applied separately by `_deriveSignaturesInterprocedural` at 12320–12341; it must not make this entire canonical-tree analysis permanent dialect code. |
| `_callSiteAcceptedWidths` 11851–11923; `_refusedWidthParams` 11970–12085 | CE workaround/target specialization, with lexical safety | Declare ceWidthProbe_N functions, box arguments in fresh scopes, inspect rejected widths, then parse affected calls again. Keep unknown parameter and open-binding shadows while probing. The f(a)/g(b) width contradiction above is the control. A new prepared container that still needs these probes has not removed this mechanism. |
| `_movedLiveOverrides` 4666–4683 | Host state ownership | A live override may change independently of authored rows. Observe it and decide which state writes to submit. This is not generic type preparation and is not removed by Program. |

The source comments include historical CE-version statements; none is treated
as a new proof of current failure. Likewise, copying an existing test's expected
result into a new implementation would not validate a semantic change. The
named tests and complete fixture documents remain the correctness controls.

## 2 What this means for the Document boundary

The retained bucket is 3,072 physical/1,970 code lines. Its method counts from
the preceding ledger remain valid. There is no honest single subtotal called
permanent dialect code: the same methods intermingle semantic predicates,
generic inference and repeated CE declarations/boxing.

The previous first-delivery plan would run that scratch-scope analysis in Tycho
and then perform source-wide resolution/typing again in CE. Removing the live
registration scheduler would remove one mechanism, but leave two preparation
implementations. The ledger's conservative net increase was therefore a useful
warning, not merely insufficient removal credit.

Do not now expand CE to absorb all generic algorithms or rewrite the importer.
That would expand the stopped combined migration. A future Document proposal
must choose a precise CE analysis output and remove the corresponding Tycho
generic/workaround sections and every caller in the same delivery. Retained
dialect predicates must operate on that one resolved source representation,
rather than construct and type their own parallel bodies. This report identifies
the duplication; it does not supply an implementation authorization for moving it.

## 3 Remove revision bookkeeping that the contract does not need

Program-only needs no revisions, entry IDs, source history, value transfer,
instance slots, immutable type records or new configuration object. A notebook
edit parses and boxes another Program using the current CE scope semantics.
Retained old expressions have their existing CE behavior; this boundary does
not promise immutable old document executions.

For the still-stopped Document design, retain only an immutable ordered source
snapshot, IDs unique within that snapshot, explicit grouped add/replace/delete,
and the resulting prepared object. A handle pairs that object with its entry
ID. The host owns its current snapshot and concurrent edit acceptance.

Remove container-global ID allocation, retired-ID tombstones, lifetime uniqueness,
CE stale-base arbitration, integer position keys, a separate move operation,
byte-equality no-op detection and a memoized draft lifecycle. An optional final
order vector handles reordering. Reusing an ID after deletion is harmless
because handles identify the prepared object and transfer is explicit; it does
not resurrect the deleted binding. Renaming remains source replacement without
automatic reader rewrites.

The shared specification and ledger are updated to these simpler rules. Replacing
the 220–340-code-line source/revision component with an estimated 80–140 changes
the combined estimate to 1,980–3,200 additions against 1,806 named removals:
still **+174 to +1,394 production code lines**. This is not a revised delivery
scope or permission to continue the combined migration.

## 4 Program only using existing evaluation

Use the [approved Program contract](2026-11-12-program-operator-spec.md), with
no A1 registry-publication amendment. Types/protocols register during boxing as
P2 says; checking keeps its existing isolation and necessary restoration. There
is no immutable prepared revision to justify changing publication timing.

The replacement has one source of top-level binding/canonicalization rules:

1. Factor the existing Block sequence canonicalization into a shared internal
   sequence routine. Program selects the caller scope, approved canonical
   ordering and top-level rules; Block selects its own scope and existing block
   rules. Reuse `staticDeclarations`, duplicate checks, parameter shadowing,
   `canonicalStatement`, evidence handling and use-before-declaration checks.
   A Program canonicalizes all statements before the first executes. It does
   not run the Epsil runner's independent function-preparation algorithm.
2. Reuse `evaluateStatements` and `evaluateStatementsAsync` in
   `function-utils.ts` (3591 onward and 3878 onward). They already sequence
   expressions, establish statement epochs and call debugger/result hooks.
   Add the Program error policy: ordinary statement errors/throws are reported
   and siblings continue; cancellation stops. Block/function errors continue
   to short-circuit. Program returns the last statement's value without
   `resolveEscapingLambda`, because its declarations remain in the caller scope.
3. Adapt the existing Epsil diagnostics and result collection to those hooks.
   Reuse their code rather than copying it into another runner. `executeEpsil`
   and its async twin evaluate one Program; the per-statement boxing and
   execution loop in `executeEpsilSteps` goes. Its reporting/source logic is
   retained or relocated and earns no net deletion credit.
4. Static checking invokes the same sequence canonicalizer in its existing
   isolated check context. Raw-source typo, presence and provenance diagnostics
   remain checker work. They may inspect a checker projection, but must not
   retain a second head-installation/statement-binding implementation. Do not
   run the old independent boxing loop as a prerequisite to normal execution.
   A separate explicit check and a run can invoke the same canonicalizer twice;
   that is different from retaining two implementations of preparation.
5. Direct Program evaluation uses the same sequence handler and allows invalid
   statement operands to reach that handler so valid siblings can run. The
   existing whole-expression invalidity shortcuts need a narrow Program-aware
   adjustment; this is budgeted. Direct `compile(Program)` reuses current
   statement/block emission with function-local outputs, as P10 requires.

Only one sequence canonicalizer and the existing evaluator remain. This does
not eliminate ordinary CE assignment/signature repair such as
`afterFunctionAssignment`, global cache axes or speculative overload machinery.
There is no claim of a fully immutable type world or zero inference during all
library operations. Those obligations are outside this smaller boundary.

### Exact removal credit

Use the preceding ledger's AST-leaf code-line metric. The 434-code-line CE set
is not counted twice: the rows below extend it. The extra functions/caches are
private implementation helpers; their source references were checked.

| Removal | Range | Physical | Code |
| --- | --- | ---: | ---: |
| Prior named set: function preparation and its seven helpers, boxTopLevelStatement, runsAsProgram, isProgramBlock, firstDeclarationIndex | Exact ranges in the combined ledger section 2 | 544 | 434 |
| `topLevelRedeclaration` | execute-epsil.ts 1071–1080 | 10 | 10 |
| `topLevelDeclarationIndexes` | static-diagnostics.ts 1755–1777 | 23 | 23 |
| `declaredByEarlierStatement` | static-diagnostics.ts 1792–1805 | 14 | 14 |
| `topLevelUseCheck` | static-diagnostics.ts 1807–1823 | 17 | 17 |
| `TOP_LEVEL_USE_CHECKS`, `TOP_LEVEL_DECLARATIONS` | static-diagnostics.ts 1741–1744 and 1779–1782 | 8 | 8 |
| `isLibraryConstant` | control-structures.ts 4900–4903 | 4 | 4 |
| Program-as-Block deferral declarations | control-structures.ts 4426–4447 | 22 | 12 |
| Deferral boundary/count | control-structures.ts 4524 and 4531 | 2 | 2 |
| Per-statement deferred constant shadows | control-structures.ts 4546–4558 | 13 | 13 |
| Deferral cleanup loop | control-structures.ts 4575 | 1 | 1 |
| Total credited removal | | 658 | 538 |

The duplicate read-before-declaration index/caches are replaced by the shared
sequence's declaration metadata, with source-to-canonical statement mapping.
`declaredByEarlierStatement` callers in `execute-epsil.ts:807` and
`static-diagnostics.ts:1427` read that metadata for diagnostic suppression.
`topLevelRedeclaration`'s caller at execute-epsil.ts:611 uses the canonical
duplicate error instead. Remove `topLevelUseCheck` with its only caller,
`boxTopLevelStatement`. `isLibraryConstant` serves only the removed deferred
constant branch. Block's real declaration hoisting, shadow stack, closure logic
and ordinary use checks stay.

Do not additionally credit the old generator's loop, type aliases, imports,
editor loops, static-check emulation or other small branches. Some reporting
code moves to hooks; some check machinery remains; all relocation is neutral.

### Replacement cost and callers

These are planning code-line intervals, not measured diffs. Existing helper
bodies reused or moved are neutral on both sides of the accounting.

| Added or replacement production code | Low | High |
| --- | ---: | ---: |
| Program registration and shared sequence canonicalization policy | 90 | 130 |
| Existing sync/async evaluators' error policy and reporting bridge | 80 | 110 |
| Checker consumes common canonicalization and declaration metadata | 55 | 75 |
| Parser, direct-compile dispatch, invalid-container handling and types | 45 | 65 |
| Public execute adapters and source-order/result metadata integration | 35 | 50 |
| CE subtotal | 305 | 430 |
| Tycho parsed-container consumers | 8 | 18 |
| Combined additions | 313 | 448 |
| Net reduction against 538 | 225 | 90 |

`parseEpsil` must always return Program. Update consumers in
`prelude-runner.ts:topStatementsOf`, `notebook/cortex-analysis.ts` and
`notebook/ce-notebook-evaluator.ts:collectFunctionDefines`; preserve the
notebook's scope and rerun behavior. CE execute/check/direct evaluation and
direct compilation migrate together. Include CLI/repl and source/debug-hook
consumers in validation; no independently counted editor loop is assumed.

Tycho's prelude runner, its carrier code, admission policy, transitive
forward-read rule and compiled/interpreted per-statement routing stay. Program
alone therefore gives **zero Tycho method-deletion credit**. It also removes
none of the retained Document methods classified above. Do not pull the
separately approved compiled Program runner or symbol-sites API into this cost.

Tests are separate: estimate 250–450 new/rewritten CE test code lines and 30–80
Tycho test lines, plus 60–120 measurement-adapter lines if existing instruments
cannot express the controls. Report actual snapshot/pinned-emission changes
separately. No experimental stable-batch source is used or removed.

## 5 Conditions on the Program recommendation

The production-mechanism reduction is more significant than the modest line
estimate: remove independent early function installation, inferred Program-as-
Block detection, deferred constant-shadow handling and the separate top-level
use/duplicate-declaration path. The remaining canonicalizer serves run and check;
the same expression evaluator serves direct and Epsil execution.

This is a credible bounded replacement candidate, not evidence of a passing
implementation. Require actual combined production reduction and the named
deletions in the first delivery. If checker integration needs a second binding
algorithm, a new evaluator, a new registry snapshot framework or the broader
prepared-type bridge, stop and recost instead of exceeding this scope. An
actual addition count above 448 needs a new ledger; 538 is a break-even bound,
not permission to spend the entire difference.

Use the approved Program examples as the semantic oracle on all routes:
forward `function` versus later lambda variable, duplicate declarations,
constant write, invalid sibling followed by 5, type/protocol placement, outer
variable assignment, empty/single/nested Block, final function name and rerun.
Exercise synchronous/asynchronous cancellation, debugger hooks and source-range
diagnostics. Retain checker presence/provenance tests and registry restoration
controls. No new registry-publication semantics or decimal-context guarantees
are introduced. Necessary existing numeric safeguards remain.

Matched performance compares the same CE/Tycho source and production build
options before/after replacement, JIT off for interpreter attribution and
recorded separately for normal execution. Measure parse/box only, full first
run, repeated run, failed-statement continuation, check-only and type/protocol-
heavy checks. Include the current showcase prelude suite (including complete
large initialization separately), notebook cell reruns and whole-source/prelude
edits. Keep complete prelude execution and checking in totals even though its
runner is retained. Reuse the existing Othello/heat-spread and Burning Ship/
Multibrot/Game-of-Life controls to check caller integration, without claiming
their Document scheduler has changed.

Establish control repeatability before candidate timing; report per-case times
and spread under the shared-box rules. No reproducible construction, first-run,
steady-run or edit regression outside that envelope is accepted without an
explicit tradeoff decision. Heap checks repeatedly box/run/drop programs in
the same caller namespace, then release engines/closures; compare allocated
bytes and post-GC live bytes with the matched control. Separately retain
closures intentionally to distinguish required caller state from leaked raw
AST/metadata. There is no revision-history or tombstone retention workload for
Program-only.

The checks performed for this report were source/reference reads, AST counts,
source hashes and document arithmetic/link checks. No source tests, builds,
corpus execution or timings ran. Worktrees, additional agents and code review
were unnecessary for documentation-only analysis. No CE/Tycho implementation,
experimental walker or Gomoku support changed.
