# Issue tracking

This document is the process for issues in the Compute Engine and in Tycho. An
issue is a defect, a wrong value, a performance problem, a design question, a
documentation error or a request from a host that someone reported. A feature
that nobody reported as a problem is not an issue: it stays in `ROADMAP.md`.

The process has one goal: fix the issues that matter, with the resources we
have, and ship releases on a schedule. Not every issue is fixed. The Bug Review
Board decides which ones are, and records the decision.

The rules below are defaults. They tell an author and an agent what to do when
the board has not spoken. The board decides each case on its merits, and its
decision replaces the default.

## The three records

| Record                                              | Holds                                                                        | Who writes                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `issues/` (one file per issue, this repository)     | every open issue of the Compute Engine and of Tycho                          | agents, Tycho sessions, the board                                  |
| `issues/CLOSED.md` (one line per issue)             | the issues that were closed without a fix, with the reason and the witness   | the board, through the script                                      |
| GitHub issues                                       | reports from external users                                                  | external users; an agent mirrors an accepted report into `issues/` |

`ROADMAP.md` holds features, performance work and workstreams, not issues. The
two files share one counter: `issues/NEXT.md` gives the next `CE-<n>` number
for an issue file and for a ROADMAP entry. Tycho's `COMPUTE_ENGINE.md` holds the
reference material on how Tycho uses the engine, and
`COMPUTE_ENGINE_CHECKLIST.md` holds the steps of an adoption. Tycho files its
requests to CE as files in `issues/`, in this repository.

An issue file is edited only in the main worktree, never in a linked worktree:
the script finds the main worktree itself, and a session that edits by hand
writes the path of the main tree. Markdown is exempt from the ownership rules
of the shared-box protocol, so any session may stage an issue file. Who stages
what:

- The session that files an issue stages the new file and `issues/NEXT.md`
  with its own change.
- The session that starts an issue stages the `start` edit with its fix, and
  the fix's deletion of the file (or its `fixed` state) in the same commit.
- The CE session that answers a Tycho issue stages the answer. A file that a
  Tycho session wrote, and a deletion Tycho made after a verified fix, are
  committed by the user with the board's edits: Tycho runs no git command in
  this repository.
- The board's edits are committed by the user.

What happens to a file when the work ends:

- **Fixed, source other than Tycho:** the commit that fixes it deletes the
  file. `CHANGELOG.md` and the commit are the record.
- **Fixed, `source: tycho`:** the commit that fixes it sets `state: fixed` and
  `fixed-in: <commit or version>`. Only a Tycho issue takes this state. Tycho
  runs the instrument against the installed release; when the fix verifies,
  Tycho deletes the file. When it does not, Tycho sets `state: open`, clears
  `fixed-in`, adds `needs-review`, and writes the reading in the body, so that
  the board sees it at its next review.
- **Closed by the board:** `issues.mjs close` deletes the file and writes one
  line to `issues/CLOSED.md`: reference, date, priority, kind, impact,
  probability, witness, the first body line, the witness program and the
  reason. New evidence on a closed item is a new issue with `needs-review` and
  `source-ref: reopens CE-<n>`.

## The issue file

One file per issue, `issues/CE-<n>.md`. `node scripts/issues.mjs new` creates
the file from a template with the next number, prints its path, and increases
`issues/NEXT.md`. A number is never reused, also not the number of a closed
issue.

The file is a header of fixed fields, then a short body. The header is what the
board reads and what the script sorts on. The body is for the person or the
agent who fixes the issue.

