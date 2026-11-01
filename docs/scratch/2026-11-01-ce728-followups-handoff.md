# Follow-ups of CE-728 (lazy callback views read in their creation context)

CE-728 makes a lazy callback view (an operator whose collection handlers set
`callsCallbackOnRead`: `Map`, `Filter`, `Scan`, `TakeWhile`, `DropWhile`,
`FlatMap`, `Tabulate`, `Iterate`, `Fill`) that a function call creates read in
the context of that call. The design is in the header of
`src/compute-engine/boxed-expression/lazy-view-context.ts` and in
`docs/plans/2026-10-31-parameter-default-values.md`, §11 item 6. Tests:
`test/compute-engine/lazy-view-scope.test.ts`.

The work found these defects in older code. Each one is a task of its own,
with its own dual review. None needs a user decision. With `f := (x, k = d) =>
x * k` in each example:

1. **The asynchronous numeric evaluation of a returned view reads the default
   in the reader's context.** With `g := (d, xs) => Map(f, xs)`,
   `await ce.box(['g', 10, ['List', 1, 2]]).evaluateAsync({ numericApproximation: true })`
   gives `Map(Function(Block(NumericApproximation(f(_1, d)))), [1, 2])`, read
   as `[d, 2d]`; `evaluate()` gives `[10, 20]`. The behavior is the same
   without the CE-728 change. Likely cause, not verified: the view gets its
   record from a stack that does not hold the call frame, because an awaited
   call pushes its frame on its own copy of the stack. Start at
   `BoxedFunction.evaluateAsync` (`contextStackAtStart`).
2. **A closure reads the disposed frame of the call that returned it.** With
   `ce._debugBindings = true`, `o1 := d => (xs => ListFrom(Map(f, xs)))`,
   `o1(7)([1, 2])` throws "The binding of "d" belongs to the discarded scope
   "call"". Without the debug flag the value is right, because a disposed
   definition keeps its value. Cause: closure capture shares `scope.bindings`
   with the frame (`copyChainToLeaving`, the closure re-rooting in
   `function-utils.ts`). The test "a view made in a closure that a call
   returns" of `lazy-view-scope.test.ts` fails with `CE_DEBUG_BINDINGS=1`
   because of this defect.
3. **`ListFrom(FlatMap([1, 2], fm2))` stays unevaluated** with
   `fm2 := x ↦ [x, x]`, at the top level (reported by session
   compute-engine-e4).
4. **`Assign` of a shared tuple costs about twice as much per level.** A body
   `Block(a0 := xs + 1, a1 := Tuple(a0, a0), …, a22 := Tuple(a21, a21), a22)`
   applied to `(10, [1, 2])` takes about 0.7 s, 190 ms at depth 20, with or
   without a lazy view. A profile puts most of the time in
   `listedAssignedValue` (`src/compute-engine/library/core.ts`).

Known limits of CE-728, written in the header of `lazy-view-context.ts`: a view
that leaves a call by a way the retention walk does not follow (host code that
keeps it) does not keep the frame of the call alive; its later read gives the
values of the call, from disposed definitions.

## State, 2026-11-01 (session compute-engine-94)

All four items above are fixed and dual-reviewed (Claude and Codex).

- Items 3 (FlatMap) and 4 (Assign memo) are STAGED, queue entry
  `compute-engine-94`: `src/compute-engine/library/collections.ts`,
  `src/compute-engine/library/core.ts`,
  `test/compute-engine/flatmap-named-callback.test.ts`,
  `test/compute-engine/assignment-stores-lazy-collection.test.ts`,
  `CHANGELOG.md`.
