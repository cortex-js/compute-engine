# Structured route: general collections and function values

**Status: design, not approved.** It extends step 6 of the
[JavaScript compiler plan](2026-11-09-js-compiler-status-and-plan.md)
(lists of numbers, [loops and lists](2026-11-10-structured-ir-loops-and-lists.md))
toward the retirement of the existing JavaScript emitter. Measured on the
main tree at `6ebc2b1574cd75487533e999288fe7339ea71228`, which also held
other sessions' uncommitted changes to the structured route; the probes are
scratch files of the session that wrote this note, not in the repository.

The contract does not change: for each admitted program the value equals the
interpreter's within the caveats, and the doubles and the shape equal those
of the existing compiler with `cse: false, constantFold: false`; anything
else declines. Shapes are settled from static types and literal structure
(`docs/COMPILATION-MODEL.md`, R1 to R6).

## 1. The witnesses

**Tests.** A Jest setup file wrapped `compile()` of `compile-expression.ts`
(`jest.mock`): after each JavaScript compilation that the existing compiler
compiled, it compiled the expression again with the profile and logged each
decline with its options and symbol types. 200 of the 831 test files that
mention `compile`, chosen by the collection heads they name (two runs of
100, `-w 4`; all passed but the test that the default route never calls the
profile): 8,352 compilations, 1,357 admitted, 6,995 declined, **4,603
distinct declined programs**, of which 2,944 need a collection feature and
**1,783 need nothing else** (no string, colour, `Random`, `vars`, `unknown`
type, union of shapes or other known refusal). Counts: all distinct with the
need / collection-only.

| Need | Count | Example |
| --- | --- | --- |
| list literal | 1,027 / 648 | `[1, 2] / 0`, `f([x, 1])` |
| tuple (literal, input, parameter, result) | 506 / 284 | `(1, 1) + (2, 3)`, `P · 2` |
| `Map`, `Filter`, `Apply`, `Scan`, `Count` with a function | 470 / 284 | `Count(Filter(Range(1, n), k ↦ k mod 3 = 0))` |
| slices and joins (`Take`, `Drop`, `Rest`, `Reverse`, `Join`, `RotateLeft`, …) | 380 / 223 | `Reverse(If(c > 0, [3, 1, 2]))` |
| element type `number` (`list<number>`, `tuple<number, …>`) | 355 / 219 | `E + 1` |
| nested lists, `matrix`, `tensor` with dimensions | 345 / 246 | `A^2`, `At(R, 1, 2)` |
| linear algebra (`Norm`, `Dot`, `Determinant`, `Trace`, `Inverse`, `MatrixPower`) | 330 / 303 | `‖[+∞, NaN]‖`, `Determinant(M) + 1` |
| folds (`Sum(L)`, `Product(L)`, `Max(L)`, `Reduce(L, Add)`) | 302 / 215 | `Sum(L)` |
| a list of tuples | 222 / 118 | `Distance([(0,0), (3,4)], (1, 2))` |
| points (`PointList`, `PointX`, `Distance`) | 204 / 158 | `PointList(A, B)` |
| a captured list (a symbol whose value is a list) | 187 / 124 | `Last(d)` |
| `list<complex>` | 158 / 88 | `Determinant(W)` |
| a helper whose result is a tuple or a list of tuples | 120 / 94 | `pt(x)` |

Function operands of the higher-order heads: a lambda literal 381 (`Map`
120, `Apply` 87, `Filter` 81, `Reduce` 64, `Count` 16, `Scan` 13), a user
function 152, a library operator 145 (`Map(Sin, L)` 65, `Reduce` by an
operator 69, `Scan` 14), a `Composition` 10, a function given at run time 8.

**"unsupported binding <name>"** (208 distinct): the name is declared
`number` 118, holds a list or a tuple (a capture) 36, is a string 29, a
union of a list and a scalar 20, a tuple 17, `broadcastable<…>` 16, a
function value 5, `missing` 5, bare `list`/`collection`/`unknown` 14.

