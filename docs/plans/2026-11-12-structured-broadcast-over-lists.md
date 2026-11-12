# Structured route: element-wise broadcast over lists and element-wise selection

**Status: DRAFT, not approved.** Each choice takes the recommended option;
section 8 lists the alternatives and the decisions that are the user's.

Scope: the `numeric-kernel` profile of the JavaScript target
(`javascript-fragment-target.ts`, `javascript-structured-lower.ts`). A scalar
head, a scalar function or a user function applied to a list operand; a
`Sum` or `Product` whose body is a list; an `If` or `Which` whose condition
is a list. Second part: the binding refusal `unsupported binding <name>`.

**Measure.** Main tree at `a17a2632cc7df307eebd7c5fcba5e747940506b8`, no
source file changed during the runs. A Jest setup file
(`<scratchpad>/design-broadcast/log-setup.ts`, after the census logger)
wraps `compile()` of `compilation/compile-expression`; for each JavaScript
compilation that the existing compiler compiles, it compiles again with
`profile: 'numeric-kernel', fallback: false`, and logs a decline whose
message is one of the broadcast messages, names a list operand, or is
`unsupported binding`. For each logged program it records every
element-wise site (head, operand types, a length key per list operand), and
the next decline after each outermost site is replaced by a fresh name
declared with the type of the site. Files: the 184 test files whose
programs had these messages in the census of
`docs/plans/2026-11-11-js-profile-decline-census.md`, plus the test files
changed since its commit; 219 files, three runs of 72 (`-w 4`, under
`timeout -k 30 900`). `compile-call-broadcast-result-operand.test.ts` did
not finish in 4 minutes and was stopped (the census reports that it runs out
of memory under a logger): only its first records are in. The scratchpad is
removed when the machine restarts. Counts are **unique programs** (file, test, program,
options, message). They are not the shadow counts of the plan (the full
suite at `edf0c42631a479230ffbb04bcd33d745725ceeed`, every compilation): 637
programs here for the broadcast messages, 509 for `unsupported binding`.
Probes of the existing emitter run with `cse: false, constantFold: false`
(`design-broadcast/forms*.ts`, `doubles.ts`, logs beside them). Test
programs are `crafted` or `plausible` witnesses; a file named after a Tycho
item or row, and `compile-e2e`, counts as real use.

## 1. The existing emitter, the interpreter and the witnesses

### 1.1 Forms

