# The slice compiler

An experiment: a table-driven compiler with an SSA representation and two thin
printers, JavaScript and GLSL ES 3.00. `compile()` uses it only with the
experimental option `profile: 'ir'`, on JavaScript and GLSL ("Selecting the
pipeline" below). The entry is
`compileSlice(expr, { target, passes, extend, iterationBudget })` in
`index.ts`; it returns the code and its `warnings`. Anything out of scope throws
a `Decline` with the fields `node`, `head` and `cause`, also for a refusal of
the target profile. A failure of the verifier or of the effect-trace check is a
`SliceInternalError`: a defect of the compiler, not a decline.

## Layers

| File                           | Does                                                                           | Does not                                 |
| ------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------- |
| `operators.ts`                 | One row per operator (arity, signatures, effect, fold, alias); region rows     | Name a target                            |
| `lower.ts`                     | The one walk: the head's binding, the constructs, scopes and arms              | Optimize; spell                          |
| `lower-lists.ts`               | List sources (an input, a `Range`, a build), reductions, `Max` and `Min`       |                                          |
| `lower-functions.ts`           | User functions by definition, signatures, the fixed point of their effects     |                                          |
| `lower-context.ts`             | The types the three lowering files share; `Decline`                            |                                          |
| `ir.ts`                        | Types, instructions, functions, the builder, the def-use index                 | Know a target                            |
| `effects.ts`                   | The effect of an instruction and of a function; the eligibility queries; trace |                                          |
| `verify.ts`                    | Definitions, dominance (of values and lengths), types from the tables, calls   | Re-derive a type rule                    |
| `passes.ts`                    | `scalarize`, `fold`, `strength`, `hoist`, `cse`, `dce`                         | Change the effect trace                  |
| `print.ts`                     | The shared statement printer, the inline policy, the copy of a result          | Decide anything that depends on a target |
| `print-js.ts`, `print-glsl.ts` | A `Syntax`: spellings, types, statement forms; the stored code, `run()`        | Analyse the program                      |
| `index.ts`                     | The target profiles and their one check (`admits()`); the frame warnings       |                                          |

Every table (`OPERATORS`, `REGION_ROWS`, `REDUCTIONS`, `JS`, `GLSL`, `TARGETS`)
is frozen, and every cache lives in one `lower()` call: the emitted text is a
function of the expression, the options and the definitions it reads, and
nothing persists from one compilation to the next. A test adds rows, spellings
and helpers with the `extend` option.

The head decides first: a head bound to a user function (by its definition, not
its name) is a call, also when it is named `At` or `Sin`; a library head is
compiled only when `isLibraryOperator()` holds; anything else declines. A
library head whose operator definition has a `compile` handler other than the
standard library's, or `compileHelpers`, declines (`hasOwnLowering()`, also for
a `Range` read as a list source): the definition has a lowering of its own,
which the profile does not call. A host that sets
`ce.lookupDefinition('At').operator.compile` changes what `At` computes, and the
row of `At` would give the stock value. The standard handler of `PointList` is
not such a change (the identity of the function in the library table). Then a
sub-expression that the slice would lower and that has no free name, no name
bound by the walk, no effectful operation and no loop is evaluated once with
`N()` and becomes a literal (`Mod(1, 1/10)` is exactly 0). A closed `Sinc(3)` is
not folded, because `Sinc` is not in the slice. A sub-expression whose static
type is `error` declines (`Sin(Tuple(w))` of a vector `w`, `2·Tuple(L, L)`). A
throw of `N()` means "not folded": the node is lowered as written, except a
`CancellationError`, which propagates. A row that depends on an engine setting
declines when the setting is not the default, except the angular unit: under
`'deg'`, `'grad'` or `'turn'` the lowering multiplies each operand of a direct
trigonometric row (`Sin`, `Cos`, `Tan`, `Cot`, `Sec`, `Csc`, `Haversine`) by the radians of
one unit, and the result of an inverse row (`Arcsin`, ..., `Arctan2`,
`Argument`, `Degrees`) by the units of one radian, on both lanes and both
targets, as the interpreter converts them (`ANGLE_FACTORS`, the row field
`angle`). Like every engine setting, the compiled code holds the factor of the
unit at the time of the compilation.

A root `Function` literal compiles to a function of positional parameters, then
the inputs object for its free names: `run(3, 4, { x: 1.5 })`.

A free name that has a value in the engine (a constant, or a variable) is that
value, lowered at compile time as a literal, only when the value is a number of
the engine (an integer, a rational, a radical such as `Sqrt(2)`, a complex), a
list of such numbers or a tuple of them (a point, `P = (2.64, 17)`): no symbol
and no other application. The value is read from
the innermost binding of the name (`ce.lookupDefinition`), as the interpreter
reads a symbol that is not a call. Any other value declines, also a closed one
(`Pi + 1`), since the names in a stored expression have bindings of their own
(an outer `a = 2` and `v := a + 1` give 3 in the interpreter under a scope that
declares `a = 10`). The program lists the name in `captures` (`symbolDeps`),
unless its binding is the library's. A name with a value read in the body of a
user function is that value, as at the entry, when the innermost binding of the
name is the definition that the occurrence in the body reads
(`resolvedValueDefinition()`): the interpreter reads the binding of the body,
which need not be the one of the name where the call is compiled, and such a
name declines (a function defined outside a scope that declares `a` again).
`compile()` runs a compilation in a scope where each name of the bodies it
calls has the binding of its occurrence (`compilationScope()`), so through
`compile()` that case compiles too, with the body's value; a direct
`compileSlice()` in the scope that declares the name again declines. A name
with no value
there (an input, also one of `symbolic` or `inputs`) is an input of the program
(see "User functions"). `Pi` and
`ExponentialE` decline when the innermost binding of the name is not the library
constant. A reassignment after the compilation does not change the code, and the
inputs object is not read for that name (the existing compiler also writes
`ce.assign('v', 10)` into `v + x` as `10 + _.x`).

## The contracts

1. **Numbers.** On JavaScript a `real` is an `f64` and an `integer` is exact
   within 2^53; on GLSL a `real` is an `f32` and an `integer` exact within 2^24.
   No rewrite changes the operation of an integer computation (an integer `Mod`
   stays an integer `Mod`); a rewrite of a real computation keeps the value
   within the target's precision.
2. **Agreement.** There is no promise of identical bits across executions or
   compilations: two executions of the same program agree within 1e-12 relative
   on JavaScript, and within single-float precision on GLSL. (A test checks that
   the passes on and off give the same bits on JavaScript; that is a test, not a
   contract.)
