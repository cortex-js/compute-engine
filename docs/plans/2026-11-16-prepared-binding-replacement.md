# Prepared bindings: finite semantics and replacement ledger

Status: bounded implementation ACCEPTED by the user through the orchestrator,
2026-11-16. The acceptance below supersedes the investigation's recommendation
and D1 alternatives. D3, Fragment revisions, new failed-redeclaration semantics,
numeric-context changes and general recursive inference redesign are NOT authorized.

## Accepted implementation amendment — 2026-11-16

An explicit annotation fixes the contract. Otherwise preparation infers from
initialization without executing it. Mutable numeric initializers establish
`number`; mutable lists lose fixed lengths and widen their element types; tuples
retain arity with widened components; callable initializers establish `function`.
Constants may retain more precise information. Reuse existing widening where it
expresses this policy.

`let x; x = 1` establishes its contract during preparation when a unique later
initialization occurs in the same straight-line statement sequence before any use.
The slot remains uninitialized until execution reaches that assignment. Do not
search branches, loops or calls for initialization. Otherwise the contract stays
unknown and runtime uninitialized-read checks remain.

Subsequent assignments only validate: no widening, inference or variable-to-operator
promotion. Evaluation never narrows unknown. Function-value, alias, constant and
notebook redeclaration rules remain; use-site diagnostic facts are separate.

Replace assignment-evidence convergence on the existing Program/Block route,
including nested loops and Match. Remove sessions, rejoin/reset registration,
pass/coarsening budgets and obsolete callers; retain admission, initializer typing,
absence, destructuring and effects. If any stated scope needs the old solver,
stop with its witness rather than keep a fallback or parallel path.

Use Sol for implementation and independent review. Pin controls first, then run
repository checks and a matched original/current/candidate performance comparison,
including allocations, retention and actual derivations. Report original
unannotated witnesses separately from annotated migrations. Stop for coordinator
review; performance recovery does not authorize scope expansion.

Source anchor: CE `dbcfdca7e5b5a8852b6554a1ad359dfac4724c1e`, working-tree
source read on November 16. Tycho source was read directly, without git commands.
Locations below are navigational anchors, not immutable line-count certificates.
The untracked November 15 design documents and unrelated issue edits were left
untouched. This proposal supersedes their lifecycle assumptions only where stated;
it does not silently amend the approved Program contract.

## Bounded implementation precision notes

The implementation preserves the existing unadorned positional MathJSON
`Declare(x, "unknown", value)` inference marker. Authored Epsil `: unknown`,
attributes carrying a type, and typed declarations without an initializer fix
unknown explicitly. The distinction is structural and survives serialization;
source offsets do not select binding semantics.

Deferred initialization uses a conservative call barrier: any intervening runtime
application or application in the proposed later initializer prevents inference.
Literal/structural initialization can still qualify. Thus `let x; x=1` infers
number, while `let x; x=1+2` stays unknown; an annotation or initializer in the
declaration restores that precision. This avoids interprocedural/effect analysis.
Compilation declines source declarations without initializers, including the
supported interpreted straight-line case; signatures paired with definitions and
compiler-generated temporary slots are exempt.

The removal also makes written unannotated function parameters conservative:
their contracts stay unknown, using existing assignment-to-binding metadata.
Assignments supply no result-type evidence. Authored parameter annotations and
the existing general function/recursive inference route remain in place.

The runtime initialization check applies to newly admitted source declarations
without values. It tests physical slot presence, not visibility through symbolic
value shields. This does not amend existing Program hoisting, failed-declaration
publication or namespace replacement. On the November 18 IR compiler, the
existing input-shape checks decline the complex-point witness. A fixed unknown
can hold a matrix, so canonicalization preserves the order of potential matrix
factors.

The bounded implementation's actual removal accounting, semantic migrations and
validation are recorded in the
[delivery ledger](../scratch/init-contracts-2026-11-16/LEDGER.md). The remaining
sections retain the broader design investigation; they are not authorization to
implement D3 or Fragment revisions in this delivery.

## 1. What actually removes work

The reported residual ratios remain 1.820 boxing, 1.500 parse+box, 1.100 checking,
and 1.276 notebook rerun versus the original baseline. These are prior matched
measurements, not measurements of this proposal. See
[coordinator review](../scratch/program-type-work-2026-11-16/COORDINATOR-REVIEW.md),
[trace](../scratch/program-type-work-2026-11-16/TRACE-FINDINGS.md), and
[callsite audit](../scratch/program-type-work-2026-11-16/CALLSITE-AUDIT.md).
The approximately 556 net production lines already removed earn no new credit.

