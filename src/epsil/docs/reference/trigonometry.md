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

The **trigonometry** library holds the constant `pi`, the conversions of
angles, the circular and hyperbolic functions with their inverses, the
cardinal sine and the trigonometric integrals, and three functions that
rewrite trigonometric expressions. This introduction gives the concepts you
need before you read the entries.

## The functions

Each circular function has an inverse, a hyperbolic form, and an inverse
hyperbolic form. The inverse hyperbolic functions use the ISO 80000-2 names:
`arsinh`, not `arcsinh`. The prefix "ar" stands for "area".

| Function | Inverse                | Hyperbolic | Inverse hyperbolic |
| :------- | :--------------------- | :--------- | :----------------- |
| `sin`    | `arcsin`               | `sinh`     | `arsinh`           |
| `cos`    | `arccos`               | `cosh`     | `arcosh`           |
| `tan`    | `arctan`, `arctan2`    | `tanh`     | `artanh`           |
| `cot`    | `arccot`               | `coth`     | `arcoth`           |
| `sec`    | `arcsec`               | `sech`     | `arsech`           |
| `csc`    | `arccsc`               | `csch`     | `arcsch`           |

The functions apply to each element of a list:

```epsil
sin([0, pi / 6, pi / 2])
// ➔ [0, 1/2, 1]
```

## Angles

The argument of a circular function is an angle in radians. `degrees(d)`
converts an angle in degrees to radians, and `dms(d, m, s)` converts an angle
in degrees, minutes and seconds. Both conversions are exact when their
arguments are exact.

```epsil
[degrees(180), degrees(45), dms(12, 30)]
// ➔ [pi, 1/4 * pi, 5/72 * pi]
```

```epsil
sin(degrees(30))
// ➔ 1/2
```

## Exact values and numeric values

When the argument is exact, the result is exact. If the value at the argument
is known in closed form, the function returns that value. The closed form can
contain square roots:

```epsil
[sin(pi / 6), cos(5pi / 4), tan(pi / 12)]
// ➔ [1/2, -sqrt(2)/2, 2 - sqrt(3)]
```

If no closed form is known, the result stays symbolic. `N` gives a numeric
value:

```epsil
[sin(1), N(sin(1))]
// ➔ [sin(1), 0.841470984807896506653]
```

When the argument is a floating-point number, the result is a floating-point
number:

```epsil
sin(1.2)
// ➔ 0.93203908596722634967
```

At a pole, the value is the complex infinity `~oo`:

```epsil
[tan(pi / 2), sec(pi / 2), cot(0)]
// ➔ [~oo, ~oo, ~oo]
```

## The inverse functions and their ranges

An inverse function returns the principal value. The principal value is in
the range that this table shows.

| Function         | Range of the principal value     |
| :--------------- | :------------------------------- |
| `arcsin`         | from `-pi/2` to `pi/2`           |
| `arccos`         | from `0` to `pi`                 |
| `arctan`         | between `-pi/2` and `pi/2`       |
| `arccot`         | between `0` and `pi`             |
| `arcsec`         | from `0` to `pi`, not `pi/2`     |
| `arccsc`         | from `-pi/2` to `pi/2`, not `0`  |
| `arctan2(y, x)`  | between `-pi` and `pi`, `pi` included |

```epsil
[arcsin(1), arccos(-1), arctan(-1), arcsec(-2), arccsc(-2)]
// ➔ [1/2 * pi, pi, -1/4 * pi, 2/3 * pi, -1/6 * pi]
```

The range of `arccot` is between `0` and `pi`. Thus a negative argument gives
an angle between `pi/2` and `pi`:

```epsil
N([arccot(1), arccot(-1)])
// ➔ [0.785398163397448309616, 2.35619449019234492885]
```

`arctan2(y, x)` is the angle of the point `(x, y)`. The first argument is the
`y` coordinate. The function uses the signs of both coordinates to find the
quadrant:

