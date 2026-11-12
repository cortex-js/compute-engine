# Bound once, step 1: state of the worktree

Worktree `/tmp/wt-compute-engine-06-main`, detached commits on main's
`dc51affd4` (the work before 2026-11-12 is in `/tmp/wt-compute-engine-ad-step1`,
last `52a0185e6`). The newest section is at the end. Spec: `docs/plans/2026-11-11-bound-once-spec.md` in the MAIN tree
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

## The change on main, and step A finished for function locals (2026-11-12)

Worktree `/tmp/wt-compute-engine-06-main`. Commits: `4ffd2018c` (the accepted
change applied on `dc51affd4`, the six conflicts with the removal of the
checkpoints resolved), then `4947af72a`, `b90ca3d64`, `c1028d891`,
`522900b6a`, `be37e5b50` and the commit that holds this section.

### Built

- A local that a `Declare` of a block gives a function literal, with no type
  (or `unknown`) and no `constant` attribute, is a function definition at
  boxing (`defineFunctionLocal()`, `library/core.ts`): `assignFn()` on the
  hoisted binding, which becomes an operator definition marked `_blockLocal`
  (`_BoxedOperatorDefinition._blockLocal`). The callers in the block are
  derived again at boxing (`deriveFunctionLocalCallers()`,
  `noteFunctionAssignment()`, `function-utils.ts`; the run-time
  `afterFunctionAssignment()` keeps only `Assign`).
- In a run: the activation of the block (`scopeActivation()`) and the frame
  of a body (`holdBodyLocals()`) hold a slot for such an operator definition;
  the `Declare` writes the function value there (`declareSteps()`); a call
  applies the value it finds on the links (`callee()` in the evaluate
  handler of `_update()`, `boxed-operator-definition.ts`; none found: the
  call declines); the symbol evaluates to it (`functionLocalValue()`,
  `ambient-chain.ts`, read in `BoxedSymbol.evaluate()` and in
  `resolveEscapingLambda()`); an `Assign` of the local in a run writes the
  activation (`assignNamedValue()`, `engine-declarations.ts`).
- The declared type of a local is the type of its static definition from
  the boxing (the hoist declares it `inferred: false`); the run no longer
  writes it. A type that names `missing` is not hoisted (the run reports it).
- A `constant` local is a constant from the boxing of its `Declare`
  (`markConstantLocal()`), after the evidence of its initial value; a
  constant whose value is a function literal stays a value definition with
  the literal's type, as a global constant. The value setter writes a
  constant local once in each activation.
- A `Declare` with no value (a signature that a function statement of the
  block defines) is the static definition of that function: the hoist does
  not mark it `_blockLocal`, the `DefineFunction` canonical handler installs
  the clause under the declared signature at boxing, and a run of the
  `Declare` in a block or a body changes nothing.
- A type computation (`static-typing-view.ts`) reads no value from the
  activation of a call; a read outside it that takes a value from a call
  frame records the divergence (`noteParameterReadByName()`).
- A closure captured at the end of a call keeps the static locals of its
  body (`captureClosuresUncached()`).

### Tests changed (class b)

- `block-declared-signature-clause`: "the call is checked against the
  declared parameter type" and "a later call outside the declared signature
  is still refused": the call `g(1.5)` between `let g: (integer) -> integer`
  and `function g` is an error of the boxing (the block is invalid; was the
  run-time error value); header comments state the rule.
- `missing-result-only` "a local declared with a signature": `h(Missing)`
  gives what `h(3)` gives, as for a global declared with the signature (was a
  partial application).
- `ce-772` "a function with a scalar body, called on a list": the call is
  typed `vector<3>`, as for a global (was `unknown`); header comment.
- `whole-collection-parameter` "a call to a helper that the body assigns":
  first expectation `(xs: collection<any>) -> integer | signed_infinity`, as
  for a global helper (was `(xs: collection<any> | value) -> unknown`);
  comments of three "Limitations" tests.
- `ce-1120` "a Declare statement whose parameter type no string has" (2): the
  compilation declines on the invalid block (`g(t)` is an error of the
  boxing) instead of the `Declare` reason.
- `epsil/effects` "applying a pure let-bound lambda": `h` is `(n: unknown)
  -> number` (was `-> unknown`): `sq` is typed as a global.