The trace's `let a=3; let b=a+1; b` derives Add, writes b's inferred type, advances
versions, then derives Add again. Moving that sequence into a map would still
perform two derivations. Keeping all-write inference would still require sound
joins, dependency propagation, cycle termination and loop widening in that map.

| Obligation | Under the accepted lifecycle alone | Additional simplifying choice recommended here |
| --- | --- | --- |
| Resolve lexical names, shadowing, declarations and imports | Remains; move ownership, not work | Resolve once and publish the resolution |
| Type initializers and operator applications | Remains; cannot count a stored answer as free | Analyze acyclic initializer dependencies in order |
| Reconcile every assignment with every inferred target and revisit back edges | Merely moves if present precision is retained | **D1:** initializer establishes contract; subsequent assignments only validate |
| Infer recursive signatures through evolving live definitions | Moves unless precision is relaxed | **D2:** annotated recursive interfaces or unknown results, no result fixpoint |
| Repair already-published expressions after declaration/signature changes | Disappears for prepared units | All imports and identities fixed at preparation |
| Re-derive static types after ordinary value writes | Disappears | Values never supply new static contracts |
| Undo preparation's definition mutations | Disappears only when all such writes cease | Unit-local declarations, types and protocols; no live mutation |
| Check mutable callable's current arguments/defaults/effects | Remains | Runtime invocation, not static binding repair |
| Recompute formula values after state changes | Remains | Existing evaluator/value invalidation; no static inference |
| Tycho's recursive/call-site/width specialization | Not automatically removed | Explicit contracts or accepted compilation loss; do not transplant the solver |

Acyclic ordering is a temporary dependency computation, not a persistent
incremental graph. Type algebra, overload selection, generic instantiation,
argument admission and effects remain real costs. Publication may allocate new
nodes and records; storing final node types costs memory. No net speed or line
reduction is established until those costs are measured against actual removals.

## 2. Data and lifecycle

There are three distinct records, using CE binding identity rather than spelling
as their key. These are semantic fields, not a proposed generic framework/API.

1. **Preparation record:** source declaration/site, lexical owner, explicit
   annotation, initializer/body, dependencies, state (unvisited/visiting/finished),
   candidate type and diagnostics. Records can change before publication. The
   analysis reads source contracts, not execution-slot contents. A declaration
   with an invalid initializer has a record and a failed initialization status;
   failure is not evidence of a narrower type.
2. **Final binding record:** unit identity, binding identity, name, fixed type and
   callable/effect contract, const/mutable/formula role, source provenance and
   slot address or function descriptor. Declared/inferred provenance is diagnostic
   metadata only. Types and semantic binding links are immutable after publication.
   Source ranges and occurrence roles may remain for diagnostics and host queries;
   transient queues, candidate records and inference edges are discarded.
3. **Runtime slot:** uninitialized, initialized(value), or failed(initialization
   diagnostic). Stores and activation frames change values/status, never a final
   record. Initialization is distinct from a value of Missing/Nothing/unknown.
   Recursive calls get separate activation slots for the same lexical records.
   Closures retain the unit and the activation cells they capture.

The stages are: classify/resolve source; choose contracts; validate and canonicalize
against those contracts; publish a prepared unit; initialize/execute/query it.
Existing canonicalization must not publish a fold that relied on a provisional
narrow type. Resolve raw structure first and perform type-dependent canonical
rewrites after contracts are settled. Existing arithmetic/type handlers are reused;
a second evaluator or complete second boxed tree is not required by the semantics.
Whether the existing canonicalizer can meet this without an expensive double walk
is an implementation risk, not assumed solved.

Each unit owns bound nodes whose meaning depends on its records. Reboxing a shared
node into another unit creates a new binding-bearing result; it never rebinds the
old node. Immutable numbers/strings and immutable library descriptors can be shared.
Published node static types must not read live assumptions, changing registry entries,
or current slot values. Assumption-sensitive proofs/sign/evaluation queries remain
separate; their caches do not become immutable just because static types do.

An old handle keeps its original bindings, not a snapshot of all values. Explicitly
shared imported slots can still change compatibly. No revision number, parent unit,
automatic upgrade, stale-handle repair or retained revision chain is necessary.
Retaining an old closure intentionally retains its unit; unreachable units can be
collected. The engine's current namespace must not retain every former unit.

