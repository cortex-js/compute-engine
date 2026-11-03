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

3.3 **Selection.** Done, commit `e8a75b9c4` (2026-11-02, session
compute-engine-53; the record is at the end of this item). The constraints of the survey's §6.3 in the interpreter:
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
committed as `e8a75b9c4`).

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
  compared. Tycho's own codegen audit (tycho-f9, 2026-11-02, Tycho
  `58b767d19`, compared with its run on CE `4a00e7c32`): 17,690 records, no
  new decline and no decline gone; the compiled code changes in one more
  document, art/s8ishknvhe (a setup row: the absent cell passed to
  `_SYS.selectAbsent` goes from `undefined` to `[NaN, NaN, NaN]`, the same
  change), which the value audit did not sample. Tycho checks both documents
  when it adopts 3.3.
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

3.4.1 **Two-valued comparisons** (options page 3, option A). Staged
2026-11-02, session compute-engine-16, base `e8a75b9c4`, not committed (the
record is at the end of this item). A comparison is `True` or `False` in the
interpreter and in every compiled target; an undecided operand (`NaN`,
`Missing`, `Undefined`, a pole, a value with no order) gives `False`, and
`≠` gives `True`. Connectives, the condition of `If` and `Which`, and the
quantifiers read an absent value as `False`; the absent-condition error is
gone. The 2026-10-20 decision (Tycho rows 411 and 413) and its 2026-10-21
extension are extended to `Missing`, to the connectives and to the
conditions, not reversed (`docs/ERROR-MODEL.md`, section "A comparison is
two-valued — user decision of 2026-11-02").

- **Tycho's answer** (tycho-f9, 2026-11-02, a reading of Tycho main, no
  tests run). No Tycho reader depends on a comparison or a connective that
  gives `Missing`, or on the absent-condition error. One reader changes
  toward the Desmos result: the per-member gate of a relation family
  (`relation-family.ts`, `gateVerdictsOf` and `deferredBoxedGateVerdicts`)
  made the whole gate null on a non-boolean element and drew every member;
  now only the member is hidden. Readers that already read `False`:
  `at-index-semantics.ts`, `relation-family.ts` (suppress on `False`),
  `classify-formula.ts`, the interval reader `evalTriNode` in
  `plot/ce-compile.ts`. Kept: Tycho reads the scalar no-match `Missing` of
  `Which` as a `NaN` slot (`at-index-semantics.ts`), so that value does not
  change. Tycho updates its `docs/COMPUTE_ENGINE.md` (the `w > 0` example)
  when it adopts the release. The census rows (1 document, 5 Desmos states
  with a comparison over a `missing` operand) are not in Tycho's documents,
  so they were not checked by name.
- **The arms under a list condition, left to this item by 3.3.** A relation
  cell with no match is `False` (Tycho: its compiled masks test `=== true`,
  and its per-member gate needs a boolean). A colour cell with no match is
  `Rgb(NaN, NaN, NaN)` in the interpreter, and the non-finite `oklch` colour
  object in compiled JavaScript: Tycho reads a colour with a non-finite
  channel as "no colour here" and fills the gap with the row colour
  (`dynamic-color.ts`); `Missing`, `NaN` or `False` as a bare cell make it
  drop the whole colour list. Witness: Tycho item 189 (`corpus`). The other
  option was to keep `Missing`. A cell read while its condition is not yet
  decided carries the same value as an explicit else arm.
- **Choices beyond the rule, each reversible.** (1) A scalar `If(c, r)`
  whose arm `r` is a relation (a boolean) gives `False` when `c` is false,
  not `Missing`, as the relation cell does; its type is widened to
  `boolean`. This makes the corpus row neyret/xhlkk7k9aq compile on GLSL.
  (2) Boolean collection and set predicates over an absent COLLECTION
  operand answer `False` (`Any`, `All`, `Contains`, `ContainsSequence`,
  `StartsWith`, `EndsWith`, `IsEmpty`, `Element`, `Subset`, `SubsetEqual`,
  `Superset`, `SupersetEqual`) or `True` (`NotElement`, `NotSubset`,
  `NotSuperset`, `NotSupersetEqual`), so the held route
  (`If(c, True)`) and the fresh route agree; the number-theory predicates
  (`IsPrime`, …) and an absent ELEMENT operand of `Element` are unchanged
  (the 2026-09-26 rule: `Element(Missing, [1, Missing])` is `True`). The
  other option was to keep `Missing` there until 3.4.2. (3) A comparison or
  a connective is typed without a `missing` arm. (4) `Not(Not(x))` is not
  folded when `x` can be absent, so `Not(Not(Missing))` is `False`. (5)
  `Equivalent(A, Missing)` is `Equivalent(A, False)`. (6)
  `assume(x = 1 = Undefined)` answers `contradiction` (the link
  `1 = Undefined` is `False`), not `not-a-predicate`.
