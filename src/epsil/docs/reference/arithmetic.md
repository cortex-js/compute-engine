---
title: Arithmetic Reference
sidebar_label: Arithmetic
slug: /epsil/reference/arithmetic/
description: "The arithmetic library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from arithmetic.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Arithmetic

The **arithmetic** library holds the numeric operations: the arithmetic
operators, powers and roots, exponentials and logarithms, rounding, the
number-theory predicates, sums and products, the special functions (gamma,
zeta, Bessel, Airy), the parts of a complex number, and the numeric constants.
This introduction gives the concepts you need before you read the entries.

## Operators and precedence

Most arithmetic is written with operators. You write the operator, and the
engine receives the definition. The entries list these definitions under their
MathJSON name.

| Epsil syntax | Definition  | Meaning                                  |
| :----------- | :---------- | :--------------------------------------- |
| `a + b`      | `Add`       | Sum                                      |
| `a - b`      | `Subtract`  | Difference                               |
| `-a`         | `Negate`    | Additive inverse                         |
| `a * b`      | `Multiply`  | Product                                  |
| `a / b`      | `Divide`    | Quotient                                 |
| `a % b`      | `Mod`       | Remainder of the floored division        |
| `a ^ b`, `a ** b` | `Power` | Exponentiation                          |
| `n!`         | `Factorial` | Factorial                                |
| `√x`, `∛x`   | `Sqrt`, `Root` | Square root and cube root             |

From the loosest to the tightest, the arithmetic operators group in this
order: `+` and `-`, then `*`, `/` and `%`, then the prefix `-`, then `^`, then
the postfix `!`. The operators of one tier group from the left, except `^`,
which groups from the right. A prefix `-` binds looser than `^`, so `-3^2` is
`-(3^2)`.

```epsil
[2 + 3 * 4, (2 + 3) * 4, 7 / 2 * 2, 2^3^2, -3^2, 2 * 3!]
// ➔ [14, 20, 7, 512, -9, 12]
```

An infix operator must have a space on both sides or on neither side. The
[Operators](/epsil/operators/) page gives the full table and the whitespace
rule.

## Exact and numeric evaluation

The engine keeps a value **exact** when it can. A fraction stays a fraction, a
radical stays a radical, and a function of an exact argument with no closed
form stays symbolic. `N` gives the numeric value:

```epsil
[1/3 + 1/6, sqrt(8), ln(2), ln(8, 2)]
// ➔ [1/2, 2sqrt(2), ln(2), 3]
```

```epsil
[N(1/3), N(sqrt(8)), N(ln(2))]
// ➔ [0.333333333333333333333, 2.8284271247461900976, 0.693147180559945309417]
```

A number written with a decimal point or an exponent, such as `2.5` or
`1.5e3`, is a floating-point number. A function of a floating-point argument
gives a floating-point value:

```epsil
[ln(2), ln(2.5), sqrt(2), sqrt(2.5)]
// ➔ [ln(2), 0.916290731874155065184, sqrt(2), 1.581138830084189666]
```

`N` takes an optional number of significant digits:

```epsil
N(sqrt(2), 50)
// ➔ 1.4142135623730950488016887242096980785696718753769
```

Use `rational` to change a float to the nearest simple fraction:

```epsil
[rational(0.42), rational(1.25)]
// ➔ [21/50, 5/4]
```

## Kinds of numbers

The numeric types form a chain: every `integer` is a `rational`, every
`rational` is a `real`, and every `real` is a `complex`. `number` is the widest
numeric type. It holds the finite numbers, the infinities and `NaN`. Test the
type of a value with `is`:

```epsil
[5 is integer, 1/2 is integer, 1/3 is rational, sqrt(2) is rational, sqrt(2) is real]
// ➔ [true, false, true, false, true]
```

The types `integer`, `rational`, `real` and `complex` hold **finite** values
only. An infinity is a `number`, but it is not a `real`:

```epsil
[oo is real, oo is number]
// ➔ [false, true]
```

A complex number is written with the imaginary unit `i`. The square root of a
negative number is imaginary, and the real root of a negative number is real:

```epsil
[(1 + 2i) * (3 - i), sqrt(-4), root(-8, 3)]
// ➔ [(5 + 5i), 2i, -2]
```

`re`, `im`, `abs`, `arg` and `conjugate` give the parts of a complex number:

```epsil
[re(3 + 4i), im(3 + 4i), abs(3 + 4i), conjugate(3 + 4i)]
// ➔ [3, 4, 5, (3 - 4i)]
```

## The canonical form of sums and products

The engine puts every sum and product in a **canonical form** before it
evaluates it. This has visible effects:

- The exact numbers of a sum or product are combined: `x + 2 + 3` becomes
  `x + 5`.
- Equal terms are collected, and equal factors become a power.
- The operands are sorted in a fixed order, so `x + 1` and `1 + x` are the
  same expression.

```epsil
[x + 2 + 3 + x, 2 * x + 3 * x - x, x * x * 2 * y]
// ➔ [2x + 5, 4x, 2y * x^2]
```

A product of sums stays **factored**, and a power of a sum is not expanded.
Use `expand` to multiply them out:

```epsil
[(a + b) * (c + d), expand((a + b) * (c + d))]
// ➔ [(a + b) * (c + d), a * c + b * c + a * d + b * d]
```

```epsil
[(a + b)^2, expand((a + b)^2)]
// ➔ [(a + b)^2, a^2 + b^2 + 2a * b]
```

A sum still collects like terms, and to do this it opens a factored term:

```epsil
a + b + 2 * (a + b)
// ➔ 3a + 3b
```

When `x` has no value, `x / x` becomes `1` and `x - x` becomes `0`. The
first rule assumes that `x` is not zero.

```epsil
[x / x, x - x]
// ➔ [1, 0]
```

## Infinity and NaN

A result can leave the finite numbers in two ways, and the engine keeps them
apart.

- A **pole**, such as a nonzero number divided by zero, gives complex
  infinity (`complexInfinity`, displayed as `~oo`): an infinity with no
  direction. Arithmetic on a signed
  infinity (`oo`, `-oo`) gives a signed infinity.
- An **indeterminate form**, such as `0/0`, `oo - oo` or `oo * 0`, gives
  `NaN`: a question with no value.

```epsil
[1/0, 0/0, oo + 1, oo - oo, oo * 0, 1/oo]
// ➔ [~oo, NaN, +oo, NaN, NaN, 0]
```

