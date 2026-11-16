# Program profiling revision — 2026-11-16

The added preparation cost is concentrated in type/signature computation and
the metadata allocated around it. These profiles support investigating those
existing owners. They do not support a repeated-public-boxing explanation or a
shared-engine scalar regression. No production code changed during this work.

## Identity and execution

Both arms execute the original frozen minified production ESM under
`/private/tmp/program-only-accepted-{baseline,candidate}-20261115`. The baseline
source anchor is `ffff1d44fc566ef01fb52a0ce67b6797797f4dcf`; the accepted implementation
was committed in main as `4cb2e040ba0165f4f943646db152cef07dc07878`.
`identity-profile-end.json` records every source/build/config/dependency/adaptor
hash. Its SHA256 is
`721a1022d79fbfaa5e5d87efb93a5a21280b4205d725d12c06aa5e8811e49eaf`.
`identity-comparison-to-final-frozen.json` confirms that both arms' source, build,
dependencies and adapters are byte-identical to the preceding final matched
measurement identity. The source/build identity was checked after profiling,
against the prior frozen certificate, rather than freshly captured at its start.

Node was v26.13.0, V8 14.6.202.34-node.40, Darwin arm64. CE Program/check/scalar
fixtures use precision 21; the real notebook document profile uses precision 15.
Both use CE JIT auto.
No original arm was rebuilt. Private auxiliary map generation used the same
frozen source, dependencies and production build script, with external maps and
private output paths. The private build commands and direct exits are in
`source-map-proof.json`; both exited 0. Auxiliary JavaScript was never executed.

The lock was `codex-program-profile:diagnostics`, acquired for 30 minutes at load
2.2/2.0/1.7 on 18 cores. It was released after all diagnostic/scalar processes at
load 3.3/2.6/2.4, passing the reservation to the queued Tycho session. The release
log is retained. CPU/allocation diagnostic processes did not have the external
CPU monitor attached; their elapsed durations are not ordinary benchmark timing
results. Scalar processes did have the strict external-work monitor.

## Work and controls

Each CPU/allocation process warms up 1,000 operations then records 20,000.
CPU samples at 250 µs; allocation sampling uses a 32,768-byte interval and includes
objects collected by major/minor GC. An allocating object/array control precedes
each allocation profile and must produce samples. Separate controls, CPU,
allocation and count processes all exit 0: 32 child processes total. All 16
symbolization invocations also exit 0. `profile-status.json` and
`attribution-status.json` preserve commands, flags, counts and direct exits.

The Program fixture is:

```epsil
function square(x) { x*x }
let x = 3
let y = square(x)
y+1
```

It returns 10 and has zero checker diagnostics. Box-only reuses its resolved raw
AST; parse+box parses and resolves it each time. Checker calls `checkEpsil`.
The notebook uses the actual frozen Tycho evaluator, a document-profile engine,
one persistent scope, and `analyzeCortex`, `executeCortexCell`, then
`bindCortexPublications`. Its source is `let a = 3\nlet b = a+1\nb`: rerun gives
LaTeX `4`, edit `3` to `4` gives `5`, then restoration gives `4`. This measures real
evaluation/publication without graph scheduling or UI. Controls are asserted
before recording and after the measured workload.

## Grouped CPU and allocation evidence

CPU columns below are sampled inclusive µs per logical operation, with the
function's own sampled µs in parentheses. Allocation columns are estimated
inclusive bytes per operation, with own bytes in parentheses. Inclusive rows
overlap and must not be added. For a function with multiple mapped entries,
CPU uses the largest entry's inclusive value; allocation counts each allocation
stack once when it contains that function. Expanded top self rows and exact
ancestor stacks are in `PROFILE-SUMMARY.json`.

