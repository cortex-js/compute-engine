# Simplify the compiler against the caveats of compiled code

**Status:** plan, 2026-11-01. No code is changed. The user chooses the
candidates in §2.

## 1. Survey

From 2026-10-17 to `1a0d0d427`, 201 commits changed
`src/compute-engine/compilation`. The per-commit table is in
`docs/plans/2026-11-01-compiler-simplification/commits.md`. Two of these
commits split `base-compiler.ts` and `gpu-target.ts` into topic modules and
move code only.

A commit is a candidate when its code handles only a case that the
"Caveats of compiled code" in `docs/COMPILATION-MODEL.md` allow:

- an input left out;
- a `Missing`, `Nothing`, `Indeterminate` or error result that the compiled
  code matches exactly;
- a value outside its declared type;
- an error that the static type does not show;
- a fix whose only witness is `crafted`.

Code that handles a wrong finite value or shape for a plain program stays,
and so does every decline. 34 of the 201 commits have a candidate
part. The rest are `value`, `decline` or `other`. Line and test counts below
are estimates by the survey agents, not measurements. Each implementer
measures them first.

## 2. Candidates

Three removal types:

- **Delete.** The code goes. The case then gives `NaN`, `false`, `undefined`
  or a throw, which the caveats allow.
- **Decline.** Without the handler the case gives a wrong finite value, but
  its witness is `crafted`. The handler is replaced with a decline.
- **CE-712.** The removal is part of a step of the static-shape plan
  (`docs/plans/2026-10-31-static-shape-compilation.md` §6) that is not done
  yet. It is done as that step, by this plan's rules.

| # | Mechanism (main commits) | Type | Removal leaves | Src lines | Tests |
| --- | --- | --- | --- | ---: | ---: |
| 1 | Unsupplied input in a comparison, `Not`/`And`/`Or`, `If`, `When`, a chain: `compile-absence.ts` guards, the GPU and Python written-absence code (`c240193f0`, `97ef4064d`, `f169546e9`, `33651c6b1`, `75d84fbfd`) | CE-712.3 | the else branch, `false` or `NaN` | 1,500–2,500 | ~250 |
| 2 | Absent collection input or operand, entry checks: `entryNoValue`, `checkEntry`, `requiredInputAbsent`, `pythonNoValueGuard` (`33651c6b1`, `797aa8b3f`, `46a00171a`, `d4e28ec11`) | CE-712.3 | a throw, `NaN`, `entire` on interval-js | 1,000–1,500 | ~100 |
| 3 | Absent input read as `NaN`: `readAbsentInput`, the Python `readInput`, `absentBaseReadIsNumeric` (`cd704b6b8`, `7b6b73f5a`, `0baeb44b6`) | CE-712.3 | `undefined`, a Python `TypeError` | ~110 | ~45 |
| 4 | Absent argument to a point function or a list callback: `absentArgumentChecks`, `absentArgumentFork`, `absentGuardedValueRef` (`f13b6f46f`, `450e1ad49`) | CE-712.3 | `NaN`, a throw, or the existing decline for `P \| missing` | ~300 | ~40 |
| 5 | Run-time checks of arguments against parameter annotations: `declaredParameterCheck`, `localParameterChecks`, `jsCollectionShapeGuard`, the CE-473 captured-type check, the mixed-depth point check (`1efbbe884`, `fd47fdca4`, `d963d1b4f`, `7972b850c`) | CE-712.4 | a value where the interpreter gives `incompatible-type` | ~650 | ~80 |
| 6 | Run-time list-or-scalar test for `any`/`value` symbols, `declaredTopGuard` (`cd704b6b8`, `ba174fb6c`) | decline | a decline (`any` inputs are already refused by CE-712.1) | ~220 | ~30 |
| 7 | Three-valued comparison with a `number \| missing` operand that holds `Missing`: `absentComparisonGuard`, `compileAbsentRelation`, `guardConnectiveAbsence`; the interval `missing` flag (`5f605ec53`, `27e093bcf`, `cc72330ea`, `c240193f0`) | delete | `false` or `NaN` | 350–450 | 60–80 |
| 8 | Absent elements in broadcast and lists: `bcastScalarAbsent`, `absentBesideScalars`, `absentAsNaN`, `absenceKind` for `Which` cells, the absent base of a GPU `At`, `At` with a `NaN` index (`a3fcd993d`, `93d3c376d`, `8c76cb6b8`, `dd2813809`, `afbcdfc3e`, `e8934c2c3`) | delete | `NaN`, `null` or `undefined` | ~350 | ~35 |
| 9 | Block local read on a path with no assignment: the run-time check `read-before-declaration` and the Python `_ce_unset` (`1efbbe884`, `17ba3b407`, `3431204f2`) | decline | a decline on every target, as GLSL and WGSL do today. Without the check, JavaScript gives 6 where the interpreter gives 0 | 400–700 | ~60 |
| 10 | Default parameter filled by argument count, so that a supplied `Missing` stays: `DefaultFill.byCount`, `defaultFillingWrapper` (`4d6479dee`) | delete | the default for a supplied `Missing` | ~80 | ~3 |
| 11 | `Sum`/`Product` body that writes its own index: a separate counter (`e3cea713d`) | decline | a decline | ~120 net | ~15 |
| 12 | Destructuring `Declare` with a repeated name: `keepLastOccurrence` (`c67baf167`) | decline | a decline (deletion alone emits `let a; let a`, a syntax error) | ~28 net | ~8 |
| 13 | `NaN` as a count (`Take(xs, NaN)`): `countMayBeNaN`, `jsClauseParamGuard` (`f169546e9`) | delete | `[]` or a Python `ValueError` | 60–100 | ~35 |