`NaN` propagates: a numeric function of `NaN` is `NaN`. This is true for
evaluation as well as for `N`.

```epsil
[NaN + 1, sqrt(NaN), NaN % 2]
// ➔ [NaN, NaN, NaN]
```

## Rounding and remainders

`floor` rounds down, `ceil` rounds up, `truncate` rounds toward zero, and
`round` rounds to the nearest integer, with a tie rounded away from zero (a
host can choose another rule with the engine setting `roundingTies`):

```epsil
[floor(-2.5), ceil(-2.5), truncate(-2.5), round(-2.5)]
// ➔ [-3, -2, -2, -3]
```

With a second argument, `floor`, `ceil`, `truncate` and `round` round to a
multiple of that step instead of an integer. `floor(x, step)` is the greatest
multiple of the step that is at most `x`, whatever the sign of the step, and
`round(x, step)` the nearest multiple. To round to `n` decimal places, the
step is `10^-n`:

```epsil
[floor(226, 10), ceil(226, 10), truncate(-226, 10), round(226, 10), round(3.14159, 1/100)]
// ➔ [220, 230, -220, 230, 157/50]
```

There are two remainders. `a % b` (`Mod`) takes the sign of the divisor `b`.
`remainder(a, b)` rounds the quotient to the nearest integer, so its result
can be negative when `b` is positive:

```epsil
[7 % 3, -7 % 3, 7 % -3, remainder(-7, 3)]
// ➔ [1, 2, -2, -1]
```

## Sums and products

`sum` and `product` have three forms.

With a collection, they add or multiply its elements. When some elements are
not numbers, the result is a sum or a product:

```epsil
[sum([5, 7, 11]), sum([5, 7, x, y]), product([5, 7, 11])]
// ➔ [23, x + y + 12, 385]
```

With a body and an index `k in 1..n` (an index over a collection), they add or
multiply the body for each value of `k`. The tuple `(k, lower, upper)` is also
accepted:

```epsil
[sum(k + 1, k in 1..10), product(k + 1, (k, 1, 10))]
// ➔ [65, 39916800]
```

An `if` after the index keeps the values for which the condition is true, as in
the clause of a comprehension:

```epsil
[sum(k, k in 1..10 if isPrime(k)), product(k, k in 1..10 if k % 3 == 0)]
// ➔ [17, 162]
```

With a body and an indexing set `k in S`, the index takes each value of the
set:

```epsil
sum(n^2, n in set(1, 2, 3))
// ➔ 14
```

A sum over an infinite range has an exact value when it is a known convergent
series, such as a p-series, a geometric series or the exponential series.
Otherwise it stays symbolic, and `N` gives a numeric approximation.

```epsil
[sum(1/k^2, (k, 1, oo)), sum((1/2)^k, (k, 0, oo)), sum(x^k/k!, (k, 0, oo))]
// ➔ [1/6 * pi^2, 2, e^x]
```

A sum with a symbolic bound stays a sum when it is evaluated. `simplify`
replaces it by a closed form when it knows one:

```epsil
simplify(sum(k^2, (k, 1, n)))
// ➔ 1/6 * (2n^3 + 3n^2 + n)
```

## Constants

| Epsil          | Value                | Meaning                                         |
| :------------- | :------------------- | :---------------------------------------------- |
| `e`            | 2.718281828…         | Euler's number, the base of the natural logarithm |
| `i`            | `sqrt(-1)`           | The imaginary unit                              |
| `oo`, `-oo`    |                      | Positive and negative infinity                  |
| `complexInfinity` |                   | Complex infinity, with no direction             |
| `NaN`          |                      | Not a number                                    |
| `goldenRatio`  | 1.618033988…         | `(1 + sqrt(5)) / 2`                             |
| `eulerGamma`   | 0.577215664…         | The Euler–Mascheroni constant                   |
| `catalanConstant` | 0.915965594…      | Catalan's constant                              |
| `machineEpsilon` | 2.220446049…e-16   | The distance from 1 to the next larger machine float |

A constant is exact. `N` gives its numeric value:

```epsil
[ln(e^3), N(goldenRatio)]
// ➔ [3, 1.6180339887498948482]
```

The constant `pi` and the trigonometric functions are in the
[Trigonometry](/epsil/reference/trigonometry/) library.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### abs

MathJSON `Abs` · `(complex | infinity | quantity) -> number`

- argument 1 — The number; a complex number gives its modulus. Sample: `-3`.

Absolute value (magnitude) of a number.

```epsil
[abs(-3), abs(3 - 4i)]
// ➔ [3,5]
```

### absArg

MathJSON `AbsArg` · `(complex | infinity) -> tuple<+oo | real, real>`

- argument 1 — The complex number to write in polar form. Sample: `1 + i`.

Tuple of magnitude and argument of a complex number.

```epsil
[absArg(1 + i), absArg(-2)]
// ➔ [(sqrt(2), 1/4 * pi),(2, pi)]
```

### Add

`(value+) -> value`

Sum of two or more values.

```epsil
1 + x + 2 + x
// ➔ 2x + 3
```

### airyAi

MathJSON `AiryAi` · `(complex | infinity) -> number`

- argument 1 — The point at which the function is evaluated. Sample: `1`.

Airy function of the first kind

```epsil
N(airyAi(1))
// ➔ 0.135292416312881415524
```

### airyAiPrime

MathJSON `AiryAiPrime` · `(complex | infinity) -> number`

- argument 1 — The point at which the function is evaluated. Sample: `1`.

Derivative of the Airy function of the first kind

```epsil
N(airyAiPrime(0))
// ➔ -0.258819403792806798405
```

### airyBi

MathJSON `AiryBi` · `(complex | infinity) -> number`

- argument 1 — The point at which the function is evaluated. Sample: `1`.

Airy function of the second kind

```epsil
N(airyBi(0))
// ➔ 0.614926627446000735151
```

### airyBiPrime

MathJSON `AiryBiPrime` · `(complex | infinity) -> number`

- argument 1 — The point at which the function is evaluated. Sample: `1`.

Derivative of the Airy function of the second kind

```epsil
N(airyBiPrime(0))
// ➔ 0.448288357353826357915
```

### arg

MathJSON `Arg` · `(complex | infinity) -> number`

- argument 1 — The complex number; a negative real number gives π, and 0 gives 0. Sample: `1 + i`.

`arg` is an alias for `argument`, which is the preferred name. Returns the complex argument (phase angle) of a number.

