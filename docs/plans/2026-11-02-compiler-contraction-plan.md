# Contract the compiler by narrowing the language: the implementation plan

**Status:** plan, 2026-11-02. Steps 1, 2 and 5 are done (2026-11-02): step
1 in commits b6a81482a (CE-712.3), bd6631f86 (CE-712.4) and 737951b8b
(CE-712.5), step 5 in 97c3d409a, step 2 in the options document; the
compiler went from 95,413 to 92,667 code lines. Step 3, the language
release, can start; step 4 follows it. Inputs:
`docs/plans/2026-11-01-language-axes-survey.md` (the axes, §6.3 the selection
constraints, §5a the guards), its `census.md` (what Tycho uses),
`docs/plans/2026-11-02-restriction-binding.md` (the parser rule),
`docs/plans/2026-11-01-compiler-simplification.md` §3 (the corpus measure).

## 0. The rules every step follows

- **A crafted case is never a question.** It declines or stays unspecified
  (AGENTS.md). A reviewer's crafted finding is answered with the decline that
  is already there, not with a handler. The review brief of every step says
  so in its first paragraph.
- **The measure is the Tycho corpus**, as in the simplification plan §3:
  `~/.claude/tools/ce-census/value-audit.sh` on a production build of the
  step's worktree, then `compare.mjs` (declines) and `compare-values.mjs`
  (values) against the base run. A step that changes semantics on purpose
  lists its expected value changes before it runs the measure (for example
  every point cell that was `undefined` and becomes a `NaN` point), and the
  report shows that the measured changes are exactly those. A step that only
  removes code expects zero new declines and zero changed values.
- **Size is reported, not estimated.** Each step reports the code lines of
  `src/compute-engine/compilation` before and after (the count used in the
  survey: `.ts` files, lines that are not blank, `//` or `*`), and the test
  files deleted.
- **One step, one implementer, one worktree**, with the stop rule and the git
  clause of `~/.claude/CLAUDE.md`. The orchestrator stages.
- **Documents move with the code.** Each step edits the model documents it
  changes (`docs/COMPILATION-MODEL.md`, `docs/BROADCAST-MODEL.md`,
  `docs/ERROR-MODEL.md`, `docs/COLLECTIONS-MODEL.md`), the CHANGELOG, and
  the user-facing pages in `~/dev/cortexjs.io/docs/compute-engine/`.

## 1. Apply the rule already decided: the host validates its inputs (done 2026-11-02)

Items CE-712.3 and CE-712.4 of `ROADMAP.md`. No decision, no Tycho change.
Nothing blocks it: Tycho has `hasUnresolvedInput` at its sites (Tycho commit
2a598f4db).

