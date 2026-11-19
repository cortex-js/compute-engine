# `parallel for` and list locals in the IR compiler

**Status:** approved by the user on 2026-11-18: D1, all of sections 4.1 to
4.4; D2, the worker pool is a fast follow (section 6), not dropped.
**Issue:** CE-1462 (`issues/CE-1462.md`, `source: tycho`), the `buddhabrot`
showcase entry. Witness strength: `corpus`.
**Earlier designs:** `docs/plans/2026-11-07-ce1093-parallel-for.md` (the
construct and its rules, sections 2 to 4) and
`docs/plans/2026-11-08-ce1163-run-async-parallel-for.md` (the worker pool).
Both were written for the compilers that 0.194.0 removed.

## 1. Problem

Tycho's `buddhabrot` prelude runs `const H_1 = step(H_0, 1200000)`. The
function `step(H: list<integer>, n: integer) -> list<integer>` copies its grid
(`let L = H`), runs `parallel for k in 1..n` over about 28 million inner loop
passes, and adds to cells of the grid with `L[c] += 1`. On 0.193.0 the step
compiled and ran in about 333 ms on one thread and 123 ms on 8 pool workers
(tycho-desk's measurement). On 0.194.0 it declines, and the interpreter does
not finish within Tycho's 30 s deadline, so the showcase entry does not open.

Tycho's minimum is that the step compiles; running it in order on one thread is
acceptable. The pool is a nice-to-have.

## 2. What declines today

Measured on `9d9931734a25a0981666c0992a88fae4e265cf5b` by compiling
`step(Hin, nin)` (`Hin: list<integer>`, `nin: integer`) with
`{ fallback: false }`, after `executeEpsil` of the prelude. Each line is the
first decline after the program was changed by hand to remove the one before:

1. `ParallelLoop(…)`: "the operator ParallelLoop is not supported by the
   compiler". (Changed: `parallel for` to `for`.)
2. `Assign(Tuple(a, b), Tuple(…))`: "a write that is not to a name", from
   `(a, b) := (a^2 - b^2 + p, 2*a*b + q)`. (Changed: two assignments through
   a temporary.)
3. `AddTo(At(L, c), 1)`: "the operator AddTo is not supported by the
   compiler". `AddTo(s, k)` of a scalar local declines too. (Changed:
   `L = replaceAt(L, c, L[c] + 1)`.)
4. `Assign(L, ReplaceAt(L, c, …))`: "a write to a constant … or to a list
   local". This is the documented rule of `docs/COMPILATION-MODEL.md`, "List
   updates": a block local cannot hold a list that the block changes.

The scalar part compiles. With every list write replaced by a sum into a
scalar `acc` (`step` returns `acc`), the program compiles on JavaScript, and
at `n = 2000`, `H = 0…0` it gives `1258854933`, the value of the same loop
written by hand in JavaScript. The interpreter gives `1258515027`: it does
not round `0.7548776662 * (r + k)` and its `fract` to f64, and the orbits are
chaotic, so a difference in the last bit of `p` or `q` moves the cells of an
orbit. That is the precision of the target (`docs/COMPILATION-MODEL.md`,
"Caveats of compiled code"), not a defect, and it decides the test of step 5.
GLSL declines `Hin` (a list of run-time length); the step is a JavaScript
program.

So `parallel for` is the smallest of four pieces. The largest is item 4: a
list local that the program changes, written in place.

## 3. The interpreter's values (probed)

Probed with `executeEpsil` on the same commit:

| Program | Value |
|---|---|
| `L = replaceAt(L, 5, 1)` with `L = [0, 0, 0]` | `out-of-range` error |
| `replaceAt(L, -1, 7)` | `[0, 0, 7]` (index from the end) |
| `replaceAt(L, 0, 7)` | `out-of-range` error |
| `replaceAt(L, 1.5, 7)` | `incompatible-type` error |
| `replaceAt(L, 1, 0.5)` of a list of integers | `[0.5, 0, 0]` (the element type widens) |
| `L[4] += 1`, `L[-1] += 1` | `out-of-range`; `[0, 0, 1]` |
| `let M = L; L[1] += 5; [L, M]` | `[[5, 0], [0, 0]]` (value semantics) |
| `f(A)` with `let L = H; L[1] += 1` in `f` | `A` is unchanged |
| `parallel for … { s = s + k }` | `6`, with the diagnostic `parallel-outer-write` |
| `parallel for … { s += k; t += s }` | `[6, 10]` (the read in order), with `parallel-accumulator-read` |
| `parallel for … { … break }` | `3`, with `parallel-exit` |

