# Binding units, slice 1, phase E: handoff

Status: written 2026-11-10 by session compute-engine-1d, at commit
`7e92c4b0f2cea453d96bd177cee67f55c6dff335`. Delete this file when phase E is
committed.

Phase E turns the engine flag `ce._bindingUnits` on, removes it and the old
mechanism, and updates the tests. Before that, the defects that show with the
flag on are fixed, still behind the flag. This document splits that work in
three packages that run in parallel (A, B, C) and one that runs after them
(D).

## 1. Read first

- The spec: `docs/plans/2026-11-09-binding-units-slice-1-spec.md`. Section 1
  has the rules, section 5 the approved breaking changes, section 6 the
  acceptance items, section 10 the phases.
- The triage of the flag-on suite, with a cause, a remedy and a reproduction
  per class: `docs/plans/2026-11-09-binding-units-evidence/phaseE-triage.md`.
  Per-test data: `phaseE-triage.json` beside it (fields `file`, `test`,
  `cls`, `why`).
- The failures that remain after part 1, per class and per file:
  `docs/plans/2026-11-09-binding-units-evidence/phaseE-after-part-1.md`.

## 2. State

| Phase | Commit | Content |
|---|---|---|
| A | `7fa6178d79e2248af09fdd9b58f8bfa008d9734c` | free names, unit environments, rules 1 to 6 |
| B | `5a80abf74e2166f95ef91d167b5e391a929bb3fc` | rule 7 sites, free call heads |
| C | `30c5fe7f32e34ef24db0c4c8d3ce265ae76604f8` | operations, caches, program environment (rules 8 to 10) |
| D | `c766fc4927a2d25d92bd657715178ff9f446df60` | `ce.infer()`, trials, checkpoints deprecated (rules 11 to 13) |
| E part 1 | `7e92c4b0f2cea453d96bd177cee67f55c6dff335` | nested operations write in the enclosing environment; `UnitReadToken`; the `CE_BINDING_UNITS` switch |

Measured at `7e92c4b0f`, full suite, 2026-11-10:

- Flag off: 82,836 passed, 1 failed. The failure is CE-1165 (a
  garbage-collection test that fails under load and passes alone).
- Flag on: 82,164 passed, 673 failed in 225 files. No file hangs. The run
  takes about the time of the flag-off run.

The code is in `src/compute-engine/binding-unit.ts` (`UnitEnvironment`,
`UnitReadToken`, `noteResolutionRead()`), `engine-boxing-state.ts` (the
operation stack, trials), `engine-infer.ts`, `index.ts` (`_opensOperation()`,
`_withOperation()`, `_withProgramEnvironment()`, `_callBoundTo()`),
`boxed-expression/type-guards.ts` (`isFreeName()`, `freeBinding()`,
`readBinding()`, `resolvedValueDefinition()`, `isFreeCallHead()`),
`boxed-expression/compare.ts` (`sameBinding()`), and
`boxed-expression/binders.ts` (`freeNameBindingInContext()`). The tests are
`test/compute-engine/binding-units-{core,order,ops,commit}.test.ts`.

## 3. How to work

- **The flag.** `CE_BINDING_UNITS=1` in the environment makes
  `ce._bindingUnits` true by default. A test sets it per engine with
  `ce._bindingUnits = true`. Every fix of packages A to C stays behind the
  flag: with the variable unset, nothing changes.
- **One file with the flag on:**
  `CE_BINDING_UNITS=1 timeout -k 30 600 npx jest -w 2 -- <path>`
- **The whole suite with the flag on**, under the box lock, with a line per
  file:
  `CE_BINDING_UNITS=1 timeout -k 30 840 npx --no-install jest --reporters=default > <log> 2>&1`
- **The failures of a flag-on log, per triage class:**
  `node docs/plans/2026-11-09-binding-units-evidence/phaseE-remap.mjs <log> docs/plans/2026-11-09-binding-units-evidence/phaseE-triage.json <output.md>`
  A test that the triage does not know is in the class `NEW`: it is a
  regression of the work, to fix before the commit.
