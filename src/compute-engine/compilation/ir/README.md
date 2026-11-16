# The slice compiler

An experiment: a table-driven compiler with an SSA representation and two thin
printers, JavaScript and GLSL ES 3.00. `compile()` uses it only with the
experimental option `profile: 'ir'`, on JavaScript and GLSL ("Selecting the
pipeline" below), and on `interval-js` ("The interval mode"). The entry is
`compileSlice(expr, { target, passes, extend, iterationBudget })` in `index.ts`;
it returns the code and its `warnings`. Anything out of scope throws a `Decline`
with the fields `node`, `head` and `cause`, also for a refusal of the target
profile. A failure of the verifier or of the effect-trace check is a
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
| `passes.ts`                    | `scalarize`, `fold`, `strength`, `hoist`, `cse`, `invariants`, `dce`           | Change the effect trace                  |
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
trigonometric row (`Sin`, `Cos`, `Tan`, `Cot`, `Sec`, `Csc`, `Haversine`) by the
radians of one unit, and the result of an inverse row (`Arcsin`, ..., `Arctan2`,
`Argument`, `Degrees`) by the units of one radian, on both lanes and both
targets, as the interpreter converts them (`ANGLE_FACTORS`, the row field
`angle`). Like every engine setting, the compiled code holds the factor of the
unit at the time of the compilation.

A root `Function` literal compiles to a function of positional parameters, then
the inputs object for its free names: `run(3, 4, { x: 1.5 })`.

A free name that has a value in the engine (a constant, or a variable) is that
value, lowered at compile time as a literal, only when the value is a number of
the engine (an integer, a rational, a radical such as `Sqrt(2)`, a complex), a
list of such numbers or a tuple of them (a point, `P = (2.64, 17)`, also written
`PointList(2.64, 17)`), or a colour constructor (`Rgb`, `Hsl`, `Hsv`, `Oklab`,
`Oklch`) of three real numbers (`C = Hsv(270, 0.4, 0.95)`, which is lowered as
that application on the colour lane): no symbol and no other application; a
constructor with an alpha or a channel that is not a number declines with its
own cause. The value is read from the innermost binding of the name
(`ce.lookupDefinition`), as the interpreter reads a symbol that is not a call.
Any other value declines, also a closed one (`Pi + 1`), since the names in a
stored expression have bindings of their own (an outer `a = 2` and `v := a + 1`
give 3 in the interpreter under a scope that declares `a = 10`). The program
lists the name in `captures` (`symbolDeps`), unless its binding is the
library's. A name with a value read in the body of a user function is that
value, as at the entry, when the innermost binding of the name is the definition
that the occurrence in the body reads (`resolvedValueDefinition()`): the
interpreter reads the binding of the body, which need not be the one of the name
where the call is compiled, and such a name declines (a function defined outside
a scope that declares `a` again). `compile()` runs a compilation in a scope
where each name of the bodies it calls has the binding of its occurrence
(`compilationScope()`), so through `compile()` that case compiles too, with the
body's value; a direct `compileSlice()` in the scope that declares the name
again declines. A name with no value there (an input, also one of `symbolic` or
`inputs`) is an input of the program (see "User functions"). `Pi` and
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

A product with a rational constant `p/q` whose denominator is not a power of two
(the canonical form of `x/49`, `29k/50`) is `(p · factors) / q`: a
multiplication by the integer `p` (a negation for `-1`), then the operation
`div.q` by the integer `q`, so a quotient that is an integer in exact arithmetic
is that integer under `Floor`, `Ceil`, `Round`, `Truncate`, `Mod` or a
comparison (`Floor(x/49)` at 49 is 1; the product by the double of `1/49` gave
0). `p` and the sign multiply the scalar factors first, so a list is passed over
once for the product and once for the division. The constant can be a free name
that holds it (`r49 = 1/49`), lowered and captured as any name that holds a
number. On JavaScript `div.q` is the division, which IEEE rounds correctly; on
GLSL, whose division need not be (SwiftShader and ANGLE on Metal compute a
division by a literal as the product by the float of its reciprocal), it is the
helper `_gpu_ir_quot`, which gives a quotient that is an integer or a half of
one exactly for a dividend below 2^23 in magnitude, where the test `m·q = 2a` is
exact. A tuple dividend takes the rule of `Divide` (`TUPLE_RULES`). A power of
two as the denominator (an exact test over the safe integers) keeps the product
by the double `p/q`, which is exact, and so do a complex factor and the `bigint`
mode (a rational declines there). The rule is the spelling of one product, with
no analysis of where the value is used: a sum of fractions that is an integer
only in exact arithmetic (`Floor(j/3 + n + 1/3)` at j = -46, n = -16) and a
comparison at a zero of a transcendental function (`0 < Sin(2π·s/P)` at s = 2, P
= -2) can still give another value than the interpreter.

The real functions (`Erf`, `Gamma`, `Root`, the inverse trigonometric and
hyperbolic functions, ...) are rows whose operation the JavaScript code calls by
name from `REAL_FUNCTIONS` (`_SYS.ir`), which the fold of the row calls too.
Each gives the interpreter's real value within the precision of a double (`Zeta`
below about -171 is a known limitation, `docs/COMPILATION-MODEL.md`); a pole is
±∞ and a value that is not real is NaN (`Root(-4, 2)`, `Arcsin(2)`).
`Log(x, 10)` is the row `Log`, a real `Log(x, 2)` the operation `log2` (both
exact at a power of the base, as the interpreter: `Floor(Log(1000, 10))` is 3),
and `Log(x, b)` of another base `Ln(x) / Ln(b)`. On GLSL the inverse
trigonometric and hyperbolic functions and the logarithms write NaN outside
their domain, and `tanh` (also in `Coth`) is ±1 for |x| > 20; `sqrt`, a division
and `mod` are the bare GLSL operations, whose result outside the domain is the
driver's (no NaN-safe helper is carried over: a user decision; Tycho's render
audit showed no picture change). The domains: `Ln` and `Log` (`log`, `log2`) of
an operand `<= 0` (the interpreter gives a complex value, or `-∞` at 0),
`Arcsin` and `Arccos` outside [-1, 1], `Arcosh` below 1, `Artanh` outside
(-1, 1) (also at ±1, where the interpreter gives ±∞); `Arctan2(y, x)` is
`atan(y, x)`, and 0 at (0, 0) as in the interpreter. `Root(x, n)` is the helper
`_gpu_ir_root`: 0 at x = 0 for a positive index, the real root of a negative
radicand for an odd integer index (`Root(-8, 3)` is -2), NaN for another index
of a negative radicand, where JavaScript gives the real root of an odd
denominator (`Root(-8, 2.5)` is 2.297...), as for `pow`. `Factorial` of an
integer is the helper `_gpu_ir_factorial` (a loop of 33 passes, +∞ for a
negative operand and over 34); of a real it declines (the Gamma function). `GCD`
of integers (`GCD(Round(a), Round(b))`) is `_gpu_ir_gcd` on `int`s. `Hypot` is
`length(vec2(x, y))`; `Arsinh` is `sign(x)·asinh(|x|)` (the builtin is wrong for
a large negative argument); `Sinh`, `Cosh`, `Tanh`, `Arctan` and the reciprocal
rows (`Sec`, `Csc`, `Coth`, `Sech`, `Csch`) are builtins or their reciprocals.
The other real functions (`Erf`, `Gamma`, `Zeta`, `Arccot`, `Arcsec`, ...)
decline there.

Inputs: a union whose every member is a real type (ranged or not), `nan` or an
infinity (`nan | real | signed_infinity`) is a real, also as the element of a
list: a double holds each of its values (a `NaN` or infinite value gives an
unspecified result). A union of one type and `nan` members has the lane of that
type (`integer | nan` is an integer, also in the `bigint` mode; `nan | number`
is a wide input, `complex | nan` a complex one). The same rule types the
parameters and the result of a user function, where a `missing` member is also
removed (`missing | rational` is a real): where the interpreter gives `Missing`,
the compiled code gives NaN. An input of the entry whose type is `unknown` or
`any` (no declaration, no entry of `inputs`, no type from its occurrences) is
refused, in every mode and on every target (`javascript`, `glsl`,
`interval-js`). `lower()` notes each name that it reads as an input of the
compilation (of the entry, lifted into a body, or a `vars` name), and those that
an occurrence or a declaration types (an occurrence takes the type of its
binding unit). A lowering that completes with a name that no occurrence types
throws an `UntypedInputs` with all such names, in the order the lowering reads
them (not always the order of the text: `Sum(w, Limits(k, v, u))` gives `v,u,w`,
the existing compiler `w,v,u`), which `sliceError()` turns into the
`untyped-input` decline of the existing compiler (`throwUntypedInputs()` of
`compile-admission.ts`: the same code, kind, message and `value`, the names
separated by commas). A decline of the lowering is reported as it is; a refusal
of the target after a completed lowering (recursion, a list of run-time length
on GLSL) comes after the refusal of the input. Until the end such an input is
read as a real. It is not `outside-profile`: with `fallback`, the interpreter
fallback names them in `unsupported`, and the statistics of the switch count it
`declined`. A name with a value, a local, an index, a parameter of a user
function and a parameter of a root function literal are not inputs: a parameter
of no declared type is a real, and one declared `any` or `value` declines, as an
argument of type `any` does. A name that only a branch dropped at compile time
reads is an input too (`If(2 < 3, 0, z)` with `z` undeclared is refused; the
existing compiler compiles it). A scalar of type `number` is a real in the
`strict` mode and a complex in the `complex` mode; a scalar `complex` input is
on the complex lane, and a number given for a complex input is lifted to
`{re, im: 0}`, also with `entryChecks: false`. A list of complex elements
declines: an entry of such a list can be a number or a `{re, im}` object (the
ABI of `docs/COMPILATION-MODEL.md`), and only a run-time test tells them apart.
An outer list of no stated length (`list<real>`, `vector`, `list<list<real^2>>`)
has a run-time length (JavaScript only), also as a parameter of a root function
literal: the length is a positional parameter before the list, read from the
argument. A list element of type `unknown` or `any` declines with the input's
name.

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
The result of `compile()` follows the result convention of every stored kernel
(`normalizeRunResult()`), in both modes: a complex value of imaginary part
exactly 0 is returned as the number, at the root and in the cells of a list;
another complex value is a `{re, im}` object. A program whose root is real
returns a number.

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

