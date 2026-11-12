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

## A function local is a variable (D11, 2026-11-12)

Commits `d1d33a580` and the next one. Source against `a3c0ddc6b`: the
engine `.ts` files lose the function definition of a local; see the report of
the step for the counts.

### Built

- A local that a `Declare` gives a function literal, or that a function
  statement (`DefineFunction`) of a block or a body makes, is a value
  definition (`_blockLocal`), type `function` when none is declared; the run
  writes the function value in the activation (`declareSteps()`; the
  `DefineFunction` handlers, `functionLocalOf()`, `library/core.ts`). A
  `Declare` with a declared function type assigns its value as an `Assign`
  does (`assignFn()`, which writes the activation and checks the signature).
- A function statement of a block is a declaration (`localFunctionName()`,
  `control-structures.ts`): a second one of the name, or a `Declare` of the
  name, is `variable-redeclaration`; a call before it is
  `read-before-declaration`. The paired signature (`let g: sig; function g`)
  is valid only at the top level of an Epsil program.
- Deleted: `defineFunctionLocal()`, `deriveFunctionLocalCallers()`,
  `noteFunctionAssignment()` (back into `afterFunctionAssignment()`),
  `functionLocalValue()`, the `_blockLocal` of an operator definition and
  its `callee()`/`applicableValue()`, the operator branches of
  `scopeActivation()`, `holdBodyLocals()`, `captureClosuresUncached()`,
  `resolveEscapingLambda()`, `assignNamedValue()` and `declareSteps()`, the
  clause installation for a signature in a block (`signatures`),
  `withPairedFunctionNames` in a block, `functionDefinitionNames()`,
  `blockClauseRedefinition()` (dead: a second clause in a block is a
  redeclaration), the literal type of a `const` local (`markConstantLocal()`).
- Docs: `control-flow.md` "Local functions", `declarations.md` rule 1, the
  explanations of `declaration-without-value` and `function-redefinition`
  (`errors.md` regenerated).

### Open (not decided by the rules, or watched)

- A local function called with a list whose literal parameter types are not
  collections (`q = (a) => h(a)`, `h` a local) is mapped element-wise (the
  rule of a function value held by a variable): `whole-collection-parameter`
  "a chain of two helpers…" and the four "lifted function" tests fail.
- A function statement with a written signature in a block is typed
  `function`, so a call is `unknown` and compiled code declines:
  `ce-1163-run-async` (2), `tycho-item-332` (2).
- An unevaluated call of a local that leaves its call (`h(m) + 1` returned
  by `w(m)`, `m` valueless): `annotated-parameter-undecided` "a local
  annotated function resolves after the call returns" gives `1 + h(2)`.

### Step 2 (per-iteration activations): attempted, not committed

Patch `~/dev/compute-engine-recovery/step2-attempt-per-iteration.patch`
(+65 lines, nothing deleted): an activation that a closure keeps is renewed
before the next index write or restore (`renewIterationActivation()`, called
in `assignLoopIndex()` and in the restore of `saveLoopIndexes()`); a closure
made where its scope has a live activation keeps that activation instead of
the snapshot of `captureNestedLocals()`, and is not rebuilt at the end of the
call. The top-level loop programs give 4 and `[2, 3]`, but
`closure-frame-retained` fails 26 tests (2 before): in a function body,
`let b = (n) => do { let h = (x) => x; for d in [n, 2n] { h = (x => x + d) };
h(1) }; b(3)` reads `d` = 6 inside the call of `h`, and the value of the
block is then evaluated again in the frame of `b`, outside the loop, where
`d` has no value: `d + 1`. The comprehension needs the same renewal in
`ComprehensionIndexFrame.captureAndRestore()`.

## Steps A to C of the remaining work (2026-11-12)

Commits `a59e282f1` to the commit that holds this section (detached, on
`3f4152e06`). Step D (the lazy view) is not started: see the end.

### A. The type of a function statement

