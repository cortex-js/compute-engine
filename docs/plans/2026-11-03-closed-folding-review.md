# Closed constant folding, November 3–4, 2026

The growth is primarily repeated, bounded cost estimation, plus associative
operand flattening in the one admitted numeric evaluation. The graph does not
establish a correctness defect or justify a linear whole-compilation budget.
A small negative lookup memo makes the existing estimation cheaper without
changing its visits, costs, eligibility, evaluation, output, or limits. Quiet
source measurements improve depth-24 warm compilation from 74.2 to 22.7 ms
(about 3.3×). The representative host controls show no broad gain.

Raw accepted process measurements, excluded-process CPU samples, source patches,
profiles, value observations, summaries and mutation controls are in
[`closed-folding-2026-11-03.json`](../../benchmarks/closed-folding-2026-11-03.json).

## Scope and reproducibility

Baseline `ea4f58fa8` includes traversal fix `3a00e5cc1`. Node 26.13.0, Apple M5
Max, 18 cores, source loaded with tsx and shared dependencies, machine precision.
The baseline and candidate use isolated detached worktrees; concurrent compiler
edits in the shared checkout are excluded. A separate default-precision control
reproduces the original counts too. No commit or publication is part of this task.
The raw artifact includes both experiment patches and the dependency lock hash.

The base is `ce.function('Add', [ce.number(2),
ce.function('Sqrt', [ce.number(3)])])`; every level uses
`ce._fn('Add', [e,e])` with the same operand object twice. `_fn` deliberately
retains associative nesting. Construction and canonical work during setup are
untimed. The independent oracle is `2 ** depth * (2 + Math.sqrt(3))`, not the
interpreter. Recorded actual values agree at all four requested depths.

```sh
MODE=check node --import tsx benchmarks/closed-folding.mjs /path/to/checkout
MODE=profile node --import tsx benchmarks/closed-folding.mjs /path/to/checkout
MODE=timing RUNS=5 ITERATIONS=5 node --import tsx benchmarks/closed-folding.mjs /path/to/checkout
npx jest --watchman=false -w 2 -- test/compute-engine/compile-folding-work.test.ts
```

Hold the box lock for timing and monitor competing CPU. `ONLY` selects full ids.
To reproduce the candidate, apply its recorded patch to the baseline revision.
The final source differs from the measured source only in manual line wrapping;
esbuild emitted identical JavaScript before/after that formatting correction.

## Measured work and its source

The counter observes the original outer Add nodes only, excluding the base Add,
number objects and new expressions. It counts getter calls, not total engine
work or elapsed time. All these counts remain identical after the adopted fix.

| Depth | Folding on | Folding off | Estimator reads | Collection-size reads | Flatten reads |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | 300 | 228 | 15 | 14 | 28 |
| 8 | 1500 | 460 | 255 | 254 | 508 |
| 16 | 95752 | 924 | 43231 | 43090 | 8188 |
| 24 | 256978 | 1388 | 123399 | 122864 | 8188 |

The original four observations reproduce exactly. Stack attribution identifies
the immediate reader; collection-size queries are subordinate estimator work.
At depths 4/8 the root costs 63/1023 visits and folds. Depth 12 costs 16383 and
still folds. At depth 13 the next charged visit after 20000 returns Infinity.
Depths 16/24 make 9/25 top-level estimator calls rooted at several levels.
Levels above 12 each stop at 20001 charged visits; level 12 is estimated twice
before the evaluation-result memo is consulted. Only one original function
receives `.N()`, at level 12. The synthetic fixture uses one target object.

`holdMap()` flattens associative operands before numeric evaluation, and
`flattenWithPositions()` locates their original positions. Flattening materializes
occurrences: its observed reads are `2 * (2 ** depth - 2)` while the root folds,
then plateau at 8188 when only the depth-12 subtree folds. This work legitimately
exceeds distinct-node count. The function wrappers record no canonical reads,
rebuilds or `.json` reads on this synthetic compilation; numeric internals and
all serializer APIs are not covered by those wrappers.

The quiet inspector sample (100 warm depth-24 baseline compilations, 1 ms
sampling) places about 80% of sampled time under `foldCostEstimate`. Definition
lookup and native console/assert frames are prominent. This corroborates the
lookup experiment, but these are instrumented source proportions, not plain-run
latency fractions or a packaged-build profile. The remaining sampled work is not
precisely separated into every evaluation/rebuilding subcategory.

