You are a headless Claude Code session, `{{NAME}}`. No person reads your
messages until you finish: never ask a question and never wait for an answer.
Your task is one issue of the Compute Engine: **{{ID}}. {{TITLE}}**

Ignore every session-start notice (a nightly run, a line count). Another
session handles it. Do not mention it.

## The approval to commit

The user approved on 2026-11-04 that each session of a batch commits
its own item: "I would be OK if each session did its own commit." This
approval covers the commit of {{ID}} and its review-fix commits, after every
check and review below passes. It does not cover any other item, a push, a
tag or a release.

## Rules

Read `AGENTS.md`, then the documents it names for your work:
`CODING-STYLEGUIDE.md`, `BUILD.md` ("Completing delegated tasks"),
`docs/COMPUTE-ENGINE-BOX-SPECIFICS.md`, `~/.claude/SHARED-BOX-PROTOCOL.md`
(sections 1, 2, 5) and `docs/ISSUE_TRACKING.md`. They apply in full.

Exceptions to the git rules of `~/.claude/CLAUDE.md`, for this item only:
`git worktree add --detach` and `git worktree remove` for your own
worktree, `git apply --check` then `git apply` of your own patch onto the main
tree, and the commit of your own files with
`~/.claude/scripts/stage-helper.mjs prepare --commit` and `commit` (step 9).
Owner name: `{{NAME}}`. Commit message:
`{{ID}}: <what the change does, in one line>`, with no trailer that names a
tool (the commit-msg hook refuses one). Delete an issue file with `rm` and
list the deletion in `--files`; do not stage and run no git command that
writes the index (`git add`, `git rm --cached`, `git commit`), because the
index is shared with the other sessions.

After you write or change an issue file, run `node scripts/issues.mjs lint`
and fix each error before you commit, because the backlog and the board leave
out a file with an error.

Write a temporary file (a probe, a copy of a test) only in `/tmp`, never in
another repo, because the rule that protects the uncommitted work of that repo
allows only reads and test runs there, and never in the main tree, because a
file there enters the test runs and commits of the other sessions.

Edit a source or test file with the Edit tool, not with a Python or sed
script, because the Edit tool refuses a missing or ambiguous match and a script
replaces every match or none without an error.

Give each Jest test file by its path, never by a glob, because a glob that
matches no file leaves Jest with no file argument, and Jest then runs the whole
suite without the box lock.

The main tree is `{{REPO}}`.{{MACHINE}}

A Jest run of more than one test file, in the worktree as in the main tree,
uses `-w 4` and holds the box lock
(`node ~/.claude/scripts/box-lock.mjs acquire {{NAME}} <minutes> "<what>" --wait`,
then `release`), because the default workers (up to 12) of several sessions at once
exhaust the memory of the box (`docs/COMPUTE-ENGINE-BOX-SPECIFICS.md` §2).
Run `acquire … --wait` as a command of its own, with no pipe after it, because
a pipe such as `| head -1` ends the wait before the lock is held.
Release the lock only after the harness's completion notice of the run or the
exit code in its log, never on a line you wrote yourself, because a run that
is still going without the lock competes with the next holder.

## Steps

1. Run `node scripts/issues.mjs start {{ID}} {{NAME}}` in the main tree. If
   it refuses (the file is gone, the state is not `open` or `investigate`,
   the item has `needs-review`, or a confirmed P0 is open), stop and report
   `taken` with its message. Then read `issues/{{ID}}.md`: the witness, the
   cause, the options, and the `## Decision` section when the board decided
   one; follow that decision.
2. Reproduce the witness with `npx tsx scripts/probe.ts` (its header lists
   the options). If it no longer reproduces at the current HEAD, delete
   `issues/{{ID}}.md` (or, for `source: tycho`, set `state: fixed` and
   `fixed-in: <full HEAD hash>` with `issues.mjs set`), commit only that
   change and a known-limitations line in `docs/COMPILATION-MODEL.md` if the
   probes gave one, with the message
   `{{ID}}: no longer reproduces at <full HEAD hash>`, and report
   `not reproduced`, with the probe output.
3. The fix commit removes the issue: delete `issues/{{ID}}.md` in the main
   tree, or, for `source: tycho`, run `issues.mjs set {{ID}} state fixed` and
   `set {{ID}} fixed-in <full HEAD hash>` (Tycho deletes the file when the
   fix verifies), because the web app tells whether a fix is released only
   from a hash or a version. Stage that change with the fix. Right after the
   fix commit, set `fixed-in` to the full hash of the fix commit and commit
   that file alone as `{{ID}}: fixed-in <hash>`, because the HEAD hash names
   the parent, which does not contain the fix.