No candidate has a `corpus` witness of its own. Tycho rows 411 and 413 give a
`corpus` witness to the `NaN`-operand rule of conditions next to item 1. That
rule stays.

**Not candidates (a decision of the user, not part of this plan).**

- Code that the caller supplies in `vars` (`'nextValue()'`) is treated as an
  effect: it is not run twice, skipped or reordered (`reachesCallerCode`,
  `00e6b2c56`, `afbcdfc3e`, about 600 lines). The caveats do not allow a
  difference in effects, so removal needs a new caveat ("a `vars` entry is
  read as a value") first.
- The decline for a redefinition that breaks an effects contract (about 140
  lines), the arity decline and the decline for a read proved to find no
  row. These are declines, and they stay.

## 3. The measure

The base is the whole-corpus Tycho codegen audit (757 documents) of a
production build of `2dd7fb55c`, run twice before the first candidate. Both
runs gave the same declines and the same values. Tycho is frozen for all the
runs: a `git archive` of Tycho `2ea9786f3`, with links to its
`node_modules` and `_TASK`, so that the uncommitted work of other sessions in
Tycho does not change the result.

For each candidate, in its worktree, after its dual review, under the box
lock:

1. `~/.claude/tools/ce-census/value-audit.sh <worktree> <label>` makes a
   production build of the worktree and runs Tycho's
   `scripts/audit-ce-codegen.mts --all`. Its header gives the setup.
2. **Declines.** `~/.claude/tools/ce-census/compare.mjs` lists the new
   declines per target. One new decline on a row reverts the candidate.
3. **Values.** The audit keeps the code text, not values, so the run loads
   the Compute Engine through `value-shim.mjs`. For each `javascript` and
   `interval-js` compile, the shim records the values of the first 6 calls
   that Tycho makes, and for `javascript` the values at 8 inputs of the
   declared types of the free symbols. `compare-values.mjs` compares two runs
   with a relative tolerance of 1e-12. One different value reverts the
   candidate. A `glsl` record is compared by its code text only.

| Base, whole corpus | Count |
| --- | ---: |
| JavaScript / GLSL / interval records that decline | 47 / 48 / 80 |
| Compiled expressions with recorded values | 13,750 |
| Values compared | 77,121 |

## 4. Order of work

One candidate for each `implementer` agent, in its own worktree, with the
dual review and the measure of §3 before the diff is applied to the main
tree. The agent deletes the tests that pin the removed behavior and keeps the
tests that pin the interpreter's value for declared inputs. It reports the
source and test lines removed.

The recommended order puts the small removals first:

1. 12, 11, 9 (handler to decline)
2. 13, 10, 8, 7 (delete)
3. 6
4. 1 to 4 as CE-712.3
5. 5 as CE-712.4

## 5. Progress

| # | Source lines | New declines on the corpus | Changed values | State |
| --- | ---: | ---: | ---: | --- |
| 12 | −21 | 0 | 0 | applied, 2026-11-01 |
| 11 | −199 | 0 | 0 | applied, 2026-11-01 |
| 9 | −514 | 0 | 0 | applied, 2026-11-01 |
| 10 | — | — | — | dropped, 2026-11-01: see below |
| 13 | −37 | 0 | 0 | applied, 2026-11-01 |
| 7 | — | — | — | dropped, 2026-11-01: see below |
| 8 | −81 | 0 | 0 | applied, 2026-11-01: only `bcastScalarAbsent` and the GPU positional read of an absent operand (now a decline); the rest gave wrong values in review and stays |
| 6 | −118 | 0 | 0 | applied, 2026-11-01: a decline in place of the run-time list-or-scalar test |

The line counts per candidate are those of each worktree diff. The three
together, with the comment fixes of the reviews, remove 731 source lines net
(143 added, 874 removed) and 576 test lines net. They were measured again
together on the corpus: 0 new declines, 0 changed values.

**Candidate 10 is dropped.** The fill by argument count is not only for a
`Missing` result. With `L: list<real | missing>` holding `[Missing]`,
`Map((k: real | missing = 2) => Coalesce(k, 0), L)` gives `[0]` in the
interpreter. A native JavaScript default would give `[2]`: a wrong finite
value for an input of its declared type (found by the Codex review). A
decline in its place would catch every untyped parameter with a default,
because the type `unknown` admits `missing`, so the code stays.

**Candidate 7 is dropped.** The three-valued result of a comparison with an
absent operand is read by `IsMissing`, `Coalesce`, the connectives and every
branch. With `w: real | missing` holding `Missing`,
`If(IsMissing(w > 0), 1, 0)` gives 1 in the interpreter and would give 0;
with `L: list<real | missing>` holding `[Missing]`, `Not(Equal(L, 1))` would
give `[true]`, so an element-wise `If` takes an arm where the interpreter
takes none; on `interval-js`, a branch over a comparison with an absent value
would take an arm (found by both reviews). These are wrong finite values for
inputs that hold values of their declared types.

**What candidates 7, 8 and 10 show.** Code that keeps a `Missing` that a
declared `T | missing` type admits is usually read later by a consumer that
discharges absence (`IsMissing`, `Coalesce`, a branch, a default), and its
removal gives a wrong finite value. A removal is safe for an input that the
caller leaves out, which is unspecified, and for a value outside its declared
type. Candidates 1 to 4 and 6 must be split along this line before they
start: the part for an input left out goes, the part for a declared
`| missing` value stays.

**Candidate 8, part 3 is dropped (2026-11-01).** The user accepted `NaN` in
place of `undefined` for an unmatched point or string cell of an element-wise
`Which`, `If` or `When` over a list (`Which(v > 0, (1, 2))` with
`v = [1, -1]`), which reverses the decision of 2026-10-18. The implementation
showed that readers of the cell test only `undefined`:
`Boole(IsMissing(Last(Which(v > 0, (1, 2)))))` would give 0 (interpreter and
HEAD: 1), and `Coalesce(First(Rest(Which(v > 0, (1, 2)))), (9, 9))` would give
`NaN` (interpreter: `(9, 9)`). Making every such reader accept `NaN` would add
code in an unknown number of places, so the absence value chosen by the cell
type stays, and the decision of 2026-10-18 stays in force.

**The shared absence test (2026-11-01).** After the user adopted option (a)
of `docs/plans/2026-11-01-absent-value-contract.md`, every discharge
(`IsMissing`, `Coalesce`, `AssertPresent`) reads every spelling of an absent
value: `NaN`, `undefined` and `null` on JavaScript, `None` and a float or
complex `NaN` on Python. This is an addition, not a removal (source +124
−41). An unmatched point or string cell of an element-wise selection stays
`undefined`, as R1 of that plan requires: with `NaN` cells,
`PointY(Which(v < 0, (1, 2)))` at `v = [1, -1]` gave `[1, 2]` (interpreter
`[Missing, 2]`) and `Distance(Which(v < 0, (3, 4)), (0, 0))` threw. The
complex cell of `When` became a plain `NaN`, which the test reads as absent.
Corpus: 0 new declines, 0 changed values.
