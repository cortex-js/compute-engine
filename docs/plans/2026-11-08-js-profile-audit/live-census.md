# Live compile-input census

This analyzes the parent's completed CORE capture in `typed-records.jsonl` and `core-full.json`. No compiler or corpus run was performed by this analysis. Parent reports the instrumented/original Burning Ship control agreed on all seven code/options/success/type records, excluding timings; the initial instrumentation error was corrected before this run.

## Scope of the evidence

The capture contains 1,316 calls immediately before `rawCompile`, inside Tycho's gateway environment. It is the input to CE compilation, not CE's later prepared/annotated tree. The recorded `headTypes` counts distinct expression-object identities within each walked input. A repeated head with two types contributes to both histogram keys, but the call-incidence counts below collapse those keys before counting. No capture was truncated.

The field `unknownSymbolTypes` is `expr.unknowns` plus the observed types of those names. It is **not** `CompilationResult.freeSymbols` or a complete lexical binding inventory. In particular it need not expose function heads and captures. The capture does not expand user function definitions. Dictionary payloads are traversed in this final capture: the Buddhabrot `H_1` declaration exposes `step`, and `H_0` exposes a comprehension. The body of `step` is still not expanded, so its nested orbit loops and histogram updates are not counted.

Artifact metadata: generated `2026-11-09T07:09:51.852Z`, Tycho `8777c57e3`, CE version string `0.184.0`, CORE. The parent's worktree/source provenance is additionally necessary because the package version alone cannot distinguish this experimental build from a release. `live-census.json` includes the capture SHA256, exact family membership, target counts, type groups, head incidence, and unknown-symbol examples.

## Calls and compilation outcomes

| Target | Captured calls | Audit records | Successful records | Failed records | Successful occurrences | Failed occurrences |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| JavaScript | 863 | 712 | 701 | 11 | 852 | 11 |
| GLSL | 222 | 209 | 202 | 7 | 215 | 7 |
| interval-js | 231 | 180 | 179 | 1 | 229 | 2 |

Success is read from the separate deduplicated audit. Its occurrences total matches the capture per target. **No typed call is assigned an outcome by array index.** The recorder merges calls by input/output/error, while the typed stream preserves individual invocations and does not include a matching output key. Therefore these tables do not establish, for example, that all calls with `Loop` succeeded.

## Observed operation families

Counts are calls with at least one visible member, overlap across families, and include successful and refused attempts.

| Visible family | JS / 863 | GLSL / 222 | interval / 231 |
| --- | ---: | ---: | ---: |
| Arithmetic and numeric rounding | 527 | 182 | 131 |
| Elementary functions | 262 | 98 | 31 |
| Comparisons / boolean operations | 86 | 15 | 39 |
| If / Which / When | 62 | 15 | 14 |
| Block / Declare / Assign | 78 | 0 | 3 |
| Explicit loops / exits | 4 | 0 | 2 |
| Collection constructors or operations | 228 | 94 | 19 |
| Collection consumers specifically | 108 | 14 | 17 |
| Tuple / numeric point components | 212 | 34 | 0 |
| Color operations | 54 | 21 | 0 |
| Selected special numeric functions | 5 | 3 | 4 |
| Dictionary or String nodes | 78 | 0 | 3 |

Exact family sets are recorded in JSON. The most frequent JS heads by call incidence include Add 464, Multiply 371, Sin 251, Cos 237, Tuple 212, Power 178, Negate 168, PointList 95, Divide 80, Block 78, Declare 78, At 95, List 67, Which 55, AsOklab 54, Range 46, and Comprehension 64.

Dictionary/String nodes are frequently declaration metadata. Their presence does not establish a requirement for general runtime dictionaries or strings. Similarly, visible syntactic loops are a lower bound on workload control flow, because named calls can hide entire bodies. Zero GLSL loop nodes in this capture does not mean GLSL kernels have no loops.

A deliberately incomplete numeric-head catalogue marks 275 JS, 116 GLSL, and 90 interval calls as containing another head. These are **call candidates**, not a measured count of user-defined functions: a name may be a library head omitted from this catalogue or a shadowed definition. Of these calls, 129 JS and 46 interval calls contain `TychoCertificate…` heads. Resolving definitions is required to classify their semantics. The catalogue and candidate names are explicit in JSON so this heuristic is reproducible and can be replaced rather than mistaken for admission.

Summed distinct-node occurrences are dominated by numeric literals: JS has 69,729 Real occurrences among 97,636 total; GLSL 68,957 / 73,313; interval 68,800 / 78,975. Those are sums across input trees and invocations, not unique corpus nodes or runtime instruction counts. Prefer call incidence when choosing the first profile slices; keep literal size as a separate preparation-cost dimension.

## Result type observations

These are lexical groups of the observed engine type string before CE preparation, not target result ABI classifications.

| Result group | JS | GLSL | interval |
| --- | ---: | ---: | ---: |
| Numeric scalar or absence union | 361 | 87 | 136 |
| Numeric scalar literal | 24 | 0 | 23 |
| Boolean | 26 | 0 | 72 |
| Tuple | 289 | 112 | 0 |
| Vector | 26 | 2 | 0 |
| List | 83 | 0 | 0 |
| Color | 54 | 21 | 0 |

Tuple includes forms such as `tuple<list<integer>>` on prelude blocks; it cannot be read as a promise that all 289 JS calls return a numeric point. Numeric scalar groups include wide `number` and unions mentioning absence/non-finite values; they do not prove real-lane or finite-value execution. Static result typing and actual lowering should be reconciled in the next capture.

Three calls have an `expr.unknowns` entry typed exactly `unknown` or `any`: GLSL domain-coloring (`z`), GLSL complex-trig-sum (`z`), and JS neyret `1e9rxgmywb` (`theta`). This is input observation only, not a statement that compilation accepted untyped inputs. No per-node unknown incidence or free-symbol rejection rate is inferred from it.

## Priorities supported by these observations

1. **Scalar arithmetic plus user-call resolution.** Arithmetic is common, but a scalar-only histogram cannot establish an independently compilable kernel when a named body is hidden. Resolve transitive function definitions before computing a profile coverage ladder.
2. **Tuples, lists, and color early in numeric-kernel design.** Numeric consumers are not overwhelmingly scalar-returning: PointList, Tuple, At, comprehensions, and color outputs are material visible workloads. General-program features can remain deferred without excluding these numeric shapes.
3. **Branch and binding semantics before aggressive optimization.** The 62 JS selection calls and 78 binding/block calls supply real cases for explicit regions and lexical identities. Test both branches and effect ordering, rather than treating the head counts as optimizer opportunities.
4. **Buddhabrot as a separate concurrency specimen.** Its histogram-construction function body is opaque to this shallow capture, while its rendering exposes list access and color calls. The full `step` body and histogram update/reduction semantics must enter the experiment explicitly. The four visible JS loop calls must not set the concurrency priority.
5. **Separate preparation size from execution cost.** Large literal trees can dominate walking without dominating runtime; record folded/retained nodes in CE preparation before choosing an optimization based on raw input size.

These observations are lower bounds on encountered features, not percentages of programs admitted by a proposed profile. They also provide no worker-portability, independence, determinism, or execution-frequency measurement. All of those require the binding/effect and runtime studies described in the main audit plan.

## Validation

Read-only JSON parsing and aggregation completed successfully. Calls total 1,316; per-target totals equal audit occurrences; truncation count is zero. No success-to-typed-input join was attempted. No new defects were identified. Files written only under `/tmp/js-profile-audit-results`: analysis script, this report, and JSON summary.
