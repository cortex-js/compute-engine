# JavaScript compilation profiles and concurrency audit

**Status:** research results for review, 2026-11-08 local time (execution logs
extend into 2026-11-09 UTC). No production compiler or Tycho behavior changed.
This supplies evidence for the [migration proposal](../2026-11-08-javascript-fragment-migration.md),
not authorization to implement its later stages.

## Findings and recommended decisions

1. **Keep numeric-kernel and program profiles, but do not equate numeric with
   scalar or expression-only.** Real plotting workloads use numeric tuples,
   lists, colors, local bindings, and functions whose bodies contain loops.
   The scalar-only first implementation remains useful as an experiment;
   it is not enough for profile parity.
2. **Keep consumer policies outside profile admission.** Exact Map evaluation,
   numerical integration, solver exclusion proofs, and stored worker kernels
   have different obligations even when they compile the same vocabulary.
   `implicitCompile` is a promising selection boundary, not a replacement
   for these policies.
3. **Treat Buddhabrot as a reduction workload, separate from its rendering
   kernels.** A partition experiment using its actual compiled Epsil function
   gives exact agreement with serial execution. The private histograms merge;
   the sample cursor commits once. Ordinary concurrent calls sharing the
   histogram do not have the necessary independence.
4. **Add nonblocking execution to the execution-contract discussion.** Tycho's
   pooled rendering route sometimes requires the calling thread to remain
   free. Worker portability and a preference for speedup do not express that
   requirement. Cancellation, atomic publication, and input ownership also
   need explicit contracts.
5. **Proceed with structured values and regions, without CPS first.** The
   bounded IR experiment preserves branch effects and loop-carried values and
   rejects deliberately invalid IRs. It supports this architectural direction,
   but does not demonstrate production performance or fragment integration.

## Evidence and isolation

| Study | Baseline | Scope |
| --- | --- | --- |
| CE inventory, compilation measurements, IR experiment | CE source `9c126c5d8b2f3fc93e125985cc90b43398c46c28` | Detached CE worktree, no production edits |
| Live Tycho census and Buddhabrot experiment | Tycho `8777c57e37e0e7962b7cdca8093f986c7e5cec6c`, installed CE `0.184.0` | Separate detached Tycho worktree; temporary instrumentation only |
| Historical artifact inventory | Existing CORE and ALL audit artifacts | Their own revisions/timestamps; not assumed equivalent to the new run |

The source CE and installed CE are distinct baselines. No speedup ratio or
cross-version correctness conclusion is drawn between them. The runtime was
Node `v26.13.0` on Apple M5 Max. The installed CE entry hash and retained file
hashes are in [manifest.json](evidence/manifest.json).

Three agents produced source and artifact inventories. Executable studies ran
under the shared box lock. No dependency versions were changed, and no audit
overwrote Tycho's tracked fixtures or default corpus outputs.

## Consumer inventory

The [CE inventory](ce-inventory.md) identifies `implicitCompile` as the shared
policy seam for Map/Filter, reducers, quadrature, derivatives, limits, NDSolve,
FindFit, solver sieves, and stochastic equality. Preserve these distinctions:

- Map's exact tier requires integer/overflow guarantees; accepting a numeric
  profile is insufficient.
- Quadrature has purity-sensitive complex retry; an admission pass must not
  cause impure integrands to be sampled twice.
- Solver float prefilters and interval enclosure proofs have different
  correctness obligations. `interval-js` stays separate.
- FindFit ships stored code only after checking runtime metadata and
  portability. A new registry key must not accidentally bypass that route.
- Captured callable bindings and dependency invalidation matter to admission.
  Replaying bare MathJSON in a fresh engine is not equivalent.

The [Tycho inventory](tycho-consumers.md) covers plotting, batching, solvers,
styles, prelude statements, and the prelude worker. Current concurrency is
evidence about integration points, not a ceiling on future requirements.
Tycho's existing *engine profiles* configure engines; they are distinct from
the proposed *compilation profiles*.

The first annotation migration candidate is result-lane and operand-conversion
agreement among scalar parent operations, radicals/intrinsics, and conditional
arms. JS currently makes related decisions in several classifiers and emission
helpers. The inventory names those readers and separates binding-stable facts
from facts that require assignment versions or effect analysis. Removing a
reader from the experimental route does not yet permit deleting it globally.

## Live workload census

The recorder ran inside Tycho's public compilation gateway, after its effective
scopes were installed. It visited expression operands and dictionary payloads,
recording head/type combinations before CE preparation. It did not expand
reachable user-function bodies or compute effect summaries.

| Target | Compile calls | Distinct audit records | Successful records | Successful occurrences |
| --- | ---: | ---: | ---: | ---: |
| JavaScript | 863 | 712 | 701 | 852 |
| GLSL | 222 | 209 | 202 | 215 |
| interval-js | 231 | 180 | 179 | 229 |
| Total | 1,316 | 1,101 | 1,082 | 1,296 |

