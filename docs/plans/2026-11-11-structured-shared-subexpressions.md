# Structured route: shared subexpressions

**Status: design, not approved. It answers `issues/CE-1198.md` for the
`numeric-kernel` profile of the [JavaScript compiler plan](2026-11-09-js-compiler-status-and-plan.md)
("What blocks retirement beyond coverage"). The choices marked "choice" can
be reversed.**

A boxed expression is a DAG: one node object can be an operand of several
parents. The structured route lowers a node once per path, so a DAG of depth
`d` costs `2^d` in time and in code. The change: a node object reached again
in the same scope, in a region where its first lowering is visible, gives the
value of that first lowering when the value is pure.

## Measurements

Probes in the session scratchpad (`design-sharing/probe-phases.ts`,
`probe-proto.ts`), on `29ee7c0f7aa216b3c5bf05b125393ef6b4a5828c` with the
uncommitted `Sum`/`Which` edits of another session in the tree. Times in ms,
one run, code in characters. The phases are those of `StructuredRouteHooks`
in `javascript-fragment-target.ts`; "emission" includes `analyzeExecution()`,
which `bodyEmitter()` runs between the two clocks. Root `Floor(e_d)`,
`e_0 = x + 1`, `x` declared `real`.

| shape, d | annotation | lowering | verification | emission | route total | route code | existing default | existing `cse: false` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Add(e, e)`, 10 | 5.4 | 0.9 | 4.8 | 7.6 | 19.9 | 12,295 | 2.1 / 312 | 44.3 / 10,249 |
| `Add(e, e)`, 12 | 15.3 | 4.5 | 21.2 | 20.7 | 63.5 | 49,159 | 1.3 / 376 | 118 / 40,969 |
| `Add(e, e)`, 14 | 37.3 | 11.4 | 74.1 | 126.2 | 253.7 | 196,615 | 1.3 / 440 | 272 / 163,849 |
| `Arctan2(e, e)`, 14 | 32.9 | 11.5 | 83.0 | 133.9 | 268.0 | 344,062 | 1.2 / 594 | 282 / 344,062 |
| `If(x > k, e + 1, 2e)`, 10 | 15.9 | 3.9 | 18.6 | 26.4 | 66.8 | 31,731 | 166 / 37,871 | 56.8 / 37,871 |
| `If(x > k, e + 1, 2e)`, 12 | 53.6 | 10.6 | 68.4 | 136.6 | 272.9 | 126,966 | 1,942 / 151,538 | 186 / 151,538 |
| `If(x > k, e + 1, 2e)`, 14 | 182.4 | 25.0 | 260.7 | 626.5 | 1,105 | 507,906 | 41,508 / 606,206 | 599 / 606,206 |

The existing compiler with `cse: false` (also with `constantFold: false`:
248 ms, same code at `Add`, 14) is exponential in time and code. With its
defaults it is linear when the sharing is in one region, and its time grows
12 to 21 times per two levels when the shared node is in both arms of an
`If`. At depth 16 the route fails with "Maximum call stack size exceeded" in
`closedRegion()` (`probe-overflow.ts`).

A prototype (a scratchpad copy of `javascript-structured-lower.ts` with the
memo below, `proto/lower-shared.ts`), root `e_d` without `Floor`:

| shape | d | lowerings / memo hits | lowering | code | values |
| --- | --- | --- | --- | --- | --- |
| `Add(e, e)` | 40 | 43 / 40 | 0.1 | 903 | = unshared route, d 2 to 12 |
| `Sin(e) + Cos(e)` | 40 | 123 / 40 | 0.3 | 1,703 | = unshared route and existing `cse: false` |
| `Add(e, If(x > k, e, 1))` | 40 | 162 / 121 | 0.1 | 1,551 | = both |
| `If(x > k, e + 1, 2e)` | 16 | 405,498 / 315,390 | 330 | 1,900,605 | = both; still exponential |

Admission and annotation (`prepareStructured()`) took 1.2 to 2.5 ms at
depth 40 for these roots: the cost of the annotation in the first table
comes from the rule of `Floor`.

## Where the cost arises

- **Admission** (`prepareFragment()`): `checkNode()` keeps a `seen` set,
  once per node. **Typing** (`typeFragment()`, `fragment.ts`): `walker.type()`
  stores facts in `scope.facts` per (node, scope) and returns them on a second
  visit; `symbolNames()` and `capturedName()` remember nodes. At depth 16 the
  root scope holds 20 facts. These are linear.
- **The rule of `Floor`**: `inexactJumpConstant()` visits every path of its
  operand and calls `node.unknowns` at each visit; `unknowns`
  (`abstract-boxed-expression.ts`) has a memo for one call only. A CPU profile
  at `Add`, 14 puts 111 of the 115 ms of annotation there.
- **Lowering** (`Lowering.value()`): no memo. Each call appends new
  operations, so a node reached on `p` paths is `p` copies. `namesIn()`
  (used by `block()`, `statements()`, `exposedReads()`) walks every path too.
  `closedRegion()` spreads all operations of a region into `joinEffects(...)`,
  which overflows the stack near 2^17 operations; `ifStatement()` spreads
  `condition` the same way.
- **Verification, emission, in-place and execution analyses**
  (`verifyProgram()`, `emitStructuredProgram()`, `analyzeInPlace()`,
  `analyzeExecution()`) are linear in the operations; they inherit the count
  of the lowering and need no change.

## The rule

Two occurrences of one node object lower to one value when all of these hold:

1. **Same node object and same fragment scope.** The key is identity, because
   the facts, the effect (`StructuredPreparation.effects`) and the form
   (`forms`) are keyed by node object: one object in one scope has one set of
   facts by construction. Structural equality (`isSame()`, the hash buckets
   of `cse.ts`) would also merge `sin(x) + sin(x)` as parsed (two objects:
   `probe-sym.ts`); it needs a hash of every node, a bounded verification per
   bucket, and a proof that two equal nodes have equal facts and forms. It is
   an optimization (step 8 of the plan), not a fix of compile time.
2. **Visibility.** The first lowering is recorded in the region whose
   operations it appended to. A later occurrence finds it only from that
   region or from a region nested in it (a branch, an `and`/`or` operand, the
   body of a `build`), opened after the definition. A value defined in a
   branch is not visible in the other branch or after the `if`. This is the
   rule of the verifier ("used only in the region of its definition and the
   regions nested in it", `structured-verify.ts`), so a lowering that broke it
   fails verification as an internal error; it cannot give a value.
3. **Same bindings.** A node reads locals and carried values through
   `Lowering.bound`. The memo entry holds the binding epoch, a counter that
   each change of `bound` increments (a `Declare`, an `Assign`, the merge of
   an `if`, entry and exit of a loop or a `build`, `restore()`, the
   parameters of a helper). An entry of another epoch is not used (choice).
4. **Pure and cannot abort.** Every operation that the lowering of the node
   appended has the effect `pure`, and none can abort (`operationCanAbort()`,
   `structured-ir.ts`). An operand found in the memo is earlier and already
   passed the test. A test operation declared impure, a call of a helper
   whose body loops under an iteration budget, and anything `unknown` are
   lowered again at each occurrence. In the compile mode `bigint`, an
   operation that aborts with `no-value` or `error` from its own operands
   (`OperationBase.aborts`: a pole, the size limit, an `exact` quotient with
   a remainder) is shared too, where the first lowering dominates the reuse:
   the reuse aborts exactly when the first did (choice C3 of
   [2026-11-11-structured-bigint-mode.md](2026-11-11-structured-bigint-mode.md),
   `javascript-structured-bigint.ts`). An abort of an iteration budget is
   still excluded: its counter depends on the passes. The double and the
   complex modes have no such operation, so the rule is the same there.

Why this changes no value. A pure operation of the route applied to the same
operand values gives the same double; the first occurrence dominates the
second, so on every path that reaches the second use the first evaluation has
run, and a throw there (`replace-at` out of range) ends the call in both forms.
The iteration budget counts the passes of all loops of a call
(`loopPassResetCall()`, `compile-loops.ts`), so sharing a value that can abort
would run a loop fewer times than the program does, which `IRLoop` forbids;
condition 4 excludes it. `Random` is declined by the profile.

Facts that depend on the context:

- **Conversions** are facts of the parent (`FragmentValueFacts.conversions`)
  and `convert()` applies them after `value()`. The memo holds the value
  before conversion; each use edge converts it, so two complex uses of one
  real value make two `convert` operations (choice C3).
- **A name in several scopes** (a helper parameter `x` and an input `x`, an
  index) is a different key, because the scope is part of the key.
- **A helper body** is lowered once per program (`helper()`, `functionIndex`)
  in its own scope; the stack of open regions starts empty in it, as
  `this.loops` does, so nothing of the caller is visible.
- **A loop body** is typed in the scope of its loop, so a body node never
  finds an entry of the enclosing scope, and a carried value changes the
  epoch. Each pass of the widening of `loopStatement()` makes a new body
  region, and the entries of a discarded pass are never visible again.
- **A staged region** (`condition` in `ifStatement()`, which is pushed or
  dropped after the branches) has its own entries; they are not visible in
  the branches nor after the `if` (choice C2: merge them when pushed).

## How each pass avoids the repeated walk

- **Lowering**: in the `Lowering` instance, a stack of open regions (the
  `IROperation[]` of each) and, per region, `Map<Expression, Map<scope,
  {value, epoch}>>`. `value()` looks from the innermost region outward,
  and records after lowering when conditions 3 and 4 hold. Each site that
  creates a region (`If` and `And`/`Or` values, `build()`, `ifStatement()`,
  `loopStatement()`, `helper()`, and the regions of the `Sum`/`Which` code in
  progress) opens and closes it explicitly (choice C2). The memo dies with the
  instance (one per `lowerStructuredProgram()`).
- **Admission**: `inexactJumpConstant()` remembers its verdict per function
  node (the parent only matters for a number leaf). `namesIn()` gets a
  per-instance memo. The two spreads become loops.
- **Typing, verification, emission**: nothing new. With one value of several
  uses the emitter binds a `const` ("Every other value binds a `const`",
  `javascript-structured-emit.ts`), and `analyzeInPlace()` sees every use of a
  shared list, so it does not write it in place while another use follows.
- **Rewritten trees**: the rewrites of `prepareCompilation()`
  (`javascript-target.ts`) run before admission, and every table of the route
  keys on the prepared nodes, so a new node is a new key: correct, only not
  shared. `rewriteAngularUnit()` keeps sharing with a memo
  (`symbolic/angular-unit.ts`); the other three rewrites have memos (seen by
  search, not read). Its canonical rebuild flattens nested `Add`s: in degree
  mode `Add(e, e)` over `Sin(x)` has 65,536 operands at depth 16
  (`probe-deg.ts`), before both compilers; not in this change.

## The contract on doubles

Sharing a pure value leaves each double of the route as it is: in the
prototype, shared and unshared give `Object.is`-equal values for the four
shapes at depths 2 to 12. The tests compare:

- values with the unshared copy of each shape (`unshare()` of
  `compile-cse-shared-subtrees.test.ts`), and with the existing compiler with
  `cse: false, constantFold: false` for the shapes without nested `Add`;
- the size: `Floor(e_40)` of `Add(e, e)` under `60 · d` characters and
  `Sin + Cos` at depth 30 under `80 · d`, the bounds of that test file; the
  time ceiling only under `CE_PERF=1`, as there;
- an impure test operation (`testOperations`, `trace`) reached twice runs
  twice, and a pure one in both arms of an `If` runs once per call;
- a helper with a budgeted loop called twice through one node object counts
  both calls against the budget;
- `a = x; y = f(a); a = a + 1; z = f(a)` with one object for `f(a)` reads the
  new `a`.

`Add(e, e)` is not compared with the existing compiler: both forms of the
route already differ from it (see "Defects seen").

## Not in the change

- **Structural CSE** of equal, distinct nodes: an optimization, step 8, with
  the costs named in rule 1.
- **Hoisting out of branches**: a node used in both arms of an `If` is
  evaluated on every path and could move before the `If`, but that needs an
  analysis of every arm (the existing compiler does not do it either). The
  `If` shape stays exponential, as in the existing compiler; the operation
  cap below bounds it.
- **Hoisting out of loops, and reordering**: a body value that does not read
  the index runs once per pass, as the program says; moving it changes how
  often it runs and needs the effect facts of objective 3. The memo only
  skips a second lowering; the order of operations stays.

## The shadow measure

Sharing alone does not allow removing `pathCountAbove()` and
`SHADOW_MAX_PATHS` (`compile-expression.ts`): the `If` shape stays
exponential. With a cap on the operations of the lowering, which declines
with `outside-profile` (reason `limit`; `inPhase()` must pass it through, not
make it an internal error), the work is bounded and the skip can go (C4).

## Slices

1. **Linear admission and no spread.** `inexactJumpConstant()` memo,
   `namesIn()` memo, the two spreads. Test: `prepareStructured()` of
   `Floor(e_40)` for `Add`, `Arctan2`, `Sin + Cos` finishes, and the facts
   are those of the tree walk at depth 5.
2. **The lowering memo**, with explicit regions and the epoch. Tests: those
   of "The contract on doubles"; `compile-cse-shared-subtrees.test.ts` shapes
   with `profile: 'numeric-kernel'`; the route tests, core suite and type
   check; the full suite with `CE_JS_PROFILE=numeric-kernel` (the engine's own
   compilations reach the route).
3. **The operation cap**, its decline, and the removal of the shadow skip.
   Tests: the `If` shape at depth 20 declines with the cap message in bounded
   time; `compile-cse-shared-subtrees.test.ts` with `CE_JS_PROFILE_SHADOW=1`
   returns. Then CE-1198 is `fixed`.

## Open choices

- **C1, validity of an entry**: the epoch (recommended: simple, sound, loses
  sharing only across statements). Alternative: record the values of the
  names the node reads and compare them at the hit; it keeps sharing across
  a write of an unrelated local, at a cost per hit.
- **C2, regions**: opened and closed at each site (recommended; staged
  `condition` entries merge into the enclosing region when it is pushed).
  Alternative: the prototype's form, which treats the array of each nested
  `value()` call as a region; shorter, but a staging site is implicit.
- **C3, conversions**: one `convert` per use (recommended). Alternative: a
  memo of (value, conversion) per region.
- **C4, the bound**: an operation cap of 100,000 in the lowering
  (recommended; at 405,498 operations the prototype took 1.6 s for lowering,
  verification and emission, so 100,000 is about 0.4 s, an estimate).
  Alternative: keep the path skip and only fix the time of shared regions.
- **C5, whether to do slice 2**: CE-1198 has a `crafted` witness, for which
  `AGENTS.md` asks for a decline. Recommended: do it, because retiring the
  existing emitter would turn the 1 ms linear compilation that
  `compile-cse-shared-subtrees.test.ts` pins into an interpreter fallback.
  Alternative: slices 1 and 3 only, and that test expects a decline.

## Result

Implemented on `6ebc2b1574cd75487533e999288fe7339ea71228`, the recommended
option of each choice (C1 epoch, C2 explicit regions, C3 one `convert` per
use, C4 a cap of 100,000, C5 slice 2 done). Tests:
`test/compute-engine/compile-javascript-structured-sharing.test.ts`.

- **Slice 1.** `inexactJumpConstant()` remembers the verdict of each
  function node and asks `hasUnknownsWithMemo()` with one memo per call in
  place of `node.unknowns` at each visit. `namesIn()` takes a memo, held by
  the `Lowering` instance (`namesOf()`) and passed to `exposedReads()`. The
  spreads of `closedRegion()` and of the two `push(...condition)` of
  `ifStatement()` are loops.
- **Slice 2.** `Lowering.value()` is the memo; the former body is
  `lower()`. `inRegion()` opens a region at each site: the root,
  the branches of an `If` value, each operand after the first of `And`/`Or`,
  the body of a `build`, both branches of `conditional()` (so `selection()`
  and the guard of `aggregate()`), the body of the `loop` of `aggregate()`,
  the condition and each branch of `ifStatement()`, each pass of the body of
  `loopStatement()`, and the body of a helper, which starts with an empty
  stack. `value()` fails when it is asked to lower into an array that is not
  the innermost open region, so a site without a region is an internal
  error, not a wrong value. The epoch is a number given once
  (`changed()`, from a monotonic count) at each change of the values: by
  `Declare`, `Assign`, the merge of an `If` statement, `restore()`, the
  parameters of a loop pass and the results of a loop, the index of a
  `build`, each index binding of `aggregate()` (so each written-out term of
  a `Sum` lowers its body again) and the parameters of a helper. A
  `build`, an aggregate and a helper bind the names of their own scope
  only; `inScope()` gives the epoch of before back after them when no value
  of a scope outside theirs was written (each write of a binding notes its
  scope, `wrote()`, in O(1) per open `inScope()`; `restore()` brings back a
  snapshot of the same statement and is not a write), and removes the
  values of their scope after them. A comparison of every binding at each
  exit was quadratic: 3,000 sibling sums took 1 s, now 0.25 s. So a node
  that contains a `Sum` is remembered and a value lowered before it is
  shared after it. An entry recorded during them has an epoch that is never
  current again. The written-out terms leave the index bound to the last
  literal; no node outside the aggregate reads a name of its scope, and a
  second lowering of the aggregate binds the index again first. The sites of that base lower in the region where their
  node is: the factors of `realProduct()` and `multiplyByRational()` and
  the parts of a quotient factor go through `value()`; a quotient factor
  itself does not, so a quotient reached twice keeps both divisions, in the
  order of the existing code. The literal fold of `Power` and `Root` is the
  lowering of its node, remembered as any other, and a root `Block` is
  lowered by `block()`.
- **Slice 3.** `newValue()` throws `StructuredLimitError` past
  `STRUCTURED_OPERATION_LIMIT` values (one per operation result); with the
  profile, `inPhase()` makes it the decline `outside-profile` "the program
  has more than 100000 operations, the limit of the profile". The path skip
  of the shadow measure (`pathCountAbove()`, `SHADOW_MAX_PATHS`) is removed;
  its try/catch stays.

Where it differs from the note:

- **Leaves are not remembered.** A symbol or a number is lowered at each
  use: its lowering is one operation, and remembering an input read would
  bind it to a `const` where the emitter writes `_.x` at each use, so every
  program in which a symbol object appears twice would change its code.
- **A staged condition is not merged** into the enclosing region when it is
  pushed (C2): every path after the condition changes the epoch (the
  `restore()` before each branch), so a merged entry could never be used.
- **C1, the epoch, loses sharing across a statement and a loop**: a value
  lowered before a `Declare`, an `Assign`, an `If` statement or a `Loop` is
  lowered again after it, also when the node reads no local that changed.
  It does not lose sharing across a `Sum`, a `Product`, a `Comprehension` or
  the first call of a helper (`inScope()`), unless their lowering changed a
  value of a scope outside theirs.
- **`structured-verify.ts` changed in one line.** The join of the effects
  of a region was a spread (`joinEffects(...effects)`); a region can hold
  close to 100,000 operations, and node 26 overflows the stack near 130,000
  spread arguments at the top level, less in a deep stack. It is now a fold;
  the rule is the same.
- **The `value` of a decline is bounded.** With the path skip removed,
  the shadow measure of `compile-cse-shared-subtrees.test.ts` did not
  finish: `Map(Function(Arctan2 DAG of depth 40, t), [-1, 2])` is declined
  by the admission (`Map` is outside the profile), and `profileDecline()`
  wrote `node.toString()` of the DAG in `value`, a text of 2^40 nodes (11 s
  at depth 28). `profileDecline()` now leaves `value` out when the node has
  more than 100,000 nodes counted per path (`hasShortText()` in
  `fragment.ts`, a walk of each node object once); `docs/COMPILATION-MODEL.md`
  says so. Every message of the route that writes the text of a node (the
  refusals of `javascript-fragment-target.ts` and `fragment.ts`, the
  `fail()` messages of the lowering, the `value` of a refusal of
  `fragment.ts`) writes `nodeText()`: the text when it is short, otherwise
  the head and `(…)`, such as `Add(…)`. The two functions are in
  `fragment.ts`, not in `javascript-fragment-target.ts`, because the
  lowering imports them and `javascript-fragment-target.ts` imports the
  lowering. The emitter and the verifier write no node.
- **The cap also declines a large program with no sharing**: a sum of
  30,000 terms `sin(x + c_i)` has more than 100,000 operations and declines
  (20,000 terms compile, 469 KB of code in 0.6 s). This is choice C4; the
  CHANGELOG and the guide say so.
- **The test of the cap uses the `If` shape at depth 20** and the shadow
  test the `If` shape at depth 14 with `cse: false` (the existing compiler
  takes many seconds on that shape with its CSE pass).

Measured on the full route (`compile(Floor(e_40), { profile:
'numeric-kernel', fallback: false })`, one run each after warm-up, a lightly
loaded machine; ms, code in characters; `scratchpad/sharing/probe.mts` of
the session):

| shape, d | time | code | before (route) |
| --- | --- | --- | --- |
| `Add(e, e)`, 40 | 0.8 | 1,174 | no result in 180 s |
| `Arctan2(e, e)`, 40 | 0.6 | 1,614 | stack overflow from 16 |
| `Sin(e) + Cos(e)`, 40 | 1.4 | 1,974 | stack overflow from 16 |
| `Add(e, If(x > k, e, 1))`, 40 | 2.2 | 1,844 | — |
| `If(x > k, e + 1, 2e)`, 12 | 204 | 126,966 | 273 (the first table) |
| `If(x > k, e + 1, 2e)`, 13 | 380 | 253,946 | — |
| `If(x > k, e + 1, 2e)`, 14, 20, 40 | decline in 21 to 28 | — | — |

The values are `Object.is`-equal to the unshared copy for every shape at
depths 2 to 12, and to the existing compiler with `cse: false,
constantFold: false` for the canonical shapes. Of the engine's own
compilations in the `limit*`, `find-fit*`, `nintegrate*`,
`map-auto-compile*` and `solve*` tests under `CE_JS_PROFILE=numeric-kernel`,
176 lowerings reused a value (`2^x`, `3^x`, `ln(x)`, the model terms of
`findFit`): their code binds a `const` where it repeated the subexpression;
the tallies of those tests are unchanged.

## Walks of later rules

The rules, refusals and analyses added after the result above brought back
walks that visit a node once per path. Measured on
`881716b157129b29f2df132f455b40b351feb9bd`: the root
`Block(deep := t_30, z := q(u), 1 + z)` with `t_k = Beta(t_(k-1), t_(k-1))`
of `compile-call-broadcast-result-operand.test.ts` did not end under
`CE_JS_PROFILE_SHADOW=1` (at depth 20 it took 2.5 s, three times as long per
two levels), although the profile only declines it. The walks, all in
`javascript-fragment-target.ts` but one:

- the admission of a function body (`admitFunctionBody()`): `checkValue()`,
  which runs every refusal of a value at each node; `scan()` of the local
  functions; `boundNames()` and `namesIn()`; in a local function, `visit()`
  of its reads and `collectCalls()`;
- the free symbols of a root `Block` (`collect()` of `attachRootBlock()`);
- the sign of an operand (`signOf()`), at each `Sqrt`, `Ln` and `Power`;
- the complex part of a calculus node (`complexPartOf()`), and
  `calculusDependencies()`;
- the purity of an aggregate bound (`aggregateBoundRefusal()`), the reads of
  a call of a local function (`refuseLocalFunctionArithmetic()`) and
  `isClosedPole()`;
- `judgeLoop()` (`structured-execution.ts`), which wrote the text of the
  node of a loop with `String()`: now `nodeText()`;
- `refuseComplexElementLanes()` (added with the broadcast over lists), which
  asks the existing compiler's `operandElementLane()` of each list operand
  of an element-wise node. That analysis and `isComplexValued()` remember
  the answer of a function node only inside a compilation
  (`CompilerState._compileDepth` above 0), and the route asks them at depth
  0: a list tower `L_k = L_(k-1) + L_(k-1)` took 3.3 s at depth 18.
  `withAnalysisMemo()` runs the walk at depth 1 with a fresh layer of both
  memo stacks, dropped after it.
- `liftedByDeclaration()` (added with the stored values that are
  expressions), which asks `isComplexValued()` of a captured name and of
  its value at depth 0, for each read of the name. Measured on
  `d45c14e4649588aeffcd0dd0ce56cf6643fd24a3`: `H + 1` with `H` assigned
  the tower `t_k = Sin(t) + Which(t > 0, t, True, 1)` over `2x`, `x` with
  no type, took 119 ms at depth 16 and 3.8 s at depth 22 with the profile;
  the test "a shared-node value is walked once per node, not once per
  path" of `compile-references.test.ts` (depth 36) did not end under
  `CE_JS_PROFILE_SHADOW=1`, and neither did the next test (`Clamp01` in
  place of `Which`, which the profile declines after the capture). It now
  runs under `withAnalysisMemo()`: 22 ms at depth 36.

The rule for a new walk: every walk over the subtree of a node is memoised
per compilation (a `Set` or a `Map` keyed by the node object, made by the
walk or held by the registry, never a module-level cache that outlives the
compilation), or runs once bottom-up. A memo entry is valid only when
everything that the walk reads or writes is in its key or cannot change
during the compilation. A walk whose answer depends on its context keys the
memo by that context: `checkValue()` by the names, the locals, the loop
indexes and `bodyValue` (it writes the key only for a node reached a second
time, so a tree with no sharing pays nothing), `collect()` and `visit()` by
the names bound around the node, `complexPartOf()` by the set of bound
names. A walk with state outside the key is not memoised there:
`checkValue()` checks at each path a node that holds a block with
statements, whose check reads and writes the facts of the writes
(`lengthWritten`, `notLength`, `writtenClasses`) and the declarations; a
tower of such blocks stays exponential. `signOf()` keeps its memo for one
call only (one operand, one scope), so each radical walks the distinct
nodes below it: quadratic in the distinct nodes. A message writes a node
with `nodeText()`.

`test/compute-engine/compile-javascript-structured-shared-depth.test.ts`
guards it: 54 shapes (heads, a `Sum`, list literals and lists of lists, an
element-wise form, a root `Block`, a `let`, an `If` statement, a value
block, a comprehension, a helper, a local function, a `Map` lambda, a
derivative, a matrix, the complex and `bigint` modes, degrees, and the
element-wise forms over a list or a matrix: scalar heads, two list operands
of one length key, a list of booleans, `At` and `Length` of a list tower, an
element-wise `Which`, comprehensions of a stated range, a stored value
read at the root), each a tower
of depth 40, compile or decline in less than 5 s (milliseconds on an idle
machine), with at most `10 · nodes + 50` value checks of the admission
(`ADMISSION_WORK`), and the value at depth 12 is the value of the existing
compiler with its default options (`Object.is`). Its last section reaches
one node object in two contexts (inside and outside a `Sum`, a lambda, a
`Loop` or an `Integrate` that binds one of its names; before and after a
local is declared; a local written a value of another kind between the
uses; a local function and the root) and checks that the code, or the
message of the decline, is the one of the walk with no memo.

Not linear, and not in the route: the cost of these towers is in the engine,
for both compilers. The `isFinite` and sign getters of a function expression
are not cached (`issues/CE-1200.md`), so the type of the root of
`Power(t, t)`, `Sqrt(t)·t`, the complex `Sin(t) + Cos(t)` or
`Sin(t)/(t + x)`, which `inlinePointValuesAtRoot()` reads, is exponential in
the depth. The type of a comparison of a list tower (`comparisonType()`,
`descriptorMayHoldRestriction()`) is exponential too: `t < 1` and an
element-wise `If(t > 0, t, -t)` over a list tower. `unknowns` of a tower in a `Function` literal, the boxing of
`If(t > 0, t, -t)`, the type of a `Loop` whose body holds a tower
(`loopBodyYieldsValue()`), `N()` of a tower in a `Sum` bound and the
symbolic `Integrate` are exponential too. A canonical `Add(t, t)` or
`Multiply(t, t)` is flattened by the canonical form into `2^d` operands: the
tree itself is large. The `If` shape above stays exponential in the code,
bounded by the operation limit.

## Defects seen, not filed

- The existing compiler with its default options takes 1.9 s at depth 12 and
  41.5 s at depth 14 on the `If` shape, where `cse: false` takes 0.19 s and
  0.6 s (`probe-phases.ts`): the CSE harvest, not the emission.
- The existing compiler writes the non-canonical `Add(Add(x, 1), Add(x, 1))`
  as the flat left fold `_.x + 1 + _.x + 1`; the route keeps the nesting, so
  at depth 4 the doubles are 20.800000000000008 and 20.8 (`probe-code.ts`,
  `probe-proto.ts`). A canonical `Add` is flat, so the witness is `crafted`:
  a known-limitations line of `docs/COMPILATION-MODEL.md`.
- `rewriteAngularUnit()` flattens a shared `Add` DAG (above).
