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
// ➔ [True, False, True, False, True]
```

The types `integer`, `rational`, `real` and `complex` hold **finite** values
only. An infinity is a `number`, but it is not a `real`:

```epsil
[oo is real, oo is number]
// ➔ [False, True]
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
  `NaN`.

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
`round` rounds to the nearest integer, with a tie rounded away from zero:

```epsil
[floor(-2.5), ceil(-2.5), truncate(-2.5), round(-2.5)]
// ➔ [-3, -2, -2, -3]
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

With a body and a bound `(k, lower, upper)`, they add or multiply the body
for each integer `k` from `lower` to `upper`:

```epsil
[sum(k + 1, (k, 1, 10)), product(k + 1, (k, 1, 10))]
// ➔ [65, 39916800]
```

With a body and an indexing set `k in S`, the index takes each value of the
set:

```epsil
sum(n^2, n in {1, 2, 3})
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

MathJSON `Abs` · `(complex | infinity) -> number`

Absolute value (magnitude) of a number.

```epsil
[abs(-3), abs(3 - 4i)]
// ➔ [3,5]
```

### absArg

MathJSON `AbsArg` · `(complex | infinity) -> tuple<+oo | real, real>`

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

Airy function of the first kind

```epsil
N(airyAi(1))
// ➔ 0.13529241631288141
```

### airyAiPrime

MathJSON `AiryAiPrime` · `(complex | infinity) -> number`

Derivative of the Airy function of the first kind

```epsil
N(airyAiPrime(0))
// ➔ -0.2588194037928068
```

### airyBi

MathJSON `AiryBi` · `(complex | infinity) -> number`

Airy function of the second kind

```epsil
N(airyBi(0))
// ➔ 0.6149266274460007
```

### airyBiPrime

MathJSON `AiryBiPrime` · `(complex | infinity) -> number`

Derivative of the Airy function of the second kind

```epsil
N(airyBiPrime(0))
// ➔ 0.4482883573538264
```

### arg

MathJSON `Arg` · `(complex | infinity) -> number`

`Arg` is an alias for `Argument`, which is the preferred name. Returns the complex argument (phase angle) of a number.

```epsil
[arg(i), arg(1 + i)]
// ➔ [1/2 * pi,1/4 * pi]
```

### argument

MathJSON `Argument` · `(complex | infinity) -> number`

Complex argument (phase angle) of a number.

```epsil
[argument(1 + i), argument(-1)]
// ➔ [1/4 * pi,pi]
```

### besselI

MathJSON `BesselI` · `(order: complex, complex | infinity) -> number`

Modified Bessel function of the first kind

```epsil
N(besselI(0, 1))
// ➔ 1.2660658777520084
```

### besselJ

MathJSON `BesselJ` · `(order: complex, complex | infinity) -> number`

Bessel function of the first kind

```epsil
N(besselJ(0, 1))
// ➔ 0.7651976865579666
```

### besselK

MathJSON `BesselK` · `(order: complex, complex | infinity) -> number`

Modified Bessel function of the second kind (Macdonald function)

```epsil
N(besselK(0, 1))
// ➔ 0.42102443824070834
```

### besselY

MathJSON `BesselY` · `(order: complex, complex | infinity) -> number`

Bessel function of the second kind (Neumann function)

```epsil
N(besselY(0, 1))
// ➔ 0.088256964215677
```

### beta

MathJSON `Beta` · `(complex | infinity, complex | infinity) -> number`

Euler beta function

```epsil
[beta(2, 3), N(beta(1/2, 1/2))]
// ➔ [1/12,3.14159265358979323846]
```

### catalanConstant

MathJSON `CatalanConstant` · constant `real<0.915965594177219..0.9159655941772191>` = `0.915965594177219015055`

Catalan's constant G ≈ 0.9160.

```epsil
N(catalanConstant)
// ➔ 0.915965594177219015055
```

### ceil

MathJSON `Ceil` · `(real | signed_infinity) -> integer | signed_infinity`

Rounds a number up to the next largest integer

```epsil
[ceil(2.3), ceil(-2.7)]
// ➔ [3,-2]
```

### chop

MathJSON `Chop` · `(T) -> T where T: number`

