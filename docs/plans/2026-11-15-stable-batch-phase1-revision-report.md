# Stable batch: one bounded phase-1 revision

Disposition: **stop for coordinator review; the full acceptance gate has not
passed**. The runtime regressions are removed, allocation and warmed heap-budget
gates pass, but scalar preparation exceeds the fixed historical cap. No phase-2
implementation or Tycho edit was performed. The parallel
[phase-2a selection](2026-11-15-stable-batch-phase2a-selection.md) is costing only
and supplies no deletion credit.

The original phase-1 result is committed in
`817f3a87ce4cb10aac942ca465604d1d9d6bf0ad`. The same untouched commit supplies
native-current and frozen-prototype controls. The task-start peer IR/interval
documentation and issue changes are preserved.

## Fixed criteria and order

The [criteria](2026-11-15-stable-batch-revision-criteria.md) were frozen before
any revised candidate measurement, SHA-256
`058c95fd4b5793d6fcf803f116d7bb19ef32cd9bfcb5c462d6d035bab2b5e59e`.
They replace reliance on historical warm caps with matched native-current
runtime gates and retain explicit total-memory bounds after warmup. No criterion
was loosened after seeing a candidate. The order was profiling, direct-only
implementation and measurements, then the smallest cache trial.

## Profiles before implementation

Three independent CPU and allocation processes per arm/operation compare
unchanged function evaluate/N. Each uses precision 50, CE JIT off, 5,000 warmup
and exactly 100,000 profiled calls. CPU interval 100 microseconds yields
1,587–2,617 samples per profile; no 50-microsecond retry was needed. CPU and
allocation run separately. Diagnostic external maps accompany minified split
builds; their JavaScript corresponds to ordinary production builds after only
equal-length chunk-hash names are normalized. Generated/map hashes and original
source positions are preserved.

Frozen-prototype name lookup accounts for 12.2–15.2 ms of nonoverlapping leaf
self samples per 100,000 exact evaluations, and 11.4–16.2 ms for N. It allocates
almost nothing. Distinct arithmetic-source function entries account for
68.7–73.9 ms self for evaluate and 80.2–84.8 ms for N; numeric/big-decimal-source
entries account for 24.0–25.8 ms and 100.0–107.9 ms respectively. Native unchanged
profiles have no samples in those arithmetic-source handlers, consistent with
result reuse in this workload. This is not a claim about mutations or other
programs.

| Estimated sampled bytes/call | Native range | Frozen prototype range |
| --- | ---: | ---: |
| Unchanged function evaluate | 7,199–7,212 | 10,752–10,769 |
| Unchanged function N | 7,928–7,934 | 13,453–13,472 |

The argument-map callback is charged approximately 609–620 bytes/call of self
allocation; whole-run self approximately 255–257. Neither number isolates array
backing stores. Much larger nested allocation is in existing arithmetic and
numeric handlers. These diagnostic profiles sample allocations including
collected objects at 1,024-byte intervals. Acceptance allocations use matched
32,768-byte sampling and the same fixed call counts, avoiding millions of
retained sampling records in preparation cases while matching the historical
cap instrument's interval.

Profiler call-frame positions identify function/callback entries, not arbitrary
executing or allocating instructions. Internal dispatch, argument-array creation
and approximation inside one function remain unresolved unless a distinct
callback/callee identifies them. Self samples partition observed leaf cost;
inclusive rows overlap and cannot be added. Recursive allocation ancestors are
deduplicated within a function's inclusive total. Inspector control overhead is
reported separately, not treated as application time. Raw profiles remain the
evidence; no synthetic wrappers were added to manufacture causal percentages.

## Direct access before caching

The direct-only trial adds `unit.resolve(name)` and an immutable entry handle.
`instance.evaluateHandle(handle)` checks revision ownership with one identity
comparison and shares execution with the existing name convenience route.
Resolution/handle creation is inside preparation, not hidden from construction
or first-execution costs. Runtime slots remain the same binding-keyed Map;
there are no indexed slots or cached results in this trial.

Ten matched process rounds, 5,000 warmup and 100,000 calls show:

| Route | evaluate µs | N µs |
| --- | ---: | ---: |
| Native current | 1.870 | 2.084 |
| Frozen prototype by name | 2.190 | 2.938 |
| Direct-only convenience by name | 2.237 | 2.956 |
| Direct-only retained handle | 2.102 | 2.818 |

Direct access helps about 4% versus the frozen prototype, but remains 12.5%
slower than native evaluate and 35.2% slower for N. It fails the new runtime
gate. The separate preparation run stopped before launching a contended child;
126 completed children were uncontended and source-certified. The remaining
34 unlaunched preparation children ran in a fresh directory after checks cleared.
No contended sample was averaged in, and both segments preserve their original
source/harness identities and logs.