## 3. Finite typing and admission rules

### D1 — initialization-defined contracts (accepted, amended 2026-11-16)

The acceptance above is normative for this delivery. Explicit annotations win.
Otherwise mutable numeric initialization gives `number`; lists recursively widen
elements and erase lengths; tuples retain arity and recursively widen components;
callables give `function`. Preserve absence-domain handling. Constants may retain
precision. Empty collections with no element evidence do not invent a numeric
element contract. Unknown stays unknown after finalization.

A unique later initialization in the same straight-line sequence before any use
can establish a declaration's contract. Branches, loops and called functions are
not searched. The runtime initialization point does not move. Later assignments
validate without contributing evidence. This replaces the earlier proposed
integer/real tier preservation and initializer-only restriction.

After choosing contracts, validate every initializer, assignment and return using
existing admission rules. A definite refusal preserves the old slot; an uncertain
symbolic store follows the existing match/overlap/refuse contract and read-time
validation (`docs/TYPE-SYSTEM.md`, `storeAdmission`). Apply the same rule to declared
and inferred final contracts. Const rejects subsequent writes. Preserve existing
atomic tuple-pattern assignment; do not generalize it into whole-statement rollback.
Side effects completed before a failing call remain effects.

Final `unknown` is unresolved information, not a promise of a numeric shape. It
admits values without establishing a new contract; calls/operators validate what
they actually receive. It must not be confused with uninitialized storage. Explicit
`any` also remains dynamic and declines where compilation needs a shape. This
amends the current type-model wording that `unknown` continues to ask live inference
to determine a type: after finalization the request is closed, possibly unanswered.

### D2 — bounded cycles and effects (recommended precision boundary)

Build dependencies only from source initializers and function interfaces needed
for type derivation, respecting lexical identity. Acyclic records are finished in
dependency order. A visiting record terminates inference with unknown for the
unannotated cyclic result, not a previous generation's answer. Mutually recursive
function groups use explicit parameter/result signatures as assumptions and check
bodies against them. Missing recursive results stay unknown; no call-site solver,
iterative candidate signature or fresh body reboxing to seek a better result.
Known outer constructors can retain their shape only when the ordinary type handler
proves it without consulting the cyclic unknown. No optimistic placeholder counts
as a proven shape.

A loop's carried variables already have fixed contracts. Check each assignment
against them. Derive the index from the finalized collection contract and a
pattern leaf from that contract once. A local initialized inside the loop is typed
from these same fixed inputs, so the next iteration cannot invalidate it. An
unknown carried value remains unknown and consumers decline compilation when needed.
This replaces inference convergence with admission; it does not remove loop
correctness obligations.

Effect soundness also remains: annotations are checked, not trusted evidence that
an arbitrary implementation is pure. Acyclic effects can be derived in dependency
order. For unannotated recursive/dynamic calls use a conservative effect ceiling;
require an explicit interface where admission needs more precision. Check every
body against its declared ceiling with recursive edges at that ceiling. Do not
iterate to recover a least effect set. Existing effects analysis for other consumers
is retained; an immutable record is not permission to cache an effectful result.

### Callable variables and standalone expressions

A `function` slot can successively hold integer-, string- and integer-parameter
literals. Each invocation uses the actual value's annotations, defaults, names,
partial-application and effect checks. An alias initialized from that slot copies
the current function value, not a live alias to the slot. An explicitly declared
arrow retains its existing admission/interface rules. Do not insert a current
value's defaults permanently into a call through a coarse mutable `function` slot.
Binding identity stays fixed while runtime invocation selects the current value.

Standalone boxing offers literal types and results justified by the operator's
contract. Unresolved symbols stay unknown; being an operand of Add does not declare
a numeric input. An explicit host numeric contract is the remedy. Preparing a later
unit can resolve a formerly absent name; evaluating the old prepared expression
cannot. Legacy ambient host APIs may coexist during migration, but their live
inference/repair code receives zero global deletion credit until migrated.

## 4. Program, Fragment and external environment

### External contracts and namespace publication

Preparation captures a name-to-binding map, type/nominal/protocol descriptors and
callable interfaces from an explicitly supplied environment. Existing immutable
prepared bindings can be imported with their slots. A mutable legacy definition
cannot be captured by merely pointing at its mutable type: use an immutable contract
copy plus an admitted value/slot bridge, or reject that import. A host implementation
may remain a callback behind a fixed signature/effect ceiling. Changes to signature,
prelude, conformance implementations or nominal definitions require new preparation.
A changed implementation is not smuggled into an old immutable descriptor.

