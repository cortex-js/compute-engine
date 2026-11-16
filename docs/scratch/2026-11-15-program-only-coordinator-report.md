# Program-only replacement: stopped at checker integration

Status: stopped before implementation, for coordinator review. The user required
stopping and recosting if integration retained a second binding algorithm. No CE
or Tycho production source changed; this is an evidence delivery, not a completed
Program patch or an implementation acceptance result.

## Boundary finding

The bounded Sol implementer and an independent Sol reviewer agree that the
checker portion of the proposed replacement needs a new design and cost before
implementation. See the [implementer's cost review](2026-11-15-program-only-implementation-cost-review.md)
and the [independent source review](2026-11-15-program-only-independent-review.md).
The [authorized scope](../plans/2026-11-15-preparation-responsibility-split.md)
estimated 55–75 production code lines for checker consumption of shared
canonicalization and declaration metadata. Current sequence canonicalization
does not supply all the sequential binding facts that existing diagnostics use.

`registerPinnedSignature()` in `src/epsil/static-diagnostics.ts` chooses which
signature a replacement retains, replaces or aliases, writes definitions through
`_infer`, and supplies `_staticPinnedCallees` to later call boxing.
`applyAssignmentTypeEffect()` supplies last-write and concrete literal evidence;
the existing canonicalizer instead joins assignment evidence across the sequence.
Calling those helpers from canonicalization observers would remove an independent
loop while retaining independent binding transitions. Dropping them would weaken
diagnostics that this task requires preserving.

Existing witnesses, read rather than executed in this investigation, are in
`test/epsil/static-lambda-callee-arguments.test.ts`: integer-lambda argument
rejection (line 43), literal assignment evidence (114), replacement signature
(209), constant signature retention (221), and aliasing the signature in force at
that statement (340). They are ordinary callable and assignment programs.

This does not establish that a broader prepared-type bridge is necessary or that
Program is infeasible. Approved P2 ordering can eliminate much of
`installAssignedLiteralBeforeClause()`; shared hoisting already covers some
annotation and shadow work. Their full helper bodies must not be treated as
unavoidable additional implementation.

## Recost disposition

Keep the named 538-code-line removal target as a requirement, with no earned
credit in this delivery. Withdraw confidence in the 55–75 checker-adapter budget
and therefore in the aggregate 313–448 addition estimate. A replacement interval
is not yet substantiated: counting moved helper bodies as new code would inflate
it, while calling them observers would conceal the duplicate mechanism.

The smallest revised design should identify one authoritative implementation of
literal signature retention/replacement and alias transitions, preferably using
existing assignment machinery; define the minimal per-use evidence diagnostics
consume; and list the corresponding changes to declaration/assignment,
call-validation, checker and rollback callers. Then count genuine integration
additions and named removals with moved bodies neutral. This is the missing cost
exercise, not authorization to build a general analysis framework.

No new evaluator, registry snapshot framework, A1 publication amendment,
Document revision, numeric-context change, experimental walker, compiled Program
runner or symbol-sites API was introduced. No Tycho consumer edit was needed
because the parser has not changed.

## Measurements and validation

[Baseline observations and raw artifacts](program-only-baseline-2026-11-15/REPORT.md)
record source/build hashes, commands, exit codes, samples, spread and limitations.
The frozen-source production bundle build and both normal measurement commands
exited 0. CE correctness assertions passed for result 10, invalid-sibling
continuation to 5, and zero diagnostics for the type/protocol workload. All 15
showcase preludes completed with valid results, including full large
initializations.

These measurements are exploratory, not an established acceptance envelope.
Competing CPU activity and the stopped work prevented isolated repeatability;
JIT-off did not run. The notebook adapter returned `cycle` before execution, so
its times are invalid. Heap observations do not isolate retained state and are
inconclusive. There is no candidate measurement, regression comparison or speedup
claim.

Execute/check/direct-evaluation/compile parity, parsed-container migration,
sync/async cancellation, source/debug hooks, checker presence/provenance and
registry restoration, CLI/repl, notebook reruns, and mathematical caller
integration are **not validated for Program**: no candidate exists. Named prelude
execution alone does not certify action/plot integration. Full/core/targeted test
suites, typecheck, dependency checks and implementation code review were omitted
because implementation stopped before edits. Independent review covered the
boundary finding, not a production patch.

`node scripts/issues.mjs lint` exited 0: 193 files, zero errors, with the existing
CE-1254 priority warning. Issues added/removed: 0/0. This investigation established
a scope/cost gap, not a new production defect.

No task worktree was created. Temporary source/build snapshots and report copies
were removed after preserving measurements, manifests, adapters and reviews.
The measurement lock was released. Other sessions' changes were preserved.

## Actual deletion ledger

| Category | Added code lines | Deleted code lines | Physical additions/deletions |
| --- | ---: | ---: | ---: |
| CE production | 0 | 0 | 0 / 0 |
| Tycho production | 0 | 0 | 0 / 0 |
| Tests | 0 | 0 | 0 / 0 |
| Measurement adapters | 84 | 0 | 85 / 0 |

The two adapters are `ce-bench.mjs` (42 AST-leaf code lines, 43 physical) and
`tycho-bench.mts` (42 code, 42 physical). TypeScript AST parsing reported no parse
diagnostics. Code lines intersect nontrivia AST leaf tokens, as the design ledger
requires; reports, hashes, raw JSON and logs are evidence artifacts and receive
no production deletion credit. No snapshots, pinned emissions or semantic test
expectations changed. None of the named preparation helpers has been deleted.

The production reduction acceptance condition is unmet. Do not stage or describe
these artifacts as the Program implementation.
