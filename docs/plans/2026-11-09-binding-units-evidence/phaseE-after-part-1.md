class key: cls; failing tests counted: 671

| Class | Tests | Files |
|---|---|---|
| BC1 | 359 | 119 |
| OLD-MECH | 43 | 16 |
| UNCLASSIFIED | 32 | 25 |
| BC-LOOKUP | 32 | 15 |
| DEF-ADMIT-OCC | 19 | 9 |
| DEF-EPSIL-PIN | 17 | 2 |
| DEF-MATRIX-REPAIR | 17 | 4 |
| DEF-FREE-CALL-TYPE | 16 | 5 |
| DEF-LIMIT-FREE-PARAM | 12 | 3 |
| DEF-NESTED-WRITES | 10 | 3 |
| DEF-OPTOKEN | 9 | 5 |
| BC-LIBVAR | 8 | 3 |
| DEF-FREE-HOME-SCOPE | 8 | 4 |
| DEF-WITHVALUES | 7 | 2 |
| DEF-TARGET-NO-OP | 7 | 1 |
| DEF-FREE-HEAD-D | 7 | 1 |
| DEF-BINDER-SUBST-FREE | 7 | 1 |
| DEF-CAPTURE-FREE | 7 | 1 |
| DEF-FREE-NAME-CAPTURE | 6 | 3 |
| DEF-LISTREC-SELFREF | 4 | 1 |
| DEF-BLOCK-LOCAL-CALL | 4 | 1 |
| DEF-DYNAMIC-RESOLUTION | 4 | 4 |
| DEF-FREE-BOUND-SAME | 4 | 2 |
| BC-HELD | 4 | 3 |
| DEF-ENVDEPS | 3 | 1 |
| DEF-MEMO-STORED | 3 | 1 |
| DEF-RECURSION | 2 | 2 |
| DEF-DESTRUCTURE-LET | 2 | 2 |
| DEF-INTEGRATE-POLE | 2 | 1 |
| DEF-DECLUNKNOWN-TYPE | 2 | 2 |
| DEF-ENUM-FREENAME | 2 | 1 |
| BC-NARROWINGS | 2 | 1 |
| DEF-LIB-AUTODECL | 1 | 1 |
| DEF-TELESCOPE | 1 | 1 |
| NEW | 1 | 1 |
| DEF-FIRST-ASSIGN-FREE | 1 | 1 |
| DEF-STACK | 1 | 1 |
| BC-RULE4 | 1 | 1 |
| DEF-RSOLVE-NOTCANON | 1 | 1 |
| DEF-SYMBOL-LITERAL-INPUT | 1 | 1 |
| DEF-EPSIL-PARAM-NAMES | 1 | 1 |
| BC-RULE7 | 1 | 1 |

