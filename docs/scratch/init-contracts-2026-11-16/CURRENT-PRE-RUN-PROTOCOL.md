# Updated initialization-contract measurements

The updated candidate is based on `fd7bad6e1a5155d239cd074a27031a2934b3e82a`
and the new IR compiler. This packet supersedes the unmeasured November 16
candidate; no measurements of that stale candidate will be presented here.

## Protocol fixed before updated candidate measurements

Three arms: genuine original frozen baseline
`/private/tmp/program-only-accepted-baseline-20261115` (`ffff1d44f`), untouched
current `fd7bad6e1`, and exactly that current source plus the final updated
initialization-contract delta. Original/current includes intervening unrelated
changes, including the compiler replacement; only current/candidate is causal.
All roots, source/build/dependency hashes and commands are recorded in the raw
archive `/private/tmp/ce-init-contracts-current-measurement-20261118`.

Reuse the previously fixed bounded 19-phase matrix: original box, parse+box,
check and real notebook rerun; Program total and first/repeated evaluate/N;
sum-loop box, total and first/repeated evaluate/N; collection box, total and
repeated evaluate/N. The independent expected results are 10, 10100 and 415;
notebook rerun is 4 and its edit is 5. Exact fixtures remain reviewable in the
private harness. Engine construction/module startup are excluded. Total phases
include parse, preparation and execution; first-execution phases exclude input
preparation and sum timed chunks of at most 4096 prepared expressions.

Ordinary timings retain 1000 warmups, calibrated >=100ms batches, seven samples,
serial original/current/candidate then reverse order, and two accepted independent
processes per arm/phase. At most two repair attempts per missing arm. Contention
policy is unchanged: 0.4s external-work sampling, reject known external Node/
compiler intervals above 80% CPU, load1 above 18, failed lock continuity or failed
child. Rejected samples remain archived. No acceptance threshold is widened.

Allocation: historical four phases plus Program total/repeated evaluate; loop
box/total/repeated evaluate; collection box/total/repeated evaluate, and bounded
Program/loop first-evaluate profiles. Inspector sampling includes collected
objects, interval 32768 bytes, allocating control, 20000 operations (4096 for
first execution). These are estimated allocated bytes, not exact counts or
retained heap. Retention keeps one engine/evaluator alive, eight retained handles,
twelve replacements, 3/40 checkpoints, retain/drop controls and three processes
per arm; explicit GC is outside timing.

The requested V8 document profiles use the actual saved Tycho notebook route:
`analyzeCortex` -> `executeCortexCell` -> `bindCortexPublications`, in one persistent
scope using the document engine profile. One cell contains
`let a = 3\nlet b = a+1\nb` (4); the edit changes 3 to 4 (5), then resets to the
original source before warming and profiling. This is that exact notebook cell
and state, excluding graph scheduling and UI; it represents no other notebook.
CPU and allocation profiles run in separate processes, never ordinary timing.
Raw inspector trees are retained. Source attribution requires byte-verified
auxiliary source maps; otherwise frames stay explicitly unmapped.

All builds and measured execution wait for the shared box lock and the
coordinator's final source freeze. Candidate snapshot is pending the coordinator's
SVD correctness correction. Original/current setup and harness preparation are
read-only with respect to production sources.

