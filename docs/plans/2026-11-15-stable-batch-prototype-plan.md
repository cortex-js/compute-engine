# Stable batch preparation: prototype and measurement plan

Status: prototype plan requested by the user on 2026-11-15. The user agreed
to an explicit batch boundary and separation of static types from assumptions.
The revision and API choices below are recommended experimental defaults, not
changes to the published contracts. No implementation or release is certified
by this document. Start with phase 0; review its evidence before phase 1.

Revised after independent Claude Opus and Codex Sol review, at the user's
request. Section 7 records the disposition of all 14 consolidated findings.
These choices govern the isolated experiment; existing published contracts
remain in force outside it. No prototype session may silently extend its scope.

Reference checkout when drafted:
`0e9069cf2e0322f4ba81f2236f386ab4b2db06ad`. Other sessions have uncommitted
changes. Each experiment records its own exact source and build identity.

## 1. Objective and scope

Make binding explainable and maintainable; reduce combined CE and Tycho code;
recover boxing performance while retaining runtime improvements. Backward
compatibility is not the deciding objective. A semantic change must nevertheless
be explicit, illustrated, and distinguished from an accidental regression.

The central invariant is:

> Preparation may change declarations and solve constraints. A completed unit
> has stable binding identities and static types. Evaluation changes values,
> not that analysis.

A prototype succeeds by removing obligations, not by adding a faster cache on
top of the same obligations. No npm release, production migration, new general
incremental framework, or wholesale rewrite is part of phases 0–2.

References:

- [Post-mortem](2026-11-15-binding-workstream-post-mortem.md).
- [Bound-once spec](2026-11-11-bound-once-spec.md), especially rules 1–7,
  D16–D18 and compilation inputs.
- [Earlier batch investigation](2026-11-09-binding-a-set-of-definitions.md).
- [Approved Program spec](2026-11-12-program-operator-spec.md).
- [Cache architecture and profiling](2026-10-30-evaluation-cache-architecture.md).
- [Benchmark instruments](../../benchmarks/README.md).

The earlier Tycho deletion inventory is evidence to recheck, not a promise:
`~/dev/compute-engine-recovery/2026-11-15-tycho-deletion-inventory-ce-0.192.0.md`.

## 2. Proposed contract for the experiment

### Preparation and ownership

Use one internal preparation service. `batch()` groups related declarations
and expressions; `infer()` requests analysis through that service; `Program`
uses it while retaining its statement semantics. Do not build three inference
engines. The existing infer API commits requirements: changing that behavior
needs an explicit migration decision, not an unnoticed wrapper change.

Preparation collects heads, expands macros under documented capture rules,
resolves names, solves type constraints, and performs type-directed
canonicalization. These are logical stages, not five mandatory tree copies.
Library operator declarations are inputs to preparation as well as user names.
No host-visible declaration or registry is mutated by a speculative candidate.

The initial prototype uses an explicit declaration/definition collection, not
an unrestricted callback that can mix evaluation and declarations. A callback
API can be considered later if it preserves the same boundary. Nested batches,
async preparation, and evaluation during an unfinished batch are unsupported
initially and must report that condition rather than silently finalize.

The adapter uses a tagged result: `{ status: 'ready', unit, diagnostics }` or
`{ status: 'unsupported', reason, location }`. A ready unit can contain invalid
entries with diagnostics; unsupported means the prototype cannot implement the
requested construct. Neither is a successful fallback. Host misuse before a unit
is ready is an unsupported result; mathematical errors keep CE's error values.

### External inputs and document boundary

Capture static inputs at preparation: operator handlers and immutable metadata,
signatures, type/protocol registries, external declaration descriptions and raw
macro bodies. Never retain a mutable definition object as the source of later
static reads. Immutable library descriptors may be shared by reference; mutable
descriptors must be copied into revision-owned records. Retaining a handler
function alone is insufficient if it reads mutable definition state: audit the
handlers reached by the subset, pass captured metadata explicitly, or reject
that operator. Do not snapshot the entire engine or add read-time version checks.
Runtime precision and numeric configuration belong to the explicit run context
and any value-cache key, not the prepared static type.

