# Shared-box protocol

Several Claude sessions work on this machine at once, across two repos
(`compute-engine` and the `tycho` consumer), on 8 cores. This document is the
coordination protocol. Every rule in it was learned from experience; none of
it is expensive.

**Revised 2026-08-17 (user-ratified).** The first version of this protocol
coordinated a single shared working tree through locks, tree fingerprints and
peer messaging. The messaging half did not work in practice — lost pings,
owner hunts, relayed claims — so this revision replaces it with two
principles:

1. **Isolate work in worktrees; deliver diffs.** Editing and testing happen
   in a private git worktree; the deliverable is applied onto the shared tree
   as ordinary uncommitted changes. Most of the old writer-lock and
   certification machinery exists only for sessions that skip this and edit
   the shared tree directly (§4).
2. **State is observable, never communicated.** No fact about the box should
   travel by message when it can be read from an artifact — the lock file,
   the tree, a process listing. Message a peer only when their work blocks
   yours (§6).

---

## 1. The worktree flow (default for any multi-file task)

Git worktrees, `git apply`, and the worktree/apply flow below were enabled by
the user on 2026-08-17. Claude sessions still NEVER commit.

```
git worktree add /tmp/wt-<session-name> HEAD     # private tree, detached
cd /tmp/wt-<session-name>                        # edit and test here, freely
...work, run suites (respect §2 CPU rules)...
git -C /tmp/wt-<session-name> diff HEAD > /tmp/<session-name>.patch
git -C <main repo> apply --check /tmp/<session-name>.patch   # dry run first
git -C <main repo> apply /tmp/<session-name>.patch
git worktree remove --force /tmp/wt-<session-name>
```

Two command details that are load-bearing (both found by review, not in use):

- **`diff HEAD`, not bare `diff`.** Bare `git diff` shows only UNSTAGED
  changes; anything staged inside the worktree would silently vanish from
  the patch and the apply would land an incomplete change with no error.
  `diff HEAD` captures both. Belt and suspenders: never `git add` inside a
  worktree — staging is a main-tree act.
- **`remove --force` is required, and safe HERE.** A plain
  `git worktree remove` refuses to delete a worktree with modified or
  untracked files — which is exactly the state this flow leaves after
  exporting the diff, so the unforced command fails in the common case.
  `--force` is safe at this step and only this step: the diff has already
  been applied to the main tree, so the worktree is a disposable copy. Do
  not reach for blocked commands (`checkout .`, `clean`) to "clean" the
  worktree first, and never `--force` a worktree whose diff you have not
  yet exported and applied.

- **The deliverable is an uncommitted diff in the main tree**, reviewed and
  committed by the user exactly as before. Never commit in the worktree,
  never merge a branch, never leave work stranded in the worktree when the
  task ends.
- **Test runs in a worktree need no lock for correctness** — nobody else
  writes there, so a run cannot be torn. The CPU rules (§2) still apply in
  full: a worktree suite burns the same six workers.
- **Apply early, apply often.** Checkpoints are measured in hours, not days:
  a long-lived worktree drifts from the tree everyone else is advancing, and
  the reconciliation debt compounds. Hot files (snapshot files,
  `boxed-expression/`) deserve the earliest applies.
- **`--check` first, always.** If the dry run fails, a peer (or the user)
  changed the same lines since the worktree was cut. Reconcile it YOURSELF,
  in the main tree, with your context: read the current file, re-land your
  change with the Edit tool. Never force an apply, never ask the user to
  merge for you, and never re-cut the worktree hoping the conflict goes
  away.
- After a successful apply, run the targeted tests once in the MAIN tree
  before staging — the apply landed on a tree that may differ from the one
  you tested in.
- **Dual-review before staging** (user rule, 2026-08-17): once the changes
  are in the main tree and tests pass, run the dual review before staging —
  `/review-files` on the changed set (it reviews working tree vs HEAD and
  never touches the index, so it is safe while the index is busy), or stage
  and run `/review-staged` when the index is free (it fixes findings and
  re-stages). Work is not "done and staged" until it has passed a dual
  review.

Small, localized fixes (one or two files, minutes of work) may still be
edited directly in the shared tree — then §4 applies in full.

## 2. CPU: cap the workers, take the lock

