# Existing Tycho corpus evidence for compilation profiles

Read-only census, 2026-11-08. No compilation, benchmarks, tests, corpus runs, repository edits, or git mutations were performed. Counts below come from parsing existing JSON artifacts with Python. They describe CE 0.184.0, not the new worktree compiler. Numeric profile admission and concurrency capability are not established by these counts.

## Artifacts and provenance

| Artifact | Recorded Tycho commit | Generated UTC | Documents | Distinct audit records | Compile-call occurrences |
| --- | --- | --- | ---: | ---: | ---: |
| CORE digest/full `ce-0.184.0.json` | `a40372202` | 2026-11-08 23:57:41.281 | 97 | 1,101 | 1,316 |
| ALL full `ce-0.184.0-all.json` | `9d75660ed` | 2026-11-08 22:55:55.408 | 761 | 17,343 | 22,229 |

Paths relative to `/Users/arno/dev/tycho`:

- CORE digest: `tests/fixtures/ce-codegen/ce-0.184.0.json`, SHA256 `5af5ac0b1a49f599bfb938e778ae2478f493dc6da6fb94d51dd03b95ca7e80b7`.
- CORE full: `_TASK/desmos/desmos-corpus/codegen-audit/ce-0.184.0.json`, SHA256 `4d15c703e169e8ddc1a9bad93b4513562c1d9a8ada730a7933d564d32ddbfaed`.
- ALL full: `_TASK/desmos/desmos-corpus/codegen-audit/ce-0.184.0-all.json`, SHA256 `d13958d770884ebdb942a7b7305eaa37789b23a6a0d347a3c3923a3581e1ea4e`.

The CORE full/digest metadata and every `(id, hash)` pair agree. Counts and metadata are also saved in `corpus-counts.json` next to this report. The ALL artifact is older than the prelude-aware CORE arm and has no prelude metadata. It must not be treated as a larger, equivalent current baseline. The script header's corpus counts are historical estimates: use the artifact's actual document count.

## Counts by target and mode

| Scope | Target | Records | Success | Failure | Occurrences | Reported strict / complex |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| CORE | JavaScript | 712 | 701 | 11 | 863 | 706 / 6 |
| CORE | GLSL | 209 | 202 | 7 | 222 | 209 / 0 |
| CORE | interval-js | 180 | 179 | 1 | 231 | 180 / 0 |
| ALL | JavaScript | 8,867 | 8,817 | 50 | 11,440 | 8,542 / 325 |
| ALL | GLSL | 3,657 | 3,605 | 52 | 4,323 | 3,657 / 0 |
| ALL | interval-js | 4,819 | 4,753 | 66 | 6,466 | 4,819 / 0 |

CORE successful JS records report 695 strict and 6 complex. All 11 JS failures occur in `khpocp8io0`; their messages describe unsettled shapes in selections. These are recorded declines, not new defect claims. No document-level errors are recorded in either artifact.

CORE records split into showcase 414, art 241, and neyret 446. ALL splits into showcase 367, art 1,471, and neyret 15,505. The smaller showcase count in ALL is another reason not to infer that ALL is a superset of the newer CORE records.

`dedupe()` in `scripts/audit-ce-codegen.mts:1309` keys on target, input LaTeX, emitted code, preamble, error, and thrown error. It does not key on document, row, options, or binding environment. The first context wins; repetitions increment `occurrences`. Thus:

- A record is not necessarily a distinct semantic program or distinct consumer.
- `occurrences` measures compile calls during this load-time run, not evaluation frequency.
- `inputHash` hashes LaTeX alone; 711 distinct JS CORE hashes and 8,747 ALL hashes are text counts, not program counts.
- Duration is fastest compilation among merged calls; max duration is also recorded. These shared-machine timings are not a clean performance baseline.

## What can and cannot be inventoried from the artifacts

Every CORE record has free-symbol names and `freeSymbolTypes` (type, target lowering, provenance). The 712 JS records contain 1,472 `number`, 174 `array`, and 2 `complex` binding entries; these are entries across records, not unique symbols. 43 JS records have no free symbols. One JS record has a non-declared free-symbol provenance. Nine GLSL records do; interval has none.

Common JS declared input types include `real` (871 entries), a plot-range real (230), `list<nan | real | signed_infinity>` (143), `nan | real | signed_infinity` (130), and narrower ranged reals. There are also numeric tuples/lists, including six entries of `list<tuple<integer, real, real, integer>^224>`. The wider ALL arm has JS lowerings `number` (16,918 entries), `array` (899), `point` (176), `complex` (4), `function` (2), and `color` (1).

CORE JS options contain `iterationBudget` on all 712 records, `mode` on 673, `vars` on 88, and `broadcast` on 135 (134 true). No recorded JS `functions` option is present in this arm; that does not prove the product never uses host mappings.

The artifacts do not contain a typed MathJSON tree, types/conversions for each operation, resolved function definitions and captures, effect summaries, profile classification, worker portability, runtime call count, worker route, input values, or output values. Full records contain emitted source, but source text does not recover these facts reliably. An operator-name scan of LaTeX or generated JS cannot establish profile admission. No such profile percentage is claimed here.

## Prelude and lifecycle coverage

The newer CORE run records six successful preludes: Burning Ship, Multibrot, Buddhabrot, Julia Set, Game of Life, and Apollonian Gasket. There are 39 JS records with row `(prelude)`: 3 Buddhabrot, 4 Life, and 32 Gasket. Functions defined by the other preludes are compiled when called by plot rows, so zero `(prelude)` compile records does not mean their prelude was skipped.

