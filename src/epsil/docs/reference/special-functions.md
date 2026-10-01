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

The 15 definitions of the special functions library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### agm

MathJSON `AGM` · `(complex | infinity, (complex | infinity)?) -> number`

Arithmetic-geometric mean. AGM(z) is shorthand for AGM(1, z) (Fungrim convention).

### appellF1

MathJSON `AppellF1` · `(complex | infinity, complex | infinity, complex | infinity, complex | infinity, complex | infinity, complex | infinity) -> number`

Appell hypergeometric function F₁(a; b₁, b₂; c; x, y), double series for |x|, |y| &lt; 1.

### clausenCl

MathJSON `ClausenCl` · `(integer, real) -> number`

Clausen function Clₙ(θ) of integer order n ≥ 1 and real θ: Im Liₙ(e^&#123;iθ&#125;) = Σ sin(kθ)/kⁿ for even n, Re Liₙ(e^&#123;iθ&#125;) = Σ cos(kθ)/kⁿ for odd n. Double precision.

```epsil
[clausenCl(2, 1), clausenCl(3, 0), N(clausenCl(2, 1))]
// ➔ [ClausenCl(2, 1),Zeta(3),1.0139591323607684]
```

### dedekindEta

MathJSON `DedekindEta` · `(complex | infinity) -> number`

Dedekind eta function η(τ), Im(τ) &gt; 0.

### eisensteinE

MathJSON `EisensteinE` · `(number, complex | infinity) -> number`

Normalized Eisenstein series Eₛ(τ) of even weight s ≥ 2, Im(τ) &gt; 0.

### ellipticE

MathJSON `EllipticE` · `(complex | infinity, (complex | infinity)?) -> number`

Elliptic integral of the second kind: complete E(m) with one argument, incomplete E(φ|m) with two (amplitude first, parameter convention m = k², as in Mathematica).

### ellipticF

MathJSON `EllipticF` · `(complex | infinity, complex | infinity) -> number`

Incomplete elliptic integral of the first kind F(φ|m) (amplitude first, parameter convention m = k², as in Mathematica). F(π/2|m) = K(m).

### ellipticK

MathJSON `EllipticK` · `(complex | infinity) -> number`

Complete elliptic integral of the first kind K(m), parameter convention m = k².

### ellipticPi

MathJSON `EllipticPi` · `(complex | infinity, complex | infinity, (complex | infinity)?) -> number`

Elliptic integral of the third kind: complete Π(n|m) with two arguments, incomplete Π(n; φ|m) with three (characteristic first, amplitude second, parameter convention m = k², as in Mathematica).

### expIntegralEi

MathJSON `ExpIntegralEi` · `(complex | infinity) -> number`

Exponential integral Ei(x) = PV ∫_&#123;−∞&#125;^x eᵗ/t dt.

### hypergeometric1F1

MathJSON `Hypergeometric1F1` · `(complex | infinity, complex | infinity, complex | infinity) -> number`

Kummer confluent hypergeometric function ₁F₁(a; b; z) = M(a, b, z).

### hypergeometric2F1

MathJSON `Hypergeometric2F1` · `(complex | infinity, complex | infinity, complex | infinity, complex | infinity) -> number`

Gauss hypergeometric function ₂F₁(a, b; c; z).

### jacobiTheta

MathJSON `JacobiTheta` · `(number, complex | infinity, complex | infinity, number?) -> number`

Jacobi theta function θⱼ(z, τ), j ∈ &#123;1,2,3,4&#125;, nome q = e^&#123;iπτ&#125; (Fungrim convention).

### logIntegral

MathJSON `LogIntegral` · `(complex | infinity) -> number`

Logarithmic integral li(x) = PV ∫₀ˣ dt/ln t = Ei(ln x).

### polyLog

MathJSON `PolyLog` · `(complex | infinity, complex | infinity) -> number`

Polylogarithm Liₛ(z) = Σ_&#123;k≥1&#125; zᵏ/kˢ, at any real or complex order s.

### stieltjesGamma

MathJSON `StieltjesGamma` · `(integer, number?) -> number`

Generalized Stieltjes constants γₙ(a), the Laurent coefficients of ζ(s, a) at s = 1: ζ(s, a) = 1/(s−1) + Σₙ (−1)ⁿ γₙ(a)(s−1)ⁿ/n!. StieltjesGamma(n) is γₙ = γₙ(1), and γ₀ is Euler's constant.

```epsil
stieltjesGamma(0)
// ➔ "EulerGamma"
```

```epsil
N(stieltjesGamma(1))
// ➔ -0.0728158454836767248606
```

```epsil
N(stieltjesGamma(2, 1/2))
// ➔ 0.968864475220290711422
```
