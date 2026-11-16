# Coordinator review: bounded Program reduction

The bounded revision is complete. **This remains a simplification, not a
performance pass.** No second optimization round or wider acceptance margin is
proposed. The source patch is `revision/program-reduction-sol.patch`; changes
are also present in the main working tree for review.

Initial V8 CPU/allocation profiles locate added work under existing sequence
canonicalization, type/signature calculation and metadata construction. Public
boxing calls actually decreased. See [initial evidence](REPORT.md), its exact
source-map proof and raw-profile archive link. The separately calibrated scalar
control does not establish a shared-engine regression: accepted independent
candidate coverage was insufficient and direct/cached control ranges varied.
The old 4ns→13ns observation is not used as regression evidence.

The patch skips ordinary-call named-argument splitting, empty diagnostic entries,
five Program-only maps in Blocks, and needless empty constant sets. Structural
read-before checking precedes validity work when it finds no read; valid function
initializers use their known function identity before demanding a full signature.
Invalid/nonliteral fallbacks, canonical binding ownership, assignment evidence,
nonmutating flow, cancellation prefixes and source hooks remain. No persistent
cache, duplicate binder/checker path, IR lowering or Document change was added.

[Fresh matched measurements](REVISION-REPORT.md) compare the frozen accepted
implementation with only this patch applied, using identical production builds,
Node/V8, precision, fixtures and consumer adapters. Ordinary timing ratios
revision/accepted are box **0.977**, checker **1.006**, real notebook rerun
**0.985**. Process variation makes these inconclusive. Sampled allocation changes
are box **−2.1%**, parse+box **−0.3%**, checker **−0.1%**, notebook **−0.7%**;
call counts are unchanged. Controls pass; rejected contention windows and invalid
loader attempts are retained and excluded.

The earlier matched accepted/original-baseline costs remain unresolved: box
1.604×, parse+box 1.636×, checker 1.089× and notebook rerun 1.262×. A new
revision/original latency envelope was not measured; historical ratios are not
multiplied into the new window. Revision allocation remains above the earlier
original-baseline sampled estimates by roughly 63%, 48%, 15% and 29% respectively
(an explicitly unpaired diagnostic comparison). These guards do not recover the
main type/signature workload. That is the remaining regression, not a pass.

Validation: whole typecheck and changed-file oxlint passed in Sol's isolated
worktree; all three files matched main byte-for-byte. Main targeted tests passed
11 suites/525 tests. Core passed 18 suites/5,593 tests, with 15 skips and all
1,368 snapshots unchanged. Fingerprints show an untorn run. The first Watchman
attempt ran no suites despite exit 0; it is invalid, retained, and replaced by
the successful `--watchman=false` runs in `validation.json`. Independent
[Sol delta review](review-sol.md) found no actionable regression; its required
trap scan passed. Production build and every measurement control passed.

The [deletion ledger](DELETION-LEDGER.md) records this revision separately:
production +26/−23; cumulative charged +1,061/−1,624, **net −563**. Tests and
snapshots: zero changed. Instruments and measurement data are counted separately.
There are no intended runtime, diagnostic, public-type or compilation-coverage
changes in this delta; existing direct sync/async, execute/check, compile,
default/named-call, cancellation and nested-Block witnesses passed.

Unchanged broad semantic/consumer, editor, documentation and showcase validation
from the accepted packet is reused. No full suite, full showcase rerun, Document
migration, additional scalar retry or broad analysis framework was added. Private
frozen comparison roots and raw profiles remain available for coordinator audit;
the temporary implementation worktree is removed. No commit or publication was
made. Pre-existing untracked plans, handoffs and CE-1358 are outside this patch.
