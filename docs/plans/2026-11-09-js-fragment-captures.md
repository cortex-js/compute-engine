# Numeric capture snapshots in the JavaScript fragment target

The internal fragment target extends the [named scalar helper boundary](2026-11-09-js-fragment-calls.md) to one explicitly typed numeric capture. It preserves the [compile-local annotation contract](2026-11-09-shared-annotation-contract/annotation-contract.md): an embedded capture is a compilation-time snapshot. Reassigning the engine binding affects a new compilation, while the already-built function retains its embedded value.

## Boundary

Admission retains the captured binding, its symbol occurrences and its stored numeric literal. The real fragment pass types the stored value through `storedValue`. The existing JavaScript emitter continues to embed that value; the ownership layer authorizes the exact literal's annotation scope only while emitting its recorded captured symbol. No general lookup across annotation scopes is introduced.

Binding identity and value identity must still agree when annotation and emission consume the snapshot. A same-name binding in another lexical scope cannot replace it. Function parameters continue to shadow ambient names.

The change is internal. It does not register a target or profile, change ordinary JavaScript capture behavior, add a persistent cache, or introduce runtime invalidation. It adds no CPS or SSA requirement.

## Scope and validation

The capture must have an explicitly declared real or integer type and hold a finite real numeric literal. Inferred declarations, complex captures, compound or effectful stored values, and a second captured binding decline. The separate root-function/local-binding grammar is unchanged. Parameters still shadow ambient captures. This is a deliberate migration boundary; ordinary JavaScript compilation retains its broader support.

A direct source probe compiled a helper adding `offset` to its real parameter. With input 3 and offset 2, both the internal target and ordinary JavaScript returned 5. After assigning offset 7, both old artifacts still returned 5; a fresh internal compilation returned 10. The generated helper bodies embedded `2 + u` and `7 + u`, respectively. This observation also holds with `constantFold: false`: embedding a stored numeric binding is distinct from optional subtree constant folding.

Validation on the isolated c8bf12127-based tree:

- Four fragment suites passed: 198 tests, including 26 new capture tests. Coverage includes both modes, CSE/folding toggles, reassignment, shadowing, repeated captures in If branches, integer captures and rejection boundaries.
- The core set passed: 18 suites, 5,518 tests, 15 existing skips and 1,368 unchanged snapshots.
- Full typechecking, dependency-cycle checking, changed-source lint and the AST trap scan passed.
- Identity tests reject a changed capture after preparation and attempts to use another scope's facts without the exact captured-symbol operation.
- The issue ledger lint passed. No issues were added or removed and no snapshots changed.

The source change adds 70 lines and removes three across two internal files. It removes no legacy reader implementation. No benchmark, broad corpus run, Tycho browser test or public documentation update was needed: the slice establishes capture ownership without registering a public target or making a performance/parity claim. The full suite remains with the nightly run; the base has one commit since the passing full-suite mark c109b7fc9.

After application, the two source files and new test were compared byte for byte with the isolated tree. Full typechecking, all 26 capture tests and the core set also passed in the shared checkout with stable source fingerprints. The shared core check was repeated because concurrent GLSL changes had altered the fragment producer and compiler entry points; the isolated result alone did not cover that combination.

Independent Codex and Claude reviews found no correctness defects. A comment was expanded to explain why stored literals use root-scope facts. Review also noted that the declaration-change regression reaches an existing earlier guard; the test proves the required decline without claiming to isolate the new redundant type guard.
