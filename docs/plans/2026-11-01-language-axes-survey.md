# Survey: which features of the language made the compiler grow

**Status:** survey, 2026-11-01. No code is changed. This document is the input
to a specification that narrows the language; the census in §7 comes first.

## 1. The problem

The compiler directory `src/compute-engine/compilation` grew from 40,909 code
lines (no comments, no blank lines) on 2026-09-15 to 95,413 on 2026-11-01, and
from 65,630 to 95,413 in the last week alone. The simplification plan of
2026-11-01 (`docs/plans/2026-11-01-compiler-simplification.md`) removed about
1,300 lines net: it was scoped to the absent-value code, about 6% of the
compiler, and its review process rebuilt part of what it removed.

| Date       | Compiler code lines |
| ---------- | ------------------: |
| 2026-09-15 |              40,909 |
| 2026-10-01 |              49,836 |
| 2026-10-17 |              55,427 |
| 2026-10-24 |              65,630 |
| 2026-11-01 |              95,413 |

The compiler's size measures the number of cases of the language. Each
handler is one cell of a product: an absent value that can reach every
operator, times broadcasting over lists whose cells can be absent, times
several spellings of "no value" (`Missing`, `Nothing`, `Indeterminate`, `NaN`,
an error), times five targets, times the shapes. The interpreter handles each
dimension dynamically in one place; the compiler settles every cell statically
and exposes the product as code. A compiler rebuilt against the same language
grows back to the same size. The language is narrowed first; the compiler is
then rebuilt or contracted against the narrower specification.

## 2. The axes, measured on the 340 compiler commits since 2026-09-15

A survey agent read the message, body and changed files of each of the 340
commits between b4b225101 and b889aeb06 that touched the compiler directory,
and gave each commit one primary axis: the language feature or mechanism whose
semantics the commit serves. The lines are `git log --numstat` sums over the
compiler files, so they count comments and blank lines (total +190,332
−101,169, net +89,163; the file splits add and remove about 83,000 of the
lines). The classification is a judgement; the per-commit table is in
`2026-11-01-language-axes-survey/commits.tsv` (columns: axis, witness, hash,
added, removed, net, subject) and can be corrected there. Its axis codes:
GPU, MIX (mixed batches), TYP (type system), CPX (complex lane), BLK (block
locals), MIS (Missing), NUM (numeric kernels), BIG (bigint), REF (refactor),
FN (user functions), BC (broadcasting), COL (collections), ERR (error model),
OPT (CSE and performance), BAT (`broadcast()` API), IVL (interval-js), TST
(tests, docs, tooling), VK (value kinds), HYG (reserved names).