Removes (the survey's §5a table): `entryNoValue` and `checkEntry` in
`javascript-runtime.ts`; `requiredInputAbsent` in `broadcast.ts`;
`pythonNoValueGuard`; `absentArgumentChecks` in `compile-user-calls.ts`;
`absentArgumentFork`, `absentGuardedValueRef` and `jsCollectionShapeGuard`
in `compile-callbacks.ts`; `declaredParameterCheck` and
`localParameterChecks` in `compile-user-functions.ts`;
`absentBaseReadIsNumeric`; `unsuppliedComparisonGuard`,
`collectionReadInputs` and `withTruthOnly` in `compile-absence.ts`; the
run-time point test in `compile-broadcast.ts` (about line 1444); the CE-662,
CE-673, CE-681 run-time classes, reduced to declines. Keeps: the `RangeError`
of `Mod`/`Remainder`/`GCD`/`LCM` beyond ±(2^53 − 1), the complete
`freeSymbols` list, the `unbound` decline (Tycho depends on them).

Two implementers, CE-712.3 then CE-712.4, each with the corpus measure
(expected: zero new declines, zero changed values). Then CE-712.5, the
documents.

## 2. Decide the remaining axes (done 2026-11-02)

One page per axis, each with the options, one example per option, Tycho's
use from the census, and the compiler code each option removes. The pages
are `docs/plans/2026-11-02-language-axes-options.md`; its §8 is the
decision table, and every row of it is filled in: `Missing` A, the error
model A (`Indeterminate` folded into `NaN`, its spellings kept as input),
comparisons A (two-valued), block locals A′ with the two language rules,
function values B with the defaults simplified (the "or absent" half of R6
reversed), the complex lane A in its strict form (`strict` the only
discipline, `auto` removed; bigint opt-in with no escalation), WGSL, Python
and value kinds kept, no separate packages before the contraction. The
table below is the record as it stood before the decisions; the decision
column of §8 in the options document is the authority where they differ.

| Axis                           | Census (real documents / Desmos states)                                     | Recommended option                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Missing`                      | `Missing`, `IsMissing`, `Coalesce`: 0 / 0; a `missing` input type: 2 / 6   | A result only (a selection with no match, an accessor out of range, an input left out); no `\| missing` input types; read only by `IsMissing`, `Coalesce` and a branch; every other operator gives an unspecified non-value |
| Error model                    | `Nothing`, `Indeterminate`: 0 / 0; a node typed `nothing`: 0 / 4            | One static error (declines; an error expression in the interpreter) and one dynamic non-value (`NaN` for a number, `Missing` otherwise); `Nothing` kept only as the value of an empty block |
| Comparisons                    | a `missing` operand: 1 document                                             | Two-valued in compiled code; every undecided operand (`NaN`, absent, a pole) gives `false` |
| Block locals                   | assignment in a branch, read before assignment, loops: 0 / 0                | Decided 2026-11-02, A′ with the two language rules: a declaration has a value and an assignment is a statement, in Epsil and in compiled code; reassignment anywhere after that; a loop has no value; no write to an engine symbol; a `vars` entry is a value |
| Function values                | `Map`/`Filter` callbacks: 15 / 19; currying, partial application, defaults: 0 | Fully applied calls and `Map`/`Filter`/`Sort` callbacks with a literal lambda; currying, partial application, defaults and a function value in a variable decline |
| Complex lane                   | complex arguments to a document function: 4 / 10; the restart: 9 documents  | The lane is decided once from the declared input types; a complex value at a real input is outside its type; no restart |
| Selection (decided, §6.3)      | `When` with a list operand: 3 / 46; `Which`: 13 / 23                         | The five constraints of the survey's §6.3, with Tycho's two conditions |

Features kept or dropped by name, no census input: the bigint mode (kept, a
third-party request), the WGSL and Python targets (Tycho uses neither), the
numeric kernels on GPU targets, value kinds. A dropped feature is removed in
step 4 as its own step. The `broadcast()` batch API and the kernel pool are
kept, with a `corpus` witness: the census counts the `broadcast: true`
compile option in 2,870 expressions of 314 documents, and Tycho (tycho-f9,
2026-11-02) uses `broadcastAsync()` and `evaluateAsync()` through the
engine's kernel pool for region fills, heatmaps and the solver's fit search,
synchronous `broadcast()` for snapshot and print renders, restriction masks
and implicit-region probes, and `createKernelPool` inside its own 3-D
marching worker.

## 3. The language release

One release that carries every breaking change, so that Tycho migrates once.
Its CHANGELOG section names each change with the row of the restriction
table or the census that witnesses it. Before the release, Tycho is told the
version and re-checks its rows (restriction binding: the 63 single-branch
piecewise rows, the 76 stacked restrictions, the rows whose right side has
several terms; selection: the 46 + 23 states with a list operand).

3.1 **The parser: the restriction and the `where` clause.** Done, commit
`7c4869ad1` (2026-11-02). What landed beyond the two specifications: a
`where` binding whose value is a dictionary is `Declare(a, Dictionary(…))`,
because the three-operand form reads a dictionary as the attributes of the
declaration; the discharges (`IsMissing`, `Coalesce`, `AssertPresent`, a
default parameter) find a restriction in the structure of the expression,
every operand of `Coalesce` and a collection literal only at its root;
`When` stays in the library, and every site that read `When` also reads a
single-branch `If` (`restrictionParts()` in
`boxed-expression/conditional-value.ts`). The corpus measure against Tycho
`08419538f` (base `0cbf41d09`): no value changed; new declines javascript
+7, glsl +3, interval-js +5, all classified. Tycho's two adapter gaps are
fixed in its detached commit `e87d293fc`, not yet on Tycho main. Code lines:
the LaTeX dictionary grew from 15,967 to 16,149 and `compilation` from
96,270 to 96,302, by design; 3.2 and step 4 remove code. One item, since
both change the same precedence table and the same serializer of `If`.

- The restriction rule of `docs/plans/2026-11-02-restriction-binding.md`:
  `\{c\}` as a postfix that binds looser than arithmetic and than a
  relation, and tighter than `where`, `\to`, `for` and the comma, applied to
  its group, so a restriction at the top of a statement covers the whole
  statement; the parse is `If(c, e)`; stacked restrictions merge into
  `If(And(…), e)`; `\{c\}` alone is `If(c, 1)`. The 40 lines of the LaTeX
  dictionary that produce `When` change. Tests are the corpus rows named in
  the table. In the same item, a single-branch `If(c, e)` takes the meaning
  that `When(e, c)` has today, so that a parsed restriction keeps its
  value: when `c` is false its value is the absent value of the domain of
  `e` (the type-directed `absenceMarker()` of `When`: `NaN` for a number,
  `Missing` otherwise; the `NaN` point comes with 3.3), and its static type
  is the type of `e` with no `missing` arm (options page 1, "Typing").
  Measured by the implementer on 2026-11-02: before this, the parsed
  `If(x > 0, 2x)` was typed `missing | number` and gave `Missing` where
  `When` gave `NaN`, and `ce.assign` into a declared `number` refused it.
- The `where` clause of `docs/plans/2026-11-02-where-binding.md` (approved
  2026-11-02): `e \text{ where } items`, an item being a binding
  (`a \coloneq v`, or `a = v` with a bare symbol on the left) or a condition
  (every other relation); the form is one `Block` of a `Declare` and an
  `Assign` per binding in written order, then `If(c, e)` over the conditions
  joined with `And`; the scope is the whole statement or the content of the
  delimiter that holds it, tighter than `for`, the comma and `;`. It changes
  `parseWhereExpression()`, the serializer (a binding `Block` is written
  `e \text{ where } a \coloneq v`; every single-branch `If(c, e)` is written
  `e \text{ where } c`), about ten test files, the guide page
  `13-guide-compile.md` and the CHANGELOG.

3.2 **`When` is removed.** Done, commit `5a1ceb18a` (2026-11-02, session
compute-engine-cc; 176 files, 2,434 insertions, 2,757 deletions; the
measure and the choices are recorded at the end of this item). The library
entry in `control-structures.ts`,
its canonicalization rules (`When(When(e, c1), c2)`), its evaluation and
type handlers, and the 32 source files that name it; the serializer writes
every single-branch `If(c, e)` as `e \text{ where } c`, in parentheses when
the clause is not the whole statement, never as the brace (user decision
2026-11-02, relayed by the session of the `where` specification, whose
section "The LaTeX of `If(c, e)` with no `Block`" holds the rule; the brace
is an import spelling only, per Tycho's `RESTRICTION_SYNTAX.md`, and still
parses to the same `If`). `If(c, e)` with no else keeps its documented
meaning (the absent value when `c` is false), and a scalar condition
accepts a non-value arm: a relation, a regression, an `Assign`, a point, a
point list, the drawing heads (`Polygon`, `Triangle`, `Segment`,
`GeometricVector`, `Sphere`, `Histogram`) and a `To` action.

Since 3.1 made every `When` site also read a single-branch `If`, 3.2 deletes
the `When` branch at each site and keeps the `If` branch. The measure is the
same corpus audit with base `7c4869ad1`; expected: no changed value and no
new decline. One behavior moves with the spelling: a held restriction over
a collection, `[1,2,3]\{0\le t\le 6\}` with `t` free, presents as the
collection of its restricted cells (`isCollection`, `count` and `each()`
agree with its type; `whenCollectionHandlers()` in `control-structures.ts`,
witness Tycho item 66, `corpus`). Today only `When` has these handlers, so
`heldRestrictionAsIf()` keeps the `When` spelling for that one held form.
3.2 gives `If` the same collection handlers, keyed on the two-operand form
whose arm is a collection, so that a three-operand `If` and a scalar arm
keep their behavior; the handlers' comment says that an `If` with collection
handlers changes how it propagates the errors of its operands, and the
implementer measures that on the tests of `when-collection-value.test.ts`,
`restricted-list-lazy-operators.test.ts`, `absent-collection-operand.test.ts`
and `threads-conditionals.test.ts` rewritten to `If`. Keeping an internal
`When` for the held form is not an option: the item removes the operator.

Tycho's use of `When` (answer of the session tycho-f9, 2026-11-02, Tycho
main `8424e816e`): Tycho builds `["When", body, condition]` and gives it to
the engine in `plot/ce-compile.ts` (the mask wrapper of the `javascript` and
`glsl` compiles), `plot/webgl/gpu-implicit.ts`,
`plot-core/normalize-restrictions.ts`,
`plot-core/classification-restricted-definition.ts`,
`plot-core/classification-floor-plane.ts` and
`graph-paper/desmos-import/normalize/basic.ts`; about 30 readers in
`plot`, `plot-core`, `graph-paper/graph`, `graph-paper/variables`,
`graph-paper/actions` and `desmos-import` test the `When` operator; 19 test
files hold MathJSON `"When"`. No stored document or corpus state holds
`When` (stored rows are LaTeX, and 0.176.0 wrote a restriction as the
brace). The detached commit `e87d293fc` rewrites the new `If` forms back to
`When` for these readers (`withStatementRestrictionAsWhen`). So Tycho must
build and read only `["If", c, e]` (step 1 of Tycho's
`requirements/todo/CE_LANGUAGE_RELEASE_ADOPTION.md`) before it can take a
release without `When`. The corpus measure of 3.2 uses a Tycho commit that
builds only `If`: the base `4a00e7c32` reads both spellings, so that commit
gives a comparison of the two engine builds under one Tycho. With a Tycho
that builds `When`, the measure would count Tycho's own `When` nodes, which
the candidate no longer knows.

The result of 3.2 (2026-11-02, session compute-engine-cc; base `4a00e7c32`,
Tycho frozen at `44a25d4e3`, which builds and reads only `If` on both
builds; its later `58b767d19` differs only on CE 0.176.0). Declines: none
new (javascript 66, glsl 48, interval-js 90 in both runs). Values: none
changed. The audit tools were run from a copy whose record key is the
MathJSON of the compiled expression with `When(e, c)` read as `If(c, e)`
and whose sample inputs are seeded by the free-symbol names, because the
LaTeX key changes with the notation (a held restriction is written with
`where` instead of the brace). 76,718 values under matching keys and 405
values in 90 records whose key changed are equal. In one document (Planck
curves over `(0..0.1..1)`), Tycho now compiles the restricted list once,
where it compiled each of 10 cells (40 records fewer); every cell value
equals its list cell within a relative 5.7e-13. Where the scalar condition
is false, that compiled list gives one scalar `NaN` for the whole list (the
interpreter gives `Missing`, within the caveats of compiled code); Tycho
checks in its adoption whether its renderer needs a list there. Code lines
(not blank, `//` or `*`): `library` 77,958 → 77,912, `compilation` 92,700 →
92,482, the LaTeX dictionary 15,855 → 15,843, `boxed-expression` 83,684 →
83,713 (the restriction is recognized by its form at the sites that read
the `missing` arm of the old type).

Choices made in 3.2, each reversible: a held `If(c, L)` over a list whose
condition is not decided is an indexed collection, mapped cell by cell
(`\sin([1,2,3]\{0<t\})` at `t = -1` gives `[NaN, NaN, NaN]`; it gave
`Missing`), the other option being a `missing` arm on the type of a
collection-valued restriction; `isCollectionHead()` excludes an operator that
selects its operands, so that a scalar `If` keeps its error propagation;
`toString()` prints a restriction as `If(c, e)` (it printed `e {c}`; the
user kept `If(c, e)` on 2026-11-02, so there is no short form); a
condition declared `collection<boolean>` is not refused yet (item 3.3).

3.3 **Selection.** The constraints of the survey's §6.3 in the interpreter:
the condition is a boolean or a flat list of booleans (a nested list, an
uneven list or a `Missing` cell is a static error); every arm is a scalar or
a flat list of the condition's length, all arms of one element kind; an
unmatched position is `NaN` for a number cell and a `NaN` point for a point
cell; a scalar condition selects an arm whole; `If(c, e1, e2)` is
`Which(c, e1, True, e2)`. The scalar no-match result of `Which` is unchanged
(Tycho reads it). `docs/BROADCAST-MODEL.md` replaces its 2026-07-27 and
2026-10-22 selection entries with this rule; the 2026-10-18 decision on
`undefined` cells is reversed and recorded.

The result of 3.3 (2026-11-02, session compute-engine-53; base `5a1ceb18a`;
staged, not committed).

- **A false scalar condition over a list.** Implemented: the whole-list
  absent value `Missing` for every reader, by rule 4 (the arm is selected
  whole), which is also the value of compiled code within its caveats (one
  scalar `NaN`, or `undefined` for points). The alternative, every reader
  maps cell by cell (`[NaN, NaN, NaN]` for all four expressions), would
  change what Tycho's renderer receives and contradict rule 4. Mechanism:
  before an operator maps its operands, an operand `If(c, L)` whose condition
  is of type `boolean` is lifted out of the call, `Sin(If(c, L))` →
  `If(c, Sin(L))`, where the call maps that operand element by element (a
  broadcastable library operator; a lambda or a user function that
  propagates absence, at a required scalar parameter whose type does not
  admit `missing`). At any other position of a user function the condition
  is evaluated once and the function receives `L` or `Missing` whole, so a
  body with `Coalesce` or a default parameter still runs
  (`liftWholeRestrictions()` in `boxed-expression/boxed-function.ts`).
  Probe, `t` real and `t = -1`:

  | Expression               | Before (5a1ceb18a)  | After     |
  | ------------------------ | ------------------- | --------- |
  | `[1,2,3]\{0<t\}`         | `Missing`           | `Missing` |
  | `2[1,2,3]\{0<t\}`        | `Missing`           | `Missing` |
  | `[1,2,3]\{0<t\}+1`       | `Missing`           | `Missing` |
  | `\sin([1,2,3]\{0<t\})`   | `[NaN, NaN, NaN]`   | `Missing` |

  With `t` free, `\sin([1,2,3]\{0<t\})` is the held
  `If(0<t, [\sin 1, \sin 2, \sin 3])`, which presents as a collection
  (Tycho item 66). Other probe values: `If(v>0, (1,2))` with
  `v = [-1, 2, 3]` was `[Missing, (1,2), (1,2)]`, typed
  `list<missing | tuple>`, and is `[(NaN,NaN), (1,2), (1,2)]`, typed
  `list<tuple<number, number>>`; `If([[True],[False,True]], 7, 0)` was
  `[[7],[0,7]]` and is an `incompatible-type` error;
  `Which(t < -5, 1)` stays `Missing`.
- **Choices beyond the rule, each reversible.** (1) A relation arm (a
  region of a plot) and a statement arm stay accepted under a list
  condition, with their old values (a cell with no match is `Missing`; item
  3.4, two-valued comparisons, settles it): the first build refused them,
  and 30 corpus rows lost every compiled record (for example neyret/3afaeatwub
  `1>0 \text{ where } (x+2)^2+y^2\le(0..0.2..1.6)^2`, art/hyvhlz4chj).
  (2) `indexed_collection<boolean>` is a flat condition (Tycho types a point
  list as `indexed_collection<tuple>`, Tycho item 335). (3) A condition type
  that admits a flat list but does not settle the rank (`tensor<boolean>`,
  `list<boolean | list<any>>`, `boolean | list<boolean>`) is accepted and
  checked on its value (a nested value is an `incompatible-type` error, `NaN`
  compiled): Tycho types an unannotated parameter
  `broadcastable<number | tuple>`, so a condition in a function body has such
  a type, and refusing it lost the corpus rows neyret/o0iqr4bhzk,
  art/lkto8x8wr5 and art/njncrg9fkv. Refused: a nested list, a `Missing`
  cell, `collection<boolean>`, `set<boolean>`, bare `list`, `list<any>`,
  `matrix<boolean>`. (4) A length known only from the value is still
  truncated to the shorter length; two lengths that the types give and that
  differ are `incompatible-dimensions`. (5) A false scalar condition that a
  compiled selection finds at run time gives `undefined` for the whole value
  (`NaN` for a number), not one `[NaN, NaN]` point. (6) A colour arm (and a
  symbol, a tuple that is not a point) stays accepted under a list
  condition, and its unmatched cell stays `Missing`: rule 2 names numbers,
  points and strings only, and refusing a colour arm broke Tycho item 189
  (`Which(\sqrt{X^2+Y^2} \le 1, \mathrm{Hsv}(0,0,…), \mathrm{True},
  \mathrm{Hsv}(0,0,0.8))` over a 30×30 grid, `corpus`; every position is
  matched there, so no `Missing` cell reaches Tycho). The other option, a
  colour as a third element kind, needs a decision on its unmatched value: a
  colour has no `NaN`.
- **Tycho's answer** (tycho-f9, 2026-11-02, a reading of Tycho main, no
  tests run): the 3-D point markers (`scatterPoints` and
  `buildScatterGeometry` in `plot-3d/geometry-builders.ts`), the 3-D
  polyline (broken at the `NaN` slot, `splitPolylinesAtGaps`), the GPU routes
  (`drawScatter`, the colour pass and 3-D picking use the compacted buffer)
  and the 2-D point labels (`scatter-series.ts`) skip a point with a `NaN`
  coordinate; a 3-D label anchored at a `NaN` point is dropped because
  `project()` returns `visible: false` (no explicit filter, no test); not
  traced: the single head-point draw in `plot3d-renderer.ts`, which is not
  fed from a point list. The `Missing`-cell readers change in Tycho's
  adoption step 4; the scalar `Which` no-match needs no change. Open on
  Tycho's side: whether its list readers accept a whole-list `Missing` (or a
  compiled scalar `NaN`) where a list is expected, and its own codegen audit
  with the 3.3 build.