- Items 1 (async numeric view) and 2 (closure frame) are in the main tree,
  NOT staged: the queue had a peer (`compute-engine-fb`) waiting after the
  first set. Files: `src/compute-engine/function-utils.ts`,
  `src/compute-engine/engine-scope.ts`,
  `src/compute-engine/boxed-expression/lazy-view-context.ts`,
  `src/compute-engine/boxed-expression/evaluation-epoch.ts`,
  `test/compute-engine/lazy-view-scope.test.ts`,
  `test/compute-engine/closure-frame-retained.test.ts`, the two new CHANGELOG
  entries, and ONE hunk of `src/compute-engine/boxed-expression/boxed-function.ts`
  (the rest of that file is a peer's work). The hunk to stage is in
  `/private/tmp/claude-501/-Users-arno-dev-compute-engine/7485b443-8a25-4348-bad8-28fad906c407/scratchpad/f1-boxed-function.patch`
  (`git apply --cached` it).
- Full suite on the combined tree: 76039 passed, exit 0 (peers wrote during
  the run).

Follow-ups found in older code (session compute-engine-94):

- a, b, c, e: DONE, dual-reviewed, applied in the main tree, NOT staged
  (they wait with items 1 and 2 behind the queue). a: closures made in a
  loop, block, comprehension or big operator keep their scope alive; no false
  report for a recursive call that runs the same loop. b: the async broadcast
  runs in the evaluation context. c: consumers list a `FlatMap` of unknown
  finiteness (`listedFlatMapView`). e: a closure that a comprehension element
  assigns outward captures the index. Three tests that keep an expression
  after `popScope()` turn the debug check off (test-only change).
- d: DONE (3 review rounds; the fixes of round 3 had no review), applied in
  the main tree, NOT staged. A lazy view stored outside the loop iteration or
  block that made it reads the values of that iteration
  (`bindOutlivedLocalsOfLazyValue`, called by every `Assign` route; rule in
  `docs/SCOPING-MODEL.md`).
- Gates on the combined tree (2026-11-01): typecheck PASS, check:deps PASS,
  oxlint PASS. Full suite under the box lock (load 5.6 at acquire,
  fingerprint unchanged): 19 failures in 12 files. 18 of them come from peers'
  uncommitted work: they pass in a worktree with HEAD plus my changes only.
  The 19th (`effects-registry.test.ts`, the audit of nested `evaluateAsync`
  options) was mine and is fixed (`_effects` named in
  `listedFlatMapViewAsync`).
- To stage the second set, after the user commits the first one: run
  `staging-queue.mjs enqueue compute-engine-94:closure-async` again with every
  file below, then `stage-helper.mjs prepare/stage` for every file except
  `boxed-function.ts`, and `git apply --cached` the patches named in the next
  item for `boxed-function.ts`. Files: `src/compute-engine/function-utils.ts`,
  `src/compute-engine/engine-scope.ts`, `src/compute-engine/collection-utils.ts`,
  `src/compute-engine/boxed-expression/lazy-view-context.ts`,
  `src/compute-engine/boxed-expression/evaluation-epoch.ts`,
  `src/compute-engine/library/collections.ts` (unstaged part),
  `src/compute-engine/library/core.ts` (unstaged part),
  `src/compute-engine/library/arithmetic.ts`,
  `src/compute-engine/library/control-structures.ts`, the tests
  `lazy-view-scope`, `closure-frame-retained`, `async-broadcast-call-context`,
  `flatmap-unknown-finiteness-consumers`, `flatmap-named-callback` (unstaged
  part), `parameter-default-values`, `compile-user-function-definition-scope`,
  `ce-498-detached-loop-index`, and the markdown `CHANGELOG.md`,
  `docs/SCOPING-MODEL.md`, this file.
- `boxed-function.ts` in the main tree holds a peer's hunks. My hunks are
  exactly: the base hunk `f1-boxed-function.patch`, then `b-delta.patch`,
  then the boxed-function parts of `a-final.patch` and `c-final.patch` (`a-boxed.patch`, `c-boxed.patch`)
  (all in the scratchpad above); stage them with `git apply --cached` in
  that order.

Queued follow-ups (older code), not started:

- `Count(FlatMap([1, 2], x ↦ (x, slowF)))` stays unevaluated: the listing
  helper declines when the callback holds an async-only symbol, also as data.
- About 30 other consumers still decline on a `FlatMap` of unknown finiteness
  (`Mean`, `Sort`, `Union`, `Reverse`, ...); census in the task c report.
- A decline of the `FlatMap` evaluate handler after its callback ran can make
  the generic materialization apply the callback a second time (not
  measured).
- `comprehension-memo.test.ts` "a comprehension reading the symbol at every
  index runs the chain once" fails at HEAD with `CE_DEBUG_BINDINGS=1` (the
  host reads a lazy comprehension after its scope was popped).
- With `CE_DEBUG_BINDINGS=1`, 11 tests in `ce-603-map-chain-element-evaluated-once`,
  `comprehension-memo`, `integrate-limit-user-function-capture`,
  `lazy-operator-eager-source` fail in the base (dead bindings in a `Sum` or
  `Integrate`).
- From task d: `evaluate()` then `evaluateAsync()` of a `Sum` with a block
  body throws under `CE_DEBUG_BINDINGS=1` ("binding of k belongs to the
  discarded scope anonymous_1"), probably the cause of the 11 base failures;
  shared tuples inside a loop take exponential time (depth 14: 3.0 s, depth
  16: 7.7 s), because each occurrence of a view is copied; a symbol default
  filled by name from a top-level loop gives a free `d`
  (`let f = (x, k = d) => x * k; for d in [3, 6] { if d == 3 { h = Map(f, Range(1, Infinity)) } }`
  gives `[d, 2d]`); indexed targets (`a[i] = view`) and sequence routes of
  `Assign` do not apply the rule.
- A field store inside an arrow function does not reach the caller's object:
  `type Box = object{v: any}; let o = Box(v: []); let g = (p, i) => { p.v = [i] }; g(o, 3); o.v`
  gives `[]`; the same store in a named function gives `[1]`.
- `Filter` with its operands in the wrong order prints "Assertion failed"
  messages: `ce.box(['Apply', ['Function', ['Add', 1, ['Filter', ['Function', ['Greater','x',0],'x'], 'xs']], 'xs'], ['List',1,4]]).evaluate()`.
