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

| Symbol            | Value                        |                                                                                                                                                           |
| :---------------- | :--------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExponentialE`    | \\(2.7182818284\ldots\\)     | [Euler's number](https://www.wikidata.org/wiki/Q82435)                                                                                                    |
| `ImaginaryUnit`   | \\( \imaginaryI \\)          | The imaginary unit, solution of \\(x^2+1=0\\)                                                                                                             |
| `MachineEpsilon`  | \\[ 2^{−52}\\]               | The difference between 1 and the next larger floating point number. <br>See [Machine Epsilon on Wikipedia](https://en.wikipedia.org/wiki/Machine_epsilon) |
| `CatalanConstant` | \\[ = 0.9159655941\ldots \\] | \\[ \sum_{n=0}^{\infty} \frac{(-1)^{n}}{(2n+1)^2} \\] <br> See [Catalan's Constant on Wikipedia](https://en.wikipedia.org/wiki/Catalan%27s_constant)      |
| `GoldenRatio`     | \\[ = 1.6180339887\ldots\\]  | \\[ \frac{1+\sqrt{5}}{2} \\] See [Golden Ratio on Wikipedia](https://en.wikipedia.org/wiki/Golden_ratio)                                                  |
| `EulerGamma`      | \\[ = 0.5772156649\ldots \\] | See [Euler-Mascheroni Constant on Wikipedia](https://en.wikipedia.org/wiki/Euler%E2%80%93Mascheroni_constant)                                             |

</div>

<div class='read-more'><a href="/compute-engine/reference/trigonometry/">See also <strong>Trigonometry</strong> for \( \pi \) and 
related constants<svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>

## Relational Operators

<div class=symbols-table>

| Function       | Notation         |                                                                                                       |
| :------------- | :--------------- | :---------------------------------------------------------------------------------------------------- |
| `Equal`        | \\( x = y \\)    | {% tags "predicate" %}<br>Mathematical relationship asserting that two quantities have the same value |
| `Greater`      | \\( x \gt y \\)  | {% tags "predicate" %}                                                                                |
| `GreaterEqual` | \\( x \geq y \\) | {% tags "predicate" %}                                                                                |
| `Less`         | \\( x \lt y \\)  | {% tags "predicate" %}                                                                                |
| `LessEqual`    | \\( x \leq y \\) | {% tags "predicate" %}                                                                                |
| `NotEqual`     | \\( x \ne y \\)  | {% tags "predicate" %}                                                                                |

</div>

## Rational

`Rational(`_`n:Number`_`)`

`Rational(`_`numerator:Integer`_`, `_`denominator:Integer `_`)`

If two arguments, the first argument is the numerator, the second is the
denominator. If a single argument, will evaluate to a rational approximating the
value of the argument.


## `BaseForm`

`BaseForm(_n:Integer_, _base_=10)`

Format an _integer_ in a specific _base_, such as hexadecimal or binary.

The sign of _integer_ is ignored.

- _value_ should be an integer.
- _base_ should be an integer from 2 to 36.

```json
["Latex", ["BaseForm", 42, 16]]
// ➔ (\text(2a))_{16}
```

```cortex
Latex(BaseForm(42, 16))
// ➔ (\text(2a))_{16}
String(BaseForm(42, 16))
// ➔ "'0x2a'"
```

## Functions

<div class=symbols-table>

| Function   | Notation                      |                                                                                            |
| :--------- | :---------------------------- | :----------------------------------------------------------------------------------------- |
| `Add`      | \\( a + b\\)                  | [Addition](https://www.wikidata.org/wiki/Q32043) {% tags "numeric" "float-right"%}         |
| `Subtract` | \\( a - b\\)                  | [Subtraction](https://www.wikidata.org/wiki/Q32043) {% tags "numeric" "float-right"%}      |
| `Negate`   | \\(-a\\)                      | [Additive inverse](https://www.wikidata.org/wiki/Q715358){% tags "numeric" "float-right"%} |
| `Multiply` | \\( a\times b \\)             | [Multiplication](https://www.wikidata.org/wiki/Q40276) {% tags "numeric" "float-right"%}   |
| `Power`    | \\( a^b \\)                   | [Exponentiation](https://www.wikidata.org/wiki/Q33456) {% tags "numeric" "float-right"%}   |
| `Root`     | \\(\sqrt[n]{x}=x^{\frac1n}\\) | [n-th root](https://www.wikidata.org/wiki/Q601053) {% tags "numeric" "float-right"%}       |
| `Sqrt`     | \\(\sqrt{x}=x^{\frac12}\\)    | [Square root](https://www.wikidata.org/wiki/Q134237){% tags "numeric" "float-right"%}      |
| `Square`   | \\(x^2\\)                     | {% tags "numeric" "float-right"%}                                                          |

</div>

### Transcendental Functions

<div class=symbols-table>

| Function     | Notation                |                                                                                                                            |
| :----------- | :---------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| `Exp`        | \\(\exponentialE^{x}\\) | [Exponential function](https://www.wikidata.org/wiki/Q168698) {% tags "numeric" "float-right"%}                            |
| `Log`        | \\(\ln(x)\\)            | [Logarithm function](https://www.wikidata.org/wiki/Q11197), the inverse of `Exp` {% tags "numeric" "float-right"%}         |
| `Log2`       | \\(\ln_2(x)\\)          | [Binary logarithm function](https://www.wikidata.org/wiki/Q581168), the base-2 logarithm {% tags "numeric" "float-right"%} |
| `Log10`      | \\(\ln\_{10}(x)\\)      | [Common logarithm](Q966582), the base-10 logarithm {% tags "numeric" "float-right"%}                                       |
| `LogOnePlus` |                         | {% tags "numeric" "float-right"%}                                                                                          |

</div>

{% readmore "/compute-engine/reference/trigonometry/" %} See also
<strong>Trigonometry</strong> for trigonometric functions {% endreadmore %}

### Rounding

<div class=symbols-table>

| Function | Notation     |                                                                                                                   |
| :------- | :----------- | :---------------------------------------------------------------------------------------------------------------- |
| `Abs`    | \\(\|x\| \\) | Absolute value, [magnitude](https://www.wikidata.org/wiki/Q3317982) {% tags "numeric" "float-right"%}             |
| `Ceil`   |              | Rounds a number up to the next largest integer {% tags "numeric" "float-right"%}                                  |
| `Chop`   |              | Replace real numbers that are very close to 0 (less than \\(10^{-10}\\)) with 0 {% tags "numeric" "float-right"%} |
| `Floor`  |              | Round a number to the greatest integer less than the input value {% tags "numeric" "float-right"%}                |
| `Round`  |              | {% tags "numeric" "float-right"%}                                                                                 |

</div>
