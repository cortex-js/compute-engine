# Implementation plan: the GLSL fragment and the removal of WGSL

**Status:** approved 2026-11-08. ROADMAP entry CE-1166.

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
| 2 | Design note of the annotation (done) | nothing | Compute Engine, then the user's approval |
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

Done. The note is
`docs/plans/2026-11-08-glsl-fragment-annotation-design.md`; its status line
records the approval. It fixes:

- The fragment types as a TypeScript type that names no target, the
  representation of each type on GLSL as a second field, and one resolved
  conversion per operand (the note, section 2).
- Where the annotation lives: one table per scope, in an object that each
  call makes, so that the tree stays as it is and a second compilation does
  not read the first one's annotation (section 3).
- The order of the walk for each form that binds a name, and the check of
  the place of a node at every use (section 4).
- Which facts the annotation can hold: a fact that has the same value at
  every read of a node in its scope. A fact about an assigned value does
  not fit it (section 5).
- Which questions the GLSL emitter asks today that the annotation answers,
  in the order they move (section 6), and the `outside-fragment` diagnostic
  (section 7).

The annotated tree is a typed front end. It is the input of a later
intermediate representation, and the note says what that representation
needs and this change does not build (section 8).

## Step 3. `canCompile()` as a typing pass

**Goal.** The spec, section 3 and section 7 step 2.

**Work** (implementer; a dual review, since it is a documented contract):

- The typing pass of the design note, in two new modules of
  `src/compute-engine/compilation/`: `fragment.ts` (the types, the pass, the
  refusal; it names no target) and `glsl-fragment.ts` (the rules and the
  representations of GLSL). The preparation of the tree is split from the
  emission in `gpu-shader-target.ts`, so that the predicate and the compile
  run the same preparation (the note, section 1).
- `canCompile(expr, options)` exported beside `compile()`
  (`src/compute-engine/compilation/compile-expression.ts`, `src/compile.ts`,
  the engine method if `compile` has one), with the options of `compile()`.
  It catches every error. `CompileDiagnostic` gets the optional field
  `operator`.
- `compile()` to `glsl` runs the pass first and declines with the
  `outside-fragment` diagnostic. `compileFunction()`, `compileShader()` and
  `compileToSource()` of the GLSL target run it too. A decline that emission
  still raises for an expression the pass accepted is a defect of this step:
  fix the pass or the list, and add the case to the tests.
- The emitter reads the annotation for the questions that the note names
  first (section 6). The other readers move in step 5.
- The inventory of the rewrites that emission does (the note, section 3,
  "A node that emission makes"): each one with its contract, the structural
  check `fragmentReplaceOperands()`, and one test against the interpreter.
- The pass cap of the spec (the `iterationBudget` option on `glsl`, one
  run-time counter for the whole evaluation, `NaN` over it). It counts the
  passes of the emitted code.
- Tests: one positive and one negative case for each line of the spec's
  list, the showcase function bodies (`burning-ship`, `multibrot`,
  `julia-set`, the colour formula of `buddhabrot`), the `storage` option,
  the `vars` option, a symbol without a numeric type (the diagnostic names
  it), and "never throws" on an invalid expression. The generated test of
  the signatures (the note, section 4): mixed operand types in each order,
  operands that are inputs, `constantFold: false`. An expression over the
  pass cap and one under it, each with `cse` on and with `cse: false`. A
  read of a block local before its declaration, with and without an outer
  binding of the same name.
- A GLSL ES 3.00 compiler for the generated sources. The repository has
  none: propose the tool (a headless WebGL2 context or a validator package)
  to the user before a dependency is added.