There is no automatic detection of later host declarations or operator changes
for old handles. A host explicitly prepares a new revision to adopt them. An
external mutable value is an explicitly typed runtime input, not an ambient
`ce.assign()` lookup. Test both external operator replacement and input updates.

Initially use one batch per document, including its prelude and user definitions,
over the captured library descriptors. There are no parent document revisions
or child invalidation graph. Full-edit measurements include prelude preparation;
do not exclude it as setup. A parent-revision design is an alternative only if
these measurements justify it, with its host/CE tracking counted explicitly.

### Stable revisions and mutable values

- A prepared revision owns bindings, signatures, static types, effects and
  canonical bodies. It may lazily compute a pure property from those immutable
  inputs; it may not resolve it from the current operation or runtime frame.
- Runtime values live in a separate instance/frame. Value updates within a
  declared type do not prepare again. Captured mutable values retain ordinary
  closure semantics; static immutability does not freeze captured values.
- Replacing a declaration, signature, macro, operator semantics or body creates
  a new revision. Initially rebuild the whole batch; incremental dependency
  graphs are a separate experiment justified only by edit measurements.
- Old handles keep the old revision and its runtime instance. New revisions
  receive values explicitly; no hidden sharing or migration between revisions.
  Measure transfer/reinitialization in the document-edit workload.
- A new declaration cannot silently rebind an old handle. Existing automatic
  re-resolution is deliberately different and must be listed in the comparison.
- Mixing expressions from revisions requires explicit preparation in one target
  revision or a diagnostic. Do not recreate automatic environment meets.
- Standalone boxing should eventually use the same service for a singleton
  unit. The prototype does not change production `box()` to achieve this yet.

A named definition body is revision-owned. A variable holding a prepared function
is a runtime slot: assigning another compatible function to that slot changes
subsequent calls through existing closures without replacing static bindings.
Its declared signature includes a conservative effect bound; assignment must
respect both its type and that bound. Application effects use the bound, not an
inspection of the current callable body. This deliberately sacrifices precision
to avoid runtime analysis. Phase 1 refuses mutable callable slots explicitly;
support and the reassignment fixture are mandatory before phase 2 completes.
Ordinary same-revision closure capture keeps per-invocation frames distinct.

Cross-revision transfer initially admits only values independent of revision
bindings (numeric/string literals and immutable aggregates of such values),
compatible with the new slot's type. Closures, lazy views, mutable objects and
values that transitively contain them are refused, not rebound or copied behind
the host's back. Classify at the explicit transfer boundary, never on every
read. A host recreates these values in the new runtime instance if needed, and
that work is included in edit timings. Old handles deliberately retain their
own frames; dropping every old handle must permit reclamation. Supporting
cross-revision closures with their original semantics is a future alternative,
not a requirement for this probe.

Static type is distinct from facts. Assumptions are explicit inputs to
simplification and other fact-dependent operations. They neither mutate a
prepared node's static type nor silently enter its canonicalization. Any result
whose transformation used facts retains that context in its cache identity.
Numeric precision, evaluation mode and effects remain relevant to value caches.

Use the identity of the whole immutable fact context, not a set of recorded fact
reads. In this prototype only explicitly fact-dependent operations such as
simplify consume it. Prepared evaluate/N use no assumptions; later ambient
`ce.assume()` does not affect prepared handles. A fact-derived simplified result
is explicitly tied to the context that justified it and cannot be reused as a
context-free answer. Do not port this restriction to production APIs implicitly.

### Types and executable programs

Separate constraints on uses from settled parameter types and from automatic
collection mapping. Resolve these together before type-directed lowering.
Do not first assume a scalar signature and repair it after seeing a list.

Start with acyclic inference. Recursive groups require adequate explicit
signatures; otherwise return a diagnostic or conservative unresolved analysis.
Compilation declines unsettled shapes and static errors according to
`docs/COMPILATION-MODEL.md`. Do not add runtime shape tests to make a prototype
compile. More precise recursive inference is outside the first slice.

All batch heads may be visible during resolution. This does not authorize
reading an uninitialized value. For Program, preserve the approved distinction
between forward function declarations and ordered variable initialization,
duplicate-declaration handling, and per-statement diagnostics. Failed
statements must not make valid siblings disappear. Preparation can return
diagnostics and invalid nodes without treating the entire Program as atomic.
Publishing a prepared batch and executing a Program are distinct operations.

