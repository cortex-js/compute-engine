# Handoff: an audit and architecture review of the evaluation caches

Approved by the user on 2026-10-28. Start it in a new session after CE-601
(the per-evaluation cache of shared subexpressions) has landed.

## Goal

The Compute Engine keeps evaluated values for later reuse in many places. Each
place has its own key, its own lifetime and its own rule for deciding when a
stored value is out of date. Find out whether these caches can be reduced to a
few shared mechanisms with one rule for validity, and propose a design. The
deliverable is a design document, not code.

## Why now

In October 2026, adding a per-evaluation cache of shared subexpressions
(CE-601) took seven review rounds. Almost every round found another cache that
did not follow the rule of the moment. The rule was: a result computed while
host code ran is kept only when that code states `pure: true`. Each cache
needed its own guard, and several had defects of their own. For example, the
`Limit` probe cache returned `+∞` after a parameter changed sign, and the
application cache of user functions returned out-of-date values when a host
operator read a variable by name.

## Read first

- `docs/plans/2026-10-28-ce-601-cache-census.md`: the census of caches and
  host hooks written by the CE-601 work. For each cache it gives its location,
  whether host code can reach it, and how it is guarded.
- `ROADMAP.md`, the entries CE-601 and CE-594 (if still present), and
  `CHANGELOG.md`, the entry about caching host operators.
- `src/compute-engine/boxed-expression/host-handler-changes.ts` and
  `src/compute-engine/boxed-expression/shared-evaluation-memo.ts`.
- `docs/EFFECTS-MODEL.md` and `docs/RANDOMNESS-MODEL.md` (§6: one
  comprehension instance is one set of draws).
- `ARCHITECTURE.md`, and the "Common API Traps" section of `CLAUDE.md`.

## What to produce

Write `docs/plans/<date>-evaluation-cache-architecture.md` with:

1. **An inventory.** List every cache of evaluated or derived values, checking
   the census against the code at HEAD. For each one, give:
   - what it stores and what its key is;
   - its lifetime: one evaluation, one engine, or the whole process;
   - how it detects that a value is out of date: a version counter, a
     generation, a snapshot of dependencies, a time stamp, or nothing;
   - which engine state the stored value depends on: variable values,
     declarations, assumptions, precision, angle unit, random seed, effect
     registry, host state;
   - its measured benefit. Disable it and run the benchmarks
     (`benchmarks/README.md`) and the test suite's timing.
2. **The validity counters.** Today these include `_evaluationVersion`,
   `_persistentEvaluationVersion`, `_cacheGeneration()`, `_semanticVersion`,
   `_worldVersion`, `_definitionVersion`, the uncached host count, and the
   precision and assumption stamps. List each one: who advances it, and what
   it means. Point out the ones that overlap and the ones with gaps.
3. **A proposed design.** For example, a small number of cache kinds, each
   with one validity rule and one place that applies the host-code rule. A
   possible shape is a single "evaluation context stamp" that every cache
   records and checks. Say which existing caches would merge, which would be
   removed because their benefit is too small, and which must stay separate
   and why.
4. **A migration plan,** in steps that can each land on their own. Each step
   names its tests and its benchmark. No step may change a result except to
   fix a defect, and each such defect must be filed in `ROADMAP.md` with a
   `CE-<n>` number, read from the "Next free reference" line.
5. **Open decisions** for the user, each explained from scratch, with an
   example, the options, and what happens with each.

## Constraints

- Do not change source code. If you find a defect, file it in `ROADMAP.md`,
  with a repro, in the same session.
- Measure before you claim anything: name the probe or benchmark for every
  statement about speed or behavior.
- Use a worktree for any probe that needs code changes. Run jest only with
  `-w 2` or `-w 4`. Take the box lock (owner `<your session name>:cache-audit`)
  for the full suite and for benchmarks.
- Follow `~/.claude/SHARED-BOX-PROTOCOL.md` and the git rules in `CLAUDE.md`.
- When the document is written, run the dual review on it (`/review-spec`).