```markdown
---
id: CE-901
state: open                 # open | investigate | needs-design | needs-decision | in-progress | fixed | close
priority: P1                # P0 .. P4; the table gives the default, the board can change it
flags: [blocker, regression]
kind: hang                  # wrong-value | error | decline | hang | performance | request | design | documentation
impact: critical            # critical | major | minor | confidence
probability: high           # high | medium | low
witness: corpus             # corpus | plausible | crafted; required unless the source is tycho
source: tycho               # tycho | github | agent | user
source-ref: Tycho row 600
instrument: scripts/repros/2026-11-06-ce901-interval-sum-no-budget-repro.mts
size: S                     # S | M | L
release:                    # the release the board assigned the item to; empty for the pool
owner:                      # the session that works on it, when in-progress
started:                    # the date the work started, when in-progress
opened: 2026-11-06
updated:                    # the last edit; the script writes it, a hand edit sets it too
reviewed:                   # the date the board last looked at it
confirmed:                  # a P0 only: the date the board confirmed it
fixed-in:                   # `fixed` only: the commit or the release
close-reason:               # `close` only: why the board did not fix it
ask:                        # needs-review, needs-decision, needs-design: one sentence, what the board must do
---
A plot row with a sum to 10^12 freezes the page on the interval target.

## Witness

`Sum(i, Limits(i, 1, 1e12))` compiled to `interval-js` with `iterationBudget: 1e6`
never returns. Compiled to `javascript`, the same program returns `NaN` at once.

## Cause and options

The `interval-js` emitter of `Sum` and `Product` does not read the option. Add
the same check as the `javascript` emitter (`compile-sum.ts`). Result over the
budget: the entire interval. Size S.

## CE answer

CE (2026-11-06): P1 confirmed, proposed for the next release. No workaround.
```

Rules for the body:

- The first line is one sentence that says what the user sees, with no engine
  terms. This is the line the board reads.
- The body is at most 150 words outside code blocks and outside the
  `## CE answer` section. It gives the program, what it gives today, what it
  must give, the cause when known, and the options with their cost. A longer
  analysis goes in a plan document in `docs/plans/`, and the body links it.
- A Tycho issue names its instrument: a script in Tycho's `scripts/repros/`
  that prints the reading, so that the fix can be verified on the production
  route. The `## CE answer` section holds CE's replies, newest last, each as
  `CE (<date>): …`.
- A change by hand to the header or the body also sets `updated` to the date.
- An item that asks something of the board (`needs-review`, `needs-decision`,
  `needs-design`) has an `ask` line: one sentence, at most about 30 words, that
  says what the board must do and names the recommended answer, for example
  "Confirm P2, or lower to P3 because a workaround exists" or "Choose (a) keep
  the documented rule (recommended) or (b) fold the integral". The board list
  prints it next to the item, so the review needs no reading of the body. The
  session that sets the flag or the state writes the line.

`node scripts/issues.mjs lint` fails on a missing field, an unknown value, a
date that does not exist, a body over the cap, an id that does not match the
file name, a P0 that is neither proposed nor confirmed (or both), a `fixed`
state on an issue that is not Tycho's, a Tycho issue without an instrument, a
Compute Engine issue without a witness, and a `NEXT.md` that is not above every
`CE-<n>` in `issues/`, in `CLOSED.md` and in `ROADMAP.md`.

## Priority

The default priority comes from two facts the author records: impact and
probability. The author does not choose it. The board sets the final priority
by comparing the issue with the other open issues and with the resources we
have: an issue filed as P4 can become a P1, and one filed as P2 can become a
P4. The board records that it looked by setting `reviewed`; from then on the
lint accepts a priority that differs from the table.

**Impact** is what happens to the user when the issue occurs.

| Impact       | Definition                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `critical`   | security, data loss, a hang or a crash of the host, a wrong finite value or shape with no error for an input of its declared type                                                |
| `major`      | an error, `NaN` or decline where a value is expected and the host has no workaround; a performance regression that misses a host budget; a request without which a host feature cannot ship |
| `minor`      | an error or a decline with a workaround; a slow case within budget; a wrong result in a case the documentation marks as unspecified; a request with a workaround                 |
| `confidence` | a flaw the user sees that does not change a result: a wrong form, a serialization, a message, a documentation error, the name of the product misspelled on the landing page       |

A `confidence` issue is not "cosmetic". A user who sees a visible flaw assumes
the same level of care in the rest of the product. Its priority comes from how
many users see it, the same as any other issue.

**Probability** is how many users meet the issue.

