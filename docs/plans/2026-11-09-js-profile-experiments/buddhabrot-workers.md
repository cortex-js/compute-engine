# Buddhabrot actual-worker experiment

## Result

The actual compiled showcase step produced identical 90,001-entry results on the calling thread, a dedicated worker, and 2/4-worker pools. All 36 measured runs passed exact equality; the serial oracle also matched the existing independent JavaScript reference for 100,000 and 1,200,000 samples. A four-worker pool completed 1.2 million samples in a warm median of 70.55 ms with 100,000-sample chunks, versus 251.70 ms on the calling thread (about 3.57× in this single Node experiment).

The result supports parallel private-histogram reduction as a useful numeric-kernel workload. It is not a browser performance claim, a measurement of CE's own pool, or an implemented change to Tycho.

## Runtime choice and scope

The instrument compiles the unchanged ordinary-`for` Epsil `step` from the pinned Tycho showcase once through Tycho's `resolveCECompile`. It removes only the expensive `H_1` initializer during setup. The public `createJavaScriptRuntime().load(stored)` API loads that exact compiled artifact inside each real Node `worker_threads` worker, preserving its public stored fields, runtime version, input plan, and preambles. It does not hand-translate the numerical kernel or recompile it in workers.

Installed CE is 0.184.0. Its public pool exposes broadcast and fit facilities; its shipped compilation types do not expose `runAsync`. Current CE source does have CE-1163 `runAsync` and a smaller Buddhabrot `parallel for` witness. This experiment therefore uses a disposable scheduler around the public runtime loader to run original array-valued chunk jobs. It does not establish a missing capability in current CE or recommend adding a separate production scheduler. A follow-up comparison should express the reduction through current CE `parallel for`/`runAsync` and reuse its runtime controls.

Workers receive `(jobId, chunkId, start, count)`, build a private zero histogram, set its cursor to `start`, execute the step, convert its output to Float64Array, and transfer the buffer to the coordinator. The coordinator merges only bins, adds the nonzero initial histogram once, and commits the final cursor once. No shared mutable histogram or random stream exists.

## Environment and reproducibility

- Tycho checkout: `8777c57e37e0e7962b7cdca8093f986c7e5cec6c` at `/tmp/wt-tycho-profile-next`.
- CE package/runtime: 0.184.0; Node v26.13.0; Apple M5 Max, 18 logical CPUs.
- Box lock: parent `codex-js-profile-next`; one-minute load 5.30 at start, 5.60 at end. No other benchmark was assigned concurrently by this session. These are exploratory three-repetition measurements on a shared machine, not a universal speed guarantee.
- Numeric mode: JS machine numbers, no compiled iteration counter, matching the prelude worker's execution form. The cancellation control uses external worker termination.
- Original prelude SHA-256: `122c4b10d0a1eec9fe01e312d59db81e88d37c3f934ad249a77565b3c721c90a`.
- Stored artifact SHA-256 (all loader fields): `63f75ca07e9d8d1d8541f6dcfbc972f0b2a14d7093cf186ff2e19d0fe21859ce`.
- Initial cursor 137; three nonzero histogram bins sum to 23. Empty chunks are not scheduled because raw Epsil `1..0` descends.
- Each measured configuration runs three times. Serial setup/oracles and a 10,000-sample warmup precede measurements. Worker pools load once, perform a first job then a 10,000-sample warmup per worker. Pools are terminated before the next pool size is created. Configuration order is fixed, not randomized.

Copy `profile-workers.mts`, `profile-workers-kernel.mts`, and `profile-workers-entry.mjs` together into `scripts/repros/` of the pinned Tycho checkout. Its installed CE package must be 0.184.0. No browser build is needed. The measured run used the pre-review script versions archived as
`evidence/profile-workers-before-review.mts` and
`evidence/profile-workers-entry-before-review.mjs` (under their original filenames).
Its command was:

```sh
node ~/.claude/scripts/box-lock.mjs check codex-js-profile-next && OUTPUT=/tmp/js-profile-next/buddhabrot-workers.json timeout -k 10 180 node --import tsx scripts/repros/profile-workers.mts > /tmp/js-profile-next/buddhabrot-workers.log 2>&1
```

