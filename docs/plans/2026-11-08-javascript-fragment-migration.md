# JavaScript fragment migration proposal

**Status:** draft for review, 2026-11-08. No implementation authorized by this
document. Complements step 7 of the
[compiler target plan](2026-11-08-compile-targets-implementation-plan.md);
does not change its approved sequence or add work to ROADMAP.

**Agreed direction, 2026-11-08:** distinguish target, compilation profile,
and execution requirements; separate concurrency requirements from preferences;
make numeric-kernel parity the first migration milestone. API spelling and
the detailed profile definitions remain to be specified.

## Recommendation

Introduce an opt-in `javascript-fragment` target alongside `javascript`.
Start with a small subset of a numeric-kernel profile and the existing JS emitter.
Then make the annotation authoritative for that fragment, and replace
emission in bounded pieces. Keep the traditional target as the default until
coverage, contracts, and performance have been measured against it.
Migrate individual numeric consumers after parity for their profile and
execution requirements, without waiting for general-program parity.

Do not make a CPS or whole-compiler SSA conversion a prerequisite. For the
first independent emitter, use a small structured representation with explicit
temporaries, conversions, and evaluation regions. Add SSA value identities,
branch results, and loop-carried values when the pilot includes mutation and
loops. This can be structured SSA: it does not require flattening the program
into a general control-flow graph.

There are two separable benefits to demonstrate:

1. The fragment pass makes admission predictable and removes repeated type
   and representation decisions from emission.
2. A lower representation makes evaluation order explicit and enables simpler
   emission and shared optimizations.

The first does not require the second. A successful admission experiment is
not, by itself, evidence that a new optimizer will pay for its cost.

## What exists today

[fragment.ts](../../src/compute-engine/compilation/fragment.ts) is a typed
front end over prepared boxed expressions. It stores facts beside the tree,
keyed by expression and lexical scope. Facts distinguish semantic type from
target representation and record operand conversions. A target supplies a
`FragmentDefinition`, including admission rules, representation choices,
symbol types, and prepared user functions.

It is not yet an instruction IR. It has no independent value identity for
each assignment, explicit merge values, or complete effect model. The
[GLSL annotation design, section 8](2026-11-08-glsl-fragment-annotation-design.md)
already identifies these missing pieces and proposes a typed structured
representation as the later direction.

The implementation also has a deliberately narrow vocabulary. Values include
real, integer, boolean, complex, point, and color; lists have a restricted
element vocabulary; function parameter types are restricted. Shared walkers
include policies useful for the GLSL fragment: `walkTuple` limits point size
to 2–4, `walkList` handles reals or points, and `walkElement` requires a static
count for `Length` and `Last`. A target-independent module name does not make
every rule appropriate for JavaScript.

[JavaScriptTarget](../../src/compute-engine/compilation/javascript-target.ts)
already separates `prepareCompilation()` from `compileToTarget()` inside
`compileOrThrow()`. That is a useful insertion point, although preparation
and other orchestration methods are private. It also owns runtime assembly,
references, batch compilation, and worker-pool/asynchronous copies. Moving
the arithmetic emitter alone does not migrate all of these routes.

[javascript-statements.ts](../../src/compute-engine/compilation/javascript-statements.ts)
already turns registered expression wrappers into structured statements at
suitable positions. Its `Exit` callbacks are a local code-generation
technique, not a CPS representation of the whole program. Replacing the
source-string registry with explicit structure is a concrete early use for
the proposed representation.

These observations refer to the working tree during the ongoing GLSL work;
the initial inventory must be refreshed when that work lands.

## Scope and compatibility

### Profiles and execution requirements

Keep three dimensions separate:

| Dimension | Meaning | Examples |
| --- | --- | --- |
| Target | The execution backend | JavaScript, GLSL |
| Profile | The admitted subset of language semantics | `numeric-kernel`, `program` |
| Execution requirements | Properties the compiled result must satisfy | Independent calls, worker portability, internal parallelism |

The numeric-kernel profile serves plotting cells, integration, solvers, and
numeric `Map` callbacks. Its eventual scope includes numeric operations,
selected collections, conditionals, bounded iteration, and calls to admitted
functions. The program profile adds the broader collections, strings,
dictionaries, functions, and statements needed by Epsil preludes and notebooks.
Not every `Map` callback is numeric: select a profile from the consumer's
contract, not merely the name of the operation invoking it.

