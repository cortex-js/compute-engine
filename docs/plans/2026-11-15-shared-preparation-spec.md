# Shared preparation for Program and Document

Status: finite design proposal, 2026-11-15. Design and costing only. Continue
from [the boundary report](2026-11-15-program-document-revision-boundary.md).
The [replacement ledger](2026-11-15-shared-preparation-ledger.md) gives source
counts, callers, delivery scope and the recommendation: **revise before any
implementation**. No production code is removed by this report.

Follow-up: the [responsibility split and Program-only costing](2026-11-15-preparation-responsibility-split.md)
separates dialect decisions from generic analysis and CE workarounds. It
recommends a smaller Program-only replacement using existing evaluation, with
no revision API and no A1 amendment. The combined migration remains stopped.
Section 2 below removes unnecessary bookkeeping from its proposed Document API;
that simplification does not authorize implementing the combined design.

## 1 Scope and governing rules

One preparation service serves two containers. `Program` retains the approved
[Program contract](2026-11-12-program-operator-spec.md), except for the explicit
registry-publication amendment A1 proposed in section 6. `Document` is a
declarative collection whose entries can be queried repeatedly. They share
source bookkeeping, lexical resolution, existing CE type/canonicalization
services, diagnostics and entry metadata. They do not share execution ordering.

The first version prepares the entire container, including its complete prelude
and imported declaration descriptions. Edit submission is incremental; analysis
is not. There is no persistent reader graph, invalidation propagation, repair
wave, parent-revision chain or cross-revision identity matching for expressions.

Preparation must not execute user initializers, effects or function bodies to
discover types. Existing context-free literal canonical reductions are allowed.
Unresolved analysis remains `unknown` and cannot justify compilation requiring
a settled shape. Preparation is not a new general inference solver.

This is a contract for existing CE expression evaluation and compilation. The
experimental stable-batch walker is neither an implementation base nor a
fallback. Ordinary CE caches, effect checks, lexical frames and numeric
safeguards remain unless the ledger explicitly removes them.

## 2 Source identity and revision operations

This section concerns the proposed Document API. Program-only uses the existing
parse/box/run lifecycle and needs none of this revision machinery.

A Document source snapshot is an immutable ordered collection of entries. Each
entry has a host-supplied opaque `entryId`, unique within the snapshot, a source
representation and a source-location map. Names are lexical spellings, not
identities. A prepared handle pairs the prepared object with its entry ID; no
container-global ID, revision counter or tombstone set is necessary. IDs normally
survive replacement/rename, but reuse after deletion does not resurrect a binding
because the prepared object is different and state transfer is explicit.

An Epsil source segment can contain multiple statements. Its local statement
ordinal identifies diagnostics within that revision; it is not a promise of
stable statement identity across edits. A named state declaration must have its
own explicit host identity for cross-revision value transfer. Tycho can supply
cell IDs; a cell producing several declarations supplies explicit suffix IDs.
Multiple source entries contributing function clauses keep separate IDs and
are grouped under the function binding during preparation.

Source is either Epsil text or unbound MathJSON with source maps. The service
also permits a declarative syntax descriptor for LaTeX parsing. Tycho retains
its dialect parser and normalization policy. A normalized source representation
must retain ambiguous syntax or be regenerated from original source when types
change; a previously canonicalized `L_1` cannot stand in for source text.

The proposed API is structural pseudocode, not an existing interface:

```ts
const source = previousSource.revise({
  edits: [
    { op: 'replace', entry: pId, source: newPSource },
    { op: 'add', entry: qId, source: qSource },
    { op: 'delete', entry: oldCurveId },
  ],
  order: finalEntryIds,
});
const outcome = prepareDocument(source);
```

`revise()` validates an entire edit group against the explicitly supplied source
snapshot. Missing replacement/deletion targets, duplicate live IDs, conflicting
operations on one ID or an invalid final order refuse the group without changing
any source. Existing order is retained and additions append in edit order unless
the optional order vector lists every final entry exactly once. There are no
integer position keys or separate move operation. Changing a prelude is a source
replacement in the same group, not a separately published parent revision. The
host owns its current source and concurrency/conflict decisions; CE has no
mutable current-head pointer or stale-base arbitration protocol.

Imported declaration, library or syntax-descriptor replacement is an explicit
part of the same revision request. Replacing a host operator in the ambient
engine alone changes no prepared revision. Capture immutable standard-library
descriptors by reference and copy mutable static metadata into candidate-owned
records. A host handler that relies on mutable external static metadata must
provide a stable descriptor/contract or be refused; function identity alone is
not proof of captured semantics. Runtime capability state remains an effect.

