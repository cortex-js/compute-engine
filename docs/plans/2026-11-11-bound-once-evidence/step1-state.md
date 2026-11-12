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

## D8 (decided 2026-11-11; NOT started in this worktree)

Spec: end of D8 in the main tree's `docs/plans/2026-11-11-bound-once-spec.md`.
Survey: `d8-survey.md` here. The order of work after D8 is steps 2 and 3 of
`activations-design.md`; the step-2 attempt is `step2-attempt.diff` in the
session scratchpad (it failed only because runs made definitions).

Build plan (sites read, line numbers of this worktree):

1. `library/control-structures.ts` `canonicalBlock` (4699): hoist only
   `Declare` targets (`staticDeclarations`, 4575; `hoistDeclared`, 4839).
   Remove the hoist of first `Assign`s (`assignmentLocals`,
   `recordAssignmentLocals(scope, …)` at 4935) and the
   `first-assignment-in-branch` errors at 950, 1289, 4910 and in
   `core.ts:8206`, `box.ts`, `compile-locals.ts`, `types-definitions.ts`.
   New errors, one per situation: a `Declare` below a statement of a block
   (replaces `first-assignment-in-branch`), and an `Assign` in a block or a
   function body to a name with no definition in scope. Keep
   `variable-redeclaration` and `read-before-declaration`. The initial value
   of a `Declare` is canonicalized with the outer name (D8:
   `Block(Declare(z, z + 1), z)` with global `z = 9` is 10).
2. Runs: delete the calls at `control-structures.ts:4374-4375` (sync) and
   `4479-4483` (async), and `sweepCanonicalizationBindings` (4108),
   `isImplicitRunLocal`, `beginAsyncRun`/`endAsyncRun`,
   `declareRunAssignmentLocals`; `function-utils.ts` `createBlockLocals`
   (3767, called at 3473) and `declareAssignmentLocals` (3835, called at
   10078, 11397 and `control-structures.ts:4338`); `assignment-locals.ts`;
   `binders.ts` swept helpers (1072-1220) and `readsNoOtherBinding` (921);
   `_assignmentEvidence` (6 files) and its `readsActivation()` kind;
   `declared-local.ts` `recordCanonicalLocal`. The `Declare` handler
   (`core.ts`) must write the value of the static definition (its record)
   and make no definition.
3. Host level: `ce.assign()` and an `Assign` evaluated outside any block keep
   declaring in the current scope (`assignNamedValue`,
   `engine-declarations.ts:4169`).
4. Epsil: the program top level is a block for the rule; the static checks
   and messages that name `first-assignment-in-branch`
   (`static-diagnostics.ts` 182/191/4261, `execute-epsil.ts:2891`,
   `error-explanations.ts`); docs `declarations.md`, `errors.md`,
   `evaluation.md`; 27 docs programs and 1 corpus program get `let`
   (`epsurvey.ts` in the scratchpad lists them when changed to print all).
5. Tests: the 12 files named in `d8-survey.md` section 3 are rewritten to
   D8; the mechanical rest (estimate under 200 files) gets
   `['Declare', name, "'unknown'", value]` for the first `Assign`; the D8
   table rows and the decided cases go in `bound-once.test.ts`.
