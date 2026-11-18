# Updated initialization-contract measurements

The candidate does **not** recover original box, parse+box or notebook latency.
Against the matched current control, historical medians decrease, but Program
first-N and collection repeated-N have higher, disjoint process ranges. Solver
passes disappear without removing all type work; some getter demands increase.

## Matched sources and protocol

Current is untouched `fd7bad6e1a5155d239cd074a27031a2934b3e82a`; candidate is
exactly that source plus the final updated initialization-contract delta and its
matrix correctness correction. Both use the new IR compiler. Genuine original
is the unchanged `ffff1d44fc566ef01fb52a0ce67b6797797f4dcf` frozen baseline.
Original/current includes unrelated intervening changes; only current/candidate
is a causal comparison. The stale November 16 candidate was never timed here.

Node 26.13.0, V8 14.6.202.34-node.40, Darwin arm64, 18 cores. Program phases use
precision 21; the saved real notebook uses the document profile, precision 15.
CE JIT is auto. Ordinary children have no profiler, trace or GC flags. Fresh
engine/module startup is outside warm operations. The first-execution phase
uses fresh prepared expressions; preparation is excluded and bounded 4096-input
chunks accumulate >=100ms. Total phases include parse, prepare and execution.
Extended engines explicitly use an unlimited iteration budget before untimed
setup, equally on all arms; historical fixture policy is unchanged.
All measured batches validate outside timing. Program/loop/collection oracles
are 10/10100/415. The collection is the saved small gasket `fourth` builder,
checking four appended tuples and first curvature; it is not the whole gasket.

The saved actual Tycho cell returns 4:

```epsil
let a = 3
let b = a+1
b
```

Its edit changes 3 to 4, returning 5, then resets before 1000 warmups and profiling.
Each operation follows analyzeCortex -> executeCortexCell ->
bindCortexPublications in one persistent scope. Graph scheduling/UI and other
notebooks are outside this scope. Original uses its frozen compatible original
host; current/candidate share the same frozen Program consumer host.

The pre-run protocol and bounded allocation amendment are archived in
`CURRENT-PRE-RUN-PROTOCOL.md` and the raw request files. Ordinary processes run
serially in O/current/candidate then reverse order, 1000 warmups, calibrated
>=100ms batches and seven samples. Two accepted independent processes are the
target; the repair cap remains two attempts per missing arm. The 0.4s monitor
rejects known external Node/compiler intervals above 80% CPU, load1 above 18,
failed lock continuity or failed children. Rejected windows remain retained.

## Completed historical timings and real notebook profiles

Both updated production builds and all 57 correctness processes passed, direct
exit 0. The original source, frozen Tycho host, production bundles and build
configuration still match the prior final certificate byte for byte
(`ORIGINAL-REVALIDATED.json`). The sandbox initially denied `ps` before any timing
child launched; that rejected setup attempt is retained. The workflow restarted
with approved process access, retaining every monitor gate.

All four historical phases have two accepted independent processes per arm.
Ranges are process medians in microseconds/operation; ratios divide medians of
those process medians. They are bounded shared-machine observations.

| Phase | Original µs | Current µs | Candidate µs | Candidate/current | Candidate/original |
| --- | ---: | ---: | ---: | ---: | ---: |
| Box | 41.98–45.02 | 76.50–88.23 | 72.72–75.77 | 0.901 | 1.707 |
| Parse+box | 59.73–63.08 | 94.02–106.95 | 90.38–100.74 | 0.951 | 1.556 |
| Check | 136.97–156.86 | 150.91–154.80 | 145.48–148.18 | 0.961 | 0.999 |
| Real notebook rerun | 102.05–104.91 | 129.68–149.60 | 127.00–135.18 | 0.939 | 1.267 |

The candidate does not recover the original box, parse+box or notebook latency.
The checker ranges overlap; its ratio does not establish a speed difference.
Original/current comparisons include unrelated changes and are not causal.

The actual saved notebook produced CPU profiles with 7110/8942/8744 samples
(original/current/candidate), all direct exits 0. Separate allocation profiles,
20000 reruns each, estimate 335511/429696/414162 allocated bytes per rerun.
Candidate/current is 0.964 and candidate/original 1.234. One profile per arm is
not a statistical allocation envelope. These are allocation estimates, not
retained bytes. CPU/profile durations are not used as ordinary latency results.

Raw files are in `cpu-document/` and `allocation-document/`. Auxiliary source-map
builds matched every executed minified production file byte for byte after
recorded equal-width import-hash restoration: 38 original files and 37 each for
current/candidate, zero unmatched. The auxiliary code was never executed.
`map-proof-{original,current,candidate}.json` supplies the complete proof. Source
attribution/postprocessing ran after ordinary timings to avoid CPU contention.