Replace tiny numeric values with zero.

```epsil
chop([1e-20, 0.5, 3 + 1e-15i])
// ➔ [0,0.5,3]
```

### clamp

MathJSON `Clamp` · `(real | signed_infinity, real | signed_infinity, real | signed_infinity) -> real | signed_infinity`

Clamp a value to the range [lo, hi] = min(max(x, lo), hi). Broadcasts over collection arguments.

```epsil
[clamp(12, 0, 10), clamp(-3, 0, 10), clamp(5, 0, 10)]
// ➔ [10,0,5]
```

### complex

MathJSON `Complex` · `(real: number, imaginary: number) -> complex`

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

All n-th complex roots of a number.

```epsil
complexRoots(1, 4)
// ➔ [1,i,-1,-i]
```

```epsil
complexRoots(8, 3)
// ➔ [2,-1 + sqrt(3)i,-1 - sqrt(3)i]
```

### conjugate

MathJSON `Conjugate` · `(T) -> T where T: number`

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

Denominator of an expression

```epsil
[denominator(3/4), denominator(x / y)]
// ➔ [4,y]
```

### digamma

MathJSON `Digamma` · `(complex | infinity) -> number`

Digamma function, the logarithmic derivative of the gamma function

```epsil
[digamma(1), N(digamma(1))]
// ➔ [Digamma(1),-0.577215664901532860607]
```

### distance

MathJSON `Distance` · `(list<list<number>> | list<number> | list<tuple> | tuple, list<list<number>> | list<number> | list<tuple> | tuple) -> number`

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

Element-wise maximum: broadcasts scalars over collections (and zips collections), returning a collection; all-scalar arguments give a scalar. Variadic.

```epsil
elementMax([1, 5, 3], [4, 2, 6])
// ➔ [4,5,6]
```

### elementMin

MathJSON `ElementMin` · `(real | signed_infinity, (real | signed_infinity)+) -> real | signed_infinity`

Element-wise minimum: broadcasts scalars over collections (and zips collections), returning a collection; all-scalar arguments give a scalar. Variadic.

