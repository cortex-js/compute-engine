# Internal JavaScript fragment slice

The first varying-lane slice implements the [prepared annotation contract](2026-11-09-shared-annotation-contract/annotation-contract.md) for `Add`, `Negate`, `Sqrt` and three-operand `If`. It uses the existing fragment walker and JavaScript emitter. The traditional JavaScript target remains the default; the internal `ScalarFragmentJavaScriptTarget` is not registered or exported through a public entry point.

## What is implemented

Preparation runs once through the existing JavaScript preparation path. A compile-local artifact owns the prepared root, annotation factory and policy snapshot. Annotation runs after the compiler installs its numeric mode and folding policy. Facts belong to exact prepared nodes; missing facts and mismatched roots or policies throw instead of falling back to the legacy readers. Nested emission restores the current-node context in `finally`.

Operation result representations and operand conversions drive both the infix shortcut and function handlers. In strict mode, `Sqrt(x)` for a real input uses `Math.sqrt`; complex mode annotates its result as complex and explicitly converts the operand for `csqrt`. Mixed real/complex `If` conversions remain inside the selected branch. The existing public runner still performs its normal result normalization.

The slice admits statically typed scalar inputs and numeric literals. It refuses stored bindings, binders, unsupported heads, host source overrides, batch/broadcast compilation and numeric modes other than strict and complex. This is an internal migration boundary, not a new public profile contract. Randomness is deliberately excluded; a seeded legacy regression checks that this integration leaves its lazy behavior unchanged.

Six source modules participate: the new `javascript-fragment-target.ts` and `javascript-fragment-facts.ts`, and hooks in `javascript-target.ts`, `compiler-core.ts`, `compile-operators.ts` and `compile-conditionals.ts`. No shared fragment or GLSL source is changed by this slice.

## What this establishes

Annotations can select different real/complex lowering paths in the existing emitter, including lazy operand conversions. Nine legacy decision entry sites are bypassed for the opted-in slice. Zero reader implementations are removed: the annotation producer deliberately still calls the existing complex-lane policy. This proves the consumption boundary, not elimination of duplicate analysis or a speed improvement.

The ownership check compares policy values and container identities. It is not a deep snapshot or a persistent cache. The admitted grammar has no mutable local scope or caller-provided emission hooks. Functions, assignments and reusable prepared handles need their own environment and mutation rules before admission expands.

## Validation

The implementation was developed against committed CE `916aff07c13e34482688631008c0c7a0275e45af` in an isolated worktree. Checks completed with exit 0:

- 102 focused tests, including strict/complex mode, CSE and folding combinations, independent complex values, lazy branch conversion and ownership rejection.
- Existing complex, result-normalization, mode and general compilation regressions: the combined initial run had 969 passing tests, one existing skip and 28 unchanged snapshots. Later focused additions are covered by the 102-test run; these totals overlap.
- CSE and subtree-folding regressions plus the final focused slice: 266 passing tests and nine unchanged snapshots.
- Core set: 18 suites, 5,518 passing tests, 15 skips and 1,368 unchanged snapshots.
- Full typechecking, dependency-cycle check, changed-source lint and AST trap scan.
- Shared-checkout integration: all 102 focused tests and full typechecking passed alongside the concurrent GLSL work. Source/test fingerprints were unchanged across both checks.

The required committed-HEAD nightly check separately failed in `fungrim-loader.test.ts` and `fungrim-loops.test.ts`. It tested the baseline commit without this slice, so it is not a validation result for the slice. Those two files also appeared in the preceding failed nightly record; no cause investigation was undertaken here.

Independent Codex and Claude reviews passed without findings. The seven staged source/test files were compared byte for byte with the isolated tree that passed full typechecking and the core set.

No snapshots were changed. No benchmark, new corpus run, browser run or public API documentation change was needed for this internal slice. No issues were added or removed; the issue ledger lint passed.

## Next useful boundary

Extend the experiment to one bound function and a same-shape local accumulator, drawing fixtures from Tycho's traffic and heat preludes. That will test lexical ownership and mutation without requiring CPS or SSA first. Keep collection updates and Buddhabrot worker execution as separate admission and execution questions. Do not broaden public profiles or register an alternative target until the binding boundary is demonstrated.
