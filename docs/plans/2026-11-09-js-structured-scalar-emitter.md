# A structured scalar emitter for JavaScript

**Status: approved 2026-11-09, with effect handling required from the outset.
No implementation in this change.**

**Revision, approved 2026-11-09.** The
[status and plan document](2026-11-09-js-compiler-status-and-plan.md), steps 1
to 4, replaces four parts of this design. The first vocabulary is the one
that the `heatwall` and `heatcell` fixture needs (comparisons, `And`, `Or`,
`Multiply`, `Min`, `Max`, one local with one assignment, one resolved helper
call), not only `Add`, `Negate` and `If`. The annotation is built before
emission by a rule that does not call `isComplexValued()`. The measure names
its baselines and says what an inconclusive result means. The verifier accepts
one effectful operation kind that exists only for tests. The same approval is
the step 7 decision of the compile-targets plan for this pilot. The rest of
this design applies as written.

## Recommendation and decision boundary

Build a small independent JS body emitter behind the existing internal scalar
fragment target. Give values identities, make conversions operations, and
represent lazy branches as nested regions. Retain the existing emitter as the
default and comparison route. Do not introduce CPS or a whole-program SSA
conversion first.

This is the stage 3 specification anticipated by the
[JS migration plan](2026-11-08-javascript-fragment-migration.md), rather than a
claim that the preceding slices have established general JS parity. The
[compile-targets plan](2026-11-08-compile-targets-implementation-plan.md), step 7,
still requires updated compiler counts and a user decision before building a
wider representation. Review this proposal alongside those measurements; this
document does not bypass that gate.

The proposed pilot answers one question: can a small typed scalar vocabulary
be emitted with explicit evaluation structure, without invoking the generic
compiler walk again, while preserving values and the existing runtime contract?
It does not establish numeric-kernel profile parity, program profile parity,
worker safety, or readiness to replace the public JavaScript target.

## Starting point

Source observations here use committed baseline `d43d68f25`; ongoing GLSL edits
must be rechecked before implementation. The internal JS slices cover
[scalar roots](2026-11-09-js-fragment-slice.md),
[bindings](2026-11-09-js-fragment-bindings.md),
[calls](2026-11-09-js-fragment-calls.md),
[captures](2026-11-09-js-fragment-captures.md),
[callback composition](2026-11-09-js-fragment-callback.md), and
[authoritative call facts](2026-11-09-js-fragment-call-facts.md).
These establish bounded annotation-backed paths; they still use legacy emission.
Upstream classification also remains. Removing selected readers from emission
is not the same as removing their cost from compilation.

The GLSL path has a useful preparation boundary: `GpuPreparedRoot` owns the
rewritten expression and its compilation policy, and annotation and emission
refer to that exact prepared tree. Its emitter still delegates to
`BaseCompiler.compileCseRoot` or `compileFunctionBody`. It is not already the
independent structured emitter proposed here.

The reusable direction is described in the
[GLSL design, section 8](2026-11-08-glsl-fragment-annotation-design.md): identities,
explicit conversions, evaluation regions, revision ownership, and verification.
GPU-specific representations, shader bindings, NaN handling and loop budgets
should not become generic IR policy.

## First vocabulary

Admit prepared scalar roots with numeric and boolean literals, explicitly typed
scalar free inputs, `Add`, `Negate`, and three-operand `If`. Support number,
boolean and complex representations in the existing strict and complex modes.
Use the existing admission rules to determine which combinations are valid;
the pilot does not broaden them. Complex arithmetic is included because it
makes representation conversion a real test rather than a placeholder.

Defer `Sqrt`, despite its presence in the existing internal route: its domain,
promotion and helper policy add a separate obligation. Also defer function
values and definitions, local assignment, helper calls, captures, loops,
collections, random operations, host-provided code, union dispatch, batching
and workers. Existing routes retain their capabilities.

Initially compare both emitters with `cse: false` and `constantFold: false`.
Reject unsupported options explicitly before emitting; never silently ignore
them. Keep an additional legacy-default benchmark if useful, labelled as a
different optimization configuration. Unsupported pilot input declines. Failure
inside a selected pilot compilation must not silently fall back to legacy
subtree emission. A caller can select the ordinary route before compilation.

For example, with `C: boolean`, `x,y: real` and `z: complex`, the prepared
expression `If(C, x, z) + y` requires a real-to-complex conversion of `x` inside
the selected then branch, and a conversion of `y` before complex addition.
The order follows the prepared expression, without reassociating operands.
This is an illustrative lowering obligation, not a newly measured result.

## Pipeline and ownership

The proposed sequence is:

1. Existing binding, preparation, admission and numeric-policy selection.
2. One prepared root and scoped annotation, owned by a compilation revision.
3. Lowering to ordered operations and nested regions.
4. Structural verification.
5. JS body emission and existing runtime/result assembly.

The comparison harness must give both emitters the **same annotation object**,
with separate mutable name allocators and emission state. Today annotation is
materialized lazily through `enterScalarFragment`. Factor that materialization
into an explicit internal preparation seam, under the same mode and folding
context. Do not run the generic emitter merely to populate the annotation.