| Probability | Definition                                                                                                                                  | Compute Engine default from the witness |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `high`      | most users, or basic use of a feature: a program a shipped document contains, a function called with ordinary values                        | `corpus`                                |
| `medium`    | few users: a non-default setting, a rare feature, an unusual combination of values (`NaN`, `Missing`, `Nothing`, an empty list)              | `plausible`                             |
| `low`       | a contrived situation, a program built to reach the case                                                                                     | `crafted`                               |

For the Compute Engine, the witness gives the default probability, and the
author may set another value with the reason in the body. A Tycho issue sets the
probability from the share of its users that the issue reaches; the witness
field is optional.

The **witness** says how the issue was reached, and it is the evidence in the
body:

- `corpus`: a Tycho document or request, a GitHub issue, a benchmark, or a
  program a host sent.
- `plausible`: a program of one or two lines that a user would write, with the
  inputs declared as a host declares them.
- `crafted`: a program built to reach the case, where a type, a target and a
  construct are chosen together. A compiled-code difference with a `crafted`
  witness is a line in the known-limitations list of
  `docs/COMPILATION-MODEL.md`, not an issue; a `crafted` interpreter defect is
  an issue with `probability: low`. A `crafted` case is never a question for
  the board: each answer adds a handler for a case that no real program
  reaches.

**The table.**

| Impact \ Probability | high | medium | low |
| -------------------- | ---- | ------ | --- |
| `critical`           | P1   | P2     | P3  |
| `major`              | P2   | P3     | P4  |
| `minor`              | P3   | P4     | P4  |
| `confidence`         | P2   | P3     | P4  |

Two flags are facts the board weighs; in the default, each moves the issue up
one level, to P1 at most. "The table value" means the value with these
adjustments; `lint` prints it when the recorded priority differs. "The
priority of an issue" means the table value for a new issue, and the recorded
priority once the board has set `reviewed`.

- `regression`: the previous release did not have the issue.
- `blocker` without `workaround`: the issue stops a Tycho roadmap item or a
  Tycho adoption, and Tycho has no way around it. A `blocker` with a
  `workaround` stays at the table value.

**P0** is never a table value. It means: the release does not ship. An author
who thinks an issue is a P0 sets `priority: P0` and `needs-review`, and tells
the user at once. The board confirms it with `set <id> confirmed today`, which also removes
`needs-review`; the work on a P0 starts then, and until then the issue blocks
nothing. The usual P0 is a `critical` issue with `high` probability that
is a regression, a security defect or data loss. While a confirmed P0 is open,
no other work starts (the backlog list shows only the P0), so that the fix
ships alone and at once. When the fix is large, the board decides how the
release ships; a decline or a revert is the usual answer.

**P4** issues are not worked on until the board promotes them. A P4 that stays
a P4 for two reviews is a candidate for closing.

**Age.** Within a priority, the oldest issue comes first. When nobody touched a
P2 for sixty days (`updated`, `started` or `opened`, whichever is latest), the
board list shows it; the board demotes it to P3, or keeps it by setting the
priority again, which refreshes `updated`.

## States and flags

`state` is one of:

| State            | Meaning                                                                                                                                                          | Whose list           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `open`           | ready for an agent                                                                                                                                               | the agents'          |
| `investigate`    | the author did not find the cause; an agent starts it, reproduces the issue, finds the cause, writes the options and their cost, then sets the state back to `investigate` and adds `needs-review` | the agents'          |
| `needs-design`   | a design document in `docs/plans/` comes first, and the board approves it                                                                                        | the board's          |
| `needs-decision` | the body states a question with options and a recommendation; the board answers                                                                                  | the board's          |
| `in-progress`    | a session works on it; `owner` and `started` are set by `issues.mjs start`                                                                                       | the in-progress list |
| `fixed`          | a Tycho issue whose fix is committed (`fixed-in`); Tycho deletes the file when the fix verifies                                                                   | the board's, as information |
| `close`          | the board decided not to fix it now; `close-reason` is set; removed at the end of the review, one line to `CLOSED.md`                                           | the board's          |

When the board removes `needs-review` from an `investigate` item, it also sets
the state: `open`, `needs-decision`, `needs-design` or `close`. An `in-progress`
item with no commit that names it and no `updated` three days after `started`
appears in the board list; the board returns it to `open`.

