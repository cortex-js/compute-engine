# Brief: interval arithmetic as a mode of the IR pipeline

Status: a brief for a new session, written by session `ce-compiler` on
2026-11-15 at `52a408a81e65f6a358b71219721642211e73514b`. Step 1 is written
by session `ce-interval` (2026-11-15):
`docs/plans/2026-11-15-ir-interval-mode.md`, APPROVED by the user on
2026-11-15 with the decisions at its top. Step 2 is in progress: the
measure of Tycho's core corpus is in section 12a of the note, a census of
the suite's interval compilations runs in `/tmp/wt-ce-interval` (temporary
instrumentation, not to land) and is recorded in section 12b. Batch 1 is
committed, `926016f4ce9fcd4dc07e74541046e7d46a461020`. Batch 2 is written
and reviewed (section 14 of the note; patches in
`_TASKS/2026-11-15-interval-mode/`). Next: a packed build for Tycho's audit
of the interval seam, then lists (`At`, list inputs) and integrals.

## Goal

`compile(expr, { to: 'interval-js' })` is served by the pipeline in
`src/compute-engine/compilation/ir/`, as a mode of its JavaScript target
(as `mode: 'bigint'` is), and `interval-javascript-target.ts` (7,741 lines)
is deleted. The interval library `src/compute-engine/interval/` (8,197
lines, the `_IA` functions) stays: it is the runtime.

Why: the interval target is one of the two targets that keep the shared
layer of the old compilers alive (about 103,000 lines in 96 files of
`compilation/`). That layer can go only when JavaScript, GLSL, interval and
Python are all off it. The Python target is dropped (user decision of
2026-11-15); JavaScript and GLSL are the work of session `ce-compiler`.

## What a mode is here

The pipeline lowers a program once to an IR (`ir/lower.ts`, one walk,
decline by default), runs passes (`ir/passes.ts`) and prints it with a
syntax table (`ir/print-js.ts`: `JS`, and `JS_BIGINT` for the bigint mode).
The bigint mode is the model: the same lowering, another representation of
a number, another table of spellings, some passes off, its own entry
conversions in `ir/adapter.ts`. Read how `mode === 'bigint'` is wired in
`ir/index.ts` and `ir/adapter.ts` before designing anything.

## Read first

- `AGENTS.md`, `docs/COMPILATION-MODEL.md` ("Caveats of compiled code",
  "Shapes are settled at compile time", and what it says of `interval-js`),
  `docs/COMPUTE-ENGINE-BOX-SPECIFICS.md`.
- `src/compute-engine/compilation/ir/README.md`, all of it.
- `docs/plans/2026-11-09-js-compiler-status-and-plan.md`: the sections from
  "Course correction and the IR pipeline" on (the rules, the method per
  batch, the user decisions), and
  `docs/plans/2026-11-12-js-route-course-correction.md`, section 2 (the
  contract).
- `src/compute-engine/compilation/interval-javascript-target.ts` and
  `src/compute-engine/interval/types.ts` (`IntervalResult`: `interval`,
  `empty`, `entire`, `singular`, `partial`).
- Tycho's three call sites: `~/dev/tycho/src/plot/ce-compile.ts`, the
  compilations with `to: "interval-js"` (options `hideValues`,
  `scalarInputs`, `byReference`; results typed `IntervalResult`).

## Rules (the same as for the rest of the pipeline)

- Simplicity of the compiler first. An operator is a table row plus a
  spelling. A decline is always acceptable and falls back to the
  interpreter; it is the preferred answer to a case that would need a
  handler of its own. The pipeline stays under 10,000 lines (7,482 today):
  plan for 400 to 600 lines for this mode, and stop and report if the
  design needs much more.
- The existing interval target's output is not a reference. The reference
  is the meaning of an interval result: the compiled interval contains
  every value the interpreter gives for a point of the input box. A result
  that is wider than the existing target's is allowed and is reported with
  a measure; a result that misses a value is a defect.
- Shapes are settled at compile time; no run-time test of a type.
- No change of behaviour of the other targets and modes. Byte-identical
  emitted code for programs that do not use the mode.
- Method per batch, as in the status document: an implementer agent in a
  worktree, two independent reviews (Codex and a Claude reviewer) briefed
  on correctness and architecture, fixes, type check, `check:deps`, lint,
  the tests, then stage. Commit only with the user's approval in that
  session. Never print a process environment in an agent.
