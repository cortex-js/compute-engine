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

The 97 definitions of the arithmetic library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### abs

MathJSON `Abs` · `(complex | infinity) -> number`

Absolute value (magnitude) of a number.

### absArg

MathJSON `AbsArg` · `(complex | infinity) -> tuple<+oo | real, real>`

Tuple of magnitude and argument of a complex number.

### Add

`(value+) -> value`

Sum of two or more values.

### airyAi

MathJSON `AiryAi` · `(complex | infinity) -> number`

Airy function of the first kind

### airyAiPrime

MathJSON `AiryAiPrime` · `(complex | infinity) -> number`

Derivative of the Airy function of the first kind

### airyBi

MathJSON `AiryBi` · `(complex | infinity) -> number`

Airy function of the second kind

### airyBiPrime

MathJSON `AiryBiPrime` · `(complex | infinity) -> number`

Derivative of the Airy function of the second kind

### arg

MathJSON `Arg` · `(complex | infinity) -> number`

`Arg` is an alias for `Argument`, which is the preferred name. Returns the complex argument (phase angle) of a number.

### argument

MathJSON `Argument` · `(complex | infinity) -> number`

Complex argument (phase angle) of a number.

### besselI

MathJSON `BesselI` · `(order: complex, complex | infinity) -> number`

Modified Bessel function of the first kind

### besselJ

MathJSON `BesselJ` · `(order: complex, complex | infinity) -> number`

Bessel function of the first kind

### besselK

MathJSON `BesselK` · `(order: complex, complex | infinity) -> number`

Modified Bessel function of the second kind (Macdonald function)

### besselY

MathJSON `BesselY` · `(order: complex, complex | infinity) -> number`

Bessel function of the second kind (Neumann function)

### beta

MathJSON `Beta` · `(complex | infinity, complex | infinity) -> number`

Euler beta function

### catalanConstant

MathJSON `CatalanConstant` · constant `real<0.915965594177219..0.9159655941772191>` = `0.915965594177219015055`

Catalan's constant G ≈ 0.9160.

### ceil

MathJSON `Ceil` · `(real | signed_infinity) -> integer | signed_infinity`

Rounds a number up to the next largest integer

### chop

MathJSON `Chop` · `(T) -> T where T: number`

Replace tiny numeric values with zero.

### clamp

MathJSON `Clamp` · `(real | signed_infinity, real | signed_infinity, real | signed_infinity) -> real | signed_infinity`

Clamp a value to the range [lo, hi] = min(max(x, lo), hi). Broadcasts over collection arguments.

### complex

MathJSON `Complex` · `(real: number, imaginary: number) -> complex`

Construct a complex number from real and imaginary parts. Converted directly to a BoxedNumber during boxing; this entry exists so `operatorInfo("Complex")` returns a signature.

### complexInfinity

MathJSON `ComplexInfinity` · constant `number` = `~oo`

Complex infinity, a single unsigned infinity in the complex plane.

### complexRoots

MathJSON `ComplexRoots` · `(complex, integer) -> list<number>`

All n-th complex roots of a number.

### conjugate

MathJSON `Conjugate` · `(T) -> T where T: number`

Complex conjugate of a number, or the pointwise conjugate of a function.

### ContinuationPlaceholder

constant `unknown`

This symbol indicates that some elements in a collection have been omitted, for example in a long list of numbers, or in an infinite set

### denominator

MathJSON `Denominator` · `(number) -> nothing | number`

Denominator of an expression

### digamma

MathJSON `Digamma` · `(complex | infinity) -> number`

Digamma function, the logarithmic derivative of the gamma function

### distance

MathJSON `Distance` · `(list<list<number>> | list<number> | list<tuple> | tuple, list<list<number>> | list<number> | list<tuple> | tuple) -> number`

Euclidean distance between two points, broadcasting over a list of points.

### Divide

`(complex | infinity, (complex | infinity)+) -> number`

Quotient of a numerator and one or more denominators.

### elementMax

MathJSON `ElementMax` · `(real | signed_infinity, (real | signed_infinity)+) -> real | signed_infinity`

Element-wise maximum: broadcasts scalars over collections (and zips collections), returning a collection; all-scalar arguments give a scalar. Variadic.

### elementMin

MathJSON `ElementMin` · `(real | signed_infinity, (real | signed_infinity)+) -> real | signed_infinity`

Element-wise minimum: broadcasts scalars over collections (and zips collections), returning a collection; all-scalar arguments give a scalar. Variadic.

### eulerGamma