| Workload / owner | Baseline CPU | Accepted CPU | Baseline allocation | Accepted allocation |
| --- | ---: | ---: | ---: | ---: |
| Box / `boundCallType` | 1.28 (0.19) | 21.38 (1.69) | 1,760 (287) | 58,077 (8,478) |
| Checker / `boundCallType` | 29.21 (2.31) | 33.21 (2.17) | 76,964 (10,472) | 86,992 (11,502) |
| Notebook / `boundCallType` | 6.59 (0.37) | 15.09 (1.54) | 15,449 (1,376) | 45,030 (5,839) |
| Box / `_setType` | 0.25 (0.03) | 0.28 (0.06) | 208 (208) | 125 (125) |
| Checker / `_setType` | 0.22 (0.05) | 0.47 (0.06) | 161 (161) | 136 (136) |
| Notebook / `_setType` | 0.09 (0.00) | 0.42 (0.05) | 0 | 2 (2) |

Total estimated allocation rises from 140,630 to 232,528 bytes/op for box,
386,757 to 447,981 for checker, 334,344 to 431,599 for notebook, and 189,939 to
283,001 for parse+box. These are sampled allocation estimates, not retained heap
sizes or exact object counts. The box `boundCallType` subtree adds approximately
56 KB/op while total estimated box allocation adds approximately 92 KB/op.

| Allocation subtree (bytes/op) | Box baseline → accepted | Checker baseline → accepted | Notebook baseline → accepted |
| --- | ---: | ---: | ---: |
| `withEvidenceSession` | 88,484 → 177,926 | 19,293 → 191,514 | 0 → 119,121 |
| `recordInitializerEvidence` | 4,360 → 13,774 | 1,629 → 13,813 | 2,901 → 28,695 |
| `functionLiteralSignatureType` | 0 → 37,601 | 64,239 → 65,362 | 0 → 0 |

The new signature subtree is substantial in boxing; baseline checking already
pays most of that signature work. Notebook cost also grows for the fixture
without any authored function. Native Map/Set allocations remain explicit:
in accepted box they account for approximately 10.4% and 7.0% of sampled self
allocation respectively; `BoxedFunction.constructor` accounts for 8.7%.
This is metadata/object churn, with concrete type-computation ancestors below.

Verified accepted allocation ancestor paths include:

```text
canonicalProgram → canonicalSequence → withEvidenceSession
  → BoxedFunction.type → cachedValue → BoxedFunction.compute
  → type → boundCallType

Declare canonical handler → recordInitializerEvidence
  → BoxedFunction.type → cachedValue → BoxedFunction.compute
  → type → boundCallType

boundCallType → functionLiteralCallSignatureType → functionLiteralSignatureType
  → BoxedFunction.type → cachedValue → BoxedFunction.compute
  → type → boundCallType
```

For checker, separate allocation stacks also reach `documentBindings` and its
sort from `resolveLibraryNames`, and from `staticDiagnostics` →
`canonicalizationDiagnostics`. These are separate semantic preparations; this
profile does not establish that they may be shared. It also does not prove that
two `.type` reads recompute the same node under unchanged state. It identifies
the owners whose redundant reads/writes should be checked, without adding caches.

Separate 20-operation diagnostic counts show fewer public `box()` calls in the
accepted arm: checker 120→20, notebook 160→40. No identical raw object is boxed
again within an accepted operation. CE `type()` calls rise box 420→520 and
notebook 200→400. Counts include final result validation and are diagnostic
call counts, not timed measurements. They do not count every internal type
getter. Raw counts and example stacks are archived.

The final `canonicalSequence` widening loop is a plausible redundant type-read
site from source inspection, but the mapped CPU/allocation frames identify
function entries, not its exact statement. `_setType` itself is small in these
profiles. An invariant-safe known-scalar no-op guard might avoid surrounding
metadata work, but these results do not authorize skipping `unknown` writes:
those writes can clear stored values. Any selected change needs its existing
owner invariant and then matched affected-workload measurements.

## Exact source mapping and limits

`verified-source-map-proof.json` covers all 26 reachable modules per arm from
both original Epsil and full CE entries, following static and literal dynamic
imports. Stale unreferenced chunks are excluded. Generated import chunk hashes
alone are restored in private copies, eight characters to eight characters;
the complete restored JavaScript SHA must equal the executed original. All 52
module mappings pass, with no reachable module unmapped. The proof records raw
auxiliary, restored, original and map hashes and every replacement range.

