STAGED 2026-10-21 — producer slice ready after final typecheck/format gate.
7 own files staged via producer-only.patch + producer-docs.patch, source/test
index hashes verified equal /tmp/raw-view-producers-final-20261021 candidate.
Exact candidate 7 suites787tests212snapshots pass. Claude and Codex clean after
shape fixes (omission scalar coordinates, tuples as scalar cells, empty axes).
Claude final producer-claude.json findings[]. No code changes since reviews
except Prettier line wrapping in owned tabulateElement helper.
Only staged raw-producer behavior is ready for user commit. Hoisting is preserved
unchanged; shared declaration preparation and sticky unresolved-call results
must be implemented together in NEXT slice. Failed hoist prototype not in main.
Other main unstaged source/docs are peers or accepted future design notes; do
not sweep them. Never commit. Queue owner raw-view-producers.

FINAL PRODUCER CANDIDATE 2026-10-21:
Main7targetedsuites781tests212snapshots pass, maintypecheck passed; source3
Oxlint and ast-grep clean. Current-head snapshot /tmp/raw-view-producers-final-20261021
had6unchangedtargetedsuitespass and finalproducer21testspass after removing
frozen-result testcase (that testcase stays in old WT followup).
Codex final review clean. Claude final producer-only review running via
run-producer-review.py; completion producer-claude-status.txt / producer-claude.json.
Only producer-only.patch + producer-docs.patch should be staged, after queue.
These patches checked against current index. Shared-main peer source hunks must
stay unstaged. No changes to boxed-function or Epsil belong to this staging set.
Naive failed hoist experiment is saved failed-function-only-hoist.patch and removed
from old WT source. Old WT still retains unresolved-result freezing experiment.

UPDATE 2026-10-21: user chose preserving function declaration hoisting.
We are landing ONLY raw-producer changes in this slice. Frozen unresolved-call
changes were removed from main via defer-unresolved-followup.patch; preserved
in /tmp/wt-raw-view-producers-20261020 for the next slice. No producer code lost.
Naive Epsil function-only prebox/caching experiment caused real failures of
variable capture/effect checking and nominal constructors (hoist-epsil.log).
Do not land that experiment. Shared declaration preparation is required.
Main CHANGELOG/ROADMAP premature resolved claims corrected.
Current producer-only immutable candidate based on b8ee30edc43b:
/tmp/raw-view-producers-final-20261021, patch producer-only.patch in reviewdir.
Typecheck and 7 targeted suites in progress (producer-only-*.log).
Need final clean review for this narrower candidate, then only producer hunks
staged; other peer main source changes must remain unstaged. Never commit.

Prior history (superseded where above differs):
Raw-view producer slice in progress; no commit, no own staging. Worktree
/tmp/wt-raw-view-producers-20261020 from c43a44d41. Main contains early/partial
owned patch plus peer changes: never stage whole collections/boxed-function/
base-compiler/ROADMAP/CHANGELOG. Current owned diff exported as
/tmp/raw-view-producers-review-20261020/candidate-in-progress.patch.
User leans capture ordinary values on assignment; not implemented. User chose
already evaluated unresolved calls stay symbolic (original call can resolve).
Implemented private independent unset binding cached per original slot, marker
compiler preflight, equality distinction, parse-scope preservation. Added clone
seam in boxed-value-definition; compare.same guards frozen/live head identity.
Producer changes: Tabulate leaf omission types, nested rows lazy with typed fresh
index. Named generators use own captured binding; literals use intrinsic Apply
binding via borrowed scope cleared before pop (not ambient Apply, no private
alias leaking into JSON). Shape now handles bounded nested lazy rows with cycle
guard. Scan/Iterate retain omission types; compiler Tabulate/Scan guards use
callbackIndex throughout. Tests cover raw counts/positions/compaction, callback
count, shadow/update/Apply override, name collision, JSON/Shape, frozen calls.
Reviews: Claude final prior candidate clean. Codex caught row parameter collision
and explicit Apply in compiler-order prototype; collision fixed. Order prototype
removed since it incorrectly changed existing intentional declaration hoisting.
Saved declaration-order-experiment.patch. User question pending: preserve function
declaration hoisting across executeEpsil vs whole-block boxing/compilation, or make
function declarations ordered too. Do not implement either until answer. ROADMAP
records route discrepancy. Other ordinary assignments remain execution ordered.
Tests: 53producer suites initially exposed3previousslice batch9 failures fixed by
sticky symbolic result. Focused 373tests passed before finalguard refinements.
Latest broad immutable snapshot at /tmp/raw-view-producers-verified-20261020 ran
468suites but old prototype rejects intentional hoisting test; do not claim all
passed. Latest immutable snapshot lacks final small collision/prototype cleanup.
Need final typecheck/main targeted stablefingerprints, review of final cleanup,
then stage own hunks only after queue. Main HEAD advanced by peer to2aa130e8.
Claude must run outside sandbox require_escalated to access login; wrapper in
producer-review directory. Never commit.

Latest cleanup: removed compiler declaration-order prototype from both WT/main;
restored existing compile-block-local-function hoisting test in WT. Epsil test now
only asserts sequential sticky results for direct/Apply/inline-lambda calls; no
compiler-order refusal assertion. Named unresolved Tabulate generators still
produce lazy rows before definition; missing callback does not prevent row count.
Latest policy-independent7suites439tests pass, main fulltypecheck passes. Broad
immutable snapshot had465passed,2failed,1skipped: old prototype hoisting refusal
and performance on shared subtree (prototype traversed DAG repeatedly); both
prototype effects removed, not yet broad-rerun.1142snapshots unchanged. Do not
claim all broad tests green or ready to commit. User's hoisting question pending.
