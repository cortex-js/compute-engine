---
title: Arithmetic
permalink: /guides/compute-engine-arithmetic/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

<script type='module'>
    import {renderMathInDocument} from '//unpkg.com/mathlive/dist/mathlive.mjs';
    renderMathInDocument();
</script>

# Arithmetic

## Constants

- `ExponentialE` = $$2.7182818284590452354\ldots$$
  [Euler's number](https://www.wikidata.org/wiki/Q82435).
- `ImaginaryI` - The imaginary unit, solution of $$x^2+1=0$$.
- `MachineEpsilon` $$\approx 2^{−52}$$. The difference between 1 and the next
  larger floating point number. See
  [Wikipedia](https://en.wikipedia.org/wiki/Machine_epsilon)
- `Pi` = $$\pi = 3.14159265358979323\ldots$$

## Functions

- `Add` - [Addition](https://www.wikidata.org/wiki/Q32043).
- `Negate` - The [additive inverse](https://www.wikidata.org/wiki/Q715358).
- `Multiply` - [Multiplication](https://www.wikidata.org/wiki/Q40276)
- `Power` - [Exponentiation](https://www.wikidata.org/wiki/Q33456)
- `Root` = $$\sqrt[n]{x}=x^{\frac1n}$$. The
  [n-th root](https://www.wikidata.org/wiki/Q601053)
- `Sqrt` = $$\sqrt{x}=x^{\frac12}$$. The
  [square root](https://www.wikidata.org/wiki/Q134237).
- `Subtract` - [Subtraction](https://www.wikidata.org/wiki/Q32043)

---

- `Exp` = $$\exponentialE^{x}$$.
  [Exponential function](https://www.wikidata.org/wiki/Q168698)
- `Log` = $$\ln(x)$$.
  [Logarithm function](https://www.wikidata.org/wiki/Q11197). The inverse of
  `Exp`.
- `Log2` = $$\ln_2(x)$$
  [Binary logarithm function](https://www.wikidata.org/wiki/Q581168).The base-2
  logarithm
- `Log10` = $$\ln_{10}(x)$$ [Common logarithm](Q966582). The base-10 logarithm.
- `LogOnePlus`

---

- `Abs` - Absolute value, [magnitude](https://www.wikidata.org/wiki/Q3317982).
- `Chop` - Replace real numbers that are very close to 0 with 0 (less than
  $$10^{-10}$$).
- `Ceil` - Rounds a number up to the next largest integer.
- `Floor` - Round a number to the greatest integer less than the input value.
- `Round`

---

- `Erf` =
  $$\operatorname{Erf} z={\frac{2}{\sqrt {\pi }}}\int_{0}^{z}e^{-t^2}\,dt$$. The
  [Error function](https://en.wikipedia.org/wiki/Error_function) is the integral
  of the Gaussion distribution.
- `Erfc` = $$\operatorname {Erfc} z=1-\operatorname {Erf} z$$. The Complementary
  Error Function.
- `Factorial` = $$n!$$, the products of all positive integers less than or equal
  to $$n$$.
- `Gamma` $$= (n-1)!$$ The
  [Gamma Function](https://www.wikidata.org/wiki/Q190573)
  [Wikipedia](https://en.wikipedia.org/wiki/Gamma_function), an extension of the
  factorial function to complex numbers.
- `LogGamma`
- `SignGamma`