```epsil
elementMin([1, 5, 3], [4, 2, 6])
// ➔ [1,2,3]
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

Natural exponential function: e^x. Applied to a matrix (or any collection), it broadcasts ELEMENTWISE — it is NOT the matrix exponential e^M (which is not currently implemented).

```epsil
[exp(1), exp(ln(x)), N(exp(2))]
// ➔ [e,x,7.38905609893065022723]
```

### exp2

MathJSON `Exp2` · `(number) -> number`

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

Double Factorial Function

```epsil
[factorial2(7), factorial2(8)]
// ➔ [105,384]
```

### floor

MathJSON `Floor` · `(real | signed_infinity) -> integer | signed_infinity`

Rounds a number down to the nearest integer.

```epsil
[floor(2.7), floor(-2.3)]
// ➔ [2,-3]
```

### fract

MathJSON `Fract` · `(real | signed_infinity) -> real<0..1>`

Fractional part of a number: x - floor(x)

```epsil
[fract(3.75), fract(-3.25)]
// ➔ [0.75,0.75]
```

### gcd

MathJSON `GCD` · `(any*) -> number`

Greatest Common Divisor

```epsil
[gcd(12, 18), gcd(12, 18, 27)]
// ➔ [6,3]
```

### gamma

MathJSON `Gamma` · `(complex | infinity, (complex | infinity)?) -> number`

Gamma function Γ(z); with two arguments, the upper incomplete gamma Γ(s, z) = ∫_z^∞ tˢ⁻¹ e⁻ᵗ dt.

```epsil
[gamma(1/2), N(gamma(1/2)), N(gamma(5))]
// ➔ [Gamma(1/2),1.7724538509055160273,24]
```

```epsil
N(gamma(2, 1))
// ➔ 0.7357588823428847
```

### gammaLn

MathJSON `GammaLn` · `(complex | infinity) -> number`

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

### heaviside

MathJSON `Heaviside` · `(real | signed_infinity) -> rational<0..1>`

Heaviside step function.

```epsil
[heaviside(-2), heaviside(0), heaviside(3)]
// ➔ [0,1/2,1]
```

### hurwitzZeta

MathJSON `HurwitzZeta` · `(complex | infinity, complex | infinity, integer?) -> number`

Hurwitz zeta function ζ(s,a) = Σ_&#123;n=0&#125;^∞ (n+a)^&#123;-s&#125;

```epsil
hurwitzZeta(2, 2)
// ➔ -1 + 1/6 * pi^2
```

### im

MathJSON `Im` · `(complex | infinity) -> number`

`Im` is an alias for `Imaginary`, which is the preferred name. Returns the imaginary part of a complex number.

```epsil
im(3 + 4i)
// ➔ 4
```

### imaginary

MathJSON `Imaginary` · `(complex | infinity) -> number`

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

### infimum

MathJSON `Infimum` · `(value*) -> number`

Like Min, but defined for open sets

```epsil
[infimum(1, 3, 2), infimum(interval(0, 1))]
// ➔ [1,0]
```

### interpret

MathJSON `Interpret` · `(any) -> any`

Interpret a notational expression as its mathematical meaning. In v1: a continuation-bearing `Add`/`Multiply` (e.g. `1 + 2 + \dots + n`) becomes a `Sum`/`Product`. Returns the argument unchanged when the (strict) inference gate does not pass

```epsil
interpret(1 + 2 + ContinuationPlaceholder + n)
// ➔ sum_(k=1)^(n)(k)
```

### isComposite

MathJSON `IsComposite` · `(number) -> boolean`

`IsComposite(n)` returns `True` if `n` is a composite number

```epsil
[isComposite(21), isComposite(7)]
// ➔ ["True","False"]
```

### isEven

MathJSON `IsEven` · `(number) -> boolean`

`IsEven(n)` returns `True` if `n` is an even number

```epsil
[isEven(7), isEven(8)]
// ➔ ["False","True"]
```

### isOdd

MathJSON `IsOdd` · `(number) -> boolean`

`IsOdd(n)` returns `True` if `n` is an odd number

```epsil
[isOdd(7), isOdd(8)]
// ➔ ["True","False"]
```

### isPrime

MathJSON `IsPrime` · `(number) -> boolean`

`IsPrime(n)` returns `True` if `n` is a prime number

```epsil
[isPrime(17), isPrime(21)]
// ➔ ["True","False"]
```

### lcm

MathJSON `LCM` · `(any*) -> number`

Least Common Multiple

```epsil
[lcm(4, 6), lcm(4, 6, 10)]
// ➔ [12,60]
```

### lambertW

MathJSON `LambertW` · `(complex | infinity, number?) -> number`

Lambert W function (product logarithm)

```epsil
[lambertW(1), N(lambertW(1))]
// ➔ [LambertW(1),0.567143290409783872999]
```

### lb

MathJSON `Lb` · `(number) -> number`

Base-2 Logarithm

```epsil
[lb(8), N(lb(3))]
// ➔ [3,1.58496250072115618145]
```

### lg

MathJSON `Lg` · `(number) -> number`

Base-10 Logarithm

```epsil
[lg(100), N(lg(2))]
// ➔ [2,0.301029995663981195214]
```

### ln

MathJSON `Ln` · `(complex | infinity, base: (complex | infinity)?) -> complex | infinity`

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

Log(z, b = 10) = Logarithm of base b

```epsil
[log(1000), log(8, 2)]
// ➔ [3,3]
```

### log10

MathJSON `Log10` · `(number) -> number`

Base-10 Logarithm

```epsil
[log10(1000), N(log10(2))]
// ➔ [3,0.301029995663981195214]
```

### log2

MathJSON `Log2` · `(number) -> number`

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

Maximum of two or more numbers

```epsil
[max(3, 7, 2), max([3, 7, 2])]
// ➔ [7,7]
```

### measurement

MathJSON `Measurement` · `(value, value) -> value`

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

Minimum of two or more numbers

```epsil
[min(3, 7, 2), min([3, 7, 2])]
// ➔ [2,2]
```

### Mod

`(real, real) -> real`

Modulo: the remainder of the floored division of x by y. The sign of the result follows the sign of the divisor y (floored-division convention, matching most CAS). For a truncated/round-to-nearest remainder, see `Remainder`.

```epsil
[7 % 3, -7 % 3]
// ➔ [1,2]
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

