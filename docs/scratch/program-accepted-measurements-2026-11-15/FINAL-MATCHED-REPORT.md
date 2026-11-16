# Final matched Program measurements

**Observed costs require coordinator review; this is not a no-regression pass.** The accepted normal measurements show parse+box 1.636×, box 1.604×, caller-namespace rerun 1.197×, check 1.089× and whole-source edit 1.126×. Normal full-first execution 1.016× stays within the observed baseline process envelope. The real notebook evaluator shows normal rerun 1.262× and edit 1.217×. Sampled allocation increases about 17–21% per 400 program pairs (800 executions), while the array release control remains 12.522 MiB in both arms. These compare the final frozen candidate with the untouched source/build baseline; no optimization or further production change was made.

Timing completion: the bounded run retains explicit JIT-off Tycho timing gaps below; no missing ratio is claimed.
All 15 full showcase value hashes match between baseline and candidate in both modes. Notebook direct-evaluator rerun 4/edit 5 controls pass. All 36 heap byte-control processes completed with calibration/correctness controls; their CPU/duration flags are reported separately.

## Source, build and environment

Baseline: `ffff1d44fc566ef01fb52a0ce67b6797797f4dcf`; frozen roots `/private/tmp/program-only-accepted-{baseline,candidate}-20261115`. Candidate CE is the final old-worktree source patch on that frozen baseline; candidate Tycho is the original frozen Tycho source plus exactly `prelude-runner.ts`, `cortex-analysis.ts` and `ce-notebook-evaluator.ts` Program-container consumers. No Git command ran in Tycho. Baseline sources/builds were preserved. No current-main HEAD or unrelated peer change was substituted.

- baseline CE non-Markdown source path/hash-map SHA256: `8675939e3f7fc6dacccad4eddb782361ad9f35691fc364423c3415b45b225b3a`.
- candidate CE non-Markdown source path/hash-map SHA256: `9aee65ca2ef677fc5f8bc8a3dc472b88cce5acf7ed80a2a5312315f3627d5600`.

Production build ran **once**, `BUILD=production timeout -k 30 600 node scripts/build.mjs` in candidate/ce, direct exit 0. Subsequent bounded windows reused that exact build after complete source/build/dependency hash verification; no unchanged checkpoint rebuild. Timing uses `dist/esm-min/epsil.js`. Node 26.13.0, V8 14.6.202.34-node.40, arm 64, precision 21. Baseline/candidate build scripts/options/package locks and installed dependency hashes match. All three adapters are byte-identical across arms. No GC or profiling flag is enabled in ordinary timing. CE `jit="off"` disables CE automatic JIT, not V8 or Tycho’s explicit compilation routes. Startup remains separate from warm operations.

The final [identity certificate](final-matched-matrix-certification.json) verifies both frozen arms stayed unchanged through all phases; complete hashes are in [end identity](final-matched-identity-timing-end.json.gz). Source/runtime changes were never used to revise benchmark controls. Only the coordinator’s docs/issues/report work proceeded outside the frozen candidate.

## Commands and bounded repetition

Own shared-box owner: `codex-program-accepted:matched-performance`. The acquire, failed/released windows, reacquisitions and final release are retained. Each process ran serially, with normalABBA and offBAAB ordering and bounded contention retries. Existing valid accepted observations from the same certified build were reused; all rejected windows remain archived. Initial sources and previous provisional measurements remain separate.

```sh
# ordinary CE process, repeated by final-matrix.py
CE_ROOT=ARM/ce python3 monitor.py NAME timeout -k 10 180 node ARM/ce-time.mjs OUT.json auto\|off
# full unchanged Tycho adapter
CE_ALT_PKG=ARM/ce python3 monitor.py NAME timeout -k 10 180 node --import tsx --import ARM/tycho/scripts/repros/ce-alt-hook.mjs ARM/tycho-time.mts OUT.json auto\|off
# separate heap diagnostic process
CE_ROOT=ARM/ce python3 monitor.py NAME timeout -k 10 180 node --expose-gc ARM/heap.mjs OUT.json drop\|retain-closures\|allocating-control auto\|off
```

