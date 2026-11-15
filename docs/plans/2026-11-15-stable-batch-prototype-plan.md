# Stable batch preparation: prototype and measurement plan

Status: prototype plan requested by the user on 2026-11-15. The user agreed
to an explicit batch boundary and separation of static types from assumptions.
The revision and API choices below are recommended experimental defaults, not
changes to the published contracts. No implementation or release is certified
by this document. Start with phase 0; review its evidence before phase 1.

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

Static type is distinct from facts. Assumptions are explicit inputs to
simplification and other fact-dependent operations. They neither mutate a
prepared node's static type nor silently enter its canonicalization. Any result
whose transformation used facts retains that context in its cache identity.
Numeric precision, evaluation mode and effects remain relevant to value caches.

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

## 3. Contract fixtures

The notation below is semantic pseudocode, not an existing or promised API.
Phase 0 turns these rows into executable fixtures through a small adapter;
unsupported baseline features are labeled unsupported, never timed as errors.
Check values with literal expectations, independently of baseline behavior.

| Fixture | Required observation |
| --- | --- |
| Declare real `x`; prepare `x + 1`; supply 2 then 4 | Values 3 then 5; same static type and revision; no binding dependency collection on reads |
| Prepare `f(x)=g(x)+1`, `g(x)=2*x` in either order | `f(3)=7`; same settled signatures for both orders |
| Replace `g(x)=2*x` with `g(x)=3*x` in a new revision | Old `f(3)=7`, new `f(3)=10`; no silent old-body mutation |
| Prepare two independent units with different requirements for a free name | Preparing one does not change the other's type or host declarations |
| Compose nodes from two revisions | Explicit preparation or diagnostic; no ambient environment merge |
| Real `x`, then positive assumption in a simplification context | Static type remains real; fact-dependent simplification is confined to that context |
| Parameter used by arithmetic versus parameter explicitly typed as a list | Mapping and whole-list behavior settled before evaluation; use existing documented witnesses |
| Failed overload candidate followed by a valid candidate | No constraints leak from the failed candidate |
| Closure captures a mutable local; two calls have distinct locals | Correct capture and isolation with stable static bindings |
| Explicitly typed recursive pair | Correct evaluation; no runtime re-inference; unresolved unannotated case has an explicit disposition |
| Program forward function call versus forward variable read | Approved Program distinction retained, including errors through calls where required |
| Program contains one invalid statement and a valid sibling | Per-statement diagnostic; valid sibling still executes |
| Stored body compiled with declared inputs | Compiled result agrees with interpreter for declared input types; unsupported targets decline |
| Existing documented macro capture and binder examples | Capture rules preserved; unsupported prototype cases named, not approximated |

Phase 0 selects exact existing macro, mapping, recursion and Program witnesses
and records test paths. Do not invent exotic examples to expand the slice.

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

### Phase 1 — smallest stable preparation prototype

Owner: one CE implementation session in an isolated worktree. Start after the
phase 0 contract review. Cover arithmetic, declarations, a function, a forward
reference, and value versus definition updates. Reuse existing arithmetic and
evaluation; no miniature replacement evaluator that omits the real costs.

Publish prepared static types and direct binding identities. Prototype frame
slots only if needed; replacing all activation machinery is not a prerequisite.
Outside the selected subset, return an explicit unsupported result. Do not
silently fall back to the live binding path and count it as prototype success.

Deliver a patch and a mechanism ledger: removed, bypassed, still required,
newly added. Include temporary scaffolding in counts. A side path with no
demonstration that the old obligations can go is not sufficient.

Gate: selected fixtures pass; static reads after preparation perform no unit
lookup, read-token validation or dependency propagation; runtime value updates
do not invoke static analysis. Verify these with diagnostic counters separately
from timing. Independently measure production-equivalent builds against phase 0.
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

Deliver CE and Tycho patches together, actual deleted methods and callers,
replacement code, equivalent results, source diagnostics, and timings. Keep
Desmos import and rendering policies in Tycho. If the path requires an
unapproved change to macro or dynamic-scope behavior, report it as a product
decision rather than quietly moving that policy into CE.

Gate: real Tycho code is removed; no duplicate fallback path masks missing
semantics; combined source complexity falls; boxing/preparation and runtime
meet the predeclared margins. Report each regression separately rather than
hiding it in an aggregate score. No production adoption yet.

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
Choose concrete witnesses for the fixture rows. Establish baseline variability
and propose acceptance margins before any candidate result exists. Do not
commit, release, or start phase 1. Report blockers without bypassing the lock.

### Brief B: phase 1

Read AGENTS.md, BUILD.md, architecture/model documents, this plan and the accepted
phase 0 report. Implement only the agreed phase 1 subset in an isolated worktree.
Use existing arithmetic/evaluation semantics. Keep assumptions out of static
types. Return explicit unsupported results outside scope. Demonstrate absence
of contextual binding/type tracking after preparation with diagnostic counters.
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
Report observed versus inferred findings, exact source identities and commands,
exit codes and limitations. Follow required code review/validation rules before
integration; this measurement review does not replace them.

### Brief D: phase 2, for a Tycho implementation session

Read Tycho's instructions, this plan, accepted phase 1 evidence and the deletion
inventory. First identify one corpus-backed preparation path and the methods
that can actually be deleted. Coordinate any missing CE contract with the
coordinator before extending scope. Implement the deletion and run assigned
Tycho gates against the exact candidate package. Report combined replacement
cost, behavior differences and performance. Keep import/rendering policy in
Tycho. Do not publish, commit, or adopt a new npm version as part of the probe.

Every phase report contains: scope and full source identities; patch and raw
artifact paths; exact executed commands and exit codes; correctness results;
intentional behavior changes; per-workload timings and uncertainty; allocation
and retention; code/mechanism accounting; checks not run; and a recommended
continue/revise/stop decision. Record defects in issues, not as a handoff queue.
Retain reports and raw evidence through review, then clean experimental worktrees
and temporary files once their needed artifacts are preserved.
