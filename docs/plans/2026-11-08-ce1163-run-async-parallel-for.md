# `runAsync()`: a `parallel for` on the worker pool of the JavaScript target

**Status:** approved 2026-11-08, with the recommendation of each decision of
section 6 (D1 to D4). Revision 2: the findings of one spec review (Claude and
Codex) are applied.
**Issue:** CE-1163 (`issues/CE-1163.md`), a request of Tycho. Witness strength:
`corpus` (Tycho showcase entry `buddhabrot`).
**Depends on:** the `parallel for` construct and its rules
(`docs/plans/2026-11-07-ce1093-parallel-for.md`, sections 2 to 4), and the
worker pool (`src/compute-engine/kernel-pool.ts`).

## 1. Problem

`parallel for` says that the passes of a loop are independent. The JavaScript
target still runs the passes in order, on one core. Tycho's `buddhabrot` step
runs 1.2 million passes in 284 ms that way (the issue has the measurement).
The same step, split by hand over 8 Web Workers, ran 5 to 6 times faster in
Tycho's measurement (500,000 samples: 74 to 77 ms on one thread, 11.6 to
15.1 ms on 8 workers).

A compiled program is synchronous, and a worker answers with a message, which
a synchronous program cannot wait for. So the pool needs a second way to run
the program, which returns a promise.

## 2. What the host sees

Additions to a `javascript` compilation result that is called with an object
of variables (`calling: 'expression'`), where `broadcastAsync` already is.
`run()` does not change.

| Member | Meaning |
|---|---|
| `runAsync(inputs, options?)` | A promise of the value that `run(inputs)` gives, except that the terms of an accumulator can be added in another grouping (section 5). It checks `inputs` and converts the result as `run()` does. An error of the program rejects the promise; `runAsync()` never throws. |
| `willParallelize(passes?)` | `true` when `runAsync()` would send a `parallel for` of this program to the pool now: the program has at least one loop that can run on the pool (section 3), the engine has a usable pool (`ce.workers`), and `passes`, when it is given, is at least the default threshold. The loop can be inside a function that the program calls. It does not know the range of a loop, and it does not check the size limit of section 3. |
| `options.signal` | An `AbortSignal` (section 4, "Abort"). |
| `options.minPasses` | The smallest count of passes that goes to the pool. Default: 20,000. |
| `options.onLoop` | A function called once for each run of a loop that can run on the pool, with `{ passes, route, reason }`: `route` is `'pool'` or `'calling-thread'`, and `reason` says why the pool did not take it: `'no-pool'`, `'pool-unusable'`, `'below-threshold'`, `'pool-declined'` (the values that `broadcastAsync()` reports) or `'too-large'` (the size limit). A loop that fails a condition of the compiler never calls it. |

Example. `count(H, 900000)` with this definition, and a pool of 3 workers:

```epsil
function count(H: list<integer>, n: integer) -> list<integer> {
  let L = H
  const r = H[4]
  parallel for k in 1..n { L[(r + k) % 3 + 1] += 1 }
  L[4] = r + n
  L
}
```

- **Today**, `run({ H: [0, 0, 0, 0] })` runs the 900,000 passes in order and
  gives `[300000, 300000, 300000, 900000]`. There is no `runAsync`.
- **Under the proposal**, `await runAsync({ H: [0, 0, 0, 0] })` gives the same
  list. The calling thread runs `let L = H` and `const r = H[4]`. Worker 1
  runs the passes 1 to 300,000, worker 2 the passes 300,001 to 600,000 and
  worker 3 the rest, each on a private list `[0, 0, 0, 0]`. The calling thread
  adds the three lists to `L`, in that order, then runs `L[4] = r + n`.
- `run()` gives the same value in order, on any thread, as today.

## 3. Which loops run on the pool

A loop that fails one of these conditions runs in order, inside `runAsync()`,
with the code that `run()` has. No condition makes a compilation decline.

Conditions that the compiler checks:

