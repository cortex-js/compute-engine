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
   lowered again at each occurrence.

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