A profile describes semantics, not source syntax. An Epsil function with
local assignments and a loop can be a numeric kernel. A short arithmetic
expression calling a stateful host function may fail an independent-calls
requirement. Admission checks operator signatures, operand types, bindings,
conversions, and relevant effects; it is not an operator whitelist. Check
reachable user-function bodies and captures, or the established contract of
a host function, rather than accepting calls by name alone.

Start with two named profiles, composed from shared rules internally. Defer
arbitrary caller-defined operator lists. A target implements the portion of
a profile it can represent: JS numeric lists need not inherit GLSL size and
storage restrictions. Unsupported target/profile combinations decline
explicitly. Profile selection does not imply purity, worker portability,
or support for every numeric mode.

Concurrency has three distinct meanings:

- **Independent invocations:** different cells or samples can be evaluated
  concurrently. Invocation-local mutation can be allowed; shared mutable
  captures and stateful host calls require analysis or an explicit contract.
- **Worker portability:** code, dependencies, and captured values can execute
  in another worker. Purity alone does not establish portability: a pure host
  closure may still be unavailable there.
- **Internal parallelism:** iterations within one invocation can execute in
  parallel. This additionally requires dependency and reduction analysis,
  with numerical-ordering rules. Specify whether a requirement concerns a
  particular loop or the existence of an eligible parallel region.

Pass required properties to both `canCompile()` and `compile()`. A requirement
affects admission; a preference affects planning and permits a sequential
route. The compiler must establish a requirement or decline conservatively;
intent is not evidence that the property holds. Unknown host calls remain
barriers unless their contract supplies the necessary facts.

For example, a request might select `profile: 'numeric-kernel'` and require
`independentCalls` and `workerPortable`, while merely preferring worker
execution. These names illustrate the design and are not an implemented API.
Specify any assumptions on input sharing and capture ownership alongside the
capability. Worker availability, runtime data transfer, input size, and
scheduling determine the actual route at execution time; compile-time
eligibility cannot promise actual parallel execution.

Diagnostics should distinguish an unsupported profile operation from a failed
execution requirement, naming the offending node or dependency. For example:
numeric vocabulary accepted, worker portability rejected because a called
function captures a host closure. Report established capabilities separately
from preferences and runtime routing. Profile and requirement options belong
in any admission/compilation cache key and in the result's compilation
provenance; changing them must not reuse an incompatible success.

### Keep target identity separate from emitted language

Use `javascript-fragment` as the experimental registry key. Its generated
language remains JavaScript. Existing helpers branch on
`target.language === 'javascript'`; changing that field to the experimental
name would bypass JS behavior. The target registry already supports custom
names through `registerCompilationTarget()`.

Initially make the target an explicit import and registration, keeping it
out of the default engine imports. Before public exposure, specify the
result's target identity and TypeScript result mapping: an arbitrary registry
name must still expose the JS runtime capabilities correctly. Audit target
name comparisons in the compile entry, runtime loading, diagnostics, caches,
and source restoration; do not assume registering the name is sufficient.

Leave implicit compilation by `Map`, integration, solvers, and other engine
services on `javascript` until each consumer passes the numeric-kernel
migration gate for its actual requirements. Broad callbacks and programs
remain on the traditional route until their profile is covered. Treat `interval-js` as
a separate target with an enclosure contract, not as another JS mode to
migrate automatically.

### Make partial coverage visible

The experimental target declines outside its advertised fragment. It must
not silently call the traditional compiler and report experimental success.
Use the existing interpreter fallback contract when the caller requests it;
record a decline even when fallback produces a value. During comparison,
disable fallback or inspect success explicitly.

Whole-compilation routing is the initial boundary. Mixing a new emitter and
arbitrary legacy subtrees would need a second contract for effects, names,
representations, and helper dependencies. Defer that bridge. Reusing the
entire legacy emitter for an admitted program is different: it is an explicit
transitional stage, with no claim that the new emitter generated the result.

### Define parity in several dimensions

Apply these criteria first to the numeric-kernel profile and selected
consumers, then to the program profile and global default. Numeric-kernel
parity is a useful deliverable in its own right.

