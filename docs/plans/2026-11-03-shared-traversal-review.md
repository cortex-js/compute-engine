# Shared-expression traversal review, November 3, 2026

The small production change caches a parent's declined body-type derivation in
its existing environment-local memo. It preserves the decline and the existing
binding invalidations. No common traversal framework or persistent cache was
added. The new deterministic checks count actual operand-array reads, abort a
regressed traversal, and supplement the existing sharing, value and code-size
checks. Timing ceilings now run only under `CE_PERF=1`; the scalar-facts retry
helper is removed.

## Scope and history

Reviewed from `0904d0592` through v0.178.0 (`ca6304756`) and starting HEAD
`1359a1279`. These two final revisions have identical `src/` contents. The later
`836653035` commit records another session's scalar benchmarks and does not
change production source. Its files and that session's pending compiler edits
are outside this patch.

| Commit | Relevant change |
| --- | --- |
| `0904d0592`, October 28 | Distinct-node name/callee walks and recursion checks for function-literal typing and assignment. |
| `304838545`, October 28 | Rebox valid function literals through a shared raw copy, preserving source offsets, rather than serializing every MathJSON path. Canonical reads remain scope-sensitive. |
| `28f74e381`, October 30 | Shared evaluation is memoized only for eligible pure work; host code must state purity. Effects and changes of state invalidate reuse. |
| `3431204f2`, October 30 | CSE replays conditional-arm walks with weighted paths, preserving regions instead of expanding the DAG. |
| `db796d62e`, October 31 | Static binding view and type versions avoid invalidating body types on each function activation. |
| `1a95a7f6d`, October 31 | Loop-invariant discovery, attachment and assignment scans gain visited sets/memos. Binder detection remains a separate, small query. |
| `d78161db6`, November 1 | Substitution memoizes by node and substitution context; raw binder bounds read outer bindings. Widening invalidates type caches promptly. This is the historical measurement checkpoint. |
| `5d363c394`, November 1 | Shared pure operands of tuple/list literals use shared evaluation. |
| `c924b07cc`, November 1 | The scalar-facts timing check retries up to three times, keeping the fastest compilation below one second. |
| `99e4e420f`, November 1 | CSE copies retain the lexical-callee stamp of handler-lowered nodes. |
| `609d496ee`, `39ef2aec0`, November 3 | Static complex lanes, visible-callable compilation and constant parameter defaults constrain subsequent analysis. Those contracts remain intact. |

The compiler split (`5404acb3f`) moved the relevant folding and emission code
out of `base-compiler.ts`. Current locations include `compile-folding.ts`,
`compile-folded-values.ts`, `compile-cse.ts`, `cse.ts` and
`javascript-value-facts.ts`. Historical comments that still described fixed
folding walks or broken recursive reboxing were removed from nearby tests.

## Memo boundaries

“Once per node” means once per compatible analysis context, not once globally.
An adjacency list with more references still costs more to read. Distinct nodes,
operand edges, contexts and emitted output all matter.

| Work | Lifetime and context in current code | Review result |
| --- | --- | --- |
| Substitution | Outermost synchronous call, cleared in `finally`; node, substitution-object identity, requested form and entry lexical scope. A binder removes shadowed keys into a different substitution object. | Preserve these keys. The same node inside/outside a binder can have different replacements. Existing Function, Sum-bound and Block tests compare shared and unshared results. |
| Raw literal copying | One copy operation, node identity; subsequent canonicalization has its own scope-sensitive transient memo. Invalid literals retain their existing serialization route. | Copying structure is context-free; canonicalizing it is not. Do not combine the caches. |
| Callee reachability | Query-local node sets plus visited callee literals, with a fixed searched name. Name search and call-body search are separate passes. | Measured two linear passes. Combining them would need to retain parameter shadowing; no measured need to do so here. |
| Body-type derivation | One literal/argument derivation; expression memo clears on local assignment and binding-environment changes. Outer results are engine/literal/type-keyed under cache generation, with recursion-dependence handling. | A parent of a failed child was not stored. Caching its `undefined` answer removes repeated descent without extending cache lifetime. |
| Scalar/point proof | Fresh walk per question; target, node, query, depth and active-callee context. Local changes reset answers. User-call proofs additionally distinguish argument kinds, assumptions and cycle dependencies. | Keep depth: the proof can decline at its depth limit. Irregular DAGs can therefore require more than one answer per node. These tests establish linear reads for equal-depth towers, not arbitrary context-free linearity. |
| CSE | One harvest/session, region, mapped/statement context and node; replay weights count paths. Binding/effect admission and conditional regions constrain reuse. | Weighted `diagnostics.edges` measures logical paths, not actual visits. New getter counts independently constrain physical traversal. |
| Compilation/folding | Compilation-local state reset at boundaries; scoped/target-specific facts and proof keys where emission depends on bindings or representation. | Retain target and binding distinctions. The symbolic-input compilation test covers end-to-end work and output size; it does not prove every closed constant-folding route is linear. |
| Evaluation | Top-level ownership, frame, exact/numeric request, evaluation version, impure-work stamp, precision, facts visibility, angle unit, seed frame, verification and effect capabilities; store guards reject unsafe results. | No evaluation cache was widened. Effectful nodes still run at each occurrence. The existing shared-evaluation tests cover host purity, writes, options and overlapping asynchronous work. |

