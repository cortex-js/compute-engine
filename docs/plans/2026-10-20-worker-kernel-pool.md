# Web workers for parallel numeric kernels: `FindFit` and array evaluation

Status: steps 1 to 4 SHIPPED in 0.159.0 (2026-10-20, dual-reviewed, 17
findings applied); step 5 APPROVED 2026-10-20 with Tycho row 407 (its first
feedback) and specified as phase B of
`docs/plans/2026-10-20-findfit-global-grid.md`; before that decision it waited
for Tycho's integration
feedback (section 8). The user approved steps 1 to 5 and the default pool size
on 2026-10-20, and declined the whole-engine worker protocol for now.
Measurements: `benchmarks/workers/*.mts`, results below.

What landed (files under `src/`): `compilation/broadcast.ts` (the loops, the
`INTERVAL_KIND` codes, the slice forms), `broadcast`/`broadcastAsync` on the
`javascript` and `interval-js` results, `compilation/interval-runtime.ts`
(`createIntervalRuntime`), `loadBroadcast`/`loadBroadcastSlice` on both
runtimes, `kernel-pool.ts` and `kernel-pool-types.ts` (`createKernelPool`,
`ce.workers`, the `workers` constructor option), `kernel-protocol.ts`, the
worker entry `kernel-worker.ts` (built as `dist/esm-min/kernel-worker.js`,
exported as `@cortex-js/compute-engine/kernel-worker`), and the moved interval
helpers `interval/run-support.ts`. Tests: `test/compute-engine/compile-broadcast.test.ts`,
`test/compute-engine/kernel-pool.test.ts` (Node `worker_threads` through the
tsx loader). Guide: `doc/13-guide-compile.md`, "Evaluating Many Points at
Once" and "Worker Threads".

Two rules the review added to the design: a result whose code draws from the
engine's random stream or names a host identifier (a function given by name, a
`vars` mapping to a global, a caller preamble) is not shippable and always
runs inline (`CompileTarget.hostNames`, `isShippableCode`); and a worker takes
one slice at a time while the rest of its queue waits on the main thread, so
an abort drops the queued slices and the cells after `done` are never
written.

## 1. The question

Can the Compute Engine use web workers (browser) or worker threads (Node) to
run a computation in parallel? Two computations were named: the global search
of `FindFit`, and the evaluation of a compiled function over an array of inputs,
in particular the interval-arithmetic function (`interval-js`) that a plotter
evaluates once per pixel column or once per cell of an implicit plot.

## 2. Summary of the answer

- A worker cannot share engine state. What crosses the boundary is text and
  numbers: the code text of a compiled function, typed arrays of inputs, and
  typed arrays of results. The engine already produces that text, and a
  runtime that rebuilds a compiled JavaScript function from it with no engine
  behind it already ships as `@cortex-js/compute-engine/runtime`. The interval
  target has no such runtime yet (section 5.3).
- Parallelism is only reachable from the asynchronous route. A synchronous
  `evaluate()` cannot wait for a worker, so `FindFit` keeps its serial handler
  and gains an `evaluateAsync` handler that uses a pool when the host provides
  one.
- The gains are real only above a size threshold. A 5-point Tycho fit runs in
  5 to 10 ms and a 2000-column interval plot in 1 to 2 ms; neither can gain
  from a worker. A 1000-row global fit (200 to 500 ms), a 10 000-row fit
  (2.6 to 6.2 s) and an implicit plot of 512×512 cells or more (150 to 600 ms)
  gain 4 to 6 times with 8 workers.
- The engine does not create workers on its own. The host passes a factory
  (`new Worker(url)` in a browser, `worker_threads` in Node) and a pool size.
  With no factory, every path runs as today.

## 3. Measurements (2026-10-20)

Conditions: Apple Silicon, 18 cores (6 performance, 12 efficiency), Node
26.9.0, engine imported from source through `tsx`, box lock held, load
average 4 on 18 cores (a quiet box; an earlier run under a load of 15 gave
the same gains within 10 %, and is not reported). Medians of 3 to 7
repetitions.

### 3.1 Serial `FindFit`, model `a cos(bx + c) + dx + e`

`benchmarks/workers/fit-serial.mts`. "Multi-start" is the `global` option on
`b` alone: the model is not linear in `c`, so 24 Levenberg-Marquardt runs.
"Separable" is `global` on `b` and `c`: the model is then linear in `a` and
`d`, so one linear solve on each of 40×40 grid points, then 6 refinements.