MathJSON `EulerGamma` · constant `real<0.5772156649015328..0.5772156649015329>` = `0.577215664901532860607`

The Euler–Mascheroni constant γ ≈ 0.5772.

### exp

MathJSON `Exp` · `(number) -> number`

Natural exponential function: e^x. Applied to a matrix (or any collection), it broadcasts ELEMENTWISE — it is NOT the matrix exponential e^M (which is not currently implemented).

### exp2

MathJSON `Exp2` · `(number) -> number`

Base-2 exponential: 2^x

### exponentialE

MathJSON `ExponentialE` · constant `real<2.718281828459045..2.718281828459046>` = `2.71828182845904523536`

Euler's number e ≈ 2.71828, the base of the natural logarithm.

### Factorial

`(complex | infinity) -> number`

Factorial function: the product of all positive integers less than or equal to n

### factorial2

MathJSON `Factorial2` · `(complex | infinity) -> number`

Double Factorial Function

### floor

MathJSON `Floor` · `(real | signed_infinity) -> integer | signed_infinity`

Rounds a number down to the nearest integer.

### fract

MathJSON `Fract` · `(real | signed_infinity) -> real<0..1>`

Fractional part of a number: x - floor(x)

### gcd

MathJSON `GCD` · `(any*) -> number`

Greatest Common Divisor

### gamma

MathJSON `Gamma` · `(complex | infinity, (complex | infinity)?) -> number`

Gamma function Γ(z); with two arguments, the upper incomplete gamma Γ(s, z) = ∫_z^∞ tˢ⁻¹ e⁻ᵗ dt.

### gammaLn

MathJSON `GammaLn` · `(complex | infinity) -> number`

Natural logarithm of the gamma function.

### goldenRatio

MathJSON `GoldenRatio` · constant `real<1.618033988749894..1.618033988749895>` = `1/2 * (1 + sqrt(5))`

The golden ratio φ = (1+√5)/2 ≈ 1.618.

### half

MathJSON `Half` · constant `rational` = `1/2`

The rational number one half (1/2).

### heaviside

MathJSON `Heaviside` · `(real | signed_infinity) -> rational<0..1>`

Heaviside step function.

### hurwitzZeta

MathJSON `HurwitzZeta` · `(complex | infinity, complex | infinity, integer?) -> number`

Hurwitz zeta function ζ(s,a) = Σ_&#123;n=0&#125;^∞ (n+a)^&#123;-s&#125;

### im

MathJSON `Im` · `(complex | infinity) -> number`

`Im` is an alias for `Imaginary`, which is the preferred name. Returns the imaginary part of a complex number.

### imaginary

MathJSON `Imaginary` · `(complex | infinity) -> number`

Imaginary part of a complex number.

### imaginaryUnit

MathJSON `ImaginaryUnit` · constant `imaginary` = `i`

The imaginary unit, whose square is −1.

### infimum

MathJSON `Infimum` · `(value*) -> number`

Like Min, but defined for open sets

### interpret

MathJSON `Interpret` · `(any) -> any`

Interpret a notational expression as its mathematical meaning. In v1: a continuation-bearing `Add`/`Multiply` (e.g. `1 + 2 + \dots + n`) becomes a `Sum`/`Product`. Returns the argument unchanged when the (strict) inference gate does not pass

### isComposite

MathJSON `IsComposite` · `(number) -> boolean`

`IsComposite(n)` returns `True` if `n` is a composite number

### isEven

MathJSON `IsEven` · `(number) -> boolean`

`IsEven(n)` returns `True` if `n` is an even number

### isOdd

MathJSON `IsOdd` · `(number) -> boolean`

`IsOdd(n)` returns `True` if `n` is an odd number

### isPrime

MathJSON `IsPrime` · `(number) -> boolean`

`IsPrime(n)` returns `True` if `n` is a prime number

### lcm

MathJSON `LCM` · `(any*) -> number`

Least Common Multiple

### lambertW

MathJSON `LambertW` · `(complex | infinity, number?) -> number`

Lambert W function (product logarithm)

### lb

MathJSON `Lb` · `(number) -> number`

Base-2 Logarithm

### lg

MathJSON `Lg` · `(number) -> number`

Base-10 Logarithm

### ln

MathJSON `Ln` · `(complex | infinity, base: (complex | infinity)?) -> complex | infinity`

Natural Logarithm

### log

MathJSON `Log` · `(complex | infinity, base: (complex | infinity)?) -> number`

Log(z, b = 10) = Logarithm of base b

### log10

MathJSON `Log10` · `(number) -> number`