| Dimension | Requirement before replacing the default |
| --- | --- |
| Values and effects | Same documented behavior for valid typed inputs, including result shape, operand order, laziness, and absence discharge |
| Coverage | No unexplained loss on the agreed real workload and supported public surface; intentional declines are listed and approved |
| Public API | Compile options, diagnostics, references, calling conventions, runtime helpers, stored source, batch and asynchronous routes accounted for |
| Cost | Compile latency, generated size, execution time, and allocations measured on the same workloads |
| Maintainability | Migrated decisions have one authority; adapters and legacy handlers have identified removal points |

Source text need not be identical after new emission starts. Exact output
tests remain useful, but changed snapshots are counted and explained rather
than treated as semantic failures or updated to conceal them.

The [compilation model](../COMPILATION-MODEL.md) remains normative: shape
comes from static types and literal structure, not control-flow refinement.
SSA must not turn an unsettled-shape decline into path-sensitive shape
inference. Declared unions retain dispatch at their binding. Preserve strict,
complex, and bigint mode contracts, including bigint's non-finite escape.

## Work needed for a JavaScript fragment

**Preparation and lifetime.** Expose a narrow internal prepared-compilation
boundary rather than copying `compileOrThrow()`. Annotation and emission must
consume the same prepared root and function variants. Audit rewrites and
specializations currently performed during emission: move them earlier,
annotate their products, or use a checked preservation rule. A bare call to
`typeFragment(originalExpr)` followed by `JavaScriptTarget.compile()` would
not establish this invariant.

**JS types and representations.** Start with the existing numeric vocabulary.
Give integers the `number` representation in strict mode and a separate
bigint representation only in bigint mode. Keep complex values, points,
lists, and colors distinct even where their host containers overlap. Reuse
the current runtime ABI, including complex result normalization, rather than
inventing a new representation during the migration.

Extend the common vocabulary only when migrating a feature that needs it:
dynamic-length and nested lists, tuples beyond numeric points, strings and
characters, dictionaries, function values, and supported value kinds. A list
can have a known representation and unknown length; dynamic length alone
must not imply unsettled shape. Absence is a representation/operation concern
under the existing contract, not a new declared input type.

**Rules versus machinery.** Share lexical binding, annotation storage,
diagnostic structure, and genuinely common signature matching. Move GPU-only
limits out of reusable walkers or supply a JS rule for the affected form.
Avoid a growing set of `if (javascript)` branches in the generic walk. Keep
the GLSL accepted fragment unchanged when generalizing the machinery.

**Functions and modes.** Preserve specialization by argument shape, declared
result constraints, captures, defaults, callbacks, recursion where supported,
and caller mappings through `vars` and `functions`. The current fragment's
function model is not enough to promise parity for all JS functions. Unknown
host calls are effect barriers unless their established contract proves more.
Each admitted compile mode needs its own representation/conversion rules.

**One source of facts.** A gate in front of the old emitter is only stage one.
Next, derive legacy local shape frames from the annotation and replace
individual emitter queries with annotated facts. A migrated query must not
fall back to recomputing its answer when a fact is missing; that is an
invariant failure. Track and remove duplicate readers as each slice moves.

**Admission and emission agreement.** `canCompile()` must use the same
preparation, options, binding environment, and capability checks as compile.
The current generic entry explicitly permits only GLSL before delegating to
its predicate, and its unsupported-target message names GLSL only. Extend
that guard, contract, and message when the new
target is exposed. For an admitted program within the same resource limits,
an emitter capability refusal is a mismatch to fix, not a hidden fallback.

## CPS, ANF, and SSA

These solve different problems. CPS makes the continuation explicit: each
computation describes what happens next. ANF (administrative normal form)
names intermediate computations so evaluation order is visible. SSA gives
each computed value one definition, with explicit values at control-flow
joins. ANF-style sequencing and structured SSA can be used together.

| Choice | Fit here | Main cost |
| --- | --- | --- |
| Annotated boxed tree | Immediate admission and representation work | Assignment versions and effects remain implicit |
| Structured operations with explicit temporaries | Direct JS/GLSL emission, ordered operands, explicit conversions and lazy regions | Needs a lowering contract and verifier |
| Structured SSA | Local propagation, branch results, loop-carried values, reliable use tracking | Must represent mutation, captures, exits, and effects correctly |
| Flat CFG SSA | General control-flow optimizations | Requires reconstructing structured source; unnecessary for the first pilot |
| Full CPS | Useful if explicit continuations, suspension, or control transformations become a primary requirement | Continuation conversion and later structured-source recovery enlarge the migration |