## Limits and the adopted fix

The estimator allows 20000 visits, has depth limit 48 and cost ceiling 200000.
The visit limit binds first here. These are per-estimate limits, not one total
compilation budget. Charging occurrences is a conservative eligibility decision;
replacing it with a distinct-node count could admit larger evaluations. All
limits and charged visits are preserved.

`calleeBodyCost()` repeatedly asks whether `Add` has a user-defined function
body. At depth 8, one estimate makes 511 such definition lookups. The new memo
remembers a successful **no-body** answer, reducing that to one lookup. Its
lifetime is one `FoldCostContext`; its keys are current lookup-context identity
(engine fallback), `_cacheGeneration()` and name. The generation includes
state, static-view and shield distinctions. A definition change invalidates the
answer. Errors propagate before insertion; actual user bodies still take the
existing captured-type and positive body-cost paths. No evaluation result or
fold-gate cache is widened; no existing target/binding key is removed.

Every occurrence still contributes its original cost and visit charge. All 24
fixture output hashes, operand reads, cost/visit traces, folding decisions,
targets, evaluation calls and function-operation counts agree before/after.
The same constant used inside and outside a function parameter is evaluated
twice: target 0 has no bound names, target 1 binds `t`. This compatible-context
work is retained.

Evaluation keeps its iteration limit and the fold's 10000-element materialization
cap. Normal literal inlining caps at 49 elements, with target overrides. There
is no per-fold wall-clock deadline; an ambient caller deadline still applies.
These collection limits do not bind this scalar graph. Default CSE shares the
residual additions: depth-16/24 expression code is 127/365 characters (folding
off: 522/778). Fully folded depths 4/8 emit 18/17 characters. These compact
outputs are observations, not a global source-size guarantee. The separate
20000-node assigned-value expansion cap and 50000-node shader definition cap
do not stop this directly supplied JavaScript graph; CSE limits likewise do
not bound all emitted source.

An earlier experiment postponed collection-size operand reads until a supported
head needed them. It reduced depth-24 reads from 256978 to 134114, but warm
latency stayed near 75 ms. That patch and its zero-read check were rejected.
Getter traffic was a poor proxy for the costly lookups. Both experiments are
recorded separately; only the measured lookup fix is retained.

## Quiet serial latency

The lock was acquired at load 2.5/3.6/3.9 and released at 1.1/1.6/1.8. Chrome
renderers were paused by the
user. CPU was sampled every 0.5 s; a whole process was excluded if a competing
process reached 60% CPU. Accepted samples still include ordinary activity below
that threshold, and sampling cannot rule out shorter unsampled interference.
The final comparison has three accepted processes per variant in serial
baseline/candidate, candidate/baseline, baseline/candidate order; ten processes
were excluded. The earlier 7-by-10 attempt had six excluded processes and no
accepted measurements. The getter-only comparison used the shorter settings
below and excluded thirteen processes. No excluded timing values are used.

First calls use five fresh engines/expressions in a loaded process. Warm calls
follow five untimed warmups and use five batches of five compilations on the
same engine/expression. Setup, result-array allocation and every result check
are outside timers. Per-compilation folding memos reset; applicable engine and
expression caches remain. Tables show medians of process medians in ms; raw
trials and process ranges are retained. This local sample does not establish
small regressions or gains, runtime throughput, startup or document-open cost.

| Shared depth, folding on | First baseline / candidate ms | Warm baseline / candidate ms |
| ---: | ---: | ---: |
| 4 | 1.064 / 1.040 | 0.446 / 0.448 |
| 8 | 2.007 / 1.927 | 1.462 / 1.302 |
| 12 | 16.139 / 14.404 | 15.160 / 13.558 |
| 13 | 19.692 / 14.579 | 19.268 / 13.962 |
| 16 | 34.183 / 16.796 | 33.938 / 16.443 |
| 24 | 73.899 / 23.086 | 74.193 / 22.732 |

At depth 24 with folding off, first is 0.905/0.879 ms and warm 0.479/0.482 ms.
This route does not pay the repeated fold-cost lookups. At depth 12 evaluation
flattening remains substantial, so the gain is smaller than at depth 24.

