# Questions for Tycho: the strict linear posture and cell replay

**Date:** 2026-08-18 · **Status:** workstream 3 of the strict
linear-posture investigation — awaiting Tycho's answers ·
**Companions:** `docs/plans/2026-08-18-linear-posture-audit.md` (what
the engine would delete and what it must keep),
`docs/plans/2026-08-18-checkpoint-restore-design.md` (the engine API
that would replace the current behavior). This document is
self-contained: no context beyond it is needed to answer.

## Background — what the engine does today, and what is being considered

The Compute Engine currently supports two regimes for re-declaring a
name:

- **Within one program** (one `executeEpsil` call), declaring the same
  `type`, `protocol`, or same-parameter-list function clause twice is an
  **error** (shipped in 0.108.0).
- **Across programs** (separate `executeEpsil` calls — the notebook
  "re-run an edited cell" gesture), a re-declaration **replaces** the
  previous definition in place, and the engine then propagates the
  replacement: conformance edges are re-validated, objects built before
  the change are guarded against the new layout, dependent declarations
  are re-checked.

Concretely, today:

```epsil
// Cell 3, first run:
type Point = object<x: integer, y: integer>

// User edits cell 3 and re-runs JUST that cell:
type Point = object<x: number, y: number, label: string>
```

The second run replaces `Point` in the live engine. Objects built before
the edit keep their old layout (reads against them are guarded);
everything created afterward uses the new one.

**The proposal under consideration ("strict linear posture"):** the
across-program replacement is removed — a re-declaration errors there
too, exactly as within one program — and the notebook gesture is
implemented client-side instead: the engine gains a
`checkpoint()` / `restore()` API (designed, not yet built — see the
companion design doc), the client takes a checkpoint after each cell,
and an edit of cell k becomes *restore the checkpoint taken before cell
k, then replay cells k…n*. The replayed world is then exactly the linear
program, with none of the in-place-replacement machinery involved.

Why we are considering it: the replacement machinery is the most
expensive complexity in the engine (~1,400 source lines and ~1,900 test
lines exist only for it; the last work package on it took nine review
passes to converge), it has a queue of open follow-up work that only
exists to serve it, and every difference between the two regimes is a
place where "works in the notebook, fails compiled" bugs can hide.

Why we are asking you: the feasibility hinges almost entirely on how
Tycho drives the engine. The questions below are the decision inputs.

---

## Q1 — Does the whole-scope re-execution commitment still stand?

`docs/plans/2026-08-01-function-polymorphism-design.md` records, as an
external product commitment (2026-08-01): *"The notebook host defines
scopes and re-executes the whole scope on edit"* — and on that basis the
engine "does not grow reset-on-new-run heuristics."

**The question:** is that still how Tycho behaves today — an edit
re-executes the whole scope (or will, in the shipped product)? Or does
Tycho now (or plan to) re-run a single edited cell in place, relying on
the engine's cross-program replacement to reconcile?

**Why it matters:** if the commitment stands, Tycho's primary flow is
already replay-shaped and the strict posture mostly formalizes what you
do — the checkpoint API is then a *latency optimization* (skip replaying
cells before the edit), not a behavior change. If the commitment has
lapsed and you re-run single cells in place, the strict posture is a
real migration for you, and everything below matters more.

**If unanswered:** we must assume the commitment lapsed and treat the
proposal as a full migration, which raises its cost estimate
substantially.

## Q2 — Replay cost: what is your latency budget, and what are the worst cells?

Under the proposal, editing cell k costs: one `restore()` (bounded by
the state the discarded cells touched — cheap) plus re-running cells
k…n. Order-of-magnitude numbers from a dev build on an M-series laptop:
a fresh engine constructs in ~8 ms (warm process), light cells evaluate
in 4–15 ms each. A 50-cell notebook of light cells replays in well under
half a second; a notebook whose cell 2 is a 10-second integration
replays that integration every time a later cell is edited — unless the
client replays only the cells after the edit point (which the
checkpoint API gives you for free: cells BEFORE the edit are restored,
never re-run).

**The questions:** (a) What is your interactive latency budget for
"user re-runs an edited cell"? (b) What are the heaviest realistic
cells in user notebooks (long solves, big data, plots)? (c) Is
restore-plus-replay-the-suffix within budget for those, or do you also
need output caching so unedited *downstream* cells can redisplay
without re-executing?

**If unanswered:** we will size against "suffix replay must complete in
under ~1 s for a 50-cell notebook with one heavy cell," which may be
stricter or looser than your real product bar.

## Q3 — Effectful cells: what should replay do with them?

Replay is not semantically transparent: a replayed cell that calls
`Random()` draws fresh values; `Print` prints again; `Input` prompts
again. The engine can make replay *possible*; it cannot make these
effects invisible. Clients typically handle this by replaying only the
dirty cone, caching outputs of clean cells, and giving effectful cells
an explicit affordance ("this cell reads input — re-run to refresh").

