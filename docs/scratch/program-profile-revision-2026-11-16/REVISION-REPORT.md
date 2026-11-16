# Bounded Program guard revision

The guard-only patch has an inconclusive timing effect and small sampled
allocation changes. It leaves the measured type/boxing call counts unchanged.
The original Program preparation costs remain an explicit review consideration;
this is not a no-regression pass or a claim that they were recovered.

## Causal source and build

The accepted arm remains the exact original frozen production candidate at
`/private/tmp/program-only-accepted-candidate-20261115`. The revision arm is
`/private/tmp/program-only-profile-revision-20261116`, copied from that accepted
root with dependency symlinks preserved. All 837 CE source files matched the
accepted manifest before applying `/private/tmp/program-reduction-sol.patch`.
Both `git apply --check` and `git apply` exit 0. Exactly three source files change:
`control-structures.ts`, `core.ts` and `diagnostic-flow.ts`.

This compares the same incremental patch, not whole current-main files. In
particular, unrelated peer changes make main's accepted `core.ts` differ from
the frozen accepted preimage. The variant retains frozen `core.ts` SHA256
`fbe83af098b28d6ace96483a00016725d4c2a8819d3791b4e1e983dc02a7973c` and applies
only the patch, producing
`e277cbd6d16a8d09c701f872980f8c2e3d0bbf1311a7913aa04194446c2226a0`.
No full source file was copied from moving main. Frozen Tycho and its three
already accepted Program consumers are unchanged.

Only the variant `ce/dist` was removed, followed by
`BUILD=production node scripts/build.mjs` in its CE directory, direct exit 0.
The build uses the accepted source/dependency/config/options apart from the
three-file patch. `revision/IDENTITY-START.json` records complete source/build
and dependency hashes; `IDENTITY-END-CERTIFICATE.json` proves identical arms
through profiling and the final timing process. Patch/preimage identities,
commands and build output are retained under `revision/`.

Node v26.13.0, V8 14.6.202.34-node.40, Darwin arm64, CE JIT auto; Program/check
precision 21, notebook document-profile precision 15. The fixtures, result 10,
zero checker diagnostics, real persistent-scope notebook rerun 4/edit 5 and all
limits are unchanged from [the initial report](REPORT.md). All eight separate
controls pass. The lock owner is `codex-program-profile:revision`, acquired at
load 5.3/3.8/2.9. After measurements, the coordinator used the same reservation
for validation and released it at load 3.6/3.6/3.1. Validation is the coordinator's
work; this agent ran only the build and diagnostic/measurement processes.

## Ordinary timings

Each child warms up 1,000 operations, calibrates to batches of at least 100 ms
(bounded iteration ceiling), records seven samples, and validates outside each
timed batch. The result sink retains the final result. These processes have no
inspector, trace or GC flags. The same absolute frozen `tsx` loader and Tycho
CE hook are used in both arms. Each process runs serially under the lock.

ABBA order is accepted/revision/revision/accepted per workload. A bounded
revision/accepted pair fills missing accepted-arm coverage for box/check.
Ranges below are accepted independent process medians, in µs/operation. Ratios
divide the median of revision process medians by the median of accepted process
medians; they are observations, not universal confidence intervals.

| Workload | Accepted processes | Accepted µs | Revision processes | Revision µs | Ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| Box | 2 | 77.505–79.282 | 2 | 75.774–77.394 | 0.977 |
| Checker | 2 | 152.604–155.389 | 3 | 149.618–159.575 | 1.006 |
| Real notebook rerun | 2 | 129.223–137.862 | 2 | 127.936–135.132 | 0.985 |

All runtime controls pass. Checker/notebook process ranges overlap, and the
small box shift is close to the observed process spread. These data do not
establish a general speed recovery. The strict monitor excludes descendants of
the measured process, records browser activity/load, rejects external known
Node/compiler work above 80% CPU and load1 above 18, and requires direct child
exit 0 plus lock continuity. Three corrected timing processes fail that external
CPU gate and are excluded. Complete per-process samples, flags and rejected
interval details are in `revision/SUMMARY.json`; raw monitor files remain private.

The first timing driver also made twelve invalid attempts before CE import:
its monitor changes cwd to the private output folder, where relative
`--import tsx` could not resolve. Each child exits 1 and has no timing result.
This invocation defect was corrected to the absolute frozen loader path. Those
attempts remain in `revision/status.json` and rejection records, separately from
CPU-contention rejections. No product control or expected value was changed.

## Allocation and call counts

Fresh accepted and revision processes each warm up 1,000 then measure 20,000
operations. Allocation sampling interval is 32,768 bytes, including collected
objects; every process passes a separate allocating control. One sampled process
per arm/workload is not a statistical allocation envelope. CPU diagnostics run
separately at 250 µs and preserve raw profiles; no new source-map build was made
for the revision and no speculative new minified-function attribution is claimed.
All eight CPU, eight allocation and eight count processes exit 0.

| Workload | Fresh accepted bytes/op | Revision bytes/op | Sampled change |
| --- | ---: | ---: | ---: |
| Box | 233,630 | 228,807 | −2.1% |
| Parse+box | 282,554 | 281,726 | −0.3% |
| Checker | 445,763 | 445,456 | −0.1% |
| Real notebook rerun | 432,490 | 429,627 | −0.7% |

All diagnostic call counts match exactly between the fresh accepted and revision
arms for each fixture. For 20 operations plus final validation, box has 520 CE
`type()` calls, 201 `function()` calls and 571 lookups in both arms; checker has
520/360/1,000; notebook has 400/320/1,060. No new repeated-identical-raw-object
boxing is observed. The bounded guards do not remove the type/signature workload
identified by the original symbolized profiles.

For context only, the initial untouched-baseline sampled allocations were
140,630 bytes/op box, 189,939 parse+box, 386,757 checker and 334,344 notebook.
The revision remains approximately 62.7%, 48.3%, 15.2% and 28.5% above those
earlier single-profile estimates respectively. These are unpaired diagnostic
allocation comparisons across batches, with no significance or latency claim.

The [original matched report](../program-accepted-measurements-2026-11-15/FINAL-MATCHED-REPORT.md)
still records normal accepted/original-baseline ratios of 1.604 for box, 1.636 for
parse+box, 1.089 for checker and 1.262 for real notebook rerun; it also retains
JIT-off and whole-showcase results. Those are the accepted implementation's
historical matched observations. This revision used longer warmups/calibrated
batches and a new window, so its absolute latencies cannot be divided by or
multiplied into those earlier timings to claim a matched revision/original ratio.
No final revision/original-baseline latency envelope was measured.

## Evidence and disposition

`revision/SUMMARY.json` contains accepted/rejected ordinary samples, allocation
totals, exact counts, controls and raw CPU profile hashes. `revision/status*.json`
preserve command vectors/direct driver exits; child exits are in monitor records
and the summary. `revision/RAW-HASHES.json` indexes private raw evidence at
`/private/tmp/program-profile-revision-20261116/revision-matrix`, including CPU,
allocation/control profiles and monitors. The two frozen original arms and the
causal revision root are preserved. No large binary profile archive is staged.

The bounded patch and measurements are complete. No further optimization,
scalar retry, source change, test suite or additional timing was performed by
this agent. The coordinator owns final correctness validation and review.
