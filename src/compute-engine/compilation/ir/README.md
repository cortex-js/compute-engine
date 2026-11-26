# The slice compiler

The compiler of `compile()`: a table-driven compiler with an SSA representation
and thin printers for JavaScript, GLSL ES 3.00 and interval JavaScript ("The
interval mode"). `compile()` uses it on every built-in target ("Options and
results" below). The entry is
`compileSlice(expr, { target, passes, extend, iterationBudget })` in `index.ts`;
it returns the code and its `warnings`. Anything out of scope throws a `Decline`
with the fields `node`, `head` and `cause`, also for a refusal of the target
profile. A failure of the verifier or of the effect-trace check is a
`SliceInternalError`: a defect of the compiler, not a decline. The program is
verified after the passes. The checks of the lowering and of each pass (a
verification after the lowering and after each pass, and the effect-trace check
of each pass) run only when they are on: `setPassChecks(true)` (`verify.ts`), or
the environment variable `CE_IR_CHECKS=1` when the module loads. The Jest setup
(`test/jest-config.ts`) sets the variable, so the test suite runs them; the
library does not, because they take about 40% of the time of a compile of a long
list literal.

## Layers

| File                           | Does                                                                                         | Does not                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `operators.ts`                 | One row per operator (arity, signatures, effect, fold); region rows                          | Name a target                            |
| `lower.ts`                     | The one walk: the head's binding, the constructs, scopes and arms                            | Optimize; spell                          |
| `lower-lists.ts`               | List sources (an input, a `Range`, a build), reductions, `Max` and `Min`, the list operators |                                          |
| `lower-functions.ts`           | User functions by definition, signatures, the fixed point of their effects                   |                                          |
| `lower-matrices.ts`            | The matrix operators ("Matrices"): builds of the elements, or a kernel of the runtime        |                                          |
| `lower-arrays.ts`             | The mutable arrays ("Arrays"): the cells, the store, `Swap`, `ArrayFrom`, the names that hold one |                                          |
| `lower-context.ts`             | The types the three lowering files share; `Decline`                                          |                                          |
| `ir.ts`                        | Types, instructions, functions, the builder, the def-use index                               | Know a target                            |
| `effects.ts`                   | The effect of an instruction and of a function; the eligibility queries; trace               |                                          |
| `verify.ts`                    | Definitions, dominance (of values and lengths), types from the tables, calls                 | Re-derive a type rule                    |
| `passes.ts`                    | `scalarize`, `fold`, `strength`, `hoist`, `inline`, `cse`, `invariants`, `dce`               | Change the effect trace                  |
| `outline.ts`                   | The pool loops of `runAsync()`: their accumulators, worker programs, the functions that wait | Change the program                       |
| `print.ts`                     | The shared statement printer and the inline policy                                           | Decide anything that depends on a target |
| `print-js.ts`, `print-glsl.ts` | A `Syntax`: spellings, types, statement forms; the stored code, `run()`                      | Analyse the program                      |
| `index.ts`                     | The target profiles and their one check (`admits()`); the frame warnings                     |                                          |

Every table (`OPERATORS`, `REGION_ROWS`, `REDUCTIONS`, `JS`, `GLSL`, `TARGETS`)
is frozen, and every cache lives in one `lower()` call: the emitted text is a
function of the expression, the options and the definitions it reads, and
nothing persists from one compilation to the next. A test adds rows, spellings
and helpers with the `extend` option.

The head decides first: a head bound to a user function (by its definition, not
its name) is a call, also when it is named `At` or `Sin`; a library head is
compiled only when `isLibraryOperator()` holds; anything else declines. A head
whose operator definition has a `compile` handler other than the standard
library's (`hasOwnLowering()`; a host that sets
`ce.lookupDefinition('At').operator.compile`, or a host operator of its own) is
lowered by that handler's answer (`handlerAnswer()`, called with the node's
operands, a `compile` callback and the context `{ language, typeOf }`,
`language` the name of the target: `'javascript'`, `'glsl'`,
`'interval-javascript'`), except on a control-flow head other than `Which`,
whose handler is ignored. `undefined` lowers the node as the library's; an
expression is lowered in place of the node, in its frames, and each node of it
that the handler created is lowered with no handler consulted: a node under the
operands of a node that a handler was asked about is authored (`authored`, which
canonicalization merging an operand into a new node does not lose), any other
node of an answer is created. The walk ends: created nodes never reach a
handler, and the operands are smaller than the node. Text, a call of the
callback, a throw (other than a cancellation, which propagates) and an answer
that holds the node itself decline. The callback gives `'0'`. No handler is
asked about a node of more than `MAX_FOLD_EXPANDED_NODES` nodes as a tree
(20,000), or about a node under one (`oversized()`): a handler can serialize its
operands, and a value that shares its nodes (a host's height map: 236,663 nodes,
2.5e10 as a tree) has a text of exponential length; such a node declines. A
handler is called once per node of a lowering (the `answers` of `lower()`, which
live in that call only). `idOf()` keys a created node apart, so that it shares
no lowering with an authored node of its structure that consults a handler.
`facts()` reads the answer in place of the node (its names, its loops;
`answered`): a node with a handler that does not defer is not in the slice, so a
closed node above it is not evaluated as the library's, a `Range` above it is
not evaluated by the interpreter, and a `D` or an `Integrate` over it declines
(its closed form is computed with the library's operator). `isLibrary()` is
false for such a node, so `literalList()`, a `Range` read as a list source and
`speculatable()` lower it through `value()`; a node whose handler defers is the
library's everywhere. The standard handler of `PointList` is not such a handler
(the identity of the function in the library table). A call of the library's
`Rational` of two exact integer literals, `q` not 0, in an expression that was
not made canonical (the `structural` form), is read as the exact number `p/q`
that the canonical form makes of it (`exactRational()`, `literalNumber()`,
CE-1499): as a literal, and where the walk reads an operand as a number (the
single quotient of a product: `Floor(Rational(1, 49)·x)` at 49 is 1, also
through a local declared with it; a literal exponent; a negative exponent's
divisor). No node is rebuilt, so each call keeps the definition it was boxed
with. `Rational` of other operands (`1.0`, which the canonical form divides as a
float), a user's `Rational` and one with a host handler decline. Then a
sub-expression that the slice would lower and that has no free name, no name
bound by the walk, no effectful operation and no loop is evaluated once with
`N()` and becomes a literal (`Mod(1, 1/10)` is exactly 0). A closed
`Totient(10)` is not folded, because `Totient` is not in the slice. A
sub-expression whose static type is `error` declines (`Sin(Tuple(w))` of a
vector `w`, `2·Tuple(L, L)`). A throw of `N()` means "not folded": the node is
lowered as written, except a `CancellationError`, which propagates. A row that
depends on an engine setting declines when the setting is not the default,
except the angular unit: under `'deg'`, `'grad'` or `'turn'` the lowering
multiplies each operand of a direct trigonometric row (`Sin`, `Cos`, `Tan`,
`Cot`, `Sec`, `Csc`, `Haversine`) by the radians of one unit, and the result of
an inverse row (`Arcsin`, ..., `Arctan2`, `Argument`, `Degrees`) by the units of
one radian, on both lanes and both targets, as the interpreter converts them
(`ANGLE_FACTORS`, the row field `angle`). Like every engine setting, the
compiled code holds the factor of the unit at the time of the compilation.

`closedValue()` gives a number only. A `Range` lowered as a list value (an
operand of an element-wise row, an argument, the value of a name, an element of
a `List`, the result) whose operands lower to constants (no input, local,
parameter or index; a name with a value is its value, a name of `vars` or
`symbolic` an input), and whose evaluation by the engine is a list of 1 to 4,096
finite real numbers, is the literal list of those numbers, as a `List` of them
would be (`Range(0, 1, 0.1)` is the 11 doubles of the interpreter,
`0.30000000000000004` included; integers on the integer lane): on JavaScript a
literal or, from 16 elements, a list computed once; on GLSL a constant array; in
the interval mode a list of point intervals. A `Range` that a consumer iterates
(`Length`, `Sum`, `Product`, `Max`, `Min`, `Map`, `Filter`, `Reduce`, a
`Comprehension` or a `Loop` clause) is read as a source, its count and the
arithmetic of its elements, with no list, as before; so is a `Range` of more
than 4,096 elements, of an empty list, with `constantFold: false`, and every
`Range` past 4,096 literal elements in the compilation (the elements of all the
literal ranges count). The operands are lowered once: a `Range` whose operands
have an effect or a write is not a literal. Two lists of different stated
lengths under an element-wise operation decline, also where a `Range` had a
length known at run time only before (`Add(Range(1, 3), Range(1, 4))` gave
`[2, 4, 6]`; the interpreter gives `incompatible-dimensions`). A list computed
once that is the result of the program is one array that every call shares
(results are read-only). At 4,096 elements the compilation takes 40 to 75 ms and
the text is 24 to 83 kB.

A root `Function` literal compiles to a function of positional parameters, then
the inputs object for its free names: `run(3, 4, { x: 1.5 })`.

A free name that has a value in the engine (a constant, or a variable) is that
value, lowered at compile time as a literal, only when the value is a number of
the engine (an integer, a rational, a radical such as `Sqrt(2)`, a complex), a
list of such numbers or a tuple of them (a point, `P = (2.64, 17)`, also written
`PointList(2.64, 17)`), or a colour constructor (`Rgb`, `Hsl`, `Hsv`, `Oklab`,
`Oklch`) of three real numbers (`C = Hsv(270, 0.4, 0.95)`, which is lowered as
that application on the colour lane). The value is read from the innermost
binding of the name (`ce.lookupDefinition`), as the interpreter reads a symbol
that is not a call. Any other value of a name that is not the library's is its
expression, lowered where the name is read (`expression()` in `lower.ts`): a
list computed from constants (`R = Map(t ↦ 2t, Range(0, 100))`), a list of
inputs (`P = (x_1, x_2)`, whose names are inputs of the program), exact
constants (`k = (1, e^(2/5))`, enclosed in the interval mode), a colour of
channels that are not numbers. The structural memo of `value()` lowers it once
for the reads in one region with the same bindings. It declines when the value
reads the name again (directly or through another name), when its lowering has
an effect (a draw, a name of `vars`: the interpreter's value of the name is one
value), when it writes a name, when its rank, a stated length or its lane does
not fit the declared type of the name, and when a name that it reads (outside a
function literal of the value that binds it) is a local, a parameter or an index
where the name is read (`R = (n, 2n)` read in `Sum(…, n, …)`: the value reads
the global `n`), or has another binding there than in the value with a value in
one of the two, since the names in a stored expression have bindings of their
own (an outer `a = 2` and `v := a + 1` give 3 in the interpreter under a scope
that declares `a = 10`). The check of the locals is conservative: a lowering of
an enclosing node reused from the memo (`At(R, 1)` read at the top level, then
in `Sum(At(R, 1) + n, n = 1..3)`) reads the value's own bindings, the
interpreter's, and is accepted. A value of a name of the library that is not a
number (`GoldenRatio`) declines. The program lists the name in `captures`
(`symbolDeps`), unless its binding is the library's. A name with a value read in
the body of a user function is that value, as at the entry, when the innermost
binding of the name is the definition that the occurrence in the body reads
(`resolvedValueDefinition()`): the interpreter reads the binding of the body,
which need not be the one of the name where the call is compiled, and such a
name declines (a function defined outside a scope that declares `a` again).
`compile()` runs a compilation in a scope where each name of the bodies it calls
has the binding of its occurrence (`compilationScope()`), so through `compile()`
that case compiles too, with the body's value; a direct `compileSlice()` in the
scope that declares the name again declines. A name with no value there (an
input, also one of `symbolic` or `inputs`) is an input of the program (see "User
functions"). `Pi` and `ExponentialE` decline when the innermost binding of the
name is not the library constant. A reassignment after the compilation does not
change the code, and the inputs object is not read for that name
(`ce.assign('v', 10)` makes `v + x` the code `10 + _.x`).

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

`Power` is on the real lane, except the power of a scalar on the integer lane by
a literal integer exponent `>= 1` (`n^2` of an integer `n` is `integer<0..>`,
CE-1484; a base on the integer lane whose engine type is `number`, the local `c`
of `let c = n^2`, too): it is the product by squaring on the integer lane (`n^5`
is `(n·n)·(n·n)·n`), exact below 2^53 (2^24 on GLSL) as `Multiply`, and past it
under the rule below for an integer value of 2^53 or more. `n^m` stays real (a
rational at `m < 0`). On JavaScript the real power calls the engine's real-power
function (`realPow` of `javascript-runtime.ts`, through `_SYS.ir.pow`), which
the fold also uses: a negative base with a rational exponent of odd denominator
gives the interpreter's real root (`(-8)^(1/3)` is -2), also for a run-time
exponent. On GLSL it is `_gpu_ir_pow`: the exact product for an integer exponent
from 1 to 16, the sign of an integer exponent of a negative base, NaN for a
non-integer one and for a NaN operand (GLSL ES 3.00 leaves `pow()` undefined for
a negative base). A power of a base known `>= 0` (a constant, `Abs`, `Sqrt`, a
square, an input of a declared range at or above 0 (see "Declared ranges"
below), or a value that an enclosing `If` condition bounds below by a constant
`>= 0`) is the builtin `pow()`, exact to a few ulps, so an integer power is not
always the exact product (`10^3` is 999.99994). A real literal at or above 2^53
is a real. An integer value of 2^53 or more is a double and its low digits are
unspecified (`Mod(2^60 + n, 3)`; rule 3 of
`docs/plans/2026-11-12-js-route-course-correction.md`): the compiler makes no
analysis of integer ranges. A closed node keeps the interpreter's value
(`Mod(2^60 + 1, 3)` is 2). At run time `Mod` and `Remainder` have no guard for an
integer of 2^53 or more (one or two machine operations: a check would be
most of their cost; `IsPrime`, `Totient` and the factor readers, which
loop, throw a `RangeError` there): `Mod(n!, 7)` at n = 25 is 0, and the compiled code
gives 6, the remainder of the double. The remedy for the host is the `bigint`
mode. On GLSL `mod()` of a value beyond 2^24 is the remainder of the float,
unspecified.

A product with a rational constant `p/q` whose denominator is not a power of two
(the canonical form of `x/49`, `29k/50`) is `(p · factors) / q`: a
multiplication by the integer `p` (a negation for `-1`), then the operation
`div.q` by the integer `q`, so a quotient that is an integer in exact arithmetic
is that integer under `Floor`, `Ceil`, `Round`, `Truncate`, `Mod` or a
comparison (`Floor(x/49)` at 49 is 1; the product by the double of `1/49` gave
0). `p` and the sign multiply the scalar factors first, so a list is passed over
once for the product and once for the division. The constant can be a free name
that holds it (`r49 = 1/49`), lowered and captured as any name that holds a
number, or a local declared with a number literal that no `Assign` of its block
writes (`Block(Declare(q, real, 1/49), Floor(q·k))`); several such constants of
one product are one `p/q` when both stay safe integers. On JavaScript `div.q` is
the division, which IEEE rounds correctly; on GLSL, whose division need not be
(SwiftShader and ANGLE on Metal compute a division by a literal as the product
by the float of its reciprocal), it is the helper `_gpu_ir_quot`, which gives a
quotient that is an integer or a half of one exactly for a dividend below 2^23
in magnitude, where the test `m·q = 2a` is exact. A tuple dividend takes the
rule of `Divide` (`TUPLE_RULES`). A power of two as the denominator (an exact
test over the safe integers) keeps the product by the double `p/q`, which is
exact, and so do a complex factor and the `bigint` mode (a rational declines
there). The rule is the spelling of one product, with no analysis of where the
value is used: a sum of fractions that is an integer only in exact arithmetic
(`Floor(j/3 + n + 1/3)` at j = -46, n = -16) and a comparison at a zero of a
transcendental function (`0 < Sin(2π·s/P)` at s = 2, P = -2) can still give
another value than the interpreter.

The real functions (`Erf`, `Gamma`, `Root`, the inverse trigonometric and
hyperbolic functions, ...) are rows whose operation the JavaScript code calls by
name from `REAL_FUNCTIONS` (`_SYS.ir`), which the fold of the row calls too.
Each gives the interpreter's real value within the precision of a double (`Zeta`
below about -171 is a known limitation, `docs/COMPILATION-MODEL.md`); a pole is
±∞ and a value that is not real is NaN (`Root(-4, 2)`, `Arcsin(2)`). So are the
library's special functions and steps (`Heaviside`, `Remainder`, `Beta`, the
Bessel, Airy, elliptic, hypergeometric and zeta families, `LambertW`,
`Fibonacci`, `IsPrime`, `HarmonicNumber(n)` and `HarmonicNumber(n, r)`, the
generalized `Zeta(s, a)`, the upper incomplete `Gamma(s, z)`, ...): a pole where
the interpreter gives `~oo` is +∞ (`Digamma(0)`, `HarmonicNumber(-1)`). An order
or a branch that the library types `integer` is on the integer lane:
`BesselJ(ν, x)` of a real `ν` declines (the kernels are real for an integer
order only). A head of two forms has a row per arity (`AGM(x)` and `AGM(a, b)`,
`EllipticE(m)` and `EllipticE(φ, m)`; `rowOfHead()` takes the count of
operands). A row whose value of real operands can be complex (`CosIntegral(-1)`,
`EllipticK(2)`) has `leaves`: in `mode: 'complex'` it takes its complex
signature, the interpreter's continued kernel (`InverseHaversine`, `EllipticK`,
`EllipticE(m)`, `Hypergeometric2F1`, `HurwitzZeta`, `LerchPhi`, `PolyLog`,
`LambertW(x)`, `Gamma(s, z)`), and the others decline. `Log(x, 10)` is the row
`Log`, a real `Log(x, 2)` the operation `log2` (both exact at a power of the
base, as the interpreter: `Floor(Log(1000, 10))` is 3), and `Log(x, b)` of
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
34); of a real it is `_gpu_ir_gamma(x + 1)`. The special functions with a GLSL
form (`Erf`, `Gamma`, `GammaLn`, `Zeta`, `Beta`, `Digamma`, `Trigamma`,
`ErfInv`, `BesselJ` of an integer order, the inverse reciprocal trigonometric
and hyperbolic functions, `Haversine`, ...) are helpers `_gpu_ir_*` ported from
the earlier GPU target, within single-float precision of the interpreter; their
reflections and phases use `_gpu_ir_sincospi` and `_gpu_ir_log1p`, since a
renderer's `sin`, `cos` and `log` near 1 can be wrong by 1e-4 (SwiftShader).
`PolyGamma` of an integer order, `HurwitzZeta`, `Zeta(s, a)` (Wolfram's
generalized zeta; on JavaScript `zetaGeneralized()`), `LerchPhi` and `PolyLog`
of real operands are the earlier GPU target's helpers (`glsl-zeta-helpers.ts`,
with their methods and measured accuracy in its source at 384222963), NaN where
the value is complex and where their terms cancel or their error estimates
exceed 3e-5 of the value: `PolyGamma(2, -0.5)` (the terms of both signs at a
negative half-integer for an even order), `LerchPhi(-1, -1, 0.5)` (next to a
zero), and an order of `PolyGamma` above 24. `HurwitzZeta(s, a)` of a negative
`a` is NaN where its terms of both signs cancel (`HurwitzZeta(25, -1.5)`,
1.1e-10 from terms of 2^25). `HarmonicNumber(n)` is `_gpu_ir_harmonic`:
ψ(n + 1) + γ, its Taylor series below |n| = 0.1, and below -1 the reflection
H(n) = H(-n - 1) - π cot(πn). `HarmonicNumber(n, r)` is `_gpu_ir_harmonic2`: the
sum of an integer n up to 256; from -256.5 to 256.5 (to 1/2 for r >= 2) the
recurrence to n' in [-1/2, 1/2) and the binomial series of H(n')
(`_gpu_ir_harmonic_series`, ζ(r) - ζ(r, 1 + n') less its cancelling term ζ(r));
else ζ(r) - ζ(r, n + 1). At r = +∞, `HarmonicNumber(n, r)` is 1 for n > 0 and -∞
for -1 < n < 0. Both are NaN where the value is complex (n < -1 and an r that is
not an integer, also where the interpreter drops an imaginary part below its
tolerance, `HarmonicNumber(-1.2, -19.5)`) and where their error estimates exceed
3e-5 of the value: next to the zero of H(n) in each interval (-k - 1, -k), k >=
1, where |H(n)| is below about 0.8% of |H(-n - 1)| + |π cot πn|
(`HarmonicNumber(-24.78)`; 12 of 2,117 points from -30 to -1 in steps of
0.0137); r next to 1 for |n| > 256 (`HarmonicNumber(300, 1.001)`, where each ζ
is about 1/(r - 1)); the recurrence of a large r below -1
(`HarmonicNumber(-2.5, 25)`), and below -256.5 an odd r >= 7 at a half-integer
n, where the terms ±(1/2)^-r of ζ(r, n + 1) cancel
(`HarmonicNumber(-300.5, 7)`); an even r <= -2 next to n = -1/2, where the value
is 0 or small (`HarmonicNumber(0.5, -10)` is 2^-10); r < -24.5 for an n that is
not an integer from 1 to 256; n below -10^6 for an r other than 1; and where the
value overflows a single float (`HarmonicNumber(1195.5, -13.9)`). The others
decline on GLSL. `GCD` of integers (`GCD(Round(a), Round(b))`) is `_gpu_ir_gcd`
on `int`s. `GCD` and `LCM` of reals are `_gpu_ir_rgcd` and `_gpu_ir_rlcm`, the
interpreter's `realGcd` and `realLcm`: of two operands that hold integers, the
loop on `int`s (NaN when one is 2^31 or more); of other operands, the remainders
down to 1e-6 of the larger operand, in single floats. Operands with no common
divisor above that bound give a remainder of that size, which can be another one
than the interpreter's (`docs/COMPILATION-MODEL.md`, "Known limitations").
`Hypot` is `length(vec2(x, y))`; `Arsinh` is `sign(x)·asinh(|x|)` (the builtin
is wrong for a large negative argument); `Sinh`, `Cosh`, `Tanh`, `Arctan` and
the reciprocal rows (`Sec`, `Csc`, `Coth`, `Sech`, `Csch`) are builtins or their
reciprocals. `FresnelC` and `FresnelS` are the helpers `_gpu_ir_fresnelc` and
`_gpu_ir_fresnels`: the rational approximations of the JavaScript kernels, each
table a `float[12]` padded with zeros (GLSL converts no array size), the phase
πx²/2 reduced mod 2π from x = n + r, and its sine and cosine Taylor polynomials
(a renderer's `sin` can be wrong by 1e-5); ±1/2 from |x| = 10^7. `Sinc` is its
Taylor polynomial of degree 8 below |x| = 0.5 (error 2e-11), and `sin(x) / x`
above. The other real functions (`Erf`, `Gamma`, `Zeta`, `Arccot`, `Arcsec`,
...) decline there.

On GLSL, `Zeta`, `HurwitzZeta`, `PolyGamma` (an integer order), `Gamma`,
`PolyLog` and `LerchPhi` of a complex operand are the helpers of
`glsl-complex-special-helpers.ts` (CE-1600; its header gives the methods and
their regions), and the real helper on the real axis where it has a value. The
Euler-Maclaurin sums are exact to about 1e-5 of the sizes of their terms, not of
the value (`docs/COMPILATION-MODEL.md`, known limitations). `PolyLog` and
`LerchPhi` keep the sizes of their terms and give NaN where those pass 100 times
the value, and NaN in the regions that no method covers (`LerchPhi` past the
unit circle for `a != 1`).

`Mod` on JavaScript is `floorMod()` (the remainder with the sign of the
divisor). For a divisor of 1 it computes `x - floor(x)`, the same double with no
`%`: the remainder of a large operand is slow, and `Mod(10^4·sin(…), 1)` is the
hash of Tycho's noise documents (`neyret/cucxkogo6q` #4: 620 ns a call to 250
ns). A zero has no sign there (`Mod(-3, 1)` is 0, as the interpreter gives,
where the remainder gave -0), and the fold of the row is the same function, so a
constant `Mod(c, 1)` of a negative integer `c` prints `0` where it printed `-0`.

`Boole(b)` is the row `boole`, 1 or 0 on the integer lane (`b ? 1 : 0`; on GLSL
`1.0` or `0.0`, in the bigint mode `1n` or `0n`), and threads over a list of
booleans as the interpreter's. `KroneckerDelta(a, b)` of two scalars is
`Boole(Equal(a, b))` and `KroneckerDelta(n)` is `Boole(Equal(n, 0))`: the
interpreter's 1 for the same value and 0 for a difference that is a nonzero
constant. A list operand (which the interpreter does not thread) and three
operands or more decline; the interval mode has no spelling of `boole`.

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
them (not always the order of the text: `Sum(w, Limits(k, v, u))` gives
`v,u,w`), which `sliceError()` turns into the `untyped-input` decline
(`throwUntypedInputs()` of `diagnostics.ts`: the code, kind, message and
`value`, the names separated by commas). A decline of the lowering is reported
as it is; a refusal of the target after a completed lowering (recursion, a list
of run-time length on GLSL) comes after the refusal of the input. Until the end
such an input is read as a real. It is not `outside-profile`: with `fallback`,
the interpreter fallback names them in `unsupported` (also after a decline for
another reason, by the type of the name where it is read), and the statistics of
the switch count it `declined`. A name with a value, a local, an index, a
parameter of a user function and a parameter of a root function literal are not
inputs: a parameter of no declared type is a real, and one declared `any` or
`value` declines, as an argument of type `any` does. A positional parameter of a
root function literal of no declared type whose uses give it a type that admits
a list (`A ↦ Transpose(A)`: `value`) declines with `untyped-input` and its name
(CE-1837). A name that only a branch
dropped at compile time reads is an input too (`If(2 < 3, 0, z)` with `z`
undeclared is refused). A scalar of type `number` is a real in the `strict` mode
and a complex in the `complex` mode; a scalar `complex` input is on the complex
lane, and a number given for a complex input is lifted to `{re, im: 0}`, also
with `entryChecks: false`. A list of complex elements declines: an entry of such
a list can be a number or a `{re, im}` object (the ABI of
`docs/COMPILATION-MODEL.md`), and only a run-time test tells them apart. An
outer list of no stated length (`list<real>`, `vector`, `list<list<real^2>>`)
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
`Assign` to it declines, and so does a list value for a local of a stated type,
except for a list local that its block writes in place ("Lists"), which can also
be declared with a list type (`Declare(L, 'list<real>', …)`).

A destructuring `Declare`, whose name is a pattern
(`Declare(Tuple(a, b), {value: p})`, `let (a, b) = p`), binds its names as the
interpreter does (`destructure()`): a `Tuple` value of the length of a `Tuple`
pattern binds each element to the pattern at its position
(`Tuple(Tuple(a, b), c)` of `Tuple(Tuple(1, 2), 3)`); another value must be a
point of the length of the pattern (a tuple value, "Tuples") and binds a name to
the element at each index, a scalar; `_` binds nothing. Every element is
lowered, in order, before a name is bound, so an element that reads a name of
the pattern reads its binding from before the statement. Each name is then a
local as above, of no stated type. The interpreter gives an `incompatible-type`
error for a value of another length, a list and a scalar: those decline, and so
do a nested pattern over a point, a name twice in the pattern, a stated type
(the interpreter checks it against every element), a list or a point that the
block then writes, and every pattern in the interval mode. On GLSL a point is a
`vecN`, so the declaration of a point compiles.

A root `Tuple`, or the last operand of a root `Block` that is one, whose
elements are tuples or are not of one shape (`Tuple(H)` of a list of run-time
length, `Tuple(D, x)`) is no value of the program: the entry yields each element
(`IRFunction.tuple`) and the JavaScript code returns the array of them
(`Tuple(x, Less(x, 0), D)` is `[x, boolean, D]`, with `D` the input). Such a
result has no `broadcastOutputs`; GLSL declines it.

## The complex lane

A third lane, `complex`, is a `{re, im}` object on JavaScript; a real or an
integer is converted to it where a complex is read (`cplx`, which `apply()`, the
arms of a conditional, a list, a local and an accumulator insert), so the lane
of every value is settled at compile time and no code tests a value. The rows
`Add`, `Subtract`, `Negate`, `Multiply`, `Divide`, `Power`, `Root`, `Sqrt`,
`Exp`, `Ln`, `Log`, the trigonometric and hyperbolic rows, `Abs` (real), `Real`,
`Imaginary`, `Conjugate`, `Argument` (real), `Equal`, `NotEqual`, `Gamma` (the
interpreter's complex kernel off the real axis) and `Sign` (`z/|z|`, 0 at 0)
have a complex signature, and `Norm` of a complex scalar is its `Abs`; another
row (a comparison, `Floor`, `Mod`, `Max`, ...) declines a complex operand. The
JavaScript code calls `COMPLEX_FUNCTIONS` (`_SYS.ir`), which the fold calls too:
the engine's machine complex functions (`SYS_HELPERS` of the runtime), and the
ring operations part by part. The result of `compile()` follows the result
convention of every stored kernel (`normalizeRunResult()`), in both modes: a
complex value of imaginary part exactly 0 is returned as the number, at the root
and in the cells of a list; another complex value is a `{re, im}` object. A
program whose root is real returns a number.

The complex quotient (`cdiv`) is the interpreter's `complexQuotient()`: the
textbook formula `(a·conj(b)) / |b|²` where its intermediate values are ordinary
doubles (`textbookQuotientIsAccurate()`), bit for bit, and the scaled division
with the poles (`cdivedge`) elsewhere. It took the scaled division for every
quotient, about twice the time.

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
lane (`x^2`, `x^n`), or a base or radicand that is a nonnegative constant, an
input whose declared type is ranged at or above 0 (`k: real<0..5>`), or a value
of `Abs`, `Exp`, an even power, or a sum or a product of such values
(`Sqrt(x^2 + 1)`). `Sqrt(x)` at `x = -4` for `x: real` is then `{re: 0, im: 2}`.

Declared ranges. The range of the declared type of an input proves its sign:
`>= 0` for `real<0..5>` or `integer<0..>`, `> 0` for `real<1..9>` or
`real<0<..>` (`Program.signs`, set in `input()`). An inferred type is not read,
and an assumption does not change a type (`assume(s >= 0)` leaves `s: real`), so
neither proves a sign. A value outside its declared type gives an unspecified
result. The sign removes `Abs` of such an input (or of a sum or product of them,
`nonnegative()`), takes the real function in the complex mode (above), compiles
an integer power in the bigint mode whose exponent is such an input
(`Power(n, m)` for `m: integer<0..10>`, which declines for `m: integer`), spells
a power of it with the builtin `pow()` on GLSL (`pow.nonnegative`), and drops
the domain guard of `ln`, `log10` and `log2` on GLSL for an input `> 0`
(`ln.positive`; `Ln(k)` for `k: real<0..5>` keeps it, since `Ln(0)` is a pole).
The interval mode reads no range: the enclosure of an input is the host's. Not
done: a bound carried through arithmetic (`Abs(x - 1)` for `x: real<1..9>` keeps
its `abs`).

Inputs in the complex mode: an input of type `number` is complex
(`CompileMode`), so a comparison of it declines; an input declared `real` or
`integer` stays real. The strict mode reads such an input as a real.

Declined: `Max`, `Min`, `Floor` and the other integer rows of a complex, a
comparison other than `Equal` and `NotEqual`, the real functions (`Erf`, `Zeta`,
...) of a complex, a complex `Max` or `Min` reduction, and `ComplexInfinity` as
a literal; a real pole (`Gamma(-2)`) stays a real infinity.

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
`Sin`, `Cos`, `Tan`, `Cot`, `Sinh`, `Cosh` and `Tanh` are one helper each
(`_gpu_ir_cmul`, …), written only when used: the textbook formulas of the
principal branch, with no guard (no fidelity at a pole, a branch point or cut, a
signed zero, or on overflow of an intermediate such as `|b|^2` in a division).
`Tan`, `Cot`, `Sec`, `Csc`, `Tanh`, `Sech`, `Csch` and `Coth` divide by a sum of
squares (`|cos z|² = cos²x + sinh²y`), with no cancellation next to a pole, and
take the first term of their expansion in `e^-|y|` past a part of 20, and their
(Laurent) series below |z| = 0.01, where a renderer's `sin` is 0 (`Tan`, `Tanh`,
`Cot`, `Csc`, `Csch`, `Coth`). Next to a real pole the value is that of the
renderer's `sin` and `cos`, and NaN on the float nearest the pole (SwiftShader's
`cos(1.5707964)` is 0: `Tan` and `Sec` there, `Csch` and `Coth` at the float
nearest iπ). `Ln` and `Sqrt` take the modulus with no overflow or underflow of
|z|² (`Sqrt(1e20 + i)` is 1e10); `Power` does not. The inverse trigonometric and
hyperbolic functions (`Arcsin`, `Arccos`, `Arctan`, `Arsinh`, `Arcosh`,
`Artanh`, `Arccsc`, `Arcsec`, `Arsech`, `Arcoth`), ported from the earlier GPU
target, are Kahan's formulas, as the interpreter's, with no cancellation and the
interpreter's side of each cut on an axis; `Log` of base 10 and `Root` take the
modulus with no overflow, and `Root` of a real radicand and an odd integer index
is the real root. `If`, `Which`, a local, a loop's carried value, a `Sum` or a
`Product`, and a parameter or the result of a user function hold a complex
`vec2`. The other complex rows decline with the operation they lack
(`Arccot (the operation cacot) on glsl`): `Arccot`, `Arcsch`; and so does a list
or a tuple of complex numbers (`a list of complex numbers`,
`Profile.scalarLanes`), also an input one or the result of a user function.
`mode: 'complex'` is admitted: an input of type `number` is then a `vec2`, and
the result's `mode` is `'complex'`.

Ill-conditioned points (docs/plans/2026-11-12-js-route-course-correction.md,
rule 1): near a branch point, a pole or a cancellation the lane gives the
function's value at an argument within a few ulps of the given one, which can
differ from the interpreter by more than 1e-12 or be ±∞ or NaN where the
interpreter is finite (`Arctan(Ln(x))` at `x = 0` is NaN, the interpreter gives
`-π/2`; `Ln(x)·y` at `x = 0` is `-∞ + NaN·i`). On a branch cut the side follows
the sign of the zero part, IEEE style (`Argument(-Z)` at `Z = 0` is π), also for
a `-0` part of a complex input (no fidelity is owed at a signed zero).

## The colour lane

A fourth lane, `color`, holds a colour. On JavaScript a colour is the object
`CompiledColor` (`{ space, c0, c1, c2, alpha }`), made by members of `_SYS`: the
constructors `Rgb`, `Hsl`, `Hsv`, `Oklab`, `Oklch` (`_SYS.rgb`, …) give it in
OKLCh, and the conversions `AsRgb`, `AsHsl`, `AsHsv`, `AsOklab`, `AsOklch`
(`_SYS.asRgb`, …) in the space they name; every member reads the space that the
object carries. On GLSL a colour is an OKLCh `vec3`: `Oklch(l, c, h)` is
`vec3(l, c, h)`, `Oklab` and `Rgb` convert their channels with the helpers
`_gpu_ir_lch` and `_gpu_ir_srgb_lab` (the interpreter's formulas: extended sRGB,
with the sign kept through the transfer function, no clamp and no gamut
mapping), and `AsOklch` is its operand. A `vec3` has no tag of its space, so
`AsOklab` (`_gpu_ir_lab`), `AsRgb` (`_gpu_ir_lab_srgb(_gpu_ir_lab(…))`), `AsHsv`
and `AsHsl` (`_gpu_ir_hsv_of`, `_gpu_ir_hsl_of`), which give the channels of
their space, are admitted only as the result of the program
(`Profile.resultOnly`), and only when the result position of the expression (the
root, or the last operand of a root `Block`) is that conversion itself, so that
a host reads the space from the expression (`compileWithIrProfileGlsl()`):
`AsOklab(Which(…, Oklch(…), …, Rgb(…)))`, Tycho's form, and
`Block(…, AsOklab(c))` compile; `AsOklab(AsRgb(c))`, a conversion in an arm of
an `If` or a `Which`, and a local that holds `AsOklab(c)` and is the result
(`Block(Declare(k, AsOklab(c)), k)`) decline on GLSL, and so does a conversion
in the body of a user function. `Hsv` and `Hsl` convert their channels to sRGB
with `_gpu_ir_hsv` and `_gpu_ir_hsl` (the hue in degrees, wrapped; the other two
channels clamped into [0, 1], as the interpreter reads them), then as `Rgb`.
`AsHsv` and `AsHsl` map the colour into the sRGB gamut first, as the interpreter
does (`_gpu_ir_gamut_map`), and read a colour whose sRGB channels differ by at
most 1e-6 as achromatic (hue 0), where the interpreter's tolerance is 1e-9: in
single floats a grey through OKLCh has channels about 1e-7 apart. A conversion
of a constructor of its own space, `AsHsv(Hsv(h, s, v))` and
`AsHsl(Hsl(h, s, l))`, is the constructor's channels as the interpreter reads
them (`ashsv.own`, `ashsl.own`: the hue reduced into [0, 360), the others
clamped), on both targets, since the round trip through OKLCh loses the hue and
the saturation at black, at white (HSL) and at a saturation of 0. The operand is
read from the operation that makes its value, so a name whose value is such a
constructor (`C = Hsv(270, 1, 0)`, `AsHsv(C)` is `(270, 1, 0)`) is one too, and
a conversion to the same space (`AsHsv(AsHsv(c))`) is its operand. An operand
made by an operation whose interpreter value is never of that space (a
constructor or a conversion of another space, `ColorMix`, `GamutMap`,
`Colormap`, `ContrastingColor` of one colour) converts; any other operand (an
`If` or a `Which` of colours, a call of a user function, `ContrastingColor` of
three colours, which answers the candidate as written) can be of that space at
run time, and declines. A constructor with a list channel
(`AsHsv(Hsv(List(270, 90), 1, 0))`) is the list of its colours' channels, and a
literal list of colours is each element by itself. No space is tracked at run
time and no code tests one.

The rows take three real channels (`Rgb(x, 0.4, 0.6)`) or one colour. A
constructor reads a complex channel (`mode: 'complex'`) as its real part, as the
interpreter does: `Hsv(Sqrt(z), 1, 1)` is `Hsv(Real(Sqrt(z)), 1, 1)`. A fourth
operand (alpha) declines on both targets (GLSL has no alpha channel, and a row
has at most three operands). Every row threads, as the interpreter maps it: a
list operand gives the list of the colours of its elements, a scalar operand is
read at every element, and lists are zipped (`Hsv(210, Range(1, 10)/40, 1)`,
`Rgb(D, D, 0.5)`, `AsOklab(Hsv(0, 0, D))`, also of a nested list), by the
element-wise operation of the lists of numbers ("Lists"): lists of two stated
lengths decline (the interpreter gives `incompatible-dimensions`); of
run-time lengths, the JavaScript code compares them (`Rgb(D, E, 0.5)` with 3
and 1 elements throws a `RangeError`, "Lists"), and the interval mode gives a
list as long as the first one whose colours past the end of a shorter list
have NaN channels. A conversion reads a tuple of three
numbers, a literal or an input of type `tuple<real, real, real>`, as the sRGB
colour of its channels, as the interpreter does (`AsOklab((1, 0, 0))` is
`AsOklab(Rgb(1, 0, 0))`). Every other tuple operand declines: a tuple of four
(its alpha) or of two numbers, a tuple of colours (`AsOklab(Tuple(Cv, Cr))`, an
error of the interpreter), a list of tuples, and a tuple operand of a
constructor (`Hsv(Tuple(1, 2), 0, 0.5)`). On JavaScript a list of colours is an
array of the objects, also as the result of the program (`List(Cv, Cr)` of two
colour names), and `Length` reads it; an `At` of it that the passes do not make
an element (an index that is not a constant in range of a stated length after
`fold`) declines in `admits()` (the interpreter gives `Missing` out of range),
and a `Sum` of it declines (an `incompatible-type` error of the interpreter). On
GLSL a list of colours declines (`admits()`); `At` of a constant index of an
operation of a stated length is the colour of that element
(`At(Hsv(0, 0, L), 2)` of `L: list<real^3>`), since the `scalarize` and `fold`
passes leave no list. On JavaScript a colour operation whose operands are
constants, or such colours or lists of constants, reads no input and has no
effect: it is computed once, when the code is loaded, in `preambleOnce`
(`onceLists()` of `print-js.ts`), by the same member of `_SYS`, and every call
shares the object (`AsOklab(C)` of a name `C = Hsv(270, 0.4, 0.95)`, a constant
arm of a `Which`); one that reads an input, a local, an index or a draw is
computed at each call. GLSL writes the operation of constants in the shader
text; the interval mode has no colour. A conditional between colours joins on
the lane (`If`, `Which` with a `True` clause; with none, its value can be
`Missing` and it declines), and a `Block` local, also one that a `Loop` assigns,
holds a colour (a local declared with the type `color` declines; one of no
stated type, or `unknown`, holds it). A name whose value is a constructor of
three numbers is that colour (see the values of free names above). A user
function may return a colour, declared (`(real) -> color`, also through
`Typed(…, 'color')` in the body) or inferred from the body: an object on
JavaScript, a `vec3` on GLSL. Declined: a list of colours on GLSL, a colour
input, a colour string, a tuple of components other than three real numbers
(`AsRgb((r, g, b, a))`), a list of tuples, a parameter of a user function that
is a colour, arithmetic on a colour (an `error` of the canonical form),
`ColorFromColorspace`, and `mode: 'bigint'`.

The other colour operators call the interpreter's kernels on JavaScript
(`_SYS.colorMix`, …: `lerpOklchColor`, `gamutMapOklch`, `colormapColor` of
`numerics/color-conversion.ts`, `apca` and `oklabDeltaE` of `@arnog/colors`) and
their port in `print-glsl.ts` on GLSL (CE-1468, CE-1535). In each, a tuple of
three numbers in place of a colour is its sRGB colour, as for a conversion, and
a string operand that names a space, a gamut or a palette is a literal, read at
compile time (any other declines):

- `ColorMix(a, b, t)`: the mix in OKLCh; the ratio is clamped into [0, 1],
  `ColorMix(a, b)` mixes at 0.5, and the result is in OKLCh.
- `ColorContrast(bg, fg)` (APCA, of the extended sRGB channels) and
  `ColorDelta(a, b)` (ΔE_OK) are real numbers.
- `ContrastingColor(bg, fg1, fg2)` is the candidate of the larger absolute APCA
  contrast, `fg1` at a tie: on JavaScript the candidate's object, in its own
  space (the interpreter answers the head it was written with).
  `ContrastingColor(bg)` is white or black, an sRGB object on JavaScript as the
  interpreter's `Rgb`. Two operands decline (the interpreter ignores the
  second).
