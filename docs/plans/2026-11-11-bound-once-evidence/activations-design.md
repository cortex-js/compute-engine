# Activations (D6): design

Line counts are of the worktree (whole function, comments included). Paths
are under `src/compute-engine/`.

## 1. What exists

- Call frame: `makeLambda` (`function-utils.ts`) makes a scope per call whose
  parent is the defining scope, declares new parameter definitions in it
  (`markActivation`, `binders.ts`), and re-parents the body scope onto it for
  the call (`hideBodyScopeParams` 39, `restoreBodyScopeParams` 27).
- Scope activation: `asyncScopeActivation` (`boxed-function.ts`, 26) copies
  the definitions of a scoped node with `_cloneForActivation`
  (`boxed-value-definition.ts`, 16); `liveScopeOf` (`ambient-chain.ts`, 12)
  finds the copy on the stack. The asynchronous route makes one per
  evaluation; the synchronous route only under `inActivatedParent` (6).
- Block runs: `sweepCanonicalizationBindings` (93), `markSweptBinding` (9),
  `closeOverBlockRun` (43), `capturedRunOf` (7).
- Closures: `captureClosures` (51), `rerootOnCreatingFrame` (15),
  `captureNestedLocals` (67), `snapshotNestedScope` (57); `retainScope` and
  `retainCallFrameOfResult` (70, `lazy-view-context.ts`). Lazy views record
  the stack and snapshots of nested scopes (`recordAt` 33, `snapshotScopes`
  20).
- Reads: `bindingInContext` (83) with `callerBinding` (78 with helpers),
  `sweptHomeBinding` (21), `readsNoOtherBinding` (21), the binder skips
  (21), `scopeStandsFor` (11), `activationBindingOf` (21);
  `rebindEscapingCurrentScope` (`utils.ts`, 10) re-points a result away from
  the copies of a binder's scope.

Because the asynchronous route copies definitions, it has a defect today:
`await ce.box(['Simplify', ['D', x^2 + a·x, 'x']]).evaluateAsync()` gives
`a + 2x` that is not `isSame` to `ce.parse('a+2x')`, and
`await ce.parse('\frac{d}{dx}\sin x').evaluateAsync()` is not `isSame`
`cos x` (probe in the worktree and in the main tree; the synchronous route
gives `true` for both).

## 2. The rule as a mechanism

The definition of a parameter, a binder variable or a block local is the
static one, in the scope of the literal, the binder or the block, on every
route; its identity never changes. An activation is a record for one
evaluation of a node: a map `static definition → value`, the run-local
definitions that the run declares (a `Declare` statement executed by the run,
until step 6 removes the sweep), and a link to the activation in which the
node was evaluated (the current lexical scope at the push). It is pushed as
the lexical scope of the evaluation: a scope object whose bindings are the
static binding records of its template plus the run-local ones.

- Read or write of the value of a static definition of a scope that has
  activations: follow the links from the current lexical scope to the first
  activation whose record holds the definition; read or write the value
  there. None found: the definition has no value. A write keeps the events
  and the `_writeVersion` of a value write.
- Type: the type of the static definition, with the unit entry (rule 4 of
  slice 1). A test that needs the type to follow a run's value is reported.
- Binder and block: each evaluation, on both routes, pushes an activation
  whose record starts with the stored values of the template's definitions.
- Function call (step 3): the call frame becomes an activation of the body
  scope whose record holds the parameters of the literal, linked to the
  activation the function value holds.
- Function value (step 3): a closure holds the activation in which the
  literal was evaluated; a call links its frame to it. A lazy view holds the
  activation in which it was made and is enumerated in it (step 5).
- Concurrency: two asynchronous evaluations of one node have two
  activations; the static definition is shared and holds no value of a run.
- Debug check: the pop of an activation tombstones only its run-local
  definitions; a static definition is never tombstoned by it.

## 3. What it deletes and keeps

Deleted: `_cloneForActivation` (16) and the `_scopeActivationOf` field and
its readers (`staticBindingOf` uses, about 20); `inActivatedParent` (6); the
tombstones of a template at the pop of an activation (19);
`rebindEscapingCurrentScope` for activations has nothing to re-point (10,
and its callers' re-pointing of a binder's result); then, in later steps,
the corrections of `bindingInContext` (about 200), the re-parenting and the
hiding in `makeLambda` (about 100), the capture of closures and the retain
marks (about 250), the sweep of block runs (about 120). Kept: the static
definitions and their types, `liveScopeOf` until step 2, the lazy-view
record (reduced to one activation in step 5), `homeChainBinding` for free
names, the tombstones of popped scopes that are not activations.