| Form | Existing code | Unequal lengths | Empty list | Interpreter |
| --- | --- | --- | --- | --- |
| Scalar head over a list and scalars (`compile-broadcast.ts`, `tryCompileBroadcast()`) | `L^2`: `_SYS.bcast((_tv1, _tv2) => _SYS.pow(_tv1, _tv2), L, 2)`; `sin(L)`: `_SYS.bcast((_tv1) => Math.sin(_tv1), L)`; nested heads in one closure: `sqrt(L + 1)`: `_SYS.bcast((_tv2, _tv3) => { const _tv1 = (_tv2 + _tv3); return Math.sqrt(_tv1); }, L, 1)` | `L^M`, `Hypot(L, M)`, `L + M`: `NaN` (`bcastWith()`, `javascript-runtime.ts`: no truncation) | `[]` | the list; `incompatible-dimensions` for unequal lengths |
| A list whose type states its width | `V^2 + W` (`vector<3>`): `[(_SYS.pow(V[0], 2) + W[0]), …]` (unrolled) | `[2, 5, NaN]` for a 2-element `V` (a value outside its type) | n/a | the list |
| Comparison | `L < 0`: `_SYS.bcast((_tv1, _tv2) => ((_tv1) < (_tv2)), L, 0)`; chain `L < 1 < 2`: one closure `((_tv1 < _tv2) && (_tv2 < _tv3))`; `And`, `Not`: nested `_SYS.bcast` | `NaN` | `[]` | a list of booleans |
| `Equal` | `L = 1`: `_SYS.eq((L), (1))` (`eqTensor()`: `x === scalar` per element); `L = M`: the same call, one boolean (equal lengths and every pair equal) | `L = M`: `false` | `[] = []` is `true` | the same |
| `Max`, `Min` with a list and other operands | `Max(L, 2)`: `((_p0, _p1) => { let _a = -Infinity; for (const _x of _p0) { _a = Math.max(_a, _x); } _a = Math.max(_a, _p1); return _a; })(L, 2)`: a fold over every element and operand, not a broadcast | n/a | `Max([], 2)` is `2`; `Max([], [])` is `NaN` | the same |
| User function, scalar parameter (`compile-user-calls.ts`; `mapFn()`, `javascript-runtime.ts`) | `f(L)`: `_SYS.mapFn(_fn_f, [1], L)`; `f(A)` of a `list<list<real>>`: `[2]`; `g(L, x)`: `[1, 0]`; `g(L, M)`: zipped, `[1, 1]` | `NaN` | `[]` | the same; mapped at the leaves of a nested list (`docs/BROADCAST-MODEL.md`) |
| `Sum`/`Product` with a list body (`javascript-target.ts`, the indexed loop) | `Sum(L·i, i, 1, n)`: `let _tv3 = null; … const _tv5 = _SYS.bcast((_tv1, _tv2) => (_tv1 * _tv2), L, i); _tv3 = _tv3 === null ? (Array.isArray(_tv5) ? _tv5.slice() : _tv5) : _SYS.bcast((_a, _b) => _a + _b, _tv3, _tv5); if (_tv3 !== _tv3) return NaN; … return _tv3 === null ? 0 : _tv3;` | `NaN` | an empty range gives the number `0` (`1` for `Product`); `[0, 0, 0]` when the body is `vector<3>` | the same: `0` for an empty range of `L·i`, `[0, 0, 0]` for `V·i` |
| `If`/`Which` with a list condition (`compileJSSelection()`, `javascript-target.ts`; `selectWith()`, `javascript-runtime.ts`) | `If(L > 0, L, 0)`: `_SYS.select(() => (_SYS.bcast(… , 0, L)), () => (L), () => (true), () => (0))` | `NaN`, except a condition that is itself the `NaN` of a mismatch (below) | `[]` | the list; `NaN` where no clause holds |
| Restriction `If(c, v)` | `_SYS.restrict(_SYS.bcast(…), x, false, NaN)` | a list `v` is cut to the shorter (`[10, NaN]` for 3 and 2 elements) | `[]` | the same |

A **defect of the existing compiler** (not filed by this note; the brief
allows one file): `If(L > M, L, M)` with `L = [1, 4, 9]`, `M = [1, 2]` gives
`[1, 2]`, and with `L = []`, `M = [1]` gives `[1]`; the interpreter gives
`incompatible-dimensions`. The condition is the `NaN` of the mismatch, which
`selectWith()` reads as an absent condition, so the `True` clause selects
`M` whole. Witness `plausible`.

### 1.2 Evaluation order and count