```epsil
[arctan2(1, 1), arctan2(1, -1), arctan2(-1, -1), arctan2(0, -1)]
// ➔ [1/4 * pi, 3/4 * pi, -3/4 * pi, pi]
```

When the argument is exact and no real value exists, the result stays
symbolic. `N` then gives the complex principal value:

```epsil
[arcsin(2), N(arcsin(2))]
// ➔ [arcsin(2), (1.57079632679489661923 - 1.31695789692481670863i)]
```

`inverseFunction` returns the inverse of a function:

```epsil
[inverseFunction(sin), inverseFunction(cosh)]
// ➔ [arcsin, arcosh]
```

## Trigonometric transformations

Three functions rewrite a trigonometric or hyperbolic expression. They keep
exact values exact.

`trigExpand` expands a function of a sum, or of an integer multiple of an
angle:

```epsil
trigExpand(sin(a + b))
// ➔ sin(b) * cos(a) + sin(a) * cos(b)
```

```epsil
trigExpand(cos(2x))
// ➔ -sin(x)^2 + cos(x)^2
```

`trigReduce` does the opposite operation. It changes products and integer
powers into a sum of functions of multiple angles:

```epsil
trigReduce(cos(x)^3)
// ➔ 1/4 * cos(3x) + 3/4 * cos(x)
```

`trigToExp` writes the functions with the complex exponential:

```epsil
trigToExp(cosh(x))
// ➔ 1/2 * (e^x + e^(-x))
```

`simplify` uses the trigonometric identities, for example the Pythagorean
identities and the double-angle formulas:

```epsil
simplify(sin(x)^2 + cos(x)^2)
// ➔ 1
```

```epsil
simplify(1 + tan(x)^2)
// ➔ sec(x)^2
```

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### arccos

MathJSON `Arccos` · `(complex | quantity) -> number`

- argument 1 — The cosine of the angle; outside [-1, 1] the result is complex. Sample: `1 / 2`.

Arccosine, the inverse cosine function.

```epsil
arccos(1/2)
// ➔ 1/3 * pi
```

```epsil
N(arccos(1/3))
// ➔ 1.23095941734077468213
```

### arccot

MathJSON `Arccot` · `(complex | quantity | signed_infinity) -> number`

- argument 1 — The cotangent of the angle; the result is in (0, π) in radians (in the angular unit of the engine), with 0 at +∞ and π at −∞. Sample: `1`.

Arccotangent, the inverse cotangent function.

```epsil
N(arccot(1))
// ➔ 0.785398163397448309616
```

```epsil
N(arccot(-1))
// ➔ 2.35619449019234492885
```

### arccsc

MathJSON `Arccsc` · `(complex | infinity | quantity) -> number`

- argument 1 — The cosecant of the angle; inside (-1, 1) the result is complex, and 0 has no value (an exact 0 stays unevaluated, a numeric 0 gives NaN). Sample: `2`.

Arccosecant, the inverse cosecant function.

```epsil
arccsc(2)
// ➔ 1/6 * pi
```

```epsil
N(arccsc(3))
// ➔ 0.339836909454121937096
```

### arcosh

MathJSON `Arcosh` · `(complex | quantity | signed_infinity) -> number`

- argument 1 — The hyperbolic cosine of the result; below 1 the result is complex. Sample: `2`.

Inverse hyperbolic cosine (area hyperbolic cosine).

```epsil
arcosh(1)
// ➔ 0
```

```epsil
N(arcosh(2))
// ➔ 1.31695789692481670863
```

### arcoth

MathJSON `Arcoth` · `(complex | infinity | quantity) -> number`

- argument 1 — The hyperbolic cotangent of the result; ±1 gives ±∞, and inside (-1, 1) the result is complex. Sample: `2`.

Inverse hyperbolic cotangent (area hyperbolic cotangent).

```epsil
N(arcoth(2))
// ➔ 0.549306144334054845698
```

