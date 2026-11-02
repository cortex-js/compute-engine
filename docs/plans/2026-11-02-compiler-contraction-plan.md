# Contract the compiler by narrowing the language: the implementation plan

**Status:** plan, 2026-11-02. Steps 1, 2 and 5 can start; step 3 waits for
the decisions of step 2; step 4 follows step 3. Inputs:
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

## 1. Apply the rule already decided: the host validates its inputs

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

## 2. Decide the remaining axes

One page per axis, each with the options, one example per option, Tycho's
use from the census, and the compiler code each option removes. The user
decides all of them in one sitting, so that step 3 ships them together. The
recommended option is stated first. The pages are
`docs/plans/2026-11-02-language-axes-options.md`; its §8 is the decision
table.

| Axis                           | Census (real documents / Desmos states)                                     | Recommended option                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Missing`                      | `Missing`, `IsMissing`, `Coalesce`: 0 / 0; a `missing` input type: 2 / 6   | A result only (a selection with no match, an accessor out of range, an input left out); no `\| missing` input types; read only by `IsMissing`, `Coalesce` and a branch; every other operator gives an unspecified non-value |
| Error model                    | `Nothing`, `Indeterminate`: 0 / 0; a node typed `nothing`: 0 / 4            | One static error (declines; an error expression in the interpreter) and one dynamic non-value (`NaN` for a number, `Missing` otherwise); `Nothing` kept only as the value of an empty block |
| Comparisons                    | a `missing` operand: 1 document                                             | Two-valued in compiled code; every undecided operand (`NaN`, absent, a pole) gives `false` |
| Block locals                   | assignment in a branch, read before assignment, loops: 0 / 0                | Single assignment, declared before use; a loop whose value is used, a read before assignment and caller code in `vars` decline |
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

3.1 **The parser.** The restriction rule of
`docs/plans/2026-11-02-restriction-binding.md`: `\{c\}` as a postfix that
binds looser than arithmetic and tighter than a relation, `\to`, `for`,
`with` and the comma, applied to its group; the parse is `If(c, e)`; stacked
restrictions merge into `If(And(…), e)`; `\{c\}` alone is `If(c, 1)`. The 40
lines of the LaTeX dictionary that produce `When` change. Tests are the
corpus rows named in the table. `\operatorname{with}` parsing is its own
item, done before or with this one.

3.2 **`When` is removed.** The library entry in `control-structures.ts`,
its canonicalization rules (`When(When(e, c1), c2)`), its evaluation and
type handlers, and the 32 source files that name it; the serializer writes
`If(c, e)` as a restriction where it wrote `When`. `If(c, e)` with no else
keeps its documented meaning (the absent value when `c` is false), and a
scalar condition accepts a non-value arm: a point, a point list, the drawing
heads (`Polygon`, `Triangle`, `Segment`, `GeometricVector`, `Sphere`,
`Histogram`) and a `To` action.

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
|     4 | Block locals: single assignment before use; the definite-assignment analysis, the effects contract of `vars` code and the loop-value lowering go               | `compile-locals.ts` 1,238, `compile-blocks.ts` 617, `compile-loops.ts` 1,175 in part, `compile-declarations.ts` 823 in part |
|     5 | Function values: fully applied calls and literal-lambda callbacks only; currying, partial application, defaults, function-typed variables decline            | `compile-callbacks.ts` 2,316, `compile-user-functions.ts` 1,948, `compile-user-calls.ts` 1,101, `compile-function-literals.ts` 479 in part |
|     6 | Complex lane decided once: no lane recording per definition, no restart                                                                                       | `compile-complexness.ts` 635, `compile-lanes.ts` 709 in part, the restart in the targets                                     |
|     7 | Error model: one dynamic non-value; the `Nothing` and `Indeterminate` positions and the undecided-comparison rules go                                         | the Kleene and decidability functions of the absence module, `javascript-value-facts.ts` in part                             |
|     8 | Features dropped by name in step 2, each its own step                                                                                                         | WGSL: `gpu-shader-target.ts` 1,813, `wgsl-field-function.ts` 978 and the WGSL branches of the GPU modules; Python: `python-target.ts` 5,092; value kinds |
|     9 | GPU finite proofs: accept an undefined value on overflow or decline what is not proven finite, per the user's choice in step 2                               | `gpu-finite-proof.ts` 1,213 and the proof calls in the GPU modules                                                           |

The line counts name the modules; the lines that each step removes are
measured by the step. A step that finds a corpus expression depending on the
removed code stops and reports: that expression is a `corpus` witness, and
the rule for it is decided by the user, not by the implementer.

## 5. The growth guard

Two numbers per commit in the nightly run, kept with its result: the code
lines of `src/compute-engine/compilation` and the compile depth limit of
`compile-deep-nesting.test.ts` (a first compile in a warm worker). A rise of
the first or a fall of the second between two nightly runs is reported with
the run, like a failed test, with the commits in between. Small; any time.

## 6. What is still open

- The decisions of step 2 (the user, one sitting).
- `\operatorname{with}` parsing: a parser item of its own, needed by one row
  of the restriction table.
- Tycho's checks after the release: the 3-D point routes, point labels and
  GPU point routes for a `NaN` point (its Q1 answer did not cover them).
- The npm users of the removed features: a CHANGELOG entry per removal, with
  the decline that replaces it.