`flags` holds zero or more of: `needs-review` (the board must look at it),
`regression`, `blocker`, `workaround`. `issues.mjs flag <id> +name` and
`-name` add and remove one. A GitHub report is `source: github` with the
issue number in `source-ref`.

## Who does what

**An agent that finds an issue** during its task:

1. Searches `issues/` and `issues/CLOSED.md` for the same program or cause. A
   match in `CLOSED.md` is a decided item: the agent files a new issue with
   `needs-review` and `source-ref: reopens CE-<n>` only when it has new
   evidence of a higher impact or probability.
2. Writes the file with impact, probability and witness, and the priority the
   table gives. It sets `needs-review` for a proposed P0, for a priority that
   differs from the table, or when it cannot choose between two impacts.
3. Fixes a defect in the same change when the change introduces it or when it
   blocks the task, whatever the priority. A defect in older code is fixed in
   the same change only when it is in code the change rewrites (lines the diff
   replaces or changes) and its priority is P1, except a proposed P0, which
   waits for the board. Every other defect is an issue file in the pool,
   whatever its priority.

**A Tycho session** files a request to CE as an issue file with `source: tycho`,
the instrument, the probability from its users, and the `blocker` and
`workaround` flags as they apply. A design ask is `state: needs-design`. A
request for a capability is `kind: request`.

**CE answers a Tycho issue within one day**, in the `## CE answer` section: the
priority it confirms or proposes, the disposition (proposed for the next
release, pool, proposed close, needs-decision) and the workaround when one
exists. The answer unblocks Tycho in most cases; the fix follows the priority.
The board list shows a Tycho issue that has no answer after one day.

**The Bug Review Board** (the user) reviews on a schedule, with
`node scripts/issues.mjs board`. The list, in order:

1. P0, proposed or confirmed.
2. `needs-review`, by priority.
3. New since the last review: issues with no `reviewed` date.
4. Tycho issues with no CE answer after one day.
5. `needs-decision`, then `needs-design`.
6. `in-progress` items past the three-day limit.
7. P2 items that the age rule lists.

Then, as information, the `fixed` items that wait for Tycho's check and the
items to close. For each item the board removes `needs-review`, sets the
priority when the comparison with the other items says so, answers a decision,
approves or returns a design, or sets `state: close` with `close-reason`, and
sets `reviewed` (`set <id> reviewed today`). The board compares items against
each other, not against the table alone: the budget is fixed, and the question
is which issues we can afford to fix.

The review ends with the scope of the next release: the board sets
`release: <version>` on the items it picks, within the size budget it accepts.
Then the board runs `node scripts/issues.mjs close --all`, which removes every
`close` item and writes its line to `CLOSED.md`.

**Agents take work** from `node scripts/issues.mjs backlog`: first the items of
the current release, then the pool by priority, size (S before L) and age. P4
items are not in the list. An agent marks the item with
`issues.mjs start <id> <owner>` before it starts (the command refuses a P4, an
item with `needs-review`, and any item while a confirmed P0 is open), and
deletes the file (or sets `fixed` for a Tycho issue) in the commit that fixes
it.

## Releases

`node scripts/issues.mjs release <version>` lists every item with that
`release`, in any state, and exits with 1 while one is not `fixed` or `close`,
while an open item is assigned to an earlier version (set a new `release` on
it), while a confirmed P0 is open, or while a file has lint errors. The
release script runs it in its first step, before anything changes, with the
version the bump will produce. The board assigns the version the next release
will have; when the release ships under another number, the board reassigns
the items first. An issue found
during the cycle goes to the pool without a release, whatever its priority,
unless the board confirms it as a P0. The board can add it to the current
release at its next review.

Tycho adopts a release on its own schedule, not every release. Each adoption
files its new issues in one batch, which the board sees at its next review.

## The script

`scripts/issues.mjs` reads the `issues/` directory of the main worktree and
has no dependency.