The run covered 97 documents. Six showcase preludes ran before their dependent
rows. The corrected recorder had zero truncations and no recorded instrument
errors. An unmodified runner on the same pinned checkout produced identical
1,101 records for source, options, outcomes, types, context, and occurrences;
timings were excluded from that comparison. See
[capture validation](evidence/capture-validation.json).

Among the 863 JS calls, overlapping visible families include:

| Family | Calls containing it |
| --- | ---: |
| Arithmetic / numeric rounding | 527 |
| Elementary functions | 262 |
| Collection constructors or operations | 228 |
| Tuple / point operations | 212 |
| Comparisons / booleans | 86 |
| Blocks / declarations / assignments | 78 |
| Selections | 62 |
| Color operations | 54 |

These are **feature incidence counts, not profile acceptance percentages**.
Dictionary nodes often hold declaration metadata, not runtime dictionaries.
Tuple results sometimes carry a list, rather than a numeric point. The four
calls with visible loop/exit nodes do not measure the importance of loops:
Buddhabrot's expensive body is behind a named `step` call.

The [live census](live-census.md) and [JSON summary](evidence/live-census.json)
give precise family sets, result-type groups, and limitations. The
[artifact inventory](corpus-inventory.md) provides 22 concrete extraction
candidates, including separate Buddhabrot construction, scalar lookup, and
color cases. Its historical ALL artifact predates prelude-aware CORE and must
not be treated as an equivalent larger baseline.

## Buddhabrot partition experiment

The actual showcase stores three 150×200 histogram planes and a cursor in a
90,001-entry list. Sample coordinates come from deterministic absolute sample
indices, not a random-number generator. Its two orbit loops and histogram
scatter updates are the relevant concurrency workload; plotting the resulting
histogram is a separate, cheaper kernel.

The experiment loaded the actual Epsil prelude, omitted only the full
1,200,000-sample initialization, and compiled its bound `step` through Tycho's
gateway. It compared serial execution with private zero-seeded partitions
whose cursors identify disjoint absolute sample ranges. The reducer adds
histogram deltas to the original bins and writes the final cursor once.

Eight cases passed: 0, 1, 101, and 1,000 samples, each with two and four
partitions. All 90,001 entries matched serial compiled execution and the
independent JavaScript reference. The initial histogram had nonzero counts
and cursor 137. Reversed reduction order and deterministic retry checks passed;
the deliberately incorrect cursor-summing reducer failed every control.

**Empty jobs must be skipped explicitly.** Epsil's implicit-step range `1..0`
descends through 1 and 0. Raw `step(H,0)` is not identity; the probe observed
24 histogram increments with a zero histogram and cursor 137. This is a
documented language rule, not a compiler defect. Explicit empty iteration
spaces belong in scheduling/lowering, rather than being inferred from reversed
bounds.

The experiment establishes partition correctness for these inputs, not worker
speedup. It created no actual worker pool and tested no cancellation. Dense
8-byte-number payload alone is about 720 KB per private histogram; that is
not measured JS heap use. A runtime experiment must measure transport,
allocation, merge time, scheduling imbalance, and startup separately.

For future execution, use stable job/range identities and commit each range
at most once. Retry equivalence does not make duplicate reduction safe. Keep
histogram and cursor publication atomic unless a separate resumable/progressive
result contract is chosen. The current prelude worker's deadline termination
does not establish cleanup of a future child pool.

See the [experiment report](buddhabrot-partition.md) and
[results](evidence/buddhabrot-partition.json).

## Structured IR experiment

A closed-vocabulary prototype lowers MathJSON directly into typed value IDs,
ordered operations, lazy branch regions, and explicit loop-carried values.
It is not integrated with `fragment.ts` and is not a replacement compiler.

Five fixtures, with local CSE off and on, passed 36 input evaluations against
legacy JS and independent oracles. The effect fixture also matched exact
branch-call traces. Four deliberately corrupted IRs were rejected: undefined
use, type mismatch, branch-region escape, and loop-carried type mismatch.

Local CSE reduced repeated-arithmetic instructions from 9 to 6 and its emitted
body from 212 to 158 bytes. These are within-prototype measures. Comparison
with legacy source size would be misleading because wrappers and infrastructure
differ. No runtime or allocation advantage is claimed.

An explicit positive-step loop tested genuine zero iterations, while a separate
fixture tested the language's default descending range. Neither needed CPS or
a flat control-flow graph. The remaining work includes preparation integration,
general bindings, absence/complex semantics, exits, budgets, and mutable memory
effects. See the [IR report](structured-ir.md) and
[results](evidence/structured-ir-results.json).

## Compilation cost baseline