4. Make a worktree: `git worktree add --detach /tmp/wt-{{NAME}} HEAD`, then
   `{{LINK}}`.
   Write every later command for it with an absolute path or
   `git -C /tmp/wt-{{NAME}}`. When `/tmp/wt-{{NAME}}` already exists, an
   earlier session stopped there, and the "State of the work" paragraph of
   the issue says what remains: do not make a new worktree; read its
   `git -C /tmp/wt-{{NAME}} diff HEAD` and do only the steps that remain. Its
   base can be older than HEAD; step 8 reconciles the patch. Do the fix and
   its tests there: give every Edit and Write a path under `/tmp/wt-{{NAME}}`, never under
   `{{REPO}}`, because an edit in the main tree enters the tests and commits
   of the other sessions before your checks. Do the work
   yourself; use a subagent only for the review.
5. Before the checks and the review, add in the worktree a `CHANGELOG.md`
   item under `[Unreleased]` when users can see the change (the rules are in
   `CODING-STYLEGUIDE.md`), because the reviewers read the item with the
   change, and an item added after the review has no review. Do not edit
   `src/api.md` by hand: it is generated from the doc comments of the
   source, so change the doc comment and leave `src/api.md` to
   `npm run doc`, which the release runs. Update the pages of
   `~/dev/cortexjs.io/docs/compute-engine/` as `AGENTS.md` says when public
   behavior changes.
6. Run the checks of `BUILD.md` "Completing delegated tasks" item 1 in the
   worktree: the test files of the change, the test files that contain a
   fragment of emitted code that the change alters, and `npx oxlint` on the
   changed source files.
7. Review the change as the protocol §5.2 chooses for its risk. A change to
   the logic of `src/` of more than about five lines gets a dual review: a
   new test file does not replace it, because the reviewers look for the
   cases that the tests do not hold. Use the `review-files` skill on the
   changed files in the worktree.
   At most two review rounds. If the Codex reviewer fails on a usage limit,
   finish the Claude review and say so in the report.
8. Deliver: `git -C /tmp/wt-{{NAME}} diff HEAD > /tmp/{{NAME}}.patch` (copy
   new untracked files by hand), then `git apply --check` and `git apply` in
   the main tree. If the check fails, reconcile with the Edit tool. Then run
   in the main tree the targeted tests again and `npm run test:core`, and
   `npm run check:deps` when imports changed. Do not run the full suite
   (`npm test`): the runner of the batch runs it once for each group of
   committed items, in a session of its own that also fixes its failures,
   because a full run for each item took about 10 minutes under the box lock
   and found a cause in the item's change in about one item of eleven. For
   the same reason, search `test/` for each value, message or fragment of
   emitted code that your change alters on purpose, and run and update the
   test files that pin it: a pinned test far from the change is the usual
   failure of the full run.
9. Commit with
   `node ~/.claude/scripts/stage-helper.mjs prepare {{NAME}} --commit --files <f>... --patch <file> --message "{{ID}}: …"`,
   read the patches it prints, then
   `node ~/.claude/scripts/stage-helper.mjs commit {{NAME}}`. Do not stage:
   a staged set waits behind every session that staged and waits for the
   user's commit, and `stage` takes a markdown file whole, with the hunks of
   other sessions. `--patch` names a patch of your own hunks, for each file
   that also holds hunks of other sessions (CHANGELOG.md,
   docs/COMPILATION-MODEL.md, issues/NEXT.md): write
   `git diff --binary HEAD -- <those files>` of the main tree to
   `/tmp/{{NAME}}.own.patch` and delete the hunks that are not yours with the
   Edit tool. On exit 3 (the index lock is held), run `commit` again; on exit
   4 (a file of yours is staged by another session), stop and report it. Step 2
   commits the same way.
10. Remove the worktree with `{{REMOVE}}`
    only after the commit contains your change.

A defect that you find in older code that your change does not touch is an
issue file in `issues/` of the MAIN tree, not of your worktree, written as
`docs/ISSUE_TRACKING.md` ("Who does what") says, and you continue. When the fix
needs a user decision (no option is clearly sound, or a documented contract
changes), write the options with an example for each and your recommendation
in the body of `issues/{{ID}}.md`, run `issues.mjs set {{ID}} state
needs-decision` and `set {{ID}} ask "<one sentence: what the board must
choose>"`, commit nothing else, and stop: a code change committed with the
question can be made wrong or not necessary by the decision, and the board
reads only the issue. When you stop before the work is
done, run `issues.mjs set {{ID}} state open`, add a `## State of the work`
section to the body that says what remains and where the worktree is, and
leave the worktree in place.

## The report

Your last message is the report, in this form and in ASD-STE100 Simplified
Technical English:

```
Result: committed <full hash> | not reproduced | taken | waits for user | stopped
Item: {{ID}}
Summary: <two to four sentences: the cause and the fix, or why you stopped>
Checks run: <each command and its result>
Checks not run: <each one and why>
Review: <dual | one reviewer | own reading>, <rounds>, <findings fixed>
Issues: {{ID}} <deleted | fixed | reopened | needs-decision>; added: <new issue files or none>
Open: <what remains, or none>
Worktree: <removed | path left in place>
git status --short: <its output in the main tree>
```
