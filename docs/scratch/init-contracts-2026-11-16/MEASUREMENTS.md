# Initialization contract measurements

## Frozen pre-run plan (2026-11-16)

No candidate measurement has run. This protocol is fixed before candidate readiness;
acceptance gates and sample exclusions will not change in response to results.

Original is the untouched source and production build at
`/private/tmp/program-only-accepted-baseline-20261115`, previously certified as
`ffff1d44fc566ef01fb52a0ce67b6797797f4dcf`. Current is an isolated snapshot of
`dbcfdca7e5b5a8852b6554a1ad359dfac4724c1e`. Candidate is that same current source
plus only the final initialization contract delta. Original/current differences
include intervening unrelated commits; those ratios will not imply causal
attribution. Current/candidate source differences must be enumerated and hashed.
Original source/builds remain unchanged. The real notebook needs the respective
frozen compatible Tycho consumer: original uses its original host, current and
candidate use the same accepted Program consumer host. No host checkout is edited
and no git command runs there.

The four historical fixtures remain identical: box, parse+box and check of
`function square(x) { x*x }; let x=3; let y=square(x); y+1` (10, zero diagnostics),
and real persistent-scope notebook analyze/execute/publication of
`let a=3; let b=a+1; b` (4, edit 3 to 4 gives 5). Precision, JIT auto, runtime,
loader and dependencies match the prior protocol. Source/startup/engine creation
are outside warm operations. New execution phases separate freshly prepared
first evaluate and N, repeated same-expression evaluate and N, and total
parse/prepare/first execute. Preparation remains inside end-to-end allocation
measurements. The existing sum-loop fixture from `test/epsil/execute.test.ts`
is measured separately for preparation and execution with a mathematical sum
oracle. A bounded existing loop-carried collection witness is included only if
it passes the same controls on all three arms; unsupported or incompatible
controls are explicit and never used for ratios.

Ordinary timing: serial original/current/candidate then reverse for each workload,
1,000 warmups, calibrated batches of at least 100 ms, seven samples per process,
two accepted independent processes per arm/workload. At most two repair attempts
per missing arm. First-execution batches prepare fresh expressions before their
timers; their setup and retained batch size are recorded. Ordinary Node has no
profiler, trace or GC flags. Result validation occurs outside timed intervals.
The monitor records process ancestry, external interval CPU, browser activity,
load and lock continuity every 0.4 seconds. A known external Node/compiler above
80% CPU, load1 above 18, failed lock continuity or failed child invalidates the
whole process. Rejected artifacts stay available. No threshold is widened.

Allocation is separate sampled inspector allocation, including collected objects,
32,768-byte interval, 1,000 warmups and 20,000 operations where practical. Every
process must observe its allocating control. Sampled bytes are estimates, never
exact object counts or retained bytes. First and end-to-end scopes state whether
preparation is included. Retention is separate explicit-GC measurement outside
timing, with 8 retained/12 replaced handles, 3 and 40 checkpoints, three processes
per arm, plus dropped-handle control. Program and notebook retention scopes and
lifecycle cleanup are recorded independently.

Separate private observer source forks count analysis passes/rejoins, actual
bound-call and full-signature derivations, and natural getter requests. They
never supply latency results. Observers do not request types/values/JSON to inspect
state. Original observer incompatibilities are documented; getter calls are never
labelled derivations. Instrument source/diffs and calibration controls remain
reviewable. No new production framework or production instrumentation is added.

Builds and all timings require `codex-init-contracts:measurement` box lock and an
explicit coordinator window. Builds use the existing production build command
and common installed dependencies. Exact commands, direct exits, source/build/
dependency hashes, pre/post identities, monitor records and all raw samples live
under `/private/tmp/ce-init-contracts-measurement`. Original prior certificates
are in `docs/scratch/program-type-work-2026-11-16/FINAL-IDENTITY.json` and private
`/private/tmp/program-type-work-20261116/three-arm`.

No builds, timings, Jest or broad corpus checks have run for this packet yet.
Coordinator owns implementation correctness, review and integration validation.