For batch execution, named function definitions are available before value
initialization; value initializers execute in collection order. Preparation
collects names without executing initializers. A direct forward value read is a
diagnostic on the reading entry; an indirect read of an uninitialized runtime
slot produces an error at that read. This runtime slot check does not infer
types or compute a call-graph proof. The second declaration of a duplicate name
is invalid; the first remains. Valid sibling entries can execute after an error.
A failing initializer leaves its slot uninitialized; later reads report that
condition. An empty batch is ready with no entries. Explicit publication exposes
the prepared handle and its diagnostics, not partially mutated host registries.

Program retains its approved statement ordering, declaration visibility and
error rules. Its direct forward-read fixture is required; static detection
through calls (CE-1007) is not added here. Program adaptation is a phase-2
extension, not a requirement to implement all Epsil routes in phase 1.

Mutable slots have one settled type. Phase 1 requires explicit types for them.
A write incompatible with that type or its effect bound is refused with a
diagnostic and leaves the previous value intact; it never widens a type or
creates a revision. Phase 2 may infer a slot's type from its initializer's
static type; literal singleton types are widened to the existing type system's
non-literal primitive type for mutable slots (for example, integer-valued numeric
literals to integer, string literals to string). This does not widen integer to
real; callers that need real-valued updates declare real. Unresolved types remain unknown and compilation
declines where a settled shape is required. A constant has a literal type only
when supplied by literal syntax or existing pure literal canonical reduction.
Computed initializers are not executed to obtain static literal types; use
their conservative static result type instead. This is an explicit experimental
restriction relative to D16, not a reason to add preparation-time execution.

All macro declarations in the batch are installed in builder-local state before
readers are boxed, including textual uses before a declaration. Expansion keeps
the existing capture, hidden-name and cycle rules. This differs from sequential
host calls that box a reader before declaring its macro; it does not re-expand
already prepared nodes. Add both orders to the fixture and report the difference.

### Compilation of a prepared unit

Compile mutable runtime slots as explicit inputs, including transitive reads in
stored bodies. Required-input reporting describes these bindings even if they
currently hold values. Never fold a mutable slot's current value into this
artifact. Revision-owned literal constants can be folded. A caller supplies
fresh values on each invocation; no value-change recompilation is needed.
Unsupported callable inputs or target representations decline explicitly.

Initially a compile input declaration must match the prepared slot's static
type; a different type declines without modifying the revision. A host needing
specialization explicitly prepares a separate unit from the source and new
declarations. Automatic transient specialization is an alternative deferred
until a real consumer requires it. This restriction of bound-once rule 6 is
recorded as prototype behavior, not silently imposed on production compile().

## 3. Contract fixtures

The notation below is semantic pseudocode, not an existing or promised API.
Phase 0 turns these rows into executable fixtures through a small adapter;
unsupported baseline features are labeled unsupported, never timed as errors.
Check values with literal expectations, independently of baseline behavior.