Each operand of `_SYS.bcast` or `_SYS.mapFn` is a JavaScript argument:
evaluated once, in order, before the first element. `L + Random()` and
`L < Random()` draw once (`_SYS.drawNextRandomNumber()` is an argument), as
the interpreter does (`docs/BROADCAST-MODEL.md`, "A broadcast operand is
evaluated ONCE"). A nested head is either fused into the closure or a
nested `_SYS.bcast` that is evaluated as an argument: in both, the inner
list is complete before a later operand. `mapFn` calls the function once
per element, in index order. `selectWith()` evaluates the conditions in
clause order (all of them, unless one is the scalar `true`), then each arm
that some position selects, once and whole, in clause order; an arm that no
position selects is not evaluated. With `cse` on, the existing compiler
fuses a pure numeric selection into one loop with run-time guards
(`javascript-selection-fusion.ts`); the profile compares with `cse: false`.

### 1.3 The doubles of the closure

The closure is the scalar code of the head with each operand an element
parameter (`tryCompileBroadcast()`: the literal operands are arguments too).
Its doubles differ from the scalar code of the same head with a literal
operand (`doubles.ts`, 1,209 values each):

| Program | Closure | Scalar profile code | Values that differ |
| --- | --- | --- | --- |
| `Exp(L)` | `_SYS.pow(Math.E, e)` | `Math.exp(x)` | 554 |
| `L^3`, `L^-2` | `_SYS.pow(e, 3)` | `x*x*x`, `1 / x / x` | 106, 294 |
| `Root(L, 3)` | `_SYS.root(e, 3)` | `Math.cbrt(x)` | 470 |
| `Log(L, 2)` | `Math.log(e) / Math.log(2)` | `Math.log2(x)` | 267 |
| `L/3` | `0.3333333333333333 * e` | `x / 3` | 277 |
| `Arcsin(L)` (also `Arccos`, `Arcosh`, `Artanh`) | `Math.asin(e)`, `NaN` outside the domain | `_SYS.casin(…)`, complex | 909 |
| 35 other heads (`Sqrt`, `Sin`, `Abs`, `Floor`, `Round`, `Gamma`, `Hypot`, `L^2`, `L^10`, `2^L`, `Clamp`, `Less`, `Sin(π·L)` as `_SYS.sinpi`, …) | | | 0 |

`L^2` is `_SYS.pow(e, 2)` and the profile writes `x*x`: equal on every value
probed, but not by construction.

### 1.4 The witnesses

| Form (first refusal) | Programs | Lengths settled by the types | Real use | Admitted when the sites are stood in for |
| --- | --- | --- | --- | --- |
| A. Scalar head over lists (`sqrt(L)`, `L^2`, `L + sqrt(L)`) | 94 | 91 | 17 (`tycho-items-245-247` 7, `tycho-items-130-138` 4: `\|P\|` of points, `compile-e2e` 2) | 76 (16 stand-in artefacts) |
| A2. A comparison or connective over a list as the value (`L == 3`, `L < ~oo`) | 42 | 36 | 5 (`tycho-items-214-215` 3, `tycho-items-261-264` 2) | 42 |
| B. Arithmetic of lists not equal by construction (`L + M`, the stencil `A + 3A + RotateRight(B, 1) + …`) | 13 | 0 | 5 (`tycho-items-261-264` 4) | 13 |
| C. User function applied element-wise | 179 | 171 | 32 (`tycho-row-425` 30: `sum(g(x))`, `At(At(m(x), 1), 1)`) | 54 (64 with no site found, 58 artefacts) |
| D. `Sum`/`Product` with a list body | 96 | 34 | 0 | 74 |
| E. Element-wise selection | 122 | 91 | 7 (`tycho-items-261-264` 4, `tycho-item-335` 3) | 81 (41 artefacts) |
| E2. Selection on a condition `boolean \| list<boolean>` | 5 | (R4) | 1 | — |
| F. `Max`/`Min` of a list and other operands | 13 | 13 | 0 | 11 |
| G. `Equal`/`NotEqual` of two lists | 15 | all (one boolean) | 2 | 13 |
| H. Lists of tuples or of lists, matrix products | 39 | — | 7 | (the nested note) |
| I. `WithRandomSeed` of a list, `GCD`/`LCM` of a list | 19 | — | 0 | — |

C in detail: a flat list at a scalar parameter 112 (two list arguments of
unequal key 7), a `list<list<real>>` 28, a list of points 30. D in detail:
settled by a non-empty literal range 14, by a stated width 15 (also
`Sum(…, k, 1, 0)` of `vector<3>`, which is `[0, 0, 0]`); not settled 56 (an
input bound, unstated width: `Sum(L·i, i, 1, n)`); 11 in a helper body. E in
detail: list or scalar arms 68 settled (6 more on a `broadcastable` input), a tuple arm 33, a restriction with a
list value of another length 7 (`If([True, False, True], Range(1, m))`).
The "next" column stands in for every site at once, so it is an upper bound
for one slice and says nothing of a site the logger did not find.

## 2. The rule

All from the static types; nothing is tested at run time.

1. **A scalar head over lists** (each head the profile admits with real or
   integer operands, the comparisons and `And`, `Or`, `Not`) is admitted when
   at least one operand is a `list<real>`, `list<integer>` or (strict mode)
   `list<number>`, the other operands are reals or integers, and every two
   list operands have lengths equal by construction: one key of
   `lengthKey()` (`javascript-fragment-target.ts`: one name, list literals
   of one length, an element-wise result of such lists, a rotation), or
   engine types that state one width (`vector<3>`, `list<real^3>`). Lists of
   lists follow `nestedLengthKeys()` at every depth, as the committed
   element-wise arithmetic does. It lowers to the `build` of the committed
   `Add` of lists (`elementwise()`, `javascript-structured-lower.ts`): the
   operands once, in order, then one `build` from 1 to the length of the
   first list operand whose body reads each list at the index (`at`) and
   applies the head to the cells and the scalar values.
2. **The body of the element** is the scalar lowering of the head with every
   operand an opaque value: no literal form (`L^3` is `_SYS.pow(e, 3)`, `L/3`
   multiplies by `0.3333333333333333`, `Exp(L)` is `_SYS.pow(Math.E, e)`,
   `Log(L, 2)` divides two logarithms), as the closure of 1.3. One build per
   head; no fusion (section 4).
3. **A user function** with a scalar parameter (declared `real`, `integer`,
   `number`, or none) called with a list argument (no tuple) is a `build`
   over the list whose body calls the helper of the function once per
   element with the cell; a scalar argument passes whole; two list arguments
   need equal keys; a `list<list<real>>` argument is two nested builds (the
   rank of `mapFn`). The helper is the one the scalar call uses, so its
   doubles are those of `_fn_f`. A helper whose value is a list gives a list
   of lists (`m(x)` of `tycho-row-425`), whose rows the build owns.
4. **A fold whose body is a list** (`Sum`/`Product` with `Limits`) is
   admitted when the body's length key is the same at every index (it does
   not read the index in a length) and the range is not empty by
   construction: literal bounds `a ≤ b`, or a lower literal bound at or
   below the declared lower bound of the upper bound (`n: integer<1..>`);
   or the body's type states its width (then the empty range is the list of
   zeros or ones of that width). It lowers to a loop that carries a list:
   the first term copied (not `0 + t`: `-0` stays), each later term added
   (multiplied) by a `build`, in index order.
