# Program replacement: matched baseline, 2026-11-15

Status: **CE implementation gate established; no candidate measured.** The orchestrator accepted the minimal CE gate after three independent normal processes and two independent CE-`jit = 'off'` processes passed the mathematical/instrument controls. Complete Tycho source workloads and calibrated heap controls also ran; Tycho's timing envelope is partial where external work overlapped. This report makes no no-regression claim for a candidate.

## Fixed identity and build

Frozen roots are `/private/tmp/program-only-accepted-baseline-20261115/ce` and `.../tycho`. Preserve them and their dependency installations until candidate/baseline interleaving is complete. No production source was edited by this measurement task. Every tracked frozen CE `src/` file was compared byte for byte to Git objects at `ffff1d44fc566ef01fb52a0ce67b6797797f4dcf`; all matched. Only untracked `.DS_Store` files were absent from that commit. Source hash, rather than current moving HEAD, identifies the run.

CE source aggregate: `7cf995bb13fe1f8d2edc5144687a0f11c51283042e24b66ca8de3844ba5d4673`. Tycho source aggregate: `e2e227383829d114b5995d44c8da035025cf49b4d896ebf22d50d8b103b2858c`. `source-manifest.json.gz` contains every copied src/scripts file hash plus package/config hashes; `key-source-hashes.json` lists the directly relevant CE files. The snapshots include existing generated JS/declaration files and ignored artifacts, so these are broader hashes than only tracked TypeScript. No git command ran in Tycho.

The frozen CE built with `BUILD=production node scripts/build.mjs`, exit 0, through its own copied build script and shared installed node_modules. Timing uses the minified split production ESM bundles selected by the real package exports. `baseline-bundle-manifest.json` identifies every built artifact. `environment.json` records package/config/build-script hashes and esbuild/tsx versions. Node 26.13.0, V8 14.6.202.34-node.40, arm64 macOS, CE precision 21 digits in the CE microcases. Ordinary V8 is used for timing: no explicit GC, inspector, JITless or profiling flags. CE `jit = 'off'` disables the engine's implicit compilation, not V8 JIT. Tycho's explicit prelude compilation remains enabled in both modes, matching its production route. Tycho source is loaded through tsx; the CE it calls is the frozen production build, selected by its existing `scripts/repros/ce-alt-hook.mjs`.

## Box state and acceptance

The supported terminal-compatible lock-owner path was used without altering session registration. Lock `codex-program-accepted:baseline` was acquired after 235 seconds, load 12.2/15.1/13.5 on 18 cores. It was held for the build and all measurements and then released; `lock-log.txt` and `release-log.txt` record the state. The process monitor reads CPU-time deltas at roughly 0.4-second intervals, excludes the measured Node process, wrapper and all their descendants, and records before-process state, lock checks, loads and external CPU. An external Node/esbuild/typecheck/test process consuming more than 80% of one core in an interval, or 1-minute load above 18, rejects that window. Known test/corpus workers have an additional low activity rejection. Browser activity is recorded separately.

The first pilot overlapped several external Node workers and a busy Chrome renderer. It is retained but not used for an accepted envelope. At the orchestrator's direction, fixed browser background activity alone does not invalidate timing: the controls must repeat under that recorded activity, and the candidate must be interleaved with a fresh baseline to verify the same envelope. Accepted CE processes have no detected transient worker contenders; their recorded loads are roughly 3–5 on 18 cores. These are **background-loaded**, not uncontended runs. Whole-process monitor rejections remain in raw artifacts; they are never averaged into accepted CE medians.

For longer Tycho processes, individual sample wall-clock windows are recorded in repeat4/5. A sample is rejected if its window intersects a monitor interval with transient CPU or excessive load, conservatively padding interval edges by 100 ms. This retains unaffected cases without silently accepting overlapped cases. `summary.json` records every accepted/rejected sample, independent-process median and full spread. Earlier Tycho repeat1–3 lacked case timestamps and do not contribute to accepted per-case timings.

## CE envelope

The CE source declares `square`, computes `square(3)+1`, and has independent result 10. The failed-sibling control must finish with 5. Twelve type-alias/protocol pairs must check with zero diagnostics. Direct boxed-container evaluation also gives 10. All accepted processes pass those assertions. A scalar parse control and a cached scalar evaluate control distinguish parser work from a near-empty repeat.