- **A package works in its own worktree** and commits its own batches. Each
  batch: the fix, a test with the flag set per engine in
  `binding-units-*.test.ts` or beside the affected code, the type check, the
  affected files with the flag off and on, the review that
  `docs/COMPUTE-ENGINE-BOX-SPECIFICS.md` requires, then the full suite with
  the flag off under the box lock before the commit.
- **Shared files.** The three packages can meet in `boxed-symbol.ts`,
  `boxed-function.ts` and `binding-unit.ts`. Keep each edit there small, and
  re-diff a file right before staging it.
- **A fix follows the spec.** When a fix needs a rule that the spec does not
  have, or changes one, take the option you recommend, write it in the spec
  with its date, and report it. The decisions of section 4 are examples.
- **Report** at the end: per class, the tests fixed and those left with
  their cause; the commits; the decisions taken; the count of the flag-on
  suite.

## 4. Decisions

Taken in this session (the user can reverse them):

1. **Nested operations.** An operation that starts inside another one runs
   in the environment of that one (spec, rule 8, "Nesting", changed
   2026-11-10).
2. **`loadLibrary()`** keeps its internal checkpoint until the release that
   removes the checkpoint API (spec, section 10, phase D).
3. **A free name does not resolve to a `Block` local**, as it does not
   resolve to a binder variable (rule 3). With `a := x + 1`,
   `Block(Declare(x, real, 7), a + 5)` reads the outer `x`. Not implemented:
   it is class DEF-FREE-NAME-CAPTURE of package B, which also writes it in
   rule 3.

Open, for the user:

4. **The result of an outermost operation.** An operation that is not nested
   in another one writes its requirements in its own environment, which is
   thrown away. A symbol that was made before the operation and that the
   result holds then reads `unknown`.
   ```
   const q = ce.symbol('q0');                 // made outside any operation
   const m = ce.parse('a \\cos(x)');
   const r = m.subs({ a: q });                // the operation
   compile(r)                                 // today: declines, `q0` has no type
   ```
   The same happens to a `subs()` in a statement of an Epsil program, and
   to `findFitAsync()` called directly (one test of `find-fit-pool` takes
   28 s with the flag on and 83 ms with it off). Options:
   - (a) an operation in a program statement writes in the environment of
     the program (this changes the last bullet of rule 10);
   - (b) a compound that an operation builds keeps the operation's
     environment, so its operands are read through it afterwards;
   - (c) only `FindFit` is changed: it wraps its fit in an operation.

   Package A applies (c), which is local and needed in every case. (a) or
   (b) waits for the user. The recommendation of this session is (b): it is
   the reading of rule 6 ("an expression built from boxed operands") for an
   expression that an operation built.
5. **`first-assignment-in-branch`** (class DEF-FIRST-ASSIGN-FREE, one test):
   does a free name count as declared for this Epsil check? Package B gives
   its recommendation with the test.

## 5. The packages

The counts are tests that fail with the flag on at `7e92c4b0f`. The test
files of each class are in `phaseE-after-part-1.md`.

### Package A: compilation, caches, calculus (about 75 tests)

| Class | Tests | Note |
|---|---|---|
| DEF-ADMIT-OCC | 19 | compile admission takes one occurrence per name and falls back to `ce.symbol(name)` |
| DEF-LIMIT-FREE-PARAM | 12 | a wrong value: `1/(a-a)` is taken as a definite value |
| DEF-NESTED-WRITES, rest | 10 | `compile-integrate-timeout-record` (6): the record of a timed-out search skips the only walk that wrote the requirement on the bound variable; `compile-integrate` "vars-mapped" (1); `cli-workers` (3): decision 4, option (c) |
| DEF-OPTOKEN, rest | 9 | none is the token: `variableStamps()` in `calculus.ts` (5, `tycho-row-424`); the operand-tower walk at each `ce.function()` (2); a spy that counts 2 calls of the public `evaluate()` (1); `ce-661` on a shared engine (1) |
| DEF-TARGET-NO-OP | 7 | a target's `compile()` called directly opens no operation |
| DEF-DYNAMIC-RESOLUTION | 4 | |
| DEF-ENVDEPS | 3 | check whether `UnitReadToken` left a cause |
| DEF-MEMO-STORED | 3 | |
| DEF-INTEGRATE-POLE | 2 | |
| DEF-STACK, rest | 1 | the async lazy-collection memo refuses to store when `objectReadCount()` moved |
| DEF-SYMBOL-LITERAL-INPUT | 1 | |