5. **`Max`, `Min` of several operands with a list**: a fold over each list
   in order and each scalar, from `-Infinity` (`+Infinity`), `NaN` when no
   element and no scalar was seen, as the existing closure writes it.
   **`Equal`/`NotEqual` of two lists**: one boolean, equal lengths and each
   pair `===`, also when the lengths can differ (no shape question).
6. **Element-wise selection**: section 5.

Declines, with the remedy and an example:

| Case | Example | Remedy |
| --- | --- | --- |
| Two lists of unequal keys | `L + M`, `Hypot(L, M)` with `L, M: list<real>` | declare one width: `L, M: list<real^3>` or `vector<3>` |
| A fold of a list body over a range that can be empty | `Sum(L·i, i, 1, n)`, `L: list<real>`, `n: integer` | declare `n: integer<1..>`, or `L: vector<3>`, or fold explicitly: `Map(i ↦ …)` and `Sum` of rows |
| A head whose cell is not real (`Arcsin`, `Arccos`, `Arcosh`, `Artanh` over a list; any head in the `complex` mode) | `Arcsin(L)` | `Map(t ↦ Arcsin(t), L)` with a real `t` when the host wants the real branch, or the interpreter |
| A tuple operand or argument | `\|P\|` with `P: list<tuple<real, real>>`, `f(P)` | the point forms of the collections note |
| A union or `broadcastable<T>` operand | `If(c, P)` with `c: boolean \| list<boolean>` | declare one shape, or one function per shape (R4) |

## 3. The representation