A rename is a `replace` retaining the entry ID and supplying its entire new
declaration source. It does not rename references. Group replacements of readers
with the declaration replacement when that is intended. An editor's rename
refactoring uses CE's resolved symbol sites to produce those edits. A bare
notification that P changed, without replacement source or an explicit delete,
is insufficient. No unrestricted callback runs during preparation.

`revise()` performs no boxing or execution. It returns a materialized immutable
source snapshot, not a history link or runtime object. An empty edit group with
no descriptor/order change returns the same source object. Otherwise CE performs
no byte-equality or semantic-equivalence no-op detection. The host avoids
submitting irrelevant source changes. `prepareDocument()` is synchronous
initially and never mutates a published prepared object. Repeated calls can
prepare again; there is no memoized draft lifecycle or hidden preparation cache.
Nested preparation or execution of an unprepared source snapshot is refused.

## 3 Preparation algorithm and result

Preparation performs these bounded stages using existing CE services:

1. Materialize all entries, parse their unbound structure and discover lexical
   declaration heads, scopes and source sites. Include the prelude. Apply
   container-specific ordering and duplicate rules.
2. Allocate candidate-owned declarations and registries. Install explicit
   signatures and collect macro/type/protocol declarations in their specified
   scope. Speculative overload trials and failures cannot alter the host.
3. Resolve uses against the complete candidate declaration set. Build a
   temporary static dependency relation and strongly connected components to
   order acyclic analysis and identify recursive groups. Discard this relation
   after producing the final metadata; it is not an edit-invalidation graph.
4. Check explicitly typed recursive groups using those signatures. For acyclic
   definitions, derive result types in dependency order using existing CE
   handlers. Meet expression-use requirements in the candidate store. Unknown
   parameter types that cannot be settled soundly remain unknown; do not
   recreate Tycho's point or Desmos mapping heuristics in CE. A recursive group
   without adequate signatures receives an unresolved-analysis diagnostic;
   compile declines it, while existing interpreted execution may remain valid.
5. Canonicalize against the settled candidate declarations, validate bodies,
   and produce entry diagnostics and metadata. If a spelling requires types
   not yet settled, retain an unresolved diagnostic; do not repair it at use.
6. Publish immutable semantic records and private executable expressions. No
   partially prepared declarations become visible in the caller's namespace.

`inferFn` in `engine-infer.ts` commits requirements from expression environments;
it is not this algorithm. Reuse its type meet/conflict behavior and CE's current
binding/type handlers, but budget the orchestration and finalization separately.
No repeated whole-container retry loop is part of the CE algorithm. A syntax
ambiguity or recursive type cycle requiring a more precise solver is a
diagnostic, not permission to grow the service.

Results distinguish host misuse or implementation refusal from source errors:

- `refused`: no revision, with a reason and source location where applicable.
  Unsupported syntax or an unsafe external static descriptor is not success.
- `ready`: a revision with per-entry validity and diagnostics. Source errors
  may invalidate entries without invalidating independent siblings.

Each entry exposes its ID, source range, validity, static result/signature,
effects, resolved read/write/declare/call sites and required runtime inputs.
Reads through statically named functions are included by a finite closure of
the resolved call relation. A call through a mutable function value uses its
declared signature/effect bound and conservatively reports the permitted input
set, or declines compilation if that set cannot be settled. Returned metadata
does not expose mutable scopes or definition objects.

A lexical reference to a known invalid declaration records that binding and its
root diagnostic. It must not silently fall through to an outer declaration of
the same spelling. A dependent entry gives one blocked-by-entry diagnostic with
a link to the cause; independent valid entries remain executable. Program
control flow still determines whether a runtime read is reached. Preparation
does not add static through-call initialization proofs (CE-1007).

## 4 Revisions and handles

A revision owns source, declaration descriptions, resolved bindings, settled
type/effect records and canonical source bodies. Caches of pure properties may
be lazy, but cannot consult later host declarations to obtain static meaning.
Evaluation can construct temporary mathematical expressions using normal CE
services; those temporary expressions cannot change published source analysis.
This does not claim that all CE internal type computation disappears at runtime.

An entry handle is `(revision, entryId)`. An execution belongs to exactly one
revision. A handle passed to another revision's execution is refused. Renaming
an entry in a new revision does not change the old handle's name or body.
Deleting an entry does not revoke old handles. A same-revision value write can
change the result of a live formula through that revision's execution slots.