Inputs in the complex mode: an input of type `number` is complex
(`CompileMode`), so a comparison of it declines; an input declared `real` or
`integer` stays real. The strict mode reads such an input as a real.

Declined: `Max`, `Min`, `Floor` and the other integer rows of a complex, a
comparison other than `Equal` and `NotEqual`, the real functions (`Gamma`,
`Erf`, `Zeta`, ...) of a complex, a complex `Max` or `Min` reduction, and
`ComplexInfinity` as a literal; a real pole (`Gamma(-2)`) stays a real infinity.

On GLSL a complex value is a `vec2` (re, im): a scalar input declared `complex`
is a `vec2` parameter (`freeSymbolTypes[name].lowered` is `vec2`), a complex
result a `vec2`, a complex constant `vec2(re, im)`, a real read as a complex
`vec2(x, 0.0)`. `Add`, `Subtract`, `Negate`, `Real` (`z.x`), `Imaginary`
(`z.y`), `Conjugate`, `Abs` (`length`), `Equal` and `NotEqual` are the
operations of GLSL's vectors. The argument, of `Argument`, `Ln` and `Power`, is
the helper `_gpu_ir_carg`: on an axis it is written (π on the negative real
axis, ±π/2 on the imaginary axis, 0 at 0, as the interpreter), since a part that
`Negate`, `Conjugate` or a product makes -0 is ordinary, and a renderer's
`atan(y, x)` is wrong there (SwiftShader gives `atan(-0, 3)` as π). `Multiply`,
`Divide`, `Exp`, `Ln`, `Sqrt`, `Power` (a real or a complex exponent, as
`exp(b·ln a)`; an exponent that is an integer from 1 to 16 at run time is a
product, as `_gpu_ir_pow` on the real lane, so `z^2 + c` at `z = 0` is `c`),
`Sin`, `Cos`, `Tan`, `Sinh`, `Cosh` and `Tanh` are one helper each
(`_gpu_ir_cmul`, …), written only when used: the textbook formulas of the
principal branch, with no guard (no fidelity at a pole, a branch point or cut, a
signed zero, or on overflow of an intermediate such as `|b|^2` in a division).
`If`, `Which`, a local, a loop's carried value, a `Sum` or a `Product`, and a
parameter or the result of a user function hold a complex `vec2`. The other
complex rows decline with the operation they lack
(`Arcsin (the operation casin) on glsl`): the inverse trigonometric and
hyperbolic functions, `Root`, `Log`, `Cot`, `Sec`, `Csc`, `Coth`, `Sech`,
`Csch`; and so does a list or a tuple of complex numbers
(`a list of complex numbers`, `Profile.scalarLanes`), also an input one or the
result of a user function. `mode: 'complex'` is admitted: an input of type
`number` is then a `vec2`, and the result's `mode` is `'complex'`.

Ill-conditioned points (docs/plans/2026-11-12-js-route-course-correction.md,
rule 1): near a branch point, a pole or a cancellation the lane gives the
function's value at an argument within a few ulps of the given one, which can
differ from the interpreter by more than 1e-12 or be ±∞ or NaN where the
interpreter is finite (`Arctan(Ln(x))` at `x = 0` is NaN, the interpreter gives
`-π/2`; `Ln(x)·y` at `x = 0` is `-∞ + NaN·i`). On a branch cut the side follows
the sign of the zero part, IEEE style (`Argument(-Z)` at `Z = 0` is π), also for
a `-0` part of a complex input (no fidelity is owed at a signed zero).

## The colour lane

A fourth lane, `color`, holds a colour as the existing targets do, so a host
reads the result unchanged. On JavaScript a colour is the existing compiler's
object (`CompiledColor`: `{ space, c0, c1, c2, alpha }`), made by the members of
`_SYS` that the existing compiler calls: the constructors `Rgb`, `Hsl`, `Hsv`,
`Oklab`, `Oklch` (`_SYS.rgb`, …) give it in OKLCh, and the conversions `AsRgb`,
`AsHsl`, `AsHsv`, `AsOklab`, `AsOklch` (`_SYS.asRgb`, …) in the space they name;
every member reads the space that the object carries. On GLSL a colour is an
OKLCh `vec3`, as on the existing target: `Oklch(l, c, h)` is `vec3(l, c, h)`,
`Oklab` and `Rgb` convert their channels with the helpers `_gpu_ir_lch` and
`_gpu_ir_srgb_lab` (the interpreter's formulas: extended sRGB, with the sign
kept through the transfer function, no clamp and no gamut mapping), and
`AsOklch` is its operand. A `vec3` has no tag of its space, so `AsOklab`
(`_gpu_ir_lab`) and `AsRgb` (`_gpu_ir_lab_srgb(_gpu_ir_lab(…))`), which give the
channels of their space, are admitted only as the result of the program
(`Profile.resultOnly`), and only when the result position of the expression (the
root, or the last operand of a root `Block`) is that `AsOklab` or `AsRgb`
itself, so that a host reads the space from the expression
(`compileWithIrProfileGlsl()`): `AsOklab(Which(…, Oklch(…), …, Rgb(…)))`,
Tycho's form, and `Block(…, AsOklab(c))` compile; `AsOklab(AsRgb(c))`, a
conversion in an arm of an `If` or a `Which`, and a local that holds
`AsOklab(c)` and is the result (`Block(Declare(k, AsOklab(c)), k)`) decline on
GLSL, and so does a conversion in the body of a user function. `Hsv` and `Hsl`
convert their channels to sRGB with `_gpu_ir_hsv` and `_gpu_ir_hsl` (the hue in
degrees, wrapped; the other two channels clamped into [0, 1], as the interpreter
reads them), then as `Rgb`. `AsHsl` and `AsHsv` have no GLSL spelling and
decline there. No space is tracked at compile time and no code tests one.

The rows take three real channels (`Rgb(x, 0.4, 0.6)`) or one colour; a fourth
operand (alpha) declines on both targets (GLSL has no alpha channel, and a row
has at most three operands), and so does a list operand, which the interpreter
maps (`Rgb(List(1, 2), 0, 0)`). A conditional between colours joins on the lane
(`If`, `Which` with a `True` clause; with none, its value can be `Missing` and
it declines), and a `Block` local, also one that a `Loop` assigns, holds a
colour (a local declared with the type `color` declines; one of no stated type,
or `unknown`, holds it). A name whose value is a constructor of three numbers is
that colour (see the values of free names above). A user function may return a
colour, declared (`(real) -> color`, also through `Typed(…, 'color')` in the
body) or inferred from the body: an object on JavaScript, a `vec3` on GLSL.
Declined: a list of colours (`admits()`), a colour input, a colour string, a
tuple of components (`AsRgb((r, g, b))`), a parameter of a user function that is
a colour, arithmetic on a colour (an `error` of the canonical form), every other
colour operator (`ColorMix`, `ColorContrast`, …), and `mode: 'bigint'`. The
colour of non-finite channels follows the existing JavaScript runtime (its `NaN`
colour); on GLSL no fidelity is owed there (the existing target's
`_gpu_finite_color` check is not carried over). The hue of a colour whose two
chromatic components are 0 is 0 on both targets, as in the interpreter
(`_gpu_ir_lch` does not call `atan(0, 0)`, which GLSL leaves undefined). A
colour result has `broadcastOutputs` and `broadcast()` of the existing compiler
(one number per cell, `NaN`).

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
`Choose`, `GCD`, `LCM` (`bbinomial`, `bgcd`, `blcm`, rows of the integer lane
only), the
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
length of a build) and with `BigInt()` where it gives one (the length of an
array, `BigInt(L.length)`). The mode runs with the passes `fold`, `hoist` and
`invariants` off, also with `cse: false` or `constantFold: false`: a helper
throws at a pole (`Mod`, `At`, `Factorial`, `Power`, `Binomial`, and so a
call), so no operation is evaluated before it is written, `hoist` would move a
guarded arm out of its guard (`m != 0 ∧ Mod(n, m) = 1` at `m = 0` is `False`),
and `invariants` an operation out of a loop of no pass; the folds of the
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
spell them); `If` with no else of a number and `Which` with no `True` clause
(their value is `NaN`); `Max` and `Min` of a list (their identity is `±∞`); `Factorial2`
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

## The interval mode

`mode: 'interval'` (JavaScript only) computes every value as the `_IA` kernel
of the interval library (`src/compute-engine/interval/`) that encloses it: a
`real` or an `integer` is an `Interval` or an `IntervalResult`, a `boolean` a
verdict, `'true'`, `'false'` or `'maybe'`. It is not a lane of the IR: the
lowering is the one of the `strict` mode, and the printer is a third
`Syntax` (`JS_INTERVAL` of `print-interval.ts`), in which each operation is
the kernel of its row, with the operands in the order of the row's `fold`
(`atan2(y, x)`). Every kernel takes and gives the kinds `empty`, `entire`,
`singular` and `partial`, so the code never reads the kind of a value: the
marks of a jump and of a clipped domain travel through every operation. The
lanes are `real`, `integer` and `boolean`, a list or a tuple is a JavaScript
array of such values (of arrays for rank 2), and a recursive function declines (with an undecided guard both arms run, and the recursion
does not end). The passes `fold` (a double is not an enclosure) and
`strength` (`x·x` is wider than `x^2` over an interval) are off; two passes
of the mode run, `narrow` first and `plain` last.

