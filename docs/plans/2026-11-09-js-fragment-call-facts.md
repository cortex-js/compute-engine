# Emitting scalar helper calls from fragment facts

The [callback composition slice](2026-11-09-js-fragment-callback.md) identified redundant argument classification inside `emitUserFunctionCall`. The internal target had already proved scalar arguments and recorded their conversions, but the emitter still computed legacy parameter lanes, list ranks and nominal-type checks before selecting the annotated conversion.

This slice makes the existing annotation authoritative at that emission boundary. It admits no additional programs and changes no consumer default or public API.

## Boundary

The ownership check distinguishes an ordinary target from an annotated scalar call. An ordinary target continues through the existing generic emitter. An annotated call must have the expected compilation policy, exact helper and argument identities, no hidden arguments, and complete scalar operand facts with identity conversions. The edge count must equal the argument count; the producer omits an empty edge list, which counts as zero. Missing or mismatched facts reject a nonempty call before any operand is emitted.

For an authorized call, each operand still goes through `compileValueOperand`, once and in argument order. The call uses the function name supplied by the existing registry. Definition preparation, registration, captured-value emission and runtime assembly remain in place.

The emitter bypasses its legacy parameter-lane adjustment, argument map-rank analysis, nominal/open-rank checks, collection-argument emission and conversion selection for these scalar calls. Those routines remain available to ordinary targets. The generic conversion closure no longer needs a fragment-facts fallback because annotated calls have already returned.

This does not eliminate all call-related type queries from compilation. In particular, upstream `tryCompileUserFunction` still classifies declared parameter coercions and whether parameters bind scalar values. The change is confined to emission; it makes no timing or whole-compiler independence claim.

## Validation

The focused boundary test prepares real fragment facts, then makes legacy readers throw. The annotated call must emit successfully; an ordinary-target control must reach the replaced reader. A separate operand-emission recorder checks order and count. End-to-end fragment tests, including the real Map callback route, remain the value and consumer-behavior checks.

On the isolated `b9b37fca6`-based tree:

- Seven fragment suites passed: 231 tests, including eight new boundary tests and the existing real Map consumer test. The final change to use the real producer in the test fixture was rechecked separately; all eight tests passed.
- After aligning the conversion-count check with the producer's omitted empty list, the two affected suites passed all 45 tests, including the ninth new boundary test. Full typechecking and changed-source lint passed again. Unaffected results were reused.
- Five selected legacy suites passed: 155 tests covering ordinary JS broadcasting, real-parameter projections, complex results, Python collection/scalar calls and GLSL typed function bodies.
- Core tests passed: 18 suites, 5,518 tests, 15 existing skips and 1,368 unchanged snapshots.
- Full typechecking, dependency-cycle checking, changed-source lint, the AST trap scan and whitespace checks passed. The issue ledger lint passed.

The two source files add 19 lines and remove eight. One existing ownership-test fixture gained the operand facts that the real producer already supplies. There are no snapshot changes and no issues added or removed. The new branch replaces a fragment-conversion fallback in the generic path; the legacy classifier implementations remain for ordinary targets.

No benchmark, broad corpus experiment, browser test, public guide update or new representation is needed for this internal emission change. It demonstrates independence from specific redundant readers, not a speedup or complete independence from legacy analysis. CPS/SSA and an independent emitter remain separate decisions.

Independent Codex and Claude reviews are complete. The conversion-count adjustment received a second, delta-only review from both reviewers, with no regressions found.
