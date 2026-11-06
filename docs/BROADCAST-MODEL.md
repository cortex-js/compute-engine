# Broadcast Model — Length-Mismatch Policy

**Status**: ratified 2026-07-27 (consult in-session; supersedes the staged
2026-07-27 attempt to pull `PointList` into the strict regime, which was
reverted the same day). The lifted-operator half shipped with the element-wise
rounds of 2026-07-24/26 (see `CHANGELOG.md` under 0.97 "Breaking Changes").
The lone-empty operand answers the EMPTY LIST since the user ruling of
2026-09-21 (it answered the erasure marker `Nothing` before that date).

## The rule

There are two regimes, and which one applies is decided by **what the user
wrote**, not by the operand shapes:

1. **An operator LIFTED over collections requires length agreement.** When an
   operator is implicitly broadcast over collection operands — `Add`,
   `Multiply`, `Divide`/`Power`/`Mod`, the ordering relations, the logical
   connectives, `ElementMax`/`ElementMin`/`Clamp`, and a user function with
   scalar parameters called over lists (on every route: `DefineFunction`,
   `:=`, a function declared `function` and assigned, and a function literal
   applied with `Apply`; user decision 2026-09-26) — a length mismatch is
   `incompatible-dimensions`, never a silent zip-to-shortest. The user asked
   for `a + b`, not for a pairing; truncation would return a plausible answer
   that silently discards data.

   A parameter with no declared type counts as a scalar parameter here, and
   the function is mapped over the leaves of a nested list before its body
   runs. So `g(A) := A^2` applied to `[[1, 2], [3, 4]]` gives the cells
   squared, `[[1, 4], [9, 16]]`, while `[[1, 2], [3, 4]]^2` written directly
   is the matrix power `[[7, 10], [15, 22]]`. A body that takes the whole
   matrix needs a declared parameter: `g(A: matrix) := A^2`. The user decided
   (2026-10-15) to keep this mapping instead of passing a square matrix whole,
   because the alternative gives `f(x) := \sin x` the matrix sine instead of
   the sines of the cells. Pinned by `test/compute-engine/apply-literal-maps.test.ts`
   ("a nested list is mapped at its leaves, and typed so").

   A parameter declared with one of the wide types `any`, `expression` or
   `value` is not a scalar parameter. These types admit a collection, so the
   parameter receives a collection argument whole (user decision 2026-10-30,
   GitHub issue #488). With `f := (t: any) ↦ (0 if t ∈ ℤ else 1)`,
   `f([[0, 0], 5])` is `1`; with no declaration, `t ↦ (0 if t ∈ ℤ else 1)`
   gives `[[0, 0], 0]`. A recursive function that descends into a nested
   list works with a wide declaration too: with
   `leaves := (t: any) ↦ (1 if t ∈ ℤ else leaves(t[1]) + leaves(t[2]))`,
   `leaves([[0, 0], 0])` is `3`, not `[[1, 1], 1]`. A transparent alias of
   a wide type is a wide type; a nominal type is not. A parameter declared
   `unknown`, or with a transparent alias of it, is the same as a parameter
   with no declaration, also for the reading of the body: the canonical
   literal does not keep the annotation, so `(t: unknown) ↦ …` is `t ↦ …`,
   and the `leaves` function above with `t: unknown` also gives `3`. This
   is tested for a function literal, `Apply`, `:=`, `DefineFunction`, a
   function declared `function` or `(unknown) -> unknown` and then
   assigned, a declared callback slot, a value-kind declaration, a clause
   and a block-local function. The test is
   `isScalarType()`
   (`boxed-expression/function-literal.ts`). Pinned by
   `test/compute-engine/apply-literal-maps.test.ts` ("A PARAMETER DECLARED
   WITH A WIDE TYPE").

   Compiled code does not test the shape of a value at run time. It
   declines (falls back to the interpreter) arithmetic over a parameter
   declared `any` or `value`, with the code `'unsettled-shape'`: with
   `M: list<list<real>>`, `((t: any) ↦ 2t)(M)` declines, and the interpreter
   gives `[[2, 4], [6, 8]]` for `M = [[1, 2], [3, 4]]`. It also declines a
   call where an argument that can be a collection reaches a parameter
   declared `expression`:
   `((t: expression) ↦ 2t)([[1, 2], [3, 4]])` is computed by the
   interpreter as `[[2, 4], [6, 8]]`, and `((t: expression) ↦ 2t)(5)` still
   compiles. The rule is the same for a function literal and for a named
   function, in the two positions where it can be met. A direct call
   (`h(L)`) declines when an argument that can be a collection reaches such
   a parameter. A function VALUE (`compile(h)`, or `h` handed to a consumer)
   declines, because its arguments are not known, except at a callback
   consumer (`Map`, `Filter`, `Reduce`, `Scan`, `Tabulate`, `Fill`) that
   passes values whose type cannot be a collection: with `h := (t:
   expression) ↦ 2t`, `Map(h, L)` compiles when `L` is declared
   `list<real>`, and `Map(h, rows)` declines when `rows` is declared
   `list<list<real>>`. The tests are
   `collectionAtExpressionParameter()` (`compilation/compile-user-calls.ts`)
   and `withCheckedCallback()` (`compilation/compile-callbacks.ts`).

   A call where a collection is bound whole at such a parameter is not
   typed by the result of the signature, scalar or not: `(t: expression) ↦
   2t` has the result `number`, and its value for `[1, 2]` is `[2, 4]`.
   When the argument is certainly a collection, the call is typed from the
   body with the parameter typed as the argument (`list<integer>` for a
   `list<integer>` argument). When the argument can be a collection but is
   not certainly one (`L` declared `any`, or `list<integer> | integer`), the
   call is typed `any`. The test is `wideParameterArgument()`
   (`boxed-expression/call-result-type.ts`).

   A tuple argument is mapped at a parameter declared with a scalar type
   (`real`, `number`, …), on every route: a built-in scalar function
   (`Sin((1, 2))` is `(sin 1, sin 2)`), a declared named function, and a
   function literal whose parameter is typed in place (`((u: real) ↦ 7)((3,
   4))` is `(7, 7)`). The result is a tuple. A parameter with no declared type
   binds the tuple whole: `(u ↦ Length(u))((3, 4))` is `2`. So does a
   parameter declared `any`, `expression` or `value`. Compiled code
   computes the same tuple (user decision 2026-10-03).

   A function that passes a collection to itself at a parameter position (a
   list literal, a range, a comprehension, any collection-typed argument)
   makes that parameter a collection, so a list argument is passed whole, not
   mapped (user decision 2026-10-08). With
   `f(n, s) := s if n = 0 else f(n - 1, [1, 2])`, `s` is inferred `list<any>`
   and `f(1, [0])` is `[1, 2]`; mapping would add one level of nesting per
   recursion step. Forwarding the bare parameter (`f(n - 1, s)`) is not
   evidence, and a function that does not call itself
   (`g(s) := 5; g([1, 2])` gives `[5, 5]`) still maps. The evidence is
   collected in `inferredCollectionParameterType()`
   (`boxed-expression/effects-inference.ts`).

2. **An explicit PAIRING constructor defines its length as the shortest
   input.** `Zip`, the variadic `Map`, and `PointList` are operations whose
   *defined output* is the pairing up to the shorter operand — the shortest
   length is the contract, not a truncated version of some longer true
   answer. `PointList([1,2,3],[10,20])` is two points (a ratified consumer
   contract, Tycho item 52); `Zip` with an unbounded source is the enumerate
   idiom.

Corollary rules for the strict regime:

- A **scalar** operand is a LIFT, not a participant — it never mismatches.
- A **tuple** beside a list is a participant under a built-in operator that
  reads it by position: `Power((1, 2), [3, 4])` is `[1, 16]`, and
  `Power((1, 2), [3, 4, 5])` and `Arctan2([3, 4, 5], (1, 2))` are
  `incompatible-dimensions`. The check is `zipLengthMismatch`
  (`collection-utils.ts`). A tuple is a lift, with no length to compare, for
  the heads that combine points (`Multiply((1, 2), [3, 4, 5])` is a list of
  three points), for the heads that read its norm (`Hypot`, `Abs`), and for a
  user function with scalar parameters.
- A **broadcast operand is evaluated ONCE** (broadcasting is an operation on
  values): `L < Random()` draws once; a per-element draw is written
  explicitly as `Map(l ↦ l < Random(), L)`.
- An **unbounded** operand against a finite one is a mismatch (`count` is
  `Infinity`, which agrees with no finite length).
- An operand whose length is **not yet known** is not compared — there is
  nothing to compare until it resolves. (Residue: the lazy variadic `Map`
  that then zips those uses shortest-input semantics, so a late-resolving
  mismatch can still truncate; see ROADMAP "Broadcast semantics residue". The
  lazy `Map` also repeats a tuple whole in each cell: with `n` having no value,
  `Power((1, 2), Range(1, n))` is a `Map` that gives `[(1, 2), (1, 4)]` for
  `n = 2`, where a new evaluation with `n = 2` gives `[1, 4]`.)
- A lone **empty** operand broadcasts to the EMPTY LIST: `Not([])`, `Sin([])`,
  `-[]`, `|[]|`, `[] < 3`, `2·[]` and `[] + 1` all evaluate to `[]`, under
  `evaluate()` and under `.N()` alike (ruled 2026-09-21; the answer used to be
  the erasure marker `Nothing` for the unary and element-wise heads, while
  `Add` and `Multiply` already answered `[]`). An empty operand alongside a
  NON-empty one is an ordinary length mismatch, not an erasure:
  `Sin([]) + [1, 2]` is `incompatible-dimensions` (`0 vs 2`), exactly as
  `Sin([1,2,3]) + [1,2]` is. The pairing constructors are unaffected —
  `PointList` and `Zip` still pair up to the shorter input.

## Why this split

- **Failure-mode asymmetry.** In the lifted case a mismatch almost always
  means a bug (an off-by-one `Range`, a `Filter` that changed length); an
  error is recoverable in seconds, while truncation produces a
  plausible-but-wrong answer whose discarded tail is undetectable after the
  fact. In the pairing case the shortest length is the documented output, and
  the permissive semantics stays *expressible* — a user who means
  "pair as far as both go" writes `Zip`/`Map` — while the reverse (recovering
  strictness from a truncating default) would be impossible.
- **Precedent.** Strict lifting is where the ecosystem converged: NumPy
  errors on shape mismatch (its broadcasting only lifts size-1 axes — the
  scalar-lift rule generalized), Julia throws `DimensionMismatch`,
  Mathematica's `Thread` errors, and R's recycling is the standing cautionary
  tale. For explicit pairing, Python's `zip` kept shortest as the default and
  added `strict=True` as an opt-in (PEP 618) — evidence both that
  shortest-zip bugs are real *and* that the remedy is an opt-in check, not a
  default flip.
- **Consistency.** `Add` on mismatched vectors has no mathematical meaning,
  so it must error; any truncating choice for comparisons or connectives
  would re-create the head-dependent inconsistency (and the old
  size-threshold incoherence) that the 2026-07-24 ruling removed. Conversely,
  making `PointList` strict while `Zip` stays shortest would create a new
  inconsistency *within* the pairing family — and making the whole family
  strict kills the unbounded-zip idiom.

## Consequences for consumers

- Desmos-style silent truncation of ragged *operator* operands is not
  replicated by the engine; an importer that wants it clamps (or lowers to
  `Zip`/`Map`) at its own boundary. `PointList` needs no such clamping — its
  shortest-zip is the Desmos-compatible pairing, contained by design in this
  one constructor (Tycho item 25 moved it out of generic `Tuple` evaluation
  for exactly this reason).
- If the hidden-bug class in pairing ever bites, the sanctioned extension is
  a PEP-618-shaped **opt-in strict mode** on the pairing operations (a
  `strict` variant answering `incompatible-dimensions`), never a flip of the
  shipped shortest default.

## Where it lives

- The single mismatch check: `broadcastLengthMismatch`, applied in
  `broadcastOverIndexedCollections`, in the `lazyBroadcastMap` funnel (both
  `collection-utils.ts`), and at the `BoxedFunction` broadcast steps, where a
  built-in operator uses `zipLengthMismatch`, the same check with a tuple as a
  participant.
  `strictLengths = true` is the default parameter; `PointList`
  (`library/collections.ts`) is the only opt-out.
- Compiled lowering: `_SYS.bcast` on the JavaScript target mirrors the
  interpreter per POSITION — an empty position answers the empty list and a
  mismatched one projects to NaN, neither poisoning a sibling. A call of a
  user function over a list argument maps the function with `_SYS.mapFn`,
  over the number of list levels that the static type of the argument
  gives. The fused emitter (`emitFusedBroadcast`, `base-compiler.ts`) folds
  a chain of heads into ONE call, so `Sin(N) + M` with `N = []` and
  `M = [1, 2]` reaches the helper as one length mismatch and answers NaN,
  where the interpreter answers the `incompatible-dimensions` error. The
  Python comprehension lowering answers the empty list for the same shapes.
- Compiled pairing site (2026-07-31): the JavaScript `PointList` zip lowering
  (`JAVASCRIPT_FUNCTIONS.PointList`, `javascript-target.ts`) emits
  shortest-zip via `Math.min` over the source lengths — the pairing-regime
  contract carried into compiled code. Design:
  `docs/COLLECTIONS-MODEL.md`.
- Pins: `compiled-elementwise-boolean.test.ts` ("the mismatch ruling reaches
  every broadcast path", including the `PointList` opt-out),
  `pointlist-compile-zip.test.ts` (compiled shortest-zip — the pairing
  contract in emitted JavaScript),
  `points-arithmetic.test.ts` (zip-to-shorter),
  `pointlist-lazy-broadcast.test.ts` (ragged lazy transpose),
  `multiply-mixed-collection-kinds.test.ts` (mixed-kind operands join the
  strict regime), `linear-algebra.test.ts` (rank-1 `Multiply` mismatch
  errors), `elementwise-which.test.ts` (selection joins the strict regime),
  `empty-broadcast.test.ts` (the lone-empty operand answers `[]` on the
  interpreter and on the compiled JavaScript lane, and the empty-beside-
  non-empty mismatch).
- Selection (2026-11-02, replaces the entries of 2026-07-27 and
  2026-10-22): `If` and `Which` select element-wise only when the static
  type of a condition is a flat list of booleans; `If(c, e1, e2)` is
  `Which(c, e1, True, e2)`.
  - The condition is a boolean or a flat list of booleans. Accepted:
    `list<boolean>`, `list<boolean^3>`, `indexed_collection<boolean>`
    (`P.x > 1` over a list of points that a host types as an indexed
    collection). A static error (`incompatible-type`): a nested list
    (`If([[True], [False, True]], 7, 0)`), `M < 3` over a matrix `M`, a
    `matrix<boolean>`, a list with a `Missing` cell (`[True, Missing]`),
    a collection with no order (`collection<boolean>`, `set<boolean>`), and
    a collection whose cells are not known to be booleans (`list`,
    `list<any>`, `indexed_collection<any>`). A type that does not settle
    the number of dimensions but admits a flat list is not refused:
    `tensor<boolean>` (`x < L` with `x` declared
    `broadcastable<number | tuple>`), `list<boolean | list<any>>`
    (`L < f(u)` with `f` of result type `unknown`), `boolean | list<boolean>`.
    When the value of such a condition is a nested list, the evaluation gives
    the same `incompatible-type` error, and compiled code gives `NaN`.
  - Every arm is a scalar or a flat list of the condition's length. Only
    numbers and points need one element kind: the arms are all numbers
    (`If(L < 3, L, 0)`) or all points (`If(L < 3, (1, 2))`). A static
    error: an arm whose elements are lists
    (`If([True, False, True], [[1], [2], [3]], 0)`), a string or a list of
    strings (a string has no value for a position that is not selected), a
    set, a number arm beside a point arm (`If(L > 0, (1, 2), 0)`), and a list
    arm of another length (`If([True, False], [1, 2, 3], 0)` is
    `incompatible-dimensions`, `2 vs 3`, as `[1, 2] + [1, 2, 3]` is). An
    arm whose static type does not settle this is checked on its value when
    the selection is evaluated. The result type is `list<T>` from the static
    types of the arms.
  - A relation (a boolean arm) and a statement (an `Assign`, a definition,
    a drawing head) are accepted under a list condition, as before:
    `1 > 0 \text{ where } (x+2)^2 + y^2 \le (0..0.2..1.6)^2` is
    `If(… ≤ Range(0, 1.6, 0.2)^2, 0 < 1)`, a region of a plot. A position of
    a boolean arm that is not selected is `False`: the region is not drawn
    there (`If([True, False], 1 > 0)` is `[True, False]`; user decision of
    2026-11-02, two-valued comparisons; before, it was `Missing`). An arm of
    another kind that is not a string is accepted too, as a scalar arm or as
    a list arm: a colour, a symbol, a tuple that is not a point, or a list of
    these. A position of a colour arm that is not selected is
    `Rgb(NaN, NaN, NaN)`: a plotter reads a colour with a channel that is not
    finite as "no colour here", and Tycho drops the whole colour list for a
    `Missing`, `NaN` or `False` cell (Tycho item 189, the 30×30 colour grid
    `Which(Sqrt(X^2 + Y^2) <= 1, Hsv(0, 0, v), True, Hsv(0, 0, 0.8))` over
    lists `X` and `Y`; user decision of 2026-11-02; before, the cell was
    `Missing`). A position of an arm of another kind that is not selected
    is `Missing`. A boolean or a colour position is the same on the
    `javascript` target (`false`, a colour with `NaN` channels).
  - A position that is not selected is `NaN` for a number cell and a point
    whose coordinates are `NaN` for a point cell:
    `If([True, False, False], (1, 2))` is `[(1, 2), (NaN, NaN), (NaN, NaN)]`,
    and `If([1, 5] < 3, 7)` is `[7, NaN]`. A number cell or a point cell
    is never `undefined` or `Missing`, and no such cell needs `IsMissing` or
    `Coalesce` to be read; an
    operator that maps over the list reads the `NaN` point as a point
    (`Sin(If([1, 2] > 1, [(1, 2), (3, 4)]))` is
    `[(NaN, NaN), (sin(3), sin(4))]`). This reverses the decision of
    2026-10-18 that a point or a string cell with no match is absent
    (`Missing`, `undefined` in compiled JavaScript) and is read by
    `IsMissing` or `Coalesce`. The compiled JavaScript gives `[NaN, NaN]`
    for such a point (`nanPointLiteral()` in
    `compilation/compile-absence.ts`). A cell read from a held restriction
    whose condition is not decided is itself a restriction
    (`If([0 < t], [(1, 2)])` read at position 1 is `If(0 < t, (1, 2))`).
    When this cell is evaluated alone after the condition becomes false, it
    is the `NaN` point, as the whole restriction gives at that position: a
    false restriction of a point by a scalar condition is the `NaN` point
    (user decision of 2026-11-03; before, it was `Missing`). A colour cell
    gives the same value as the whole restriction too: the cell read from a
    held restriction carries the no-colour value as an else branch
    (`If([C, True], [Rgb(1, 0, 0), Rgb(0, 1, 0)])` read at position 1 is
    `If(C, Rgb(1, 0, 0), Rgb(NaN, NaN, NaN))`), so it gives
    `Rgb(NaN, NaN, NaN)` when `C` becomes false, as the whole restriction
    does. A relation cell does not have it either: the cell
    `If(c, x > 0)` with `c` false is `False`, as the whole restriction
    gives.
  - A scalar condition selects an arm whole, also when the arm is a list:
    `If(t > 0, [1, 2, 3])` at `t = -1` is `Missing`, the absent value of
    the whole list. When the arm is one point, the value is the `NaN`
    point: `If(t > 0, (1, 2))` at `t = -1` is `(NaN, NaN)`, and
    `[(1, 2), (3, 4)]\{t>0\}` stays `Missing` (its arm is a list). Every reader keeps this: an operator that maps over its
    operands lifts the condition outward (`Sin(If(c, L))` is
    `If(c, Sin(L))`, `liftWholeRestrictions()` in
    `boxed-expression/boxed-function.ts`), so `\sin([1,2,3]\{0<t\})`,
    `2[1,2,3]\{0<t\}` and `[1,2,3]\{0<t\}+1` are `Missing` at
    `t = -1`. Before, such an operator mapped over the restricted cells and
    gave `[NaN, NaN, NaN]`. When the condition is false, the other operands
    of the operator are not evaluated: `[1,2,3]\{t>0\} + [1,2,3,4]` at
    `t = -1` is `Missing`, not `incompatible-dimensions`. The conditions of
    all the restrictions of one call are evaluated, each once, before any of
    them is read: a condition with an effect (a random draw) runs also when
    an earlier condition of the same call is false. A restriction whose
    condition is not decided keeps its held form,
    `If(0 < t, [sin(1), sin(2), sin(3)])`, which still presents as a
    collection (Tycho item 66). The condition is lifted only when its static
    type is a subtype of `boolean`: a condition typed `unknown` or
    `boolean | list<boolean>` can be a mask at run time. A user function
    whose body can receive `Missing` (an unannotated parameter, a parameter
    whose type admits `missing`, a parameter with a default, a declared
    function whose absence behavior is not `propagate`) is not lifted over:
    the condition is evaluated once, and the function receives the list when
    it is `True`, `Missing` when it is `False`, and the restriction over the
    evaluated condition when it is not decided. With
    `f(xs) = Coalesce(xs, [0])`, `f(If(0 < t, [1, 2]))` is `[0]` at
    `t = -1`. Limit: an undecided restriction under two operators that map
    over their operands, `Sin(Cos(If(c, L)))`, is held as the list of its
    restricted cells, not as `If(c, Sin(Cos(L)))`; when this held value is
    evaluated again after `c` becomes `False`, it is `[NaN, NaN, NaN]`, not
    `Missing`.
  - The no-match value of a scalar `Which` is unchanged: `Missing`.
  - Tests: `elementwise-which.test.ts` ("the selection rule of 2026-11-02:
    what is a static error"), `when-list-condition.test.ts`,
    `compile-when-nested-mask.test.ts`,
    `tycho-item-335-when-indexed-collection-type.test.ts`.
- Restriction and single-branch `If` (2026-11-02): the parser reads a
  restriction `e\{c\}` as `If(c, e)`, not `When(e, c)`, and the restriction
  covers the whole of the smallest group that holds it: `y=x\{c\}` is
  `If(c, Equal(y, x))`, `2x\{c\}` is `If(c, 2x)`, `(a\{c\}, b)` is
  `Tuple(If(c, a), b)`, and stacked restrictions merge,
  `a\{c_1\}\{c_2\}` is `If(And(c_1, c_2), a)`. A `where` condition gives
  the same `If`: `(\cos t, \sin t) \text{ where } 0\le t\le\pi` is
  `If(0\le t\le\pi, Tuple(…))`. A single-branch `If(c, e)` with a scalar
  condition that is `False` gives the absent value of the domain of `e`, as
  `When` does: `NaN` for a number, `Missing` otherwise. Its type is the
  type of `e`, with no `nan` or `missing` arm (`integer` for `If(c, 1)`):
  the absent value is implicit in every type. With a list condition, `If(c, e)` selects
  element-wise as in the selection entry above, and a scalar condition
  selects `e` whole, also when `e` is a list. `When` is removed (item 3.2 of
  `docs/plans/2026-11-02-compiler-contraction-plan.md`). Rule: `docs/plans/2026-11-02-restriction-binding.md`
  and `docs/plans/2026-11-02-where-binding.md`. Tests:
  `latex-syntax/restriction-where-binding.test.ts`.

## Audit record (2026-07-27)

Empirical probe of every operator that can see ≥2 collection operands
(mismatched `[1,2,3]` vs `[10,20]`, plus the edge rules), on the box route.

**Conformant — strict regime errors:** `Add`, `Subtract`, `Multiply`
(mixed-kind), `Divide`, `Power`, `Root`, `Mod`, `Log(base)`, `ElementMax`,
`ElementMin`, `Clamp`, all four orderings, `And`/`Or`/`Xor`/`Nand`/`Nor`/
`Implies`/`Equivalent`, measurement lists (`[1,2,3] m + [1,2] m`), and a
scalar-parameter function literal applied to mismatched collections (incl.
an infinite operand). Edge rules all hold: scalar lift, empty vs non-empty
mismatch, lone-empty → `Nothing` (the empty LIST since the 2026-09-21
ruling), unknown-length skipped.

**Conformant — pairing regime shortest:** `Zip`, variadic `Map`, `PointList`.

**Fixed by this audit:** the `addN`/`mulN` value paths routed a provably
INFINITE operand (`Cycle`, `Range(1,∞)` — `count` is `Infinity`, a KNOWN
length) to the lazy `Map` via `isUnknownLengthBroadcast` with no mismatch
check, so `Add([1,2,3], Range(1,∞))` answered `[2,4,6]` while `Less` on the
same operands errored. The check now lives in the `lazyBroadcastMap` funnel
(strict by default, pairing opt-out threaded through).

**Out of scope, verified no silent loss:** `Quotient` and `Atan2` do not
broadcast at all (inert even at matched lengths — a coverage gap, not a
truncation; adding `broadcastable` signatures would be a separate feature).
`GCD`/`LCM`/`Max`/`Min` are flatten-REDUCERS over their collection arguments
(`GCD([4,6],[8,10])` = 2), not element-wise maps — ragged input is
well-defined. `Equal`/`NotEqual` on two collections is whole-collection
equality (mismatched lengths → definitively `False`/`True`). `Dot`/`Cross`
error on dimension grounds of their own.

**Known residues (tracked in ROADMAP):** a late-resolving mismatch inside
the lazy variadic `Map` can still truncate. A non-indexed collection operand
(`Add(L, Naturals)`) is lifted like a scalar, producing inert `Naturals + 1`
cells — arguably deserving its own ruling. (`Covariance`/`Correlation`
originally answered `unexpected-argument` on a length mismatch; harmonized to
`incompatible-dimensions` same day. `Multiply` of two mismatched `List`
literals — and the unit-carrying variant `[1,2,3] · ([1,2]·Meter)` — stayed
inert-symbolic until 2026-07-27; the rank-1 fold in `mulTensors` now routes
through `broadcastLengthMismatch` and errors like `Add`. The rank-2
matrix-product mismatch is the `incompatible-dimensions` error of
`MatrixMultiply` since 2026-10-22: dimension compatibility there is
`MatrixMultiply`'s question, not a broadcast length.)

## `Multiply` of matrices (decision 2026-10-22)

`Multiply` of two matrices is the matrix product (as `MatrixMultiply`),
however the factors are written: literals, symbols that hold matrices, or
computed factors. A vector or a plain list times a vector or a plain list is
the product of each entry. A number times a matrix scales each entry.
`HadamardProduct` is the product of each entry of two matrices.
Compiled code follows the same rule where the type of the factors states
that they are matrices; the interval-js target refuses a product of lists
that may be matrices at run time (the code throws, and the runner answers
`entire`, "cannot bound this") instead of answering `empty`, "no value".

Two behaviors that differ on purpose, and that a reader may not expect:

- `Divide(p, q)` of two matrices stays the quotient of each entry, while
  `p·q^-1` is the matrix product with the inverse of `q`.
- `Exp` of a matrix, and a power of a matrix with an exponent that is not an
  integer, apply to each entry: `Exp([[0, 1], [1, 0]])` is `[[1, e], [e, 1]]`,
  not the matrix exponential, and `[[4, 9], [16, 25]]^{1/2}` is `[[2, 3], [4,
  5]]`. An integer power is the matrix power. Because `Multiply` of two
  matrices is the matrix product but these functions apply to each entry, a
  rewrite rule that combines powers of the same base (`e^a·e^b = e^{a+b}`,
  `x^{1/2}·x^{1/2} = x`) is wrong when the factors are matrices.
- The order of the factors of a product is fixed when the product is boxed.
  Factors whose types are known to be matrices (or may be: `tensor<number>`,
  `any`, `broadcastable<number>`) keep the written order. Factors that are
  still `unknown` at that time are sorted like numbers, because the product
  of numbers commutes. If matrices are assigned to those symbols later, the
  sorted order is not recovered: `q·p` boxed while `p` and `q` are `unknown`
  is `p·q`. Declare the type (`ce.declare('p', 'matrix<number>')`) before
  boxing the product.