3. **Order.** No order of execution is promised for pure operations. An
   operation that is not pure is evaluated exactly once per evaluation that the
   program asks for, in program order: the operands of an operation in canonical
   order, before it; an arm only when taken (also the operands of `And` and `Or`
   after one that decides, the pairs of a chain after a false one); a loop or
   build body once per index, in increasing order; the arguments of a call
   before it. The compiler does not reproduce the interpreter's order between
   operands.
4. **Determinism.** The emitted text is a function of the expression, the
   options and the definitions it reads.

`Power` is on the real lane. On JavaScript it calls the engine's real-power
function (`realPow` of `javascript-runtime.ts`, through `_SYS.ir.pow`), which
the fold also uses: a negative base with a rational exponent of odd denominator
gives the interpreter's real root (`(-8)^(1/3)` is -2), also for a run-time
exponent. On GLSL it is `pow()`, whose value for a negative base is undefined in
GLSL ES 3.00: the driver gives NaN, 0 or any value. A real literal at or above
2^53 is a real. An integer value of 2^53 or more is a double and its low digits
are unspecified (`Mod(2^60 + n, 3)`; rule 3 of
`docs/plans/2026-11-12-js-route-course-correction.md`): the compiler makes no
analysis of integer ranges. A closed node keeps the interpreter's value
(`Mod(2^60 + 1, 3)` is 2). At run time there is no guard of any kind for an
integer of 2^53 or more: `Mod(n!, 7)` at n = 25 is 0, and the compiled code
gives 6, the remainder of the double (the existing compiler throws a
`RangeError` there). The remedy for the host is the `bigint` mode. On GLSL
`mod()` of a value beyond 2^24 is the remainder of the float, unspecified.

The real functions (`Erf`, `Gamma`, `Root`, the inverse trigonometric and
hyperbolic functions, ...) are rows whose operation the JavaScript code calls by
name from `REAL_FUNCTIONS` (`_SYS.ir`), which the fold of the row calls too.
Each gives the interpreter's real value within the precision of a double (`Zeta`
below about -171 is a known limitation, `docs/COMPILATION-MODEL.md`); a pole is
±∞ and a value that is not real is NaN (`Root(-4, 2)`, `Arcsin(2)`). `Log(x, 10)`
is the row `Log`, a real `Log(x, 2)` the operation `log2` (both exact at a power
of the base, as the interpreter: `Floor(Log(1000, 10))` is 3), and `Log(x, b)` of
another base `Ln(x) / Ln(b)`. On GLSL the inverse trigonometric and hyperbolic
functions and the logarithms write NaN outside their domain, and `tanh` (also in
`Coth`) is ±1 for |x| > 20; `sqrt`, a division and `mod` are the bare GLSL
operations, whose result outside the domain is the driver's (no NaN-safe helper
is carried over: a user decision; Tycho's render audit showed no picture
change). The domains: `Ln` and `Log` (`log`, `log2`) of an operand `<= 0` (the
interpreter gives a complex value, or `-∞` at 0), `Arcsin` and `Arccos` outside
[-1, 1], `Arcosh` below 1, `Artanh` outside (-1, 1) (also at ±1, where the
interpreter gives ±∞); `Arctan2(y, x)` is `atan(y, x)`, and 0 at (0, 0) as in
the interpreter. `Root(x, n)` is the helper `_gpu_ir_root`: 0 at x = 0 for a
positive index, the real root of a negative radicand for an odd integer index
(`Root(-8, 3)` is -2), NaN for another index of a negative radicand, where
JavaScript gives the real root of an odd denominator (`Root(-8, 2.5)` is
2.297...), as for `pow`. `Factorial` of an integer is the helper
`_gpu_ir_factorial` (a loop of 33 passes, +∞ for a negative operand and over
34); of a real it declines (the Gamma function).
`GCD` of integers (`GCD(Round(a), Round(b))`) is `_gpu_ir_gcd` on `int`s.
`Hypot` is `length(vec2(x, y))`; `Sinh`, `Cosh`, `Tanh`, `Arsinh`, `Arctan`
and the reciprocal rows (`Sec`, `Csc`, `Coth`, `Sech`, `Csch`) are builtins or
their reciprocals. The other real functions (`Erf`, `Gamma`, `Zeta`,
`Arccot`, `Arcsec`, ...) decline there.

Inputs: a union whose every member is a real type (ranged or not), `nan` or an
infinity (`nan | real | signed_infinity`) is a real, also as the element of a
list: a double holds each of its values (a `NaN` or infinite value gives an
unspecified result). A union of one type and `nan` members has the lane of that
type (`integer | nan` is an integer, also in the `bigint` mode; `nan | number`
is a wide input, `complex | nan` a complex one). The same rule types the
parameters and the result of a user function, where a `missing` member is also
removed (`missing | rational` is a real): where the interpreter gives `Missing`,
the compiled code gives NaN. A scalar with no declared type, or of type
`unknown` or `number`, is a real in the `strict` mode (a deliberate difference from the existing compiler)
and a complex in the `complex` mode; a scalar `complex` input is on the complex
lane, and a number given for a complex input is lifted to `{re, im: 0}`, also
with `entryChecks: false`. A list of complex elements declines: an entry of such
a list can be a number or a `{re, im}` object (the ABI of
`docs/COMPILATION-MODEL.md`), and only a run-time test tells them apart. An
outer list of no stated length (`list<real>`, `vector`, `list<list<real^2>>`)
has a run-time length (JavaScript only), also as a parameter of a root function
literal: the length is a positional parameter before the list, read from the
argument. `any` and a list element of type `unknown` or `any` decline with the
input's name.

A `Declare` in a `Block` has a value, positional or in its attributes
(`Declare(t, {value: 0})`; a declaration with no value is an error of the
canonical form), and a type `real`, `integer` or `boolean`, as a string or a
symbol; with the type `unknown`, or none, the local is a real (a boolean for a
boolean value), as the interpreter admits a real write to `let t = 0`. The
attribute `constant` (`Declare(K, {value: 240, constant: True})`) makes a local
that an `Assign` does not write: such an `Assign` declines, as the interpreter
refuses it. Another attribute declines. A local of no stated type whose value is
a list or a tuple (`Declare(H, {value: Comprehension(…)})`) is that value; an
`Assign` to it declines, and so does a list value for a local of a stated type.

