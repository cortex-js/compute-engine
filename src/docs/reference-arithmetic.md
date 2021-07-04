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
| `Equal` | \\( x = y \\) |  {% tags "predicate" %}<br>Mathematical relationship asserting that two quantities have the same value |
| `Greater` | \\( x \gt y \\) | {% tags "predicate" %}| 
| `GreaterEqual` | \\( x \geq y \\) | {% tags "predicate" %}| 
| `Less` | \\( x \lt y \\) | {% tags "predicate" %}| 
| `LessEqual` | \\( x \leq y \\) | {% tags "predicate" %}| 
| `NotEqual` | \\( x \ne y \\) | {% tags "predicate" %}|

</div>


## Functions

<div class=symbols-table>

| Function | Notation | |
| :--- | :--- | :--- |
| `Add` | \\( a + b\\) | {% tags "numeric" %}<br>[Addition](https://www.wikidata.org/wiki/Q32043) |
| `Subtract` | \\( a - b\\) | {% tags "numeric" %}<br>[Subtraction](https://www.wikidata.org/wiki/Q32043)
| `Negate` | \\(-a\\) | {% tags "numeric" %}<br>[Additive inverse](https://www.wikidata.org/wiki/Q715358)|
| `Multiply` | \\( a\times b \\) | {% tags "numeric" %}<br>[Multiplication](https://www.wikidata.org/wiki/Q40276) |
| `Power` | \\( a^b \\) | {% tags "numeric" %}<br>[Exponentiation](https://www.wikidata.org/wiki/Q33456)
| `Root` | \\(\sqrt[n]{x}=x^{\frac1n}\\) | {% tags "numeric" %}<br>[n-th root](https://www.wikidata.org/wiki/Q601053) |
| `Sqrt` |  \\(\sqrt{x}=x^{\frac12}\\) | {% tags "numeric" %}<br>[Square root](https://www.wikidata.org/wiki/Q134237)|
| `Square` |  \\(x^2\\) | {% tags "numeric" %}|
</div>


### Transcendental Functions

<div class=symbols-table>

| Function | Notation | |
| :--- | :--- | :--- |
| `Exp` | \\(\exponentialE^{x}\\) |  {% tags "numeric" %}<br>[Exponential function](https://www.wikidata.org/wiki/Q168698) |
| `Log` | \\(\ln(x)\\) | {% tags "numeric" %}<br>[Logarithm function](https://www.wikidata.org/wiki/Q11197), the inverse of `Exp` |
| `Log2` | \\(\ln_2(x)\\) | {% tags "numeric" %}<br>[Binary logarithm function](https://www.wikidata.org/wiki/Q581168), the base-2 logarithm |
| `Log10` | \\(\ln_{10}(x)\\) | [{% tags "numeric" %}<br>Common logarithm](Q966582), the base-10 logarithm  |
| `LogOnePlus` | | {% tags "numeric" %}<br>|
</div>

{% readmore "/compute-engine/reference/trigonometry/" %}
See also <strong>Trigonometry</strong> for trigonometric functions
{% endreadmore %}



### Rounding

<div class=symbols-table>

| Function | Notation | |
| :--- | :--- | :--- |
| `Abs` | \\(\|x\|  \\) | {% tags "numeric" %}<br>Absolute value, [magnitude](https://www.wikidata.org/wiki/Q3317982) |
| `Ceil` | | {% tags "numeric" %}<br>Rounds a number up to the next largest integer |
| `Chop` |  | {% tags "numeric" %}<br>Replace real numbers that are very close to 0 (less than \\(10^{-10}\\)) with 0 |
| `Floor` | | {% tags "numeric" %}<br>Round a number to the greatest integer less than the input value. |
| `Round` | | {% tags "numeric" %}<br>|

</div>
