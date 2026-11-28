---
title: Special functions Reference
sidebar_label: Special functions
slug: /epsil/reference/special-functions/
description: "The special functions library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from special-functions.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Special functions

The 24 definitions of the special functions library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### agm

MathJSON `AGM` · `(complex | infinity, (complex | infinity)?) -> number`

- argument 1 — The first number, or z in AGM(1, z) when it is the only argument; the value is 0 when either number is 0. Sample: `1`.
- argument 2 — The second number; a negative number gives the complex AGM. Sample: `2`.

Arithmetic-geometric mean. AGM(z) is shorthand for AGM(1, z) (Fungrim convention).

```epsil
N(agm(1, 2))
// ➔ 1.45679103104690686918
```

```epsil
agm(3, 3)
// ➔ 3
```

### appellF1

MathJSON `AppellF1` · `(a: complex | infinity, b1: complex | infinity, b2: complex | infinity, c: complex | infinity, x: complex | infinity, y: complex | infinity) -> number`

- `a` — The parameter a. Sample: `1`.
- `b1` — The parameter b₁, paired with x. Sample: `1`.
- `b2` — The parameter b₂, paired with y. Sample: `1`.
- `c` — The denominator parameter c. Sample: `2`.
- `x` — The first argument, |x| &lt; 1; outside the disk the call stays unevaluated. Sample: `1/2`.
- `y` — The second argument, |y| &lt; 1; outside the disk the call stays unevaluated. Sample: `1/4`.

Appell hypergeometric function F₁(a; b₁, b₂; c; x, y), double series for |x|, |y| &lt; 1.

```epsil
N(appellF1(1, 1, 1, 2, 1/2, 1/4))
// ➔ 1.6218604324326553
```

### barnesG

MathJSON `BarnesG` · `(complex | infinity) -> number`

- argument 1 — The argument; the value is 0 at the non-positive integers. Sample: `5`.

The Barnes G-function, the double gamma function G(z+1) = Γ(z)·G(z), G(1) = 1. G(n) is the superfactorial 1!·2!⋯(n−2)! at a positive integer n; G is entire, with zeros at the non-positive integers.

```epsil
barnesG(5)
// ➔ 12
```

```epsil
N(barnesG(1/2))
// ➔ 0.603244281209446206191
```

### chebyshevT

MathJSON `ChebyshevT` · `(degree: real, x: complex) -> number`

- `degree` — The degree n; a negative degree gives T₋ₙ = Tₙ. A non-integer degree stays unevaluated. Sample: `3`.
- `x` — The point; a number gives the value, a symbol or an expression the expanded polynomial in it. Sample: `1/2`.

Chebyshev polynomial of the first kind Tₙ(x), with Tₙ(cos θ) = cos(nθ). T₋ₙ = Tₙ.

```epsil
chebyshevT(3, x)
// ➔ 4x^3 - 3x
```

```epsil
chebyshevT(3, 1/2)
// ➔ -1
```

### chebyshevU

MathJSON `ChebyshevU` · `(degree: real, x: complex) -> number`

- `degree` — The degree n; a negative degree gives U₋₁ = 0 and U₋ₙ = −Uₙ₋₂. A non-integer degree stays unevaluated. Sample: `3`.
- `x` — The point; a number gives the value, a symbol or an expression the expanded polynomial in it. Sample: `1/2`.

Chebyshev polynomial of the second kind Uₙ(x), with Uₙ(cos θ) = sin((n+1)θ)/sin θ. U₋₁ = 0 and U₋ₙ = −Uₙ₋₂.

```epsil
chebyshevU(2, x)
// ➔ 4x^2 - 1
```

### clausenCl

MathJSON `ClausenCl` · `(n: integer, theta: real) -> number`

- `n` — The order n, at least 1; a smaller order stays unevaluated. Sample: `2`.
- `theta` — The angle θ, in radians; Cl₁ is `+oo` at θ = 0. Sample: `pi / 2`.