### BC1 (359 tests, 119 files)
- test/compute-engine/accessor-proven-length-type.test.ts (2)
- test/compute-engine/apply-held-callee.test.ts (1)
- test/compute-engine/arithmetic-unknown-cell-tier.test.ts (1)
- test/compute-engine/bigop-symbol-body-infers-collection.test.ts (1)
- test/compute-engine/boxing-deep-trees.test.ts (1)
- test/compute-engine/boxing-seam-canonical-heads.test.ts (2)
- test/compute-engine/bug-fixes.test.ts (1)
- test/compute-engine/callback-last-function-body.test.ts (1)
- test/compute-engine/ce-39-literal-cell-types.test.ts (20)
- test/compute-engine/ce-473-captured-free-symbol.test.ts (2)
- test/compute-engine/ce-502-unknown-operand-broadcast-type.test.ts (1)
- test/compute-engine/ce-519-shader-nan-extremum.test.ts (1)
- test/compute-engine/ce-580-compile-shader-assignment-targets.test.ts (3)
- test/compute-engine/ce-583-block-local-list-no-copy.test.ts (1)
- test/compute-engine/ce-597-unknowns-library-letter-operand.test.ts (1)
- test/compute-engine/character-string-operators.test.ts (3)
- test/compute-engine/collection-operator-parameter-inference.test.ts (1)
- test/compute-engine/collections.test.ts (5)
- test/compute-engine/compile-absent-point-spelling.test.ts (19)
- test/compute-engine/compile-broadcast.test.ts (3)
- test/compute-engine/compile-complex.test.ts (3)
- test/compute-engine/compile-cse.test.ts (13)
- test/compute-engine/compile-derivative.test.ts (3)
- test/compute-engine/compile-fallback-absent-spelling.test.ts (20)
- test/compute-engine/compile-glsl-structures.test.ts (3)
- test/compute-engine/compile-glsl.test.ts (3)
- test/compute-engine/compile-gpu-complex-signatures.test.ts (4)
- test/compute-engine/compile-gpu-emission-fixes.test.ts (1)
- test/compute-engine/compile-gpu-extremum.test.ts (1)
- test/compute-engine/compile-integer-range-guard.test.ts (8)
- test/compute-engine/compile-integrate.test.ts (2)
- test/compute-engine/compile-interval-constant-list.test.ts (1)
- test/compute-engine/compile-interval-integrate.test.ts (1)
- test/compute-engine/compile-interval-js.test.ts (8)
- test/compute-engine/compile-list-element-unknown-arith.test.ts (1)
- test/compute-engine/compile-mode-plumbing.test.ts (1)
- test/compute-engine/compile-plugin.test.ts (1)
- test/compute-engine/compile-pole-boundary.test.ts (1)
- test/compute-engine/compile-preamble-hoist.test.ts (2)
- test/compute-engine/compile-provable-kind.test.ts (2)
- test/compute-engine/compile-python-absent-input.test.ts (1)
- test/compute-engine/compile-references.test.ts (3)
- test/compute-engine/compile-restricted-point.test.ts (14)
- test/compute-engine/compile-shared-binder-body.test.ts (2)
- test/compute-engine/compile-string-operations.test.ts (2)
- test/compute-engine/compile-three-valued-connectives.test.ts (1)
- test/compute-engine/compile.test.ts (4)
- test/compute-engine/conjugate-function.test.ts (1)
- test/compute-engine/declared-parameter-undecided.test.ts (1)
- test/compute-engine/declared-result-memo.test.ts (1)
- test/compute-engine/declared-type-unknown-value.test.ts (2)
- test/compute-engine/degrees-angular-unit.test.ts (1)
- test/compute-engine/derivatives.test.ts (1)
- test/compute-engine/design-e-compatibility.test.ts (1)
- test/compute-engine/differential-equations.test.ts (4)
- test/compute-engine/effects-call-boundary.test.ts (2)
- test/compute-engine/error-model-combinatorics.test.ts (1)
- test/compute-engine/error-model-distributions.test.ts (1)
- test/compute-engine/error-model-linear-algebra.test.ts (3)
- test/compute-engine/error-model.test.ts (3)
- test/compute-engine/fact-store-phase2.test.ts (1)
- test/compute-engine/factor.test.ts (1)
- test/compute-engine/first-boxing-determinism.test.ts (2)
- test/compute-engine/fractals.test.ts (3)
- test/compute-engine/generic-signature-inference.test.ts (3)
- test/compute-engine/inert-pointlist-projection.test.ts (1)
- test/compute-engine/inference-provenance.test.ts (4)
- test/compute-engine/inference-type-refresh.test.ts (3)
- test/compute-engine/internals/assume-extended.test.ts (3)
- test/compute-engine/internals/query-hooks.test.ts (2)
- test/compute-engine/inverse-trig-large-arguments.test.ts (1)
- test/compute-engine/item-395-composition.test.ts (1)
- test/compute-engine/join-scalar-operand.test.ts (1)
- test/compute-engine/juxtaposition-application.test.ts (1)
- test/compute-engine/juxtaposition-narrows-type.test.ts (6)
- test/compute-engine/latex-syntax/lenient-ambiguity-c.test.ts (1)
- test/compute-engine/latex-syntax/matchfix.test.ts (5)
- test/compute-engine/latex-syntax/operators.test.ts (1)
- test/compute-engine/latex-syntax/parsing.test.ts (1)
- test/compute-engine/lattice-phase0.test.ts (1)
- test/compute-engine/match-compile.test.ts (13)
- test/compute-engine/matrix-negative-power.test.ts (2)
- test/compute-engine/matrix-operator-typing.test.ts (9)
- test/compute-engine/matrix-unknown-factor-order.test.ts (2)
- test/compute-engine/missing-value.test.ts (2)
- test/compute-engine/nested-broadcast-symbol-type.test.ts (1)
- test/compute-engine/overload-resolution.test.ts (4)
- test/compute-engine/overload-trials.test.ts (4)
- test/compute-engine/parameter-index-read-inference.test.ts (12)
- test/compute-engine/partly-annotated-function-validation.test.ts (1)
- test/compute-engine/placeholder-element-refinement.test.ts (2)
- test/compute-engine/point-accessor-empty-list.test.ts (1)
- test/compute-engine/quantity-kind.test.ts (1)
- test/compute-engine/random-compile.test.ts (1)
- test/compute-engine/redeclare-arithmetic-copy.test.ts (1)
- test/compute-engine/resolve-symbol-facts.test.ts (7)
- test/compute-engine/rule-purpose.test.ts (1)
- test/compute-engine/scalar-factor-and-captured-symbol-type.test.ts (1)
- test/compute-engine/serialization.test.ts (1)
- test/compute-engine/simplify.test.ts (2)
- test/compute-engine/single-uppercase-declared-type.test.ts (1)
- test/compute-engine/speculative-parse.test.ts (1)
- test/compute-engine/spread-literal-result-kind.test.ts (6)
- test/compute-engine/threads-conditionals.test.ts (1)
- test/compute-engine/tycho-321-add-unknown-collection.test.ts (5)
- test/compute-engine/tycho-item-224-gpu-vector-factor-precedence.test.ts (1)
- test/compute-engine/tycho-item-238-compiled-pointx-over-undecided-operand.test.ts (1)
- test/compute-engine/tycho-item-258-gather-element-refinement.test.ts (3)
- test/compute-engine/type-variables-arithmetic.test.ts (1)
- test/compute-engine/type-variables-core.test.ts (2)
- test/compute-engine/type-variables-linalg.test.ts (1)
- test/compute-engine/type-variables.test.ts (1)
- test/compute-engine/undefined-numeric-slot.test.ts (2)
- test/compute-engine/unknown-inference-marker.test.ts (1)
- test/compute-engine/unknown-operand-cells.test.ts (1)
- test/compute-engine/use-driven-element-inference.test.ts (18)
- test/compute-engine/use-narrowing-evidence-guard.test.ts (3)
- test/compute-engine/valueless-collection-typed-operand.test.ts (1)
- test/compute-engine/whole-collection-parameter.test.ts (1)

