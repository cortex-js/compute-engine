# What compiled code guarantees for an absent value

**Status:** DECIDED 2026-11-01 by the user: option (a) and R6 (§6). The
sub-decision on `undefined` as the only absent input spelling was not
answered; the documents adopt it as recommended, and the user can reverse
it. Steps 3 to 5 of §8 are in progress: the documents by session
compute-engine-14, the code by session compute-engine-da. Written by
session compute-engine-14 after the compiler
simplification plan (`docs/plans/2026-11-01-compiler-simplification.md`)
dropped its candidates 7, 8 (part 3) and 10. The corpus measurement of §5
was run by session compute-engine-da on 2026-11-01.

## 1. The problem

The caveats of compiled code (`docs/COMPILATION-MODEL.md`, "Caveats of
compiled code") allow `NaN`, `undefined`, a throw or a decline where the
interpreter gives `Missing`. They do not allow a different finite value for
a program whose inputs hold values of their declared types. An absent value
can be read by `IsMissing`, `Coalesce`, a comparison, a connective, a
branch or a default parameter, and those readers compute a finite value from
it. So the compiler must carry absence through every operator that can sit
between a producer of `Missing` and one of those readers: three-valued
comparisons and connectives, absent cells in broadcasts and point
arithmetic, a default filled by argument count, an interval `empty` with a
`missing` flag. The compiler simplification plan found that this code
cannot be deleted under the current contract: each attempt gave a wrong
finite value in a test that discharges absence AFTER computing on it.

Three witnesses, measured on 2026-11-01 (interpreter, then the `javascript`
target at HEAD):

| Program | Inputs | Interpreter | Compiled today |
| --- | --- | --- | --- |
| `If(IsMissing(w > 0), 1, 0)` | `w: real \| missing` holding `Missing` | `1` | `1`; `0` when candidate 7 is deleted |
| `Boole(IsMissing(Last(Which(v > 0, (1, 2)))))` | `v: list<real>` = `[1, -1]` | `1` | `1`; `0` when the unmatched cell is `NaN` |
| `Map((k: real \| missing = 2) ↦ Coalesce(k, 0), L)` | `L: list<real \| missing>` = `[Missing]` | `[0]` | `[0]`; `[2]` with a native default |

Each program computes on an absent value first (a comparison, a selection
cell read through `Last`, a defaulted parameter) and discharges it after.

## 2. The rule

An absent value (`Missing`, or the `NaN` and `undefined` that stand for it
in compiled code) is specified at three kinds of places only.

- **R1, producers.** A read past the end (`At`, `First`, `Last`, an index
  past a finite count), a cell of an element-wise `If`, `Which` or `When`
  that no clause selects, a scalar `If` or `Which` that takes no arm, an
  input or an element whose declared type has a `missing` arm and holds
  `Missing`. The producer gives the absence marker of its result type:
  `NaN` for a numeric type, the absent object (`Missing` in the
  interpreter, `undefined` in JavaScript, `None` in Python) otherwise. This
  is the current rule (`docs/ERROR-MODEL.md` §1, "`Missing` — the
  position-preserving absent datum") and does not change.
- **R2, structure that preserves positions.** `At`, `First`, `Last`,
  `Rest`, `Length`, `Reverse`, and the binding of a callback parameter by
  `Map` and its relatives move an absent cell without computing on it.
  `Length([1, Missing])` is 2 on every route; `Last([1, Missing])` is
  absent on every route.
- **R3, discharge.** `IsMissing`, `Coalesce` (`??`), `AssertPresent` (`?!`)
  and a default parameter read an absent operand and give a present value
  (or, for `?!`, the error) on every route. `IsMissing` is true for an
  absent operand whatever its spelling (`Missing`, `NaN`, `Indeterminate`,
  `Undefined`, the compiled `undefined` or `NaN`), as today.
- **R4, every other operator is unspecified on an absent operand, in
  compiled code.** Arithmetic, a point operation, a comparison, `Not`,
  `And`, `Or`, a branch condition, a reducer, a string operation, a user
  function body: when an operand is absent, the compiled value can be
  `NaN`, `false`, `undefined`, a throw or a decline, and everything computed
  from that value is unspecified too, `IsMissing` and `Coalesce` of it
  included. `IsMissing(w > 0)` is not specified; `IsMissing(w)` is.
- **R5, the interpreter does not change.** It keeps the absorption of
  `Missing` into `NaN` in numeric slots, the Kleene comparisons and
  connectives (`Less(Missing, 1)` is `Missing`), the absent-condition error
  of a branch, and the type `boolean | missing` of such a comparison. These
  are an offered propagation, useful in a notebook, and not a cross-route
  guarantee. The Epsil JSON parser in `src/epsil/docs/examples.md` relies
  on them and keeps working.
- **R6, a default fills an absent argument, supplied or left out.** This
  is the one interpreter change. Today a supplied `Missing` at a parameter
  typed `T | missing = d` stays `Missing` and only an argument left out
  takes `d` (`docs/plans/2026-10-31-parameter-default-values.md`). Under
  R6 the default is a discharge (R3): `k: real | missing = 2` holds 2 when
  the caller passes `Missing`. A caller that needs to pass an absent value
  through a defaulted parameter declares no default. This is what
  JavaScript and Python do natively, so the compiled default becomes the
  target's own.

The host's obligation, stated in the guides: a value whose type has a
`missing` arm is discharged before it is used in a computation. The Epsil
static check already reports a possibly absent value at a parameter or a
declaration that excludes absence (`src/epsil/presence-narrowing.ts`).
Extending it to report any undischarged use of a `| missing` value at a
non-discharge operator is a separate, optional task; it would make R4 a
diagnosed situation instead of a silent one.

## 3. Examples

Measured on 2026-11-01 at HEAD (`6c4f10e03` plus the uncommitted working
tree), `javascript` target. "Under the rule" is what the compiled code may
give after the deletions of §4; the natural JavaScript value is shown.

| Program | Inputs | Interpreter | Compiled today | Under the rule | Specified? |
| --- | --- | --- | --- | --- | --- |
| `1 + At(L, 1000)` | `L: list<real>` | `NaN` | `NaN` | `NaN` | R4; agrees anyway |
| `At(P, 1000) + (1, 1)` | `P: list<tuple<real, real>>` | `Missing` | `undefined` | `undefined`, or a throw | R4 |
| `w > 0` | `w: real \| missing` = `Missing` | `Missing` | `undefined` | `false` | R4 |
| `If(w > 0, 1, 0)` | same | absent-condition error | `NaN` | `0` | R4 |
| `If(IsMissing(w > 0), 1, 0)` | same | `1` | `1` | `0` | R4: no |
| `If(IsMissing(w), 1, 0)` | same | `1` | `1` | `1` | R3: yes |
| `Coalesce(w, 7) + 1` | same | `8` | `8` | `8` | R3: yes |
| `Coalesce(At(P, 5), (0, 0))` | `P` as above | `(0, 0)` | `[0, 0]` | `[0, 0]` | R1, R3: yes |
| `Q + (1, 1)` | `Q: tuple<real, real> \| missing` = `Missing` | `Missing` | `undefined` | `undefined`, or a throw | R4 |
| `IsMissing(Q + (1, 1))` | same | `True` | `true` | unspecified | R4: no |
| `Which(v > 0, (1, 2))` | `v: list<real>` = `[1, -1]` | `[(1, 2), Missing]` | `[[1, 2], undefined]` | same | R1: yes |
| `Boole(IsMissing(Last(Which(v > 0, (1, 2)))))` | same | `1` | `1` | `1` | R1, R2, R3: yes |
| `Not(w > 0)` | `w` as above | `Missing` | `undefined` | `true` | R4 |

The first row shows where no bending exists today: a numeric hole is
`NaN` on both routes and IEEE arithmetic carries it. The cost is in the
non-numeric holes (rows 2, 9) and in the three-valued logic (rows 3 to 5,
13).

**Note, 2026-11-04:** the three-valued compiled conditions of the column
"Compiled today" were retired by step 4, row 2 of
`docs/plans/2026-11-02-compiler-contraction-plan.md`. Replaced by: a
compiled comparison is a boolean, and a compiled branch reads an absent
condition (`undefined`, `null`, `NaN`) as `false`.

## 4. What the rule removes and what it keeps

Line counts are the estimates of the compiler simplification plan. §5
measured candidates 7 and 8 together: 1,031 lines removed, 99 added, 107
tests to rewrite or delete in 17 files.

| Code | Under the rule | Lines | Tests |
| --- | --- | ---: | ---: |
| Candidate 7: `absentComparisonGuard`, `compileAbsentRelation`, `guardConnectiveAbsence`, the interval `missing` flag | delete (R4) | 350–450 | 60–80 |
| Candidate 8, remaining parts: `absentBesideScalars`, `absentAsNaN`, `bcastAbsent`, `absentArgumentAsNaN`, point arithmetic over an absent cell, the GPU and Python equivalents | delete (R4) | ~270 | ~30 |
| Candidate 10: `DefaultFill.byCount`, `defaultFillingWrapper` | delete (R6) | ~80 | ~3 |
| Python `None` guards around arithmetic | delete (R4) | not counted | |
| Producers (R1), structural accessors (R2), `IsMissing`, `Coalesce`, `AssertPresent` (R3) | keep | | |
| The static-shape declines and the CE-712 steps | unchanged | | |

One addition stays necessary: a single run-time absence predicate for every
discharge on the JavaScript and Python targets. Today the numeric reader
(`Number.isNaN(x ?? NaN)`) accepts `NaN`, `undefined` and `null`, and the
object reader (`x === undefined`) accepts `undefined` only. The second
witness of §1 is a producer and a reader that chose different spellings.
R3 keeps `IsMissing` and `Coalesce` specified, so their readers must accept
every spelling a producer can emit. This is a small change in
`absenceAxisForType` and the two `absence` tables of the targets; it is not
a deletion.

**Note, 2026-11-04:** the condition analysis that remained after candidates
7 and 8 (the decidedness of a condition, the three-valued combination of
conditions, the `NaN` marker of a compiled collection `Equal`, the
per-operator absent tests, `CompileTarget.absence.object.isNull` and
`CompileTarget.collectionEqualityOperand`) was retired by step 4, row 2 of
`docs/plans/2026-11-02-compiler-contraction-plan.md`. Replaced by: the
producers, the accessors and the three discharges only; the guard of an
absent collection at an accessor reads `absence.object.isAbsent`.

What the rule does not remove: the decline of a `Missing` or `Nothing` in a
value position on a target that has no object absence (GPU, interval), the
run-time absence of an input left out (CE-712.3, already unspecified), and
the interpreter's Kleene code in `library/relational-operator.ts`,
`library/logic.ts` and `library/control-structures.ts` (R5).

## 5. The risk, and its measurement

Tycho produces holes on purpose. A restriction that folds to false
(`P=(1,2)\{\pi<0\}`) gives `Missing`; `P[[-1,1]]` gives a list with a hole;
`isUndefinedPointMember` in `~/dev/tycho/src/plot-core/classification-collection-evidence.ts`
treats `Missing` as a hole in a point list and draws the defined points, as
Desmos does. If a corpus expression computes on such a hole without a
discharge, compiled code under R4 gives a throw or `false` where it gives a
hole today.

Session compute-engine-da measured this on 2026-11-01: candidates 7 and 8
removed in a worktree detached at `8ad234805`, the corpus compared against
the same commit (757 Tycho documents, Tycho at `2ea9786f3`, 77,146 values,
17,517 distinct compiles over `javascript`, `glsl` and `interval-js`).
The diff is not delivered; the scan is `CE_ABSENT_SCAN=1` of
`~/.claude/tools/ce-census/value-shim.mjs`.

| Measure | Result |
| --- | ---: |
| Source lines removed / added, 23 files | 1,031 / 99 (net −932) |
| Type check and lint | clean |
| Tests that fail (full suite not run) | 107 in 17 files |
| Failing tests that involve `IsMissing` or `Coalesce` | 0 |
| Corpus: changed values | 0 |
| Corpus: new declines | 0 |
| Corpus: new throws | 0 |
| Corpus: a throw that became `NaN` | 51 values in 7 expressions |
| Corpus compiles with a non-discharge operator over a `\| missing` operand | 195 of 17,517 |

The 7 expressions are all `W(C_{ube}(u, v), …)`: the base throws "the
argument of the parameter is absent", the worktree gives `[NaN, NaN, NaN]`;
both are allowed by R4. The 195 compiles are, by operator, `Multiply` 212,
`Equal` 96, `PointY` 84, `Add` 65, `Comprehension` 29, `PointX` 23, and a
few each of `W`, `Sum`, `Integrate`, `ListJoin`, `PointList`, `Divide`,
`Negate`, `Abs`, `PointZ`. Most are a list indexed at run time
(`L[6u+1]`, typed `missing | tuple<…>`) then read by `PointX`, `Add` or
`Multiply`. Their values did not change, because the index stays in range in
the corpus documents. The count is the same before and after.

Three failing tests show what R4 allows and what it should name:

- `Less(Missing, t)` is `false` instead of `undefined`, and a branch on it
  takes an arm. R4.
- `Scan(L, Multiply)` with `L: list<number | missing>` passed as
  `[2, null, 3]` gives `[2, 0, 0]` instead of `[2, NaN, NaN]`: JavaScript
  reads `null` as `0`. R4 allows it, but a silent finite value is the worst
  outcome, so §6 asks for one more decision: the only absent object a host
  passes is `undefined`, and `null` is a value outside the declared type.
  An input of `undefined` gives `NaN` through every arithmetic operator for
  free.
- Python `Add(p, 1)` with `p` absent emits `p + 1`, a `TypeError` for
  `None`. R4.

Removing the Python `readInput` hook deletes a field of the public type
`CompileTarget.absence.numeric`, so `src/api.md` changes; a user target that
sets it would break.

The remedy inside the rule, a decline at a non-discharge operator over a
`| missing` operand, would cost the 195 compiles their compiled speed
(documents not counted). The corpus shows no value that this decline would
protect.

## 6. The decision

**Option (a), recommended: adopt R1 to R6, with natural emission.** The
compiler emits the target's own code for an operator over a possibly absent
operand and nothing more. Candidates 7, 8 and 10 are deleted (§5 measured
−932 lines for 7 and 8 alone, with 0 changed corpus values); the universal
reader predicate is added. A host that computes on a hole without a
discharge gets the target's value, which can be a throw. Saying no to (a)
means the code of §4 stays and the compiler simplification plan ends where
it is.

**Option (b): adopt R1 to R6, with a decline at a non-discharge operator.**
As (a), but an expression with a `| missing` operand at an operator outside
R2 and R3 declines to the interpreter. Fewer lines are removed than in (a)
(the decline needs a check at each operator, which the static type gives
cheaply), and no host program can throw where it gave a hole. §5 found 195
corpus compiles that this decline would send to the interpreter, and no
value that it would protect, so (b) is not recommended.

**Sub-decision, under (a) or (b): `undefined` is the only absent object a
host passes to compiled JavaScript.** A `null` input is a value outside the
declared type. Without this, `[2, null, 3]` at `Scan(L, Multiply)` gives
`[2, 0, 0]` and the contract calls it unspecified; with it, the host that
passes `undefined` gets `[2, NaN, NaN]` for free. The alternative is a
normalization of `null` to `undefined` at every input read, which is code of
the kind this plan removes.

**Option (c): no change.** The contract stays, candidates 7, 8 (part 3) and
10 stay dropped, and the universal reader predicate is still worth adding
on its own, because it closes the class of holes of the second witness.

If nothing is decided, (c) is in force.

Under (a) or (b), R6 is a separate yes or no: without it candidate 10 stays
and a supplied `Missing` at a defaulted parameter keeps its current
behavior.

## 7. Documents that change under (a) or (b)

- `docs/COMPILATION-MODEL.md`, "Caveats of compiled code": the allowed
  difference "a value where the interpreter gives no number" becomes R4,
  stated with R1 to R3 as the specified places. The known-limitations lines
  that record an absence case are removed or re-classified.
- `docs/ERROR-MODEL.md`: §6 ("Interpreter vs. compiled code") says a target
  "never emits plausible but different code"; it is amended to name R4 as
  the exception, beside the exceptions it already names. The paragraphs of
  §3 and of "An undefined operand makes a comparison false" that describe
  what compiled code does with a `missing`-typed operand are rewritten to
  R4. The `Missing` paragraph of §1 and the Kleene rules of the interpreter
  stay (R5). The parameter-default rule gets R6.
- `AGENTS.md`, "Working rules", the paragraph on what compiled code gives:
  one sentence for R4.
- `docs/plans/2026-10-31-parameter-default-values.md`: R6.
- cortexjs.io, `docs/compute-engine/08-guide-types.md` (the paragraph "A
  possibly absent value at a contract that excludes absence", which
  promises `Sin(Missing)` is `NaN` and `Reverse(Missing)` is `Missing`: it
  becomes an interpreter behavior with the compiled caveat), and
  `07-guide-latex-syntax.md` (the `if` without `else` and the `where`
  restriction paragraphs: one sentence that compiled code may not carry the
  marker through further computation).
- `src/epsil/docs/control-flow.md`, `errors.md`, `types.md`: one paragraph
  on the host's obligation to discharge, and the default rule R6 in
  `errors.md` (its line "Nothing and Missing are refused" for a default).
- `ROADMAP.md`: CE-749 (a `Map` callback over an absent element) is
  resolved by R2 and R4: the callback binds the hole, and its body is
  unspecified on it in compiled code. CE-218 (`Nothing` versus `Missing` in
  compiled absence checks) is unchanged.

## 8. Order of work

1. §5 measurement (in progress, compute-engine-da).
2. The user chooses in §6.
3. The documents of §7, in one change, before any code.
4. The universal reader predicate (one implementer, with the second witness
   of §1 as its test). Readers only: the producers keep R1 (`undefined` for
   an object cell). A review of this step measured the alternative, `NaN`
   for every unmatched cell, and found wrong values
   (`PointY(Which(v < 0, (1, 2)))` gave `[1, 2]`) and a throw
   (`Distance(Which(v < 0, (3, 4)), (0, 0))`), so candidate 8 part 3 stays
   dropped. One producer change rides with this step: the unmatched cell of
   an element-wise `When` with a complex value is a plain `NaN`, not
   `{ re: NaN, im: NaN }`, which `IsMissing` read as present.
5. Candidate 7, then the rest of candidate 8, then candidate 10 with R6,
   each as one implementer item with two review rounds, each measured on
   the corpus before staging, by the rules of the compiler simplification
   plan.

**Note, 2026-11-04:** the absence code that step 5 left in the compiler was
retired by step 4, row 2 of
`docs/plans/2026-11-02-compiler-contraction-plan.md`. Replaced by: the rule
R1 to R4 with no lowering for an absent operand outside the producers, the
accessors and the discharges.