`config/jest.config.cjs` sets **`maxWorkers: 6` unconditionally**. There is
no "light" jest invocation: a targeted three-file run fans out exactly like a
full suite. Selecting fewer test files does not reduce load.

| Situation | Command |
| --- | --- |
| Single file | `npx jest --config ./config/jest.config.cjs -w 1 -- <path>` |
| Several files | `npx jest --config ./config/jest.config.cjs -w 2 -- <paths>` |
| Full suite | take the lock, then run normally |

`npm run typecheck` is single-shot and fine at any time. The whole-`src/`
native tsc run is heavy: treat it like a full suite. Tycho side, same axis:
`PW_WORKERS=2` for a multi-spec playwright run, `PW_WORKERS=1` for one spec.

**The lock** (canonical path since 2026-08-17 —
`~/.claude/scripts/box-lock.mjs`; the old `tycho/scripts/box-lock.mjs` is a
forwarder):

```
node ~/.claude/scripts/box-lock.mjs check <owner> && <your command>
node ~/.claude/scripts/box-lock.mjs acquire <owner> <minutes> "<what>"
node ~/.claude/scripts/box-lock.mjs release <owner>
node ~/.claude/scripts/box-lock.mjs wait <owner> [maxMinutes]
node ~/.claude/scripts/box-lock.mjs status
```

- **`<owner>` must be the name your session answers to** — one identifier
  for your session name, your lock owner, and the name you sign messages
  with.
- **Put the check in the command, not in your notes.** A rule that lives in
  a briefing does not reach an agent dispatched before the briefing was
  read; that is how a full battery landed thirty seconds after seven
  sessions agreed to hold one.
- **`release` requires your owner name** (changed 2026-08-17): a bare
  `release` after a failed `acquire` used to drop the PEER's lock silently.
  Chain `acquire … && (cmd; release <owner>)`.