- **The corpus measure** (Tycho frozen at `44a25d4e3`, the tools of 3.2 with
  records keyed by MathJSON): 17,690 records in both runs; declines
  javascript 66, glsl 48, interval-js 90 in both runs, no new decline; one
  key changed, as expected: art/njncrg9fkv, the restricted 3-D point list
  `p \text{ where } \mathrm{PointZ}(p)+… < h_{ash}(…)`, whose unmatched cells
  went from `undefined` to `[NaN, NaN, NaN]` (8 values). 77,146 values
  compared.
- **Code lines** (not blank, `//` or `*`): `library` 77,924 → 78,095,
  `boxed-expression` 83,789 → 83,930, `compilation` 92,482 → 92,398.
  `selectNested` is deleted; the rank-2 selection code that is now
  unreachable stays for step 4: in `javascript-runtime.ts` the depth forms of
  `WholeArm`, `absentByDepth`, `wholeAt`, `pointDepthUnknown`, and the
  `!flat` branches of `compileJSSelection` that emit them; in the
  interpreter the levels below 1 of `evaluateElementwiseSelection`,
  `lowerRankArmError`, and the depth-2 code of `armTypeAtDepth`,
  `conditionShape` and `mergeMaskShapes`.
- **Review**: three rounds, Claude and Codex. Fixed: the lift through a user
  function that discharges absence, the wrong shape of a compiled false
  scalar condition over a list of points, a condition typed
  `boolean | list<boolean>` treated as scalar, the held form of an undecided
  split, the evaluate options of the lifted call, a parameter that admits
  `missing`. The full suite then found three defects that the targeted tests
  did not (a colour arm refused, Tycho item 189; a point arm typed as a union
  of tuples refused; the async route left an async-only operator
  unevaluated in a held restriction); their fixes had their own three review
  rounds (a compiled union-of-tuples point cell, the async guard test, the
  alias unfolding of `pointArity()` with a cycle limit). Not fixed: a
  declared `number | tuple` arm compared at run time (`crafted`); the effect
  order of conditions with an effect (`crafted`, written as a limit in
  `docs/BROADCAST-MODEL.md`); Codex's finding that `If([True, False], xs)`
  with `xs: list<real>` holding 3 elements is truncated to `[1, NaN]`, which
  is choice (4). Every review fix had a review except the last change to
  `pointArity()` (an early exit of the union walk and its comment).
