# Stable batch: phase 0 evidence

This report covers measurement infrastructure and baselines for the
[prototype plan](2026-11-15-stable-batch-prototype-plan.md). There is no batch
implementation or production engine change in this patch. Phase 1 has not begun.

## Provenance and comparison limits

- Current: `bbc28d9cad900d050c9ed83eaa02add399ae3b76`, package 0.192.0.
- Pre-binding: `c4856e003557e367d4a2272d37d1567e9dd7a9b3`, package 0.185.1.
  This is the exact source comparator called “0.186.0” by the post-mortem;
  it is not a claim about an installed 0.186.0 package.
- Node v26.13.0, V8 14.6.202.34-node.40, arm64, Apple M5 Max, 18 logical cores, 64 GiB RAM. Both source
  trees use the same installed dependencies and esbuild. Their historical
  lockfiles differ; this isolates source changes rather than reproducing two
  historical npm installations. Installed dependency versions/hashes are saved.
- Production JavaScript builds use `BUILD=production node scripts/build.mjs`:
  ES2022, ESM splitting, minification, production defines. This is not the full
  package build/type/consumer-smoke certification. All output chunks are hashed.
- CPU profiles use separate split builds with identical options except external
  source maps and the output directory. Their manifest is separate. They are
  never used as uninstrumented timing arms.
- Lock owner `codex-batch-phase0`; acquisition load 13.3 / 20.1 / 17.5. Timings
  start after that load has subsided. Per-sample load and process checks are in
  the raw records. The lock is advisory: several targeted Jest runs overlapped
  attempted samples. Rejected samples are retained and excluded, not averaged.

Tycho is a private snapshot of 3,228 source/script/configuration and selected
corpus files, hashed before and after copying. Its dependencies use the installed
host dependency tree. A live-checkout audit was rejected because its source hash
changed. The snapshot adapters write outside that snapshot and use the alternate
CE loader; the actual Tycho checkout and installed CE package are not edited.

The modern host is **not compatible with the old CE audit path**: 414 rows fail
because `ce.macroNames` is unavailable. Both audits list 115 documents, but the
old run records only 59 series and 86 compile records, versus 514 series and
1,295 compile records on current CE. Their total times must not be compared as
equal work. Current audit timings remain a useful absolute host baseline.
Successful process exit or absence of document-level errors did not establish
row-level success; the adapter now exposes row failures and marks such results
`incomparable`.

## Instruments and controls

`benchmarks/stable-batch/fixtures.json` contains exact F01–F22 input sequences,
expected results/diagnostics and invariant observations. All 22 proposed batch
contracts report **unsupported** on both baseline adapters. Schema validation
does not count as passing those contracts. Existing-operation controls record
their weaker observations and API differences separately.

The harness keeps startup, construction, construction plus first execution,
warm evaluate/N, relevant/unrelated writes, value edits and full synthetic
document rebuilds separate. Function construction includes installing the
function and boxing its call; closure construction includes creating the captured
callable. These are not pure single-node allocation timings. Full synthetic
rebuilds include a new engine, four prelude definitions, 64 document expressions,
scalar transfer and closure recreation.

The original eleven CE-1210 cases use `expr()`. Separately named cases measure
`box()`; no API substitution is hidden. CR2 remains the same unevaluated integral
on both production builds. Its structural control preserves that original
attempted-integration workload; the independent numerical integral reference is
retained in the manifest but is not claimed as an engine result.

Interpreter controls set CE `jit` off where the API exists and calibrate compiler
entry counters outside timing. Othello also verifies zero implicit-compilation
counter deltas. V8 optimization stays enabled. Explicit compilation in host
prelude/audit paths is allowed and reported separately.

Host controls include:

- Othello's initial-board legal moves `[20,27,38,45]` and stone positions
  `[29,36]` / `[28,37]`, checked independently. Timing includes boxing,
  evaluation, lazy count and element enumeration.
- All 15 nonempty showcase preludes, with validity, statement routes and phase
  timings recorded. This is not an independent value oracle for every prelude.
- The codegen audit, with row/document failures and route coverage exposed.
- Registration of the 165-cell real `art/2ki2hjsouf` document, with an appended
  control prelude and typed scalar value transfer. An original function's
  `c_t(0) = (0,1)` result and registration/failure/skipped-name sets are checked.
  This measures registration and full reinitialization, not plotting or all
  compiled-row execution. Old/current coverage must agree before interpreting
  their ratio.

