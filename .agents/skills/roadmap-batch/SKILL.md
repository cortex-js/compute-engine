---
name: roadmap-batch
description: Run a batch of issues from the backlog (docs/ISSUE_TRACKING.md). Take the next items of the release scope and the pool, run one headless session per item (each one commits its own item), then report the results. Use when the user asks to run a batch, to make progress on the issues, or to fix the next issues of the backlog.
---

# Run a batch of issues

This skill runs in the main session and does three steps: the batch, the launch,
the report. The work on each item happens in a headless session that
`scripts/roadmap-batch.mjs` starts; the brief of that session is
`scripts/roadmap-batch-brief.md`. Read the header of each script before the
first run in a session. The decisions of the board are not part of this skill:
the user answers them in the issues web app or with
`node scripts/issues.mjs board`, and an item that waits for the board
(`needs-review`, `needs-decision`, `needs-design`) is not in the backlog.

Arguments (all optional): a number, the size of the batch (default 12); a list
of ids (`CE-1,CE-2`) to run exactly those.

A run of this skill commits the fixes of step 3. The user who starts the skill
approves these commits. Each headless session commits its own item under the
approval in its brief. Stage only with `~/.claude/scripts/stage-helper.mjs`,
under this session's own name
(`node ~/.claude/scripts/staging-queue.mjs whoami`).

## 1. The batch

```sh
node scripts/issues.mjs backlog --json > <out>/queue.json
```

`<out>` is a new directory,
`~/.local/state/compute-engine-batches/<UTC date and time>`. The list is the
release scope first, then the pool by priority, size (S before L) and age; P4
items and items that wait for the board are not in it. The runner takes the
first n (`--count`), or the ids given (`--items`). When the user gave ids, check
that each is in the list; one that is not (a P4, `needs-review`, or in progress)
is not run, and the report says why.

Show the user the list in one message (id, priority, kind, first line), and
continue without waiting.

## 2. The launch

Run, in the background:

```sh
node scripts/roadmap-batch.mjs --queue <out>/queue.json --count <n> --out <out>
```

(or `--items <list>`). The script starts at most three sessions at once, each in
different work areas of `docs/COMPUTE-ENGINE-BOX-SPECIFICS.md` §9 (found from
the source files that the issue names; the header of the script says how), and
counts the other Compute Engine sessions that run. Run one batch at a time: a
runner counts neither the sessions nor the areas of another runner. When three
other sessions already run and the user wants progress anyway, add
`--one-at-a-time`: the script then runs one session at a time, also when the
others run (the exception in §9), and does not read the areas. The script ends
when every item has ended. Wait for its end notice; do not poll. When the user
asks to stop the batch, run `node scripts/roadmap-batch.mjs --stop`: the batch
starts no other session, the sessions that run end on their own, and the runner
exits with code 4. Do not stop the process of the runner, because its sessions
then stop in the middle of an item. Each session marks its item `in-progress`
with `issues.mjs start` and removes it (or sets `fixed` for a Tycho issue) in
its commit.

The sessions of the items do not run the full suite. The runner starts a session
of its own (`suite-<n>` in the summary, brief
`scripts/roadmap-batch-suite-brief.md`) after each five items that committed and
after the last item: it runs `npm test` on HEAD and fixes and commits the
failures that those commits cause. `--suite-every <n>` changes the five; 0 turns
the suite off.

## 3. The report

Read `<out>/summary.md` and each `<out>/<id>.report.md`. Then:

- **Review gaps.** For each committed item whose report says "own reading", read
  the commit (`git show --stat <hash>`). When it changes more than about five
  lines of logic in `src/`, run the dual review of the commit with the
  `review-files` skill (`--range <hash>~1..<hash>`), fix its findings, and
  commit the fixes.
- **Rule breaks.** When a report or a commit shows that a session broke a rule
  of the repo (for example a hand edit of a generated file), check the result,
  fix it if it is wrong, and add the rule to `scripts/roadmap-batch-brief.md`,
  in one sentence with its reason. Commit that change.
- **Stalled items.** `node scripts/issues.mjs in-progress` lists the items a
  session left `in-progress`; an item whose session stopped returns to `open`
  (`issues.mjs set <id> state open`) with its report's "Open" line in the body.
  When the runner exits with code 3, a usage limit stopped the batch: the
  summary marks the item that hit it `stopped: usage limit` and the items after
  it `not run (usage limit)`. Report the reset time of the limit and offer to
  run the items that were not run in a new batch after it. When the runner exits
  with code 4, a stop on request ended the batch: the summary marks the items
  that did not start `not run (stopped on request)`, and they are still in the
  backlog.
- **The full suite.** Read each `<out>/suite-<n>.report.md`. A `fixed` run made
  commits: review them as "Review gaps" says. When the runner exits with code 5,
  a run of the suite ended `red` or with no report, and the batch started no
  other item: read its `Failures:` line and the issue file it added, fix the
  failure or tell the user why you cannot, and run `npm test` under the box lock
  before you start a new batch.
- **Report to the user**, in this order:
  1. a table: item or run of the suite, result, minutes, the API-price
     equivalent (the sessions run on the user's subscription; the amount is what
     the tokens would cost at API list prices, not a charge);
  2. the items that now wait for the board (`needs-decision`), with their `ask`
     line each;
  3. the issue files that the sessions added, and what is still open in a partly
     done item;
  4. the pages of `~/dev/cortexjs.io` that sessions edited: they are not
     committed, because no session runs git in that repo;
  5. the reviews and brief changes of this step, with their commits.
