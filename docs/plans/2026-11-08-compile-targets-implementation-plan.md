# Implementation plan: the GLSL fragment and the removal of WGSL

**Status:** not approved. ROADMAP entry CE-1166.

This plan turns `docs/plans/2026-11-08-glsl-fragment-spec.md` (the spec) into
steps that a session can take one at a time. Each step is one session unless
it says otherwise. A session reads the spec first, then its step here. The
spec decides what the `glsl` target accepts; this file decides the order, the
files, the checks and what "done" means. When the two disagree, the spec is
right and this file is corrected.

## Order

| Step | What | Depends on | Who |
| --- | --- | --- | --- |
| 1 | Remove the WGSL target | nothing | Compute Engine, two sessions (1a code and tests, 1b documents) |
| 2 | Design note of the annotation | nothing | Compute Engine, then the user's approval |
| 3 | `canCompile()` as a typing pass | 2 approved; easier after 1 | Compute Engine |
| 4 | The audit calls `canCompile()` and runs the whole corpus with preludes | 3 | Tycho |
| 5 | Remove the shader statement machinery | 3 and 4 | Compute Engine, one module per session |
| 6 | Tycho calls the predicate at resolve time | 3 released | Tycho |
| 7 | Measure again, then decide on a wider intermediate representation | 1, 3, 5 | Compute Engine, then the user's decision |

Steps 1 and 2 can start at once and in parallel. `issues/CE-1163.md`
(`parallel for` on the worker pool) is separate work with its own design; it
shares no file with steps 1 to 5 except `test/epsil/parallel-for.test.ts`,
which step 1a edits (the WGSL kernel cases).

Not in this plan: the cost items of emitted JavaScript and `interval-js` that
Tycho's audit report of 2026-11-08 lists (`_SYS.bcast` on scalar arithmetic,
the allocations per interval evaluation, the checked list writes of CE-1098).
Each is a reported performance problem, so each is an issue file: search
`issues/` and `issues/CLOSED.md` first, and file what is missing.

## Step 1. Remove the WGSL target

**Goal.** No WGSL code, test or documentation remains, and the emitted GLSL,
JavaScript and `interval-js` code of every corpus record is unchanged.

**1a, code and tests** (implementer; a dual review, since exported names go):

- Delete `wgsl-target.ts`, `wgsl-kernel.ts`, `wgsl-field-function.ts` and
  `wgsl-predeclared.ts` in `src/compute-engine/compilation/`.
- Remove the WGSL branches of the shared GPU modules. 55 files of that
  directory name WGSL; most of the branches are in `gpu-shader-target.ts`,
  `gpu-functions.ts` and `gpu-preambles.ts`. A member of `CompileTarget` or of
  the shader base class that only the WGSL target set or read goes too. Find
  the readers with the LSP tool (`findReferences`), not with a text search.
  `compileShader()` stays: `glsl-target.ts` implements it.
- Remove the exports and the registration: `src/compile.ts` and
  `src/compute-engine.ts` (`WGSLTarget`, the default target `'wgsl'`), the
  target list of the MCP server in `src/cli/mcp.ts`, the documentation
  comments in `src/compute-engine/index.ts` and
  `src/compute-engine/engine-compilation-targets.ts`, and the mentions in the
  eight other source files outside `compilation/` that name WGSL.
- Tests: six test files have WGSL in their name and are deleted
  (`compile-wgsl.test.ts`, `compile-wgsl-kernel.test.ts`,
  `wgsl-random-branch-statement.test.ts`, `ce-571-…`, `ce-572-…`, `ce-574-…`);
  three more name WGSL and not GLSL. About 185 test files name both targets:
  remove their WGSL cases and keep the GLSL ones. A test that checked one
  rule on both targets keeps its GLSL half; do not delete a whole test
  because one of its targets went.
- `CHANGELOG.md`, `[Unreleased]`, "Breaking changes": the `wgsl` target, the
  `WGSLTarget` export, the kernel and field-function routes.

**1b, documents** (mechanic, after 1a): the WGSL passages of
`docs/COMPILATION-MODEL.md` and of the other model documents that name it;
the Epsil pages `src/epsil/docs/mcp.md`, `operators.md` and
`control-flow.md`; the site pages in `~/dev/cortexjs.io/docs/compute-engine/`
(`13-guide-compile.md` has 55 mentions; `80-reference-arithmetic.md`,
`87-reference-functions.md`, `97-reference-strings.md`), edited directly with
no git command there, each edited page listed in the report. Not `api.md` or
`changelog.md` of the site: the build makes them.

**Checks.** The completion checks of `BUILD.md` ("Completing delegated
tasks") and of `docs/COMPUTE-ENGINE-BOX-SPECIFICS.md`; the full suite once at
the end of 1a under the box lock, because a file-name pattern does not select
every test that compiles to a shader (`BUILD.md`, "Validation frequency");
Tycho's whole-corpus codegen audit (`scripts/ce-codegen-audit.sh` in the
Tycho repo; its header documents the options) against the build of 1a,
compared with the 0.184.0 arm.

**Done when.** A case-insensitive search for `wgsl` in `src/` and `test/`
finds nothing; the type check and the full suite pass; the audit shows no
changed code hash on any target; the report names the removed line count.