```epsil
[arg(i), arg(1 + i)]
// ➔ [1/2 * pi,1/4 * pi]
```

### argument

MathJSON `Argument` · `(complex | infinity) -> number`

- argument 1 — The complex number; a negative real number gives π, and 0 gives 0. Sample: `1 + i`.

Complex argument (phase angle) of a number, in the engine's angular unit.

```epsil
[argument(1 + i), argument(-1)]
// ➔ [1/4 * pi,pi]
```

### besselI

MathJSON `BesselI` · `(order: complex, z: complex | infinity) -> number`

- `order` — The order ν of the function. Sample: `0`.
- `z` — The point at which the function is evaluated. Sample: `1`.

Modified Bessel function of the first kind

```epsil
N(besselI(0, 1))
// ➔ 1.2660658777520083356
```

### besselJ

MathJSON `BesselJ` · `(order: complex, z: complex | infinity) -> number`

- `order` — The order ν of the function. Sample: `0`.
- `z` — The point at which the function is evaluated. Sample: `1`.

Bessel function of the first kind

```epsil
N(besselJ(0, 1))
// ➔ 0.76519768655796655145
```

### besselK

MathJSON `BesselK` · `(order: complex, z: complex | infinity) -> number`

- `order` — The order ν of the function. Sample: `0`.
- `z` — The point at which the function is evaluated; at 0 the function is infinite, or stays unevaluated for some orders. Sample: `1`.

Modified Bessel function of the second kind (Macdonald function)

```epsil
N(besselK(0, 1))
// ➔ 0.421024438240708333336
```

### besselY

MathJSON `BesselY` · `(order: complex, z: complex | infinity) -> number`

- `order` — The order ν of the function. Sample: `0`.
- `z` — The point at which the function is evaluated; at 0 the function is infinite, or stays unevaluated for some orders. Sample: `1`.

Bessel function of the second kind (Neumann function)

```epsil
N(besselY(0, 1))
// ➔ 0.0882569642156769579829
```

### beta

MathJSON `Beta` · `(complex | infinity, complex | infinity, (complex | infinity)?, (complex | infinity)?) -> number`

- argument 1 — With two arguments, the parameter a; with three, the upper limit z of the incomplete beta function B_z(a, b); with four, the lower limit z0. Sample: `2`.
- argument 2 — With two arguments, the parameter b; with three, the parameter a; with four, the upper limit z1 of B_z1(a, b) − B_z0(a, b). Sample: `3`.
- argument 3 — With three arguments, the parameter b; with four, the parameter a. Sample: `2`.
- argument 4 — With four arguments, the parameter b. Sample: `3`.

Euler beta function

```epsil
[beta(2, 3), N(beta(1/2, 1/2))]
// ➔ [1/12,3.14159265358979323846]
```

```epsil
beta(1/2, 2, 3)
// ➔ 11/192
```

```epsil
beta(1/4, 1/2, 2, 3)
// ➔ 109/3072
```

### catalanConstant

MathJSON `CatalanConstant` · constant `real<0.915965594177219..0.9159655941772191>` = `0.915965594177219015055`

Catalan's constant G ≈ 0.9160.

```epsil
N(catalanConstant)
// ➔ 0.915965594177219015055
```

### ceil

MathJSON `Ceil` · `(x: real | signed_infinity | ~oo, step: real?) -> real | signed_infinity | ~oo`

- `x` — The number to round up. Sample: `2.3`.
- `step` — The step whose multiple is the result, 1 by default; a negative step acts as its magnitude, and 0 gives NaN. Sample: `10`.

Rounds a number up to the next largest integer, or with a step to the least multiple of the step that is at least the number.

```epsil
[ceil(2.3), ceil(-2.7), ceil(226, 10)]
// ➔ [3,-2,230]
```

### chop

MathJSON `Chop` · `(x: T, tolerance: real<0..>?) -> T where T: number`

- `x` — The number, or a collection of numbers, whose tiny parts are set to zero; the real and imaginary parts of a complex number are chopped separately. Sample: `3 + 1e-15i`.
- `tolerance` — The largest magnitude that is set to zero; by default the tolerance of the engine, 1e-10. Sample: `0.01`.

Replace tiny numeric values with zero.

```epsil
chop([1e-20, 0.5, 3 + 1e-15i])
// ➔ [0,0.5,3]
```

```epsil
chop([0.004, 0.5, 3 + 0.002i], 0.01)
// ➔ [0,0.5,3]
```

### clamp

MathJSON `Clamp` · `(x: real | signed_infinity, lower: real | signed_infinity, upper: real | signed_infinity) -> real | signed_infinity`

- `x` — The value to clamp. Sample: `12`.
- `lower` — The lower bound. Sample: `0`.
- `upper` — The upper bound; when it is below `lower`, the result is `upper`. Sample: `10`.

Clamp a value to the range [lo, hi] = min(max(x, lo), hi). Broadcasts over collection arguments.

```epsil
[clamp(12, 0, 10), clamp(-3, 0, 10), clamp(5, 0, 10)]
// ➔ [10,0,5]
```

### complex

MathJSON `Complex` · `(real: number, imaginary: number) -> complex`

- `real` — The real part. Sample: `3`.
- `imaginary` — The imaginary part. Sample: `4`.

Construct a complex number from real and imaginary parts. Converted directly to a BoxedNumber during boxing; this entry exists so `operatorInfo("Complex")` returns a signature.

```epsil
[complex(3, 4), complex(1, -2)]
// ➔ [(3 + 4i),(1 - 2i)]
```

### complexInfinity

MathJSON `ComplexInfinity` · constant `number` = `~oo`

Complex infinity, a single unsigned infinity in the complex plane.

```epsil
[1/0, complexInfinity + 1]
// ➔ [~oo,~oo]
```

### complexRoots

MathJSON `ComplexRoots` · `(complex, integer) -> list<number>`

- argument 1 — The number whose roots are returned. Sample: `8`.
- argument 2 — The number of roots, a positive integer; the list starts at the principal root and goes counterclockwise. Sample: `3`.

All n-th complex roots of a number.

```epsil
complexRoots(1, 4)
// ➔ [1,i,-1,-i]
```

```epsil
complexRoots(8, 3)
// ➔ [2,-1 + sqrt(3) * i,-1 - sqrt(3) * i]
```

### conjugate

MathJSON `Conjugate` · `(T) -> T where T: number`

- argument 1 — The number, or a collection of numbers. Sample: `3 + 4i`.