## Execution and loop/collection phases

Microseconds/operation below are medians of accepted process medians. All rows
have two independent processes per arm except `*` (one) and `—` (none). Full
process ranges and raw references are in `CURRENT-MEASUREMENT-SUMMARY.json`.

| Phase | Original µs | Current µs | Candidate µs | Candidate/current |
| --- | ---: | ---: | ---: | ---: |
| Program total | 121.39 | 150.64 | 141.36 | 0.938 |
| Program first evaluate | 45.39 | 49.73 | 49.82 | 1.002 |
| Program first N | 62.52 | 52.69 | 64.80 | 1.230 |
| Program repeated evaluate | 33.72 | 33.30 | 32.42 | 0.974 |
| Program repeated N | 38.23 | 34.70 | 34.10 | 0.983 |
| Loop box | 52.52 | 43.82 | 44.81 | 1.023 |
| Loop total | 1259.47 | 1074.72 | 1110.54 | 1.033 |
| Loop first evaluate | 1148.47 | 1047.93 | 1042.66 | 0.995 |
| Loop first N | 1208.01 | 1098.03 | 1053.86 | 0.960 |
| Loop repeated evaluate | 970.16 | 898.63 | 896.89 | 0.998 |
| Loop repeated N | 1061.17 | 937.43* | 899.23 | 0.959 |
| Collection box | 1917.06 | — | 3029.98 | — |
| Collection total | 4042.17* | 5667.04 | 5042.66 | 0.890 |
| Collection repeated evaluate | 895.80 | 1452.82 | 1421.64 | 0.979 |
| Collection repeated N | 882.07 | 1448.38 | 1627.28 | 1.124 |

The execution results are mixed. For example, Program first N and collection
repeated N have higher candidate/current medians; the accepted ranges are disjoint upward for these two fixtures. These are
bounded fixture regressions, not a universal estimate for other programs. Collection-box
current has no accepted timing, so no causal timing ratio is supplied for it.

## Allocation and the bounded recovery

One original 20000-operation collection-box allocation process aborted near
V8’s default 4GB heap ceiling (child `-6`; workflow exit `250`). Its log and
requests are retained; it produced no valid allocation result. The remaining
collection allocation phases were recovered at **2000 operations on every arm**,
with the same 1000 warmups, 32KiB interval and collected-object flags. No heap
limit or timing gate was increased. The cause of that resource failure is not
attributed to an engine leak or to the profiler alone.

There are 42 valid allocation profiles: 33 original-sized profiles and 9 bounded
collection profiles. The table gives estimated allocated bytes/operation.

| Phase | Operations | Original bytes | Current bytes | Candidate bytes |
| --- | ---: | ---: | ---: | ---: |
| Collection box | 2000 | 4,318,652 | 8,425,424 | 7,043,111 |
| Collection repeated evaluate | 2000 | 1,728,471 | 3,148,909 | 3,157,041 |
| Collection total | 2000 | 7,953,573 | 12,088,997 | 10,836,726 |
| notebook | 20000 | 335,511 | 429,696 | 414,162 |
| Loop box | 20000 | 147,371 | 148,548 | 147,498 |
| Loop first evaluate | 4096 | 2,926,176 | 2,742,521 | 2,779,709 |
| Loop repeated evaluate | 20000 | 2,861,690 | 2,709,113 | 2,732,171 |
| Loop total | 20000 | 3,069,383 | 2,915,782 | 2,940,776 |
| Program first evaluate | 4096 | 109,659 | 132,477 | 130,312 |
| Program repeated evaluate | 20000 | 90,368 | 103,334 | 103,401 |
| Program total | 20000 | 285,296 | 381,697 | 370,530 |
| box | 20000 | 139,593 | 228,882 | 218,365 |
| check | 20000 | 387,792 | 438,049 | 435,558 |
| parse-box | 20000 | 190,159 | 279,623 | 269,291 |

The smaller recovery samples have no equivalent-confidence claim against the
20000-operation phases. Allocation and ordinary timing are separate processes.

## Retention

All 72 retention processes passed. Values below are median whole-heap deltas
after explicit GC, in KiB, relative to each process’s warmed baseline; three
processes per cell. Negative deltas are possible and are not negative object
sizes. One engine/evaluator remains alive. These are neither exact retained
object-family sizes nor proof that every long-lived host workload is leak-free.

| Scope/checkpoints/handles | Original KiB | Current KiB | Candidate KiB |
| --- | ---: | ---: | ---: |
| program-3-retain | 659.4 | -327.6 | -325.9 |
| program-3-drop | 385.4 | -504.9 | -519.7 |
| program-40-retain | 9879.4 | 1790.4 | 1772.9 |
| program-40-drop | 9624.9 | 1630.7 | 1605.4 |
| notebook-3-retain | -371.4 | -526.7 | -501.7 |
| notebook-3-drop | -421.7 | -552.2 | -531.0 |
| notebook-40-retain | 1466.7 | -290.3 | -294.0 |
| notebook-40-drop | 1475.0 | -316.2 | -314.2 |

