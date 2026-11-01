# Read-only triage of ROADMAP.md entries

You classify entries. You edit nothing except your own output file.

Context: today (2026-11-01) the project changed its contract for compiled
code and its rules for recording defects. Read, in this order, before you
classify anything:

1. `docs/COMPILATION-MODEL.md`, the section "Caveats of compiled code" (about
   lines 5 to 62): the allowed differences, the witness strengths `corpus`,
   `plausible` and `crafted`, and the known-limitations list.
2. `ROADMAP.md`, lines 12 to 120 (the header): the states, the witness line,
   and the rule for which entries exist.
3. `AGENTS.md`, the bullets that start "Fix every defect" and "A decline is
   not a defect".

Your input is `docs/scratch/2026-11-01-roadmap-triage/ROADMAP-snapshot.md`, a
frozen copy of `ROADMAP.md` taken today. Work on the snapshot, not on
`ROADMAP.md`, which other sessions are editing. Take every entry whose
`### CE-` heading is on a line in YOUR RANGE (given in the task), and read it to
its end (the next `### ` or `## ` heading), including its sub-items `CE-n.m`.

## Output

One row per entry in your part file (path given in the task), as one markdown
table with these columns:

| CE | state | kind | witness | bucket | reason |

- `state` and `kind`: from the Status line of the entry.
- `witness`: the strongest witness the entry text shows.
  - `corpus`: the entry links or names a Tycho ledger row, a GitHub issue or
    PR, a benchmark, or a program a host sent.
  - `plausible`: its reproduction is a program of one or two lines that a
    user would write, with ordinary declared inputs.
  - `crafted`: its reproduction needs a chosen type union, a chosen target and
    a chosen construct together; or an input that is absent or outside its
    type; or a value nobody would write.
  - `none`: no reproduction (a design, a task, an idea, a performance item
    without a measurement).
- `bucket`, one of:
  - `fix`: a defect or wrong value with a `corpus` or `plausible` witness,
    in the interpreter or in a compile target, whose fix needs no user
    decision. Also a `ready` entry of another kind whose status line records
    a user approval with a date.
  - `document`: a compiled-code difference with a `crafted` witness where the
    compiled code gives a WRONG FINITE NUMBER or a WRONG SHAPE (not `NaN`, not
    a throw, not a decline). Such an entry becomes one line in the
    known-limitations list of `docs/COMPILATION-MODEL.md` and leaves
    `ROADMAP.md`. Put the proposed line in the reason column: target,
    program, compiled value, interpreter value.
  - `drop`: (a) a `proposed` entry (an idea the user never approved) that
    names no `corpus` witness; (b) a decline of a compile target, unless the
    witness is `corpus` (then `fix`): the caveats allow a decline; (c) a
    compiled-code difference that the caveats allow (`NaN`, `0`, `±Infinity`,
    a throw, `undefined` where the interpreter gives `Missing`, `Nothing`,
    `Indeterminate`, an unevaluated form or an error; the precision of the
    target); (d) a defect whose only witness is `crafted` and that is not a
    `document` case; (e) an entry whose text says its work is done, or that
    another record (a Tycho row, an issue) tracks fully.
  - `keep`: an entry in state `decision needed` or `design needed`. The user
    owns these. Still fill `witness`, and in the reason say in one clause
    whether you would recommend `drop` (for example, the decision concerns a
    crafted case) or `keep`.
  - `unsure`: you cannot tell from the text. Say what is missing in the
    reason. Use this rarely.
- `reason`: one line, at most 25 words, naming the fact in the entry that
  decided the bucket. For `document`, the proposed known-limitations line
  instead.

## Rules

- Classify from the entry text only. Do not run probes, tests or scripts. Do
  not read source files. Do not verify whether an entry is already fixed. The
  cost of the triage must stay far below the cost of one fix.
- A `fix` bucket needs a witness that the entry shows. With no reproduction,
  the witness is `none` and the bucket is `drop` for a defect or an idea, and
  `keep` for a decision or a design.
- When a defect entry mixes a compile-target decline and an interpreter wrong
  value, classify by the interpreter part.
- Sub-items (`CE-n.1`, `CE-n.2`) go in the row of their parent; name a
  sub-item in the reason only when its bucket differs from the parent's.
- Do not edit `ROADMAP.md`, `docs/COMPILATION-MODEL.md` or any other file.
  Write only your part file. Other sessions are editing this repo now.
- NEVER run `git stash`, `git checkout`, `git restore`, `git reset`, or ANY
  git command that modifies the tree or index. If the working tree looks
  wrong, inconsistent, or contains unexpected changes, STOP and report; do not
  attempt to clean, baseline, or recover it.
- Stop and report when you have made about 150 tool calls, when the same
  failure comes back a third time, or when the planned approach does not
  work. Report what you tried, the state of the diff, what is still open, and
  the next step you propose. Stopping is a normal result, not a failure.

## Report

At the end, report: the number of rows per bucket, the path of your part
file, and each entry you marked `unsure` with its reason. Do not include the
table in your report.