Spelled: the arithmetic (`div.q` is `_IA.div`), `Power` (`pow`, also of
integers, is `_IA.powReal`; a power by the exact constant 2 is
`_IA.square`, the operation `square` that the lowering makes; a float
literal exponent below), `Root` (`_IA.nthRootInterval`), `Sqrt`, `Abs`, `Exp`,
`Ln`, `Log` of base 10 and 2, the trigonometric and hyperbolic functions
and their inverses (also the reciprocal ones), `Arctan2`, `Hypot`,
`Degrees` (the product by an enclosure of π, then the quotient by 180),
`Floor`, `Ceil`, `Round`, `Truncate`, `Fract`, `Sign`, `Mod`, `Max`, `Min`,
`Erf`, `Erfc`, `Gamma`, `GammaLn`, `Factorial`, `Factorial2`, `Binomial`
and `Choose` (also of real operands, `binomial.real`, a row of the mode),
`GCD`, `LCM`, the comparisons, `And`, `Or`, `Not` (Kleene logic on
verdicts), `If`, `Which`, a `Block` with locals, user functions that are
not recursive, `Sum` and `Product` with `Limits`, `Random()` and
`WithRandomSeed` of a number seed, a root function literal, and the lists
below, and integrals (below). `Haversine`, `Zeta` and the complex and
colour operations have no spelling and decline; a `Loop` declines with the cause "the interval mode does not
compile it yet" (`intervalRefusal()`; a cause of the mode ends with "on
interval-js"). A string seed and `Random` of a domain decline in the
lowering.

Lists. What the lowering makes of a list (sections "Lists" and "Tuples") is
printed with the spellings of the mode, and what it declines for JavaScript
stays declined (`Linspace`, `At` of a list of tuples that can be out of
range); `RandomChoice`, `RandomShuffle`, a `Zip` of lists of run-time
length and a comprehension of several clauses over a `Range` decline (a
length that is not one number); `ListJoin` and a comprehension of several
clauses over lists compile. A list literal
is the array of its elements; an element-wise operation is the kernel at
each index, a loop that fills an array (no `Array.from()`); a reduction is
the loop of the lowering (`Max()` of no element is `empty`); `build` (`Map`,
a comprehension, the elements of a `Range`) is a loop that fills an array,
with no deadline check; the `iterationBudget` does not count the elements
of a list, as on the JavaScript target, and a count of 2^32 or more, which
no array holds, throws the error of `_IA.decided()` before the first
element (`entire`). `filter` keeps an element whose verdict is
`'true'`, drops it for `'false'`, and for `'maybe'` throws the error of
`_IA.decided()`: the length of the result is not one number, and the
result is `entire`. `At` is `_IA.at(list, index)`, the interval extension
of the interpreter's rule: the hull of the elements that the integers of
the index select, `partial` when some select nothing, `empty` when none
does (`At(List(x, 2x, x^2), Floor(y) + 1)`). The pass `plain` writes an `At`
of a constant index in range of a stated length as `elem` (the `at` to
`elem` rewrites of `scalarize` and `fold` do not run in the mode: both
passes are off). A length is a plain integer of the bound 2^32: the length
parameter of an input or of a parameter of a user function, the length
result of a call, the count of a `filter`, and the count of a `Range`,
`_IA.rangeCount(lo, hi, step)`, the engine's `rangeCount()` on numbers,
which throws for a count of 2^32 or more; so are the index of a `build` and of a
`filter`, and the index of `elem` (`$0[$1]`). The operands of a `Range` go
through `number`: a bound that is not one integer in the box
(`Range(1, n)` of `n` in `[1, 5]`) gives `entire`; a `Range` of an operand
of a real type declines (its count over an interval is not one number in
general). A comparison of two plain integers (the test of `Max()` of no
element) is a verdict of numbers. A value whose length is not a plain
integer declines. An `if` of two list arms (of one length value, as the
lowering requires) joins element by element (`_IA.hull`). A list result,
also a root `Tuple`, is an array of kinded results; `ret` writes no copy,
because `run()` copies the inputs and the result and no kernel writes to an
operand. An input of a list or tuple type (`list<real>`, `list<real^3>`,
`tuple<real, real>`, `list<tuple<real, real>>`, `vector<integer^90001>`) is
an array of the inputs object, whose elements `run()` converts
(`processInput()`), and is named in `listInputs`, so that `broadcast()`
converts it once and shares it between the cells.

Decided comparisons. A pure node whose type is the value `true` or `false`
is that verdict, the rule of the existing interval target (`booleanClaim()`
of `compile-conditions.ts`): `(x + 1)^2 < 0` and `Equal(x, x)` of a real `x`
are `'false'` and `'true'`, and `x < y` is computed. A condition that is
such a verdict, or a constant, takes its arm in the lowering, and the other
arm is not lowered (`fold` is off in the mode).

Integrals. The region `integrate` (`Integrate` of one `Limits`,
`NIntegrate`) is `_IA.integrate((t) => { …; return y; }, a, b, n)`, the
enclosure of the existing interval target (`interval/integrate.ts`): `t`
is the interval of one of `n` pieces, the integrand is a region body of
the mode, and the bounds are intervals. `n` is the count of the existing
target for the same expression (`intervalQuadratureSize()` of
`compilation/interval-quadrature.ts`): the lowering measures it at the
outermost integral of a body, from the `Integrate` nodes of its subtree,
and every integral in its bounds and its integrand takes it
(`Instr.pieces`; an `NIntegrate` node is a level in the mode, not on the
existing target, which does not compile it); an integral in a user function has the count of its own
subtree, and the library's run-time budget bounds the integrals nested
through calls. A count under 4 declines with the reason of the existing
target. A part of the integrand that does not read the variable and whose
heads are all pure rows of the library (no reduction, loop, call,
conditional or integral, which could throw or run where the integrand
would not), found through the operands of rows and of calls, is
lowered once before the region (the memo of `value()` reads it there), as
the existing target computes the invariants of an integrand once; unlike a
value that reads no input, which the printer computes once per artifact,
such a part can read an input and is computed once per call.

The closed form is the existing target's rule: the engine's antiderivative
(`intervalClosedForm()`, which calls `closedFormIntegral()` of the shared
layer of the old compilers, under the antiderivative budget of the
compilation and with no fold of a `vars` name that holds a value; none
with an angular unit other than radians, because that function reads
operands written in radians and the lowering scales the closed form
again, where an indefinite integral declines with that reason; none when
the operands reach an `NIntegrate`, directly or through the value of a
symbol or the body of a user function, which the engine would evaluate by
quadrature to a number that the closed form holds as exact). A
definite integral with a closed form has a second region, of no parameter,
whose yield is the closed form, and is printed as
`_IA.integrateClosed(() => closed, f, a, b, n)`: the library gives the
closed form when its scan of the integrand finds no pole, gap or
unbounded stretch (`∫ dt/t²` from −1 to 1 closes to −2 and is `singular`),
and with an infinite bound, and the enclosure otherwise. A closed form
that the lowering declines (`SinIntegral`, `FresnelS`: no row), that is not
real, or that holds a loop or a call (a function lowered in a discarded
region would stay defined) is not lowered, and one that the mode does not
print is removed before `admits()` (`dropClosedForms()`): the enclosure,
of the same `n`, stands alone. The reads of `vars` entries in a closed form
are not counted as effects (in the mode they read the inputs object). An
indefinite integral (no bounds, or a bound `Nothing`) is its closed form,
and declines with none; its variable is then an input of the closed form,
of the type that the closed form's use of it gives (`Integrate(x^2, x)` of
an undeclared `x` compiles as `x^3/3` does, where the existing target,
whose walk sees `x` as bound, refuses it as an input with no type). `compileWithIrProfileInterval()` resets the budget
of the antiderivatives at its entry, so a public compilation with the
shadow measure or with `fallback` can search twice for one integral, once
per target; a search that timed out is recorded, and the second one ends
at once. What the lowering declines on every target stays declined:
several `Limits`, an integrand of several variables, an integrand that is
not real, and an integrand with an effect (a read of a `vars` entry is
one).

Conditionals. An `if` is printed with each arm once (`Syntax.verdictIf`):
the condition is bound to a name, the first arm runs unless it is
`'false'`, the second unless it is `'true'`, and each result is the first
arm's value for `'true'`, the second's for `'false'`, and
`_IA.hull(a, b)` for `'maybe'`. The text is linear in the program. The
missing arm of `If(c, a)` or of a `Which` with no `True` clause is the NaN
constant, `empty`, so the join for `'maybe'` is `partial`. A local
assigned in both arms of an undecided `If` holds the hull of both values.
The pass `narrow` (`narrow.ts`): for an `if` whose condition is one `lt`,
`le`, `gt` or `ge` of a value `v` and a constant `c`, the arm where
`v ≥ c` holds reads `_IA.atLeast(v, c)` in place of `v`, the arm where
`v ≤ c` holds `_IA.atMost(v, c)` (a strict comparison takes the closed
bound); `If(x > 0, Sqrt(x), -x)` over `[-1, 1]` is `[0, 1]`. The two
kernels (`interval/comparison.ts`, the operations `atleast` and `atmost`
of the mode) are clamps: `atLeast` raises the lower end of `v` to the
lower end of `c`, `atMost` lowers the upper end to the upper end of `c`,
with no outward step (a clamp computes no new real number), keeping the
kind and the marks of `v` (`partial` and its clip, a jump's `at` and
`continuity`). They return `v` itself, with no allocation, when nothing
changes (every decided condition), and also for a value with no ends to
clamp (`empty`, `entire`, a pole, a NaN bound), for a `c` without finite
ends, and when the clamp would leave no point (the arm cannot be taken):
not narrowing is always sound. `Random()` is
the constant `{ lo: 0, hi: 1 }`, the support of a draw, and a random frame
is its body: the mode draws nothing and gives no `seeded-draw-order`
warning, so two evaluated arms are sound.

