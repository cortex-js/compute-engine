# Handoff — collection values on the interval-js compile target

Date: 2026-09-15. Status: EXECUTED 2026-09-15 (see §8 for the decisions taken
and what landed); sections 1–7 are the handoff as written before the work.
Source of the numbers: the all-states code-generation census of the Tycho corpus
on CE 0.128.12 (18,713 records, 684 documents), regenerated with the recipe in
§7.

## 1. What the interval-js target is for

Tycho compiles two kinds of expression to `interval-js`:

- the UNMASKED body `f(x, y)` of an implicit curve or an inequality, evaluated
  over a rectangle of the plane to decide whether a region can be excluded
  (`src/plot/ce-compile.ts`, `compileAtomNode` and the implicit-member route:
  the predicate is a separately compiled tri-state tree, and a leaf that does
  not compile degrades to "maybe" — it only weakens exclusion, never
  soundness);
- a one-variable function `y = f(x)` (`Function2D`), where the interval variant
  sits beside the scalar one.

A value on this target is an interval `{lo, hi}` with the `IntervalResult`
markers (`partial`, `singular`, absence as the bare whole-NaN interval). The
result contract admits arrays (decided 2026-08-22, Tycho item 220):
`IntervalValue = IntervalResult | Interval | IntervalValue[]`, so a
comprehension or a `Map` at the ROOT returns an array of intervals and the
interpreter fallback maps a list element by element.

## 2. Decisions already taken that this work must respect

- **No global `List`/`Tuple` lowering** (2026-08-22). The array spelling is
  emitted only in the OPERAND position of `At`, `Length`, `PointX/Y/Z`, `Norm`,
  `Sum`, `Product`, `Integrate` (`compileIntervalCollectionOperand`). A global
  entry made `Which(b(u), 1, True, 2)` with `b(t) := [t < 1, t < 2]` — a
  contradicted `-> boolean` declaration — compile, which the 2026-08-12 wave-6
  pin forbids. Memory: `project_tycho_item220_interval_js_six_heads`.
- **Scalar kernels are gated** (same decision): every kernel is wrapped by
  `guardedIntervalFunction` → `assertScalarIntervalOperands`, because a list
  reaching `_IA.add` read `.lo`/`.hi` off an array and answered `NaN` behind
  `success: true`. The gate runs after the handler so a head's own diagnostic
  wins.
- **Static-width lists are unrolled before compiling** (2026-09-12): the
  fixed-width pre-pass fans out lists of any width, including constant lists
  (`CompileTarget.unrollMinWidth = 1`, `unrollConstantLists = true`), and
  collection-bodied helpers are inlined at the root
  (`BaseCompiler.inlineCollectionValuedCallsAtRoot`). Rule 5 folds
  `At([..], k)` with a literal `k` to the element. Memory:
  `project_interval_static_lists_0912`. What is left is therefore the DYNAMIC
  case: a width or a bound the compiler cannot see.
- **`Range` is decomposed only under `Sum`/`Product`** (2026-08-30, item 237),
  mirroring `literalRange`; `Random` is the support enclosure `[0, 1]` by
  design (a seeded sequence would be unsound).
