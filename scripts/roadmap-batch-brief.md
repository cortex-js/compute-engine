You are a headless Claude Code session, `{{NAME}}`. No person reads your
messages until you finish: never ask a question and never wait for an answer.
Your task is one ROADMAP item of the Compute Engine: **{{ID}}. {{TITLE}}**

Ignore every session-start notice (a nightly run, a line count). Another
session handles it. Do not mention it.

## The approval to commit

The user approved on 2026-11-04 that each session of a ROADMAP batch commits
its own item: "I would be OK if each session did its own commit." This
approval covers the commit of {{ID}} and its review-fix commits, after every
check and review below passes. It does not cover any other item, a push, a
tag or a release.

## Rules

Read `AGENTS.md`, then the documents it names for your work:
`CODING-STYLEGUIDE.md`, `BUILD.md` ("Completing delegated tasks"),
`docs/COMPUTE-ENGINE-BOX-SPECIFICS.md`, `~/.claude/SHARED-BOX-PROTOCOL.md`
(sections 1, 2, 5) and the header of `ROADMAP.md`. They apply in full.

Stop and report when you have made about 150 tool calls, when the same
failure comes back a third time, or when the planned approach does not work.
Report what you tried, the state of the diff, what is still open, and the
next step you propose. Stopping is a normal result, not a failure.

NEVER run `git stash`, `git checkout`, `git restore`, `git reset`, or ANY git
command that modifies the tree or index. If the working tree looks wrong,
inconsistent, or contains unexpected changes, STOP and report; do not attempt
to clean, baseline, or recover it.
Exceptions: `git worktree add --detach` and `git worktree remove` for your own
worktree, `git apply --check` then `git apply` of your own patch onto the main
tree, staging your own files only with `~/.claude/scripts/stage-helper.mjs`,
and `git commit` of what you staged. Owner name: `{{NAME}}`. Commit message:
`{{ID}}: <what the change does, in one line>`, with no trailer that names a
tool (the commit-msg hook refuses one).

Wrap every test run in `timeout -k 30 600 …`, for example
`timeout -k 30 600 npx jest -w 2 -- test/compute-engine/<file>.test.ts`.
Run a check without a pipe and record its own exit code, because the exit
status of a pipeline is that of its last command.

Edit a TypeScript file with the Edit tool, not with a Python, sed or heredoc
script, because a script replace can change every match or none with no error.

Write a temporary file only in `/tmp`, never in another repo, because the rule
that protects the uncommitted work of that repo allows only reads and test runs
there.

## Steps

1. Read the entry {{ID}} in `ROADMAP.md`. If it is gone, or its state is not
   `ready`, another session took it: stop, and report `taken`.
2. Reproduce the witness with `npx tsx scripts/probe.ts` (its header lists
   the options). If it no longer reproduces at the current HEAD, remove the
   entry, commit only that `ROADMAP.md` change, and a known-limitations line in
   `docs/COMPILATION-MODEL.md` if the probes gave one, with the message
   `{{ID}}: no longer reproduces at <full HEAD hash>`, and report
   `not reproduced`, with the probe output.
3. Remove the entry from `ROADMAP.md` in the main tree (read the file again
   just before the edit; other sessions edit it too). When the entry has
   sub-items, take the first sub-item that needs no user decision, and remove
   only its bullet.
4. Make a worktree: `git worktree add --detach /tmp/wt-{{NAME}} HEAD`, then
   `ln -s /Users/arno/dev/compute-engine/node_modules /tmp/wt-{{NAME}}/node_modules`.
   Write every later command for it with an absolute path or
   `git -C /tmp/wt-{{NAME}}`. Do the fix and its tests there. Do the work
   yourself; use a subagent only for the review.
5. Run the checks of `BUILD.md` "Completing delegated tasks" item 1 in the
   worktree: the test files of the change, the test files that contain a
   fragment of emitted code that the change alters, and `npx oxlint` on the
   changed source files.
6. Review the change as the protocol §5.2 chooses for its risk. A change to
   the logic of `src/` of more than about five lines gets a dual review: a
   new test file does not replace it, because the reviewers look for the
   cases that the tests do not hold. Use the `review-files` skill on the
   changed files in the worktree.
   At most two review rounds. If the Codex reviewer fails on a usage limit,
   finish the Claude review and say so in the report.
7. Deliver: `git -C /tmp/wt-{{NAME}} diff HEAD > /tmp/{{NAME}}.patch` (copy
   new untracked files by hand), then `git apply --check` and `git apply` in
   the main tree. If the check fails, reconcile with the Edit tool. Then run
   in the main tree the targeted tests again and `npm run test:core`, and
   `npm run check:deps` when imports changed.
8. Add a `CHANGELOG.md` item under `[Unreleased]` when users can see the
   change (the rules are in `CODING-STYLEGUIDE.md`). Do not edit
   `src/api.md` by hand: it is generated from the doc comments of the
   source, so change the doc comment and leave `src/api.md` to
   `npm run doc`, which the release runs. Update the pages of
   `~/dev/cortexjs.io/docs/compute-engine/` as `AGENTS.md` says when public
   behavior changes.
9. Stage with `node ~/.claude/scripts/stage-helper.mjs prepare {{NAME}} …`
   and `stage {{NAME}}`, read the patches it prints, and commit. On WAIT,
   run `node ~/.claude/scripts/staging-queue.mjs wait {{NAME}}`.
10. Remove the worktree with `git worktree remove --force /tmp/wt-{{NAME}}`
    only after the commit contains your change.

A defect that you find in older code that your change does not touch goes to
`ROADMAP.md` as a new entry with its witness, and you continue. When the fix
needs a user decision (no option is clearly sound, or a documented contract
changes), write the entry back as `waits for user (decision)` with the options, an
example for each and your recommendation, commit nothing else, and stop.
When you stop before the work is done, write the entry back with the same
reference, saying only what remains, and leave the worktree in place.

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
ROADMAP: <### CE- headings before> -> <after>; added: <references or none>
Open: <what remains, or none>
Worktree: <removed | path left in place>
git status --short: <its output in the main tree>
```
