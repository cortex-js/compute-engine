# Program and Document preparation with explicit revisions

Status: proposal for the workstream orchestrator, 2026-11-15. The user
requested this report after proposing a document container analogous to
`Program`, with explicit notification of changed definitions. This is a design
and costing recommendation. It authorizes no implementation, prototype
extension, production migration or Gomoku support.

Follow-up: the orchestrator requested a
[finite specification](2026-11-15-shared-preparation-spec.md) and
[concrete replacement ledger](2026-11-15-shared-preparation-ledger.md).
Those documents refine the gross deletion targets below and supersede this
report's suggestion that independent numeric contexts might be a prerequisite.
The existing ambient decimal limitation and its safeguards remain in scope;
a decimal-backend rewrite does not.

## Recommendation

Consider one preparation service shared by Epsil programs and Tycho plot
documents. Each container supplies related source entries together; CE resolves
and types them before execution, publishes a completed revision, and accepts
explicit source edits for the next revision. Tycho stops coordinating
predeclarations, registration retries and provisional signature repair.

Keep `Program` and `Document` semantically distinct initially. Share their
analysis machinery rather than adding document behavior through execution flags
on `Program`. Initially rebuild the complete unit when source changes; precise
edit notifications do not require incremental inference.

Proceed with a finite specification and deletion ledger only. Implementation
should remain stopped until a bounded migration plausibly reduces combined CE
and Tycho production machinery. The current estimates cross zero, and the
existing prototype's construction-performance gate remains unmet.

## The replacement boundary

The useful boundary is completion of preparation. Deferring the same repairs
until the final statement would change scheduling without removing their
obligations. Instead, preparation collects related source, resolves names,
settles types and effects, performs type-directed canonicalization, and returns
diagnostics before execution starts. A completed revision performs no checks for
stale binding or type analysis while executing.

| Responsibility | Proposed owner |
| --- | --- |
| Resolve names, check bodies and settle types and effects | CE preparation |
| Own stable bindings, canonical bodies and transitive runtime-input descriptions | CE prepared revision |
| Hold mutable values and invocation frames | CE execution instance |
| Select defining rows and normalize Desmos syntax | Tycho |
| Choose axes, slider contracts, macro policy and rendering interpretation | Tycho |
| Report source edits and explicitly preserve eligible runtime values | Tycho |
| Schedule work, persist documents and render results | Tycho |

This is an explicit semantic/API change. It does not preserve automatic adoption
of later declarations by old expression handles. A compatibility layer that
silently repairs those handles would recreate the machinery being replaced.

## Program and Document semantics

The approved [Program spec](2026-11-12-program-operator-spec.md) defines ordered
statement execution, persistent top-level declarations and individual statement
failures. It also permits canonical reordering of types, protocols and function
declarations. This proposal preserves that contract unless separately amended.

| Aspect | Program | Proposed Document |
| --- | --- | --- |
| Primary meaning | Execute statements in the defined order | Query entries in a set of definitions and formulas |
| Value initialization | Ordered; an uninitialized read can fail | Distinguish live formulas, stored values and mutable inputs explicitly |
| Effects | Follow statement execution | Follow explicit initialization and action rules |
| Source replacement | Preparing replacement source does not execute it | Preparing replacement definitions does not evaluate plots |

Sharing preparation does not make a document an automatically rerun program.
In particular, editing a function must not replay unrelated assignments or
random/effectful initializers. Document formula dependencies, cycle diagnostics,
initialization order and preservation of action state need a finite contract
before implementation. Desmos-specific interpretation remains Tycho policy.

## Explicit revision submission

Illustrative API notation, not a promised public interface:

```ts
const candidate = document.revise([
  { entry: pDefinitionId, source: newPSource },
  { entry: curveDefinitionId, source: newCurveSource },
]);
const result = candidate.prepare();
```

Edits identify source entries rather than only symbol spellings. A definition
can be renamed or removed; multiple entries can contribute recursive clauses.
CE retains the source and source locations needed to reinterpret readers. A
change to `P` from scalar to list can change the interpretation of subscripts
and other syntax, so canonical expressions alone are insufficient input.

