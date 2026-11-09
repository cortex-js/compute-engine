# JavaScript fragment function and local bindings

The internal `ScalarFragmentJavaScriptTarget` now extends the [initial scalar slice](2026-11-09-js-fragment-slice.md) to a top-level function with explicitly typed scalar parameters and one initialized, explicitly typed local. Its straight-line assignments keep the local's representation fixed. The existing JavaScript emitter and runner remain responsible for execution; no public target or profile is added.

## Binding and annotation contract

The existing root-function entry point authorizes the exact prepared body and parameter target. The block entry point authorizes the exact child scope and local target. Each target has its own policy snapshot. A copied target that changes its bindings or variable mapping without this authorization still fails.

The shared fragment pass records value facts in the appropriate scope. Declarations and assignments have separate membership checks because the pass does not store them as value facts. Emission may use only the exact prepared statements and nodes; it cannot search other scopes for a conveniently matching expression.

Inside the bound body, Add and Negate obtain their result representation from operand facts. This avoids using an initializer's value or sign to decide how a mutable local will be read later. Sqrt inside a bound body remains unsupported pending a scoped numeric policy. The existing scalar-root Sqrt behavior is unchanged.

## Representative fixture

The fixture adapts the four scalar neighbor values summed in Tycho's `src/graph-paper/onboarding/showcase-heat.js`, in `heatstep`. Its explicit accumulator and local type are additions for this experiment:

```epsil
function neighborSum(w: real, e: real, n: real, s: real) -> real {
  let total: real = w
  total = total + e
  total = total + n
  total = total + s
  total
}
```

The tests construct the equivalent typed MathJSON. Expected values are 10 for (1,2,3,4), 2 for (-2,0,3,1), and 0 for zeros. Repeated calls must initialize a new total; stored outer numeric bindings named `w` or `total` must remain unchanged and must not supply the local's value. Repeated identical additions across writes must read the updated local with CSE on or off.

This is a reduced arithmetic and binding fixture. Actual heatstep reads and updates a 1,024-cell collection, handles walls and boundaries, and applies a diffusion coefficient. This extension does not compile or validate that whole showcase.

## Deliberate limits

The admitted body has one explicit declaration, writes only that local, and finishes with a scalar value. It supports Add, Negate and three-operand If over the admitted parameters/local and literals. Named helper calls, captures, nested blocks/functions, loops, implicit locals, parameter writes, destructuring and defaults remain unsupported. Each assignment must preserve representation; a real initializer for an explicitly complex local is also declined in this slice rather than introducing a binding conversion.

A shadowing case that causes the existing emitter to synthesize an additional broadcast scope is rejected by the policy check. The extension does not authorize such a scope merely because its output might be scalar. These limits apply to the internal experiment, not to the traditional JavaScript target or a public numeric profile.

## Consequence for the migration

Scoped annotations and explicit scope handoffs suffice for this straight-line mutable-local case. It needs neither CPS nor SSA. This does not yet establish that richer value analysis, loops, captures or reusable prepared artifacts can use the same rules without further work.

## Validation

The patch was reconciled onto committed `5cbe77f90` before review, including the intervening GLSL and formatting changes. Validation on that isolated tree passed:

- Five focused suites: 264 tests, including 34 new binding tests and the original 102 scalar tests. The remaining suites cover block scalar facts, typed function literals and local rules.
- Core set: 18 suites, 5,518 passing tests, 15 existing skips and 1,368 unchanged snapshots.
- Full typechecking, dependency-cycle check, changed-source lint and AST trap scan.

The two fragment suites also passed in the shared checkout (136 tests), with unchanged source/test/data fingerprints. The note's Epsil example was separately executed through the interpreter and returned 10, 2 and 0 without diagnostics. No snapshots were changed. One older issue was added as [CE-1182](../../issues/CE-1182.md): an outer list can cause unnecessary runtime broadcasting for a scalar local. No issues were removed. The issue is in legacy broadcast selection, which this extension does not rewrite.

The committed-baseline nightly run at `a7feec000` failed in the provisional-registry weak-reference test and two Fungrim tests. It did not contain this extension. No cause investigation or unrelated repair was performed as part of this work.

A corpus run, timing benchmark and Tycho browser run were omitted because this change tests a narrow internal binding boundary. It makes no performance or full-showcase parity claim.

Both independent code reviews passed the implementation. Two comment clarifications required no behavior change. The shared-checkout typecheck passed with unchanged fingerprints on retry; the first successful run was discarded because files changed during it. The final source set was also typechecked in isolation at `14e279a45` after the unrelated Fungrim commit.