| Axis                                                                                       | Commits |  Added | Removed |    Net | Share | Most costly commits                                     |
| ------------------------------------------------------------------------------------------ | ------: | -----: | ------: | -----: | ----: | ------------------------------------------------------- |
| GPU specifics: finite proofs, NaN-safe helpers, storage buffers, field functions, sizes    |      25 | 14,933 |   1,720 | 13,213 | 14.8% | 4d235c8a2 (+2,773), 3431204f2 (+2,548), f87ea242d       |
| Mixed fix batches (one commit closes 10 to 80 ROADMAP entries across several axes)         |      25 | 14,603 |   1,432 | 13,171 | 14.8% | fd47fdca4 (+2,836), ab0530520 (+2,377), 114db120a       |
| Type system and shape admission: `any`/`value`/`unknown` inputs, unions, variant selection |      29 | 12,771 |   3,322 |  9,449 | 10.6% | 450e1ad49 (+3,098), 5b60e6081 (+2,617), 6fa03133f       |
| Complex numbers and the real/complex lane                                                  |      15 |  8,251 |   1,431 |  6,820 |  7.6% | 5e29489a6 (+3,132), 4916e3f7f (+824), c4e0a3bdb         |
| Block locals, Declare/Assign, loops, effects, caller-supplied code                         |      19 |  7,726 |   1,927 |  5,799 |  6.5% | afbcdfc3e (+1,873), 1efbbe884 (+933), 33651c6b1         |
| Missing, absent and unsupplied values                                                      |      27 |  8,155 |   2,404 |  5,751 |  6.4% | f169546e9 (+2,683), eedab2e0d (+588), 797aa8b3f         |
| Numeric kernels: PolyLog, Zeta, LerchPhi, inverse trig accuracy, Round step                |      25 |  5,297 |     710 |  4,587 |  5.1% | 420e06e37 (+1,328), 1d0d26995 (+704), d449e2d72         |
| Bigint compile mode                                                                        |       7 |  4,295 |     204 |  4,091 |  4.6% | df8ea31ad (+2,185), e6bff856b (+1,271), 26c2714e2       |
| Refactor, file splits, runtime package, lint                                               |      22 | 87,308 |  83,256 |  4,052 |  4.5% | 5404acb3f (+3,144), 97bb4cc71 (+689), c71298d52         |
| User functions: callbacks, defaults, currying, partial application                         |      14 |  4,647 |     720 |  3,927 |  4.4% | aaccfcf04 (+968), 4d6479dee (+811), 16b688765           |
| Broadcasting over lists, masks, matrix product versus element-wise                         |      19 |  4,049 |     533 |  3,516 |  3.9% | 556ca8d7e (+794), 4e66aed34 (+598), 8843c9522           |
| Collections: tuples, points, dictionaries, accessors, list operations, lazy collections    |      22 |  3,855 |     436 |  3,419 |  3.8% | 2f7ee8a86 (+564), 2fb211500 (+374), f2c053f1e           |
| Error model: `NaN`, `Nothing`, `Indeterminate`, undecided comparisons                      |      15 |  2,931 |     472 |  2,459 |  2.8% | f13b6f46f (+1,499), 6195cec92 (+291), c240193f0         |
| CSE, constant folding, performance                                                         |      11 |  3,919 |   1,538 |  2,381 |  2.7% | fe4424bda (+639), 472df47ee (+461), e181a868a           |
| `broadcast()` batch API, worker pool, async                                                |       8 |  2,182 |     309 |  1,873 |  2.1% | 315e6fc41 (+884), b9016e19b, 21d9d30a4                  |
| interval-js target parity                                                                  |      21 |  1,848 |     288 |  1,560 |  1.7% | 61edbdb27 (+250), 3bdee13b3 (+206), 5eca8afa7           |
| Tests, docs, tooling                                                                       |      29 |  1,334 |     207 |  1,127 |  1.3% | ec330b8cc, 6b4cc5050, ca4114a49                         |
| Value kinds (Enclosure, residue classes)                                                   |       2 |  1,221 |     116 |  1,105 |  1.2% | 0be912cef (+785), 22d77a2ea (+320)                      |
| Reserved names in emitted code                                                             |       5 |  1,007 |     144 |    863 |  1.0% | eab2f8652, 75116a0d8, caa2192c3                         |

Since 2026-10-25 the net growth by axis is: GPU +11,941, type system +8,064,
bigint +4,091, block locals +4,012, file splits +3,413, user functions +3,374,
mixed batches +3,260, Missing +2,897.

Uncertain placements: 5e29489a6 (complex lane or type system, 3,132 lines),
6fa03133f (type system or complex lane), afbcdfc3e (block locals or GPU),
3431204f2 (GPU or collections), 4815ac793 (`subs()` scoping, with block
locals), 75d84fbfd (`When`, with the error model).

## 3. What generated the cases, axis by axis

Each entry: the semantics that produced the cases, one example from a commit
or the CHANGELOG, and the narrower rule that would have made the code
unnecessary. "Feature" marks an axis that is a capability, not a corner case;
its cost is a choice, not a defect of the language.

- **GPU specifics.** Shaders have no exceptions and 32-bit floats, so every
  operator that can overflow needs a NaN-safe helper unless the compiler proves
  its operand finite, and the proofs spread to loop indexes, user calls and
  powers (545deb5e0: "prove loop indexes, user calls and cos divisors finite",
  Tycho row 480). Narrower rule: accept an undefined value on overflow and use
  the built-ins as they are, or decline what is not proven finite. The storage
  buffer and field-function APIs (4d235c8a2) are features.
- **Type system and shape admission.** Inputs declared `any`, `value` or
  `unknown`, and parameters with open inferred types, forced run-time shape
  tests, then a static-shape rule to remove them (3ba729792: a `Sum` over a
  parameter declared `any` declines instead of testing at run time whether the
  value is a list). Narrower rule: refuse untyped inputs and require one shape
  per binding. This is R1 to R6 of `2026-10-31-static-shape-compilation.md`,
  adopted; most of the 2,617 lines of 5b60e6081 enforce it.