| ID | Required phase | Fixture and required observation |
| --- | --- | --- |
| F01 | 1 | Real `x`, prepared `x + 1`, supply 2 then 4: 3 then 5; same type/revision, no binding tracking |
| F02 | 1 | `f(x)=g(x)+1`, `g(x)=2*x` in either order: `f(3)=7`, identical signatures |
| F03 | 1 | New revision changes `g(x)=3*x`: old `f(3)=7`, new `f(3)=10` |
| F04 | 1 | Independent units with different requirements for a free name do not change one another or host declarations |
| F05 | 1 | Mixed-revision syntax is refused until explicitly prepared from source in one target revision |
| F06 | 1 | Redefine captured external operator `Foo`: old revision unchanged, new revision adopts it; no external version checks on static reads |
| F07 | 1 | Repeated value updates do not retype; incompatible write leaves the old value; duplicate declaration, empty batch, failing initializer and direct/indirect uninitialized reads follow section 2 |
| F08 | 1 | Explicit transfer of supported literal aggregates succeeds; a closure/lazy/object transfer returns unsupported without changing either instance |
| F09 | 1 | Mutable callable slot is explicitly unsupported, rather than frozen or dispatched through live binding analysis |
| F10 | 2 | Compatible same-revision callable reassignment is observed through an existing closure; incompatible type/effect bound is refused |
| F11 | 2 | Closure captures a mutable local; separate invocations retain distinct frames |
| F12 | 2 | Real `x` with an explicit positive fact context: static type stays real; simplification is context-bound; ambient assumptions do not alter prepared evaluate/N |
| F13 | 2 | Arithmetic parameter versus explicitly typed list parameter: mapping/whole-list choice settled before execution; use existing documented witnesses |
| F14 | 2 | Failed overload trial leaves no constraints for the successful candidate |
| F15 | 2 | Typed recursive pair evaluates without runtime re-inference; unresolved unannotated recursion has an explicit diagnostic/decline |
| F16 | 2 | Program forward function call, direct forward variable read and invalid statement with valid sibling retain the approved behavior; no new static through-call analysis |
| F17 | 2 | Stored `f(t)=a*t`, mutable real `a`: compile once with a reported as an input; supply 2 then 4 and t=3, obtain 6 then 12 with the same artifact |
| F18 | 2 | Compile with a different input type declines, leaving the prepared unit unchanged; explicitly preparing a specialized unit is separate |
| F19 | 2 | Macro declared before/after textual use gives the same expansion within a batch; capture, hiding and cycles follow the existing macro rules |
| F20 | 2 | Binder capture follows existing documented examples; binding types stay stable during execution |
| F21 | 2 | Inferred mutable initializer type is widened as specified; computed constant is conservatively typed without executing its initializer |
| F22 | 2 | Document plus prelude is rebuilt as one batch; new revision adopts edited prelude, old handles retain old behavior |

Phase 0 freezes exact source inputs, expected values/diagnostics and existing
witness/test paths for every row. It runs supported baseline controls and records
unsupported proposed semantics as specifications, not passing tests. Phase 1
must pass F01–F09. Phase 2 must pass all rows, with F09's explicit refusal replaced
by F10's supported behavior. No implementer selects only passing rows. If the
phase-2 extension is too broad, the coordinator revises the scope explicitly
before implementation; do not silently delete a fixture from the gate.

## 4. Phases and gates

### Phase 0 — contract fixtures and trustworthy baseline

Owner: measurement session, with coordinator resolving semantic questions.

Deliver a small adapter/harness, exact fixture inputs, source/build manifests,
raw measurements, and a reproducible invocation. Compare 0.186.0
(`c4856e003557e367d4a2272d37d1567e9dd7a9b3`) with a pinned current commit.
Do not run old fixtures through a substitute API without labeling the change.
Read benchmark instructions before modifying a harness and add its README entry.

Gate: mathematical controls pass; workload coverage and timing methodology are
reviewed; current cost is reproducible; every intentional semantic difference
has an expected outcome. The coordinator fixes the measurement noise envelope
and acceptance margins from baseline repeatability before candidate timings.
No numerical speedup or deletion target is invented in advance of this evidence.

The accepted report names numeric margins separately: box/preparation-only and
preparation-plus-first-execution against 0.186.0; repeated evaluate/N and
value-only edits against pinned current CE; full document edits, allocation and
retention against current CE. Report both baseline ratios wherever equivalent
work exists. A feature with no equivalent old API has an absolute budget fixed
from the selected host workload. Baseline variability measures uncertainty; it
does not by itself authorize a regression. The coordinator records recommended
budgets and rationale before candidate timing, and the phase review explicitly
accepts any tradeoff. The old units-off baseline is historical evidence only.

### Phase 1 — smallest stable preparation prototype

Owner: one CE implementation session in an isolated worktree. Start after the
phase 0 contract review. Cover arithmetic, declarations, a function, a forward
reference, and value versus definition updates. Reuse existing arithmetic and
evaluation; no miniature replacement evaluator that omits the real costs.

The fixed gate is F01–F09. Phase 2's broader constructs may initially report
unsupported, never fallback. New node classes or changes to shared classes are
both permitted experiments; count duplication and hot-path branches. If shared
classes change, include the patched build with the prototype unused as a control
against phase 0, so the production path's layout/dispatch cost is visible.

Publish prepared static types and direct binding identities. Prototype frame
slots only if needed; replacing all activation machinery is not a prerequisite.
Outside the selected subset, return an explicit unsupported result. Do not
silently fall back to the live binding path and count it as prototype success.

