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

## 9. Result of slice 1

Implemented on `50e3e41a4` and moved onto `775bc003b` (the options `vars`,
`functions`, `operators`: the `host` operation), then onto `595af0206`
(nested blocks, operand blocks, local functions), with options 1, 3, 5 and 8 as recommended (no
function values; `ascending`; two lists only when their lengths are equal
by construction; interned types). Tests:
`test/compute-engine/compile-javascript-structured-collections.test.ts`
(both modes, against the existing compiler with `Object.is` element by
element and against the interpreter), the verifier cases in
`compile-javascript-structured-ir.test.ts`, and the generators of
`scripts/js-profile-fuzz.ts` (list literals, tuples, list and tuple inputs
and parameters, element-wise arithmetic, folds, guarded comprehensions,
helpers with list and tuple results and a list parameter; shapes compared
element by element).

**Admitted.** `list` and `tuple` operations; `get` (a literal position of a
tuple); `at` and `length` of a tuple whose elements have one type; `append`;
tuple inputs and parameters of unnamed `tuple<real, …>` types; lists and
tuples as values of locals and branches and as results of the program and
of helpers. Folds: `Sum` and `Product` of a list (an ascending `loop` from
the integer `0` or `1`) or of a tuple (one `add` or `multiply` of the
`get`s), `Max` and `Min` of one list or tuple (an `if` on the length `0`,
then a loop from `∓Infinity`). Element-wise `Add`, `Subtract`, `Negate`,
`Multiply` and `Divide` of a list and reals or integers, and of lists whose
`lengthKey()` is one (a name, a literal length, an element-wise result or a
`ReplaceAt` of one). The guarded comprehension: a `loop` that carries the
list from an empty `list`, with an `if` of the guard and an `append`, in
place when the list is not read elsewhere (`(acc.push(v), acc)`). The three
corpus witnesses compile, are `pure` and `shippable`, and equal the
existing compiler on two boards and three players.

**Where the implementation differs from the note.**

- `number` as `real` in `strict`, captured lists, `Reduce` by an operator,
  `Count`, `First`, `Last` and a loop over a list are not in this slice:
  they still decline.
- A tuple is `tuple<real, …>` only (a `point` fact of the fragment); a tuple
  of integers is a tuple of reals. An `at` with a list or tuple result does
  not occur (no nested lists), so the third addition of section 5 is not
  needed yet; `get` is a use of rule 3 of `inPlaceUpdates()`.
- Declines that the existing compiler needs and the note did not foresee,
  each found by the random tester:
  - a fold of an operand other than a name whose type is not real
    (`Sum(I/2.5)` has the type `number`: the existing compiler wraps it in
    `_SYS.cplx` in the `complex` mode, `Product(I·√x)` in both modes); in
    the `complex` mode a `Sum` or `Product` of a type with `NaN` or an
    infinity or of a local list, which it reads with `_SYS.cplx(R)`;
  - a `Sum` of a list literal with a sum as an element: the preparation of
    the existing compiler makes `Sum([2, x - 0.1])` the sum
    `Add(2, Add(x, -0.1))`, which the existing emitter writes as one chain;
    the same for a `Product` of a list literal with a product as an element
    (canonical `Reduce(L, Multiply, 1)`). The refusal is made on the root
    and on the body of each helper and local function
    (`admitFunctionBody()`); in the body of a helper, the existing compiler
    also writes the element of an element-wise sum of a list literal as one
    sum in an order of its own (`([1, 2] + (x - 0.1))[2]` is
    `x + 2 + -0.1`, and `([1, 2] + x + 0.1)[2]` differs in the last bit at
    `x = -0.7`), so every `At` of an element-wise sum or product of a list
    literal declines there. The other refusals of the admission are made on
    each node of every body (the root walk and `admitFunctionBody()`), or
    on the whole annotation;
  - element-wise arithmetic with a name of no declared type (the existing
    compiler multiplies by the run-time shape, `_SYS.mulChecked`, scalars
    first), and a broadcastable operation other than a comparison or a
    connective of an operand whose type admits a list and a number, or of an
    expression of the type `any` (a call `f(L)` of `f: (list<real>) -> real`
    has the type `list<any> | real`; the existing compiler broadcasts it),
    except a sum or a negation of real operands in the `strict` mode;
  - a guarded comprehension whose bound is not an integer literal of at
    most 2^31 − 1 in magnitude or a `Length`: the existing emitter throws for
    a range of more than 2^32 − 1 elements, and the route has no such test.
- A call boxed before its function was defined (`score` before `stones` in
  the prelude) holds a definition with no literal: the structured route
  reads the definition that the name has at compile time, as the existing
  compiler does (`resolveHelper()`).