**D3 — publication timing amendment to Program P2/P11:** preparation and checking
register types, protocols and declarations only in the unit. Execution publishes
accepted declarations into the caller namespace in P2's canonical order: types and
protocols, functions, then remaining statements in text order. Type-only statements
remain visible to later annotations during preparation without global registration.
A checked-but-never-run Program changes no caller registry. This is a necessary
explicit replacement of P2's global registration during boxing, not a cleanup
justified merely by popping a scope.

CE-1557 adds an ordering requirement for protocol defaults. A declaration
table built before type and protocol checking must retain the original
source positions and admission decisions. An accepted earlier `const`
admits a symbol default. A same-program `let` or later declaration of that
name masks a constant from an older run for this check. If the current
constant's type is still unavailable, check the argument when the default
is filled. The shared declaration table can replace the rank-0 pre-scan once
it supplies those facts without publishing an initializer value.

In the live Program namespace, existing protocol member handles read the
default from the protocol's declaring scope at each call. They observe a
later redeclaration there and ignore a caller-local shadow. Keep those
semantics until a change to the live API is explicitly accepted. A separate
Document revision with a revision-owned namespace can resolve its defaults
in that namespace. Preserve both CE-1557 cases in
`test/epsil/parameter-default-values.test.ts` when replacing the Program pass.

P1/P3/P4/P6/P8/P9/P10 otherwise stand: Program has no extra user lexical scope,
functions are available in canonical order, function bodies can refer to a later
Program variable, top-level-only forms stay restricted, invalid siblings continue,
and the final function name/result behavior and direct compilation policy stay.
Unit ownership is not a new lexical scope. A direct read before its declaration
is still an error. A call that reaches an uninitialized later variable fails at
runtime; no interprocedural definite-initialization solver is promised.

Before running a variable initializer, publish its new binding with an uninitialized
slot; success fills it, failure marks it failed. A syntactically accepted declaration
therefore replaces the prior namespace entry even if its initializer fails. Reads
of that binding report the initialization failure, not the older value. This precise
failed-redeclaration rule is part of D3 and needs acceptance. Invalid declarations
and duplicate declarations do not replace the earlier accepted declaration.
Cancellation stops later publication; successful prior statements remain visible.

P7 redeclaration in a later Program allocates a new record/slot and updates the
caller name map. It does not mutate the old record. Old closures/handles keep the
old binding; a new Program imports the current map. Assignment to an existing name
imports and updates its existing slot compatibly. Re-executing the *same* prepared
Program reuses its unit's bindings and reinitializes declaration slots; reparsing/
preparing a notebook rerun creates new ones. Overlapping executions of the same
instance are rejected; separate instances have separate owned slots. D3 explicitly
replaces the November 15 promise to retain home-scope/re-resolution behavior.

### Fragment formulas and state

A Fragment supplies all relevant entries/declarations and identifies their roles:
formula, initialized mutable state, constant, function or action. Tycho chooses
these roles and its dialect's equation-versus-definition, first-head and name rules.
CE resolves the resulting source once. Parsing ambiguities such as `L_1` versus an
atomic subscript must be settled after head classification; cached already-resolved
syntax cannot be repaired by assigning a type afterward.

A formula is a bound expression evaluated when queried against the instance's
current slots; it is not an initializer repeatedly overwriting state. Its static
type never follows later values. Formula caching is optional, with existing purity,
value and numeric-configuration safeguards. Initially use existing evaluation;
whole-fragment re-preparation must not be required on a slider tick.

State initializers run once per new instance. Initialize independent dependencies
in order, preserving source order for unrelated effectful initializers. An
initialization dependency cycle leaves affected slots failed/uninitialized with a
cycle diagnostic; no numeric solver runs. Independent entries still initialize.
Recursive functions are callable values, not an initialization cycle merely because
their bodies call each other. A queried formula cycle returns a cycle/error result,
never a previous cached guess. An action executes through existing evaluation and
writes admitted state values. Formula entries are not writable state slots.

**D4 — compatible writes and explicit transfer:** actions/sliders cannot change a
fixed state contract. A type-changing action requires an explicitly wider contract,
unknown dynamic state with compilation loss, or a new Fragment. Source/declaration/
prelude edits prepare the complete Fragment; no selective rebind scheduler remains.
Tycho retains responsibility for replacing its current instance and query handles.