“The definition of P potentially changed” means CE must reconsider the owning
source entry and its consequences. Tycho does not supply an affected-reader
list or orchestrate repair passes. Submission groups related edits and supports
additions and removals. Preparation does not expose partially mutated host
registries. A completed revision can contain diagnostics and invalid entries;
unrelated valid entries remain available under the chosen container's rules.

Initially CE can apply the edits to retained source and prepare the whole unit,
including the prelude. The old revision stays intact. Old handles retain their
old meaning; adopting the new revision is explicit. No incremental dependency
graph, binding stamps, automatic handle upgrade or repair-on-read is required.
If full-document edit measurements later justify selective preparation, it is
an internal optimization with separately counted machinery.

A value update is a different operation:

```ts
execution.set(pInput, newValue); // Must satisfy the prepared input type.
```

Value updates do not retype nodes. Declaration, body, macro or operator-semantic
changes require preparation. Mutable inputs remain explicit through stored
function bodies and compilation; their current values are never folded into
compiled artifacts. Unsettled shapes decline compilation under the existing
compilation contract. Recursive groups may require explicit signatures rather
than a new general recursive inference engine.

Cross-revision transfer is explicit. Initially transfer only compatible values
independent of revision bindings; recreate closures, lazy views and other
revision-dependent values. Include this recreation in edit costs. External
static descriptors are captured at preparation; retaining a handler closure
that reads mutable host metadata does not make its semantics immutable.

## Immutable execution configuration

Separate three lifetimes:

1. A prepared revision owns bindings, static types, effects and bodies.
2. An execution instance owns mutable values and an immutable configuration
   containing numeric precision, tolerance policy, angular unit, rounding and
   fixed capability bindings.
3. An invocation owns cancellation, remaining budgets, random-stream state and
   the exact-versus-approximate evaluation request.

A precision or angle change selects another execution configuration. A body or
signature edit selects another prepared revision. Numeric constant folding that
depends on configuration belongs to configured execution or compilation, rather
than context-free static preparation. Assumptions remain explicit inputs to
fact-dependent transformations.

Configuration identity can replace repeated comparisons of configuration fields
in value-cache keys. It does not replace frame identity, value-write tracking,
effect rules or DAG memoization. Fixed capability bindings also do not imply
that an external effect is pure or that its state is immutable.

A frozen options object is insufficient today. CE's
`engine-numeric-configuration.ts` writes module-global `BigDecimal.precision`,
and transient precision/angular-unit operations mutate ambient state. Independent
contexts require decimal operations that obey the supplied context, appropriate
constant caches, and immutable child contexts for higher working precision or
radian calculations. Do not claim those production mechanisms disappear until
their callers migrate. A general decimal-backend rewrite is outside the current
cost estimate and would require recosting the proposal.

## Tycho deletion targets and replacement costs

The following exact declaration ranges were counted from
`src/graph-paper/graph/document-ce-manager.ts` in Tycho. They include internal
comments and blank lines, exclude leading JSDoc, and are conditional gross
deletion targets. They are not measured production savings.

| Declarations targeted for removal | Lines |
| --- | ---: |
| `_registrationFingerprint`, `_reuseRegistration`, `_movedLiveOverrides`, `_rebindWrittenLiterals`, `_bodyReads` | 451 |
| `_registerDefinitions`, `_registerRecursiveLambdas`, `_preDeclareDefinitionHeads`, `_prepareDefinitionBodies`, `_declareSignatureAnalysisNames` | 2,774 |
| `_deriveSignaturesInterprocedural`, `_deriveValueType`, `_deriveSignature`, `_deriveComplexParamSlots`, `_deriveRecursiveComplexSignature`, `computeElementwiseParamTable`, `analyzeBodyEvidence` | 2,246 |
| `_callSiteAcceptedWidths`, `_refusedWidthParams` | 189 |
| Total named target | 5,660 |

The source file's SHA-256 at the count is
`ef9b166a701c944952487f9ec995574658a7dd4ad14d55fecadff0b7e16fef90`.
Counts use TypeScript AST declaration ranges from `getStart()` through `end`.