- **Compiled code.** The NaN "decided" test of a compiled comparison over
  an operand typed with a `missing` arm is removed (`operandPresenceConjuncts`
  in `compile-absence.ts`, renamed from `operandDecidedConjuncts`): the plain
  IEEE comparison gives the interpreter's `False`, so `If(w > 0, 1, 0)` with
  `w: number | missing` and `w = NaN` is `0` on javascript and python, where
  it was `NaN`. The test for the absent object stays. `kleeneValueLeaf`,
  `kleeneRelationLeaf`, `mayBeUndecided`, `conditionDecidability`,
  `compileExactCondition` and the interval `missing` flag stay for step 4,
  row 2: with an absent operand compiled code still gives `NaN` where the
  interpreter gives `False` (`If(w > 0, 1, 0)` with `w` absent), which the
  caveats of compiled code allow. `Any` and `All` over an element type with
  a `missing` arm still decline.
- **The corpus measure** (Tycho frozen at `44a25d4e3`, the tools of 3.3 with
  records keyed by MathJSON; base run on `e8a75b9c4`): 17,690 records and 77,146 values in both runs.
  Declines: javascript 66 and interval-js 90 in both runs; glsl 48 → 47,
  no new decline. The decline that goes is the expected row
  neyret/xhlkk7k9aq (`.7=c_3\{0<\{c_1<1\}\{c_2<1\}: …, …, 1\}`, whose
  GLSL code declined on an absent `boolean` position). Values: 5 keys
  changed (24 sampled values), each one of the expected kinds:
  neyret/xhlkk7k9aq, 2 keys, `NaN` → the finite value of Desmos (the
  condition `If(c_2<1, Less(0, If(c_1<1, 1)))` is `False` where `c_2 ≥ 1`,
  so the else arm); neyret/3qkygakl9m, 2 keys
  (`0<KT^{\lfloor x\rfloor}-… \text{ where } 0<x`), and neyret/akconkhexx,
  1 key (`0<x\lor2<x \text{ where } x<1, x<3`), `undefined` → `false`
  where the condition is false: a relation restricted by a scalar condition,
  choice (1) above. Tycho's compiled masks test `=== true`, so the region
  drawn does not change.
