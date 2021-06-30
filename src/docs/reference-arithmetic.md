---
title: Arithmetic
permalink: /compute-engine/reference/arithmetic/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

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
| `ExponentialE` |  \\(2.7182818284\ldots\\) | [Euler's number](https://www.wikidata.org/wiki/Q82435) |
| `ImaginaryUnit` | \\( \imaginaryI \\) | The imaginary unit, solution of \\(x^2+1=0\\) |
| `MachineEpsilon` | \\[ 2^{−52}\\] | The difference between 1 and the next larger floating point number. <br>See [Machine Epsilon on Wikipedia](https://en.wikipedia.org/wiki/Machine_epsilon) |
| `CatalanConstant` | \\[ = 0.9159655941\ldots \\] | \\[ \sum_{n=0}^{\infty} \frac{(-1)^{n}}{(2n+1)^2} \\] <br> See [Catalan's Constant on Wikipedia](https://en.wikipedia.org/wiki/Catalan%27s_constant)| 
| `GoldenRatio` | \\[ = 1.6180339887\ldots\\] | \\[ \frac{1+\sqrt{5}}{2} \\] See [Golden Ratio on Wikipedia](https://en.wikipedia.org/wiki/Golden_ratio) |
| `EulerGamma` | \\[ = 0.5772156649\ldots \\]| See [Euler-Mascheroni Constant on Wikipedia](https://en.wikipedia.org/wiki/Euler%E2%80%93Mascheroni_constant) |
</div>


<div class='read-more'><a href="/compute-engine/reference/trigonometry/">See also <strong>Trigonometry</strong> for \( \pi \) and 
related constants<svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>

## Predicates

<div class=symbols-table>

| Function | Notation | |
| :--- | :--- | :--- |
| `Equal` | \\( x = y \\) |  Mathematical relationship asserting that two quantities have the same value |
| `Greater` | \\( x \gt y \\) | | 
| `GreaterEqual` | \\( x \geq y \\) | | 
| `Less` | \\( x \lt y \\) | | 
| `LessEqual` | \\( x \leq y \\) | | 
| `NotEqual` | \\( x \ne y \\) | |

</div>


## Functions

<div class=symbols-table>

| Function | Notation | |
| :--- | :--- | :--- |
| `Add` | \\( a + b\\) | [Addition](https://www.wikidata.org/wiki/Q32043) |
| `Subtract` | \\( a - b\\) | [Subtraction](https://www.wikidata.org/wiki/Q32043)
| `Negate` | \\(-a\\) | [Additive inverse](https://www.wikidata.org/wiki/Q715358)|
| `Multiply` | \\( a\times b \\) | [Multiplication](https://www.wikidata.org/wiki/Q40276) |
| `Power` | \\( a^b \\) | [Exponentiation](https://www.wikidata.org/wiki/Q33456)
| `Root` | \\(\sqrt[n]{x}=x^{\frac1n}\\) | [n-th root](https://www.wikidata.org/wiki/Q601053) |
| `Sqrt` |  \\(\sqrt{x}=x^{\frac12}\\) | [Square root](https://www.wikidata.org/wiki/Q134237)|
| `Square` |  \\(x^2\\) | |
</div>


### Transcendental Functions

<div class=symbols-table>

| Function | Notation | |
| :--- | :--- | :--- |
| `Exp` | \\(\exponentialE^{x}\\) |  [Exponential function](https://www.wikidata.org/wiki/Q168698) |
| `Log` | \\(\ln(x)\\) | [Logarithm function](https://www.wikidata.org/wiki/Q11197), the inverse of `Exp` |
| `Log2` | \\(\ln_2(x)\\) | [Binary logarithm function](https://www.wikidata.org/wiki/Q581168), the base-2 logarithm |
| `Log10` | \\(\ln_{10}(x)\\) | [Common logarithm](Q966582), the base-10 logarithm  |
| `LogOnePlus` | | |
</div>

<div class='read-more'><a href="/compute-engine/reference/trigonometry/">See also <strong>Trigonometry</strong> for trigonometric functions<svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>



### Rounding

<div class=symbols-table>

| Function | Notation | |
| :--- | :--- | :--- |
| `Abs` | \\(\|x\|  \\) | Absolute value, [magnitude](https://www.wikidata.org/wiki/Q3317982) |
| `Ceil` | | Rounds a number up to the next largest integer |
| `Chop` |  | Replace real numbers that are very close to 0 (less than \\(10^{-10}\\)) with 0 |
| `Floor` | | Round a number to the greatest integer less than the input value. |
| `Round` | | |

</div>