No context-key simplification was justified by the measurements. In particular,
node identity alone is insufficient across bindings, targets or evaluation
requests. Memoizing a pure structural query does not authorize memoizing an
arbitrary evaluation.

## Measurements

Raw accepted process observations, excluded-process conditions, summaries and
work-count controls are in
[`shared-traversal-2026-11-03.json`](../../benchmarks/shared-traversal-2026-11-03.json).
Node 26.13.0, Apple M5 Max, 18 cores, source loaded with tsx, machine precision.
The box lock was held. The user paused two CPU-bound Chrome renderers. CPU
activity was sampled every half second; processes with observed competing work
at 60% CPU or more were excluded whole. This conservative filter also discarded
brief editor, git, build and typecheck overlaps. Ordinary desktop activity below
that threshold remained. The lock was acquired at load 7.6/4.8/5.8; accepted
measurements and final reruns occurred as load fell, with per-process load in
the JSON. The lock was released at load 2.6/7.3/6.8. Load averages lag the
activity that produced them.

First calls use seven fresh engines in an already loaded process. Engine and
expression setup and result validation are untimed. Warm measurements follow
five warmups and use seven batches of 25 calls. Comparators run serially in
alternating process order. Entries below are medians of accepted process
medians; raw ranges are retained. The general matrix has two historical, three
release and four candidate processes. The final decline control has three,
two and three; the corrected Map control has three, three and two. These
samples establish a local baseline, not a statistical claim about small drift.

| Workload | First ms, history / release / candidate | Warm ms, history / release / candidate |
| --- | ---: | ---: |
| Substitute depth-24 shared tower | 0.0504 / 0.0488 / 0.0516 | 0.0430 / 0.0412 / 0.0421 |
| Callee search, depth 24 | 0.00690 / 0.00733 / 0.00683 | 0.00359 / 0.00409 / 0.00400 |
| CSE, depth 24 | 0.2565 / 0.2724 / 0.2721 | 0.0372 / 0.0359 / 0.0387 |
| Compile, depth 24, folding off | 0.7974 / 0.7835 / 0.8263 | 0.4351 / 0.4403 / 0.4437 |
| Declined callback body, depth 16 | 2.5168 / 2.4288 / 0.0241 | 0.000947 / 0.000701 / 0.000703 |
| Slider shader compilation | 0.6716 / 0.7026 / 0.7089 | 0.2692 / 0.2862 / 0.2806 |
| Map callback compilation, folding off | 1.0229 / 1.2554 / 0.9735 | 0.3179 / 0.3052 / 0.3089 |

The declined-body improvement is about 100× on the first call. Its warm result
is explicitly a **cached type-result lookup**, not a repeated walk. The other
figures do not establish a broad improvement or gradual regression. The host
controls preserve the numeric Map result and emitted shader operators. The
shader is not executed on a GPU. The initial Map control allowed folding and
was rejected in review; none of its timings is included.

The matrix varies depth 4/8/16/24, independent towers 1/4/16/64 and references
per parent 1/2/4. A timing tower has `depth + 1` distinct functions plus its
symbol; width adds independent towers. It does not allocate a tree per path.
At width 4/16/64, candidate warm substitution is 0.0358/0.1258/0.4865 ms, CSE
0.0500/0.1188/0.4668 ms, and compilation 0.2497/0.6328/2.1392 ms. This is
consistent with distinct-node/output growth. At depth 8, increasing references
from 2 to 4 changes compilation from 0.219 to 0.222 ms, despite increasing
unfolded paths from 256 to 65,536. Tiny single-query timings are noisy; the
work counts provide the stronger evidence about mechanism.

### Deterministic work

The counting fixture uses `depth` Add nodes over one symbol and counts reads
of their operand arrays, not elapsed time or allocations. Compilation counts
below come after the same substitution/search/scalar/CSE sequence in each
checkout; they are not cold-compilation counts.

| Depth | Substitution | Callee search | Scalar proof | CSE | Compile, historical / release |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | 4 | 8 | 12 | 87 | 191 / 184 |
| 8 | 8 | 16 | 24 | 191 | 363 / 348 |
| 12 | 12 | 24 | 36 | 295 | 535 / 512 |
| 24 | 24 | 48 | 72 | 607 | 1051 / 1004 |

Substitution, search, scalar and CSE counts match between the historical and
release checkpoints. Candidate positive-path counts match release. The
callback-parameter decline fixture previously reads 21/265/4109 arrays at
depths 4/8/12 and now reads 10/18/26, retaining `undefined`. A callback parameter
is a plausible higher-order host workload, even though compilation currently
declines function-valued parameters. Its type derivation must still terminate.