A root `Tuple`, or the last operand of a root `Block` that is one, whose
elements are tuples or are not of one shape (`Tuple(H)` of a list of run-time
length, `Tuple(D, x)`) is no value of the program: the entry yields each element
(`IRFunction.tuple`) and the JavaScript code returns the array of them, each
element that can be an input copied (`Tuple(x, Less(x, 0), D)` is
`[x, boolean, copy of D]`). Such a result has no `broadcastOutputs`; GLSL
declines it.

## The complex lane

A third lane, `complex`, is a `{re, im}` object on JavaScript; a real or an
integer is converted to it where a complex is read (`cplx`, which `apply()`, the
arms of a conditional, a list, a local and an accumulator insert), so the lane
of every value is settled at compile time and no code tests a value. The rows
`Add`, `Subtract`, `Negate`, `Multiply`, `Divide`, `Power`, `Root`, `Sqrt`,
`Exp`, `Ln`, `Log`, the trigonometric and hyperbolic rows, `Abs` (real), `Real`,
`Imaginary`, `Conjugate`, `Argument` (real), `Equal` and `NotEqual` have a
complex signature; another row (a comparison, `Floor`, `Mod`, `Max`, ...)
declines a complex operand. The JavaScript code calls `COMPLEX_FUNCTIONS`
(`_SYS.ir`), which the fold calls too: the engine's machine complex functions
(`SYS_HELPERS` of the existing runtime), and the ring operations part by part.
GLSL declines the lane. The result of `compile()` follows the result convention
of every stored kernel (`normalizeRunResult()`), in both modes: a complex value
of imaginary part exactly 0 is returned as the number, at the root and in the
cells of a list; another complex value is a `{re, im}` object. A program whose
root is real returns a number.

The mode. A row with `leaves` (`Sqrt`, `Ln`, `Log`, `Power`, `Root`, `Arcsin`,
`Arccos`, `Arcsec`, `Arccsc`, `Arcosh`, `Artanh`, `Arcoth`, `Arsech`) takes its
complex signature in both modes when its operands are finite constants on which
its real function is NaN: `Ln(-2)·x` is complex, with and without
`constantFold`, as the `strict` contract says of a logarithm or a radical of a
provably negative operand. In the default `mode: 'strict'` a row with
`leaves.nonnegative` (`Sqrt`, `Ln`, `Log`, `Root`, `Power`) also takes it when
the engine proves that operand negative (`isNegative`), its other operands are
constants and its real function is NaN at -1 there: `Sqrt(-x^2 - 1)` and
`Sqrt(x)` for `x: real<..-1>` are complex, `Root(-x^2 - 1, 3)` stays the real
root. This holds whatever an assumption becomes after the compilation: on a real
that turns out nonnegative the complex function has imaginary part 0, and the
result is that number. No sign fact selects the real signature. Otherwise a row
takes the signature of its operands' lanes: a real operation outside its real
domain is NaN (`Sqrt(x)` at `x = -4` for `x: real`). In `mode: 'complex'` a row
with `leaves` takes its complex signature unless an operand proves the real
value by what cannot change after the compilation: an exponent on the integer
lane (`x^2`, `x^n`), or a base or radicand that is a nonnegative constant, or a
value of `Abs`, `Exp`, an even power, or a sum or a product of such values
(`Sqrt(x^2 + 1)`). The type of an input is not read: an assumption narrows it
(`assume(s >= 0)` makes it `real<0..>`) and `forget()` widens it again after the
compilation. `Sqrt(x)` at `x = -4` is then `{re: 0, im: 2}`.

Inputs in the complex mode: an input of type `number`, `unknown` or no declared
type is complex (`CompileMode`), so a comparison of it declines; an input
declared `real` or `integer` stays real. The strict mode reads such an input as
a real.

Declined: `Max`, `Min`, `Floor` and the other integer rows of a complex, a
comparison other than `Equal` and `NotEqual`, the real functions (`Gamma`,
`Erf`, `Zeta`, ...) of a complex, a complex `Max` or `Min` reduction, and
`ComplexInfinity` as a literal; a real pole (`Gamma(-2)`) stays a real infinity.

Ill-conditioned points (docs/plans/2026-11-12-js-route-course-correction.md,
rule 1): near a branch point, a pole or a cancellation the lane gives the
function's value at an argument within a few ulps of the given one, which can
differ from the interpreter by more than 1e-12 or be ±∞ or NaN where the
interpreter is finite (`Arctan(Ln(x))` at `x = 0` is NaN, the interpreter gives
`-π/2`; `Ln(x)·y` at `x = 0` is `-∞ + NaN·i`). On a branch cut the side follows
the sign of the zero part, IEEE style (`Argument(-Z)` at `Z = 0` is π), also for
a `-0` part of a complex input (no fidelity is owed at a signed zero).

## The `bigint` mode

`mode: 'bigint'` (JavaScript only) computes every integer as a JavaScript
`bigint`, so a program of integers is exact at any size: `Mod(n, 10)` at
`n = 2^60 + 1` is `7n`. It is not a lane of the IR. The lowering takes, for each
row, a signature whose result is an integer, a boolean or an element
(`signatureOf()`), and the printer is a second `Syntax` (`JS_BIGINT` of
`print-js.ts`) in which an integer literal is `5n` and each operation it spells
is exact on `bigint` values, with the helpers of the existing mode
(`bigint-runtime.ts`, members of `_SYS`): `Add`, `Subtract`, `Negate`,
`Multiply`, `Abs` (`babs`), `Mod` (`bfloorMod`), `Max`, `Min` (`bmax`, `bmin`),
`Sign` (`bsign`), `Power` (`bpow`), `Factorial` (`bfactorial`), `Binomial`,
`GCD`, `LCM` (`bbinomial`, `bgcd`, `blcm`, rows of the integer lane only), the
comparisons, `And`, `Or`, `Not`, `If`, `Which`, `Block`, `Sum` and `Product`
with integer bounds, `List`, `Range`, `Length`, `At` (`bat`), `Map`, `Filter`,
`Reduce`, `Loop`, user functions with integer parameters (declared, as
`(integer) -> integer`), and a root function literal with integer parameters. A
closed node is the exact value of `evaluate()` (`N()` of `2^70 + 1` is rounded);
a closed node whose value is not an integer (`Mod(5, 0)`, `(−1)!`) is lowered as
written, so its helper throws the pole where it is evaluated.