Deliver a patch and a mechanism ledger: removed, bypassed, still required,
newly added. Include temporary scaffolding in counts. A side path with no
demonstration that the old obligations can go is not sufficient.

For each proposed removal, name the file/function and run the supported fixtures
with that old entry point set to throw in a separate diagnostic build. Cover
external-definition checks as well as unit tracking. Show actual net changes
including coexistence scaffolding, and projected migration deletions separately.
A diagnostic counter or throw probe proves absence of a dependency in the
supported subset, not removability for every production consumer.

Gate: F01–F09 pass; static reads after preparation perform no unit
lookup, read-token validation or dependency propagation; runtime value updates
do not invoke static analysis. Verify these with diagnostic counters separately
from timing. Independently measure production-equivalent builds against phase 0.
Timing, allocation and retention must meet their phase-0 budgets or return an
explicit revise/stop recommendation; a timing win cannot silently waive memory.
If types still require contextual reads, return the counterexample and revise
the contract before adding another invalidation mechanism.

### Phase 2 — one actual Tycho deletion

Owner: Tycho session, coordinated with the CE implementer. The user launches
or explicitly authorizes the Tycho implementation; a CE brief alone is not
authorization to modify another repository's source.

Choose one existing document preparation path and real corpus fixture whose
registration/type-recovery code the prototype can replace. Include stored-body
evaluation, compilation and required-input reporting. Select the exact path
and removable methods before extending CE. Do not promise the entire inliner
or document manager disappears.

Phase 2a is selection and costing only. List the path's required constructs,
F10–F22 coverage and missing CE support. The coordinator reviews that finite
extension before any new CE implementation; split it into bounded slices with
named tests and ledgers. Reject or narrow a path that requires a broad rewrite.
All accepted slices and the fixture matrix are fixed before phase 2b, which
implements the extension and Tycho deletion. The coordinator can amend this
plan with the reason; an implementer cannot expand it merely to make a corpus
document pass. Source selection need not wait for all phase-1 timing to finish,
but implementation does wait for the phase-1 gate.

Deliver CE and Tycho patches together, actual deleted methods and callers,
replacement code, equivalent results, source diagnostics, and timings. Keep
Desmos import and rendering policies in Tycho. If the path requires an
unapproved change to macro or dynamic-scope behavior, report it as a product
decision rather than quietly moving that policy into CE.

Gate: real Tycho code is removed; no duplicate fallback path masks missing
semantics; combined source complexity falls; boxing/preparation and runtime
meet the predeclared margins, as do allocation and retention. All phase-2
fixtures pass. The combined source gate uses actual Tycho deletions minus all
CE/Tycho additions; projected future CE deletions are not credited. Report each
regression separately rather than hiding it in an aggregate score. No production
adoption yet.

### Phase 3 — migration decision

Coordinator reviews phase 2 with the user. Choose expand, revise, or stop.
Expansion must identify the next production mechanism to delete and its
consumer. Before landing public behavior, update model documents, changelog,
CE guides and Epsil sources as AGENTS.md requires. Address the existing Program
and infer contracts explicitly. A broader implementation plan follows measured
success; it is not authorization supplied by this draft.

## 5. Measurement protocol

Use the benchmark skill and shared-box rules. Record runtime/V8, architecture,
precision, build settings, full commit and patch digest, bundle hash, process
count, warmup, repetitions, lock owner and load. Fresh sessions must establish a
valid lock owner; do not impersonate a Claude session when tooling refuses one.
Measure in stable checkouts; certify shared-tree inputs before and after a run.

Record CE `jit` independently of V8 configuration. Interpreter-attributed runs
set `ce.jit = 'off'` before setup; end-to-end runs record their chosen policy.
Verify implicit-compile counters outside timers. Record Node flags, heap limits
and environment overrides, identical between timing arms. Build both source arms
with equivalent production options and record toolchain differences; do not mix
published and local bundles without identifying that separate comparison.

Keep these workloads separate:

1. Startup, engine creation, rule loading, first preparation and first call.
2. Box-only and prepare-only: arithmetic; function/binder construction; a
   representative Tycho definition batch. Include singleton preparation.