### OLD-MECH (43 tests, 16 files)
- test/compute-engine/any-typed-symbol-arithmetic-typing.test.ts (1)
- test/compute-engine/binding-units-commit.test.ts (1)
- test/compute-engine/binding-units-core.test.ts (1)
- test/compute-engine/ce-36-scratch-widening-in-computation.test.ts (1)
- test/compute-engine/effects-provenance.test.ts (2)
- test/compute-engine/fact-store-phase3-regression.test.ts (6)
- test/compute-engine/inference-provenance.test.ts (7)
- test/compute-engine/inference-rollback.test.ts (11)
- test/compute-engine/library-bootstrap-no-leaked-symbols.test.ts (1)
- test/compute-engine/parse-diagnostics.test.ts (1)
- test/compute-engine/parse-scope-control.test.ts (3)
- test/compute-engine/scope.test.ts (1)
- test/compute-engine/speculative-parse.test.ts (3)
- test/compute-engine/use-driven-element-inference.test.ts (1)
- test/epsil/provenance-note.test.ts (1)
- test/epsil/static-check-rollback.test.ts (2)

### UNCLASSIFIED (32 tests, 25 files)
- test/compute-engine/append-variadic.test.ts (2)
- test/compute-engine/call-follows-function-reassignment.test.ts (2)
- test/compute-engine/call-identity-is-same-and-match.test.ts (1)
- test/compute-engine/ce-139-derivative-enclosing-binding.test.ts (2)
- test/compute-engine/ce-623-compiled-integral-keeps-parameter-e.test.ts (1)
- test/compute-engine/compile-block-locals-rules.test.ts (1)
- test/compute-engine/compile-glsl-fragment.test.ts (3)
- test/compute-engine/compile-integrate-starting-panels.test.ts (1)
- test/compute-engine/compile-interval-sub.test.ts (1)
- test/compute-engine/compile-references.test.ts (2)
- test/compute-engine/derivative-closed-form-cache.test.ts (1)
- test/compute-engine/ellipsis-product-coefficient.test.ts (1)
- test/compute-engine/evaluate-at-compile-derivative.test.ts (1)
- test/compute-engine/fact-store-phase2.test.ts (1)
- test/compute-engine/functions.test.ts (1)
- test/compute-engine/juxtaposition-application.test.ts (1)
- test/compute-engine/latex-syntax/logic.test.ts (1)
- test/compute-engine/latex-syntax/script-order.test.ts (1)
- test/compute-engine/map-fusion.test.ts (1)
- test/compute-engine/simplify-tycho-audit.test.ts (1)
- test/compute-engine/solve-domain.test.ts (1)
- test/compute-engine/tycho-row-426-apply-lambda-type.test.ts (2)
- test/compute-engine/undeclare.test.ts (1)
- test/epsil/function-declaration-hoisting.test.ts (1)
- test/epsil/generic-function-sugar.test.ts (1)