Not a Number, the result of an undefined or unrepresentable numeric operation.

```epsil
[NaN + 1, 0/0]
// ➔ [NaN,NaN]
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
// ➔ [-oo,"True"]
```

### numerator

MathJSON `Numerator` · `(number) -> nothing | number`

Numerator of an expression

```epsil
[numerator(3/4), numerator(x / y)]
// ➔ [3,x]
```

### numeratorDenominator

MathJSON `NumeratorDenominator` · `(number) -> nothing | tuple<number, number>`

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

Polygamma function, the n-th derivative of the digamma function

```epsil
N(polyGamma(2, 1))
// ➔ -2.4041138063191885708
```

### positiveInfinity

MathJSON `PositiveInfinity` · constant `+oo` = `+oo`

Positive infinity (+∞).

```epsil
[positiveInfinity + 1, positiveInfinity > 10^100]
// ➔ [+oo,"True"]
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

`Product(f, a, b)` computes the product of `f` from `a` to `b`

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

Construct a rational number from a numerator and denominator.

```epsil
[rational(3, 6), rational(1.25)]
// ➔ [1/2,5/4]
```

### rationalize

MathJSON `Rationalize` · `(real, real<0..>?) -> rational`

Approximate a real number by a rational. With a second argument `tolerance`, return the rational with the smallest denominator that approximates the number to within `tolerance` (a continued-fraction convergent); with no tolerance, rationalize at full working precision, as single-argument `Rational`.

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

`Re` is an alias for `Real`, which is the preferred name. Returns the real part of a complex number.

```epsil
re(3 + 4i)
// ➔ 3
```

### real

MathJSON `Real` · `(complex | infinity) -> number`

Real part of a complex number.

```epsil
real(3 + 4i)
// ➔ 3
```

### remainder

MathJSON `Remainder` · `(T, T) -> T where T: number`

IEEE remainder: the signed remainder after dividing x by y, with the quotient rounded to the nearest integer (ties round toward +Infinity, matching JavaScript `Math.round`)

```epsil
[remainder(7, 3), remainder(-7, 3)]
// ➔ [1,-1]
```

### root

MathJSON `Root` · `(complex | infinity, complex | infinity) -> number`

n-th root of a value.

```epsil
[root(8, 3), N(root(2, 3))]
// ➔ [2,1.25992104989487316477]
```

### round

MathJSON `Round` · `(real | signed_infinity, integer?) -> real | signed_infinity`

Rounds a number to the nearest integer, or (with a precision argument) to `n` decimal places.

```epsil
[round(2.5), round(-2.5), round(3.14159, 2)]
// ➔ [3,-3,3.14]
```

### sign

MathJSON `Sign` · `(complex | signed_infinity) -> complex`

Sign of a number: -1, 0, or 1 for a real; `z/|z|`, the point of the unit circle in its direction, for a complex `z`.

```epsil
[sign(-3), sign(0), sign(3 + 4i)]
// ➔ [-1,0,(3/5 + 4/5i)]
```

### sqrt

MathJSON `Sqrt` · `(complex | infinity) -> complex | infinity`

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

`Sum(f, [a, b])` computes the sum of `f` from `a` to `b`; `Sum(L)` sums the elements of a collection `L`

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

Like Max, but defined for open sets

```epsil
[supremum(1, 3, 2), supremum(interval(0, 1))]
// ➔ [3,1]
```

### trigamma

MathJSON `Trigamma` · `(complex | infinity) -> number`

Trigamma function, the derivative of the digamma function

```epsil
N(trigamma(1))
// ➔ 1.64493406684822643647
```

### truncate

MathJSON `Truncate` · `(real | signed_infinity) -> integer | signed_infinity`

Rounds a number towards zero (removes the fractional part)

```epsil
[truncate(2.7), truncate(-2.7)]
// ➔ [2,-2]
```

### zeta

MathJSON `Zeta` · `(complex | infinity, (complex | infinity)?) -> number`

Riemann zeta function; with two arguments, the Hurwitz zeta function ζ(s,a) = Σ_&#123;n=0&#125;^∞ (n+a)^&#123;-s&#125;.

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