3. The existing eleven CE-1210 cases: D01 D03 D05 D06 D07 D08 A01 CR2 CE1 CE2
   CE3. These are box-plus-evaluate, not a boxing-only measurement.
4. Preboxed evaluate and N: unchanged values, relevant writes, unrelated writes;
   plain arithmetic, a shared DAG, a function and a closure.
5. Tycho's interpreted call, codegen audit, prelude workloads, and the selected
   document path. Pin fixtures and gate versions as well as CE.
6. Value-only document edits versus body/type edits, including full reprepare
   and runtime value transfer. Include a large real document to expose the
   cost of rebuilding the entire batch.
7. Discarded temporary expressions, retained prepared documents, and repeated
   revision replacement followed by dropping obsolete handles.

For workloads 2 and 4, also measure preparation plus first execution and report
where static analysis occurred. Gate that total and box-only separately: eager
analysis must not look free by moving outside the timer, and a good total must
not hide a regression for callers that only box. Fix the number of retained
units, document size and revision replacements in phase 0. Record allocated
bytes per operation and post-collection live bytes after obsolete roots are
dropped, with budgets and noise estimates. Include recreation of refused
cross-revision values and the entire prelude in edit costs.

Use separate processes per arm, identical production build options and
alternating AB/BA order across rounds. Keep validation outside timers. Publish
per-case medians and spread, absolute time and ratios; do not claim a small
change that is within repeatability noise. Recheck competing processes even
while holding the advisory lock. Contended/torn runs are invalid, not averaged in.

Profile separately from uninstrumented timing:

- V8 CPU profiles scoped to preparation and to execution after warmup; retain
  startup profiles separately. Use source maps for production attribution.
- Sample allocations including collected objects; report bytes/operation and
  allocation stacks. Constructor invocations are not physical allocation counts.
- Heap snapshots/retention experiments after controlled collection outside timed
  regions; distinguish retained bytes from total allocation and RSS. Inspect
  paths retaining old revisions, environments, maps and closures.
- GC time, frequency and promotion; object sizes and shapes; hot inline-cache
  sites and optimization/deoptimization reasons. Aggregate site counts alone
  do not identify hot-site cost.

GC-control flags and explicit collection are used only in the separate memory
experiments, identically across their arms; never insert collection in timing
loops. Retention runs distinguish deliberately held old handles from dropped
ones. A plateau across repeated replacement is required in addition to the
absolute budget; investigate surviving roots before calling growth a leak.

Use the scalar-arithmetic and boxing harnesses where applicable; validate the
instrument on a known control before extending it. Never infer a production
performance floor from an unsafe ablation or an unminified startup profile.

Count source additions/deletions separately for CE and Tycho, plus net combined
source; report tests/snapshots and generated files separately. Count removed
mechanisms and state transitions as well as lines. Relocation and minification
are not simplification. Explain retained caches with measured workloads; preserve
DAG memoization, effects, mutation and numeric-context correctness.

## 6. Fresh-session briefs and handoff format

The coordinator keeps this contract and makes phase decisions. Use one CE
implementer and one measurement/review session; add a Tycho owner in phase 2
within shared-machine limits. Timing runs are serial. Do not launch another
writer into the same binding files while a previous slice remains unresolved.
Sol is suitable for the bounded implementation/measurement tasks; a fresh
session must receive the relevant paths and contract, not depend on chat memory.

### Brief A: phase 0

Read AGENTS.md, BUILD.md, the shared-box protocol, the benchmarks skill and this
plan. Implement only phase 0 in an isolated worktree. Own benchmark adapters,
fixtures and their documentation; change no production binding semantics.
Pin current and 0.186.0 builds, run controls before timed experiments, and return
raw artifacts plus exact rerun commands. Classify unsupported old APIs honestly.
Freeze concrete inputs and expected outcomes for F01–F22. Establish baseline
variability, named comparison arms and timing/allocation/retention budgets before
any candidate result exists. Record CE jit mode and verify execution routes;
keep production timing separate from profiling and controlled collection. Do not
commit, release, or start phase 1. Report blockers without bypassing the lock.

### Brief B: phase 1