| Command                      | Does                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `lint`                       | checks every file; exit code 1 on an error; a priority that differs from the table is a warning until `reviewed` is set         |
| `board`                      | the board's list, in the order above                                                                                           |
| `backlog`                    | the agents' list; only the P0 while a confirmed P0 is open                                                                     |
| `in-progress`                | owner, start date and days for each item in progress                                                                           |
| `show <id>`                  | prints one issue file                                                                                                          |
| `release <version>`          | the items of the release, the items carried over from earlier versions, and whether it can ship                                |
| `set <id> <field> <value>`   | changes one header field (a date field takes `today`) and writes `updated`; it refuses an unknown value, an empty required field, `state: close` without `close-reason`, and `in-progress` |
| `flag <id> +name` / `-name`  | adds or removes one flag                                                                                                       |
| `start <id> <owner>`         | sets `in-progress`, `owner` and `started`; refuses an item that is not `open` or `investigate`, a P4, `needs-review`, or any item while a confirmed P0 is open |
| `new`                        | creates `issues/CE-<n>.md` from the template with the next id, prints the path, and increases `issues/NEXT.md`                 |
| `close <id> <reason>`        | removes the file and writes the line to `CLOSED.md`                                                                            |
| `close --all`                | the same for every file with `state: close`; the reason is the `close-reason` field                                            |

The lists leave out a file with lint errors and say so (`leftOut` in the JSON
output); `release` counts such a file as not ready. A web view can read the
same directory later; the script is enough to start.

## Migration

These steps move the existing records into this process. Each is a task of
its own.

1. Create `issues/`, `issues/NEXT.md` (from the next free `CE-` reference of
   `ROADMAP.md`) and `issues/CLOSED.md`; add the script. Done 2026-11-06.
2. Convert the `defect`, `wrong value`, `performance` (when reported as a
   problem), `documentation` and `design` entries of `ROADMAP.md` to files,
   with impact and probability set from their kind and witness. The kind of a
   `defect` entry comes from its witness line: `wrong-value` when it gives a
   wrong finite value or shape with no error, `decline` when compiled code
   declines, `hang` when it does not return, `error` otherwise. The state
   comes from the status: `ready` is `open`, `waits for user (decision)` is
   `needs-decision`, `waits for user (design)` is `needs-design`. The size is
   the entry's size, estimated when the entry has none. `reviewed` is set to
   the conversion date, so that the first board list is not every entry,
   except on an entry that gets `needs-review`. A sub-item `CE-<n>.<m>` that
   can be fixed alone gets a new number with `source-ref: CE-<n>.<m>`.
   Entries with a `crafted` witness get `probability: low`; entries without a
   witness get `needs-review`. Leave the `capability` and `task` entries in
   `ROADMAP.md`, and rewrite its header for features only.
3. Convert the open rows of Tycho's `COMPUTE_ENGINE.md` to files with
   `source: tycho`; move the adoption checklist to
   `COMPUTE_ENGINE_CHECKLIST.md`; keep the reference sections in
   `COMPUTE_ENGINE.md`. Tycho's agent instructions name
   `compute-engine/issues/` as a directory its sessions may edit.
4. Change the rules that still describe the old flow: `~/.claude/SHARED-BOX-PROTOCOL.md`
   §5.2 ("a defect in code that the change rewrites" is always fixed; older
   defects go to the roadmap), the `roadmap-batch` skill and
   `scripts/roadmap-candidates.ts`. The rules of this repository (`AGENTS.md`,
   `BUILD.md`, `docs/REVIEW-CHECKLIST.md`, `docs/COMPILATION-MODEL.md`, the
   `ROADMAP.md` header) were changed on 2026-11-06.
5. Point the `roadmap-batch` skill at the backlog. The skill already runs one
   headless session per item with `scripts/roadmap-batch.mjs` and the brief
   `scripts/roadmap-batch-brief.md`. Its step 1 (ask the user the pending
   decisions) becomes the board review and leaves the skill; its step 2
   (`roadmap-candidates.ts`) is replaced by `issues.mjs backlog --json`; its
   brief tells the session to run `issues.mjs start`, to delete the file (or
   set `fixed`) in the commit that fixes the issue, and to file a found defect
   as a new file instead of a ROADMAP entry. No other skill is needed: the
   board works with `issues.mjs board`, and an agent that files an issue
   follows the "Who does what" section, which `AGENTS.md` repeats.