Transfer uses an explicit old-to-new state-slot map chosen by the host, not spelling
or revision ancestry. Initially accept detached literals and eagerly materialized
containers of transferable values, after destination admission. Exclude closures,
lazy views, mutable object identities and opaque host values tied to old bindings.
Refuse rather than silently copy them; the new initializer then runs only if the
host explicitly chooses initialization. Preflight all requested transfers before
installing any; a transferred slot skips its initializer. Type equality alone does
not prove transferability. External shared slots are imports, not copied state.

Numeric precision remains ambient as today. Keep BigDecimal/configuration guards;
independent numeric contexts and a decimal backend rewrite are out of scope.

## 5. Diagnostics, compilation and witnesses

Diagnostic flow uses final binding identities and source sites. Straight-line facts
may retain a known literal/function at a use and copy it at an alias. Definite refused
writes retain the prior fact. Branch/loop/unknown effect or uncertain write loses
facts conservatively; mutable alias writes invalidate affected value evidence.
No definition setters, signature promotion, assignment simulation, general alias
solver or interprocedural flow fixpoint. Keep typo checks, absence/presence rules,
source ranges, authored-error provenance and suppression of cascades. A failed
sibling does not stop checking unrelated statements. Such facts never refine the
published static shape or justify compilation that otherwise declines.

Compile reads finalized types and explicit input contracts. Unknown/any required
inputs decline with their names; invalid/static-error subexpressions decline.
Different-shape branches and unset shapes decline under R1–R6. A declared union at
an input/parameter retains one dispatch and one body per member; this is not a
new runtime shape test inside the body. Preserve absence and bigint caveats.
Never compile using the current numeric value of an unknown slot. Opaque/dynamic
callee specialization is not added. If a unit-owned slot is consumed as an input,
the host/runtime boundary supplies a value satisfying the final contract; existing
overlap-admitted symbolic values require the existing boundary checks/materialization,
or a decline. No new compiler type-test obligation is implied.

IR reuse is narrow: `ir/lower-functions.ts:userBinding` reads source definition
identities; `signatureTypes` reads source interfaces before numeric conversion.
`compile-locals.ts:blockLocalValueFrame` and binding-aware assignment extraction
are candidates for genuinely shared pure traversal helpers. IR `V`, SSA joins,
`inputType`, lowering frames, `Facts` and def-use indexes are downstream compiler
representations, not source contracts. In particular, `inputType`'s wide numeric
lane handling cannot be used to turn a source unknown into a proven number.
`sliceProgram` lowers/verifies/optimizes/admit targets; successful lowering is not
required for diagnostics. Do not grow `experimental/stable-batch.ts` into an evaluator.

These are proposed outcomes against existing source witnesses, not newly executed
candidate results. R = runtime, T = public static type, D = diagnostic precision,
C = compilation coverage.

| Existing witness / evidence | Proposed outcome and change class |
| --- | --- |
| `let a=3; let b=a+1; b` (matched notebook fixture) | Value 4 preserved. Initializer dependency order, no assignment rejoin. Performance unmeasured; no claimed derivation count until implemented. |
| `function square(x){x*x}; let x=3; let y=square(x); y+1` (matched Program fixture) | Preserve value 10. Bare parameter stays unknown; retain only operator results justified without narrowing x. C may decline unless signatures establish required shapes. |
| `let a=h(1); let h=(x)=>x+1; a` versus a top-level `function h` (P2/P3) | Lambda forward read still fails; top-level function remains available. No intended R change. |
| `let x=1; let x=2; x`, `const c=1; c=2; c`, `let a="x"+1; 5` (Program spec) | First declaration/value stands, const write fails, valid sibling gives 5. No intended R change. |
| Repeated integer/string/integer function assignments, aliases before/after replacement (November 15 probe) | Accepted stable-function rule retained; value annotations checked at call. T is coarse function; D loses uncertain flow facts; C may decline. |
| Gasket `circles` tuple append, then next-iteration `e=circles[j]` (`assignment-evidence.ts` header; `tycho-item-332-compiled-program-parity.test.ts`) | D1 rejects an append outside the initial element contract; annotate the carried list broadly enough to preserve the original run. R/T/C amendment, not permission for a wrong complex lane. |
| `let xs=[1,2,3]; while let [h,...]=xs {xs=Rest(xs)}; xs` (`control-structures.ts:1296`) | Mutable length erasure allows empty result without assignment widening. T loses fixed length; C may lose fixed-width specialization. |
| Recursive list builder (`recursive-list-builder-compile.test.ts`) | No unannotated recursive-result convergence; use result signatures or unknown/decline. T/D/C precision changes; no initializer execution. |
| Tycho `A=B`, `B=[1,2]` (`_prepareDefinitionBodies`) | Fragment formulas resolved by dependency, independent of source row order. Program direct forward-read rule remains different. |
| Tycho `a=1`, `L=[a,1,2,3,4]`, action `a -> [1,2]` (manager and prior responsibility audit) | Fixed numeric a rejects the action. Explicit dynamic/union state or replacement required. R/T/C amendment. |
| Later Program redeclares k with a string-function initializer (CE-1352/probe) | New binding checked without old signature; old handle remains old. D correction plus accepted old-handle R change. |
| Unresolved input in `If(m<3,m,0)` (compilation model R1) | Unknown input declines; supply a host contract. Amend R1's allowance for expression-required inferred input types on standalone preparation. T/C change. |