| rows | local fit | global `b` (multi-start) | global `b`,`c` (separable) |
| ---: | --------: | -----------------------: | -------------------------: |
| 5 (Tycho row 404) | 4.5 ms | 6.2 ms | 7.5 ms |
| 100 | 4.6 ms | 23.6 ms | 41.3 ms |
| 1 000 | 20.5 ms | 160 ms | 371 ms |
| 10 000 | 194 ms | 1 952 ms | 3 838 ms |

The time grows linearly with the rows: the cost is the compiled model and its
Jacobian columns evaluated on every row, on every iteration of every start.
The separable scan is the most expensive variant because 1600 grid points each
evaluate the basis columns on every row.

### 3.2 Worker start-up and message cost

`benchmarks/workers/worker-overhead.mts`, Node `worker_threads`.

| worker imports | time to ready |
| --- | ---: |
| nothing | 20 to 125 ms |
| the interval library (`src/compute-engine/interval`) | 38 to 156 ms |
| the compiled-code runtime (`createJavaScriptRuntime`) | 36 to 155 ms |
| the whole engine from the built bundle, one engine constructed | 180 to 302 ms |
| the whole engine from source through `tsx` | 282 to 402 ms |

The ranges are the two runs of the day; the quiet-box run was the slower one
to spawn, so the start-up cost is not a function of load alone. The import of
the kernel libraries adds 20 to 30 ms to a bare worker.

| message | copy | transfer |
| --- | ---: | ---: |
| `Float64Array` of 10 000 | 0.02 ms | 0.01 ms |
| `Float64Array` of 100 000 | 0.09 ms | 0.01 ms |
| `Float64Array` of 1 000 000 | 0.97 ms | 0.03 ms |

A kernel worker (runtime plus interval library, no engine) is ready in 40 to
160 ms. Message cost is negligible when the arrays are transferred. The pool
must be persistent: the start-up is 20 to 100 times the duration of a 1D plot.

### 3.3 Interval evaluation over an array of inputs

`benchmarks/workers/interval-parallel.mts`. The main thread compiles the
expression to `interval-js`. The serial baselines call `run()` once per cell,
and a function rebuilt from the `code` and `preamble` text (the path a worker
takes) once per cell. The workers are persistent, receive the code text once,
and receive and return transferred `Float64Array`s. Times are wall time of the
whole batch; the parallel results were checked equal to the serial ones.

| case | serial `run()` | serial, rebuilt from text | 1 worker | 2 | 4 | 8 | best gain |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1D `sin(x)/x`, 2 000 columns | 1.22 ms | 0.76 ms | 0.94 | 0.67 | 0.40 | 0.97 | 1.9× |
| 1D `sin(x²) + cos(3x)/(1+x²)`, 2 000 columns | 1.94 ms | 1.37 ms | 1.76 | 1.13 | 0.67 | 0.91 | 2.0× |
| 1D same, 200 000 cells | 150 ms | 116 ms | 150 | 69 | 50 | 36 | 3.2× |
| 2D `sin(x)cos(y) + x² − y² − 0.3`, 512×512 | 231 ms | 175 ms | 240 | 121 | 55 | 34 | 5.1× |
| 2D same, 1024×1024 | 885 ms | 748 ms | 780 | 373 | 181 | 126 | 6.0× |

Two observations:

- The rebuilt function is 20 % faster than `run()` on the main thread, because
  `run()` converts its argument object and wraps the result on every call.
  A batch entry on the main thread, with no worker, is worth having on its own.
- Below about 10 ms of serial work the gain is under 1 ms of wall time. A pool
  must not ship such a batch.

### 3.4 Parallel global fit, emulated with one engine per worker

`benchmarks/workers/fit-parallel.mts`. Each of K workers boots its own engine
and runs `FindFit` with `global` on a K-th of the range of `b`; the main thread
keeps the lowest residual. The engine cannot split one call yet, so each
worker still runs the full 24-point grid on its sub-range: K workers do K
times the starts. The table therefore reports the throughput gain (iterations
per millisecond, parallel over serial), not a speed-up of one call.

| rows | serial, full range | 1 worker | 2 | 4 | 8 | throughput gain |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 6.5 ms (514 iterations) | 6.5 | 6.4 | 7.7 | 10.3 | 4.8× |
| 1 000 | 172 ms (673) | 172 | 197 | 262 | 302 | 4.2× |
| 10 000 | 1 984 ms (678) | 1 989 | 2 111 | 3 071 | 3 874 | 3.7× |

