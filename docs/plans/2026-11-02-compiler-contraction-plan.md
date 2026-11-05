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

3.4.3 **The error model** (options page 2, option A). Staged 2026-11-03,
session compute-engine-0f, base `96c72fb73`, not committed (the record is at
the end of this item). One static error (`Error`), one dynamic non-value per
domain (`NaN` for a number, the `NaN` point for a point, `Missing`
otherwise), and `Nothing` only as the value of an empty block or of a
statement with no value (`docs/ERROR-MODEL.md`, section "One static error,
one dynamic non-value per domain — user decision of 2026-11-02").
`Indeterminate` is no longer a value: the exact route gives `NaN` (`0/0`,
`∞−∞`, `0^0`, `Mod(5, 0)`, `Variance([3])`, `Mean([1, 0/0])`,
`Max(1, 0/0)`), and the word is an input spelling of `NaN` (MathJSON,
`\operatorname{Indeterminate}`, Epsil, `NumberFrom`, the type grammar); the
serializer writes `NaN`. `Nothing` is kept as an element wherever it
appears, with no splice, no `Map` bypass, no `Filter` drop, no aggregate or
statistics skip, no covariance row skip and no view policy; an operator
that needs a value gives its ordinary `incompatible-type` error.

- **The two table rows of options page 2, under the text of the decision**
  (no static error): `Map(x ↦ (x > 1 ? x : Nothing), [1, 2])` is
  `[Nothing, 2]` (it was `[2]` after construction); `Sum` over that view
  is an `incompatible-type` error at the `Sum` (it was `1`). The table of
  page 2 is corrected to these values.
- **Tycho's answers** (tycho-f9, 2026-11-03, a reading of Tycho main, no
  tests run). (a) `Indeterminate`: no Tycho reader or builder produces,
  tests or builds it; two name sets list it
  (`plot-core/classification-shape.ts` 196, `SCALAR_SYMBOLS`;
  `graph-paper/onboarding/handoff-names.ts` 121) and become dead. `Nothing`:
  read as "no value" in name sets, refusals, two argument filters and type
  tests `t.is("nothing")` (still valid: the type is unchanged); produced in
  `spacing-nodes.ts` 55 (an `InvisibleOperator` left with no operand) and
  `binder-definition-inline.ts` 311/458 (an internal placeholder, not traced
  to CE); no Tycho site depends on the splice, the `Map` bypass, the
  `Filter` drop or the aggregate skip. Two Tycho sites depend on the old
  parse outputs: `classification-entry-fold.ts` 500–531 drops the `Nothing`
  hole of `(3,,4)` and reads the point (3, 4) (a deliberate leniency, pinned
  by two Tycho tests); after this item that row shows a parse error, and
  Tycho removes the drop and the two tests at adoption.
  `classify-formula.ts` 1215 and `normalize-restrictions.ts` 79/236 accept
  the old parse of a trailing comma in a piecewise; the new parse is already
  accepted. (b) The corpus (103 Desmos states, 585 neyret states, 8,387
  LaTeX strings) has no empty slot and no trailing comma in a piecewise
  (control: 1,068 piecewise and 5,915 parenthesized strings); Tycho's own
  showcase and user documents were not scanned.
- **Choices beyond the rule, each reversible.**
  (1) The trailing comma in a piecewise gives the parse of a piecewise with
  no default, which is `Which(c, v)`, not `If(c, v)`: the rule said "parses
  as `If(c, v)`, as with no default", but the parse with no default is
  `Which(c, v)` today (`\{x>0: x,\}` was already `Which(0<x, x)`). Making
  every piecewise with no default an `If` changes 1,068 corpus piecewise
  strings and is not part of this item. In `cases`, an empty row and a
  trailing comma in a condition cell give the same parse.
  (2) An empty `Sequence()` stays `Sequence()` in canonical form (it was
  `Nothing`) and prints as `Sequence()`; a list or an argument list splices
  it. Witness `plausible`: the Epsil idiom `[h, ...t]` with `xs = [t]`
  (`test/epsil/while-let.test.ts`) ended because the empty rest was
  `Nothing`, which the list removed; with `Nothing` kept, the loop did not
  end. The alternative, `Sequence()` → `Nothing`, breaks the idiom.
  (3) One check in `nonNumericOperandError()` and one in
  `processMinMaxItem()` read the symbol `Nothing`, because the type
  `nothing` passes the numeric test: without them `Multiply(2, y)` with
  `y := Nothing` stays inert while a string gives an error, and
  `Max([NaN, Nothing])` gives `NaN` where an error must outrank `NaN`. The
  alternative is no check (the inert form and `NaN`).
  (4) A default value of `Nothing` stays refused, with the reason "the value
  of an empty block, not an argument value".
  (5) The type of `[1, Nothing, 3]` stays `list<integer>` (the type
  `nothing` is untouched), so `Filter([1, Nothing, 3], x ↦ True)` gives an
  `incompatible-type` cell for `Nothing` (witness `crafted`).
  (6) An empty slot `(3,,4)`, `[3,,4]`, `f(3,,4)` holds `["Error",
  "'missing'"]`, the parser's error for a missing operand; a trailing comma
  `[1,2,]` is dropped; an empty last cell before `\end{bmatrix}` is
  dropped, as before `\\`; an empty `Log` base (`\log_{}(x)`, `\log_{ }(x)`)
  is no base.
  (7) `ArithmeticDefinition.isExact` (public API) is marked `@deprecated`:
  it chose between `NaN` and `Indeterminate`, and the engine no longer reads
  it. Its removal is proposed to the user, not done.
  (8) `Slice(xs, Nothing)` → `Nothing` stays: it makes a failed search
  `Slice(xs, RangeOf(xs, needle))` give `Nothing` (user decision of
  2026-08-16, `test/compute-engine/sequence-search.test.ts`). It is a
  `Nothing` handler against the new rule. Decided 2026-11-04: a failed
  search gives `Missing` and the handler goes (ROADMAP CE-802).
- **GitHub issue #355** (the origin of `Indeterminate`): the comment for the
  release is `docs/plans/2026-11-03-issue-355-comment.md`. At the release
  the user runs, in this repo,
  `gh issue comment 355 --body-file docs/plans/2026-11-03-issue-355-comment.md`.
  It says that the exact and the float no-values merged back into `NaN`,
  that the spellings still parse, and why.
- **The compiler side.** No compiled code changed (two comments in the
  bigint lane). Compiled code already gave `NaN` for every exact form with
  no value; a list literal with a `Nothing` element, an aggregate over one
  and a `Map`/`Filter` whose callback may give `Nothing` already declined,
  and still decline. The refusals "when source element types admit
  omission" and the omission tests of callback results stay for step 4,
  row 7.
- **The corpus measure** (Tycho frozen at `44a25d4e3` with the `At` handler
  of 3.4.2 patched to `_SYS.atPointNoWrap`, the copy that 3.4.2 used; the
  tools of 3.4.1 with records keyed by MathJSON; base: a new run on
  `a7d3fb979`, the base of the change at the time of the measure, since
  CE-791 changed compiled code after 3.4.2's run). 17,655 records and
  17,835 compiles in both runs. Declines: javascript 44, glsl 47,
  interval-js 70 in both runs; no new decline and none removed. Values:
  77,138 values in 13,719 keys compared, none changed. 9 records changed
  their key only: the compiled expression held `Indeterminate` (Tycho
  receives the exact `0/0` of a Desmos `undefined`) and now holds `NaN`
  (neyret documents with `\operatorname{Indeterminate}` in a piecewise arm,
  a `PointList(0, Indeterminate)` separator and a `join` of
  `[Indeterminate, …]`); their 36 values are equal. No `Nothing` element
  reached a compiled record. Tycho main now has its build-only-`If` commit
  `6599982fe`; the measure kept `44a25d4e3` so that the base run of the
  3.4.2 copy could be compared.
- **Code lines** (not blank, `//` or `*`; base `a7d3fb979`): `library`
  78,052 → 77,707, `boxed-expression` 84,247 → 83,775, `common/type` 14,659
  → 14,625, `latex-syntax` 25,832 → 25,843, `numerics` 23,133 and
  `compilation` 92,790 unchanged (round-1 and round-2 fixes not counted).
  Source: 93 files, 838 insertions, 2,575 deletions;
  `boxed-expression/nothing-erasure.ts` deleted. Tests: 121 files changed,
  one deleted (`erasing-literal-numeric-request.test.ts`, 13 tests that
  pinned the erasure under `.N()`); the blocks of `indeterminate.test.ts`
  that pinned the distinction of the two values were deleted (1,724 → about
  760 lines), and erasure-only tests were deleted in the `Nothing` files
  (aggregate 41, statistics 8, filter 4, and others); 7 inline snapshots
  changed (5 parser outputs, 2 `Sequence()`), about 38 inline snapshots
  `Indeterminate` → `NaN`; none marked `@fixme`.
- **Review**: Claude and Codex, three rounds. Round 1 (9 findings): `Sum([Nothing])`
  returned `Nothing`, `Max([NaN, Nothing])` returned `NaN`, an empty `cases`
  row added a `Nothing` default, a trailing `&` made a matrix ragged
  (`plausible`), a `Nothing` default refused with a wrong message, comments
  of the erasure, the `isExact` hook, the display of `Sequence()`, dead
  conditionals. Round 2 (5 findings, one from both): an empty `Log` base
  with a space, three comments, the deprecation of `isExact`. Round 3
  (Codex, on the `Log` fix): no finding.
- **Checks** on the final tree: typecheck, lint, `check:deps`, the full
  suite (1,801 suites, 77,705 tests, 0 failed, at `96c72fb73`), the corpus measure above (run before the review
  fixes, which change no compiled code). `npm run test:python` was not run:
  no compiled code changed.

What 3.4.4 (block locals, options page 4, option A′) needs from this item:
(1) `Nothing` is only the value of an empty block or of a statement with no
value, and no list or argument removes it any more: `Block()` is `Nothing`
and `[1, Block()]` is `[1, Nothing]` (it was `[1]`). Today a block that ends
in an assignment gives the assigned value (`Block(Assign(b, 2))` is `2`);
under A′ an assignment is a statement, so if 3.4.4 gives such a block the
value `Nothing`, that value is kept where the block is used. (2) An empty
`Sequence()` is no longer `Nothing`: a rest capture of an empty list keeps
its value through a variable, so a block that returns it returns
`Sequence()`. (3) The compiler's `Nothing` refusals and omission tests stay
for step 4, row 7, and the absent-value code for step 4, row 2.

3.4.6 **The complex lane** (options page 6, option A in its strict form).
Staged 2026-11-03, session compute-engine-ee, worked on base `2341d6f31` in
parallel with 3.4.3, delivered onto `aee059e66` (3.4.3) and staged on
`7f36a72d2`, not committed (the record is at the end of this item).
`strict` is the only discipline and the default of
every target; `mode: 'auto'` declines with `unsupported-mode`; the
`promoted` and `escalation` result fields go; `mode: 'complex'` and
`mode: 'bigint'` are unchanged; in the real lane an operation whose exact
value is complex gives the target's `NaN`.

- **Tycho's answers** (tycho-f9, 2026-11-03, a reading of Tycho main and of
  its last codegen audit, Tycho `58b767d19` on the CE 3.3 build). (a) The
  change from `mode: 'auto'` to `mode: 'complex'` is not on a Tycho branch
  or commit yet; Tycho makes it at adoption. The sites:
  `samplingModeOptions()` in `src/plot-core/ce-module-registry.ts` (about
  line 602, return type at 600; read by `src/plot/ce-compile.ts` and
  others), and the colour lane, three `mode: "auto"` literals in
  `src/graph-paper/graph/style-expressions.ts` (about 2168, 2386, 2462 in
  `44a25d4e3`). Two cache keys hold the string `"auto"` and change with
  them, with no effect on a compile (`src/plot-core/compiled-body.ts`
  about 3424, `src/plot/series/implicit-series.ts` about 2156). (b) The 9
  documents with `promoted: true` (12 records, all `javascript`, requested
  `auto`, result `complex`): showcase/cie-chromaticity, art/dlxysxelnj,
  art/guvicl57aa, art/lrhjtkkyls, art/s8ishknvhe (2 records),
  art/sqpmxjhvts (2 records, broadcast), art/tpalesypcc,
  neyret/hbvzf9yk1r (broadcast), neyret/wsne0l2tcv. The only sources of
  `mode: "auto"` in Tycho are the sites of (a), so each record comes
  through one of the two routes, which both become `complex`; Tycho did not
  trace which route each record takes. Tycho asked to receive the record of
  any of the 9 that changes value or declines under `complex`.
- **The corpus measure** uses the frozen Tycho `44a25d4e3` with the `At`
  handler of 3.4.2, and the four `mode` sites and the two cache keys of
  (a) patched to `complex`.
- **The assumption of options page 6 (Tycho's change from `auto` to
  `complex` keeps its values) is false on CE `2341d6f31`.** The adoption
  alone changes values on the base (measured 2026-11-03, Tycho `44a25d4e3`:
  CE `2341d6f31` with Tycho on `complex`, run `base-cx`, compared with the
  3.4.2 final run, Tycho on `auto`; the value key holds the compile
  options, so the 447 records whose mode changed were paired by LaTeX and
  target: 3,576 values compared). Under `auto`, 467 of Tycho's 485 `auto`
  records compiled in `strict` (no promotion), 12 in `complex` (the 9
  documents) and 6 declined. Under `complex` every one of them compiles in
  complex mode, which lifts a parameter typed `number` to a complex object,
  and 64 values in 6 documents change (first counted as 11 records of 8
  documents: the pairing by LaTeX joined `asOklab(h)` and `asOklab(g)` of
  two documents each; neyret/vivplujz8i and neyret/wsne0l2tcv have no
  changed value): neyret/crmswfhqrd
  `g(x)=\frac{a}{100}(f(x))^2` with `f(x)=\sin(bx)`, 0.4627 → `NaN` (8
  values); the colour lane `asOklab(…)`, a real colour → an oklab colour
  of `NaN` channels, in neyret/l49l5stdag (8 rows, 36 values),
  neyret/4d9knkydej (7 values) and art/hyvhlz4chj (8 values);
  art/hltzcphymj `0^{x+y-z}` (4 values), `Infinity` →
  `{re: Infinity, im: Infinity}`; neyret/woeywky0kj, `NaN` points → complex
  `NaN` objects (1 value, at `N = 0`; no value in either case). One new decline: art/ur34gk3p8x
  `asOklab(c_2)` ("a point with a complex-valued coordinate"). No other
  value of the 9 promoted documents changed. These are defects of
  `mode: 'complex'` with `corpus` witnesses; choice of this item (reversible,
  reported to the user 2026-11-03): they are fixed here, so that Tycho's
  change from `auto` to `complex` keeps its values. The other options were a
  ROADMAP entry per defect with the values changed at adoption, or `strict`
  for Tycho's colour lane (which keeps the 467 `strict` values but gives
  `NaN` or a decline in the colour records that promoted).
- **Which documents are complex-mode** (tycho-f9, 2026-11-03, read from
  the `graph.complex` flag of the Desmos states): neyret/crmswfhqrd and
  art/hltzcphymj only; the other 7 are real-mode documents, and each of
  their changed records comes through the colour lane (`samplingModeOptions`
  gives `strict` in a real-mode document). The colour lane uses `auto` for
  the domain colouring of art/guvicl57aa (D-263), itself a complex-mode
  document. **The split, measured** (run `base-split`, CE `2341d6f31`, Tycho
  `44a25d4e3` with the colour lane at
  `isDocumentComplexMode(ce) ? "complex" : "strict"` and sampling as in
  (a)): no new decline; 12 values in 2 records change, both in the
  complex-mode documents (crmswfhqrd `\frac{1}{100}af(x)^2`, 8 values;
  hltzcphymj `0^{x+y-z}`, 4 values); the colour records of the real-mode
  documents keep their values. So at adoption Tycho can use the split, and
  the colour lane of a real-mode document then needs no change in CE; the
  defects of `complex` mode are fixed in CE in either case.
