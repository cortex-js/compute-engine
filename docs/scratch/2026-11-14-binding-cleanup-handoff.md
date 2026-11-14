# Binding workstream: handoff after release 0.189.0

Written 2026-11-14 by session `ce-desk` for the session that continues the
"bound once" workstream. Delete this file when its three parts are done or
have their own record.

## Prompt to paste in the new session

> Continue the Compute Engine binding workstream from
> `docs/scratch/2026-11-14-binding-cleanup-handoff.md`. Read it, then the
> documents it names for the part you start. The order, decided by the user
> on 2026-11-14: (1) a cleanup pass on what landed in 0.189.0, from the
> deletion inventory; (2) the remaining work of the workstream; (3) the
> issues collected on the way. Start with part 1. You are authorized to
> commit in this session as needed; the user releases.

## State

- Release 0.189.0 (tag `v0.189.0`, commit
  `507c6cb927aa47afdf55085bedf6f512171770fd`) holds the workstream's work:
  `inputs`, the fix of CE-1279, effects and undefined call heads read from
  the scope of boxing, D16, D17. Tycho's full adoption gates were clean on
  it; Tycho has not adopted it yet.
- After the release, on main: pull request #571 (`c051c99a62bc79d09928ce501c4aba3d315986a4`,
  breaking, session compute-engine-00) and issue or document commits.
  `issues/CE-1279.md` has an uncommitted edit that is not this session's.
- The source did not shrink: the five commits of 2026-11-13/14 are +1,336
  −571 lines under `src/`. The user expected machinery to go; part 1 is the
  answer.
- Nothing is running, and no worktree of `ce-desk` is left.

## Read first

| For | Document |
|---|---|
| The rules and the decisions D5 to D18 | `docs/plans/2026-11-11-bound-once-spec.md`, sections 2 to 7 and 11 |
| What a user sees, and what the user has not decided | `docs/plans/2026-11-13-names-and-types-user-model.md`, section 7 |
| What can be deleted | `~/dev/compute-engine-recovery/ce-deletion-inventory.md` |
| What each change measured | `~/dev/compute-engine-recovery/effects-scope/report*.md`, `fc-d16/report-r6.md`, `fc-d16/s2-investigation.md`, `d17-pop/report.md` |
| Earlier leftovers | `docs/plans/2026-11-12-earlier-mechanism-leftovers.md` |

## Part 1: the cleanup pass

From the inventory (a read-only audit; its "est." figures are estimates).
Each item is its own small change, with the tests the inventory names.

Deletable now, verified by reference search (about 48 lines):

1. The boxing epoch: `_boxingEpoch`, `currentBoxingEpoch()` and its 9
   writers, `TypeProvenanceEntry.epoch`. `TypeProvenanceEntry` is a public
   type (`src/api.md`), so the removal is a CHANGELOG entry; two tests of
   `boxing-depth-headroom.test.ts` count `_boxingEpoch` and are rewritten.
2. The `symbolSignature` branch of `axisMaskOf`
   (`engine-configuration-lifecycle.ts`, near line 410), a no-op.

Probably redundant, NOT tested (about 55 to 75 lines): show each with a
probe before removing it.

3. The devolve half of `forbidsRepairs` (`validate.ts`, near 1070 and 1167).
4. `activationViewDiverges()` inside `_typeCacheFallbackGeneration()`.
5. `storedValueFreeNameRead()` (`binders.ts`), which reads a stored value's
   free name from the current scope.

What waits, and what unlocks it (about 3,300 lines, estimated):

- **The provisional registry and forward-call references (about 1,300).**
  Waits for step 2 of the spec (stored function bodies as units) and for
  the decision on leftover 2. Cheapest first step: remove leftover 2 again
  and rerun `tycho-item-182`, which hung before; `6dbc33b11` changed how
  the effects of an undeclared call head are read. Against it: the static
  effects walk still gives an undeclared head `any`
  (`effects-inference.ts`, near 3540).
- **The rollback frame and what it serves (about 900).** In this order: the
  same store for block locals and binder variables that D18 gave
  parameters (about the size of D18); the three sites of `library/core.ts`;
  operator-signature inference moved out of host definitions; then the
  item above. The Epsil static check is the last user: confirm that its 48
  declaration entries all land in the scope it pushes and pops itself.
- **Name lookups in the compiler (about 1,100).** `compile-scope.ts` and
  `shadowing-calls.ts` exist because the compiler looks a name up by its
  spelling from the current scope (116 lookups in 45 files). Not a named
  item of the spec; ask the user before starting it.
- `deriveAndWriteAssignedType` (183 lines) waits for the user's decision on
  the set-once rule.

Not examined by the audit: the 356 `lookupDefinition(` calls one by one,
the 51 readers of `_anyVersion`, the call-head declarations of
`invisible-operator.ts`, leftover 7 (recursion knots), scratch scopes and
value shields.

Also ask session `tycho-desk` for Tycho's own inventory on 0.189.0: what it
can delete now with line counts, and what blocks each remaining piece. Its
one trial so far (`inputs` at `withByReferenceScope`) was +25 −3 lines.