Old handles retain their revision, and executions/closures retain the runtime
frames they need. No current-document registry or source history retains old
revisions after the host drops them. Disposal cancels host work and releases
host references; it does not invalidate a separately retained handle. Retention
acceptance must demonstrate reclamation after all such references are dropped.

## 5 Document entries and execution

The normalized Document input has five entry kinds:

| Kind | Static contract | Execution behavior |
| --- | --- | --- |
| Input | Explicit fixed type and effect bound for callable values | Host supplies value; no initializer; missing supply is uninitialized |
| Formula | Inferred or declared fixed result type; reads only | Evaluate its body against the current instance on demand |
| State | Explicit type initially; optional initializer | Initialize once per new instance, then allow checked writes |
| Constant | Declared or conservative initializer result type | Initialize once per new instance; reject writes |
| Function | Lexical parameters and fixed signature/effect bound | Body runs only on call; definitions available before initialization |

Unresolved fixed types remain unknown; they do not become a value-driven type
in a later run. Document state requires an explicit type in the first delivery;
the host supplies it using existing normalization policy. Formula and constant
result inference uses static initializer/body types, not computed values.
Mathematical type errors invalidate the entry; an unknown result is not itself
an error and can still be interpreted.

Inputs and state are runtime slots. Formula reads use ordinary CE expression
evaluation of a stored body; they do not store the initial result as state.
Use existing value-sensitive caching and DAG memoization. There is no new
reactive dirty graph, computed-value scheduler or implicit assignment of formula
results into declarations. The host must distinguish action-writable state
from live formulas during normalization. Turning a formula into state is an
explicit source edit.

Functions use CE lexical scoping and existing closure frames. A named function
definition changes only in a new revision. A mutable callable input/state can
receive a compatible callable within its declared type and effect bound; an
existing closure observes subsequent reads of that slot. Reject an incompatible
write without changing its value. Do not infer effects from the current callable
body on every invocation. Transfer of these callable values between revisions
is excluded below.

Within a Document's own declaration layer, the first declaration of a name
stands; a later duplicate is invalid and has its own diagnostic. A normalized
multi-clause function is one declaration group with ordered, separately located
clauses, checked by CE's existing clause rules. Prelude exports form an imported
lexical layer. An explicit document declaration can shadow an imported name;
prelude bodies retain their prelude bindings. Both layers are prepared afresh
as part of the same revision, not as independently versioned parent/child
documents. Tycho's stricter admission or definition-selection policy runs before
this boundary and remains retained host code.

Only effects proven to be reads of same-instance inputs/state, together with
ordinary pure computation, are permitted in a formula. A transitive write,
unseeded random draw, console/time operation or unknown host effect invalidates
the formula. Use existing CE effects plus resolved writes/calls; an effect bound
that cannot prove read-only behavior is insufficient. Effectful work belongs
in an initializer or explicit Program action. Existing Tycho seeded-random
normalization remains host policy and must retain its tested results; this
proposal does not reinterpret ordinary `Random()` as a document constant.

Preparation rejects a formula-reference cycle, including a cycle through named
function reads. This conservative rule applies even if a branch might avoid
the read. Function-only recursion is allowed with adequate signatures and the
existing recursion limits. A mutable callable that can read arbitrary formulas
cannot be used to hide a formula cycle; require an explicit bounded read set or
refuse it in a formula. No runtime shape tests or general recursion solver are
added to admit these cases.

Instantiation supplies all inputs and explicit transfers, then installs
functions, then runs state/constant initializers in source order, with prelude
initializers before document initializers. A transferred state skips its
initializer. Constants always initialize anew. Formulas are available, but a
formula/function reading a not-yet-initialized slot produces an error at the
read. Direct forward state reads are diagnosed statically; indirect reads are
checked by the existing uninitialized-slot mechanism. No topological reordering
of effects is allowed. A failing initializer leaves its slot uninitialized;
later independent initializers still run. Cancellation stops the invocation,
rather than executing later effects after cancellation.

Initialization is explicit and occurs once per instance. Preparing or selecting
a revision does not run it. Querying a formula does not replay initializers.
Actions run existing CE Program/statement execution against the instance's
slots, with the same type admission and limits as other writes.

## 6 Program contract preservation

Preserve P1–P11 of the approved Program contract except for A1 below. In
particular:

- The parser returns `Program` even for one or zero statements. Nested `Block`
  remains a scoped block and loses the heuristic that it might be a program.
