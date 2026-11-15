# Stable batch phase 1 evidence

Disposition: **revise phase 1; do not start phase 2 or production migration**.
The bounded semantic experiment works and reduces preparation/allocation cost.
Unchanged named-function execution regresses against an untouched current base,
and a strict total-retention plateau remains unestablished. Historical numerical
caps alone would miss the execution regression. No aggregate score waives it.

The experiment implements only F01–F09 of the
[prototype plan](2026-11-15-stable-batch-prototype-plan.md), after reading the
[phase-0 report](2026-11-15-stable-batch-phase0-report.md) committed in
`241a7078c`. Phase-2 behavior remains unsupported. No published entry point is
changed.

## Provenance

- Untouched current base: `ed54c0a68949924176b45251b7f4c4f2871ff93b`.
- Phase-0 current: `bbc28d9cad900d050c9ed83eaa02add399ae3b76`.
- Pre-binding: `c4856e003557e367d4a2272d37d1567e9dd7a9b3`, package
  0.185.1, historically labeled “0.186.0”.
- The pinned production bundles are the actual phase-0 archived bundles. All
  37 current and 38 pre-binding files match the archived per-file SHA-256
  manifest. The current-base production build uses the installed dependencies
  and `BUILD=production node scripts/build.mjs`.
- The first build lock was `codex-stable-batch-phase1`, acquired at load
  6.2 / 5.7 / 7.3 and released at 3.4 / 4.9 / 6.7 while implementation
  continued. The measurement/build lock was acquired at 25.8 / 19.8 / 13.3;
  only correctness builds ran while load was high. Timed children required
  one-minute load at most 12 and no detected test/build contenders, before
  and after every sample. Final release load was 3.3 / 4.6 / 7.5.
- Node v26.13.0, V8 14.6.202.34-node.40, arm64, Apple M5 Max, 18 logical
  cores; precision 50 and CE JIT off. Ordinary V8 stays enabled. Timing Node
  flags are empty; explicit GC and allocation instrumentation run separately.
- Both new builds use the same installed esbuild 0.28.2/dependencies, ES2022,
  production defines, minification and ESM splitting. A private benchmark entry
  accompanies the existing eleven split entries; its source and complete
  options are recorded. This changes chunk partitioning relative to the
  archived ordinary production bundles, whose distinct provenance is preserved.
  These are JavaScript comparison builds, not package release certification.
- Candidate source SHA-256:
  `1e4014a52cba5fcad5f063111c01fc299dc0d59d412b14d626b9f6af8a0fef4e`.
  Source-file manifests include the untracked prototype, rather than relying
  on an empty tracked-file diff. Exact build, bundle, harness and per-sample
  source hashes are in the evidence manifests. The untouched comparison is
  the task-start current commit, not peers' later shared-tree edits.

## Scope of comparisons

The scalar and named-function cases use CE arithmetic. Preparation, preparation
plus first execution, warm evaluate/N, relevant writes and unrelated writes are
separate workloads. Native input declarations precede timing, as in phase 0;
candidate preparation includes capturing these declarations. This difference
must accompany interpretation of preparation ratios.

The phase-1 retention document includes four named functions and 64 cells. It
uses multiplication for the unused square function and omits closure creation.
It is a distinct matched workload for the bounded subset, not a pass of the
phase-0 full-document or real-host budget. The phase-0 total retained heap
plateau was unresolved; reclaiming document objects alone cannot waive that
gate.

## Results and disposition

The [machine-readable evidence](../../benchmarks/stable-batch-phase1-2026-11-15.json)
preserves per-case repetition values, ranges, all reference ratios, cold results,
allocation estimates, heap families, manifests and the phase-0 numerical caps.
All three timing matrices, all eleven memory groups and all cold comparisons
have valid source/bundle certifications. Raw artifacts include rejected or
superseded attempts. Instrument summaries with the inherited default
“pending-coordinator-baseline-review” label do not supersede the committed
phase-0 budgets copied into this evidence. Their copied status saying phase 1
has not started is historical metadata, not the status of this experiment.

### Correctness and mechanism evidence

All frozen F01–F09 steps pass. Eight semantic/invariant tests also check copied
source, frozen records, stable binding/type identities, incompatible and
nonfinite writes, numeric MathJSON object admission, refusal preserving both
instances, and 100 writes with general boxing set to throw. There is no fallback
to production binding for unsupported execution.