A function statement of a block or a body declares its local with the
signature that its literal writes (`writtenSignatureOf()`,
`control-structures.ts`): an unannotated parameter is `unknown`, an absent
result type is `unknown`, nothing is read from the body. A statement that
writes no type, or has a destructuring parameter, declares `function` (a
signature `(unknown) -> unknown` made a call with a list map element-wise,
which the brief excluded). `ce-1163-run-async` "a function of a block that is
also called as an operand": `-> integer` added to `g` (the call was `unknown`
and the compilation declined).

### B. One activation per iteration, function values keep their activation

- `renewIterationActivation()` (`ambient-chain.ts`): before an index write
  (`assignLoopIndex()`) and before the restores (`saveLoopIndexes()`,
  `ComprehensionIndexFrame.captureAndRestore()`), the top activation that
  holds the index is replaced by a new one (same template, same parent, a
  copy of the values).
- `captureNestedLocals()` keeps the live activation of the scope the literal
  is written in (`KEPT_ACTIVATIONS`); a function value whose body scope has
  such a parent evaluates to itself (`keepsActivation()`, in
  `captureAtCreation()`), and the end of a call does not rebuild it
  (`captureClosures()`). The snapshot loop of `captureNestedLocals()` is gone.
- The `bind` substitution: each held argument, as the caller boxed it, is
  substituted into the body (`invokeWithBoundVariables()`).
- Probe item (5) was not needed: `n ↦ Block(Declare(c, 5n), DefineFunction(h,
  k ↦ c + k), Loop(Assign(g, x ↦ h(x)), i ∈ 1..2))` applied to 1, then
  `g(10)` is 15 on both routes and with the debug check.

### C. The static read

- `_contextBinding()` returns the occurrence's own definition when it is
  activated; `bindingInContext()` walks for the own definition of a
  parameter, binder variable or block local (`readsActivationHalf()`) and
  answers `undefined` when the chain does not hold it.
- Deleted (`binders.ts`): `callerBinding`, `sweptCallerBinding`,
  `sweptHomeBinding`, `sweptHomeOf`, `markSweptBinding`, `homeInChain`,
  `ownBindingInChain`, `readsNoOtherBinding`, `isOutsideBindingOfBlockLocal`,
  `isOutsideBindingOfBinderVariable`, the binder clause of
  `isForeignBinderBinding`; `_sweptHome`/`_sweptRecord`.
- Deleted (`function-utils.ts`): the re-parenting of the body scope in both
  call paths, `hideBodyScopeParams`, `restoreBodyScopeParams` and their
  records, the reinstated parameters of `canonicalFunctionLiteral`,
  `rerootOnCreatingFrame`, `recordCallFrameRun`, the defining scope of
  `appliedBodyScopes`. A call frame is registered as an activation of the
  body scope (`registerCallFrame()`), which `liveScopeOf()` finds. The
  static view counts an applied body scope (`noteBodyScopeApplied()`), with
  no hidden bindings.
- Kept: `liveScopeOf` in `definingScopeOf()` (a literal held unevaluated in
  a lazy collection finds the frame or activation of its defining scope),
  `capturedRunOf` and `TEMPLATES_WITH_BLOCK_RUNS` for the copies that
  `closeOverBlockRun()` makes (a lazy `Map` that leaves a block, read under
  `numericApproximation`: `async-block-lazy-closure`), `snapshotNestedScope`
  (lazy views, `closeOverBlockRun`).
- The end-of-call substitution of the parameters skips a function value
  whose activation does not reach the frame of the call
  (`recordNodesOfOtherCalls()`).

### Tests moved (class b)

- `derivative-literal-parameter-shadow` (3): the sign of a body node of
  `(n: real) ↦ Sqrt(n + 1)` read outside a call is unknown, also with a
  global `n = 2` (was `positive`): a parameter outside its activation has no
  value. One renamed: "a read of the sign of a body node of another literal".
