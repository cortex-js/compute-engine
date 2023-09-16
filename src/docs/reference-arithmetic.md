---
title: Arithmetic
permalink: /compute-engine/reference/arithmetic/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: true
render_math_in_document: true
---

## Constants

<div class=symbols-table>

| Symbol            | Value                        |                                                                                                                                                           |
| :---------------- | :--------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExponentialE`    | \\(2.7182818284\ldots\\)     | [Euler's number](https://www.wikidata.org/wiki/Q82435)                                                                                                    |
| `MachineEpsilon`  | \\[ 2^{−52}\\]               | The difference between 1 and the next larger floating point number. <br>See [Machine Epsilon on Wikipedia](https://en.wikipedia.org/wiki/Machine_epsilon) |
| `CatalanConstant` | \\[ = 0.9159655941\ldots \\] | \\[ \sum_{n=0}^{\infty} \frac{(-1)^{n}}{(2n+1)^2} \\] <br> See [Catalan's Constant on Wikipedia](https://en.wikipedia.org/wiki/Catalan%27s_constant)      |
| `GoldenRatio`     | \\[ = 1.6180339887\ldots\\]  | \\[ \frac{1+\sqrt{5}}{2} \\] See [Golden Ratio on Wikipedia](https://en.wikipedia.org/wiki/Golden_ratio)                                                  |
| `EulerGamma`      | \\[ = 0.5772156649\ldots \\] | See [Euler-Mascheroni Constant on Wikipedia](https://en.wikipedia.org/wiki/Euler%E2%80%93Mascheroni_constant)                                             |

</div>

{% readmore "/compute-engine/reference/trigonometry/" %} See also
<strong>Trigonometry</strong> for `Pi` and related constants{% endreadmore %}

{% readmore "/compute-engine/reference/complex/" %} See also
<strong>Complex</strong> for `ImaginaryUnit` and related
functions{% endreadmore %}

## Relational Operators

<div class=symbols-table>

| Function       | Notation         |                                                                                                                     |
| :------------- | :--------------- | :------------------------------------------------------------------------------------------------------------------ |
| `Equal`        | \\( x = y \\)    | {% tags "predicate" "float-right" %}<br>Mathematical relationship asserting that two quantities have the same value |
| `Greater`      | \\( x \gt y \\)  | {% tags "predicate" "float-right" %}                                                                                |
| `GreaterEqual` | \\( x \geq y \\) | {% tags "predicate" "float-right" %}                                                                                |
| `Less`         | \\( x \lt y \\)  | {% tags "predicate" "float-right" %}                                                                                |
| `LessEqual`    | \\( x \leq y \\) | {% tags "predicate" "float-right" %}                                                                                |
| `NotEqual`     | \\( x \ne y \\)  | {% tags "predicate" "float-right" %}                                                                                |

</div>

## Functions

<div class=symbols-table>

| Function   | Notation                      |                                                                                            |
| :--------- | :---------------------------- | :----------------------------------------------------------------------------------------- |
| `Add`      | \\( a + b\\)                  | [Addition](https://www.wikidata.org/wiki/Q32043) {% tags "numeric" "float-right"%}         |
| `Subtract` | \\( a - b\\)                  | [Subtraction](https://www.wikidata.org/wiki/Q32043) {% tags "numeric" "float-right"%}      |
| `Negate`   | \\(-a\\)                      | [Additive inverse](https://www.wikidata.org/wiki/Q715358){% tags "numeric" "float-right"%} |
| `Multiply` | \\( a\times b \\)             | [Multiplication](https://www.wikidata.org/wiki/Q40276) {% tags "numeric" "float-right"%}   |
| `Divide`   | \\( \frac{a}{b} \\)           | [Divide](https://www.wikidata.org/wiki/Q1226939) {% tags "numeric" "float-right"%}         |
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
| `Ln`         | \\(\ln(x)\\)            | [Logarithm function](https://www.wikidata.org/wiki/Q11197), the inverse of `Exp` {% tags "numeric" "float-right"%}         |
| `Log`        | \\(\log_b(x)\\)         | `["Log", _v_, _b_]` logarithm of base _b_, default 10 {% tags "numeric" "float-right"%}                                    |
| `Lb`         | \\(\log_2(x)\\)         | [Binary logarithm function](https://www.wikidata.org/wiki/Q581168), the base-2 logarithm {% tags "numeric" "float-right"%} |
| `Lg`         | \\(\log\_{10}(x)\\)     | [Common logarithm](Q966582), the base-10 logarithm {% tags "numeric" "float-right"%}                                       |
| `LogOnePlus` | \\(\ln(x+1)\\)          | {% tags "numeric" "float-right"%}                                                                                          |

</div>

{% readmore "/compute-engine/reference/trigonometry/" %} See also
<strong>Trigonometry</strong> for trigonometric functions {% endreadmore %}

{% readmore "/compute-engine/reference/complex/" %} See also
<strong>Complex</strong> for complex functions {% endreadmore %}

{% readmore "/compute-engine/reference/statistics/" %} See also
<strong>Statistics</strong> for statistics functions and functions on lists
{% endreadmore %}

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

### Other Functions

{% defs "Function" "Operation" %}

{% def "BaseForm" %}

[&quot;**BaseForm**&quot;, _value:integer_]{.signature}

[&quot;**BaseForm**&quot;, _value:integer_, _base_]{.signature}


Format an _integer_ in a specific _base_, such as hexadecimal or binary.

If no _base_ is specified, use base-10.

The sign of _integer_ is ignored.

- _value_ should be an integer.
- _base_ should be an integer from 2 to 36.

```json example
["Latex", ["BaseForm", 42, 16]]
// ➔ (\text(2a))_{16}
```

```cortex
Latex(BaseForm(42, 16))
// ➔ (\text(2a))_{16}
String(BaseForm(42, 16))
// ➔ "'0x2a'"
```

{% enddef %}

{% def "Clamp" %} 

[&quot;**Clamp**&quot;, _value_]{.signature}

[&quot;**Clamp**&quot;, _value_, _lower_, _upper_]{.signature}

- If `_value_` is less than `_lower_`, evaluate to `_lower_`
- If `_value_` is greater than `_upper_`, evaluate to `_upper_`
- Otherwise, evaluate to `_value_`

If `_lower_` and `_upper_` are not provided, they take the default values of -1
and +1.

```json example
["Clamp", 0.42]
// ➔ 5
["Clamp", 4.2]
// ➔ 1
["Clamp", -5, 0, "+Infinity"]
// ➔ 0
["Clamp", 100, 0, 11]
// ➔ 11
```

{% enddef %}

{% def "Max" %} 

[&quot;**Max**&quot;, _x1_, _x2_, ...]{.signature}

[&quot;**Max**&quot;, _list_]{.signature}


If all the arguments are real numbers, excluding `NaN`, evaluate to the largest
of the arguments.

Otherwise, simplify the expression by removing values that are smaller than or
equal to the largest real number.

```json example
["Max", 5, 2, -1]
// ➔ 5
["Max", 0, 7.1, "NaN", "x", 3]
// ➔ ["Max", 7.1, "NaN", "x"]
```

{% enddef %}

{% def "Min" %} 

[&quot;**Max**&quot;, _x1_, _x2_, ...]{.signature}

[&quot;**Max**&quot;, _list_]{.signature}

If all the arguments are real numbers, excluding `NaN`, evaluate to the smallest
of the arguments.

Otherwise, simplify the expression by removing values that are greater than or
equal to the smallest real number.

{% enddef %}

{% def "Rational" %} 

[&quot;**Rational**&quot;, _n_]{.signature}

Evaluate to a rational approximating the value of the number `_n_`.

<br>

[&quot;**Rational**&quot;, _numerator_, _denominator_]{.signature}

Represent a rational number equal to `_numerator_` over `_denominator_`.

{% enddef %}

{% enddefs %}