- The time of `canCompile()` against `compile()` on the showcase bodies, in
  the report.
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
form of the fragment (a scalar block in a function body or at the row root,
a counted loop, a
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
or removed. The other readers of the design note, section 6, move to the
annotation, and the emitter reads the recorded conversions. Each rewrite
that emission does and that can run in the preparation moves there. When
the shader targets push no shape frame, the table of declared types keyed by
frame goes.

### The measure of step 5

Measured on 2026-11-09 at `5c51b330a`, in a scratch worktree, with the 233
test files that name GLSL (11,329 tests pass). Line numbers are those of
that commit. Three methods back the rows:

- **Rule.** The fragment refuses the form: the head has no rule in the
  table of `glsl-fragment.ts` (lines 1262 to 1277), and `fragment.ts`
  refuses a head with no rule (lines 1252 to 1257); or a rule refuses the
  operand (cited in the row).
- **Coverage.** Istanbul statement and branch coverage of the modules over
  the 233 files.
- **Stage probe.** A probe at the entry of each top-level function recorded
  the stage that was running: the emit stage (`emitPreparedRoot()`, or the
  `withAnnotation()` emission of `compileFunction()` and `compileShader()`),
  the prepare stage and the pass (`prepareAndType()`,
  `typeDeclaredBody()`), or neither. The emit stage runs only after the pass
  accepted the expression. Thus a function that the emit stage enters serves
  an admitted form, and a decline that it raises there is a disagreement
  between the pass and the emitter.

The result: almost every function is entered by the emit stage. The code
that can go is the code of four refused forms (`Match`, a selection with a
vector condition, `Return`, a random draw) and the operand-shape check,
whose declines never run after the pass. Most of the remaining code serves
admitted forms; it changes in step 5 only when its questions move to the
annotation (the design note, section 6), not by removal.

| Module | Lines | Can go | Stays, and why | Evidence |
| --- | --- | --- | --- | --- |
| `gpu-statements.ts` | 1,330 | About 520 lines. `compileGPUMatchStatement()` and `gpuMatchSelectedPieces()` (105): `Match` has no rule. `compileGPUSelection()`, `gpuSelectionConditionWidth()`, `gpuSelectionMask()`, `gpuMaskAnd()`, `gpuMaskOr()`, `gpuSelectionDecline()` (364), with the `selection` hook in `gpu-shader-target.ts` (lines 592 to 596): the element-wise selection by a vector condition; `walkIf()` and `walkWhich()` of `fragment.ts` admit a `boolean` condition only. `gpuAssertReturnPlacement()` (55), with the `onReturn` hook of the `define` hook: `Return` has no rule. The `Continue` part of `gpuShaderLoopJumps()`: `Continue` has no rule. | The statement form of `If` and `Which` (`compileGPUStatementSelection()`, `compileGPUConditionalArm()`, `gpuArmSharesWork()`, `gpuNeedsStatements()`, `gpuCanPlaceStatement()`, `gpuWritesOutside()`): the `if` statements of a block (decisions 6 and 13); the emit stage enters them 248 to 73,845 times. `gpuAssertExpressionOnly()` and `gpuAssertExpressionBody()`: the routes that write one expression (`compileFunction()`, `compileToSource()`, `compileShaderBody()`) can get an admitted block; their throws ran 9 times. `gpuShaderLoopJumps()`: the pass calls it (135 entries). | Rule; coverage: the two `Match` functions, the three mask functions and `gpuSelectionDecline()` are never entered, `compileGPUSelection()` never passes its `return null` (line 1266), and the throw of `gpuAssertReturnPlacement()` never runs. |
| `gpu-draw-order.ts` | 724 | The random-draw part, lines 396 to 724 (311 lines: `gpuBindEveryDraw`, `gpuDrawComesAfter()`, `gpuDrawOrderError()`, `gpuCallsAFunctionThatDraws()`, `gpuArmDrawsWhileBinding()`, `gpuRecompileWithBoundDraws()`, `gpuAssertBindingKeepsDrawOrder()`, `gpuRecordBoundDraws()`, `gpuNodeDrawsItself()`, `gpuDrawCount()`), and the draw-count conditions of its callers (`gpu-statements.ts` lines 455 to 470, `gpuHoistKeepsCallerOrder()` line 282, `gpu-extrema.ts`, five sites in `gpu-functions.ts`, `gpu-shader-target.ts` line 569). | The caller-code order, lines 26 to 394 (353 lines: `gpuReachesCallerCode()`, `gpuAssertCallerCodeNotRepeated()`, `gpuAssertHoistKeepsCallerOrder()`, `gpuHoistKeepsCallerOrder()`, `gpuReadsVarsBefore()`, `gpuOperandOnce()` and their helpers): code that the caller supplies (`vars`, `functions`) is admitted, and its order is checked in the emit stage (559 entries of `gpuHoistKeepsCallerOrder()`). It goes only with option (a) of CE-1176 (below). | Rule: `Random` and `WithRandomSeed` have no rule, and an admitted `Assign` writes only a local of its function (`walkAssign()`, `fragment.ts` lines 2958 to 2966). Thus the only impure nodes that reach the emit stage are calls of block-bodied functions, which have no effect outside the function, and caller code. Coverage: `gpuRecompileWithBoundDraws()` never reaches its successful return (lines 549 and 550); the probe found `gpuDrawOrderError()` in one test only, a CE-1176 case (`compile-gpu-extremum.test.ts`, "a constructor written by the caller is not repeated in an arm"). |
| `gpu-at.ts` | 1,027 | `gpuAtBaseRefs()` (17 lines), never entered; its call in `gpu-functions.ts` line 753 goes with it. | Every other function: the emit stage enters each one (an `At` of a constant list, of a list of points, of a list in a texture, of a uniform array; a literal gather or mask that the pass types as a folded constant). | Coverage and stage probe. 0 of the 6 decline sites ran. The "dynamic and masked forms" that the spec, section 5, names are in the `At` lowering of `gpu-functions.ts`, not in this module, and this measure does not cover them. |
| `gpu-shapes.ts` | 2,107 | About 550 lines when the readers move to the annotation: `gpuCheckOperandShapes()` (378 lines with its comment) and the helpers that only it uses: `gpuMisplacedScalarArgument()`, `gpuConstructedVectorWidth()`, `gpuWithoutScalarReductions()`, `gpuReshapesOperands()`, `gpuMatrixDims()` (a matrix is outside the fragment, decision 1). Its call in `gpu-shader-target.ts` line 612 goes. The removal session confirms each helper with `findReferences`. | The shape queries (`gpuOperandShape()`, `gpuComponentCount()`, `gpuBinaryVectorWidth()`, `gpuCertainValueType()`): they move to the annotation (the design note, section 6) and are not removed by this measure. The trigonometric and pi-multiple folds (`gpuReduceTrigOffset()`, `gpuPiMultiple()`, about 6,000 entries each), the NaN and complex helpers, the tables that are built at module load (`markAggregateConsuming()`, `markOperandConsuming()`, `gpuAbsorbedConstant()`). | Coverage, branch level: `gpuCheckOperandShapes()` returns nothing and writes no code; the emit stage enters it 30,327 times, and 0 of its 21 decline sites ran (the one decline whose `if` statement ran, line 1903, never took its branch). The pass refuses those forms first. |
| `compile-blocks.ts` | 1,300 | About 45 lines: the GLSL throws of the local-shape check in `compileBlock()` (lines 388 to 455): a local that holds a list of points, an empty list, a point-or-list union, a matrix, two shapes. | The rest. The shader statement emission of a block (`joinShaderStatements()`, `compileListStatement()`, `shaderSelectionStatement()`) writes every admitted block. `compileStatementList()` lines 132 to 140 (a destructuring statement as a loop body) never ran, but a tuple assignment of locals is admitted: it stays, and needs a test. | Rule: "no list local" and one type per local (`walkDeclare()`, `walkAssign()`). Coverage: none of the five throws ran. |
| `compile-statements.ts` | 660 | Nothing. | `joinShaderStatements()` (293 entries), `compileListStatement()`, `compileFunctionBody()`: they write the statements of each admitted block. The other functions are shared with the other targets. | Stage probe. |
| `compile-admission.ts` | 2,756 | Nothing. | The shader options of the shape check R3 (`droppedOperands()`, `conditionalBranches()`, the `arity` flag of `unsettledShapeIn()`). The pass does not replace R3: `canCompile()` runs the same search after the pass, and `throwUnsettledShape()` declined 8 times in the emit stage after the pass had accepted. | Stage probe. |

Outside the listed modules, `gpu-random.ts` (904 lines) serves only the
random draws. The pass refuses them, but no probe was run in that module:
its removal is a separate measure.

**Proposed order of the removal sessions** (one module each):

1. CE-1177, before any reader moves (below): the emitter must compile the
   tree that the pass typed.
2. `gpu-statements.ts`: `Match`, the vector-condition selection, `Return`,
   `Continue` (about 520 lines). The removed code is unreachable by the
   rule and by the tests: one reviewer.
3. `gpu-draw-order.ts`, the random-draw part (about 311 lines and the
   draw-count conditions of six callers), and `gpu-random.ts` if its own
   measure agrees. A draw-count condition is in kept functions, so a dual
   review. With CE-1176 option (a) in the same session, the caller-code
   order part goes too (about 353 lines).
4. `gpu-shapes.ts`: `gpuCheckOperandShapes()` and its helpers (about 550
   lines), with the shape queries that move to the annotation. A dual
   review: kept functions change.
5. `compile-blocks.ts` (about 45 lines) and `gpu-at.ts` (17 lines). They
   are small, but one module per session still applies.

`compile-statements.ts` and `compile-admission.ts` keep their shader
branches. The total that can go is about 1,450 lines of the 9,904 lines of
the seven modules, about 1,800 with CE-1176 option (a), plus
`gpu-random.ts` if its measure agrees.

**CE-1177: decision (a), extended.** The define hook compiles the body of
the annotation entry. A trial of (a) in the scratch worktree failed 5 tests
in 4 files. Their cause:

- Three tests (common subexpressions in a function body): the nested
  common-subexpression harvest is opened on the stored body `bodyExpr` by
  `compiler-core.ts` (line 6931), before the hook is called. The hook then
  compiles another tree, whose nodes are not in that harvest, so nothing is
  shared. A nested harvest opened on the entry body inside the hook
  (`withNestedCseHarvest()` around `compileFunctionBody()`) makes the three
  tests pass.
- Two tests: `compiler-core.ts` rewrites `bodyExpr` before the hook, and the
  pass does not see that rewrite. The substitution of a tuple-valued
  function (`(v, j) := step(j)`, the witness of CE-1177) is not in the
  entry body, so the emitter declines (`compile-destructuring-from-call.test.ts`).
  And a call that the pass's preparation writes in place stays a call in
  `bodyExpr` (`theta = _fn_theta(…)` in
  `tycho-items-275-289-call-shapes.test.ts`); the value is the same and the
  code differs.

Thus (a) needs two changes: the nested harvest on the entry body, and the
rewrites of the definition route of `compiler-core.ts` (the substitution of
a tuple-valued function, the call writing that the preparation does
differently) move into the preparation that `glslFunctionOf()` and
`shaderFunctionBody()` run, so that the pass types the tree that is
written. Size M. Option (b) (the pass types the copy at the hook) keeps two
preparations that can differ, types each body twice, and keeps the defect
that the issue names: the annotation has no facts for the nodes that are
written. The variants that the pass does not type under their key (an
invariant-prefix variant, whose code overrides are keyed by nodes of
`bodyExpr`) keep the current route until their own preparation moves; the
removal session lists them.

**The result of CE-1177** (2026-11-09, base `c8bf12127`). The `define`
hook compiles the body of the annotation entry, and opens the nested
common-subexpression harvest on it; `compiler-core.ts` opens none for a
target-lowered definition. The two tests of the definition route had one
cause, not two: a call with a `real` argument at a parameter with no declared
type is emitted from a copy of the literal typed by the arguments, under the
key of the definition (`userCallSpecialization()`, split from
`ensureSpecializedUserCallEmitted()`). The node types of the copy differ
(`j := k` is a `number` in the copy of `g(k)`), so `definitionBodyExpr()`
substitutes `step(j)` in the copy and not in the literal, and keeps
`theta_0(x, y)` a call in the copy and not in the literal. `glslFunctionOf()`
now prepares the body from the same copy, unless the call is written in place
(key `h#inlined`). A definition with no entry (a copy under a key of its own,
`f#complex`; an invariant-prefix variant) keeps the old route. Measures: the
233 GLSL test files (11,348 tests) write the same GLSL, byte for byte; the
nodes of a typed body written without facts went from 5,111 compilations
(the run of 2026-11-09) to 0, and the new test
`ce-1177-glsl-function-body-typed.test.ts` checks it
(`CompilerState._emitProbe`; the pass records the statements it checked in
`FragmentScope.statements`). 171 compilations of nodes that emission makes
(folded constants, unrolled terms, destructuring temporaries, a derivative)
are outside the typed body and remain for the step 5 sessions that move those
rewrites. `npm run test:glsl`: 0 disagreements. Tycho's whole-corpus codegen
audit through `CE_ALT_PKG` (764 documents, 17,421 records): 0 changed code, 0
new declines, 0 disagreements of `canCompile()` with `compile()`. The review
found an older disagreement, filed as CE-1184.

**The result of the `gpu-statements.ts` session** (2026-11-09, base
`13c41f1c7`, after Tycho's reading in `issues/CE-1181.md`: 0 disagreements
of `canCompile()` with `compile()`). Removed, as the table row lists: the
statement form of `Match` (`compileGPUMatchStatement()`,
`gpuMatchSelectedPieces()`, and the `statement` option that the GLSL `Match`
entry gave to `compileMatchTernary()`); the element-wise selection by a
vector condition (`compileGPUSelection()`, `gpuSelectionConditionWidth()`,
`gpuSelectionMask()`, `gpuMaskAnd()`, `gpuMaskOr()`, `gpuSelectionDecline()`,
`gpuIsTupleShaped()`, and the `selection` hook of the GLSL target);
`gpuAssertReturnPlacement()` with its three calls and the `onReturn` hook of
the `define` hook; the `Continue` branch of `gpuShaderLoopJumps()`.
`gpu-statements.ts` went from 1,322 to 781 lines; the source files lost 626
lines and gained 40 (comments). The field `CompileTarget.onReturn` and its
call in `compiler-core.ts` stay: the field is in the exported type, so its
removal is a change of the public API. The kept functions did not change.

Two differences from the measure:

- One decline went. `gpuSelectionConditionWidth()` refused a comparison of
  two points even as a scalar condition, so `If(p = q, 1, 2)` with `p` and
  `q` of type `tuple<real, real>` declined while `canCompile()` accepted it.
  It now compiles to `((p == q) ? (1.0) : (2.0))`, which gives the value of
  the interpreter (GLSL `==` on two `vec2` values is true when every
  component is equal). Test `glsl-point-equality-condition.test.ts`; a
  CHANGELOG line.
- The removed hook was not without effect. It read the shape of each
  condition before the arms were compiled, and that query wrote the
  definition of a function that the condition calls. Without it, the
  definitions are written in the order in which the emitter first compiles
  each call: with `If(y < g(x), s(x), 0)`, `_fn_g` came before `_fn_s`, and
  now `_fn_s` comes first. The code is the same, and no definition calls a
  later one.

Measures: the 235 test files that name GLSL pass (11,367 tests), with one
test comment changed; `npm run test:glsl`: 0 disagreements. Tycho's
whole-corpus codegen audit through `CE_ALT_PKG` (764 documents, 17,421
records; production builds of the base and of the change; load 3.7 to 6.7
on 18 cores): 0 new declines, 0 resolved declines, 0 disagreements of
`canCompile()` with `compile()` (3,661 GLSL records, 46 refused), and 3
records with changed code, all on `glsl` and all for the order above:
`showcase/mandelbrot-colorings` and `showcase/underwater-caustics` (two
independent definitions of the preamble change places) and
`neyret/62urmx2dcm` (a temporary is named `_tv1` instead of `_tv9`, and the
common subexpressions of a definition are numbered from `_cse2` instead of
`_cse1`; the code is otherwise the same).

After this session, the GLSL `Match` entry of `gpu-functions.ts` and
`BaseCompiler.compileMatchTernary()`, its only callee that no other target
used, were removed too (243 lines): the pass refuses `Match` on every
route, so the entry did not run. The 236 GLSL test files pass and
`npm run test:glsl` reports 0 disagreements. No audit ran: the removed code
could not write code for any record.

**The result of the `gpu-draw-order.ts` session** (2026-11-09, base
`b9b37fca6`). Removed: the random-draw part of `gpu-draw-order.ts`
(`gpuBindEveryDraw`, `gpuDrawComesAfter()`, `gpuDrawOrderError()`,
`gpuArmDrawsWhileBinding()`, `gpuRecompileWithBoundDraws()`,
`gpuAssertBindingKeepsDrawOrder()`, `gpuRecordBoundDraws()`,
`gpuDrawCount()` and their helpers), the draw-count conditions of its
callers (the statement form of a selection in `gpu-statements.ts`,
`gpuHoistKeepsCallerOrder()`, `gpuOperandOnce()`, `gpu-extrema.ts`, the
`Sum` lowerings, `Remainder`, `Cot` and the `If`/`Which` arm tests of
`gpu-functions.ts`, the `valueBlock` and `recompileStatement` hooks of
`gpu-shader-target.ts`), and the draw code of `gpu-random.ts`: the random
state, the draws, the seed folding, the PCG3D preamble and the five
Random-family entries of the GLSL table. The measure of `gpu-random.ts`, made
first (a probe at the entry of each draw function over the 236 GLSL test
files): its draw code ran only on the route that skips the pass, a GLSL
target object passed to `compile()` as `target` (5 entries, all in
`random-gpu.test.ts`); on that route a draw now declines with "target 'glsl'
has no lowering for it". The functions of `gpu-random.ts` that do not serve
draws (`gpuTextSymbols()`, `gpuInputShapeRefusals()`,
`gpuPlainUniformRead()`, `gpuRefuseShadowedVarsSources()`) moved unchanged
to `gpu-inputs.ts`. `gpu-draw-order.ts` went from 724 to 379 lines; the
source lost 1,675 lines and gained 478 (341 of them `gpu-inputs.ts`, 323
moved). `findReferences` confirmed each removed export.

One difference from the measure: the removed checks counted every impure
node as a draw, and a block used as a value or a call of a function whose
body is a block is impure. So `W + Block(a := x², a)` with
`vars: { W: 'nextValue()' }` declined although `canCompile()` accepted it,
and now compiles (`compile-gpu-extremum.test.ts`, a CHANGELOG entry).

CE-1176 option (a) was not implemented: it changes the documented contract
of caller code (`docs/COMPILATION-MODEL.md`, "Code that the caller supplies
is held to the interpreter's order"), and the recommendation above leaves
choices open (every expression with caller code becomes statements; the same
node at two places; `And`, `Or` and loop bodies; caller code reached through
a symbol value or a function body). They are in
`docs/plans/2026-11-09-ce1176-caller-code-binding.md`, which waits for the
user's approval. The caller-code part of `gpu-draw-order.ts` stays until
then.

Measures: the 236 test files that name GLSL pass (11,370 tests);
`npm run test:glsl`: 0 disagreements (966 expressions accepted by
`canCompile()`); typecheck and `check:deps` pass. Tycho's whole-corpus
codegen audit through `CE_ALT_PKG` (764 documents, 17,421 records;
production builds of the base and of the change; load 4.8 at acquire, 2.6 at
release, on 18 cores): 0 changed code, 0 new declines, 0 resolved declines,
0 disagreements of `canCompile()` with `compile()` (3,661 GLSL records, 46
refused). The corpus has no GLSL record with caller code or a draw, so no
order of function definitions changed.

**The result of the `gpu-shapes.ts` session** (2026-11-09, base
`d43d68f25`). Removed from `gpu-shapes.ts`: `gpuCheckOperandShapes()` and
the helpers that only it used, `gpuMisplacedScalarArgument()`,
`gpuSourceIsVector()`, `gpuConstructedVectorWidth()`,
`gpuReshapesOperands()`, `gpuWithoutScalarReductions()` with
`GPU_SCALAR_REDUCING_BUILTINS`, and `gpuHelperIsScalarOnly()`; with the
`checkOperandShapes` hook of the GLSL target. `findReferences` confirmed
each one. Two differences from the measure:

- `gpuMatrixDims()` stays: `gpuLoweredSymbolTypeHook()` and
  `gpuCertainValueType()` call it too.
- The tables that the measure listed as staying (`markAggregateConsuming()`,
  `markOperandConsuming()`, `gpuAbsorbedConstant()`) are removed: the check
  was their only reader, so after it they were written and never read. Their
  predicates (`gpuDestructuresListOperand`, `gpuIsCollectionReduceForm`,
  `isBroadcastPointNormOperand()`, `gpuBroadcastScalars()`), the 17
  `markAggregateConsuming()` wrappers of `gpu-functions.ts`, the four
  `markOperandConsuming()` calls and `GPU_VECTOR_ARRAY_CONSTRUCTOR` went with
  them.

The field `CompileTarget.checkOperandShapes` and its three calls stay (it is
in the exported type; no built-in target sets it now), and so does the type
`GPUShapeRules` with its four fields that nothing reads now (it is the
return type of the protected `getShapeRules()` of the exported classes).
The shape queries did not move to the annotation in this session.
`gpu-shapes.ts` went from 2,104 to 1,358 lines; the source lost 1,028 lines
and gained 203.

The measure missed one route. A target object of `createTarget()` passed to
`compile()` as the `target` option skips the pass, and on that route the
removed check was the only guard: with `v: list<real^3>` and `x: real`,
`Arctan2(v, x)` gave `atan(v, x)`, which no shader compiler accepts, behind
`success: true` (13 of 21 probe cases). The target object now carries the
preparation and the pass (`raw-target-check.ts`, an own property with a
symbol key, so that a spread copy keeps it), and `compile()` runs it first on
that route: a refusal declines with the diagnostic of `canCompile()`. The
raw route now gives the verdict of `to: 'glsl'` in the 21 cases. It declines
four forms that it accepted before (`Hypot(v, v)`, `Mod(x, v)`,
`Log(v, 10)`, the negation of a matrix) and a list of 1,600 elements read as
a uniform array. `BaseCompiler.compile(expr, target)` runs no pass; that case
is a line of the known limitations of `docs/COMPILATION-MODEL.md`.

Measures: the test files that name GLSL pass (237 files, 236 run and 1
skipped; 11,377 tests, 7 of them new in
`glsl-raw-target-runs-fragment-pass.test.ts`). Two tests of the raw route
changed: `at-gpu-sampler-storage.test.ts` (the 1,600-element list now
declines) and `random-gpu.test.ts` (a draw declines with the refusal of the
pass). The check does not take the `mode` option, so a mode that the target
does not offer still gives `unsupported-mode`
(`unknown-param-call-site-refinement.test.ts`). `npm run test:glsl`: 0 disagreements (966
expressions accepted by `canCompile()`); typecheck and `check:deps` pass.
Dual review, two rounds. Tycho's whole-corpus codegen audit through
`CE_ALT_PKG` (764 documents, 17,421 records; production builds of the base
and of the change; load 4.4 at the start, 3.4 at the end, on 18 cores): 0 new
declines, 0 resolved declines, 0 disagreements of `canCompile()` with
`compile()` (3,661 GLSL records, 46 refused), and 6 records with changed
code, all `glsl`:

- `neyret/b166fa3eba`, row `l(I(x, y) mod 2 - 1) - 0.99`: the base wrote a
  call of `_fn_l` and no definition of it, which no shader compiler accepts;
  the change writes the definition. Cause: for the helper call
  `_gpu_fmod2(…)`, the removed check built a preamble with
  `preambleFor('_gpu_fmod2(')`, and `userFunctionDefs()` then ran
  `pruneUnreferencedVariantBases()` against that short string. The prune
  deletes a definition that was written early for a lane query when neither
  the code nor another definition names it, so it deleted `_fn_l` before
  the call of `_fn_l` was written. A CHANGELOG entry.
- `neyret/0et6fx01id` (2 rows) and `neyret/74cc5c82a3` (3 rows): the same
  lines in another order. `_fn_d` now comes before `_fn_f` and
  `_fn_f_each2_1`; in the base the same prune deleted `_fn_d` and it was
  written again at the end of the table. No definition calls a later one.

Two timing lines (`interval-js` and `javascript` records, 15 to 392 ms and
1.3 to 455 ms) are on targets that this change does not touch, measured on a
shared machine.

**CE-1176: option (a) is recommended, inside step 5, in the session of
`gpu-draw-order.ts`.** Each piece of caller code is bound to a local once,
in the order of the interpreter, at the start of its statement. A piece in
a conditional branch is bound at the start of that branch, which takes the
statement form; it cannot be bound before the statement, because the
interpreter evaluates it only when the branch is taken. The order then does
not depend on the hoisting, and the code that checks the order goes: the
caller-code part of `gpu-draw-order.ts` (about 353 lines, which step 5
otherwise keeps) and `operandsWrittenTwice()` in `glsl-fragment.ts`. It
removes more code than it adds, and it is the move of a rewrite into
preparation that step 5 asks for. The `discard` case (a reserved word as a
parameter name) is separate: the specialization decision moves out of
`ensureSpecializedUserCallEmitted()` (size S), and it can be done at any
time.

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
those numbers, the user decides whether a structured representation is built
on the typed front end (values with an identity, conversions as operations,
effects, rewrites that each make a new revision: the design note, section
8), for which targets, and how `interval-js` joins it: it is a lowering that
must keep its enclosure, not a reader of the annotation of scalar code. No
work on a wider representation starts before that decision.