1. **Position** (decision D1). The compiled expression is a call of a user
   function (`step(H_0, 1200000)`) or a block, and the loop is a statement of
   that body. The loop can be inside the branches of an `if` statement and
   inside the body of a `for` or `while` loop. It can be in a second user
   function when the call is a whole statement, the right side of a
   declaration or of an assignment (`let A = step(H, n)`), or the last
   expression of the body. In every other position the loop runs in order:
   `sum(step(H, n))`, `map(xs, x |-> step(H, x))`, the body of another
   `parallel for`, the body of `WithRandomSeed`. The remedy for the host is a
   statement of its own: `const T = step(H, n)`, then `sum(T)`. A function on
   the way that the compiler emits in a form other than a plain definition (a
   body substituted into its caller, a variant for one shape of call, a
   definition behind the last-call memo) also keeps the loop in order, unless
   step 2 of section 8 shows that the form can wait.
2. **Domain.** A range that the compiler emits as a counted loop
   (`compileCountedRange()` in `compile-loops.ts`), with bounds and a step
   that make no draw. A loop over a list runs in order.
3. **Accumulators.** Each one is a local variable of the function or block
   that holds the loop. It is a real machine number (`s += e`) or a list of
   such numbers with one index (`L[i] += e`). The program is compiled in the
   default mode, not `complex` or `bigint`.
4. **No read of an accumulator.** In the loop as written, before the compiler
   rewrites `+=` (`lowerParallelHeads()`), the name of each accumulator
   appears only as the target of a `+=`. This is rule 2 of the `parallel for`
   plan, which that plan leaves to a target that runs the passes in parallel.
   `L[c] += L[d]` runs in order. A user function that the body calls cannot
   read an accumulator: the accumulator is a local of another function
   (condition 3), and the body holds no function value that could capture it
   (condition 6).
5. **No other write and no jump out.** Apart from the `+=` on the
   accumulators, the body and each user function that the compiler emits for
   it assign only their own locals, and no `return`, `break` or `continue`
   leaves the loop. The Epsil checker already reports these (rules 1 and 5 of
   the plan); the compiler checks them again, because a MathJSON program does
   not pass through the checker.
6. **The body reads data only.** Each outer variable that the body reads has
   a static type that is a number, a boolean, a string, or a list or tuple of
   these. A function value cannot go to a worker.
7. **The loop can run on a worker.** The loop, compiled as a function of its
   own, is `shippable`: it makes no random draw and names no function of the
   host. A pass that draws runs in order. `shippable` does not prove that the
   code has no effect: a function object given in the `functions` option is
   copied as source, and a `compile` handler can declare itself shippable. As
   for `broadcastAsync()`, such a function must read only its arguments and
   have no effect; otherwise the value of `runAsync()` is unspecified.
8. **No pass budget.** A program compiled with `iterationBudget` counts its
   passes in one counter for the call. Each worker would count its own.

Conditions that `runAsync()` checks when the run reaches the loop: the engine
has a usable pool; the count of passes is at least `minPasses`; and the private
lists of all workers together hold at most 16 million numbers.

## 4. How it runs

**The loop as a function.** For each loop that passes the conditions, the
compiler builds a function expression. Its parameters are the first value and
the step of the range, the first and the last index of a sub-range of passes
(pass `i` of the whole range, from 0), the outer variables that the body
reads, each with its static type, and the length of each list accumulator.
Its body declares each accumulator as a local set to zero (a number, or a
list of zeros of that length), runs the passes of the sub-range, and returns
the accumulators. Pass `i` computes `k` from the first value, the step and
`i` with the expression of the in-order loop (`a + s * i`), so a sub-range
gives the `k` values of the whole range, also for bounds that are not
integers. The ordinary compiler compiles this expression, with the options of
the program. The requirement is that each pass gives the value of the same
pass in `run()`; a test checks it, because a separate compilation can emit
other code for the same pass (another sharing of subexpressions). The pool
stores the function as it stores any compiled result.

**The program.** The compiler emits a second, asynchronous copy of each
function on the way from the program to the loop. It is the code of `run()`,
except that the loop is one awaited call of the runtime. The emitter marks a
statement as able to wait only in the positions of condition 1, and every
other emitter leaves the mark off, so a position that the list does not name
keeps the in-order loop. A sketch of the two texts for the example (the names
are not final; the emitted code calls `_run.loop`, `_run.addNumber` and
`_run.addList`, see section 9):