## 4. Hard cases

The four programs of the D6 table; a lazy view passed to an inner call that
returns a closure over it (`lazy-view-scope`); `hold mySum(body, bind i, n) =
Sum(body, (i, 1, n)); mySum(k^2, k, 3)` (14); a recursive function that
returns a closure (`mk(3)(0)` is 6); `Simplify(D(x^2 + a x, x))` is
`a + 2x` on both routes. All are tests in `test/compute-engine/
bound-once.test.ts` or in their own files.

## 5. Order of work

1. Activations as value records for scoped nodes on both routes: the value
   getter and setter of a definition of an activated scope read the record
   found on the links; delete `_cloneForActivation`, `inActivatedParent` and
   the template tombstones. About 120 lines added, 80 deleted.
2. The read of a binder variable or block local stops using the corrections
   of `bindingInContext` (the definition is the static one; only its value
   is looked up). About 150 lines deleted.
3. Call frames as activations of the body scope, closures holding their
   activation; delete the re-parenting and hiding in `makeLambda`. About 150
   deleted, 60 added.
4. Delete the capture of closures and the retain marks. About 250 deleted.
5. The lazy-view record as one activation. About 150 changed.
6. Delete `callerBinding`, the swept homes and the sweep of block runs.
   About 250 deleted.

These sizes are estimates.

## 6. Steps B and C: what the attempt showed (2026-11-12)

Measured in `/tmp/wt-compute-engine-06-main` at `b210c0035` with a temporary
edit, undone after. Values of "before" and "after" are probes of that tree.

### 6.1 The attempt

One read changed: `BoxedSymbol._contextBinding()` (`boxed-symbol.ts`). For
an occurrence whose definition reads an activation (`readsActivation()`) and
is already activated (`isActivatedDefinition()` of its value or operator
half), it returned the occurrence's own definition instead of
`bindingInContext()`. The value then comes from the activation record found
on the parent links from the current lexical scope (`activationRecordOf()`).
Nothing else changed: the frame parents (`definingScopeOf()` with
`liveScopeOf()`), the capture of closures and the lazy-view records stay.

Run: `bound-once`, `epsil/hold-functions`, `closure-frame-retained`,
`closure-block-locals`, `issue-489`, `ce-473`, `lazy-view-scope`, `scope`:
43 failures, of which 4 fail without the edit (`closure-frame-retained`
"dependent limit" ×2, `lazy-view-scope` 1, `scope` DECLARING). The 39 new
ones fall in three groups.

| Group | Tests | Smallest program | Before | After | Spec (section 2, D5, D6) |
|---|---|---|---|---|---|
| A. `bind` parameter of a `hold` function | 5 (`hold-functions` 3, `bound-once` D6 ×2) | `hold mySum(body, bind i, n) = Sum(body, (i, 1, n)); mySum(k^2, k, 3)` | 14 | `3k^2` | 14 (D6 table: "hold function with a `bind` parameter") |
| B. Closure made in an iteration of a loop, a big operator or a comprehension element, read after the binder ended | 32 (`closure-frame-retained` 16 ×2 debug) | `let h = (x) => x; for d in [3, 6] { if d == 3 { h = (x => x + d) } }; h(1)` | 4 | `d + 1` | 4 (D6: the function value keeps the link of the activation that made it) |
| C. Closure returned by a call that closes over a loop index of the call | 2 (`closure-frame-retained` ×2 debug) | `let b = (n) => do { let h = (xs) => xs; for d in [n, 2n] { h = (xs => ListFrom(Map(x => x * d, xs))) }; h }; b(3)([1, 2])` | `[6,12]` | `[d,2d]` | `[6,12]` |

