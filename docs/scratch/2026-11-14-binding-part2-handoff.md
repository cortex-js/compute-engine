# Binding workstream: handoff after the cleanup pass

Delete this file when parts 2 and 3 are done or have their own record.

## Prompt to paste in the new session

> Continue the Compute Engine binding workstream from
> `docs/scratch/2026-11-14-binding-part2-handoff.md`. Read it, then the
> documents it names for the item you start. The order, decided by the user
> on 2026-11-14: (1) the cleanup pass, done; (2) the remaining work of the
> workstream; (3) the issues collected on the way. Start with part 2, item
> 1 (CE-1270). The user's goal for the workstream is that types are settled
> before a run and that machinery is deleted: report the lines that each
> change adds and removes under `src/`. Commit when ready.

## State on 2026-11-14

- Release 0.189.0 (`507c6cb927aa47afdf55085bedf6f512171770fd`) holds the
  workstream's work up to D17. Tycho has not adopted it yet.
- Part 1, the cleanup pass, is committed
  (`0e0344edb91eeffd585394edca5699d71bb9aa62`, source +62 −249): the boxing
  epoch, the `symbolSignature` flag of an inference event,
  `activationViewDiverges()`, and the stored-value block-local skip of
  `freeNameBindingAndScope` are removed. A free name of a stored value is
  read from its home scope.
- Issue CE-1210 notes performance regression that needs to be investigated and
  resolved.
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
- Part 2, items 1 and 2 are committed (2026-11-14, session `ce-desk`),
  after dual reviews, the full suite, the stale-answer check and Tycho's
  gates (codegen audit, census, node tests, timing, CORE render audit):
  - `e5b9907a75f53fccdec9a3f4c24163c98441d33c`, CE-1270: the body of a
    function literal is boxed a second time when a parameter went from a
    number reading to another one; source +259 −29.
  - `08ef3106ecbce52e702f1f06451ebf3bb330c926`, rule 7 (breaking): a copy
    into a local is not a use; an indexed parameter takes a list whole;
    source +171 −251.
  - `319f00e0f595994f267bc39d3df2d1d37eff6ab7`, CE-1280: a fold of `Power`
    and `Divide` reads only the declared facts of a variable
    (`staticFact()`); source +104 −19.
  - `df1a175d66b43913af343da5f27726b0477d9e0d`, CE-1303 (part 3): an Epsil
    `while` with an undecided condition ends with an error; source +84 −15.
  - `2e09c2d140eef80c8c26fdb04c2b6ae10c3e78a9`, the rollback frame, step 1:
    an overload trial opens no frame; source +158 −179.
  - `49785b4a1de9fa5a4d4f2d7e2bb1763c5df8525c`, CE-1210: four small fixes
    of the cost of a type read (0.952 of the time on the benchmark cases);
    source +39 −34. The issue holds what is left and three options for the
    board.
  - `a552c29cd098597f027bc777ce6603b7677bd11d`, leftover 2 removed (part 2,
    item 4, first step): a call head with no definition in a body is a free
    head; the forward-call reference mechanism is deleted; source +273 −404.
    Tycho's gates passed on a build that holds CE-1303 and step 1 too.
- CE-1317 is closed by the user's decision (documented; `issues/CLOSED.md`).
- `src/api.md` still lists `TypeProvenanceEntry.epoch` and is regenerated at
  release.

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

1. **CE-1270: done** (state above). Left open as CE-1317
   (`needs-decision`): a product of untyped names is ordered as a product
   of numbers, so `A·B − B·A` with no other matrix use gives zero, and
   `q·p` boxed before `p` and `q` are assigned matrices evaluates as `p·q`.
   Kept as it was: with a second parameter (`h(a, t) = a[1] + a[2] + t`),
   a list given to `t` is mapped on the assigned route and `Apply` binds
   every argument whole.
2. **CE-1280: done** (state above), in the narrow form: the arithmetic
   folds. The shape, kind and validation readings still read a held value;
   applied to every canonical read the rule changes 122 tests, 19 of them a
   value (`~/dev/compute-engine-recovery/ce1280/report.md`).
3. **The rollback frame** (about 900 lines, estimated). In this order:
   - NOT by its writers: the store for block locals and binder variables
     was measured and dropped (`~/dev/compute-engine-recovery/m3a-census/report.md`:
     a binder has no frame, and the Epsil static check keeps the rollback
     record of the direct-write branch).
   - By its USERS (user decision 2026-11-14; census and plan in
     `~/dev/compute-engine-recovery/rollback-users/report.md`). Step 1, the
     overload trial, is done (state above). Left, the Epsil static check
     (8,113 frames and 116,240 records in one suite; all but 344 records
     target a scope that the check pushes itself): step 2, the check copies
     into its own scope each outer definition that a statement redefines or
     narrows (169 records; about +100 to 200 lines); step 3, a copy-based
     rollback point for the provisional registry around the check (175
     records; about +30 to 50); step 4, the check runs with no frame; step
     5, delete the frame, its 25 hooks and their bookkeeping (about 650 to
     700 lines, estimated). Steps 2 and 3 add code before step 5 removes it:
     ask the user before building them.
   - the three sites of `library/core.ts`;
   - operator-signature inference moved out of host definitions;
   - then the provisional registry (below).

   The Epsil static check is the last user: confirm that its 48
   declaration entries all land in the scope that it pushes and pops
   itself.
4. **The provisional registry and forward-call references** (about 1,300
   lines, estimated). FIRST STEP DONE (state above): leftover 2 is
   removed and the forward-call references are deleted. The provisional
   registry (`provisional-application.ts`, 593 lines) stays and has more
   work than before: every free-head call is noted in it for the
   re-derivation of its function when the head gets a definition. It goes
   only with "stored function bodies as units".
   The earlier text: They wait for stored function bodies as units, and
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

- CE-1317 (P2, `needs-decision`): a product of untyped names is ordered as
  numbers (left by CE-1270).
- CE-1318 (P4): a compiled `Apply` of an index-reading literal to a list of
  points throws at run time. CE-1319 (P4): the type of a point plus a name.
- CE-1303 (P2): an Epsil `while` with an undecided condition never
  returns.
- CE-1210 (P2, `needs-design`): the `turing-patterns` run step is 8 to 9%
  slower than 0.187.1. Narrow the issue to that, or close it with the
  board.
- CE-1277 (P4): `Map` over a `Composition` reads the current scope (still
  `[100, 100]` after leftover 2: the step `f` has a definition at boxing).
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

- `tycho-desk` runs Tycho's gates and reports to `ce-desk` since
  2026-11-14: tell it the name of a new session. Give it a packed build of
  the BASE commit too, in `~/dev/compute-engine-recovery/` (a base arm built
  in another session's worktree was removed in the middle of a run).
- `compute-engine-00` lands the contributor pull requests.
