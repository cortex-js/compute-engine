# Program-only baseline observations, 2026-11-15

Status: **partial exploratory baseline; no implementation and no candidate comparison.**
The orchestrator stopped the proposed replacement at its explicit checker-integration recost condition before production edits. Measurement expansion stopped then. This report records completed observations; it does not establish the full recommendation's performance acceptance envelope.

## Identity and reproduction

Source snapshots used for the runs (removed after preserving evidence): `/private/tmp/program-only-baseline-20261115/ce` and `/private/tmp/program-only-baseline-20261115/tycho`. No production sources were edited. Source copying included src/scripts, package files and tsconfig; dependencies are symlinks to each original checkout's installed node_modules. `source-manifest.json.gz` (gzip-compressed JSON) records every copied src/scripts file hash. Aggregate CE hash `aeb25a8e06968f89d49b06766d4a3aee7067ac6215692482db05db2e0bbc6fc9`; Tycho `25ab7ed5ce4aa772ba7acf181574f1f291af87cea3eb337cfc2c3a1e849d8f51`. These include generated JS/declaration files present in those directories, not just TS.

Node v26.13.0; V8 14.6.202.34-node.40; arm64 macOS; source package production build with `BUILD=production node scripts/build.mjs`, minified ESM production entries (`dist/esm-min`). The build used current installed esbuild and package dependencies; no dependency installation or shared dist build occurred. `bundle-manifest.json` records built bundle hashes. `commands.json` records exact commands, cwd and exit codes. Build log is empty on success. `artifact-hashes.json` identifies the copied artifacts. Adapters and raw results/logs are durable here; temporary source/bundle snapshots were removed after preserving evidence. Recreate that layout with matching source/dependencies (or adjust relative imports) before rerunning adapters. No source snapshot or bundle is embedded in this folder.

The Tycho loader is the frozen existing `scripts/repros/ce-alt-hook.mjs` and its implementation, which select the frozen CE production bundle. Its routing announcement is in `tycho-normal-1-log.txt`. Only CE's implicit JIT setting was normal/default. Explicit Tycho prelude compilation stayed enabled, exactly as production does.

## Shared-box conditions and acceptance limits

Read the benchmark skill, benchmark README, BUILD and shared-box rules first. `claude-session.mjs` explicitly accepts a supplied owner when no named Claude parent exists; this documented path was used, without altering session records or lock machinery. Acquired `codex-program-only:baseline` after 15 s, for 35 minutes. Acquisition load 9.6/7.9/6.8 on 18 cores; released load 4.0/6.1/6.3. Build and timing commands checked the lock. Frozen sources prevent shared-tree tearing.

