# Named scalar calls in the JavaScript fragment target

The internal JavaScript fragment target can now annotate scalar expressions that call one resolved named helper. This extends the [function and local binding slice](2026-11-09-js-fragment-bindings.md) through the existing JavaScript function registry; it does not register a new public target or profile.

## What the boundary proves

Admission resolves the call's bound definition and function literal, checks their agreement with the existing compiler's resolution, and retains the exact canonical body. The fragment pass types the body and its calls together through `functionOf`. A declared return representation must agree with the body facts, and each argument must already have its parameter's representation.

When the existing compiler prepares the emitted definition, an internal handoff checks the literal, body and helper name against that record. It selects the function's annotation scope and records the target's binding policy. A body rewrite or specialization that changes the identity is refused. This deliberately uses no persistent cache and does not assume that repeated preparation returns an equivalent expression.

A pure function body has a single-expression Block wrapper. The compiler's existing block-unwrapping path now authorizes the exact inner annotation scope before compiling that expression. It does not search other scopes for matching facts. The existing call emitter consumes the annotated argument conversions; legacy targets without an artifact use their existing behavior.

## Representative program

The reduced heat-neighbor fixture now exercises a named call:

```epsil
function neighborSum(a: real, b: real, c: real, d: real) -> real {
  a + b + c + d
}
neighborSum(1, 2, 3, 4)
```

The compiler tests use free scalar inputs to ensure the call is emitted rather than folded away. The existing route emits a named `_fn_neighborSum` definition and calls it with those inputs. The expected result for 1,2,3,4 is 10. This remains an arithmetic fixture inspired by Tycho's heat prelude, not support for its complete collection-based grid update.

## Scope and limits

The helper has explicit scalar parameter types and one pure expression built from Add, Negate and three-operand If. Its body may read its parameters and literals only. Calls may appear in the existing scalar root expression and may repeat or nest calls to the same resolved helper. This does not yet compose named calls with the separate root-function accumulator grammar.

Captures, helper-local writes, calls from within the helper body, recursion, default/rest parameters, generic specialization, collection arguments and bound-body Sqrt remain unsupported. Argument promotions and incompatible declared return representations also decline. Ordinary JavaScript compilation retains its existing support for these forms.

This establishes another scope and identity boundary using structured expressions and side tables. It does not require CPS or SSA, and it makes no performance claim. Captured plot callbacks and collection consumers remain later work.

## Validation

The implementation and validation tree is based on `c109b7fc9`, whose committed full-suite run already passed. The source copied into the shared checkout was compared byte for byte with the isolated tree.

- All three fragment suites passed: 172 tests, including 36 new named-call tests.
- The named-call suite and selected definition-scope, parameter-shadowing, last-call-memo and Epsil declared-function regressions passed: 117 tests. This count overlaps the 172-test run.
- The core set passed: 18 suites, 5,518 tests, 15 existing skips and 1,368 unchanged snapshots.
- Full typechecking, dependency-cycle checking, changed-source lint and the AST trap scan passed.
- The 36 new tests also passed in the shared checkout with identical before/after source fingerprints.
- The Epsil example above returned 10 through the interpreter with no diagnostics. Tests additionally check independent numeric results, complex results, repeated calls sharing one definition, renamed parameters, definition replacement, and rejected identity/scope/convention mismatches.

The ownership layer consumes a minimal readonly structural view of the real annotation. This keeps the emitter hooks independent of the fragment walker's preparation dependencies; the real producer is checked structurally by TypeScript. Initial validation found a dependency cycle and a type-narrowing error, both fixed before review.

No snapshots changed, no issues were added or removed, and the issue ledger lint passed. No legacy reader implementation was removed. A broad corpus run, benchmark and Tycho browser run were omitted because this is an internal call-boundary migration, not a claim of public target parity or faster execution. Public API documentation and target registration are unchanged.

Independent Codex and Claude reviews passed without findings. The final staged source/test set is compared with the isolated validated tree; review required no source changes.