- **Complex lane.** A function's real-or-complex lane is inferred from the
  types, so a complex value that reaches a real parameter needs lane recording
  per definition (5e29489a6) and later a restart of the compilation
  (c4e0a3bdb). Example: `h = (p) ↦ p[1] + 1` with `P: list<tuple<complex,
real>>`, where `h(P[1])` gave `[object Object]`. Narrower rule: the lane is
  decided once from the declared input types, and a complex value at a real
  input is an input outside its type, with no restart.
- **Block locals and effects.** Epsil allows a read before an assignment, an
  assignment in a branch, a loop whose value is used, and caller-supplied code
  in `vars` (`{W: 'nextValue()'}`) that counts as an effect. Each needs a
  definite-assignment analysis on every target (d1f28962f: "a Loop whose value
  is used declines on every target"). Narrower rule: compile only
  single-assignment locals declared before use, and treat `vars` code as a
  value or refuse it.
- **Missing.** An absent value could reach every operator, through inputs
  declared `real | missing` and through inputs the host leaves out, and
  compiled code matched the interpreter's absent result at each operator
  (CHANGELOG 0.177.0: `If(IsMissing(w > 0), 1, 0)` with `w: real | missing`
  carried a three-valued comparison). Narrower rule: the 0.177.0 contract,
  absence defined only at producers, accessors and discharges; with it,
  d77c632d7 removed 1,224 lines. What remains is the `| missing` input types.
- **Numeric kernels.** Feature: new library functions compiled to JavaScript,
  GLSL and WGSL (PolyLog with a complex order, LerchPhi, Zeta) and their
  accuracy. The narrower choice is fewer targets per special function.
- **Bigint mode.** Feature, requested by a third-party user; Tycho does not
  use it (user, 2026-11-01). Its cost is the lane analysis that proves where a
  value is a bigint (df8ea31ad). The census of §7 cannot judge it: it is kept
  or dropped by the third party's need, not by Tycho's.
- **User functions.** Defaults, currying, partial application and callbacks in
  `Sort`, `Iterate` and `Pipe`, each on five targets (16b688765:
  `Apply(Apply(f, 1), u)` compiles only when `f` is curried in one step with
  literal arguments). Narrower rule: compile only fully applied calls and
  decline every function value.
- **Broadcasting.** `broadcastable<T>` is `T | list<T>`, masks may be uneven,
  and `Multiply` of matrices is a matrix product however written (CHANGELOG:
  `If([[True], [False, True]], 7, 0)`; `Which([1, b, 3] ≠ 2, 1, True, 0)`).
  Narrower rule: rectangular lists only, element-wise application only where
  the operand type is a declared list, and no element-wise `Which`, `If` or
  `When`.
- **Collections.** Tuples versus lists, points versus lists of points,
  dictionaries, lazy collections (2fb211500: "tuples with list coordinates
  treated as errors rather than points"). Partly features (dictionaries,
  `ReplaceAt`); the narrower rule is unclear from the commits.
- **Error model.** Undecided comparisons (`NaN`, an absent value, a pole) and
  `Nothing` positions each got their own rule (799cc9d3a: "a `NotEqual` with a
  `NaN` operand is True in a branch condition"; f13b6f46f: mixed relational
  chains as conjunctions). Narrower rule: two-valued comparisons in compiled
  code, every undecided value giving `false`.
- **CSE and performance.** A cost of the other axes: CSE must respect
  handler-lowered nodes and caller code (99e4e420f, b7c343f07).
- **`broadcast()` API, value kinds.** Features. The batch API has a `corpus`
  witness: the census counts the `broadcast: true` compile option in 2,870
  expressions of 314 documents, and Tycho uses `broadcastAsync()`,
  `evaluateAsync()`, `broadcast()` and `createKernelPool` (tycho-f9,
  2026-11-02; the contraction plan, step 2).
- **interval-js parity.** Each loop form (over a `Range`, a list input, a
  literal `List`) needs its own interval lowering (70f7d9554, 524bfb81c).
  Narrower rule: decline loops on interval-js.
- **Reserved names.** User names that collide with JavaScript or Python
  keywords and with fixed names of the emitted code. Narrower rule: prefix
  every user name in one place.

## 4. Witnesses

The agent searched every message for a Tycho row, an issue number or the word
"Tycho". 60 of the 340 commits name such a `corpus` witness (net 20,528 lines);
280 name none (net 68,635). No message uses the words `crafted` or
`plausible`; most name only `CE-<n>` entries, whose witness kind is in
`ROADMAP.md` and was not checked. By axis, the corpus-witnessed net is: type
system 4,911; mixed batches 4,243; bigint 2,467; GPU 2,094; numeric kernels
1,354; Missing 81. The absent-value and error-model code almost never names a
real document.

## 5. Problem spots: decided one way, then the other

- **Absent-value guards built, then removed.** Guards at every operator were
  added in 7b6b73f5a, cd704b6b8, a3fcd993d, 93d3c376d, 8c76cb6b8, 797aa8b3f,
  f169546e9 and 33651c6b1, and removed by d77c632d7 (−1,224) and 4c55bdbee.
- **Run-time shape dispatch built, then removed.** ba174fb6c and 7cc75ad90
  built it; 450e1ad49 removed `_SYS.bcastFn` and `callResultGuard` (−1,978).
- **`any`/`value` inputs decided both ways.** de18aed06 and ba174fb6c compiled
  `Sum` over an input declared `any` to a guarded fold; 3ba729792 made the same
  case decline one day later.
- **Default parameters done twice.** 4d6479dee filled by argument count so
  that a supplied `Missing` is kept; f9c63f9c1 removed the fill by count, so a
  supplied `Missing` takes the default.
- **Partial application.** 16b688765 (+688) compiled one-step currying;
  a13a1e08d, the same day, redefined a curried function as a deferred call.
- **Read-before-assign analysis built three times.** 1efbbe884 (+933),
  17ba3b407 (+508, Python), 15fc32706 (net −733).
- **Entry checks moved three times.** 173ec2e7d and 8a5fdcfc9 added them;
  2c1c2dc86 removed the run-time entry checks of collections (−357);
  797aa8b3f moved them to one place.
- **The spellings of "absent" changed many times.** `undefined` is `Missing`
  (458389f6c, 29b7ac9c2); `NaN` is an absence marker (09293e23f);
  `Indeterminate` is absent in `Coalesce` (92f424f3e); the discharges read
  every spelling (2ffbfc07a). Four `Nothing` commits on 2026-10-20 (eb7a56f25,
  8cd835712, 2f76a67a0, 2081e5469) each set one operator's rule.
- **Undecided comparisons decided one case at a time.** 27e093bcf, 799cc9d3a,
  cc72330ea, 8fd9f7394, c240193f0; then 0.177.0 let compiled code give `false`
  for `undefined > 0`.
- **Complex lane built twice.** 5e29489a6 (+3,132) then c4e0a3bdb (+566).
- **Matrix product.** 8843c9522, then three fixes within a day (046402a55,
  7008b8bd6, 84b20932f).

## 5a. A rule already decided that the code does not follow yet

The host that calls a compiled function is responsible for its inputs: it
supplies every input with a value of its declared type, and the result for any
other value is undefined (AGENTS.md, the compiled-code rule; R1 to R6 of
`2026-10-31-static-shape-compilation.md`). This rule makes every run-time
check of an input against its type or shape unnecessary, and every guard for
an input that the host leaves out. On 2026-11-01 the code still has them:

| Mechanism                                                              | Where                                       | References |
| ---------------------------------------------------------------------- | ------------------------------------------- | ---------: |
| `entryNoValue`, `checkEntry` (entry refusals of `run()`)               | `javascript-runtime.ts`                     |     18, 15 |
| `requiredInputAbsent`                                                  | `broadcast.ts`                              |          3 |
| `pythonNoValueGuard`                                                   | `python-target.ts`                          |          6 |
| `absentArgumentChecks`                                                 | `compile-user-calls.ts`                     |         25 |
| `absentArgumentFork`, `absentGuardedValueRef`, `jsCollectionShapeGuard` | `compile-callbacks.ts`                      |  12, 5, 5 |
| `declaredParameterCheck`, `localParameterChecks`                       | `compile-user-functions.ts`                 |       8, 9 |
| `absentBaseReadIsNumeric`                                              | `absent-tuple-read.ts`                      |         12 |
| `unsuppliedComparisonGuard`, `collectionReadInputs`, `withTruthOnly`, the rest of the absence module | `compile-absence.ts`, 1,823 code lines, about 60 exports | |
| the admission checks                                                   | `compile-admission.ts`, 1,461 code lines    |            |

The counts are `grep -w` hits in the compiler directory on 2026-11-01. The
ROADMAP items that remove this code exist: CE-712.3 (host values: the entry
refusals, the unsupplied-input guards, `declaredTopGuard`,
`jsCollectionShapeGuard`, the run-time point test in `compile-broadcast.ts`)
and CE-712.4 (declared types: each check reduced to its decline). Neither is
started. CE-712.3 was waiting for Tycho to call `hasUnresolvedInput` at its
sites; Tycho committed that (Tycho `2a598f4db`), so nothing blocks it. These
two items do not wait for the census or for the decisions of §6: they apply a
rule that is already decided. They are the first contraction to run.

## 6. Decisions to prepare

The specification that follows the census states, for each axis, the narrow
rule as options with one example each, and what Tycho loses under each
option. The axes with a language decision (not a feature choice) are:

1. `Missing`: a result only, never a declared input type; read only by
   `IsMissing`, `Coalesce` and a branch.
2. The error model: one static error and one dynamic non-value; whether
   `Nothing` and `Indeterminate` stay distinct.
3. Broadcasting: which operators, which list shapes, element-wise selection
   or not.
4. Comparisons: two-valued in compiled code or three-valued.
5. Block locals: single assignment before use, or the current analysis;
   caller code in `vars` as a value or refused.
6. Function values: fully applied calls only, or callbacks, currying and
   partial application.
7. The complex lane: decided once from the declared types, or the restart.
8. Open input types (`any`, `value`, `unknown`): already decided by R1 to R6.

The features (bigint mode, GPU storage buffers and field functions, numeric
kernels, value kinds) are kept or dropped by name, not narrowed; the
`broadcast()` API is kept, with Tycho as its witness.

### 6.3 Broadcasting and element-wise selection: the proposed constraints

**Today** (`docs/BROADCAST-MODEL.md`, the entries of 2026-07-27 and
2026-10-22): the condition of `If`, `Which` or `When` may be a nested list of
any rank, uneven rows included, with `True`, `False` or `Missing` cells. At
each level, the list conditions and the list arms must share a length, a
scalar lifts, and where the condition is a scalar the arm is taken whole. An
unmatched position gets an absence value chosen by the cell type (`NaN` for a
number, `undefined` for a point or a string), which `IsMissing` and
`Coalesce` read later. Python and interval-js refuse a list condition;
JavaScript implements all of it (`selectNested` in `javascript-runtime.ts`).
The compiler spends three modules on selection (`compile-conditionals.ts`,
`compile-conditions.ts`, `compile-match.ts`, 1,750 code lines) and about
2,900 lines of tests.

**What Tycho uses** (the census, §7): `When` with a list operand in 3 real
documents and 46 Desmos states; `Which` with a list operand in 13 and 23;
`If` with a list operand in none; no nested or non-rectangular list literal
anywhere; no `IsMissing` or `Coalesce`. Desmos has no nested lists (a list
holds numbers or points), so a mask of rank 2, an uneven mask and an arm of
lower rank than the mask cannot come from Desmos content. The census did not
count the rank of the masks directly; `census.mts` can be extended to do so.

**The constraints** (user, 2026-11-02: "reasonable"):

1. The condition is a boolean or a flat list of booleans, and nothing else. A
   nested list, an uneven list or a `Missing` cell in a condition is a static
   error. Removes: the mask-of-any-rank code, `selectNested`, the absence
   kind of a condition cell.
2. Every arm is a scalar or a flat list of the condition's length, and all
   arms have one element kind (all numbers, all points, or all strings). The
   result type is then `list<T>`, settled from the static types with no
   run-time test. Removes: the `incompatible-dimensions` check, the whole-arm
   rule at nested levels, the per-arm shape dispatch.
3. An unmatched position is `NaN` for a number cell and a point with `NaN`
   coordinates for a point cell; no `undefined`, no `Missing`, no readers. A
   plotter skips a `NaN` coordinate, which is what Desmos shows for an
   undefined element. This reverses the decision of 2026-10-18 on `undefined`
   cells. A string cell has no `NaN`, so a list of strings under a list
   condition is refused. To confirm with Tycho: a point with `NaN`
   coordinates is skipped everywhere it draws a point list, not only in the
   sampler.
4. A scalar condition selects an arm whole, as today. Element-wise selection
   happens only when the condition's static type is a list.
5. One operator and one lowering. `When` is dropped: `When(e, cond)` is
   exactly `If(cond, e)`, the two-argument `If` that the library already
   defines (`If(c, e1)` with no `e2`). `Which` stays for several clauses, and
   `If(c, e1, e2)` is `Which(c, e1, True, e2)` as documented. The LaTeX
   restriction syntax (`y = x \left\{x < 0\right\}`) keeps parsing, to `If`.
   The stacked rule `When(When(e, c1), c2) → When(e, And(c1, c2))` becomes
   `If(c2, If(c1, e)) → If(And(c1, c2), e)`. Cost: Tycho's source names
   `When` in 49 places across at least 8 files (restriction normalization,
   classification, the polar and GPU plot code), and 32 files of this repo
   and 40 lines of the LaTeX dictionary name it.

| Input                                                   | Today                              | Under the constraints                       |
| ------------------------------------------------------- | ---------------------------------- | ------------------------------------------- |
| `Which(x < 0, 1, True, 0)`, `x: list<real>`             | `[1, 0, …]` element-wise           | same                                        |
| `When(y, x < 0)`, `y: list<real>`, no match at 2        | `NaN` at position 2                | same, written `If(x < 0, y)`                |
| `When(p, p.x < 0)`, `p: list<point>`, no match at 2     | `undefined` at position 2          | `(NaN, NaN)` at position 2                  |
| `If([[True], [False, True]], 7, 0)`                     | `[[7], [0, 7]]`                    | static error                                |
| `If(M < 3, [10, 20], 0)`, `M` a 2×2 matrix              | `incompatible-dimensions` error    | static error, no check code                 |
| `Coalesce(First(Which(v > 0, (1, 2))), (9, 9))`         | `(9, 9)`                           | `(NaN, NaN)`; `Coalesce` on a cell is gone  |

What Tycho loses: nothing the census can see, subject to the `NaN` point
check in item 3 and the `When` migration in item 5.

**Tycho's answers** (session tycho-f9, 2026-11-02, read from Tycho commit
2ac8ce122 and one probe of CE 0.176.0):