- **Checks** on the final tree: typecheck, lint, `check:deps`, `test:core`
  (5,501 passed), the full suite (1,798 suites, 78,168 tests passed, run
  before the last two review fixes; the targeted selection files passed
  after them), the corpus measure above (run before the last edit of
  `pointArity()`, which gives the same answer for every type and only stops
  the walk earlier).

3.4 **The decided axes of step 2**, each in the interpreter and its
documents: two-valued comparisons, Missing as a result only, the error model,
block locals, function values, the complex lane. Each one is a step of its
own in the same release branch, with the corpus measure and its listed
expected changes.

The compiler side of 3.1 to 3.4 in this release is the minimum that keeps
compiled code equal to the interpreter: the new static errors decline, the
`NaN` point cell replaces `undefined` in the JavaScript lowering, `When` is
gone from the handler tables. The removal of the code that the new rules
make unnecessary is step 4.

## 4. Contract the compiler

After the release, one step per axis, in the order of code removed. Each
step: an implementer in a worktree, the corpus measure (zero new declines,
zero changed values, since the semantics shipped in step 3), the size
report, and the deletion of the tests that pinned the removed behavior.

| Order | Step                                                                                                                                                          | Removes (module, code lines on 2026-11-01)                                                                                   |
| ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
|     1 | Selection: one lowering for `If` and `Which` over a flat boolean or a flat list; no mask rank, no uneven mask, no arm dispatch                                 | `compile-conditionals.ts` 546, `compile-conditions.ts` 488, `compile-match.ts` 716, `selectNested` and its runtime helpers   |
|     2 | Absence: the absent value only at producers, accessors and discharges; no three-valued comparisons, no absence kinds, no absence axis of a type               | `compile-absence.ts` 1,823, `absent-tuple-read.ts`, the absence part of `compile-broadcast.ts` and the targets               |
|     3 | Admission and shapes: the admission check reduced to the R1 to R6 declines; no union-of-shapes dispatch beyond the one at a binding                           | `compile-admission.ts` 1,461, `static-shape.ts` 531, `compiler-type-facts.ts` 830 in part                                    |
|     4 | Block locals, A′ (decided 2026-11-02): a declaration has a value, an assignment is a statement, reassignment stays; the definite-assignment analysis, the local shape frames, the chained and nested assignments, the engine-symbol writes, the loop-value lowering and the effects contract of `vars` code go | `compile-locals.ts` 1,238 (most), `compile-blocks.ts` 617 in part, `compile-loops.ts` 1,175 in part, `compile-declarations.ts` 823 in part, the local frames of `compiler-core.ts` |
|     5 | Function values: fully applied calls and literal-lambda callbacks only; currying, partial application, defaults, function-typed variables decline            | `compile-callbacks.ts` 2,316, `compile-user-functions.ts` 1,948, `compile-user-calls.ts` 1,101, `compile-function-literals.ts` 479 in part |
|     6 | Complex lane by static type (decided 2026-11-02): `strict` is the only discipline, `auto` removed, no promotion, no `LaneMismatch` redo, no lane recording, no restart | `compile-complexness.ts` 635, `compile-lanes.ts` 709 in part, `compiler-mode.ts` in part, the redo and the restart in the targets |
|     7 | Error model: one dynamic non-value; the `Nothing` and `Indeterminate` positions and the undecided-comparison rules go                                         | the Kleene and decidability functions of the absence module, `javascript-value-facts.ts` in part                             |
|     8 | Features dropped by name in step 2, each its own step                                                                                                         | WGSL: `gpu-shader-target.ts` 1,813, `wgsl-field-function.ts` 978 and the WGSL branches of the GPU modules; Python: `python-target.ts` 5,092; value kinds |
|     9 | GPU finite proofs: accept an undefined value on overflow or decline what is not proven finite, per the user's choice in step 2                               | `gpu-finite-proof.ts` 1,213 and the proof calls in the GPU modules                                                           |