Integers and loops. The pass `plain` (`plain.ts`) makes a plain integer a
JavaScript number: an integer constant, the index of a loop, or
`add.int`, `sub.int`, `neg.int`, `mul.int` of plain integers whose static
bound of magnitude (the constant, 2^32 or the bound of a loop for an index,
the sum or the product of the bounds) is below 2^53. Its operations are
spelled as in JavaScript (`add.num`, `($0 + $1)`); a plain constant is a
twin literal marked `plain` (`Literal.plain`). Where an interval operation,
an `if` result or a function result reads a plain integer, the pass adds
`point` (`{ lo: n, hi: n }`); where a loop reads an interval as a bound, it
adds `number` (`_IA.number(x)`: the number of a point that is an integer of
magnitude at most 2^32, else a throw of the error of `_IA.decided()`, which
`run()` and `broadcast()` answer with `entire`, and which `broadcast()`
does not count as a failure). A scalar `pow` whose exponent is plain is
`_IA.pow($0, n)` with a number exponent (`x^3` is `_IA.pow(_.x, 3)`); a
list power is `_IA.powReal` of each element; a power by the constant 2 stays `_IA.square`. Every other integer is an
interval: `Floor(x) + 1` is `_IA.add(_IA.floor(_.x), { lo: 1, hi: 1 })`.
So the bounds and the index of every loop are numbers, and no code tests a
representation. A bound that is an interval (a slider `n` given as
`[2, 4]`, a `Floor(n)` that jumps in the box) gives `entire` at run time.
A loop writes no deadline check, and the lowering writes no NaN test of the
`iterationBudget` (NaN reads as `empty`): a loop of more passes than the
budget (2^32 without one) throws the error of `_IA.decided()` before its
first pass (`_IA.undecided()`), so the result is `entire`; so does a
`build` or a `filter` of more elements, before its first element. A sum is
a loop from the lower bound up, so that its result contains the value that
the scalar code computes by adding upward in doubles (each `_IA.add` rounds
outward). The existing target writes a sum of constant bounds out and adds
from the last term: narrower (4.5 times for `Sum(x/i, i = 1..100)` at
`x = -1.623107644263655`), but it misses that value at some points: at 169
of 100,000 random points for `Sum(sin(i·x)/i, i = 1..100)` (by up to 5 ulps)
and at 700 for `Sum(x^i/i, i = 1..20)` (by up to 4 ulps).

Constants. An integer and a real literal whose double is its value are a
point `{ lo: c, hi: c }`; NaN is `{ kind: 'empty' }`; a boolean is `'true'`
or `'false'`. A real literal whose double is not its value is marked
`inexact` in the IR (`Literal.inexact`, the count of ulps; `literalKey()`
tells it from the unmarked literal of the same double) and printed as the
enclosure of that many ulps on each side, computed when the code is
printed. The double is the value for a number that is not exact (a machine
number or a decimal: `0.1`, `1.8`, as in the JavaScript code: the precision
of the target), so the interpreter at the default precision, which
computes with the decimal, can differ: at `x` the double of 1.8,
`Ceil(x - 1.8)` is 0 in the mode, on the existing target and in the
interpreter at machine precision, and 1 in the interpreter at the default
precision (`x - 1.8` is about 4.4e-17 there); and for an exact number that
is a double
(`exactDoubleValue()`: `1/2`, `5`); another exact number takes one ulp per
rounding of its double (`exactValueDoubleRoundings()`: `1/3` is
`[0.33333333333333326, 0.33333333333333337]`). `Pi` and `ExponentialE` take
one ulp, and so does every other constant of the library whose value is
not exact (`EulerGamma`, `CatalanConstant`: the engine holds the double
nearest to a number that is not a double; `MachineEpsilon` too, though it
is `2^-52`), while a decimal that a name of the program holds is its
double; the factor of an angular unit takes two. A closed node is the value of
`evaluate()` when it is an exact number that is a double, or a safe integer
computed in big decimals (`Mod(1, 1/10)` is 0, `Floor(100π)` is 314); else
the value of `N()` with one ulp (`Sin(1)`), when `N()` computes in big
decimals of more than the 17 digits of a double (the engine's precision and
the process-global `BigDecimal.precision` both at least 18); else, at
machine precision, the node is lowered as written and the kernels enclose
it at run time.

`Power(x, p/q)` with a literal rational exponent, `q > 1`, is lowered as
`Root(x, q)^p`, for any sign of `p`: `x^(2/3)` over `[-8, -1]` is `[1, 4]`.
A float literal exponent that is not an integer is its double `e`, read
when the program is lowered as the interpreter reads it
(`realPowerBranchTerms()`), which takes only the sign from the reading:
over a base that can be negative, a rational `p/q` of odd `q` is
`pow.branch` (`pow.branch.even` for an even `p`), the real root `±|x|^e`
with the double, `_IA.powRealBranch` (`x^0.2`, `x^2.2`,
`x^0.6000000000000001`); any other float, and every float over a base that
the lowering proves non-negative from its operations and constants
(`nonnegative()`: `Abs(x - 1)^0.2`; not from the type, an assumption or a
value of an input, which the code does not keep), is `pow.principal`, `_IA.pow`
of the double as on the existing target, which has no value over a
negative base (`x^1.5`, `x^3.87`). The existing target computes
`x^(p/q)` with `_IA.powRational` where `e` is the double of `p/q`: at
`x = 1e300`, `x^0.2` is `1.0000000000000077e60` in the mode and in the
interpreter at machine precision, and `[9.999999999999998e59,
1.0000000000000001e60]` there. An
exponent known at run time is `_IA.powReal(x, e, digits)`, which applies
the same reading when `e` is a point that is not an integer (and keeps the
last reading, so a plot with one exponent reads it once), and is
`_IA.powInterval` otherwise; `digits` is `realPowerReconstructionDigits()`
when the code is printed, written in the code, so that stored code reads
the exponent as the engine that compiled it.

Values computed once (`computedOnce()` of `print-interval.ts`). A value
that depends on no input, parameter, loop index or draw is computed when
the code is loaded, in `preambleOnce`, and read by its name: a constant that
is not a number or a verdict and that code run at each call reads (a
constant read only by such values is written in their text); a pure
operation or a list of such values, in any function and any region (no
kernel throws, except `_IA.rangeCount()`, which is not moved); and an
operation that can fail (`_IA.number`) or a call of a function that has no
effect and is not on a cycle, of such values, only at a top level that runs
at every call: the top level of the entry, and of a function that such a
top level calls (`b(3π)` in the body of `w`, called as `w(x)`). Nothing
that draws or has an effect is moved. The values follow the functions,
those of a function before those of its callers. Those that cannot throw
and run no loop are computed in `preambleOnce`, when the code is loaded.
The others (an operation that can fail, a call, and what is computed from
them) are computed at the first call of the loaded code, in a `try` of
`preamblePerCall`, so `compile()` and a load run no loop of the program;
each later call tests a flag, `_once`, and throws again the error of the
first call if there was one: `run()` and `broadcast()` then answer
`entire`, as when the value is computed at the call (a `Sum` over the
`iterationBudget` in `b`). Each load (`run()`, `broadcast()`, a stored copy
on a worker) computes them once. A value computed once is shared by every
call: no kernel writes to an operand (a widened result
is written only into a wrapper that the kernel made, `rounding.ts`), and
`run()` copies its result (`freshIntervalValue()`), so a change of a
returned value does not change the next result.

The result has the stored form of the existing interval target
(`StoredIntervalJavaScript`): `code`, an expression of the inputs object
`_` (the expression itself for a body of one `return`), or for a root
function literal the function of its arguments; `preambleOnce`, the user
functions and the values computed at the load; `preamblePerCall`, the
values computed at the first call, when there are some; `runtimeVersion` (`INTERVAL_RUNTIME_VERSION`). The code reads
`_IA` only. `run()` is `createIntervalRuntime().load()` of the stored form,
so `run()` and stored code loaded on a worker agree by construction: an
input given as a number is a point, a boolean is a verdict, and the result
is a kinded `IntervalResult` or a verdict, never a bare `{ lo, hi }`; an
error of the code other than a `ReferenceError` or a cancellation is
`entire`.

`compile(expr, { to: 'interval-js', profile: 'ir' })` compiles with the mode
(`adapter-interval.ts`). A decline is `'outside-profile'`; with `fallback`
not `false`, the existing interval target then compiles the expression and
a warning is logged. The result has `target: 'interval-js'`, `success`,
`runtimeVersion`, `code`, `preambleOnce`, `preamblePerCall` when there is
one, `preamble` (the two, in that order),
`calling` (`'expression'`, or `'lambda'` for a root `Function` literal,
which declines when its body reads a free name), `booleanInputs`,
`listInputs`, `run`,
`profile: 'ir'`, and for an expression `broadcast()`, `broadcastAsync()`,
`shippable` and `willUsePool()`, built by `createIntervalRuntime()`
(`loadBroadcast()`, `loadBroadcastSlice()`) over the stored result. Options:
`inputs`, `symbolic`, `symbolDeps`, `varsObjectRefs` and `cse: false` as on
JavaScript; `constantFold: false`, no closed node evaluated; `vars` only for
a text that reads the inputs object (`readsVarsObject()`: `_.c`, read at
each use), another text declines; a `mode` other than `'strict'`,
`functions`, `operators`, `imports`, `preamble` and `strictTypes: true`
decline by name; `entryChecks`, `storage`, `broadcast` and `quadrature`
have no effect; `iterationBudget` limits the passes of each `Sum` and
`Product` (above).

## Lists