- A defect found in older code is an issue file (`docs/ISSUE_TRACKING.md`).

## Step 1: a design note, before any code

Write `docs/plans/2026-11-15-ir-interval-mode.md` and get the user's
approval of it. It answers, each with an example program and what the
interpreter, the existing interval target and the proposed mode give:

1. **Conditions.** A comparison of intervals has three answers (true,
   false, maybe). What `If`, `Which`, `And`, `Or`, `Not` and a comparison
   used as a value compile to; whether an arm is evaluated when the
   condition is "maybe"; what happens to an arm with an effect.
2. **Passes.** Which passes are sound and which lose tightness. Known
   case: `strength` turns `x^2` into `x·x`, which widens the result on a
   box that contains 0. State the rule for each pass (`scalarize`, `fold`,
   `strength`, `hoist`, `cse`, `dce`).
3. **The result contract.** How `IntervalResult` is produced (who makes
   `empty`, `entire`, `singular`, `partial`), what `run()` takes (an
   interval per input, a number for an input named in `scalarInputs`), and
   what the options `hideValues`, `scalarInputs` and `byReference` mean in
   the mode. `to: 'interval-js'` stays as the public spelling.
4. **Scope of the first version.** Which lanes (real, integer, boolean),
   which constructs (scalar arithmetic, the elementary functions,
   conditions, user functions, `Sum` with integer bounds) and what declines
   (lists, points, complex, colours, draws, integrals, a loop bound that is
   an interval), decided by a measure of step 2, not by guess.
5. **The discontinuous operators** (`Floor`, `Ceil`, `Round`, `Mod`,
   `Fract`, `Sign`, a division by an interval that contains 0, `Tan`): which
   `_IA` function reports the jump and how the mode passes it through.
6. **The size**: the files added and an estimate of their lines.

## Step 2: the measure

Before the first batch, a count of what the mode must cover:

- In CE's suite: a shadow measure of every `compile()` call with
  `to: 'interval-js'` (the existing switches are in
  `src/compute-engine/js-profile-switch.ts`: `CE_JS_PROFILE_SHADOW=ir`
  compiles every JavaScript and GLSL call with the profile as well and
  counts admitted, declined and failed; add the interval calls to it).
- In Tycho: ask session `tycho-desk` for a run of its audit on the interval
  seam with a build of the mode, as it does for JavaScript and GLSL: the
  calls admitted, the decline causes with one program each, and a
  containment check (the mode's interval contains the existing target's
  value at sample points, and the scalar compiler's value at points of the
  box). Tycho's corpus is the yardstick for done.

## Step 3: batches

A vertical slice first (scalar arithmetic and the elementary functions of
one real input, with tests), then conditions, then what the measure ranks
next. Each batch has: value tests of containment against the interpreter
at random points of random boxes, tests of tightness against the existing
target for the common functions (reported, not required to be equal), the
declines with their causes, and the three robustness tests required of
every batch (a shared graph of about 2^20 paths, a chain of 1,000 operands,
a nested loop: the compile ends in well under a second or declines).

## Done when

The mode is the implementation of `to: 'interval-js'` with a decline
falling back as today; Tycho's interval audit and its tests pass on it;
CE's suite is green; `interval-javascript-target.ts` and its registration
are deleted; the documents and the guide say what is true.

## Working beside session `ce-compiler`

- `ce-compiler` changes `ir/lower.ts`, `ir/lower-functions.ts`,
  `ir/lower-lists.ts`, `ir/index.ts`, `ir/print-js.ts` and `ir/adapter.ts`
  in most of its batches. Put the mode in new files where possible (a
  syntax table, the entry and result handling, the tests
  `test/compute-engine/ir-interval-*.test.ts`) and keep each edit of a
  shared file to the few lines that wire the mode.
- Before a batch that edits a shared `ir/` file, send `ce-compiler` a
  message that names the file and the function; before landing, apply the
  patch on the current main and run the `ir-` tests again.
- Staging and the box lock follow `~/.claude/SHARED-BOX-PROTOCOL.md`. The
  box lock is busy: run cheap checks first, the suite once per batch.
- Report to the user at the end of each step: what was built, the measures,
  each design choice with its alternative.
