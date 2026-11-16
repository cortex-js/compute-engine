# Program consolidation: coordinator review

The bounded patch implements the accepted Program-variable/diagnostic-flow rules
and Program-only replacement. Declaration and assignment contracts remain in
the common sequence/declaration machinery. The checker uses nonmutating use-site
facts and existing validation; execution uses the existing sync/async sequencers.
No Document migration, A1, numeric-context change, IR checking/lowering, new
binder/evaluator, registry snapshot framework or stable-batch walker is included.
No commit, PR or publication was performed.

The production ledger is **+1,056/−1,622 code lines, net −566**, after neutralizing
unchanged moves. Measurements expose costs: normal parse+box **1.636×**, rerun
**1.197×**, checker **1.089×**, real notebook rerun **1.262×**, and approximately
**17–21% more sampled allocation**. Full first execution is 1.016× within the
observed baseline process range. This is a review delivery, not a performance
acceptance or optimization claim. Further production optimization is separate
scope for the coordinator.

## Decisions and witnesses

User acceptance is recorded in the
[semantic decision proposal](../../plans/2026-11-15-program-binding-diagnostic-rules.md).
The [replacement ledger](../../plans/2026-11-15-program-accepted-replacement-ledger.md)
was established before implementation, withdraws the old checker-adapter estimate,
and records revised obligations and integration recosts. No withdrawn estimate
is presented as a budget.

The [observable change ledger](observable-change-ledger.md) gives runtime,
diagnostic, public-type and compilation-coverage witnesses. Important choices:

- Authored-order declaration admission precedes canonical P2 execution order;
  the first declaration stands. Existing function-clause domain collision
  ownership remains separate from later value assignment.
- Unannotated numeric variables use existing Block widening to number; callable
  variables/aliases use function. Actual literals retain names, defaults,
  closure, partial application and effects. Explicit contracts and const writes
  remain enforced. Fresh Program declarations may replace earlier cells.
- A canonical initializer retains its original binding home on replay. The
  bounded declaration-owner fix initializes its prepared binding and rolls back
  to every current incumbent on refusal, including tuple leaves. It preserves
  admitted Error values and committed dependent repairs. Fresh Program boxing
  reads current caller bindings. No initializer rebinding pass was added.
- Program JSON uses existing authored-order metadata so constant defaults survive
  reboxing; internal operands remain canonical. Host Block-as-Program heuristics
  are removed under P1. Final declarations/assignments return Nothing.
- Shared consumer corrections are explicit: implicit Limit over a nonnumeric
  local changes the sum witness 1→3 and length witness→2; Program const-zero
  quotient changes 1→NaN. Host constant-zero behavior remains an older separate
  defect. None changes numeric precision/context.
- Stable contracts permit documented compilation declines. The existing Block
  compiler remains the owner; no compiler shape contract or checker compile
  prerequisite was introduced. Some formerly expected failures now compile.

## Validation and review

[Validation results](VALIDATION.md) include isolated integration at 85752a2d0,
production build/smokes, 90 targeted suites/3,598 tests, core 5,593 tests, and editor
build/DAP/LSP. Source hashes were unchanged. All 4,264 full-suite snapshots pass;
none was added, removed or updated. The full run passed 85,705 tests and failed
one deep IR robustness case; its unchanged file then passed all 68 tests. The
full-only flaky expectation is recorded as CE-1360; the IR implementation and
its test were not changed. The raw full command's exit 1 is retained explicitly.

The final staging set also typechecks alone at newer HEAD 5e286aa36. Newer IR
commits are excluded from causal performance accounting. Dependencies have no
cycles. Source validation covers execute/check/direct sync/async/compile, parsed
containers, source/debug hooks, cancellation, interleaved prepared Programs,
aliases/constants/literal evidence and notebook replacement. Sol performed
bounded implementation and independent reviews; Claude independently reviewed
production and corrective deltas. Final reviews have no introduced finding.
Claude's named-argument concern was closed by three explicit controls.

The [parsed-consumer audit](parsed-consumer-audit-sol.md) found exactly the three
authorized Tycho integrations: prelude-runner, cortex-analysis and notebook
function-definition collection. They recognize Program roots and retain their
existing owners. No Git command ran in Tycho. Full showcase hash parity and real
notebook rerun/edit controls pass in both CE JIT modes.

## Matched measurements and accounting

The [final matched report](FINAL-MATCHED-REPORT.md) compares the final source on
frozen baseline ffff1d44fc, the same production options/dependencies/adapters,
precision 21 and Node 26.13.0. Baseline measurements preceded source edits. Final
CE envelopes have at least two accepted processes per arm/mode. All 15 showcase
hashes and notebook rerun 4/edit 5 controls match; normal timings cover 19 cases.
Two JIT-off Tycho cases have only one accepted baseline process, so no ratio is
claimed for them. Rejected timing windows remain archived, with unchanged
acceptance thresholds. Further repeated off timing was intentionally omitted
after bounded retries; it cannot remove the already observed costs.

All 36 calibrated heap byte-control processes passed. Array release is 12.522 MiB
in both arms, closure release 6.674→6.585 MiB. Sampled allocations increase; normal
post-drop bytes increase approximately 0.56 MiB. These are bounded observations,
not a leak proof or retainer-graph diagnosis. CPU/duration rejection flags are
separate from byte-control validity.

[Final integer attribution](deletion-ledger-attribution-final.md) allocates every
production unit once, across 43 CE and 3 Tycho files:

| Owner | Added code | Deleted code |
| --- | ---: | ---: |
| Shared Program/sequence policy | 284 | 526 |
| Stable variable lifetime/assignment contracts | 188 | 53 |
| Existing evaluation/report hooks | 196 | 132 |
| Checker projection/read-only flow/obsolete controls | 245 | 745 |
| Parser/adapters/compile/consumers | 143 | 166 |
| Total charged | 1,056 | 1,622 |

Raw production is +1,135/−1,724 AST-code lines and +1,308/−3,372 physical lines.
Unchanged retained code is neutral +79/−102; formatting compression earns no
apparent deletion credit. All counts are integer physical-code-line units.
The named retirement inventory is 947 code lines after the documented two-JSDoc
correction; obsolete controls and callers are removed. Tests are separate:
109 CE files +1,207/−672 AST code; four editor files +67/−4. Snapshots 0 changed.
Documentation, scripts, reports and data receive zero production credit; their
separate gross inventory is linked from the final matched report.

## Files and remaining findings

User guides updated in this repo include Epsil type, scope/error examples and
related references. Generated API/errors/library/reference output was produced
by its generators. Outside CE, two authorized pages were edited directly:
`~/dev/cortexjs.io/docs/compute-engine/84-reference-control-structures.md` and
`13-guide-compile.md`; no Git command ran there.

Issue records: two added (CE-1360 full-only IR test flake; CE-1361 older host
constant-zero quotient), three fixed agent issues removed (CE-1008, CE-1252,
CE-1352), and CE-1007 narrowed to its remaining transitive-forward-read case.
Issue lint passes with the pre-existing CE-1254 priority warning. The older host
zero defect is P2 and remains recorded under the repository rule for older
findings; it is unchanged in baseline/candidate. No new source defect is deferred
in this report.

The patch and evidence stop here for coordinator review. No performance-driven
broader binding or analysis architecture was introduced.