Current/candidate long-checkpoint totals are similar in this bounded experiment.
The original retains more whole heap in the long Program run, but its source and
compatible host differ from current; this is not attribution to one change.

## Actual work, distinct from getter requests

Three separate observer builds, three distinguishing calibrations and 24 traces
passed; no events were dropped. Every calibration demands 10 warmed natural
`.type` reads and observes 0 fresh `boundCallType` entries. Each fixture warms
three times and records three logical operations. Instrumentation is private,
never used for latency/allocation results. Source wrappers count actual helper
entries; natural getters are separate demands and overlapping counts are not
summed as independent computations.

| Fixture | Bound-call entries C→candidate | Full signatures C→candidate | Evidence passes C→candidate | Evidence rejoins C→candidate |
| --- | ---: | ---: | ---: | ---: |
| Box | 8→7 | 2→2 | 1→0 | 1→0 |
| Check | 11→11 | 3→3 | 1→0 | 1→0 |
| Notebook rerun | 4→3 | 0→0 | 2→0 | 2→0 |
| Loop box | 2→2 | 0→0 | 1→0 | 1→0 |
| Loop total | 4→4 | 0→0 | 1→0 | 1→0 |
| Collection box | 468→380 | 4→4 | 1→0 | 24→0 |
| Collection total | 608→533 | 6→6 | 1→0 | 24→0 |

Notebook natural function-type/binding-type/declaredType reads change
11/115/169→5/92/138. Collection-box declaredType reads rise 4997→9752 and
collection-total reads 6125→12223, despite fewer bound-call entries. Checker
full signatures remain 3 and bound-call entries 11. Removing the solver therefore
does not eliminate all type work, and some demands increase.

Canonicalization entries remain distinct from evidence passes: notebook keeps
two Program and two shared-sequence entries per operation; the two evidence
passes/rejoins disappear. Candidate initializer-contract helper entries are 4
for notebook and 20 for the collection fixture. Signature/getter counts do not
prove unchanged inputs or interchangeable results; no redundancy verdict is
inferred from equal printed types.

## Profile interpretation and evidence

All six document profile symbolizations pass byte-proof checks. CPU self samples
map 85.3/88.5/88.6% to CE source (original/current/candidate); allocation bytes
map 69.8/69.1/68.7%. Other builtin/Node/host frames stay explicit. Candidate self
CPU is distributed: garbage collection 5.7%, `isFunction` 1.6%, `operands` 1.6%,
`canonicalSequence` 1.5%, `createSymbolExpression` 1.5%. Candidate allocation self
frames include Map 8.9%, BoxedFunction constructor 6.3%, Set 5.8%, slice 3.3% and
`boxFunctionInternal` 3.1%. These are function-entry attributions, not precise
allocating instructions. Inclusive stack rows overlap and must not be summed.

There are 110 accepted and 30 rejected ordinary processes. Sixteen phases have
complete two-process/arm coverage; three qualified gaps remain. Every measured
batch checks its result outside timing. The original, current and candidate
source/build/config/dependencies are unchanged across the measured window, and
the candidate still exactly matches the final implementation source.

The box lock was acquired for 40 minutes at load6.9/9.6/6.4 and released promptly
after measured execution at 3.3/4.0/4.5. Raw outputs include every request, direct
exit, rejected interval, full inspector tree and passive event array. The first
sandbox-denied process-listing attempt produced no timing sample and remains
separate. No contention threshold or repair cap was widened.

- `CURRENT-MEASUREMENT-SUMMARY.json`: compact complete values, coverage, profiles and counts.
- `CURRENT-MEASUREMENT-IDENTITY.json`: source/build/config and provenance certificate.
- `CURRENT-MEASUREMENT-RAW-HASHES.json`: retained raw/harness artifact paths and SHA256 hashes.
- Private `symbolized/`: complete CPU/allocation rows and stacks with byte-map proofs.
- Private `traces/`, `TRACE-SUMMARY.json`: complete observer events and streaming count summary.
- Private `retention/`: all 72 process checkpoints, controls and cleanup readings.

No production source was edited for measurements. Root owns implementation
correctness/review/integration validation. No broad corpus, browser/UI or other
notebook performance claim is made.


Both measurement control worktrees were removed after preserving their complete
plain source/build snapshots at the same recorded paths. Final identity checks
still pass. Raw profiles, event arrays and maps are retained privately. No new
issue file, commit or publication was created by the measurement work. Wide
correctness suites remain the coordinator’s responsibility.
