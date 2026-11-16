# Initialization contracts: delivery ledger

Status: implementation and validation in progress. This is the bounded D1
replacement authorized on November 16, not implementation of the full prepared-unit
architecture. The acceptance was recorded in
[the design](../../plans/2026-11-16-prepared-binding-replacement.md) before source
edits. Production accounting and final validation below remain pending freeze.

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
| Compiler admission | Source declarations without initializers decline except paired function signatures; generated temporaries are unaffected. Existing `pointLaneMismatch` is reused for collection initialization/assignment whose widened contract hides a known complex lane. No new shape solver or runtime type dispatch. |
| Use-site diagnostics and effects | Retained speculative diagnostic flow, source ranges, effect checks, invalid-expression checks and existing definition restoration. Fixed contracts do not supply path facts. Failed stores keep their previous admitted values. |
| Legacy host/standalone inference | Retained `ce.assign`/`ce.declare`, standalone symbols, function result derivation and runtime binding mechanisms outside the migrated route. These are explicit compatibility consumers, not a fallback for sequence assignment convergence. |
| Versions, expression caches and restoration | Retained type/value/callable versions, `BoundUnit` type environments, callable signature caches, definition restore points and their other consumers. This patch removes solver writes/registrations, not the entire engine cache architecture. |
| Runtime values, effects and numerical configuration | Activation slots/captures, lazy views, value-dependent evaluation, purity/effect state, decimal precision and numeric safeguards remain. No numeric context or backend change. |
| Tycho and publication | Zero Tycho production changes/deletion credit. Existing persistent Program publication and notebook redeclaration remain; D3, Fragment replacement and explicit inter-fragment transfer are not implemented. |

## Accounting rules

Compare the candidate with consolidated anchor
`dbcfdca7e5b5a8852b6554a1ad359dfac4724c1e`. Report physical added/deleted
lines and a separate lexical code-line count from [count-diff.mjs](count-diff.mjs).
That lexical metric excludes comments/trivia and is not the earlier AST metric.
Tests, documentation and private measurement instruments are separate. The earlier
556-line consolidation earns no new credit. Both sides of relocated helper code
are neutral; deleting its old location alone is not a mechanism removal.

Final source census, test/snapshot costs, validation and measurement links will be
filled after the last correctness fix. No performance conclusion follows merely
from the number of deleted lines.