### arcsch

MathJSON `Arcsch` · `(complex | infinity | quantity) -> number`

- argument 1 — The hyperbolic cosecant of the result; 0 gives complex infinity. Sample: `1`.

Inverse hyperbolic cosecant (area hyperbolic cosecant).

```epsil
N(arcsch(1))
// ➔ 0.881373587019543025232
```

### arcsec

MathJSON `Arcsec` · `(complex | infinity | quantity) -> number`

- argument 1 — The secant of the angle; inside (-1, 1) the result is complex, and 0 has no value (an exact 0 stays unevaluated, a numeric 0 gives NaN). Sample: `2`.

Arcsecant, the inverse secant function.

```epsil
arcsec(2)
// ➔ 1/3 * pi
```

```epsil
N(arcsec(3))
// ➔ 1.23095941734077468214
```

### arcsin

MathJSON `Arcsin` · `(complex | quantity) -> number`

- argument 1 — The sine of the angle; outside [-1, 1] the result is complex. Sample: `1 / 2`.

Arcsine, the inverse sine function.

```epsil
arcsin(1/2)
// ➔ 1/6 * pi
```

```epsil
N(arcsin(2))
// ➔ (1.57079632679489661923 - 1.31695789692481670863i)
```

### arctan

MathJSON `Arctan` · `(complex | quantity | signed_infinity) -> number`

- argument 1 — The tangent of the angle; ±∞ gives ±π/2 (in radians; the result is in the angular unit of the engine). Sample: `1`.

Inverse tangent.

```epsil
arctan(1)
// ➔ 1/4 * pi
```

```epsil
N(arctan(2))
// ➔ 1.10714871779409050302
```

### arctan2

MathJSON `Arctan2` · `(y: real | signed_infinity, x: real | signed_infinity) -> real`

- `y` — The y coordinate of the point. Sample: `1`.
- `x` — The x coordinate of the point; the result is the angle from the positive x axis, in (−π, π] in radians (in the angular unit of the engine), and 0 at the origin. Sample: `-1`.

Two-argument arctangent giving the angle of a vector.

```epsil
arctan2(1, -1)
// ➔ 3/4 * pi
```

```epsil
arctan2(-1, -1)
// ➔ -3/4 * pi
```

### arsech

MathJSON `Arsech` · `(complex | quantity | signed_infinity) -> number`

- argument 1 — The hyperbolic secant of the result; 0 gives +∞, and outside [0, 1] the result is complex. Sample: `1 / 2`.

Inverse hyperbolic secant (area hyperbolic secant).

```epsil
arsech(1)
// ➔ 0
```

```epsil
N(arsech(1/2))
// ➔ 1.31695789692481670863
```

### arsinh

MathJSON `Arsinh` · `(complex | quantity | signed_infinity) -> number`

- argument 1 — The hyperbolic sine of the result; ±∞ gives ±∞. Sample: `1`.

Inverse hyperbolic sine (area hyperbolic sine).

```epsil
arsinh(0)
// ➔ 0
```

```epsil
N(arsinh(1))
// ➔ 0.881373587019543025232
```

### artanh

MathJSON `Artanh` · `(complex | quantity | signed_infinity) -> number`

- argument 1 — The hyperbolic tangent of the result; ±1 gives ±∞, and outside [-1, 1] the result is complex. Sample: `1 / 2`.

Inverse hyperbolic tangent (area hyperbolic tangent).

```epsil
artanh(0)
// ➔ 0
```

```epsil
N(artanh(1/2))
// ➔ 0.549306144334054845698
```

### cos

MathJSON `Cos` · `(complex | quantity) -> number`

- argument 1 — The angle, in radians (or in the angular unit of the engine). Sample: `pi / 3`.

Cosine of an angle.

```epsil
cos(pi / 3)
// ➔ 1/2
```

```epsil
N(cos(1))
// ➔ 0.540302305868139717401
```