Exact argv arrays, environment, direct exits and process names are in [matrix status](final-matched-matrix-status.json.gz). The commands above use alternatives for readability; the stored argv arrays are executable without that notation. [Driver](final-matched-final-matrix.py), [monitor](final-matched-monitor.py), [summary instrument](final-matched-summarize-final.py) and [artifact index](final-matched-artifacts.json) preserve the full reproduction inputs.

CE:100 warmups then 7 samples×100 iterations; scalar parse 1000 iterations, cached scalar 10000, construction 20 iterations/20 warmups, heavy type/protocol check 30 iterations. Tycho: full original 15 nonempty showcase preludes,1 warmup+3 fresh-engine samples each, including complete Buddhabrot/Turing/GameOfLife initialization. Notebook executes the actual analyze/child-evaluate/publication path 7×20 batches in a persistent caller scope. It excludes compute-graph scheduling, UI rendering and browser/Document performance. No replacement graph stub or truncated initialization is used.

## Matched CE envelopes

Ranges are process medians in milliseconds; ratios divide medians of those process medians. Full 7 sample distributions and startup values are retained in [machine-readable summary](final-matched-final-summary.json.gz). A ratio is reported only with≥2 accepted processes in both arms. The baseline envelope is a bounded shared-machine observation, not a universal error bar.

### normal

Accepted baseline/candidate processes: 6/3.

| Case | Baseline ms | Candidate ms | Candidate/baseline |
| --- | ---: | ---: | ---: |
| control-parse-scalar | 0.000842292–0.000974042 | 0.00180017–0.0019775 | 2.251× |
| parse-only | 0.00689125–0.0109467 | 0.00687292–0.00717917 | 0.663× |
| box-only-current-parser-container | 0.0631954–0.0768146 | 0.11001–0.119007 | 1.604× |
| parse-and-box | 0.0655412–0.0763242 | 0.11074–0.114009 | 1.636× |
| engine-construction | 1.42666–1.87349 | 1.44387–1.55156 | 0.951× |
| full-first-run | 0.474577–0.523122 | 0.483008–0.488345 | 1.016× |
| same-caller-namespace-rerun | 0.37266–0.409486 | 0.39852–0.452683 | 1.197× |
| prepared-container-repeat | 0.0404346–0.0433496 | 0.0417029–0.0448862 | 1.010× |
| control-cached-scalar-repeat | 4.05 e-06–5.0584 e-06 | 1.27041 e-05–1.87958 e-05 | 3.081× |
| failed-statement-continuation | 0.231794–0.251966 | 0.253424–0.279936 | 1.095× |
| check-only | 0.144121–0.158178 | 0.162311–0.179821 | 1.089× |
| type-protocol-heavy-check | 1.01893–1.09806 | 1.09789–1.18971 | 1.059× |
| whole-source-edit | 0.356129–0.388383 | 0.413213–0.450257 | 1.126× |

Startup/setup kept separate:

| Setup | Baseline ms | Candidate ms |
| --- | ---: | ---: |
| importMs | 83.8135–93.6757 | 85.7863–90.7542 |
| firstEngineMs | 22.4935–24.9564 | 22.5701–23.518 |
| coldFullRunMs | 16.337–18.2931 | 18.259–21.6266 |
### off

Accepted baseline/candidate processes: 3/5.

| Case | Baseline ms | Candidate ms | Candidate/baseline |
| --- | ---: | ---: | ---: |
| control-parse-scalar | 0.000832666–0.00158683 | 0.00173558–0.00202933 | 2.064× |
| parse-only | 0.00681584–0.0104279 | 0.0066525–0.00692292 | 0.978× |
| box-only-current-parser-container | 0.0614975–0.0748158 | 0.106921–0.118305 | 1.769× |
| parse-and-box | 0.0651242–0.0680254 | 0.10528–0.114768 | 1.620× |
| engine-construction | 1.47964–1.6139 | 1.3903–1.59931 | 0.937× |
| full-first-run | 0.472025–0.49001 | 0.472718–0.519986 | 1.025× |
| same-caller-namespace-rerun | 0.370886–0.413759 | 0.399702–0.487636 | 1.119× |
| prepared-container-repeat | 0.0409279–0.0461613 | 0.04099–0.0423883 | 0.959× |
| control-cached-scalar-repeat | 3.0792 e-06–4.9042 e-06 | 1.31084 e-05–1.4725 e-05 | 3.010× |
| failed-statement-continuation | 0.232726–0.250433 | 0.247113–0.262326 | 1.067× |
| check-only | 0.149545–0.153774 | 0.164266–0.173651 | 1.103× |
| type-protocol-heavy-check | 1.0343–1.0386 | 1.06676–1.08574 | 1.047× |
| whole-source-edit | 0.360357–0.379329 | 0.394392–0.415915 | 1.130× |