One new notion: **a list of booleans**. `ListType` already admits a
`boolean` element (`structured-ir.ts`), but `isElementType()`
(`structured-verify.ts`) and `representationOfKind()`
(`javascript-structured-policy.ts`) refuse it. The change adds `boolean` to
the element types of the verifier and an array of JavaScript booleans to
the policy, as the program spec (`docs/plans/2026-11-11-js-program-profile-spec.md`,
section 4) proposes. It serves the comparisons of rule 1 (`L < 0`), the
list literals of booleans used as conditions (`If([True, False], 1, 0)`, 22
of the E programs), `list<boolean>` inputs, and the A2 values. No zip-build
is new: the committed `build` reads several lists at one index. A fold that
carries a list is a `loop` with a carried list value. The verifier sees
`build` results of the types it checks now; the in-place analysis takes each
`build` result as unique (`structured-in-place.ts`, rule 1), so the list
carried by a fold of a list body can be updated in place by a later change;
a helper result is unique when its body yields one.

## 4. Count and order of evaluation

The operands of a head are evaluated once, in order, before its `build`; a
nested head is its own `build`, complete before the next operand, as a
nested `_SYS.bcast` is. A user function is called once per element, in
index order, after its arguments. So a draw or a call of the host in a
scalar operand happens once, at its place (`L + Random()` is admitted
today), and draws in a helper happen once per element in order (the route
admits drawing helpers: `docs/COMPILATION-MODEL.md`, "Random draws"):
equal. A throw inside a `build` (`_SYS.floorMod` beyond ±(2^53 − 1), a
throwing helper) stops at the same element as `_SYS.bcast`. Fusing several
heads into one `build` would move a later operand's draw before the inner
elements (`f(L) + Random()`, `f` drawing): not done; a measured optimization
can fuse pure heads later. **Aggregates**: a scalar `Sum` declines a term
that can throw because the existing loop stops at the first `NaN` term. A
list accumulator is never `NaN` when the lengths are equal by construction,
so the existing loop evaluates every term, and a list body that can throw
gives the same throw at the same term; the rule is not needed there
(section 8, choice 3). A body that draws runs every term in both (the
latched form of the loop, `javascript-target.ts`).

## 5. Element-wise selection

Admitted: `If(c, a, b)`, `If(c, a)` and `Which(c1, a1, …, [True, d])` where
every condition other than a final `True` is a list of booleans by its type,
every list participant (conditions and list arms) has a length equal by
construction to the first condition, each arm is a real or integer or a
list of them, and every arm is pure and cannot abort. It lowers to: the
conditions in clause order (each a `build` or a value), then the arms in
clause order, then one `build` over the length of the first condition whose
body is the scalar `if` chain on the cells (an arm read at the index or
taken whole); a position that no clause selects is `NaN`. The restriction
`If(c, v)` is the same with `NaN` for a false cell, `v` a scalar or a list
of equal key.

It differs from the scalar `If`, which evaluates only the taken branch: here
every arm is evaluated whole, where `selectWith()` evaluates an arm only
when a position selects it. The two agree only when an arm cannot draw,
call the host, or throw; otherwise the arm declines (`If(L > 0, Random(),
0)`, `If(L > 0, Mod(L, 3), 0)`). A condition may draw or throw: the
existing code evaluates every list condition too. A `Which` with a scalar
condition among list conditions declines (the existing code ends the walk
at a scalar `true` at run time). With equal keys the mismatch defect of 1.1
cannot occur.

## 6. What stays declined

| Rule | Example | Programs given up (this sample) |
| --- | --- | --- |
| Unequal keys of two lists, no stated width | `L + M`; the stencil of `tycho-items-261-264` | B 13; in A, A2, C, E about 25 more |
| Possibly empty range, unstated width | `Sum(L·i, i, 1, n)` | 56 |
| Tuple or point operand or arm | `\|P\|`, `If(0 < v, (1, 2))` | about 33 in E, 30 in C, 4 in A |
| Arm that draws, calls the host or can throw | `If(L > 0, Random(), 0)` | not counted (0 seen) |
| Union or `broadcastable` condition or operand | `If(c, P)`, `c: boolean \| list<boolean>` | E2 5 |
| Non-real cell, complex mode | `Arcsin(L)`, `sqrt(L)` with `mode: 'complex'` | a few; not separated |