**The question:** what treatment do you want for (a) `Random()` cells —
accept fresh draws, or do you want a per-cell seed affordance? (b)
`Print` output — re-rendered from cache or re-executed? (c) `Input`
cells — re-prompt on every replay, or hold the previous answer and
re-prompt only on explicit re-run?

**If unanswered:** the engine ships replay with effects re-executing
verbatim, and any smoothing is later client work.

## Q4 — Cross-cell COMPLETION (not redefinition): keep it?

Distinct from re-declaring: today you may declare a conformance in one
cell and implement it in a later cell —

```epsil
// Cell 2:
type Point is Printable        // conformance declared, pending

// Cell 5:
type Point is Printable { print(self) = ... }   // fulfilled
```

Nothing is redefined here — state accumulates monotonically. The strict
posture as scoped targets *redefinition only*, so our recommendation is
that completion stays legal. But it rests on the same
"incremental session" framing, so we want it decided explicitly rather
than by accident.

**The question:** do Tycho notebooks rely on this pattern (declare now,
implement later, across cells), and do you agree it should remain legal
under the strict posture?

**If unanswered:** we keep completion legal (recommended), and only
replacement errors.

## Q5 — Do you ever re-run ONE cell in place, without replaying what follows?

If Tycho's UI offers (now or planned) a "run just this cell" action on
an *edited* declaration cell — without restore-and-replay — then under
the strict posture that action changes behavior: today it replaces the
declaration; under the proposal it errors with
`type-redefinition`-class diagnostics ("already declared").

**The question:** does such an action exist or is one planned? If yes,
what should it do for an edited declaration cell — (a) become
"restore + replay from here" under the hood (our recommendation; it is
what the checkpoint API is for), (b) surface the error to the user, or
(c) something else?

**If unanswered:** we assume (a) and design the error messages to point
users at re-running from the edited cell.

## Q6 — Do you hold live engine values across edits (plots, caches)?

Under restore-and-replay: engine values your code retained from cells
*at or after* the edit point become invalid after the restore (they may
reference disposed internal state), and replayed objects do not keep
identity (identity hashes differ; values compare equal). Values from
cells *before* the edit point remain valid. The practical rule: cache
cell outputs as **serialized** artifacts (MathJSON, strings, plot data
arrays), never as live boxed values from cells that may be replayed.

**The question:** does Tycho (including math-plot) currently hold live
`BoxedExpression` values across an edit — e.g. a plot keeping a
compiled function or a boxed result from cell 7 while the user edits
cell 4? If yes, is moving those to serialize-and-rebox (or re-derive on
replay) acceptable?

**If unanswered:** we ship the epoch rule as stated and any live-value
retention on your side becomes undefined behavior after a restore.

## Q7 — The checkpoint API shape: any client constraint we are missing?

The designed API (companion doc, §3): `ce.checkpoint()` at a quiescent
cell boundary → a token; `ce.restore(token)` rewinds (invalidating
later checkpoints); `ce.discard(token)` releases one. Checkpoints form
a single linear stack — no branching. `checkpoint()` is legal on a
fresh engine, so a session-start checkpoint covers editing the first
cell. Errors are typed (`checkpoint-not-quiescent`, `checkpoint-dead`,
`checkpoint-foreign-engine`, `checkpoint-restore-failed`).

**The questions:** (a) One engine per notebook, or shared engines? (A
checkpoint token is engine-bound.) (b) Do you evaluate cells inside a
pushed scope of your own, or at the engine's top level? (The v1 design
supports checkpoints only at the session-base scope depth; supporting
checkpoints inside a host-pushed scope is a v2 item if you need it.)
(c) Do you ever need two histories alive at once (compare-two-versions
UI)? That would be a branching requirement the current design
deliberately excludes.

**If unanswered:** v1 assumes engine-per-notebook, top-level cells, no
branching.

---

## What happens if none of this is decided

The engine keeps its current dual-regime behavior indefinitely: the
~1,400-line replacement machinery stays and keeps accruing follow-up
work (the "widening redefinition" package is next in that queue), and
the checkpoint API — useful to Tycho under EITHER posture, since it
also accelerates the whole-scope re-execution you may already do — is
not built. One engine-side fix proceeds regardless of any answer: a
declaration statement currently pays the conformance re-settlement
sweep twice per `type` statement even with no redefinition anywhere
(~1.2 ms per statement in a modest engine); making the second
registration a no-op is queued independently.

## Our overall recommendation, for calibration

Adopt the strict posture for `type` / `protocol` / conformance
*replacement* and same-clause function replacement; keep plain value
assignment, clause *addition*, and cross-cell *completion* (Q4) as they
are; build the checkpoint API first so the migration lands on something.
The two questions that could genuinely reverse this recommendation are
Q1 (if you depend on single-cell in-place re-run as the primary flow)
and Q2 (if suffix replay cannot meet your latency bar even with
checkpoints).
