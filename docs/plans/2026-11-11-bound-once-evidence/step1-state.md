# Bound once, step 1: state of the worktree

Worktree `/tmp/wt-compute-engine-ad-step1`, detached at 5eb1778b5. No commit,
no stage. Spec: `docs/plans/2026-11-11-bound-once-spec.md` in the MAIN tree
(sections 10 and 11 are the decisions; D5 final, D6, D7).

## Built (all in the working tree)

- Bound once (spec sections 2, 10): a free name resolves from its home scope,
  an occurrence with a definition from `_defHome` (`homeChainBinding`), cached
  in `_resolution` keyed by the type version and checked against its scope.
  `readsActivation()` (`binders.ts`) selects parameters, binder variables and
  block locals; they still use `bindingInContext()`.
- C3: no ambient chaining (`scope-chaining.ts` deleted). C5: `popScope()` of a
  frame that is not a call frame releases subscriptions only.
- Value shield without writes: `boxed-expression/hidden-values.ts`, read in
  `_BoxedValueDefinition.value`; key in the shared evaluation memo.
- D5 final: no rebinding of a boxed operand beyond the two existing
  mechanisms (`bindBindingSites` post-phase, `rebindParameters`); `Block` does
  not rebind. `nestDependentLimits()` boxes the nested operators from `.json`.
- D7: renamed calls in `compilation/shadowing-calls.ts` are bound to the
  copies of the inner scope; no callable-home read.
- Tests: `test/compute-engine/bound-once.test.ts` (rows, D5 rows, D6 table and
  hard cases 5 to 7, each with debug off and on).

## Failing in the 423 files before D6 step 1

- `compile-javascript-structured-blocks` "short-circuit operand" and
  `-random` "a Sum whose body draws": their owner changes the helper to
  `ce.box(['Function', expr.json, ...names])` (verified by a probe).
- `closure-frame-retained` "dependent limit", debug true: D6.
- `compile-shared-binder-body` "gives the value of evaluate()": D6 (the
  nested `Sum` scope does not reach the call frame).

## Decided for D6 (coordinator, 2026-11-11)

An activation holds values, not copies of definitions; the definition of a
parameter, binder variable or block local is the static one on every route.
A value read or write goes to the activation of its scope found by following
links from the current activation; none found: no value. The type is that of
the static definition (rule 4 of slice 1); a test that needs the type to
follow a run's value is reported, not decided.

## First attempt of step 1 (reverted)

Copies of definitions per activation broke `D`, `DSolve`, `JacobianMatrix`
and Rubi programs (`Simplify(D(x^2 + a x, x))`). The patches are in the
session scratchpad (`step1-*.diff`). Time before step 1: calculus 11.7/11.5 s,
simplify 2.6/2.3 s, integrate-symbolic-pole 19.2/18.5 s (load 7.5).

## Step 1, value records (built)

- `ambient-chain.ts`: `scopeActivation(parent, scope)` makes the activation
  (the template's binding records, a record `static def → value` started
  from `_staticValue()`, parent = current lexical scope);
  `activationRecordOf(def, from)` follows the links; `isActivatedDefinition`;
  `holdsActivation`.
- `boxed-value-definition.ts`: `storedValue` and the value setter of an
  activated definition read and write the record; `_staticValue()`.
- `boxed-function.ts` (both routes) and the four comprehension pushes of
  `control-structures.ts` push `scopeActivation()`; `inActivatedParent`,
  `asyncScopeActivation`, `_cloneForActivation` uses there are gone.
- `engine-scope.ts`: the pop of an activation skips its template's records
  (no dispose, no tombstone); the template tombstones are gone.
- `function-utils.ts`: a captured nested scope is an activation holding the
  values; `isInUse` counts a scope with a live activation; a renamed block
  local keeps `_blockLocal`; `rerootScopes` keeps a closure value not below
  the renamed binder; `bindEscapingLocals` replaces the block locals that a
  lazy comprehension reads.
- `lazy-view-context.ts`: a view made outside every call, in an activation,
  records the stack of its creation.
- `library/utils.ts`: `nestDependentLimits` back to the base form.

## Step 2 (stopped, tree back at step 1)

Attempt: an occurrence of a binder variable or a block local reads its
static definition (`readsOwnDefinition()` in `binders.ts`, used by
`_contextBinding()`), and the captured copy of a nested scope keeps the
static definitions with their values. Patch:
`step2-attempt.diff` in the session scratchpad.

Blocker: a run of a block does not write the static definition of its
locals. `sweepCanonicalizationBindings` (`control-structures.ts`) removes
them from the scope at each run, and `declareAssignmentLocals` /
`createBlockLocals` (`function-utils.ts`) and the `Declare` handler make a
new definition per run. `Block(c := 5, 2c)` gives `2c`: the write goes to
the run's definition, the read to the static one. Step 2 needs the rule of
step 6 first (a run writes the values of the static definitions of its
block; it makes no definition of a local that the block binds statically).

## D8: built in part (2026-11-11)

