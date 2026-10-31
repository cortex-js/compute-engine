# Agent instructions

This is the shared instruction file for coding agents. Do not maintain copies in
agent-specific files. The user has approved every rule in this file: follow each
rule as written, and propose a change to a rule rather than skip it.

## Read the relevant reference

| Task                                  | Reference                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Write code or comments                | [CODING-STYLEGUIDE.md](CODING-STYLEGUIDE.md)                                                                        |
| Understand engine behavior            | [ARCHITECTURE.md](ARCHITECTURE.md) and the focused models it links                                                  |
| Build, validate, or prepare a release | [BUILD.md](BUILD.md)                                                                                                |
| Review code                           | [docs/REVIEW-CHECKLIST.md](docs/REVIEW-CHECKLIST.md)                                                                |
| Coordinate work on the shared machine | [docs/COMPUTE-ENGINE-BOX-SPECIFICS.md](docs/COMPUTE-ENGINE-BOX-SPECIFICS.md) and `~/.claude/SHARED-BOX-PROTOCOL.md` |

Read the shared-machine rules before editing shared files, running tests,
reviewing, or staging. They own worktrees, worker limits, locks, review
requirements, staging, and handoffs. If a session-start notice reports a failed
nightly run, tell the user; do not take over that investigation unless asked.

## Working rules

- Preserve other sessions' edits. Do not commit or publish without explicit user
  instructions.
- Keep changes focused. Check documented contracts before treating surprising
  behavior as a bug. Do not change a snapshot to hide a failure.
- Fix every defect you discover; never drop one. Fix it in the same change when
  the change introduces it, when it is in code the change rewrites, or when it
  blocks the task. A defect in older code that the change does not touch is the
  next task, done in the same session after this change is staged, with its own
  review (`~/.claude/SHARED-BOX-PROTOCOL.md` §5.2). Record a defect in
  `ROADMAP.md` instead only when the fix needs a user decision; the entry then
  states the decision, with an example, and the defect is reported to the user
  in the same turn. These are not reasons to defer a fix: the diff grows,
  snapshots or pinned emissions change (measure and report them instead), or a
  sub-agent reported it as "not fixed". Use permanent `CE-<n>` references,
  allocated from the next-free-reference line.
- When a rule that compiled code must follow (agreement with the interpreter)
  needs a hard static analysis, implement the simple, sound version first: it
  may give no value where the interpreter has one, and that case is documented
  with an example, but it never gives a value where the interpreter has none.
  A more precise version is a separate task, done when the user asks for it.
- A reachable shape that a compile target declines (it falls back to the
  interpreter) or that gives a different value from the interpreter is a defect,
  even when a corpus shows it only a few times. How often it occurs sets the
  priority of the fix; it never closes the item. Do not resolve a ROADMAP entry
  with "the decline stays" or "no consumer has asked".
- Judge a design change first by correctness (compiled values equal the
  interpreter's; no error becomes a value with no error) and by code-generation
  coverage (declines removed per target). The number of changed tests and
  snapshots is a cost to report, not a reason to choose.
- When working autonomously, continue independent work while a decision is
  pending. Report unresolved decisions and verification failures explicitly. At
  a design choice, take the option you recommend, continue to the end, and
  report each choice with its alternatives so the user can reverse it. Stop to
  ask only before an action that is hard to undo or outside this repo, before
  reversing a decision the user made, or when no option is clearly sound; put
  such questions together in one message at the end.
- Do small follow-up work without asking, and report it: a review that the
  process still requires, a ROADMAP entry for a limitation the user decided, and
  removal of the worktrees, references and temporary files you created. Commits,
  git commands that are not on the allowed list, and actions outside the repo
  still need the user's approval.
- Follow BUILD.md and the shared-box specifics for completion checks; after-edit
  hooks and commit-time formatting do not replace them. Capture test exit codes
  directly rather than relying on the exit status of an output-filtering pipe.
- The instructions exist to make the work efficient. When one asks for work
  that looks redundant in the case at hand (a check that already ran on the same
  content, a full suite that the change cannot affect, a batch of test files
  that a later run covers), do not do it without thinking: say why it looks
  redundant and ask the user whether to do it. A sub-agent reports the question
  to the orchestrator. This does not apply to the safety rules (git, the index,
  the box lock, the dual review), which you follow as written (user decision
  2026-10-30).

## Delegated work

Follow
[BUILD.md's delegated-task checklist](BUILD.md#completing-delegated-tasks). The
orchestrator sets the validation plan and can adapt the defaults. Sub-agents
must distinguish checks they ran from validation left to the orchestrator.

## Investigation tools

Use `scripts/where.ts` to locate an operator's implementation and tests, and
`scripts/probe.ts` to inspect expressions or compare values numerically. Their
headers document the options. Read [benchmarks/README.md](benchmarks/README.md)
before adding or changing benchmarks. Use the shared `add-operator` skill for
operator implementations and `benchmarks` for benchmark work. Their canonical
files live in `.agents/skills`; see BUILD.md for Claude setup. Skills supplement
the architecture contracts and review checklist.

## User authorization — 2026-09-10

"I hereby authorize using Claude for code reviews. Note this is a permanent
authorization."