A length is a number or an integer SSA value: the length of an input is a
parameter before it, the count of a `Filter` and of a `Range` an instruction.
Two lists with the same length value have one length (`D + Map(f, D)`,
`Range(1, n) + Range(1, n)`, after `cse`); the verifier checks that a length
value is visible where a type names it. `elem` reads an element from 0; `At` is
the interpreter's rule (from 1, from the end when negative, NaN outside; on GLSL
a conditional that reads the element only in range, with the length as a
literal, `$#0` in the spelling), and the fold turns an `At` of a constant index
in range into an `elem`. A boolean or nested list that can be out of range
declines. `build` and `filter` are region rows. A `Length`, a reduction, a `Map`
or a `Filter` of a `Range` reads its count and the arithmetic of its elements,
so `Length(Range(1, n))` makes no list. On GLSL, which has no build, a `Map`
(and a one-clause `Comprehension`) over a source of a constant length of 1 to 64
(`SCALARIZE_LIMIT`) is the list of its elements, the body lowered once per
element in order: a `vecN` or a `float[n]` (`Map(f, L)` of `L: list<real^3>`,
`Map(f, List(a, b, c))`). The elements of such builds in one program are at most
4,096; past that, a `Filter`, a `Range` and a list of a run-time length, the
build declines on GLSL. `Max` and `Min` fold from -∞ and +∞ over all their
operands, and give NaN when the total count of elements and scalars is 0;
`Max(x)` and `Min(x)` of one real or integer scalar are `x` (of a boolean or a
complex number they decline: the interpreter leaves them unevaluated). A
reduction (`Sum`, `Max`, `Min`) of one literal `List` of at least one element,
each of a number type, is the reduction of its elements, with no array and no
loop: `Max(List(x, y, x·y))` is `Max(x, y, x·y)`, and `Sum(List(a, b))` is
`(0 + a) + b`, the fold of the loop (`Product(List(…))` is `Reduce` in the
canonical form and keeps the loop);
`ElementMax` and `ElementMin` are rows that thread (`ElementMax(D, 0.3)` is a
list). An element-wise operation of lists of rank 1 has the length of its first
list and reads the others at the same index. Lengths that are numbers and differ
decline (`List(1, 2, 3)·D + List(4, 5)`); a length that is a value fits any
length, also one that happens to be a constant (the count of `Range(1, 2)`).
When the lengths differ, the result is unspecified: with `D` and `E` of two
lengths, `D + E` is an error of the interpreter that the static type
(`list<real>`) does not show, and the compiled value is a list as long as `D`,
NaN where `E` has no element; `Range(1, 2) + List(1, 2, 3)` gives `[2, 4]`.
Lists of rank 2 or more whose lengths are not one length value decline (`Q + R`
of two inputs of type `list<list<real^2>>`). A `Multiply` of a list of rank 2 or
more (a matrix) with another list, and a `Power` of such a base, decline: the
interpreter's value is the matrix product or power (`M·N`, `M·L`, `M^s` at an
integer `s`), measured for every pair of a scalar, a list, a matrix, a vector
and a point; `M^N` and `M^0.5`, element by element in the interpreter, decline
too (the simple rule). A matrix times scalars, and the other operations of two
matrices of one shape, are element by element, as in the interpreter. The
operands of a `Range` are reals or integers: its elements are `lo + k·step` for
`k` from 0, of the count of `rangeCount`, the interpreter's (`Range(1, N)` at
`N = 3.5` is `[1, 2, 3]`, `Range(-h, h)` at `h = 2.5` is
`[-2.5, -1.5, …, 2.5]`), integers when the first element and the step are. GLSL
has no spelling of a run-time count. Whether a list result can hold an input is
read from the rows (`alias`): such a result is returned as a copy.

`Comprehension(body, Element(i, L))` is a build of `body` over the source of `L`
(a list, a `Range`); with a condition, `Element(i, L, cond)`, it is a `filter`
of `L` by `cond`, then a build of `body` over the elements kept. The
interpreter's list is lazy: it evaluates the condition and the body of an
element only when the element is read (`Length` reads none), so a condition or a
body with an effect declines (`Length(Comprehension(Random(), Element(z, D)))`
draws nothing in the interpreter). Two clauses or more, `Element(i, L)` each,
are the interpreter's flat list over the Cartesian product, the last index the
fastest (`Comprehension(10k + j, Element(k, Range(1, 2)), Element(j, Range(1,
3)))` is `[11, 12, 13, 21, 22, 23]`): one build over the product of the
lengths, whose index `k` gives the index of clause `j` as
`Floor(k / s_j) mod n_j`, with `s_j` the product of the lengths after it. A
clause whose list reads an earlier index (`Element(j, Range(1, k))`), a
clause with a condition, and an effect in a clause list or in the body
decline (the interpreter evaluates a list once for each element of the
clauses before it).

`ListJoin(L1, …, Ln)` of lists and scalars (a scalar is an element) is a build
over the sum of the lengths, whose element at `k` is read from the first list
whose end is after `k` (a chain of `n − 1` tests per element); its lists are of
numbers, or all of points. On GLSL it declines (a build).

`RandomShuffle(L)` of a list of numbers is `_SYS.shuffle`, and
`RandomChoice(Interval(0, 1), n)` (either end open or closed) is the region
`choice`, `_SYS.randomChoice`, whose results are the count and the list: the
members of the existing compiler, so the draws, their count and their order are
the interpreter's (a count that is not one in 0..10^6 after `Math.round()`
throws there; the interpreter gives an error). Each is one draw site
("Effects"). `RandomChoice` of another domain, and `RandomShuffle` of a tuple,
of a list of points or of booleans, decline; GLSL has neither.

`Binomial(n, k)` and `Choose(n, k)` of integers are `_SYS.binomial` on
JavaScript (exact below 2^53, the interpreter's value for every pair of
integers: `Choose(5, 7)` is 0, `Choose(-3, 2)` is 6); a real operand declines,
and GLSL has no spelling.

## Tuples

A `Tuple` is a list of fixed length in the representation, with no type of its
own: a tuple of scalars of one lane (an integer among reals is widened; a
boolean among numbers declines) is the list of its elements, an array on
JavaScript (`Tuple(Cos(t), Sin(t))` is `[0.54, 0.84]` at `t = 1`). On GLSL a
list of 2 to 4 elements, a tuple or not, is a `vec2`, `vec3` or `vec4` (`bvec2`,
... for booleans; `vec2(cos(t), sin(t))`), and another length a `float[n]`. A
tuple of lists is a list of rows (`Tuple(L)` of a list of stated length); a
tuple of tuples declines. `PointList` with no list component is the tuple of its
components; with list components it is the list of the tuples of their elements
at each index, a scalar component in every tuple, as long as the shortest
component, as in the interpreter: a stated length, one length value
(`PointList(D, Map(f, D))`), or the `Min` of the lengths at run time
(`PointList(A1, A2, A3)` of three inputs of type `list<real>`). `Zip(A, B, …)`
of lists of numbers is that value, as in the interpreter (a list of tuples as
long as the shortest list), and is lowered as `PointList`; a list with an
effect declines (the interpreter reads the lists up to the shortest). A list of
tuples, a build of tuples (`Comprehension(Tuple(f(k), g(k)), Element(k, R))`)
and the element of a list of tuples are tuples at their axis.

The lowering keeps the set of the values that are tuples (`Lowering.tuples`,
with the axis of the tuple in the shape), and an operator reads a tuple only
where its value on a tuple is its value on the list of the same elements, as
probed in the interpreter (`TUPLE_RULES`): a threading row of one operand other
than `Abs` (`Sin(Tuple(1, 2))`), `Power`, `Mod`, `Root` and `Arctan2` element by
element; `Add` of tuples only (a difference is an `Add` of a negated tuple);
`Multiply` of one tuple and scalars (`2·Tuple(x, 1)`) and `Divide` of a tuple by
a scalar; `At`; and `Length`, `Sum`, `Max` and `Min`. A product or a quotient of
two points, and a point plus a scalar or a list of numbers, are errors of the
canonical form, and decline. `Abs` of a tuple of real or integer numbers is its
Euclidean norm (`Abs(Tuple(3, 4))` is 5), the square root of the sum of the
squares of its elements on both targets (`sqrt((u * u) + (v * v))`; no guard
against the overflow of a square); of a tuple of complex numbers it declines.
`Distance(a, b)` of two tuples is `Abs(a + -b)`; of tuples of two lengths, or of
a list of numbers, it declines. A list of points is read point by point, by a
build over it (JavaScript; GLSL has no list of points): under `Abs` and
`PointX`, and under `Add` with a point, which the interpreter adds to each point
of the list (`P + List(Tuple(1, 2), Tuple(3, 4))`), so `Distance(P, L)` of a
list `L` of points is the list of the distances, and `Distance(L, M)` of two
lists of points the list of the distances pair by pair (lists of two lengths
decline); and under `Multiply` and `Divide` with a list of numbers of its length
(one length value), whose element scales the point of the same index
(`(M − P) / D`, as the interpreter gives it). `PointX`, `PointY` and `PointZ` of
a tuple of scalars are `At` of index 1, 2 and 3 (`PointZ` of a point of 2
coordinates is an `incompatible-dimensions` error of the canonical form, and
declines); of a list of points, the list of those coordinates; of a list of
numbers, they decline. Any other reader declines a tuple operand:
`Equal(Tuple(1, 2), List(1, 2))` is `False`, a comparison of a tuple stays
unevaluated, `Map`, `Filter`, `Reduce`, `Loop` and `Comprehension` over a tuple,
and the arms of a conditional of which one is a tuple and the other a list. The
positions that hold a value (the root, an element of a `List` or a `Tuple`, the
result of a `Block`, an arm of `If` or `Which`, a build body, a random frame)
keep it. The missing arm of an `If` whose arm is a tuple of numbers is the tuple
of NaN of its length, as the interpreter gives
(`If(t ≤ W, Tuple(Cos(t), Sin(t)))` at `t > W` is `(NaN, NaN)`); a list arm, a
boolean tuple and a `Which` with no `True` clause decline, as the interpreter
gives `Missing` there. The missing arm of an `If` whose arm is a boolean of
static type `boolean` is `False`, as in the interpreter (`maskedValue()`):
`If(0 < x, 0 < y)` at `x = -1` is `False`. A tuple result of the root has `broadcastOutputs` of its
type (`broadcastStrideOfType()`), so a batch with `outputs` gives its elements
per cell. An input of a tuple type of scalars of one lane (`tuple<real, real>`;
an integer among reals is a real) is the list of its elements, marked a tuple,
so the rule above reads it: on JavaScript its value is the array of its elements
(`P: [1, 2]`), on GLSL a `vecN`; so is a parameter of a user function declared
such a tuple (see "User functions"). A union of tuples of one length is the
tuple of the lanes at each position
(`tuple<integer, real> | tuple<real, integer>` is a point of two reals, a `vec2`
on GLSL). A tuple of booleans and numbers declines.