### BC-LOOKUP (32 tests, 15 files)
- test/compute-engine/assumptions.test.ts (3)
- test/compute-engine/builtin-name-value-binding.test.ts (1)
- test/compute-engine/canonical-form.test.ts (1)
- test/compute-engine/ce-473-captured-free-symbol.test.ts (5)
- test/compute-engine/ce-597-unknowns-library-letter-operand.test.ts (1)
- test/compute-engine/ce-622-subs-keeps-call-binding.test.ts (1)
- test/compute-engine/compile-entry-string-refusal.test.ts (2)
- test/compute-engine/effects-contracts.test.ts (1)
- test/compute-engine/fact-store-phase3-writes.test.ts (1)
- test/compute-engine/juxtaposition-application.test.ts (1)
- test/compute-engine/parse-scope-control.test.ts (10)
- test/compute-engine/resolve-symbol-facts.test.ts (2)
- test/compute-engine/solve-periodic-families.test.ts (1)
- test/compute-engine/tycho-item-336-nested-signature-derivation.test.ts (1)
- test/compute-engine/unknowns-scoped-library-letter.test.ts (1)

### DEF-ADMIT-OCC (19 tests, 9 files)
- test/compute-engine/calculus.test.ts (1)
- test/compute-engine/ce-575-compile-shader-stage-struct-and-free-symbols.test.ts (2)
- test/compute-engine/compile-assigned-symbol.test.ts (4)
- test/compute-engine/compile-cse.test.ts (1)
- test/compute-engine/compile-fold-shared-values.test.ts (6)
- test/compute-engine/compile-fold-size-guard.test.ts (1)
- test/compute-engine/compile-gpu-user-functions.test.ts (1)
- test/compute-engine/compile.test.ts (1)
- test/compute-engine/scoping-rulings-0921.test.ts (2)

### DEF-EPSIL-PIN (17 tests, 2 files)
- test/epsil/execute.test.ts (4)
- test/epsil/static-lambda-callee-arguments.test.ts (13)

### DEF-MATRIX-REPAIR (17 tests, 4 files)
- test/compute-engine/matrix-operator-typing.test.ts (8)
- test/compute-engine/tycho-321-add-unknown-collection.test.ts (7)
- test/compute-engine/tycho-item-336-nested-signature-derivation.test.ts (1)
- test/compute-engine/type-soundness-regressions.test.ts (1)

### DEF-FREE-CALL-TYPE (16 tests, 5 files)
- test/compute-engine/ce-1150-static-shape.test.ts (2)
- test/compute-engine/ce-772-block-local-function-call-type.test.ts (1)
- test/compute-engine/elementwise-which.test.ts (11)
- test/compute-engine/tycho-item-167-broadcast-count.test.ts (1)
- test/compute-engine/type-relation-gaps.test.ts (1)

### DEF-LIMIT-FREE-PARAM (12 tests, 3 files)
- test/compute-engine/divide-by-zero-symbolic-numerator.test.ts (1)
- test/compute-engine/integrate-symbolic-pole.test.ts (1)
- test/compute-engine/mathematica-heads-nsolve-table-limit.test.ts (10)

### DEF-NESTED-WRITES (10 tests, 3 files)
- test/compute-engine/compile-integrate-timeout-record.test.ts (6)
- test/epsil/cli-workers.test.ts (3)
- test/epsil/documentation.test.ts (1)

### DEF-OPTOKEN (9 tests, 5 files)
- test/compute-engine/ce-661-point-family-count-at.test.ts (1)
- test/compute-engine/eager-collection-enumerability.test.ts (1)
- test/compute-engine/effects-of.test.ts (1)
- test/compute-engine/tycho-row-424-derivative-no-closed-form-cache.test.ts (5)
- test/compute-engine/user-function-purity.test.ts (1)

### BC-LIBVAR (8 tests, 3 files)
- test/compute-engine/builtin-name-value-binding.test.ts (1)
- test/compute-engine/compile-integrate.test.ts (6)
- test/compute-engine/unapplied-operator-fallback.test.ts (1)

### DEF-FREE-HOME-SCOPE (8 tests, 4 files)
- test/compute-engine/ce-614-integral-keeps-call-binding.test.ts (2)
- test/compute-engine/debug-bindings-scope-copies.test.ts (2)
- test/compute-engine/explain.test.ts (3)
- test/compute-engine/solve-root-checks.test.ts (1)

### DEF-WITHVALUES (7 tests, 2 files)
- test/compute-engine/ce-1102-provisional-registry-weak-references.test.ts (1)
- test/compute-engine/with-values.test.ts (6)

