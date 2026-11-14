# Binding workstream: handoff after the cleanup pass

Written 2026-11-14 by session `compute-engine-62` for the session that
continues the "bound once" workstream. It replaces
`2026-11-14-binding-cleanup-handoff.md` (session `ce-desk`). Delete this
file when parts 2 and 3 are done or have their own record.

## Prompt to paste in the new session

> Continue the Compute Engine binding workstream from
> `docs/scratch/2026-11-14-binding-part2-handoff.md`. Read it, then the
> documents it names for the item you start. The order, decided by the user
> on 2026-11-14: (1) the cleanup pass, done; (2) the remaining work of the
> workstream; (3) the issues collected on the way. Start with part 2, item
> 1 (CE-1270). The user's goal for the workstream is that types are settled
> before a run and that machinery is deleted: report the lines that each
> change adds and removes under `src/`. Ask the user before you commit.

## State on 2026-11-14

- Release 0.189.0 (`507c6cb927aa47afdf55085bedf6f512171770fd`) holds the
  workstream's work up to D17. Tycho has not adopted it yet.
- Part 1, the cleanup pass, is committed
  (`0e0344edb91eeffd585394edca5699d71bb9aa62`, source +62 −249): the boxing
  epoch, the `symbolSignature` flag of an inference event,
  `activationViewDiverges()`, and the stored-value block-local skip of
  `freeNameBindingAndScope` are removed. A free name of a stored value is
  read from its home scope.
- Removed from part 1 and NOT landed: a trial validation that runs
  `devolveUnappliedOperator`. `_asFreeVariable()` writes a variable reading
  into the unit environment of the boxing (`setReadsAsVariable()`). Neither
  the rollback frame nor the trial environment undoes that write, so
  `ce.infer()` reports a library letter that the winning arm did not
  devolve. Both reviewers found it. It can land once a trial writes its
  unit readings into the trial environment.
- The user decided every open point of section 7 of
  `docs/plans/2026-11-13-names-and-types-user-model.md`:
  1. A copy into a local is not a use of a parameter.
  2. An indexed parameter takes its argument whole.
  3. The worked-out parameter types decide no value except through rule 7
     and the matrix case.
  4. `five(s) = 5` keeps `[5, 5]`.
  5. Lists of different lengths stay an error.
  6. The set-once rule is rejected: an inferred type widens. CE-1304 was
     fixed with this decision.

  CE-1271 is closed with a known-limitations line in `docs/TYPE-SYSTEM.md`.
- Nothing is running. No worktree of this session is left. `src/api.md`
  still lists `TypeProvenanceEntry.epoch` and is regenerated at release.

## Read first

| For | Document |
|---|---|
| The rules and the decisions D5 to D18 | `docs/plans/2026-11-11-bound-once-spec.md`, sections 2 to 7 and 11 |
| What a user sees, and the decisions of 2026-11-14 | `docs/plans/2026-11-13-names-and-types-user-model.md`, rules 1 to 8 and section 7 |
| What can still be deleted, and what blocks it | `~/dev/compute-engine-recovery/ce-deletion-inventory.md` (items 1a, 2b, 2c, 3a, 5c, 6b, 6e, 9a, 9b) |
| What each earlier change measured | `~/dev/compute-engine-recovery/effects-scope/report*.md`, `fc-d16/report-r6.md`, `fc-d16/s2-investigation.md`, `d17-pop/report.md`, `fc-bit/report.md` |
| Earlier leftovers | `docs/plans/2026-11-12-earlier-mechanism-leftovers.md` |

## Part 2: the remaining work

This is the order I recommended to the user on 2026-11-14; the user has
not confirmed it item by item.

1. **CE-1270 (P2).** Collect a parameter's uses before the body is boxed,
   so that the whole-or-mapped choice and the matrix reading do not depend
   on the order of the uses. Witness: `A·B − B·A` with untyped `A` and `B`
   gives the zero matrix. The issue gives three options:
   - (a) box the body a second time;
   - (b) a product of `unknown` parameters is not reordered;
   - (c) document the case.

   The first witness needs (b) or (c). The two-pass mode was measured
   before as mode `two` (`~/dev/compute-engine-recovery/fc-bit/report.md`).
   What counts as a use is now decided: only a direct use (point 1), and
   an indexed parameter is whole (point 2). Point 2 changes the value of
   about 10 tests. When it is built, send a packed build to `tycho-desk`
   for a CORE render audit through `scripts/repros/ce-alt-hook.mjs`. Tycho
   found 41 such definitions in 23 documents of its extended Desmos
   corpus, none in CORE, and does not rely on the mapping.
2. **CE-1280 (P2).** A canonical rewrite reads a type or a sign inferred
   from a variable's value. A declared type remedies only the
   integer-exponent fold. Recommended fix: a canonical rewrite reads only
   what an assignment cannot change. Its cost in tests is not measured.
   Open with the user.
3. **The rollback frame** (about 900 lines, estimated). In this order:
   - the same store for block locals and binder variables that D18 gave
     parameters (about the size of D18);
   - the three sites of `library/core.ts`;
   - operator-signature inference moved out of host definitions;
   - then the provisional registry (below).

   The Epsil static check is the last user: confirm that its 48
   declaration entries all land in the scope that it pushes and pops
   itself.
4. **The provisional registry and forward-call references** (about 1,300
   lines, estimated). They wait for stored function bodies as units, and
   for the decision on leftover 2. Cheapest first step: remove leftover 2
   again and rerun `tycho-item-182`, which hung before (`6dbc33b11`
   changed how the effects of an undeclared call head are read). Against
   it: the static effects walk still gives an undeclared head `any`
   (`effects-inference.ts`, near line 3540).
