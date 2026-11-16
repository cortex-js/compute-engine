# Claude final corrective-delta verification

I found no regressions introduced by this delta. I recommend accepting it, with one unchecked risk below for the core/full/editor runs to settle. I ran no tests and made no edits.

**What I checked**
- **The quotient guard** (`arithmetic-mul-div.ts:1784-1789`, `:1898`): the `x/x → 1` rule now tests `!op2HasBlockLocal`, and that test does not depend on `unknowns`. So `Pi`, `ExponentialE`, `GoldenRatio` and a constant the host declares go back to `1`, and a Program `let`/`const` zero alias still stays out of the rule. The other guard, against cancelling constant expressions like `(1-1)/(1-1)`, uses the same predicate as before.
  - One baseline case is unchanged by this delta: at `85752a2d0`, `ce.declare('z', {value: 0, isConstant: true}); ['Divide','z','z']` already gives `1`, because the baseline rule was only `op1.isConstant`.
- **The error tagging** (`type-compatibility-error.ts:651-680`): the three `where` cases build the same values as before. The WeakMap is filled only at the three Declare catch sites (`core.ts:15441`, `:15499`, `:15517`). The other callers (`core.ts:8080`, `14444`, `14635`, `14646`, `14837`, `function-utils.ts:3812`) pass no target, so an `incompatible-type` from Assign, a nested declaration or a call conversion cannot be taken for the outer refusal.
- **The duplicate check** (`execute-epsil.ts:593-607`): the general rule added by the earlier change is narrowed to three codes, or to the Declare type error on the same `boxedStmt.op1`, and it still needs the same start and end of range. The baseline's own rules after it (`invalid-clause-definition` by start of range, `constant-assignment` by site, redeclaration, marker) are untouched. Narrowing it can only bring a diagnostic back. It cannot hide one that the baseline at `85752a2d0` reported.
- **The diagnostic flow** (`diagnostic-flow.ts:96-128`): `if (!node.isValid) return;` at `:83` still runs first. Without argument facts, only `missing-argument` and `unexpected-argument` are kept, so a call whose arguments carry no facts gets no type-projection report.
- **Comments:** the misplaced `assertAssignable` JSDoc is now directly above `assertAssignable` (`engine-declarations.ts:4808`), and the surrogate comment in `core.ts:5212` is gone.

**Unchecked risk**
In `diagnostic-flow.ts:100-117`, `validateArguments` now runs on every valid call, not only on calls whose arguments carry facts. Named arguments are normalized only when the binding has a `Function` literal (`:88`). So a call with named arguments to a user operator or a signature-typed value with no literal reaches `validateArguments` in its named form. If that form can survive canonicalization, it may now report a false `missing-argument` or `unexpected-argument`. I did not find named-argument handling in `validateArguments` with a grep, and I had no calls left to confirm it either way. A one-line probe settles it: `function g(x: real, y: real) { x + y }; g(y: 1, x: 2); 0`. It should give no diagnostic.

Not a defect: `op2HasBlockLocal` now looks up every symbol on every `Divide` canonicalization, where the previous version looked them up only when `unknowns` was non-empty. That is a small cost on the canonicalization path.

## Coordinator resolution of unchecked items

The named-argument probe and two signature/alias controls all returned0 with no diagnostics; exact sources/results are in `named-arity-review-controls.jsonl`. The unchanged host constant-zero quotient defect was confirmed in both arms and filed as CE-1361. No production correction remains from this review.