Unshared function graphs allocate a separate Add at every path (number interning
remains); setup stays untimed and the mathematical oracle is identical.

| Fixture | First baseline / candidate ms | Warm baseline / candidate ms |
| --- | ---: | ---: |
| Unshared 4, fold True | 0.966 / 0.890 | 0.455 / 0.423 |
| Unshared 4, fold False | 0.749 / 0.778 | 0.306 / 0.307 |
| Unshared 8, fold True | 10.825 / 10.613 | 4.840 / 4.746 |
| Unshared 8, fold False | 8.372 / 8.457 | 3.091 / 3.078 |

| Host, folding on | First baseline / candidate ms | Warm baseline / candidate ms |
| --- | ---: | ---: |
| slider-js | 0.513 / 0.563 | 0.287 / 0.296 |
| slider-wgsl | 0.687 / 0.714 | 0.354 / 0.359 |
| map | 2.231 / 2.072 | 0.372 / 0.365 |
| constant-parameter | 1.202 / 1.189 | 0.659 / 0.651 |

The raw artifact also contains folding-disabled host results. For example Map
with folding off is first 0.565/0.549 ms, warm 0.270/0.265 ms. WGSL validates
emitted operators and live `T`/`x` identifiers, not GPU execution. These small
host differences do not establish a broad improvement.

## Regression controls and validation

The estimator test bounds one depth-16 estimate by twice the existing visit
limit in operand reads (estimator plus collection-size query), expecting
Infinity. An admitted depth-12 cost oracle prevents an early decline from
passing vacuously. The new lookup check expects one resolution for the repeated
built-in during one estimate; a separate check changes the definition and
requires a positive user-body cost. No linear whole-compilation budget or new
timing assertion is adopted.

All four checks were run against deliberately regressed final source: remove
the visit cap, decline immediately, disable the negative hit (511 lookups), or
ignore generation (stale zero after assignment). Each fails with exit 1, and
original bytes are restored in `finally`. The benchmark also rejects a wrong
numeric leaf and a WGSL slider frozen to 2.0. The rejected getter experiment's
zero-read control was likewise checked, but that check is not retained.

Final isolated validation: typecheck; six focused suites (231 passed, one
skipped); core (18 suites, 5501 tests, 1374 snapshots, 15 skipped); changed-source
Oxlint and trap scan. All passed, no snapshots changed. The first core command
could not start Jest because sandboxed Watchman access failed; the certified
rerun uses `--watchman=false`. No source import, public behavior or external
guide changes. The full suite is left to the nightly process: no boxed-expression,
type, configuration, dependency or broad-snapshot trigger applies; the baseline
was four commits after the recorded green mark.

The harness completed two independent review rounds, fixing four measurement/
oracle labels. The getter source experiment was discarded. The new lookup
change is separately dual-reviewed: Codex found no defect; Claude requested two
line wraps, fixed manually, and both formatting-only delta reviews found no regression.
Applied only the task's hunks to the shared tree, preserving the overlapping
compiler and benchmark changes. Combined-tree typecheck, lint, all 24 harness
fixtures and six focused suites (231 passed, one skipped) passed with identical
before/after source/test fingerprints. The isolated core run remains distinct
from that combined-tree check. The seven-file staged set also passed typecheck alone in a detached checkout
at HEAD with the staged diff applied. Temporary worktrees and investigation
files were removed after verification; no commit or publication.

## Remaining coverage and separate tasks

No correctness defect or unbounded exponential compilation is established by
this graph. Pure structural lookups can be shared, while evaluation reuse,
binding contexts, targets, output size and occurrence materialization retain
their distinct rules. No universal traversal framework is introduced.

The Map control reaches two target objects and records 7 function canonical
rebuilds and 17 function `.json` reads; those paths exist but do not dominate
the synthetic tower. This is not a captured host-document corpus, heap-retention
study, arbitrary irregular-DAG/context matrix, packaged-build comparison or GPU
execution test. Static-view/shield cache distinctions were reviewed; the new
focused invalidation test directly exercises assignment, not every possible
context transition. Existing binding/effect and cross-target tests remain needed.

Separate possible tasks are an estimator redesign that explicitly preserves or
changes admission semantics, a change to associative flattening preserving held
operands, order and effects, a packaged-build profile, and a captured host-document
comparison. They are ideas, not added ROADMAP work or part of this patch.