Every value is an integer or a boolean, also a loop index, a list index and a
length: a loop counts with a `bigint` counter, and the code converts with
`Number()` where JavaScript reads a number (an element, `$0[Number($1)]`, the
length of `Array.from`) and with `BigInt()` where it gives one (the length of an
array, `BigInt(L.length)`). The mode runs with the passes `fold` and `hoist`
off, also with `cse: false` or `constantFold: false`: a helper throws at a pole
(`Mod`, `At`, `Factorial`, `Power`, `Binomial`, and so a call), so no operation
is evaluated before it is written, and `hoist` would move a guarded arm out of
its guard (`m != 0 ∧ Mod(n, m) = 1` at `m = 0` is `False`); the folds of the
rows compute with doubles, and the lowering has folded the closed nodes exactly
already. `cse` reads a value that dominates its use, and `strength` rewrites the
real `pow` only.

Declined, each with its cause: a real or complex value anywhere (an input that
is not of a subtype of `integer`, a real literal, `Pi`, a row with no integer
signature such as `Divide`, `Sqrt` or `Hypot`), so also a quotient under a
rounding function (`Floor(n/3)` is `Floor(n·1/3)`, and `1/3` has no `bigint`
value), `Floor(Sqrt(n))`, a division under an integer promise
(`Declare(t, integer, n/m)`) and a comparison with a rational constant
(`n < 7/2`); a `Power` whose exponent is not proved nonnegative (a constant
`>= 0`, an `Abs`, an even power, a sum or a product of such values: `n^m` is a
rational at `m < 0`); `Floor`, `Ceil`, `Round`, `Truncate` (the syntax does not
spell them); `If` with no else and `Which` with no `True` clause (their value is
`NaN`); `Max` and `Min` of a list (their identity is `±∞`); `Factorial2`
(`(−5)!!` is `1/3`); a `Sum` or a `Product` with an `iterationBudget` (its value
over the budget is `NaN`); a random frame, a draw and an integral; and the
option `vars`. A decline keeps the code `'outside-profile'` (the existing
compiler's mode uses `'bigint-lane'`). GLSL has no such mode.

The ABI is the one of the existing mode (`docs/COMPILATION-MODEL.md`, "The
`bigint` mode"). An integer input takes a `bigint` or a safe-integer `number`;
the code converts it with `BigInt()` at each read, also with
`entryChecks: false`, and with the checks on, a number that is not a safe
integer (`1.5`, `2^60`) throws a `TypeError` that names the input (the entry
plan field `bigints`, `checkEntry()`). A list of integers is an array of
`bigint`; with the checks on its `number` cells are converted in a copy
(`bigintLists`), and with the checks off the host gives `bigint` cells. A result
on the lane is a `bigint` (also a small one), a list result an array of
`bigint`, a boolean a `boolean`. A helper at a pole throws a `NonFiniteValue`
(`(−1)!`, `Mod(n, 0)`, an `At` out of range), and one catch around the entry
returns its number, `Infinity` or `NaN`, as the existing mode's code does: the
throw ends the computation, so a pole under a comparison gives the number where
the interpreter gives a boolean. The helpers' size limit (about 1,000,000
digits) throws a `RangeError`. The stored code holds no `bigint` (its literals
are text), and `load()` gives the values of `run()`.

## Lists

A length is a number or an integer SSA value: the length of an input is a
parameter before it, the count of a `Filter` and of a `Range` an instruction.
Two lists with the same length value have one length (`D + Map(f, D)`,
`Range(1, n) + Range(1, n)`, after `cse`); the verifier checks that a length
value is visible where a type names it. `elem` reads an element from 0; `At` is
the interpreter's rule (from 1, from the end when negative, NaN outside; on
GLSL a conditional that reads the element only in range, with the length as a
literal, `$#0` in the spelling), and
the fold turns an `At` of a constant index in range into an `elem`. A boolean or
nested list that can be out of range declines. `build` and `filter` are region
rows. A `Length`, a reduction, a `Map` or a `Filter` of a `Range` reads its
count and the arithmetic of its elements, so `Length(Range(1, n))` makes no
list. `Max` and `Min` fold from -∞ and +∞ over all their operands, and give NaN
when the total count of elements and scalars is 0; `ElementMax` and `ElementMin`
are rows that thread (`ElementMax(D, 0.3)` is a list). An element-wise
operation of lists of rank 1 has the length of its first list and reads the
others at the same index. Lengths that are numbers and differ decline
(`List(1, 2, 3)·D + List(4, 5)`); a length that is a value fits any length,
also one that happens to be a constant (the count of `Range(1, 2)`). When the
lengths differ, the result is unspecified: with `D` and `E` of two lengths,
`D + E` is an error of the interpreter that the static type (`list<real>`) does
not show, and the compiled value is a list as long as `D`, NaN where `E` has
no element; `Range(1, 2) + List(1, 2, 3)` gives `[2, 4]`. Lists of rank 2 or
more whose lengths are not one length value decline (`Q + R` of two inputs of
type `list<list<real^2>>`). A `Range` can have a real upper bound, its elements are integers
(`Range(1, N)` at `N = 3.5` is `[1, 2, 3]`, the count of `rangeCount`); a real
first element or step declines. Whether a list result can
hold an input is read from the rows (`alias`): such a result is returned as a
copy.

`Comprehension(body, Element(i, L))` is a build of `body` over the source of `L`
(a list, a `Range`); with a condition, `Element(i, L, cond)`, it is a `filter`
of `L` by `cond`, then a build of `body` over the elements kept. The
interpreter's list is lazy: it evaluates the condition and the body of an
element only when the element is read (`Length` reads none), so a condition or
a body with an effect declines (`Length(Comprehension(Random(), Element(z, D)))`
draws nothing in the interpreter). Two clauses or more (a Cartesian product,
flattened) decline.

## Tuples

A `Tuple` is a list of fixed length in the representation, with no type of its
own: a tuple of scalars of one lane (an integer among reals is widened; a
boolean among numbers declines) is the list of its elements, an array on
JavaScript (`Tuple(Cos(t), Sin(t))` is `[0.54, 0.84]` at `t = 1`). On GLSL a
list of 2 to 4 elements, a tuple or not, is a `vec2`, `vec3` or `vec4`
(`bvec2`, ... for booleans; `vec2(cos(t), sin(t))`), and another length a
`float[n]`. A tuple of lists is a list of rows (`Tuple(L)` of a list of
stated length); a tuple of tuples declines. `PointList` with no list component
is the tuple of its components; with list components it is the list of the
tuples of their elements at each index, a scalar component in every tuple, as
long as the shortest component when the lengths are stated, or of one length
value (`PointList(D, Map(f, D))`); other lengths decline. A list of tuples, a
build of tuples (`Comprehension(Tuple(f(k), g(k)), Element(k, R))`) and the
element of a list of tuples are tuples at their axis.