The strengthened original-document control rejects the old comparator: `c_t`
is absent from its registration. Its earlier synthetic-only control and fresh
manager timings are therefore excluded from comparisons. Current CE registers
21 document definitions with no binding failures or skipped definitions.

The host's existing-manager edit is measured separately: change the prelude,
call `setCells()` and `evaluate()`, await `preludeSettled`, explicitly restore the
scalar value, then verify the changed function, original document function and
registration set. This retains the same engine. It omits the fresh setup
variable pass, computed-collection resolution and color-definition collection.
The 687 ms cap applies only to this registration-plus-scalar-restoration scope;
an equivalent-work full-document edit budget remains unestablished.

Memory instrumentation samples allocations including collected objects, checks
a known allocating control, and records estimated bytes per operation. It holds
8 synthetic documents, retains 12 obsolete documents as a positive control,
drops obsolete handles, performs three further batches of 12 replacements, then
drops document roots. Explicit GC is outside timing. A harness closure initially
retained the last document; review caught and removed that root before memory
measurements. Heap/RSS changes are not allocation totals, and constructor counts
are not physical allocation counts.

## Reproduction and validation

See [benchmark instructions](../../benchmarks/README.md#stable-batch-baseline).
The archived configurations contain the exact selections, iteration counts,
warmup, round order, flags and build identities. Each instrument command writes
to a new output directory; rejected attempts remain available. Expensive groups
are run serially, with contention checks before and after every child.

The orchestrator reviewed the delegated harness and corrected the retention
root, operator-replacement control and CR2 expectation. Sol independently
reviewed the host adapters; its three findings (audit row failures, original
document controls, filesystem-alias output guards) were addressed, and its delta
review found no further actionable regression in those fixes. A final review
found unequal work in the fresh/in-place edit comparison; the report and JSON
now explicitly limit the in-place budget to registration and scalar restoration.
Instrument tests and actual
production-bundle controls establish measurement behavior; no production engine
test snapshots were changed. Full/core engine suites are not appropriate to this
benchmark-only patch and were not run. Validation passed: fixture/workload
manifest validation (22 fixtures, 72 rows), five instrument tests, one host
filesystem-guard test, and scoped oxlint. No engine source, dependencies, build
configuration or test snapshots change. Review used the orchestrator plus Sol;
a further Claude code review was not required for this isolated instrument.

Final lint fixes import `performance` explicitly from `node:perf_hooks` (the
same object as `globalThis.performance`) and document the alternate-loader
package import. Archived measured harness versions preserve the exact timed
source hashes; these nonsemantic edits do not require new timing runs.

## Archived evidence

Raw files are preserved locally outside build output, in ignored `.tgz` archives
under `benchmarks/stable-batch-artifacts/`. They are **not in Git**; copy them
alongside the commit when moving this investigation to another machine. The
tracked evidence JSON records sizes and SHA-256 checksums. Both archives were
read back successfully; the evidence archive contains a per-file SHA-256 manifest.

- `2026-11-15-phase0-evidence.tgz`: 612,913,488 bytes, SHA-256
  `6f5c089ebd70e9eeaf56637fae84fcdcd919213c4ab8dab8ea467aa0637aab4f`.
  Includes accepted/rejected samples, configs, diagnostic and production bundles,
  source maps, CPU/allocation/heap profiles, V8 logs, analysis scripts and exact
  measured harness versions.
- `2026-11-15-tycho-snapshot.tgz`: 15,103,026 bytes, SHA-256
  `d4b3a5fdf256df8d007d301143d84cc727ddc2ce2b6bfb5ca56987282b2852f2`.
  The 3,228 pinned files were verified unchanged after measurements. Dependencies
  are excluded; the installed toolchain manifest describes the local setup.

Extract the archives to a scratch directory. Archived absolute paths describe
this run; recreate the two pinned CE worktrees and update config roots/output
paths for a rerun. Use the matched bundles/maps when inspecting existing profiles.
The raw records preserve the original native-edit scope label; the narrower
interpretation documented above and in the tracked evidence supersedes it.

The change adds 1,222 lines of JavaScript measurement/test infrastructure, plus
fixture/configuration/evidence JSON and documentation. Production lines removed:
zero. No typecheck or engine-wide test run was added for these standalone Node
instruments; syntax, instrument controls, guard tests and lint cover their scope.

## Results

The [machine-readable evidence](../../benchmarks/stable-batch-2026-11-15.json)
contains every selected case, raw repetition values, ranges, source identities,
profile summaries and proposed budgets. These are local-machine observations.
Ratios below are current / pre-binding; lower is faster.

| Workload | Pre-binding | Current | Ratio |
|---|---:|---:|---:|
| Scalar boxing | 8.86 µs | 9.48 µs | 1.069 |
| Scalar boxing + first execution | 15.63 µs | 16.50 µs | 1.056 |
| Function definition and call construction | 47.22 µs | 60.40 µs | 1.279 |
| Closure construction | 84.12 µs | 93.55 µs | 1.112 |
| Preboxed function evaluation with relevant write, including write | 19.17 µs | 14.87 µs | 0.776 |
| Synthetic document preparation + first execution | 5.13 ms | 2.96 ms | 0.577 |
| Synthetic full body edit | 4.95 ms | 2.84 ms | 0.573 |
| Synthetic full type edit | 5.01 ms | 2.77 ms | 0.553 |

These rows use six process rounds. The five arithmetic/function anchors use
1,000 warmup calls and 10,000 measured calls; the three document anchors use
20 and 100. Earlier short-warmup runs overestimated absolute warm costs and had
larger spreads, which justified this calibration before any prototype timing.
The other cases retain their recorded protocols; do not compare a candidate
with different warmup against these absolute values. Scalar-box ranges span
4.4% of the old median and 2.8% of current; function-construction ranges span
4.0% and 7.0%. The smaller changes need more caution than the function result.

Othello's legal-move call is 528.45 ms pre-binding versus 169.27 ms current,
with independently correct results. All 15 showcase preludes pass their native
validity controls on both arms. Current's full audit takes a median 32.879 s
over three accepted process rounds, with no failed rows. The old audit is
incomparable, as described above.

On the large real document, a fresh-manager rebuild takes **1.992 s**, whereas
the existing-manager prelude edit takes **687.19 ms**. These are medians of
three process medians, each with five measured edits. The existing edit's
process medians range from 671.49 to 710.43 ms. These paths perform different
work, so their ratio is not an edit speedup. Measure a candidate's registration
and scalar restoration against 687.19 ms with matching exclusions. Before a
full-document migration decision, add a matched native edit control covering
variable passes, computed collections and color definitions as well.

### Allocation and retention

Sampled allocation estimates, KiB per operation, median of three processes:

| Workload | Pre-binding | Current |
|---|---:|---:|
| Scalar boxing | 29.89 | 29.45 |
| Function construction | 151.25 | 162.55 |
| Function evaluation with relevant write | 52.05 | 34.93 |

Function construction's extra allocation is consistent with its time regression,
but does not explain the entire regression by itself. Allocation stacks include
type derivation through `cachedValue`/`boundCallType`, parameter canonicalization,
symbol declarations and lambda construction. A current-only stack through
`_inferOnParameter` → `_inferInEnvironment` → `UnitEnvironment.set` allocates
about 1.45 KiB of sampled map storage per construction in one profile. The raw
sampling stacks, including collected objects, are retained.

The heap snapshots give a more specific result than heap-used totals:

| Current object family | Before documents | Eight retained | Twenty retained (including obsolete) | Obsolete dropped | All document roots dropped |
|---|---:|---:|---:|---:|---:|
| Boxed functions | 4 | 1,252 | 3,124 | 1,252 | 4 |
| Unit environments | 1 | 553 | 1,381 | 553 | 1 |
| Unit read tokens | 0 | 40 | 100 | 40 | 0 |

Counts remain unchanged after further replacement batches while eight documents
are retained. The remaining four functions and one environment belong to the
deliberately live scalar control. This experiment does not show a retained
document leak in those object families.

Total heap is not strictly flat. After dropping document roots in the standard
experiment, current heap remains about 3.7 MiB above its initial point; the
snapshot attributes about 3.1 MiB of the increase to V8 code. Extended runs of
12 and 40 replacement batches show further, slowing process-heap growth even
though the measured document graph is reclaimed. A strict total-heap plateau
has **not** been established. Do not call this a binding leak, or waive the
prototype's total-retention gate based only on the object counts. The standard
window has reproducible numerical reference caps; longer-run code/metadata
retention remains an explicit acceptance check for the prototype.

### V8 interpretation

The measured boxed-function instances have one V8 map in each arm. Current
instances are **480 bytes** shallow versus **448 bytes** pre-binding. The
current unit environments are 112 bytes and read tokens 80 bytes, also with
one observed map each in these snapshots. This points toward object size,
object count and repeated work before a shape-polymorphism rewrite.

The current scalar-boxing CPU profile spends about 3.1% self time in
`BoxedSymbol._cachedResolution`. Source-correlated IC logs at its `_resolution`,
`version`, `variable`, `scope`, `bindings`, `get`, `_id` and `def` accesses each
show one receiver map. Their cache bookkeeping still costs time; these sites
do not supply evidence that receiver-map churn causes that cost.

Current function construction shows `unitReadToken` at about 2.3% self CPU,
object-dependency collection at about 2.2%, and GC at about 9.7%, versus about
6.1% GC in the old profile. These are scoped diagnostic profiles, not fractions
to sum into a predicted speedup. Full-process optimization/deoptimization,
GC/promotion and map logs are also archived. They include startup; aggregate
deopt counts or logged transitions are not steady-state hit frequencies.

Source attribution uses external maps from matched diagnostic builds. All 37
current and 38 old production JS files match the corresponding diagnostic JS
after normalizing only the equal-length chunk hashes in import paths. This
establishes the line/column correspondence used for production allocation stacks.

## Recommended budgets and next step

Proceed with the bounded **phase-1 experiment, F01–F09**, after reviewing this
report. Do not begin the Tycho extension or production migration. There is
enough evidence to test the proposed model; there is no evidence yet that the
prototype removes the production obligations or satisfies these budgets.

The JSON fixes per-case numerical caps before candidate measurements:

- Construction and construction-plus-first-execution target the pre-binding
  median: for example 8.86 µs scalar boxing, 15.63 µs scalar total, 47.22 µs
  function construction and 84.12 µs closure construction.
- Warm evaluate/N and value edits target the corresponding current median;
  the calibrated relevant-write function total is 14.87 µs.
- Full synthetic edits target current CE. Real-document prelude registration
  plus scalar restoration targets **687.19 ms** with the exclusions above.
  Fresh-manager setup is separately 1.992 s; neither establishes an equivalent
  full-document edit comparison. Audit and Othello retain separate current-host
  caps; no old-audit ratio is accepted.
- Allocation caps are the current estimates for each workload. Retention caps
  use the current standard experiment, with zero growth allowed in obsolete
  document-object families. Total retained bytes and the longer replacement
  curve remain mandatory; the unresolved code/metadata plateau is not a pass.

Observed spread is uncertainty, **not an allowed regression**. A comparison
inside that spread is inconclusive and gets a longer matched run. Do not waive
an individual regression with an aggregate score. No prepared-batch speed is
reported before the corresponding semantic fixture actually passes.

The implementation priorities are:

1. **Finish static work once.** Collect declarations, bind names and establish
   conservative stable types during preparation. Give prepared occurrences
   direct binding identities and type records. Keep stronger numeric refinements
   and assumption-dependent reasoning explicit, instead of making ordinary
   boxing/evaluation pay for their tracking. Demonstrate the supported subset
   with unit-token validation and dependency collection set to throw.
2. **Separate value storage and runtime memoization.** Typed runtime slots should
   change without re-running static inference. Try operation-local memoization
   for shared DAGs and explicit frame/revision ownership before adding more
   persistent cache dependencies. Preserve the measured function-runtime win;
   this choice must pass the relevant and unrelated-write cases.
3. **Reduce allocations along with handlers.** Static types/effects on immutable
   prepared records can replace their invalidation records. Reuse immutable
   library descriptors, avoid repeated parameter/body canonicalization, and use
   stable class layouts with prototype methods. The evidence does not justify
   adding a general object-shape optimization layer.
4. **Treat whole-document rebuilding as a measured choice.** Keep the initial
   simple whole-batch prototype, but measure matching registration work against
   the native edit budget and establish the missing full-document control.
   If it misses, first identify repeated preparation or reusable immutable
   inputs. Revisit batch granularity explicitly before introducing a general
   incremental dependency graph. A fresh engine per revision is not an adequate
   implementation of the proposed boundary.

The phase-1 handoff must include the removal/bypass/still-required ledger and
throw probes, as the plan requires. Binding simplification and production code
reduction remain unproven: this patch adds measurement code and fixture data,
and removes no CE or Tycho production code. If phase 1 starts from a newer
commit, run that untouched base alongside the pinned reference so unrelated
compiler changes are not attributed to the prototype.