Each case has 100 warmup calls and seven measured batches of 100 calls, except scalar parse (1,000 calls/batch), cached scalar repeat (10,000), engine construction (20 calls/batch, 20 warmup) and heavy type/protocol checking (30 calls/batch). Assertions stay outside timing. Parse-only excludes library-name resolution; parse+box includes it. Box-only reuses the parsed/resolved AST. Full-first-run includes parsing/boxing/execution in a new pushed caller scope, excluding engine construction. Source rerun executes again in one caller namespace. Prepared-container repeat evaluates one previously boxed current-parser container. The whole-source edit alternates the numeric initializer 3/4 and reparses/reexecutes it. No compiled Program executor or stopped Document prototype is involved.

Accepted processes: normal repeat1/4/5, off repeat1/5. Table entries are median of independent-process medians, with their range; the full range of batch samples is shown separately. Units are ms/call. A small number of isolated processes establishes a local empirical envelope, not a statistical confidence interval.

| Case | Normal | CE JIT off |
| --- | ---: | ---: |
| control-parse-scalar | 0.000879 (0.000842–0.001683); samples 0.000528–0.002631 | 0.000900 (0.000888–0.000912); samples 0.000536–0.002496 |
| parse-only | 0.010419 (0.007170–0.010611); samples 0.005774–0.033155 | 0.011330 (0.010301–0.012359); samples 0.005868–0.037350 |
| box-only-current-parser-container | 0.071168 (0.068290–0.071363); samples 0.053502–0.137277 | 0.074534 (0.072144–0.076923); samples 0.053619–0.111449 |
| parse-and-box | 0.068435 (0.068337–0.075648); samples 0.057275–0.104280 | 0.074365 (0.072187–0.076544); samples 0.059963–0.116457 |
| engine-construction | 1.687402 (1.604458–2.442754); samples 1.298092–3.042396 | 1.731570 (1.589906–1.873233); samples 1.459438–3.360213 |
| full-first-run | 0.479421 (0.476848–0.494106); samples 0.403250–0.647580 | 0.521634 (0.518759–0.524509); samples 0.420105–0.807140 |
| same-caller-namespace-rerun | 0.380066 (0.373384–0.390548); samples 0.363477–0.438657 | 0.385711 (0.385150–0.386273); samples 0.369537–0.450177 |
| prepared-container-repeat | 0.043176 (0.043158–0.044765); samples 0.037435–0.053771 | 0.043495 (0.042973–0.044017); samples 0.040283–0.051696 |
| control-cached-scalar-repeat | 0.000004 (0.000004–0.000005); samples 0.000003–0.000010 | 0.000004 (0.000004–0.000005); samples 0.000003–0.000011 |
| failed-statement-continuation | 0.238703 (0.235191–0.241952); samples 0.222925–0.277782 | 0.267871 (0.259435–0.276307); samples 0.250582–0.292785 |
| check-only | 0.156005 (0.151891–0.159549); samples 0.141071–0.193097 | 0.174446 (0.174196–0.174697); samples 0.159428–0.339962 |
| type-protocol-heavy-check | 1.071290 (1.068676–1.079918); samples 1.011878–1.106801 | 1.159664 (1.102464–1.216864); samples 1.059822–1.787896 |
| whole-source-edit | 0.366739 (0.362289–0.382199); samples 0.316467–0.624107 | 0.384487 (0.365067–0.403907); samples 0.341713–0.821505 |

Startup is separate from the warmed matrix. It includes production module import, the first engine construction and the first full source run in a loaded Node process; process creation itself is not included. Units ms.

| Mode / startup phase | Median | Process range |
| --- | ---: | ---: |
| normal/importMs | 89.628 | 84.449–93.939 |
| normal/firstEngineMs | 23.423 | 22.908–26.098 |
| normal/coldFullRunMs | 17.192 | 17.098–19.266 |
| off/importMs | 92.790 | 87.956–97.625 |
| off/firstEngineMs | 23.994 | 23.179–24.810 |
| off/coldFullRunMs | 17.386 | 16.453–18.318 |

## Tycho full workloads and remaining timing gaps