- Today a number cell with no match is already `NaN`
  (`[1,2,3]\{[1,2,3]>1\}` gives `[NaN, 2, 3]`); only a point cell changes,
  from `Missing` to a `NaN` point. The 2D point consumers Tycho read skip a
  point with a non-finite coordinate (`scatter-series.ts`,
  `polygon-list-series.ts`, `vector-field-series.ts`, `bar-series.ts`), and
  the compiled sampler already receives `NaN` from a `When`. Not checked: the
  3D point routes, point labels and the GPU point routes. Code that reads a
  `Missing` cell by name and must change, harmlessly: the point-list
  classification (`classification-shape.ts`,
  `classification-collection-evidence.ts`, where a `NaN` tuple already counts
  as a point, like the Desmos `(0/0,0/0)` separator), `relation-family.ts`
  (maps `Missing` to `NaN` columns) and `at-index-semantics.ts` (a `Missing`
  mask cell is false; a scalar `Which` with no match is broadcast to `NaN`
  slots). The scalar no-match result of `Which` must keep its current value
  for that last site.
- The `When` migration is about 45 code sites in about 25 files, mechanical,
  but Tycho depends on a restriction being different from a piecewise:
  classification splits the restriction condition into a domain interval, a
  mask and a visibility condition; `normalize-restrictions.ts` hoists `When`
  to the top of the row and treats `Which` as opaque; `shared-subexpressions`
  and `chain-staging` list `If` as a branching head but not `When`, so a
  restriction that arrives as `If` would start to be treated as a branch; the
  interval mask is built only for a top-level two-operand `When`. Tycho can
  recognize a restriction as a two-argument `If` only if CE keeps two
  promises: (a) `\{c: e\}` keeps parsing to `Which` and is never canonicalized
  to `If(c, e)`; (b) a scalar condition still accepts an arm that is not a
  value (a relation `Equal(y, x)`, since `y=x\{x<0\}` evaluates to
  `When(Equal(y, x), Less(x, 0))`; a `Histogram` call; a tuple row; a
  function-call restriction `m(t)\{…\}`). If CE merges a single-arm `Which`
  into `If` as well, Tycho needs another marker. Estimate: one implementer
  item of moderate size; the risk is in the classification and
  restriction-hoisting tests and in a new render of the 46 Desmos states with
  a list operand.
