# Program test census before expectation updates

Captured 2026-11-16T03:57:25.595111+00:00. Read-only file/content census; no tests, builds or probes ran for this census.

## Scope and limits

Program spec §6 requires the user to see **which existing tests change**, grouped by its §1 semantic rows, before expectations are moved. This census freezes the populations and records the already-produced focused result. It does **not** treat every failed assertion as an approved expectation change, and it does not replace the pending complete pre-update run and semantic triage. A file that contains two routes is only a co-occurrence candidate; it need not compare their results.

- Historical investigation source: `3938e5938` (`~/dev/compute-engine-recovery/epsil-routes-investigation.md`, §2).
- Task frozen baseline: `ffff1d44fc566ef01fb52a0ce67b6797797f4dcf`.
- Candidate checkout: `/tmp/wt-program-accepted-sol`. Existing tracked CE test files differing from the frozen baseline at census time: **0**. Untracked CE test files: **1**.
- All counts below use files under `test/`, including helpers and snapshots, exactly as the historical literal-search method did. They are not counts of distinct Jest assertions, actual API calls after alias resolution, or failures. Imports/comments alone do not match a literal call token, but authored strings or snapshot text can.

## Exact commands

Run from the main repository for committed inventories:

```sh
git grep -l -F 'executeEpsil(' 3938e5938 -- test
git grep -l -F 'parseEpsil(' 3938e5938 -- test
git grep -l -F '.box(' 3938e5938 -- test
git grep -l -F 'executeEpsil(' ffff1d44fc566ef01fb52a0ce67b6797797f4dcf -- test
```

The historical 49 comparison files are the set intersection of the three historical inventories above: `executeEpsil(` **and** `parseEpsil(` **and** `.box(`. Searching only identifiers/imports gives a different population. Each inventory was generated with `git grep -l -F <literal> <revision> -- test`; candidate inventories use `rg -l --hidden -F <literal> test` in the candidate checkout.

```sh
git -C /tmp/wt-program-accepted-sol diff ffff1d44fc566ef01fb52a0ce67b6797797f4dcf --name-only -- test
git -C /tmp/wt-program-accepted-sol ls-files --others --exclude-standard -- test
```

No output-filtering pipeline is used as evidence of a test exit code; no test was launched. A bounded reproduction snippet for set intersections is preserved below.

## Population counts

| Literal/derived population | Historical | Frozen task baseline | Candidate files |
| --- | ---: | ---: | ---: |
| `executeEpsil(` | 290 | 286 | 287 |
| `executeEpsilAsync(` | 8 | 9 | 10 |
| `executeEpsilSteps(` | 0 | 0 | 0 |
| `checkEpsil(` | 4 | 6 | 6 |
| `checkSource(` | 14 | 14 | 14 |
| `staticDiagnostics(` | 12 | 16 | 17 |
| `parseEpsil(` | 110 | 108 | 109 |
| `.box(` | 1630 | 1665 | 1666 |
| `.compile(` | 170 | 123 | 123 |
| `compile(` | 779 | 764 | 765 |
| execute + parse + box intersection | 49 | 50 | 51 |
| parse + box without sync execute | 29 | 29 | 29 |
| Union of named execute/check/parse consumer files | 333 | 330 | 331 |

The historical investigation separately reported 27 parse-and-box files without an `executeEpsil` identifier. That exclusion used the broader identifier token, rather than the sync call token: `parseEpsil(` ∩ `.box(` minus `executeEpsil` reproduces 27 historically and 27 at the frozen baseline. The 29 above instead excludes only `executeEpsil(` call-token files.

`compile(` and `.compile(` are broad candidate searches, not Program compilation witnesses by themselves. Parsed direct-evaluation/compilation consumers are identified below by co-occurrence. Shared Block/evaluator/boxing changes can affect tests outside these direct source-entry inventories; the full pre-update run owns that wider observation.

## Existing focused execution evidence

Input: `/tmp/program-focused-current.json`, SHA-256 `e59ca5835c59321508ca65aa778107bb75892f16b8ee3f26a63052f83040aa5a`. The census read this existing Jest JSON; it did not rerun the command.
Jest start timestamp: `1794800750336` (2026-11-16T03:45:50.336000+00:00).
Reported totals: **8 suites**, **7 failed suites**, **364 test cases**, **75 failed**, **289 passed**. These are Jest test cases, not numbers of `expect()` calls.

Existing CE expectations were still untouched in the candidate checkout: the tracked `test/` diff was empty. `test/epsil/program.test.ts` is new candidate coverage and is reported separately. These JSON failures are observations of a work-in-progress candidate, not accepted semantic changes or a baseline-failure claim.

| Suite | Test cases | Failed | Existing/new |
| --- | ---: | ---: | --- |
| `test/epsil/static-lambda-callee-arguments.test.ts` | 28 | 8 | existing |
| `test/epsil/compiled-declared-function-type.test.ts` | 29 | 1 | existing |
| `test/epsil/function-declaration-hoisting.test.ts` | 56 | 41 | existing |
| `test/epsil/static-check-rollback.test.ts` | 7 | 1 | existing |
| `test/epsil/program.test.ts` | 30 | 2 | new |
| `test/epsil/provenance-note.test.ts` | 5 | 0 | existing |
| `test/epsil/presence-narrowing.test.ts` | 22 | 1 | existing |
| `test/epsil/execute.test.ts` | 187 | 21 | existing |

Candidate grouping below is a navigation aid based on failed test names. The unclassified/other group must be investigated, and every candidate row needs source/failure review before expectations change. This is not the required final §6 changed-test ledger.

| Candidate semantic area | Failed test cases |
| --- | ---: |
| Variable-type amendment / legacy assignment transitions (triage) | 10 |
| Other existing contract / implementation regression to investigate | 18 |
| §1 row 2 / P7 duplicate declarations (triage) | 2 |
| §1 row 3 / P8 constant writes, plus P2 reordering (triage) | 8 |
| §1 row 5 / P2/P6 type placement/publication (triage) | 5 |
| §1 row 6 / P4–P5 outer-variable writes (triage) | 3 |
| §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) | 29 |

### Every observed failed test case

