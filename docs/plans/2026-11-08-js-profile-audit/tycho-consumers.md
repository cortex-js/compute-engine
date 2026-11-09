# Tycho compilation consumers and Buddhabrot concurrency audit

Read-only audit, 2026-11-08. Sources are the live Tycho tree at `/Users/arno/dev/tycho`, observed against parent-reported HEAD `8777c57e37e0e7962b7cdca8093f986c7e5cec6c`. No code, tests, corpus runs, dependency changes, or git mutations performed. Line references below are relative to Tycho. Current behavior is established from executable source; performance numbers in source comments are historical measurements, not measurements from this audit.

## Conclusions

1. A numeric-kernel profile must include functions, bounded loops, local mutation, numeric lists and histogram updates to cover the motivating Buddhabrot computation. Restricting it to scalar expressions would cover the displayed color function but not the expensive work.
2. Current concurrency is mainly independent grid sampling and solver global-search scans. The Buddhabrot computation is offloaded to one dedicated prelude worker, but its value statement still calls compiled `run()` synchronously. Moving work off the UI thread and dividing one calculation across workers are separate requirements.
3. Buddhabrot is a particularly clean deterministic reduction experiment: samples come from absolute indices in a fixed low-discrepancy sequence; it uses no random-number generator. Partition sample indices, accumulate private histograms, reduce them, and update the sample cursor once. Do not run `step(H,n)` independently on each worker and sum the whole returned lists: that duplicates initial counts and mishandles the cursor.
4. Compilation capabilities must include the adapter/runtime contract. A mathematical numeric result can be accepted by CE yet refused by Tycho's carrier, sampling, portability, or unresolved-input gate.

## Consumer matrix

| Consumer and source | Inputs and output | Options and bindings | Execution and fallback | Profile implication |
| --- | --- | --- | --- | --- |
| Compile gateway, `src/plot-core/ce-module-registry.ts:1464` | Typed expression; arbitrary compiled result | Enforces mode only on `javascript`; default finite iteration budget for JS/interval; Infinity removes counter; `byReference`, `hideValues`, `scalarInputs`, `sampler`, `vars`, `functions` affect the effective environment | All sites must check `success`, not merely `run` (`:345`). The adapter constructs scoped declarations and catches compilation failures. | Instrument after the scoped binding transformations, not solely at caller source. Experimental JS target naming must update adapter checks or mode/budget behavior changes. |
| 2-D sampled fields and masks, `src/plot/ce-compile.ts:3595`, `:3622`, `:8787`, `:9439` | Scalar axes and live scalar/list inputs; scalar field or predicate (mask adapted for batch) | Document strict/complex mode; batch body explicitly requested where used; typed input plan distinguishes shared list input from grid axes | Scalar runner, synchronous `broadcast`, optional `broadcastAsync`; missing/unresolved inputs, incompatible list inputs, failed compile, or worker failure follow existing null/false/stub routes. Mask decline can be fail-open (`:3631`). | Numeric kernel plus independent evaluations; worker portability needed only for pooled route. A rejected mask has product semantics, so admission diagnostics cannot erase route distinctions. |
| Parametric/vector/3-D fields, `src/plot/ce-compile.ts:5719`, `:6132`, `:6284`, `:6450`, `:6860` | Scalar parameters or coordinates; points/vectors or scalar field | Explicit parameter types, document mode, live document values. 3-D field asks for batch only after `implicitFieldBatchSafeProperty`. | Vector fields CPU-sampled; parametric decline may produce NaN point/no band; unbound-input detection can retry expansion. 3-D uses worker sampling only when batch-safe. | Numeric kernel includes tuples/points and source function specialization, not scalar-only ABI. |
| Compiled collection/action bodies, `src/plot-core/compiled-body.ts:3803`, `:3925`, `:4538` | Typed scalar/list/point partition; typed computed body | Cached by body/input signature and compile mode (`:3913`); required inputs checked against reported free symbols; strict output projection differs from complex mode | Compile decline recorded with ownership/reason; compiled artifact has run-time policy and persistent failure state. | Inventory cached artifact contract and live data ownership; independent source expressions do not prove wrapper reentrancy. |
| Solver row materialization, `src/graph-paper/graph/solver-solve.ts:1529`, `:1600` | Fresh real symbols for table columns, fixed scalar input snapshot; real-valued sample | Document mode and `hideValues`; mutable per-run bag populated per row | Compile tried when interpretation fails to materialize numbers; only successful numeric results promote future rows to compile route; invalid/missing result returns null | Numeric kernel. Shared wrapper bag is sequential host state; worker jobs need independent bags even if generated function is pure. |
| Solver global search, `src/graph-paper/graph/solver-solve.ts:3619`, `:3987`, `:4101` | Fit/root model, parameter grid, data | `evaluateAsync({signal})`, pool and deadline policies | Only search grid scan moves to pool; planning/local fit and other steps remain synchronous. Abort on stale inputs or document close. | Reach CE internal numeric compilation through evaluator as well as public compile calls. A compile-gateway census alone misses this route. |
| Color/style evaluation, `src/graph-paper/graph/style-expressions.ts:2432`, `:2675`, `:3117` | Numeric cell/coordinate/document inputs and lists; color or scalar count | JS document color mode; GPU proof, GLSL vars, sampler widths, optional colormap helpers; current binding snapshot/cache revisions matter | JS CPU path; separate GLSL admission and adaptation; missing uniform/table dependencies keep CPU route | Numeric profile needs color operations and explicit dependency portability. JS and GPU acceptance cannot be equated. |
| Epsil prelude statements, `src/plot-core/prelude-runner.ts:2177`, `:2380`, `:2440`, `:2550`, `:2605` | Top-level assigned values become typed inputs copied to locals; result tuple of updated and declared names | Read lists passed as typed arguments; may retry without list arguments; strict/default JS, iteration budget; fresh scratch engine per check | Each statement compiles separately; synchronous `run`; rebox result and bind before next statement. Unsupported carrier/exact fraction/compile decline/result mismatch takes interpreter path. | Program orchestration can contain numeric-kernel statements. Program profile alone does not guarantee Tycho can carry every compiled type. |
| Prelude check worker, `src/graph-paper/graph/prelude/prelude-check-body.ts:33`, `prelude-worker-body.ts:20` | Source plus angle/precision/complex settings; serialized checked values/functions | Fresh document-profile engine; worker calls runner with Infinity budget | One queued check at a time, dedicated worker; page deadline terminates worker. In-process fallback retains finite pass budget. | Worker-isolated execution is current; internal parallelism is future. Engine profile here is configuration, distinct from proposed compilation profile. |