## Bounded cache policy

Only after those profiles and direct-only timings, this revision adds one
optional result record per instance. It is not a per-entry map. It stores only
successful number/string results whose settled type and conservative effects
permit caching. In this subset `scope` means reads of instance-owned slots;
audited handlers are pure, definitions are immutable and arbitrary host callback
operators remain refused. Every accepted write, including unrelated writes,
clears the entire record; rejected writes preserve it. Initialization clears it.

The record checks binding identity, exact/N mode, engine precision, global
BigDecimal working precision, requested precision, tolerance, rounding ties,
angular unit, strictness and immutable effects-registry identity. Transient
configuration clears/bypasses it. Another entry or mode/context replaces the
single record. Aggregates, errors and unsupported computations are not stored.
There is no per-hit key-object allocation, engine-generation key, read token,
dependency collection, automatic environment invalidation or new operator
handler. The existing CE arithmetic handlers and execution walker remain.

Final candidate source SHA-256:
`b68404d15fb255c929aa9f9f04cbe09de43a657bcd5deb5858ca09365089c896`.

## Acceptance results

The [evidence JSON](../../benchmarks/stable-batch-revision-2026-11-15.json)
preserves all process values, ranges, gates, context controls, source/build
identities and heap paths. Every final measurement group completed with valid
before/after source, bundle and child/harness certifications. Timings use
separate processes and alternating arm order; assertions and explicit GC stay
outside timing. Node v26.13.0/V8 14.6.202.34-node.40, arm64 Apple M5 Max,
precision 50 and CE JIT off match the frozen controls. Source and dependency
versions are unchanged between the frozen and revised arms apart from the
experimental patch. Actual historical production bundles supply pinned
`bbc28d9ca` current and `c4856e003` pre-binding preparation references.

The lock was acquired as `codex-stable-batch-revision` at load 6.3/6.4/5.9 after
570 seconds queued. Measured children checked the lock, load at most 12 and
competing test/build processes before and after each child. It was released at
3.8/4.4/4.4 after the final measurements; reporting and analysis use no lock.

### Runtime: pass for the selected cases

Ten rounds, 5,000 warmup and 100,000 measured calls per case. Microseconds/call
include writes where present. Every revised-handle range is below its matched
native range. The unchanged cases repeatedly access one entry; their very small
values include per-call clock overhead and are not a production-document
speedup estimate.

| Case | Native current | Frozen prototype | Revised handle | / native |
| --- | ---: | ---: | ---: | ---: |
| Scalar evaluate unchanged | 4.016 | 2.212 | 0.065 | 0.016 |
| Scalar evaluate relevant | 6.476 | 3.561 | 3.600 | 0.556 |
| Scalar evaluate unrelated | 5.889 | 2.400 | 2.334 | 0.396 |
| Scalar N unchanged | 7.146 | 2.975 | 0.065 | 0.009 |
| Scalar N relevant | 9.600 | 4.237 | 4.080 | 0.425 |
| Scalar N unrelated | 9.227 | 3.213 | 3.127 | 0.339 |
| Function evaluate unchanged | 1.938 | 2.276 | 0.067 | 0.035 |
| Function evaluate relevant | 11.594 | 3.634 | 3.572 | 0.308 |
| Function evaluate unrelated | 3.693 | 2.465 | 2.376 | 0.643 |
| Function N unchanged | 2.171 | 3.036 | 0.068 | 0.031 |
| Function N relevant | 16.815 | 4.246 | 4.146 | 0.247 |
| Function N unrelated | 3.858 | 3.316 | 3.206 | 0.831 |

The name convenience route is measured separately: unchanged function evaluate
0.163 µs and N 0.159 µs. It still performs name lookup. Cycling among entries or
evaluation modes can miss the one-record cache; that workload is not certified
by the repeated-entry win. Unrelated writes deliberately invalidate everything,
and their results above do not rely on dependency tracking.

### Construction: one fixed cap fails

Six rounds, 1,000 warmup and 10,000 calls; handle resolution is included.
The historical caps remain those committed in phase 0.

| Case | Native | Frozen | Revised | / pinned current | / pre-binding | Historical cap | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Scalar preparation | 10.025 | 8.614 | 9.210 | 0.938 | 1.022 | 8.862 | Fail |
| Scalar prepare + first | 17.150 | 13.008 | 13.851 | 0.818 | 0.883 | 15.630 | Pass |
| Function preparation | 61.337 | 12.551 | 13.465 | 0.216 | 0.281 | 47.224 | Pass |
| Function prepare + first | 79.527 | 16.925 | 18.366 | 0.230 | 0.256 | 109.832 | Pass |

