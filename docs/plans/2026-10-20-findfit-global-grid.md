# `FindFit` global search: a grid that lands in every basin, bounded cost, and the worker pool

Status: approved 2026-10-20 by the user (Tycho ledger row 407, with step 5 of
`docs/plans/2026-10-20-worker-kernel-pool.md`). Phase A, INCLUDING phase A2,
IMPLEMENTED 2026-10-20 on the main tree (uncommitted, dual-reviewed, 9
findings applied; test `test/compute-engine/find-fit-global-grid.test.ts`).
Measured (section 3.5 gate): with 3.1 to 3.4 alone the two-parameter grid of
398 × 20 points cost about 400 ms on 200 rows, over the 250 ms budget, so A2
was required; with A2 the three deciding cases take 45 to 70 ms and the
1,000-row case over `[0.3, 628]` about 260 to 330 ms (it was 400 ms and
missed). Review findings changed the design in four places, recorded in the
sections below: the refinement of a least-squares phase runs with that phase
unbounded and wraps the result back into its range (3.6); the row sample is
stratified, not evenly spaced, and the 24 best sampled minima are re-scored on
every row before the 6 refinements (3.4); sample residuals only rank and a
timeout during a sampled scan reports `residualNorm: NaN` (3.4); the rates are
converted to radians with the engine's angular unit, and `Tan`/`Cot` use the
period π (3.1). Open residue: a power of a periodic function (`cos(b x + c)²`,
period π) is spaced as the inner function (period 2π). Phase B follows once
Tycho has adopted phase A.

## 1. The problem (Tycho row 407)

`FindFit` with the `global` option samples each searched parameter on a grid
with a fixed number of points (`SEPARABLE_GRID = [400, 40]` in
`src/compute-engine/nonlinear-fit.ts`: 400 points for one searched parameter,
40 × 40 for two), solves the linear parameters at each point, and refines the
six best local minima of the grid by Levenberg–Marquardt.

For the model `a cos(b x + c) + d x + e` on 200 exact points over `x ∈ [0, 10]`
with `b` and `c` searched, the sum of squared residuals as a function of `b`
has a basin around the true frequency about `π / span(x) = 0.3` wide: two
frequencies that differ by more than that are a half turn apart at the far
end of the data, so the fit at one says nothing about the other. Over
`b ∈ [0.3, 60]` the 40 grid points are 1.5 apart and the search finds `b =
2.2` only because a point happens to fall in its basin; over `[0.3, 120]` it
does not (RSS 390, `b = 0.3`); with `b = 50` the opposite pair holds. Tycho's
range for a frequency is `[π / span, 2π / smallest gap]`, which is `[0.3, 125]`
for 200 points and `[0.3, 628]` for 1,000, so the search misses in ordinary
use.

Cost: on 1,000 rows the search takes about 360 ms, over Tycho's 250 ms
backstop, so Tycho scans a sample of 500 rows and then fits locally on every
row from the values the scan found.

## 2. What Tycho asks, and the decision

- Space the grid of a searched parameter so that it lands in every basin,
  or refine the grid around its best cells, or let the caller give the step
  or the number of points.
- Keep the cost bounded on many rows, so Tycho can remove its own sampling.

Decision (user, 2026-10-20): do all three in the engine. Space the grid by
the basin width when the model shows the parameter multiplying a fit variable
inside a periodic function; accept a caller-given step; scan on a sample of
the rows when there are many and refine on every row; and run the scan on the
worker pool when the engine has one, through the plan-and-executor split of
`fit-executor.ts` (step 5 of the worker-pool plan).

## 3. Phase A: the grid and the cost, on the calling thread

### 3.1 Basin-aware spacing

When a unit is prepared (`prepareUnit()`), the renamed model is walked for a
periodic function node (`Sin`, `Cos`, `Tan`, `Cot`, `Sec`, `Csc`) with
argument `arg`. For each fit variable `x_k` and each parameter `b_j`:

- `rate = ∂(∂arg/∂x_k)/∂b_j`, computed symbolically.
- When `rate` is a nonzero number literal `κ`, the parameter `b_j` scales the
  phase of that node across the data at the rate `κ` per unit of `x_k`, and
  the basin of `b_j` is about `π / (|κ| · span_k)` wide, where `span_k` is the
  extent of `x_k` over the rows of the unit (the maximum minus the minimum of
  the finite values).
- The unit records the pairs `(j, k, κ)` as `periodicRates`. A rate that is
  not a number literal (`cos(b² x)`, `cos(b x y)`) is not recorded: the
  parameter keeps the default grid.

For a searched parameter with at least one recorded rate, the step is the
smallest basin width over its rates, `step_j = min π / (|κ| · span_k)`, and
the number of grid points is `n_j = ceil((hi_j − lo_j) / step_j) + 1`, not
less than the default (`SEPARABLE_GRID[dims − 1]`) and not more than
`MAX_SCAN_POINTS_PER_PARAM = 4,000`. For `b ∈ [0.3, 125]` over a span of 10
this is 398 points; for `[0.3, 628]`, 2,000.

### 3.2 A caller-given step