### Open failures (wide run at `be37e5b50`: 404 files, 31 failures; 20 of them fail at `4ffd2018c` too)

- (c) A function local declared with a literal and later assigned another
  literal: the static definition keeps the signature derived from the
  `Declare`, which is wrong for the second function (a global gets a new
  definition at the `Assign`). `ce-772` "assigned another", the second and
  later expectations of `whole-collection-parameter` "helper", its "an
  assigned helper over a list", `compile-block-local-function` "Declare
  followed by an Assign" and "REASSIGNED let-bound lambda" (not checked one
  by one).
- (c) `epsil/function-declaration-hoisting` "the declared signature does not
  apply before its let runs": `let a = String(g(1.5)); let g: (integer) ->
  integer; function g(k) {…}` — the block route now refuses `g(1.5)` at
  boxing, the Epsil route gives `3`. D8 says the type of a local is its
  `Declare`'s for the whole block, and that a read before the `Declare` is an
  error; `g` is also defined by a function statement from the start.
- (c) `scope.test` "a Declare statement before a definition in a Block":
  `Block(DefineFunction(h, …), Declare(h, sig, literal), h(5))` threw
  "already declared" at run; the rules do not say whether a function
  statement and a `Declare` of one name are two declarations.
- (reported, design) The type of a binder variable or parameter does not
  follow the run's value: `epsil/documentation` `types.md:683` (`match t {
  tree(v, cs) => type(v) }` gives `unknown`; the page documents the matched
  value's own type), `ce-445` "the N operator over a lazy Map" (an `Assign`
  of a real to a parameter typed `rational` from the source is refused
  under `N(...)`), `ce-445` "a callback that reads a local … under N" (the
  callback now reads the static local and takes the rebuild route: last
  digit `…666` for `…667`).
- (a, waits for step C or D) A function value or a lazy view made in a run
  does not reach the activation: `block-local-function-numeric` "Map with the
  name of the local" (2, the `.N()` wrapper `(_) => N(hLoc2(_))`),
  `comprehension-index-function` "Epsil", `assignment-stores-lazy-collection`
  (CE-1245), `closure-frame-retained` "dependent limit" (2),
  `ce-535-531-binder-declaration-cache` CE-543 (6, the residual of a partial
  application reads a parameter after its call; fails at `52a0185e6` too, not
  recorded before), `lazy-view-scope` "reads its view at once",
  `ce-689` "static view diverges while an awaited application is
  suspended" (pins the re-parenting of the body scope; becomes (b) at step
  C).
- (a, not fixed) `closure-assigned-to-same-name` "a local declared in an
  inner block does not capture …" (2): `Block(Declare(g, t ↦ 9), Assign(g,
  f), g(0))` gives `g(0)`; the `Assign` writes the activation, the call does
  not reach the evaluate handler of the local (cause not found).
- (a, not fixed) `ce-689` "a literal that calls a block local function is
  typed again inside the call": the literal's type is `any`-effected in the
  second call and not in the first (a cache).
- Not classified: `compile-admission` "a Comprehension whose … assigns a
  parameter" (2: the lazy comprehension stored by `Declare(r, …)` is not
  enumerated before `p + 0`), "a literal returned by a curried literal"
  (`compile-error` for `unsettled-shape`), `random-compile` "Max of a call of
  a block-local function declines" (the call is now typed from the
  definition, so the compilation does not decline), `lazy-argument-capture`
  "mutual recursion" (top-level clauses, NaN).
- Known: `lambda-param-collection-inference` "held as a value" (CE-1244).
- Not mine: `compile-javascript-structured-blocks` (17) and `-locals` (1):
  first assignments of undeclared locals.

### Left

Steps B, C and D of `activations-design.md` are not started. Still in place:
`bindingInContext()` and its corrections for parameters, binder variables
and block locals (`callerBinding`, swept homes, `liveScopeOf` in
`definingScopeOf()`), the re-parenting of the body scope and
`hideBodyScopeParams()` in `invoke()`, `captureClosures()` and the retain
marks, the lazy-view records. The run of a `Declare` still writes
`holdUntil` on the static definition. The fallback path of `declareSteps()`
(a `Declare` whose binding is not in the current scope) still declares at
run time.
