# Capture-avoiding `subs()` (ROADMAP CE-692)

User decision 2026-10-30: `Expression.subs()` becomes capture-avoiding. This
spec states the new contract, the decision for the binders that cannot be
renamed before evaluation (§2), and the steps.
It must wait until the fix for GitHub issue #489 is committed, because it
reuses that fix's renaming code.

## 1. The contract today and after the change

`subs()` replaces the FREE occurrences of names (documentation of `subs()` in
`src/compute-engine/types-expression.ts`). It already skips a name where a
binder binds it. It does not avoid capture: when a replacement contains a free
name that an inner binder binds, the replacement is inserted as it is.

| Input | Today | After |
| --- | --- | --- |
| `Sum(j + k, Limits(k, 1, 3)).subs({j: k})` | `Sum(k + k, …)` = `12` | `Sum(k + k_1, Limits(k_1, 1, 3))` = `3k + 6` |
| `Function(Power(y, x), x).subs({y: x})` | `x ↦ x^x` | `x_1 ↦ x^(x_1)` |
| `Sum(j, Limits(j, 1, 3)).subs({j: 5})` | unchanged | unchanged |
| `D(x^2, x).subs({x: 3})` | `EvaluateAt(…, 3)` = `6` | same |

The new rule: before a replacement goes below a binder, each bound name of that
binder that is free in the replacement is renamed to a fresh name (`<name>_<i>`,
not used in the expression or in the replacements). A binder with no such name
does not change, and keeps its node identity. So an expression without a
collision gives the same result as today.

After a rename, a named argument of a renamed `Function` parameter must use the
new name (the same rule as function application, decision 2026-10-30 on #489).

`replace()` does not change: it rewrites structure and does not respect
binders. Its documentation will say why a rule whose match is a symbol gives a
different result from `subs()` below a binder.

## 2. Binders whose bound names are not known from structure

Two binders cannot be renamed correctly before evaluation:

- An `Assign` in a `Block` that is not canonical (held): it makes a new local
  only when the name is not declared outside the block at the time the block is
  evaluated. Example: with `s` declared, `Hold(Block(s := 3, y + s))` with `y`
  replaced by `s` must keep `s := 3` as a write of the declared `s`.
- A `Declare` inside an `If` branch (or another operand without its own
  scope): the later reads denote the local only when that branch runs.

Function application stays unevaluated in these cases. `subs()` must return an
expression, so it needs another answer. Options:

- **(a) Insert the replacement as today** in these cases only, and document
  them with the examples above. The result can be wrong (the capture), but only
  in these two cases, which are rare and already wrong today. An internal
  variant (`subsIfCaptureFree()` or an option) returns `undefined` instead, so
  that an internal caller can decline as it does today.
- **(b) Rename anyway.** For a held block, this can turn a write of an outer
  variable into a write of a new local: a wrong result in a case that today is
  right when the names do not collide.
- **(c) Throw an error.** No wrong value, but a call that works today can throw
  where it gave a captured result.

User decision 2026-10-30: **(a)**. It is never worse than today, and internal
callers keep a way to refuse.

## 3. Steps

1. Move the renaming code of the #489 fix (`renameBoundVariables()` and its
   helpers in `function-utils.ts`) to a module that `boxed-function.ts` can
   import without a cycle, for example next to `rewriteWithBinders()` in
   `src/compute-engine/boxed-expression/binders.ts`.
2. Use it in `BoxedFunction.subs()` (`boxed-function.ts`): at each operand
   where a binder of the node is in scope, rename the colliding names first.
   Add the internal variant of option (a).
3. Update the documentation of `subs()` and `replace()` in
   `types-expression.ts`, and the CHANGELOG.
4. Remove the capture checks of the internal callers, one caller at a time,
   each with a test of the case that it declined before. The callers whose
   comments say that `subs` is not capture-avoiding: `library/utils.ts`
   (`degenerateBigOpTerm()`), `library/calculus.ts`, `symbolic/derivative.ts`,
   `function-utils.ts`, `compilation/compile-user-calls.ts`,
   `compilation/gpu-shared-calls.ts`, `compilation/compile-cse.ts`,
   `compilation/gpu-functions.ts`, `compilation/fixed-width-unroll.ts`. Report
   per compile target the declines removed.
5. Measure and report the changed tests and snapshots. A change in a printed
   result is expected only where names collide.

## 4. Tests

- The four rows of the table in §1, for `Sum`, `Product`, `Integrate` (definite),
  `Comprehension`, a `Function` literal, a destructuring parameter and a
  `Block` local.
- A binder with no collision keeps its identity.
- The two cases of §2, with the result that the chosen option gives.
- Each internal caller of step 4: the case it declined before now gives the
  same value as the interpreter.
