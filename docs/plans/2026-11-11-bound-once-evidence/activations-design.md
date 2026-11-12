# Activations (D6): design

Line counts are of the worktree at the end of Part A, measured with the
TypeScript parser (whole function, comments included). Paths are under
`src/compute-engine/`.

## 1. What exists

The value of a parameter, a binder variable or a block local for one
evaluation is held in four kinds of structure, and found by a walk of the
scope chain from the current lexical scope with several corrections.

- **Call frame.** `makeLambda` (`function-utils.ts`, 1,812 lines in all)
  makes a fresh scope per call whose parent is the scope where the literal
  was defined, declares the parameters in it, marks each parameter binding as
  an activation of the body's static binding (`markActivation`,
  `binders.ts`, 6), and re-parents the body scope onto the frame for the
  call (`bodyScope.parent = freshScope`, restored at the end;
  `hideBodyScopeParams` 39 and `restoreBodyScopeParams` 27 take the
  valueless parameter bindings out of the body scope meanwhile). Sync,
  async and the compiled fallback all go through it.
- **Scope activation.** `asyncScopeActivation` (`boxed-function.ts`, 26)
  copies the bindings of a scoped node (a `Sum`, a `Block`) with
  `_cloneForActivation` and registers the copy against its template
  (`registerScopeActivation`, `ambient-chain.ts`, 4). `liveScopeOf` (12)
  finds the innermost activation of a template on the stack. The async
  route makes one per evaluation; the sync route makes one only when the
  parent already has one (`inActivatedParent`, 6).
- **Block run.** `sweepCanonicalizationBindings` (`library/control-structures.ts`,
  93) removes the canonicalization bindings of a block at the start of a run
  and marks them swept (`markSweptBinding`, 9; `sweptHomeOf`, 3);
  `closeOverBlockRun` (`function-utils.ts`, 43) and `capturedRunOf` (7)
  record the locals of a run that a closure keeps.
- **Captured scopes of a closure.** `captureClosures` (51),
  `rerootOnCreatingFrame` (15), `captureNestedLocals` (67) and
  `snapshotNestedScope` (57) (`function-utils.ts`) re-root a function value
  that leaves its call on a copy of the frame and of the nested scopes in use;
  `retainScope` (3) and `retainCallFrameOfResult` (67,
  `lazy-view-context.ts`) keep the pop of such a frame from disposing it.
  Lazy views record the context stack and the bindings of the nested scopes
  at their creation (`recordLazyViewContext` 17, `recordAt` 33,
  `snapshotScopes` 20) and replay it when they are enumerated.

The read: `bindingInContext` (`binders.ts`, 83) walks the static parents
through `liveScopeOf`; when it finds a binding that is not the occurrence's
own, it tries `callerBinding` (26, with `ownBindingInChain` 25 and
`sweptCallerBinding` 27), `sweptHomeBinding` (21) and `readsNoOtherBinding`
(21), and skips foreign binder bindings (`isForeignBinderBinding` 9,
`isOutsideBindingOfBinderVariable` 12). `scopeStandsFor` (11) follows
`markCallableFrame` and activation templates. The debug check
`activationBindingOf` (21) repeats part of the walk. `readsActivation` (13)
decides which occurrences use this read; the others use `homeChainBinding`
(24).

## 2. The rule as a mechanism

An activation is a scope object made for one evaluation, with a link to the
activation in which its node was evaluated. The existing scope activation
(`asyncScopeActivation`) becomes the one structure, made on every route:

- **Function call:** the call frame is the activation of the body scope; its
  link is the activation that the function value holds (below), not the
  defining scope and not the caller. The body scope is no longer re-parented
  and its parameters are no longer hidden.
- **Binder and block:** each evaluation of a scoped node makes an activation
  of its scope whose link is the activation of the enclosing node in the
  evaluation in progress: the activation in which the node itself is being
  evaluated, passed down by the evaluation (the current lexical scope at the
  push), not found by a search.
- **Function value:** evaluating a `Function` literal gives a closure that
  holds the current activation as its link. A call uses that link. This
  replaces re-rooting and snapshots: the activation is a plain object kept
  alive by the closure.

A read of a parameter, binder variable or block local starts at the
activation of the evaluation in progress and follows links until it finds an
activation whose template is the definition's scope; the value is the
binding there. Every other occurrence keeps the home rule. The asynchronous
routes capture the activation at the point where they suspend (they already
carry `_contextStack`; it becomes the current activation only).

## 3. What it deletes and keeps