- **Code lines** (not blank, `//` or `*`): `library` 78,095 → 77,903, `boxed-expression`
  83,930 → 83,962, `compilation` 92,398 → 92,419 (the compiler kept its
  Kleene helpers for step 4; it gained the unmatched relation and colour
  cells and lost the NaN test). Source diff: 20 files, 703 insertions, 959
  deletions; tests: 43 files changed (none deleted; one test removed, "the
  evaluated result is typed missing"), one new file
  `test/compute-engine/two-valued-comparisons.test.ts`; no snapshot
  changed.
- **Review**: Claude and Codex, three rounds (the Codex model was at
  capacity twice; each retry ran). Fixed: round 1, the type of a false boolean restriction (Codex,
  high), the negated predicates through a lifted condition, an `Undefined`
  mask cell, the NaN test of compiled comparisons (Claude), the 4 old pins
  of the full suite, the colour object, `ForAll`/`Exists` with a constant
  body, unreachable `Undefined` tests; round 2, an element-wise connective
  in a condition kept its list shape (Codex), `ExistsUnique`, comments;
  round 3, `Not(Not(Missing))`, an error operand before a deciding absent
  operand in a condition, a colour cell read before its condition is
  decided (Codex), one comment (Claude). The round-3 fixes had no review
  (the third round is the last); each witness is `crafted`.
- **Checks** on the final tree: typecheck, lint, `check:deps`, the full suite (1,799
  suites, 79,443 tests, 0 failed) and the corpus measure above, all on the
  final tree in the worktree, whose files are byte for byte those staged.
  `test:core` was not run separately: the full suite contains it.

What 3.4.2 (`Missing` as a result only, options page 1) needs from this
item: (1) every operator that is not a comparison, a connective
or a boolean collection predicate still has its old reading of `Missing`
(`Missing + 2` is `NaN`; the number-theory predicates such as `IsPrime`
answer `Missing`; an absent element operand of `Element` follows the
2026-09-26 rule): 3.4.2 decides these, under the rule that a comparison is
`False`. (2) A declared type with a `missing` arm is still accepted, and
146 test files name a type with a `missing` arm (a declaration such as
`w: real | missing` or an expected type; counted with `grep -rlE` on
`test/`); 3.4.2 makes that declaration a static error, so the tests that
declare one move to a producer (a selection with no match, an accessor out of range). (3) With
no declared absent input, the compiled presence test of
`operandPresenceConjuncts` and the Kleene compile helpers serve only the
absent value of a producer, which the caveats leave unspecified: step 4,
row 2 can then delete them, and the decline of `Any`/`All` over an element
type with a `missing` arm. (4) The values fixed here stay: the relation cell
`False`, the colour cell `Rgb(NaN, NaN, NaN)`, a false `If(c, r)` over a
relation `False`, and the scalar no-match `Missing` of `Which` (Tycho reads
it).

3.4.2 **`Missing` as a result only** (options page 1, option A). Staged
2026-11-03, session compute-engine-c0, base `585acfab5`, not committed (the
record is at the end of this item). A declared type cannot name `missing`;
`Missing` is produced only by a selection with no match, an accessor out of
range and the written symbol, and its value follows the domain (`NaN` for a
number, the point of `NaN` coordinates for a point, `Missing` otherwise);
the readers (`IsMissing`, `Coalesce`, `AssertPresent`, a branch, a default
parameter, the position-preserving accessors) keep their answers and read
`NaN`, a `NaN` point and `Missing` as absent; every other operator over
`Missing` gives `Missing`; `Undefined` is an ordinary unknown symbol; the
type `missing` is a marker, implicit in signatures (`docs/ERROR-MODEL.md`,
section "`Missing` is a result only — user decision of 2026-11-02").

- **Tycho's answers** (tycho-f9, 2026-11-03, a reading of Tycho main, no
  tests run). (a) No Tycho builder writes `missing` in a type literal, but
  three sites copy an INFERRED type into a declaration and now fail:
  `ce.declare(symbol, { type: definition.type }, scope)` in
  `document-ce-manager.ts` (about 13866–13871; a throw is caught by
  `_deriveValueType`, whose type falls back to `unknown`, which can change a
  row's classification), `ce.declare(name, { type: body.type })` for a colour
  value in `style-expressions.ts` (about 841; a throw skips that colour
  definition and its dependents; what the row then draws is not traced), and
  the GLSL colour helper's `Typed` parameters and signature string (about
  858–871; a `missing` parameter type declines). Tycho strips the `missing`
  member there (`withoutMissingMember`) at adoption. (b) No Tycho reader or
  builder uses the `Undefined` symbol; two name sets list it
  (`normalize-restrictions.ts` 237, `undrawn-rows.ts` 323) and lose it at
  adoption. (c) Tycho's point readers accept a `NaN` point from an accessor
  out of range (the 3-D routes drop a non-finite point; `at-index-semantics.ts`
  already uses `NaN` as the hole). Tycho's own `At` compile handler wrote
  `_SYS.atNoWrap(base, i)`, which reads `undefined` out of range; with the
  accessor types now without a marker arm its coordinate reads threw. At
  adoption the handler emits `_SYS.atPointNoWrap(base, position, n)` for
  every index form when the base's element type is a point of 2 or 3
  coordinates (a new runtime helper: a scalar index, a gather and a boolean
  mask, a fresh `NaN` point out of range); Tycho recorded three tests. (c')
  A false restriction of one point now gives a `NaN` point (below); Tycho's
  readers accept it with two changes of behavior: a 2-D polygon with a
  restricted vertex, `polygon(A, B\{c\}, C)`, splits into runs at the
  vertex instead of not being drawn (Tycho checks it against Desmos at
  adoption; no corpus record of the audit is such a polygon), and a row
  whose restriction is false when Tycho classifies it now classifies as a
  point row with `NaN` coordinates (same picture, another route). Not
  traced: the drag path of a movable point whose restriction is false.
- **Decisions in this item, each with its alternative.**
  (1) User, 2026-11-03, after review: a false restriction of one point,
  `If(c, (1, 2))` with `c` false, gives `(NaN, NaN)` (rule 2), in the
  interpreter and in compiled JavaScript, Python and interval code (GLSL and
  WGSL already gave a `NaN` vector). The alternative was to keep `Missing`
  and do it later in its own step. `Sin(If(c, (0, 1)))` and
  `First(If(c, [(1,2),(3,4)]))` give `(NaN, NaN)`; a false restriction of a
  whole list stays `Missing` (item 3.3, rule 4); the scalar no-match of
  `Which` stays `Missing` (Tycho reads it).
  (2) User, 2026-11-03, after review: compiled code treats every point-typed
  value as possibly absent at a default fill and at `AssertPresent`, as it
  already treats a `real` scalar, and emits one `NaN`-point test chosen from
  the static type. The alternatives were a decline, or a static proof of
  which points can be `NaN`, which three review rounds each found a new hole
  in.
  (3) The readers and a default read a `NaN` point as absent (options page
  1: `IsMissing` reads all three), so `Coalesce(At(ps, 9), (0, 0))` stays
  `(0, 0)`. A point whose coordinates became `NaN` by arithmetic also reads
  as absent.
  (4) The `ce.assign` site of rule 5: an assignment (`ce.assign`, `Assign`,
  `Declare` with a value, an Epsil typed `let`) accepts a value that holds
  the marker where the declared type accepts the present value
  (`matchesOrAbsent()` in `effects-inference.ts`); `matches` stays strict.
  Witness `plausible` (Epsil `let y: string = xs[5]`). `x: real` still
  refuses the `NaN` of an out-of-range read (documented: `real` excludes
  `NaN`; declare `real | nan` or `number`).
  (5) A call with `Missing` at a declared or annotated numeric or point
  parameter gives `Missing` without running the body, unless the parameter
  has a default (filled) or the call is a partial application:
  `Map((x: integer) ↦ x > 0, [1, Missing])` is `[True, Missing]`. The
  alternative (bind `Missing` and run the body) gave values whose type did
  not hold them. A `NaN` point at a point parameter is accepted, as `NaN`
  is at a numeric parameter.
  (6) A coordinate (`PointX/Y/Z`) of an absent point or point cell is `NaN`
  on every route; `Length` of an absent collection is `Missing`;
  `IsPrime(Missing)` is `Missing`; `Element(Missing, [1, Missing])` stays
  `True` (the 2026-09-26 rule); an error datum outranks `Missing` in the
  statistics, `Quantile` and `Distance`.
  (7) Accepted, not changed: a declared symbol's type does not show a
  marker its value may hold (`Norm(P)` with `P: list<tuple<real, real>>`
  holding a restricted point is typed `list<number>` and gives
  `[Missing, 5]`), as `NaN` sits outside `real`; aggregates (`Sum`, `Mean`,
  `Max`) are typed `number` with the marker implicit; a matrix product with
  a `Missing` cell gives `NaN` cells (the packed kernels; witness `crafted`;
  its type has a `nan` arm); `Dot((1, Missing), (1, 1))` is typed
  `integer<1..1> | missing`; the interval target gives the interval
  `entire` for `Length(g7(rows)[2][1])`, where it declined.
  (8) `Append`'s signature is `(collection<any>, any+)`; `OPERATORS.json`
  was edited by hand for the entries of this item (a full regeneration
  changes 87 unrelated lines; the file was already out of date).
- **The compiler side.** A declaration that names `missing` declines (the
  type comes from `ce.declare`, which throws, or `Typed`, an error
  expression). An out-of-range read of a point list gives a `NaN` point in
  JavaScript (`_SYS.atPoint`/`atPointNoWrap`, chosen from the element type,
  no run-time type test) and Python. `hostPointRead()` (a wrapper of a
  host's `At` handler) was written and removed: Tycho changes its handler
  instead. Kept for step 4, row 2: `compile-absence.ts` and
  `absent-tuple-read.ts`, which a declared absent input reached and which now
  serve only inferred types and producers; the `point` axis added to
  `CompileTarget.absence` joins them.
- **The corpus measure** (Tycho frozen at `44a25d4e3`, plus a copy whose `At`
  handler emits `_SYS.atPointNoWrap` as Tycho will at adoption; the tools of
  3.4.1 with records keyed by MathJSON; base: the 3.4.1 run `new3`, whose
  source equals `585acfab5`). Without the handler change: 175 values in 23
  records threw (njncrg9fkv, 2ki2hjsouf, mavxszbvzk), all in Tycho's own
  `At` handler; they are changes at adoption. With it: 17,655 records
  (17,690 at the base: 35 records that declined at the base are no longer
  submitted by Tycho, digxkh3uk8 and euwzbzyrhn `m(P,1,1)` error inputs,
  uussbs3e0g `D_0(i)`, 2ki2hjsouf, epq7yidtim; Tycho checks at adoption that
  those rows draw); 77,130 values compared, no new throw. Declines:
  javascript 66 → 44, glsl 47 → 47, interval-js 90 → 70 (mostly the
  records no longer submitted); 2 rows that declined now compile
  (2ki2hjsouf `0.7C[C_{i}]+A_{xisPos}`, epq7yidtim
  `0.4(N_n(u))[A_n+1]+…`); 1 new decline, neyret/po7rdhtoth
  `asOklab(c_d)`, from Tycho's own `ce.declare('c_d', 'list<color |
  missing>')` (Tycho site (a)). Values: 131 values in 31 records changed,
  each of the expected kinds: 29 records `undefined` → a `NaN` point (a
  false restricted point: 91lvyfqcdd, bpnkluuy7y, lrfx01y3cv, n7uhaaoq1q,
  njncrg9fkv, skz0syspxp, b0mdkqnyra, epq7yidtim; an out-of-range point
  read: epq7yidtim `[…][H_{ighDetail}]` and two more), gy1wdjvm2a and
  u1bpof8xfg `join(…)` (their `undefined` slots → `NaN` points), and
  lizeqlnn5e (`Length` of an out-of-range point read is now 2, the length
  of the `NaN` point, which the interpreter also gives). No other value
  changed. The last measure ran before the final fix (a quadratic walk
  replaced by a memoized one in the declaration check), which changes no
  value.
- **Code lines** (not blank, `//` or `*`): `library` 77,903 → 78,052,
  `boxed-expression` 83,962 → 84,247, `common/type` 14,680 → 14,652,
  `compilation` 92,419 → 92,785. Source: 85 files, 2,949 insertions, 1,460
  deletions. Tests: 201 files changed (4,028 insertions, 6,005 deletions),
  none deleted, one new file `test/compute-engine/missing-result-only.test.ts`
  (1,518 lines); about 196 test files were migrated (a declaring test moved
  to a producer or to one assertion of the static error); no snapshot
  changed.
- **Review**: Claude and Codex, four rounds (the fourth on the user's two
  decisions only, after two rounds in a row found a new high finding in the
  fixes of the round before; the user chose the simple sound design). Fixed:
  round 1, the readers did not read a `NaN` point (high), routes of a
  coordinate read that disagreed, the `NaN` point at a point parameter,
  `Norm`/`Dot`/`Distance` types, a default ignored by the always-absent
  typing, a comparison proved `True` over a read, the declaration check of
  nested signatures, comments; round 2, a point parameter mapping over a
  `NaN`-point cell (high), compiled default fills and `AssertPresent` of a
  point (the static proof), a signature default; round 3, the static proof
  again (two high findings), a literal default before the `Missing`
  short-circuit, the operator-backed lambda route; round 4, a partial
  application over `Missing`, a point default in a compiled point-list call,
  comments, one `nanPoint()` helper. Not reviewed: the round-4 fixes and
  the last fix (the memoized walk of `declaredTypeNamesMissing()`, found by
  the full suite as a hang: a chain of 20 aliases cost about 5^20 steps).
  Not fixed, each `crafted`: an untyped parameter `p = O` in a direct call
  over a list of points does not fill a `NaN` point while `Map` with the
  same function does; `Reverse(If(0 < t, L))` gives `Missing` with `t` free
  (older code, the same at `585acfab5`).
- **Checks** on the final tree: typecheck, lint, `check:deps`, the full
  suite (1,800 suites, 77,844 tests, 0 failed), `npm run test:python` (2,959 tests, 0 failed, on the tree
  before the last fix, which touches no compiled code), the corpus measure
  above. `compile-three-valued-connectives.test.ts` takes this item's
  version over the nightly fix `19d1c6e6f`: that fix rewrote two Python
  tests over symbols declared `number | missing`, a declaration that is now
  an error; this item's version keeps the same `And`/`Or` cases over `real`
  symbols.

What 3.4.3 (the error model, options page 2) needs from this item: (1) the
dynamic non-value of each domain is now `NaN` for a number, the `NaN` point
for a point and `Missing` otherwise; `Indeterminate` folded into `NaN` adds
no new kind. The readers read `NaN`, a `NaN` point and `Missing`; their
library descriptions (`IsMissing`, `Coalesce`, `AssertPresent` in
`library/core.ts` and `OPERATORS.json`) still name `Indeterminate`, which
3.4.3 removes. (2) The precedence of the aggregates is an error, then
`Missing`, then `NaN` (`Max(NaN, Missing)` is `Missing`); with
`Indeterminate` folded, `Mean([1, Indeterminate])` is `NaN`. (3) `Nothing`
is untouched here; a `Missing` cell and a `Nothing` element are distinct.
(4) The compiled `point` axis of `CompileTarget.absence` and the
`NaN`-point readers stay; step 4, row 2 (absence) can fold the absent-input
code into them.

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