- `GamutMap(c)`, `GamutMap(c, "srgb")` and `GamutMap(c, "display-p3")`: the CSS
  Color 4 gamut mapping; on JavaScript a colour in OKLCh or OKLab is mapped from
  its OKLCh channels and any other from its sRGB channels, as the interpreter,
  and the result is in sRGB (extended sRGB for Display-P3). On GLSL the chroma
  search of `_gpu_ir_gamut_map` is that of `gamutMapOklch` on the OKLCh `vec3`,
  at most 64 steps.
- `ColorToColorspace(c, space)` is the tuple of the three channels of `c` in
  `rgb`, `hsl`, `hsv`, `oklab` (also `lab`) or `oklch` (the case is ignored):
  the conversion of that space, then `colorchannel.<space>` of each channel
  index. A colour with an alpha has four elements in the interpreter; no
  compiled colour has one.
- `Color(s)` of a string literal is the interpreter's colour of the string
  (`colorStringToOklch()`), computed at compile time and lowered as `Oklch` of
  its channels; a colour string with an alpha, a string that names no colour and
  an operand that is not a literal decline.
- `Colormap(name, t)` (JavaScript only: GLSL has no palette table): the
  interpreter's value is a list of colours when `t` is an integer of 2 or more,
  so it compiles only when its shape is settled at compile time (R1 of
  `docs/COMPILATION-MODEL.md`): `t` is a literal that is not such an integer, or
  its static type is a range below 2. `Colormap("viridis", t)` with
  `t: real<0..1>` compiles; with `t: real` it declines (`unsettled-shape`), and
  the remedy is the declaration. `Colormap(name)` (the palette, a list)
  declines.
- `ColorToString(c, format)` (JavaScript only, CE-1548): a string of the lane
  `string`. The interpreter formats the source channels of the colour, and a
  rounding to a unit amplifies any difference of the channels, so the operand
  must be a colour whose channels the lowering has: a constructor `Rgb`, `Hsl`,
  `Hsv`, `Oklab` or `Oklch` of three channels, a name whose value is one, a
  conversion of one to its own space (`AsRgb(Rgb(…))`, read through `b.defs` by
  `colorDef()` of `lower.ts`, which `AsHsv` and `AsHsl` share), or a tuple of
  three numbers (the channels of `Rgb`). The row
  `colortostring.<space>.<format>` passes the three channels to
  `_SYS.colorToString`, which runs the interpreter's steps
  (`channelsColorString()` and `formatColorString()` of
  `numerics/color-conversion.ts`, which the interpreter calls too) and throws a
  `RangeError` where the channels make no colour. The format is absent (`hex`)
  or a string literal, read without case: `hex`, `srgb`, `rgb`, `hsl`, `oklch`,
  `display-p3`. Declined: another format, a format that is not a literal, a
  string operand, a list of colours, and any other colour (a cross-space
  conversion, `ColorMix`, `GamutMap`, `ContrastingColor`, `Colormap`, an `If`, a
  call of a user function, a loop value): those are held in OKLCh here and in
  their own space in the interpreter, and can print one unit off.

A colour that is not finite (a `NaN` channel), or a ratio or a position that is
not finite, is an error of the interpreter; on JavaScript these operators give
the `NaN` colour or `NaN`. The colour of non-finite channels follows the
JavaScript runtime (its `NaN` colour); on GLSL no fidelity is owed there. The
hue of a colour whose two chromatic components are 0 is 0 on both targets, as in
the interpreter (`_gpu_ir_lch` does not call `atan(0, 0)`, which GLSL leaves
undefined). A colour result has `broadcastOutputs` and `broadcast()` (one number
per cell, `NaN`).

## The string lane