The map's `sourceRoot` display prefix is omitted during lookup because its
`sources` already resolve relative to the auxiliary map directory to frozen
source paths. Source AST ownership supplies function names; source hashes are
retained in the attribution. CPU self mapped coverage is 83.1%→90.4% for box.
Native frames, GC, harness frames and unmapped Tycho loader frames remain
explicit. A minified line's ticks cannot recover an exact instruction column.
Reported stacks identify a function/call path, not an exact allocating statement.
One sampling profile per workload/arm supports mechanism investigation, not a
statistical latency envelope or a no-regression claim.

## Calibrated scalar control

Eight ordinary processes were attempted in ABBA order twice, independently.
Each loop warms up 20×100,000 iterations, calibrates batches to approximately
150 ms or the iteration ceiling, consumes/checks every checksum and global sink,
and records seven samples. Ordinary processes have no profiler, trace or GC
flags. The loops compare empty arithmetic, numeric-array reads, boxed `.re`,
cached `.evaluate().re` on four boxes, and the same direct/cached read on one box.
Cached evaluation identity and result values are asserted.

All eight child exits are 0. The external monitor rejects four processes because
of independent `tsc`/`esbuild` intervals over 80% CPU. Three baseline and one
accepted process pass the unchanged monitor; therefore this bounded attempt
does not establish two accepted independent candidate processes or a fully
matched scalar ratio. Rejected results remain archived and are excluded below.

| Loop | Baseline accepted process medians (ns/call) | Accepted-arm process median (ns/call) |
| --- | ---: | ---: |
| Empty | 0.267–0.290 | 0.265 |
| Direct numeric array | 0.545–0.546 | 0.546 |
| Direct boxed array | 1.367–1.485 | 1.311 |
| Cached boxed array | 1.120–1.669 | 1.418 |
| Direct single box | 0.882–1.067 | 1.061 |
| Cached single box | 0.884–1.056 | 1.063 |

The matched direct-read controls and substantial process variation make an old
4 ns→13 ns claim unsuitable evidence of a shared-engine regression. No such
claim follows from this result. V8 can inline/hoist pure scalar work; these loops
measure the optimized caller and retain their direct/empty floors, rather than
pretending to isolate a call overhead by subtraction. Separate diagnostic
`--trace-opt --trace-deopt` processes exit 0 for both arms. All six loops reach
TurboFan; the logs contain expected OSR deoptimization transitions. Trace-process
durations are excluded from ordinary timing results.

## Artifacts and reproduction

- `PROFILE-SUMMARY.json`: grouped self/inclusive data, top rows/stacks, scalar
  process medians and rejection records.
- [Private raw archive](/private/tmp/program-profile-revision-20261116/raw-profiles-and-maps.tar.gz) (SHA256 `fd9cd3369815abb71fe6be4725c3fa659aed23f0bb820aaeb371f7518931c782`): raw inspector CPU/allocation/control profiles,
  requests/results/logs, per-process commands/status, monitors, private verified
  JavaScript/maps and auxiliary build scripts. Expanded attribution trees can be
  regenerated with `benchmarks/program-regression-symbolize.mjs`; private originals remain
  at `/private/tmp/program-profile-revision-20261116`.
- The exact instruments are the three `benchmarks/program-regression-*.mjs` files.
  A separate timing-mode branch was added after this initial diagnostic run;
  the byte-proved original child is retained privately as
  `/private/tmp/program-profile-revision-20261116/program-regression-child.initial.mjs`.
  Its SHA and the current instrument SHAs are in `ARTIFACT-HASHES.json`.
  The instruments and `benchmarks/README.md` are the only repository changes
  outside this report folder.
- `control-results/` preserves compact correctness, count and scalar outputs.
- `run-profiles.py`, `run-scalar.py`, `run-scalar-repeat.py`, `monitor.py` preserve
  orchestration; status JSON stores exact argument vectors and environment.
  These require the same frozen private paths, CE/Tycho dependency symlinks and
  an acquired shared box lock. Do not run them against a moving source tree.

No Jest, full suite, original production build, whole-showcase expansion or
implementation changes were run; they were outside this bounded diagnostic task.

The subsequent, separately built guard-only causal comparison is in
[REVISION-REPORT.md](REVISION-REPORT.md). Its measurements do not overwrite this
initial diagnostic evidence.