The lowering keeps the set of the values that are tuples (`Lowering.tuples`,
with the axis of the tuple in the shape), and an operator reads a tuple only
where its value on a tuple is its value on the list of the same elements, as
probed in the interpreter (`TUPLE_RULES`): a threading row of one operand other
than `Abs` (`Sin(Tuple(1, 2))`), `Power`, `Mod`, `Root` and `Arctan2` element by
element; `Add` of tuples only (a difference is an `Add` of a negated tuple);
`Multiply` of one tuple and scalars (`2·Tuple(x, 1)`) and `Divide` of a tuple
by a scalar; `At`; and `Length`, `Sum`, `Max` and `Min`. `PointX`, `PointY`
and `PointZ` of a tuple of scalars are `At` of index 1, 2 and 3 (`PointZ` of a
point of 2 coordinates is an `incompatible-dimensions` error of the canonical
form, and declines); of a list, or of a list of points,
they decline. Any other reader
declines a tuple
operand: `Abs(Tuple(3, 4))` is the norm 5, `Equal(Tuple(1, 2), List(1, 2))` is
`False`, a comparison of a tuple stays unevaluated, `Map`, `Filter`, `Reduce`,
`Loop` and `Comprehension` over a tuple, and the arms of a conditional of which
one is a tuple and the other a list. The positions that hold a value (the root,
an element of a `List` or a `Tuple`, the result of a `Block`, an arm of `If` or
`Which`, a build body, a random frame) keep it. The missing arm of an `If` whose
arm is a tuple of numbers is the tuple of NaN of its length, as the interpreter
gives (`If(t ≤ W, Tuple(Cos(t), Sin(t)))` at `t > W` is `(NaN, NaN)`); a list
arm, a boolean tuple and a `Which` with no `True` clause decline, as the
interpreter gives `Missing` there. A tuple result of the root has
`broadcastOutputs` of its type (`broadcastStrideOfType()`), so a batch with
`outputs` gives its elements per cell. An input of a tuple type of scalars
of one lane (`tuple<real, real>`; an integer among reals is a real) is the
list of its elements, marked a tuple, so the rule above reads it: on
JavaScript its value is the array of its elements (`P: [1, 2]`), on GLSL a
`vecN`; so is a parameter of a user function declared such a tuple (see
"User functions"). A tuple of booleans and numbers, and an input of a type with a
tuple inside (`list<tuple<real, real>>`), decline.

## Effects

`pure` (merged, removed, moved, folded, evaluated where it was not written),
`may-fail` (removed when unused; shared by the lowering with an evaluation of
the same node that dominates it; nothing else), `effectful` (keeps its place,
count and order). The effect of a user function is the least fixed point over
its calls, from `pure`, and from `may-fail` for a function on a cycle of calls:
a recursive function may not terminate, so it and its callers are at least
`may-fail`, and a guarded recursive call is not evaluated before its guard. A
node is memoised by the effect of what it emitted: a node whose lowering emitted
an effectful instruction is lowered again at each use; a `may-fail` lowering (a
loop, a build, a call of a recursive function) is shared, because the evaluation
that dominates the use fails first if it fails. So the budget counts the passes
that run, and a `Loop` whose carried values are not read is removed and counts
none. The operands of `And`, `Or` and a chain are lowered lazily, in arms; the
`hoist` pass makes a speculatable arm a plain `and` or `or`. After each pass a
check compares the sequence of effectful instructions (operation, operands,
results and region); the same check runs over the printer's order.

A `WithRandomSeed` frame whose body has one draw site evaluated once (not under
a loop, a `Map`, `Filter`, `Sum` or `Product` body, or a call of an effectful
function) gives the interpreter's draws bit for bit: its draws start at index 0
on entry of the frame. Any other frame compiles, in the compiler's order,
deterministically, and the result carries a warning `seeded-draw-order` that
names the frame and why. A draw is the engine's own (`makeRandomHelpers()` over
the engine's frame slot): a compiled draw reads the frame it runs in.

## Loops and the runtime