Before candidate readiness the coordinator narrowed the cross-product: retain the
four historical phases; add Program total and first/repeated evaluate/N; sum-loop
box, total and first/repeated evaluate/N; collection box, total and repeated
evaluate/N. Loop/collection parse+box/check and collection first execution are
omitted to avoid redundant phases; loop-heavy preparation and execution remain
covered. This is 19 bounded phases (four historical plus fifteen extensions),
not a corpus expansion. All continue to use the unchanged 1,000 warmups.

## Preparation and controls

The genuine original source, production bundles and build configuration were
rehashed against the previous final certificate: all match. Private
`original-revalidation.json` preserves the full proof. Original/current source
comparison enumerates 84 differing source paths, with both hashes, in
`original-current-source-differences.json`.

Current was built at its pinned commit with `BUILD=production node scripts/build.mjs`;
direct exit 0. Original reused its unchanged build. All 38 correctness processes
(19 phases per arm, 1,000 warmups each) passed, direct exit 0. Exact requests,
command vectors, results and logs are private under `controls-status.json` and
`current-build-status.json`. These are controls, not performance observations.
The lock was acquired at load 4.2/3.9/4.0 and released immediately after controls
at 5.0/4.1/4.1; timing/allocation/retention have not run. Candidate remains pending.

The loop is the existing `total = total + i * 2` fixture bounded to 100 iterations
(oracle 10100). The collection copies existing gasket `csqrt` and `fourth`
functions verbatim, retaining its nested loops and typed loop-carried list, and
checks four appended tuple candidates with a length/curvature checksum of 415.
It is a small collection control, not full gasket execution. Its source origin,
source hash and exact text are in private `collection-fixture.json`.

Allocation amendment fixed 2026-11-16T16:02:12.121209+00:00 before candidate freeze: 12 phases are historical box/parse+box/check/notebook; Program total/repeated evaluate; loop box/total/repeated evaluate; collection box/total/repeated evaluate. Two additional bounded first-execution evaluate profiles (Program and loop, 4096 expressions) separate execution allocations from preparation. The other allocation phases use 20,000 operations; sample sizes are reported directly, with no equivalent-confidence claim. Duplicate N allocation phases are omitted because ordinary timings retain both evaluate and N. The causal current anchor remains `dbcfdca7e5b5a8852b6554a1ad359dfac4724c1e`; candidate is not frozen or measured.

First-execution timing amendment fixed 2026-11-16T16:03:07.484569+00:00 before candidate freeze: keep at most 4096 preprepared expressions live, but accumulate multiple separately timed chunks into each calibrated >=100ms sample. Identical chunk policy applies to all arms. Chunk counts and individual durations are recorded. Preparation stays outside these summed execution intervals and inside the separate total phase. No calibration or contention threshold changes.

Extensions use a reused engine at precision 21/JIT auto and explicitly set its
iteration limit to Infinity before untimed setup, equally for all arms. They
request `evaluate()` or `N()` as named; historical fixtures keep their original
engine policy. This setting permits direct boxed loop execution and is outside
timed work. Retention keeps one engine or one persistent notebook evaluator/scope
alive throughout each process; post-handle-drop heap does not claim that engine
or evaluator was reclaimed. Explicit lifecycle cleanup is recorded separately.

## Frozen candidate preparation

The candidate was copied from the pinned current build inputs and the frozen
implementation worktree's complete `src/`, without using moving main. The
implementation remains anchored at `dbcfdca7e5b5a8852b6554a1ad359dfac4724c1e`;
current main's subsequent numeric-context peer commit is excluded from this
matched experiment. There are 22 differing source paths versus current, including
source-owned Epsil documentation. Complete pre/post hashes and configuration
agreement are in private `FROZEN-CANDIDATE-SOURCE.json`. Candidate source matches
the frozen implementation exactly.

Three separate observer forks were prepared by private source copying and
instrumentation, with no build or CE execution. Exact per-arm instrumentation
manifests and unified diffs are `instrumentation-{original,current,candidate}.*`.
Unavailable helpers and removed files are explicit, including the original's
absence of Program canonicalization and candidate's removed evidence solver.
The observer counts natural getter requests separately from actual derivation
entries and evidence rejoin pass indices; canonicalization entries are not
labelled fixpoint passes. All production arm source trees remain uninstrumented.
Candidate builds, controls and all measurements remain pending coordinator
correctness/window authorization.