- Canonical order is types/protocols, function declarations with their paired
  signatures, then remaining statements in textual order. A lambda stored by
  `let` is not a hoisted function declaration.
- Top-level declarations belong to the caller's execution namespace and remain
  after the run. Preparation's candidate store is not a new program scope.
  Execution publishes the prepared declarations at their specified stage;
  checking alone publishes none. A new run may replace names from an earlier
  program; duplicates in the same program leave the first declaration standing.
- A function may assign a top-level variable declared later; a read before
  initialization remains an error. Constant assignment is a statement error.
- Invalid or ordinarily throwing statements yield errors/diagnostics individually
  and independent siblings run. Cancellation retains the existing stop rules.
  Source ranges and per-statement debugger hooks remain.
- The normal result is the last canonical statement's value, with the existing
  approved option to use `Nothing` only if separately justified by implementation.
- Direct `compile(Program)` keeps declarations inside the compiled function.
  It is distinct from the approved runner above `compile()` with per-name
  results and per-statement interpretation after a compile decline.

Exported namespace bindings point to the runtime slots installed by that run;
later Program declarations replace the namespace mapping rather than mutate
an old revision's static records. Old executions keep their original slots.
Ordinary writes to a shared slot are visible to closures holding it. Imports
from an earlier notebook cell are explicit typed bindings in the run context,
not reads of later ambient declarations during preparation. The normal
`executeEpsil(source)` adapter captures the current caller namespace for each
invocation. A retained prepared Program needs matching imports on execution;
it refuses a changed import signature instead of silently repreparing.

Known differences between current routes are resolved exactly as the approved
spec says. The compatibility control is its example table, not whichever old
route happens to accept a program. No whole-program rollback is introduced to
support per-statement failure. Type/protocol declarations of a check live only
in the candidate registry; existing rollback support elsewhere gets no deletion
credit until its last caller is removed.

**Proposed amendment A1 to P2: type/protocol registry publication.** The approved
spec says a type statement registers its type when boxed. Under explicit
`prepare()`, it registers in the candidate-owned registry so later annotations
in that candidate see it, but it becomes visible to the caller only when the
Program executes its type/protocol stage. Thus preparing or directly boxing a
Program containing `type T = ...` no longer makes T available to a separate
host operation before execution. Type/protocol statements still precede function
and value statements and remain available after execution. The rationale is
to make checking and failed preparation require no mutation/undo of the caller's
registry, and to keep independent prepared revisions stable. This is a proposed
observable change requiring explicit orchestrator/user acceptance before any
implementation; it is not described as already approved. Rejecting A1 requires
recosting explicit publication for the direct-boxing adapter, not silently
changing P2.

## 7 Explicit value transfer

`instantiate(revision, {inputs, transfers, config})` receives values explicitly.
Each transfer names the old state entry, target state entry and value snapshot.
Matching IDs alone never transfer a value. Validate the complete transfer set
before executing any initializer; a missing target, type mismatch, duplicate
target or unsupported value refuses instantiation without effects.

Admit materialized CE scalar values and finite recursively immutable
aggregates with no lexical/runtime ownership. Preserve exact numbers and CE
absence/error values only when their target type admits them; do not coerce
through JavaScript doubles. Refuse closures, lazy views, mutable objects, host
resources and aggregates containing them. Classify at this explicit boundary,
never on every read. Inputs are supplied again; formulas/functions/constants
are never transferred. The host either recreates refused values or explicitly
chooses to reset the corresponding state. This source/state distinction is a
deliberate change from preserving arbitrary engine bindings during a rebuild.

## 8 Existing evaluation and compilation integration

Store ordinary CE expressions and use `BoxedFunction.evaluate/evaluateAsync`,
the operator library, function application and existing lexical activation
machinery. The new code orchestrates preparation, namespace publication and
entry selection; it implements no arithmetic or collection evaluator.

The integration has three explicit work items, not an assertion that the
current engine already supplies them:

1. Finalize prepared binding type/effect records. Source-bound symbol/type and
   stored-function projections read these records directly. Existing unprepared
   expressions keep their current path. This is an expression-origin
   distinction, not a production feature flag or a second container evaluator.
2. Activate instance values using the existing lexical frame/activation support,
   with a binding-to-slot layout and uninitialized state. Source declaration
   records cannot be written by initialization or assignment. Do not put
   transient instance values into the candidate's static store.