The lane `string` holds a text, on JavaScript only (CE-1530, phase 1): a
JavaScript string, conditioned as the engine boxes a string (NFC, then a lone
surrogate replaced with U+FFFD). It never widens: a value that is a string on
one arm and a number on another declines. A string literal is a constant
(`JSON.stringify`); an input of type `string` (or `character`), also a
positional one and a parameter or the result of a user function, is read once,
at the start of the entry, by the operation `text.in` (`_SYS.ct`: the
conditioning, and a `TypeError` for a value that is not a string); its `lowered`
is `string`. A `Block` local of no stated type, or `unknown`, holds a string,
also one that a `Loop` assigns; a local declared `string` declines. The
operators are rows of `operators.ts` that do not thread, each a helper of
`text-runtime.ts` that computes as the interpreter, over grapheme clusters, and
conditions its result: `Length` of an operand of static type `string`
(`text.length`), `ToUpperCase`, `ToLowerCase`, `CaseFold`, `Trim`, `TrimStart`,
`TrimEnd` (with a string of the characters to strip, or none), `StringRepeat`,
`PadStart`, `PadEnd`, `StringReplace` of a string target or of a literal
`RegExp(source, flags)` (one constant: the flags of the host, `u` added as the
interpreter adds it, `/`, the source), `StartsWith`, `EndsWith`,
`StringCompare`, `String` of strings (of none, one, or several: their texts
joined), `StringJoin(s, sep)` of a string `s` (its characters joined by `sep`),
and `Equal` and `NotEqual` of two strings (`text.eq`, `text.ne`: `===` of two
conditioned texts, the interpreter's equality of strings and characters;
`KroneckerDelta` is `Boole` of it). `Less`, `LessEqual`, `Greater` and
`GreaterEqual` of two strings compare `text.cmpu` (`_SYS.cmpu`: UTF-16 code
units, the interpreter's `<` of two strings) with 0, and of two characters
`text.compare` (`_SYS.cmpc`: code points, its order of characters);
`textOrder()` of `lower-strings.ts` picks the order from the static types, as
the compiled lane holds both as strings, and a character against a string, a
type that admits both and a chain of three or more decline (CE-1574). An operand
that the interpreter answers with an error value (a count below 0, or 1 for the
count of `StringReplace`, or above 1,000,000; an empty pad or target) declines
when it is a literal or when the engine proves it out of the domain
(`TEXT_DOMAINS` of `lower-strings.ts`, which also lowers `StringReplace` of a
pattern; the spellings are in `print-js-text.ts`); another is checked by the
helper, which throws a `RangeError` that names the operator (such rows are
`may-fail`). A node of a text row, or of a row with a string signature whose
operand is text, is never evaluated at compile time (`isTextRow()` makes
`facts().slice` false; `Equal` of numbers is evaluated): `N()` gives the decimal
text of a number (`String(1/3)`), the interpreter its exact text. No pass has a
case of its own for the lane. Declined: a string on GLSL, in the interval mode
and in the bigint mode; a string of a `vars` name; `String` of a number (its
text follows the engine's formatting options); a function as the replacement of
`StringReplace`; a `RegExp` that is not the library operator.

A tuple input whose parts are strings and numbers or Booleans
(`tuple<string, integer>`, `tupleParts()` of `lower-functions.ts`; #640), or
whose parts include a list of reals or integers of a run-time length or a list
of lists of the lane `rows` (`tuple<list<integer>, list<integer>>`,
`tuple<integer, list<list<integer>>>`; #638), is read part by part on
JavaScript: the entry has a parameter for each part, of the lane of that part,
marked with its index in `IRFunction.partOf` and printed `_.T[j]` (a string part
through `text.in`; a list part has a parameter of its length too,
`_.T[j].length`, and a part of the lane `rows` is read as an input of that lane,
`chunks()` of `lower-lists.ts`). The binding of the name holds the parts
(`Binding.parts`), and `At(T, k)` of a constant `k` (from 1, or from the end
when negative) reads one; any other read of the name (`T`, `Length(T)`,
`At(T, n)`, an argument of a call, a read in a user function) declines. The
entry plan checks the input once, as a list (`plan.lists`), and its `lowered` is
`point`. GLSL, the interval and the bigint modes, a positional parameter and a
parameter of a user function of that type decline.

A list of strings (CE-1548, CE-1556) is checked by `stringListRefusal()` of
`index.ts` after the passes: it has rank 1; it is made by a `list` instruction,
by a region of `TEXT_LIST_MAKERS` of `lower-strings.ts` (`text.chars`, `build`,
`filter`: `Characters`, `Map`, `Filter`, `Reverse`, `Take` and the other list
operators that move elements), or it is a parameter of the entry; and it is read
only as the list operand of `TEXT_LIST_READS` (`StringJoin`, `text.elem`,
`text.at`, `text.ordering`), or, when it is not a parameter, it is a result of
the entry. `Characters(s)` and `GraphemeClusters(s)` are the region `text.chars`
(`_SYS.tchars`: the grapheme clusters of `s`, each conditioned), whose results
are the count of the clusters and the list of that length, so
`Length(Characters(s))` reads the count. `StringJoin(L)` and
`StringJoin(L, sep)` of a list are `text.joinl` and `text.joinl.sep`
(`_SYS.tjoinl`: each element conditioned, then joined). Each read of an element
conditions it: `text.elem` (`_SYS.tel`, from 0) is the element of
`listSource()`, which every list operator reads at an index in range (the
comment of `listSource()` names each caller), and `text.at` (`_SYS.tat`) is
`At`, `First` and `Last` (`at()` of `lower.ts`) of an index that is not a
constant in range of a constant length: from 1, from the end when negative,
`undefined` when the index is 0, not an integer or out of range. So an input
list is passed as the host gave it, with no walk and no copy at the entry; a
string for it throws (`plan.lists`). No string helper takes `undefined`: a value
of `text.at` is used only by `text.isundef`, as the operand 1 of `text.present`,
as the yield of the `else` arm of an `if` whose condition is `text.isundef` of
it (`Coalesce`), or as a result of the entry, and any other use refuses ("a
string read of a list that can be out of range"; the remedy is
`Coalesce(At(L, i), "")`). This is a check of the program after the passes, not
of the passes: no pass makes `text.elem` or `text.at`, and a pass that
speculates an operation computes on a present string. `scalarize` writes an
element-wise operation of a short static list (`Equal(["a", s], "a")`) with
`elem` reads, which `fold` replaces with the elements; with
`constantFold: false` they remain and refuse. `ListJoin` of a string declines:
the interpreter spreads its characters, where `source(x, true)` makes one
element. `Sort(L)` of a list of strings is the build of the elements at the
indices of `text.ordering` (`_SYS.tord`: the indices from 0 of the conditioned
elements, sorted stably by `cmpu`), and of characters (`Characters(s)`) of
`text.ordering.cp` (by `cmpc`); a list that holds both declines. `Unique(L)` is
the `filter` that `Unique` of numbers is ("Lists"), with `text.eq` as its test
(CE-1574). The elements of a list result are JavaScript strings. Declined (the
remedy is the interpreter): `Max`, `Contains`, `IndexOf`, `Find`, `Reduce` and
`Fold` of a list of strings; an element-wise operation on one; a list of strings
in an `If`, a `Loop` or a user function that is not inlined; a list of lists of
strings; an input list returned as the result.

Code that reads or gives a string, or a list of strings, has `strings: true` and
`shippable: false`: `broadcast()`, `broadcastAsync()` and the batch loaders of
the runtime (`loadBroadcast()`, `loadBroadcastSlice()`, `loadBroadcastAsync()`)
throw a `TypeError` (a batch is of numbers).

## The rows lane

The lane `rows` holds the value of `Chunk(L, k)`, `Partition(L, n)` and
`Partition(L, p)` whose rows can have different lengths ("Lists", the list
operators), on JavaScript only (CE-1549): a JavaScript array of plain arrays of
numbers or booleans, of the shape `[]`, which no numeric row names. It is made
by `rows.chunk` and `rows.partition` (`_SYS.chunk`, `_SYS.partition` of
`javascript-runtime.ts`, which check the count, a `RangeError` where the
interpreter leaves the form unevaluated, and make each row with
`Array.prototype.slice.call`, so that a row is a plain array also of an
array-like input) and by `rows.pair` of the two groups of a predicate (two
filters of the indices, `[$0, $1]`). A signature whose result is the lane gives
`{ lane: 'rows', shape: [] }` and compares the shapes of no operand
(`resultType()`). The list `L` is an input of the entry or a literal `List`
(also a name whose value is one), of reals, integers or booleans: the
interpreter holds it whole. Another list (a `Range`, a `Map`, a `Filter`, a
local, a parameter, a positional input) declines: past `maxCollectionSize` the
interpreter leaves `Chunk` and `Partition(L, p)` of a lazy list unevaluated
(`Chunk(Range(1, 10001), 2)`).

A value of the lane that `Chunk` or `Partition` makes is admitted only as an
entry yield used once (`Profile.resultOnly` of JavaScript; `Profile.scalarLanes`
refuses a list of them): a root `Block` that returns it, a local of type
`unknown` that holds it, `Coalesce` and `AssertPresent` of it, an `If` whose arm
`fold` takes, and a root `Tuple` of it and an element of another shape
(`Tuple(Chunk(L, 2), L)`, a multi-result entry). Every other reader checks its
lane and declines, finds no signature, or makes a value that the use check
refuses: `Rank`, `Shape`, `Flatten`, `Transpose`, `Max`, `Sum`, `First`,
`ListJoin`, `PointList`, `List`, `Length` of a local that holds it, a call of a
user function with it as an argument, arithmetic and comparisons; an `If`
between two values of the lane (`If(x > 0, Chunk(L, 2), Chunk(L, 3))`), a
`Tuple` of it and a scalar (`Tuple(Chunk(L, 2), x)`: "a record with a field of
lists of rows of two lengths") and a `Tuple` of the value twice (`cse` makes one
value used twice). `IsMissing` of it is `False`, the interpreter's value (with
no pass the producer stays, and it declines). No pass has a case of its own for
the lane.

An input of a list of lists of integers or reals whose two lengths are not
stated (`list<list<integer>>`, `list<list<real>>`; `rowsElementLane()` of
`lower-functions.ts`) is of the lane too, on JavaScript only (CE-1607): an input
read by name, a positional parameter of a root function literal, a parameter of
a user function of that type, such an input that a user function reads
(`capture()`, #638), a part of a tuple input read part by part (above), and a
typed parameter of `Apply`, which binds its argument whole as a parameter of a
user function does. An element type `number` is a real, except in the mode
`complex` (`rowsElementLane()` with `wide`). A parameter of a user function
whose type states no lane (`g: list`, or no type: `point` of `signatureTypes()`)
is of the lane when the argument of its first call is (`rowsAt()` of
`lower-functions.ts`, where the interpreter binds the argument whole), with the
lane of the elements of that argument; such a name has no type of rows, so the
readers below take the lane of its elements from the parameter it binds
(`rowsLaneOf()`, `rowsElements`), and a result of type `list<list<any>>` that
such a body gives is a list of rank 2 of reals or integers (`grid` of
`signatureTypes()`) (CE-1721). A variable of the engine of that type that a root
function literal assigns is a positional parameter of the lane
(`assignedNames()`, `Program.assigns`). It is the host's array of arrays, whose
rows can have different lengths, and it is read in five ways: the element
`At(At(g, i), j)` (`rows.at`, `rows.at.int` on the lane of the elements; `_atr`
of the JavaScript printer, NaN where `i` is out of range of `g` or `j` of its
row, from the end when negative, as `At` of a number); row by row, as the rows
of a `Chunk` (`chunks()` of `lower-lists.ts`, #638): the count of the rows is
`rows.count` (`g.length`) and the row `i` the build of `rows.len`
(`g[i].length`) elements `rows.get` or `rows.get.int` (`g[i][j]`), each index
from 0 in range, so `Map` whose value for a row is not a list, `Length`,
`Count`, `IsEmpty`, `IndexWhere`, `Fold` and `Reduce` over `g` read it; the row
`At(g, i)` at an index known at run time (`row()` of `chunks()`): `rows.row`
(`_rowr`) is the index from 0 of the row, from the end when `i` is negative, -1
out of range, and the row is the build of `rows.rowlen` (`_lenr`, 0 at -1)
elements `rows.get`, so `At`, `First` and `Last` of an element of an absent row
are NaN; `Flatten` of `g` to a depth other than 0 (`flattenRows()` of
`lower-matrices.ts`, CE-1734): the region `rows.flat` or `rows.flat.int`, whose
results are the count and a new list of the elements of the rows in order, which
every reader of a list reads (a depth of 0, whose value is the rows, declines);
and an argument of a call at a parameter of that lane, which takes it whole. The
interpreter's absent row is `Missing`, and `Length` of it is `Missing`:
`rowLengths` of `lower.ts` maps the count of the build to `rows.rowlen.nan` (NaN
at -1), which `Length` reads (also of a local that holds the row, of its
`Reverse`, which keeps the count, and of its `Rest`, whose count
`lower-lists.ts` maps too) and `absent()` tests, so `IsMissing` and `Coalesce`
give the interpreter's value. An `If` or a `Coalesce` of such a row maps the
count that its join makes to the `rows.rowlen.nan` of the arm taken
(`branch()`). `AssertPresent` of the row and the row as the result (`result()`)
or as the value of a user function's body (`fr := (g, k) ↦ g[k]`), a list of no
element where the interpreter gives `Missing`, decline; so does a row carried by
a loop (`carry` of `loop()`, `start` and the step of `reduceBy()`), whose
carried count is a new value that `rowLengths` does not name; a reducer of an
absent row is unspecified (`Sum` gives 0). A row of a `Chunk` or a `Partition`
is read at a constant index in range of a constant count only. Every other read
of the name declines (`symbol()` of `lower.ts`, which admits only the occurrence
that `wholeRows()` lowers): arithmetic, an argument of a parameter of another
type, and a list that the program makes at such a parameter (`sq(sq(g))`). A list of lists of booleans,
the bigint and the interval modes and GLSL decline the input. The entry checks
it as a list (a string or a typed array is refused), and a batch shares it
between its cells.

A value of a matrix type of no stated dimensions (`matrix`, `matrix<real>`,
`matrix<integer>`; `isFreeMatrix()` of `lower-functions.ts`) is such an input
too at a typed parameter of `Apply`, a parameter of a user function, an input
that a user function reads and a variable of the engine that a root literal
assigns, with one more fact: its rows have one length, the length of its first row,
the operation `rows.width` (`$0.length === 0 ? 0 : $0[0].length`), which the
compiled code does not test (R5: a value with rows of different lengths is
outside the type, and the engine refuses one as its value). It is made where
the parameter is made: in the entry body (`b.entryOp()`, which records a pure
operation so that a later `b.op()` of the same operand is that value, as
`before()` makes it again) or at the start of the body of a user function,
and is the value's `rowWidths`; its `rowCounts` is `rows.count`. So every
reader of the lane reads it, a row read by `chunks()` has that length (a `Map`
of each element keeps the fact), and the matrix operators read it
("Matrices"). An input of the entry (a name read at the entry, a positional
parameter of a root function literal: `input()` of `lower.ts`) is not a
parameter of the lane: it is a list of rank 2 of reals or integers of the
shape `[{v: r}, {v: c}]`, with two length parameters before it, its number of
rows and the length of its first row ("Matrices", a matrix of run-time size).
The readers of the lane read it as its rows, the operation `rows.of` (`$0`:
the same array of arrays), whose `rowCounts` and `rowWidths` are `r` and `c`;
that value is the binding of the name. Its two lengths are parameters, where
the count of the other values of the lane is an operation made where it is
read (`rows.count`), so two forms compile for it that decline for them: an
`If` with no else whose list arm reads it (`If(n > 0, Map(r ↦ Sum(r), M))`,
a list of NaN where the condition is false, as for an input of type
`list<real>`), and a `Sum` whose term is a list made from it
(`Sum(k · Map(r ↦ Sum(r), M), k, 1, 200)`). An argument at a parameter of a
matrix type, of a user function
or of `Apply`, must have rows of one length (`matrixRows()` of
`lower-lists.ts`): a value of the lane with the fact is taken as it is, and a
list of rank 2 of reals or integers (a matrix of stated size, a literal, a
build of a constant row length) is taken as its rows, a `rows.build` of them
(`asRows()`) whose `rowCounts` and `rowWidths` are its two lengths; a
`list<list<real>>` input, a value whose rows can differ (a `Filter` inside
the rows), a call result and a join decline ("…, a matrix, whose rows can
have different lengths"), since the interpreter gives `incompatible-type`
for rows of different lengths. A call result has no fact even when the
declared result type of the user function is a matrix type: the interpreter
does not check that type (a body `[[1, 2], [3]]` gives that list). The
element `number` is a real outside the mode `complex`; a matrix
of one stated dimension (`matrix<real^2x?>`), of complex numbers or of
booleans, GLSL and the interval and the bigint modes decline the input, with
its type in the cause. A matrix type of stated dimensions
(`matrix<real^2x3>`) is a list of rank 2, as before.

A list of lists of real or integer numbers that the program makes, whose rows
have a run-time length, is of the lane too, on JavaScript outside the interval
and the bigint modes (CE-1736, #638). A `Map` (also of several lists, and a
`Comprehension`: `over()` of `lower-lists.ts`) whose value is a flat list of a
length that is not a constant (`runTimeRow()`) builds it in the region
`rows.build`, an array of the rows; a `Filter` (or a `Comprehension` with a
condition) that keeps rows is `rows.filter`, which pushes each row kept. The
lane of the elements is in `rowsElements`, not in the op: one region for
integers and reals. The value is gated as an input is (`rowsParams`): it is read
whole only where `wholeRows()` admits it, by a reader of its rows (`chunks()`,
which reads any value of the lane through `rowsOf()`: `Map`, `Filter`,
`Length`, `Count`, `At(At(v, i), j)`, `Flatten`, `Reduce`, `Fold`, `FlatMap`),
at a parameter of that lane, as the value of a local and as the result. A
`Block` (its last statement), an `If`, a `Which`, a `Coalesce`, a `Typed`, a
`WithRandomSeed` and an `Apply` of a function literal (its body, when no
argument is mapped over) pass the admission to the operands that give their value
(`passesWhole()` and `wholeOnly()` of `lower.ts`); every other read declines ("a
list of lists of run-time length read whole other than by a reader of its rows
…"). The join of two arms of the lane (`branch()`) is of the lane, of reals
where one arm is. A call of a user function whose body is such a list
(`step(g: list<list<integer>>) = map(r => map(x => x + 1, r), g)`) is of the
lane, so `step(step(g))` compiles. A local that holds such a list is written
again by an `Assign` of another one (`assign()`, `Binding.rows`), and a `Loop`
carries it as one value (`carry` of `loop()`), whose parameter has the lane of
the elements of the local; a write of reals to a local of integers puts the
local on the real lane from its declaration (`WidenList`). A `Reduce` or a
`Fold` from such a list carries it the same way (`reduceRows()` of
`lower-lists.ts`): each step must give one, and a step from integers that gives
reals puts the accumulator on the real lane (a trial lowering, as for a
scalar). A `List` literal whose elements are flat lists of reals or integers,
one of them of a run-time length (`List(Map(i ↦ i + 1, P), List(Length(P)))`),
is of the lane too (`rowsLiteral()` of `lower-lists.ts`: the `list`
instruction of the lane, `[a, b]`); a literal whose rows all have constant
lengths keeps its list of rank 2 or its record of lists ("Records").
`Join` and `ListJoin` of lists of lists, one of them of the lane, are the rows
of the operands in order (`rowsJoin()`, the operation `rows.join`,
`[...$0, ...$1]`), a list of rank 2 of numbers read as its rows (a
`rows.build` of them); `Append(a, r_1, …)` of such a list `a` and flat lists is
`a` joined with the literal of the `r_i`. A `Reduce` or a `Fold` from `List()`
whose static type is a list of lists of numbers first tries an accumulator of
the lane from an empty list of rows, the lane of its elements the body's
(`reduceRows()`); a body that declines there takes the path of a flat list
(in `cx.attempt()`, as the rows paths of `Join` and `Append` are, so that an
operand is lowered once). A `rows.build` or a `rows.filter` whose row length is
a value made before the region, or made in it by pure operations of such values
and constants, records "every row has this length" in the side table
`rowWidths` (the operations made again after the region, where an equal
operation of equal operands is one value), and a `rows.build` records its count
in `rowCounts`; `rowsOf()` reads both, so a `Map` of each element of such a
value, a `Filter` of it and a local that holds it keep the fact. A join of two
arms, a value that a loop carries, a call, a parameter of a type other than a
matrix type (above), a join of lists and a literal have none. The matrix
operators read the fact ("Matrices").
Declined: a row of the lane at an index known at run time as an element of a
list (`Map(i ↦ At(g, i), Range(1, n))`: the interpreter gives `Missing` where
the row is absent), elements that are booleans, complex numbers, points or
strings, a list of such lists (rank 3), a step of a `Reduce` from one that
gives another value, `Scan` of one, a `List` literal of a row and a scalar (a
record), a `Join` of such a list and a flat list, an `Append` of a scalar, a
parallel `Assign` of a local that holds one, the matrix operators of one without
the fact (`Transpose(v)`: "its rows can have different lengths"), GLSL and the
interval and the bigint modes.

A user function whose result type is such a list (declared, or inferred from a
body `Map(i ↦ Map(j ↦ …, Range(1, n)), Range(1, n))`) has the type of its body,
which must be a list of rank 2 of integers or reals (not of points), of the
lengths that the body settles, or a value of the lane `rows` that the body makes
(above). A `build`
whose element is a list of a length value that is a constant (the count of
`Range(1, 32)`, made in the region) has an element of that number of elements
(`region()` of `lower.ts`), so
`Map(i ↦ Map(j ↦ i·j, Range(1, 20)), Range(1, 20))` keeps its two loops and is a
list of 20 lists of 20; an element of a run-time length is `rows.build` (above).
So one step of the Game of Life on a 32 × 32
grid, `step(g: list<list<integer>>)` with `n = 32`, compiles for a root literal
`(g: list<list<integer>>) ↦ step(g)` and for `step(G)` with `G` declared
`list<list<integer>>`.

Code whose result is of the lane has `rows: true` and `shippable: false`:
`broadcast()`, `broadcastAsync()` and the batch loaders of the runtime
(`loadBroadcast()`, `loadBroadcastSlice()`, `loadBroadcastAsync()`) throw a
`TypeError` (a batch writes numbers); `run()`, `runtime.load()` and `runAsync()`
return the arrays. Declined: the lane on GLSL, in the interval mode and in the
bigint mode; a list of points, of complex numbers or of colours (`Chunk(P, 2)`).
A literal list of rows of two lengths, `List(List(x, y), List(z))`, is a record
of two lists ("Records"), an array of arrays on JavaScript.

## The `bigint` mode

`mode: 'bigint'` (JavaScript only) computes every integer as a JavaScript
`bigint`, so a program of integers is exact at any size: `Mod(n, 10)` at
`n = 2^60 + 1` is `7n`. It is not a lane of the IR. The lowering takes, for each
row, a signature whose result is an integer, a boolean or an element
(`signatureOf()`), and the printer is a second `Syntax` (`JS_BIGINT` of
`print-js.ts`) in which an integer literal is `5n` and each operation it spells
is exact on `bigint` values, with the helpers of `bigint-runtime.ts` (members of
`_SYS`): `Add`, `Subtract`, `Negate`, `Multiply`, `Abs` (`babs`), `Mod`
(`bfloorMod`), `Max`, `Min` (`bmax`, `bmin`), `Sign` (`bsign`), `Power`
(`bpow`), `Factorial` (`bfactorial`), `Binomial`, `Choose`, `GCD`, `LCM`
(`bbinomial`, `bgcd`, `blcm`, rows of the integer lane only), the comparisons,
`And`, `Or`, `Not`, `If`, `Which`, `Block`, `Sum` and `Product` with integer
bounds, `List`, `Range`, `Length`, `At` (`bat`), `Sort` (`bsort`), `Map`,
`Filter`, `Reduce`, `ReplaceAt` (`bwix`), `Loop`, user functions with integer
parameters (declared, as `(integer) -> integer`), and a root function literal
with integer parameters. A closed node is the exact value of `evaluate()` (`N()`
of `2^70 + 1` is rounded); a closed node whose value is not an integer
(`Mod(5, 0)`, `(−1)!`) is lowered as written, so its helper throws the pole
where it is evaluated.

Every value is an integer or a boolean, also a loop index, a list index and a
length: a loop counts with a `bigint` counter, and the code converts with
`Number()` where JavaScript reads a number (an element, `$0[Number($1)]`, the
length of a build) and with `BigInt()` where it gives one (the length of an
array, `BigInt(L.length)`). The mode runs with the passes `fold`, `hoist`,
`inline` and `invariants` off, also with `cse: false` or `constantFold: false`:
a helper throws at a pole (`Mod`, `At`, `Factorial`, `Power`, `Binomial`, and so
a call), so no operation is evaluated before it is written, `hoist` would move a
guarded arm out of its guard (`m != 0 ∧ Mod(n, m) = 1` at `m = 0` is `False`),
and `invariants` an operation out of a loop of no pass; the folds of the rows
compute with doubles, and the lowering has folded the closed nodes exactly
already. `cse` reads a value that dominates its use, and `strength` rewrites the
real `pow` only.

Declined, each with its cause: a real or complex value anywhere (an input that
is not of a subtype of `integer`, a real literal, `Pi`, a row with no integer
signature such as `Divide`, `Sqrt` or `Hypot`), so also `Floor(n/m)`,
`Floor(Sqrt(n))`, a division under an integer promise
(`Declare(t, integer, n/m)`) and a comparison with a rational constant
(`n < 7/2`); a `Power` whose exponent is not proved nonnegative (a constant
`>= 0`, an `Abs`, an even power, a sum or a product of such values: `n^m` is a
rational at `m < 0`); `Floor`, `Ceil`, `Round`, `Truncate` of an operand other
than a product of rational constants and integers (the syntax does not spell
them; `Floor(n/3)` is `Floor(1/3·n)`, the floor division `floordiv.int` of `n`
by 3, and `Round(n/2)` with a `roundingTies` other than the default declines); a
quotient other than `(a − Mod(a, c))/c` of pure integers, which is
`floordiv.int(a, c)` (and `p/c·(a − Mod(a, c))` of a constant `c`, which is
`p·floordiv.int(a, c)`); `If` with no else of a number and `Which` with no
`True` clause (their value is `NaN`); `Max` and `Min` of a list (their identity
is `±∞`); `Factorial2` (`(−5)!!` is `1/3`); a `Sum` or a `Product` with an
`iterationBudget` (its value over the budget is `NaN`); a random frame, a draw
and an integral; and the option `vars`. A decline of a node off the integer lane
has the code `'bigint-lane'`; another decline (`vars`, an operator outside the
slice) is `'outside-profile'`. GLSL has no such mode (`'unsupported-mode'`).

The ABI is in `docs/COMPILATION-MODEL.md`, "The `bigint` mode". An integer input
takes a `bigint` or a safe-integer `number`; the code converts it with
`BigInt()` at each read, also with `entryChecks: false`, and with the checks on,
a number that is not a safe integer (`1.5`, `2^60`) throws a `TypeError` that
names the input (the entry plan field `bigints`, `checkEntry()`). A list of
integers is an array of `bigint`; with the checks on its `number` cells are
converted in a copy (`bigintLists`), and with the checks off the host gives
`bigint` cells. A result on the lane is a `bigint` (also a small one), a list
result an array of `bigint`, a boolean a `boolean`. A helper at a pole throws a
`NonFiniteValue` (`(−1)!`, `Mod(n, 0)`, an `At` out of range), and one catch
around the entry returns its number, `Infinity` or `NaN`: the throw ends the
computation, so a pole under a comparison gives the number where the interpreter
gives a boolean. The helpers' size limit (about 1,000,000 digits) throws a
`RangeError`. The stored code holds no `bigint` (its literals are text), and
`load()` gives the values of `run()`.

## The interval mode

`mode: 'interval'` (JavaScript only) computes every value as the `_IA` kernel of
the interval library (`src/compute-engine/interval/`) that encloses it: a `real`
or an `integer` is an `Interval` or an `IntervalResult`, a `boolean` a verdict,
`'true'`, `'false'` or `'maybe'`. It is not a lane of the IR: the lowering is
the one of the `strict` mode, and the printer is a third `Syntax` (`JS_INTERVAL`
of `print-interval.ts`), in which each operation is the kernel of its row, with
the operands in the order of the row's `fold` (`atan2(y, x)`). Every kernel
takes and gives the kinds `empty`, `entire`, `singular` and `partial`, so the
code never reads the kind of a value: the marks of a jump and of a clipped
domain travel through every operation. The lanes are `real`, `integer` and
`boolean`, a list or a tuple is a JavaScript array of such values (of arrays for
rank 2). An input of no declaration whose inferred type is a number type that is
not read as a real or an integer (the signature of `Gamma` gives `x` in
`Gamma(x)` the type `complex | infinity`, that of `Erf` and `Sinc` the type
`complex | signed_infinity`) is read as a real, also where a user function reads
it (`readAs()` of `lower.ts`): every value that a host passes is a real
interval, which is within that type. Its entry of `freeSymbolTypes` keeps the
inferred type, with `provenance: 'inferred'` and `lowered: 'interval'`. A
declared `complex` or `imaginary` input declines, and on JavaScript and GLSL the
rule does not apply. In a function on a cycle of calls an `if` runs one arm
(`verdictIf.decided`, `_IA.decided(c)`): an undecided verdict throws the mode's
undecided error, so that a recursion ends where both arms would recurse; the
`if`s of the entry and of a function not on a cycle, also one that a recursive
function calls, keep the three-way form. With every verdict decided, each call
follows the path of every point of the box. A recursion that does not reach its
base case throws a `RangeError` at the end of the JavaScript stack (`s(x, 2.5)`
of "User functions", about 1.5 ms); `run()` answers both errors with `entire`.
The pass `fold` runs only its list rules (an element of a `list` is that
element, an element of an element-wise operation is the operation on the
elements, an `At` of a constant index in range is an `elem`) and its rule of an
exact zero (`zeros()`): an `add` with an exact zero as an operand is its other
operand. An exact zero is a value printed as the point `[0, 0]` or `[-0, -0]`:
the integer literal 0, its `neg`, its `elem` at a constant index of a `list`,
and its `div` by a nonzero integer literal, whose kernel gives `[0, 0]`
(`x + 0/3`, `x - List(0, 1)[0]` and the identity of a sum written out are `x`; a
real literal 0, a `sub` and a `mul` by an exact zero stay, the last since `0·∞`
is not 0). None of these rules computes a number, so each value is the one the
program computed, where an arithmetic fold would give a double, which is not an
enclosure. The kernel of an `add` of an exact zero gives its other operand with
two differences, both of the kernel and not of the value: with `+0` an end `-0`
is `+0`, and a `partial` clipped on one side is marked clipped on both
(`propagatePartial()`); the operand alone keeps its mark. The pass `strength`
(`x·x` is wider than `x^2` over an interval) is off; two passes of the mode run,
`narrow` first and `plain` last. The pass `hoist` is off too: an operand of
`And` or `Or` (and the arm of an `If` of a boolean with no else arm) stays in
its arm, where a kernel costs a call. A boolean `if` whose other arm is the
verdict that decides it is printed
`let v = 'false', v_y; if (c !== 'false') { …; v = _IA.and(c, v_y); }` (for
`Or`, `'true'` and `_IA.or`), `verdictIf.lazy`: the arm runs where the condition
is `'true'` or `'maybe'`, at most once, as the interpreter's `And` evaluates its
operands left to right and stops at the first `False`, and `_IA.and('maybe', y)`
is the hull of `y` and `'false'`. In a function on a cycle of calls this form is
printed when the arm is pure; another arm keeps `_IA.decided()`.

Spelled: the arithmetic (`div.q` is `_IA.div`; an `add` of a `neg` that has no
other use is `_IA.sub`, with the `neg` removed after the passes,
`subtractions()`: `x - y` is `_IA.sub(_.x, _.y)`, `-x + y` is
`_IA.sub(_.y, _.x)`; a `div` whose dividend is such a `neg` is
`_IA.negDiv(a, b)`, the kernel of `div` of `negate` with the same endpoints,
kinds and marks (not a `neg` of a `div`, whose clipped end differs); a product
with a rational `p/q` and a constant marked `inexact` and a factor that is not a
constant, `Rational(2, 3)·π·x`, is one constant, computed once, times the other
factors: the product of the rational and the constant factors folded as a closed
node (`N()` and one ulp, `2π/3`), or, where a closed node is not folded (machine
precision), `(π / q) · p`; with no such constant, or with constant factors only
(a term of a sum written out, computed once anyway), it is `(p·π·x)/q`
(`product()`: `1/3 · 6` stays the point 2)), `Power` (`pow`, also of integers,
is `_IA.powReal`; a power by the exact constant 2 is `_IA.square`, the operation
`square` that the lowering makes; a float literal exponent below), `Root`
(`_IA.nthRootInterval`), `Sqrt`, `Abs`, `Exp`, `Ln`, `Log` of base 10 and 2, the
trigonometric and hyperbolic functions and their inverses (also the reciprocal
ones), `Arctan2`, `Argument` of a real (`Arctan2(0, x)`: the mode has no complex
lane), `Hypot`, `Degrees` (the product by an enclosure of π, then the quotient
by 180), `Floor`, `Ceil`, `Round`, `Truncate`, `Fract`, `Sign`, `Mod`, `Max`,
`Min`, `Erf`, `Erfc`, `Gamma`, `GammaLn`, `Sinc`, `FresnelC` and `FresnelS`
(`_IA.fresnelC`, `_IA.fresnelS`: each computed value is widened by 4·10⁻¹⁵
relative, more than three times the measured error of the double kernel, and the
operand by one ulp, so that the result holds the interpreter's value at the
decimal it reads; exact at 0 and ±∞), `Factorial`, `Factorial2`, `Chop`
(`_IA.chop(x, tol)`, which reads the tolerance as a number: of a constant
tolerance only, `Chop(x)` at the engine's tolerance at compile time; another
tolerance declines), `Heaviside` (`_IA.heaviside`, 1/2 at 0, a jump at 0),
`Remainder` of integers (`remainder.int`, `_IA.remainder`, the quotient rounded
to the nearest integer with a tie toward +∞, as the interpreter's; a jump
located at the half-integer of the quotient `a/b`, not of `a`, as `Floor(2x)`
locates its jump at an integer of `2x`), `Remainder` of reals (`remainder`, the
same kernel: the outward division, multiplication and subtraction around an
exact rounding of the quotient; an undeclared input beside an integer operand,
`x` in `Remainder(x, 3)`, is inferred `integer` and takes the integer operation,
so a box of reals that a host gives it is outside its type and the result is
unspecified: a host declares `x` as `real`), `Binomial` and `Choose` (also of
real operands, `rbinomial`, `_IA.binomial`), `GCD` and `LCM` of integers (of
reals they decline: `_IA.gcd` and `_IA.lcm` round their operands to integers,
where the interpreter's `GCD(7.5, 2)` is 0.5), the comparisons, `And`, `Or`,
`Not` (Kleene logic on verdicts), `If`, `Which`, a `Block` with locals, user
functions, `Sum` and `Product` with `Limits`, `Random()` and `WithRandomSeed` of
a number seed, a root function literal, and the lists below, and integrals
(below). `Haversine`, `Zeta`, the other special functions of the library
(`Smoothstep`, `Beta`, `BesselJ`, ...: no interval kernel) and the complex and
colour operations have no spelling and decline (a cause of the mode ends with
"on interval-js"). A `Loop` is lowered as on JavaScript ("Loops and the
runtime"): its carried values are intervals, a local assigned in an undecided
`If` of a pass holds the hull of both arms (the earlier interval target answers
`entire` there), and one whose values are not read is removed; a `Break` and a
`Continue` compile, and a pass whose flag of a `Break` is undecided throws the
error of `_IA.decided()` (the whole range); a `Return` declines in the slice. A
string seed and `Random` of a domain decline in the lowering.

Lists. What the lowering makes of a list (sections "Lists" and "Tuples") is
printed with the spellings of the mode, and what it declines for JavaScript
stays declined (`Linspace`, `At` of a list of tuples that can be out of range);
`RandomChoice`, `RandomShuffle`, a `Zip` or a `Map` of several lists of run-time
length and a comprehension of several clauses over a `Range` decline (a length
that is not one number); `ListJoin` and a comprehension of several clauses over
lists compile. A list literal is the array of its elements (of two or more
points: `_IA.points([4, 4.5, …])`, the array of their numbers, about as long as
on JavaScript, Tycho row 368); an element-wise operation is the kernel at each
index, a loop that fills an array (no `Array.from()`); a reduction is the loop
of the lowering (`Max()` of no element is `empty`); `build` (`Map`, a
comprehension, the elements of a `Range`) is a loop that fills an array, with no
deadline check; the `iterationBudget` does not count the elements of a list, as
on the JavaScript target, and a count of 2^32 or more, which no array holds,
throws the error of `_IA.decided()` before the first element (`entire`).
`filter` keeps an element whose verdict is `'true'`, drops it for `'false'`, and
for `'maybe'` throws the error of `_IA.decided()`: the length of the result is
not one number, and the result is `entire`. `At` is `_IA.at(list, index)`, the
interval extension of the interpreter's rule: the hull of the elements that the
integers of the index select, `partial` when some select nothing, `empty` when
none does (`At(List(x, 2x, x^2), Floor(y) + 1)`). The pass `plain` writes an
`At` of a constant index in range of a stated length as `elem` (the `at` to
`elem` rewrites of `scalarize` and of the list rules of `fold` run first, for a
list of a constant length). A length is a plain integer of the bound 2^32: the
length parameter of an input or of a parameter of a user function, the length
result of a call, the count of a `filter`, and the count of a `Range`,
`_IA.rangeCount(lo, hi, step)`, the engine's `rangeCount()` on numbers, which
throws for a count of 2^32 or more; so are the index of a `build` and of a
`filter`, and the index of `elem` (`$0[$1]`). The operands of a `Range` go
through `number`: a bound that is not one integer in the box (`Range(1, n)` of
`n` in `[1, 5]`) gives `entire`; a `Range` of an operand of a real type declines
(its count over an interval is not one number in general). A comparison of two
plain integers (the test of `Max()` of no element) is a verdict of numbers. A
value whose length is not a plain integer declines. An `if` of two list arms (of
one length, as the lowering requires in the mode) joins element by element
(`_IA.hull`). A list result, also a root `Tuple`, is an array of kinded results;
the return writes no copy, because `run()` copies the inputs and the result and
no kernel writes to an operand. An input of a list or tuple type (`list<real>`,
`list<real^3>`, `tuple<real, real>`, `list<tuple<real, real>>`,
`vector<integer^90001>`) is an array of the inputs object, whose elements
`run()` converts (`processInput()`), and is named in `listInputs`, so that
`broadcast()` converts it once and shares it between the cells.

Decided comparisons. A pure node whose type is the value `true` or `false` is
that verdict: `(x + 1)^2 < 0` and `Equal(x, x)` of a real `x` are `'false'` and
`'true'`, and `x < y` is computed. A condition that is such a verdict, or a
constant, takes its arm in the lowering, and the other arm is not lowered
(`fold` is off in the mode).

Integrals. The region `integrate` (`Integrate` of one `Limits`, `NIntegrate`) is
`_IA.integrate((t) => { …; return y; }, a, b, n)` (`interval/integrate.ts`): `t`
is the interval of one of `n` pieces, the integrand is a region body of the
mode, and the bounds are intervals. `n` is the count of pieces for the
expression (`intervalQuadratureSize()` of `compilation/interval-quadrature.ts`):
the lowering measures it at the outermost integral of a body, from the
`Integrate` nodes of its subtree, and every integral in its bounds and its
integrand takes it (`Instr.pieces`; an `NIntegrate` node is a level); an
integral in a user function has the count of its own subtree, and the library's
run-time budget bounds the integrals nested through calls. A count under 4
declines. A part of the integrand that does not read the variable and whose
heads are all pure rows of the library (no reduction, loop, call, conditional or
integral, which could throw or run where the integrand would not), found through
the operands of rows and of calls, is lowered once before the region (the memo
of `value()` reads it there); unlike a value that reads no input, which the
printer computes once per artifact, such a part can read an input and is
computed once per call. Not with a bound that is a number literal ±∞
(`PositiveInfinity`): `_IA.integrate` then answers `entire` and
`_IA.integrateClosed` the closed form, neither calling the integrand; a bound
that is infinite only at run time keeps the hoisting.

The closed form is the engine's antiderivative (`integralClosedForm()`, which
calls `closedFormIntegral()` of `closed-form-integral.ts`, under the
antiderivative budget of the compilation and with no fold of a `vars` name that
holds a value; none with an angular unit other than radians, because that
function reads operands written in radians and the lowering scales the closed
form again, where an indefinite integral declines with that reason; none when
the operands reach an `NIntegrate`, directly or through the value of a symbol or
the body of a user function, which the engine would evaluate by quadrature to a
number that the closed form holds as exact). A definite integral with a closed
form has a second region, of no parameter, whose yield is the closed form, and
is printed as `_IA.integrateClosed(() => closed, f, a, b, n)`: the library gives
the closed form when its scan of the integrand finds no pole, gap or unbounded
stretch (`∫ dt/t²` from −1 to 1 closes to −2 and is `singular`), and with an
infinite bound, and the enclosure otherwise. A closed form that the lowering
declines (an operator with no row), that is not real, or that holds a loop or a
call (a function lowered in a discarded region would stay defined) is not
lowered, and one that the mode does not print (`SinIntegral`: no interval
kernel) is removed before `admits()` (`dropClosedForms()`): the enclosure, of
the same `n`, stands alone. The reads of `vars` entries in a closed form are not
counted as effects (in the mode they read the inputs object). An integral that
is not pure (`e.isPure`: a draw in a bound, also through a call) has no closed
form, which would hold one draw made at compile time, where the bound encloses
every draw (`Random()` is `[0, 1]`). An indefinite integral (no bounds, or a
bound `Nothing`) is its closed form, and declines with none, and when it is not
pure ("an integrand with an effect"); its variable is then an input of the
closed form, of the type that the closed form's use of it gives
(`Integrate(x^2, x)` of an undeclared `x` compiles as `x^3/3` does). A
compilation takes a fresh budget of the antiderivatives when no compilation is
in progress, and otherwise consumes the budget of the one in progress
(`withIntegralClosedFormBudgets()`), so a public compilation with the shadow
measure or with `fallback` can search twice for one integral, once per target; a
search that timed out is recorded, and the second one ends at once. What the
lowering declines on every target stays declined: several `Limits`, an integrand
of several variables, an integrand that is not real, and an integrand with an
effect (a read of a `vars` entry is one).

Conditionals. An `if` is printed with each arm once (`Syntax.verdictIf`): the
condition is bound to a name, the first arm runs unless it is `'false'`, the
second unless it is `'true'`, and each result is the first arm's value for
`'true'`, the second's for `'false'`, and `_IA.hull(a, b)` for `'maybe'`. The
text is linear in the program. The missing arm of `If(c, a)` or of a `Which`
with no `True` clause is the NaN constant, `empty`, so the join for `'maybe'` is
`partial`. A local assigned in both arms of an undecided `If` holds the hull of
both values. The pass `narrow` (`narrow.ts`): for an `if` whose condition is one
`lt`, `le`, `gt` or `ge` of a value `v` and a constant `c`, the arm where
`v ≥ c` holds reads `_IA.atLeast(v, c)` in place of `v`, the arm where `v ≤ c`
holds `_IA.atMost(v, c)` (a strict comparison takes the closed bound);
`If(x > 0, Sqrt(x), -x)` over `[-1, 1]` is `[0, 1]`. The two kernels
(`interval/comparison.ts`, the operations `atleast` and `atmost` of the mode)
are clamps: `atLeast` raises the lower end of `v` to the lower end of `c`,
`atMost` lowers the upper end to the upper end of `c`, with no outward step (a
clamp computes no new real number), keeping the kind and the marks of `v`
(`partial` and its clip, a jump's `at` and `continuity`). They return `v`
itself, with no allocation, when nothing changes (every decided condition), and
also for a value with no ends to clamp (`empty`, `entire`, a pole, a NaN bound),
for a `c` without finite ends, and when the clamp would leave no point (the arm
cannot be taken): not narrowing is always sound. `Random()` is the constant
`{ lo: 0, hi: 1 }`, the support of a draw, and a random frame is its body: the
mode draws nothing and gives no `seeded-draw-order` warning, so two evaluated
arms are sound.

Integers and loops. The pass `plain` (`plain.ts`) makes a plain integer a
JavaScript number: an integer constant, the index of a loop, or `add.int`,
`sub.int`, `neg.int`, `mul.int` of plain integers whose static bound of
magnitude (the constant, 2^32 or the bound of a loop for an index, the sum or
the product of the bounds) is below 2^53. Its operations are spelled as in
JavaScript (`add.num`, `($0 + $1)`); a plain constant is a twin literal marked
`plain` (`Literal.plain`). Where an interval operation, an `if` result or a
function result reads a plain integer, the pass adds `point`
(`{ lo: n, hi: n }`); where a loop reads an interval as a bound, it adds
`number` (`_IA.number(x)`: the number of a point that is an integer of magnitude
at most 2^32, else a throw of the error of `_IA.decided()`, which `run()` and
`broadcast()` answer with `entire`, and which `broadcast()` does not count as a
failure). A scalar `pow` whose exponent is plain is `_IA.pow($0, n)` with a
number exponent (`x^3` is `_IA.pow(_.x, 3)`), and so is a scalar `pow.interval`
whose exponent is plain; a list power is `_IA.powReal` of each element; a power
by the constant 2 stays `_IA.square`. Every other integer is an interval:
`Floor(x) + 1` is `_IA.add(_IA.floor(_.x), { lo: 1, hi: 1 })`. So the bounds and
the index of every loop are numbers, and no code tests a representation. A bound
that is an interval (a slider `n` given as `[2, 4]`, a `Floor(n)` that jumps in
the box) gives `entire` at run time. A loop writes no deadline check, and the
lowering writes no NaN test of the `iterationBudget` (NaN reads as `empty`): a
loop of more passes than the budget (2^32 without one) throws the error of
`_IA.decided()` before its first pass (`_IA.undecided()`), so the result is
`entire`; so does a `build` or a `filter` of more elements, before its first
element. With a finite budget a pass of a `Loop` is counted instead:
`_IA.countLoopPass(budget)` adds one to the count of the call (nested loops and
the loops of user functions included), and over the budget throws the
`CancellationError` that `run()` rethrows; the count starts again in
`preamblePerCall` (`_IA.resetLoopPasses()`), at each call and for the values
computed at the first call, whose passes no call counts. A sum of constant
bounds of at most 100 passes within the budget is written out ("Lists"), with no
loop and no such test. A sum is a loop from the lower bound up (or, written out,
added in that order), so that its result contains the value that the scalar code
computes by adding upward in doubles (each `_IA.add` rounds outward).

Constants. An integer and a real literal whose double is its value are a point
`{ lo: c, hi: c }`; NaN is `{ kind: 'empty' }`; a boolean is `'true'` or
`'false'`. A real literal whose double is not its value is marked `inexact` in
the IR (`Literal.inexact`, the count of ulps; `literalKey()` tells it from the
unmarked literal of the same double) and printed as the enclosure of that many
ulps on each side, computed when the code is printed. The double is the value
for a number that is not exact (a machine number or a decimal: `0.1`, `1.8`, as
in the JavaScript code: the precision of the target), so the interpreter at the
default precision, which computes with the decimal, can differ: at `x` the
double of 1.8, `Ceil(x - 1.8)` is 0 in the mode and in the interpreter at
machine precision, and 1 in the interpreter at the default precision (`x - 1.8`
is about 4.4e-17 there); and for an exact number that is a double
(`exactDoubleValue()`: `1/2`, `5`); another exact number takes one ulp per
rounding of its double (`exactValueDoubleRoundings()`: `1/3` is
`[0.33333333333333326, 0.33333333333333337]`). `Pi` and `ExponentialE` take one
ulp, and so does every other constant of the library whose value is not exact
(`EulerGamma`, `CatalanConstant`: the engine holds the double nearest to a
number that is not a double; `MachineEpsilon` too, though it is `2^-52`), while
a decimal that a name of the program holds is its double; the factor of an
angular unit takes two. A closed node is the value of `evaluate()` when it is an
exact number that is a double, or a safe integer computed in big decimals
(`Mod(1, 1/10)` is 0, `Floor(100π)` is 314); else the value of `N()` with one
ulp (`Sin(1)`), when `N()` computes in big decimals of more than the 17 digits
of a double (the engine's precision at least 18); else, at machine precision,
the node is lowered as written and the kernels enclose it at run time.

`Power(x, p/q)` with a literal rational exponent, `q > 1`, is lowered as
`Root(x, q)^p`, for any sign of `p`: `x^(2/3)` over `[-8, -1]` is `[1, 4]`. When
`q` is a power of 2, `p/q` is a double and the power has no real value over a
negative base: it is `pow.principal` of that double, one kernel (`(x^2)^(3/2)`
is `_IA.pow` of `_IA.square(_.x)` and 1.5). A float literal exponent that is not
an integer is its double `e`, read when the program is lowered as the
interpreter reads it (`realPowerBranchTerms()`), which takes only the sign from
the reading: over a base that can be negative, a rational `p/q` of odd `q` is
`pow.branch` (`pow.branch.even` for an even `p`), the real root `±|x|^e` with
the double, `_IA.powRealBranch` (`x^0.2`, `x^2.2`, `x^0.6000000000000001`); any
other float, and every float over a base that the lowering proves non-negative
from its operations and constants (`nonnegative()`: `Abs(x - 1)^0.2`; not from
the type, an assumption or a value of an input, which the code does not keep),
is `pow.principal`, `_IA.pow` of the double, which has no value over a negative
base (`x^1.5`, `x^3.87`). At `x = 1e300`, `x^0.2` is `1.0000000000000077e60` in
the mode and in the interpreter at machine precision. An exponent known at run
time is `_IA.powReal(x, e, digits)`, which applies the same reading when `e` is
a point that is not an integer (and keeps the last reading, so a plot with one
exponent reads it once), and is `_IA.powInterval` otherwise; `digits` is
`realPowerReconstructionDigits()` of the engine's precision when the code is
printed, written in the code, so that stored code reads the exponent as the
engine that compiled it. A scalar real exponent known at run time over a scalar
base whose enclosure the lowering proves `>= 0` (`nonnegative()` with
`enclosed`: an integer constant `>= 0`, a real constant of at least 2^-1022
other than `e`, `abs`, `exp`, `square`, `sqrt` of any operand, an even integer
power, a sum of such values and a `max` of one; not a product or `hypot`, whose
outward step can move a lower end 0 to `-5e-324`, nor a real constant printed a
few ulps wide around 0) is `pow.interval`, `_IA.powInterval` as on the earlier
interval target (`2^y`, `Abs(x)^y`, `Max(x, 0)^y`): the reading cannot apply
there. The two kernels differ over such a base only at a negative exponent read
as a rational of odd denominator, where `_IA.powReal` takes the scalar
`_IA.pow`: a base `[0, b]` gives the same `partial` with the other clipped side,
and a base whose upper end raised to the exponent underflows to 0 (an upper end
`+∞` included) the lower end `-5e-324` where `_IA.powInterval` gives 0.

Enclosures (`lower-enclosure.ts`; `docs/COMPILATION-MODEL.md`, "The enclosure on
`interval-js`"). A value of the kind `enclosure` is an interval of the mode: an
input whose type has an `enclosure` arm and whose other arms are numbers
(`enclosure`, `real | enclosure`, `number | enclosure`, `enclosure | nan`) is a
`real` input (`enclosureInput()`, read by `inputIR()`, so also for a name that
holds an enclosure, `c := Enclosure(1, 3)`). A node with an operand or a result
that may be an enclosure, other than a head that holds, passes or chooses a
value (`CONTROL_FLOW_HEADS`, `List`, `Tuple`, `Hold`, `Apply`), is lowered by
the kind before `closedValue()`, with operations of its own rows (`enc.*`,
`ENCLOSURE_ROWS`, of no head, spelled in `JS_INTERVAL`): no pass of the mode
reads them, and the mode's rules for a real (the exact-zero rule of `fold`,
`narrow`, `subtractions()`, the power and constant rules above) never make them,
so a program with no enclosure compiles as before. Each node is the `_IA` call
of the `.N()` route of the interpreter for the same form
(`enclosure-arithmetic.ts`), so the two routes give the same doubles: a number
or a constant of class 2 as an operand is the interval of its outward conversion
(`outwardDoubles()`: `x + 0.1` reads `[0.09999999999999999, 0.1]`; not the
mode's `inexact` literal), an infinite literal is the point `±∞`; an arithmetic
result is `_IA.enclose()` of its kernels (the library's marks removed, `empty`
for an infinite singleton or a `NaN` end); an operand of an arithmetic kernel
that may be infinite is read through `_IA.finiteOperand()`; a comparison reads
its operands through `_IA.stripEnclosure()`, each once, and an extremum wraps
its result in it; a power takes the kind's own exponent table (`_IA.square`,
`_IA.sqrt`, `_IA.pow` of an integer, `_IA.powRational` of `p/q` with an odd `q`,
`_IA.powRealBranch` of a float read as such a `p/q`, `1 / x^|n|` for a negative
integer `n`, `_IA.powInterval` of an exponent that is not a point over a base
proved positive); a rounding with a step is `round(x / k) · k`; `Mod` is `empty`
for a zero divisor; a literal `Enclosure(a, b)` is the interval
`[min(down), max(up)]` of its outward endpoints, and a symbolic endpoint
declines. The heads are an allow-list that fails closed: any other head, and an
operand that the interpreter leaves unevaluated (`Factorial(x)`, `Log(x, c)`
with `c: enclosure`, `Mod(5, c)`), declines with a message that names the kind
type `enclosure`, and so do a collection of enclosures (`list<enclosure>`), a
`Sum`, `Product`, `Integrate` or `NIntegrate` whose operands read an enclosure
(the loop would add the terms by the rules of a real), and a call of a user
function or of a host's `compile` handler with an argument that may be an
enclosure (its body would be lowered by the rules of a real;
`enclosureRefusal()`, before the call is lowered). The program then has
`valueKinds: ['enclosure']`, and the result (`adapter-interval.ts`) checks the
host value of each input of the kind before `run()` and before the loop of
`broadcast()` and `broadcastAsync()` (a record `{ lo, hi }`, or a number by the
numeric arms of a union): a refused value throws. `shippable` is `false`,
`willUsePool()` answers `false`, and the stored form cannot be loaded
(`createIntervalRuntime()` refuses `valueKinds`); `run()` and the batches load a
copy without it, after the checks. A direct trigonometric function under an
angular unit other than radians multiplies its operand by the outward interval
of the factor, where `.N()` multiplies each endpoint exactly: the two can differ
by the rounding of the factor.

Values computed once (`computedOnce()` of `print-interval.ts`). A value that
depends on no input, parameter, loop index or draw is computed when the code is
loaded, in `preambleOnce`, and read by its name: a constant that is not a number
or a verdict and that code run at each call reads (a constant read only by such
values is written in their text); a pure operation or a list of such values, in
any function and any region (no kernel throws, except `_IA.rangeCount()`, which
is not moved); and an operation that can fail (`_IA.number`) or a call of a
function that has no effect (also a recursive one), of such values, only at a
top level that runs at every call: the top level of the entry, and of a function
that such a top level calls (`b(3π)` in the body of `w`, called as `w(x)`).
Nothing that draws or has an effect is moved. The values follow the functions,
those of a function before those of its callers. Those that cannot throw and run
no loop are computed in `preambleOnce`, when the code is loaded. The others (an
operation that can fail, a call, and what is computed from them) are computed at
the first call of the loaded code, in a `try` of `preamblePerCall`, so
`compile()` and a load run no loop of the program; each later call tests a flag,
`_once`, and throws again the error of the first call if there was one: `run()`
and `broadcast()` then answer `entire`, as when the value is computed at the
call (a `Sum` over the `iterationBudget` in `b`). Each load (`run()`,
`broadcast()`, a stored copy on a worker) computes them once. A value computed
once is shared by every call: no kernel writes to an operand (a widened result
is written only into a wrapper that the kernel made, `rounding.ts`), and `run()`
copies its result (`freshIntervalValue()`), so a change of a returned value does
not change the next result.

The result has the stored form `StoredIntervalJavaScript`: `code`, an expression
of the inputs object `_` (the expression itself for a body of one `return`), or
for a root function literal the function of its arguments; `preambleOnce`, the
user functions and the values computed at the load; `preamblePerCall`, the
values computed at the first call, when there are some; `runtimeVersion`
(`INTERVAL_RUNTIME_VERSION`). The code reads `_IA` only. `run()` is
`createIntervalRuntime().load()` of the stored form, so `run()` and stored code
loaded on a worker agree by construction: an input given as a number is a point,
a boolean is a verdict, and the result is a kinded `IntervalResult` or a
verdict, never a bare `{ lo, hi }`; an error of the code other than a
`ReferenceError` or a cancellation is `entire`.

`compile(expr, { to: 'interval-js' })` compiles with the mode
(`adapter-interval.ts`). A decline has the code of its reason ("Options and
results"; a `mode` other than `'strict'` is `'unsupported-mode'`); with
`fallback: false` it throws a `CompileDeclineError`, and otherwise the result is
`success: false` with the interpreter's `run`, which gives interval results
(`interval-fallback.ts`): at a point box a number is a point only when the
interpreter's value is exactly that double, and otherwise `entire`, and a
boolean is decided only when every number it is computed from is exact, and
otherwise `'maybe'`; over a wider box, or with a draw, a number is `entire` and
a boolean `'maybe'`. A decline of an expression with an input or a result of the
kind `enclosure` has no fallback (it would read an enclosure input as its
midpoint): it throws a `KindDeclineError`. The result has
`target: 'interval-js'`, `success`, `runtimeVersion`, `code`, `preambleOnce`,
`preamblePerCall` when there is one, `preamble` (the two, in that order),
`calling` (`'expression'`, or `'lambda'` for a root `Function` literal, which
declines when its body reads a free name), `booleanInputs`, `listInputs`, `run`,
`freeSymbols`, `freeSymbolTypes`, `unsupported` (empty) and `mode` (`'strict'`),
with `freeSymbols` and `freeSymbolTypes` by the rule of every target ("The
report of the inputs", in "Options and results"; `lowered` is `interval` for a
real or integer input), and for an expression `broadcast()`, `broadcastAsync()`,
`shippable` and `willUsePool()`, built by `createIntervalRuntime()`
(`loadBroadcast()`, `loadBroadcastSlice()`) over the stored result. Options:
`inputs`, `symbolic`, `symbolDeps`, `varsObjectRefs` and `cse: false` as on
JavaScript; `constantFold: false`, no closed node evaluated; `vars` only for a
text that reads the inputs object (`readsVarsObject()`: `_.c`, read at each
use), another text declines; a `mode` other than `'strict'` declines;
`entryChecks`, `storage` and `quadrature` have no effect; `iterationBudget`
limits the passes of each `Sum` and `Product`, and those of the `Loop`s of a
call (above).

## Lists

A length is a number or an integer SSA value: the length of an input is a
parameter before it, the count of a `Filter` and of a `Range` an instruction.
Two lists with the same length value have one length (`D + Map(f, D)`,
`Range(1, n) + Range(1, n)`, after `cse`); the verifier checks that a length
value is visible where a type names it. The arms of an `If` or a `Which` that
are flat lists of reals or integers of two lengths (two length values, a stated
length beside a length value, two stated lengths) give a list of the length of
the arm taken: the `if` has that length as a result before the list, each arm
yields its own, and the verifier reads the list yield of an arm against that
yield (`If(x > 0, List(x, 2), D)` is `[x, 2]` or `D`, and its `Length` is 2 or
the length of `D`). A length value that is a constant at least 1 and equal to
the other arm's length is that stated length
(`If(c, Repeat(x, 400), Range(1, 400))` is a list of 400; two empty arms keep
the length result). An arm `List()`, which has no type of its own, is the empty
list (a build of no element) of the lane of the conditional's engine type when
that type is a flat list of integers or reals (`If(n < 1, [], Range(1, n))`, of
type `list<integer>`; arms that are all `List()`, of type `list<never>`, take
the integer lane); so is `List()` at a parameter of `Apply` declared such a list
(`Typed(xs, 'list<integer>')`). A `List()` in the value of a free name
(`captured()`) takes the lane of its place in the type of the name
(`placeEmptyLists()`; CE-1808): the value itself where the type is a list of
rank 1 of no stated length, of integers, reals, booleans or strings
(`let x: list<string> = []`), an operand of a `Tuple` at the type of its
position, and an operand of the constructor of a nominal tuple type at the type
of its field (`Figure("circle", [])`); a list of no stated element type
(`let pts = []`, of type `list<unknown>`) takes the integer lane. The memo of
`value()` takes no node that holds such a `List()`: its key does not have the
place of the node. No value has a stated length of 0: the result of a function
whose length is the constant 0 keeps its length value, and the read of a record
field of the stated length 0 (the type of a field states a constant length) is
an empty build of the lane of the field. Otherwise (a list of points, a union
type, a `List()` that the program writes), and on GLSL and in the interval mode,
`List()` declines ("an empty list"). The invariant: a value that a type names
(of a value or of a function's result) is live wherever that type is, so `dce`
keeps it; when `fold` takes the arm of an `if` whose list is the program's
result, the length constant of that arm is read by the result type only. GLSL
and the interval mode decline lists of two lengths ("arms that are lists of two
lengths"): GLSL has no run-time length, and in the interval mode a length is a
plain number that an undecided condition cannot join. A list arm beside a scalar
arm, tuples of two lengths, lists of lists and lists of two lanes that do not
join (booleans and reals) decline with "arms of two types". `elem` reads an
element from 0; `At` is the interpreter's rule (from 1, from the end when
negative, NaN outside; on GLSL a conditional that reads the element only in
range, with the length as a literal, `$#0` in the spelling), and the fold turns
an `At` of a constant index in range into an `elem`. Another index can be out of
range. On JavaScript, of a list of booleans it is `atu`, `undefined` out of
range where the interpreter gives `Missing` (`At(X > 0, 5)` of a list `X` of
three numbers), a pure read: no operation on a boolean fails on `undefined`; of
a list of real points it is `atp`, a point of NaN coordinates out of range, the
interpreter's value (`At(P, 0)` is `[NaN, NaN]`). Of a list of lists of numbers
of stated lengths (`P: list<list<real^2>>`) it is `atrow`, the row, or
`undefined` out of range where the interpreter gives `Missing`, only where the
`At` (or a `First`, a `Last`) is the whole program (the root, or the body of a
root function literal, in a `Block` of one expression or not; CE-1540): no
operation reads the row, so none folds it away (`Length` of the row is a
constant, a discharge reads a list as present). Of a list of complex numbers or
another read of a list of lists it declines: a read of an absent row must not
fail, and no program of Tycho's corpus reads one. GLSL, the interval and the
bigint modes decline every such index. `build` and `filter` are region rows. A
`Length`, a reduction, a `Map` or a `Filter` of a `Range` reads its count and
the arithmetic of its elements, so `Length(Range(1, n))` makes no list. On GLSL,
which has no build, a `Map` (and a one-clause `Comprehension`) over a source of
a constant length of 1 to 64 (`SCALARIZE_LIMIT`) is the list of its elements,
the body lowered once per element in order: a `vecN` or a `float[n]`
(`Map(f, L)` of `L: list<real^3>`, `Map(f, List(a, b, c))`). A `Range` of
integer constant operands is a source of a constant length, its exact count
(`Min(Comprehension((x - k)², Element(k, Range(1, 16))))` is a `float[16]`); not
with `constantFold: false`. The elements of such builds in one program are at
most 4,096; past that, a `Filter`, a `Range` of a run-time length, of a real
operand or of no element, and a list of a run-time length, the build declines on
GLSL. The short lists: on JavaScript (the interval mode included; not in the
bigint and complex modes), a list of a constant length of 1 to 16 elements
(`MAX_UNROLLED_LIST` of `index.ts`, the option `unrollBuilds` of the lowering
and of the passes; GLSL keeps its 64 for builds) is written out. A build over a
source of such a length, and a list that `built()` makes (a `Range`, a
`Comprehension` of several clauses), is the list of its elements, as on GLSL; on
JavaScript a build whose body has an effect (a draw) keeps its loop, as a sum
written out does, so that a draw stays one site of its frame and the warnings
are the loop's. A reduction of such a list is folded through the sums written
out (below), from the value the loop starts from. One exception: for `Sum`,
`Product`, `Max` and `Min` (`reduction()`), when that value is still the
identity (no scalar operand and no list before this one), and the loop's
accumulator has the lane of the first element, the fold starts at the first
element: in the interval mode `Sum(L)` of `L: list<real^3>` is `(L₁ + L₂) + L₃`.
The identity is an exact point (0 for a `Sum`, 1 for a `Product`, ∓∞ for `Max`
and `Min`), and the kernel on the identity and the first element gives that
element or a hull of it one outward step wider: the fold from the first element
gives the same enclosure or a tighter one, never a value outside it. On doubles
`1 · a`, `max(−∞, a)` and `min(+∞, a)` are `a` (−0 and NaN included), but
`0 + −0` is `0`: outside the interval mode a `Sum` starts from 0, as its loop
(`((0 + L₁) + L₂) + L₃`, so `Sum(L)` of `L = [−0, −0]` is `0`).
`Reduce(L, f, init)` starts from `init`, as its loop does; `f` is a variadic row
or a binary one, a left fold as the interpreter's (`Reduce(L, Subtract, 0)` is
`((0 − L₁) − L₂) − L₃`). A list of one element is that element, and a list of 0
elements keeps the loop (and the value of `Max` and `Min` of no element, NaN).
Builds written out are at most 4,096 elements in a program, the budget of GLSL:
past it, a build keeps its loop in the mode, where GLSL declines. `scalarize`
writes an element-wise operation of such a length one element at a time, the
list rules of `fold` then read an element of its result as the operation on the
elements, and `inline` copies a call whose result is such a list ("User
functions"): `At(S(x), 2)` of `S(t) = Cos(t + List(0, 1, 2))` is `cos(x + 1)`,
and the two other cosines are not computed. A list of a run-time length or of 17
elements or more keeps its loop and its build. `Max` and `Min` fold from -∞ and
+∞ over all their operands, and give NaN when the total count of elements and
scalars is 0; `Max(x)` and `Min(x)` of one real or integer scalar are `x` (of a
boolean or a complex number they decline: the interpreter leaves them
unevaluated). A reduction (`Sum`, `Max`, `Min`) of one literal `List` of at
least one element, each of a number type, is the reduction of its elements, with
no array and no loop: `Max(List(x, y, x·y))` is `Max(x, y, x·y)`, and
`Sum(List(a, b))` is `(0 + a) + b`, the fold of the loop, and `a + b` in the
interval mode, where the `0 +` is an exact zero (`Product(List(…))` is `Reduce`
in the canonical form and keeps the loop). On JavaScript (the interval mode
included; not in the bigint and complex modes, and never on GLSL; the internal
switch `SliceOptions.unrollSums` turns it off for a test), a `Sum` or a
`Product` with `Limits` of two integer constant bounds and 1 to 100 passes is
written out: its body is lowered once per index, the index bound to the
constant, and the terms are folded from the identity in ascending order, the
operations of the loop (`Sum(sin(k·x)/k, k = 1..3)` is
`((0 + sin(1·x)/1) + sin(2·x)/2) + sin(3·x)/3`, with no `0 +` after `fold` in
the interval mode), so that a part that reads only the index is a constant
(`(-1)^i/i`, computed once). One exception to the operations of the loop: a
constant index selects the kernel of a constant operand, so `Log(x, k)` at k =
10 is `log10(x)` and at k = 2 `log2(x)`, where the loop computes `ln(x)/ln(k)`
(`Sum(Floor(Log(x, k)), Limits(k, 10, 10))` at x = 1000 is 3, the interpreter's
value, where the loop gives 2). A term that reads no index is one value, added
once per pass. The sum keeps its loop when its body has an effect (a draw, a
read of `vars`: n copies would be n draw sites), holds a loop (a `Loop`, an
inner sum that is not written out) or calls a function on a cycle of calls, when
a term computes a complex value (`Sqrt(k)` of the constant -1, also under `Abs`,
where the loop's real kernel gives NaN; the complex mode keeps every loop) or
declines (`If(k < 0, x, Floor(Sqrt(k)))` at k = -1, whose comparison of
constants is still an operation), past the `iterationBudget`, and when the
bodies written out in the program would pass 4,096 (the budget of the builds of
GLSL, shared) or half the nodes left to lower: in a nest of constant sums the
inner ones are written out, and the outer one when they all are. The attempt
stops at the first term that holds a loop, and a sum whose term held a loop that
no limit made is not attempted again in the lowering (`looped`); a sum whose
nest of sums of constant bounds (literals, or the values that free names hold)
counts more bodies than are left is not attempted (`bodies()`); after the first
sum refused by a limit, the lowering attempts no more sums (`limited`), so a
small sum that follows it keeps its loop: in a nest of few terms each level
would double the attempts. A nest of fourteen sums of 3 terms or four of 100
compiles in about 0.1 s, where each sum tried at each term of the sums around it
took seconds or the whole memory. The passes written out are not counted by the
deadline or the `iterationBudget`, so a program made of them can run past
`timeLimit`: a host that needs a bound runs the compiled function in a worker
(the user's decision of 2026-11-16). A decline in a term after a user function
began to be lowered is the program's: the function stays registered. When the
lowering declines after it attempted to write a sum or a short list out (that
decline, or the limit of the nodes), `sliceProgram()` lowers the program again
with neither, and with the rule `'loop'` of `inline`: a program compiles when
its loops compile, and the decline reported is the loops'
(`Sum(If(k < 0, g(x), Floor(Sqrt(k))), Limits(k, -1, 3))` with a user function
`g`). An input read for the first time in a term that is refused or declines
stays a parameter of the entry: the loop reads it too; `ElementMax` and
`ElementMin` are rows that thread (`ElementMax(D, 0.3)` is a list). An
element-wise operation of lists of rank 1 has the length of its first list and
reads the others at the same index. Lengths that are numbers and differ decline
(`List(1, 2, 3)·D + List(4, 5)`, below); a length that is a value fits any
length (`resultType()`). On JavaScript, outside the bigint and interval modes,
flat lists whose lengths are not one value or equal constants (`D + E`, an error
of the interpreter that the static type `list<real>` does not show) are a build
of the operation at each index (`apply()` of `lower.ts`), whose length is
`agreedLength()` of `lower-lists.ts`: the first length plus the value 0 of the
check `rows.agree` of the two lengths (`agree()`, "Matrices"), a `RangeError`
where they differ. The build reads the check, and so does every reader of its
length (a reduction, `Length`, `At`), so `dce` keeps it; it is made once, where
the operation is, before the loop. A check of two lengths in an open region has
proved them equal: a later operation on them, or on the length of the build,
reads it again (`(D + E)·(D − E)` makes one; a check of another kind,
`rows.square`, is not read for `rows.agree`). A check of a length that an open
check proved equal to another proves those equal too, and its value 0 reads the
value 0 of that check, so that a reader that relies on both equalities keeps
both checks (`(D + E)·(E − F)` makes two, and the build reads the second only).
`knownLength()` gives the
constant a length was proved equal to, so `List(1, 2, 3)·D + List(4, 5)` still
declines. An operand that is an element-wise operation of its own length, or
such a build, is read at the index as the operation on its elements
(`elementAt()`), so the build computes each element once, as one element-wise
operation does with the operations of its shape (`fuses()` of `print.ts`). In
the interval mode the result is unspecified: a list as long as `D`, NaN where
`E` has no element. Lists of rank 2 or more read their
outer length the same way, and their inner lengths must be the same (`P + Q` of
two inputs of type `list<tuple<real, real>>`, CE-1537); when the outer lengths
differ, the JavaScript code gives a list as long as the first list, or throws a
`TypeError` when a later list is shorter. A `Multiply` of a list of rank 2 or
more (a matrix) with another list, and a `Power` of such a base, decline: the
interpreter's value is the matrix product or power (`M·N`, `M·L`, `M^s` at an
integer `s`), measured for every pair of a scalar, a list, a matrix, a vector
and a point; `M^N` and `M^0.5`, element by element in the interpreter, decline
too (the simple rule). A list of points is not a matrix: `P^2` is the power of
each coordinate (CE-1539). A matrix times scalars, and the other operations of
two matrices of one shape, are element by element, as in the interpreter. The
operands of a `Range` are reals or integers: its elements are `lo + k·step` for
`k` from 0, of the count of `rangeCount`, the interpreter's (`Range(1, N)` at
`N = 3.5` is `[1, 2, 3]`, `Range(-h, h)` at `h = 2.5` is
`[-2.5, -1.5, …, 2.5]`), integers when the first element and the step are. GLSL
has no spelling of a run-time count.

Where a view is a list (CE-1806). A `Map` or a `Filter` is an array in the code
only where the program needs the list: the result of the program, an argument of
a function of the host (`hostCall()` of `lower.ts`), an element of a list or a
tuple, a view read more than once (a local read twice), and a reader that the
pass `forward` of `passes.ts` does not rewrite. The pass runs on JavaScript, not
in the bigint and interval modes. It takes a build whose body is pure
(operations, conditionals and calls with no effect and no failure) and that one
instruction reads: an `elem` at the index of the one loop, build or filter
between them (the loop of `Sum`, `Product`, `Max`, `Min`, `Mean`, `Reduce`; a
`Map` or a `Filter` of the `Map`) when that loop runs from 0 within the length
of the build (the loop of `Dot` over the length of its other operand does not,
and keeps the array), or an `elem` that runs once for each run of the build
(only conditionals between them), is the body at that index; an `At` of a real
element that runs once (`First`, `Last`, `At` of a constant or a run-time index)
is the body at the index where it is in range, by the rule of `At`, and NaN
elsewhere. Its second half, `filters`, takes a filter of a pure body: when no
instruction reads its list, a loop that counts the elements kept (`Length`,
`All`); when one instruction reads the first element (`First`, `Find`) or none
does (`Any`), and only `0 < count` reads the count, a loop that stops at the
first element kept; when one loop of the same region reduces the list (`Sum`,
`Product`, `Mean`, `Max`, `Min`, `Reduce`), that loop over the source, its body
in the arm where an element is kept, counting them where the count is read after
it. `first(map(x => x * 2, L))` is `2 * L[0]` where `L` has an element, and
`sum(filter(map(x => x * 2, L), c => c > 2))` is one loop over `L`. The guard of
a build refuses 2^32 elements, where the guard of a loop accepts 2^32 passes, so
the program must refuse the length of the view where the build was. A length
that the program knows to be below 2^32 (the length of an input or of another
list that exists, a constant, the count of a filter, a `listlen`) needs nothing.
Another one (a count known at run time: `Range(1, n)`, `Tabulate(f, n)`,
`Repeat(x, n)`, `At(L, Range(a, b))`) is read through the operation `listlen`,
put before the build (`guardFor()`): its value is the count, and it throws the
`RangeError` of the build for a count of 2^32 or more. It is `may-fail`, so
`dce` keeps it where it is read: an `at` reads its value as the length, a loop
to the count less 1 runs to it less 1 (a loop changes once: of two such builds
that `Dot` reads, the second keeps its array), and the pass `filters` puts it
where the filter was. A build or a filter of the same count that reads the
build, after it in its region with only pure instructions between them, refuses
the count itself, so no `listlen` is put (`Map(g, Map(f, Range(1, n)))`, the
indices of a gather). An `elem` outside a loop reads no length, and no `listlen`
is put: the count is not refused, as `dce` removes a build that no instruction
reads. An `at` at a constant index that is 0 or not an integer is NaN with no
read of the length, so its build stays. A `listlen` is put only where its build
is removed, so a build that stays keeps its own guard. Only the passes put
`listlen`, and only on JavaScript, so GLSL, the interval mode and the bigint
mode have no spelling of it. A callback with an effect (a draw, a call of a
function of the host) or that can fail (`AssertPresent`) keeps the array, and so
do a reader at another index (the loop of `Sum` over a `Reverse`) and an `At` of
integers or booleans (its value out of range, NaN or `undefined`, is not a value
of the lane).

A `Sum` or a `Product` with `Limits` whose term is a flat list of numbers adds
or multiplies the terms element by element, as the interpreter does (CE-1470):
`Sum(X + i, Limits(i, 1, 3))` of `X = [0.25, 0.5]` is `[6.75, 7.5]`, and
`Sum(Which(C = U[i], i, True, 0), Limits(i, 1, 20))` of two lists `C` and `U` is
the sum, for each element of `C`, of the indexes where `U` holds it. A `Sum`
whose term is a tuple or a list of tuples, each tuple of a constant length, adds
the tuples element by element too (CE-1568): the spline
`Sum(P[Mod(k + Range(0, 1), 2) + 1]·k, Limits(k, 1, 4))` with
`P: list<tuple<real, real>>` is a list of two points. The accumulator is a tuple
(a list of tuples) of the identity, since the identity and a tuple have no sum.
A `Product` of tuples declines (`Multiply` of two tuples is not element by
element). A sum written out (above) folds the list terms from the identity with
the element-wise operation; the loop (`accumulate()`) carries a list accumulator
of the length of the term, the identity in each element before the first pass.
The length of the term must be a value made before the loop (a number, the
length of an input, of a list computed outside the sum): a length computed in
each term (`Sum(Range(1, i), …)`, or a `Range(1, u)` lowered in the term)
declines, since the accumulator has one length. As for any element-wise
operation, terms of two lengths are an error of the interpreter
(`incompatible-dimensions`) and the compiled value is unspecified. Over a range
with no term, the interpreter's value is a list of the identity only when the
static type of the sum states the length (`emptyBigOpValue()`): the loop then
gives that list. When the static type states no length and the bounds are not
two constants with at least one term, the shape of the value depends on the
bounds at run time, and the sum declines: `Sum(X + i, Limits(i, 1, N))` with
`X: list<real>` (the interpreter gives `0` at `N = 0`); with `L: list<real^2>`
it compiles and gives `[0, 0]` there. A range from a constant at most 0 to an
integer upper bound that `nonnegative()` proves `>= 0` (a `Length`) has a term:
`Sum(i X, Limits(i, 0, Length(X)))` compiles, and
`Sum(i X, Limits(i, 1, Length(X)))` declines (no term when `X` is empty). A real
upper bound is lowered through `Floor`, which `nonnegative()` does not prove.
Past the `iterationBudget` a list sum is a list of NaN (a tuple sum, a tuple of
NaN). A list of a run-time length declines on GLSL, and a selection at each
position (`Which` of a list condition) declines in the interval mode, as
elsewhere.

A JavaScript result is read-only, as the contract of `run()` states
(`docs/COMPILATION-MODEL.md`, "inputs of the shape the compiled code reads,
results read-only"): the code returns the value it built, with no copy, so a
result can be an input (`Q` is `_.Q`), hold a part of one (`List(A, B)` holds
the input points), or be a constant that every call shares. A list of at least
16 constants of any lane (counting the constants of the lists it holds) is
computed once, when the code is loaded, in `preambleOnce` (`onceLists()` of
`print-js.ts`); below 16 the array literal at each call is as fast. An
element-wise operation of lists of constants (of any length), of such values and
of constants is computed once there too (`2·List(1, 2, 3)`, `Range(1, 10)/40`),
with the lists it reads, also with `constantFold: false`; not in the `bigint`
mode, whose catch of a pole is in the entry. No code writes to an input or to
such a list: an operation builds a new array, a write to an element is an error
of the canonical form, and a list local that its block writes owns a copy (next
paragraph). GLSL and the interval mode compute no list once this way; the
interval mode's `run()` copies its inputs and its result.

A list local written in place (JavaScript; CE-1462): a `Block` local whose value
is a list of reals, integers or booleans of rank 1 and that the block writes
with `Assign(L, ReplaceAt(L, i, v))` or `AddTo(At(L, i), e)` (`L[i] += e`) has
the binding role `list`. Its declaration copies the value (`copy`,
`$0.slice()`), so the local owns its array, also when the value is an input
(`let L = H`) or a list computed once. Its writes change that array: `wix` is
the index from 0 of the index `i` of a list of `n` elements (from the end when
negative; it throws `out-of-range` for an index that is 0, not an integer or out
of range, where the interpreter gives an error; a constant index in a list of
stated length is a constant, and one out of range declines), `get` reads the
element there and `set` writes it; `AddTo` evaluates `i`, then `e`, then writes
the sum. `At(L, i)` is `getat` (`_at`, of booleans `getatu`), not `at`. The
copy, the reads and the writes are `effectful` ("Effects"): no pass merges,
moves or removes them, so no read of the array crosses a write of it, and the
lowering memo never shares a read; the SSA value of `L` does not change, and a
`Loop` or an `if` carries nothing for it. `inPlace()` checks the scope of the
local (the statements after the declaration) before the copy: no function
literal reads `L` ("read in a function literal (a capture)": the function can
run after a later write, which compiled code would show). `At(L, i)` is `getat`
and `Length(L)` the length of the array, which no write changes. Any other read
of `L` (`M = L`, `f(L)`, `List(L)`, `Sum(L)`, `Tuple(L, s)`, an argument of
`Apply`) is a `copy` of the array at the read (`symbol()`, CE-1485): the
interpreter's lists are values, so no later write changes what was read, and the
code shares no array of a written local. The value of the block, its last
statement `L` or `Typed(L, …)`, is the array itself, after every write
(`whole`). A copy is effectful, so an operation that declines an operand with an
effect (`Reverse(L)`, a lazy `Comprehension` body) declines such a read. Any
other write (`Assign(L, Append(L, v))`, a whole list, a declaration of `L` again
in the scope) declines with "a write to a constant … or to a list local", as
before. A written value whose lane is not a sub-lane of the element lane
declines, with one exception; the element lane is the declared one
(`Declare(L, 'list<real>', …)`) or that of the value. The exception (CE-1480): a
real written to a list local of integers of no declared type
(`ReplaceAt(L, 1, 0.5)` of `L = [0 for k in 1..n]`), which the interpreter
widens to a list of reals. `listWrite()` then throws `WidenList`, and `lower()`
lowers the program again with that local on the real lane from its declaration
(the copy is on the real lane): its elements before the write are the same
numbers, so every read gives the interpreter's value, and a read that needs an
integer declines as for any real. A declared `list<integer>` (the interpreter
gives an `incompatible-type` error), a complex and a boolean value still
decline. The declaration also copies a constant (`let L = C` of a
`const C = [1, 2, 3]`, shared through `preambleOnce`), which no write changes. A
write in a `Sum`, a `Product`, a `Map` or a `Filter` body to a list local
declared outside it declines, as for a scalar local. GLSL, the interval mode and
the `bigint` mode decline such a local. In a random frame these operations are
no draw sites (`LIST_LOCAL_OPS`, `seededWarnings()`); a call of a function that
writes a list local is `effectful` and counts as one (a warning
`seeded-draw-order` that a frame around such a call can give where its draws are
in order).

`ReplaceAt(L, i, v)` as a value (`replaceAt()`; CE-1487), not the right side of
the write of a list local: of a flat list of reals, integers or booleans and a
scalar `v` of the same kind, the build whose element at `wix(n, i)` is `v` and
whose other elements are those of `L` (an integer list and a real `v` give a
list of reals, as the interpreter's). It is pure: `L` is not changed. A constant
index of a list of stated length is a constant; one that is 0 or out of range
declines (the interpreter leaves `ReplaceAt` unevaluated). An index known at run
time is `wix` (it throws `out-of-range` for an index that is 0, out of range or
not an integer, where the interpreter gives an unevaluated form or an error), on
JavaScript only (`bwix` in the `bigint` mode): GLSL and the interval mode
decline it. On GLSL, which builds no list, a constant index of a list of a
constant length is the list of its elements. A boolean value in a list of
numbers, or the reverse, and a complex value decline; so do several indexes
(`ReplaceAt(M, i, j, v)`).

A list local written whole (JavaScript; CE-1481): a `Block` local whose value is
a list, each write of which in its scope is `Assign(L, value)` (`rebuiltOnly()`:
no `ReplaceAt(L, …)` value, no `AddTo`, no parallel assignment, no write in a
function literal, no declaration again), is a `local` binding with `whole`
(`wholeLocal()`): a list of reals, integers or booleans of rank 1, or a list of
points of reals or integers (marked a tuple on its inner axis), of the declared
type or of the type of its value; a declared `List()` is an empty build of that
type (a stated length is at least 1). Each write is a new SSA value, as for a
scalar local (`fitWhole()`): the same rank, the same lengths after the first and
the same tuple mark, of a sub-lane, and any first length; another value declines
("a value of type … written to a list local of type …"). A real list written to
a list of integers of no declared type throws `WidenList`, as above, and the
local is on the real lane from its declaration. No array is written, so the
local has no alias rule and no copy: `M = L` and `f(L)` read the value. A `Loop`
carries two values for such a local, its length (an integer) and the list whose
type names it (the verifier reads the initial value, the yield and the result of
the list at the length carried before it); `branch()` joins two lengths of such
a local's list of points as it joins flat lists (a length result before the
list), and a random frame (`seededFrame()`) gives the length of a list made in
it as a result before the lists. The gasket's `fillGap` and `generations`
(`out = [...out, (…)]`, `out = fillGap(…, out)`,
`out = [...take(out, i), c, ...drop(out, i)]`) compile this way. A local with
both a whole write and a write in place declines with the cause of the paragraph
above; so do a point written whole and an empty list of no stated type (no
lane). GLSL (no run-time length), the interval mode and the `bigint` mode
decline such a local.

A list operator that declines an effect in an element, in its function or in a
list operand, because the interpreter evaluates fewer elements, in another order
or lazily (each "with an effect declines" of this section, and `Zip`), does not
count a read of a `vars` name (`Builder.changes()`): a `vars` entry is a value,
the same at each read (the compile guide), and no instruction of the program
writes it, so each read gives the value of the name that the interpreter reads
once (`CountIf(L, t ↦ t > T)` with `vars: {T: …}` compiles; CE-1612). A draw, a
write and a call of a function of the host still decline. The text is still read
at each use, once per element evaluated; a text with an effect (`'_.draw()'`)
runs that many times, and its result is unspecified, as the guide says.

`Comprehension(body, Element(i, L))` is a build of `body` over the source of `L`
(a list, a `Range`); with a condition, `Element(i, L, cond)`, it is a `filter`
of `L` by `cond`, then a build of `body` over the elements kept. The
interpreter's list is lazy: it evaluates the condition and the body of an
element only when the element is read (`Length` reads none), so a condition or a
body with an effect declines (`Length(Comprehension(Random(), Element(z, D)))`
draws nothing in the interpreter). A call of a user function that has no effect,
also of a recursive one (`may-fail`), is not one: the instructions of the
function's body, among them its recursive call, whose effect is not known while
the body is lowered, are not counted as the caller's (`Builder.define()`), so
`Comprehension(r(i), Element(i, Range(0, 5)))` of
`r(k) := Which(k ≤ 0, 0, True, s + r(k − 1))` compiles. The compiled elements
are computed eagerly, as those of any `may-fail` body: an element that the
interpreter does not read is computed too
(`At(Comprehension(r(i), Element(i, Range(0, 300))), 2)` computes `r(300)`, past
the interpreter's recursion limit), and one past the JavaScript stack throws a
`RangeError`. A call of a function in a `Comprehension` of its own body
declines: the effect of that call is not known there. Two clauses or more,
`Element(i, L)` each, are the interpreter's flat list over the Cartesian
product, the last index the fastest
(`Comprehension(10k + j, Element(k, Range(1, 2)), Element(j, Range(1, 3)))` is
`[11, 12, 13, 21, 22, 23]`): one build over the product of the lengths, whose
index `k` gives the index of clause `j` as `Floor(k / s_j) mod n_j`, with `s_j`
the product of the lengths after it. A clause whose list reads an earlier index
(`Element(j, Range(1, k))`), a clause with a condition, and an effect in a
clause list or in the body decline (the interpreter evaluates a list once for
each element of the clauses before it).

`ListJoin(L1, …, Ln)` of lists and scalars (a scalar is an element) is a build
over the sum of the lengths, whose element at `k` is read from the first list
whose end is after `k` (a chain of `n − 1` tests per element); its lists are of
numbers, or all of points. On GLSL it declines (a build). `Join` of operands
whose static types are lists is the same build (`Join(L, M)`, `Join(L, x)`,
whose scalar the canonical form puts in a `List`); an operand of another type
declines, since the interpreter's `Join` appends a tuple as one element, and of
sets is a set, of strings a string.

`Repeat(v, n)` is a build of `n` copies of `v`. A pure value is lowered once
before the build. The interpreter evaluates a value that is not pure once per
element, in order, and not at all for a count of 0, in every position (CE-1396),
so such a value is the body of the build, as the body of
`Map(_ ↦ v, Range(1, n))`: `Repeat(Random(), 3)` is three draws, and a short
list keeps its loop on JavaScript. A write to an outer local in the value
declines, as in a `Map` body, and so does a draw on GLSL. The count is that of
`Range(1, n)` (`rangecount`): 0 below 1, the floor of a real count (a count that
is not an integer is an error of the interpreter, unspecified); a constant count
is a stated length, so a short list is written out (`Repeat(-1, 2)` is
`[-1, -1]`). A run-time count that is NaN (a bound with no value:
`Range(1, Ceil(Log(a)))` at a negative `a`, the digits of a number in Tycho's
documents) is an empty list on JavaScript (`rangecount` is
`_SYS.rangeCount(…) || 0`), where the interpreter leaves the `Range`
unevaluated. An infinite count still throws. The length guard of a build applies
to a run-time count: one of 2^32 or more throws on JavaScript and is `entire` in
the interval mode, where the interpreter keeps the list lazy; a constant count
of 2^32 or more throws on JavaScript and declines in the interval mode (a list
whose length is not one number). On GLSL a count known at run time declines
(`rangecount`), as do a count below 1 and one above 64 (a build). `Repeat(v)`
(an unbounded list) and a value of a run-time length (a list of lists of
run-time length) decline.

`Iterate(f, x0)` is an unbounded list, read through `Take(Iterate(f, x0), m)`
(the first `m` elements), `At(Iterate(f, x0), i)`, `First`, `Second` and
`Third`: the region `iterate` (`iterated()` of `lower-lists.ts`), a loop of `m`
passes, or of `Max(i, 0)` for an `At`, whose accumulator is a variable that each
pass sets to its element and writes into the list, from `x0`. Its element `k` is
`f(k, element(k − 1))`, or `f(element(k − 1))` when the value of `f` requires
one argument, the choice of the interpreter's `iterateArgs()`: a literal by its
signature, a user function by the required parameters of its literal (a name
declared `function` that holds a unary literal is unary; `s` declared
`(real, real = 2) -> real` with a literal of two parameters is called with two),
a library operator by its signature (`Sin` is unary). `At` of an index below 1
is NaN, where the interpreter gives `Missing`. The accumulator and the elements
are real or integer scalars: an integer `x0` keeps the integer lane when `f`
gives an integer of an integer (a trial lowering, not emitted, settles it:
`a ↦ a/3` from 1 is real). With no `x0`, a function of two parameters whose body
does not name its second compiles (`Iterate((i, a) ↦ i²)`, the interpreter's
`[1, 4, 9, …]`); another declines (the first accumulator is `Nothing`). A count
or an index that is not an integer declines (the interpreter rounds a real count
of `Take`); a negative constant count declines and a negative count at run time
throws (`_present`), where the interpreter leaves `Take(Iterate(…), −2)`
unevaluated. Declined: an effect in `f` or `x0` (the interpreter's list is lazy
and memoized), a list or a tuple accumulator, a complex or a boolean element,
`Last` and every other consumer (`Drop`, `Length`, `Sum` of the unbounded list),
GLSL and the bigint mode (no spelling of the region) and the interval mode.

`Map(f, L1, …, Ln)` of two lists or more is the interpreter's list as long as
the shortest list (`Map((a, b) ↦ a + b, [1, 2, 3], [10, 20])` is `[11, 22]`): a
build over the `Min` of the lengths (the least stated length, and the length
values; on GLSL a constant, so the elements are written out as for one list)
whose body binds each parameter to the element of its list at the index. The
callback is a function literal of `n` parameters of distinct names (a named
function such as `Map(Add, A, B)` declines, and so does a name written twice, of
which the interpreter binds the first; the canonical form makes a literal of
another arity and a scalar source an error); a tuple source and a list with an
effect decline (the interpreter reads the lists up to the shortest). In the
interval mode lists of run-time lengths decline, as for `Zip`. `ListFrom(L)` of
one list (a list of numbers, of points, of colours; a `Range`, a `Map`, a
`Filter`, a `Zip`, a call) is `L`: every list of the slice is listed. Of a
scalar, a tuple, a string or several operands (a list of one element, of the
elements, of the characters, the concatenation, in the interpreter) it declines.
`At(L, I)` of a list of numbers or of points `L` and a list of numbers `I` (not
a tuple) is the build of `At(L, i)` over `I`, each index under the rule of `At`,
as the interpreter's and as `Map(i ↦ At(L, i), I)`
(`At([10, 20, 30], [1, -1, 0, 2.5])` is `[10, 30, NaN, NaN]`; of points, a point
of NaN out of range, on JavaScript only); of a list of booleans (an index out of
range would put `undefined` in a list of booleans) or of lists it declines, and
so does an `At` of two index operands, one of them a list. `At(L, M)` of a flat
list `M` on the boolean lane (a mask) and a list of numbers or of points `L` is
a `filter` over the `Min` of the two lengths (as for `Map` of several lists),
keeping `L[k]` where `M[k]`, as the interpreter's: a mask shorter than `L` keeps
nothing past its end, and a longer one is read only as far as `L` goes
(`At([1, 2, 3, 4, 5], [True, False, True])` is `[1, 3]`). A list of 0 and 1 is a
list of numbers, not a mask; an index typed as a union declines. A list on the
boolean lane holds only true and false, so no compiled mask has an undefined
member (the interpreter's `Missing` or `NaN` member, which keeps nothing, comes
from forms that decline: a `Which` with no default, a literal `Missing`). The
rows that make a mask thread as the interpreter's: `Equal` and `NotEqual` of a
list and a scalar (`L[K = 1]`; of two lists the interpreter compares the lists,
one boolean, `equality()` below; a chain of three operands with a list
declines), and `Not`, `And` and `Or` of lists, with a scalar broadcast
(`And(False, M)` is a list of false); an `And` or an `Or` of a list lowers every
operand, and one with an effect declines. Lists of two run-time lengths are
compared at run time ("Lists"): a `RangeError` where they differ, the
interpreter's `incompatible-dimensions`. In the interval mode such an `And` or
`Or` has the first operand's length. `Not` of a tuple
of booleans (`Not(Tuple(p, q))`) is the tuple of the negations, as the
interpreter's. A mask or a base of a mask with an effect declines: the
interpreter reads a lazy base at the kept positions only
(`At(Map(k ↦ k + Random(), A), M)` draws twice for two kept positions). On GLSL
a list of booleans of a stated length is a `bvec` (`Or(M3, L3 > x)`), and the
filter declines; in the interval mode a mask element undecided over the box
gives the whole range, as for `Filter`. `Clamp(x, lo, hi)` is
`ElementMin(ElementMax(x, lo), hi)`, the interpreter's `min(max(x, lo), hi)`:
`hi` when `lo > hi` (on GLSL `min(max(…))`, not `clamp()`, whose value is
undefined there), integers stay integers, and each operand threads over a list
(`At(L, Clamp(Floor(I), 0, +∞))` is the floored index of each element of `I`,
NaN below 1).

`Equal` and `NotEqual` of two lists, of two tuples and of two booleans
(`equality()` of `lower.ts`, CE-1532) have no row signature. Two lists, or two
tuples, of real numbers are compared as the interpreter compares them: one
boolean, true when they have the same length and each element equals the element
at its index. The elements are compared as two numbers are (the exact equality
of compiled code, no tolerance; a NaN element equals nothing, so `Equal(L, L)`
of a list with a NaN is false, as the interpreter's). Two stated lengths that
differ are the constant `false` (`Equal(P, T)` of a point of two and a point of
three coordinates); two equal stated lengths are the conjunction of the
comparisons (`(P[0] === Q[0]) && (P[1] === Q[1])`; a loop on GLSL); with a
run-time length, the code tests the lengths and compares the elements up to the
shorter list in a loop (JavaScript and the interval mode; GLSL has no list of a
run-time length). Two booleans are equal when both hold or neither does,
`(a && b) || (!a && !b)`, with the rows `And`, `Or` and `Not`, so a list of
booleans and a boolean thread (`Equal(B, b)` is a mask) and the interval mode
gives the Kleene verdict (`'maybe'` for an undecided operand). `NotEqual` is the
negation. A chain of booleans is the conjunction of its pairs. Declined: a tuple
and a list, and a tuple and a scalar (the interpreter gives `False` whatever the
elements); lists of lists and lists of points; two lists or two tuples whose
elements are booleans (`Equal(Tuple(True), Tuple(True))`), complex numbers,
strings or colours; a boolean and a number; and a chain of three operands or
more with a list or a tuple, whose value in the interpreter is not the
conjunction of its pairs (`Equal(L, L, 3)` is `False`).

`If` and `Which` of a condition whose static type is a list of booleans
(`Which(3 < L, 1, True, 0)`) are the interpreter's selection at each position
(`numpy.select`, `select()` of `lower.ts`): a build over the length of the first
condition whose element is the first arm whose condition holds there, a list arm
read at the position and a scalar or a point (a condition or an arm) the same at
every position, NaN (a point of NaN) where no condition holds and there is no
clause `True` (`Which([2, 5] > 3, 1)` is `[NaN, 1]`); `If(c, a, b)` is
`Which(c, a, True, b)`, as in the interpreter. An `If` of a list condition with
no `else` is that selection for a scalar or a point arm (`If(3 < L, 1)` is
`[NaN, 1, 1]` at `L = [2, 5, 7]`). For a list arm (of numbers or of points) it
is a restriction, as in the interpreter: the selection ends at the shorter of
the mask and the arm (`If(3 < L, K)` is `[1, 2]` at `L = [5, 5, 5]`,
`K = [1, 2]`). An `If` of a scalar condition with no `else` whose arm is a flat
list of numbers or a list of points has, where the condition is false, the list
of NaN (of points of NaN) of the length of the arm; a length made in the arm
(`If(0 < x, Range(1, Floor(x)))`) is not visible in the other arm, and declines.
The interpreter's value there is `Missing`, which `IsMissing`, `Coalesce`,
`AssertPresent`, `Length` and `Rest` read as absent, and a compiled list is
never absent: such an `If` compiles only where no operator can tell the list of
NaN from an absent list (`nanForAbsent()` of `lower.ts`). These places are: the
result of the program (the root, an arm of such an `If` or `Which`, the last
expression of such a `Block`); the list that `First`, `Last`, or `At` with
indexes that are numbers reads (an element is NaN or a point of NaN, the absent
element); an operand of `Max`, `Min`, or of a `Sum` or a `Product` with no index
(the value is NaN); an operand of an operator row, the body of a `Sum` or a
`Product` with an index, or the list that an `At` with a list or a `Range` as
index reads, when the value of that call is in one of these places too
(`At(2·If(0 < x, L), 1)`, not `Length(2·If(0 < x, L))`); and an arm of an `If`
or a `Which`, or the last expression of a `Block`, whose value is in one of
these places. In any other place (a discharge, `Length`, `Rest`, another list
operator, a binding, an argument of a function, an element of a list) it
declines. One boxed `If` in several places must be in such a place each time.
The value of a name that the program reads (`expression()`) is in such a place
when each occurrence of the name in the program is (`readers` holds the symbols
too), and no value of another name and no body of a user function that the
program reaches has the name (`heldAsAbsent()`); a new name that holds the
value, or a read of it from another value, checks again each `If` of the entry
whose list of NaN was already accepted (`nanAccepted`). The conditions, the arms
and the default are lowered once, before the build, all of them: the interpreter
evaluates an arm and a later condition only where the selection reaches it, so
one that is not pure (an effect, a write to a name, an operation that can throw
such as `AssertPresent`, a loop, a recursive call) declines. Two exceptions
(CE-1562). A `Range` arm is read at each position (`lo + k·step`) and is never
built. A list that an arm or a later condition builds (`Map`, `At` of a list of
indexes) is accepted when it has the length of the first condition, or, in a
later condition with no scalar condition before it, the length of that
condition: a build fails only at 2^32 elements or more, the first condition
exists, and the interpreter evaluates every list condition up to the first
scalar condition that holds. A build of another length in an arm declines
(`Which(3 < L, Max(Range(1, x)), True, 0)`). The first condition reached must be
a list: a scalar condition before it selects its arm whole when it holds, a
value of another shape (its static type is a union), and declines. Arms are all
numbers or booleans (with a clause `True`: without one, the interpreter gives
`Missing`) and flat lists of them, or all points of numbers and lists of points
(on GLSL a list of points of a constant length is an array of vectors, below;
another declines). Stated lengths that differ decline (the canonical form
already gives `incompatible-dimensions` for most); lists of two run-time lengths
are an error of the interpreter (`incompatible-dimensions` for `Which` and for
`If` with an `else`), so the value is unspecified: a list as long as the first
condition, never an arm whole (CE-1238). A condition or an arm that is an
element-wise operation of two lists of run-time lengths compares them
("Lists") once, before the selection, and its build is accepted
(`If(L > 0, L·M, 0)`). Such an arm of another length than the mask (except in
a restriction, which zips them) is compared with the mask by the same `agree()`,
and the length of the selection reads that check: `If(N > 0, L·M, 0)` makes two
checks, and `If(L > 0, L + List(1, 2, 3), 0)` reads the one of the arm; a mask
and an arm of two stated lengths decline. A check throws also where no position
selects the arm, where the interpreter has a value (a known limitation). An
arm that compares no length (`If(N > 0, L, 0)`) is not compared with the mask.
A condition after the first that compares lengths is accepted only when its
length, without the check, is the mask's. On GLSL a stated length writes the
selection out (`vec3` of three conditionals); a run-time length declines. The
interval mode declines it.

`RandomShuffle(L)` of a list of numbers is `_SYS.shuffle`, and
`RandomChoice(Interval(0, 1), n)` (either end open or closed) is the region
`choice`, `_SYS.randomChoice`, whose results are the count and the list: the
draws, their count and their order are the interpreter's (a count that is not
one in 0..10^6 after `Math.round()` throws there; the interpreter gives an
error). Each is one draw site ("Effects"). `RandomChoice` of another domain, and
`RandomShuffle` of a tuple, of a list of points or of booleans, decline; GLSL
has neither.

The list operators (`lists.collection()` of `lower-lists.ts`; `First`, `Second`,
`Third` and `Last` in `lower.ts`) are built from the operations above, with the
interpreter's value for every length, also 0:

- `First(L)`, `Second(L)`, `Third(L)` and `Last(L)` are `At(L, 1)`, `At(L, 2)`,
  `At(L, 3)` and `At(L, -1)`, also of a tuple, under the rule of `At` (NaN out
  of range on JavaScript, where the interpreter gives `Missing` for an empty
  list; a point of NaN of a list of points). `Count(L)` is the length,
  `Count(L, f)` the count of a `filter`, `IsEmpty(L)` the test of a length 0.
- `Rest`, `Most`, `Reverse`, `Take(L, m)`, `Drop(L, m)`, `RotateLeft(L, m)` and
  `RotateRight(L, m)` (`m` 1 by default) are a build of the elements of `L` at
  the indices they keep (`Take(L, -2)` the last two, `Take(L, 7)` of three
  elements all three, `Drop(L, 5)` none, a rotation modulo the length), of a
  list of numbers, of points, or of the elements of a tuple (the interpreter's
  value is a list). A real count `m` of `Take` and `Drop` is rounded as the
  interpreter's `toInteger()` (`Math.round`, the operation `count.round`:
  `Take(L, 2.5)` keeps 3 elements, `Take(L, -2.5)` the last 2; an infinite count
  keeps all or none); GLSL and the interval mode decline a real count known at
  run time. A real count of a rotation (a slider of Tycho, `RotateLeft(S, N)` of
  `N: real`) is tested at run time on JavaScript (`count.int`, the helper
  `_count`): a rotation whose elements are read throws where the count is not a
  safe integer (the interpreter gives `incompatible-type` at 2.4, and leaves the
  rotation unevaluated at 1e20); the test is an effect `may-fail`, so
  `Length(RotateLeft(S, N))` reads the length and tests nothing. The count is
  reduced modulo the length before the build, as in the interpreter. GLSL and
  the interval mode decline a real count. A list with an effect declines (the
  interpreter reads the elements it keeps only). A constant length and constant
  indices write a short list out, so GLSL compiles them for an input of a stated
  length (`Reverse(L)` of `L: list<real^4>` is a `vec4`); a run-time length
  declines there, and a run-time count of a rotation is a modulo of the index
  (`RotateLeft(L, n)` of `L: list<real^3>`).
- `Mean(L1, …)` is the sum from 0, in order, of the elements and the scalars,
  divided by their count: the interpreter's `mean()`, NaN of no element; of
  complex numbers it declines. `Median(L)`, `Sort(L)` and `Ordering(L)` of one
  list of real or integer numbers are the operations `median`, `sort` and
  `ordering`, the JavaScript helpers `_median` (the interpreter's `median()`,
  NaN when an element is NaN), `_sort` and `_ordering` (NaN last, stable, as the
  interpreter's); `Sort` of a tuple or of several operands declines.
  `Sort(L, f)` of a function of one parameter (a literal, a user function, a
  library operator of one operand) sorts by the key: the elements of `L` in the
  order of `Ordering(Map(f, L))`, each key computed once, in order, as the
  interpreter's; a key that is not a real number declines. Of a function of two
  parameters (a comparator, also `Subtract` or a user function of two
  parameters) it is the region `sortby`: the indices sorted by
  `Array.prototype.sort` with the comparison the region yields, -1 where the
  comparator gives `True` or a negative number, 0 for 0 and NaN, 1 otherwise,
  and a NaN element last whatever the comparator, so the permutation is the
  interpreter's (`sortedIndicesWalk()`), also for a comparator that is not an
  order (`(a, b) ↦ |a| ≤ |b|`). The choice between a key and a comparator is the
  interpreter's: a key when the value of `f` requires one argument (a user
  function by the required parameters of its literal, so `(a, b = 0) ↦ …` is a
  key, a library operator by its signature), a comparator otherwise, so
  `Sort(L, Floor)` (whose second parameter is optional) is a comparator, and
  declines, since `Floor` does not take two arguments in the compiled code.
  Elements that are not real numbers, a comparator with an effect and a variadic
  library operator (`Max`) decline; JavaScript only. `Unique(L)` is a `filter`
  of the elements that no earlier element equals (NaN equals NaN, as in the
  interpreter): a loop over the elements before, quadratic in the length. GLSL
  has none of these four operations.
- `Variance(L1, …)`, `PopulationVariance`, `StandardDeviation` and
  `PopulationStandardDeviation` read the elements and the scalars of `Mean` in
  two passes: the mean, as `Mean`, then, of the deviations `d` from it, the
  corrected sum `Σd² - (Σd)²/n` (it cancels the rounding of the mean: data with
  a large common offset, `[2^52, 2^52 + 1]`, give `0.5`, and constant data give
  exactly 0, as the interpreter), at least 0, divided by `Max(n - 1, 0)` for a
  sample and by `n` for a population, and the square root of that for a
  deviation. No element, and one element of a sample, are `0/0`, NaN, as the
  interpreter's (a divisor that is the constant 0 is the constant NaN); a NaN or
  an infinite element is NaN. The interpreter keeps an exact value of exact data
  (`StandardDeviation([3, 1, 3])` is `2/3·√3`); the compiled value is its
  numeric value. The interpreter scales data whose squares would overflow or
  underflow (`[1e200, -1e200]`), which the compiled code does not: a known
  limitation, as for `Norm`. Complex elements and a distribution decline. GLSL
  compiles them for a list of a stated length.
- `Mode(L)`, `Skewness(L)`, `Kurtosis(L)`, `Quartiles(L)` and
  `InterquartileRange(L)` of one list of real or integer numbers, and
  `Covariance(L, M)`, `PopulationCovariance(L, M)` and `Correlation(L, M)` of
  two (`statistic()`, CE-1532; JavaScript only), are the interpreter's kernels
  of `numerics/statistics.ts`, one operation each (`mode`, `skewness`,
  `kurtosis`, `quartile1` and `quartile3`, `covariance`, `pcovariance`,
  `correlation`; members of `_SYS`). `Quartiles` is the tuple of `quartile1`,
  `median` and `quartile3` (so `At(Quartiles(L), 3)` reads the upper quartile),
  and `InterquartileRange` is `quartile3 - quartile1`. The mode of several
  values that occur equally often is the smallest one; a quartile is the median
  of the lower or of the upper half of the sorted list, without the median of an
  odd count, and the element itself for a list of one. NaN where the interpreter
  gives NaN or an error: a NaN element (every statistic); no element; an
  infinite element, one element or equal elements for `Skewness` and `Kurtosis`;
  lists of two lengths and fewer than two pairs for the last three; a list of
  equal elements for `Correlation`. An infinite element is ordered and counted
  as a number by `Mode` and by the quartiles, as the interpreter's
  (`Mode([+∞, +∞])` is `+∞`). The interpreter keeps an exact value of exact data
  (`Covariance([1, 2, 4], [2, 5, 9])` is `16/3`); the compiled value is its
  numeric value. Declined: several operands or a scalar operand for the first
  five (the interpreter reads them as the data), one list of pairs for the last
  three, a tuple, complex elements, GLSL (no spelling of the operations) and the
  interval mode (`<head> on interval-js`).
- `Any(L, p)` and `All(L, p)` (`p` a literal of one parameter, a user function
  or a library operator of one operand), and `Any(L)` and `All(L)` of a list of
  booleans, are the count of a `filter` of `L` by `p` (by its elements),
  compared with 0 or with the length: an empty list is `False` and `True`.
  `Contains(L, v)` and `IndexOf(L, v)` of a list of real or integer numbers and
  a real `v` are a `filter` of the indices whose element is the same double as
  `v` (equal, or both NaN; `-0` is `0`): `Contains` is a count above 0,
  `IndexOf` the first index kept plus 1, or 0. The interpreter compares exact
  values (`1/3` is not its double, `3·0.1` of a `Range` is `0.3`), so the search
  compiles only where the doubles are its values: a list of integers and an
  integer, or inputs, float literals and lists of them; another operand
  declines. The interpreter stops at the first element that decides, so a list
  or a predicate with an effect declines; the compiled code tests every element
  (a predicate that fails after the deciding element is a known limitation).
  GLSL (a filter) and the interval mode decline them.
- `Dot(u, v)` of two lists of real numbers or points of one length is the sum
  from 0 of the products of their elements (of two stated lengths that differ it
  declines); of a list of points and a point, or of two lists of points pair by
  pair, the list of those sums, as the interpreter broadcasts. Two lengths that
  are not one value are compared by `agree()` ("Matrices") on JavaScript: the
  sum starts from the value 0 of the check, and a stated length beside a
  run-time one keeps the sum written out (`Dot(L, List(1, 2, 3))`). Out of a
  loop that can run no pass (the body of a `Map` over a list, a `Sum` to `n`),
  `invariants` moves the check under the guard that the loop runs a pass, its
  value 0 elsewhere, and the sum that reads it after it, so that
  `Map(x ↦ x·Dot(L, M), L)` and `Sum(i·Dot(L, M), i, 1, n)` compute the sum
  once; a loop of no pass gives the interpreter's value, whatever the lengths.
  A check in an arm of a conditional or of a short circuit stays there.
  `Norm(x)` of a
  real or a complex scalar is `Abs(x)`; of a point or a list of points, `Abs`
  (the Euclidean norm); of a list of real numbers, of the order 2 (by default)
  the square root of the sum of the squares (the interpreter's sum of squares;
  it scales a vector whose squares would overflow or underflow, which the
  compiled code does not: a known limitation), of the order 1 the sum of the
  absolute values, of the order `Infinity` their `Max` from 0. Another order (an
  order that is not a positive number also for a scalar), a matrix and complex
  elements decline.

The list operators of CE-1531, on JavaScript (`more()` of `lower-lists.ts`), are
built the same way, with the interpreter's value for every length, also 0:

- `Append(L, x1, …)` is the build of the elements of `L`, then the `x`s: each is
  one element, a number or a boolean of a list of the same kind, or a point of a
  list of points of its dimension (a list or another tuple declines: the
  interpreter appends it as one element).
- `DeleteAt(L, i)` and `Insert(L, i, x)` read `i` as `At` does (from 1, from the
  end when negative; for `Insert` among the `n + 1` positions, so `-1` appends).
  A constant index of a stated length is a constant, one that is 0, out of range
  or not an integer declines; an index known at run time is `wix`, which throws
  where the interpreter leaves the form unevaluated or gives an error
  (JavaScript only). Of a flat list of numbers or booleans.
- `Slice(L, s, e)` is the interpreter's `computeSliceBounds()`: real indices
  rounded (`count.round`), a negative index counted from the end, the start at
  least 1, the end at least 0 and at most the length (`Slice(L, 0, 2)` is the
  first two elements, `Slice(L, 2, 0)` empty). `Slice(L, r)` of a span declines.
- `Linspace(a, b, c)` is the build of `c` elements (`linspace.count`: the floor,
  at least 0, 50 when it is not finite; 50 by default, and `Linspace(b)` is
  `Linspace(1, b)`), the element `k` of the interpreter's `linspaceSample()`
  (`linspace`, the helper `_linspace`).
- `Chunk(L, k)` and `Partition(L, m)` are a list of lists when every row has one
  length: a stated length and a constant count that the rows divide (`chunks()`
  of `lower-lists.ts`). `Partition(L, m, step)` of a constant `m` and a constant
  `step` (one known at run time can be below 1, where the interpreter leaves the
  form unevaluated) is the complete windows, `Max(Floor((n − m)/step) + 1, 0)`
  rows of `m` elements; a size `m` known at run time declines. Rows that can
  have two lengths (`Chunk(L, 2)` of `L: list<real>`, a short last chunk,
  `Partition(L, p)` of a predicate) have no shape: as the result of the program
  they are the lane `rows` ("The rows lane"), and a consumer reads them one by
  one, each row a build over `L` made where it is read (`source()`): `Map` (also
  of several lists), `Comprehension`, `Length`, `Count`, `IsEmpty`, `Reduce`,
  `CountIf`, `Position`, `IndexWhere`, and `At` of a constant index in range of
  a constant count (`At(Chunk(L, 3), -1)`). `Chunk(L, k)` has `k` rows of
  `⌈n/k⌉` elements, the row `i` of `Max(0, Min(⌈n/k⌉, n − i·⌈n/k⌉))`;
  `Partition(L, m)` has `⌈n/m⌉` rows, the row `i` of `Min(m, n − i·m)`. A count
  known at run time is checked where it is read (`rows.chunks`, `rows.size`: a
  `RangeError` below 1, and above `MAX_CHUNK_COUNT`, 10,000, for `Chunk`, where
  the interpreter leaves the form unevaluated); a constant there declines, also
  for rows of one length. The groups of a predicate are read by `Length`,
  `Count` and `At` only: the interpreter leaves `Map` of them unevaluated, so
  every other reader declines. A consumer whose value holds a row
  (`Map(r ↦ r, Chunk(L, 3))`) makes the lane `rows` on JavaScript ("The rows
  lane"); `ListJoin` and `Join` of such rows decline ("a list of lists of
  run-time length"). On
  GLSL a consumer compiles only when every row has a constant length of at least
  1 (`Map(r ↦ Sum(r), Partition(L6, 4))` of `L6: list<real^6>`).
- `TakeWhile(L, p)` and `DropWhile(L, p)` split `L` at the first index of a
  `filter` of the indices where `p` fails, or at the length. `CountIf(L, p)` is
  the count of the `filter` of the indices where `p` holds, `IndexWhere` its
  first index plus 1 or 0, `Find` the element there or NaN (of real numbers
  only), `Position` the indices plus 1. As for `Any`, the compiled code tests
  every element, and a predicate or a list with an effect declines.
- `ArgMax(L)`, `ArgMin(L)` and, by a key `f` of one parameter, `ArgMax(L, f)`,
  `ArgMin(L, f)`, `MaxBy(L, f)` and `MinBy(L, f)` (`extremum()`): the keys (the
  elements, or the build of `f` over `L`, each key computed once, in order),
  their `Max` or `Min`, then the least index whose key equals it, a `Min` loop
  over the indices: the first of equal keys, as the interpreter's
  `extremumBy()`. `ArgMax` is that index plus 1, `MaxBy` the element there, a
  real number or a point. Where the interpreter leaves the form unevaluated (no
  element, or a NaN key among two elements or more), `ArgMax` is 0 and `MaxBy`
  NaN (a point of NaN): the index loop gives -1 for a key that is neither the
  `Max` nor below it, so the answer does not depend on what the `Max` of the
  target gives for a NaN (GLSL's `max` does not give NaN). That NaN is not an
  absent value, so a discharge (`IsMissing`, `Coalesce`, `AssertPresent`) of
  `MaxBy` or `MinBy` declines (`absent()` of `lower.ts`). A list of one element
  gives that element whatever its key (the interpreter compares no key then). A
  key with an effect compiles, as for `Sort` by a key: where the interpreter has
  a value, it computes each key once, in order. A key that is not a real number
  (the interpreter orders strings) and an element of `MaxBy` that is not a real
  number or a point decline; so does `ArgMax(f, domain)`, the locations of a
  maximum over a set, which the interpreter does not evaluate. No filter is
  used, so GLSL compiles them for an input of a stated length
  (`ArgMin(L, t ↦ |t − a|)` of `L: list<real^4>`).
- `FlatMap(L, f)` of a scalar value is `Map`; of a list of a constant length
  `m`, the build of the `n·m` elements of the rows in order. A row of a length
  known at run time and a tuple decline.
- `Scan(L, f)` and `Scan(L, f, x0)` (an `x0` with an effect declines, as for
  `Reduce`: the interpreter evaluates it only when it reads an element) are the
  region `iterate` over the length of `L`: the element `k` is `f(acc, L[k])`,
  and without `x0` the first element is `L[0]`. `Reduce(L, f, x0)` of a function
  literal or a user function of two parameters is a counted loop of
  `f(acc, L[k])` from `x0`; `Reduce(L, f)` seeds it with `L[0]` and runs from
  the second element (of an empty list it throws `out-of-range`, where the
  interpreter gives `Nothing`). An integer start keeps the integer lane when
  every step gives an integer (a trial lowering, not emitted, as for `Iterate`).
  The accumulator of `Reduce` can also be a Boolean (a boolean carried value), a
  flat list of reals, integers or Booleans, or a tuple of scalars: the loop
  carries it as it carries a list local written whole ("Lists"). A list of a
  stated length, a tuple always, is one carried value of that length, which
  every step must keep; otherwise (a `Map` of a run-time length, or `List()`,
  whose element type is the body's, found by a trial lowering) it is carried as
  its length then the list, on JavaScript only (not GLSL); in the `bigint` mode
  the length is a `bigint`. The interval mode declines every `Reduce` by a
  function.
- `Tabulate(f, n1, …, nd)` (also `Table` of one index from 1) is the nested
  builds of `f(i1, …, id)` at the indices from 1; a count below 1 is empty, a
  real count is tested at run time (`count.int`), the inner counts must be
  constants, and a body with an effect declines.
- `Element(x, L)` is `Contains(L, x)`. `StartsWith`, `EndsWith` and
  `ContainsSequence` of two lists of real numbers test the elements of the
  needle with `same()` (NaN matches NaN) at the offset 0, `n − m`, or each
  offset of a `filter`, under the operands rule of `Contains`.
- `Identity(x)` is `x`; `ApplyWhole(f, x1, …)` binds each parameter of a
  function literal of untyped parameters to its argument whole, and of a library
  operator is the call `f(x1, …)`.
- `RandomSample(L, k)` (a draw, so a node that holds one is never closed nor
  evaluated at compile time) is the region `sample`, `_SYS.randomSample(n, k)`,
  the indices that the interpreter's sparse Fisher-Yates draws (`k` draws, in
  order; a count that is not in `0..n` after `Math.round()` throws, where the
  interpreter gives an error), then the build of the elements at them. One draw
  site.

GLSL compiles those of a constant index and a stated length that write a short
list out (`DeleteAt(L, 2)`, `Slice(L, 2, -1)` of `L: list<real^6>`); the interval
mode declines all of them but `Identity` and `ApplyWhole`
(`<head> on interval-js`).

In the interval mode every list operator of the first list above compiles except
`Median`, `Sort`, `Ordering`, `Unique`, `Any`, `All`, `Contains`, `IndexOf` and
the statistics of `statistic()` (`Mode`, `Quartiles`, ..., `Correlation`), which
decline with `<head> on interval-js` (the operations `sort`, `ordering`,
`median` and those of the statistics, and an equality test of two elements, have
no spelling of the mode). The indices of a build that reorders a list are
machine integers (`_IA.number` of the count), and a built list needs one length,
so `Rest`, `Most`, `Take` and `Drop` compile for an input of a stated length
(`list<real^3>`) and a constant count only; of a list of a run-time length (also
a `Range`), and of a run-time count of `Take` and `Drop`, they decline
(`a list whose length is not one number`); a count that is a box with more than
one integer gives `{ kind: 'entire' }`. `Mean` is the interval sum divided by
the count, and a variance the corrected interval sum of the squares of the
deviations from that mean (an enclosure, wider than the range of the variance,
since each deviation reads its element twice, except where a square overflows: a
known limitation).

`Binomial(n, k)` and `Choose(n, k)` are `_SYS.binomial` on JavaScript (exact
below 2^53, the interpreter's value for every pair of integers: `Choose(5, 7)`
is 0, `Choose(-3, 2)` is 6; of real operands, the interpreter's extension), and
on GLSL `_gpu_ir_binomial` of integers (a real operand declines there). They
thread over a list, as the interpreter's (`Binomial(L, 2)`,
`Choose(n, [1, 2, 3])`), on every target; `GCD` and `LCM`, which the interpreter
does not thread, decline a list.

## Tuples

A `Tuple` is a list of fixed length in the representation, with no type of its
own: a tuple of scalars of one lane (an integer among reals is widened; a
boolean among numbers declines) is the list of its elements, an array on
JavaScript (`Tuple(Cos(t), Sin(t))` is `[0.54, 0.84]` at `t = 1`). On GLSL a
list of 2 to 4 elements, a tuple or not, is a `vec2`, `vec3` or `vec4` (`bvec2`,
... for booleans; `vec2(cos(t), sin(t))`), and another length a `float[n]`. A
tuple of lists is a list of rows (`Tuple(L)` of a list of stated length); a
tuple of tuples is a record ("Records"), except as the element of a `Loop` over
a literal `List` of `Tuple`s of one length (`for gap in [(A, B, C), (B, C, D)]`,
`A` to `D` tuples; JavaScript only, `tupleColumns()`): the loop runs over an
index into one list per position, a list of points where the parts are tuples
(`[A, B]`, `[B, C]`, `[C, D]`), and `At` of the element at a constant index (1
to 3, or −3 to −1) is the part at that index (`gap[1]` is `A`, then `B`); a
`Tuple` pattern binds each name to a part (`for (p, q, r) in …`). Any other read
of the element (`Length(gap)`, `f(gap)`, `gap[k]`) declines, and so does an
effect in the list (the interpreter reads it element by element). `PointList`
with no list component is the tuple of its components; with list components it
is the list of the tuples of their elements at each index, a scalar component in
every tuple, as long as the shortest component, as in the interpreter: a stated
length, one length value (`PointList(D, Map(f, D))`), or the `Min` of the
lengths at run time (`PointList(A1, A2, A3)` of three inputs of type
`list<real>`). `Zip(A, B, …)` of lists of numbers is that value, as in the
interpreter (a list of tuples as long as the shortest list), and is lowered as
`PointList`; a list with an effect declines (the interpreter reads the lists up
to the shortest). A list of tuples, a build of tuples
(`Comprehension(Tuple(f(k), g(k)), Element(k, R))`) and the element of a list of
tuples are tuples at their axis.

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
build over it (on GLSL, by the points written out, below): under `Abs` and
`PointX`, and under `Add` with a point, which the interpreter adds to each point
of the list (`P + List(Tuple(1, 2), Tuple(3, 4))`), so `Distance(P, L)` of a
list `L` of points is the list of the distances, and `Distance(L, M)` of two
lists of points the list of the distances pair by pair (lists of two lengths
decline); and under `Multiply` and `Divide` with a list of numbers of its
length, whose element scales the point of the same index (`(M − P) / D`, as the
interpreter gives it). A run-time length fits any length, as in `resultType()`
(`Multiply(D, P)` of two inputs, `Multiply(PointX(P), PointList(1, D))`): two
different lengths are an error of the interpreter that the static type does not
show. Two stated lengths that differ decline. A point times a list of numbers
(or divided by one, as the dividend) is the same build over the list of numbers:
the list of the points that each element scales (`Multiply(D, Tuple(a, b))`, as
the interpreter gives it). `PointX`, `PointY` and `PointZ` of a tuple of scalars
are `At` of index 1, 2 and 3 (`PointZ` of a point of 2 coordinates is an
`incompatible-dimensions` error of the canonical form, and declines); of a list
of points, the list of those coordinates, and of a literal `List` of points (the
library's, as `Max(List(…))` reads one) the list of the coordinate of each
point, with no list of points (so on GLSL too: `PointX(List(p1, …, p9))` is a
`float[9]`); of a list of numbers, they decline. GLSL has no list of rank 2
other than an array of vectors and no build: there `PointList` of list
components of a constant length of 1 to 64 (`SCALARIZE_LIMIT`) is written out as
a `Map` is ("Lists"), a tuple per index, and each reader above is a `Map` over
the points of any list of points of such a length (a `PointList` or a literal
`List` of points), the list of its values at each one
(`Abs(PointList(x - List(1/2, 1), y))` is the `vec2` of the two distances, and
`dce` removes the points); a component of a run-time length and more than 64
points decline (CE-1474). A list of points that is a value of the shader (the
result, a local, an arm, a `List` of calls that each give a point) is an array
of vectors when its length is a constant and its points have 2 to 4 coordinates
(`Profile.vectorArrays`): `List(R(x, y), R(x + 1, y))` of a function `R` whose
value is a point is `vec2[2](_fn_ir_u0_R(x, y), …)`, as in 0.193.0 (CE-1538);
this holds for any list of rank 2 of such lengths, a matrix of 2 to 4 columns
too (`vec2[3]`). Any other reader declines a tuple operand:
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
`If(0 < x, 0 < y)` at `x = -1` is `False`. A tuple result of the root has
`broadcastOutputs` of its type (`broadcastStrideOfType()`), so a batch with
`outputs` gives its elements per cell. An input of a tuple type of scalars of
one lane (`tuple<real, real>`; an integer among reals is a real) is the list of
its elements, marked a tuple, so the rule above reads it: on JavaScript its
value is the array of its elements (`P: [1, 2]`), on GLSL a `vecN`; so is a
parameter of a user function declared such a tuple (see "User functions"). A
union of tuples of one length is the tuple of the lanes at each position
(`tuple<integer, real> | tuple<real, integer>` is a point of two reals, a `vec2`
on GLSL). A tuple of booleans and numbers declines.

An input that is a list of such tuples of real or integer numbers (a list of
points: `list<tuple<real, real>>`, `list<tuple<integer, real, real>^6>`,
extended-real elements `nan | real | signed_infinity` as for a scalar) is a list
of rank 2 marked a tuple on its inner axis, the value that `PointList` of lists
makes, of a stated or a run-time length: on JavaScript an array of arrays
(`P: [[1, 2], [3, 4]]`); on GLSL a stated length with points of 2 to 4
coordinates is an array of vectors (`vec2[3]`), and another declines (a list of
rank 2). The entry check reads the outer value only, as for any list input: a
string and a typed array throw; a row of another length, or a value that is not
an array, gives an unspecified result. `At` of it with a constant index in range
of a stated length is a point; on JavaScript another index is `atp`, a point of
NaN out of range as the interpreter's tuple of NaN, and GLSL and the interval
mode decline it. A list of tuples of other elements, or of tuples of two
lengths, declines.

## Matrices

A matrix is a list of rank 2 of real or integer numbers whose rows have a stated
length (`matrix<real^2x3>`, `list<list<real^3>>`, a literal, a build): a list
of lists of a run-time length (an input of type `list<list<real>>`, a build
whose rows have a run-time length) is the lane `rows` ("The rows lane"), which
the matrix operators decline (`docs/COMPILATION-MODEL.md`), except a value
whose rows have one length (`rowWidths`: a build, an input or a parameter of
a matrix type): `Transpose` and `ConjugateTranspose` of it are the rows of its
columns (`rows.get`), whose length is its number of rows; `Trace` of it is the
sum of its diagonal; `MatrixMultiply` of it and such a value, a matrix or a
list is the product; `Rank` of it is 2 and `Shape` the tuple of `rows.count`
(or its `rowCounts`) and its `rowWidths`; `Diagonal` of it is the build of
its `Min(rows, columns)` diagonal elements; `Determinant`, `Inverse` and
`MatrixPower` of it are the kernels of its order (`rowsKernel()`, below).

An input of the entry of a matrix type of no stated dimensions (a name read
at the entry, a positional parameter of a root function literal: `input()` of
`lower.ts`) is a list of rank 2 of the lane `real` or `integer` whose two
lengths are values, the shape `[{v: r}, {v: c}]`. Two length parameters come
before it, both `lengthOf`: `r`, the length of the input, and `c`, which is
`widthOf` too, the length of its first row and 0 of no row (`Syntax.width`,
`($0.length === 0 ? 0 : $0[0].length)` on JavaScript, a statement at the
start of the entry when the body reads it, so that it is read once). Both are
known `>= 0` (`inputLengths`). Its run-time form is the host's array of
arrays, so the operation `rows.of` (`$0`) reads it as a value of the lane
`rows` at no cost, with `r` and `c` as its `rowCounts` and `rowWidths`. That
value is the binding of the name: every reader below, and every reader of
"The rows lane", reads it, and a read of the name that no reader of the lane
admits declines. The other values of a matrix type (a parameter of a user
function or of `Apply`, an input that a user function reads, a variable of
the engine that a root literal assigns, a build) are of the lane `rows`.
`docs/plans/2026-11-25-matrix-of-run-time-size.md` describes the change that
gives each of them this shape.

Two lengths that must be equal (the inner lengths of
`MatrixMultiply`, the numbers of rows and of columns of `Trace`) and that
`same()` does not prove equal (one value, or equal constants) are compared
once at run time on JavaScript, in one place, `agree()` of `lower-lists.ts`
(user decision 2026-11-25), which the element-wise operations of two lists,
`Dot` and a user function mapped over lists read too ("Lists"): the operation
`rows.agree` or `rows.square` (`may-fail`; `_agree`, `_square` of the
JavaScript printer), made once before the builds, gives 0, the initial value
of each sum of the operator, so `dce` keeps it and no count or length changes
(a sum of a constant length stays written out), and it throws a `RangeError`
(`incompatible-dimensions: lists of lengths …`, `expected-square-matrix: …`)
where they differ, the interpreter's error. A check of the same two lengths
in an open region is read again, not made twice.
A reader that reads no element of the result (`Length` of the product) reads
no sum, so `dce` removes the check there: a known limitation of
`docs/COMPILATION-MODEL.md`.
Two constants that differ decline. The order of `Determinant`, `Inverse` and
`MatrixPower` is the number of rows where `same()` proves it equal to the
length of the rows, and otherwise the operation `rows.order` (`may-fail`;
`_order`), which gives the number of rows and throws a `RangeError`
(`expected-square-matrix: …`) where they differ. Its value is read by the
kernel, so `dce` keeps it before the kernel: `mdet` of the elements row by
row (`rows.flat`) and the order, whose value at the order 1 is the element
(the constant order 1 keeps its read of the element), and `rows.inverse`,
`rows.power` (`_SYS.matrixInverse($0, $1)`, `_SYS.matrixPower($0, $1, $2)`:
the order is the last argument of the kernel, the order of its matrix of
NaN). Their value is of the lane `rows`, of reals, whose `rowCounts` and
`rowWidths` are the order, so a reader that reads no element (`Length`,
`Shape`) reads the check too; `Rank`, a constant, and a statement whose
value is dropped do not (a known limitation). A list of rank 2 of a run-time size (a build
of a constant row length) is read as its rows (`matrixRows()` of
`lower-lists.ts`) by `Trace`, `Determinant`, `Inverse` and `MatrixPower`
(`SQUARE_HEADS`), so its order is checked the same way. `RowReduce` and the
other operators decline it. The matrix operators (`lower-matrices.ts`) settle
the shape of their value from the shapes of their operands; a tuple, a list of
tuples, complex and boolean elements, a rank above 2 and another number of
operands decline. On JavaScript:

- `Matrix(m)` is `m` (`Vector(a, b, c)` is the column `Matrix` of its canonical
  form). `Rank(m)` is the number of axes, a constant (0 for a scalar);
  `Shape(m)` the tuple of the lengths (a run-time length is its value; a scalar
  declines, the empty tuple). Of a matrix whose number of rows is known at
  run time only they are 2 and its two lengths, also where it has no row,
  where the interpreter's empty list of rows has rank 1 and the shape `(0)`:
  a known limitation of `docs/COMPILATION-MODEL.md` (the value of a matrix
  type has a row; `[]` is not one). `Flatten(m)` is the build of the elements row by row (a list
  is itself, a scalar the list of it); with a depth, a constant non-negative
  integer or `+oo`, depth 0 is `m` and any other is the same build, as a matrix
  has one level (another depth declines). `Reshape(m, Tuple(d1, …, dk))` of
  constant positive integers is the nested build of the elements row by row,
  cycled from the first when there are fewer, as the interpreter's; another
  shape (an input, a `List`) declines.
- `Transpose(m)` and `ConjugateTranspose(m)` (of reals) are the build of the
  columns; the number of rows must be stated (it is the length of the rows of
  the result), so `Transpose(P)` of `P: list<list<real^2>>` declines. A scalar
  and a list are themselves, as in the interpreter.
- `Trace(m)` is the sum from 0 of the diagonal of a square matrix (a scalar is
  itself). `Diagonal(m)` of a matrix is the build of its `Min(rows, columns)`
  diagonal elements; of a list of a stated length `n`, the `n × n` matrix with
  the list on its diagonal and 0 elsewhere.
- `MatrixMultiply(a, b)` of matrices and lists is the matrix product, the
  product of a matrix and a list on either side, or the inner product of two
  lists: builds whose elements are sums from 0 of the products in the order of
  the inner index. Two stated inner lengths that differ decline (the
  interpreter's `incompatible-dimensions`); a run-time inner length is
  compared with the other by `agree()` (above), a `RangeError` where they
  differ; a stated inner length beside a run-time one keeps its sum
  written out, from the 0 of the check (`MatrixMultiply(K, v)` of
  `K: matrix<real^2x3>` and `v: list<real>`). GLSL (which has no list of rank 2 and no list of a
  run-time length) and the bigint mode compare no run-time length: such
  lengths that differ give an unspecified value there.
- `Determinant`, `Inverse`, `MatrixPower` and `RowReduce` are the rows `mdet`,
  `minverse`, `mpower` and `mrowreduce`, the kernels `_SYS.matrixDeterminant`,
  `matrixInverse`, `matrixPower` and `matrixRowReduce` of `matrix-runtime.ts`:
  the interpreter's numeric kernels for the determinant, the power and the row
  echelon form, in the same order of operations, so their value is the value of
  `.N()`. The inverse is not the interpreter's numeric `inverse()`, which tests
  a pivot for an exact 0: `matrixInverse` (`3 × 3` and above) eliminates with
  partial pivoting, makes 0 an entry of at most `1024ε` of its running bound
  (the sum of the magnitudes of the terms that made it), and gives a matrix of
  NaN for a pivot of 0; for `2 × 2` the determinant is 0 at most `1024ε` of the
  larger of its two products. So an exactly singular integer matrix whose
  elimination leaves a rounding residue (`[[3, 2, 1], [1, 1, 1], [4, 3, 2]]`) is
  NaN, where the interpreter's `evaluate()` leaves `Inverse` unevaluated and its
  `.N()` gives entries of about 1e15; a regular matrix as ill-conditioned as the
  Hilbert matrix of order 11 is NaN too (a known limitation). The interpreter's
  `evaluate()` of an exact matrix computes in rationals; the compiled value is
  within the precision of a double of it, except where a value of the kernel is
  discontinuous: a singular matrix (above) and `RowReduce`, whose tolerance
  `1e-10` makes 0 a pivot of an exact matrix (a known limitation). The first
  three read a square matrix: both lengths stated and equal, or a run-time
  order checked by `rows.order` (above); a matrix of two stated lengths that
  differ (the interpreter's `expected-square-matrix`) declines. `Determinant` of a `1 × 1` matrix
  is its element; otherwise `mdet` reads the elements row by row (`Flatten`) and
  the order, so that its result is a real scalar (`real-element`). `Inverse` of
  a singular matrix and `MatrixPower` past `MAX_MATRIX_POWER_EXPONENT` are a
  matrix of NaN, where the interpreter leaves them unevaluated. `MatrixPower`
  takes an exponent on the integer lane (the interpreter's power of a real
  exponent is a root of the matrix at a half-integer): `A^2`, whose canonical
  form is `MatrixPower(A, 2)`, compiles. `RowReduce` reads any matrix, with the
  pivot tolerance `1e-10` of the interpreter's `rref()` and its `ce.chop()` at
  the engine's tolerance at the compilation.
- `Cross(u, v)` of two lists of three numbers, or of two 3-tuples (a tuple, as
  the interpreter's), is the list of the three differences of products; a list
  and a tuple decline. It compiles on GLSL (a `vec3`) and in the interval mode
  too.

GLSL declines a list of rank 2, and the interval mode declines every matrix
operator but `Matrix` and `Cross`; the kernels have no spelling there.

## The discharges

`IsMissing`, `Coalesce` and `AssertPresent` read an absent value as its
producers spell it (`docs/COMPILATION-MODEL.md`, "Everything computed from an
absent value, except at a discharge"). The test (`absent()` of `lower.ts`) is
chosen from the static type, with no test of a type at run time: `isnan` of a
real or an integer; of a complex value, `isnan` of its real part or of its
imaginary part; of a point (a tuple of reals of a stated length), `isnan` of
every coordinate; on JavaScript, `isundef` (`=== undefined`) of a boolean, which
`atu` gives out of range, and `text.isundef` of a string. No compiled list,
boolean on GLSL or tuple of booleans is absent (each producer of one declines),
so its test is `false`. A colour has no absent value either, but its producer
that can give one, an `at` out of range, refuses only after the passes: the
constant `false` of `IsMissing` would let `dce` remove it first, so `IsMissing`
of a colour declines, while `Coalesce` and `AssertPresent` keep the colour as
their value and the producer still refuses. A string read out of range
(`text.at`) is `undefined`, which only a discharge or the result reads
(`stringListRefusal()`); its test keeps the read. A point of complex numbers
declines. The written symbol `Missing` (of the library) is the constant NaN, as
a selection that takes no arm; a `Tuple` with it as a coordinate declines (the
point of NaN coordinates is absent; the interpreter's tuple of `Missing` is
not). A NaN on the real lane is also the value of an operation whose exact value
is complex (`Sqrt(x)` at `x = -4`), which is not absent: the test of an operand
on the real lane whose engine type overlaps `imaginary` (`complex`, `number`)
declines, except an input of the program, which is real by its type in `strict`.
In `mode: 'bigint'` `isnan` and `isundef` have no spelling, so the discharges
decline there.

`Coalesce(a, b, …)` is a chain of `if`: an operand after the first is lowered in
an arm, only when the operands before it are absent; the last is the value when
all the others are. Operands of two shapes (`Coalesce(At(P, i), 0)` of a list of
points `P`) decline. `AssertPresent(a)` is `a` when its test is the constant
`false`; otherwise on JavaScript it is `present` (`present.int`, `cpresent`,
`present.bool`, `text.present`; per coordinate of a point) of the test and `a`,
a `may-fail` operation that throws an `Error` whose message starts with
`expected-present` where the test is true (the interpreter gives that error),
and on GLSL it declines.

In the interval mode `isnan` is `_IA.isAbsent`, a verdict over the box: `'true'`
for the `empty` result and for an enclosure of NaN (the absent value of the
mode, the NaN of `∞ - ∞`), `'false'` for a present value, `'maybe'` for a
`partial` or a `singular` result, for `entire` and for an enclosure with one NaN
end. `_IA.at` leaves an absent element out of the hull of the elements that it
selects and marks the result `partial`. A kernel gives `empty` at a pole too
(`1/x`, `Gamma(x)` at the box `[0, 0]`), where the interpreter has a value, so
`absenceTests()` of `print-interval.ts` writes `isnan.weak` (`_absentWeak`:
`'maybe'` for `empty`) for an operand not made only of inputs, constants that
are booleans or numbers that are not infinite, the producers (`at`, the constant
NaN, an `if` of such arms and condition), the operations whose kernel gives
`empty` only for an `empty` operand (`ABSENCE_SAFE`: `add`, `mul`, `sin`, `exp`,
`max`, the comparisons, ...) and a `div` by a nonzero constant; each value that
an `if` with such a test in its condition yields is `unpole` (`_unpole`:
`entire` for `empty`, whose pole no bounded interval holds). `IsMissing(1/x)` at
`[0, 0]` is `'maybe'` (the interpreter gives `False`), `Coalesce(1/x, 0)` there
is `entire` (the interpreter gives `~oo`), and `IsMissing(At(L, k) + 1)` out of
range is `'true'`. A boolean is never absent there (`If(c, x < 1)` with no else
arm is `'false'` where `c` fails, as the interpreter's `False`; an `At` of a
list of booleans that can be out of range declines), so its test is `false`.
`IsMissing(At([1, 2, 3], k))` is `'false'` over `k = [1, 2]`, `'true'` over
`[4, 5]` and `'maybe'` over `[2, 4]`. The `if` of `Coalesce` joins its arms
where the verdict is `'maybe'` (`_IA.hull`): `Coalesce(At([1, 2, 3], k), 0)`
over `[2, 4]` is `partial` over `[0, 3]` (the hull with `empty` keeps the mark
`partial`, which `_IA.coalesce` would drop). `present` and `present.int` are
`_present(m, x)` of the mode's own helper: an `Error` whose message starts with
`expected-present` where the verdict is `'true'`, which `run()` answers with
`entire`, and `x` otherwise, already `partial` where it is `'maybe'`.

## Effects

A call of a function of the host (a definition with an `evaluate` function that
is not of the library, `isHostDefinition()` of `lower.ts`) is the effectful
operation `call.host<k>` (`hostCall()`), whose row and spelling
`_SYS.hosts[k](…)` `sliceProgram()` adds after the lowering (`Program.hosts`);
the lowering reads an operation with no row as effectful. `_SYS.hosts` is bound
to the engine (`runtimeOf()` of `print-js.ts`), so such a program has no pool
loop and is not `shippable` (`docs/COMPILATION-MODEL.md`, "Functions of the
host").

`pure` (merged, removed, moved, folded, evaluated where it was not written),
`may-fail` (removed when unused; shared by the lowering with an evaluation of
the same or an equal node that dominates it, and by `cse` for a call and for an
instruction with regions; nothing else), `effectful` (keeps its place, count and
order). The effect of a user function is the least fixed point over its calls,
from `pure`, and from `may-fail` for a function on a cycle of calls: a recursive
function may not terminate, so it and its callers are at least `may-fail`, and a
guarded recursive call is not evaluated before its guard. A node is memoised by
the effect of what it emitted: a node whose lowering emitted an effectful
instruction is lowered again at each use; a `may-fail` lowering (a loop, a
build, a call of a recursive function) is shared, because the evaluation that
dominates the use fails first if it fails. So the budget counts the passes that
run, and a `Loop` whose carried values are not read is removed and counts none.
The memo is keyed by the structure of a node: the operator, the definition that
a name or a head resolves to, the kind and value of a number and the operands,
so a sub-expression that the source writes several times as separate nodes is
lowered once per region; a node of another kind is equal only to itself. The
operands of `And`, `Or` and a chain are lowered lazily, in arms; the `hoist`
pass makes a speculatable arm a plain `and` or `or` (not in the interval mode).
With the checks on (above), after each pass a check compares the sequence of
effectful instructions (operation, operands, results and region); the same check
runs over the printer's order in any case.

The pass `cse` merges an instruction with an earlier one of the same operation
and operands whose value is visible (written before it in its region or in a
region around it, not in an arm or a loop body that has ended): a `pure`
operation, and a call of a user function that is not `effectful`, with each of
its results (a list and its length). A `may-fail` call, also of a function on a
cycle of calls, is merged because the visible call failed if the second would.
So `a_1(x) = g(a_0(x), a_0(x), …)` calls `a_0` once, and a chain of such
functions runs in a time proportional to its length; a recursive function that
makes the same call twice in its body (`R(i, x) = R(i − 1, x) + S(R(i − 1, x))`)
makes it once, so that `R(20, x)` runs 20 calls, not 2^20. When the function
runs a `Loop`, the passes of the merged call are not counted, so a program that
threw `iteration-limit-exceeded` can give its value, as for a moved call
("Effects"). A function that draws, directly or through a call, is `effectful`
and is called each time, also on a cycle of calls.

An instruction with regions (a `loop`, an `if`, a `build`, a `filter`, a
`seeded`, `integrate` or `derivative` region) that is not `effectful` is merged
by the same rule as a call, `may-fail` included: two are one when they have the
same kind and fields (operation, `passes`, `exit`, `pieces`; not `site`, the
source text for a message: the merged one keeps the first), the same operands,
the same types of their values, and regions that are equal instruction by
instruction, where a value defined in the regions (a parameter, a value of an
inner instruction) is named by its order of definition and a value from outside
by its identity (after the substitutions of the pass). So `X + X·X` with `X` a
`Comprehension` written out three times builds `X` once, and `Min(Map(…))` or a
`Sum` written twice runs one loop. A region with a draw, or with a call of an
effectful function, is `effectful` and is not merged; two `Loop`s that assign
one local are not equal (the second starts from the value that the first
leaves). One of more than 1,000 instructions, nested ones included, gets no key:
the key costs one walk of the instruction per run of the pass for itself and one
for each instruction with regions around it (a chain of 40 nested `Sum`s
compiles about 1.5 times slower). The regions are compared as the pass finds
them, before it rewrites their insides: two that become equal by a merge inside
them are merged in the next round.

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
Out of a `loop` of a run-time count that is not a `Loop`, or a `build`, at the
place where a `may-fail` instruction would move, a check of two lengths
(`rows.agree`, `rows.square`: "Lists") moves under the guard that the loop runs
a pass (`lo <= hi`, `1 <= n`), and its value is 0 where it does not; a length
plus that value is the length of a list that exists, so the sum or the build
that reads it moves too (`Sum(i·Dot(L, M), i, 1, n)`).
Such a build or loop runs once where the program ran it no time, no longer than
the list took to make; on JavaScript its passes then tick the deadline. So in
`Sum(Max(Max(L), k), Limits(k, 1, n))` the loop of `Max(L)` runs once, also at
`n = 0`, and a call in the loop of `Sum(f(x)·k, Limits(k, 1, n))` stays there,
so that a loop of no pass runs no call. In Tycho's `voronoi-diagram`, the loop
of `B` (`Sum(…, k = 1..16)`) called `F(x, y)`, `v(x, y)` and `u(x, y)` at each
pass; they are called once. A moved call counts the passes of its `Loop`s once
(`iterationBudget`): `Sum(f(x)·k, Limits(k, 1, 3))`, whose `f` runs a `Loop` of
100 passes, gives its value under a budget of 150, where it threw. Nothing
effectful moves, so the draws of a seeded frame and its warnings do not change.
The `bigint` mode does not run the pass.

`WithRandomSeed(537911, Random())`, the random constant of a host (a number as
the seed, one `Random()` as the body), gives one value at every call: the
lowering takes the interpreter's as a literal, and the code has no frame, on
GLSL too (not in the `bigint` and interval modes, not with
`constantFold: false`, and not when a host's handler answers for the frame or
the draw). A seed that is not a number literal
(`WithRandomSeed(Random(), Random())` draws its seed from the frame around it)
and any other body keep the frame. The held value of a name is the exception
(`expression()` of `lower.ts`), since it declines with an effect: under a number
as the seed, draws over literals (the library's `Random`, `RandomChoice`,
`RandomSample`, `List`, `Range`, `Interval`, `Open` and `Tuple`, numbers and the
library's constants, with a literal count of a draw or a `Range` of at most
`MAX_FOLD_EXPANDED_NODES`), such as
`a := WithRandomSeed(7, RandomChoice([0, 1), 3))`, a seeded list of Desmos, give
their interpreter value as a literal, a real or a list of reals, under the same
conditions. Every other held value is lowered as written in place, and of its
effects only the draws of a random frame that it holds are accepted, when the
frame has one draw site evaluated once (a frame of the next paragraph that has
no warning): `H := WithRandomSeed(139128, RandomChoice([0, 1), 4N))`, a seeded
list whose length reads the input `N`, is that frame at each read of `H`, a
function of `N` (`drawSites()` of `lower.ts`). The frame starts its draws at its
seed, so the seed can read an input too (`WithRandomSeed(N, Random())`). A held
value still declines when it draws outside a frame (`L := Random() + N`), draws
its seed, reads a name of `vars`, calls a user function that draws, or holds a
frame of the warning `seeded-draw-order`
(`WithRandomSeed(5, Random() + Random())`), whose draws can differ from the
interpreter's. On GLSL, which has no random frame, the frame declines.
Otherwise:

A `WithRandomSeed` frame whose body has one draw site evaluated once (not under
a loop, a `Map`, `Filter`, `Sum` or `Product` body, or a call of an effectful
function) gives the interpreter's draws bit for bit: its draws start at index 0
on entry of the frame. Any other frame compiles, in the compiler's order,
deterministically, and the result carries a warning `seeded-draw-order` that
names the frame and why. A draw site is a `Random()`, a `RandomShuffle`, a
`RandomChoice` or a `RandomSample` (an effectful operation, or an effectful
region row). A draw is the engine's own (`makeRandomHelpers()` over the engine's
frame slot): a compiled draw reads the frame it runs in. A list of run-time
length made in a frame (`WithRandomSeed(s, RandomChoice(…, n))`) has its length
as a result of the frame too.

## Loops and the runtime

On JavaScript the code reads the runtime `_SYS` (`makeSysHelpers()` of
`javascript-runtime.ts`): the functions of the folds are its member `ir`
(`IR_FUNCTIONS`: `REAL_FUNCTIONS`, `COMPLEX_FUNCTIONS`, `pow`, `mod`), under one
name so that no IR name meets a member of another meaning; a draw, a random
frame, an integral and the length of a `Range` are its members
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
passes"). No pass is counted when the count cannot reach the budget: an infinite
budget, or a program with no recursive function whose bound of the passes of a
call at compile time (`loopPasses()` of `ir.ts`, with a run-time count of a
`Sum` or a `Product` as the budget and of a `Loop` unbounded, and a `Loop` in a
body that runs once per element or sample unbounded too: the callback of a `Map`
or a `Filter`, an integrand) is within the budget (the `Loop` of 128 passes of
Tycho's `showcase/burning-ship` under a budget of 10^6). A bound of a `Sum` or a
`Product` with `Limits` of a real type is its `Floor`, as the interpreter counts
(`normalizeIndexingSet()`): `Sum(k, Limits(k, 0.5, 3.7))` is 0 + 1 + 2 + 3, and
`Limits(k, 1, -0.5)` is empty (the identity); a complex bound declines, and in
the `bigint` mode a real one, and so does a bound that is a constant infinity or
NaN (the interpreter sums a window of an infinite range:
`Sum(x^k/k!, Limits(k, 0, +∞))`), or a constant beyond 2^53 − 1 in magnitude in
the number modes (the interpreter gives `out-of-range` for such a bound of a
range that is not empty); the `bigint` mode counts such bounds exactly. An
operand of a `Range` that is a constant infinity or NaN declines too. A bound
that assigns a name declared outside it (`Limits(i, 1, Block(p := 4, 2))`)
declines: the interpreter does not evaluate a `Sum` or a `Product` over a bound
with an effect, and `p` keeps its value (rule R3 of
`docs/COMPILATION-MODEL.md`). The count is in the runtime; the entry starts with
`_SYS.resetLoopPasses()` when the code counts passes. A `Sum` or a `Product`
with `Limits` whose count of passes is more than the budget is NaN
(`hi - lo < budget` is false), each loop by its own count: the lowering writes
that test as an `if`. A sum written out ("Lists": at most 100 passes, within the
budget) has no loop: its passes are not counted by the deadline or charged to a
step budget. A `Loop` in an integrand counts its passes once per sample of the
quadrature, whose number of samples is unspecified. A build, a `Filter` and a
reduction of a list count no pass. GLSL has no deadline and counts no `Loop`
pass at run time: its budget is the option or 10,000, a `Sum` or a `Product`
over it is NaN as above, and the adapter bounds the passes of every loop
(`Loop`, `Sum`, `Product`, a reduction) at compile time (`loopPasses()`): a
constant count is itself, a run-time count is one pass (it is not known, and the
test above limits that loop alone), multiplied down the nesting and through the
calls, both arms of an `if` added. A program whose bound is over the budget
declines: two nested `Sum`s of 10,000 passes, a reduction of 6 elements that
reads the index of a `Sum` of 2,000 passes (`Sum(Max(L6·j), j = 1..2000)`), a
`Loop` of 10,000 passes around a `Sum` of a run-time count. Loops of run-time
counts, nested or one after the other, compile. When their bound with a run-time
count as the budget is over the budget, the code counts every pass in one
counter, `_gpu_ir_passes` (`counted()` of `adapter-glsl.ts`): a pass past the
budget leaves its loop, and the result is NaN:
`Sum(Sum(i·j·x, j = 1..m), i = 1..n)` at `n = m = 200` (40,000 passes) is NaN,
at `n = m = 50` its value. Each `Sum` or `Product` keeps its own test, so one
whose count is over the budget is NaN without running, and adds no pass to the
counter. The declaration of the counter is guarded (`_GPU_IR_PASSES_DECLARED`).
Such a program whose result is not a `float` or a `vec2` to `vec4` (a boolean, a
list of more than 4 elements) declines. With `iterationBudget: Infinity` there
is no bound and no counter.

`Loop(body, Element(i, L), …)` is a statement whose value is `Nothing`: one
counted loop per clause over the source of `L` (an input list, a list, a
`Range`), a later clause lowered in the body of the one before, so it reads its
index. An index that is a pattern (`Element(Tuple(p, q), P1)`,
`for (p, q) in P1` of a list of points) binds its names to each element as a
destructuring `Declare` binds them to a point ("The contracts"); an element that
is not a point of the length of the pattern declines (a list of points is
JavaScript only). The locals declared outside the loop that the body writes are
its carried values. A `Break` or a `Continue` (with no operand) is a statement
of the body: a statement of a `Block`, or of an arm of an `If` or a `Which` that
is one. A `Break` sets a boolean carried value, false before the loop, which is
the `exit` of the `loop` instruction of every clause: the printer stops the loop
when it is true (`loopOpen()` receives the flag's name: `!done` in the `for`
condition on JavaScript and GLSL, `!_IA.decided(done)` in the interval mode; on
JavaScript the block of passes then charges the deadline count with the passes
it ran, the breaking one included), so a `Break` ends every clause, as in the
interpreter. A `Continue` sets a flag of the pass, false at its start (a `Break`
also sets it; with no `Continue`, the flag is the one of the `Break`). The
statements of a `Block` that follow a statement that set the flag, or may have
set it, are lowered in the arm of an `if` where it is false: after a `Break` the
rest of the pass computes nothing, and every carried value keeps its value at
the break. No instruction jumps. The passes run on such a loop as on any other:
the iteration budget counts the passes that run (an early exit runs fewer). The
guard of the JavaScript loop before its first pass is 2^53 passes for a loop
with a `Break` (an open search over `Range(1, 1e12)` ends at its `Break`), 2^32
for another. A loop that never reaches its `Break` and has no budget runs until
the host's deadline (`docs/COMPILATION-MODEL.md`, "A limit on `Loop` passes").
`Loop(body)`, with no `Element` clause, is on JavaScript one counted loop of
2^53 passes whose `exit` is the flag of a `Break`, made also when the body has
no `Break` (so its guard is the one of 2^53): a `Break` ends it, and with an
`iterationBudget` its passes count, so `Loop(k := k + 1)` throws the
`CancellationError` of the budget, as the interpreter throws at
`ce.iterationLimit`; with no budget it has no count, and it runs until its
`Break` or the host's deadline. GLSL and the interval mode decline it: the bound
of its passes is not a constant within the budget. A `Break` or a `Continue`
that is not such a statement (`If(c, Break(), 1)` read as a value, one outside a
`Loop`, or in a function literal in the body), a `Break` with a value, a
`Return`, a write to the index and a `Loop` whose value is read decline.
`Repeat(v, n)` is the list of `n` copies of `v`, not a loop (see "Lists").

`AddTo(s, e)` of a local `s` is `Assign(s, Add(s, e))`, with the lane rules of
`Assign`, on every target; `AddTo(At(L, i), e)` writes a list local in place
("Lists"). `Assign(Tuple(a_1, …, a_n), Tuple(e_1, …, e_n))` of locals (the Epsil
`(a, b) := (u, v)`) lowers every `e_i`, then writes every `a_i`, on every
target; a name written twice, a target that is not a local, a value that is not
a `Tuple` of the same length, a lane change (a real value for an integer local)
and a read of its value decline. `facts()` counts the targets of both as writes,
so a `Loop` carries them.

`ParallelLoop(body, Element(x, coll), …)` (the Epsil `parallel for`) on
JavaScript is the `Loop` of the same operands (`parallelLoop()`): the passes run
in order on one thread, as the interpreter runs them, so a read of an
accumulator in a pass gives the interpreter's value. It declines when the body
assigns with `Assign` a name declared outside it (`outerWrite()`; `AddTo` is the
accumulator: `parallel-outer-write`), when it has a `Break` or a `Continue` of
its own (`jumps()`, which stops at an inner `Loop` or `ParallelLoop`:
`parallel-exit`), and when the program has a draw (`draw`, `shuffle`), a
`choice`, a `sample` or a `seeded` region in any function (`draws()`, checked in
`program()`): inside a frame the interpreter runs each pass in a random frame of
its own (`docs/RANDOMNESS-MODEL.md`, "Pass frames of a parallel loop"), which
compiled code does not have. GLSL and the interval mode decline it. The `loop`
of its first clause is marked `parallel`, which every pass keeps (`cse` keys
it); `runAsync()` can send such a loop to the worker pool ("Batches and
`runAsync()`").

`Integrate(f, Limits(t, a, b))` and `NIntegrate(f, a, b)` of real bounds
(infinite ones too) and a real integrand (a function literal of one parameter,
or a body in the name of the `Limits`) are the region `integrate`: the integrand
is an arrow function that `_SYS.irIntegrate` passes to the runtime's quadrature
(`SYS_HELPERS.integrate`: adaptive Gauss-Kronrod, stated tolerance 1e-10
relative and 1e-12 absolute, with a Monte-Carlo fallback that draws from the
engine), as the interpreter's. A sample that is not finite of a product with an
exponential factor of the variable is its value in log space when that is finite
(`logSpaceProduct()`, as the interpreter's `withLogSpaceFallback()`):
`x^100·e^−x` is `∞·0` past x = 1,200, and `∫₀^∞ x^100·e^−x dx` is 100!. The
estimate of the fallback changes between runs, as in the interpreter
(`∫₀^1000 Mod(t, 1) dt` is about 500; `∫₀^∞ sinh x/cosh² x · cos² x dx`, whose
terms overflow past x = 710, about 0.417). Code with an integral is not
shippable (it may draw). As for any pure operation, the number of evaluations of
an integral is unspecified (an unused one is removed), and the fallback's draws
are not the program's. An integrand with an effectful operation declines (the
routine chooses its samples), as do two variables and the option
`quadrature: 'monte-carlo'`. GLSL has no spelling: an `NIntegrate`, and an
`Integrate` with no closed form below, decline there.

On JavaScript and GLSL (the lowering option `closedIntegrals`), an `Integrate`
(not an `NIntegrate`) whose closed form the engine gives at compile time is that
closed form: `∫₀ˣ 0.1·√(t² + 1) dt` is `0.05·(x·√(x² + 1) + arsinh(x))`,
computed with no quadrature. The engine is asked as for the interval mode
(`integralClosedForm()`), under the guards of `closedForm()` for a derivative,
where a failed guard keeps the quadrature in place of a decline: the values of
the `vars` names are hidden (`∫₀ˣ T·t dt` with `vars: {T}` is `T·x²/2` also when
`T` holds 2); a `vars` name of a constant or of an inferred type, an angular
unit other than radians, more than `CLOSED_SIZE` nodes in the node or in the
closed form, and a closed form that reads a name that the walk binds otherwise
(`foreign()`) keep the quadrature. So do a closed form that reads the variable
of the integral when no bound reads it (the variable's value outside: `a` of
`w(t) = a·t` in `∫₀¹ ∫₀ˣ w(t) dt da`), a closed form that holds a NaN
(`∫₀^∞ t·e^(−a·t) dt` is `If(0 < a, NaN)`; `∫₀^∞ t·e^(−t) dt` is 1), and a
closed form with a divisor (the denominator of a `Divide`, the base of a `Power`
of a negative exponent) with a new factor (`divisors()`). The factors of a
divisor are found through a `Multiply`, a `Negate`, a `Sqrt`, a `Root` and a
`Power` of a number exponent; a factor that reads a name other than a library
constant is new unless it is the same expression as a factor of a divisor of the
node. Such a closed form is NaN where the factor is 0 and loses its digits near
it (`∫₀ˣ cos(a·t) dt` is `sin(a·x)/a`, NaN at a = 0; `∫₀ˣ t·cos(a·t) dt` is
134217728 at a = 1e-12 for 2; `∫₀ˣ cos(a·t)/(1 + a²) dt` divides by
`a·(1 + a²)`), where the quadrature is right. A divisor of the node is a pole of
the integrand itself, where nothing is owed; it counts also in the body of a
user function that the node calls (a factor that reads none of its parameters)
and through a value that a name of it holds (`q := 2s` read as `t/q` gives the
factor `s`): the Gaussian divides by `s` (or `s²`) in its integrand or in the
body of the function `G` that it integrates, and keeps its closed form;
`∫₀ˣ h(t) dt` with `h(t) = cos(a·t)` keeps the quadrature; `∫₀ˣ sin(π·t) dt`
divides by `π` and keeps its closed form. The engine's search finds no closed
form across a pole (`∫₋₁² dt/t` is NaN, and so is the quadrature; `∫ dt/t`
between inputs `a` and `b` has none); `∫₋₁¹ dt/t²` is its value `+∞`, where the
quadrature is NaN. A node that is not pure for the engine keeps the quadrature:
a draw, which the engine would read once at compile time, and an integrand that
holds an integral. A closed form that does not lower (an operator with no row),
that is not real, or that holds a loop or a call is not used (`closedRegion()`).
The closed form is computed in doubles: `∫ t dt` from `a` = 1e8 to `b` = 1e8 + 1
is `b²/2 − a²/2`, 100000000 for 100000000.5. Where the closed form is NaN, at a
bound where the integrand has an integrable singularity (`∫ ln(t) dt` from `a` =
0 to 2 is `a − a·ln(a) − 2 + 2·ln(2)`, NaN at a = 0), the code runs the
quadrature (−0.6137); an integral whose quadrature does not lower, and every
integral on GLSL (the lowering option `quadrature` is false), keeps the closed
form alone, NaN there. Its error is therefore absolute, about one unit in the
last place of the larger value of the antiderivative, and where the integral is
much smaller than that value its relative error is large: `∫ sin(t) dt` from 0
to 1e-4 is 5.2e-9 off in relative terms, and the Gaussian distribution function
at `x = −9`, `s = 1` is 0 for 1.13e-19. The values are within 1e-15 absolute of
the integral (docs/COMPILATION-MODEL.md, "Known limitations"). A name that the
closed form absorbs stays a dependency of the code (`symbolDeps`): each name of
the node that holds a value, is not bound in the walk and is not a variable of
the node (of the `Limits`, of a `D`), each name that holds a value in a value
that the node reaches (a function body, an expression a name holds), not a
`vars` name, and each user function that it reaches; this holds for the closed
form of a derivative too. An input that the closed form does not read is not in
`freeSymbols` (`∫ t² dt` from `x` to `x` is 0); `freeSymbols` lists the names
that the code reads from the inputs object, by name, so its order and a name it
leaves out do not change a call.

A function literal integrand whose parameter is not the name of the `Limits`
(`Integrate(Function(u·x, u), Limits(t, 0, x))`) declines on every target: the
interpreter binds the name of the `Limits`, the quadrature bound the parameter.
`NIntegrate(f, a, b)` has no `Limits` and binds the parameter.

## User functions

A user function is lowered once per compilation, keyed by its definition: the
parameter types from the signature of its binding (`real` when unknown), the
result from the signature or the body. A parameter with a default value
(`Optional(k, 2)` in the literal, `(real, real = 2) -> real` in a declared
signature, Epsil's `function f(x, k: integer = 3)`) is a parameter like the
others, typed by its place in the `optArgs` of the signature: the canonical form
completes a call that leaves it out with the default
(`fillParameterDefaults()`), as the interpreter does, so every call has all its
arguments, and a list argument there maps or binds whole by the same rule as at
any other parameter (`d(L)` is `d(L, 3)`). A call that the canonical form did
not complete declines (another count of arguments). A default is a constant (the
language admits no default that reads an earlier parameter). A root function
literal with a default declines: `run()` takes every positional argument. A
result of no stated type (none, `unknown`, `number`, `any`, `value`, a
`broadcastable` type, or a union that is no IR type, as the engine infers
`list<…> | number | tuple` for `Sqrt(PointX(p)^2 + PointY(p)^2)`) is the type of
the body. An assignment narrows a declared `unknown` result to the type of the
body, `value` for `Dot(p(u, v), PointList(u, v))` with `u, v` of no stated type
(CE-1497). In `mode: 'strict'`, an `unknown` result that an assignment narrows
to a complex scalar (`(real) -> unknown` reports `(real) -> complex` for
`w ↦ sin(w)·√(1 − e²)` with `e: real`) is the type of the body too: a real body
stays on the real lane, as it does in place, so `(F(t), t)` is a point on GLSL
(CE-1588). A result declared `complex` is a complex. The result is a scalar, or
a point (a tuple of real or integer numbers,
`Function(Block(PointList(x, y)), x, y)`), and the result of a call is then a
tuple; a result that is a tuple of such elements or of real or integer scalars
(`tuple<unknown, unknown>`, `tuple<number, unknown>`, `tuple<any, any>`) takes a
point body of that length; a list body declines, except with no result at all (a
function value declared with the bare type `function`): its list body is taken
as for `list<unknown>` below, with the same conditions. A result that is a list
of elements of no stated type (`list<unknown>`, `list<unknown^3>`,
`list<tuple<unknown, unknown>^9>`, as the engine infers it for parameters of no
stated type: `v(a, b) := [a, b]`) is the shape of the body, lowered with the
parameter types of the first call: a flat list of numbers or booleans, or a list
of points, of the lengths that the type states (the engine types a call of it as
its body, with the argument types). Elements of a union of a number and a list
(`list<list<any> | number>`) decline (R3: a declaration settles them), as do a
recursive call of such a function and a rank of 2 that is not a list of points.
A parameter of no declared type, or of a type that is not a scalar
(`collection<any> | tuple`, inferred from `PointX(p)` in the body), takes the
point of its argument at the function's first call: the arguments of that call
are lowered before the function, and a parameter whose lowered argument is a
point (a tuple of real or integer numbers) is a point of its length, whatever
the static type of the argument (a parameter passed on, `(1 − t)·a + t·b`); one
function per binding, as for a list parameter below. `C_mod(C_mul(A, X(x, y)))`
of three functions assigned with no declaration compiles on both targets. A
later call with an argument of another shape declines, naming the function and
the parameter. A call maps over a list argument, binds it whole or declines as
the interpreter decides for that parameter (`listMapsAt()`, read from the
signature of the binding, or of the literal for a name declared with the bare
type `function`, whose annotated parameters then have the type of their
annotation): with a parameter declared `broadcastable<T>`
(`broadcastableParamSlots()`), the interpreter maps a list at that parameter and
at a scalar one, and the parameter takes a `T` (`broadcastable<real>` of a flat
list is mapped, `broadcastable<tuple<real, real>>` of a list of points
declines); it maps a list at every parameter when all are scalar
(`paramsAreScalar()`); beside a parameter declared as a point
(`pointListParamSlots()`), a list of points at that parameter (not at an indexed
one, `p ↦ p[1] + p[2]`) and any list at a parameter of a scalar type or of no
stated type (user decision 2026-10-24); beside a parameter that binds whole, a
list at a parameter of no stated type (`unknownBesideWholeParameters()`,
CE-1697); every other list binds whole. The profile maps a flat list at a scalar
parameter, and a list of points at a parameter declared as a point that the
interpreter maps (`pointsMapAt()`, CE-1477), one point per call, the other
arguments bound whole in each cell (`mapOver()`):
`k := (p: tuple<number, number>, x) ↦ 42` of `k((1, 2), [3, 4])` is `[42, 42]`,
and `g(B)` of a list of points `B` with
`g := (p: tuple<real, real>) ↦ p[1] + p[2]`, declared `function` or not, is
`[3, 7]` at `B = [(1, 2), (3, 4)]`. A list that the interpreter maps where the
parameter is a list or took a point or a list of points at the first call
declines, as does a list of points or a nested list that the interpreter maps to
the leaves (`g(B)` with `g := x ↦ 2x`), and a list of points at a parameter
declared `broadcastable<tuple<real, real>>`. A tuple at a parameter annotated as
a scalar declines (the interpreter maps the function over its components:
`g((3, −4))` with `g := (p: real) ↦ |p|` is `(3, 4)`), also beside a mapped
list. When the interpreter binds the arguments whole, a flat list of numbers of
a stated length as the first argument is a list of that length, and a later call
with another length declines:
`R(p, φ) := [Σ p·[cos φ, −sin φ], Σ p·[sin φ, cos φ]]` of `R([−0.57, 2.8], φ)`.
Otherwise, when the lowered argument of the first call is not a point, a
parameter of no declared type is a real, and one of a type that is not a scalar
declines. A recursive function whose result is not declared (no type, `number`,
`any`, `value`) has a real scalar result: a call of it made while its body is
lowered has a real result (`UserFunction.guess`), and the body must then be a
real or an integer scalar, which is widened; a complex or a boolean body
declines with the cause of that call, and a node that reads the call as another
type declines with its own cause (`If(n = 0, List(1, 2), 2·l(n − 1))`: arms of
two types). No other result is tried. In a cycle of calls, each function called
before its body is lowered has that result, and another the type of its body.
The depth is bounded by the JavaScript stack: with
`s(x, n) := Which(n = 1, Sin(x), True, Sin(s(x, n − 1)))`, `s(x, 2.5)` throws a
`RangeError`, where the interpreter throws a `CancellationError` at its
`recursionLimit` (256 frames, fewer than 100 levels of `s`); a depth between the
two (`s(x, 200)`) is a value in compiled code. An input of the compilation that
the body reads (a free name with no value, or a name of `symbolic` or `inputs`)
is a parameter after the function's own, in the order of its first read in the
body (lambda lifting; a scalar, a list of reals or integers of a stated length,
or a tuple of them, which stays a tuple; on GLSL, which copies an array argument
at each call, a list of more than 4 elements that is not in storage declines,
`IRFunction.lifted`): each call passes the caller's value of the name, an input
of the entry or, in another function, a parameter of the same kind, so the input
is in `freeSymbols` and a chain of calls passes it down. At the entry the input
has the type that the scope of the compilation gives the name, whichever
occurrence reads it first, and the call checks it against the parameter: with
`f(t) := a·t` and `inputs: {a: 'complex'}`, `f(2)` declines (an integer input
for a real parameter is admitted). An occurrence of an input of another type
than the input's declines. A `vars` name whose text reads the inputs object
(`readsVarsObject()`: `_.P`, `_['Q']`) is passed the same way: each call in the
entry reads the text. A recursive call in the function's own body passes the
function's input parameters, which `define()` adds to each such call
(`UserFunction.self`) when the body is lowered, so the body can read an input
before or after the call (`J(n, x) := Which(n = 0, x, True, I(x, J(n − 1, x)))`,
where `I` reads `a`). Declined: a function that reads an input on a cycle of
calls through another function (`P(j) = If(j > 0, Q(j - 1), n)` and
`Q(j) = If(j > 0, P(j - 1), 1)`); a call where the name has a value; an input of
a list of a run-time length or of booleans; a name with a value read in the body
whose binding where the call is compiled is not the body's (see the values of
free names above); another `vars` name. A call where the name is a local or the
variable of a binder (CE-1479) passes the input, which the body reads: with
`k(v) := v + x`, `Sum(x + k(1), Limits(x, 1, 3))` is `(1 + 2 + 3) + 3·(1 + x)`,
39 at x = 10, as the interpreter gives it. A call where the name is a parameter
of the function whose body has the call (CE-1502) passes the input too: that
function takes the input as a parameter after its own, which its parameter of
the same name does not hide (`UserFunction.hidden`, not a name of the body's
frame), and each call of it passes the input. With `u(x, y) := k(0)^2 + y^2`,
`u(x, y)` is 104 at x = 10, y = 2, as the interpreter gives it, and
`h(x) := k(x)` gives `h(2) = 12`. The binding that the body reads
(`UserFunction.defs`) must be a binding of the name in the scope of the
compilation or in a scope around it (`onScopeChain()`), as the input's is (the
`inputs` option declares the input in a scope of its own, which hides that
binding); a local or a variable of the expression is in a scope inside it, so a
function whose body reads one would decline there. No program reaches that case
with a local binding today (a `DefineFunction(q, …)` in the body of the `Sum`,
whose `q` reads the index, already declines as "a function definition that is
not the binding of its calls"); the check guards a `vars` capture, of no
binding, and stays as a defense. `Apply(Function(body, p1, …), a1, …)` with one
parameter per argument, each a name or a typed name (`Typed(H, 'list<real>')`),
is the body with each parameter bound to its argument, the arguments lowered
once, in order, before the body (as a `Block` of locals); a parameter shadows an
input or a local of its name, and an argument reads the names outside. A literal
whose signature is scalar (`literalParamsMap()`, the test of the interpreter's
`applyLiteralMaps()`: every parameter scalar, or a tuple) maps over its flat
list arguments of numbers, as the interpreter's `applyLiteralMapped()` in
`library/core.ts`: one cell per index, the lists zipped, each scalar argument
bound whole in every cell, the arguments evaluated once, in order, before the
cells, and the body once per cell, in order. So one parameter is
`Map(literal, list)`
(`Apply(k ↦ Which(k = m, 10^9, True, k), List(x^2, (x - 1)^2))`), and
`Apply((a, b) ↦ Max(0, a - b), P, t)` is `[0, 1, 4]` at `P = [-1, 2, 5]`,
`t = 1` (each element, not the maximum of the list);
`Apply((a, b) ↦ a + b, P, Q)` zips the lists. The build is over the shortest
length (`shortest()`, as `Map` of several lists): lists of different lengths are
`incompatible-dimensions` for the interpreter, so different stated lengths
decline ("Apply of lists of different lengths"), and of different run-time
lengths the value is unspecified (the static type does not show the error). A
list argument that is a lazy collection with a draw (`Map(u ↦ u + Random(), P)`)
is read by the interpreter one element at a time, each after the cell before it,
where the code builds the argument first: the frame has several draw sites and
carries the `seeded-draw-order` warning (as for one parameter before). Another
list or tuple argument declines: a nested list (the interpreter maps to the
leaves), a tuple and a list of points (atomic), a list of booleans or of complex
numbers, and a literal whose signature takes a collection
(`(a, b) ↦ Length(a) + b`, which binds every argument whole). A typed parameter
has the type that it declares, which settles the shape of its argument: a
parameter declared a list or a tuple of numbers binds its argument whole, as the
interpreter does, and the argument must have that type (a list of the declared
lane, the same tuple mark, a stated length where the type states one), so
`Apply(((H: list<real>), (n: integer)) ↦ H[1] + n, L, 5)` is `7` at
`L = [2, 3, 4]`. A list of reals at a list parameter of integers (not of tuples)
is bound whole on its own lane, since the interpreter checks no element
(CE-1483): `Apply((H: list<integer>) ↦ H[1], L)` is `2.5` at `L = [2.5, 3, 4]`,
also when the type of `L` admits NaN or an infinity; so is a list of reals at
`list<real<0..1>>`. A parameter declared a scalar takes a scalar of its lane,
or, when the signature is scalar, each element of a flat list that the literal
maps over (`Apply((k: real) ↦ 2k, L)` is `[4, 6, 8]`). The engine type of a
scalar argument need not prove the parameter's type: a value outside it is
unspecified in compiled code (user decision 2026-11-19, CE-1503; "Caveats of
compiled code" in `docs/COMPILATION-MODEL.md`), so
`a: real | signed_infinity | nan` binds at `p: real` and a value of the real
lane at `k: integer` keeps its lane (an untyped local, CE-1485), where the
interpreter checks the value at the call. A call of a named function still
declines an argument of another lane. Another argument declines (`L` of no
stated length at a parameter `list<real^3>`, which the interpreter reads whole
with no check; a tuple at a tuple parameter whose type it does not prove; a
complex at `real`), and so does a declared type that is not a scalar, a list or
a tuple of numbers (a union, `real | list<real>`). A list at an untyped
parameter still declines unless the literal maps over it. A parameter with a
default and another count of arguments decline too; `Apply(g, x)` of a name is
the call `g(x)` in the canonical form. `Apply(Derivative(g, n…), a1, …)` is the
application of the function literal that the engine gives for the derivative at
compile time, and `D(f, x, …)` the expression it gives
(`derivativeClosedForm()`; `closedForm()` of `lower.ts`): `D(Abs(x), x)` is
`Sign(x)`, `Apply(Derivative(Sin), x)` is `Cos(x)`. That expression can hold the
derivative of another function (`Apply(Derivative(f, 2), t)` in the derivative
of `F := t ↦ f′(t)/|f′(t)|`) when that derivative has a closed form itself, at
most four levels deep: its application is lowered from that closed form. The
engine computes it with the values of the `vars` names hidden
(`withVarsValuesHidden()`): `D(T·x², x)` with `vars: {T}` is `2T·x` also when
`T` holds 2. That helper hides no value of a constant or of a name whose type is
inferred from its value (`T` assigned and not declared): with such a name in
`vars`, a derivative declines. A variable of a `D` that holds a value, and is
not bound in the walk or a `vars` name, declines (`D(T²·x, T)` with `T = 2`: the
engine reads 2). A `D(f, x)` with no closed form (a derivative head stays in it:
`D(Min(L), x)` of a list) is, on JavaScript, the runtime's numeric derivative:
the region `derivative`, printed as its call
`_SYS.nd((t) => …, 1, 'scalar')(x)`, so the value is its value bit for bit, at
the value of the name `x` outside (`D` binds `x`). Its body is pure, of a real
scalar value; one with an effect (a draw, a write, a `vars` read) declines, and
so do GLSL and the interval mode. The region is `may-fail`, as `integrate`:
`cse` merges it only with an equal visible region, and it moves out of a loop
only as a whole. `ND(f, x)` of a function literal of one parameter is the same
region, the parameter bound at the point: the interpreter's `ND` runs the same
stencil (`stencilDerivativeAt()`). `EvaluateAt(f, a)` of a function literal of
one parameter is `Apply(f, a)`, and `EvaluateAt(f, a, b)` is
`Apply(f, b) - Apply(f, a)`, on every target; at two bounds a function with an
effect declines (the interpreter applies `f` at `a` first). A `Limit` compiles
only when it is closed (it reads no input, local, parameter, index or `vars`
name, and its body is pure): it is the number that `N()` gives at compile time,
also with a direction. Another `Limit` declines, and so does every `Limit` in
the interval mode: the interpreter computes a symbolic limit at each point
first, which no kernel of the runtime reproduces (the numeric limit is NaN at a
jump near the point: CE-1232). Otherwise the node declines: with no closed form
(`Apply(Derivative(g), a)` has no stencil, and neither has `D(f, (x, 2))`),
under an angular unit other than radians, when the node or the result has more
than `CLOSED_SIZE` nodes counted on every path, and when the result reads a name
that the walk binds other than as an input and that the node does not read, or
that a value that the node reaches reads: the body of a user function that it
calls or names, an expression that a name of it holds (`foreign()`:
`w(t) = a·t²` in `Sum(Apply(Derivative(w), a), Limits(a, 1, 3))`). An
`Apply(Derivative(g, k…), a…)` of a total order of 3 or more of a body that
`prefersJetDerivative()` selects for forward mode declines before the engine is
asked. The time of the engine's differentiation is bounded by its own limit
(`MAX_DERIVATIVE_NODES`): `D(r(x), x, x, x)` of a radical `r` of four levels
takes about 4 s, of five about 10 s, and declines; a function whose body applies
its own derivative declines after about 9 s. There is no forward-mode lowering
and no vector stencil (a body that is a list or a point). A function value other
than the literal of a `Map`, a `Filter`, an `Apply` or the root declines. A name
of a library operator of a row in the place of a literal of a `Map`, a `Filter`
or the root is the literal `(p1, …, pn) ↦ Op(p1, …, pn)`, as the interpreter
applies it (`operatorLiteral()`): at the arity of its row, or for a variadic row
the number of lists of the `Map`, 1 for a `Filter` and 2 for the root (the
combiner of the `Reduce` of the engine: `Reduce(L, Max, 0)` compiles `Max` as
`Math.max(a0, a1)`). A name of a user function whose literal has as many
parameters as the `Map` has lists (1 for a `Filter`, a `Count`, `Any`, `All` and
a sort key, 2 for a comparator of `Sort`), or more whose parameters after the
`n`th have a default value in the literal, is the literal
`(p1, …, pn) ↦ f(p1, …, pn)`, the call that the interpreter makes, which the
canonical form completes with the defaults, when that call resolves to the same
definition (`operatorLiteral()`); of another arity, at the root, as the combiner
of a `Reduce`, a shadowed name and a `chain` row (`Less`) decline as before.
`Pipe(x, f)` is the call that the interpreter evaluates (`pipeStep()` of
`library/core.ts`), lowered in its place: of a canonical function literal of one
parameter (also Epsil's shorthand `x |> _ + 1`) `Apply(f, x)`, which maps over a
list as above; of a name `f(x)` (`x |> Sin`, a user function); of a call that
takes the topic as an implicit argument (`L |> Take(2)`, `L |> Map(g)`) the
completed call of `pipeStageAsCall()`. A chain `Pipe(Pipe(x, f), g)` lowers the
inner pipe as the topic. Any other stage declines (a composition, a call with a
free slot `_`). A list argument of a call of a function whose parameters are all
scalars (`paramsAreScalar()`, the interpreter's test: an untyped parameter is a
scalar, a variadic signature is not) is mapped as the interpreter maps it
(`mapOver()`): the arguments are lowered once, in order, then a build over the
length of the lists (on GLSL the list of its elements, as `Map`) calls the
function with the element of each list at the index and with each scalar
argument, so a draw in an argument runs once and a draw in the body once per
element, in order: `h(x, List(2, 4, 8, 16))`, `Sum(f(L))`. The function is
defined with its scalar parameters, so a call with a list and a call with a
scalar, in either order, and calls with lists of two lengths call one function.
The lists must be flat and have one length: equal stated lengths, or one
run-time length value (`h(D, D)`); lists of two stated lengths (the interpreter
gives `incompatible-dimensions`) decline. On JavaScript, outside the bigint and
interval modes, lengths that are not proved equal (`h(D, G)`, `h(V, D)` of
`V: list<real^3>`) are compared once before the build (`agreedLength()`,
"Lists"), a `RangeError` where they differ; elsewhere they decline. So do a
nested list (the interpreter maps to the leaves), a list of
points at a scalar parameter, a function whose result is not a scalar or a point
(a list of lists), and a list argument of a recursive call. A list of points at
a parameter declared as a point (a tuple type, not one that only the index reads
of the body inferred, `isIndexReadTuple()`), in a signature that is not all
scalar and has no parameter `broadcastable<T>` (`pointsMapAt()`, the test of the
interpreter's `pointListParamSlots()`), is mapped the same way, one point per
call (CE-1477): the arguments of each call of such a function are lowered before
the function, a list of points at such a parameter is zipped with the other
lists of points there and with the flat lists at scalar parameters (of one
length, as above), and a point or a scalar elsewhere is bound whole. An argument
of such a call whose static type at the call settles no shape (`unknown`), at a
slot where the call maps, declines with `unsettled-shape`, and so does one
beside a flat list that a call maps over: the interpreter pairs it with the
points or zips it with the list when it is a list and binds it whole otherwise.
An occurrence that the engine narrows at the call (`t` at a `real` slot) is read
by its narrowed type: a list passed to an untyped parameter of a function
literal is a value outside the type that the body implies, and the result is
unspecified (`docs/COMPILATION-MODEL.md`, "Fail closed"). A result that is a
point makes the call a list of points: with
`f := (p: tuple<number, number>) ↦ (p[1] + 1, p[2])` declared
`(tuple<number, number>) -> tuple<number, number>`, `f(P)` is `[(2, 2), (4, 4)]`
at `P = [(1, 2), (3, 4)]`, and so is a flat list mapped at a scalar parameter
(`f((1, 2), L)` of `f := (p: tuple<real, real>, t: real) ↦ (p[1] + t, p[2])`).
On GLSL a list of points of a constant length is written out (a `PointList` or a
literal `List` of points, "Tuples"): `f` of it compiles when the result of `f`
is a scalar, and a list of points as the result declines. A tuple argument for a
scalar parameter declines (a tuple is atomic). A declared result `complex` of a
real body is the body converted to the complex lane. A declared result `color`
takes a body on the colour lane ("The colour lane"); a parameter `color`
declines.

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
`Loop` grows) declines, as does a write to a list local other than in place
("Lists"). A body of another lane (`tuple<integer, integer>` of a real body), a
tuple body for a list result or the reverse, and complex elements
(`tuple<complex, complex>`) decline. A run-time length of the result is a value
of the body: the call has two results, the length and then the list, and the
JavaScript code reads the length of the returned array (`.length`); the function
returns one value, as any other. The verifier checks that the type of the list
result names the length result of the same call. A result that can be a
parameter (`same(L) := L`) is the parameter. A recursive call (made while the
body is lowered, also through another function on a cycle of calls) of a
function with such a result has the type of the signature, which settles its
shape (R1): the stated lane and length, a tuple mark for a point or a list of
points, and for a run-time length a length result, as any call; the body is then
checked against the signature as above, its length must be a run-time value
where the signature states none ("a body of F of a constant length, where its
recursive call takes a list of a run-time length"), and the result of the
function is on the stated lane (an integer body of `list<real>`). The signature
is the binding's, declared or inferred by the engine: with no declaration,
`rf(u) := Which(u = N − 1, [u], True, Join([u], rf(u + 1)))` is typed
`(u: unknown) -> list<number>`, a list of reals, and `rf(0)` is `[0, 1, 2, 3]`
at N = 4; so is `F(k, p) := Which(k = 0, p, True, F(k − 1, p) + (1, 0))` of
`(real, tuple<real, real>) -> tuple<real, real>`, `[4, 2]` for `F(3, (1, 2))`.
The arms of a `Which` in such a body follow the rule of the arms ("Lists"): a
list of points or of booleans and a list of another length in the two arms
decline ("arms of two types"), and so do lists of two lengths on GLSL (which has
no recursion either) and in the interval mode. Declined: a recursive call of a
function whose list or tuple result has elements of no stated type
(`tuple<unknown, unknown>`, `list<unknown>`: its type is the body's), a list of
lists, and on GLSL a result of a run-time length; one of a stated length is a
`vecN` or a `float[n]` (`vec2 _fn_ir_u0_pt(float v0)`).

A scalar parameter of no stated type, or of type `unknown` or `number`, takes
the lane of its argument, not always `real` (CE-1476): a call whose argument
there is complex calls a function of a complex parameter, any other call a
function of a real parameter (an integer argument is widened), so a binding is
lowered once per lane of such parameters (`laneKey()`), in `mode: 'complex'` on
every target that has the complex lane; the strict mode (the default) declines a
complex argument there (a `LaneMismatch`, `compile-mode-strict.test.ts`). With
`f(w) := w^2`, `Arg(f(x + i·y)) + f(x)` calls `f` of a complex `w` and `f` of a
real `w`; the arguments of each call of such a function are lowered before the
function is chosen. A real call keeps the value of the real lane: `Sqrt(w)` at
`w = -1` is `i` in `mode: 'complex'` and NaN in the default mode, as `Sqrt(x)`
is. A parameter declared `real` (or `integer`) declines a complex argument. A
recursive call of another lane calls the function of that lane, which, for a
function with no declared result (a real result, above), declines with its
complex body. A parameter declared a list of integers (not of tuples) takes a
list of reals on the real lane (CE-1483), as an `Apply` of a literal does above:
the interpreter binds the list whole and checks no element, and a parameter of
an IR function has the lane of its argument, so the function of a list of reals,
its parameter on the real lane, is another version of the binding (`laneKey()`;
the `bigint` mode declines a list of reals), and the arguments of each call of a
function with such a parameter are lowered before the function is chosen. With
`function g(H: list<integer>) -> real { H[1] }`, `g(L)` of `L: list<real>` and
`f(n) = g([n, 1])` at n = 2.5 are `2.5`; `g(L) + g(M)` with `M: list<integer>`
calls two functions. A result `integer`, declared or inferred by the engine
(`function g(H: list<integer>) { H[1] }` is typed `(list<integer>) -> integer`),
declines a real body ("a body of g that is not integer"), where the interpreter
gives `2.5`; a recursive call that returns to the lane that called it declines
as above.

The pass `inline` (`passes.ts`, before `cse` and `invariants`) replaces a call
in the body of a `loop`, a `build` or a `filter` with a copy of the callee's
lowered body, so that the passes see the calls it makes; where sums and short
lists are written out (JavaScript, the interval mode included, not the bigint
and complex modes) also a call of a function that its caller calls twice or more
(the pass option `inline`, `'loop'` or `'repeated'`, set in `sliceProgram()`),
and a call whose result is a list of a constant length of at most 16 elements
(the pass option `unrollBuilds`; "Lists", the short lists), under the conditions
below and the budget of the rule `'repeated'`. The rule `'repeated'` does not
copy a function that calls a function twice or more (in the current round of the
passes or an earlier one, `budget.grown`): its callee is copied into it, and its
callers call it, so a chain of functions each calling the next several times
grows with the call counts, not their product; other call graphs (a function
reached by single calls along two paths) are bounded only by `INLINE_BUDGET`.
With `f(a) := Sin(a)`, `g(b) := f(b) + … + f(b + 4)` and
`h(c) := g(c) + … + g(c + 4)`, `h(x)` holds a call of `g` at each term and `g`
the 5 copies of `f`, where copies of `g` were 21 `Math.sin(` sites (CE-1475). A
sum written out takes its calls out of the loop that the rule `'loop'` copies:
with that rule `showcase/voronoi-diagram` #0 of Tycho's corpus is a call of
`n(x, y, k)` at each term, 6.8 times slower than its loop (38 µs a call against
5.6), and 4.4 µs with the rule `'repeated'`. In Tycho's `voronoi-diagram`,
`n(x, y, k)` is called at each pass of the loops of `Z`, `v`, `u` and `H`, and
its copy leaves a call `F(x, y)` of no index, which `invariants` moves before
the loop (from about 40 µs a call to about 6). The callee qualifies when it is
not effectful and not on a cycle of calls (nor, by the rule `'repeated'`, its
caller, whose `if` runs one arm in the interval mode, a rule kept on
JavaScript), its body holds no `loop` and no region instruction (a function that
loops stays a call, which `invariants` can move), it has at most `INLINE_SIZE`
instructions, nested regions included, and one result of the lane of the call's
result, each list argument has the lane of its parameter, and, when an argument
is a constant, neither its body nor the body of a function that it calls holds
an `At` (a constant index out of range declines on GLSL, where the call gives
NaN: `la(A, 5)` of `la := Function(At(L, j), L, j)` and `A: list<real^3>`, and
`nx(A, 4)` of `nx := Function(la(L, j + 1), L, j)`). A scalar integer argument
of a real parameter is admitted: each operation of the copy is the one the
callee selected (`Mod` of a real parameter stays the real `mod` on GLSL), and
reads the integer as its call did. The copy is made after the lowering, so it
has the callee's signatures, the types of its lifted inputs and its effect; each
value of the copy is new, of the type of the original with its lengths renamed,
and each parameter reads its argument. A call that the copy holds is copied in
turn when it qualifies (it is in the loop of the call it replaces); a result
that is a parameter is the argument, and a call stays when that argument has
another lane than the call's result (`id(k)` of an integer index for a real
`id`, whose value a build would read as an integer). The copies grow the program
by at most `INLINE_BUDGET` instructions, 1,000 by the rule `'loop'` and 4,000 by
the rule `'repeated'` (where the sums written out multiply the sites: a function
read at the 16 terms of each of four sums makes copies of about 1,900
instructions before the other passes shrink them); past it, calls stay, so a
chain of functions each calling the previous three times in a loop stops there.
The growth is the size of the program before the pass, in each round, less its
size when the passes started, so a copy that the other passes shrink gives back
its instructions: a copy of `p(k)` of Tycho's `voronoi-diagram` with a constant
`k` folds its square root and one cosine. In one round the copies are at most
the budget that is left. Counted at their size before the fold, the copies of
`F`, `Z`, `u`, `v` and `B` spent the budget, and `H`, reached last, kept 16
calls of `n`, each of which computed `F(x, y)` again, twice the sines and
cosines of the same document with `n` written out (CE-1724). A copied call of a
function that runs a `Loop` can be moved out of the loop by `invariants`, so a
program that threw `iteration-limit-exceeded` can give its value ("Effects" says
it for a direct call): `hh := Function(k·LL(p), p, k)`, whose `LL` runs a `Loop`
of 100 passes (`s := s + p·i`), gives 9090 for `Sum(hh(x, k), Limits(k, 1, 3))`
at x = 0.3 under a budget of 150, where it threw. After the passes, a function
that no call reaches from the entry (its calls were copied, or removed with a
value that nothing reads) leaves the program and is not printed, also when the
pass is off; `symbolDeps` still names it (`captures`). The `bigint` mode does
not run the pass (it serves `invariants`, which is off there).

A statement `DefineFunction(f, Function(…))` of the compiled program (Epsil's
`f(x) = x^2 + 1` at the top level of a `Program`) writes nothing: its canonical
form installed the clause, and a call of `f` is a call of the user function of
that binding (CE-1443). The statement declines when a call of `f` in the program
binds another literal (a second clause, a function of several clauses), and in a
nested block, where the function is a local whose value the statement writes. A
program whose last statement is a definition is `Nothing` and declines.

## Match, x is T and N

`lower-match.ts`. None of them emits a test of a type at run time
(`docs/COMPILATION-MODEL.md`, "Shapes are settled at compile time").

- `N(x)` and `N(x, p)` of a number (an integer, a rational, a real or a
  complex), a string or a boolean is `x`. `p`, when given, is a literal integer
  of at least 15: the interpreter rounds to `p` digits, and `N(1/3, 15)` is
  `0.333333333333333`, 1e-15 from the double. Another precision, another operand
  (`N([x, 2])`), a number in the interval mode (the enclosure of `x` need not
  hold the rounded number) and the `bigint` mode decline.
- `MatchesType(x, T)` (`x is T`) is the constant `True` when the static type of
  `x` is a subtype of `T`, `False` when the two types do not overlap
  (`x is string` of `x: real`); otherwise it declines (`x is integer` of
  `x: real`). The subject is held raw: its type is the type of its canonical
  form in the innermost local scope of the walk (`Lowering.scopes`: a `Block`,
  the function literal whose body is lowered, the root literal), and it is
  lowered only for its effect. A local of a block is read by the type of its
  value; a capture of a case is `unknown`, also when it has the name of a
  parameter.
- `Element(x, S)` of a number set that `domainToType()` maps to a type
  (`Integers`, `RationalNumbers`, `RealNumbers`, `ComplexNumbers`,
  `ImaginaryNumbers`, `Numbers` and the extended sets) is decided as
  `MatchesType(x, T)` of that type (CE-1738): `n ∈ ℤ` of `n: integer` is `True`,
  `x ∈ iℝ` of `x: real` is `False`. The interpreter maps the set to the same
  type. A subject typed `nothing`, and a type that does not decide (`x ∈ ℤ` of
  `x: real`) go to the list operators, which decline for a set. Another set
  (`NonNegativeIntegers`) is not decided. `NotElement(x, S)` is the negation of
  the same constant; when it is not decided, it declines.
- `Match(subject, case…)`: the subject is lowered once. A case of a string or a
  real number constant (`== "rect"`, `== 3`) is a clause of a `Which` on the
  subject, compared by `Equal` (exactly: the interpreter compares a number that
  is not an integer with a tolerance, a known limitation of
  `docs/COMPILATION-MODEL.md`); it is decided at compile time when the subject
  is a constant (a `bigint` constant is compared by `Equal`), and not taken when
  the subject has another kind (a number against a string). `_` takes every
  value. A `Tuple` pattern of distinct names is taken when the subject is a
  tuple of its length, and binds each name to the element at its position; it is
  not taken by a scalar or a tuple of another length, and declines on a list.
  The cases after one that takes every value are not read, so with a constant
  subject one case remains and the shapes of the others do not count
  (`match "rect" { == "circ" => [1, 2]; == "rect" => t }` is `t`). Each body is
  the body of the function literal of its case (`buildCaseClosure()`), made
  canonical in the innermost local scope of the walk and lowered in the scope of
  that literal, as the interpreter runs it. A guard, a pattern of another kind
  (a name, `Pin`, a list, a range), a `Match` with no case that takes every
  value, and cases whose results have two shapes (`arms of two types`) decline.
  A string compiles on JavaScript only.
- The engine types a `Match` as the join of the types of its case bodies, which
  are raw: a body that is not a literal makes the `Match` `unknown`, and so does
  the lack of a case that takes every value (a wildcard with no guard), since
  the value is then `Error("match-no-case", …)` when no case is taken. A user
  function whose result is inferred from such a body has the result `unknown`,
  and takes its result from the lowered body, as a result of no stated type. A
  declared result (`function f(s: string) -> boolean { match s { … } }`, the
  body `Typed(…, "boolean")`; a signature that the host declares) is kept, and a
  body that contradicts it declines.

## Records

`lower-records.ts` (CE-1652, step 2; JavaScript only). A record is a value of
the lane `record` and the shape `[]` whose fields each have a settled shape
(`docs/COMPILATION-MODEL.md`, "Shapes are settled at compile time"). Its IR type
holds the IR type of each field (`fields`), the tuple mark of each (`marks`)
and, for a value of a nominal tuple type, the name of the type (`nominal`) and
its field names (`names`); `joinType()`, the type equality of the verifier and
`sameFields()` compare two records by their nominal type and field by field, so
two records of one engine type whose fields have different shapes are two IR
types, and so are records of two nominal types of the same fields. A field is a
scalar of a lane (a colour, a string), a list or a tuple of stated lengths, a
record, or the unit type `nothing`: a field whose value is `Nothing`. On
JavaScript a record is the array of its fields (a `list` instruction of the
record type), a `nothing` field `null` (the operation `nothing`). Records
compile on JavaScript only (user decision Q3 of the plan of CE-1652): on GLSL,
in the interval mode and in the `bigint` mode a constructor declines ("records
compile on javascript only"), also when a field read would fold the record away,
and a `Tuple` or a `List` of several lanes is lowered as before ("elements of
two types"); `admits()` refuses the lane there too.

- **Making a record.** The constructor of a nominal tuple type that
  `type P = tuple<…>` declares (`recordConstructor()`; not a parameterized or an
  alias type, not a variant of a sum declared with `|`, whose tag is a value at
  run time): each operand is lowered for the declared type of its field, and an
  operand whose static type does not prove that type declines (R5), as does one
  whose static type comes from a `Match` (CE-1731). Where the declared type
  settles an IR type (`real`, `string`, `color`,
  `tuple<real, real, real, real, real, real>`), the field has it (an integer
  operand of a real field is read as is); where it gives no single shape (`any`,
  `list`, `string | color | nothing`), the field has the shape of the operand,
  so a filled and an unfilled `Figure` are two record types. `Nothing` is a
  field of the type `nothing`. A `Tuple` or a `List` literal whose elements do
  not make a list (two lanes that do not join, lists of two lengths, a tuple and
  a list, a record) is a record with no names (`Tuple("a", t)`, `[t, "a"]`); a
  `Tuple` or `List` of one lane stays the tuple or the list of "Tuples" and
  "Lists". On JavaScript a `List` of flat lists of numbers, one of them of a
  run-time length, is a list of lists of the lane `rows` ("The rows lane"),
  not a record. A field of a run-time length declines (its length is a value
  of the function that makes the record), and so does a field of the lane
  `rows`. A
  list of records (an element of a build, a filter or a random frame) declines.
- **Reading a record.** `Field(r, name)` of a record of a named tuple type and
  `At(r, k)` (`First`, `Last`) of a constant `k` in range give the field (the
  operation `field`, `r[k]` on JavaScript, with the field's tuple mark); any
  other index declines. A field of a record made in the same body is the value
  it was made of, so a constant stays a constant: `match fig.kind { … }` keeps
  one case, and an `If` whose condition compares such a field with a literal (or
  whose arms give two record types, or a record and another value) keeps the arm
  taken when the condition is known at compile time (the shapes of the other arm
  do not count). An `If` with a condition known only at run time whose arms give
  two record types declines ("arms of two types", R3). `MatchesType(x, T)` of a
  field of a record that the static type of `x` does not decide is decided by
  the lane of the field: a field of the lane `nothing`, `string`, `boolean` or
  `color` is of that engine type (`fig.fillPaint is nothing`). A `Tuple` pattern
  of a `Match` does not take a value of a named tuple type (the interpreter's),
  and declines on a record with no names. Every other reader declines:
  arithmetic, `Equal`, `Length` (but of the arguments of a rest parameter,
  below), `Map`.
- **User functions.** A function whose result type is not a scalar (a named
  tuple type, `list<real | string>`) returns the record of its body; a body that
  is not a record declines as before ("the result of f is not a scalar"), and a
  result type with field names requires a record of those names. A parameter of
  no stated type, of type `any` or of a nominal tuple type holds the type of a
  record argument (`held()` of `lower-functions.ts`; CE-1652, step 3), and one
  of no stated type or `any` also the type of a string or a colour (JavaScript
  only): the parameter has the IR type of the argument, with its fields, and the
  lane key (`laneKey()`) holds that type (`typeToString()`: the nominal type,
  the field names, and the IR type and the tuple mark of each field), so two
  calls of records of one IR type call one function and two calls of records of
  two types (`fill` of an unfilled and of a filled `Figure`) two. Such a
  parameter's arguments are lowered before the function is chosen at each call.
  A parameter of a nominal tuple type takes a record of that nominal type only,
  or of a nominal type that the static type of the argument proves a subtype of
  it; any other record declines (R5). A parameter declared `list` takes no
  record: Tycho's `label` (the geometry `[x, y, text]`) and `group` (a list of
  figures) decline at `figureOf(kind: string, geom: list)` ("the parameter geom
  of figureOf is not a scalar"). In a constructor, an operand of no stated type
  or of type `any` (such a parameter) proves the declared type of its field by
  its lane (a string, a colour, a boolean, a number, `nothing`) in the function
  lowered for it. A field of a record parameter is read as on a local record
  (the operation `field`), so `x is T` of a field is decided by its lane and a
  `match` on a field compares at run time. A recursive call on a cycle of calls
  through a function whose parameter or declared result is a record, or whose
  arguments hold a record, declines before a function is lowered for it
  (`recordCycle()`): the type of a record on a cycle is a fixed point that the
  lowering does not compute, and a record that grows at each call would lower a
  new function at each.
- **Dictionaries** (CE-1771). A dictionary literal `{w -> t, fill -> "red"}` is
  a record of its values, in the order of its keys (`dictionary()` of
  `lower-records.ts`): its `names` are the keys and its `head` is `Dictionary`
  (`IRType.head`), so two dictionaries of other keys are two record types and an
  `If` whose arms have two sets of keys declines ("arms of two types").
  `Field(d, "w")` (`d.w`) and `At(d, "w")` (`d["w"]`) give the field of that
  name; `At` of an index that is not a constant key (`d[1]`), `First`, `Last`
  and `Length` of a dictionary decline, as does a key that the literal does not
  have, and a dictionary with the key `__proto__` (an object literal of the
  result would set the prototype). `MatchesType` of a dictionary is not decided
  by its IR type (`valueTypeOf()` gives `undefined`). A parameter of no stated
  type or `any` holds a dictionary as it holds another record; one whose stated
  or inferred type is a `dictionary` or a `record` type declines ("not a
  scalar"). As the result of the code a dictionary is an object of its keys, and
  at a function of the host it is the engine's dictionary of its keys
  (`boxValue()` of `print-js.ts`). The values of a dictionary are nodes of
  the program (`readers` of `lower.ts`, with the dictionary as their reader),
  so a `List` or a `Tuple` literal that is a value of a dictionary is listed
  (`Listed`) and a function of the host receives it
  (`figureDraw({p -> (t, 1)})`). A value of a dictionary is not a place where
  a list of NaN stands for an absent list (`nanForAbsent()`).
- **Protocol methods.** A call whose head is the dispatcher of a protocol member
  (`rotateAbout(c, a, p)`, and the member call `c.rotateAbout(a, p)`, which has
  the same canonical form) and whose first operand is a record of a named type
  `T` is dispatched at compile time (`lower-protocols.ts`; CE-1652, step 4). The
  interpreter (`dispatchMember()` of `engine-protocols.ts`) selects the most
  specific of the edges whose target holds the type of the value at run time;
  the type of a record is its nominal type, so the compiler requires exactly one
  edge of `protocolDispatchCandidates()` that overlaps `T` (`typesOverlap()`), a
  target that holds `T`, no condition and an Epsil implementation: that edge is
  then the one selected for every value of `T`. The arguments are those that the
  interpreter passes (`protocolCallArguments()`): a parameter that the call
  leaves out takes the default of the requirement, boxed in the scope of the
  protocol and evaluated at compile time. A symbol default (a constant, which a
  later program can declare again) that is not the library's is a capture
  (`symbolDeps`), as a free name with a value is (`captured()`), so a host
  recompiles when its value changes; a symbol default with no value declines
  (the interpreter reads it in the scope of the protocol, the lowering would
  read it at the call site). Each argument must prove the type of the
  requirement at `Self` = the target, by its static type or, of no stated type
  or `any`, by its lane, as the interpreter checks it. The implementation
  (`implementationLiteralAt()`, `Self` replaced by the target) is made canonical
  once per edge and member and lowered as a user function, so each record type
  lowers it once; the result that its body declares (`Typed(body, "boolean")`,
  at `Self` = the target) is its declared result, which the body must prove, as
  for a user function (`signatureTypes()`). Two edges that overlap `T` (two
  protocols that declare the member), a conditional edge, a host callback, a
  first operand that is not a record, a record of no named type and a record of
  a parameterized type decline. The qualified call (`ProtocolMember`) still
  declines.
- **Values settled per lowered function** (CE-1652, step 4b). A user function is
  lowered once per lane key, so in one lowered function a parameter that holds
  the type of its argument (`held()`) has a settled IR type, and the parameter
  is in `Lowering.heldParams`. `held()` takes, at a parameter of type `any` (not
  one of no stated type, which keeps the real lane of today), also a real or an
  integer whose argument's static type proves the lane, or which is itself such
  a parameter (`figureScaling(k)` in `scale(self, k: any)`), and, on JavaScript,
  `Nothing` (written as the argument, or a value of the lane `nothing`). A
  parameter that takes the shape of its argument (a point, a list of points, a
  flat list; below) is in `heldParams` too: every call gives that shape.
  `MatchesType` of such a parameter whose static type does not decide (`any`,
  `unknown`) is decided by its IR type (`engineTypeOf()` of `lower-match.ts`): a
  scalar of the lane `string`, `color`, `boolean`, `integer`, `real` or
  `nothing` by that type; a record, a point or a list by an engine type that
  holds every value of the IR type (`valueTypeOf()`): a record by its nominal
  type (not a parameterized one); a record of no names by the tuple of its
  fields (`tuple<tuple<number, number>, tuple<number, number>>` for a box
  `((x0, y0), (x1, y1))`), or by that tuple or the list of the fields where the
  fields do not join (`(t, "a")` and `[t, "a"]` are one IR type); the axis of
  the tuple mark by a `tuple` of its length, another axis by a `list`; a number
  of any lane by `number` (the interpreter's value can be `NaN`, which is not a
  `real`). The test is decided with `isSubtype()` and `typesOverlap()`, as the
  interpreter decides it on the value (`dynamicTypeTest()`): `box is nothing` of
  a box is `False`, `(t, 1) is tuple` is `True`, `[t, 1] is tuple` is `False`; a
  test that the type does not decide (`k is integer` of a real,
  `(t, 1) is tuple<real, real>`, `(t, "a") is tuple`) declines. A value
  `nothing` is still refused as the argument of a call (`nothingRefusal()` of
  `index.ts`), so `Nothing` as an argument compiles where the passes remove the
  call (`boxCenter(Nothing)`, whose result is the constant `(0, 0)`). `Equal`
  and `NotEqual` of a string and a real, an integer, a boolean, `nothing` or a
  tuple of reals are the constants `False` and `True` (`apart()` of `lower.ts`),
  the interpreter's values for those types (checked: `(0, 0) == "default"`,
  `2 == "a"`, `NaN == "a"`, `True == "a"`, `Nothing == "a"` are `False`); a list
  threads, and a record or a colour with a string is left unevaluated by the
  interpreter, so those still decline. Both kinds of decided test are recorded
  in `Lowering.typeTests`; a condition of an `If` or a `Which` made only of them
  (`And`, `Or`, `Not`; `typeDecided()` of `lower.ts`) takes its arm and the
  other arm is not lowered, as for a decided scalar condition
  (`docs/COMPILATION-MODEL.md`, "The arms of a conditional"): such a condition
  declined before, so no program that compiled changes. A parameter whose type
  settles no shape (`point` of `signatureTypes()`: no stated type, `any`,
  `list`) is lowered once per shape of its argument (a scalar, a point `p2`, a
  flat list `w3` that binds whole, of strings `w1s` on JavaScript; `laneKey()`),
  so its arguments are lowered before the function is chosen at every call, not
  only the first. A list of strings declines in a record field, also as a
  literal (`figureOf("invalid", ["message"])`,
  `Figure("invalid", ["message"], …)`), and where a body reads one given to such
  a parameter (`g[1]` of `g: list` given `["a", "b"]`): "a list of strings other
  than a literal…". `N(x, p)` of a list or a tuple of reals (by its static type,
  or by its IR type when the static type is `any` or `unknown`) is `x`; in the
  interval and the `bigint` mode it declines. A record field from a list
  parameter of a run-time length (`N(pattern, 15)` of `pattern: list<real>`)
  still declines ("a record with a field of a run-time length").
- **String constants** (CE-1652, step 4c). `lower()` lowers a program up to
  three times. The first lowering keeps no string constant, so a program that
  compiles there keeps its code. When it declines and the constants could decide
  a test (`seen`: an `Equal` or a `NotEqual` of two values that each are a
  string constant, a string parameter or the read of a string field
  (`mayHoldKnown()`), or a `Match` on such a parameter or field), the second
  lowering keeps them (JavaScript, not the `bigint` mode): `Lowering.known(v)`
  is the value of a string constant (`b.constants`), of a parameter whose
  argument was a known string (`held()`: at a parameter of no stated type, `any`
  or `string`, the lane key holds the value, so a function is lowered once per
  value; the arguments of a `string` parameter are then lowered before the
  function is chosen), or of the read of a record field whose type holds the
  value (`IRType.constant`, set by `make()` of `lower-records.ts`; two records
  whose constant fields differ are two record types, and `joinType()` makes such
  a field a plain string where they meet, as at an `if` of two). The type of a
  value never holds a constant: the lowering keeps the value of a parameter and
  of a field read aside (`holdKnown()`), so a local written in a loop or an `if`
  of two literals is a plain string. `Equal` and `NotEqual` of two known strings
  are constants recorded in `typeTests`, so a condition of them takes its arm
  (`typeDecided()`, the memo of `value()` keeping the decision), and a `Match`
  on a known subject keeps the one case taken. Each such decision reads its
  operands (`readKnown()`): the third lowering keeps a constant only at the
  places (a parameter `f#i`, a field `T.k`) that a decision read, or through
  which such a value came (`feeds`: the parameter `kind` of `figureOf` into the
  field `Figure.0`), so a fill colour that no test reads does not lower a
  function once per colour. The third lowering takes the decisions of the
  second; if it fails all the same, the second is the program. The decline of
  the second lowering is the program's decline.
- **Rest parameters and the host boundary** (CE-1652, step 5; JavaScript only).
  A user function whose one parameter is a rest parameter
  (`function draw(...args) -> nothing { figureDraw(listFrom(args)) }`, the
  parameter `Spread(args)`) binds it to the record of the arguments of each
  call, each lowered in order (`restRecord()` of `lower-functions.ts`): a record
  of no names whose type holds the head `Tuple` (`IRType.head`), as the
  interpreter binds `args` to the `Tuple` of the arguments. The function is
  lowered once per type of that record, so two calls with arguments of the same
  types call one function. `ListFrom(args)` is the record of the same fields of
  the head `List`; `Length(args)` is the number of arguments and `args[k]` of a
  constant `k` the argument (the record rules); any other reader declines as for
  a record (`listFrom(args) + 1`). A rest parameter beside other parameters
  declines, and so does a call on another target. A user function whose declared
  result is `nothing` has the real lane: its body is lowered as a statement and
  its value is NaN, the `Nothing` of a host call of result `nothing`. Its body
  ends in an `Assign`, a `Declare` or a value of the static type `nothing` (a
  call of such a function, a loop, an `If` of such branches), where the
  interpreter gives `Nothing`; another body declines (`define()` of
  `lower-functions.ts`). The value of a call of it is read only where such a
  host call's is (`nothingPlace()` of `lower.ts`: the value of the root function
  literal, or the last operand of a `Block` or the operand of a `Typed` that
  is), NaN there; elsewhere it declines (`possible-nothing`), also when the call
  is a dispatched protocol method. A function of the host takes, beside a scalar
  of the lane `real`, `integer`, `boolean` or `string`, a list or a tuple of
  such scalars and a record of a named tuple type or of a head whose fields are
  such values or `Nothing` (`unboxable()` of `lower.ts`). `HostCall.types` and
  `HostCall.marks` keep the IR type and the tuple mark of each argument, the row
  takes a list operand whole, and `verify()` checks the operands against those
  types. Before the call, `boxValue()` of `print-js.ts` makes the engine's value
  from them: a record of a named type is the application of its constructor
  (`Figure("circle", List(…), Tuple(…), Nothing, …)`), a record of a head the
  application of the head, a list a `List`, a tuple (the axis of its mark) a
  `Tuple`, a `nothing` field `Nothing`, and a number, a string or a boolean as
  for a scalar argument (a real is its machine number: the interpreter's
  `N(x, 15)` keeps 15 digits, so the two agree within 1e-12, and the
  interpreter's exact `Cos(1)` is a number). The engine's value must be the
  interpreter's, so a list, a tuple or a record is taken only where the lowering
  knows that the interpreter holds a `List` or a `Tuple` literal (`Listed` of
  `lower-context.ts`, `Lowering.listed`): a `List` or a `Tuple` literal node of
  the program of listed elements, a field of a record of listed fields, the
  parameter of a function given a listed argument at its first call, and a call
  of a function whose body is listed. The interpreter holds a `Range`, a
  `Linspace` or a `Reverse` as a lazy collection, which the code holds as the
  array of its elements: such a value inside a list, a tuple or a record
  declines. At the top of an argument the interpreter passes the `List` of the
  elements of a finite lazy indexed collection (`listedHostArguments()` of
  `listed-element.ts`, CE-1807), so there a list of scalars whose static type
  is a list and whose length is a constant of at most `ce.maxCollectionSize`
  is taken whatever made it (`listedByHost()` of `lower.ts`): a `Range`, a
  `Map`, an element-wise sum, a constant, an `if` of two lists. A list of a
  run-time length there declines. A function lowered for a listed argument
  declines a later call with an argument that is not (`coversListed()`). The
  tracking runs in a second lowering of a program whose first lowering reaches
  such a host argument (`NeedsListed`), so a program with no such argument keeps
  its code; in it, a `Tuple` or a `List` literal of several types holds its head
  too, so `figureDraw((t, "a"))` and `draw([circle(…), circle(…)])` compile. A
  record of no names that is not such a literal (a constant `pair = (1, "a")`),
  a colour (the code holds `Rgb(0.5, 0, 0)` in OKLCh), a complex number, a list
  of a run-time length in a rest argument and a lane `rows` decline. The host
  function's static type still must be `real`, `integer`, `boolean` or
  `nothing`.
- **The result of `run()`.** A record result of the entry is converted once, at
  the root (`record` of the `Syntax`, from the IR type of the result): a record
  of a named tuple type is an object keyed by its field names
  (`f(t) = P(cos(t), sin(t))` gives `{x: 0.54, y: 0.84}` at `t = 1`), a record
  in a field is converted the same way, a field that can hold a complex value
  follows the result convention (`{value: 2}`, not `{value: {re: 2, im: 0}}`), a
  `nothing` field is `null`, a colour keeps its run-time object, and a record
  with no names stays an array. A record result has no batch: `broadcast()` and
  `broadcastAsync()` throw.

## Arrays

A mutable array of machine cells (`array<T>`, `docs/COMPILATION-MODEL.md`,
"Arrays") is a value of the lane `array`, on JavaScript in the default mode,
and read as an input on GLSL (`lower-arrays.ts`). Its IR type holds the cell: `IRType.array = { cell,
type, lane, tuple? }`, the storage kind of `arrayStorageKind()`, the lane of a
cell (`integer` or `real`) and, for a tuple cell, its tag and field names. An
array has no length in its type: it is one shape whatever its count.

The value is the engine's `BoxedArray`. The code reads its fields at each
use: `_cells` (the typed array), `_count`, `_version`. So every operation of
the lane is `effectful` (`arr.get`, `arr.set`, `arr.byte`, `arr.setbyte`,
`arr.len`, `arr.touch`, `arr.swap`, `arr.from.*`; the forms `.int` for an
integer cell and `.r` for an index on the real lane, which is tested for an
integer): they keep their place, count and order, and no pass moves a read
across a store, a `Swap` or a call of the host. `arr.ref`, the reference of
an array that a value of the program holds, is pure.

How an array reaches the code (`lower-arrays.ts`, `adapter.ts`):

- a parameter of the root function literal: an entry parameter with a check
  of the cell type (`arrayEntryCheck`);
- a name whose value is an array: an input `_.name` that the wrapper of
  `run()` reads in the engine at each call, from the definition of the name
  at the compilation, and checks; the name is in the result's `arrays`, not
  in `captures`;
- a name whose value is an array and that the root function literal
  assigns, itself or through a user function: a name of `Program.assigns`
  (`Assigned.array`), not of `arrays`, which `run()` reads and writes back
  (`assigningRun()`) and the code writes and reads around each call of the
  host (`state.put.arr`, `state.get.arr`);
- in a program that calls the host, itself or through a user function, a
  name whose value is an array and that the program reads: a name of
  `Program.assigns` with `Assigned.read`, reported in `arrays`, which the
  code reads again after each call of the host (`state.get.arr`, no
  `state.put`) and `run()` does not write back;
- an array inside a value that a name holds (a named tuple): `_SYS.arrays.refs[k]`,
  bound in `runtimeOf()` as `_SYS.hosts` is, with the name in `captures`;
- `ArrayFrom`: a call of `_SYS.arrays.make[k]`, which evaluates the engine's
  `ArrayFrom` with the binding of the node.

A read is `+a._cells[i > 0 ? i - 1 : a._cells.length + i]`: outside the
cells a typed array gives `undefined`, and the unary plus makes it `NaN`, the
interpreter's value. A store is `(a._version++, a._cells[…] = v)`, with no
range test. A tuple cell is four bytes at `4k` to `4k + 3`: the read of one
field is one `arr.byte`, and the read of the cell is a record of its nominal
type (or a tuple of the code for a type with no name). A unit that holds a
store calls `arrayNote` (the store epoch of the engine and one state event)
before each `call.host<k>` and in a `finally` of `run()`.

The scan `callbackScan()` declines a read or a store in the body of a
function literal that is an operand or a value. `absent()` declines a
discharge of a record of a nominal type that is a tuple cell. The entry plan
of such code has `arrays: true`, and `restoreEntryPlan()` refuses it.

On GLSL (`LowerOptions.glsl`) an array is an input of the entry and is read
only: `lower-arrays.ts` declines every other use (`readOnly()`,
`heldValue()`), and integer cells whose range is outside ±2^24 (`exact()`).
A cell of one number is `arr.get` or `arr.get.int` (`.r` for an index on the
real lane, spelled alike), a tuple cell one `arr.get4` (a list of four
integers, one texel; the verifier knows its type), an element of it an
`elem` of that read, and the count `arr.len`. For a tuple cell of a nominal
type the `arr.get4` is the record of that type (four integer fields, the
name and the field names), and so is the constructor of such a type on GLSL
(`recordLowering(cx, javascript, pixels)`; every other constructor declines):
the profile admits the lane `record` for that record only (`vectorRecords`,
`vectorRecord()` of `ir.ts`), the printer spells it `vec4` and a `field` as
an element, and the lowering of records keeps its rules (the nominal name
in `sameFields()`, the equality of the fields of one nominal type, the
declines of a record against a tuple and of the discharges in `absent()`). After the passes,
`holdArrays()` (`index.ts`) gives each array input the texture of its cells
in `IRType.storage` when it is not the default one (`isampler2D` for signed
integer cells, `sampler2D` for the names of the option `storage`, bytes in a
normalized texture) and, to a fixed point, to the parameters of the
functions it is passed to; it refuses an array that is not a parameter, a
yield, a read by another operation than an `arr.*`, and a parameter that two
calls give two textures. The printer spells `<op>.<storage>` as for a list
in storage: one helper per texture (`_gpu_ir_cell_f`, `_gpu_ir_cell_u`,
`_gpu_ir_cell_i`, `_gpu_ir_cell_n`, `_gpu_ir_cell4_u`, `_gpu_ir_cell4_n`),
with the index test of `at` against the uniform `$0_count`. An array
parameter is declared as its sampler and its count
(`highp usampler2D A, int A_count`), and a call passes both (`Syntax.call`
takes the types of the arguments); `GlslResult.parameters` lists the
sampler, then the count (`{ input: 'A', name: 'A_count', type: 'int',
count: true }`), in the order of the parameters of `f`. `holdStorage()`
leaves an array to `holdArrays()` on GLSL only; the JavaScript slice keeps
its refusal of a `storage` hint on an array. `adapter-glsl.ts` reports
`lowered` (the sampler: `highp usampler2D`, `highp isampler2D` or
`highp sampler2D`) and `count` in `freeSymbolTypes`, and declines a constant
index that is 0 or not an integer, another input spelled as the sampler or
the count of an array, and a `vars` entry of an array.

## How to add

- An operator: one row in `OPERATORS`; a spelling in `JS.ops` and `GLSL.ops` for
  each new IR operation (`op.int` falls back to `op`), in `JS_BIGINT.ops` when
  it is exact on `bigint` values, and in `JS_INTERVAL.ops` when a kernel of
  `_IA` encloses it. A target with no spelling declines the operation.
- A list-reading operator: a row with a `'list'` operand (as `At`), or a
  reduction in `REDUCTIONS` (it reads its list through a source).
- A construct: one case in `lower.ts`. A construct with a body is a region row
  in `REGION_ROWS` (arguments, parameters, result types) and a region spelling
  per target; no new instruction kind.
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
- On JavaScript (not in the bigint and complex modes) `scalarize` writes an
  element-wise operation of at most 16 elements one element at a time (the short
  lists of "Lists"); a longer one stays element-wise.
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
- A `real` local declared or assigned a value outside its type (NaN, a complex
  number) is an error of the interpreter; the compiled code goes on with the
  value, and can overwrite it (`Block(Declare(t, real, Sqrt(x)), t := 2, t)`
  gives 2 at x = -1).

## Options and results

`compile()` compiles every built-in target with this pipeline; all the glue is
in `adapter.ts` (JavaScript), `adapter-glsl.ts` and `adapter-interval.ts`, and
`compile-expression.ts` dispatches to them.

- **A decline** (`Decline`, also a refusal of the target) is a public diagnostic
  with the head in `operator` and the node in `value`. Its code names the reason
  when the `Decline` has one (`lower-context.ts`): `'static-type-error'`,
  `'unsettled-shape'` (a shape not settled at compile time),
  `'possible-nothing'`, `'bigint-lane'`, `'lane-mismatch'` (a complex value
  where a real one is declared), `'unsupported-mode'`; otherwise, for a
  capability the pipeline does not have, `'outside-profile'`. An input with no
  type (`UntypedInputs`) is `'untyped-input'` ("Inputs" above); any other error
  of the pipeline (`SliceInternalError`, a printer error) is a
  `'compile-error'`. Both follow `fallback`: the interpreter, or a throw with
  `fallback: false`. A `CancellationError` is thrown as it is.
- **Options.** One table classifies every option of `compile()` (`IR_OPTIONS` in
  `adapter.ts`; `compile-expression.ts` fails the type check when an option has
  no class). Mapped: `iterationBudget` ("Loops and the runtime"), `vars`
  (below), `quadrature` (`'adaptive'`; `'monte-carlo'` declines), `entryChecks`
  (the entry plan of the runtime, `checkEntry()`: a `{re, im}` value for a
  scalar real or integer input or parameter, and a string or a typed array for a
  list input, throw a `TypeError` that names it; another value outside the
  declared type gives an unspecified result; a number for a scalar complex input
  or parameter is converted to `{re, im: 0}`, also with `entryChecks: false`; a
  conversion copies the own properties of the inputs object, so an inherited
  input or a getter is then lost, a known limitation), `mode: 'complex'` and
  `mode: 'bigint'` (reported in the result's `mode`; "The `bigint` mode"),
  `cse: false` (the passes without `cse`), `constantFold: false` (the lowering
  evaluates no closed sub-expression with `N()`, and the `fold` pass is off),
  `symbolDeps` (the user functions compiled in and the names whose value the
  code holds, `captures`) and `varsObjectRefs` (the inputs read from the inputs
  object, filled also when a literal declines for a free name). Admitted with no
  effect: `storage` on JavaScript (`CompilationOptions.storage`),
  `mode: 'strict'`, `profile: 'ir'` and `callerLocals`. The options `target`,
  `functions`, `operators`, `imports`, `preamble`, `strictTypes` and `broadcast`
  throw an error that names the option. `vars` declines in the `bigint` mode.
- **`vars`.** A mapped name is read as the host's text at each use, in program
  order (an effectful operation, so `w - w` with `w: '_.draw()'` calls `draw`
  twice), in the scope of the entry, where `_` is the inputs object; a list
  operator does not decline it as an effect of an element ("Lists"). The mapping
  wins over the engine's value of the name and is never folded; a local of the
  same name shadows it. Its lane is the name's type (a wide or `any` type is a
  real). A read in a root function literal (no such scope), or in a user
  function of a text other than a read of the inputs object (see "User
  functions"), a call of a mapped name, a list or complex type, and a text with
  `$` or `$#` and a digit (a placeholder of a spelling) decline. A mapped name
  whose text the code holds is in `freeSymbols` ("The report of the inputs").
- **Calling convention.** The result is `calling: 'expression'`, `run(inputs)`,
  or, for a root `Function` literal, `calling: 'lambda'`, `run(a0, a1, …)`, the
  convention of `implicitCompile()`; a literal of no parameter (`Function(42)`)
  is a `lambda` too. A literal whose body reads a free name declines: that
  convention has no object for it (`compileSlice()` itself takes one after the
  arguments). The inputs of an expression are in `freeSymbols` and
  `varsObjectRefs`. A root literal that assigns a variable of the scope of the
  compilation (`s = s + t` with `s` a variable of the engine, not a local or a
  parameter of the literal; `assignedNames()` of `lower.ts`) has the name in
  `assigns` (`Program.assigns`): on the plain JavaScript target, for a variable
  of a declared type of the lane `real`, `integer` or `boolean`, the name is a
  local whose value is a positional parameter after the arguments (a list of
  such values of no stated length, CE-1662: its length and the list, bound as a
  list local written whole, `wholeLocal()`, whose length a write can change; a
  list of lists of two lengths not stated, CE-1721: the host's array of arrays
  of the lane `rows`, bound as a local of the lane of its elements
  (`Binding.grid`) that only an `Assign` that is a statement of the body writes,
  with a list of rank 2 of that lane, which the entry returns and `run()` writes
  back as a `List` of `List`s), its stored value is hidden while the body is
  lowered (`withVarsValuesHidden()`), and the entry returns the array of the
  value of the body (NaN for a body that ends in an assignment) and the value of
  each name after it. `run()` reads each value in the engine before the call and
  writes the new values back after it (`assigningRun()` of `adapter.ts`); the
  result is not `shippable`, and `implicitCompile()` gives no result for it.
  Another target, the interval and `bigint` modes, an inferred type, a constant
  and another lane decline. A user function that the body calls, itself or
  through its calls, can read and write such a scalar name (CE-1776):
  `assignedNames()` scans the body of each user function that is called, where a
  name counts when it resolves to the variable (`definitionIn()`), and
  `Lowering.stateOf()` gives the names that each function reads and writes; the
  `facts()` of a call count them. The function captures each name that it uses
  at the start of its body (so that an arm rebinds a binding of the frame,
  `arm()`), and when it writes one its IR function returns the record of the
  value of the body and of each name it writes; the call reads the fields and
  rebinds the names (`Lowering.stateWrite()`). A `Loop` carries such a name,
  as it carries a local (`loop()`). A function named as an operand
  (`Map(f, L)`, `namedUser()`) is scanned as a call, and the facts of the
  symbol count its names; a call of a function that the scan did not reach (a
  function value) that reads such a name declines (`free()`), and so does a
  lazy collection that reaches such a function and reads no variable of the
  engine (`readsVariableIn()`, the interpreter's rule of listing, without
  the names that the program binds). A write in a loop frame (a `Sum`, a
  callback of `Map`), a call that maps over a list (`mapOver()`), a recursive
  writer and a list name written by a function decline. A name that holds an
  array of machine cells is such a name too (`Assigned.array`): a positional
  parameter of its array type, a local that an `Assign` binds to another
  array of the same cells, whose reference the entry returns and `run()`
  writes back. A call of a function of the host in such a literal
  (`hostCall()`) reads and writes every name of `assigns`: before the
  `call.host<k>`, one `state.put` of the index `j` and the value of each
  name (`_SYS.state.put(j, v)`, `writeAssigned()` of `print-js.ts`, the
  write of `run()`), and after it one `state.get` of each, on the lane of
  the name (`_SYS.state.get(j)`, `readAssigned()`, the read of `run()`,
  which throws its `TypeError`), which rebinds the name
  (`Lowering.stateWrite()`). Both operations are effectful, so they keep
  their place around the call. The `facts()` of the call count every name,
  so a `Loop` carries them and the arms of an `If` give them; a user
  function that calls the host, itself or through its calls
  (`assignedNames()` records it as `host` of `stateOf()`), reads and writes
  every name that is not a list. A list name, and a call in a loop frame (a
  `Sum`, a callback of `Map`), decline. A warning of a
  random frame is in `warnings` (`kind: 'correctness'`). `profile` is `'ir'`.
- **Stored code.** The result has the fields of stored code
  (`StoredJavaScript`): `preambleOnce` (and `preamble`, the same text) holds the
  helpers and the user functions, `code` is the body (an expression of the
  inputs object `_`, or the function of a literal), `runtimeVersion` is
  `RUNTIME_VERSION`, and `entryPlan` holds the inputs that a loader checks
  (`checkEntry()`: the conversion of a number for a complex input, and with
  `entryChecks` the refusals above; `lists` and the scalar `booleans` tell a
  batch loader which inputs are shared lists and boolean columns). For a literal
  with helpers, `code` evaluates them and gives the function, and `callCode` is
  the function alone, so a lambda loads from `code` alone.
  `reconstructionDigits` is the count of digits to which the exponent of a
  negative base is read; a loader sets it around each call, and `run()` reads
  the engine's current count, the same unless the precision changes between the
  compilation and the call. `createJavaScriptRuntime().load()` and a worker of
  the kernel pool load it; `run()` is built as `load()` builds it: the same
  two-stage runner (`twoStageRunner()`, over the engine's runtime source), the
  same entry plan (`checkEntry()`) and the same result convention
  (`normalizeRunResult()`), so `run()` and loaded code agree by construction.
  `shippable` is false for code that draws or integrates (`isShippableCode()`)
  and for a `vars` text that is not a read of the inputs object
  (`readsVarsObject()`: `_.E` is shippable). There is no `pure`.
- **The report of the inputs.** The same rule on JavaScript, GLSL and
  interval-js (`inputReport()` of `adapter.ts`). `freeSymbols` holds the names
  that the code reads: the inputs of the entry (a parameter of the entry that is
  not a length or a positional one) and the names of `vars` whose text the code
  holds (`hostReads()`, in a function body too; on GLSL a name of `vars` is a
  parameter), in the order the lowering first reads them (`Program.inputs`), so
  a name read only in the body of a user function comes after the names of the
  expression read before the call. A name whose value the code holds as a
  literal is not read: it is in `symbolDeps`. A program that reads no input, a
  constant predicate too, has `[]`. `freeSymbolTypes` has an entry for each name
  of `freeSymbols`: `type` is the declared type of the binding read at the entry
  (for a name read only in a function body, the binding in the scope of the
  compilation, or the type the `inputs` option gives it) when that binding
  declares one (also a binding of a scope popped before `compile()`:
  `u: real<0..5>` stays `real<0..5>`), with `provenance: 'declared'`, else the
  engine type that the lowering gives the input, with `'inferred'`, spelled as a
  declaration (`declaredTypeText()`); `lowered` is the type that the code reads
  it as, from the IR type of its parameter or the lane of its `vars` read: on
  JavaScript `number`, `boolean`, `complex` (a complex input, in the complex
  mode an input of type `number` too), `color`, `point` for a tuple, `array` for
  another list; on interval-js the same with `interval` for `number`; on GLSL
  the type of the parameter (below).
- **Batches and `runAsync()`.** The result of an expression (not of a literal)
  has `broadcast()`, `broadcastAsync()`, `willUsePool()`, `runAsync()` and
  `willParallelize()`, and `broadcastOutputs` for a type of more than one value
  per cell, built by generic functions (`broadcastNumbers()`,
  `broadcastNumbersSlice()`, `makeBroadcastAsync()`, `makeWillUsePool()`,
  `makeRunAsync()`, `makeWillParallelize()`) over the raw call of the code, its
  entry plan and the result as stored code, which a worker loads. Each cell is
  the value of `run()` at that cell; a list input is shared by the cells, also
  with `entryChecks: false`. There is no batch body (CE-410). In the `bigint`
  mode a batch is refused with an error.

  `runAsync()` (`run-async.ts`; design note
  `docs/plans/2026-11-18-ir-parallel-for-and-list-locals.md`, section 6) sends a
  `parallel for` to the worker pool. After the passes, `outline()`
  (`outline.ts`) reads the program, in the default mode with no
  `iterationBudget` and for an expression; it changes nothing, so `run()` and
  `code` are those of a program with no pool. It takes a loop marked `parallel`
  at a waiting position (its enclosing regions, up to its function's body, are
  `if` arms and bodies of loops that are not marked) whose accumulators it
  admits: each carried value a real or an integer to which the body only adds
  (each value of the body has at most one root, the carried parameter from which
  it accumulates through `add`, an `if` whose two arms yield that root, or an
  inner loop whose body yields its own parameter there; any other read of a
  value with a root fails), and each array defined outside the loop that the
  body writes a real or integer list whose only uses are triples
  `set(L, k, add(get(L, k), e))` of one index in one region. Its worker program
  is a root function literal of `i0`, `i1`, `lo` and the values that the body
  reads from outside (a constant is copied), whose body is the same `loop` with
  a `window: [i0, i1]` (the passes `i0 <= i < i1` of `run()`'s count, the index
  of pass `i` being `lo + i`), each scalar accumulator from `-0` and each list
  accumulator a new `Float64Array` of `-0` (the region row `zeros`), and which
  returns the partial sums, then the partial arrays (`tuple`). It is printed by
  `printJavaScript()` with no passes, so a worker runs the IR of `run()`'s pass;
  a loop whose worker program is not shippable (`isShippableCode()`) or reads a
  name of `vars` runs in order. A function waits when it holds such a loop or a
  waiting call of a function that waits (a fixed point); with the entry waiting,
  `printProgram()` prints the asynchronous text (`Wait`): each function that the
  entry reaches through waiting calls as `async <name>$async`, whose waiting
  calls are awaited, and each pool loop as
  `_run.loop(id, lo, hi, [values], [lists])`, then the loop of `run()` when it
  gives `undefined`, else the wait and `_run.addNumber()` / `_run.addList()`.
  Every wait is `_run.r(await _run.s(p).then(_run.ok, _run.fail))`, and every
  `async` function ends with `_run.d()` in a `finally`: the caller's digits and
  deadline frame are current whenever the program does not run. The text is
  built over the same `preambleOnce` at the first call of `runAsync()`. The
  driver (`_run.loop`) checks the pool, a step budget, `minPasses` and the size
  of the private lists, splits the passes into one sub-range per worker, sends
  each with the deadline of the frame current at the call, runs a sub-range that
  a worker did not complete again on the calling thread, and reports the route
  to `onLoop`. `willParallelize()` is true when the program has a pool loop and
  the pool is usable.

`compile(expr, { to: 'glsl' })` (`adapter-glsl.ts`) takes a scalar result (real,
integer, boolean, or complex, a `vec2`: "The complex lane") or a list of stated
length (a point, as `vec2(cos(t), sin(t))`, or a `float[n]`) of inputs that are
scalars or lists of a stated length (`tuple<real, real>`, `list<real^3>`;
`list<real^6>` is a `float[6]`; by a rule of the target, `At` with a constant
index after the passes (a folded one too) that is 0, not an integer or past the
stated length of its list (an input, a list in storage, a literal, in the entry
or in a user function) declines, where JavaScript gives NaN, so that a host can
key a retry on the refusal; a run-time index keeps the read that is NaN
outside), or a colour (an OKLCh `vec3`, or the channels of the space of an
`AsOklab` or `AsRgb` at the root; "The colour lane"). The result has no `run`;
`code` is an expression, or statements that end in `return …;`, in which an
input is its bare name (the option `bareInputs` of `compileSlice()`; the host
declares the uniform or the parameter); `preamble` holds the helpers and the
user functions, named `_gpu_ir_…` and `_fn_ir_…` in the GLSL syntax (a host that
joins two compilations renames by `_gpu_` and `_fn_`); a float literal is the
shortest decimal that reads back as the same float32 and is not above the
largest float (`0.1`, `250.0`, `1.1754944e-38`; the largest float is
`3.4028234663852886e+38`, since `3.4028235e+38` is above it and a compiler can
read it as Infinity), so a table of 1,024 numbers in [0, 1) takes about 12
characters per element; `freeSymbols` and `freeSymbolTypes` follow the rule of
every target ("The report of the inputs"), with as `lowered` the GLSL type of
the entry parameter, which the host binds the uniform as (`float`, `bool`,
`vec2`, `bvec3`, `float[6]`; `vec2` for a complex input); `warnings` holds the
`float32-unsafe-argument` warning (`kind: 'correctness'`, `value` the operand),
once per operand of a `Mod` or a `Fract` in which a constant of magnitude 1000
or more amplifies a trigonometric value (the rule of `isAmplifiedTrig()`, with a
memo per node: `amplifiedTrigMemo()`, linear in a shared graph), in the
expression and the bodies of the user functions it calls (each node once); there
is no exact sine hash and no `float32Bounds`, so such an operand warns also
where an exact form exists, except in a `Mod` or a `Fract` that is closed as a
whole (numbers and library constants under library rows that are not effectful,
`Mod(10000·Sin(100000), 1)`), which the lowering folds in doubles: it warns only
with `constantFold: false`. A closed operand of a `Mod` by an input is not
folded and warns (`Mod(10000000·Sin(1), x)`); `unsupported` is empty, `mode` is
`'strict'` (`'complex'` in the complex mode), `profile` is `'ir'`. A name of
`vars` is an input whose read is the host's text (`x + y` with
`vars: {x: 'u_x'}` is `(u_x + y)`, and `x` stays in `freeSymbols` with its
type): a name, a member or an element of one (`u_x`, `u.P`, `u[0]`), which calls
nothing and is spliced at each read; a read in a user function is passed as any
input (see "User functions"). Another text, a text with a name that is a GLSL
word or holds `__` or a `gl_` prefix (`u.sample`, `u.gl_x`), a text whose first
name could not be an input name (below), and a name that has a value in the
engine decline. `storage: { S: 'sampler2D' }`: the list input `S` (of numbers,
of a stated length) is held by the host in a texture (a single-channel float
texture, one element per texel, row-major from texel (0, 0), of any width, read
at level 0 with no filtering; the host declares `uniform sampler2D S;` and
`precision highp sampler2D;`). After the passes, `holdStorage()` (`index.ts`)
marks `S` and, to a fixed point, the parameters of the functions it is passed to
(`IRType.storage`): each read must be the list operand of `elem` or `at`, which
the printer spells `elem.sampler2D` and `at.sampler2D` (one helper
`_gpu_ir_texel(v, k)` for every length; `at` keeps the rule of `At`, NaN
outside), or an argument of a call whose parameter is then a `sampler2D`. So
`At(S, k)`, a reduction, an element-wise operation (scalarized to reads) and a
user function that reads `S` or takes it as a list argument compile; `S` as a
value (a result, an arm, a yield), a function called with `S` and with another
list, and a `vars` text for `S` decline. `freeSymbolTypes.S.lowered` is
`float[7]` or `vec3` by its length. A function always takes the inputs that its
body reads as parameters ("User functions"); a call under a binder of the
input's name declines. Declined with `'outside-profile'`: a list result of a
user function of a run-time length, a root `Function` literal, loops whose
passes can exceed the budget ("Loops and the runtime"), and an input name that
is not a plain GLSL identifier, is a reserved word (`gpu-reserved.ts`), can be a
name of the printer (`v<digits>…`, `_gpu_…`, `_fn_…`) or is the name of a
function that the code calls; `mode: 'bigint'` is declined with
`'unsupported-mode'`. `fallback: true` then gives a result with no code, whose
`run` is the interpreter, and logs a warning (the console).