Other entry families to include in a complete dynamic census: `derived-function-source.ts:97/:266`, importer numeric helpers (`desmos-import/numeric.ts:233`), visibility gates (`ce-compile.ts:3782`), implicit certification, and deferred GLSL compiles (`resolve-fn.ts:582`, `math-plot-element.ts:9872`). These are source inventory seeds, not claims of runtime hotness.

## Binding and portability details

- `CECompileOptions` documents separate live per-call data, compiled definition snapshots, and host source mappings (`ce-module-registry.ts:404–435`; `docs/COMPUTE_ENGINE.md`, “functions-option trampoline”). Source text through `globalThis` can intentionally provide live host data. It is not automatically available in a worker, even when marked pure.
- `wrapJs2DBatch` builds inputs at batch start, uses `entryPlan.lists` to distinguish shared lists from grid axes, and refuses the worker route if a required list exists only in the engine scope (`ce-compile.ts:9474–9530`). Snapshot lifetime must cover the pending batch.
- The pooled route explicitly wants the main thread free: it uses `willUsePool`, `inline: false`, AbortSignal, deadline and a second timeout; incomplete batches return null (`ce-compile.ts:9551–9624`). This is stronger than “prefer parallel execution”: the route must not unexpectedly perform the whole batch synchronously.
- Current app pool is one lazy shared pool, assigned to document engines, with version-matched CE worker source (`graph/kernel-pool.ts:4–43`, `:69–95`). Prelude-check engines are fresh and the inspected setup does not attach this page pool (`prelude-check-body.ts:33–44`).
- Prelude runner's exported async function currently awaits parser loading then calls synchronous `runPreludeLoaded` (`prelude-runner.ts:1464–1476`); source explicitly records awaiting `runAsync()` as future CE-1163 integration (`:1487`). This audit makes no claim that CE's present capability is absent; it identifies Tycho's current call path.

## Buddhabrot algorithm and decomposition

Authoritative source is `src/graph-paper/onboarding/template-data.js:1228–1304`.

- `H` has 90,001 integer entries: three 150×200 count planes and a sample cursor in element 90,001.
- `step(H,n)` reads cursor `r`; sample `k` uses `p = 3*fract(0.7548776662*(r+k))-2` and `q = 3*fract(0.5698402910*(r+k))-1.5`. It is deterministic with no RNG state.
- Each sample performs cardioid/bulb tests; a first bounded orbit loop (maximum 5,000 iterations) finds escape, with cycle detection and early breaks. A second loop replays the orbit and increments the visited and mirror histogram cells, with additional planes for escape counts ≤500 and ≤50. Tuple assignment updates `(a,b)` simultaneously.
- All communication between samples is histogram addition and the final cursor write. Orbit temporaries are sample-local. Histogram cells collide across samples, so directly sharing mutable output is not independent invocation semantics.
- The current outer form is ordinary `for`, not `parallel for`; update spelling is `L = replaceAt(L,c,L[c]+1)`. A change of spelling or recognition into parallel reduction needs an explicit contract, not just a scheduler flag.