Startup/setup kept separate:

| Setup | Baseline ms | Candidate ms |
| --- | ---: | ---: |
| importMs | 84.0618–84.7697 | 84.172–96.3849 |
| firstEngineMs | 22.7032–23.1974 | 22.2445–24.9454 |
| coldFullRunMs | 16.4938–16.6648 | 17.5301–18.726 |

## Full Tycho showcases and notebook reruns

All 15 full showcase hashes agree in each mode. Full deterministic values are asserted within each process and compared across arms; full hash sets are in the raw summary. Normal Barnsley/Koch baseline timing gaps from initial baseline work are now filled, as are their off-mode controls. Initial accepted normal notebook rerun/edit increases are real host-evaluator costs, not graph/UI timing.

### normal

| Case | Accepted processes B/C | Baseline ms | Candidate ms | Ratio | Full-value hash |
| --- | ---: | ---: | ---: | ---: | --- |
| traffic-jam | 4/2 | 61.0469–64.9307 | 61.9878–63.1804 | 0.995× | match |
| othello | 4/2 | 21.8669–33.369 | 22.2592–22.8107 | 0.943× | match |
| heat-spread | 3/2 | 23.0027–24.0137 | 22.9886–24.4554 | 1.008× | match |
| burning-ship | 3/2 | 5.07079–6.24508 | 5.10879–5.25317 | 0.935× | match |
| multibrot | 3/3 | 5.41658–5.69283 | 5.80554–5.96621 | 1.037× | match |
| buddhabrot | 3/3 | 458.033–485.971 | 452.807–460.18 | 0.998× | match |
| julia-set | 3/3 | 14.3914–17.2458 | 16.0618–17.4814 | 1.136× | match |
| game-of-life | 3/3 | 24.9102–25.9814 | 25.7296–28.568 | 1.024× | match |
| apollonian-gasket | 3/3 | 120.713–120.951 | 120.664–139.156 | 1.006× | match |
| barnsley-fern | 3/3 | 33.81–35.8498 | 37.3545–39.1085 | 1.095× | match |
| koch-snowflake | 3/3 | 30.2281–31.863 | 29.6379–35.4002 | 1.020× | match |
| turing-patterns | 2/3 | 1532.52–1544.6 | 1525.64–1541.97 | 0.992× | match |
| galton-board | 2/4 | 67.312–69.8878 | 66.6331–83.0987 | 0.992× | match |
| fish-swarm | 2/4 | 41.9652–44.5818 | 41.278–42.5872 | 0.978× | match |
| black-hole | 2/4 | 7.72163–8.23142 | 8.39875–10.929 | 1.090× | match |
| notebook-direct-execution-and-publication:rerun | 2/4 | 0.206938–0.211977 | 0.258442–0.27476 | 1.262× | rerun 4/edit 5 control |
| notebook-direct-execution-and-publication:whole-source-edit | 2/4 | 0.18911–0.231117 | 0.249102–0.263275 | 1.217× | rerun 4/edit 5 control |
| prelude-edit-a | 2/4 | 1.59275–1.74396 | 1.51421–1.74933 | 0.981× | match |
| prelude-edit-b | 2/4 | 1.47433–1.50079 | 1.455–1.59113 | 1.013× | match |
### off

