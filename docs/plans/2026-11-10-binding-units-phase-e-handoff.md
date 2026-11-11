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
   `Block(Declare(x, real, 7), a + 5)` reads the outer `x`. Implemented by
   package B, for a free name of a stored value while that value is
   evaluated, and written in rule 3.

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

   Package B (2026-11-10) recommends no, and wrote no code for it. The
   check is `isDeclaredForAssignment()` (`library/control-structures.ts`),
   called by the canonical handler of `Assign`.
   - No: `src/epsil/docs/declarations.md` already says that an assignment
     in a branch is not a first assignment only when the name was assigned
     by an earlier top-level statement or declared by the host. The test
     `block-scope-shadowing` "function form `Continue()` in an If branch
     inside a Loop stays valid" then declares `x` first; package D updates
     it. `y = x + 1; if y > 0 { x = 2 }; x` gives
     `first-assignment-in-branch`, where today it gives no diagnostic.
   - Yes: a read before the assignment makes the name count, so the
     diagnostic depends on the order of the statements, and the program
     above can read `x` with no value.

Decided by the user, 2026-11-10 (package A):

6. **A cache filled after the operation wrote an entry misses in the next
   operation.** The three tests of class DEF-MEMO-STORED
   (`test/compute-engine/comprehension-memo.test.ts`) stay as they are in
   the code: package D changes their expected counts (the stored chain
   runs once more in a later operation, with the same value). The rule
   that would make them hit is not adopted (spec, "Phase E, package A").
   To revisit with measurements from Tycho's adoption.

7. **The asynchronous memo of a lazy collection stores nothing when the
   evaluation read an entry of an environment.** The test of
   `test/compute-engine/lazy-collection-regimes.test.ts` (class DEF-STACK)
   stays as it is in the code: package D changes its expectation. To
   revisit with measurements from Tycho's adoption.
8. **Decision 5: a free name does not count as declared** for
   `first-assignment-in-branch` (the first option, which package B
   recommends). `y = x + 1; if y > 0 { x = 2 }; x` gives the diagnostic.
   Package D updates the test of `block-scope-shadowing`, which declares
   `x` first.