- No route builds a rank-2 or uneven mask or an arm of lower rank: the mask
  builders wrap scalar sampled bodies, the certificate helpers have real-typed
  parameters, the importer reads flat Desmos lists, and `list-zip.ts` rewrites
  `Which`/`If` over zipped lists into scalar arms. A rank-2 mask from a nested
  comprehension is not ruled out by that reading.
- No list of strings under a list condition was found.

So the constraints hold for Tycho with two additions to item 5: the promises
(a) and (b) above, and the scalar no-match value of `Which` unchanged.

**Tycho's request, in place of promise (a)** (tycho-f9, 2026-11-02; accepted
in principle by the user the same day): a trailing restriction `e\{c\}` binds
to the whole of the smallest group that holds it, not to the nearest
operand. The rule, Tycho's full boundary table with corpus counts, and what
it closes are in `docs/plans/2026-11-02-restriction-binding.md`. In short:
`\{c\}` binds looser than arithmetic and tighter than a relation, `\to`,
`for`, `with` and the comma; the parse is `If(c, e)` with no `When` alias;
stacked restrictions merge into `If(And(c_1, c_2), e)`. A relation keeps the
`If` in its operand, `y=x\{c\}` is `Equal(y, If(c, x))`, so that a
definition and a relation parse alike; Tycho's first message had the `If`
outside the relation, and its table replaces that. Tycho then removes its
restriction-moving walk (its roadmap entry IL) and reads the root or the last
relation operand. `\operatorname{with}` must be parsed for one row of the
table, a separate item.