### cosIntegral

MathJSON `CosIntegral` · `(complex | infinity) -> number`

- argument 1 — The number; 0 gives −∞, +∞ gives 0, and a negative real number gives a complex value. Sample: `1`.

Cosine integral: γ + ln(x) + ∫₀ˣ (cos(t)−1)/t dt.

```epsil
N(cosIntegral(1))
// ➔ 0.337403922900968134663
```

### cosh

MathJSON `Cosh` · `(complex | quantity | signed_infinity) -> number`

- argument 1 — The number; a real number gives a result of at least 1, and ±∞ gives +∞. Sample: `1`.

Hyperbolic cosine.

```epsil
cosh(0)
// ➔ 1
```

```epsil
N(cosh(1))
// ➔ 1.54308063481524377848
```

### coshIntegral

MathJSON `CoshIntegral` · `(complex | infinity) -> number`

- argument 1 — The number; 0 gives −∞, ±∞ gives +∞, and a negative real number gives a complex value. Sample: `1`.

Hyperbolic cosine integral: γ + ln|x| + ∫₀ˣ (cosh(t)−1)/t dt.

```epsil
N(coshIntegral(1))
// ➔ 0.837866940980208240895
```

### cot

MathJSON `Cot` · `(complex | quantity) -> number`

- argument 1 — The angle, in radians (or in the angular unit of the engine); a multiple of π gives complex infinity. Sample: `pi / 6`.

Cotangent, the reciprocal of tangent.

```epsil
cot(pi / 6)
// ➔ sqrt(3)
```

```epsil
N(cot(1))
// ➔ 0.642092615934330703005
```

### coth

MathJSON `Coth` · `(complex | quantity | signed_infinity) -> number`

- argument 1 — The number; 0 gives complex infinity, and ±∞ gives ±1. Sample: `1`.

Hyperbolic cotangent, the reciprocal of hyperbolic tangent.

```epsil
N(coth(1))
// ➔ 1.31303528549933130364
```

### csc

MathJSON `Csc` · `(complex | quantity) -> number`

- argument 1 — The angle, in radians (or in the angular unit of the engine); a multiple of π gives complex infinity. Sample: `pi / 6`.

Cosecant, the reciprocal of sine.

```epsil
csc(pi / 6)
// ➔ 2
```

```epsil
N(csc(1))
// ➔ 1.18839510577812121626
```

### csch

MathJSON `Csch` · `(complex | quantity | signed_infinity) -> number`

- argument 1 — The number; 0 gives complex infinity, and ±∞ gives 0. Sample: `1`.

Hyperbolic cosecant, the reciprocal of hyperbolic sine.

```epsil
N(csch(1))
// ➔ 0.850918128239321545136
```

### dms

MathJSON `DMS` · `(degrees: number, minutes: number?, seconds: number?) -> number`

- `degrees` — The whole degrees of the angle; the minutes and seconds are added to it, also when it is negative. Sample: `30`.
- `minutes` — The minutes of arc, 1/60 of a degree each; 0 by default. Sample: `15`.
- `seconds` — The seconds of arc, 1/3600 of a degree each; 0 by default. Sample: `30`.

Construct an angle from degrees, minutes, and seconds.

```epsil
dms(30, 15)
// ➔ 121/720 * pi
```

```epsil
N(dms(30, 15))
// ➔ 0.527962098728284697019
```

### degrees

MathJSON `Degrees` · `(real) -> real`

- argument 1 — The angle in degrees; it is not reduced modulo 360. Sample: `30`.

Convert an angle in degrees.

```epsil
degrees(30)
// ➔ 1/6 * pi
```

```epsil
sin(degrees(30))
// ➔ 1/2
```

### fresnelC

MathJSON `FresnelC` · `(complex | signed_infinity) -> complex`

- argument 1 — The upper limit of the integral from 0; ±∞ gives ±1/2. Sample: `1`.

Fresnel cosine integral.