The `global` option accepts a third element in a range: `b: [lo, hi, step]`
with `step > 0` sets `n_j = ceil((hi − lo) / step) + 1`, clamped to
`[2, MAX_SCAN_POINTS_PER_PARAM]`, and wins over the automatic spacing. A
non-positive or non-finite step is the usual `unexpected-argument` error.

### 3.3 The budget for two searched parameters

With two searched parameters the grid is the product of the two counts. A
total budget `SEPARABLE_BUDGET = 8,000` points bounds it: when
`n_1 · n_2 > budget`, the parameter WITHOUT a recorded rate (or, when both or
neither have one, the second) is reduced to `max(8, floor(budget / n_other))`.
A phase parameter inside a periodic function (`c` in `cos(b x + c)`) has a
basin about a quarter turn wide, so 8 to 12 points over one period are
enough for the LM refinement to find it from the nearest cell. The caller's
own step is never reduced; the error says so when two caller-given steps
exceed the budget.

The multi-start grid (`MULTISTART_GRID = [24, 6]`) is unchanged: a full LM
run per point cannot afford a fine grid, and the periodic shape is separable
in practice.

### 3.4 Scan on a sample, refine on every row

When the units hold more than `SCAN_SAMPLE_ROWS = 300` rows in total, the
linear scan runs on a deterministic evenly spaced sample of that many rows
(`round(i · (n − 1) / (count − 1))`, first and last row kept; the same rows
for the same inputs), chosen per unit in proportion to its size. The LM
refinements and the multi-start run on every row. The scan's residuals are
then not comparable to the refinements' residuals, which is fine: the scan
only ranks grid points; the record reports the refinement's residual as
today. A timeout during the scan reports the best scanned point computed on
the sample, with `timedOut: True` as today.

### 3.5 Expected cost, measured before landing

Serial, 200 rows, `b ∈ [0.3, 125]`, `c ∈ [0, 2π]`: about 398 × 12 = 4,776
grid points, each one linear solve over 200 rows (one model call and two
derivative calls per row), about 2.9 million kernel calls, about 200 ms at
the 75 ns per call Tycho measured. Tycho's deciding cases (its instrument
`scripts/repros/2026-10-20-ce407-findfit-global-grid-resolution-repro.mts`:
`n = 200`, `b = 2.2` and `b = 50` over `[0.3, 125]` and `[0.3, 120]`, RSS ≤
1e-12; controls `b ∈ [0.3, 60]` and the five-point `5hn1azxfc8` data over
`[0.1, 6]`) must pass, and the 200-row case must stay under 250 ms on the
calling thread on an idle box. If it does not, phase A2 is required before
landing.

### 3.6 Phase A2 (if needed for the budget): the phase of a sinusoid is linear

`a cos(b x + c) = p cos(b x) + q sin(b x)` with `p = a cos c`, `q = −a sin c`.
When a searched parameter `c` appears ONLY as an additive term of the
argument of one `Sin` or `Cos` node that is multiplied by one linear
parameter `a`, and nowhere else, the pair `(a, c)` is linear in `(p, q)`:
the scan solves `p` and `q` by least squares at each grid point of the other
searched parameters, so `c` leaves the grid, and the refinement starts from
`a = √(p² + q²)`, `c = atan2(−q, p)` (brought into the parameter's range).
This turns the two-parameter case of the Desmos shape into a one-parameter
scan of about 400 points.

## 4. Phase B: the scan on the worker pool (step 5)

- `FindFit.evaluateAsync()` (the engine's asynchronous evaluate) builds the
  same plan (`globalSearchPlan()`) and drives it with a `PoolFitExecutor` when
  `ce.workers` is set and the model's compiled code is shippable
  (`isShippableCode`, as `broadcastAsync` decides). The synchronous
  `evaluate()` keeps the inline executor.
- A new kernel-pool job kind `fit-scan`: the main thread ships, once per fit,
  the stored compiled kernels of the model and of its derivative columns, the
  sampled rows as one `Float64Array` per variable plus the targets, the fresh
  names, and the bounds; then one task per slice of grid points. The worker
  runs the same linear solve as `linearSolveAt()` (shared code in
  `fit-executor.ts`, no engine) and returns, per point, the solved vector and
  its residual, or the `null` / `nonlinear` codes.
- The plan reads results by index, so the slices can finish in any order;
  under a deadline the executor commits the finished slices only, as
  `broadcastAsync` does. A worker failure falls back to the inline executor
  for the remaining points.
- The LM refinements stay on the calling thread (six short runs).
- Measured target: the 1,000-row, `[0.3, 628]` case under 250 ms with 8
  workers.

## 5. Tests and records

- `test/compute-engine/find-fit-global-grid.test.ts`: Tycho's deciding cases
  and controls (ported), the caller-given step (valid, invalid), the budget
  reduction, the row sampling (same result with and without, up to the
  refinement tolerance; deterministic sample), a periodic argument whose rate
  is not a constant keeps the default grid, a non-periodic model keeps the
  default grid, and the timeout record during a sampled scan.
- Phase B: `kernel-pool.test.ts` gains the `fit-scan` job; parity of the pool
  and the inline executor on the same plan.
- CHANGELOG under "New Features"; ROADMAP row 407 and the worker-pool entry
  (step 5) updated; the user guide `doc/13-guide-compile.md` is not
  concerned, `doc/` for `FindFit` gains the `[lo, hi, step]` spelling.
