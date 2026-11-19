# Numerical execution follow-up · 18 November 2026

**Landing recommendation: keep the initialization-contract replacement as delivered. Discard the experimental getter change.** The two earlier numerical-execution slowdowns did not reproduce on the identical frozen artifacts. Collection execution does more work inside the multiplication type handler on both evaluation methods. The extra contract getter traffic is real, but removing 498 reads per execution supplied no speedup for repeated `N()`. This decision accepts the previously reported preparation gap relative to the original baseline.

## Replay

Microseconds per operation. Each cell gives the median of three accepted independent process medians, followed by their range. Seven timed samples per process, 1,000 warmups, calibration to at least 100 ms, Node 26.13.0 / V8 14.6.202.34-node.40, Darwin arm64. The production CE fixtures use precision 21. Current is the unchanged fd7bad6e1 consolidated control. Candidate is the frozen source and production build based on that control. The integration subsequently landed as 92cd16dd9. No implementation or index edit was made in the shared checkout during this investigation.

| Phase | Current µs | Candidate µs | Candidate/current |
|---|---:|---:|---:|
| Collection repeated N | 1,537.7 [1,516.0–1,636.1] | 1,548.5 [1,518.6–1,574.6] | 1.007 |
| Collection repeated evaluate | 1,520.1 [1,382.0–1,523.7] | 1,445.9 [1,385.5–1,518.0] | 0.951 |
| Program first N | 53.0 [52.8–56.3] | 51.8 [51.7–53.5] | 0.977 |
| Program first evaluate | 51.2 [48.3–52.1] | 49.5 [49.0–50.5] | 0.967 |

The earlier observations were 1.123 and 1.230 for the two N phases. Both earlier comparisons had disjoint ranges. This replay has overlapping ranges in all four comparisons. Even the unchanged candidate measured 1,431.1 µs for repeated collection N in the subsequent intervention series. There is no stable elapsed-time difference of the earlier size to assign to a call path.

The collection fixture reuses one boxed Program containing the gasket's csqrt/fourth functions and checks the four-tuple checksum 415. The fresh Program evaluates square(3)+1 to 10. For first execution each input was boxed before starting the timer or profiler and executed exactly once. The historical and replay first-N timing samples each used batches of 2,048 fresh expressions. Module loading, engine construction, warmup, validation and preparation are outside that interval. Execution can still incur GC from earlier allocations. The timing driver held the shared lock and retained the historical load and competing-process gates. Accepted samples from repair blocks are included, and failed windows remain in the packet. These are process ranges, not confidence intervals.

## What changed in collection execution

One pass of each method produced the same counts within each arm. The table is per execution. Counts come from separate observed builds with calculation results checked, and never from the timed processes.

| Operation | Current | Candidate | Isolated intervention |
|---|---:|---:|---:|
| Definition declared-type getter, all bindings | 1,174 | 2,470 | 1,972 |
| Of these, reads of a fixed contract | 0 | 2,198 | 1,700 |
| Actual boundCallType derivations | 153 | 153 | 153 |
| Nonempty Multiply type handler calls | 28 | 28 | 28 |
| BoxedType constructors | 45 | 45 | 45 |
| assertAssignableValueDef write admissions | 16 | 16 | 16 |

A finalized definition returns its existing `_type` or the shared unknown type. The hot path through `BoxedSymbol.type`, the definition's `type` getter and `declaredType` can read that contract several times. Constructing a type wrapper, deriving an expression type and admitting an assignment each have distinct entry points. The counts show why counting all 2,470 reads as derivations or allocations would misidentify the cost.

**The reproducible extra cost is inside arithmetic type derivation.** The sampled path goes through `BoxedFunction.computeType`, `boundCallType`, `guardedTypeHandlerCall` and the Multiply type handler. On the control, `scalarProductType` returns a scalar answer for all 28 calls. On the candidate it returns one for 19. The other nine continue into the handler's general shape analysis: three have two unknown operands and six have one unknown and one number. The control has 21 number/number cases where the candidate has 12. This records the operands received by the actual handler in a separate diagnostic run. Treating an unknown as numeric would change the accepted semantics.

The table gives averages of two independent phase profiles per arm, in reverse arm order on the second run. CPU entries are inclusive sampled microseconds per operation for the multiplication handler. Allocation entries are estimated bytes per operation, including collected objects. Inclusive paths overlap.

| Profile quantity | Collection N current → candidate | Collection evaluate current → candidate |
|---|---:|---:|
| Multiply inclusive CPU, µs | 7.1 → 27.8 | 6.8 → 26.5 |
| Multiply inclusive allocation, B | 37,284 → 75,826 | 38,392 → 76,149 |
| Total allocation, B | 3,127,773 → 3,155,581 | 3,126,766 → 3,161,622 |

Other paths offset part of the arithmetic cost. For collection N, the sampled contract getter itself and descendants averaged 15.5 → 10.5 µs despite the higher read count. Write admission averaged 23.6 → 25.4 µs and wrapper construction 8.3 → 9.0 µs. These isolated profile differences have sampling uncertainty. The arithmetic shift is visible in both methods and cannot explain an N-only 12% wall-time penalty.