The existing `benchmarks/compilation-cost.mjs` ran unchanged on pinned CE source:
five trials, ten timed warm compilations per trial, five warmups. Its 17 cases
compiled successfully; the 14 JS cases also checked results on four input bags
against their mathematical oracles. The three GLSL cases checked generated
source presence, not execution in a shader validator.

| Case | Median first compile, ms | Median warm compile, ms |
| --- | ---: | ---: |
| Identity | 0.313 | 0.080 |
| Scalar plot | 0.931 | 0.407 |
| Numeric list Map | 0.966 | 0.371 |
| Shared expression, depth 10 | 1.578 | 0.812 |
| Shared complex fold, depth 10 | 7.344 | 4.376 |
| Shared user functions, depth 7 | 6.767 | 5.069 |

This measures compiler cost, not execution throughput. It includes preparation
and emission together. Lock-held load at the start was approximately
2.97 / 3.98 / 3.67; source measurements are not production-bundle measurements.
Min/max and all cases are retained in
[compilation-cost.jsonl](evidence/compilation-cost.jsonl). These results establish
a reproducible baseline, not a regression threshold or a speedup claim.

## Next experiments supported by the evidence

1. Capture transitive function definitions and effective captures, then
   annotate the same prepared trees as emission. Only then compute a profile
   admission ladder. Add Life after an action and other live-input transitions;
   the present census describes load-time state.
2. Write the numeric-kernel profile around typed numeric aggregates, functions,
   local state, selections, and bounded iteration. Keep exactness policies and
   worker requirements independent. Use the 22 workload locators to prioritize
   implementation, not an arbitrary operator list.
3. Build a Buddhabrot runtime experiment with actual workers, worker-count and
   chunk-size variation, a fixed total sample range, and first/warm measurements.
   Include supersession/cancellation, no partial replay, and verified pool
   cleanup. Decide coordinator ownership before testing nested worker pools.
4. Integrate one annotation-driven JS slice, then re-run the same correctness
   and compilation-cost controls. Use the IR prototype as a design reference;
   do not transplant its closed-vocabulary implementation into production.

These are recommendations for review, not new ROADMAP entries.

## Reproduction and validation status

Retained instruments are under [instruments](instruments/); machine-readable
outputs, logs, and compressed capture are under [evidence](evidence/).
`typed-capture.patch` applies only to the pinned Tycho audit script. Buddhabrot's
instrument belongs at `scripts/repros/js-profile-buddhabrot-partition.mts` in
that checkout because it uses relative product imports. Both instruments write
private outputs under `/tmp/js-profile-audit-results`; create that directory
before replay. The IR instrument accepts `CE_ROOT` and `OUTPUT_DIR`.

To rerun the aggregation alone, decompress `typed-records.jsonl.gz` and
`core-digest.json.gz` into that private directory; name the decompressed digest
`core-full.json` for `analyze-live.py`. The aggregator uses only the metadata
and outcomes shared by full and digest shapes, not emitted code. Full generated
source is reproducible from the pinned corpus runner and was not retained here.

Executed successfully: corrected typed CORE run, unmodified CORE control,
compilation-cost harness, Buddhabrot partition checks, and IR checks. Initial
instrument errors were corrected before final runs: a nonexistent free-symbol
property in the recorder, omitted dictionary payloads, and an incorrect
empty-range assumption in the partition test. No production defect was
established. Issues added: 0; issues removed: 0.

Independent Codex review found no actionable issues in the three experiment
instruments for their stated scope. Claude review subsequently completed on
November 9. Its five low-severity evidence gaps were addressed with stronger
controls and clarification; see the review addendum below.

Full suites, builds, browser worker tests, and the larger ALL corpus were not
run: no production behavior changed, and the bounded studies answer the design
questions above. Actual worker performance, cancellation, full profile admission,
and post-action coverage remain unverified.

## November 9 review addendum

The retained IR instrument now runs all four corruptions with CSE both off and
on (eight negative controls), matches the exact loop-carried rejection, and
checks duplicate effects and CSE barriers in both modes. The five fixtures and
36 ordinary value comparisons still pass at the original CE source revision.

The retained partition instrument now checks each private cursor, feeds an
incorrectly cursor-summed array through the actual equality assertion, and
retries every nonempty partition. Empty-job identities are reported separately;
the original zero-job shortcuts did not execute compiled code. All eight cases
pass. Updated evidence replaces the original weaker control results.

The five differing historical capture signatures all belong to Buddhabrot and
compare different Tycho revisions. They are distinct from the same-checkout
instrumented/unmodified control, whose 1,101 records matched. The archived
summaries cannot independently reconstruct that full comparison; rerunning the
pinned gateway captures is required. See `evidence/capture-validation.json`.

The [second experiment bundle](../2026-11-09-js-profile-experiments/README.md)
adds actual workers, resolved function-body coverage, and a real fragment-pass
integration patch.