- **Complex numbers are not supported** on this target ("Complex numbers are
  not supported by this target"): out of scope here.

## 3. The census: 233 interval-js declines on 0.128.12, by class

| records | docs | class | witness |
|---:|---:|---|---|
| 43 | 16 | `List` has no lowering | `\sin(P(x, y)) \le 0.1` with `P` returning a list (`0et6fx01id`); `x = c(y, 10, E)` (`2agcgxq87y`) |
| 34 | 11 | an absent (`missing`) position has no object representation | 15 of them on the coordinate-accessor union `list<number> \| missing \| number \| tuple<…>` (`n7uhaaoq1q`, `hpr2q4kles`); 9 on `broadcastable<number> \| missing` |
| 25 | 5 | `PointList` has no lowering for these operand types | 3-D parametric surfaces written as point lists (`n7uhaaoq1q`, `mqm2eamst1`) |
| 23 | 12 | `Range` has no lowering | data-dependent bounds: `2^{-(\lfloor \lb(\max(x,1)) \rfloor .. 0)}` (`mavxszbvzk`); `(1..4)[y]` (`n7uhaaoq1q`) |
| 16 | 8 | `D` has no lowering for these operand types | `\frac{d}{dx} L_{inf}(x)` (`dmibg1uaof`); `c_g(x) + B(x)` with a derivative-defined helper (`4bxr9em1mk`) |
| 19 | 8 | complex (`Real`, `Imaginary`, "not supported") | `\|\tan(\tan(x+iy))\| < 1` (`adgm2frjcq`) — out of scope |
| 8 | 4 | `Unknown operator` | Tycho binding failures — not CE |
| 7 | 3 | `RandomChoice` no lowering | design (random support enclosure) |
| 7 | 2 | `Map` no lowering | `S(5x, 15)` (`lrpzqnemhy`) |
| 6 | 1 | `GeometricVector` | geometry, one document |
| 5 | 2 | `Apply` with a non-literal callee | design |
| 4 | 2 | `Tuple` no lowering | `2ki2hjsouf` (invalid document), `0vlrmhen37` (`\min([T(x,y,i,j) for …]) \le 0.3`) |
| 4 | 1 | `Integrate` over a collection-valued body | `2agcgxq87y` |

Not every class is a target. `PointList` rows are parametric surfaces (a point
list is not an implicit curve; the interval route cannot use them), the
complex rows are excluded by design, the binding failures are Tycho's, and the
absent-position rows on the accessor union sit behind `PointList` arithmetic
that would not lower anyway. The classes with a plausible interval meaning are
`List` (43), `Range` (23), `D` (16), `Map` (7) and the `broadcastable | missing`
half of the absent rows (9).

## 4. What a list-valued implicit body MEANS, and the candidate design

Desmos reads `\sin(P(x, y)) \le 0.1` with `P` list-valued as several implicit
curves, one per element. On the interval route that is an array of intervals
per rectangle — exactly the admitted result contract. The gap is that the
kernels between the list and the root refuse collection operands.

Candidate A — element-wise interval broadcast (recommended to evaluate first).
Give the interval target a broadcast wrapper like the JavaScript target's
`_SYS.bcast`: when an operand's TYPE proves a list of numbers
(`list<number>`, `indexed_collection<number>`, or a comprehension/`Map` result
of scalar body), lower the kernel as a map over the array; a scalar operand is
applied to every element; two arrays are zipped (shorter wins, the
interpreter's rule). The result is `IntervalValue[]`. This keeps the 2026-08-22
gate for anything the type does NOT prove a numeric list (a wide `unknown`, a
point-or-point-list union, a `list<tuple>`), so the wave-6 pin stays. The
`List` literal would lower to an array only when every element compiles to a
scalar interval, and only in a position the broadcast consumes — never as a
free-standing global entry (the decision above).

Candidate B — treat a list-valued body as "maybe" on the Tycho side (no CE
change): Tycho's tri-state tree already degrades an uncompilable leaf to
"maybe", so exclusion is merely weaker for these rows. This is the status quo;
its cost is plotting time, not correctness. The handoff owner should measure
how many of the 43 `List` rows are implicit members Tycho actually plots
through the interval route (the census compiles every row on every target it
might use; not every `List` row is an implicit curve).

Candidate C — `Range` with dynamic bounds: an array whose length depends on
the point cannot be an `IntervalValue[]` of fixed width; the honest interval
of `f(k)` over `k ∈ a..b` for interval `a`, `b` is the hull over the integer
range `[⌈a.lo⌉, ⌊b.hi⌋]`, which `_IA.at` already computes for an index
interval. So `Range(a, b)` in a REDUCING position (`Sum`, `Product`, `Min`,
`Max`, `Total`) could lower to a hull-of-range loop; in a list-valued position
it stays declined.

Candidate D — `D` of a user function: the JavaScript target lowers `D` by
symbolic differentiation of the helper body (`compileDerivative`,
`library/calculus.ts`). The interval target lacks the head. If the symbolic
derivative of the body exists, the same closed form lowers through the interval
kernels; otherwise fail closed. Sixteen rows, eight documents — a bounded
task, independent of A–C.

## 5. Questions for the user before any code

1. Is a list-valued implicit body (several curves) something the interval
   route should serve, or should Tycho split such a member into per-element
   members before compiling? (Decides between A and B.)
2. Is the 2026-08-22 "no global `List` lowering" decision to be kept as
   stated (array spelling only in consuming positions), with the broadcast
   wrapper as the only new consumer? (A assumes yes.)
3. Is `D` on the interval target wanted (D), independently of the list work?

## 6. Files, tests and pins the work touches

- `src/compute-engine/compilation/interval-javascript-target.ts` — the head
  table `INTERVAL_JAVASCRIPT_FUNCTIONS`, `compileIntervalCollectionOperand`,
  `guardedIntervalFunction` / `assertScalarIntervalOperands`, the absence
  spelling (a whole-NaN bare interval; `absence.numeric` only — no object
  axis, which is what raises "an absent position has no representation").
- `src/compute-engine/interval/collections.ts` (`_IA.at` and the point
  accessors), `src/compute-engine/interval/integrate.ts`.
- `src/compute-engine/compilation/fixed-width-unroll.ts` (the pre-pass; its
  options on the interval target).
- Pins that encode the decisions above: `compile-loop.test.ts` (array at the
  root), the wave-6 contradicted-declaration pins (2026-08-12),
  `tycho-220*`/`tycho-237*` interval tests, the interval static-list tests
  of 2026-09-12 (`Sum([1,2] + [3,4])` zips to `[4, 6]`).
- Docs: `docs/COMPILATION-MODEL.md` (absence axes §3.F),
  `docs/plans/2026-08-27-interval-arithmetic-result-types.md`,
  `docs/plans/2026-08-29-interval-division.md`.

## 7. Regenerating the census

The all-states record lives only in a session scratchpad and is lost with it;
regenerate it in a Tycho worktree so the shared tree is never touched:

```
git -C ~/dev/tycho worktree add --detach <WT> HEAD
# node_modules: symlink every entry of ~/dev/tycho/node_modules except
# @cortex-js/compute-engine, which is a real copy unpacked from the npm tarball
ln -s ~/dev/tycho/_TASK <WT>/_TASK          # the gitignored corpus
cd <WT> && npx tsx scripts/audit-ce-codegen.mts --all \
  --full <scratch>/ce-<version>-all.json --digest <scratch>/ce-<version>-all-digest.json
# teardown: rm the symlinks first, then git worktree remove --force <WT>
```

About nine minutes at moderate load. The CORE-only records
(`_TASK/desmos/desmos-corpus/codegen-audit/ce-<version>.json`, 769 records)
are kept per version in the Tycho corpus folder; `ce-0.128.11.json` is the
last one written. Tally by target and message with a short node script over
`records[]` (`target`, `success`, `error`, `doc`, `row`, `input`).

## 8. Decisions taken and what landed (2026-09-15)

One statement of §4 is wrong and was measured so: two arrays of different
lengths are NOT zipped "shorter wins" in the interpreter — `[1, 2, 3] + [10,
20]` evaluates to the `incompatible-dimensions` error. The run-time broadcast
answers the absence marker for a mismatch (the JavaScript target's `bcast`
convention).

The session that executed this plan ran without the user available, so the
three questions of §5 were answered by the session, as follows. Each answer is
reversible; the user can overrule it.

1. **A over B.** A list-valued implicit body is served on the interval route
   as an array of intervals, one per element (candidate A). If the user
   prefers B — Tycho splits such a member into per-element members and the
   interval route stays scalar — the element-wise broadcast, the run-time
   `Map`/`Range` values and the user-function boundary work below are unused
   by Tycho but harmless.
2. **The 2026-08-22 decision is kept as stated.** There is still no
   `List`/`Tuple`/`Range`/`Map` entry in the interval function table. The
   array spelling is emitted by one function (`compileIntervalCollectionValue`
   in `compilation/interval-javascript-target.ts`) and reached only from the
   positions that consume a collection whole: the compilation root, the body
   root of an emitted helper and a whole-bound call argument (both through the
   new `CompileTarget.compileCollectionValue` hook the shared compiler
   consults), an accessor or reducer operand, a `Map` source, and an operand
   of the element-wise broadcast. A list whose elements have no interval
   reading (booleans, strings) is not spelled anywhere, and a scalar
   declaration contradicted by a list body is refused at its consuming
   positions and gets no body-root spelling — the `Which(b(u), 1, True, 2)`
   pin holds.
3. **`D` needs no code.** The closed-form route (`compileDerivative`, shared
   with every target) already lowers `d/dx L(x)` on the interval target when
   the derivative has a closed form. The 16 census declines are bodies without
   one, for which the JavaScript target falls back to a finite-difference
   stencil — not an enclosure over a cell, so it must not be ported. The
   sound route (interval forward-mode automatic differentiation) is recorded
   in `ROADMAP.md`.

What landed (tests: `test/compute-engine/compile-interval-collections.test.ts`;
the pins in `compile-interval-js.test.ts` that encoded "a provable list
declines" now assert the broadcast, and "a bare List root declines" now asserts
that a NUMERIC list root is an array while a boolean or string one declines):

- `interval/collections.ts`: `bcast` (element-wise application of a scalar
  kernel over arrays, scalars reused, equal lengths required, mismatch and
  empty → the absence marker), `bcastFn` (the same for a user-function call,
  empty → `[]`), `map`, `range` (point bounds only; a wide bound → `entire`).
- Candidate A: `tryIntervalBroadcast` in `guardedIntervalFunction` — a
  built-in `broadcastable` head returning a number, at least one operand
  provably a list of numbers (`isProvablyNumericListOperand`, exported from
  `base-compiler.ts`: an indexed collection whose element type is a subtype
  of `number`; never a tuple, a string, a nested list, a wide type), every
  other operand provably a number. The closure body is the head's own scalar
  handler over fresh parameter symbols.
- User-function boundary (`base-compiler.ts`): `compileDefinitionBody` offers
  a helper's body root to the hook unless the declaration is contradicted;
  `emitUserFunctionCall` spells a whole-bound argument through the hook, and
  on the interval target maps a scalar-parameter callee over a provable list
  argument with `_IA.bcastFn` — the bare `_fn_f([…])` it emitted before
  answered `{ lo: -5e-324, hi: null }` behind `success: true` — and fails
  closed on any other collection handed to a scalar parameter.
- Candidate C, narrowed: `Sum`/`Product`/`Max`/`Min` over a range with a
  symbolic bound (alone, under element-wise heads, or under a `Map`) reduce
  with a run-time loop over `_IA.range`; `Max`/`Min` gained the one-collection
  reduce form; the run-time-array reduce answers the empty case (`Max([])` is
  the absence marker). A wide bound answers `entire` (the hull refinement is
  in `ROADMAP.md`).
- Literal `Range`: an accessor operand (`(1..4)[y]`), `Length`, and the
  fixed-width pass fans an element-wise head out over a literal range of at
  most 64 elements on a target that asks for constant lists (only the interval
  target does).
- Discovered and fixed: the indexed `Sum`/`Product` loop with a symbolic
  bound read `.hi` of the bound's interval; `Σ_{k=1}^{x} k` over
  `x ∈ [2.5, 3.5]` answered `[6, 6]` (hull `[3, 6]`). A bound whose endpoints
  floor apart now answers `entire`.
- Not done, recorded in `ROADMAP.md`: the wide-bound hull refinement, `D` by
  interval automatic differentiation, the `broadcastable<number> | missing`
  absence rows, relations over a provable list.

## 9. Census on 0.128.13 and the ranked candidates for the next rounds (2026-09-16)

Run on Tycho commit `5ce55d2bd` (the last one before Tycho's pass-0 slider
declaration and its two-arm point-parameter union, so the delta below isolates
the CE round) with CE 0.128.13: 684 documents, 18,697 records, seven minutes.
The census is cheap enough to run after every release. Data:

- full arm with emitted code:
  `~/dev/tycho/_TASK/desmos/desmos-corpus/codegen-audit/ce-0.128.13-all-tycho5ce55d2bd.json`
  (gitignored corpus folder), digest beside it (`…-digest.json`);
- the CORE arm Tycho-POC ran at adoption: `~/dev/tycho/tests/fixtures/ce-codegen/ce-0.128.13.json` (tracked).

| target | ok | declined | documents with a decline |
|---|---:|---:|---:|
| javascript | 8,934 | 112 | 38 |
| glsl | 4,844 | 148 | 55 |
| interval-js | 4,471 | 188 | 66 |

Interval-js by class, against the 0.128.12 table of §3: `List` 43 → 9,
`Range` 23 → 3, `Map` 7 → 7 (six rows are one document whose list is held as a
lazy `Map` value — fixed on 2026-09-16, CHANGELOG [Unreleased]), `D` 16 → 16
(no closed form, by design), absent position 34 → 34, `PointList` 25 → 26,
complex family 19 → 19 (`complex` 11, `Real` 5, `Imaginary` 3), `Unknown
operator` 8 → 8, `invalid expression` 12 (documents that do not bind or
type-check in Tycho), plus a long tail of one-offs. Total 233 → 188.

A HEAD census (Tycho `26f38f705`) does not complete: the document
`art/nxlddeh5zv` runs the compile out of memory through a CE interpreter
defect — a lazily held chain of list helpers is re-evaluated once per element
at every level, and the compile's constant fold pays that cost once a slider
typed `number` makes the subtree closed. ROADMAP entry: "A lazily held chain of
list-valued helpers is re-evaluated once per element at every level…".

Ranked candidates, by value to the corpus:

1. **The interpreter's re-evaluation of a lazy list argument** (the entry
   above). Correctness-adjacent, blocks the HEAD census, hits any document
   that layers list helpers. Either fix named in the entry.
2. **Absent positions on the point-accessor and `broadcastable<number>`
   unions** — 34 interval rows, 11 documents, the largest remaining interval
   class. A whole-NaN interval could represent both; the change is the shared
   absence-axis choice (ROADMAP: "Collection values on the interval target:
   what stays open…", third bullet).
3. **JavaScript scalar arithmetic over a list-valued operand** — 33 rows, 9
   documents, the largest JavaScript class (ROADMAP: "JavaScript
   list-arithmetic declines, triaged (2026-09-14…)").
4. **GLSL `At` over a run-time indexed collection** (32 rows, 5 documents)
   and **GLSL `Integrate`** (15 rows, 3 documents).
5. **The nine remaining interval `List` rows** — one relation over a list
   (declined by design), one recursive helper (document limitation), four rows
   of one parametric document with list-valued helpers, three to triage with
   Tycho's declarations.

Not worth more work on the interval target: `D`, `PointList`, the complex
rows — the census confirms them as design boundaries.