The line counts name the modules; the lines that each step removes are
measured by the step. A step that finds a corpus expression depending on the
removed code stops and reports: that expression is a `corpus` witness, and
the rule for it is decided by the user, not by the implementer.

## 5. The growth guard (done 2026-11-02, commit 97c3d409a)

Two numbers per commit in the nightly run, kept with its result: the code
lines of `src/compute-engine/compilation` and the compile depth limit of
`compile-deep-nesting.test.ts` (a first compile in a warm worker). A rise of
the first or a fall of the second between two nightly runs is reported with
the run, like a failed test, with the commits in between. Small; any time.

Implemented 2026-11-02: `scripts/ci-nightly.sh` runs
`scripts/compiler-growth.mjs` after the full suite and keeps the two numbers
in `last.json` (`metrics`, `previousMetrics`) and in `metrics.jsonl` of its
state directory; `~/.claude/scripts/suite-status.mjs` reports the change.
The depth limit is that of a `Sin`/`Cos` chain only (the Horner form is not
measured). At d83338f66 it was 95,413 code lines and a depth of 344. The
measure takes about 5 s when the limit did not change, about 35 s otherwise.
A rise or a fall does not make the run fail, so it does not block a release.

## 6. What is still open

- Two checks the decisions depend on: an `Assign` whose target is not
  declared in its block, in Tycho's 44 documents with `Assign` (block locals
  A′ declines a write to an engine symbol; the census did not count it),
  and whether the third-party user of the bigint mode uses currying, partial
  application or a function value in a variable (function values B declines
  them).
- Tycho confirms that its complex-mode documents compile in complex mode or
  declare their inputs complex (the complex lane in its strict form).
- Tycho's checks after the release: the 3-D point routes, point labels and
  GPU point routes for a `NaN` point (its Q1 answer did not cover them).
- The npm users of the removed features: a CHANGELOG entry per removal, with
  the decline that replaces it.
