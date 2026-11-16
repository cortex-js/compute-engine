# Matched type-demand revision measurements

The revision removes one full signature derivation per checker operation and
unnecessary type getter requests. It does not remove the Program preparation
cost: in this matched window revision/original-baseline latency ratios are
1.820 for box, 1.500 for parse+box, 1.100 for checker and 1.276 for real notebook
rerun. This is not a no-regression pass. The modest box/parse+box timing shifts
against the guard arm do not establish a checker/notebook speedup.

## Three arms and source proof

All arms were measured in one protocol:

| Arm | Frozen root | Source |
| --- | --- | --- |
| Original | `/private/tmp/program-only-accepted-baseline-20261115` | Untouched `ffff1d44fc566ef01fb52a0ce67b6797797f4dcf` baseline |
| Guard | `/private/tmp/program-only-profile-revision-20261116` | Accepted Program implementation plus the preceding guard patch, on the original anchor |
| Revision | `/private/tmp/program-only-type-work-revision-20261116` | Guard copied with symlinks preserved, plus only the five-file `program-type-work-sol.patch` |

The guard represents the Program/guard change committed in main through
`050a140880e56a9698fa61b99ef7205a53b651c9`, applied causally to the older frozen
source. It is not the complete current-main tree. Unrelated peer IR, collection
and numeric changes are excluded. No source file was copied from moving main.
Both patch check and application exit 0; exactly five source paths change.
`causal-revision-source.json` records their preimage/postimage and patch hashes.

Only the uninstrumented revision `ce/dist` was cleaned and built:
`BUILD=production node scripts/build.mjs`, direct exit 0, same production script,
configuration and dependencies as the frozen arms. Original and guard builds
were reused. `FINAL-IDENTITY.json` records source/build manifest hashes,
configuration/dependency identities, instrument hashes and hashes of the private
complete identity files. Source, build and dependencies match from timing start
through the final traces. No original build or production source changed.

Node v26.13.0, V8 14.6.202.34-node.40, Darwin arm64. CE JIT is `auto`; this protocol
does not disable V8 optimization. Program/check precision is 21; the real Tycho
document-profile notebook precision is 15. The Tycho source/hook route remains
the frozen route for each arm, with only the previously accepted three Program
consumer changes between original and guard. No Git command ran in Tycho.

## Controls and ordinary timing

The unchanged Program fixture is:

```epsil
function square(x) { x*x }
let x = 3
let y = square(x)
y+1
```

It returns 10 and has zero checker diagnostics. Box reuses the resolved raw AST;
parse+box parses/resolves/boxes each operation. Checker calls `checkEpsil`.
Notebook uses the actual persistent-scope Tycho evaluator:
`analyzeCortex` → `executeCortexCell` → `bindCortexPublications`, source
`let a = 3\nlet b = a+1\nb`. Rerun gives 4; changing 3 to 4 gives 5. Graph scheduling
and UI are excluded. All twelve separate three-arm controls pass; every measured
batch checks its result outside the timed interval.

Each independent process warms up 1,000 operations, calibrates batches to at least
100 ms (bounded iteration ceiling), then records seven samples. It retains the
last result and validates outside each timed batch. Node has no profiler, trace
or GC flags in ordinary timing. Both loaders use the same installed `tsx` package
and frozen CE hook. Source/startup/engine construction are excluded from these
warm-operation durations.

Order is original/guard/revision, then revision/guard/original per workload.
At most two further attempts per missing arm repair rejected windows. The final
coverage is two accepted independent processes per arm for all four workloads.
There are 24 accepted and 12 rejected ordinary processes; all 36 child exits are
0. Rejected processes fail the strict external-work monitor, not correctness.
No timing threshold was relaxed. Accepted processes have maximum observed
load1 6.1373. The monitor excludes the child and its
descendants, requires lock continuity, records fixed browser activity, and
rejects known external Node/compiler intervals above 80% CPU or load1 above 18.
Rejected records and all sample distributions remain available.

Ranges below are process medians in µs/operation. Ratios divide medians of the
independent process medians. They are bounded shared-machine observations, not
universal confidence intervals.

| Workload | Original µs | Guard µs | Revision µs | Guard/original | Revision/guard | Revision/original |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Box | 40.918–41.616 | 76.250–81.723 | 74.482–75.691 | 1.914 | 0.951 | 1.820 |
| Parse+box | 59.466–59.675 | 96.384–97.011 | 89.134–89.531 | 1.623 | 0.924 | 1.500 |
| Checker | 135.091–135.985 | 142.956–154.622 | 148.781–149.445 | 1.098 | 1.002 | 1.100 |
| Real notebook rerun | 104.745–107.873 | 129.674–144.617 | 129.343–141.975 | 1.290 | 0.989 | 1.276 |

The box/parse+box revision medians are lower than the guard observations here.
Checker and notebook ranges overlap substantially; their ratios provide no
demonstrated latency improvement. All revision ranges remain above the original
baseline ranges. These are direct same-window three-arm comparisons, not ratios
formed by combining earlier measurement windows.

The shared lock `codex-program-type-work:three-arm` was acquired for 20 minutes at
load 5.1/4.2/3.9 on 18 cores. Measurement processes ran serially. Once the complete
measurement/trace driver exited 0, the coordinator received an explicit handoff
for separate correctness validation; its tests did not overlap these timings.
The coordinator subsequently released the lock after its full suite, at load
25.2/15.9/9.1; that post-timing validation load is not a timing observation.