Each adopted work-budget check was run against a deliberately regressed
implementation in the private checkout, restoring bytes afterward:

- Disable substitution hits: substitution budget fails.
- Remove the callee call-walk visited guard: search budget fails.
- Disable scalar proof hits: scalar budget fails.
- Remove CSE prepass guard: harvest budget fails.
- Disable CSE replay: harvest budget fails, and full compilation fails its
  success check after its independent operand-read budget aborts the walk.
- Remove the new parent-decline store: callback budget fails.
- Return early before the body derivation: the benchmark's scalar-sibling
  derivation assertion fails. This oracle replaced a root-read assertion that
  other structural readers could satisfy.

A negative control also exposed a limit: disabling the `reachesAbsArg` visited
set did **not** fail the symbolic-input compilation check. That fold route is
not entered by the fixture. No claim of that coverage is made.

### Closed constant folding: measured gap, attribution still a hypothesis

For a separate `Add(e,e)` chain over `2 + sqrt(3)`, compile operand reads at
depths 4/8/16/24 were 300/1500/95752/256978. All compiled values agreed with
`2^depth * (2 + sqrt(3))`. A proposed small linear budget failed on the current
implementation and was not adopted. Existing generous timing/value tests still
cover this shape; the new symbolic budget does not replace them.

The increase may involve bounded constant evaluation, rebuilding or repeated
questions under different folding contexts. These counts alone do not identify
which mechanism dominates or establish unbounded exponential behavior. Profiling
that route and measuring where its evaluation/output budgets saturate warrants
a separate task. Removing context keys or changing fold limits without that
measurement would be unsound or change a documented compilation trade-off.

## What the timing test detects

The old helper retries only after a compilation takes at least one second,
using up to three attempts. A fresh outer graph prevents some node-local hits,
but the base, engine, module caches and JIT are reused. It is therefore neither
a cold-start benchmark nor three independent full setups. Its minimum resists
isolated scheduling/GC stalls, but it also selects the most favorable sample.
A 20 ms route can become 40, 100 or 500 ms and still pass; the threshold does
not test a slope, detect extra passes or track a trend. A synchronous divergent
walk can hang before an assertion is reached; Jest's timeout cannot interrupt
it. Repeating that walk does not solve the hang.

The replacement keeps one generous ceiling in the serial performance suite,
uses bounded getter counts for the selected traversal mechanisms, and retains
numeric/code-size checks. Serial timing comparisons measure smaller changes.
The small count ceilings intentionally constrain specific fixture families;
they are not a proof for all graphs or a replacement for profiling a host corpus.

## Validation and remaining coverage

Typecheck, focused tests, core checks, lint, trap scan and serial CE_PERF checks
passed. Focused run: seven suites, 137 tests. New deterministic file: 22 tests.
Core: 18 suites, 5501 tests and 1374 snapshots, with 15 tests skipped. Serial
CE_PERF: four suites, 38 tests. Full suite: 1819 suites passed (11 skipped), 77827 tests passed (1092 skipped,
2 todo), and 4295 snapshots passed; exit 0.
The checkpoint bypass canary also passed 46 tests. Jest reported a forced
worker shutdown during full-suite teardown; its cause was not established.
After applying to the shared checkout, typecheck and lint passed; the four
changed test files passed 35 tests with identical before/after source and test
fingerprints. An isolated checkout of the nine staged files also passed
typecheck. All four temporary worktrees were removed. The full suite ran on the
isolated source, excluding unrelated
uncommitted compiler changes in the shared checkout.
No snapshot was changed. No public result, syntax or API changed; no external
user guide needs updating.

Both reviewers accepted the production patch in round 1. Benchmark findings
were corrected in two rounds: folding in the Map fixture, explicit warm cache
labels and a non-vacuous decline oracle. Round 2's final low oracle correction
was verified by an early-body-decline mutant; no third review was run.

The review does not establish heap retention, cache effectiveness for every
scope/target combination, arbitrary-depth stack safety, shader execution speed,
or document-open performance for a captured corpus. Existing binding/effect and
cross-target tests remain necessary. Further measured tasks could profile closed
constant folding, run the captured Tycho document harness across releases, and
track serial benchmark trends over time. No traversal framework or broader
cache redesign is justified by these results.

Reproduce the source measurements in isolated checkouts with shared dependencies:

```sh
node --import tsx benchmarks/shared-traversal.mjs /path/to/checkout
MODE=check node --import tsx benchmarks/shared-traversal.mjs /path/to/checkout
npx jest --watchman=false -w 2 -- test/compute-engine/shared-traversal-work.test.ts
```

Hold the box lock and monitor competing CPU work for timing. The JSON records
all accepted per-process summaries and the rejected process conditions. It omits
rejected timing values and the superseded Map/decline fixture observations.