Every current nonempty showcase prelude ran in full on fresh document engines, including complete Buddhabrot, Game of Life and Turing-patterns initialization. No source or initialization statement was truncated, replaced, capped or omitted. Each entry has one warmup run and three measured fresh-engine runs per process. The adapter asserts `valid` and verifies that the complete value snapshot hash agrees with the warmup within that process. Raw records retain every value statement's names, route, compile time and run time, plus complete parse/check/compile/run/total phases. This is a determinism/control check, not an independent mathematical oracle for every generated value.

The notebook control calls the real evaluator's analysis, `executeCortexCell` child-scope execution and `bindCortexPublications` directly in its persistent section scope. It checks rerun result 4 and edited-source result 5, with seven batches of 20 calls/phase. It excludes compute-graph scheduling, browser UI/rendering and evaluation-latch semantics; this replaces the earlier unsuitable graph input that returned `cycle` without executing. Fresh prelude source variants are also measured; they are full source re-preparations, not live `DocumentCEManager` in-place edits.

Units ms/operation. Range is across available independent-process medians; counts show how much accepted evidence exists. **A one-process entry is provisional, and an unavailable entry has no accepted timing envelope.** Those gaps must be completed by baseline/candidate interleaving before a claim that no Tycho regression exists. They do not invalidate the already-established CE source gate.

| Case | Normal | CE JIT off |
| --- | ---: | ---: |
| traffic-jam | 65.094 (62.892–67.296); 2 processes/6 samples | 70.429 (70.429–70.429); 1 processes/3 samples |
| othello | 23.618 (23.341–23.896); 2 processes/6 samples | 31.115 (31.115–31.115); 1 processes/3 samples |
| heat-spread | 25.491 (24.161–26.822); 2 processes/6 samples | 26.895 (26.895–26.895); 1 processes/3 samples |
| burning-ship | 6.315 (5.926–6.704); 2 processes/6 samples | 5.947 (5.766–6.127); 2 processes/6 samples |
| multibrot | 6.720 (5.465–7.976); 2 processes/6 samples | 5.838 (5.733–5.942); 2 processes/6 samples |
| buddhabrot | 501.266 (491.832–510.700); 2 processes/5 samples | 510.158 (486.760–533.556); 2 processes/6 samples |
| julia-set | 16.393 (16.393–16.393); 1 processes/3 samples | 16.241 (15.991–16.490); 2 processes/6 samples |
| game-of-life | 25.617 (25.617–25.617); 1 processes/3 samples | 27.733 (27.368–28.099); 2 processes/6 samples |
| apollonian-gasket | 144.974 (144.974–144.974); 1 processes/2 samples | 126.634 (120.906–132.362); 2 processes/6 samples |
| barnsley-fern | unavailable: all windows overlap external CPU | 37.514 (37.259–37.770); 2 processes/6 samples |
| koch-snowflake | unavailable: all windows overlap external CPU | 31.365 (31.300–31.430); 2 processes/6 samples |
| turing-patterns | 1559.336 (1559.336–1559.336); 1 processes/2 samples | 1546.415 (1546.415–1546.415); 1 processes/3 samples |
| galton-board | 78.343 (78.343–78.343); 1 processes/3 samples | 82.889 (71.886–93.892); 2 processes/4 samples |
| fish-swarm | 44.366 (44.366–44.366); 1 processes/3 samples | 44.984 (44.984–44.984); 1 processes/3 samples |
| black-hole | 8.985 (8.985–8.985); 1 processes/3 samples | 9.548 (9.548–9.548); 1 processes/3 samples |
| notebook-direct-execution-and-publication:rerun | 0.192 (0.192–0.192); 1 processes/7 samples | 0.209 (0.209–0.209); 1 processes/7 samples |
| notebook-direct-execution-and-publication:whole-source-edit | 0.221 (0.221–0.221); 1 processes/7 samples | 0.226 (0.226–0.226); 1 processes/7 samples |
| prelude-edit-a | 1.728 (1.728–1.728); 1 processes/3 samples | 1.710 (1.710–1.710); 1 processes/3 samples |
| prelude-edit-b | 1.430 (1.430–1.430); 1 processes/3 samples | 1.703 (1.703–1.703); 1 processes/3 samples |