Complex conjugate of a number, or the pointwise conjugate of a function.

```epsil
conjugate(3 + 4i)
// ➔ (3 - 4i)
```

### ContinuationPlaceholder

constant `unknown`

This symbol indicates that some elements in a collection have been omitted, for example in a long list of numbers, or in an infinite set

```epsil
[1, 2, ContinuationPlaceholder, 10]
// ➔ [1,2,...,10]
```

### denominator

MathJSON `Denominator` · `(number) -> nothing | number`

- argument 1 — The fraction or expression, read as written: `Denominator(6/8)` is 8. Sample: `3/4`.

Denominator of an expression

```epsil
[denominator(3/4), denominator(x / y)]
// ➔ [4,y]
```

### digamma

MathJSON `Digamma` · `(complex | infinity) -> number`

- argument 1 — The point; 0 and the negative integers are poles. Sample: `1`.

Digamma function, the logarithmic derivative of the gamma function

```epsil
[digamma(1), N(digamma(1))]
// ➔ [-eulerGamma,-0.577215664901532860607]
```

### dirichletBeta

MathJSON `DirichletBeta` · `(complex | infinity) -> number`

- argument 1 — The point s; the function is entire. Sample: `2`.

Dirichlet beta function β(s) = Σ_&#123;n≥0&#125; (−1)^n/(2n+1)^s = 4^(−s) (ζ(s, 1/4) − ζ(s, 3/4)), entire; β(1) = π/4, β(2) = G, β(+∞) = 1.

```epsil
[dirichletBeta(1), dirichletBeta(3), N(dirichletBeta(1/2))]
// ➔ [1/4 * pi,1/32 * pi^3,0.667691457189609176659]
```

### dirichletEta

MathJSON `DirichletEta` · `(complex | infinity) -> number`

- argument 1 — The point s; the function is entire. Sample: `2`.

Dirichlet eta function η(s) = Σ_&#123;n≥1&#125; (−1)^(n−1)/n^s = (1 − 2^(1−s)) ζ(s), entire; η(1) = ln 2, η(+∞) = 1.

```epsil
[dirichletEta(2), dirichletEta(1), N(dirichletEta(1/2))]
// ➔ [1/12 * pi^2,ln(2),0.604898643421630370247]
```

### distance

MathJSON `Distance` · `(list<list<number>> | list<number> | list<tuple> | tuple, list<list<number>> | list<number> | list<tuple> | tuple) -> number`

- argument 1 — A point, or a list of points that gives one distance per point. Sample: `(0, 0)`.
- argument 2 — The other point, or a list of points paired with the first list in order. Sample: `(3, 4)`.

Euclidean distance between two points, broadcasting over a list of points.

```epsil
[distance((0, 0), (3, 4)), distance([1, 2, 3], [4, 6, 3])]
// ➔ [5,5]
```

### Divide

`(complex | infinity, (complex | infinity)+) -> number`

Quotient of a numerator and one or more denominators.

```epsil
[6 / 4, x / 2]
// ➔ [3/2,1/2 * x]
```

### elementMax

MathJSON `ElementMax` · `(real | signed_infinity, (real | signed_infinity)+) -> real | signed_infinity`

- argument 1 — A number, or a collection of numbers. Sample: `3`.
- arguments 2, … — More numbers or collections; two collections are compared element by element and must have the same length. Sample: `5`.

Element-wise maximum: broadcasts scalars over collections (and zips collections), returning a collection; all-scalar arguments give a scalar. Variadic.

```epsil
elementMax([1, 5, 3], [4, 2, 6])
// ➔ [4,5,6]
```

### elementMin

MathJSON `ElementMin` · `(real | signed_infinity, (real | signed_infinity)+) -> real | signed_infinity`

- argument 1 — A number, or a collection of numbers. Sample: `3`.
- arguments 2, … — More numbers or collections; two collections are compared element by element and must have the same length. Sample: `5`.

Element-wise minimum: broadcasts scalars over collections (and zips collections), returning a collection; all-scalar arguments give a scalar. Variadic.

```epsil
elementMin([1, 5, 3], [4, 2, 6])
// ➔ [1,2,3]
```

### enclosure

MathJSON `Enclosure` · `(nan | real | set<real> | signed_infinity, (nan | real | signed_infinity)?) -> enclosure | nan`

- argument 1 — The lower endpoint, or an `Interval` to enclose; a number alone gives the enclosure of that point. Sample: `0`.
- argument 2 — The upper endpoint; two endpoints in the wrong order are swapped. Sample: `1`.

A closed interval [lo, hi] that encloses one real number, with interval arithmetic.

```epsil
enclosure(0, 1) + enclosure(1/3, 2)
// ➔ Enclosure(1/3, 3)
```

```epsil
sin(enclosure(0, pi))
// ➔ Enclosure(0, 1)
```

```epsil
N(enclosure(0, pi))
// ➔ Enclosure(0, 3.1415926535897936)
```

### eulerGamma

MathJSON `EulerGamma` · constant `real<0.5772156649015328..0.5772156649015329>` = `0.577215664901532860607`

The Euler–Mascheroni constant γ ≈ 0.5772.

```epsil
N(eulerGamma)
// ➔ 0.577215664901532860607
```

### exp

MathJSON `Exp` · `(number) -> number`

- argument 1 — The exponent; a collection is mapped element by element. Sample: `1`.

Natural exponential function: e^x. Applied to a matrix (or any collection), it broadcasts ELEMENTWISE — it is NOT the matrix exponential e^M (which is not currently implemented).

```epsil
[exp(1), exp(ln(x)), N(exp(2))]
// ➔ [e,x,7.38905609893065022723]
```

### exp2

MathJSON `Exp2` · `(number) -> number`

- argument 1 — The exponent. Sample: `10`.

Base-2 exponential: 2^x

```epsil
[exp2(10), exp2(1/2)]
// ➔ [1024,sqrt(2)]
```

### exponentialE

MathJSON `ExponentialE` · constant `real<2.718281828459045..2.718281828459046>` = `2.71828182845904523536`

Euler's number e ≈ 2.71828, the base of the natural logarithm.

```epsil
[ln(exponentialE^2), N(exponentialE)]
// ➔ [2,2.71828182845904523536]
```

### Factorial

`(complex | infinity) -> number`

Factorial function: the product of all positive integers less than or equal to n

```epsil
[5!, 20!]
// ➔ [120,2432902008176640000]
```

