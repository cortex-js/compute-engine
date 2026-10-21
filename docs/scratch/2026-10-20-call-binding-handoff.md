# Call-head binding: final Claude re-review pending

Owner call-binding; HEAD f3ae576ea. No commits; NOTHING STAGED.
Worktree /tmp/wt-call-binding-20261020 retained, node_modules symlink installed.
All changes applied main; unrelated CHANGELOG/ROADMAP edits preserved unstaged.

Own files: boxed-expression/{box,boxed-function,call-result-type,operand-descriptor}.ts;
compilation/base-compiler.ts; library/collections.ts; types-definitions.ts;
new test/compute-engine/call-head-lexical-binding.test.ts; one exact type pin in
absent-argument-annotated-parameter.test.ts; own CHANGELOG/ROADMAP hunks.

Fixes: annotated call-head parameter creation/validation; body derivation uses
actual binding; mismatched call heads preserve callable contract and literal
body structure. Ordinary ambient-identical calls retain normal precision.
Map omission inspection follows actual held body with cycle guard. Compiler
omission proof checks actual held body, and known captured function-body
mismatches fail closed. Forward placeholders and explicit target operator
overrides retain intentional active lookup. Narrower numeric tuple list pin
is verified (compiled result 3); no broad test weakening/formatting changes.

VERIFICATION: npm run typecheck clean, including cycles/public types. Changed-source
Oxlint + ast-grep clean. Worktree final 285 passed suites, 1 skipped, 11356 passed
tests, 20 skipped, 1 todo, 397 unchanged snapshots, JEST_EXIT=0. Main focused
5 suites / 257 tests / 9 snapshots pass, stable before/after/final fingerprints.
The earlier main broad run passed but a documentation comment changed during
it; do NOT certify that run. Use final isolated worktree broad run instead.
Full suite not run: shared CPU lock held by tycho-1b for ~1h.

REVIEW: Codex final CLEAN. Initial Claude review completed; its precision,
omission and exact-pin/formatting findings are addressed. Final Claude retry
FAILED with API 429 usage_limit_reached; reset 8:20 PM America/Los_Angeles
(2026-10-21 03:20 UTC). A dual review is pending, NOT passed. Nothing is currently
running. No staged files; Ready to commit NO solely for missing final Claude pass.

Artifacts /tmp/call-binding-review-20261020:
- candidate.patch (all own changes, including new test)
- prompt.md + run-review.py + schema.json: exact read-only final review setup
- claude-round1.json: original findings; claude-final-unavailable.json: usage cap
- codex-final.txt: clean final review
- worktree-final-tests.log: broad stable gate (JEST_EXIT=0)
- main-focused.log, main-focused-before/after.txt, main-final-fingerprint.txt
- test-paths.txt, verification-command.txt

CONTINUE: After 8:20 PM Pacific, run python3 /tmp/call-binding-review-20261020/run-review.py
(read-only Claude review, user permanently authorizes Claude reviews). If clean,
join staging queue call-binding with the 11 named own files, separately inspect
index, then git apply --cached --check candidate.patch and --cached candidate.patch
so unrelated Markdown hunks remain unstaged. Queue touch staged; verify cached
patch and diff --check. If review finds a defect, fix in worktree, apply/check
main, run appropriate gates and get final dual review before staging. Do not
commit. After successful staging, archive/delete this scratch and remove worktree
only after exporting/applied changes verified. Report exact pending/passed status.

Resumed: source/test fingerprint unchanged from prior verified main tree. Claude final review running via run-review.py; session output to claude.json/claude.log, completion claude-status.txt (0 means completed, inspect findings). Staging queue empty. Shared test lock still held by tycho-1b, so no full suite launched.

Claude final review after reset completed with 3 findings (claude-round2.json): nested scalar-contract broadcast shape, other application readers losing callee, missing mirror field. All fixed and applied; deriveApplicationOf shared helper routes application descriptors consistently, Apply type-only numeric/boolean contracts preserve broadcast shape, non-lambda operator descriptors retain symbol policy. Added Comprehension/Pipe/Apply/nested-list/never tests. Main 13 suites884 tests301 snapshots pass, stable fingerprint pair main-round3-before/after. Typecheck/lints pass (existing nonfinite hints only). Source scope now additionally core/control-structures/calculus/types-expression. Candidate patch regenerated.
Another session has staged type-defect-fixes (20 files), including peer hunks in boxed-function/collections; DO NOT stage on top. Our CHANGELOG text was swept into their staged Markdown (allowed); own source hunks still unstaged. Final Claude/Codex round3 review to run, plus full isolated worktree suite if shared lock free. Preserve their changes.