```epsil
fresnelC(+oo)
// ➔ 1/2
```

```epsil
N(fresnelC(1))
// ➔ 0.779893400376822829474
```

### fresnelS

MathJSON `FresnelS` · `(complex | signed_infinity) -> complex`

- argument 1 — The upper limit of the integral from 0; ±∞ gives ±1/2. Sample: `1`.

Fresnel sine integral.

```epsil
fresnelS(+oo)
// ➔ 1/2
```

```epsil
N(fresnelS(1))
// ➔ 0.438259147390354766077
```

### haversine

MathJSON `Haversine` · `(real) -> number`

- argument 1 — The angle, in radians (or in the angular unit of the engine); the result is (1 − cos(x))/2, in [0, 1]. Sample: `pi / 3`.

Haversine function.

```epsil
haversine(pi / 3)
// ➔ 1/4
```

```epsil
haversine(x)
// ➔ 1/2 * (1 - cos(x))
```

### hypot

MathJSON `Hypot` · `(infinity | real, infinity | real) -> +oo | nan | real`

- argument 1 — One leg; an infinite leg makes the result +∞. Sample: `3`.
- argument 2 — The other leg. Sample: `4`.

Hypotenuse length: sqrt(x^2 + y^2).

```epsil
hypot(3, 4)
// ➔ 5
```

```epsil
hypot(1, 1)
// ➔ sqrt(2)
```

### inverseFunction

MathJSON `InverseFunction` · `(function) -> function`

- argument 1 — The function to invert; a function with no known inverse leaves the call unevaluated. Sample: `sin`.

Inverse of a function.

```epsil
inverseFunction(sin)
// ➔ arcsin
```

```epsil
inverseFunction(tan)(1)
// ➔ 1/4 * pi
```

### inverseHaversine

MathJSON `InverseHaversine` · `(real) -> number`

- argument 1 — The haversine of the angle; inside [0, 1] the result is in [0, π] in radians (in the angular unit of the engine), and outside it the result is complex. Sample: `1 / 2`.

Inverse haversine function.

```epsil
inverseHaversine(1/2)
// ➔ 1/2 * pi
```

```epsil
N(inverseHaversine(1/4))
// ➔ 1.04719755119659774615
```

### pi

MathJSON `Pi` · constant `real<3.141592653589793..3.141592653589794>` = `3.14159265358979323846`

The constant π ≈ 3.14159, the ratio of a circle's circumference to its diameter.

```epsil
N(pi)
// ➔ 3.14159265358979323846
```

```epsil
cos(pi)
// ➔ -1
```

### sec

MathJSON `Sec` · `(complex | quantity) -> number`

- argument 1 — The angle, in radians (or in the angular unit of the engine); an odd multiple of π/2 gives complex infinity. Sample: `pi / 3`.

Secant, the reciprocal of cosine.

```epsil
sec(pi / 3)
// ➔ 2
```

```epsil
N(sec(1))
// ➔ 1.85081571768092561791
```

### sech

MathJSON `Sech` · `(complex | quantity | signed_infinity) -> number`

- argument 1 — The number; a real number gives a result in (0, 1], and ±∞ gives 0. Sample: `1`.

Hyperbolic secant, the reciprocal of hyperbolic cosine.

```epsil
sech(0)
// ➔ 1
```

```epsil
N(sech(1))
// ➔ 0.648054273663885399574
```

### sin

MathJSON `Sin` · `(complex | quantity) -> number`

- argument 1 — The angle, in radians (or in the angular unit of the engine). Sample: `pi / 6`.

Sine of an angle.

```epsil
sin(pi / 6)
// ➔ 1/2
```

```epsil
sin(1)
// ➔ sin(1)
```

```epsil
N(sin(1))
// ➔ 0.841470984807896506653
```

### sinIntegral

MathJSON `SinIntegral` · `(complex | infinity) -> number`