### factorial2

MathJSON `Factorial2` · `(complex | infinity) -> number`

- argument 1 — The number n; a negative odd integer has a finite value, and a negative even integer is a pole. Sample: `7`.

Double Factorial Function

```epsil
[factorial2(7), factorial2(8)]
// ➔ [105,384]
```

### floor

MathJSON `Floor` · `(x: real | signed_infinity | ~oo, step: real?) -> real | signed_infinity | ~oo`

- `x` — The number to round down. Sample: `2.7`.
- `step` — The step whose multiple is the result, 1 by default; a negative step acts as its magnitude, and 0 gives NaN. Sample: `10`.

Rounds a number down to the nearest integer, or with a step to the greatest multiple of the step that is at most the number.

```epsil
[floor(2.7), floor(-2.3), floor(226, 10)]
// ➔ [2,-3,220]
```

### fract

MathJSON `Fract` · `(real | signed_infinity | ~oo) -> real<0..1>`

- argument 1 — The number; the result is in [0, 1), also for a negative number. Sample: `3.75`.

Fractional part of a number: x - floor(x)

```epsil
[fract(3.75), fract(-3.25)]
// ➔ [0.75,0.75]
```

### gcd

MathJSON `GCD` · `(any*) -> number`

- arguments 1, … — An integer, a polynomial or a list of integers; with no argument the result is 0. Sample: `12`.

Greatest Common Divisor

```epsil
[gcd(12, 18), gcd(12, 18, 27)]
// ➔ [6,3]
```

### gamma

MathJSON `Gamma` · `(complex | infinity, (complex | infinity)?, (complex | infinity)?) -> number`

- argument 1 — The point z; with two or three arguments, the parameter s of the incomplete gamma function. Sample: `5`.
- argument 2 — The lower limit z of the upper incomplete gamma function Γ(s, z); with three arguments, the lower limit z0. Sample: `1`.
- argument 3 — The upper limit z1: the result is Γ(s, z0) − Γ(s, z1), the integral from z0 to z1. Sample: `3`.

Gamma function Γ(z); with two arguments, the upper incomplete gamma Γ(s, z) = ∫_z^∞ tˢ⁻¹ e⁻ᵗ dt; with three, Γ(s, z0) − Γ(s, z1).

```epsil
[gamma(1/2), N(gamma(1/2)), N(gamma(5))]
// ➔ [sqrt(pi),1.7724538509055160273,24]
```

```epsil
N(gamma(2, 1))
// ➔ 0.735758882342884643191
```

```epsil
N(gamma(2, 1, 3))
// ➔ 0.536610608871428871274
```

### gammaLn

MathJSON `GammaLn` · `(complex | infinity) -> number`

- argument 1 — The point; at a pole of Γ, 0 or a negative integer, the result is +∞. Sample: `10`.

Natural logarithm of the gamma function.

```epsil
N(gammaLn(100))
// ➔ 359.134205369575398776
```

### goldenRatio

MathJSON `GoldenRatio` · constant `real<1.618033988749894..1.618033988749895>` = `1/2 * (1 + sqrt(5))`

The golden ratio φ = (1+√5)/2 ≈ 1.618.

```epsil
N(goldenRatio)
// ➔ 1.6180339887498948482
```

### half

MathJSON `Half` · constant `rational` = `1/2`

The rational number one half (1/2).

```epsil
[half, half + 1]
// ➔ [1/2,3/2]
```

### harmonicNumber

MathJSON `HarmonicNumber` · `(complex | infinity, (complex | infinity)?) -> number`

- argument 1 — The index n; a negative integer is a pole. Sample: `10`.
- argument 2 — The order r of the generalized harmonic number, 1 by default. Sample: `2`.

Harmonic number H_n = Σ_&#123;k=1&#125;^n 1/k, exact at a non-negative integer and continued by ψ(n+1) + γ; with a second argument r, the generalized H_n^(r) = Σ_&#123;k=1&#125;^n 1/k^r = ζ(r) − ζ(r, n+1).

```epsil
[harmonicNumber(10), harmonicNumber(10, 2), N(harmonicNumber(1/2))]
// ➔ [7381/2520,1968329/1270080,0.613705638880109381166]
```

### heaviside

MathJSON `Heaviside` · `(real | signed_infinity) -> rational<0..1>`

- argument 1 — The real number; the result is 1/2 at 0. Sample: `3`.

Heaviside step function.

```epsil
[heaviside(-2), heaviside(0), heaviside(3)]
// ➔ [0,1/2,1]
```

### hurwitzZeta

MathJSON `HurwitzZeta` · `(complex | infinity, complex | infinity, integer?) -> number`

- argument 1 — The exponent s; s = 1 is a pole. Sample: `2`.
- argument 2 — The shift a; 0 or a negative integer is a pole when the real part of s is positive. Sample: `2`.
- argument 3 — The order n of the derivative with respect to a; a call with it stays unevaluated. Sample: `1`.

Hurwitz zeta function ζ(s,a) = Σ_&#123;n=0&#125;^∞ (n+a)^&#123;-s&#125;

```epsil
hurwitzZeta(2, 2)
// ➔ -1 + 1/6 * pi^2
```

### im

MathJSON `Im` · `(complex | infinity) -> number`

- argument 1 — The complex number; a real number gives 0. Sample: `3 + 4i`.

`im` is an alias for `imaginary`, which is the preferred name. Returns the imaginary part of a complex number.

```epsil
im(3 + 4i)
// ➔ 4
```

### imaginary

MathJSON `Imaginary` · `(complex | infinity) -> number`

- argument 1 — The number whose imaginary part is taken. Sample: `3 + 4i`.

Imaginary part of a complex number.

```epsil
imaginary(3 + 4i)
// ➔ 4
```

### imaginaryUnit

MathJSON `ImaginaryUnit` · constant `imaginary` = `i`

The imaginary unit, whose square is −1.

```epsil
[imaginaryUnit^2, sqrt(-9)]
// ➔ [-1,3i]
```

### Indeterminate

constant `number` = `NaN`

An input spelling of NaN.

```epsil
[Indeterminate, Indeterminate + 1]
// ➔ [NaN,NaN]
```

### infimum

MathJSON `Infimum` · `(value*) -> number`

- arguments 1, … — A number, or a collection or an interval whose elements are bounded. Sample: `interval(open(0), 1)`.

The greatest lower bound of numbers, collections and intervals: like `min`, but the open end of an interval is a bound too.