An input that is a list of such tuples of real or integer numbers (a list of
points: `list<tuple<real, real>>`, `list<tuple<integer, real, real>^6>`,
extended-real elements `nan | real | signed_infinity` as for a scalar) is a list
of rank 2 marked a tuple on its inner axis, the value that `PointList` of lists
makes, of a stated or a run-time length: on JavaScript an array of arrays
(`P: [[1, 2], [3, 4]]`); GLSL declines it (a list of rank 2). The entry check
reads the outer value only, as for any list input: a string and a typed array
throw; a row of another length, or a value that is not an array, gives an
unspecified result. `At` of it with a constant index in range of a stated length
is a point; another index declines (the interpreter gives a tuple of NaN out of
range). A list of tuples of other elements, or of tuples of two lengths,
declines.

## Effects

`pure` (merged, removed, moved, folded, evaluated where it was not written),
`may-fail` (removed when unused; shared by the lowering with an evaluation of
the same or an equal node that dominates it, and by `cse` for a call; nothing
else), `effectful` (keeps its place, count and order). The effect of a user
function
is the least fixed point over
its calls, from `pure`, and from `may-fail` for a function on a cycle of calls:
a recursive function may not terminate, so it and its callers are at least
`may-fail`, and a guarded recursive call is not evaluated before its guard. A
node is memoised by the effect of what it emitted: a node whose lowering emitted
an effectful instruction is lowered again at each use; a `may-fail` lowering (a
loop, a build, a call of a recursive function) is shared, because the evaluation
that dominates the use fails first if it fails. So the budget counts the passes
that run, and a `Loop` whose carried values are not read is removed and counts
none. The memo is keyed by the structure of a node: the operator, the definition
that a name or a head resolves to, the kind and value of a number and the
operands, so a sub-expression that the source writes several times as separate
nodes is lowered once per region; a node of another kind is equal only to
itself. The operands of `And`, `Or` and a chain are lowered lazily, in arms; the
`hoist` pass makes a speculatable arm a plain `and` or `or`. After each pass a
check compares the sequence of effectful instructions (operation, operands,
results and region); the same check runs over the printer's order.

The pass `cse` merges an instruction with an earlier one of the same operation
and operands whose value is visible (written before it in its region or in a
region around it, not in an arm or a loop body that has ended): a `pure`
operation, and a call of a user function that is not `effectful` and not on a
cycle of calls, with each of its results (a list and its length). A `may-fail`
call is merged because the visible call failed if the second would. So
`a_1(x) = g(a_0(x), a_0(x), …)` calls `a_0` once, and a chain of such functions
runs in a time proportional to its length. A function that draws, directly or
through a call, is `effectful` and is called each time.

The pass `invariants` computes once, before the loop, an instruction at the top
level of the body of a `loop`, a `build` or a `filter` that reads no parameter
of the body (the index, a carried value) and no value of the body that stays,
decided in the order of the body, the inner loops first; an inner loop, a build
or an `if` moves as a whole, and an instruction in an arm of the body stays. A
`pure` instruction moves out of every loop, unless it holds a call or an
operation that the pass `plain` of the interval mode makes throw: a `rangecount`
(`_IA.rangeCount()`), and a `rangestep` or an `elem` whose index is not a
constant or a loop index (`_IA.number()` of an interval that is not a point). A
`may-fail` instruction, or a call of a function that is not `effectful` and not
on a cycle of calls, moves only out of a loop of constant bounds, or a build of
a constant length, of at least one pass, which is not a `Loop` (a `loop` with
`passes`), and only when no effectful instruction of the body is before it: if
it fails before the loop, it failed in the first pass. Out of a loop of a
run-time count, a build with a pure body over the elements of a list that exists
(a parameter, the result of a call or of a `filter`, or the shortest of such
lists, the length of `PointList(A, B)`) moves too, and so does a loop over them,
except in the interval mode with an `iterationBudget` below 2^32, whose limit
refuses a loop over a list longer than the budget (the option `listLoops`); a
`filter` does not (it throws for an undecided condition in the interval mode).
Such a build or loop runs once where the program ran it no time, no longer than
the list took to make; on JavaScript its passes then tick the deadline. So in
`Sum(Max(Max(L), k), Limits(k, 1, n))` the loop of `Max(L)` runs once, also at
`n = 0`, and a call in the loop of `Sum(f(x)·k, Limits(k, 1, n))` stays there,
so that a loop of no pass runs no call. In Tycho's `voronoi-diagram`, the loop
of `B` (`Sum(…, k = 1..16)`) called `F(x, y)`, `v(x, y)` and `u(x, y)` at each
pass; they are called once. A moved call counts the passes of its `Loop`s once
(`iterationBudget`): `Sum(f(x)·k, Limits(k, 1, 3))`, whose `f` runs a `Loop` of
100 passes, gives its value under a budget of 150, where it threw. Nothing
effectful moves, so the draws of a seeded
frame and its warnings do not change. The `bigint` mode does not run the pass.

A `WithRandomSeed` frame whose body has one draw site evaluated once (not under
a loop, a `Map`, `Filter`, `Sum` or `Product` body, or a call of an effectful
function) gives the interpreter's draws bit for bit: its draws start at index 0
on entry of the frame. Any other frame compiles, in the compiler's order,
deterministically, and the result carries a warning `seeded-draw-order` that
names the frame and why. A draw site is a `Random()`, a `RandomShuffle` or a
`RandomChoice` (an effectful operation, or an effectful region row). A draw is
the engine's own (`makeRandomHelpers()` over the engine's frame slot): a
compiled draw reads the frame it runs in. A list of run-time length made in a
frame (`WithRandomSeed(s, RandomChoice(…, n))`) has its length as a result of
the frame too.

## Loops and the runtime