```js
// The loop as a function of a sub-range of pass indices; a worker receives
// this text once.
(_a, _s, _i0, _i1, r, _len_L) => {
  let L = _SYS.zeros(_len_L);
  for (let _i = _i0; _i <= _i1; _i++) {
    const k = _a + _s * _i;
    /* the body */
  }
  return [L];
}

// The asynchronous copy of `count`.
const _fn_count$async = async (H, n) => {
  let L = _SYS.ownedCopy(H);
  let r = _SYS.atNumeric(H, 4, "integer");
  { const _sums = await _SYS.poolLoop(0, /* first */ 1, /* last */ n, /* step */ 1, [r], [L.length]);
    if (_sums === undefined) { /* the loop in order, as run() has it */ }
    else L = _SYS.addSums(L, _sums[0], /* in place */ true); }
  L = _SYS.replaceAtInPlace(L, 4, n + r);
  return L;
};
```

A program with no such loop gets no second copy: its `runAsync()` calls
`run()`.

**The state of a call.** `run()` sets state for the time of the call (the
reconstruction digits, in `ComputeEngineFunction` of `javascript-target.ts`)
and restores it at the end. An asynchronous program leaves the thread at each
wait. So the runtime saves this state before each wait and sets it again when
the program continues, and restores the caller's state when the program
leaves the thread. Two calls of `runAsync()` can then be pending at the same
time, on one result or on one engine: each has its own locals and its own
saved state. No wait happens while a random frame is installed: the positions
that install one (`WithRandomSeed`, the passes of an outer `parallel for`)
are not positions that can wait (condition 1).

**The run of a loop.** The calling thread computes the count of passes with
the code of the in-order loop, which also makes its checks (a step of zero, a
count that is too large). It splits the pass indices into one sub-range for
each worker, in order, and sends each worker one task: a new kind of message,
`call`, which runs a stored function once with arguments and returns its
value. The message carries the engine's iteration limit, as the `run` message
does, and the worker sets its runtime state for the task in the same way. A
time limit set with `ce.withTimeLimit()` is not seen by a worker, and its
span ends when its function returns, before the promise settles. When all
tasks are done, the calling thread adds the returned values to the
accumulators, one sub-range after the other.

**The addition to a list.** The in-order loop writes a list accumulator in
place only when the ownership analysis of `in-place-update.ts` shows that no
other variable holds the same list; otherwise each write makes a copy. The
addition of the sums follows the same decision for the same loop: in place
when the in-order writes are in place, and into a new list, assigned to the
accumulator, otherwise. So a second variable that holds the list before the
loop (`const before = L`), and the input list of the host, keep their values,
as with `run()`. An element whose sum is 0 is not written.

**Errors and failures.** When a task fails, for an error of a pass or for a
failure of the worker, the calling thread runs that sub-range itself, with the
same function. A sub-range that fails there too throws its error, and
`runAsync()` rejects with the error of the first such sub-range, which is the
error of the first failing pass, the one that `run()` throws.

**Abort.** A signal that is already aborted at the call rejects the promise
with `signal.reason` before any statement runs. An abort while the program
waits for the workers makes the awaited call throw `signal.reason`: the
program stops at the loop, and the promise rejects. The pool drops the tasks
that it has not sent. The emitted loop does not read the pool's cancel flag,
so a worker that still runs a sub-range is terminated and replaced after the
pool's grace period (250 ms by default), as for a batch that does not answer.
An abort has no effect while the calling thread runs statements: the program
sees it at its next pool loop.

**The calling thread** is free only while the program waits for the workers.
The statements outside the pool loops, a loop that runs in order, and a
sub-range that the calling thread runs after a failure are synchronous, as in
`run()`; `runAsync()` does not yield to the event loop between them
(`broadcastAsync()` does, between slices). The host must not change the
values of `inputs` until the promise settles.

## 5. Values

`run()` adds each term to the accumulator, in the order of the passes. The
pool adds the terms of each sub-range to zero, then adds these sums to the
accumulator, in the order of the sub-ranges. The `parallel for` plan already
says that the order of the additions is not specified (its section 4). The
consequences:

- **Equal to `run()`:** an accumulator whose static type is `integer` (a
  number, or a list of integers), while its value before the loop and every
  partial sum stay within ±2^53. The statements outside the loops run the
  code of `run()`, so they give its values when the accumulators are equal.
- **Can differ from `run()`:** an accumulator of real numbers, and one of
  integers beyond 2^53. The difference is that of another grouping of a
  floating-point sum. It is usually in the last bits, but it can be larger
  (terms that cancel, a sum that overflows in one grouping only), and a later
  test of the value (`if s > 2000`) can then take another branch. With one
  sub-range for each worker, the grouping depends on the size of the pool
  (decision D3).