The existing Othello/heat-spread and Burning Ship/Multibrot/Game-of-Life mathematical action/plotting parity tests did not run in this measurement task. Running their preludes does not claim that broader integration coverage. A full live-document prelude edit also remains unmeasured. The implementation validation owner must run appropriate semantic controls; no broad test suite was assigned here.

## Heap controls

Heap work uses separate fresh diagnostic processes (`--expose-gc`) and does not share timing processes. Each mode runs three independent processes for drop, deliberately retained lexical closures, and an allocating control. Each of 400 iterations executes a top-level declaration program in the same caller namespace, then a block that returns a real lexical closure. Engines and closures are released separately; GC runs three times at each checkpoint and outside allocation sampling. A retained closure is independently called and must return 5. Allocating controls retain 400 arrays of 4,096 numbers, so the expected payload is about 12.5 MiB plus headers. Clearing those arrays releases that amount, demonstrating the live-byte instrument distinguishes retention and release.

Allocation is sampled separately at a 32 KiB interval, including collected objects, over another 400 identical program/closure pairs. The inspector profile is dereferenced and the session disconnected before the final cleanup reading. Allocation bytes are statistical estimates, not exact constructor counts. Because both programs run per iteration, one record's allocation covers 800 execute calls. Allocation sampling deliberately measures the same execute workload in all modes; the array payload calibrates live retention, not allocation sampling.

Table values are medians in MiB across three processes; raw ranges and all checkpoints are in `summary.json` and individual heap records. Held delta is above the warmed module baseline; release is held bytes minus bytes after dropping the engine and all explicit retained objects; post-drop delta is the remaining warmed-process increase.

| Mode / retained state | Sampled allocation | Held delta | Released after drop | Post-drop delta |
| --- | ---: | ---: | ---: | ---: |
| normal/drop | 227.962 | 1.519 | -0.001 | 1.520 |
| normal/retain-closures | 227.739 | 9.289 | 6.674 | 2.615 |
| normal/allocating-control | 231.150 | 14.039 | 12.522 | 1.517 |
| off/drop | 228.369 | 1.514 | -0.001 | 1.515 |
| off/retain-closures | 226.882 | 8.515 | 6.674 | 1.841 |
| off/allocating-control | 228.418 | 14.045 | 12.522 | 1.523 |

Held closures keep required captured state after dropping the explicit engine reference and release about 6.67 MiB when cleared. The roughly 1.5–2.6 MiB post-drop increase contains warmed code/cache/module state and possibly other residual objects; these totals alone neither prove nor disprove a leak or identify raw AST/metadata retention. A candidate comparison must use the same process lifecycle and compare changes against the matched controls. No revision history/tombstone workload is relevant to Program-only.

## Reproduction and candidate matching

`commands.json` records commands, cwd, environment and direct exit codes; all source/build/control executions exited 0. A monitor wrapper exits 3 for rejected timing evidence, separately from the child's 0 exit. Adapters, monitor, exact run scripts, raw results/logs and compressed monitor histories are saved here. To rerun, use the preserved temporary root so the adapters' relative `ce`/`tycho` imports and package links resolve; changing paths must preserve the recorded source/build identity.

For a candidate, begin from the frozen CE source at the pinned commit and apply only the Program implementation patch. For Tycho, begin from its frozen source and replace only the three authorized parsed-container consumers (`prelude-runner.ts`, `cortex-analysis.ts`, `ce-notebook-evaluator.ts`) after checking their hashes/diff; do not copy the moving complete Tycho checkout. Use the same package dependencies and copied production build script/options. Record the complete diff/source hashes and dependency hashes before building.

Use the same adapters and fixtures. For CE, preserve the accepted adapter byte identity. Tycho repeat4/5 differ from earlier pilots only by untimed wall-clock metadata needed to certify each sample; use that final adapter for both candidate and interleaved new baseline. Run AB/BA serially under the lock, keep accepted normal and JIT-off results separate, and rerun a matched baseline alongside the candidate rather than treating today's small envelope as timeless. Retain rejected artifacts, exclude them from ratios, complete provisional/unavailable Tycho windows, and report per-case differences outside the repeated baseline envelope before accepting a performance tradeoff.

No production files, broad source tests, corpus, typecheck, code review, staging or commit were performed by this measurement task. The only build was the frozen baseline production build. Issues added/removed: 0/0. Production semantic validation belongs to the orchestrator/implementer; these controls do not replace it.