The final separate diagnostic build executes F01–F09 with ten concrete old
entry points armed to throw after preparation. The static-read sweep actually
visits **20 units and 48 bindings**; no forbidden call occurs. Every throw probe
has a nonzero positive control. This covers unit lookup/token creation/token
validation, dependency collection/recording/propagation/validation, external
symbol-resolution checks and callee reboxing checks. The
[mechanism ledger](2026-11-15-stable-batch-phase1-ledger.md) names each file and
function and distinguishes bypassed mechanisms from actual removals.

The first probe exposed live Missing-symbol resolution on F07's failed
initializer. The implementation now carries CE's existing statically known
error value without executing the initializer. Independent Sol review then
found a diagnostic sweep that had discarded its unit handle and rejection of
valid numeric-object literals such as `{num:"3"}`. Both were fixed, tested and
reviewed again; no further actionable findings remained. Ast-grep passed.

F06 captures explicitly supplied declarative external bodies/signatures; it
does not snapshot arbitrary mutable JavaScript callbacks. F08 refuses transfer
from immutable closure/view syntax before forcing unsupported execution. It
does not construct a runtime closure/lazy graph and supplies no retention proof
for those graphs. Independent review found these refusal restrictions sound
for the bounded experiment. They are not phase-2 support.

Intentional prototype differences remain explicit: value changes keep one
declared type; definition edits require a new whole revision; old handles keep
old behavior; mixed revisions and mutable callable slots are refused; transfer
is explicit and limited to supported literals. No production contract changes.

### Warm timing

Six fresh process rounds per arm/case use 1,000 warmup and 10,000 measured calls,
serial alternating AB/BA order. Times below are microseconds per call, including
the write in relevant/unrelated cases. Ratios are candidate/reference; each
reference pair has its own candidate repetitions. Native input setup is outside
timing, while candidate slot collection is included. Assertions are outside the
timed operations.

| Case | Untouched current | Candidate | / current | / pinned current | / pre-binding | Historical cap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scalar/prepare | 9.74 | 8.31 | 0.854 | 0.825 | 0.915 | 8.86 |
| scalar/prepare-first | 17.12 | 13.16 | 0.769 | 0.753 | 0.803 | 15.63 |
| scalar/evaluate/unchanged | 6.41 | 3.56 | 0.556 | 0.563 | 0.583 | 12.04 |
| scalar/evaluate/relevant | 8.64 | 4.78 | 0.553 | 0.536 | 0.557 | 15.65 |
| scalar/evaluate/unrelated | 8.14 | 3.85 | 0.473 | 0.472 | 0.489 | 14.75 |
| scalar/N/unchanged | 10.05 | 4.60 | 0.457 | 0.460 | 0.581 | 16.74 |
| scalar/N/relevant | 12.71 | 5.79 | 0.456 | 0.454 | 0.564 | 20.89 |
| scalar/N/unrelated | 11.79 | 4.93 | 0.418 | 0.406 | 0.485 | 21.02 |
| function/prepare | 62.96 | 12.27 | 0.195 | 0.202 | 0.257 | 47.22 |
| function/prepare-first | 81.58 | 17.33 | 0.212 | 0.204 | 0.237 | 109.83 |
| function/evaluate/unchanged | 3.28 | 3.63 | 1.109 | 1.011 | 1.168 | 6.68 |
| function/evaluate/relevant | 15.33 | 4.88 | 0.318 | 0.321 | 0.248 | 14.87 |
| function/evaluate/unrelated | 5.06 | 3.88 | 0.768 | 0.752 | 0.787 | 10.38 |
| function/N/unchanged | 3.52 | 4.64 | 1.319 | 1.191 | 1.405 | 6.65 |
| function/N/relevant | 21.29 | 5.82 | 0.273 | 0.266 | 0.253 | 34.50 |
| function/N/unrelated | 5.38 | 5.05 | 0.938 | 0.942 | 0.938 | 10.89 |

All sixteen medians meet the historical caps. Some phase-0 warm caps used
shorter calibration than its five long-run anchors; the new matched comparison
reveals a regression that those absolute caps do not catch. The initially noisy
unchanged-function cases received a longer run: ten process rounds, 5,000 warmup
and 100,000 measured calls per case, with both arms using that same protocol.