- **The sign of zero:** an element that holds `-0` before the loop keeps `-0`
  when the sum of each sub-range is exactly 0; `run()` gives `+0` when a pass
  adds `+0` to it. An element that no pass writes keeps its value in both
  (`-0`, `NaN`, an infinity).

## 6. Decisions

| | Question | Recommendation | Alternative, and what it costs |
|---|---|---|---|
| D1 | In which positions can the loop run on the pool? | The statement positions of condition 1. | **Smaller:** only a loop that is a direct statement of the function that the program calls. This is enough for the witness; `for f in 1..10 { parallel for … }` and `let A = step(H, n)` inside another function then run in order. **Larger:** every position. About 40 lines of the compilation code open a JavaScript function around a part of a program (`(() => {`), and each one needs an asynchronous form; a callback of a library function (`map`) cannot wait at all. |
| D2 | When is a range large enough? | A fixed count: 20,000 passes, the count that `broadcastAsync()` starts from, with the option `minPasses`. A loop of 5,000 passes that take 1 ms each then stays on one core unless the host sets `minPasses`. | **Measure:** the calling thread runs the first 1,024 passes, and the pool takes the rest when the estimate for the whole loop is above 10 ms. It finds the slow passes with no help from the host. It adds code, and a second way to split the range. |
| D3 | How many sub-ranges? | One for each worker, as the issue asks. When the passes of one part of the range take longer, the workers of the other parts wait for it. The passes of the witness have the same spread of costs in every part of the range (its samples are a low-discrepancy sequence). | **A fixed count** (16), which the workers take one after the other: a real accumulator then has the same bits on every device that has a pool, and a slow part of the range delays one worker for a shorter time. It costs 16 private lists and 16 additions of a list for each loop, in place of one for each worker, and the value still differs from `run()`. The measurement of the witness in step 3 can compare the two. |
| D4 | The names | `runAsync`, `willParallelize`, `minPasses`, `onLoop`. | Any other names; `willUsePool` is taken (it describes `broadcastAsync()` and takes a count of cells). |

If nothing is decided, nothing is built: CE-1163 stays in `needs-design`, the
witness runs on one core, and Tycho keeps the workaround of the issue (it
splits this one step in its own workers).

## 7. Not in this version

Each item runs in order today and under this proposal, and is added when a
`corpus` or `plausible` witness needs it.