## First Program execution and V8

Program first N made 21 declared-type reads on each arm, three actual bound-call derivations, three BoxedType constructions and one nonempty Multiply type call. Three candidate reads were fixed contracts. Neither arm entered assertAssignableValueDef on this first-execution fixture. For first evaluate the two arms likewise matched at 19 declared-type reads and three derivations. First N sampled 139,778 → 139,840 allocation bytes per call; first evaluate sampled 133,779 → 132,410. The inclusive bound-call CPU samples for first N averaged 14.8 → 15.1 µs. The profiles give no causal support for an extra 12 µs of first N execution on the candidate.

Separate unmodified V8 processes bracketed the post-warmup execution interval with markers. Over 1,000 collection N operations there were 272 → 261 bailouts, including 241 → 231 wrong-map bailouts. The evaluate control had 259 → 246, including 228 → 225 wrong-map bailouts. Over 4,096 fresh Programs there were 7 → 6 bailouts for either method (5 → 4 wrong-map). Shape-related deoptimizations occur on both arms. Their frequencies and the control phases give no evidence of a candidate-specific deoptimization storm. No exhaustive object-transition log was needed.

## Reversible test

The experiment changes one branch of BoxedSymbol._unitType in an isolated copy. After existing binding resolution, the non-inferred, known-type path reads declaredType once and passes that same object to _typeWithFacts(declared, true). Previously it tested declaredType, returned undefined and let the outer getter reread it through the same definition. Unknown, use-site facts, redeclaration resolution, write admission and solver removal keep their existing paths.

| Phase, separate intervention series | Unmodified candidate µs | Experiment µs |
|---|---:|---:|
| Collection repeated N | 1,431.1 [1,392.1–1,521.2] | 1,442.0 [1,422.9–1,494.3] |
| Collection repeated evaluate | 1,442.4 [1,379.4–1,581.8] | 1,426.4 [1,396.3–1,505.5] |

The candidate/experiment comparison used three accepted processes per arm and method. Removing the duplicate read reduced fixed-contract reads by 22.7% while leaving observed derivation, wrapper and admission counts unchanged. All 63 tests in the initialization-contract and matrix-order suites passed in the experiment. Its N median rose 0.8% with overlapping ranges. It supplied no hot-path recovery, so the conditional boxing and notebook rechecks were not triggered.

## Tycho Cartesian plot

The frozen Graph Paper Cartesian template supplies a line whose source is sin(x). The production document engine at machine precision, resolveSeriesData and createPointEvaluator prepared it once per fresh process. The point evaluator sampled 4,097 grid positions across two periods, repeated for 32 frames. Every one of the 131,104 results was compared with Math.sin, with maximum absolute error zero on both arms. This exercises Tycho's CPU point sampling, without browser painting or GPU rendering.

A separate route-audit process counted successful compilation of both JavaScript and interval JavaScript on each arm. Preparation made one interval probe. During sampling, **all 131,104 calls ran the compiled interval-JavaScript artifact**, which evaluates a degenerate interval and returns its midpoint. The scalar JavaScript artifact received zero sample calls. Ordinary plot timings contained no artifact counters.

| Median per fresh process (three accepted per arm) | Current | Candidate |
|---|---:|---:|
| Prepare/resolve, ms | 9.67 | 9.44 |
| 131,104 numerical evaluations, ms | 25.33 | 25.06 |
| Paired preparation + execution, ms | 35.17 | 34.50 |

The paired totals are medians of each process's sum. Engine and module startup and post-run oracle checks are excluded. One template establishes the route and result for this plot; it cannot represent every Tycho plot.

## Evidence and reproduction

The [machine-readable results](N-PHASE-RESULTS.json) contain process medians, accept/reject decisions, observed counts, route records, deoptimization counts and inclusive profile summaries. The complete local packet is [/private/tmp/ce-n-phase-20261118](/private/tmp/ce-n-phase-20261118). Its scripts use the frozen [control and candidate](/private/tmp/ce-init-contracts-current-measurement-20261118). Recorded SHA-256 hashes matched all 78 distribution files per arm, 734/733 source files and 3,564 Tycho source files per arm.

The recorded commands are `python3 run.py` (original replay and first profiles), `python3 finish.py` (reverse-order profiles and make-ups), `python3 intervention.py`, `python3 plots.py`, `python3 observe.py`, `python3 audits.py` and `python3 multiply.py`, from the local packet under the shared timing lock. The isolated source delta is [experiment.diff](/private/tmp/ce-n-phase-20261118/experiment.diff). Individual child requests, unprofiled timer rounds, monitor logs, and separate V8 .cpuprofile and .heapprofile files remain there. CPU sampling used a 100 µs interval; allocation sampled every 32 KiB with major/minor collected objects included. Profiles used 1,800 CPU or 2,000 allocation executions for collection and 4,096 preboxed fresh executions for Program. CPU profiler start/stop and inspector frames are excluded from the named production paths and were never used for ordinary timings. The production paths were symbolized using the existing byte-verified source maps. Unattributed inlined work and sampling variance limit finer-grained causal claims.