Exit **0**. Raw JSON and log accompany this report. The prior `QUICK=1` control also exited 0; it ran during another session's validation, so none of its timing values is used here. `node --check` passed for the .mjs worker, and esbuild syntax transformation passed for the .mts instruments. No production source changed and no broad suite/build ran.

## Warm timings

Wall time includes worker dispatch, worker array preparation, kernel computation, output packing/transfer, coordinator handling and histogram merge, but excludes pool startup. Calling-thread time includes initial histogram allocation and execution, with no worker transport or reduction. Results are checked outside the timed interval.

| Route | Workers | Samples | Samples per chunk | Wall range ms, 3 reps | Median ms |
| --- | --- | --- | --- | --- | --- |
| calling-thread | 0 | 100,000 | 100,000 | 20.67–21.29 | 21.27 |
| calling-thread | 0 | 1,200,000 | 1,200,000 | 238.40–253.63 | 251.70 |
| dedicated-worker | 1 | 100,000 | 100,000 | 20.21–22.77 | 20.49 |
| dedicated-worker | 1 | 1,200,000 | 1,200,000 | 258.31–264.99 | 264.82 |
| worker-pool | 2 | 100,000 | 25,000 | 11.47–14.02 | 11.89 |
| worker-pool | 2 | 100,000 | 100,000 | 21.26–23.31 | 22.52 |
| worker-pool | 2 | 1,200,000 | 25,000 | 137.92–140.93 | 140.42 |
| worker-pool | 2 | 1,200,000 | 100,000 | 131.46–136.19 | 133.85 |
| worker-pool | 4 | 100,000 | 25,000 | 6.10–8.98 | 6.22 |
| worker-pool | 4 | 100,000 | 100,000 | 21.36–22.83 | 22.55 |
| worker-pool | 4 | 1,200,000 | 25,000 | 69.64–77.59 | 70.88 |
| worker-pool | 4 | 1,200,000 | 100,000 | 68.86–73.15 | 70.55 |

The 100,000-sample workload with a 100,000-sample chunk has only one task. Adding workers does not parallelize it, and its roughly 22.5 ms results provide a useful scheduling control. Four 25,000-sample tasks reduce its median to 6.22 ms. At 1.2 million samples both chunk sizes supply enough tasks; 100,000-sample chunks transfer 12 histograms, whereas 25,000-sample chunks transfer 48, so the smaller chunks incur more traffic without an observed benefit on this sample sequence.

## First-use costs

Compilation/setup on the calling thread took 223.56 ms; measured once and excluded from the warm runs. First pool readiness was 15.76 ms for one worker, 14.73 ms for two, and 16.02 ms for four (one observation each). Readiness includes Node worker creation, runtime import and code loading; the measured `runtime.load` portion in each worker was about 0.35–0.40 ms. It excludes re-parsing/compiling the source, since only stored code crosses the boundary.

First 100,000-sample job after startup took 26.86 ms with one worker, 14.60 ms with two, and 13.29 ms with four. The first jobs were partitioned once per worker and are cold-JIT observations, not warm medians. Approximate observed ready-plus-first-job costs were 42.62, 29.33, and 29.31 ms respectively; compilation is additional. Browser worker startup and a bundled production runtime may differ.

## Phase observations and transport

| Workers | Samples | Chunk | Sum worker compute ms | Sum prepare ms | Sum pack ms | Sum roundtrip ms | Coordinator merge ms | Result payload bytes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 100,000 | 100,000 | 20.10 | 0.079 | 0.061 | 20.33 | 0.152 | 720,008 |
| 1 | 1,200,000 | 1,200,000 | 264.34 | 0.088 | 0.075 | 264.63 | 0.166 | 720,008 |
| 2 | 100,000 | 25,000 | 21.81 | 0.278 | 0.282 | 22.78 | 0.204 | 2,880,032 |
| 2 | 100,000 | 100,000 | 22.16 | 0.038 | 0.051 | 22.40 | 0.058 | 720,008 |
| 2 | 1,200,000 | 25,000 | 270.56 | 1.768 | 2.331 | 276.69 | 1.688 | 34,560,384 |
| 2 | 1,200,000 | 100,000 | 262.32 | 0.834 | 0.477 | 264.84 | 0.494 | 8,640,096 |
| 4 | 100,000 | 25,000 | 23.00 | 0.422 | 0.151 | 23.80 | 0.295 | 2,880,032 |
| 4 | 100,000 | 100,000 | 22.15 | 0.097 | 0.046 | 22.40 | 0.124 | 720,008 |
| 4 | 1,200,000 | 25,000 | 269.69 | 2.312 | 2.120 | 277.27 | 1.980 | 34,560,384 |
| 4 | 1,200,000 | 100,000 | 267.41 | 1.044 | 0.923 | 269.61 | 0.525 | 8,640,096 |