## 6. Source replacement ledger

This is a mechanism ledger, not a claimed diff. **Actual removals delivered by
this investigation: zero production lines.** The first-delivery column identifies
real source owners whose obsolete mechanism must be removed together, not moved.
Whole-file deletion is not claimed for mixed-purpose files. Test, documentation
and instrument changes never earn production deletion credit.

Paths in this table are under `src/compute-engine/` unless stated otherwise.

| Owner and current callers | First bounded delivery (§7) | Complete prepared-lifecycle replacement / retained responsibility |
| --- | --- | --- |
| `library/assignment-evidence.ts`: sessions, registered rejoin/reset closures, pass budget, coarsening, lost-evidence state, structural joins | Remove solver and its call sites under D1. `core.ts:joinAssignmentEvidence`, `joinEvidenceOnBinding`, `recordPatternEvidence`; `control-structures.ts:canonicalSequence` session and loop-index registration are the consumers | Initializer typing, absence-domain preservation, destructuring and assignment admission remain. Moving these helpers is zero credit. |
| `control-structures.ts:1306` Match scratch closure preparation for assignment evidence; `:5758` index rejoin | Remove evidence-only duplicate preparation/rejoins; validate against fixed carried contracts and derive index once | Match binding/pattern admission and runtime closure construction remain; cannot delete error checking with the duplicate walk. |
| `boxed-expression/declared-local.ts`: FIRST_VALUE_SEEN, UNKNOWN_FIRST_VALUES, OPEN_LOCALS; `_assignmentEvidence` consumers in symbol/core paths | Replace inference-status decisions for migrated sequence bindings with finalization; count deletion only if last caller gone | DECLARED_LOCALS and local/effect/assigned-local markers have generic-solver/effect/compiler consumers; do not delete the file wholesale. |
| `boxed-symbol.ts:_inferWithoutFacts`, `boxed-function.ts:_inferWithoutFacts`, `_setType/_writeType` and inferred setters | No live inference on migrated bindings; keep compatibility callers outside scope | Global removal requires migrating standalone/host/assumption callers. Final records remove runtime type setters, not value stores. |
| `function-utils.ts:afterFunctionAssignment`, `deriveCallerSignatures`, APPLIED_NAMES, sync/async evaluator calls at 3634/3967 | Not credited unless both evaluator routes and every supported legacy clause path migrate | Final signatures remove execution-time caller repair waves, snapshots and name-dependency memo. Admission/effect checks remain at preparation/store/call. |
| `boxed-value-definition.ts:declaredType`, `_deriveSignatureOnce`, `_wildcardSkeleton`, `_reviseLiteralArrowEffects`; analogous operator definition signature derivation | Retained for legacy definitions; no whole-file credit | Final unit types remove live formula-type rereads and recursive signature/version memos. Function effects and wildcard/explicit signature checking still happen during preparation. |
| `boxed-function.ts:_reboxedForForwardCallee`, `_forwardRebox`, free-head version checks | Retained outside first slice | Closed unit resolution removes automatic later-name repair. `_reboxedForCallee` mixes static repair with necessary current callable argument/default validation; replace that invocation responsibility, do not claim all its work vanishes. |
| `boxed-expression/provisional-application.ts`: DEPENDENTS, REGISTRATIONS, WeakRef sweep, rollback and repair callbacks | No first-slice global deletion | Closed preparation eliminates waiting for later definitions in prepared units. Callers: `engine-declarations.ts:891–899`, `boxed-expression/utils.ts` update path, both definition classes, `function-utils.ts:1631–2171`, injected callback in `init-lazy-refs.ts`. All must migrate for file-level credit. Ambiguous syntax resolution remains preparation work. |
| `src/epsil/static-diagnostics.ts:500–620`: DefinitionRestorePoint, type/protocol/provisional/kind rollback, inference counters and restored-type events | Only inference undo proven unnecessary on migrated sequence route can go | D3 removes unit preparation rollback when registry writes are isolated too. `definition-restore-point.ts` and definition snapshot hooks still serve other speculative writers until all callers are removed. Do not reuse November 15 pin-helper deletion estimates without finding current definitions. |
| `engine-configuration-lifecycle.ts:noteStateEvent`, scratch advances, deferred inference-settled events | No global deletion | Inference/type-repair axes can go only after all producers and cache consumers migrate. Evaluation versions, value writes, effects, assumptions, configuration and host-state detection remain. |
| `boxed-expression/cache.ts`, object-deps, shared-evaluation-memo, sign/structural/lazy caches | Retain | Fixed static node types need no generation/provisional-result memo. Shared cache machinery also guards mutable object fields, assumptions, lazy materialization and runtime values: deleting it is unsound. Numeric configuration guards remain. |
| `binding-unit.ts`, lexical binding identity, activations, captured types | Reuse binding identity/activation ownership; no blanket credit | Remove repair/re-resolution only after closed imports work. Runtime captures/slots and scope identity remain essential. Captured-type snapshots for rederivation may disappear separately. |

