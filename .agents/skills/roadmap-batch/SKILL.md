---
name: roadmap-batch
description: Work through ROADMAP.md in a batch. Ask the user the open `decision needed` questions and record the answers, pick a batch of ready items, run one headless session per item (each one commits its own item), then report the results. Use when the user asks to run a ROADMAP batch, to make progress on ROADMAP items, or to answer pending ROADMAP decisions.
---

# Run a batch of ROADMAP items

This skill runs in the main session and does four steps: decisions, the
batch, the launch, the report. The work on each item happens in a headless
session that `scripts/roadmap-batch.mjs` starts; the brief of that session is
`scripts/roadmap-batch-brief.md`. Read the header of each script before the
first run in a session.

Arguments (all optional): a number, the size of the batch (default 12);
`decisions-only` (do step 1 and stop); `no-decisions` (skip step 1).

A run of this skill commits the ROADMAP changes that record decisions and
the fixes of step 4. The user who starts the skill approves these commits.
Each headless session commits its own item under the approval in its brief.
Stage only with `~/.claude/scripts/stage-helper.mjs`, under this session's
own name (`node ~/.claude/scripts/staging-queue.mjs whoami`).

## 1. Decisions

Run `npx tsx scripts/roadmap-candidates.ts --decisions`. It lists the
`decision needed` entries, newest first, and then, in a separate group, the
entries whose only witness is `crafted`. Do not ask the crafted group by
default: AGENTS.md says that a case with only a `crafted` witness is not a
question for the user. From the first group, take at most eight per run,
newest first, and read each one in `ROADMAP.md`.

Ask the user, at most four questions per message (in Claude Code, with the
AskUserQuestion tool). Each question stands on its own for a reader who has
none of this session's context: the input, what it gives today, what each
option gives, with the example of the entry. The options are those of the
entry; the one the entry recommends comes first and says so. Add the option
"Not now": the entry stays as it is.

Record each answer in the entry: the status becomes `ready`, followed by
"User decision <date>: option (<x>)" and, when the user added words, those
words. Keep the options in the text: the session that does the work reads
them. Before the edit, read `ROADMAP.md` again (other sessions edit it).
Commit these changes together, with a message that names each entry and its
option.

At the end of this step, when the crafted group is not empty, list it in one
message (reference, title) and offer to review it; continue without waiting.
When the user accepts, ask those entries in the same form as the others,
at most eight per run.

## 2. The batch

```sh
npx tsx scripts/roadmap-candidates.ts --batch <n> --json <out>/queue.json
```

`<out>` is a new directory, `~/.local/state/compute-engine-batches/<UTC date
and time>`. The header of `roadmap-candidates.ts` gives the ranking and the
rule that spreads the batch over the ROADMAP sections.

The entries decided in step 1 go first. For each, check that it is in the
`candidates` of the queue file; one that is not (a design, or a kind with no
approval) is not run, and the report says why. Make the list of items: the
decided entries that are candidates, then the `batch` field of the queue,
with no reference twice.

Show the user the list in one message (reference, section, title), and
continue without waiting.

## 3. The launch

Run, in the background:

```sh
node scripts/roadmap-batch.mjs --queue <out>/queue.json --items <list> --out <out>
```

The script starts at most three sessions at once, each in a different
section, and counts the other Compute Engine sessions that run. It ends when
every item has ended. Wait for its end notice; do not poll.

## 4. The report

Read `<out>/summary.md` and each `<out>/<id>.report.md`. Then:

- **Review gaps.** For each committed item whose report says "own reading",
  read the commit (`git show --stat <hash>`). When it changes more than
  about five lines of logic in `src/`, run the dual review of the commit with
  the `review-files` skill (`--range <hash>~1..<hash>`), fix its findings,
  and commit the fixes.
- **Rule breaks.** When a report or a commit shows that a session broke a
  rule of the repo (for example a hand edit of a generated file), check the
  result, fix it if it is wrong, and add the rule to
  `scripts/roadmap-batch-brief.md`, in one sentence with its reason. Commit
  that change.
- **Report to the user**, in this order:
  1. a table: item, result, minutes, the API-price equivalent (the sessions
     run on the user's subscription; the amount is what the tokens would
     cost at API list prices, not a charge);
  2. the entries that now wait for a decision, with their question in one
     sentence each;
  3. the ROADMAP entries that the sessions added, and what is still open in
     a partly done item;
  4. the pages of `~/dev/cortexjs.io` that sessions edited: they are not
     committed, because no session runs git in that repo;
  5. the reviews and brief changes of this step, with their commits.