### DEF-TARGET-NO-OP (7 tests, 1 files)
- test/compute-engine/compile-gpu-user-functions.test.ts (7)

### DEF-FREE-HEAD-D (7 tests, 1 files)
- test/compute-engine/ce-824-call-head-data-symbol.test.ts (7)

### DEF-BINDER-SUBST-FREE (7 tests, 1 files)
- test/compute-engine/apply-binder-variable-argument.test.ts (7)

### DEF-CAPTURE-FREE (7 tests, 1 files)
- test/compute-engine/ce-473-captured-free-symbol.test.ts (7)

### DEF-FREE-NAME-CAPTURE (6 tests, 3 files)
- test/compute-engine/comprehension-memo.test.ts (2)
- test/compute-engine/symbol-value-scoping.test.ts (2)
- test/compute-engine/user-function-last-statement-numeric-request.test.ts (2)

### DEF-LISTREC-SELFREF (4 tests, 1 files)
- test/compute-engine/ce-579-list-recursion-loop.test.ts (4)

### DEF-BLOCK-LOCAL-CALL (4 tests, 1 files)
- test/compute-engine/gpu-point-complex-component.test.ts (4)

### DEF-DYNAMIC-RESOLUTION (4 tests, 4 files)
- test/compute-engine/callable-evaluation-binding.test.ts (1)
- test/compute-engine/ce-712-2-variant-result-type.test.ts (1)
- test/compute-engine/lazy-view-scope.test.ts (1)
- test/compute-engine/tycho-row-426-apply-lambda-type.test.ts (1)

### DEF-FREE-BOUND-SAME (4 tests, 2 files)
- test/compute-engine/issue-489-curried-function-capture.test.ts (3)
- test/compute-engine/latex-syntax/matchfix.test.ts (1)

### BC-HELD (4 tests, 3 files)
- test/compute-engine/ce-586-disposed-definition-inert.test.ts (1)
- test/compute-engine/fact-store-phase2.test.ts (2)
- test/compute-engine/protocol-property-effects.test.ts (1)

### DEF-ENVDEPS (3 tests, 1 files)
- test/compute-engine/d-node-derivative-memo.test.ts (3)

### DEF-MEMO-STORED (3 tests, 1 files)
- test/compute-engine/comprehension-memo.test.ts (3)

### DEF-RECURSION (2 tests, 2 files)
- test/compute-engine/ce-604-list-route-keeps-call.test.ts (1)
- test/compute-engine/recursive-lazy-callback.test.ts (1)

### DEF-DESTRUCTURE-LET (2 tests, 2 files)
- test/compute-engine/use-narrowing-evidence-guard.test.ts (1)
- test/epsil/programs.test.ts (1)

### DEF-INTEGRATE-POLE (2 tests, 1 files)
- test/compute-engine/integrate-pole-proofs.test.ts (2)

### DEF-DECLUNKNOWN-TYPE (2 tests, 2 files)
- test/compute-engine/accessor-proven-length-type.test.ts (1)
- test/compute-engine/broadcast-call-typing-soundness.test.ts (1)

### DEF-ENUM-FREENAME (2 tests, 1 files)
- test/compute-engine/broadcast-enumerability.test.ts (2)

### BC-NARROWINGS (2 tests, 1 files)
- test/compute-engine/parse-scope-control.test.ts (2)

### DEF-LIB-AUTODECL (1 tests, 1 files)
- test/compute-engine/collections.test.ts (1)

### DEF-TELESCOPE (1 tests, 1 files)
- test/compute-engine/wester.test.ts (1)

### NEW (1 tests, 1 files)
- test/epsil/formatter.test.ts (1)

### DEF-FIRST-ASSIGN-FREE (1 tests, 1 files)
- test/compute-engine/block-scope-shadowing.test.ts (1)

### DEF-STACK (1 tests, 1 files)
- test/compute-engine/lazy-collection-regimes.test.ts (1)

### BC-RULE4 (1 tests, 1 files)
- test/compute-engine/type-variables-arithmetic.test.ts (1)

### DEF-RSOLVE-NOTCANON (1 tests, 1 files)
- test/compute-engine/recurrences.test.ts (1)

### DEF-SYMBOL-LITERAL-INPUT (1 tests, 1 files)
- test/compute-engine/function-values-rules.test.ts (1)

### DEF-EPSIL-PARAM-NAMES (1 tests, 1 files)
- test/compute-engine/ce-60-inferred-parameter-names.test.ts (1)

### BC-RULE7 (1 tests, 1 files)
- test/compute-engine/ce-107-function-literal-free-name-is-same.test.ts (1)