Booting 8 engine workers in parallel took 370 to 965 ms. The gains are below
the interval case because LM runs are of unequal length, so the slowest worker
sets the wall time; a pool that hands out starts one at a time, instead of one
block per worker, balances this.

## 4. What exists today

- `FindFit` and `FindRoot` are lazy operators with a synchronous `evaluate`
  handler (`library/statistics.ts`) that calls `findFit` in
  `src/compute-engine/nonlinear-fit.ts`. The model and each analytic Jacobian
  column are compiled to JavaScript through `implicitCompileNumeric`; a model
  that fails to compile falls back to an interpreted `subs` that needs the
  engine.
- The LM core, `src/compute-engine/numerics/levenberg-marquardt.ts`, takes a
  residual callback and a Jacobian callback over plain numbers and never
  touches an expression.
- The `global` option (`solveGlobal`) runs every start in a serial loop and
  stops early at the first refinement that reports a deadline.
- A `javascript` compilation result carries `code`, `preambleOnce`,
  `preamblePerCall`, `entryPlan`, `reconstructionDigits` and
  `runtimeVersion`. `createJavaScriptRuntime().load(result)` in
  `@cortex-js/compute-engine/runtime` rebuilds the function anywhere and
  refuses a mismatched `runtimeVersion` (`doc/13-guide-compile.md`, "Running
  Compiled Code Without the Engine").
- An `interval-js` compilation result carries `code` and `preamble`, and its
  `run()` is `new Function('_IA', '_', code)` applied to the
  `IntervalArithmetic` namespace. The public entry
  `@cortex-js/compute-engine/interval` exports that namespace whole (117
  helpers in the built bundle), so a host or a worker can rebuild interval
  code from its text today. What is missing is the loader itself: no
  `runtimeVersion` on the result, no `load(result)` that checks it and
  evaluates the `preamble` once, and no batch entry. (A first check on
  2026-10-20 reported 26 helpers missing; it had looked only at the entry's
  top-level exports, not at the namespace object. Corrected the same day.)
- An operator definition may carry both an `evaluate` and an `evaluateAsync`
  handler. `evaluateAsync(options)` takes an `AbortSignal`; `withTimeLimit`
  arms `ce._deadlineFrame`, which the fit checks per row and per iteration.
- `ce.jit === 'off'` (a strict Content Security Policy) disables every
  implicit compile. A worker on such a page is under the same policy in most
  deployments, so no worker path exists there.
- Tycho runs the engine on the main thread. Its adaptive implicit plotter
  (`src/plot/adaptive/`) evaluates the interval function cell by cell.

## 5. Design

### 5.1 The executor, with a serial default

An executor runs a kernel task and returns a promise of its result. Two
implementations:

- `InlineExecutor`: runs the task on the calling thread. It is the default,
  and the synchronous `evaluate()` route uses it directly without a promise.
- `WorkerPoolExecutor`: owns N workers created by a host factory, assigns
  tasks round-robin or by least load, and maps a cancel onto a `cancel`
  message or `terminate()`.

The host enables the pool through the engine:

```ts
const ce = new ComputeEngine({
  workers: {
    create: () => new Worker(new URL('@cortex-js/compute-engine/kernel-worker', import.meta.url), { type: 'module' }),
    size: Math.min(8, navigator.hardwareConcurrency - 1),
  },
});
```

In Node the factory returns a `worker_threads` `Worker`. The engine detects no
environment and imports no worker module itself, so the bundles stay the same
and tests run the inline executor by default. One Node test exercises the pool
through `worker_threads`.

The task set is small and fixed. Every task carries only text and numbers:

| task | input | output |
| --- | --- | --- |
| `load` | a compilation result (`javascript` or `interval-js`), the host's `runtimeVersion` | a kernel id, or a version error |
| `lm-start` | kernel ids of the model and of each Jacobian column (or none for finite differences), rows as a `Float64Array`, bounds, one start vector, iteration and time budgets | parameter vector, residual sum, iteration count, convergence flag |
| `linear-solve-at` | kernel ids of the basis columns, rows, the scanned values | the linear parameters and the residual sum |
| `eval-batch` | a kernel id, one `Float64Array` per variable (`lo, hi` pairs for intervals), a range | a `Float64Array` of results (`lo, hi, kind` triples for intervals) |
| `cancel` | a task id | nothing |

Arrays are transferred, not copied. A worker holds its loaded kernels for the
life of the pool and reports a `runtimeVersion` at start-up; the pool refuses
a worker whose version differs from the engine's.

### 5.2 The worker bundle

A new entry, `@cortex-js/compute-engine/kernel-worker`, built by
`scripts/build.mjs` next to `runtime` and `interval`. It contains the
JavaScript runtime (`createJavaScriptRuntime`), the interval runtime (5.3),
the LM core and the linear solve of `solveGlobal`, and the message loop. It
does not contain the engine. Expected size: under 600 KB minified (the runtime
bundle is 302 KB and the interval bundle 207 KB); expected time to ready: about
40 ms (section 3.2).

### 5.3 An interval runtime

`createIntervalRuntime().load(result)` rebuilds an `interval-js` compilation
result from its `code` and `preamble`, as the JavaScript runtime does, and
checks a `runtimeVersion` that the interval target starts to emit. The
`IntervalArithmetic` namespace it binds as `_IA` is the one the `interval`
entry already exports. The loaded function takes a struct-of-arrays batch
and writes a `Float64Array` of `lo, hi, kind` triples, so that a host
evaluating a plot on the main thread gets the 20 % of section 3.3 with no
worker.

### 5.4 Array evaluation on a compilation result

The compilation result gains a synchronous entry and an asynchronous one,
named `broadcast` and `broadcastAsync` (decided by the user 2026-10-20;
Tycho agreed, section 5.8). The shapes below take Tycho's answers of section
5.8 into account.

**Inputs.** `broadcast(inputs, options?)`, where `inputs` maps each free
variable to either a `Float64Array` (one entry per cell for `javascript`; a
`lo, hi` pair per cell for `interval-js`) or a single number (the same value
for every cell: a document variable bound as a point interval). Every array
has the same cell count. `options.layout: 'grid'` reads the arrays as the axes
of a regular grid instead: with `x` of `nx` entries and `y` of `ny` entries
the batch has `nx·ny` cells, row-major with `x` varying fastest, and the
arrays are not expanded on the caller's side. `options.out` is a caller-owned
output array that is filled and returned instead of a new one.

**Output.** A `Float64Array`: one value per cell for `javascript` (a boolean
result is `1` or `0`, a non-number result is `NaN`), and a `lo, hi, kind`
triple per cell for `interval-js`. The kind codes are exported as constants
(`INTERVAL_KIND`): `interval`, `empty`, `entire`, `singularPole` (no value),
`singularJump` (`lo, hi` hold the value), `partial` (`lo, hi` hold the value;
`domainClipped` is dropped, Tycho has no reader for it), `boolTrue`,
`boolFalse`, `boolMaybe` (a compiled comparison), and `error` for a cell whose
evaluation threw or returned malformed bounds. A bad cell never rejects the
batch. Half-infinite bounds are ordinary `interval` answers. The `at` and
`continuity` fields of a singular result are dropped.

**Parity.** `broadcast` gives, cell for cell, the value `run()` gives for that
cell's inputs: it calls the same compiled body with the same conversions
applied once per batch instead of once per cell. Tycho has parity tests and
will run them.

**Asynchronous form.** `broadcastAsync(inputs, options?)` takes the same
inputs and `out`, plus `signal` (an `AbortSignal`), `deadline` (milliseconds
of wall clock for the whole batch) and `chunk` (cells per task). It resolves
to `{ out, done }`, where `done` is the number of cells written: all of them,
or fewer when the deadline or the signal stopped the batch, in which case the
first `done` cells are valid and the rest are untouched. With no pool it runs
`broadcast` inline in chunks between microtasks, so a deadline still applies.
With a pool it splits the cells into chunks (default: the cell count divided
by the pool size, at least the threshold below), ships them, and writes each
returned chunk into `out` as it arrives. A batch whose estimated serial time
is under a threshold runs inline: the pool calibrates the threshold per kernel
from the first inline batch, with a default of 20 000 cells (about 10 ms for
the medium expression of section 3.3).

**The pool object.** `createKernelPool({ create, size, prewarm })` returns a
pool that an engine takes as `new ComputeEngine({ workers: pool })`, or that
is set later with `ce.workers = pool`. One pool serves several engines (Tycho
has one long-lived document engine and several short-lived ones). The pool
creates no worker until the first batch that needs one, unless `prewarm` is
set, in which case it creates them on idle time after construction so that a
document open does not pay the start-up. The worker is a self-contained file,
`dist/esm-min/kernel-worker.js` (no relative chunk imports), because Tycho
copies the engine files into its own `dist/` and resolves nothing by bare
specifier at run time. Node tests use a `worker_threads` factory.

#### 5.4.1 Why two entries, and the name

The user asked (2026-10-20) whether one asynchronous entry would do, and
whether `runBatch` is the right name.

Two entries, for four reasons:

- The engine already pairs `evaluate()` with `evaluateAsync()`. The same pair
  on a compiled function is what a reader expects.
- Tycho's adaptive plotter refines cells inside a synchronous paint pass. An
  asynchronous-only entry returns after the frame, so a plot of 2000 columns
  would lose a frame to gain nothing (section 3.3: under 2 ms of work).
- The synchronous entry is the primitive the worker runs. It exists in any
  case; exposing it costs nothing.
- With no pool, an asynchronous-only entry still allocates a promise and a
  microtask per call, which is the overhead the threshold of 5.4 avoids.

The name describes the result, not the mechanism. `runBatch` and `spawn` name
the mechanism, and `spawn` and `runParallel` are wrong for the synchronous
entry, which spawns nothing and runs on one thread. The engine's own word for
"apply a scalar function element by element over collections" is
*broadcast* (the `broadcastable` definition flag, the `_SYS.bcast` runtime
helper, `doc/13-guide-compile.md`), so the recommended pair is `broadcast` and
`broadcastAsync`: `f.broadcast({ x: xs })` applies `f` to every element of
`xs`. The plain-English alternative is `runMany` and `runManyAsync`. The name
is a rename away (`ts-refactor rename`) at any point before release.

`spawn` is a good name for a different, later feature: starting an evaluation
and getting a handle with `cancel()` and progress (section 5.7).

Tycho's adaptive implicit plotter refines cells by depth. It can submit all
cells of one depth as one batch, which is where the 512×512 and larger cases
come from; a 1D plot of 2000 columns stays inline.

### 5.5 `FindFit` on the pool

1. Refactor `solveGlobal` so that each start of the multi-start and each grid
   point of the separable scan is a task of section 5.1, executed through the
   inline executor. No behavior change; the existing tests stay green.
2. Add an `evaluateAsync` handler to `FindFit` and `FindRoot`. With a pool, it
   loads the model and Jacobian kernels once per call, submits the starts, and
   awaits them. A model that falls back to interpreted `subs` cannot be
   loaded; the call then runs inline. A finite-difference column needs only
   the model kernel and ships.
3. Selection rule: the lowest residual sum wins; ties break on the grid index.
   A completed parallel run gives the same record as the serial run. A run
   cut short by the deadline can differ: the serial loop stops at the first
   timed-out refinement, the pool reports whatever starts have finished. The
   record already reports `converged: false` in that case; the documentation
   states the difference.
4. Cancellation: the `AbortSignal` of `evaluateAsync` and the deadline of
   `withTimeLimit` send `cancel` to the running tasks; a worker that does not
   answer within a grace period is terminated and replaced.

### 5.6 Later kernels

Once the executor exists, these ship pure-number work the same way: Monte
Carlo integration (needs per-worker random substreams, which
`docs/RANDOMNESS-MODEL.md` does not define yet), multi-dimensional
`NIntegrate`, `NDSolve` parameter sweeps, the stochastic equality probes, and
auto-compiled `Map` drains over large ranges.

### 5.7 Epsil

The user asked (2026-10-20) how the pool reaches Epsil, and whether Epsil needs
a keyword for the parallel execution of an expression or a block.

**How Epsil reaches the pool today: it does not.** `execute-epsil.ts`
evaluates every top-level statement with the synchronous `evaluate()`, and the
command line, the REPL and the MCP server call `session.evaluate(source)`. A
pooled `FindFit` in an Epsil program therefore runs inline until the Epsil
executor has an asynchronous statement route. This is step 5b of section 7:
an `executeAsync` in the Epsil executor that awaits `evaluateAsync()` per
statement, used by the command line, the REPL and the MCP server; and a
`--workers N` option (default: the pool size of section 8, 0 disables) that
builds the Node `worker_threads` factory. The VS Code extension and the
debugger run through the same session object and inherit it.

**No keyword now.** Whether a kernel runs in parallel is an execution property
that the engine decides from three facts it already has: the kernel is pure
(`compilation/function-purity.ts`), it compiles (`implicitCompile`), and it is
large enough to pay for the transfer (the threshold of 5.4). Compilation is
implicit today for the same reasons (the `Map` auto-compile, `ce.jit`), and
parallel execution follows the same rule: the same program gives the same
values with or without a pool, so the user has nothing to declare. A
`parallel` keyword would be an assertion the engine must verify anyway, and
when it cannot honor it (an impure body, a closure over document state, a
random draw, a body that does not compile) it either raises an error or runs
serially in silence; both are worse than the implicit decision plus a
diagnostic. The diagnostic is the Epsil counterpart of
`map-auto-compile-stats.ts`: a static-check hint or a run report that says
"this `Map` ran inline because its body reads `x`, which is assigned in the
loop". Note also that `parallel` is taken in the library by the geometric
relation `Parallel` (`AB ∥ CD`), so a keyword with that spelling would need a
different word.

**What Epsil may want later** is task-level concurrency: start two independent
fits and await both, or start a long evaluation and keep a handle with
`cancel()` and progress. That is latency overlap, not data parallelism, and it
needs an evaluation model with suspension, which Epsil does not have. The
reserved words `async`, `await` and the user's `spawn` belong to that feature.
They stay reserved; this plan does not design them.

### 5.8 Tycho's answers (consult of 2026-10-20)

The Tycho point-of-contact session answered from Tycho's code; its full
record with every file and line is `docs/scratch/2026-10-20-ce-worker-pool-consult.md`
in the Tycho repository. What changes the design:

- **Result kinds.** Tycho reads `lo`/`hi` of `interval`, `partial` and of a
  jump `singular` (a `singular` with a value is a jump, without one a pole);
  the kind `partial` but never `domainClipped`; `singular.at` and
  `continuity` only as fallbacks that can go. Each comparison atom of a mask
  predicate is compiled to `interval-js` separately and read as true, false
  or maybe. Tycho wraps every call and answers its own `unknown` kind when the
  compiled function throws or returns reversed or NaN bounds, so the batch
  needs an `error` code per cell. This fixes the kind codes of section 5.4.
- **Per-batch scalars.** Document variables are bound as point intervals on
  every call, so an input may be one number for the whole batch.
- **Batch sites and sizes.** Every Tycho loop is synchronous inside a paint
  pass or a frame continuation; none awaits today. The region fill of an
  inequality is a regular grid of about 400×400 scalar calls per member and
  render (measured 29 ms per member, 7 µs per call); the heatmap lattice up to
  256×256; the CPU implicit quadtree evaluates one interval call per node on
  a frontier of 256 root cells to tens of thousands deeper, under an 8 ms
  frame budget and a 1.5 s total budget, with up to 720 456 nodes in a
  witness document; the 1-D sampler is a bisection tree of about 3 calls per
  node and cannot gain. Hence the `grid` layout, the synchronous entry for
  the paint pass, and the asynchronous entry for the settled render and the
  idle-sliced passes.
- **A deadline, not only a signal.** One Tycho document has a 20-deep
  recursive function at about 200 ms per call; Tycho checks a wall-clock
  budget per call. A batch needs a deadline or a chunk size with a partial
  result and the count of cells done.
- **Fits.** Tycho refuses a fit over 10 000 rows (`SOLVER_MAX_POINTS`), the
  largest corpus fit has 2 585 rows, and the global search samples at most
  500 rows and runs under a 250 ms backstop in idle slices after a commit,
  one `FindFit` call per slice, synchronous today. Measured on Tycho's side:
  the 2 585-row search takes 245 to 270 ms and is cut by the backstop; the
  500-row sample 66 to 99 ms. So the pooled fit serves the refinement slice
  (its first `evaluateAsync` call site), where cutting 100 ms to about 30 ms
  lets the search finish inside the backstop; the live tick stays
  synchronous and warm-started. Tycho also wants a progress callback (grid
  points done); how it travels through `evaluateAsync` options is open.
- **Workers and bundling.** Tycho has no worker today. It copies the engine
  bundle and the chunks its relative imports reach into its own `dist/` and
  loads it by URL, with every import of the engine an `import type`; a bare
  specifier resolves nothing at run time. Its Content Security Policy allows
  `new Function` and needs one line added for a same-origin file worker. The
  page is not cross-origin isolated, so no `SharedArrayBuffer`; transfer is
  enough (section 3.2). One long-lived document engine and several
  short-lived ones live on a page, so the pool is a separate object shared by
  engines, created lazily, with an optional prewarm on idle.
- **Name.** `broadcast`/`broadcastAsync` accepted; Tycho uses the word the
  same way.

- **Tycho's kernels ship** (confirmed by Tycho 2026-10-20 after the
  shippability rule was added): its compile step emits hidden document values
  as `vars: { name: '_.name' }` for both targets, passes no `functions` or
  `preamble`, and its one host override (the `At` handler) emits
  `_SYS.atNoWrap`, a runtime helper that exists on the worker. Rows with a
  random head stay inline, which is how Tycho already treats them. Tycho will
  wire the pool at the release that ships it: copy `kernel-worker.js` in its
  build, add `worker-src 'self' blob:` to its headers, one pool on the
  document engine, the region fill first for `broadcast` and the fit
  refinement slice first for the asynchronous route.