## 4. Design (JavaScript first)

### 4.1 A list local written in place

A `Block` local whose value is a list of reals, integers or booleans of rank 1
may be written with `Assign(L, ReplaceAt(L, i, v))` and `AddTo(At(L, i), e)`.
The code writes the element of the array in place. The sound and simple rules:

- **The local owns its array.** The declaration copies the value
  (`.slice()`) unless the value is a build that no other name holds (a
  `Comprehension`, a `Range`, a list literal that is not shared through
  `preambleOnce`). `let L = H` of an input copies, so the input is not
  changed (inputs are read-only, `docs/COMPILATION-MODEL.md`).
- **No alias.** Every occurrence of `L` in its scope is one of: `At(L, …)`,
  `Length(L)`, the target of a write above, or the result position of the
  block. Any other read (`M = L`, `f(L)`, `List(L)`, a capture in a function
  literal) declines the write. This keeps the value semantics of the
  interpreter's `alias` row without an analysis of aliases.
- **The lane does not change.** A written value whose lane is not a sub-lane
  of the element lane declines (`replaceAt(L, 1, 0.5)` of a list of
  integers), since the interpreter widens the list and the compiled array
  has one lane. The element type comes from the declared type of the local
  or of the value.
- **The index.** A negative index reads from the end, as in the interpreter.
  An index out of range, 0 or not an integer throws: a throw where the
  interpreter gives an error is within the caveats. A constant index out of a
  stated length declines.
- **Order.** `AddTo(At(L, i), e)` evaluates `i` once, before `e`, as the
  definition of `AddTo` says.
- GLSL and the interval mode decline a written list local.

This replaces the rule "List updates" of `docs/COMPILATION-MODEL.md` for
these forms; every other write to a list local still declines.

### 4.2 `AddTo` of a scalar local

`AddTo(s, e)` is `Assign(s, Add(s, e))` for a local `s`, with the lane rules
of `Assign`. On every target that compiles `Assign`.

### 4.3 Parallel assignment

`Assign(Tuple(a_1, …, a_n), Tuple(e_1, …, e_n))` of scalar locals evaluates
every `e_i`, then writes every `a_i`. Two equal names, a target that is not a
local, a right side that is not a `Tuple` literal of the same length, or a
lane change decline. On every target that compiles `Assign`.

### 4.4 `ParallelLoop` in order

`ParallelLoop(body, Element(x, coll))` compiles as `Loop(body, Element(x,
coll))`: the passes run in order, on one thread, as the interpreter runs
them, so the values are the interpreter's, also for the read of an
accumulator (section 3). It declines when:

- the body writes a variable declared outside the loop other than with
  `AddTo` (`parallel-outer-write`);
- the body has a `Break` or a `Continue` of the parallel loop itself
  (`parallel-exit`); those of an inner `Loop` are allowed;
- the program has a draw or a `WithRandomSeed` anywhere. Inside a frame the
  loop consumes one draw index and each pass draws from its own frame
  (`docs/RANDOMNESS-MODEL.md`, "Pass frames of a parallel loop"); compiled
  code has no pass frames. The buddhabrot step draws nothing.

A compiled program with no draw called by the interpreter inside a
`WithRandomSeed` frame does not consume the loop's draw index, so a later
draw of the interpreter in that frame differs. This is a `crafted` case: a
known-limitations line.

`runAsync()` keeps resolving to `run()`, and `willParallelize()` stays
`false`. GLSL may compile the same in-order loop for scalar accumulators,
but no corpus program needs it: GLSL declines in this version.

### 4.6 A list local reassigned whole

