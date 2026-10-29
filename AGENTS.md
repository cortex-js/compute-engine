# Agent instructions

This is the shared instruction file for coding agents. Do not maintain copies in
agent-specific files.

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
- Fix defects discovered during the task. If a fix needs a user decision, state
  the decision and record the defect in `ROADMAP.md`; do not silently defer it.
  Use permanent `CE-<n>` references, allocated from the next-free-reference
  line.
- When working autonomously, continue independent work while a decision is
  pending. Report unresolved decisions and verification failures explicitly.
- Follow BUILD.md and the shared-box specifics for completion checks; after-edit
  hooks and commit-time formatting do not replace them. Capture test exit codes
  directly rather than relying on the exit status of an output-filtering pipe.

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