```epsil
[infimum(1, 3, 2), infimum(interval(0, 1))]
// ➔ [1,0]
```

### interpret

MathJSON `Interpret` · `(any) -> any`

- argument 1 — The expression to interpret, such as a sum or a product written with a continuation. Sample: `1 + 2 + ContinuationPlaceholder + n`.

Interpret a notational expression as its mathematical meaning. In v1: a continuation-bearing `Add`/`Multiply` (e.g. `1 + 2 + \dots + n`) becomes a `sum`/`product`. Returns the argument unchanged when the (strict) inference gate does not pass

```epsil
interpret(1 + 2 + ContinuationPlaceholder + n)
// ➔ sum_(k=1)^(n)(k)
```

### isComposite

MathJSON `IsComposite` · `(number) -> boolean`

- argument 1 — The number to test; a non-integer or an integer below 4 is not composite. Sample: `21`.

`isComposite(n)` returns `True` if `n` is a composite number

```epsil
[isComposite(21), isComposite(7)]
// ➔ [true,false]
```

### isEven

MathJSON `IsEven` · `(number) -> boolean`

- argument 1 — The number to test; a non-integer is not even. Sample: `8`.

`isEven(n)` returns `True` if `n` is an even number

```epsil
[isEven(7), isEven(8)]
// ➔ [false,true]
```

### isOdd

MathJSON `IsOdd` · `(number) -> boolean`

- argument 1 — The number to test; a non-integer is not odd. Sample: `7`.

`isOdd(n)` returns `True` if `n` is an odd number

```epsil
[isOdd(7), isOdd(8)]
// ➔ [true,false]
```

### isPrime

MathJSON `IsPrime` · `(number) -> boolean`

- argument 1 — The number to test; a non-integer or an integer below 2 is not prime. Sample: `17`.

`isPrime(n)` returns `True` if `n` is a prime number

```epsil
[isPrime(17), isPrime(21)]
// ➔ [true,false]
```

### lcm

MathJSON `LCM` · `(any*) -> number`

- arguments 1, … — An integer, or a collection of integers; with no argument the result is 1. Sample: `6`.

Least Common Multiple

```epsil
[lcm(4, 6), lcm(4, 6, 10)]
// ➔ [12,60]
```

### lambertW

MathJSON `LambertW` · `(z: complex | infinity, branch: integer?) -> number`

- `z` — The argument; on the principal branch the value is real for z ≥ -1/e. Sample: `1`.
- `branch` — The branch: 0, the default, is the principal branch, and -1 the other real branch, for -1/e ≤ z &lt; 0. Sample: `-1`.

Lambert W function (product logarithm)

```epsil
[lambertW(1), N(lambertW(1))]
// ➔ [LambertW(1),0.567143290409783872999]
```

```epsil
N(lambertW(-0.1, branch: -1))
// ➔ -3.57715206395729721841
```

### lb

MathJSON `Lb` · `(number) -> number`

- argument 1 — The number whose base-2 logarithm is taken. Sample: `8`.

Base-2 Logarithm

```epsil
[lb(8), N(lb(3))]
// ➔ [3,1.58496250072115618145]
```

### lerchPhi

MathJSON `LerchPhi` · `(z: complex, s: complex, a: complex) -> number`

- `z` — The base of the powers zᵏ in the numerators. Sample: `1/2`.
- `s` — The exponent of the denominators (k + a)^s. Sample: `2`.
- `a` — The shift of the denominators (k + a)^s. Sample: `1`.

Lerch transcendent Φ(z,s,a) = Σ_&#123;k=0&#125;^∞ zᵏ(k+a)^&#123;-s&#125;

```epsil
lerchPhi(1, 2, 1)
// ➔ 1/6 * pi^2
```

```epsil
N(lerchPhi(1/2, 1, 1))
// ➔ 1.38629436111989061883
```

### lg

MathJSON `Lg` · `(number) -> number`

- argument 1 — The number whose base-10 logarithm is taken. Sample: `100`.

Base-10 Logarithm

```epsil
[lg(100), N(lg(2))]
// ➔ [2,0.301029995663981195214]
```

### ln

MathJSON `Ln` · `(complex | infinity, base: (complex | infinity)?) -> complex | infinity`

- argument 1 — The number whose logarithm is taken; the logarithm of 0 is -oo. Sample: `2`.
- `base` — The base of the logarithm; by default e. Sample: `2`.

Natural Logarithm

```epsil
[ln(1), ln(2), N(ln(2))]
// ➔ [0,ln(2),0.693147180559945309417]
```

```epsil
ln(8, 2)
// ➔ 3
```

### log

MathJSON `Log` · `(complex | infinity, base: (complex | infinity)?) -> number`

- argument 1 — The number whose logarithm is taken; the logarithm of 0 is -oo. Sample: `1000`.
- `base` — The base of the logarithm; by default 10. Sample: `2`.

Log(z, b = 10) = Logarithm of base b

```epsil
[log(1000), log(8, 2)]
// ➔ [3,3]
```

### log10

MathJSON `Log10` · `(number) -> number`

- argument 1 — The number whose base-10 logarithm is taken. Sample: `1000`.

Base-10 Logarithm

```epsil
[log10(1000), N(log10(2))]
// ➔ [3,0.301029995663981195214]
```

### log2

MathJSON `Log2` · `(number) -> number`

- argument 1 — The number whose base-2 logarithm is taken. Sample: `32`.

Base-2 Logarithm

```epsil
[log2(32), N(log2(3))]
// ➔ [5,1.58496250072115618145]
```

### machineEpsilon

MathJSON `MachineEpsilon` · constant `real` = `2.220446049250313e-16`

The difference between 1 and the next larger floating point number (machine epsilon).

```epsil
N(machineEpsilon)
// ➔ 2.220446049250313e-16
```

### max

MathJSON `Max` · `(value*) -> number`

- arguments 1, … — A number, or a collection or an interval whose elements are compared; with no argument the result is NaN. Sample: `3`.

Maximum of two or more numbers.

```epsil
[max(3, 7, 2), max([3, 7, 2])]
// ➔ [7,7]
```

### measurement

MathJSON `Measurement` · `(value: value, uncertainty: value) -> measurement`

- `value` — The nominal value. Sample: `9.81`.
- `uncertainty` — The 1σ absolute uncertainty; its sign is dropped, and 0 gives the nominal value alone. Sample: `0.02`.