- **The candidate measure** (runs `cand-cx` and `cand-split`: the removal
  of `auto` on base `2341d6f31`, before the fixes of `complex` mode,
  compared with `base-cx` and `base-split`, the same Tycho on each side).
  Values: none changed (77,210 and 77,218 values compared). Declines:
  javascript and glsl unchanged; interval-js 70 → 74, all on rows that Tycho
  did not submit at the base: neyret/hbvzf9yk1r `\sin(\Re(Z))=0` and
  `\sin(\Im(Z))=0` (no interval lowering of `Real`/`Imaginary`). The rows
  are submitted now because Tycho reads the removed `promoted` field
  (`src/plot/ce-compile.ts`, about 11 sites, and `src/plot/resolve-fn.ts`
  523, 1118, 2258 at `44a25d4e3`) to keep a promoted row on its scalar CPU
  route and to give it no interval band. Without the field, these rows also
  compile for `glsl`, in `strict`, whose values the audit does not sample.
  Tycho needs a replacement at adoption. tycho-f9 (2026-11-03) put three
  options to the user, no choice yet: (A) `result.mode === 'complex'`, no
  GPU or interval leg for any row of a complex-mode document (safe; real
  rows of those documents draw more slowly); (B) Tycho compiles a row of a
  complex-mode document in `strict` first, uses the GPU and interval legs
  only when that succeeds, and else compiles `complex` for the CPU route
  (one extra compile per row, no CE change); (C) CE reports whether the
  kernel is complex, a new result field and a CE decision. 3.4.6 does not
  wait for it: A and B need only `mode` from CE. The user chose B
  (relayed by tycho-f9, 2026-11-03). B assumes that `strict` declines where
  a row needs complex values; measured on the candidate the same day, it
  does not: with `x: real`, `\sqrt{x}^2` at `x = -4` compiles in `strict`
  and gives `NaN` (`complex` and the interpreter give `-4`; `glsl`
  compiles too), as the new caveat says; `\ln(x)` at `-2` is `NaN` too. A
  complex literal is complex by its static type, so `\sin(\Re(x+iy))`
  gives the same value in `strict` and `complex`. Tycho's 12 promoted
  records are of the first kind, so B needs a second test on Tycho's side
  (sent to tycho-f9: compare the two compiles on samples, or Tycho's own
  test for an unknown-sign radical or logarithm, or option A). **The user
  then chose A** (relayed by tycho-f9, 2026-11-03): at adoption every row
  of a complex-mode document compiles in `complex` and is drawn on the CPU
  only; a real-mode document compiles in `strict` with all its legs, which
  is the split measured above (its colour lane included). Tycho reads the
  document's complex mode or `result.mode === 'complex'`; nothing new is
  needed from CE. Cost (Tycho's audit on CE `2341d6f31`): 32 of 688 Desmos
  states are in complex mode; 24 rows of 17 documents lose a GLSL leg and
  18 an interval leg; Tycho renders those 17 documents before and after at
  adoption.
- **Code lines** of `compilation` (not blank, `//` or `*`): 92,785 →
  92,665 for the removal of `auto`, before the fixes of `complex` mode.
- **The causes** (diagnosis 2026-11-03, each reproduced in plain CE except
  the second mismatch of hyvhlz4chj). In each, the lane analysis
  (`isComplexValued` and its helpers) and an emitter disagree, so a
  `{re, im}` object reaches real code and gives `NaN` or a string:
  (A) `Power` of a base that is complex under a node type that is real
  (`_isComplexValuedFunction` answers from the type; the emitter reads the
  base): crmswfhqrd, 8 values; (B) the element lane of an element-wise head
  (`operandElementLane` says real for `10^i` over a list; the element
  closure emits `_SYS.cpow`): l49l5stdag, 36 values, and `Sqrt(Power(L, 2))`
  with `L: list<real>`; (C) `Sqrt`/`Ln`/`Log` of a wide type (the analysis
  says complex, the emitter keeps `Math.sqrt`): 4d9knkydej, 7 values; (D) a
  complex argument at a call of a user function whose definition reads the
  parameter on the real lane (`realProjection` converts only at a declared
  real parameter): hyvhlz4chj, 8 values; (E) the `Product` fold over a
  shared `Map` (`foldLaneIsComplex` lacks the wide-element rule of
  `collectionFoldsReal`): no corpus record, `plausible`
  (`Sum(Map(f,P)) + Product(Map(f,P))` with `P: list<real>`,
  `f(t) := t^2`, gives `NaN` for 50). Not defects: hltzcphymj
  (`{re: Infinity, im: Infinity}` is the complex lane's `~oo`, the
  interpreter's value), woeywky0kj (no value in either case), the decline
  of ur34gk3p8x (a wide coordinate counts as complex and forces an inlining
  that is refused). The `_SYS.eq` call of l49l5stdag is not a cause.
  **Decision (user, 2026-11-03):** A, B, C and E are fixed in this item; D
  is a ROADMAP entry with its witness, fixed before the language release.
  Tycho's split never reaches D, and with the split only A is in the corpus.
- **The measure after the fixes of A, B, C and E** (runs `fix-cx` and
  `fix-split`, compared with the 3.4.2 run where Tycho uses `auto`, 3,576
  values of the 447 records whose mode changed). With the split: 12 values
  differ, all within the caveats (hltzcphymj `0^{x+y-z}`, `~oo` written
  `{re: Infinity, im: Infinity}`, 4 values; crmswfhqrd
  `g(x) \text{ where } b \coloneq 1`, `NaN` → `{re: NaN, im: NaN}`, no
  value in either case, 8 values); crmswfhqrd `\frac{1}{100}af(x)^2` has its
  `auto` value again. With every route on `complex`: 28 values differ:
  the 12 above, woeywky0kj (1, no value in either case), hyvhlz4chj (8,
  cause D, CE-751.1) and 4d9knkydej `asOklab(g)` (7, still `NaN`
  colours: after fix C the definition is real and right, and the call
  lifts an element of a `list<number>` with `_SYS.cplx` for a parameter
  that the definition reads on the real lane, which is cause D, CE-751.1). l49l5stdag has its `auto` values again. One new
  javascript decline with every route on `complex`: neyret/51a4237846
  `f(f(f(f(f(f(f(f(f(P)))))))))`, a timeout of Tycho's audit (5,483 ms,
  4,882 ms at the base). Code lines of `compilation`: 92,748.
  The full suite on the worktree: 33 tests failed in 12 files.
- **What the full suite and the timeout were.** 31 of the 33 tests pinned
  the removed behavior (a request for `auto`, promotion under the default)
  and were moved to `mode: 'complex'` or to the strict `NaN`. 2 were a
  defect of this item: the quadrature helper `withComplexAtNaN()` kept a
  complex sample with a `NaN` part, so `∫₀^∞ x^{100} e^{-x}\,dx` lost its
  log-space sample (`1.06e+113` for `100!`); it now keeps a complex sample
  only when it is a number. The timeout of 51a4237846 was the closure
  question of fix B running in `strict` too; it now runs in `complex` only
  (`_operandElementLane()`), and the row compiles in the time of the base.
  `derived-substreams.test.ts` "NIntegrate derives one too" draws 32
  samples (one pass) where it drew 64: its samples are `NaN` (a `NaN` real
  part) and no longer complex numbers; the value is `NaN` before and after.
- **Decisions in this item, each with its alternative.** (1) `CompileMode`
  is `'strict' | 'complex' | 'bigint'`; the option check still accepts the
  string `'auto'` so that the request declines with `unsupported-mode` and
  a message that names `'complex'` (the other option: keep `'auto'` in the
  type as a value that is always refused). (2) The engine's own
  compilations stay in `strict`: the `Map` drain and the `Reduce` fast path
  compute a `NaN` element again with the interpreter, a quadrature
  integrand is compiled in `complex` at its first `NaN` sample
  (`withComplexAtNaN()`), and stochastic equality uses the compiled kernel
  only for an expression whose every head propagates `NaN` (an allowlist:
  arithmetic, powers, roots, logarithms, rounding, `Max`, `Min`, the
  trigonometric and hyperbolic functions and their inverses, without
  `Arcsec`, `Arccsc` and `Hypot`), else the interpreter samples it; the
  other option, `complex` for every internal compilation, broke a `solve`
  test (complex `tan(arctan(a))` at `a = 10^5` is off by 0.008). (3) In
  `complex` mode the negation of a real value keeps a `+0` imaginary part,
  so `Ln(-x)` at `x = 2` is `ln 2 + iπ` (it was `ln 2 − iπ`; `auto` never
  compiled it in complex mode). (4) A random node shared by two positions
  declines only in `complex` mode (its guard is a complex-lane guard); in
  `strict` it compiles and draws once per position, as the interpreter
  does. (5) A fold whose lane is complex lifts its seed, so an empty or a
  one-element list gives the complex shape (`Product(Map(Sqrt, P)) + 1` is
  `2` at `P = []`). (6) The table of options page 6 is wrong in one row:
  `h(P[1])` with `P: list<tuple<complex, real>>` declines with
  `lane-mismatch` in `strict` (the parameter is not inferred complex); it
  compiles with `mode: 'complex'` or an annotated parameter.
  `docs/COMPILATION-MODEL.md` states the measured behavior.
- **Not fixed in this item.** Cause D (CE-751.1, user decision): fixed
  after this item, before the language release, in commit `eeee8e574`
  (session compute-engine-e4, 2026-11-03, base `609d496ee`). Each
  JavaScript definition records the lane of each numeric parameter in its
  lane record (`recordUserFunctionParamLanes`, compile-lanes.ts), and the
  call (`emitUserFunctionCall`, compile-user-calls.ts) converts a complex
  argument for a parameter that the definition reads on the real lane with
  `_SYS.crealElements` (the real part when real, `NaN` otherwise): a
  conversion, not a decline. The cause: the parameter symbol is narrowed
  by its use (`x` in `Floor` becomes real), so the body is real while the
  signature type stays `unknown` and the caller lifts the argument. A
  parameter that binds a collection whole has no lane (review finding:
  `f([1 + i·t, 2])` gave `NaN` instead of `2 + 4i`). Measure (base runs on
  `609d496ee`, the frozen copies above): on the complex routes one key
  changed, `asOklab(g)` of neyret/4d9knkydej, 8 values from `NaN` channels
  to the real colours of the `strict` code of the same row (equal exactly);
  no other value changed (77,236 compared); on the split no value changed
  (77,244); declines unchanged, no new decline. Code lines of
  `compilation`: 92,763 → 92,820. The second mismatch of art/hyvhlz4chj
  (`asOklab(c_{lavinga})`, still `NaN` at 8 of 8 samples) is not cause D:
  cause D is converted there, but the function returns
  `[_SYS.ccos(…), _SYS.csin(…)]` and the inlined `Dot`
  (`compileStaticInnerProduct`) multiplies those elements with the real `*`;
  it is ROADMAP CE-793 (ready, wrong value, S, corpus witness, no plain
  program yet); Tycho's adoption (the split) does not reach it. CE-793 was
  fixed in `4d9f6cab1` (2026-11-03, session compute-engine-7c): the cause
  was the lane of the block local `θ`, not `Dot`. In mode `complex` the
  lane of a block local is now its static type, and a value computed on the
  complex lane is converted to its real part (`NaN` when not real) at each
  binding of a real local; option B (a real start only when every binding
  is the declared value or a top-level assignment) is the alternative. In the
  default mode, `Gamma(s, z)` with `z: real` at `z = -1` gives `NaN` where
  the interpreter gives `e` (as `strict` did before): a known-limitations
  line marked `plausible?`. CE-751 (decision (a), 2026-11-01) relies on the
  restart that this rule removes; its entry says so.
- **The final corpus measure** (runs `m-cx` and `m-split` on the combined
  tree, `aee059e66` plus this item, Tycho `44a25d4e3` with the `At` handler
  of 3.4.2). Against the runs of this item on `2341d6f31`: no value changed
  (77,051 and 77,164 values). Against Tycho on `auto` (3,584 values of the
  re-keyed records): with the split, which is Tycho's adoption (option A),
  12 values differ, all within the caveats (above); with every route on
  `complex`, 28 (the 12, cause D 15, woeywky0kj 1). Declines with the split:
  javascript 44 → 43, glsl 47, interval-js 74 (the 4 new are hbvzf9yk1r,
  above, which Tycho's option A keeps off the interval route); with every
  route on `complex`, one new javascript decline, art/2ki2hjsouf
  (`scalar arithmetic over a list-valued operand`); it is not separated
  from the commits of `aee059e66` (3.4.3, CE-791, CE-792), and Tycho's
  adoption does not compile that row in `complex`.
- **Code lines** of `compilation` (not blank, `//` or `*`): 92,785 → 92,748
  on the base `2341d6f31` (before the review fixes); 92,790 → 92,763 on
  `aee059e66`. Source: 39 `.ts` files (one deleted, `auto-escalation.ts`);
  tests: 75 files, 2 of them new (`compile-mode-auto-removed.test.ts`,
  `compile-complex-lane-agreement.test.ts`), none deleted (about 12 tests
  removed); `benchmarks/python-performance.py`, which a test writes, now
  emits `np.sqrt` (the default is `strict`); one inline snapshot changed
  (`item-284-derivative-compile-cost.test.ts`, the default emits the real
  jets).
- **Review**: Claude and Codex, three rounds. Round 1 (both): the
  stochastic equality confirmed `Imaginary(Sqrt(x)) = 0` (high, Codex),
  the seed of a widened fold (medium, Codex; its example was right, the
  defect was a fold of type `complex` over an empty or one-element list),
  four comments and the `supportedModes` check (Claude). Round 2 (Codex):
  the round-1 fix missed `Coalesce` and user function bodies (two high);
  replaced by the allowlist. Round 3 (Codex): no finding. Claude stopped
  after round 1 (low and nit findings only).
- **Checks** on the combined tree (`/tmp/wt-compute-engine-ee-346m`, byte
  for byte the files staged): typecheck, lint, `check:deps`, the full suite
  (1,803 suites, 77,587 tests, 0 failed), the corpus measure above; on the
  main tree after the delivery onto `7f36a72d2` (whose commit changes only
  the group-theory library and `numerics/modular.ts`): typecheck and 7
  targeted files. Python execution tests ran on the worktree for the
  changed Python files (189 and 519 tests, 0 failed), not on the combined
  tree.
- **Tycho at adoption.** Option A (above); its sites of `mode: 'auto'`
  become `'complex'`; its 14 readers of `promoted` read the document's
  complex mode or `result.mode === 'complex'`; Tycho renders the 17
  documents that lose a GLSL or interval leg.

What step 4, row 6 (the complex-lane contraction) needs from this item:
the dead code it removes is now unreachable or written and never read:
`CompilerState._promoted`, `notePromoted`, `recordPromotion`,
`promotedDefinitions`, `hasPromotedDefinition` and their accessors in
`base-compiler.ts`, with their save and restore sites in
`compile-folding.ts`, `compile-statements.ts`, `compile-folded-values.ts`,
`compile-complexness.ts` and `compiler-core.ts`; `CompileTarget.reset` and
its contract check; the `'auto'` entry of `COMPILE_MODES` once the decline
message is no longer wanted; the promotion of unknown-sign radicals in
`compile-complexness.ts` is used only by `mode: 'complex'` now. The lane
recording per definition (`recordUserFunctionLane`,
`_userFunctionLanes`) is still read by the GPU target and by the pruning,
so row 6 measures it before it removes it; cause D (CE-751.1) needs the
lane of each parameter of an emitted definition, which is close to that
recording, so row 6 and CE-751.1 should be planned together.

What 3.4.4 (block locals) and 3.4.5 (function values) need from this item:
the lane of a local and of a parameter now follows its static type only,
in `strict`; the complex half of the local shape frames (options page 4)
is a lane chosen once from the declared or inferred type, with no record
of a complex value that reaches a real binding and no restart. By the rule
(not measured in this item), a local assigned a complex value in one
branch and a real value in another has a type that is not complex, so in
`strict` its complex branch gives `NaN` (within the new caveat) or
declines, and in `complex` it is complex; 3.4.4 measures it. A
function value or callback (3.4.5) whose parameter is untyped is complex
in `complex` mode and real in `strict`; a call that sends a complex
argument to a definition compiled real is cause D (CE-751.1).

Where the measure of this item is, for the items that rerun it (CE-751.1
and step 4, row 6; written 2026-11-03, the paths are the scratchpad of
session compute-engine-ee and last as long as that folder does):
`E = /private/tmp/claude-501/-Users-arno-dev-compute-engine/1431b070-f8b4-4dfd-9f14-4f617b31990d/scratchpad`.
The frozen Tycho copies, `git archive` of `44a25d4e3` with Tycho's
`node_modules` and `_TASK` linked: `$E/tycho-snap-cx` (the `At` handler of
3.4.2, and every `auto` route, the four `mode` sites and the two cache keys,
on `complex`) and `$E/tycho-snap-split` (the same, with the colour lane on
`complex` only in a complex-mode document, Tycho's adoption). The runs:
`$E/audit/<label>.json`, `<label>-digest.json`, `<label>-values.json` and
`<label>.log` for `base-cx`, `base-split`, `cand-cx`, `cand-split`,
`fix-cx`, `fix-split`, `m-cx` and `m-split`; `m-cx` and `m-split` are the
final runs on `aee059e66` plus this item. The command, under the box lock,
about 5 minutes a run: `AUDIT_OUT=<folder> TYCHO_SNAP=<copy>
~/.claude/tools/ce-census/value-audit.sh <CE worktree> <label>` (it makes
the production build itself), then
`node ~/.claude/tools/ce-census/compare-values.mjs <base-values.json>
<head-values.json>` for the values and `compare.mjs <base.json>
<head.json>` for the declines.

3.4.4 **Block locals** (options page 4, option A′ with the two language
rules). Staged 2026-11-03, session compute-engine-1e, worked on base
`609d496ee`, delivered onto `eeee8e574` (CE-751.1), not committed. The rule,
in the interpreter, MathJSON canonicalization, Epsil and compiled code:

- **A declaration has a value.** `Declare(x, type, v)`, or a first
  `Assign(x, v)` at a block's own level, declares `x`. A `Declare` with no
  value (`Declare(x)`, `Declare(x, type)`, a dictionary with no `value`, a
  destructuring `Declare` with no value, Epsil `let x: integer`) is the
  static error `declaration-without-value`, also at the top level.
  `Declare(x)` followed by `Assign(x, v)` is not a pair. A first assignment
  of a name in a branch of `If` or `Which`, in a `Loop` body or in a `Match`
  case is `first-assignment-in-branch` ("declare `x` with a value before the
  branch"), also at the top level, except for a name that an enclosing
  scope already declares (that is a write of that name). A read of a local
  before its declaration is `read-before-declaration` at canonicalization:
  the run-time error value and the symbolic unset read are gone
  (`boxed-expression/read-before-declaration.ts` and
  `epsil/read-before-assignment.ts` deleted). A `let` in a branch block
  (`If(c, Block(Declare(s, "unknown", x), s + 1))`) is valid.
- **Refinement of rule 1, user decision 2026-11-03** (relayed by
  compute-engine-24): a valueless `Declare` whose type is a function type is
  valid when a function statement of the same name is in the same
  statement list, since the function statement is hoisted and no read sees
  a binding with no value: `let f: (integer) -> integer; function f(x) {
  x + 1 }; f(2)` is 3. Without the function statement in the same list it
  is `declaration-without-value`, with the message "define `f` with a
  function statement in the same block, or give the declaration a value".
  Witnesses (plausible): `test/epsil/compiled-declared-function-type.test.ts`,
  `test/epsil/multi-clause.test.ts`,
  `test/compute-engine/block-declared-signature-clause.test.ts`. The other
  option (B): keep the error; the types go on the function statement, and
  the multi-clause form with a declared signature is lost.
- **Reassignment** keeps the local's type: `Block(Assign(a, 1), Assign(a,
  "x"), a)` is `assignment-type-mismatch`. The check uses the compatibility
  test of argument checking, so it refuses only a value whose type cannot
  be the local's type (`let s: real = 0; s = s + sqrt(x)` is valid). Also
  checked: each leaf of a destructuring assignment, a function value, a
  `Match` case.
- **An assignment is a statement**: an `Assign` or `Declare` as an operand
  of anything but `Block`, a branch of `If`/`Which` or a `Loop` body (not a
  condition, not an indexing set) is `assignment-in-operand`; a chained `a
  := b := v` (Epsil and LaTeX) is the parse error `chained-assignment`.
- **A block that ends in an assignment or a declaration has the value
  `Nothing`** (it was the assigned value), kept where the block is used; a
  function body that ends so and declares a result type other than
  `nothing` gives `incompatible-type` when called (the engine has no static
  check of a body against its declared result type).
- **Compiled code**: a write to a symbol of the engine, an input or a
  `vars` name declines (`assignLValue()`, `compile-locals.ts`); a block with
  a statement other than a declaration with a value, used as an operand,
  declines (`'block-value'`, `compile-admission.ts`), and a used value of an
  assignment declines (`'nothing-value'`); a loop whose value is used
  already declined. A block whose statements before the last are only
  `Declare`s with a value (the `where` clause, the `;` parse) is a value and
  compiles in any position (`isBindingBlock()`): the first version declined
  it and the corpus measure found it (art/wccrhnzn2q, 6 javascript records),
  so it was fixed before the final measure. A `vars` entry is a value: a
  string entry is spliced at each read, so an entry with an effect gives an
  unspecified result (documented; no code change, Tycho passes only plain
  reads).

- **Tycho's answers** (tycho-c6, 2026-11-03). (a) Four Tycho builders emit
  `Declare(x)` then `Assign(x, v)`, not one: the implicit-surface march
  kernel (`implicitMarchKernels`, `src/plot/ce-compile.ts`),
  `surface-argument-staging.ts`, the Desmos `with` parse
  (`desmos-import/with-dictionary.ts`) and the colour-definition builder
  (`collectColorDefinitions`, `style-expressions.ts`); section 6 named only
  the first (compute-engine-1e found the others in the frozen copy). All
  four change at adoption, in the form the loaded CE parser writes for
  `a\coloneq1;a` (probed per engine, `src/plot-core/declare-value.ts`), with
  three Tycho readers that ignored the value of a one-statement `Declare`
  fixed too; not on a Tycho commit yet (worktree `/tmp/wt-tycho-c6b`). (b) No
  Tycho-built block ends in an assignment or a declaration, nests an
  assignment in an operand, reads the value of a loop, writes a symbol it
  does not declare, or first-assigns in a branch or a loop (all 757
  documents and the showcase, CE 0.176.0 and `609d496ee`). (c) Every `vars`
  entry Tycho passes is a plain read. tycho-f9 notes that Tycho
  `6599982fe` reads `Declare(x, "unknown", v)` as a declaration in all its
  block readers.
- **Choices beyond the rule, each reversible.** (1) A chained assignment is
  a parse error (other option: split it into two statements). (2) A
  top-level `Assign` outside every block keeps its value (other option:
  `Nothing`). (3) The static type of a local stays the join of its values;
  the widened type (every number to `number`, `character` to `string`, a
  nested list keeps its depth, a first value of type `unknown` admits any
  value) is used only for the reassignment check (other option: the
  widened type as the static type, which changes compiled lanes). (4) A
  comprehension term and a `Sum`/`Product` body are not branches: a block
  there declares its own locals for each element, also inside a branch
  (witness: Tycho item 172, `[(d := [n, 2]; Sum(d)) for n = 1..3]`). (5) The
  code `read-before-declaration` is kept for the static error. (6) The value
  of a first assignment reads the enclosing binding, as `Declare(t,
  "unknown", t + 1)` and the `;` parse do, so `Block(Assign(x, x + 1), 2x)`
  and `x \coloneq x+1; 2x` agree (`2(x + 1)`; witness crafted). (7) A
  nested block owns the names it first assigns (issue-489 test `N2` now
  gives `2t + 5`). (8) A closure that reads a local before its declaration
  (`function g() { f = () => t; v = f(); t = 1; v }` gives `1`) is not
  refused: the static check does not follow calls (crafted; one sentence in
  `src/epsil/docs/declarations.md`). (9) `Block(p := 0, Integrate(Block(p :=
  7, t), Limits(t, 0, 1)), p)` is `assignment-in-operand`, since the
  integration puts the `Assign` in a product (crafted). (10) A local whose
  first value has type `unknown` and that is later given a list, point,
  matrix or string declines in compiled code (`unsettled-shape`): its type
  stays `unknown` (plausible; the base gave the right value only through a
  run-time shape test).
- **Rule 7, measured.** `Block(a := 1, If(c > 0, a := Sqrt(-x)), a)` and the
  same with the literal `2 + 3i`: in `strict`, javascript and glsl decline
  (`unsettled-shape` for the root, `lane-mismatch` for the literal); in
  `complex`, javascript gives the interpreter's values (`2i` at c = 1, x =
  4; `1` at c = -1; `2` at x = -4; `2 + 3i`); Python declines both (an `If`
  with no `else`). Not in the corpus.
- **Defects found and fixed in this item**: the three-operand `Declare` of a
  list-valued local in a function body was typed `unknown` by
  `call-result-type.ts` and compiled to `null` (the old pair and the first
  `Assign` were right; reached by the CHANGELOG replacement, plausible); a
  first assignment in a top-level branch made a local that disappeared
  (`if 1 < 2 { a = 1 }; a` gave the symbol `a`); the canonical rebuild of a
  very large shared subtree (`boxedInCurrentScope()`) took 31 s and
  declined, now 13 ms. Recorded, not fixed (older code): CE-794 (a local
  function declared with `Declare` in a block of a closure branch is not
  called).
- **The corpus measure** (tools of `~/.claude/tools/ce-census/`, records
  keyed by LaTeX, since the builder patch changes the MathJSON of the march
  kernels and not the LaTeX). Tycho frozen at `44a25d4e3` with the `At`
  handler of 3.4.2 and the mode split of 3.4.6 (the copy `tycho-snap-split`
  of 3.4.6) and the four builders patched to the three-operand `Declare`
  (patch: the scratchpad of session compute-engine-1e,
  `tycho-344-declare.patch`). On the base, the patch alone changes no value
  (77,104 values). Final runs `base2` (CE `eeee8e574`) and `cand2`
  (`eeee8e574` plus this item): 17,835 compiles in both; declines javascript
  43, glsl 47, interval-js 74 in both runs, none new and none removed; no
  value changed (77,208 values in 13,730 keys). With the four builders
  unpatched (run `cand2-unpatched`), 29 rows in 10 documents change and 169
  fewer records are compiled (art/2ki2hjsouf, art/njncrg9fkv,
  art/wccrhnzn2q, art/khpocp8io0, art/hyvhlz4chj, art/mavxszbvzk,
  art/ur34gk3p8x, art/60bekaymzz, neyret/crmswfhqrd, showcase/metaballs;
  list sent to Tycho): these rows need Tycho's builder change at adoption.
- **Code lines** (not blank, `//`, `/*` or `*`; base `eeee8e574`): `library`
  79,794 → 80,167, `boxed-expression` 83,907 → 83,913, `src/epsil` 17,679 →
  17,455, `compilation` 92,820 → 92,971. Source: 28 files, 1,828 insertions,
  1,326 deletions; two files deleted. Tests: 189 files changed (2,855
  insertions, 5,785 deletions), two new
  (`block-locals-declaration-rules.test.ts`,
  `compile-block-locals-rules.test.ts`); the tests that pinned the
  run-time read of a valueless local, the definite-assignment declines and
  the compiled writes of inputs were deleted or rewritten
  (`ce-636-block-local-without-value.test.ts` became 3 tests); 11 inline
  snapshots changed to the `where` print of the three-operand `Declare`, 3
  to `let x = …` in compiled code; none marked `@fixme`.
- **Review**: Claude and Codex, three rounds. Round 1 (12 findings, 1 high):
  the reassignment check used a strict subtype test (high), a declared
  local not checked after an `unknown` first value, `Typed` hid an
  assignment error, destructuring and function values skipped the check,
  comprehension and binder bodies in a branch, `Hold` read as a use, the
  call type of a body that ends in an assignment, an identity `vars`
  mapping written, the static-error matching of `execute-epsil.ts`. Round 2
  (fixes): Codex none; Claude: `src/epsil/docs/errors.md` not generated
  (regenerated with `scripts/build-error-docs.ts`, which also picked up
  explanation texts that earlier items changed). Round 3 (the binding-block
  fix): Codex none; Claude: the decline message (fixed).
- **Checks** on the combined tree (`/tmp/wt-compute-engine-1e`, `eeee8e574`
  plus this item, byte for byte the delivered files except the peer hunks of
  CE-793 in `compiler-core.ts`): typecheck, lint, `check:deps`, the full
  suite (1,816 suites, 77,805 tests, 0 failed), `npm run test:python` (49
  suites, 2,829 tests, 0 failed), the corpus measure above.
- **User-facing pages** edited in `~/dev/cortexjs.io/docs/compute-engine/`:
  `84-reference-control-structures.md`, `85-reference-core.md` (also the
  redeclaration sentence, which was wrong on the base too),
  `07-guide-latex-syntax.md`, `13-guide-compile.md`,
  `87-reference-functions.md`, `08-guide-types.md`, `10-guide-evaluate.md`.

What 3.4.5 (function values, options page 5, option B with the simplified
defaults) needs from this item: (1) a function-typed `Declare` with no
value is valid only beside a function statement of the same name in the
same list (user decision 2026-11-03); a function value in a variable is a
`Declare` with a value or a first `Assign`, and its reassignment is
type-checked (`Block(Assign(a, 1), Assign(a, (x) => x), a)` is an error), so
3.4.5's decline of a function value in a variable starts from a local whose
type is known; (2) a function body that ends in an assignment has the value
`Nothing`, and a declared result type is checked at the call
(`statementAscriptionValue()`, `library/core.ts`), not statically: a static
check of a body against its declared result type does not exist; (3) the
three-operand `Declare` now types a call of a function literal from its
value (`call-result-type.ts`); (4) CE-794 (a function local declared with
`Declare` in a closure branch is not called) is in the same area.

What step 4, row 4, removes (measured on the item's tree, code lines not
blank, `//`, `/*` or `*`): in `compile-locals.ts`, `classifyLocalReads`
(302, still runs, its declines unreachable), `assertLocalsAssignedBeforeRead`
(75, the same), `localReadWithNoWrite` (11, unreachable),
`localReadOnSomePaths` (10, unreachable), `unassignedLocalRead` (12,
unreachable), `loopRunsOnce` (17, feeds the read analysis only),
`splitChainedAssignments` (21, its input is a static error),
`chainedLocalDeclares` (26, the same), `nestedAssignmentsTo` (33, reached),
`chainedAmbientWrite` (5, unreachable), `localVarsObjectStatement` (16,
unreachable); `withLocalShapeFrame` (32, `compiler-core.ts`),
`_pushLocalComplex`/`_popLocalComplex` (8, `compile-loops.ts`),
`reachesCallerCode` (55, `compile-folding.ts`); the fields `_localComplex`
(32 lines in 9 files), `_localVector` (32 lines in 6 files), `inputWrites`
(23 lines) and `inputLocals` (32 lines), reached only for a local with no
target spelling; the loop-value lowering (reached only for a loop with no
indexing set that has only `Return`); the block-as-value lowering of a
block with an assignment (code is generated, then the compile declines).
The Python `_ce_unset` marker is already gone. The listed lines are 742
(623 in the named functions, 119 in the field lines), before the lowerings
and the targets' re-compile paths for an input write, which row 4 measures.

3.4.5 **Function values** (options page 5, option B with the simplified
defaults). Staged 2026-11-03, session compute-engine-e7, worked on base
`21fc9505b`, not committed. The rule, in the interpreter, Epsil and compiled
code:

- **Compiled code calls what it can see.** A compiled call compiles when the
  callee is a defined function, a declared function with a value, or a
  function literal at the call site; the callbacks of `Map`, `Filter`,
  `Sort`, `Fold` and `Reduce` compile when they are such a callee.
  `Apply(Derivative(f, n), x)` is kept: `appliedDerivativeLiteral()`
  (`compile-callbacks.ts`) resolves it to the closed form of a defined `f`
  as a literal at the call site (decided 2026-11-03 with Tycho; 10 corpus
  records, neyret/7kn7eakzkd and neyret/g2vyb7i2oi), and it declines only
  where it declined before.
- **Function values decline in compiled code**
  (`compile-function-values.ts`, `assertNoFunctionValue()`): a function
  value passed through a parameter or as an argument, a curried call or a
  partial application (`Apply(Apply(f, 1), u)`, `Apply(f, 1)`), a function
  returned from a call, a parameter declared with a function type
  (`h = (f: function) ↦ f(1)`), and a function value stored in a local that
  is assigned more than once (a local function assigned once with a literal
  is a callee compiled code can see). A call with fewer arguments than the
  required parameters keeps the arity message. The interpreter keeps
  first-class functions: lambdas, closures, currying, partial application,
  function values.
- **A default fills only an argument that the call leaves out**, at
  canonicalization (`completedLiteralArguments` in compiled code), in the
  interpreter and in compiled code. An absent value supplied at a defaulted
  position, written (`f(Missing)`) or computed (`f(At(L, 100))`), is passed
  through: `g = (k: real = 2) ↦ k + 1`, `g(First([]))` is `Missing` in the
  interpreter (the 3.4.2 rule), and compiled `g(At(L, 100))` with
  `L: list<real>` gets `NaN`, a value outside `real` (unspecified). This
  reverses the "or absent" half of R6 (user decision 2026-11-02). A default
  parameter is no longer a discharge (`AGENTS.md`,
  `docs/COMPILATION-MODEL.md`, `docs/ERROR-MODEL.md`). The interval-js
  decline of a supplied value at a defaulted position is gone. The static
  type of a call follows (`call-result-type.ts`: `f(First([]))` with
  `f := (x: integer = 2) ↦ x` is typed `Missing`), and argument validation
  no longer accepts a certainly absent argument at a defaulted parameter
  (`validate.ts`).
- **A default is a constant.** Accepted: a number, a string, a boolean,
  `[]`, `{}`, and a constant symbol of three kinds: a library constant
  (`over: set = Integers`, `k: real = Pi`), a symbol declared with
  `isConstant: true` (`weights: list<number> = DefaultWeights`; an Epsil
  `const` of the program with any value counts, also when the function is
  in the same program, recorded when its `Declare` is canonicalized because
  the static check canonicalizes without running), and a symbol that the
  parameter type lists (`mode: symbol<Auto> | symbol<Manual> = Auto`).
  `isConstantSymbolDefault()` (`boxed-expression/parameter-defaults.ts`) is
  the one check. The default is bound at the declaration: a local of the
  same name at the call site does not change it (`literalDefaultOperands()`
  takes the canonical literal's default operands; `callSiteDefault` is
  gone). Refused, with the static error `expected-a-literal-default` in a
  literal and a throw from `ce.declare()` for a signature: a default that
  names a variable (`(k = n) ↦ k` with `n` declared without `isConstant`, or
  assigned), `Nothing`, `Missing`. A literal with a rest parameter has no
  defaults (static error). A tuple (`Optional(p, (0, 0))`) or a computed
  expression (`2π`) is not a default value, as on the base: rule 4 allows
  "an expression with no free symbol", but the signature language holds
  only literals and symbols, and this item adds no new form (write a
  constant and name it). In compiled code a symbol default is filled only
  when it is a library constant or a `symbol<…>` symbol
  (`compiledSymbolDefaultDeclines()`, `compile-parameter-defaults.ts`); a
  host constant or an Epsil `const` declines at every fill site (the simple
  sound version: a name test of the call site was wrong both ways in
  review), so `f := (k = W0) ↦ k + 1` with `W0` declared `isConstant`
  compiles `f()` to a decline while the interpreter gives 6 (decided
  2026-11-04: compiled code fills it, ROADMAP CE-803). Done 2026-11-04
  (CE-803): compiled code fills the value of the constant, read from the
  definition the default symbol was bound to where the function is
  declared, when the value is a literal (`compiledDefaultOperand()`); an
  Epsil `const` compiled before the program runs, and a constant whose value
  is not a literal, still decline.
- **User decision 2026-11-03** (relayed by compute-engine-24; option B of
  rule 4): a constant symbol is a valid default; the purpose of rule 4 is to
  remove the call-site scoping rule, not to forbid a symbol as a value.
  Witness: GitHub issue #490 (`corpus`): enumeratio asked for
  `over: Integers` and `Auto`, and the 0.176.0 reply promised them and "for
  any other value, declare a constant and name it". compute-engine-e7
  extended the user's wording ("a library constant or a symbol of a
  declared `symbol<…>` literal type") to a symbol declared `constant` by the
  user, which keeps the second promise; compute-engine-24 agreed that it is
  inside the decision. The other option (A): every symbol default except
  `True` and `False` is a static error; #490's `mode` default becomes a
  string, and `over: Integers` has no replacement.
- **The bigint user** (enumeratio, GitHub issue #503) is assumed not to use
  currying, partial application or a function value in a variable (section
  6, user decision 2026-11-03); their programs (`Fold` over a `Range` with a
  literal callback, user functions with integer parameters) are calls that
  option B keeps. In the `bigint` mode, a supplied `NaN` or `null` at a
  defaulted parameter now throws the entry `TypeError`; only `undefined` (a
  left-out argument) takes the default.
- **Tycho's census** (tycho-c6, 2026-11-03; confirmed unchanged when this
  item started). Instrument: Tycho's codegen audit of all 757 documents
  plus the showcase, every expression given to compile and the parse of
  every row; Tycho worktree main `abcd7ba3e` plus adoption items 2 and 4; CE
  0.176.0 and `609d496ee` give the same counts. Parameter defaults
  (`Optional` parameter or a signature string with `=`): 0; Tycho's source
  declares no signature with a default. A lambda stored in a local, a
  lambda returned from a function, a call of a parameter, a callback that
  is a parameter: 0. Every lambda Tycho builds is a literal callback of
  `Map`/`Filter` (importer lowerings filter-index, function-zip,
  minmax-broadcast, collection-bigop-lowering), a literal applied at the
  call site (the derivative chain of `compiled-body.ts`), the defined GLSL
  colour helper, or boxed for its type only. A function value passed
  through a parameter: 1 document, neyret/oazduhqqid: Tycho's macro
  threading compiles `\frac{r_s+r_p}{2}\{x<0\}` as
  `\frac12(r_s(x, v)+r_p(x, v))` with the macro `v` passed bare, and CE
  emitted `_fn_r_s(_.x, _fn_v)` where `r_s` uses `v` as a number: `NaN`. A
  Tycho defect (Tycho ROADMAP IX); after 3.4.5 it declines, which Tycho
  accepts. Not function values: `Integrate(Function(body, x), …)` (136
  compile records, 25 documents) and one `EvaluateAt`, CE's own integrand
  form, which stays. `f'(x)` compiles as `Apply(Derivative(f), x)` (10
  records), kept as above.
- **Choices beyond the rule, each reversible.** (1) A library constant is
  checked against the parameter type also with `ce.strict = false`
  (`k: number = Integers` is refused; the base accepted it in non-strict
  mode; other option: skip the check when strict is off). (2) A function
  statement that reads a `const` written after it (`function f(k = W) {…};
  const W = 5`) is `expected-a-literal-default`, since the function is
  hoisted before the `const` runs (other option: the code
  `read-before-declaration`, which needs a pre-scan of the block). (3) The
  test of `undefined` at the root of a compiled literal and in the bigint
  entry check is the left-out argument (JavaScript cannot tell a written
  `undefined` from a left-out one), so a compiled callback with a defaulted
  parameter fills a supplied absent `undefined`; a discharge of that
  parameter in the body then differs from the interpreter
  (known-limitations line, crafted). (4) Interval-js declines
  `Apply((f) => f(1), (x) => x + 1)` where the other targets fold it to 2
  at compile time (a decline; crafted).
- **Deleted and rewritten tests**: the R6 fill tests, the symbol-default
  call-site tests (`lazy-view-outlived-symbol-default.test.ts` deleted; the
  callbacks of `closure-frame-retained` and `lazy-view-scope` rewritten to
  read `d` where it is written, one lazy-view test deleted, whose new form
  gives `2d` on the base too), the compiled currying, partial-application
  and returned-function tests (now declines; the interpreter assertions
  kept), the point-default tests through a variable `O` (restored with `O`
  declared `isConstant`). New: `function-values-rules.test.ts` and
  `function-values-review-fixes.test.ts`. The compiled curried calls of
  `issue-489-curried-function-capture` and
  `parameter-substitution-shadowing` now expect the decline. No snapshot
  changed.
- **The corpus measure** (tools of `~/.claude/tools/ce-census/`, records
  keyed by LaTeX). Tycho frozen at `44a25d4e3` with the `At` handler of
  3.4.2, the mode split of 3.4.6 and the four builders of 3.4.4 patched (the
  copy `tycho-snap-344` of session compute-engine-1e). Base run `base` on
  `21fc9505b`: 17,835 compiles, the same values as 3.4.4's run `cand2`
  (77,208 values, 0 different). Candidate run `cand` (`21fc9505b` plus this
  item): 17,835 compiles; declines javascript 43 → 44, glsl 47 → 47,
  interval-js 74 → 75; the only new declines are neyret/oazduhqqid, row
  `\frac{r_{s}+r_{p}}{2}\keyword{where}x\lt0`, javascript and interval-js
  ("the argument `v` is a function, and compiled code does not pass a
  function value through a parameter"), as expected; no value changed
  (77,199 values compared). The two records of that row change key, since
  Tycho compiles the expanded form after the decline. Runs: `audit/` in the
  scratchpad of session compute-engine-e7.
- **Code lines** (not blank, `//`, `/*` or `*`; base `21fc9505b`): `library`
  80,168 → 80,198, `boxed-expression` 83,913 → 83,788, `src/epsil` 17,455 →
  17,463, `compilation` 93,043 → 92,799 (`function-utils.ts`, outside these
  folders, also lost the run-time absent fill). Source: 32 files changed, 914
  insertions, 1,587 deletions, plus the new `compile-function-values.ts`.
  Tests: 22 files changed (1,245 insertions, 2,061 deletions), one deleted,
  two new.
- **Review**: Claude and Codex, three rounds. Round 1 (11 findings, 1
  high): a compiled symbol default resolved by name to a call-site local
  (high), the constant-declaration record never cleared and trusted before
  the binding, the literal's defaults taking precedence over a declared
  signature's, the four-operand `Declare` not recorded, three gaps of
  `assertNoFunctionValue()`, the callback wrappers' fill of a supplied
  `undefined` (a known-limitations line), the CHANGELOG. Round 2 (6 findings,
  1 high): the name-based shadow guard missed callbacks (high) and declined
  the plausible same-block Epsil `const`; a warm engine's earlier binding
  overrode the record; checkpoint restore; a global fallback in
  `fewerArgumentsThanParameters()`. The name test was replaced by the simple
  sound rule: compiled code fills a symbol default only for a library
  constant or a `symbol<…>` symbol, and declines a host or program constant
  at every fill site (plausible witness lost: the Epsil same-block `const`
  default and a host constant default compile to a decline; the interpreter
  gives the value); the record got explicit 'const'/'variable' marks,
  journaled for checkpoint restore. Round 3 (5 findings, no new high in the
  round-2 fixes): `ce.declare()` into another scope boxed defaults in the
  current scope (fixed), a destructuring `let` wrote no mark (fixed), marks
  outliving a run (fixed; a canonicalized `Declare` that never runs keeps
  its mark: crafted, known-limitations sentence in `src/epsil/docs/control-flow.md`),
  and the round-1 `undefined` fill again (kept as the known-limitations
  line). The round-3 fixes had no review (the third round is the last).
- **Checks** on the final tree (`/tmp/wt-compute-engine-e7`, `21fc9505b`
  plus this item): typecheck, lint, `check:deps`, the full suite (1,818
  suites, 77,779 tests, 0 failed; canary 46), `npm run test:python` (49
  suites, 2,778 tests), the corpus measure above (rerun on the final tree:
  the same result). On the combined tree (`049107fb4`, after CE-796, CE-794,
  CE-787, plus this item): typecheck, lint, `check:deps`, the full suite
  (1,818 suites, 77,805 tests, 0 failed; canary 46), `npm run test:python`
  (2,778 tests).
- **User-facing pages** edited in `~/dev/cortexjs.io/docs/compute-engine/`:
  `13-guide-compile.md` (defaults, absent values, a new section "Function
  Values"), `87-reference-functions.md`, `08-guide-types.md`,
  `06-guide-augmenting.md`. Epsil pages in this repo: `src/epsil/docs/types.md`,
  `control-flow.md`, `operators.md`, `errors.md` (regenerated). Seen, not
  changed (older text, not this item): the partial-application example of
  `87-reference-functions.md` (about line 627) prints a different, equal
  function than the source gives.

What step 4, row 5, removes (code lines not blank, `//`, `/*` or `*`,
measured on the item's tree): `partial-application.ts` (227, unreachable
after the declines: `partialApplicationValue` and the rest of the file 138,
`curriedLiteral` and `curriedApplication` 26, the parts of
`partialApplicationDecline`/`partialApplicationValueDecline` after the
refusal) and its callers in `javascript-target.ts`, `python-target.ts`,
`interval-javascript-target.ts`, `gpu-functions.ts`,
`compile-expression.ts`; the run-time call of a reassigned local function:
the `rebound` branches of `tryCompileLocalFunctionCall`
(`compile-user-functions.ts`, about 17), `compile-inner.ts` (about 8),
`javascript-target.ts` (2), `reboundLocalNames` (`compile-loops.ts`, 180,
most of it: the decline needs only the set of names),
`returnedFunctionLiterals` (`compile-conditions.ts`, 17), the `literals` and
`decline` fields of `reboundFunctionScope` and `noteLocalFunction`; and
probably `boxed-expression/lazy-view-context.ts` (473): its records served
the symbol default read at the call site; with the records turned off, the
three test files that use it pass (203 tests), but a full suite with them off
was not run. The run-time absent fill (`absentFilledArguments`,
`literalDefaultFills`, `defaultFillingWrapper`, `targetCoalesce`,
`mayBeAbsentAtRunTime`, `argumentMayBeAbsent`,
`declineIntervalAbsentDefault`, `callSiteDefault`, the filling callback
wrappers and the per-cell fill of broadcast calls) is already removed by
this item, because it gave the default where the interpreter now passes the
absent value.

What the language release needs from item 3.4 as a whole: (1) the
CHANGELOG: the `[Unreleased]` "Behavior Changes" section holds one entry per
axis (3.1 to 3.4.6), each with the replacement for every form that declines
or becomes an error; the release turns `[Unreleased]` into the version
heading, and says at its top that it is the language release with breaking
changes for compiled code (no entry for that exists yet); (2) the entry of
0.177.0 "A default parameter fills a supplied absent value" is reversed by
3.4.5's entry, which says so; (3) for npm users, section 6's last bullet
(a CHANGELOG entry per removal with the decline that replaces it) is met by
the per-axis entries; (4) section 6's other open bullets stay for the
release: Tycho re-checks its rows (restriction binding, selection, the
complex-mode documents, the `NaN` point routes), the issue #503 reply names
the dropped bigint escalation and the function-value assumption, the issue
#355 comment (`docs/plans/2026-11-03-issue-355-comment.md`), and the
pending `Slice(xs, Nothing)` decision of 3.4.3; (5) the reply to issue #490
should say that a default no longer fills a supplied absent value and that
a variable symbol default is an error, with the constant forms that stay.

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

Row 8 is empty: the decision of 2026-11-02 (options document, page 7) kept
WGSL, Python and the value kinds, so no feature was dropped by name.

Row 9, user decision 2026-11-04: the host provides the finite proof. On the
shader targets a guarded call (`sin`, `cos`, `max`, `min`, `clamp`) uses
the built-in when its argument is proven finite in f32 from the declared
types and ranges of the inputs and parameters, the number literals and the
operators of the expression (the bound arithmetic through sums, products,
small powers, quotients and modulo, and the bounded heads stay); the rules
that derive facts the host did not state (the proofs of the bodies of user
functions, the call-site facts, the definition-parameter facts, the
loop-index facts, the interval bound of `cos`) go. A call whose argument
is not proven keeps its NaN-safe helper; it does not decline, since Tycho's
audit of 0.176.0 had 124 shader records in 12 documents with helpers,
which a decline would turn into corpus witnesses. The measure of the row
is the count of corpus records that gain a helper (a performance cost the
user accepted), beside the usual zero changed values and zero new declines.
The alternative readings, not chosen: remove the proof and the helpers and
accept an undefined value on overflow (a wrong pixel where the interpreter
has a hole); keep the full proof (the state before the row).

User decision 2026-11-04, later the same day, which replaces part of the
row 9 decision: the intent of "the host provides the finite proof" is that
the compiler uses all the information that the host declares. Two changes
follow. (1) The call-site facts come back: when every call of a user
function is in the same compilation, a parameter has the union of the
bounds of the arguments of its calls. These bounds come from the host's
declarations of the inputs. (2) A declared range on a parameter
(`(real<-1..1>) -> real`) gives the built-in. The 0.179.0 compiler types
the parameter `number` and loses the range, a defect against the row 9
text "inputs and parameters". The proofs of the bodies of user functions
stay removed: a call of a function whose declared result type has no
finite range keeps its helper. The request and the answer are in Tycho row
493 (`~/dev/tycho/docs/COMPUTE_ENGINE.md`), which is the record of the work.

The result of step 4, row 1 (selection; 2026-11-03, session
compute-engine-57; base `1359a1279`; committed as `ea4f58fa8`).

- **What was removed.** In `javascript-target.ts`, `compileJSSelection()`:
  the `flat` flag, the `!flat` branch that built `_SYS.absentByDepth(…)`,
  the `_SYS.wholeAt(…)` and `_SYS.pointDepthUnknown(…)` emissions,
  `mayHoldPointAtUnknownDepth()`, and the depth argument of
  `_SYS.pointOrPoints`. `pointOrPointListDepth()` became the predicate
  `isPointOrPointListArm()`, because no caller reads the depth. In
  `javascript-runtime.ts`: `AbsentByDepth`, `absentAtDepth()`, the `depth`
  and `unknownPointDepth` fields of `WholeArm`, the `_SYS` entries
  `wholeAt`, `pointDepthUnknown` and `absentByDepth`, and the depth branch
  of `selectWith`. In `library/control-structures.ts`:
  `evaluateElementwiseSelection()` is one flat loop (the recursive `select`,
  the levels below 1 of `assemble`, `lowerRankArmError()`, the
  `SelectionNode` and `SelectionList` types are gone); `armTypeAtDepth()` is
  gone (at depth 1 it was `armElementType()`); `noMatchCell()`,
  `noMatchPositionType()` and `elementwiseCellType()` lost their `depth`
  parameter; `elementwiseResultType()` no longer nests the list once per
  rank; `conditionShape()`, `mergeMaskShapes()` and `elementwiseMaskRank()`
  give rank 1 or nothing. Why the code was unreachable: a condition whose
  type is nested is refused before compilation (`conditionOperand()`,
  `isNeverFlatMaskType()`); a condition whose type does not settle the rank
  (choice (3) of 3.3) and whose value is nested gives `NaN` in `selectWith`
  before an arm is read, and the `incompatible-type` error in the
  interpreter, whose loop tests for a list cell before it reads an arm. The
  old runtime read only depth 1 of an `AbsentByDepth`, which was the plain
  absent value, and treated a `WholeArm` or a `pointOrPoints` of depth above
  0 as a plain list arm: the removed wrappers did not change a value.
- **What the survey found with nothing to remove.** `compile-conditionals.ts`,
  `compile-conditions.ts` and `compiler-core.ts`: comments only (they
  described the removed depth code). The GLSL, WGSL, interval-js and Python
  targets and `compile-broadcast.ts` have no element-wise selection:
  `assertScalarCondition()` refuses a condition that can be a list on every
  target except JavaScript, so there was no per-target copy of one lowering
  to merge; the one element-wise lowering is the JavaScript one.
  `boxed-expression` has no selection code that depends on the rank.
  `compile-match.ts` (`Match`) used none of the removed code; it stays. The
  table above estimated `compile-conditionals.ts` 546, `compile-conditions.ts`
  488 and `compile-match.ts` 716 lines for this row: the rank-2 code that
  3.3 left was much smaller than these module counts.
- **Code lines** (`.ts`, not blank, `//`, `/*` or `*`): `compilation`
  92,764 → 92,704 (−60), `library` 80,129 → 80,028 (−101),
  `boxed-expression` 83,745 → 83,745. Source: 6 files; with the one test
  file, 7 files, 184 insertions, 468 deletions.
- **Tests.** None deleted or converted: item 3.3 had already turned the
  rank-2 value tests into assertions of the static error or the decline,
  and those still pass. One test comment in
  `test/compute-engine/compile-elementwise-which.test.ts` that named the
  deleted `selectNested` was rewritten. No snapshot changed.
- **The corpus measure** (Tycho frozen at `a34405ae0`, a plain `git archive`
  of Tycho main with no patch, which holds Tycho's adoption of 0.178.0; the
  tools of 3.4.1 with records keyed by MathJSON; base run on `1359a1279`,
  candidate on the final tree): 17,825 compiles, 13,707 keys and 77,267
  values in both runs; 0 changed values, 0 new throws. Declines: javascript
  47, glsl 44, interval-js 61 in both runs; no new decline and no decline
  gone.
- **Review**: Claude and Codex, one round. Codex: no finding. Claude: three
  low findings and one nit, all fixed (a comment whose example did not reach
  its function, two comments that still described nested masks, the depth
  that no caller read). No second round: no finding was `high` or `medium`.
- **Choices, each reversible.** (1) The result type of a selection whose
  condition is typed as a matrix, when the condition was boxed before its
  type was known, is now `list<C | list<any>>`, not `matrix<…>`; its value is
  the `incompatible-type` error before and after (witness `crafted`; no
  known-limitations line, since no compiled value changes). The other option
  was to keep the rank code for the type alone. (2) The type of a selection
  whose condition does not settle the rank still admits `list<C | list<any>>`
  (`elementwiseResultType()`, `possiblyElementwiseResultType()`), although
  no valid value has that shape now: narrowing it to `list<C>` changes a
  public type and possibly compile routing, so it is not in a pure removal.
  Example: `If(T, 1, 0)` with `T: tensor<boolean>` is typed
  `list<integer | list<any>>`.
- **Seen, outside this row.** A host function declared with a result type
  `tuple<real, real> | list<tuple<real, real>>` used as a selection arm
  compiles with a test of the value at run time (`_SYS.pointOrPoints`).
  This is the union-of-shapes dispatch of row 3 (admission and shapes).
- **Checks** (in the worktree, on the tree before the review fixes; the fixes
  were comments and the predicate): typecheck, `oxlint` on the changed
  files, `check:deps`, 73 selection test files (6,135 passed), `test:core`
  (5,501 passed). After the fixes, in the main tree: typecheck, `oxlint` on
  the two changed files, the 73 compile test files that name a selection
  (4,492 passed). The full suite did not run: the change touches neither
  `boxed-expression` nor `common/type`. The Python target did not change.
- **Documents.** `docs/BROADCAST-MODEL.md` and `docs/COMPILATION-MODEL.md`
  did not describe the removed mechanisms (they state the shipped rule), and
  no page under `~/dev/cortexjs.io/docs/compute-engine/` did (only the
  generated `changelog.md` names masks of rank 2, as history). No CHANGELOG
  entry: no public behavior changed.
- **What row 2 (absence) can rely on.** `selectWith` reads one absent value
  for every unmatched position (passed as `_SYS.selectAbsent(absent, …)`)
  and the whole value is `wholeAbsent(absent)`; there is no absent value per
  depth. The interpreter's unmatched cell is always `noMatchCell(ce,
  armTypes)` at depth 1. The `'absent'` selector and cell handling of
  `selectWith` (item 3.4.1) are unchanged and belong to row 2.

The result of step 4, row 2 (absence; 2026-11-04, session
compute-engine-72; base `ea4f58fa8`; staged, not committed).

- **What was removed.** The decidedness analysis of compiled conditions,
  which tracked whether a condition can be undecided (an absent operand) and
  combined conditions with three-valued (Kleene) logic. In
  `compile-absence.ts`: `operandMayBeAbsent`, `isAbsenceSymbol`,
  `ATOMIC_FRAGMENT`, `mayBeUndecided`, `compileGuardTest`,
  `conditionDecidability`, `connectiveNode`, `isDecidedByConstruction`,
  `operandPresenceConjuncts`, `peelNegations`, `kleeneValueLeaf`,
  `kleeneRelationLeaf`, `withConditionOperands`, `exactSelect`,
  `compileExactCondition`, `isNanLiteral`, `absentOnlyThroughNumericSlots`.
  In `compiler-core.ts`: `conditionNode()`, `kleeneConditionParts()` and
  their hooks; the statement `If` is a plain `if`/`else` (no `_CND`
  binding). In `compile-conditions.ts`: `kleeneCondition`,
  `kleeneConnective`, the condition dialects. In `compile-conditionals.ts`:
  `kleeneValueConnective`, `isDecidedBooleanValue`. In the targets: the
  Python condition dialect and the decidedness branches of its two
  conditional lowerings; the `None` guard of Python `Equal`; the declines of
  `Any`/`All` over an element type with a `missing` arm
  (`refuseKleeneQuantifier`), of a searched value that may be absent
  (`compileSearchedValue`, `pySearchedValue`, now inlined), of a chained
  `Equal` with an absent operand before an impure one, and of Python
  `Dot`/`Cross`; `collectionMayHoldAbsentCell`; the absent-last sort
  comparators; the `undefined` test of `oneDatumOk`; Python `Max`/`Min` of
  `None`; the `None` test of Python `KroneckerDelta`. In
  `javascript-runtime.ts`: the `'absent'` selector of `selectWith`, the
  undecided `NaN` marker of `eqTensor`/`neqTensor` (they give booleans),
  and the absent reading of `predicateResult` in `quantify` mode. Public API:
  `CompileTarget.absence.object.isNull` (replaced by `object.isAbsent`),
  `CompileTarget.collectionEqualityOperand` (no replacement), about 25
  static members of `BaseCompiler`, and the exports `ConditionDialect`,
  `ConditionNode`, `CONDITION_DIALECT_JS` (CHANGELOG, `[Unreleased]`).
  `absentCollectionOperandGuard` is narrowed to the accessors (`At`, `First`,
  `Second`, `Third`, `Last`, `Length`, `Rest`, `Reverse`). Moved:
  `_localValueFrames`/`_localNameKeys`/`blockLocalOf` to `compile-locals.ts`
  (a shape reader in `compile-callbacks.ts` uses them),
  `userFunctionSignature` to `compile-assignment-checks.ts`,
  `isBooleanBindingType` to `compiler-type-facts.ts`.
- **What stays, and why.** `absenceAxisForType`, `absentDomainIsObject`,
  `isNumericShaped` (the producers and the discharges read them);
  `absent-tuple-read.ts` (both readers serve an accessor over an absent
  base); the object-domain requirement in `compileExpression` (it declines a
  producer that GPU or interval code cannot hold); `make`, `isAbsent`,
  `coalesce`, `nullLiteral`, `raise`, `writtenSymbol` and `coversValueModel`
  of `CompileTarget.absence`; the producers (`nanPointLiteral`,
  `unmatchedCellLiteral`, `_SYS.atPoint`/`atPointNoWrap`, `wholeAbsent`,
  `selectAbsent`) and the three discharges. Tangled with shape code and
  kept: the `scalarValue` test of `scalarAdd`/`scalarMul` (it also gives
  `NaN` for a string or a nested array), the Python `Norm` decline for a list
  of points behind a `missing` arm, the element type without its `missing`
  arm in `compileJSSortWithCallback`. The interval `missing` flag was
  already gone (2026-11-01).
- **New code the removal needed.** `_SYS.cond` reads `undefined`, `null` and
  `NaN` as `false` and keeps its throw for any other non-boolean value (an
  absent condition is not selected, as in the interpreter). A comprehension
  guard whose static type is not the scalar `boolean` is tested with
  `=== true` (JavaScript) or `pythonGuardTest()` (Python): with a plain
  `if (x)`, an integer guard or an element-wise `Equal` (a list) kept
  elements where the interpreter keeps none.
- **Code lines** (`.ts`, not blank, `//`, `/*` or `*`): `compilation` 92,704
  → 91,406 (−1,298); `library` 80,028 → 80,028 (one comment). Source: 23
  files, 348 insertions, 2,855 deletions.
- **Tests.** No file deleted, no snapshot changed. Deleted tests (each
  pinned a removed compiled value or decline): `compile-python.test.ts`
  (Dot and Cross fail closed for an operand whose type admits absence; a
  written Missing or a maybe-missing needle is refused; a numeric needle
  against a list that may hold Missing is refused), `compile-equality-exact`
  (an absent scalar operand marks every position; a hole in the list marks
  only its own position; KroneckerDelta carries the same absence test),
  `compile-notequal-nan` (python: the exact test excludes None),
  `compile-three-valued-connectives` (NaN for an absent boolean beside a
  true relation; a false operand settles an And whose other operand is
  absent), `compiled-absence-literal` (five Median/reducer/Equal tests of
  the absent marker), `restricted-point-accessors` (Cross of a restricted
  point fails closed on python), `compile-js-interpreter-parity-batch` (an
  absent element: NaN in compiled code), `take-drop-negative-count` (Flatten
  of an absent slice), and one case of `compile-python-parity` (a user name
  `bool` hidden by the removed condition test). Assertions removed or
  rewritten in 13 more files; one test added
  (`comprehension-guard`: a list-valued relational guard keeps nothing).
- **The corpus measure** (Tycho frozen at `a34405ae0`, the copy of row 1; the
  tools of 3.4.1 with records keyed by MathJSON; base run on `ea4f58fa8`,
  candidate on the final tree): 17,825 compiles, 13,707 keys and 77,267
  values in both runs; 0 changed values, 0 new throws. Declines: javascript
  47, glsl 44, interval-js 61 in both runs; no new decline and none gone.
  The values that the removal changes (all unspecified by the caveats, each
  toward the interpreter: `If(At(B, 9), 1, 2)` with `B` two booleans gives
  `2`, it gave `NaN`; `Equal([1, Missing], 1)` gives `[true, false]`, it
  gave `[true, NaN]`) reach no corpus record.
- **Review**: Claude and Codex, two rounds. Round 1: Codex, one high (a
  list-valued guard read by truthiness, fixed with the type test above, on
  both targets); Claude, two low (outdated comments; no Behavior Changes
  entry in the CHANGELOG) and two nits (pass-through search helpers and an
  unused parameter, removed; line form), all fixed. Round 2 (Codex, on the
  fixes): no finding.
- **Checks.** In the worktree, on the final tree: typecheck, `oxlint` on the
  changed files, `check:deps`, the full suite (1,819 suites, 77,800 tests, 0
  failed), `npm run test:python` (49 suites, 0 failed, after the one
  parity case above was deleted), the corpus measure. In the main tree, after
  the patch was applied over other sessions' uncommitted work: typecheck,
  and the 24 affected test files (1,825 passed).
- **Documents.** `docs/COMPILATION-MODEL.md`: the paragraphs on the
  three-valued element-wise runtime and the undecided scalar comparison are
  replaced by the two-valued rule; two interval lines that named the removed
  `missing` flag are corrected. `docs/plans/2026-11-01-absent-value-contract.md`:
  §3, §4 and §8 marked as retired by this row. `docs/BROADCAST-MODEL.md`:
  no change (it describes the interpreter). `docs/ERROR-MODEL.md` §7 (a
  dated log) still describes the removed lowering; not changed. No page
  under `~/dev/cortexjs.io/docs/compute-engine/` describes a removed
  mechanism.
- **Choices, each reversible.** (1) `_SYS.cond` reads an absent condition as
  `false`; the alternative was to let it throw (the caveats allow both). (2)
  The per-operator absent tests above are removed in this row; the
  alternative was to leave them for row 3. (3) The reads of a type without
  its `missing` arm that choose a shape (`typeContainsMissing`,
  `stripMissingFromType`, `isGated*`, about 100 sites) stay for row 3. (4)
  `_CND` is no longer a reserved emitted name.
- **What row 3 (admission and shapes) can rely on.** No compiled code tests
  whether an operand is absent to compute on it; the reads of a type without
  its `missing` arm that remain choose a shape, in `compile-broadcast.ts`,
  `compiler-type-facts.ts`, `static-shape.ts`, `compile-point-calls.ts`,
  `compile-user-calls.ts`, `compile-user-functions.ts`,
  `interval-javascript-target.ts`, `javascript-target.ts`,
  `python-target.ts` and `compile-lanes.ts`.
- **What row 7 (error model) can rely on.** The Kleene and decidability
  functions that the table above gives to row 7 are gone. Left for row 7:
  the throw of `_SYS.cond` for a non-boolean value that is not absent, the
  non-boolean throw of `predicateResult`, `isDecidedLoopIndex` in
  `javascript-value-facts.ts` (one reader in `compiler-type-facts.ts`), the
  `Nothing` refusals and the omission tests of callback results.

The result of step 4, row 3 (admission and shapes; 2026-11-04, session
compute-engine-cb; base `2e3ac5fd40e0b62538b39acddb1e3aa37b48e6d8`; staged,
not committed).

- **The survey, admission check (`compile-admission.ts`, 1,601 code lines
  at base).** Probes show that each input that item 3.4.4 made a static
  error declines before `assertAdmitted()` runs: `Block(Declare(p,
  "real"), If(x > 0, p ≔ 1), p)` (`declaration-without-value`),
  `1 + Assign(t, 2)` (`assignment-in-operand`), `Block(p ≔ 0, p ≔ [1, 2],
  p)` (`assignment-type-mismatch`), `Block(If(x > 0, p ≔ [1, 2], p ≔ [3,
  4]), 2p)` (`first-assignment-in-branch`); and a write to an input
  (`c ≔ n + 1`, `Block(c ≔ [1, 2], c)` with `c: real`) declines in
  `assignLValue()` (`compile-locals.ts`) while the code is generated. Kept,
  with the rule each one serves: R1 (`untypedInputs`, `inputsOf`,
  `untypedInputsOf`, `isUnboundUntypedName`, `isUntypedType`,
  `throwUntypedInputs`, `assertNoDeclaredTopOperands`, `namesReadIn`; 140
  lines); R2/R4 (`declaredUnionInputsOf`, 31); R3 for a conditional
  (`knownCondition`, `droppedOperands`, `droppedOperandsOf`,
  `hasScalarCondition`, `isShaderTarget`, `operandUse`,
  `conditionalBranches`, `hasConflictingBranches`, `haveConflictingShapes`,
  `haveConflictingTypes`, `hasNoSettledShape`; 174), for a call (the
  `Return` values and the last value of a body: `endValuesOf`,
  `unitValuesOf`, `hasConflictingValues`, `returnValuesIn`; 106; the static
  type of a `Block` with a `Return` is the type of its last value only, so
  `Block(If(1 < x, Return([1,2])), x)` is typed `real` and the values must
  be collected), for `Match` (`matchCasePartsOf`, `caseScopes`,
  `caseScopeOf`, `codeOperandsOf`, `localScopesOf`; 70) and for a local
  (`assignedTypesOf`, `targetTypesOf`, `statedTypeOf`, `complexMode`,
  `assignedTypesConflict`; 75); the R3 driver and messages
  (`unsettledShapeIn`, `assertAdmitted`, `throwUnsettledShape`; 370). The
  effect declines of "Fail closed" are not among R1 to R6, but each one
  guards a value that the compiled code would get wrong, and each is still
  reachable (probes): `scoped-assignment` (`Block(p ≔ 0,
  Comprehension(Block(p ≔ 5, i), i ∈ [1]), p)`; CE-720 for a callback),
  `index-assignment` (CE-723), `elementwise` (CE-722), `return-in-loop`
  (CE-719); they stay (`assignmentConflictIn` 210, `scopedPartsOf`,
  `changesState`, `parameterName`, `parametersOf`, `CLAUSE_OPERATORS`,
  `clauseIndexNames`, `ownLocalNames`, `writesOuterName` 165,
  `returnInLoopIn` 49). `assignmentConflictIn` is still reached by a local
  with a real and a complex value, by a local of type `unknown`, and by a
  parameter assigned a value of another shape.
- **The survey, run-time shape tests.** A temporary probe at each site, run
  over the 651 test files that call `compile`, gave the operand types that
  reach it. Kept: the `broadcastable<T>` lowerings (`PointList`, `Dot`,
  `Norm`, the point list over numbers; `broadcastable<T>` asks for the
  element-wise map at run time, `unionShapeMembers()` does not read it as a
  union), `_SYS.absShape` for a `broadcastable` point or a nested point
  collection, the `NaN` guard of an opaque `PointList` component (`unknown`
  or `value`, a test for a value outside the type; reading it as a number
  adds a branch and removes no test), the guarded fold of `Max`/`Min` and
  `Sum`/`Product` (`emitCollectionReduce(…, true)`, which also serves folds
  whose elements have a settled shape), and the absence tests (rows 2 and
  7). In `compiler-type-facts.ts`, the `isGated*` helpers,
  `gatedCollectionArms` and `presentCompilationType` read a type without
  its `missing` arm to choose a static shape and emit no test;
  `jsComplexObjectTest` is the clause guard of a user function with clauses
  (a dispatch on a declared parameter type, R2); `shapeOperandRefusal` is a
  static decline of `Shape`/`Rank`. The 145 `Array.isArray` tests of
  `javascript-runtime.ts` serve the emissions that stay, less the one of
  `pointOrPoints`. The full survey (per site, with the probe hits) was the
  scratch file `docs/scratch/2026-11-04-step4-row3-survey.md` of the
  worktree; its content is in this record.
- **What was removed.** In `compile-admission.ts`: `assignedInputConflict()`
  (36 lines; a write to an input now always declines in `assignLValue()`,
  and a name that `assignLValue()` accepts as a local is compared by
  `assignmentConflictIn()`; a probe on its `return` line was reached by no
  test), with the `assignedInputs` map of `analyzeReferences()`
  (`compile-references.ts`) and the `assignments` set of `namesReadIn()`;
  the comparison of the `Break` values of a `Loop` (`breakValuesOf()`, the
  `Break` mode of `controlValuesIn()`, now `returnValuesIn()`, and the
  `Loop` branches of `endValuesOf()` and `hasConflictingValues()`): every
  target compiles `Break(v)` to `break` and drops `v`, and a loop whose
  value is used and that has a `Break` declines as `loop-value`, so the
  check could only decline a discarded loop value on a shader target
  (witness `crafted`). In the targets: `_SYS.pointOrPoints` (the emission in
  `compileJSSelection()`, its `cellOf` branch and the runtime helper); the
  `'runtime-list'` and `'runtime'` plans of `Add` in `tryCompileBroadcast()`
  with `runtimePointShapeIsUnambiguous()`; the `_SYS.absShape` emission for
  a union operand in `compileExpr` (`compiler-core.ts`) with
  `unionAdmitsFlatNumericList()` and `isPointSumOperand()`; the run-time
  role test of a `PointList` coordinate of an operand typed
  `collection<any> | tuple`; the fallback of
  `compileDeclaredUnionDispatch()` that compiled one body for every member
  of a declared union input, with shape tests inside it, when the body of
  one member declined. Each removed test became the R3 decline, through a
  new helper `unsettledShapeDecline()` (`diagnostics.ts`).
- **A wrong value fixed on the way.** The `Abs` lowering of a value of type
  `list<number> | tuple<number, number>` that is not an input took the
  element-wise route on JavaScript: with `H` declared `(real) ->
  list<number> | tuple<number, number>`, `|H(t)|` compiled to
  `_SYS.bcast((_tv1) => _SYS.absAny(_tv1), H(_.t))` and gave `[3, 4]` for
  the point `(3, -4)`, where the interpreter gives `5` (found by review round
  1; GLSL, interval-js and Python already declined). It now declines on
  every target.
- **New declines, each with the declaration that settles the shape
  (CHANGELOG, "Behavior Changes").** With `W: (real) -> tuple<real, real> |
  list<tuple<real, real>>`, `F: list<boolean>`, `L: list<tuple<real,
  real>>`: `If(F, W(t), (0, 0))`, `W(t) + L`, `Sum(L) + (1, 1)` (the type of
  `Sum(L)` is `integer | tuple<real, real>`, because the sum of an empty
  list is `0`), `|H(t)|` above. With `U: real | list<real>`: `Sum(U)`,
  `Product(U)`, `If(x > 0, U, x)`, and on interval-js `U + w`, `U < 3`.
  With `p` undeclared: `PointList(p.y, p.x)` (inferred `collection<any> |
  tuple`). A function whose parameter is declared `list<tuple<number,
  number>> | tuple<number, number>` and that the parameter dispatch emits as
  one body: `g(Q)` with `g(P) = |P − (4, 0) − (1, 2)|`. Witnesses: Tycho
  found no host function with a point-or-list result type (`tycho-f9`,
  2026-11-04: 0 occurrences of `_SYS.pointOrPoints` in the whole-corpus
  codegen records of Tycho `a34405ae0` on CE 0.178.0), and the corpus
  measure below has no new decline, so no form has a `corpus` witness; the
  test files that pin them (`tycho-item-249`, `tycho-item-253`, `ce-514`)
  came from Tycho items, so they are `plausible`. These declines are what
  R2 to R4 require, so no question goes to the user. Still compiling, with
  the interpreter's values (tests added): an input declared
  `tuple<number, number> | list<tuple<number, number>>` or the 3-D form
  (Tycho declares document symbols with this union,
  `DocumentCEManager.POINT_OR_POINT_LIST_2D`/`_3D`) as an `If` or `Which`
  branch, `P + L` for such an input `P`, a literal applied where it is
  written (`(v ↦ PointList(v.y, v.x))(P)`), and `k((x, y))` and `g(Q)`
  with `g(P) = |P − (4, 0)|`.
- **Code lines** (`.ts`, not blank, `//`, `/*` or `*`): `compilation`
  91,168 → 91,017 (−151); `compile-admission.ts` 1,601 → 1,534. Source: 8
  files; with the tests, CHANGELOG and `COMPILATION-MODEL.md`, 21 files, 508
  insertions, 678 deletions. The table above estimated 1,461 + 531 + 830
  lines "in part" for this row: most of the admission check serves R1, R3
  or an effect decline, and most of `static-shape.ts` and
  `compiler-type-facts.ts` chooses a static shape or is the binding
  dispatch.
- **Tests.** No test file deleted, no snapshot changed. One file added
  (`compile-unsettled-shape-operands.test.ts`: the new declines, and the
  declared union input that still compiles). Rewritten to assert the
  decline (each pinned a compiled value of a removed run-time test):
  `compile-admission.test.ts` (1 test), `compile-interval-collections.test.ts`
  (`Sum(U)` and 3 messages), `compile-entry-string-refusal.test.ts` (the
  entry refusal is now tested with `Max(S)`), `compile-call-broadcast-result-operand.test.ts`
  (1), `tycho-item-249-union-collection-operand.test.ts` (3),
  `tycho-item-253-abs-union-point-param.test.ts` (3 and comments),
  `compile-complex-tensor-entries.test.ts` (2), `ce-514-point-accessor-of-possible-list.test.ts`
  (2), `point-accessor-union-type.test.ts` (1). `compile-when-nested-mask.test.ts`:
  the decline of the point-or-list arm and the union input arm (2-D, 3-D,
  `If`, `Which`).
- **The corpus measure** (Tycho frozen at `a34405ae0`, the copy of rows 1
  and 2, a plain `git archive` with no patch; the tools of 3.4.1 with
  records keyed by MathJSON; base run on `2e3ac5fd4`). Three candidates: the
  first part (the admission removals and `pointOrPoints`), the four groups of
  run-time tests, and the final tree after the review fixes. Each: 17,825
  compiles, 13,707 keys and 77,267 values in both runs; 0 changed values, 0
  new throws; declines javascript 47, glsl 44, interval-js 61 in both runs,
  no new decline and none gone.
- **Review**: Claude and Codex, two rounds. Round 1: Codex, no finding;
  Claude, one medium (the `Abs` wrong value above, fixed with the decline),
  four low (outdated comments of `isRuntimePointShaped`, `_SYS.absShape`
  and `UNSETTLED_SHAPE_CODE`; a new `unknown` branch of `compileJSPointList`
  that added code and removed no test, reverted) and two nits (a comment, a
  two-state flag made a `boolean`), all fixed. Round 2 (Claude, on the
  fixes): one low and one nit (outdated comments in `compile-broadcast.ts`
  and `tycho-item-253-abs-union-point-param.test.ts`), fixed. No third
  round: round 2 had no `high` or `medium` finding.
- **Checks** (in the worktree, on the final tree; the 21 files are byte for
  byte the files copied to the main tree): typecheck (after-edit hook and
  `tsc --noEmit`), `oxlint` on the changed files, `check:deps`, the 651 test
  files that call `compile` (30,140 passed), `test:core` (5,501 passed),
  the full suite (1,821 suites, 77,814 tests, 0 failed, 4,295 snapshots),
  `npm run test:python` (49 suites, 2,768 tests, 0 failed), the corpus
  measure.
- **Documents.** `docs/COMPILATION-MODEL.md`: R4 states that a declared
  union input declines when the body of one member declines; "A value with
  no settled shape declines" loses the `Break` values and gains the declines
  above. No page under `~/dev/cortexjs.io/docs/compute-engine/` describes a
  removed mechanism or the new declines' forms, so none was edited.
- **Choices, each reversible.** (1) The fallback of
  `compileDeclaredUnionDispatch()` declines (the alternative: keep one body
  over the union with shape tests inside, which R2 forbids; it kept 28
  compiled results in the tests). (2) The parameter dispatch
  `emitDeclaredUnionParameterDispatch()` keeps its fallback to the ordinary
  definition when a variant cannot be built; the in-body tests that this
  fallback reached are now declines (`g(Q)` above). The alternative, one
  variant per member for every body, is new code. (3) No dispatch at the
  binding of a function-literal parameter declared with a union: such a
  literal declines where its body needs a shape test. (4) The guarded fold
  of `Max`/`Min`/`Sum`/`Product` stays: its tests also serve elements of a
  settled shape (lists of rows, of points, of matrices), and removing them
  needs a static lowering for each of six callers, which is new code and
  not a removal (proposed as a separate task, not recorded in ROADMAP). (5)
  The opaque `PointList` component keeps its `NaN` guard. (6) The effect
  declines stay (each guards a wrong value).
- **What row 4 (block locals) can rely on.** No compiled code writes an
  input, and the admission check no longer compares the value written to an
  input (`assignedInputConflict()` is gone); the value of a `Break` is not
  compared. Left to row 4, all reachable today (probes above): `isBindingBlock`,
  `hasKeptBreak`, `isUnrepresentableLoopValue` and the `nothing-value`,
  `block-value` and `loop-value` part of `unsettledShapeIn()` (112 lines;
  row 4 removes the loop-value and the block-as-value lowerings that they
  guard), `returnInLoopIn` (49), and the local-shape part of
  `assignmentConflictIn` (of its 210 lines; it also holds the effect
  declines `index-assignment`, `elementwise` and `scoped-assignment`), with
  `assignedTypesOf`, `targetTypesOf`, `statedTypeOf`, `complexMode` and
  `assignedTypesConflict` (75).

The result of step 4, row 4 (block locals; 2026-11-04, session
compute-engine-33; base `877a7aa9b20fde51f68c22e81106dea9bf1ae1a9`; worked
in `/tmp/wt-compute-engine-33` by two implementers in turn; staged, not
committed).

- **The survey.** A counter at each decline or at the entry of each
  lowering (removed after), the 389 test files that call `compile` and name
  `Assign`, `Declare`, `Block`, `Loop` or `vars` (20,551 tests), and direct
  compilations on `javascript`, `glsl`, `wgsl`, `interval-js` and `python`
  (also Python, GLSL and WGSL `compileFunction()` and WGSL
  `compileFieldFunction()`). Removed, with the error or decline that comes
  first:
  - `classifyLocalReads`, `localReadWithNoWrite`, `localReadOnSomePaths`,
    `loopRunsOnce`, and `STRICT_OPERATORS` (`compiler-tables.ts`, read only
    by this analysis): a read of a local on no path or on some paths only
    is `read-before-declaration` or `first-assignment-in-branch` at
    canonicalization (`Block(Declare(a), If(c, Assign(a, 1)), a)`,
    `Block(If(c, Assign(a, 1)), a)`). No test reached either decline.
  - `splitChainedAssignments`, `chainedLocalDeclares`,
    `chainedAmbientWrite`, the `chained` option of
    `withImplicitLocalDeclares`, the chained branch of
    `compileStatementList` and of the loop-body statements,
    `chainedLocals` (`compile-references.ts`) and `scopeChainBinds` (no
    caller left): `Block(Assign(t, Assign(u, x)), t + u)` is
    `assignment-in-operand`, and LaTeX and Epsil `a := b := v` is the parse
    error `chained-assignment`.
  - `nestedOnlyLocals` and the loop of `compileBlock` that read the shape
    of a local from the assignments in nested blocks: a local whose only
    value is in a branch is `first-assignment-in-branch` or
    `declaration-without-value`.
  - `localVarsObjectStatement` (three uses, JavaScript and interval-js):
    it copied the `vars` object only when `inputWrites` was not empty.
  - `inputWrites` and `inputLocals` (`CompileTarget`), the record of a
    write in `assignLValue()`, every target's local copy of a written input
    and its second compilation (JavaScript, interval-js, the Python
    `compileOrThrow` and the module-global copy of `compileFunction()`, the
    shader `compileOrThrow`, `compileDeclaredFunctionBody` and
    `withInputLocalCopies`), `gpuWrittenFirst`, `pythonWrittenFirst`, and
    the input-local tests of `gpu-at.ts` and `gpu-functions.ts`:
    `Block(Assign(x, x + 1), x)` with `x: real` declines on every target
    with "`x` is not a local of the compiled expression"
    (`assignLValue()`) before any write is recorded.
  - The tail-assignment code of Python and WGSL (the `return <name>` after
    a last assignment in both block hooks, `pythonAssertReturnedBlock`,
    `wgslAssertFunctionBody`, `WGSLFunctionBodyShape` and the
    field-function host member `assertBody`): see "The block that ends in
    an assignment" below.

  Reduced: `assertLocalsAssignedBeforeRead` now checks only the first
  value of a local, and its decline is needed: in `Block(Assign(x, x + 1),
  2x)` with no binding of `x`, and in the parse `x \coloneq x+1; 2x`, the
  first value reads the enclosing binding, which compiled code does not
  have (`compile-assignment-value-shapes.test.ts`). Its walk of the other
  statements is gone.

  Kept, with the compiled input that reaches it:
  - `nestedAssignmentsTo`: the decline of a write to a loop index in
    `compileForLoop` and `compileComprehension` (`Loop(Block(Assign(i, 5),
    …), Element(i, Range(1, 3)))`, `Comprehension(Block(Assign(i, 5), i),
    Element(i, Range(1, 3)))`; `compile-admission.test.ts`,
    `function-body-local-assignment.test.ts`). These are valid programs,
    and the decline guards a wrong value (the emitted loop would keep the
    written index).
  - The local shape frames (`withLocalShapeFrame`, `_pushLocalComplex`,
    `_popLocalComplex`, `_localComplex`, `_localVector`): every block
    local, parameter, loop body and callback reaches them on every target.
    They give a shader local its declared type (`float`, `vec2` for a
    complex local, `vecN` or an array) and the lane analysis the
    complex-ness of a local, and `assignLValue()` reads them to tell a local
    from an input. The 3.4.4 record said they serve only a local with no
    target spelling; they serve every local. Replacing them with a read of
    the static type is a redesign, not a removal.
  - `reachesCallerCode` (`compile-folding.ts`): it also finds the code of
    `functions` and `operators` entries and of `compile` handlers
    (`compile-gpu-extremum.test.ts`, `random-compile.test.ts`).
  - The effects contract of `vars` code: reached (`vars: { W:
    'nextValue()' }` in the same tests). Its predicate is read in about 25
    places (CSE, the fixed-width unroll, constant folding, the bigint lane,
    the draw order of the shader targets), and `isOpaqueVarsSource` also
    counts a plain read such as `'u_u'` as caller code, so removing it
    changes the compiled code of plain `vars` maps. Not done; it would be
    its own item, with the paragraph of `docs/COMPILATION-MODEL.md` that
    starts "Code that the caller supplies is held to the interpreter's
    order".
  - The loop-value lowering: the bare loop `(() => { while (true) { … }
    })()` whose `return` gives the value compiles (`Block(Assign(k, 0),
    Loop(Block(Assign(k, k + 1), If(k > x, Return(k), Nothing))))` on
    JavaScript, interval-js and Python), so it stays.
  - Row 3's list in `compile-admission.ts` (`isBindingBlock`,
    `hasKeptBreak`, `isUnrepresentableLoopValue`, the `nothing-value`,
    `block-value` and `loop-value` search of `unsettledShapeIn()`,
    `returnInLoopIn`, the local-shape part of `assignmentConflictIn` with
    `assignedTypesOf`, `targetTypesOf`, `statedTypeOf`, `complexMode`,
    `assignedTypesConflict`): each serves a decline that stays. The
    local-shape part of `assignmentConflictIn` is reached by a local whose
    first value has type `unknown` and that later gets a list (3.4.4,
    choice 10) and by `Block(a ≔ 1, If(c > 0, a ≔ √(-x)), a)` in `strict`
    (3.4.4, rule 7).
- **The block that ends in an assignment.** The declines `nothing-value`,
  `block-value` and `loop-value` are found before the code is generated
  (`unsettledShapeIn()`) and thrown after it (`assertAdmitted()`), so a
  more specific decline of the code generation stays the reason (90 of
  the 216 such findings in the tests). Thrown before the code generation,
  26 tests in 14 files change their decline code or message (for example
  `shared-impure-operand` becomes `unsettled-shape`); that option was
  rejected. Done instead: `CompilerState._pendingAdmission` holds the root,
  the target and the search result of the outermost compilation
  (`compile()`, `compileCseRoot()`), and `compileBlock()` calls
  `throwPendingUnsettledShape()` when the last statement of a block whose
  value is used is an `Assign` or a `Declare`, after the statements are
  compiled (so their declines, and the `assignLValue()` decline of a write
  to an input, stay first) and before the value is lowered. On Python and
  WGSL the site declines also when no decline is pending (no input reaches
  that case). The JavaScript IIFE code of a last `Declare` and the shader
  `valueBlock` hoist of a last assignment stay: a block that the lowering
  compiles as a value but whose value the admission search does not count
  as used reaches them and compiles (`If(0 < x, Block(Assign(y, 1),
  Assign(y, y + 1)), Assign(y, 3))` on JavaScript, interval-js and GLSL;
  a nested block that is a statement on JavaScript and interval-js). No
  lowering serves only a `block-value` case (the same IIFE and hoist lower
  a binding block). One decline message changed, and no test asserts it:
  Python `[1, Block(Assign(b, 2))]` gave the generic "a multi-statement
  construct … cannot be used as a sub-expression" and now gives the
  `nothing-value` message.
- **Code lines** (`.ts`, not blank, `//`, `/*` or `*`): `compilation`
  91,017 → 90,277 (−740): 712 for the first part, 28 net for the block
  that ends in an assignment (its mechanism adds about 45 lines).
  `compile-locals.ts` 1,136 → 675, `gpu-shader-target.ts`,
  `python-target.ts` and `wgsl-target.ts` most of the rest. Source: 22
  files, 209 insertions, 1,479 deletions with the one test comment. The
  3.4.4 record listed 742 lines: of those, the frames (104 by that
  record), `reachesCallerCode` (55) and `nestedAssignmentsTo` (33) stay,
  reached as above, and the input re-compile paths of the targets, which
  that list did not count, went.
- **Tests.** No test file deleted, no assertion or snapshot changed; one
  comment that named `classifyLocalReads()` rewritten
  (`test/epsil/function-body-local-assignment.test.ts`). The removed code
  had no test of its own left after 3.4.4.
- **The corpus measure** (Tycho frozen at `a34405ae0`, the plain
  `git archive` of rows 1 to 3, records keyed by MathJSON; base run: row
  3's final run `cand3`, on `2e3ac5fd4` with row 3's final patch, whose
  source hunks are those of `877a7aa9b`; tycho-f9 had no base run). One
  candidate on the final source before the review fixes (the fixes are
  comments and one `?? null`): 17,825 compiles, 13,707 keys and 77,267
  values in both runs; 0 changed values, 0 new throws; declines javascript
  47, glsl 44, interval-js 61 in both, none new and none gone. Tycho main
  now has the 0.178.0 adoption (`f51646a04`, tycho-f9, 2026-11-04), a
  base for a later row that wants Tycho's current routes.
- **Review**: Claude and Codex, one round. Codex: no finding. Claude: three
  low (the decline of `throwPendingUnsettledShape()` with a caller
  `compile` handler can come where `assertAdmitted()` would not decline,
  crafted, documented in its comment; a `compileBlock` comment that named
  a case the check never sees; a comment of `freeSymbolOccurrence()` that
  named the removed local copy) and two nits (a `?? null` that did
  nothing, two long comment lines), all fixed. No round 2: round 1 had no
  `high` or `medium` finding.
- **Checks** in the worktree, on the final tree (the 23 files are byte for
  byte the files copied to the main tree): `npm run typecheck`, `oxlint` on
  the changed files, `check:deps`, the 389 test files (20,179 passed), the
  full suite (1,821 suites, 77,814 tests, 0 failed, 4,295 snapshots),
  `npm run test:python` (49 suites, 2,768 tests, 0 failed), the corpus
  measure.
- **Documents.** CHANGELOG, "Breaking changes": the removed
  `CompileTarget` fields `inputWrites`, `inputLocals` and the nine
  `BaseCompiler` static members. `docs/COMPILATION-MODEL.md` describes
  none of the removed mechanisms (no edit). User-facing page edited:
  `~/dev/cortexjs.io/docs/compute-engine/13-guide-compile.md` (the WGSL
  storage-buffer paragraph said a body that writes an input reads and
  writes a local copy; it now says such a write declines on every target).
- **Choices, each reversible.** (1) The block that ends in an assignment
  declines at its site, after the statements of the block (the
  alternative: keep the code generation and the late decline, 28 lines
  more and no new state; or decline before the code generation, which
  changes 26 decline codes). (2) The local shape frames,
  `reachesCallerCode`, the `vars` effects contract and the loop-value
  lowering stay (reached; their removal is a redesign or changes compiled
  code). (3) `assertLocalsAssignedBeforeRead` keeps the check of the first
  value (its decline is reached).
- **What row 5 (function values) can rely on.** The static type of a
  local, its target spelling, the `Declare` with a value, the local shape
  frames, `_localValueFrames`, `_localNameKeys`, `blockLocalOf` and
  `assignLValue()` are unchanged, so row 5 starts from a local whose type
  is known. No compiled code writes an input, and no target compiles an
  expression a second time for a write. None of the function-value code
  that the 3.4.5 record lists (`absentFilledArguments`,
  `literalDefaultFills`, `defaultFillingWrapper`, the currying and
  partial-application lowering, the function-typed variable references)
  was touched.

The result of step 4, row 5 (function values; 2026-11-04, session
compute-engine-40; base `882252b22554fa95ba2d2ce7c0b4b1479e4606fa`; worked
in `/tmp/wt-compute-engine-40` by one implementer; applied to the main tree
on `8e9c12ea5`, whose one new commit changes only the Epsil formatter and
`CHANGELOG.md`; staged, not committed).

- **The survey.** A counter at the entry of each candidate (removed after),
  the 658 test files that call `compile` and name `Apply`, `Function`,
  `Map`, `Filter`, `Sort`, `Fold`, `Reduce`, `Derivative` or a local
  function, and 32 direct compilations on `javascript`, `glsl`, `wgsl`,
  `interval-js` and `python`, compared with the same compilations on the
  base. Removed, with the decline that comes first:
  - The run-time call of a reassigned local function. In
    `tryCompileLocalFunctionCall` (`compile-user-functions.ts`) the check of
    a rebound name now comes first, before the lookup in `localFunctions`,
    and it declines with "…its value is a function value known only at run
    time, which compiled code does not call". The branches after it never
    ran: the throw of the entry's `decline`, the guards of the default
    completion, of the constant fold and of the body inlining, and two
    `rebound` throws (a one-point call, a tuple bound whole). Example:
    `Block(Declare(k, function, x ↦ x + 1), Assign(k, (x, y) ↦ x + y),
    k(u))` declines on JavaScript, interval-js and Python; GLSL and WGSL
    decline before it on the function literal. A rebound name with no
    scope entry, which went on to the engine lookup before, now declines
    there too (no test or corpus record reaches it).
  - In `reboundLocalNames` (`compile-loops.ts`): the three specific
    reasons (the values have different signatures; a value is not a
    function literal; the call does not return a function literal on every
    path), the `literal`, `literals` and `decline` fields of each entry, the
    `writes` map and the `values` and `writers` records. The result is the
    set of names (`ReadonlySet<string>`); `ReboundFunctionLocals`
    (`compiler-types.ts`) is gone. `reboundFunctionScope` keeps only the
    names, and `noteLocalFunction` no longer puts the literal of a rebound
    name in `localFunctions`.
  - The `callable` branch of `callbackExcludesNothing()`
    (`compile-inner.ts`) that read the literals of a rebound name: it now
    answers "cannot prove" (`false`), and any use of the name declines in
    `assertNoFunctionValue()`.

  Kept, with the compiled input that reaches it:
  - `partial-application.ts`, all of it (109 code lines on this base; the
    227 of the 3.4.5 record counted `partialApplicationValue` and
    `curriedApplication`, which `2e3ac5fd4` had already removed). What is
    left is the declines and the typing pass of applied literals:
    `assertNoCurriedApplication` (`Apply(Apply(Function(x + y, x, y), 1),
    u)`, `compile-partial-application.test.ts`), `isPartialApplication`
    with `partialApplicationValueDecline` on JavaScript, Python and
    interval-js (`Apply(Function(x + y, x, y), 1)`), the GPU
    `partialApplicationDecline`, and `rewritePartialApplications`
    (`issue-498-applied-literal-parameter-type.test.ts`). Its callers in
    the targets are unchanged.
  - The set of names of `reboundLocalNames`, with
    `returnedFunctionLiterals` (`compile-conditions.ts`): in `const mk =
    (n) => (x) => x + n; let a = mk(2); a(1)` the name `a` is in the set
    only through the rule "bound from a call that returns a function"
    (`compile-function-returned-by-call.test.ts`). The static type of a
    call of a block-local function does not show a function, so
    `assertNoFunctionValue()` alone does not decline it. The set is the
    same as before.
  - The rebound-operand decline of `assertNoFunctionValue()` (reached), the
    Reduce-combiner test of a rebound name in `javascript-target.ts` (not
    reached; kept because `callbackLiteral()` falls back to the engine
    definition when the name is not bound) and the `has()` test of
    `compile-inner.ts` (sound, one line).
  - The five modules of the table (`compile-callbacks.ts`,
    `compile-user-functions.ts`, `compile-user-calls.ts`,
    `compile-function-literals.ts`, `compile-user-specialization.ts`):
    outside the rebound branches, no code that only a function value, a
    curried call or a partial application reaches. Their "function value"
    code serves `Map(f, L)` with a defined `f`, which stays.
  - `boxed-expression/lazy-view-context.ts`, unchanged. It is interpreter
    code: `retainScope`, `isRetainedScope`, `noteNodeScope`, `isNodeScope`
    and `retainCallFrameOfResult` keep a call frame alive for closures and
    lazy views, which the interpreter keeps. Its records
    (`recordLazyViewContext`, `contextsForRead`, …) were made for CE-728,
    the symbol default read at the call site (`ec7c7ab1c`), and also serve
    a lazy view that outlives its loop. With the two record entry points
    off, the 244 lazy-view and closure test files passed (15,905 tests).
    Their removal takes about 290 interleaved lines out of
    `function-utils.ts` and `boxed-function.ts`: an interpreter change, not
    a compiler removal, so it is not in this row (proposed to the user as
    its own item, not recorded in `ROADMAP.md`).
- **Code lines** (`.ts`, not blank, `//`, `/*` or `*`): `compilation`
  90,277 → 90,126 (−151); `boxed-expression` 83,748 → 83,748. Source: 8
  files; with the two test files, 143 insertions and 333 deletions.
- **Tests.** No test file deleted and no test removed; no snapshot
  changed. Three assertions now expect the one decline of a rebound name
  in place of a removed specific reason (two in
  `compile-function-returned-by-call.test.ts`, one in
  `compile-block-local-function.test.ts`, whose title lost "with the
  reason").
- **The corpus measure** (Tycho frozen at `a34405ae0`, the copy of rows 1
  to 4, records keyed by MathJSON; tycho-f9 had no session to ask; base
  run: row 4's final run `cand1` on row 4's source, whose later fixes were
  comments). One candidate on the final source before the review fix (a
  comment): 17,825 compiles, 13,707 keys and 77,267 values in both runs;
  0 changed values, 0 new throws; declines javascript 47, glsl 44,
  interval-js 61 in both, none new and none gone.
- **Review**: Claude and Codex, one round. Codex: no finding (its
  context note was not passed: `codex-review.sh --files` read `--note` as
  a file name). Claude: one nit (the comment of `reboundLocalNames` on
  when the result is empty did not name the call whose type has a
  function member), fixed. No round 2: round 1 had no `high` or `medium`
  finding.
- **Checks** in the worktree (the 10 source and test files are byte for
  byte the files applied to the main tree): `npm run typecheck`, `oxlint`
  on the changed files, `check:deps`, the 658 test files (33,692 passed),
  `test:core` (5,501 passed), the full suite (1,821 suites, 77,814 tests,
  0 failed, 4,295 snapshots), the corpus measure. In the main tree:
  `npm run typecheck`, and `oxlint` on the file of the review fix. Not
  run: `npm run test:python` (`python-target.ts` did not change; the
  direct Python compilations gave the base's output).
- **Documents.** CHANGELOG, "Breaking changes": `CompileTarget.reboundFunctions`
  is a set of names, and the `BaseCompiler` statics `reboundLocalNames`,
  `reboundFunctionScope` and `noteLocalFunction` change signature.
  `docs/COMPILATION-MODEL.md`: the interval-js root paragraph no longer
  names a partial application as a function-valued root (it declines). No
  page under `~/dev/cortexjs.io/docs/compute-engine/` describes a removed
  mechanism (`13-guide-compile.md` and `87-reference-functions.md` state
  the rule and its declines).
- **Choices, each reversible.** (1) One decline reason for every call of a
  rebound name (the alternative: keep the signature and non-literal
  reasons, about 35 lines that serve only a message). (2)
  `CompileTarget.reboundFunctions` became a `Set` (the alternative: keep
  the `Map` type with empty entries, with no breaking-change entry). (3)
  `partial-application.ts` and `lazy-view-context.ts` stay, as above.
- **What row 6 (the complex lane by static type, with CE-751) can rely
  on.** No lane code changed: the `auto` discipline, the promotion, the
  `LaneMismatch` redo and the lane recording in `compile-callbacks.ts`,
  `compile-user-functions.ts` and `compile-user-calls.ts` are as on
  `882252b22`. A call of a rebound local function declines before any lane
  decision, so row 6 has no run-time callee whose lane is unknown.
  `compile-user-specialization.ts` (one body per argument shape) is
  unchanged.

The result of step 4, row 6 (the complex lane, with CE-751; 2026-11-04,
session compute-engine-77; base `1e6b928fb3d649ba0cdb1b059745d96852c96100`; worked in
`/tmp/wt-compute-engine-77` by one implementer; applied to the main tree on
`6bc4d0f86464ed9dee816c4c3dd72c0f7c1e9c5f`, whose commit does not change the files of this row; part 1
staged, not committed; part 2 stopped for a user decision).

- **The survey.** A temporary probe at each candidate of the 3.4.6 list
  (removed after), and the 301 test files that call `compile` and name
  `mode:`, `complex`, `promot` or `lane`. Removed:
  - `CompileTarget.reset` and its check in
    `engine-extension-contracts.ts`: no code calls it.
  - Already removed before this row, by commit `2e3ac5fd4` (2026-11-04):
    `CompilerState._promoted`, `notePromoted`, `recordPromotion`,
    `promotedDefinitions`, `hasPromotedDefinition` and their save and
    restore sites. That commit had no CHANGELOG entry; this row adds it.
  - No `LaneMismatch` redo and no restart remain: no code catches a
    `LaneMismatchError` to compile again.

  Kept, with the compile that reaches it:
  - The recursive-call retry (`emitWithRecursiveLaneRetry`, the
    `RecursiveLaneRetry` throws of `setUserFunctionLane` and
    `recordUserFunctionLane`): it runs in `strict`, for a recursive
    function whose base case is complex, for example
    `compile-lane-fixes.test.ts`, "complex base case, (integer) -> number,
    strict". Its removal changes values.
  - The promotion suppression of `compiler-mode.ts` (`_promotionSuppressed`
    and its wrappers): read in `mode: 'complex'` only, for example
    `compile-typed-real-ascription.test.ts`.
  - The `lane-mismatch` declines, all reached in `strict` (58 sites hit,
    most at a user-function parameter).
  - The `'auto'` entry of `COMPILE_MODES` (for the decline message), and
    the lane records per definition (`recordUserFunctionLane`,
    `_userFunctionLanes`, `recordUserFunctionParamLanes`), read by the GPU
    target, the pruning and CE-751.1.
- **Code lines** (`.ts`, not blank, `//`, `/*` or `*`): `compilation`
  90,126 → 90,125 (−1). Source: 3 files. No test file deleted, no test
  changed, no snapshot changed. The 3.4.6 list was mostly removed by
  `2e3ac5fd4`; the rest is reached.
- **The corpus measure** (Tycho frozen at `a34405ae0`, the copy of rows 1
  to 5, records keyed by MathJSON; tycho-f9 had no session to ask, so the
  commit of rows 1 to 5 was kept; base run: row 5's run `cand1`): 17,825
  compiles, 13,707 keys and 77,267 values in both runs; 0 changed values,
  0 new throws; declines javascript 47, glsl 44, interval-js 61 in both.
- **Review** of part 1: Claude and Codex, one round. Codex: no finding.
  Claude: one nit (the CHANGELOG wording on a target that keeps the
  field), fixed. No second round.
- **Checks** in the worktree (the 3 source files are byte for byte the
  files in the main tree): `npm run typecheck`, `oxlint` on the changed
  files, `check:deps`, the 301 test files, `test:core` (5,501 passed). In
  the main tree: `npm run typecheck`. Not run: the full suite (the change
  removes an optional member that no code calls), `test:python`, the GPU
  tests (no Python or GPU module changed).
- **Documents.** CHANGELOG, "Breaking changes": `CompileTarget.reset`, and
  the `BaseCompiler` statics of the promotion record. No paragraph of
  `docs/COMPILATION-MODEL.md` describes the promotion record, a redo or
  `reset`. `13-guide-compile.md` under
  `~/dev/cortexjs.io/docs/compute-engine/` names `auto` only in the
  paragraph that says it is removed and declines; no page names
  `CompileTarget.reset`. No page edited.
- **Part 2, CE-751.** The witnesses on the base, JavaScript: `Map(g, L)`
  with `L: list<number>` at `[1 + i, 2]` gives `[null, 4]` (not
  `[null, null]`) in `strict`; `hr(L[1])` gives `"[object Object]2"` in
  `strict` only. With `mode: 'complex'` both give the interpreter's
  values. In `strict`, `wideIsComplex()` answers false for `number`, and
  `typeHasComplexLeaf()` is false for a `number` element, so a `number`
  binding is on the real lane. A prototype of option (a) (the complex lane
  for a binding declared `number` in `strict`, a decline on GLSL, WGSL and
  interval-js), measured against the part 1 run: declines javascript 47 →
  117, glsl 44 → 82, interval-js 61 → 78; 15 keys (103 values) change;
  715 CE tests fail in 89 files. The same prototype set to decline on every
  target (option (b)): no value changes; declines javascript 47 → 109,
  glsl 44 → 86, interval-js 61 → 78, in 17 documents; 101 of the 112
  decline messages name `tuple<number, number>` or
  `tuple<number, number, number>`. Both are corpus witnesses, so part 2
  stopped. The prototype of (a) had three open problems: the annotation
  of a parameter cannot be read inside the body, an inferred `number`
  (an undeclared input) had to stay real, and a local declared `real`
  bound to an element of a `list<number>` gave `NaN` (interpreter `0`).
  The options were (a), (b), (c) (the rule of (a) or (b) only for a
  `number` outside a tuple, not measured) and (d) no compiler change and a
  documented rule. **Decision (user, 2026-11-04): (d).** In `strict` a
  value given for a binding typed `number` must be real; a complex value
  there gives an unspecified result; the host uses `mode: 'complex'` or
  declares the binding `complex`. Stated in `docs/COMPILATION-MODEL.md`,
  "Caveats of compiled code" and "Compile modes", and in
  `13-guide-compile.md` of the user guide. CE-751 is removed from
  `ROADMAP.md`. The prototype patch is in the scratchpad of this session
  (`ce751-prototype.patch`).
- **What row 7 (the error model) can rely on.** Row 6 changes no lane code:
  the lane of a binding in `strict` follows its static type, `number` is
  real, and the recursive-call retry, the promotion suppression of
  `mode: 'complex'` and the `lane-mismatch` declines stay as on
  `1e6b928fb`. `javascript-value-facts.ts` and the absence module are not
  changed by this row. With decision (d) for CE-751, a `number` binding stays
  real, so row 7 can treat a complex value at a `number` binding in
  `strict` as outside the contract.

The result of step 4, row 7 (the error model; 2026-11-04, session
compute-engine-49; base `0c201d2e95ef73c262a5229881d2389714b1f3a1`; worked
in `/tmp/wt-compute-engine-49` by one implementer; applied to the main tree
on the same commit; staged, not committed).

- **The survey and what was removed.**
  - (a) `Nothing`. Removed: `callbackExcludesNothing()` (the proof that a
    callback cannot return `Nothing`), `isElementReadWithoutNothing()`, and
    the test of a callback's result inside
    `assertCollectionOmissionSupported()`. Kept as one decline:
    `assertNoNothingElement()` in `compile-inner.ts` (the renamed function;
    no `target` argument), which reads only static types. It declines a
    `Tuple` whose coordinate or slot type admits `nothing`, and a
    collection operation (the same operators as before) whose source or
    result element type admits it. `any` admits `nothing`, `unknown` does
    not (`provablyAdmits`). One diagnostic code, `possible-nothing`
    (`possibleNothingDecline()` and `nothingOperandDecline()` in
    `diagnostics.ts`), also for the symbol `Nothing` read as an operand,
    for the operand of the three discharges, and for a dictionary value.
    Not changed: the declines of a statement used as a value (`loop-value`,
    `nothing-value`, a block that ends in a `Declare` with no value).
  - (b) `Indeterminate`. The symbol-table entries of the JavaScript, Python
    and interval-js targets are removed. `ce.box("Indeterminate")` gives
    `NaN` before compilation; a non-canonical box reaches the targets and
    still compiles to `NaN` on the four targets. No other spelling is left in
    `compilation/`.
  - (c) Run-time tests. `_SYS.cond` is `c === true`, with no throw. The
    static check that replaces the throw is
    `assertBooleanOrAbsentCondition()`, called from `guardCondition()` on the
    targets that set `assertBoolean` (JavaScript) and from the JavaScript
    `Boole`: a condition whose type has an arm that is not `boolean`,
    `missing`, `nan` or `never` (`unknown` counts as such an arm) declines
    with `unsettled-shape`. Kept: the non-boolean throw of
    `predicateResult`. The type of a predicate literal is computed without
    the element type of its source (`c ↦ c[4] == d` over a list of 4-tuples
    has the type `boolean | list<…>`), and a decline in place of the test
    made the gasket program of Tycho row 339 decline
    (`recursive-list-builder-compile.test.ts`), a corpus witness. Kept, not
    surveyed further: the throw of `_SYS.select` for a condition cell that is
    not a boolean.
  - (d) `javascript-value-facts.ts`. Removed: `recordDecidedLoopIndex`,
    `clearDecidedLoopIndices`, `isDecidedLoopIndex`, with their one reader
    `isCompiledIndex()` (`compiler-type-facts.ts`) and its three call sites,
    since only the removed decidedness code read them. Kept, each with the
    lowering that reads it: `recordIntegerRange` (`canIndexArrayDirectly`,
    the `At` lowering), `recordScopeParent`/`boundNamesAddedBy` (the parent
    walk of the scalar and local facts), `recordScalarParams`/`isScalarParam`
    (the direct call form), `recordVariableLocals`/`isVariableLocal`
    (`compile-blocks`, GPU indexing), `recordConstructedPointParams`/
    `provenPointWidth` (the point width), `numericArrayCells` (`At`),
    `isScalarValue` (the scalar term of `Sum`), `provenScalarPointWidth`
    (`compiler-core`, `compile-linear-algebra`), `recordBlockScalarLocals`
    (`compile-blocks`). The `'finite'` kind of `scalarFedLiterals` lost its
    one reader; the review removed it (`scalarFedLiterals` is a set).
  - (e) `compile-absence.ts` and `absent-tuple-read.ts`: every export has a
    reader, so nothing was removed. `absenceAxisForType` (`compiler-core`,
    `compile-expr-handlers`, `compile-conditionals`), `noBranchValue`
    (`compile-conditionals`), `absenceKind` (the JavaScript and Python
    targets, `compile-conditionals`), `isNumericOrVerdictShaped`
    (`compiler-core`), `nanPointLiteral` and `unmatchedCellLiteral`
    (`collection-utils`, `javascript-target`, `compile-conditionals`),
    `isNumericShaped` and `absentDomainIsObject` (inside `compile-absence.ts`
    only), `tupleSlotReadType` and `absentBaseReadIsNumeric` (the JavaScript
    and Python targets).
- **Public API.** Removed `BaseCompiler` statics: `callbackExcludesNothing`,
  `isElementReadWithoutNothing`, `isCompiledIndex`;
  `assertCollectionOmissionSupported` is renamed `assertNoNothingElement`
  and takes no `target`; `withScalarFedLiteral` takes no kind argument and
  `scalarFedLiterals` is a set. New diagnostic code `possible-nothing`.
  CHANGELOG `[Unreleased]`: one "Breaking changes" entry, two "Behavior
  Changes" entries.
- **Forms that compiled before and decline now** (no corpus record; the
  measure below): a map whose callback call is typed `any`
  (`(u ↦ 7)(P)` and `Apply(u ↦ Norm(u), P)` with
  `P: list<tuple<real, real>>`, crafted); a callback with a parameter
  declared `any` (`Map((t: any) ↦ 2t, [1, 2])`, crafted); `k(PointList(x,
  y))` with `k: (unknown) -> number` (crafted); a local function mapped over
  a range (Epsil `let h = (k) => k + 1; map(h, 1..3)`, whose result type is
  the bare `list`, `plausible`); `Map(g, P)` with `g := p ↦ Norm(p)`, typed
  `list<any>` (`plausible?`); a JavaScript condition whose type admits a
  value that is not a boolean (`If(c, 1, 2)` and `Boole(c)` with
  `c: boolean | integer`, crafted; an untyped parameter used as a
  condition, `c ↦ Block(t ≔ 0; If(c, t ≔ 1, t ≔ 2); t)`, `plausible?`).
  **Forms that declined before and compile now**, because the removed
  callback-result test was their only decline: a root literal whose
  parameter has a function type, `(h: function) ↦ Map(h, [1, 2])`,
  `(h: (real) -> unknown) ↦ …`, and an untyped `h`; the compiled code calls
  the host's function and gives the interpreter's value. A root literal with
  `h: (real) -> real` already compiled; `docs/COMPILATION-MODEL.md`,
  "Function values", now states that the root is the exception to the
  decline of a function-typed parameter.
- **Code lines** (`.ts`, not blank, `//`, `/*` or `*`): `compilation`
  90,125 → 89,924 (−201). Source: 18 files, 319 insertions, 541 deletions.
- **Tests.** No test file deleted, no snapshot changed. Deleted cases: in
  `map-omission-inference`, the `(real) -> unknown` and `function` cases of
  "an enclosing parameter" (they compile now), the `build('h')` assertion of
  the inner-parameter test, the shadowed assertions of the loop test; in
  `compile-cse`, an untyped `/Nothing/` assertion. Rewritten to expect the
  new declines: `map-omission-inference`, `compile-admission` (a condition
  of type `unknown`), `ce-569-when-defects`, `compile.test`,
  `compile-block-local-function`, `ce-712-2-review-round2`,
  `compile-python-collection-at-scalar-parameter`, `block-scope-capture` (a
  range source), `compile-point-untyped-parameter` (`Map(g3, P)`),
  `compile-complex-point-argument`, `tuple-of-lists-as-point-list`,
  `function-body-local-assignment` (Epsil). Message or code only:
  `compile-nothing-fails-closed`, `absence-discharge`, `tycho-item-218`.
- **The corpus measure** (Tycho frozen at `a34405ae0`, the copy of rows 1 to
  6, records keyed by MathJSON; tycho-f9 had no session to ask; a new base
  run on `0c201d2e9`, since #505, #506 and #507 changed compiler code after
  row 5's run; the base equals row 6's run): candidate before the review and
  candidate on the final source, each 17,825 compiles, 13,707 keys and
  77,267 values as in the base; 0 changed values, 0 new throws; declines
  javascript 47, glsl 44, interval-js 61 in all runs, none new, none gone.
- **Review**: Claude and Codex, one round. Codex: no finding. Claude: three
  low findings and one nit, all fixed (three comments that still described
  the run-time throw of `_SYS.cond`; the boolean and colour cells missing
  from the list of non-values in `docs/ERROR-MODEL.md` §6; the unused
  `'finite'` kind, removed; four comment lines not rewrapped). No second
  round: no finding was `high` or `medium`.
- **Checks.** In the worktree: typecheck, `oxlint` on the changed files,
  `check:deps`, 183 targeted test files, `test:core`, `npm run test:python`
  (49 suites, 2,768 passed), and the full suite on the final source (it
  found the 9 test failures that the last five test files above fix; the 16
  changed test files then passed, 1,883 tests). In the main tree, on the
  review fixes: typecheck, `oxlint`, 21 test files (2,658 passed),
  `test:core`. The nightly full run at `0c201d2e9` passed (the five-commit
  limit was reached).
- **Documents.** `docs/ERROR-MODEL.md` §6: the compiled rule (the one
  `possible-nothing` decline, the non-values, no run-time test of a value);
  §7 keeps its paragraphs and gets a dated note (2026-11-04) at its top that
  names the compiled mechanisms that rows 2 and 7 removed, so that the
  section stays readable as a dated record. `docs/COMPILATION-MODEL.md`: an
  R5 item for conditions (with the reason why `predicateResult` stays), the
  `_SYS.cond` paragraph, the paragraph "A possible `Nothing` element
  declines", the sentence on an `unknown` condition, the root exception of
  "Function values", and one known-limitations line (`crafted`: on Python,
  `If(c, 1, 2)` with `c: boolean | integer` gives `1` at `c = 1`). No page
  under `~/dev/cortexjs.io/docs/compute-engine/` describes a removed
  mechanism; `13-guide-compile.md`, "Inputs With No Type and Values With No
  Settled Shape", does not yet name the code `possible-nothing` or the
  condition decline (not edited).
- **Choices, each reversible.** (1) `any` admits `nothing`, as the brief of
  this row reads "a list that may hold one declines". The alternative is to
  decline only for an explicit `nothing` arm: compiled code produces
  `Nothing` only through a literal `Nothing` or a statement value, which
  decline at their own sites, so that option is also sound; it removes the
  new declines above (two `plausible`) and some older ones over `list<any>`
  sources (which touches the pending decision on row 409 (a)).
  **Decision (user, 2026-11-04): `any` includes `nothing`**, as committed in
  `faef4d574`; the two `plausible` declines stay, and the explicit-arm
  option is not taken. **Replaced later the same day (user, 2026-11-04):
  the explicit-arm option is taken.** From the type system's point of view
  `Nothing` is in `any`, but compiled code produces `Nothing` only through a
  literal `Nothing` read as a value or through the value of a block that
  ends in a statement, and both decline at their own sites; a `Nothing` that
  the host supplies (an input, a `vars` entry, a host function) is a value
  outside its declared type, unspecified by the caveats, the host's burden.
  So `assertNoNothingElement()` declines only for a type with an explicit
  `nothing` arm (`provablyAdmits('nothing', t)` becomes a test of the arm,
  so `any` and `unknown` pass; the two producer sites keep their declines),
  the row 7 tests that expect `possible-nothing` for an `any` result go
  back to value tests, the CHANGELOG entry loses its "now declines"
  examples, and `docs/COMPILATION-MODEL.md` ("A possible `Nothing` element
  declines") and `docs/ERROR-MODEL.md` section 6 state the explicit-arm
  rule. The work is folded into step 4, row 9 (its part 2). (2)
  `predicateResult` keeps its test (corpus witness, Tycho row 339); the
  alternative is the decline. (3) A condition of type `unknown` declines on
  JavaScript; the alternative is to keep the run-time throw for it. (4) One
  new code, `possible-nothing`; the alternative was `compile-error`. (5) The
  decline order is unchanged: the `Nothing` check runs before the lane check
  of a callback parameter, so `Map(ha, P)` gets the `Nothing` message (both
  are declines).
- **What row 8 (the features dropped by name) can rely on.** Row 8 is empty
  by the decision of 2026-11-02. If a later step drops a target: in
  `python-target.ts` this row removed only the `Indeterminate` entry of the
  symbol table; no WGSL or GPU module (`gpu-shader-target.ts`,
  `wgsl-field-function.ts`, `gpu-*.ts`) changed. The condition decline
  (`assertBooleanOrAbsentCondition()`) applies only to a target that sets
  `assertBoolean`; Python and the shader targets do not.

The result of step 4, row 9 (the GPU finite proofs, with part 2, the
explicit `nothing` arm; 2026-11-04, session compute-engine-d0; worked on
`2843a5a12896e61ddd4e5af3d7f154fa7922e1f1` in `/tmp/wt-compute-engine-d0` by
two implementers, one after the other, then moved onto
`85aa7d2ce71534ae61d8bad05d099336a2dfc2fe` (CE-610, CE-803, CE-802) in
`/tmp/wt-compute-engine-d0b`, where the review fixes were made; applied to the
main tree on that commit; staged, not committed).

- **The survey of `gpu-finite-proof.ts`, by kind.** Kind (1), kept: the
  constants `GPU_F32_MAX`, `GPU_F32_BOUNDED_HEADS`, `gpuFiniteRealCells`,
  `gpuProvablyFinite` (without the budget wrapper), and the inner functions
  of `gpuFiniteProof` (`gpuFoldedValue`, `isMapped`, `bakedValue`, `finite`,
  `magnitude`, `productStaysFinite`, `sumStaysFinite`,
  `quotientStaysFinite`, `modStaysFinite`, `smallPowerStaysFinite`,
  `reciprocalPowerBound`, `powerBaseMagnitude`, `productBound`,
  `atomBound`, `isExactRationalDivisor`, `range`), each without its read of
  the parameter facts; `lowerMagnitude` without its `cos` branch. Kind (2),
  removed: `userCall`, `GPUCallFact`, `withUserCallBudget`,
  `GPU_USER_CALLS_IN_PROOF`, `GPU_USER_CALL_BUDGET`,
  `GPU_USER_CALL_PROOFS_PER_ROOT`, `GPU_USER_CALL_FACTS`,
  `gpuSameProofContext` (the proofs of the bodies of user functions);
  `GPUParameterFact`, `GPU_CALL_SITE_FACTS`, `gpuDefinitionParameterFacts`,
  `gpuReboundNames` and the parameter part of `gpuRecordCallSiteFacts` (the
  call-site and definition-parameter facts); `gpuLoopIndexFacts`,
  `gpuLoopIndexFact`, `gpuLiteralLoopIndexFact` (the loop-index facts); the
  `cos` branch of `lowerMagnitude` and `GPU_TRIG_ERROR`. In each removed
  case the guard site already calls the helper when `gpuProvablyFinite` is
  false, so an argument that only a removed rule proved now gets the helper;
  no call declines. `CompileTarget.gpuParameterFacts` lost every reader and
  is removed, with its writers in `gpu-functions.ts` (two loop lowerings)
  and `gpu-shader-target.ts` (CHANGELOG "Breaking changes"). Kept although
  listed as kind (2): the written-names walk, renamed
  `gpuRecordWrittenNames` (it collects the targets of `Assign` and
  `Declare`): it is a restriction on reading a declared type, not a derived
  fact; without it `w ≔ exp(x); sin(w)` would get the built-in from the
  declared type of `w`. `isAmplifiedTrig` (`gpu-exact-trig.ts`) stays: the
  proof reads it so that the `Fract` and `Mod` bound rules give no bound to a
  sine hash, and the exact-trig lowering reads it too.
- **The declaration that restores the built-in.** The host rule names "the
  result type of a function with a range", which no rule implemented once
  the body proofs were gone. Added: `declaredUserCallBound` (with
  `rangeBound`): a call of a user function is finite when the host declared
  its result type (not inferred), that result type is read from the declared
  signature (a value definition's type, an operator definition's
  signature), it has a range with two finite bounds inside f32, and the
  arguments are proven finite; the range is read as the magnitude, so
  `sin(1000·f(x))` with `f: (real) -> real<-1..1>` gives
  `sin(1000.0 * _fn_f(x))`. A result type with no range (`(real) -> real`)
  keeps the helper: the body is computed in f32 and `exp(u)` overflows. A
  function declared with the bare type `function` keeps the helper, also
  when the engine infers a ranged result type from its body (review
  finding). The only helper-to-built-in change is a body whose f32 value
  leaves its declared range, a value outside its type (unspecified by the
  caveats).
- **Part 2, the explicit `nothing` arm** (the decision recorded in the
  choices of row 7, "Replaced later the same day"). One helper,
  `hasNothingArm()` in `src/common/type/subtype.ts` beside
  `provablyAdmits()` (unchanged): it walks union arms, `broadcastable<T>`
  and aliases as `provablyAdmits` does, and gives false for `any` and
  `unknown`. It replaces every `provablyAdmits('nothing', …)` of the
  compiler: `assertNoNothingElement()` (`compile-inner.ts`), the dictionary
  value and `IsMissing` (`compiler-core.ts`), `Coalesce`
  (`compile-expr-handlers.ts`), `AssertPresent`
  (`compile-conditionals.ts`). The two producer sites (the symbol `Nothing`
  read as an operand, a statement read as a value) keep their declines.
  For `Map`, `Tabulate` and `Scan` the check reads the result type of the
  callback (`functionResult()`), not the result type of the operation:
  the interpreter's type of `Map` adds a `nothing` arm itself when the
  callback result is `any` (`withMapOmission()` in `collections.ts`), and
  reading it kept the two `plausible` declines. Results:
  `Map(g, P)` with `g := p ↦ Norm(p)` gives `[5, 2.236…]`; Epsil
  `let h = (k) => k + 1; map(h, 1..3)` gives `[2, 3, 4]`; `(u ↦ 7)(P)`
  gives `[7, 7]`; `Apply(u ↦ Norm(u), P)` and `Map((t: any) ↦ 2t, [1, 2])`
  give the interpreter's values; `k(PointList(x, y))` with
  `k: (unknown) -> number` compiles. Removing the `any` decline exposed a
  fold whose shape is not settled (review finding, Codex): `Sum(w)` with
  `w: collection<any>` compiled to a per-element `Array.isArray` test, which
  R3 forbids. Added `assertSettledFoldElements()` (`compile-admission.ts`,
  called from `compileExpr`): a `Sum` or `Product` of one collection, or a
  `Reduce` or `Scan` by `Add` or `Multiply`, whose element type is `any`
  declines with `unsettled-shape` on every target. The same fold over
  `unknown` elements, a number-or-collection union, or a source typed `any`
  compiled before this row and still compiles with that test; Tycho row 425
  depends on it, so it is ROADMAP CE-805 (`decision needed`).
- **Code lines** (`.ts`, not blank, `//`, `/*` or `*`): `compilation` 89,924
  → 89,470 (−454) for part 1 on `2843a5a12`; 89,963 → 89,568 (−395) for the
  whole row on `85aa7d2ce` (part 1 −454, part 2 +5, the review fixes +54:
  the fold decline and the declared-range bound). Source: 12 files, 352
  insertions, 933 deletions.
- **Tests.** No test file deleted, no snapshot changed. Part 1:
  `ce-565-4-gpu-parameter-finite` rewritten (a parameter keeps the helper;
  new tests of a ranged result type, of the bound it gives a product, of
  `(real) -> real` with `exp`, and of a bare `function` with a `Fract` body,
  which keep the helper); `ce-480-loop-index-argument-finite` rewritten (the
  kelvin-wake form, the quotient by `cos(θ(j))²`, the product by
  `cos(u)^{-2}` and the call of `f` expect the helper; seven cases that
  pinned a detail of a removed rule are deleted: degree mode, an inner sum
  that binds the index again, a callee that binds its parameter again,
  nesting deeper than 8, the fast compile of nested calls, a rational
  divisor in a callee, a parameter bound read through a call site);
  `ce-526-shader-finite-guard` and `compile-folded-value-angular-unit`
  expect the helper; `ce-565-shader-finite-proof` comment only. The kind (1)
  tests (`ce-565-6-small-power-finite`, `ce-619-gpu-finite-proof-overflow`,
  `compile-gpu-extremum`, `compile-gpu-shape-gate-holes`) are unchanged.
  Part 2: back to their form at `0c201d2e9` (value tests):
  `compile-complex-point-argument`, `compile-point-untyped-parameter`,
  `compile-python-collection-at-scalar-parameter`, `compile.test`,
  `compile-block-local-function`, `tuple-of-lists-as-point-list`,
  `ce-712-2-review-round2`, `block-scope-capture`;
  `map-omission-inference` value tests for the `any` cases, decline tests
  for the explicit arms. Not changed, since their row 7 change is a
  condition decline: `ce-569-when-defects`, `compile-admission`,
  `function-body-local-assignment`. Seven more files tested an `any` value
  that declined and now compiles or declines by another rule (each checked
  against the interpreter): `absence-discharge` (an `any` input declines
  with `untyped-input`), `accessor-proven-length-type`,
  `compile-extremum-collection-operand` (the `any` folds decline with
  `unsettled-shape`), `compile-userfn-result-shape`,
  `raw-view-producer-omission`, `recursive-list-builder-compile`,
  `tycho-item-332-untyped-program-compile`,
  `tycho-item-218-compile-multi-collection-map`.
- **The corpus measure** (Tycho frozen at `a34405ae0`, the copy of rows 1
  to 7, a plain `git archive`; tycho-desk confirmed the commit and had no
  base run; records keyed by MathJSON). Base runs on `2843a5a12` and on
  `85aa7d2ce` (identical helper counts), candidate on part 1 and 2 before
  the review, final run on the final source: 17,825 compiles, 13,707 keys,
  77,267 values in every run; 0 changed values, 0 new throws; declines
  javascript 47, glsl 44, interval-js 61, none new, none gone, and no
  record gains a compile. **The helper count** (successful GLSL records
  whose code or preamble calls a guarded helper; `compare.mjs` counts only
  `_gpu_sin(` and `_gpu_cos(`, so the count was extended to `_gpu_max(`,
  `_gpu_min(`, `_gpu_clamp(` with a script of this session): 540 records in
  102 documents → 713 records in 136 documents (`sin` 334 → 488, `cos`
  345 → 497, `max` 121 → 140, `min` 69 → 76, `clamp` 0 → 0;
  `compare.mjs`'s own count, sin or cos: 416 in 66 → 586 in 104). By key
  (target, document, row): 100 keys gain a helper, none loses one, in 44
  documents: `neyret/g91gh9zpcr` 11, `neyret/gwqx9ckx7h` 11,
  `neyret/bpnkluuy7y` 7; 3 each in `neyret/7fz4ugr5wz`, `bi0xqfjz6i`,
  `drvgednvrn`, `jsdx9qnaed`, `mh3zmxzi85`, `ouiqgatshs`, `pqflulcixs`,
  `t3sr6vkzjh`, `wib5jiiddl`, `zjhaoqoufo`; 2 each in
  `showcase/underwater-caustics` and `neyret/2lzec8zwrz`, `d2tqgiqgzv`,
  `erwlgvbuno`, `m7oc1p6cys`, `navigpkypz`, `ouizn62uo8`, `rccfsvo93r`,
  `rw6bgiznly`, `ybnaggvqb6`; 1 each in `showcase/kelvin-wake` and 20 more
  `neyret` documents. These counts are for Tycho `a34405ae0`: later Tycho
  commits (`2930172d1`, `f199c5a67`) change the declarations that Tycho
  passes, so current Tycho can differ. Tycho row 488: its instrument
  (`scripts/repros/2026-11-01-ce488-floor-operand-size-repro.mts`, run
  against both builds) gives the same reading on the base and the final
  tree: `floor` and `fract` call the built-in `sin`; the `mod` case prints
  "guarded" because it matches `_gpu_fmod`, which is not a NaN guard, and
  its `cos` is the built-in. No edit to Tycho's document.
- **Review**: Claude and Codex, two rounds, then stopped. Round 1: Codex,
  one medium (the `any` fold above, fixed); Claude, one medium (a bare
  `function` declaration gave the inferred range, fixed), one low (a nested
  `nothing` from a declared input in a `Map` callback: the interpreter keeps
  the `Nothing`, compiled code gives `undefined` in its place, an allowed
  difference with a `crafted` witness, not recorded), one nit (the
  `isOverriddenOperator` test, fixed). Round 2 on the fix delta: Codex, one
  medium (the `unknown` fold keeps its run-time test): answered with CE-805
  and with the comment and `COMPILATION-MODEL.md` sentence that state it as
  an open defect; Claude, one low (`Sum(g(x))` with `g: (real) -> any`,
  `crafted`, the same older mechanism): folded into CE-805.
- **Checks.** In the worktrees: typecheck, `oxlint` on the changed source
  files, `check:deps`, the 239 GPU test files (part 1), 141 files (part 2),
  69 files (review fixes), `test:core` after each part. In the main tree on
  the final source (which adds a peer's hunks in `compile-inner.ts`):
  typecheck, 50 test files (2,979 passed). Not run: the full suite (the
  nightly run covers it), `npm run test:python` (the only Python-relevant
  test file ran with `CE_PYTHON` set: 57 passed).
- **Documents.** `docs/COMPILATION-MODEL.md`: the host rule for a guarded
  call (beside the caveat on a non-finite value for an input declared
  `real`), the section on the NaN-safe helpers (its list of derived facts
  and the `cos` error paragraph replaced by the host rule), the explicit-arm
  rule, the `any` fold decline and the CE-805 sentence under R3.
  `docs/ERROR-MODEL.md` §6: the explicit-arm rule. CHANGELOG `[Unreleased]`:
  one Breaking changes entry (`gpuParameterFacts`), one Behavior Changes
  entry for the GPU proof, the `Nothing` entry rewritten.
  `~/dev/cortexjs.io/docs/compute-engine/13-guide-compile.md`, "Non-Finite
  Results": the host rule, with the row 488 example and the ranged result
  type.
- **Choices, each reversible.** (1) `declaredUserCallBound` added, so that
  the documented declaration restores the built-in; the alternative is no
  rule, and the documentation then says that no declaration restores it for
  a call. (2) The written-names walk kept; the alternative removes it and
  lets a written name use its declared type (values change). (3) A
  function's parameter is not read as finite, also with a ranged signature
  (the engine types a parameter of the body `number`); the documentation
  says "inputs and declared result types". (4) The `Map`/`Tabulate`/`Scan`
  check reads the callback's result type; the alternatives are to keep the
  operation's type (the two `plausible` declines stay) or to change
  `resultMayBeNothing()` in the interpreter (changes interpreter types).
  (5) The fold decline covers only `any` elements, on every target; the
  wider decline is CE-805. (6) The Python `Reduce`/`Scan` by `Add` over
  `list<any>` declines as it did before part 2, although Python has no
  run-time shape test there; the alternative is a decline in the
  JavaScript lowering only.

The record of step 4. `compilation` had 92,764 code lines on `1359a1279`
(row 1's base) and 89,568 at the end of row 9 (−3,196). The rows removed
60, 1,298, 151, 740, 151, 1, 201, 0 (row 8 is empty) and 395 lines, 2,997
in all; the other commits of the same days account for the rest. Rows 1, 3,
5, 6 and 9 removed much less than the table's module counts: the table named
whole modules, and most of each serves a rule that stays — row 1, the
rank-2 code that 3.3 left was small and `compile-match.ts` stays for
`Match`; row 3, the admission check serves R1, R3 and the effect declines,
and the static-shape modules choose a shape or are the binding dispatch;
row 5, the function-value modules serve fully applied calls and literal
callbacks, which stay; row 6, the lane modules serve `strict`, the only
discipline, and `auto` had gone in step 3; row 9, the bound arithmetic of
kind (1) is most of the proof module. What a later contraction could take,
not done here: the run-time fold test of CE-805 (if the user takes option
(a)); `predicateResult`'s non-boolean throw and the condition-cell throw
of `_SYS.select` (kept by row 7); the exports of `compile-absence.ts` and
`absent-tuple-read.ts` (each has a reader, row 7); the facade of
`base-compiler.ts` (step 4 of `docs/plans/2026-10-30-split-base-compiler.md`);
the lazy-view records of `lazy-view-context.ts` (an interpreter change that
row 5 proposed).

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
  them). The first check is done (tycho-c6, 2026-11-03, Tycho's codegen
  audit of all 757 documents and the showcase, on CE 0.176.0 and on
  aee059e66): no `Assign` writes a symbol its block does not declare, and no
  first assignment sits in a branch, a loop body or an operand, so the
  decline of A′ changes no Tycho row. The only `Declare` without a value
  left is Tycho-built, in its implicit-surface march kernel
  (`Declare(base, "integer")` then `Assign(base, …)`, and `v0` to `v7` as
  `real`; 288 compiled expressions in 32 documents): Tycho changes that
  builder in its adoption item 4; no CE change is needed. The second check
  is settled by assumption (user decision 2026-11-03): the bigint user is
  enumeratio (GitHub issue #503), and the user does not know whether they
  use currying, partial application or a function value in a variable, so
  the release assumes they do not. The evidence of #503 supports it: their
  programs are counting definitions (unranking Dyck paths, ballot numbers,
  binomial sums), `Fold` over a `Range` with a literal callback, and user
  functions with integer parameters, which option B of page 5 keeps (fully
  applied calls and literal-lambda callbacks). The issue also asked for an
  escalation to `bigint` from `auto`, which the complex-lane decision
  (page 6, "The same rule for bigint") dropped: the reply to #503, deferred
  by the user (ROADMAP CE-715), should say so at the release.
- Tycho confirms that its complex-mode documents compile in complex mode or
  declare their inputs complex (the complex lane in its strict form).
- Tycho's checks after the release: the 3-D point routes, point labels and
  GPU point routes for a `NaN` point (its Q1 answer did not cover them).
- The npm users of the removed features: a CHANGELOG entry per removal, with
  the decline that replaces it.