3. Evaluate stored formulas using their ordinary bound bodies and the active
   instance frame. Existing caches still see accepted value writes, frame
   identity, effects and numeric context. No new formula cache is required.

These touch `boxed-symbol.ts`, `boxed-value-definition.ts`, `function-utils.ts`,
`engine-scope.ts` and type/effect projections. If correctness needs a parallel
binding resolver, another generic expression walker or per-read revision
validation, revise the design rather than add it.

Compilation uses existing `compile()` and targets on ordinary prepared
expressions. All mutable transitive inputs use the existing `inputs` contract
at their prepared types, even when slots currently hold values. Constants may
fold only after their explicit initialization and within the artifact's numeric
configuration. A compiled artifact identifies its revision, target and numeric
options. Different input declarations decline; specialization prepares another
source/declaration snapshot. Static errors and unsettled shapes decline under
`docs/COMPILATION-MODEL.md`. No new target handlers are part of this delivery.

Document expression queries are prepared read-only against the revision's
declaration records; they cannot narrow or declare document bindings. This
supports plot/classification callers without exposing the private static scope
as a mutable `manager.ce`. Compilation then uses the existing compiler scope
adapter internally; that adapter receives no deletion credit.

The first delivery retains the existing Tycho prelude execution/compilation
adapter's execution mechanisms. Refactor it to consume the shared prepared
statements and metadata; it must not independently publish declarations while
checking or execute prelude initializers a second time. The document
initialization sequence delegates its prelude prefix to this adapter exactly
once. Existing standalone prelude entry points prepare their own complete unit
when no surrounding document supplies one. Sharing static preparation does not
imply implementing the separately
approved per-statement compiled runner, carrier conversion or async worker
accounting. Do not claim their potential deletions in this delivery.

## 9 Configuration and the decimal limitation

Execution receives an immutable description of precision, tolerance policy,
angular unit, rounding, strictness and capability bindings. Exact/approximate
mode and budgets are per invocation. Reuse the engine's current configuration
setters and reset semantics at explicit execution entry when needed; do not
replace their cache effects with configuration identity alone.

`BigDecimal.precision` remains module-global. Existing CE documentation limits
independent engines with different precisions; this proposal neither fixes nor
extends that capability. Preserve `_withTransientPrecision`,
`_withTransientAngularUnit`, `_atTransientConfiguration`, requested/working
precision cache keys, constants' transient bypasses and rounding behavior.
Engine configuration, working precision and existing version keys remain
relevant even when two executions share an immutable options object.

The proposal introduces no requirement for independent numeric contexts. It
does introduce a correctness dependency at execution switching: using immutable
options must not suppress existing configuration resets or allow reuse of a
cached result from another working/requested precision or transient window.
It must not cache configuration-sensitive preparation folds as immutable
context-free constants. Retained old handles require the same safeguard as
ordinary engine results; they do not promise precision independence. This is
integration work with existing safeguards, not a decimal-backend rewrite.

## 10 Coherent first delivery and acceptance

The first delivery, if later authorized, is one combined CE/Tycho migration:

1. Add the shared preparation/revision service and Program adapter. Route
   execute/check and direct Program evaluation through it while retaining
   diagnostic/debug hooks and ordinary evaluator/compile handlers.
2. Replace Tycho's document registration scheduler for all its admitted plot
   documents. Keep Desmos normalization and type-policy analysis as explicit
   preparation inputs. The ledger distinguishes that retained code from
   scheduler code removed in the same delivery.
3. Route source/prelude/range/type edits to `revise/prepare`, action/slider
   writes to slots, and expression/compile consumers to revision queries.
   Keep existing prelude execution and transport policy. No fallback to the old
   registration scheduler is permitted for an admitted document.
4. Remove the ledger's named CE helpers and Tycho methods in that delivery.
   A pilot on a few documents can test correctness, but earns zero whole-method
   deletion credit while the production scheduler remains.

The finite service supports all ordinary CE operators through the existing
evaluator. Its scope is bounded by source/type/effect rules above, not by a new
closed vocabulary. Desmos normalization still covers its existing imported
dialect; an unsupported or changed result must be reported explicitly. Corpus
rows do not justify new evaluator/compiler handlers during this delivery.

Acceptance controls and matched timing/retention measurements are in the ledger.
Passing them is necessary, not sufficient: actual combined production source
must shrink, the named scheduler mechanisms must be gone, and no duplicate
fallback may hide missing semantics. The present costing does not justify
starting this delivery. The recommendation is **revise**, with implementation,
prototype expansion and Gomoku support still excluded.