5. **Held arguments** (ROADMAP CE-1258), the `Program` operator (ROADMAP
   CE-1255.1) and the requirements-as-data API that Tycho asked for.
6. **Still in the code and expected to go** (bound-once spec, "State: step
   1 is on main"): the rebuild of closures at the end of a call
   (`captureClosures`; disabling it broke 162 tests, cause not known) and
   the automatic listing of a finite lazy list at an assignment
   (`listedAssignedValue()`). CE-1259 and CE-1260 (regressions of hold
   functions) are open.

Ask the user before starting:

- **Name lookups in the compiler** (about 1,100 lines, estimated):
  `compile-scope.ts` and `shadowing-calls.ts` exist because the compiler
  looks a name up by its spelling from the current scope (116 lookups in
  45 files). This is not a named item of the spec.
- **Tycho's own inventory on 0.189.0**: ask `tycho-desk` what it can delete
  now, with line counts, and what blocks each remaining piece.

Waiting for the user:

- `Tan` of a real variable is typed `real` also on a pole (`ce-desk`'s
  choice; the alternative is `~/dev/compute-engine-recovery/fc-d16/r5/tan-experiment.patch`).
- Pull requests #493 and the `Rationalize` half of #541 (session
  `compute-engine-00`).

## Part 3: issues collected on the way

Open:

- CE-1270 (P2) and CE-1280 (P2): part 2 above.
- CE-1303 (P2): an Epsil `while` with an undecided condition never
  returns.
- CE-1210 (P2, `needs-design`): the `turing-patterns` run step is 8 to 9%
  slower than 0.187.1. Narrow the issue to that, or close it with the
  board.
- CE-1277 (P4): `Map` over a `Composition` reads the current scope.
- CE-1290 (P4): one signature line left.

Seen and NOT filed. No program reaches them yet: file each with its witness,
or write a known-limitations line, as `docs/ISSUE_TRACKING.md` says.

- `compilation/pool-loop.ts` checks a free call head by its name in the
  current scope.
- A `Block` rebuilt in the same scope with other statements (`.subs()`)
  can keep one cached type.
- `CE_TYPE_PARANOID` does not cover `parameterSignatureCell`,
  `_forwardRebox` or `_literalArrowEffects`.
- The cost of copying a symbol argument into a call's result (D17) is not
  measured on its own.

## How a change is landed

1. **Worktree.** Work in a linked worktree under `/tmp`, with the
   `node_modules` of the main tree symlinked into it. Use one implementer
   agent per item for a large item, with stop conditions in the brief (a
   line limit, "stop if a test changes its value"). Do a small item
   yourself. Commit in the worktree.
2. **A removal whose safety is not proved by a reference search:** probe
   it first. Put a temporary check behind an environment variable that
   logs each case where the old and the new code differ, and run it over a
   wide set of test files. Part 1 used this for item 8c (525 reads, no
   difference).
3. **Checks on the final head:**
   - typecheck and `check:deps`;
   - the touched test files alone;
   - one full `npm test` (about 3 minutes on this machine; under the box
     lock);
   - the stale-answer check: `CE_TYPE_PARANOID=1` over the 834 files of
     `~/dev/compute-engine-recovery/fc-d16/probe-test-files.txt`, in
     chunks of 40.
4. **Dual review of the worktree range.** Run
   `bash ~/.claude/review-common/codex-review.sh --range A..B` from inside
   the worktree, and give a Claude reviewer the worktree path. Review each
   round of fixes, as `~/.claude/review-common/PIPELINE.md` step 8a says.
   In part 1, both reviewers found the same medium defect.
5. **Tycho.** For a change that can move a value or a type, send a packed
   build of the worktree head to `tycho-desk`. It runs Tycho's codegen
   audit, node tests, census and timings. Its gates once found two
   regressions that the suite passed.
6. **Landing.** Apply the change to main as one patch (`git diff A B` as a
   file, then `git apply`; never `-R`). Check that main has not moved, or
   validate on its current head. Commit by paths, because other sessions
   leave unstaged changes in the tree.

## Traps met

- The git hook refuses `git checkout` and `git commit` after a `cd`. Use
  `git -C <worktree> …` in a Bash call of its own. A refused command runs
  none of its parts: a heredoc in the same call is not written either.
- The `rm` hook wants literal paths, in a Bash call of its own. Remove the
  `node_modules` symlink of a worktree before `git worktree remove`.
- To undo a commit in a worktree, `git revert` is not on the allowed list.
  Apply `git diff <new> <old>` as a patch instead.
- A Python edit that asserts each match can stop partway through a list of
  files: the files before the failing match are written, the rest are not.
  Grep for the removed names after each edit script.
- Prettier is not part of the hooks: run `npx prettier --check` on each
  changed file and compare with the base. Some test files were already
  unformatted.
- A patch made in a long-lived worktree can place a CHANGELOG entry under
  an already released section (the context lines match there). Read the
  top of `CHANGELOG.md` after applying.
- Tycho names its certificate helpers with one process-wide counter.
  Compare two audits with the names aligned, or a decline in one document
  shifts every later record.
- `npm pack` runs a post-pack check that needs an npm login. The tarball is
  made before that check runs.

## Peers

- `tycho-desk` runs Tycho's gates. It was told on 2026-11-14 to send
  binding-workstream reports to `compute-engine-62`: tell it the name of
  the new session.
- `compute-engine-00` lands the contributor pull requests.