### Package B: Epsil, scopes and resolution (about 70 tests)

| Class | Tests | Note |
|---|---|---|
| DEF-EPSIL-PIN, DEF-EPSIL-PARAM-NAMES | 18 | the static pass relies on `ce.box(name)` declaring the name |
| DEF-FREE-HOME-SCOPE | 8 | a free name made in a pushed scope gets another home scope |
| DEF-WITHVALUES | 7 | `ce.withValues({zz: 7}, …)` throws for an undeclared name; this blocks the replacement of checkpoints |
| DEF-BINDER-SUBST-FREE | 7 | the phase B item of spec section 10 |
| DEF-CAPTURE-FREE | 7 | a wrong value: no `incompatible-type` |
| DEF-FREE-NAME-CAPTURE, DEF-BLOCK-LOCAL-CALL | 10 | decision 3 |
| DEF-FREE-BOUND-SAME | 4 | |
| DEF-DESTRUCTURE-LET | 2 | |
| DEF-DECLUNKNOWN-TYPE | 2 | |
| DEF-FIRST-ASSIGN-FREE | 1 | decision 5 |

### Package C: symbolic, library, and the unclassified tests (about 85 tests)

| Class | Tests | Note |
|---|---|---|
| UNCLASSIFIED, NEW | 33 | classify each one first; a test that belongs to A or B goes in the report, not in a fix |
| DEF-MATRIX-REPAIR | 17 | the fresh-matrix repair needs an inferred definition to retype |
| DEF-FREE-CALL-TYPE | 16 | a call with a free head types `unknown`; one case gives a wrong shape |
| DEF-FREE-HEAD-D | 7 | |
| DEF-LISTREC-SELFREF | 4 | |
| DEF-RECURSION | 2 | |
| DEF-ENUM-FREENAME | 2 | |
| DEF-LIB-AUTODECL, DEF-TELESCOPE, DEF-RSOLVE-NOTCANON | 3 | |

Also open from phase B, for package C: the test "a view made at the top
level reads the top-level `d`, wherever it is read"
(`test/compute-engine/lazy-view-scope.test.ts:198`) fails with the flag on.

### Package D: the switch (after A, B and C)

Starts when a flag-on run shows only the classes BC1 (359), OLD-MECH (43),
BC-LOOKUP (32), BC-LIBVAR (8), BC-HELD (4), BC-NARROWINGS (2), BC-RULE4 (1)
and BC-RULE7 (1).

1. Turn the flag on, then remove it, the `CE_BINDING_UNITS` switch, and the
   old mechanism: the declaration at boxing, the narrowing writes on
   definitions, the capture of narrowings.
2. Update the tests. The remedies per kind are in the triage, "BC1 remedies,
   by kind": read the occurrence's type, declare the inputs of a
   shared-engine file, or call `ce.infer()`. These edits are a recipe per
   file. Rewrite or delete the OLD-MECH tests.
3. `CHANGELOG.md` (the breaking changes of spec section 5, the deprecation
   of checkpoints, `ce.infer()`), the documents that section 5 names,
   `docs/CHECKPOINT-MODEL.md`, and the pages of
   `~/dev/cortexjs.io/docs/compute-engine/` that describe the changed
   behavior.
4. The timing of acceptance item 10, and the result paragraph of section 8
   of the model (`docs/plans/2026-11-09-binding-units-model.md`).
5. Tell Tycho (session `tycho-desk`) what changes for it, with the release.

## 6. Prompts

Package A:

> Read `docs/plans/2026-11-10-binding-units-phase-e-handoff.md`. You take
> package A. Work as its section 3 says, fix the classes of package A, and
> report as section 3 says.

Package B and package C: the same prompt with the letter changed.

Package D, after the three reports:

> Read `docs/plans/2026-11-10-binding-units-phase-e-handoff.md`. You take
> package D. First run the flag-on suite and check its start condition.

A session commits only when the user approves it in that session
(`~/.claude/CLAUDE.md`, "Git safety"): add that sentence to the prompt when
you want the session to commit its batches.