## Allocation diagnostic

Separate processes warm up 1,000 then sample 20,000 operations per workload/arm,
at a 32,768-byte allocation interval, including objects collected by minor/major
GC. All twelve allocation processes and their known allocating controls pass.
The allocating control must produce samples before the workload is sampled.
These are sampled allocated-byte estimates, not retained heap or exact object
counts. One process per arm is not a statistical allocation envelope. External
CPU monitoring was not attached to these diagnostic processes, and no allocation
process duration is used as a timing result.

| Workload | Original bytes/op | Guard bytes/op | Revision bytes/op |
| --- | ---: | ---: | ---: |
| Box | 140,052 | 230,482 | 229,074 |
| Parse+box | 189,647 | 281,476 | 279,183 |
| Checker | 385,822 | 444,099 | 435,665 |
| Real notebook rerun | 332,151 | 429,063 | 429,470 |

The bounded revision does not recover the original allocation levels. The
small sampled changes are not given a significance claim.

## Demonstrated work reduction

After ordinary timings/allocation, two separate private observer forks were
built and run with the identical final instrument. They are diagnostic code,
never used for latency measurements. Each trace warms up three times and records
three logical operations. Ten final traces (both arms × four workloads plus
notebook edit) exit 0, validate all results, and drop no events.

The observer records actual derivation entry separately from natural getter
requests. Counts below are per logical operation. Getter columns overlap through
ordinary delegation and must not be summed as independent computations.

| Fixture | Actual bound-call derivations G→R | Full literal signatures G→R | Function `.type` requests G→R | Binding `.type` reads G→R | Binding `declaredType` reads G→R |
| --- | ---: | ---: | ---: | ---: | ---: |
| Box | 8→8 | 2→2 | 26→18 | 141→123 | 196→172 |
| Parse+box | 8→8 | 2→2 | 26→18 | 141→123 | 196→172 |
| Checker | 11→11 | 4→3 | 36→23 | 169→144 | 224→193 |
| Notebook rerun | 4→4 | 0→0 | 11→11 | 123→115 | 185→169 |
| Notebook edit | 4→4 | 0→0 | 11→11 | 123→115 | 185→169 |

Checker retains one written-scope full signature and replaces the current-scope
full signature with one current-scope effects-only query. Effects derivations
remain four per checker operation, while full signature derivations fall from
four to three. This proves narrower requested output, not equivalent input
contexts or a reusable cached answer.

The deferred maps execute only inside their existing applicable guards.
For box/parse+box, tuple-coordinate operand-map executions fall from six to two
per operation; the point/number and codomain operand maps fall from six/four to
zero. Checker tuple maps fall from eight to three, with point/number and codomain
maps eight/six to zero. Notebook keeps the arithmetic tuple and point/number
maps but eliminates four codomain maps per operation. The `passedThrough` Boolean
map still executes; its per-operand type thunks are skipped where the existing
operator guard rejects them. No full literal signature has any of these maps
as an ancestor in the measured fixtures, so that mechanism is not claimed.

Evidence behavior is retained: box/parse+box/check have one site rejoin per
operation; notebook rerun/edit have two. All settle on pass 0, coarse false,
returning false, exactly as the guard arm. The notebook still performs real
initial evidence writes from `unknown` to `number`, marking evidence and advancing
the binding write version and engine type/any versions before the RHS is derived
again. Same-node repeated calls therefore have changed observed state; they are
not labelled redundant. No evidence pass, setter write, validation or generic
signature fallback was skipped by this patch.

The passive observer records binding identities, stored slots, skeletons,
write versions, requester stacks and context/lifecycle state. It never asks
`.type`, `.value` or `.json` to inspect state. Module-local views/overlays and
arbitrary host state are not fully captured. Changed observed context precludes
unchanged-input equivalence; matching observations would still be unknown.
`FINAL-SUMMARY.json` includes changed-input examples and the retained notebook
write timeline. There is no production dependency tracker or persistent cache.

## Evidence and limits

- `FINAL-SUMMARY.json`: all accepted ordinary samples, rejected intervals,
  controls, allocation estimates and compact paired trace tables/timelines.
- `FINAL-IDENTITY.json`, `causal-revision-source.json`: compact source/build/dependency
  certificates; complete original manifests remain private and are hash-linked.
- `final-{guard,revision}-INSTRUMENTATION.json` and corresponding `.diff` files:
  exact private observational changes, separate from `production-revision.patch`.
- `three-arm-status.json`, `three-arm-trace-status.json`, `three-arm-build-status.json`:
  command argument vectors, environment and direct exits; driver/monitor scripts
  are retained alongside them.
- `FINAL-RAW-HASHES.json`: private raw result, monitor, allocation/control and trace
  hashes under `/private/tmp/program-type-work-20261116/three-arm`. Raw event/profile
  arrays and full manifests remain private; no large binary packet is staged.

No new scalar, whole-showcase, JIT-off, browser or UI measurements were run.
This bounded comparison covers the four assigned warm workloads and actual type
demands. Correctness tests, independent review and staging belong to the
coordinator; this agent ran no Jest or full suite and made no production edit.