Deleting whole methods requires replacement code for retained policy. In
particular, point/point-list interpretation, scalar versus whole-list mapping,
recursive-clause normalization, initialization, random-once values, action
overrides and failure recovery remain obligations. The public elementwise
parameter query also calls `computeElementwiseParamTable` outside signature
derivation; that caller must migrate before the helper can disappear.

The preceding source analysis gives these broad planning estimates in physical
production lines, excluding tests, documentation and generated artifacts:

| Replacement | Estimated additions |
| --- | ---: |
| CE preparation and settled analysis using existing operator implementations | 1,000–1,700 |
| CE execution/input and compilation integration | 600–1,100 |
| CE immutable configuration integration for the selected path | 400–700 |
| Tycho normalization and retained policy | 1,100–1,800 |
| Tycho revision lifecycle, explicit value transfer and caller integration | 400–700 |
| Total | 3,500–6,000 |

Against the optimistic 5,660-line target, this ranges from 2,160 fewer lines to
340 more. Partial deletion or additional numeric-context work worsens that
range. These estimates predate a replacement patch and do not establish a
bounded implementation. They must be refined around the shared Program service;
existing code reuse can reduce costs, while preserving both old and new paths
can increase them.

Give no deletion credit to the inliner, dynamic `with` handling, worker/export
transport, style machinery or renderer caches. Give no credit to deleting CE's
shared binding environments or configuration lifecycle while other APIs still
need them. Count experimental code retained alongside the replacement
separately; future removals cannot pay for present additions.

## Caller migration

Tycho submits related normalized definitions together and consumes CE's
diagnostics and settled analysis. Source edit notifications replace registration
fingerprints and retry coordination only once every relevant structural input,
including the prelude and declaration contracts, is represented.

Slider/action updates use typed input handles. Structural edits prepare a new
revision and explicitly preserve eligible values. Definition-dependent consumers
use revision identity; existing per-pass counters cannot disappear until their
additional inputs are represented. Rendering cache identities still include
their own nondefinition inputs.

Compilation consumes prepared entries and their transitive inputs. Type
specialization is explicit. Engine profiles supply immutable configuration;
notebook precision changes and document angle changes select another execution
configuration. Prelude checking, plot replay and worker reconstruction receive
explicit source, definitions and configuration.

The Program sites query and per-statement runner remain relevant shared
consumers. Their existing approved scope does not authorize expanding this
document proposal or silently changing notebook cell rerun behavior.

## Decision required before implementation

The orchestrator should obtain one finite design and migration ledger covering:

- The shared preparation result and the distinct Program/Document execution
  rules, including invalid siblings, cycles and effectful initialization.
- Edit grouping, entry identity, deletion/rename behavior, publication, old-handle
  lifetime and explicit value transfer.
- The exact Tycho methods and callers removed in the same delivery, with
  replacement policy code and all CE additions counted.
- A numeric-context plan that either fits the bounded migration or explicitly
  excludes unsupported operations without a second production fallback route.
- Named real-document controls and separate measurements for preparation, first
  execution, repeated execution, value edits and complete source/prelude edits,
  plus allocation and obsolete-revision retention.

Recommend implementation only if conservative combined production savings are
positive and the required constructs fit a bounded migration. Do not extend the
prototype to discover the boundary. Do not add Gomoku support. Do not introduce
incremental inference, compatibility repair or another general evaluator merely
to make this proposal appear complete.

The [stable batch revision report](2026-11-15-stable-batch-phase1-revision-report.md)
records the unmet construction-performance gate. This proposal neither waives
that gate nor changes the scope of the
[prototype plan](2026-11-15-stable-batch-prototype-plan.md). The earlier
[batch investigation](2026-11-09-binding-a-set-of-definitions.md) supplies
historical host requirements, not current deletion credit.

This report changes documentation only. No implementation validation, timing,
staging or production adoption is claimed. Tests, builds, worktrees and
additional agents were omitted because the change is confined to this report.
