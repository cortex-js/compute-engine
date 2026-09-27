---
title: Trigonometry Reference
sidebar_label: Trigonometry
slug: /epsil/reference/trigonometry/
description: "The trigonometry library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from trigonometry.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Trigonometry

The 42 definitions of the trigonometry library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### arccos

MathJSON `Arccos` · `(complex) -> number`

Arccosine, the inverse cosine function.

### arccot

MathJSON `Arccot` · `(complex | signed_infinity) -> number`

Arccotangent, the inverse cotangent function.

### arccsc

MathJSON `Arccsc` · `(complex | infinity) -> number`

Arccosecant, the inverse cosecant function.

### arcosh

MathJSON `Arcosh` · `(complex | signed_infinity) -> number`

Inverse hyperbolic cosine (area hyperbolic cosine).

### arcoth

MathJSON `Arcoth` · `(complex | infinity) -> number`

Inverse hyperbolic cotangent (area hyperbolic cotangent).

### arcsch

MathJSON `Arcsch` · `(complex | infinity) -> number`

Inverse hyperbolic cosecant (area hyperbolic cosecant).

### arcsec

MathJSON `Arcsec` · `(complex | infinity) -> number`

Arcsecant, the inverse secant function.

### arcsin

MathJSON `Arcsin` · `(complex) -> number`

Arcsine, the inverse sine function.

### arctan

MathJSON `Arctan` · `(complex | signed_infinity) -> number`

Inverse tangent.

### arctan2

MathJSON `Arctan2` · `(y: real | signed_infinity, x: real | signed_infinity) -> real`

Two-argument arctangent giving the angle of a vector.

### arsech

MathJSON `Arsech` · `(complex | signed_infinity) -> number`

Inverse hyperbolic secant (area hyperbolic secant).

### arsinh

MathJSON `Arsinh` · `(complex | signed_infinity) -> number`

Inverse hyperbolic sine (area hyperbolic sine).

### artanh

MathJSON `Artanh` · `(complex | signed_infinity) -> number`

Inverse hyperbolic tangent (area hyperbolic tangent).

### cos

MathJSON `Cos` · `(complex) -> number`

Cosine of an angle.

### cosIntegral

MathJSON `CosIntegral` · `(complex | infinity) -> number`

Cosine integral: γ + ln(x) + ∫₀ˣ (cos(t)−1)/t dt.

### cosh

MathJSON `Cosh` · `(complex | signed_infinity) -> number`

Hyperbolic cosine.

### coshIntegral

MathJSON `CoshIntegral` · `(complex | infinity) -> number`

Hyperbolic cosine integral: γ + ln|x| + ∫₀ˣ (cosh(t)−1)/t dt.

### cot

MathJSON `Cot` · `(complex) -> number`

Cotangent, the reciprocal of tangent.

### coth

MathJSON `Coth` · `(complex | signed_infinity) -> number`

Hyperbolic cotangent, the reciprocal of hyperbolic tangent.

### csc

MathJSON `Csc` · `(complex) -> number`

Cosecant, the reciprocal of sine.

### csch

MathJSON `Csch` · `(complex | signed_infinity) -> number`

Hyperbolic cosecant, the reciprocal of hyperbolic sine.

### dms

MathJSON `DMS` · `(number, number?, number?) -> number`

Construct an angle from degrees, minutes, and seconds.

### degrees

MathJSON `Degrees` · `(real) -> real`

Convert an angle in degrees.

### fresnelC

MathJSON `FresnelC` · `(complex | signed_infinity) -> complex`

Fresnel cosine integral.

### fresnelS

MathJSON `FresnelS` · `(complex | signed_infinity) -> complex`

Fresnel sine integral.

### haversine

MathJSON `Haversine` · `(real) -> number`

Haversine function.

### hypot

MathJSON `Hypot` · `(infinity | real, infinity | real) -> +oo | nan | real`

Hypotenuse length: sqrt(x^2 + y^2).

### inverseFunction

MathJSON `InverseFunction` · `(function) -> function`

Inverse of a function.

### inverseHaversine

MathJSON `InverseHaversine` · `(real) -> number`

Inverse haversine function.

### pi

MathJSON `Pi` · constant `real<3.141592653589793..3.141592653589794>` = `3.14159265358979323846`

The constant π ≈ 3.14159, the ratio of a circle's circumference to its diameter.

### sec

MathJSON `Sec` · `(complex) -> number`

Secant, the reciprocal of cosine.

### sech

MathJSON `Sech` · `(complex | signed_infinity) -> number`

Hyperbolic secant, the reciprocal of hyperbolic cosine.

### sin

MathJSON `Sin` · `(complex) -> number`

Sine of an angle.

### sinIntegral

MathJSON `SinIntegral` · `(complex | infinity) -> number`

Sine integral: ∫₀ˣ sin(t)/t dt.

### sinc

MathJSON `Sinc` · `(complex | signed_infinity) -> complex`

Unnormalized sinc function: sin(x)/x with sinc(0)=1.

### sinh

MathJSON `Sinh` · `(complex | signed_infinity) -> number`

Hyperbolic sine.

### sinhIntegral

MathJSON `SinhIntegral` · `(complex | infinity) -> number`

Hyperbolic sine integral: ∫₀ˣ sinh(t)/t dt.

### tan

MathJSON `Tan` · `(complex) -> number`

Tangent of an angle.

### tanh

MathJSON `Tanh` · `(complex | signed_infinity) -> number`

Hyperbolic tangent.

### trigExpand

MathJSON `TrigExpand` · `(value) -> value`

Expand trigonometric and hyperbolic functions of sums and integer multiples of angles. Example: TrigExpand(sin(a+b)) → sin(a)cos(b) + cos(a)sin(b), TrigExpand(sin(2x)) → 2 sin(x) cos(x)

### trigReduce

MathJSON `TrigReduce` · `(value) -> value`

Rewrite products and integer powers of trigonometric and hyperbolic functions as a linear combination of functions of multiple angles (the inverse of TrigExpand). Example: TrigReduce(sin(x)^2) → (1 - cos(2x))/2

### trigToExp

MathJSON `TrigToExp` · `(value) -> value`

Rewrite trigonometric and hyperbolic functions in terms of the complex exponential, exactly. Example: TrigToExp(sin(x)) → -(i/2) e^&#123;ix&#125; + (i/2) e^&#123;-ix&#125;