A nominal value carrying a 1σ absolute uncertainty.

```epsil
measurement(9.81, 0.02)
// ➔ 9.810 ± 0.020
```

```epsil
N(measurement(5, 0.2) * measurement(3, 0.4))
// ➔ 15.0 ± 2.1
```

### min

MathJSON `Min` · `(value+) -> number`

- arguments 1, … — A number, or a collection or an interval whose elements are compared. Sample: `3`.

Minimum of two or more numbers.

```epsil
[min(3, 7, 2), min([3, 7, 2])]
// ➔ [2,2]
```

### Mod

`(real, real, real?) -> real`

Modulo: the remainder of the floored division of x by y. The sign of the result follows the sign of the divisor y (floored-division convention, matching most CAS). For a truncated/round-to-nearest remainder, see `remainder`.

```epsil
[7 % 3, -7 % 3]
// ➔ [1,2]
```

```epsil
Mod(9, 3, 1)
// ➔ 3
```

### Multiply

`(number*) -> number`

Product of two or more values.

```epsil
2 * x * 3 * x
// ➔ 6x^2
```

### NaN

constant `number` = `NaN`

Not a Number, the result of a floating-point operation that is undefined or unrepresentable, such as 0.0/0.0, or of an exact form with no value, such as 0/0.

```epsil
[NaN + 1, 0.0/0.0, 0/0]
// ➔ [NaN,NaN,NaN]
```

### Negate

`(complex | infinity) -> number`

Additive Inverse

```epsil
-(x - 1)
// ➔ 1 - x
```

### negativeInfinity

MathJSON `NegativeInfinity` · constant `-oo` = `-oo`

Negative infinity (−∞).

```epsil
[negativeInfinity - 1, negativeInfinity < -10^100]
// ➔ [-oo,true]
```

### numerator

MathJSON `Numerator` · `(number) -> nothing | number`

- argument 1 — The fraction or the expression whose numerator is taken; an integer is its own numerator. Sample: `3/4`.

Numerator of an expression

```epsil
[numerator(3/4), numerator(x / y)]
// ➔ [3,x]
```

### numeratorDenominator

MathJSON `NumeratorDenominator` · `(number) -> nothing | tuple<number, number>`

- argument 1 — The fraction or the expression whose numerator and denominator are taken; an integer n gives (n, 1). Sample: `3/4`.

Sequence of Numerator and Denominator of an expression

```epsil
numeratorDenominator(3/4)
// ➔ (3, 4)
```

### PlusMinus

`(T, U) -> tuple<T, U> where T: value, U: value`

Plus or Minus

```epsil
PlusMinus(1, 0.1)
// ➔ (0.9, 1.1)
```

### polyGamma

MathJSON `PolyGamma` · `(order: integer, complex | infinity) -> number`

- `order` — The order m of the derivative, 0 for the digamma function; a call with one argument is the digamma of that argument. Sample: `1`.
- argument 2 — The argument; the function has poles at 0 and at the negative integers. Sample: `2`.

Polygamma function, the n-th derivative of the digamma function

```epsil
N(polyGamma(2, 1))
// ➔ -2.4041138063191885708
```

```epsil
N(polyGamma(1))
// ➔ -0.577215664901532860607
```

### positiveInfinity

MathJSON `PositiveInfinity` · constant `+oo` = `+oo`

Positive infinity (+∞).

```epsil
[positiveInfinity + 1, positiveInfinity > 10^100]
// ➔ [+oo,true]
```

### Power

`(complex | infinity, complex | signed_infinity) -> number`

Exponentiation: raise a base to a power.

```epsil
[2^10, 2^(1/2), x^2 * x^3]
// ➔ [1024,sqrt(2),x^5]
```

### PreDecrement

`(number) -> number`

Decrement a number by one.

```epsil
PreDecrement(5)
// ➔ 4
```

### PreIncrement

`(number) -> number`

Increment a number by one.

```epsil
PreIncrement(5)
// ➔ 6
```

### product

MathJSON `Product` · `(any, tuple*) -> number`

- argument 1 — The factor, written with the index variables; with no range, a collection whose elements are multiplied. Sample: `1 - 1/k^2`.
- arguments 2, … — A range of an index variable: (k, a, b) from a to b, (k, a, b, step) with a step, (k, n) from 1 to n; an empty range gives 1, and several ranges nest. Sample: `(k, 2, 10)`.

`product(f, (k, a, b))` computes the product of `f` for `k` from `a` to `b`; `product(L)` multiplies the elements of a collection `L`.

```epsil
product(k, (k, 1, 5))
// ➔ 120
```

```epsil
product(1 - 1/k^2, (k, 2, 10))
// ➔ 11/20
```

### rational

MathJSON `Rational` · `((integer, integer) -> rational) | ((real) -> rational)`

- argument 1 — The numerator, or with one argument the real number to convert. Sample: `3`.
- argument 2 — The denominator. Sample: `6`.

Construct a rational number from a numerator and denominator.

```epsil
[rational(3, 6), rational(1.25)]
// ➔ [1/2,5/4]
```

### rationalize

MathJSON `Rationalize` · `(x: real, tolerance: real<0..>?) -> rational`

- `x` — The real number to approximate. Sample: `sqrt(3)`.
- `tolerance` — The largest error allowed; by default about 1e-15, the precision of a machine float. Sample: `0.01`.

Approximate a real number by a rational. With a second argument `tolerance`, return the rational with the smallest denominator that approximates the number to within `tolerance` (a continued-fraction convergent); with no tolerance, rationalize the machine float of the number (about 15 digits), as single-argument `rational`.

```epsil
rationalize(1.75)
// ➔ 7/4
```

```epsil
rationalize(sqrt(3), 1/500)
// ➔ 26/15
```

### re

MathJSON `Re` · `(complex | infinity) -> number`

- argument 1 — The number whose real part is taken. Sample: `3 + 4i`.

`re` is an alias for `real`, which is the preferred name. Returns the real part of a complex number.

```epsil
re(3 + 4i)
// ➔ 3
```

### real

MathJSON `Real` · `(complex | infinity) -> number`

- argument 1 — The number whose real part is taken. Sample: `3 + 4i`.

Real part of a complex number.

```epsil
real(3 + 4i)
// ➔ 3
```

### remainder

MathJSON `Remainder` · `(T, T) -> T where T: number`

- argument 1 — The dividend. Sample: `7`.
- argument 2 — The divisor; a divisor of 0 gives NaN. Sample: `3`.