The current setup at `scripts/audit-ce-codegen.mts:559` creates the real document manager, disables worker startup for the prelude check, applies document settings, seeds the prelude before the rows, waits for it, and replays its definitions. It runs with the in-process prelude iteration budget and no browser worker deadline. The record therefore proves neither worker execution nor production cancellation behavior.

The audit header explicitly limits the picture to load-time state (`scripts/audit-ce-codegen.mts:59`). No action is fired. The product can later rebind a formula-seeded collection as a live numeric list, changing the compilation environment and by-reference route. Include at least Life after one action and a changing numeric carrier when designing the next capture pass.

Buddhabrot must have separate kernel and program specimens. Its current prelude (`src/graph-paper/onboarding/template-data.js:1223`) constructs 90,001 counts, calls `step(H_0, 1200000)`, and defines tone/color functions. The outer sample loop uses a fixed low-discrepancy sequence, not random draws. The current source spells ordinary `for`, not `parallel for`; concurrency is a future workload requirement. Its per-cell plot is cheap list indexing and normalization; its expensive histogram construction is a distinct program with nested early-exit orbit loops and scatter updates. Only measuring the plot row misses the motivation entirely.

## Proposed representative extraction set

IDs refer only to the hashed CORE artifact above. Kernel/program classifications below are proposed test categories, not verified admission decisions.

| # | Workload and record locator | Purpose |
| ---: | --- | --- |
| 1 | `rainbow-trig`, JS 34 | Minimal scalar intrinsic and compile-latency control |
| 2 | `damped-oscillation`, JS 52 | Parameters, absolute value, product of transcendental operations |
| 3 | `fourier-harmonics`, JS 82 | Repeated argument, numeric constants, CSE candidate |
| 4 | `implicit-heart`, JS 59 and its interval/GLSL records | Two-input polynomial, cross-target numeric comparison |
| 5 | `domain-coloring`, JS 54 | Complex input and variable power |
| 6 | `burning-ship`, JS 8 plus definition B | Scalar kernel with local mutation, destructuring, early exit |
| 7 | `multibrot`, JS 15 plus M | Runtime degree and iteration-dependent arithmetic |
| 8 | `julia-set`, JS 31 plus J | User function, fixed orbit cap, slider-dependent parameters |
| 9 | `julia-set`, JS 28 plus shade/pick/seg/channel | Nested calls, color output, selections |
| 10 | `buddhabrot`, JS 21 | Numeric list construction prelude statement |
| 11 | `buddhabrot`, JS 22 plus step | Histogram construction, nested loops, scatter accumulation; primary concurrency experiment |
| 12 | `buddhabrot`, JS 25 | Shared-list scalar read and normalization, batching |
| 13 | `buddhabrot`, JS 23 plus c/tone | Read-only histogram color kernel and branch behavior |
| 14 | `game-of-life`, JS 174 | Program/local list update from captured list of seed indices |
| 15 | `game-of-life`, JS 176; repeat after an action | Live by-reference list lookup; lifecycle-sensitive cache/recompile test |
| 16 | `three-body-problem`, JS 249 | Nested numeric collection comprehension and reduction |
| 17 | `projectile-with-drag`, JS 362 | Numeric state-vector derivative with shared-list reads |
| 18 | `metaballs`, JS 242 | Indexed sum over function calls in 3-D |
| 19 | `metaballs`, JS 243 | Generated marching-cell block with integer index facts and batching |
| 20 | `frenet-knot-tube`, JS 244 | Numeric tuple result and three user calls |
| 21 | `apollonian-gasket`, JS 313–318 plus generations/fill | Recursive program and variable-size tuple-list generation |
| 22 | `khpocp8io0`, JS 423 | Negative control: keep a documented unsettled-shape decline rather than counting all numeric syntax as a kernel |

For per-target counterparts, match document plus authored row/input and inspect context; input hashes alone can lose environment distinctions.

## Repeatable capture and replay requirements

The existing full/digest artifacts are good locators and emitted-text baselines, but not self-contained compilation fixtures. For a faithful new capture:

1. Pin both repositories and the resolved CE package/build hash. Record document source hash and all document settings (angle, complex mode, dimension, piecewise/list-index policy).
2. Intercept the public compile namespace inside Tycho's existing gateway, after its temporary scopes and declarations are installed. Retain the unmerged invocation context before `dedupe()`. Do not reparse exported LaTeX in a fresh engine and call that equivalent.
3. Record canonical/structural MathJSON, declaration types, stored versus live inputs, function definitions and capture dependencies, options, requested consumer profile/requirements, and source origin. Record all referenced definitions transitively or retain the complete reproducible document setup.
4. Classify the prepared tree as a separate observation from the authored tree. A fold/unroll can remove vocabulary; neither count substitutes for the other.
5. Capture sample input bags and output/effect observations only under reproducible fixtures. Large shared lists can use deterministic generators or hashed snapshots. Count evaluation frequency separately through a defined scenario, rather than using compile occurrences as a proxy.
6. Add prelude statements, post-action state, ordinary batch evaluation, and future Buddhabrot chunk/reduction scenarios. Worker eligibility and actual worker routing are distinct fields.
7. Use private explicit full/digest outputs. The audit defaults overwrite the arm for the installed CE version; `_TASK` can be shared through worktree links. Start with the selected showcases, then CORE, before a broad ALL rerun.

No new defects were identified or filed. The output consists only of this report and `corpus-counts.json` in `/tmp`; production behavior and all tracked source files are unchanged.