Suggested experimental contract: `accumulate(start,count) -> histogramDelta`, with local histograms and fixed absolute sample ranges. Host or compiler combines initial histogram with all deltas and writes `r + totalCount` once. If reusing `step` to prototype ranges, set each private zero histogram's cursor to its absolute start, discard the returned cursor when reducing, and never copy the initial count planes into each private result. Range coverage must have neither overlap nor gaps.

Use the existing integer-count output as a strong oracle: for sample counts whose sums stay in the exact JS integer range, identical sample indices and arithmetic should produce identical bins regardless of partition/reduction order. This does not establish deterministic floating-point reductions in general. Keep per-orbit arithmetic and branching unchanged, including the tolerance-based cycle test, to make the comparison meaningful.

Memory floor for dense Float64 histograms is 90,000×8 = 720,000 bytes per worker, plus inputs/results, transfers, CE containers, and runtime overhead. Eight worker histograms alone are 5.76 MB. Actual JS array representation must be measured, not inferred from this lower bound. Full histograms amortize transfer over many samples; per-orbit return arrays likely shift cost into allocation and transport. Vary chunk size and worker count, including first-run startup and warm runs; measure uneven orbit cost and reduction separately.

The current entry computes `H_1 = step(H_0,1200000)` once and has no action (`template-data.js:1293`, `:1307`). Historical comments compare one large call against repeated action firings; those are motivation, not fresh evidence. Keep both whole-prelude and continuation-from-nonzero-H cases in the experiment.

Cancellation needs explicit ownership before nested workers are enabled. The existing prelude worker is terminated by the page after 30 seconds; in that worker compiled statements omit the pass counter (`prelude-worker-body.ts:34–40`, `prelude-check.ts:41–45`). A child pool must not outlive cancellation or publish a partial/stale histogram. Choose and test parent-owned pool jobs versus a worker-owned pool with explicit shutdown; do not assume terminating the coordinator proves all worker work stopped. With current atomic prelude replay, either commit all completed bins and the cursor together or discard the job. Progressive display is a separate product contract, not implied by parallel execution.

## Recommended requirement vocabulary

- `independentCalls`: no externally visible inter-call interference under declared input ownership; local mutation permitted.
- `workerPortable`: code, helpers and captures reconstructible in the execution host; includes result transport contract.
- Internal reduction eligibility: identified iteration space, disjoint sample-local state, private accumulators and merge rule. Do not overload it with “has a loop”.
- Nonblocking/off-main-thread execution is a runtime routing requirement distinct from worker portability and speedup.
- Determinism/reproducibility is an optional separately declared requirement; Buddhabrot can test partition invariance without requiring a seeded RNG design.
- Cancellation and partial-result policy belong in the execution contract. A signal supported by the API is not proof that synchronous generated code checks it.

## Representative cases for parent probes

1. Scalar sampled sine/polynomial with live slider input (cheap baseline).
2. 2-D scalar field reading a shared numeric list (batch/worker data ownership).
3. Numeric point-valued parametric function (non-scalar ABI).
4. Host `functions` trampoline marked pure but dependent on main-thread globals (portability negative control).
5. Prelude local numeric accumulator with bounded loop (kernel/program boundary).
6. Full Buddhabrot step with small sample count, empty range, nonzero initial histogram and cursor, uneven chunk partition; compare exact histogram and cursor.
7. Buddhabrot color function reading the 90,001-entry list (read-only numerical/color kernel, separate from construction).
8. Deadline/superseded-prelude cancellation with no partial replay and verified worker cleanup.
9. Solver model evaluated through `evaluateAsync` (compilation not directly initiated at the Tycho gateway).

## Validation and limitations

Used `rg`, `sed`, `cat`, and `shasum` for source inspection; no execution measurements or tests. No defects asserted or issue files created. No repository files changed. All performance, eligibility, and runtime cleanup claims needing execution remain parent-owned validation.

SHA-1 content fingerprints at inspection: `template-data.js` 8467b4bf6f4a8c0dc4f8dde88dc0f54d6981689f; `prelude-runner.ts` 32cf9ab84556ca59bad92828ae5ddaa5f789a0f6; `ce-module-registry.ts` 8d17c8572301f927d45399b848e7139f7135e7c2. The live tree was not frozen; reproduce measurements in a pinned checkout.