**Corpus.** The 15 prelude functions that still decline, compiled again
(`executeEpsil()` on Tycho's showcase preludes, read only):

| Function | First refusal now | Needs |
| --- | --- | --- |
| `legal`, `stones` | a comprehension with a guard | a guarded comprehension (`append`, slice 1) |
| `score` | the call of `stones` | `stones` |
| `life` | `RotateLeft` | rotation (slice 5) and the sum of 8 lists of one length (slice 1) |
| `tangent`, `admitted` | `At` of a parameter that the profile types `real` | tuples; the parameters have inferred types only (`tuple<number, …>`), so Tycho must declare them |
| `generations` | a parameter `list<tuple<number, number, number, integer>>` | lists of tuples, `Count` with a lambda, `Take`, `Drop`, a join, a loop over a list |
| `csqrt`, `fourth`, `seen`, `fill` | tuples; `unknown` and `collection<any>` parameter types; recursion (`fill`) | R1 and R3 declines unless Tycho declares the types; `fill` is the `program` profile |
| `step` | a loop over `ParallelDomain` | `AddTo` on a list element, tuple assignment, a parallel loop |
| `play` | `If` condition not typed `boolean` | not a collection item; the existing compiler throws on it too |
| `c`, `shade` | `Block` in a branch; `Rgb` | colours, a later note |

So this note has 7 corpus witnesses (`legal`, `stones`, `score`, `life`,
`tangent`, `admitted`, `generations`), 2 of them (`tangent`, `admitted`)
only after a declaration in Tycho.

## 2. The type model

**Value types of the core** (target-neutral):

- the scalars `real`, `integer`, `boolean`, `complex`;
- `list<T>` for any value type `T`, no length in the type; a `matrix` or a
  `tensor` with dimensions is a nested list of that depth;
- `tuple<T1, …, Tn>`: a fixed length and a scalar type per position. A point
  is a tuple.
- `number` is `real` in `strict` and `complex` in `complex`, also as an
  element: the documented caveat "In `strict`, a value of type `number` must
  be real" (`docs/COMPILATION-MODEL.md`), which the existing compiler follows
  (`_SYS.atNumeric(_.LN, 1, "number") + 1`).
- **No function type.**

Types become interned objects (`{kind: 'list', element}`) in place of the
strings `list<${ScalarKind}>` of `structured-ir.ts`.

**Operations**, each `pure` when its regions are; a list is a value, and the
update in place stays an emitter decision on use counts.

| Operation | Operands → result | Existing code it must equal (probe, `cse`/`constantFold` off) |
| --- | --- | --- |
| `list` | n values of `T` → `list<T>`; n = 0 allowed | `[_.x, _.y, 1]` |
| `tuple` | values of `T1…Tn` → `tuple<T1…Tn>` | `[_.x, _.y]` |
| `get` | tuple, literal position k in 1..n → `Tk` | `_.P[0]` (`P · 2` is `[(2 * _.P[0]), (2 * _.P[1])]`) |
| `at` (extended) | `list<T>` or a tuple of one element type, integer → `T` or the absent value of `T` | `_SYS.atNumeric(_.L, k, "real")`; `_SYS.atPoint(_.LP, 1, 2)`; `_SYS.at(_.LL, 1)` with `NaN` read as `undefined`; `_SYS.at(_.P, k)` |
| `length` (extended) | list → integer; a tuple has a literal length | `(_.LL).length` |
| `build` (extended) | as now, any element type | `result.push(...)` in a `for` loop |
| `append` | `list<T>`, `T` → `list<T>`, in place when consumable | `result.push(k)` of the guarded comprehension `stones` |
| `replace-at` (extended) | any element type | `_SYS.replaceAt(_.L, 1, _.x)` |
| `collection` | a named function of collections (below) | a runtime helper |

`collection` is one kind with a name, as `unary` is: the core types each
name, the policy lists the names a target has. What the existing emitter
writes (probes; handlers in `javascript-target.ts`, helpers in
`javascript-runtime.ts`):

- **A runtime helper on arrays, cheap once arrays exist:** `Norm`
  (`_SYS.norm(_.L)`, also of a tuple and of `list<complex>`), `Dot` of lists
  and `MatrixMultiply` (`_SYS.matmul`), `Determinant` (`_SYS.det`), `Trace`,
  `Inverse` (`_SYS.inv`), `MatrixPower` (`_SYS.matpow(_.M, 3)`), `Transpose`,
  `Cross`, `Mean`, `Median`, `Variance` (`_SYS.mean`, …), `Distance`
  (`_SYS.distance`, also of a list of points), `RotateLeft` (`_SYS.rotl`;
  `_SYS.rotv(S, k, 1)` in `life`), `IndexOf` (`_SYS.idxt`), `Contains`
  (`includes`), `Sort` (`slice().sort()` with the `NaN` order), `Reverse`,
  `Take`/`Drop`/`Rest` (`slice`; a variable count is rounded, `NaN` gives
  `undefined`), `Join`/`ListJoin`/`Append` (spread).
- **Inline in the existing code, so a lowering:** `Dot` of two tuples
  (`(_.P[0] * _.P[0] + _.P[1] * _.P[1])`), `PointX` (`(_.P[0] ?? NaN)`; a
  `map` over a list of points), `PointList` (pairs to the shorter length),
  `First` (`(_.L[0] ?? NaN)`), `Last` (`_SYS.at(_.L, -1)`), `Count`
  (`.length`).
- **Colours** (`_SYS.rgb`, `_SYS.asRgb`, `_SYS.gamutMap`; `ColorToString`
  gives a string) need a colour type and strings: a later note. `Hypot` of
  scalars is `Math.hypot`, a `binary` function.

**The verifier checks** the types of each operation (every operand of
`list` has the element type; the position of `get` is a literal in range;
the yield of `build` and the element of `append` have the element type; a
`collection` name has its signature), and, as now, one definition per value
and visibility in regions.

**The JavaScript policy**: a list and a tuple are an array (`array`),
nested for nested types; a `list<complex>` is an array of numbers and
`{re, im}` objects (`complex-array`), read with `_SYS.cplx`
(`_SYS.cplx(_SYS.atNumeric(_.LC, 1, "complex"))`; a literal keeps a real
element a number: `[_.x, ({ re: 1, im: 2 })]`); the absent value of `at` by
element type (`NaN`, a tuple of `NaN`, `undefined` for a row). No typed
arrays: the runner refuses them (`docs/COMPILATION-MODEL.md`, "Target
boundaries"). A GLSL policy would give `vecN` for a tuple of 2 to 4 reals,
an array of compile-time length for a list, and refuse the rest.

**The three objectives.** (1) `array`, `complex-array` and the helper names
are in the policy and the emitter, not the core. (2) `list`, `tuple`,
`append`, `replace-at` make new values; loops carry lists as parameters. (3)
Every new operation is `pure`; a captured list is a snapshot written as a
literal in the code, so the code stays worker portable.

**Function values: none.** `Map`, `Filter`, `Count` with a predicate,
`Apply`, `Reduce` and `Scan` whose function is a lambda literal, a symbol
with a resolved user-function definition, a library operator, or a
`Composition` of these lower to regions: the function is applied by
lowering its body (or a `call` of the helper, or the scalar operation of the
operator) inside the body region of a `build` or a `loop`, with its
parameters bound to the element values. The existing emitter writes
closures (`((_f) => (_.L).map((_x) => _f(_x)))(((t = NaN) => t + 1))` for
`Map(t ↦ t+1, L)`; `(((t) => t + 1))(_.x)` for `Apply`); the region does the
same element operations in the same order, so the doubles are the same. It
is the smaller design: no closure, no function type, no escape analysis, and
GLSL can use it. It leaves declined: a function given at run time (8
distinct programs), a function in a list or as a result, recursion, and a
local function in a root `Block` (61 compilations; choice 7). The
alternative, first-class functions (`closure`, a function type,
`call-indirect`), is what the `program` profile needs, and makes each effect
and execution question depend on which closure reaches a call.

A user function of no ground signature (222 in the shadow measure) is
compiled once per argument types, as R2 states (`_fn_f_tuple_real__real_`).
A scalar helper called with a list (`_SYS.mapFn(_fn_g, [1], _.L)`) is a
`build` whose body calls it, to the depth of the static type.

## 3. Element-wise arithmetic

**The rule.** A node whose operator has `broadcastable: true` (the test of
`tryCompileBroadcast()`, `compile-broadcast.ts`) and an operand of a list
type is a `build` over the length of that list, whose body applies the
scalar rule of the operator to the elements (`at`) and the scalar operands.
A scalar operand is evaluated once, before the `build`, as
`_SYS.bcast(f, L, x)` evaluates its arguments first (the existing code for
`L + 1` is `_SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), _.L, 1)`). Nested lists
give nested builds to the depth of the type. A tuple operand, when the
operator applies to each coordinate (`appliesToEachTupleCoordinate()`,
`compile-operators.ts`), is unrolled into a `tuple`, as the existing emitter
writes `[(_.P[0] + 1), (_.P[1] + 2)]`. A lowering, not a new operation.

**Two list operands.** `_SYS.bcast` gives the scalar `NaN` when the lengths
differ (`javascript-runtime.ts`), another shape. The route admits two list
operands only when their lengths are equal by construction: each list value
has a length source (a `build` its count; an element-wise result, a rotation
or a `replace-at` its operand), and the sources must be one value. `life`
is admitted (8 rotations of `S`); `L1 + L2` of two inputs and `LL + L`
decline. `Map` over several lists stops at the shortest
(`Math.min(..._ls.map((_l) => _l.length))`): a `build` to the minimum.

**Folds** are loops with the accumulator of the existing code: `Sum(L)` from
`0` (`(_.L).reduce((_a, _b) => _a + _b, 0)`), `Product(L)` from `1`,
`Max(L)` from `-Infinity` and `NaN` when empty, `Reduce(L, Add)` from the
first element and `NaN` when empty, `Reduce` with an initial value from it.
The additions run in array order, so the doubles are the same; `Sum(Map(f,
L))`, fused by the existing emitter, is the same loop with `f` inside.

## 4. Laziness and order

The interpreter's `Map`, `Filter`, `Range` and comprehension are lazy views
that compute an element when it is read (`docs/RANDOMNESS-MODEL.md` §6, [the
Random note](2026-11-11-structured-random-and-effects.md)); the route, like
the existing emitter, makes an eager array. The values agree when each
element computation is pure. The rules:

- The body region of every lowered collection operation must be `pure`:
  `[Random() for k in 1..3]` declines, as the Random note decided.
- A body that can abort (a budgeted loop inside a `Map`) declines: the eager
  array computes elements that the interpreter does not read
  (`First(Map(f, L))`). The simple, sound version; no witness asks for more.
- A `replace-at` in such a body can throw where the interpreter never
  computes the element; the existing compiler throws too. A `crafted` case:
  a known-limitations line.
- An infinite `Range` and `Iterate` (lazy iterators of the existing emitter,
  `isLazyStream`) stay declined.
- Elements are computed in index order and folds run left to right, as
  `map` and `reduce` do.

## 5. Ownership and mutation

The rule of `inPlaceUpdates()` (`structured-in-place.ts`) stays, with three
additions: the results of `list`, `tuple`, `append` and of a `collection`
function that makes a list (the existing helpers copy) are unique; an `at`
with a list or tuple result is never unique (`_SYS.atPoint` returns the
host's array); rule 3 ("other uses are `at` or `length`, whose result is a
number") counts only an `at` with a scalar result. So
`ReplaceAt(LL, i, ReplaceAt(At(LL, i), j, v))` copies the inner list.

A result can be an input array (`If(c, L, [1, 2])` returns `_.L`, as the
existing code does); results are read-only (`docs/COMPILATION-MODEL.md`,
decided 2026-10-13), so the alias is allowed. A constant list literal is made
by each call; a hoisted literal (the existing `_lit_1`) is shared by calls
and is not unique, and hoisting is an optimization of step 8.
`analyzeExecution()` needs no new fact: no host or capture array is written,
and every capture is a snapshot in the code.

## 6. What stays declined

- A type that does not settle a shape (R1, R3): `list<any>`, `list<unknown>`,
  bare `list`, `collection<any>`, `indexed_collection`, a bare `tensor` (133
  of the 144 tensor declines of the sample are `p: tensor` in
  `compile-complex-mode-list-input.test.ts`). The existing emitter recurses
  at run time (`_SYS.bcast`), which "no run-time test of a type" excludes.
- A union of shapes at an input (`list<real> | real`, `broadcastable<real>`):
  R4's dispatch at the binding is its own design.
- Branches of different shapes, a list literal of mixed shapes
  (`[1, (1, 2)]`), a local assigned two shapes (R3); two lists of lengths not
  equal by construction; operands of different depths.
- A function at run time, in a list or as a result; recursion (`fill`).
- Strings, characters, dictionaries, records, colours: a later note.
- A body that is not pure or can abort; infinite ranges; `Reduce` with a
  lambda and no initial value (the existing compiler declines it too).

## 7. Implementation order

Each slice is one change, reviewed and committed alone, with differential
tests against the existing compiler (`cse: false, constantFold: false`;
doubles by `Object.is`; shapes: array or number, length, depth, number or
`{re, im}` per element) and against the interpreter; a negative test per
decline of section 6; allocation counts for in-place updates; the shadow
measure on the files that name the slice's heads; the prelude census.
`scripts/js-profile-fuzz.ts` is not in the tree at this commit; once it is,
each slice adds generators. Estimates are distinct programs of the 1,783
collection-only declines of the sample, by the needs they show; a program
can still decline for a reason its first refusal hid.

1. **Values, element-wise arithmetic, folds:** the types; `list`, `tuple`,
   `get`, `at` and `length` of flat lists and tuples; `number` as `real` in
   `strict`; captured lists; helpers that take and give tuples and lists;
   element-wise arithmetic; `Sum`, `Product`, `Max`, `Min`, `Reduce` by an
   operator, `Count`, `First`, `Last`; a loop or comprehension over a list;
   the guarded comprehension (`append`). About 480. Shadow messages: list
   literal 404, tuple 177, `list<number>` 183, `Sum`/`Product` of a
   collection 299, part of the helper result type 361 and of "unsupported
   binding" 695. Corpus: `legal`, `stones`, `score`.
2. **Collection functions on flat lists and tuples:** `Norm`, `Dot`, `Mean`,
   `Median`, `Variance`, `Distance`, `PointX`, `PointY`, `PointList`. About
   380.
3. **Regions for functions:** `Map`, `Filter`, `Count` with a predicate,
   `Apply`, `Reduce`, `Scan` with a lambda, a user function, a library
   operator or a `Composition`; a scalar helper over a list; helpers per
   argument types. About 260. Shadow: `Map` 273, `Reduce` 266, `Apply` 209,
   `Filter` 48, no ground signature 222.
4. **Nested lists and lists of tuples:** depth from the type, `At` with
   several indexes, `matrix` and `tensor` with dimensions, `Determinant`,
   `Trace`, `Inverse`, `MatrixPower`, `MatrixMultiply`, `Transpose`. About
   310. Shadow: tensor 144, `list<list<…>>` 122, `At` with n indexes 53.
   Corpus: `tangent`, `admitted` (after declarations in Tycho),
   `generations` (with slices 3 and 5).
5. **Slices and joins:** `Take`, `Drop`, `Rest`, `Range` as a value,
   `Reverse`, `Join`, `ListJoin`, `Append`, `RotateLeft`, `Sort`, `Contains`,
   `IndexOf`. About 240. Shadow: `Take` 91, `Drop` 62, `Range` 72. Corpus:
   `life`.
6. **`list<complex>`** in both modes, mixed representation. About 90.

Together about 1,760 of the 1,783; the rest are unions of shapes.

## 8. Open choices

1. **Function values.** Recommended: none, regions. Alternative: closures in
   the core, which the `program` profile will need.
2. **A lambda body.** Recommended: inline in the region, reading the values
   of the enclosing region. Alternative: a function of the program, with the
   values it reads as extra parameters.
3. **An empty list.** `build` and `loop` iterate `Range(from, to)`, which has
   two elements for `Range(1, 0)`. Recommended: a flag `ascending` (no
   iteration when `to < from`). Alternative: an `if` on `length ≥ 1` around
   each lowering, as `Sum` over `Limits` is written now.
4. **Library functions.** Recommended: one `collection` kind written as the
   existing runtime helpers. Alternative: loops in the core; the doubles of
   `_SYS.det` need its algorithm, so the helper is needed anyway.
5. **Lists of different lengths.** Recommended: decline unless equal by
   construction. Alternative: a run-time `NaN` in place of the list, as
   `_SYS.bcast` gives; a value of two representations, which the verifier
   forbids.
6. **`list<complex>`.** Recommended: the existing mixed array. Alternative:
   all elements `{re, im}`; the result shape then differs from the existing
   compiler's, so it declines by the contract.
7. **A local function in a root `Block`.** Recommended: in slice 3, a
   function of the program when it reads only its parameters and captures.
   Alternative: keep declining.
8. **Type encoding.** Recommended: interned objects. Alternative: strings
   such as `list<tuple<real, real>>`, parsed where read.

Not determined: counts per slice over the whole suite (the sample is 200
files, and its counts and the shadow counts cannot be added); whether each
library operator symbol (`Map(Sin, L)` writes `_fn_Sin`) gives the doubles of
its scalar operation.