| Suite | Failed test name | Candidate area |
| --- | --- | --- |
| `test/epsil/static-lambda-callee-arguments.test.ts` | EPSIL STATIC — arguments of a call to a function literal a `const` binding and a `:=` assignment of a literal are checked the same way | §1 row 3 / P8 constant writes, plus P2 reordering (triage) |
| `test/epsil/static-lambda-callee-arguments.test.ts` | EPSIL STATIC — arguments of a call to a function literal an unsaturated call is a partial application, not a missing argument | Other existing contract / implementation regression to investigate |
| `test/epsil/static-lambda-callee-arguments.test.ts` | EPSIL STATIC — arguments of a call to a function literal reassignment mirrors the run time after one replacement the binding keeps the replacement signature | Variable-type amendment / legacy assignment transitions (triage) |
| `test/epsil/static-lambda-callee-arguments.test.ts` | EPSIL STATIC — arguments of a call to a function literal reassignment mirrors the run time a `let` binding reassigned to a non-literal is no longer checked | Variable-type amendment / legacy assignment transitions (triage) |
| `test/epsil/static-lambda-callee-arguments.test.ts` | EPSIL STATIC — arguments of a call to a function literal across cells reassigning a previous cell's binding checks against the NEW literal | Variable-type amendment / legacy assignment transitions (triage) |
| `test/epsil/static-lambda-callee-arguments.test.ts` | EPSIL STATIC — arguments of a call to a function literal across cells an unannotated replacement in the next cell drops the old signature | Variable-type amendment / legacy assignment transitions (triage) |
| `test/epsil/static-lambda-callee-arguments.test.ts` | EPSIL STATIC — arguments of a call to a function literal across cells a second reassignment in the next cell is checked against the first replacement | Variable-type amendment / legacy assignment transitions (triage) |
| `test/epsil/static-lambda-callee-arguments.test.ts` | EPSIL STATIC — arguments of a call to a function literal across cells the pass leaves the engine as it found it | Variable-type amendment / legacy assignment transitions (triage) |
| `test/epsil/compiled-declared-function-type.test.ts` | A `let` DECLARATION THEN A DEFINITION a program compiled as one block declares `g` twice | §1 row 2 / P7 duplicate declarations (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | A CALL BEFORE A FUNCTION STATEMENT RESOLVES WHEN ITS STATEMENT RUNS a single clause | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | A CALL BEFORE A FUNCTION STATEMENT RESOLVES WHEN ITS STATEMENT RUNS a multi-clause definition, called before both clauses | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | A CALL BEFORE A FUNCTION STATEMENT RESOLVES WHEN ITS STATEMENT RUNS a function that a prepared function calls is prepared too | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | A CALL BEFORE A FUNCTION STATEMENT RESOLVES WHEN ITS STATEMENT RUNS a hold function | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE DECLARED SIGNATURE IS KEPT a call in the declared signature | Other existing contract / implementation regression to investigate |
| `test/epsil/function-declaration-hoisting.test.ts` | THE DECLARED SIGNATURE IS KEPT a call before both statements | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE DECLARED SIGNATURE IS KEPT the declared signature does not apply before its `let` runs | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE BINDINGS OF EARLIER STATEMENTS ARE KEPT an earlier assignment with no `let` does not declare the variable | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE BINDINGS OF EARLIER STATEMENTS ARE KEPT a call between the `let` and the function statement | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE BINDINGS OF EARLIER STATEMENTS ARE KEPT a call before the function statement, with a `scope` write | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE BINDINGS OF EARLIER STATEMENTS ARE KEPT a write in a function before the `let` of the name is an error | §1 row 6 / P4–P5 outer-variable writes (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE BINDINGS OF EARLIER STATEMENTS ARE KEPT a `scope` write in a function before the `let` of the name is an error | §1 row 6 / P4–P5 outer-variable writes (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE BINDINGS OF EARLIER STATEMENTS ARE KEPT a `scope` write in a function after the `let` of the name | §1 row 6 / P4–P5 outer-variable writes (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE NAMES THAT A FUNCTION BINDS FOR ITS BODY a parameter with the name of an earlier variable with no static type | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE NAMES THAT A FUNCTION BINDS FOR ITS BODY a local `let` with the name of an earlier variable | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | A LIBRARY CONSTANT AND A VARIABLE OF THE SAME NAME a statement before the `let` reads the constant | §1 row 3 / P8 constant writes, plus P2 reordering (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | A LIBRARY CONSTANT AND A VARIABLE OF THE SAME NAME a body before the `let` reads the constant | §1 row 3 / P8 constant writes, plus P2 reordering (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | A LIBRARY CONSTANT AND A VARIABLE OF THE SAME NAME a call after the `let` of a constant prepares the function | §1 row 3 / P8 constant writes, plus P2 reordering (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | A LIBRARY CONSTANT AND A VARIABLE OF THE SAME NAME a call before the `let` of a constant reads the constant | §1 row 3 / P8 constant writes, plus P2 reordering (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | A HOST BINDING AND A VARIABLE OF THE SAME NAME a call before the `let` reads the host binding in the body | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE SIGNATURE OF A PREPARED FUNCTION HOLDS A CALL BEFORE THE `let` a body that squares the constant `i` | §1 row 3 / P8 constant writes, plus P2 reordering (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE SIGNATURE OF A PREPARED FUNCTION HOLDS A CALL BEFORE THE `let` a body that adds 1 to the constant `i` | §1 row 3 / P8 constant writes, plus P2 reordering (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE SIGNATURE OF A PREPARED FUNCTION HOLDS A CALL BEFORE THE `let` a host binding of another type | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE SIGNATURE OF A PREPARED FUNCTION HOLDS A CALL BEFORE THE `let` a host binding that holds `Nothing` | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE SIGNATURE OF A PREPARED FUNCTION HOLDS A CALL BEFORE THE `let` a host binding of type `unknown` | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE SIGNATURE OF A PREPARED FUNCTION HOLDS A CALL BEFORE THE `let` no call before the `let`: the signature keeps the variable type | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | STATEMENTS THAT ARE NOT HOISTED the constructor of a nominal type runs after its type statement | §1 row 5 / P2/P6 type placement/publication (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | STATEMENTS THAT ARE NOT HOISTED the constructor of a variant of a sum type | §1 row 5 / P2/P6 type placement/publication (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | STATEMENTS THAT ARE NOT HOISTED a function statement for a name that holds a value keeps its error | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | STATEMENTS THAT ARE NOT HOISTED a function statement for a name that an earlier `let` binds | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | STATEMENTS THAT ARE NOT HOISTED a function statement after a type statement | §1 row 5 / P2/P6 type placement/publication (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | STATEMENTS THAT ARE NOT HOISTED a function that uses an earlier variable with no static type | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | STATEMENTS THAT ARE NOT HOISTED a body that reads an earlier dictionary-valued variable | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | STATEMENTS THAT ARE NOT HOISTED a body that uses a variable that two earlier statements write | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | STATEMENTS THAT ARE NOT HOISTED a body that uses a variable that an earlier program declared | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | STATEMENTS THAT ARE NOT HOISTED a body that calls a lambda bound by an earlier `let` | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | STATEMENTS THAT ARE NOT HOISTED a generic function | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | STATEMENTS THAT ARE NOT HOISTED an ordinary clause after a generic function of the same name | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | STATEMENTS THAT ARE NOT HOISTED a `let` of a function literal takes effect when it runs | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | A PROGRAM RUN AGAIN ON THE SAME ENGINE WITH ANOTHER SIGNATURE a preparation that cannot box the statement keeps the earlier binding | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/function-declaration-hoisting.test.ts` | THE COMPILER a call before a function statement | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/static-check-rollback.test.ts` | STATIC CHECK — engine state rolls back a pinned `:=` signature registration is undone | §1 row 5 / P2/P6 type placement/publication (triage) |
| `test/epsil/program.test.ts` | Program publication and compile boundaries type registration is positional in a caller-owned scope | §1 row 5 / P2/P6 type placement/publication (triage) |
| `test/epsil/program.test.ts` | Program publication and compile boundaries direct Program duplicate type declarations fail independently | §1 row 2 / P7 duplicate declarations (triage) |
| `test/epsil/presence-narrowing.test.ts` | the rewrite the check boxes wraps the guarded read only | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — string interpolation the epsil.md headline example | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — static (canonicalization-time) type errors the check does not perturb the session it checks | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — static (canonicalization-time) type errors a repeated check leaves a declared symbol typed as it was | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — structured cancellation cause recursion-depth-exceeded on the final-statement Error value | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — structured cancellation cause iteration-limit-exceeded on the final-statement Error value | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — structured cancellation cause a limit the host assigned is kept, even when it equals the default | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — structured cancellation cause timeout on the final-statement Error value | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — an expired time budget ends the program no statement runs once the budget has expired | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — an expired time budget ends the program a budget spent DURING the static pass keeps the diagnostics found so far | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — pipe-stage sugar a placeholder inside a nested literal does not make an implicit lambda | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — diagnostic anchoring inside a NAMED call an unknown name underlines the argument that used it | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — diagnostic anchoring inside a NAMED call a positional argument after a named one underlines the positional | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — named calls to `:=`-assigned callees (static tier) named call through an annotated declaration is statically clean | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — named calls to `:=`-assigned callees (static tier) a `function` statement over an assigned literal adds a clause | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — named calls to `:=`-assigned callees (static tier) a `function` statement with the same parameter domain replaces the assigned literal | Other existing contract / implementation regression to investigate |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — named calls to `:=`-assigned callees (static tier) an assignment over a `function` statement follows the reassignment rules | Variable-type amendment / legacy assignment transitions (triage) |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — named calls to `:=`-assigned callees (static tier) an assignment over a function of an earlier program follows the reassignment rules | Variable-type amendment / legacy assignment transitions (triage) |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — named calls to `:=`-assigned callees (static tier) a refused assignment over a function of an earlier program leaves its definition | §1 rows 1/7 / P2–P3/P9 ordering, functions, final value (triage) |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — named calls to `:=`-assigned callees (static tier) a `function` statement on a `const` binding leaves the binding | §1 row 3 / P8 constant writes, plus P2 reordering (triage) |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — named calls to `:=`-assigned callees (static tier) reassignment that leaves a bare parameter bare: the inferred type stays | Variable-type amendment / legacy assignment transitions (triage) |
| `test/epsil/execute.test.ts` | EPSIL EXECUTE — named calls to `:=`-assigned callees (static tier) incompatible reassignment: the first names keep working, no false static diagnostics | Variable-type amendment / legacy assignment transitions (triage) |

## Historical 290 sync execute files

290 files.

```text
test/common/type/lexer-comments.test.ts
test/common/type/list-element-tensor-cell.test.ts
test/compute-engine/absence-discharge.test.ts
test/compute-engine/absent-argument-annotated-parameter.test.ts
test/compute-engine/absent-argument-library-default.test.ts
test/compute-engine/annotated-parameter-undecided.test.ts
test/compute-engine/arithmetic-non-numeric-evaluate.test.ts
test/compute-engine/assign-overlap-declared-type.test.ts
test/compute-engine/assignment-stores-lazy-collection.test.ts
test/compute-engine/batch10-async-and-definitions.test.ts
test/compute-engine/binding-units-caches.test.ts
test/compute-engine/binding-units-compile.test.ts
test/compute-engine/binding-units-ops.test.ts
test/compute-engine/block-assign-run-time.test.ts
test/compute-engine/block-assignment-local-per-run.test.ts
test/compute-engine/block-declared-signature-clause.test.ts
test/compute-engine/block-later-declarations.test.ts
test/compute-engine/block-locals-declaration-rules.test.ts
test/compute-engine/block-locals-per-run.test.ts
test/compute-engine/block-scope-capture.test.ts
test/compute-engine/block-scope-shadowing.test.ts
test/compute-engine/broadcast-error-context.test.ts
test/compute-engine/broadcast-lift.test.ts
test/compute-engine/broadcastable-param-declaration.test.ts
test/compute-engine/call-follows-function-reassignment.test.ts
test/compute-engine/callback-arity.test.ts
test/compute-engine/ce-1047-handler-type-error-frame.test.ts
test/compute-engine/ce-108-2-tabulate-error-generator.test.ts
test/compute-engine/ce-1107-gpu-list-input-argument.test.ts
test/compute-engine/ce-1125-impure-element-reads.test.ts
test/compute-engine/ce-1163-pool-loop.test.ts
test/compute-engine/ce-1163-run-async.test.ts
test/compute-engine/ce-1177-glsl-function-body-typed.test.ts
test/compute-engine/ce-122-qualified-call-unknown-protocol.test.ts
test/compute-engine/ce-325-per-call-type-reads.test.ts
test/compute-engine/ce-35-tuple-local-component-alias.test.ts
test/compute-engine/ce-432-sum-compiled-map.test.ts
test/compute-engine/ce-438-latex-cache.test.ts
test/compute-engine/ce-446-map-callback-callee-lexical.test.ts
test/compute-engine/ce-473-captured-free-symbol.test.ts
test/compute-engine/ce-60-inferred-parameter-names.test.ts
test/compute-engine/ce-689-type-cache-across-calls.test.ts
test/compute-engine/ce-827-block-local-type-ignores-same-name-binding.test.ts
test/compute-engine/character-string-operators.test.ts
test/compute-engine/closure-frame-retained.test.ts
test/compute-engine/collection-absent-followups.test.ts
test/compute-engine/collection-element-memo-named-callback.test.ts
test/compute-engine/collection-operator-parameter-inference.test.ts
test/compute-engine/collection-type-followups.test.ts
test/compute-engine/collection-with-failed-cell.test.ts
test/compute-engine/compile-assigned-symbol.test.ts
test/compute-engine/compile-block-locals-rules.test.ts
test/compute-engine/compile-destructuring-from-call.test.ts
test/compute-engine/compile-elseless-if-statement.test.ts
test/compute-engine/compile-free-symbols-binders.test.ts
test/compute-engine/compile-glsl-fragment.test.ts
test/compute-engine/compile-javascript-profile.test.ts
test/compute-engine/compile-javascript-structured-bigint.test.ts
test/compute-engine/compile-javascript-structured-break.test.ts
test/compute-engine/compile-javascript-structured-collections.test.ts
test/compute-engine/compile-javascript-structured-collections2.test.ts
test/compute-engine/compile-javascript-structured-collections3.test.ts
test/compute-engine/compile-javascript-structured-execution.test.ts
test/compute-engine/compile-javascript-structured-functions.test.ts
test/compute-engine/compile-javascript-structured-functions2.test.ts
test/compute-engine/compile-javascript-structured-heat.test.ts
test/compute-engine/compile-javascript-structured-helpers.test.ts
test/compute-engine/compile-javascript-structured-inplace2.test.ts
test/compute-engine/compile-javascript-structured-lists.test.ts
test/compute-engine/compile-javascript-structured-nested.test.ts
test/compute-engine/compile-javascript-structured-nested2.test.ts
test/compute-engine/compile-javascript-structured-random.test.ts
test/compute-engine/compile-javascript-structured-sharing.test.ts
test/compute-engine/compile-mode-strict.test.ts
test/compute-engine/compile-parameter-defaults.test.ts
test/compute-engine/compile-python-string-fail-closed.test.ts
test/compute-engine/compile-references.test.ts
test/compute-engine/compile-scalar-param-direct-call.test.ts
test/compute-engine/compile-string-fail-closed.test.ts
test/compute-engine/compiled-interpreter-agreement.test.ts
test/compute-engine/comprehension-count-finiteness.test.ts
test/compute-engine/comprehension-impure-count.test.ts
test/compute-engine/comprehension-index-function.test.ts
test/compute-engine/constant-function-reassignment.test.ts
test/compute-engine/constant-node-cache-key.test.ts
test/compute-engine/constructor-functions.test.ts
test/compute-engine/declare-destructure.test.ts
test/compute-engine/declare-statement-scope-ceiling.test.ts
test/compute-engine/declared-contract-presence.test.ts
test/compute-engine/declared-parameter-undecided.test.ts
test/compute-engine/declared-result-checked-at-application.test.ts
test/compute-engine/declared-type-unknown-value.test.ts
test/compute-engine/design-d-callback-contract.test.ts
test/compute-engine/design-e-compatibility.test.ts
test/compute-engine/dimension-variables.test.ts
test/compute-engine/effects-contracts.test.ts
test/compute-engine/effects-provenance.test.ts
test/compute-engine/effects-state-label.test.ts
test/compute-engine/error-propagation.test.ts
test/compute-engine/evaluation-order.test.ts
test/compute-engine/exact-results-reference-round.test.ts
test/compute-engine/expected-function-head.test.ts
test/compute-engine/field-accessor.test.ts
test/compute-engine/find-root-fit-result-type.test.ts
test/compute-engine/fixed-point.test.ts
test/compute-engine/function-literal-rest-parameter.test.ts
test/compute-engine/generic-function-literals.test.ts
test/compute-engine/generic-tuple-argument-check.test.ts
test/compute-engine/generic-type-aliases.test.ts
test/compute-engine/group-theory-api.test.ts
test/compute-engine/group-theory-baseline.test.ts
test/compute-engine/group-theory-closure.test.ts
test/compute-engine/group-theory-exact-integration.test.ts
test/compute-engine/group-theory-foundation.test.ts
test/compute-engine/group-theory-maps.test.ts
test/compute-engine/group-theory-orbit-integration.test.ts
test/compute-engine/group-theory-presentation-api.test.ts
test/compute-engine/group-theory-structural-api.test.ts
test/compute-engine/head-tail.test.ts
test/compute-engine/host-function-clause-redefinition.test.ts
test/compute-engine/indeterminate.test.ts
test/compute-engine/integrate-symbolic-pole.test.ts
test/compute-engine/item-363-protocol-requirement-cache.test.ts
test/compute-engine/item-399-residue-class.test.ts
test/compute-engine/join-append-literal-fold.test.ts
test/compute-engine/lambda-param-collection-inference.test.ts
test/compute-engine/lambda-param-element-inference.test.ts
test/compute-engine/lambertw-sinc-fresnel-complex.test.ts
test/compute-engine/lazy-callback-count.test.ts
test/compute-engine/lazy-view-scope.test.ts
test/compute-engine/library-definition-copy.test.ts
test/compute-engine/library-name-shadowing.test.ts
test/compute-engine/list-literal-error-element-type.test.ts
test/compute-engine/list-literal-lists-lazy-elements.test.ts
test/compute-engine/map-auto-compile-named-function.test.ts
test/compute-engine/map-nothing-bypass.test.ts
test/compute-engine/match-compile.test.ts
test/compute-engine/mathematica-heads-nsolve-table-limit.test.ts
test/compute-engine/mathematica-surface-forms.test.ts
test/compute-engine/missing-result-only.test.ts
test/compute-engine/named-arguments-declared-callee.test.ts
test/compute-engine/named-arguments-inline-literal.test.ts
test/compute-engine/named-arguments-record-field.test.ts
test/compute-engine/named-arguments.test.ts
test/compute-engine/named-callback-direct-application.test.ts
test/compute-engine/nominal-assign.test.ts
test/compute-engine/object-appendix-b.test.ts
test/compute-engine/object-caching.test.ts
test/compute-engine/object-declaration.test.ts
test/compute-engine/object-store.test.ts
test/compute-engine/parameter-index-read-inference.test.ts
test/compute-engine/parameterized-nominal-constructor.test.ts
test/compute-engine/parameterized-nominal-types.test.ts
test/compute-engine/parameterized-nominal-variance.test.ts
test/compute-engine/partly-annotated-function-validation.test.ts
test/compute-engine/pipe-named-stage-type.test.ts
test/compute-engine/placeholder-element-refinement.test.ts
test/compute-engine/placeholder-signature-refinement.test.ts
test/compute-engine/point-function-call-typing.test.ts
test/compute-engine/property-store-retirement.test.ts
test/compute-engine/protocol-annotated-members.test.ts
test/compute-engine/protocol-conditional.test.ts
test/compute-engine/protocol-constraints.test.ts
test/compute-engine/protocol-dispatch-compile.test.ts
test/compute-engine/protocol-dispatch.test.ts
test/compute-engine/protocol-effects.test.ts
test/compute-engine/protocol-extends.test.ts
test/compute-engine/protocol-field-backed.test.ts
test/compute-engine/protocol-mutability-gate.test.ts
test/compute-engine/protocol-properties.test.ts
test/compute-engine/protocol-property-effects.test.ts
test/compute-engine/protocol-resettle-invariants.test.ts
test/compute-engine/protocol-type-redefinition.test.ts
test/compute-engine/protocols.test.ts
test/compute-engine/qualified-call-library-binding.test.ts
test/compute-engine/recursive-application-memo-across-evaluations.test.ts
test/compute-engine/redeclare-arithmetic-copy.test.ts
test/compute-engine/same-statement-reregistration.test.ts
test/compute-engine/sequence-search.test.ts
test/compute-engine/set-cardinality.test.ts
test/compute-engine/shared-collection-literal-evaluation.test.ts
test/compute-engine/spread-literal-result-kind.test.ts
test/compute-engine/string-collection.test.ts
test/compute-engine/string-operations.test.ts
test/compute-engine/sum-compile.test.ts
test/compute-engine/sum-declaration-sugar.test.ts
test/compute-engine/sum-types.test.ts
test/compute-engine/symbol-value-scoping.test.ts
test/compute-engine/transitive-purity-noncanonical-value.test.ts
test/compute-engine/tuple-argument-binding.test.ts
test/compute-engine/tuple-pattern-walkers.test.ts
test/compute-engine/tuple-slot-preservation.test.ts
test/compute-engine/tycho-item-167-broadcast-count.test.ts
test/compute-engine/tycho-item-217-recursive-application-memo.test.ts
test/compute-engine/tycho-item-330-loop-var-recursion.test.ts
test/compute-engine/tycho-item-331-spread-in-function-body.test.ts
test/compute-engine/tycho-item-332-untyped-program-compile.test.ts
test/compute-engine/tycho-row-426-apply-lambda-type.test.ts
test/compute-engine/type-constructors-compile.test.ts
test/compute-engine/type-constructors.test.ts
test/compute-engine/type-values.test.ts
test/compute-engine/type-variables.test.ts
test/compute-engine/unknown-inference-marker.test.ts
test/compute-engine/use-driven-element-inference.test.ts
test/compute-engine/use-narrowing-evidence-guard.test.ts
test/compute-engine/user-decisions-1020.test.ts
test/compute-engine/value-kinds.test.ts
test/compute-engine/whole-collection-parameter.test.ts
test/compute-engine/with-step-budget.test.ts
test/compute-engine/zip-tuple-component-type.test.ts
test/consumer/epsil-runtime-smoke.mjs
test/epsil/absence-marker-binding.test.ts
test/epsil/annotation-lambda-lift.test.ts
test/epsil/assert-present.test.ts
test/epsil/assign-to-list-element.test.ts
test/epsil/binder-sites-of.test.ts
test/epsil/binding-units-static-declarations.test.ts
test/epsil/check-epsil.test.ts
test/epsil/collection-of-missing-elements.test.ts
test/epsil/compiled-declared-function-type.test.ts
test/epsil/compiled-function-redefinition-effects.test.ts
test/epsil/comprehension-domain-local-read.test.ts
test/epsil/comprehensions.test.ts
test/epsil/corpus.test.ts
test/epsil/declare-type.test.ts
test/epsil/definition-head-multiline.test.ts
test/epsil/definition-of-library-function.test.ts
test/epsil/definition-order-error-value.test.ts
test/epsil/destructured-parameter-alias.test.ts
test/epsil/documentation.test.ts
test/epsil/effects.test.ts
test/epsil/else-if-error-location.test.ts
test/epsil/equation-body.test.ts
test/epsil/error-argument-unknown-parameter.test.ts
test/epsil/execute-async.test.ts
test/epsil/execute.test.ts
test/epsil/function-body-error-location.test.ts
test/epsil/function-body-local-assignment.test.ts
test/epsil/function-declaration-hoisting.test.ts
test/epsil/generic-function-sugar.test.ts
test/epsil/hold-functions.test.ts
test/epsil/if-let.test.ts
test/epsil/integration.test.ts
test/epsil/item-400-assign-function.test.ts
test/epsil/iterate-list-with-failed-cell.test.ts
test/epsil/lambda-arrow.test.ts
test/epsil/lazy-argument-capture.test.ts
test/epsil/library-names.test.ts
test/epsil/lints.test.ts
test/epsil/list-join-nesting-and-if-frame.test.ts
test/epsil/mapsto-arrow-diagnostic.test.ts
test/epsil/match-exhaustiveness.test.ts
test/epsil/match.test.ts
test/epsil/member-call.test.ts
test/epsil/multi-clause.test.ts
test/epsil/nested-function-statement.test.ts
test/epsil/nested-statement-diagnostics.test.ts
test/epsil/number-literals.test.ts
test/epsil/parallel-for.test.ts
test/epsil/parameter-default-values.test.ts
test/epsil/paren-operand-source-range.test.ts
test/epsil/presence-narrowing.test.ts
test/epsil/print-input.test.ts
test/epsil/programs.test.ts
test/epsil/protocol-extends.test.ts
test/epsil/protocols.test.ts
test/epsil/provenance-note.test.ts
test/epsil/redefinition-discipline.test.ts
test/epsil/renamed-call-error-location.test.ts
test/epsil/reordered-call-error-location.test.ts
test/epsil/review-collection-capture.test.ts
test/epsil/runtime-error.test.ts
test/epsil/single-block-program.test.ts
test/epsil/spread-literal-snapshot.test.ts
test/epsil/static-check-const-assignment.test.ts
test/epsil/static-check-function-on-const.test.ts
test/epsil/static-check-let-shadows-library-name.test.ts
test/epsil/static-declared-type.test.ts
test/epsil/static-lambda-callee-arguments.test.ts
test/epsil/static-overload-join.test.ts
test/epsil/std-qualified-name.test.ts
test/epsil/sum-type-conformance.test.ts
test/epsil/text-parameter-inference.test.ts
test/epsil/tuple-param-destructuring.test.ts
test/epsil/type-conformance-multiline.test.ts
test/epsil/type-values.test.ts
test/epsil/type-variables-epsil.test.ts
test/epsil/unknown-call-outside-result.test.ts
test/epsil/while-let-body-diagnostics.test.ts
test/epsil/while-let.test.ts
```

## Historical 49 inferred route-comparison files

49 files.

```text
test/compute-engine/absent-argument-annotated-parameter.test.ts
test/compute-engine/assignment-stores-lazy-collection.test.ts
test/compute-engine/block-declared-signature-clause.test.ts
test/compute-engine/block-later-declarations.test.ts
test/compute-engine/block-scope-capture.test.ts
test/compute-engine/callback-arity.test.ts
test/compute-engine/ce-1163-pool-loop.test.ts
test/compute-engine/ce-1163-run-async.test.ts
test/compute-engine/compile-destructuring-from-call.test.ts
test/compute-engine/compile-elseless-if-statement.test.ts
test/compute-engine/compile-free-symbols-binders.test.ts
test/compute-engine/compile-javascript-structured-bigint.test.ts
test/compute-engine/compile-references.test.ts
test/compute-engine/declare-destructure.test.ts
test/compute-engine/design-d-callback-contract.test.ts
test/compute-engine/field-accessor.test.ts
test/compute-engine/function-literal-rest-parameter.test.ts
test/compute-engine/lambda-param-element-inference.test.ts
test/compute-engine/partly-annotated-function-validation.test.ts
test/compute-engine/protocol-conditional.test.ts
test/compute-engine/protocol-dispatch.test.ts
test/compute-engine/protocol-effects.test.ts
test/compute-engine/protocol-properties.test.ts
test/compute-engine/protocol-property-effects.test.ts
test/compute-engine/protocols.test.ts
test/compute-engine/spread-literal-result-kind.test.ts
test/compute-engine/sum-declaration-sugar.test.ts
test/compute-engine/tycho-item-332-untyped-program-compile.test.ts
test/epsil/assign-to-list-element.test.ts
test/epsil/compiled-declared-function-type.test.ts
test/epsil/compiled-function-redefinition-effects.test.ts
test/epsil/declare-type.test.ts
test/epsil/effects.test.ts
test/epsil/execute.test.ts
test/epsil/function-body-local-assignment.test.ts
test/epsil/function-declaration-hoisting.test.ts
test/epsil/generic-function-sugar.test.ts
test/epsil/hold-functions.test.ts
test/epsil/library-names.test.ts
test/epsil/member-call.test.ts
test/epsil/multi-clause.test.ts
test/epsil/parallel-for.test.ts
test/epsil/parameter-default-values.test.ts
test/epsil/redefinition-discipline.test.ts
test/epsil/static-lambda-callee-arguments.test.ts
test/epsil/std-qualified-name.test.ts
test/epsil/tuple-param-destructuring.test.ts
test/epsil/type-values.test.ts
test/epsil/while-let.test.ts
```

## Frozen task baseline sync execute files

286 files.

```text
test/common/type/lexer-comments.test.ts
test/common/type/list-element-tensor-cell.test.ts
test/compute-engine/absence-discharge.test.ts
test/compute-engine/absent-argument-annotated-parameter.test.ts
test/compute-engine/absent-argument-library-default.test.ts
test/compute-engine/annotated-parameter-undecided.test.ts
test/compute-engine/arithmetic-non-numeric-evaluate.test.ts
test/compute-engine/assign-overlap-declared-type.test.ts
test/compute-engine/assignment-stores-lazy-collection.test.ts
test/compute-engine/batch10-async-and-definitions.test.ts
test/compute-engine/binding-units-caches.test.ts
test/compute-engine/binding-units-compile.test.ts
test/compute-engine/binding-units-ops.test.ts
test/compute-engine/block-assign-run-time.test.ts
test/compute-engine/block-assignment-local-per-run.test.ts
test/compute-engine/block-declared-signature-clause.test.ts
test/compute-engine/block-later-declarations.test.ts
test/compute-engine/block-locals-declaration-rules.test.ts
test/compute-engine/block-locals-per-run.test.ts
test/compute-engine/block-scope-capture.test.ts
test/compute-engine/block-scope-shadowing.test.ts
test/compute-engine/bound-once.test.ts
test/compute-engine/broadcast-error-context.test.ts
test/compute-engine/broadcast-lift.test.ts
test/compute-engine/broadcastable-param-declaration.test.ts
test/compute-engine/call-follows-function-reassignment.test.ts
test/compute-engine/callback-arity.test.ts
test/compute-engine/ce-1047-handler-type-error-frame.test.ts
test/compute-engine/ce-108-2-tabulate-error-generator.test.ts
test/compute-engine/ce-1107-gpu-list-input-argument.test.ts
test/compute-engine/ce-1125-impure-element-reads.test.ts
test/compute-engine/ce-1163-pool-loop.test.ts
test/compute-engine/ce-1163-run-async.test.ts
test/compute-engine/ce-1177-glsl-function-body-typed.test.ts
test/compute-engine/ce-1179-loop-body-scalar-result.test.ts
test/compute-engine/ce-122-qualified-call-unknown-protocol.test.ts
test/compute-engine/ce-1280-canonical-reads-no-value.test.ts
test/compute-engine/ce-325-per-call-type-reads.test.ts
test/compute-engine/ce-35-tuple-local-component-alias.test.ts
test/compute-engine/ce-432-sum-compiled-map.test.ts
test/compute-engine/ce-438-latex-cache.test.ts
test/compute-engine/ce-446-map-callback-callee-lexical.test.ts
test/compute-engine/ce-473-captured-free-symbol.test.ts
test/compute-engine/ce-60-inferred-parameter-names.test.ts
test/compute-engine/ce-689-type-cache-across-calls.test.ts
test/compute-engine/ce-827-block-local-type-ignores-same-name-binding.test.ts
test/compute-engine/character-string-operators.test.ts
test/compute-engine/closure-frame-retained.test.ts
test/compute-engine/collection-absent-followups.test.ts
test/compute-engine/collection-element-memo-named-callback.test.ts
test/compute-engine/collection-operator-parameter-inference.test.ts
test/compute-engine/collection-type-followups.test.ts
test/compute-engine/collection-with-failed-cell.test.ts
test/compute-engine/compile-assigned-symbol.test.ts
test/compute-engine/compile-block-locals-rules.test.ts
test/compute-engine/compile-destructuring-from-call.test.ts
test/compute-engine/compile-elseless-if-statement.test.ts
test/compute-engine/compile-fallback.test.ts
test/compute-engine/compile-free-symbols-binders.test.ts
test/compute-engine/compile-glsl-caller-locals.test.ts
test/compute-engine/compile-glsl-fragment.test.ts
test/compute-engine/compile-mode-strict.test.ts
test/compute-engine/compile-parameter-defaults.test.ts
test/compute-engine/compile-references.test.ts
test/compute-engine/compile-scalar-param-direct-call.test.ts
test/compute-engine/compile-string-fail-closed.test.ts
test/compute-engine/compile-symbolic-option.test.ts
test/compute-engine/compiled-interpreter-agreement.test.ts
test/compute-engine/comprehension-count-finiteness.test.ts
test/compute-engine/comprehension-impure-count.test.ts
test/compute-engine/comprehension-index-function.test.ts
test/compute-engine/const-local-sum-order.test.ts
test/compute-engine/constant-function-reassignment.test.ts
test/compute-engine/constant-node-cache-key.test.ts
test/compute-engine/constructor-functions.test.ts
test/compute-engine/d17-run-keeps-type-caches.test.ts
test/compute-engine/declare-destructure.test.ts
test/compute-engine/declare-statement-scope-ceiling.test.ts
test/compute-engine/declared-contract-presence.test.ts
test/compute-engine/declared-parameter-undecided.test.ts
test/compute-engine/declared-result-checked-at-application.test.ts
test/compute-engine/declared-type-unknown-value.test.ts
test/compute-engine/design-d-callback-contract.test.ts
test/compute-engine/design-e-compatibility.test.ts
test/compute-engine/dimension-variables.test.ts
test/compute-engine/effects-activation-memo.test.ts
test/compute-engine/effects-contracts.test.ts
test/compute-engine/effects-provenance.test.ts
test/compute-engine/effects-state-label.test.ts
test/compute-engine/error-propagation.test.ts
test/compute-engine/evaluation-order.test.ts
test/compute-engine/exact-results-reference-round.test.ts
test/compute-engine/expected-function-head.test.ts
test/compute-engine/field-accessor.test.ts
test/compute-engine/find-root-fit-result-type.test.ts
test/compute-engine/fixed-point.test.ts
test/compute-engine/function-literal-rest-parameter.test.ts
test/compute-engine/function-value-rebuild.test.ts
test/compute-engine/generic-function-literals.test.ts
test/compute-engine/generic-tuple-argument-check.test.ts
test/compute-engine/generic-type-aliases.test.ts
test/compute-engine/group-theory-api.test.ts
test/compute-engine/group-theory-baseline.test.ts
test/compute-engine/group-theory-closure.test.ts
test/compute-engine/group-theory-exact-integration.test.ts
test/compute-engine/group-theory-foundation.test.ts
test/compute-engine/group-theory-maps.test.ts
test/compute-engine/group-theory-orbit-integration.test.ts
test/compute-engine/group-theory-presentation-api.test.ts
test/compute-engine/group-theory-structural-api.test.ts
test/compute-engine/head-tail.test.ts
test/compute-engine/host-function-clause-redefinition.test.ts
test/compute-engine/indeterminate.test.ts
test/compute-engine/integrate-symbolic-pole.test.ts
test/compute-engine/item-363-protocol-requirement-cache.test.ts
test/compute-engine/item-399-residue-class.test.ts
test/compute-engine/join-append-literal-fold.test.ts
test/compute-engine/lambda-param-collection-inference.test.ts
test/compute-engine/lambda-param-element-inference.test.ts
test/compute-engine/lambertw-sinc-fresnel-complex.test.ts
test/compute-engine/lazy-callback-count.test.ts
test/compute-engine/lazy-view-scope.test.ts
test/compute-engine/library-definition-copy.test.ts
test/compute-engine/library-name-shadowing.test.ts
test/compute-engine/list-literal-error-element-type.test.ts
test/compute-engine/list-literal-lists-lazy-elements.test.ts
test/compute-engine/map-auto-compile-named-function.test.ts
test/compute-engine/map-nothing-bypass.test.ts
test/compute-engine/match-compile.test.ts
test/compute-engine/mathematica-heads-nsolve-table-limit.test.ts
test/compute-engine/mathematica-surface-forms.test.ts
test/compute-engine/missing-result-only.test.ts
test/compute-engine/named-arguments-declared-callee.test.ts
test/compute-engine/named-arguments-inline-literal.test.ts
test/compute-engine/named-arguments-record-field.test.ts
test/compute-engine/named-arguments.test.ts
test/compute-engine/named-callback-direct-application.test.ts
test/compute-engine/nominal-assign.test.ts
test/compute-engine/object-appendix-b.test.ts
test/compute-engine/object-caching.test.ts
test/compute-engine/object-declaration.test.ts
test/compute-engine/object-store.test.ts
test/compute-engine/overload-trials.test.ts
test/compute-engine/parameter-index-read-inference.test.ts
test/compute-engine/parameterized-nominal-constructor.test.ts
test/compute-engine/parameterized-nominal-types.test.ts
test/compute-engine/parameterized-nominal-variance.test.ts
test/compute-engine/partly-annotated-function-validation.test.ts
test/compute-engine/pipe-named-stage-type.test.ts
test/compute-engine/placeholder-element-refinement.test.ts
test/compute-engine/placeholder-signature-refinement.test.ts
test/compute-engine/point-function-call-typing.test.ts
test/compute-engine/property-store-retirement.test.ts
test/compute-engine/protocol-annotated-members.test.ts
test/compute-engine/protocol-conditional.test.ts
test/compute-engine/protocol-constraints.test.ts
test/compute-engine/protocol-dispatch-compile.test.ts
test/compute-engine/protocol-dispatch.test.ts
test/compute-engine/protocol-effects.test.ts
test/compute-engine/protocol-extends.test.ts
test/compute-engine/protocol-field-backed.test.ts
test/compute-engine/protocol-mutability-gate.test.ts
test/compute-engine/protocol-properties.test.ts
test/compute-engine/protocol-property-effects.test.ts
test/compute-engine/protocol-resettle-invariants.test.ts
test/compute-engine/protocol-type-redefinition.test.ts
test/compute-engine/protocols.test.ts
test/compute-engine/qualified-call-library-binding.test.ts
test/compute-engine/recursive-application-memo-across-evaluations.test.ts
test/compute-engine/redeclare-arithmetic-copy.test.ts
test/compute-engine/same-statement-reregistration.test.ts
test/compute-engine/sequence-search.test.ts
test/compute-engine/set-cardinality.test.ts
test/compute-engine/shared-collection-literal-evaluation.test.ts
test/compute-engine/spread-literal-result-kind.test.ts
test/compute-engine/string-collection.test.ts
test/compute-engine/string-operations.test.ts
test/compute-engine/sum-compile.test.ts
test/compute-engine/sum-declaration-sugar.test.ts
test/compute-engine/sum-types.test.ts
test/compute-engine/symbol-value-scoping.test.ts
test/compute-engine/transitive-purity-noncanonical-value.test.ts
test/compute-engine/tuple-argument-binding.test.ts
test/compute-engine/tuple-pattern-walkers.test.ts
test/compute-engine/tuple-slot-preservation.test.ts
test/compute-engine/tycho-item-167-broadcast-count.test.ts
test/compute-engine/tycho-item-217-recursive-application-memo.test.ts
test/compute-engine/tycho-item-330-loop-var-recursion.test.ts
test/compute-engine/tycho-item-331-spread-in-function-body.test.ts
test/compute-engine/tycho-item-332-untyped-program-compile.test.ts
test/compute-engine/tycho-row-426-apply-lambda-type.test.ts
test/compute-engine/type-constructors-compile.test.ts
test/compute-engine/type-constructors.test.ts
test/compute-engine/type-values.test.ts
test/compute-engine/type-variables.test.ts
test/compute-engine/unknown-inference-marker.test.ts
test/compute-engine/use-driven-element-inference.test.ts
test/compute-engine/use-narrowing-evidence-guard.test.ts
test/compute-engine/user-decisions-1020.test.ts
test/compute-engine/value-kinds.test.ts
test/compute-engine/whole-collection-parameter.test.ts
test/compute-engine/with-step-budget.test.ts
test/compute-engine/zip-tuple-component-type.test.ts
test/consumer/epsil-runtime-smoke.mjs
test/epsil/absence-marker-binding.test.ts
test/epsil/annotation-lambda-lift.test.ts
test/epsil/assert-present.test.ts
test/epsil/assign-to-list-element.test.ts
test/epsil/binder-sites-of.test.ts
test/epsil/binding-units-static-declarations.test.ts
test/epsil/ce-1303-while-undecided-condition.test.ts
test/epsil/check-epsil.test.ts
test/epsil/collection-of-missing-elements.test.ts
test/epsil/compiled-declared-function-type.test.ts
test/epsil/compiled-function-redefinition-effects.test.ts
test/epsil/comprehension-domain-local-read.test.ts
test/epsil/comprehensions.test.ts
test/epsil/corpus.test.ts
test/epsil/declare-type.test.ts
test/epsil/definition-head-multiline.test.ts
test/epsil/definition-of-library-function.test.ts
test/epsil/definition-order-error-value.test.ts
test/epsil/destructured-parameter-alias.test.ts
test/epsil/documentation.test.ts
test/epsil/effects.test.ts
test/epsil/else-if-error-location.test.ts
test/epsil/equation-body.test.ts
test/epsil/error-argument-unknown-parameter.test.ts
test/epsil/execute-async.test.ts
test/epsil/execute.test.ts
test/epsil/function-body-error-location.test.ts
test/epsil/function-body-local-assignment.test.ts
test/epsil/function-declaration-hoisting.test.ts
test/epsil/generic-function-sugar.test.ts
test/epsil/hold-functions.test.ts
test/epsil/if-let.test.ts
test/epsil/integration.test.ts
test/epsil/item-400-assign-function.test.ts
test/epsil/iterate-list-with-failed-cell.test.ts
test/epsil/lambda-arrow.test.ts
test/epsil/lazy-argument-capture.test.ts
test/epsil/library-names.test.ts
test/epsil/lints.test.ts
test/epsil/list-join-nesting-and-if-frame.test.ts
test/epsil/mapsto-arrow-diagnostic.test.ts
test/epsil/match-exhaustiveness.test.ts
test/epsil/match.test.ts
test/epsil/member-call.test.ts
test/epsil/multi-clause.test.ts
test/epsil/nested-function-statement.test.ts
test/epsil/nested-statement-diagnostics.test.ts
test/epsil/number-literals.test.ts
test/epsil/parallel-for.test.ts
test/epsil/parameter-default-values.test.ts
test/epsil/paren-operand-source-range.test.ts
test/epsil/presence-narrowing.test.ts
test/epsil/print-input.test.ts
test/epsil/programs.test.ts
test/epsil/protocol-extends.test.ts
test/epsil/protocols.test.ts
test/epsil/provenance-note.test.ts
test/epsil/redefinition-discipline.test.ts
test/epsil/renamed-call-error-location.test.ts
test/epsil/reordered-call-error-location.test.ts
test/epsil/review-collection-capture.test.ts
test/epsil/runtime-error.test.ts
test/epsil/single-block-program.test.ts
test/epsil/spread-literal-snapshot.test.ts
test/epsil/static-check-const-assignment.test.ts
test/epsil/static-check-function-on-const.test.ts
test/epsil/static-check-leaves-engine.test.ts
test/epsil/static-check-let-shadows-library-name.test.ts
test/epsil/static-declared-type.test.ts
test/epsil/static-diagnostic-code.test.ts
test/epsil/static-lambda-callee-arguments.test.ts
test/epsil/static-overload-join.test.ts
test/epsil/std-qualified-name.test.ts
test/epsil/sum-type-conformance.test.ts
test/epsil/text-parameter-inference.test.ts
test/epsil/tuple-param-destructuring.test.ts
test/epsil/type-conformance-multiline.test.ts
test/epsil/type-values.test.ts
test/epsil/type-variables-epsil.test.ts
test/epsil/unknown-call-outside-result.test.ts
test/epsil/while-let-body-diagnostics.test.ts
test/epsil/while-let.test.ts
```

## Frozen task baseline inferred route-comparison files

50 files.

```text
test/compute-engine/absent-argument-annotated-parameter.test.ts
test/compute-engine/assignment-stores-lazy-collection.test.ts
test/compute-engine/block-declared-signature-clause.test.ts
test/compute-engine/block-later-declarations.test.ts
test/compute-engine/block-scope-capture.test.ts
test/compute-engine/bound-once.test.ts
test/compute-engine/callback-arity.test.ts
test/compute-engine/ce-1163-pool-loop.test.ts
test/compute-engine/ce-1163-run-async.test.ts
test/compute-engine/compile-destructuring-from-call.test.ts
test/compute-engine/compile-elseless-if-statement.test.ts
test/compute-engine/compile-free-symbols-binders.test.ts
test/compute-engine/compile-references.test.ts
test/compute-engine/d17-run-keeps-type-caches.test.ts
test/compute-engine/declare-destructure.test.ts
test/compute-engine/design-d-callback-contract.test.ts
test/compute-engine/field-accessor.test.ts
test/compute-engine/function-literal-rest-parameter.test.ts
test/compute-engine/lambda-param-element-inference.test.ts
test/compute-engine/partly-annotated-function-validation.test.ts
test/compute-engine/protocol-conditional.test.ts
test/compute-engine/protocol-dispatch.test.ts
test/compute-engine/protocol-effects.test.ts
test/compute-engine/protocol-properties.test.ts
test/compute-engine/protocol-property-effects.test.ts
test/compute-engine/protocols.test.ts
test/compute-engine/spread-literal-result-kind.test.ts
test/compute-engine/sum-declaration-sugar.test.ts
test/compute-engine/tycho-item-332-untyped-program-compile.test.ts
test/epsil/assign-to-list-element.test.ts
test/epsil/compiled-declared-function-type.test.ts
test/epsil/compiled-function-redefinition-effects.test.ts
test/epsil/declare-type.test.ts
test/epsil/effects.test.ts
test/epsil/execute.test.ts
test/epsil/function-body-local-assignment.test.ts
test/epsil/function-declaration-hoisting.test.ts
test/epsil/generic-function-sugar.test.ts
test/epsil/hold-functions.test.ts
test/epsil/library-names.test.ts
test/epsil/member-call.test.ts
test/epsil/multi-clause.test.ts
test/epsil/parallel-for.test.ts
test/epsil/parameter-default-values.test.ts
test/epsil/redefinition-discipline.test.ts
test/epsil/static-lambda-callee-arguments.test.ts
test/epsil/std-qualified-name.test.ts
test/epsil/tuple-param-destructuring.test.ts
test/epsil/type-values.test.ts
test/epsil/while-let.test.ts
```

## Frozen baseline named route consumer inventory

Tags: sync/async/steps/check/checkSource/static/parse. Each tag means the exact literal in the count table. Direct-box and compile tags mean co-occurrence with parse in the file, not proved semantic parity.

| File | Route tags |
| --- | --- |
| `test/common/type/lexer-comments.test.ts` | execute-sync |
| `test/common/type/list-element-tensor-cell.test.ts` | execute-sync |
| `test/common/types.test.ts` | parse, parse+box |
| `test/compute-engine/absence-discharge.test.ts` | execute-sync |
| `test/compute-engine/absent-argument-annotated-parameter.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/absent-argument-library-default.test.ts` | execute-sync |
| `test/compute-engine/annotated-parameter-undecided.test.ts` | execute-sync |
| `test/compute-engine/arithmetic-non-numeric-evaluate.test.ts` | execute-sync |
| `test/compute-engine/assign-declare-evaluate-async.test.ts` | execute-async |
| `test/compute-engine/assign-overlap-declared-type.test.ts` | execute-sync |
| `test/compute-engine/assignment-stores-lazy-collection.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/batch10-async-and-definitions.test.ts` | execute-sync |
| `test/compute-engine/binding-units-caches.test.ts` | execute-sync |
| `test/compute-engine/binding-units-commit.test.ts` | static-diagnostics |
| `test/compute-engine/binding-units-compile.test.ts` | execute-sync |
| `test/compute-engine/binding-units-ops.test.ts` | execute-sync |
| `test/compute-engine/binding-units-order.test.ts` | static-diagnostics |
| `test/compute-engine/block-assign-run-time.test.ts` | execute-sync |
| `test/compute-engine/block-assignment-local-per-run.test.ts` | execute-sync |
| `test/compute-engine/block-declared-signature-clause.test.ts` | execute-sync, parse, parse+box |
| `test/compute-engine/block-later-declarations.test.ts` | execute-sync, parse, parse+box |
| `test/compute-engine/block-locals-declaration-rules.test.ts` | execute-sync |
| `test/compute-engine/block-locals-per-run.test.ts` | execute-sync, check-source |
| `test/compute-engine/block-scope-capture.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/block-scope-shadowing.test.ts` | execute-sync |
| `test/compute-engine/bound-once.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/broadcast-error-context.test.ts` | execute-sync |
| `test/compute-engine/broadcast-lift.test.ts` | execute-sync |
| `test/compute-engine/broadcastable-param-declaration.test.ts` | execute-sync |
| `test/compute-engine/call-follows-function-reassignment.test.ts` | execute-sync |
| `test/compute-engine/call-head-lexical-binding.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/callback-arity.test.ts` | execute-sync, static-diagnostics, parse, parse+box |
| `test/compute-engine/ce-1047-handler-type-error-frame.test.ts` | execute-sync |
| `test/compute-engine/ce-1073-loop-statement-form.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/ce-108-2-tabulate-error-generator.test.ts` | execute-sync |
| `test/compute-engine/ce-1098-replace-at-in-place.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/ce-1107-gpu-list-input-argument.test.ts` | execute-sync |
| `test/compute-engine/ce-1125-impure-element-reads.test.ts` | execute-sync |
| `test/compute-engine/ce-1163-pool-loop.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/ce-1163-run-async.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/ce-1177-glsl-function-body-typed.test.ts` | execute-sync |
| `test/compute-engine/ce-1179-loop-body-scalar-result.test.ts` | execute-sync |
| `test/compute-engine/ce-122-qualified-call-unknown-protocol.test.ts` | execute-sync |
| `test/compute-engine/ce-1280-canonical-reads-no-value.test.ts` | execute-sync |
| `test/compute-engine/ce-325-per-call-type-reads.test.ts` | execute-sync |
| `test/compute-engine/ce-35-tuple-local-component-alias.test.ts` | execute-sync |
| `test/compute-engine/ce-43-block-local-statement-order.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/ce-432-sum-compiled-map.test.ts` | execute-sync, execute-async |
| `test/compute-engine/ce-438-latex-cache.test.ts` | execute-sync |
| `test/compute-engine/ce-446-map-callback-callee-lexical.test.ts` | execute-sync |
| `test/compute-engine/ce-473-captured-free-symbol.test.ts` | execute-sync |
| `test/compute-engine/ce-60-inferred-parameter-names.test.ts` | execute-sync |
| `test/compute-engine/ce-631-633-boolean-results-and-inputs.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/ce-689-type-cache-across-calls.test.ts` | execute-sync |
| `test/compute-engine/ce-827-block-local-type-ignores-same-name-binding.test.ts` | execute-sync |
| `test/compute-engine/character-string-operators.test.ts` | execute-sync |
| `test/compute-engine/closure-frame-retained.test.ts` | execute-sync, execute-async |
| `test/compute-engine/collection-absent-followups.test.ts` | execute-sync |
| `test/compute-engine/collection-element-memo-named-callback.test.ts` | execute-sync |
| `test/compute-engine/collection-operator-parameter-inference.test.ts` | execute-sync |
| `test/compute-engine/collection-type-followups.test.ts` | execute-sync |
| `test/compute-engine/collection-with-failed-cell.test.ts` | execute-sync |
| `test/compute-engine/compile-assigned-symbol.test.ts` | execute-sync |
| `test/compute-engine/compile-block-local-function.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/compile-block-locals-rules.test.ts` | execute-sync |
| `test/compute-engine/compile-callback-invariants.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/compile-collection-parameter-check.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/compile-destructuring-from-call.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/compile-elseless-if-statement.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/compile-fallback.test.ts` | execute-sync |
| `test/compute-engine/compile-fold-list-accumulator.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/compile-free-symbols-binders.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/compile-function-returned-by-call.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/compile-glsl-caller-locals.test.ts` | execute-sync |
| `test/compute-engine/compile-glsl-fragment.test.ts` | execute-sync |
| `test/compute-engine/compile-local-function-tuple-index.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/compile-loop-body-destructuring.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/compile-loop-destructuring.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/compile-mode-strict.test.ts` | execute-sync |
| `test/compute-engine/compile-parameter-assignment-type.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/compile-parameter-defaults.test.ts` | execute-sync |
| `test/compute-engine/compile-point-list-bare-parameter.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/compile-references.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/compile-scalar-param-direct-call.test.ts` | execute-sync |
| `test/compute-engine/compile-string-fail-closed.test.ts` | execute-sync |
| `test/compute-engine/compile-symbolic-option.test.ts` | execute-sync |
| `test/compute-engine/compiled-interpreter-agreement.test.ts` | execute-sync |
| `test/compute-engine/comprehension-count-finiteness.test.ts` | execute-sync |
| `test/compute-engine/comprehension-impure-count.test.ts` | execute-sync |
| `test/compute-engine/comprehension-index-function.test.ts` | execute-sync |
| `test/compute-engine/const-local-sum-order.test.ts` | execute-sync |
| `test/compute-engine/constant-function-reassignment.test.ts` | execute-sync |
| `test/compute-engine/constant-node-cache-key.test.ts` | execute-sync |
| `test/compute-engine/constructor-functions.test.ts` | execute-sync |
| `test/compute-engine/d17-run-keeps-type-caches.test.ts` | execute-sync, parse, parse+box |
| `test/compute-engine/debug-hook.test.ts` | parse, parse+box |
| `test/compute-engine/declare-destructure.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/declare-statement-scope-ceiling.test.ts` | execute-sync |
| `test/compute-engine/declared-contract-presence.test.ts` | execute-sync |
| `test/compute-engine/declared-parameter-undecided.test.ts` | execute-sync |
| `test/compute-engine/declared-result-checked-at-application.test.ts` | execute-sync |
| `test/compute-engine/declared-type-unknown-value.test.ts` | execute-sync |
| `test/compute-engine/design-d-callback-contract.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/design-e-compatibility.test.ts` | execute-sync |
| `test/compute-engine/dimension-variables.test.ts` | execute-sync |
| `test/compute-engine/effects-activation-memo.test.ts` | execute-sync |
| `test/compute-engine/effects-contracts.test.ts` | execute-sync |
| `test/compute-engine/effects-provenance.test.ts` | execute-sync, static-diagnostics |
| `test/compute-engine/effects-read-from-literal-scope.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/effects-state-label.test.ts` | execute-sync |
| `test/compute-engine/error-propagation.test.ts` | execute-sync |
| `test/compute-engine/evaluation-order.test.ts` | execute-sync |
| `test/compute-engine/exact-results-reference-round.test.ts` | execute-sync |
| `test/compute-engine/expected-function-head.test.ts` | execute-sync |
| `test/compute-engine/field-accessor.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/find-root-fit-result-type.test.ts` | execute-sync |
| `test/compute-engine/fixed-point.test.ts` | execute-sync |
| `test/compute-engine/fold-accumulator-fixpoint.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/function-literal-rest-parameter.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/function-value-rebuild.test.ts` | execute-sync |
| `test/compute-engine/function-values-review-fixes.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/generic-function-literals.test.ts` | execute-sync |
| `test/compute-engine/generic-tuple-argument-check.test.ts` | execute-sync |
| `test/compute-engine/generic-type-aliases.test.ts` | execute-sync |
| `test/compute-engine/group-theory-api.test.ts` | execute-sync |
| `test/compute-engine/group-theory-baseline.test.ts` | execute-sync |
| `test/compute-engine/group-theory-closure.test.ts` | execute-sync |
| `test/compute-engine/group-theory-exact-integration.test.ts` | execute-sync |
| `test/compute-engine/group-theory-foundation.test.ts` | execute-sync |
| `test/compute-engine/group-theory-maps.test.ts` | execute-sync |
| `test/compute-engine/group-theory-orbit-integration.test.ts` | execute-sync |
| `test/compute-engine/group-theory-presentation-api.test.ts` | execute-sync |
| `test/compute-engine/group-theory-structural-api.test.ts` | execute-sync |
| `test/compute-engine/head-tail.test.ts` | execute-sync |
| `test/compute-engine/host-function-clause-redefinition.test.ts` | execute-sync |
| `test/compute-engine/indeterminate.test.ts` | execute-sync |
| `test/compute-engine/inference-type-refresh.test.ts` | static-diagnostics |
| `test/compute-engine/integrate-one-bound-flat-bigop.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/integrate-symbolic-pole.test.ts` | execute-sync |
| `test/compute-engine/item-363-protocol-requirement-cache.test.ts` | execute-sync |
| `test/compute-engine/item-399-residue-class.test.ts` | execute-sync |
| `test/compute-engine/join-append-literal-fold.test.ts` | execute-sync |
| `test/compute-engine/lambda-param-collection-inference.test.ts` | execute-sync |
| `test/compute-engine/lambda-param-element-inference.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/lambertw-sinc-fresnel-complex.test.ts` | execute-sync |
| `test/compute-engine/lazy-callback-count.test.ts` | execute-sync |
| `test/compute-engine/lazy-view-scope.test.ts` | execute-sync, execute-async |
| `test/compute-engine/library-definition-copy.test.ts` | execute-sync |
| `test/compute-engine/library-name-shadowing.test.ts` | execute-sync |
| `test/compute-engine/list-literal-error-element-type.test.ts` | execute-sync |
| `test/compute-engine/list-literal-lists-lazy-elements.test.ts` | execute-sync |
| `test/compute-engine/map-auto-compile-named-function.test.ts` | execute-sync |
| `test/compute-engine/map-bare-symbol-callback-type.test.ts` | parse, parse+box |
| `test/compute-engine/map-nothing-bypass.test.ts` | execute-sync |
| `test/compute-engine/map-omission-inference.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/match-compile.test.ts` | execute-sync |
| `test/compute-engine/mathematica-heads-nsolve-table-limit.test.ts` | execute-sync |
| `test/compute-engine/mathematica-surface-forms.test.ts` | execute-sync |
| `test/compute-engine/missing-result-only.test.ts` | execute-sync |
| `test/compute-engine/named-arguments-declared-callee.test.ts` | execute-sync |
| `test/compute-engine/named-arguments-inline-literal.test.ts` | execute-sync |
| `test/compute-engine/named-arguments-record-field.test.ts` | execute-sync |
| `test/compute-engine/named-arguments.test.ts` | execute-sync |
| `test/compute-engine/named-callback-direct-application.test.ts` | execute-sync |
| `test/compute-engine/nominal-assign.test.ts` | execute-sync |
| `test/compute-engine/object-appendix-b.test.ts` | execute-sync |
| `test/compute-engine/object-caching.test.ts` | execute-sync |
| `test/compute-engine/object-declaration.test.ts` | execute-sync |
| `test/compute-engine/object-store.test.ts` | execute-sync |
| `test/compute-engine/overload-trials.test.ts` | execute-sync, static-diagnostics |
| `test/compute-engine/parameter-index-read-inference.test.ts` | execute-sync |
| `test/compute-engine/parameterized-nominal-constructor.test.ts` | execute-sync |
| `test/compute-engine/parameterized-nominal-types.test.ts` | execute-sync |
| `test/compute-engine/parameterized-nominal-variance.test.ts` | execute-sync |
| `test/compute-engine/partly-annotated-function-validation.test.ts` | execute-sync, parse, parse+box |
| `test/compute-engine/pipe-named-stage-type.test.ts` | execute-sync |
| `test/compute-engine/placeholder-element-refinement.test.ts` | execute-sync |
| `test/compute-engine/placeholder-signature-refinement.test.ts` | execute-sync |
| `test/compute-engine/point-function-call-typing.test.ts` | execute-sync |
| `test/compute-engine/property-store-retirement.test.ts` | execute-sync |
| `test/compute-engine/protocol-annotated-members.test.ts` | execute-sync |
| `test/compute-engine/protocol-conditional.test.ts` | execute-sync, parse, parse+box |
| `test/compute-engine/protocol-constraints.test.ts` | execute-sync |
| `test/compute-engine/protocol-dispatch-compile.test.ts` | execute-sync |
| `test/compute-engine/protocol-dispatch.test.ts` | execute-sync, static-diagnostics, parse, parse+box, parse+compile |
| `test/compute-engine/protocol-effects.test.ts` | execute-sync, static-diagnostics, parse, parse+box |
| `test/compute-engine/protocol-extends.test.ts` | execute-sync |
| `test/compute-engine/protocol-field-backed.test.ts` | execute-sync |
| `test/compute-engine/protocol-mutability-gate.test.ts` | execute-sync |
| `test/compute-engine/protocol-properties.test.ts` | execute-sync, parse, parse+box |
| `test/compute-engine/protocol-property-effects.test.ts` | execute-sync, parse, parse+box |
| `test/compute-engine/protocol-resettle-invariants.test.ts` | execute-sync |
| `test/compute-engine/protocol-type-redefinition.test.ts` | execute-sync, static-diagnostics |
| `test/compute-engine/protocols.test.ts` | execute-sync, static-diagnostics, parse, parse+box |
| `test/compute-engine/qualified-call-library-binding.test.ts` | execute-sync |
| `test/compute-engine/recursive-application-memo-across-evaluations.test.ts` | execute-sync |
| `test/compute-engine/recursive-list-builder-compile.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/redeclare-arithmetic-copy.test.ts` | execute-sync |
| `test/compute-engine/same-statement-reregistration.test.ts` | execute-sync |
| `test/compute-engine/sequence-search.test.ts` | execute-sync |
| `test/compute-engine/set-cardinality.test.ts` | execute-sync |
| `test/compute-engine/shared-collection-literal-evaluation.test.ts` | execute-sync |
| `test/compute-engine/source-offsets.test.ts` | parse, parse+box |
| `test/compute-engine/spread-literal-result-kind.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/string-collection.test.ts` | execute-sync |
| `test/compute-engine/string-operations.test.ts` | execute-sync |
| `test/compute-engine/sum-compile.test.ts` | execute-sync |
| `test/compute-engine/sum-declaration-sugar.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/sum-types.test.ts` | execute-sync |
| `test/compute-engine/symbol-value-scoping.test.ts` | execute-sync |
| `test/compute-engine/transitive-purity-noncanonical-value.test.ts` | execute-sync |
| `test/compute-engine/tuple-argument-binding.test.ts` | execute-sync |
| `test/compute-engine/tuple-pattern-walkers.test.ts` | execute-sync |
| `test/compute-engine/tuple-slot-preservation.test.ts` | execute-sync |
| `test/compute-engine/tycho-item-167-broadcast-count.test.ts` | execute-sync |
| `test/compute-engine/tycho-item-217-recursive-application-memo.test.ts` | execute-sync |
| `test/compute-engine/tycho-item-330-loop-var-recursion.test.ts` | execute-sync |
| `test/compute-engine/tycho-item-331-spread-in-function-body.test.ts` | execute-sync |
| `test/compute-engine/tycho-item-332-block-let-literal-type.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/tycho-item-332-compiled-program-parity.test.ts` | parse, parse+box, parse+compile |
| `test/compute-engine/tycho-item-332-untyped-program-compile.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/compute-engine/tycho-row-426-apply-lambda-type.test.ts` | execute-sync |
| `test/compute-engine/type-constructors-compile.test.ts` | execute-sync |
| `test/compute-engine/type-constructors.test.ts` | execute-sync |
| `test/compute-engine/type-values.test.ts` | execute-sync |
| `test/compute-engine/type-variables.test.ts` | execute-sync |
| `test/compute-engine/unknown-inference-marker.test.ts` | execute-sync |
| `test/compute-engine/use-driven-element-inference.test.ts` | execute-sync |
| `test/compute-engine/use-narrowing-evidence-guard.test.ts` | execute-sync |
| `test/compute-engine/user-decisions-1020.test.ts` | execute-sync |
| `test/compute-engine/value-kinds.test.ts` | execute-sync |
| `test/compute-engine/whole-collection-parameter.test.ts` | execute-sync |
| `test/compute-engine/with-step-budget.test.ts` | execute-sync |
| `test/compute-engine/zip-tuple-component-type.test.ts` | execute-sync |
| `test/consumer/epsil-runtime-smoke.mjs` | execute-sync |
| `test/epsil.html` | parse |
| `test/epsil/absence-marker-binding.test.ts` | execute-sync |
| `test/epsil/annotation-lambda-lift.test.ts` | execute-sync |
| `test/epsil/assert-present.test.ts` | execute-sync, parse |
| `test/epsil/assign-to-list-element.test.ts` | execute-sync, check-source, parse, parse+box, parse+compile |
| `test/epsil/binder-sites-of.test.ts` | execute-sync, parse |
| `test/epsil/binding-units-static-declarations.test.ts` | execute-sync, static-diagnostics, parse |
| `test/epsil/ce-1303-while-undecided-condition.test.ts` | execute-sync, execute-async |
| `test/epsil/check-epsil.test.ts` | execute-sync, check-api |
| `test/epsil/collection-of-missing-elements.test.ts` | execute-sync, check-source |
| `test/epsil/compiled-declared-function-type.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/epsil/compiled-function-redefinition-effects.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/epsil/comprehension-domain-local-read.test.ts` | execute-sync |
| `test/epsil/comprehensions.test.ts` | execute-sync, execute-async, parse |
| `test/epsil/corpus.test.ts` | execute-sync |
| `test/epsil/declare-type.test.ts` | execute-sync, parse, parse+box |
| `test/epsil/definition-head-multiline.test.ts` | execute-sync |
| `test/epsil/definition-of-library-function.test.ts` | execute-sync, check-api |
| `test/epsil/definition-order-error-value.test.ts` | execute-sync |
| `test/epsil/destructured-parameter-alias.test.ts` | execute-sync |
| `test/epsil/documentation.test.ts` | execute-sync, parse |
| `test/epsil/effects.test.ts` | execute-sync, parse, parse+box |
| `test/epsil/else-if-error-location.test.ts` | execute-sync |
| `test/epsil/epsil-parse.test.ts` | parse |
| `test/epsil/epsil-serialize.test.ts` | parse, parse+box |
| `test/epsil/equation-body.test.ts` | execute-sync, check-source |
| `test/epsil/error-argument-unknown-parameter.test.ts` | execute-sync |
| `test/epsil/execute-async.test.ts` | execute-sync, execute-async |
| `test/epsil/execute.test.ts` | execute-sync, check-source, static-diagnostics, parse, parse+box |
| `test/epsil/formatter.test.ts` | parse |
| `test/epsil/function-body-error-location.test.ts` | execute-sync |
| `test/epsil/function-body-local-assignment.test.ts` | execute-sync, check-source, parse, parse+box, parse+compile |
| `test/epsil/function-declaration-hoisting.test.ts` | execute-sync, execute-async, parse, parse+box, parse+compile |
| `test/epsil/generic-function-sugar.test.ts` | execute-sync, parse, parse+box |
| `test/epsil/hold-functions.test.ts` | execute-sync, parse, parse+box |
| `test/epsil/if-let.test.ts` | execute-sync, parse |
| `test/epsil/integration.test.ts` | execute-sync |
| `test/epsil/item-400-assign-function.test.ts` | execute-sync, parse |
| `test/epsil/iterate-list-with-failed-cell.test.ts` | execute-sync |
| `test/epsil/lambda-arrow.test.ts` | execute-sync, parse |
| `test/epsil/latex-islands.test.ts` | parse |
| `test/epsil/lazy-argument-capture.test.ts` | execute-sync |
| `test/epsil/library-names.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/epsil/lints.test.ts` | execute-sync, parse |
| `test/epsil/list-join-nesting-and-if-frame.test.ts` | execute-sync |
| `test/epsil/mapsto-arrow-diagnostic.test.ts` | execute-sync, parse |
| `test/epsil/match-exhaustiveness.test.ts` | execute-sync, check-source |
| `test/epsil/match.test.ts` | execute-sync, parse |
| `test/epsil/member-call.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/epsil/multi-clause.test.ts` | execute-sync, check-source, parse, parse+box |
| `test/epsil/named-arguments-parse.test.ts` | parse |
| `test/epsil/nested-function-statement.test.ts` | execute-sync, check-source |
| `test/epsil/nested-statement-diagnostics.test.ts` | execute-sync |
| `test/epsil/number-literals.test.ts` | execute-sync, parse |
| `test/epsil/occurrences.test.ts` | parse |
| `test/epsil/parallel-for.test.ts` | execute-sync, check-source, parse, parse+box, parse+compile |
| `test/epsil/parameter-default-values.test.ts` | execute-sync, parse, parse+box |
| `test/epsil/paren-operand-source-range.test.ts` | execute-sync, parse |
| `test/epsil/presence-narrowing.test.ts` | execute-sync, parse |
| `test/epsil/print-input.test.ts` | execute-sync |
| `test/epsil/programs.test.ts` | execute-sync |
| `test/epsil/protocol-extends.test.ts` | execute-sync, parse |
| `test/epsil/protocols.test.ts` | execute-sync, parse |
| `test/epsil/provenance-note.test.ts` | execute-sync |
| `test/epsil/redefinition-discipline.test.ts` | execute-sync, check-source, static-diagnostics, parse, parse+box, parse+compile |
| `test/epsil/renamed-call-error-location.test.ts` | execute-sync |
| `test/epsil/reordered-call-error-location.test.ts` | execute-sync |
| `test/epsil/reserved-words.test.ts` | parse |
| `test/epsil/review-collection-capture.test.ts` | execute-sync |
| `test/epsil/round-trip.test.ts` | parse, parse+box |
| `test/epsil/runtime-error.test.ts` | execute-sync, parse |
| `test/epsil/single-block-program.test.ts` | execute-sync, parse |
| `test/epsil/spread-literal-snapshot.test.ts` | execute-sync |
| `test/epsil/statements.test.ts` | parse |
| `test/epsil/static-check-const-assignment.test.ts` | execute-sync, check-source |
| `test/epsil/static-check-function-on-const.test.ts` | execute-sync, check-source |
| `test/epsil/static-check-leaves-engine.test.ts` | execute-sync, check-api, static-diagnostics |
| `test/epsil/static-check-let-shadows-library-name.test.ts` | execute-sync, check-api |
| `test/epsil/static-check-rollback.test.ts` | static-diagnostics |
| `test/epsil/static-declared-type.test.ts` | execute-sync, check-source |
| `test/epsil/static-diagnostic-code.test.ts` | execute-sync, check-api |
| `test/epsil/static-lambda-callee-arguments.test.ts` | execute-sync, static-diagnostics, parse, parse+box |
| `test/epsil/static-overload-join.test.ts` | execute-sync |
| `test/epsil/std-qualified-name.test.ts` | execute-sync, check-api, parse, parse+box |
| `test/epsil/sum-type-conformance.test.ts` | execute-sync |
| `test/epsil/text-parameter-inference.test.ts` | execute-sync |
| `test/epsil/tuple-param-destructuring.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/epsil/type-annotations.test.ts` | parse |
| `test/epsil/type-conformance-multiline.test.ts` | execute-sync |
| `test/epsil/type-values.test.ts` | execute-sync, parse, parse+box |
| `test/epsil/type-variables-epsil.test.ts` | execute-sync, parse |
| `test/epsil/unknown-call-outside-result.test.ts` | execute-sync, execute-async |
| `test/epsil/while-let-body-diagnostics.test.ts` | execute-sync |
| `test/epsil/while-let.test.ts` | execute-sync, parse, parse+box, parse+compile |
| `test/utils.ts` | parse |

## Candidate delta for execute-sync: added call-token files

1 files.

```text
test/epsil/program.test.ts
```

## Candidate delta for execute-sync: removed call-token files

0 files.

```text
```

## Candidate delta for execute-async: added call-token files

1 files.

```text
test/epsil/program.test.ts
```

## Candidate delta for execute-async: removed call-token files

0 files.

```text
```

## Candidate delta for execute-steps: added call-token files

0 files.

```text
```

## Candidate delta for execute-steps: removed call-token files

0 files.

```text
```

## Candidate delta for check-api: added call-token files

0 files.

```text
```

## Candidate delta for check-api: removed call-token files

0 files.

```text
```

## Candidate delta for check-source: added call-token files

0 files.

```text
```

## Candidate delta for check-source: removed call-token files

0 files.

```text
```

## Candidate delta for static-diagnostics: added call-token files

1 files.

```text
test/epsil/program.test.ts
```

## Candidate delta for static-diagnostics: removed call-token files

0 files.

```text
```

## Candidate delta for parse: added call-token files

1 files.

```text
test/epsil/program.test.ts
```

## Candidate delta for parse: removed call-token files

0 files.

```text
```

## Frozen baseline production/editor entry consumers

Exact identifier references under `src/` and `vscode-epsil/src/`, including route implementations and imports. Shared evaluator/Block/compiler kernels are additional dependencies named by the implementation diff, not separately counted as source-entry consumers.

| File | Identifiers |
| --- | --- |
| `src/cli/check.ts` | executeEpsil, parseEpsil, staticDiagnostics, checkSource |
| `src/cli/compile.ts` | executeEpsil, staticDiagnostics |
| `src/cli/format.ts` | executeEpsil |
| `src/cli/mcp.ts` | executeEpsil, checkSource |
| `src/cli/session.ts` | executeEpsil, parseEpsil |
| `src/cli/types.ts` | executeEpsil |
| `src/compute-engine/constant-assignment-error.ts` | executeEpsil |
| `src/compute-engine/declaration-origin.ts` | executeEpsil |
| `src/compute-engine/docs/for-agents.md` | executeEpsil |
| `src/compute-engine/function-utils.ts` | executeEpsil |
| `src/compute-engine/index.ts` | executeEpsil |
| `src/compute-engine/library/control-structures.ts` | executeEpsil |
| `src/compute-engine/library/core.ts` | executeEpsil |
| `src/compute-engine/types-engine.ts` | executeEpsil, staticDiagnostics |
| `src/epsil.ts` | executeEpsil, parseEpsil, checkEpsil |
| `src/epsil/check-epsil.ts` | executeEpsil, parseEpsil, staticDiagnostics, checkEpsil |
| `src/epsil/docs/epsil.md` | executeEpsil |
| `src/epsil/docs/examples.md` | executeEpsil |
| `src/epsil/docs/for-agents.md` | executeEpsil |
| `src/epsil/docs/getting-started.md` | executeEpsil, checkEpsil |
| `src/epsil/docs/implementation.md` | executeEpsil, parseEpsil |
| `src/epsil/execute-epsil.ts` | executeEpsil, parseEpsil, staticDiagnostics, checkEpsil, executeEpsilSteps |
| `src/epsil/match-exhaustiveness.ts` | executeEpsil |
| `src/epsil/parallel-checks.ts` | staticDiagnostics |
| `src/epsil/parse-epsil.ts` | executeEpsil, parseEpsil |
| `src/epsil/parser.ts` | executeEpsil, parseEpsil |
| `src/epsil/resolve-library-names.ts` | parseEpsil |
| `src/epsil/serialize-epsil.ts` | parseEpsil |
| `src/epsil/static-diagnostics.ts` | executeEpsil, staticDiagnostics |
| `vscode-epsil/src/debug-worker.ts` | executeEpsil, parseEpsil |
| `vscode-epsil/src/inline-runner.ts` | executeEpsil, parseEpsil |
| `vscode-epsil/src/server.ts` | executeEpsil, checkSource |

## Editor protocol test consumers

2 files.

```text
vscode-epsil/test/dap.test.mjs
vscode-epsil/test/lsp.test.mjs
```

## Reproduction of historical/frozen set counts

```python
import subprocess
for rev in ['3938e5938', 'ffff1d44fc566ef01fb52a0ce67b6797797f4dcf']:
    def files(token):
        result = subprocess.run(['git', 'grep', '-l', '-F', token, rev, '--', 'test'], capture_output=True, text=True)
        if result.returncode not in (0, 1):
            raise RuntimeError(result.stderr)
        return {line.split(':', 1)[1] for line in result.stdout.splitlines()}
    execute, parse, box = files('executeEpsil('), files('parseEpsil('), files('.box(')
    print(rev, len(execute), len(execute & parse & box))
```