Clausen function Clₙ(θ) of integer order n ≥ 1 and real θ: Im Liₙ(e^&#123;iθ&#125;) = Σ sin(kθ)/kⁿ for even n, Re Liₙ(e^&#123;iθ&#125;) = Σ cos(kθ)/kⁿ for odd n. A real θ follows the engine precision.

```epsil
[clausenCl(2, 1), clausenCl(3, 0), N(clausenCl(2, 1))]
// ➔ [ClausenCl(2, 1),Zeta(3),1.01395913236076850429]
```

### dedekindEta

MathJSON `DedekindEta` · `(complex | infinity) -> number`

- argument 1 — The point τ of the upper half-plane; a τ with Im(τ) ≤ 0 stays unevaluated. Sample: `i`.

Dedekind eta function η(τ), Im(τ) &gt; 0.

```epsil
N(dedekindEta(i))
// ➔ 0.768225422326056659003
```

### eisensteinE

MathJSON `EisensteinE` · `(s: number, tau: complex | infinity) -> number`

- `s` — The weight s, an even integer at least 2; another value stays unevaluated. Sample: `4`.
- `tau` — The point τ of the upper half-plane; a τ with Im(τ) ≤ 0 stays unevaluated. Sample: `i`.

Normalized Eisenstein series Eₛ(τ) of even weight s ≥ 2, Im(τ) &gt; 0.

```epsil
N(eisensteinE(4, i))
// ➔ 1.4557628922687094
```

### ellipticE

MathJSON `EllipticE` · `(complex | infinity, (complex | infinity)?) -> number`

- argument 1 — Alone, the parameter m = k² of the complete integral; with a second argument, the amplitude φ, in radians. Sample: `1/2`.
- argument 2 — The parameter m = k² of the incomplete integral. Sample: `1/2`.

Elliptic integral of the second kind: complete E(m) with one argument, incomplete E(φ|m) with two (amplitude first, parameter convention m = k², as in Mathematica).

```epsil
N(ellipticE(1/2))
// ➔ 1.35064388104767550252
```

```epsil
N(ellipticE(pi/4, 1/2))
// ➔ 0.748186504177661377454
```

### ellipticF

MathJSON `EllipticF` · `(phi: complex | infinity, m: complex | infinity) -> number`

- `phi` — The amplitude φ, in radians; the value is 0 at φ = 0, and N gives K(m) at φ = π/2. Sample: `pi / 4`.
- `m` — The parameter m = k². Sample: `1/2`.

Incomplete elliptic integral of the first kind F(φ|m) (amplitude first, parameter convention m = k², as in Mathematica). F(π/2|m) = K(m).

```epsil
N(ellipticF(pi/4, 1/2))
// ➔ 0.826017876249245185456
```

### ellipticK

MathJSON `EllipticK` · `(complex | infinity) -> number`

- argument 1 — The parameter m = k²; the value is real for m &lt; 1, `+oo` at m = 1 and complex for m &gt; 1. Sample: `1/2`.

Complete elliptic integral of the first kind K(m), parameter convention m = k².

```epsil
ellipticK(0)
// ➔ 1/2 * pi
```

```epsil
N(ellipticK(1/2))
// ➔ 1.85407467730137191843
```

### ellipticPi

MathJSON `EllipticPi` · `(complex | infinity, complex | infinity, (complex | infinity)?) -> number`

- argument 1 — The characteristic n; N of the complete integral is `+oo` at n = 1. Sample: `1/2`.
- argument 2 — With two arguments, the parameter m = k² of the complete integral; with three, the amplitude φ, in radians. Sample: `1/2`.
- argument 3 — The parameter m = k² of the incomplete integral. Sample: `1/2`.

Elliptic integral of the third kind: complete Π(n|m) with two arguments, incomplete Π(n; φ|m) with three (characteristic first, amplitude second, parameter convention m = k², as in Mathematica).

```epsil
N(ellipticPi(1/2, 1/2))
// ➔ 2.70128776209535100504
```

```epsil
N(ellipticPi(1/2, pi/4, 1/2))
// ➔ 0.919022739165696990399
```

### expIntegralEi

MathJSON `ExpIntegralEi` · `(complex | infinity) -> number`

- argument 1 — The argument; the value is `-oo` at 0, `+oo` at `+oo` and 0 at `-oo`. Sample: `1`.

Exponential integral Ei(x) = PV ∫_&#123;−∞&#125;^x eᵗ/t dt.

```epsil
N(expIntegralEi(1))
// ➔ 1.89511781635593675547
```

```epsil
expIntegralEi(0)
// ➔ -oo
```

### hermiteH

MathJSON `HermiteH` · `(degree: real, x: complex) -> number`

- `degree` — The degree n, at least 0; a negative or non-integer degree stays unevaluated. Sample: `3`.
- `x` — The point; a number gives the value, a symbol or an expression the expanded polynomial in it. Sample: `1/2`.

Hermite polynomial Hₙ(x) of the physicists' convention, with H₀ = 1, H₁ = 2x and Hₙ₊₁ = 2x Hₙ − 2n Hₙ₋₁. A negative or non-integer degree stays unevaluated.

```epsil
hermiteH(2, x)
// ➔ 4x^2 - 2
```

### hypergeometric1F1

MathJSON `Hypergeometric1F1` · `(a: complex | infinity, b: complex | infinity, z: complex | infinity) -> number`

- `a` — The numerator parameter. Sample: `1`.
- `b` — The denominator parameter. Sample: `2`.
- `z` — The argument; the value is 1 at z = 0. Sample: `1`.

Kummer confluent hypergeometric function ₁F₁(a; b; z) = M(a, b, z).

```epsil
N(hypergeometric1F1(1, 2, 1))
// ➔ 1.71828182845904523536
```

```epsil
hypergeometric1F1(2, 2, x)
// ➔ e^x
```

### hypergeometric2F1

MathJSON `Hypergeometric2F1` · `(a: complex | infinity, b: complex | infinity, c: complex | infinity, z: complex | infinity) -> number`

- `a` — The first numerator parameter. Sample: `1`.
- `b` — The second numerator parameter. Sample: `1`.
- `c` — The denominator parameter. Sample: `2`.
- `z` — The argument; the value is 1 at z = 0, and complex on the cut z &gt; 1. Sample: `1/2`.

Gauss hypergeometric function ₂F₁(a, b; c; z).

```epsil
N(hypergeometric2F1(1, 1, 2, 1/2))
// ➔ 1.38629436111989061883
```

```epsil
hypergeometric2F1(1, 2, 2, x)
// ➔ 1 / (1 - x)
```

### jacobiTheta

MathJSON `JacobiTheta` · `(j: number, z: complex | infinity, tau: complex | infinity, r: number?) -> number`

- `j` — The index j of the function, 1, 2, 3 or 4; another value stays unevaluated. Sample: `3`.
- `z` — The argument z; θ₃ and θ₄ have period 1 in z. Sample: `0`.
- `tau` — The lattice parameter τ, with Im(τ) &gt; 0; the nome is q = e^&#123;iπτ&#125;. Sample: `i`.
- `r` — The order of the derivative in z; only 0 is implemented, another order stays unevaluated. Sample: `0`.

Jacobi theta function θⱼ(z, τ), j ∈ &#123;1,2,3,4&#125;, nome q = e^&#123;iπτ&#125; (Fungrim convention).

```epsil
N(jacobiTheta(3, 0, i))
// ➔ 1.08643481121330801458
```

### laguerreL

MathJSON `LaguerreL` · `(degree: real, complex, complex?) -> number`

- `degree` — The degree n, at least 0; a negative or non-integer degree stays unevaluated. Sample: `3`.
- argument 2 — With two arguments, the point x; with three, the parameter a of the generalized polynomial Lₙ⁽ᵃ⁾. Sample: `1/2`.
- argument 3 — The point; a number gives the value, a symbol or an expression the expanded polynomial in it. Sample: `1/2`.

Laguerre polynomial Lₙ(x) = Σₖ (−1)ᵏ C(n, k) xᵏ/k!; with three arguments, the generalized Laguerre polynomial Lₙ⁽ᵃ⁾(x) = Σₖ (−1)ᵏ C(n+a, n−k) xᵏ/k!, with LaguerreL(n, 0, x) = LaguerreL(n, x). A negative or non-integer degree stays unevaluated.

```epsil
laguerreL(2, x)
// ➔ 1/2 * x^2 - 2x + 1
```

```epsil
laguerreL(2, a, x)
// ➔ 1/2 * a^2 + 1/2 * x^2 - a * x + 3/2 * a - 2x + 1
```

```epsil
laguerreL(3, 1/2, 2)
// ➔ -43/48
```

### legendreP

MathJSON `LegendreP` · `(degree: real, x: complex) -> number`

- `degree` — The degree n; a negative degree gives P₋ₙ = Pₙ₋₁. A non-integer degree stays unevaluated. Sample: `3`.
- `x` — The point; a number gives the value, a symbol or an expression the expanded polynomial in it. Sample: `1/2`.

Legendre polynomial Pₙ(x), with P₀ = 1, P₁ = x and (n+1)Pₙ₊₁ = (2n+1)x Pₙ − n Pₙ₋₁. P₋ₙ = Pₙ₋₁.

```epsil
legendreP(2, x)
// ➔ 3/2 * x^2 - 1/2
```

### logBarnesG

MathJSON `LogBarnesG` · `(complex | infinity) -> number`

- argument 1 — The argument; the value is `-oo` at the non-positive integers. Sample: `5`.

The logarithm of the Barnes G-function, continued analytically with `logGamma`: its imaginary part is not principal on the negative axis. −∞ at the zeros of G, the non-positive integers.

```epsil
logBarnesG(5)
// ➔ 2ln(2) + ln(3)
```

```epsil
N(logBarnesG(-1/2))
// ➔ (-1.7709451779743404 + 3.141592653589793i)
```

### logGamma

MathJSON `LogGamma` · `(complex | infinity) -> number`

- argument 1 — The argument; the value is `+oo` at the poles of Γ, the non-positive integers. Sample: `5`.

The analytic continuation of ln Γ(z), with its branch cut on (−∞, 0]; not `gammaLn`, the principal logarithm of Γ(z), which jumps by 2πi across the zeros of Im Γ.

```epsil
logGamma(5)
// ➔ 3ln(2) + ln(3)
```

```epsil
N(logGamma(-2.5 + 1.5i))
// ➔ (-3.7175134511917927 - 7.713065525834192i)
```

### logIntegral

MathJSON `LogIntegral` · `(complex | infinity) -> number`

- argument 1 — The argument; the value is 0 at 0 and `-oo` at 1, and a negative or non-real number stays unevaluated. Sample: `10`.

Logarithmic integral li(x) = PV ∫₀ˣ dt/ln t = Ei(ln x).

```epsil
N(logIntegral(10))
// ➔ 6.16559950478729793752
```

```epsil
logIntegral(1)
// ➔ -oo
```

### polyLog

MathJSON `PolyLog` · `(s: complex | infinity, z: complex | infinity) -> number`

- `s` — The order s. Sample: `2`.
- `z` — The argument; the value is 0 at z = 0, ζ(s) at z = 1 when s &gt; 1, and complex on the cut z &gt; 1. Sample: `1/2`.

Polylogarithm Liₛ(z) = Σ_&#123;k≥1&#125; zᵏ/kˢ, at any real or complex order s.

```epsil
polyLog(2, 1)
// ➔ 1/6 * pi^2
```

```epsil
N(polyLog(2, 1/2))
// ➔ 0.582240526465012505903
```

### stieltjesGamma

MathJSON `StieltjesGamma` · `(n: integer, a: number?) -> number`

- `n` — The index n, at least 0; a negative index stays unevaluated. Sample: `1`.
- `a` — The shift a, 1 by default; the value is `~oo` at a non-positive integer. Sample: `1/2`.

Generalized Stieltjes constants γₙ(a), the Laurent coefficients of ζ(s, a) at s = 1: ζ(s, a) = 1/(s−1) + Σₙ (−1)ⁿ γₙ(a)(s−1)ⁿ/n!. StieltjesGamma(n) is γₙ = γₙ(1), and γ₀ is Euler's constant.

```epsil
stieltjesGamma(0)
// ➔ eulerGamma
```

```epsil
N(stieltjesGamma(1))
// ➔ -0.0728158454836767248606
```

```epsil
N(stieltjesGamma(2, 1/2))
// ➔ 0.968864475220290711422
```