- `ce-689` "the static view diverges while an awaited application is
  suspended": the walk from the body scope reads no value outside the view
  either (was `4`): the body scope is not re-parented. It still fails on its
  last expectation (see below).

### Open

- (c) `function-declaration-hoisting` "a recursive multi-clause definition"
  (block route): `fact(0) = 1` writes the type `0` for its parameter, so the
  call `fact(5)` before the clauses is `incompatible-type` and hides
  `read-before-declaration`.
- (c) `function-body-local-assignment` "stated effects that do not cover the
  body": `function g(k) pure { t = k + 1; t }` in a program: the compiled
  route declines for the outer write before the effects check.
- (rule) `tycho-item-332-untyped-program-compile` (2): the helpers of the
  untyped program are `function` locals, a call is `unknown`, and
  `let (rx, ry) = csqrt(…)` declines with `fallback: false`.
- `ce-689` last expectation: passes since step E (the note of a read by
  name is deleted).
- CE-1251: still 500 (the held `t*k` reads the local `t` of the body).
- The CE-626/CE-1234 witness passes (`586135360`).

## Step D: a stored lazy list is a closure (D14, 2026-11-12)

Commits `8f343270d`, `c63092aae` and the commit that holds this section
(detached, on `586135360`).

### Built

- A lazy collection keeps ONE activation link
  (`boxed-expression/lazy-view-context.ts`, rewritten): the lexical scope of
  the evaluation that made it, when its chain holds an activation and the
  collection reads a name it does not bind whose value an activation holds
  (`readsActivatedName()`; a raw symbol counts). A collection that is the
  evaluated node itself (a node of a body) is copied first. A collection
  that the evaluation did not make (the value of a variable) keeps what it
  has. Every read (`each`, `at`, `get`, `indexWhere`, `contains`,
  `subsetOf`, the facets and their memo, the evaluation of the collection,
  the asynchronous evaluation) pushes that activation as the lexical scope.
- The operands that are variables are replaced with their values when a
  lazy collection is stored (`withOperandValues()`, `library/core.ts`, in
  place of `bindReadVariablesOfLazyCollection()`): `xs = filter(xs, …)`
  filters the old `xs`. A `let` function held by a global is its literal.
- The end of a call does not rebuild a collection that keeps an activation
  (`captureClosures()`), and the substitution of the parameters leaves alone
  one whose activation does not reach the frame being left (a caller's
  collection in a recursion).
- The cycle guard of a symbol's queries is keyed by the activation record
  for an activated definition (`_activationKey()`, `boxed-symbol.ts`), and a
  name inside a collection that keeps an activation is not a self-reference
  of the definition being written (`isSelfReferentialValue()`).
- `definingScopeOf()`, `captureNestedLocals()`, `bindingInContext()` and
  `map-lowering.ts` find the activation of a scope on the parent links from
  the current lexical scope (`activationOnLinks()`), not on the stack.
- Deleted: `bindReadVariablesOfLazyCollection`, `bindOutlivedLocalsOfLazyValue`,
  `bindLazyArgumentLocals`, `bindEscapingLocals`, `closeOverBlockRun`,
  `BLOCK_RUN_*`, `TEMPLATES_WITH_BLOCK_RUNS`, `capturedRunOf`,
  `cloneDefinitionWithValue`, `mayWriteThroughCall`, `namesFreely`,
  `holdsLazyCollection`, `outlivedWalkSkips`, `mayReadCallerBindings`,
  `declaredLocalNames`, `liveScopeOf`, `sequenceDefinitionScope`, the record
  of the stack, the nested-scope snapshots, `retainCallFrameOfResult`,
  `recordOutlivedLazyViewContexts`, the `recorded` path of
  `snapshotNestedScope()`, the `prepareOne` hook of `bindTuplePattern()`.
- Docs: `src/epsil/docs/evaluation.md`, `for-agents.md`, `from-python.md`
  (the rule, and how to freeze with `listFrom`); `docs/SCOPING-MODEL.md`
  "Lazy view context lifetime".