Probe documents named by Tycho: `neyret/oeupgr064p` (five implicit rows),
`neyret/kkkuocmqjr` (bit-extraction inequality), `neyret/1d8vyqtvoj` (noise
field), `neyret/ndqj7hupta` (the slow recursive function), and the fit
`txmculsx8y` group 1 (2 585 rows).

## 6. Constraints

- A strict Content Security Policy that sets `ce.jit` to `off` blocks
  `new Function` in the worker as well; the pool is then unavailable and the
  inline path runs.
- `BigDecimal.precision` is module-global per module instance; a worker has
  its own, and the kernels use machine floats only.
- The pool never changes a result on the main thread. Every kernel is pure,
  so the inline and parallel results agree except under a deadline (5.5).
- The engine must not depend on `SharedArrayBuffer` or `Atomics.wait`, which
  are unavailable on a browser main thread without cross-origin isolation.
  Transfer of `Float64Array`s is enough (section 3.2).
- `maxWorkers: 12` and the box lock apply to the Node test of the pool: it
  spawns at most 2 workers.

## 7. Plan and sizes

| step | content | size |
| --- | --- | --- |
| 1 | `broadcast` on the `javascript` and `interval-js` results, with the `INTERVAL_KIND` codes, per-batch scalars, the `grid` layout and `out`; `runtimeVersion` on the interval result | medium, no pool |
| 2 | executor interface and inline executor; `solveGlobal` on tasks | medium, no behavior change |
| 3 | self-contained `kernel-worker.js`, `createIntervalRuntime`, `createKernelPool` (lazy, prewarm, shared between engines), `workers` engine option, Node test | medium |
| 4 | `broadcastAsync` with `signal`, `deadline`, `chunk` and the partial `{ out, done }` result; threshold calibration | small |
| 5 | `FindFit`/`FindRoot` `evaluateAsync` on the pool; progress reporting (open: how it travels through the options) | medium |
| 5b | Epsil: `executeAsync` statement route; `--workers N` on the command line, REPL and MCP server (section 5.7) | small |
| 6 | Tycho: a `workers` factory and depth-batched implicit cells | Tycho side |

Step 1 pays on its own (20 % on the main thread). Steps 2 to 4 give array
evaluation its parallel route. Step 5 pays only for fits of about 1000 rows or
more; Tycho has documents with more than 10 000 points.

## 8. Decisions

Decided by the user on 2026-10-20:

1. Steps 1 to 4, the array-evaluation route: **yes**.
2. Step 5, the parallel fit: **yes**. Tycho has documents with more than
   10 000 points, where a global fit takes seconds (section 3.1).
3. Default pool size when the host gives a factory but no size:
   `hardwareConcurrency - 1`, capped at 8: **yes**.
4. A whole-engine worker protocol (MathJSON in, MathJSON out): **not now**.

5. The name of the array-evaluation pair: **`broadcast` and
   `broadcastAsync`** (decided 2026-10-20; Tycho agreed).
6. After Tycho's answers (section 5.8: fits are capped at 10 000 rows and the
   global search samples 500): **steps 1 to 4 proceed now; step 5 (the pooled
   fit) waits** for the integration of steps 1 to 4 in Tycho and its feedback
   (decided 2026-10-20). Step 2, the refactor that step 5 builds on, landed
   the same day with no behavior change.