Read AGENTS.md, BUILD.md, architecture/model documents, this plan and the accepted
phase 0 report. Implement only the agreed phase 1 subset in an isolated worktree.
Use existing arithmetic/evaluation semantics. Keep assumptions out of static
types. Pass F01–F09, including explicit callable-slot/transfer refusals. Capture
external static inputs; do not resolve them lazily through mutable engine state.
Return the specified unsupported result outside scope. Demonstrate absence of
contextual binding/type tracking with counters and throwing-entry-point probes.
Measure the patched old path if shared node layouts or dispatch change.
Run typecheck and targeted contract tests; coordinate broader completion checks
with the orchestrator under repository rules. Return the patch, mechanism ledger,
changed contracts and unrun checks. Do not commit, release or expand the subset
to repair unrelated failures. File discovered defects under the repository rules.

### Brief C: independent measurement and source review

Read this plan, the accepted phase 0 report and the candidate patch. Verify the
candidate reaches the proposed path and returns correct results before timing.
Use the same inputs/build configuration and serialized box-lock runs. Attribute
preparation, execution and allocation separately; inspect object shape and
retention only as evidence warrants. Do not modify the candidate while measuring.
Include preparation plus first execution, jit-off interpreter controls and
the memory gates. Check actual versus projected deletions separately.
Report observed versus inferred findings, exact source identities and commands,
exit codes and limitations. Follow required code review/validation rules before
integration; this measurement review does not replace them.

### Brief D: phase 2, for a Tycho implementation session

Read Tycho's instructions, this plan, accepted phase 1 evidence and the deletion
inventory. Complete phase 2a first: identify one corpus-backed preparation path,
deletable methods, missing constructs and the extension needed for F10–F22.
Obtain the coordinator's scope review before phase 2b implementation. Include
prelude preparation and value recreation in edit costs. Implement the deletion
and run assigned Tycho gates against the exact candidate package. Report combined replacement
cost, behavior differences and performance. Keep import/rendering policy in
Tycho. Do not publish, commit, or adopt a new npm version as part of the probe.

Every phase report contains: scope and full source identities; patch and raw
artifact paths; exact executed commands and exit codes; correctness results;
intentional behavior changes; per-workload timings and uncertainty; allocation
and retention; code/mechanism accounting; checks not run; and a recommended
continue/revise/stop decision. Record defects in issues, not as a handoff queue.
Retain reports and raw evidence through review, then clean experimental worktrees
and temporary files once their needed artifacts are preserved.

## 7. Disposition of the dual-review findings

The review found 3 high, 10 medium and 1 low concerns. The following decisions
resolve them for the experiment; they do not certify an implementation. No
second dual review has been run on this revision.

| Finding | Decision and verification |
| --- | --- |
| 1 External ownership | Capture static descriptors; audit handler dependencies; F06 and forbidden-entry probes |
| 2 Callable values | Separate definition bodies from mutable slots with static effect bounds; F09 then F10 |
| 3 Closure transfer | Refuse revision-dependent transfers; recreate explicitly and count edit cost; F08/F11 |
| 4 Compiled value updates | Mutable bindings are explicit transitive inputs, never folded current values; F17 |
| 5 Compile type overrides | Decline differing types; prepare specialization explicitly; F18 |
| 6 Initialization/type lifecycle | Ordered values, duplicate/error rules, stable slot types and conservative computed constants; F07/F16/F21 |
| 7 Prelude boundary | One document/prelude batch; include full rebuild cost; F22 |
| 8 Macro order | Collect macros before reader boxing, preserve capture rules; F19 |
| 9 Facts | Explicit whole-context identity for simplification, fact-free prepared evaluate/N; F12 |
| 10 Scope/removal proof | Fixed fixture phases, phase 2a scope gate, throwing-entry probes and actual/projected ledgers |
| 11 CE implicit compilation | jit-off interpreter lanes and separate route verification |
| 12 Timing comparisons | Named baselines, total and box-only gates, patched-old-path control |
| 13 Memory | Allocation/retention budgets, dropped-root plateau and separate GC experiments |
| 14 Unsupported results | One tagged adapter result, excluded from successful timing samples |

Alternatives deliberately not selected: automatic updates of existing revisions;
parent/child revision tracking; transparent closure migration; automatic compile
specialization; per-fact dependency collection. Each adds a mechanism before a
representative workload has established its need. A later phase review can
choose an alternative with its behavior example, code cost and measurements.
