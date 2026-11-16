# Program-only integration: read-only stop report

No production or test files changed. No worktree created, no staging, commits, tests, timings or builds performed. Actual production/test additions and deletions: 0/0. This report is source inspection, not a demonstrated failing candidate.

## Concrete integration gap

The shared Block canonicalizer already owns declaration hoisting, explicit annotation types, library-constant shadowing, duplicate rejection and assignment-evidence convergence (`control-structures.ts:4337+`, `core.ts:4185+`, `8435+`, `8589+`). A checker must consume that ownership rather than independently declaring or binding these names again. The existing checker cannot simply retain its statement boxing loop around a new Program.

However, the checker also preserves statement-sensitive callable metadata that the common canonicalizer does not currently expose. `static-diagnostics.ts:2494+` (`registerPinnedSignature`) tracks inferred literal contracts, assignment replacement, parameter names and aliases. `pinnedAliasOf` at 2718+ captures the literal in force at an alias statement; later replacement of the original does not change that alias. `applyAssignmentTypeEffect` at 758+ records last-statement literal evidence in `_staticAssignmentEvidence`, whereas the common evidence session joins/widens possible values. `box.ts:3282+` deliberately checks inferred lambda calls more strictly only during static checking; ordinary boxing must continue to admit them until runtime application. The distinction is a current contract, not permission to make ordinary Program boxing stricter.

A before/after observer that invokes these existing checker helpers would still run their independent replacement/pinning/alias transition rules during canonicalization. Changing who schedules the calls does not establish common ownership. Conversely, boxing the whole Program and then running the checker over its final joined types loses the statement-specific callable/evidence state. The missing design is the minimum shared transition/metadata ownership needed to retain these diagnostics without a second preparation algorithm. This does not establish that a broad prepared-type framework is needed, or that a bounded extraction is impossible; it establishes that the proposed 55–75-line checker-adapter estimate has not been justified.

## Existing contract witnesses

- `test/epsil/binding-units-static-declarations.test.ts:26`: `let k = (n: integer) => n + 1; k(1.5)` must produce the static incompatible-type diagnostic.
- `test/epsil/static-lambda-callee-arguments.test.ts:114`: the same call through `let x = 1.5; k(x)` uses assignment evidence; unknown evidence remains provisionally admitted.
- `test/epsil/static-lambda-callee-arguments.test.ts:314+`: `let g = k; g(1.5)` retains the literal contract; subsequent tests pin the alias's signature at the time it is copied.
- `test/epsil/static-lambda-callee-arguments.test.ts:306`: outside checking, boxing `k(1.5)` remains valid and runtime application supplies Error.

These are inspected current expectations, not new test results or a count of candidate failures. Raw typo, guarded-presence, source/provenance and diagnostic-location scans may remain checker-only: their existence is not the stop condition.

## Ordering and other integration responsibilities

P2 moves function statements ahead of assignments and constants. Accordingly `installAssignedLiteralBeforeClause` and its saved-literal workaround are not evidence that the old transition machinery must all survive. Shared hoisting also replaces checker annotation/shadow declaration emulation; do not charge those old bodies again.

Program-specific sequence policy must preserve grouped multi-clause functions and paired signature declarations without applying Block's same-name local-function rejection. It must reuse `DefineFunction`/`defineFunctionClause`, including generic and declaration-origin behavior. Registry publication/restoration stays the existing static-check push/pop, definition restore point, type rollback and protocol rollback (`static-diagnostics.ts:620–700`), with no new snapshot framework. Top-level legality must be positional rather than inferred from the caller's scope.

A viable source mapping can remain a canonical-to-source permutation keyed by the canonical Program, without retained raw AST; raw statements stay local to the execute/check call for source diagnostics. This is a proposed mapping, not an implemented or validated API. The existing synchronous/asynchronous statement evaluators would retain sequencing, cancellation, debugger and result hooks; no new evaluator is proposed.

## Recost disposition

Original authorized planning interval: 313–448 combined genuine production additions against 538 named removals. Existing helper relocation is neutral: it is neither a new addition nor deletion credit. No measured candidate diff supports a revised numerical interval. In particular, the helper bodies are not all necessary after P2, and counting them as new code would be false.

Before restarting implementation, specify the common owner of statement-sensitive callable contracts, alias snapshots and diagnostic evidence, show which checker transition helpers disappear or reduce to reporting, and then replace the checker integration ledger row. Include grouped clause/pair handling and source-hook integration in that ledger. Only that extraction design can establish whether the total stays within 448 and whether genuine named removals yield a production reduction. Weakening checker diagnostics or retaining their independent binding algorithm is not a sound narrow fallback under this authorization. The sound current action is to stop the implementation and report this scope gap.
