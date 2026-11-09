# Composing the numeric callback boundary

This slice connects the internal fragment target's [typed function and local](2026-11-09-js-fragment-bindings.md), [named helper](2026-11-09-js-fragment-calls.md) and [capture snapshot](2026-11-09-js-fragment-captures.md) support. Its purpose is to exercise those boundaries together through a real numeric consumer, while retaining ordinary JavaScript as the consumer's default compiler.

## Consumer witness

The existing `test/compute-engine/map-compile-captured-values.test.ts` exercises adding a captured offset to each element of a range, including calls through a named helper. The integration fixture factors that calculation into a typed callback with one local and a helper that reads the offset. This is a derived fixture for an established workload, not a claim that a complete Tycho showcase now compiles.

The test opts into the internal target at the engine's compilation entry. It forwards the actual expression and options supplied by `Map`, after the consumer has performed its eligibility checks and `implicitCompile` has established callable bindings. The normal numeric marker handling, dependency tracking, result checks and JIT policy stay in place. Successful compilation alone is insufficient evidence: the test must observe calls to the generated runner and the consumer's compiled-execution counters.

There is no production consumer switch, public profile option or target registration. This slice does not expand the collection emitter or establish worker portability, parallelism or exact-tier eligibility.

## Compiler boundary

Named helper calls become eligible in the existing root function's value positions: local initializer, assignment value and final expression. Parameters and the local retain their declared representation; arguments retain the helper's required representation. The helper retains its existing pure scalar grammar and single numeric literal capture. Captures directly in the root function remain outside this slice.

Facts for a call are read from its known lexical scope. Helper definitions and captured literals retain their existing exact-identity handoffs. This does not permit searching arbitrary scopes for facts. A helper or capture whose name collides with a root parameter or local is conservatively refused in this slice.

## Which decisions now share facts

| Decision | Authority in this slice | Remaining legacy work |
| --- | --- | --- |
| Add/Negate representation in locals and helper bodies | One shared rule reads scoped operand facts | Ordinary scalar-root annotation still uses the existing numeric policy |
| Helper resolution and signature agreement | One collector and annotation check serve both entry paths | Existing definition preparation, specialization refusals and registry emission remain |
| Helper argument conversions | Annotation records the edges; the existing emitter consumes them | The generic call path still computes argument ranks and its legacy conversion classification before the annotated conversion is selected |
| Local writes | The known block scope supplies value and binding representations | Existing declaration, assignment and variable-name emission remains |
| Captured numeric value | Exact binding and literal identity, then root-scope facts for that substitution | Existing stored-value emission and dependency collection remain |
| If branches | Annotated conversions stay inside the selected branch | Existing condition checks, branch selection and lazy emission remain |

The change adds 105 and removes 113 source lines in `javascript-fragment-target.ts`. It removes one duplicate operand-based arithmetic rule, and centralizes helper collection and validation rather than adding a second implementation for root functions. No shared legacy reader is deleted; no new facts hook or compiler-core change is needed. Missing required facts still reject compilation rather than trigger an alternate analysis.

This is evidence that scoped annotation can compose the existing pieces with less duplicated code. It is not evidence of faster compilation or an independent emitter. The generic call path's remaining type/representation queries are a concrete boundary for a later migration decision.

## Observed consumer behavior

A direct source probe exercised the actual Map route with `Range(1,128)` and offset 0.5, repeated the drain unchanged, then assigned offset 10.5. The interpreter, ordinary JavaScript and fragment routes agreed:

| Drain | First | Last | Sum |
| --- | ---: | ---: | ---: |
| Initial | 1.5 | 128.5 | 8320 |
| Unchanged repeat | 1.5 | 128.5 | 8320 |
| After reassignment | 11.5 | 138.5 | 9600 |

Both compiled routes constructed two artifacts and recorded one recompilation. They executed 128 compiled calls in the first drain and 128 after reassignment; the unchanged repeat reused memoized elements and executed no additional calls. Both dependency sets contained `helper` and `offset`. The old artifact still returned 1.5 for input 1, while the new artifact returned 11.5. With JIT disabled, there were zero compilation attempts and zero compiled calls. These are observed values, not timing measurements.

## Validation

The implementation is based on `13c41f1c7` and was applied byte for byte to the shared checkout.

- Five fragment suites passed: 222 tests, including 24 new composition tests. They cover both numeric modes, CSE and folding toggles, repeated calls across writes, all three call positions, complex locals, shadowing and rejected representation changes.
- The new Map integration test passed separately and checks all 128 elements for all three execution routes, cache reuse, dependency invalidation and actual compiled execution.
- Core tests passed: 18 suites, 5,518 tests, 15 existing skips and 1,368 unchanged snapshots.
- Full typechecking, dependency checking, changed-source lint, AST trap scan and whitespace checks passed.
- Shared-checkout typechecking and both new suites (25 tests) passed with identical before/after source fingerprints.

No snapshots changed and no issues were added or removed. The previous capture handoff is removed now that its implementation is committed. No public behavior changes, so public guides and release notes are unchanged. A full corpus run, benchmark and Tycho browser run were omitted because this is a bounded internal callback migration; no performance or whole-showcase parity is claimed. The full suite remains with nightly checks: the base has one commit since the passing mark `419ac4dd9`.

Independent Codex and Claude reviews found no correctness defects. Two comments were clarified after review; no behavior changed. The formatting suggestion was left to the release formatter, as the repository requires.