Spec: end of D8 in `docs/plans/2026-11-11-bound-once-spec.md`. Survey:
`d8-survey.md`. The diff of the tree before D8 is `before-d8.patch` in the
session scratchpad.

### Built

- Boxing: a block hoists only its `Declare` targets (and its `DefineFunction`
  names). The hoist of a first `Assign`, the record of assignment locals,
  `LATER_DECLARATIONS` and the later-declaration locals are deleted
  (`canonicalBlock`, `library/control-structures.ts`).
- Errors: `declaration-below-statement` (a `Declare` canonicalized in a
  branch or a loop body, `isInBranch()`, checked by the `Declare` canonical
  handler, `library/core.ts`) replaces `first-assignment-in-branch`;
  `assignment-to-undeclared-variable` (an `Assign` or `AddTo` to a name that
  no scope declares, in a block, a function body, a binder body, a branch or
  a loop body, `isInBodyOrBranch()`; the `Assign` and `AddTo` canonical
  handlers and the `Match` case check). Outside them an `Assign` declares as
  before.
- `assignment-locals.ts` deleted; what it held besides the assignment locals
  (branch depth, function-body depth, free-symbol marks, paired function
  names) is in `statement-position.ts`, with the new block depth
  (`enterBody()`/`exitBody()`).
- Readers of the assignment locals removed: `function-literal.ts`,
  `invisible-operator.ts`, `boxed-symbol.ts`, `effects-inference.ts`
  (`withBlockLocals`, `rawBlockAssignmentLocals`), `provisional-application.ts`
  (`noteAssignmentLocal`), `function-utils.ts` (`declareAssignmentLocals`,
  `copyAssignmentLocals` calls, `withKeptAssignmentLocals`; `blockLocals` is
  the set of `Declare` targets, the per-statement index for a `Declare` in a
  branch is gone), `control-structures.ts` (`declareRunAssignmentLocals`).
- Compiler: `withImplicitLocalDeclares` (`compile-locals.ts`) and its four
  callers, the assignment-local branch of `compile-references.ts` and of
  `isBlockValueComplexValued` (`compile-complexness.ts`). NOT edited (another
  session's file): `compilation/fragment.ts` `walkBlock` still collects
  "implicit locals" (an `Assign` to a name that the block scope binds with no
  `Declare`); D8 makes that branch unreachable.
- Epsil: the top level of a program is a block for the rule
  (`boxTopLevelStatement()`, `static-diagnostics.ts`); the later-declaration
  machinery of `execute-epsil.ts` is deleted; codes and messages in
  `static-diagnostics.ts`, `execute-epsil.ts`, `error-explanations.ts`;
  `errors.md` regenerated (`scripts/build-error-docs.ts`); `declarations.md`,
  `evaluation.md` and the snippets of `control-flow.md`, `operators.md`,
  `literals.md`, `types.md`, `for-agents.md` say `let`; corpus
  `exercism/grains.epsil`. `docs/ERROR-MODEL.md` table updated.
- Tests: `bound-once.test.ts` has the D8 rows and decided cases (43 pass);
  `ce-473` Epsil route uses `let y`.

### Not done

1. Runs (item 2 of the brief). Still in place: `sweepCanonicalizationBindings`,
   `blockRunStates`, `callActivationKey`, `TOP_LEVEL_RUN`, `asyncRunLocals`,
   `beginAsyncRun`/`endAsyncRun`/`isImplicitRunLocal`
   (`control-structures.ts`); `createBlockLocals`, `STATEMENT_LIST_SCOPES`
   (`function-utils.ts`); `initializeBlockLocal`, `BLOCK_REINSTALLS` and the
   per-run `ce.declare()` of `declareOne` (`core.ts`); the swept helpers of
   `binders.ts`, `recordCanonicalLocal` (`declared-local.ts`),
   `_assignmentEvidence`. With D8 no run can make an implicit local, so the
   parts of the sweep and of the asynchronous run record that keep implicit
   locals are dead; the parts that remove the hoisted `Declare` bindings and
   the per-run definitions of `Declare` are live. Their removal needs the
   `Declare` handler to write the value of the static definition on each run
   (upgrade in place also for a binding of a previous run), and the closures
   that a run creates before its `Declare` (`captureNestedLocals`,
   `for i in [1, 2] { fs = [...fs, () => k]; let k = i }`) to hold the
   activation instead of the binding of the run: that is step 3/4 of
   `activations-design.md`, so item 2 was not started.
2. Test migration. Failing after the boxing change (counts of failure
   headers in the logs, not exact): `test/epsil` 16 files (208 tests); the
   files of `failing-files-*.txt` 21 files; the 12 files of `d8-survey.md`
   section 3 (187 tests, not restated). Almost every failure is a program
   that assigns a name it does not declare
   (`assignment-to-undeclared-variable`). Files: see the report of this step.

## Step A of the activations (the runs of a block): built in part (2026-11-12)

Commits `36cc38fc8` to `fca33f891` (detached). Not finished: 22 tests fail
that pass at `9bfb8e337` (list below). Source +323/-719 lines against
`9bfb8e337` at `bb5d2264e`.

### Built

- Deleted (`library/control-structures.ts`): `sweepCanonicalizationBindings`,
  `recordedBlockScopes`, `BlockRunState`/`blockRunStates`, `TOP_LEVEL_RUN`,
  `callActivationKey`, `asyncRunLocals`, `AsyncRun`, `isImplicitRunLocal`,
  `beginAsyncRun`, `endAsyncRun`. `function-utils.ts`: `createBlockLocals`
  (`STATEMENT_LIST_SCOPES` is kept, filled by `noteStatementListScope()`).
  `library/core.ts`: `initializeBlockLocal`, `BLOCK_REINSTALLS`,
  `reinstallScopeKey`, the `_uninitialized` paths of `declareOne`.
- `Declare` (`declareOne`, `core.ts`): when the current scope holds the
  static local (`_blockLocal`) and an activation holds its value, the run
  writes the value there (type check of a declared type; a declared type
  that is not `unknown` makes the local declared; a function value under a
  declared type goes through `assignFn()`), and declares nothing.
- The initial value of a `Declare` is boxed with the outer binding of the
  declared name (`withOuterNames()`, `core.ts`: a lending scope and a
  shadow frame); a function literal value is not (its body reads the local).
- `assignFn()` (`engine-declarations.ts`): a function value assigned to a
  value definition that an activation holds is written as its value; the
  binding is not turned into an operator definition.
- Call frames (`function-utils.ts`): `holdBodyLocals()` makes the frame hold
  the static definition of each parameter (`declareParameterActivation()`
  now puts the static binding in the frame, value in the record; the
  per-call definition remains only for a literal with no static binding)
  and of each local of the body. `hideBodyScopeParams()` no longer hides a
  block local. The frame is registered with no template.
- `scopeActivation()` (`ambient-chain.ts`) holds only the locals of the
  node: block locals (no value at the start) and binder variables
  (`_isBinderVariable` or `binderNames`). A parameter or a boxing
  placeholder that a nested block scope holds is not in its record.
- `isActivation()` (`binders.ts`) also answers for a static parameter
  definition (`isFunctionLiteralParameter`); `bindEscapingLocals` and
  `runValue` treat it as a parameter.
- Copies of captured scopes hold the record of the scope they copy
  (`snapshotNestedScope` for a block run shares it; `holdValuesOf()` in
  `copyChainToLeaving` and `rerootCapturedLocals`).
- The pop of a frame (`engine-scope.ts`) skips every binding whose
  definition the record holds.
- Exact argument sources (`exact-argument-source.ts`) are keyed by frame and
  static definition.
- Memo dependencies (`collection-element-memo.ts`, `snapshotDeps`) record
  the activation record of an activated definition and compare it.

### Tests changed (class b)

- `derivative-literal-parameter-shadow`: "a body node evaluated outside a
  call" (renamed "...: the parameter has no value") and "a body node
  evaluated after the type of the literal": `n + 1`, was `3` (a parameter
  read outside any activation has no value).