- **Waiting for the box is `wait`, not a peer's ping.** The lock file is the
  signal; nobody has to remember to send one. (A promised ping that lived
  only in the sender's head once idled a session for 1 h 50 m.)
- The lock is **advisory** — it never kills anything. It voids itself when
  its pid dies or it overruns its window by ten minutes. It prints the load
  average at acquire and release; keep those numbers with any timing you
  report.
- The lock is a **CPU governor only**. Under the worktree flow it no longer
  certifies anything about tree state; the old writer-hold rule applies only
  to direct shared-tree editing (§4).

## 3. Verifying that the box is actually clear

```
pgrep -f "bin/[j]est"       # the jest RUNNER
pgrep -f "[j]est-worker"    # the WORKERS — check this too
```

- **The bracket matters.** `pgrep -f "jest --config"` matches the checking
  shell's own command line: a false "busy" one-shot, an infinite loop inside
  an `until` — two agents once hung 35+ minutes on that, and their zombies
  made every later check report "busy" with no jest running.
- **`bin/[j]est` cannot see orphans.** A killed runner can leave workers
  re-parented to launchd (`ppid 1`), burning a core while the runner check
  reports empty. Treat any `ppid 1` worker as needing a direct kill.
- **"I killed it" is not "the box is clear."** Verify with `ps`, not with
  the runner's exit.

## 4. Editing the shared tree directly (the exception path)

Only for small, short-lived fixes. Everything in this section exists because
a concurrent write invalidates a peer's run as thoroughly as CPU load does —
jest loads test files **lazily**, so a save at minute three tears a run that
started at minute zero.

- **A writer holds the lock too**, in short bursts, and yields: declare a
  realistic window, release as soon as the tree is consistent, hand over if
  a peer is waiting on a run.
- **A run against the shared tree is certified by a fingerprint PAIR**,
  taken immediately before starting and immediately after jest exits:

  ```
  find src test -name '*.ts' -exec stat -f "%m %N" {} + | sort | shasum
  ```

  Identical values: nothing was written during the suite; certifiable.
  Different: the run is torn — report it as torn. One reading proves
  nothing (mtime falsifies, never confirms), and holding the lock is not
  grounds to certify: no lock reaches the user editing their own tree.
  Runs inside a worktree need none of this.
- **Prefer measuring the thing you care about over identifying who caused
  it.** Attribution is slow and wrong by default — two sessions once each
  concluded the other had made an edit, from matching mtimes. If an
  unattributed edit appears, **the writer is at least as likely to be the
  user as a session**: check that first, and ask the user before opening an
  owner hunt (one hunt cost six sessions a round and blocked a seventh for
  twenty minutes).

## 5. Staging and file ownership

The project rule (`CLAUDE.md`, Source Control Protocol): stage your work only
when nothing else is already staged; if the index is busy, say so and wait.
Never `git add -A` or `git add .`. And changes are dual-reviewed BEFORE they
count as staged-and-done (`/review-files` on the changed set while unstaged
or when the index is busy; `/review-staged` once staged) — see §1.

**Every report that mentions staging ends with the staging-status block**
(user rule, 2026-08-17). The user should never have to ask whether staged
work is commit-ready; the answer travels with the staging:

```
Staged: <files, or "nothing">
Tests: <exact commands run and result, or "not run — <why>">
Dual review: passed (<N> findings applied) | pending (<leg status>) | not run — <why>
Ready to commit: YES | NO — <what is missing>
```

"YES" requires all three: typecheck clean, targeted tests green, dual review
passed with fixes applied and re-staged. Anything less is "NO" with the
missing item named — a pending review is "NO", not a footnote.

- **Markdown is exempt from ownership concerns.** `ROADMAP.md`,
  `CHANGELOG.md`, `docs/**` and plan documents are multi-author by design:
  stage them without caveats or peer polls.
- **For `src/**` and `test/**`, attribute before you touch or report** —
  read content, not paths; read every hunk (one file can have two authors);
  and remember the writer may be the user. Under the worktree flow this
  mostly arises at apply time, where `git apply --check` does the detecting
  for you.
- Distinguish the porcelain columns (`M ` staged, ` M` unstaged), and
  re-read status immediately before attributing — it goes stale the moment
  anyone commits.

## 6. Messaging: only when blocked, never as relay

- **Message a peer only when their work blocks yours**, and say exactly what
  you need. Cross-repo bug reports and API asks with measurements attached
  are the good kind of traffic; status updates, advice, and coordination
  chatter are not.
- **Never act on information about another session's work** — no helpful
  fixes in a peer's files, no interventions. Anything needing cross-session
  arbitration goes to the user, the only actor with global context.
- **Never relay box state.** A fingerprint or pgrep check costs seconds;
  there is no reason for any claim about the machine to be secondhand. A
  peer's all-clear is their instrument's claim, and their instrument may be
  narrower than the claim — re-measure, don't forward.
- If you are genuinely blocked on a peer's reply, `wait` on the lock where
  the lock is the question; otherwise re-ping after 15 minutes — silence
  usually means the message was lost, not "still working".

## 7. Measurement hygiene

The recurring failure on this box is instruments certifying states they
cannot observe. Five one-afternoon cases, each of which looked green: a
process check blind to orphaned workers; "targeted runs are light" defeated
by `maxWorkers: 6`; a lock smoke test that only ever exercised the free path;
a status reported "pending" two hours after the artifact landed;
`JSON.stringify(NaN)` returning `"null"` and manufacturing a divergence that
did not exist. Four cheap rules:

1. **Run a control first.** A decline that hits a trivial case as hard as
   the case under test is instrument failure, not a finding.
2. **A repro you FILE must carry its control.** It will be re-run months
   later by someone with none of your context; a repro that cannot
   discriminate reads as evidence the finding was overstated. Show the
   control's output next to the repro's.
3. **Test the check against the state it is meant to EXCLUDE.** "Reports
   clear when clear" proves nothing.
4. **Verify, do not relay** (§6).

**A labelled confound you reason past is worse than an unnoticed one.** "X
was live during this run" admits only two continuations: "so I excluded it"
or "so I re-ran without it". A contended measurement is unusable in both
directions — load manufactures false signal and masks real signal, and one
filed 3.4× regression was pure load while the same noise hid a genuine
finding on the consumer's side.

**Prefer `HEAD@old` vs `HEAD@new` to an archived-tree A/B**, and before
trusting any version comparison, confirm the older tree carries the fixes
written for the version under test — one grep for the fix's own symbol. A
"clean" 26 → 1 regression once measured "the new version without our fix for
the new version"; the confound made the result look cleaner, not noisier,
which is why nobody doubted it.