IEEE remainder: the signed remainder after dividing x by y, with the quotient rounded to the nearest integer (ties round toward +Infinity, matching JavaScript `Math.round`)

```epsil
[remainder(7, 3), remainder(-7, 3)]
// ➔ [1,-1]
```

### root

MathJSON `Root` · `(complex | infinity, complex | infinity) -> number`

- argument 1 — The number whose root is taken; a negative number has a real root of an odd degree. Sample: `8`.
- argument 2 — The degree n of the root, not 0. Sample: `3`.

n-th root of a value.

```epsil
[root(8, 3), N(root(2, 3))]
// ➔ [2,1.25992104989487316477]
```

### round

MathJSON `Round` · `(x: real | signed_infinity | ~oo, step: real?) -> real | signed_infinity | ~oo`

- `x` — The number to round; a tie rounds away from zero. Sample: `3.14159`.
- `step` — The step whose nearest multiple is returned; by default 1. Its sign is ignored, and a step of 0 gives NaN. Sample: `1/100`.

Rounds a number to the nearest integer, or with a step to the nearest multiple of the step.

```epsil
[round(2.5), round(-2.5), round(226, 10), round(3.14159, 1/100)]
// ➔ [3,-3,230,157/50]
```

### sign

MathJSON `Sign` · `(complex | signed_infinity | ~oo) -> complex`

- argument 1 — The number whose sign is taken. Sample: `-3`.

Sign of a number: -1, 0, or 1 for a real; `z/|z|`, the point of the unit circle in its direction, for a complex `z`.

```epsil
[sign(-3), sign(0), sign(3 + 4i)]
// ➔ [-1,0,(3/5 + 4/5 * i)]
```

### smoothstep

MathJSON `Smoothstep` · `(edge0: real | signed_infinity, edge1: real | signed_infinity, x: real | signed_infinity) -> nan | real`

- `edge0` — The value of x at which the result starts to rise from 0. Sample: `0`.
- `edge1` — The value of x at which the result reaches 1; an edge1 below edge0 makes the curve fall from 1 to 0. Sample: `1`.
- `x` — The point at which the curve is evaluated. Sample: `0.25`.

Smooth Hermite interpolation between 0 and 1 as x goes from edge0 to edge1: t²(3 − 2t) with t = Clamp((x − edge0)/(edge1 − edge0), 0, 1). Broadcasts over collection arguments.

```epsil
[smoothstep(0, 1, -1), smoothstep(0, 1, 1/2), smoothstep(0, 1, 2)]
// ➔ [0,1/2,1]
```

### sqrt

MathJSON `Sqrt` · `(complex | infinity) -> complex | infinity`

- argument 1 — The number whose square root is taken; a negative number gives an imaginary root. Sample: `2`.

Square Root

```epsil
[sqrt(8), sqrt(-4), N(sqrt(2))]
// ➔ [2sqrt(2),2i,1.4142135623730950488]
```

### Square

`(number) -> number`

Square of a number: x^2.

```epsil
[Square(3), Square(x + 1)]
// ➔ [9,(x + 1)^2]
```

### Subtract

`(number+) -> number`

Difference between two or more values.

```epsil
5 - 3 - x
// ➔ 2 - x
```

### sum

MathJSON `Sum` · `(any, tuple*) -> number`

- argument 1 — The term, written with the index variables; with no range, a collection whose elements are summed. Sample: `k^2`.
- arguments 2, … — A range of an index variable: (k, a, b) from a to b, (k, a, b, step) with a step, (k, n) from 1 to n; an empty range gives 0, and several ranges nest. Sample: `(k, 1, 10)`.

`sum(f, (k, a, b))` computes the sum of `f` for `k` from `a` to `b`; `sum(L)` sums the elements of a collection `L`.

```epsil
sum(k^2, (k, 1, 10))
// ➔ 385
```

```epsil
sum(1/k^2, (k, 1, oo))
// ➔ pi^2 / 6
```

### supremum

MathJSON `Supremum` · `(value*) -> number`

- arguments 1, … — A number, or a collection or an interval whose elements are bounded. Sample: `interval(0, open(1))`.

The least upper bound of numbers, collections and intervals: like `max`, but the open end of an interval is a bound too.

```epsil
[supremum(1, 3, 2), supremum(interval(0, 1))]
// ➔ [3,1]
```

### trigamma

MathJSON `Trigamma` · `(complex | infinity) -> number`

- argument 1 — The argument; the function has poles at 0 and at the negative integers. Sample: `1`.

Trigamma function, the derivative of the digamma function

```epsil
N(trigamma(1))
// ➔ 1.64493406684822643647
```

### truncate

MathJSON `Truncate` · `(x: real | signed_infinity | ~oo, step: real?) -> real | signed_infinity | ~oo`

- `x` — The number to truncate. Sample: `2.7`.
- `step` — The step whose multiple is returned; by default 1. Its sign is ignored, and a step of 0 gives NaN. Sample: `10`.

Rounds a number towards zero (removes the fractional part), or with a step to the multiple of the step nearest to the number in the direction of zero.

```epsil
[truncate(2.7), truncate(-2.7), truncate(-226, 10)]
// ➔ [2,-2,-220]
```

### zeta

MathJSON `Zeta` · `(s: complex | infinity, a: (complex | infinity)?) -> number`

- `s` — The argument; the function has a pole at 1. Sample: `2`.
- `a` — The shift of the generalized zeta; by default 1, the Riemann zeta. Sample: `2`.

Riemann zeta function; with two arguments, Wolfram's generalized zeta: for a real a, ζ(s,a) = Σ_&#123;n=0&#125;^∞ |n+a|^&#123;-s&#125; (a term with n+a = 0 omitted, except at s = 0, where ζ(0,a) = 1/2 - a), which is HurwitzZeta(s,a) for a &gt; 0; for a complex a, the Hurwitz sum.

```epsil
[zeta(2), zeta(-1), N(zeta(3))]
// ➔ [1/6 * pi^2,-1/12,1.2020569031595942854]
```

### e

constant `real<2.718281828459045..2.718281828459046>` = `e`

Euler's number e ≈ 2.71828, the base of the natural logarithm.

```epsil
[ln(e^3), N(e)]
// ➔ [3,2.71828182845904523536]
```

### i

constant `imaginary` = `i`

The imaginary unit, whose square is −1.

```epsil
[i^2, (1 + i)^2]
// ➔ [-1,2i]
```