**Tycho.** Tycho calls no WGSL entry of the engine (`glsl-float32-bounds.ts`
says so, and no source file passes `to: "wgsl"`). Its registry has a
`case "wgsl"` (`src/plot-core/ce-module-registry.ts`) and comments that name
the target. Tell a Tycho session when 1a is released; it removes them.

## Step 2. Design note of the annotation

**Goal.** One page, approved by the user before step 3, in
`docs/plans/`. It answers:

- The set of fragment types (the spec, section 2, "Values and types") as a
  TypeScript type, and how a function body, a sampler-backed list and a
  parameter bound to one are typed.
- Where the annotation lives beside the tree, so that the tree stays as it
  is and a second compilation of the same expression with other options does
  not read the first one's annotation.
- How a fact other than the type is added later (an effect, an
  evaluation-count rule, a provenance) with no change to the shape of the
  annotation. The type is the only fact of step 3.
- Which questions the GLSL emitter asks today that the annotation answers,
  in the order they move: the shape frames of `gpu-shapes.ts` and the
  declared-type frame of `gpu-declared-types.ts` first.
- The form of the `outside-fragment` diagnostic, and how the pass reports
  the first node that has no type.

The note states that the annotated tree is the first pass at the engine's
intermediate representation, and what it deliberately leaves out.

## Step 3. `canCompile()` as a typing pass

**Goal.** The spec, section 3 and section 7 step 2.

**Work** (implementer; a dual review, since it is a documented contract):

- The typing pass of step 2, in a new module of
  `src/compute-engine/compilation/`.
- `canCompile(expr, options)` exported beside `compile()`
  (`src/compute-engine/compilation/compile-expression.ts`, `src/compile.ts`,
  the engine method if `compile` has one), with the options of `compile()`.
- `compile()` to `glsl` runs the pass first and declines with the
  `outside-fragment` diagnostic. A decline that emission still raises for an
  expression the pass accepted is a defect of this step: fix the pass or the
  list, and add the case to the tests.
- The emitter reads the annotation for the questions that step 2 names
  first. The other readers move in step 5.
- The pass cap of the spec (the `iterationBudget` option on `glsl`, one
  run-time counter for the whole evaluation, `NaN` over it).
- Tests: one positive and one negative case for each line of the spec's
  list, the showcase function bodies (`burning-ship`, `multibrot`,
  `julia-set`, the colour formula of `buddhabrot`), the `storage` option,
  the `vars` option, a symbol without a numeric type (the diagnostic names
  it), and "never throws" on an invalid expression.
- `docs/COMPILATION-MODEL.md`, "Target boundaries": the fragment and the
  predicate. The compile guide of the site
  (`~/dev/cortexjs.io/docs/compute-engine/13-guide-compile.md`): the
  predicate, with each example run against the source. `CHANGELOG.md`.

**Checks.** As step 1, and the acceptance of the spec, section 7 step 2:
the corpus audit shows the same compiled GLSL records as the 0.184.0 arm,
minus the record with `Transpose`, and no new decline inside the fragment.

**Done when.** Those checks pass and the report lists every record whose
route changed, with its reason.

## Step 4. The audit calls `canCompile()` (Tycho)

A request to a Tycho session once step 3 is released: in
`scripts/audit-ce-codegen.mts`, call `canCompile()` before each GLSL compile
and record a disagreement between the predicate and the compile as a field
of the record; run the whole corpus with preludes (the run of 2026-11-08 at
15:57 covers the CORE corpus and the showcase entries only). The engine
session of step 5 reads that arm.

## Step 5. Remove the shader statement machinery

**Goal.** The spec, section 5 and section 7 step 3.

**First session: measure.** For `gpu-statements.ts`, `gpu-draw-order.ts`,
`gpu-at.ts`, `gpu-shapes.ts` and the shader branches of `compile-blocks.ts`,
`compile-statements.ts` and `compile-admission.ts`: which functions serve a
form of the fragment (a scalar block in a function body, a counted loop, a
nested block, a sampler-backed `At`) and which serve only forms that the
predicate now refuses. The result is a table in this file, one row per
module, with the lines that can go.

**Then one module per session** (implementer; one reviewer when the removed
code is unreachable by the predicate and the tests show it, a dual review
when a kept function changes). After each: the GLSL tests, the corpus audit
with no changed code hash, and the full suite.

**Also in this step.** The sections "Statement order on the shader targets"
and "`Break` and `Continue` on the shader targets" of
`docs/COMPILATION-MODEL.md` are rewritten for what remains (a function body)
or removed.

## Step 6. Tycho calls the predicate at resolve time

Tycho's work, on the release that has step 3: `compileDeferredGlsl()` and
`composeLiveProgram()` call `canCompile()` on the by-reference form and then
on the textual expansion, a row that is out ships on its CPU legs at resolve
time, and the sidebar badge shows the diagnostic. `gpuImplicitEligibility()`
does not change.

## Step 7. Measure again, then decide

After steps 1, 3 and 5: the line counts of `compilation/` by target family
(the counting rules of `docs/plans/2026-11-05-compiler-next-pass-measure.md`),
the number of members of `CompileTarget`, and the four places that compile a
list of statements (`docs/COMPILATION-MODEL.md`, "Compiler internals"). With
those numbers, the user decides whether the annotation is widened toward the
numeric core of the JavaScript target, and whether `interval-js` becomes a
pass over it. No work on a wider representation starts before that decision.