## 7. The census (the next step; a new session)

Before the decisions, measure what Tycho uses. Two corpora exist and both have
a harness in `~/dev/tycho/scripts/`:

- the 757 real documents that `audit-ce-codegen.mts --all` drives through the
  product pipeline and compiles for JavaScript, interval-js and GLSL (the
  harness around it is `~/.claude/tools/ce-census/value-audit.sh`, which runs
  it against a production build of a Compute Engine worktree under the box
  lock);
- the 5,337 Desmos equation rows that `ce-round-trip-audit.mts` boxes as the
  product boxes them.

For every expression of both corpora, as boxed and canonicalized, count:

- operators used, and for each of `Which`, `If`, `When`, the comparisons and
  the connectives, whether an operand's static type is a list (element-wise
  use) and whether a cell can be absent;
- declared and inferred types of inputs and parameters: how many contain
  `missing`, `any`, `value`, `unknown`, a union of shapes, `complex`;
- list shapes: rectangular or not, nesting depth, lists of points;
- `Nothing` and `Indeterminate` as results, and `IsMissing`, `Coalesce` and
  `AssertPresent` as readers;
- function values: callbacks passed to `Sort`, `Map`, `Iterate`, `Pipe`;
  currying; partial application; parameter defaults;
- block locals: a read before the first assignment on some path, an
  assignment in a branch, a loop whose value is used, `vars` entries that are
  code;
- compile options used: the targets per expression (not the bigint mode,
  which Tycho does not use; see §3);
- values that cross a real/complex lane.

The count is a table per feature: expressions that use it, documents that use
it, and three example expressions in LaTeX. It is written to
`docs/plans/2026-11-01-language-axes-survey/census.md`. An interpreter-side
counter (a hook on `ce.box` and on the compile entry) is enough; no production
build is needed, so no box lock, except for the final audit run if its
harness is used.

Then the specification of §6 is written as one page per axis, each with the
options, one example per option, Tycho's use count from the census, and the
compiler code that each option removes. The user chooses; the compiler is
then contracted axis by axis, with the corpus comparison of the simplification
plan (§3 there) as the safety check: zero new declines on the corpus, zero
changed values.