On JavaScript the code reads the runtime `_SYS` of the existing compiler
(`makeSysHelpers()` of `javascript-runtime.ts`): the functions of the folds are
its member `ir` (`IR_FUNCTIONS`: `REAL_FUNCTIONS`, `COMPLEX_FUNCTIONS`, `pow`,
`mod`), under one name so that no IR name meets a member of another meaning; a
draw, a random frame, an integral and the length of a `Range` are its members
`drawNextRandomNumber`, `withRandomSeed`, `integrate` and `rangeCount`. Each
pass of a loop or a build begins with `_SYS.tick()`, which checks the deadline
(`ce.withTimeLimit()`, or the `deadline` of a runtime without an engine) every
1024 passes. The `iterationBudget` option follows the rule of `compile()`
(`CompilationOptions.iterationBudget`): a pass of a `Loop` (a `loop` instruction
with `passes`) also calls `_SYS.countLoopPass(budget)`, which adds one to one
count for a call, nested loops and the loops of user functions included; over
the budget, the call throws a `CancellationError` with the cause
`iteration-limit-exceeded` (`docs/COMPILATION-MODEL.md`, "A limit on `Loop`
passes"). The count is in the runtime; the entry starts with
`_SYS.resetLoopPasses()` when the code counts passes. A `Sum` or a `Product`
with `Limits` whose count of passes is more than the budget is NaN
(`hi - lo < budget` is false), each loop by its own count: the lowering writes
that test as an `if`. A `Loop` in an integrand counts its passes once per sample
of the quadrature, whose number of samples is unspecified. A build, a `Filter`
and a reduction of a list count no pass. GLSL has no deadline and counts no
`Loop` pass at run time: its budget is the option or 10,000 (the existing GLSL
target's default), a `Sum` or a `Product` over it is NaN as above, and the
adapter bounds the passes of every loop (`Loop`, `Sum`, `Product`, a
reduction) at compile time (`loopPasses()`): a constant count is itself, a
run-time count is the budget (the test above ensures it), multiplied down
the nesting and through the calls, both arms of an `if` added. A program
whose bound is over the budget declines: two nested `Sum`s of 10,000 passes,
a loop nested in a `Sum` of a run-time count (`Sum(Max(L6)·j, j = 1..n)`),
a `Loop` of 10,000 passes around such a `Sum`. A single `Sum` of a run-time
count compiles. With `iterationBudget: Infinity` there is no bound.

`Loop(body, Element(i, L), …)` is a statement whose value is `Nothing`: one
counted loop per clause over the source of `L` (an input list, a list, a
`Range`), a later clause lowered in the body of the one before, so it reads its
index. The locals declared outside the loop that the body writes are its carried
values. A `Loop` with no `Element` clause, a `Break`, a `Continue`, a `Return`,
a write to the index and a `Loop` whose value is read decline: the structured
regions have no early exit.

`Integrate(f, Limits(t, a, b))` and `NIntegrate(f, a, b)` of real bounds
(infinite ones too) and a real integrand (a function literal of one parameter,
or a body in the name of the `Limits`) are the region `integrate`: the integrand
is an arrow function that the runtime passes to the existing compiler's
quadrature (`SYS_HELPERS.integrate`: adaptive Gauss-Kronrod, stated tolerance
1e-10 relative and 1e-12 absolute, with a Monte-Carlo fallback that draws from
the engine). As for any pure operation, the number of evaluations of an integral
is unspecified (an unused one is removed), and the fallback's draws are not the
program's. An integrand with an effectful operation declines (the routine
chooses its samples), as do two variables and the option
`quadrature: 'monte-carlo'`. GLSL has no spelling.

## User functions

A user function is lowered once per compilation, keyed by its definition: the
parameter types from the signature of its binding (`real` when unknown), the
result from the signature or the body. A recursive one needs a result type
(declared, or inferred by the engine). An input of the compilation that the body
reads (a free name with no value, or a name of `symbolic` or `inputs`) is a
parameter after the function's own, in the order of its first read in the body
(lambda lifting; a scalar, a list of reals or integers of a stated length, or a
tuple of them, which stays a tuple; on GLSL, which copies an array argument at
each call, a list of more than 4 elements that is not in storage declines,
`IRFunction.lifted`): each call passes the caller's value of the name, an input of
the entry or, in another function, a parameter of the same kind, so the input is
in `freeSymbols` and a chain of calls passes it down. At the entry the input has
the type that the scope of the compilation gives the name, whichever occurrence
reads it first, and the call checks it against the parameter: with `f(t) := a·t`
and `inputs: {a: 'complex'}`, `f(2)` declines (an integer input for a real
parameter is admitted). An occurrence of an input of another type than the
input's declines. A `vars` name whose text reads the inputs object
(`readsVarsObject()`: `_.P`, `_['Q']`) is passed the same way: each call in the
entry reads the text. Declined: a recursive call of a function that reads an
input, also through a cycle of calls (`P(j) = If(j > 0, Q(j - 1), n)` and
`Q(j) = If(j > 0, P(j - 1), 1)`); a call where the name is a local or a
parameter, or has a value; an input of a list of a run-time length or of
booleans; a name with a value read in the body whose binding where the call is
compiled is not the body's (see the values of free names above); another
`vars` name. A recursive function that reads no input
compiles. A function value other than the literal of a `Map` or `Filter` or the
root, and a list argument for a scalar parameter (the interpreter maps the
function over the list) decline. A declared result `complex` of a real body is
the body converted to the complex lane.

A parameter declared a list of reals or integers
(`(list<integer>, integer) -> integer`) is a list: of a stated length, which the
argument must have, or of a run-time length, a hidden integer parameter before
it that each call passes (the length of the argument), as the root function
literal does: `f(D) + f([1, 2])` calls one function with lengths `D.length`
and 2. A parameter declared a tuple of reals or integers
(`(tuple<real, real>) -> real`) is the list of its elements, marked a tuple,
and takes a tuple argument only (`pf(P)`, `pf(Tuple(x, Sin(x)))`). A tuple
argument for a list parameter, a list of lists, of booleans or of complex numbers
decline. On GLSL a parameter of stated length is a vector of 2 to 4
elements (`vec3 B`) or an array parameter (`float B[5]`); one of run-time
length declines with the target's rule.

A result declared a list of reals, integers or booleans (`list<integer>`,
`list<real^3>`) has the type of the body, a list of rank 1 of a sub-lane of the
declared one, and is not a tuple; a result declared a tuple of reals, integers
or booleans (`(real) -> tuple<real, real>`, a point) has a tuple body of a
sub-lane, and the result of a call is a tuple. A body of another lane
(`tuple<integer, integer>` of a real body), a tuple body for a list result or
the reverse, and complex elements (`tuple<complex, complex>`) decline. A
run-time length of the result is a value of the body: the call has two results,
the length and then the list, and the
JavaScript code reads the length of the returned array (`.length`); the
function returns one value, as any other. The verifier checks that the type of
the list result names the length result of the same call. A result that can be
a parameter (`same(L) := L`) is returned as a copy, so the result of a call is
a new list. Declined: a recursive call of a function with a list result (its
type is the body's), a list of lists, and on GLSL a result of a run-time
length; one of a stated length is a `vecN` or a `float[n]`
(`vec2 _fn_ir_u0_pt(float v0)`).

## How to add

- An operator: one row in `OPERATORS`; a spelling in `JS.ops` and `GLSL.ops` for
  each new IR operation (`op.int` falls back to `op`), and in `JS_BIGINT.ops`
  when it is exact on `bigint` values. A target with no spelling declines the
  operation.
- A list-reading operator: a row with a `'list'` operand (as `At`), or a
  reduction in `REDUCTIONS` (it reads its list through a source).
- A construct: one case in `lower.ts`. A construct with a body is a region row
  in `REGION_ROWS` (arguments, parameters, result types, alias) and a region
  spelling per target; no new instruction kind.
- A pass: a function over `rewrite()` that asks `effects.ts` first.
- A target: a `Syntax` (operation spellings, region spellings, types, statement
  forms) and a `Profile` in `TARGETS` (`lanes`, `rank`, `runtimeLengths`,
  `draws`, `frames`, `recursion`, `elementwise`). `admits()` is the one check.

## Limits

- A program for which the walk lowers more than 50,000 nodes declines
  (`NODE_LIMIT`, `lower.ts`). A shared node is lowered once per region, so the
  two arms of an `If` that both read a shared graph lower it once each: a
  chain of such `If`s (CE-584) would otherwise grow exponentially.
- The printer names a value whose text would nest more than 64 inlined
  values (`INLINE_DEPTH`, `print.ts`): it writes an inlined value by
  recursion, and `Max` of 1,000 operands is a chain of 1,000 `max`. A
  program on which a walk of the pipeline still exceeds the call stack (a
  tree of depth 20,000) declines: "an expression too deep to compile".
- On GLSL `scalarize` writes an element-wise operation as one expression per
  element for a list of at most 64 elements (`SCALARIZE_LIMIT`); over a
  longer list, an array or a list in storage, the operation declines
  (`2·E` for `E: list<real^65>`), as the text would grow with the length.
  A reduction or an `At` of such a list is a loop or a read and compiles.
- A loop or a build of 2^32 iterations or more throws on JavaScript; GLSL clamps
  its `int` bounds to ±2^30. GLSL has no run-time length, region, draw, frame or
  recursion.
- A list of lists of run-time length (other than an input's outer list), a
  `Range` of a real first element or step, a string seed, a list of run-time length made in a random
  frame, and `Random` of a domain decline.
- A copied list result is a `structuredClone`: two rows that are the same list
  in the result (`[L, L]`) stay one object in the copy.
- A `real` local declared or assigned a value outside its type (NaN, a complex
  number) is an error of the interpreter; the compiled code goes on with the
  value, and can overwrite it (`Block(Declare(t, real, Sqrt(x)), t := 2, t)`
  gives 2 at x = -1).

## Selecting the pipeline

`compile(expr, { profile: 'ir' })` on the `javascript` target compiles with this
pipeline (experimental: the option can change or go without notice). All the
glue is in `adapter.ts`; `compile-expression.ts` dispatches to it next to the
`numeric-kernel` profile.

- **A decline** (`Decline`, also a refusal of the target) is the public
  diagnostic `'outside-profile'`, with the head in `operator` and the node in
  `value`; any other error of the pipeline (`SliceInternalError`, a printer
  error) is a `'compile-error'`. Both follow `fallback` as for the
  `numeric-kernel` profile: the interpreter, or a throw with `fallback: false`.
  A `CancellationError` is thrown as it is.
- **Options.** One table classifies every option of `compile()` (`IR_OPTIONS` in
  `adapter.ts`; `compile-expression.ts` fails the type check when an option has
  no class). Mapped: `iterationBudget` ("Loops and the runtime"), `vars`
  (below), `quadrature` (`'adaptive'`; `'monte-carlo'` declines), `entryChecks`
  (the entry plan of the existing runtime, `checkEntry()`: a `{re, im}` value
  for a scalar real or integer input or parameter, and a string or a typed array
  for a list input, throw a `TypeError` that names it; another value outside the
  declared type gives an unspecified result; a number for a scalar complex input
  or parameter is converted to `{re, im: 0}`, also with `entryChecks: false`; a
  conversion copies the own properties of the inputs object, so an inherited
  input or a getter is then lost, a known limitation of the existing runtime),
  `mode: 'complex'` and `mode: 'bigint'` (reported in the result's `mode`; "The
  `bigint` mode"), `cse: false` (the passes without `cse`),
  `constantFold: false` (the lowering evaluates no closed sub-expression with
  `N()`, and the `fold` pass is off), `symbolDeps` (the user functions compiled
  in and the names whose value the code holds, `captures`) and `varsObjectRefs`
  (the inputs read from the inputs object, filled also when a literal declines
  for a free name). Admitted with no effect: `storage` (the JavaScript target
  ignores it, `CompilationOptions.storage`), `mode: 'strict'`, `broadcast`
  (`true` builds no batch body; the batch members below exist either way), and
  an empty `functions`, `operators`, `imports` or blank `preamble`. Declined by
  name: `functions`, `operators` (both forms), `imports`, `preamble`,
  `strictTypes: true`, and `vars` in the `bigint` mode.
- **`vars`.** A mapped name is read as the host's text at each use, in program
  order (an effectful operation, so `w - w` with `w: '_.draw()'` calls `draw`
  twice), in the scope of the entry, where `_` is the inputs object. The mapping
  wins over the engine's value of the name and is never folded; a local of the
  same name shadows it. Its lane is the name's type (a wide or `any` type is a
  real). A read in a root function literal (no such scope), or in a user
  function of a text other than a read of the inputs object (see "User
  functions"), a call of a mapped name, a list or complex type, and a text with
  `$` or `$#` and a digit (a placeholder of a spelling) decline. A mapped name is not an input (`freeSymbols`).
- **Calling convention.** The result is `calling: 'expression'`, `run(inputs)`,
  or, for a root `Function` literal, `calling: 'lambda'`, `run(a0, a1, …)`, as
  the existing compiler's result is called by `implicitCompile()`; a literal of
  no parameter (`Function(42)`) is a `lambda` too. A literal whose body reads a
  free name declines: that convention has no object for it (`compileSlice()`
  itself takes one after the arguments). The inputs of an expression are in
  `freeSymbols` and `varsObjectRefs`. A warning of a random frame is in
  `warnings` (`kind: 'correctness'`). `profile` is `'ir'`.
- **Stored code.** The result has the fields of the stored code of the existing
  compiler (`StoredJavaScript`), with the same meaning: `preambleOnce` (and
  `preamble`, the same text) holds the helpers and the user functions, `code` is
  the body (an expression of the inputs object `_`, or the function of a
  literal), `runtimeVersion` is `RUNTIME_VERSION`, and `entryPlan` holds the
  inputs that a loader checks (`checkEntry()`: the conversion of a number for a
  complex input, and with `entryChecks` the refusals of the existing compiler;
  `lists` and the scalar `booleans` tell a batch loader which inputs are shared
  lists and boolean columns). For a literal with helpers, `code` evaluates them
  and gives the function, and `callCode` is the function alone, so a lambda
  loads from `code` alone, as one of the existing compiler.
  `reconstructionDigits` is the count of digits to which the exponent of a
  negative base is read; a loader sets it around each call, and `run()` reads
  the engine's current count, the same unless the precision changes between the
  compilation and the call. `createJavaScriptRuntime().load()` and a worker of
  the kernel pool load it; `run()` is built as `load()` builds it: the same
  two-stage runner (`twoStageRunner()`, over the engine's runtime source), the
  same entry plan (`checkEntry()`) and the same result convention
  (`normalizeRunResult()`), so `run()` and loaded code agree by construction.
  `shippable` is the rule of the existing compiler: false for code that draws or
  integrates (`isShippableCode()`) and for a `vars` text that is not a read of
  the inputs object (`readsVarsObject()`: `_.E` is shippable). There is no
  `pure` or `freeSymbolTypes`.
- **Batches and `runAsync()`.** The result of an expression (not of a literal)
  has `broadcast()`, `broadcastAsync()`, `willUsePool()`, `runAsync()` and
  `willParallelize()`, and `broadcastOutputs` for a type of more than one value
  per cell, built by the generic functions of the existing compiler
  (`broadcastNumbers()`, `broadcastNumbersSlice()`, `makeBroadcastAsync()`,
  `makeWillUsePool()`, `makeRunAsync()`, `makeWillParallelize()`) over the raw
  call of the code, its entry plan and the result as stored code, which a worker
  loads. Each cell is the value of `run()` at that cell. There is no batch body
  (CE-410) and no asynchronous copy (`parallelCode`): `runAsync()` runs `run()`,
  and `willParallelize()` is false. In the `bigint` mode a batch is refused with
  the error of the existing compiler.
- **The measures.** `CE_JS_PROFILE=ir` makes the engine's own compilations
  (`implicitCompile()`) try the profile first and fall back to the existing
  compiler; `CE_JS_PROFILE_SHADOW=ir` also compiles every JavaScript `compile()`
  with the profile, discards the result and counts it (`CE_JS_PROFILE_SHADOW=1`
  still measures `numeric-kernel`). With `CE_JS_PROFILE_STATS=<dir>`,
  `node scripts/js-profile-stats.mjs <dir>` prints the counts
  (`docs/plans/2026-11-10-js-profile-first-consumer.md`).

`compile(expr, { to: 'glsl', profile: 'ir' })` compiles with this pipeline too
(`adapter-glsl.ts`, batch G1 of
`docs/plans/2026-11-09-js-compiler-status-and-plan.md`), for a scalar result
(real, integer or boolean) or a list of stated length (batch G2: a point, as
`vec2(cos(t), sin(t))`, or a `float[n]`) of inputs that are scalars or lists
of a stated length (`tuple<real, real>`, `list<real^3>`; batch G3:
`list<real^6>` is a `float[6]`), and gives the
result of the existing GLSL target: no `run`; `code` is an expression, or
statements that end in `return …;`, in which an input is its bare name (the option `bareInputs` of
`compileSlice()`; the host declares the uniform or the parameter); `preamble`
holds the helpers and the user functions, named `_gpu_ir_…` and `_fn_ir_…` in
the GLSL syntax (a host that joins two compilations renames by `_gpu_` and
`_fn_`; `ir_` keeps them apart from the names of the existing GLSL target);
`freeSymbols` are the inputs; `freeSymbolTypes` has the `type` and `provenance`
of the existing target (`freeSymbolTypes()` of `compile-references.ts`) and the
`lowered` type that the code reads (`float`, `bool`, `vec2`, `bvec3`, `float[6]`: the
existing target's for each input it compiles); `warnings` holds the
`float32-unsafe-argument` warning of the existing target (`kind:
'correctness'`, `value` the operand), once per operand of a `Mod` or a
`Fract` in which a constant of magnitude 1000 or more amplifies a
trigonometric value (`isAmplifiedTrig()` of `gpu-exact-trig.ts`), in the
expression and the bodies of the user functions it calls (each node once);
there is no exact sine hash and no `float32Bounds`, so such an operand warns
also where the existing target emits an exact form (a host that sends a
flagged curve to its CPU lane does so for these too), except in a `Mod` or a
`Fract` that is closed as a whole (numbers and library constants under library
rows that are not effectful, `Mod(10000·Sin(100000), 1)`), which the lowering
folds in doubles: it warns only with `constantFold: false`. A closed operand
of a `Mod` by an input is not folded and warns (`Mod(10000000·Sin(1), x)`); `unsupported` is empty,
`mode` is `'strict'`, `profile` is `'ir'`. A name of `vars` is an input whose
read is the host's text (`x + y` with `vars: {x: 'u_x'}` is `(u_x + y)`, and
`x` stays in `freeSymbols` with its type): a name, a member or an element of
one (`u_x`, `u.P`, `u[0]`), which calls nothing and is spliced at each read;
a read in a user function is passed as any input (see "User functions").
Another text, a text with a name that is a GLSL word or holds `__` or a
`gl_` prefix (`u.sample`, `u.gl_x`), a text whose first name could not be an
input name (below), and a name that has a value in the engine decline.
`storage: { S: 'sampler2D' }`: the list input `S` (of numbers, of a stated
length) is held by the host in a texture, the contract of the existing
target (a single-channel float texture, one element per texel, row-major
from texel (0, 0), of any width, read at level 0 with no filtering; the host
declares `uniform sampler2D S;` and `precision highp sampler2D;`). After the
passes, `holdStorage()` (`index.ts`) marks `S` and, to a fixed point, the
parameters of the functions it is passed to (`IRType.storage`): each read
must be the list operand of `elem` or `at`, which the printer spells
`elem.sampler2D` and `at.sampler2D` (one helper `_gpu_ir_texel(v, k)` for
every length; `at` keeps the rule of `At`, NaN outside), or an argument of a
call whose parameter is then a `sampler2D`. So `At(S, k)`, a reduction, an
element-wise operation (scalarized to reads) and a user function that reads
`S` or takes it as a list argument compile; `S` as a value (a result, an
arm, a yield), a function called with `S` and with another list, and a
`vars` text for `S` decline. `freeSymbolTypes.S.lowered` is the existing
target's (`float[7]`, `vec3`). `callerLocals` has no effect: a function
always takes the inputs that its body reads as parameters ("User
functions"); a call under a binder of the input's name declines. Declined with
`'outside-profile'`: a list result of a user function of a run-time length, a root `Function` literal,
the options `functions`, `operators`, `imports`, `preamble`,
`strictTypes: true`, `broadcast: true`, a `mode` other than
`'strict'`, loops whose passes can exceed the budget ("Loops and the
runtime"), and an input name that is not a plain GLSL
identifier, is a reserved word (`gpu-reserved.ts`), can be a name of the printer
(`v<digits>…`, `_gpu_…`, `_fn_…`) or is the name of a function that the code
calls. `fallback: true` then compiles with the existing GLSL target and logs a
warning (the console). `CE_JS_PROFILE_SHADOW=ir` also measures every `compile()`
to `glsl` that asks for no profile, under the consumer `glsl:public`, which the
statistics script totals apart from JavaScript.