Base-10 Logarithm

### log2

MathJSON `Log2` · `(number) -> number`

Base-2 Logarithm

### machineEpsilon

MathJSON `MachineEpsilon` · constant `real` = `2.220446049250313e-16`

The difference between 1 and the next larger floating point number (machine epsilon).

### max

MathJSON `Max` · `(value*) -> number`

Maximum of two or more numbers

### measurement

MathJSON `Measurement` · `(value, value) -> value`

A nominal value carrying a 1σ absolute uncertainty.

### min

MathJSON `Min` · `(value+) -> number`

Minimum of two or more numbers

### Mod

`(real, real) -> real`

Modulo: the remainder of the floored division of x by y. The sign of the result follows the sign of the divisor y (floored-division convention, matching most CAS). For a truncated/round-to-nearest remainder, see `Remainder`.

### Multiply

`(number*) -> number`

Product of two or more values.

### NaN

constant `number` = `NaN`

Not a Number, the result of an undefined or unrepresentable numeric operation.

### Negate

`(complex | infinity) -> number`

Additive Inverse

### negativeInfinity

MathJSON `NegativeInfinity` · constant `-oo` = `-oo`

Negative infinity (−∞).

### numerator

MathJSON `Numerator` · `(number) -> nothing | number`

Numerator of an expression

### numeratorDenominator

MathJSON `NumeratorDenominator` · `(number) -> nothing | tuple<number, number>`

Sequence of Numerator and Denominator of an expression

### PlusMinus

`(T, U) -> tuple<T, U> where T: value, U: value`

Plus or Minus

### polyGamma

MathJSON `PolyGamma` · `(order: integer, complex | infinity) -> number`

Polygamma function, the n-th derivative of the digamma function

### positiveInfinity

MathJSON `PositiveInfinity` · constant `+oo` = `+oo`

Positive infinity (+∞).

### Power

`(complex | infinity, complex | signed_infinity) -> number`

Exponentiation: raise a base to a power.

### PreDecrement

`(number) -> number`

Decrement a number by one.

### PreIncrement

`(number) -> number`

Increment a number by one.

### product

MathJSON `Product` · `(any, tuple*) -> number`

`Product(f, a, b)` computes the product of `f` from `a` to `b`

### rational

MathJSON `Rational` · `((integer, integer) -> rational) | ((real) -> rational)`

Construct a rational number from a numerator and denominator.

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

### real

MathJSON `Real` · `(complex | infinity) -> number`

Real part of a complex number.

### remainder

MathJSON `Remainder` · `(T, T) -> T where T: number`

IEEE remainder: the signed remainder after dividing x by y, with the quotient rounded to the nearest integer (ties round toward +Infinity, matching JavaScript `Math.round`)

### root

MathJSON `Root` · `(complex | infinity, complex | infinity) -> number`

n-th root of a value.

### round

MathJSON `Round` · `(real | signed_infinity, integer?) -> real | signed_infinity`

Rounds a number to the nearest integer, or (with a precision argument) to `n` decimal places.

### sign

MathJSON `Sign` · `(complex | signed_infinity) -> complex`

Sign of a number: -1, 0, or 1 for a real; `z/|z|`, the point of the unit circle in its direction, for a complex `z`.

### sqrt

MathJSON `Sqrt` · `(complex | infinity) -> complex | infinity`

Square Root

### Square

`(number) -> number`

Square of a number: x^2.

### Subtract

`(number+) -> number`

Difference between two or more values.

### sum

MathJSON `Sum` · `(any, tuple*) -> number`

`Sum(f, [a, b])` computes the sum of `f` from `a` to `b`; `Sum(L)` sums the elements of a collection `L`

### supremum

MathJSON `Supremum` · `(value*) -> number`

Like Max, but defined for open sets

### trigamma

MathJSON `Trigamma` · `(complex | infinity) -> number`

Trigamma function, the derivative of the digamma function

### truncate

MathJSON `Truncate` · `(real | signed_infinity) -> integer | signed_infinity`

Rounds a number towards zero (removes the fractional part)

### zeta

MathJSON `Zeta` · `(complex | infinity, (complex | infinity)?) -> number`

Riemann zeta function; with two arguments, the Hurwitz zeta function ζ(s,a) = Σ_&#123;n=0&#125;^∞ (n+a)^&#123;-s&#125;.

### e

constant `real<2.718281828459045..2.718281828459046>` = `e`

Euler's number e ≈ 2.71828, the base of the natural logarithm.

### i

constant `imaginary` = `i`

The imaginary unit, whose square is −1.