### Kept on purpose

- `bindingKeyedSubs`, `applicationValue`: the end-of-call substitution of
  the parameter values (a held `If(0 < u, n, n)` in the result shows `2`).
- `snapshotNestedScope()`: `copyChainToLeaving()` (step E).
- A FINITE lazy collection that reads a variable is still listed at the
  assignment (`listedAssignedValue()`), as the brief asks.

### Tests moved (class b)

`assignment-stores-lazy-collection` (11), `lazy-view-scope` (6, one of
them failing at `586135360` too: the frame of a call is not disposed); see
the report of the step for each program.

## Step E: the deletion pass (2026-11-12)

Commits `9a26ea536`, `df6af1378`, `8f207b182`, `1bb673ca5`, `35a76882f`,
`5aa8b5bf5`, `488c9254f` and the commit that holds this section (detached,
on `586135360`). Source +180 −934, tests +25 −19.

### Deleted

- `noteParameterReadByName()` and its record (`static-typing-view.ts`), the
  call in `storedValue`: `ce-689` passes in full.
- `markActivation`, `staticBindingOf`, the `Activated` type, the fields
  `_activationOf` and `_scopeActivationOf` of a value definition and their
  snapshot entries, `_cloneForActivation`: nothing set them any more.
  `sameBindingDef()` is identity.
- The retain marks: `retainScope`, `isRetainedScope`, `RETAINED_SCOPES`,
  `isRetainedNodeScope`, `retainScopesReachedByLiteral`,
  `nodesReadingLeftCall`, the `retain` parameter of `captureNestedLocals`.
- `enterNestedBodyScopes`, `exitNestedBodyScopes`, `liveNestedScopes`,
  `nestedBodyScopes`, `withIndexScopeInUse(Async)` and every call site
  (`Loop`, `Comprehension`, the comprehension walk, `Sum`, `Product`, the
  three call paths of `function-utils.ts`).
- `snapshotNestedScope`, `CLOSURE_LOCALS_SCOPES`, `rerootCapturedLocals`,
  `copyChainToLeaving`, `CHAIN_COPIES`, `holdValuesOf`; `rerootKind` has no
  `'through-frame'` case.

### Built

- A lazy collection made in an activation holds the values of the
  operands that are variables of an activation, and is boxed again, so the
  checks of its operands run on their values
  (`withActivatedOperandValues()`, `lazy-view-context.ts`):
  `Block(L := [[1, 2]], Map((t: real) ↦ 2t, L))` is the
  `incompatible-type` error again (`block-local-list-rank-join`). It also
  fixes `f(n, s) = take(s, 2) if n == 0 else f(n - 1, map(x => 2x, s))`,
  `f(1, 1..oo)`, which gave `[4, 8]` (now `[2, 4]`).
- A free-name operand of a stored lazy collection reads the binding it has
  at the assignment (`withOperandValues()`, `core.ts`).

### Kept