## 7. Implementation order

Each slice: tests that compare the route with the existing compiler
(`cse: false, constantFold: false`) on equal-length lists, the empty list,
`-0`, `NaN`, and with the interpreter on ordinary values; the profile tests
(`compile-javascript-structured-*.test.ts`); the shadow measure; a run of
`scripts/js-profile-fuzz.ts` (20,000 programs or more). Estimates are
programs of this sample, a range from "settled and admitted when stood in
for" to "settled".

1. **Scalar heads over lists** (rule 1, 2), lists of lists by
   `nestedLengthKeys()`. Tests: every head of 1.3 with doubles equal to the
   closure; two lists of one name, of `vector<3>`, a declined `L + M`.
   Estimate 73 to 91 (A). Fuzz: scalar heads with a list operand (`I`, `LN`,
   `VN`, list literals, a comprehension) and scalars, and pairs of lists of
   one key.
2. **Lists of booleans; comparisons and connectives as values; element-wise
   selection** (sections 3 and 5). Tests: literal boolean conditions,
   `Which` with and without `True`, a list arm, a restriction, a declined
   drawing arm, the mismatch case declined. Estimate 36 to 42 (A2) and 45 to
   68 (E). Fuzz: `If`/`Which` whose condition compares a list, arms scalar
   and of one key.
3. **User functions element-wise** (rule 3), then rank 2. Tests: declared
   and undeclared parameters, `g(L, x)`, `g(L, L)`, a drawing helper (draws
   in order), a helper with a list value. Estimate 48 to 112, plus up to 28
   at rank 2. Fuzz: the helpers of `HELPERS` called with list arguments.
4. **Folds of a list body** (rule 4). Tests: literal ranges, `vector<3>`
   bodies over an empty range, `n: integer<1..>`, `-0` in the first term,
   draws in the body. Estimate 22 to 34. Fuzz: `Sum`/`Product` of list
   bodies over literal ranges.
5. **`Max`/`Min` of several operands, `Equal`/`NotEqual` of two lists**
   (rule 5). Estimate 19 to 28.

Total for the sample: about 250 to 400 of the 637 programs (an estimate).

## 8. Open choices and decisions

1. **Lists of unstated, unequal keys.** Recommended: decline, remedy a
   stated width. Alternative: a length test before the `build` that throws;
   the caveats allow a throw where the interpreter gives
   `incompatible-dimensions`, but the existing compiler gives `NaN`, so the
   rule "doubles equal those of the existing compiler" breaks: **a decision
   of the user** (it would admit B and about 25 more, among them the Tycho
   stencil).
   Taken: decline, by the user's ruling of 2026-11-11 (when a more precise
   declared type resolves a case, the declaration is the answer); the
   remedy, a stated width, is documented with an example.
2. **A list of booleans in the numeric kernel** (section 3). Recommended:
   add it now. Alternative: fuse comparisons into the selection `build` and
   keep booleans out; then literal and input boolean lists and A2 still
   decline.
3. **A list body that can throw.** Recommended: admit (section 4).
   Alternative: keep the scalar rule and decline.
4. **Fusion of heads into one `build`.** Recommended: not now (section 4).
5. **Selection arms.** Recommended: evaluate every arm, decline an impure
   arm. Alternative: evaluate an arm only when a cell selects it (a mask
   pass first, as `selectWith()`), which admits impure arms at the cost of a
   second pass.
6. **The `Arcsin` family over a list.** Recommended: decline. Alternative:
   the real function per element, as the closure writes it in the strict
   mode.

