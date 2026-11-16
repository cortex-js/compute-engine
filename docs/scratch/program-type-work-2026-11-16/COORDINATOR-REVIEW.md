# Coordinator review: Program type-demand reduction

The investigation and bounded reduction are complete. **The regression is not
recovered.** No inference precision, declaration/assignment contract, diagnostic
rule or compilation contract was changed to improve the measurements.

[The callsite audit](CALLSITE-AUDIT.md) distinguishes callable classification,
parameter compatibility, result and effect requests. [The passive trace](TRACE-FINDINGS.md)
records actual derivations separately from getter requests and evidence passes.
Every same-node repeated derivation encounters changed observed context or
versions; none establishes unchanged-input equivalence. This does not prove
that every semantic input changed, and matching passive observations would still
be incomplete. No cache or dependency tracker was introduced to bypass that gap.

The concrete notebook witness is `let a=3; let b=a+1; b`. Each analysis/execution
preparation has a fresh `b` binding, initially `unknown`. Initial evidence writes
`number`, marks evidence, and advances its write version plus engine type/any
versions. The same Add is derived again under that changed state in pass 0;
the rejoin returns false without another write. The two preparations have
different binding identities. Equal final printed types do not justify dropping
these reads or the loop-widening fixpoint. The setter/evidence hypotheses were
not implemented.

The patch changes five existing owners. Four point/absence helpers now accept a
deferred type input and evaluate it only after their existing decisive guard.
Demanded arrays still materialize completely, left to right, before type checks.
The ordinary two-scope literal path obtains its shape from the written-scope
signature and asks the existing effects-only query for current effects; generic,
invalid and error fallbacks remain. No new evaluator, persistent cache, registry,
analysis representation or Document work is present. Parameter-only validation
was audited but left unchanged because it was not hot in these fixtures.

[Final matched tracing and measurements](FINAL-MATCHED-REPORT.md) demonstrate one
fewer full signature construction per checker operation (4→3), with effects
queries retained (4→4). Application-type derivations remain 8 for box, 11 for
checker and 4 for notebook. The formerly eager Block derivations move to later
required demands rather than disappear. Type getter requests decrease; their
counts are not presented as fresh computations or inferred redundancy. Evidence
rejoin counts and unknown→number writes are unchanged.

All three arms use one matched protocol: untouched original baseline, frozen
current Program/guard implementation, and that guard plus only this patch.
Unrelated main-tree changes are excluded explicitly. Each warm process uses the
same fixtures, precision, production build options, 1,000 warmups, calibrated
100ms batches and seven samples. Two independent processes per arm/workload
passed the unchanged contention gates; twelve rejected windows are retained.

| Workload | Current/original | Revision/current | Revision/original |
| --- | ---: | ---: | ---: |
| Box | 1.914 | 0.951 | **1.820** |
| Parse+box | 1.623 | 0.924 | **1.500** |
| Checker | 1.098 | 1.002 | **1.100** |
| Real notebook rerun | 1.290 | 0.989 | **1.276** |

Box/parse+box show modest lower medians. Checker/notebook ranges overlap and do
not demonstrate improvement. Every revision range remains above its original
baseline range. Sampled allocations remain elevated too; one profile per arm is
not an allocation confidence envelope. This is a demonstrated narrow work
reduction with substantial residual cost, not a no-regression pass. No acceptance
margin was widened and no further recovery is promised by these data.

Validation passed: isolated typecheck and changed-file lint; main 19 focused
suites/972 tests; core 18 suites/5,593 tests with 15 skips and 1,368 snapshots;
and one isolated full suite, 2,056 passing suites, 85,827 passing tests, 780 skips,
2 todo, 4,264 unchanged snapshots (11 suites skipped). No snapshot was updated.
Main source/test fingerprints stayed identical throughout. The full suite used
a committed `432ad7326` worktree plus only this delta, excluding concurrent peer
edits. [Independent Sol delta review](review-sol.md) found no actionable regression;
the required trap scan passed. After the peer numeric fix was committed, whole
typechecking passed again at latest `a9419091a` plus only these five source edits.
Both temporary implementation/validation worktrees were removed. Exact commands,
exits, source identity, controls
and private evidence hashes are retained in this packet.

[The deletion ledger](DELETION-LEDGER.md) separates this delta (+26/−19 code) from
the cumulative consolidation (+1,087/−1,643, net −556). There are no intended
runtime, diagnostic, public-type or compilation-coverage changes in this delta;
existing sync/async Program, check/execute, compile, effect-scope, explicit
contract, recursive inference, absence, loop and cancellation witnesses pass.

No semantic choice is required for the implemented reduction. The remaining
repeated computations have not been proved safe to remove, so the accepted
precision and evidence rules are retained. No full recovery, broader redesign,
Document migration, new showcase/scalar/browser run or new line budget is
proposed. Original/current/revision roots and raw diagnostics remain private
for audit. No commit or publication was made; unrelated peer edits are preserved.