Deleted, about 700 lines: `callerBinding` with `ownBindingInChain` and
`sweptCallerBinding` (78), `sweptHomeBinding`, `sweptHomeOf`,
`markSweptBinding` and most of `sweepCanonicalizationBindings` (about 120),
`readsNoOtherBinding` (21), `isForeignBinderBinding` and
`isOutsideBindingOfBinderVariable` (21), `scopeStandsFor` and
`markCallableFrame` (18), `activationBindingOf` (21), `inActivatedParent`
(6), the re-parenting and hiding in `makeLambda` with
`hideBodyScopeParams`/`restoreBodyScopeParams` (about 100),
`captureNestedLocals`, `snapshotNestedScope`, `rerootOnCreatingFrame` and
`closeOverBlockRun` (about 180), and the retain marks
(`retainCallFrameOfResult`, about 70). Kept: `liveScopeOf` (as the search is
gone, it reduces to reading the current activation), `_cloneForActivation`
(an activation still copies the static bindings), the lazy-view record (a
view must still evaluate in the activation that made it; its record becomes
one activation instead of a stack slice and snapshots), the debug tombstones
(an activation is never disposed while a closure holds it, so they only
check reads of popped non-activation scopes), and `homeChainBinding` for
free names.

## 4. Hard cases

1. `add(a) := x ↦ x + a; g := add(2); h := add(10); g(1), h(1)` gives 3, 11:
   each closure holds the call activation of `add` that made it.
2. `kk(a) := g(1); kk(100)` gives 3: `g`'s `a` is read through `g`'s link,
   never through the caller `kk`.
3. `fact(n) := If(n ≤ 1, 1, n·fact(n−1)); fact(5)` gives 120: each call has
   its own activation; the link of each is `fact`'s defining activation.
4. `Block(s = 0, Loop(Block(s = s + i), i in 1..4), s)` gives 10, also
   async and two at a time: the inner block's activation links to the
   outer block's activation of this run, so the write of `s` lands there.
5. `lazy-view-scope`: `h2 := v ↦ (() ↦ ListFrom(v)); gA := (d, xs) ↦
   h2(Map(x ↦ d·x, xs)); Apply(gA(10, [1, 2]))` gives `[10, 20]`: the view
   holds the activation of `gA` that made it, the closure holds the
   activation of `h2`; neither is the innermost on the stack at the call.
6. The three `hold-functions` `bind` tests: `hold mySum(body, bind i, n) =
   Sum(body, (i, 1, n)); mySum(k^2, k, 3)` gives 14. The held `k^2` was
   boxed by the caller with `k` bound to the call node's variable; the `Sum`
   built in the body declares its own `k`. Under D5 the `Sum` does not
   capture the held body, so the `bind` mechanism must build the `Sum` from
   the raw form of the body (as D5 says for engine code), or the call node's
   `k` activation must be the link of the `Sum`'s activation. This is the
   case most likely to need a decision.
7. `mk(n) := If(n = 0, () ↦ 0, (k ↦ () ↦ k + mk(n−1)())(n)); mk(3)()`: a
   recursive function that returns a closure; each closure must hold the
   activation of its own call, and the debug check must not report the
   activations of finished calls.

## 5. Order of work

1. Make every evaluation of a scoped node push an activation linked to the
   current activation, on the sync route too (async already does); keep the
   old reads. About 60 lines changed in `boxed-function.ts` and
   `engine-scope.ts`; measure the time of `calculus` and `simplify`.
2. Make the read of the C1 kinds follow links from the current activation
   (replace the body of `bindingInContext` for them); keep the corrections
   as dead code behind a debug comparison for one run. About 80 lines.
3. Give a function value its activation link and make a call use it;
   delete the re-parenting and hiding in `makeLambda`. About 150 lines
   deleted, 50 added; the closure and recursion tests decide it.
4. Delete the capture of closures and the retain marks (`captureNestedLocals`
   and the rest); the closure holds its activation. About 250 lines deleted.
5. Rewrite the lazy-view record as one activation. About 150 lines changed.
6. Delete `callerBinding`, the swept homes and the other corrections. About
   250 lines deleted.

Each step keeps the 423 files green if the old reads stay until the new read
covers them; step 3 is the one most likely to need more than one round.
These sizes are estimates.

Conclusion: an activation per evaluation, linked to the activation the node
was evaluated in, with a closure holding its link, replaces five correction
mechanisms (caller binding, swept homes, re-rooting and snapshots of
closures, retain marks, the narrow rules). Expected net removal is about 600
lines. The case that needs a decision first is the `bind` parameter of a hold
function (case 6), because D5 stops the `Sum` in its body from capturing the
held operand.