- A parallel comprehension (`[f(k) parallel for k in 1..n]`).
- A pass that draws random numbers. The frame of pass `k` depends only on the
  seed, the loop and `k` (`docs/RANDOMNESS-MODEL.md` section 3, "Pass
  frames"), so a worker could build it.
- A loop over a list, and an accumulator that is not a real number or a list
  of real numbers.
- A program with an `iterationBudget`.
- `runAsync` on a stored result that the runtime entry rebuilds
  (`createJavaScriptRuntime()`), and on a result called with positional
  arguments (`calling: 'lambda'`).

## 8. Steps and definition of done

1. **The pool:** the `call` task in `kernel-protocol.ts`, `kernel-pool.ts` and
   `src/kernel-worker.ts`. The check of the runtime version that the pool
   makes when a worker starts already refuses a worker file of another
   release (`RUNTIME_VERSION` is the package version), so nothing changes
   there. Tests with the workers of
   `test/compute-engine/kernel-pool.test.ts`.
2. **The compiler:** the conditions of section 3, the loop as a function, the
   asynchronous copy, and the two texts stored on the result. This step also
   finds which emitted forms of a user function can wait (condition 1) and
   records the others in `docs/COMPILATION-MODEL.md`.
3. **The runtime:** `runAsync`, the state of a call, the run of a loop (split,
   addition, the rule for errors and failures, abort), `willParallelize`,
   `onLoop`.
4. **Documents:** `docs/COMPILATION-MODEL.md` (the pool route, each condition
   with its example, and the values of section 5), the status line of the
   `parallel for` plan, `src/epsil/docs/control-flow.md` ("Parallel loops"),
   `~/dev/cortexjs.io/docs/compute-engine/13-guide-compile.md`, and a
   CHANGELOG entry.

Done when these tests pass, each on a real pool:

- the witness-shaped step of `test/epsil/parallel-for.test.ts` gives the same
  counts through `runAsync()` as through `run()`, and `onLoop` reports
  `route: 'pool'`;
- each position of condition 1 that can wait (inside an `if`, inside a `for`,
  in a second function) reports the pool, and each position that cannot
  reports nothing;
- each of the conditions 2 to 8, and each run-time condition, has a program
  where `onLoop` reports the calling thread or is not called, and the value is
  the value of `run()`;
- `willParallelize` is `true` for a loop inside a called function, and
  `false` with no pool and for a count under the threshold;
- for each pass of a sub-range, the loop function gives the value of the same
  pass in `run()` (a range with a negative step and one with bounds that are
  not integers included);
- an accumulator of real numbers is within a stated bound of `run()`, and one
  of integers is equal;
- the input list, and a second variable that holds the accumulator's list,
  are not changed;
- the engine's iteration limit, set below the worker's default, makes the
  same pass throw as in `run()`;
- a program that uses the reconstruction digits after the loop gives the value
  of `run()`, and so do two calls that are pending at the same time;
- an error of a pass, a worker that fails, a signal aborted before the call,
  and an abort during the wait.

Also: Tycho's instrument
(`~/dev/tycho/scripts/repros/2026-11-08-ce1163-parallel-for-workers.mts`)
prints `CE-1163: READY` (it tests only that `runAsync` exists), and the report
gives the run time of the witness with `run()` and with `runAsync()` on a pool
of 8 workers in Node. The proposal promises no number; Tycho's measurement by
hand is the expectation.

## 9. The result

The code differs from sections 3 and 4 in these points. The user documents
(`docs/COMPILATION-MODEL.md`, "The worker pool and `parallel for`:
`runAsync()`") describe the code.

1. **One form of each function in the copy.** A user function on the way to
   a loop exists only in its `async` form in the asynchronous copy. So when
   the program also uses the function in a position that cannot wait, its
   loops run in order, also at its calls that could wait (the reason is
   `'position'`): `let a = g(4); a + max(g(2), 1)` runs both loops in order.
   The same applies to the functions that such a function awaits.
2. **A substituted body.** A body that the compiler substitutes into its
   caller (`compile-user-calls.ts`) keeps its loop in order, and the loop
   never calls `onLoop`: no body block of a function declares its
   accumulator (`isLocalOfEnclosing()` in `pool-loop.ts`).
3. **A random frame.** A loop that the program reaches while a random frame
   of the engine is installed runs in order and does not call `onLoop`: a
   wait would leave the frame installed while other code runs.
4. **Abort before a small loop.** An abort makes the next pool loop throw
   `signal.reason` before its other checks, also when its count of passes is
   under `minPasses`.
5. **A worker that fails.** `onLoop` receives `route: 'calling-thread'`,
   `reason: 'pool-declined'` when a worker does not complete its sub-range
   (an error of a pass, a failure of the worker, a pool that turns out to be
   unusable), and the calling thread runs that sub-range again.
6. **A bounded count of emissions.** The copy is emitted at most 6 times
   (retries without the loops of a function with a use that is not a waited
   call, then each loop alone). After that, the program gets no copy and its
   loops run in order with the reason `'position'`.

The positions that keep a loop in order: an operand (`total(H, 4) + 1`), an
argument of a call (`max(total(H, 4), 1)`), a callback of a library function
(`map`), the argument of `WithRandomSeed`, two calls in one statement, the
body of another `parallel for`, a function of a block with a default value
of a parameter (its arrow is wrapped), a variant of a function for one shape
of call, the loop form of a list recursion, and a body substituted into its
caller. The positions that can wait are a statement of the program or of a
function body, also inside a nested block, the branches of an `if` and the
body of a `for` or `while`; and a call that is a whole statement, the value
of a declaration or of an assignment, the last value of a body, or the whole
body of a function. The last-call memo does not wrap an `async` function of
the copy, so a function of the engine that `run()` calls through the memo
can wait in the copy.

**The measurement of the witness** (2026-11-08, Tycho's `buddhabrot` step in
its `parallel for` form, 1.2 million samples, Node 26.13.0, Apple M5 Max, a
pool of 8 worker threads, the median of 7 runs after a warm-up, load average
1.9): `run()` 257.0 ms, `runAsync()` 39.6 ms, with equal counts. The `for`
form of the entry ran in 242.6 ms with `run()`. Compiling the witness-shaped
program of `test/compute-engine/ce-1163-pool-loop.test.ts` took 33 ms with
the asynchronous copy and 27 ms without it (the median of 20 compilations).