Final follow-up: isolated round3 broad gate passed335 suites/13601 tests/702 snapshots (1 skipped suite). Codex caught callable parameter named Return wrongly treated as omission control; fixed describeCallee auto-placeholder distinction, callee-first resultMayBeNothing and omittedReturn skip, regression and explicit compiler refusal. Claude round3 found bare captured Map(h,xs) wrongcode; reproduced [9,9] vs captured7, fixed early BaseCompiler.compile direct-symbol held-Function binding guard before folding, own-body callback omission proof, and deferred ambient lookup performance nit. Bare/wrapped parity-or-refusal regression now26 tests pass. Main typecheck/lints pass. Codex final review clean. Claude incremental final attempt FAILED AUTHENTICATION: "Not logged in · Please run /login" (claude.log); NOT dual-review passed. claude-round3.json contains prior findings, candidate.patch updated with current own diff. Broad final verification currently running; final-broad-tests.log (Python unset, separate parity may be needed), main final focused tests have fingerprint pair final-main-before/after. Another session still owns staged index type-defect-fixes; do not stage over it. Do not commit.

Final broad gate completed:335 suites passed/1 skipped,13490 tests passed/133 skipped/1todo,702 snapshots unchanged,JEST_EXIT0. Python unset in this rerun;4 Python parity suites separately running final-python-tests.log. Main final3 suites55 tests pass with identical fingerprint pair. Final Claude attempt auth failure, needs login before review. No own staging.

Python parity completed4 suites203 tests passed. No running test sessions remain. Resume with Claude login restored, final incremental review, then staging queue (currently type-defect-fixes busy). Do not commit.

User explicitly requested staging for their own Claude review. Staged13 source/test files using stage-source.patch on HEAD3f18a1cbc, preserving unrelated working-tree reversions/derivative changes and Markdown. Queue call-binding staged. Claude final review remains pending and user will run it. Do not commit.

User supplied six dual-review findings. Fixed and RESTAGED19 own files (17source/test +SCOPING-MODEL/ROADMAP), preserving peer unstaged source and Markdown. #1forward-call-reference WeakSet provenance marks valueless auto-declared call heads, cleared at parameter adoption; no Return-specific exception. #3internal anonymousApplicationType helper installed through private callee-type-derivation bridge avoids looking up Apply. #4private descriptor weakmap retains operator definition and derives through optional ownBinding on deriveApplicationType, preserving type handlers/broadcast/reachability. #5tuple rule before type-only all-scalar list gate. #2chose conservative (b), root binder-aware captured-function preflight before compiler folding/inlining; existing interpreter reading unchanged and mismatch/static-model question recorded ROADMAP/SCOPING. Tests now assert ListFrom evaluation9 and compiler refusal for bare/wrapped mismatch, plus named closures parity7/7 and9/9. #6distinct not-in-scope diagnostics.
Broad isolated verification335suites13609tests702snapshots passed WITH PYTHON. Subsequent Coalesce reachability regression/fix, mixed-signature gate restoration, named closure tests: final57 focused tests pass. Main final8suites368tests9snapshots pass with stable followup-main-before/after fingerprints, typecheck and lint pass. Codex final follow-up review clean (/root/call_head_binding_review). User to run Claude final review, not yet passed.
Exact staged snapshot exported from HEAD+index to /tmp/call-binding-index-20261020; staged-typecheck.log passed incl cycles/publictypes; staged-tests.log8suites368tests9snapshots passed. /tmp/call-binding-review-20261020/final-staged.patch is authoritative current candidate (candidate.patch older). Queue call-binding staged; no commit made. New helper files staged. Main full index diffcheck clean. No ongoing tools/tests. User can now review staged files with Claude.