- Tombstones (`binding-tombstone.ts`): a debug check that tests pin
  (`binding-debug-invariant` "reports a use of a dead binding with both
  stacks").
- The searches of the stack in `engine-scope.ts` and `function-utils.ts`:
  they find the innermost call frame, count call frames and count holders,
  which the rule does not replace.
- The run-time path of `declareSteps()` after the activated-local path: it
  is the path of a top-level declaration (the global scope, a scope that
  the host pushes). Instrumented on `test/epsil` and the block, scope and
  closure files, it never ran inside an activation.
- The `holdUntil` write at a run: the static definition of a block local
  gets its `holdUntil` only there.
  `Block(Declare(h, real, 2, {holdUntil: "N"}), h + 1)` gives `h + 1` with
  it and `3` without it.
- `captureClosures` and its rebuilds: with them off, 162 tests of the
  closure files fail ("a closure assigned to a name that it reads as
  another binding › the closure keeps the parameter of its own call").

### Tests moved (class b)

- `review-async-regressions` "ApplyWhole …" and "declared broadcast …": a
  comprehension boxed before the caller's scope is pushed reads its home
  `n = 1`: 14 → 2.
- `shared-collection-literal-evaluation` "a stored tuple whose inline
  function reads a variable …": `[[4,5],[4,5],3]` → `[[4,5],[6,7],3]`.

## The change on main 38622ec29, for landing (2026-11-12)

Worktree `/tmp/wt-compute-engine-06-land`, detached commits on main
`38622ec29`: `022c36151` (the change of `c2b80446c` applied; one conflict,
`docs/SCOPING-MODEL.md`, both sections kept), `be8fa7d77` (the five held
tests), `391a02afe` (dead code), `d73edd7ed` (comments), `82f68ff0b` (model
docs, CHANGELOG, Prettier), `382e8e033` (the import cycle) and the commits
after it.

### The five held tests (D15)

`whole-collection-parameter` "Limitations of the rule": each local function
whose parameter takes the list whole declares it `list` (`(t: list) =>
count(t)`, `['Typed', 't', "'list'"]`); the untyped wrapper `r` keeps the
mapped results. An untyped parameter of a local literal still gets a
collection type from its own body (`(t) => count(t)` is
`(t: collection<any>) -> …`): leftover 5 (b), removed later with D15.

### Deleted

`recordCanonicalLocal`, `canonicalLocalOf`, `CANONICAL_LOCALS` and the
`canonicalLocalType()` path of `declareSteps()` (no writer since D8);
`nestedBodyScopes`, `liveNestedScopes`; `enterStaticTypingView`,
`leaveStaticTypingView`; nine unused imports; `export` dropped from
`enterBranch`, `exitBranch`, `registerScopeActivation`,
`isStatementListScope`, `localFunctionName`; the unused `scope` parameter of
`withUseBeforeDeclarationErrors()`.

### Fixed

- Import cycle `effects-inference → match-dispatch → function-utils`: the
  Match case check imported `matchPatternReferences`; it and
  `collectCaptures` moved to `pattern-utils.ts`.
- Comments that named the re-parenting of the body scope, the hiding of
  parameters, the sweeps, assignment locals, `snapshotNestedScope`,
  `capturedRunOf`, checkpoints; design labels in test names and comments.
- Docs: `SCOPING-MODEL.md` (resolution from the home scope, block locals,
  activations, stored lazy lists, value shields), `TYPE-SYSTEM.md` (static
  binding view), `COMPILATION-MODEL.md` (block-local errors), `CHANGELOG.md`.

### Not changed

- `compilation/fragment.ts` `walkBlock` keeps its implicit-local branch
  (structured route; unreachable with D8).
- `asyncInFlight` serializes the awaited applications of one body scope; its
  reason (the re-parenting) is gone, the code is kept.

### Completion checks (2026-11-12)

Full suite at `382e8e033`: 26 files, 58 tests failed (log in the session
scratchpad). At main `38622ec29` the 26 files pass. All 20 failures of the
12 files outside the known list fail at `c2b80446c` too. Moved after the run
(`f7f6f737d`): `binder-mechanism` (4, the frame holds the static
definition), `derivative-closed-form-cache` (1). `ce-1102` timed out at load
46 and passes alone. Open (c): `absent-argument-annotated-parameter` (2),
`spread-literal-result-kind` "the result of a call", `compile-codegen-copies`
CE-329 "not provably an indexed list"; the type of a parameter or capture is
static: `error-propagation` (2), `match-dispatch` (2), `match-expression`
(1), with `types.md:683`. Nightly suites pass; lint, type check, madge
clean. Timing (one worker, load 2.4 to 5.3): calculus 10.7/10.8/10.6 s
against 10.9/10.7/10.6 s at main, simplify 2.0/2.0/2.0 against 2.2/2.1/2.0,
integrate-symbolic-pole 17.4/17.7/17.7 against 19.2/17.6/17.4.
