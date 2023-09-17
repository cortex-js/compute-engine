---
title: Calculus
permalink: /compute-engine/reference/calculus/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: true
render_math_in_document: true
---

Calculus is the mathematical study of continuous change. 

It has two main branches: differential calculus and integral calculus. 
These two branches are related by the fundamental theorem of calculus:

\\[ \\int_a^b f(x) \\,\\mathrm{d}x = F(b) - F(a) \\]

where \\( F \\) is an antiderivative of \\( f \\), that is \\( F' = f \\).


## Functions

{% def "Integrate" %}
[&quot;**Integrate**&quot;, _expr_]{.signature}

[&quot;**Integrate**&quot;, _expr_, _index_]{.signature}

An **indefinite integral**, also known as an antiderivative, refers to the reverse 
process of differentiation. 

{% latex "\\int \\sin x \\,\\mathrm{d}x" %}

```json example
["Integrate", ["Sin", "x"], "x"]
```

Note that the LaTeX expression above include a LaTeX spacing command `\\,` to add a
small space between the function and the differential operator. This is
optional, but it makes the expression easier to read.{.notice--info}

Note that the `d` indicating the variable of integration is wrapped with 
a `\\mathrm{}` command so it can be displayed upright. This is 
also optional, but this a recommended typographical convention.{.notice--info}



Given a function \\(f(x)\\), finding its indefinite integral, denoted as 
\\(\int f(x) \\,\\mathrm{d}x\\), involves finding a new function 
\\(F(x)\\) such that \\(F'(x) = f(x)\\).

Mathematically, this is expressed as:

\\[ \\int f(x) \\,\\mathrm{d}x = F(x) + C \\]

where:
- \\(dx\\) specifies the variable of integration.
- \\(F(x)\\) is the antiderivative or the original function.
- \\(C\\) is the constant of integration, accounting for the fact that there are 
  many functions that can have the same derivative, differing only by a constant.

<b>Reference</b>
- Wikipedia: [Integral](https://en.wikipedia.org/wiki/Integral), [Antiderivative](https://en.wikipedia.org/wiki/Antiderivative), [Integral Symbol](https://en.wikipedia.org/wiki/Integral_symbol)
- Wolfram Mathworld: [Integral](https://mathworld.wolfram.com/Integral.html)
- NIST: [Integral](https://dlmf.nist.gov/2.1#E1)

[&quot;**Integrate**&quot;, _expr_, _bounds_]{.signature}

A **definite integral** computes the net area between a function \\( f(x) \\) and
the x-axis over a specified interval \\([a, b]\\). The "net area" accounts for 
areas below the x-axis subtracting from the total. 

{% latex "\\int_{0}^{2} x^2 \\,\\mathrm{d}x" %}

```json example
["Integrate", ["Power", "x", 2], ["Tuple", "x", 0, 2]]
```

The notation for the definite integral of \\( f(x) \\) from \\( a \\) to \\( b \\) 
is given by:

\\[ \\int_{a}^{b} f(x) \\mathrm{d}x = F(b) - F(a) \\]

where:
- \\( dx \\) indicates the variable of integration.
- \\( [a, b] \\) are the bounds of integration, with \\( a \\) being the lower bound and \\( b \\) being the upper bound.
- \\( F(x) \\) is an antiderivative of \\( f(x) \\), meaning \\( F'(x) = f(x) \\).

This value can be calculated symbolically or numerically. Symbolic integration
is the process of finding an antiderivative of a function. Numerical integration
is the process of approximating the value of a definite integral using numerical
methods.



[&quot;**Integrate**&quot;, _expr_, _bounds_, _bounds_]{.signature}

A **double integral** computes the net volume between a function \\( f(x, y) \\) 
and the xy-plane over a specified region \\([a, b] \times [c, d]\\). The 
"net volume" accounts for volumes below the xy-plane subtracting from the 
total. The notation for the double integral of \\( f(x, y) \\) from \\( a \\) to 
\\( b \\) and \\( c \\) to \\( d \\) is given by:

\\[ \\int_{a}^{b} \\int_{c}^{d} f(x, y) \\,\\mathrm{d}x \\,\\mathrm{d}y\\]

{% latex "\\int_{0}^{2} \\int_{0}^{3} x^2 \\,\\mathrm{d}x \\,\\mathrm{d}y" %}

```json example
["Integrate", ["Power", "x", 2], ["Tuple", "x", 0, 3], ["Tuple", "y", 0, 2]]
```



{% enddef %} 



{% def "Derivative" %}

[&quot;**Derivative**&quot;, _expr_, _index_]{.signature}

The `Derivative` function represents the derivative of a function _expr_ with respect to
the variable _index_.

{% latex " f^\\prime(x)" %}

```json example
["Derivative", "f", "x"]
```

The derivative is a measure of how a function changes as its input changes. It is the ratio of the change in the value of a function to the change in its input value. 

The derivative of a function \\( f(x) \\) with respect to its input \\( x \\) is denoted by \\( f'(x) \\) or \\( \\frac{df}{dx} \\). The derivative of a function \\( f(x) \\) is defined as:

\\[
f'(x) = \lim_{h \to 0} \frac{f(x + h) - f(x)}{h}
\\]

where:
- \\( h \\) is the change in the input variable.
- \\( f(x + h) - f(x) \\) is the change in the value of the function.
- \\( \frac{f(x + h) - f(x)}{h} \\) is the ratio of the change in the value of the function to the change in its input value.
- \\( \lim_{h \to 0} \frac{f(x + h) - f(x)}{h} \\) is the limit of the ratio of the change in the value of the function to the change in its input value as \\( h \\) approaches \\( 0 \\).
- The limit is taken as \\( h \\) approaches \\( 0 \\) because the derivative is the instantaneous rate of change of the function at a point, and the change in the input value must be infinitesimally small to be instantaneous.

[&quot;**Derivative**&quot;, _expr_, _index_, _n_]{.signature}

The `Derivative` function represents the _n_-th derivative of a function _expr_ with
respect to the variable _index_.

{% latex "f^{(n)}(x)" %}


```json example
["Derivative", "f", "x", "n"]
```

<b>Reference</b>
- Wikipedia: [Derivative](https://en.wikipedia.org/wiki/Derivative)
- Wikipedia: [Notation for Differentiation](https://en.wikipedia.org/wiki/Notation_for_differentiation), [Leibniz's Notation](https://en.wikipedia.org/wiki/Leibniz%27s_notation), [Lagrange's Notation](https://en.wikipedia.org/wiki/Lagrange%27s_notation),  [Newton's Notation](https://en.wikipedia.org/wiki/Newton%27s_notation)
- Wolfram Mathworld: [Derivative](https://mathworld.wolfram.com/Derivative.html)
- NIST: [Derivative](https://dlmf.nist.gov/2.1#E1)

<b>Lagrange Notation</b>

| LaTeX                 | MathJSON          |
| :-------------------- | :---------------- |
| `f'(x)`               | `["Derivative", "f", "x"]` |
| `f\prime(x)`          | `["Derivative", "f", "x"]` |
| `f^{\prime}(x)`       |   `["Derivative", "f", "x"]` |
| `f''(x)`              | `["Derivative", "f", "x", 2]` |
| `f\prime\prime(x)`    | `["Derivative", "f", "x", 2]` |
| `f^{\prime\prime}(x)` | `["Derivative", "f", "x", 2]` |
| `f\doubleprime(x)` |  `["Derivative", "f", "x", 2]` |
| `f^{(n)}(x)` |  `["Derivative", "f", "x", "n"]` |



{% enddef %} 