Scalar preparation's six values span **9.168–9.772 µs**, all above the fixed
8.862-µs cap; its median exceeds it by **3.9%**. The fresh pre-binding reference
itself measures 9.016 µs (8.905–9.446), also above that historical cap. Its range
overlaps the revised candidate, so the 1.022 ratio is not evidence of a resolved
2.2% regression against that fresh arm. Revised construction medians are 6.5–8.5%
above frozen-prototype medians; ranges and the frozen scalar outlier remain in
the evidence. No small difference inside those spreads is claimed as a win.

No cap was relaxed. A longer protocol was not substituted into the historical
construction table to hide the failure. The fixed absolute gate is unmet, so
the bounded revision stops rather than adding another optimization or taking
another lock turn for a result that could not silently waive that gate.

### Allocation: pass

Three independent processes per case, 5,000 warmup, 100,000 sampled calls,
32-KiB interval, collected objects included and a known allocating control.
Estimated KiB/call:

| Case | Native | Frozen | Revised | / native |
| --- | ---: | ---: | ---: | ---: |
| Scalar preparation | 26.716 | 21.386 | 23.804 | 0.891 |
| Function preparation | 151.754 | 27.905 | 30.892 | 0.204 |
| Function evaluate + relevant write | 28.765 | 11.726 | 11.796 | 0.410 |
| Function evaluate unchanged | 7.070 | 10.534 | 0.106 | 0.015 |
| Function N unchanged | 7.766 | 13.150 | 0.112 | 0.014 |

All revised ranges are below the smaller matched-native/historical cap where
both exist. Preparation allocation grows versus the frozen prototype, while
remaining below those acceptance caps. Estimates are not exact physical counts;
the detailed pre-change 1-KiB profiles and the 32-KiB acceptance estimates are
kept separate, with their positive controls and raw stacks.

### Warmed retention: fixed heap bounds pass; no asymptotic claim

Each of three numerical processes warms 200 discarded, instantiated and first
executed reduced documents, then retains eight across four windows of twenty
batches of twelve replacements. Snapshots and an obsolete-handle positive
control run in separate processes. No bytes attributed to code or harness are
subtracted from the total-heap gate.

| Revised process | Maximum live heap increase | After roots dropped | Window 2→4 growth | Window 3→4 growth |
| --- | ---: | ---: | ---: | ---: |
| 0 | 1,013,464 B | 411,040 B | 108,176 B | 89,448 B |
| 1 | 1,005,736 B | 368,416 B | 107,784 B | −68,168 B |
| 2 | 1,013,464 B | 411,040 B | 108,176 B | 89,448 B |
| Fixed cap | 2 MiB | 1 MiB | 256 KiB | 128 KiB |

The harness-only late-growth maximum is 4,960 B, below its fixed 128-KiB bound.
Snapshot actual document families all follow the same counts:

| Family | Warm baseline | Eight live | Obsolete held | Obsolete dropped | Window 4 | All roots dropped |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Prepared revisions | 0 | 8 | 20 | 8 | 8 | 0 |
| Runtime instances | 0 | 8 | 20 | 8 | 8 | 0 |
| Entry handles | 0 | 8 | 20 | 8 | 8 | 0 |
| Cached results | 0 | 8 | 20 | 8 | 8 | 0 |

One 40-byte handle template and one 112-byte cached-result template persist at
every point through V8 feedback/AllocationSite paths. They have no unit/binding
object references and are separated from actual document handles/results.
Numeric inline fields do not necessarily appear as snapshot property edges;
classification uses reference fields and retaining paths, not constructor names.
The snapshot code category grows by 346,376 B between warmed baseline and final
drop. This is accounting evidence, not proof of causation or absence of every
other retained family.

RSS is also retained in the evidence. Revised processes grow by 29.0–30.1 MB
RSS from warmed baseline to final drop while V8 physical heap capacity grows
33.0–33.8 MB, despite live-heap growth of only 0.37–0.41 MB. This is consistent
with committed heap capacity accounting for the resident increase; it is not a
proof of its complete cause or an RSS plateau. Late window-2-to-4 RSS growth is
0.10–0.36 MB. The fixed acceptance criteria gate total post-GC heap and its late
growth, and require separate RSS/capacity reporting; they do not certify bounded
RSS for arbitrary longer runs. These finite-window heap results also do not
establish full-document/closure/real-Tycho retention compliance.

### Instrument corrections and disposition