On JavaScript the code reads the runtime `_SYS` of the existing compiler
(`makeSysHelpers()` of `javascript-runtime.ts`): the functions of the folds are
its member `ir` (`IR_FUNCTIONS`: `REAL_FUNCTIONS`, `COMPLEX_FUNCTIONS`, `pow`,
`mod`), under one name so that no IR name meets a member of another meaning; a
draw, a random frame, an integral and the length of a `Range` are its members
`drawNextRandomNumber`, `withRandomSeed`, `irIntegrate` (which reads the
engine's live draw, as `integrate` does) and `rangeCount`. A loop counts its
passes from 0 and computes its index as `lo + i`, so it ends for any bounds
(from 2^53, `k++` would not advance; the value there is unspecified); a `bigint`
index is exact. A build is an array of its length filled by a `for` loop in
index order (a `Filter` pushes), and a chain of element-wise operations of one
shape, each value read once and pure, is one such loop (`2·L + 1`). A build of
more than about 2^25 elements is slower: V8 keeps such a `new Array(n)` as a
dictionary. A loop or a build adds its passes to the deadline count of the
runtime with `_SYS.tick(n)`: it runs its passes in blocks of at most 1024, an
inner `for` in an outer one whose update adds the passes of the block, so no
pass makes a call and a nest of short loops counts every pass. The count is on
the deadline frame (on the runtime when the deadline is a number), so it holds
across calls and re-entrant calls, and the steps charged to a step budget do not
depend on calls made before the frame; it is kept modulo 1024. Each time it
crosses a multiple of 1024 (once for a call of more than 1024 passes), `tick`
checks the deadline (`ce.withTimeLimit()`, or the `deadline` of a runtime
without an engine) and charges one step. `_SYS.tick()` with no argument counts
one pass, the spelling of code stored before. A block left by a throw is not
counted. The `iterationBudget` option follows the rule of `compile()`
(`CompilationOptions.iterationBudget`): a pass of a `Loop` (a `loop` instruction
with `passes`) also calls `_SYS.countLoopPass(budget)`, which adds one to one
count for a call, nested loops and the loops of user functions included; over
the budget, the call throws a `CancellationError` with the cause
`iteration-limit-exceeded` (`docs/COMPILATION-MODEL.md`, "A limit on `Loop`
passes"). A bound of a `Sum` or a `Product` with `Limits` of a real type is its
`Floor`, as the interpreter counts (`normalizeIndexingSet()`):
`Sum(k, Limits(k, 0.5, 3.7))` is 0 + 1 + 2 + 3, and `Limits(k, 1, -0.5)` is
empty (the identity); a complex bound declines, and in the `bigint` mode a real
one, and so does a bound that is a constant infinity or NaN (the interpreter
sums a window of an infinite range: `Sum(x^k/k!, Limits(k, 0, +∞))`), or a
constant beyond 2^53 − 1 in magnitude in the number modes (the interpreter gives
`out-of-range` for such a bound of a range that is not empty); the `bigint` mode
counts such bounds exactly. An operand of a `Range` that is a constant infinity
or NaN declines too. A bound that assigns a name declared outside it
(`Limits(i, 1, Block(p := 4, 2))`) declines: the interpreter does not evaluate a
`Sum` or a `Product` over a bound with an effect, and `p` keeps its value (rule
R3 of `docs/COMPILATION-MODEL.md`). The count is in the runtime; the entry
starts with `_SYS.resetLoopPasses()` when the code counts passes. A `Sum` or a
`Product` with `Limits` whose count of passes is more than the budget is NaN
(`hi - lo < budget` is false), each loop by its own count: the lowering writes
that test as an `if`. A `Loop` in an integrand counts its passes once per sample
of the quadrature, whose number of samples is unspecified. A build, a `Filter`
and a reduction of a list count no pass. GLSL has no deadline and counts no
`Loop` pass at run time: its budget is the option or 10,000 (the existing GLSL
target's default), a `Sum` or a `Product` over it is NaN as above, and the
adapter bounds the passes of every loop (`Loop`, `Sum`, `Product`, a reduction)
at compile time (`loopPasses()`): a constant count is itself, a run-time count
is the budget (the test above ensures it), multiplied down the nesting and
through the calls, both arms of an `if` added. A program whose bound is over the
budget declines: two nested `Sum`s of 10,000 passes, a loop nested in a `Sum` of
a run-time count (`Sum(Max(L6)·j, j = 1..n)`), a `Loop` of 10,000 passes around
such a `Sum`. A single `Sum` of a run-time count compiles. With
`iterationBudget: Infinity` there is no bound.

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
is an arrow function that `_SYS.irIntegrate` passes to the existing compiler's
quadrature (`SYS_HELPERS.integrate`: adaptive Gauss-Kronrod, stated tolerance
1e-10 relative and 1e-12 absolute, with a Monte-Carlo fallback that draws from
the engine). When the fallback samples (at its first draw) an integrand that has
given a value that is not finite, at a node of the quadrature or at a sample,
the value is NaN, at each run: `∫₀^∞ x^100·e^−x dx`, whose integrand is NaN past
about x = 1,200 while its samples are finite, gave the mean of 10^7 samples, a
wrong number that changed at each run. A finite integrand keeps the estimate of
the fallback, which changes between runs as in the interpreter
(`∫₀^1000 Mod(t, 1) dt` is about 500), and an integral that converges is the
quadrature's (x^10·e^−x, which overflows at one node). Code with an integral is
not shippable (it may draw). As for any pure operation, the number of
evaluations of an integral is unspecified (an unused one is removed), and the
fallback's draws are not the program's. An integrand with an effectful operation
declines (the routine chooses its samples), as do two variables and the option
`quadrature: 'monte-carlo'`. GLSL has no spelling.

## User functions

A user function is lowered once per compilation, keyed by its definition: the
parameter types from the signature of its binding (`real` when unknown), the
result from the signature or the body. A result of no stated type (none,
`unknown`, `number`, `any`, a `broadcastable` type, or a union that is no IR
type, as the engine infers `list<…> | number | tuple` for
`Sqrt(PointX(p)^2 + PointY(p)^2)`) is the type of the body: a scalar, or a point
(a tuple of real or integer numbers, `Function(Block(PointList(x, y)), x, y)`),
and the result of a call is then a tuple; a result that is a tuple of such
elements or of real or integer scalars (`tuple<unknown, unknown>`,
`tuple<number, unknown>`) takes a point body of that length; a list body
declines. A parameter of no declared type, or of a type that is not a scalar
(`collection<any> | tuple`, inferred from `PointX(p)` in the body), takes the
point of its argument at the function's first call: the arguments of that call
are lowered before the function, and a parameter whose lowered argument is a
point (a tuple of real or integer numbers) is a point of its length, whatever
the static type of the argument (a parameter passed on, `(1 − t)·a + t·b`); one
function per binding, as for a list parameter below. `C_mod(C_mul(A, X(x, y)))`
of three functions assigned with no declaration compiles on both targets. A
later call with an argument of another shape declines, naming the function and
the parameter. When the lowered argument of the first call is not a point, a
parameter of no declared type is a real, and one of a type that is not a scalar
declines. A recursive one needs a result type (declared, or inferred by the
engine). An input of the compilation that the body reads (a free name with no
value, or a name of `symbolic` or `inputs`) is a parameter after the function's
own, in the order of its first read in the body (lambda lifting; a scalar, a
list of reals or integers of a stated length, or a tuple of them, which stays a
tuple; on GLSL, which copies an array argument at each call, a list of more than
4 elements that is not in storage declines, `IRFunction.lifted`): each call
passes the caller's value of the name, an input of the entry or, in another
function, a parameter of the same kind, so the input is in `freeSymbols` and a
chain of calls passes it down. At the entry the input has the type that the
scope of the compilation gives the name, whichever occurrence reads it first,
and the call checks it against the parameter: with `f(t) := a·t` and
`inputs: {a: 'complex'}`, `f(2)` declines (an integer input for a real parameter
is admitted). An occurrence of an input of another type than the input's
declines. A `vars` name whose text reads the inputs object (`readsVarsObject()`:
`_.P`, `_['Q']`) is passed the same way: each call in the entry reads the text.
Declined: a recursive call of a function that reads an input, also through a
cycle of calls (`P(j) = If(j > 0, Q(j - 1), n)` and
`Q(j) = If(j > 0, P(j - 1), 1)`); a call where the name is a local or a
parameter, or has a value; an input of a list of a run-time length or of
booleans; a name with a value read in the body whose binding where the call is
compiled is not the body's (see the values of free names above); another `vars`
name. A recursive function that reads no input compiles.
`Apply(Function(body, p1, …), a1, …)` with one parameter per argument, each a
name, is the body with each parameter bound to its argument, the arguments
lowered once, in order, before the body (as a `Block` of locals); a parameter
shadows an input or a local of its name, and an argument reads the names
outside. A flat list of numbers as the one argument of a literal of one
parameter whose signature is scalar (`literalParamsMap()`, the test of the
interpreter's `applyLiteralMaps()`, which maps the literal over the list) is
`Map(literal, list)`:
`Apply(k ↦ Which(k = m, 10^9, True, k), List(x^2, (x - 1)^2))`. Another list or
tuple argument declines: a nested list (the interpreter maps to the leaves), a
tuple and a list of points (atomic), a list of booleans, a list with several
parameters, and a literal whose signature takes a collection (`k ↦ Length(k)`,
which binds the list whole). A typed parameter and another count of arguments
decline too; `Apply(g, x)` of a name is the call `g(x)` in the canonical form. A
function value other than the literal of a `Map`, a `Filter`, an `Apply` or the
root, and a list argument for a scalar parameter (the interpreter maps the
function over the list) decline. A declared result `complex` of a real body is
the body converted to the complex lane. A declared result `color` takes a body
on the colour lane ("The colour lane"); a parameter `color` declines.

A parameter declared a list of reals or integers
(`(list<integer>, integer) -> integer`) is a list: of a stated length, which the
argument must have, or of a run-time length, a hidden integer parameter before
it that each call passes (the length of the argument), as the root function
literal does: `f(D) + f([1, 2])` calls one function with lengths `D.length`
and 2. A parameter declared a tuple of reals or integers
(`(tuple<real, real>) -> real`) is the list of its elements, marked a tuple, and
takes a tuple argument only (`pf(P)`, `pf(Tuple(x, Sin(x)))`). A parameter
declared a list of such tuples (`(list<tuple<real, real>>) -> real`) is a list
of points, of a stated or a run-time length as above, and takes a list of points
only; a parameter of no declared type, or of a type that is not a scalar, whose
argument at the first call is a list of points is one, of a run-time length on
JavaScript (`g(L) := Sum(PointX(L))`). A tuple argument for a list parameter, a
list of lists, of booleans or of complex numbers decline, and so does an input
of the compilation that is a list of points read in a body (lambda lifting takes
a list of rank 1 only). On GLSL a parameter of stated length is a vector of 2 to
4 elements (`vec3 B`) or an array parameter (`float B[5]`), or a `sampler2D`
when its argument is a list in storage. For a function with a list parameter of
no stated length, on a target without run-time lengths (`runtimeLengths: false`,
GLSL), the arguments of the first call are lowered before the function (any
other function is defined before its arguments are lowered): the parameter takes
the stated length of its argument there (`c(H_1, x)` with
`H_1: list<integer^90001>` defines `c` with `H` of 90001 elements), and a later
call whose argument has another length declines, naming the function and the
parameter (one function per binding, not one per length). An argument of a
run-time length leaves the parameter of a run-time length, which declines with
the target's rule. A recursive call uses the parameter types of the function
being defined. This is the one property of the target that the lowering reads
(`LowerOptions`): for such a function the IR out of the lowering differs between
the targets.

A result declared a list of reals, integers or booleans (`list<integer>`,
`list<real^3>`) has the type of the body, a list of rank 1 of a sub-lane of the
declared one, and is not a tuple; a result declared a tuple of reals, integers
or booleans (`(real) -> tuple<real, real>`, a point) has a tuple body of a
sub-lane, and the result of a call is a tuple; a result declared a list of such
tuples (`(…) -> list<tuple<real, real>>`) has a body that is a list of points of
that tuple length, and the result of a call is a list of points (JavaScript). A
local declared a list of tuples (`Declare(out, 'list<tuple<…>>', [])`, which a
`Loop` grows) declines, as does any write to a list local. A body of another
lane (`tuple<integer, integer>` of a real body), a tuple body for a list result
or the reverse, and complex elements (`tuple<complex, complex>`) decline. A
run-time length of the result is a value of the body: the call has two results,
the length and then the list, and the JavaScript code reads the length of the
returned array (`.length`); the function returns one value, as any other. The
verifier checks that the type of the list result names the length result of the
same call. A result that can be a parameter (`same(L) := L`) is returned as a
copy, so the result of a call is a new list. Declined: a recursive call of a
function with a list result (its type is the body's), a list of lists, and on
GLSL a result of a run-time length; one of a stated length is a `vecN` or a
`float[n]` (`vec2 _fn_ir_u0_pt(float v0)`).

## How to add

- An operator: one row in `OPERATORS`; a spelling in `JS.ops` and `GLSL.ops` for
  each new IR operation (`op.int` falls back to `op`), in `JS_BIGINT.ops`
  when it is exact on `bigint` values, and in `JS_INTERVAL.ops` when a kernel
  of `_IA` encloses it. A target with no spelling declines the
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
  two arms of an `If` that both read a shared graph lower it once each: a chain
  of such `If`s (CE-584) would otherwise grow exponentially.
- The printer names a value whose text would nest more than 64 inlined values
  (`INLINE_DEPTH`, `print.ts`): it writes an inlined value by recursion, and
  `Max` of 1,000 operands is a chain of 1,000 `max`. A program on which a walk
  of the pipeline still exceeds the call stack (a tree of depth 20,000)
  declines: "an expression too deep to compile".
- The `fold` pass writes the element of an operation on lists (`elem` of an
  `add` of points) once per list and index in a region and the regions in it,
  not once per path of a shared graph.
- On GLSL `scalarize` writes an element-wise operation as one expression per
  element for a list of at most 64 elements (`SCALARIZE_LIMIT`); over a longer
  list, an array or a list in storage, the operation declines (`2·E` for
  `E: list<real^65>`), as the text would grow with the length. A reduction or an
  `At` of such a list is a loop or a read and compiles.
- A loop or a build of 2^32 iterations or more throws on JavaScript; GLSL clamps
  its `int` bounds to ±2^30. GLSL has no run-time length, region, draw, frame or
  recursion; a build of a constant length is written out (at most 4,096 elements
  in a program).
- A list of lists of run-time length (other than an input's outer list), a
  string seed and `Random` of a domain decline.
- A copied list result is a `structuredClone`: two rows that are the same list
  in the result (`[L, L]`) stay one object in the copy.
- A `real` local declared or assigned a value outside its type (NaN, a complex
  number) is an error of the interpreter; the compiled code goes on with the
  value, and can overwrite it (`Block(Declare(t, real, Sqrt(x)), t := 2, t)`
  gives 2 at x = -1).

## Selecting the pipeline

`compile(expr, { profile: 'ir' })` on the `javascript` target compiles with this
pipeline (experimental: the option can change or go without notice). All the
glue is in `adapter.ts`; `compile-expression.ts` dispatches to it.

- **A decline** (`Decline`, also a refusal of the target) is the public
  diagnostic `'outside-profile'`, with the head in `operator` and the node in
  `value`, except an input with no type (`UntypedInputs`), which is
  `'untyped-input'` ("Inputs" above); any other error of the pipeline
  (`SliceInternalError`, a printer error) is a `'compile-error'`. Both follow
  `fallback`: the interpreter, or a throw with `fallback: false`. A
  `CancellationError` is thrown as it is.
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
  `$` or `$#` and a digit (a placeholder of a spelling) decline. A mapped name
  is not an input (`freeSymbols`).
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
  loads. Each cell is the value of `run()` at that cell; a list input is shared
  by the cells, also with `entryChecks: false`. There is no batch body (CE-410)
  and no asynchronous copy (`parallelCode`): `runAsync()` runs `run()`, and
  `willParallelize()` is false. In the `bigint` mode a batch is refused with the
  error of the existing compiler.
- **The measures.** `CE_JS_PROFILE=ir` makes the engine's own compilations
  (`implicitCompile()`) try the profile first and fall back to the existing
  compiler; `CE_JS_PROFILE_SHADOW=ir` also compiles every JavaScript `compile()`
  with the profile, discards the result and counts it. With
  `CE_JS_PROFILE_STATS=<dir>`, `node scripts/js-profile-stats.mjs <dir>` prints
  the counts (`docs/plans/2026-11-10-js-profile-first-consumer.md`).

`compile(expr, { to: 'glsl', profile: 'ir' })` compiles with this pipeline too
(`adapter-glsl.ts`, batch G1 of
`docs/plans/2026-11-09-js-compiler-status-and-plan.md`), for a scalar result
(real, integer, boolean, or complex, a `vec2`: batch G8, "The complex lane") or
a list of stated length (batch G2: a point, as `vec2(cos(t), sin(t))`, or a
`float[n]`) of inputs that are scalars or lists of a stated length
(`tuple<real, real>`, `list<real^3>`; batch G3: `list<real^6>` is a `float[6]`;
by a rule of the profile, `At` with a constant index after the passes (a folded
one too) that is 0, not an integer or past the stated length of its list (an
input, a list in storage, a literal, in the entry or in a user function)
declines, where JavaScript gives NaN, so that a host can key a retry on the
refusal; a run-time index keeps the read that is NaN outside; this is not the
existing target's rule, which compiles `At(L6, 1.5)` to NaN and
`At(L6, 3 + Length(List(x, y, x, y)))` to a helper call), or a colour (batch G7:
an OKLCh `vec3`, or the channels of the space of an `AsOklab` or `AsRgb` at the
root; "The colour lane"), and gives the result of the existing GLSL target: no
`run`; `code` is an expression, or statements that end in `return …;`, in which
an input is its bare name (the option `bareInputs` of `compileSlice()`; the host
declares the uniform or the parameter); `preamble` holds the helpers and the
user functions, named `_gpu_ir_…` and `_fn_ir_…` in the GLSL syntax (a host that
joins two compilations renames by `_gpu_` and `_fn_`; `ir_` keeps them apart
from the names of the existing GLSL target); a float literal is the shortest
decimal that reads back as the same float32 and is not above the largest float
(`0.1`, `250.0`, `1.1754944e-38`; the largest float is `3.4028234663852886e+38`,
since `3.4028235e+38` is above it and a compiler can read it as Infinity), so a
table of 1,024 numbers in [0, 1) takes about 12 characters per element;
`freeSymbols` are the inputs; `freeSymbolTypes` has the `type` and `provenance`
of the existing target (`freeSymbolTypes()` of `compile-references.ts`) and the
`lowered` type that the code reads (`float`, `bool`, `vec2`, `bvec3`,
`float[6]`: the existing target's for each input it compiles; `vec2` for a
complex input); `warnings` holds the `float32-unsafe-argument` warning of the
existing target (`kind: 'correctness'`, `value` the operand), once per operand
of a `Mod` or a `Fract` in which a constant of magnitude 1000 or more amplifies
a trigonometric value (the rule of `isAmplifiedTrig()` of `gpu-exact-trig.ts`,
with a memo per node: `amplifiedTrigMemo()`, linear in a shared graph), in the
expression and the bodies of the user functions it calls (each node once); there
is no exact sine hash and no `float32Bounds`, so such an operand warns also
where the existing target emits an exact form (a host that sends a flagged curve
to its CPU lane does so for these too), except in a `Mod` or a `Fract` that is
closed as a whole (numbers and library constants under library rows that are not
effectful, `Mod(10000·Sin(100000), 1)`), which the lowering folds in doubles: it
warns only with `constantFold: false`. A closed operand of a `Mod` by an input
is not folded and warns (`Mod(10000000·Sin(1), x)`); `unsupported` is empty,
`mode` is `'strict'` (`'complex'` in the complex mode), `profile` is `'ir'`. A
name of `vars` is an input whose read is the host's text (`x + y` with
`vars: {x: 'u_x'}` is `(u_x + y)`, and `x` stays in `freeSymbols` with its
type): a name, a member or an element of one (`u_x`, `u.P`, `u[0]`), which calls
nothing and is spliced at each read; a read in a user function is passed as any
input (see "User functions"). Another text, a text with a name that is a GLSL
word or holds `__` or a `gl_` prefix (`u.sample`, `u.gl_x`), a text whose first
name could not be an input name (below), and a name that has a value in the
engine decline. `storage: { S: 'sampler2D' }`: the list input `S` (of numbers,
of a stated length) is held by the host in a texture, the contract of the
existing target (a single-channel float texture, one element per texel,
row-major from texel (0, 0), of any width, read at level 0 with no filtering;
the host declares `uniform sampler2D S;` and `precision highp sampler2D;`).
After the passes, `holdStorage()` (`index.ts`) marks `S` and, to a fixed point,
the parameters of the functions it is passed to (`IRType.storage`): each read
must be the list operand of `elem` or `at`, which the printer spells
`elem.sampler2D` and `at.sampler2D` (one helper `_gpu_ir_texel(v, k)` for every
length; `at` keeps the rule of `At`, NaN outside), or an argument of a call
whose parameter is then a `sampler2D`. So `At(S, k)`, a reduction, an
element-wise operation (scalarized to reads) and a user function that reads `S`
or takes it as a list argument compile; `S` as a value (a result, an arm, a
yield), a function called with `S` and with another list, and a `vars` text for
`S` decline. `freeSymbolTypes.S.lowered` is the existing target's (`float[7]`,
`vec3`). `callerLocals` has no effect: a function always takes the inputs that
its body reads as parameters ("User functions"); a call under a binder of the
input's name declines. Declined with `'outside-profile'`: a list result of a
user function of a run-time length, a root `Function` literal, the options
`functions`, `operators`, `imports`, `preamble`, `strictTypes: true`,
`broadcast: true`, `mode: 'bigint'`, loops whose passes can exceed the budget
("Loops and the runtime"), and an input name that is not a plain GLSL
identifier, is a reserved word (`gpu-reserved.ts`), can be a name of the printer
(`v<digits>…`, `_gpu_…`, `_fn_…`) or is the name of a function that the code
calls. `fallback: true` then compiles with the existing GLSL target and logs a
warning (the console). `CE_JS_PROFILE_SHADOW=ir` also measures every `compile()`
to `glsl` that asks for no profile, under the consumer `glsl:public`, which the
statistics script totals apart from JavaScript.