| Longer run | Current µs | Candidate µs | Ratio | Current range | Candidate range |
| --- | ---: | ---: | ---: | --- | --- |
| function/evaluate/unchanged | 1.897 | 2.231 | 1.176 | see evidence | see evidence |
| function/N/unchanged | 2.128 | 2.997 | 1.409 | see evidence | see evidence |
| function/N/unrelated | 3.778 | 3.271 | 0.866 | see evidence | see evidence |

Relative full spreads are 7.3%/5.0% for exact unchanged evaluation and
10.3%/6.8% for unchanged N, current/candidate respectively. These two
regressions exceed those spreads. The longer protocol improves both arms'
absolute times; it must not be substituted into the six-round table. The
prototype has no persistent value memo; these timings alone do not quantify
which internal operation causes the regression. No cache layer was added just
to hide it.

### Cold first unit

A separately reviewed instrument uses six fresh processes per arm/kind and
reference, ordinary Node flags, precision 50 and JIT off. Validation follows
the timestamps. Against untouched current, cold scalar preparation plus first
execution is 0.963 ms versus 0.768 ms candidate; named-function construction
plus first execution is 6.898 ms versus 0.862 ms. Native input-declaration setup
is separately 0.789/0.822 ms for scalar/function; candidate source construction
is 0.037/0.048 ms and its slot collection remains inside preparation.

Imports take about 85–87 ms and engine construction/configuration about 23 ms
in this instrument. These values include the private entry's chunk partitioning.
The child process-clock-to-first-result includes harness imports and excludes
parent spawn latency. Cold per-phase values, ranges and both pinned-reference
comparisons are in the evidence; small startup differences are not claimed as
improvements. An archived-entry path-normalization failure was preserved as a
rejected attempt and fixed before the complete certified cold run.

### Allocation

Three processes per reference pair, 1,000 warmup and 10,000 sampled operations,
32-KiB sampling interval, including objects collected by minor and major GC.
Every process verifies an allocating positive control. Values are estimated
KiB per operation, not exact object sizes or retained heap.

| Operation | Untouched current | Candidate | Ratio | Phase-0 current cap |
| --- | ---: | ---: | ---: | ---: |
| Scalar preparation | 31.26 | 22.54 | 0.721 | 29.45 |
| Named-function preparation | 167.08 | 29.06 | 0.174 | 162.55 |
| Function evaluation plus relevant write | 36.80 | 14.25 | 0.387 | 34.93 |

Candidate estimates in all reference pairs meet the historical allocation
caps. The refreshed native estimates are somewhat above phase 0; the exact
protocol and per-process estimates remain separate. Profiles including collected
objects and calibration profiles are archived. Constructor counts or heap
deltas are not used as allocation totals. No minified allocation stack is
given unsupported source attribution.

### Retention

These separate GC experiments use the reduced document described above, eight
retained revisions, twelve replacements per batch, three standard checkpoints
and forty extended checkpoints. Every replacement is instantiated and first
executed. The intentionally held obsolete revisions provide a positive control.
After collection, prepared-object counts are:

| Family | Before | Eight live documents | Twenty including obsolete | Obsolete dropped | Batch 40 | All document roots dropped |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Prepared revisions | 1 | 9 | 21 | 9 | 9 | 1 |
| Runtime instances | 0 | 8 | 20 | 8 | 8 | 0 |
| Boxed functions | 2 | 2 | 2 | 2 | 2 | 2 |
| Unit environments / read tokens | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

The remaining revision is the deliberately live scalar control, reached through
its adapter's expression handle. Snapshot paths for the positive-control
documents pass through held/obsolete handles. Revision and runtime-instance
families each have one observed V8 map per checkpoint; established shallow
sizes are 72 and 40 bytes respectively. The first revision is 184 bytes before
V8 instance slack tracking settles. These are shallow sizes, not document totals.
The observed document graphs are reclaimed; this is no proof about unsupported
closure/lazy graphs or every production object family.