### Tycho: same-delivery conditions, not speculative line credit

Read `src/graph-paper/graph/document-ce-manager.ts` at the following symbols.
The prior [responsibility audit](2026-11-15-preparation-responsibility-split.md)
provides additional corpus witnesses; its old line totals are not a current diff.

| Current owner/callers | What can disappear in a complete Fragment migration | What remains or moves |
| --- | --- | --- |
| `_registerDefinitions` calls `_preDeclareDefinitionHeads`, then body/signature preparation | Incremental rebind/fingerprint reuse paths (`_lastRegistrationFingerprint`, `_lastRegisteredCells`, `_registeredValueHeads`, selective literal rebinding) once every source edit supplies a complete Fragment | Host entry classification, source ownership, state role selection, reporting and conversion to CE inputs remain |
| `_prepareDefinitionBodies` dependency queue, scratch declarations and `_shapeChangingNames` propagation | Scratch declaration/type-setting/reparse workaround; propagation anticipating runtime shape-changing writes when D4 forbids them | Dependency ordering moves to CE; shape changes inside an explicitly unknown contract still cannot justify static specialization |
| `_deriveSignaturesInterprocedural`, `_declareSignatureAnalysisNames`, `_deriveSignature` | Duplicate CE body analysis only when corresponding CE output is consumed and all old callers are removed | Semantic scalar/whole-list mapping, point rules and recursive clause grouping remain host inputs. Recursive/width inference is eliminated only by accepting annotations/coverage loss, not by moving its loop |
| `_deriveComplexParamSlots`, `_deriveRecursiveComplexSignature`, width-oracle retries | Call-site propagation/recursive specialization can be omitted under D2 and explicit complex/shape contracts | Mixed real/complex and indexed-vector corpus coverage must be measured; no blanket promise those shaders still compile |
| `_bindingEpoch`, `_definitionsRevision` and plot/style consumers | Unit identity can replace the binding epoch for compiled closures after all consumers use it | `_definitionsRevision` includes style sources outside registration; value uniforms, styles, runtime random effects, plot caches and numeric changes still need signals. Do not delete both counters as “revision machinery” |

The bounded CE experiment gets **zero Tycho production deletion credit**. A later
Fragment delivery gets credit only for removed methods/branches and migrated callers
in that delivery. Keeping Tycho inference as a prerequisite to CE preparation would
be two implementations and fails the simplification objective.

New production obligations are concrete: temporary resolution/initializer records;
final-record access in existing boxing; slot-backed runtime stores; immutable import
and namespace publication; read-only diagnostic facts; Fragment role/initialization/
transfer adapters. Neither the IR nor stable-batch already supplies all these.
No credible line estimate follows merely from naming those records. Compatibility
host routes are retained costs, not invisible exclusions from the ledger.