Lowering consumes admitted types, selected representations, conversion edges
and binding identities. Missing facts or an ownership mismatch fail explicitly;
emission does not recover by analyzing the original expression. Retain source
origins for diagnostics, but prohibit emitter calls to expression type readers,
`evaluate()`, engine symbol lookup, or generic classification and compilation.

The pilot lowers **after representation selection**. The longer-term GLSL design
allows shared mathematical rewrites before representation selection; this pilot
does not implement that earlier, target-independent IR. Moving operations to
that phase would be a separate design decision.

## Representation and verifier

Use a small internal representation, initially owned by the JS experiment:

| Element | Meaning |
| --- | --- |
| Program | Revision owner, input bindings, numeric policy, root region and diagnostic origins |
| Value | Unique ID within that revision, admitted semantic type and concrete representation |
| Region | Ordered operations ending in one yield; enclosing values are visible inside |
| Literal | Frozen payload encoded using the existing numeric/literal policy |
| ReadInput | Read of a particular binding at this position |
| Add / Negate | Operations on already selected representations |
| Convert | Explicit non-identity conversion, initially real-to-complex |
| If | Boolean condition, two regions, one result from the selected region's yield |

Identity conversions need no instruction. Inputs and temporaries use identities,
not source names as identity. A boxed node reused at two occurrences does not
license evaluating it once: initial lowering emits each occurrence independently.
Do not hoist or deduplicate input reads or operations across regions.

The verifier checks unique definitions, definition-before-use, enclosing-region
visibility, matching owner/revision, admitted operation signatures and arities,
legal conversions, boolean conditions, equal branch result representations, and
one terminal yield per region. A child or sibling value cannot escape except
through the enclosing `If` result. Source origins must belong to the prepared
artifact. Reject operations and policies outside the pilot vocabulary.

These are single-definition values with structured joins: an SSA-like form
without a general control-flow graph or phi-placement pass. Mutable locals and
loop-carried values need a later extension. CPS would add continuation machinery
without serving the first vocabulary; reconsider it for a concrete suspension or
control-transfer requirement, not as a prerequisite for concurrency.

A verifier establishes structural consistency, not semantic correctness of
lowering. Tests must establish lazy evaluation and value preservation. Future
rewrites create a new revision and invalidate analyses unless preservation is
explicitly justified. The pilot adds no optimization passes.

## Effects are part of the prepared contract

The approval requires effect handling from the start, even though the initial
production vocabulary excludes caller code and performs no CSE. CE-1188
(`issues/CE-1188.md` at the baseline commit) demonstrates the failure mode:
GLSL omitted `isPureOverriddenOperator` from its CSE options, so a caller's
`pure: true` function declaration was lost before admission and emission.
The [CE-1176 binding plan](2026-11-09-ce1176-caller-code-binding.md) supplies the
complementary rule for non-pure code: once per occurrence, in interpreter order,
inside the branch or iteration that evaluates it.

Preparation must record target-aware effect facts alongside types and
representations. The minimum distinction is proven pure versus effectful or
unknown; unknown is never permission to reorder. Derive the facts from the
resolved definitions and existing target purity contract, including caller
function declarations and overrides. A pure arithmetic operator does not make
an expression with effectful operands pure. Do not infer purity from emitted
source, an operator name, a temporary, or the boxed node's identity alone.
Freeze these facts with the binding snapshot and compilation revision; both
emitters and admission must consume the same policy.

Each operation records its own effect classification; each region summarizes
the effects it can evaluate. Keep occurrence origins for effectful operations.
An operation on already evaluated SSA values can be pure while the operations
that produced those values remain ordered and effectful. Sharing the arithmetic
operation must never silently eliminate either producer evaluation.

For later transformations, proven-pure operations are eligible for CSE and
reordering subject to dependencies, numerical policy and the right to evaluate
at the destination. Purity alone is not permission to speculate a possibly
throwing operation out of a lazy branch. Effectful and unknown operations may
not be merged, duplicated, dropped or reordered; they execute once per reached
occurrence. Binding their result to a temporary permits reuse of that result,
not reuse of the evaluation at another occurrence. Branch and iteration
boundaries preserve conditional execution and evaluation count.

The first pilot still emits occurrences in order, including pure ones. Carrying
facts now avoids reconstructing an effect model when optimizations or calls are
added. The verifier requires effect facts and checks region summaries against
contained operations; it cannot prove that an external purity declaration is
truthful. The host's declaration has the meaning of the existing contract.
No memory SSA or effect-token chain is needed while ordered regions supply the
sequencing; revisit that choice before allowing transforms to discard that order.

Add validation of effect propagation and its negative controls: identical
synthetic effectful occurrences remain distinct and ordered; an untaken branch
has no trace; pure arithmetic around two effectful producers preserves both
producer traces; unknown effects receive the same protection. Check that a
trusted pure declaration survives preparation and that removing it changes the
classification. Until caller functions enter the production vocabulary, use
internal fixtures for those cases and keep public admission unchanged. When CSE
or reordering is introduced, require paired pure/non-pure transformation tests,
including the CE-1188 declaration case and the CE-1176 shared-node case.