**These are exploratory timings, not accepted uncontended timing samples.** A process check during the initial CE run found transient other Node processes at ~100% CPU and a Chrome renderer at ~100%; a subsequent identity check found those Node processes already gone. There were no Jest runners/workers. `processes-before.txt` preserves the process snapshot (despite its filename, obtained during CE's initial run). Exact overlap with each timed operation was not continuously monitored. The normal CE process completed successfully, but control repeatability across isolated processes was not established before the stop. First and later Tycho rounds show warmup differences. Do not treat their ratios as an acceptance envelope or compare a candidate against them without fresh matched repeats.

## Completed CE observations

The adapter asserts result 10 for its four-statement function/variable program, result 5 after an invalid sibling, and zero diagnostics for 12 type-alias/protocol pairs. It separates parsing, current parser-container boxing, source parsing/boxing, engine construction, execute first run in a fresh pushed scope, source rerun in the same namespace, cached boxed scalar evaluation, failure continuation, checking and a whole-source edit. Box-only ASTs are prepared before timing; first-run engine creation is separate. The repeated boxed scalar control is cached and is not the source-run workload. Library-name resolution is included in parse-and-box but excluded in box-only.

Each CE case has 10 warmup calls, seven samples of 40 calls, except engine construction (10) and boxed repeat (1,000). Assertions are outside timing. Raw samples are in `ce-normal-1.json`; times below are ms/call, median and full sample range.

| Case | Median | Range |
| --- | ---: | ---: |
| control-parse-scalar | 0.002297 | 0.001692–0.002953 |
| parse-only | 0.010455 | 0.009205–0.034295 |
| box-only-current-parser-container | 0.113559 | 0.077897–0.225901 |
| parse-and-box | 0.103614 | 0.084123–0.136185 |
| engine-construction | 1.843025 | 1.654275–2.077454 |
| full-first-run | 0.635089 | 0.547379–0.932278 |
| same-caller-namespace-rerun | 0.514485 | 0.450770–0.609057 |
| boxed-expression-repeat | 0.000014 | 0.000014–0.000027 |
| failed-statement-continuation | 0.366710 | 0.263781–0.559322 |
| check-only | 0.221371 | 0.198896–0.243180 |
| type-protocol-heavy-check | 1.241525 | 1.153613–1.354396 |
| whole-source-edit | 0.528327 | 0.520941–0.614048 |

The scalar parse control is smaller than statement-rich parse (~4.5x median), so the timing instrument sees the expected construction work. This is an instrument distinction, not a candidate result. No production semantic discrepancy was inferred from these controls.

## Completed Tycho observations

The adapter ran all 15 current nonempty showcase preludes three times on fresh document engines and asserted `valid`. Totals contain complete source parsing, checking, function installation, compilation, execution, value inspection and snapshot creation. No statement or large initialization was removed or capped; each statement's route and compile/run time is recorded in `tycho-normal-1.json`. Buddhabrot's complete initialization and the slower Turing-patterns initialization are included separately in those records. These are fresh-run observations with first-round warmup, not steady-state accepted timings.

| Prelude / fresh edit input | Median ms | Range ms |
| --- | ---: | ---: |
| traffic-jam | 78.474 | 65.317–159.128 |
| othello | 27.840 | 24.920–41.922 |
| heat-spread | 26.646 | 25.397–40.257 |
| burning-ship | 6.614 | 5.330–9.069 |
| multibrot | 6.648 | 6.600–6.966 |
| buddhabrot | 550.340 | 505.396–582.196 |
| julia-set | 17.789 | 15.769–18.990 |
| game-of-life | 30.739 | 28.399–35.972 |
| apollonian-gasket | 152.814 | 134.513–187.422 |
| barnsley-fern | 41.676 | 40.715–46.227 |
| koch-snowflake | 34.615 | 34.029–36.508 |
| turing-patterns | 1574.301 | 1461.861–1576.180 |
| galton-board | 79.364 | 78.475–93.043 |
| fish-swarm | 48.856 | 48.547–51.981 |
| black-hole | 10.006 | 8.799–10.528 |
| prelude-edit-a | 2.093 | 2.011–2.512 |
| prelude-edit-b | 1.912 | 1.892–2.121 |

The two small prelude variants use fresh engines. They are whole-source re-preparation controls, not a `DocumentCEManager` in-place edit, so no live-document edit claim follows.

The notebook adapter attempted the real `createCeNotebookEvaluator` and compute graph with an Epsil cell, then same-source and edited recomputes. The graph returned `cycle` before execution in every attempt (`cortexRuns` empty). Those timings are **invalid for notebook execution/rerun/edit** and are retained only to explain the missing measurement. This is an unsuitable instrument input, not an established production defect.

## Heap diagnostic and missing coverage

The already-started CE process also sampled allocations over 400 box/run programs in one namespace, with explicit GC outside timers and both dropped and deliberately retained function results. Raw bytes/checkpoints are preserved. The sampling profile and long-lived engine/earlier workloads remain in the same process, so its heap totals do not isolate released engines, closures, raw ASTs or metadata. The retained function-result control was not independently shown to retain a lexical closure. Therefore **no leak/no-leak or allocation comparison conclusion is valid**. A fresh-process, calibrated retained-closure control and inspector cleanup are necessary for acceptance-quality heap work.

Not measured because delivery stopped: JIT-off CE/Tycho repeats; isolated-process normal control repeatability; accepted construction/first-run/steady-run/edit envelope; successful notebook cell reruns/whole-source edits; full live-document prelude edits; sync/async cancellation and debugger/source-range semantic controls; type/protocol checker restoration correctness beyond zero diagnostics; named Othello/heat-spread action mathematics and Burning Ship/Multibrot/Game-of-Life integration parity; calibrated allocated/live heap comparison after dropping engines and closures. Merely running those named preludes does not establish their action or plotting integration controls. Existing named integration controls are `showcase-othello.test.ts`, `showcase-heat.test.ts`, and `showcase-prelude-parity.test.ts` under Tycho `tests/node/graph-paper/`; none ran in this stopped baseline task.

No test suite, corpus audit, typecheck, code review, staging or commit ran: no implementation changed and the delivery stopped before candidate work. Issues added/removed: 0/0; no production defect was asserted by these exploratory adapters. The orchestrator owns any later validation after recost authorization.

Archived log files use `-log.txt` names; commands.json retains the original `.log` output paths used by the executed commands.