## 7. One bounded replacement and acceptance gate

Under the accepted D1 amendment, replace **assignment-evidence inference for all existing
Program/Block sequence preparation, including nested loops and Match**, on the
existing route. Do not add a new public prepare API, opt-in batch walker or Fragment
scheduler for this experiment. Use existing binding identities and evaluator;
introduce only the temporary initializer records needed for these sequences and a
final contract read for their bindings. Include execution's declaration/store path
so evaluation cannot undo finalization by narrowing or widening. Both checking and
execution consume this route; no fallback to the old evidence solver for hard cases.

The concrete removal gate is disappearance of `withEvidenceSession`, rejoin/reset
registration, pass/coarsening budgets and assignment structural-join machinery,
plus their core/loop/Match callers. Retain and reuse necessary initializer and
admission helpers. If that cannot be done without a parallel inference implementation
or the broad Fragment/host migration, **stop and recost**; a new table alongside the
old solver is not a successful experiment. This is a mechanism-removal experiment,
not the completion of the accepted architecture or another Program micro-optimization.

Measure production additions/deletions by owner, counting relocated code as neutral.
Separately count tests, changed snapshots/pinned emissions, docs and instruments.
No upfront line reduction promise: reject a merely additive bridge that keeps the
retired mechanism. Follow repository review/build requirements for a later code
change; this analysis supplies no implementation validation.

Correctness controls: the witness table, ordinary arithmetic/collection evaluation,
unknown and annotated stores, default/named/partial callable arguments, recursive
functions, nested shadowing/closures, failed siblings, direct compile shapes,
loop/Match/tuple pattern admission, and sync/async cancellation. For gasket and
recursive fixtures report original unannotated outcomes separately from annotated
migration outcomes; changing a snapshot does not demonstrate parity. Test stable
types before/after evaluate/N and repeated value writes.

Reuse the matched workload protocol for original baseline, current consolidated
source and candidate: box, parse+box, check, first execution, repeated evaluate/N,
notebook rerun, loop-heavy construction and annotated gasket execution. Record
actual derivations and assignment-analysis passes separately from getters; count
allocations and retained bytes as well as latency. Include preparation plus runtime
admission costs, not just an isolated type-table lookup. Build/benchmark under the
box lock with matched inputs/configuration and contention rejection. Do not loosen
the current repeatability envelope to call a regression acceptable. Remaining costs
relative to the original baseline must stay visible even if candidate/current improves.

## 8. Decision and limits of this investigation

**Historical recommendation, superseded by the acceptance above.** The original investigation recommended:

- **D1: adopt initializer-only contracts and mutable-list length erasure.**
  Alternative: preserve all-write inference inside the temporary context; then
  the solver merely moves and its deletion/performance case must be withdrawn.
  Concrete costs: annotations for gasket carried element widening, inferred
  integer-to-real writes and fixed-width consumers.
- **D2: accept unknown recursive results/conservative effects unless annotated.**
  Alternative: retain a bounded inference solver with its full cost. Corpus
  witnesses include recursive list builders and Tycho point/complex recursion.
- **D3: defer caller namespace/type/protocol publication to execution; replace
  failed redeclarations with failed new slots; old handles keep old records.**
  Alternative publication-on-boxing retains external mutation/undo obligations.
  Explicitly amend P2/P11 and document rerunning a prepared instance versus
  preparing a new notebook Program. No automatic old-handle upgrade.
- **D4: require compatible action writes and explicit, restricted state transfer.**
  Alternative unknown state is interpreted where shape is needed; retaining
  shape-changing inference would contradict the accepted runtime rule. Tycho's
  numeric-to-list action is the concrete behavior affected.

D2 and D4 largely make the accepted direction precise; D1 and D3 contain additional
choices not yet approved by that direction. These decisions can be accepted or
revised together. No generic analysis framework, compiler expansion or revision
machinery is recommended.

Validation for this report: source/reference and caller searches, current model
comparison and local document/link checks only. Prior executable probes are cited
as prior evidence; none were rerun or represented as new measurements. No new defect
was established beyond the already recorded CE-1352 witness. No production, test,
Tycho or public-guide edits, implementation, build, timings or commits. Worktrees,
subagents, production code review and suites were omitted because this delivery is
design-only. The report is left unstaged for review.