Other programs of group B, before → after: the closure assigned in a
`Sum` (`g := x ↦ x + i` for `i` in 1..3, then `g(1)`) 4 → `i + 1`; the
closure assigned in a comprehension element (`let c = [do { h = (x => x +
d); 0 } for d in [3]]`, `h(1)`) 4 → `d + 1`; closures collected in a loop
(`let fs = []; for d in [1, 2] { fs = [...fs, (x => x + d)] }; [fs[1](0),
fs[2](0)]`) `[1,2]` → `[d,d]`. One program that does not break: closures
that are elements of a comprehension (`[(x => x + d) for d in [1, 2]]`)
stay `[1,2]`, because the comprehension substitutes the value of its index
into each element.

In every group the read finds no activation: the closure (or the held
operand) is evaluated where no activation that holds the definition is on
the parent links. Today `bindingInContext()` answers by name (A), from a
scope that the capture of the closure made (B, `captureAtCreation()` →
`captureNestedLocals()` / `snapshotNestedScope()`), or from the frame that
`captureClosures()` re-rooted the literal on (C).

### 6.2 The hold function with a `bind` parameter

Trace of `mySum(k^2, k, 3)` (probe: the read of `k` logged with the
definition it is bound to and the one `bindingInContext()` returns):

1. The call `mySum(k^2, k, 3)` is canonicalized as a binder: its `bind`
   position makes `k` its variable. The `k` of the held operand `k^2` is
   bound to that variable, `K_call` (a binder variable). By rule 1 and D5
   this is the right definition: the call node is the binder around the
   operand.
2. The call (`invokeWithBoundVariables()`, `function-utils.ts`) substitutes
   the NAME `k` for the parameter `i` in the body, every occurrence, and
   canonicalizes `Function(Sum(body, (k, 1, n)), body, n)` in the caller's
   scope. The `Sum` declares its own index, `K_sum`. The operand of `Sum` is
   the symbol `body`, not `k^2`, so D5's binding of a boxed operand does not
   reach `k^2`.
3. The body runs. `Sum` writes `K_sum` = 1, 2, 3 in its activation
   (`assignLoopIndex()`, by name, in the activation of the `Sum` node).
   `body` evaluates to the held `k^2`, whose `k` is `K_call`.
4. Today: `bindingInContext()` walks by name from the `Sum` activation, finds
   `K_sum`, and does not skip it because both are binder variables
   (`isForeignBinderBinding()`): 1 + 4 + 9 = 14. The log: 9 reads of `k`
   own `K_call` → `K_sum` with values 1, 2, 3.
5. Static read: `K_call` has a slot only in the activation of the call node,
   whose value is undefined: `3k^2`.

What would have to be true for the static read to give 14, and the costs:

- R1. The call binds the operand's variable to the definition the body's
  binder writes: `invokeWithBoundVariables()` substitutes the caller's
  DEFINITION, not its name, so the `Sum` of the reduced literal takes the
  binding record of `K_call` as its index instead of declaring `K_sum`. The
  `Sum` activation then holds a slot for `K_call`, its loop writes it, and
  `k^2` reads it. Cost: the substitution carries a binding, and the binder
  canonicalization accepts a given binding for its variable (about 20 to
  40 lines in `box.ts` / `canonicalizeBinder`). Removes the binder clause of
  `isForeignBinderBinding()` (33 lines with comments) and the binder
  exception of `callerBinding()`.