| Post-GC heap increase over initial point | Current | Candidate |
| --- | ---: | ---: |
| Standard eight documents | 10,519,104 B | 782,536 B |
| Standard obsolete dropped | 11,469,360 B | 1,015,288 B |
| Standard all document roots dropped | 5,670,480 B | 666,072 B |
| Extended batch 8 | 13,071,352 B | 1,290,480 B |
| Extended batch 20 | 14,136,288 B | 1,526,896 B |
| Extended batch 40 | 13,622,584 B | 1,687,936 B |
| Extended all document roots dropped | 6,819,752 B | 1,170,944 B |

Candidate total heap still grows by 161,040 bytes from checkpoint 20 to 40.
Its snapshot code category increases by 1,205,880 bytes between the initial
and final extended snapshots, accounting for most remaining process heap.
This numerical accounting is not a causal proof or a proof that every other
retained family is leak-free. Code/trusted heap-space measurements are also
retained separately. A strict
total plateau is **not established**. Object reclamation and lower absolute
retention cannot waive that gate. The reduced workload is not an equivalent
test of phase 0's closure/full-document caps or the real-host edit budget.

### Complexity and checks

The patch adds **1,298 tracked code lines, removes zero**, excluding JSON and
documentation: 357 experimental engine lines, 80 semantic-adapter lines,
91 diagnostic/probe lines, 573 measurement/build lines and 197 test lines.
Temporary analysis/orchestration instruments add 235 physical lines and 20,632
bytes, including a superseded 63-line cold instrument; their compact physical
line counts are not credited as simplification. They are archived and counted
separately in the evidence. No Tycho source changes, no production methods
deleted, no snapshots changed, no projected deletion credit. Three old
mechanism families are bypassed in the supported subset, proven at ten concrete
entry points; all remain necessary for other production consumers. The new
builder, immutable records, runtime value map and transfer boundary coexist
with them. No existing boxed-node field or dispatch branch changes, so a
patched-unused shared-class control is unnecessary.

Validation passed: eight semantic tests; six instrument tests; explicit scoped
TypeScript check of the unexported prototype; scoped Oxlint; final diagnostic
build; independent Sol review and fix-delta review; ast-grep; repository
typecheck; dependency-cycle check; core suite with `--watchman=false` (18 suites,
5,588 tests, 1,368 snapshots; 15 tests skipped). Core source/test fingerprints
match before and after. The first core invocation exited without running tests
because sandboxed Watchman access failed; it is not counted as a pass.
Byte-identical delegated files reuse their targeted checks; the final numeric
literal fix changes no existing production/core import path.

`node scripts/issues.mjs lint` reports zero errors and one preexisting priority
warning. This task adds zero issue files and removes zero. Peers' edits and
commits in IR/interval/docs/issues are preserved. No full engine suite, corpus
or Tycho audit was run: this unexported module changes no production entry and
does not support those broader workloads. A repeated full V8 diagnostic census
would not resolve the two measured execution regressions or establish a heap
plateau, so it was not substituted for those explicit results.

Recommendation: keep the experiment isolated and revise unchanged-function
execution and the total-retention experiment before any phase-2 selection or
implementation. Stopping is the alternative if that revision needs more
mechanisms than the simplification can justify. Accepting the historical caps
while ignoring the refreshed current regression is not recommended. No phase-2
extension or production migration is proposed here.

## Reproduction and raw evidence

See [benchmark instructions](../../benchmarks/README.md#stable-batch-phase-1).
The exact commands/configurations, all process exit codes, source/build hashes,
accepted samples, rejected attempts, allocation profiles and heap snapshots
are preserved in
`benchmarks/stable-batch-artifacts/2026-11-15-phase1-evidence.tgz`:
234,437,362 bytes, SHA-256
`8ab11acf6c5ecdbb82221974d694c35391e5923f597aa7f2359b48f97dabdd1c`.
The archive was read back successfully and contains a per-file SHA-256 manifest
for 5,085 files. Extract it, recreate
the task-start worktrees, overlay the archived candidate module, restore the
archived references, and update absolute roots/output paths in the copied
configs. Build/control/time/memory commands are unchanged; outputs must be new.
The archived `cold.mjs`, `summarize.mjs` and `tools/heap-summary.mjs` preserve
the additional instruments. The tracked report/evidence add the outer archive
checksum after packaging; their archived copies necessarily precede that pointer.
The archive is local and ignored, as in phase 0;
copy it with this patch when moving the experiment to another machine.