| Case | Accepted processes B/C | Baseline ms | Candidate ms | Ratio | Full-value hash |
| --- | ---: | ---: | ---: | ---: | --- |
| traffic-jam | 2/3 | 63.0915–65.5275 | 61.8924–63.2827 | 0.966× | match |
| othello | 2/3 | 22.7072–25.1035 | 21.6716–24.8667 | 0.913× | match |
| heat-spread | 1/2 | 23.2184–23.2184 | 22.5429–23.3162 | unavailable | match |
| burning-ship | 1/2 | 5.62929–5.62929 | 4.95062–5.87446 | unavailable | match |
| multibrot | 3/3 | 5.51604–5.93279 | 5.37296–6.31583 | 0.943× | match |
| buddhabrot | 3/3 | 459.495–492.504 | 463.692–486.367 | 0.958× | match |
| julia-set | 2/3 | 14.9941–15.2029 | 15.9661–16.7597 | 1.083× | match |
| game-of-life | 2/3 | 25.8297–27.3338 | 25.4466–27.0294 | 1.005× | match |
| apollonian-gasket | 5/3 | 121.514–153.425 | 120.241–130.775 | 0.992× | match |
| barnsley-fern | 6/3 | 35.4584–42.0876 | 36.1599–37.7323 | 0.997× | match |
| koch-snowflake | 5/4 | 29.0818–33.0813 | 30.0555–32.9555 | 1.017× | match |
| turing-patterns | 4/2 | 1532–1563.76 | 1530.85–1575.23 | 0.997× | match |
| galton-board | 3/5 | 66.2919–72.4652 | 70.4727–90.0324 | 1.006× | match |
| fish-swarm | 3/4 | 40.2854–44.7586 | 43.1788–47.3481 | 1.028× | match |
| black-hole | 2/5 | 7.92183–9.20692 | 8.99704–10.1458 | 1.078× | match |
| notebook-direct-execution-and-publication:rerun | 2/5 | 0.198921–0.233162 | 0.266227–0.303271 | 1.332× | rerun 4/edit 5 control |
| notebook-direct-execution-and-publication:whole-source-edit | 2/5 | 0.189975–0.22344 | 0.265746–0.306962 | 1.346× | rerun 4/edit 5 control |
| prelude-edit-a | 2/5 | 1.56492–1.82558 | 1.56267–2.02696 | 0.980× | match |
| prelude-edit-b | 3/5 | 1.31058–1.66942 | 1.39475–1.94308 | 1.144× | match |

Per-case acceptance rejects any sample whose recorded wall interval overlaps a bad monitor interval, padded 100 ms on each side, exactly as the established baseline method. A process median uses only accepted samples; raw records retain how many of the 3(or 7 notebook) samples contribute. No missing case or rejected process is represented as a passing envelope.

## Calibrated heap and sampled allocation

These are separate diagnostic processes with explicit GC and 32 KiB inspector allocation sampling, including collected objects. Each arm/mode/control has 3 correct processes: drop, retain 400 real closures, allocate 400 arrays×4096 elements. Live retention measures 400 pairs of the same two programs after 100 warmup pairs; allocation is sampled in a separate additional 400 pair loop (800 execute calls), not mixed into elapsed-time timing. Retained closure application must equal 5. Three GCs per checkpoint; release engine, then held values separately. Inspector is disconnected before final live readings. Ordinary elapsed-time ratios are not inferred from these diagnostic processes.

Byte ranges below include all correct/calibrated processes and retain their CPU flags; unrelated external CPU does not turn byte counts into duration timing acceptance. The allocating array control must clearly distinguish deliberate retention/release from dropped-program behavior. Exact checkpoints and flags remain in raw records. MiB values are median(range).