**Issue:** CE-1481 (user decision (a), 2026-11-18). **Witness** (`corpus`):
Tycho's `apollonian-gasket` prelude. `allCirclesLocal = fillGap(…,
allCirclesLocal)` in a `for` loop, where `fillGap` copies its list
(`let out = found`) and rebuilds it (`out = [...out, (c[1], c[2], c[3],
depth)]`, `out = fillGap(…, out)`); and `generations`, whose
`let out: list<tuple<number, number, number, integer>> = []` is rebuilt with
`out = [...take(out, i), c, ...drop(out, i)]`. 0.193.0 compiled them: its
JavaScript was a `let` of an array that each statement bound again.

The shape rule (`docs/COMPILATION-MODEL.md`, R1 to R6) allows it: the shape
of a value is its form (a number, a list, a point, …), and a list of a
run-time length is one shape whatever its length. A write that keeps the
rank, the lengths after the first and the tuple mark keeps the shape; only
the first length changes. The rules:

- **Which local.** A `Block` local whose value is a list, every write of
  which in its scope is `Assign(L, value)` (no `ReplaceAt(L, …)` value and
  no `AddTo`, which are the §4.1 forms, no parallel assignment, no write in
  a function literal). A list of reals, integers or booleans of rank 1, or
  a list of points of reals or integers. The type is the declared one
  (`list<tuple<number, number, number, integer>>`: a list of points of four
  reals) or the type of the value. A declared empty list `[]` is the empty
  list of that type.
- **An SSA value per write**, as for a scalar local. Nothing is written in
  place, so a read can share the array (`M = L`, `f(L)`): there is no
  alias rule. A `Loop` carries two values for the local, its length
  and the list of that length; an `if` whose arms leave two lengths gives
  the length of the arm taken as a result before the list (the rule of list
  arms, extended to lists of points for such a local); a random frame gives
  the length as a result too.
- **A written value of another type declines**: another rank, another
  inner length (`(1, 2, 3)` into a list of pairs), a tuple, a lane that is
  not a sub-lane. One exception, as for §4.1 (CE-1480): a real list written
  to a list of integers of no declared type puts the local on the real lane
  from its declaration, as the interpreter widens it. A declared
  `list<integer>` gives an `incompatible-type` error in the interpreter and
  declines.
- **Interaction with §4.1.** A local with both forms (`L = [...L, 2]` and
  `L[1] = 5`) declines, with the §4.1 cause. The two kinds never meet in one
  local: the in-place local stays one array, the whole local a value per
  write.
- **Declines.** An empty list of no stated type (`let L = []`: no lane), a
  point (a tuple local) written whole, a list of lists. GLSL (no run-time
  length), the interval mode and the `bigint` mode decline the local.

`Append` is not supported by the compiler, so `L = Append(L, v)` still
declines, as an operator.

## 5. Steps and definition of done

1. (Done, section 2.) The scalar part of `step` compiles.
2. 4.2 and 4.3, with tests against the interpreter.
3. 4.1, with tests of each row of section 3 and of the alias, copy and lane
   rules.
4. 4.4, with tests of the three declines.
5. The buddhabrot step compiles on JavaScript with `fallback: false`; its
   value equals that of the step written by hand in JavaScript at
   `n = 2000` (not the interpreter's, section 2), and the interpreter's on a
   non-chaotic variant (a body whose cells do not depend on an orbit); and
   `step(H_0, 1200000)` runs within a time to measure against the 333 ms of
   0.193.0.
6. Docs: `ir/README.md`, `docs/COMPILATION-MODEL.md` ("List updates",
   "`parallel for` and `runAsync()`"), `docs/MIGRATION-0.194.md` is not
   changed (it describes 0.194.0), CHANGELOG `[Unreleased]`, and the guide
   `13-guide-compile.md`.
7. The random-program and corpus checks of the brief, and a review by Codex
   and a Claude reviewer.

## 6. The fast follow: the worker pool

0.193.0 ran a `parallel for` on the worker pool (`runAsync()`, the CE-1163
spec), so its absence is a regression, and it follows sections 4.1 to 4.4
directly, under CE-1462. **Status:** design, not approved; no code.

`run()` does not change: its text, `code`, `preambleOnce` and `shippable`
are those of 4.4. A pool loop exists only in a second, asynchronous text that
`runAsync()` runs.

### 6.1 Which loops go to the pool

The lowering marks the `loop` instruction of each `ParallelLoop` that 4.4
admits (`parallel: true`; every pass must keep it, `inline` too). After
the passes and the verification, the outliner (6.2) takes a marked loop when
all of these hold; otherwise the loop stays as 4.4 compiles it, in order, in
both texts. No condition makes a compilation decline.

- **Scalar accumulators.** Each value that the loop carries is one. The
  check gives each SSA value of the body at most one label, a *root*: the
  parameter of a loop body from which the value accumulates. A `loop`
  body's parameters are `[k, c_0, c_1, …]` (the index first), and carried
  index `m` pairs `init[m]`, parameter `m + 1`, `yields[m]` and `outs[m]`;
  an `if` pairs `outs[m]` with `yields[m]` of each arm. The labels:
  - parameter `j + 1` of the marked loop's body is a root, for its carried
    index `j`;
  - `add(a, e)` (either operand order) has the label of `a` when exactly one
    operand has a label; with two labelled operands the check fails
    (`parallel for … { s += k; t += s }`: `add(t, s)`);
  - `outs[m]` of an `if` has label `R` when `yields[m]` of both arms have
    label `R`; with one arm labelled and the other not, or with arms
    labelled with different roots, the check fails;
  - for an inner `loop` whose `init[m]` has label `R`, its body parameter
    `m + 1` is a new root `R'`; its `yields[m]` must have label `R'`, its own
    root, and then `outs[m]` has label `R`. An inner yield labelled with an
    outer root (`add(s_outer, e)` yielded by the inner body) fails.

  Every use of a labelled value must be one of: an operand of an `add`, an
  `if` arm's `yields[m]`, an inner loop's `init[m]`, or the `yields[m]` of
  the body whose root it has, where `m` is that root's own carried index.
  Feeding another index fails (a swap, `if c { (s, t) := (t, s) }`), and so
  does any other use: a read. The marked body's `yields[j]` must have root
  `j`'s label, or the check fails. Then the final value is the value before the
  loop plus a sum of terms that do not read it, and `s += a` under an `if`,
  in an inner `for`, or twice in a pass is admitted. A failed check sends
  the loop to in-order, as the interpreter runs it.
- **List accumulators.** Each array defined outside the loop that the body
  writes is one when its only uses in the body, in any nested region, are
  triples `set(L, k, add(get(L, k), e))` of one index value `k` (4.1's
  lowering of `AddTo(At(L, i), e)`). `L[c] += L[d]` and `M = L` in the body
  are reads: in order.
- The lane of every accumulator is `real` or `integer`. A loop with no
  accumulator runs in order: it has nothing to merge.
- **The test is on the IR**, after the passes, not on the expression: it
  sees exactly the code that the worker runs, and a pass that reshapes a
  chain only sends the loop back to in-order.
- **The domain.** Any `Element` clause that 4.4 lowers to a counted `loop`:
  a range, or a list (whose array is then a value that the body reads).
- **The program.** The default mode (not `complex`, not `bigint`), no
  `iterationBudget` (one count of passes for the call, which workers cannot
  share), JavaScript only. A program that draws already declines (4.4).
- **The body can run on a worker.** The text of the worker program (6.2) is
  shippable (`isShippableCode()`: no `integrate`, no draw), and the loop body
  reads no name of `vars`, whatever its text: the worker program has no
  inputs object. A `vars` read that `hoist` moved out of the loop is a value
  defined outside it, passed as any other (6.2).
- **The position.** The loop is a waiting position: its enclosing regions, up
  to its function's body, are only `if` arms and `loop` bodies. Not the body
  of another marked loop (a worker runs it in order), not a `build`, `sortby`,
  `integrate`, `derivative`, `iterate` or `seeded` region. A function waits
  when it holds a pool loop or, at a waiting position, a call of a function
  that waits (a fixed point over the call graph, recursion included).

At run time, when the program reaches a pool loop, `runAsync()` sends it to
the pool when all of these hold, and otherwise runs it in order inside
`runAsync()`:

- the engine has a usable pool (`callPool(ce.workers)`);
- the deadline frame current at the call of `runAsync()` (6.4) holds no step
  budget (`DeadlineFrame.budgets`, armed by `ce.withStepBudget()`,
  `docs/TIMEOUT-MODEL.md` §7.4). A step is one check of the frame on the
  thread that charges it, and workers cannot charge the caller's budget, so
  such a loop runs in order, as with `iterationBudget`;
- the count of passes is at least `minPasses` (default 20,000, as 0.193.0).
  The count is that of the printer's loop, `max(0, Floor(hi - lo) + 1)`,
  computed on the calling thread with the code of `run()`'s loop, its guard
  included (a count past the guard runs in order, which throws as `run()`
  does). An empty range sends nothing: the outs are the values before the
  loop;
- the private arrays of all workers (each list accumulator, and each list
  that the body reads, times the count of sub-ranges) hold at most 16
  million numbers.

`willParallelize(passes?, minPasses?)` is `true` when the program has a pool
loop, the engine's pool is usable, no step budget is current, and `passes`
(when given) is at least `minPasses` (default 20,000). It ignores the limit
on private numbers, the signal and the deadline, and a failure of a worker
later. A `minPasses` that is not a positive integer throws a `TypeError`, in
`willParallelize()` as in `runAsync()`.

### 6.2 The worker program

For each pool loop the outliner builds a separate `Program` whose entry is a
root function literal of positional parameters that returns the array of
its results (`tuple: true`):

- **Parameters:** `i0` and `i1`, a sub-range of 0-based pass counts (the
  passes `i0 ≤ i < i1`); `lo`, the loop's first index; then each value
  defined outside the loop that the body reads (the invariants that `hoist`
  moved out, `r` of the witness, inputs, the array of a list domain, and
  each length value that a type of such a value names). A `const` is copied
  into the worker program, not passed. A list accumulator is not passed: its
  length value is.
- **Body:** a `loop` with a new optional field `window: [i0, i1]`, which the
  printer spells as `run()`'s counted loop restricted to those pass counts:
  the index of pass `i` is `lo + i`, the expression of `run()`'s loop
  (`k = k_lo + k_i`), so each pass sees the index of the same pass in
  `run()`, also for bounds that are not integers. Its body is a copy of the
  marked loop's body, values renumbered, with each scalar accumulator
  starting at `-0` and each list accumulator a new array `zeros(n)` of its
  length (a new operation: a `Float64Array` filled with `-0`, exact for
  integers within 2^53). `-0` is the identity of `+`: a cell that no pass
  writes adds nothing, also to a cell that holds `-0`, `NaN` or an infinity.
- **Results:** the partial sums, then the partial arrays, in the order of
  the accumulators.
- The user functions that the body calls are copied into the program.

The program is printed by `printJavaScript()` with no passes, as the stored
result of a lambda (`calling: 'lambda'`, the result's `reconstructionDigits`):
the pool's `call` task loads and calls it. Each pass therefore runs the same
IR as the pass of `run()`; no second compilation can share subexpressions
differently. The main program gets no new instruction: the outliner records,
per loop, the worker program and the values to pass (a side table of the
slice result), and the printer reads it.

### 6.3 The merge

`runAsync()` splits the passes `0 ≤ i < count` into one sub-range per worker,
in order (`floor(count · p / w)` boundaries; `min(w, count)` sub-ranges, so
fewer passes than workers gives one pass per sub-range), runs them with
`pool.runCall()`, and when all have answered adds, in the order of the
sub-ranges: `s = s0 + P1 + … + Pw` for a scalar, and `L[j] = L[j] + P_w[j]`
for every cell, worker after worker, for a list. The list local owns its
array (4.1), so the addition is in place, and no other name sees it. The
partial arrays come back as `Float64Array`s, which the pool transfers.

- **Integer accumulators** give the value of `run()` exactly while the value
  before the loop, each partial and each sum stay within 2^53: the
  histogram's cells.
- **Real accumulators** can differ from `run()` by the grouping of a
  floating-point sum, usually in the last bits, more for terms that cancel; a
  later test of the value can then take another branch. That is "a
  different order of summation", an allowed difference of
  `docs/COMPILATION-MODEL.md`, "Caveats of compiled code". The grouping
  depends on the size of the pool (C1), not on timing: for one pool size the
  value has the same bits at every run.
- **The interpreter** runs the passes in order (section 3), so it gives the
  value of `run()` within the caveats of 4.4.

### 6.4 `runAsync()`

**The asynchronous text.** The JavaScript printer prints each function that
waits a second time, as `async function f$async`, and the entry body as an
`async` body. In that text a call of a waiting function at a waiting position
is awaited, every other call is the synchronous function, and a pool loop
is:

```js
const _p = _run.loop(/* loop id */ 0, lo, hi, [r /* values passed */]);
if (_p === undefined) { /* the loop of run(), in order */ }
else {
  const _s = _run.r(await _run.s(_p).then(_run.ok, _run.fail));
  L = _run.addList(L, _s, 0);
}
```

Every `await` that the printer emits, of a pool loop or of a call
`f$async(…)`, has the one form
`_run.r(await _run.s(p).then(_run.ok, _run.fail))`, so the state is set on
every way out of and back into the program. `_run.ok` and `_run.fail` change
no engine state: they wrap the outcome (`{ v }` or `{ x }`). `_run.r` runs in
the continuation of the `await` itself: it installs the program's state, then
returns `v` or throws `x`. No promise reaction of another call can run
between the installation and the code that follows, so two calls that reject
together do not see each other's state. Each `async`
function of the copy, and the async entry, restores the caller's digits and
deadline frame in a `finally`, on return and on throw, as d53b3e43d did, so
the state that is current after `runAsync()` resolves or rejects is the one
that was current before the program last continued.

with the scalar outs of the loop given by `_run.addNumber(s0, _s, j)`. A
program can hold several pool loops; each has its id, worker program and
`onLoop` report. The text is built with `twoStageRunner()` over the same
`preambleOnce` (helpers, the synchronous functions, the values computed
once), so it adds the async copies only, and it is compiled at the first call
of `runAsync()`. The entry check of the inputs (`checkEntry()`) and the result
convention (`normalizeRunResult()`) are those of `run()`. A program with no
pool loop has no second text: `runAsync()` calls `run()` (it still checks
`signal` and `minPasses`, and calls no `onLoop`).

**The state of a call.** The helpers of `_SYS` read engine state live
(`makeSysHelpers()`, `engineRuntimeSource()` of `javascript-runtime.ts`): the
deadline frame (`ce._deadlineFrame`, which also holds the tick count), the
random frame and the live draw, and the pass counter of `iterationBudget`;
`run()` also sets the reconstruction digits around the call. A program with a
pool loop draws nothing (4.4) and has no budget (6.1), so the state to keep
across a wait is the digits and the deadline frame. `runAsync()` captures
both at its call. `_run.s` (the program leaves the thread) sets the caller's
digits and frame again; `_run.r` (it continues, with a value or a
rejection) saves the current ones as the caller's and installs the
program's. So two pending calls of `runAsync()`, or another evaluation that
installs its own frame during the wait, do not see each other's state, and
the statements after a wait tick the frame of the call. `ce.iterationLimit`
is read at the call and sent with each task.

**The inputs.** The host must not change `inputs`, or an array reachable
from it, until the promise settles: the program reads them after a wait.
Otherwise the value is unspecified. This goes in the public documentation of
`runAsync()` (`types.ts` and `docs/COMPILATION-MODEL.md`), as CE-1163 §4 had
it.

**`onLoop`.** `RunAsyncOptions.onLoop(report)` is restored with the shape of
0.193.0: `{ passes, route: 'pool' | 'calling-thread', reason? }`, `reason`
one of `'no-pool'`, `'pool-unusable'`, `'below-threshold'`, `'too-large'`,
`'pool-declined'`, and the new `'step-budget'`. It is called once for each
run of a pool loop (6.1) when its route is known: with `'pool'` after every
sub-range was answered by a worker, with `'calling-thread'` and the reason
when a run-time condition keeps the loop in order or a sub-range is run again
on the calling thread (`'pool-declined'`). A loop that the compiler keeps in
order never calls it. It is host code: it runs with the caller's digits and
frame. A throw from it rejects `runAsync()`.

**Cancellation.** A signal already aborted rejects with `signal.reason`
before any statement runs. An abort during a wait rejects the awaited
promise with `signal.reason`: the pool drops queued tasks, and a worker that
runs a sub-range is terminated and replaced after the grace period (the
compiled loop does not read the cancel flag). An abort while the calling
thread runs statements is seen at the next pool loop, which throws
`signal.reason` before its other checks.

**The deadline** (C3). The calling thread ticks the captured frame as
`run()` does. Each `call` task carries the frame's time `at`. A worker sets
its runtime deadline to it for the call, so its ticks throw a timeout
`CancellationError` past it, and it answers with a deadline stop, not a
plain error. The pool settles a call task at the deadline as it does a cells
task: one still queued or loading is rejected at the deadline, and one that
runs is rejected when the worker answers with a deadline stop, or by the
watchdog at the deadline plus the grace period, which terminates and
replaces the worker. Each such rejection is the `CancellationError` that the
captured frame gives (`checkDeadline(frame)`: its `owner` as attribution, its
`spans`), as a cells or fit task is attributed to the frame of its caller.
On the first one, `runAsync()` cancels the sibling tasks (an internal signal
linked to the host's), runs no sub-range again, and rejects with it.

**Errors in a worker.** A sub-range that a worker does not complete for
another reason (an error of a pass, a failed worker, a pool that turns out
unusable) runs again on the calling thread with the worker program's own
`run`, in the order of the sub-ranges, so the first error thrown there is the
error of the first failing pass, the one `run()` throws, as a real `Error`
(the worker only sends its message).

**The order.** The driver waits until every task of the loop has settled,
unless a deadline answer arrives first: that answer, at any time before the
reruns, rejects with the frame's `CancellationError`, whatever the other
tasks gave (a pass error in one sub-range and a deadline in another give the
`CancellationError`). Reruns start only after every task has settled with no
deadline answer, and only when the frame has not expired; otherwise
`runAsync()` rejects with the frame's `CancellationError`. During the reruns
the calling thread's own ticks decide.

**The state of a rerun.** A rerun runs inside the pool driver, before
`_run.r` installs the program's state again, and the worker program's `run`
(built over the engine's runtime, `runtimeOf(ce)`) reads the engine's live
state. So each rerun runs in a synchronous scope that installs the captured
deadline frame and the program's digits, runs the sub-range, and restores the
caller's in a `finally`. The rerun ticks the captured frame, and a rerun that
crosses its deadline throws its `CancellationError`.

### 6.5 What does not change

`run()`, `code`, `preambleOnce`, `shippable`, `broadcast()` and
`broadcastAsync()`: the outliner and the asynchronous text are on the side.
GLSL and the interval mode keep declining `ParallelLoop`.

C5: the asynchronous text is not stored. `runAsync()` of a stored result
loaded with `createJavaScriptRuntime()` runs `run()`, and a lambda result
(`calling: 'lambda'`, a root function literal) has no `runAsync()`, as
today. Tycho's `runPrelude` calls `runAsync()`, with `onLoop`, on the live
result of `compile()` for each compiled value statement, called with an
object of inputs (`calling: 'expression'`;
`~/dev/tycho/src/plot-core/prelude-runner.ts`, `runPrelude`, about lines
1680 to 1698, and the `CompiledRunRequest` type), so the pool reaches the
witness.

### 6.6 Reuse from 0.193.0

`git show d53b3e43d:<path>`:

- **Reused with changes: the pool's `call` task** (still in the tree, with
  `test/compute-engine/ce-1163-pool-call.test.ts`). `kernel-protocol.ts`: a
  field `deadline` on the `call` message, and a deadline stop as a distinct
  answer (an `error` with a `kind: 'deadline'`). `src/kernel-worker.ts`:
  the `call` case sets `jsRuntime.deadline` from the message (today it sets
  none) and answers a timeout `CancellationError` with that kind.
  `kernel-pool.ts`: `runCall()` takes the deadline and the frame's error;
  `deadlinePassed()`, the timer of a queued task and the watchdog
  (`armDeadline()`), which skip call tasks today, apply to them; a deadline
  answer rejects with the frame's `CancellationError`.
- **Reused with small changes:** `run-async.ts` of d53b3e43d: the split,
  `runCall()` per sub-range, the rerun of a failed sub-range, `abortable()`,
  the state `s`/`r`/`e` (now with the frame), `addNumber`/`addList` (the
  skip of a zero cell replaced by the `-0` identity), `DEFAULT_MIN_PASSES`,
  `MAX_PRIVATE_NUMBERS`, `willParallelize` (plus `minPasses`), and `onLoop`
  with `ParallelLoopReport` and `ParallelLoopReason` in `types.ts` (plus
  `'step-budget'`).
- **New:** the mark and the outliner on the IR (6.1, 6.2), the `window`
  field of `loop`, the `zeros` operation, and the asynchronous mode of the
  printer (6.4). `pool-loop.ts` and `pool-async.ts` walked the old
  compiler's code and are not reused; the IR makes them smaller (the pass
  window is the loop's own count, the values passed are the IR's values, and
  a function has two copies, so 0.193.0's "one form of each function"
  restriction goes away).

### 6.7 Tests and the definition of done

On a real pool (`test/compute-engine/kernel-pool.test.ts` workers), reading
the route from `onLoop`:

- The witness-shaped step (a histogram list local and a scalar sum) gives
  through `runAsync()` the value of `run()`, and `onLoop` reports `'pool'`.
- For each sub-range, the worker program gives the partial of the same
  passes of `run()` (an integer accumulator equal; a range with a step and
  bounds that are not integers included).
- A scalar `+=` under an `if`, in an inner `for` and twice in a pass goes to
  the pool, with the value of `run()`.
- A list accumulator over a list domain (`parallel for x in xs { L[x] += 1
  }`) goes to the pool.
- Two pool loops in one program each report `'pool'`.
- Fewer passes than workers (with `minPasses: 1`): one pass per sub-range,
  the value of `run()`. An empty range: nothing sent.
- In order, with the value of `run()`: a read of an accumulator (scalar and
  list), a loop with no accumulator, a non-waiting position (a callback,
  inside another `parallel for`), the `bigint` and `complex` modes, an
  `iterationBudget`, a body that reads a `vars` name, a body that is not
  shippable, and, with the `onLoop` reason: no pool, a count under
  `minPasses`, too many private numbers, a step budget
  (`ce.withStepBudget()`; one that is exhausted still rejects through
  `runAsync()` with `cause: 'step-budget'`).
- A loop in a function called from an `if` arm, a `for` body and a second
  function goes to the pool; the same function called also from a callback
  position runs in order there and on the pool at the waiting call.
- A real accumulator is within 1e-12 relative of `run()` on a sum of
  positive terms, and has the same bits on repeated runs with one pool size.
- The input list and a second name that holds a copy are unchanged.
- Errors: a pass that throws in a sub-range (the error of `run()`), a worker
  that fails, a signal aborted before the call, during the wait, and while
  statements run on the calling thread before a second pool loop; a deadline
  that passes in a running worker, with a sub-range still queued, and with a
  worker that does not answer (the frame's `CancellationError`, attribution
  kept, no rerun); a pass error in one sub-range and a deadline answer in
  another (the frame's `CancellationError`, no rerun); a worker that fails
  before the deadline and a rerun that crosses it (the frame's
  `CancellationError`, thrown by the rerun's ticks).
- State: two pending calls with different reconstruction digits,
  interleaved through nested waiting functions (`f$async` awaiting
  `g$async` awaiting a pool loop), on the resolve and the reject paths; a
  call whose wait sees another evaluation install its own deadline frame
  (each keeps its own); that other evaluation's frame and digits are current
  after `runAsync()` resolves and after it rejects; two calls whose waits
  reject in the same turn, with an unrelated microtask between them, each
  continue with their own state, and the caller's is current after both.
- Accumulator labels (6.1): a swap `if c { (s, t) := (t, s) }` and an inner
  loop that yields `add(s_outer, e)` run in order; two accumulators of which
  only the second changes inside an `if`, and inside an inner loop, go to
  the pool with the value of `run()`.
- `willParallelize()` with and without `minPasses`, and its `TypeError`.
- `run()` text unchanged: the snapshot tests of the IR do not change.

Done when these pass and the full checks of BUILD.md pass; the docs of step
6 of section 5 describe the pool (`docs/COMPILATION-MODEL.md` "`parallel
for` and `runAsync()`", `ir/README.md` "Batches and `runAsync()`", the
`RunAsyncOptions`, `onLoop` and `willParallelize` comments of `types.ts`,
the input rule of 6.4, the guide); and the buddhabrot step
(`step(H_0, 1200000)`) is timed with `run()` and with `runAsync()` on a pool
of 8 workers in Node (median of 7 after a warm-up), and the same with 0.193.0
built from its release commit `384222963c93f683ec098eeb31152dbad64140ed` (it
has no tag) in a worktree, on the same machine. The target: `runAsync()` is
faster than `run()`, and at most 1.2 times 0.193.0's `runAsync()` time;
otherwise the measurement goes to the user before CE-1462 closes. For
reference, 0.193.0 measured 123 ms (Tycho) and 39.6 ms (the CE-1163 spec,
section 9). Last, Tycho's CE-1462 instrument prints the `parallelLoops` of
the `H_1` statement, which `runPrelude` fills from `onLoop`, and reads
`route: 'pool'`; that change of the instrument is Tycho's, asked in the
issue's answer. Then CE-1462 closes.

### 6.8 Choices

| | Choice | Decided or recommended | Alternative |
|---|---|---|---|
| C1 | Sub-ranges | Recommended: one per worker, as 0.193.0 (its D3, approved). | A fixed count (16): the same bits for a real accumulator on every pool size, better balance; 16 partial arrays per loop. |
| C2 | Where accumulators are found | Recommended: on the IR after the passes (6.1). | On the expression at lowering, as 0.193.0: the source form is clearer, but the worker could then run IR that the check did not see. |
| C3 | The deadline in a worker | Ruled: sent as the frame's time, with the protocol changes of 6.4 and 6.6. | None, as 0.193.0: a worker runs its sub-range to the end, and only `signal` stops it. |
| C4 | `onLoop` | Ruled: restored with 0.193.0's shape, plus `'step-budget'` (6.4). | Not restored; tests spy on the pool. |
| C5 | The asynchronous text on a stored result | Recommended: not stored (6.5). | Store it (a new field of the stored result), so a loader can run the pool. |
| C6 | The default `minPasses` | Recommended: 20,000, as 0.193.0. | Measure the first passes and decide from the time, as 0.193.0's D2 alternative. |

## 6a. Not in this version

- Pass frames in compiled code (draws inside a `parallel for`).
- `ParallelComprehension`.
- A written list local on GLSL.

## 7. Decisions

- **D1** (user, 2026-11-18): all of sections 4.1 to 4.4.
- **D2** (user, 2026-11-18): the pool after 4.4, as a fast follow (section 6);
  0.193.0 had it, so it is a regression.