- With the `host` operation: a function of the host takes and gives
  numbers, so a host call with a list argument or a list result declines,
  and no list reaches the host; an in-place update (`inPlaceUpdates()`)
  writes only a list that the program made, which no host call can hold,
  so it needs no new rule. A list value read before an `unknown` host
  operation is read again after it (the new epoch of `afterUnknown()`). A
  guarded comprehension whose guard or body calls the host declines, also
  for a function declared pure (the admission reads the effect of the
  engine); an element-wise operand that calls the host is evaluated once
  before the elements, as `_SYS.bcast` evaluates its arguments. The new
  operations hold no region, so `reachesHost()` reads them through the
  `loop` and `build` that hold them.
- With the blocks of `595af0206`: a list or a tuple is a local of a nested
  block, of a block of declarations as an operand, of `Declare(a,
  'unknown', v)`, and the value of a first write to an undeclared name (the
  implicit local of `fragment.ts` admits a list when the definition has
  list locals, as `Declare` does). A local function takes a list
  parameter and gives a list or a tuple result. A local function that reads
  a list local of the body declines ("the parameter `R` of `g` has no type
  in the profile"): the list would be an extra parameter, and the body can
  update it in place between two calls. In the `complex` mode a tuple local
  and the fold of a list local decline, as for a `Declare`.
- `refuseMixedOperand()` reads an operand of the type `any` or `unknown`
  as a possible list only when it reads a list or a tuple: a call of a
  local function of scalar arguments has the type `unknown` and is scalar
  code on both compilers.

**Counts**, before (`50e3e41a4`) and after, measured 2026-11-11:

- Shadow measure on the 100 test files of `test/compute-engine/compile*`
  that name a list, a tuple or a comprehension (3,067 compilations that the
  existing compiler compiles): the profile admits 385 before and 425 after,
  with 0 failures; the messages "a list literal" (93), "a tuple" (34) and
  "Sum of a collection" (80) are gone. Of the 796 compilations that the
  existing compiler declines, the profile admits 6 before and 7 after.
- The 45 consumer test files (`limit*`, `find-fit*`, `nintegrate*`,
  `integrate*`, `solve*`, `map-auto-compile*`): 1,956 tests pass with and
  without `CE_JS_PROFILE=numeric-kernel`; the `Map` consumer admits 50 of 64
  before and 51 after, the other consumers are unchanged.
- The prelude census (the functions of 14 of the 15 showcase preludes of
  Tycho; `turing-patterns` did not finish executing in 15 minutes): 22 of
  44 functions compile before, 26 after on `50e3e41a4`, 27 on `595af0206`
  (`blackhole` compiles since the blocks change): `legal`, `stones`, `score`
  (`score` calls `stones`, defined after it) and `csqrt` of
  `apollonian-gasket` (a tuple). The others decline as before; the
  list-related ones are `tangent` and `admitted` (`At` of a real: a list of
  tuples, slice 4), `seen` (`Count`), `generations` (a list of tuples),
  `fill` (a loop over a list) and `life` (`RotateLeft`, slice 5).
- `scripts/js-profile-fuzz.ts` on `595af0206`: `--seed 71,72,73,74,75
  --count 10000`, `--seed 61,62 --count 5000 --host`, `--seed 41,42 --count
  5000 --random` and `--seed 91,92 --count 5000 --deg`. No difference of
  shape; one difference of value, of the class CE-1203
  (`arccos(At(Comprehension(log k, …, guard), 3))` in the `strict` mode).
  Two failures of the profile with `--host`, of the base and outside lists:
  `0.5·hav(vr)` with a host read `vr`, and `y·{b0 ⩴ 1; hav(-0.25)}`, gave
  a `compile-error` in the emitter (Haversine in a parent that needs
  parentheses). They decline at the admission now
  (`refuseHaversineGrouping()`: a read of the host is not an input, and the
  value of an operand block is checked as the operand); this also declines
  `y·{b0 ⩴ 1; hav(x)}`, which the existing emitter writes correctly. On
  `d221dfaf6`, with that change, `--seed 71,72,73 --count 10000` and
  `--seed 61,62 --count 5000 --host` have no difference of value or shape
  and no failure of the profile. The disagreements with the interpreter are the classes of
  the precision caveat, CE-1206, and an interpreter defect outside the
  slice: a guarded comprehension, the value of a nested block, whose guard
  reads an implicit local of that block gives `[]` (its lazy view reads the
  local after the block ends; with `Declare` or in the outer block it
  gives the elements). An `At` of an element-wise product of a list literal
  with a product element (`At(y·[1, 7x], 2)`, which the preparation makes
  `y·(7x)`) declines, as `Sum` of a
  list literal with a sum element does.
- A list local made before a write of a local that it reads keeps the
  values of the declaration on the three sides: the interpreter's
  comprehension is a lazy view, but an assignment stores the elements of a
  lazy collection that reads a variable (`listedAssignedValue()` in
  `library/core.ts`), so `let xs = [k for k in 1..3 if cutoff < k];
  cutoff = 2; length(xs)` is 2 with `cutoff = 1` at the declaration, also
  for a body, a bound, an element-wise sum, a loop and a local function
  that reads the local. No decline is needed; the tests lock these values.
