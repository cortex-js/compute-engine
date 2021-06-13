---
title: Arithmetic
permalink: /guides/compute-engine/arithmetic/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

<script type='module'>
    import {  renderMathInDocument } 
      from '//unpkg.com/mathlive/dist/mathlive.min.mjs';
    renderMathInDocument({
      TeX: {
        delimiters: {
          inline: [ ['$', '$'], ['\\(', '\\)']],
          display: [['$$', '$$'],['\\[', '\\]']],
        },
      },
      asciiMath: null,
      processEnvironments : false,
      renderAccessibleContent: false,
    });
</script>

# Arithmetic

## Constants


<div class=symbols-table>

| Symbol | Value | |
| :--- | :--- | :--- |
| `ThreeQuarter`| \\[ \frac{3}{4} \\] | |
| `TwoThird`| \\[ \frac{2}{3} \\] | |
| `Half`| \\[ \frac{1}{2} \\] | |
| `Third`| \\[ \frac{1}{3} \\] | |
| `Quarter`| \\[ \frac{1}{4} \\] | |
| `ExponentialE` |  \\(2.7182818284590452354\ldots\\) | [Euler's number](https://www.wikidata.org/wiki/Q82435) |
| `ImaginaryI` | \\( \imaginaryI \\) | The imaginary unit, solution of \\(x^2+1=0\\) |
| `MachineEpsilon` | \\[ 2^{−52}\\] | The difference between 1 and the next larger floating point number. <br>See [Machine Epsilon on Wikipedia](https://en.wikipedia.org/wiki/Machine_epsilon) |
| `CatalanConstant` | \[ = 0.915965594177219015054603514932384110774\ldots \] | \[ \sum_{n=0}^{\infty} \frac{(-1)^{n}}{(2n+1)^2} \]. See [Catalan's Constant on Wikipedia](https://en.wikipedia.org/wiki/Catalan%27s_constant)| 
| `GoldenRatio` | \[ = 1.61803398874989484820\ldots\] | \[ \frac{1+\sqrt{5}}{2} \] See [Golden Ratio on Wikipedia](https://en.wikipedia.org/wiki/Golden_ratio) |
| `EulerGamma` | \[ = 0.577215664901532860606\ldots \]| See [Euler-Mascheroni Constant on Wikipedia](https://en.wikipedia.org/wiki/Euler%E2%80%93Mascheroni_constant) |
</div>

See also [Trigonometry](/guides/compute-engine/arithmetic/) for \( \pi \) and related constants.{.notice--info}

## Functions

<div class=symbols-table>

| Symbol | Operation | |
| :--- | :--- | :--- |
| `Add` | \\( a + b\\) | [Addition](https://www.wikidata.org/wiki/Q32043) |
| `Subtract` | \\( a - b\\) | [Subtraction](https://www.wikidata.org/wiki/Q32043)
| `Negate` | \\(-a\\) | [Additive inverse](https://www.wikidata.org/wiki/Q715358)|
| `Multiply` | \\( a\times b \\) | [Multiplication](https://www.wikidata.org/wiki/Q40276) |
| `Power` | \\( a^b \\) | [Exponentiation](https://www.wikidata.org/wiki/Q33456)
| `Root` | \\(\sqrt[n]{x}=x^{\frac1n}\\) | [n-th root](https://www.wikidata.org/wiki/Q601053) |
| `Sqrt` |  \\(\sqrt{x}=x^{\frac12}\\) | [Square root](https://www.wikidata.org/wiki/Q134237)|
</div>

---
<div class=symbols-table>

| Symbol | Operation | |
| :--- | :--- | :--- |
| `Exp` | \\(\exponentialE^{x}\\) |  [Exponential function](https://www.wikidata.org/wiki/Q168698) |
| `Log` | \\(\ln(x)\\) | [Logarithm function](https://www.wikidata.org/wiki/Q11197), the inverse of `Exp` |
| `Log2` | \\(\ln_2(x)\\) | [Binary logarithm function](https://www.wikidata.org/wiki/Q581168), the base-2 logarithm |
| `Log10` | \\(\ln_{10}(x)\\) | [Common logarithm](Q966582), the base-10 logarithm  |
| `LogOnePlus` | | |
</div>

---

<div class=symbols-table>

| Symbol | Operation | |
| :--- | :--- | :--- |
| `Abs` | \\(\|x\|  \\) | Absolute value, [magnitude](https://www.wikidata.org/wiki/Q3317982) |
| `Chop` |  | Replace real numbers that are very close to 0 (less than \\(10^{-10}\\)) with 0 |
| `Ceil` | | Rounds a number up to the next largest integer |
| `Floor` | | Round a number to the greatest integer less than the input value. |
| `Round` | | |

</div>

---
<div class=symbols-table>

| Symbol | Operation | |
| :--- | :--- | :--- |
| `Erf` | \\(\operatorname{Erf}\\) | \\( z={\frac{2}{\sqrt {\pi }}}\int_{0}^{z}e^{-t^2}\\,dt\\), the [Error function](https://en.wikipedia.org/wiki/Error_function) is the integral of the Gaussian distribution |
| `Erfc` | \\(\operatorname {Erfc} \\) | \\(z=1-\operatorname {Erf} z\\), the Complementary Error Function |
| `Factorial` | \\(n!\\) | The products of all positive integers less than or equal to $$n$$ |
| `Gamma` |  | \\((n-1)!\\) The [Gamma Function](https://en.wikipedia.org/wiki/Gamma_function), an extension of the factorial function to complex numbers [Q190573](https://www.wikidata.org/wiki/Q190573)|
| `LogGamma` | | |
| `SignGamma` | | |

</div>