Values are medians of per-job phase sums. Worker phases overlap across workers. Roundtrip includes worker phases, transport, scheduling, and coordinator availability; it is not an independently measured transfer time and cannot be added to or subtracted from job wall time as a disjoint stage. The JSON also records synchronous `postMessage` call time, which measures enqueue cost, not transfer latency. This scheduler keeps at most one task in flight per worker; pending work remains in the coordinator, so it does not measure a separate worker queue wait.

Each chunk returns 720,008 bytes of numeric payload. Twelve chunks transfer 8,640,096 bytes; 48 transfer 34,560,384 bytes. These are cumulative payloads, not peak heap consumption. Private JS arrays, packed buffers, the coordinator accumulator and runtime structures add memory beyond payload size; this experiment does not measure that heap total.

## Correctness and lifecycle controls

- The independent test reference matches the compiled serial result at 1,000, 100,000 and 1,200,000 samples. All measured worker results match every count and the final cursor exactly.
- A real first-chunk response is accepted once; replaying it is rejected, leaves the duplicate count at one, and does not publish an incomplete result. The second distinct chunk completes the exact 101-sample result.
- A submitted old job is superseded; an intentionally delayed real worker response is rejected by both the inactive old job and the replacement's ID guard. Replacement output matches the serial 103-sample result. No old partial is published. The 50 ms reply delay makes this race deterministic; it is not a claim about natural scheduler order.
- Cancellation occurs after the worker acknowledges receipt of a finite 20-million-sample task, before preparation; this does not prove entry into generated code. The coordinator terminates the worker and no partial result is published. The original timed run observed 0.41 ms to exit, but its rejection classifier was too broad; that timing is not evidence of validated cancellation and is not a cancellation SLA.
- Nine worker exit events were observed across the performance pools and controls; the owned-worker set was empty at completion. A `finally` block terminates any remaining owned workers on assertion/error.

The coordinator publishes only after all planned unique chunks arrive. Stable job IDs prevent cross-generation publication; chunk IDs prevent double counting. Current retries were already validated by the prior partition experiment, but this new scheduler does not implement automatic retries. Production use needs an explicit policy for transient worker failure and replay of accepted chunks.

## Implications for profiles and next integration

The numerical work fits a numeric-kernel profile despite function calls, bounded loops, early exits, simultaneous tuple assignment, local mutation and a 90,001-element result. Worker portability was demonstrated with the actual public runtime loader. Independent evaluation applies to private chunk state, not shared writes into the same histogram.

Separate requirements are justified: deterministic partitioning, array-valued reduction, worker portability, nonblocking execution, and atomic publication on cancellation/supersession. The caller supplies a fixed input snapshot for the job; a new document state creates a new job generation. No CPS representation was needed to express or execute this experiment.

Before Tycho integration, run the equivalent full-size algorithm through current CE's public parallel-loop route and then browser workers. The browser study must include host CSP, runtime-worker version matching, prelude-worker nesting or parent-owned job routing, supersession during navigation/editing, child-worker cleanup, and the policy for fallback when no pool can run. None of those browser/nested-worker properties is established here.

## Review correction

Independent review found that any worker rejection, including a crash, could
satisfy the original cancellation assertion. The retained instrument now
distinguishes coordinator-requested termination from unexpected worker errors.
An actual injected worker exception is a negative control. The controls-only
rerun exited 0 with all lifecycle checks passing, three exits and zero live
workers; see `evidence/worker-review-controls.json`. Timing loops were not rerun
and their numerical path was unchanged. The raw original timing file retains
its original cancellation metadata for provenance; the corrected control file
supersedes that control. The before/after delta is retained separately.

Replay the focused correction with `CONTROLS_ONLY=1 OUTPUT=/tmp/worker-controls.json
timeout -k 10 90 node --import tsx scripts/repros/profile-workers.mts` from the
pinned Tycho worktree after copying all three retained worker scripts.