9. **Decision 4: none of (a) and (b).** The result of an outermost
   operation does not keep the environment of the operation. A host that
   compiles the result of a `subs()` over a symbol made before it calls
   `ce.infer([result])` or declares the symbol first. Option (c), `FindFit`
   and `FindRoot` as one operation, stays. This is a breaking change:
   package D adds it to `CHANGELOG.md` and to the documents of spec
   section 5, updates `evaluate-at-compile-derivative` ("an indefinite
   integral at a symbol"), and names it in the message to Tycho.

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

## 5a. Package C: result (2026-11-10, session compute-engine-18)

Commits `16ec6d0ef11280eb53dbc53d48f03afcc6303e70` and the follow-up that
adds this section. The rules that package C added are in the spec, marked
"package C" (rules 1, 2, 3, 7 and 9).

Fixed: DEF-FREE-CALL-TYPE (16), DEF-ENUM-FREENAME (2), DEF-FREE-HEAD-D (7),
DEF-LISTREC-SELFREF (4), DEF-TELESCOPE, DEF-RSOLVE-NOTCANON,
DEF-LIB-AUTODECL, the `lazy-view-scope` test, and 12 UNCLASSIFIED tests
(`ce-139` 2, `ce-623`, `derivative-closed-form-cache`, `fact-store-phase2`
"a value refuted through another symbol contradicts", `functions`,
`script-order`, `simplify-tycho-audit`, `tycho-row-426` 2, `map-fusion`,
`lazy-view-scope`).

Left, with the package that takes each:

| Tests | Package | Cause |
|---|---|---|
| DEF-MATRIX-REPAIR, 16 of 17 (`matrix-operator-typing` 8, `tycho-321` 7, `tycho-item-336` 1) | D | The repair works (`isValid` passes). Each test then reads `ce.box(name).type` or `ce.expr(name).type` (a new unit), `lookupDefinition(name).value._typeProvenance`, or expects inference events: read the occurrence in the result, or call `ce.infer()`. |
| DEF-RECURSION, 2 (`ce-604`, `recursive-lazy-callback`) | A | A re-entrant type computation of the same nodes (`wildcardRecursiveSignature`, `resultMayBeNothing`): the type cell that is in flight is not served, through `objectDepsValid` and `UnitReadToken._version`. The `type` getter nests 395 deep with the flag on and 9 with it off. Not fixed. |
| `compile-glsl-fragment` 3 ("an argument that is caller code …") | A | `canCompile()` types `v` only while it inlines the callee, and the fragment check reads the occurrence before that write (flag off: the definition was narrowed). Same family as DEF-TARGET-NO-OP. |
| `compile-references` 2 | A | DEF-ADMIT-OCC: `x` is read only through the assigned value `H`. |
| `evaluate-at-compile-derivative` 1 | user | Decision 4: `subs({x: ce.symbol('y')})` outside an operation. |
| `append-variadic` 2, `compile-block-locals-rules` 1 | B | DEF-DECLUNKNOWN-TYPE: a name declared `unknown` reads the requirement of its unit. |
| `call-identity-is-same-and-match` 1 | B | DEF-FREE-HOME-SCOPE: the `x` boxed in a pushed scope has another home scope. |
| `call-follows-function-reassignment` 2, `function-declaration-hoisting` 1, `generic-function-sugar` 1 | B | Epsil static check (the DEF-EPSIL-PIN family); check again after package B's commits. |
| `solve-domain` 1 | B or D | Not reproduced in a new engine (the file uses a shared engine); probably DEF-FREE-HOME-SCOPE. |
| `compile-integrate-starting-panels`, `compile-interval-sub`, `ellipsis-product-coefficient`, `latex-syntax/logic`, `juxtaposition-application`, 1 each | D | BC1: the same expression in a new engine gives the same result with the flag off. Declare the inputs, or use a new engine. |
| `undeclare` 1 | D | BC-LOOKUP: the test asserts that boxing `f(2)` declares `f`. |
| `compile-javascript-profile-undeclared` "an earlier use can make a Power form decline" | D | Added after the triage; it fails with the flag on before package C too. It is about an earlier use (BC1). |

Flag on, full suite, at `c976f546` plus the first package C commit (without
package A): 82,431 passed, 580 failed in 198 files. Three tests were not in
the triage: the `compile-javascript-profile-undeclared` test above;
`find-fit-pool` "a separable global fit on this thread stops within a row
of an abort" (a time limit: it passes alone); and
`placeholder-signature-refinement`, a regression of the first commit that
the follow-up fixes. The suite was not run again after the follow-up or
after package A.

## 5b. Package B: result (2026-11-10, session compute-engine-08)

Commits `795a322e79f2364263bcfd294fab780c7522b188`,
`c976f546435060f6e5ef8399a18058ce6f54762f` and the commit that adds this
section. The rules that package B added are in the spec, marked "phase E"
(rules 3, 7, 8, 10 and 13). New tests: `binding-units-host-values`,
`binding-units-identity` and `test/epsil/binding-units-static-declarations`.

Fixed: DEF-EPSIL-PIN, DEF-EPSIL-PARAM-NAMES, DEF-DESTRUCTURE-LET,
DEF-WITHVALUES, DEF-BINDER-SUBST-FREE, DEF-CAPTURE-FREE,
DEF-FREE-NAME-CAPTURE and DEF-BLOCK-LOCAL-CALL, all tests; of
DEF-FREE-HOME-SCOPE, `explain` (3) and `solve-root-checks` (1): `explain()`
is now an operation. Packages A and C fixed three of the four
DEF-FREE-BOUND-SAME tests.

Left, with the flag on:

- **`ce-614-integral-keeps-call-binding` (2), for the user.** An `x` boxed
  after a host `pushScope()` has that scope as its home (rule 1), so it is
  not the binding of an `x` boxed before it (rule 7), and `x + 100x` is not
  merged to `101x`. No value is wrong. Recommended: keep rule 7, class the
  two tests BC-RULE7, and package D updates them. The other option: two
  free names that resolve to no definition are the same binding when both
  home scopes are on the chain of the current scope; it changes the
  approved test "free calls of two home scopes are different calls" of
  `binding-units-core`.
- **`debug-bindings-scope-copies` (2) and `issue-489-curried-function-capture`
  "the inner parameter is renamed when the value mentions it" (1), not
  fixed.** The value of a call carries the body-scope definition of a free
  name of the literal (`markBodyFreeName()`), so with `g(a) := a x`, `g(2)`
  is not `isSame` to `2x`. Making that name a free name of the scope that
  the literal is written in (rule 1 as written) fixes the three tests and
  breaks the captured-type record (`ce-473`, 9 tests) and `ce-107` "the
  literal reads the value of a later global `f`": the record reads the
  body-scope definition. The other fix is a rebind of the value when it
  leaves the call (`makeLambda()`, `function-utils.ts`).
- **DEF-FIRST-ASSIGN-FREE (1):** decision 5, recommendation above.
- **`accessor-proven-length-type` "P: unknown (inferred) …" (1):** its
  `P[i]` lines pass; it fails on `ce.symbol('P').type`, which is BC1.

The flag-on suite at `5f5acea425bb8347bf401aa476b7fc23c0a94991` with the
third commit of package B, 2026-11-10: 484 tests fail. Outside the classes
of package D's start condition: DEF-MATRIX-REPAIR 16, UNCLASSIFIED 14,
NEW 6, DEF-FREE-HOME-SCOPE 4, DEF-MEMO-STORED 3, DEF-RECURSION 2, and one
each of DEF-STACK, DEF-DECLUNKNOWN-TYPE, DEF-OPTOKEN,
DEF-FIRST-ASSIGN-FREE, DEF-SYMBOL-LITERAL-INPUT and DEF-FREE-BOUND-SAME.
Of the six NEW tests, none comes from package B: a run of their five files
at that commit gives the same four failures with and without the third
commit (`ce-139-derivative-enclosing-binding`, `compile-admission`,
`compile-javascript-profile-undeclared`); `epsil/formatter` (1) was NEW at
`7e92c4b0f` already; the garbage-collection test of `ce-1102` is CE-1165
and passes alone.

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
