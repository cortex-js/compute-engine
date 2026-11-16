# Claude review of the later corrective delta

Status: findings recorded; corrected-delta verification pending.

**Recommendation: do not land yet.** One finding is a real regression and is a one-line fix. The other two are P3 comment fixes. I found no regression in any of the other items you listed.

This was a static read only. I used 9 of the 10 allowed Read/Grep calls and ran no tests or builds. I could not show a REVIEW-CHECKLIST import cycle for the new imports with targeted greps, but `check:deps` is not in the gates you listed, so it should run before staging.

## Findings

**1. P2, introduced: `Pi/Pi` no longer canonicalizes to `1`.**
`src/compute-engine/boxed-expression/arithmetic-mul-div.ts:1784-1789` and `:1898`.
- The flag `op2IsConstantExpression` was already `true` for a divisor that is a library or user constant with no unknowns (`Pi`, `ExponentialE`, `GoldenRatio`, a declared `const c = 3`). The comment at `:1778-1783` says so.
- The delta adds `&& !op2IsConstantExpression` to the symbol rule `c/c = 1` at `:1893-1900`, which used to take exactly those cases.
- Those divisions now fall through to `:1909` and stay as a structural `Divide`.
- **Expected:** `ce.parse('\\frac{\\pi}{\\pi}')` gives `1`, and so does `e/e`, or `c/c` for a declared constant `c`.
- **Actual:** it stays `π/π`.
- No test pins `Divide(Pi, Pi)`; I searched `test/` and found none, which is why the suites still pass.
- **Fix:** compute the new block-local test as its own boolean and add only that one to the guard at `:1898`, so `op2IsConstantExpression` keeps its old meaning:

  ```ts
  const op2HasBlockLocal = op2.unknowns.length > 0 && op2.symbols.some(…_blockLocal…);
  const op2IsConstantExpression = !isNumber(op2) && (op2.unknowns.length === 0 || op2HasBlockLocal);
  // :1898
  op1.isConstant && !op2HasBlockLocal
  ```

  Add a test with `Pi/Pi` and a declared-constant `c/c`.

**2. P3, introduced (convention): `assertAssignable` lost its documentation comment.**
`src/compute-engine/engine-declarations.ts` at about line 4808.
- The new `assertDeclarationName` and its `/** Refuse global shadowing… */` comment were inserted between `assertAssignable`'s existing JSDoc block and `export function assertAssignable`.
- The long comment now sits on the wrong function, and `assertAssignable` is undocumented. Its return type also changed in this delta (`'match' | 'overlap' | undefined`), and nothing documents that either.
- There is also a stray blank line before the closing `}` of `assertDeclarationName`.
- **Fix:** move `assertDeclarationName` and its comment above the old JSDoc block, and add one sentence on the new return value.

**3. P3, introduced (stale comment):** `src/compute-engine/library/core.ts` at about line 5212, in the second declaration statement.
- It still says "the identical rule (and the identical static-pre-pass surrogate exemption) as `declareTypeStatement`; see its comment".
- The delta deleted that comment and the surrogate exemption. `notAtTopLevel` now exempts only `isProgramStatement()`.
- **Fix:** replace it with a pointer to `notAtTopLevel`.

## What I checked and found no regression in

- **Order of admission against canonical order** (`control-structures.ts:4337-4347`):
  - `ops` holds the same objects as `source`, only reordered, so a refusal recorded while walking `source` matches the statement later.
  - Pairing a signature with its function works in both source orders: `let f: sig` before `function f`, and `function f` before `let f: sig`.
  - Clearing `functions` after admission happens after `rank` has already sorted the statements, so it only affects the metadata passes.
- **The WeakMaps keyed on the `Declare` target** (`PROGRAM_WRITES` and the new prior-declaration map):
  - Only a fixed set of names is shared between expressions (`Pi`, `True`, `Nothing`, …; see `index.ts:601`).
  - Those names are either filtered out (`Nothing`) or refused by `assertDeclarationName`.
  - A user name gets its own object, so one entry cannot leak to another statement.
- **Rollback in `declareSteps`:** the `forgetConstantDeclaration` call during rollback only removes a pending constant mark (`parameter-defaults.ts:398-406`). It does nothing to an incumbent that has already run, so the rollback of tuples and interleaved writes is intact.
- **The shared clause-redefinition message:** `clauseRedefinitionMessage` produces the same text as the old `firstSite` (`declaration-origin.ts:195-199`). The runtime message does not change.
- **Out of scope, not filed:** one older item that the delta does not touch.
