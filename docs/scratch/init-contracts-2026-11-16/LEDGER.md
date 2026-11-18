# Initialization contracts: delivery ledger

The November 18 candidate replaces assignment convergence on the source at
`fd7bad6e1`. The shared checkout advanced by two documentation files before
integration, then picked up independent compiler work through `41e777da6`.
The [candidate patch](current-candidate.patch) was checked against both
checkouts. All matched measurements use the frozen `fd7bad6e1` pair.
The [per-file census](current-counts.json) covers 17 production TypeScript
files, with 323 physical lines added and 1,130 removed, a net reduction of 807.
Counting only token-bearing lines gives 264 added and 785 removed, or 521 net
removed. The absence helper and residual-signature helper move between modules
and earn zero net credit. The earlier consolidation is excluded.

## What disappears, and why

| Removed mechanism | Former production owners and callers | Obligation eliminated by the accepted semantics |
| --- | --- | --- |
| Evidence session, engine-keyed `SESSIONS`, nesting depth, site array and lost-binding set | Deleted `library/assignment-evidence.ts`; `canonicalSequence()` in `control-structures.ts` | Later writes cannot change contracts, so preparation does not need an enclosing convergence session. |
| Registered `rejoin`/`reset` closures, normal/coarse passes, pass budgets, depth coarsening and global unknown reset | `withEvidenceSession`, `registerEvidenceSite`, `evidencePassBudget`, `coarsenEvidenceType`; former declaration, assignment and loop-index callers | No assignment constraint propagation or termination policy remains. Unknown is an intentional final contract, not a solver recovery state. |
| Structural assignment joins, including rank-aware list joins and tuple slot joins | `joinEvidenceTypes`/`joinListEvidence`; `core.ts:joinEvidenceOnBinding` | A later list/tuple store is admitted against one contract; it cannot enlarge that contract. Ordinary union/subtyping utilities remain. |
| Per-write inference and broad type-write events | `core.ts:joinAssignmentEvidence`, `writeEvidenceType`, `recordPatternEvidence`, their `Assign`/`Declare` callers; `_assignmentEvidence` guards/snapshots in definitions, symbols and function parameter handling | Neither plain nor destructuring writes supply type evidence. Initializer typing still writes a finalized type during preparation. |
| First-value/open/lost-evidence classifications | `declared-local.ts` first-value/open sets and functions, plus re-exports from the deleted solver | Initialization choice is explicit; a final unknown contract never means “wait for a later assignment.” |
| Loop-index evidence registrations and back-edge rederivation | `control-structures.ts:canonicalLoopLike` retained site closures, saved pattern error, lost-name tracking, coarsen/reset calls | Index contracts derive from the source's finalized collection contract. Later writes cannot change its shape. |

There is no retired-solver fallback for Program, Block, nested loops or Match.
Match still prepares case closures to check assignments/effects in their capture
scope. That traversal is retained work, not a deleted traversal renamed as checking.
Its former evidence-session condition disappears. The existing evaluator and
compiler execute the result; no experimental walker is involved.

## Work that remains or is added

