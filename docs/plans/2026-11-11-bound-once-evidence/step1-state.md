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