The temporary orchestration initially overwrote the child's compiler-control
`route` object with a default string, also ignoring `arm.route` in that label.
Execution still used the frozen request's correct route. Raw results are kept;
the evidence reconstructs `accessRoute` from those requests. The wrapper was
corrected and four fresh untimed native/direct evaluate/N controls preserve
zero compiler entries, JIT off and a firing positive compiler-counter control.
No timed implementation or numerical result changed.

Independent Sol evidence review agrees: runtime, allocation and finite warmed
heap-budget gates pass, the scalar-preparation cap fails, and the fresh old-arm
ratio is unresolved inside spread. The cache is a measured additional mechanism,
not evidence that production obligations disappeared. **Stop for coordinator
review.** No phase-2 implementation, further cache policy or construction
optimization is started in this revision.

## Validation and review

Sol implemented the bounded changes and separately reviewed instruments, direct
access and cache deltas. Findings about function-entry attribution and malformed
zero-iteration requests were fixed before candidate measurements. Recursive
inclusive allocation attribution was corrected without changing raw profiles.
No actionable implementation findings remain.

Scoped checks pass: ten semantic tests (F01–F09 on both routes), six cache tests,
ten revision instrument tests, seven existing adapter/build instrument tests,
one recursive attribution test, native TypeScript on the unexported module,
scoped Oxlint and ast-grep. The final ten throw probes pass, with 20 units and
48 bindings in the armed static sweep and an additional cache sweep of three
misses, two hits and one accepted write. All positive controls fire.

Combined repository typecheck, dependency-cycle check and core set pass: 18
suites, 5,588 tests and 1,368 snapshots, with 15 tests skipped. Before/after
source/test fingerprints match. These results are reused for byte-identical
delegated files. Full suite, whole Tycho execution and production migration
remain outside this isolated F01–F09 experiment. No issue file was added or
removed by this task.

## Complexity and phase-2a

Final tracked experimental source/instruments/tests total 1,823 physical code
lines, versus 1,298 initially: net +525. The engine module grows from 357 to 415
lines: +60/-2, net +58; direct-only was +17 and the cache increment net +41.
Tests grow net +209 and instruments net +258. A seven-line site-hypothesis JSON
and documentation/evidence are counted separately. No production mechanism or
Tycho method is deleted, and no projection earns deletion credit. Temporary
analysis/orchestration instruments are also retained and counted in evidence.

Phase-2a selects Gomoku's `P_{iecepos}` literal-list write/read path, with exact
source and fixture hashes. Full `_rebindWrittenLiterals` plus exclusive helper
and memo have a conditional 274-line deletion ceiling, but the narrow projection
deletes nothing. The report identifies retained host policy, missing F10–F22
requirements and broad cost intervals; full replacement is not a bounded next
implementation merely to claim those deletions. The selection also recosts coexistence from the final 1,823-line prototype:
2,023–2,243 lines for the narrow projection, or an optimistic 2,379–3,349
for full replacement after the conditional deletion ceiling. No Tycho file or Git state was modified.

## Reproduction and artifact accounting

The tracked evidence is
[`benchmarks/stable-batch-revision-2026-11-15.json`](../../benchmarks/stable-batch-revision-2026-11-15.json).
Raw evidence is packaged locally in the ignored
`benchmarks/stable-batch-artifacts/2026-11-15-phase1-revision-evidence.tgz`.
It contains frozen criteria, all per-child requests/results, CPU and allocation
profiles, 18 heap snapshots, production/diagnostic bundles and manifests, pinned
reference bundles/manifests, controls, certifications, source variants and
validation logs. The archive's `SHA256SUMS` covers every included file except
itself. `final-commands.json`, `configs/` and the preserved scripts record the
commands and ordering; reproduction requires fresh outputs and the shared box
lock. Absolute local paths must be recreated or updated consistently.

Ten temporary analysis/configuration/orchestration scripts total 506 physical
lines and 39,884 bytes, including superseded attempts. Duplicated tracked harness
copies are excluded from that count. Their hashes and individual sizes are in
the evidence; compact physical lines earn no simplification credit. The early
allocation summary is preserved as `summary-before-inclusive-refresh.json`;
`generate-summaries.mjs` refreshes it from corrected mapped profiles. Raw
profiles are unchanged. Archive copies of report/evidence precede the outer
archive hash pointer to avoid a circular hash.

The box lock was released after the final measurements; packaging takes no
lock. Full suite, corpus execution and Tycho execution were omitted because
this bounded unexported module does not change their production paths.

Archive readback verified 4,411 files; compressed size 249,436,726 bytes.
SHA-256: `ed0bd569de48d0489120d01608de5ce172d849f2a8a2801514433acc20c015cc`.
