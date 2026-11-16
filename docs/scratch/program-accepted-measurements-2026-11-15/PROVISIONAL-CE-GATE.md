# Provisional matched CE gate — superseded candidate

This is **not final performance acceptance**. The coordinator identified a required Program source-order serialization fix after this candidate was frozen; no further timing or build ran after the short gate. Normal-mode costs below are observed provisional evidence and remain relevant to the final comparison. JIT-off has insufficient accepted processes and no ratio is reported.

The baseline source anchor is `ffff1d44fc566ef01fb52a0ce67b6797797f4dcf`. Candidate CE source is the final worktree snapshot taken before that serialization fix; Tycho is the original frozen source plus exactly the three inspected Program-container consumer patches. Baseline/candidate adapters, build scripts/configuration and installed dependency versions/hashes matched. Frozen source, bundles, adapters and dependency hashes remained byte-identical through the gate. Worktree markdown `epsil/docs/{types,examples}.md` changed; production source did not. The first end recorder exited1 on that markdown comparison; a follow-up read-only identity capture certifies the frozen arms unchanged. All raw logs and that failure are retained.

- baseline CE src path/hash-map SHA256: `6ca75206b27820c4149bf81697cc218e6dcd506708fdee7f14d888a02e754874`.
- candidate CE src path/hash-map SHA256: `d21635eaa689ac3961b9f14b7738d2194f3d94aff65ea303a04f31c0966d2411`.

Exact command: `python3 /private/tmp/program-matched-perf-20261115/build-ce-gate.py`, under own lock `codex-program-accepted:matched-performance` (lock acquire0, release0). Build command `BUILD=production timeout -k 30 600 node scripts/build.mjs` in candidate/ce exited0 in0.442s. Timing command per process: `CE_ROOT=ARM/ce python3 monitor.py NAME timeout -k 5 120 node ARM/ce-time.mjs OUT.json auto|off`. Normal order baseline/candidate/candidate/baseline; off order candidate/baseline/baseline/candidate. All eight child processes exited0 and passed controls (full10, failed continuation5, zero type/protocol diagnostics, prepared10). Gate driver exited0; chain exited1 only for the identity recorder described above.

Node26.13.0, V814.6.202.34-node.40, arm64, precision21, no V8 timing flags or NODE_OPTIONS. `off` means CE `ce.jit="off"`, not V8 JIT disablement. Production minified ESM bundle. Existing byte-identical adapter uses100 warmups then7samples×100iterations, except scalar parse1000, cached scalar10000, engine construction20iterations/20warmups and type/protocol check30iterations. Startup/import/first-engine/cold-full are separate raw fields. Assertions are outside timing; no GC/profiler is enabled.

Normal: two accepted processes in each arm. The table shows the range of process medians in milliseconds; ratios divide the medians of those process medians. These are bounded observations, not final no-regression judgments. Several routes have broad within-process samples (retained in raw JSON), so final source must be measured and its repeatability assessed.

| Case | Baseline ms | Candidate ms | Candidate/baseline |
| --- | ---: | ---: | ---: |
| control-parse-scalar | 0.000872792–0.000895833 | 0.00181675–0.00193546 | 2.122× |
| parse-only | 0.010425–0.0106838 | 0.00676–0.00705916 | 0.655× |
| box-only-current-parser-container | 0.0683783–0.0730288 | 0.107145–0.116972 | 1.585× |
| parse-and-box | 0.0673667–0.0683058 | 0.108686–0.110598 | 1.616× |
| engine-construction | 1.44477–1.62801 | 1.46246–1.50846 | 0.967× |
| full-first-run | 0.46922–0.471803 | 0.45739–0.513139 | 1.031× |
| same-caller-namespace-rerun | 0.367131–0.378068 | 0.394459–0.428412 | 1.104× |
| prepared-container-repeat | 0.0419229–0.0439183 | 0.0414675–0.0432275 | 0.987× |
| control-cached-scalar-repeat | 4.35e-06–4.5417e-06 | 1.27916e-05–1.42292e-05 | 3.039× |
| failed-statement-continuation | 0.233843–0.235399 | 0.249363–0.261735 | 1.089× |
| check-only | 0.148053–0.148624 | 0.16898–0.170295 | 1.144× |
| type-protocol-heavy-check | 1.04042–1.0621 | 1.09362–1.20803 | 1.095× |
| whole-source-edit | 0.363479–0.367337 | 0.385732–0.430247 | 1.117× |

Off: baseline1accepted/2, candidate0accepted/2. Rejections retain exact process intervals: external TypeScript compiler223.8%core; Tycho esbuild104.46%core; external Node174.71%core. Overall load was below18; the same predeclared external-worker threshold80%core rejected these windows. No off ratio, no retry, and no relaxed acceptance. Browser background is recorded separately and was not called uncontended.

Acquire load is retained in lock log; release load recorded in provisional-gate-release-final-gate.log (see exact release log). No lock/queue remains. [Raw summary](provisional-gate-ce-gate-summary.json), [certification](provisional-gate-ce-gate-certification.json), `provisional-gate-ce-*.{json,monitor.json,log}` and compressed full identity manifests preserve commands, direct exits, CPU/load, source/build/dependency hashes, all7samples and rejected windows. Original baseline REPORT.md remains untouched.