A public contract changes only with choice 1 (what a mismatch gives) and
with the guide text that names the remedies (`docs/COMPILATION-MODEL.md`
and the profile's table).

## 9. Second part: `unsupported binding <name>`

509 programs. The binding is a captured value the profile cannot record, or
an input of a type it does not admit (`javascript-fragment-target.ts`,
around the two `unsupported binding` throws).

| Class | Programs | Real | Examples | Existing code | Profile |
| --- | --- | --- | --- | --- | --- |
| Union of a number and a list, at an input | 69 | 13 | `u + 1`, `u: list<real> \| real`; `2v`, `v: integer \| vector<integer^2>` (`tycho-item-249`) | `(Array.isArray(_.u) ? _SYS.bcast(…) : _.u + 1)` | numeric kernel: one dispatch at the binding (R4) |
| String or character | 72 | 7 | `If(s == "a", 1, 2)`; `!(s == "a")` | `_SYS.eqt(_.s, "a")` | `program` |
| `Missing` as a value | 57 | 0 | `If(Missing < t && t < -1, 1, 2)`; `First([3, Missing]) < t` | `undefined < _.t` | `program` (absence) |
| `broadcastable<T>` input | 49 | 2 | `p^2`, `g(b)` | `_SYS.bcast(_fn_g, _.b)`, `_SYS.matrixPowerShape(…)` | declined in both; remedy: declare the shape |
| A symbolic value of the inputs, also a list (`2Range(0, 100)`) | 64 | 2 | `2·lv` with `lv := x + 1`; `a + x` with `a := 2 + tick()` | `const _val_lv = _.x + 1;` per call, then `2 * _val_lv` | numeric kernel: lower the value once at entry, as a block local |
| A function used as a value | 33 | 0 | `f` (`(x) ↦ x^2`); `Add` as a value | `_fn_f`; `(a, b) => a + b` | `program` |
| Tuple or point with non-real elements | 33 | 0 | `Third(p)`, `p: tuple<unknown, number>`; `T: tuple<number, any>` | `_SYS.atWithValueMarker(_.p, 3, true)` | `program` |
| Captured list of lists | 27 | 0 | `Map(h, rows)` with `rows := [[1, 2], [3, 4]]` | `(_val_rows).map(…)` | numeric kernel (a constant of rows) |
| Bare list or collection input | 26 | 1 | `p^0.5`, `p: list`; `Reduce(p, step, s)` | `_SYS.bcast(…, _.p, 0.5)` | declined; remedy `list<real>` |
| List of non-numbers (tuples, strings) | 26 | 0 | `At(P, k)` with captured points; `list<string>` | `_SYS.atPoint(_val_P, _.k, 3)` | `program` (lists of tuples: collections note) |
| Value kind or nominal type | 27 | 1 | `f2(r)`, `r: Row`; `gf8` | `_fn_f2_tuple_real__real_(_.r)` | `program` |
| Captured number of another type (complex) | 9 | 0 | `x^2 + zf1^2` with `zf1 := 5`, typed `complex` | `25` inlined | numeric kernel (`complex` constants) |
| Other (an input `real` that the profile still refuses 7, lists with complex or non-finite elements 3, `dictionary<integer>` 2, small unions with strings 3, `expression` 1, `number \| tuple` 1) | 17 | 1 | `3(x + 1)`; `d` | `3 * (_.x + 1)` | case by case |

Numeric kernel, to admit: unions at an input (69), symbolic values (64),
captured lists of lists (27), complex constants (9): 169. `program`:
strings, `Missing`, function values, tuples of non-reals, lists of
non-numbers, value kinds, records: 250. Stay declined with a
declaration as the remedy: `broadcastable` and bare collection inputs, 75.

## Not determined

- The 64 C programs in which the logger found no site (a function bound by
  value or local), so no next refusal; the 58 and 41 stand-in artefacts (a
  fresh name read as a capture).
- Whether `L^2` as `_SYS.pow(e, 2)` and `x*x` are equal for every double
  (equal on the values probed).
- The share of the shadow counts (full suite) that each slice admits; this
  sample is 219 files.
- `NotEqual` of a list and a scalar was not probed element by element.