| Mode/control | Valid processes B/C | CPU timing-accepted B/C | Allocation MiB B→C | Held minus baseline MiB B→C | Released after dropping held values MiB B→C | Post-drop minus baseline MiB B→C |
| --- | ---: | ---: | --- | --- | --- | --- |
| normal/drop | 3/3 | 0/0 | 231.095 (225.825–233.010) → 271.302 (269.753–277.062) | 1.522 (1.503–2.214) → 2.083 (2.072–2.121) | -0.001 (-0.001–-0.001) → -0.001 (-0.001–-0.001) | 1.523 (1.504–2.215) → 2.084 (2.073–2.122) |
| normal/retain-closures | 3/3 | 0/1 | 226.905 (226.750–228.074) → 267.654 (266.122–268.094) | 8.515 (8.511–8.517) → 8.986 (8.949–8.986) | 6.674 (6.674–6.674) → 6.585 (6.585–6.585) | 1.841 (1.837–1.844) → 2.400 (2.363–2.400) |
| normal/allocating-control | 3/3 | 3/3 | 228.175 (227.074–231.527) → 274.888 (271.997–277.060) | 14.043 (14.042–14.047) → 14.604 (14.601–14.644) | 12.522 (12.522–12.522) → 12.522 (12.522–12.522) | 1.521 (1.520–1.525) → 2.082 (2.079–2.122) |
| off/drop | 3/3 | 0/0 | 230.151 (228.235–232.160) → 274.146 (267.318–274.296) | 2.205 (1.521–2.220) → 2.118 (2.118–2.120) | -0.001 (-0.001–-0.001) → -0.001 (-0.001–-0.001) | 2.206 (1.522–2.220) → 2.118 (2.118–2.121) |
| off/retain-closures | 3/3 | 0/0 | 226.652 (225.042–229.489) → 273.748 (266.437–274.969) | 8.503 (8.452–8.507) → 8.987 (8.941–8.988) | 6.674 (6.674–6.674) → 6.585 (6.585–6.585) | 1.829 (1.778–1.833) → 2.402 (2.355–2.402) |
| off/allocating-control | 3/3 | 0/0 | 227.114 (225.997–228.323) → 272.514 (269.175–274.917) | 14.106 (14.038–14.731) → 14.597 (14.596–14.645) | 12.522 (12.522–12.522) → 12.522 (12.522–12.522) | 1.584 (1.516–2.209) → 2.075 (2.074–2.123) |

Remaining post-drop bytes can include warmed code/module/metadata caches. This bounded test does not prove an unbounded leak or identify retainer graphs. Sampled allocation is an estimator, not exact allocated bytes. No full heap snapshot/corpus/browser-memory claim follows from these controls.

## Contention, rejected windows and corrected instrument assumption

85 process-duration windows were rejected under the unchanged policy: any external known worker above 80%core per sampling interval or load 1>18; fixed browser activity is separately recorded. Owned child/kernel workers are excluded transitively. Complete rejected intervals and CPU/load are in the summary and per-process monitors. Accepted runs are not called globally uncontended.

Exact richer rejected-window argv identified external `/private/tmp/wt-ce-interval-land7` one-file Jest work, native `typecheck-after-edit.sh` TypeScript checks and an LSP server. These were not owned descendants. No peer was killed, no lock bypassed and no threshold relaxed. Only already-rejected intervals gained richer argv diagnostics; accepted-window measurement code/thresholds and all timed adapters stayed unchanged. The bounded final off retry stops with any remaining gaps listed above; heap controls run independently, so missing off timing does not suppress byte evidence.

An added M5 semantic preflight initially asserted baseline `const x=0;x/x` wasNaN. The exact frozen baseline instead gives 1; that instrument assumption was corrected using its recorded witness, before any timing had run. Failed preflight artifacts are preserved under attempt 1; this was not a candidate production failure. The original CE/Tycho/heap correctness controls were unchanged. The same verified build was reused.

## Explicit runtime-consumer witnesses

[Raw baseline/candidate witnesses](final-matched-runtime-witnesses.json) record exact sources, values, types and diagnostics. Shared Limit sum changes 1→3; shared Limit length changes an unevaluated limit→2. Program `const x=0;x/x` changes 1→NaN; Program `let x=0;x/x` staysNaN, and alias variants are recorded individually. Library Pi/Pi stays 1; earlier-const default stays 6. Host-created constant-zero division still gives 1 in both and is separately tracked by the coordinator as CE1361; this delivery makes no numeric-context change.

## Source accounting and limits

Final production raw AST code +1135/−1724, raw physical +1308/−3372; after exact unchanged relocation neutralization, charged +1056/−1622, net -566. Every unit is an integer physical code line; moved formatting earns no deletion credit. See [five-owner attribution](deletion-ledger-attribution-final.md), [raw ledger](deletion-ledger-final.md), [relocation proofs](deletion-relocation-map-final.json) and [separate support costs](final-support-inventory.md). Tests/editor fixtures/docs/instruments/raw data are separate, with zero production credit. Untracked new flow/program/editor fixtures are included.

Source validation/reviews are owned by the coordinator; this agent ran no final Jest/core/full suite. This report certifies its matched measurements, not overall semantic/release readiness. Baseline REPORT.md, provisional costs, rejected windows and frozen source/builds remain preserved. Further production optimization was not authorized; the measured costs are handed to coordinator review.