- argument 1 — The upper limit of the integral from 0; ±∞ gives ±π/2. Sample: `1`.

Sine integral: ∫₀ˣ sin(t)/t dt.

```epsil
sinIntegral(+oo)
// ➔ 1/2 * pi
```

```epsil
N(sinIntegral(1))
// ➔ 0.946083070367183014941
```

### sinc

MathJSON `Sinc` · `(complex | signed_infinity) -> complex`

- argument 1 — The number; 0 gives 1, and ±∞ gives 0. Sample: `pi / 2`.

Unnormalized sinc function: sin(x)/x with sinc(0)=1.

```epsil
sinc(0)
// ➔ 1
```

```epsil
N(sinc(1))
// ➔ 0.841470984807896506653
```

### sinh

MathJSON `Sinh` · `(complex | quantity | signed_infinity) -> number`

- argument 1 — The number; ±∞ gives ±∞. Sample: `1`.

Hyperbolic sine.

```epsil
sinh(0)
// ➔ 0
```

```epsil
N(sinh(1))
// ➔ 1.17520119364380145688
```

### sinhIntegral

MathJSON `SinhIntegral` · `(complex | infinity) -> number`

- argument 1 — The upper limit of the integral from 0; ±∞ gives ±∞. Sample: `1`.

Hyperbolic sine integral: ∫₀ˣ sinh(t)/t dt.

```epsil
sinhIntegral(0)
// ➔ 0
```

```epsil
N(sinhIntegral(1))
// ➔ 1.05725087537572851457
```

### tan

MathJSON `Tan` · `(complex | quantity) -> number`

- argument 1 — The angle, in radians (or in the angular unit of the engine); an odd multiple of π/2 gives complex infinity. Sample: `pi / 4`.

Tangent of an angle.

```epsil
tan(pi / 3)
// ➔ sqrt(3)
```

```epsil
N(tan(1))
// ➔ 1.55740772465490223051
```

### tanh

MathJSON `Tanh` · `(complex | quantity | signed_infinity) -> number`

- argument 1 — The number; a real number gives a result in (-1, 1), and ±∞ gives ±1. Sample: `1`.

Hyperbolic tangent.

```epsil
tanh(0)
// ➔ 0
```

```epsil
N(tanh(1))
// ➔ 0.761594155955764888119
```

### trigExpand

MathJSON `TrigExpand` · `(value) -> value`

- argument 1 — The expression whose trigonometric and hyperbolic functions are expanded. Sample: `sin(2x)`.

Expand trigonometric and hyperbolic functions of sums and integer multiples of angles.

```epsil
trigExpand(sin(a + b))
// ➔ sin(b) * cos(a) + sin(a) * cos(b)
```

```epsil
trigExpand(sin(2x))
// ➔ 2sin(x) * cos(x)
```

```epsil
trigExpand(cos(2 * x))
// ➔ -sin(x)^2 + cos(x)^2
```

### trigReduce

MathJSON `TrigReduce` · `(value) -> value`

- argument 1 — The expression whose products and powers are reduced. Sample: `sin(x)^2`.

Rewrite products and integer powers of trigonometric and hyperbolic functions as a linear combination of functions of multiple angles (the inverse of TrigExpand).

```epsil
trigReduce(sin(x)^2)
// ➔ -1/2 * cos(2x) + 1/2
```

```epsil
trigReduce(sin(x) * cos(x))
// ➔ 1/2 * sin(2x)
```

### trigToExp

MathJSON `TrigToExp` · `(value) -> value`

- argument 1 — The expression to rewrite. Sample: `cos(x)`.

Rewrite trigonometric and hyperbolic functions in terms of the complex exponential, exactly.

```epsil
trigToExp(sin(x))
// ➔ -1/2 * i * e^(i * x) + 1/2 * i * e^(-i * x)
```

```epsil
trigToExp(cos(x))
// ➔ 1/2 * (e^(i * x) + e^(-i * x))
```
