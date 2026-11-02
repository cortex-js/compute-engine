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
- Fix every defect that the change introduces, that is in code the change
  rewrites, or that blocks the task, in the same change. These are not reasons
  to defer such a fix: the diff grows, snapshots or pinned emissions change
  (measure and report them instead), or a sub-agent reported it as "not fixed".
  A defect in older code that the change does not touch is not fixed in this
  task, and is not queued in a handoff file or in a report: record it in
  `ROADMAP.md` as one entry with its witness and the strength of the witness
  (the header of `ROADMAP.md` defines both), or, for a compiled-code difference
  with a `crafted` witness, as one line in the known-limitations list of
  `docs/COMPILATION-MODEL.md`. The user picks the next item from `ROADMAP.md`. A
  fix needs a user decision only when no option is clearly sound, or when the
  fix changes a documented contract; the entry is then `decision needed` and
  states the options with an example. Use permanent `CE-<n>` references,
  allocated from the next-free-reference line.
- Compiled code gives the interpreter's value within the caveats of
  `docs/COMPILATION-MODEL.md`, "Caveats of compiled code": the precision of the
  target, and `NaN`, `0`, `±Infinity`, `undefined`, a throw or a decline where
  the interpreter gives `Missing`, `Nothing`, `Indeterminate`, an unevaluated
  form or an error; and an unspecified value for every operator other than a
  discharge (`IsMissing`, `Coalesce`, `AssertPresent`, a default parameter) or a
  position-preserving accessor (`At`, `First`, `Last`, `Rest`, `Length`, a `Map`
  binding) applied to an absent operand, and for everything computed from that
  value. A wrong finite number or a wrong shape for a program with inputs of
  their declared types is a defect. A compilation declines when a sub-expression
  is invalid or has the static type `error`. Every other case is unspecified,
  and compiled code need not check for it: an error that the static type does
  not show (`If(u > 1, "ab", 1) + 1`), an input value outside its type (`"ab"`
  for an input declared `real`, `NaN` for `real`, `7` for `real<0..5>`), an
  input left out. One exception: in the JavaScript `bigint` compile mode, a
  `number` result (`NaN` or `Infinity`) means that a sub-expression had no
  finite value, and it need not equal the interpreter's value; a `bigint` or
  `boolean` result must. A `bigint` cannot hold a non-finite value, and the one
  catch that returns it skips every operator between the pole and the result
  (`docs/plans/2026-10-31-ce715-bigint-compile-mode.md`, §3.4).
- Compiled code settles every shape at compile time and emits no run-time test
  of a type. The shape of a node (scalar, list, tuple, string, complex, ...)
  comes from its declared or inferred static type and from the literal structure
  of its operands; the compiler does not follow the paths of control flow to
  find a shape. An input typed `unknown` or `any` is refused, with its name in
  `unsupported`. A value with no settled shape declines: an `If` whose branches
  differ in shape, a local that is assigned values of two shapes in one scope, a
  call whose result shape depends on a run-time value. A declared union of
  shapes at an input or a parameter compiles with one dispatch at that binding
  and one body per member: the host pays that dispatch, and avoids it by
  declaring one shape or by compiling one function per shape. The host supplies
  every input with a value of its declared type; otherwise the result is
  undefined and can differ between targets. The rule is in
  `docs/COMPILATION-MODEL.md`, "Shapes are settled at compile time" (R1 to R6).
- A decline that the rule above requires is not a defect, and no analysis is
  added to remove it: the remedy is a declaration by the host or a change to the
  program, and the case is documented with an example. When another rule that
  compiled code must follow needs a hard static analysis, implement the simple,
  sound version first: it may give no value where the interpreter has one, and
  that case is documented with an example, but it never gives a different value.
  A more precise version is a separate task, done when the user asks for it by
  name.
- A decline is not a defect: it falls back to the interpreter, and it is the
  preferred fix for a case that would otherwise need a handler of its own. A
  decline is removed, or a wrong value is fixed with a handler, only for a
  `corpus` or `plausible` witness. A `crafted` witness is resolved with a
  decline or a known-limitations line, and an allowed difference with no entry
  at all.
- A case with only a `crafted` witness is never a question for the user, in a
  report, a ROADMAP entry or a review finding: each answer to such a question
  adds a handler for a case that no real expression reaches. The agent gives the
  case a decline, or leaves its value unspecified where the caveats allow,
  writes the known-limitations line, and continues. A question to the user names
  its `corpus` or `plausible` witness; a question without one is not asked, and
  an unanswered question means "decline". A reviewer's finding with a `crafted`
  witness is answered with the decline or the known-limitations line, not with a
  handler. When the agent cannot tell `plausible` from `crafted` (the header of
  `ROADMAP.md` defines both), it records the case as a known-limitations line
  marked `plausible?`, with the one-or-two-line program; the user sweeps those
  lines and promotes any of them to a ROADMAP entry.
- Judge a design change first by correctness within the caveats (a wrong finite
  value or shape is never acceptable; an expression whose static type is `error`
  declines), then by the code it removes or adds: a change that gives the same
  values with fewer handlers is better. Declines removed per target count only
  for `corpus` or `plausible` witnesses. The number of changed tests and
  snapshots is a cost to report, not a reason to choose.
- When working autonomously, continue independent work while a decision is
  pending. Report unresolved decisions and verification failures explicitly. At
  a design choice, take the option you recommend, continue to the end, and
  report each choice with its alternatives so the user can reverse it. Stop to
  ask only before an action that is hard to undo or outside this repo, before
  reversing a decision the user made, or when no option is clearly sound; put
  such questions together in one message at the end. This grouping does not
  apply to a defect found during the task that the task's own code could fix:
  report it to the user in the same turn you find it, with the option you
  recommend.
- `ROADMAP.md` must get shorter over time. Take only `ready` entries without
  asking; `proposed`, `decision needed` and `design needed` entries wait for the
  user (the states are defined in the header of `ROADMAP.md`). Do not add an
  entry for an idea (a capability, a performance change, a design or a task):
  put it in the report to the user, and add it as `proposed` only when the user
  says to record it. Every defect entry names its witness and the strength of
  the witness.
- Do small follow-up work without asking, and report it: a review that the
  process still requires, a ROADMAP entry for a limitation the user decided, and
  removal of the worktrees, references and temporary files you created. Commits,
  git commands that are not on the allowed list, and actions outside the repo
  still need the user's approval, except the documentation edits in the next
  rule.
- When a change adds or changes public behavior (an exported API, a type string,
  a MathJSON operator, LaTeX or Epsil syntax), check the user-facing guides and
  references in `~/dev/cortexjs.io/docs/compute-engine/` and update the pages
  that describe that behavior. You may edit these files directly, without asking
  first. Run no git command in that repo, and list each edited page in the
  report. Do not hand-edit `changelog.md` or `api.md` there: the site build
  makes them from `CHANGELOG.md` and `src/api.md`. Do not edit
  `~/dev/cortexjs.io/docs/epsil/`: the site build copies it from
  `src/epsil/docs/`, so edit the page in this repo instead. Run each example
  that a page shows against the current source before you write its result.
- Follow BUILD.md and the shared-box specifics for completion checks; after-edit
  hooks and commit-time formatting do not replace them. Capture test exit codes
  directly rather than relying on the exit status of an output-filtering pipe.
- The instructions exist to make the work efficient. When one asks for work that
  looks redundant in the case at hand (a check that already ran on the same
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
