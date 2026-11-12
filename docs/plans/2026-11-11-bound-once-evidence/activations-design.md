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