## Integration with existing JavaScript compilation

There is a real integration task before emission can be swapped.
`JavaScriptTarget.prepareCompilation` is protected, but `compileOrThrow` is
private and `compileToTarget` is module-local. The latter combines body emission,
helper/preamble collection, entry plans and runner/result construction.

Extract a narrow internal body-emission seam. The structured emitter returns
ordered statements, a final value and the dependencies needed by assembly.
Reuse the existing runner, input normalization, name allocation, runtime version,
free-symbol/reference metadata and result construction. Do not copy this
subsystem into a second target implementation.

Keep the existing JS number and complex-object runtime conventions.
`CompilationResult.code` must remain a usable expression: where necessary,
assembly can wrap the already structured body in one outer IIFE, while a runner
can consume its statement form directly. Do not convert each operation into a
source-string entry in `javascriptStatements` and then rediscover its structure.

Pure numeric helpers and literal serialization may be reused. Emitting a pilot
operation through `BaseCompiler.compile`, `compileCseRoot`,
`compileFunctionBody`, or the generic callback machinery defeats the experiment.
Likewise, returning correct `run()` values while bypassing metadata or breaking
stored-code reconstruction is not success.

Do not add a public target name, profile or concurrency option for this pilot.
The numeric-kernel/program distinction remains an admission contract; internal
consumers such as `Map` need a calling contract, not a third vocabulary profile.
Concurrency suitability remains a separate execution requirement. Buddhabrot
and prelude programs motivate later work on effects and state; this arithmetic
pilot does not prove those properties.

## Relationship to GLSL

Share concepts first: value and binding identities, ordered regions, conversions,
origin tracking and verifier invariants. Extract shared implementation only when
both targets have a demonstrated use. Do not import `GPUShaderTarget`,
`GpuPreparedRoot`, shader representation names, GPU scopes or emission helpers
into the JS representation.

Keep numerical policy explicit. JS number arithmetic and complex objects differ
from GLSL float/vector arithmetic and its integer distinctions. Shader resources,
absence handling, fast-math restrictions, and loop-exhaustion policy also differ
from JS bindings and runtime assembly. Random evaluation is outside this pilot.
No GLSL emitter conversion or interval lowering is included. Interval enclosure
requires its own correctness argument, as the existing step 7 gate states.

## Evidence required before extension

Run differential cases against the existing emitter and interpreter, using
independent expected values where practical. Cover real and mixed complex
arithmetic, both arms of nested `If`, branch-local conversion, repeated operands
across regions, supported special literals and signed zero under the documented
[compiled-code contract](../COMPILATION-MODEL.md). Test incompatible shapes,
unknown inputs and unsupported options as explicit declines. Separate intended
exclusions from unexpected declines and failures in the results.

Check evaluation traces as well as answers. A test-only observer or throwing
synthetic operation can expose eager branches and reordered reads without adding
production host calls to the vocabulary. Verify that this instrument detects an
intentionally eager control implementation. Pure arithmetic answers alone cannot
prove laziness. Preserve the existing entry-normalization contract; do not infer
new guarantees about hostile getters from these tests.

Poison legacy compiler readers during selected emission, with a control showing
that the legacy path reaches those readers. Test emitted code with its preamble,
`run()`, and supported reconstruction paths. Test verifier rejection using
malformed regions, cross-revision values and invalid conversion edges.

Measure preparation, annotation, lowering, verification, emission, assembly and
total compilation separately. Report cold and warm compilation separately from
warm execution; include emitted bytes plus helpers, operation counts, and added
or removed source and duplicated handlers. Count dependencies on legacy emission
explicitly. Keeping the old emitter means total source may initially increase;
report that cost rather than implying immediate deletion.

Use a focused paired source harness, following the
[benchmark methodology](../../benchmarks/README.md), rather than timing Jest or
running the cross-system capability suite. Compare identical inputs/options on
the same revision, on a quiet box under the timing lock, with repeated batches
and absolute timings as well as ratios. Exclude noisy runs. No timings have been
collected for this proposal.

Provisional budgets for review are no reproducible regression above 10% in total
compilation or 5% in warm execution on representative fixtures. These are
proposed decision thresholds, not measurements or CI assertions. Calibrate the
harness's variability before interpreting them; inability to resolve a difference
is inconclusive. Correctness and the absence of hidden legacy fallback are hard
gates regardless of timing.

## Suggested sequence after review

1. Refresh the step 7 compiler measurements after the ongoing GLSL work lands,
   and decide whether to proceed with this pilot and its budgets.
2. Extract annotation materialization and body assembly seams, with unchanged
   default behavior and existing regression coverage.
3. Add the internal representation, verifier and bounded emitter, with explicit
   route selection and the differential tests above.
4. Measure correctness, dependencies, code growth and costs. Review whether to
   retain, revise or stop the experiment before expanding its vocabulary.

Only then consider functions, local mutation, loops, shared rewrites or broader
profile coverage. A successful pilot warrants another bounded slice; it does
not itself authorize changing the public target or moving Tycho consumers.