| Mechanism | Disposition and consumers |
| --- | --- |
| Initializer type derivation, lexical hoisting, declaration ordering, function signatures, invalid siblings | Retained in existing `canonicalSequence`/`Declare` machinery. Closed literal types may be known at hoist; other initializers are typed when reached. This is not a dependency-order inference graph. |
| Fixed contract flag and finalization | New `_fixedInitializationType` and `initializeLocalContract` in `boxed-value-definition.ts`, with guards in symbols, callable binding, engine assignment, definition type access and existing snapshots. Declared/inferred provenance remains useful for callable diagnostics but does not permit runtime contract repair. |
| Deferred initialization discovery | New temporary map/set in `canonicalSequence`; a syntactic straight-line scan accepts a later structural initializer before use and stops at calls/control flow. It is discarded after preparation. No persistent cache, dependency edges, revision or parent chain. |
| Uninitialized-read admission | New source-only `_requiresInitialization` metadata for newly admitted declarations without values. Reads consult the existing physical stored slot, distinguishing deliberate value shields from missing initialization. Existing hoisting, failed declarations and imported bindings keep their rules. No new activation store. |
| Assignment admission, absence and destructuring | Retained `assertAssignable`, local mismatch checks, tuple leaf typing and atomic runtime writes. `initializationType` preserves the domain of proved-absent values; its existing logic is relocated, receiving zero removal credit. |
| Callable initializers and partial application | Reuse existing residual-signature helper in anonymous call typing, so a partial application can initialize a callable. Mapped or uncertain partial results conservatively remain unknown. Relocating the helper receives zero deletion credit. Constants retain necessary inferred callable provenance while writes remain forbidden. |
| Written unannotated parameters | Existing assignment identity metadata now finalizes these parameters as unknown at literal close and discards their use requirements. The first assignment resolves an unread parameter through its existing shadow frame. No RHS analysis, new tracker or recursive solver. |
| Compiler admission | The November 18 base uses a single IR compiler. Its existing admission declines uninitialized source locals and the complex-point input witness. No retired compiler guard or IR change is included. The public fallback returns the interpreter value. |
| Matrix product order | A fixed unknown binding can hold a matrix. Existing matrix-operand predicates now preserve noncommutative order for it. SVD reconstruction with unannotated destructured factors exposed this obligation. |
| Use-site diagnostics and effects | Retained speculative diagnostic flow, source ranges, effect checks, invalid-expression checks and existing definition restoration. Fixed contracts do not supply path facts. Failed stores keep their previous admitted values. |
| Legacy host/standalone inference | Retained `ce.assign`/`ce.declare`, standalone symbols, function result derivation and runtime binding mechanisms outside the migrated route. These are explicit compatibility consumers, not a fallback for sequence assignment convergence. |
| Versions, expression caches and restoration | Retained type/value/callable versions, `BoundUnit` type environments, callable signature caches, definition restore points and their other consumers. This patch removes solver writes/registrations, not the entire engine cache architecture. |
| Runtime values, effects and numerical configuration | Activation slots/captures, lazy views, value-dependent evaluation, purity/effect state, decimal precision and numeric safeguards remain. No numeric context or backend change. |
| Tycho and publication | Zero Tycho production changes/deletion credit. Existing persistent Program publication and notebook redeclaration remain; D3, Fragment replacement and explicit inter-fragment transfer are not implemented. |

## Accounting rules

[count-diff.mjs](count-diff.mjs) compares the candidate against its own HEAD and
includes untracked TypeScript tests. The lexical metric counts lines containing
TypeScript tokens. Comments, documentation and measurement scripts receive no
production credit. The 32 TypeScript test files add 488 physical lines and
remove 222 (+266). Two additional Epsil corpus fixtures gain annotations.
All 4,084 snapshots passed in the first current-source full run.

The [matched measurements](MEASUREMENTS-CURRENT.md) compare the patch against
both its source control and the original baseline. The [witness results](WITNESSES-CURRENT.md)
distinguish original source, annotation migrations, interpreter fallback and
native compilation.

## Coordinator decision

**Revise before adoption.** The candidate clears the mechanism-removal gate.
On the real notebook rerun it brings evidence passes from two to zero and
actual bound-call derivations from four to three. On the loop-carried
collection fixture, boxing eliminates 24 rejoins and reduces bound-call
derivations from 468 to 380, while binding declared-type reads rise from
4,997 to 9,752. Declaration typing, admission and repeated contract reads
still have a cost after convergence disappears.

Relative to the current control, median boxing improves about 10% and notebook
reruns about 6%. Relative to the original baseline these still take 1.71× and
1.27× as long. First Program `N()` takes 1.23× as long as the current control
and repeated collection `N()` takes 1.12×. The approved semantics and measured
code reduction can be reviewed independently of the outstanding performance
gate. Further optimization requires a separate coordinator decision.

## Validation

The frozen candidate passed 1,910 suites, 73,963 tests and 4,084 snapshots
(10 suites and 763 tests skipped, one todo). The first run before the matrix
correction and expectation migrations had ten failures in four suites.
TypeScript, changed-source lint, dependency-cycle checks and independent Sol
review passed. A second full run on the integrated shared checkout passed 1,912
suites, 73,983 tests and 4,084 snapshots, with the same skip/todo counts.
On the shared checkout the 17 surviving curated suites passed
5,058 tests and 1,341 snapshots. The `test:core` wrapper itself exits 1 on
its stale compiler-test path, also absent at the unchanged control. See
[CE-1446](../../../issues/CE-1446.md).

The in-repository Epsil guides and the CE type and error references accompany
the source patch. The public site edits live in the separate cortexjs.io
checkout under `docs/compute-engine/`:

- `08-guide-types.md`
- `13-guide-compile.md`
- `84-reference-control-structures.md`
- `85-reference-core.md`