The classic [ANF paper](https://www.cs.tufts.edu/comp/150FP/archive/cormac-flanagan/anormal.pdf)
shows how ANF can capture important compilation benefits associated with CPS.
[MLIR structured control flow](https://mlir.llvm.org/docs/Dialects/SCFDialect/)
provides a concrete example of SSA results and loop-carried values inside
structured operations. These are design references, not proposed dependencies.

**Recommended order:** fragment annotation first; structured operations for
the first independent emitter; SSA results and loop-carried values as that
emitter gains control flow. Do not build two disposable full IRs, first ANF
and then SSA. Give the small representation stable value IDs from the start,
and extend its structured region semantics as needed.

An SSA value does not make an array immutable. Keep reads, writes, allocation,
and potentially throwing or unknown calls explicit. Initially prohibit
optimization across these barriers. Defer memory SSA, alias analysis, global
code motion, and general control-flow optimization until a measured workload
justifies them. Existing `runAsync()` support is not, by itself, a reason to
convert all compilation to CPS.

### Minimum useful structured representation

The first version needs typed values, explicit conversion operations, ordered
blocks, `If` regions, and a way for a region to yield its result. Add loop
parameters/results, assignment versions, function calls, and explicit
`Return`/`Break`/`Continue` destinations with the corresponding feature slice.
Keep source-expression origins for diagnostics.

For example, the conceptual lowering of `If(c, f(x), g(x)) + h(x)` evaluates
`c`, runs exactly one branch, yields its result, then evaluates `h(x)` and
adds. Putting both branch calls in a single operand prelude is incorrect.
Likewise, a loop accumulator has an initial value, a value carried into each
iteration, and a next value; it cannot be represented by facts about the
symbol name alone. These are schematic sequencing examples, not new syntax.

The verifier checks value definitions and uses, region visibility, result and
conversion types, branch/loop yields, and exit destinations. Analysis caches
belong to an IR revision. Rewrites invalidate analyses unless preservation is
explicit. Reuse the semantics of existing lazy operand/CSE regions when
lowering; do not maintain an independent conflicting laziness table.

Keep numerical policy separate from representation. Even a pure operation
may be unsafe to speculate, and an algebraic rewrite may be invalid for a
particular numeric mode. An initial optimization should be region-local and
use an explicit legality rule; no general reassociation or cross-branch
hoisting is required for the pilot.

## Progressive implementation and gates

| Stage | Deliverable | Exit evidence |
| --- | --- | --- |
| 0. Inventory and baseline | Profile/feature/mode/API matrix, consumer execution requirements, representative corpus, legacy measurements | Every supported route is classified; profile definitions, initial scope and comparison thresholds agreed |
| 1. Opt-in admission | `javascript-fragment`, JS definition, shared prepared boundary, legacy emission | Positive/negative admission tests; accepted cases compile; legacy outputs unchanged by plumbing |
| 2. Authoritative facts | Annotation feeds selected binding, representation, and conversion readers | Duplicate decisions removed for that slice; legacy/new values and effects agree |
| 3. Independent scalar emitter | Small structured IR, verifier, direct JS emission for numeric expressions and conditionals | Same fragment through two emitters; lazy evaluation and ordering tests pass; cost comparison |
| 4. Functions and loops | Explicit call/return regions, same-shape mutation, SSA joins and loop-carried values | Captures, shadowing, early exits, budgets, and effect traces agree |
| 5a. Numeric-kernel parity | Remaining numeric operations, modes, collections, and execution requirements needed by selected consumers | Per-consumer coverage, effects, API and performance gates pass; numeric consumers can migrate independently |
| 5b. Program coverage | Broader collections, strings, dictionaries, functions, remaining public options and execution routes | Each slice closes its profile-matrix rows; shared changes leave GLSL behavior intact |
| 6. Replacement decision | Full parity report, remaining intentional declines, removal plan | User approves changing the default and eventual legacy retirement |

Stages are independently reviewable changes, not promises of one session
each. Stage 1 is a bounded compiler integration task; stages 3–5 amount to a
substantial compiler migration. A calendar estimate before the coverage
inventory would hide most of the cost in functions, collections, and runtime
integration.

Start stage 1 with strict real/integer/boolean expressions, arithmetic,
comparisons, scalar conditionals, and explicitly selected numeric intrinsics.
Leave non-admitted modes, host overrides, collections, functions, and statement
forms as explicit declines until their slices arrive. Select enough actual
workload examples to make this pilot useful; an all-constant test set proves
little because preparation may fold it away.
This initial subset is not the final definition of the numeric-kernel
profile. Record missing profile capabilities explicitly; do not declare
profile parity by narrowing the profile to what the pilot happens to emit.

Run the first independent emitter behind an internal switch within the
experimental target. Do not introduce another public target for every stage.
For supported programs, both emission routes use the same annotation. In
stage 3 the legacy route is a development oracle, not automatic recovery from
an emitter failure.

Before expanding the IR, try one small transformation on both JS and GLSL
and measure it—for example, reuse of a repeated pure arithmetic value inside
one evaluation region. Existing CSE may already handle the example; the
experiment must show whether the new form removes machinery or improves an
actual workload. This is a proposed extension of the step-7 experiment, not
an instruction to begin it during the current GLSL implementation.

At replacement time, preserve a temporary explicit legacy target or rollback
switch for a defined release window. Changing the default, deprecating the
experimental name, and deleting the old emitter are separate decisions.
Moving numeric consumers at stage 5a does not change the global default or
the target used by general notebook programs.
Any continued legacy-only capability must be acknowledged in that decision;
it cannot be called full parity.

## Validation and measurements

Compare interpreter, traditional JS, and experimental JS on declared, valid
inputs. Use the compilation model to classify permitted differences rather
than requiring raw equality everywhere. Treat wrong finite values and wrong
shapes as failures. The old compiler is useful evidence, not the definition
of correctness.

For each feature slice, include nonconstant inputs; folding and CSE enabled
and disabled; both branch outcomes; empty and nonempty loops/collections;
scope shadowing; and repeated compilation with different options. Add effect
traces for host calls and mutation so value equality cannot hide duplicated,
dropped, reordered, or eagerly executed work. Include absence producers and
discharges when the slice admits them. Test declared unions at their binding,
not as arbitrary runtime shape checks throughout the body.

Test profile admission separately from execution requirements. Include a
kernel with local mutation, a stateful host call rejected for independent
invocations, and a pure but nonportable host dependency. Check transitive
calls and captures. A failed requirement must fail compilation even when
sequential code could be emitted. A parallel preference may retain that
sequential route. Test runtime routing separately with unavailable workers
and inputs below the scheduling threshold; neither makes static eligibility
false. Compare the admitted profile/requirement combinations across
`canCompile()` and `compile()` under the same binding environment.

Maintain separate counts for accepted-and-correct cases, capability declines,
correctness declines, emitter mismatches, and interpreter fallbacks. Measure
these counts by profile and execution requirements, so general-program
declines do not hide progress or regressions for numeric consumers. Measure
preparation, annotation, lowering, emission, total compilation, and warm
execution separately. Also record source bytes, helper bytes, allocations,
and bundle impact. Use the same machine and inputs and report variance;
set tolerances before the replacement decision. Small scalar expressions
need a compile-latency check as well as large loops.

During implementation, follow BUILD.md and the shared-box checks for each
changed slice. Shared fragment changes also need focused GLSL tests; runtime
and package changes need their corresponding integration checks. Update
public guides when experimental behavior is exposed. A design draft alone
does not require compiler tests or generated API documentation.

## Decisions proposed for review

The profile and execution-requirement direction above is agreed. The
implementation choices below remain the proposed migration plan.

1. **Separate opt-in target**, rather than adding a fragment gate to existing
   `javascript`. This protects current coverage while enabling honest
   comparisons. Cost: temporary maintenance of two routes.
2. **Legacy emission first**, rather than immediately duplicating the JS
   compiler. This tests admission and fact ownership before code generation
   changes. Cost: it is transitional and produces no automatic runtime gain.
3. **Structured operations and incremental SSA**, rather than CPS or flat CFG
   SSA first. This fits structured source output and the approved GLSL
   direction. Cost: advanced control-flow optimizations remain deferred.
4. **Explicit declines during migration**, rather than hidden legacy subtree
   fallback. This makes coverage and failures measurable. Cost: hosts opting
   in see less compiled coverage until the relevant slices land.
5. **Reuse the JS runtime ABI**, rather than changing value representations
   at the same time. This bounds migration risk. Cost: representation-driven
   allocation improvements may require a later, separate change.

The first implementation commitment should be stages 0–2, followed by a
review of their measured result and a concrete stage-3 IR specification.
Completion of the GLSL work remains the prerequisite for deciding how much
of the new representation should be shared across targets.