- `scratch-scope-chained-parent`: two tests, a run of a block makes no
  `declare` event (was 1).

### Open failures (pass at `9bfb8e337`)

- (c) A local declared or assigned with an untyped function literal is a
  value in the activation, not an operator definition with a derived
  signature, so the derivations of a global do not apply:
  `whole-collection-parameter` "Limitations of the rule" (4). Probably the
  same cause, not checked one by one: `block-local-function-numeric` "Map
  with the name of the local" (2), `ce-445` (2), `ce-689` "a literal that
  calls a block local function", `annotated-parameter-undecided` "a local
  annotated function resolves after the call returns",
  `missing-result-only` "a local declared with a signature",
  `function-values-rules` #490 defaults, `lazy-argument-capture` "mutual
  recursion".
- (a, not fixed) `block-declared-signature-clause` (3): a second run of a
  block with `let g: sig` before `function g`: the first run retires the
  static record (`retireBindingRecord`) that holds the clause installed
  ahead, and nothing installs it again (`BLOCK_REINSTALLS` deleted). Needs
  the signature and the clauses on the static definition.
- Not classified: `compile-admission` "a Comprehension whose a guard/body
  assigns a parameter of the function" (2); `ce-689` "a type handler that
  reads a parameter by name" and "the static view diverges while an
  awaited application is suspended"; `lazy-view-scope` "a call that reads
  its view at once does not retain its frame"; `documentation` types.md:683
  (`type(t.value)` gives `unknown`).
- Known before: `ce-586` (D9), `assignment-stores-lazy-collection` (CE-1245),
  `closure-frame-retained` "dependent limit" (both debug), `comprehension-
  index-function` "Epsil" (step D).

### Left of the design

Step B (no `bindingInContext` corrections; delete `markActivation`,
`_activationOf`, `staticBindingOf`, `callerBinding`, swept homes), step C
(function values hold their activation; delete the re-parenting and
`hideBodyScopeParams`), step D (lazy views), steps 4 and 6.