- R2. The held operand is evaluated in an activation that maps `K_call` to
  the value of `K_sum`: an alias slot pushed with the `Sum` activation for
  each bound variable. Cost: a second record kind ("this definition reads
  that one") and a link from the call to the binder that writes it: a new
  mechanism for one kind of symbol. Removes the same by-name read.
- R3. The call substitutes the held arguments too (the parameter `body` by
  `k^2` as written) when a `bind` parameter is present, so the reduced body
  is `Sum(k^2, (k, 1, n))`. The `Sum` is then a binder built around a boxed
  operand, and D5's existing rule (`bindBindingSites` post-phase) binds the
  `k` of `k^2` to `K_sum`. Cost: about 10 lines in
  `invokeWithBoundVariables()` (one more entry in `substitutions` for each
  held parameter). Reuses D5; removes the same by-name read. It changes one
  thing: a held parameter read outside the binder (`body + 1` in the same
  body) also has `K_call` in it, which already holds today.

Recommendation: R3. It adds no mechanism, it is the existing D5 rule
applied to the existing substitution, and `bind` already means "the name
the body uses as a bound variable" (`ApplyOptions.bindParameters`). Not
verified by a probe.

### 6.3 Closures made in a loop or a big operator

Program: `let h = (x) => x; for d in [3, 6] { if d == 3 { h = (x => x + d)
} }; h(1)`; the spec gives 4.

Why the static read breaks it: the closure is called after the loop ended.
The frame of `h(1)` has the parent `definingScopeOf()` gives, which is the
static loop scope or the scope that `captureNestedLocals()` made; neither is
an activation that holds `d`, so `d` has no value.

Step C alone does not fix it. A `Loop`, `Sum`, `Product` or comprehension
node pushes ONE activation per evaluation of the node
(`boxed-function.ts`, "Each evaluation of a scoped node is made in an
activation of its scope"), and `assignLoopIndex()` writes each iteration's
value into that one record. A closure that keeps the activation that made
it reads the LAST value: `h(1)` = 7 (deduced from the code, not measured).
Closures collected per iteration show it more plainly: `let fs = []; for d
in [1, 2] { fs = [...fs, (x => x + d)] }; [fs[1](0), fs[2](0)]` gives
`[1,2]` today and would give `[2,2]`.

So "evaluation" in D6 must mean "iteration" for a binder whose body runs
once per value of its variable: each iteration pushes an activation whose
record holds the variable's value, linked to the activation of the node
(which holds the locals of the node that are not per-iteration). The two
programs above decide it (4, and `[1,2]`).

### 6.4 One step or two

B cannot land without C: 39 tests and the acceptance program `mySum` fail.
C can land without B: a function value that keeps its activation, and a
frame whose parent is that activation, are read correctly by the existing
by-name read, which finds the static definition in the activation's
bindings and its value in the record.

Smallest sound first commit: per-iteration activations for the binders
that iterate, and C (a function value keeps the activation that made it; a
call's frame has that activation as parent; R3 for `bind`), with the reads
unchanged. Then B as a second commit (the static read), which then only
deletes. It removes, measured in the current tree (whole function with its
comment / body):

- With C: `captureClosures` 71/51 and `captureClosuresUncached` 221/221,
  `captureAtCreation` 40/8, `rerootOnCreatingFrame` 30/15,
  `captureNestedLocals` 110/70, `snapshotNestedScope` 95/81,
  `closeOverBlockRun` 43/43, `capturedRunOf` 35/7, `rerootCapturedLocals`
  21/16, `copyChainToLeaving` 67/44, `hideBodyScopeParams` 70/40,
  `restoreBodyScopeParams` 48/27, `enterAppliedBodyScope` and
  `exitAppliedBodyScope` 15, `definingScopeOf` 23/11 (it becomes the read
  of the function value's activation), `retainScope` 9 and
  `retainCallFrameOfResult` 92/67 (`lazy-view-context.ts`): about 990 lines
  with comments, minus what C adds (a field on the function value and its
  link at the call; the design estimates 60).
- With B: in `binders.ts`, the activation branch of `bindingInContext`
  (77/70, most of it), `callerBinding` 66, `sweptCallerBinding` 59,
  `sweptHomeBinding` 40, `sweptHomeOf` 3, `markSweptBinding` 24,
  `readsNoOtherBinding` 42, `isOutsideBindingOfBlockLocal` 49,
  `ownBindingInChain` 38, `homeInChain` 5, `isForeignBinderBinding` 33,
  `isOutsideBindingOfBinderVariable` 35, `activationBindingOf` 29,
  `scopeStandsFor` 22: about 520 lines; `liveScopeOf` (`ambient-chain.ts`,
  about 35) once nothing reads the stack.

These counts are of the functions as they stand; callers that become
simpler are not counted.

### 6.5 Where D6 as written is contradicted

- "Every evaluation of a function literal, of a binder and of a block makes
  an activation": for a binder that iterates, the programs of 6.3 need one
  activation per iteration, not per evaluation of the node.
- "A parameter, a binder variable and a block local are read by following
  these links": the `bind` program reads a definition (`K_call`) that no
  activation on the links holds; the loop writes another one (`K_sum`).
  D6 gives 14 only with a rule that makes the two the same (6.2), which D6
  does not state; D5 does not cover it, because the held operand reaches
  the `Sum` as the value of a parameter, not as a boxed operand.
- "There is no search of the stack of evaluations in progress": true of
  the reads after B, but today the frame's parent comes from
  `liveScopeOf()`, a search of the stack, until C gives the frame its
  parent from the function value.