## Part 2: the remaining work

In the order recommended to the user on 2026-11-14 (not confirmed item by
item):

1. Parameter uses collected before the body is boxed, so that the
   whole-or-mapped choice does not depend on the order of the uses
   (`issues/CE-1270.md`; measured earlier as mode `two`:
   `~/dev/compute-engine-recovery/fc-bit/report.md`). It needs the user's
   answer to points 1 and 2 of section 7 of the names-and-types document.
2. `issues/CE-1280.md` (P2): a canonical rewrite reads a type or a sign
   inferred from a variable's value. A declared type remedies the
   integer-exponent fold only. Recommended fix: a canonical rewrite reads
   only what an assignment cannot change. Its cost in tests is not
   measured.
3. The rollback frame (see part 1).
4. Held arguments (ROADMAP CE-1258), the `Program` operator (ROADMAP
   CE-1255), the requirements-as-data API that Tycho asked for.
5. Not checked by `ce-desk`: the state of step 2 of the spec and of the
   batch (step 5).

Waiting for the user:

- The set-once rule for a worked-out type (point 6 of section 7): measured,
  not landed. A narrower variant was proposed and is not measured: enforce
  the kind of a variable, drop sizes, let the number type inside the kind
  widen. Patches: `~/dev/compute-engine-recovery/fc-d16/r6-experiment-*.patch`.
- Points 1 to 5 of section 7.
- `issues/CE-1271.md` (needs-decision).
- `Tan` of a real variable is typed `real` also on a pole (`ce-desk`'s
  choice; the alternative is `fc-d16/r5/tan-experiment.patch`).
- Pull requests #493 and the `Rationalize` half of #541 (session
  compute-engine-00).

## Part 3: issues collected on the way

Filed: CE-1270, CE-1271, CE-1277 (`Map` over a `Composition` reads the
current scope), CE-1280, CE-1290 (one signature line left), CE-1303 (P2, an
Epsil `while` with an undecided condition never returns), CE-1304 (P3,
`L := 7` after a list records the literal type `7`), CE-1210 (performance;
the othello call and the audit are now faster than the 0.187.1 baseline,
the `turing-patterns` run step is still 8 to 9% slower than 0.187.1, cause
not determined: narrow the issue to that, or close it with the board).

Seen and NOT filed (no program reaches them; file each with its witness, or
write a known-limitations line, as `docs/ISSUE_TRACKING.md` says):

- `compilation/pool-loop.ts` checks a free call head by its name in the
  current scope.
- A `Block` rebuilt in the same scope with other statements (`.subs()`)
  can keep one cached type.
- `CE_TYPE_PARANOID` does not cover `parameterSignatureCell`,
  `_forwardRebox`, `_literalArrowEffects`.
- The cost of copying a symbol argument into a call's result (D17) is not
  measured on its own.

## How a change was landed in this workstream

1. One implementer agent per item, in a linked worktree under `/tmp`, with
   stop conditions in the brief (a line limit, "stop if a test changes its
   value"). It commits in its worktree and saves patches and logs in
   `~/dev/compute-engine-recovery/<item>/`. The session saves the agent's
   final message there as a report file.
2. Checks on the final head: type check, `check:deps`, the touched test
   files alone, `test:core`, one full `npm test`, and the stale-answer
   check (`CE_TYPE_PARANOID=1` over 834 test files: script and file list in
   `~/dev/compute-engine-recovery/fc-d16/`, `para.sh` and
   `probe-test-files.txt`).
3. A dual review of the worktree range: the Codex script run from inside
   the worktree, and a Claude reviewer told to work in the worktree. Then a
   further Codex pass on each round of fixes, until a pass finds nothing.
   The reviews found a high-severity defect in each of the first four
   rounds.
4. A packed build of the worktree head to `tycho-desk`, which runs Tycho's
   codegen audit, node tests, census and timings and reports back. Its
   gates found two regressions that the suite passed.
5. The change applied to main as one patch and committed by paths.

Scripts of step 4 and 5, as they were run: `~/dev/compute-engine-recovery/scripts/`.

## Traps met

- The git hook refuses `git checkout` and `git commit` after a `cd`: use
  `git -C <worktree> …` in a Bash call of its own.
- The `rm` hook wants literal paths, in a Bash call of its own. Remove the
  `node_modules` symlink of a worktree before `git worktree remove`.
- A patch made in a long-lived worktree can place a CHANGELOG entry under
  an already released section (the context lines match there): read the
  top of `CHANGELOG.md` after applying.
- Tycho names its certificate helpers with one process-wide counter: two
  audits are compared with the names aligned, or a decline in one document
  shifts every later record.
- `npm pack` runs a post-pack check that needs an npm login; the tarball is
  made before it.
- Main moves under a long task (34 commits from another session during
  D16): validate on main's current head in a landing worktree before the
  commit.

## Peers

- `tycho-desk` runs Tycho's gates and reports to `ce-desk`. Tell it the
  name of the new session.
- `compute-engine-00` lands the contributor pull requests.
